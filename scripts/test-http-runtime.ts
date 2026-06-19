#!/usr/bin/env tsx

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 3197
const BASE_URL = `http://localhost:${PORT}`
const METRICS_TOKEN = 'test-metrics-token'
const MCP_TOKEN = 'test-mcp-token'
const OBS_USER_QUERY_SECRET = 'obs-user-query-secret'
const OBS_USER_QUERY_BEARER = 'obs-user-query-bearer'
const OBS_USER_QUERY = `show https://example.test/path?access_token=${OBS_USER_QUERY_SECRET} with Authorization: Bearer ${OBS_USER_QUERY_BEARER}`
const CLIENT_HEADER_SECRET = `client-header-${'a'.repeat(48)}`

let child: ChildProcessWithoutNullStreams | undefined
const stderrChunks: string[] = []

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`)
      if (response.ok) return
    } catch {
      // keep polling until the child is ready
    }
    await sleep(150)
  }
  throw new Error('HTTP server did not become healthy')
}

function parseSseJson(text: string) {
  const dataLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data: '))
  assert(Boolean(dataLine), `Expected SSE data line, got: ${text.slice(0, 240)}`)
  return JSON.parse(dataLine!.slice('data: '.length))
}

async function postRpc(id: number, method: string, params: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${MCP_TOKEN}`,
      'x-mcp-client-name': 'metrics-smoke',
      'x-mcp-client-version': '1.0.0',
      'x-mcp-user-query': OBS_USER_QUERY,
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const text = await response.text()
  assert(response.ok, `RPC ${method} should return HTTP 2xx, got ${response.status}: ${text.slice(0, 240)}`)
  const parsed = parseSseJson(text)
  assert(!parsed.error, `RPC ${method} returned JSON-RPC error: ${JSON.stringify(parsed.error)}`)
  return parsed
}

async function assertMcpHttpAuth() {
  const health = await fetch(`${BASE_URL}/health`)
  assert(health.ok, `Public /health should stay reachable, got ${health.status}`)
  const healthText = await health.text()
  assert(!healthText.includes('https://portal.sqd.dev'), '/health should not expose the Portal base URL')

  const readyHead = await fetch(`${BASE_URL}/ready`, { method: 'HEAD' })
  assert(readyHead.ok, `Public HEAD /ready should stay reachable, got ${readyHead.status}`)

  const ready = await fetch(`${BASE_URL}/ready`)
  const readyText = await ready.text()
  assert(ready.ok, `Public /ready should be ready for this protected test server, got ${ready.status}: ${readyText}`)
  assert(!readyText.includes('https://portal.sqd.dev'), '/ready should not expose the Portal base URL')
  const readyJson = JSON.parse(readyText)
  assert(readyJson?.status === 'ready', '/ready should distinguish readiness from liveness with a ready status')
  const readinessChecks = new Map((readyJson?.checks ?? []).map((entry: { name: string; status: string }) => [entry.name, entry.status]))
  assert(readinessChecks.get('portal_endpoint_config') === 'ok', '/ready should validate Portal endpoint configuration')
  assert(readinessChecks.get('mcp_auth') === 'ok', '/ready should validate MCP auth protection')
  assert(readinessChecks.get('metrics_protection') === 'ok', '/ready should validate metrics protection')
  assert(readinessChecks.get('cursor_secret') === 'warning', '/ready should report the local cursor-secret fallback outside strict mode')
  assert(readinessChecks.has('portal_reachability'), '/ready should report Portal reachability')

  const tools = await fetch(`${BASE_URL}/tools`)
  assert(tools.ok, `Public /tools should stay reachable, got ${tools.status}`)
  const toolsJson = await tools.json()
  assert(toolsJson?.endpoint?.id === 'public', '/tools should include safe public endpoint metadata')
  assert(toolsJson?.endpoint?.endpoint_class === 'public', '/tools endpoint metadata should classify the public endpoint')
  assert(toolsJson?.endpoint?.auth_required === false, '/tools endpoint metadata should not report auth for the public endpoint')
  assert(toolsJson?.tool_count === 28, '/tools should expose the full current tool catalog')

  const routedTools = await fetch(`${BASE_URL}/tools`, {
    headers: { 'x-forwarded-host': 'dedicated.portal.example.com' },
  })
  assert(routedTools.ok, `Host-routed /tools should stay reachable, got ${routedTools.status}`)
  const routedToolsJson = await routedTools.json()
  assert(routedToolsJson?.endpoint?.id === 'enterprise-hosted', 'Host-routed /tools should resolve the endpoint from the forwarded portal host')
  assert(routedToolsJson?.endpoint?.endpoint_class === 'enterprise', 'Host-routed /tools should expose safe enterprise endpoint class')
  assert(routedToolsJson?.endpoint?.auth_required === true, 'Host-routed /tools should report upstream Portal auth')

  const missingAuth = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 900, method: 'tools/list', params: {} }),
  })
  const missingAuthText = await missingAuth.text()
  assert(missingAuth.status === 401, `Anonymous MCP POST should be blocked, got ${missingAuth.status}`)
  const missingAuthJson = JSON.parse(missingAuthText)
  assert(missingAuthJson?.jsonrpc === '2.0', 'Unauthorized MCP response should be JSON-RPC compatible')
  assert(missingAuthJson?.error?.message === 'Unauthorized.', 'Unauthorized MCP response should use a generic message')

  const badToken = 'wrong-mcp-token-that-must-not-echo'
  const badAuth = await fetch(`${BASE_URL}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${badToken}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 901, method: 'tools/list', params: {} }),
  })
  const badAuthText = await badAuth.text()
  assert(badAuth.status === 401, `Bad-token MCP POST should be blocked, got ${badAuth.status}`)
  assert(!badAuthText.includes(badToken), 'Unauthorized MCP response should not echo bearer tokens')
}

function getHelpMetricNames(metricsText: string): Set<string> {
  const names = new Set<string>()
  for (const line of metricsText.split('\n')) {
    const match = line.match(/^# HELP ([a-zA-Z_:][a-zA-Z0-9_:]*) /)
    if (!match) continue
    const name = match[1]
    names.add(name)
    names.add(`${name}_bucket`)
    names.add(`${name}_sum`)
    names.add(`${name}_count`)
  }
  return names
}

async function assertDashboardMetricNames(metricsText: string) {
  const dashboard = JSON.parse(await readFile('grafana/portal-mcp-dashboard.json', 'utf8'))
  const emitted = getHelpMetricNames(metricsText)
  const missing = new Set<string>()

  function visit(value: unknown, datasource?: string) {
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, datasource))
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const currentDatasource = typeof record.datasource === 'string' ? record.datasource : datasource
    if (typeof record.expr === 'string' && currentDatasource !== '${DS_LOKI}') {
      for (const match of record.expr.matchAll(/\bmcp_[a-zA-Z0-9_:]+/g)) {
        if (!emitted.has(match[0])) missing.add(match[0])
      }
    }
    Object.values(record).forEach((entry) => visit(entry, currentDatasource))
  }

  visit(dashboard)
  assert(missing.size === 0, `Grafana dashboard references unknown Prometheus metrics: ${Array.from(missing).join(', ')}`)
}

function assertUserQueryRedacted() {
  const stderrText = stderrChunks.join('')
  assert(stderrText.includes('"user_query"'), 'JSON runtime logs should include captured user_query when enabled')
  assert(!stderrText.includes(OBS_USER_QUERY_SECRET), 'Captured user_query should not expose URL query secrets')
  assert(!stderrText.includes(OBS_USER_QUERY_BEARER), 'Captured user_query should not expose bearer secrets')
  assert(!stderrText.includes('?access_token='), 'Captured user_query should strip URL query strings')
  assert(stderrText.includes('https://example.test/path'), 'Captured user_query should retain the non-sensitive URL path')
  assert(stderrText.includes('[REDACTED]'), 'Captured user_query should mark redacted sensitive content')
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

function assertObservabilityEventContext() {
  const events = getToolEvents()
  const headEvent = events.find((event) => event.tool === 'portal_get_head')
  assert(headEvent, 'JSON runtime logs should include a portal_get_head tool event')
  assert(typeof headEvent.request_id === 'string' && headEvent.request_id.length > 10, 'Tool event should include request_id')
  assert(typeof headEvent.invocation_id === 'string' && headEvent.invocation_id.length > 10, 'Tool event should include invocation_id')
  assert(headEvent.endpoint_id === 'public', 'Tool event should include safe endpoint id')
  assert(headEvent.endpoint_class === 'public', 'Tool event should include endpoint class')
  assert(headEvent.endpoint_auth_mode === 'none', 'Tool event should include endpoint auth mode')
  assert(headEvent.mcp_auth_mode === 'static', 'Tool event should include MCP auth mode')
  assert(headEvent.mcp_auth_outcome === 'authorized', 'Tool event should include MCP auth outcome')
  assert(headEvent.credential_policy === 'server_default', 'Tool event should include bounded credential policy')
  assert(headEvent.upstream_portal_request_count >= 1, 'Tool event should count upstream Portal requests')
  assert(
    Array.isArray(headEvent.upstream_portal_status_codes) && headEvent.upstream_portal_status_codes.includes('200'),
    'Tool event should include upstream Portal status codes',
  )

  const serialized = JSON.stringify(events)
  assert(!serialized.includes('principal_id'), 'Tool events should not log principal ids')
  assert(!serialized.includes('tenant_id'), 'Tool events should not log raw tenant ids')
  assert(!serialized.includes('key_id'), 'Tool events should not log key ids')
}

async function main() {
  console.log('Starting HTTP runtime QA...\n')

  child = spawn('node', ['dist/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      METRICS_BEARER_TOKEN: METRICS_TOKEN,
      MCP_HTTP_BEARER_TOKEN: MCP_TOKEN,
      OBS_CAPTURE_USER_QUERY: 'true',
      OBS_LOG_JSON: 'true',
      MCP_TRUST_FORWARDED_HOST: 'true',
      PORTAL_ENDPOINTS: JSON.stringify([
        { id: 'public', baseUrl: 'https://portal.sqd.dev', label: 'Public Portal' },
        {
          id: 'enterprise-hosted',
          baseUrl: 'https://portal.sqd.dev',
          label: 'Enterprise hosted fixture',
          endpointClass: 'enterprise',
          tenantScope: 'tenant',
          tenantId: 'endpoint-tenant-secret',
          authMode: 'api_key',
          tokenEnv: 'ENTERPRISE_PORTAL_API_KEY',
          hostnames: ['dedicated.portal.example.com'],
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
  await assertMcpHttpAuth()
  await postRpc(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'metrics-smoke', version: '1.0.0' },
  })
  const listedTools = await postRpc(2, 'tools/list', {})
  assert(Array.isArray(listedTools.result?.tools), 'HTTP MCP tools/list should return a tools array')
  assert(listedTools.result.tools.length === 28, 'HTTP MCP tools/list should expose the current 28-tool catalog')
  await postRpc(20, 'tools/list', {}, {
    'x-mcp-client-name': CLIENT_HEADER_SECRET,
    'x-mcp-client-version': CLIENT_HEADER_SECRET,
  })

  const toolGuide = await postRpc(3, 'resources/read', { uri: 'sqd://tools' })
  const toolGuideText = toolGuide.result?.contents?.[0]?.text
  assert(typeof toolGuideText === 'string' && toolGuideText.includes('portal_get_head'), 'HTTP MCP should serve sqd://tools')

  const headCall = await postRpc(4, 'tools/call', {
    name: 'portal_get_head',
    arguments: { network: 'base' },
  })
  const headPayload = JSON.parse(headCall.result.content[0].text)
  assert(headPayload._meta.endpoint.id === 'public', 'Tool responses should include safe public endpoint metadata')
  assert(headPayload._meta.endpoint.endpoint_class === 'public', 'Tool response endpoint metadata should classify public endpoints')
  assert(headPayload._meta.endpoint.auth_required === false, 'Public tool response endpoint metadata should not report auth')
  const routedHeadCall = await postRpc(6, 'tools/call', {
    name: 'portal_get_head',
    arguments: { network: 'base' },
  }, { 'x-forwarded-host': 'dedicated.portal.example.com' })
  const routedHeadPayload = JSON.parse(routedHeadCall.result.content[0].text)
  assert(routedHeadPayload._meta.endpoint.id === 'enterprise-hosted', 'Host-routed tool responses should include the matched endpoint id')
  assert(routedHeadPayload._meta.endpoint.endpoint_class === 'enterprise', 'Host-routed tool responses should include enterprise endpoint class')
  assert(routedHeadPayload._meta.endpoint.auth_required === true, 'Host-routed tool responses should report upstream Portal auth')
  await postRpc(5, 'tools/call', {
    name: 'portal_resolve_entity',
    arguments: { network: 'base-mainnet', kind: 'token', query: 'USDC', limit: 3 },
  })

  const anonymousMetrics = await fetch(`${BASE_URL}/metrics`)
  assert(anonymousMetrics.status === 401, `Anonymous /metrics should be blocked, got ${anonymousMetrics.status}`)

  const authorizedMetrics = await fetch(`${BASE_URL}/metrics`, {
    headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
  })
  assert(authorizedMetrics.ok, `Authorized /metrics should succeed, got ${authorizedMetrics.status}`)
  const metricsText = await authorizedMetrics.text()

  assert(metricsText.includes('mcp_server_info{'), 'Metrics should expose mcp_server_info')
  assert(metricsText.includes('mcp_tool_calls_total{tool="portal_get_head",status="success",transport="http"'), 'Metrics should count the HTTP tool call')
  assert(metricsText.includes('endpoint_id="enterprise-hosted"'), 'Metrics should include host-routed endpoint labels')
  assert(metricsText.includes('mcp_client_requests_total{transport="http",client_name="metrics-smoke",client_version="1.0.0"'), 'Metrics should count the declared HTTP client')
  assert(!metricsText.includes(CLIENT_HEADER_SECRET), 'Metrics should not expose token-like client header values')
  assert(!stderrChunks.join('').includes(CLIENT_HEADER_SECRET), 'Runtime logs should not expose token-like client header values')
  assert(metricsText.includes('mcp_dataset_queries_total{dataset="base-mainnet",vm="evm"}'), 'Dataset metrics should use canonical network and vm labels')
  assert(!metricsText.includes('mcp_dataset_queries_total{dataset="base-mainnet"}'), 'Dataset metrics should not emit unlabeled vm series')
  assert(!metricsText.includes('mcp_dataset_queries_total{dataset="base",vm="evm"}'), 'Dataset metrics should not use network aliases for successful calls')
  assert(metricsText.includes('mcp_token_list_requests_total{source="coingecko_token_list",chain="base",status="success"'), 'Metrics should count token-list fetch success')
  assert(metricsText.includes('mcp_token_list_cache_events_total{source="coingecko_token_list",chain="base",event="'), 'Metrics should expose token-list cache events')

  assertUserQueryRedacted()
  assertObservabilityEventContext()
  await assertDashboardMetricNames(metricsText)

  console.log('PASS  MCP POST bearer auth blocks anonymous/bad tokens while keeping /health and /tools public')
  console.log('PASS  HTTP artifact smoke covers initialize, tools/list, sqd://tools, and live tool calls')
  console.log('PASS  /ready reports deployment readiness without exposing Portal URLs or tenant ids')
  console.log('PASS  OBS_CAPTURE_USER_QUERY emits sanitized user_query text')
  console.log('PASS  Tool events include safe endpoint/auth context and upstream Portal status')
  console.log('PASS  /metrics blocks anonymous access and accepts bearer auth')
  console.log('PASS  /metrics emits canonical tool, client, Portal, dataset, and token-list series')
  console.log('PASS  Grafana dashboard Prometheus metric names match emitted metrics')
  console.log('\nHTTP runtime QA passed')
}

main()
  .catch((error) => {
    console.error('HTTP runtime QA failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    child?.kill()
  })
