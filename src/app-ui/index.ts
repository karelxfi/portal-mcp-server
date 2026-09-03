import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps'

import { buildEvidenceExport, downloadEvidence } from './export.js'
import { evidenceArguments, planFollowup } from './followup-state.js'
import { type ExplorerActions, type ExplorerState, isRecord, renderExplorer } from './view.js'

declare const __SQD_APP_VERSION__: string

const root = document.getElementById('app')
if (!root) throw new Error('SQD Activity Explorer root is missing')

let state: ExplorerState = {
  payload: null,
  rawText: '',
  loading: true,
  error: '',
  currentArgs: {},
  historyIndex: -1,
  historyLength: 0,
}

type Snapshot = Pick<ExplorerState, 'payload' | 'rawText' | 'currentArgs' | 'error'>
const history: Snapshot[] = []
let historyIndex = -1

const app = new App(
  { name: 'sqd-blockchain-activity-explorer', version: __SQD_APP_VERSION__ },
  { availableDisplayModes: ['inline', 'fullscreen'] },
  /* The options object replaces the SDK default, so autoResize has to be
     restated: it is what tells the host how tall the inline card should be. */
  { strict: true, autoResize: true },
)

/*
 * A render replaces the whole tree, so whatever had focus is detached. The
 * control that started the change is found again by its focus key and given
 * focus back, which keeps a keyboard user where they were instead of at the
 * top of the document after every follow-up.
 */
function update(next: Partial<ExplorerState>) {
  const active = document.activeElement
  const focusKey = active instanceof HTMLElement ? active.dataset.focusKey : undefined
  const selectionStart = active instanceof HTMLInputElement ? active.selectionStart : null

  state = { ...state, ...next }
  renderExplorer(root!, state, actions)

  if (!focusKey) return
  const restored = root?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)
  if (!restored || restored.hasAttribute('disabled')) return
  restored.focus()
  if (restored instanceof HTMLInputElement && selectionStart !== null) {
    restored.setSelectionRange(selectionStart, selectionStart)
  }
}

function showSnapshot(index: number) {
  const snapshot = history[index]
  if (!snapshot) return
  historyIndex = index
  update({ ...snapshot, loading: false, historyIndex, historyLength: history.length })
}

function remember(snapshot: Snapshot) {
  if (historyIndex < history.length - 1) history.splice(historyIndex + 1)
  history.push(snapshot)
  if (history.length > 20) history.shift()
  historyIndex = history.length - 1
  update({ ...snapshot, loading: false, historyIndex, historyLength: history.length })
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const part = content.find((entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string')
  return isRecord(part) ? String(part.text ?? '') : ''
}

function parseText(rawText: string): Record<string, unknown> | null {
  if (!rawText) return null
  try {
    const parsed = JSON.parse(rawText)
    return isRecord(parsed) ? parsed : { value: parsed }
  } catch {
    return { answer: rawText, _summary: rawText }
  }
}

function applyHostContext(context: ReturnType<typeof app.getHostContext>) {
  if (!context) return
  if (context.theme) applyDocumentTheme(context.theme)
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables)
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts)
  /* The host composer can overlay the bottom of an inline app, and mobile
     chrome the edges; safe-area insets become root padding. */
  const insets = context.safeAreaInsets
  const rootStyle = document.documentElement.style
  rootStyle.setProperty('--safe-top', `${insets?.top ?? 0}px`)
  rootStyle.setProperty('--safe-right', `${insets?.right ?? 0}px`)
  rootStyle.setProperty('--safe-bottom', `${insets?.bottom ?? 0}px`)
  rootStyle.setProperty('--safe-left', `${insets?.left ?? 0}px`)
  update({ displayMode: context.displayMode, availableDisplayModes: context.availableDisplayModes })
}

const actions: ExplorerActions = {
  async runFollowup(intent, target, action) {
    if ((intent === 'drilldown' || intent === 'show_raw') && target) {
      const value = state.payload
        ? target
            .split('.')
            .reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), state.payload)
        : undefined
      const pre = document.querySelector<HTMLPreElement>('.sqd-raw pre')
      const details = document.querySelector<HTMLDetailsElement>('.sqd-raw')
      if (pre && details) {
        pre.textContent = JSON.stringify(value, null, 2)
        details.open = true
        details.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
      return
    }
    const contract = state.payload && isRecord(state.payload._tool_contract) ? state.payload._tool_contract : undefined
    const toolName =
      typeof action?.tool === 'string' ? action.tool : typeof contract?.name === 'string' ? contract.name : undefined
    if (!toolName) {
      update({ loading: false, error: 'This result does not include a safe follow-up tool.' })
      return
    }
    const pagination = state.payload && isRecord(state.payload._pagination) ? state.payload._pagination : undefined
    const plan = planFollowup({
      intent,
      currentArgs: state.currentArgs,
      nextCursor: pagination?.next_cursor,
      actionArguments: action?.arguments,
    })
    if (plan.error || !plan.callArgs || !plan.persistedArgs) {
      update({ loading: false, error: plan.error ?? 'This follow-up cannot be reconstructed safely.' })
      return
    }
    update({ loading: true, error: '' })
    try {
      const result = await app.callServerTool({ name: toolName, arguments: plan.callArgs })
      const rawText = extractText(result.content)
      const payload = isRecord(result.structuredContent) ? result.structuredContent : parseText(rawText)
      if (result.isError) {
        /* A failed follow-up keeps the last good result on screen and reports
           the failure above it, so nothing the user was reading disappears. */
        update({ loading: false, error: rawText || 'SQD returned an error.' })
        return
      }
      remember({
        payload,
        rawText,
        currentArgs: evidenceArguments(payload, plan.persistedArgs),
        error: '',
      })
    } catch (error) {
      update({ loading: false, error: error instanceof Error ? error.message : 'The follow-up request failed.' })
    }
  },
  async requestFullscreen() {
    const available = app.getHostContext()?.availableDisplayModes
    if (available && !available.includes('fullscreen')) return
    try {
      const result = await app.requestDisplayMode({ mode: 'fullscreen' })
      update({ displayMode: result.mode })
    } catch {
      /* Host can decline full screen. */
    }
  },
  async requestInline() {
    try {
      const result = await app.requestDisplayMode({ mode: 'inline' })
      update({ displayMode: result.mode })
    } catch {
      /* Host can decline. */
    }
  },
  goBack() {
    showSnapshot(historyIndex - 1)
  },
  goForward() {
    showSnapshot(historyIndex + 1)
  },
  exportEvidence(format) {
    if (!state.payload) return
    /* Hosts that offer file downloads deliver the file themselves; a
       sandboxed iframe cannot save one on its own. */
    if (app.getHostCapabilities()?.downloadFile) {
      const exported = buildEvidenceExport(state.payload, format)
      app
        .downloadFile({
          contents: [
            {
              type: 'resource',
              resource: { uri: `file:///${exported.filename}`, mimeType: exported.mimeType, text: exported.content },
            },
          ],
        })
        .catch(() => downloadEvidence(state.payload!, format))
      return
    }
    downloadEvidence(state.payload, format)
  },
  openLink(url) {
    if (app.getHostCapabilities()?.openLinks) {
      app.openLink({ url }).catch(() => window.open(url, '_blank', 'noopener'))
      return
    }
    window.open(url, '_blank', 'noopener')
  },
}

app.ontoolinput = (params) =>
  update({ payload: null, rawText: '', currentArgs: params.arguments ?? {}, loading: true, error: '' })
app.ontoolresult = (result) => {
  const rawText = extractText(result.content)
  const payload = isRecord(result.structuredContent) ? result.structuredContent : parseText(rawText)
  if (result.isError) {
    update({
      payload: null,
      rawText,
      currentArgs: state.currentArgs,
      loading: false,
      error: rawText || 'SQD returned an error.',
    })
    return
  }
  remember({
    payload,
    rawText,
    currentArgs: evidenceArguments(payload, state.currentArgs),
    error: '',
  })
}
app.ontoolcancelled = () => update({ loading: false, error: 'The request was cancelled. You can run it again.' })
app.onhostcontextchanged = applyHostContext

renderExplorer(root, state, actions)
app
  .connect()
  .then(() => applyHostContext(app.getHostContext()))
  .catch((error) =>
    update({
      loading: false,
      error: error instanceof Error ? error.message : 'The explorer could not connect to this host.',
    }),
  )
