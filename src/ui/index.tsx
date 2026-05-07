import { useCallback, useEffect, useReducer } from 'react'
import { createRoot } from 'react-dom/client'
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps'

import { AppShell, type AppState, type DrawerState } from './AppShell.js'
import { isRecord } from './format.js'
import { injectGlobalStyles } from './theme.js'

const ZOOM_DURATION_MAP: Record<string, string> = {
  '30d': '7d',
  '7d': '24h',
  '24h': '6h',
  '6h': '1h',
  '1h': '1h',
}

type Action =
  | { type: 'input'; args: Record<string, unknown> }
  | { type: 'result'; payload: Record<string, unknown> | null; rawText: string; error: string }
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'openDrawer'; drawer: DrawerState }
  | { type: 'closeDrawer' }
  | { type: 'toggleRaw' }

type InternalState = AppState & {
  currentArgs: Record<string, unknown>
}

const initialState: InternalState = {
  payload: null,
  rawText: '',
  loading: false,
  error: '',
  drawer: null,
  rawOpen: false,
  currentArgs: {},
}

function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case 'input':
      return { ...state, loading: true, error: '', currentArgs: action.args }
    case 'result':
      return {
        ...state,
        loading: false,
        payload: action.payload,
        rawText: action.rawText,
        error: action.error,
      }
    case 'loading':
      return { ...state, loading: true, error: '' }
    case 'error':
      return { ...state, loading: false, error: action.message }
    case 'openDrawer':
      return { ...state, drawer: action.drawer }
    case 'closeDrawer':
      return { ...state, drawer: null }
    case 'toggleRaw':
      return { ...state, rawOpen: !state.rawOpen }
    default:
      return state
  }
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const textPart = content.find(
    (entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string',
  ) as { text: string } | undefined
  return textPart?.text || ''
}

function parsePayload(rawText: string): Record<string, unknown> | null {
  if (!rawText) return null
  try {
    const parsed = JSON.parse(rawText)
    return isRecord(parsed) ? parsed : { value: parsed }
  } catch {
    return { _summary: rawText, value: rawText }
  }
}

function Root() {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    injectGlobalStyles()
    const app = new App({ name: 'portal-explorer', version: '0.7.8' }, {})

    const applyHostContext = (ctx: any) => {
      if (!ctx) return
      if (ctx.theme) applyDocumentTheme(ctx.theme)
      if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
      if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
    }

    ;(app as any).onhostcontextchanged = (ctx: any) => applyHostContext(ctx)
    ;(app as any).ontoolinput = (params: { arguments?: Record<string, unknown> }) => {
      dispatch({ type: 'input', args: params.arguments ?? {} })
    }
    ;(app as any).ontoolresult = (result: {
      isError?: boolean
      content?: unknown
    }) => {
      if (result?.isError) {
        dispatch({ type: 'error', message: extractText(result.content) || 'Portal returned an error.' })
        return
      }
      const rawText = extractText(result?.content)
      const payload = parsePayload(rawText)
      if (!payload) {
        dispatch({
          type: 'result',
          payload: null,
          rawText,
          error: rawText || 'Portal returned a response the app could not parse.',
        })
        return
      }
      dispatch({ type: 'result', payload, rawText, error: '' })
    }

    ;(async () => {
      try {
        await (app as any).connect()
        applyHostContext((app as any).getHostContext?.())
      } catch (err) {
        dispatch({
          type: 'error',
          message: err instanceof Error ? err.message : 'Unable to connect the Portal app.',
        })
      }
    })()

    ;(window as any).__portalApp = app
    ;(window as any).__portalDispatch = dispatch
  }, [])

  const openDrawer = useCallback((title: string, item: unknown) => {
    dispatch({ type: 'openDrawer', drawer: { title, item } })
  }, [])
  const closeDrawer = useCallback(() => dispatch({ type: 'closeDrawer' }), [])
  const toggleRaw = useCallback(() => dispatch({ type: 'toggleRaw' }), [])

  const runFollowup = useCallback(
    async (intent: string, target?: string) => {
      if (intent === 'show_raw') {
        dispatch({ type: 'toggleRaw' })
        return
      }
      const app = (window as any).__portalApp
      const payload = state.payload
      const toolName = (payload?._tool_contract as Record<string, unknown> | undefined)?.name as
        | string
        | undefined
      if (!app || !toolName) {
        dispatch({ type: 'error', message: 'This result does not expose a follow-up tool call.' })
        return
      }

      let args: Record<string, unknown> | undefined

      if (intent === 'continue') {
        const cursor = (payload?._pagination as Record<string, unknown> | undefined)?.next_cursor
        if (!cursor) return
        args = { cursor }
      } else if (intent === 'compare_previous') {
        args = { ...state.currentArgs, compare_previous: true }
      } else if (intent === 'zoom_in') {
        const currentDuration = state.currentArgs?.duration as string | undefined
        const nextDuration = (currentDuration && ZOOM_DURATION_MAP[currentDuration]) || currentDuration
        args = { ...state.currentArgs, ...(nextDuration ? { duration: nextDuration } : {}) }
      } else if (intent === 'drilldown' && target) {
        dispatch({ type: 'openDrawer', drawer: { title: target, item: (payload as any)?.[target] } })
        return
      }

      if (!args) return
      dispatch({ type: 'loading' })
      try {
        const result = await app.callServerTool({ name: toolName, arguments: args })
        if (result?.isError) {
          dispatch({ type: 'error', message: extractText(result.content) || 'Follow-up failed.' })
          return
        }
        const rawText = extractText(result?.content)
        const parsed = parsePayload(rawText)
        dispatch({ type: 'result', payload: parsed, rawText, error: '' })
      } catch (err) {
        dispatch({
          type: 'error',
          message: err instanceof Error ? err.message : 'Follow-up request failed.',
        })
      }
    },
    [state.payload, state.currentArgs],
  )

  return (
    <AppShell
      state={state}
      actions={{ openDrawer, closeDrawer, toggleRaw, runFollowup }}
    />
  )
}

const container = document.getElementById('app')
if (container) {
  createRoot(container).render(<Root />)
}
