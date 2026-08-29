#!/usr/bin/env tsx

import { setTimeout as sleep } from 'node:timers/promises'

import { buildOhlcRequestCacheKey } from '../src/tools/evm/ohlc.ts'
import { comparePairedLatencies, runOpenLoop, summarizePerformanceSamples } from './performance-harness.ts'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function main() {
  const ohlcKeyInput = {
    dataset: 'base-mainnet',
    source: 'uniswap_v3_swap' as const,
    interval: '5m' as const,
    duration: '1h',
    mode: 'deep' as const,
    poolAddress: '0x0000000000000000000000000000000000000001',
    priceIn: 'auto' as const,
    baseToken: 'token0' as const,
    includeRecentTrades: true,
    recentTradesLimit: 5,
  }
  const firstOhlcKey = buildOhlcRequestCacheKey(ohlcKeyInput)
  assert(firstOhlcKey === buildOhlcRequestCacheKey({ ...ohlcKeyInput }), 'identical OHLC requests should share a key')
  assert(
    firstOhlcKey !== buildOhlcRequestCacheKey({ ...ohlcKeyInput, baseToken: 'token1' }),
    'price orientation must remain part of the OHLC request cache key',
  )
  assert(
    firstOhlcKey !== buildOhlcRequestCacheKey({ ...ohlcKeyInput, duration: '6h' }),
    'requested evidence window must remain part of the OHLC request cache key',
  )
  console.log('PASS  EVM OHLC request cache keys preserve query semantics')

  const samples = await runOpenLoop({
    count: 8,
    intervalMs: 2,
    concurrency: 1,
    task: async () => {
      await sleep(12)
      return 'ok'
    },
  })
  const summary = summarizePerformanceSamples(samples)
  assert(summary.successes === 8 && summary.failures === 0, 'open-loop run should retain every outcome')
  assert(summary.queueMs.p95 >= 30, `open-loop queue wait should be visible, got p95 ${summary.queueMs.p95}ms`)
  assert(summary.endToEndMs.p95 > summary.serviceMs.p95, 'end-to-end latency should include intended-start queue delay')
  console.log('PASS  open-loop timing includes coordinated-omission queue wait')

  const baseline = Array.from({ length: 50 }, (_, index) => 90 + ((index * 17) % 23))
  const aaCandidate = baseline.map((value, index) => value * (0.98 + ((index * 7) % 5) * 0.01))
  const aa = comparePairedLatencies(baseline, aaCandidate, { seed: 8_201 })
  assert(!aa.regression, `A/A noise should not be called a regression: ${JSON.stringify(aa)}`)
  console.log('PASS  paired bootstrap keeps the deterministic A/A run green')

  const regressedCandidate = baseline.map((value, index) => value * (1.2 + ((index * 3) % 3) * 0.01))
  const regression = comparePairedLatencies(baseline, regressedCandidate, { seed: 8_202 })
  assert(regression.regression, `injected 20% regression should be detected: ${JSON.stringify(regression)}`)
  assert(regression.confidenceInterval.lower > 1.1, 'regression confidence interval should clear the 10% gate')
  console.log('PASS  paired bootstrap catches an injected 20% latency regression')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
