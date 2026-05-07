/**
 * Local preview harness for the Portal Explorer UI.
 *
 *   npm run dev:ui   -> http://localhost:5173/?fixture=full
 *
 * The fixture registry is shared with automated Playwright checks, so every
 * manually browsable state is also a release-gated state.
 */
import { useMemo, useReducer, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { AppShell, type AppState, type DrawerState } from './AppShell.js'
import { DEFAULT_FIXTURE_ID, UI_FIXTURES, getUiFixture } from './fixtures.js'
import { injectGlobalStyles } from './theme.js'

type Action =
  | { type: 'openDrawer'; drawer: DrawerState }
  | { type: 'closeDrawer' }
  | { type: 'toggleRaw' }
  | { type: 'setPayload'; payload: Record<string, unknown> }

type PresetId = (typeof UI_FIXTURES)[number]['id']

function readInitialFixtureId(): PresetId {
  const params = new URLSearchParams(window.location.search)
  return getUiFixture(params.get('fixture') || DEFAULT_FIXTURE_ID).id
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'openDrawer':
      return { ...state, drawer: action.drawer }
    case 'closeDrawer':
      return { ...state, drawer: null }
    case 'toggleRaw':
      return { ...state, rawOpen: !state.rawOpen }
    case 'setPayload':
      return {
        ...state,
        payload: action.payload,
        rawText: JSON.stringify(action.payload, null, 2),
      }
    default:
      return state
  }
}

function PresetPicker({
  current,
  onSelect,
}: {
  current: string
  onSelect: (id: PresetId) => void
}) {
  return (
    <div className="pt-preview-picker">
      <span className="pt-preview-picker__label">Preview</span>
      {UI_FIXTURES.map((fixture) => {
        const active = fixture.id === current
        return (
          <button
            key={fixture.id}
            type="button"
            onClick={() => onSelect(fixture.id)}
            className="pt-btn"
            data-active={active ? 'true' : 'false'}
          >
            {fixture.label}
          </button>
        )
      })}
    </div>
  )
}

function Preview() {
  const initialFixtureId = useMemo(() => readInitialFixtureId(), [])
  const [fixtureId, setFixtureId] = useState<PresetId>(initialFixtureId)
  const initialFixture = useMemo(() => getUiFixture(initialFixtureId), [initialFixtureId])
  const initial = useMemo<AppState>(
    () => ({
      payload: initialFixture.payload,
      rawText: JSON.stringify(initialFixture.payload, null, 2),
      loading: false,
      error: '',
      drawer: null,
      rawOpen: false,
    }),
    [initialFixture],
  )
  const [state, dispatch] = useReducer(reducer, initial)

  const handleSelect = (id: PresetId) => {
    const fixture = getUiFixture(id)
    setFixtureId(fixture.id)
    window.history.replaceState(null, '', `?fixture=${fixture.id}`)
    dispatch({ type: 'setPayload', payload: fixture.payload })
  }

  return (
    <>
      <PresetPicker current={fixtureId} onSelect={handleSelect} />
      <AppShell
        state={state}
        actions={{
          openDrawer: (title, item) => dispatch({ type: 'openDrawer', drawer: { title, item } }),
          closeDrawer: () => dispatch({ type: 'closeDrawer' }),
          toggleRaw: () => dispatch({ type: 'toggleRaw' }),
          runFollowup: () => {
            /* no-op in preview */
          },
        }}
      />
    </>
  )
}

injectGlobalStyles()
;(window as any).__portalUiFixtures = UI_FIXTURES.map((fixture) => ({
  id: fixture.id,
  label: fixture.label,
  expected: fixture.expected,
}))

const container = document.getElementById('app')
if (container) createRoot(container).render(<Preview />)
