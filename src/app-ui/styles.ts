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

/* SQD Explorer · the "instrument sheet".
   ---------------------------------------------------------------------------
   Every value is an exact SQD Design System token (tokens/colors.css,
   typography.css, spacing.css, effects.css) or the measured Chart Standards
   (guidelines/charts.html, tokens/chart-palette.json). Dark-first ground
   #08090a. Inter for interface text at weight 510/400; JetBrains Mono for
   every changing value: prices, counts, block numbers, addresses, hashes,
   timestamps, axis ticks. Indigo #818cf8 is accent-as-text only; indigo-500
   #6366f1 never carries a label (rings and category fills only). The answer
   is primary and pinned like a chart's last value; exact evidence is quiet,
   labelled apparatus beneath it, never card soup. */
:root {
  color-scheme: dark;

  /* Surfaces · the OLED ground and its two raised steps (tokens/colors.css). */
  --surface: #08090a;
  --surface-raised: #131316;
  --surface-elevated: #1a1a1e;

  /* Foreground · four measured steps on the ground, plus a value ink for
     tabular data that sits one notch under primary (--p-neutral-800). */
  --fg: #f7f8f8;
  --fg-value: #d4d4d8;
  --fg-secondary: #a8a8b1;
  --fg-muted: #9898a1;
  --fg-disabled: #52525b;

  /* Edges · hairlines, borders, and the chart's whisper grid / axis. */
  --edge: #1c1c20;
  --edge-strong: #242428;
  --edge-hover: #2e2e33;
  --edge-subtle: rgb(255 255 255 / 0.06);
  --grid: rgb(255 255 255 / 0.055);
  --axis: rgb(255 255 255 / 0.14);

  /* Accent · indigo, text role. The dashed reference line and the pinned
     value both read from --accent-line, so the masthead answer and the
     chart's last-value line are one grammar. */
  --accent: #818cf8;
  --accent-hover: #a5b4fc;
  --accent-muted: rgb(129 140 248 / 0.12);
  --accent-subtle: rgb(129 140 248 / 0.06);
  --accent-line: rgb(129 140 248 / 0.45);
  --accent-ring: rgb(99 102 241 / 0.30);

  /* Direction · cool up / warm down from the diverging palette
     (tokens/chart-palette.json). Status green/red stay reserved for status,
     so price direction never borrows them, and never rides on colour alone. */
  --up: #0891b2;
  --down: #d97706;

  /* Status · fills clear AA under a near-black label; text steps are the
     on-dark foregrounds. */
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

  /* Categorical ramp · fixed order for co-equal series only, matching
     tokens/chart-palette.json categorical.line_bar_area.steps exactly:
     indigo-500, cyan-600, amber-600, green-600, purple-500. Every step is a
     production ramp value. The accent #818cf8 is text/ranked-subject only and
     never enters these co-equal fills. */
  --chart-1: #6366f1;
  --chart-2: #0891b2;
  --chart-3: #d97706;
  --chart-4: #16a34a;
  --chart-5: #8b5cf6;
  --chart-other: rgb(152 152 161 / 0.38);

  --font-sans: 'Inter SQD', Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono SQD', 'JetBrains Mono', ui-monospace, monospace;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  --shadow-panel: 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-pop: 0 16px 40px -18px rgb(0 0 0 / 0.72), 0 0 0 1px var(--edge-strong);

  --duration-fast: 100ms;
  --duration-normal: 150ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-soft: cubic-bezier(0.25, 0.46, 0.45, 0.94);

  font-family: var(--font-sans);
  accent-color: var(--accent);
  caret-color: var(--accent);
  text-size-adjust: 100%;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; min-width: 280px; background: var(--surface); color: var(--fg); }
body { font: 400 14px/1.55 var(--font-sans); letter-spacing: -0.011em; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
button, input { font: inherit; }
button { color: inherit; }
::selection { background: rgb(99 102 241 / 0.20); color: #f4f4f5; }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--edge-strong); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: var(--edge-hover); }

.sqd-app { width: 100%; max-width: 1160px; margin: 0 auto; padding: 14px 24px 24px; }
.sqd-shell { display: grid; gap: 18px; }

/* ── Chrome ─────────────────────────────────────────────────────────────
   The top rail is quiet: the black-ground mark, a mono product label, and
   session controls. It reads as instrument chrome, not a website navbar. */
.sqd-topbar { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.sqd-brand { display: inline-flex; align-items: center; gap: 9px; min-width: 0; }
.sqd-mark { width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center; overflow: hidden; border-radius: var(--radius-sm); background: #000; box-shadow: 0 0 0 1px var(--edge-strong); }
.sqd-mark svg { width: 22px; height: 22px; display: block; }
.sqd-brand-copy { min-width: 0; display: flex; align-items: baseline; gap: 8px; }
.sqd-brand-name { font-size: 13px; line-height: 18px; font-weight: 510; letter-spacing: 0.01em; }
/* The base meta label carries mono row counts and page status (both hold a
   changing number). The product name beside the mark is static interface text,
   so it overrides to Inter. */
.sqd-brand-subtitle { color: var(--fg-muted); font: 400 11px/16px var(--font-mono); letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-brand-copy .sqd-brand-subtitle { font-family: var(--font-sans); font-size: 12px; letter-spacing: -0.006em; }
.sqd-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

.sqd-button { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--edge); border-radius: var(--radius-md); padding: 5px 11px; background: transparent; cursor: pointer; color: var(--fg-secondary); font-size: 12.5px; font-weight: 510; letter-spacing: -0.006em; white-space: nowrap; transition: color var(--duration-normal) var(--ease-soft), background-color var(--duration-normal) var(--ease-soft), border-color var(--duration-normal) var(--ease-soft), transform var(--duration-fast) var(--ease-out); }
.sqd-button:hover { background: var(--edge-subtle); color: var(--fg); border-color: var(--edge-hover); }
.sqd-button:active { transform: scale(0.97); transition-duration: 80ms; }
.sqd-button:focus-visible, .sqd-input:focus-visible, .sqd-sort:focus-visible, summary:focus-visible, .sqd-row-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sqd-button:disabled { color: var(--fg-disabled); cursor: not-allowed; background: transparent; border-color: var(--edge); }
.sqd-button--primary { background: var(--fg); color: var(--surface); border-color: var(--fg); }
.sqd-button--primary:hover { background: #fff; color: var(--surface); border-color: #fff; }
.sqd-followups { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── Masthead · the answer, pinned like a last value ─────────────────────
   The claim is the loudest thing on the sheet. The primary reading rides the
   right edge on a dashed accent reference line, the same line the chart pins
   its last value to. A single accent tick marks the eyebrow as the head of
   the reading. Everything sits on the ground and closes on a hairline. */
.sqd-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 40px; align-items: start; padding: 2px 0 16px; border-bottom: 1px solid var(--edge); }
.sqd-eyebrow { grid-column: 1 / -1; display: flex; align-items: center; gap: 9px; color: var(--accent); font: 510 11px/14px var(--font-sans); text-transform: uppercase; letter-spacing: 0.14em; }
.sqd-eyebrow::before { content: ''; width: 2px; height: 12px; flex: 0 0 2px; border-radius: 1px; background: var(--accent); }
.sqd-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--success-fill); }
.sqd-dot--warning { background: var(--warning-fill); }
.sqd-dot--danger { background: var(--danger-fill); }
.sqd-title { grid-column: 1; margin: 6px 0 0; max-width: 22ch; font-size: clamp(20px, 2.6vw, 27px); line-height: 1.16; font-weight: 510; letter-spacing: -0.024em; text-wrap: balance; }
.sqd-subtitle { grid-column: 1; max-width: 74ch; margin: 8px 0 0; color: var(--fg-secondary); font-size: 13px; line-height: 20px; }
.sqd-hero-figure { grid-column: 2; grid-row: 2 / span 2; justify-self: end; text-align: right; padding-top: 4px; }
.sqd-hero-value { display: inline-block; padding-bottom: 7px; border-bottom: 1.5px dashed var(--accent-line); color: var(--fg); font: 500 30px/1.05 var(--font-mono); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sqd-hero-label { margin-top: 7px; color: var(--fg-muted); font-size: 11px; line-height: 15px; text-transform: uppercase; letter-spacing: 0.08em; }
.sqd-context { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 3px 8px; margin-top: 14px; color: var(--fg-muted); font: 400 11px/16px var(--font-mono); letter-spacing: 0.01em; }
.sqd-context span { display: inline-flex; align-items: center; }
.sqd-context span + span::before { content: '·'; margin-right: 8px; color: var(--fg-disabled); }
.sqd-context .sqd-context--warning { color: var(--warning-text); }
.sqd-context .sqd-context--danger { color: var(--danger-text); }

/* ── Market summary strip / key metrics ──────────────────────────────────
   A row of instrument readouts divided by hairlines. Mono tabular values so
   a changing figure never shifts its neighbour. The primary reading already
   lives in the masthead, so this stays secondary and quiet. */
.sqd-metrics { display: flex; flex-wrap: wrap; gap: 0; border-top: 1px solid var(--edge); border-bottom: 1px solid var(--edge); }
.sqd-metric { min-width: 0; flex: 1 1 130px; padding: 11px 20px 12px 0; }
.sqd-metric + .sqd-metric { border-left: 1px solid var(--edge); padding-left: 20px; }
.sqd-metric-label { color: var(--fg-muted); font-size: 10.5px; line-height: 15px; font-weight: 510; text-transform: uppercase; letter-spacing: 0.1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-metric-value { margin-top: 5px; color: var(--fg-value); font: 500 20px/26px var(--font-mono); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-metric--primary .sqd-metric-value { color: var(--fg); }
.sqd-metric-subtitle { margin-top: 3px; color: var(--fg-muted); font-size: 11px; line-height: 15px; }

/* ── Panels · framed regions of one instrument, not floating tiles ───────
   The raised surface and 12px radius are the SQD panel tokens. There is no
   glassy inset highlight and no double ring: a single hairline frames the
   region so panels read as parts of one sheet. The one focal panel per view
   takes a restrained accent tick on its leading edge, echoing the eyebrow. */
.sqd-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; align-items: start; }
.sqd-card { grid-column: span 12; min-width: 0; overflow: hidden; border: 1px solid var(--edge); border-radius: var(--radius-xl); background: var(--surface-raised); box-shadow: var(--shadow-panel); }
.sqd-card--half { grid-column: span 6; }
.sqd-card--primary { border-color: var(--edge-strong); box-shadow: var(--shadow-panel), inset 2px 0 0 var(--accent); }
.sqd-grid--dashboard:not(.sqd-grid--single) .sqd-card:not(.sqd-card--primary) { grid-column: span 6; }
.sqd-grid--split:not(.sqd-grid--single) .sqd-card:not(.sqd-card--primary) { grid-column: span 6; }
.sqd-grid--chart_focus .sqd-card { grid-column: span 12; }
.sqd-grid--compact { gap: 14px; }
.sqd-card-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 13px 16px 11px; border-bottom: 1px solid var(--edge); }
.sqd-card-title { margin: 0; font-size: 12.5px; line-height: 17px; font-weight: 510; letter-spacing: 0.01em; }
.sqd-card-subtitle { max-width: 70ch; margin: 3px 0 0; color: var(--fg-muted); font-size: 11.5px; line-height: 16px; }
.sqd-card-body { padding: 14px 16px 16px; min-width: 0; }

/* ── Charts · the TradingView grammar ───────────────────────────────────
   Right value scale, whisper grid at white 5.5%, mono ticks in the muted
   axis ink, one accent series with everything else muted, the last value
   pinned to the axis as an accent pill on a dashed reference line. Gaps stay
   gaps; the forming candle stays hollow and labelled. */
.sqd-chart-wrap { position: relative; width: 100%; }
.sqd-chart-range { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(84px, 0.7fr) minmax(84px, 0.7fr) auto auto; align-items: center; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--edge); }
.sqd-chart-range-copy { color: var(--fg-muted); font: 400 11px/16px var(--font-mono); }
.sqd-range { width: 100%; accent-color: var(--accent); }
.sqd-chart { display: block; width: 100%; height: auto; overflow: visible; }
.sqd-chart-grid { stroke: var(--grid); stroke-width: 1; }
.sqd-chart-axis { stroke: var(--axis); stroke-width: 1; }
.sqd-chart-zero { stroke: var(--fg-disabled); stroke-width: 1; }
.sqd-chart-line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.sqd-chart-area { fill: var(--accent-subtle); }
.sqd-chart-series-area { opacity: 0.82; stroke: var(--surface-raised); stroke-width: 1; }
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
.sqd-chart-label { fill: var(--fg-muted); font: 400 11px var(--font-mono); font-variant-numeric: tabular-nums; }
.sqd-chart-band-label { fill: var(--fg-muted); font: 510 9px var(--font-sans); letter-spacing: 0.1em; }
.sqd-chart-axis-title { fill: var(--fg-muted); font: 400 10.5px var(--font-sans); letter-spacing: 0; text-transform: uppercase; }
.sqd-chart-last-line { stroke: var(--accent-line); stroke-width: 1; stroke-dasharray: 3 4; }
.sqd-chart-last-pill { fill: var(--accent); }
.sqd-chart-last-value { fill: var(--surface); font: 600 11px/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.sqd-chart-crosshair { stroke: var(--fg-secondary); stroke-width: 1; stroke-dasharray: 2 3; pointer-events: none; opacity: 0.6; }
.sqd-chart-hit { fill: transparent; pointer-events: all; outline: none; }
.sqd-chart-hit:focus-visible { fill: var(--accent-subtle); stroke: var(--accent); stroke-width: 1; }
.sqd-chart-tooltip { position: absolute; z-index: 2; top: 8px; max-width: min(360px, 80%); transform: translateX(-50%); border: 1px solid var(--edge-strong); border-radius: var(--radius-md); padding: 8px 10px; background: var(--surface); color: var(--fg-value); box-shadow: var(--shadow-pop); font: 400 11px/16px var(--font-mono); pointer-events: none; }
.sqd-chart-legend { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-bottom: 10px; }
.sqd-chart-legend-item { min-height: 28px; display: inline-flex; align-items: center; gap: 7px; border: 1px solid transparent; border-radius: var(--radius-md); padding: 4px 9px; background: transparent; color: var(--fg); cursor: pointer; font: 400 12px/16px var(--font-sans); letter-spacing: -0.006em; transition: background-color var(--duration-normal) var(--ease-soft); }
.sqd-chart-legend-item:hover { background: var(--edge-subtle); }
.sqd-chart-legend-item[aria-pressed='false'] { color: var(--fg-muted); text-decoration: line-through; }
.sqd-chart-legend-item[aria-pressed='false'] .sqd-chart-legend-swatch { opacity: 0.3; }
.sqd-chart-legend-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sqd-chart-legend-swatch { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 2px; }
.sqd-chart-empty { min-height: 200px; display: grid; place-items: center; color: var(--fg-muted); text-align: center; }

/* ── Market terminal · the dominant price chart ─────────────────────────── */
.sqd-candle-terminal { position: relative; width: 100%; }
.sqd-candle-readout { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px 16px; margin-bottom: 12px; padding: 8px 12px; border: 1px solid var(--edge); border-radius: var(--radius-md); background: var(--surface); font: 500 12px/16px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--fg-value); }
.sqd-candle-readout-time { color: var(--fg); font-weight: 510; }
.sqd-candle-readout-pair { display: inline-flex; align-items: baseline; gap: 5px; }
.sqd-candle-readout-key { color: var(--fg-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
.sqd-candle-readout-value[data-direction='up'] { color: var(--up); }
.sqd-candle-readout-value[data-direction='down'] { color: var(--down); }
.sqd-candle-readout-flag { color: var(--warning-text); font-size: 11px; }
.sqd-candle-chart { position: relative; width: 100%; height: 360px; }
.sqd-candle-canvas { position: absolute; inset: 0; }
.sqd-chart-hits { position: absolute; inset: 0 0 26px 0; z-index: 2; }
button.sqd-chart-hit { position: absolute; top: 0; height: 100%; margin: 0; border: 0; border-radius: 3px; padding: 0; background: transparent; cursor: pointer; outline: none; }
button.sqd-chart-hit:focus-visible { background: var(--accent-subtle); box-shadow: inset 0 0 0 1.5px var(--accent); }
button.sqd-chart-hit[aria-pressed='true'] { background: rgb(129 140 248 / 0.08); box-shadow: inset 0 0 0 1px rgb(129 140 248 / 0.35); }
.sqd-candle-pill { position: absolute; right: 0; z-index: 3; transform: translateY(-50%); border-radius: 5px; padding: 3px 7px; background: var(--accent); color: var(--surface); font: 600 11px/1 var(--font-mono); font-variant-numeric: tabular-nums; pointer-events: none; }
.sqd-chart-volume-caption { position: absolute; left: 2px; z-index: 2; color: var(--fg-muted); font: 510 9px/12px var(--font-sans); letter-spacing: 0.1em; pointer-events: none; }
.sqd-candle-chart .sqd-chart-tooltip { z-index: 4; }
.sqd-chart-attribution { display: block; width: fit-content; margin: 8px 2px 0 auto; color: var(--fg-muted); font: 400 10px/14px var(--font-sans); text-decoration: none; }
.sqd-chart-attribution:hover { color: var(--fg-secondary); text-decoration: underline; }
.sqd-chart-attribution:focus-visible { border-radius: 2px; outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 520px) {
  .sqd-candle-chart { height: 248px; }
}

/* ── Ranked bars · one accent series, quiet track ──────────────────────── */
.sqd-ranked { display: grid; }
.sqd-ranked-row { min-height: 36px; display: grid; grid-template-columns: minmax(104px, 0.9fr) minmax(120px, 2fr) auto; align-items: center; gap: 12px; border-bottom: 1px solid var(--edge); }
.sqd-ranked-row:last-child { border-bottom: 0; }
.sqd-ranked-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); font-size: 12.5px; font-weight: 510; letter-spacing: -0.006em; }
.sqd-ranked-label--id { font: 400 12px var(--font-mono); letter-spacing: 0; font-variant-numeric: slashed-zero; }
.sqd-ranked-track { height: 6px; overflow: hidden; background: var(--surface-elevated); border-radius: var(--radius-full, 9999px); }
.sqd-ranked-fill { height: 100%; background: var(--accent); border-radius: inherit; }
.sqd-ranked-value { color: var(--fg-value); font: 400 12.5px/18px var(--font-mono); font-variant-numeric: tabular-nums; }

/* ── Evidence table · the ledger apparatus, deliberately calm ───────────── */
.sqd-table-tools { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.sqd-input { width: min(100%, 300px); min-height: 32px; border: 1px solid var(--edge); border-radius: var(--radius-md); padding: 5px 10px; background: var(--surface); color: var(--fg); font-size: 12.5px; transition: border-color var(--duration-normal) var(--ease-soft), box-shadow var(--duration-normal) var(--ease-soft); }
.sqd-input::placeholder { color: var(--fg-disabled); }
.sqd-input:hover { border-color: var(--edge-hover); }
.sqd-input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-muted); }
.sqd-table-wrap { width: 100%; overflow: auto; }
.sqd-table { width: 100%; min-width: 640px; border-collapse: collapse; font-size: 12.5px; line-height: 18px; }
.sqd-table th, .sqd-table td { min-width: 96px; max-width: 260px; height: 34px; padding: 7px 14px 7px 0; border-bottom: 1px solid var(--edge); text-align: left; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-table th { position: sticky; top: 0; z-index: 1; background: var(--surface-raised); color: var(--fg-muted); border-bottom: 1px solid var(--edge-strong); font: 510 12px/16px var(--font-sans); letter-spacing: normal; }
.sqd-table tr:last-child td { border-bottom: 0; }
.sqd-table tbody tr { transition: background-color var(--duration-normal) var(--ease-soft); }
.sqd-table tbody tr:hover, .sqd-table tbody tr:focus-within { background: var(--surface-elevated); }
.sqd-table tbody tr[data-selected='true'] { background: var(--accent-muted); box-shadow: inset 2px 0 0 var(--accent); }
.sqd-table td { color: var(--fg-secondary); }
.sqd-table td[data-align='right'] { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--fg-value); font-size: 12px; }
.sqd-table th[data-align='right'] { text-align: right; }
.sqd-table td[data-signed='positive'] { color: var(--up); }
.sqd-table td[data-signed='negative'] { color: var(--down); }
.sqd-sort, .sqd-row-button { width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: inherit; cursor: pointer; }
.sqd-sort { display: inline-flex; align-items: center; gap: 5px; }
.sqd-table th[aria-sort='ascending'] .sqd-sort::after { content: '\\2191'; color: var(--accent); }
.sqd-table th[aria-sort='descending'] .sqd-sort::after { content: '\\2193'; color: var(--accent); }
.sqd-row-button { color: var(--fg); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0; }
.sqd-row-button:hover { color: var(--accent); }
.sqd-hash { font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums slashed-zero; font-variant-ligatures: none; letter-spacing: 0; overflow-wrap: anywhere; }
.sqd-table-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 12px; }
.sqd-table-pagination .sqd-brand-subtitle { font-family: var(--font-mono); text-transform: none; letter-spacing: 0.01em; }

/* ── Activity timeline · direction shown by dot, sign, and column ───────── */
.sqd-timeline { display: grid; }
.sqd-event { min-height: 44px; display: grid; grid-template-columns: 72px 8px minmax(0, 1fr) auto; gap: 12px; align-items: start; padding: 9px 0; border-bottom: 1px solid var(--edge); }
.sqd-event:last-child { border-bottom: 0; }
.sqd-event-time { order: -1; color: var(--fg-muted); font: 400 12px/18px var(--font-mono); letter-spacing: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sqd-event-dot { width: 6px; height: 6px; margin-top: 6px; border-radius: 50%; background: var(--edge-hover); }
.sqd-event-dot--in { background: var(--up); }
.sqd-event-dot--out { background: var(--down); }
.sqd-event-title { font-size: 12.5px; line-height: 18px; font-weight: 510; letter-spacing: -0.006em; }
.sqd-event-subtitle { color: var(--fg-muted); font: 400 11.5px/16px var(--font-mono); letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqd-event-value { text-align: right; font: 500 12px/18px var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sqd-event-value--in { color: var(--up); }
.sqd-event-value--out { color: var(--down); }
.sqd-event-value--flat { color: var(--fg-value); font-weight: 400; }

/* ── Detail lists ──────────────────────────────────────────────────────── */
.sqd-stat-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; }
.sqd-stat { min-height: 36px; display: flex; justify-content: space-between; gap: 12px; align-items: center; border-bottom: 1px solid var(--edge); }
.sqd-stat-label { color: var(--fg-secondary); font-size: 12.5px; }
.sqd-stat-value { color: var(--fg-value); font: 400 12.5px/18px var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; }

/* ── Notices · inline banners, honest about coverage ────────────────────── */
.sqd-notices { display: grid; gap: 8px; }
.sqd-notice { border-left: 2px solid var(--warning-fill); border-radius: 0 var(--radius-md) var(--radius-md) 0; padding: 9px 13px; background: var(--warning-muted); color: var(--warning-text); font-size: 12px; line-height: 18px; }
.sqd-notice--danger { border-left-color: var(--danger-fill); background: var(--danger-muted); color: var(--danger-text); }
.sqd-display-limit { margin: 12px 0 0; border-left: 2px solid var(--warning-fill); border-radius: 0 var(--radius-md) var(--radius-md) 0; padding: 8px 12px; background: var(--warning-muted); color: var(--warning-text); font-size: 12px; line-height: 18px; }

/* ── Evidence receipt · the sheet's footer band ─────────────────────────── */
.sqd-receipt { display: flex; align-items: center; justify-content: space-between; gap: 12px 20px; flex-wrap: wrap; border-top: 1px solid var(--edge); padding: 14px 0 0; }
.sqd-receipt-copy { min-width: 0; display: flex; align-items: center; gap: 6px 14px; flex-wrap: wrap; }
.sqd-receipt-title { margin: 0; color: var(--fg-secondary); font: 510 11px/16px var(--font-sans); text-transform: uppercase; letter-spacing: 0.1em; }
.sqd-receipt-meta { margin: 0; color: var(--fg-muted); font: 400 11px/16px var(--font-mono); letter-spacing: 0.01em; overflow-wrap: anywhere; }
.sqd-receipt .sqd-button { min-height: 27px; padding: 3px 9px; font-size: 11.5px; }

/* ── States ────────────────────────────────────────────────────────────── */
.sqd-empty { min-height: 300px; display: grid; place-items: center; padding: 40px 28px; text-align: center; }
.sqd-empty h2 { margin: 0 0 8px; font-size: 18px; line-height: 24px; font-weight: 510; letter-spacing: -0.022em; }
.sqd-empty p { max-width: 560px; margin: 0; color: var(--fg-secondary); line-height: 22px; }
.sqd-skeleton { position: relative; overflow: hidden; min-height: 64px; border: 1px solid var(--edge); background: var(--surface-raised); border-radius: var(--radius-lg); }
.sqd-skeleton::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.04), transparent); animation: sqd-shimmer 1.3s infinite; }
@keyframes sqd-shimmer { to { transform: translateX(100%); } }

.sqd-raw { border-top: 1px solid var(--edge); overflow: hidden; }
.sqd-raw summary { min-height: 36px; cursor: pointer; padding: 10px 0; color: var(--fg-muted); font-size: 12.5px; font-weight: 510; }
.sqd-raw summary:hover { color: var(--fg-secondary); }
.sqd-raw pre { max-height: 360px; margin: 0 0 4px; overflow: auto; border: 1px solid var(--edge); border-radius: var(--radius-lg); padding: 14px; background: var(--surface); color: var(--fg-value); font: 400 12px/1.7 var(--font-mono); letter-spacing: 0; white-space: pre-wrap; word-break: break-word; }

.sqd-dialog { width: min(680px, calc(100vw - 28px)); max-height: min(720px, calc(100vh - 28px)); overflow: hidden; border: 1px solid var(--edge-strong); border-radius: var(--radius-xl); padding: 0; background: var(--surface-raised); color: var(--fg); box-shadow: var(--shadow-pop); }
.sqd-dialog::backdrop { background: rgb(0 0 0 / 0.6); }
.sqd-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--edge); }
.sqd-dialog-title { margin: 0; font-size: 13px; line-height: 18px; font-weight: 510; }
.sqd-dialog-body { max-height: 620px; overflow: auto; padding: 16px; }
.sqd-dialog pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: var(--fg-value); font: 400 12px/1.7 var(--font-mono); }
.sqd-dialog-meta { margin: 0 0 12px; color: var(--fg-muted); font: 400 11px/16px var(--font-mono); overflow-wrap: anywhere; }

.sqd-footer { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0 0; border-top: 1px solid var(--edge); color: var(--fg-muted); font: 400 11px/16px var(--font-mono); letter-spacing: 0.03em; }
.sqd-footer a { color: var(--fg-muted); text-decoration: none; }
.sqd-footer a:hover { color: var(--fg-secondary); text-decoration: underline; }
.sqd-visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }

.sqd-preview-picker { max-width: 1160px; }

/* ── Responsive ────────────────────────────────────────────────────────── */
@media (max-width: 820px) {
  .sqd-app { padding-inline: 16px; }
  .sqd-hero { grid-template-columns: 1fr; gap: 6px 0; }
  .sqd-hero-figure { grid-column: 1; grid-row: auto; justify-self: start; text-align: left; padding-top: 12px; }
  .sqd-title { max-width: none; }
  .sqd-card--half { grid-column: span 12; }
  .sqd-grid--dashboard .sqd-card:not(.sqd-card--primary), .sqd-grid--split .sqd-card:not(.sqd-card--primary) { grid-column: span 12; }
  .sqd-stat-list { grid-template-columns: 1fr; }
  .sqd-chart-range { grid-template-columns: 1fr 1fr; }
  .sqd-chart-range-copy { grid-column: 1 / -1; }
}

@media (max-width: 520px) {
  .sqd-app { padding: 10px 12px 18px; }
  .sqd-topbar { min-height: 38px; }
  /* Hide the secondary product label rather than truncate it to a broken
     word; the SQD name and official mark stay. */
  .sqd-brand-copy .sqd-brand-subtitle { display: none; }
  .sqd-actions { gap: 4px; }
  .sqd-hero-value { font-size: 26px; }
  .sqd-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .sqd-metric + .sqd-metric { border-left: 0; padding-left: 0; }
  .sqd-metric:nth-child(even) { border-left: 1px solid var(--edge); padding-left: 16px; }
  .sqd-metric-value { font-size: 18px; }
  .sqd-card-head { padding-inline: 13px; }
  .sqd-card-body { padding-inline: 13px; }
  .sqd-input { font-size: 16px; width: 100%; }
  .sqd-table-pagination { justify-content: space-between; }
  .sqd-event { grid-template-columns: 8px minmax(0, 1fr) auto; }
  .sqd-event-time { order: 0; grid-column: 2 / -1; }
  .sqd-ranked-row { grid-template-columns: minmax(84px, 0.8fr) minmax(72px, 1.2fr) auto; gap: 8px; }
  .sqd-receipt, .sqd-footer { display: grid; gap: 6px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
`
