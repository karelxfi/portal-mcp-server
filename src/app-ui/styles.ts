export const ACTIVITY_EXPLORER_CSS = String.raw`
:root {
  color-scheme: light dark;
  --sqd-bg: var(--color-background-primary, #f7f7f5);
  --sqd-surface: var(--color-background-secondary, #ffffff);
  --sqd-surface-strong: var(--color-background-tertiary, #efefeb);
  --sqd-text: var(--color-text-primary, #171717);
  --sqd-muted: var(--color-text-secondary, #66665f);
  --sqd-faint: var(--color-text-tertiary, #87877f);
  --sqd-border: var(--color-border-secondary, #deded7);
  --sqd-accent: #ff5c35;
  --sqd-accent-soft: color-mix(in srgb, var(--sqd-accent) 14%, transparent);
  --sqd-positive: #138a5b;
  --sqd-warning: #b66d00;
  --sqd-danger: #c23838;
  --sqd-radius: var(--border-radius-lg, 16px);
  --sqd-shadow: var(--shadow-sm, 0 1px 2px rgb(0 0 0 / 0.06));
  font-family: var(--font-sans, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}

* { box-sizing: border-box; }
html, body { margin: 0; min-width: 280px; background: var(--sqd-bg); color: var(--sqd-text); }
body { font-size: 14px; line-height: 1.45; }
button, input { font: inherit; }
button { color: inherit; }
.sqd-app { width: 100%; max-width: 1180px; margin: 0 auto; padding: 16px; }
.sqd-shell { display: grid; gap: 14px; }
.sqd-topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; }
.sqd-brand { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
.sqd-mark { width: 36px; height: 36px; flex: 0 0 36px; border-radius: 10px; display: grid; place-items: center; background: #050505; color: white; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12); }
.sqd-mark svg { width: 24px; height: 24px; }
.sqd-brand-copy { min-width: 0; }
.sqd-brand-name { font-size: 15px; font-weight: 750; letter-spacing: -0.01em; }
.sqd-brand-subtitle { color: var(--sqd-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.sqd-button { min-height: 36px; border: 1px solid var(--sqd-border); border-radius: 10px; padding: 7px 11px; background: var(--sqd-surface); cursor: pointer; font-weight: 650; box-shadow: var(--sqd-shadow); }
.sqd-button:hover { border-color: color-mix(in srgb, var(--sqd-text) 32%, var(--sqd-border)); }
.sqd-button:focus-visible, .sqd-input:focus-visible, .sqd-sort:focus-visible, summary:focus-visible { outline: 3px solid color-mix(in srgb, var(--sqd-accent) 42%, transparent); outline-offset: 2px; }
.sqd-button:disabled { opacity: 0.5; cursor: not-allowed; }
.sqd-button--primary { background: var(--sqd-text); color: var(--sqd-bg); border-color: var(--sqd-text); }
.sqd-hero { position: relative; overflow: hidden; border: 1px solid var(--sqd-border); border-radius: calc(var(--sqd-radius) + 2px); background: var(--sqd-surface); padding: 20px; box-shadow: var(--sqd-shadow); }
.sqd-hero::after { content: ""; position: absolute; width: 240px; height: 240px; right: -120px; top: -150px; border-radius: 50%; background: radial-gradient(circle, var(--sqd-accent-soft), transparent 70%); pointer-events: none; }
.sqd-eyebrow { display: flex; align-items: center; gap: 7px; color: var(--sqd-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
.sqd-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--sqd-positive); }
.sqd-dot--warning { background: var(--sqd-warning); }
.sqd-dot--danger { background: var(--sqd-danger); }
.sqd-title { position: relative; margin: 8px 0 4px; max-width: 820px; font-size: clamp(22px, 3.4vw, 36px); line-height: 1.08; letter-spacing: -0.04em; }
.sqd-subtitle { position: relative; max-width: 880px; margin: 0; color: var(--sqd-muted); font-size: 14px; }
.sqd-badges { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; }
.sqd-badge { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; border: 1px solid var(--sqd-border); border-radius: 999px; padding: 3px 9px; background: var(--sqd-bg); color: var(--sqd-muted); font-size: 12px; font-weight: 650; }
.sqd-badge--warning { color: var(--sqd-warning); border-color: color-mix(in srgb, var(--sqd-warning) 35%, var(--sqd-border)); background: color-mix(in srgb, var(--sqd-warning) 8%, var(--sqd-bg)); }
.sqd-badge--danger { color: var(--sqd-danger); border-color: color-mix(in srgb, var(--sqd-danger) 35%, var(--sqd-border)); background: color-mix(in srgb, var(--sqd-danger) 8%, var(--sqd-bg)); }
.sqd-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.sqd-metric { min-width: 0; border: 1px solid var(--sqd-border); border-radius: var(--sqd-radius); background: var(--sqd-surface); padding: 14px; box-shadow: var(--sqd-shadow); }
.sqd-metric--primary { border-color: color-mix(in srgb, var(--sqd-accent) 30%, var(--sqd-border)); background: linear-gradient(145deg, var(--sqd-surface), var(--sqd-accent-soft)); }
.sqd-metric-label { color: var(--sqd-muted); font-size: 12px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-metric-value { margin-top: 5px; font-size: clamp(19px, 2.5vw, 28px); line-height: 1.05; font-weight: 760; letter-spacing: -0.035em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-metric-subtitle { margin-top: 5px; color: var(--sqd-faint); font-size: 11px; }
.sqd-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; align-items: start; }
.sqd-card { grid-column: span 12; min-width: 0; overflow: hidden; border: 1px solid var(--sqd-border); border-radius: var(--sqd-radius); background: var(--sqd-surface); box-shadow: var(--sqd-shadow); }
.sqd-card--half { grid-column: span 6; }
.sqd-card--primary { border-color: color-mix(in srgb, var(--sqd-accent) 28%, var(--sqd-border)); }
.sqd-card-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 15px 16px 12px; border-bottom: 1px solid var(--sqd-border); }
.sqd-card-title { margin: 0; font-size: 15px; line-height: 1.25; letter-spacing: -0.015em; }
.sqd-card-subtitle { margin: 3px 0 0; color: var(--sqd-muted); font-size: 12px; }
.sqd-card-body { padding: 14px 16px 16px; min-width: 0; }
.sqd-chart-wrap { position: relative; width: 100%; min-height: 260px; }
.sqd-chart { display: block; width: 100%; height: 260px; overflow: visible; }
.sqd-chart-grid { stroke: var(--sqd-border); stroke-width: 1; }
.sqd-chart-line { fill: none; stroke: var(--sqd-accent); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.sqd-chart-area { fill: color-mix(in srgb, var(--sqd-accent) 15%, transparent); }
.sqd-chart-bar { fill: var(--sqd-accent); opacity: 0.82; }
.sqd-chart-wick { stroke: var(--sqd-muted); stroke-width: 1; }
.sqd-chart-up { fill: var(--sqd-positive); }
.sqd-chart-down { fill: var(--sqd-danger); }
.sqd-chart-label { fill: var(--sqd-muted); font-size: 10px; }
.sqd-chart-empty { min-height: 230px; display: grid; place-items: center; color: var(--sqd-muted); text-align: center; }
.sqd-ranked { display: grid; gap: 10px; }
.sqd-ranked-row { display: grid; grid-template-columns: minmax(90px, 0.8fr) minmax(120px, 2fr) auto; align-items: center; gap: 10px; }
.sqd-ranked-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 650; }
.sqd-ranked-track { height: 9px; overflow: hidden; border-radius: 999px; background: var(--sqd-surface-strong); }
.sqd-ranked-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--sqd-accent), color-mix(in srgb, var(--sqd-accent) 60%, #ffb09a)); }
.sqd-ranked-value { color: var(--sqd-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.sqd-table-tools { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
.sqd-input { width: min(100%, 300px); min-height: 34px; border: 1px solid var(--sqd-border); border-radius: 9px; padding: 6px 9px; background: var(--sqd-bg); color: var(--sqd-text); }
.sqd-table-wrap { width: 100%; overflow: auto; border: 1px solid var(--sqd-border); border-radius: 11px; }
.sqd-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sqd-table th, .sqd-table td { min-width: 88px; max-width: 260px; padding: 9px 10px; border-bottom: 1px solid var(--sqd-border); text-align: left; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-table th { position: sticky; top: 0; z-index: 1; background: var(--sqd-surface-strong); color: var(--sqd-muted); font-weight: 700; }
.sqd-table tr:last-child td { border-bottom: 0; }
.sqd-table tbody tr { cursor: pointer; }
.sqd-table tbody tr:hover, .sqd-table tbody tr:focus-within { background: color-mix(in srgb, var(--sqd-accent) 7%, transparent); }
.sqd-table td[data-align="right"], .sqd-table th[data-align="right"] { text-align: right; font-variant-numeric: tabular-nums; }
.sqd-sort { width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: inherit; font-weight: inherit; cursor: pointer; }
.sqd-row-button { width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: inherit; cursor: pointer; }
.sqd-timeline { display: grid; gap: 0; }
.sqd-event { position: relative; display: grid; grid-template-columns: 12px 1fr auto; gap: 10px; padding: 4px 0 14px; }
.sqd-event::after { content: ""; position: absolute; left: 5px; top: 17px; bottom: -3px; width: 1px; background: var(--sqd-border); }
.sqd-event:last-child::after { display: none; }
.sqd-event-dot { width: 11px; height: 11px; margin-top: 4px; border-radius: 50%; background: var(--sqd-accent); box-shadow: 0 0 0 3px var(--sqd-accent-soft); }
.sqd-event-title { font-weight: 700; }
.sqd-event-subtitle { color: var(--sqd-muted); font-size: 12px; word-break: break-word; }
.sqd-event-time { color: var(--sqd-faint); font-size: 11px; white-space: nowrap; }
.sqd-stat-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
.sqd-stat { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--sqd-border); }
.sqd-stat-label { color: var(--sqd-muted); }
.sqd-stat-value { font-weight: 700; text-align: right; }
.sqd-notices { display: grid; gap: 7px; }
.sqd-notice { border: 1px solid color-mix(in srgb, var(--sqd-warning) 32%, var(--sqd-border)); border-radius: 10px; padding: 10px 12px; background: color-mix(in srgb, var(--sqd-warning) 7%, var(--sqd-surface)); color: color-mix(in srgb, var(--sqd-warning) 72%, var(--sqd-text)); font-size: 12px; }
.sqd-empty { min-height: 240px; display: grid; place-items: center; border: 1px dashed var(--sqd-border); border-radius: var(--sqd-radius); background: var(--sqd-surface); padding: 28px; text-align: center; }
.sqd-empty h2 { margin: 0 0 6px; font-size: 20px; }
.sqd-empty p { max-width: 600px; margin: 0; color: var(--sqd-muted); }
.sqd-skeleton { position: relative; overflow: hidden; min-height: 70px; border-radius: var(--sqd-radius); background: var(--sqd-surface-strong); }
.sqd-skeleton::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgb(255 255 255 / .25), transparent); animation: sqd-shimmer 1.4s infinite; }
@keyframes sqd-shimmer { to { transform: translateX(100%); } }
.sqd-raw { border: 1px solid var(--sqd-border); border-radius: var(--sqd-radius); background: var(--sqd-surface); overflow: hidden; }
.sqd-raw summary { cursor: pointer; padding: 12px 14px; font-weight: 700; }
.sqd-raw pre { max-height: 360px; margin: 0; overflow: auto; border-top: 1px solid var(--sqd-border); padding: 14px; background: #101010; color: #f0f0ed; font: 11px/1.55 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); white-space: pre-wrap; word-break: break-word; }
.sqd-dialog { width: min(680px, calc(100vw - 28px)); max-height: min(720px, calc(100vh - 28px)); overflow: hidden; border: 1px solid var(--sqd-border); border-radius: 18px; padding: 0; background: var(--sqd-surface); color: var(--sqd-text); box-shadow: 0 24px 80px rgb(0 0 0 / 0.28); }
.sqd-dialog::backdrop { background: rgb(0 0 0 / 0.44); backdrop-filter: blur(3px); }
.sqd-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; border-bottom: 1px solid var(--sqd-border); }
.sqd-dialog-title { margin: 0; font-size: 15px; }
.sqd-dialog-body { max-height: 620px; overflow: auto; padding: 16px; }
.sqd-dialog pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 12px/1.55 var(--font-mono, ui-monospace, monospace); }
.sqd-footer { display: flex; justify-content: space-between; gap: 12px; padding: 2px 2px 6px; color: var(--sqd-muted); font-size: 11px; }
.sqd-visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }

@media (max-width: 820px) {
  .sqd-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sqd-card--half { grid-column: span 12; }
  .sqd-stat-list { grid-template-columns: 1fr; }
}

@media (max-width: 520px) {
  .sqd-app { padding: 10px; }
  .sqd-topbar { align-items: flex-start; }
  .sqd-brand-subtitle { max-width: 160px; }
  .sqd-actions { gap: 6px; }
  .sqd-actions .sqd-button:not(.sqd-button--primary) { display: none; }
  .sqd-hero { padding: 16px; }
  .sqd-metrics { grid-template-columns: 1fr 1fr; gap: 8px; }
  .sqd-metric { padding: 12px; }
  .sqd-card-head { padding: 13px 13px 10px; }
  .sqd-card-body { padding: 12px 13px 14px; }
  .sqd-event { grid-template-columns: 12px 1fr; }
  .sqd-event-time { grid-column: 2; }
  .sqd-footer { display: grid; }
}

@media (prefers-color-scheme: dark) {
  :root {
    --sqd-bg: var(--color-background-primary, #10100f);
    --sqd-surface: var(--color-background-secondary, #191918);
    --sqd-surface-strong: var(--color-background-tertiary, #242422);
    --sqd-text: var(--color-text-primary, #f2f2ed);
    --sqd-muted: var(--color-text-secondary, #b7b7af);
    --sqd-faint: var(--color-text-tertiary, #97978f);
    --sqd-border: var(--color-border-secondary, #353531);
    --sqd-positive: #48c78e;
    --sqd-warning: #f0a33b;
    --sqd-danger: #f06b6b;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
`
