import { formatTimestamp } from './format.js'
import type { BlockAtTimestampResult, EstimatedTimeframeResolution, ResolvedBlockWindow } from './timeframe.js'

type TimestampBoundarySummary = Pick<BlockAtTimestampResult, 'timestamp' | 'resolution' | 'block_number'> &
  Partial<
    Pick<
      BlockAtTimestampResult,
      | 'timestamp_human'
      | 'normalized_input'
      | 'block_timestamp'
      | 'block_timestamp_human'
      | 'timestamp_delta_seconds'
      | 'boundary'
    >
  >

export interface QueryFreshness {
  kind: 'query_window'
  finality: 'latest' | 'finalized'
  range_kind: string
  indexed_head_block: number
  window_to_block: number
  lag_blocks: number
  timestamp_bounds?: {
    from?: TimestampBoundarySummary
    to?: TimestampBoundarySummary
  }
  estimated_timeframe?: EstimatedTimeframeResolution
}

export interface QueryCoverage {
  kind: 'block_window'
  window_complete: boolean
  result_complete: boolean
  continuation: 'cursor' | 'none'
  window_from_block: number
  window_to_block: number
  page_to_block: number
  returned_items: number
  returned_from_block?: number
  returned_to_block?: number
}

export interface BlockLookupFreshness {
  kind: 'timestamp_lookup'
  resolution: 'verified_boundary' | 'estimated'
  requested_timestamp: number
  requested_timestamp_human: string
  normalized_input: string
  resolved_block_number: number
  resolved_block_timestamp?: number
  resolved_block_timestamp_human?: string
  boundary?: 'from' | 'to' | 'nearest'
  head_block_number?: number
  head_timestamp?: number
  head_timestamp_human?: string
  estimated_block_time_seconds?: number
}

export interface BucketCoverage {
  kind: 'bucket_window'
  window_complete: boolean
  result_complete: boolean
  expected_buckets: number
  returned_buckets: number
  filled_buckets: number
  empty_buckets: number
  anchor: string
  requested_from_timestamp?: number
  requested_to_timestamp?: number
  analyzed_from_timestamp?: number
  analyzed_to_timestamp?: number
  indexed_evidence_end_timestamp?: number
  final_bucket_complete?: boolean
}

export interface AnalysisSectionCoverage {
  analyzed_from_block: number
  analyzed_to_block: number
  analyzed_blocks: number
  window_blocks: number
  sampled: boolean
  excluded_blocks?: number[]
}

export interface AnalysisCoverage {
  kind: 'analysis_window'
  window_complete: boolean
  result_complete: boolean
  continuation: 'cursor' | 'none'
  window_from_block: number
  window_to_block: number
  analyzed_from_block: number
  analyzed_to_block: number
  requested_blocks: number
  analyzed_blocks: number
  sampled: boolean
  /* Sections that scanned fewer blocks than the analyzed window. When any
     section is sampled the whole result is marked sampled, so a section
     total is never read as a window total. */
  sections?: Record<string, AnalysisSectionCoverage>
}

export interface SectionCoverage {
  kind: 'section_window'
  window_complete: boolean
  result_complete: boolean
  continuation: 'cursor' | 'none'
  window_from_block: number
  window_to_block: number
  sections: Record<string, { returned: number; has_more: boolean }>
  /** Present only when a section was asked for and never came back. */
  failed_sections?: string[]
}

export interface BucketGapDiagnosticItem {
  bucket_index: number
  timestamp: number
  timestamp_human: string
  gap_kind: 'no_activity' | 'coverage_gap_likely'
  reason: string
}

export interface BucketGapDiagnostics {
  kind: 'bucket_gap_diagnostics'
  anchor: string
  window_complete: boolean
  empty_bucket_count: number
  no_activity_bucket_count: number
  coverage_gap_likely_bucket_count: number
  sampled_empty_bucket_count: number
  empty_buckets_truncated: boolean
  empty_buckets: BucketGapDiagnosticItem[]
  first_observed_timestamp?: number
  first_observed_timestamp_human?: string
  last_observed_timestamp?: number
  last_observed_timestamp_human?: string
}

export interface ChronologicalPageOrdering {
  kind: 'chronological_page'
  page_order: 'oldest_to_newest' | 'newest_to_oldest'
  sorted_by: string
  direction: 'asc' | 'desc'
  continuation: 'older' | 'newer' | 'none'
  window_focus: 'most_recent_matches' | 'oldest_matches'
  tie_breakers?: string[]
}

export interface RankedOrdering {
  kind: 'ranking'
  page_order: 'rank_ascending' | 'rank_descending'
  sorted_by: string
  direction: 'asc' | 'desc'
  rank_field?: string
}

function summarizeTimestampBoundary(result: BlockAtTimestampResult): TimestampBoundarySummary {
  return {
    timestamp: result.timestamp,
    resolution: result.resolution,
    block_number: result.block_number,
    ...(result.block_timestamp !== undefined ? { block_timestamp: result.block_timestamp } : {}),
    ...(result.boundary ? { boundary: result.boundary } : {}),
    ...(result.timestamp_delta_seconds !== undefined
      ? { timestamp_delta_seconds: result.timestamp_delta_seconds }
      : {}),
    ...(result.resolution === 'estimated'
      ? {
          timestamp_human: result.timestamp_human,
          normalized_input: result.normalized_input,
          ...(result.block_timestamp_human ? { block_timestamp_human: result.block_timestamp_human } : {}),
        }
      : {}),
  }
}

export function buildQueryFreshness(params: {
  finality: 'latest' | 'finalized'
  headBlockNumber: number
  windowToBlock: number
  resolvedWindow: {
    range_kind: string
    from_lookup?: BlockAtTimestampResult
    to_lookup?: BlockAtTimestampResult
    estimated_timeframe?: EstimatedTimeframeResolution
  }
}): QueryFreshness {
  const { finality, headBlockNumber, windowToBlock, resolvedWindow } = params
  const timestampBounds: QueryFreshness['timestamp_bounds'] = {}

  if (resolvedWindow.from_lookup) {
    timestampBounds.from = summarizeTimestampBoundary(resolvedWindow.from_lookup)
  }

  if (resolvedWindow.to_lookup) {
    timestampBounds.to = summarizeTimestampBoundary(resolvedWindow.to_lookup)
  }

  return {
    kind: 'query_window',
    finality,
    range_kind: resolvedWindow.range_kind,
    indexed_head_block: headBlockNumber,
    window_to_block: windowToBlock,
    lag_blocks: Math.max(0, headBlockNumber - windowToBlock),
    ...(Object.keys(timestampBounds).length > 0 ? { timestamp_bounds: timestampBounds } : {}),
    ...(resolvedWindow.estimated_timeframe ? { estimated_timeframe: resolvedWindow.estimated_timeframe } : {}),
  }
}

export function buildQueryCoverage<T>(params: {
  windowFromBlock: number
  windowToBlock: number
  pageToBlock: number
  items: T[]
  getBlockNumber: (item: T) => number | undefined
  hasMore: boolean
  windowComplete?: boolean
  /**
   * Override when more rows exist but this tool cannot hand out a cursor for
   * them. Defaults to 'cursor', which is only true if the caller actually
   * emitted one; claiming a cursor that does not exist makes a client stop.
   */
  continuation?: 'cursor' | 'none'
}): QueryCoverage {
  const blockNumbers = params.items
    .map((item) => params.getBlockNumber(item))
    .filter((value): value is number => typeof value === 'number')

  const returnedFromBlock = blockNumbers.length > 0 ? Math.min(...blockNumbers) : undefined
  const returnedToBlock = blockNumbers.length > 0 ? Math.max(...blockNumbers) : undefined
  const windowComplete = params.windowComplete ?? true

  return {
    kind: 'block_window',
    window_complete: windowComplete,
    /* A page that left part of its window unread is not the complete result
       for that window, whatever its row count. buildSectionCoverage already
       says so; this builder claimed completeness from pagination alone. */
    result_complete: !params.hasMore && windowComplete,
    continuation: params.hasMore ? (params.continuation ?? 'cursor') : 'none',
    window_from_block: params.windowFromBlock,
    window_to_block: params.windowToBlock,
    page_to_block: params.pageToBlock,
    returned_items: params.items.length,
    ...(returnedFromBlock !== undefined ? { returned_from_block: returnedFromBlock } : {}),
    ...(returnedToBlock !== undefined ? { returned_to_block: returnedToBlock } : {}),
  }
}

export function buildBlockLookupFreshness(result: BlockAtTimestampResult): BlockLookupFreshness {
  return {
    kind: 'timestamp_lookup',
    resolution: result.resolution,
    requested_timestamp: result.timestamp,
    requested_timestamp_human: result.timestamp_human,
    normalized_input: result.normalized_input,
    resolved_block_number: result.block_number,
    ...(result.block_timestamp !== undefined ? { resolved_block_timestamp: result.block_timestamp } : {}),
    ...(result.block_timestamp_human ? { resolved_block_timestamp_human: result.block_timestamp_human } : {}),
    ...(result.boundary ? { boundary: result.boundary } : {}),
    ...(result.head_block_number !== undefined ? { head_block_number: result.head_block_number } : {}),
    ...(result.head_timestamp !== undefined ? { head_timestamp: result.head_timestamp } : {}),
    ...(result.head_timestamp_human ? { head_timestamp_human: result.head_timestamp_human } : {}),
    ...(result.estimated_block_time_seconds !== undefined
      ? { estimated_block_time_seconds: result.estimated_block_time_seconds }
      : {}),
    ...(result.timestamp_delta_seconds !== undefined
      ? { timestamp_delta_seconds: result.timestamp_delta_seconds }
      : {}),
  }
}

export function buildBucketCoverage(params: {
  expectedBuckets: number
  returnedBuckets: number
  filledBuckets: number
  anchor: string
  windowComplete?: boolean
  resultComplete?: boolean
  requestedFromTimestamp?: number
  requestedToTimestamp?: number
  analyzedFromTimestamp?: number
  analyzedToTimestamp?: number
  indexedEvidenceEndTimestamp?: number
  finalBucketComplete?: boolean
}): BucketCoverage {
  return {
    kind: 'bucket_window',
    window_complete: params.windowComplete ?? true,
    result_complete: params.resultComplete ?? true,
    expected_buckets: params.expectedBuckets,
    returned_buckets: params.returnedBuckets,
    filled_buckets: params.filledBuckets,
    empty_buckets: Math.max(0, params.returnedBuckets - params.filledBuckets),
    anchor: params.anchor,
    ...(params.requestedFromTimestamp !== undefined ? { requested_from_timestamp: params.requestedFromTimestamp } : {}),
    ...(params.requestedToTimestamp !== undefined ? { requested_to_timestamp: params.requestedToTimestamp } : {}),
    ...(params.analyzedFromTimestamp !== undefined ? { analyzed_from_timestamp: params.analyzedFromTimestamp } : {}),
    ...(params.analyzedToTimestamp !== undefined ? { analyzed_to_timestamp: params.analyzedToTimestamp } : {}),
    ...(params.indexedEvidenceEndTimestamp !== undefined
      ? { indexed_evidence_end_timestamp: params.indexedEvidenceEndTimestamp }
      : {}),
    ...(params.finalBucketComplete !== undefined ? { final_bucket_complete: params.finalBucketComplete } : {}),
  }
}

export function buildAnalysisSectionCoverage(params: {
  windowFromBlock: number
  windowToBlock: number
  analyzedFromBlock: number
  analyzedToBlock: number
  excludedBlocks?: number[]
}): AnalysisSectionCoverage {
  const excluded = params.excludedBlocks ?? []
  const analyzedBlocks = Math.max(0, params.analyzedToBlock - params.analyzedFromBlock + 1 - excluded.length)
  const windowBlocks = Math.max(0, params.windowToBlock - params.windowFromBlock + 1)
  return {
    analyzed_from_block: params.analyzedFromBlock,
    analyzed_to_block: params.analyzedToBlock,
    analyzed_blocks: analyzedBlocks,
    window_blocks: windowBlocks,
    sampled: analyzedBlocks < windowBlocks,
    ...(excluded.length > 0 ? { excluded_blocks: excluded } : {}),
  }
}

export function buildAnalysisCoverage(params: {
  windowFromBlock: number
  windowToBlock: number
  analyzedFromBlock: number
  analyzedToBlock: number
  hasMore?: boolean
  sections?: Record<string, AnalysisSectionCoverage>
}): AnalysisCoverage {
  const sections = params.sections ?? {}
  const sectionSampled = Object.values(sections).some((section) => section.sampled)
  const windowComplete =
    params.analyzedFromBlock <= params.windowFromBlock && params.analyzedToBlock >= params.windowToBlock
  return {
    kind: 'analysis_window',
    window_complete: windowComplete,
    result_complete: !(params.hasMore ?? false) && windowComplete,
    continuation: params.hasMore ? 'cursor' : 'none',
    window_from_block: params.windowFromBlock,
    window_to_block: params.windowToBlock,
    analyzed_from_block: params.analyzedFromBlock,
    analyzed_to_block: params.analyzedToBlock,
    requested_blocks: Math.max(0, params.windowToBlock - params.windowFromBlock + 1),
    analyzed_blocks: Math.max(0, params.analyzedToBlock - params.analyzedFromBlock + 1),
    sampled:
      params.analyzedFromBlock > params.windowFromBlock ||
      params.analyzedToBlock < params.windowToBlock ||
      sectionSampled,
    ...(Object.keys(sections).length > 0 ? { sections } : {}),
  }
}

export function buildSectionCoverage(params: {
  windowFromBlock: number
  windowToBlock: number
  hasMore: boolean
  sections: Record<string, { returned: number; has_more: boolean }>
  windowComplete?: boolean
  /** Sections that were asked for and never came back. */
  failedSections?: string[]
}): SectionCoverage {
  /* result_complete used to be `!hasMore` alone. A wallet summary whose
     transactions section failed upstream still had nothing more to page, so it
     reported result_complete: true beside its own completeness object saying
     result_complete: false with failed_sections: ["transactions"]. The server's
     instructions tell clients to check _coverage before claiming completeness,
     so the field they were told to trust was the one that was wrong: a caller
     obeying it concluded it had a complete view of a wallet whose transactions
     were never fetched. A section that never arrived is missing data, whatever
     the pager says. */
  const failedSections = Array.from(new Set(params.failedSections ?? []))
  const windowComplete = params.windowComplete ?? true
  return {
    kind: 'section_window',
    window_complete: windowComplete,
    result_complete: !params.hasMore && windowComplete && failedSections.length === 0,
    continuation: params.hasMore ? 'cursor' : 'none',
    window_from_block: params.windowFromBlock,
    window_to_block: params.windowToBlock,
    sections: params.sections,
    ...(failedSections.length > 0 ? { failed_sections: failedSections } : {}),
  }
}

export function buildChronologicalPageOrdering(params: {
  sortedBy: string
  continuation?: 'older' | 'newer' | 'none'
  pageOrder?: 'oldest_to_newest' | 'newest_to_oldest'
  windowFocus?: 'most_recent_matches' | 'oldest_matches'
  tieBreakers?: string[]
}): ChronologicalPageOrdering {
  return {
    kind: 'chronological_page',
    page_order: params.pageOrder ?? 'oldest_to_newest',
    sorted_by: params.sortedBy,
    direction: params.pageOrder === 'newest_to_oldest' ? 'desc' : 'asc',
    continuation: params.continuation ?? 'older',
    window_focus: params.windowFocus ?? 'most_recent_matches',
    ...(params.tieBreakers && params.tieBreakers.length > 0 ? { tie_breakers: params.tieBreakers } : {}),
  }
}

export function buildRankedOrdering(params: {
  sortedBy: string
  direction: 'asc' | 'desc'
  pageOrder?: 'rank_ascending' | 'rank_descending'
  rankField?: string
}): RankedOrdering {
  return {
    kind: 'ranking',
    page_order: params.pageOrder ?? 'rank_ascending',
    sorted_by: params.sortedBy,
    direction: params.direction,
    ...(params.rankField ? { rank_field: params.rankField } : {}),
  }
}

export function buildBucketGapDiagnostics<
  T extends { bucket_index: number; timestamp: number; timestamp_human?: string },
>(params: {
  buckets: T[]
  intervalSeconds: number
  isFilled: (bucket: T) => boolean
  anchor: string
  windowComplete?: boolean
  firstObservedTimestamp?: number
  lastObservedTimestamp?: number
  maxEmptyBuckets?: number
}): BucketGapDiagnostics {
  const emptyBuckets = params.buckets.filter((bucket) => !params.isFilled(bucket))
  const windowComplete = params.windowComplete ?? true
  const maxEmptyBuckets = params.maxEmptyBuckets ?? 100

  let noActivityBucketCount = 0
  let coverageGapLikelyBucketCount = 0

  const classifyGapKind = (bucket: T) => {
    const bucketEnd = bucket.timestamp + params.intervalSeconds
    const beforeObservedData = params.firstObservedTimestamp !== undefined && bucketEnd <= params.firstObservedTimestamp
    const afterObservedData =
      params.lastObservedTimestamp !== undefined && bucket.timestamp > params.lastObservedTimestamp
    return !windowComplete && (beforeObservedData || afterObservedData) ? 'coverage_gap_likely' : 'no_activity'
  }

  emptyBuckets.forEach((bucket) => {
    const gapKind = classifyGapKind(bucket)
    if (gapKind === 'coverage_gap_likely') {
      coverageGapLikelyBucketCount += 1
    } else {
      noActivityBucketCount += 1
    }
  })

  const diagnostics = emptyBuckets.slice(0, maxEmptyBuckets).map((bucket) => {
    const gapKind = classifyGapKind(bucket)

    return {
      bucket_index: bucket.bucket_index,
      timestamp: bucket.timestamp,
      timestamp_human: bucket.timestamp_human ?? formatTimestamp(bucket.timestamp),
      gap_kind: gapKind,
      reason:
        gapKind === 'coverage_gap_likely'
          ? 'This bucket sits outside the observed data span for the requested window, so the gap may come from incomplete coverage rather than zero activity.'
          : 'Observed data covers this bucket, so it appears to be a real zero-activity interval.',
    } satisfies BucketGapDiagnosticItem
  })

  return {
    kind: 'bucket_gap_diagnostics',
    anchor: params.anchor,
    window_complete: windowComplete,
    empty_bucket_count: emptyBuckets.length,
    no_activity_bucket_count: noActivityBucketCount,
    coverage_gap_likely_bucket_count: coverageGapLikelyBucketCount,
    sampled_empty_bucket_count: diagnostics.length,
    empty_buckets_truncated: emptyBuckets.length > diagnostics.length,
    empty_buckets: diagnostics,
    ...(params.firstObservedTimestamp !== undefined
      ? {
          first_observed_timestamp: params.firstObservedTimestamp,
          first_observed_timestamp_human: formatTimestamp(params.firstObservedTimestamp),
        }
      : {}),
    ...(params.lastObservedTimestamp !== undefined
      ? {
          last_observed_timestamp: params.lastObservedTimestamp,
          last_observed_timestamp_human: formatTimestamp(params.lastObservedTimestamp),
        }
      : {}),
  }
}
