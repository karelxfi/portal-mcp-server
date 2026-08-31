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

:root {
  color-scheme: dark;
  --surface: #08090a;
  --surface-raised: #131316;
  --surface-elevated: #1a1a1e;
  --fg: #f7f8f8;
  --fg-secondary: #a8a8b1;
  --fg-muted: #9898a1;
  --fg-disabled: #52525b;
  --edge: #1c1c20;
  --edge-strong: #242428;
  --edge-hover: #2e2e33;
  --edge-subtle: rgb(255 255 255 / 0.06);
  --accent: #818cf8;
  --accent-hover: #a5b4fc;
  --accent-muted: rgb(129 140 248 / 0.12);
  --accent-subtle: rgb(129 140 248 / 0.06);
  --accent-ring: rgb(99 102 241 / 0.30);
  --success-text: #4ade80;
  --success-fill: #16a34a;
  --success-muted: rgb(74 222 128 / 0.10);
  --success-edge: rgb(74 222 128 / 0.18);
  --warning-text: #fbbf24;
  --warning-fill: #f59e0b;
  --warning-muted: rgb(251 191 36 / 0.10);
  --warning-edge: rgb(251 191 36 / 0.18);
  --danger-text: #f87171;
  --danger-fill: #ef4444;
  --danger-muted: rgb(248 113 113 / 0.10);
  --danger-edge: rgb(248 113 113 / 0.18);
  --chart-1: #818cf8;
  --chart-2: #fbbf24;
  --chart-3: #22d3ee;
  --chart-4: #f79ce0;
  --chart-5: #4ade80;
  --chart-other: rgb(152 152 161 / 0.38);
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
body { font: 400 14px/1.57 var(--font-sans); letter-spacing: -0.011em; text-rendering: optimizeLegibility; }
button, input { font: inherit; }
button { color: inherit; }
::selection { background: rgb(99 102 241 / 0.20); color: #f4f4f5; }

.sqd-app { width: 100%; max-width: 1280px; margin: 0 auto; padding: 16px 24px 24px; }
.sqd-shell { display: grid; gap: 16px; }
.sqd-topbar { min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--edge-subtle); }
.sqd-brand { display: inline-flex; align-items: center; gap: 12px; min-width: 0; }
.sqd-mark { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; overflow: hidden; background: #000; box-shadow: var(--shadow-ring-strong); }
.sqd-mark svg { width: 32px; height: 32px; display: block; }
.sqd-brand-copy { min-width: 0; }
.sqd-brand-name { font-size: 14px; line-height: 20px; font-weight: 510; letter-spacing: -0.011em; }
.sqd-brand-subtitle { color: var(--fg-muted); font-size: 12px; line-height: 16px; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.sqd-button { min-height: 36px; border: 0; border-radius: var(--radius-md); padding: 7px 12px; background: var(--surface-raised); cursor: pointer; font-weight: 510; letter-spacing: -0.011em; box-shadow: var(--shadow-ring); transition: color var(--duration-normal) var(--ease-soft), background-color var(--duration-normal) var(--ease-soft), box-shadow var(--duration-normal) var(--ease-soft), transform var(--duration-fast) var(--ease-out); }
.sqd-button:hover { background: var(--surface-elevated); color: var(--fg); box-shadow: 0 0 0 1px var(--edge-hover); }
.sqd-button:active { transform: scale(0.97); transition-duration: 80ms; }
.sqd-button:focus-visible, .sqd-input:focus-visible, .sqd-sort:focus-visible, summary:focus-visible, .sqd-row-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sqd-button:disabled { color: var(--fg-disabled); cursor: not-allowed; }
.sqd-button--primary { background: var(--fg); color: var(--surface); box-shadow: none; }
.sqd-button--primary:hover { background: #fff; color: var(--surface); box-shadow: rgba(0, 0, 0, 0.08) 0 0 1px, rgba(0, 0, 0, 0.07) 0 1px 1px, rgba(0, 0, 0, 0.04) 0 3px 2px, rgba(0, 0, 0, 0.01) 0 5px 2px; }

.sqd-workspace-strip { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--edge-subtle); color: var(--fg-secondary); }
.sqd-workspace-name { color: var(--fg); font-size: 12px; font-weight: 510; }
.sqd-workspace-capabilities { display: flex; gap: 6px 16px; flex-wrap: wrap; justify-content: flex-end; color: var(--fg-muted); font: 400 11px/16px var(--font-mono); }
.sqd-workspace-capabilities span::before { content: ''; width: 4px; height: 4px; display: inline-block; margin: 0 7px 2px 0; border-radius: 50%; background: var(--accent); }

.sqd-hero { border-bottom: 1px solid var(--edge-subtle); padding: 16px 0 20px; }
.sqd-eyebrow { display: flex; align-items: center; gap: 8px; color: var(--fg-muted); font: 500 11px/16px var(--font-mono); text-transform: uppercase; letter-spacing: 0.12em; }
.sqd-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--success-fill); }
.sqd-dot--warning { background: var(--warning-fill); }
.sqd-dot--danger { background: var(--danger-fill); }
.sqd-title { margin: 8px 0 4px; max-width: 860px; font-size: 20px; line-height: 28px; font-weight: 510; letter-spacing: -0.022em; text-wrap: balance; }
.sqd-subtitle { max-width: 78ch; margin: 0; color: var(--fg-secondary); font-size: 14px; line-height: 22px; }
.sqd-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.sqd-badge { min-height: 24px; display: inline-flex; align-items: center; gap: 5px; border-radius: var(--radius-sm); padding: 4px 8px; background: var(--surface-elevated); color: var(--fg-muted); font: 400 11px/16px var(--font-mono); letter-spacing: 0; box-shadow: var(--shadow-ring); }
.sqd-badge--warning { color: var(--warning-text); background: var(--warning-muted); box-shadow: 0 0 0 1px var(--warning-edge); }
.sqd-badge--danger { color: var(--danger-text); background: var(--danger-muted); box-shadow: 0 0 0 1px var(--danger-edge); }

.sqd-receipt { display: flex; align-items: center; justify-content: space-between; gap: 20px; border: 1px solid var(--edge); border-radius: var(--radius-lg); padding: 13px 16px; background: var(--surface-raised); }
.sqd-receipt-copy { min-width: 0; }
.sqd-receipt-title { margin: 3px 0 0; font-size: 14px; line-height: 20px; font-weight: 510; }
.sqd-receipt-meta { margin: 3px 0 0; color: var(--fg-muted); font: 400 11px/16px var(--font-mono); overflow-wrap: anywhere; }

.sqd-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: var(--edge-subtle); gap: 1px; box-shadow: var(--shadow-ring); }
.sqd-metric { min-width: 0; background: var(--surface-raised); padding: 14px 16px; }
.sqd-metric--primary { box-shadow: inset 2px 0 0 var(--accent); }
.sqd-metric-label { color: var(--fg-muted); font-size: 12px; line-height: 16px; font-weight: 510; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-metric-value { margin-top: 6px; color: var(--fg); font: 400 20px/28px var(--font-mono); letter-spacing: 0; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-metric-subtitle { margin-top: 4px; color: var(--fg-muted); font-size: 12px; line-height: 16px; letter-spacing: 0; }

.sqd-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; align-items: start; }
.sqd-card { grid-column: span 12; min-width: 0; overflow: hidden; border: 1px solid var(--edge); border-radius: var(--radius-lg); background: var(--surface-raised); }
.sqd-card--half { grid-column: span 6; }
.sqd-card--primary { border-color: rgb(129 140 248 / 0.18); }
.sqd-grid--dashboard .sqd-card:not(.sqd-card--primary) { grid-column: span 6; }
.sqd-grid--split .sqd-card:not(.sqd-card--primary) { grid-column: span 6; }
.sqd-grid--chart_focus .sqd-card { grid-column: span 12; }
.sqd-grid--compact { gap: 12px; }
.sqd-grid--compact .sqd-card-head { padding-block: 11px 10px; }
.sqd-grid--compact .sqd-card-body { padding-block: 12px; }
.sqd-card-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 14px 16px 12px; border-bottom: 1px solid var(--edge-subtle); }
.sqd-card-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 510; letter-spacing: -0.011em; }
.sqd-card-subtitle { max-width: 68ch; margin: 3px 0 0; color: var(--fg-muted); font-size: 12px; line-height: 16px; letter-spacing: 0; }
.sqd-card-body { padding: 16px; min-width: 0; }

.sqd-chart-wrap { position: relative; width: 100%; min-height: 320px; }
.sqd-chart-range { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(90px, 0.7fr) minmax(90px, 0.7fr) auto auto; align-items: center; gap: 8px; margin-bottom: 10px; }
.sqd-chart-range-copy { color: var(--fg-muted); font: 400 11px/16px var(--font-mono); }
.sqd-range { width: 100%; accent-color: var(--accent); }
.sqd-chart { display: block; width: 100%; height: 320px; overflow: visible; }
.sqd-chart-grid { stroke: rgb(255 255 255 / 0.055); stroke-width: 1; }
.sqd-chart-line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.sqd-chart-area { fill: var(--accent-subtle); }
.sqd-chart-series-area { opacity: 0.28; }
.sqd-chart-bar { fill: var(--accent); opacity: 0.9; }
.sqd-chart-wick { stroke: var(--fg-muted); stroke-width: 1; }
.sqd-chart-up { fill: var(--success-text); }
.sqd-chart-down { fill: var(--danger-text); }
.sqd-chart-volume { opacity: 0.48; }
.sqd-chart-volume--up { fill: var(--success-text); }
.sqd-chart-volume--down { fill: var(--danger-text); }
.sqd-chart-label { fill: var(--fg-muted); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
.sqd-chart-last-line { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 4; opacity: 0.72; }
.sqd-chart-last-pill { fill: var(--accent); }
.sqd-chart-last-value { fill: var(--surface); font: 510 10px/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.sqd-chart-crosshair { stroke: var(--fg-secondary); stroke-width: 1; stroke-dasharray: 2 3; pointer-events: none; opacity: 0.7; }
.sqd-chart-hit { fill: transparent; pointer-events: all; outline: none; }
.sqd-chart-hit:focus-visible { fill: var(--accent-subtle); stroke: var(--accent); stroke-width: 1; }
.sqd-chart-tooltip { position: absolute; z-index: 2; top: 8px; max-width: min(360px, 80%); transform: translateX(-50%); border: 1px solid var(--edge-strong); border-radius: var(--radius-md); padding: 7px 9px; background: var(--surface); color: var(--fg); box-shadow: 0 12px 28px rgb(0 0 0 / 0.36); font: 400 11px/16px var(--font-mono); pointer-events: none; }
.sqd-chart-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.sqd-chart-legend-item { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: var(--radius-sm); padding: 5px 8px; background: var(--surface-elevated); color: var(--fg-secondary); box-shadow: var(--shadow-ring); cursor: pointer; font: 400 11px/16px var(--font-mono); }
.sqd-chart-legend-item[aria-pressed='false'] { color: var(--fg-muted); text-decoration: line-through; }
.sqd-chart-legend-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sqd-chart-legend-swatch { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 2px; }
.sqd-chart-empty { min-height: 220px; display: grid; place-items: center; color: var(--fg-muted); text-align: center; }

.sqd-ranked { display: grid; }
.sqd-ranked-row { min-height: 40px; display: grid; grid-template-columns: minmax(110px, 0.8fr) minmax(120px, 2fr) auto; align-items: center; gap: 12px; border-bottom: 1px solid var(--edge-subtle); }
.sqd-ranked-row:last-child { border-bottom: 0; }
.sqd-ranked-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.sqd-ranked-track { height: 6px; overflow: hidden; background: var(--surface-elevated); }
.sqd-ranked-fill { height: 100%; background: var(--accent); }
.sqd-ranked-value { color: var(--fg-secondary); font: 400 13px/20px var(--font-mono); font-variant-numeric: tabular-nums; }

.sqd-table-tools { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.sqd-input { width: min(100%, 320px); min-height: 36px; border: 1px solid var(--edge); border-radius: var(--radius-md); padding: 7px 10px; background: var(--surface); color: var(--fg); transition: border-color var(--duration-normal) var(--ease-soft), box-shadow var(--duration-normal) var(--ease-soft); }
.sqd-input::placeholder { color: var(--fg-disabled); }
.sqd-input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-muted); }
.sqd-table-wrap { width: 100%; overflow: auto; }
.sqd-table { width: 100%; min-width: 640px; border-collapse: collapse; font-size: 13px; line-height: 20px; }
.sqd-table th, .sqd-table td { min-width: 110px; max-width: 280px; height: 40px; padding: 9px 12px; border-bottom: 1px solid var(--edge-subtle); text-align: left; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-table th { position: sticky; top: 0; z-index: 1; background: var(--surface-raised); color: var(--fg-muted); font: 510 12px/16px var(--font-sans); letter-spacing: 0.04em; text-transform: uppercase; }
.sqd-table tr:last-child td { border-bottom: 0; }
.sqd-table tbody tr { transition: background-color var(--duration-normal) var(--ease-soft); }
.sqd-table tbody tr:hover, .sqd-table tbody tr:focus-within { background: var(--surface-elevated); }
.sqd-table tbody tr[data-selected='true'] { background: var(--accent-muted); box-shadow: inset 2px 0 0 var(--accent); }
.sqd-table td[data-align='right'] { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.sqd-table th[data-align='right'] { text-align: right; }
.sqd-sort, .sqd-row-button { width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: inherit; cursor: pointer; }
.sqd-row-button { font-family: var(--font-mono); font-size: 13px; letter-spacing: 0; }
.sqd-hash { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-variant-ligatures: none; font-feature-settings: 'zero' 1; white-space: normal !important; overflow-wrap: anywhere; text-overflow: clip !important; }

.sqd-timeline { display: grid; }
.sqd-event { min-height: 52px; display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--edge-subtle); }
.sqd-event:last-child { border-bottom: 0; }
.sqd-event-dot { width: 6px; height: 6px; margin-top: 7px; border-radius: 50%; background: var(--accent); }
.sqd-event-title { font-size: 13px; line-height: 20px; font-weight: 510; }
.sqd-event-subtitle { color: var(--fg-secondary); font: 400 12px/18px var(--font-mono); letter-spacing: 0; word-break: break-word; }
.sqd-event-time { color: var(--fg-muted); font: 400 12px/16px var(--font-mono); letter-spacing: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }

.sqd-stat-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.sqd-stat { min-height: 40px; display: flex; justify-content: space-between; gap: 12px; align-items: center; border-bottom: 1px solid var(--edge-subtle); }
.sqd-stat-label { color: var(--fg-secondary); font-size: 13px; }
.sqd-stat-value { font: 400 13px/20px var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; }
.sqd-notices { display: grid; gap: 8px; }
.sqd-notice { border-left: 2px solid var(--warning-text); padding: 9px 12px; background: var(--warning-muted); color: var(--warning-text); font-size: 12px; line-height: 18px; }
.sqd-display-limit { margin: 10px 0 0; border-left: 2px solid var(--warning-text); padding: 8px 10px; background: var(--warning-muted); color: var(--warning-text); font-size: 12px; line-height: 18px; }
.sqd-empty { min-height: 220px; display: grid; place-items: center; border: 1px dashed var(--edge-strong); padding: 28px; text-align: center; }
.sqd-empty h2 { margin: 0 0 6px; font-size: 16px; line-height: 24px; font-weight: 510; letter-spacing: -0.022em; }
.sqd-empty p { max-width: 600px; margin: 0; color: var(--fg-secondary); }
.sqd-skeleton { position: relative; overflow: hidden; min-height: 64px; background: var(--surface-raised); }
.sqd-skeleton::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.05), transparent); animation: sqd-shimmer 1.2s infinite; }
@keyframes sqd-shimmer { to { transform: translateX(100%); } }
.sqd-raw { border-top: 1px solid var(--edge-subtle); overflow: hidden; }
.sqd-raw summary { min-height: 40px; cursor: pointer; padding: 10px 12px; color: var(--fg-secondary); font-weight: 510; }
.sqd-raw pre { max-height: 360px; margin: 0; overflow: auto; border-top: 1px solid var(--edge-subtle); padding: 14px; background: var(--surface); color: #e8e8ec; font: 400 13px/1.7 var(--font-mono); letter-spacing: 0; white-space: pre-wrap; word-break: break-word; }
.sqd-dialog { width: min(680px, calc(100vw - 28px)); max-height: min(720px, calc(100vh - 28px)); overflow: hidden; border: 1px solid var(--edge-strong); border-radius: var(--radius-xl); padding: 0; background: var(--surface-raised); color: var(--fg); box-shadow: 0 20px 44px -20px rgb(0 0 0 / 0.7); }
.sqd-dialog::backdrop { background: rgb(0 0 0 / 0.60); }
.sqd-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--edge-subtle); }
.sqd-dialog-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 510; }
.sqd-dialog-body { max-height: 620px; overflow: auto; padding: 16px; }
.sqd-dialog pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 400 13px/1.7 var(--font-mono); }
.sqd-footer { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-top: 1px solid var(--edge-subtle); color: var(--fg-muted); font: 400 11px/16px var(--font-mono); letter-spacing: 0.06em; }
.sqd-visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
.sqd-table-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 12px; }

@media (max-width: 820px) {
  .sqd-app { padding-inline: 16px; }
  .sqd-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sqd-card--half { grid-column: span 12; }
  .sqd-grid--dashboard .sqd-card:not(.sqd-card--primary), .sqd-grid--split .sqd-card:not(.sqd-card--primary) { grid-column: span 12; }
  .sqd-stat-list { grid-template-columns: 1fr; }
  .sqd-chart-range { grid-template-columns: 1fr 1fr; }
  .sqd-chart-range-copy { grid-column: 1 / -1; }
}

@media (max-width: 520px) {
  .sqd-app { padding: 8px 12px 16px; }
  .sqd-topbar { min-height: 52px; align-items: center; }
  .sqd-brand-subtitle { max-width: 168px; }
  .sqd-actions { gap: 6px; }
  .sqd-workspace-strip, .sqd-receipt { align-items: flex-start; flex-direction: column; }
  .sqd-workspace-capabilities { justify-content: flex-start; }
  .sqd-hero { padding-block: 14px 16px; }
  .sqd-metrics { grid-template-columns: 1fr 1fr; }
  .sqd-metric { padding: 12px; }
  .sqd-card-head, .sqd-card-body { padding-inline: 12px; }
  .sqd-chart-wrap { min-height: 0; }
  .sqd-chart { height: auto; aspect-ratio: 900 / 320; }
  .sqd-input { font-size: 16px; }
  .sqd-table-pagination { justify-content: space-between; }
  .sqd-event { grid-template-columns: 8px 1fr; }
  .sqd-event-time { grid-column: 2; }
  .sqd-ranked-row { grid-template-columns: minmax(88px, 0.8fr) minmax(80px, 1.2fr) auto; gap: 8px; }
  .sqd-footer { display: grid; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
`
