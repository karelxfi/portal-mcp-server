import { AsyncLocalStorage } from 'node:async_hooks'

import { hashString53 } from '../helpers/hash.js'

const DEFAULT_PUBLIC_PORTAL_URL = 'https://portal.sqd.dev'
const DEFAULT_DYNAMIC_DEDICATED_DOMAIN = 'portal.sqd.dev'
const PUBLIC_ENDPOINT_ID = 'public'
const DEFAULT_API_KEY_HEADER = 'X-API-Key'
const DYNAMIC_DEDICATED_ENDPOINT_ID_PREFIX = 'portal:'
const DEDICATED_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export type PortalEndpointAuthMode = 'none' | 'bearer' | 'api_key' | 'delegated_api_key'
export type PortalEndpointClass = 'public' | 'internal' | 'enterprise'
export type PortalTenantScope = 'public' | 'organization' | 'tenant' | 'endpoint'

export interface PortalEndpointAuth {
  mode: PortalEndpointAuthMode
  tokenEnv?: string
  headerName?: string
}

export interface PortalEndpoint {
  id: string
  baseUrl: string
  hostnames: string[]
  label: string
  endpointClass: PortalEndpointClass
  tenantScope: PortalTenantScope
  tenantId?: string
  auth: PortalEndpointAuth
  isDefault: boolean
}

export interface PortalEndpointConfig {
  endpoints: PortalEndpoint[]
  defaultEndpoint: PortalEndpoint
}

export interface SafePortalEndpointMetadata {
  id: string
  label: string
  endpoint_class: PortalEndpointClass
  tenant_scope: PortalTenantScope
  tenant_key?: string
  auth_mode: PortalEndpointAuthMode
  auth_required: boolean
  is_default: boolean
  cache_scope: string
}

type RawPortalEndpoint = Record<string, unknown>

type RawAuthConfig = {
  mode?: unknown
  tokenEnv?: unknown
  headerName?: unknown
  token?: unknown
  apiKey?: unknown
  authorization?: unknown
}

type RawTenantConfig = {
  scope?: unknown
  id?: unknown
}

const ENDPOINT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
const HOSTNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/
const activePortalEndpoint = new AsyncLocalStorage<PortalEndpoint>()

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

function readCsv(value: string | undefined): string[] {
  return value
    ? value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    : []
}

function fail(message: string): never {
  throw new Error(`Invalid Portal endpoint configuration: ${message}`)
}

function readString(value: unknown, field: string, fallback?: string): string {
  if (typeof value === 'undefined' || value === null || value === '') {
    if (typeof fallback === 'string') return fallback
    fail(`${field} is required`)
  }

  if (typeof value !== 'string') {
    fail(`${field} must be a string`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    if (typeof fallback === 'string') return fallback
    fail(`${field} is required`)
  }

  return trimmed
}

function normalizeBaseUrl(value: unknown, field: string): string {
  const raw = readString(value, field)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    fail(`${field} must be an absolute URL`)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    fail(`${field} must use http or https`)
  }

  if (url.username || url.password) {
    fail(`${field} must not contain credentials`)
  }

  if (url.search || url.hash) {
    fail(`${field} must not contain query strings or fragments`)
  }

  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path}`
}

function hostnameFromBaseUrl(baseUrl: string): string {
  return new URL(baseUrl).hostname.toLowerCase()
}

function normalizeHostname(value: unknown, field: string): string {
  const raw = readString(value, field).toLowerCase()
  const withoutPort = raw.includes(':') ? raw.split(':')[0] : raw

  if (!HOSTNAME_PATTERN.test(withoutPort) || withoutPort.includes('..')) {
    fail(`${field} must be a hostname, not a URL or path`)
  }

  return withoutPort
}

function dynamicDedicatedDomain(env: NodeJS.ProcessEnv): string {
  return normalizeHostname(readEnv(env, 'PORTAL_DYNAMIC_DEDICATED_DOMAIN') ?? DEFAULT_DYNAMIC_DEDICATED_DOMAIN, 'PORTAL_DYNAMIC_DEDICATED_DOMAIN')
}

function dynamicDedicatedHeaderName(env: NodeJS.ProcessEnv): string {
  return validateHeaderName(
    readEnv(env, 'PORTAL_DYNAMIC_DEDICATED_API_KEY_HEADER') ?? DEFAULT_API_KEY_HEADER,
    'PORTAL_DYNAMIC_DEDICATED_API_KEY_HEADER',
  )
}

function dynamicInternalHosts(env: NodeJS.ProcessEnv): Set<string> {
  const hosts = readCsv(readEnv(env, 'PORTAL_DYNAMIC_INTERNAL_HOSTS'))
  return new Set(hosts.map((host, index) => normalizeHostname(host, `PORTAL_DYNAMIC_INTERNAL_HOSTS[${index}]`)))
}

function dynamicDedicatedSlug(hostname: string, env: NodeJS.ProcessEnv): string | undefined {
  if (!readBool(env, 'PORTAL_DYNAMIC_DEDICATED_ENDPOINTS', true)) return undefined

  const domain = dynamicDedicatedDomain(env)
  if (hostname === domain) return undefined
  if (!hostname.endsWith(`.${domain}`)) return undefined

  const slug = hostname.slice(0, -(domain.length + 1))
  if (!DEDICATED_SLUG_PATTERN.test(slug)) return undefined
  return slug
}

function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function dynamicEndpointId(hostname: string): string {
  return `${DYNAMIC_DEDICATED_ENDPOINT_ID_PREFIX}${hostname}`
}

function buildDynamicDedicatedEndpoint(host: string, env: NodeJS.ProcessEnv): PortalEndpoint | undefined {
  let hostname: string
  try {
    hostname = normalizeHostname(host, 'host')
  } catch {
    return undefined
  }

  const slug = dynamicDedicatedSlug(hostname, env)
  if (!slug) return undefined

  const endpointClass: PortalEndpointClass = dynamicInternalHosts(env).has(hostname) ? 'internal' : 'enterprise'
  return {
    id: dynamicEndpointId(hostname),
    baseUrl: `https://${hostname}`,
    hostnames: [hostname],
    label: endpointClass === 'internal' ? 'SQD internal Portal' : `${titleCaseSlug(slug)} Portal`,
    endpointClass,
    tenantScope: endpointClass === 'internal' ? 'tenant' : 'endpoint',
    tenantId: hostname,
    auth: {
      mode: 'delegated_api_key',
      headerName: dynamicDedicatedHeaderName(env),
    },
    isDefault: false,
  }
}

function readHostnames(value: unknown, baseUrl: string, context: string): string[] {
  const hostnames = new Set<string>([hostnameFromBaseUrl(baseUrl)])

  if (typeof value === 'string') {
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => hostnames.add(normalizeHostname(entry, `${context}.hostnames`)))
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => hostnames.add(normalizeHostname(entry, `${context}.hostnames[${index}]`)))
  } else if (typeof value !== 'undefined' && value !== null) {
    fail(`${context}.hostnames must be a string or string array`)
  }

  return Array.from(hostnames).sort()
}

function validateEndpointId(id: string, field: string): string {
  if (!ENDPOINT_ID_PATTERN.test(id)) {
    fail(`${field} must start with a letter or number and contain only letters, numbers, ".", "_", ":", or "-"`)
  }
  return id
}

function validateEnvName(value: string, field: string): string {
  if (!ENV_NAME_PATTERN.test(value)) {
    fail(`${field} must be an environment variable name`)
  }
  return value
}

function validateHeaderName(value: string, field: string): string {
  if (!HEADER_NAME_PATTERN.test(value)) {
    fail(`${field} must be a valid HTTP header name`)
  }
  return value
}

function readAuthMode(value: unknown, field: string): PortalEndpointAuthMode {
  const mode = typeof value === 'undefined' || value === null || value === '' ? 'none' : readString(value, field).toLowerCase()
  if (mode === 'none' || mode === 'bearer' || mode === 'api_key' || mode === 'delegated_api_key') return mode
  if (mode === 'api-key' || mode === 'apikey') return 'api_key'
  if (mode === 'delegated-api-key' || mode === 'delegated') return 'delegated_api_key'
  fail(`${field} must be one of: none, bearer, api_key, delegated_api_key`)
}

function inferEndpointClass(baseUrl: string): PortalEndpointClass {
  if (baseUrl === DEFAULT_PUBLIC_PORTAL_URL) return 'public'
  return 'enterprise'
}

function readEndpointClass(value: unknown, baseUrl: string): PortalEndpointClass {
  if (typeof value === 'undefined' || value === null || value === '') {
    return inferEndpointClass(baseUrl)
  }

  const endpointClass = readString(value, 'endpointClass').toLowerCase()
  if (endpointClass === 'public' || endpointClass === 'internal' || endpointClass === 'enterprise') {
    return endpointClass
  }
  fail('endpointClass must be one of: public, internal, enterprise')
}

function readTenantScope(value: unknown, endpointClass: PortalEndpointClass): PortalTenantScope {
  if (typeof value === 'undefined' || value === null || value === '') {
    return endpointClass === 'public' ? 'public' : 'endpoint'
  }

  const scope = readString(value, 'tenantScope').toLowerCase()
  if (scope === 'public' || scope === 'organization' || scope === 'tenant' || scope === 'endpoint') {
    return scope
  }
  fail('tenantScope must be one of: public, organization, tenant, endpoint')
}

function readAuth(raw: RawPortalEndpoint, context: string): PortalEndpointAuth {
  const rawAuth = (raw.auth && typeof raw.auth === 'object' ? raw.auth : {}) as RawAuthConfig

  if (
    typeof raw.token !== 'undefined' ||
    typeof raw.apiKey !== 'undefined' ||
    typeof raw.authorization !== 'undefined' ||
    typeof rawAuth.token !== 'undefined' ||
    typeof rawAuth.apiKey !== 'undefined' ||
    typeof rawAuth.authorization !== 'undefined'
  ) {
    fail(`${context} must reference secrets with tokenEnv, not inline secret values`)
  }

  const mode = readAuthMode(raw.authMode ?? rawAuth.mode, `${context}.authMode`)
  if (mode === 'none') return { mode }

  if (mode === 'delegated_api_key') {
    const headerName = validateHeaderName(
      readString(raw.headerName ?? rawAuth.headerName, `${context}.headerName`, DEFAULT_API_KEY_HEADER),
      `${context}.headerName`,
    )
    return { mode, headerName }
  }

  const tokenEnv = validateEnvName(
    readString(raw.tokenEnv ?? rawAuth.tokenEnv, `${context}.tokenEnv`),
    `${context}.tokenEnv`,
  )

  if (mode === 'bearer') {
    return { mode, tokenEnv, headerName: 'Authorization' }
  }

  const headerName = validateHeaderName(
    readString(raw.headerName ?? rawAuth.headerName, `${context}.headerName`, DEFAULT_API_KEY_HEADER),
    `${context}.headerName`,
  )
  return { mode, tokenEnv, headerName }
}

function validateClassAuth(endpointClass: PortalEndpointClass, auth: PortalEndpointAuth, context: string) {
  if (endpointClass === 'public' && auth.mode !== 'none') {
    fail(`${context}.authMode must be none for public endpoints`)
  }
  if (endpointClass !== 'public' && auth.mode === 'none') {
    fail(`${context}.authMode must be bearer, api_key, or delegated_api_key for internal and enterprise endpoints`)
  }
}

function validateEndpointTransport(baseUrl: string, endpointClass: PortalEndpointClass, auth: PortalEndpointAuth, context: string) {
  const protocol = new URL(baseUrl).protocol
  if ((endpointClass !== 'public' || auth.mode !== 'none') && protocol !== 'https:') {
    fail(`${context}.baseUrl must use https for authenticated internal and enterprise endpoints`)
  }
}

function buildEndpoint(raw: RawPortalEndpoint, index: number, isDefault: boolean): PortalEndpoint {
  const context = `endpoint[${index}]`
  const id = validateEndpointId(readString(raw.id, `${context}.id`, index === 0 ? PUBLIC_ENDPOINT_ID : `endpoint-${index + 1}`), `${context}.id`)
  const baseUrl = normalizeBaseUrl(raw.portalBaseUrl ?? raw.baseUrl ?? raw.url, `${context}.baseUrl`)
  const label = readString(raw.label ?? raw.displayLabel, `${context}.label`, id)
  const endpointClass = readEndpointClass(raw.endpointClass ?? raw.class, baseUrl)
  const rawTenant = (raw.tenant && typeof raw.tenant === 'object' ? raw.tenant : {}) as RawTenantConfig
  const tenantScope = readTenantScope(raw.tenantScope ?? rawTenant.scope, endpointClass)
  const tenantIdValue = raw.tenantId ?? rawTenant.id
  const tenantId = typeof tenantIdValue === 'undefined' || tenantIdValue === null || tenantIdValue === ''
    ? undefined
    : readString(tenantIdValue, `${context}.tenantId`)
  const auth = readAuth(raw, context)
  validateClassAuth(endpointClass, auth, context)
  validateEndpointTransport(baseUrl, endpointClass, auth, context)

  return {
    id,
    baseUrl,
    hostnames: readHostnames(
      raw.mcpHostnames ?? raw.publicHostnames ?? raw.hostnames ?? raw.hosts ?? raw.hostname ?? raw.host,
      baseUrl,
      context,
    ),
    label,
    endpointClass,
    tenantScope,
    ...(tenantId ? { tenantId } : {}),
    auth,
    isDefault,
  }
}

function singleEndpointFromEnv(env: NodeJS.ProcessEnv): RawPortalEndpoint {
  return {
    id: readEnv(env, 'PORTAL_ENDPOINT_ID') ?? PUBLIC_ENDPOINT_ID,
    baseUrl: readEnv(env, 'PORTAL_BASE_URL') ?? readEnv(env, 'PORTAL_URL') ?? DEFAULT_PUBLIC_PORTAL_URL,
    hostnames: readEnv(env, 'PORTAL_MCP_HOSTNAMES') ?? readEnv(env, 'PORTAL_ENDPOINT_HOSTNAMES'),
    label: readEnv(env, 'PORTAL_ENDPOINT_LABEL') ?? (readEnv(env, 'PORTAL_ENDPOINT_ID') ?? PUBLIC_ENDPOINT_ID),
    endpointClass: readEnv(env, 'PORTAL_ENDPOINT_CLASS'),
    tenantScope: readEnv(env, 'PORTAL_ENDPOINT_TENANT_SCOPE'),
    tenantId: readEnv(env, 'PORTAL_ENDPOINT_TENANT_ID'),
    authMode: readEnv(env, 'PORTAL_ENDPOINT_AUTH_MODE') ?? 'none',
    tokenEnv: readEnv(env, 'PORTAL_ENDPOINT_TOKEN_ENV'),
    headerName: readEnv(env, 'PORTAL_ENDPOINT_API_KEY_HEADER'),
  }
}

function endpointsFromJson(rawJson: string): RawPortalEndpoint[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    fail('PORTAL_ENDPOINTS must be valid JSON')
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail('PORTAL_ENDPOINTS must be a non-empty array')
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`endpoint[${index}] must be an object`)
    }
    return entry as RawPortalEndpoint
  })
}

function findDefaultEndpoint(rawEndpoints: RawPortalEndpoint[], defaultId?: string): number {
  if (defaultId) {
    const index = rawEndpoints.findIndex((endpoint) => endpoint.id === defaultId)
    if (index === -1) fail(`PORTAL_DEFAULT_ENDPOINT_ID "${defaultId}" does not match any configured endpoint`)
    return index
  }

  const markedDefault = rawEndpoints.findIndex((endpoint) => endpoint.default === true || endpoint.isDefault === true)
  return markedDefault === -1 ? 0 : markedDefault
}

export function loadPortalEndpointConfig(env: NodeJS.ProcessEnv = process.env): PortalEndpointConfig {
  const rawJson = readEnv(env, 'PORTAL_ENDPOINTS')
  const rawEndpoints = rawJson ? endpointsFromJson(rawJson) : [singleEndpointFromEnv(env)]
  const defaultIndex = findDefaultEndpoint(rawEndpoints, readEnv(env, 'PORTAL_DEFAULT_ENDPOINT_ID'))
  const endpoints = rawEndpoints.map((endpoint, index) => buildEndpoint(endpoint, index, index === defaultIndex))
  const ids = new Set<string>()

  for (const endpoint of endpoints) {
    if (ids.has(endpoint.id)) {
      fail(`duplicate endpoint id "${endpoint.id}"`)
    }
    ids.add(endpoint.id)
  }

  return {
    endpoints,
    defaultEndpoint: endpoints[defaultIndex],
  }
}

export function getConfiguredDefaultPortalEndpoint(env: NodeJS.ProcessEnv = process.env): PortalEndpoint {
  return loadPortalEndpointConfig(env).defaultEndpoint
}

export function getDefaultPortalEndpoint(env: NodeJS.ProcessEnv = process.env): PortalEndpoint {
  if (env === process.env) {
    return activePortalEndpoint.getStore() ?? getConfiguredDefaultPortalEndpoint(env)
  }
  return getConfiguredDefaultPortalEndpoint(env)
}

export function getPortalEndpointById(id: string, env: NodeJS.ProcessEnv = process.env): PortalEndpoint | undefined {
  const configured = loadPortalEndpointConfig(env).endpoints.find((endpoint) => endpoint.id === id)
  if (configured) return configured

  if (id.startsWith(DYNAMIC_DEDICATED_ENDPOINT_ID_PREFIX)) {
    return buildDynamicDedicatedEndpoint(id.slice(DYNAMIC_DEDICATED_ENDPOINT_ID_PREFIX.length), env)
  }

  return undefined
}

export function getPortalEndpointByHost(host: string | undefined, env: NodeJS.ProcessEnv = process.env): PortalEndpoint | undefined {
  if (!host) return undefined

  let normalized: string
  try {
    normalized = normalizeHostname(host, 'host')
  } catch {
    return undefined
  }

  return loadPortalEndpointConfig(env).endpoints.find((endpoint) => endpoint.hostnames.includes(normalized))
    ?? buildDynamicDedicatedEndpoint(normalized, env)
}

export function runWithPortalEndpoint<T>(endpoint: PortalEndpoint, callback: () => T): T {
  return activePortalEndpoint.run(endpoint, callback)
}

export function portalEndpointKey(endpoint: PortalEndpoint): string {
  const tenantPart = endpoint.tenantId
    ? `tenant:${hashString53(endpoint.tenantId).toString(36)}`
    : ''

  return [
    endpoint.id,
    endpoint.endpointClass,
    endpoint.tenantScope,
    tenantPart,
  ].join(':')
}

function safeEndpointId(endpoint: PortalEndpoint): string {
  if (endpoint.id.startsWith(DYNAMIC_DEDICATED_ENDPOINT_ID_PREFIX)) {
    return `${DYNAMIC_DEDICATED_ENDPOINT_ID_PREFIX}${hashString53(endpoint.id).toString(36)}`
  }
  return endpoint.id
}

function safeEndpointLabel(endpoint: PortalEndpoint): string {
  if (!endpoint.id.startsWith(DYNAMIC_DEDICATED_ENDPOINT_ID_PREFIX)) {
    return endpoint.label
  }
  return endpoint.endpointClass === 'internal' ? 'Internal Portal' : 'Dedicated Portal'
}

function safePortalEndpointKey(endpoint: PortalEndpoint): string {
  const rawKey = portalEndpointKey(endpoint)
  if (!endpoint.id.startsWith(DYNAMIC_DEDICATED_ENDPOINT_ID_PREFIX)) {
    return rawKey
  }
  return rawKey.replace(endpoint.id, safeEndpointId(endpoint))
}

export function getSafePortalEndpointMetadata(endpoint: PortalEndpoint = getDefaultPortalEndpoint()): SafePortalEndpointMetadata {
  const metadata: SafePortalEndpointMetadata = {
    id: safeEndpointId(endpoint),
    label: safeEndpointLabel(endpoint),
    endpoint_class: endpoint.endpointClass,
    tenant_scope: endpoint.tenantScope,
    auth_mode: endpoint.auth.mode,
    auth_required: endpoint.auth.mode !== 'none',
    is_default: endpoint.isDefault,
    cache_scope: safePortalEndpointKey(endpoint),
  }

  if (endpoint.tenantId) {
    metadata.tenant_key = hashString53(endpoint.tenantId).toString(36)
  }

  return metadata
}

export function buildPortalUrl(path: string, endpoint: PortalEndpoint = getDefaultPortalEndpoint()): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${endpoint.baseUrl}${normalizedPath}`
}
