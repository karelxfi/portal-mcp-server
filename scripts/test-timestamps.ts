#!/usr/bin/env tsx

import { getBlockHead } from '../dist/cache/datasets.js'
import { getDatasets } from '../dist/cache/datasets.js'
import { buildQueryFreshness } from '../dist/helpers/result-metadata.js'
import { detectChainType } from '../dist/helpers/chain.js'
import {
  getTimestampWindowNotices,
  getHeadTimestamp,
  parseTimeframeToSeconds,
  parseTimestampInput,
  resolveBlockAtTimestamp,
  resolveTimeframeOrBlocks,
  timestampToBlock,
} from '../dist/helpers/timeframe.js'

const REALTIME_MATRIX_CONCURRENCY = 3

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

async function retryPortalProbe<T>(
  probe: () => Promise<T>,
  accept: (value: T) => boolean = () => true,
): Promise<T> {
  let lastError: Error | undefined
  let lastValue: T | undefined

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const value = await probe()
      lastValue = value
      if (accept(value)) return value
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }

    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    }
  }

  if (lastValue !== undefined) return lastValue
  throw lastError ?? new Error('Portal probe failed without a result')
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function assertRealtimeTimestampMatrix() {
  const datasets = await getDatasets()
  const realtimeDatasets = datasets.filter((dataset) => dataset.real_time)

  const rows = await mapLimit(realtimeDatasets, REALTIME_MATRIX_CONCURRENCY, (dataset) =>
    retryPortalProbe(async () => {
      const head = await getBlockHead(dataset.dataset)
      const headTimestamp = await getHeadTimestamp(dataset.dataset, head.number)
      const window = await resolveTimeframeOrBlocks({ dataset: dataset.dataset, timeframe: '1h' })

      assert(Number.isFinite(headTimestamp) && headTimestamp > 1_000_000_000, `${dataset.dataset} should expose a latest block timestamp`)
      assert(window.to_block === head.number, `${dataset.dataset} 1h window should anchor to the latest indexed head`)
      assert(window.from_block <= window.to_block, `${dataset.dataset} 1h window should be ordered`)

      return {
        dataset: dataset.dataset,
        kind: dataset.metadata?.kind ?? 'unknown',
        head: head.number,
        headTimestamp,
        fromBlock: window.from_block,
        toBlock: window.to_block,
      }
    }),
  )

  const byKind = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.kind] = (acc[row.kind] ?? 0) + 1
    return acc
  }, {})

  console.log(`PASS  real-time timestamp matrix -> ${rows.length} datasets (${Object.entries(byKind).map(([kind, count]) => `${kind}:${count}`).join(', ')})`)
}

async function assertHyperliquidFillsExactTimestampLookup() {
  const dataset = 'hyperliquid-fills'
  const head = await getBlockHead(dataset)
  const headTimestamp = await getHeadTimestamp(dataset, head.number)
  assert(Number.isFinite(headTimestamp) && headTimestamp > 1_000_000_000, 'Hyperliquid fills head timestamp should resolve from block.timestamp')

  const targetTimestamp = headTimestamp - 300
  const exactProbeBlock = await retryPortalProbe(() => timestampToBlock(dataset, targetTimestamp))
  const fiveMinuteWindow = await retryPortalProbe(
    () => resolveTimeframeOrBlocks({ dataset, timeframe: '5m' }),
    (window) => window.from_lookup?.resolution === 'exact',
  )

  assert(fiveMinuteWindow.to_block === head.number, '5m Hyperliquid fills window should anchor to the cached latest block')
  assert(fiveMinuteWindow.from_block < fiveMinuteWindow.to_block, '5m Hyperliquid fills window should produce an ordered block range')
  assert(fiveMinuteWindow.from_lookup?.resolution === 'exact', '5m Hyperliquid fills window should use exact Portal timestamp lookup')
  assert(fiveMinuteWindow.from_lookup.block_number === fiveMinuteWindow.from_block, '5m Hyperliquid fills lookup metadata should match the resolved window')
  assert(exactProbeBlock <= head.number, 'Hyperliquid fills timestamp endpoint should return a block at or before head')

  const directLookup = await retryPortalProbe(
    () => resolveBlockAtTimestamp(dataset, targetTimestamp),
    (lookup) => lookup.resolution === 'exact',
  )
  assert(directLookup.resolution === 'exact', 'Hyperliquid fills timestamp lookup should use the exact Portal endpoint')
  assert(directLookup.block_number <= head.number, 'Hyperliquid fills direct lookup should not exceed indexed head')

  console.log(`PASS  Hyperliquid fills 5m window -> ${fiveMinuteWindow.from_block}..${fiveMinuteWindow.to_block} (exact)`)
}

function assertNaturalLanguageTimeInputs() {
  const now = 1_778_923_600
  const cases: Array<[string, number]> = [
    ['30m', 1_800],
    ['past 30 minutes', 1_800],
    ['in the past 1h', 3_600],
    ['in last 38 mins', 2_280],
    ['last hour', 3_600],
    ['over the previous 2 weeks', 1_209_600],
    ['30 minutes ago', 1_800],
  ]

  for (const [input, seconds] of cases) {
    assert(parseTimeframeToSeconds(input) === seconds, `${input} should parse as ${seconds} seconds`)

    const parsed = parseTimestampInput(input, now)
    assert(parsed.timestamp === now - seconds, `${input} should resolve to now minus ${seconds} seconds`)
    assert(parsed.source === 'relative', `${input} should be classified as a relative timestamp`)
  }

  assert(parseTimestampInput('last hour', now).normalized_input === '1h ago', 'last hour should normalize to 1h ago')
  assert(parseTimestampInput('in last 38 mins', now).normalized_input === '38m ago', 'in last 38 mins should normalize to 38m ago')

  console.log('PASS  natural-language time inputs -> past 30 minutes / in the past 1h / in last 38 mins')
}

async function assertEstimatedTimeframeProvenance() {
  const dataset = 'hyperliquid-replica-cmds'
  const window = await resolveTimeframeOrBlocks({ dataset, timeframe: '5m' })
  const estimated = window.estimated_timeframe

  assert(estimated?.resolution === 'estimated', 'Unsupported timestamp endpoint windows should expose estimated timeframe provenance')
  assert(estimated.dataset === dataset, 'Estimated timeframe provenance should include dataset')
  assert(estimated.from_block === window.from_block, 'Estimated timeframe provenance should include from_block')
  assert(estimated.to_block === window.to_block, 'Estimated timeframe provenance should include to_block')
  assert(estimated.estimated_block_time_seconds === 0.083, 'Estimated timeframe provenance should include the block-time estimate')
  assert(estimated.reason === 'timestamp_endpoint_unsupported', 'Estimated timeframe provenance should explain why estimation was used')

  const freshness = buildQueryFreshness({
    finality: 'latest',
    headBlockNumber: window.to_block,
    windowToBlock: window.to_block,
    resolvedWindow: window,
  })
  assert(
    freshness.estimated_timeframe?.reason === 'timestamp_endpoint_unsupported',
    'Query freshness should preserve estimated timeframe provenance',
  )

  const notices = getTimestampWindowNotices(window)
  assert(
    notices.some((notice) => /timeframe block window was estimated/i.test(notice)),
    'Estimated timeframe windows should produce an estimation notice',
  )

  console.log(`PASS  estimated timeframe provenance -> ${window.from_block}..${window.to_block} (${estimated.reason})`)
}

async function main() {
  console.log('Starting timestamp resolver QA...\n')

  assert(detectChainType('tron-mainnet') === 'tron', 'Tron should use its native Portal query type')
  assertNaturalLanguageTimeInputs()
  await assertEstimatedTimeframeProvenance()

  const dataset = 'solana-mainnet'
  const head = await getBlockHead(dataset)
  const headTimestamp = await getHeadTimestamp(dataset, head.number)
  assert(Number.isFinite(headTimestamp) && headTimestamp > 1_000_000_000, 'Solana head timestamp should resolve from block.timestamp')

  const targetTimestamp = headTimestamp - 3600
  const exactFromBlock = await retryPortalProbe(() => timestampToBlock(dataset, targetTimestamp))
  const oneHourWindow = await retryPortalProbe(
    () => resolveTimeframeOrBlocks({ dataset, timeframe: '1h' }),
    (window) => window.from_lookup?.resolution === 'exact',
  )

  assert(oneHourWindow.to_block === head.number, '1h Solana window should anchor to the cached latest slot')
  if (oneHourWindow.from_lookup?.resolution === 'exact') {
    assert(oneHourWindow.from_lookup.timestamp === targetTimestamp, '1h Solana lookup should be anchored to the resolved head timestamp')
    assert(
      Math.abs(oneHourWindow.from_block - exactFromBlock) <= 50,
      '1h Solana timestamp lookup should stay within a small live-index tolerance',
    )
  } else {
    assert(
      oneHourWindow.estimated_timeframe?.resolution === 'estimated',
      'A transient Solana timestamp failure should expose estimated timeframe provenance',
    )
    assert(
      ['timestamp_endpoint_down', 'timestamp_endpoint_unavailable'].includes(oneHourWindow.estimated_timeframe?.reason ?? ''),
      'A transient Solana timestamp fallback should explain why exact resolution was unavailable',
    )
    assert(
      oneHourWindow.estimated_timeframe?.dataset === dataset,
      'A transient Solana timestamp fallback should identify the source dataset',
    )
    assert(
      oneHourWindow.estimated_timeframe?.from_block === oneHourWindow.from_block
        && oneHourWindow.estimated_timeframe?.to_block === oneHourWindow.to_block,
      'A transient Solana timestamp fallback should describe the exact returned block bounds',
    )
  }
  assert(oneHourWindow.from_block < oneHourWindow.to_block, '1h Solana window should produce an ordered slot range')
  console.log(`PASS  Solana 1h window -> ${oneHourWindow.from_block}..${oneHourWindow.to_block}`)

  const nowLookup = await resolveBlockAtTimestamp(dataset, 'now')
  assert(['exact', 'estimated'].includes(nowLookup.resolution), 'Solana "now" lookup should resolve or gracefully estimate from indexed head')
  assert(nowLookup.block_number <= head.number, 'Solana "now" estimate should not exceed indexed head')
  if (nowLookup.resolution === 'estimated') {
    assert(nowLookup.head_timestamp === headTimestamp, 'Solana "now" estimate should use the resolved head timestamp')
  }
  console.log(`PASS  Solana now lookup -> ${nowLookup.block_number} (${nowLookup.resolution})`)

  await assertHyperliquidFillsExactTimestampLookup()

  await assertRealtimeTimestampMatrix()

  console.log('\nTimestamp resolver QA passed')
}

main().catch((error) => {
  console.error('Timestamp resolver QA failed:', error)
  process.exit(1)
})
