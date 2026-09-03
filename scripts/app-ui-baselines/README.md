# Explorer layout baselines

`test:app-ui` records the box of every structural element in every fixture and
viewport, and fails when one moves by a pixel or more. It is what catches a
chart drawn short, a card that grew, or two panels colliding, which the
colour and typography assertions cannot see.

The baseline is **keyed by platform**. The same CSS wraps to different heights
on Linux and on a Mac, because the host font stack resolves to a different
typeface, so one file cannot serve both. Only `layout-linux.json` is committed,
because Linux is what CI runs. On any other platform the check reports that it
skipped rather than failing on a difference that is the font stack rather than
the design.

## Refreshing it

Only refresh deliberately, and say in the pull request which boxes moved and
why.

```bash
npm run baseline:app-ui:ci
```

That records the Linux baseline in the same Playwright image family CI uses, so
it matches. It needs Docker; the container installs its own `node_modules` into
a named volume so the host's are left alone.

To look at the numbers on your own machine without touching the committed file:

```bash
npm run baseline:app-ui
```

That writes `layout-<your platform>.json`, which is deliberately not committed.

## What a reviewer looks at

The baseline is a gate, not a picture. For the picture, generate the contact
sheet of every recorded fixture at desktop, tablet and phone widths in both
themes:

```bash
npm run contact-sheet:app-ui
```
