const HYPERLIQUID_RAW_CANDLES = [
  { open: 78044, high: 78210, low: 77903, close: 78121, volume: 262406180.42, vwap: 78067.41, fill_count: 30214 },
  { open: 78121, high: 78180, low: 77820, close: 77925, volume: 231118304.11, vwap: 77988.63, fill_count: 28931 },
  { open: 77925, high: 78090, low: 77714, close: 78056, volume: 219872455.09, vwap: 77906.02, fill_count: 27455 },
  { open: 78056, high: 78310, low: 77988, close: 78240, volume: 268904371.55, vwap: 78149.87, fill_count: 31082 },
  { open: 78240, high: 78412, low: 78066, close: 78105, volume: 301246880.27, vwap: 78244.19, fill_count: 33619 },
  { open: 78105, high: 78222, low: 77861, close: 77992, volume: 244317690.66, vwap: 78037.55, fill_count: 29377 },
  { open: 77992, high: 78130, low: 77742, close: 77873, volume: 208751432.84, vwap: 77931.28, fill_count: 26840 },
  { open: 77873, high: 78420, low: 77850, close: 78390, volume: 342879516.73, vwap: 78122.46, fill_count: 38225 },
  { open: 78390, high: 79640, low: 78355, close: 79512, volume: 689415203.38, vwap: 78988.71, fill_count: 61443 },
  { open: 79512, high: 81299, low: 79488, close: 80916, volume: 1163402878.91, vwap: 80426.35, fill_count: 92718 },
  { open: 80916, high: 81120, low: 80273, close: 80412, volume: 872536449.62, vwap: 80701.88, fill_count: 71296 },
  { open: 80412, high: 80840, low: 80160, close: 80689, volume: 594208317.45, vwap: 80492.63, fill_count: 54187 },
  { open: 80689, high: 80730, low: 79918, close: 80044, volume: 501377264.29, vwap: 80311.74, fill_count: 47269 },
  { open: 80044, high: 80378, low: 79866, close: 80251, volume: 447932681.14, vwap: 80122.09, fill_count: 41528 },
  { open: 80251, high: 80305, low: 79561, close: 79702, volume: 421806553.97, vwap: 79931.42, fill_count: 39914 },
  { open: 79702, high: 80050, low: 79596, close: 79981, volume: 386570412.66, vwap: 79822.57, fill_count: 36672 },
  { open: 79981, high: 80112, low: 79412, close: 79486, volume: 452918730.85, vwap: 79763.88, fill_count: 42361 },
  { open: 79486, high: 79830, low: 79333, close: 79770, volume: 372645198.24, vwap: 79581.24, fill_count: 35849 },
  { open: 79770, high: 79920, low: 79184, close: 79251, volume: 483206554.71, vwap: 79552.31, fill_count: 44708 },
  { open: 79251, high: 79510, low: 78930, close: 79448, volume: 401377842.53, vwap: 79216.74, fill_count: 38133 },
  { open: 79448, high: 79831, low: 79366, close: 79614, volume: 342918265.48, vwap: 79598.42, fill_count: 33587 },
  { open: 79614, high: 79726, low: 79215, close: 79302, volume: 371542806.19, vwap: 79461.87, fill_count: 36248 },
  { open: 79302, high: 79641, low: 79240, close: 79575, volume: 318706432.87, vwap: 79433.29, fill_count: 31904 },
  { open: 79575, high: 79812, low: 79350, close: 79497, volume: 476318204.55, vwap: 79570.66, fill_count: 46408 },
]

const HYPERLIQUID_SERIES_START = 1788022800
const HYPERLIQUID_CANDLES = HYPERLIQUID_RAW_CANDLES.map((candle, index) => {
  const timestamp = HYPERLIQUID_SERIES_START + index * 3600
  const date = new Date(timestamp * 1000)
  const day = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
  const clock = `${String(date.getUTCHours()).padStart(2, '0')}:00`
  return {
    bucket_index: index,
    timestamp,
    timestamp_human: `${day} ${clock} UTC`,
    ...candle,
    base_volume: Number((candle.volume / candle.vwap).toFixed(3)),
    is_closed: index < HYPERLIQUID_RAW_CANDLES.length - 1,
  }
})

const HYPERLIQUID_SUMMARY = {
  coin: 'BTC',
  interval: '1h',
  duration: '24h',
  total_buckets: HYPERLIQUID_CANDLES.length,
  filled_buckets: HYPERLIQUID_CANDLES.filter((row) => row.fill_count > 0).length,
  total_fills: HYPERLIQUID_CANDLES.reduce((sum, row) => sum + row.fill_count, 0),
  total_volume: Number(HYPERLIQUID_CANDLES.reduce((sum, row) => sum + row.volume, 0).toFixed(2)),
  total_base_volume: Number(HYPERLIQUID_CANDLES.reduce((sum, row) => sum + row.base_volume, 0).toFixed(3)),
  series_open: HYPERLIQUID_CANDLES[0].open,
  series_close: HYPERLIQUID_CANDLES.at(-1)!.close,
  day_high: Math.max(...HYPERLIQUID_CANDLES.map((row) => row.high)),
  day_low: Math.min(...HYPERLIQUID_CANDLES.map((row) => row.low)),
}

const RATIO_CANDLES = [
  { timestamp: 1788042240, timestamp_human: '22:24 UTC', open: 0.00042, high: 0.00045, low: 0.00041, close: 0.00044, base_volume: 12800 },
  { timestamp: 1788042300, timestamp_human: '22:25 UTC', open: 0.00044, high: 0.00047, low: 0.00043, close: 0.00046, base_volume: 9400 },
  { timestamp: 1788042360, timestamp_human: '22:26 UTC', open: 0.00046, high: 0.00046, low: 0.00042, close: 0.00043, base_volume: 15300 },
]

const HYPERLIQUID_FIXTURE: Record<string, unknown> = {
  answer: `BTC is at $${HYPERLIQUID_SUMMARY.series_close.toLocaleString('en-US')} after a run from $${HYPERLIQUID_SUMMARY.series_open.toLocaleString('en-US')}; the 02:00 hour traded $1.16B and printed the $${HYPERLIQUID_SUMMARY.day_high.toLocaleString('en-US')} high.`,
  summary: HYPERLIQUID_SUMMARY,
  ohlc: HYPERLIQUID_CANDLES,
  chart: {
    kind: 'candlestick', data_key: 'ohlc', x_field: 'timestamp',
    candle_fields: { open: 'open', high: 'high', low: 'low', close: 'close' },
    volume_field: 'volume', volume_panel: true, interval: '1h',
    total_candles: HYPERLIQUID_CANDLES.length, value_format: 'currency_usd', price_unit: 'USD', volume_unit: 'USD',
    tooltip: { title_field: 'timestamp_human', fields: [
      { key: 'open', label: 'Open', format: 'currency_usd', unit: 'USD' },
      { key: 'high', label: 'High', format: 'currency_usd', unit: 'USD' },
      { key: 'low', label: 'Low', format: 'currency_usd', unit: 'USD' },
      { key: 'close', label: 'Close', format: 'currency_usd', unit: 'USD' },
      { key: 'volume', label: 'Volume', format: 'currency_usd', unit: 'USD' },
      { key: 'fill_count', label: 'Fills', format: 'integer' },
      { key: 'vwap', label: 'VWAP', format: 'currency_usd', unit: 'USD' },
    ] },
  },
  tables: [{
    id: 'ohlc', data_key: 'ohlc', row_count: HYPERLIQUID_CANDLES.length,
    columns: [
      { key: 'timestamp_human', label: 'Time' },
      { key: 'open', label: 'Open', format: 'currency_usd', align: 'right' },
      { key: 'high', label: 'High', format: 'currency_usd', align: 'right' },
      { key: 'low', label: 'Low', format: 'currency_usd', align: 'right' },
      { key: 'close', label: 'Close', format: 'currency_usd', align: 'right' },
      { key: 'volume', label: 'Volume', format: 'currency_usd', align: 'right' },
      { key: 'fill_count', label: 'Fills', format: 'integer', align: 'right' },
    ],
  }],
  _meta: { network: 'hyperliquid-fills', row_count: HYPERLIQUID_CANDLES.length, timeframe: '24h', queried_blocks: '1128489275-1128576011' },
  _provenance: {
    source: 'SQD Portal hyperliquid-fills', captured_at: '2026-08-30T16:47:12Z',
    query: 'BTC, twenty-four hours, one-hour candles',
    verification: 'Each candle and every summary total were reproduced from the raw Portal fill rows.',
  },
  _freshness: { finality: 'latest', indexed_head_block: 1128576011 },
  _coverage: { window_complete: true, result_complete: true, expected_buckets: HYPERLIQUID_CANDLES.length, returned_buckets: HYPERLIQUID_CANDLES.length },
  _pagination: { has_more: true, next_cursor: 'signed-preview-cursor', continuation_scope: 'adjacent_window' },
  _notice: 'The 16:00 candle is still forming and its close is not final.',
  _tool_contract: { name: 'portal_hyperliquid_get_ohlc' },
  _ui: {
    version: 'portal_ui_v1', layout: 'chart_focus', density: 'compact', design_intent: 'market_terminal',
    headline: { title: 'BTC Hyperliquid candles', subtitle: 'Exact one-hour price and volume evidence from SQD Portal.' },
    metric_cards: [
      { label: 'Last price', value_path: 'summary.series_close', format: 'currency_usd', emphasis: 'primary' },
      { label: '24h volume', value_path: 'summary.total_volume', format: 'currency_usd' },
      { label: '24h fills', value_path: 'summary.total_fills', format: 'integer' },
      { label: 'Day high', value_path: 'summary.day_high', format: 'currency_usd' },
      { label: 'Day low', value_path: 'summary.day_low', format: 'currency_usd' },
    ],
    panels: [
      { kind: 'chart_panel', title: 'BTC price and volume', subtitle: 'Focus any candle for exact OHLC and notional volume.', chart_key: 'chart', emphasis: 'primary' },
      { kind: 'table_panel', title: 'Exact candle evidence', table_id: 'ohlc' },
    ],
    follow_up_actions: [
      { label: 'Load older candles', intent: 'continue' },
      { label: 'Show raw candle rows', intent: 'show_raw', target: 'ohlc' },
    ],
  },
}

const TIME_SERIES_ROWS = Array.from({ length: 24 }, (_, index) => ({
  bucket_index: index,
  timestamp: 1787942400 + index * 3600,
  timestamp_human: `${String(index).padStart(2, '0')}:00 UTC`,
  value: 72000 + Math.round(Math.sin(index / 2.4) * 24000 + index * 1700),
}))

const TIME_SERIES_SUMMARY = {
  total: TIME_SERIES_ROWS.reduce((sum, row) => sum + row.value, 0),
  average: Math.round(TIME_SERIES_ROWS.reduce((sum, row) => sum + row.value, 0) / TIME_SERIES_ROWS.length),
  peak: Math.max(...TIME_SERIES_ROWS.map((row) => row.value)),
  filled_buckets: TIME_SERIES_ROWS.length,
}

const GROUPED_ROWS = Array.from({ length: 12 }, (_, index) => ({
  bucket_index: index,
  timestamp_human: `${String(index * 2).padStart(2, '0')}:00 UTC`,
  series_values: {
    transfers: 42000 + index * 3100,
    swaps: 18000 + Math.round(Math.sin(index / 2) * 5000 + index * 900),
    contract_calls: 27000 + Math.round(Math.cos(index / 2.4) * 3500 + index * 1200),
  },
}))

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

const ACTIVITY_ROWS = Array.from({ length: 12 }, (_, index) => ({
  timestamp_human: `${index + 1} min ago`, block_number: 34811020 - index,
  tx_hash: `0x${String(index + 1).padStart(64, 'a')}`,
  sender: index % 2 ? '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' : '0x4200000000000000000000000000000000000006',
  recipient: index % 2 ? '0x4200000000000000000000000000000000000006' : '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  value_formatted: index === 0 ? '0.000000009 USDC' : `${(1200 + index * 83).toLocaleString()} USDC`, status: 'success',
}))

const LARGE_TABLE_ROWS = Array.from({ length: 125 }, (_, index) => ({
  rank: index + 1,
  address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
  transaction_count: 5000 - index * 17,
}))

const WALLET_ACTIVITY_ROWS = [
  { timestamp_human: '09:00 UTC', block_number: 34811001, primary_id: '0xwallet01:0', record_type: 'transfer', sender: '0x1111111111111111111111111111111111111111', recipient: '0x2222222222222222222222222222222222222222', asset: 'USDC', direction: 'in', value_usd: 12500 },
  { timestamp_human: '09:08 UTC', block_number: 34811024, primary_id: '0xwallet02:0', record_type: 'transfer', sender: '0x2222222222222222222222222222222222222222', recipient: '0x3333333333333333333333333333333333333333', asset: 'USDC', direction: 'out', value_usd: 4200 },
  { timestamp_human: '09:14 UTC', block_number: 34811045, primary_id: '0xwallet03', record_type: 'transaction', sender: '0x2222222222222222222222222222222222222222', recipient: '0x4444444444444444444444444444444444444444', asset: 'ETH', direction: 'out', value_usd: 780 },
  { timestamp_human: '09:22 UTC', block_number: 34811073, primary_id: '0xwallet04:0', record_type: 'transfer', sender: '0x5555555555555555555555555555555555555555', recipient: '0x2222222222222222222222222222222222222222', asset: 'USDC', direction: 'in', value_usd: 2100 },
  { timestamp_human: '09:31 UTC', block_number: 34811102, primary_id: '0xwallet05:0', record_type: 'transfer', sender: '0x2222222222222222222222222222222222222222', recipient: '0x3333333333333333333333333333333333333333', asset: 'USDC', direction: 'out', value_usd: 1600 },
  { timestamp_human: '09:44 UTC', block_number: 34811141, primary_id: '0xwallet06', record_type: 'transaction', sender: '0x2222222222222222222222222222222222222222', recipient: '0x6666666666666666666666666666666666666666', asset: 'ETH', direction: 'out', value_usd: 320 },
]

const CONTRACT_CALLERS = [
  { address: '0x1111111111111111111111111111111111111111', interaction_count: 48 },
  { address: '0x2222222222222222222222222222222222222222', interaction_count: 31 },
  { address: '0x3333333333333333333333333333333333333333', interaction_count: 19 },
  { address: '0x4444444444444444444444444444444444444444', interaction_count: 12 },
]

const RAW_APP_FIXTURES: Record<string, Record<string, unknown>> = {
  hyperliquid: HYPERLIQUID_FIXTURE,
  ratio: {
    answer: 'The deterministic ratio fixture keeps token-pair prices distinct from USD values.',
    ohlc: RATIO_CANDLES,
    chart: {
      kind: 'candlestick', data_key: 'ohlc', x_field: 'timestamp',
      candle_fields: { open: 'open', high: 'high', low: 'low', close: 'close' },
      volume_field: 'base_volume', volume_panel: true, interval: '1m', total_candles: RATIO_CANDLES.length,
      value_format: 'decimal', price_unit: 'WETH per TOKEN', volume_unit: 'TOKEN',
    },
    _meta: { network: 'ui-contract-fixture', row_count: RATIO_CANDLES.length, timeframe: '3m' },
    _freshness: { finality: 'fixture' }, _coverage: { window_complete: true, result_complete: true }, _pagination: { has_more: false },
    _tool_contract: { name: 'portal_evm_get_ohlc' },
    _ui: { version: 'portal_ui_v1', layout: 'chart_focus', density: 'compact', design_intent: 'market_terminal', headline: { title: 'TOKEN/WETH ratio contract fixture', subtitle: 'Exact non-USD price and token volume units.' }, panels: [{ kind: 'chart_panel', title: 'Token price ratio', chart_key: 'chart', emphasis: 'primary' }] },
  },
  timeseries: {
    answer: `The deterministic 24-bucket UI fixture contains ${TIME_SERIES_SUMMARY.total.toLocaleString('en-US')} events.`,
    summary: TIME_SERIES_SUMMARY, time_series: TIME_SERIES_ROWS,
    chart: { kind: 'time_series', data_key: 'time_series', recommended_visual: 'line', x_field: 'timestamp', y_field: 'value', y_axis_label: 'Transactions per hour', total_points: TIME_SERIES_ROWS.length },
    tables: [{ id: 'series', data_key: 'time_series', row_count: TIME_SERIES_ROWS.length, columns: [
      { key: 'timestamp_human', label: 'Time' },
      { key: 'value', label: 'Transactions', format: 'integer', align: 'right' },
    ] }],
    _meta: { network: 'ui-contract-fixture', row_count: TIME_SERIES_ROWS.length, timeframe: '24h' },
    _freshness: { finality: 'fixture' }, _coverage: { window_complete: true, result_complete: true }, _pagination: { has_more: false },
    _tool_contract: { name: 'portal_get_time_series' },
    _ui: {
      version: 'portal_ui_v1', layout: 'chart_focus', density: 'comfortable', design_intent: 'analytics_dashboard',
      headline: { title: 'Time-series contract fixture', subtitle: 'Deterministic values used only for rendered-data tests.' },
      metric_cards: [
        { label: 'Events', value_path: 'summary.total', format: 'compact_number', emphasis: 'primary' },
        { label: 'Average', value_path: 'summary.average', format: 'integer' },
        { label: 'Peak', value_path: 'summary.peak', format: 'integer' },
        { label: 'Filled buckets', value_path: 'summary.filled_buckets', format: 'integer' },
      ],
      panels: [
        { kind: 'chart_panel', title: 'Events by hour', chart_key: 'chart', emphasis: 'primary' },
        { kind: 'table_panel', title: 'Exact hourly rows', table_id: 'series' },
      ],
    },
  },
  grouped: {
    answer: 'The deterministic grouped fixture proves three complete blockchain activity series.',
    time_series: GROUPED_ROWS,
    chart: { kind: 'time_series', data_key: 'time_series', recommended_visual: 'stacked_area', x_field: 'bucket_index', grouped_value_field: 'series_values', grouped_value_mode: 'object_map', series_keys: ['transfers', 'swaps', 'contract_calls'], total_points: GROUPED_ROWS.length, value_format: 'integer' },
    _meta: { network: 'ui-contract-fixture', row_count: GROUPED_ROWS.length, timeframe: '24h' },
    _freshness: { finality: 'fixture' }, _coverage: { window_complete: true, result_complete: true }, _pagination: { has_more: false },
    _tool_contract: { name: 'portal_get_time_series' },
    _ui: { version: 'portal_ui_v1', layout: 'chart_focus', density: 'comfortable', design_intent: 'analytics_dashboard', headline: { title: 'Grouped activity contract fixture', subtitle: 'Three series, one shared evidence window.' }, panels: [{ kind: 'chart_panel', title: 'Activity by type', chart_key: 'chart', emphasis: 'primary' }] },
  },
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
  activity: {
    answer: 'The deterministic investigator fixture contains 12 complete activity rows.', items: ACTIVITY_ROWS,
    _meta: { network: 'ui-contract-fixture', row_count: ACTIVITY_ROWS.length, timeframe: '1h' },
    _freshness: { finality: 'fixture' }, _coverage: { window_complete: true, result_complete: true }, _pagination: { has_more: false },
    _tool_contract: { name: 'portal_get_recent_activity' },
    _ui: {
      version: 'portal_ui_v1', layout: 'split', density: 'compact', design_intent: 'activity_investigator',
      headline: { title: 'Activity investigator contract fixture', subtitle: 'Exact identifiers remain visible and copyable.' },
      panels: [
        { kind: 'timeline_panel', title: 'Activity timeline', data_key: 'items', timestamp_key: 'timestamp_human', title_key: 'value_formatted', subtitle_keys: ['sender', 'recipient'] },
        { kind: 'table_panel', title: 'Exact activity rows', data_key: 'items' },
      ],
    },
  },
  large_table: {
    answer: 'The contract fixture returns 125 complete rows.', items: LARGE_TABLE_ROWS,
    tables: [{ id: 'ranked', data_key: 'items', row_count: LARGE_TABLE_ROWS.length, columns: [
      { key: 'rank', label: 'Rank', format: 'integer', align: 'right' },
      { key: 'address', label: 'Address', format: 'address' },
      { key: 'transaction_count', label: 'Transactions', format: 'integer', align: 'right' },
    ] }],
    _meta: { network: 'ui-contract-fixture', row_count: LARGE_TABLE_ROWS.length },
    _freshness: { finality: 'fixture' }, _coverage: { window_complete: true, result_complete: true, returned_items: LARGE_TABLE_ROWS.length }, _pagination: { has_more: false },
    _tool_contract: { name: 'portal_get_top_contracts' },
    _ui: { version: 'portal_ui_v1', layout: 'dashboard', density: 'compact', design_intent: 'analytics_dashboard', headline: { title: 'Large evidence result', subtitle: 'Server completeness and local display limits stay separate.' }, panels: [{ kind: 'table_panel', title: 'Ranked addresses', table_id: 'ranked' }] },
  },
  wallet: {
    answer: 'The complete fixture records $14,600 in and $6,900 out across six exact wallet rows.',
    activity: { count: WALLET_ACTIVITY_ROWS.length, items: WALLET_ACTIVITY_ROWS },
    fund_flow: {
      summary: { total_in_usd: 14600, total_out_usd: 6900, net_usd: 7700 },
      movement_counterparties: [
        { address: '0x1111111111111111111111111111111111111111', interaction_count: 1, volume_usd: 12500 },
        { address: '0x3333333333333333333333333333333333333333', interaction_count: 2, volume_usd: 5800 },
        { address: '0x5555555555555555555555555555555555555555', interaction_count: 1, volume_usd: 2100 },
      ],
      largest_movements: [...WALLET_ACTIVITY_ROWS].sort((left, right) => right.value_usd - left.value_usd).slice(0, 4),
    },
    tables: [{
      id: 'activity', data_key: 'activity.items', row_count: WALLET_ACTIVITY_ROWS.length,
      columns: [
        { key: 'timestamp_human', label: 'Time' },
        { key: 'block_number', label: 'Block', format: 'integer', align: 'right' },
        { key: 'record_type', label: 'Type' },
        { key: 'asset', label: 'Asset' },
        { key: 'direction', label: 'Direction' },
        { key: 'value_usd', label: 'Value', format: 'currency_usd', align: 'right' },
        { key: 'sender', label: 'Sender', format: 'address' },
        { key: 'recipient', label: 'Recipient', format: 'address' },
      ],
    }],
    _meta: { network: 'base-mainnet', row_count: WALLET_ACTIVITY_ROWS.length, timeframe: '1h' },
    _freshness: { finality: 'finalized' },
    _coverage: { window_complete: true, result_complete: true, returned_items: WALLET_ACTIVITY_ROWS.length },
    _pagination: { has_more: false },
    _tool_contract: { name: 'portal_get_wallet_summary' },
    _ui: {
      version: 'portal_ui_v1', layout: 'dashboard', density: 'compact', design_intent: 'activity_investigator',
      headline: { title: 'Wallet incident fixture', subtitle: 'One complete hour of exact Base wallet activity.' },
      metric_cards: [
        { label: 'Net flow', value_path: 'fund_flow.summary.net_usd', format: 'currency_usd', emphasis: 'primary' },
        { label: 'Activity rows', value_path: 'activity.count', format: 'integer' },
        { label: 'Funds in', value_path: 'fund_flow.summary.total_in_usd', format: 'currency_usd' },
        { label: 'Funds out', value_path: 'fund_flow.summary.total_out_usd', format: 'currency_usd' },
      ],
      panels: [
        { kind: 'timeline_panel', title: 'Wallet timeline', data_key: 'activity.items', timestamp_key: 'timestamp_human', title_key: 'asset', subtitle_keys: ['sender', 'recipient'], value_key: 'value_usd', value_format: 'currency_usd', direction_key: 'direction' },
        { kind: 'ranked_bars_panel', title: 'Counterparties by volume', data_key: 'fund_flow.movement_counterparties', category_key: 'address', value_key: 'volume_usd', value_format: 'currency_usd' },
        { kind: 'table_panel', title: 'Exact wallet rows', table_id: 'activity', emphasis: 'primary' },
      ],
    },
  },
  contract: {
    answer: 'The complete fixture records 110 interactions from four callers and 231 emitted events.',
    contract_address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    timeframe: { from_block: 34810000, to_block: 34812000, analyzed_from_block: 34810000, analyzed_to_block: 34812000, description: '2,001 blocks' },
    mode: 'deep',
    interactions: { total_transactions: 110, unique_callers: CONTRACT_CALLERS.length, top_callers: CONTRACT_CALLERS },
    events: { total_events: 231, unique_event_types: 3, events_by_type: { Transfer: 184, Approval: 42, OwnershipTransferred: 5 } },
    _meta: { network: 'base-mainnet', row_count: CONTRACT_CALLERS.length, queried_blocks: '34810000-34812000' },
    _freshness: { finality: 'latest', indexed_head_block: 34812000, window_to_block: 34812000 },
    _coverage: { window_complete: true, result_complete: true, window_from_block: 34810000, window_to_block: 34812000 },
    _pagination: { has_more: false },
    _tool_contract: { name: 'portal_evm_get_contract_activity' },
  },
  partial: {
    answer: 'Only the first 8 of 40 matching transfers fit this page; nothing below is a total for the full window.',
    items: Array.from({ length: 8 }, (_, index) => ({
      timestamp_human: `${index + 2} min ago`, block_number: 34811159 - index * 3,
      tx_hash: `0x${String(index + 1).padStart(64, 'b')}`,
      sender: index % 2 ? '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' : '0x9be5ef21c1c4b722b4a15b6f7f2c2e0e8ba97516',
      recipient: index % 2 ? '0x9be5ef21c1c4b722b4a15b6f7f2c2e0e8ba97516' : '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      value_formatted: `${(950 + index * 210).toLocaleString()} USDC`, status: 'success',
    })),
    tables: [{ id: 'items', data_key: 'items', row_count: 40 }],
    _meta: { network: 'base-mainnet', row_count: 8, timeframe: '30m' },
    _freshness: { finality: 'unfinalized', indexed_head_block: 34811159 },
    _coverage: { window_complete: false, result_complete: false },
    _pagination: { has_more: true, next_cursor: 'partial-preview-cursor', continuation_scope: 'same_window' },
    _notice: 'The indexed head is behind the chain head for this network; the newest transfers may not be included yet.',
    _tool_contract: { name: 'portal_evm_query_token_transfers' },
    _ui: {
      version: 'portal_ui_v1', layout: 'dashboard', density: 'compact', design_intent: 'activity_investigator',
      headline: { title: 'Partial transfer evidence', subtitle: 'A continuation cursor is required before any totals are trustworthy.' },
      panels: [{ kind: 'table_panel', title: 'Returned transfer rows', table_id: 'items' }],
      follow_up_actions: [{ label: 'Load the next rows', intent: 'continue' }],
    },
  },
  error: {
    error: { code: 'overloaded', origin: 'server', summary: 'SQD is busy and could not start this query inside the bounded wait budget.', retryable: true, suggestions: ['Retry this request in a moment', 'Use a smaller timeframe'] },
    _coverage: { result_complete: false }, _pagination: { has_more: false }, _tool_contract: { name: 'portal_get_wallet_summary' },
  },
  empty: {
    answer: 'No matching blockchain activity was found in this window.', items: [],
    _meta: { network: 'tron-mainnet', row_count: 0, timeframe: '1h' }, _freshness: { finality: 'latest' },
    _coverage: { window_complete: true, result_complete: true }, _pagination: { has_more: false }, _tool_contract: { name: 'portal_get_recent_activity' },
  },
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
    if (payload.error) return [name, payload]
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
