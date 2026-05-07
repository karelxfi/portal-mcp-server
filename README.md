# SQD Portal MCP Server

Thin MCP wrapper around the [SQD Portal API](https://portal.sqd.dev) for blockchain data queries.

This server does not index chains itself. It validates user input, maps it onto Portal requests, and returns MCP-friendly responses.

## Current public surface

- `23` public tools
- `3` advanced/debug tools
- public params use `network`
- discovery filters use `vm`
- no legacy tool aliases in `v0.7.7`

Raw query tools default to compact responses. Ask for `response_format: "full"` only when you need the larger payload.

## Tool groups

Discovery:
- `portal_list_networks`
- `portal_get_network_info`
- `portal_get_head`

Cross-chain convenience:
- `portal_get_recent_activity`
- `portal_get_wallet_summary`
- `portal_get_time_series`

EVM:
- `portal_evm_query_transactions`
- `portal_evm_query_logs`
- `portal_evm_query_token_transfers`
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

- `_freshness`
- `_coverage`
- `_pagination`
- `_ordering`

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
- Use `portal_evm_get_ohlc` and `portal_hyperliquid_get_ohlc` only when you actually need candle-shaped output.
- For large or exploratory queries, prefer `response_format: "compact"` unless you need the full record shape.

## Observability

HTTP mode exposes health state at `/health`. Prometheus metrics are available at `/metrics`, but the endpoint is private by default:

- Set `METRICS_BEARER_TOKEN` and scrape with `Authorization: Bearer <token>`.
- Set `METRICS_PUBLIC=true` only for local/dev environments where public metrics are intentional.
- If neither variable is set, `/metrics` returns `404`.

The bundled Grafana dashboard is at `grafana/portal-mcp-dashboard.json`. It uses:

- Prometheus for live `/metrics` scrape data such as request rates, active calls, latency, and response sizes.
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
