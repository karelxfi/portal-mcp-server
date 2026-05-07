#!/usr/bin/env tsx

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 3197
const BASE_URL = `http://localhost:${PORT}`

let child: ChildProcessWithoutNullStreams | undefined

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
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const text = await response.text()
  assert(response.ok, `RPC ${method} should return HTTP 2xx, got ${response.status}: ${text.slice(0, 240)}`)
  const parsed = parseSseJson(text)
  assert(!parsed.error, `RPC ${method} returned JSON-RPC error: ${JSON.stringify(parsed.error)}`)
  return parsed
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

async function main() {
  console.log('Starting observability QA...\n')

  child = spawn('node', ['dist/http.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))

  await waitForHealth()
  await postRpc(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'metrics-smoke', version: '1.0.0' },
  })
  await postRpc(2, 'tools/call', {
    name: 'portal_get_head',
    arguments: { network: 'base' },
  })

  const metricsText = await (await fetch(`${BASE_URL}/metrics`)).text()

  assert(metricsText.includes('mcp_server_info{'), 'Metrics should expose mcp_server_info')
  assert(metricsText.includes('mcp_tool_calls_total{tool="portal_get_head",status="success",transport="http"'), 'Metrics should count the HTTP tool call')
  assert(metricsText.includes('mcp_client_requests_total{transport="http",client_name="metrics-smoke",client_version="1.0.0"'), 'Metrics should count the declared HTTP client')
  assert(metricsText.includes('mcp_dataset_queries_total{dataset="base-mainnet",vm="evm"}'), 'Dataset metrics should use canonical network and vm labels')
  assert(!metricsText.includes('mcp_dataset_queries_total{dataset="base-mainnet"}'), 'Dataset metrics should not emit unlabeled vm series')
  assert(!metricsText.includes('mcp_dataset_queries_total{dataset="base",vm="evm"}'), 'Dataset metrics should not use network aliases for successful calls')

  await assertDashboardMetricNames(metricsText)

  console.log('PASS  /metrics emits canonical tool, client, Portal, and dataset series')
  console.log('PASS  Grafana dashboard Prometheus metric names match emitted metrics')
  console.log('\nObservability QA passed')
}

main()
  .catch((error) => {
    console.error('Observability QA failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    child?.kill()
  })
