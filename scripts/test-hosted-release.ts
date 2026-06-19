#!/usr/bin/env tsx

import { readFileSync } from 'node:fs'

type JsonObject = Record<string, unknown>

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as JsonObject
const metadata = JSON.parse(readFileSync('plugins/portal/plugin-metadata.json', 'utf8')) as JsonObject
const endpoint = String(process.env.PORTAL_MCP_ENDPOINT || metadata.mcpEndpoint)
const expectedVersion = String(process.env.EXPECTED_HOSTED_VERSION || metadata.version || pkg.version)

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function parseSseJson(text: string) {
  const dataLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data: '))
  assert(Boolean(dataLine), `Expected SSE data line, got: ${text.slice(0, 240)}`)
  return JSON.parse(dataLine!.slice('data: '.length)) as JsonObject
}

async function postRpc(method: string, params: JsonObject) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-mcp-client-name': 'portal-hosted-release-gate',
      'x-mcp-client-version': '1.0.0',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  })
  const text = await response.text()
  assert(response.ok, `RPC ${method} should return HTTP 2xx, got ${response.status}: ${text.slice(0, 240)}`)
  const parsed = parseSseJson(text)
  assert(!parsed.error, `RPC ${method} returned JSON-RPC error: ${JSON.stringify(parsed.error)}`)
  return parsed.result as JsonObject
}

async function maybeCheckPublicRoute(path: string) {
  const url = new URL(endpoint)
  url.pathname = path
  url.search = ''
  const response = await fetch(url)
  if (response.status === 404) {
    console.log(`SKIP  hosted ${path} returned 404; using MCP-only hosted discovery for this deployment`)
    return
  }
  assert(response.ok, `Hosted ${path} should be OK or 404, got ${response.status}`)
  const data = (await response.json()) as JsonObject
  assert(data.version === expectedVersion, `Hosted ${path} version should be ${expectedVersion}`)
  console.log(`PASS  hosted ${path} is public and versioned`)
}

async function main() {
  assert(pkg.version === metadata.version, 'package version and plugin metadata version should match before hosted release')

  const init = await postRpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'portal-hosted-release-gate', version: '1.0.0' },
  })
  const serverInfo = init.serverInfo as JsonObject | undefined
  assert(serverInfo?.name === metadata.serverName, `hosted MCP server name should be ${metadata.serverName}`)
  assert(serverInfo?.version === expectedVersion, `hosted MCP version should be ${expectedVersion}, got ${serverInfo?.version}`)

  const tools = await postRpc('tools/list', {})
  assert(Array.isArray(tools.tools), 'hosted tools/list should return tools')
  assert(tools.tools.length === (metadata.trust as JsonObject).toolCount, `hosted tools/list should expose ${(metadata.trust as JsonObject).toolCount} tools`)

  const guide = await postRpc('resources/read', { uri: 'sqd://tools' })
  const guideText = (guide.contents as JsonObject[] | undefined)?.[0]?.text
  assert(typeof guideText === 'string', 'hosted sqd://tools should return JSON text')
  const guideJson = JSON.parse(guideText) as JsonObject
  assert(guideJson.version === expectedVersion, `hosted sqd://tools version should be ${expectedVersion}`)
  assert((guideJson.execution_guidance as JsonObject)?.version === 'portal_execution_guidance_v1', 'hosted sqd://tools should expose execution guidance')

  const executionGuide = await postRpc('resources/read', { uri: 'sqd://execution-guidance' })
  const executionGuideText = (executionGuide.contents as JsonObject[] | undefined)?.[0]?.text
  assert(typeof executionGuideText === 'string', 'hosted sqd://execution-guidance should return JSON text')
  const executionGuideJson = JSON.parse(executionGuideText) as JsonObject
  assert((executionGuideJson.plugin as JsonObject)?.selector === metadata.selector, 'hosted execution guidance should mention portal@sqd')
  assert((executionGuideJson.plugin as JsonObject)?.mcp_server_label === metadata.mcpServerLabel, 'hosted execution guidance should mention the SQD MCP server label')
  const surfaces = (executionGuideJson.surfaces as JsonObject) ?? {}
  assert(Object.prototype.hasOwnProperty.call(surfaces, 'portal_mcp'), 'hosted execution guidance should include Portal MCP')
  assert(Object.prototype.hasOwnProperty.call(surfaces, 'portal_stream_api'), 'hosted execution guidance should include Portal Stream API')
  assert(Object.prototype.hasOwnProperty.call(surfaces, 'pipes_squid'), 'hosted execution guidance should include Pipes SDK handoff')
  assert((surfaces.pipes_squid as JsonObject)?.label === 'Pipes SDK data pipelines', 'hosted execution guidance should use polished Pipes SDK label')
  const decisionText = JSON.stringify(executionGuideJson.decision_rules ?? [])
  assert(/raw rows/i.test(decisionText), 'hosted execution guidance should explain raw-row export routing')
  assert(/durable data pipeline/i.test(decisionText), 'hosted execution guidance should explain durable data pipeline routing')

  await maybeCheckPublicRoute('/health')
  await maybeCheckPublicRoute('/tools')

  console.log(`Hosted release gate passed for ${endpoint} at ${expectedVersion}`)
}

main().catch((error) => {
  console.error(`Hosted release gate failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
