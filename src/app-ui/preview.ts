import { APP_FIXTURES } from './fixtures.js'
import { type ExplorerState, renderExplorer } from './view.js'

const root = document.getElementById('app')
if (!root) throw new Error('Preview root missing')
const picker = document.createElement('nav')
picker.className = 'sqd-app sqd-actions'
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
    runFollowup(intent) {
      document.body.dataset.lastAction = intent
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
