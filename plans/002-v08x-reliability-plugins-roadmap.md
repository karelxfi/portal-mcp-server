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
- Preserve the unified structured result contract in this release so reliability work does not break factual client behavior; simplify it deliberately in a later contract release with measured migration evidence.
- Keep interactive-app code out of the core server. MCP Apps belong in a later client-focused release where they are materially better than concise structured output.
- Keep deterministic tool/resource ordering and generate discovery artifacts from one registry.
- Measure source lines, packed size, startup imports, and median/p95 response sizes against the live v0.7.9 baseline.

### Workstream 2 — Complete privacy-safe metrics

- Define one result taxonomy: `success`, `partial`, `tool_error`, `request_error`, and `cancelled`.
- Instrument all 28 tools with call count, terminal result, duration, in-flight count, and response-size distributions.
- Preserve Portal request status metrics and the existing token-list request/cache outcome metrics.
- Make explicit partial coverage a terminal result so bounded, paginated, sectioned, and bucketed results are distinguishable from complete success.
- Enforce low-cardinality labels and reject addresses, hashes, free-form query values, query-string URLs, credentials, and raw errors from metrics.
- Build a versioned metric dictionary and dashboard that separate client cancellation, partial results, returned tool errors, thrown request failures, and complete success.
- Reconcile total calls with exactly one terminal result per call in automated tests.

### Workstream 3 — 100% tool, transport, and security hardening

- Generate tool coverage from the actual 28-tool registry so missing registrations or manifest coverage fail CI.
- Cover every tool for schema discovery, representative live success, the shared result contract, response-size budgets, and latency budgets.
- Cover universally shared fault paths for stalled response bodies, full-response timeout, cancellation, cancelled retry backoff, bounded concurrency, cache isolation, partial results, returned tool errors, and thrown request failures.
- Exercise modern stdio and Streamable HTTP discovery and real calls plus the retained SDK-managed legacy HTTP path.
- Cover declared routing, malformed/unsupported arguments, supported VM families, timestamp conversion, packaging, dependency audit, error redaction, signed cursors, and bounded result accumulation.
- Keep the versioned matrix and its applicable/not-applicable rules in `RELEASE_ASSURANCE.md`; `npm run test:release` must pass the entire declared matrix on one exact commit.

“100% hardened” means 100% of the declared matrix passes, with every non-applicable cell carrying a reviewed reason. It does not mean upstream networks can never fail.

### Workstream 4 — Complete AI plugin and connector launch

Codex and ChatGPT:

- Finalize the Codex plugin manifest, marketplace metadata, assets, prompt guidance, and hosted MCP declaration.
- Validate the Codex package and hosted MCP discovery; keep public-directory submission as a distribution action after the release artifact exists.
- Document ChatGPT custom MCP setup against the same hosted endpoint without inventing a second server package.

Claude:

- Finalize the Claude Code plugin manifest and repository marketplace.
- Validate the package with Claude Code and test install, inspect, disable, enable, and uninstall locally.
- Use the modern protocol gate for MCP `2026-07-28`; public Claude connector submission remains a distribution action after the release artifact exists.

Grok:

- Use the Claude-compatible plugin package that Grok Build officially supports with zero extra metadata; do not invent an unsupported Grok-only manifest.
- Validate with Grok Build and test trusted install, inspect, disable, enable, and uninstall locally.
- Document the direct custom-connector URL for Grok chat and the repository/plugin install path for Grok Build.

Additional clients:

- Treat ChatGPT as a first-class documented direct-MCP surface, not a footnote to Codex.
- Keep Claude Desktop stdio setup documented; broaden verified desktop-client coverage in the client-ecosystem release instead of claiming unexecuted UI journeys here.
- Maintain one canonical endpoint, tool guide, prompt set, icon set, privacy/support surface, and generated client-specific metadata.
- Publish one repository-side compatibility contract covering modern discovery, schemas, cancellation, structured results, errors, and the validated plugin packages.

### Workstream 5 — Sustained release proof and launch surface

- Run controlled live checks across every supported VM family and both MCP transports.
- Enforce the existing per-tool latency and response-size budgets in cold and warm quality passes.
- Complete metric reconciliation, package inspection, dependency audit, exact-head review, tag verification, deployment, and hosted-version verification.
- Publish reproducible protocol, package-size, tool coverage, cancellation, metric-taxonomy, and client-package evidence for the exact release candidate.
- Complete installation, quick-start, tool-selection, limits, privacy, troubleshooting, support, status, and migration documentation as one coherent public surface.

## v0.8.0 Exit Criteria

- Hosted production still identifies as v0.7.9 until the approved v0.8.0 deployment is completed and verified.
- 28/28 tools pass registry discovery, representative live calls, shared result-contract checks, cold/warm quality budgets, and central metric instrumentation.
- 100% of universally required matrix cells and 100% of applicable conditional cells pass.
- There are 0 unregistered runtime modules, 0 stale compiled artifacts, 0 legacy tool/resource registrations, 0 private SDK registry dependencies, and 0 bespoke session-routing paths.
- Every tool emits privacy-safe common metrics and exactly one terminal outcome.
- No critical or high dependency or release-diff security finding remains open.
- Claude Code and Grok Build packages pass native validation and local lifecycle checks; Codex, ChatGPT, Grok chat, and Claude Desktop have one canonical documented endpoint/setup path.
- Source size, packed size, startup imports, and median/p95 response size improve over the pinned v0.7.9 baseline without reducing factual query coverage.
- Cancellation reaches the upstream abort path within 1 second at p95 in controlled tests.
- Metadata/raw-query p95 stays below 3 seconds and normal analytical-query p95 below 10 seconds in the controlled live suite; deep work uses a disclosed larger budget.
- `npm run test:release` passes on the exact release commit, package and lock versions agree, the changelog remains `Unreleased` until the cut, and package contents are inspected.
- The approved commit is tagged and pushed deliberately, the deployment workflow succeeds, and hosted MCP initialization reports `0.8.0` before the release is declared live.

## Later Large Releases

v0.8.1 through v0.8.4 are later substantial product releases, not spillover buckets for unfinished v0.8.0 work. Their detailed scope should be committed only after v0.8.0 ships and its usage/error evidence is reviewed.

| Release | Proposed large-release outcome | Candidate scope | Status |
|---|---|---|---|
| v0.8.1 | Evidence-first investigations | Deliberately simplify the structured result contract; add reusable wallet, contract, token-flow, incident, and cross-VM investigation workflows; improve citations/provenance, continuation plans, and factual prompt evaluation without expanding the raw tool count by default. | Directional |
| v0.8.2 | Complete AI-client product | Finish public distribution and upgrade paths for Claude, Codex/ChatGPT, and Grok; add MCP Apps only for high-value charts/investigations; verify Claude Desktop plus at least two additional mainstream clients; publish an exact-version compatibility report and shared support/privacy surface. | Directional |
| v0.8.3 | Portal-native analytical expansion | Add the highest-demand Portal-backed datasets and analyses identified by real usage; improve cross-network comparisons, market/contract activity, and long-window continuation while keeping query-engine logic in Portal rather than duplicating it in MCP. | Directional |
| v0.8.4 | v1 contract and operations readiness | Close deprecated response fields and legacy compatibility paths using measured adoption evidence; stabilize schemas/versioning, strengthen sustained-load and memory gates, finish operational SLOs and public troubleshooting, and produce the migration contract for v1.0. | Directional |

Each later version is intentionally a substantial product release, not a small patch or a spillover bucket. These themes are not authorization to add tools or compatibility layers now; each needs its own evidence-backed product brief and large release gate. All v0.8.x releases remain on the no-user-auth product boundary.

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
