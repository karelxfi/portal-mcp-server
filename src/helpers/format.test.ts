import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatResult } from './format.js'

function answerOf(coverage: Record<string, unknown>, message = 'Found 3 matches'): string {
  const result = formatResult({ items: [] }, message, { toolName: 'portal_test', coverage })
  return String((result.structuredContent as Record<string, unknown>).answer ?? '')
}

describe('incomplete results say how to get the rest', () => {
  it('points at the cursor when there is a cursor to continue from', () => {
    assert.equal(
      answerOf({ kind: 'query', result_complete: false }),
      'Found 3 matches Preview page: continue with the cursor for remaining rows.',
    )
  })

  it('does not send the caller after a cursor that does not exist', () => {
    // A ranked list cut to `limit` is incomplete with nothing to continue
    // from. Naming a cursor here points at a field the response never carries.
    const answer = answerOf({ kind: 'entity_resolution', result_complete: false, continuation: 'none' })

    assert.equal(answer.includes('cursor'), false)
    assert.equal(answer, 'Found 3 matches Preview page: raise the limit or narrow the query for the remaining rows.')
  })

  it('adds nothing when the answer already states the truncation', () => {
    assert.equal(
      answerOf(
        { kind: 'entity_resolution', result_complete: false, continuation: 'none' },
        'Resolved to 58 matches, showing the best 3',
      ),
      'Resolved to 58 matches, showing the best 3',
    )
  })

  it('does not offer to raise a limit that truncated nothing', () => {
    // A bounded candidate search returns an incomplete result without having
    // cut anything, so "raise the limit" is advice that would not help.
    const answer = answerOf(
      { kind: 'entity_resolution', result_complete: false, continuation: 'none', candidate_search: 'bounded' },
      'Resolved "WETH/USDC" to 2 pool matches from a bounded search',
    )

    assert.equal(answer, 'Resolved "WETH/USDC" to 2 pool matches from a bounded search')
    assert.equal(answer.includes('raise the limit'), false)
    assert.equal(answer.includes('cursor'), false)
  })

  it('leaves a complete result alone', () => {
    assert.equal(answerOf({ kind: 'query', result_complete: true }), 'Found 3 matches')
  })
})

describe('an estimated window boundary downgrades every block that reports completeness', () => {
  const estimatedFreshness = {
    kind: 'block_window',
    finality: 'latest',
    timestamp_bounds: {
      from: { resolution: 'estimated' },
      to: { resolution: 'verified_boundary' },
    },
  }
  const exactFreshness = {
    kind: 'block_window',
    finality: 'latest',
    timestamp_bounds: {
      from: { resolution: 'verified_boundary' },
      to: { resolution: 'verified_boundary' },
    },
  }
  const payload = () => ({
    gap_diagnostics: { kind: 'bucket_gap_diagnostics', window_complete: true, empty_bucket_count: 2 },
  })
  const coverage = {
    kind: 'bucket_window' as const,
    window_complete: true,
    result_complete: true,
    expected_buckets: 10,
    returned_buckets: 10,
    filled_buckets: 8,
    empty_buckets: 2,
    anchor: 'latest_block' as const,
  }
  const parse = (result: { content: { type: string; text?: string }[] }) =>
    JSON.parse(
      result.content
        .map((part) => part.text)
        .filter(Boolean)
        .join('\n'),
    ) as Record<string, any>

  it('downgrades the gap diagnostics alongside _coverage', () => {
    /* A Bitcoin fee series shipped `_coverage.window_complete: false` beside
       `gap_diagnostics.window_complete: true`, which reads as the response
       contradicting itself. */
    const parsed = parse(formatResult(payload(), 'Bitcoin fees', { coverage, freshness: estimatedFreshness }))

    assert.equal(parsed._coverage.window_complete, false)
    assert.equal(parsed.gap_diagnostics.window_complete, false)
  })

  it('leaves both alone when the boundary is verified', () => {
    const parsed = parse(formatResult(payload(), 'Bitcoin fees', { coverage, freshness: exactFreshness }))

    assert.equal(parsed._coverage.window_complete, true)
    assert.equal(parsed.gap_diagnostics.window_complete, true)
  })

  it('never upgrades a window the diagnostics already called incomplete', () => {
    const already = { gap_diagnostics: { kind: 'bucket_gap_diagnostics', window_complete: false } }
    const parsed = parse(formatResult(already, 'Bitcoin fees', { coverage, freshness: exactFreshness }))

    assert.equal(parsed.gap_diagnostics.window_complete, false)
  })
})
