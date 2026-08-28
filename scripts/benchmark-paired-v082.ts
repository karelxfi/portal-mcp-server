#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import type { Client } from '@modelcontextprotocol/client'

import {
  type PerformanceSample,
  comparePairedLatencies,
  runOpenLoop,
  summarizePerformanceSamples,
} from './performance-harness.ts'
import { closeTestClient, connectTestClient } from './test-helpers.ts'
import { TOOL_SPECS, loadToolTestContext } from './tool-manifest.ts'

type CallMeasurement = {
  elapsedMs: number
  responseBytes: number
  outcome: 'success' | 'tool_error' | 'request_error'
  error?: string
}

type PairMeasurement = {
  baseline: CallMeasurement
  candidate: CallMeasurement
}

type BenchmarkProfile = {
  name: 'cold-c1' | 'warm-c1' | 'warm-c4'
  concurrency: number
  intervalMs: number
  samples: number
}

type BenchmarkAttempt = {
  attempt: number
  baseline: {
    summary: ReturnType<typeof summarizePerformanceSamples>
    samples: PerformanceSample<CallMeasurement>[]
  }
  candidate: {
    summary: ReturnType<typeof summarizePerformanceSamples>
    samples: PerformanceSample<CallMeasurement>[]
  }
  successfulPairs: number
  requiredSuccessfulPairs: number
  status: 'insufficient' | 'regression' | 'pass'
  comparison?: ReturnType<typeof comparePairedLatencies>
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function delay(ms: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function gitValue(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function selectedTools() {
  const requested = new Set(
    String(process.env.BENCHMARK_TOOLS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  if (requested.size === 0) return TOOL_SPECS
  const selected = TOOL_SPECS.filter((spec) => requested.has(spec.name))
  const unknown = [...requested].filter((name) => !selected.some((spec) => spec.name === name))
  if (unknown.length > 0) throw new Error(`Unknown BENCHMARK_TOOLS: ${unknown.join(', ')}`)
  return selected
}

async function measure(client: Client, name: string, args: Record<string, unknown>): Promise<CallMeasurement> {
  const startedAt = performance.now()
  try {
    const result = await client.callTool({ name, arguments: args })
    const text = result.content.map((entry: any) => entry?.text ?? '').join('\n')
    return {
      elapsedMs: performance.now() - startedAt,
      responseBytes: Buffer.byteLength(text, 'utf8'),
      outcome: result.isError ? 'tool_error' : 'success',
      ...(result.isError ? { error: text.slice(0, 500) } : {}),
    }
  } catch (error) {
    return {
      elapsedMs: performance.now() - startedAt,
      responseBytes: 0,
      outcome: 'request_error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function projectSamples(
  pairs: PerformanceSample<PairMeasurement>[],
  side: 'baseline' | 'candidate',
): PerformanceSample<CallMeasurement>[] {
  return pairs.map((pair) => {
    const measurement = pair.value?.[side]
    const serviceMs = measurement?.elapsedMs ?? pair.serviceMs
    return {
      ...pair,
      finishedAtMs: pair.startedAtMs + serviceMs,
      serviceMs,
      endToEndMs: pair.queueMs + serviceMs,
      success: pair.success && measurement?.outcome === 'success',
      value: measurement,
      ...(measurement?.error ? { error: measurement.error } : {}),
    }
  })
}

async function main() {
  const candidateCwd = process.cwd()
  const baselineCwd = resolve(process.env.BENCHMARK_BASELINE_CWD ?? '')
  if (!process.env.BENCHMARK_BASELINE_CWD) throw new Error('BENCHMARK_BASELINE_CWD is required')

  const samplesPerProfile = positiveInteger(process.env.BENCHMARK_SAMPLES, 5)
  const targetRps = positiveInteger(process.env.BENCHMARK_TARGET_RPS, 2)
  const cooldownMs = positiveInteger(process.env.BENCHMARK_COOLDOWN_MS, 5_000)
  const releaseMode = process.env.BENCHMARK_RELEASE === '1'
  const profileAttempts = positiveInteger(process.env.BENCHMARK_PROFILE_ATTEMPTS, releaseMode ? 2 : 1)
  const tools = selectedTools()
  if (releaseMode && (tools.length !== TOOL_SPECS.length || samplesPerProfile < 50)) {
    throw new Error('Release paired benchmark requires every tool and at least 50 sample pairs per warm profile')
  }

  const baselineSha = gitValue(baselineCwd, ['rev-parse', 'HEAD'])
  const candidateSha = gitValue(candidateCwd, ['rev-parse', 'HEAD'])
  const baselineDirty = gitValue(baselineCwd, ['status', '--porcelain']).length > 0
  const candidateDirty = gitValue(candidateCwd, ['status', '--porcelain']).length > 0
  if (releaseMode && (baselineDirty || candidateDirty)) {
    throw new Error('Release paired benchmark requires clean baseline and candidate commits')
  }

  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
  const outputPath = resolve(
    process.env.BENCHMARK_OUTPUT ??
      `artifacts/performance/paired-v${packageJson.version}-${baselineSha.slice(0, 8)}-${candidateSha.slice(0, 8)}.json`,
  )
  const profiles: BenchmarkProfile[] = [
    { name: 'cold-c1', concurrency: 1, intervalMs: 0, samples: 1 },
    { name: 'warm-c1', concurrency: 1, intervalMs: 1_000 / targetRps, samples: samplesPerProfile },
    { name: 'warm-c4', concurrency: 4, intervalMs: 1_000 / targetRps, samples: samplesPerProfile },
  ]

  const [baseline, candidate] = await Promise.all([
    connectTestClient('sqd-v081-paired-baseline', { cwd: baselineCwd }),
    connectTestClient('sqd-v082-paired-candidate', { cwd: candidateCwd }),
  ])

  try {
    const context = await loadToolTestContext(candidate.client)
    const results: Record<string, unknown>[] = []
    let baselineErrors = 0
    let candidateErrors = 0
    let totalCalls = 0
    let regressions = 0
    let insufficientProfiles = 0

    for (const spec of tools) {
      const args = spec.args(context)
      for (const profile of profiles) {
        const attempts: BenchmarkAttempt[] = []
        let finalAttempt: BenchmarkAttempt | undefined

        for (let attempt = 1; attempt <= profileAttempts; attempt += 1) {
          const pairs = await runOpenLoop<PairMeasurement>({
            count: profile.samples,
            intervalMs: profile.intervalMs,
            concurrency: profile.concurrency,
            task: async (index) => {
              if (index % 2 === 0) {
                const [baselineCall, candidateCall] = await Promise.all([
                  measure(baseline.client, spec.name, args),
                  measure(candidate.client, spec.name, args),
                ])
                return { baseline: baselineCall, candidate: candidateCall }
              }
              const [candidateCall, baselineCall] = await Promise.all([
                measure(candidate.client, spec.name, args),
                measure(baseline.client, spec.name, args),
              ])
              return { baseline: baselineCall, candidate: candidateCall }
            },
          })
          const baselineSamples = projectSamples(pairs, 'baseline')
          const candidateSamples = projectSamples(pairs, 'candidate')
          const successfulPairs = baselineSamples.flatMap((sample, index) =>
            sample.success && candidateSamples[index].success
              ? [{ baseline: sample.serviceMs, candidate: candidateSamples[index].serviceMs }]
              : [],
          )
          const requiredSuccessfulPairs = profile.name === 'cold-c1' ? 1 : Math.max(5, Math.ceil(profile.samples * 0.8))
          const hasEnoughPairs = successfulPairs.length >= requiredSuccessfulPairs
          const comparison =
            profile.name !== 'cold-c1' && hasEnoughPairs
              ? comparePairedLatencies(
                  successfulPairs.map((pair) => pair.baseline),
                  successfulPairs.map((pair) => pair.candidate),
                )
              : undefined
          const status = !hasEnoughPairs ? 'insufficient' : comparison?.regression ? 'regression' : 'pass'
          const baselineSummary = summarizePerformanceSamples(baselineSamples)
          const candidateSummary = summarizePerformanceSamples(candidateSamples)
          finalAttempt = {
            attempt,
            baseline: { summary: baselineSummary, samples: baselineSamples },
            candidate: { summary: candidateSummary, samples: candidateSamples },
            successfulPairs: successfulPairs.length,
            requiredSuccessfulPairs,
            status,
            comparison,
          }
          attempts.push(finalAttempt)

          baselineErrors += baselineSamples.filter((sample) => !sample.success).length
          candidateErrors += candidateSamples.filter((sample) => !sample.success).length
          totalCalls += profile.samples

          console.log(
            `${spec.name} ${profile.name} attempt=${attempt}/${profileAttempts}: baseline-p95=${baselineSummary.endToEndMs.p95.toFixed(1)}ms candidate-p95=${candidateSummary.endToEndMs.p95.toFixed(1)}ms pairs=${successfulPairs.length}/${requiredSuccessfulPairs} ${status.toUpperCase()}`,
          )
          if (status === 'pass' || attempt === profileAttempts) break
          console.log(`${spec.name} ${profile.name}: cooling down before confirming ${status} evidence`)
          await delay(cooldownMs)
        }

        if (!finalAttempt) throw new Error(`No paired benchmark attempt ran for ${spec.name} ${profile.name}`)
        if (finalAttempt.comparison?.regression) regressions += 1
        if (finalAttempt.status === 'insufficient') insufficientProfiles += 1
        results.push({ tool: spec.name, profile, ...finalAttempt, attempts })
      }
      if (spec !== tools.at(-1)) await delay(cooldownMs)
    }

    const artifact = {
      schemaVersion: 'sqd_mcp_paired_performance_v4',
      createdAt: new Date().toISOString(),
      releaseVersion: packageJson.version,
      baseline: { gitSha: baselineSha, gitDirty: baselineDirty },
      candidate: { gitSha: candidateSha, gitDirty: candidateDirty },
      config: {
        releaseMode,
        samplesPerProfile,
        targetRps,
        cooldownMs,
        profileAttempts,
        toolCount: tools.length,
        profiles,
      },
      totals: {
        samplesPerSide: totalCalls,
        baselineErrors,
        candidateErrors,
        baselineErrorRate: baselineErrors / totalCalls,
        candidateErrorRate: candidateErrors / totalCalls,
        regressions,
        insufficientProfiles,
      },
      results,
    }
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    console.log(`Wrote ${outputPath}`)

    if (releaseMode && artifact.totals.candidateErrorRate > 0.01) {
      throw new Error(
        `Candidate tool-error rate ${(artifact.totals.candidateErrorRate * 100).toFixed(2)}% exceeded 1.00%`,
      )
    }
    if (releaseMode && regressions > 0) {
      throw new Error(`${regressions} statistically supported paired latency regressions exceeded 10%`)
    }
    if (releaseMode && insufficientProfiles > 0) {
      throw new Error(`${insufficientProfiles} profiles did not produce enough successful baseline/candidate pairs`)
    }
  } finally {
    await Promise.all([closeTestClient(baseline), closeTestClient(candidate)])
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
