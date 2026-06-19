import { getActiveDelegatedPortalApiKey } from '../auth/delegated.js'
import { type PortalEndpoint, getDefaultPortalEndpoint } from './endpoints.js'

type HeaderMap = Record<string, string>

function endpointPathPrefix(endpoint: PortalEndpoint): string {
  const pathname = new URL(endpoint.baseUrl).pathname
  return pathname === '/' ? '' : pathname.replace(/\/+$/, '')
}

export function isPortalEndpointUrl(url: string, endpoint: PortalEndpoint = getDefaultPortalEndpoint()): boolean {
  let requestUrl: URL
  let endpointUrl: URL

  try {
    requestUrl = new URL(url)
    endpointUrl = new URL(endpoint.baseUrl)
  } catch {
    return false
  }

  if (requestUrl.origin !== endpointUrl.origin) {
    return false
  }

  const prefix = endpointPathPrefix(endpoint)
  if (!prefix) return true

  return requestUrl.pathname === prefix || requestUrl.pathname.startsWith(`${prefix}/`)
}

function readPortalCredential(endpoint: PortalEndpoint, env: NodeJS.ProcessEnv): string {
  if (endpoint.auth.mode === 'delegated_api_key') {
    const delegatedCredential = getActiveDelegatedPortalApiKey(endpoint)
    if (!delegatedCredential) {
      throw new Error(`Delegated Portal credential is not available for endpoint "${endpoint.id}"`)
    }
    return delegatedCredential
  }

  const tokenEnv = endpoint.auth.tokenEnv
  if (!tokenEnv) {
    throw new Error(`Portal endpoint "${endpoint.id}" auth mode "${endpoint.auth.mode}" is missing tokenEnv`)
  }

  const value = env[tokenEnv]
  if (!value) {
    throw new Error(`Missing Portal credential environment variable "${tokenEnv}" for endpoint "${endpoint.id}"`)
  }

  return value
}

export function withPortalAuthHeaders(
  url: string,
  headers: HeaderMap,
  endpoint: PortalEndpoint = getDefaultPortalEndpoint(),
  env: NodeJS.ProcessEnv = process.env,
): HeaderMap {
  if (!isPortalEndpointUrl(url, endpoint) || endpoint.auth.mode === 'none') {
    return { ...headers }
  }

  const credential = readPortalCredential(endpoint, env)

  if (endpoint.auth.mode === 'bearer') {
    return {
      ...headers,
      Authorization: `Bearer ${credential}`,
    }
  }

  return {
    ...headers,
    [endpoint.auth.headerName ?? 'X-API-Key']: credential,
  }
}
