import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { buildPortalUrl, type PortalEndpoint, getPortalEndpointById, portalEndpointKey } from '../portal/endpoints.js'

export interface DelegatedSessionIssueResult {
  token: string
  expires_at: string
  endpoint_id: string
  principal_id: string
}

export interface DelegatedSessionAuthResult {
  credentialRef: string
  endpoint: PortalEndpoint
  principalId: string
  tenantId?: string
  expiresAt: string
}

interface StoredDelegatedSession {
  credentialRef: string
  tokenHash: string
  endpointId: string
  endpointKey: string
  principalId: string
  tenantId?: string
  apiKey: string
  expiresAtMs: number
}

interface ActiveDelegatedCredential {
  credentialRef: string
  endpointKey: string
  apiKey: string
  expiresAtMs: number
}

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const DEFAULT_VALIDATE_TIMEOUT_MS = 5000
const delegatedSessionsByTokenHash = new Map<string, StoredDelegatedSession>()
const delegatedSessionsByCredentialRef = new Map<string, StoredDelegatedSession>()
const activeDelegatedCredential = new AsyncLocalStorage<ActiveDelegatedCredential>()

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback = false): boolean {
  const value = readEnv(env, key)
  if (!value) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function readPositiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = Number(readEnv(env, key))
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function createSessionToken(): string {
  return `mcp_${randomBytes(32).toString('base64url')}`
}

function createCredentialRef(): string {
  return `cred_${randomBytes(18).toString('base64url')}`
}

function isExpired(session: StoredDelegatedSession): boolean {
  return session.expiresAtMs <= Date.now()
}

function removeSession(session: StoredDelegatedSession) {
  delegatedSessionsByTokenHash.delete(session.tokenHash)
  delegatedSessionsByCredentialRef.delete(session.credentialRef)
}

function pruneExpiredSessions() {
  for (const session of delegatedSessionsByTokenHash.values()) {
    if (isExpired(session)) removeSession(session)
  }
}

export function isDelegatedMcpAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readBool(env, 'MCP_DELEGATED_AUTH') || readEnv(env, 'MCP_AUTH_MODE') === 'portal_api_key_bootstrap'
}

export function isDelegatedPortalEndpoint(endpoint: PortalEndpoint): boolean {
  return endpoint.auth.mode === 'delegated_api_key'
}

export async function validateDelegatedPortalApiKey(
  endpoint: PortalEndpoint,
  apiKey: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!isDelegatedPortalEndpoint(endpoint)) {
    return { ok: false, status: 400, message: 'This endpoint does not accept delegated Portal API keys.' }
  }

  if (!apiKey.trim()) {
    return { ok: false, status: 400, message: 'Portal API key is required.' }
  }

  if (!readBool(env, 'MCP_DELEGATED_AUTH_VALIDATE', true)) {
    return { ok: true }
  }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    readPositiveInteger(env, 'MCP_DELEGATED_AUTH_VALIDATE_TIMEOUT_MS', DEFAULT_VALIDATE_TIMEOUT_MS),
  )

  try {
    const statusPath = readEnv(env, 'MCP_DELEGATED_AUTH_STATUS_PATH') ?? '/status'
    const response = await fetch(buildPortalUrl(statusPath, endpoint), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        [endpoint.auth.headerName ?? 'X-API-Key']: apiKey,
      },
      signal: controller.signal,
    })

    if (response.ok) return { ok: true }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, message: 'Portal rejected the API key.' }
    }

    return { ok: false, status: response.status, message: `Portal status check returned HTTP ${response.status}.` }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Portal status check timed out.'
      : 'Portal status check failed.'
    return { ok: false, status: 502, message }
  } finally {
    clearTimeout(timeout)
  }
}

export function issueDelegatedMcpSession(params: {
  endpoint: PortalEndpoint
  apiKey: string
  env?: NodeJS.ProcessEnv
  principalId?: string
  tenantId?: string
}): DelegatedSessionIssueResult {
  const env = params.env ?? process.env
  const token = createSessionToken()
  const tokenHash = sha256Hex(token)
  const credentialRef = createCredentialRef()
  const ttlSeconds = readPositiveInteger(env, 'MCP_DELEGATED_SESSION_TTL_SECONDS', DEFAULT_SESSION_TTL_SECONDS)
  const expiresAtMs = Date.now() + ttlSeconds * 1000
  const principalId = params.principalId ?? 'delegated-portal-api-key'
  const session: StoredDelegatedSession = {
    credentialRef,
    tokenHash,
    endpointId: params.endpoint.id,
    endpointKey: portalEndpointKey(params.endpoint),
    principalId,
    ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    apiKey: params.apiKey,
    expiresAtMs,
  }

  pruneExpiredSessions()
  delegatedSessionsByTokenHash.set(tokenHash, session)
  delegatedSessionsByCredentialRef.set(credentialRef, session)

  return {
    token,
    expires_at: new Date(expiresAtMs).toISOString(),
    endpoint_id: params.endpoint.id,
    principal_id: principalId,
  }
}

export function authenticateDelegatedMcpSessionToken(
  token: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  endpointOverride?: PortalEndpoint,
): DelegatedSessionAuthResult | undefined {
  if (!token || !isDelegatedMcpAuthEnabled(env)) return undefined

  pruneExpiredSessions()
  const tokenHash = sha256Hex(token)
  const session = Array.from(delegatedSessionsByTokenHash.values()).find((candidate) =>
    safeEqual(candidate.tokenHash, tokenHash),
  )
  if (!session || isExpired(session)) {
    if (session) removeSession(session)
    return undefined
  }

  const endpoint = getPortalEndpointById(session.endpointId, env)
  if (!endpoint || portalEndpointKey(endpoint) !== session.endpointKey) return undefined
  if (endpointOverride && portalEndpointKey(endpointOverride) !== session.endpointKey) {
    return undefined
  }

  return {
    credentialRef: session.credentialRef,
    endpoint,
    principalId: session.principalId,
    ...(session.tenantId ? { tenantId: session.tenantId } : {}),
    expiresAt: new Date(session.expiresAtMs).toISOString(),
  }
}

export function runWithDelegatedPortalCredential<T>(
  credentialRef: string | undefined,
  endpoint: PortalEndpoint,
  callback: () => T,
): T {
  if (!credentialRef) return callback()

  pruneExpiredSessions()
  const session = delegatedSessionsByCredentialRef.get(credentialRef)
  if (!session || isExpired(session) || session.endpointKey !== portalEndpointKey(endpoint)) {
    throw new Error('Delegated Portal credential is not available for this endpoint.')
  }

  return activeDelegatedCredential.run({
    credentialRef: session.credentialRef,
    endpointKey: session.endpointKey,
    apiKey: session.apiKey,
    expiresAtMs: session.expiresAtMs,
  }, callback)
}

export function getActiveDelegatedPortalApiKey(endpoint: PortalEndpoint): string | undefined {
  const credential = activeDelegatedCredential.getStore()
  if (!credential || credential.expiresAtMs <= Date.now()) return undefined
  if (credential.endpointKey !== portalEndpointKey(endpoint)) return undefined
  return credential.apiKey
}

export function getActiveDelegatedCredentialCacheScope(endpoint: PortalEndpoint): string | undefined {
  const credential = activeDelegatedCredential.getStore()
  if (!credential || credential.expiresAtMs <= Date.now()) return undefined
  if (credential.endpointKey !== portalEndpointKey(endpoint)) return undefined
  return `delegated:${sha256Hex(credential.credentialRef).slice(0, 16)}`
}

export function revokeDelegatedMcpSessionToken(token: string | undefined): boolean {
  if (!token) return false
  const session = delegatedSessionsByTokenHash.get(sha256Hex(token))
  if (!session) return false
  removeSession(session)
  return true
}
