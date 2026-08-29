import { APP_FIXTURES } from './fixtures.js'
import { type ExplorerState, renderExplorer } from './view.js'

const root = document.getElementById('app')
if (!root) throw new Error('Preview root missing')
const picker = document.createElement('nav')
picker.className = 'sqd-app sqd-actions sqd-preview-picker'
picker.setAttribute('aria-label', 'Preview fixtures')
document.body.prepend(picker)

function show(name: string) {
  const state: ExplorerState = {
    payload: APP_FIXTURES[name] ?? null,
    rawText: '',
    loading: false,
    error: '',
    currentArgs: { duration: '24h' },
  }
  renderExplorer(root!, state, {
    runFollowup(intent, target) {
      document.body.dataset.lastAction = intent
      if (intent === 'show_raw' && target) {
        const value = target
          .split('.')
          .reduce<unknown>((current, key) => current && typeof current === 'object' && !Array.isArray(current)
            ? (current as Record<string, unknown>)[key]
            : undefined, state.payload)
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
  })
  document.body.dataset.fixture = name
}

for (const name of Object.keys(APP_FIXTURES)) {
  const button = document.createElement('button')
  button.className = 'sqd-button'
  button.type = 'button'
  button.textContent = name
  button.addEventListener('click', () => show(name))
  picker.append(button)
}
const requested = new URLSearchParams(location.search).get('fixture')
show(requested && APP_FIXTURES[requested] ? requested : 'hyperliquid')
