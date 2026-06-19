# Portal App MCP Auth Contract

This is the contract between `subsquid/portal-app-ui` and the hosted Portal MCP server for v0.8.0 enterprise Portal access.

The portal app currently manages Gateway API keys through `/api-keys` and stores the browser account session token in `sqd.portal.authToken`. That browser token is only for portal-app API calls and must not be used as an MCP runtime credential.

## Actors

- Portal app user: signed in through the portal app.
- Portal app backend: owns account, organization, key issuance, hashing, revocation, and audit state.
- Portal MCP server: validates inbound MCP bearer keys, maps them to an endpoint context, and injects outbound Portal credentials through configured `PortalEndpoint` records.
- Dedicated Portal endpoint: the upstream public, internal, or enterprise Portal base URL used by MCP tools.

## Issued MCP Key Record

The portal app backend should store MCP keys as records equivalent to this shape. Secrets are one-time revealed at creation and only the hash is persisted.

```json
{
  "id": "mcpkey_01j...",
  "audience": "portal-mcp",
  "tokenSha256": "64 lowercase hex characters",
  "principalId": "user_123",
  "tenantId": "tenant_example",
  "endpointId": "enterprise-prod",
  "scopes": ["mcp:invoke"],
  "credentialPolicy": "tenant_portal_endpoint",
  "status": "active",
  "createdAt": "2026-06-18T00:00:00.000Z",
  "expiresAt": null,
  "lastUsedAt": null,
  "revokedAt": null
}
```

Required fields for Portal MCP runtime ingestion:

- `id`: stable key id safe to log.
- `audience`: must be `portal-mcp`; Gateway or browser account tokens are rejected by contract.
- `tokenSha256`: SHA-256 hex digest of the one-time revealed MCP secret.
- `principalId`: bounded user, service-account, or actor id.
- `endpointId`: id of a configured `PortalEndpoint`.
- `scopes`: must include `mcp:invoke`, `mcp:*`, or `*` for normal MCP calls.
- `credentialPolicy`: describes how outbound Portal credentials are selected.
- `status`: `active` or `revoked`.

Optional fields:

- `tenantId`: organization or tenant id. Portal MCP hashes it before diagnostics.
- `expiresAt`: ISO timestamp after which the MCP key is rejected.

## Runtime Configuration

Portal MCP accepts hosted key records through `MCP_AUTH_KEYS` as a JSON array. Production should provide hash records from the portal app backend or a generated deployment secret. Local/self-hosted fixtures may use `tokenEnv` instead of `tokenSha256` so tests can supply the raw secret from an environment variable.

The public repo should contain only placeholder endpoint ids, placeholder hostnames, and schema examples. Standard `*.portal.sqd.dev` dedicated portals are derived dynamically from the request host, so real customer endpoint mappings do not need to be checked in. Non-standard endpoint mappings, tenant identifiers, and outbound Portal credentials belong in the deployment environment, secret manager, or portal-app backend data store.

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

The outbound Portal credential remains separate from the inbound MCP key:

- Inbound MCP key: user-facing secret sent as `Authorization: Bearer <mcp-key>` to `POST /` or `POST /mcp`.
- Outbound Portal credential: server-side secret referenced by `PortalEndpoint.auth.tokenEnv`.

Dataset availability is determined by the selected Portal endpoint. Public MCP uses the public Portal `/datasets`; dedicated enterprise MCP uses that dedicated portal host's `/datasets`, for example `https://<customer-slug>.portal.sqd.dev/datasets` when the MCP URL is `https://<customer-slug>.portal.sqd.dev/mcp`. Portal MCP must not maintain a customer-named dataset allow-list in this public repo.

When MCP is mounted on portal origins, the portal edge should forward `https://<portal-host>/mcp` to the central MCP service while preserving `Host` or sending `X-Forwarded-Host` from a trusted proxy. Portal MCP uses that host to select the endpoint before executing tools. On non-public matched hosts, hosted MCP keys are accepted only when their `endpointId` matches the host-selected endpoint.

## Key Lifecycle

Create:

- Generate a high-entropy MCP secret.
- Store only `tokenSha256`.
- Reveal the secret exactly once.
- Bind it to `audience: "portal-mcp"`, `endpointId`, `tenantId`, and scopes.

Rotate:

- Create a new key with the same scope/endpoint policy.
- Reveal the new key once.
- Keep the old key active during migration.
- Revoke the old key after clients switch.

Revoke:

- Set `status: "revoked"` or remove the key record.
- Hosted MCP returns the same generic JSON-RPC 401 used for missing or invalid keys.
- Do not reveal whether a matching revoked key exists.

Expire:

- Set `expiresAt` for temporary service keys.
- Hosted MCP rejects expired keys with the same generic JSON-RPC 401.

## Browser Token Boundary

The portal app browser token stored at `sqd.portal.authToken` authorizes calls to the portal app API, such as:

- `GET /user`
- `GET /api-keys`
- `POST /api-keys`
- `GET /api-keys/:id?reveal=true`
- `DELETE /api-keys/:id`

It must not be accepted by the MCP runtime. The MCP runtime accepts only static self-hosted `MCP_HTTP_BEARER_TOKEN` credentials or hosted `MCP_AUTH_KEYS` records with `audience: "portal-mcp"`.

## Failure Semantics

- Missing or invalid MCP key: JSON-RPC-compatible 401 with `Unauthorized.`
- Revoked or expired MCP key: same 401 response.
- Insufficient MCP scope: JSON-RPC-compatible 403 with `Insufficient scope for MCP request.`
- Misconfigured key records: JSON-RPC-compatible 500 with a configuration error that does not include secret values.

No response should echo bearer tokens, raw tenant ids, outbound Portal credentials, or raw key material.
