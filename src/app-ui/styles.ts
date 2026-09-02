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

/* SQD Explorer · the "instrument sheet", themed by the host.
   ---------------------------------------------------------------------------
   Two token layers. The --sqd-* layer holds SQD Design System values for both
   themes (tokens/colors.css: dark default, [data-theme="sqd-light"]) expressed
   as light-dark() pairs. The semantic layer (--surface, --fg, --edge, status)
   reads the host's MCP Apps style variables first (--color-background-*,
   --color-text-*, --color-border-*) and falls back to the SQD pair, so inside
   Claude the structure is Claude's and the accents, chart palette and mono
   values stay SQD's. Inter for interface text at 510/400 unless the host
   supplies --font-sans; JetBrains Mono for every changing value, always. */
:root {
  color-scheme: light dark;

  --sqd-surface: light-dark(#ffffff, #08090a);
  --sqd-surface-raised: light-dark(#ffffff, #131316);
  --sqd-surface-elevated: light-dark(#f5f6f8, #1a1a1e);
  --sqd-fg: light-dark(#111115, #f7f8f8);
  --sqd-fg-value: light-dark(#111115, #d4d4d8);
  --sqd-fg-secondary: light-dark(#5e6073, #a8a8b1);
  --sqd-fg-muted: light-dark(#606775, #9898a1);
  --sqd-fg-disabled: light-dark(#b0b3c1, #52525b);
  --sqd-edge: light-dark(#e5e7eb, #1c1c20);
  --sqd-edge-strong: light-dark(#d1d5db, #242428);
  --sqd-edge-hover: light-dark(#9ca3af, #2e2e33);

  --surface: var(--color-background-primary, var(--sqd-surface));
  --surface-raised: var(--color-background-secondary, var(--sqd-surface-raised));
  --surface-elevated: var(--color-background-tertiary, var(--sqd-surface-elevated));
  --fg: var(--color-text-primary, var(--sqd-fg));
  --fg-value: var(--color-text-primary, var(--sqd-fg-value));
  --fg-secondary: var(--color-text-secondary, var(--sqd-fg-secondary));
  --fg-muted: var(--color-text-tertiary, var(--sqd-fg-muted));
  --fg-disabled: var(--color-text-disabled, var(--sqd-fg-disabled));
  --edge: var(--color-border-tertiary, var(--sqd-edge));
  --edge-strong: var(--color-border-secondary, var(--sqd-edge-strong));
  --edge-hover: var(--color-border-primary, var(--sqd-edge-hover));
  --edge-subtle: light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.06));
  --grid: light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.055));
  --axis: light-dark(rgb(0 0 0 / 0.16), rgb(255 255 255 / 0.14));

  /* Accent · SQD's own in both themes: indigo-400 on dark; on light the
     blue-600 text step (5.17:1 on white), because blue-500 is a fill accent
     and fails AA as 11px text. Light muted ink is the system's light
     comment step (#606775, 5.0:1 and above), since #8b8d9e sits under AA.
     The dashed reference line and the pinned value both read from
     --accent-line, so the masthead answer and the chart's last value are one
     grammar. */
  --accent: light-dark(#2563eb, #818cf8);
  --accent-hover: light-dark(#1d4ed8, #a5b4fc);
  --accent-on: light-dark(#ffffff, #08090a);
  --accent-muted: light-dark(rgb(59 130 246 / 0.10), rgb(129 140 248 / 0.12));
  --accent-subtle: light-dark(rgb(59 130 246 / 0.05), rgb(129 140 248 / 0.06));
  --accent-line: light-dark(rgb(59 130 246 / 0.55), rgb(129 140 248 / 0.45));
  --accent-ring: light-dark(rgb(59 130 246 / 0.30), rgb(99 102 241 / 0.30));

  /* Direction · up/down is a status encoding, so it reads the status
     tokens (tokens/chart-palette.json: "a chart that encodes STATUS uses the
     status tokens"). Fills carry marks; the -text steps carry labels. Direction
     never rides on colour alone: a sign, an arrow, or a column says it too. */
  --up: light-dark(#16a34a, #16a34a);
  --down: light-dark(#dc2626, #ef4444);
  --up-text: light-dark(#15803d, #4ade80);
  --down-text: light-dark(#b91c1c, #f87171);

  /* Status · -text is the on-surface foreground, -fill clears AA under a
     near-black label, -muted and -edge are tints. Host status colours win. */
  --success-text: var(--color-text-success, light-dark(#15803d, #4ade80));
  --success-fill: #16a34a;
  --success-muted: var(--color-background-success, light-dark(rgb(22 163 74 / 0.07), rgb(74 222 128 / 0.10)));
  --success-edge: var(--color-border-success, light-dark(rgb(22 163 74 / 0.15), rgb(74 222 128 / 0.18)));
  --warning-text: var(--color-text-warning, light-dark(#a1480a, #fbbf24));
  --warning-fill: light-dark(#d97706, #f59e0b);
  --warning-muted: var(--color-background-warning, light-dark(rgb(217 119 6 / 0.08), rgb(251 191 36 / 0.10)));
  --warning-edge: var(--color-border-warning, light-dark(rgb(217 119 6 / 0.18), rgb(251 191 36 / 0.18)));
  --danger-text: var(--color-text-danger, light-dark(#b91c1c, #f87171));
  --danger-fill: light-dark(#dc2626, #ef4444);
  --danger-muted: var(--color-background-danger, light-dark(rgb(220 38 38 / 0.07), rgb(248 113 113 / 0.10)));
  --danger-edge: var(--color-border-danger, light-dark(rgb(220 38 38 / 0.15), rgb(248 113 113 / 0.18)));
  --info-text: var(--color-text-info, light-dark(#2563eb, #818cf8));
  --info-muted: var(--color-background-info, light-dark(rgb(59 130 246 / 0.07), rgb(129 140 248 / 0.10)));
  --info-edge: var(--color-border-info, light-dark(rgb(59 130 246 / 0.15), rgb(129 140 248 / 0.18)));

  /* Categorical ramp · fixed order for co-equal series only, matching
     tokens/chart-palette.json (dark: line_bar_area steps; light: the
     sqd-light ramp). The accent is text/ranked-subject only and never enters
     these co-equal fills. */
  --chart-1: light-dark(#2563eb, #6366f1);
  --chart-2: light-dark(#b45309, #0891b2);
  --chart-3: light-dark(#006ca5, #d97706);
  --chart-4: light-dark(#b105c4, #16a34a);
  --chart-5: light-dark(#007732, #8b5cf6);
  --chart-other: light-dark(rgb(139 141 158 / 0.60), rgb(152 152 161 / 0.38));

  --font-sans: 'Inter SQD', Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --sqd-font-mono: 'JetBrains Mono SQD', 'JetBrains Mono', ui-monospace, monospace;

  --radius-sm: var(--border-radius-xs, 4px);
  --radius-md: var(--border-radius-sm, 6px);
  --radius-lg: var(--border-radius-md, 8px);
  --radius-xl: var(--border-radius-xl, 12px);

  --shadow-panel: light-dark(0 1px 2px rgb(0 0 0 / 0.05), 0 1px 2px rgb(0 0 0 / 0.4));
  --shadow-pop: light-dark(0 16px 40px -18px rgb(0 0 0 / 0.28), 0 16px 40px -18px rgb(0 0 0 / 0.72)), 0 0 0 1px var(--edge-strong);

  --duration-fast: 100ms;
  --duration-normal: 150ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-soft: cubic-bezier(0.25, 0.46, 0.45, 0.94);

  --safe-top: 0px;
  --safe-right: 0px;
  --safe-bottom: 0px;
  --safe-left: 0px;

  font-family: var(--font-sans);
  accent-color: var(--accent);
  caret-color: var(--accent);
  text-size-adjust: 100%;
}
:root[data-theme='dark'] { color-scheme: dark; }
:root[data-theme='light'] { color-scheme: light; }

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; min-width: 280px; background: var(--surface); color: var(--fg); }
body { font: 400 14px/1.55 var(--font-sans); letter-spacing: -0.011em; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
button, input { font: inherit; }
button { color: inherit; }
::selection { background: var(--accent-muted); color: var(--fg); }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--edge-strong); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: var(--edge-hover); }

/* The app fills the host container (Claude: no fixed breakpoints, design from
   320px up) and sizes its parts with container queries, so an inline card in a
   680px ChatGPT column and a 1440px fullscreen sheet both lay out from the
   same rules. Safe-area insets keep controls clear of the host composer. */
.sqd-app { container: sqd / inline-size; width: 100%; margin: 0 auto; padding: calc(10px + var(--safe-top)) calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left)); }
.sqd-app[data-mode='fullscreen'] { max-width: 1440px; padding-top: calc(14px + var(--safe-top)); padding-bottom: calc(28px + var(--safe-bottom)); }
.sqd-shell { display: grid; gap: 14px; min-width: 0; }
.sqd-shell > * { min-width: 0; }
.sqd-app[data-mode='fullscreen'] .sqd-shell { gap: 18px; }

/* ── Chrome ─────────────────────────────────────────────────────────────
   One quiet rail: the mark, the product label, the query chip that says what
   was asked, and the display-mode control. History only in fullscreen. */
.sqd-topbar { min-height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sqd-brand { display: inline-flex; align-items: center; gap: 9px; min-width: 0; flex: 1 1 auto; }
.sqd-mark { width: 20px; height: 20px; flex: 0 0 20px; display: grid; place-items: center; overflow: hidden; border-radius: var(--radius-sm); background: #000; box-shadow: 0 0 0 1px var(--edge-strong); }
.sqd-mark svg { width: 20px; height: 20px; display: block; }
.sqd-brand-copy { min-width: 0; display: flex; align-items: baseline; gap: 8px; }
.sqd-brand-name { font-size: 12.5px; line-height: 18px; font-weight: 510; letter-spacing: 0.01em; }
/* The base meta label carries mono row counts and page status (both hold a
   changing number). The product name beside the mark is static interface text,
   so it overrides to Inter. */
.sqd-brand-subtitle { color: var(--fg-muted); font: 400 11px/16px var(--sqd-font-mono); letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-brand-copy .sqd-brand-subtitle { font-family: var(--font-sans); font-size: 12px; letter-spacing: -0.006em; }
.sqd-query { min-width: 0; display: inline-flex; align-items: center; gap: 0; margin-left: 4px; border: 1px solid var(--edge); border-radius: var(--radius-md); padding: 2px 8px; color: var(--fg-secondary); font: 400 11px/16px var(--sqd-font-mono); letter-spacing: 0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-query span + span::before { content: '·'; margin: 0 6px; color: var(--fg-disabled); }
.sqd-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

.sqd-button { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--edge); border-radius: var(--radius-md); padding: 5px 11px; background: transparent; cursor: pointer; color: var(--fg-secondary); font-size: 12.5px; font-weight: 510; letter-spacing: -0.006em; white-space: nowrap; transition: color var(--duration-normal) var(--ease-soft), background-color var(--duration-normal) var(--ease-soft), border-color var(--duration-normal) var(--ease-soft), transform var(--duration-fast) var(--ease-out); }
.sqd-button:hover { background: var(--edge-subtle); color: var(--fg); border-color: var(--edge-hover); }
.sqd-button:active { transform: scale(0.97); transition-duration: 80ms; }
.sqd-button:focus-visible, .sqd-input:focus-visible, .sqd-sort:focus-visible, summary:focus-visible, .sqd-row-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sqd-button:disabled { color: var(--fg-disabled); cursor: not-allowed; background: transparent; border-color: var(--edge); }
.sqd-button--primary { background: var(--fg); color: var(--surface); border-color: var(--fg); }
.sqd-button--primary:hover { background: var(--fg); color: var(--surface); border-color: var(--fg); opacity: 0.9; }
.sqd-button--quiet { border-color: transparent; }
.sqd-followups { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sqd-followups--inline { justify-content: flex-start; padding-top: 2px; }
.sqd-followups .sqd-button { min-height: 32px; }

/* ── Masthead · the answer, pinned like a last value ─────────────────────
   The claim is the loudest thing on the sheet. The primary reading rides the
   right edge on a dashed accent reference line, the same line the chart pins
   its last value to. The eyebrow is the sqd-mono-label role: 11px uppercase
   mono. Everything sits on the ground and closes on a hairline. */
.sqd-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 32px; align-items: start; padding: 0 0 12px; border-bottom: 1px solid var(--edge); }
.sqd-eyebrow { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; color: var(--accent); font: 500 11px/16px var(--sqd-font-mono); text-transform: uppercase; letter-spacing: 0.08em; }
.sqd-eyebrow::before { content: ''; width: 2px; height: 12px; flex: 0 0 2px; border-radius: 1px; background: var(--accent); }
.sqd-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--success-fill); }
.sqd-dot--warning { background: var(--warning-fill); }
.sqd-dot--danger { background: var(--danger-fill); }
/* The answer runs the full width of its column: a 100-character claim is two
   lines at 760px and one at 1440px, never a ragged stack of four. */
.sqd-title { grid-column: 1; margin: 4px 0 0; max-width: 80ch; overflow-wrap: anywhere; font-size: clamp(17px, 2.3cqi, 22px); line-height: 1.22; font-weight: 510; letter-spacing: -0.02em; text-wrap: pretty; }
.sqd-app[data-mode='fullscreen'] .sqd-title { font-size: clamp(20px, 1.8cqi, 24px); line-height: 1.2; }
.sqd-title--id { font-family: var(--sqd-font-mono); font-weight: 510; letter-spacing: 0; font-size: clamp(15px, 1.7cqi, 19px); }
.sqd-app[data-mode='fullscreen'] .sqd-title--id { font-size: clamp(16px, 1.4cqi, 20px); }
.sqd-subtitle { grid-column: 1; max-width: 74ch; overflow-wrap: anywhere; margin: 6px 0 0; color: var(--fg-secondary); font-size: 13px; line-height: 19px; }
.sqd-hero-figure { grid-column: 2; grid-row: 2 / span 2; justify-self: end; text-align: right; padding-top: 4px; }
.sqd-hero-value { display: inline-block; padding-bottom: 6px; border-bottom: 1.5px dashed var(--accent-line); color: var(--fg); font: 500 28px/1.05 var(--sqd-font-mono); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sqd-hero-label { margin-top: 6px; color: var(--fg-muted); font: 500 10.5px/15px var(--sqd-font-mono); text-transform: uppercase; letter-spacing: 0.08em; }
.sqd-context { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 10px; color: var(--fg-muted); font: 400 11px/16px var(--sqd-font-mono); letter-spacing: 0.01em; }
.sqd-context span { display: inline-flex; align-items: center; border: 1px solid var(--edge); border-radius: var(--radius-sm); padding: 1px 7px; background: var(--surface); }
.sqd-app[data-mode='inline'] .sqd-hero { padding-bottom: 10px; }
.sqd-app[data-mode='inline'] .sqd-title { font-size: clamp(16px, 2.1cqi, 19px); line-height: 1.25; }
.sqd-app[data-mode='inline'] .sqd-hero-value { font-size: 24px; }
.sqd-app[data-mode='inline'] .sqd-notices--after { margin-top: -4px; }
.sqd-app[data-mode='inline'] .sqd-context span:nth-child(n+5):not(.sqd-context--warning):not(.sqd-context--danger) { display: none; }
.sqd-context .sqd-context--warning { color: var(--warning-text); border-color: var(--warning-edge); background: var(--warning-muted); }
.sqd-context .sqd-context--danger { color: var(--danger-text); border-color: var(--danger-edge); background: var(--danger-muted); }

/* ── Key metrics · one row of instrument readouts ───────────────────────── */
.sqd-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 16px; }
.sqd-metric { min-width: 0; padding: 8px 0 9px; border-bottom: 1px solid var(--edge); }
.sqd-metric + .sqd-metric { border-left: 1px solid var(--edge); padding-left: 16px; }
.sqd-metric-label { color: var(--fg-muted); font: 500 10.5px/15px var(--sqd-font-mono); text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-metric-value { margin-top: 3px; color: var(--fg-value); font: 500 17px/24px var(--sqd-font-mono); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-app[data-mode='fullscreen'] .sqd-metric-value { font-size: 20px; line-height: 26px; }
.sqd-metric--primary .sqd-metric-value { color: var(--fg); }
.sqd-metric-subtitle { margin-top: 2px; color: var(--fg-muted); font-size: 11px; line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Panels · regions of one sheet, divided rather than boxed ────────────
   Inline, the host already frames the card, so a panel is a section: a mono
   label, a hairline, the instrument. Fullscreen, panels sit on the raised
   surface at the SQD pane radius and share one workspace grid. */
.sqd-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; align-items: start; }
.sqd-card { min-width: 0; overflow: hidden; }
.sqd-grid .sqd-card { grid-column: span 12; }
.sqd-grid .sqd-card--half { grid-column: span 6; }
.sqd-grid--dashboard:not(.sqd-grid--single) .sqd-card:not(.sqd-card--primary) { grid-column: span 6; }
.sqd-grid--split:not(.sqd-grid--single) .sqd-card:not(.sqd-card--primary) { grid-column: span 6; }
.sqd-grid--chart_focus .sqd-card { grid-column: span 12; }
.sqd-grid--compact { gap: 14px; }
.sqd-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 0 0 8px; border-bottom: 1px solid var(--edge); }
.sqd-card-title { margin: 0; color: var(--fg-secondary); font: 500 11px/16px var(--sqd-font-mono); text-transform: uppercase; letter-spacing: 0.06em; }
.sqd-card-subtitle { max-width: 70ch; margin: 2px 0 0; color: var(--fg-muted); font-size: 11.5px; line-height: 16px; }
.sqd-card-body { padding: 12px 0 0; min-width: 0; }
.sqd-app[data-mode='fullscreen'] .sqd-card { border: 1px solid var(--edge); border-radius: var(--radius-xl); background: var(--surface-raised); box-shadow: var(--shadow-panel); }
.sqd-app[data-mode='fullscreen'] .sqd-card--primary { border-color: var(--edge-strong); box-shadow: var(--shadow-panel), inset 2px 0 0 var(--accent); }
.sqd-app[data-mode='fullscreen'] .sqd-card-head { padding: 12px 16px 10px; }
.sqd-app[data-mode='fullscreen'] .sqd-card-body { padding: 14px 16px 16px; }

/* Fullscreen workspace · the primary instrument left, readouts and secondary
   panels right, evidence ledger full width beneath. */
.sqd-workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; align-items: start; }
.sqd-workspace-main, .sqd-workspace-side, .sqd-workspace-ledger { display: grid; gap: 16px; min-width: 0; }
.sqd-workspace-ledger { grid-column: 1 / -1; }
.sqd-workspace-side .sqd-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sqd-workspace-side .sqd-metric:nth-child(odd) { border-left: 0; padding-left: 0; }
.sqd-workspace-side .sqd-metric:nth-child(even) { border-left: 1px solid var(--edge); padding-left: 16px; }
.sqd-workspace-side .sqd-card { grid-column: auto; }

/* ── Charts · the TradingView grammar ───────────────────────────────────
   Right value scale, whisper grid, mono ticks in the muted axis ink, one
   accent series with everything else muted, the last value pinned to the axis
   as an accent pill on a dashed reference line. Gaps stay gaps; the forming
   candle stays hollow and labelled. */
.sqd-chart-wrap { position: relative; width: 100%; }
.sqd-chart-range { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(84px, 0.7fr) minmax(84px, 0.7fr) auto auto; align-items: center; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--edge); }
.sqd-chart-range-copy { color: var(--fg-muted); font: 400 11px/16px var(--sqd-font-mono); }
.sqd-range { width: 100%; accent-color: var(--accent); }
.sqd-chart { display: block; width: 100%; height: auto; overflow: visible; }
.sqd-app[data-mode='inline'] .sqd-chart-range { display: none; }
.sqd-chart-grid { stroke: var(--grid); stroke-width: 1; }
.sqd-chart-axis { stroke: var(--axis); stroke-width: 1; }
.sqd-chart-zero { stroke: var(--fg-disabled); stroke-width: 1; }
.sqd-chart-line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.sqd-chart-area { fill: var(--accent-subtle); }
.sqd-chart-series-area { opacity: 0.82; stroke: var(--surface-raised); stroke-width: 1; }
.sqd-chart-bar { fill: var(--chart-1); }
.sqd-chart-bar--up { fill: var(--up); }
.sqd-chart-bar--down { fill: var(--down); }
.sqd-chart-label { fill: var(--fg-muted); font: 400 11px var(--sqd-font-mono); font-variant-numeric: tabular-nums; }
.sqd-chart-axis-title { fill: var(--fg-muted); font: 400 10.5px var(--font-sans); letter-spacing: 0; text-transform: uppercase; }
.sqd-chart-last-line { stroke: var(--accent-line); stroke-width: 1; stroke-dasharray: 3 4; }
.sqd-chart-last-pill { fill: var(--accent); }
.sqd-chart-last-value { fill: var(--accent-on); font: 600 11px/1 var(--sqd-font-mono); font-variant-numeric: tabular-nums; }
.sqd-chart-crosshair { stroke: var(--fg-secondary); stroke-width: 1; stroke-dasharray: 2 3; pointer-events: none; opacity: 0.6; }
.sqd-chart-hit { fill: transparent; pointer-events: all; outline: none; }
.sqd-chart-hit:focus-visible { fill: var(--accent-subtle); stroke: var(--accent); stroke-width: 1; }
.sqd-chart-tooltip { position: absolute; z-index: 2; top: 8px; max-width: min(360px, 80%); transform: translateX(-50%); border: 1px solid var(--edge-strong); border-radius: var(--radius-md); padding: 8px 10px; background: var(--surface); color: var(--fg-value); box-shadow: var(--shadow-pop); font: 400 11px/16px var(--sqd-font-mono); pointer-events: none; }
.sqd-chart-legend { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-bottom: 10px; }
.sqd-chart-legend-item { min-height: 28px; display: inline-flex; align-items: center; gap: 7px; border: 1px solid transparent; border-radius: var(--radius-md); padding: 4px 9px; background: transparent; color: var(--fg); cursor: pointer; font: 400 12px/16px var(--font-sans); letter-spacing: -0.006em; transition: background-color var(--duration-normal) var(--ease-soft); }
.sqd-chart-legend-item:hover { background: var(--edge-subtle); }
.sqd-chart-legend-item[aria-pressed='false'] { color: var(--fg-muted); text-decoration: line-through; }
.sqd-chart-legend-item[aria-pressed='false'] .sqd-chart-legend-swatch { opacity: 0.3; }
.sqd-chart-legend-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sqd-chart-legend-swatch { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 2px; }
.sqd-chart-empty { min-height: 160px; display: grid; place-items: center; color: var(--fg-muted); text-align: center; }

/* ── Market terminal · the dominant price chart ─────────────────────────── */
.sqd-candle-terminal { position: relative; width: 100%; }
.sqd-candle-readout { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin-bottom: 10px; padding: 6px 10px; border: 1px solid var(--edge); border-radius: var(--radius-md); background: var(--surface); font: 500 12px/16px var(--sqd-font-mono); font-variant-numeric: tabular-nums; color: var(--fg-value); }
.sqd-candle-readout-time { color: var(--fg); font-weight: 510; }
.sqd-candle-readout-pair { display: inline-flex; align-items: baseline; gap: 5px; }
.sqd-candle-readout-key { color: var(--fg-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
.sqd-candle-readout-value[data-direction='up'] { color: var(--up-text); }
.sqd-candle-readout-value[data-direction='down'] { color: var(--down-text); }
.sqd-candle-readout-flag { color: var(--warning-text); font-size: 11px; }
.sqd-candle-chart { position: relative; width: 100%; height: 260px; }
.sqd-app[data-mode='fullscreen'] .sqd-candle-chart { height: 420px; }
.sqd-candle-canvas { position: absolute; inset: 0; }
.sqd-chart-hits { position: absolute; inset: 0 0 26px 0; z-index: 2; }
button.sqd-chart-hit { position: absolute; top: 0; height: 100%; margin: 0; border: 0; border-radius: 3px; padding: 0; background: transparent; cursor: pointer; outline: none; }
button.sqd-chart-hit:focus-visible { background: var(--accent-subtle); box-shadow: inset 0 0 0 1.5px var(--accent); }
button.sqd-chart-hit[aria-pressed='true'] { background: var(--accent-subtle); box-shadow: inset 0 0 0 1px var(--accent-line); }
.sqd-candle-pill { position: absolute; right: 0; z-index: 3; transform: translateY(-50%); border-radius: 5px; padding: 3px 7px; background: var(--accent); color: var(--accent-on); font: 600 11px/1 var(--sqd-font-mono); font-variant-numeric: tabular-nums; pointer-events: none; }
.sqd-chart-volume-caption { position: absolute; left: 2px; z-index: 2; color: var(--fg-muted); font: 510 9px/12px var(--font-sans); letter-spacing: 0.1em; pointer-events: none; }
.sqd-candle-chart .sqd-chart-tooltip { z-index: 4; }
.sqd-chart-attribution { display: block; width: fit-content; margin: 6px 2px 0 auto; color: var(--fg-muted); font: 400 10px/14px var(--font-sans); text-decoration: none; }
.sqd-chart-attribution:hover { color: var(--fg-secondary); text-decoration: underline; }
.sqd-chart-attribution:focus-visible { border-radius: 2px; outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── Ranked bars · one accent series, quiet track ──────────────────────── */
.sqd-ranked { display: grid; }
.sqd-ranked-row { min-height: 34px; display: grid; grid-template-columns: minmax(104px, 0.9fr) minmax(120px, 2fr) auto; align-items: center; gap: 12px; border-bottom: 1px solid var(--edge); }
.sqd-ranked-row:last-child { border-bottom: 0; }
.sqd-ranked-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); font-size: 12.5px; font-weight: 510; letter-spacing: -0.006em; }
.sqd-ranked-label--id { font: 400 12px var(--sqd-font-mono); letter-spacing: 0; font-variant-numeric: slashed-zero; }
.sqd-ranked-track { height: 6px; overflow: hidden; background: var(--surface-elevated); border-radius: 9999px; }
.sqd-ranked-fill { height: 100%; background: var(--accent); border-radius: inherit; }
.sqd-ranked-value { color: var(--fg-value); font: 400 12.5px/18px var(--sqd-font-mono); font-variant-numeric: tabular-nums; }

/* ── Evidence table · the ledger apparatus, deliberately calm ───────────── */
.sqd-table-tools { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
.sqd-input { width: min(100%, 300px); min-height: 32px; border: 1px solid var(--edge); border-radius: var(--radius-md); padding: 5px 10px; background: var(--surface); color: var(--fg); font-size: 12.5px; transition: border-color var(--duration-normal) var(--ease-soft), box-shadow var(--duration-normal) var(--ease-soft); }
.sqd-input::placeholder { color: var(--fg-disabled); }
.sqd-input:hover { border-color: var(--edge-hover); }
.sqd-input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-muted); }
.sqd-table-wrap { width: 100%; overflow: auto; }
.sqd-table-wrap:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-sm); }
.sqd-table { width: 100%; min-width: 640px; border-collapse: collapse; font-size: 12.5px; line-height: 18px; }
.sqd-table th, .sqd-table td { min-width: 72px; max-width: 320px; height: 34px; padding: 7px 14px 7px 0; border-bottom: 1px solid var(--edge); text-align: left; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-table th[data-align='right'], .sqd-table td[data-align='right'] { width: 1%; }
.sqd-table[data-cols='1'], .sqd-table[data-cols='2'], .sqd-table[data-cols='3'] { width: auto; min-width: min(100%, 520px); }
.sqd-table[data-cols='1'] [data-align='right'], .sqd-table[data-cols='2'] [data-align='right'], .sqd-table[data-cols='3'] [data-align='right'] { width: auto; }
.sqd-table th:last-child, .sqd-table td:last-child { padding-right: 0; }
.sqd-table th { position: sticky; top: 0; z-index: 1; background: var(--surface); color: var(--fg-muted); border-bottom: 1px solid var(--edge-strong); font: 510 12px/16px var(--font-sans); letter-spacing: normal; }
.sqd-app[data-mode='fullscreen'] .sqd-table th { background: var(--surface-raised); }
.sqd-table tr:last-child td { border-bottom: 0; }
.sqd-table tbody tr { transition: background-color var(--duration-normal) var(--ease-soft); }
.sqd-table tbody tr:hover, .sqd-table tbody tr:focus-within { background: var(--surface-elevated); }
.sqd-table tbody tr[data-selected='true'] { background: var(--accent-muted); box-shadow: inset 2px 0 0 var(--accent); }
.sqd-table td { color: var(--fg-secondary); }
.sqd-table td[data-align='right'] { text-align: right; font-family: var(--sqd-font-mono); font-variant-numeric: tabular-nums; color: var(--fg-value); font-size: 12px; }
.sqd-table th[data-align='right'] { text-align: right; }
.sqd-table td[data-signed='positive'] { color: var(--up-text); }
.sqd-table td[data-signed='negative'] { color: var(--down-text); }
.sqd-sort, .sqd-row-button { width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: inherit; cursor: pointer; }
.sqd-sort { display: inline-flex; align-items: center; gap: 5px; }
.sqd-table th[aria-sort='ascending'] .sqd-sort::after { content: '\\2191'; color: var(--accent); }
.sqd-table th[aria-sort='descending'] .sqd-sort::after { content: '\\2193'; color: var(--accent); }
.sqd-row-button { color: var(--fg); font-family: var(--sqd-font-mono); font-size: 12px; letter-spacing: 0; }
.sqd-row-button:hover { color: var(--accent); }
.sqd-link { color: inherit; text-decoration: underline; text-decoration-color: var(--edge-strong); text-decoration-thickness: 1px; text-underline-offset: 3px; border-radius: 2px; }
.sqd-link:hover { color: var(--accent); text-decoration-color: currentColor; }
.sqd-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sqd-title .sqd-link { text-decoration-color: transparent; }
.sqd-title .sqd-link:hover { text-decoration-color: currentColor; }
.sqd-hash { font-family: var(--sqd-font-mono); font-size: 12px; font-variant-numeric: tabular-nums slashed-zero; font-variant-ligatures: none; letter-spacing: 0; overflow-wrap: anywhere; }
.sqd-table-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 10px; }
.sqd-table-pagination .sqd-brand-subtitle { font-family: var(--sqd-font-mono); text-transform: none; letter-spacing: 0.01em; }
.sqd-table-more { margin: 8px 0 0; color: var(--fg-muted); font: 400 11px/16px var(--sqd-font-mono); }

/* ── Activity timeline · direction shown by dot, sign, and column ───────── */
.sqd-timeline { display: grid; }
.sqd-event { min-height: 40px; display: grid; grid-template-columns: minmax(64px, auto) 8px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 7px 0; border-bottom: 1px solid var(--edge); }
.sqd-event:last-child { border-bottom: 0; }
.sqd-event-time { order: -1; color: var(--fg-muted); font: 400 11.5px/18px var(--sqd-font-mono); letter-spacing: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sqd-event-dot { width: 6px; height: 6px; margin-top: 6px; border-radius: 50%; background: var(--edge-hover); }
.sqd-event-dot--in { background: var(--up); }
.sqd-event-dot--out { background: var(--down); }
.sqd-event-title { min-width: 0; font-size: 12.5px; line-height: 18px; font-weight: 510; letter-spacing: -0.006em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-event-subtitle { color: var(--fg-muted); font: 400 11.5px/16px var(--sqd-font-mono); letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-event-value { text-align: right; font: 500 12px/18px var(--sqd-font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sqd-event-value--in { color: var(--up-text); }
.sqd-event-value--out { color: var(--down-text); }
.sqd-event-value--flat { color: var(--fg-value); font-weight: 400; }

/* ── Detail lists ──────────────────────────────────────────────────────── */
.sqd-stat-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; }
.sqd-stat { min-height: 34px; display: flex; justify-content: space-between; gap: 12px; align-items: center; border-bottom: 1px solid var(--edge); }
.sqd-stat-label { color: var(--fg-secondary); font-size: 12.5px; }
.sqd-stat-value { color: var(--fg-value); font: 400 12.5px/18px var(--sqd-font-mono); font-variant-numeric: tabular-nums; text-align: right; }

/* ── Notices · three tiers, one component ────────────────────────────────
   info is neutral (pagination captions, a forming candle); caution is amber
   and reserved for anything that reduces trust in the numbers (partial
   coverage, sampling, a stale head); error is red. Amber never decorates. */
.sqd-notices { display: grid; gap: 6px; }
.sqd-notice { display: flex; align-items: flex-start; gap: 10px; border-left: 2px solid var(--edge-strong); border-radius: 0 var(--radius-md) var(--radius-md) 0; padding: 7px 12px; background: var(--surface-elevated); color: var(--fg-secondary); font-size: 12px; line-height: 18px; }
.sqd-notice--caution { border-left-color: var(--warning-fill); background: var(--warning-muted); color: var(--warning-text); }
.sqd-notice--danger { border-left-color: var(--danger-fill); background: var(--danger-muted); color: var(--danger-text); }
.sqd-notice-copy { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.sqd-notice .sqd-actions { flex: 0 0 auto; }
.sqd-notice .sqd-button { min-height: 26px; padding: 2px 9px; font-size: 11.5px; color: inherit; border-color: currentColor; }
.sqd-display-limit { margin: 10px 0 0; color: var(--fg-muted); font: 400 11px/16px var(--sqd-font-mono); }
.sqd-display-limit--caution { border-left: 2px solid var(--warning-fill); border-radius: 0 var(--radius-md) var(--radius-md) 0; padding: 7px 12px; background: var(--warning-muted); color: var(--warning-text); font: 400 12px/18px var(--font-sans); }

/* ── Pending · the last result stays, the sheet reports it is working ───── */
.sqd-progress { position: relative; height: 2px; overflow: hidden; margin: -8px 0 -6px; background: var(--edge); border-radius: 1px; }
.sqd-progress::after { content: ''; position: absolute; inset: 0; width: 40%; background: var(--accent); border-radius: 1px; animation: sqd-progress 1.1s var(--ease-soft) infinite; }
@keyframes sqd-progress { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
.sqd-shell[aria-busy='true'] .sqd-grid, .sqd-shell[aria-busy='true'] .sqd-workspace, .sqd-shell[aria-busy='true'] .sqd-metrics { opacity: 0.55; transition: opacity var(--duration-normal) var(--ease-soft); }
.sqd-shell[aria-busy='true'] .sqd-followups .sqd-button { pointer-events: none; }

/* ── Evidence receipt · the sheet's footer band ─────────────────────────── */
.sqd-receipt { display: flex; align-items: center; justify-content: space-between; gap: 12px 20px; flex-wrap: wrap; border-top: 1px solid var(--edge); padding: 12px 0 0; }
.sqd-receipt-copy { min-width: 0; display: flex; align-items: center; gap: 6px 14px; flex-wrap: wrap; }
.sqd-receipt-title { margin: 0; color: var(--fg-secondary); font: 500 11px/16px var(--sqd-font-mono); text-transform: uppercase; letter-spacing: 0.06em; }
.sqd-receipt-meta { margin: 0; color: var(--fg-muted); font: 400 11px/16px var(--sqd-font-mono); letter-spacing: 0.01em; overflow-wrap: anywhere; }
.sqd-receipt .sqd-button { min-height: 27px; padding: 3px 9px; font-size: 11.5px; }
.sqd-receipt-line { display: flex; flex-wrap: wrap; gap: 2px 8px; margin: 0; padding-top: 10px; border-top: 1px solid var(--edge); color: var(--fg-muted); font: 400 10.5px/15px var(--sqd-font-mono); letter-spacing: 0.01em; }
.sqd-receipt-line span + span::before { content: '·'; margin-right: 8px; color: var(--fg-disabled); }

/* ── States ────────────────────────────────────────────────────────────── */
.sqd-empty { display: grid; gap: 4px; padding: 18px 0 8px; }
.sqd-empty h2 { margin: 0; font-size: 16px; line-height: 22px; font-weight: 510; letter-spacing: -0.02em; }
.sqd-empty p { max-width: 64ch; margin: 0; color: var(--fg-secondary); font-size: 13px; line-height: 20px; }
.sqd-empty .sqd-followups { margin-top: 10px; }
.sqd-skeleton { position: relative; overflow: hidden; min-height: 56px; border: 1px solid var(--edge); background: var(--surface-raised); border-radius: var(--radius-lg); }
.sqd-skeleton--line { min-height: 18px; max-width: 60%; }
.sqd-skeleton--panel { min-height: 220px; }
.sqd-skeleton::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, var(--edge-subtle), transparent); animation: sqd-shimmer 1.3s infinite; }
@keyframes sqd-shimmer { to { transform: translateX(100%); } }

.sqd-raw { border-top: 1px solid var(--edge); overflow: hidden; }
.sqd-raw summary { min-height: 36px; cursor: pointer; padding: 10px 0; color: var(--fg-muted); font-size: 12.5px; font-weight: 510; }
.sqd-raw summary:hover { color: var(--fg-secondary); }
.sqd-raw pre { max-height: 360px; margin: 0 0 4px; overflow: auto; border: 1px solid var(--edge); border-radius: var(--radius-lg); padding: 14px; background: var(--surface); color: var(--fg-value); font: 400 12px/1.7 var(--sqd-font-mono); letter-spacing: 0; white-space: pre-wrap; word-break: break-word; }

.sqd-dialog { width: min(680px, calc(100vw - 28px)); max-height: min(720px, calc(100vh - 28px)); overflow: hidden; border: 1px solid var(--edge-strong); border-radius: var(--radius-xl); padding: 0; background: var(--surface-raised); color: var(--fg); box-shadow: var(--shadow-pop); }
.sqd-dialog::backdrop { background: rgb(0 0 0 / 0.6); }
.sqd-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--edge); }
.sqd-dialog-title { margin: 0; font-size: 13px; line-height: 18px; font-weight: 510; }
.sqd-dialog-body { max-height: 620px; overflow: auto; padding: 16px; }
.sqd-dialog pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: var(--fg-value); font: 400 12px/1.7 var(--sqd-font-mono); }
.sqd-dialog-meta { margin: 0 0 12px; color: var(--fg-muted); font: 400 11px/16px var(--sqd-font-mono); overflow-wrap: anywhere; }

.sqd-footer { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0 0; border-top: 1px solid var(--edge); color: var(--fg-muted); font: 400 11px/16px var(--sqd-font-mono); letter-spacing: 0.03em; }
.sqd-footer a { color: var(--fg-muted); text-decoration: none; }
.sqd-footer a:hover { color: var(--fg-secondary); text-decoration: underline; }
.sqd-visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }

.sqd-preview-picker { max-width: 1440px; }

/* ── Container-responsive · widths are the host's, not the viewport's ──── */
@container sqd (min-width: 1100px) {
  .sqd-app[data-mode='fullscreen'] .sqd-workspace--split { grid-template-columns: minmax(0, 8fr) minmax(0, 4fr); }
}
@container sqd (max-width: 600px) {
  .sqd-hero { grid-template-columns: 1fr; gap: 4px 0; }
  .sqd-hero-figure { grid-column: 1; grid-row: auto; justify-self: start; text-align: left; padding-top: 8px; }
}
@container sqd (max-width: 820px) {
  .sqd-title { max-width: none; }
  .sqd-grid .sqd-card--half { grid-column: span 12; }
  .sqd-grid--dashboard .sqd-card:not(.sqd-card--primary), .sqd-grid--split .sqd-card:not(.sqd-card--primary) { grid-column: span 12; }
  .sqd-stat-list { grid-template-columns: 1fr; }
  .sqd-chart-range { grid-template-columns: 1fr 1fr; }
  .sqd-chart-range-copy { grid-column: 1 / -1; }
}
@container sqd (max-width: 520px) {
  .sqd-topbar { min-height: 30px; flex-wrap: wrap; }
  /* A phone inline card is a summary: the answer, the readout, any warning,
     two metrics, and the instrument. Fullscreen keeps every chip and card. */
  .sqd-app[data-mode='inline'] .sqd-metrics .sqd-metric:nth-child(n+3) { display: none; }
  .sqd-app[data-mode='inline'] .sqd-context span:not(.sqd-context--warning):not(.sqd-context--danger) { display: none; }
  .sqd-app[data-mode='inline'] .sqd-context:not(:has(.sqd-context--warning, .sqd-context--danger)) { display: none; }
  /* Hide the secondary product label rather than truncate it to a broken
     word; the SQD name and official mark stay. */
  .sqd-brand-copy .sqd-brand-subtitle { display: none; }
  .sqd-query { display: none; }
  .sqd-actions { gap: 4px; }
  .sqd-hero-value { font-size: 24px; }
  .sqd-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sqd-metric + .sqd-metric { border-left: 0; padding-left: 0; }
  .sqd-metric:nth-child(even) { border-left: 1px solid var(--edge); padding-left: 14px; }
  .sqd-metric-value { font-size: 16px; }
  .sqd-candle-chart { height: 220px; }
  .sqd-table-tools { align-items: stretch; flex-direction: column; gap: 6px; }
  .sqd-table-tools .sqd-brand-subtitle { align-self: flex-end; max-width: 100%; }
  .sqd-input { font-size: 16px; width: 100%; }
  .sqd-table-pagination { justify-content: space-between; }
  .sqd-event { grid-template-columns: 8px minmax(0, 1fr) auto; }
  .sqd-event-time { order: 0; grid-column: 2 / -1; }
  .sqd-ranked-row { grid-template-columns: minmax(84px, 0.8fr) minmax(72px, 1.2fr) auto; gap: 8px; }
  .sqd-receipt, .sqd-footer { display: grid; gap: 6px; }
  .sqd-followups .sqd-button { min-height: 44px; flex: 1 1 auto; justify-content: center; }
}
@media (max-width: 520px) {
  .sqd-app { padding-inline: calc(12px + var(--safe-right)) calc(12px + var(--safe-left)); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
`
