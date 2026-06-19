# v0.8.0 Plugin And Skills Release Hardening

## Goal

Ship `portal@sqd` as a polished SQD Portal plugin, not a thin MCP wrapper. The release should install hosted MCP access plus SQD agent skills, keep versions coherent, and help agents choose the right data surface.

## Scope

- Bundle refreshed `portal` and `pipes` skills into `plugins/portal/skills/`.
- Keep `package.json`, `package-lock.json`, plugin metadata, Codex manifest, Claude manifest, Claude marketplace, and changelog on the same release version.
- Expose structured execution guidance through MCP resources, HTTP discovery, and tool response `_llm` hints.
- Validate Codex and Claude plugin manifests, skills, logo assets, starter prompts, hosted MCP compatibility, and optional isolated CLI install flows.
- Document the hosted-discovery posture: hosted release validation is MCP-resource based unless public `/health` and `/tools` routes are exposed at the managed edge.

## UX Bar

- Product name: `SQD Portal`.
- Selector: `portal@sqd`.
- Compact MCP server label: `SQD`.
- Starter prompts should feel useful and specific:
  - Show the last 200 BTC perp fills on Hyperliquid with price, size, side, and raw rows.
  - Chart Base transaction throughput over the last 2 hours in 15-minute buckets.
  - Trace Base USDC flows from the past hour with amounts, counterparties, and tx hashes.
- Tool responses should guide next action:
  - MCP for bounded interactive answers.
  - Portal for raw exports and reproducible requests.
  - Pipes SDK for recurring syncs, backfills, joins, storage, dashboards, alerts, and APIs.

## Verification

Run before merge:

```bash
npm run build
npm run test:plugin
npm run test:claude-plugin
npm run test:http-runtime
npm run test:realistic-prompts
npm run test:quality
npm run test:package
```

Run on release day after hosted deployment reports the target version:

```bash
npm run test:hosted-release
```

Optional local CLI install smoke:

```bash
PORTAL_PLUGIN_RUN_CLI_INSTALL=1 npm run test:plugin
PORTAL_PLUGIN_RUN_CLI_INSTALL=1 npm run test:claude-plugin
```
