declare const __SQD_INTER_DATA_URL__: string
declare const __SQD_MONO_DATA_URL__: string

const INTER_DATA_URL = typeof __SQD_INTER_DATA_URL__ === 'string' ? __SQD_INTER_DATA_URL__ : ''
const MONO_DATA_URL = typeof __SQD_MONO_DATA_URL__ === 'string' ? __SQD_MONO_DATA_URL__ : ''

export const ACTIVITY_EXPLORER_CSS = String.raw`
@font-face {
  font-family: 'Inter SQD';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('${INTER_DATA_URL}') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono SQD';
  font-style: normal;
  font-weight: 300 800;
  font-display: swap;
  src: url('${MONO_DATA_URL}') format('woff2');
}

/* Tokens follow the SQD Design System Chart Standards (guidelines/charts.html,
   measured 2026-08-24) and src/config/tokens.ts. Ink floors: read values 85%
   (#d1d1dc), labels 68% (#a8a8b1), supporting 62% (#9898a1), decorative only
   below 40% (#52525b). Series order indigo/green/purple/amber/cyan is the
   measured colour-vision-safe ordering; the accent stays out of series fills. */
:root {
  color-scheme: dark;
  --surface: #08090a;
  --surface-raised: #131316;
  --surface-elevated: #1a1a1e;
  --fg: #f7f8f8;
  --fg-value: #d1d1dc;
  --fg-secondary: #a8a8b1;
  --fg-muted: #9898a1;
  --fg-disabled: #52525b;
  --edge: #1c1c20;
  --edge-strong: #242428;
  --edge-hover: #2e2e33;
  --edge-subtle: rgb(255 255 255 / 0.06);
  --pane-ring: rgb(255 255 255 / 0.09);
  --grid: rgb(255 255 255 / 0.055);
  --axis: rgb(255 255 255 / 0.14);
  --accent: #818cf8;
  --accent-hover: #a5b4fc;
  --accent-muted: rgb(129 140 248 / 0.12);
  --accent-subtle: rgb(129 140 248 / 0.06);
  --up: #0891b2;
  --down: #d97706;
  --success-text: #4ade80;
  --success-fill: #16a34a;
  --warning-text: #fbbf24;
  --warning-fill: #f59e0b;
  --warning-muted: rgb(251 191 36 / 0.08);
  --warning-edge: rgb(251 191 36 / 0.18);
  --danger-text: #f87171;
  --danger-fill: #ef4444;
  --danger-muted: rgb(248 113 113 / 0.08);
  --danger-edge: rgb(248 113 113 / 0.18);
  --chart-1: #6366f1;
  --chart-2: #16a34a;
  --chart-3: #8b5cf6;
  --chart-4: #d97706;
  --chart-5: #0891b2;
  --chart-other: rgb(152 152 161 / 0.55);
  --font-sans: 'Inter SQD', Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono SQD', 'JetBrains Mono', ui-monospace, monospace;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --shadow-ring: 0 0 0 1px rgb(255 255 255 / 0.06);
  --shadow-ring-strong: 0 0 0 1px rgb(255 255 255 / 0.10);
  --duration-fast: 100ms;
  --duration-normal: 150ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-soft: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  font-family: var(--font-sans);
  color-scheme: dark;
  accent-color: var(--accent);
  caret-color: var(--accent);
  text-size-adjust: 100%;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; min-width: 280px; background: var(--surface); color: var(--fg); }
body { font: 400 14px/1.57 var(--font-sans); letter-spacing: -0.011em; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
button, input { font: inherit; }
button { color: inherit; }
::selection { background: rgb(99 102 241 / 0.20); color: #f4f4f5; }

.sqd-app { width: 100%; max-width: 1160px; margin: 0 auto; padding: 12px 24px 20px; }
.sqd-shell { display: grid; gap: 14px; }

.sqd-topbar { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--edge); padding-bottom: 10px; }
.sqd-brand { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
.sqd-mark { width: 26px; height: 26px; flex: 0 0 26px; display: grid; place-items: center; overflow: hidden; background: #000; box-shadow: var(--shadow-ring-strong); }
.sqd-mark svg { width: 26px; height: 26px; display: block; }
.sqd-brand-copy { min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.sqd-brand-name { font-size: 13px; line-height: 18px; font-weight: 510; letter-spacing: -0.011em; }
.sqd-brand-subtitle { color: var(--fg-muted); font: 400 11px/16px var(--font-mono); letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.sqd-button { min-height: 30px; border: 0; border-radius: var(--radius-md); padding: 5px 10px; background: var(--surface-elevated); cursor: pointer; color: var(--fg-secondary); font-size: 12.5px; font-weight: 510; letter-spacing: -0.006em; box-shadow: var(--shadow-ring); transition: color var(--duration-normal) var(--ease-soft), background-color var(--duration-normal) var(--ease-soft), box-shadow var(--duration-normal) var(--ease-soft), transform var(--duration-fast) var(--ease-out); }
.sqd-button:hover { background: var(--edge-strong); color: var(--fg); box-shadow: 0 0 0 1px var(--edge-hover); }
.sqd-button:active { transform: scale(0.97); transition-duration: 80ms; }
.sqd-button:focus-visible, .sqd-input:focus-visible, .sqd-sort:focus-visible, summary:focus-visible, .sqd-row-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sqd-button:disabled { color: var(--fg-disabled); cursor: not-allowed; background: var(--surface-raised); }
.sqd-button--primary { background: var(--fg); color: var(--surface); box-shadow: none; }
.sqd-button--primary:hover { background: #fff; color: var(--surface); }
.sqd-followups { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* Masthead: the answer is the headline, the headline value rides the right edge. */
.sqd-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 32px; align-items: start; padding: 4px 0 2px; }
.sqd-eyebrow { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; color: var(--accent); font: 510 11px/16px var(--font-sans); text-transform: uppercase; letter-spacing: 0.12em; }
.sqd-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--success-fill); }
.sqd-dot--warning { background: var(--warning-fill); }
.sqd-dot--danger { background: var(--danger-fill); }
.sqd-title { margin: 2px 0 0; max-width: 30em; font-size: clamp(17px, 2.2vw, 21px); line-height: 1.3; font-weight: 510; letter-spacing: -0.022em; text-wrap: balance; }
.sqd-subtitle { grid-column: 1; max-width: 78ch; margin: 2px 0 0; color: var(--fg-secondary); font-size: 13px; line-height: 20px; }
.sqd-hero-figure { grid-column: 2; grid-row: 2 / span 2; text-align: right; padding-top: 2px; }
.sqd-hero-value { font: 400 30px/1.1 var(--font-sans); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sqd-hero-label { margin-top: 3px; color: var(--fg-secondary); font-size: 12px; line-height: 16px; }
.sqd-context { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 4px; color: var(--fg-muted); font: 400 11px/16px var(--font-mono); letter-spacing: 0.02em; }
.sqd-context span { display: inline-flex; align-items: center; }
.sqd-context span + span::before { content: '·'; margin-right: 8px; color: var(--fg-disabled); }
.sqd-context .sqd-context--warning { color: var(--warning-text); }
.sqd-context .sqd-context--danger { color: var(--danger-text); }

/* Evidence rail: the card-chassis footer ported to product. Full receipt on demand. */
.sqd-receipt { display: flex; align-items: center; justify-content: space-between; gap: 12px 20px; flex-wrap: wrap; border-top: 1px solid var(--edge); padding: 10px 0 2px; }
.sqd-receipt-copy { min-width: 0; display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; }
.sqd-receipt-title { margin: 0; color: var(--fg-secondary); font: 510 11px/16px var(--font-sans); text-transform: uppercase; letter-spacing: 0.09em; }
.sqd-receipt-meta { margin: 0; color: rgb(152 152 161 / 0.9); font: 400 11px/16px var(--font-mono); letter-spacing: 0.02em; overflow-wrap: anywhere; }
.sqd-receipt .sqd-button { min-height: 26px; padding: 3px 8px; font-size: 11.5px; }

.sqd-metrics { display: flex; flex-wrap: wrap; gap: 0; border-block: 1px solid var(--edge); }
.sqd-metric { min-width: 0; flex: 1 1 140px; padding: 12px 18px 12px 0; }
.sqd-metric + .sqd-metric { border-left: 1px solid var(--edge); padding-left: 18px; }
.sqd-metric--primary .sqd-metric-value { color: var(--fg); }
.sqd-metric-label { color: var(--fg-muted); font-size: 11px; line-height: 16px; font-weight: 510; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-metric-value { margin-top: 4px; color: var(--fg); font: 400 21px/28px var(--font-sans); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-metric-subtitle { margin-top: 2px; color: var(--fg-muted); font-size: 11.5px; line-height: 16px; letter-spacing: 0; }

.sqd-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; align-items: start; }
.sqd-card { grid-column: span 12; min-width: 0; overflow: hidden; border-radius: var(--radius-xl); background: var(--surface-raised); box-shadow: 0 0 0 1px var(--pane-ring), inset 0 1px 0 rgb(255 255 255 / 0.05); }
.sqd-card--half { grid-column: span 6; }
.sqd-card--primary { }
.sqd-grid--dashboard:not(.sqd-grid--single) .sqd-card:not(.sqd-card--primary) { grid-column: span 6; }
.sqd-grid--split:not(.sqd-grid--single) .sqd-card:not(.sqd-card--primary) { grid-column: span 6; }
.sqd-grid--chart_focus .sqd-card { grid-column: span 12; }
.sqd-grid--compact { gap: 12px; }
.sqd-grid--compact .sqd-card-head { padding-block: 10px 9px; }
.sqd-grid--compact .sqd-card-body { padding-block: 12px; }
.sqd-card-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 12px 16px 10px; }
.sqd-card-title { margin: 0; font-size: 13px; line-height: 18px; font-weight: 510; letter-spacing: -0.011em; }
.sqd-card-subtitle { max-width: 68ch; margin: 2px 0 0; color: var(--fg-muted); font-size: 12px; line-height: 16px; letter-spacing: 0; }
.sqd-card-body { padding: 4px 16px 14px; min-width: 0; }

.sqd-chart-wrap { position: relative; width: 100%; }
.sqd-chart-range { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(90px, 0.7fr) minmax(90px, 0.7fr) auto auto; align-items: center; gap: 8px; margin-top: 10px; }
.sqd-chart-range-copy { color: var(--fg-muted); font: 400 11px/16px var(--font-mono); }
.sqd-range { width: 100%; accent-color: var(--accent); }
.sqd-chart { display: block; width: 100%; height: auto; overflow: visible; }
.sqd-chart-grid { stroke: var(--grid); stroke-width: 1; }
.sqd-chart-axis { stroke: var(--axis); stroke-width: 1; }
.sqd-chart-zero { stroke: var(--fg-disabled); stroke-width: 1; }
.sqd-chart-line { fill: none; stroke: var(--accent); stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
.sqd-chart-area { fill: var(--accent-subtle); }
.sqd-chart-series-area { opacity: 0.5; }
.sqd-chart-bar { fill: var(--chart-1); }
.sqd-chart-bar--up { fill: var(--up); }
.sqd-chart-bar--down { fill: var(--down); }
.sqd-chart-wick { stroke-width: 1.6; }
.sqd-chart-wick--up { stroke: var(--up); }
.sqd-chart-wick--down { stroke: var(--down); }
.sqd-chart-up { fill: var(--up); }
.sqd-chart-down { fill: var(--down); }
.sqd-chart-open { fill: none; stroke-width: 1.6; }
.sqd-chart-open.sqd-chart-up { stroke: var(--up); }
.sqd-chart-open.sqd-chart-down { stroke: var(--down); }
.sqd-chart-volume { opacity: 0.55; }
.sqd-chart-volume--up { fill: var(--up); }
.sqd-chart-volume--down { fill: var(--down); }
.sqd-chart-label { fill: var(--fg-value); font: 400 11px var(--font-mono); font-variant-numeric: tabular-nums; }
.sqd-chart-band-label { fill: var(--fg-muted); font: 510 9px var(--font-sans); letter-spacing: 0.1em; }
.sqd-chart-axis-title { fill: var(--fg-secondary); font: 400 10.5px var(--font-sans); letter-spacing: -0.006em; }
.sqd-chart-last-line { stroke: rgb(129 140 248 / 0.45); stroke-width: 1.5; stroke-dasharray: 3 4; }
.sqd-chart-last-pill { fill: var(--accent); }
.sqd-chart-last-value { fill: var(--surface); font: 510 11px/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.sqd-chart-crosshair { stroke: var(--fg-secondary); stroke-width: 1; stroke-dasharray: 2 3; pointer-events: none; opacity: 0.7; }
.sqd-chart-hit { fill: transparent; pointer-events: all; outline: none; }
.sqd-chart-hit:focus-visible { fill: var(--accent-subtle); stroke: var(--accent); stroke-width: 1; }
.sqd-chart-tooltip { position: absolute; z-index: 2; top: 8px; max-width: min(360px, 80%); transform: translateX(-50%); border: 1px solid var(--edge-strong); border-radius: var(--radius-md); padding: 7px 9px; background: var(--surface); color: var(--fg-value); box-shadow: 0 12px 28px rgb(0 0 0 / 0.36); font: 400 11px/16px var(--font-mono); pointer-events: none; }
.sqd-chart-legend { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-bottom: 8px; }
.sqd-chart-legend-item { min-height: 28px; display: inline-flex; align-items: center; gap: 7px; border: 0; border-radius: var(--radius-md); padding: 4px 9px; background: transparent; color: var(--fg); box-shadow: var(--shadow-ring); cursor: pointer; font: 400 12px/16px var(--font-sans); letter-spacing: -0.006em; }
.sqd-chart-legend-item[aria-pressed='false'] { color: var(--fg-muted); text-decoration: line-through; }
.sqd-chart-legend-item[aria-pressed='false'] .sqd-chart-legend-swatch { opacity: 0.3; }
.sqd-chart-legend-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sqd-chart-legend-swatch { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 2px; }
.sqd-chart-empty { min-height: 220px; display: grid; place-items: center; color: var(--fg-muted); text-align: center; }

.sqd-candle-terminal { position: relative; width: 100%; }
.sqd-candle-readout { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; padding: 2px 2px 10px; font: 400 11.5px/16px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--fg-value); }
.sqd-candle-readout-time { color: var(--fg-secondary); }
.sqd-candle-readout-pair { display: inline-flex; align-items: baseline; gap: 5px; }
.sqd-candle-readout-key { color: var(--fg-muted); font-size: 10.5px; }
.sqd-candle-readout-value[data-direction='up'] { color: var(--up); }
.sqd-candle-readout-value[data-direction='down'] { color: var(--down); }
.sqd-candle-readout-flag { color: var(--fg-muted); }
.sqd-candle-chart { position: relative; width: 100%; height: 340px; }
.sqd-candle-canvas { position: absolute; inset: 0; }
.sqd-chart-hits { position: absolute; inset: 0 0 26px 0; z-index: 2; }
button.sqd-chart-hit { position: absolute; top: 0; height: 100%; margin: 0; border: 0; border-radius: 3px; padding: 0; background: transparent; cursor: pointer; outline: none; }
button.sqd-chart-hit:focus-visible { background: var(--accent-subtle); box-shadow: inset 0 0 0 1.5px var(--accent); }
button.sqd-chart-hit[aria-pressed='true'] { background: rgb(129 140 248 / 0.08); box-shadow: inset 0 0 0 1px rgb(129 140 248 / 0.35); }
.sqd-candle-pill { position: absolute; right: 0; z-index: 3; transform: translateY(-50%); border-radius: 5px; padding: 3px 7px; background: var(--accent); color: var(--surface); font: 510 11px/1 var(--font-mono); font-variant-numeric: tabular-nums; pointer-events: none; }
.sqd-chart-volume-caption { position: absolute; left: 2px; z-index: 2; color: var(--fg-muted); font: 510 9px/12px var(--font-sans); letter-spacing: 0.1em; pointer-events: none; }
.sqd-candle-chart .sqd-chart-tooltip { z-index: 4; }
@media (max-width: 520px) {
  .sqd-candle-chart { height: 240px; }
}

.sqd-ranked { display: grid; }
.sqd-ranked-row { min-height: 38px; display: grid; grid-template-columns: minmax(110px, 0.9fr) minmax(120px, 2fr) auto; align-items: center; gap: 12px; border-bottom: 1px solid var(--grid); }
.sqd-ranked-row:last-child { border-bottom: 0; }
.sqd-ranked-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); font-size: 12.5px; font-weight: 510; letter-spacing: -0.006em; }
.sqd-ranked-label--id { font: 400 12px var(--font-mono); letter-spacing: 0.01em; }
.sqd-ranked-track { height: 8px; overflow: hidden; background: var(--surface-elevated); border-radius: 1.5px; }
.sqd-ranked-fill { height: 100%; background: var(--chart-1); border-radius: 1.5px; }
.sqd-ranked-value { color: var(--fg-value); font: 400 12.5px/18px var(--font-mono); font-variant-numeric: tabular-nums; }

.sqd-table-tools { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
.sqd-input { width: min(100%, 320px); min-height: 32px; border: 1px solid var(--edge); border-radius: var(--radius-md); padding: 5px 10px; background: var(--surface); color: var(--fg); font-size: 12.5px; transition: border-color var(--duration-normal) var(--ease-soft), box-shadow var(--duration-normal) var(--ease-soft); }
.sqd-input::placeholder { color: var(--fg-disabled); }
.sqd-input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-muted); }
.sqd-table-wrap { width: 100%; overflow: auto; }
.sqd-table { width: 100%; min-width: 640px; border-collapse: collapse; font-size: 12.5px; line-height: 18px; }
.sqd-table th, .sqd-table td { min-width: 96px; max-width: 260px; height: 38px; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--grid); text-align: left; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-table th { position: sticky; top: 0; z-index: 1; background: var(--surface-raised); color: var(--fg-muted); border-bottom: 1px solid var(--axis); font: 510 12px/16px var(--font-sans); letter-spacing: normal; }
.sqd-table tr:last-child td { border-bottom: 0; }
.sqd-table tbody tr { transition: background-color var(--duration-normal) var(--ease-soft); }
.sqd-table tbody tr:hover, .sqd-table tbody tr:focus-within { background: var(--surface-elevated); }
.sqd-table tbody tr[data-selected='true'] { background: var(--accent-muted); box-shadow: inset 2px 0 0 var(--accent); }
.sqd-table td { color: var(--fg-secondary); }
.sqd-table td[data-align='right'] { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--fg-value); font-size: 12px; }
.sqd-table th[data-align='right'] { text-align: right; }
.sqd-table td[data-signed='positive'] { color: var(--up); font-weight: 700; }
.sqd-table td[data-signed='negative'] { color: var(--down); font-weight: 700; }
.sqd-sort, .sqd-row-button { width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: inherit; cursor: pointer; }
.sqd-row-button { color: var(--fg); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.01em; }
.sqd-hash { font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; font-variant-ligatures: none; font-feature-settings: 'zero' 1; letter-spacing: 0.01em; }

.sqd-timeline { display: grid; }
.sqd-event { min-height: 46px; display: grid; grid-template-columns: 74px 8px minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 9px 0; border-bottom: 1px solid var(--grid); }
.sqd-event:last-child { border-bottom: 0; }
.sqd-event-time { order: -1; color: var(--fg-value); font: 400 12px/18px var(--font-mono); letter-spacing: 0.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sqd-event-dot { width: 6px; height: 6px; margin-top: 6px; border-radius: 50%; background: var(--edge-hover); }
.sqd-event-dot--in { background: var(--up); }
.sqd-event-dot--out { background: var(--down); }
.sqd-event-title { font-size: 12.5px; line-height: 18px; font-weight: 510; letter-spacing: -0.006em; }
.sqd-event-subtitle { color: var(--fg-muted); font: 400 11.5px/16px var(--font-mono); letter-spacing: 0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-event-value { text-align: right; font: 700 12px/18px var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sqd-event-value--in { color: var(--up); }
.sqd-event-value--out { color: var(--down); }
.sqd-event-value--flat { color: var(--fg-value); font-weight: 400; }

.sqd-stat-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.sqd-stat { min-height: 38px; display: flex; justify-content: space-between; gap: 12px; align-items: center; border-bottom: 1px solid var(--grid); }
.sqd-stat-label { color: var(--fg-secondary); font-size: 12.5px; }
.sqd-stat-value { color: var(--fg-value); font: 400 12.5px/18px var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; }
.sqd-notices { display: grid; gap: 8px; }
.sqd-notice { border-left: 2px solid var(--warning-fill); padding: 8px 12px; background: var(--warning-muted); color: var(--warning-text); font-size: 12px; line-height: 18px; }
.sqd-notice--danger { border-left-color: var(--danger-fill); background: var(--danger-muted); color: var(--danger-text); }
.sqd-display-limit { margin: 10px 0 0; border-left: 2px solid var(--warning-fill); padding: 7px 10px; background: var(--warning-muted); color: var(--warning-text); font-size: 12px; line-height: 18px; }
.sqd-empty { min-height: 220px; display: grid; place-items: center; border: 1px dashed var(--edge-strong); border-radius: var(--radius-xl); padding: 28px; text-align: center; }
.sqd-empty h2 { margin: 0 0 6px; font-size: 16px; line-height: 24px; font-weight: 510; letter-spacing: -0.022em; }
.sqd-empty p { max-width: 600px; margin: 0; color: var(--fg-secondary); }
.sqd-skeleton { position: relative; overflow: hidden; min-height: 64px; background: var(--surface-raised); border-radius: var(--radius-lg); }
.sqd-skeleton::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.05), transparent); animation: sqd-shimmer 1.2s infinite; }
@keyframes sqd-shimmer { to { transform: translateX(100%); } }
.sqd-raw { border-top: 1px solid var(--edge); overflow: hidden; }
.sqd-raw summary { min-height: 36px; cursor: pointer; padding: 9px 0; color: var(--fg-muted); font-size: 12.5px; font-weight: 510; }
.sqd-raw summary:hover { color: var(--fg-secondary); }
.sqd-raw pre { max-height: 360px; margin: 0; overflow: auto; border: 1px solid var(--edge); border-radius: var(--radius-lg); padding: 14px; background: var(--surface); color: var(--fg-value); font: 400 12px/1.7 var(--font-mono); letter-spacing: 0; white-space: pre-wrap; word-break: break-word; }
.sqd-dialog { width: min(680px, calc(100vw - 28px)); max-height: min(720px, calc(100vh - 28px)); overflow: hidden; border: 1px solid var(--edge-strong); border-radius: var(--radius-xl); padding: 0; background: var(--surface-raised); color: var(--fg); box-shadow: 0 20px 44px -20px rgb(0 0 0 / 0.7); }
.sqd-dialog::backdrop { background: rgb(0 0 0 / 0.60); }
.sqd-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--edge); }
.sqd-dialog-title { margin: 0; font-size: 13px; line-height: 18px; font-weight: 510; }
.sqd-dialog-body { max-height: 620px; overflow: auto; padding: 16px; }
.sqd-dialog pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: var(--fg-value); font: 400 12px/1.7 var(--font-mono); }
.sqd-dialog-meta { margin: 0 0 12px; color: var(--fg-muted); font: 400 11px/16px var(--font-mono); overflow-wrap: anywhere; }
.sqd-footer { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0 0; border-top: 1px solid var(--edge); color: rgb(152 152 161 / 0.9); font: 400 11px/16px var(--font-mono); letter-spacing: 0.04em; }
.sqd-visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
.sqd-table-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 10px; }
.sqd-table-pagination .sqd-brand-subtitle { font-family: var(--font-mono); }

@media (max-width: 820px) {
  .sqd-app { padding-inline: 16px; }
  .sqd-hero { grid-template-columns: 1fr; }
  .sqd-hero-figure { grid-column: 1; grid-row: auto; text-align: left; padding-top: 6px; }
  .sqd-card--half { grid-column: span 12; }
  .sqd-grid--dashboard .sqd-card:not(.sqd-card--primary), .sqd-grid--split .sqd-card:not(.sqd-card--primary) { grid-column: span 12; }
  .sqd-stat-list { grid-template-columns: 1fr; }
  .sqd-chart-range { grid-template-columns: 1fr 1fr; }
  .sqd-chart-range-copy { grid-column: 1 / -1; }
}

@media (max-width: 520px) {
  .sqd-app { padding: 8px 12px 16px; }
  .sqd-topbar { min-height: 40px; align-items: center; }
  .sqd-brand-subtitle { max-width: 148px; }
  .sqd-actions { gap: 4px; }
  .sqd-hero-value { font-size: 26px; }
  .sqd-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .sqd-metric + .sqd-metric { border-left: 0; padding-left: 0; }
  .sqd-metric:nth-child(even) { border-left: 1px solid var(--edge); padding-left: 16px; }
  .sqd-metric-value { font-size: 19px; }
  .sqd-card-head { padding-inline: 12px; }
  .sqd-card-body { padding-inline: 12px; }
  .sqd-input { font-size: 16px; }
  .sqd-table-pagination { justify-content: space-between; }
  .sqd-event { grid-template-columns: 8px minmax(0, 1fr) auto; }
  .sqd-event-time { order: 0; grid-column: 2 / -1; }
  .sqd-ranked-row { grid-template-columns: minmax(88px, 0.8fr) minmax(80px, 1.2fr) auto; gap: 8px; }
  .sqd-receipt, .sqd-footer { display: grid; gap: 4px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
`
