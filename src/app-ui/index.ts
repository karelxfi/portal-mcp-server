import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps'

import { type ExplorerActions, type ExplorerState, isRecord, renderExplorer } from './view.js'

const root = document.getElementById('app')
if (!root) throw new Error('SQD Activity Explorer root is missing')

let state: ExplorerState = {
  payload: null,
  rawText: '',
  loading: true,
  error: '',
  currentArgs: {},
}

const app = new App({ name: 'sqd-blockchain-activity-explorer', version: '0.8.3' }, {}, { strict: true })

function update(next: Partial<ExplorerState>) {
  state = { ...state, ...next }
  renderExplorer(root!, state, actions)
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
    if (intent === 'drilldown' && target) {
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
      update({ error: 'This result does not include a safe follow-up tool.' })
      return
    }
    let args: Record<string, unknown> = isRecord(action?.arguments) ? action.arguments : { ...state.currentArgs }
    if (intent === 'continue') {
      const pagination = state.payload && isRecord(state.payload._pagination) ? state.payload._pagination : undefined
      if (typeof pagination?.next_cursor !== 'string') return
      args = { cursor: pagination.next_cursor }
    } else if (intent === 'compare_previous') args = { ...state.currentArgs, compare_previous: true }
    else if (intent === 'zoom_in') {
      const duration = typeof state.currentArgs.duration === 'string' ? state.currentArgs.duration : undefined
      const zoom: Record<string, string> = { '30d': '7d', '7d': '24h', '24h': '6h', '6h': '1h' }
      args = { ...state.currentArgs, ...(duration && zoom[duration] ? { duration: zoom[duration] } : {}) }
    }
    update({ loading: true, error: '' })
    try {
      const result = await app.callServerTool({ name: toolName, arguments: args })
      const rawText = extractText(result.content)
      const payload = isRecord(result.structuredContent) ? result.structuredContent : parseText(rawText)
      update({ payload, rawText, loading: false, error: result.isError ? rawText || 'SQD returned an error.' : '' })
    } catch (error) {
      update({ loading: false, error: error instanceof Error ? error.message : 'The follow-up request failed.' })
    }
  },
  async requestFullscreen() {
    try {
      await app.requestDisplayMode({ mode: 'fullscreen' })
    } catch {
      /* Host can decline full screen. */
    }
  },
}

app.ontoolinput = (params) => update({ currentArgs: params.arguments ?? {}, loading: true, error: '' })
app.ontoolresult = (result) => {
  const rawText = extractText(result.content)
  const payload = isRecord(result.structuredContent) ? result.structuredContent : parseText(rawText)
  update({ payload, rawText, loading: false, error: result.isError ? rawText || 'SQD returned an error.' : '' })
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
