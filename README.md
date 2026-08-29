# SQD Portal MCP Server

[![SQD Portal MCP server](https://glama.ai/mcp/servers/subsquid-labs/portal-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/subsquid-labs/portal-mcp-server)

Thin MCP wrapper around the [SQD Portal API](https://portal.sqd.dev) for blockchain data queries.

This server does not index chains itself. It validates user input, maps it onto Portal requests, and returns MCP-friendly responses.

The current v0.8.2 release supports the stateless MCP `2026-07-28` protocol over HTTP and stdio, while retaining the SDK-managed legacy negotiation path for clients still rolling out the revision. No SQD account, API key, or client credential is required.

The unreleased v0.8.3 candidate adds the SQD Blockchain Activity Explorer, adaptive tool execution, and complete app runtime metrics. It has not been tagged, published, or deployed.

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

Advanced/debug:
- `portal_debug_query_blocks`
- `portal_debug_resolve_time_to_block`
- `portal_debug_hyperliquid_query_replica_commands`

## Supported data

- EVM networks indexed by Portal, including Base, Ethereum, Optimism, Arbitrum, Monad, Hyperliquid EVM, and many others
- Tron discovery, head, freshness, and timestamp metadata, with native Tron stream queries documented in the bundled SQD plugin skill
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

`investigation` is a compact evidence guide for agents: it identifies the primary result path, bounded window, useful pivot fields such as addresses or transaction hashes, follow-up filters, and limitations before a result is treated as complete.

When a response uses estimated, partial, sampled, capped, or paginated data, the top-level answer and metadata disclose it. Safe pagination follow-ups include executable tool-call metadata with explicit cursor arguments; suggestions that cannot be reconstructed safely are marked non-executable.

Chart-oriented tools also return chart and table descriptors so MCP clients or LLMs can render them without reverse-engineering the payload.

The v0.8.3 candidate includes one portable SQD Blockchain Activity Explorer for 21 data tools. Compatible MCP App hosts can show exact metrics, charts, evidence tables, timelines, coverage, freshness, and continuation controls. The app is self-contained and makes no browser-side network requests. Hosts without MCP App support receive the same `structuredContent` and compact JSON text fallback, so the underlying answer never depends on the UI.

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
4. Leave authentication unset for v0.8.2.

Grok Build reads Claude Code plugins directly, so it uses the same package rather than a made-up Grok-only manifest:

```bash
grok plugin install --trust subsquid-labs/portal-mcp-server#plugins/portal
```

The v0.8.2 release gate validates the Codex, Claude Code, Grok Build, Gemini CLI, and Cursor packages. Where a client CLI is available, it also exercises its local package workflow.

## ChatGPT

In a workspace with custom MCP apps enabled, open **Settings → Apps → Create**, enter `https://portal.sqd.dev/mcp`, choose no authentication, scan the tools, and create the draft app. The server is read-only and does not require user credentials in v0.8.2.

## Claude Desktop

Add an entry like this to `claude_desktop_config.json`:

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

HTTP mode exposes MCP at `/` and `/mcp`, with health state at `/health`.

- MCP and health are public in v0.8.2. User authentication is deferred to a unified `auth.sqd.dev` flow in v0.9.0.
- Tool and resource discovery use the MCP protocol; retired `/tools` and `/tools.json` routes return `404`.
- Set `MCP_CURSOR_SECRET` in production so pagination cursors are signed with a deployment-specific secret. Local development uses a deterministic fallback for convenience.

Useful environment variables:

- `MCP_CURSOR_SECRET` to sign pagination cursors
- `MCP_TOOL_WEIGHT_BUDGET` to bound the combined cost of active tool calls, default `32`, which admits the declared c8 analytics profile
- `MCP_TOOL_MAX_QUEUE` to bound queued tool calls, default `64`
- `MCP_TOOL_QUEUE_TIMEOUT_MS` to bound tool admission wait time, default `2500`

## Tests

The [release-assurance contract](RELEASE_ASSURANCE.md) defines the complete v0.8.2 baseline and the additional v0.8.3 candidate gates. “100%” refers to every applicable cell in the declared matrix, not a claim that upstream networks can never fail.

```bash
npm test
npm run test:protocol
npm run test:tool-admission
npm run test:app-contract
npm run test:app-ui
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
npm run test:ci
```

## License

[MIT](LICENSE)
