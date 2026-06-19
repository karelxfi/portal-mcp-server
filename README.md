# SQD Portal MCP Server

Thin MCP wrapper around the [SQD Portal API](https://portal.sqd.dev) for blockchain data queries.

This server does not index chains itself. It validates user input, maps it onto Portal requests, and returns MCP-friendly responses.

## Current public surface

- `25` public tools
- `3` advanced/debug tools
- public params use `network`
- discovery filters use `vm`
- no legacy tool aliases in `v0.8.0`

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
- MCP resource `sqd://execution-guidance` explains when agents should use Portal MCP, Portal raw exports, or a durable Pipes SDK data pipeline.
- HTTP `GET /tools` or `GET /tools.json` returns the live tool catalog with input schemas plus the same structured guide metadata.

## Codex plugin

The Codex plugin wrapper lives in `plugins/portal` and defaults to the hosted MCP endpoint at `https://portal.sqd.dev/mcp`. Installing `portal@sqd` adds the hosted MCP server plus bundled Portal and Pipes SDK skills.

Install it from this repo-local marketplace:

```bash
codex plugin marketplace add .
codex plugin add portal@sqd
```

Open a new Codex thread after installing. First-use prompts include "Show the last 200 BTC perp fills on Hyperliquid with price, size, side, and raw rows only.", "Chart Base transaction throughput over the last 2 hours in 15-minute buckets.", and "Trace Base USDC flows from the past hour with amounts, counterparties, and tx hashes."

## Claude Code plugin

The Claude Code plugin uses the same hosted MCP endpoint, bundled skills, and public selector:

```bash
claude plugin marketplace add subsquid-labs/portal-mcp-server
claude plugin install portal@sqd
```

Open a new Claude Code session after installing so the SQD MCP tools are loaded.

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
- Use Portal MCP for bounded interactive answers; use Portal for raw rows, exports, or exact reproducible requests; use Pipes SDK when the user needs recurring sync, backfills, joins, durable storage, dashboards, alerts, or production APIs.
- For explicit raw rows, last-N records, CSV/NDJSON, files, or curl prompts, skip overview narration. Run the direct query/export path and put the requested rows or file first; add no more than one short postscript about caps, pagination, or reproducibility.
- Time windows accept compact and natural wording such as `30m`, `past 30 minutes`, `in the past 1h`, `in last 38 mins`, `last hour`, or `30 minutes ago`.
- Use `portal_evm_get_ohlc` and `portal_hyperliquid_get_ohlc` only when you actually need candle-shaped output.
- For large or exploratory queries, prefer `response_format: "compact"` unless you need the full record shape.

## HTTP Deployment Notes

HTTP mode exposes liveness at `/health`, readiness at `/ready`, and read-only tool discovery at `/tools` and `/tools.json`.

The managed hosted endpoint at `https://portal.sqd.dev/mcp` is the canonical plugin endpoint. Hosted release validation is MCP-resource based: initialize the MCP server, list tools, and read `sqd://tools` plus `sqd://execution-guidance`. If the hosted edge also exposes `/health` or `/tools`, those routes must report the same release version; otherwise `npm run test:hosted-release` treats hosted discovery as MCP-only and logs the skipped HTTP route.

- Set `MCP_HTTP_BEARER_TOKEN` to require `Authorization: Bearer <token>` for `POST /` and `POST /mcp`.
- Hosted deployments can also use portal-app issued MCP keys through `MCP_AUTH_KEYS`; see [Portal app MCP auth contract](docs/portal-app-mcp-auth-contract.md).
- Hosted deployments can use built-in MCP OAuth delegated Portal API-key bootstrap with `MCP_DELEGATED_AUTH=true` and endpoint `authMode: "delegated_api_key"`; compatible MCP clients connect to `/mcp`, open the hosted auth form, and finish the token exchange automatically after the user pastes a Portal API key once.
- The public `https://portal.sqd.dev/mcp` endpoint remains anonymous by default. Delegated auth is required only for endpoints configured as `internal` or `enterprise`, unless a deployment explicitly sets global static auth.
- `/health`, `/ready`, and read-only `GET /tools` / `GET /tools.json` remain public.
- `/health` is a safe liveness check and intentionally omits Portal URLs, tenant ids, and secrets.
- `/ready` returns safe endpoint metadata plus readiness checks for endpoint config, `MCP_CURSOR_SECRET`, MCP auth, metrics protection, and default Portal reachability. It returns `503` only when a required check fails.
- Set `MCP_READINESS_STRICT=true` in hosted/production deployments to require cursor signing, MCP auth, metrics protection, and Portal reachability. `NODE_ENV=production` also enables strict readiness.
- Set `MCP_READY_CHECK_PORTAL=false` to skip the live Portal reachability probe, or `MCP_READY_REQUIRE_PORTAL=true` to require it outside strict mode.
- Set `MCP_CURSOR_SECRET` in production so pagination cursors are signed with a deployment-specific secret. Local development uses a deterministic fallback for convenience.

Detailed v0.8.0 deployment docs:

- [v0.8.0 migration notes](docs/v0.8.0-migration.md)
- [Enterprise HTTP deployment](docs/enterprise-http-deployment.md)
- [v0.8.0 release runbook](docs/v0.8.0-release-runbook.md)

## Portal Endpoint Configuration

By default, Portal MCP uses the public SQD Portal endpoint at `https://portal.sqd.dev`. The legacy `PORTAL_URL` variable remains supported and now maps to the default `PortalEndpoint` base URL.

For one dedicated endpoint, set:

- `PORTAL_BASE_URL` / `PORTAL_URL` to the upstream Portal API base URL, without query strings or embedded credentials
- `PORTAL_ENDPOINT_ID` to a stable opaque id such as `enterprise-prod`
- `PORTAL_ENDPOINT_LABEL` to a safe display label
- `PORTAL_ENDPOINT_CLASS` to `internal` for SQD-operated internal Portal endpoints, or `enterprise` for customer-dedicated endpoints
- `PORTAL_MCP_HOSTNAMES` / `PORTAL_ENDPOINT_HOSTNAMES` or `mcpHostnames` to the portal hostnames that should route `/mcp` traffic to this endpoint when they differ from the upstream Portal API base URL
- `PORTAL_ENDPOINT_TENANT_SCOPE` to `organization`, `tenant`, or `endpoint`
- `PORTAL_ENDPOINT_TENANT_ID` to a safe tenant slug when useful for diagnostics
- `PORTAL_ENDPOINT_AUTH_MODE` to `bearer`, `api_key`, or `delegated_api_key`
- `PORTAL_ENDPOINT_TOKEN_ENV` to the name of the environment variable that contains the outbound Portal credential
- `PORTAL_ENDPOINT_API_KEY_HEADER` when `api_key` or `delegated_api_key` mode needs a header other than `X-API-Key`

Internal and enterprise endpoint URLs must use HTTPS when outbound Portal credentials are configured.

Endpoint classes are intentionally small:

- `public`: the public `https://portal.sqd.dev` endpoint, with no outbound Portal auth.
- `internal`: SQD-operated internal endpoints, protected by a server-side Portal credential or delegated user Portal API key configured outside this repo.
- `enterprise`: customer-dedicated endpoints, protected by that endpoint's server-side Portal credential or delegated user Portal API key configured outside this repo.

For multi-endpoint routing, set `PORTAL_ENDPOINTS` to a JSON array of endpoint objects and optionally set `PORTAL_DEFAULT_ENDPOINT_ID`. Endpoint objects use the fields `id`, `portalBaseUrl`, `mcpHostnames`, `label`, `endpointClass`, `tenantScope`, `tenantId`, `authMode`, `tokenEnv`, and `headerName`. Legacy `baseUrl` and `hostnames` remain accepted. In `delegated_api_key` mode, omit `tokenEnv`; the authenticated MCP session supplies the Portal API key.

Hosted deployments can expose MCP on the same portal origin as the data API. Configure the portal edge or reverse proxy to route `https://<portal-host>/mcp` to the central MCP service while preserving `Host`; if the proxy rewrites `Host`, set `MCP_TRUST_FORWARDED_HOST=true` and forward the original host in `X-Forwarded-Host`. The public `portal.sqd.dev` host stays anonymous. Any single-label `*.portal.sqd.dev` host is resolved dynamically as a delegated enterprise Portal endpoint with `portalBaseUrl=https://<that-host>`, so one MCP service can handle dedicated portals without committing customer hostnames. Mark internal hosts only through deployment environment with `PORTAL_DYNAMIC_INTERNAL_HOSTS`. Use deployment-only `PORTAL_ENDPOINTS` only for non-standard hosts, local aliases, or server-side outbound credentials.

Do not put Portal credentials, real customer hostnames, or real customer identifiers directly into this public repo. Configure `PORTAL_BASE_URL` / `PORTAL_ENDPOINTS` and secret values through the deployment environment or secret manager. Use `tokenEnv` / `PORTAL_ENDPOINT_TOKEN_ENV` so secrets stay in environment variables and can be injected only by the endpoint-aware Portal client.

Useful environment variables:

- `PORTAL_BASE_URL` / `PORTAL_URL` to override the default upstream Portal API base URL
- `PORTAL_ENDPOINTS` and `PORTAL_DEFAULT_ENDPOINT_ID` for future multi-endpoint routing
- `MCP_TRUST_FORWARDED_HOST` when a trusted portal edge forwards the original portal host through `X-Forwarded-Host`
- `MCP_HTTP_BEARER_TOKEN` to protect HTTP MCP POSTs
- `MCP_AUTH_KEYS` and `MCP_REQUIRED_SCOPE` for hosted portal-app issued MCP keys
- `MCP_DELEGATED_AUTH=true` or `MCP_AUTH_MODE=portal_api_key_bootstrap` for built-in MCP OAuth delegated Portal API-key sessions. `/mcp/auth` remains available as a local/manual smoke-test fallback.
- `MCP_DELEGATED_AUTH_VALIDATE=false` only for local UX smoke tests that should skip the live `/status` key check
- `MCP_CURSOR_SECRET` to sign pagination cursors
- `MCP_READINESS_STRICT`, `MCP_READY_CHECK_PORTAL`, and `MCP_READY_REQUIRE_PORTAL` to tune `/ready`
- `METRICS_BEARER_TOKEN` to protect `/metrics`

## Tests

```bash
npm test
npm run test:tools
npm run test:routing
npm run test:substrate
npm run test:timestamps
npm run test:auth
npm run test:http-runtime
npm run test:plugin
npm run test:claude-plugin
npm run test:hosted-release
npm run test:readiness
npm run test:conversations
npm run test:realistic-prompts
npm run test:negative
npm run test:quality
npm run test:endpoints
npm run test:package
npm run test:ci
```

## License

[MIT](LICENSE)
