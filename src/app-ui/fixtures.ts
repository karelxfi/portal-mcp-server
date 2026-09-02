import { RECORDED_FIXTURES } from './fixtures.recorded.js'

/* Everything people look at is a recorded SQD Portal response (see
   scripts/record-app-fixtures.ts). The three cases below are rendering
   contracts that real windows rarely produce on demand: a missing bucket,
   signed values around an exact zero, and a server error envelope. */

const SPARSE_ROWS = [
  { bucket_index: 3, timestamp_human: '00:03 UTC', value: 148 },
  { bucket_index: 0, timestamp_human: '00:00 UTC', value: 120 },
  { bucket_index: 4, timestamp_human: '00:04 UTC', value: 151 },
  { bucket_index: 1, timestamp_human: '00:01 UTC', value: 126 },
]

const MIXED_BAR_ROWS = [
  { bucket_index: 2, label: 'Bridge', value: 15 },
  { bucket_index: 0, label: 'Outflow', value: -30 },
  { bucket_index: 4, label: 'Rewards', value: 50 },
  { bucket_index: 1, label: 'Fees', value: -10 },
  { bucket_index: 3, label: 'Neutral', value: 0 },
  { bucket_index: 5, label: 'Unavailable', value: null },
]

const RAW_APP_FIXTURES: Record<string, Record<string, unknown>> = {
  ...RECORDED_FIXTURES,
  sparse: {
    answer: 'The deterministic sparse-series fixture preserves chronological order and one missing bucket.',
    time_series: SPARSE_ROWS,
    chart: { kind: 'time_series', data_key: 'time_series', recommended_visual: 'line', x_field: 'bucket_index', y_field: 'value', interval: '1m', total_points: SPARSE_ROWS.length, value_format: 'integer' },
    _meta: { network: 'ui-contract-fixture', row_count: SPARSE_ROWS.length, timeframe: '5m' },
    _freshness: { finality: 'fixture' }, _coverage: { window_complete: true, result_complete: true, missing_buckets: [2] }, _pagination: { has_more: false },
    _tool_contract: { name: 'portal_get_time_series' },
    _ui: { version: 'portal_ui_v1', layout: 'chart_focus', density: 'comfortable', design_intent: 'analytics_dashboard', headline: { title: 'Sparse-series contract fixture', subtitle: 'The chart must not connect across missing bucket 2.' }, panels: [{ kind: 'chart_panel', title: 'Ordered series with a gap', chart_key: 'chart', emphasis: 'primary' }] },
  },
  mixed: {
    answer: 'The deterministic mixed-sign fixture proves a factual zero baseline and keeps unavailable values distinct from zero.',
    time_series: MIXED_BAR_ROWS,
    chart: { kind: 'time_series', data_key: 'time_series', recommended_visual: 'bar', x_field: 'bucket_index', y_field: 'value', interval: '1m', total_points: MIXED_BAR_ROWS.length, value_format: 'integer' },
    _meta: { network: 'ui-contract-fixture', row_count: MIXED_BAR_ROWS.length, timeframe: '5m' },
    _freshness: { finality: 'fixture' }, _coverage: { window_complete: true, result_complete: true }, _pagination: { has_more: false },
    _tool_contract: { name: 'portal_get_time_series' },
    _ui: { version: 'portal_ui_v1', layout: 'chart_focus', density: 'comfortable', design_intent: 'analytics_dashboard', headline: { title: 'Signed-flow contract fixture', subtitle: 'Positive and negative values share an exact zero baseline. Missing values remain missing.' }, panels: [{ kind: 'chart_panel', title: 'Net flow by category', chart_key: 'chart', emphasis: 'primary' }] },
  },
  error: {
    error: { code: 'overloaded', origin: 'server', summary: 'SQD is busy and could not start this query inside the bounded wait budget.', retryable: true, suggestions: ['Retry this request in a moment', 'Use a smaller timeframe'] },
    _coverage: { result_complete: false }, _pagination: { has_more: false }, _tool_contract: { name: 'portal_get_wallet_summary' },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function fixturePrimaryEvidence(payload: Record<string, unknown>): { path?: string; count: number } {
  for (const path of ['items', 'ohlc', 'time_series', 'fills', 'transactions', 'transfers', 'logs', 'events', 'calls']) {
    if (Array.isArray(payload[path])) return { path, count: payload[path].length }
  }
  const activity = payload.activity as Record<string, unknown> | undefined
  if (Array.isArray(activity?.items)) return { path: 'activity.items', count: activity.items.length }
  const interactions = payload.interactions as Record<string, unknown> | undefined
  if (Array.isArray(interactions?.top_callers)) return { path: 'interactions.top_callers', count: interactions.top_callers.length }
  return { count: 0 }
}

export const APP_FIXTURES: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(RAW_APP_FIXTURES).map(([name, payload]) => {
    if (payload.error || isRecord(payload._evidence)) return [name, payload]
    const contract = payload._tool_contract as Record<string, unknown> | undefined
    const meta = payload._meta as Record<string, unknown> | undefined
    const coverage = payload._coverage as Record<string, unknown> | undefined
    const pagination = payload._pagination as Record<string, unknown> | undefined
    const evidence = fixturePrimaryEvidence(payload)
    const completeness = coverage?.window_complete === false || coverage?.result_complete === false ||
      (pagination?.has_more === true && pagination?.continuation_scope !== 'adjacent_window')
      ? 'partial'
      : 'complete'
    return [
      name,
      {
        ...payload,
        _evidence: {
          version: 'sqd_evidence_v1',
          tool: contract?.name ?? 'fixture',
          source: {
            provider: 'SQD Portal',
            network: meta?.network ?? 'ui-contract-fixture',
            query_type: name === 'hyperliquid' ? 'hyperliquid' : 'fixture',
          },
          request: { arguments: { fixture: name }, arguments_sha256: 'a'.repeat(64) },
          result: {
            exact_data_sha256: `${name.charCodeAt(0).toString(16)}`.repeat(64).slice(0, 64),
            row_count: evidence.count,
            ...(evidence.path ? { primary_evidence_path: evidence.path } : {}),
            completeness,
            metadata: ['_coverage', '_freshness', '_ordering', '_pagination'],
          },
          replay: { arguments_path: '_evidence.request.arguments' },
        },
      },
    ]
  }),
)
