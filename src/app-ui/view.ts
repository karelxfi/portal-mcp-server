import { disposeActiveCharts } from './charts/terminal.js'
import {
  type DisplayMode,
  EVIDENCE_ANCHOR_ID,
  type ExplorerActions,
  type ExplorerState,
  displayModeOf,
  element,
  injectStyle,
  isRecord,
  setAppRoot,
  setSelectionReporter,
  stack,
  text,
} from './common.js'
import { appHeader, canFullscreen, evidenceReceipt, fullscreenButton, masthead, metricCards } from './masthead.js'
import { panels } from './panels.js'
import { actionButton, emptyState, followups, loadingState, noRowsState, notice, notices, raw } from './states.js'

/*
 * The Explorer's entry point: one render, and the public surface a host
 * binding needs. The pieces it assembles live beside it in `masthead.ts`,
 * `charts/`, `tables.ts`, `panels.ts` and `states.ts`, over the shared
 * primitives in `common.ts`.
 */

export { disposeActiveCharts } from './charts/terminal.js'
export type { ChartView, ExplorerActions, ExplorerState } from './common.js'
export { formatValue, isRecord, withFocusKey } from './common.js'

/*
 * Everything a render reads apart from whether a follow-up is in flight. Two
 * renders with the same signature draw the same result, so the second one has
 * nothing to rebuild: tearing the DOM down would dispose every live chart and
 * take the reader's zoom with it, in the one moment they are most likely to be
 * looking at it.
 */
function renderSignature(state: ExplorerState, mode: DisplayMode): string {
  const evidence =
    isRecord(state.payload?._evidence) && isRecord(state.payload._evidence.result)
      ? text(state.payload._evidence.result.sha256)
      : ''
  return JSON.stringify([
    evidence || state.rawText.slice(0, 2048),
    mode,
    state.error,
    state.historyIndex,
    state.historyLength,
    state.availableDisplayModes,
    state.currentArgs,
    Boolean(state.payload),
  ])
}

let lastRender: { root: HTMLElement; signature: string; payload: Record<string, unknown> | null } | undefined

/** The dimmed, held state a follow-up puts the last result into. */
function setPending(shell: HTMLElement, pending: boolean) {
  const existing = shell.querySelector('.sqd-progress')
  if (!pending) {
    shell.removeAttribute('aria-busy')
    existing?.remove()
    return
  }
  shell.setAttribute('aria-busy', 'true')
  if (existing) return
  const progress = element('div', 'sqd-progress')
  progress.setAttribute('role', 'progressbar')
  progress.setAttribute('aria-label', 'Loading the next result')
  shell.querySelector('.sqd-topbar')?.after(progress)
}

export function renderExplorer(root: HTMLElement, state: ExplorerState, actions: ExplorerActions) {
  setSelectionReporter(actions.reportSelection)
  injectStyle()
  const mode = displayModeOf(state)
  const signature = renderSignature(state, mode)
  const liveShell = root.querySelector<HTMLElement>('.sqd-shell')
  /* Object identity as well as the signature: a payload with no evidence
     receipt has little to hash, and answering a new result with the old DOM
     would be far worse than a rebuild nobody notices. */
  if (
    lastRender?.root === root &&
    lastRender.payload === state.payload &&
    lastRender.signature === signature &&
    liveShell
  ) {
    /* The same result, in flight or not. The header is rebuilt because it
       carries the callbacks and the history state; everything below it, charts
       included, stays exactly as the reader left it. */
    liveShell.querySelector('.sqd-topbar')?.replaceWith(appHeader(actions, state))
    setPending(liveShell, state.loading && Boolean(state.payload))
    return
  }
  lastRender = { root, signature, payload: state.payload }
  disposeActiveCharts()
  setAppRoot(root)
  root.className = 'sqd-app'
  root.dataset.mode = mode
  root.replaceChildren()
  const shell = element('main', 'sqd-shell')
  /* The evidence table is the point of the app and sits below the header,
     the answer and the charts. A keyboard user should not have to tab past
     all of it to reach the rows. */
  const skip = element('a', 'sqd-skip-link', 'Skip to the evidence table') as HTMLAnchorElement
  skip.href = `#${EVIDENCE_ANCHOR_ID}`
  shell.append(skip)
  shell.append(appHeader(actions, state))
  /* A follow-up in flight: the last result stays on screen, dimmed behind a
     progress bar, and every follow-up control is held. */
  setPending(shell, state.loading && Boolean(state.payload))
  if (state.loading && !state.payload) shell.append(loadingState())
  else if (!state.payload) shell.append(emptyState(state, actions))
  else {
    const payload = state.payload
    shell.append(masthead(payload, actions))
    if (state.error) {
      shell.append(notice('danger', state.error, [actionButton('Retry', () => actions.runFollowup('retry'))]))
    }
    /* Inline, only notices that reduce trust sit above the instrument; the
       informational ones (a forming candle) follow it as a footnote. */
    const resultNotices = notices(payload, actions, state, mode === 'inline' ? ['danger', 'caution'] : undefined)
    if (resultNotices) shell.append(resultNotices)
    const metrics = metricCards(payload)
    const views = panels(payload, { mode, actions, state })
    /* A tool can declare panels for a window that returned nothing; the
       evidence receipt is the authority on whether any rows exist. */
    const evidence = isRecord(payload._evidence) && isRecord(payload._evidence.result) ? payload._evidence.result : {}
    const zeroRows = evidence.row_count === 0
    const hasRows = !zeroRows && Boolean(views.primary || views.secondary.length || views.ledger.length)
    if (mode === 'inline') {
      /* Inline is a summary card: the answer, one metrics row, the primary
         instrument, and at most two actions. Everything else is fullscreen. */
      if (metrics) shell.append(metrics)
      const primary = hasRows ? (views.primary ?? views.secondary[0] ?? views.ledger[0] ?? null) : null
      if (primary) shell.append(primary)
      else if (!isRecord(payload.error)) shell.append(noRowsState(payload, state, actions))
      const footnotes = notices(payload, actions, state, ['info'])
      if (footnotes) shell.append(footnotes)
      /* With no rows the tool's own follow-ups (raw rows, continue) have
         nothing to act on; the widen action lives in the empty state. */
      const next = hasRows
        ? followups(payload, actions, state)
        : canFullscreen(state, actions)
          ? stack('sqd-actions sqd-followups sqd-followups--inline', [fullscreenButton(actions)])
          : null
      if (next) shell.append(next)
    } else {
      /* Two columns only when there are secondary instruments to fill the
         side; a metrics row alone sits above the primary at full width. */
      const split = Boolean(views.primary && views.secondary.length)
      if (metrics && !split) shell.append(metrics)
      const side = split ? stack('sqd-workspace-side', [metrics, ...views.secondary]) : null
      const main = stack('sqd-workspace-main', [views.primary, ...(split ? [] : views.secondary)])
      const ledger = stack('sqd-workspace-ledger', views.ledger)
      const workspace = stack(`sqd-workspace${split ? ' sqd-workspace--split' : ''}`, [main, side, ledger])
      if (workspace && hasRows) shell.append(workspace)
      if (!hasRows && !isRecord(payload.error)) shell.append(noRowsState(payload, state, actions))
      const next = followups(payload, actions, state)
      if (next) shell.append(next)
      const receipt = evidenceReceipt(payload, actions)
      if (receipt) shell.append(receipt)
      shell.append(raw(payload))
    }
  }
  root.append(shell)
}
