import {
  type ExplorerActions,
  type ExplorerState,
  type NoticeTier,
  asArray,
  displayModeOf,
  element,
  humanize,
  isRecord,
  text,
  withFocusKey,
} from './common.js'
import { canFullscreen, fullscreenButton } from './masthead.js'

/* Server notices are informational unless they say the numbers are less
   trustworthy: a stale head, sampling, truncation. Those earn amber. */
function noticeTier(copy: string): NoticeTier {
  return /behind the chain head|stale|sampled|truncat|capped|incomplete|not (?:been )?included/i.test(copy)
    ? 'caution'
    : 'info'
}

export function notice(tier: NoticeTier, copy: string, buttons: HTMLElement[] = []): HTMLElement {
  const node = element('div', `sqd-notice sqd-notice--${tier}`)
  node.setAttribute('role', tier === 'danger' ? 'alert' : 'note')
  node.append(element('span', 'sqd-notice-copy', copy))
  if (buttons.length) {
    const bar = element('div', 'sqd-actions')
    bar.append(...buttons)
    node.append(bar)
  }
  return node
}

export function actionButton(label: string, onClick: () => void, modifier = ''): HTMLButtonElement {
  const button = withFocusKey(
    element('button', `sqd-button${modifier ? ` ${modifier}` : ''}`, label),
    `action:${label}`,
  ) as HTMLButtonElement
  button.type = 'button'
  button.addEventListener('click', onClick)
  return button
}

export function notices(
  payload: Record<string, unknown>,
  actions: ExplorerActions,
  state: ExplorerState,
  tiers: NoticeTier[] = ['danger', 'caution', 'info'],
): HTMLElement | null {
  /* A tool may write App-facing notices separately from the ones meant for
     its caller; use them when they exist. */
  const ui = isRecord(payload._ui) ? payload._ui : {}
  const pagination = isRecord(payload._pagination) ? payload._pagination : {}
  const source = Array.isArray(ui.notices) ? ui.notices : [payload._notice, ...asArray(payload._notices)]
  /* A notice that only points at the continuation cursor duplicates the
     continue action that sits under the result. */
  const values = source
    .map(text)
    .filter(Boolean)
    .filter((copy) => !(pagination.has_more && /_pagination\.next_cursor/.test(copy)))
    /* The candle readout flags a forming or partial bucket on the bar itself. */
    .filter((copy) => !/still open or covers only part/.test(copy))
    /* Without App-facing notices, keep only what changes how a person reads
       the result; notes about limits, cursors and scan modes stay in JSON. */
    .filter(
      (copy) =>
        Array.isArray(ui.notices) ||
        noticeTier(copy) === 'caution' ||
        !/limit=|_pagination|cursor|installed-client|the caller|tool again|\bmode\b|timeframe|add filters|Scanning \d|Long-window note|interactive window/i.test(
          copy,
        ),
    )
  const error = tiers.includes('danger') && isRecord(payload.error) ? payload.error : undefined
  const entries: HTMLElement[] = []
  if (error) {
    const suggestions = asArray(error.suggestions).map(text).filter(Boolean)
    const retryable = error.retryable === true
    const guidance = [retryable ? 'This request is safe to retry.' : '', ...suggestions].filter(Boolean).join(' · ')
    const buttons: HTMLElement[] = []
    if (retryable && Object.keys(state.currentArgs).length) {
      buttons.push(actionButton('Retry', () => actions.runFollowup('retry')))
    }
    if (suggestions.some((suggestion) => /smaller|shorter|narrow/i.test(suggestion)) && state.currentArgs.duration) {
      buttons.push(actionButton('Use a smaller window', () => actions.runFollowup('zoom_in')))
    }
    entries.push(notice('danger', guidance || text(error.summary) || 'SQD returned an error.', buttons))
  }
  for (const copy of values.slice(0, 5)) {
    const tier = noticeTier(copy)
    if (tiers.includes(tier)) entries.push(notice(tier, copy))
  }
  if (!entries.length) return null
  const wrap = element('section', `sqd-notices${tiers.includes('danger') ? '' : ' sqd-notices--after'}`)
  wrap.setAttribute('aria-label', 'Important result notices')
  wrap.append(...entries)
  return wrap
}

const EXECUTABLE_INTENTS = ['continue', 'compare_previous', 'drilldown', 'show_raw', 'zoom_in']

function executableFollowups(payload: Record<string, unknown>): Record<string, unknown>[] {
  const ui = isRecord(payload._ui) ? payload._ui : {}
  const specs = asArray(ui.follow_up_actions).filter(isRecord)
  const pagination = isRecord(payload._pagination) ? payload._pagination : {}
  if (pagination.has_more && !specs.some((action) => action.intent === 'continue'))
    specs.unshift({ label: 'Load more evidence', intent: 'continue', target: '_pagination.next_cursor' })
  return specs.filter((action) => action.executable !== false && EXECUTABLE_INTENTS.includes(text(action.intent)))
}

/* Inline keeps to the host's two-action rule: the primary follow-up and the
   way into fullscreen. Fullscreen offers every executable follow-up. */
export function followups(
  payload: Record<string, unknown>,
  actions: ExplorerActions,
  state: ExplorerState,
): HTMLElement | null {
  const mode = displayModeOf(state)
  const pagination = isRecord(payload._pagination) ? payload._pagination : {}
  const executable = executableFollowups(payload)
  const fullscreen = mode === 'inline' && canFullscreen(state, actions)
  const limit = mode === 'inline' ? (fullscreen ? 1 : 2) : executable.length
  const chosen = executable.slice(0, limit)
  if (!chosen.length && !fullscreen) return null
  const bar = element('div', `sqd-actions sqd-followups${mode === 'inline' ? ' sqd-followups--inline' : ''}`)
  for (const [index, action] of chosen.entries()) {
    const button = element(
      'button',
      `sqd-button${index === 0 ? ' sqd-button--primary' : ''}`,
      text(action.label ?? humanize(text(action.intent))),
    )
    button.type = 'button'
    button.disabled = state.loading || (action.intent === 'continue' && !pagination.next_cursor)
    button.addEventListener('click', () => actions.runFollowup(text(action.intent), text(action.target), action))
    bar.append(button)
  }
  if (fullscreen) bar.append(fullscreenButton(actions))
  return bar
}

export function raw(payload: Record<string, unknown>): HTMLElement {
  const details = element('details', 'sqd-raw')
  details.append(element('summary', undefined, 'View exact JSON evidence'))
  const pre = element('pre')
  pre.tabIndex = 0
  pre.setAttribute('aria-label', 'Exact result JSON')
  pre.textContent = JSON.stringify(payload, null, 2)
  details.append(pre)
  return details
}

/* The skeleton mirrors the inline card it will become: eyebrow, answer,
   metrics row, one panel. Skeletons, not spinners, for inline content. */
export function loadingState(): HTMLElement {
  const wrap = element('div')
  wrap.setAttribute('aria-label', 'Loading blockchain data')
  wrap.style.display = 'grid'
  wrap.style.gap = '12px'
  wrap.append(element('div', 'sqd-skeleton sqd-skeleton--line'))
  wrap.append(element('div', 'sqd-skeleton sqd-skeleton--line'))
  const grid = element('div', 'sqd-metrics')
  for (let i = 0; i < 4; i += 1) grid.append(element('div', 'sqd-skeleton'))
  wrap.append(grid)
  wrap.append(element('div', 'sqd-skeleton sqd-skeleton--panel'))
  return wrap
}

export function emptyState(state: ExplorerState, actions: ExplorerActions): HTMLElement {
  const empty = element('section', 'sqd-empty')
  const error = state.error
  empty.append(
    element('h2', undefined, error ? 'The explorer could not open this result' : 'Ask SQD about blockchain activity'),
  )
  empty.append(
    element(
      'p',
      undefined,
      error ||
        'Explore wallets, contracts, token flows, network activity, Bitcoin, Solana, Polkadot, Hyperliquid, and other queryable blockchain datasets.',
    ),
  )
  if (error && Object.keys(state.currentArgs).length) {
    const bar = element('div', 'sqd-actions sqd-followups sqd-followups--inline')
    bar.append(actionButton('Retry', () => actions.runFollowup('retry'), 'sqd-button--primary'))
    empty.append(bar)
  }
  return empty
}

/* A result with nothing in it still answers: it says so, and offers the
   next window step instead of a blank sheet. */
export function noRowsState(
  payload: Record<string, unknown>,
  state: ExplorerState,
  actions: ExplorerActions,
): HTMLElement {
  const meta = isRecord(payload._meta) ? payload._meta : {}
  const wrap = element('section', 'sqd-empty')
  wrap.setAttribute('aria-label', 'No matching rows')
  wrap.append(
    element(
      'p',
      undefined,
      `Nothing matched in the ${text(meta.timeframe ?? state.currentArgs.duration ?? 'requested')} window on ${text(meta.network ?? 'this network')}. Widen the window, or ask for another network or address.`,
    ),
  )
  const bar = element('div', 'sqd-actions sqd-followups sqd-followups--inline')
  if (state.currentArgs.duration || state.currentArgs.timeframe) {
    bar.append(actionButton('Widen the window', () => actions.runFollowup('widen'), 'sqd-button--primary'))
  }
  if (bar.childElementCount) wrap.append(bar)
  return wrap
}
