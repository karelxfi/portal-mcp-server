import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildCursorDirectionNotice,
  buildPaginationInfo,
  decodeCursor,
  encodeCursor,
  paginateAscendingItems,
  paginateForwardItems,
} from './pagination.js'

const basePayload = {
  tool: 'portal_evm_query_logs',
  dataset: 'base-mainnet',
  request: { address: ['0xabc'] },
  window_from_block: 100,
  window_to_block: 200,
  page_to_block: 150,
  skip_inclusive_block: 0,
}

describe('signed cursors', () => {
  it('round-trips a payload for the tool that issued it', () => {
    const cursor = encodeCursor(basePayload)
    const decoded = decodeCursor<typeof basePayload & { version: number }>(cursor, 'portal_evm_query_logs')
    assert.equal(decoded.dataset, 'base-mainnet')
    assert.equal(decoded.page_to_block, 150)
    assert.deepEqual(decoded.request, { address: ['0xabc'] })
  })

  it('rejects a tampered signature, a tampered payload, and another tool', () => {
    const cursor = encodeCursor(basePayload)
    assert.throws(() => decodeCursor(`${cursor.slice(0, -2)}zz`, 'portal_evm_query_logs'), /Invalid pagination cursor/)
    const [payload, signature] = cursor.split('.')
    const forged = `${Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), page_to_block: 1 }),
    ).toString('base64url')}.${signature}`
    assert.throws(() => decodeCursor(forged, 'portal_evm_query_logs'), /Invalid pagination cursor/)
    assert.throws(() => decodeCursor(cursor, 'portal_evm_query_transactions'), /Invalid pagination cursor/)
    assert.throws(() => decodeCursor('not-a-cursor', 'portal_evm_query_logs'), /Invalid pagination cursor/)
  })
})

describe('paginateAscendingItems', () => {
  const items = (blocks: number[]) => blocks.map((block, index) => ({ block, index }))
  const blockOf = (item: { block: number }) => item.block

  it('returns the newest page and a boundary that resumes before it', () => {
    const page = paginateAscendingItems(items([1, 2, 3, 4, 5]), 2, blockOf)
    assert.deepEqual(
      page.pageItems.map((item) => item.block),
      [4, 5],
    )
    assert.equal(page.hasMore, true)
    assert.equal(page.nextBoundary?.page_to_block, 4)
  })

  it('accumulates the same-block offset so dense blocks never repeat rows', () => {
    const dense = items([7, 7, 7, 7, 7])
    const first = paginateAscendingItems(dense, 2, blockOf)
    assert.equal(first.nextBoundary?.page_to_block, 7)
    assert.equal(first.nextBoundary?.skip_inclusive_block, 2)
    const second = paginateAscendingItems(dense, 2, blockOf, first.nextBoundary)
    assert.equal(second.pageItems.length, 2)
    assert.equal(second.nextBoundary?.skip_inclusive_block, 4)
    const third = paginateAscendingItems(dense, 2, blockOf, second.nextBoundary)
    assert.equal(third.pageItems.length, 1)
    assert.equal(third.hasMore, false)
    assert.equal(third.nextBoundary, undefined)
  })

  it('reports has_more only when a cursor exists', () => {
    assert.equal(buildPaginationInfo(10, 3).has_more, false)
    const info = buildPaginationInfo(10, 10, 'cursor', { continuationScope: 'adjacent_window' })
    assert.equal(info.has_more, true)
    assert.equal(info.continuation_scope, 'adjacent_window')
  })
})

describe('paginateForwardItems', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7]

  it('pages an oldest-first scan by offset and points the cursor at the window end', () => {
    const first = paginateForwardItems(rows, 3, 0, 900)
    assert.deepEqual(first.pageItems, [1, 2, 3])
    assert.equal(first.hasMore, true)
    assert.deepEqual(first.nextBoundary, { page_to_block: 900, skip_inclusive_block: 3 })

    const second = paginateForwardItems(rows, 3, 3, 900)
    assert.deepEqual(second.pageItems, [4, 5, 6])
    assert.deepEqual(second.nextBoundary, { page_to_block: 900, skip_inclusive_block: 6 })

    const third = paginateForwardItems(rows, 3, 6, 900)
    assert.deepEqual(third.pageItems, [7])
    assert.equal(third.hasMore, false)
    assert.equal(third.nextBoundary, undefined)
  })

  it('has no more rows when the collection ends exactly at the page', () => {
    const page = paginateForwardItems(rows.slice(0, 3), 3, 0, 900)
    assert.equal(page.hasMore, false)
    assert.equal(page.nextBoundary, undefined)
  })
})

describe('buildCursorDirectionNotice', () => {
  it('says which way the cursor leads', () => {
    assert.match(buildCursorDirectionNotice('earliest'), /^Newer results/)
    assert.match(buildCursorDirectionNotice('latest'), /^Older results/)
  })
})
