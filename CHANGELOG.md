# Changelog

## [0.8.5] - Unreleased

Portal MCP v0.8.5 turns the SQD Explorer into a data-first beta app that fits its host and is clearly opt-in. Tool answers are unchanged.

### Highlights
- **Beta, opt in**: the Explorer is labelled Beta in the widget, in the resource description, and as `_app.stage`. It stays off by default. `MCP_APP_ENABLED=true` enables it for a deployment; `?app=1` and `?app=0` on the connection override that in either direction.
- **Fits the host**: the inline card reports its exact content height, so hosts no longer pad it with blank space. Structural colours follow the host's MCP Apps style variables in light and dark with SQD design-system fallbacks, and full screen opens a two-column workspace.
- **Data, not narrative**: each result is headed by its subject (address, market, or network window) and the primary number leads the metric row. Receipt lines, context chips, caller-facing notices, and chart range sliders leave the view; the JSON keeps them.
- **Explorer links and chain identity**: addresses, transaction hashes, and blocks link to the public explorer for their network (Etherscan family, Solscan, mempool.space, Subscan, Hyperliquid, Tronscan). Network chips show the chain logo and display name from SQD network metadata, regenerated with `npm run sync:chains`.
- **Readable charts**: candle charts use a fixed two-line readout (time and OHLCV, then fills, VWAP, size, and open or partial bucket state) instead of a floating tooltip, so hovering never resizes the chart. Line and bar tooltips stay inside the plot. Labels render at native size in the terminal palette.
- **Short pages, full data**: ranked and timeline panels show ten rows with one Show all control, tables page ten rows with search across every row, identifier cells link out, and missing values are blank rather than "n/a".
- **Every action verified in a host**: Load older, Back, Forward, JSON and CSV downloads through the host download request, Full receipt, row dialogs, explorer links, filter, sort, and Exit full screen are driven through the official AppBridge in `test:app-host`.
- **Truthful Bitcoin fees**: `portal_bitcoin_get_analytics` sums fees in exact satoshis from inputs and outputs over the newest 36 blocks of the analyzed window, reports that block set with exact satoshi and BTC totals, and marks a sample-scoped scan in the answer, notices, `_coverage.sections`, execution notes, and receipt instead of presenting it as a window total. The `fees_btc` time series now computes real per-bucket fees whose sum reconciles to the window total. Time-series and candle summaries declare their bucket alignment (`anchored_to_latest_block` versus `interval_boundary`) so they are not joined bucket for bucket by mistake.
- **Hyperliquid fill summaries**: `portal_hyperliquid_query_fills` with `response_format: "summary"` returned `internal_error` instead of aggregates. Fill amounts are normalized to exact decimal text, so adding realized PnL built a string and the aggregate step then failed. Every summary aggregate now parses its amounts before adding them, and unparseable or missing values count as zero rather than producing `null` totals. The summary returns the fill count, unique traders and coins, volume, fees, realized PnL, the direction breakdown, and the top coins by volume alongside the usual `_coverage` and `_pagination` blocks. The same coercion covers the Bitcoin input, output, and transaction-size aggregates, which normalize amounts the same way. `npm run test:unit` covers the aggregates and `npm run test:tools` calls the summary format against live Portal data.
- **Fast, honest CI**: pull requests run `npm run test:offline` (build, Biome lint, typecheck, unit tests, and every suite that needs no Portal access) as the required check; `npm run test:live` runs the Portal-dependent suites and reports without blocking. A `main` push publishes `edge` from the offline gate; a release tag runs the full matrix. Playwright's browser is cached between runs.
- **Lint, typecheck, and unit tests**: `npm run lint`, `npm run typecheck`, and `npm run test:unit` (`node --test` on `src/**/*.test.ts`) cover timeframe parsing, exact decimals, signed cursors, address validation, coverage rules, Bitcoin fee accounting, and a wallet-summary characterisation on a recorded response. One formatting commit, listed in `.git-blame-ignore-revs`, brought the repository to Biome's format; generated files are excluded and the blanket rule overrides are gone.
- **Native Tron query tools**: `portal_tron_query_transactions` (native TRX transfers, TRC-10 transfers, smart-contract calls by contract and method, or any contract type, with inline logs and internal transactions) and `portal_tron_query_logs` (TVM event logs by contract and topics with event aliases, the parent transaction hash on every row, and inline decoding). Addresses may be given as Base58, 41-prefixed hex, or 20-byte hex and are converted to the form Portal expects in each position; results carry both hex and Base58, exact TRX amounts decoded from SUN, and second-precision timestamps beside the raw millisecond values. Malformed addresses, wrong checksums, and filters that do not fit the chosen transaction kind are rejected before any Portal request. The catalog grows from 28 to 30 tools, `tron` is a toolset, and `test:data-integrity` checks both tools against direct Portal rows.
- **EVM traces**: `portal_evm_query_traces` returns the execution traces under a transaction: internal calls, contract creations, self-destructs, and block rewards. Filter by trace type, caller, callee, 4-byte selector or method alias, deployer, or created contract, or pass `transaction_hash` with its block to get the full internal call tree of one transaction. Portal's nested `action` and `result` objects are flattened into stable fields (`call_from`, `call_to`, `call_sighash`, `value_eth`, `gas_used`, `created_contract_address`, `success`), every row carries the parent transaction hash and a deterministic id built from that hash and the trace address, and rows sort by block, transaction index, then trace address. Scans are bounded with a continuation cursor and the usual coverage disclosure; unfiltered windows stay small on purpose because traces are the heaviest Portal table. The catalog grows from 30 to 31 tools, and `test:data-integrity` checks a pinned transaction's traces against direct Portal rows.
- **A response-size baseline that can be refreshed**: `scripts/quality-baseline-v0.7.9.json` was pinned to a release from long before this one and had to be edited by hand, so three tools failed the size gate simply because the data behind them grew. It is now `scripts/quality-baseline.json`, written by `npm run baseline:quality -- --note "<why>"`, and it records the package version it was measured at, the capture time, the sample count, and the reason it was taken. Budgets are the measured median and p95 plus 10 percent headroom. The current baseline covers all 31 tools and the size gate passes with no failures.
- **Model-in-the-loop eval**: `npm run eval:model-loop` has a model answer 21 pinned questions (18 across EVM, Solana, Bitcoin, Substrate, Hyperliquid, and Tron at fixed blocks, slots, and timestamps, plus an unsupported network, a malformed address, and a future window) through the real server and grades the final answer. It records tool calls, tokens, and wall time per question, writes a JSON artifact and a Markdown summary, and fails under a 90% pass rate or a 20% rise in median tool calls over the previous runs. `--model mock` replays the recorded reference calls to check the answers against live Portal data without an API key. A nightly workflow runs it with `ANTHROPIC_API_KEY` and keeps the artifacts.
- **Fair admission per caller**: tool admission now keys work by bounded client family plus a hashed connection (first `X-Forwarded-For` hop with `MCP_TRUST_PROXY=1`, otherwise the socket address; never stored or labelled). One caller holds at most `MCP_TOOL_CLIENT_WEIGHT_SHARE` percent of the weight budget (default 50) and `MCP_TOOL_CLIENT_MAX_QUEUE` queued calls; over that it receives the retryable `overloaded` result with `reason: client_share` while other callers keep flowing. `mcp_tool_admission_active_by_family` and the `client_share` rejection reason are exported, and calls slower than `MCP_SLOW_REQUEST_MS` log one JSON line with admission wait and execution timings.
- **Public repository hygiene**: `SECURITY.md` (private reporting only), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, a pull request template that mirrors the offline gate, bug and feature issue templates, `CODEOWNERS`, and `AGENTS.md` with the build, test, and release commands. `.gitignore` names the local planning files it protects instead of ignoring every Markdown file. `RELEASE_ASSURANCE.md` now leads with the current contract and keeps a short history; `scripts/README.md` lists every suite with its gate; the README and the directory submission packet describe the server as it is.
- **One-click Claude Desktop install**: every release ships `sqd.mcpb`, an MCP Bundle with the server, its production dependencies, and an optional "SQD Explorer (beta)" setting. `npm run package:mcpb` builds it from the local install with no network, validates the manifest with the official CLI, and fails above 15 MB; `npm run test:mcpb` unpacks and starts it in the offline gate. Directory Health checks the asset on the current release.
- **Toolsets**: every tool belongs to one of eight toolsets (`discovery`, `convenience`, `evm`, `solana`, `bitcoin`, `substrate`, `hyperliquid`, `debug`). `MCP_TOOLSETS` (or `MCP_TOOLS` for exact names) trims a deployment's catalog at registration time, so production can run without the debug tools; `?toolsets=` or `X-MCP-Toolsets` narrows a single HTTP connection and can never widen it. Prompts that name a disabled tool are not offered, the instructions follow the active set, and `mcp_tool_client_calls_total` carries the bounded active set. With nothing configured `tools/list` is unchanged, which the catalog token gate checks.
- **Reviewable UI diffs**: the generated Explorer bundle is no longer tracked in git. `npm run build` regenerates it, and `dev`, `typecheck`, and the source-importing test scripts rebuild it only when it is missing or older than its inputs, so a fresh clone works with `npm ci && npm run dev` and merges stop conflicting on a minified blob.
- **Third-party text is data**: token-list names and symbols, pallet, call, event, program, and coin labels are listed in `_tool_contract.untrusted_fields` and reach prose only cleaned and quoted (control, zero-width, and bidi characters removed, length capped, plain tickers such as `USDC` unchanged). Structured fields keep the raw value byte for byte. The shared formatter and the error envelope clean every prose field once more, the Explorer renders values as text, and CSV export neutralises formula prefixes. The policy is written down in `RELEASE_ASSURANCE.md`.
- **Frugal catalog, measured**: `npm run test:catalog-tokens` counts what every session pays for `tools/list`, `prompts/list`, `resources/list`, and the instructions, per tool and for both the App-disabled and App-enabled surfaces, and fails the offline gate when the total or any tool grows more than 5% over `scripts/catalog-token-baseline.json`. The shared output schema now leaves free-form blocks untyped with short descriptions (767 to 485 tokens per tool), and the per-tool "MCP APP" paragraph moved into the server instructions once. Measured with `o200k_base`: the App-disabled catalog fell from 42,578 to 34,682 tokens and the App-enabled catalog from 45,721 to 36,824.
- **Hardened HTTP transport**: the server binds loopback by default and checks `Host` and `Origin` on every route (loopback always passes, requests without `Origin` pass, `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` extend the list, `*` switches a check off). A non-loopback bind without those lists logs a startup error. Header, request, and keep-alive timeouts and a `MCP_MAX_BODY_BYTES` cap (413 before parsing) bound every request. `/ready` answers 200 only once the dataset catalog has loaded and the latest Portal probe is fresh, with `Retry-After` on 503; the Docker image's health check uses it and sets `MCP_BIND=0.0.0.0`.
- **Traceable builds**: `/health` and every tool result's `_server` block report the git commit the image was built from, and the image carries it as an OCI label. Docker Hub `latest` now means the latest `v*` tag; `main` pushes publish `edge` and `sha-<commit>` instead.
- **Release from the changelog**: pushing a `v*` tag creates the GitHub release with the dated changelog section as its body and uploads the Gemini extension archive, alongside the registry publication and the Docker image, with no manual step in between.
- **One Node runtime**: Node 22 across `.nvmrc`, `.mise.toml`, the Dockerfile, every workflow, and the `engines` field; `packageManager` pins the pnpm the image builds with.
- **Workflow supply chain**: every GitHub Action is pinned to a full commit SHA with a version comment, checkouts drop their credentials, workflows start from empty permissions and grant per job, release images do not share a layer cache with edge builds, Renovate keeps the pins current, and `npm run test:workflow-pins` guards all of it.
- **Directory Health that means something**: the daily check reads the Smithery registry API instead of a browser-rendered page, reports pending review queues without failing, and turns red only when a required listing regresses.
- **Real data everywhere**: UI fixtures are recorded Portal responses (`scripts/record-app-fixtures.ts`), and `npm run app:host` runs a local MCP Apps host with live tool calls for trying the Explorer.

**Full Changelog**: https://github.com/subsquid-labs/portal-mcp-server/compare/v0.8.4...v0.8.5

## [0.8.4] - 2026-08-31

Portal MCP v0.8.4 makes factual completeness a release requirement across every supported data family. It fixes confirmed timestamp, identity, pagination, aggregate, wallet, candle, validation, and response-budget defects, then checks the same answers against direct SQD Portal evidence.

### Highlights
- **Verified time windows**: EVM, Solana, Bitcoin, Substrate, Hyperliquid, and Tron use the correct timestamp units, refine Portal boundary matches against observed block timestamps, disclose requested and actual bounds, and reject future or unverified explicit intervals.
- **Collision-free evidence identities**: Solana, Bitcoin, Substrate, and Hyperliquid rows receive deterministic primary IDs, including nested Substrate events and calls. Missing or duplicate normalized IDs now fail as incomplete results instead of looking complete.
- **Exact wallet continuation**: Solana and Hyperliquid wallet pages continue without overlap, Bitcoin inputs and outputs use distinct identities and their parent transaction hashes, and compact output no longer hides page activity.
- **Correct units and totals**: Bitcoin values are reported as BTC with exact satoshi companions, EVM transaction totals include contract creation, and contract rankings still exclude absent destination addresses.
- **Exact candle arithmetic**: EVM OHLC volume uses integer-safe decimal math, summary totals cover only returned candles, recent trades stay inside the resolved window, and final bucket completeness is explicit.
- **Strict input validation**: Solana public keys and discriminators, Bitcoin addresses, Hyperliquid addresses, and Tron addresses fail before any Portal request when malformed or unsupported for the selected query.
- **Bounded complete responses**: public limits now match measured response budgets, compact results are measured on their real wire encoding, and Hyperliquid replica-command scans cannot materialize unbounded upstream data. Portal overloads return structured retry guidance, while weighted wallet and raw-query admission prevents the server from creating avoidable upstream pressure.
- **Truthful SQD app identity**: every applicable result names the SQD Blockchain Activity Explorer, advertises host readiness without claiming a render the server cannot observe, clears stale data on failed follow-ups, and pages large evidence tables inside the app.
- **Portable current protocol**: the server keeps the strict standard MCP Apps bridge, self-contained CSP, stateless MCP `2026-07-28` discovery, deterministic cache hints, and header-routed HTTP requests while retaining the supported compatibility path.
- **Direct evidence release gate**: generated identity stress tests cover 40,000 rows, live wallet pages are checked for exact membership and continuation, complete sender and receiver rankings match direct Portal rows, partial rankings identify their candidate ceiling, EVM analytics include contract creation, Base candles reconcile with raw swaps, and the existing five-family data-integrity matrix remains mandatory.

**Full Changelog**: https://github.com/subsquid-labs/portal-mcp-server/compare/v0.8.3...v0.8.4

## [0.8.3] - 2026-08-30

Portal MCP v0.8.3 turns SQD results into a fast, portable blockchain investigation experience while preserving the exact structured and text answers used by every existing client.

### Highlights
- **SQD Blockchain Activity Explorer**: one self-contained MCP App presents exact metrics, multi-series charts, candle and volume views, evidence tables, timelines, coverage, freshness, partial results, errors, empty results, and signed continuation controls for 21 data tools.
- **Portable app contract**: standard MCP Apps metadata, MIME type, capability detection, and resource security policy work alongside ChatGPT compatibility aliases. Unsupported hosts keep the same `structuredContent` and compact JSON text fallback.
- **Broad blockchain views**: the explorer adapts to wallets, contracts, token flows, network activity, Bitcoin, Solana, Substrate, Hyperliquid fills, analytics, and candles without narrowing the 28-tool product. Tron discovery, freshness, and timestamp evidence remain available through the metadata tools.
- **Adaptive tool execution**: a weighted, cancellation-aware scheduler protects fast lookups from expensive concurrent analytics, uses measured memory-safe concurrency for each work class, shares identical analytics already in flight, promotes queued work fairly, bounds queue time, and returns structured overload guidance when saturated.
- **Complete app metrics**: bounded Prometheus and Grafana series cover capability-aware tool results, result-to-render conversion, render payload size, app resource reads, app bundle size, admission wait, active weight, queued work, and rejection reasons.
- **Authoritative data integrity**: direct Portal comparisons prove complete identities across paginated EVM and Substrate windows, exact Bitcoin and Solana records, and Hyperliquid candles reproduced from every raw fill in the reported window.
- **Fast repeated EVM candles**: identical live OHLC requests reuse the same short-lived factual snapshot before redundant network and token metadata work, while freshness fields continue to identify the exact evidence returned.
- **Truthful continuation**: coverage and pagination metadata must agree, client-filtered EVM scans continue without gaps or duplicates, exhausted Bitcoin wallet sections stay exhausted, and candle cursors identify adjacent time windows correctly.
- **Sustained memory gate**: the release soak now rejects excessive peak RSS or first-to-last-quarter median RSS growth instead of relying on a noisy first-to-last sample.
- **SQD Design System UI**: the exact Inter and JetBrains Mono files, semantic dark surfaces, status fills, table typography, spacing, right-side chart scales, official black-background symbol, and indigo roles come from the current SQD Design System.
- **Rendered-data parity**: browser gates prove that every tested candle, volume bar, time-series point, grouped total, signed bar, exact identifier, and table count reconciles with its structured source. Chronological sorting and missing-bucket gaps prevent a chart from inventing continuity.
- **Visual and accessibility hardening**: 36 deterministic browser cells cover desktop and mobile layouts under light and dark host preferences, USD and token-ratio candles, success, partial, empty, and error states, keyboard point inspection, searchable and sortable evidence, overflow, and serious or critical accessibility findings.
- **Truthful interaction metadata**: chart contracts advertise point inspection and supported series toggles, but do not claim zoom, visual switching, or image export that the app does not implement.
- **Lean product surface**: the app reuses the existing tool results and follow-up contracts, adds no browser API layer, loads no external assets, and does not add tools merely to power the UI.
- **Reproducible evidence receipts**: material results include canonical tool arguments, a deterministic digest, source windows, row reconciliation, and an honest exact or semantic replay mode so a moving relative query is never described as a frozen snapshot.
- **Three guided investigations**: wallet activity, contract activity, and Hyperliquid market prompts produce reusable investigation plans and remain discoverable alongside their MCP guide resources.
- **Golden factual journeys**: live gates prove that returned wallet rows involve the requested wallet, contract caller totals cannot exceed complete interaction totals, and Hyperliquid candle fill counts and volume reconcile with the reported summary.
- **Evidence workspace**: linked overview, chart, evidence, and investigation sections add range-focused follow-ups, searchable records, session-only investigation history, and JSON or CSV export without persistent browser storage.
- **Current SQD skills**: the plugin packages the latest verified `subsquid-labs/skills` snapshot and intentionally flattens the upstream Squid SDK subtree so all five supported client families discover Portal, Pipes SDK, migration, and performance skills.
- **Real client proof**: an exact temporary candidate workflow records a package digest and separates installed-client runtime calls from manifest validation. Codex, Claude Code, and Grok Build completed real evidence-bearing calls and install lifecycles; unauthenticated local Gemini and Cursor clients remain package-validated rather than misreported as runtime passes.

## [0.8.2] - 2026-08-29

Portal MCP v0.8.2 makes every returned blockchain row trustworthy under large responses, malformed streams, retries, and concurrent load. It also adds repeatable performance evidence so release decisions use measured queue, service, and end-to-end latency instead of isolated timings.

### Highlights
- **No silent evidence loss**: oversized results now return a structured `response_too_large` error with a safer limit recommendation instead of dropping rows or nested arrays.
- **Exact continuation under dense blocks**: same-block cursors accumulate their boundary offset, preventing repeated pages when many matching rows share one block. Bitcoin wallet summaries now filter exact address matches, stay below the response budget, and provide signed continuation cursors.
- **Bounded load admission**: Portal requests use a configurable active and queued budget, propagate cancellation while queued, and return a retryable overload result when capacity is exhausted.
- **Retry storm resistance**: retries use full jitter, respect `Retry-After` as a minimum, release capacity before waiting, and stop inside one wall-clock budget.
- **Malformed-stream safety**: truncated NDJSON, invalid JSON, and premature response termination can no longer look like complete blockchain results.
- **Fast EVM candles**: exact time windows no longer trigger redundant historical backfill, and optional Uniswap v4 metadata lookup has its own cancellation-aware budget so candle data stays interactive.
- **Measured performance gates**: the new harness records intended-start queue delay, service latency, end-to-end latency, response bytes, outcomes, c1/c4/c8 profiles, and bursts. Paired bootstrap comparison rejects statistically supported regressions above 10 percent.
- **Sustained-load proof**: a 60-minute mixed-tool soak records error rate, latency recovery, and MCP child-process RSS, with short local smoke settings available during development.
- **Five-family protocol journeys**: Claude, Codex, Grok, Gemini, and Cursor declared-client journeys cover discovery, structured fallback parity, continuation, multi-step evidence, concurrency, error handling, and recovery. Installed-host proof remains a separate release artifact.
- **Capacity metrics**: Prometheus and Grafana now expose active and queued Portal work, admission wait, and admission rejection rate.
- **Release gates before publication**: pull requests run the complete CI matrix, and Docker image publication waits for the same gate to pass.

**Full Changelog**: https://github.com/subsquid-labs/portal-mcp-server/compare/v0.8.1...v0.8.2

## [0.8.1] - 2026-08-28

Portal MCP v0.8.1 makes blockchain investigations more dependable under empty results, invalid inputs, upstream failures, and client cancellation. Responses now say what happened in a form agents can act on, while operators get privacy-safe metrics that separate useful empty or partial answers from actual failures.

### Highlights
- **Trustworthy result contracts** — network discovery, head lookups, Tron timestamps, time series, and Hyperliquid candles now report pagination, coverage, ordering, freshness, and primary evidence consistently.
- **Actionable tool errors** — expected validation and Portal failures return stable `isError` tool results with a bounded code, origin, retry guidance, and machine-readable next steps instead of surfacing as generic protocol errors.
- **Cancellation-safe recovery** — client cancellation still stops active Portal work promptly, does not count as a tool error, releases in-flight accounting, and leaves the next request healthy.
- **Bounded upstream resilience** — retry waits are finite, respect a capped delay, skip waits after the final attempt, and distinguish retryable Portal failures from invalid requests that should fail immediately.
- **Outcome metrics without prompt capture** — canonical metrics distinguish data, empty, partial, error, and cancelled results, attribute failures to client input, upstream, server, or transport, and reduce client identity to bounded families and major versions. Forwarded user questions and arbitrary client headers are never captured.
- **One release identity** — package, registry, Codex, Claude, Grok-compatible, Gemini, and Cursor manifests now advance together and are checked against the same version.
- **Leaner maintenance surface** — removed the obsolete prompt-taxonomy path that depended on user-query logging and kept all 28 tools on the single instrumented registry.

**Full Changelog**: https://github.com/subsquid-labs/portal-mcp-server/compare/v0.8.0...v0.8.1

## [0.8.0] - 2026-08-27

Portal MCP v0.8.0 is the large no-auth reliability and ecosystem release. It modernizes the protocol/runtime, removes accumulated dead surfaces, preserves the 28-tool factual query product, and requires no SQD account or API key.

### MCP 2026 platform
- **Stable SDK v2** — migrated from the monolithic MCP TypeScript SDK v1 to the stable split v2 server, client, and Node packages with Zod v4.
- **Stateless MCP 2026** — HTTP now uses `createMcpHandler` and stdio uses `serveStdio`, negotiating MCP `2026-07-28` while retaining the SDK-managed legacy compatibility path.
- **One protocol surface** — removed bespoke MCP session plumbing and the duplicate `/tools` HTTP catalog; tool and resource discovery now use the protocol registry directly.
- **Modern resource metadata** — registered developer guides and schemas with MCP v2 resource metadata and cache hints.
- **Protocol release gate** — added modern discovery, tool/resource listing, real tool calls, both transports, legacy fallback, and no-client-credential regression coverage.

### Reliability
- **End-to-end cancellation** — active Portal and enrichment requests now stop promptly when an MCP client cancels, including during retry backoff and response-body reads.
- **Reconciled terminal metrics** — every invocation records exactly one of `success`, `partial`, `tool_error`, `request_error`, or `cancelled`; only actual tool/request failures increment the error counter.
- **Complete request timeouts** — JSON and NDJSON timeouts now cover the full response body instead of ending when response headers arrive.
- **Isolated cache loads** — cancellation of one in-flight cached query no longer fails unrelated callers requesting the same data.
- **Bounded sparse log searches** — large filtered latest-log queries use small concurrent chunks, inspect at most 25,000 recent blocks by default, and disclose any unscanned portion of the requested window. Callers can opt into deeper coverage with `max_scan_blocks`.
- **Faster wallet summaries** — recent EVM wallet sections scan concurrently, all VM wallet queries use an interactive single-attempt budget, and EVM summaries return explicitly marked partial results when an individual section is temporarily unavailable.
- **Bounded Hyperliquid wallet windows** — fast Hyperliquid wallet summaries use a disclosed block-time estimate and larger wallet-filtered chunks inside the 2,000-block cap, avoiding sequential boundary lookups and tiny scans that could exhaust the interactive call budget under concurrent load.
- **Bounded OHLC backfill** — optional Uniswap v4 metadata discovery and historical candle backfill now stay within interactive request budgets; incomplete backfill returns honest partial coverage instead of exceeding the MCP timeout.
- **Native Tron classification** — Tron networks now use their native Portal timestamp query shape and return clear unsupported-tool guidance instead of malformed EVM requests.
- **High-error live regression gate** — release tests now repeat wallet, time-series, EVM transaction/log/token-transfer, and Solana transaction calls without automatic retries and enforce an interactive latency ceiling.
- **Dependency maintenance** — refreshed compatible runtime and test dependencies; the release tree reports no known npm audit findings.

### Lean platform foundation
- **Dead-code removal** — removed unregistered tool implementations and abandoned helper modules that were still compiled despite never appearing in the MCP catalog.
- **Clean package builds** — build output is removed before compilation so deleted modules cannot remain in the published tarball.
- **Lean-surface gate** — CI now rejects unreachable runtime modules and tool registration functions that are never connected to the public registry.
- **One instrumented registry** — all 28 tools use the same MCP v2 registration surface, and CI rejects legacy registrations, private SDK registry access, bespoke sessions, and registration bypasses.
- **Declared assurance matrix** — added a versioned release contract covering 28/28 tools, both transports, five terminal outcomes, negative paths, supported VM families, client packages, dependency checks, and package boundaries.
- **Release plan correction** — consolidated the MCP 2026 migration, complete metrics, hardening, AI-client distribution, and sustained reliability proof into the actual v0.8.0 release candidate while hosted production remains v0.7.9.

### Codex plugin
- Added a repo-local Codex plugin wrapper for the hosted SQD Portal MCP endpoint.
- Added a repo-local marketplace entry so Codex can install `portal@sqd` from this repository.
- Documented the hosted default, checkout-local stdio fallback, and higher-signal first-use prompts for Codex users.
- Added official SQD square logo assets, including light/dark presentation variants, to polish Codex plugin surfaces.
- Added a trimmed rounded composer icon so small Codex prompt previews use the SQD mark without harsh square corners.
- Renamed the Codex plugin MCP server display key to `SQD`.
- Renamed the Codex plugin selector to `portal@sqd`, and set the public plugin version to `0.8.0`.
- Added a Claude Code plugin marketplace and manifest so Claude users can install `portal@sqd`.
- Added `npm run test:plugin` to validate the plugin manifest, marketplace wiring, optional asset paths, and a hosted MCP smoke check before release.
- Added `npm run test:claude-plugin` to validate the Claude Code plugin manifest, marketplace wiring, and hosted MCP smoke check before release.
- Added `npm run test:grok-plugin` and verified Grok Build's official Claude-plugin compatibility path, including install, inspect, disable, enable, and uninstall.
- Documented credential-free custom MCP setup for Grok chat and ChatGPT.

**Full Changelog**: https://github.com/subsquid-labs/portal-mcp-server/compare/v0.7.9...v0.8.0

## [0.7.9] - 2026-05-16

Portal MCP v0.7.9 is focused on developer and agent ergonomics for natural blockchain questions.

### Highlights
- **Entity resolver** — added `portal_resolve_entity` so clients can resolve EVM token symbols/addresses, EVM contract aliases, pool identifiers, DeFi protocol names, and Hyperliquid coin names before building deterministic filters.
- **Token-list backed symbols** — `portal_evm_query_logs` and `portal_evm_query_token_transfers` now accept `token_symbols`; `portal_evm_query_transactions` accepts `from_token_symbols` and `to_token_symbols`, resolving them through open token-list data instead of hardcoded token address constants.
- **Token metadata cleanup** — removed baked-in common token and pool metadata from runtime helpers. Token decimals, symbols, and names now come from token-list lookups where available, with explicit fallback and stale-cache notices.
- **Token-list diagnostics** — token-list fetch outcomes, cache behavior, stale-cache use, and unsupported token-list networks are now easier to inspect during operations.
- **Shared bounded search** — EVM logs, ERC20 transfers, transaction scans, and contract deployment lookup now share bounded block-scan metadata and partial-window notices.
- **Investigation-ready responses** — queried and summary responses now include an `investigation` guide with primary evidence paths, pivot fields, follow-up filters, and limitations so agents can trace onchain incidents without new tools.
- **Incident prompt routing** — tool descriptions and routing tests now explicitly cover suspicious-wallet triage, stolen-token movement, hack/incident traces, and exact transaction evidence using the existing 28-tool surface.
- **Cross-VM investigator parity** — added regression coverage for Solana program investigations, Bitcoin address-flow summaries, and Hyperliquid trader/coin questions.
- **Unified response envelope** — all current tools now emit the same `answer`, `display`, `next_steps`, `investigation`, `_llm.answer_sequence`, `_freshness`, `_pagination`, `_coverage`, `_ordering`, `_execution`, and `_tool_contract` contract from the central formatter.
- **Response-size budget** — `npm run test:quality` now runs cold and warm passes, validates every envelope key/type, and fails per-tool median/p95 response-size regressions against the committed v0.7.9 live baseline.
- **Natural-language time windows** — shared timestamp parsing now accepts compact and natural forms such as `past 30 minutes`, `in the past 1h`, `in last 38 mins`, `last hour`, and `30 minutes ago` across timeframe, duration, `from_timestamp`, and `to_timestamp` paths.
- **Completeness-safe live answers** — bucketed Base, Solana, and Hyperliquid outputs now preserve continuous bucket rows in the tested windows, low-limit Solana/Hyperliquid recent queries stay bounded, and any partial analysis or preview page is disclosed in the top-level answer instead of only in metadata.
- **Odd-window bucket alignment** — Hyperliquid time series/OHLC and EVM OHLC now align emitted bucket timestamps to the full rounded bucket span, so windows like `in last 38 mins` with `5m` intervals return populated buckets instead of empty-looking rows.
- **Long-window bucket completeness** — `past 6h` and `past 24h` bucketed checks now prefer complete scans over partial charts: Solana uses smaller concurrent slot chunks, Base grouped contract trends chunk large transaction windows, and Hyperliquid fill scans request block numbers so partial Portal subranges can be continued instead of silently skipping buckets.
- **Complete-window defaults** — wallet, contract, ranked-contract, and time-series convenience tools now default to complete requested-window analysis; bounded previews remain only as an explicit compatibility option for callers that already send it.
- **Wallet fund-flow triage** — `portal_get_wallet_summary` now returns `fund_flow` by default across supported VMs, with inbound/outbound movement, asset flow rows, counterparties, largest observed movements, and next evidence pivots for investigations.
- **ERC721 mint lookup hardening** — `portal_evm_query_logs` now guides latest pass/NFT mint prompts to Transfer-from-zero filters, decodes ERC721 token IDs from `topic3`, returns the parent tx hash in decoded output, and refuses unbounded historical mint scans instead of timing out or returning incomplete zero-result answers.
- **Developer discovery refresh** — updated the tool guide and HTTP catalog surface for the new `28`-tool registry (`25` public, `3` advanced/debug).

### Factual UX and safety hardening
- **Estimated-window provenance** — relative timeframe fallbacks now carry machine-readable estimated block-window provenance in `_freshness.estimated_timeframe`, plus user-facing notices when timestamp lookup was unsupported or unavailable.
- **Coverage honesty** — bounded contract-activity previews now distinguish requested and analyzed block bounds and mark partial windows as incomplete instead of presenting fast-mode scans as full-window analysis.
- **No temporary API-key path** — removed the provisional MCP bearer-token branch so v0.8.0 stays credential-free; unified user authentication is deferred to v0.9.0.
- **Redacted errors** — actionable errors now strip URL query strings, redact authorization-like fields, and summarize Portal query bodies instead of echoing full request material.
- **Signed cursors** — pagination cursors are HMAC-signed and revalidated on decode, so edited or unsigned cursors fail with actionable guidance.
- **Structured tool results** — tools now return the unified envelope in MCP `structuredContent` while keeping an equivalent compact JSON text fallback for older clients.
- **Executable next steps** — safe pagination follow-ups now identify executable tool calls with explicit cursor arguments; descriptive suggestions are marked non-executable.
- **Limit schema cleanup** — Solana transaction, Bitcoin transaction, and Hyperliquid fill limits are capped at 200, and EVM transaction/log descriptions now match their actual 200-item caps.

### Release packaging
- **Smaller npm package** — the published tarball is limited to the runtime build, README, changelog, license, and package metadata.
- **Package-content check** — the release gate now verifies that source, test, plan, workflow, dashboard, lockfile, and local tooling artifacts stay out of the npm package.

## [0.7.8] - 2026-05-07

Portal MCP v0.7.8 is focused on query correctness, faster analytics, and release discipline. It keeps the interactive visual app work out of this release track so the tool/runtime updates can be reviewed independently.

### Highlights
- **EVM transaction type search** — `portal_evm_query_transactions` now exposes `transaction_type` and `scan_order`, enabling prompts such as “first Ethereum mainnet tx type 0x1 from block 12,244,000” without manual block-by-block clicking.
- **EVM investigator queries** — added method/event aliases, earliest/latest event and token-transfer scans, top-N transaction ranking by value/gas, richer client-side transaction filters, and `portal_evm_get_contract_deployment` for deployer/deployment-tx lookups.
- **EVM investigator regression suite** — added `test:evm-investigator` to exercise real prompts for first/last typed transactions, sighashes, failed txs, contract creation, thresholds, event aliases, deployment lookup, rankings, and top sender/receiver aggregation.
- **Faster analytics windows** — added short-lived query caching and larger safe EVM time-series chunks so repeated analytics and comparison calls avoid redundant Portal scans.
- **Compact continuation UX** — improved next-step and pagination metadata so clients can continue older result pages without reverse-engineering cursors.
- **OHLC metadata improvements** — seeded known pool/token metadata for common Uniswap and Base pools so candle outputs can infer human-readable prices more often.
- **HTTP introspection** — added `/tools` and `/tools.json` catalog endpoints plus `/mcp` as an HTTP alias, with unknown routes returning fast JSON 404s.
- **HTTP operations fixes** — canonicalized dataset labels, protected optional operational endpoints by default, and added an HTTP smoke test for deployment-facing endpoints.
- **Real-time timestamp windows** — relative timeframes now anchor to the latest indexed block or slot timestamp and use Portal timestamp lookup on real-time datasets, including Solana and Hyperliquid fills windows.
- **Release-note discipline** — release scripts now require a hand-written changelog entry before tagging instead of dumping raw commit subjects into `CHANGELOG.md`.

### Post-release hardening
- **Contract deployment lookup stability** — `portal_evm_get_contract_deployment` now uses Portal-side `createResultAddress` filtering, supports known aliases such as BAYC/Bored Apes, caps broad historical scans, and returns actionable empty-window guidance instead of risking MCP disconnects.
- **Bitcoin inline IO hydration** — `portal_bitcoin_query_transactions` now attaches requested inputs/outputs only for returned transaction blocks with compact fields, avoiding oversized 1h inline IO scans.
- **Developer tool guide** — exposed structured tool-selection metadata through `sqd://tools`, `sqd://tools/{name}`, and enriched HTTP `/tools` output so client builders can discover examples, categories, and starting points without reading source.

**Full Changelog**: https://github.com/subsquid-labs/portal-mcp-server/compare/v0.7.7...v0.7.8

## [0.7.7] - 2026-04-10

### Breaking surface changes
- Redesigned the public MCP surface around user jobs instead of older mixed naming.
- Standardized public params on `network` and discovery filters on `vm`.
- Removed legacy public tool names and aliases from the exposed registry.
- Settled on `23` public tools plus `3` advanced/debug tools.

### Added
- Added Substrate support with `portal_substrate_query_events`, `portal_substrate_query_calls`, and `portal_substrate_get_analytics`.
- Added EVM OHLC via `portal_evm_get_ohlc`.
- Added EVM OHLC support for Uniswap v2-style swaps, Uniswap v3 swaps, Uniswap v4 PoolManager swaps, Aerodrome Slipstream swaps, and Uniswap v2 Sync-derived CPMM candles where factual.
- Added cursorable OHLC history windows for both EVM and Hyperliquid candle tools.
- Added `mode: "fast" | "deep"` to the heavier convenience, analytics, and OHLC tools.
- Added `from_timestamp` and `to_timestamp` support across the remaining convenience and analytics tools.
- Added percentile sections to analytics tools where they materially help interpretation.
- Added grouped trends and compare-period outputs with chart metadata and gap diagnostics.
- Added shared chart/table descriptors so clients can render ranked tables, time series, and candles without parsing the payload heuristically.
- Added richer LLM-facing response hints including `answer`, `display`, `next_steps`, `_execution`, `_tool_contract`, `_ui`, and `_llm`.
- Added deterministic `_freshness`, `_coverage`, `_ordering`, and `_pagination` metadata across the main public tools.
- Added compact and summary response modes for analytics tools.
- Added compact-by-default behavior for raw query tools so normal chat usage stays within context limits more reliably.
- Added live routing, conversation, negative, quality, and Substrate test suites.

### Changed
- Consolidated the public surface around discovery, recent activity, wallet summary, time series, VM-specific raw queries, VM-specific analytics, and OHLC.
- Merged older specialized time-series and comparison workflows into a smaller public entry surface.
- Reworked `portal_get_wallet_summary` into a true cross-chain convenience tool with shared top-level sections.
- Reworked `portal_get_recent_activity` into a normalized recent activity feed across supported VMs.
- Reworked `portal_get_time_series` into the main public trend/comparison tool.
- Improved dataset/network info with indexed head, finalized head, and lag reporting.
- Improved Hyperliquid analytics with short-lived caching and in-flight deduplication for repeated calls.
- Improved Solana analytics first-run latency by tightening default fast-path windows.
- Improved chart responses with explicit gap diagnostics and better descriptors for renderers.
- Improved public tool descriptions and examples for LLM selection and follow-up behavior.
- Trimmed default payload sizes for chart and analytics responses to stay closer to chat-sized budgets.
- Kept advanced tools available, but clearly separated them from the core public surface.

### Fixed
- Fixed partial-range scanning issues in aggregate and analytics paths where a partial Portal subrange could be treated as complete.
- Fixed Solana analytics continuation so live scans do not stop early on partial subranges.
- Fixed Hyperliquid OHLC window backfill and continuation behavior for longer durations.
- Fixed Hyperliquid OHLC bucket coverage for live windows, including the flaky `6h -> 15m` case.
- Fixed chain-mismatch UX so unsupported network/tool combinations return actionable guidance instead of vague failures.
- Fixed several raw query payloads to preserve useful inline context while still defaulting to compact mode.
- Fixed EVM OHLC defaults so recent trade tapes do not crowd the response unnecessarily.
- Fixed Hyperliquid analytics compact mode so it is meaningfully smaller than full mode.

### Testing and release process
- Expanded the live manifest to cover the current `26`-tool registry.
- Added dumb-user conversation tests to catch prompt phrasing and routing problems earlier.
- Added negative tests for unsupported-chain paths and bad tool choices.
- Added response-size and latency budget checks in `test:quality`.
- Made truncation a test failure instead of a warning.
- Wired CI to run the full `npm run test:ci` suite before the Docker build step.

### Docs and repo cleanup
- Rewrote the README around the actual public surface and usage patterns.
- Split public tools from advanced/debug tools in the docs.
- Removed internal-only tracked files from the public repository, including the local MCP config example, internal scope tracker, and internal agent metadata.

## [0.7.6] - 2026-04-09

### Added
- Added `portal_hyperliquid_get_ohlc` for trade-fill OHLC candles on `hyperliquid-fills`.
- Added chart-oriented OHLC output with `chart.kind: "candlestick"`, volume metadata, and automatic interval selection for common durations.

### Fixed
- Fixed Hyperliquid filtered stream walking so empty intermediate chunks do not stop later matching ranges from being scanned.
- Improved Hyperliquid OHLC backfill logic so chart windows are covered more reliably for longer durations.

### Changed
- Updated Hyperliquid docs and live tool-manifest coverage for the new OHLC tool.
- Bumped release version to `0.7.6`.
