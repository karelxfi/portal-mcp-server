import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import {
  type PortalEndpoint,
  getPortalEndpointById,
  portalEndpointKey,
} from '../portal/endpoints.js'

export const MCP_OAUTH_SCOPE = 'mcp:invoke'

export interface OAuthClientRegistration {
  client_id: string
  client_id_issued_at: number
  redirect_uris: string[]
  grant_types: ['authorization_code']
  response_types: ['code']
  token_endpoint_auth_method: 'none'
  scope: string
  client_name?: string
}

export interface OAuthTokenExchangeResult {
  endpoint: PortalEndpoint
  apiKey: string
  tenantId?: string
  resource?: string
  scope: string
}

interface StoredOAuthClient extends OAuthClientRegistration {
  createdAtMs: number
}

interface StoredAuthorizationCode {
  codeHash: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  endpointId: string
  endpointKey: string
  apiKey: string
  scope: string
  expiresAtMs: number
  tenantId?: string
  resource?: string
}

const DEFAULT_AUTH_CODE_TTL_SECONDS = 5 * 60
const registeredClients = new Map<string, StoredOAuthClient>()
const authorizationCodes = new Map<string, StoredAuthorizationCode>()

function readPositiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = Number(env[key])
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function sha256Bytes(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function readString(value: unknown, field: string, fallback?: string): string {
  if (typeof value === 'undefined' || value === null || value === '') {
    if (typeof fallback === 'string') return fallback
    throw new Error(`${field} is required`)
  }
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const trimmed = value.trim()
  if (!trimmed) {
    if (typeof fallback === 'string') return fallback
    throw new Error(`${field} is required`)
  }
  return trimmed
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${field} must be a string array`)
  }
  return value.map((entry) => entry.trim()).filter(Boolean)
}

function normalizeRedirectUri(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('redirect_uris entries must be absolute URLs')
  }

  if (url.hash) throw new Error('redirect_uris entries must not contain fragments')
  if (url.username || url.password) throw new Error('redirect_uris entries must not contain credentials')

  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname.endsWith('.localhost')
  const isAllowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback)
  if (!isAllowedProtocol) {
    throw new Error('redirect_uris entries must be HTTPS, except loopback HTTP callbacks')
  }

  return url.toString()
}

function pruneExpiredAuthorizationCodes() {
  const now = Date.now()
  for (const [codeHash, code] of authorizationCodes.entries()) {
    if (code.expiresAtMs <= now) authorizationCodes.delete(codeHash)
  }
}

export function registerOAuthClient(metadata: Record<string, unknown>): OAuthClientRegistration {
  if (
    typeof metadata.client_secret !== 'undefined' ||
    typeof metadata.client_secret_expires_at !== 'undefined' ||
    typeof metadata.token_endpoint_auth_method === 'string' && metadata.token_endpoint_auth_method !== 'none'
  ) {
    throw new Error('Only public OAuth clients with token_endpoint_auth_method "none" are supported')
  }

  const redirectUris = readStringArray(metadata.redirect_uris ?? metadata.redirectUris, 'redirect_uris')
    .map(normalizeRedirectUri)
  if (redirectUris.length === 0) throw new Error('redirect_uris must not be empty')

  const grantTypes = metadata.grant_types ?? ['authorization_code']
  if (Array.isArray(grantTypes) && grantTypes.some((grant) => grant !== 'authorization_code')) {
    throw new Error('Only the authorization_code grant type is supported')
  }

  const responseTypes = metadata.response_types ?? ['code']
  if (Array.isArray(responseTypes) && responseTypes.some((responseType) => responseType !== 'code')) {
    throw new Error('Only the code response type is supported')
  }

  const clientId = `mcp_client_${randomBytes(18).toString('base64url')}`
  const nowSeconds = Math.floor(Date.now() / 1000)
  const clientName =
    typeof metadata.client_name === 'string' && metadata.client_name.trim()
      ? metadata.client_name.trim()
      : undefined

  const registration: StoredOAuthClient = {
    client_id: clientId,
    client_id_issued_at: nowSeconds,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: MCP_OAUTH_SCOPE,
    ...(clientName ? { client_name: clientName } : {}),
    createdAtMs: Date.now(),
  }
  registeredClients.set(clientId, registration)

  const { createdAtMs: _createdAtMs, ...publicRegistration } = registration
  return publicRegistration
}

export function getOAuthClient(clientId: string | undefined): OAuthClientRegistration | undefined {
  if (!clientId) return undefined
  const client = registeredClients.get(clientId)
  if (!client) return undefined
  const { createdAtMs: _createdAtMs, ...publicClient } = client
  return publicClient
}

export function isOAuthRedirectUriAllowed(clientId: string, redirectUri: string): boolean {
  const client = registeredClients.get(clientId)
  if (!client) return false
  return client.redirect_uris.includes(normalizeRedirectUri(redirectUri))
}

export function issueOAuthAuthorizationCode(params: {
  clientId: string
  redirectUri: string
  codeChallenge: string
  endpoint: PortalEndpoint
  apiKey: string
  env?: NodeJS.ProcessEnv
  scope?: string
  resource?: string
  tenantId?: string
}): string {
  if (!registeredClients.has(params.clientId)) throw new Error('Unknown OAuth client')
  if (!isOAuthRedirectUriAllowed(params.clientId, params.redirectUri)) {
    throw new Error('redirect_uri is not registered for this OAuth client')
  }
  if (!params.codeChallenge.trim()) throw new Error('code_challenge is required')

  pruneExpiredAuthorizationCodes()
  const env = params.env ?? process.env
  const ttlSeconds = readPositiveInteger(env, 'MCP_OAUTH_CODE_TTL_SECONDS', DEFAULT_AUTH_CODE_TTL_SECONDS)
  const code = `oauth_code_${randomBytes(32).toString('base64url')}`
  const codeHash = sha256Hex(code)

  authorizationCodes.set(codeHash, {
    codeHash,
    clientId: params.clientId,
    redirectUri: normalizeRedirectUri(params.redirectUri),
    codeChallenge: params.codeChallenge,
    endpointId: params.endpoint.id,
    endpointKey: portalEndpointKey(params.endpoint),
    apiKey: params.apiKey,
    scope: params.scope ?? MCP_OAUTH_SCOPE,
    expiresAtMs: Date.now() + ttlSeconds * 1000,
    ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    ...(params.resource ? { resource: params.resource } : {}),
  })

  return code
}

export function exchangeOAuthAuthorizationCode(params: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
  env?: NodeJS.ProcessEnv
  resource?: string
}): OAuthTokenExchangeResult {
  pruneExpiredAuthorizationCodes()
  const codeHash = sha256Hex(params.code)
  const code = authorizationCodes.get(codeHash)
  if (!code) throw new Error('Invalid or expired authorization code')
  authorizationCodes.delete(codeHash)

  if (code.expiresAtMs <= Date.now()) throw new Error('Invalid or expired authorization code')
  if (!safeEqual(code.clientId, params.clientId)) throw new Error('client_id does not match authorization code')
  if (!safeEqual(code.redirectUri, normalizeRedirectUri(params.redirectUri))) {
    throw new Error('redirect_uri does not match authorization code')
  }

  const expectedChallenge = base64Url(sha256Bytes(params.codeVerifier))
  if (!safeEqual(expectedChallenge, code.codeChallenge)) {
    throw new Error('code_verifier failed PKCE validation')
  }

  if (code.resource && !params.resource) {
    throw new Error('resource is required for this authorization code')
  }

  if (code.resource && params.resource && !safeEqual(code.resource, params.resource)) {
    throw new Error('resource does not match authorization request')
  }

  const endpoint = getPortalEndpointById(code.endpointId, params.env ?? process.env)
  if (!endpoint || portalEndpointKey(endpoint) !== code.endpointKey) {
    throw new Error('Portal endpoint for authorization code is no longer configured')
  }

  return {
    endpoint,
    apiKey: code.apiKey,
    ...(code.tenantId ? { tenantId: code.tenantId } : {}),
    ...(code.resource ? { resource: code.resource } : {}),
    scope: code.scope,
  }
}
