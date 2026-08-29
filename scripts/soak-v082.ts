#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { runOpenLoop, summarizePerformanceSamples } from './performance-harness.ts'
import { closeTestClient, connectTestClient, getToolErrorCode } from './test-helpers.ts'
import { TOOL_SPECS, loadToolTestContext } from './tool-manifest.ts'

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function childRssBytes(pid: number | null) {
  if (!pid) return undefined
  try {
    const rssKb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim())
    return Number.isFinite(rssKb) ? rssKb * 1_024 : undefined
  } catch {
    return undefined
  }
}

function median(values: number[]) {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]
}

async function main() {
  const durationMinutes = positiveNumber(process.env.SOAK_DURATION_MINUTES, 60)
  const targetRps = positiveNumber(process.env.SOAK_RPS, 1)
  const maxRssBytesAllowed = positiveNumber(process.env.SOAK_MAX_RSS_MB, 512) * 1024 * 1024
  const maxMedianRssGrowthBytes = positiveNumber(process.env.SOAK_MAX_MEDIAN_RSS_GROWTH_MB, 128) * 1024 * 1024
  const releaseMode = process.env.SOAK_RELEASE === '1'
  if (releaseMode && durationMinutes < 60) throw new Error('Release soak must run for at least 60 minutes')

  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const gitDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
  if (releaseMode && gitDirty) throw new Error('Release soak requires a clean exact commit')
  const outputPath = resolve(
    process.env.SOAK_OUTPUT ??
      `artifacts/soak/v${packageJson.version}-${gitSha.slice(0, 12)}${gitDirty ? '-dirty' : ''}.json`,
  )
  const connected = await connectTestClient('sqd-v082-soak')
  const rssSamples: Array<{ atMs: number; rssBytes?: number }> = []
  const startedAt = Date.now()

  try {
    const context = await loadToolTestContext(connected.client)
    rssSamples.push({ atMs: Date.now() - startedAt, rssBytes: childRssBytes(connected.transport.pid) })
    const totalCalls = Math.max(1, Math.ceil(durationMinutes * 60 * targetRps))
    const intervalMs = 1_000 / targetRps
    const rssTimer = setInterval(
      () => {
        rssSamples.push({ atMs: Date.now() - startedAt, rssBytes: childRssBytes(connected.transport.pid) })
      },
      Math.min(30_000, Math.max(1_000, intervalMs * 10)),
    )
    rssTimer.unref()

    const samples = await runOpenLoop({
      count: totalCalls,
      intervalMs,
      concurrency: 8,
      task: async (index) => {
        const spec = TOOL_SPECS[index % TOOL_SPECS.length]
        const burstWidth = index > 0 && index % Math.max(1, Math.floor(60 * targetRps)) === 0 ? 8 : 1
        const calls = Array.from({ length: burstWidth }, () =>
          connected.client.callTool({ name: spec.name, arguments: spec.args(context) }),
        )
        const results = await Promise.all(calls)
        const boundedOverloads = results.filter(
          (result) => result.isError && getToolErrorCode(result) === 'overloaded',
        ).length
        return {
          tool: spec.name,
          calls: results.length,
          errors: results.filter((result) => result.isError).length - boundedOverloads,
          boundedOverloads,
        }
      },
    })
    clearInterval(rssTimer)
    rssSamples.push({ atMs: Date.now() - startedAt, rssBytes: childRssBytes(connected.transport.pid) })

    const summary = summarizePerformanceSamples(samples)
    const toolErrors = samples.reduce((sum, sample) => sum + (sample.value?.errors ?? 0), 0)
    const boundedOverloads = samples.reduce((sum, sample) => sum + (sample.value?.boundedOverloads ?? 0), 0)
    const totalToolCalls = samples.reduce((sum, sample) => sum + (sample.value?.calls ?? 0), 0)
    const rssValues = rssSamples.flatMap((sample) => (sample.rssBytes === undefined ? [] : [sample.rssBytes]))
    const rssGrowthBytes = rssValues.length > 1 ? rssValues[rssValues.length - 1] - rssValues[0] : undefined
    const rssWindowSize = Math.max(1, Math.floor(rssValues.length / 4))
    const firstWindowMedianBytes = median(rssValues.slice(0, rssWindowSize))
    const lastWindowMedianBytes = median(rssValues.slice(-rssWindowSize))
    const medianGrowthBytes =
      firstWindowMedianBytes !== undefined && lastWindowMedianBytes !== undefined
        ? lastWindowMedianBytes - firstWindowMedianBytes
        : undefined
    const maxRssBytes = rssValues.length > 0 ? Math.max(...rssValues) : undefined
    const artifact = {
      schemaVersion: 'sqd_mcp_soak_v1',
      createdAt: new Date().toISOString(),
      releaseVersion: packageJson.version,
      gitSha,
      gitDirty,
      transport: 'stdio',
      config: {
        releaseMode,
        durationMinutes,
        targetRps,
        concurrency: 8,
        burstEverySeconds: 60,
        maxRssBytesAllowed,
        maxMedianRssGrowthBytes,
      },
      summary,
      toolCalls: {
        total: totalToolCalls,
        errors: toolErrors,
        errorRate: toolErrors / totalToolCalls,
        boundedOverloads,
        boundedOverloadRate: boundedOverloads / totalToolCalls,
      },
      rss: {
        samples: rssSamples,
        firstBytes: rssValues[0],
        lastBytes: rssValues[rssValues.length - 1],
        maxBytes: maxRssBytes,
        growthBytes: rssGrowthBytes,
        windowSize: rssWindowSize,
        firstWindowMedianBytes,
        lastWindowMedianBytes,
        medianGrowthBytes,
      },
    }
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    console.log(`Wrote ${outputPath}`)
    console.log(
      `Soak p95=${summary.endToEndMs.p95.toFixed(1)}ms queue-p95=${summary.queueMs.p95.toFixed(1)}ms unexpected-tool-error-rate=${(artifact.toolCalls.errorRate * 100).toFixed(2)}% bounded-overload-rate=${(artifact.toolCalls.boundedOverloadRate * 100).toFixed(2)}% RSS-median-growth=${medianGrowthBytes ?? 'unknown'} bytes RSS-max=${maxRssBytes ?? 'unknown'} bytes`,
    )

    if (
      releaseMode &&
      (summary.failures > 0 ||
        artifact.toolCalls.errorRate > 0.01 ||
        artifact.toolCalls.boundedOverloadRate > 0.1 ||
        maxRssBytes === undefined ||
        maxRssBytes > maxRssBytesAllowed ||
        medianGrowthBytes === undefined ||
        medianGrowthBytes > maxMedianRssGrowthBytes)
    ) {
      throw new Error(
        'Release soak exceeded its request, unexpected-error, bounded-overload, peak RSS, or median RSS growth budget',
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
