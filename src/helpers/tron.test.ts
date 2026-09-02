import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TronInputError,
  decodeTronHexText,
  describeTronAddress,
  encodeTronAssetFilter,
  normalizeTronAddress,
  normalizeTronTopic,
  parseTronAddress,
  sunToTrx,
  tronBase58ToHex,
  tronHexToBase58,
  tronMillisToSeconds,
} from './tron.js'

const USDT_BASE58 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const USDT_HEX41 = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c'
const USDT_LOG = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c'

describe('tron addresses', () => {
  it('round-trips Base58Check and the 41-prefixed hex form', () => {
    assert.equal(tronBase58ToHex(USDT_BASE58), USDT_HEX41)
    assert.equal(tronHexToBase58(USDT_HEX41), USDT_BASE58)
  })

  it('accepts every input form and produces every Portal form', () => {
    for (const input of [
      USDT_BASE58,
      USDT_HEX41,
      `0x${USDT_HEX41}`,
      USDT_LOG,
      `0x${USDT_LOG}`,
      USDT_HEX41.toUpperCase(),
    ]) {
      assert.equal(parseTronAddress(input), USDT_HEX41, input)
      assert.equal(normalizeTronAddress(input, 'transaction'), USDT_HEX41)
      assert.equal(normalizeTronAddress(input, 'log'), USDT_LOG)
      assert.equal(normalizeTronAddress(input, 'topic'), `000000000000000000000000${USDT_LOG}`)
      assert.equal(normalizeTronAddress(input, 'base58'), USDT_BASE58)
    }
  })

  it('rejects a wrong checksum, wrong length, and non-hex input with a fix', () => {
    const wrongChecksum = `${USDT_BASE58.slice(0, -1)}u`
    assert.throws(
      () => parseTronAddress(wrongChecksum),
      (error: unknown) => {
        assert.ok(error instanceof TronInputError)
        assert.match(error.message, /checksum/)
        return true
      },
    )
    assert.throws(() => parseTronAddress('41abcd'), TronInputError)
    assert.throws(() => parseTronAddress('0xZZ'), TronInputError)
    assert.throws(() => parseTronAddress('TExampleAddress'), TronInputError)
  })

  it('describes Portal address values in both forms', () => {
    assert.deepEqual(describeTronAddress(USDT_HEX41), { hex: USDT_HEX41, base58: USDT_BASE58 })
    assert.deepEqual(describeTronAddress(USDT_LOG), { hex: USDT_HEX41, base58: USDT_BASE58 })
    assert.equal(describeTronAddress('nope'), undefined)
  })

  it('normalizes topics from hashes and addresses', () => {
    const transfer = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    assert.equal(normalizeTronTopic(`0x${transfer}`, 'topic0'), transfer)
    assert.equal(normalizeTronTopic(USDT_BASE58, 'topic1'), `000000000000000000000000${USDT_LOG}`)
    assert.throws(() => normalizeTronTopic('0x1234', 'topic1'), TronInputError)
  })
})

describe('tron units', () => {
  it('converts millisecond timestamps and leaves seconds alone', () => {
    assert.equal(tronMillisToSeconds(1782669669000), 1782669669)
    assert.equal(tronMillisToSeconds('1782669669'), 1782669669)
    assert.equal(tronMillisToSeconds(0), undefined)
  })

  it('converts SUN to exact TRX', () => {
    assert.equal(sunToTrx('378000000'), '378')
    assert.equal(sunToTrx(344998), '0.344998')
    assert.equal(sunToTrx('1'), '0.000001')
    assert.equal(sunToTrx('abc'), undefined)
  })

  it('decodes hex text and encodes TRC-10 asset filters', () => {
    assert.equal(decodeTronHexText('63616c6c'), 'call')
    assert.equal(decodeTronHexText('31303035313537'), '1005157')
    assert.equal(encodeTronAssetFilter('1005157'), '31303035313537')
    assert.equal(encodeTronAssetFilter('31303035313537'), '31303035313537')
  })
})
