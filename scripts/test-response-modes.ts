#!/usr/bin/env tsx

import assert from 'node:assert/strict'

import { compactHyperliquidFills } from '../src/helpers/response-modes.js'

const compactFills = compactHyperliquidFills([
  {
    chain_kind: 'hyperliquid',
    record_type: 'fill',
    primary_id: 'fill-1',
    tx_hash: '0xabc',
    sender: '0x1111111111111111111111111111111111111111',
    block_number: 123,
    timestamp_human: '2026-06-22T12:00:00.000Z',
    timestamp: 1782139200000,
    user: '0x1111111111111111111111111111111111111111',
    coin: 'BTC',
    px: 100000,
    sz: 0.25,
    side: 'B',
    dir: 'Open Long',
    fee: 1.2,
    closedPnl: 0,
  },
])

assert.equal(compactFills.length, 1)
const [fill] = compactFills
assert.equal(fill.chain_kind, 'hyperliquid')
assert.equal(fill.record_type, 'fill')
assert.equal(fill.primary_id, 'fill-1')
assert.equal(fill.tx_hash, '0xabc')
assert.equal(fill.sender, '0x1111111111111111111111111111111111111111')
assert.equal(fill.block_number, 123)
assert.equal(fill.timestamp_human, '2026-06-22T12:00:00.000Z')
assert.equal(fill.coin, 'BTC')
assert.equal(fill.px, 100000)
assert.equal(fill.sz, 0.25)

console.log('Response mode tests passed')
