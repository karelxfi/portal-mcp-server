import { useMemo } from 'react'
import {
  BarSeries,
  CandlestickSeries,
  ChartContainer,
  Crosshair,
  LineSeries,
  TimeAxis,
  Tooltip,
  YAxis,
  YLabel,
  type OHLCInput,
  type TimePoint,
  type TooltipField,
} from '@wick-charts/react'

import { Card, Text } from '../components/primitives.js'
import { formatAxisValue, formatValue, toNumber } from '../format.js'
import { getByPath, isRecord } from '../format.js'
import {
  buildChartModel,
  buildSummary,
  type ChartModel,
  type ChartRecord,
} from './chart/model.js'
import { ChartCard, ChartLegend, type ChartStat } from './chart/primitives.js'
import { CHART, WICK_THEME } from './chart/theme.js'

export type ChartPanel = {
  kind: 'chart_panel'
  title?: string
  subtitle?: string
  chart_key: string
}

function toMillis(value: unknown, index: number): number {
  const numeric = toNumber(value)
  if (numeric === null) return Date.UTC(2026, 0, 1, 0, index, 0)
  return numeric > 10_000_000_000 ? numeric : numeric * 1000
}

function buildTimeSeriesLayers(model: ChartModel): TimePoint[][] {
  return model.series.map((series) =>
    series.points.map((point, index) => ({
      time: toMillis(point.rawX, index),
      value: point.value,
    })),
  )
}

function buildCandles(model: ChartModel): OHLCInput[] {
  return (model.ohlc ?? []).map((candle, index) => ({
    time: toMillis(candle.rawX, index),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }))
}

function formatChartValue(model: ChartModel) {
  return (value: number, field?: TooltipField) => {
    const format = field === 'volume' ? 'compact_number' : model.valueFormat
    return formatValue(value, format, model.unit)
  }
}

function formatChartAxisValue(model: ChartModel) {
  return (value: number) => formatAxisValue(value, model.valueFormat)
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

function buildChartStats(model: ChartModel): ChartStat[] {
  if (model.visual === 'candlestick' && model.ohlc?.length) {
    const latest = model.ohlc[model.ohlc.length - 1]!
    return [
      { label: 'Open', value: formatValue(latest.open, model.valueFormat) },
      { label: 'High', value: formatValue(latest.high, model.valueFormat) },
      { label: 'Low', value: formatValue(latest.low, model.valueFormat) },
      { label: 'Close', value: formatValue(latest.close, model.valueFormat) },
    ]
  }

  const values = model.series.flatMap((series) => series.points.map((point) => point.value))
  if (!values.length) return []
  const high = Math.max(...values)
  const low = Math.min(...values)
  if (model.visual === 'bar') {
    return [
      { label: 'Peak', value: formatValue(high, model.valueFormat) },
      { label: 'Avg', value: formatValue(average(values), model.valueFormat) },
    ]
  }
  return [
    { label: 'High', value: formatValue(high, model.valueFormat) },
    { label: 'Low', value: formatValue(low, model.valueFormat) },
    { label: 'Avg', value: formatValue(average(values), model.valueFormat) },
    { label: 'Points', value: formatValue(model.series[0]?.points.length ?? 0, 'integer') },
  ]
}

function getLatestLabelColor(model: ChartModel): string {
  if (model.visual !== 'candlestick' || !model.ohlc?.length) {
    return model.series[0]?.color || CHART.palette[0]!
  }

  const latest = model.ohlc[model.ohlc.length - 1]!
  return latest.close >= latest.open ? CHART.candlestick.up : CHART.candlestick.down
}

function WickChart({ model }: { model: ChartModel }) {
  const format = formatChartValue(model)
  const axisFormat = formatChartAxisValue(model)
  const colors = model.series.map((series) => series.color || CHART.palette[0]!)
  const latestLabelColor = getLatestLabelColor(model)
  const yAxisLabelCount = model.visual === 'candlestick' ? 4 : 5
  const common = {
    theme: WICK_THEME,
    style: { width: '100%', height: '100%' },
    className: 'pt-wick-chart__canvas-host',
    axis: { y: { visible: true, width: 86 }, x: { visible: true, height: 34 } },
    padding: { top: 14, bottom: 10, left: 16, right: { intervals: 0.65 } },
    animations: false as const,
    grid: { visible: true },
  }

  if (model.visual === 'candlestick') {
    return (
      <ChartContainer {...common}>
        <CandlestickSeries
          id="candles"
          data={buildCandles(model)}
          options={{
            bodyWidthRatio: 0.62,
            entryMs: false,
            smoothMs: false,
          }}
        />
        <Tooltip format={format} />
        <Crosshair />
        <YAxis format={axisFormat} labelCount={yAxisLabelCount} minLabelSpacing={44} />
        <YLabel seriesId="candles" format={axisFormat} color={latestLabelColor} />
        <TimeAxis minLabelSpacing={118} />
      </ChartContainer>
    )
  }

  const data = buildTimeSeriesLayers(model)
  const stacking = model.stacked ? 'normal' : 'off'

  return (
    <ChartContainer {...common}>
      {model.visual === 'bar' ? (
        <BarSeries
          id="bars"
          data={data}
          options={{
            colors,
            stacking,
            barWidthRatio: 0.72,
            entryMs: false,
            smoothMs: false,
          }}
        />
      ) : (
        <LineSeries
          id="lines"
          data={data}
          options={{
            colors,
            stacking,
            strokeWidth: CHART.lineWidth,
            area: { visible: model.visual === 'area' || model.stacked },
            pulse: false,
            entryMs: false,
            smoothMs: false,
          }}
        />
      )}
      <Tooltip format={format} />
      <Crosshair />
      <YAxis format={axisFormat} labelCount={yAxisLabelCount} minLabelSpacing={44} />
      {model.visual !== 'bar' && (
        <YLabel
          seriesId="lines"
          format={axisFormat}
          color={latestLabelColor}
        />
      )}
      <TimeAxis minLabelSpacing={118} />
    </ChartContainer>
  )
}

export function ChartPanelView({
  panel,
  payload,
}: {
  panel: ChartPanel
  payload: unknown
}) {
  const chart = useMemo(() => {
    if (panel.chart_key === 'chart') return (payload as Record<string, unknown>)?.chart
    return getByPath(payload, panel.chart_key)
  }, [panel, payload])

  if (!isRecord(chart)) {
    return (
      <Card title={panel.title || 'Chart'} subtitle={panel.subtitle} span="full">
        <Text tone="muted">No chart data is available for this result.</Text>
      </Card>
    )
  }

  const model = useMemo(
    () => (isRecord(chart) ? buildChartModel(chart as ChartRecord, payload) : null),
    [chart, payload],
  )

  if (!model || !model.series.length || !model.series[0]?.points.length) {
    return (
      <Card title={panel.title || model?.title || 'Chart'} subtitle={panel.subtitle} span="full">
        <Text tone="muted">No plotted points in the current window.</Text>
      </Card>
    )
  }

  const summary = buildSummary(model)
  const stats = buildChartStats(model)

  const subtitle =
    panel.subtitle ||
    (model.downsampledFrom
      ? `Showing ${model.series[0]!.points.length} of ${model.downsampledFrom} points`
      : undefined)

  return (
    <ChartCard
      title={panel.title || model.title}
      subtitle={subtitle}
      summary={summary}
      stats={stats}
      showSummary={model.visual !== 'bar'}
      chart={
        <div
          className="pt-wick-chart"
          data-chart-kind={model.visual}
          data-series-count={model.series.length}
        >
          <WickChart model={model} />
        </div>
      }
      footer={<ChartLegend model={model} />}
    />
  )
}
