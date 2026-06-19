#!/usr/bin/env tsx

import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import { authenticateMcpBearerToken } from '../src/auth/mcp.js'
import { getPortalEndpointById } from '../src/portal/endpoints.js'

const PORT = 3198
const BASE_URL = `http://localhost:${PORT}`

let child: ChildProcessWithoutNullStreams | undefined
const stderrChunks: string[] = []

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseSseJson(text: string) {
  const dataLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data: '))
  assert(dataLine, `Expected SSE data line, got: ${text.slice(0, 240)}`)
  return JSON.parse(dataLine.slice('data: '.length))
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`)
      if (response.ok) return
    } catch {
      // keep polling until ready
    }
    await sleep(150)
  }
  throw new Error('HTTP auth test server did not become healthy')
}

async function postRpc(params: {
  id: number
  method: string
  rpcParams?: Record<string, unknown>
  token?: string
  sessionId?: string
  headers?: Record<string, string>
}) {
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      ...(params.sessionId ? { 'x-mcp-session-id': params.sessionId } : {}),
      ...(params.headers ?? {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: params.id, method: params.method, params: params.rpcParams ?? {} }),
  })
  const text = await response.text()
  return { response, text }
}

function getToolEvents(): Record<string, any>[] {
  return stderrChunks
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line)
        return parsed?.event === 'mcp_tool_call' ? [parsed] : []
      } catch {
        return []
      }
    })
}

function assertUnitAuth() {
  const staticAuth = authenticateMcpBearerToken('static-secret', {
    MCP_HTTP_BEARER_TOKEN: 'static-secret',
  })
  assert.equal(staticAuth.ok, true)
  assert.equal(staticAuth.ok && staticAuth.context.mode, 'static')
  assert.equal(staticAuth.ok && staticAuth.context.scopes.includes('*'), true)

  const hostedEnv = {
    PORTAL_ENDPOINTS: JSON.stringify([
      { id: 'public', baseUrl: 'https://portal.sqd.dev' },
      {
        id: 'enterprise-prod',
        baseUrl: 'https://enterprise.portal.example.com',
        endpointClass: 'enterprise',
        tenantScope: 'tenant',
        tenantId: 'endpoint-tenant-secret',
        authMode: 'api_key',
        tokenEnv: 'ENTERPRISE_PORTAL_API_KEY',
      },
    ]),
    MCP_AUTH_KEYS: JSON.stringify([
      {
        id: 'enterprise-user-key',
        audience: 'portal-mcp',
        tokenSha256: sha256Hex('hosted-secret'),
        principalId: 'user:alex',
        tenantId: 'runtime-tenant-secret',
        endpointId: 'enterprise-prod',
        scopes: ['mcp:invoke'],
        credentialPolicy: 'tenant_portal_endpoint',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      {
        id: 'viewer-key',
        audience: 'portal-mcp',
        tokenSha256: sha256Hex('viewer-secret'),
        principalId: 'user:viewer',
        endpointId: 'enterprise-prod',
        scopes: ['mcp:read'],
      },
      {
        id: 'revoked-key',
        audience: 'portal-mcp',
        tokenSha256: sha256Hex('revoked-secret'),
        principalId: 'user:revoked',
        endpointId: 'enterprise-prod',
        scopes: ['mcp:invoke'],
        status: 'revoked',
      },
      {
        id: 'expired-key',
        audience: 'portal-mcp',
        tokenSha256: sha256Hex('expired-secret'),
        principalId: 'user:expired',
        endpointId: 'enterprise-prod',
        scopes: ['mcp:invoke'],
        expiresAt: '2000-01-01T00:00:00.000Z',
      },
    ]),
  }

  const hostedAuth = authenticateMcpBearerToken('hosted-secret', hostedEnv)
  assert.equal(hostedAuth.ok, true)
  assert.equal(hostedAuth.ok && hostedAuth.context.mode, 'hosted')
  assert.equal(hostedAuth.ok && hostedAuth.context.principal_id, 'user:alex')
  assert.equal(hostedAuth.ok && hostedAuth.context.endpoint.id, 'enterprise-prod')
  assert.equal(hostedAuth.ok && hostedAuth.context.audience, 'portal-mcp')
  assert.equal(hostedAuth.ok && hostedAuth.context.tenant_id, 'runtime-tenant-secret')
  assert.match((hostedAuth.ok && hostedAuth.context.tenant_key) || '', /^[a-z0-9]+$/)
  assert.notEqual(hostedAuth.ok && hostedAuth.context.tenant_key, 'runtime-tenant-secret')
  assert.equal(hostedAuth.ok && hostedAuth.context.credential_policy, 'tenant_portal_endpoint')
  assert.equal(hostedAuth.ok && hostedAuth.context.expires_at, '2099-01-01T00:00:00.000Z')

  const publicEndpoint = getPortalEndpointById('public', hostedEnv)
  assert(publicEndpoint)
  const hostedAuthThroughPublicHost = authenticateMcpBearerToken('hosted-secret', hostedEnv, publicEndpoint)
  assert.equal(hostedAuthThroughPublicHost.ok, false)
  assert.equal(!hostedAuthThroughPublicHost.ok && hostedAuthThroughPublicHost.status, 401)

  const enterpriseEndpoint = getPortalEndpointById('enterprise-prod', hostedEnv)
  assert(enterpriseEndpoint)
  const hostedAuthThroughEnterpriseHost = authenticateMcpBearerToken('hosted-secret', hostedEnv, enterpriseEndpoint)
  assert.equal(hostedAuthThroughEnterpriseHost.ok, true)

  const insufficientScope = authenticateMcpBearerToken('viewer-secret', hostedEnv)
  assert.equal(insufficientScope.ok, false)
  assert.equal(!insufficientScope.ok && insufficientScope.status, 403)
  assert.equal(!insufficientScope.ok && insufficientScope.message.includes('tenant-example'), false)

  const badToken = authenticateMcpBearerToken('wrong-token-value', hostedEnv)
  assert.equal(badToken.ok, false)
  assert.equal(!badToken.ok && badToken.status, 401)
  assert.equal(!badToken.ok && badToken.message.includes('wrong-token-value'), false)

  const revoked = authenticateMcpBearerToken('revoked-secret', hostedEnv)
  assert.equal(revoked.ok, false)
  assert.equal(!revoked.ok && revoked.status, 401)

  const expired = authenticateMcpBearerToken('expired-secret', hostedEnv)
  assert.equal(expired.ok, false)
  assert.equal(!expired.ok && expired.status, 401)

  const invalidAudience = authenticateMcpBearerToken('secret', {
    MCP_AUTH_KEYS: JSON.stringify([
      {
        id: 'gateway-key',
        audience: 'gateway',
        tokenSha256: sha256Hex('secret'),
        principalId: 'user:gateway',
      },
    ]),
  })
  assert.equal(invalidAudience.ok, false)
  assert.equal(!invalidAudience.ok && invalidAudience.status, 500)
}

async function assertHostedHttpAuth() {
  child = spawn('node', ['dist/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      OBS_LOG_JSON: 'true',
      MCP_TRUST_FORWARDED_HOST: 'true',
      MCP_AUTH_KEYS: JSON.stringify([
        {
          id: 'enterprise-user-key',
          audience: 'portal-mcp',
          tokenSha256: sha256Hex('hosted-secret'),
          principalId: 'user:alex',
          tenantId: 'runtime-tenant-secret',
          endpointId: 'enterprise-prod',
          scopes: ['mcp:invoke'],
          credentialPolicy: 'tenant_portal_endpoint',
          status: 'active',
        },
        {
          id: 'viewer-key',
          audience: 'portal-mcp',
          tokenSha256: sha256Hex('viewer-secret'),
          principalId: 'user:viewer',
          endpointId: 'enterprise-prod',
          scopes: ['mcp:read'],
        },
      ]),
      PORTAL_ENDPOINTS: JSON.stringify([
        { id: 'public', baseUrl: 'https://portal.sqd.dev' },
        {
          id: 'enterprise-prod',
          baseUrl: 'https://portal.sqd.dev',
          label: 'Enterprise safe label',
          endpointClass: 'enterprise',
          tenantScope: 'tenant',
          tenantId: 'endpoint-tenant-secret',
          authMode: 'api_key',
          tokenEnv: 'ENTERPRISE_PORTAL_API_KEY',
        },
      ]),
      ENTERPRISE_PORTAL_API_KEY: 'enterprise-outbound-secret',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    stderrChunks.push(text)
    if (!text.includes('"event":"mcp_tool_call"')) {
      process.stderr.write(chunk)
    }
  })

  await waitForHealth()

  const missing = await postRpc({ id: 1, method: 'tools/list' })
  assert.equal(missing.response.status, 401)
  assert.equal(JSON.parse(missing.text).error.message, 'Unauthorized.')

  const bad = await postRpc({ id: 2, method: 'tools/list', token: 'bad-hosted-secret' })
  assert.equal(bad.response.status, 401)
  assert.equal(bad.text.includes('bad-hosted-secret'), false)

  const publicHostHostedKey = await postRpc({
    id: 20,
    method: 'tools/list',
    token: 'hosted-secret',
    headers: { 'x-forwarded-host': 'portal.sqd.dev' },
  })
  assert.equal(publicHostHostedKey.response.status, 401)

  const scopedOut = await postRpc({ id: 3, method: 'tools/list', token: 'viewer-secret' })
  assert.equal(scopedOut.response.status, 403)
  assert.equal(JSON.parse(scopedOut.text).error.message, 'Insufficient scope for MCP request.')
  assert.equal(scopedOut.text.includes('tenant-example'), false)

  const init = await postRpc({
    id: 4,
    method: 'initialize',
    token: 'hosted-secret',
    sessionId: 'public-session-id-must-not-route',
    rpcParams: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'auth-smoke', version: '1.0.0' },
    },
  })
  assert.equal(init.response.ok, true)
  assert.equal(Boolean(parseSseJson(init.text).error), false)

  const guide = await postRpc({
    id: 5,
    method: 'resources/read',
    token: 'hosted-secret',
    sessionId: 'public-session-id-must-not-route',
    rpcParams: { uri: 'sqd://tools' },
  })
  assert.equal(guide.response.ok, true)
  const guideJson = parseSseJson(guide.text)
  assert.equal(Boolean(guideJson.error), false)
  const payload = JSON.parse(guideJson.result.contents[0].text)
  assert.equal(payload.endpoint.id, 'enterprise-prod')
  assert.equal(payload.endpoint.endpoint_class, 'enterprise')
  assert.match(payload.endpoint.tenant_key, /^[a-z0-9]+$/)
  assert.notEqual(payload.endpoint.tenant_key, 'endpoint-tenant-secret')
  assert.equal(payload.endpoint.auth_required, true)

  const toolCall = await postRpc({
    id: 6,
    method: 'tools/call',
    token: 'hosted-secret',
    sessionId: 'public-session-id-must-not-route',
    rpcParams: {
      name: 'portal_get_head',
      arguments: { network: 'base' },
    },
  })
  assert.equal(toolCall.response.ok, true)
  const toolCallJson = parseSseJson(toolCall.text)
  assert.equal(Boolean(toolCallJson.error), false)
  const headPayload = JSON.parse(toolCallJson.result.content[0].text)
  assert.equal(headPayload._meta.endpoint.id, 'enterprise-prod')
  assert.equal(headPayload._meta.endpoint.endpoint_class, 'enterprise')
  assert.equal(headPayload._meta.endpoint.auth_required, true)
  assert.match(headPayload._meta.endpoint.tenant_key, /^[a-z0-9]+$/)
  assert.notEqual(headPayload._meta.endpoint.tenant_key, 'endpoint-tenant-secret')

  const headEvent = getToolEvents().find((event) => event.tool === 'portal_get_head')
  assert(headEvent, 'Hosted auth should emit a portal_get_head tool event')
  assert.equal(headEvent.endpoint_id, 'enterprise-prod')
  assert.equal(headEvent.endpoint_class, 'enterprise')
  assert.match(headEvent.endpoint_tenant_key, /^[a-z0-9]+$/)
  assert.notEqual(headEvent.endpoint_tenant_key, 'endpoint-tenant-secret')
  assert.equal(headEvent.mcp_auth_mode, 'hosted')
  assert.equal(headEvent.mcp_auth_outcome, 'authorized')
  assert.equal(headEvent.credential_policy, 'tenant_portal_endpoint')
  assert(Array.isArray(headEvent.upstream_portal_status_codes))
  assert(headEvent.upstream_portal_status_codes.includes('200'))

  const serializedEvents = JSON.stringify(getToolEvents())
  assert.equal(serializedEvents.includes('user:alex'), false)
  assert.equal(serializedEvents.includes('runtime-tenant-secret'), false)
  assert.equal(serializedEvents.includes('enterprise-user-key'), false)
  const serializedHeadPayload = JSON.stringify(headPayload)
  assert.equal(serializedHeadPayload.includes('endpoint-tenant-secret'), false)
}

async function main() {
  console.log('Starting MCP auth QA...\n')
  assertUnitAuth()
  await assertHostedHttpAuth()
  console.log('PASS  Static MCP bearer token compatibility')
  console.log('PASS  Hosted MCP key resolves principal, tenant, scopes, policy, and endpoint')
  console.log('PASS  Missing/bad tokens return generic JSON-RPC 401s')
  console.log('PASS  Insufficient hosted scope returns generic JSON-RPC 403')
  console.log('PASS  Session ids are correlation only; hosted endpoint comes from auth context')
  console.log('PASS  Hosted tool events log safe endpoint/auth context without raw principal, tenant, or key ids')
  console.log('\nMCP auth QA passed')
}

main()
  .catch((error) => {
    console.error('MCP auth QA failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    child?.kill()
  })
