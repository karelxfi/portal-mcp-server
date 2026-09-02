import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { btcToSats, computeBitcoinBlockFees, satsToBtcString, totalBitcoinFees } from './bitcoin-fees.js'

function block(number: number, inputs: [number, number | null][], outputs: [number, number][]) {
  return {
    header: { number, timestamp: 1_700_000_000 + number },
    inputs: inputs.map(([transactionIndex, prevoutValue]) => ({ transactionIndex, prevoutValue })),
    outputs: outputs.map(([transactionIndex, value]) => ({ transactionIndex, value })),
  }
}

describe('satoshi conversion', () => {
  it('is exact in both directions', () => {
    assert.equal(btcToSats('0.00012345'), 12_345n)
    assert.equal(btcToSats(0.1), 10_000_000n)
    assert.equal(btcToSats('1e-8'), 1n)
    assert.equal(btcToSats(null), undefined)
    assert.equal(btcToSats('1.123456789'), undefined)
    assert.equal(satsToBtcString(30_000_003n), '0.30000003')
    assert.equal(satsToBtcString(0n), '0')
    assert.equal(satsToBtcString(-150_000_000n), '-1.5')
  })
})

describe('computeBitcoinBlockFees', () => {
  it('sums non-coinbase inputs minus outputs per block and counts fee-paying transactions', () => {
    const records = [
      block(
        1,
        [
          [0, null],
          [1, 0.5],
          [1, 0.25],
          [2, 1.00000001],
        ],
        [
          [0, 3.13],
          [1, 0.7],
          [1, 0.04],
          [2, 0.99999],
        ],
      ),
      block(
        2,
        [
          [0, null],
          [1, 0.001],
        ],
        [
          [0, 3.125],
          [1, 0.0009],
        ],
      ),
    ]
    const computed = computeBitcoinBlockFees({ inputRecords: records, outputRecords: records })
    assert.deepEqual(computed.excluded_blocks, [])
    assert.equal(computed.blocks.length, 2)
    assert.equal(computed.blocks[0].fee_sats, 1_000_000n + 1_001n)
    assert.equal(computed.blocks[0].transaction_count, 2)
    assert.equal(computed.blocks[1].fee_sats, 10_000n)
    const totals = totalBitcoinFees(computed.blocks)
    assert.equal(totals.total_fee_sats, 1_011_001n)
    assert.equal(totals.transactions, 3)
    assert.equal(totals.avg_fee_per_tx_sats, 1_011_001n / 3n)
    assert.equal(totals.fees_per_block_sats, 1_011_001n / 2n)
  })

  it('excludes blocks missing from one set or with an unknown previous output', () => {
    const inputs = [
      block(
        1,
        [
          [0, null],
          [1, 0.5],
        ],
        [],
      ),
      block(
        2,
        [
          [0, null],
          [1, null],
        ],
        [],
      ),
      block(
        3,
        [
          [0, null],
          [1, 0.2],
        ],
        [],
      ),
    ]
    const outputs = [
      block(
        1,
        [],
        [
          [0, 3.2],
          [1, 0.4],
        ],
      ),
      block(
        2,
        [],
        [
          [0, 3.2],
          [1, 0.1],
        ],
      ),
    ]
    const computed = computeBitcoinBlockFees({ inputRecords: inputs, outputRecords: outputs })
    assert.deepEqual(
      computed.blocks.map((entry) => entry.block_number),
      [1],
    )
    assert.deepEqual(computed.excluded_blocks, [2, 3])
    assert.equal(computed.blocks[0].fee_sats, 10_000_000n)
  })

  it('never reports a negative block fee', () => {
    const records = [
      block(
        9,
        [
          [0, null],
          [1, 0.1],
        ],
        [
          [0, 3.2],
          [1, 0.2],
        ],
      ),
    ]
    const computed = computeBitcoinBlockFees({ inputRecords: records, outputRecords: records })
    assert.equal(computed.blocks[0].fee_sats, 0n)
  })
})
