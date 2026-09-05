## What changes

<!-- One paragraph: what a user, operator, or contributor will notice. Link the issue. -->

## Checklist

The required check is `npm run test:offline`. Tick what you ran locally.

- [ ] `npm run lint` and `npm run typecheck` pass
- [ ] `npm run test:unit` passes, and new pure logic has a unit test
- [ ] `npm run test:offline` passes
- [ ] `npm run test:live` was run for changes that touch tool behaviour, or the reason it was skipped is stated below
- [ ] `CHANGELOG.md` has an entry under the unreleased version for anything a user or operator would notice
- [ ] `npm run test:catalog-tokens` passes, or the baseline was refreshed with a note and the changelog says why
- [ ] For changes under `src/app-ui/`: `npm run test:app-ui` passes, or the layout baseline was refreshed with `npm run baseline:app-ui` and this description says which boxes moved and why
- [ ] For changes under `src/app-ui/`: the contact sheet below shows the recorded fixtures at a desktop, tablet, and phone width, in both themes
- [ ] For changes under `src/app-ui/` that change how it looks: `docs/explorer-design.md` still describes what the app does, or this pull request updates it
- [ ] No internal hostnames, credentials, or operational procedures appear in code, comments, or this description

## Evidence

<!-- Test output, screenshots for UI changes (real recorded data only), measured numbers. -->
