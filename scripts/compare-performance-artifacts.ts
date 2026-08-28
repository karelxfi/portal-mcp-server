#!/usr/bin/env tsx

import { readFile } from 'node:fs/promises'

import { comparePairedLatencies } from './performance-harness.ts'

type ArtifactResult = {
  tool: string
  profile: { name: string }
  samples: Array<{ endToEndMs: number; success: boolean; outcome: string }>
}

type Artifact = {
  schemaVersion: string
  gitSha: string
  results: ArtifactResult[]
}

async function load(path: string): Promise<Artifact> {
  const artifact = JSON.parse(await readFile(path, 'utf8')) as Artifact
  if (artifact.schemaVersion !== 'sqd_mcp_performance_v1') {
    throw new Error(`${path} is not an sqd_mcp_performance_v1 artifact`)
  }
  return artifact
}

async function main() {
  const [baselinePath, candidatePath] = process.argv.slice(2)
  if (!baselinePath || !candidatePath) {
    throw new Error('Usage: npm run benchmark:compare -- <baseline.json> <candidate.json>')
  }
  const [baseline, candidate] = await Promise.all([load(baselinePath), load(candidatePath)])
  const candidateByKey = new Map(candidate.results.map((result) => [`${result.tool}:${result.profile.name}`, result]))
  const regressions: Record<string, unknown>[] = []

  for (const baselineResult of baseline.results) {
    if (baselineResult.profile.name === 'cold-c1') continue
    const key = `${baselineResult.tool}:${baselineResult.profile.name}`
    const candidateResult = candidateByKey.get(key)
    if (!candidateResult) throw new Error(`Candidate artifact is missing ${key}`)
    const baselineSamples = baselineResult.samples.filter((sample) => sample.success && sample.outcome === 'success')
    const candidateSamples = candidateResult.samples.filter((sample) => sample.success && sample.outcome === 'success')
    const pairedCount = Math.min(baselineSamples.length, candidateSamples.length)
    if (pairedCount < 5) throw new Error(`${key} has only ${pairedCount} successful paired samples`)
    const comparison = comparePairedLatencies(
      baselineSamples.slice(0, pairedCount).map((sample) => sample.endToEndMs),
      candidateSamples.slice(0, pairedCount).map((sample) => sample.endToEndMs),
    )
    console.log(
      `${key}: median ratio=${comparison.observedMedianRatio.toFixed(3)} CI=${comparison.confidenceInterval.lower.toFixed(3)}-${comparison.confidenceInterval.upper.toFixed(3)} ${comparison.regression ? 'REGRESSION' : 'PASS'}`,
    )
    if (comparison.regression) regressions.push({ key, comparison })
  }

  if (regressions.length > 0) {
    throw new Error(`${regressions.length} statistically supported latency regressions exceeded the 10% gate`)
  }
  console.log(`PASS  ${baseline.gitSha.slice(0, 12)} -> ${candidate.gitSha.slice(0, 12)} performance comparison`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
