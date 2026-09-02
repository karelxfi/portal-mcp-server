import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  describeTimeWindowInput,
  parseTimeframeToSeconds,
  parseTimestampInput,
  timeframeToBlocks,
} from './timeframe.js'

const NOW = 1_700_000_000

describe('parseTimeframeToSeconds', () => {
  it('parses compact windows', () => {
    assert.equal(parseTimeframeToSeconds('30m'), 1_800)
    assert.equal(parseTimeframeToSeconds('2h'), 7_200)
    assert.equal(parseTimeframeToSeconds('1d'), 86_400)
    assert.equal(parseTimeframeToSeconds('7d'), 604_800)
    assert.equal(parseTimeframeToSeconds('90s'), 90)
  })

  it('rejects input that is not a window', () => {
    assert.throws(() => parseTimeframeToSeconds('soon'))
    assert.throws(() => parseTimeframeToSeconds(''))
  })
})

describe('parseTimestampInput', () => {
  it('reads natural-language relative windows as the same instant', () => {
    for (const input of ['30m', 'past 30 minutes', '30 minutes ago']) {
      assert.deepEqual(parseTimestampInput(input, NOW), {
        timestamp: NOW - 1_800,
        source: 'relative',
        normalized_input: '30m ago',
      })
    }
    assert.deepEqual(parseTimestampInput('in last 38 mins', NOW), {
      timestamp: NOW - 38 * 60,
      source: 'relative',
      normalized_input: '38m ago',
    })
  })

  it('tells unix seconds from milliseconds and keeps ISO datetimes exact', () => {
    assert.equal(parseTimestampInput(1_700_000_000_000, NOW).source, 'unix_milliseconds')
    assert.equal(parseTimestampInput(1_700_000_000_000, NOW).timestamp, 1_700_000_000)
    assert.equal(parseTimestampInput(1_700_000_000, NOW).source, 'unix_seconds')
    assert.deepEqual(parseTimestampInput('2026-01-01T00:00:00Z', NOW), {
      timestamp: 1_767_225_600,
      source: 'iso_datetime',
      normalized_input: '2026-01-01T00:00:00.000Z',
    })
    assert.equal(parseTimestampInput('now', NOW).timestamp, NOW)
  })

  it('never returns a negative instant and rejects empty input', () => {
    assert.equal(parseTimestampInput('100 years ago', NOW).timestamp >= 0, true)
    assert.throws(() => parseTimestampInput('   ', NOW), /Timestamp cannot be empty/)
  })
})

describe('describeTimeWindowInput and timeframeToBlocks', () => {
  it('describes windows the way a person wrote them', () => {
    assert.equal(describeTimeWindowInput('30m'), 'last 30m')
    assert.equal(describeTimeWindowInput('past 30 minutes'), 'the past 30 minutes')
  })

  it('estimates blocks from the chain block time', () => {
    assert.equal(timeframeToBlocks('1h', 'bitcoin-mainnet'), 6)
    assert.equal(timeframeToBlocks('1h', 'ethereum-mainnet'), 300)
    assert.equal(timeframeToBlocks('2h', 'bitcoin-mainnet'), 2 * timeframeToBlocks('1h', 'bitcoin-mainnet'))
  })
})
