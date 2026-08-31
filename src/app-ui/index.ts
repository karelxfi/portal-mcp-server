import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps'

import { evidenceArguments, planFollowup } from './followup-state.js'
import { downloadEvidence } from './export.js'
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
  {},
  { strict: true },
)

function update(next: Partial<ExplorerState>) {
  state = { ...state, ...next }
  renderExplorer(root!, state, actions)
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
  update({ displayMode: context.displayMode })
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
      update({ payload: null, error: 'This result does not include a safe follow-up tool.' })
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
      update({ payload: null, error: plan.error ?? 'This follow-up cannot be reconstructed safely.' })
      return
    }
    update({ loading: true, error: '' })
    try {
      const result = await app.callServerTool({ name: toolName, arguments: plan.callArgs })
      const rawText = extractText(result.content)
      const payload = isRecord(result.structuredContent) ? result.structuredContent : parseText(rawText)
      if (result.isError) {
        update({
          payload: null,
          rawText,
          currentArgs: plan.persistedArgs,
          loading: false,
          error: rawText || 'SQD returned an error.',
        })
        return
      }
      remember({
        payload,
        rawText,
        currentArgs: evidenceArguments(payload, plan.persistedArgs),
        error: '',
      })
    } catch (error) {
      update({ payload: null, loading: false, error: error instanceof Error ? error.message : 'The follow-up request failed.' })
    }
  },
  async requestFullscreen() {
    try {
      await app.requestDisplayMode({ mode: 'fullscreen' })
    } catch {
      /* Host can decline full screen. */
    }
  },
  goBack() {
    showSnapshot(historyIndex - 1)
  },
  goForward() {
    showSnapshot(historyIndex + 1)
  },
  exportEvidence(format) {
    if (state.payload) downloadEvidence(state.payload, format)
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
app.ontoolcancelled = () =>
  update({ payload: null, loading: false, error: 'The request was cancelled. You can run it again.' })
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
