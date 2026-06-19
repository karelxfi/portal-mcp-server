import { randomUUID, timingSafeEqual } from 'node:crypto'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

import {
  isDelegatedMcpAuthEnabled,
  isDelegatedPortalEndpoint,
  issueDelegatedMcpSession,
  runWithDelegatedPortalCredential,
  validateDelegatedPortalApiKey,
} from './auth/delegated.js'
import { authenticateMcpBearerToken } from './auth/mcp.js'
import {
  MCP_OAUTH_SCOPE,
  exchangeOAuthAuthorizationCode,
  getOAuthClient,
  isOAuthRedirectUriAllowed,
  issueOAuthAuthorizationCode,
  registerOAuthClient,
} from './auth/oauth.js'
import { sanitizeText } from './helpers/errors.js'
import { PORTAL_MCP_SERVER_LABEL, PORTAL_PLUGIN_SELECTOR, getExecutionGuidance } from './helpers/execution-guidance.js'
import { type ToolGuideEntry, getToolGuideEntry } from './helpers/tool-ux.js'
import { clientRequestsTotal, register } from './metrics.js'
import { getObservabilityStatus } from './observability.js'
import {
  type PortalEndpoint,
  getDefaultPortalEndpoint,
  getPortalEndpointByHost,
  getSafePortalEndpointMetadata,
  portalEndpointKey,
  runWithPortalEndpoint,
} from './portal/endpoints.js'
import { getReadinessReport } from './readiness.js'
import { createPortalServer } from './server.js'
import { npmVersion } from './version.js'

// ----------------------------------------------------------------------------
// Tool catalog cache
//
// `GET /tools` exposes the same data the MCP `tools/list` JSON-RPC method
// returns, but as a plain HTTP endpoint a browser or curl can hit. Useful
// for changelog links and quick discoverability without an MCP client.
//
// The catalog is built once on first request and cached for the process
// lifetime — registration is deterministic, so there's no point rebuilding.
// ----------------------------------------------------------------------------

type ToolCatalogEntry = {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  guide?: ToolGuideEntry
}

type ToolCatalog = {
  entries: ToolCatalogEntry[]
  generatedAt: string
  groups: Record<string, string[]>
  endpoint: ReturnType<typeof getSafePortalEndpointMetadata>
}

const catalogCache = new Map<string, ToolCatalog>()

function groupToolCatalog(entries: ToolCatalogEntry[]) {
  return entries.reduce<Record<string, string[]>>((groups, entry) => {
    const category = entry.guide?.category ?? 'unknown'
    groups[category] ??= []
    groups[category].push(entry.name)
    return groups
  }, {})
}

function buildToolCatalog(endpoint: PortalEndpoint = getDefaultPortalEndpoint()): ToolCatalog {
  const cacheKey = portalEndpointKey(endpoint)
  const cached = catalogCache.get(cacheKey)
  if (cached) return cached

  // Spin up a throwaway server purely to walk its registered-tool table.
  // No transport is connected, so nothing actually runs.
  const probe = createPortalServer({ transport: 'http' })
  const registry = (probe as unknown as { _registeredTools: Record<string, any> })._registeredTools ?? {}

  const entries: ToolCatalogEntry[] = Object.entries(registry)
    .filter(([, tool]) => tool?.enabled !== false)
    .map(([name, tool]) => {
      const entry: ToolCatalogEntry = { name }
      if (typeof tool.title === 'string') entry.title = tool.title
      if (typeof tool.description === 'string') entry.description = tool.description
      const guide = getToolGuideEntry(name)
      if (guide) entry.guide = guide
      if (tool.inputSchema) {
        try {
          // tool.inputSchema is either a zod object or a plain props record
          // depending on which registration overload the tool used. Wrap
          // plain records in z.object() so zod-to-json-schema accepts them.
          const schema =
            tool.inputSchema instanceof z.ZodType
              ? tool.inputSchema
              : z.object(tool.inputSchema as Record<string, z.ZodTypeAny>)
          entry.inputSchema = zodToJsonSchema(schema, { target: 'jsonSchema7' })
        } catch {
          /* schema unrepresentable; skip */
        }
      }
      return entry
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const catalog = {
    entries,
    generatedAt: new Date().toISOString(),
    groups: groupToolCatalog(entries),
    endpoint: getSafePortalEndpointMetadata(endpoint),
  }
  catalogCache.set(cacheKey, catalog)

  // The probe server is unreferenced after this; let it be GC'd.
  return catalog
}

// ============================================================================
// SQD Portal MCP Server - Node.js HTTP Entry Point
// ============================================================================

const PORT = Number(process.env.PORT) || 3000
const METRICS_PUBLIC = process.env.METRICS_PUBLIC === 'true'
const METRICS_BEARER_TOKEN = process.env.METRICS_BEARER_TOKEN
const MCP_TRUST_FORWARDED_HOST = process.env.MCP_TRUST_FORWARDED_HOST === 'true'
const TELEMETRY_HEADER_MAX_LENGTH = 80

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  if (typeof value === 'string') return value
  return Array.isArray(value) ? value[0] : undefined
}

function normalizeHostHeaderValue(value: string | undefined): string | undefined {
  const firstValue = value?.split(',')[0]?.trim()
  if (!firstValue || /[\s/@?#]/.test(firstValue)) return undefined

  try {
    const parsed = new URL(`http://${firstValue}`)
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || !parsed.hostname) {
      return undefined
    }
    return parsed.host.toLowerCase()
  } catch {
    return undefined
  }
}

function readSafeTelemetryHeader(value: string | undefined, fallback: string): string {
  const sanitized = sanitizeText(value ?? '').trim()
  if (!sanitized) return fallback

  const tokenLike = /^[A-Za-z0-9._~+/\-=]{32,}$/.test(sanitized) || /[A-Za-z0-9._~+/\-=]{48,}/.test(sanitized)
  const bounded = tokenLike ? 'redacted' : sanitized
  const normalized = bounded
    .replace(/[^A-Za-z0-9 ._:@/+-]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TELEMETRY_HEADER_MAX_LENGTH)

  return normalized || fallback
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function readBearerToken(req: IncomingMessage): string | undefined {
  const authorization = readHeader(req, 'authorization')
  if (!authorization) return undefined
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

async function readRequestBody(req: IncomingMessage, maxBytes = 16 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) {
      throw new Error('Request body too large')
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function readRequestHost(req: IncomingMessage): string | undefined {
  if (MCP_TRUST_FORWARDED_HOST) {
    const forwardedHost = normalizeHostHeaderValue(readHeader(req, 'x-forwarded-host'))
    if (forwardedHost) return forwardedHost
  }
  return normalizeHostHeaderValue(readHeader(req, 'host'))
}

function readForwardedProto(req: IncomingMessage): string | undefined {
  if (!MCP_TRUST_FORWARDED_HOST) return undefined
  const forwardedProto = readHeader(req, 'x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  return forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : undefined
}

function readHostnameFromHost(host: string): string {
  const normalized = normalizeHostHeaderValue(host)
  try {
    return new URL(`http://${normalized ?? host}`).hostname.toLowerCase()
  } catch {
    return host.split(':')[0]?.toLowerCase() ?? host.toLowerCase()
  }
}

function isLocalHost(host: string): boolean {
  const hostname = readHostnameFromHost(host)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost')
}

function getPublicOrigin(req: IncomingMessage): string {
  const configuredOrigin = process.env.MCP_PUBLIC_ORIGIN?.trim()
  if (configuredOrigin) {
    const origin = new URL(configuredOrigin)
    return origin.origin
  }

  const host = readRequestHost(req) || `localhost:${PORT}`
  const protocol = readForwardedProto(req) ?? (isLocalHost(host) ? 'http' : 'https')
  return `${protocol}://${host}`
}

function getMcpResourceUri(req: IncomingMessage): string {
  return `${getPublicOrigin(req)}/mcp`
}

function getOAuthIssuer(req: IncomingMessage): string {
  return getPublicOrigin(req)
}

function getProtectedResourceMetadataUri(req: IncomingMessage): string {
  return `${getPublicOrigin(req)}/.well-known/oauth-protected-resource`
}

function writeJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(JSON.stringify(body))
}

function writeOAuthCorsHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
}

type ResolvedEndpoint = {
  endpoint: PortalEndpoint
  matchedHost: boolean
  host?: string
  unknownNonLocalHost: boolean
}

function resolveEndpointFromHost(host: string | undefined): ResolvedEndpoint {
  const endpoint = getPortalEndpointByHost(host)
  if (endpoint) {
    return { endpoint, matchedHost: true, host, unknownNonLocalHost: false }
  }

  return {
    endpoint: getDefaultPortalEndpoint(),
    matchedHost: false,
    ...(host ? { host } : {}),
    unknownNonLocalHost: Boolean(host && !isLocalHost(host)),
  }
}

function resolveRequestEndpoint(req: IncomingMessage): ResolvedEndpoint {
  return resolveEndpointFromHost(readRequestHost(req))
}

function resolveAuthEndpoint(req: IncomingMessage): ResolvedEndpoint {
  return resolveRequestEndpoint(req)
}

function resolveOAuthEndpoint(req: IncomingMessage): ResolvedEndpoint {
  return resolveAuthEndpoint(req)
}

function rejectUnknownMcpHost(res: ServerResponse, req: IncomingMessage) {
  res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(JSON.stringify({ error: 'Unknown MCP host.' }))
}

function validateKnownMcpHost(resolution: ResolvedEndpoint, res: ServerResponse, req: IncomingMessage): boolean {
  if (!resolution.unknownNonLocalHost) return true
  rejectUnknownMcpHost(res, req)
  return false
}

function validateOAuthResource(fields: Record<string, string>, endpoint: PortalEndpoint): string | undefined {
  if (!fields.resource) return undefined

  let resourceUrl: URL
  try {
    resourceUrl = new URL(fields.resource)
  } catch {
    return 'OAuth resource must be an absolute URL.'
  }

  if (resourceUrl.username || resourceUrl.password) return 'OAuth resource must not contain credentials.'
  if (resourceUrl.search || resourceUrl.hash) return 'OAuth resource must not contain query strings or fragments.'
  if (resourceUrl.pathname !== '/mcp') return 'OAuth resource must be the Portal MCP endpoint.'

  const isAllowedProtocol = resourceUrl.protocol === 'https:' || (resourceUrl.protocol === 'http:' && isLocalHost(resourceUrl.host))
  if (!isAllowedProtocol) return 'OAuth resource must use HTTPS, except local testing hosts.'

  const resourceEndpoint = getPortalEndpointByHost(resourceUrl.host)
  if (!resourceEndpoint || portalEndpointKey(resourceEndpoint) !== portalEndpointKey(endpoint)) {
    return 'OAuth resource must match this Portal MCP endpoint.'
  }

  return undefined
}

async function readRequestFields(req: IncomingMessage, maxBytes = 32 * 1024): Promise<Record<string, string>> {
  const contentType = readHeader(req, 'content-type') ?? ''
  const bodyText = await readRequestBody(req, maxBytes)
  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [key, value as string]),
    )
  }
  return Object.fromEntries(new URLSearchParams(bodyText))
}

async function readJsonObject(req: IncomingMessage, maxBytes = 32 * 1024): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readRequestBody(req, maxBytes)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function readUrlFields(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams)
}

function appendHiddenInput(name: string, value: string | undefined): string {
  if (!value) return ''
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
}

function authPageHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  }
}

function endpointPortalHost(endpoint: PortalEndpoint, host?: string): string {
  if (host) return readHostnameFromHost(host)
  return new URL(endpoint.baseUrl).hostname
}

function redirectOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

function sqdSymbolSvg(): string {
  return `<svg class="sqd-symbol" aria-hidden="true" viewBox="0 0 305 305" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M207.407 125.699C179.833 125.699 166.252 135.487 151.875 145.844C136.49 156.924 120.565 168.389 88.8708 168.389C84.268 168.389 79.9919 168.133 76.0142 167.693V229.007H228.021V127.901C222.068 126.509 215.306 125.699 207.407 125.699Z" fill="currentColor"/>
          <path d="M88.7856 120.514C84.4527 120.514 80.1908 120.201 76 119.647V154.807C79.9351 155.319 84.197 155.603 88.8566 155.603C116.431 155.603 130.012 145.815 144.389 135.459C159.774 124.378 175.699 112.913 207.393 112.913C215.136 112.913 221.926 113.595 228.006 114.803V77H169.647C152.259 103.196 122.511 120.514 88.7856 120.514Z" fill="currentColor"/>
          <path d="M76 106.762C80.1766 107.401 84.4385 107.728 88.7856 107.728C114.925 107.728 138.323 95.7522 153.779 77H76V106.748V106.762Z" fill="currentColor"/>
        </svg>`
}

function authPageStyles(): string {
  return `
      :root {
        color-scheme: light;
        --bg: #f5f6f8;
        --surface: #ffffff;
        --ink: #09090b;
        --muted: #52525b;
        --subtle: #71717a;
        --line: #e5e7eb;
        --line-strong: #d4d4d8;
        --accent: #6366f1;
        --accent-strong: #4f46e5;
        --accent-soft: rgb(99 102 241 / 12%);
        --good: #1e8e3e;
        --bad: #ef4444;
        --bad-bg: #fef2f2;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--ink);
        background: var(--bg);
      }
      main {
        width: min(100%, 520px);
        min-height: 100vh;
        margin: 0 auto;
        padding: 28px 18px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .brand {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 22px;
        font-size: 13px;
        font-weight: 650;
        letter-spacing: 0;
      }
      .brand-main {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .mark {
        width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--ink);
      }
      .sqd-symbol {
        width: 24px;
        height: 24px;
        display: block;
      }
      .brand-lockup {
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
      }
      .brand-name {
        font-weight: 560;
        letter-spacing: -0.01em;
      }
      .brand-label {
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        color: var(--subtle);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .eyebrow {
        margin: 0 0 6px;
        color: var(--subtle);
        font-size: 12px;
        font-weight: 600;
      }
      h1 {
        margin: 0;
        font-size: 22px;
        line-height: 1.2;
        letter-spacing: 0;
      }
      .lede {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
      }
      .panel {
        width: 100%;
        padding: 24px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 6px;
      }
      .panel-header {
        padding-bottom: 18px;
        border-bottom: 1px solid var(--line);
      }
      .panel-kicker {
        margin: 0 0 6px;
        color: var(--subtle);
        font-size: 12px;
        font-weight: 600;
      }
      .endpoint-name {
        margin: 0;
        font-size: 20px;
        line-height: 1.2;
        letter-spacing: 0;
      }
      .summary {
        display: grid;
        gap: 10px;
        margin: 18px 0;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fafafa;
      }
      .summary-row {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 10px;
        min-width: 0;
      }
      .summary-label {
        color: var(--subtle);
        font-size: 12px;
      }
      .summary-value {
        min-width: 0;
        overflow-wrap: anywhere;
        color: var(--ink);
        font-size: 13px;
        font-weight: 550;
      }
      form { margin-top: 18px; }
      label {
        display: block;
        margin: 0 0 8px;
        font-size: 13px;
        font-weight: 600;
      }
      .input-wrap {
        display: flex;
        align-items: center;
        gap: 4px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: white;
        padding: 2px;
      }
      .input-wrap:focus-within {
        border-color: var(--accent-strong);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
      input, textarea {
        width: 100%;
        min-width: 0;
        border: 0;
        outline: 0;
        padding: 7px 9px;
        font: inherit;
        font-size: 14px;
        background: transparent;
      }
      textarea {
        min-height: 104px;
        resize: vertical;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
      }
      .reveal {
        flex: 0 0 auto;
        margin: 0;
        border: 0;
        border-radius: 6px;
        padding: 6px 8px;
        color: var(--muted);
        background: transparent;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .reveal:hover { background: var(--bg); color: var(--ink); }
      .submit {
        width: 100%;
        margin-top: 12px;
        border: 0;
        border-radius: 6px;
        padding: 8px 12px;
        color: white;
        background: var(--ink);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .submit:hover { background: #020617; }
      .submit:disabled { cursor: wait; opacity: 0.72; }
      .fine-print {
        margin: 12px 0 0;
        color: var(--subtle);
        font-size: 12px;
        line-height: 1.5;
      }
      .error {
        margin: 16px 0 0;
        color: var(--bad);
        background: var(--bad-bg);
        border: 1px solid #fecaca;
        border-radius: 6px;
        padding: 10px;
        font-size: 13px;
        line-height: 1.45;
      }
      .success {
        margin-top: 16px;
        color: var(--good);
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 6px;
        padding: 12px;
      }
      .success p { color: var(--good); margin: 8px 0; line-height: 1.45; }
      .success-title { font-weight: 650; font-size: 14px; }
      .hint { font-size: 12px; color: var(--subtle); }
      @media (max-width: 860px) {
        main { min-height: auto; align-items: flex-start; }
        .panel { padding: 18px; }
        .summary-row { grid-template-columns: 1fr; gap: 4px; }
      }`
}

function authPageScript(): string {
  return `
    <script>
      const revealButton = document.querySelector('[data-reveal]');
      const keyInput = document.querySelector('#api_key');
      revealButton?.addEventListener('click', () => {
        if (!keyInput) return;
        const shouldShow = keyInput.type === 'password';
        keyInput.type = shouldShow ? 'text' : 'password';
        revealButton.textContent = shouldShow ? 'Hide' : 'Show';
      });
      document.querySelector('form')?.addEventListener('submit', (event) => {
        const button = event.currentTarget.querySelector('[data-submit]');
        if (!button) return;
        button.disabled = true;
        button.textContent = 'Connecting...';
      });
    </script>`
}

function writeOAuthAuthorizePage(res: ServerResponse, params: {
  endpoint: PortalEndpoint
  fields: Record<string, string>
  host?: string
  error?: string
}) {
  const portalHost = escapeHtml(endpointPortalHost(params.endpoint, params.host))
  const returnOrigin = redirectOrigin(params.fields.redirect_uri)
  const returnRow = returnOrigin
    ? `<div class="summary-row"><span class="summary-label">Return</span><span class="summary-value">${escapeHtml(returnOrigin)}</span></div>`
    : ''
  const errorHtml = params.error ? `<p class="error">${escapeHtml(params.error)}</p>` : ''
  const hiddenFields = [
    'client_id',
    'redirect_uri',
    'response_type',
    'scope',
    'state',
    'code_challenge',
    'code_challenge_method',
    'resource',
  ]
    .map((field) => appendHiddenInput(field, params.fields[field]))
    .join('')

  res.writeHead(params.error ? 400 : 200, authPageHeaders())
  res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connect SQD Portal MCP</title>
    <style>
      ${authPageStyles()}
    </style>
  </head>
  <body>
    <main>
      <section class="panel" aria-label="Connect Portal API key">
        <div class="brand">
          <span class="brand-main">
            <span class="mark">${sqdSymbolSvg()}</span>
            <span class="brand-lockup"><span class="brand-name">SQD</span><span class="brand-label">Portal MCP</span></span>
          </span>
        </div>
        <div class="summary">
          <div class="summary-row"><span class="summary-label">Portal</span><span class="summary-value">${portalHost}</span></div>
          ${returnRow}
        </div>
        ${errorHtml}
        <form method="post" action="/oauth/authorize">
          ${hiddenFields}
          <label for="api_key">Portal API key</label>
          <div class="input-wrap">
            <input id="api_key" name="api_key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus required>
            <button class="reveal" type="button" data-reveal>Show</button>
          </div>
          <button class="submit" type="submit" data-submit>Connect MCP</button>
        </form>
        <p class="fine-print">This connection is scoped to ${portalHost}. Your Portal API key is used only for this Portal endpoint.</p>
      </section>
    </main>
    ${authPageScript()}
  </body>
</html>`)
}

function validateOAuthAuthorizeFields(fields: Record<string, string>, endpoint: PortalEndpoint): string | undefined {
  if (fields.response_type !== 'code') return 'Unsupported OAuth response_type.'
  if (!fields.client_id) return 'OAuth client_id is required.'
  if (!getOAuthClient(fields.client_id)) return 'Unknown OAuth client.'
  if (!fields.redirect_uri) return 'OAuth redirect_uri is required.'
  try {
    if (!isOAuthRedirectUriAllowed(fields.client_id, fields.redirect_uri)) {
      return 'OAuth redirect_uri is not registered for this client.'
    }
  } catch {
    return 'OAuth redirect_uri must be an absolute URL.'
  }
  if (!fields.code_challenge) return 'OAuth PKCE code_challenge is required.'
  if (fields.code_challenge_method !== 'S256') return 'OAuth PKCE code_challenge_method must be S256.'
  const scope = fields.scope?.trim()
  if (scope && !scope.split(/\s+/).includes(MCP_OAUTH_SCOPE)) return `OAuth scope must include ${MCP_OAUTH_SCOPE}.`
  const resourceError = validateOAuthResource(fields, endpoint)
  if (resourceError) return resourceError
  return undefined
}

function writeDelegatedAuthPage(res: ServerResponse, params: {
  endpoint: PortalEndpoint
  host?: string
  error?: string
  token?: string
  expiresAt?: string
  debugToken?: boolean
}) {
  const endpointLabel = escapeHtml(params.endpoint.label)
  const portalHost = escapeHtml(endpointPortalHost(params.endpoint, params.host))
  const errorHtml = params.error
    ? `<p class="error">${escapeHtml(params.error)}</p>`
    : ''
  const successHtml = params.token
    ? params.debugToken
      ? `<section class="success">
          <p class="success-title">Connected.</p>
          <p class="hint">Debug token for local testing:</p>
          <textarea readonly>${escapeHtml(params.token)}</textarea>
          <p class="hint">Expires at ${escapeHtml(params.expiresAt ?? 'unknown')}. The Portal API key was not echoed.</p>
        </section>`
      : `<section class="success">
          <p class="success-title">Connected.</p>
          <p>Return to your MCP client and continue using SQD Portal.</p>
          <p class="hint">The Portal API key was accepted and was not echoed back.</p>
        </section>`
    : ''
  const formHtml = params.token
    ? ''
    : `<form method="post" action="/mcp/auth">
        <label for="api_key">Portal API key</label>
        <div class="input-wrap">
          <input id="api_key" name="api_key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus required>
          <button class="reveal" type="button" data-reveal>Show</button>
        </div>
        <button class="submit" type="submit" data-submit>Connect MCP</button>
      </form>`

  res.writeHead(params.token ? 200 : params.error ? 400 : 200, authPageHeaders())
  res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SQD Portal MCP Auth</title>
    <style>
      ${authPageStyles()}
    </style>
  </head>
  <body>
    <main>
      <section class="panel" aria-label="Manual Portal API key bootstrap">
        <div class="brand">
          <span class="brand-main">
            <span class="mark">${sqdSymbolSvg()}</span>
            <span class="brand-lockup"><span class="brand-name">SQD</span><span class="brand-label">Portal MCP</span></span>
          </span>
        </div>
        <div class="panel-header">
          <p class="panel-kicker">Manual bootstrap</p>
          <h1 class="endpoint-name">Connect ${endpointLabel}</h1>
          <p class="lede">Fallback page for local testing. Production clients should start from the MCP URL and complete auth automatically.</p>
        </div>
        <div class="summary">
          <div class="summary-row"><span class="summary-label">Portal</span><span class="summary-value">${portalHost}</span></div>
          <div class="summary-row"><span class="summary-label">Mode</span><span class="summary-value">Delegated API key</span></div>
          <div class="summary-row"><span class="summary-label">Token</span><span class="summary-value">Hidden from browser</span></div>
        </div>
        ${errorHtml}
        ${formHtml}
        ${successHtml}
        <p class="fine-print">For customer setup, add the MCP URL in the client. Do not ask users to copy tokens from this page.</p>
      </section>
    </main>
    ${authPageScript()}
  </body>
</html>`)
}

function wantsJson(req: IncomingMessage): boolean {
  return readHeader(req, 'accept')?.includes('application/json') ?? false
}

function shouldShowDelegatedDebugToken(): boolean {
  return process.env.MCP_DELEGATED_AUTH_DEBUG_TOKENS === 'true'
}

function isMetricsAuthorized(req: IncomingMessage): boolean {
  if (METRICS_PUBLIC) return true
  if (!METRICS_BEARER_TOKEN) return false
  const token = readBearerToken(req)
  return Boolean(token && safeEqual(token, METRICS_BEARER_TOKEN))
}

function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    }),
  )
}

function buildMcpWwwAuthenticate(req: IncomingMessage): string {
  return `Bearer realm="mcp", resource_metadata="${getProtectedResourceMetadataUri(req)}", scope="${MCP_OAUTH_SCOPE}"`
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const requestId = readHeader(req, 'x-request-id') || randomUUID()
  res.setHeader('x-request-id', requestId)

  const userAgent = readHeader(req, 'user-agent')
  const clientName = readSafeTelemetryHeader(readHeader(req, 'x-mcp-client-name') || readHeader(req, 'x-client-name'), 'unknown')
  const clientVersion = readSafeTelemetryHeader(readHeader(req, 'x-mcp-client-version') || readHeader(req, 'x-client-version'), 'unknown')

  // Health check endpoint
  // NOTE: Do not expose PORTAL_URL here — it may contain a sensitive token
  if (url.pathname === '/health') {
    const catalog = buildToolCatalog()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'ok',
        server: 'sqd-portal-mcp-server',
        version: npmVersion,
        plugin: {
          selector: PORTAL_PLUGIN_SELECTOR,
          mcp_server_label: PORTAL_MCP_SERVER_LABEL,
          read_only: true,
        },
        tools: {
          total: catalog.entries.length,
          public: catalog.entries.filter((entry) => entry.guide?.audience === 'public').length,
          advanced: catalog.entries.filter((entry) => entry.guide?.audience === 'advanced').length,
        },
        discovery: {
          mcp_resources: ['sqd://tools', 'sqd://tools/{name}', 'sqd://execution-guidance', 'sqd://datasets'],
          http_routes: ['/health', '/ready', '/tools', '/tools.json'],
          hosted_note:
            'Self-hosted HTTP mode exposes these public GET routes. Managed hosted deployments may expose MCP-only discovery until the edge route is configured.',
        },
        observability: getObservabilityStatus(),
      }),
    )
    return
  }

  // Readiness check endpoint.
  // Unlike /health, this can return 503 when required deployment guards
  // such as auth, cursor signing, metrics protection, or Portal reachability
  // are not ready. The payload intentionally uses safe endpoint metadata only.
  if (url.pathname === '/ready') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    const endpointResolution = resolveRequestEndpoint(req)
    if (!validateKnownMcpHost(endpointResolution, res, req)) return
    const { endpoint } = endpointResolution
    const report = await getReadinessReport(process.env, endpoint)
    res.writeHead(report.status === 'ready' ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(JSON.stringify(report))
    return
  }

  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
    writeOAuthCorsHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD, OPTIONS' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    const endpointResolution = resolveRequestEndpoint(req)
    if (!validateKnownMcpHost(endpointResolution, res, req)) return

    const body = {
      resource: getMcpResourceUri(req),
      authorization_servers: [getOAuthIssuer(req)],
      scopes_supported: [MCP_OAUTH_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'SQD Portal MCP',
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(JSON.stringify(body))
    return
  }

  if (
    url.pathname === '/.well-known/oauth-authorization-server' ||
    url.pathname === '/.well-known/oauth-authorization-server/mcp' ||
    url.pathname === '/.well-known/openid-configuration'
  ) {
    writeOAuthCorsHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD, OPTIONS' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    const endpointResolution = resolveRequestEndpoint(req)
    if (!validateKnownMcpHost(endpointResolution, res, req)) return

    const issuer = getOAuthIssuer(req)
    const body = {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [MCP_OAUTH_SCOPE],
      authorization_response_iss_parameter_supported: true,
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(JSON.stringify(body))
    return
  }

  if (url.pathname === '/oauth/register') {
    writeOAuthCorsHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    try {
      const registration = registerOAuthClient(await readJsonObject(req))
      writeJson(res, 201, registration, { 'Access-Control-Allow-Origin': '*' })
    } catch (error) {
      writeJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid OAuth client registration.' }, {
        'Access-Control-Allow-Origin': '*',
      })
    }
    return
  }

  if (url.pathname === '/oauth/authorize') {
    if (!isDelegatedMcpAuthEnabled()) {
      writeJson(res, 404, { error: 'Delegated MCP auth is not enabled for this deployment.' })
      return
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, POST' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    try {
      const fields = req.method === 'GET' ? readUrlFields(url) : await readRequestFields(req)
      const endpointResolution = resolveOAuthEndpoint(req)
      const { endpoint } = endpointResolution
      if (endpointResolution.unknownNonLocalHost) {
        writeOAuthAuthorizePage(res, { endpoint, fields, host: endpointResolution.host, error: 'Unknown MCP host.' })
        return
      }
      const validationError = validateOAuthAuthorizeFields(fields, endpoint)
      if (validationError) {
        writeOAuthAuthorizePage(res, { endpoint, fields, host: endpointResolution.host, error: validationError })
        return
      }

      if (!isDelegatedPortalEndpoint(endpoint)) {
        writeOAuthAuthorizePage(res, {
          endpoint,
          fields,
          host: endpointResolution.host,
          error: 'This Portal endpoint is not configured for delegated API-key auth.',
        })
        return
      }

      if (req.method === 'GET') {
        writeOAuthAuthorizePage(res, { endpoint, fields, host: endpointResolution.host })
        return
      }

      const apiKey = fields.api_key ?? ''
      const apiKeyValidation = await validateDelegatedPortalApiKey(endpoint, apiKey, process.env)
      if (!apiKeyValidation.ok) {
        writeOAuthAuthorizePage(res, { endpoint, fields, host: endpointResolution.host, error: apiKeyValidation.message })
        return
      }

      const scope = MCP_OAUTH_SCOPE
      const code = issueOAuthAuthorizationCode({
        clientId: fields.client_id,
        redirectUri: fields.redirect_uri,
        codeChallenge: fields.code_challenge,
        endpoint,
        apiKey,
        env: process.env,
        scope,
        resource: fields.resource || getMcpResourceUri(req),
        tenantId: endpoint.tenantId,
      })
      const redirect = new URL(fields.redirect_uri)
      redirect.searchParams.set('code', code)
      if (fields.state) redirect.searchParams.set('state', fields.state)
      redirect.searchParams.set('iss', getOAuthIssuer(req))
      res.writeHead(302, {
        Location: redirect.toString(),
        'Cache-Control': 'no-store',
      })
      res.end()
    } catch (error) {
      const endpointResolution = resolveOAuthEndpoint(req)
      const { endpoint } = endpointResolution
      writeOAuthAuthorizePage(res, {
        endpoint,
        fields: req.method === 'GET' ? readUrlFields(url) : {},
        host: endpointResolution.host,
        error: error instanceof Error ? error.message : 'Could not process OAuth authorization request.',
      })
    }
    return
  }

  if (url.pathname === '/oauth/token') {
    writeOAuthCorsHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    try {
      const fields = await readRequestFields(req)
      if (fields.grant_type !== 'authorization_code') {
        writeJson(res, 400, { error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported.' }, {
          'Access-Control-Allow-Origin': '*',
        })
        return
      }

      const exchange = exchangeOAuthAuthorizationCode({
        code: fields.code ?? '',
        clientId: fields.client_id ?? '',
        redirectUri: fields.redirect_uri ?? '',
        codeVerifier: fields.code_verifier ?? '',
        env: process.env,
        resource: fields.resource,
      })
      const session = issueDelegatedMcpSession({
        endpoint: exchange.endpoint,
        apiKey: exchange.apiKey,
        env: process.env,
        tenantId: exchange.tenantId,
      })
      const expiresIn = Math.max(1, Math.floor((Date.parse(session.expires_at) - Date.now()) / 1000))
      writeJson(res, 200, {
        access_token: session.token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope: exchange.scope,
      }, { 'Access-Control-Allow-Origin': '*' })
    } catch (error) {
      writeJson(res, 400, {
        error: 'invalid_grant',
        error_description: error instanceof Error ? error.message : 'Invalid OAuth token request.',
      }, { 'Access-Control-Allow-Origin': '*' })
    }
    return
  }

  // Prometheus metrics endpoint
  if (url.pathname === '/metrics') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    if (!isMetricsAuthorized(req)) {
      const isTokenConfigured = Boolean(METRICS_BEARER_TOKEN)
      res.writeHead(isTokenConfigured ? 401 : 404, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(isTokenConfigured ? { 'WWW-Authenticate': 'Bearer realm="metrics"' } : {}),
      })
      res.end(JSON.stringify({ error: isTokenConfigured ? 'Unauthorized' : 'Not found' }))
      return
    }

    res.writeHead(200, {
      'Content-Type': register.contentType,
      'Cache-Control': 'no-store',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(await register.metrics())
    return
  }

  // Public tool catalog — same data as MCP `tools/list`, served as plain
  // JSON so a browser, curl, or docs page can introspect the available
  // tools without an MCP client. Read-only, no auth, GET only.
  if (url.pathname === '/tools' || url.pathname === '/tools.json') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    const endpointResolution = resolveRequestEndpoint(req)
    if (!validateKnownMcpHost(endpointResolution, res, req)) return
    const { endpoint } = endpointResolution
    const catalog = buildToolCatalog(endpoint)
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(
      JSON.stringify(
        {
          server: 'sqd-portal-mcp-server',
          version: npmVersion,
          endpoint: catalog.endpoint,
          plugin: {
            selector: PORTAL_PLUGIN_SELECTOR,
            mcp_server_label: PORTAL_MCP_SERVER_LABEL,
            read_only: true,
          },
          execution_guidance: getExecutionGuidance(),
          generated_at: catalog.generatedAt,
          tool_count: catalog.entries.length,
          public_tool_count: catalog.entries.filter((entry) => entry.guide?.audience === 'public').length,
          advanced_tool_count: catalog.entries.filter((entry) => entry.guide?.audience === 'advanced').length,
          groups: catalog.groups,
          tools: catalog.entries,
        },
        null,
        2,
      ),
    )
    return
  }

  if (url.pathname === '/mcp/auth') {
    const endpointResolution = resolveAuthEndpoint(req)
    const { endpoint, host } = endpointResolution
    if (!validateKnownMcpHost(endpointResolution, res, req)) return
    if (!isDelegatedMcpAuthEnabled()) {
      const message = 'Delegated MCP auth is not enabled for this deployment.'
      if (wantsJson(req)) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ error: message }))
      } else {
        writeDelegatedAuthPage(res, { endpoint, host, error: message })
      }
      return
    }

    if (!isDelegatedPortalEndpoint(endpoint)) {
      const message = 'This Portal endpoint is not configured for delegated API-key auth.'
      if (wantsJson(req)) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ error: message }))
      } else {
        writeDelegatedAuthPage(res, { endpoint, host, error: message })
      }
      return
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end()
        return
      }
      writeDelegatedAuthPage(res, { endpoint, host })
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD, POST' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    try {
      const contentType = readHeader(req, 'content-type') ?? ''
      const bodyText = await readRequestBody(req)
      let apiKey = ''
      if (contentType.includes('application/json')) {
        const parsed = JSON.parse(bodyText) as Record<string, unknown>
        apiKey = typeof parsed.api_key === 'string' ? parsed.api_key : typeof parsed.apiKey === 'string' ? parsed.apiKey : ''
      } else {
        apiKey = new URLSearchParams(bodyText).get('api_key') ?? ''
      }

      const validation = await validateDelegatedPortalApiKey(endpoint, apiKey, process.env)
      if (!validation.ok) {
        if (wantsJson(req)) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: validation.message }))
        } else {
          writeDelegatedAuthPage(res, { endpoint, host, error: validation.message })
        }
        return
      }

      const session = issueDelegatedMcpSession({
        endpoint,
        apiKey,
        env: process.env,
        tenantId: endpoint.tenantId,
      })

      if (wantsJson(req)) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({
          mcp_token: session.token,
          expires_at: session.expires_at,
          endpoint_id: session.endpoint_id,
        }))
      } else {
        writeDelegatedAuthPage(res, {
          endpoint,
          host,
          token: session.token,
          expiresAt: session.expires_at,
          debugToken: shouldShowDelegatedDebugToken(),
        })
      }
    } catch {
      const message = 'Could not process delegated MCP auth request.'
      if (wantsJson(req)) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ error: message }))
      } else {
        writeDelegatedAuthPage(res, { endpoint, host, error: message })
      }
    }
    return
  }

  // MCP endpoint. Keep /mcp as an alias because remote MCP clients and
  // quick-tunnel prompts commonly use that path.
  if (url.pathname === '/' || url.pathname === '/mcp') {
    if (req.method === 'POST') {
      const endpointResolution = resolveRequestEndpoint(req)
      if (!validateKnownMcpHost(endpointResolution, res, req)) return
      const { endpoint, matchedHost } = endpointResolution
      const auth = authenticateMcpBearerToken(readBearerToken(req), process.env, matchedHost ? endpoint : undefined)
      if (!auth.ok) {
        writeJsonRpcError(res, auth.status, auth.code, auth.message, {
          ...auth.headers,
          ...(isDelegatedMcpAuthEnabled() ? { 'WWW-Authenticate': buildMcpWwwAuthenticate(req) } : {}),
        })
        return
      }

      try {
        await runWithPortalEndpoint(auth.context.endpoint, async () => runWithDelegatedPortalCredential(
          auth.context.delegated_credential_ref,
          auth.context.endpoint,
          async () => {
          clientRequestsTotal.inc({
            transport: 'http',
            client_name: clientName,
            client_version: clientVersion,
          })

          const mcpServer = createPortalServer({
            transport: 'http',
            requestId,
            clientName,
            clientVersion,
            sessionId: readHeader(req, 'x-mcp-session-id') || readHeader(req, 'x-session-id'),
            userQuery: readHeader(req, 'x-mcp-user-query'),
            userAgent,
            forwardedFor: readHeader(req, 'x-forwarded-for'),
            endpoint: getSafePortalEndpointMetadata(auth.context.endpoint),
            mcpAuthMode: auth.context.mode,
            mcpAuthOutcome: auth.context.mode === 'anonymous' ? 'anonymous' : 'authorized',
            credentialPolicy: auth.context.credential_policy,
          })
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          })

          await mcpServer.connect(transport)
          await transport.handleRequest(req, res)

          res.on('close', () => {
            transport.close()
            mcpServer.close()
          })
        }))
      } catch (error) {
        const safeErrorMessage = sanitizeText(error instanceof Error ? error.message : String(error))
        console.error(`[mcp] request failed: ${safeErrorMessage}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Internal server error',
              },
              id: null,
            }),
          )
        }
      }
      return
    }

    // GET and DELETE aren't supported in stateless mode
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      }),
    )
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`SQD Portal MCP Server listening on http://localhost:${PORT}`)
})

process.on('SIGINT', () => {
  console.log('Shutting down...')
  server.close()
  process.exit(0)
})
