# Contributing

Thank you for helping improve the SQD Portal MCP server. This page covers setup, the two test gates, and what a pull request needs.

## Setup

- Node 22 (`.nvmrc`). `npm ci` installs the exact lockfile.
- `npm run dev` starts the server over stdio; `npm run dev:http` starts it on `http://127.0.0.1:3000`. Both build the Explorer bundle first when it is missing or stale.
- `npm run build` produces `dist/`. The generated Explorer bundle under `src/generated/` is a build output and is not tracked in git.

## Two test gates

- `npm run test:offline` is the required pull-request check. It builds, runs Biome (`npm run lint`), `tsc --noEmit` (`npm run typecheck`), the unit tests (`npm run test:unit`), and every suite that needs no Portal access. It passes with the network disabled and takes a few minutes.
- `npm run test:live` runs everything that talks to SQD Portal or an installed client. CI runs it on every pull request as a reporting job that does not block.

`scripts/README.md` lists every suite and which gate it belongs to. Put new pure logic under unit tests (`src/**/*.test.ts`, `node --test` through `tsx`); put new black-box checks in `scripts/`.

## Style

Biome formats and lints the repository (`npm run lint:fix` applies safe fixes). Generated files are excluded. `.editorconfig` matches Biome for editors without an integration. Keep changes focused: one pull request per issue or coherent group.

## Pull requests

- Base on `main`, or on the previous branch when stacking related work.
- Fill in the pull request template. The checklist mirrors the offline gate.
- Add a line to the `Unreleased` section of `CHANGELOG.md` for anything a user or operator would notice.
- If `tools/list` grows, `npm run test:catalog-tokens` fails above 5%; refresh the baseline deliberately with `npm run baseline:catalog-tokens -- --note "<why>"` and say why in the changelog.
- Keep public text free of internal details: no hostnames, credentials, or operational procedures.

## Reporting problems

Use the issue templates for bugs and feature requests. For security problems, follow `SECURITY.md` and do not open a public issue.
