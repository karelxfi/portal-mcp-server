# Changelog

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
