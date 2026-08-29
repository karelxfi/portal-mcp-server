import { ACTIVITY_EXPLORER_CSS } from './styles.js'

export type ExplorerState = {
  payload: Record<string, unknown> | null
  rawText: string
  loading: boolean
  error: string
  currentArgs: Record<string, unknown>
  displayMode?: string
}

export type ExplorerActions = {
  runFollowup: (intent: string, target?: string, action?: Record<string, unknown>) => void
  requestFullscreen?: () => void
}

type Column = {
  key: string
  path?: string
  label?: string
  format?: string
  unit?: string
  align?: string
}

type Panel = Record<string, unknown>

const ROOT_STYLE_ID = 'sqd-activity-explorer-style'
const MAX_TABLE_ROWS = 100
const MAX_TIMELINE_ROWS = 40
const MAX_RANKED_ROWS = 16
const MAX_STAT_ROWS = 30
const CHART_WIDTH = 900
const CHART_HEIGHT = 320
const CHART_PAD = { left: 18, right: 76, top: 18, bottom: 32 }
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function getByPath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function compact(value: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatValue(value: unknown, format?: string, unit?: string): string {
  if (value === null || value === undefined || value === '') return 'Not available'
  if (typeof value === 'string' && format !== 'timestamp') {
    return value
  }
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return text(value)
  let formatted: string
  switch (format) {
    case 'integer':
      formatted = Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(numberValue)
      break
    case 'compact_number':
      formatted = compact(numberValue)
      break
    case 'percent':
      formatted = `${Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numberValue)}%`
      break
    case 'currency_usd':
      formatted = Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: Math.abs(numberValue) >= 1_000_000 ? 'compact' : 'standard',
        maximumFractionDigits: 2,
      }).format(numberValue)
      break
    case 'gwei':
      formatted = `${Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(numberValue)} gwei`
      break
    case 'bytes':
      formatted =
        numberValue >= 1_000_000
          ? `${(numberValue / 1_000_000).toFixed(2)} MB`
          : numberValue >= 1_000
            ? `${(numberValue / 1_000).toFixed(1)} KB`
            : `${numberValue} bytes`
      break
    case 'btc':
      formatted = `${Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(numberValue)} BTC`
      break
    case 'timestamp':
      formatted = new Date(numberValue * (numberValue > 1e12 ? 1 : 1000)).toLocaleString()
      break
    default:
      formatted = Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(numberValue)
  }
  return unit && !formatted.toLowerCase().includes(unit.toLowerCase()) ? `${formatted} ${unit}` : formatted
}

function humanize(value: string): string {
  return value
    .replace(/^_+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  content?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (content !== undefined) node.textContent = content
  return node
}

function injectStyle() {
  if (document.getElementById(ROOT_STYLE_ID)) return
  const style = element('style')
  style.id = ROOT_STYLE_ID
  style.textContent = ACTIVITY_EXPLORER_CSS
  document.head.append(style)
}

function logoMark(): HTMLElement {
  const mark = element('div', 'sqd-mark')
  mark.setAttribute('aria-hidden', 'true')
  mark.innerHTML =
    '<svg viewBox="0 0 306 306" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="305" height="305" transform="translate(0.117798 0.453125)" fill="black"/><path d="M208.004 125.812C180.366 125.812 166.754 135.622 152.344 146.003C136.923 157.109 120.961 168.6 89.1939 168.6C84.5804 168.6 80.2945 168.344 76.3076 167.902V229.358H228.665V128.019C222.699 126.623 215.921 125.812 208.004 125.812Z" fill="white"/><path d="M89.1084 120.614C84.7655 120.614 80.4938 120.301 76.2933 119.746V154.987C80.2375 155.5 84.5092 155.784 89.1796 155.784C116.818 155.784 130.43 145.974 144.84 135.594C160.261 124.487 176.223 112.996 207.99 112.996C215.75 112.996 222.556 113.68 228.651 114.89V77H170.157C152.728 103.257 122.912 120.614 89.1084 120.614Z" fill="white"/><path d="M76.2933 106.831C80.4796 107.471 84.7513 107.799 89.1084 107.799C115.308 107.799 138.76 95.7955 154.252 77H76.2933V106.817V106.831Z" fill="white"/></svg>'
  return mark
}

function appHeader(actions: ExplorerActions, state: ExplorerState): HTMLElement {
  const topbar = element('div', 'sqd-topbar')
  const brand = element('div', 'sqd-brand')
  brand.append(logoMark())
  const copy = element('div', 'sqd-brand-copy')
  copy.append(element('div', 'sqd-brand-name', 'SQD'))
  copy.append(element('div', 'sqd-brand-subtitle', 'Blockchain Activity Explorer'))
  brand.append(copy)
  topbar.append(brand)

  const actionBar = element('div', 'sqd-actions')
  if (actions.requestFullscreen && state.displayMode !== 'fullscreen') {
    const fullscreen = element('button', 'sqd-button', 'Open full screen')
    fullscreen.type = 'button'
    fullscreen.addEventListener('click', () => actions.requestFullscreen?.())
    actionBar.append(fullscreen)
  }
  topbar.append(actionBar)
  return topbar
}

function resultState(payload: Record<string, unknown>): { label: string; tone: string; partial: boolean } {
  const error = isRecord(payload.error) ? payload.error : undefined
  if (error) return { label: 'Needs attention', tone: 'danger', partial: true }
  const coverage = isRecord(payload._coverage) ? payload._coverage : {}
  const pagination = isRecord(payload._pagination) ? payload._pagination : {}
  const continuationAddsToRequestedResult = pagination.continuation_scope !== 'adjacent_window'
  const partial =
    coverage.result_complete === false ||
    coverage.window_complete === false ||
    coverage.sampled === true ||
    (pagination.has_more === true && continuationAddsToRequestedResult)
  return partial
    ? { label: 'Partial result', tone: 'warning', partial }
    : { label: 'Evidence ready', tone: '', partial }
}

function badges(payload: Record<string, unknown>, partial: boolean): HTMLElement {
  const row = element('div', 'sqd-badges')
  const meta = isRecord(payload._meta) ? payload._meta : {}
  const provenance = isRecord(payload._provenance) ? payload._provenance : {}
  const freshness = isRecord(payload._freshness) ? payload._freshness : {}
  const coverage = isRecord(payload._coverage) ? payload._coverage : {}
  const pagination = isRecord(payload._pagination) ? payload._pagination : {}
  const candidates: [string, unknown, string?][] = [
    ['Network', meta.network ?? meta.dataset ?? payload.network],
    ['Window', coverage.requested_window ?? coverage.window ?? meta.timeframe],
    ['Rows', meta.row_count ?? meta.result_count ?? (asArray(payload.items).length || undefined)],
    ['Finality', freshness.finality ?? freshness.kind],
    ['Source', provenance.source],
  ]
  for (const [label, value, tone] of candidates) {
    if (value === undefined || value === null || value === '' || isRecord(value) || Array.isArray(value)) continue
    row.append(element('span', `sqd-badge${tone ? ` sqd-badge--${tone}` : ''}`, `${label}: ${text(value)}`))
  }
  if (pagination.has_more === true && pagination.continuation_scope === 'adjacent_window')
    row.append(element('span', 'sqd-badge', 'Older adjacent window available'))
  if (partial) row.append(element('span', 'sqd-badge sqd-badge--warning', 'Check coverage before using totals'))
  return row
}

function hero(payload: Record<string, unknown>): HTMLElement {
  const ui = isRecord(payload._ui) ? payload._ui : {}
  const headline = isRecord(ui.headline) ? ui.headline : {}
  const display = isRecord(payload.display) ? payload.display : {}
  const state = resultState(payload)
  const section = element('section', 'sqd-hero')
  section.setAttribute('aria-labelledby', 'sqd-result-title')
  const eyebrow = element('div', 'sqd-eyebrow')
  eyebrow.append(element('span', `sqd-dot${state.tone ? ` sqd-dot--${state.tone}` : ''}`))
  eyebrow.append(document.createTextNode(state.label))
  section.append(eyebrow)
  const title = element('h1', 'sqd-title', text(headline.title ?? display.title ?? 'Blockchain activity'))
  title.id = 'sqd-result-title'
  section.append(title)
  const subtitleText = text(headline.subtitle ?? display.subtitle ?? payload.answer ?? payload._summary)
  if (subtitleText) section.append(element('p', 'sqd-subtitle', subtitleText))
  section.append(badges(payload, state.partial))
  return section
}

function metricCards(payload: Record<string, unknown>): HTMLElement | null {
  const ui = isRecord(payload._ui) ? payload._ui : {}
  const specs = asArray(ui.metric_cards).filter(isRecord)
  const fallbacks: Record<string, unknown>[] = []
  if (!specs.length) {
    const summaryCandidates = ['summary', 'overview', 'page_summary', 'metrics']
    const summary = summaryCandidates.map((key) => payload[key]).find(isRecord)
    if (summary) {
      for (const [key, value] of Object.entries(summary)
        .filter(([, value]) => ['number', 'string'].includes(typeof value))
        .slice(0, 4)) {
        fallbacks.push({
          label: humanize(key),
          value_path: `${summaryCandidates.find((key) => payload[key] === summary)}.${key}`,
          format: typeof value === 'number' ? 'compact_number' : undefined,
        })
      }
    }
  }
  const cards = specs.length ? specs : fallbacks
  if (!cards.length) return null
  const grid = element('section', 'sqd-metrics')
  grid.setAttribute('aria-label', 'Key metrics')
  for (const spec of cards.slice(0, 8)) {
    const card = element('article', `sqd-metric${spec.emphasis === 'primary' ? ' sqd-metric--primary' : ''}`)
    card.append(element('div', 'sqd-metric-label', text(spec.label ?? 'Metric')))
    card.append(
      element(
        'div',
        'sqd-metric-value',
        formatValue(getByPath(payload, text(spec.value_path)), text(spec.format), text(spec.unit)),
      ),
    )
    if (spec.subtitle) card.append(element('div', 'sqd-metric-subtitle', text(spec.subtitle)))
    grid.append(card)
  }
  return grid
}

function card(title: string, subtitle?: string, modifiers = ''): { root: HTMLElement; body: HTMLElement } {
  const root = element('section', `sqd-card ${modifiers}`.trim())
  const head = element('div', 'sqd-card-head')
  const titles = element('div')
  titles.append(element('h2', 'sqd-card-title', title))
  if (subtitle) titles.append(element('p', 'sqd-card-subtitle', subtitle))
  head.append(titles)
  root.append(head)
  const body = element('div', 'sqd-card-body')
  root.append(body)
  return { root, body }
}

function displayLimitNotice(label: string, shown: number, available: number, declared = available): HTMLElement | null {
  if (shown >= declared) return null
  const completeInPayload = available >= declared
  const notice = element(
    'p',
    'sqd-display-limit',
    completeInPayload
      ? `${shown} of ${declared} ${label} are shown in this view. Search and exact JSON keep all ${available} rows in this result.`
      : `${shown} of ${declared} declared ${label} are present in this payload. Check coverage and pagination before using totals.`,
  )
  notice.setAttribute('role', 'note')
  return notice
}

function isIdentifierColumn(column: Column, value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (column.format === 'address' || /(^|_)(address|hash|sender|recipient|from|to|user)(_|$)/i.test(column.key))
  )
}

function numberRows(payload: Record<string, unknown>, descriptor: Record<string, unknown>): Record<string, unknown>[] {
  return asArray(getByPath(payload, text(descriptor.data_key))).filter(isRecord)
}

function sortRowsByX(rows: Record<string, unknown>[], chart: Record<string, unknown>): Record<string, unknown>[] {
  const xField = text(chart.x_field)
  if (!xField) return rows.slice()
  return rows.slice().sort((left, right) => {
    const leftValue = getByPath(left, xField)
    const rightValue = getByPath(right, xField)
    const leftNumber = numeric(leftValue)
    const rightNumber = numeric(rightValue)
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber
    return text(leftValue).localeCompare(text(rightValue))
  })
}

function intervalSeconds(value: unknown): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/i.exec(text(value).trim())
  if (!match) return undefined
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2].toLowerCase() as 's' | 'm' | 'h' | 'd']
  return Number(match[1]) * multiplier
}

type ChartPoint = {
  row: Record<string, unknown>
  values: Array<number | null>
}

type ChartSeries = {
  key: string
  label: string
  color: string
}

function normalizeSeries(rows: Record<string, unknown>[], chart: Record<string, unknown>): {
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
      series: keys.map((key, index) => ({ key, label: humanize(key), color: CHART_COLORS[index % CHART_COLORS.length] })),
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

function chartPanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
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
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'sqd-chart')
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`)
  svg.setAttribute('role', 'group')
  const chartTitle = text(panel.title ?? chart.title ?? 'Blockchain activity chart')
  const plotW = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right
  const plotH = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom
  const add = (tag: string, attrs: Record<string, string>): SVGElement => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
    svg.append(node)
    return node
  }

  const tooltip = element('div', 'sqd-chart-tooltip')
  tooltip.setAttribute('role', 'status')
  tooltip.setAttribute('aria-live', 'polite')
  tooltip.hidden = true
  const crosshair = add('line', {
    x1: '0',
    x2: '0',
    y1: String(CHART_PAD.top),
    y2: String(CHART_HEIGHT - CHART_PAD.bottom),
    class: 'sqd-chart-crosshair',
  }) as SVGLineElement
  crosshair.style.display = 'none'
  const showTooltip = (cx: number, label: string, values: string[]) => {
    tooltip.textContent = `${label}: ${values.join(', ')}`
    tooltip.style.left = `${Math.min(88, Math.max(12, (cx / CHART_WIDTH) * 100))}%`
    tooltip.hidden = false
    crosshair.setAttribute('x1', String(cx))
    crosshair.setAttribute('x2', String(cx))
    crosshair.style.display = ''
  }
  const hideTooltip = () => {
    tooltip.hidden = true
    crosshair.style.display = 'none'
  }

  if (chart.kind === 'candlestick') {
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
    const prices = rows
      .flatMap((row) => [numeric(getByPath(row, lowField)), numeric(getByPath(row, highField))])
      .filter((value): value is number => value !== undefined)
    if (!prices.length) {
      wrap.append(element('div', 'sqd-chart-empty', 'The result did not include numeric candle values.'))
      body.append(wrap)
      return root
    }
    const hasVolume = chart.volume_panel !== false && rows.some((row) => numeric(getByPath(row, volumeField)) !== undefined)
    const volumeHeight = hasVolume ? 52 : 0
    const volumeGap = hasVolume ? 18 : 0
    const priceHeight = plotH - volumeHeight - volumeGap
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const rawRange = max - min
    const padding = rawRange > 0
      ? rawRange * 0.08
      : Math.max(Math.abs(max) * 0.0001, 0.01)
    const domainMin = min - padding
    const domainMax = max + padding
    const range = domainMax - domainMin
    const y = (value: number) => CHART_PAD.top + (1 - (value - domainMin) / range) * priceHeight
    const x = (index: number) =>
      CHART_PAD.left + (rows.length === 1 ? plotW / 2 : (index / (rows.length - 1)) * plotW)
    for (let i = 0; i <= 4; i += 1) {
      const gy = CHART_PAD.top + (priceHeight * i) / 4
      add('line', {
        x1: String(CHART_PAD.left),
        x2: String(CHART_WIDTH - CHART_PAD.right),
        y1: String(gy),
        y2: String(gy),
        class: 'sqd-chart-grid',
      })
      const label = add('text', {
        x: String(CHART_WIDTH - CHART_PAD.right + 8),
        y: String(gy + 3),
        class: 'sqd-chart-label',
      })
      label.textContent = formatValue(domainMax - (range * i) / 4, priceFormat, priceUnit)
    }
    const candleWidth = Math.max(3, Math.min(13, (plotW / Math.max(rows.length, 1)) * 0.58))
    const volumeMax = Math.max(
      ...rows.map((row) => numeric(getByPath(row, volumeField))).filter((value): value is number => value !== undefined),
      1,
    )
    rows.forEach((row, index) => {
      const open = numeric(getByPath(row, openField))
      const high = numeric(getByPath(row, highField))
      const low = numeric(getByPath(row, lowField))
      const close = numeric(getByPath(row, closeField))
      if (open === undefined || high === undefined || low === undefined || close === undefined) return
      const cx = x(index)
      const top = Math.min(y(open), y(close))
      const height = Math.max(1.5, Math.abs(y(close) - y(open)))
      add('line', {
        x1: String(cx),
        x2: String(cx),
        y1: String(y(high)),
        y2: String(y(low)),
        class: 'sqd-chart-wick',
        'data-candle-index': String(index),
      })
      const candle = add('rect', {
        x: String(cx - candleWidth / 2),
        y: String(top),
        width: String(candleWidth),
        height: String(height),
        rx: '1',
        class: close >= open ? 'sqd-chart-up' : 'sqd-chart-down',
        'data-candle-index': String(index),
        'data-open': String(open),
        'data-high': String(high),
        'data-low': String(low),
        'data-close': String(close),
      })
      candle.setAttribute('aria-hidden', 'true')
      const volume = numeric(getByPath(row, volumeField))
      if (hasVolume && volume !== undefined) {
        const volumeY = CHART_PAD.top + priceHeight + volumeGap
        const height = (volume / volumeMax) * volumeHeight
        add('rect', {
          x: String(cx - candleWidth / 2),
          y: String(volumeY + volumeHeight - height),
          width: String(candleWidth),
          height: String(Math.max(1, height)),
          class: close >= open ? 'sqd-chart-volume sqd-chart-volume--up' : 'sqd-chart-volume sqd-chart-volume--down',
          'data-volume': String(volume),
        })
      }
      const titleField = text(tooltipDescriptor.title_field)
      const timeLabel = text(getByPath(row, titleField) ?? row.timestamp_human ?? row.timestamp ?? `Candle ${index + 1}`)
      const fallbackValues = [
        `O ${formatValue(open, priceFormat, priceUnit)}`,
        `H ${formatValue(high, priceFormat, priceUnit)}`,
        `L ${formatValue(low, priceFormat, priceUnit)}`,
        `C ${formatValue(close, priceFormat, priceUnit)}`,
        ...(volume !== undefined ? [`Volume ${formatValue(volume, volumeFormat, volumeUnit)}`] : []),
      ]
      const exactValues = tooltipFields.length
        ? tooltipFields.map((field) => {
            const key = text(field.path ?? field.key)
            return `${text(field.label ?? humanize(key))} ${formatValue(getByPath(row, key), text(field.format), text(field.unit))}`
          })
        : fallbackValues
      const hit = add('rect', {
        x: String(Math.max(CHART_PAD.left, cx - plotW / Math.max(rows.length, 1) / 2)),
        y: String(CHART_PAD.top),
        width: String(Math.max(6, plotW / Math.max(rows.length, 1))),
        height: String(priceHeight + volumeGap + volumeHeight),
        class: 'sqd-chart-hit',
        role: 'img',
        tabindex: '0',
        'aria-label': `${timeLabel}. ${exactValues.join('. ')}.`,
      })
      hit.addEventListener('pointerenter', () => showTooltip(cx, timeLabel, exactValues))
      hit.addEventListener('focus', () => hit.dispatchEvent(new Event('pointerenter')))
      hit.addEventListener('pointerleave', hideTooltip)
      hit.addEventListener('blur', hideTooltip)
    })
    const finalClose = numeric(getByPath(rows.at(-1), closeField))
    if (finalClose !== undefined) {
      const finalY = y(finalClose)
      add('line', {
        x1: String(CHART_PAD.left),
        x2: String(CHART_WIDTH - CHART_PAD.right),
        y1: String(finalY),
        y2: String(finalY),
        class: 'sqd-chart-last-line',
      })
      const pillWidth = 70
      add('rect', {
        x: String(CHART_WIDTH - CHART_PAD.right + 3),
        y: String(finalY - 10),
        width: String(pillWidth),
        height: '20',
        rx: '3',
        class: 'sqd-chart-last-pill',
      })
      const finalLabel = add('text', {
        x: String(CHART_WIDTH - CHART_PAD.right + 8),
        y: String(finalY + 4),
        class: 'sqd-chart-last-value',
      })
      finalLabel.textContent =
        priceFormat === 'currency_usd'
          ? `$${compact(finalClose)}`
          : `${compact(finalClose)}${priceUnit ? ` ${priceUnit}` : ''}`
    }
    svg.setAttribute(
      'aria-label',
      `${chartTitle}. ${rows.length} candles. Last close ${formatValue(finalClose, priceFormat, priceUnit)}.`,
    )
  } else {
    const normalized = normalizeSeries(rows, chart)
    const values = normalized.points.flatMap((point) => point.values).filter((value): value is number => value !== null)
    if (!values.length || !normalized.series.length) {
      wrap.append(element('div', 'sqd-chart-empty', 'The result did not include numeric chart values.'))
      body.append(wrap)
      return root
    }
    const stacked = chart.recommended_visual === 'stacked_area' && normalized.series.length > 1
    const stackTotals = normalized.points.map((point) =>
      point.values.reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0),
    )
    const isBar = chart.recommended_visual === 'bar'
    const min = isBar ? Math.min(0, ...values) : stacked ? 0 : Math.min(...values)
    const max = isBar ? Math.max(0, ...values) : stacked ? Math.max(...stackTotals) : Math.max(...values)
    const rawRange = max - min
    const padding = rawRange > 0
      ? rawRange * 0.08
      : Math.max(Math.abs(max) * 0.02, 1)
    const allZero = min === 0 && max === 0
    const domainMin = allZero ? 0 : min === 0 ? 0 : min - padding
    const domainMax = allZero ? 1 : max === 0 ? 0 : max + padding
    const range = domainMax - domainMin
    const y = (value: number) => CHART_PAD.top + (1 - (value - domainMin) / range) * plotH
    const xField = text(chart.x_field || 'timestamp')
    const optionalXValues = normalized.points.map((point) => numeric(getByPath(point.row, xField)))
    const xValues = optionalXValues.every((value) => value !== undefined) ? optionalXValues as number[] : undefined
    const numericX = Boolean(xValues && Math.max(...xValues) > Math.min(...xValues))
    const minX = numericX && xValues ? Math.min(...xValues) : 0
    const maxX = numericX && xValues ? Math.max(...xValues) : Math.max(normalized.points.length - 1, 1)
    const x = (index: number) => {
      if (normalized.points.length === 1) return CHART_PAD.left + plotW / 2
      const value = numericX && xValues ? xValues[index] : index
      return CHART_PAD.left + ((value - minX) / (maxX - minX)) * plotW
    }
    const expectedStep = xField === 'bucket_index' ? 1 : intervalSeconds(chart.interval)
    const gapBetween = (previousIndex: number, currentIndex: number) => {
      if (!expectedStep || !numericX) return false
      return Boolean(xValues && xValues[currentIndex] - xValues[previousIndex] > expectedStep * 1.5)
    }
    for (let i = 0; i <= 4; i += 1) {
      const gy = CHART_PAD.top + (plotH * i) / 4
      add('line', {
        x1: String(CHART_PAD.left),
        x2: String(CHART_WIDTH - CHART_PAD.right),
        y1: String(gy),
        y2: String(gy),
        class: 'sqd-chart-grid',
      })
      const label = add('text', {
        x: String(CHART_WIDTH - CHART_PAD.right + 8),
        y: String(gy + 3),
        class: 'sqd-chart-label',
      })
      label.textContent = compact(domainMax - (range * i) / 4)
    }

    const seriesNodes = new Map<number, SVGElement[]>()
    const visibleSeries = new Set(normalized.series.map((_series, index) => index))
    const pointHits: Array<{ node: SVGElement; point: ChartPoint; timeLabel: string; cx: number }> = []
    const valuesForPoint = (point: ChartPoint) =>
      normalized.series.flatMap((series, seriesIndex) => {
        if (!visibleSeries.has(seriesIndex)) return []
        const value = point.values[seriesIndex]
        return [`${series.label} ${value === null ? 'not available' : formatValue(value, text(chart.value_format), text(chart.unit))}`]
      })
    const updatePointLabels = () => {
      pointHits.forEach(({ node, point, timeLabel }) => {
        const values = valuesForPoint(point)
        node.setAttribute('aria-label', `${timeLabel}. ${values.length ? values.join('. ') : 'No visible series'}.`)
      })
    }
    const trackSeriesNode = (seriesIndex: number, node: SVGElement) => {
      const nodes = seriesNodes.get(seriesIndex) ?? []
      nodes.push(node)
      seriesNodes.set(seriesIndex, nodes)
      node.setAttribute('data-series-index', String(seriesIndex))
      node.setAttribute('data-series', normalized.series[seriesIndex]?.key ?? String(seriesIndex))
    }

    if (isBar) {
      const groupWidth = plotW / Math.max(normalized.points.length, 1)
      const barWidth = Math.max(2, Math.min(22, (groupWidth * 0.72) / normalized.series.length))
      normalized.points.forEach((point, pointIndex) => {
        point.values.forEach((value, seriesIndex) => {
          if (value === null) return
          const offset = (seriesIndex - (normalized.series.length - 1) / 2) * barWidth
          const baseline = y(0)
          const valueY = y(value)
          const bar = add('rect', {
            x: String(x(pointIndex) + offset - barWidth / 2),
            y: String(Math.min(valueY, baseline)),
            width: String(Math.max(1, barWidth - 1)),
            height: String(Math.max(1, Math.abs(baseline - valueY))),
            rx: '2',
            class: 'sqd-chart-bar',
            fill: normalized.series[seriesIndex].color,
            'data-value': String(value),
          })
          trackSeriesNode(seriesIndex, bar)
        })
      })
    } else if (stacked) {
      const bottoms = new Array(normalized.points.length).fill(0) as number[]
      normalized.series.forEach((series, seriesIndex) => {
        const topValues = normalized.points.map((point, index) => bottoms[index] + Math.max(0, point.values[seriesIndex] ?? 0))
        const top = topValues.map((value, index) => `${x(index)},${y(value)}`).join(' ')
        const bottom = bottoms
          .map((value, index) => `${x(index)},${y(value)}`)
          .reverse()
          .join(' ')
        const area = add('polygon', {
          points: `${top} ${bottom}`,
          class: 'sqd-chart-series-area',
          fill: series.color,
          'data-series-total': String(normalized.points.reduce((sum, point) => sum + (point.values[seriesIndex] ?? 0), 0)),
        })
        trackSeriesNode(seriesIndex, area)
        topValues.forEach((value, index) => {
          bottoms[index] = value
        })
      })
    } else {
      normalized.series.forEach((series, seriesIndex) => {
        const segments: Array<Array<{ x: number; y: number; value: number; index: number }>> = []
        let segment: Array<{ x: number; y: number; value: number; index: number }> = []
        normalized.points.forEach((point, index) => {
          const value = point.values[seriesIndex]
          if (value === null || (segment.length > 0 && gapBetween(segment.at(-1)!.index, index))) {
            if (segment.length) segments.push(segment)
            segment = []
          }
          if (value !== null) segment.push({ x: x(index), y: y(value), value, index })
        })
        if (segment.length) segments.push(segment)
        if (!segments.length) return
        segments.forEach((points) => {
          if (normalized.series.length === 1 && points.length > 1) {
            const baseline = y(0 < domainMin || 0 > domainMax ? domainMin : 0)
            const area = add('polygon', {
              points: `${points[0].x},${baseline} ${points.map((point) => `${point.x},${point.y}`).join(' ')} ${points.at(-1)!.x},${baseline}`,
              class: 'sqd-chart-area',
            })
            trackSeriesNode(seriesIndex, area)
          }
          const line = add('polyline', {
            points: points.map((point) => `${point.x},${point.y}`).join(' '),
            class: 'sqd-chart-line',
            stroke: series.color,
            'data-point-count': String(points.length),
            'data-segment-start': String(points[0].index),
            'data-segment-end': String(points.at(-1)!.index),
          })
          trackSeriesNode(seriesIndex, line)
        })
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
          seriesNodes.get(seriesIndex)?.forEach((node) => {
            node.style.display = visible ? '' : 'none'
          })
          updatePointLabels()
        })
        legend.append(button)
      })
      body.append(legend)
    }

    normalized.points.forEach((point, index) => {
      const timeLabel = text(point.row.timestamp_human ?? point.row.timestamp ?? point.row.bucket_index ?? `Point ${index + 1}`)
      const cx = x(index)
      const hit = add('rect', {
        x: String(Math.max(CHART_PAD.left, cx - plotW / Math.max(normalized.points.length, 1) / 2)),
        y: String(CHART_PAD.top),
        width: String(Math.max(6, plotW / Math.max(normalized.points.length, 1))),
        height: String(plotH),
        class: 'sqd-chart-hit',
        role: 'img',
        tabindex: '0',
        'data-point-index': String(index),
        'data-x-value': text(getByPath(point.row, xField)),
        'aria-label': '',
      })
      pointHits.push({ node: hit, point, timeLabel, cx })
      hit.addEventListener('pointerenter', () => showTooltip(cx, timeLabel, valuesForPoint(point)))
      hit.addEventListener('focus', () => hit.dispatchEvent(new Event('pointerenter')))
      hit.addEventListener('pointerleave', hideTooltip)
      hit.addEventListener('blur', hideTooltip)
    })
    updatePointLabels()

    const firstSeriesValues = normalized.points.map((point) => point.values[0]).filter((value): value is number => value !== null)
    const finalValue = firstSeriesValues.at(-1)
    if (finalValue !== undefined) {
      const finalY = y(finalValue)
      const finalLine = add('line', {
        x1: String(CHART_PAD.left),
        x2: String(CHART_WIDTH - CHART_PAD.right),
        y1: String(finalY),
        y2: String(finalY),
        class: 'sqd-chart-last-line',
      })
      trackSeriesNode(0, finalLine)
      const finalPill = add('rect', {
        x: String(CHART_WIDTH - CHART_PAD.right + 3),
        y: String(finalY - 10),
        width: '70',
        height: '20',
        rx: '3',
        class: 'sqd-chart-last-pill',
      })
      trackSeriesNode(0, finalPill)
      const finalLabel = add('text', {
        x: String(CHART_WIDTH - CHART_PAD.right + 8),
        y: String(finalY + 4),
        class: 'sqd-chart-last-value',
        'data-final-value': String(finalValue),
      })
      trackSeriesNode(0, finalLabel)
      finalLabel.textContent = compact(finalValue)
    }
    svg.setAttribute(
      'aria-label',
      `${chartTitle}. ${normalized.points.length} data points across ${normalized.series.length} series.`,
    )
  }

  const firstLabel = text(rows[0]?.timestamp_human ?? rows[0]?.timestamp ?? rows[0]?.bucket_index ?? 'Start')
  const lastLabel = text(rows.at(-1)?.timestamp_human ?? rows.at(-1)?.timestamp ?? rows.at(-1)?.bucket_index ?? 'End')
  const leftLabel = add('text', { x: String(CHART_PAD.left), y: String(CHART_HEIGHT - 8), class: 'sqd-chart-label' })
  leftLabel.textContent = firstLabel.slice(0, 22)
  const rightLabel = add('text', {
    x: String(CHART_WIDTH - CHART_PAD.right),
    y: String(CHART_HEIGHT - 8),
    'text-anchor': 'end',
    class: 'sqd-chart-label',
  })
  rightLabel.textContent = lastLabel.slice(0, 22)
  wrap.append(svg)
  wrap.append(tooltip)
  body.append(wrap)
  const declaredPoints = Number(chart.total_points ?? chart.total_candles)
  const pointNotice = Number.isFinite(declaredPoints)
    ? displayLimitNotice('chart points', rows.length, rows.length, declaredPoints)
    : null
  if (pointNotice) body.append(pointNotice)
  return root
}

function tableDescriptor(payload: Record<string, unknown>, tableId: string): Record<string, unknown> | undefined {
  return asArray(payload.tables)
    .filter(isRecord)
    .find((entry) => entry.id === tableId)
}

function inferredColumns(rows: Record<string, unknown>[]): Column[] {
  if (!rows.length) return []
  const priority = [
    'timestamp_human',
    'block_number',
    'blockNumber',
    'coin',
    'type',
    'dir',
    'hash',
    'tx_hash',
    'sender',
    'from',
    'recipient',
    'to',
    'address',
    'value_formatted',
    'value',
    'volume_usd',
    'price',
    'px',
    'size',
    'sz',
    'status',
  ]
  const keys = Array.from(new Set(rows.slice(0, 20).flatMap((row) => Object.keys(row)))).filter(
    (key) => !key.startsWith('_') && !isRecord(rows[0]?.[key]) && !Array.isArray(rows[0]?.[key]),
  )
  keys.sort((a, b) => {
    const ai = priority.indexOf(a)
    const bi = priority.indexOf(b)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })
  return keys.slice(0, 9).map((key) => ({
    key,
    label: humanize(key),
    align: typeof rows[0]?.[key] === 'number' ? 'right' : 'left',
    format: /address|hash|sender|recipient|^from$|^to$/.test(key)
      ? 'address'
      : /timestamp$/.test(key)
        ? 'timestamp'
        : typeof rows[0]?.[key] === 'number'
          ? 'decimal'
          : undefined,
  }))
}

function showDetails(title: string, value: unknown) {
  let dialog = document.querySelector<HTMLDialogElement>('.sqd-dialog')
  if (!dialog) {
    dialog = element('dialog', 'sqd-dialog') as HTMLDialogElement
    document.body.append(dialog)
  }
  dialog.replaceChildren()
  const head = element('div', 'sqd-dialog-head')
  const dialogTitle = element('h2', 'sqd-dialog-title', title)
  dialogTitle.id = 'sqd-evidence-dialog-title'
  dialog.setAttribute('aria-labelledby', dialogTitle.id)
  head.append(dialogTitle)
  const close = element('button', 'sqd-button', 'Close')
  close.type = 'button'
  close.addEventListener('click', () => dialog?.close())
  const copy = element('button', 'sqd-button', 'Copy JSON')
  copy.type = 'button'
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
      copy.textContent = 'Copied'
    } catch {
      copy.textContent = 'Copy unavailable'
    }
  })
  const actions = element('div', 'sqd-actions')
  actions.append(copy, close)
  head.append(actions)
  dialog.append(head)
  const body = element('div', 'sqd-dialog-body')
  const pre = element('pre')
  pre.tabIndex = 0
  pre.setAttribute('aria-label', 'Exact row JSON')
  pre.textContent = JSON.stringify(value, null, 2)
  body.append(pre)
  dialog.append(body)
  dialog.showModal()
  close.focus()
}

function tablePanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
  const descriptor = tableDescriptor(payload, text(panel.table_id)) ?? {}
  const rows = asArray(getByPath(payload, text(descriptor.data_key ?? panel.data_key ?? 'items'))).filter(isRecord)
  const columns = asArray(descriptor.columns).filter(isRecord) as Column[]
  const effectiveColumns = columns.length ? columns : inferredColumns(rows)
  const { root, body } = card(
    text(panel.title ?? descriptor.title ?? 'Evidence'),
    text(panel.subtitle ?? descriptor.subtitle),
  )
  if (!rows.length || !effectiveColumns.length) {
    body.append(element('div', 'sqd-chart-empty', 'No evidence rows were returned for this section.'))
    return root
  }
  const tools = element('div', 'sqd-table-tools')
  const search = element('input', 'sqd-input')
  search.type = 'search'
  search.placeholder = 'Filter result evidence'
  search.setAttribute('aria-label', `Filter ${text(panel.title ?? 'evidence')} rows`)
  tools.append(search)
  const count = element('span', 'sqd-brand-subtitle')
  tools.append(count)
  body.append(tools)
  const wrap = element('div', 'sqd-table-wrap')
  const table = element('table', 'sqd-table')
  const caption = element('caption', 'sqd-visually-hidden', text(panel.title ?? 'Blockchain evidence rows'))
  table.append(caption)
  const thead = element('thead')
  const headRow = element('tr')
  let sortKey = ''
  let sortDirection: 'asc' | 'desc' = 'asc'
  let filter = ''
  const headerByKey = new Map<string, HTMLTableCellElement>()
  for (const column of effectiveColumns) {
    const th = element('th')
    th.dataset.align = column.align ?? 'left'
    th.setAttribute('aria-sort', 'none')
    headerByKey.set(column.key, th)
    const button = element('button', 'sqd-sort', text(column.label ?? humanize(column.key)))
    button.type = 'button'
    button.addEventListener('click', () => {
      sortDirection = sortKey === column.key && sortDirection === 'asc' ? 'desc' : 'asc'
      sortKey = column.key
      headerByKey.forEach((header, key) =>
        header.setAttribute('aria-sort', key === sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'),
      )
      renderBody()
    })
    th.append(button)
    headRow.append(th)
  }
  thead.append(headRow)
  table.append(thead)
  const tbody = element('tbody')
  table.append(tbody)
  wrap.append(table)
  body.append(wrap)

  function renderBody() {
    const matches = rows.filter((row) => !filter || JSON.stringify(row).toLowerCase().includes(filter))
    if (sortKey)
      matches.sort(
        (a, b) =>
          text(getByPath(a, effectiveColumns.find((column) => column.key === sortKey)?.path ?? sortKey)).localeCompare(
            text(getByPath(b, effectiveColumns.find((column) => column.key === sortKey)?.path ?? sortKey)),
            undefined,
            { numeric: true },
          ) * (sortDirection === 'asc' ? 1 : -1),
      )
    const visible = matches.slice(0, MAX_TABLE_ROWS)
    count.textContent =
      matches.length > visible.length
        ? `${visible.length} of ${matches.length} matching rows shown`
        : `${visible.length} row${visible.length === 1 ? '' : 's'}`
    tbody.replaceChildren()
    for (const [index, row] of visible.entries()) {
      const tr = element('tr')
      for (const [columnIndex, column] of effectiveColumns.entries()) {
        const td = element('td')
        td.dataset.align = column.align ?? 'left'
        const rawValue = getByPath(row, column.path ?? column.key)
        const formatted = formatValue(rawValue, column.format, column.unit)
        if (isIdentifierColumn(column, rawValue)) td.classList.add('sqd-hash')
        if (columnIndex === 0) {
          const button = element('button', 'sqd-row-button', formatted)
          button.type = 'button'
          button.title = 'Open exact row'
          button.addEventListener('click', () => showDetails(`Evidence row ${index + 1}`, row))
          td.append(button)
        } else {
          td.textContent = formatted
          td.title = formatted
        }
        tr.append(td)
      }
      tbody.append(tr)
    }
  }
  search.addEventListener('input', () => {
    filter = search.value.trim().toLowerCase()
    renderBody()
  })
  renderBody()
  const declaredRows = Number(descriptor.row_count)
  const totalRows = Number.isFinite(declaredRows) ? Math.max(rows.length, declaredRows) : rows.length
  const limitNotice = displayLimitNotice('evidence rows', Math.min(rows.length, MAX_TABLE_ROWS), rows.length, totalRows)
  if (limitNotice) body.append(limitNotice)
  return root
}

function timelinePanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
  const sourceRows = numberRows(payload, panel)
  const rows = sourceRows.slice(0, MAX_TIMELINE_ROWS)
  const { root, body } = card(text(panel.title ?? 'Activity timeline'), text(panel.subtitle))
  const timeline = element('div', 'sqd-timeline')
  for (const row of rows) {
    const event = element('article', 'sqd-event')
    event.append(element('span', 'sqd-event-dot'))
    const copy = element('div')
    copy.append(element('div', 'sqd-event-title', text(getByPath(row, text(panel.title_key)) ?? 'Activity')))
    const subtitle = asArray(panel.subtitle_keys)
      .map((key) => text(getByPath(row, text(key))))
      .filter(Boolean)
      .join(' · ')
    if (subtitle) copy.append(element('div', 'sqd-event-subtitle', subtitle))
    event.append(copy)
    event.append(element('time', 'sqd-event-time', text(getByPath(row, text(panel.timestamp_key)))))
    timeline.append(event)
  }
  body.append(rows.length ? timeline : element('div', 'sqd-chart-empty', 'No activity rows were returned.'))
  const limitNotice = displayLimitNotice('timeline rows', rows.length, sourceRows.length)
  if (limitNotice) body.append(limitNotice)
  return root
}

function rankedPanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
  const sourceRows = numberRows(payload, panel)
  const rows = sourceRows.slice(0, MAX_RANKED_ROWS)
  const values = rows
    .map((row) => numeric(getByPath(row, text(panel.value_key))))
    .filter((value): value is number => value !== undefined)
  const max = Math.max(...values, 1)
  const { root, body } = card(
    text(panel.title ?? 'Ranked activity'),
    text(panel.subtitle),
    panel.emphasis === 'primary' ? 'sqd-card--primary' : '',
  )
  const ranked = element('div', 'sqd-ranked')
  for (const row of rows) {
    const value = numeric(getByPath(row, text(panel.value_key))) ?? 0
    const item = element('div', 'sqd-ranked-row')
    item.append(element('div', 'sqd-ranked-label', text(getByPath(row, text(panel.category_key)) ?? 'Unknown')))
    const track = element('div', 'sqd-ranked-track')
    const fill = element('div', 'sqd-ranked-fill')
    fill.style.width = `${Math.max(2, (value / max) * 100)}%`
    track.append(fill)
    item.append(track)
    item.append(element('div', 'sqd-ranked-value', formatValue(value, text(panel.value_format), text(panel.unit))))
    ranked.append(item)
  }
  body.append(rows.length ? ranked : element('div', 'sqd-chart-empty', 'No ranked values were returned.'))
  const limitNotice = displayLimitNotice('ranked rows', rows.length, sourceRows.length)
  if (limitNotice) body.append(limitNotice)
  return root
}

function statPanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
  const sourceRows = numberRows(payload, panel)
  const rows = sourceRows.slice(0, MAX_STAT_ROWS)
  const { root, body } = card(text(panel.title ?? 'Details'), text(panel.subtitle), 'sqd-card--half')
  const list = element('div', 'sqd-stat-list')
  for (const row of rows) {
    const stat = element('div', 'sqd-stat')
    stat.append(element('span', 'sqd-stat-label', text(getByPath(row, text(panel.label_key)))))
    stat.append(
      element(
        'span',
        'sqd-stat-value',
        formatValue(getByPath(row, text(panel.value_key)), text(panel.value_format), text(panel.unit)),
      ),
    )
    list.append(stat)
  }
  body.append(list)
  const limitNotice = displayLimitNotice('detail rows', rows.length, sourceRows.length)
  if (limitNotice) body.append(limitNotice)
  return root
}

function inferredPanel(payload: Record<string, unknown>): HTMLElement | null {
  const keys = [
    'items',
    'transactions',
    'transfers',
    'logs',
    'events',
    'calls',
    'instructions',
    'ohlc',
    'time_series',
    'volume_by_coin',
    'top_contracts',
  ]
  const key = keys.find((candidate) => asArray(payload[candidate]).some(isRecord))
  if (!key) return null
  return tablePanel(payload, { title: humanize(key), data_key: key })
}

function panels(payload: Record<string, unknown>): HTMLElement | null {
  const ui = isRecord(payload._ui) ? payload._ui : {}
  const specs = asArray(ui.panels).filter(isRecord)
  const layout = ['dashboard', 'chart_focus', 'split'].includes(text(ui.layout)) ? text(ui.layout) : 'dashboard'
  const intent = ['market_terminal', 'analytics_dashboard', 'activity_investigator'].includes(text(ui.design_intent))
    ? text(ui.design_intent)
    : 'analytics_dashboard'
  const density = ui.density === 'compact' ? 'compact' : 'comfortable'
  const grid = element('section', `sqd-grid sqd-grid--${layout} sqd-grid--${intent} sqd-grid--${density}`)
  grid.setAttribute('aria-label', 'Blockchain evidence views')
  for (const panel of specs) {
    const kind = text(panel.kind)
    if (kind === 'chart_panel') grid.append(chartPanel(payload, panel))
    else if (kind === 'table_panel') grid.append(tablePanel(payload, panel))
    else if (kind === 'timeline_panel') grid.append(timelinePanel(payload, panel))
    else if (kind === 'ranked_bars_panel') grid.append(rankedPanel(payload, panel))
    else if (kind === 'stat_list_panel') grid.append(statPanel(payload, panel))
  }
  if (!specs.length) {
    const inferred = inferredPanel(payload)
    if (inferred) grid.append(inferred)
  }
  return grid.childElementCount ? grid : null
}

function notices(payload: Record<string, unknown>): HTMLElement | null {
  const values = [payload._notice, ...asArray(payload._notices)].map(text).filter(Boolean)
  const error = isRecord(payload.error) ? payload.error : undefined
  if (error?.summary) values.unshift(text(error.summary))
  if (!values.length) return null
  const wrap = element('section', 'sqd-notices')
  wrap.setAttribute('aria-label', 'Important result notices')
  values.slice(0, 6).forEach((value) => wrap.append(element('div', 'sqd-notice', value)))
  return wrap
}

function followups(payload: Record<string, unknown>, actions: ExplorerActions): HTMLElement | null {
  const ui = isRecord(payload._ui) ? payload._ui : {}
  const specs = asArray(ui.follow_up_actions).filter(isRecord)
  const pagination = isRecord(payload._pagination) ? payload._pagination : {}
  if (pagination.has_more && !specs.some((action) => action.intent === 'continue'))
    specs.unshift({ label: 'Load more evidence', intent: 'continue', target: '_pagination.next_cursor' })
  const executable = specs.filter(
    (action) =>
      action.executable !== false &&
      ['continue', 'compare_previous', 'drilldown', 'show_raw', 'zoom_in'].includes(text(action.intent)),
  )
  if (!executable.length) return null
  const bar = element('div', 'sqd-actions')
  for (const [index, action] of executable.entries()) {
    const button = element(
      'button',
      `sqd-button${index === 0 ? ' sqd-button--primary' : ''}`,
      text(action.label ?? humanize(text(action.intent))),
    )
    button.type = 'button'
    button.disabled = action.intent === 'continue' && !pagination.next_cursor
    button.addEventListener('click', () => actions.runFollowup(text(action.intent), text(action.target), action))
    bar.append(button)
  }
  return bar
}

function raw(payload: Record<string, unknown>): HTMLElement {
  const details = element('details', 'sqd-raw')
  details.append(element('summary', undefined, 'View exact JSON evidence'))
  const pre = element('pre')
  pre.tabIndex = 0
  pre.setAttribute('aria-label', 'Exact result JSON')
  pre.textContent = JSON.stringify(payload, null, 2)
  details.append(pre)
  return details
}

function loadingState(): HTMLElement {
  const wrap = element('div', 'sqd-shell')
  wrap.setAttribute('aria-busy', 'true')
  wrap.setAttribute('aria-label', 'Loading blockchain data')
  wrap.append(element('div', 'sqd-skeleton'))
  const grid = element('div', 'sqd-metrics')
  for (let i = 0; i < 4; i += 1) grid.append(element('div', 'sqd-skeleton'))
  wrap.append(grid)
  wrap.append(element('div', 'sqd-skeleton'))
  return wrap
}

function emptyState(error = ''): HTMLElement {
  const empty = element('section', 'sqd-empty')
  const copy = element('div')
  copy.append(
    element('h2', undefined, error ? 'The explorer could not open this result' : 'Ask SQD about blockchain activity'),
  )
  copy.append(
    element(
      'p',
      undefined,
      error ||
        'Explore wallets, contracts, token flows, network activity, Bitcoin, Tron, Solana, Polkadot, Hyperliquid, and every other blockchain dataset available through SQD Portal.',
    ),
  )
  empty.append(copy)
  return empty
}

export function renderExplorer(root: HTMLElement, state: ExplorerState, actions: ExplorerActions) {
  injectStyle()
  root.className = 'sqd-app'
  root.replaceChildren()
  const shell = element('main', 'sqd-shell')
  shell.append(appHeader(actions, state))
  if (state.loading && !state.payload) shell.append(loadingState())
  else if (!state.payload) shell.append(emptyState(state.error))
  else {
    shell.append(hero(state.payload))
    const metrics = metricCards(state.payload)
    if (metrics) shell.append(metrics)
    const resultNotices = notices(state.payload)
    if (resultNotices) shell.append(resultNotices)
    const views = panels(state.payload)
    if (views) shell.append(views)
    const next = followups(state.payload, actions)
    if (next) shell.append(next)
    shell.append(raw(state.payload))
  }
  const footer = element('footer', 'sqd-footer')
  footer.append(element('span', undefined, 'Read-only blockchain data from SQD Portal'))
  footer.append(element('span', undefined, 'Coverage and freshness stay visible in every result'))
  shell.append(footer)
  root.append(shell)
}
