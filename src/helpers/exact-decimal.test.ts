import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  formatExactDecimal,
  formatIntegerUnitsExact,
  multiplyExactDecimals,
  parseExactDecimal,
} from './exact-decimal.js'

describe('parseExactDecimal and formatExactDecimal', () => {
  it('keeps digits a double would lose', () => {
    const large = parseExactDecimal('43841943497649594000.000000000000000001')
    assert.ok(large)
    assert.equal(formatExactDecimal(large), '43841943497649594000.000000000000000001')
    assert.equal(formatExactDecimal(parseExactDecimal('9007199254740993')!), '9007199254740993')
  })

  it('normalises exponent notation and trailing zeros', () => {
    assert.equal(formatExactDecimal(parseExactDecimal('9.0000e-9')!), '0.000000009')
    assert.equal(formatExactDecimal(parseExactDecimal('1.50')!), '1.5')
    assert.equal(formatExactDecimal(parseExactDecimal(0.25)!), '0.25')
    assert.equal(formatExactDecimal(parseExactDecimal(12n)!), '12')
  })

  it('rejects hostile or non-numeric input before allocating', () => {
    assert.equal(parseExactDecimal('1e100000'), undefined)
    assert.equal(parseExactDecimal('abc'), undefined)
    assert.equal(parseExactDecimal(null), undefined)
    assert.equal(parseExactDecimal(Number.NaN), undefined)
  })
})

describe('exact arithmetic', () => {
  const tiny = parseExactDecimal('0.000000009')!
  const two = parseExactDecimal('2')!

  it('adds and multiplies tiny non-zero amounts exactly', () => {
    assert.equal(formatExactDecimal(addExactDecimals(tiny, tiny)), '0.000000018')
    assert.equal(formatExactDecimal(multiplyExactDecimals(tiny, two)), '0.000000018')
    assert.equal(
      formatExactDecimal(multiplyExactDecimals(parseExactDecimal('0.1')!, parseExactDecimal('0.2')!)),
      '0.02',
    )
  })

  it('compares by value, not by string', () => {
    assert.equal(compareExactDecimals(parseExactDecimal('-0.000000009')!, tiny) < 0, true)
    assert.equal(compareExactDecimals(parseExactDecimal('1.0')!, parseExactDecimal('1')!), 0)
    assert.equal(compareExactDecimals(parseExactDecimal('10')!, parseExactDecimal('9.99')!) > 0, true)
  })

  it('divides with a declared scale and flags rounding', () => {
    const exact = divideExactDecimals(parseExactDecimal('1')!, parseExactDecimal('4')!, 18)
    assert.equal(exact.value, '0.25')
    assert.equal(exact.rounded, false)
    const rounded = divideExactDecimals(parseExactDecimal('1')!, parseExactDecimal('3')!, 6)
    assert.equal(rounded.value, '0.333333')
    assert.equal(rounded.rounded, true)
  })

  it('converts integer token units exactly', () => {
    assert.equal(formatIntegerUnitsExact(43_841_943_497_649_594_000n, 0), '43841943497649594000')
    assert.equal(formatIntegerUnitsExact(385_902n, 8), '0.00385902')
    assert.equal(formatIntegerUnitsExact(-9_000_000_000n, 18), '-0.000000009')
  })
})
