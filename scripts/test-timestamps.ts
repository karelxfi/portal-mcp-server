#!/usr/bin/env tsx

import { getBlockHead } from '../dist/cache/datasets.js'
import { getDatasets } from '../dist/cache/datasets.js'
import { getHeadTimestamp, resolveBlockAtTimestamp, resolveTimeframeOrBlocks, timestampToBlock } from '../dist/helpers/timeframe.js'

const REALTIME_MATRIX_CONCURRENCY = 5

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
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

  const rows = await mapLimit(realtimeDatasets, REALTIME_MATRIX_CONCURRENCY, async (dataset) => {
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
  })

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
  const exactProbeBlock = await timestampToBlock(dataset, targetTimestamp)
  const fiveMinuteWindow = await resolveTimeframeOrBlocks({ dataset, timeframe: '5m' })

  assert(fiveMinuteWindow.to_block === head.number, '5m Hyperliquid fills window should anchor to the cached latest block')
  assert(fiveMinuteWindow.from_block < fiveMinuteWindow.to_block, '5m Hyperliquid fills window should produce an ordered block range')
  assert(fiveMinuteWindow.from_lookup?.resolution === 'exact', '5m Hyperliquid fills window should use exact Portal timestamp lookup')
  assert(fiveMinuteWindow.from_lookup.block_number === fiveMinuteWindow.from_block, '5m Hyperliquid fills lookup metadata should match the resolved window')
  assert(exactProbeBlock <= head.number, 'Hyperliquid fills timestamp endpoint should return a block at or before head')

  const directLookup = await resolveBlockAtTimestamp(dataset, targetTimestamp)
  assert(directLookup.resolution === 'exact', 'Hyperliquid fills timestamp lookup should use the exact Portal endpoint')
  assert(directLookup.block_number <= head.number, 'Hyperliquid fills direct lookup should not exceed indexed head')

  console.log(`PASS  Hyperliquid fills 5m window -> ${fiveMinuteWindow.from_block}..${fiveMinuteWindow.to_block} (exact)`)
}

async function main() {
  console.log('Starting timestamp resolver QA...\n')

  const dataset = 'solana-mainnet'
  const head = await getBlockHead(dataset)
  const headTimestamp = await getHeadTimestamp(dataset, head.number)
  assert(Number.isFinite(headTimestamp) && headTimestamp > 1_000_000_000, 'Solana head timestamp should resolve from block.timestamp')

  const targetTimestamp = headTimestamp - 3600
  const exactFromBlock = await timestampToBlock(dataset, targetTimestamp)
  const oneHourWindow = await resolveTimeframeOrBlocks({ dataset, timeframe: '1h' })

  assert(oneHourWindow.to_block === head.number, '1h Solana window should anchor to the cached latest slot')
  assert(oneHourWindow.from_block === exactFromBlock, '1h Solana window should use Portal timestamp lookup from the head timestamp')
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
