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

  it('leaves a complete result alone', () => {
    assert.equal(answerOf({ kind: 'query', result_complete: true }), 'Found 3 matches')
  })
})
