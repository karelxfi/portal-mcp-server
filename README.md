# SQD Portal MCP Server

[![SQD Portal MCP server](https://glama.ai/mcp/servers/subsquid-labs/portal-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/subsquid-labs/portal-mcp-server)

An MCP server that answers blockchain questions from [SQD Portal](https://portal.sqd.dev) data: transactions, logs, token transfers, wallets, analytics, time series, and candles across EVM, Solana, Bitcoin, Substrate, and Hyperliquid networks, with an optional in-host Explorer.

The server does not index chains itself. It validates input, plans bounded Portal queries, and returns results with coverage, freshness, pagination, and evidence metadata so an assistant can say exactly what it saw. See `CONTRIBUTING.md` to work on it and `SECURITY.md` to report a vulnerability.

The current v0.8.5 release supports the stateless MCP `2026-07-28` protocol over HTTP and stdio, while retaining the SDK-managed legacy negotiation path for clients still rolling out the revision. No SQD account, API key, or client credential is required.

Factual completeness is a release gate, carried forward from v0.8.4. It verifies requested and actual time bounds, stable row identities, exact page continuation, wallet membership, Bitcoin units, transaction and candle totals, input validation, and response budgets against direct Portal evidence across EVM, Solana, Bitcoin, Substrate, Hyperliquid, and applicable Tron metadata paths. Tool results expose the exact `_server.version`. The SQD Explorer uses the current SQD Design System, retains cached App URIs from supported releases, preserves exact hashes and tiny decimal amounts across every display and export surface, and adds honest App identity, explicit open-bucket state, safe failed-follow-up states, and client-side paging for large evidence tables.

v0.8.5 ships the SQD Explorer as an opt-in beta that fits its host: the inline card reports its exact height, results lead with their subject and primary number, identifiers link to public explorers, network chips carry SQD chain logos, and every control is verified through the official MCP Apps bridge.

## Current public surface

- `25` public tools
- `3` advanced/debug tools
- public params use `network`
- discovery filters use `vm`
- no legacy tool aliases in `v0.8.x`

Raw query tools default to compact responses. Ask for `response_format: "full"` only when you need the larger payload.

Entity questions can use `portal_resolve_entity` first. It resolves EVM token symbols/addresses, EVM contract aliases, pool identifiers, protocol names, and Hyperliquid coin names into query-ready filters while keeping ambiguous matches explicit.

Token symbol resolution and token metadata come from open token-list data, not baked-in token address constants. Responses include explicit notices when token-list data is unavailable, stale, or unsupported for a network.

Wallet questions should start with `portal_get_wallet_summary`. It returns `fund_flow` by default, including inbound/outbound movement, asset flows, counterparties, largest observed movements, and next evidence pivots before raw-tool drill-down.

## Tool groups

Discovery:
- `portal_list_networks`
- `portal_get_network_info`
- `portal_get_head`
- `portal_resolve_entity`

Cross-chain convenience:
- `portal_get_recent_activity`
- `portal_get_wallet_summary`
- `portal_get_time_series`

EVM:
- `portal_evm_query_transactions`
- `portal_evm_query_logs`
- `portal_evm_query_traces`
- `portal_evm_query_token_transfers`
- `portal_evm_get_contract_deployment`
- `portal_evm_get_contract_activity`
- `portal_evm_get_analytics`
- `portal_evm_get_ohlc`

Solana:
- `portal_solana_query_transactions`
- `portal_solana_query_instructions`
- `portal_solana_get_analytics`

Bitcoin:
- `portal_bitcoin_query_transactions`
- `portal_bitcoin_get_analytics`

Substrate:
- `portal_substrate_query_events`
- `portal_substrate_query_calls`
- `portal_substrate_get_analytics`

Hyperliquid:
- `portal_hyperliquid_query_fills`
- `portal_hyperliquid_get_analytics`
- `portal_hyperliquid_get_ohlc`

Tron:
- `portal_tron_query_transactions`
- `portal_tron_query_logs`

Advanced/debug:
- `portal_debug_query_blocks`
- `portal_debug_resolve_time_to_block`
- `portal_debug_hyperliquid_query_replica_commands`

These groups are also the toolsets (`discovery`, `convenience`, `evm`, `solana`, `bitcoin`, `substrate`, `hyperliquid`, `tron`, `debug`). A deployment can trim the catalog with `MCP_TOOLSETS` or `MCP_TOOLS`, and an HTTP connection can narrow it further with `?toolsets=` or an `X-MCP-Toolsets` header; see the HTTP deployment notes. With nothing configured the full 31-tool surface is served, and the hosted endpoint keeps that default.

## Supported data

- EVM networks indexed by Portal, including Base, Ethereum, Optimism, Arbitrum, Monad, Hyperliquid EVM, and many others
- Tron native transactions (TRX transfers, TRC-10 transfers, contract calls with inline logs and internal transactions) and TVM event logs such as TRC-20 transfers, with Base58 or hex addresses, exact TRX amounts, and the parent transaction hash on every log; the bundled SQD plugin skill documents the raw Stream API for anything beyond that
- Solana mainnet
- Bitcoin mainnet
- Hyperliquid fills and replica commands
- Substrate networks indexed by Portal

Substrate support is currently historical only. It does not have a real-time tail.

## Response shape

Most tools return the same envelope in MCP `structuredContent` and in a compact JSON text fallback for older clients. The envelope contains a normal result body plus shared metadata such as:

- `answer`
- `display`
- `next_steps`
- `investigation`
- `_freshness`
- `_coverage`
- `_pagination`
- `_ordering`

`investigation` is a compact evidence guide for agents: it identifies the primary result path, bounded window, useful pivot fields such as addresses or transaction hashes, follow-up filters, and limitations before a result is treated as complete. Successful material results also carry an `_evidence` receipt with canonical arguments, a deterministic digest, row reconciliation, source windows, and either exact or semantic replay semantics. Exact receipts pin their evidence window. Semantic receipts disclose that rerunning a moving relative window can return a newer snapshot.

When a response uses estimated, partial, sampled, capped, or paginated data, the top-level answer and metadata disclose it. Safe pagination follow-ups include executable tool-call metadata with explicit cursor arguments; suggestions that cannot be reconstructed safely are marked non-executable.

Chart-oriented tools also return chart and table descriptors so MCP clients or LLMs can render them without reverse-engineering the payload.

SQD Explorer is in beta and is off by default. A default deployment answers with `structuredContent` and compact JSON text only, and no tool result asks a host to open a UI. There are two ways to opt in:

- One connection: add `?app=1` to the endpoint, for example `https://portal.sqd.dev/mcp?app=1`. Use this to try the beta without changing anything for other users.
- Whole deployment: set `MCP_APP_ENABLED=true`. A connection can still override it in either direction, so `?app=0` opts a single client back out.

The app resource stays registered either way, so a host can read it directly without anyone opting in.

v0.8.5 includes one portable SQD Explorer (beta) for 21 data tools. When it is enabled, compatible MCP App hosts receive an inline card sized to its content and a full-screen workspace: exact metrics led by the primary number, multi-series and signed-value charts, right-scaled price candles with linked volume and a fixed readout, ranked and timeline panels that show ten rows with a Show all control, evidence tables that page ten rows with search across every row, explorer links for addresses, hashes, and blocks, chain logos and names from SQD network metadata, continuation controls, current-session history, and JSON or CSV export through the host. Pointer and keyboard inspection expose exact plotted values. Missing buckets remain visible as gaps, identifiers stay unshortened, and any local row cap is separate from server completeness. Failed follow-ups keep the last good result under the error. The app is self-contained and does not use persistent browser storage; its only browser-side requests are chain logo images from `cdn.subsquid.io` and `sqd.dev`, the two origins declared in the resource CSP. Hosts without MCP App support receive the same `structuredContent` and compact JSON text fallback, so the underlying answer never depends on the UI.

Three MCP prompts provide reproducible starting points without adding tools:

- `investigate-wallet`
- `investigate-contract`
- `investigate-market`

For a chart-first App demo, ask: `Show BTC price action and trading volume on Hyperliquid for the past hour, using five-minute candles. Explain whether the final candle is closed.` The result opens the SQD Explorer with an exact candle chart, volume, an evidence table, requested and indexed time bounds, and a receipt. Replay the returned `requested_window_start_timestamp` and `requested_window_end_exclusive` as fixed `from_timestamp` and `to_timestamp` inputs when you need a stable verification run.

## Install

```bash
npm install
npm run build
```

## Run

stdio:

```bash
npm start
```

HTTP:

```bash
npm run start:http
```

## Developer discovery

The server exposes a structured tool-selection guide for client builders:

- MCP resource `sqd://tools` returns grouped tool metadata, examples, starting points, and integration notes.
- MCP resource `sqd://tools/{name}` returns the guide entry for one tool, for example `sqd://tools/portal_get_time_series`.

Tool and resource discovery stays on the MCP protocol itself. The server does not maintain a duplicate HTTP catalog.

## Codex plugin

The Codex plugin wrapper lives in `plugins/portal` and defaults to the hosted MCP endpoint at `https://portal.sqd.dev/mcp`.

Install it from this repo-local marketplace:

```bash
codex plugin marketplace add .
codex plugin add portal@sqd
```

Open a new Codex thread after installing. First-use prompts include Hyperliquid BTC perp fills, recent Base transaction volume, and the latest USDC transfers on Base.

## Claude Code plugin

The Claude Code plugin uses the same hosted MCP endpoint and the same public selector:

```bash
claude plugin marketplace add subsquid-labs/portal-mcp-server
claude plugin install portal@sqd
```

Open a new Claude Code session after installing so the SQD MCP tools are loaded.

## Grok

Grok chat can use SQD as a custom connector:

1. Open `grok.com/connectors`.
2. Choose **New Connector**, then **Custom**.
3. Enter `https://portal.sqd.dev/mcp` as the MCP server URL.
4. Leave authentication unset for the credential-free v0.8.x server.

Grok Build reads Claude Code plugins directly, so it uses the same package rather than a made-up Grok-only manifest:

```bash
grok plugin install --trust subsquid-labs/portal-mcp-server#plugins/portal
```

The release gate validates the Codex, Claude Code, Grok Build, Gemini CLI, and Cursor packages, then runs the same discovery, prompt, resource, fallback, evidence, continuation, concurrency, and recovery journeys for all five declared client families. It also compares material results with direct Portal evidence and rejects missing or duplicate normalized identities. Real installed-client calls are recorded separately so package validation is never presented as runtime proof.

## ChatGPT

In a workspace with custom MCP apps enabled, open **Settings → Apps → Create**, enter `https://portal.sqd.dev/mcp`, choose no authentication, scan the tools, and create the draft app. The server is read-only and does not require user credentials in v0.8.x.

## Claude Desktop

Download `sqd.mcpb` from the [latest release](https://github.com/subsquid-labs/portal-mcp-server/releases/latest) and open it: Claude Desktop installs the bundle with one click and lists the 31 tools. The bundle carries the server, its production dependencies, and one optional setting, "SQD Explorer (beta)", which is off by default. It needs Node 22 or newer on the machine.

Manual fallback, from a local clone after `npm run build`, add an entry like this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "SQD": {
      "command": "node",
      "args": ["/absolute/path/to/sqd-portal-mcp-server/dist/index.js"]
    }
  }
}
```

## Usage notes

- If you do not know the exact network name, start with `portal_list_networks`.
- If you need recent indexed state, use `portal_get_network_info` or `portal_get_head` first.
- If the question is broad, start with `portal_get_recent_activity`, `portal_get_wallet_summary`, or `portal_get_time_series` before dropping to raw queries.
- Time windows accept compact and natural wording such as `30m`, `past 30 minutes`, `in the past 1h`, `in last 38 mins`, `last hour`, or `30 minutes ago`.
- Use `portal_evm_get_ohlc` and `portal_hyperliquid_get_ohlc` only when you actually need candle-shaped output.
- For large or exploratory queries, prefer `response_format: "compact"` unless you need the full record shape.

## HTTP Deployment Notes

HTTP mode exposes MCP at `/` and `/mcp`, liveness at `/health`, and readiness at `/ready`. The hosted service exposes the same versioned health response at `https://portal.sqd.dev/mcp/health`.

- MCP and health are public in v0.8.x. User authentication is deferred to a unified `auth.sqd.dev` flow in v0.9.0.
- Tool and resource discovery use the MCP protocol; retired `/tools` and `/tools.json` routes return `404`.
- Set `MCP_CURSOR_SECRET` in production so pagination cursors are signed with a deployment-specific secret. Local development uses a deterministic fallback for convenience.
- `/health` reports `version` and `commit`, the git commit the image was built from, and every tool result repeats both in `_server`. Docker Hub tags: `latest`, `X.Y.Z`, and `X.Y` come only from a `v*` release tag; `edge` and `sha-<commit>` come from every `main` push. Pin a version tag in production.
- `/ready` is `200` only after the dataset catalog has loaded once and the latest Portal probe succeeded within `MCP_READY_MAX_AGE_MS`; otherwise it is `503` with a `reason` and `Retry-After`. Point orchestrator readiness checks at `/ready` and liveness checks at `/health`. The Docker image's `HEALTHCHECK` uses `/ready`.
- The server binds `127.0.0.1` unless `MCP_BIND` says otherwise, and every route checks the `Host` header (and `Origin`, when a browser sends one) against an allowlist, so a DNS-rebound page cannot reach a local instance. Loopback hosts and origins always pass; requests without `Origin` always pass the origin check. A non-loopback bind must set `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS`; if either is missing the server logs a startup error and serves without that check. The Docker image sets `MCP_BIND=0.0.0.0`, so set both variables in the deployment, or `*` behind a proxy that already validates them.
- Every request is bounded: headers within `MCP_HEADERS_TIMEOUT_MS`, the whole request within `MCP_REQUEST_TIMEOUT_MS`, idle keep-alive within `MCP_KEEP_ALIVE_TIMEOUT_MS`, and MCP bodies above `MCP_MAX_BODY_BYTES` are refused with `413` before parsing (`411` for a chunked body with no length).

Useful environment variables:

- `MCP_CURSOR_SECRET` to sign pagination cursors
- `MCP_TOOLSETS` comma-separated toolsets to serve (`discovery`, `convenience`, `evm`, `solana`, `bitcoin`, `substrate`, `hyperliquid`, `tron`, `debug`; `all` or `default` for everything). Unknown names are ignored with a startup error. Wins over `MCP_TOOLS`. Default: all nine, the full 31-tool catalog.
- `MCP_TOOLS` comma-separated exact tool names to serve when `MCP_TOOLSETS` is unset.
- Per connection, `?toolsets=evm` on the endpoint URL or an `X-MCP-Toolsets: evm` header narrows the deployment's set for that connection only; it can never add a toolset. Prompts that reference a tool outside the active set are not offered. The active set is a bounded label (`all`, one toolset name, or `custom`) on `mcp_tool_client_calls_total`.
- `MCP_BIND` interface to listen on, default `127.0.0.1` (`0.0.0.0` in the Docker image)
- `MCP_ALLOWED_HOSTS` comma-separated hostnames accepted in `Host` (port ignored) on top of loopback; `*` disables the check. Required for a non-loopback bind.
- `MCP_ALLOWED_ORIGINS` comma-separated hostnames accepted in `Origin` on top of loopback; `*` disables the check. Required for a non-loopback bind.
- `MCP_REQUEST_TIMEOUT_MS`, `MCP_HEADERS_TIMEOUT_MS`, `MCP_KEEP_ALIVE_TIMEOUT_MS` request timing bounds, defaults `120000`, `30000`, `65000`
- `MCP_MAX_BODY_BYTES` MCP request body cap, default `1048576`
- `MCP_READY_PROBE_INTERVAL_MS` and `MCP_READY_MAX_AGE_MS` readiness probe cadence and freshness, defaults `30000` and `90000`
- `MCP_APP_ENABLED` to offer the beta SQD Explorer to compatible hosts, default off. Accepts `true` or `1`. Per-connection `?app=1` and `?app=0` override it.
- `MCP_TOOL_WEIGHT_BUDGET` to bound the combined cost of active tool calls, default `32`. Measured profiles allow up to 32 lookups, 4 raw or summary calls, or 2 analytics calls at once while queued work remains cancellation-aware.
- `MCP_TOOL_MAX_QUEUE` to bound queued tool calls, default `64`
- `MCP_TOOL_QUEUE_TIMEOUT_MS` to bound tool admission wait time, default `5000`
- `MCP_TOOL_CLIENT_WEIGHT_SHARE` percent of the weight budget one caller (bounded client family plus connection) may hold at once, default `50`; never below the heaviest single tool so every tool stays schedulable. `MCP_TOOL_CLIENT_MAX_QUEUE` bounds one caller's queued calls, default `16`. A caller over its share gets the retryable `overloaded` result with `reason: client_share` while others keep flowing.
- `MCP_TRUST_PROXY` set to `1` to key fairness on the first `X-Forwarded-For` hop instead of the socket address; the address is hashed and never stored or labelled.
- `MCP_SLOW_REQUEST_MS` threshold for one JSON line on stderr per slow tool call with admission wait and execution timings and the bounded client family, default `5000`.

## Tests

The [release-assurance contract](RELEASE_ASSURANCE.md) defines the complete v0.8.2 baseline and every gate added since, through v0.8.5. “100%” refers to every applicable cell in the declared matrix, not a claim that upstream networks can never fail.

```bash
npm test
npm run test:protocol
npm run test:tool-admission
npm run test:app-contract
npm run test:app-ui
npm run test:evidence-receipts
npm run test:investigation-prompts
npm run test:investigation-journeys
npm run test:tools
npm run test:routing
npm run test:substrate
npm run test:timestamps
npm run test:plugin
npm run test:claude-plugin
npm run test:grok-plugin
npm run test:conversations
npm run test:negative
npm run test:quality
npm run test:client-journeys
npm run test:ci
```

A nightly model-in-the-loop eval (`npm run eval:model-loop`, [scripts/README.md](scripts/README.md#model-in-the-loop-eval)) has a model answer pinned questions through the server and reports pass rate, tool calls, and tokens; `--model mock` verifies the question set without an API key.

## License

[MIT](LICENSE)
