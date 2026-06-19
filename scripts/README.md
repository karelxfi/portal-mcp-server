# Portal MCP Test Scripts

These scripts all use the shared manifest in `scripts/tool-manifest.ts`, which keeps the live test surface aligned with the currently registered MCP tools.

## Available scripts

### `npm test`
Builds the server, starts it over stdio, verifies developer guide resources, and runs a fast smoke test over the core discovery tools.

### `npm run test:tools`
Runs the full live tool suite against the current MCP server. It:

- compares `tools/list` against the manifest so drift is caught immediately
- exercises all currently registered tools with representative arguments
- validates that each response is non-error and structurally useful

### `npm run test:routing`
Ranks naive user prompts against the live `listTools()` catalog to catch naming and description ambiguity before a model routes to the wrong tool. It:

- uses the real tool descriptions exposed by the server
- checks every current tool has at least one routing prompt
- adds extra "dumb user" prompts for common confusion cases
- fails when the expected tool does not rank highly enough

### `npm run test:conversations`
Runs multi-step user journeys that behave more like an AI chat session than isolated tool calls. It:

- simulates confused-user flows such as discovery -> summary -> chart
- checks that `answer`, `display`, and `next_steps` stay useful across the conversation
- catches places where a tool works technically but still feels awkward in chat

### `npm run test:realistic-prompts`
Runs skeptical, user-style prompts for the investigation and execution-routing features. It:

- maps messy incident-response prompts to the intended existing tool
- calls the live MCP server and validates the returned artifact, not only routing rank
- checks `investigation` evidence paths, pivots, limitations, and deterministic resolver suggestions

### `npm run test:negative`
Runs focused negative-path checks for invalid inputs and unsupported flows. It:

- verifies errors stay actionable and free of stack traces
- checks that common mistakes fail with clear recovery guidance
- verifies redaction of synthetic secret-like strings and rejection of tampered signed cursors
- protects the “stupid-proof” experience for LLMs and end users

### `npm run test:quality`
Runs an automated response-quality audit over the full manifest. It:

- checks the full response envelope, including `answer`, `display`, `next_steps`, `investigation`, `_llm`, `_freshness`, `_pagination`, `_coverage`, `_ordering`, `_execution`, and `_tool_contract`
- verifies every successful tool result emits `structuredContent` matching the compact JSON text fallback
- checks executable versus descriptive follow-up actions and safe pagination continuation metadata
- runs cold and warm passes, then enforces hard latency budgets and per-tool median/p95 response-size baselines so regressions fail CI
- flags truncation, legacy wording, default raw-query bloat, and non-humanized labels
- warns when a tool is drifting toward the hard budgets before it actually fails

### `npm run test:package`
Runs `npm pack --dry-run` and verifies the published tarball contains only runtime essentials. It fails if source, test, plan, workflow, dashboard, lockfile, or local tooling artifacts are included.

### `npm run test:plugin`
Validates the Codex plugin wrapper and repo-local marketplace. It:

- checks `plugins/portal/.codex-plugin/plugin.json`
- checks `.agents/plugins/marketplace.json`
- verifies icon and logo paths
- verifies bundled SQD skills exist and avoid stale MCP tool names
- confirms the hosted MCP endpoint initializes, lists tools, and answers a small `portal_list_networks` smoke call
- validates the starter-prompt output UX for BTC fills, Base 2h transaction buckets, and SQD/Base entity resolution
- optionally runs an isolated `codex plugin marketplace add` / `codex plugin add portal@sqd` install smoke when `PORTAL_PLUGIN_RUN_CLI_INSTALL=1`
- rejects committed local paths or secret-like markers in plugin manifests

### `npm run test:claude-plugin`
Validates the Claude Code plugin wrapper and repo-local marketplace. It:

- checks `plugins/portal/.claude-plugin/plugin.json`
- checks `.claude-plugin/marketplace.json`
- verifies presentation metadata, bundled skills, and logo paths where supported
- confirms the hosted MCP endpoint initializes and lists the expected SQD Portal tools
- validates the starter-prompt output UX for BTC fills, Base 2h transaction buckets, and SQD/Base entity resolution
- optionally runs an isolated `claude plugin marketplace add` / `claude plugin install portal@sqd` smoke when `PORTAL_PLUGIN_RUN_CLI_INSTALL=1`
- rejects committed local paths or secret-like markers in plugin manifests

### `npm run test:hosted-release`
Runs the release-day hosted plugin gate against `https://portal.sqd.dev/mcp` by default. It:

- requires hosted MCP `initialize` to report the expected release version
- checks hosted `tools/list`
- reads `sqd://tools` and `sqd://execution-guidance`
- validates hosted `/health` and `/tools` only when those public routes are exposed; otherwise it treats hosted discovery as MCP-only and logs the skip

### `npm run test:timestamps`
Runs focused timestamp resolver QA. It:

- verifies Solana head timestamp lookup uses Portal's real `block.timestamp` field
- checks recent `1h` Solana windows are anchored to the latest indexed slot timestamp and resolved through Portal's timestamp lookup
- confirms `"now"` timestamp requests gracefully estimate from the indexed head when hotblocks reject wall-clock now
- checks every `real_time: true` dataset from Portal's live dataset catalog can read the latest block timestamp and produce a `1h` window

### `npm run test:all`
Runs the full live matrix:

- build
- smoke
- tools
- EVM investigator
- routing
- substrate
- timestamps
- HTTP mode
- hosted auth
- delegated auth
- readiness
- Codex plugin manifest, marketplace, asset, bundled-skill, optional CLI install, and hosted MCP smoke checks
- Claude Code plugin manifest, marketplace, bundled-skill, optional CLI install, and hosted MCP smoke checks
- conversations
- realistic prompts
- endpoints
- negative paths
- quality audit
- package contents

### `npm run test:ci`
Alias for the full CI verification entrypoint. Today it runs the same matrix as `test:all`, including the quality-and-budget gate and package-content check.

### `npm run test:release`
Runs `test:ci` and `test:hosted-release`. Use it on release day after the hosted endpoint has been deployed for the target version.

### `npm run test:substrate`
Runs a focused live QA pass for Substrate readiness. It:

- verifies Substrate discovery, network info, head lookup, timestamp resolution, and block queries through the MCP
- checks that unsupported Substrate convenience flows fail clearly instead of leaking raw Portal parse errors
- validates the underlying Portal Substrate backend directly with event and call queries so wrapper gaps are easy to distinguish from backend gaps

### `npx tsx scripts/deep-test.ts`
Runs the same manifest with user-style prompts in the output so it is easier to scan as a realistic end-to-end QA pass.

### `npx tsx scripts/data-quality-test.ts`
Prints truncated real responses for every manifest entry so you can review readability, verbosity, and UX manually.

## Updating the suite

When tool names or recommended arguments change:

1. Update `scripts/tool-manifest.ts`
2. Re-run `npm run test:tools`
3. Re-run `npm run test:routing`
4. Re-run `npm run test:conversations`
5. Re-run `npm run test:realistic-prompts`
6. Re-run `npm run test:negative`
7. Re-run `npm run test:quality`
8. Re-run `npm run test:package`
9. Re-run `npx tsx scripts/data-quality-test.ts` for a quick qualitative review

## Why the manifest exists

Older test scripts hardcoded tools that no longer existed, which turned product churn into false failures. The shared manifest keeps the automated and qualitative suites in sync with the actual server surface.
