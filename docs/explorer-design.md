# SQD Explorer: design decisions

The Explorer is the beta MCP App that renders a tool result inside the host that
asked for it. This file records the decisions behind how it looks and behaves,
why each one was taken, and where it is held.

## Sources of truth

| What | Where | Used for |
| --- | --- | --- |
| Colour, type and spacing tokens | SQD design system tokens | `styles.ts` token layer, both themes |
| Chart palette and chart grammar | SQD design system chart palette and chart guidelines | Series colours, up/down, axis ink |
| Component vocabulary | SQD Portal Console components | Panel, Table, InlineNotice, Empty, ChartContainer shapes |
| Inline and fullscreen frame rules | Claude's MCP Apps design guidelines | Card height, action count, gestures, tap targets |

Nothing here changes a token. Where the Explorer deviates from a spec, the
deviation is named below with its reason.

## Decisions

**The host's theme wins; SQD is the fallback.** Structural colour, type and
radius come from the host's MCP Apps style variables when it supplies them, and
from the SQD tokens when it does not. The alternative, a fixed SQD skin, looks
like an advert inside somebody else's product. `test:app-ui` asserts the ground,
foreground, accent, card colour, radius and fonts per cell in light and dark,
against both the SQD tokens and Claude's, so a drift in either direction fails.

**Two frames, not one layout that stretches.** The inline card is a summary: the
answer, one metrics row, one primary instrument, at most two actions, five
preview rows, no nested scrolling, and a height it reports exactly so the host
does not pad it. Full screen is a workspace: two columns when there are
secondary instruments to fill the side, one when there are not, with the
evidence table, the receipt and the raw JSON below. Trying to serve both from
one layout produced a card that was either too tall inline or too empty full
screen.

**Data, not narrative.** A result is headed by its subject (the address, the
market, the network and window), and the primary number leads the metric row.
No answer-sentence titles, no jargon notices, no enum values presented as
metrics. Only notices that reduce trust in the answer (danger, caution) appear
above the instrument inline; the informational ones follow it as a footnote.
The reason is that a model already writes the sentence; the app's job is the
evidence under it.

**One chart engine.** Candles, lines, areas and bars all draw through
lightweight-charts, so they share the grid, the crosshair, the right price
scale, the mono type and the range controls. TradingView's grammar comes with
it: one series in the chart palette's series-1, co-equal series on the fixed
five-stop ramp, up and down on the status tokens rather than the ramp. The
single series takes series-1 (`--chart-1`) and not the interface accent, which
is a text colour and reads as a highlight when used as a fill.

**Deviations from the chart spec, both deliberate.** A grouped bar chart falls
back to lines, because a histogram series has no side-by-side slots and no tool
descriptor asks for one. The last value is drawn by the chart in its own price
scale rather than as a badge of ours over the axis, because ours had to guess
which tick to hide and got it wrong at the edges.

**Every number on screen reconciles with the structured content.** A rendered
value is the tool's value, not a rounded or derived one, and `test:app-ui` reads
the exact numbers back out of the DOM and compares them to the fixture. Zoom and
pan are view-only: narrowing the view never changes `_coverage`, `_pagination`
or the evidence receipt, and the test asserts the receipt is byte-identical
after a zoom.

**A missing value stays missing.** A bucket the tool returned nothing for draws
no mark, keeps its slot on the axis, breaks the line rather than being crossed,
and is labelled "not available" to a screen reader. A gap must never read as a
zero.

**Accessibility is a floor, not a pass.** Keyboard reach to every chart point
and table control, a skip link to the evidence table, focus restored to the
control that triggered a rebuild, `prefers-reduced-motion` honoured, and a glyph
and label beside every colour-coded direction cue. axe reports zero serious or
critical findings across all 78 cells, and the keyboard journey (open, chart,
select, table, sort, page, export) runs end to end.

**Beta, and opt in.** The Explorer is labelled Beta in the widget, in the
resource description and as `_app.stage`, and stays off unless a deployment sets
`MCP_APP_ENABLED` or a connection asks with `?app=1`. Everything the
implementation can hold is held by a test; the Beta label stays until the
remaining items, observed host renders and a design review, are done.

## Turning it on, and turning it back off

The switch is configuration, not code, so both directions are the same size of
change and neither needs a release.

**On for a deployment.** Set `MCP_APP_ENABLED=true` and restart. The variable is
read when a server is built for a request, and a running process does not see a
changed environment, so the restart is what applies it.

**Off again.** Unset it, or set it to anything other than `true` or `1`, and
restart. The image does not change, so this is a rollback to the same build
rather than a redeploy of a different one. Nothing else has to be reverted: with
the flag off, no tool result carries the render request, and a host that never
saw the widget is not left holding a broken reference to it.

**Off for one caller, without touching the deployment.** `?app=0` on the
connection opts a single client out even where the deployment has it on, and
`?app=1` opts one in where the deployment has it off. A per-connection override
takes effect on the next connection, with no restart and no coordination.

**Confirming which state you are in.** `/health` reports `app.enabled`, the
deployment's setting as the restarted process sees it, which is what says
whether the flip or the rollback took. It deliberately does not answer for one
connection's `?app=` override. `test:app-contract` holds the default: with
nothing configured, no tool result asks a host to render the Explorer.

## How a design change is reviewed

1. `npm run test:app-ui` renders 78 cells (13 fixtures x 6 viewport and theme
   combinations) and compares 26 locked selectors against the recorded layout
   baseline. A box that moves by more than a pixel fails.
2. `npm run baseline:app-ui:ci` re-records that baseline in the CI container, so
   the recorded numbers are the platform CI measures on. The pull request has to
   say which boxes moved and why.
3. `npm run contact-sheet:app-ui` renders the recorded fixtures at three widths
   in both themes for the pull request, which is what a reviewer looks at.

Everything reviewed is a recorded SQD Portal response
(`scripts/record-app-fixtures.ts`). Three synthetic fixtures remain for
rendering contracts a real window rarely produces on demand: a missing bucket,
signed values around an exact zero, and a server error envelope.
