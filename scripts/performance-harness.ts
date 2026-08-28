import { performance } from 'node:perf_hooks'

import { calculatePercentile } from '../src/helpers/statistics.ts'

export type PerformanceSample<T = unknown> = {
  index: number
  scheduledAtMs: number
  startedAtMs: number
  finishedAtMs: number
  queueMs: number
  serviceMs: number
  endToEndMs: number
  success: boolean
  value?: T
  error?: string
}

export type LatencySummary = {
  samples: number
  successes: number
  failures: number
  queueMs: { p50: number; p95: number; p99: number; max: number }
  serviceMs: { p50: number; p95: number; p99: number; max: number }
  endToEndMs: { p50: number; p95: number; p99: number; max: number }
}

export type PairedRegressionResult = {
  samples: number
  thresholdRatio: number
  observedMedianRatio: number
  confidence: number
  confidenceInterval: { lower: number; upper: number }
  regression: boolean
}

type OpenLoopOptions<T> = {
  count: number
  intervalMs: number
  concurrency: number
  task: (index: number) => Promise<T>
}

function finiteNonNegative(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function positiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function latencyDistribution(values: number[]) {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 }
  return {
    p50: calculatePercentile(values, 50) ?? 0,
    p95: calculatePercentile(values, 95) ?? 0,
    p99: calculatePercentile(values, 99) ?? 0,
    max: Math.max(...values),
  }
}

export function summarizePerformanceSamples(samples: PerformanceSample[]): LatencySummary {
  return {
    samples: samples.length,
    successes: samples.filter((sample) => sample.success).length,
    failures: samples.filter((sample) => !sample.success).length,
    queueMs: latencyDistribution(samples.map((sample) => sample.queueMs)),
    serviceMs: latencyDistribution(samples.map((sample) => sample.serviceMs)),
    endToEndMs: latencyDistribution(samples.map((sample) => sample.endToEndMs)),
  }
}

export async function runOpenLoop<T>(options: OpenLoopOptions<T>): Promise<PerformanceSample<T>[]> {
  const count = positiveInteger(options.count, 1)
  const concurrency = positiveInteger(options.concurrency, 1)
  const intervalMs = finiteNonNegative(options.intervalMs, 0)
  const epoch = performance.now()
  let active = 0
  const waiters: Array<() => void> = []

  async function acquire() {
    if (active < concurrency) {
      active += 1
      return
    }
    await new Promise<void>((resolve) => waiters.push(resolve))
    active += 1
  }

  function release() {
    active -= 1
    waiters.shift()?.()
  }

  const pending = Array.from({ length: count }, (_, index) => {
    const scheduledAtMs = epoch + index * intervalMs
    return new Promise<PerformanceSample<T>>((resolve) => {
      const delayMs = Math.max(0, scheduledAtMs - performance.now())
      setTimeout(async () => {
        await acquire()
        const startedAtMs = performance.now()
        try {
          const value = await options.task(index)
          const finishedAtMs = performance.now()
          resolve({
            index,
            scheduledAtMs,
            startedAtMs,
            finishedAtMs,
            queueMs: Math.max(0, startedAtMs - scheduledAtMs),
            serviceMs: finishedAtMs - startedAtMs,
            endToEndMs: finishedAtMs - scheduledAtMs,
            success: true,
            value,
          })
        } catch (error) {
          const finishedAtMs = performance.now()
          resolve({
            index,
            scheduledAtMs,
            startedAtMs,
            finishedAtMs,
            queueMs: Math.max(0, startedAtMs - scheduledAtMs),
            serviceMs: finishedAtMs - startedAtMs,
            endToEndMs: finishedAtMs - scheduledAtMs,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        } finally {
          release()
        }
      }, delayMs)
    })
  })

  return Promise.all(pending)
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function median(values: number[]) {
  return calculatePercentile(values, 50) ?? 0
}

export function comparePairedLatencies(
  baselineMs: number[],
  candidateMs: number[],
  options?: {
    thresholdRatio?: number
    confidence?: number
    bootstrapIterations?: number
    seed?: number
  },
): PairedRegressionResult {
  if (baselineMs.length !== candidateMs.length || baselineMs.length < 5) {
    throw new Error('Paired latency comparison requires matching runs with at least five samples')
  }

  const ratios = baselineMs.map((baseline, index) => {
    if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(candidateMs[index])) {
      throw new Error('Latency samples must be finite and baseline samples must be positive')
    }
    return candidateMs[index] / baseline
  })
  const thresholdRatio = options?.thresholdRatio ?? 1.1
  const confidence = Math.min(0.999, Math.max(0.5, options?.confidence ?? 0.9))
  const iterations = positiveInteger(options?.bootstrapIterations ?? 2_000, 2_000)
  const random = seededRandom(options?.seed ?? 0x5_1d_08_02)
  const bootstrappedMedians: number[] = []

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resample = Array.from({ length: ratios.length }, () => ratios[Math.floor(random() * ratios.length)])
    bootstrappedMedians.push(median(resample))
  }

  const tail = ((1 - confidence) / 2) * 100
  const lower = calculatePercentile(bootstrappedMedians, tail) ?? 0
  const upper = calculatePercentile(bootstrappedMedians, 100 - tail) ?? 0

  return {
    samples: ratios.length,
    thresholdRatio,
    observedMedianRatio: median(ratios),
    confidence,
    confidenceInterval: { lower, upper },
    regression: lower > thresholdRatio,
  }
}
