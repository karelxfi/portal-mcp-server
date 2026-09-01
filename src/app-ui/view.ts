import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'

import { ACTIVITY_EXPLORER_CSS } from './styles.js'

export type ExplorerState = {
  payload: Record<string, unknown> | null
  rawText: string
  loading: boolean
  error: string
  currentArgs: Record<string, unknown>
  displayMode?: string
  historyIndex?: number
  historyLength?: number
}

export type ExplorerActions = {
  runFollowup: (intent: string, target?: string, action?: Record<string, unknown>) => void
  requestFullscreen?: () => void
  goBack?: () => void
  goForward?: () => void
  exportEvidence?: (format: 'json' | 'csv') => void
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
const TABLE_PAGE_SIZE = 20
const MAX_TIMELINE_ROWS = 40
const MAX_RANKED_ROWS = 16
const MAX_STAT_ROWS = 30
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

/* Canvas charts need literal colors; these mirror the styles.ts tokens. */
const TERMINAL_COLORS = {
  up: '#0891b2',
  down: '#d97706',
  upSoft: 'rgba(8, 145, 178, 0.55)',
  downSoft: 'rgba(217, 119, 6, 0.55)',
  accent: '#818cf8',
  accentLine: 'rgba(129, 140, 248, 0.45)',
  ink: '#d1d1dc',
  grid: 'rgba(255, 255, 255, 0.055)',
  axis: 'rgba(255, 255, 255, 0.14)',
  crosshair: 'rgba(255, 255, 255, 0.24)',
  crosshairLabel: '#2a2a31',
}
const TERMINAL_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

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

/* The SVG coordinate space shrinks on narrow hosts so type stays near its CSS
   size instead of scaling away with the viewBox. */
function chartGeometry() {
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 520px)').matches
  return narrow
    ? { width: 460, height: 380, pad: { left: 10, right: 58, top: 14, bottom: 30 }, axisTitles: false }
    : { width: 900, height: 320, pad: { left: 26, right: 76, top: 14, bottom: 32 }, axisTitles: true }
}

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
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value).replace(/K/g, 'k')
}

function pillCompact(value: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 })
    .format(value)
    .replace(/K/g, 'k')
}

function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatValue(value: unknown, format?: string, unit?: string): string {
  if (value === null || value === undefined || value === '') return 'Not available'
  if (typeof value === 'string' && format !== 'timestamp') {
    return unit && !value.toLowerCase().includes(unit.toLowerCase()) ? `${value} ${unit}` : value
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
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })
        .format(numberValue)
        .replace(/K/g, 'k')
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
      formatted =
        numberValue !== 0 && Math.abs(numberValue) < 1
          ? Number(numberValue.toPrecision(6)).toString()
          : Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(numberValue)
  }
  return unit && !formatted.toLowerCase().includes(unit.toLowerCase()) ? `${formatted} ${unit}` : formatted
}

function humanize(value: string): string {
  return value
    .replace(/^_+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isHexIdentifier(value: string): boolean {
  return /^0x[0-9a-fA-F]{8,}$/.test(value)
}

function shortIdentifier(value: string): string {
  return isHexIdentifier(value) && value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}

function shortTimeLabel(value: string): string {
  const clock = /\b(\d{2}:\d{2})(?::\d{2})?\b/.exec(value)
  if (clock) return clock[1]
  return value.slice(0, 22)
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
  copy.append(element('div', 'sqd-brand-subtitle', 'Explorer'))
  brand.append(copy)
  topbar.append(brand)

  const actionBar = element('div', 'sqd-actions')
  if (actions.goBack || actions.goForward) {
    const back = element('button', 'sqd-button', 'Back')
    back.type = 'button'
    back.disabled = (state.historyIndex ?? 0) <= 0
    back.setAttribute('aria-label', 'Open previous result in this session')
    back.addEventListener('click', () => actions.goBack?.())
    const forward = element('button', 'sqd-button', 'Forward')
    forward.type = 'button'
    forward.disabled = (state.historyIndex ?? 0) >= (state.historyLength ?? 1) - 1
    forward.setAttribute('aria-label', 'Open next result in this session')
    forward.addEventListener('click', () => actions.goForward?.())
    actionBar.append(back, forward)
  }
  if (actions.requestFullscreen && state.displayMode !== 'fullscreen') {
    const fullscreen = element('button', 'sqd-button', 'Open full screen')
    fullscreen.type = 'button'
    fullscreen.addEventListener('click', () => actions.requestFullscreen?.())
    actionBar.append(fullscreen)
  }
  topbar.append(actionBar)
  return topbar
}

function workspaceMode(payload: Record<string, unknown>): { label: string } {
  const contract = isRecord(payload._tool_contract) ? payload._tool_contract : {}
  const name = text(contract.name)
  if (name.includes('wallet')) return { label: 'Wallet investigation' }
  if (name.includes('contract') || name.includes('_logs') || name.includes('token_transfers')) {
    return { label: 'Contract investigation' }
  }
  if (name.includes('ohlc') || name.includes('hyperliquid')) return { label: 'Market terminal' }
  if (name.includes('analytics')) return { label: 'Analytics' }
  if (name.includes('network') || name === 'portal_get_head') return { label: 'Network status' }
  if (name.includes('transaction') || name.includes('recent_activity')) return { label: 'Activity investigation' }
  return { label: 'Investigation' }
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

function primaryMetric(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const ui = isRecord(payload._ui) ? payload._ui : {}
  return asArray(ui.metric_cards)
    .filter(isRecord)
    .find((spec) => spec.emphasis === 'primary')
}

function masthead(payload: Record<string, unknown>): HTMLElement {
  const ui = isRecord(payload._ui) ? payload._ui : {}
  const headline = isRecord(ui.headline) ? ui.headline : {}
  const display = isRecord(payload.display) ? payload.display : {}
  const meta = isRecord(payload._meta) ? payload._meta : {}
  const summary = isRecord(payload.summary) ? payload.summary : {}
  const state = resultState(payload)
  const mode = workspaceMode(payload)
  const section = element('section', 'sqd-hero')
  section.setAttribute('aria-labelledby', 'sqd-result-title')

  const eyebrow = element('div', 'sqd-eyebrow')
  if (state.tone) eyebrow.append(element('span', `sqd-dot sqd-dot--${state.tone}`))
  const overlineParts = [mode.label, text(meta.network ?? meta.dataset ?? payload.network), text(summary.coin)]
    .filter(Boolean)
    .join(' · ')
  eyebrow.append(document.createTextNode(overlineParts))
  section.append(eyebrow)

  const error = isRecord(payload.error) ? payload.error : undefined
  const claim = text(
    payload.answer ?? headline.title ?? display.title ?? error?.summary ?? payload._summary ?? 'Blockchain activity',
  )
  const title = element('h1', 'sqd-title', claim)
  title.id = 'sqd-result-title'
  section.append(title)

  const subtitleText = text(headline.subtitle ?? display.subtitle)
  if (subtitleText && subtitleText !== claim) section.append(element('p', 'sqd-subtitle', subtitleText))

  const heroSpec = primaryMetric(payload)
  if (heroSpec) {
    const value = getByPath(payload, text(heroSpec.value_path))
    if (value !== undefined && value !== null && value !== '') {
      const figure = element('div', 'sqd-hero-figure')
      figure.append(element('div', 'sqd-hero-value', formatValue(value, text(heroSpec.format), text(heroSpec.unit))))
      figure.append(element('div', 'sqd-hero-label', text(heroSpec.label ?? 'Headline value')))
      section.append(figure)
    }
  }

  section.append(contextLine(payload, state))
  return section
}

function contextLine(
  payload: Record<string, unknown>,
  state: { label: string; tone: string; partial: boolean },
): HTMLElement {
  const meta = isRecord(payload._meta) ? payload._meta : {}
  const freshness = isRecord(payload._freshness) ? payload._freshness : {}
  const coverage = isRecord(payload._coverage) ? payload._coverage : {}
  const pagination = isRecord(payload._pagination) ? payload._pagination : {}
  const row = element('div', 'sqd-context')
  const push = (value: string, tone?: string) => {
    if (!value) return
    row.append(element('span', tone ? `sqd-context--${tone}` : undefined, value))
  }
  const window = text(coverage.requested_window ?? coverage.window ?? meta.timeframe)
  if (window) push(`window ${window}`)
  const rowCount = meta.row_count ?? meta.result_count ?? (asArray(payload.items).length || undefined)
  if (rowCount !== undefined && rowCount !== null && !isRecord(rowCount)) {
    push(`${text(rowCount)} row${text(rowCount) === '1' ? '' : 's'}`)
  }
  const blocks = text(meta.queried_blocks)
  if (blocks) push(`blocks ${blocks}`)
  const finality = text(freshness.finality ?? freshness.kind)
  if (finality) push(finality)
  const head = text(freshness.indexed_head_block)
  if (head) push(`head ${head}`)
  if (state.partial && state.tone === 'warning') push('partial: check coverage before using totals', 'warning')
  if (state.tone === 'danger') push('needs attention', 'danger')
  if (pagination.has_more === true && pagination.continuation_scope === 'adjacent_window') {
    push('older adjacent window available')
  }
  return row
}

function evidenceReceipt(payload: Record<string, unknown>, actions: ExplorerActions): HTMLElement | null {
  const evidence = isRecord(payload._evidence) ? payload._evidence : undefined
  if (!evidence) return null
  const result = isRecord(evidence.result) ? evidence.result : {}
  const source = isRecord(evidence.source) ? evidence.source : {}
  const request = isRecord(evidence.request) ? evidence.request : {}
  const analyzed = isRecord(request.analyzed_window) ? request.analyzed_window : {}
  const completeness = text(result.completeness || 'unknown')
  const rowCount = numeric(result.row_count) ?? 0
  const digest = text(result.exact_data_sha256)

  const section = element('section', 'sqd-receipt')
  section.setAttribute('aria-label', 'Evidence receipt')
  const copy = element('div', 'sqd-receipt-copy')
  copy.append(
    element('span', 'sqd-receipt-title', `${rowCount} exact row${rowCount === 1 ? '' : 's'} · ${completeness}`),
  )
  const metaParts = [
    text(source.network ?? source.dataset),
    digest ? `SHA-256 ${digest.slice(0, 12)}` : '',
    analyzed.window_from_block !== undefined && analyzed.window_to_block !== undefined
      ? `blocks ${text(analyzed.window_from_block)} to ${text(analyzed.window_to_block)}`
      : '',
  ].filter(Boolean)
  copy.append(element('span', 'sqd-receipt-meta', metaParts.join(' · ')))
  section.append(copy)

  const actionBar = element('div', 'sqd-actions')
  if (actions.exportEvidence) {
    for (const format of ['json', 'csv'] as const) {
      const button = element('button', 'sqd-button', `Download ${format.toUpperCase()}`)
      button.type = 'button'
      button.addEventListener('click', () => actions.exportEvidence?.(format))
      actionBar.append(button)
    }
  }
  const full = element('button', 'sqd-button', 'Full receipt')
  full.type = 'button'
  full.addEventListener('click', () =>
    showDetails('Evidence receipt', evidence, 'Request arguments, exact-data digest, and replay path for this result.'),
  )
  actionBar.append(full)
  section.append(actionBar)
  return section
}

function metricCards(payload: Record<string, unknown>): HTMLElement | null {
  const ui = isRecord(payload._ui) ? payload._ui : {}
  const specs = asArray(ui.metric_cards).filter(isRecord)
  const fallbacks: Record<string, unknown>[] = []
  if (!specs.length) {
    const contract = isRecord(payload._tool_contract) ? payload._tool_contract : {}
    if (contract.name === 'portal_evm_get_contract_activity') {
      fallbacks.push(
        { label: 'Interactions', value_path: 'interactions.total_transactions', format: 'integer' },
        { label: 'Unique callers', value_path: 'interactions.unique_callers', format: 'integer' },
        { label: 'Events', value_path: 'events.total_events', format: 'integer' },
        { label: 'Event types', value_path: 'events.unique_event_types', format: 'integer' },
      )
    }
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
  const heroSpec = specs.length ? primaryMetric(payload) : undefined
  const cards = (specs.length ? specs : fallbacks).filter((spec) => spec !== heroSpec)
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
  const value = getByPath(payload, text(descriptor.data_key))
  if (descriptor.object_map === true && isRecord(value)) {
    const categoryKey = text(descriptor.category_key || 'category')
    const valueKey = text(descriptor.value_key || 'value')
    return Object.entries(value)
      .map(([category, item]) => ({ [categoryKey]: category, [valueKey]: item }))
      .sort((left, right) => (numeric(right[valueKey]) ?? 0) - (numeric(left[valueKey]) ?? 0))
  }
  return asArray(value).filter(isRecord)
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

/* Axis scales follow the Chart Standards band() rule: floors and ceilings land
   on the 1/2/5 ladder. Zero is compulsory when the mark's size carries the
   value (bars, stacked segments, areas) and optional when position carries it,
   so lines get a banded axis with a labelled floor and no area fill. */
const STEP_LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

function bandScale(
  min: number,
  max: number,
  zeroBased: boolean,
): { domainMin: number; domainMax: number; ticks: number[] } {
  let low = zeroBased ? Math.min(0, min) : min
  let high = zeroBased ? Math.max(0, max) : max
  if (high === low) {
    const nudge = Math.max(Math.abs(high) * 0.001, 1e-9)
    low -= nudge
    high += nudge
  }
  const span = high - low
  const pad = span * 0.08
  const paddedLow = zeroBased && low === 0 ? 0 : low - pad
  const paddedHigh = zeroBased && high === 0 ? 0 : high + pad
  const paddedSpan = paddedHigh - paddedLow
  const power = 10 ** Math.floor(Math.log10(paddedSpan / 4))
  let best: { step: number; domainMin: number; domainMax: number; score: number } | undefined
  for (const unit of STEP_LADDER) {
    const step = unit * power
    const domainMin = Math.floor(paddedLow / step) * step
    const domainMax = Math.ceil(paddedHigh / step) * step
    const intervals = Math.round((domainMax - domainMin) / step)
    if (intervals < 3 || intervals > 7) continue
    const score = span / (domainMax - domainMin) - Math.abs(intervals - 5) * 0.01
    if (!best || score > best.score) best = { step, domainMin, domainMax, score }
  }
  if (!best) {
    const step = 10 * power
    best = {
      step,
      domainMin: Math.floor(paddedLow / step) * step,
      domainMax: Math.ceil(paddedHigh / step) * step,
      score: 0,
    }
  }
  const ticks: number[] = []
  for (let value = best.domainMin; value <= best.domainMax + best.step / 2; value += best.step) {
    ticks.push(Math.abs(value) < best.step / 1e6 ? 0 : value)
  }
  return { domainMin: best.domainMin, domainMax: best.domainMax, ticks }
}

function tickText(value: number, format?: string, isTop = false): string {
  const magnitude = Math.abs(value)
  let base: string
  if (value === 0) base = '0'
  else if (magnitude >= 1000) base = compact(value)
  else if (magnitude < 1) base = Number(value.toPrecision(3)).toString()
  else base = Number(value.toPrecision(4)).toString()
  if (format === 'currency_usd' && isTop) return `$${base}`
  return base
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

function evidenceIdentity(row: Record<string, unknown>): string {
  const keys = [
    'primary_id',
    'hash',
    'tx_hash',
    'transactionHash',
    'logIndex',
    'block_number',
    'blockNumber',
    'timestamp',
    'bucket_index',
    'coin',
  ]
  const identity = Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]))
  return JSON.stringify(Object.keys(identity).length ? identity : row)
}

type EvidencePager = HTMLElement & { __sqdShowEvidence?: (identity: string) => void }

function selectEvidenceRow(row: Record<string, unknown>, selectedHit: Element) {
  const identity = evidenceIdentity(row)
  document.querySelectorAll<Element>('.sqd-chart-hit[aria-pressed]').forEach((hit) => {
    hit.setAttribute('aria-pressed', String(hit === selectedHit))
  })
  document.querySelectorAll<EvidencePager>('.sqd-table-wrap').forEach((wrap) => wrap.__sqdShowEvidence?.(identity))
  let selectedTableRow: HTMLTableRowElement | undefined
  document.querySelectorAll<HTMLTableRowElement>('tr[data-evidence-key]').forEach((tableRow) => {
    const selected = tableRow.dataset.evidenceKey === identity
    tableRow.dataset.selected = String(selected)
    if (selected && !selectedTableRow) selectedTableRow = tableRow
  })
  selectedTableRow?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function bindPointSelection(hit: SVGElement, row: Record<string, unknown>) {
  hit.setAttribute('role', 'button')
  hit.setAttribute('aria-pressed', 'false')
  hit.addEventListener('click', () => selectEvidenceRow(row, hit))
  hit.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectEvidenceRow(row, hit)
    }
  })
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
      series: [{ key: yField, label: text(chart.y_axis_label || humanize(yField)), color: 'var(--accent)' }],
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
function buildCandleTerminal(
  panelRoot: HTMLElement,
  chart: Record<string, unknown>,
  rows: Record<string, unknown>[],
  chartTitle: string,
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
  const isOpenCandle = (point: (typeof parsed)[number]) =>
    point.row.is_closed === false || point.row.open_candle === true
  const hasVolume = chart.volume_panel !== false && parsed.some((point) => point.volume !== undefined)
  const volumeMax = hasVolume ? Math.max(...parsed.map((point) => point.volume ?? 0)) : 0
  const finalClose = parsed[parsed.length - 1].close
  const prices = parsed.flatMap((point) => [point.low, point.high])
  const priceSpan = Math.max(Math.max(...prices) - Math.min(...prices), Math.abs(finalClose) * 0.001, 1e-9)
  const minMove = 10 ** Math.min(0, Math.max(-8, Math.floor(Math.log10(priceSpan)) - 3))
  const exactValues = parsed.map((point) => {
    const fallback = [
      `O ${formatValue(point.open, priceFormat, priceUnit)}`,
      `H ${formatValue(point.high, priceFormat, priceUnit)}`,
      `L ${formatValue(point.low, priceFormat, priceUnit)}`,
      `C ${formatValue(point.close, priceFormat, priceUnit)}`,
      ...(point.volume !== undefined ? [`Volume ${formatValue(point.volume, volumeFormat, volumeUnit)}`] : []),
    ]
    const values = tooltipFields.length
      ? tooltipFields.map((field) => {
          const key = text(field.path ?? field.key)
          return `${text(field.label ?? humanize(key))} ${formatValue(getByPath(point.row, key), text(field.format), text(field.unit))}`
        })
      : fallback
    if (isOpenCandle(point)) values.push('Open candle, still forming')
    return values
  })

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
  const tooltip = element('div', 'sqd-chart-tooltip')
  tooltip.setAttribute('role', 'status')
  tooltip.setAttribute('aria-live', 'polite')
  tooltip.hidden = true
  const pill = element('div', 'sqd-candle-pill')
  pill.hidden = true
  pill.textContent =
    (priceFormat === 'currency_usd' ? '$' : '') +
    (Math.abs(finalClose) >= 1000 ? pillCompact(finalClose) : tickText(finalClose, priceFormat))
  chartBox.append(mount, hits, pill, tooltip)
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

  const chartApi = createChart(mount, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: TERMINAL_COLORS.ink,
      fontFamily: TERMINAL_MONO,
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: TERMINAL_COLORS.grid },
      horzLines: { color: TERMINAL_COLORS.grid },
    },
    rightPriceScale: {
      borderColor: TERMINAL_COLORS.axis,
      scaleMargins: { top: 0.06, bottom: hasVolume ? 0.3 : 0.08 },
    },
    timeScale: {
      borderColor: TERMINAL_COLORS.axis,
      timeVisible: true,
      secondsVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
      tickMarkFormatter: (time: number) =>
        timeToLabel.get(time) ?? (monotonic ? new Date(time * 1000).toISOString().slice(11, 16) : ''),
    },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: {
        color: TERMINAL_COLORS.crosshair,
        width: 1,
        style: LineStyle.LargeDashed,
        labelBackgroundColor: TERMINAL_COLORS.crosshairLabel,
      },
      horzLine: {
        color: TERMINAL_COLORS.crosshair,
        width: 1,
        style: LineStyle.LargeDashed,
        labelBackgroundColor: TERMINAL_COLORS.crosshairLabel,
      },
    },
    handleScroll: false,
    handleScale: false,
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
  const renderReadout = (index: number) => {
    const point = parsed[index]
    const direction = point.close >= point.open ? 'up' : 'down'
    readout.replaceChildren(
      element('span', 'sqd-candle-readout-time', fullLabels[index]),
      readoutPair('O', formatValue(point.open, priceFormat)),
      readoutPair('H', formatValue(point.high, priceFormat)),
      readoutPair('L', formatValue(point.low, priceFormat)),
      readoutPair('C', formatValue(point.close, priceFormat), direction),
      ...(point.volume !== undefined ? [readoutPair('VOL', formatValue(point.volume, volumeFormat))] : []),
      ...(isOpenCandle(point) ? [element('span', 'sqd-candle-readout-flag', 'Open candle, still forming')] : []),
    )
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
    button.setAttribute('aria-label', `${fullLabels[index]}. ${exactValues[index].join('. ')}.`)
    button.setAttribute('aria-pressed', 'false')
    button.style.left = `${(index / parsed.length) * 100}%`
    button.style.width = `${100 / parsed.length}%`
    const hover = () => {
      renderReadout(index)
      tooltip.textContent = `${fullLabels[index]}: ${exactValues[index].join(', ')}`
      const boxRect = chartBox.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      const percent = boxRect.width
        ? ((buttonRect.left - boxRect.left + buttonRect.width / 2) / boxRect.width) * 100
        : 50
      tooltip.style.left = `${Math.min(88, Math.max(12, percent))}%`
      tooltip.hidden = false
      chartApi.setCrosshairPosition(point.close, times[index], candleSeries)
    }
    const unhover = () => {
      tooltip.hidden = true
      chartApi.clearCrosshairPosition()
      renderReadout(parsed.length - 1)
    }
    button.addEventListener('pointerenter', hover)
    button.addEventListener('pointerleave', unhover)
    button.addEventListener('focus', hover)
    button.addEventListener('blur', unhover)
    button.addEventListener('click', () => selectEvidenceRow(point.row, button))
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
    const pillY = candleSeries.priceToCoordinate(finalClose)
    if (pillY !== null) {
      pill.style.top = `${pillY}px`
      pill.hidden = false
    }
    if (volumeSeries && volumeCaption) {
      const bandTop = volumeSeries.priceToCoordinate(volumeMax)
      if (bandTop !== null) {
        volumeCaption.style.top = `${bandTop - 17}px`
        volumeCaption.hidden = false
      }
    }
  }
  const scheduleSync = () =>
    requestAnimationFrame(() => {
      chartApi.timeScale().fitContent()
      requestAnimationFrame(sync)
    })
  chartApi.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(sync))
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleSync) : undefined
  observer?.observe(chartBox)
  scheduleSync()
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(scheduleSync).catch(() => {})
  }
  registerChartDisposer(panelRoot, chartApi, () => observer?.disconnect())
  return terminal
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
  const geometry = chartGeometry()
  const CHART_WIDTH = geometry.width
  const CHART_HEIGHT = geometry.height
  const CHART_PAD = geometry.pad
  const allRows = sortRowsByX(numberRows(payload, chart), chart)
  const requestedStart = Number(panel.__range_start)
  const requestedEnd = Number(panel.__range_end)
  const rangeStart = Number.isInteger(requestedStart) ? Math.max(0, Math.min(requestedStart, allRows.length - 1)) : 0
  const rangeEnd = Number.isInteger(requestedEnd)
    ? Math.max(rangeStart, Math.min(requestedEnd, allRows.length - 1))
    : Math.max(0, allRows.length - 1)
  const rows = allRows.slice(rangeStart, rangeEnd + 1)
  let rangeControls: HTMLElement | undefined
  if (!rows.length) {
    wrap.append(element('div', 'sqd-chart-empty', 'No chart points were returned for this window.'))
    body.append(wrap)
    return root
  }
  if (allRows.length > 8) {
    const rangeTools = element('div', 'sqd-chart-range')
    const rangeCopy = element(
      'span',
      'sqd-chart-range-copy',
      `Viewing ${rangeStart + 1} to ${rangeEnd + 1} of ${allRows.length} exact points`,
    )
    const start = element('input', 'sqd-range')
    start.type = 'range'
    start.min = '0'
    start.max = String(allRows.length - 1)
    start.value = String(rangeStart)
    start.setAttribute('aria-label', 'First visible chart point')
    const end = element('input', 'sqd-range')
    end.type = 'range'
    end.min = '0'
    end.max = String(allRows.length - 1)
    end.value = String(rangeEnd)
    end.setAttribute('aria-label', 'Last visible chart point')
    const focus = element('button', 'sqd-button', 'Focus range')
    focus.type = 'button'
    focus.addEventListener('click', () => {
      const nextStart = Math.min(Number(start.value), Number(end.value))
      const nextEnd = Math.max(Number(start.value), Number(end.value))
      panelChartDisposers.get(root)?.()
      root.replaceWith(chartPanel(payload, { ...panel, __range_start: nextStart, __range_end: nextEnd }))
    })
    const reset = element('button', 'sqd-button', 'Reset range')
    reset.type = 'button'
    reset.disabled = rangeStart === 0 && rangeEnd === allRows.length - 1
    reset.addEventListener('click', () => {
      panelChartDisposers.get(root)?.()
      root.replaceWith(chartPanel(payload, { ...panel, __range_start: 0, __range_end: allRows.length - 1 }))
    })
    rangeTools.append(rangeCopy, start, end, focus, reset)
    rangeControls = rangeTools
  }
  if (chart.kind === 'candlestick') {
    const terminal = buildCandleTerminal(
      root,
      chart,
      rows,
      text(panel.title ?? chart.title ?? 'Blockchain activity chart'),
    )
    if (!terminal) {
      wrap.append(element('div', 'sqd-chart-empty', 'The result did not include numeric candle values.'))
      body.append(wrap)
      return root
    }
    wrap.append(terminal)
    body.append(wrap)
    if (rangeControls) body.append(rangeControls)
    const declaredCandles = Number(chart.total_points ?? chart.total_candles)
    const candleNotice = Number.isFinite(declaredCandles)
      ? displayLimitNotice('chart points', rows.length, rows.length, declaredCandles)
      : null
    if (candleNotice) body.append(candleNotice)
    return root
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'sqd-chart')
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`)
  svg.style.aspectRatio = `${CHART_WIDTH} / ${CHART_HEIGHT}`
  svg.setAttribute('role', 'group')
  const chartTitle = text(panel.title ?? chart.title ?? 'Blockchain activity chart')
  const plotW = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right
  const plotRight = CHART_WIDTH - CHART_PAD.right
  const tickX = plotRight + 8
  const add = (tag: string, attrs: Record<string, string>): SVGElement => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
    svg.append(node)
    return node
  }
  const addAxisTitle = (label: string, midY: number) => {
    if (!label || !geometry.axisTitles) return
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('transform', `translate(11, ${midY}) rotate(-90)`)
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    node.setAttribute('class', 'sqd-chart-axis-title')
    node.setAttribute('text-anchor', 'middle')
    node.textContent = label
    group.append(node)
    svg.append(group)
  }
  const addXLabels = (labels: string[], y: number) => {
    if (!labels.length) return
    const first = add('text', { x: String(CHART_PAD.left), y: String(y), class: 'sqd-chart-label' })
    first.textContent = labels[0]
    if (labels.length > 2 && labels[1]) {
      const middle = add('text', {
        x: String(CHART_PAD.left + plotW / 2),
        y: String(y),
        'text-anchor': 'middle',
        class: 'sqd-chart-label',
      })
      middle.textContent = labels[1]
    }
    if (labels.length > 1 && labels.at(-1) && labels.at(-1) !== labels[0]) {
      const last = add('text', { x: String(plotRight), y: String(y), 'text-anchor': 'end', class: 'sqd-chart-label' })
      last.textContent = labels.at(-1)!
    }
  }
  const rowTimeLabel = (row: Record<string, unknown> | undefined) =>
    row ? shortTimeLabel(text(row.timestamp_human ?? row.timestamp ?? row.bucket_index ?? '')) : ''

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

  {
    const normalized = normalizeSeries(rows, chart)
    const values = normalized.points.flatMap((point) => point.values).filter((value): value is number => value !== null)
    if (!values.length || !normalized.series.length) {
      wrap.append(element('div', 'sqd-chart-empty', 'The result did not include numeric chart values.'))
      body.append(wrap)
      return root
    }
    const plotH = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom
    const plotBottom = CHART_PAD.top + plotH
    const stacked = chart.recommended_visual === 'stacked_area' && normalized.series.length > 1
    const stackTotals = normalized.points.map((point) =>
      point.values.reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0),
    )
    const isBar = chart.recommended_visual === 'bar'
    const rawMin = isBar ? Math.min(0, ...values) : stacked ? 0 : Math.min(...values)
    const rawMax = isBar ? Math.max(0, ...values) : stacked ? Math.max(...stackTotals) : Math.max(...values)
    const scale = bandScale(rawMin, rawMax, isBar || stacked)
    const { domainMin, domainMax } = scale
    const range = domainMax - domainMin
    const y = (value: number) => CHART_PAD.top + (1 - (value - domainMin) / range) * plotH
    const xField = text(chart.x_field || 'timestamp')
    const optionalXValues = normalized.points.map((point) => numeric(getByPath(point.row, xField)))
    const xValues = optionalXValues.every((value) => value !== undefined) ? (optionalXValues as number[]) : undefined
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
    const lastPointValue = normalized.points.at(-1)?.values[0] ?? null
    const showPill = !isBar && !stacked && normalized.series.length === 1 && lastPointValue !== null
    const finalValue = showPill ? lastPointValue : undefined
    const pillY = finalValue === undefined ? undefined : y(finalValue)
    for (const tick of scale.ticks) {
      const gy = y(tick)
      add('line', {
        x1: String(CHART_PAD.left),
        x2: String(plotRight),
        y1: String(gy),
        y2: String(gy),
        class: 'sqd-chart-grid',
      })
      if (pillY !== undefined && Math.abs(gy - pillY) < 17) continue
      const label = add('text', { x: String(tickX), y: String(gy + 4), class: 'sqd-chart-label' })
      label.textContent = tickText(tick, text(chart.value_format), tick === scale.ticks.at(-1))
    }
    for (let quarter = 1; quarter <= 3; quarter += 1) {
      const gx = CHART_PAD.left + (plotW * quarter) / 4
      add('line', {
        x1: String(gx),
        x2: String(gx),
        y1: String(CHART_PAD.top),
        y2: String(plotBottom),
        class: 'sqd-chart-grid',
      })
    }
    add('line', {
      x1: String(CHART_PAD.left),
      x2: String(plotRight),
      y1: String(plotBottom),
      y2: String(plotBottom),
      class: 'sqd-chart-axis',
    })
    const hasNegative = values.some((value) => value < 0)
    if (isBar && hasNegative && domainMin < 0 && domainMax > 0) {
      add('line', {
        x1: String(CHART_PAD.left),
        x2: String(plotRight),
        y1: String(y(0)),
        y2: String(y(0)),
        class: 'sqd-chart-zero',
      })
    }

    const seriesNodes = new Map<number, SVGElement[]>()
    const visibleSeries = new Set(normalized.series.map((_series, index) => index))
    const pointHits: Array<{ node: SVGElement; point: ChartPoint; timeLabel: string; cx: number }> = []
    const valuesForPoint = (point: ChartPoint) =>
      normalized.series.flatMap((series, seriesIndex) => {
        if (!visibleSeries.has(seriesIndex)) return []
        const value = point.values[seriesIndex]
        return [
          `${series.label} ${value === null ? 'not available' : formatValue(value, text(chart.value_format), text(chart.unit))}`,
        ]
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
      const singleSigned = normalized.series.length === 1 && hasNegative
      const groupWidth = plotW / Math.max(normalized.points.length, 1)
      const barWidth = Math.max(2, Math.min(22, (groupWidth * 0.72) / normalized.series.length))
      normalized.points.forEach((point, pointIndex) => {
        point.values.forEach((value, seriesIndex) => {
          if (value === null) return
          const offset = (seriesIndex - (normalized.series.length - 1) / 2) * barWidth
          const baseline = y(0)
          const valueY = y(value)
          const polarity = singleSigned ? (value >= 0 ? ' sqd-chart-bar--up' : ' sqd-chart-bar--down') : ''
          const bar = add('rect', {
            x: String(x(pointIndex) + offset - barWidth / 2),
            y: String(Math.min(valueY, baseline)),
            width: String(Math.max(1, barWidth - 1)),
            height: String(Math.max(1, Math.abs(baseline - valueY))),
            rx: '1.5',
            class: `sqd-chart-bar${polarity}`,
            ...(singleSigned ? {} : { fill: normalized.series[seriesIndex].color }),
            'data-value': String(value),
          })
          trackSeriesNode(seriesIndex, bar)
        })
      })
    } else if (stacked) {
      const bottoms = new Array(normalized.points.length).fill(0) as number[]
      normalized.series.forEach((series, seriesIndex) => {
        const topValues = normalized.points.map(
          (point, index) => bottoms[index] + Math.max(0, point.values[seriesIndex] ?? 0),
        )
        const top = topValues.map((value, index) => `${x(index)},${y(value)}`).join(' ')
        const bottom = bottoms
          .map((value, index) => `${x(index)},${y(value)}`)
          .reverse()
          .join(' ')
        const area = add('polygon', {
          points: `${top} ${bottom}`,
          class: 'sqd-chart-series-area',
          fill: series.color,
          'data-series-total': String(
            normalized.points.reduce((sum, point) => sum + (point.values[seriesIndex] ?? 0), 0),
          ),
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
          if (normalized.series.length === 1 && points.length > 1 && domainMin === 0) {
            const baseline = y(0)
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
      const timeLabel = text(
        point.row.timestamp_human ?? point.row.timestamp ?? point.row.bucket_index ?? `Point ${index + 1}`,
      )
      const cx = x(index)
      const hit = add('rect', {
        x: String(Math.max(CHART_PAD.left, cx - plotW / Math.max(normalized.points.length, 1) / 2)),
        y: String(CHART_PAD.top),
        width: String(Math.max(6, plotW / Math.max(normalized.points.length, 1))),
        height: String(plotH),
        class: 'sqd-chart-hit',
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
      bindPointSelection(hit, point.row)
    })
    updatePointLabels()

    if (finalValue !== undefined && pillY !== undefined) {
      const finalLine = add('line', {
        x1: String(CHART_PAD.left),
        x2: String(plotRight),
        y1: String(pillY),
        y2: String(pillY),
        class: 'sqd-chart-last-line',
      })
      trackSeriesNode(0, finalLine)
      const finalText =
        Math.abs(finalValue) >= 1000 ? pillCompact(finalValue) : tickText(finalValue, text(chart.value_format))
      const pillWidth = Math.max(34, finalText.length * 7 + 14)
      const finalPill = add('rect', {
        x: String(plotRight + 4),
        y: String(pillY - 11),
        width: String(pillWidth),
        height: '22',
        rx: '5',
        class: 'sqd-chart-last-pill',
      })
      trackSeriesNode(0, finalPill)
      const finalLabel = add('text', {
        x: String(plotRight + 4 + pillWidth / 2),
        y: String(pillY + 4),
        'text-anchor': 'middle',
        class: 'sqd-chart-last-value',
        'data-final-value': String(finalValue),
      })
      trackSeriesNode(0, finalLabel)
      finalLabel.textContent = finalText
    }
    addAxisTitle(
      text(chart.y_axis_label ?? (normalized.series.length === 1 ? normalized.series[0].label : chart.unit)),
      CHART_PAD.top + plotH / 2,
    )
    addXLabels(
      [
        rowTimeLabel(normalized.points[0]?.row),
        rowTimeLabel(normalized.points[Math.floor((normalized.points.length - 1) / 2)]?.row),
        rowTimeLabel(normalized.points.at(-1)?.row),
      ],
      CHART_HEIGHT - 8,
    )
    svg.setAttribute(
      'aria-label',
      `${chartTitle}. ${normalized.points.length} data points across ${normalized.series.length} series.`,
    )
  }

  wrap.append(svg)
  wrap.append(tooltip)
  body.append(wrap)
  if (rangeControls) body.append(rangeControls)
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
  const columns: Column[] = keys.slice(0, 9).map((key) => ({
    key,
    label: key === 'timestamp_human' ? 'Time' : humanize(key),
    align: typeof rows[0]?.[key] === 'number' ? 'right' : 'left',
    format: /address|hash|sender|recipient|^from$|^to$/.test(key)
      ? 'address'
      : /timestamp$/.test(key)
        ? 'timestamp'
        : typeof rows[0]?.[key] === 'number'
          ? 'decimal'
          : undefined,
  }))
  const nestedNumericField = Object.keys(rows[0] ?? {}).find((key) => {
    const value = rows[0]?.[key]
    return isRecord(value) && Object.values(value).some((entry) => typeof entry === 'number')
  })
  if (nestedNumericField && isRecord(rows[0]?.[nestedNumericField])) {
    for (const sub of Object.keys(rows[0][nestedNumericField] as Record<string, unknown>).slice(0, 4)) {
      columns.push({
        key: `${nestedNumericField}.${sub}`,
        path: `${nestedNumericField}.${sub}`,
        label: humanize(sub),
        align: 'right',
        format: 'decimal',
      })
    }
  }
  return columns.slice(0, 9)
}

function showDetails(title: string, value: unknown, note?: string) {
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
  if (note) body.append(element('p', 'sqd-dialog-meta', note))
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
    panel.emphasis === 'primary' ? 'sqd-card--primary' : '',
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
  let pageIndex = 0
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
        header.setAttribute(
          'aria-sort',
          key === sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none',
        ),
      )
      pageIndex = 0
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
  const pagination = element('nav', 'sqd-table-pagination')
  pagination.setAttribute('aria-label', `${text(panel.title ?? 'Evidence')} table pages`)
  const previous = element('button', 'sqd-button', 'Previous rows')
  previous.type = 'button'
  const pageStatus = element('span', 'sqd-brand-subtitle')
  pageStatus.setAttribute('aria-live', 'polite')
  const next = element('button', 'sqd-button', 'Next rows')
  next.type = 'button'
  pagination.append(previous, pageStatus, next)
  body.append(pagination)

  function computeMatches(): Record<string, unknown>[] {
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
    return matches
  }

  ;(wrap as EvidencePager).__sqdShowEvidence = (identity: string) => {
    const position = computeMatches().findIndex((row) => evidenceIdentity(row) === identity)
    if (position < 0) return
    const targetPage = Math.floor(position / TABLE_PAGE_SIZE)
    if (targetPage !== pageIndex) {
      pageIndex = targetPage
      renderBody()
    }
  }

  function renderBody() {
    const matches = computeMatches()
    const totalPages = Math.max(1, Math.ceil(matches.length / TABLE_PAGE_SIZE))
    pageIndex = Math.min(pageIndex, totalPages - 1)
    const pageStart = pageIndex * TABLE_PAGE_SIZE
    const visible = matches.slice(pageStart, pageStart + TABLE_PAGE_SIZE)
    count.textContent = `${matches.length} matching row${matches.length === 1 ? '' : 's'}`
    pageStatus.textContent = `Page ${pageIndex + 1} of ${totalPages}`
    previous.disabled = pageIndex === 0
    next.disabled = pageIndex >= totalPages - 1
    pagination.hidden = matches.length <= TABLE_PAGE_SIZE
    tbody.replaceChildren()
    for (const [index, row] of visible.entries()) {
      const tr = element('tr')
      tr.dataset.evidenceKey = evidenceIdentity(row)
      tr.dataset.selected = 'false'
      for (const [columnIndex, column] of effectiveColumns.entries()) {
        const td = element('td')
        td.dataset.align = column.align ?? 'left'
        const rawValue = getByPath(row, column.path ?? column.key)
        const formatted = formatValue(rawValue, column.format, column.unit)
        if (isIdentifierColumn(column, rawValue)) td.classList.add('sqd-hash')
        if (column.format === 'signed' || /^(direction|change|net)/.test(column.key)) {
          const signedValue = numeric(rawValue)
          if (signedValue !== undefined && signedValue !== 0) {
            td.dataset.signed = signedValue > 0 ? 'positive' : 'negative'
          }
        }
        if (columnIndex === 0) {
          const button = element('button', 'sqd-row-button', formatted)
          button.type = 'button'
          button.title = 'Open exact row'
          button.addEventListener('click', () => showDetails(`Evidence row ${pageStart + index + 1}`, row))
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
    pageIndex = 0
    renderBody()
  })
  previous.addEventListener('click', () => {
    pageIndex = Math.max(0, pageIndex - 1)
    renderBody()
  })
  next.addEventListener('click', () => {
    pageIndex += 1
    renderBody()
  })
  renderBody()
  const declaredRows = Number(descriptor.row_count)
  const totalRows = Number.isFinite(declaredRows) ? Math.max(rows.length, declaredRows) : rows.length
  const limitNotice = displayLimitNotice(
    'evidence rows',
    Math.min(rows.length, TABLE_PAGE_SIZE),
    rows.length,
    totalRows,
  )
  if (limitNotice) body.append(limitNotice)
  return root
}

function timelinePanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
  const sourceRows = numberRows(payload, panel)
  const rows = sourceRows.slice(0, MAX_TIMELINE_ROWS)
  const { root, body } = card(text(panel.title ?? 'Activity timeline'), text(panel.subtitle))
  const timeline = element('div', 'sqd-timeline')
  const valueKey = text(panel.value_key)
  const directionKey = text(panel.direction_key)
  for (const row of rows) {
    const event = element('article', 'sqd-event')
    event.append(element('time', 'sqd-event-time', text(getByPath(row, text(panel.timestamp_key)))))
    const direction = directionKey ? text(getByPath(row, directionKey)).toLowerCase() : ''
    const dotTone = direction === 'in' ? ' sqd-event-dot--in' : direction === 'out' ? ' sqd-event-dot--out' : ''
    event.append(element('span', `sqd-event-dot${dotTone}`))
    const copy = element('div')
    copy.append(element('div', 'sqd-event-title', text(getByPath(row, text(panel.title_key)) ?? 'Activity')))
    const subtitleParts = asArray(panel.subtitle_keys)
      .map((key) => text(getByPath(row, text(key))))
      .filter(Boolean)
    const joiner = directionKey && subtitleParts.length === 2 ? ' → ' : ' · '
    if (subtitleParts.length) {
      const subtitleNode = element('div', 'sqd-event-subtitle', subtitleParts.map(shortIdentifier).join(joiner))
      subtitleNode.title = subtitleParts.join(joiner)
      copy.append(subtitleNode)
    }
    event.append(copy)
    if (valueKey) {
      const rawValue = getByPath(row, valueKey)
      const amount = numeric(rawValue)
      if (amount !== undefined) {
        const tone = direction === 'in' ? 'in' : direction === 'out' ? 'out' : 'flat'
        const sign = direction === 'in' ? '+' : direction === 'out' ? '-' : ''
        event.append(
          element(
            'span',
            `sqd-event-value sqd-event-value--${tone}`,
            `${sign}${formatValue(amount, text(panel.value_format), text(panel.unit))}`,
          ),
        )
      }
    }
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
    const rawLabel = text(getByPath(row, text(panel.category_key)) ?? 'Unknown')
    const label = element(
      'div',
      `sqd-ranked-label${isHexIdentifier(rawLabel) ? ' sqd-ranked-label--id' : ''}`,
      shortIdentifier(rawLabel),
    )
    label.title = rawLabel
    item.append(label)
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
  const tableKeys = new Set(
    specs
      .filter((panel) => text(panel.kind) === 'table_panel')
      .map((panel) => {
        const descriptor = tableDescriptor(payload, text(panel.table_id))
        return text(descriptor?.data_key ?? panel.data_key)
      })
      .filter(Boolean),
  )
  const chartKeys = specs
    .filter((panel) => text(panel.kind) === 'chart_panel')
    .map((panel) => getByPath(payload, text(panel.chart_key)))
    .filter(isRecord)
    .map((chart) => text(chart.data_key))
    .filter(Boolean)
  for (const dataKey of new Set(chartKeys)) {
    if (!tableKeys.has(dataKey) && asArray(getByPath(payload, dataKey)).some(isRecord)) {
      grid.append(tablePanel(payload, { title: `Exact ${humanize(dataKey)} evidence`, data_key: dataKey }))
      tableKeys.add(dataKey)
    }
  }
  if (!specs.length) {
    const contract = isRecord(payload._tool_contract) ? payload._tool_contract : {}
    if (contract.name === 'portal_evm_get_contract_activity') {
      grid.append(
        rankedPanel(payload, {
          title: 'Top callers',
          subtitle: 'Caller frequency inside the exact analyzed window.',
          data_key: 'interactions.top_callers',
          category_key: 'address',
          value_key: 'interaction_count',
          value_format: 'integer',
          emphasis: 'primary',
        }),
      )
      if (isRecord(getByPath(payload, 'events.events_by_type'))) {
        grid.append(
          rankedPanel(payload, {
            title: 'Top event types',
            subtitle: 'Observed event signatures ranked by count.',
            data_key: 'events.events_by_type',
            object_map: true,
            category_key: 'event',
            value_key: 'count',
            value_format: 'integer',
          }),
        )
      }
    } else {
      const inferred = inferredPanel(payload)
      if (inferred) grid.append(inferred)
    }
  }
  if (grid.childElementCount === 1) grid.classList.add('sqd-grid--single')
  return grid.childElementCount ? grid : null
}

function notices(payload: Record<string, unknown>): HTMLElement | null {
  const values = [payload._notice, ...asArray(payload._notices)].map(text).filter(Boolean)
  const error = isRecord(payload.error) ? payload.error : undefined
  const entries: Array<{ copy: string; tone: string }> = values.map((copy) => ({ copy, tone: '' }))
  if (error) {
    const suggestions = asArray(error.suggestions).map(text).filter(Boolean)
    const retryable = error.retryable === true ? 'This request is safe to retry.' : ''
    const guidance = [retryable, ...suggestions].filter(Boolean).join(' · ')
    if (guidance) entries.unshift({ copy: guidance, tone: 'danger' })
  }
  if (!entries.length) return null
  const wrap = element('section', 'sqd-notices')
  wrap.setAttribute('aria-label', 'Important result notices')
  entries
    .slice(0, 6)
    .forEach((entry) =>
      wrap.append(element('div', `sqd-notice${entry.tone ? ` sqd-notice--${entry.tone}` : ''}`, entry.copy)),
    )
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
  const bar = element('div', 'sqd-actions sqd-followups')
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
        'Explore wallets, contracts, token flows, network activity, Bitcoin, Solana, Polkadot, Hyperliquid, and other queryable blockchain datasets. Tron discovery, freshness, and timestamps remain available through SQD metadata tools.',
    ),
  )
  empty.append(copy)
  return empty
}

export function renderExplorer(root: HTMLElement, state: ExplorerState, actions: ExplorerActions) {
  disposeActiveCharts()
  injectStyle()
  root.className = 'sqd-app'
  root.replaceChildren()
  const shell = element('main', 'sqd-shell')
  shell.append(appHeader(actions, state))
  if (state.loading && !state.payload) shell.append(loadingState())
  else if (!state.payload) shell.append(emptyState(state.error))
  else {
    const payload = state.payload
    const ui = isRecord(payload._ui) ? payload._ui : {}
    const marketTerminal = text(ui.design_intent) === 'market_terminal'
    shell.append(masthead(payload))
    const resultNotices = notices(payload)
    if (resultNotices) shell.append(resultNotices)
    const metrics = metricCards(payload)
    if (metrics && !marketTerminal) shell.append(metrics)
    const views = panels(payload)
    if (views) shell.append(views)
    if (metrics && marketTerminal) shell.append(metrics)
    const next = followups(payload, actions)
    if (next) shell.append(next)
    const receipt = evidenceReceipt(payload, actions)
    if (receipt) shell.append(receipt)
    shell.append(raw(payload))
  }
  const footer = element('footer', 'sqd-footer')
  footer.append(element('span', undefined, 'Read-only evidence from SQD Portal'))
  const attribution = element('a', undefined, 'Charts by TradingView') as HTMLAnchorElement
  attribution.href = 'https://www.tradingview.com/'
  attribution.target = '_blank'
  attribution.rel = 'noopener noreferrer'
  footer.append(attribution)
  footer.append(element('span', undefined, 'portal.sqd.dev'))
  shell.append(footer)
  root.append(shell)
}
