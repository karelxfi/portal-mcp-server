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
 * One address in a comparable form. `X-Forwarded-For` hops and socket
 * addresses are written many ways for the same host, and each spelling would
 * otherwise become its own admission key, splitting one caller into several:
 * `[::1]:443` and `::1`, `::ffff:203.0.113.9` and `203.0.113.9`, upper and
 * lower case hex. Anything that is not recognisably an address is returned
 * trimmed and lowercased, so an obfuscated or unknown identifier still keys
 * consistently.
 */
export function canonicalizeAddress(value: string): string {
  let address = value.trim().toLowerCase()
  if (address === '') return ''

  // `[2001:db8::1]:443` and `[2001:db8::1]`. An IPv6 address carrying a port
  // is always bracketed, which is what makes the unbracketed case below safe
  // to restrict to IPv4.
  const bracketed = address.match(/^\[([^\]]+)\](?::\d{1,5})?$/)
  if (bracketed) address = bracketed[1]
  // `203.0.113.9:443`. Only a dotted quad may shed a port. Testing for "one
  // colon" instead treated the IPv6 prefix `2606:4700` as host-and-port and
  // cut it to `2606`, so a configured trusted-proxy prefix silently widened
  // from a /32 to a /16 whenever its second hextet happened to be all digits.
  else {
    const withPort = address.match(/^((?:\d{1,3}\.){3}\d{1,3}):\d{1,5}$/)
    if (withPort) address = withPort[1]
  }

  // IPv4-mapped IPv6, the form Node reports for an IPv4 peer on a dual-stack
  // socket.
  const mapped = address.match(/^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/)
  if (mapped) address = mapped[1]

  return address
}

// Loopback, RFC1918, IPv4 link-local, IPv6 loopback, IPv6 unique-local
// (fc00::/7), and IPv6 link-local (fe80::/10). The IPv6 branches require a
// hextet, so a name rather than an address cannot satisfy them.
const PRIVATE_PEER =
  /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{0,2}:|fe[89ab][0-9a-f]{0,2}:)/

/**
 * Whether the immediate peer may speak for the client behind it. A proxy this
 * deployment runs reaches the server over loopback or a private network, so
 * that is the default; `MCP_TRUSTED_PROXY_PREFIXES` replaces it with an
 * explicit list of address prefixes when the proxy is somewhere else.
 */
export function isTrustedPeer(remoteAddress: string | undefined, prefixes: string[]): boolean {
  const address = canonicalizeAddress(remoteAddress ?? '')
  if (address === '') return false
  if (prefixes.length > 0) return prefixes.some((prefix) => address.startsWith(prefix))
  return PRIVATE_PEER.test(address)
}

/**
 * `MCP_TRUSTED_PROXY_PREFIXES`: comma-separated address prefixes, matched
 * against the start of a canonicalised peer address. A prefix is a fragment,
 * not an address, so it is only trimmed and lowercased here: running it
 * through the address rules would let a port-shaped tail be cut off it and
 * widen the operator's list without saying so.
 */
export function parseTrustedProxyPrefixes(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((prefix) => prefix.trim().toLowerCase())
    .filter((prefix) => prefix !== '')
}

/**
 * A stable, non-reversible key for the connection behind a request, used only
 * to give each caller a fair share of tool admission. The raw address is
 * hashed and never stored, logged, or labelled.
 *
 * `X-Forwarded-For` is read only when both conditions hold:
 *
 * 1. The immediate peer is a trusted proxy. Without this, a caller that can
 *    reach the origin directly writes its own header and takes a new identity,
 *    and a whole fresh share, on every request. `trustedProxies > 0` alone was
 *    never a trust boundary; the peer is.
 * 2. The header is at least as long as the trusted proxy chain. The hop is
 *    then counted from the right, so it is the address the outermost trusted
 *    proxy observed rather than anything the caller prepended.
 *
 * Otherwise the socket address is used.
 */
export function connectionKeyFromRequest(
  source: { remoteAddress?: string; forwardedFor?: string },
  trustedProxies: number,
  trustedProxyPrefixes: string[] = [],
): string {
  let forwarded: string | undefined
  if (trustedProxies > 0 && source.forwardedFor && isTrustedPeer(source.remoteAddress, trustedProxyPrefixes)) {
    const hops = source.forwardedFor
      .split(',')
      .map((hop) => canonicalizeAddress(hop))
      .filter((hop) => hop !== '')
    if (hops.length >= trustedProxies) forwarded = hops[hops.length - trustedProxies]
  }
  const address = forwarded || canonicalizeAddress(source.remoteAddress ?? '') || 'unknown'
  return createHash('sha256').update(address).digest('hex').slice(0, 16)
}

/** `MCP_TRUST_PROXY`: `1`/`true` for one proxy, or how many are in front. */
export function readTrustedProxyCount(raw: string | undefined): number {
  const value = raw?.trim().toLowerCase()
  if (!value || value === '0' || value === 'false') return 0
  if (value === 'true') return 1
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

export function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
