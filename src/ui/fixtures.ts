export type UiFixture = {
  id: string
  label: string
  payload: Record<string, unknown>
  expected: {
    charts: number
    canvases?: number
    tables?: number
  }
}

export const DEFAULT_FIXTURE_ID = 'full'

const BASE_TIME = Date.UTC(2026, 4, 1, 12, 0, 0) / 1000
const HOUR = 3600

function pseudo(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function makeTimeseries(count: number) {
  const rows: Array<{ timestamp: number; value: number; errors: number }> = []
  for (let i = count - 1; i >= 0; i--) {
    const t = BASE_TIME - i * HOUR
    const base = 3200 + Math.sin(i / 6) * 900 + Math.cos(i / 3) * 300
    const jitter = (Math.sin(i * 7.2) + 1) * 400
    rows.push({
      timestamp: t,
      value: Math.round(base + jitter),
      errors: Math.max(0, Math.round((Math.sin(i / 5) + 1) * 30)),
    })
  }
  return rows
}

function makeOhlc(count: number) {
  const random = pseudo(0x0788)
  const rows: Array<{
    timestamp: number
    open: number
    high: number
    low: number
    close: number
    volume: number
  }> = []
  let last = 3400
  for (let i = count - 1; i >= 0; i--) {
    const open = last
    const drift = Math.sin(i / 5) * 80 + (random() - 0.5) * 60
    const close = Math.max(0, open + drift)
    const high = Math.max(open, close) + random() * 40 + 10
    const low = Math.min(open, close) - random() * 40 - 10
    rows.push({
      timestamp: BASE_TIME - i * HOUR,
      open,
      high,
      low: Math.max(0, low),
      close,
      volume: Math.round(700 + random() * 1300),
    })
    last = close
  }
  return rows
}

function makeStacked(count: number) {
  const rows: Array<{
    timestamp: number
    success: number
    reverted: number
    pending: number
  }> = []
  for (let i = count - 1; i >= 0; i--) {
    const base = 2000 + Math.sin(i / 6) * 400
    rows.push({
      timestamp: BASE_TIME - i * HOUR,
      success: Math.round(base + (Math.cos(i / 4) + 1) * 100),
      reverted: Math.round(200 + Math.sin(i / 3) * 80),
      pending: Math.round(100 + Math.cos(i / 4) * 40),
    })
  }
  return rows
}

const timeseriesRows = makeTimeseries(72)
const ohlcRows = makeOhlc(60)
const stackedRows = makeStacked(72)
const stressRows = makeTimeseries(96).map((row, index) => {
  const polarity = index % 9 === 0 ? -1 : 1
  return {
    timestamp: row.timestamp,
    flows: {
      usdc_inflow: Math.round(row.value * 820),
      weth_outflow: Math.round(row.value * 430 * polarity),
      sequencer_rebates: Math.round((row.errors + 8) * 18_000),
      failed_settlements: -Math.round((row.errors + 3) * 11_500),
    },
  }
})

const topContractRows = [
  { rank: 1, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', label: 'USDC', transaction_count: 284_321, percentage: 18.4 },
  { rank: 2, address: '0x4200000000000000000000000000000000000006', label: 'WETH', transaction_count: 201_884, percentage: 13.0 },
  { rank: 3, address: '0x2626664c2603336e57b271c5c0b26f421741e481', label: 'Uniswap Router', transaction_count: 164_502, percentage: 10.6 },
  { rank: 4, address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', label: 'Aerodrome', transaction_count: 142_117, percentage: 9.2 },
  { rank: 5, address: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c', label: 'rETH', transaction_count: 98_442, percentage: 6.4 },
  { rank: 6, address: '0x6985884c4392d348587b19cb9eaaf157f13271cd', label: 'LayerZero', transaction_count: 72_091, percentage: 4.7 },
  { rank: 7, address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', label: 'cbETH', transaction_count: 61_884, percentage: 4.0 },
  { rank: 8, address: '0x4621b7a9c75199271f773ebd9a499dbd165c3191', label: 'Morpho', transaction_count: 52_018, percentage: 3.4 },
  { rank: 9, address: '0xa238dd80c259a72e81d7e4664a9801593f98d1c5', label: 'Base Bridge', transaction_count: 41_227, percentage: 2.7 },
  { rank: 10, address: '0xdac17f958d2ee523a2206206994597c13d831ec7', label: 'USDT', transaction_count: 38_710, percentage: 2.5 },
  { rank: 11, address: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', label: 'cbBTC', transaction_count: 29_118, percentage: 1.9 },
  { rank: 12, address: '0x0000000000000000000000000000000000004200', label: 'L2 System', transaction_count: 25_771, percentage: 1.7 },
]

const stressContractRows = [
  {
    rank: 1,
    address: '0x111111125421ca6dc452d289314280a0f8842a65',
    label: '1inch Aggregation Router v6',
    transaction_count: 7_884_221,
    percentage: 28.43,
  },
  {
    rank: 2,
    address: '0x000000000022d473030f116ddee9f6b43ac78ba3',
    label: 'Permit2 / Universal approvals',
    transaction_count: 5_102_004,
    percentage: 18.41,
  },
  {
    rank: 3,
    address: '0x4200000000000000000000000000000000000006',
    label: 'Wrapped Ether Gateway With A Name That Should Not Break Layout',
    transaction_count: 2_884_120,
    percentage: 10.41,
  },
  {
    rank: 4,
    address: '0xf000000000000000000000000000000000000042',
    label: 'Sequencer fee vault',
    transaction_count: 801_774,
    percentage: 2.89,
  },
]

const recentTxRows = [
  { timestamp: BASE_TIME - 60, label: 'WETH deposit', from: '0xabcd1234567890abcd1234567890abcd12345678', to: '0x4200000000000000000000000000000000000006', value: 2.34, status: 'Success' },
  { timestamp: BASE_TIME - 135, label: 'USDC transfer', from: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', to: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', value: 0.12, status: 'Success' },
  { timestamp: BASE_TIME - 240, label: 'Uniswap swap', from: '0xfeed1234feed1234feed1234feed1234feed1234', to: '0x2626664c2603336e57b271c5c0b26f421741e481', value: 8.77, status: 'Success' },
  { timestamp: BASE_TIME - 320, label: 'Aerodrome addLiquidity', from: '0x1111111111111111111111111111111111111111', to: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', value: 0.55, status: 'Reverted' },
  { timestamp: BASE_TIME - 410, label: 'LayerZero send', from: '0x2222222222222222222222222222222222222222', to: '0x6985884c4392d348587b19cb9eaaf157f13271cd', value: 12.01, status: 'Success' },
  { timestamp: BASE_TIME - 520, label: 'rETH mint', from: '0x3333333333333333333333333333333333333333', to: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c', value: 1.89, status: 'Success' },
  { timestamp: BASE_TIME - 605, label: 'Morpho repay', from: '0x4444444444444444444444444444444444444444', to: '0x4621b7a9c75199271f773ebd9a499dbd165c3191', value: 4.22, status: 'Success' },
]

const statRows = [
  { label: 'Total transactions', value: 1_547_022, format: 'compact_number' },
  { label: 'Unique addresses', value: 312_441, format: 'compact_number' },
  { label: 'Total gas', value: 842.41, format: 'decimal', unit: 'ETH' },
  { label: 'Avg gas price', value: 0.18, format: 'gwei' },
  { label: 'Success rate', value: 97.6, format: 'percent' },
  { label: 'Reverted', value: 36_884, format: 'compact_number' },
]

const commonHeadline = {
  headline: {
    title: 'Base mainnet activity',
    subtitle: 'Top 12 contracts over the last 72 hours',
  },
}

const tableDescriptor = {
  id: 'contracts',
  title: 'Contracts',
  data_key: 'top_contracts',
  default_sort: { key: 'transaction_count', direction: 'desc' },
  interactions: { sortable: true, searchable: true },
  columns: [
    { key: 'rank', label: '#', kind: 'rank', format: 'integer', align: 'right' },
    { key: 'label', label: 'Label', kind: 'dimension' },
    { key: 'address', label: 'Address', kind: 'dimension', format: 'address' },
    { key: 'transaction_count', label: 'Transactions', kind: 'metric', format: 'integer', align: 'right' },
    { key: 'percentage', label: 'Share', kind: 'metric', format: 'percent', align: 'right' },
  ],
}

const stressTableDescriptor = {
  id: 'stress_contracts',
  title: 'Stress contracts',
  data_key: 'stress_contracts',
  default_sort: { key: 'transaction_count', direction: 'desc' },
  interactions: { sortable: true, searchable: true },
  columns: [
    { key: 'rank', label: '#', kind: 'rank', format: 'integer', align: 'right' },
    { key: 'label', label: 'Contract label', kind: 'dimension' },
    { key: 'address', label: 'Address', kind: 'dimension', format: 'address' },
    { key: 'transaction_count', label: 'Transactions', kind: 'metric', format: 'integer', align: 'right' },
    { key: 'percentage', label: 'Share', kind: 'metric', format: 'percent', align: 'right' },
  ],
}

const presetAreaChart: Record<string, unknown> = {
  _tool_contract: { name: 'portal_get_time_series' },
  display: { title: 'Transactions per hour' },
  _ui: {
    ...commonHeadline,
    panels: [
      {
        kind: 'chart_panel',
        title: 'Transactions per hour',
        subtitle: 'Hourly bucketed transaction count',
        chart_key: 'chart',
      },
    ],
  },
  chart: {
    title: 'Transactions per hour',
    data_key: 'series',
    x_field: 'timestamp',
    y_field: 'value',
    y_axis_label: 'Transactions',
    recommended_visual: 'bar',
    value_format: 'integer',
    unit: 'transactions',
  },
  series: timeseriesRows,
}

const presetStackedArea: Record<string, unknown> = {
  _tool_contract: { name: 'portal_get_time_series' },
  _ui: {
    ...commonHeadline,
    panels: [
      {
        kind: 'chart_panel',
        title: 'Transaction outcomes (stacked)',
        subtitle: 'Success / reverted / pending share over time',
        chart_key: 'chart',
      },
    ],
  },
  chart: {
    title: 'Transaction outcomes',
    data_key: 'series',
    x_field: 'timestamp',
    grouped_value_field: 'outcomes',
    grouped_value_mode: 'object_map',
    series_keys: ['success', 'reverted', 'pending'],
    recommended_visual: 'bar',
    stacked: true,
    value_format: 'compact_number',
  },
  series: stackedRows.map((row) => ({
    timestamp: row.timestamp,
    outcomes: {
      success: row.success,
      reverted: row.reverted,
      pending: row.pending,
    },
  })),
}

const presetBarChart: Record<string, unknown> = {
  _tool_contract: { name: 'portal_get_time_series' },
  _ui: {
    ...commonHeadline,
    panels: [
      {
        kind: 'chart_panel',
        title: 'Transactions per hour (bar)',
        chart_key: 'chart',
      },
    ],
  },
  chart: {
    title: 'Transactions per hour',
    data_key: 'series',
    x_field: 'timestamp',
    y_field: 'value',
    y_axis_label: 'Transactions',
    recommended_visual: 'bar',
    value_format: 'integer',
  },
  series: timeseriesRows,
}

const presetCandlestick: Record<string, unknown> = {
  _tool_contract: { name: 'portal_evm_get_ohlc' },
  _ui: {
    headline: {
      title: 'ETH / USD - 1h candles',
      subtitle: 'Last 60 hourly candles',
    },
    panels: [
      {
        kind: 'chart_panel',
        title: 'ETH / USD',
        subtitle: '1h OHLC candles',
        chart_key: 'chart',
      },
    ],
  },
  chart: {
    title: 'ETH / USD - 1h',
    data_key: 'series',
    x_field: 'timestamp',
    open_field: 'open',
    high_field: 'high',
    low_field: 'low',
    close_field: 'close',
    volume_field: 'volume',
    recommended_visual: 'candlestick',
    value_format: 'currency_usd',
    unit: 'USD',
  },
  series: ohlcRows,
}

const presetKpi: Record<string, unknown> = {
  _tool_contract: { name: 'portal_get_time_series' },
  _ui: {
    headline: {
      title: 'Base mainnet snapshot',
      subtitle: 'Key metrics with trend',
    },
    panels: [
      {
        kind: 'kpi_panel',
        title: 'Network KPIs',
        subtitle: 'vs. previous 24h',
        cards: [
          {
            label: 'Transactions / 24h',
            value_path: 'metrics.tx_count',
            format: 'compact_number',
            comparison_value_path: 'metrics.tx_count_prev',
            trend_values_path: 'metrics.tx_trend',
          },
          {
            label: 'Unique addresses',
            value_path: 'metrics.unique_addrs',
            format: 'compact_number',
            comparison_value_path: 'metrics.unique_addrs_prev',
            trend_values_path: 'metrics.addrs_trend',
          },
          {
            label: 'Gas spent',
            value_path: 'metrics.gas_eth',
            format: 'decimal',
            unit: 'ETH',
            comparison_value_path: 'metrics.gas_eth_prev',
            trend_values_path: 'metrics.gas_trend',
            color: '#ffb341',
          },
          {
            label: 'Success rate',
            value_path: 'metrics.success_rate',
            format: 'percent',
            comparison_value_path: 'metrics.success_rate_prev',
            trend_values_path: 'metrics.success_trend',
            color: '#30d158',
          },
        ],
      },
    ],
  },
  metrics: {
    tx_count: 1_547_022,
    tx_count_prev: 1_321_884,
    tx_trend: timeseriesRows.slice(-24).map((r) => r.value),
    unique_addrs: 312_441,
    unique_addrs_prev: 328_110,
    addrs_trend: timeseriesRows.slice(-24).map((r) => Math.round(r.value * 0.21)),
    gas_eth: 842.41,
    gas_eth_prev: 790.12,
    gas_trend: timeseriesRows.slice(-24).map((r) => r.value / 3500),
    success_rate: 97.6,
    success_rate_prev: 97.9,
    success_trend: timeseriesRows.slice(-24).map((r) => 97 + Math.sin(r.timestamp / 3600) * 1.5),
  },
}

const presetTable: Record<string, unknown> = {
  _tool_contract: { name: 'portal_evm_get_analytics' },
  _ui: {
    headline: {
      title: 'Contract table',
      subtitle: 'Sortable/searchable dense table fixture',
    },
    panels: [
      {
        kind: 'table_panel',
        title: 'Contracts',
        table_id: 'contracts',
      },
    ],
  },
  tables: [tableDescriptor],
  top_contracts: topContractRows,
}

const presetFullBoard: Record<string, unknown> = {
  _tool_contract: { name: 'portal_evm_get_contract_activity' },
  _pagination: { has_more: true, next_cursor: 'abc123' },
  display: { title: 'Base mainnet contract activity' },
  _ui: {
    ...commonHeadline,
    follow_up_actions: [
      { intent: 'continue', label: 'Load more' },
      { intent: 'compare_previous', label: 'Compare previous' },
    ],
    panels: [
      {
        kind: 'chart_panel',
        title: 'Transactions per hour',
        subtitle: 'Hourly bucketed transaction count',
        chart_key: 'chart',
      },
      {
        kind: 'stat_list_panel',
        title: 'Network summary',
        subtitle: 'Aggregate stats for the window',
        data_key: 'stat_list',
        label_key: 'label',
        value_key: 'value',
        value_format: 'compact_number',
      },
      {
        kind: 'ranked_bars_panel',
        title: 'Top contracts by transaction count',
        subtitle: 'Share of total activity',
        data_key: 'top_contracts',
        category_key: 'label',
        value_key: 'transaction_count',
        value_format: 'integer',
      },
      {
        kind: 'timeline_panel',
        title: 'Recent transactions',
        subtitle: 'Latest confirmed activity on the network',
        data_key: 'recent_transactions',
        timestamp_key: 'timestamp',
        title_key: 'label',
        subtitle_keys: ['to', 'from'],
        badge_key: 'status',
      },
    ],
  },
  chart: {
    title: 'Transactions per hour',
    data_key: 'series',
    x_field: 'timestamp',
    y_field: 'value',
    y_axis_label: 'Transactions',
    recommended_visual: 'line',
    value_format: 'integer',
  },
  series: timeseriesRows,
  stat_list: statRows,
  top_contracts: topContractRows,
  recent_transactions: recentTxRows,
}

const presetStressBoard: Record<string, unknown> = {
  _tool_contract: { name: 'portal_get_time_series' },
  _notice: 'Stress fixture: long labels, signed values, dense series, and table overflow are intentional.',
  display: { title: 'Stress market board' },
  _ui: {
    headline: {
      title: 'Base market flow stress board',
      subtitle: 'Signed value flow, long labels, dense rows, and ugly edge cases',
    },
    panels: [
      {
        kind: 'chart_panel',
        title: 'Net value flow by source',
        subtitle: '96 hourly buckets with positive and negative flows',
        chart_key: 'chart',
      },
      {
        kind: 'ranked_bars_panel',
        title: 'Concentration by contract',
        subtitle: 'Long labels and exact values',
        data_key: 'stress_contracts',
        category_key: 'label',
        value_key: 'transaction_count',
        value_format: 'integer',
      },
      {
        kind: 'table_panel',
        title: 'Contract evidence table',
        table_id: 'stress_contracts',
      },
    ],
  },
  chart: {
    title: 'Net value flow',
    data_key: 'stress_series',
    x_field: 'timestamp',
    grouped_value_field: 'flows',
    grouped_value_mode: 'object_map',
    series_keys: ['usdc_inflow', 'weth_outflow', 'sequencer_rebates', 'failed_settlements'],
    recommended_visual: 'line',
    value_format: 'currency_usd',
  },
  stress_series: stressRows,
  tables: [stressTableDescriptor],
  stress_contracts: stressContractRows,
}

export const UI_FIXTURES: UiFixture[] = [
  { id: 'full', label: 'Full board', payload: presetFullBoard, expected: { charts: 1 } },
  { id: 'area', label: 'Area chart', payload: presetAreaChart, expected: { charts: 1 } },
  { id: 'stacked', label: 'Stacked area', payload: presetStackedArea, expected: { charts: 1 } },
  { id: 'bar', label: 'Bar chart', payload: presetBarChart, expected: { charts: 1 } },
  { id: 'candlestick', label: 'Candlestick', payload: presetCandlestick, expected: { charts: 1 } },
  { id: 'kpi', label: 'KPI + sparklines', payload: presetKpi, expected: { charts: 0, canvases: 4 } },
  { id: 'table', label: 'Table', payload: presetTable, expected: { charts: 0, tables: 1 } },
  { id: 'stress', label: 'Stress board', payload: presetStressBoard, expected: { charts: 1, tables: 1 } },
]

export function getUiFixture(id: string | null | undefined): UiFixture {
  return UI_FIXTURES.find((fixture) => fixture.id === id) ?? UI_FIXTURES[0]!
}
