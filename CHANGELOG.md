# Changelog

## [0.7.9] - 2026-05-16

Portal MCP v0.7.9 is focused on developer and agent ergonomics for natural blockchain questions.

### Highlights
- **Entity resolver** — added `portal_resolve_entity` so clients can resolve EVM token symbols/addresses, EVM contract aliases, pool identifiers, DeFi protocol names, and Hyperliquid coin names before building deterministic filters.
- **Token-list backed symbols** — `portal_evm_query_logs` and `portal_evm_query_token_transfers` now accept `token_symbols`; `portal_evm_query_transactions` accepts `from_token_symbols` and `to_token_symbols`, resolving them through open token-list data instead of hardcoded token address constants.
- **Token metadata cleanup** — removed baked-in common token and pool metadata from runtime helpers. Token decimals, symbols, and names now come from token-list lookups where available, with explicit fallback and stale-cache notices.
- **Token-list observability** — added Prometheus counters for token-list fetch outcomes, cache events, stale-cache use, and unsupported token-list networks.
- **Shared bounded search** — EVM logs, ERC20 transfers, transaction scans, and contract deployment lookup now share bounded block-scan metadata and partial-window notices.
- **Investigation-ready responses** — queried and summary responses now include an `investigation` guide with primary evidence paths, pivot fields, follow-up filters, and limitations so agents can trace onchain incidents without new tools.
- **Incident prompt routing** — tool descriptions and routing tests now explicitly cover suspicious-wallet triage, stolen-token movement, hack/incident traces, and exact transaction evidence using the existing 28-tool surface.
- **Cross-VM investigator parity** — added regression coverage for Solana program investigations, Bitcoin address-flow summaries, and Hyperliquid trader/coin questions.
- **Unified response envelope** — all current tools now emit the same answer/display/next_steps contract plus `_freshness`, `_pagination`, `_coverage`, `_ordering`, and `_tool_contract`; duplicate `_llm` and `technical_details` payloads were removed from default responses to keep agent context smaller.
- **Response-size budget** — `npm run test:quality` now measures response sizes against the v0.7.9 live baseline and requires at least a 30% median reduction while preserving investigation metadata.
- **SQD-only analyst prompt** — added `portal_onchain_analyst` as a reusable MCP prompt for evidence-first investigation, tracing, and market/protocol intelligence. Social-thread, newsletter, and narrative-marketing output are intentionally out of scope.
- **Natural-language time windows** — shared timestamp parsing now accepts compact and natural forms such as `past 30 minutes`, `in the past 1h`, `in last 38 mins`, `last hour`, and `30 minutes ago` across timeframe, duration, `from_timestamp`, and `to_timestamp` paths.
- **Completeness-safe live answers** — bucketed Base, Solana, and Hyperliquid outputs now preserve continuous bucket rows in the tested windows, low-limit Solana/Hyperliquid recent queries stay bounded, and any partial analysis or preview page is disclosed in the top-level answer instead of only in metadata.
- **Odd-window bucket alignment** — Hyperliquid time series/OHLC and EVM OHLC now align emitted bucket timestamps to the full rounded bucket span, so windows like `in last 38 mins` with `5m` intervals return populated buckets instead of empty-looking rows.
- **Developer discovery refresh** — updated the tool guide and HTTP catalog surface for the new `28`-tool registry (`25` public, `3` advanced/debug).

### Release hygiene
- Reviewed the large v0.7.9 diff before tagging. The pre-hardening snapshot was `22 files, 2631 insertions, 1248 deletions`; `git diff -w --stat` still showed `2045 insertions, 662 deletions`, so the churn is not only whitespace.
- The largest tracked churn remains in `wallet-summary.ts`, `ohlc.ts`, and `query-transactions.ts`; it is accepted for v0.7.9 because those files also carry the release behavior changes and are covered by the live manifest/quality suites.
- Keep ignored local directories such as `.preview/`, `output/`, and `web-analytics-starter-kit/` out of the release unless they become intentional artifacts.

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
- **Observability fixes** — canonicalized dataset metric labels, protected `/metrics` behind bearer auth by default, added dashboard long-window Loki panels, and added an HTTP metrics smoke test so Grafana data gaps are caught before release.
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
