import {
  type ExplorerActions,
  type ExplorerState,
  asArray,
  displayModeOf,
  element,
  formatValue,
  getByPath,
  humanize,
  identifierLink,
  isHexIdentifier,
  isRecord,
  logoMark,
  shortIdentifier,
  showDetails,
  text,
  withFocusKey,
} from './common.js'
import { chainFor, chainLogoUrl } from './explorers.js'

/* The query chip says what was asked (network · subject · window) so the
   header carries the question, not only the brand. */
function queryChip(payload: Record<string, unknown> | null, currentArgs: Record<string, unknown>): HTMLElement | null {
  const meta = payload && isRecord(payload._meta) ? payload._meta : {}
  const summary = payload && isRecord(payload.summary) ? payload.summary : {}
  const coverage = payload && isRecord(payload._coverage) ? payload._coverage : {}
  const network = text(meta.network ?? meta.dataset ?? payload?.network ?? currentArgs.network)
  const subjectRaw = text(
    summary.coin ?? currentArgs.coin ?? currentArgs.address ?? currentArgs.contract ?? currentArgs.wallet ?? '',
  )
  const subject = isHexIdentifier(subjectRaw) ? shortIdentifier(subjectRaw) : subjectRaw
  const window = text(coverage.requested_window ?? meta.timeframe ?? currentArgs.timeframe ?? currentArgs.duration)
  const parts = [network, subject, window].filter(Boolean)
  if (!parts.length) return null
  const chip = element('div', 'sqd-query')
  chip.setAttribute('aria-label', `Query: ${parts.join(', ')}`)
  chip.title = [network, subjectRaw, window].filter(Boolean).join(' · ')
  const badge = chainBadge(network, 'sqd-query-chain')
  if (badge) chip.append(badge)
  for (const part of parts.slice(network ? 1 : 0)) chip.append(element('span', undefined, part))
  return chip
}

/* The chain's own logo and display name from SQD's network metadata. */
function chainBadge(network: string, className: string): HTMLElement | null {
  if (!network) return null
  const chain = chainFor(network)
  const badge = element('span', className)
  const logo = chainLogoUrl(chain)
  if (logo) {
    const image = element('img', 'sqd-chain-logo') as HTMLImageElement
    image.src = logo
    image.alt = ''
    image.width = 16
    image.height = 16
    image.loading = 'lazy'
    image.referrerPolicy = 'no-referrer'
    image.addEventListener('error', () => image.remove())
    badge.append(image)
  }
  badge.append(document.createTextNode(chain?.name ?? network))
  badge.title = network
  return badge
}

export function canFullscreen(state: ExplorerState, actions: ExplorerActions): boolean {
  if (!actions.requestFullscreen) return false
  if (state.availableDisplayModes && !state.availableDisplayModes.includes('fullscreen')) return false
  return true
}

export function fullscreenButton(actions: ExplorerActions, modifier = ''): HTMLElement {
  const button = withFocusKey(
    element('button', `sqd-button${modifier ? ` ${modifier}` : ''}`, 'Open full screen'),
    'fullscreen',
  )
  button.type = 'button'
  button.addEventListener('click', () => actions.requestFullscreen?.())
  return button
}

export function appHeader(actions: ExplorerActions, state: ExplorerState): HTMLElement {
  const mode = displayModeOf(state)
  const topbar = element('div', 'sqd-topbar')
  const brand = element('div', 'sqd-brand')
  brand.append(logoMark())
  const copy = element('div', 'sqd-brand-copy')
  copy.append(element('div', 'sqd-brand-name', 'SQD'))
  copy.append(element('div', 'sqd-brand-subtitle', 'Explorer'))
  /* The Explorer ships as an opt-in beta; the tag says so wherever it renders. */
  const beta = element('span', 'sqd-beta', 'Beta')
  beta.title = 'SQD Explorer is in beta. Opt out with ?app=0 on the connection or MCP_APP_ENABLED=false.'
  copy.append(beta)
  brand.append(copy)
  const chip = queryChip(state.payload, state.currentArgs)
  if (chip) brand.append(chip)
  topbar.append(brand)

  const actionBar = element('div', 'sqd-actions')
  const hasHistory = (state.historyLength ?? 0) > 1
  if (mode === 'fullscreen' && hasHistory && (actions.goBack || actions.goForward)) {
    const back = withFocusKey(element('button', 'sqd-button', 'Back'), 'history-back')
    back.type = 'button'
    back.disabled = (state.historyIndex ?? 0) <= 0
    back.setAttribute('aria-label', 'Open previous result in this session')
    back.addEventListener('click', () => actions.goBack?.())
    const forward = withFocusKey(element('button', 'sqd-button', 'Forward'), 'history-forward')
    forward.type = 'button'
    forward.disabled = (state.historyIndex ?? 0) >= (state.historyLength ?? 1) - 1
    forward.setAttribute('aria-label', 'Open next result in this session')
    forward.addEventListener('click', () => actions.goForward?.())
    actionBar.append(back, forward)
  }
  if (mode === 'fullscreen' && actions.requestInline) {
    const exit = withFocusKey(element('button', 'sqd-button sqd-button--quiet', 'Exit full screen'), 'exit-fullscreen')
    exit.type = 'button'
    exit.addEventListener('click', () => actions.requestInline?.())
    actionBar.append(exit)
  } else if (mode === 'inline' && canFullscreen(state, actions) && !state.payload) {
    actionBar.append(fullscreenButton(actions, 'sqd-button--quiet'))
  }
  if (actionBar.childElementCount) topbar.append(actionBar)
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

export function masthead(payload: Record<string, unknown>, actions?: ExplorerActions): HTMLElement {
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
  const network = text(meta.network ?? meta.dataset ?? payload.network)
  const chain = chainFor(network)
  const overlineParts = [mode.label, chain?.name ?? network, text(summary.coin)].filter(Boolean).join(' · ')
  eyebrow.append(document.createTextNode(overlineParts))
  section.append(eyebrow)

  const error = isRecord(payload.error) ? payload.error : undefined
  /* The heading names the subject (an address, a coin, a network window).
     The tool's narrative answer is for the conversation, not the App. */
  const answer = text(payload.answer)
  const overview = isRecord(payload.overview) ? payload.overview : {}
  const subjectId = [payload.contract_address, payload.address, overview.address, overview.contract_address]
    .map(text)
    .find((candidate) => isHexIdentifier(candidate))
  const captioned = text(
    headline.title ?? display.title ?? error?.summary ?? payload._summary ?? payload.answer ?? 'Blockchain activity',
  )
  /* A result about one address is headed by that address; the caption the
     tool wrote moves under it. */
  const claim = subjectId && !captioned.includes(subjectId) ? subjectId : captioned
  const title = element('h1', `sqd-title${isHexIdentifier(claim) ? ' sqd-title--id' : ''}`)
  const titleLink = isHexIdentifier(claim)
    ? identifierLink(payload, claim.length === 66 ? 'tx_hash' : 'address', claim, actions, claim)
    : null
  if (titleLink) title.append(titleLink)
  else title.textContent = claim
  title.id = 'sqd-result-title'
  section.append(title)

  const subtitleText =
    claim === subjectId
      ? [captioned, text(headline.subtitle ?? display.subtitle)].filter((part) => part && part !== claim).join(' · ')
      : text(headline.subtitle ?? display.subtitle)
  if (subtitleText && subtitleText !== claim && subtitleText !== answer && subtitleText.length <= 140)
    section.append(element('p', 'sqd-subtitle', subtitleText))

  return section
}

export function evidenceReceipt(payload: Record<string, unknown>, actions: ExplorerActions): HTMLElement | null {
  const evidence = isRecord(payload._evidence) ? payload._evidence : undefined
  if (!evidence) return null
  const section = element('section', 'sqd-receipt')
  section.setAttribute('aria-label', 'Evidence receipt')
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

export function metricCards(payload: Record<string, unknown>): HTMLElement | null {
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
  /* The primary metric leads the row; there is no separate hero figure. A
     yes/no flag is state, not a measurement; it stays in the receipt. */
  const cards = (specs.length ? specs : fallbacks)
    .filter((spec) => typeof getByPath(payload, text(spec.value_path)) !== 'boolean')
    .sort((left, right) => Number(right.emphasis === 'primary') - Number(left.emphasis === 'primary'))
  if (!cards.length) return null
  const grid = element('section', 'sqd-metrics')
  grid.setAttribute('aria-label', 'Key metrics')
  for (const spec of cards.slice(0, 8)) {
    const card = element('article', `sqd-metric${spec.emphasis === 'primary' ? ' sqd-metric--primary' : ''}`)
    card.append(element('div', 'sqd-metric-label', text(spec.label ?? 'Metric')))
    /* A unit the label already names ("Average transactions" + "transactions")
       would only crowd the value. */
    const label = text(spec.label ?? 'Metric')
    const unit = text(spec.unit)
    const format = text(spec.format)
    const showUnit = unit && !label.toLowerCase().includes(unit.toLowerCase()) && format !== 'currency_usd'
    card.append(element('div', 'sqd-metric-value', formatValue(getByPath(payload, text(spec.value_path)), format)))
    if (showUnit) card.append(element('div', 'sqd-metric-unit', unit))
    if (spec.subtitle) card.append(element('div', 'sqd-metric-subtitle', text(spec.subtitle)))
    grid.append(card)
  }
  return grid
}
