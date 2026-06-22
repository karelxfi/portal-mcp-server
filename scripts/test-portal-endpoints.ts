#!/usr/bin/env tsx

import assert from 'node:assert/strict'

import { issueDelegatedMcpSession, runWithDelegatedPortalCredential } from '../src/auth/delegated.js'
import { authenticateMcpBearerToken } from '../src/auth/mcp.js'
import { getDatasets } from '../src/cache/datasets.js'
import { createQueryCache, stableCacheKey } from '../src/cache/query-cache.js'
import { isPortalEndpointUrl, withPortalAuthHeaders } from '../src/portal/client.js'
import { buildPortalUrl, getPortalEndpointByHost, getPortalEndpointById, getSafePortalEndpointMetadata, loadPortalEndpointConfig, portalEndpointKey } from '../src/portal/endpoints.js'

function assertThrowsConfig(message: string, fn: () => unknown) {
  assert.throws(fn, (error: unknown) => {
    assert(error instanceof Error)
    assert.match(error.message, /Invalid Portal endpoint configuration/)
    assert.match(error.message, new RegExp(message))
    return true
  })
}

{
  const config = loadPortalEndpointConfig({})
  assert.equal(config.endpoints.length, 1)
  assert.equal(config.defaultEndpoint.id, 'public')
  assert.equal(config.defaultEndpoint.baseUrl, 'https://portal.sqd.dev')
  assert.equal(config.defaultEndpoint.endpointClass, 'public')
  assert.equal(config.defaultEndpoint.tenantScope, 'public')
  assert.equal(config.defaultEndpoint.auth.mode, 'none')
  assert.equal(buildPortalUrl('/datasets', config.defaultEndpoint), 'https://portal.sqd.dev/datasets')
}

{
  const publicEndpoint = getPortalEndpointByHost('portal.sqd.dev', {})
  assert.equal(publicEndpoint?.id, 'public')
  assert.equal(publicEndpoint?.endpointClass, 'public')
  assert.equal(publicEndpoint?.auth.mode, 'none')

  const dedicatedEndpoint = getPortalEndpointByHost('customer-a.portal.sqd.dev', {})
  assert(dedicatedEndpoint, 'Expected dynamic dedicated endpoint for *.portal.sqd.dev')
  assert.equal(dedicatedEndpoint.id, 'portal:customer-a.portal.sqd.dev')
  assert.equal(dedicatedEndpoint.baseUrl, 'https://customer-a.portal.sqd.dev')
  assert.deepEqual(dedicatedEndpoint.hostnames, ['customer-a.portal.sqd.dev'])
  assert.equal(dedicatedEndpoint.endpointClass, 'enterprise')
  assert.equal(dedicatedEndpoint.tenantScope, 'endpoint')
  assert.equal(dedicatedEndpoint.auth.mode, 'delegated_api_key')
  assert.equal(buildPortalUrl('/datasets', dedicatedEndpoint), 'https://customer-a.portal.sqd.dev/datasets')
  assert.equal(getPortalEndpointById(dedicatedEndpoint.id, {})?.baseUrl, 'https://customer-a.portal.sqd.dev')
  assert.deepEqual(
    withPortalAuthHeaders('https://portal.sqd.dev/datasets', { Accept: 'application/json' }, dedicatedEndpoint, {}),
    { Accept: 'application/json' },
  )

  const dynamicEnv: NodeJS.ProcessEnv = { MCP_DELEGATED_AUTH: 'true' }
  const dynamicSession = issueDelegatedMcpSession({
    endpoint: dedicatedEndpoint,
    apiKey: 'dynamic-dedicated-key',
    env: dynamicEnv,
  })
  const dynamicAuth = authenticateMcpBearerToken(dynamicSession.token, dynamicEnv, dedicatedEndpoint)
  assert.equal(dynamicAuth.ok, true)
  assert.equal(dynamicAuth.ok && dynamicAuth.context.endpoint.baseUrl, 'https://customer-a.portal.sqd.dev')
  assert.deepEqual(
    runWithDelegatedPortalCredential(dynamicAuth.ok ? dynamicAuth.context.delegated_credential_ref : undefined, dedicatedEndpoint, () =>
      withPortalAuthHeaders('https://customer-a.portal.sqd.dev/datasets', { Accept: 'application/json' }, dedicatedEndpoint, dynamicEnv),
    ),
    {
      Accept: 'application/json',
      'X-API-Key': 'dynamic-dedicated-key',
    },
  )

  const secondDynamicSession = issueDelegatedMcpSession({
    endpoint: dedicatedEndpoint,
    apiKey: 'second-dynamic-dedicated-key',
    env: dynamicEnv,
  })
  const secondDynamicAuth = authenticateMcpBearerToken(secondDynamicSession.token, dynamicEnv, dedicatedEndpoint)
  assert.equal(secondDynamicAuth.ok, true)

  const scopedQueryCache = createQueryCache<string>({ ttl: 60_000, maxEntries: 10 })
  let loadCount = 0
  const loadScopedValue = (credentialRef: string | undefined) =>
    runWithDelegatedPortalCredential(credentialRef, dedicatedEndpoint, () =>
      scopedQueryCache.getOrLoad(
        stableCacheKey('delegated-query-cache-test', { dataset: 'ethereum-mainnet', limit: 1 }, dedicatedEndpoint),
        async () => `credential-value-${++loadCount}`,
      ),
    )

  const firstScopedValue = await loadScopedValue(dynamicAuth.ok ? dynamicAuth.context.delegated_credential_ref : undefined)
  const firstScopedValueAgain = await loadScopedValue(dynamicAuth.ok ? dynamicAuth.context.delegated_credential_ref : undefined)
  const secondScopedValue = await loadScopedValue(
    secondDynamicAuth.ok ? secondDynamicAuth.context.delegated_credential_ref : undefined,
  )
  assert.equal(firstScopedValue.source, 'fresh')
  assert.equal(firstScopedValue.value, 'credential-value-1')
  assert.equal(firstScopedValueAgain.source, 'cache')
  assert.equal(firstScopedValueAgain.value, 'credential-value-1')
  assert.equal(secondScopedValue.source, 'fresh')
  assert.equal(secondScopedValue.value, 'credential-value-2')
  assert.equal(loadCount, 2)

  const internalEndpoint = getPortalEndpointByHost('internal-a.portal.sqd.dev', {
    PORTAL_DYNAMIC_INTERNAL_HOSTS: 'internal-a.portal.sqd.dev',
  })
  assert.equal(internalEndpoint?.baseUrl, 'https://internal-a.portal.sqd.dev')
  assert.equal(internalEndpoint?.endpointClass, 'internal')
  assert.equal(internalEndpoint?.tenantScope, 'tenant')

  assert.equal(getPortalEndpointByHost('nested.customer-a.portal.sqd.dev', {}), undefined)
  assert.equal(getPortalEndpointByHost('customer-a.portal.sqd.dev', {
    PORTAL_DYNAMIC_DEDICATED_ENDPOINTS: 'false',
  }), undefined)
}

{
  const config = loadPortalEndpointConfig({
    PORTAL_URL: 'https://internal.portal.example.com',
    PORTAL_ENDPOINT_ID: 'internal-main',
    PORTAL_ENDPOINT_LABEL: 'SQD internal Portal',
    PORTAL_ENDPOINT_CLASS: 'internal',
    PORTAL_ENDPOINT_TENANT_SCOPE: 'tenant',
    PORTAL_ENDPOINT_TENANT_ID: 'sqd',
    PORTAL_ENDPOINT_AUTH_MODE: 'api_key',
    PORTAL_ENDPOINT_TOKEN_ENV: 'SQD_INTERNAL_PORTAL_API_KEY',
    PORTAL_ENDPOINT_API_KEY_HEADER: 'x-api-key',
    PORTAL_ENDPOINT_HOSTNAMES: 'internal-alias.portal.example.com',
  })

  assert.equal(config.defaultEndpoint.endpointClass, 'internal')
  assert.deepEqual(config.defaultEndpoint.hostnames, ['internal-alias.portal.example.com', 'internal.portal.example.com'])
  assert.equal(config.defaultEndpoint.auth.mode, 'api_key')
  assert.equal(config.defaultEndpoint.auth.headerName, 'x-api-key')
  const safeMetadata = getSafePortalEndpointMetadata(config.defaultEndpoint)
  assert.equal(safeMetadata.endpoint_class, 'internal')
  assert.equal(safeMetadata.auth_required, true)
  assert.match(safeMetadata.tenant_key ?? '', /^[a-z0-9]+$/)
}

{
  const config = loadPortalEndpointConfig({
    PORTAL_URL: 'https://enterprise.portal.example.com',
    PORTAL_ENDPOINT_ID: 'enterprise-prod',
    PORTAL_ENDPOINT_LABEL: 'Enterprise production',
    PORTAL_ENDPOINT_TENANT_SCOPE: 'tenant',
    PORTAL_ENDPOINT_TENANT_ID: 'enterprise-tenant',
    PORTAL_ENDPOINT_AUTH_MODE: 'api_key',
    PORTAL_ENDPOINT_TOKEN_ENV: 'ENTERPRISE_PORTAL_API_KEY',
  })

  assert.equal(config.defaultEndpoint.endpointClass, 'enterprise')
  assert.equal(getSafePortalEndpointMetadata(config.defaultEndpoint).endpoint_class, 'enterprise')
}

{
  const config = loadPortalEndpointConfig({
    PORTAL_URL: 'https://enterprise.example.com/portal/',
    PORTAL_ENDPOINT_ID: 'enterprise-prod',
    PORTAL_ENDPOINT_LABEL: 'Enterprise production',
    PORTAL_ENDPOINT_CLASS: 'enterprise',
    PORTAL_ENDPOINT_TENANT_SCOPE: 'organization',
    PORTAL_ENDPOINT_TENANT_ID: 'tenant-example',
    PORTAL_ENDPOINT_AUTH_MODE: 'bearer',
    PORTAL_ENDPOINT_TOKEN_ENV: 'ENTERPRISE_PORTAL_TOKEN',
  })

  assert.equal(config.defaultEndpoint.id, 'enterprise-prod')
  assert.equal(config.defaultEndpoint.baseUrl, 'https://enterprise.example.com/portal')
  assert.equal(config.defaultEndpoint.label, 'Enterprise production')
  assert.equal(config.defaultEndpoint.endpointClass, 'enterprise')
  assert.equal(config.defaultEndpoint.tenantScope, 'organization')
  assert.equal(config.defaultEndpoint.tenantId, 'tenant-example')
  assert.deepEqual(config.defaultEndpoint.auth, {
    mode: 'bearer',
    tokenEnv: 'ENTERPRISE_PORTAL_TOKEN',
    headerName: 'Authorization',
  })
  const endpointKey = portalEndpointKey(config.defaultEndpoint)
  assert.match(endpointKey, /^enterprise-prod:enterprise:organization:tenant:[a-z0-9]+$/)
  assert.notEqual(endpointKey, 'enterprise-prod:enterprise:organization:tenant-example')
  const safeMetadata = getSafePortalEndpointMetadata(config.defaultEndpoint)
  assert.equal(safeMetadata.id, 'enterprise-prod')
  assert.equal(safeMetadata.endpoint_class, 'enterprise')
  assert.equal(safeMetadata.tenant_scope, 'organization')
  assert.equal(safeMetadata.auth_mode, 'bearer')
  assert.equal(safeMetadata.auth_required, true)
  assert.equal(safeMetadata.cache_scope, endpointKey)
  assert.match(safeMetadata.tenant_key ?? '', /^[a-z0-9]+$/)
  assert.notEqual(safeMetadata.tenant_key, 'tenant-example')
  assert(!('tenantId' in safeMetadata), 'Safe endpoint metadata must not expose raw tenant ids')
  assert.equal(isPortalEndpointUrl('https://enterprise.example.com/portal/datasets', config.defaultEndpoint), true)
  assert.equal(isPortalEndpointUrl('https://enterprise.example.com/other/datasets', config.defaultEndpoint), false)
  assert.deepEqual(
    withPortalAuthHeaders(
      'https://enterprise.example.com/portal/datasets',
      { Accept: 'application/json' },
      config.defaultEndpoint,
      { ENTERPRISE_PORTAL_TOKEN: 'super-secret' },
    ),
    {
      Accept: 'application/json',
      Authorization: 'Bearer super-secret',
    },
  )
  assert.deepEqual(
    withPortalAuthHeaders(
      'https://public.example.com/datasets',
      { Accept: 'application/json' },
      config.defaultEndpoint,
      { ENTERPRISE_PORTAL_TOKEN: 'super-secret' },
    ),
    {
      Accept: 'application/json',
    },
  )
}

{
  const config = loadPortalEndpointConfig({
    PORTAL_ENDPOINTS: JSON.stringify([
      { id: 'public', baseUrl: 'https://portal.sqd.dev', label: 'Public Portal' },
      {
        id: 'enterprise-prod',
        baseUrl: 'https://enterprise.portal.example.com',
        label: 'Enterprise production',
        endpointClass: 'enterprise',
        tenantScope: 'tenant',
        tenantId: 'tenant-example',
        authMode: 'api_key',
        tokenEnv: 'ENTERPRISE_PORTAL_API_KEY',
        headerName: 'X-SQD-API-Key',
        hostnames: ['dedicated.portal.example.com'],
      },
    ]),
    PORTAL_DEFAULT_ENDPOINT_ID: 'enterprise-prod',
  })

  assert.equal(config.endpoints.length, 2)
  assert.equal(config.defaultEndpoint.id, 'enterprise-prod')
  assert.equal(getPortalEndpointByHost('dedicated.portal.example.com', {
    PORTAL_ENDPOINTS: JSON.stringify([
      { id: 'public', baseUrl: 'https://portal.sqd.dev', label: 'Public Portal' },
      {
        id: 'enterprise-prod',
        baseUrl: 'https://enterprise.portal.example.com',
        label: 'Enterprise production',
        endpointClass: 'enterprise',
        tenantScope: 'tenant',
        tenantId: 'tenant-example',
        authMode: 'api_key',
        tokenEnv: 'ENTERPRISE_PORTAL_API_KEY',
        hostnames: ['dedicated.portal.example.com'],
      },
    ]),
  })?.id, 'enterprise-prod')
  assert.equal(getPortalEndpointByHost('dedicated.portal.example.com:443', {
    PORTAL_ENDPOINTS: JSON.stringify([
      { id: 'public', baseUrl: 'https://portal.sqd.dev', label: 'Public Portal' },
      {
        id: 'enterprise-prod',
        baseUrl: 'https://enterprise.portal.example.com',
        label: 'Enterprise production',
        endpointClass: 'enterprise',
        tenantScope: 'tenant',
        tenantId: 'tenant-example',
        authMode: 'api_key',
        tokenEnv: 'ENTERPRISE_PORTAL_API_KEY',
        hostnames: 'dedicated.portal.example.com',
      },
    ]),
  })?.id, 'enterprise-prod')
  assert.equal(config.defaultEndpoint.auth.mode, 'api_key')
  assert.equal(config.defaultEndpoint.auth.headerName, 'X-SQD-API-Key')
  assert.equal(config.endpoints[0].isDefault, false)
  assert.equal(config.endpoints[1].isDefault, true)
  assert.deepEqual(
    withPortalAuthHeaders(
      'https://enterprise.portal.example.com/datasets',
      { Accept: 'application/json' },
      config.defaultEndpoint,
      { ENTERPRISE_PORTAL_API_KEY: 'api-key-secret' },
    ),
    {
      Accept: 'application/json',
      'X-SQD-API-Key': 'api-key-secret',
    },
  )
}

{
  const config = loadPortalEndpointConfig({
    PORTAL_ENDPOINTS: JSON.stringify([
      {
        id: 'sqd-internal',
        portalBaseUrl: 'https://upstream.portal.example.com',
        mcpHostnames: ['sqd.portal.example.com'],
        endpointClass: 'internal',
        tenantScope: 'tenant',
        tenantId: 'sqd',
        authMode: 'delegated_api_key',
        headerName: 'x-api-key',
      },
    ]),
  })
  assert.equal(config.defaultEndpoint.baseUrl, 'https://upstream.portal.example.com')
  assert.deepEqual(config.defaultEndpoint.hostnames, ['sqd.portal.example.com', 'upstream.portal.example.com'])
  assert.equal(getPortalEndpointByHost('sqd.portal.example.com', {
    PORTAL_ENDPOINTS: JSON.stringify([
      {
        id: 'sqd-internal',
        portalBaseUrl: 'https://upstream.portal.example.com',
        mcpHostnames: ['sqd.portal.example.com'],
        endpointClass: 'internal',
        authMode: 'delegated_api_key',
      },
    ]),
  })?.id, 'sqd-internal')
}

{
  const env = {
    PORTAL_URL: 'https://internal.portal.example.com',
    PORTAL_ENDPOINT_ID: 'sqd-internal',
    PORTAL_ENDPOINT_LABEL: 'SQD internal Portal',
    PORTAL_ENDPOINT_CLASS: 'internal',
    PORTAL_ENDPOINT_TENANT_SCOPE: 'tenant',
    PORTAL_ENDPOINT_TENANT_ID: 'sqd',
    PORTAL_ENDPOINT_AUTH_MODE: 'delegated_api_key',
    PORTAL_ENDPOINT_API_KEY_HEADER: 'x-api-key',
    PORTAL_ENDPOINT_HOSTNAMES: 'sqd.portal.example.com',
    MCP_DELEGATED_AUTH: 'true',
  }
  const config = loadPortalEndpointConfig(env)
  const endpoint = config.defaultEndpoint
  assert.equal(endpoint.auth.mode, 'delegated_api_key')
  assert.equal(endpoint.auth.headerName, 'x-api-key')
  assert.equal(endpoint.auth.tokenEnv, undefined)

  assert.throws(
    () => withPortalAuthHeaders('https://internal.portal.example.com/datasets', { Accept: 'application/json' }, endpoint, env),
    /Delegated Portal credential is not available/,
  )

  const session = issueDelegatedMcpSession({
    endpoint,
    apiKey: 'delegated-portal-key',
    env,
  })
  assert.match(session.token, /^mcp_/)
  const auth = authenticateMcpBearerToken(session.token, env, endpoint)
  assert.equal(auth.ok, true)
  assert.equal(auth.ok && auth.context.mode, 'delegated')
  assert.equal(auth.ok && auth.context.credential_policy, 'delegated_portal_api_key')
  assert.deepEqual(
    runWithDelegatedPortalCredential(auth.ok ? auth.context.delegated_credential_ref : undefined, endpoint, () =>
      withPortalAuthHeaders('https://internal.portal.example.com/datasets', { Accept: 'application/json' }, endpoint, env),
    ),
    {
      Accept: 'application/json',
      'x-api-key': 'delegated-portal-key',
    },
  )
}

assertThrowsConfig('query strings', () => loadPortalEndpointConfig({ PORTAL_URL: 'https://portal.sqd.dev?token=secret' }))
assertThrowsConfig('credentials', () => loadPortalEndpointConfig({ PORTAL_URL: 'https://user:pass@portal.sqd.dev' }))
assertThrowsConfig('endpointClass must be one of: public, internal, enterprise', () =>
  loadPortalEndpointConfig({
    PORTAL_URL: 'https://custom.example.com',
    PORTAL_ENDPOINT_CLASS: 'custom',
  }),
)
assertThrowsConfig('authMode must be bearer, api_key, or delegated_api_key', () =>
  loadPortalEndpointConfig({
    PORTAL_URL: 'https://enterprise.portal.example.com',
  }),
)
assertThrowsConfig('authMode must be none for public endpoints', () =>
  loadPortalEndpointConfig({
    PORTAL_ENDPOINT_CLASS: 'public',
    PORTAL_ENDPOINT_AUTH_MODE: 'bearer',
    PORTAL_ENDPOINT_TOKEN_ENV: 'PUBLIC_PORTAL_TOKEN',
  }),
)
assertThrowsConfig('tokenEnv', () =>
  loadPortalEndpointConfig({
    PORTAL_ENDPOINT_AUTH_MODE: 'bearer',
  }),
)
assertThrowsConfig('baseUrl must use https', () =>
  loadPortalEndpointConfig({
    PORTAL_URL: 'http://enterprise.portal.example.com',
    PORTAL_ENDPOINT_ID: 'enterprise-prod',
    PORTAL_ENDPOINT_CLASS: 'enterprise',
    PORTAL_ENDPOINT_AUTH_MODE: 'bearer',
    PORTAL_ENDPOINT_TOKEN_ENV: 'ENTERPRISE_PORTAL_TOKEN',
  }),
)
assertThrowsConfig('must reference secrets', () =>
  loadPortalEndpointConfig({
    PORTAL_ENDPOINTS: JSON.stringify([
      {
        id: 'bad',
        baseUrl: 'https://bad.example.com',
        authMode: 'bearer',
        token: 'secret',
      },
    ]),
  }),
)

assert.throws(
  () => {
    const endpoint = loadPortalEndpointConfig({
      PORTAL_URL: 'https://enterprise.example.com',
      PORTAL_ENDPOINT_ID: 'missing-secret',
      PORTAL_ENDPOINT_AUTH_MODE: 'bearer',
      PORTAL_ENDPOINT_TOKEN_ENV: 'MISSING_PORTAL_TOKEN',
    }).defaultEndpoint

    withPortalAuthHeaders('https://enterprise.example.com/datasets', {}, endpoint, {})
  },
  (error: unknown) => {
    assert(error instanceof Error)
    assert.match(error.message, /MISSING_PORTAL_TOKEN/)
    assert.doesNotMatch(error.message, /Bearer/)
    return true
  },
)

{
  const endpoint = getPortalEndpointByHost('cache-a.portal.sqd.dev', {})
  assert(endpoint)
  const env: NodeJS.ProcessEnv = { MCP_DELEGATED_AUTH: 'true' }
  const firstSession = issueDelegatedMcpSession({ endpoint, apiKey: 'first-delegated-key', env })
  const secondSession = issueDelegatedMcpSession({ endpoint, apiKey: 'second-delegated-key', env })
  const firstAuth = authenticateMcpBearerToken(firstSession.token, env, endpoint)
  const secondAuth = authenticateMcpBearerToken(secondSession.token, env, endpoint)
  assert.equal(firstAuth.ok, true)
  assert.equal(secondAuth.ok, true)

  const fetchKeys: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined
    const key = headers?.['X-API-Key'] ?? headers?.['x-api-key'] ?? ''
    fetchKeys.push(key)
    const dataset = key === 'first-delegated-key' ? 'private-a' : 'private-b'
    return new Response(JSON.stringify([
      {
        dataset,
        aliases: [],
        real_time: true,
        metadata: { kind: 'evm' },
        schema: { tables: { blocks: {} } },
      },
    ]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const firstDatasets = await runWithDelegatedPortalCredential(
      firstAuth.ok ? firstAuth.context.delegated_credential_ref : undefined,
      endpoint,
      () => getDatasets(endpoint),
    )
    const secondDatasets = await runWithDelegatedPortalCredential(
      secondAuth.ok ? secondAuth.context.delegated_credential_ref : undefined,
      endpoint,
      () => getDatasets(endpoint),
    )

    assert.equal(firstDatasets[0]?.dataset, 'private-a')
    assert.equal(secondDatasets[0]?.dataset, 'private-b')
    assert.deepEqual(fetchKeys, ['first-delegated-key', 'second-delegated-key'])
  } finally {
    globalThis.fetch = originalFetch
  }
}

console.log('Portal endpoint configuration tests passed')
