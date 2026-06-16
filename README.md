# SQD Portal MCP Server

Thin MCP wrapper around the [SQD Portal API](https://portal.sqd.dev) for blockchain data queries.

This server does not index chains itself. It validates user input, maps it onto Portal requests, and returns MCP-friendly responses.

## Current public surface

- `25` public tools
- `3` advanced/debug tools
- public params use `network`
- discovery filters use `vm`
- no legacy tool aliases in `v0.7.9`

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

- EVM networks indexed by Portal, including Base, Ethereum, Optimism, Arbitrum, Monad, Hyperliquid EVM, and others
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

The server does not ship its own frontend. It returns structured data and rendering hints for the client to use.

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
- HTTP `GET /tools` or `GET /tools.json` returns the live tool catalog with input schemas plus the same structured guide metadata.

## Claude Desktop

Add an entry like this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sqd-portal": {
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

HTTP mode exposes health state at `/health` and read-only tool discovery at `/tools` and `/tools.json`.

- Set `MCP_HTTP_BEARER_TOKEN` to require `Authorization: Bearer <token>` for `POST /` and `POST /mcp`.
- `/health` and read-only `GET /tools` / `GET /tools.json` remain public.
- Set `MCP_CURSOR_SECRET` in production so pagination cursors are signed with a deployment-specific secret. Local development uses a deterministic fallback for convenience.

Useful environment variables:

- `MCP_HTTP_BEARER_TOKEN` to protect HTTP MCP POSTs
- `MCP_CURSOR_SECRET` to sign pagination cursors

## Tests

```bash
npm test
npm run test:tools
npm run test:routing
npm run test:substrate
npm run test:timestamps
npm run test:conversations
npm run test:negative
npm run test:quality
npm run test:ci
```

## License

[MIT](LICENSE)
