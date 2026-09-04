import { explorerLink, identifierKind } from './explorers.js'
import { ACTIVITY_EXPLORER_CSS } from './styles.js'

export type ExplorerState = {
  payload: Record<string, unknown> | null
  rawText: string
  loading: boolean
  error: string
  currentArgs: Record<string, unknown>
  displayMode?: string
  availableDisplayModes?: string[]
  historyIndex?: number
  historyLength?: number
}

/** What the reader currently has in view on a chart, for the model context. */
export type ChartView = {
  chart: string
  shown: number
  total: number
  firstLabel: string
  lastLabel: string
}

export type ExplorerActions = {
  runFollowup: (intent: string, target?: string, action?: Record<string, unknown>) => void
  reportChartView?: (view: ChartView) => void
  reportSelection?: (selection: string | null) => void
  requestFullscreen?: () => void
  requestInline?: () => void
  goBack?: () => void
  goForward?: () => void
  exportEvidence?: (format: 'json' | 'csv') => void
  openLink?: (url: string) => void
}

export type DisplayMode = 'inline' | 'fullscreen'

export function displayModeOf(state: ExplorerState): DisplayMode {
  return state.displayMode === 'fullscreen' ? 'fullscreen' : 'inline'
}

export type Column = {
  key: string
  path?: string
  label?: string
  format?: string
  unit?: string
  align?: string
}

export type Panel = Record<string, unknown>

const ROOT_STYLE_ID = 'sqd-activity-explorer-style'

export const TABLE_PAGE_SIZE = 10

export const INLINE_TABLE_ROWS = 5

export const MAX_TIMELINE_ROWS = 40

export const MAX_INLINE_TIMELINE_ROWS = 6

export const MAX_RANKED_ROWS = 10

export const MAX_INLINE_RANKED_ROWS = 6

export const MAX_STAT_ROWS = 30

export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

/* Canvas charts need literal colors. They are resolved from the live CSS
   tokens at build time, so the terminal follows the host theme (light or
   dark, Claude's variables or SQD's fallbacks) exactly like the DOM does. */
export function resolveColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const probe = document.createElement('span')
  probe.style.color = `var(${token})`
  probe.style.display = 'none'
  document.body.append(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value || fallback
}

export function withAlpha(color: string, alpha: number): string {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color)
  if (!match) return color
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`
}

export function terminalColors() {
  const up = resolveColor('--up', '#0891b2')
  const down = resolveColor('--down', '#d97706')
  const fg = resolveColor('--fg', '#f7f8f8')
  return {
    up,
    down,
    upSoft: withAlpha(up, 0.4),
    downSoft: withAlpha(down, 0.4),
    accent: resolveColor('--accent', '#818cf8'),
    accentLine: withAlpha(resolveColor('--accent', '#818cf8'), 0.45),
    /* Axis ticks read in the muted whisper ink (chart-palette axis_label),
       matching the SVG chart labels so the canvas and SVG grammars agree. */
    ink: resolveColor('--fg-muted', '#9898a1'),
    grid: withAlpha(fg, 0.055),
    axis: withAlpha(fg, 0.14),
    crosshair: withAlpha(fg, 0.24),
    crosshairLabel: resolveColor('--surface-elevated', '#1a1a1e'),
  }
}

export const TERMINAL_MONO = "'JetBrains Mono SQD', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

/* Narrow hosts have no room beside the plot for a rotated axis title, and the
   series label is already in the legend or the card title. */
export let appRoot: HTMLElement | null = null

/** Set once per render; `axisTitlesFit` is the only reader. */
export function setAppRoot(root: HTMLElement) {
  appRoot = root
}

export function axisTitlesFit(): boolean {
  const width = appRoot?.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 900)
  return width > 520
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function getByPath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)
}

export function text(value: unknown): string {
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

export function pillCompact(value: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 })
    .format(value)
    .replace(/K/g, 'k')
}

export function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const NUMERIC_FORMATS = new Set([
  'integer',
  'compact_number',
  'percent',
  'currency_usd',
  'gwei',
  'bytes',
  'btc',
  'decimal',
  'timestamp',
])

/* An exact decimal string keeps every digit when a double would drop some
   (more than 15 significant digits) or when the readable summary would round
   its fraction away (more than four fraction digits): the integer part is
   grouped, the fraction stays as Portal sent it. Compact and currency
   summaries are approximations by contract and keep Number(). */
const EXACT_STRING_FORMATS = new Set(['integer', 'percent', 'gwei', 'btc', 'decimal'])

const FORMAT_SUFFIX: Record<string, string> = { percent: '%', gwei: ' gwei', btc: ' BTC' }

function groupExactDecimal(value: string): string | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) return undefined
  const [, sign, integer, fraction = ''] = match
  const significant = `${integer}${fraction}`.replace(/^0+/, '').length
  if (significant <= 15 && fraction.length <= 4) return undefined
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`
}

export function formatValue(value: unknown, format?: string, unit?: string): string {
  if (value === null || value === undefined || value === '') return 'Not available'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  /* Portal sends large decimals as strings to stay exact; a declared numeric
     format is the tool asking for a readable summary of that number. */
  if (typeof value === 'string' && !(format && NUMERIC_FORMATS.has(format) && Number.isFinite(Number(value)))) {
    return unit && !value.toLowerCase().includes(unit.toLowerCase()) ? `${value} ${unit}` : value
  }
  if (typeof value === 'string' && format && EXACT_STRING_FORMATS.has(format)) {
    const exact = groupExactDecimal(value.trim())
    if (exact) {
      const withSuffix = `${exact}${FORMAT_SUFFIX[format] ?? ''}`
      return unit && !withSuffix.toLowerCase().includes(unit.toLowerCase()) ? `${withSuffix} ${unit}` : withSuffix
    }
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
    case 'percent': {
      const percent = Object.is(numberValue, -0) ? 0 : numberValue
      const digits = percent !== 0 && Math.abs(percent) < 0.01 ? 4 : 2
      formatted = `${Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(percent)}%`
      break
    }
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
      formatted = `${new Date(numberValue * (numberValue > 1e12 ? 1 : 1000)).toISOString().slice(0, 19).replace('T', ' ')} UTC`
      break
    default:
      /* Six significant digits without exponent notation, so 9e-9 reads as
         0.000000009. */
      formatted =
        numberValue !== 0 && Math.abs(numberValue) < 1
          ? Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(numberValue)
          : Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(numberValue)
  }
  return unit && !formatted.toLowerCase().includes(unit.toLowerCase()) ? `${formatted} ${unit}` : formatted
}

export function humanize(value: string): string {
  return value
    .replace(/^_+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function isHexIdentifier(value: string): boolean {
  return /^0x[0-9a-fA-F]{8,}$/.test(value)
}

export function shortIdentifier(value: string): string {
  return isHexIdentifier(value) && value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}

function networkOf(payload: Record<string, unknown>): string {
  const meta = isRecord(payload._meta) ? payload._meta : {}
  const evidence = isRecord(payload._evidence) ? payload._evidence : {}
  const source = isRecord(evidence.source) ? evidence.source : {}
  return text(meta.network ?? meta.dataset ?? source.network ?? source.dataset ?? payload.network)
}

/* An identifier becomes a link to the same record on the network's public
   explorer. The host opens it; the App itself never navigates. */
export function identifierLink(
  payload: Record<string, unknown>,
  key: string,
  value: string,
  actions: ExplorerActions | undefined,
  label = shortIdentifier(value),
): HTMLAnchorElement | null {
  const kind = identifierKind(key)
  if (!kind) return null
  const link = explorerLink(networkOf(payload), kind, value)
  if (!link) return null
  const anchor = element('a', 'sqd-link', label) as HTMLAnchorElement
  anchor.href = link.url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.title = `${value} · open on ${link.name}`
  anchor.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (actions?.openLink) actions.openLink(link.url)
    else window.open(link.url, '_blank', 'noopener')
  })
  return anchor
}

export function identifierNode(
  payload: Record<string, unknown>,
  key: string,
  value: string,
  actions: ExplorerActions | undefined,
): HTMLElement {
  const link = identifierLink(payload, key, value, actions)
  if (link) return link
  const node = element('span', undefined, shortIdentifier(value))
  node.title = value
  return node
}

/* Portal stamps rows as "2026-09-02 09:47:05 UTC". The timeline column keeps
   the clock and carries the full stamp as a title; exact tables keep it all. */
export function eventTimeLabel(value: string): string {
  const full = /^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2}(?::\d{2})?)(?:\s*UTC|Z)?$/.exec(value.trim())
  return full ? full[1] : value
}

export function shortTimeLabel(value: string): string {
  const clock = /\b(\d{2}:\d{2})(?::\d{2})?\b/.exec(value)
  if (clock) return clock[1]
  return value.slice(0, 22)
}

/*
 * renderExplorer rebuilds the whole tree on every state change, so the element
 * that had focus is gone by the time the new one is in place: a follow-up
 * click dropped keyboard users back at the top of the document. A control that
 * carries a focus key can be found again in the new tree and refocused.
 */
export function withFocusKey<T extends HTMLElement>(node: T, key: string): T {
  node.dataset.focusKey = key
  return node
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  content?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (content !== undefined) node.textContent = content
  return node
}

export function injectStyle() {
  if (document.getElementById(ROOT_STYLE_ID)) return
  const style = element('style')
  style.id = ROOT_STYLE_ID
  style.textContent = ACTIVITY_EXPLORER_CSS
  document.head.append(style)
}

export function logoMark(): HTMLElement {
  const mark = element('div', 'sqd-mark')
  mark.setAttribute('aria-hidden', 'true')
  mark.innerHTML =
    '<svg viewBox="0 0 306 306" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="305" height="305" transform="translate(0.117798 0.453125)" fill="black"/><path d="M208.004 125.812C180.366 125.812 166.754 135.622 152.344 146.003C136.923 157.109 120.961 168.6 89.1939 168.6C84.5804 168.6 80.2945 168.344 76.3076 167.902V229.358H228.665V128.019C222.699 126.623 215.921 125.812 208.004 125.812Z" fill="white"/><path d="M89.1084 120.614C84.7655 120.614 80.4938 120.301 76.2933 119.746V154.987C80.2375 155.5 84.5092 155.784 89.1796 155.784C116.818 155.784 130.43 145.974 144.84 135.594C160.261 124.487 176.223 112.996 207.99 112.996C215.75 112.996 222.556 113.68 228.651 114.89V77H170.157C152.728 103.257 122.912 120.614 89.1084 120.614Z" fill="white"/><path d="M76.2933 106.831C80.4796 107.471 84.7513 107.799 89.1084 107.799C115.308 107.799 138.76 95.7955 154.252 77H76.2933V106.817V106.831Z" fill="white"/></svg>'
  return mark
}

export type TooltipRow = { label: string; value: string; flag?: boolean }

/* Tooltips read as a title plus aligned label/value rows, never a sentence. */
export function renderTooltip(node: HTMLElement, title: string, rows: TooltipRow[]) {
  node.replaceChildren()
  node.append(element('div', 'sqd-tooltip-title', title))
  const grid = element('div', 'sqd-tooltip-rows')
  for (const row of rows) {
    if (row.flag) {
      grid.append(element('span', 'sqd-tooltip-flag', row.label))
      continue
    }
    grid.append(element('span', 'sqd-tooltip-label', row.label), element('span', 'sqd-tooltip-value', row.value))
  }
  node.append(grid)
}

/* Keep a tooltip inside its chart: centre it on the anchor, then pull it
   back from either edge by its own width so the first column is never cut. */
export function placeTooltip(node: HTMLElement, anchorX: number) {
  const room = node.parentElement?.clientWidth ?? 0
  const half = node.offsetWidth / 2
  const left = room > node.offsetWidth + 8 ? Math.min(Math.max(anchorX, half + 4), room - half - 4) : room / 2
  node.style.left = `${Math.round(left)}px`
}

export function splitTooltipValue(entry: string): TooltipRow {
  if (entry.endsWith('not available'))
    return { label: entry.slice(0, -'not available'.length).trim(), value: 'not available' }
  const match = /^(.*\S)\s+(\S+)$/.exec(entry)
  return match ? { label: match[1], value: match[2] } : { label: entry, value: '' }
}

export function card(title: string, subtitle?: string, modifiers = ''): { root: HTMLElement; body: HTMLElement } {
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

/* A local page is normal state and reads as a neutral caption. Amber appears
   only when the payload itself holds fewer rows than the server declared. */
export function displayLimitNotice(
  label: string,
  shown: number,
  available: number,
  declared = available,
): HTMLElement | null {
  if (shown >= declared) return null
  const completeInPayload = available >= declared
  const notice = element(
    'p',
    completeInPayload ? 'sqd-display-limit' : 'sqd-display-limit sqd-display-limit--caution',
    completeInPayload
      ? `${shown} of ${declared} ${label} are shown in this view. Search and exact JSON keep all ${available} rows in this result.`
      : `${shown} of ${declared} declared ${label} are present in this payload. Check coverage and pagination before using totals.`,
  )
  notice.setAttribute('role', 'note')
  return notice
}

export function isIdentifierColumn(column: Column, value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (column.format === 'address' || /(^|_)(address|hash|sender|recipient|from|to|user)(_|$)/i.test(column.key))
  )
}

export function numberRows(
  payload: Record<string, unknown>,
  descriptor: Record<string, unknown>,
): Record<string, unknown>[] {
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

export function sortRowsByX(
  rows: Record<string, unknown>[],
  chart: Record<string, unknown>,
): Record<string, unknown>[] {
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

export function intervalSeconds(value: unknown): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/i.exec(text(value).trim())
  if (!match) return undefined
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2].toLowerCase() as 's' | 'm' | 'h' | 'd']
  return Number(match[1]) * multiplier
}

export function tickText(value: number, format?: string, isTop = false): string {
  const magnitude = Math.abs(value)
  let base: string
  if (value === 0) base = '0'
  else if (magnitude >= 1000) base = compact(value)
  else if (magnitude < 1) base = Number(value.toPrecision(3)).toString()
  else base = Number(value.toPrecision(4)).toString()
  if (format === 'currency_usd' && isTop) return `$${base}`
  return base
}

export type ChartPoint = {
  row: Record<string, unknown>
  values: Array<number | null>
}

export type ChartSeries = {
  key: string
  label: string
  color: string
}

export function evidenceIdentity(row: Record<string, unknown>): string {
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

export type EvidencePager = HTMLElement & { __sqdShowEvidence?: (identity: string) => void }

/* Set once per render so a point anywhere in the tree can report a pin without
   every chart having to carry the actions object down to its hit targets. */
export let reportSelection: ExplorerActions['reportSelection']

/** Set once per render, so a chart point can report a pin without carrying the
 *  actions object down to every hit target. */
export function setSelectionReporter(report: ExplorerActions['reportSelection']) {
  reportSelection = report
}

export function selectEvidenceRow(row: Record<string, unknown>, selectedHit: Element) {
  const identity = evidenceIdentity(row)
  /* Only the row's own identity and its time go to the model. A free-text
     field from a third party has no business being restated as context. */
  const when = text(row.timestamp_human ?? row.timestamp ?? '')
  reportSelection?.([identity, when].filter(Boolean).join(' at ').slice(0, 200) || null)
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

export function showDetails(title: string, value: unknown, note?: string) {
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

export type PanelOptions = { mode: DisplayMode; actions?: ExplorerActions; state?: ExplorerState }

export type PanelSet = { primary: HTMLElement | null; secondary: HTMLElement[]; ledger: HTMLElement[] }

export type NoticeTier = 'info' | 'caution' | 'danger'

export function stack(className: string, children: Array<HTMLElement | null>): HTMLElement | null {
  const present = children.filter((child): child is HTMLElement => Boolean(child))
  if (!present.length) return null
  const node = element('div', className)
  node.append(...present)
  return node
}

/** Where the skip link lands. */
export const EVIDENCE_ANCHOR_ID = 'sqd-evidence'
