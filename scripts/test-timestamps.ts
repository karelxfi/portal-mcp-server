#!/usr/bin/env tsx

import { getBlockHead } from '../dist/cache/datasets.js'
import { getHeadTimestamp, resolveBlockAtTimestamp, resolveTimeframeOrBlocks, timestampToBlock } from '../dist/helpers/timeframe.js'

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
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

  console.log('\nTimestamp resolver QA passed')
}

main().catch((error) => {
  console.error('Timestamp resolver QA failed:', error)
  process.exit(1)
})
