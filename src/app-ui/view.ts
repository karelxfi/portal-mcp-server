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
const CHART_WIDTH = 900
const CHART_HEIGHT = 260
const CHART_PAD = { left: 52, right: 18, top: 16, bottom: 32 }

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

function formatValue(value: unknown, format?: string, unit?: string): string {
  if (value === null || value === undefined || value === '') return 'Not available'
  if (typeof value === 'string' && format !== 'timestamp') {
    if (format === 'address' && value.length > 18) return `${value.slice(0, 8)}…${value.slice(-6)}`
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
    '<svg viewBox="0 0 24 24" fill="none"><path d="M5 6.5h14M5 11h14M5 15.5h8.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M16.5 15.5H19v2.7h-2.5z" fill="#ff5c35"/></svg>'
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
  const partial =
    coverage.result_complete === false ||
    coverage.window_complete === false ||
    coverage.sampled === true ||
    pagination.has_more === true
  return partial
    ? { label: 'Partial result', tone: 'warning', partial }
    : { label: 'Evidence ready', tone: '', partial }
}

function badges(payload: Record<string, unknown>, partial: boolean): HTMLElement {
  const row = element('div', 'sqd-badges')
  const meta = isRecord(payload._meta) ? payload._meta : {}
  const freshness = isRecord(payload._freshness) ? payload._freshness : {}
  const coverage = isRecord(payload._coverage) ? payload._coverage : {}
  const candidates: [string, unknown, string?][] = [
    ['Network', meta.network ?? meta.dataset ?? payload.network],
    ['Window', coverage.requested_window ?? coverage.window ?? meta.timeframe],
    ['Rows', meta.row_count ?? meta.result_count ?? (asArray(payload.items).length || undefined)],
    ['Finality', freshness.finality ?? freshness.kind],
  ]
  for (const [label, value, tone] of candidates) {
    if (value === undefined || value === null || value === '' || isRecord(value) || Array.isArray(value)) continue
    row.append(element('span', `sqd-badge${tone ? ` sqd-badge--${tone}` : ''}`, `${label}: ${text(value)}`))
  }
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

function numberRows(payload: Record<string, unknown>, descriptor: Record<string, unknown>): Record<string, unknown>[] {
  return asArray(getByPath(payload, text(descriptor.data_key))).filter(isRecord)
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
  const rows = numberRows(payload, chart)
  if (!rows.length) {
    wrap.append(element('div', 'sqd-chart-empty', 'No chart points were returned for this window.'))
    body.append(wrap)
    return root
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'sqd-chart')
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`)
  svg.setAttribute('role', 'img')
  svg.setAttribute(
    'aria-label',
    `${text(panel.title ?? chart.title ?? 'Blockchain activity chart')}. ${rows.length} data points.`,
  )
  const plotW = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right
  const plotH = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom
  const add = (tag: string, attrs: Record<string, string>) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
    svg.append(node)
    return node
  }
  const values =
    chart.kind === 'candlestick'
      ? rows.flatMap((row) => [Number(row.low), Number(row.high)]).filter(Number.isFinite)
      : rows.map((row) => Number(row[text(chart.y_field || 'value')])).filter(Number.isFinite)
  if (!values.length) {
    wrap.append(element('div', 'sqd-chart-empty', 'The result did not include numeric chart values.'))
    body.append(wrap)
    return root
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, Math.abs(max) * 0.02, 1)
  const y = (value: number) => CHART_PAD.top + (1 - (value - min) / range) * plotH
  const x = (index: number) => CHART_PAD.left + (rows.length === 1 ? plotW / 2 : (index / (rows.length - 1)) * plotW)
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
      x: String(CHART_PAD.left - 8),
      y: String(gy + 3),
      'text-anchor': 'end',
      class: 'sqd-chart-label',
    })
    label.textContent = compact(max - (range * i) / 4)
  }
  if (chart.kind === 'candlestick') {
    const candleWidth = Math.max(3, Math.min(13, (plotW / Math.max(rows.length, 1)) * 0.58))
    rows.forEach((row, index) => {
      const open = Number(row.open)
      const high = Number(row.high)
      const low = Number(row.low)
      const close = Number(row.close)
      if (![open, high, low, close].every(Number.isFinite)) return
      const cx = x(index)
      const top = Math.min(y(open), y(close))
      const height = Math.max(1.5, Math.abs(y(close) - y(open)))
      add('line', { x1: String(cx), x2: String(cx), y1: String(y(high)), y2: String(y(low)), class: 'sqd-chart-wick' })
      add('rect', {
        x: String(cx - candleWidth / 2),
        y: String(top),
        width: String(candleWidth),
        height: String(height),
        rx: '1',
        class: close >= open ? 'sqd-chart-up' : 'sqd-chart-down',
      })
    })
  } else if (chart.recommended_visual === 'bar') {
    const barWidth = Math.max(2, Math.min(24, (plotW / rows.length) * 0.68))
    rows.forEach((row, index) => {
      const value = Number(row[text(chart.y_field || 'value')])
      if (!Number.isFinite(value)) return
      add('rect', {
        x: String(x(index) - barWidth / 2),
        y: String(y(value)),
        width: String(barWidth),
        height: String(Math.max(1, CHART_PAD.top + plotH - y(value))),
        rx: '2',
        class: 'sqd-chart-bar',
      })
    })
  } else {
    const points = rows
      .map((row, index) => ({ x: x(index), y: y(Number(row[text(chart.y_field || 'value')])) }))
      .filter((point) => Number.isFinite(point.y))
    const line = points.map((point) => `${point.x},${point.y}`).join(' ')
    const baseline = CHART_PAD.top + plotH
    add('polygon', {
      points: `${CHART_PAD.left},${baseline} ${line} ${CHART_WIDTH - CHART_PAD.right},${baseline}`,
      class: 'sqd-chart-area',
    })
    add('polyline', { points: line, class: 'sqd-chart-line' })
  }
  const firstLabel = text(rows[0]?.timestamp_human ?? rows[0]?.timestamp ?? 'Start')
  const lastLabel = text(rows.at(-1)?.timestamp_human ?? rows.at(-1)?.timestamp ?? 'End')
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
  body.append(wrap)
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
  head.append(element('h2', 'sqd-dialog-title', title))
  const close = element('button', 'sqd-button', 'Close')
  close.type = 'button'
  close.addEventListener('click', () => dialog?.close())
  head.append(close)
  dialog.append(head)
  const body = element('div', 'sqd-dialog-body')
  const pre = element('pre')
  pre.textContent = JSON.stringify(value, null, 2)
  body.append(pre)
  dialog.append(body)
  dialog.showModal()
  close.focus()
}

function tablePanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
  const descriptor = tableDescriptor(payload, text(panel.table_id)) ?? {}
  const rows = asArray(getByPath(payload, text(descriptor.data_key ?? panel.data_key ?? 'items')))
    .filter(isRecord)
    .slice(0, MAX_TABLE_ROWS)
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
  search.placeholder = 'Filter visible evidence'
  search.setAttribute('aria-label', `Filter ${text(panel.title ?? 'evidence')} rows`)
  tools.append(search)
  tools.append(element('span', 'sqd-brand-subtitle', `${rows.length} row${rows.length === 1 ? '' : 's'}`))
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
  for (const column of effectiveColumns) {
    const th = element('th')
    th.dataset.align = column.align ?? 'left'
    const button = element('button', 'sqd-sort', text(column.label ?? humanize(column.key)))
    button.type = 'button'
    button.addEventListener('click', () => {
      sortDirection = sortKey === column.key && sortDirection === 'asc' ? 'desc' : 'asc'
      sortKey = column.key
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
    const visible = rows.filter((row) => !filter || JSON.stringify(row).toLowerCase().includes(filter))
    if (sortKey)
      visible.sort(
        (a, b) =>
          text(getByPath(a, effectiveColumns.find((column) => column.key === sortKey)?.path ?? sortKey)).localeCompare(
            text(getByPath(b, effectiveColumns.find((column) => column.key === sortKey)?.path ?? sortKey)),
            undefined,
            { numeric: true },
          ) * (sortDirection === 'asc' ? 1 : -1),
      )
    tbody.replaceChildren()
    for (const [index, row] of visible.entries()) {
      const tr = element('tr')
      for (const [columnIndex, column] of effectiveColumns.entries()) {
        const td = element('td')
        td.dataset.align = column.align ?? 'left'
        const formatted = formatValue(getByPath(row, column.path ?? column.key), column.format, column.unit)
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
  return root
}

function timelinePanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
  const rows = numberRows(payload, panel).slice(0, 40)
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
  return root
}

function rankedPanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
  const rows = numberRows(payload, panel).slice(0, 16)
  const values = rows.map((row) => Number(getByPath(row, text(panel.value_key)))).filter(Number.isFinite)
  const max = Math.max(...values, 1)
  const { root, body } = card(
    text(panel.title ?? 'Ranked activity'),
    text(panel.subtitle),
    panel.emphasis === 'primary' ? 'sqd-card--primary' : '',
  )
  const ranked = element('div', 'sqd-ranked')
  for (const row of rows) {
    const value = Number(getByPath(row, text(panel.value_key)))
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
  return root
}

function statPanel(payload: Record<string, unknown>, panel: Panel): HTMLElement {
  const rows = numberRows(payload, panel).slice(0, 30)
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
  const grid = element('section', 'sqd-grid')
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
      ['continue', 'compare_previous', 'drilldown', 'zoom_in'].includes(text(action.intent)),
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
