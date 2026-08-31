#!/usr/bin/env tsx

import {
  buildBitcoinBlockFields,
  buildBitcoinTransactionFields,
  buildEvmBlockFields,
  buildEvmLogFields,
  buildEvmTransactionFields,
  buildSolanaTransactionFields,
  buildSubstrateBlockFields,
  buildSubstrateEventFields,
} from '../src/helpers/fields.ts'
import {
  EXACT_DECIMAL_ZERO,
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  formatExactDecimal,
  multiplyExactDecimals,
  parseExactDecimal,
} from '../src/helpers/exact-decimal.ts'
import {
  assert,
  assertChatSurface,
  callToolWithRetry,
  closeTestClient,
  connectTestClient,
} from './test-helpers.ts'

const PORTAL = 'https://portal.sqd.dev'
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const ERC20_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const BASE_FIXTURE_BLOCK = 50_343_299
const ETH_TYPE_ONE_BLOCK = 12_244_145
const ETH_TYPE_ONE_HASH = '0x851bad0415758075a1eb86776749c829b866d43179c57c3e4a4b9359a0358231'
const POLKADOT_FROM = 30_736_840
const POLKADOT_TO = 30_736_842

type JsonRecord = Record<string, any>

async function fetchNdjson(dataset: string, body: JsonRecord): Promise<JsonRecord[]> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${PORTAL}/datasets/${dataset}/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Portal HTTP ${response.status}: ${text.slice(0, 300)}`)
      }
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JsonRecord)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
  }
  throw lastError ?? new Error(`Portal request failed for ${dataset}`)
}

function flatten(blocks: JsonRecord[], key: string): JsonRecord[] {
  return blocks.flatMap((block) => {
    const number = block.number ?? block.header?.number
    const timestamp = block.timestamp ?? block.header?.timestamp
    return (block[key] ?? []).map((item: JsonRecord) => ({
      ...item,
      ...(number !== undefined ? { block_number: number } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
    }))
  })
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function assertEqualSet(actual: string[], expected: string[], label: string) {
  const left = [...actual].sort()
  const right = [...expected].sort()
  assert(left.length === right.length, `${label} count mismatch: MCP ${left.length}, Portal ${right.length}`)
  const actualSet = new Set(left)
  const expectedSet = new Set(right)
  const missing = right.filter((item) => !actualSet.has(item)).slice(0, 5)
  const extra = left.filter((item) => !expectedSet.has(item)).slice(0, 5)
  assert(
    stable(left) === stable(right),
    `${label} identity set differs from direct Portal data; missing=${stable(missing)} extra=${stable(extra)}`,
  )
}

function assertComplete(data: JsonRecord, label: string, count: number) {
  assertChatSurface(data, label)
  assert(data._coverage?.window_complete === true, `${label} should cover the full requested window`)
  assert(data._coverage?.result_complete === true, `${label} should return every matching row`)
  assert(data._pagination?.has_more === false, `${label} should not hide another result page`)
  assert(data._coverage?.returned_items === count, `${label} coverage count should equal the returned row count`)
}

async function main() {
  console.log('Starting authoritative MCP data-integrity tests...\n')
  const connected = await connectTestClient('data-integrity-runner')
  const { client } = connected

  const call = async (name: string, args: JsonRecord) => {
    const result = await callToolWithRetry(client, name, args, { retries: 2, totalBudgetMs: 120_000 })
    assert(!result.isError, `${name} should succeed: ${result.text.slice(0, 240)}`)
    assert(result.data && typeof result.data === 'object', `${name} should return structured data`)
    return result.data as JsonRecord
  }

  try {
    const directLogs = flatten(
      await fetchNdjson('base-mainnet', {
        type: 'evm',
        fromBlock: BASE_FIXTURE_BLOCK,
        toBlock: BASE_FIXTURE_BLOCK,
        fields: { block: buildEvmBlockFields(), log: buildEvmLogFields() },
        logs: [{ address: [BASE_USDC], topic0: [ERC20_TRANSFER] }],
      }),
      'logs',
    )
    assert(directLogs.length === 54, 'Base fixture should still contain 54 USDC Transfer logs')
    const pagedLogs: JsonRecord[] = []
    let logCursor: string | undefined
    let logPage = 0
    let finalLogPage: JsonRecord | undefined
    do {
      const logData = await call(
        'portal_evm_query_logs',
        logCursor
          ? { cursor: logCursor }
          : {
              network: 'base-mainnet',
              from_block: BASE_FIXTURE_BLOCK,
              to_block: BASE_FIXTURE_BLOCK,
              addresses: [BASE_USDC],
              topic0: [ERC20_TRANSFER],
              field_preset: 'minimal',
              response_format: 'compact',
              limit: 10,
            },
      )
      assertChatSurface(logData, `Base USDC logs page ${logPage + 1}`)
      assert(
        logData._coverage?.returned_items === logData.items.length,
        `Base USDC logs page ${logPage + 1} should report its exact row count`,
      )
      pagedLogs.push(...logData.items)
      finalLogPage = logData
      logCursor = logData._pagination?.has_more ? logData._pagination.next_cursor : undefined
      logPage += 1
      assert(logPage <= 10, 'Base log pagination should terminate')
    } while (logCursor)
    assertEqualSet(
      pagedLogs.map((item: JsonRecord) => item.primary_id),
      directLogs.map((item) => `${item.transactionHash}:${item.logIndex}`),
      'Base USDC logs',
    )
    assert(finalLogPage?._coverage?.window_complete === true, 'Final Base log page should cover the source window')
    assert(finalLogPage?._coverage?.result_complete === true, 'Final Base log page should exhaust remaining results')
    const sampleTopicOne = directLogs[0]?.topics?.[1]
    assert(typeof sampleTopicOne === 'string', 'Base fixture should expose an indexed sender topic')
    const directLogSample = directLogs.filter((item) => item.topics?.[1] === sampleTopicOne)
    const logSampleData = await call('portal_evm_query_logs', {
      network: 'base-mainnet',
      from_block: BASE_FIXTURE_BLOCK,
      to_block: BASE_FIXTURE_BLOCK,
      addresses: [BASE_USDC],
      topic0: [ERC20_TRANSFER],
      topic1: [sampleTopicOne],
      field_preset: 'full',
      response_format: 'full',
      limit: 20,
    })
    assertEqualSet(
      logSampleData.items.map((item: JsonRecord) => `${item.transactionHash}:${item.logIndex}`),
      directLogSample.map((item) => `${item.transactionHash}:${item.logIndex}`),
      'Base USDC log payload sample',
    )
    for (const item of logSampleData.items as JsonRecord[]) {
      const source = directLogSample.find(
        (row) => row.transactionHash === item.transactionHash && row.logIndex === item.logIndex,
      )
      assert(source?.address === item.address, 'Base log address should match direct Portal data')
      assert(stable(source?.topics) === stable(item.topics), 'Base log topics should match direct Portal data')
      assert(source?.data === item.data, 'Base log data should match direct Portal data')
    }
    assertComplete(logSampleData, 'Base USDC log payload sample', directLogSample.length)
    console.log(`PASS  Base EVM logs: all ${directLogs.length} identities and exact sampled payloads match Portal`)

    const directTypeOne = flatten(
      await fetchNdjson('ethereum-mainnet', {
        type: 'evm',
        fromBlock: ETH_TYPE_ONE_BLOCK,
        toBlock: ETH_TYPE_ONE_BLOCK,
        fields: { block: buildEvmBlockFields(), transaction: buildEvmTransactionFields() },
        transactions: [{}],
      }),
      'transactions',
    ).filter((item) => Number(item.type) === 1)
    const txData = await call('portal_evm_query_transactions', {
      network: 'ethereum-mainnet',
      from_block: ETH_TYPE_ONE_BLOCK,
      to_block: ETH_TYPE_ONE_BLOCK,
      transaction_type: '0x1',
      scan_order: 'earliest',
      field_preset: 'full',
      response_format: 'full',
      limit: 25,
    })
    assert(directTypeOne.length === 1, 'Ethereum type-1 fixture should contain exactly one transaction')
    assert(directTypeOne[0]?.hash === ETH_TYPE_ONE_HASH, 'Direct Portal data should retain the known type-1 hash')
    assertEqualSet(
      txData.items.map((item: JsonRecord) => item.hash),
      directTypeOne.map((item) => item.hash),
      'Ethereum type-1 transactions',
    )
    assert(txData.items[0]?.transactionIndex === 14, 'MCP should retain the factual transaction index')
    assert(txData.items[0]?.from === directTypeOne[0]?.from, 'MCP sender should match direct Portal data')
    assert(txData.items[0]?.to === directTypeOne[0]?.to, 'MCP recipient should match direct Portal data')
    assertComplete(txData, 'Ethereum type-1 transactions', directTypeOne.length)
    console.log('PASS  Ethereum EVM transaction: exact identity, index, sender, and recipient match Portal')

    const directFailedTransactions = flatten(
      await fetchNdjson('base-mainnet', {
        type: 'evm',
        fromBlock: BASE_FIXTURE_BLOCK,
        toBlock: BASE_FIXTURE_BLOCK,
        fields: { block: buildEvmBlockFields(), transaction: buildEvmTransactionFields() },
        transactions: [{}],
      }),
      'transactions',
    ).filter((item) => Number(item.status) === 0)
    const pagedFailedTransactions: JsonRecord[] = []
    let transactionCursor: string | undefined
    let transactionPage = 0
    let finalTransactionPage: JsonRecord | undefined
    do {
      const page = await call(
        'portal_evm_query_transactions',
        transactionCursor
          ? { cursor: transactionCursor }
          : {
              network: 'base-mainnet',
              from_block: BASE_FIXTURE_BLOCK,
              to_block: BASE_FIXTURE_BLOCK,
              transaction_status: 'failed',
              scan_order: 'earliest',
              field_preset: 'standard',
              response_format: 'full',
              limit: 3,
            },
      )
      assertChatSurface(page, `Base failed transactions page ${transactionPage + 1}`)
      pagedFailedTransactions.push(...page.items)
      finalTransactionPage = page
      transactionCursor = page._pagination?.has_more ? page._pagination.next_cursor : undefined
      transactionPage += 1
      assert(transactionPage <= 5, 'Base failed-transaction pagination should terminate')
    } while (transactionCursor)
    assert(directFailedTransactions.length === 8, 'Base fixture should still contain 8 failed transactions')
    assertEqualSet(
      pagedFailedTransactions.map((item) => item.hash),
      directFailedTransactions.map((item) => item.hash),
      'Base failed transactions',
    )
    assert(
      pagedFailedTransactions.every((item) => Number(item.status) === 0),
      'Every paged Base transaction should retain failed status',
    )
    assert(finalTransactionPage?._coverage?.window_complete === true, 'Final Base transaction page should cover the window')
    assert(finalTransactionPage?._coverage?.result_complete === true, 'Final Base transaction page should exhaust matches')
    console.log('PASS  Base EVM scan pagination: all 8 failed transactions match Portal without gaps or duplicates')

    const directBitcoin = flatten(
      await fetchNdjson('bitcoin-mainnet', {
        type: 'bitcoin',
        fromBlock: 170,
        toBlock: 170,
        fields: { block: buildBitcoinBlockFields(), transaction: buildBitcoinTransactionFields() },
        transactions: [{}],
      }),
      'transactions',
    )
    const bitcoinData = await call('portal_bitcoin_query_transactions', {
      network: 'bitcoin-mainnet',
      from_block: 170,
      to_block: 170,
      response_format: 'full',
      limit: 25,
    })
    assertEqualSet(
      bitcoinData.items.map((item: JsonRecord) => item.txid),
      directBitcoin.map((item) => item.txid),
      'Bitcoin block 170 transactions',
    )
    for (const item of bitcoinData.items as JsonRecord[]) {
      const source = directBitcoin.find((row) => row.txid === item.txid)
      assert(source?.transactionIndex === item.transactionIndex, 'Bitcoin transaction index should match Portal')
      assert(source?.hash === item.hash, 'Bitcoin witness hash should match Portal')
    }
    assertComplete(bitcoinData, 'Bitcoin block 170 transactions', directBitcoin.length)
    console.log(`PASS  Bitcoin block 170: all ${directBitcoin.length} transactions and hashes match Portal`)

    const directEvents = flatten(
      await fetchNdjson('polkadot', {
        type: 'substrate',
        fromBlock: POLKADOT_FROM,
        toBlock: POLKADOT_TO,
        fields: { block: buildSubstrateBlockFields(), event: buildSubstrateEventFields() },
        events: [{}],
      }),
      'events',
    )
    const pagedEvents: JsonRecord[] = []
    let substrateCursor: string | undefined
    let substratePage = 0
    let finalSubstratePage: JsonRecord | undefined
    do {
      const page = await call(
        'portal_substrate_query_events',
        substrateCursor
          ? { cursor: substrateCursor }
          : {
              network: 'polkadot',
              from_block: POLKADOT_FROM,
              to_block: POLKADOT_TO,
              response_format: 'compact',
              limit: 10,
            },
      )
      assertChatSurface(page, `Polkadot events page ${substratePage + 1}`)
      pagedEvents.push(...page.items)
      finalSubstratePage = page
      substrateCursor = page._pagination?.has_more ? page._pagination.next_cursor : undefined
      substratePage += 1
      assert(substratePage <= 25, 'Polkadot event pagination should terminate')
    } while (substrateCursor)
    assertEqualSet(
      pagedEvents.map((item: JsonRecord) => item.primary_id),
      directEvents.map((item) => `${item.block_number}:${item.index}`),
      'Polkadot events',
    )
    for (const item of pagedEvents) {
      const source = directEvents.find((row) => `${row.block_number}:${row.index}` === item.primary_id)
      assert(source?.name === item.event_name, 'Polkadot event name should match Portal')
    }
    assert(finalSubstratePage?._coverage?.window_complete === true, 'Final Polkadot page should cover the source window')
    assert(finalSubstratePage?._coverage?.result_complete === true, 'Final Polkadot page should exhaust results')
    const eventCounts = new Map<string, number>()
    for (const event of directEvents) eventCounts.set(event.name, (eventCounts.get(event.name) ?? 0) + 1)
    const rareEventName = [...eventCounts.entries()].sort((left, right) => left[1] - right[1])[0]?.[0]
    assert(typeof rareEventName === 'string', 'Polkadot fixture should expose an event name')
    const directEventSample = directEvents.filter((event) => event.name === rareEventName)
    const substrateSample = await call('portal_substrate_query_events', {
      network: 'polkadot',
      from_block: POLKADOT_FROM,
      to_block: POLKADOT_TO,
      event_names: [rareEventName],
      response_format: 'full',
      limit: 10,
    })
    assertEqualSet(
      substrateSample.items.map((item: JsonRecord) => item.primary_id),
      directEventSample.map((item) => `${item.block_number}:${item.index}`),
      'Polkadot event payload sample',
    )
    for (const item of substrateSample.items as JsonRecord[]) {
      const source = directEventSample.find((row) => `${row.block_number}:${row.index}` === item.primary_id)
      assert(source?.name === item.name, 'Polkadot sampled event name should match Portal')
      assert(stable(source?.args) === stable(item.args), 'Polkadot sampled event arguments should match Portal')
    }
    assertComplete(substrateSample, 'Polkadot event payload sample', directEventSample.length)
    console.log(`PASS  Polkadot events: all ${directEvents.length} identities and names, plus exact sampled arguments, match Portal`)

    const solanaHeadData = await call('portal_get_head', { network: 'solana-mainnet' })
    const solanaHead = Number(solanaHeadData.number)
    assert(Number.isFinite(solanaHead), 'Solana head should be numeric')
    const solanaFrom = solanaHead - 8
    const directSolanaWindow = flatten(
      await fetchNdjson('solana-mainnet', {
        type: 'solana',
        fromBlock: solanaFrom,
        toBlock: solanaHead,
        fields: {
          block: { number: true, hash: true, timestamp: true },
          transaction: buildSolanaTransactionFields(),
        },
        transactions: [{}],
      }),
      'transactions',
    )
    assert(directSolanaWindow.length > 0, 'Recent Solana fixture window should contain transactions')
    const payerCounts = new Map<string, number>()
    for (const item of directSolanaWindow) {
      if (typeof item.feePayer === 'string') payerCounts.set(item.feePayer, (payerCounts.get(item.feePayer) ?? 0) + 1)
    }
    const payer = [...payerCounts.entries()].sort((left, right) => left[1] - right[1])[0]?.[0]
    assert(typeof payer === 'string', 'Recent Solana data should expose a fee payer')
    const directSolana = flatten(
      await fetchNdjson('solana-mainnet', {
        type: 'solana',
        fromBlock: solanaFrom,
        toBlock: solanaHead,
        fields: {
          block: { number: true, hash: true, timestamp: true },
          transaction: buildSolanaTransactionFields(),
        },
        transactions: [{ feePayer: [payer] }],
      }),
      'transactions',
    )
    assert(directSolana.length > 0 && directSolana.length <= 200, 'Chosen Solana payer should have a bounded result set')
    const solanaData = await call('portal_solana_query_transactions', {
      network: 'solana-mainnet',
      from_block: solanaFrom,
      to_block: solanaHead,
      fee_payer: [payer],
      response_format: 'full',
      limit: 25,
    })
    const signature = (item: JsonRecord) => item.signatures?.[0]
    assertEqualSet(
      solanaData.items.map(signature),
      directSolana.map(signature),
      'Solana fee-payer transactions',
    )
    for (const item of solanaData.items as JsonRecord[]) {
      const source = directSolana.find((row) => signature(row) === signature(item))
      assert(source?.feePayer === item.feePayer, 'Solana fee payer should match Portal')
      assert(source?.fee === item.fee, 'Solana fee should match Portal')
      assert(stable(source?.err) === stable(item.err), 'Solana execution result should match Portal')
    }
    assertComplete(solanaData, 'Solana fee-payer transactions', directSolana.length)
    console.log(`PASS  Solana live window at ${solanaHead}: ${directSolana.length} exact transactions match Portal`)

    const ohlcData = await call('portal_hyperliquid_get_ohlc', {
      network: 'hyperliquid-fills',
      coin: 'BTC',
      duration: '5m',
      interval: '1m',
    })
    assertChatSurface(ohlcData, 'Hyperliquid BTC OHLC')
    const summary = ohlcData.summary as JsonRecord
    const directFills = flatten(
      await fetchNdjson('hyperliquid-fills', {
        type: 'hyperliquidFills',
        fromBlock: summary.from_block,
        toBlock: summary.to_block,
        fields: {
          block: { number: true, timestamp: true },
          fill: { time: true, fillIndex: true, px: true, sz: true },
        },
        fills: [{ coin: ['BTC'] }],
      }),
      'fills',
    )
      .map((fill) => ({ ...fill, time_seconds: Math.floor(Number(fill.time) / (Number(fill.time) > 1e12 ? 1000 : 1)) }))
      .filter(
        (fill) =>
          fill.time_seconds >= summary.requested_window_start_timestamp &&
          fill.time_seconds < summary.requested_window_end_exclusive &&
          Number(fill.px) > 0 &&
          Number(fill.sz) > 0,
      )
      .sort((left, right) => Number(left.time) - Number(right.time) || Number(left.fillIndex) - Number(right.fillIndex))
    const expectedCandles = (ohlcData.ohlc as JsonRecord[]).map((candle) => {
      const fills = directFills.filter(
        (fill) => fill.time_seconds >= candle.timestamp && fill.time_seconds < candle.timestamp + 60,
      )
      const prices = fills.map((fill) => parseExactDecimal(fill.px)!).filter(Boolean)
      const sizes = fills.map((fill) => parseExactDecimal(fill.sz)!).filter(Boolean)
      const notional = fills.reduce((sum, fill) => {
        const price = parseExactDecimal(fill.px)
        const size = parseExactDecimal(fill.sz)
        return price && size ? addExactDecimals(sum, multiplyExactDecimals(price, size)) : sum
      }, EXACT_DECIMAL_ZERO)
      const baseVolume = sizes.reduce((sum, size) => addExactDecimals(sum, size), EXACT_DECIMAL_ZERO)
      const high = prices.reduce((best, price) => compareExactDecimals(price, best) > 0 ? price : best, prices[0])
      const low = prices.reduce((best, price) => compareExactDecimals(price, best) < 0 ? price : best, prices[0])
      const vwap = divideExactDecimals(notional, baseVolume, 18)
      return {
        timestamp: candle.timestamp,
        open: prices.length ? formatExactDecimal(prices[0]) : null,
        high: prices.length ? formatExactDecimal(high) : null,
        low: prices.length ? formatExactDecimal(low) : null,
        close: prices.length ? formatExactDecimal(prices.at(-1)!) : null,
        volume: formatExactDecimal(notional),
        base_volume: formatExactDecimal(baseVolume),
        fill_count: fills.length,
        vwap: vwap.value,
      }
    })
    for (const expected of expectedCandles) {
      const actual = ohlcData.ohlc.find((candle: JsonRecord) => candle.timestamp === expected.timestamp)
      for (const key of ['open', 'high', 'low', 'close', 'volume', 'base_volume', 'fill_count', 'vwap']) {
        assert(actual?.[key] === expected[key], `Hyperliquid candle ${expected.timestamp} ${key} should match raw fills`)
      }
    }
    assert(
      Number(summary.total_fills) === directFills.length,
      'Hyperliquid OHLC summary fill count should match the complete raw fill window',
    )
    assert(ohlcData._coverage?.window_complete === true, 'Hyperliquid OHLC should prove full source-window coverage')
    console.log(`PASS  Hyperliquid BTC OHLC: ${directFills.length} raw fills reproduce every candle and summary count`)

    console.log('\nAuthoritative data-integrity tests passed.')
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
