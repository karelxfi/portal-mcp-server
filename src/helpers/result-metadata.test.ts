import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildAnalysisCoverage,
  buildAnalysisSectionCoverage,
  buildBucketCoverage,
  buildBucketGapDiagnostics,
  buildQueryCoverage,
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
