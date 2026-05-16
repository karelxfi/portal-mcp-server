# SQD Portal MCP Server

Thin MCP wrapper around the [SQD Portal API](https://portal.sqd.dev) for blockchain data queries.

This server does not index chains itself. It validates user input, maps it onto Portal requests, and returns MCP-friendly responses.

## Current public surface

- `25` public tools
- `3` advanced/debug tools
- `1` reusable MCP prompt for SQD-only analyst behavior
- public params use `network`
- discovery filters use `vm`
- no legacy tool aliases in `v0.7.9`

Raw query tools default to compact responses. Ask for `response_format: "full"` only when you need the larger payload.

Entity questions can use `portal_resolve_entity` first. It resolves EVM token symbols/addresses, EVM contract aliases, pool identifiers, protocol names, and Hyperliquid coin names into query-ready filters while keeping ambiguous matches explicit.

Token symbol resolution and token metadata come from open token-list data, not baked-in token address constants. Token-list fetch outcomes, cache events, stale-cache fallback, and unsupported networks are exposed through Prometheus metrics.

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

Most tools return a normal result body plus shared metadata such as:

- `answer`
- `display`
- `next_steps`
- `investigation`
- `_freshness`
- `_coverage`
- `_pagination`
- `_ordering`

`investigation` is a compact evidence guide for agents: it identifies the primary result path, bounded window, useful pivot fields such as addresses or transaction hashes, follow-up filters, and limitations before a result is treated as complete.

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
- MCP prompt `portal_onchain_analyst` gives clients a reusable SQD-only investigation and market/protocol analysis mode. It explicitly excludes third-party data surfaces and social-thread/newsletter narrative writing from scope.
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

## Observability

HTTP mode exposes health state at `/health`. Prometheus metrics are available at `/metrics`, but the endpoint is private by default:

- Set `METRICS_BEARER_TOKEN` and scrape with `Authorization: Bearer <token>`.
- Set `METRICS_PUBLIC=true` only for local/dev environments where public metrics are intentional.
- If neither variable is set, `/metrics` returns `404`.

The bundled Grafana dashboard is at `grafana/portal-mcp-dashboard.json`. It uses:

- Prometheus for live `/metrics` scrape data such as request rates, active calls, latency, and response sizes.
- Prometheus token-list counters such as `mcp_token_list_requests_total`, `mcp_token_list_cache_events_total`, and `mcp_token_list_unsupported_networks_total`.
- Loki for long-window tool-call history. Configure `GRAFANA_LOKI_URL` plus either `GRAFANA_LOKI_TOKEN` or `GRAFANA_LOKI_USERNAME`/`GRAFANA_LOKI_PASSWORD` to push structured tool events.

Useful environment variables:

- `OBS_SERVICE_NAME` (default `sqd-portal-mcp`)
- `OBS_ENV` (default `NODE_ENV` or `production`)
- `OBS_LOG_JSON=true` to emit structured events to stderr
- `OBS_CAPTURE_USER_QUERY=true` to include forwarded `x-mcp-user-query` text in telemetry
- `METRICS_BEARER_TOKEN` to protect `/metrics`
- `METRICS_PUBLIC=true` to deliberately expose `/metrics` without auth

For 30-day Grafana windows, Prometheus must scrape `/metrics` continuously with matching retention, or the Loki event panels must be backed by configured log export. In-process Prometheus counters cannot backfill history by themselves.

## Tests

```bash
npm test
npm run test:tools
npm run test:routing
npm run test:substrate
npm run test:timestamps
npm run test:observability
npm run test:conversations
npm run test:negative
npm run test:quality
npm run test:ci
```

## License

[MIT](LICENSE)
