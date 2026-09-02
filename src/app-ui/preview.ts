import { APP_FIXTURES } from './fixtures.js'
import { type ExplorerState, renderExplorer } from './view.js'

const root = document.getElementById('app')
if (!root) throw new Error('Preview root missing')
const params = new URLSearchParams(location.search)
const picker = document.createElement('nav')
picker.className = 'sqd-app sqd-actions sqd-preview-picker'
picker.setAttribute('aria-label', 'Preview fixtures')
if (params.get('picker') === '0') picker.hidden = true
document.body.prepend(picker)

/* Preview controls, all through the query string so screenshots are
   reproducible: fixture, mode=inline|fullscreen (default fullscreen, the
   workspace every fixture assertion targets), theme=light|dark, host=claude
   (applies Claude's published style variables so host theming is visible
   without a host), busy=1 (a follow-up in flight), error=1 (a failed
   follow-up banner over the last result). */
const mode = params.get('mode') === 'inline' ? 'inline' : 'fullscreen'
const theme = params.get('theme')
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme

const CLAUDE_VARIABLES: Record<string, string> = {
  '--color-background-primary': 'light-dark(#FFFFFF, #30302E)',
  '--color-background-secondary': 'light-dark(#F5F4ED, #262624)',
  '--color-background-tertiary': 'light-dark(#FAF9F5, #141413)',
  '--color-background-info': 'light-dark(#D6E4F6, #253E5F)',
  '--color-background-danger': 'light-dark(#F7ECEC, #602A28)',
  '--color-background-success': 'light-dark(#E9F1DC, #1B4614)',
  '--color-background-warning': 'light-dark(#F6EEDF, #483A0F)',
  '--color-text-primary': 'light-dark(#141413, #FAF9F5)',
  '--color-text-secondary': 'light-dark(#3D3D3A, #C2C0B6)',
  '--color-text-tertiary': 'light-dark(#73726C, #9C9A92)',
  '--color-text-info': 'light-dark(#3266AD, #80AADD)',
  '--color-text-danger': 'light-dark(#7F2C28, #EE8884)',
  '--color-text-success': 'light-dark(#265B19, #7AB948)',
  '--color-text-warning': 'light-dark(#5A4815, #D1A041)',
  '--color-border-primary': 'light-dark(rgb(31 30 29 / 0.4), rgb(222 220 209 / 0.4))',
  '--color-border-secondary': 'light-dark(rgb(31 30 29 / 0.3), rgb(222 220 209 / 0.3))',
  '--color-border-tertiary': 'light-dark(rgb(31 30 29 / 0.15), rgb(222 220 209 / 0.15))',
  '--color-border-info': '#4682D5',
  '--color-border-danger': 'light-dark(#A73D39, #CD5C58)',
  '--color-border-success': 'light-dark(#437426, #599130)',
  '--color-border-warning': 'light-dark(#805C1F, #A87829)',
  '--border-radius-xs': '4px',
  '--border-radius-sm': '6px',
  '--border-radius-md': '8px',
  '--border-radius-xl': '12px',
}
if (params.get('host') === 'claude') {
  for (const [name, value] of Object.entries(CLAUDE_VARIABLES)) document.documentElement.style.setProperty(name, value)
}

function show(name: string) {
  const state: ExplorerState = {
    payload: APP_FIXTURES[name] ?? null,
    rawText: '',
    loading: params.get('busy') === '1',
    error:
      params.get('error') === '1'
        ? 'SQD is busy and could not start this follow-up inside the bounded wait budget.'
        : '',
    currentArgs: { duration: '24h' },
    displayMode: mode,
    availableDisplayModes: ['inline', 'fullscreen'],
    historyIndex: 1,
    historyLength: 3,
  }
  renderExplorer(root!, state, {
    runFollowup(intent, target) {
      document.body.dataset.lastAction = intent
      if (intent === 'show_raw' && target) {
        const value = target
          .split('.')
          .reduce<unknown>(
            (current, key) =>
              current && typeof current === 'object' && !Array.isArray(current)
                ? (current as Record<string, unknown>)[key]
                : undefined,
            state.payload,
          )
        const pre = document.querySelector<HTMLPreElement>('.sqd-raw pre')
        const details = document.querySelector<HTMLDetailsElement>('.sqd-raw')
        if (pre && details) {
          pre.textContent = JSON.stringify(value, null, 2)
          details.open = true
        }
      }
    },
    requestFullscreen() {
      document.body.dataset.fullscreenRequested = 'true'
    },
    requestInline() {
      document.body.dataset.inlineRequested = 'true'
    },
    goBack() {
      document.body.dataset.historyAction = 'back'
    },
    goForward() {
      document.body.dataset.historyAction = 'forward'
    },
    exportEvidence(format) {
      document.body.dataset.exportFormat = format
    },
    openLink(url) {
      document.body.dataset.openedLink = url
    },
  })
  document.body.dataset.fixture = name
  document.body.dataset.mode = mode
}

for (const name of Object.keys(APP_FIXTURES)) {
  const button = document.createElement('button')
  button.className = 'sqd-button'
  button.type = 'button'
  button.textContent = name
  button.addEventListener('click', () => show(name))
  picker.append(button)
}
const requested = params.get('fixture')
show(requested && APP_FIXTURES[requested] ? requested : 'hyperliquid')
