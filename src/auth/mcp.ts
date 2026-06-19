import { createHash, timingSafeEqual } from 'node:crypto'

import { authenticateDelegatedMcpSessionToken, isDelegatedMcpAuthEnabled } from './delegated.js'
import { hashString53 } from '../helpers/hash.js'
import {
  type PortalEndpoint,
  getDefaultPortalEndpoint,
  getPortalEndpointById,
  portalEndpointKey,
} from '../portal/endpoints.js'

export type McpAuthMode = 'anonymous' | 'static' | 'hosted' | 'delegated'

export interface McpAuthContext {
  mode: McpAuthMode
  principal_id: string
  tenant_id?: string
  tenant_key?: string
  audience?: string
  endpoint: PortalEndpoint
  endpoint_key: string
  scopes: string[]
  credential_policy: string
  expires_at?: string
  key_id?: string
  delegated_credential_ref?: string
}

export type McpAuthResult =
  | { ok: true; context: McpAuthContext }
  | {
      ok: false
      status: 401 | 403 | 500
      code: number
      message: string
      headers?: Record<string, string>
    }

type RawHostedMcpKey = Record<string, unknown>

interface HostedMcpKey {
  id: string
  tokenEnv?: string
  tokenSha256?: string
  principalId: string
  tenantId?: string
  audience: 'portal-mcp'
  endpoint: PortalEndpoint
  scopes: string[]
  credentialPolicy: string
  status: 'active' | 'revoked'
  expiresAt?: string
}

export interface McpAuthConfigurationStatus {
  ok: boolean
  mode: 'anonymous' | 'static' | 'hosted' | 'static+hosted' | 'delegated' | 'delegated+static' | 'delegated+hosted' | 'delegated+static+hosted'
  protected: boolean
  required_scope: string
  hosted_key_count: number
  missing_hosted_secret_count: number
  endpoint_keys: string[]
  delegated_enabled: boolean
  error?: string
}

const DEFAULT_REQUIRED_SCOPE = 'mcp:invoke'
const DEFAULT_CREDENTIAL_POLICY = 'default_portal_endpoint'
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function failConfig(message: string): never {
  throw new Error(`Invalid MCP auth configuration: ${message}`)
}

function readString(value: unknown, field: string, fallback?: string): string {
  if (typeof value === 'undefined' || value === null || value === '') {
    if (typeof fallback === 'string') return fallback
    failConfig(`${field} is required`)
  }

  if (typeof value !== 'string') {
    failConfig(`${field} must be a string`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    if (typeof fallback === 'string') return fallback
    failConfig(`${field} is required`)
  }

  return trimmed
}

function readEnvName(value: unknown, field: string): string | undefined {
  if (typeof value === 'undefined' || value === null || value === '') return undefined
  const envName = readString(value, field)
  if (!ENV_NAME_PATTERN.test(envName)) {
    failConfig(`${field} must be an environment variable name`)
  }
  return envName
}

function readStringArray(value: unknown, field: string): string[] {
  if (typeof value === 'undefined' || value === null || value === '') return [DEFAULT_REQUIRED_SCOPE]

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean)
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value.map((entry) => entry.trim()).filter(Boolean)
  }

  failConfig(`${field} must be a string array or comma-separated string`)
}

function readScopes(value: unknown): string[] {
  return readStringArray(value, 'scopes')
}

function readTokenSha256(value: unknown, field: string): string | undefined {
  if (typeof value === 'undefined' || value === null || value === '') return undefined
  const hash = readString(value, field).toLowerCase()
  if (!SHA256_HEX_PATTERN.test(hash)) {
    failConfig(`${field} must be a lowercase sha256 hex digest`)
  }
  return hash
}

function readAudience(value: unknown, field: string): 'portal-mcp' {
  const audience = readString(value, field, 'portal-mcp')
  if (audience !== 'portal-mcp') {
    failConfig(`${field} must be "portal-mcp"`)
  }
  return audience
}

function readStatus(value: unknown, field: string): 'active' | 'revoked' {
  const status = readString(value, field, 'active')
  if (status === 'active' || status === 'revoked') return status
  failConfig(`${field} must be "active" or "revoked"`)
}

function readIsoDate(value: unknown, field: string): string | undefined {
  if (typeof value === 'undefined' || value === null || value === '') return undefined
  const raw = readString(value, field)
  if (Number.isNaN(new Date(raw).getTime())) {
    failConfig(`${field} must be an ISO timestamp`)
  }
  return raw
}

function parseHostedKeys(env: NodeJS.ProcessEnv): HostedMcpKey[] {
  const rawJson = readEnv(env, 'MCP_AUTH_KEYS')
  if (!rawJson) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    failConfig('MCP_AUTH_KEYS must be valid JSON')
  }

  if (!Array.isArray(parsed)) {
    failConfig('MCP_AUTH_KEYS must be an array')
  }

  return parsed.map((rawEntry, index): HostedMcpKey => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      failConfig(`MCP_AUTH_KEYS[${index}] must be an object`)
    }

    const entry = rawEntry as RawHostedMcpKey
    if (
      typeof entry.token !== 'undefined' ||
      typeof entry.secret !== 'undefined' ||
      typeof entry.apiKey !== 'undefined' ||
      typeof entry.authorization !== 'undefined' ||
      typeof entry.bearer !== 'undefined'
    ) {
      failConfig(`MCP_AUTH_KEYS[${index}] must reference secrets with tokenEnv, not inline secret values`)
    }

    const id = readString(entry.id, `MCP_AUTH_KEYS[${index}].id`, `key-${index + 1}`)
    const tokenEnv = readEnvName(entry.tokenEnv, `MCP_AUTH_KEYS[${index}].tokenEnv`)
    const tokenSha256 = readTokenSha256(
      entry.tokenSha256 ?? entry.token_sha256 ?? entry.secretSha256 ?? entry.secret_sha256,
      `MCP_AUTH_KEYS[${index}].tokenSha256`,
    )
    if (!tokenEnv && !tokenSha256) {
      failConfig(`MCP_AUTH_KEYS[${index}] must provide tokenSha256 or tokenEnv`)
    }
    const principalId = readString(entry.principalId ?? entry.principal, `MCP_AUTH_KEYS[${index}].principalId`, id)
    const tenantIdValue = entry.tenantId ?? entry.tenant
    const tenantId =
      typeof tenantIdValue === 'undefined' || tenantIdValue === null || tenantIdValue === ''
        ? undefined
        : readString(tenantIdValue, `MCP_AUTH_KEYS[${index}].tenantId`)
    const endpointId =
      typeof entry.endpointId === 'undefined' || entry.endpointId === null || entry.endpointId === ''
        ? undefined
        : readString(entry.endpointId, `MCP_AUTH_KEYS[${index}].endpointId`)
    const endpoint = endpointId ? getPortalEndpointById(endpointId, env) : getDefaultPortalEndpoint(env)
    if (!endpoint) {
      failConfig(`MCP_AUTH_KEYS[${index}].endpointId "${endpointId}" does not match any configured Portal endpoint`)
    }

    const scopes = readScopes(entry.scopes)
    if (scopes.length === 0) {
      failConfig(`MCP_AUTH_KEYS[${index}].scopes must not be empty`)
    }

    const expiresAt = readIsoDate(entry.expiresAt ?? entry.expires_at, `MCP_AUTH_KEYS[${index}].expiresAt`)

    return {
      id,
      ...(tokenEnv ? { tokenEnv } : {}),
      ...(tokenSha256 ? { tokenSha256 } : {}),
      principalId,
      ...(tenantId ? { tenantId } : {}),
      audience: readAudience(entry.audience, `MCP_AUTH_KEYS[${index}].audience`),
      endpoint,
      scopes,
      credentialPolicy: readString(
        entry.credentialPolicy ?? entry.credential_policy,
        `MCP_AUTH_KEYS[${index}].credentialPolicy`,
        DEFAULT_CREDENTIAL_POLICY,
      ),
      status: readStatus(entry.status, `MCP_AUTH_KEYS[${index}].status`),
      ...(expiresAt ? { expiresAt } : {}),
    }
  })
}

export function getMcpAuthConfigurationStatus(env: NodeJS.ProcessEnv = process.env): McpAuthConfigurationStatus {
  const requiredScope = readEnv(env, 'MCP_REQUIRED_SCOPE') ?? DEFAULT_REQUIRED_SCOPE
  const hasStaticToken = Boolean(readEnv(env, 'MCP_HTTP_BEARER_TOKEN'))
  const hasDelegatedAuth = isDelegatedMcpAuthEnabled(env)

  try {
    const hostedKeys = parseHostedKeys(env)
    const missingHostedSecretCount = hostedKeys.filter((key) => key.tokenEnv && !readEnv(env, key.tokenEnv)).length
    const endpointKeys = Array.from(new Set(hostedKeys.map((key) => portalEndpointKey(key.endpoint)))).sort()
    const hasHostedKeys = hostedKeys.length > 0
    const modeParts = [
      ...(hasDelegatedAuth ? ['delegated'] : []),
      ...(hasStaticToken ? ['static'] : []),
      ...(hasHostedKeys ? ['hosted'] : []),
    ]

    return {
      ok: missingHostedSecretCount === 0,
      mode: (modeParts.length > 0 ? modeParts.join('+') : 'anonymous') as McpAuthConfigurationStatus['mode'],
      protected: hasStaticToken || hasHostedKeys || hasDelegatedAuth,
      required_scope: requiredScope,
      hosted_key_count: hostedKeys.length,
      missing_hosted_secret_count: missingHostedSecretCount,
      endpoint_keys: endpointKeys,
      delegated_enabled: hasDelegatedAuth,
      ...(missingHostedSecretCount > 0
        ? { error: `${missingHostedSecretCount} hosted MCP key secret reference is missing` }
        : {}),
    }
  } catch (error) {
    return {
      ok: false,
      mode: hasDelegatedAuth && hasStaticToken ? 'delegated+static' : hasDelegatedAuth ? 'delegated' : hasStaticToken ? 'static' : 'anonymous',
      protected: hasStaticToken || hasDelegatedAuth,
      required_scope: requiredScope,
      hosted_key_count: 0,
      missing_hosted_secret_count: 0,
      endpoint_keys: [],
      delegated_enabled: hasDelegatedAuth,
      error: error instanceof Error ? error.message : 'Invalid MCP auth configuration.',
    }
  }
}

function hasScope(scopes: string[], requiredScope: string): boolean {
  return scopes.includes('*') || scopes.includes('mcp:*') || scopes.includes(requiredScope)
}

function buildAuthContext(params: {
  mode: McpAuthMode
  principalId: string
  endpoint: PortalEndpoint
  scopes: string[]
  credentialPolicy: string
  tenantId?: string
  keyId?: string
  audience?: string
  expiresAt?: string
  delegatedCredentialRef?: string
}): McpAuthContext {
  return {
    mode: params.mode,
    principal_id: params.principalId,
    ...(params.tenantId
      ? {
          tenant_id: params.tenantId,
          tenant_key: hashString53(params.tenantId).toString(36),
        }
      : {}),
    ...(params.audience ? { audience: params.audience } : {}),
    endpoint: params.endpoint,
    endpoint_key: portalEndpointKey(params.endpoint),
    scopes: params.scopes,
    credential_policy: params.credentialPolicy,
    ...(params.expiresAt ? { expires_at: params.expiresAt } : {}),
    ...(params.keyId ? { key_id: params.keyId } : {}),
    ...(params.delegatedCredentialRef ? { delegated_credential_ref: params.delegatedCredentialRef } : {}),
  }
}

function unauthorized(): McpAuthResult {
  return {
    ok: false,
    status: 401,
    code: -32001,
    message: 'Unauthorized.',
    headers: { 'WWW-Authenticate': 'Bearer realm="mcp"' },
  }
}

function matchesHostedKeyToken(token: string, hostedKey: HostedMcpKey, env: NodeJS.ProcessEnv): 'match' | 'missing-secret' | 'miss' {
  if (hostedKey.tokenSha256 && safeEqual(sha256Hex(token), hostedKey.tokenSha256)) {
    return 'match'
  }

  if (hostedKey.tokenEnv) {
    const expectedToken = readEnv(env, hostedKey.tokenEnv)
    if (!expectedToken) return 'missing-secret'
    if (safeEqual(token, expectedToken)) return 'match'
  }

  return 'miss'
}

function isExpired(expiresAt: string | undefined): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now())
}

function anonymousContext(endpoint: PortalEndpoint): McpAuthResult {
  return {
    ok: true,
    context: buildAuthContext({
      mode: 'anonymous',
      principalId: 'anonymous',
      endpoint,
      scopes: ['*'],
      credentialPolicy: 'public_default',
    }),
  }
}

export function authenticateMcpBearerToken(
  token: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  endpointOverride?: PortalEndpoint,
): McpAuthResult {
  const requiredScope = readEnv(env, 'MCP_REQUIRED_SCOPE') ?? DEFAULT_REQUIRED_SCOPE
  const staticToken = readEnv(env, 'MCP_HTTP_BEARER_TOKEN')
  const endpoint = endpointOverride ?? getDefaultPortalEndpoint(env)
  const delegatedAuthEnabled = isDelegatedMcpAuthEnabled(env)

  const delegatedSession = authenticateDelegatedMcpSessionToken(token, env, endpointOverride)
  if (delegatedSession) {
    return {
      ok: true,
      context: buildAuthContext({
        mode: 'delegated',
        principalId: delegatedSession.principalId,
        tenantId: delegatedSession.tenantId,
        endpoint: delegatedSession.endpoint,
        scopes: ['mcp:invoke'],
        credentialPolicy: 'delegated_portal_api_key',
        expiresAt: delegatedSession.expiresAt,
        delegatedCredentialRef: delegatedSession.credentialRef,
      }),
    }
  }

  if (staticToken) {
    if (!token) return unauthorized()
    if (safeEqual(token, staticToken)) {
      return {
        ok: true,
        context: buildAuthContext({
          mode: 'static',
          principalId: 'self-hosted',
          endpoint,
          scopes: ['*'],
          credentialPolicy: 'server_default',
        }),
      }
    }
  }

  let hostedKeys: HostedMcpKey[]
  try {
    hostedKeys = parseHostedKeys(env)
  } catch (error) {
    return {
      ok: false,
      status: 500,
      code: -32603,
      message: error instanceof Error ? error.message : 'Invalid MCP auth configuration.',
    }
  }

  if (endpoint.endpointClass === 'public' && !staticToken && hostedKeys.length === 0 && !token) {
    return anonymousContext(endpoint)
  }

  if (hostedKeys.length === 0) {
    if (staticToken || (delegatedAuthEnabled && (endpoint.endpointClass !== 'public' || Boolean(token)))) {
      return unauthorized()
    }
    return anonymousContext(endpoint)
  }

  if (!token) return unauthorized()

  for (const hostedKey of hostedKeys) {
    const tokenMatch = matchesHostedKeyToken(token, hostedKey, env)
    if (tokenMatch === 'missing-secret') {
      return {
        ok: false,
        status: 500,
        code: -32603,
        message: 'Invalid MCP auth configuration.',
      }
    }

    if (tokenMatch === 'miss') continue
    if (hostedKey.status !== 'active' || isExpired(hostedKey.expiresAt)) return unauthorized()
    if (endpointOverride && portalEndpointKey(hostedKey.endpoint) !== portalEndpointKey(endpointOverride)) {
      return unauthorized()
    }

    if (!hasScope(hostedKey.scopes, requiredScope)) {
      return {
        ok: false,
        status: 403,
        code: -32003,
        message: 'Insufficient scope for MCP request.',
      }
    }

    return {
      ok: true,
      context: buildAuthContext({
        mode: 'hosted',
        principalId: hostedKey.principalId,
        tenantId: hostedKey.tenantId,
        audience: hostedKey.audience,
        endpoint: hostedKey.endpoint,
        scopes: hostedKey.scopes,
        credentialPolicy: hostedKey.credentialPolicy,
        expiresAt: hostedKey.expiresAt,
        keyId: hostedKey.id,
      }),
    }
  }

  return unauthorized()
}
