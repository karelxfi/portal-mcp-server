# v0.8.x Reliability and AI Plugin Roadmap

## Status

**Proposed.** This roadmap uses semantic versions: `v0.80` means `v0.8.0`, `v0.81` means `v0.8.1`, and so on through `v0.8.4`.

The sequence is outcome-driven rather than date-driven. A release moves forward only when its exit criteria pass.

## Product Boundary

- The entire v0.8.x line remains usable without user authentication.
- Authentication is deferred to v0.9.0 and should use one unified `auth.sqd.dev` flow.
- The v0.8.x line will not introduce manual SQD API-key entry as a temporary product path.
- Reliability, measurement, client distribution, and documentation take priority over adding more tools.
- v0.8.1 adopts MCP `2026-07-28` through the stable TypeScript SDK v2 while retaining a tested legacy-client path only for clients that still need it.
- Every release must delete superseded protocol adapters, unregistered tools, duplicate discovery surfaces, and unused dependencies instead of carrying them forward indefinitely.

## What “100% Hardened and Measured” Means

It does not mean external networks and APIs can never fail. It means every exposed MCP tool and transport is covered by the same enforceable engineering contract:

1. Every tool is present in the test manifest and metrics inventory.
2. Every applicable hardening scenario has a passing automated test or an explicit, reviewed non-applicable reason.
3. Every outbound request has a full-response deadline, client cancellation propagation, and a finite retry policy.
4. Every result is classified as success, partial success, tool error, request error, or cancellation.
5. Every tool reports latency and outcome without recording wallet addresses, transaction hashes, query text, or other high-cardinality user input as metric labels.
6. Stdio and Streamable HTTP both pass MCP `2026-07-28` discovery, per-request metadata, cancellation, cache-hint, and response-size gates.
7. Release evidence reconciles tool calls with outcomes and identifies upstream failures separately from server defects.
8. The shipped package contains no unregistered tool modules or generated output left behind by removed source files.

The final v0.8.4 gate is 100% of the declared matrix, not an ambiguous “best effort” claim.

## Release Sequence

| Release | Outcome | Status | Primary owner | Depends on |
|---|---|---|---|---|
| v0.8.0 | Stop the major timeout, cancellation, and slow-query failure modes | Complete | MCP maintainer | Full release gate |
| v0.8.1 | Adopt the stateless MCP 2026 core, remove legacy code, and make every failure class measurable | In progress | MCP maintainer | v0.8.0 reliability baseline |
| v0.8.2 | Finalize and test Claude, Codex/ChatGPT, and Grok distribution against the modern protocol | Not started | MCP maintainer + developer relations | v0.8.1 protocol and metrics contract |
| v0.8.3 | Reach 100% declared hardening coverage across tools and transports | Not started | MCP maintainer | v0.8.1 metrics inventory |
| v0.8.4 | Prove the SLOs in a sustained canary and close the v0.8.x reliability program | Not started | MCP maintainer + service owner | v0.8.2 distribution and v0.8.3 hardening |

### v0.8.0 — Reliability foundation

**Outcome:** common user requests complete promptly, cancellations stop real work, and partial coverage is disclosed instead of timing out or pretending to be complete.

Committed scope:

- Keep request deadlines active through JSON and NDJSON body reads.
- Propagate MCP cancellation into Portal calls, enrichment calls, retry delays, and cache loaders.
- Count cancellations separately from tool failures.
- Bound sparse latest-log searches and disclose unscanned ranges.
- Parallelize wallet sections and return honest partial results when one optional section fails.
- Bound optional OHLC metadata lookup and backfill work.
- Correct native Tron classification and reject unsupported EVM-only operations clearly.
- Add hermetic request-reliability tests and a no-retry live gate for historically error-prone tools.
- Keep the public tool count stable at 28.

Exit criteria:

- 28/28 tools pass the live manifest.
- The full `test:all` release gate passes from the exact commit to be released.
- Build, HTTP, stdio, package-content, plugin, conversation, negative, quality, and audit gates pass.
- `npm audit` reports no known findings in the release tree.
- Package, server metadata, changelog, commit, and tag all identify v0.8.0.

### v0.8.1 — Stateless, lean, and measurable core

**Outcome:** the server uses the stateless MCP `2026-07-28` request model, carries no abandoned compatibility code, and explains every MCP call quantitatively without inspecting sensitive request content.

Scope:

- Upgrade from `@modelcontextprotocol/sdk` v1 to the stable split v2 server/client packages and Zod v4.
- Serve modern HTTP with `createMcpHandler` and stdio with `serveStdio`, supporting `server/discover`, self-contained per-request metadata, and stream-close cancellation.
- Keep the SDK's tested legacy-client negotiation during the rollout; do not maintain a second hand-written transport implementation.
- Add deterministic list ordering plus `ttlMs` and `cacheScope` hints for tools and resources.
- Read client identity and tracing context from standardized per-request MCP metadata instead of custom session headers.
- Remove unregistered tool modules, unused exports, stale generated artifacts, the duplicate plain-HTTP tool catalog, and dependencies used only by that catalog.
- Review the custom `answer`, `display`, `_ui`, `_llm`, and chart/table compatibility envelope. Keep only model-useful structured content; move genuine interactive UI to the MCP Apps extension rather than growing proprietary metadata.
- Define one result taxonomy: `success`, `partial`, `tool_error`, `request_error`, and `cancelled`.
- Instrument all 28 tools with call count, result class, duration, in-flight count, and response-size distributions.
- Instrument upstream calls with duration, status class, timeout, cancellation, retry, and rate-limit counts.
- Add cache hit, miss, stale, shared-load, and eviction metrics for shared caches.
- Emit coverage-complete versus coverage-partial counts for bounded and bucketed tools.
- Add a cardinality/privacy test that rejects addresses, hashes, free-form query values, URLs with query strings, and raw errors as metric labels.
- Build a versioned metric dictionary and a release dashboard based only on stable low-cardinality labels.
- Reconcile total calls with exactly one terminal result per call in tests.

Exit criteria:

- Modern HTTP and stdio clients complete `server/discover` and representative calls without an initialization handshake or protocol session.
- The declared legacy-client matrix still works through SDK negotiation, with an explicit removal date rather than permanent parallel code.
- The package has 0 unregistered tool modules, 0 stale compiled artifacts, and 0 bespoke session-routing code.
- Source lines, packed size, startup imports, and median/p95 response sizes are lower than the v0.8.0 baseline without reducing factual query coverage.
- 100% of exposed tools appear in the metrics inventory and emit one terminal result.
- 100% of upstream helpers emit bounded outcome and latency telemetry.
- Cancellation is excluded from the tool-failure numerator but remains visible as its own result class.
- Metric-label cardinality and redaction gates pass in CI.
- A private operational view can separate client cancellation, invalid requests, Portal/upstream failures, and server defects.

### v0.8.2 — AI plugin and connector distribution

**Outcome:** users can discover, install, update, use, and remove SQD Portal from the major AI clients without manually reconstructing MCP configuration.

Codex and ChatGPT:

- Finalize `.codex-plugin/plugin.json`, listing metadata, assets, privacy/support links, and the hosted MCP declaration.
- Test a clean local-marketplace install, upgrade, disable/enable, and uninstall in Codex.
- Run representative first-use prompts and verify actual SQD tool calls, not only manifest loading.
- Submit the same package to the shared ChatGPT/Codex public plugin directory after its review requirements pass.

Claude:

- Keep the strict-valid `.claude-plugin` manifest and repository marketplace.
- Test clean installs in Claude Code at user and project scope, including update and uninstall.
- Test the hosted endpoint across Claude, Claude Code, and Cowork using MCP `2026-07-28`, not only legacy initialization smoke tests.
- Submit the connector to Claude's in-app connectors directory and use its adoption, latency, and per-tool error dashboard as an external client-side signal alongside server metrics.
- Treat MCP Apps as optional: add an app only when an inline chart or investigation UI is materially better than concise structured tool output.

Grok:

- Document and test Grok web/mobile custom-MCP setup using the public Streamable HTTP endpoint.
- Add dedicated Grok metadata and a `.grok-plugin/marketplace.json` entry instead of relying on Claude-compatible fallback discovery.
- Test `grok plugin validate`, clean install with trust, tool discovery, representative calls, update, disable/enable, and uninstall.
- Submit a SHA-pinned entry to the official Grok Build plugin marketplace.

Additional reach:

- Because the OpenAI listing is shared, include ChatGPT as a first-class tested surface, not a footnote to Codex.
- Publish tested direct-MCP recipes for Claude Desktop and at least two additional mainstream MCP clients.
- Keep one canonical endpoint, tool guide, prompt set, icon set, and support page across clients; generate client-specific manifests from checked source data where possible.

Exit criteria:

- Claude Code, Codex, and Grok Build each pass clean install → discover tools → call tools → update → uninstall journeys.
- Grok chat passes the custom-MCP connector journey against the hosted endpoint.
- ChatGPT/Codex, Anthropic, and Grok submissions are either accepted or tracked as external review dependencies with all repository-side requirements complete.
- Installation documentation is copy-pasteable and contains no SQD API-key step.

### v0.8.3 — 100% tool and transport hardening

**Outcome:** every exposed capability has declared behavior under success, bad input, upstream failure, cancellation, and bounded-resource pressure.

Scope:

- Generate a hardening matrix from the tool registry so missing tools fail CI automatically.
- Cover every tool for schema validation, representative success, empty result, malformed input, cancellation, full-body timeout, and safe error output.
- Cover retryable upstream states, partial-result behavior, pagination, cache sharing, response-size ceilings, and ordering wherever those features apply.
- Fault-inject stalled headers, stalled bodies, truncated NDJSON, 409 reorgs, 429 rate limits, 5xx responses, disconnects, and cancelled retry backoff.
- Property-test cursors, time windows, block ranges, limits, network aliases, and field/filter combinations.
- Verify every outbound path has a deadline, retry ceiling, abort signal, and bounded accumulation.
- Exercise both stdio and Streamable HTTP, including concurrent calls and one caller cancelling a shared cached load.
- Exercise `server/discover`, required routing headers, cacheable list results, modern stream-close cancellation, and the SDK-negotiated legacy path.
- Add sustained concurrency and memory tests with explicit ceilings and leak detection.

Exit criteria:

- 100% of tools have all universally required hardening scenarios.
- 100% of applicable matrix cells pass; every non-applicable cell has a checked reason in source control.
- 0 unbounded outbound request paths and 0 unbounded in-memory result accumulators remain.
- 0 known reproducible server-caused `RemoteProtocolError` or false `Cancelled` defects remain.
- No critical or high security findings remain open in the release diff.

### v0.8.4 — Sustained reliability proof

**Outcome:** the hardened server and its client packages demonstrate stable behavior long enough to make v0.8.x the trusted unauthenticated baseline before unified auth work begins.

Scope:

- Run scheduled canaries across every supported VM family and both MCP transports.
- Enforce latency classes: metadata/raw queries, analytical summaries, and explicitly deep scans each receive a documented SLO.
- Alert on server-attributable errors, protocol failures, timeout budget exhaustion, abnormal cancellation, and partial-result spikes using the v0.8.1 taxonomy.
- Track plugin compatibility against current Claude Code, Codex, Grok Build, and the hosted connector surfaces.
- Publish a user-facing status and troubleshooting guide with safe retry and partial-coverage guidance.
- Complete a release runbook, rollback check, metric reconciliation check, and exact-version client matrix.

Target gates:

- 100% tool, transport, hardening-matrix, and metric-inventory coverage remains green.
- Server-attributable tool failures stay below 1% in the sustained canary window.
- Cancellation reaches the upstream abort path within 1 second at p95 in controlled tests.
- Metadata/raw-query p95 stays below 3 seconds and normal analytical-query p95 below 10 seconds in the controlled live suite; explicitly deep work has a disclosed larger budget.
- No reproducible server-caused protocol timeout appears during seven consecutive days of canary runs.
- Every supported plugin surface passes the exact-version compatibility matrix before release.

## Setup Reality as of 2026-08-27

- OpenAI documents one universal public plugin directory for ChatGPT and Codex, with local marketplaces used during development: <https://developers.openai.com/codex/build-plugins>.
- Claude Code supports repository marketplaces, strict validation, scoped installation, and official marketplace submission: <https://code.claude.com/docs/en/plugin-marketplaces>.
- MCP `2026-07-28` removes protocol sessions and the initialization handshake, adds per-request capability metadata, header routing, cacheable list results, and a formal extensions framework: <https://modelcontextprotocol.io/specification/2026-07-28/changelog>.
- The stable TypeScript SDK v2 uses split server/client packages; modern HTTP uses `createMcpHandler` and modern stdio uses `serveStdio`, with SDK-managed legacy negotiation during migration: <https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28>.
- Claude is rolling the revision across its products, supports MCP Apps, and provides published connectors with adoption, latency, and per-tool error observability: <https://claude.com/blog/bringing-mcp-2026-07-28-to-claude>.
- Grok chat accepts publicly reachable custom MCP connectors: <https://docs.x.ai/grok/connectors>.
- Grok Build supports plugins and marketplaces, including Claude-compatible packages, but a dedicated Grok marketplace entry is clearer and independently testable: <https://docs.x.ai/build/features/skills-plugins-marketplaces>.
- The current SQD Claude package validates in Grok Build because of that compatibility. Its Claude-specific description and missing Grok marketplace entry mean it is not yet a finalized Grok distribution.

## Dependencies and Risks

| Dependency or risk | Owner | Mitigation |
|---|---|---|
| Hosted Portal or network instability can fail live tests | Service owner | Keep hermetic fault tests authoritative for code behavior and report live upstream failures separately |
| Platform marketplace reviews are externally scheduled | Developer relations | Complete clean-install evidence and submission assets early; track acceptance separately from repository readiness |
| Metrics can become expensive or leak request detail | MCP maintainer | Enforce a low-cardinality allowlist and privacy test before exporting new labels |
| “100%” can become vague as tools are added | MCP maintainer | Generate the denominator from the registry and block releases on uncovered tools or scenarios |
| Client plugin formats can change | MCP maintainer | Validate against current CLIs and official docs in the compatibility gate for every release |
| Modern MCP support is still rolling out unevenly across clients | MCP maintainer | Use SDK-managed dual-era negotiation and delete legacy support only after the exact client matrix passes without it |
| Auth pressure could fragment the client setup | Product owner | Keep v0.8.x unauthenticated; design one `auth.sqd.dev` flow for v0.9.0 |

## Explicitly Deferred to v0.9.0

- Unified user authentication through `auth.sqd.dev`.
- OAuth and account-linking behavior across supported MCP clients.
- Organization policy, entitlements, quotas, and authenticated usage views.
- Migration from anonymous access to authenticated access.
- Any temporary workflow that asks users to paste SQD API keys into each AI client.
