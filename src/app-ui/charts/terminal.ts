import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  LineSeries,
  LineStyle,
  type UTCTimestamp,
  createChart,
} from 'lightweight-charts'

import { EXPLORER_CHART_CAPABILITIES } from '../capabilities.js'
import {
  CHART_COLORS,
  type ChartPoint,
  type ChartSeries,
  type ChartView,
  type Panel,
  TERMINAL_MONO,
  type TooltipRow,
  asArray,
  axisTitlesFit,
  card,
  displayLimitNotice,
  element,
  formatValue,
  getByPath,
  humanize,
  intervalSeconds,
  isRecord,
  numberRows,
  numeric,
  pillCompact,
  placeTooltip,
  renderTooltip,
  resolveColor,
  selectEvidenceRow,
  shortTimeLabel,
  sortRowsByX,
  splitTooltipValue,
  terminalColors,
  text,
  tickText,
  withAlpha,
} from '../common.js'
import { type RangeController, type RangeWindow, attachRangeGestures, chartRangeToolbar } from './range.js'

/* Candle terminals hold live lightweight-charts instances; every re-render
   must release the previous ones so canvases and observers do not pile up. */
const panelChartDisposers = new WeakMap<HTMLElement, () => void>()

let activeChartDisposers: Array<() => void> = []

export function disposeActiveCharts() {
  for (const dispose of activeChartDisposers.splice(0)) dispose()
}

function registerChartDisposer(panelRoot: HTMLElement, chart: IChartApi, extra: () => void) {
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    extra()
    chart.remove()
  }
  panelChartDisposers.set(panelRoot, dispose)
  activeChartDisposers.push(dispose)
}

function normalizeSeries(
  rows: Record<string, unknown>[],
  chart: Record<string, unknown>,
): {
  points: ChartPoint[]
  series: ChartSeries[]
} {
  const groupedField = text(chart.grouped_value_field)
  const groupedMode = text(chart.grouped_value_mode)
  const declaredKeys = asArray(chart.series_keys).map(text).filter(Boolean)
  const yField = text(chart.y_field || 'value')
  if (!groupedField) {
    return {
      points: rows.map((row) => {
        const value = numeric(getByPath(row, yField))
        return { row, values: [value ?? null] }
      }),
      /* The chart palette's series-1, not the interface accent: the accent is
         a text colour, and a fill at that lightness reads as a highlight. */
      series: [{ key: yField, label: text(chart.y_axis_label || humanize(yField)), color: CHART_COLORS[0] }],
    }
  }

  if (groupedMode === 'object_map') {
    const keys = declaredKeys.length
      ? declaredKeys
      : Array.from(
          new Set(
            rows.flatMap((row) => {
              const values = getByPath(row, groupedField)
              return isRecord(values) ? Object.keys(values) : []
            }),
          ),
        )
    return {
      points: rows.map((row) => {
        const values = getByPath(row, groupedField)
        return {
          row,
          values: keys.map((key) => {
            const value = numeric(isRecord(values) ? values[key] : undefined)
            return value ?? null
          }),
        }
      }),
      series: keys.map((key, index) => ({
        key,
        label: humanize(key),
        color: CHART_COLORS[index % CHART_COLORS.length],
      })),
    }
  }

  const xField = text(chart.x_field || 'timestamp')
  const pointMap = new Map<string, { row: Record<string, unknown>; values: Map<string, number> }>()
  const discoveredKeys: string[] = []
  for (const row of rows) {
    const seriesKey = text(getByPath(row, groupedField))
    const xValue = text(getByPath(row, xField) ?? getByPath(row, 'bucket_index') ?? pointMap.size)
    const value = numeric(getByPath(row, yField))
    if (!seriesKey || value === undefined) continue
    if (!discoveredKeys.includes(seriesKey)) discoveredKeys.push(seriesKey)
    const point = pointMap.get(xValue) ?? { row, values: new Map<string, number>() }
    point.values.set(seriesKey, value)
    pointMap.set(xValue, point)
  }
  const keys = declaredKeys.length ? declaredKeys : discoveredKeys
  return {
    points: Array.from(pointMap.values()).map((point) => ({
      row: point.row,
      values: keys.map((key) => point.values.get(key) ?? null),
    })),
    series: keys.map((key, index) => ({ key, label: humanize(key), color: CHART_COLORS[index % CHART_COLORS.length] })),
  }
}

/* Market terminals render through lightweight-charts: the canvas carries the
   candles, crosshair, and right price scale, while a transparent hit-button
   overlay keeps every candle keyboard-reachable, screen-readable, and linked
   to its exact evidence row. */
/* Portal marks both a still-forming last bucket and a bucket cut by the
   query window as incomplete. The bucket is still forming only when the
   indexed evidence ends before the requested window does; a historical
   window that ends mid-bucket is fixed and merely partial. */
function finalCandleStillForming(payload: Record<string, unknown>): boolean {
  const freshness = isRecord(payload._freshness) ? payload._freshness : {}
  const windowTo = numeric(freshness.window_to_block)
  const head = numeric(freshness.indexed_head_block)
  /* A window that reaches the indexed head is live; one that stops short of
     it is history. */
  if (windowTo !== undefined && head !== undefined) return windowTo >= head
  const summary = isRecord(payload.summary) ? payload.summary : {}
  return summary.window_anchor === 'indexed_head' || summary.window_anchor === 'latest_fill'
}

/*
 * One instrument for every chart. Candles, lines, areas, and bars all come
 * through here, so they share the grid, the crosshair, the right price scale,
 * the mono type, and the axis behaviour rather than each inventing its own.
 */
function createTerminalChart(
  mount: HTMLElement,
  colors: ReturnType<typeof terminalColors>,
  params: {
    scaleMargins: { top: number; bottom: number }
    tickLabel: (time: number) => string
    crosshair?: CrosshairMode
  },
): IChartApi {
  return createChart(mount, {
    autoSize: true,
    /* Every number the app formats goes through en-US, and the chart has to
       agree. Left to itself lightweight-charts takes the browser's locale,
       which on a host whose environment reports something like `en_US@posix`
       is not a valid language tag and throws out of the axis formatter. */
    localization: { locale: 'en-US' },
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: colors.ink,
      fontFamily: TERMINAL_MONO,
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid },
    },
    rightPriceScale: {
      borderColor: colors.axis,
      scaleMargins: params.scaleMargins,
    },
    timeScale: {
      borderColor: colors.axis,
      timeVisible: true,
      secondsVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
      tickMarkFormatter: params.tickLabel,
    },
    crosshair: {
      mode: params.crosshair ?? CrosshairMode.Magnet,
      vertLine: {
        color: colors.crosshair,
        width: 1,
        style: LineStyle.LargeDashed,
        labelBackgroundColor: colors.crosshairLabel,
      },
      horzLine: {
        color: colors.crosshair,
        width: 1,
        style: LineStyle.LargeDashed,
        labelBackgroundColor: colors.crosshairLabel,
      },
    },
    /* Zoom and pan are view-only. lightweight-charts handles the gestures it
       owns (axis drags, pinch); the overlay forwards wheel and drag, which
       would otherwise stop at the hit targets sitting above the canvas. */
    handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: {
      mouseWheel: false,
      pinch: true,
      axisPressedMouseMove: { time: true, price: false },
      axisDoubleClickReset: { time: true, price: false },
    },
    kineticScroll: { mouse: false, touch: false },
  })
}

function buildCandleTerminal(
  panelRoot: HTMLElement,
  chart: Record<string, unknown>,
  rows: Record<string, unknown>[],
  chartTitle: string,
  finalBucketForming: boolean,
  onViewChange?: (view: ChartView) => void,
): HTMLElement | null {
  const candleFields = isRecord(chart.candle_fields) ? chart.candle_fields : {}
  const openField = text(candleFields.open || 'open')
  const highField = text(candleFields.high || 'high')
  const lowField = text(candleFields.low || 'low')
  const closeField = text(candleFields.close || 'close')
  const volumeField = text(chart.volume_field || 'volume')
  const priceFormat = text(chart.value_format || 'decimal')
  const priceUnit = text(chart.price_unit)
  const volumeUnit = text(chart.volume_unit)
  const volumeFormat = volumeUnit.toUpperCase() === 'USD' ? 'currency_usd' : 'decimal'
  const tooltipDescriptor = isRecord(chart.tooltip) ? chart.tooltip : {}
  const tooltipFields = asArray(tooltipDescriptor.fields).filter(isRecord)
  const titleField = text(tooltipDescriptor.title_field)

  const parsed = rows.flatMap((row) => {
    const open = numeric(getByPath(row, openField))
    const high = numeric(getByPath(row, highField))
    const low = numeric(getByPath(row, lowField))
    const close = numeric(getByPath(row, closeField))
    if (open === undefined || high === undefined || low === undefined || close === undefined) return []
    return [{ row, open, high, low, close, volume: numeric(getByPath(row, volumeField)) }]
  })
  if (!parsed.length) return null

  const rawTimes = parsed.map((point) => numeric(point.row.timestamp))
  const monotonic = rawTimes.every(
    (value, index) => value !== undefined && (index === 0 || value > (rawTimes[index - 1] as number)),
  )
  const times = parsed.map((_point, index) => (monotonic ? (rawTimes[index] as number) : index * 60) as UTCTimestamp)
  const fullLabels = parsed.map((point, index) =>
    text(getByPath(point.row, titleField) ?? point.row.timestamp_human ?? point.row.timestamp ?? `Candle ${index + 1}`),
  )
  const timeToLabel = new Map<number, string>()
  times.forEach((time, index) =>
    timeToLabel.set(time as number, shortTimeLabel(fullLabels[index]) || fullLabels[index]),
  )
  /* Portal marks a still-forming bucket with bucket_complete/bucket_state;
     older payloads used is_closed or open_candle. Honor all of them. */
  const isOpenCandle = (point: (typeof parsed)[number]) =>
    point.row.is_closed === false ||
    point.row.open_candle === true ||
    point.row.bucket_complete === false ||
    point.row.bucket_state === 'open_or_partial'
  const hasVolume = chart.volume_panel !== false && parsed.some((point) => point.volume !== undefined)
  const volumeMax = hasVolume ? Math.max(...parsed.map((point) => point.volume ?? 0)) : 0
  const finalClose = parsed[parsed.length - 1].close
  const prices = parsed.flatMap((point) => [point.low, point.high])
  const priceSpan = Math.max(Math.max(...prices) - Math.min(...prices), Math.abs(finalClose) * 0.001, 1e-9)
  const minMove = 10 ** Math.min(0, Math.max(-8, Math.floor(Math.log10(priceSpan)) - 3))
  /* The price unit is named once in the tooltip title; a value repeats a
     unit only when it differs from the price unit. */
  const withUnit = (unit: string) => (unit && unit !== priceUnit ? unit : '')
  const candleFlag = (index: number) =>
    index === parsed.length - 1 && finalBucketForming ? 'Open candle, still forming' : 'Partial bucket'
  const exactRows = parsed.map((point, index) => {
    const fallback: TooltipRow[] = [
      { label: 'Open', value: formatValue(point.open, priceFormat) },
      { label: 'High', value: formatValue(point.high, priceFormat) },
      { label: 'Low', value: formatValue(point.low, priceFormat) },
      { label: 'Close', value: formatValue(point.close, priceFormat) },
      ...(point.volume !== undefined
        ? [{ label: 'Volume', value: formatValue(point.volume, volumeFormat, withUnit(volumeUnit)) }]
        : []),
    ]
    const rows: TooltipRow[] = tooltipFields.length
      ? tooltipFields.map((field) => {
          const key = text(field.path ?? field.key)
          return {
            label: text(field.label ?? humanize(key)),
            value: formatValue(getByPath(point.row, key), text(field.format), withUnit(text(field.unit))),
          }
        })
      : fallback
    if (isOpenCandle(point)) rows.push({ label: candleFlag(index), value: '', flag: true })
    return rows
  })
  const tooltipTitle = (index: number) => (priceUnit ? `${fullLabels[index]} · ${priceUnit}` : fullLabels[index])

  const terminal = element('div', 'sqd-candle-terminal')
  const readout = element('div', 'sqd-candle-readout')
  readout.setAttribute('aria-hidden', 'true')
  const chartBox = element('div', 'sqd-candle-chart')
  chartBox.setAttribute('role', 'group')
  chartBox.setAttribute(
    'aria-label',
    `${chartTitle}. ${parsed.length} candles. Last close ${formatValue(finalClose, priceFormat, priceUnit)}.`,
  )
  const mount = element('div', 'sqd-candle-canvas')
  mount.setAttribute('aria-hidden', 'true')
  const hits = element('div', 'sqd-chart-hits')
  const pill = element('div', 'sqd-candle-pill')
  pill.hidden = true
  pill.textContent =
    (priceFormat === 'currency_usd' ? '$' : '') +
    (Math.abs(finalClose) >= 1000 ? pillCompact(finalClose) : tickText(finalClose, priceFormat))
  chartBox.append(mount, hits, pill)
  let volumeCaption: HTMLElement | undefined
  if (hasVolume) {
    volumeCaption = element(
      'div',
      'sqd-chart-volume-caption',
      volumeUnit ? `VOLUME, ${volumeUnit.toUpperCase()}` : 'VOLUME',
    )
    volumeCaption.hidden = true
    chartBox.append(volumeCaption)
  }
  const attribution = element('a', 'sqd-chart-attribution', 'Charts by TradingView') as HTMLAnchorElement
  attribution.href = 'https://www.tradingview.com/'
  attribution.target = '_blank'
  attribution.rel = 'noopener noreferrer'
  terminal.append(readout, chartBox, attribution)

  const TERMINAL_COLORS = terminalColors()
  const chartApi = createTerminalChart(mount, TERMINAL_COLORS, {
    scaleMargins: { top: 0.06, bottom: hasVolume ? 0.3 : 0.08 },
    tickLabel: (time) => timeToLabel.get(time) ?? (monotonic ? new Date(time * 1000).toISOString().slice(11, 16) : ''),
  })
  const candleSeries = chartApi.addSeries(CandlestickSeries, {
    upColor: TERMINAL_COLORS.up,
    downColor: TERMINAL_COLORS.down,
    borderVisible: true,
    borderUpColor: TERMINAL_COLORS.up,
    borderDownColor: TERMINAL_COLORS.down,
    wickUpColor: TERMINAL_COLORS.up,
    wickDownColor: TERMINAL_COLORS.down,
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: { type: 'custom', formatter: (value: number) => tickText(value, priceFormat), minMove },
  })
  candleSeries.setData(
    parsed.map((point, index) => {
      const direction = point.close >= point.open ? TERMINAL_COLORS.up : TERMINAL_COLORS.down
      return {
        time: times[index],
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        ...(isOpenCandle(point) ? { color: 'rgba(0, 0, 0, 0)', borderColor: direction, wickColor: direction } : {}),
      }
    }),
  )
  candleSeries.createPriceLine({
    price: finalClose,
    color: TERMINAL_COLORS.accentLine,
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: false,
  })
  let volumeSeries: ReturnType<typeof chartApi.addSeries> | undefined
  if (hasVolume) {
    volumeSeries = chartApi.addSeries(HistogramSeries, {
      priceScaleId: 'sqd-volume',
      priceFormat: { type: 'custom', formatter: (value: number) => tickText(value, volumeFormat), minMove: 1 },
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0,
    })
    chartApi.priceScale('sqd-volume').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })
    volumeSeries.setData(
      parsed.flatMap((point, index) =>
        point.volume === undefined
          ? []
          : [
              {
                time: times[index],
                value: point.volume,
                color: point.close >= point.open ? TERMINAL_COLORS.upSoft : TERMINAL_COLORS.downSoft,
              },
            ],
      ),
    )
  }

  const readoutPair = (label: string, value: string, direction?: 'up' | 'down') => {
    const pair = element('span', 'sqd-candle-readout-pair')
    const valueNode = element('span', 'sqd-candle-readout-value', value)
    if (direction) valueNode.dataset.direction = direction
    pair.append(element('span', 'sqd-candle-readout-key', label), valueNode)
    return pair
  }
  /* The readout is the only hover surface: line one carries time and OHLCV,
     line two the remaining exact fields plus the forming-candle flag. Line
     two exists for every candle once any candle needs it, so hovering never
     changes the readout height and the chart below never resizes. */
  const CORE_ROW = /^(open|high|low|close|volume|closed candle|open candle)$/i
  const extraRows = exactRows.map((rows) => rows.filter((row) => !row.flag && !CORE_ROW.test(row.label)))
  const hasDetailLine = extraRows.some((rows) => rows.length > 0) || parsed.some(isOpenCandle)
  const readoutUnit = priceUnit && priceFormat !== 'currency_usd' ? priceUnit : ''
  const renderReadout = (index: number) => {
    const point = parsed[index]
    const direction = point.close >= point.open ? 'up' : 'down'
    const main = element('div', 'sqd-candle-readout-line')
    main.append(
      element('span', 'sqd-candle-readout-time', fullLabels[index]),
      ...(readoutUnit ? [element('span', 'sqd-candle-readout-unit', readoutUnit)] : []),
      readoutPair('O', formatValue(point.open, priceFormat)),
      readoutPair('H', formatValue(point.high, priceFormat)),
      readoutPair('L', formatValue(point.low, priceFormat)),
      readoutPair('C', formatValue(point.close, priceFormat), direction),
      ...(point.volume !== undefined ? [readoutPair('VOL', formatValue(point.volume, volumeFormat))] : []),
    )
    readout.replaceChildren(main)
    if (!hasDetailLine) return
    const detail = element('div', 'sqd-candle-readout-line sqd-candle-readout-line--detail')
    detail.append(
      ...extraRows[index].map((row) => readoutPair(row.label, row.value)),
      ...(isOpenCandle(point) ? [element('span', 'sqd-candle-readout-flag', candleFlag(index))] : []),
    )
    readout.append(detail)
  }
  renderReadout(parsed.length - 1)

  const buttons: HTMLButtonElement[] = []
  parsed.forEach((point, index) => {
    const button = element('button', 'sqd-chart-hit') as HTMLButtonElement
    button.type = 'button'
    button.setAttribute('data-candle-index', String(index))
    button.setAttribute('data-open', String(point.open))
    button.setAttribute('data-high', String(point.high))
    button.setAttribute('data-low', String(point.low))
    button.setAttribute('data-close', String(point.close))
    if (point.volume !== undefined) button.setAttribute('data-volume', String(point.volume))
    button.setAttribute(
      'aria-label',
      `${tooltipTitle(index)}. ${exactRows[index].map((row) => `${row.label} ${row.value}`.trim()).join('. ')}.`,
    )
    button.setAttribute('aria-pressed', 'false')
    button.style.left = `${(index / parsed.length) * 100}%`
    button.style.width = `${100 / parsed.length}%`
    const hover = () => {
      renderReadout(index)
      chartApi.setCrosshairPosition(point.close, times[index], candleSeries)
    }
    const unhover = () => {
      chartApi.clearCrosshairPosition()
      renderReadout(parsed.length - 1)
    }
    button.addEventListener('pointerenter', hover)
    button.addEventListener('pointerleave', unhover)
    button.addEventListener('focus', hover)
    button.addEventListener('blur', unhover)
    button.addEventListener('click', () => selectEvidenceRow(point.row, button))
    /* Left and right step between candles, which is what a keyboard user
       expects from a row of them; the chart's own zoom and pan keys stay on
       the surface underneath. */
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const step = event.key === 'ArrowLeft' ? -1 : 1
      const next = buttons.slice(index + step, index + step + 1).find((candidate) => !candidate.hidden)
      if (!next) return
      event.preventDefault()
      event.stopPropagation()
      next.focus()
    })
    hits.append(button)
    buttons.push(button)
  })

  const sync = () => {
    const timeScale = chartApi.timeScale()
    const coordinates = times.map((time) => timeScale.timeToCoordinate(time))
    if (coordinates.some((coordinate) => coordinate === null)) return
    const xs = coordinates as number[]
    const slot =
      xs.length > 1 ? Math.max(8, (xs[xs.length - 1] - xs[0]) / (xs.length - 1)) : Math.max(24, mount.clientWidth / 2)
    buttons.forEach((button, index) => {
      button.style.left = `${xs[index] - slot / 2}px`
      button.style.width = `${slot}px`
    })
    const paneWidth = mount.clientWidth
    const candleVisible = (index: number) =>
      !(paneWidth > 0 && (xs[index] < -slot / 2 || xs[index] > paneWidth + slot / 2))
    buttons.forEach((button, index) => {
      /* A candle scrolled out of the pane must leave the tab order too, or a
         keyboard user lands on a target with nothing under it. */
      button.hidden = !candleVisible(index)
    })
    const pillY = candleSeries.priceToCoordinate(finalClose)
    if (pillY !== null) {
      pill.style.top = `${pillY}px`
      pill.hidden = false
    }
    if (volumeSeries && volumeCaption) {
      /* The volume scale fits the bars on screen, so the caption follows the
         tallest visible one; pinned to the whole series it drifted into the
         price panel as soon as the reader zoomed into a quieter stretch. */
      const visibleMax = Math.max(
        0,
        ...parsed.flatMap((point, index) => (candleVisible(index) && point.volume !== undefined ? [point.volume] : [])),
      )
      const bandTop = volumeSeries.priceToCoordinate(visibleMax || volumeMax)
      if (bandTop !== null) {
        volumeCaption.style.top = `${bandTop - 17}px`
        volumeCaption.hidden = false
      }
    }
  }
  /* fitContent is the right answer only while the view is still the whole
     series. Once the reader has zoomed, a resize must keep their window or
     the chart snaps back under them. */
  let viewAdjusted = false
  const scheduleSync = () =>
    requestAnimationFrame(() => {
      if (!viewAdjusted) chartApi.timeScale().fitContent()
      requestAnimationFrame(sync)
    })
  chartApi.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(sync))

  const controller: RangeController = {
    min: -0.5,
    max: parsed.length - 0.5,
    total: parsed.length,
    minimumSpan: Math.min(4, parsed.length),
    read: () => {
      const range = chartApi.timeScale().getVisibleLogicalRange()
      return range ? { from: range.from, to: range.to } : { from: -0.5, to: parsed.length - 0.5 }
    },
    write: (window) => {
      viewAdjusted = window.to - window.from < parsed.length - 1e-6
      chartApi.timeScale().setVisibleLogicalRange(window)
    },
  }
  const reportView = () => {
    const window = controller.read()
    const first = Math.max(0, Math.ceil(window.from))
    const last = Math.min(parsed.length - 1, Math.floor(window.to))
    onViewChange?.({
      chart: chartTitle,
      shown: Math.max(0, last - first + 1),
      total: parsed.length,
      firstLabel: fullLabels[first] ?? '',
      lastLabel: fullLabels[last] ?? '',
    })
  }
  /* Below the declared minimum there is nothing to zoom into, so nothing is
     offered; the tool contract declares the same number. */
  const zoomable = parsed.length >= EXPLORER_CHART_CAPABILITIES.minimumPointsForZoom
  const toolbar = zoomable ? chartRangeToolbar(controller, parsed.length, 'candles') : undefined
  if (toolbar) terminal.insertBefore(toolbar.node, chartBox)
  const detachGestures = zoomable
    ? attachRangeGestures(chartBox, controller, () => {
        toolbar?.sync()
        requestAnimationFrame(sync)
        reportView()
      })
    : () => {}
  if (zoomable) {
    chartApi.timeScale().subscribeVisibleLogicalRangeChange(() => {
      toolbar?.sync()
      reportView()
    })
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleSync) : undefined
  observer?.observe(chartBox)
  scheduleSync()
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(scheduleSync).catch(() => {})
  }
  registerChartDisposer(panelRoot, chartApi, () => {
    detachGestures()
    observer?.disconnect()
  })
  return terminal
}

/** `var(--chart-1)` is what the DOM needs; the canvas needs what it resolves to. */
function resolveSeriesColor(color: string, fallback: string): string {
  const token = /^var\(\s*(--[\w-]+)\s*\)$/.exec(color)?.[1]
  return token ? resolveColor(token, fallback) : color
}

/*
 * Lines, areas, and bars, on the same instrument as the candles.
 *
 * The canvas carries the marks, the crosshair, and the right price scale. A
 * transparent overlay of one button per point carries everything a canvas
 * cannot: keyboard reach, the accessible label naming each visible series and
 * its exact value, the pinned selection that pages the evidence table, and the
 * exact numbers a test can read back. Hidden per-series markers carry the
 * totals and the run lengths for the same reason.
 */
function buildSeriesTerminal(
  panelRoot: HTMLElement,
  chart: Record<string, unknown>,
  rows: Record<string, unknown>[],
  chartTitle: string,
  focusPrefix: string,
  onViewChange?: (view: ChartView) => void,
): HTMLElement | null {
  const normalized = normalizeSeries(rows, chart)
  const points = normalized.points
  if (!normalized.series.length || !points.some((point) => point.values.some((value) => value !== null))) return null

  const valueFormat = text(chart.value_format)
  const unit = text(chart.unit)
  /* A grouped bar chart would need side-by-side slots, which a histogram
     series does not have; no descriptor asks for one, and a line is a better
     answer than overlapping bars if one ever does. */
  const isBar = chart.recommended_visual === 'bar' && normalized.series.length === 1
  const stacked = chart.recommended_visual === 'stacked_area' && normalized.series.length > 1
  const xField = text(chart.x_field || 'timestamp')

  const rawX = points.map((point) => numeric(getByPath(point.row, xField)))
  const monotonic = rawX.every(
    (value, index) => value !== undefined && (index === 0 || value > (rawX[index - 1] as number)),
  )
  const times = points.map((_point, index) => (monotonic ? (rawX[index] as number) : index * 60) as UTCTimestamp)
  const labels = points.map((point, index) =>
    text(point.row.timestamp_human ?? point.row.timestamp ?? point.row.bucket_index ?? `Point ${index + 1}`),
  )
  const timeToLabel = new Map<number, string>()
  times.forEach((time, index) => timeToLabel.set(time as number, shortTimeLabel(labels[index]) || labels[index]))

  /*
   * lightweight-charts spaces points by their position in the data, not by
   * their time, so a bucket the query never returned needs a slot of its own
   * or the two points either side of it sit next to each other as though
   * nothing were missing. One empty slot per gap is enough to show it.
   */
  const expectedStep = monotonic ? (xField === 'bucket_index' ? 1 : intervalSeconds(chart.interval)) : undefined
  const timeline: UTCTimestamp[] = []
  const slotOfPoint: number[] = []
  points.forEach((_point, index) => {
    const previous = index > 0 ? (times[index - 1] as number) : undefined
    if (previous !== undefined && expectedStep && (times[index] as number) - previous > expectedStep * 1.5) {
      timeline.push((previous + expectedStep) as UTCTimestamp)
    }
    slotOfPoint.push(timeline.length)
    timeline.push(times[index])
  })

  /*
   * The runs of consecutive points a series actually draws. A line series
   * connects straight through an empty slot, so each run is its own series
   * and the break between them is real rather than implied.
   */
  const runsOf = (values: (number | null)[]) => {
    const runs: { time: UTCTimestamp; value: number }[][] = []
    let run: { time: UTCTimestamp; value: number }[] = []
    points.forEach((_point, index) => {
      const value = values[index]
      const broken = value === null || (index > 0 && slotOfPoint[index] !== slotOfPoint[index - 1] + 1)
      if (broken && run.length) {
        runs.push(run)
        run = []
      }
      if (value !== null) run.push({ time: times[index], value })
    })
    if (run.length) runs.push(run)
    return runs
  }

  const terminal = element('div', 'sqd-chart-terminal')
  const plot = element('div', 'sqd-chart-plot')
  plot.setAttribute('role', 'group')
  plot.setAttribute(
    'aria-label',
    `${chartTitle}. ${points.length} data points across ${normalized.series.length} series.`,
  )
  const mount = element('div', 'sqd-chart-canvas')
  mount.setAttribute('aria-hidden', 'true')
  const hits = element('div', 'sqd-chart-hits')
  const tooltip = element('div', 'sqd-chart-tooltip')
  tooltip.setAttribute('role', 'status')
  tooltip.setAttribute('aria-live', 'polite')
  tooltip.hidden = true
  plot.append(mount, hits, tooltip)
  /* The value axis is named in a gutter beside the plot rather than over it:
     the canvas fills its box edge to edge, so a label inside would sit on the
     first bars. */
  const axisTitle = text(chart.y_axis_label ?? (normalized.series.length === 1 ? normalized.series[0].label : unit))
  const frame = element('div', 'sqd-chart-frame')
  if (axisTitle && axisTitlesFit()) frame.append(element('div', 'sqd-chart-axis-title', axisTitle))
  frame.append(plot)
  const attribution = element('a', 'sqd-chart-attribution', 'Charts by TradingView') as HTMLAnchorElement
  attribution.href = 'https://www.tradingview.com/'
  attribution.target = '_blank'
  attribution.rel = 'noopener noreferrer'
  terminal.append(frame, attribution)

  const TERMINAL_COLORS = terminalColors()
  const chartApi = createTerminalChart(mount, TERMINAL_COLORS, {
    scaleMargins: { top: 0.14, bottom: 0.08 },
    /* An empty slot has no label of its own, and inventing one from its
       placeholder time would put a wrong reading on the axis. */
    tickLabel: (time) => timeToLabel.get(time) ?? '',
    /* A bar is read at its own slot; magnet would snap the crosshair to the
       nearest value instead. Lines keep the magnet. */
    crosshair: isBar ? CrosshairMode.Normal : CrosshairMode.Magnet,
  })
  const priceFormat = {
    type: 'custom' as const,
    formatter: (value: number) => tickText(value, valueFormat),
    minMove: 1e-8,
  }
  /* Every slot exists on the time scale, including the empty ones, so the gaps
     keep their width whatever the visible series happen to be. It carries no
     values, and it sits on a scale of its own: on the visible one its default
     two-decimal price format would become the axis format for every chart. */
  const timelineSeries = chartApi.addSeries(LineSeries, {
    visible: false,
    priceScaleId: 'sqd-timeline',
    priceFormat,
    priceLineVisible: false,
    lastValueVisible: false,
  })
  timelineSeries.setData(timeline.map((time) => ({ time })))

  const seriesColors = normalized.series.map((series, index) =>
    resolveSeriesColor(series.color, index === 0 ? '#6366f1' : TERMINAL_COLORS.accent),
  )
  /* One logical series, one or more drawn runs. */
  const seriesRuns: ReturnType<IChartApi['addSeries']>[][] = normalized.series.map(() => [])
  const runLengths: number[][] = normalized.series.map(() => [])
  let signedBaseline = false

  if (isBar) {
    const values = points.map((point) => point.values[0])
    const signed = values.some((value) => value !== null && value < 0)
    signedBaseline = signed && values.some((value) => value !== null && value > 0)
    const api = chartApi.addSeries(HistogramSeries, {
      priceFormat,
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0,
      color: seriesColors[0],
    })
    /* Bars stand on their own slot, so an empty slot simply has no bar and
       nothing has to be split. */
    api.setData(
      points.flatMap((point, index) =>
        point.values[0] === null
          ? []
          : [
              {
                time: times[index],
                value: point.values[0] as number,
                ...(signed
                  ? { color: (point.values[0] as number) >= 0 ? TERMINAL_COLORS.up : TERMINAL_COLORS.down }
                  : {}),
              },
            ],
      ),
    )
    seriesRuns[0].push(api)
    runLengths[0] = runsOf(values).map((run) => run.length)
  } else if (stacked) {
    /* Stacked bands, drawn as filled areas over running totals. The topmost
       total goes down first so each shorter one paints in front of it, which
       is what makes the bands read as segments rather than as overlapping
       fills. A negative contribution has no place in a stack, so the clamp at
       zero the SVG plot used is kept. */
    const totals = normalized.series.map((_series, seriesIndex) =>
      points.map((point) =>
        point.values.slice(0, seriesIndex + 1).reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0),
      ),
    )
    for (let seriesIndex = normalized.series.length - 1; seriesIndex >= 0; seriesIndex -= 1) {
      const api = chartApi.addSeries(AreaSeries, {
        priceFormat,
        priceLineVisible: false,
        lastValueVisible: false,
        lineWidth: 1,
        lineColor: seriesColors[seriesIndex],
        topColor: withAlpha(seriesColors[seriesIndex], 0.82),
        bottomColor: withAlpha(seriesColors[seriesIndex], 0.82),
      })
      api.setData(totals[seriesIndex].map((value, index) => ({ time: times[index], value })))
      seriesRuns[seriesIndex].push(api)
      runLengths[seriesIndex] = [points.length]
    }
  } else {
    const single = normalized.series.length === 1
    normalized.series.forEach((_series, seriesIndex) => {
      const values = points.map((point) => point.values[seriesIndex])
      const positive = values.every((value) => value === null || value >= 0)
      const area = single && positive
      for (const run of runsOf(values)) {
        const api = area
          ? chartApi.addSeries(AreaSeries, {
              priceFormat,
              priceLineVisible: false,
              lastValueVisible: false,
              lineWidth: 2,
              lineColor: seriesColors[0],
              topColor: withAlpha(seriesColors[0], 0.24),
              bottomColor: withAlpha(seriesColors[0], 0.02),
            })
          : chartApi.addSeries(LineSeries, {
              priceFormat,
              priceLineVisible: false,
              lastValueVisible: false,
              lineWidth: 2,
              color: seriesColors[seriesIndex],
            })
        api.setData(run)
        seriesRuns[seriesIndex].push(api)
        runLengths[seriesIndex].push(run.length)
      }
    })
  }

  /* What a canvas cannot say: each series' identity, its exact total, the runs
     it drew, and whether the reader has switched it off. */
  const markers = normalized.series.map((series, seriesIndex) => {
    const marker = element('span', 'sqd-chart-series')
    marker.hidden = true
    marker.setAttribute('data-series-index', String(seriesIndex))
    marker.setAttribute('data-series', series.key)
    marker.setAttribute(
      'data-series-total',
      String(points.reduce((sum, point) => sum + (point.values[seriesIndex] ?? 0), 0)),
    )
    marker.setAttribute('data-segments', runLengths[seriesIndex].join(','))
    marker.setAttribute('data-visible', 'true')
    terminal.append(marker)
    return marker
  })

  const visibleSeries = new Set(normalized.series.map((_series, index) => index))
  const valuesForPoint = (point: ChartPoint) =>
    normalized.series.flatMap((series, seriesIndex) => {
      if (!visibleSeries.has(seriesIndex)) return []
      const value = point.values[seriesIndex]
      return [`${series.label} ${value === null ? 'not available' : formatValue(value, valueFormat, unit)}`]
    })

  const buttons: HTMLButtonElement[] = []
  const updatePointLabels = () => {
    buttons.forEach((button, index) => {
      const visible = valuesForPoint(points[index])
      button.setAttribute(
        'aria-label',
        `${labels[index]}. ${visible.length ? visible.join('. ') : 'No visible series'}.`,
      )
    })
  }

  if (normalized.series.length > 1) {
    const legend = element('div', 'sqd-chart-legend')
    legend.setAttribute('aria-label', 'Chart series')
    normalized.series.forEach((series, seriesIndex) => {
      const button = element('button', 'sqd-chart-legend-item')
      button.type = 'button'
      button.setAttribute('aria-pressed', 'true')
      const swatch = element('span', 'sqd-chart-legend-swatch')
      swatch.style.background = series.color
      button.append(swatch, document.createTextNode(series.label))
      button.addEventListener('click', () => {
        const visible = button.getAttribute('aria-pressed') !== 'true'
        button.setAttribute('aria-pressed', String(visible))
        if (visible) visibleSeries.add(seriesIndex)
        else visibleSeries.delete(seriesIndex)
        for (const api of seriesRuns[seriesIndex]) api.applyOptions({ visible })
        markers[seriesIndex].setAttribute('data-visible', String(visible))
        updatePointLabels()
      })
      legend.append(button)
    })
    terminal.insertBefore(legend, frame)
  }

  const anchorSeries = seriesRuns.flat()[0]
  const showTooltip = (index: number, x: number) => {
    renderTooltip(tooltip, labels[index], valuesForPoint(points[index]).map(splitTooltipValue))
    tooltip.hidden = false
    placeTooltip(tooltip, x)
    const anchor = points[index].values.find((value) => value !== null)
    if (anchor !== undefined && anchor !== null && anchorSeries) {
      chartApi.setCrosshairPosition(anchor, times[index], anchorSeries)
    }
  }
  const hideTooltip = () => {
    tooltip.hidden = true
    chartApi.clearCrosshairPosition()
  }

  points.forEach((point, index) => {
    const button = element('button', 'sqd-chart-hit') as HTMLButtonElement
    button.type = 'button'
    button.setAttribute('data-point-index', String(index))
    button.setAttribute('data-x-value', text(getByPath(point.row, xField)))
    /* A single-series chart publishes the exact number behind each mark. A
       point the tool returned no value for carries no attribute at all, so a
       gap is never read back as a zero. */
    if (normalized.series.length === 1 && point.values[0] !== null) {
      button.setAttribute('data-value', String(point.values[0]))
    }
    button.setAttribute('aria-pressed', 'false')
    button.style.left = `${(index / points.length) * 100}%`
    button.style.width = `${100 / points.length}%`
    const enter = () => showTooltip(index, button.offsetLeft + button.offsetWidth / 2)
    button.addEventListener('pointerenter', enter)
    button.addEventListener('focus', enter)
    button.addEventListener('pointerleave', hideTooltip)
    button.addEventListener('blur', hideTooltip)
    button.addEventListener('click', () => selectEvidenceRow(point.row, button))
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const step = event.key === 'ArrowLeft' ? -1 : 1
      const next = buttons.slice(index + step, index + step + 1).find((candidate) => !candidate.hidden)
      if (!next) return
      event.preventDefault()
      event.stopPropagation()
      next.focus()
    })
    hits.append(button)
    buttons.push(button)
  })
  updatePointLabels()

  const lastSeries = seriesRuns[0].at(-1)
  const finalValue = !stacked && normalized.series.length === 1 ? (points.at(-1)?.values[0] ?? null) : null
  if (finalValue !== null && lastSeries) {
    /* The chart writes the last value into the price scale itself, and drops
       the tick it would have collided with. A badge of our own on top of the
       axis had to guess which tick to hide, and got it wrong at the edges. */
    lastSeries.applyOptions({ lastValueVisible: true })
    markers[0].setAttribute('data-final-value', String(finalValue))
    lastSeries.createPriceLine({
      price: finalValue,
      color: TERMINAL_COLORS.accentLine,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
    })
  }

  const sync = () => {
    const timeScale = chartApi.timeScale()
    const coordinates = times.map((time) => timeScale.timeToCoordinate(time))
    if (coordinates.some((coordinate) => coordinate === null)) return
    const xs = coordinates as number[]
    const slot =
      timeline.length > 1
        ? Math.max(
            6,
            (timeScale.timeToCoordinate(timeline.at(-1) as UTCTimestamp) ?? 0) -
              (timeScale.timeToCoordinate(timeline[0]) ?? 0),
          ) / Math.max(1, timeline.length - 1)
        : Math.max(24, mount.clientWidth / 2)
    const paneWidth = mount.clientWidth
    buttons.forEach((button, index) => {
      button.style.left = `${xs[index] - slot / 2}px`
      button.style.width = `${slot}px`
      /* A point scrolled out of the pane leaves the tab order too, or a
         keyboard user lands on a target with nothing under it. */
      button.hidden = paneWidth > 0 && (xs[index] < -slot / 2 || xs[index] > paneWidth + slot / 2)
    })
    /* A signed series is drawn from zero, not from the axis floor, and the
       canvas cannot be asked where it put the line. Publishing it is what lets
       a test see the baseline is a real interior line, not the pane's bottom. */
    if (signedBaseline && lastSeries) {
      const zeroY = lastSeries.priceToCoordinate(0)
      if (zeroY !== null) plot.dataset.zeroBaseline = String(Math.round(zeroY))
    }
  }
  let viewAdjusted = false
  const scheduleSync = () =>
    requestAnimationFrame(() => {
      if (!viewAdjusted) chartApi.timeScale().fitContent()
      requestAnimationFrame(sync)
    })
  chartApi.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(sync))

  const controller: RangeController = {
    min: -0.5,
    max: timeline.length - 0.5,
    total: timeline.length,
    minimumSpan: Math.min(2, timeline.length),
    read: () => {
      const range = chartApi.timeScale().getVisibleLogicalRange()
      return range ? { from: range.from, to: range.to } : { from: -0.5, to: timeline.length - 0.5 }
    },
    write: (window) => {
      viewAdjusted = window.to - window.from < timeline.length - 1e-6
      chartApi.timeScale().setVisibleLogicalRange(window)
    },
  }
  /* The controller counts slots, and an empty slot is not a point the tool
     returned, so what the reader is told is the count of real points. */
  const pointsShown = (window: RangeWindow) => {
    const first = Math.ceil(window.from - 1e-6)
    const last = Math.floor(window.to + 1e-6)
    return slotOfPoint.filter((slot) => slot >= first && slot <= last).length
  }
  const reportView = () => {
    const window = controller.read()
    const visible = slotOfPoint.flatMap((slot, index) =>
      slot >= Math.ceil(window.from - 1e-6) && slot <= Math.floor(window.to + 1e-6) ? [index] : [],
    )
    onViewChange?.({
      chart: chartTitle,
      shown: visible.length,
      total: points.length,
      firstLabel: labels[visible[0] ?? 0] ?? '',
      lastLabel: labels[visible.at(-1) ?? points.length - 1] ?? '',
    })
  }
  const zoomable = points.length >= EXPLORER_CHART_CAPABILITIES.minimumPointsForZoom
  const toolbar = zoomable
    ? chartRangeToolbar(controller, points.length, focusPrefix, undefined, pointsShown)
    : undefined
  if (toolbar) terminal.insertBefore(toolbar.node, frame)
  const detachGestures = zoomable
    ? attachRangeGestures(plot, controller, () => {
        toolbar?.sync()
        requestAnimationFrame(sync)
        reportView()
      })
    : () => {}
  if (zoomable) {
    chartApi.timeScale().subscribeVisibleLogicalRangeChange(() => {
      toolbar?.sync()
      reportView()
    })
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleSync) : undefined
  observer?.observe(plot)
  scheduleSync()
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(scheduleSync).catch(() => {})
  }
  registerChartDisposer(panelRoot, chartApi, () => {
    detachGestures()
    observer?.disconnect()
  })
  return terminal
}

export function chartPanel(
  payload: Record<string, unknown>,
  panel: Panel,
  onViewChange?: (view: ChartView) => void,
): HTMLElement {
  const descriptor = getByPath(payload, text(panel.chart_key))
  const chart = isRecord(descriptor) ? descriptor : {}
  const { root, body } = card(
    text(panel.title ?? chart.title ?? 'Activity over time'),
    text(panel.subtitle ?? chart.subtitle),
    panel.emphasis === 'primary' ? 'sqd-card--primary' : '',
  )
  const wrap = element('div', 'sqd-chart-wrap')
  const rows = sortRowsByX(numberRows(payload, chart), chart)
  if (!rows.length) {
    wrap.append(element('div', 'sqd-chart-empty', 'No chart points were returned for this window.'))
    body.append(wrap)
    return root
  }
  const candles = chart.kind === 'candlestick'
  const chartTitle = text(panel.title ?? chart.title ?? 'Blockchain activity chart')
  const terminal = candles
    ? buildCandleTerminal(root, chart, rows, chartTitle, finalCandleStillForming(payload), onViewChange)
    : buildSeriesTerminal(root, chart, rows, chartTitle, `chart-${text(panel.chart_key)}`, onViewChange)
  if (!terminal) {
    wrap.append(
      element(
        'div',
        'sqd-chart-empty',
        candles
          ? 'The result did not include numeric candle values.'
          : 'The result did not include numeric chart values.',
      ),
    )
    body.append(wrap)
    return root
  }
  wrap.append(terminal)
  body.append(wrap)
  const declaredPoints = Number(chart.total_points ?? chart.total_candles)
  const pointNotice = Number.isFinite(declaredPoints)
    ? displayLimitNotice('chart points', rows.length, rows.length, declaredPoints)
    : null
  if (pointNotice) body.append(pointNotice)
  return root
}
