/* Characterisation tests for wallet-summary.ts. They pin the current
   behaviour of the pure exports on a recorded Portal response so the module
   can be split without changing what a client receives. */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { RECORDED_FIXTURES } from '../../app-ui/fixtures.recorded.js'
import {
  applyWalletSummaryResponseFormat,
  bitcoinValueToSats,
  buildWalletCompleteness,
  formatDecimalAmountExact,
  formatSatsAsBtc,
  parseNumericAmount,
} from './wallet-summary.js'

const recorded = RECORDED_FIXTURES.wallet as Record<string, unknown>

describe('buildWalletCompleteness', () => {
  it('derives one state from window, sections, and cursor', () => {
    assert.equal(buildWalletCompleteness({ hasMore: false, windowComplete: true }).state, 'complete')
    assert.equal(buildWalletCompleteness({ hasMore: true, windowComplete: true }).state, 'cursor_page')
    assert.equal(buildWalletCompleteness({ hasMore: false, windowComplete: false }).state, 'partial_window')
    const failed = buildWalletCompleteness({
      hasMore: false,
      windowComplete: true,
      failedSections: ['assets', 'assets'],
    })
    assert.equal(failed.state, 'section_partial')
    assert.deepEqual(failed.failed_sections, ['assets'])
    assert.equal(failed.result_complete, false)
  })

  it('is complete only when everything is complete', () => {
    const complete = buildWalletCompleteness({ hasMore: false, windowComplete: true })
    assert.equal(complete.result_complete, true)
    assert.equal(complete.page_complete, true)
    assert.equal(buildWalletCompleteness({ hasMore: true, windowComplete: true }).result_complete, false)
  })
})

describe('applyWalletSummaryResponseFormat on a recorded Portal response', () => {
  const activityItems = (payload: Record<string, unknown>) =>
    (payload.activity as { items?: unknown[] } | undefined)?.items

  it('leaves the full and compact shapes intact', () => {
    assert.ok(Array.isArray(activityItems(recorded)) && activityItems(recorded)!.length > 0)
    const full = applyWalletSummaryResponseFormat(recorded, 'full')
    assert.equal(full, recorded)
    const compact = applyWalletSummaryResponseFormat(recorded, 'compact')
    assert.deepEqual(Object.keys(compact), Object.keys(recorded))
    assert.equal(activityItems(compact)?.length, activityItems(recorded)?.length)
  })

  it('drops the activity rows from the summary format but keeps the counts and metadata', () => {
    const summary = applyWalletSummaryResponseFormat(recorded, 'summary')
    assert.deepEqual(Object.keys(summary), Object.keys(recorded))
    assert.equal(activityItems(summary), undefined)
    assert.equal((summary.activity as { count?: unknown }).count, (recorded.activity as { count?: unknown }).count)
    assert.deepEqual(summary._coverage, recorded._coverage)
    assert.deepEqual(summary.completeness, recorded.completeness)
    assert.ok(JSON.stringify(summary).length < JSON.stringify(recorded).length)
  })
})

describe('exact amount helpers', () => {
  it('converts Bitcoin values to satoshis and back without floating point', () => {
    assert.equal(bitcoinValueToSats('0.30000003'), 30_000_003n)
    assert.equal(bitcoinValueToSats(0.1), 10_000_000n)
    assert.equal(formatSatsAsBtc(30_000_003n), '0.30000003')
    assert.throws(() => bitcoinValueToSats('1.123456789'))
  })

  it('formats signed integer token amounts exactly', () => {
    assert.equal(formatDecimalAmountExact(-9_000_000_000n, 18), '-0.000000009')
    assert.equal(formatDecimalAmountExact(1_500_000n, 6), '1.5')
    assert.equal(parseNumericAmount('12.5'), 12.5)
    assert.equal(parseNumericAmount('not a number'), 0)
  })
})
