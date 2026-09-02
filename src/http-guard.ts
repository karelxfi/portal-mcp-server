// ============================================================================
// HTTP request guard: Host and Origin allowlists, bind policy, body limits
// ============================================================================
//
// Pure functions so the policy is unit-testable without opening a socket.
// `src/http.ts` applies them to every route before any handler runs.

import { createHash } from 'node:crypto'

const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '[::]']

export type AllowlistDecision =
  | { allowed: true }
  | { allowed: false; reason: 'host_not_allowed' | 'origin_not_allowed' }

export interface RequestGuardPolicy {
  /** Hostnames accepted in the `Host` header; `'*'` disables the check. Loopback names are always accepted. */
  allowedHosts: string[]
  /** Hostnames accepted in the `Origin` header; `'*'` disables the check. Requests without `Origin` pass. */
  allowedOrigins: string[]
  /** Interface the server binds to. */
  bind: string
  /** Startup problems worth a log line, in the order they were found. */
  warnings: string[]
}

export function isLoopbackBind(bind: string): boolean {
  const value = bind.trim().toLowerCase()
  return value === '' || value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]'
}

export function parseHostList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

/** The hostname part of a `Host` header, without the port, lower-cased. IPv6 keeps its brackets. */
export function hostnameFromHostHeader(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined
  const value = hostHeader.trim().toLowerCase()
  if (!value) return undefined
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? undefined : value.slice(0, end + 1)
  }
  const colon = value.indexOf(':')
  const host = colon === -1 ? value : value.slice(0, colon)
  return host.length > 0 && /^[a-z0-9.-]+$/.test(host) ? host : undefined
}

/** The hostname of an `Origin` header URL, lower-cased. `null` (opaque origin) and malformed values return undefined. */
export function hostnameFromOriginHeader(originHeader: string | undefined): string | undefined {
  if (!originHeader) return undefined
  const value = originHeader.trim()
  if (!value || value === 'null') return undefined
  try {
    return new URL(value).hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

function matchesAllowlist(hostname: string, allowlist: string[]): boolean {
  if (allowlist.includes('*')) return true
  if (LOOPBACK_HOSTNAMES.includes(hostname)) return true
  return allowlist.includes(hostname)
}

/**
 * Decide whether a request may reach any route.
 *
 * - The `Host` header must name a loopback address or an allowlisted hostname (port ignored).
 * - An `Origin` header, when present, must do the same. Non-browser MCP clients send none and pass.
 * - `'*'` in a list switches that check off for deployments behind a trusted proxy.
 */
export function evaluateRequestGuard(
  headers: { host?: string; origin?: string },
  policy: Pick<RequestGuardPolicy, 'allowedHosts' | 'allowedOrigins'>,
): AllowlistDecision {
  if (!policy.allowedHosts.includes('*')) {
    const host = hostnameFromHostHeader(headers.host)
    if (!host || !matchesAllowlist(host, policy.allowedHosts)) {
      return { allowed: false, reason: 'host_not_allowed' }
    }
  }
  if (headers.origin !== undefined && !policy.allowedOrigins.includes('*')) {
    const origin = hostnameFromOriginHeader(headers.origin)
    if (!origin || !matchesAllowlist(origin, policy.allowedOrigins)) {
      return { allowed: false, reason: 'origin_not_allowed' }
    }
  }
  return { allowed: true }
}

/**
 * Build the guard policy from the environment.
 *
 * Loopback binds work with no configuration: only loopback hosts and origins are accepted.
 * A non-loopback bind needs explicit `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS`. When either is
 * missing the check for that header is switched off and a startup error is recorded, so an existing
 * deployment keeps serving while the operator adds the list. `'*'` is the deliberate opt-out.
 */
export function resolveRequestGuardPolicy(env: {
  MCP_BIND?: string | undefined
  MCP_ALLOWED_HOSTS?: string | undefined
  MCP_ALLOWED_ORIGINS?: string | undefined
  // Index signature so NodeJS.ProcessEnv is assignable here. Without it an
  // all-optional shape trips TypeScript's weak type check against ProcessEnv on
  // some @types/node versions, which broke the Docker build while CI was green.
  [key: string]: string | undefined
}): RequestGuardPolicy {
  const bind = env.MCP_BIND?.trim() || '127.0.0.1'
  const loopback = isLoopbackBind(bind)
  const warnings: string[] = []
  let allowedHosts = parseHostList(env.MCP_ALLOWED_HOSTS)
  let allowedOrigins = parseHostList(env.MCP_ALLOWED_ORIGINS)

  if (!loopback) {
    if (allowedHosts.length === 0) {
      warnings.push(
        `MCP_BIND=${bind} exposes the server beyond loopback but MCP_ALLOWED_HOSTS is not set; Host header validation is off. Set the public hostnames, or '*' behind a trusted proxy.`,
      )
      allowedHosts = ['*']
    }
    if (allowedOrigins.length === 0) {
      warnings.push(
        `MCP_BIND=${bind} exposes the server beyond loopback but MCP_ALLOWED_ORIGINS is not set; Origin header validation is off. Set the browser origins that may call this server, or '*' behind a trusted proxy.`,
      )
      allowedOrigins = ['*']
    }
  }

  return { allowedHosts, allowedOrigins, bind, warnings }
}

export type BodyLimitDecision =
  | { ok: true }
  | { ok: false; status: 411 | 413; reason: 'length_required' | 'body_too_large'; declared?: number }

/**
 * Enforce the request body cap from the declared `Content-Length` before any byte is parsed.
 * A body without a length (chunked upload) cannot be bounded up front and is refused with 411.
 */
export function evaluateBodyLimit(
  headers: { 'content-length'?: string; 'transfer-encoding'?: string },
  method: string | undefined,
  maxBodyBytes: number,
): BodyLimitDecision {
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return { ok: true }
  const declared = headers['content-length']
  if (declared === undefined) {
    return headers['transfer-encoding'] ? { ok: false, status: 411, reason: 'length_required' } : { ok: true }
  }
  const length = Number(declared)
  if (!Number.isFinite(length) || length < 0) return { ok: false, status: 411, reason: 'length_required' }
  if (length > maxBodyBytes) return { ok: false, status: 413, reason: 'body_too_large', declared: length }
  return { ok: true }
}

/**
 * A stable, non-reversible key for the connection behind a request, used only
 * to give each caller a fair share of tool admission. With `trustProxy` the
 * first hop of `X-Forwarded-For` is used, otherwise the socket address. The
 * raw address is hashed and never stored, logged, or labelled.
 */
export function connectionKeyFromRequest(
  source: { remoteAddress?: string; forwardedFor?: string },
  trustProxy: boolean,
): string {
  const forwarded = trustProxy ? source.forwardedFor?.split(',')[0]?.trim() : undefined
  const address = (forwarded || source.remoteAddress || 'unknown').toLowerCase()
  return createHash('sha256').update(address).digest('hex').slice(0, 16)
}

export function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
