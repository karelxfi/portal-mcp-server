/*
 * What the Explorer's chart surface actually implements.
 *
 * The tool contract tells a model what it can offer the reader, and for two
 * releases it offered a PNG export and a visual switch that were never built.
 * This is the app's own statement of what is there, it is what the app reads
 * when it decides whether to draw a control, and `test:app-contract` holds the
 * server's declaration against it. A control that is added or removed here
 * without the contract following fails the gate.
 */

export const EXPLORER_CHART_CAPABILITIES = {
  /** Hover and focus put the point under the pointer in the readout. */
  hover: true,
  crosshair: true,
  snapToData: true,
  /** The time axis only. Nothing rescales the value axis. */
  zoomAxis: 'x',
  /** No drag-a-box-to-zoom. */
  brush: false,
  /** A multi-series chart can switch a series off from the legend. */
  legendToggle: true,
  /** Every control the range toolbar offers, and nothing it does not. */
  toolbarActions: ['reset_zoom', 'range_presets'],
  /** Below this many points there is nothing to zoom into, so nothing is offered. */
  minimumPointsForZoom: 9,
} as const

export type ExplorerToolbarAction = (typeof EXPLORER_CHART_CAPABILITIES.toolbarActions)[number]
