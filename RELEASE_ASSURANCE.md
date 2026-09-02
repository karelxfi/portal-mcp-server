# MCP Release Assurance

This document is the current release contract: what a release must prove, which gate proves it, and how a release is cut. The history section at the end records when each gate arrived. A release means every applicable cell passes on the exact release commit; it does not mean upstream data services or networks can never fail.

## How a release happens

1. The release pull request carries the `## [X.Y.Z] - Unreleased` changelog entry and merges to `main` with the full `test:ci` gate green. A `main` push publishes `subsquid/portal-mcp-server:edge` and `:sha-<commit>`, never `latest`.
2. On `main`, `npm run release:patch` (or `minor`, `major`) dates the changelog entry, bumps `package.json`, `package-lock.json`, `server.json`, and every plugin manifest, commits, and creates the annotated `vX.Y.Z` tag. It refuses to run without the changelog entry or with a dirty tree.
3. `git push origin HEAD && git push origin vX.Y.Z`. The tag runs three workflows: GitHub Release (release body is the changelog section, then the Gemini archive and the Claude Desktop bundle `sqd.mcpb` are packaged and uploaded), Publish MCP Registry, and Build Docker Image (`latest`, `X.Y.Z`, `X.Y`, `sha-<commit>`, with the commit in the image labels, in `/health`, and in every tool result). Re-running any of them on the same tag is safe.
4. npm publication is a separate manual step. The hosted deployment should pin a version tag rather than `latest`.

The pull-request check is `npm run test:offline`; `npm run test:live` runs the same tree against Portal and reports without blocking. A `main` push publishes `edge` from a green offline gate; a `v*` tag runs the full matrix first.

Every workflow pins its actions by commit SHA, drops checkout credentials, and starts from an empty permission set; `npm run test:workflow-pins` fails a pull request that regresses this. Node 22 is the one runtime across `.nvmrc`, `.mise.toml`, the Dockerfile, the workflows, and the `engines` field.

## Current contract

| Release property | Required coverage | Automated gate |
|---|---:|---|
| Host-fit inline card | Exact content height reported through `size-changed`; inline and full-screen layouts from 320 px in light and dark, including Claude's published style variables | `test:app-host`, `test:app-ui` |
| Host-verified actions | Load older, Back, Forward, JSON and CSV downloads, receipt and row dialogs, explorer links, filter, sort, and Exit full screen through the official AppBridge | `test:app-host` |
| Real recorded data | Every preview and screenshot cell renders recorded Portal responses; only sparse, mixed, and error cells are synthetic | `test:app-ui` |
| Chain identity and links | Network logo and display name from SQD metadata, one explorer link per identifier kind, CSP limited to the two logo origins | `test:app-ui`, `test:app-contract` |
| Beta labelling and opt-in | Beta tag in the widget, `_app.stage`, deployment and per-connection gate | `test:app-contract`, `test:app-ui` |
| Bundle budget | Self-contained resource under 720,000 bytes | `test:app-contract` |
| Two CI gates | `npm run test:offline` (build, lint, typecheck, unit tests, and every suite that needs no Portal access) is the required pull-request check and finishes in minutes; `npm run test:live` runs the Portal-dependent suites and reports without blocking; a `v*` tag runs both in full before the image is published | `.github/workflows/ci.yml`, `docker-build.yml` |
| Style, types, and units | `biome check` and `tsc --noEmit` pass on every pull request; `node --test` unit tests cover timeframe parsing, exact decimals, signed cursors and same-block offsets, address validation, coverage rules, Bitcoin fee accounting, and a wallet-summary characterisation on a recorded response | `lint`, `typecheck`, `test:unit` |
| Frugal catalog | `tools/list`, `prompts/list`, `resources/list`, and the instructions are measured per tool and per surface on every pull request against a committed baseline; a 5% growth in the total or in any tool fails the offline gate unless the baseline is refreshed with a note and a changelog entry | `test:catalog-tokens` |
| Claude Desktop bundle | `sqd.mcpb` packaged from the production build and the exact dependency closure, manifest validated by the official CLI, under 15 MB, started from the unpacked bundle over stdio with 28 tools and 3 prompts, uploaded on every `v*` tag and checked by Directory Health | `test:mcpb`, `github-release.yml`, `check:directories` |
| Toolsets | Every tool has exactly one toolset from one typed list; `MCP_TOOLSETS`, `MCP_TOOLS`, `?toolsets=`, and `X-MCP-Toolsets` only ever narrow; the default catalog is byte-identical to the previous release | `test:unit` (`toolsets`), `test:protocol`, `test:http-runtime`, `test:catalog-tokens` |
| Untrusted third-party text | Token-list names and symbols, pallet, call, event, program, and coin labels never reach prose unescaped; the raw value stays byte-identical in structured fields; the Explorer renders them as text; CSV export neutralises formula prefixes | `test:unit` (`untrusted-text`, `export`), `test:app-ui`, `test:negative` |
| Hardened HTTP transport | Host and Origin allowlist on every route with loopback defaults and a startup error for an unlisted public bind, header, request, and keep-alive timeouts, a body cap before parsing, and `/ready` that turns 200 only after the catalog loads and Portal probes stay fresh | `test:http-runtime`, `test:unit` (`http-guard`, `readiness`) |
| Traceable runtime identity | `/health` and every tool result's `_server` carry the git commit the image was built from; `latest` on Docker Hub is only produced by a `v*` tag, main pushes produce `edge` and `sha-*` | `test:http-runtime`, `test:distribution` |
| Workflow supply chain | Every third-party action pinned to a full commit SHA with a version comment, `persist-credentials: false` on every checkout, `permissions: {}` at workflow level with per-job grants, no shared layer cache between edge and release images, Renovate keeps the pins current | `test:workflow-pins` |
| Release automation | A `v*` tag creates the GitHub release from the dated `CHANGELOG.md` section, publishes the registry entry and the Docker image, and uploads the Gemini archive; re-running on an existing tag is a no-op | `github-release.yml`, `scripts/extract-changelog-section.mjs` |
| Directory health signal | The daily job reads the Smithery registry API instead of a client-rendered page, treats pending review queues as non-failing, and fails only on a required target | `check:directories` |
| Bitcoin fee truth | Fees summed in exact satoshis per block from inputs and outputs; the analytics fee section names its exact block set and marks sample scope in the answer, notices, coverage sections, execution notes, and receipt; `fees_btc` buckets are non-zero and reconcile to the window total; generic series and OHLC candles declare their bucket alignment | `test:bitcoin-fees` |
| Timestamp units and boundaries | EVM, Solana, Bitcoin, Substrate, Hyperliquid, and Tron metadata paths; nearest observed boundary; future-window rejection | `test:timestamps`, `test:substrate`, `test:v084-factuality` |
| Stable primary identities | 10,000 generated rows per Solana, Bitcoin, Substrate, and Hyperliquid family; nested Substrate evidence; no missing or duplicate IDs | `test:v084-factuality`, `test:data-integrity` |
| Wallet membership and paging | Exact requested wallet membership, five-row page size, signed continuation, and zero page overlap for supported live families | `test:v084-factuality`, `test:reliability-live` |
| Bitcoin joins and units | Parent transaction hash on inputs and outputs, separate identity namespaces, BTC values, exact satoshi companions | `test:v084-factuality`, `test:data-integrity` |
| Aggregate correctness | EVM transaction totals include contract creation while destination rankings exclude absent destinations | `test:v084-factuality`, `test:data-integrity` |
| Exact OHLC arithmetic | Integer-safe raw swap volume, returned-window summaries, bounded recent trades, final bucket bounds and completeness | `test:v084-factuality`, `test:data-integrity` |
| Exact cross-surface values | Identifiers remain strings; maximum-width integers, scientific notation, tiny non-zero amounts, App cells, exports, previews, fallbacks, and receipts retain exact values | `test:v084-factuality`, `test:app-contract`, `test:app-ui` |
| Retained installed-client contract | Generated resource history, readable prior App URIs, retained wallet and fill limits, safe cursor adaptation, continuation, and reconnect for all five declared client identities | `test:app-contract`, `test:v084-factuality`, `test:client-journeys` |
| Hyperliquid candle window truth | Exact timestamp replay, requested and indexed boundaries, per-bucket state, open-final detection, sparse and no-fill behavior, exact price-times-size volume | `test:v084-factuality`, `test:data-integrity`, `test:investigation-journeys` |
| Wallet completeness semantics | One page/result/window/section contract, contradictory-state rejection, distinct activity and movement counterparties, zero-value call exclusion from flow | `test:v084-factuality`, `test:app-contract` |
| Hyperliquid time-series semantics | Boolean fill presence, declared unit and aggregation, exact timestamp replay, explicit bucket state, no false block counts | `test:v084-factuality`, `test:tools` |
| Observable candidate identity | Every tool response reports SQD and exact server version; App identity uses the canonical product name | `test:v084-factuality`, `test:app-contract`, `test:protocol` |
| Pre-query validation | Solana, Bitcoin, Hyperliquid, and Tron identifiers plus exact Solana discriminator widths | `test:v084-factuality`, `test:negative` |
| Wire response budget | Compact wire encoding, measured per-tool public limits, no silent evidence truncation, bounded replica scans | `test:quality`, `test:v084-factuality`, `test:fetch-reliability` |
| Honest app lifecycle | Canonical identity, host-ready wording, no unobservable render claim, stale-data clearing on failure, ten-row local evidence pages | `test:app-contract`, `test:app-ui` |
| Current MCP publication contract | Stateless `2026-07-28`, `server/discover`, deterministic cache hints, routing headers, strict standard MCP Apps bridge, exact CSP | `test:protocol`, `test:http-runtime`, `test:plugin`, `test:claude-plugin`, `test:app-contract` |
| Portable MCP App contract | Versioned resource, standard MIME and UI metadata, ChatGPT aliases, exact CSP | `test:app-contract` |
| Structured fallback parity | All 28 tools remain callable; 21 app-enabled tools keep structured and text results | `test:app-contract`, `test:client-journeys` |
| App capability handling | Declared, unsupported, and undeclared states without client-name branching | `test:app-contract` |
| Explorer state coverage | Pinned Hyperliquid candles, non-USD token-ratio candles, continuous and sparse time series, grouped series, mixed-sign bars, activity, large tables, empty, and error fixtures | `test:app-ui` |
| SQD Design System fidelity | Embedded Inter and JetBrains Mono, semantic dark surfaces, status fills, table type, official black-background symbol, and no horizon gradient | `test:app-contract`, `test:app-ui` |
| Responsive and host-preference coverage | Desktop light preference, desktop dark preference, and mobile light preference for every fixture; the app remains an intentional dark product surface | `test:app-ui` |
| Accessibility and interaction | Keyboard point inspection, searchable and sortable evidence, series toggles, overflow, collapsed panels, and zero serious or critical axe findings | `test:app-ui` |
| Truthful visual contracts | Declared hover and series controls work; unavailable zoom, toolbar, visual switching, and image export remain disabled | `test:app-contract`, `test:app-ui` |
| Rendered-data parity | Exact candle, volume, line, grouped-series, signed-bar, identifier, and displayed-row values reconcile with structured content | `test:app-ui` |
| Chronology and gap fidelity | Shuffled inputs render in declared x order; missing buckets are not joined into false continuity; positive and negative bars share a correct zero baseline | `test:app-ui` |
| App performance budgets | Bundle below 700 KB, initial render below 1 second per cell, interaction p95 below 250 ms, bounded DOM | `test:app-contract`, `test:app-ui` |
| Repeated EVM candle performance | Identical requests reuse one exact short-lived snapshot; cache keys separate evidence window, pool, token, and price orientation semantics; paired warm latency has no supported regression | `test:performance-harness`, `benchmark:paired` |
| Authoritative data integrity | Direct Portal parity for complete EVM, Solana, Bitcoin, Substrate, and Hyperliquid evidence, including raw-fill candle reproduction | `test:data-integrity` |
| Coverage and continuation truthfulness | Pagination promises a cursor, remaining-result cursors mark the result incomplete, adjacent-window cursors are distinct, and paged identities have no gaps or duplicates | `test:tools`, `test:data-integrity` |
| Adaptive tool admission | Four weighted work classes, fair promotion, cancellation, timeout, overload, and zero capacity leaks | `test:tool-admission` |
| Saturation accounting | Scheduler overload is a structured retryable outcome at any concurrency above a tool class budget, measured separately from unexpected failures; release evidence permits at most 10% bounded overload and 1% unexpected failure | `benchmark:v082`, `soak:v082` |
| App and admission metrics | Result-to-render funnel, payload and bundle size, active weight, wait, queue, and bounded rejection reasons | `test:app-contract`, `test:http-runtime` |
| Sustained process memory | 60-minute peak RSS at or below 512 MB and first-to-last-quarter median growth at or below 128 MB | `soak:v082` with `SOAK_RELEASE=1` |
| Lean app boundary | One self-contained bundle, no external app fetches or assets, under 700 KB | `test:app-contract`, `test:lean`, `test:package` |
| Cross-client fallback journeys | Claude, Codex, Grok, Gemini, and Cursor | `test:client-journeys` |
| Reproducible evidence receipts | Canonical arguments, digest, source windows, row reconciliation, and honest exact or semantic replay mode | `test:evidence-receipts`, `test:client-journeys` |
| Golden factual investigations | Wallet rows involve the requested wallet, contract aggregations reconcile, and Hyperliquid candles reproduce raw fills and volume | `test:investigation-journeys` |
| Guided investigations | Wallet, contract, and Hyperliquid prompts are discoverable with their guide resources in all five declared client families | `test:investigation-prompts`, `test:client-journeys` |
| In-session evidence workspace | Linked overview, chart, evidence, and investigation sections, range-focused follow-ups, session history, and JSON or CSV export without persistent browser storage | `test:app-contract`, `test:app-ui` |
| Registry and schema discovery | 28/28 tools | `test:protocol`, `test:tools`, `test:lean` |
| Representative live success | 28/28 tools | `test:tools` |
| Shared response contract, size, and latency budgets | 28/28 tools, cold and warm | `test:quality` |
| Tool-selection routing | 70/70 declared prompt cases | `test:routing` |
| Controlled timeout and cancellation paths | Every shared Portal fetch mode | `test:fetch-reliability` |
| Malformed and prematurely ended response bodies | JSON and NDJSON paths | `test:fetch-reliability` |
| Lossless response-size boundary | Oversized output fails with structured recovery guidance; no rows are silently removed | `test:fetch-reliability`, `test:quality` |
| Exact continuation inside dense blocks | No repeated or skipped rows across same-block pages | `test:pagination`, `test:tools` |
| Capacity and retry behavior | Bounded active work, queue, wait, cancellation, overload, and jitter | `test:fetch-reliability`, `test:http-runtime` |
| Terminal metric reconciliation | Exactly one of five outcomes per invocation | `test:fetch-reliability` |
| Result-state and failure attribution | Data, empty, partial, error, cancelled; bounded origin and code | `test:fetch-reliability`, `test:http-runtime` |
| Modern and retained legacy MCP paths | stdio and Streamable HTTP | `test:protocol`, `test:http-runtime` |
| Invalid and unsupported requests | Every declared negative fixture | `test:negative` |
| VM-specific regression coverage | EVM, Solana, Bitcoin, Substrate, Hyperliquid | `test:tools`, `test:evm-investigator`, `test:substrate`, `test:reliability-live` |
| Distribution packages | Codex, Claude Code, Grok Build, Gemini CLI, Cursor | `test:plugin`, `test:claude-plugin`, `test:grok-plugin`, `test:gemini-extension`, `test:cursor-plugin` |
| Declared-client protocol journeys | Claude, Codex, Grok, Gemini, Cursor | `test:client-journeys` |
| Open-loop performance profiles | Cold c1; warm c1, c4, c8; c8 burst | `benchmark:v082`, `benchmark:paired` |
| Sustained mixed load | 60 minutes with bursts, latency recovery, error rate, and child-process RSS | `soak:v082` |
| Published package boundary | Allowlisted runtime and public files only | `test:package` |
| Dependency findings | No known npm audit finding | `test:package` |
| Pull requests and image publication | Full gate passes before merge or Docker publication | GitHub `CI` and `Build Docker Image` workflows |

`npm run test:release` runs the deterministic and live functional matrix. Adding a tool without adding it to the registry-derived manifests fails the release gate. A release candidate also requires clean-commit benchmark comparison, the 60-minute soak, and installed-host evidence. Those artifacts are intentionally separate because they take longer and must identify the exact commit under test.

Installed-host proof uses an exact temporary release package that swaps only the MCP endpoint for the current built stdio server and records a package digest. Codex, Claude Code, and Grok Build must each complete a real tool call with evidence and a supported install lifecycle before release. Gemini CLI and Cursor runtime calls are required when those clients are authenticated in the test environment; if local client authentication is unavailable, the release record must say package-validated rather than runtime-passed. The local release package proves the protocol resource contract, browser rendering, fallback behavior, and client-declared journeys without changing production. Declared-client tests also replay a pre-upgrade fixture with retained resource and schema values, but they do not replace visible host evidence.

## Untrusted text policy

Some strings in a result were written by someone other than SQD: token names and symbols from open token lists, Substrate pallet, call, and event names, Solana program labels, Hyperliquid coin names, protocol names and slugs, and any label copied from on-chain data. Every tool result names those fields in `_tool_contract.untrusted_fields` so an agent knows which values are third-party names. The rules, enforced by `src/helpers/untrusted-text.ts`:

- The raw value is preserved exactly in `structuredContent` (`items`, `matches`, `summary`, `_evidence`, and every other data field). Factuality never depends on a cleaned copy.
- A third-party value enters prose (`answer`, `_summary`, `_notice`, `_notices`, `_ui.headline`, panel titles, `next_steps` labels, error summaries and suggestions) only through `quoteUntrusted` or `untrustedLabel`: control, zero-width, and bidirectional override characters are removed, whitespace is collapsed, the length is capped, and the value is wrapped in double quotes unless it is a plain ticker such as `USDC`. `IGNORE PREVIOUS INSTRUCTIONS` therefore reads as a quoted name.
- Every prose field is cleaned once more in the shared formatter and in the error envelope, so a tool that forgets the helper still cannot ship invisible characters.
- The Explorer renders every value as a text node (the only `innerHTML` in the app is the static SQD mark) and its CSV export prefixes cells that start with `=`, `+`, `-`, or `@` with a quote so spreadsheets do not evaluate them.
- The server never fetches behavioural instructions from external sources; token lists supply names and addresses only.

## Terminal outcome contract

Every tool invocation increments `mcp_tool_calls_total` exactly once with one terminal status:

- `success`: complete, usable result.
- `partial`: usable result that explicitly reports incomplete coverage or an unavailable section.
- `tool_error`: MCP completed the invocation with `isError: true`, including expected validation and bounded upstream failures.
- `request_error`: the invocation failed before a structured MCP tool result could be produced.
- `cancelled`: the client cancelled the invocation or its propagated request.

Only `tool_error` and `request_error` increment `mcp_tool_errors_total`. Partial results and cancellations remain independently measurable instead of inflating the server-error rate.

## Metric coverage and privacy

All 28 tools pass through one instrumented registration surface. This guarantees the common per-tool series without copying metric code into individual tools:

| Metric | Purpose | Bounded labels |
|---|---|---|
| `mcp_tool_calls_total` | Calls and terminal outcomes | tool, status, transport, server version |
| `mcp_tool_outcomes_total` | Result state and failure attribution | tool, status, result state, error origin, error code, transport, server version |
| `mcp_tool_call_duration_seconds` | End-to-end tool latency | tool, transport |
| `mcp_tool_calls_active` | In-flight calls | tool, transport |
| `mcp_tool_errors_total` | Tool and request error classes | tool, transport, error type |
| `mcp_tool_response_size_bytes` | Serialized response size | tool, transport |
| `mcp_tool_intent_calls_total` | Product intent usage | tool, declared intent, VM |
| `mcp_portal_api_requests_total` | Portal request outcomes | method, HTTP status |
| `mcp_portal_upstream_active` | Active Portal requests admitted by the shared capacity controller | none |
| `mcp_portal_upstream_queued` | Portal requests waiting for capacity | none |
| `mcp_portal_admission_rejected_total` | Requests rejected before upstream work | bounded reason |
| `mcp_portal_admission_wait_seconds` | Time spent waiting for upstream capacity | none |
| `mcp_dataset_queries_total` | Canonical dataset usage | dataset, VM |
| `mcp_tool_client_calls_total` | Protocol-declared client usage | transport, bounded client family, major version, active toolset (`all`, one toolset name, or `custom`) |

Metric labels never contain wallet addresses, transaction hashes, free-form prompts, authorization values, request bodies, raw error messages, or arbitrary client headers. Structured event export records bounded client identity and failure attribution but never captures forwarded user questions.

The Grafana dashboard is checked against emitted metric names during `test:http-runtime`, so stale dashboard queries fail CI. The metrics endpoint is disabled unless deliberately configured and is separate from the public, credential-free v0.8.x MCP product surface.

## Reliability invariants

- Full-response deadlines cover headers and bodies for JSON and NDJSON requests.
- Invalid JSON, truncated NDJSON, and premature body termination never become complete-looking data.
- The formatter never silently drops rows or nested evidence to fit the response budget.
- MCP cancellation reaches active Portal fetches and retry backoff.
- Retry counts and concurrent scans are finite, use jitter, and share one wall-clock retry budget.
- Admission bounds active and queued Portal work, releases capacity before backoff, and fails overload with retry guidance.
- Sparse searches and result accumulation use explicit bounds and disclose incomplete coverage.
- Shared cache cancellation is isolated between callers.
- Cursor data is signed and invalid cursors fail safely.
- User-facing errors redact query strings, authorization-like fields, and full request bodies.
- MCP discovery comes from one registry; there is no duplicate HTTP tool catalog or bespoke session router.
- Package, registry, Codex, Claude, Grok-compatible, Gemini, and Cursor manifests share the same release version.

## Release-candidate evidence

The exact release commit must have all of these artifacts:

1. `npm run test:release` passes.
2. A paired baseline/candidate artifact from `npm run benchmark:paired`, created from two clean commits with every registered tool and at least 50 interleaved sample pairs per warm profile.
3. The paired benchmark alternates baseline and candidate calls without making them compete for the same upstream request, and reports no statistically supported median regression above both 10 percent and 5 milliseconds. It also permits at most 1 percent candidate tool errors. Sequential `benchmark:v082` artifacts remain useful capacity evidence, but are not the release regression gate because live upstream conditions can drift between runs.
4. `SOAK_RELEASE=1 npm run soak:v082` completes the default 60-minute mixed-tool run with at most 1 percent tool errors and records latency and child-process RSS.
5. Installed Claude, Codex, and Grok hosts each complete a real tool call against the exact candidate. Gemini and Cursor complete runtime calls when their local clients are authenticated; otherwise the evidence must record them as package-validated with authentication unavailable. `test:client-journeys` verifies protocol identity and behavior, but does not replace or overstate installed-host proof.

GitHub pull requests run `npm run test:ci`. Main-branch and tag image publication runs the same gate before Docker login, build, or push, so failed code cannot publish a new image.

## History

- **v0.8.5**: Explorer host fit and beta opt-in, two CI gates with Biome, typecheck, and unit tests, catalog token gate, Claude Desktop bundle, toolsets, untrusted-text policy, hardened HTTP transport, traceable images and SHA-pinned workflows, changelog-driven releases, directory health signal, exact Bitcoin fees.
- **v0.8.4**: factual completeness gates: timestamp units and boundaries, stable identities, wallet membership and paging, Bitcoin units, aggregate and OHLC arithmetic, exact cross-surface values, retained installed-client contract, pre-query validation, wire budgets, honest app lifecycle, and the stateless `2026-07-28` publication contract.
- **v0.8.3**: portable MCP App contract, Explorer state and design-system coverage, accessibility and interaction gates, data-integrity parity, adaptive tool admission and saturation accounting, soak memory budget, cross-client journeys, evidence receipts, guided investigations, and the in-session evidence workspace.
- **v0.8.2**: the hardening baseline: registry and schema discovery, live success per tool, response budgets, routing cases, fetch reliability, exact continuation, capacity and retry behaviour, terminal metric reconciliation, negative fixtures, VM regression coverage, distribution packages, performance profiles, sustained load, and the published package boundary.
