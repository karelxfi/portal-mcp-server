#!/usr/bin/env tsx

import {
  normalizeBitcoinInputResult,
  normalizeBitcoinOutputResult,
  normalizeHyperliquidFillResult,
  normalizeSolanaInstructionResult,
  normalizeSubstrateCallResult,
} from '../dist/helpers/normalized-results.js'
import { assertUniqueNormalizedIds } from '../dist/helpers/format.js'
import { formatTokenUnitsExact } from '../dist/tools/evm/ohlc.js'
import {
  applyWalletSummaryResponseFormat,
  bitcoinValueToSats,
  formatSatsAsBtc,
} from '../dist/tools/convenience/wallet-summary.js'
import { callToolWithRetry, closeTestClient, connectTestClient } from './test-helpers.js'
import {
  isValidBitcoinAddress,
  isValidTronAddress,
  normalizeBitcoinAddressForPortal,
} from '../dist/helpers/validation.js'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function assertIdentityRegressions() {
  const solanaA = normalizeSolanaInstructionResult({
    block_number: 442966262,
    transactionIndex: 397,
    instructionAddress: [7],
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  })
  const solanaB = normalizeSolanaInstructionResult({
    block_number: 442966262,
    transactionIndex: 410,
    instructionAddress: [7],
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  })
  assert(solanaA.primary_id !== solanaB.primary_id, 'Solana instructions in different transactions must have different IDs')

  const substrateA = normalizeSubstrateCallResult({
    block_number: 32784199,
    extrinsicIndex: 0,
    address: [],
    name: 'Timestamp.set',
  })
  const substrateB = normalizeSubstrateCallResult({
    block_number: 32784199,
    extrinsicIndex: 1,
    address: [],
    name: 'ParaInherent.enter',
  })
  assert(substrateA.primary_id !== substrateB.primary_id, 'Root Substrate calls in different extrinsics must have different IDs')

  const zeroHash = `0x${'0'.repeat(64)}`
  const fillA = normalizeHyperliquidFillResult({ hash: zeroHash, block_number: 100, fillIndex: 2, user: '0xa' })
  const fillB = normalizeHyperliquidFillResult({ hash: zeroHash, block_number: 101, fillIndex: 2, user: '0xb' })
  assert(fillA.primary_id !== fillB.primary_id, 'Zero-hash Hyperliquid fills in different blocks must have different IDs')
  assert(fillA.tx_hash === undefined, 'Placeholder Hyperliquid hashes must not be exposed as transaction hashes')

  const input = normalizeBitcoinInputResult({ txid: 'btc-tx', inputIndex: 0 })
  const output = normalizeBitcoinOutputResult({ txid: 'btc-tx', outputIndex: 0 })
  assert(input.primary_id !== output.primary_id, 'Bitcoin input and output IDs must occupy separate namespaces')

  const ids = [solanaA, solanaB, substrateA, substrateB, fillA, fillB, input, output].map((row) => row.primary_id)
  assert(ids.every((id) => typeof id === 'string' && id.length > 0), 'Every normalized regression row needs an ID')
  assert(new Set(ids).size === ids.length, 'Regression IDs must be unique')
}

function assertGeneratedIdentityProperties() {
  const solanaRows = Array.from({ length: 10_000 }, (_, index) =>
    normalizeSolanaInstructionResult({
      block_number: 500_000 + Math.floor(index / 250),
      transactionIndex: index % 250,
      instructionAddress: [index % 7, Math.floor(index / 1750)],
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    }),
  )
  const substrateRows = Array.from({ length: 10_000 }, (_, index) =>
    normalizeSubstrateCallResult({
      block_number: 30_000_000 + Math.floor(index / 100),
      extrinsicIndex: index % 100,
      address: [index % 5, Math.floor(index / 500)],
      name: `Module.call_${index % 17}`,
    }),
  )
  const hyperliquidRows = Array.from({ length: 10_000 }, (_, index) =>
    normalizeHyperliquidFillResult({
      hash: `0x${'0'.repeat(64)}`,
      block_number: 1_000_000 + Math.floor(index / 100),
      fillIndex: index % 100,
      user: `0x${index.toString(16).padStart(40, '0')}`,
    }),
  )
  const bitcoinRows = Array.from({ length: 10_000 }, (_, index) =>
    index % 2 === 0
      ? normalizeBitcoinInputResult({ txid: `btc-${Math.floor(index / 2)}`, inputIndex: index % 7 })
      : normalizeBitcoinOutputResult({ txid: `btc-${Math.floor(index / 2)}`, outputIndex: index % 11 }),
  )

  for (const [family, rows] of [
    ['Solana', solanaRows],
    ['Substrate', substrateRows],
    ['Hyperliquid', hyperliquidRows],
    ['Bitcoin', bitcoinRows],
  ] as const) {
    const ids = rows.map((row) => row.primary_id)
    assert(new Set(ids).size === rows.length, `${family}: 10,000 generated normalized rows must have unique IDs`)
    assertUniqueNormalizedIds(rows)
  }

  let duplicateRejected = false
  try {
    assertUniqueNormalizedIds([
      { chain_kind: 'bitcoin', record_type: 'input', primary_id: 'same' },
      { chain_kind: 'bitcoin', record_type: 'input', primary_id: 'same' },
    ])
  } catch {
    duplicateRejected = true
  }
  assert(duplicateRejected, 'runtime identity sentinel must reject duplicate IDs')

  let missingRejected = false
  try {
    assertUniqueNormalizedIds([
      { chain_kind: 'solana', record_type: 'instruction', primary_id: 'present' },
      { chain_kind: 'solana', record_type: 'instruction' },
    ])
  } catch {
    missingRejected = true
  }
  assert(missingRejected, 'runtime identity sentinel must reject normalized rows without IDs')
}

function assertExactAssetQuantities() {
  assert(formatTokenUnitsExact(43_841_943_497_649_594_000n) === '43841943497649594000', 'large raw volume must stay exact')
  assert(formatTokenUnitsExact(385_902n, 8) === '0.00385902', 'BTC quantity must convert exactly')
  assert(formatTokenUnitsExact(1_230_000n, 6) === '1.23', 'decimal output must trim only insignificant zeros')
  const btcSats = bitcoinValueToSats('0.10000001') + bitcoinValueToSats('0.20000002')
  assert(btcSats === 30_000_003n, 'Bitcoin wallet totals must sum in exact satoshis')
  assert(formatSatsAsBtc(btcSats) === '0.30000003', 'exact satoshis must round-trip to BTC without floating point')
}

function assertChecksumValidation() {
  assert(isValidBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), 'known Bitcoin mainnet address must pass checksum validation')
  assert(!isValidBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb'), 'corrupted Bitcoin checksum must fail')
  assert(!isValidBitcoinAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'), 'Bitcoin testnet addresses must fail on the mainnet dataset')
  assert(
    normalizeBitcoinAddressForPortal('BC1QEXAMPLE') === 'bc1qexample',
    'uppercase bech32 addresses must be normalized before Portal filtering',
  )
  assert(isValidTronAddress('TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'), 'known Tron base58check address must pass')
  assert(!isValidTronAddress('TJRabPrwbZy45sbavfcjinPJC18kjpRTv9'), 'corrupted Tron checksum must fail')
}

function assertCompactWalletIsLossless() {
  const items = Array.from({ length: 20 }, (_, index) => ({ primary_id: `row-${index}` }))
  const compact = applyWalletSummaryResponseFormat({ activity: { count: items.length, items } }, 'compact') as {
    activity: { count: number; items: Array<{ primary_id: string }> }
  }
  assert(compact.activity.count === 20, 'compact wallet count must describe the page rows')
  assert(compact.activity.items.length === 20, 'compact wallet must not discard rows that the cursor skips')
}

function decimalToScaled(value: string, scale: number): bigint {
  const [integer, fraction = ''] = value.split('.')
  return BigInt(`${integer}${fraction.padEnd(scale, '0')}`)
}

function sumDecimalStrings(values: string[]): string {
  const scale = Math.max(0, ...values.map((value) => value.split('.')[1]?.length ?? 0))
  const total = values.reduce((sum, value) => sum + decimalToScaled(value, scale), 0n)
  return formatTokenUnitsExact(total, scale)
}

function assertNoUnsafeIntegers(value: unknown, path = '$'): void {
  if (typeof value === 'number' && Number.isInteger(value)) {
    assert(Number.isSafeInteger(value), `${path} must not expose an unsafe JSON integer`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoUnsafeIntegers(entry, `${path}[${index}]`))
    return
  }
  if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, entry]) => assertNoUnsafeIntegers(entry, `${path}.${key}`))
  }
}

async function assertLiveAggregateAndOhlcParity() {
  const connected = await connectTestClient('v084-factuality')
  try {
    const invalidBitcoinFilter = await callToolWithRetry(connected.client, 'portal_get_recent_activity', {
      network: 'bitcoin',
      timeframe: '10',
      from_addresses: ['0xZZinvalid!!'],
      limit: 5,
    }, { retries: 0 })
    assert(invalidBitcoinFilter.isError, 'Bitcoin sender filters must fail instead of becoming unfiltered queries')
    assert(invalidBitcoinFilter.structuredContent?.error?.code === 'invalid_request', 'Bitcoin filter failure must be structured')

    const invalidSolanaProgram = await callToolWithRetry(connected.client, 'portal_solana_query_instructions', {
      network: 'solana',
      timeframe: '1m',
      program_id: ['notbase58!!!'],
      limit: 5,
    }, { retries: 0 })
    assert(invalidSolanaProgram.isError, 'invalid Solana program IDs must fail before a data query')
    assert(invalidSolanaProgram.structuredContent?.error?.code === 'invalid_request', 'Solana filter failure must be structured')

    const invalidWallet = await callToolWithRetry(connected.client, 'portal_get_wallet_summary', {
      network: 'bitcoin',
      address: 'not-a-bitcoin-address',
      timeframe: '10',
    }, { retries: 0 })
    assert(invalidWallet.isError, 'invalid Bitcoin wallet addresses must fail')
    assert(invalidWallet.structuredContent?.error?.code === 'invalid_request', 'wallet validation failure must be structured')

    const rejectedWalletPage = await callToolWithRetry(connected.client, 'portal_get_wallet_summary', {
      network: 'base',
      address: '0x0000000000000000000000000000000000000001',
      timeframe: '10',
      limit_per_type: 6,
    }, { retries: 0 })
    assert(rejectedWalletPage.isError, 'wallet pages above the verified response budget must be rejected before querying')
    assert(rejectedWalletPage.text.includes('expected number to be <=5'), 'wallet page admission must report the verified maximum')

    const solanaHead = await callToolWithRetry(connected.client, 'portal_get_head', { network: 'solana-mainnet' }, { retries: 2 })
    assert(!solanaHead.isError && typeof solanaHead.data?.number === 'number', 'Solana head fixture must resolve')
    const solanaFixture = await callToolWithRetry(connected.client, 'portal_solana_query_transactions', {
      network: 'solana-mainnet',
      from_block: solanaHead.data.number - 20,
      to_block: solanaHead.data.number,
      limit: 1,
    }, { retries: 2 })
    assert(!solanaFixture.isError, `Solana wallet fixture must resolve: ${solanaFixture.text.slice(0, 240)}`)
    const solanaAddress = String(solanaFixture.data?.items?.[0]?.feePayer ?? solanaFixture.data?.items?.[0]?.sender ?? '')
    assert(solanaAddress.length > 20, 'Solana wallet fixture must expose a fee payer')

    const hyperliquidFixture = await callToolWithRetry(connected.client, 'portal_hyperliquid_query_fills', {
      network: 'hyperliquid-fills',
      timeframe: '5m',
      limit: 1,
    }, { retries: 2 })
    assert(!hyperliquidFixture.isError, `Hyperliquid wallet fixture must resolve: ${hyperliquidFixture.text.slice(0, 240)}`)
    const hyperliquidAddress = String(hyperliquidFixture.data?.items?.[0]?.user ?? '')
    assert(hyperliquidAddress.startsWith('0x'), 'Hyperliquid wallet fixture must expose a user')

    for (const [network, address, timeframe] of [
      ['solana-mainnet', solanaAddress, '1h'],
      ['hyperliquid-fills', hyperliquidAddress, '5m'],
    ] as const) {
      const first = await callToolWithRetry(connected.client, 'portal_get_wallet_summary', {
        network,
        address,
        timeframe,
        limit_per_type: 5,
      }, { retries: 3, totalBudgetMs: 90_000 })
      assert(!first.isError, `${network} wallet page must succeed: ${first.text.slice(0, 240)}`)
      assert(Buffer.byteLength(first.text, 'utf8') <= 50_000, `${network} wallet page must fit the 50 KB contract`)
      const firstItems = first.data?.activity?.items ?? []
      assert(firstItems.length > 0 && firstItems.length <= 5, `${network} wallet page must honor the accepted maximum`)
      const cursor = first.data?._pagination?.next_cursor
      if (network === 'hyperliquid-fills') {
        assert(typeof cursor === 'string', `${network} active wallet fixture must provide a continuation cursor`)
      }
      if (typeof cursor !== 'string') {
        assert(first.data?._pagination?.has_more === false, `${network} cursor absence must mean the result is exhausted`)
        continue
      }
      assert(firstItems.length === 5, `${network} continued wallet page must fill the requested page before continuing`)

      const second = await callToolWithRetry(
        connected.client,
        'portal_get_wallet_summary',
        { cursor },
        { retries: 3, totalBudgetMs: 90_000 },
      )
      assert(!second.isError, `${network} wallet continuation must succeed: ${second.text.slice(0, 240)}`)
      assert(Buffer.byteLength(second.text, 'utf8') <= 50_000, `${network} continued wallet page must fit the 50 KB contract`)
      assert(
        second.data?.activity?.items?.length > 0 && second.data?.activity?.items?.length <= 5,
        `${network} continued wallet page must honor the accepted maximum`,
      )
      const firstIds = new Set(firstItems.map((row: any) => row.primary_id))
      assert(
        (second.data?.activity?.items ?? []).every((row: any) => !firstIds.has(row.primary_id)),
        `${network} wallet continuation must not duplicate prior rows`,
      )
    }

    const analytics = await callToolWithRetry(connected.client, 'portal_evm_get_analytics', {
      network: 'base',
      num_blocks: 2,
      limit: 10,
      mode: 'deep',
    })
    assert(!analytics.isError, `live EVM analytics must succeed: ${analytics.text.slice(0, 300)}`)
    const analyticsData = analytics.data as any
    const fromBlock = analyticsData.overview.from_block
    const toBlock = analyticsData.overview.to_block
    const directResponse = await fetch('https://portal.sqd.dev/datasets/base-mainnet/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'evm',
        fromBlock,
        toBlock,
        fields: { block: { number: true }, transaction: { to: true, hash: true } },
        transactions: [{}],
      }),
    })
    assert(directResponse.ok, `direct Portal EVM parity request must succeed (${directResponse.status})`)
    const directText = await directResponse.text()
    const directRows = directText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const directTransactions = directRows.flatMap((row) => row.transactions ?? [])
    assert(
      analyticsData.overview.total_transactions === directTransactions.length,
      `EVM analytics total ${analyticsData.overview.total_transactions} must equal direct Portal ${directTransactions.length}`,
    )

    const ohlcResult = await callToolWithRetry(connected.client, 'portal_evm_get_ohlc', {
      network: 'base',
      pool_address: '0xd0b53d9277642d899df5c87a3966a349a798f224',
      source: 'uniswap_v3_swap',
      duration: '15m',
      interval: '5m',
      mode: 'deep',
      price_in: 'auto',
      include_recent_trades: true,
      recent_trades_limit: 5,
    }, { retries: 1, totalBudgetMs: 60_000 })
    assert(!ohlcResult.isError, `live EVM OHLC must succeed: ${ohlcResult.text.slice(0, 300)}`)
    const ohlcData = ohlcResult.data as any
    const candles = ohlcData.ohlc as Array<{ base_volume: string; quote_volume: string; sample_count: number }>
    assert(
      ohlcData.summary.total_samples === candles.reduce((sum, candle) => sum + candle.sample_count, 0),
      'OHLC summary sample count must equal returned candles',
    )
    assert(
      String(ohlcData.summary.total_base_volume) === sumDecimalStrings(candles.map((candle) => String(candle.base_volume))),
      'OHLC base volume must equal returned candles exactly',
    )
    assert(
      String(ohlcData.summary.total_quote_volume) === sumDecimalStrings(candles.map((candle) => String(candle.quote_volume))),
      'OHLC quote volume must equal returned candles exactly',
    )
    assertNoUnsafeIntegers(ohlcData)
  } finally {
    await closeTestClient(connected)
  }
}

async function main() {
  assertIdentityRegressions()
  assertGeneratedIdentityProperties()
  assertExactAssetQuantities()
  assertChecksumValidation()
  assertCompactWalletIsLossless()
  await assertLiveAggregateAndOhlcParity()
  console.log('PASS  v0.8.4 factuality invariants (40,000 generated records plus live Portal parity)')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
