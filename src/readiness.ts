import { getMcpAuthConfigurationStatus } from './auth/mcp.js'
import { hasConfiguredCursorSecret } from './helpers/pagination.js'
import { getObservabilityStatus } from './observability.js'
import { withPortalAuthHeaders } from './portal/client.js'
import {
  type PortalEndpoint,
  type SafePortalEndpointMetadata,
  buildPortalUrl,
  getSafePortalEndpointMetadata,
  loadPortalEndpointConfig,
} from './portal/endpoints.js'
import { npmVersion } from './version.js'

type ReadinessCheckStatus = 'ok' | 'warning' | 'error' | 'skipped'

interface ReadinessCheck {
  name: string
  status: ReadinessCheckStatus
  required: boolean
  message: string
  details?: Record<string, unknown>
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready'
  version: string
  checked_at: string
  strict: boolean
  endpoint?: SafePortalEndpointMetadata
  observability: ReturnType<typeof getObservabilityStatus>
  checks: ReadinessCheck[]
}

const DEFAULT_PORTAL_TIMEOUT_MS = 2500

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

function isStrictReadiness(env: NodeJS.ProcessEnv): boolean {
  return readBool(env, 'MCP_READINESS_STRICT') || env.NODE_ENV === 'production'
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/https?:\/\/[^\s"']+/g, '[redacted-url]')
}

function buildReport(params: {
  strict: boolean
  endpoint?: SafePortalEndpointMetadata
  checks: ReadinessCheck[]
}): ReadinessReport {
  const hasRequiredError = params.checks.some((check) => check.required && check.status === 'error')
  return {
    status: hasRequiredError ? 'not_ready' : 'ready',
    version: npmVersion,
    checked_at: new Date().toISOString(),
    strict: params.strict,
    ...(params.endpoint ? { endpoint: params.endpoint } : {}),
    observability: getObservabilityStatus(),
    checks: params.checks,
  }
}

function checkCursorSecret(env: NodeJS.ProcessEnv, strict: boolean): ReadinessCheck {
  const required = strict || readBool(env, 'MCP_REQUIRE_CURSOR_SECRET')
  const configured = hasConfiguredCursorSecret(env)

  if (configured) {
    return {
      name: 'cursor_secret',
      status: 'ok',
      required,
      message: 'MCP_CURSOR_SECRET is configured.',
    }
  }

  return {
    name: 'cursor_secret',
    status: required ? 'error' : 'warning',
    required,
    message: required
      ? 'MCP_CURSOR_SECRET is required for this deployment.'
      : 'MCP_CURSOR_SECRET is not set; pagination cursors use the local-development fallback.',
  }
}

function checkMcpAuth(env: NodeJS.ProcessEnv, strict: boolean): ReadinessCheck {
  const required = strict || readBool(env, 'MCP_REQUIRE_AUTH')
  const auth = getMcpAuthConfigurationStatus(env)
  const details = {
    mode: auth.mode,
    required_scope: auth.required_scope,
    hosted_key_count: auth.hosted_key_count,
    missing_hosted_secret_count: auth.missing_hosted_secret_count,
    endpoint_scope_count: auth.endpoint_keys.length,
    delegated_enabled: auth.delegated_enabled,
  }

  if (!auth.ok) {
    return {
      name: 'mcp_auth',
      status: 'error',
      required: true,
      message: auth.error ?? 'MCP auth configuration is invalid.',
      details,
    }
  }

  if (auth.protected) {
    return {
      name: 'mcp_auth',
      status: 'ok',
      required,
      message: `MCP POST requests are protected by ${auth.mode} auth.`,
      details,
    }
  }

  return {
    name: 'mcp_auth',
    status: required ? 'error' : 'warning',
    required,
    message: required
      ? 'MCP auth is required but neither MCP_HTTP_BEARER_TOKEN nor MCP_AUTH_KEYS is configured.'
      : 'MCP auth is not configured; HTTP MCP POST requests are anonymous.',
    details,
  }
}

function checkMetricsProtection(env: NodeJS.ProcessEnv, strict: boolean): ReadinessCheck {
  const publicMetrics = readBool(env, 'METRICS_PUBLIC')
  const hasBearerToken = Boolean(readEnv(env, 'METRICS_BEARER_TOKEN'))
  const required = strict || readBool(env, 'MCP_REQUIRE_METRICS_PROTECTION')

  if (hasBearerToken) {
    return {
      name: 'metrics_protection',
      status: 'ok',
      required,
      message: 'METRICS_BEARER_TOKEN protects /metrics.',
      details: { public: publicMetrics, protected_by: 'bearer' },
    }
  }

  if (publicMetrics) {
    return {
      name: 'metrics_protection',
      status: required ? 'error' : 'warning',
      required,
      message: 'METRICS_PUBLIC exposes /metrics without bearer auth.',
      details: { public: true, protected_by: 'none' },
    }
  }

  return {
    name: 'metrics_protection',
    status: 'ok',
    required,
    message: '/metrics is hidden unless METRICS_BEARER_TOKEN is configured.',
    details: { public: false, protected_by: 'hidden' },
  }
}

async function checkPortalReachability(
  endpoint: PortalEndpoint,
  env: NodeJS.ProcessEnv,
  strict: boolean,
): Promise<ReadinessCheck> {
  const enabled = readBool(env, 'MCP_READY_CHECK_PORTAL', true)
  const required = strict || endpoint.auth.mode !== 'none' || readBool(env, 'MCP_READY_REQUIRE_PORTAL')
  const details = {
    endpoint_id: endpoint.id,
    endpoint_class: endpoint.endpointClass,
    auth_mode: endpoint.auth.mode,
  }

  if (endpoint.auth.mode === 'delegated_api_key') {
    return {
      name: 'portal_reachability',
      status: 'skipped',
      required: false,
      message: 'Portal reachability is checked when a user submits a delegated Portal API key.',
      details,
    }
  }

  if (!enabled) {
    return {
      name: 'portal_reachability',
      status: 'skipped',
      required: false,
      message: 'Portal reachability check is disabled by MCP_READY_CHECK_PORTAL=false.',
      details,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), readPositiveInteger(env, 'MCP_READY_PORTAL_TIMEOUT_MS', DEFAULT_PORTAL_TIMEOUT_MS))

  try {
    const url = buildPortalUrl('/datasets', endpoint)
    const response = await fetch(url, {
      method: 'GET',
      headers: withPortalAuthHeaders(url, { Accept: 'application/json' }, endpoint, env),
      signal: controller.signal,
    })

    if (response.ok) {
      return {
        name: 'portal_reachability',
        status: 'ok',
        required,
        message: 'Default Portal endpoint is reachable.',
        details: { ...details, status_code: response.status },
      }
    }

    const authMessage = response.status === 401 || response.status === 403
      ? 'Default Portal endpoint rejected the configured outbound auth.'
      : `Default Portal endpoint returned HTTP ${response.status}.`

    return {
      name: 'portal_reachability',
      status: required ? 'error' : 'warning',
      required,
      message: authMessage,
      details: { ...details, status_code: response.status },
    }
  } catch (error) {
    return {
      name: 'portal_reachability',
      status: required ? 'error' : 'warning',
      required,
      message: `Default Portal endpoint is not reachable: ${sanitizeError(error)}`,
      details,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function getReadinessReport(env: NodeJS.ProcessEnv = process.env, endpointOverride?: PortalEndpoint): Promise<ReadinessReport> {
  const strict = isStrictReadiness(env)
  const checks: ReadinessCheck[] = []

  let endpoint: PortalEndpoint
  let safeEndpoint: SafePortalEndpointMetadata | undefined
  try {
    const endpointConfig = loadPortalEndpointConfig(env)
    endpoint = endpointOverride ?? endpointConfig.defaultEndpoint
    safeEndpoint = getSafePortalEndpointMetadata(endpoint)
    checks.push({
      name: 'portal_endpoint_config',
      status: 'ok',
      required: true,
      message: 'Default Portal endpoint configuration is valid.',
      details: {
        endpoint_count: endpointConfig.endpoints.length,
      },
    })
  } catch (error) {
    checks.push({
      name: 'portal_endpoint_config',
      status: 'error',
      required: true,
      message: sanitizeError(error),
    })
    return buildReport({ strict, checks })
  }

  checks.push(checkCursorSecret(env, strict))
  checks.push(checkMcpAuth(env, strict))
  checks.push(checkMetricsProtection(env, strict))
  checks.push(await checkPortalReachability(endpoint, env, strict))

  return buildReport({ strict, endpoint: safeEndpoint, checks })
}
