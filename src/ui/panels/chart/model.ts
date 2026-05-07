import { asArray, formatValue, getByPath, humanize, isRecord, toNumber } from '../../format.js'
import { lttb, type Point } from '../../lttb.js'
import { CHART } from './theme.js'

export type ChartRecord = {
  /** "chart_panel" family accepts either kind or recommended_visual */
  kind?: string
  title?: string
  data_key?: string
  x_field?: string
  y_field?: string
  y_axis_label?: string
  grouped_value_field?: string
  grouped_value_mode?: string
  series_keys?: string[]
  recommended_visual?: string
  /** Area charts only: stack all series into a composition */
  stacked?: boolean
  /**
   * OHLC candlestick support. The convenience helper
   * `buildCandlestickChart` on the tool side emits a grouped
   * `candle_fields: { open, high, low, close }` object. We accept either
   * that shape OR flat {open,high,low,close}_field props.
   */
  candle_fields?: {
    open?: string
    high?: string
    low?: string
    close?: string
  }
  open_field?: string
  high_field?: string
  low_field?: string
  close_field?: string
  /** Volume field, typically plotted as a companion bar chart below candles. */
  volume_field?: string
  unit?: string
  /** Tool convenience helpers emit `price_unit` on candlestick charts. */
  price_unit?: string
  value_format?: string
}

export type SeriesPoint = { label: string; value: number; rawX: unknown }

export type Series = {
  key: string
  label: string
  color: string
  points: SeriesPoint[]
}

/**
 * One OHLC candle. Emitted by the candlestick variant instead of regular
 * series. Consumers see `model.ohlc` when `model.visual === 'candlestick'`.
 */
export type OhlcCandle = {
  label: string
  rawX: unknown
  open: number
  high: number
  low: number
  close: number
}

export type ChartVisual = 'line' | 'area' | 'bar' | 'candlestick'

export type ChartModel = {
  title: string
  visual: ChartVisual
  stacked: boolean
  series: Series[]
  xLabels: string[]
  unit?: string
  valueFormat?: string
  downsampledFrom?: number
  ohlc?: OhlcCandle[]
}

function labelFromRow(row: unknown, chart: ChartRecord, index: number): string {
  const human =
    getByPath(row, 'timestamp_human') ??
    getByPath(row, chart.x_field || 'timestamp') ??
    getByPath(row, 'timestamp')
  if (typeof human === 'string') return human
  if (human === undefined || human === null) return `#${index + 1}`
  return formatValue(
    human,
    chart.x_field === 'timestamp' || chart.x_field === undefined ? 'timestamp_human' : undefined,
  )
}

function discoverGroupedKeys(rows: unknown[], field: string): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    const value = getByPath(row, field)
    if (isRecord(value)) Object.keys(value).forEach((k) => keys.add(k))
  }
  return Array.from(keys)
}

function resolveCandleFields(chart: ChartRecord): {
  open: string
  high: string
  low: string
  close: string
} | null {
  // Tool convenience shape: { candle_fields: { open, high, low, close } }
  if (chart.candle_fields) {
    const { open, high, low, close } = chart.candle_fields
    if (open && high && low && close) return { open, high, low, close }
  }
  // Flat shape: open_field / high_field / low_field / close_field
  if (chart.open_field && chart.high_field && chart.low_field && chart.close_field) {
    return {
      open: chart.open_field,
      high: chart.high_field,
      low: chart.low_field,
      close: chart.close_field,
    }
  }
  return null
}

function isCandlestickChart(chart: ChartRecord): boolean {
  if (chart.kind === 'candlestick') return true
  if (chart.recommended_visual === 'candlestick') return true
  return resolveCandleFields(chart) !== null
}

function buildCandlestickModel(chart: ChartRecord, payload: unknown): ChartModel {
  const fields = resolveCandleFields(chart) ?? {
    open: 'open',
    high: 'high',
    low: 'low',
    close: 'close',
  }
  const rows = asArray(getByPath(payload, chart.data_key))

  const ohlc: OhlcCandle[] = rows.map((row, i) => ({
    label: labelFromRow(row, chart, i),
    rawX: getByPath(row, chart.x_field || 'timestamp'),
    open: toNumber(getByPath(row, fields.open)) ?? 0,
    high: toNumber(getByPath(row, fields.high)) ?? 0,
    low: toNumber(getByPath(row, fields.low)) ?? 0,
    close: toNumber(getByPath(row, fields.close)) ?? 0,
  }))

  // Build a pseudo-series of "close" so downstream summary/delta helpers work.
  const closeSeries: Series = {
    key: 'close',
    label: 'Close',
    color: CHART.palette[0]!,
    points: ohlc.map((c) => ({ label: c.label, value: c.close, rawX: c.rawX })),
  }

  return {
    title: chart.title || 'OHLC',
    visual: 'candlestick',
    stacked: false,
    series: [closeSeries],
    xLabels: ohlc.map((c) => c.label),
    unit: chart.unit ?? chart.price_unit,
    valueFormat: chart.value_format,
    ohlc,
  }
}

export function buildChartModel(chart: ChartRecord, payload: unknown): ChartModel {
  if (isCandlestickChart(chart)) {
    return buildCandlestickModel(chart, payload)
  }

  const rows = asArray(getByPath(payload, chart.data_key))
  const xLabels = rows.map((row, i) => labelFromRow(row, chart, i))

  const visualRaw =
    chart.recommended_visual === 'bar' && !chart.grouped_value_field ? 'bar' : 'line'
  let series: Series[] = []

  if (chart.grouped_value_field && chart.grouped_value_mode === 'object_map') {
    const keys =
      Array.isArray(chart.series_keys) && chart.series_keys.length
        ? chart.series_keys
        : discoverGroupedKeys(rows, chart.grouped_value_field)
    series = keys.map((key, i) => ({
      key,
      label: humanize(key),
      color: CHART.palette[i % CHART.palette.length]!,
      points: rows.map((row, rowIdx) => ({
        label: xLabels[rowIdx]!,
        value: toNumber(getByPath(row, `${chart.grouped_value_field}.${key}`)) ?? 0,
        rawX: getByPath(row, chart.x_field || 'timestamp'),
      })),
    }))
  } else if (chart.grouped_value_field) {
    const grouped = new Map<string, unknown[]>()
    const xLabelMap = new Map<unknown, string>()
    rows.forEach((row, index) => {
      const key = String(getByPath(row, chart.grouped_value_field!) ?? 'Other')
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(row)
      const xValue =
        getByPath(row, chart.x_field || 'timestamp') ?? getByPath(row, 'timestamp')
      if (!xLabelMap.has(xValue)) xLabelMap.set(xValue, xLabels[index]!)
    })

    const uniqueX = Array.from(xLabelMap.entries()).map(([value, label]) => ({ value, label }))

    series = Array.from(grouped.entries()).map(([key, groupedRows], i) => {
      const byX = new Map<unknown, number>()
      for (const row of groupedRows) {
        const xValue =
          getByPath(row, chart.x_field || 'timestamp') ?? getByPath(row, 'timestamp')
        byX.set(xValue, toNumber(getByPath(row, chart.y_field || 'value')) ?? 0)
      }
      return {
        key,
        label: humanize(key),
        color: CHART.palette[i % CHART.palette.length]!,
        points: uniqueX.map((entry) => ({
          label: entry.label,
          value: byX.get(entry.value) ?? 0,
          rawX: entry.value,
        })),
      }
    })
  } else {
    series = [
      {
        key: chart.y_field || 'value',
        label: humanize(chart.y_axis_label || chart.y_field || chart.title || 'value'),
        color: CHART.palette[0]!,
        points: rows.map((row, i) => ({
          label: xLabels[i]!,
          value: toNumber(getByPath(row, chart.y_field || 'value')) ?? 0,
          rawX: getByPath(row, chart.x_field || 'timestamp'),
        })),
      },
    ]
  }

  // Collapse series beyond the cap into a single "Other (N)" row.
  let cappedSeries = series
  if (series.length > CHART.maxSeries) {
    const top = series.slice(0, CHART.maxSeries - 1)
    const rest = series.slice(CHART.maxSeries - 1)
    const merged: Series = {
      key: '__other__',
      label: `Other (${rest.length})`,
      color: CHART.palette[CHART.maxSeries - 1]!,
      points: (top[0]?.points ?? []).map((_, i) => ({
        label: top[0]!.points[i]!.label,
        value: rest.reduce((acc, s) => acc + (s.points[i]?.value ?? 0), 0),
        rawX: top[0]!.points[i]!.rawX,
      })),
    }
    cappedSeries = [...top, merged]
  }

  // LTTB downsampling when a series exceeds the visual-detail ceiling.
  let downsampledFrom: number | undefined
  const originalLen = cappedSeries[0]?.points.length ?? 0
  if (originalLen > CHART.downsampleThreshold) {
    downsampledFrom = originalLen
    cappedSeries = cappedSeries.map((s) => {
      const pts: Point[] = s.points.map((p, i) => ({ x: i, y: p.value, label: p.label }))
      const reduced = lttb(pts, CHART.downsampleThreshold)
      return {
        ...s,
        points: reduced.map((p) => ({
          label: s.points[Math.round(p.x)]!.label,
          value: p.y,
          rawX: s.points[Math.round(p.x)]!.rawX,
        })),
      }
    })
  }

  return {
    title: chart.title || 'Chart',
    visual: visualRaw === 'bar' ? 'bar' : cappedSeries.length === 1 ? 'area' : 'line',
    stacked: Boolean(chart.stacked),
    series: cappedSeries,
    xLabels: cappedSeries[0]?.points.map((p) => p.label) ?? xLabels,
    unit: chart.unit,
    valueFormat: chart.value_format,
    downsampledFrom,
  }
}

/** Compute the summary row's hero value and delta pill state. */
export type ChartSummary = {
  hero: string
  heroLabel: string
  showDelta: boolean
  deltaLabel: string
  deltaClass: string
}

export function buildSummary(model: ChartModel): ChartSummary {
  const primary = model.series[0]
  if (!primary || !primary.points.length) {
    return {
      hero: 'n/a',
      heroLabel: 'Latest',
      showDelta: false,
      deltaLabel: '',
      deltaClass: '',
    }
  }

  const latestPrimary = primary.points[primary.points.length - 1]?.value ?? 0
  const firstPrimary = primary.points[0]?.value ?? 0

  const deltaPct =
    firstPrimary > 0 ? ((latestPrimary - firstPrimary) / firstPrimary) * 100 : 0
  const showDelta = firstPrimary > 0 && Math.abs(deltaPct) >= CHART.deltaMinPct
  const arrow = deltaPct >= 0 ? '▲' : '▼'
  const deltaLabel = `${arrow} ${Math.abs(deltaPct).toFixed(1)}%`
  const deltaClass =
    deltaPct >= 0 ? 'pt-chart-summary__delta--pos' : 'pt-chart-summary__delta--neg'

  const hero = formatValue(latestPrimary, model.valueFormat, undefined)
  const heroLabel = `Latest${model.unit ? ` · ${model.unit}` : ''}`

  return { hero, heroLabel, showDelta, deltaLabel, deltaClass }
}

/**
 * Build an X-axis tick formatter that compacts verbose labels.
 *
 * Heuristics:
 *   - Try to parse each label to a Date. If it parses, we have a time-series.
 *   - If all labels fall on the same calendar day → show "HH:mm".
 *   - Otherwise → show "MMM d HH:mm".
 *   - If parsing fails, strip "YYYY-MM-DD " prefix and " UTC" suffix.
 */
export function makeXTickFormatter(labels: string[]): (label: string) => string {
  const parsed = labels.map((l) => {
    const d = new Date(l)
    return Number.isFinite(d.getTime()) ? d : null
  })
  const allParsed = parsed.every((d) => d !== null)

  if (allParsed && parsed.length > 0) {
    const first = parsed[0] as Date
    const last = parsed[parsed.length - 1] as Date
    const sameDay =
      first.getFullYear() === last.getFullYear() &&
      first.getMonth() === last.getMonth() &&
      first.getDate() === last.getDate()

    const timeOnly = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const dateAndTime = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    return (label: string) => {
      const d = new Date(label)
      if (!Number.isFinite(d.getTime())) return label
      return sameDay ? timeOnly.format(d) : dateAndTime.format(d)
    }
  }

  return (label: string) => {
    const trimmed = label.replace(/ UTC$/, '').trim()
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/)
    if (match) return match[2]!
    return trimmed
  }
}
