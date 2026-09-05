import { EXPLORER_CHART_CAPABILITIES, type ExplorerToolbarAction } from '../capabilities.js'
import { element, withFocusKey } from '../common.js'

/*
 * One zoom-and-pan vocabulary for every chart. Candles, lines, areas, and bars
 * all drive lightweight-charts' logical range through this. It is view-only:
 * narrowing the view never changes which rows the tool returned, so _coverage
 * and the evidence receipt keep saying exactly what the tool said.
 */
export type RangeWindow = { from: number; to: number }

export type RangeController = {
  /* Lowest allowed `from` and highest allowed `to`. lightweight-charts places
     index i at logical i and pads half a slot at each end, so a terminal over
     n points passes -0.5 and n - 0.5. `total` closes the gap: the padding
     either end follows from the three, so the controls can count points rather
     than guess from the span. */
  min: number
  max: number
  total: number
  minimumSpan: number
  read: () => RangeWindow
  write: (window: RangeWindow) => void
}

/** Half a slot at each end, as lightweight-charts lays a series out. */
function edgePad(controller: RangeController): number {
  return controller.total > 1 ? (controller.max - controller.min - (controller.total - 1)) / 2 : 0
}

/** How many of the returned points a window actually covers. */
export function pointsInWindow(window: RangeWindow, controller: RangeController): number {
  const origin = controller.min + edgePad(controller)
  const first = Math.max(0, Math.ceil(window.from - origin - 1e-6))
  const last = Math.min(controller.total - 1, Math.floor(window.to - origin + 1e-6))
  return Math.max(0, last - first + 1)
}

/** The window that ends on the last point and covers `count` of them. */
export function windowOfLast(count: number, controller: RangeController): RangeWindow {
  const wanted = Math.min(Math.max(count, 1), controller.total)
  return clampWindow({ from: controller.max - (wanted - 1) - 2 * edgePad(controller), to: controller.max }, controller)
}

export function clampWindow(window: RangeWindow, controller: RangeController): RangeWindow {
  const limit = controller.max - controller.min
  const span = Math.min(Math.max(window.to - window.from, Math.min(controller.minimumSpan, limit)), limit)
  const from = Math.max(controller.min, Math.min(window.from, controller.max - span))
  return { from, to: from + span }
}

/** `anchor` is where the pointer sits in the window, 0 at the left edge and 1 at the right. */
export function zoomWindow(
  window: RangeWindow,
  anchor: number,
  factor: number,
  controller: RangeController,
): RangeWindow {
  const span = window.to - window.from
  const pivot = window.from + span * anchor
  const next = span * factor
  return clampWindow({ from: pivot - next * anchor, to: pivot + next * (1 - anchor) }, controller)
}

export function panWindow(window: RangeWindow, fractionOfSpan: number, controller: RangeController): RangeWindow {
  const shift = (window.to - window.from) * fractionOfSpan
  return clampWindow({ from: window.from + shift, to: window.to + shift }, controller)
}

const ZOOM_STEP = 1.25

const DRAG_THRESHOLD = 4

/*
 * Wheel, drag and keyboard all move the same window. The surface sits above
 * the plot and already carries the per-point hit targets, so a drag has to be
 * told apart from a click: nothing moves until the pointer travels far enough
 * to mean it, and the click that ends a real drag is swallowed so panning
 * across a point never selects it as evidence.
 */
export function attachRangeGestures(
  surface: HTMLElement,
  controller: RangeController,
  onChange: () => void,
): () => void {
  const apply = (next: RangeWindow) => {
    controller.write(next)
    onChange()
  }
  const anchorOf = (clientX: number) => {
    const box = surface.getBoundingClientRect()
    return box.width > 0 ? Math.min(1, Math.max(0, (clientX - box.left) / box.width)) : 0.5
  }

  /*
   * The chart lives inside a page the reader is scrolling, so a bare wheel has
   * to keep scrolling it. Zoom takes alt or the platform meta key, the way an
   * embedded map does; a sideways wheel pans, but only once the view is
   * already narrower than the data, where it cannot be a mis-aimed page
   * scroll. ctrl+wheel is left to the browser's own page zoom.
   */
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return
    const window = controller.read()
    const zoomed = window.to - window.from < controller.max - controller.min - 1e-6
    if (event.altKey || event.metaKey) {
      apply(zoomWindow(window, anchorOf(event.clientX), event.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, controller))
    } else if (zoomed && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) {
      apply(panWindow(window, (event.shiftKey ? event.deltaY : event.deltaX) / 400, controller))
    } else {
      return
    }
    event.preventDefault()
  }

  let origin: { x: number; window: RangeWindow; moved: boolean; pointerId: number } | null = null
  let swallowClick = false
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return
    origin = { x: event.clientX, window: controller.read(), moved: false, pointerId: event.pointerId }
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!origin || event.pointerId !== origin.pointerId) return
    const box = surface.getBoundingClientRect()
    if (!box.width) return
    const travelled = event.clientX - origin.x
    if (!origin.moved) {
      if (Math.abs(travelled) < DRAG_THRESHOLD) return
      origin.moved = true
      surface.classList.add('sqd-chart-panning')
      try {
        surface.setPointerCapture(event.pointerId)
      } catch {
        /* Capture is a convenience; the document-level listeners still track the drag. */
      }
    }
    apply(clampWindow(panWindow(origin.window, -travelled / box.width, controller), controller))
    event.preventDefault()
  }
  const onPointerUp = (event: PointerEvent) => {
    if (!origin || event.pointerId !== origin.pointerId) return
    swallowClick = origin.moved
    if (origin.moved) {
      surface.classList.remove('sqd-chart-panning')
      try {
        surface.releasePointerCapture(event.pointerId)
      } catch {
        /* Already released, or never captured. */
      }
    }
    origin = null
  }
  const onClick = (event: MouseEvent) => {
    if (!swallowClick) return
    swallowClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const window = controller.read()
    const full = { from: controller.min, to: controller.max }
    const moves: Record<string, () => RangeWindow> = {
      ArrowLeft: () => panWindow(window, -0.2, controller),
      ArrowRight: () => panWindow(window, 0.2, controller),
      ArrowUp: () => zoomWindow(window, 0.5, 1 / ZOOM_STEP, controller),
      ArrowDown: () => zoomWindow(window, 0.5, ZOOM_STEP, controller),
      '+': () => zoomWindow(window, 0.5, 1 / ZOOM_STEP, controller),
      '=': () => zoomWindow(window, 0.5, 1 / ZOOM_STEP, controller),
      '-': () => zoomWindow(window, 0.5, ZOOM_STEP, controller),
      _: () => zoomWindow(window, 0.5, ZOOM_STEP, controller),
      Home: () => full,
      '0': () => full,
    }
    const move = moves[event.key]
    if (!move) return
    apply(move())
    event.preventDefault()
  }

  surface.addEventListener('wheel', onWheel, { passive: false })
  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('pointermove', onPointerMove)
  surface.addEventListener('pointerup', onPointerUp)
  surface.addEventListener('pointercancel', onPointerUp)
  surface.addEventListener('click', onClick, true)
  surface.addEventListener('keydown', onKeyDown)
  return () => {
    surface.removeEventListener('wheel', onWheel)
    surface.removeEventListener('pointerdown', onPointerDown)
    surface.removeEventListener('pointermove', onPointerMove)
    surface.removeEventListener('pointerup', onPointerUp)
    surface.removeEventListener('pointercancel', onPointerUp)
    surface.removeEventListener('click', onClick, true)
    surface.removeEventListener('keydown', onKeyDown)
  }
}

/*
 * The toolbar is the visible half of the same window: presets jump to a share
 * of the returned points, Reset returns to all of them, and the status line
 * says how many of the returned points the view currently covers. It reports
 * the view, never the query, so it can never be read as a claim about how much
 * of the chain was searched.
 */
export function chartRangeToolbar(
  controller: RangeController,
  totalPoints: number,
  focusPrefix: string,
  onChange?: () => void,
  /* A chart whose logical slots are not all points counts its own. */
  shownInWindow: (window: RangeWindow) => number = (window) => pointsInWindow(window, controller),
): { node: HTMLElement; sync: () => void } {
  const node = element('div', 'sqd-chart-toolbar')
  node.setAttribute('role', 'group')
  node.setAttribute('aria-label', 'Chart range')
  node.title =
    'Drag the chart to pan. Hold alt or command with the wheel to zoom. From the chart, arrow keys pan, + and - zoom, Home resets.'
  const status = element('span', 'sqd-chart-range-status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const presets: Array<{ node: HTMLButtonElement; count: number }> = []
  const offers = (action: ExplorerToolbarAction) => EXPLORER_CHART_CAPABILITIES.toolbarActions.includes(action)

  for (const { label, share } of offers('range_presets')
    ? [
        { label: 'All', share: 1 },
        { label: 'Last half', share: 0.5 },
        { label: 'Last quarter', share: 0.25 },
      ]
    : []) {
    const count = share === 1 ? totalPoints : Math.ceil(totalPoints * share)
    if (share !== 1 && (count < 2 || count >= totalPoints)) continue
    const button = withFocusKey(
      element('button', 'sqd-chart-range-preset', label) as HTMLButtonElement,
      `${focusPrefix}-${label}`,
    )
    button.type = 'button'
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => {
      controller.write(windowOfLast(count, controller))
      sync()
      onChange?.()
    })
    node.append(button)
    presets.push({ node: button, count })
  }

  const reset = withFocusKey(
    element('button', 'sqd-chart-range-reset', 'Reset view') as HTMLButtonElement,
    `${focusPrefix}-reset`,
  )
  reset.type = 'button'
  reset.addEventListener('click', () => {
    controller.write({ from: controller.min, to: controller.max })
    sync()
    onChange?.()
  })
  if (offers('reset_zoom')) node.append(reset)
  node.append(status)

  const sync = () => {
    const shown = shownInWindow(controller.read())
    const full = shown >= totalPoints
    reset.disabled = full
    /* lightweight-charts pins the right edge, so a preset can settle a point
       either side of what it asked for; that is still the preset in force. */
    for (const preset of presets) preset.node.setAttribute('aria-pressed', String(Math.abs(preset.count - shown) <= 1))
    status.textContent = full ? `${totalPoints} points` : `${shown} of ${totalPoints} points in view`
  }
  sync()
  return { node, sync }
}
