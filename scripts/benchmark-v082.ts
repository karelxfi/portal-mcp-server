#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { runOpenLoop, summarizePerformanceSamples } from './performance-harness.ts'
import { closeTestClient, connectTestClient, getToolErrorCode } from './test-helpers.ts'
import { TOOL_SPECS, loadToolTestContext } from './tool-manifest.ts'

type CallMeasurement = {
  tool: string
  responseBytes: number
  outcome: 'success' | 'bounded_overload' | 'tool_error'
}

type BenchmarkProfile = {
  name: 'cold-c1' | 'warm-c1' | 'warm-c4' | 'warm-c8' | 'burst-c8'
  concurrency: number
  intervalMs: number
  samples: number
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
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

async function main() {
  const samplesPerProfile = positiveInteger(process.env.BENCHMARK_SAMPLES, 5)
  const targetRps = positiveInteger(process.env.BENCHMARK_TARGET_RPS, 5)
  const releaseMode = process.env.BENCHMARK_RELEASE === '1'
  const tools = selectedTools()
  if (releaseMode && (tools.length !== TOOL_SPECS.length || samplesPerProfile < 50)) {
    throw new Error('Release benchmark requires every tool and at least 50 samples per warm/load profile')
  }

  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const gitDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
  if (releaseMode && gitDirty) throw new Error('Release benchmark requires a clean exact commit')
  const outputPath = resolve(
    process.env.BENCHMARK_OUTPUT ??
      `artifacts/performance/v${packageJson.version}-${gitSha.slice(0, 12)}${gitDirty ? '-dirty' : ''}.json`,
  )
  const profiles: BenchmarkProfile[] = [
    { name: 'cold-c1', concurrency: 1, intervalMs: 0, samples: 1 },
    { name: 'warm-c1', concurrency: 1, intervalMs: 1_000 / targetRps, samples: samplesPerProfile },
    { name: 'warm-c4', concurrency: 4, intervalMs: 1_000 / targetRps, samples: samplesPerProfile },
    { name: 'warm-c8', concurrency: 8, intervalMs: 1_000 / targetRps, samples: samplesPerProfile },
    { name: 'burst-c8', concurrency: 8, intervalMs: 0, samples: samplesPerProfile },
  ]
  const connected = await connectTestClient('sqd-v082-benchmark')

  try {
    const context = await loadToolTestContext(connected.client)
    const results: Record<string, unknown>[] = []

    for (const spec of tools) {
      const args = spec.args(context)
      for (const profile of profiles) {
        const samples = await runOpenLoop<CallMeasurement>({
          count: profile.samples,
          intervalMs: profile.intervalMs,
          concurrency: profile.concurrency,
          task: async () => {
            const result = await connected.client.callTool({ name: spec.name, arguments: args })
            const text = result.content.map((entry: any) => entry?.text ?? '').join('\n')
            return {
              tool: spec.name,
              responseBytes: Buffer.byteLength(text, 'utf8'),
              outcome:
                result.isError && getToolErrorCode(result) === 'overloaded' && profile.concurrency >= 8
                  ? 'bounded_overload'
                  : result.isError
                    ? 'tool_error'
                    : 'success',
            }
          },
        })
        const summary = summarizePerformanceSamples(samples)
        const toolErrors = samples.filter((sample) => sample.value?.outcome === 'tool_error').length
        const boundedOverloads = samples.filter((sample) => sample.value?.outcome === 'bounded_overload').length
        results.push({
          tool: spec.name,
          profile,
          summary,
          toolErrors,
          boundedOverloads,
          responseBytes: samples.map((sample) => sample.value?.responseBytes ?? 0),
          samples: samples.map(({ value, ...timing }) => ({
            ...timing,
            outcome: value?.outcome ?? 'request_failure',
          })),
        })
        console.log(
          `${spec.name} ${profile.name}: p50=${summary.endToEndMs.p50.toFixed(1)}ms p95=${summary.endToEndMs.p95.toFixed(1)}ms queue-p95=${summary.queueMs.p95.toFixed(1)}ms unexpected-failures=${summary.failures + toolErrors} bounded-overloads=${boundedOverloads}`,
        )
      }
    }

    const totalSamples = results.reduce((sum, result: any) => sum + result.summary.samples, 0)
    const totalFailures = results.reduce((sum, result: any) => sum + result.summary.failures + result.toolErrors, 0)
    const totalBoundedOverloads = results.reduce((sum, result: any) => sum + result.boundedOverloads, 0)
    const artifact = {
      schemaVersion: 'sqd_mcp_performance_v1',
      createdAt: new Date().toISOString(),
      releaseVersion: packageJson.version,
      gitSha,
      gitDirty,
      transport: 'stdio',
      client: { name: 'sqd-v082-benchmark', version: '1.0.0' },
      config: { releaseMode, samplesPerProfile, targetRps, toolCount: tools.length, profiles },
      totals: {
        samples: totalSamples,
        failures: totalFailures,
        failureRate: totalFailures / totalSamples,
        boundedOverloads: totalBoundedOverloads,
        boundedOverloadRate: totalBoundedOverloads / totalSamples,
      },
      results,
    }
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    console.log(`Wrote ${outputPath}`)

    const allowedFailureRate = releaseMode ? 0.01 : 1
    const allowedBoundedOverloadRate = releaseMode ? 0.1 : 1
    if (
      artifact.totals.failureRate > allowedFailureRate ||
      artifact.totals.boundedOverloadRate > allowedBoundedOverloadRate
    ) {
      throw new Error(
        `Unexpected failure rate ${(artifact.totals.failureRate * 100).toFixed(2)}% or bounded overload rate ${(artifact.totals.boundedOverloadRate * 100).toFixed(2)}% exceeded its release budget`,
      )
    }
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
