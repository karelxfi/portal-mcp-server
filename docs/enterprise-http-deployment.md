# Enterprise HTTP Deployment

This guide covers hosted Portal MCP deployments for dedicated Portal endpoints.

## Runtime Shape

Run the HTTP entrypoint:

```bash
node dist/http.js
```

Required public endpoints:

- `GET /health`: safe process liveness.
- `GET /ready`: readiness checks for deployment guards and Portal reachability.
- `GET /tools` and `GET /tools.json`: read-only catalog metadata.
- `POST /` and `POST /mcp`: MCP JSON-RPC over streamable HTTP.
- `GET /metrics`: Prometheus metrics when protected by `METRICS_BEARER_TOKEN` or intentionally exposed with `METRICS_PUBLIC=true`.

## Dynamic Dedicated Portal Routing

For the standard SQD shape, you do not need to enumerate customer endpoints. Route `/mcp` traffic for `*.portal.sqd.dev` to the central MCP service and preserve the original `Host` header. The MCP service derives the Portal endpoint from that host:

```text
https://<customer-slug>.portal.sqd.dev/mcp -> https://<customer-slug>.portal.sqd.dev
https://customer-b.portal.sqd.dev/mcp -> https://customer-b.portal.sqd.dev
https://portal.sqd.dev/mcp            -> public https://portal.sqd.dev
```

Dynamic dedicated endpoints use delegated API-key auth and send the user's key upstream only to the same Portal host. Single-label `*.portal.sqd.dev` hosts are treated as enterprise endpoints by default. Internal host classification is opt-in through deployment environment, so no real customer or internal hostnames need to live in this public repo.

Relevant runtime switches:

```bash
MCP_DELEGATED_AUTH=true
PORTAL_DYNAMIC_DEDICATED_ENDPOINTS=true
PORTAL_DYNAMIC_DEDICATED_DOMAIN=portal.sqd.dev
PORTAL_DYNAMIC_INTERNAL_HOSTS=<internal-host>.portal.sqd.dev
PORTAL_DYNAMIC_DEDICATED_API_KEY_HEADER=x-api-key
```

The defaults already enable `*.portal.sqd.dev` dynamic routing with `X-API-Key`; set the variables only when the deployment needs to override the domain, mark internal hosts, or change the API-key header.

## Explicit Portal Endpoint

Use explicit endpoint config for non-standard hosts, local aliases, or deployments that need a server-side outbound Portal credential.

Use a stable endpoint id and keep credentials in environment variables:

```bash
PORTAL_ENDPOINTS='[
  {
    "id": "enterprise-prod",
    "portalBaseUrl": "https://upstream.portal.example.com",
    "mcpHostnames": ["dedicated.portal.example.com"],
    "label": "Enterprise production",
    "endpointClass": "enterprise",
    "tenantScope": "tenant",
    "tenantId": "tenant_example",
    "authMode": "bearer",
    "tokenEnv": "ENTERPRISE_PORTAL_TOKEN"
  }
]'
PORTAL_DEFAULT_ENDPOINT_ID=enterprise-prod
ENTERPRISE_PORTAL_TOKEN=<outbound-portal-secret>
```

Endpoint classes are:

- `public`: the public `https://portal.sqd.dev` endpoint with no outbound auth.
- `internal`: SQD-operated internal endpoints configured outside this public repo.
- `enterprise`: customer-dedicated endpoints configured outside this public repo.

Internal and enterprise endpoints can reference a server-side outbound Portal credential:

```bash
PORTAL_BASE_URL=https://upstream.portal.example.com
PORTAL_ENDPOINT_ID=internal-main
PORTAL_MCP_HOSTNAMES=internal.portal.example.com
PORTAL_ENDPOINT_LABEL="SQD internal Portal"
PORTAL_ENDPOINT_CLASS=internal
PORTAL_ENDPOINT_TENANT_SCOPE=tenant
PORTAL_ENDPOINT_TENANT_ID=sqd
PORTAL_ENDPOINT_AUTH_MODE=api_key
PORTAL_ENDPOINT_TOKEN_ENV=SQD_INTERNAL_PORTAL_API_KEY
PORTAL_ENDPOINT_API_KEY_HEADER=x-api-key
SQD_INTERNAL_PORTAL_API_KEY=<outbound-portal-secret>
```

`portalBaseUrl` must use HTTPS for internal and enterprise endpoints and must not include credentials, query strings, or fragments.
Do not commit real `PORTAL_ENDPOINTS`, customer hostnames, tenant ids, or secret values to this public repo; store them in the deployment environment or secret manager.

For the no-portal-app remote UX, use delegated Portal API-key auth instead of a server-side `tokenEnv`:

```bash
PORTAL_ENDPOINTS='[
  {
    "id": "sqd-internal",
    "portalBaseUrl": "https://upstream.portal.example.com",
    "mcpHostnames": ["sqd.portal.example.com"],
    "label": "SQD internal Portal",
    "endpointClass": "internal",
    "tenantScope": "tenant",
    "tenantId": "sqd",
    "authMode": "delegated_api_key",
    "headerName": "x-api-key"
  }
]'
PORTAL_DEFAULT_ENDPOINT_ID=sqd-internal
MCP_DELEGATED_AUTH=true
```

In this mode, users add `https://<portal-host>/mcp` in a compatible MCP client. The MCP auth handshake opens the MCP-hosted Portal API-key form, the user pastes their Portal API key once, and the client receives the MCP access token through the OAuth code flow. Users should not copy or see an MCP bearer token. The Portal API key is sent upstream only as `x-api-key` for that selected endpoint.

## Same-Origin MCP Routing

The recommended hosted shape is:

- public users call `https://portal.sqd.dev/mcp`
- dedicated portal users call `https://<dedicated-portal-host>/mcp`
- the portal edge forwards those `/mcp` requests to one central MCP service

`https://portal.sqd.dev/mcp` should remain public by default. Dedicated and internal Portal hosts should require delegated Portal API-key auth. In other words, enabling `MCP_DELEGATED_AUTH=true` for the central deployment must not turn the public Portal MCP endpoint into an authenticated endpoint.

The MCP service resolves the request host to either a configured `PortalEndpoint` or a dynamic `*.portal.sqd.dev` endpoint. Preserve the original `Host` header when possible. If the edge rewrites `Host`, set:

```bash
MCP_TRUST_FORWARDED_HOST=true
```

and forward the original portal host as `X-Forwarded-Host`.

## Customer Auth UX

Dedicated portal customers should only need the MCP URL for their portal:

```text
https://<customer-slug>.portal.sqd.dev/mcp
```

The MCP client discovers auth from that URL, opens the hosted SQD Portal MCP page, and the page is already scoped to the customer's portal host. The customer should not choose a portal, enter a portal URL, or copy an MCP bearer token. They enter only their existing Portal API key.

The auth page should follow Portal app UI conventions: compact white surface, Inter, zinc neutrals, black primary action, indigo focus ring, small radius, and restrained copy. It should make these points obvious:

- Portal identity: the dedicated Portal label and hostname are visible before the API-key field.
- Client identity: the requesting MCP client name and return origin are visible when available.
- Endpoint lock: copy states that the key is validated and used only against this Portal endpoint.
- No token copy: the browser success path never displays the MCP bearer token.
- Error recovery: invalid, rejected, or timed-out Portal keys return a plain inline error and keep the user on the same scoped page.

For a no-portal-app rollout, prefer delegated API-key bootstrap when the MCP service should own the flow. The MCP service exposes OAuth discovery, public-client registration, PKCE authorization-code exchange, and `/mcp/auth` manual smoke-test fallback. Alternatively, the portal edge can validate the existing portal API key, strip customer credentials, and forward to MCP with an internal service bearer token configured as `MCP_HTTP_BEARER_TOKEN`.

## Local Delegated Auth Smoke

This local flow exercises the UX without touching portal app and without a real Portal key:

```bash
npm run build
PORT=3196 \
MCP_DELEGATED_AUTH=true \
MCP_DELEGATED_AUTH_VALIDATE=false \
MCP_TRUST_FORWARDED_HOST=true \
MCP_READY_CHECK_PORTAL=false \
PORTAL_ENDPOINTS='[
  {
    "id": "sqd-internal",
    "portalBaseUrl": "https://portal.sqd.dev",
    "mcpHostnames": ["sqd.portal.localhost"],
    "label": "SQD internal Portal",
    "endpointClass": "internal",
    "tenantScope": "tenant",
    "tenantId": "sqd",
    "authMode": "delegated_api_key",
    "headerName": "x-api-key"
  }
]' \
PORTAL_DEFAULT_ENDPOINT_ID=sqd-internal \
node dist/http.js
```

Then open:

```text
http://localhost:3196/mcp/auth?host=sqd.portal.localhost
```

Paste any local test value. The browser page should show only a connected state, not a token. For a JSON/manual engineering smoke:

```bash
TOKEN=$(curl -sS http://localhost:3196/mcp/auth?host=sqd.portal.localhost \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  --data '{"api_key":"local-test-key"}' | jq -r .mcp_token)

curl -sS http://localhost:3196/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-forwarded-host: sqd.portal.localhost" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

`MCP_DELEGATED_AUTH_VALIDATE=false` is only for local UX smoke tests. In hosted use, leave validation enabled so the OAuth authorize step and `/mcp/auth` fallback check the key against the selected Portal endpoint's `/status`.

## Inbound MCP Auth

For portal-app issued keys, configure `MCP_AUTH_KEYS` with hashed key records:

```bash
MCP_AUTH_KEYS='[
  {
    "id": "mcpkey_01j...",
    "audience": "portal-mcp",
    "tokenSha256": "64 lowercase hex characters",
    "principalId": "user_123",
    "tenantId": "tenant_example",
    "endpointId": "enterprise-prod",
    "scopes": ["mcp:invoke"],
    "credentialPolicy": "tenant_portal_endpoint",
    "status": "active"
  }
]'
```

Clients call:

```bash
curl -sS http://localhost:3000/mcp \
  -H "Authorization: Bearer <mcp-key>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Readiness Policy

Recommended hosted settings:

```bash
MCP_READINESS_STRICT=true
MCP_CURSOR_SECRET=<deployment-specific-secret>
METRICS_BEARER_TOKEN=<metrics-token>
```

In strict mode, `/ready` requires:

- valid endpoint config
- configured cursor signing
- MCP auth through `MCP_HTTP_BEARER_TOKEN` or `MCP_AUTH_KEYS`
- protected metrics
- reachable default Portal endpoint

The readiness response uses safe endpoint metadata only. Raw endpoint URLs, tenant ids, key ids, and secrets must not appear.

## Operational Checks

```bash
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
curl -fsS http://localhost:3000/tools | jq '.endpoint, .tool_count'
curl -fsS http://localhost:3000/metrics -H "Authorization: Bearer $METRICS_BEARER_TOKEN" | head
```

For debugging MCP requests, pass a request id:

```bash
curl -sS http://localhost:3000/mcp \
  -H "x-request-id: ops-smoke-001" \
  -H "Authorization: Bearer <mcp-key>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"portal_get_head","arguments":{"network":"base"}}}'
```

JSON tool events include that request id, a generated invocation id, safe endpoint/auth context, and upstream Portal status summaries.
