import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildAnalysisCoverage,
  buildAnalysisSectionCoverage,
  buildBucketCoverage,
  buildBucketGapDiagnostics,
  buildQueryCoverage,
  buildSectionCoverage,
} from './result-metadata.js'

describe('buildQueryCoverage', () => {
  const items = [{ block: 120 }, { block: 150 }, { block: 130 }]
  const blockOf = (item: { block: number }) => item.block

  it('promises a cursor exactly when more results exist', () => {
    const more = buildQueryCoverage({
      windowFromBlock: 100,
      windowToBlock: 200,
      pageToBlock: 150,
      items,
      getBlockNumber: blockOf,
      hasMore: true,
    })
    assert.equal(more.result_complete, false)
    assert.equal(more.continuation, 'cursor')
    const done = buildQueryCoverage({
      windowFromBlock: 100,
      windowToBlock: 200,
      pageToBlock: 200,
      items,
      getBlockNumber: blockOf,
      hasMore: false,
    })
    assert.equal(done.result_complete, true)
    assert.equal(done.continuation, 'none')
  })

  it('reports the returned block span from the rows, not the window', () => {
    const coverage = buildQueryCoverage({
      windowFromBlock: 100,
      windowToBlock: 200,
      pageToBlock: 150,
      items,
      getBlockNumber: blockOf,
      hasMore: false,
    })
    assert.equal(coverage.returned_from_block, 120)
    assert.equal(coverage.returned_to_block, 150)
    assert.equal(coverage.returned_items, 3)
    const empty = buildQueryCoverage({
      windowFromBlock: 100,
      windowToBlock: 200,
      pageToBlock: 150,
      items: [],
      getBlockNumber: blockOf,
      hasMore: false,
    })
    assert.equal('returned_from_block' in empty, false)
  })
})

describe('buildAnalysisCoverage', () => {
  it('marks a trimmed window sampled and incomplete', () => {
    const coverage = buildAnalysisCoverage({
      windowFromBlock: 1,
      windowToBlock: 300,
      analyzedFromBlock: 101,
      analyzedToBlock: 300,
    })
    assert.equal(coverage.window_complete, false)
    assert.equal(coverage.sampled, true)
    assert.equal(coverage.requested_blocks, 300)
    assert.equal(coverage.analyzed_blocks, 200)
  })

  it('lets a sampled section mark the whole result without breaking the window', () => {
    const section = buildAnalysisSectionCoverage({
      windowFromBlock: 1,
      windowToBlock: 72,
      analyzedFromBlock: 37,
      analyzedToBlock: 72,
    })
    assert.equal(section.analyzed_blocks, 36)
    assert.equal(section.sampled, true)
    const coverage = buildAnalysisCoverage({
      windowFromBlock: 1,
      windowToBlock: 72,
      analyzedFromBlock: 1,
      analyzedToBlock: 72,
      sections: { fees: section },
    })
    assert.equal(coverage.window_complete, true)
    assert.equal(coverage.sampled, true)
    assert.equal(coverage.sections?.fees, section)
    const full = buildAnalysisSectionCoverage({
      windowFromBlock: 1,
      windowToBlock: 6,
      analyzedFromBlock: 1,
      analyzedToBlock: 6,
    })
    assert.equal(full.sampled, false)
    const excluded = buildAnalysisSectionCoverage({
      windowFromBlock: 1,
      windowToBlock: 6,
      analyzedFromBlock: 1,
      analyzedToBlock: 6,
      excludedBlocks: [3],
    })
    assert.equal(excluded.sampled, true)
    assert.equal(excluded.analyzed_blocks, 5)
  })
})

describe('bucket coverage and gap diagnostics', () => {
  const buckets = [0, 1, 2, 3].map((index) => ({
    bucket_index: index,
    timestamp: 1_000 + index * 600,
    filled: index !== 1 && index !== 3,
  }))

  it('counts empty buckets and keeps the anchor', () => {
    const coverage = buildBucketCoverage({
      expectedBuckets: 4,
      returnedBuckets: 4,
      filledBuckets: 2,
      anchor: 'latest_block',
    })
    assert.equal(coverage.empty_buckets, 2)
    assert.equal(coverage.anchor, 'latest_block')
    assert.equal(coverage.window_complete, true)
  })

  it('separates real zero-activity gaps from likely coverage gaps', () => {
    const complete = buildBucketGapDiagnostics({
      buckets,
      intervalSeconds: 600,
      isFilled: (bucket) => bucket.filled,
      anchor: 'latest_block',
      windowComplete: true,
    })
    assert.equal(complete.no_activity_bucket_count, 2)
    assert.equal(complete.coverage_gap_likely_bucket_count, 0)
    const partial = buildBucketGapDiagnostics({
      buckets,
      intervalSeconds: 600,
      isFilled: (bucket) => bucket.filled,
      anchor: 'latest_block',
      windowComplete: false,
      firstObservedTimestamp: 1_000,
      lastObservedTimestamp: 2_200,
    })
    assert.equal(partial.coverage_gap_likely_bucket_count, 1)
    assert.equal(partial.no_activity_bucket_count, 1)
    assert.equal(partial.empty_buckets.find((bucket) => bucket.bucket_index === 3)?.gap_kind, 'coverage_gap_likely')
  })
})

/*
 * A release audit found a wallet summary reporting `_coverage.result_complete:
 * true` beside its own `completeness` object saying false with
 * `failed_sections: ["transactions"]`. The server tells clients to check
 * `_coverage` before claiming completeness, so the field they were told to
 * trust was the one that was wrong.
 */
describe('section coverage never claims complete over missing data', () => {
  const base = {
    windowFromBlock: 100,
    windowToBlock: 200,
    hasMore: false,
    sections: { transactions: { returned: 0, has_more: false } },
  }

  it('is complete when the window was covered and nothing failed', () => {
    const coverage = buildSectionCoverage({ ...base, windowComplete: true })
    assert.equal(coverage.result_complete, true)
    assert.equal(coverage.failed_sections, undefined)
  })

  it('is not complete when a section was asked for and never came back', () => {
    const coverage = buildSectionCoverage({ ...base, windowComplete: true, failedSections: ['transactions'] })
    assert.equal(coverage.result_complete, false)
    assert.deepEqual(coverage.failed_sections, ['transactions'])
  })

  it('is not complete when the window itself was not covered', () => {
    assert.equal(buildSectionCoverage({ ...base, windowComplete: false }).result_complete, false)
  })

  it('is not complete when there is another page', () => {
    assert.equal(buildSectionCoverage({ ...base, hasMore: true, windowComplete: true }).result_complete, false)
  })

  it('does not report the same failed section twice', () => {
    const coverage = buildSectionCoverage({
      ...base,
      windowComplete: true,
      failedSections: ['transactions', 'transactions', 'token_transfers'],
    })
    assert.deepEqual(coverage.failed_sections, ['transactions', 'token_transfers'])
  })
})

/*
 * A scan that stopped short of its window is not the complete result for
 * that window, whatever its row count says. Both builders claimed
 * completeness from pagination alone.
 */
describe('an unread window is not a complete result', () => {
  it('buildQueryCoverage marks a short scan incomplete even with no more rows', () => {
    const coverage = buildQueryCoverage({
      windowFromBlock: 0,
      windowToBlock: 1000,
      pageToBlock: 1000,
      items: [{ block: 990 }],
      getBlockNumber: (item) => item.block,
      hasMore: false,
      windowComplete: false,
    })
    assert.equal(coverage.window_complete, false)
    assert.equal(coverage.result_complete, false)
    assert.equal(coverage.continuation, 'none')
  })

  it('buildAnalysisCoverage does the same for a trimmed analysis', () => {
    const coverage = buildAnalysisCoverage({
      windowFromBlock: 1,
      windowToBlock: 300,
      analyzedFromBlock: 101,
      analyzedToBlock: 300,
    })
    assert.equal(coverage.window_complete, false)
    assert.equal(coverage.result_complete, false)
  })
})
