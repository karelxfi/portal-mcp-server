import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { applyResponseFormat, summarizeBitcoinOutputs, summarizeHyperliquidFills } from './response-modes.js'

/**
 * Normalized Hyperliquid fills carry exact decimal amounts as text, the shape
 * `normalizeHyperliquidFillResult` produces. The summary aggregates have to
 * treat those strings as numbers.
 */
const NORMALIZED_FILLS = [
  {
    chain_kind: 'hyperliquid',
    record_type: 'fill',
    user: '0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00',
    coin: 'BTC',
    px: '95000.0',
    sz: '0.1',
    side: 'A',
    dir: 'Close Long',
    fee: '0.95',
    closedPnl: '12.5',
    block_number: 750000007,
  },
  {
    chain_kind: 'hyperliquid',
    record_type: 'fill',
    user: '0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00',
    coin: 'BTC',
    px: '95100.0',
    sz: '0.2',
    side: 'B',
    dir: 'Open Long',
    fee: '-1.9',
    closedPnl: '-2.5',
    block_number: 750000007,
  },
  {
    chain_kind: 'hyperliquid',
    record_type: 'fill',
    user: '0x1111111111111111111111111111111111111111',
    coin: 'ETH',
    px: '3000.0',
    sz: '1.0',
    side: 'A',
    dir: 'Close Long',
    fee: '3',
    block_number: 750000007,
  },
]

describe('summarizeHyperliquidFills', () => {
  it('aggregates exact decimal text without throwing', () => {
    const summary = summarizeHyperliquidFills(NORMALIZED_FILLS)

    assert.equal(summary.total_fills, 3)
    assert.equal(summary.unique_traders, 2)
    assert.equal(summary.unique_coins, 2)
    // 95000 * 0.1 + 95100 * 0.2 + 3000 * 1
    assert.equal(summary.total_volume_usd, 31520)
    // absolute fees: 0.95 + 1.9 + 3
    assert.equal(summary.total_fees_usd, 5.85)
    // 12.5 - 2.5, with the third fill carrying no closedPnl
    assert.equal(summary.total_realized_pnl, 10)
    assert.deepEqual(summary.direction_breakdown, { 'Close Long': 2, 'Open Long': 1 })
    assert.deepEqual(summary.top_coins_by_volume, [
      { coin: 'BTC', volume_usd: 28520 },
      { coin: 'ETH', volume_usd: 3000 },
    ])
  })

  it('returns finite aggregates when amounts are missing or unparseable', () => {
    const summary = summarizeHyperliquidFills([
      { coin: 'BTC', px: 'n/a', sz: '1.0', fee: undefined, closedPnl: '' },
      { coin: 'BTC', px: '100', sz: '2', fee: '0.5', closedPnl: '1.25' },
    ])

    assert.equal(summary.total_volume_usd, 200)
    assert.equal(summary.total_fees_usd, 0.5)
    assert.equal(summary.total_realized_pnl, 1.25)
    assert.equal(Number.isFinite(summary.total_realized_pnl), true)
  })

  it('reports an empty page instead of aggregates', () => {
    assert.deepEqual(summarizeHyperliquidFills([]), { count: 0, summary: 'No fills found' })
  })
})

describe('applyResponseFormat', () => {
  it("returns fill aggregates rather than rows for 'summary'", () => {
    const result = applyResponseFormat(NORMALIZED_FILLS, 'summary', 'hyperliquid_fills')

    assert.equal(Array.isArray(result), false)
    assert.equal(result.total_fills, 3)
    assert.equal(result.total_volume_usd, 31520)
  })

  it("keeps the trading essentials for 'compact'", () => {
    const result = applyResponseFormat(NORMALIZED_FILLS, 'compact', 'hyperliquid_fills')

    assert.equal(Array.isArray(result), true)
    assert.equal(result.length, 3)
    assert.equal(result[0].coin, 'BTC')
    assert.equal(result[0].closedPnl, '12.5')
  })
})

describe('summarizeBitcoinOutputs', () => {
  it('sums decimal-text output values', () => {
    const summary = summarizeBitcoinOutputs([
      { scriptPubKeyAddress: 'bc1qexampleone', scriptPubKeyType: 'v0_p2wpkh', value: '0.5' },
      { scriptPubKeyAddress: 'bc1qexampletwo', scriptPubKeyType: 'v0_p2wpkh', value: '0.25' },
    ])

    assert.equal(summary.total_value_btc, 0.75)
    assert.equal(summary.unique_addresses, 2)
  })
})
