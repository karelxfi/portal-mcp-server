import { createTheme } from '@wick-charts/react'

import { formatValue } from '../../format.js'
import { ACCENT_PALETTE } from '../../theme.js'

/**
 * Single source of truth for chart visual decisions.
 *
 * Every variant (Area / Line / Bar / Candlestick) reads its axis, grid,
 * tooltip, stroke, palette, margin, and threshold settings from here. Drift
 * between variants is prevented by construction: if a new polish pass wants
 * to change the tick gap or the line width, it changes ONE field here and
 * every chart inherits it.
 */
export const CHART = {
  // Container
  height: 310,
  margin: { top: 8, right: 20, left: 0, bottom: 8 } as const,

  // Downsampling — LTTB kicks in above this many points per series
  downsampleThreshold: 400,

  // Max visible series before collapsing the tail into an "Other (N)" bucket
  maxSeries: 8,

  // Line/area stroke
  lineWidth: 1.8,
  activeDotRadius: 4,

  // Area gradient opacity stops (top → bottom)
  areaGradient: { topOpacity: 0.35, bottomOpacity: 0.02 },

  // Delta pill — hide anything below this magnitude as bucket-rounding noise
  deltaMinPct: 0.5,

  // Axis defaults
  xAxis: {
    minTickGap: 48,
    tickMargin: 10,
    tickLine: false,
    axisLine: false,
  } as const,
  yAxis: {
    width: 52,
    tickLine: false,
    axisLine: false,
    tickFormatter: (v: number) => formatValue(v, 'compact_number'),
  } as const,

  // Grid — horizontal only, dashed at low contrast
  grid: { strokeDasharray: '2 4', vertical: false } as const,

  // Tooltip cursor
  tooltipCursorLine: { strokeDasharray: '4 4' } as const,
  tooltipCursorBar: { fill: 'rgba(255,255,255,0.04)' } as const,

  // Palette (re-exported so variants only import from chart/theme.ts)
  palette: ACCENT_PALETTE,

  // Candlestick colors
  candlestick: {
    up: '#26d0a8',
    down: '#ef5468',
    wickWidth: 1,
    bodyRadius: 1,
  },
} as const

export const WICK_THEME = createTheme({
  name: 'Portal Market',
  background: 'rgba(0, 0, 0, 0)',
  chartGradient: ['rgba(255,255,255,0)', 'rgba(255,255,255,0)'],
  typography: {
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    fontSize: 11,
  },
  grid: {
    color: 'rgba(190,204,224,0.06)',
    style: 'dashed',
  },
  seriesColors: ACCENT_PALETTE,
  candlestick: {
    up: { body: '#26d0a8', wick: '#26d0a8' },
    down: { body: '#ef5468', wick: '#ef5468' },
  },
  line: {
    color: ACCENT_PALETTE[0],
    width: 1.8,
    areaTopColor: 'rgba(0,166,255,0.32)',
    areaBottomColor: 'rgba(0,166,255,0)',
  },
  crosshair: {
    color: 'rgba(180,194,215,0.30)',
    labelBackground: 'rgba(8,10,14,0.97)',
    labelTextColor: '#e8edf5',
  },
  axis: {
    fontSize: 11,
    textColor: '#5d6675',
    y: {
      fontSize: 11,
      textColor: '#5d6675',
    },
  },
  yLabel: {
    fontSize: 11,
    upBackground: '#26d0a8',
    downBackground: '#ef5468',
    neutralBackground: '#5d6b7c',
    textColor: '#ffffff',
  },
  tooltip: {
    fontSize: 12,
    background: 'rgba(8,10,14,0.97)',
    textColor: '#e8edf5',
    borderColor: 'rgba(204,216,235,0.18)',
  },
  navigator: {
    background: 'rgba(128,148,170,0.08)',
    borderColor: 'rgba(128,148,170,0.18)',
  },
  fontUrl: null,
}).theme
