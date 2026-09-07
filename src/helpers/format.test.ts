import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatResult } from './format.js'
import { buildPaginationInfo } from './pagination.js'

type PayloadOptions = {
  cursor?: string
  scope?: 'remaining_results' | 'adjacent_window'
  notices?: string[]
}

function payloadOf(
  coverage: Record<string, unknown>,
  message = 'Found 3 matches',
  options: PayloadOptions = {},
): Record<string, any> {
  const result = formatResult({ items: [] }, message, {
    toolName: 'portal_test',
    coverage,
    ...(options.notices ? { notices: options.notices } : {}),
    pagination: buildPaginationInfo(
      3,
      3,
      options.cursor,
      options.scope ? { continuationScope: options.scope } : undefined,
    ),
  })
  return result.structuredContent as Record<string, any>
}

function answerOf(coverage: Record<string, unknown>, message = 'Found 3 matches', cursor?: string): string {
  return String(payloadOf(coverage, message, { cursor }).answer ?? '')
}

describe('incomplete results say how to get the rest', () => {
  it('points at the cursor when there is a cursor to continue from', () => {
    assert.equal(
      answerOf({ kind: 'query', result_complete: false }, 'Found 3 matches', 'cursor-token'),
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

/*
 * The cursor is the fact and continuation is the claim about it. Three tools
 * claimed 'cursor' on pages that carried none and one claimed 'none' beside a
 * cursor, so the formatter derives the claim from the pagination block and
 * the answer follows the same source.
 */
describe('coverage continuation follows the cursor', () => {
  it('withdraws a claimed cursor when the page carries none', () => {
    const payload = payloadOf({
      kind: 'block_window',
      window_complete: true,
      result_complete: false,
      continuation: 'cursor',
    })
    assert.equal(payload._pagination.has_more, false)
    assert.equal(payload._pagination.next_cursor, undefined)
    assert.equal(payload._coverage.continuation, 'none')
    assert.equal(payload._coverage.result_complete, false)
    assert.equal(payload.answer.includes('cursor'), false)
    assert.match(payload.answer, /raise the limit/)
  })

  it('makes a page with a remaining-rows cursor incomplete and continuable', () => {
    const payload = payloadOf(
      { kind: 'block_window', window_complete: true, result_complete: true, continuation: 'none' },
      'Found 3 matches',
      { cursor: 'cursor-token' },
    )
    assert.equal(payload._pagination.has_more, true)
    assert.equal(payload._coverage.result_complete, false)
    assert.equal(payload._coverage.continuation, 'cursor')
    assert.match(payload.answer, /continue with the cursor/)
  })

  it('leaves an adjacent-window cursor out of the window claim', () => {
    const payload = payloadOf(
      { kind: 'block_window', window_complete: true, result_complete: true, continuation: 'none' },
      'Found 3 matches',
      { cursor: 'cursor-token', scope: 'adjacent_window' },
    )
    assert.equal(payload._pagination.has_more, true)
    assert.equal(payload._coverage.result_complete, true)
    assert.equal(payload._coverage.continuation, 'none')
    assert.equal(payload.answer, 'Found 3 matches')
  })

  it('names the unread window even when a cursor continues the rows', () => {
    /* window_complete is the only field that says blocks went unread, so an
       answer that mentions only the cursor hides it. Six tools shipped that
       way and the live quality gate caught every one. */
    const payload = payloadOf(
      { kind: 'block_window', window_complete: false, result_complete: false, continuation: 'cursor' },
      'Found 3 matches',
      {
        cursor: 'cursor-token',
        notices: [
          'Trace scan searched only blocks 10-20 of requested window 0-20; narrow filters or raise max_scan_blocks for deeper coverage.',
        ],
      },
    )
    assert.match(payload.answer, /Partial window: Trace scan searched only blocks 10-20/)
    assert.match(payload.answer, /continue with the cursor/)
  })

  it('offers the scan bound rather than a bigger limit when the window went unread', () => {
    const payload = payloadOf({
      kind: 'block_window',
      window_complete: false,
      result_complete: false,
      continuation: 'none',
    })
    assert.match(payload.answer, /Partial window:/)
    assert.match(payload.answer, /raise max_scan_blocks/)
    assert.equal(payload.answer.includes('raise the limit'), false)
  })

  it('names the unread window when nothing continues it', () => {
    const payload = payloadOf(
      { kind: 'block_window', window_complete: false, result_complete: false, continuation: 'cursor' },
      'Found 3 matches',
      {
        notices: [
          'Deployment search searched only blocks 10-20 of requested window 0-20; narrow filters or raise max_scan_blocks for deeper coverage.',
        ],
      },
    )
    assert.equal(payload._coverage.continuation, 'none')
    assert.match(payload.answer, /^Found 3 matches Partial window: Deployment search searched only blocks 10-20/)
    assert.equal(payload.answer.includes('raise the limit'), false)
    assert.equal(payload.answer.includes('cursor'), false)
  })

  it('leaves coverage without a completeness claim alone', () => {
    const payload = payloadOf({ kind: 'not_applicable' })
    assert.deepEqual(payload._coverage, { kind: 'not_applicable' })
  })
})
