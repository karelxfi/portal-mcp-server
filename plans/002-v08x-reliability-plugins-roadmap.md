# v0.8.0 Release Plan and Later Large-Release Direction

## Status and Evidence Boundary

**v0.8.0 is in progress and is the next release. It is not live.**

Verified on 2026-08-27:

- Hosted `https://portal.sqd.dev/mcp` reported `serverInfo.version: 0.7.9` during MCP initialization.
- `origin/main` has package version `0.7.9`.
- The remote repository has no `v0.8.0` tag.
- Local branches and a local-only `v0.8.0` tag contain release-candidate work. They are source evidence only and must not be described as published or deployed.

The current no-auth program belongs in one substantial v0.8.0 release. Intermediate cleanup, protocol, metrics, plugin, test, and canary milestones remain commits and pull requests rather than separately published versions.

## Product Boundary

- v0.8.0 remains usable without user authentication.
- Authentication is deferred to v0.9.0 and should use one unified `auth.sqd.dev` flow.
- v0.8.x will not introduce manual SQD API-key entry as a temporary product path.
- v0.8.0 prioritizes a lean MCP runtime, modern protocol support, reliability, complete measurement, hardening, AI-client distribution, and documentation over adding more tools.
- The public factual query surface remains stable unless a change demonstrably removes duplication without reducing supported user outcomes.

## Release Discipline

- v0.8.0 is one large release candidate covering every committed workstream below.
- A public version is not cut for one completed subsystem. If any workstream or release-wide gate is incomplete, v0.8.0 waits.
- Internal milestones use branches, commits, pull requests, dashboards, and canary deployments; they do not consume a public version number.
- The release requires one exact commit to pass the technical, package, client, documentation, privacy, security, and live-evidence gates.
- A local tag is not release evidence. The release tag is valid only when it points to the approved exact commit, exists on the remote, and its deployment is confirmed.

## v0.8.0 — MCP 2026 Production Platform and AI Ecosystem

**Outcome:** SQD Portal MCP becomes a smaller, modern, measurable, fully hardened, broadly installable unauthenticated product. Users can connect from the major AI clients, run the complete factual query surface, receive bounded and honest results, and understand failures without manually handling SQD API keys.

### Workstream 1 — Modern and lean MCP platform

- Upgrade from `@modelcontextprotocol/sdk` v1 to the stable split TypeScript SDK v2 packages and Zod v4.
- Serve modern HTTP with `createMcpHandler` and stdio with `serveStdio`.
- Support MCP `2026-07-28` stateless discovery, self-contained request metadata, routing headers, cache hints, and stream-close cancellation.
- Keep only the SDK-managed compatibility path required by the declared legacy-client matrix; do not maintain a second hand-written transport.
- Remove bespoke protocol sessions, unregistered tool modules, unused exports, stale build output, duplicate discovery/catalog surfaces, and dependencies used only by retired code.
- Replace the accumulated proprietary `answer`, `display`, `_ui`, `_llm`, chart, and table compatibility envelope with the smallest model-useful structured result contract.
- Use MCP Apps only where an interactive chart or investigation surface is materially better than concise structured output.
- Keep deterministic tool/resource ordering and generate discovery artifacts from one registry.
- Measure source lines, packed size, startup imports, and median/p95 response sizes against the live v0.7.9 baseline.

### Workstream 2 — Complete privacy-safe metrics

- Define one result taxonomy: `success`, `partial`, `tool_error`, `request_error`, and `cancelled`.
- Instrument all 28 tools with call count, terminal result, duration, in-flight count, and response-size distributions.
- Instrument every upstream path with duration, status class, timeout, cancellation, retry, and rate-limit counts.
- Instrument shared caches with hit, miss, stale, shared-load, and eviction counts.
- Emit coverage-complete and coverage-partial counts for bounded, paginated, and bucketed tools.
- Enforce low-cardinality labels and reject addresses, hashes, free-form query values, query-string URLs, credentials, and raw errors from metrics.
- Build a versioned metric dictionary and operational dashboard that separate client cancellation, invalid requests, Portal/upstream failures, and server defects.
- Reconcile total calls with exactly one terminal result per call in automated tests.

### Workstream 3 — 100% tool, transport, and security hardening

- Generate the hardening matrix from the actual registry so missing tools or scenarios fail CI.
- Cover every tool for schema validation, representative success, empty results, malformed input, cancellation, full-body timeout, partial results, safe errors, ordering, pagination, cache sharing, and response-size ceilings where applicable.
- Fault-inject stalled headers, stalled bodies, truncated NDJSON, 409 reorgs, 429 rate limits, 5xx responses, disconnects, and cancelled retry backoff.
- Property-test cursors, time windows, block ranges, limits, network aliases, and field/filter combinations.
- Verify every outbound path has a full-response deadline, finite retry ceiling, abort signal, and bounded accumulation.
- Exercise stdio and Streamable HTTP under concurrency, cancellation, shared-cache load, malformed protocol traffic, and resource pressure.
- Exercise modern discovery, routing headers, cacheable list results, stream-close cancellation, and every retained legacy-client path.
- Add sustained concurrency and memory tests with explicit ceilings and leak detection.
- Complete security-diff, dependency, secret, privacy, malformed-protocol, and resource-exhaustion reviews against the exact release candidate.

“100% hardened” means 100% of the declared matrix passes, with every non-applicable cell carrying a reviewed reason. It does not mean upstream networks can never fail.

### Workstream 4 — Complete AI plugin and connector launch

Codex and ChatGPT:

- Finalize the Codex plugin manifest, listing metadata, assets, privacy/support links, and hosted MCP declaration.
- Test clean install, discovery, representative real calls, upgrade, disable/enable, and uninstall.
- Complete the shared ChatGPT/Codex directory package and repository-side submission requirements.

Claude:

- Finalize the Claude Code plugin manifest and repository marketplace.
- Test user- and project-scoped installation, discovery, representative real calls, upgrade, disable/enable, and uninstall.
- Test the hosted endpoint across Claude, Claude Code, and Cowork using MCP `2026-07-28` rather than only legacy initialization.
- Complete the in-app connectors directory package and use Claude connector adoption, latency, and per-tool error reporting as an external client signal.

Grok:

- Finalize dedicated Grok metadata and marketplace configuration instead of relying only on Claude-compatible fallback discovery.
- Test Grok chat custom MCP plus Grok Build validation, trusted installation, discovery, representative real calls, upgrade, disable/enable, and uninstall.
- Complete the official Grok Build marketplace package and repository-side submission requirements.

Additional clients:

- Treat ChatGPT as a first-class tested surface, not a footnote to Codex.
- Verify installation, discovery, representative use, update, and removal for Claude Desktop and at least two additional mainstream MCP clients.
- Maintain one canonical endpoint, tool guide, prompt set, icon set, privacy/support surface, and generated client-specific metadata.
- Publish one exact-version compatibility report covering discovery, schema rendering, cancellation, structured results, errors, updates, and uninstall behavior.

### Workstream 5 — Sustained release proof and launch surface

- Run canaries across every supported VM family, both MCP transports, and the declared client matrix.
- Enforce documented latency classes for metadata/raw queries, normal analytical summaries, and explicitly deep scans.
- Alert on server-attributable errors, protocol failures, timeout exhaustion, abnormal cancellation, and partial-result spikes using the release taxonomy.
- Complete a release runbook, rollback check, metric reconciliation check, package inspection, and exact-version compatibility matrix.
- Publish reproducible protocol, package-size, latency, error-rate, cancellation, and compatibility evidence for the exact release candidate.
- Complete installation, quick-start, tool-selection, limits, privacy, troubleshooting, support, status, and migration documentation as one coherent public surface.

## v0.8.0 Exit Criteria

- Hosted production still identifies as v0.7.9 until the approved v0.8.0 deployment is completed and verified.
- 28/28 tools pass the registry-derived functional, hardening, and metrics inventories.
- 100% of universally required matrix cells and 100% of applicable conditional cells pass.
- There are 0 unregistered runtime modules, 0 stale compiled artifacts, 0 bespoke session-routing paths, 0 unbounded outbound requests, and 0 unbounded in-memory result accumulators.
- Every tool and upstream helper emits privacy-safe metrics and exactly one terminal outcome.
- No critical or high dependency or release-diff security finding remains open.
- Claude, Codex/ChatGPT, and Grok complete install through representative real use and removal; Claude Desktop and at least two additional clients complete the declared direct-MCP journey.
- Source size, packed size, startup imports, and median/p95 response size improve over the pinned v0.7.9 baseline without reducing factual query coverage.
- Server-attributable tool failures stay below 1% during the sustained canary window.
- Cancellation reaches the upstream abort path within 1 second at p95 in controlled tests.
- Metadata/raw-query p95 stays below 3 seconds and normal analytical-query p95 below 10 seconds in the controlled live suite; deep work uses a disclosed larger budget.
- No reproducible server-caused protocol timeout appears during seven consecutive days of canary runs.
- `npm run test:release` passes on the exact release commit, package and lock versions agree, the changelog remains `Unreleased` until the cut, and package contents are inspected.
- The approved commit is tagged and pushed deliberately, the deployment workflow succeeds, and hosted MCP initialization reports `0.8.0` before the release is declared live.

## Later Large Releases

v0.8.1 through v0.8.4 are later substantial product releases, not spillover buckets for unfinished v0.8.0 work. Their detailed scope should be committed only after v0.8.0 ships and its usage/error evidence is reviewed.

| Release | Directional large-release theme | Status |
|---|---|---|
| v0.8.1 | Agent query quality and evidence-first investigation workflows across supported VMs | Directional |
| v0.8.2 | Broader client ecosystem, MCP Apps, and reusable agent workflows beyond the v0.8.0 launch matrix | Directional |
| v0.8.3 | Portal-backed data and analytical coverage expansion without duplicating query-engine logic in the MCP | Directional |
| v0.8.4 | Public-contract simplification, deprecation closure, long-term compatibility, and v1.0 readiness | Directional |

These themes are not authorization to add tools or compatibility layers now. Each later version needs its own evidence-backed product brief and large release gate.

## Setup Reality as of 2026-08-27

- OpenAI documents one universal public plugin directory for ChatGPT and Codex, with local marketplaces used during development: <https://developers.openai.com/codex/build-plugins>.
- Claude Code supports repository marketplaces, strict validation, scoped installation, and official marketplace submission: <https://code.claude.com/docs/en/plugin-marketplaces>.
- MCP `2026-07-28` removes protocol sessions and the initialization handshake, adds per-request capability metadata, header routing, cacheable list results, and a formal extensions framework: <https://modelcontextprotocol.io/specification/2026-07-28/changelog>.
- The stable TypeScript SDK v2 uses split server/client packages; modern HTTP uses `createMcpHandler` and modern stdio uses `serveStdio`, with SDK-managed legacy negotiation during migration: <https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28>.
- Claude is rolling the revision across its products, supports MCP Apps, and provides published connectors with adoption, latency, and per-tool error observability: <https://claude.com/blog/bringing-mcp-2026-07-28-to-claude>.
- Grok chat accepts publicly reachable custom MCP connectors: <https://docs.x.ai/grok/connectors>.
- Grok Build supports plugins and marketplaces, including Claude-compatible packages: <https://docs.x.ai/build/features/skills-plugins-marketplaces>.

## Explicitly Deferred to v0.9.0

- Unified user authentication through `auth.sqd.dev`.
- OAuth and account-linking behavior across supported MCP clients.
- Organization policy, entitlements, quotas, and authenticated usage views.
- Migration from anonymous access to authenticated access.
- Any temporary workflow that asks users to paste SQD API keys into each AI client.
