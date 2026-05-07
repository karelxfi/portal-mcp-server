/**
 * Onyx design tokens and global CSS for the Portal Explorer app.
 * Injected once on mount. No CSS modules — one static style string keeps the
 * bundle small and avoids esbuild plugins.
 */
export const GLOBAL_CSS = `
:root {
  color-scheme: dark;

  /* Type scale — tight app chrome, tabular market numerics. */
  --pt-fs-label: 11px;
  --pt-fs-body: 13px;
  --pt-fs-heading: 14px;
  --pt-fs-app-title: 16px;
  --pt-fs-hero: 28px;

  /* Onyx surfaces — deeper near-black panels, sharp hairlines, no glass glow. */
  --pt-bg: #07090d;
  --pt-panel: #0d1015;
  --pt-panel-alt: #11151b;
  --pt-panel-hover: rgba(255, 255, 255, 0.035);
  --pt-border: rgba(180, 194, 215, 0.085);
  --pt-border-strong: rgba(204, 216, 235, 0.18);
  --pt-border-accent: rgba(0, 166, 255, 0.45);

  /* Text */
  --pt-text: #e8edf5;
  --pt-text-muted: #98a2b1;
  --pt-text-subtle: #5d6675;

  /* Accent / semantic */
  --pt-accent: #00a6ff;
  --pt-accent-strong: #66cfff;
  --pt-accent-soft: rgba(0, 166, 255, 0.13);
  --pt-success: #26d0a8;
  --pt-success-soft: rgba(38, 208, 168, 0.13);
  --pt-danger: #ef5468;
  --pt-danger-soft: rgba(239, 84, 104, 0.13);
  --pt-warning: #f7b731;
  --pt-warning-soft: rgba(247, 183, 49, 0.13);

  --pt-grid: rgba(190, 204, 224, 0.06);
  --pt-grid-strong: rgba(190, 204, 224, 0.12);
  --pt-tooltip-bg: rgba(8, 10, 14, 0.97);

  --pt-radius-sm: 4px;
  --pt-radius: 6px;
  --pt-radius-lg: 6px;

  --pt-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --pt-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: transparent !important;
  /* Intentionally no height:100% — the ext-apps SDK reports documentElement
     height to the host via ResizeObserver, and any 100vh/100% traps the
     measurement at the iframe's current cap, creating a feedback loop that
     prevents the host from growing the iframe to fit content. */
}
body {
  font-family: var(--pt-font);
  font-feature-settings: "cv10", "cv11", "ss01", "ss03";
  color: var(--pt-text);
  -webkit-font-smoothing: antialiased;
  font-size: 14px;
  line-height: 1.5;
}
#app { background: transparent; }

.pt-app {
  padding: 6px clamp(12px, 2vw, 22px) 14px;
  max-width: 1240px;
  margin: 0 auto;
}

/* ---------- Typography — 4 sizes. Hierarchy via weight + color. ---------- */
.pt-text { display: block; color: var(--pt-text); margin: 0; }
.pt-text--muted { color: var(--pt-text-muted); }
.pt-text--subtle { color: var(--pt-text-subtle); }
.pt-text--h1 { font-size: var(--pt-fs-app-title); font-weight: 600; letter-spacing: -0.01em; line-height: 1.25; overflow-wrap: anywhere; }
.pt-text--h2 { font-size: var(--pt-fs-heading); font-weight: 650; letter-spacing: -0.005em; line-height: 1.35; overflow-wrap: anywhere; }
.pt-text--h3 { font-size: var(--pt-fs-body); font-weight: 600; line-height: 1.35; }
.pt-text--label { font-size: var(--pt-fs-label); font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; color: var(--pt-text-subtle); line-height: 1.2; }
.pt-text--body { font-size: var(--pt-fs-body); line-height: 1.45; }
.pt-text--body-semi { font-size: var(--pt-fs-body); font-weight: 600; line-height: 1.35; }
.pt-text--caption { font-size: var(--pt-fs-label); line-height: 1.4; color: var(--pt-text-muted); }
.pt-text--code { font-family: var(--pt-font-mono); font-size: var(--pt-fs-body); }
.pt-text--metric { font-size: var(--pt-fs-hero); font-weight: 650; letter-spacing: -0.022em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.pt-text--metric-sm { font-size: var(--pt-fs-heading); font-weight: 650; letter-spacing: -0.01em; line-height: 1.15; font-variant-numeric: tabular-nums; }

/* ---------- Layout primitives ---------- */
.pt-stack { display: flex; }
.pt-stack--col { flex-direction: column; }
.pt-stack--row { flex-direction: row; }

/* ---------- Card — Onyx solid surface, hairline border ---------- */
.pt-card {
  background: var(--pt-panel);
  border: 1px solid var(--pt-border);
  border-radius: var(--pt-radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.pt-card__header {
  padding: 14px 18px 10px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--pt-border);
}
.pt-card__header-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pt-card__actions { display: flex; gap: 6px; flex-shrink: 0; }
.pt-card__body { padding: 14px 18px 16px; flex: 1; min-width: 0; }
.pt-card__body--tight { padding: 10px 14px 12px; }
.pt-card__body--flush { padding: 0; }

/* ---------- Badge ---------- */
.pt-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 650;
  line-height: 1.4;
  background: rgba(255, 255, 255, 0.04);
  color: var(--pt-text-muted);
  border: 1px solid var(--pt-border);
  white-space: nowrap;
}
.pt-badge--accent { background: var(--pt-accent-soft); color: var(--pt-accent-strong); border-color: var(--pt-border-accent); }
.pt-badge--success { background: var(--pt-success-soft); color: var(--pt-success); border-color: rgba(38, 208, 168, 0.25); }
.pt-badge--danger { background: var(--pt-danger-soft); color: var(--pt-danger); border-color: rgba(239, 84, 104, 0.25); }
.pt-badge--warning { background: var(--pt-warning-soft); color: var(--pt-warning); border-color: rgba(247, 183, 49, 0.25); }

/* ---------- Button ---------- */
.pt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 11px;
  border-radius: var(--pt-radius-sm);
  background: rgba(255, 255, 255, 0.04);
  color: var(--pt-text);
  border: 1px solid var(--pt-border);
  font-family: inherit;
  font-size: var(--pt-fs-body);
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition: background 120ms cubic-bezier(0.23, 1, 0.32, 1), border-color 120ms cubic-bezier(0.23, 1, 0.32, 1), transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
  white-space: nowrap;
}
.pt-btn:hover { background: rgba(255, 255, 255, 0.08); border-color: var(--pt-border-strong); }
.pt-btn:active { transform: scale(0.98); }
.pt-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pt-btn--primary { background: var(--pt-accent); color: white; border-color: transparent; }
.pt-btn--primary:hover { background: var(--pt-accent-strong); }
.pt-btn--ghost { background: transparent; border-color: transparent; }
.pt-btn--ghost:hover { background: rgba(255, 255, 255, 0.06); }

/* ---------- Header ---------- */
.pt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.pt-header__eyebrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pt-header__title-block { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.pt-header .pt-btn { padding: 5px 10px; }
.pt-header__actions { display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
.pt-header__meta { display: flex; flex-wrap: wrap; gap: 8px; }

/* ---------- Preview harness ---------- */
.pt-preview-picker {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--pt-border);
  flex-wrap: wrap;
  position: sticky;
  top: 0;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  background: rgba(7, 9, 13, 0.86);
  z-index: 10;
}
.pt-preview-picker__label {
  font-size: var(--pt-fs-label);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pt-text-subtle);
  align-self: center;
  margin-right: 8px;
}
.pt-preview-picker .pt-btn[data-active="true"] {
  background: var(--pt-accent);
  color: #00111d;
  border-color: transparent;
}

/* ---------- Panels grid ---------- */
.pt-panels {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 14px;
  align-items: stretch;
  grid-auto-flow: dense;
}
.pt-panels > .pt-panel--wide { grid-column: 1 / -1; }
.pt-panel--half { grid-column: span 6; }
.pt-panel--third { grid-column: span 4; }
.pt-panel--two-third { grid-column: span 8; }
@media (max-width: 1100px) {
  .pt-panel--half, .pt-panel--third, .pt-panel--two-third { grid-column: 1 / -1; }
}

/* ---------- KPI panel — grid of hero metric + delta + inline sparkline ---------- */
.pt-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1px;
  background: var(--pt-border);
}
.pt-kpi-card {
  background: var(--pt-panel-alt);
  padding: 14px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.pt-kpi-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pt-kpi-card__metric {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.pt-kpi-card__metric .pt-chart-summary__value {
  font-size: 24px;
}
.pt-kpi-card__spark {
  margin-top: 2px;
  opacity: 0.9;
}

/* ---------- Metric cards strip (no longer rendered by default; kept for explicit use) ---------- */
.pt-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.pt-metric {
  background: var(--pt-panel);
  border: 1px solid var(--pt-border);
  border-radius: var(--pt-radius);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  backdrop-filter: blur(10px);
}
.pt-metric--primary { border-color: var(--pt-border-accent); }

/* ---------- Tables ---------- */
.pt-table { width: 100%; border-collapse: collapse; font-size: var(--pt-fs-body); }
.pt-table thead th {
  text-align: left;
  padding: 9px 14px;
  font-size: var(--pt-fs-label);
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pt-text-subtle);
  background: var(--pt-panel-alt);
  border-bottom: 1px solid var(--pt-border);
  position: sticky;
  top: 0;
  z-index: 2;
  white-space: nowrap;
}
.pt-table thead th::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: var(--pt-border);
}
.pt-table thead th.pt-th--sortable { cursor: pointer; user-select: none; }
.pt-table thead th.pt-th--sortable:hover { color: var(--pt-text); }
.pt-table thead th.pt-th--active { color: var(--pt-text); }
.pt-table tbody td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--pt-border);
  color: var(--pt-text);
  vertical-align: middle;
  white-space: nowrap;
  min-width: 0;
  overflow-wrap: normal;
}
.pt-table tbody tr:hover td { background: var(--pt-panel-hover); }
.pt-table tbody tr { cursor: pointer; }
.pt-table .pt-td--right { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--pt-font-mono); }
.pt-table .pt-td--mono { font-family: var(--pt-font-mono); font-size: 12.5px; color: var(--pt-text-muted); overflow-wrap: anywhere; word-break: break-word; }
.pt-table .pt-td--rank { width: 1%; color: var(--pt-text-subtle); font-variant-numeric: tabular-nums; font-family: var(--pt-font-mono); }

.pt-table-wrap {
  position: relative;
  max-height: 560px;
  overflow: auto;
}
.pt-table-tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 11px 16px;
  border-bottom: 1px solid var(--pt-border);
  gap: 12px;
  flex-wrap: wrap;
}
.pt-input {
  background: var(--pt-panel-alt);
  border: 1px solid var(--pt-border);
  border-radius: var(--pt-radius-sm);
  padding: 6px 11px;
  color: var(--pt-text);
  font-family: inherit;
  font-size: var(--pt-fs-body);
  min-width: 240px;
  outline: none;
  transition: border-color 120ms ease;
}
.pt-input:focus { border-color: var(--pt-accent); }
.pt-table-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid var(--pt-border);
  color: var(--pt-text-subtle);
  font-size: var(--pt-fs-label);
  gap: 12px;
}

/* ---------- Progress bar cell ---------- */
.pt-progress {
  position: relative;
  width: 100%;
  min-width: 120px;
  height: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.pt-progress__track {
  flex: 1;
  height: 6px;
  background: var(--pt-grid);
  border-radius: 999px;
  overflow: hidden;
}
.pt-progress__fill {
  height: 100%;
  background: var(--pt-accent);
  border-radius: 999px;
  transition: width 200ms ease;
}

/* ---------- Delta ---------- */
.pt-delta { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 12px; }
.pt-delta--pos { color: var(--pt-success); }
.pt-delta--neg { color: var(--pt-danger); }
.pt-delta--neu { color: var(--pt-text-subtle); }

/* ---------- Ranked bar panel ---------- */
.pt-bars { display: flex; flex-direction: column; padding: 4px 0; }
.pt-bar-row {
  position: relative;
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  height: 36px;
  cursor: pointer;
  isolation: isolate;
  transition: background 120ms ease;
}
.pt-bar-row:hover { background: var(--pt-panel-hover); }
.pt-bar-row::before {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 16px;
  width: calc(var(--pt-bar-pct, 0%) - 0px);
  max-width: calc(100% - 32px);
  background: linear-gradient(90deg, var(--pt-accent-soft) 0%, rgba(0, 166, 255, 0.10) 60%, rgba(0, 166, 255, 0.02) 100%);
  border-left: 2px solid var(--pt-accent);
  border-radius: 2px 3px 3px 2px;
  z-index: 0;
  transition: width 280ms cubic-bezier(0.22, 0.61, 0.36, 1);
  pointer-events: none;
}
.pt-bar-row > * { position: relative; z-index: 1; }
.pt-bar-row__rank {
  font-size: var(--pt-fs-label);
  color: var(--pt-text-subtle);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  font-family: var(--pt-font-mono);
}
.pt-bar-row__name {
  font-size: var(--pt-fs-body);
  font-weight: 500;
  color: var(--pt-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--pt-font);
}
.pt-bar-row__value {
  font-size: var(--pt-fs-body);
  font-weight: 650;
  color: var(--pt-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-family: var(--pt-font-mono);
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.pt-bar-row__value small {
  color: var(--pt-text-subtle);
  font-size: 10.5px;
  font-weight: 650;
}

/* ---------- Stat list ---------- */
.pt-stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1px;
  background: var(--pt-border);
}
.pt-stat-cell {
  background: var(--pt-panel-alt);
  padding: 13px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

/* ---------- Timeline — dense, grid-aligned event log ---------- */
.pt-timeline {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  column-gap: 0;
}
.pt-timeline-item {
  display: grid;
  grid-template-columns: 64px 14px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0 12px;
  padding: 9px 16px;
  border-bottom: 1px solid var(--pt-border);
  cursor: pointer;
  min-width: 0;
}
.pt-timeline-item:last-child { border-bottom: none; }
.pt-timeline-item:hover { background: var(--pt-panel-hover); }
.pt-timeline-item__ts {
  font-family: var(--pt-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--pt-text-subtle);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.pt-timeline-item__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--pt-accent);
  justify-self: center;
  box-shadow: 0 0 0 3px var(--pt-accent-soft);
}
.pt-timeline-item__dot--success {
  background: var(--pt-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pt-success) 18%, transparent);
}
.pt-timeline-item__dot--danger {
  background: var(--pt-danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pt-danger) 18%, transparent);
}
.pt-timeline-item__dot--warning {
  background: var(--pt-warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pt-warning) 18%, transparent);
}
.pt-timeline-item__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pt-timeline-item__title {
  font-size: 12.5px;
  color: var(--pt-text);
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pt-timeline-item__sub {
  font-size: 11px;
  color: var(--pt-text-subtle);
  font-family: var(--pt-font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}
.pt-timeline-item__kind {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--pt-text-subtle);
  font-weight: 600;
  white-space: nowrap;
}
@media (min-width: 900px) {
  .pt-timeline-item:nth-child(odd) { border-right: 1px solid var(--pt-border); }
}

/* ---------- Chart ---------- */
.pt-card--chart {
  background: #090c11;
  border-color: rgba(190, 204, 224, 0.14);
  box-shadow: 0 18px 46px -34px rgba(0, 0, 0, 0.72);
}
.pt-card--chart .pt-card__body { padding: 0; }
.pt-chart-wrap {
  width: 100%;
  min-width: 0;
}
.pt-chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 18px;
  padding: 16px 20px 12px;
  min-width: 0;
  border-bottom: 1px solid var(--pt-border);
}
.pt-chart-toolbar__identity {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pt-chart-toolbar__title {
  color: var(--pt-text);
  font-size: 15px;
  line-height: 1.25;
  font-weight: 700;
}
.pt-chart-toolbar__subtitle {
  color: var(--pt-text-subtle);
  font-size: var(--pt-fs-label);
  line-height: 1.2;
}
.pt-chart-toolbar__values {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 16px;
  min-width: 0;
  color: var(--pt-text-muted);
  font-family: var(--pt-font-mono);
  font-size: 12px;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}
.pt-chart-live-value {
  color: var(--pt-text);
  font-weight: 700;
  font-size: 17px;
  letter-spacing: -0.015em;
}
.pt-chart-inline-delta {
  font-weight: 700;
  white-space: nowrap;
}
.pt-chart-inline-delta.pt-chart-summary__delta--pos { color: var(--pt-success); background: transparent; }
.pt-chart-inline-delta.pt-chart-summary__delta--neg { color: var(--pt-danger); background: transparent; }
.pt-chart-inline-delta.pt-chart-summary__delta--neu { color: var(--pt-text-subtle); background: transparent; }
.pt-chart-inline-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  white-space: nowrap;
}
.pt-chart-inline-stat__label {
  color: var(--pt-text-subtle);
  font-family: var(--pt-font);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.pt-chart-inline-stat__value {
  color: var(--pt-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pt-chart-summary {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.pt-chart-summary__label {
  font-size: var(--pt-fs-label);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pt-text-subtle);
  line-height: 1.2;
  margin-bottom: 2px;
}
.pt-chart-summary__value {
  font-size: var(--pt-fs-hero);
  font-weight: 650;
  letter-spacing: -0.022em;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  color: var(--pt-text);
  font-family: var(--pt-font-mono);
}
.pt-chart-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 1px;
  background: var(--pt-border);
  border: 1px solid var(--pt-border);
  border-radius: var(--pt-radius);
  overflow: hidden;
  margin-bottom: 10px;
}
.pt-chart-stat {
  min-width: 0;
  background: var(--pt-panel-alt);
  padding: 7px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pt-chart-stat__label {
  color: var(--pt-text-subtle);
  font-size: var(--pt-fs-label);
  font-weight: 600;
  letter-spacing: 0.055em;
  text-transform: uppercase;
  line-height: 1.1;
}
.pt-chart-stat__value {
  color: var(--pt-text);
  font-family: var(--pt-font-mono);
  font-size: var(--pt-fs-body);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pt-chart-summary__delta {
  font-size: 11px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 3px;
}
.pt-chart-summary__delta--pos { color: var(--pt-success); background: var(--pt-success-soft); }
.pt-chart-summary__delta--neg { color: var(--pt-danger); background: var(--pt-danger-soft); }
.pt-chart-summary__delta--neu { color: var(--pt-text-subtle); background: rgba(255,255,255,0.04); }
.pt-chart-container {
  width: 100%;
  height: 342px;
  position: relative;
  font-size: var(--pt-fs-label);
  color: var(--pt-text-muted);
}
.pt-wick-chart {
  width: 100%;
  height: 100%;
  min-height: 318px;
}
.pt-wick-chart > div {
  width: 100%;
  height: 100%;
}
.pt-wick-chart canvas {
  border-radius: 0;
  background: transparent;
}
.pt-chart-tooltip {
  background: var(--pt-tooltip-bg);
  color: var(--pt-text);
  border: 1px solid var(--pt-border-strong);
  border-radius: var(--pt-radius-sm);
  padding: 9px 11px;
  box-shadow: 0 10px 28px -14px rgba(0, 0, 0, 0.35);
  min-width: 160px;
  font-size: var(--pt-fs-body);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
}
.pt-chart-tooltip__label {
  font-size: var(--pt-fs-label);
  color: var(--pt-text-subtle);
  margin-bottom: 6px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.pt-chart-tooltip__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 0;
}
.pt-chart-tooltip__key { display: flex; align-items: center; gap: 6px; color: var(--pt-text-muted); }
.pt-chart-tooltip__swatch { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.pt-chart-tooltip__value { color: var(--pt-text); font-weight: 600; font-variant-numeric: tabular-nums; }

.pt-chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 9px 18px 11px;
  border-top: 1px solid var(--pt-border);
}
.pt-chart-legend__item { display: flex; align-items: center; gap: 6px; font-size: var(--pt-fs-label); color: var(--pt-text-muted); }
.pt-chart-legend__swatch { width: 9px; height: 9px; border-radius: 2px; }
.pt-chart-legend__value { color: var(--pt-text); font-weight: 600; margin-left: 4px; font-variant-numeric: tabular-nums; }

/* ---------- Notices / banners ---------- */
.pt-notices { display: flex; flex-direction: column; gap: 6px; margin: -4px 0 12px; }
.pt-notice {
  background: var(--pt-panel);
  border: 1px solid var(--pt-border);
  border-left: 3px solid var(--pt-accent);
  border-radius: var(--pt-radius-sm);
  padding: 7px 12px;
  font-size: var(--pt-fs-label);
  color: var(--pt-text-muted);
  line-height: 1.45;
}
.pt-notice--warning { border-left-color: var(--pt-warning); }
.pt-notice--danger { border-left-color: var(--pt-danger); }

/* ---------- Empty / error / loading ---------- */
.pt-state {
  padding: 60px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: var(--pt-panel);
  border: 1px solid var(--pt-border);
  border-radius: var(--pt-radius-lg);
  gap: 10px;
}
.pt-state strong { font-size: var(--pt-fs-heading); color: var(--pt-text); }
.pt-state p { color: var(--pt-text-muted); max-width: 440px; margin: 0; font-size: var(--pt-fs-body); }
.pt-state--error { border-color: rgba(255, 77, 90, 0.3); background: linear-gradient(180deg, rgba(255, 77, 90, 0.05), transparent 50%), var(--pt-panel); }

.pt-skeleton {
  background: linear-gradient(90deg, var(--pt-grid) 0%, var(--pt-grid-strong) 50%, var(--pt-grid) 100%);
  background-size: 200% 100%;
  animation: pt-sheen 1.4s linear infinite;
  border-radius: 6px;
}
@keyframes pt-sheen { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ---------- Drawer ---------- */
.pt-drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(5, 7, 12, 0.55);
  z-index: 50;
  display: flex;
  justify-content: flex-end;
  animation: pt-fade-in 160ms ease;
}
.pt-drawer {
  width: min(520px, 96vw);
  max-height: 100vh;
  background: rgba(20, 24, 31, 0.94);
  border-left: 1px solid var(--pt-border);
  box-shadow: -24px 0 60px -20px rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  animation: pt-slide-in 200ms ease;
  backdrop-filter: blur(12px);
}
.pt-drawer__header {
  padding: 18px 22px;
  border-bottom: 1px solid var(--pt-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.pt-drawer__body {
  flex: 1;
  overflow: auto;
  padding: 16px 22px 28px;
}
.pt-kv { display: grid; grid-template-columns: minmax(120px, auto) 1fr; gap: 4px 16px; }
.pt-kv dt { color: var(--pt-text-subtle); font-size: var(--pt-fs-label); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding-top: 2px; }
.pt-kv dd { margin: 0; color: var(--pt-text); font-family: var(--pt-font-mono); font-size: var(--pt-fs-body); word-break: break-all; }
.pt-json {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--pt-border);
  border-radius: var(--pt-radius-sm);
  padding: 12px 14px;
  font-family: var(--pt-font-mono);
  font-size: var(--pt-fs-label);
  line-height: 1.55;
  color: var(--pt-text-muted);
  overflow: auto;
  max-height: 60vh;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

@keyframes pt-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pt-slide-in { from { transform: translateX(12px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

@media (max-width: 720px) {
  .pt-app { padding: 12px; }
  .pt-panels { grid-template-columns: 1fr; }
  .pt-drawer { width: 100%; }
  .pt-chart-toolbar {
    padding: 12px 12px 8px;
    gap: 7px 10px;
  }
  .pt-chart-toolbar__identity {
    width: 100%;
    gap: 5px;
  }
  .pt-chart-toolbar__title {
    font-size: var(--pt-fs-body);
  }
  .pt-chart-toolbar__subtitle {
    font-size: 10.5px;
  }
  .pt-chart-toolbar__values {
    width: 100%;
    gap: 2px 7px;
    font-size: 11px;
  }
  .pt-chart-inline-stat__label {
    font-size: 10px;
  }
  .pt-chart-container {
    height: 346px;
  }
  .pt-wick-chart { min-height: 318px; }
  .pt-chart-legend {
    padding: 8px 12px 10px;
    gap: 5px 10px;
  }
  .pt-chart-legend__item {
    font-size: 10.5px;
    min-width: 0;
  }
  .pt-chart-legend__item > span:nth-child(2) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 130px;
  }
  .pt-table-tools { align-items: stretch; }
  .pt-input { min-width: 0; width: 100%; }
  .pt-timeline { grid-template-columns: 1fr; }
  .pt-timeline-item {
    grid-template-columns: 56px 12px minmax(0, 1fr);
    gap: 0 10px;
  }
  .pt-timeline-item__kind { display: none; }
  .pt-table-wrap { overflow: visible; max-height: none; }
  .pt-table,
  .pt-table tbody,
  .pt-table tr,
  .pt-table td {
    display: block;
    width: 100%;
  }
  .pt-table thead { display: none; }
  .pt-table tbody tr {
    border-bottom: 1px solid var(--pt-border);
    cursor: pointer;
  }
  .pt-table tbody tr:last-child { border-bottom: none; }
  .pt-table tbody td {
    display: grid;
    grid-template-columns: minmax(92px, 34%) minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
    border-bottom: none;
    padding: 7px 14px;
    white-space: normal;
    text-align: left;
    min-width: 0;
    overflow-wrap: normal;
  }
  .pt-table tbody td:first-child { padding-top: 12px; }
  .pt-table tbody td:last-child { padding-bottom: 12px; }
  .pt-table tbody td::before {
    content: attr(data-label);
    color: var(--pt-text-subtle);
    font-family: var(--pt-font);
    font-size: var(--pt-fs-label);
    font-weight: 650;
    letter-spacing: 0.055em;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pt-table .pt-td--right { text-align: left; }
}
`

let injected = false
export function injectGlobalStyles() {
  if (injected || typeof document === 'undefined') return
  const el = document.createElement('style')
  el.setAttribute('data-portal-explorer', 'true')
  el.textContent = GLOBAL_CSS
  document.head.appendChild(el)
  injected = true
}

export const ACCENT_PALETTE = [
  '#00a6ff',
  '#26d0a8',
  '#f7b731',
  '#64d2ff',
  '#b78cff',
  '#ff7a59',
  '#ef5468',
  '#9ba4b5',
]
