#!/usr/bin/env tsx

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const PORT = 3197
const BASE_URL = `http://localhost:${PORT}`
const METRICS_TOKEN = 'test-metrics-token'
const OBS_USER_QUERY_SECRET = 'obs-user-query-secret'
const OBS_USER_QUERY_BEARER = 'obs-user-query-bearer'
const OBS_USER_QUERY = `show https://example.test/path?access_token=${OBS_USER_QUERY_SECRET} with Authorization: Bearer ${OBS_USER_QUERY_BEARER}`

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

async function postRpc(id: number, method: string, params: Record<string, unknown>) {
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-mcp-client-name': 'metrics-smoke',
      'x-mcp-client-version': '1.0.0',
      'x-mcp-user-query': OBS_USER_QUERY,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const text = await response.text()
  assert(response.ok, `RPC ${method} should return HTTP 2xx, got ${response.status}: ${text.slice(0, 240)}`)
  const parsed = parseSseJson(text)
  assert(!parsed.error, `RPC ${method} returned JSON-RPC error: ${JSON.stringify(parsed.error)}`)
  return parsed
}

async function assertPublicHttpSurface() {
  const health = await fetch(`${BASE_URL}/health`)
  assert(health.ok, `Public /health should stay reachable, got ${health.status}`)

  const tools = await fetch(`${BASE_URL}/tools`)
  assert(tools.status === 404, `Retired duplicate /tools endpoint should return 404, got ${tools.status}`)

  const publicMcp = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 900, method: 'tools/list', params: {} }),
  })
  assert(publicMcp.ok, `Anonymous MCP POST should stay available in v0.8.0, got ${publicMcp.status}`)
}

async function assertModernHttpProtocol() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    requestInit: {
      headers: {
        'x-mcp-client-name': 'modern-http-smoke',
        'x-mcp-client-version': '0.8.0',
      },
    },
  })
  const client = new Client(
    { name: 'modern-http-smoke', version: '0.8.0' },
    { versionNegotiation: { mode: 'auto', probe: { timeoutMs: 5_000 } } },
  )

  await client.connect(transport)
  try {
    assert(client.getProtocolEra() === 'modern', `HTTP should negotiate modern era, got ${client.getProtocolEra()}`)
    assert(
      client.getNegotiatedProtocolVersion() === '2026-07-28',
      `HTTP should negotiate 2026-07-28, got ${client.getNegotiatedProtocolVersion()}`,
    )
    const { tools } = await client.listTools()
    assert(tools.length === 28, `Modern HTTP tools/list expected 28 tools, got ${tools.length}`)
    const result = await client.callTool({ name: 'portal_get_head', arguments: { network: 'base' } })
    assert(!result.isError, 'Modern HTTP portal_get_head should succeed')
  } finally {
    await client.close()
  }
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
  assert(
    missing.size === 0,
    `Grafana dashboard references unknown Prometheus metrics: ${Array.from(missing).join(', ')}`,
  )
}

function assertUserQueryRedacted() {
  const stderrText = stderrChunks.join('')
  assert(stderrText.includes('"user_query"'), 'JSON runtime logs should include captured user_query when enabled')
  assert(!stderrText.includes(OBS_USER_QUERY_SECRET), 'Captured user_query should not expose URL query secrets')
  assert(!stderrText.includes(OBS_USER_QUERY_BEARER), 'Captured user_query should not expose bearer secrets')
  assert(!stderrText.includes('?access_token='), 'Captured user_query should strip URL query strings')
  assert(
    stderrText.includes('https://example.test/path'),
    'Captured user_query should retain the non-sensitive URL path',
  )
  assert(stderrText.includes('[REDACTED]'), 'Captured user_query should mark redacted sensitive content')
}

async function main() {
  console.log('Starting HTTP runtime QA...\n')

  child = spawn('node', ['dist/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      METRICS_BEARER_TOKEN: METRICS_TOKEN,
      OBS_CAPTURE_USER_QUERY: 'true',
      OBS_LOG_JSON: 'true',
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
  await assertPublicHttpSurface()
  await assertModernHttpProtocol()
  await postRpc(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'metrics-smoke', version: '1.0.0' },
  })
  await postRpc(2, 'tools/call', {
    name: 'portal_get_head',
    arguments: { network: 'base' },
  })
  await postRpc(3, 'tools/call', {
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
  assert(
    metricsText.includes('mcp_tool_calls_total{tool="portal_get_head",status="success",transport="http"'),
    'Metrics should count the HTTP tool call',
  )
  assert(
    metricsText.includes(
      'mcp_client_requests_total{transport="http",client_name="metrics-smoke",client_version="1.0.0"',
    ),
    'Metrics should count the declared HTTP client',
  )
  assert(
    metricsText.includes('mcp_dataset_queries_total{dataset="base-mainnet",vm="evm"}'),
    'Dataset metrics should use canonical network and vm labels',
  )
  assert(
    !metricsText.includes('mcp_dataset_queries_total{dataset="base-mainnet"}'),
    'Dataset metrics should not emit unlabeled vm series',
  )
  assert(
    !metricsText.includes('mcp_dataset_queries_total{dataset="base",vm="evm"}'),
    'Dataset metrics should not use network aliases for successful calls',
  )
  assert(
    metricsText.includes('mcp_token_list_requests_total{source="coingecko_token_list",chain="base",status="success"'),
    'Metrics should count token-list fetch success',
  )
  assert(
    metricsText.includes('mcp_token_list_cache_events_total{source="coingecko_token_list",chain="base",event="'),
    'Metrics should expose token-list cache events',
  )

  assertUserQueryRedacted()
  await assertDashboardMetricNames(metricsText)

  console.log('PASS  /health and MCP remain public with no client credential setup')
  console.log('PASS  MCP 2026-07-28 negotiates and calls tools over stateless HTTP')
  console.log('PASS  Retired duplicate /tools endpoint stays removed')
  console.log('PASS  OBS_CAPTURE_USER_QUERY emits sanitized user_query text')
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
