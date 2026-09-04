import assert from 'node:assert/strict'
import { test } from 'node:test'

import { accumulateFill, createFillAccumulator } from './analytics.js'

/*
 * The fee sign is the point of this file. Hyperliquid charges a taker fee and
 * pays a maker rebate, and a rebate arrives as a negative `fee`. Summing the
 * absolute values turns a market that paid rebates out into one that collected
 * fees, which is not an imprecise number but the wrong sign on a real one. The
 * fills summary was fixed for this and the analytics tool was not, because its
 * copy of the arithmetic sat inside a streaming callback that only a live
 * Portal window could reach. It is a plain function now, so the sign is held
 * here rather than by whoever next reads that loop.
 */

const fill = (over: Record<string, unknown> = {}) => ({
  user: '0xaaaa000000000000000000000000000000000001',
  coin: 'BTC',
  px: '100',
  sz: '2',
  dir: 'Open Long',
  fee: '0.5',
  closedPnl: '0',
  ...over,
})

test('a maker rebate lowers the fee total instead of raising it', () => {
  const totals = createFillAccumulator()
  accumulateFill(totals, fill({ fee: '0.95' }))
  accumulateFill(totals, fill({ fee: '-1.9' }))
  accumulateFill(totals, fill({ fee: '3' }))

  assert.equal(Number(totals.totalFees.toFixed(2)), 2.05)
  assert.equal(Number(totals.coinData.get('BTC')?.fees.toFixed(2)), 2.05)
})

test('a market that only paid rebates reports a negative fee total', () => {
  const totals = createFillAccumulator()
  accumulateFill(totals, fill({ fee: '-0.4' }))
  accumulateFill(totals, fill({ fee: '-0.6' }))

  assert.equal(Number(totals.totalFees.toFixed(2)), -1)
  assert.ok(totals.totalFees < 0, 'rebates must not be reported as fees paid')
})

test('realized PnL keeps its sign too', () => {
  const totals = createFillAccumulator()
  accumulateFill(totals, fill({ closedPnl: '120.5' }))
  accumulateFill(totals, fill({ closedPnl: '-200' }))

  assert.equal(Number(totals.totalPnl.toFixed(2)), -79.5)
})

test('volume, fills, traders and coins accumulate across fills', () => {
  const totals = createFillAccumulator()
  accumulateFill(totals, fill({ px: '100', sz: '2' }))
  accumulateFill(totals, fill({ user: '0xbbbb000000000000000000000000000000000002', coin: 'ETH', px: '50', sz: '3' }))
  accumulateFill(totals, fill({ px: '10', sz: '1' }))

  assert.equal(totals.totalFills, 3)
  assert.equal(totals.totalVolume, 360)
  assert.equal(totals.traders.size, 2)
  assert.deepEqual([...totals.allCoins].sort(), ['BTC', 'ETH'])
  assert.equal(totals.coinData.get('BTC')?.fills, 2)
  assert.equal(totals.coinData.get('ETH')?.volume, 150)
  assert.equal(totals.traderData.get('0xbbbb000000000000000000000000000000000002')?.coins.size, 1)
})

test('a liquidation is counted once, by direction, with its notional', () => {
  const totals = createFillAccumulator()
  accumulateFill(totals, fill({ dir: 'Long > Short', px: '100', sz: '4' }))
  accumulateFill(totals, fill({ dir: 'Short > Long', px: '100', sz: '1' }))
  accumulateFill(totals, fill({ dir: 'Open Short' }))

  assert.equal(totals.liquidationCount, 2)
  assert.equal(totals.liquidationVolume, 500)
  assert.equal(totals.dirCounts['Open Short'], 1)
  assert.equal(totals.coinData.get('BTC')?.shorts, 1)
  assert.equal(totals.coinData.get('BTC')?.longs, 0)
})

test('a fill missing its fields is counted, not dropped or turned into NaN', () => {
  const totals = createFillAccumulator()
  accumulateFill(totals, {})

  assert.equal(totals.totalFills, 1)
  assert.equal(totals.totalVolume, 0)
  assert.equal(totals.totalFees, 0)
  assert.equal(totals.traders.size, 0, 'a fill with no user adds no trader')
  assert.deepEqual([...totals.allCoins], ['unknown'])
  assert.equal(totals.dirCounts.Unknown, 1)
})
