#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type JsonObject = Record<string, unknown>

const PLUGIN_ROOT = 'plugins/portal'
const MARKETPLACE_PATH = '.claude-plugin/marketplace.json'
const PLUGIN_JSON_PATH = `${PLUGIN_ROOT}/.claude-plugin/plugin.json`
const MCP_JSON_PATH = `${PLUGIN_ROOT}/.mcp.json`
const DIRECTORY_SUBMISSION_PATH = `${PLUGIN_ROOT}/DIRECTORY_SUBMISSION.md`
const REQUIRE_MCP_2026_LIVE = process.env.REQUIRE_MCP_2026_LIVE === '1'

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonObject
}

function assertRecord(value: unknown, message: string): asserts value is JsonObject {
  assert(Boolean(value) && typeof value === 'object' && !Array.isArray(value), message)
}

function assertString(value: unknown, message: string): asserts value is string {
  assert(typeof value === 'string' && value.trim().length > 0, message)
}

function assertNoCommittedSecretOrLocalPath(value: unknown, path = '$') {
  if (typeof value === 'string') {
    const forbidden = [/\/Users\//, /localhost/, /file:\/\//, /MCP_HTTP_BEARER_TOKEN/, /PORTAL_URL/, /Bearer\s+/i]
    for (const pattern of forbidden) {
      assert(!pattern.test(value), `${path} contains forbidden local or secret-like marker ${pattern}`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCommittedSecretOrLocalPath(item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assertNoCommittedSecretOrLocalPath(item, `${path}.${key}`)
    }
  }
}

function parseSseJson(text: string) {
  const dataLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data: '))
  assert(Boolean(dataLine), `Expected SSE data line, got: ${text.slice(0, 240)}`)
  return JSON.parse(dataLine!.slice('data: '.length)) as JsonObject
}

async function postRpc(endpoint: string, method: string, params: JsonObject) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-mcp-client-name': 'portal-mcp-claude-plugin-release-gate',
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

function assertMarketplace() {
  const marketplace = readJson(MARKETPLACE_PATH)
  assert(marketplace.name === 'sqd', 'Claude marketplace name should be sqd')
  assertRecord(marketplace.owner, 'Claude marketplace owner must be an object')
  assert(marketplace.owner.name === 'Subsquid Labs', 'Claude marketplace owner should be Subsquid Labs')
  assert(marketplace.version === '0.8.0', 'Claude marketplace version should match the plugin release')
  assert(Array.isArray(marketplace.plugins), 'Claude marketplace plugins must be an array')
  const entry = marketplace.plugins.find((plugin) => plugin?.name === 'portal') as JsonObject | undefined
  assertRecord(entry, 'Claude marketplace should include portal')
  assert(entry.source === './plugins/portal', 'Claude marketplace portal source should point at ./plugins/portal')
  assert(entry.displayName === 'SQD', 'Claude marketplace display name should be SQD')
  assert(entry.version === '0.8.0', 'Claude marketplace plugin entry version should be 0.8.0')
  assertNoCommittedSecretOrLocalPath(marketplace)
}

function getEndpoint() {
  const manifest = readJson(PLUGIN_JSON_PATH)
  assert(manifest.name === 'portal', 'Claude plugin name should be portal')
  assert(manifest.displayName === 'SQD', 'Claude plugin display name should be SQD')
  assert(
    manifest.description === 'Explore live and historical blockchain data across 130+ networks with SQD.',
    'Claude plugin description should lead with broad network coverage',
  )
  assert(!/[\u2014\u2013]/.test(JSON.stringify(manifest)), 'Claude plugin copy should not use em or en dashes')
  assert(manifest.version === '0.8.0', 'Claude plugin version should be 0.8.0')
  assert(manifest.mcpServers === './.mcp.json', 'Claude plugin should reference ./.mcp.json')
  assert(existsSync(resolve(PLUGIN_ROOT, '.mcp.json')), 'Claude plugin MCP config should exist')
  for (const skill of ['portal', 'pipes-sdk', 'migrate-to-portal', 'squid-perf']) {
    assert(
      existsSync(resolve(PLUGIN_ROOT, 'skills', skill, 'SKILL.md')),
      `Claude plugin should auto-discover the ${skill} skill`,
    )
  }
  assertNoCommittedSecretOrLocalPath(manifest)

  const mcp = readJson(MCP_JSON_PATH)
  assertRecord(mcp.mcpServers, '.mcp.json mcpServers must be an object')
  const serverNames = Object.keys(mcp.mcpServers)
  assert(JSON.stringify(serverNames) === JSON.stringify(['SQD']), '.mcp.json should expose the MCP server as SQD')
  const server = mcp.mcpServers.SQD
  assertRecord(server, '.mcp.json should include the SQD server')
  assert(server.type === 'http', 'SQD MCP server should use HTTP transport')
  assertString(server.url, 'SQD MCP server must define a URL')
  assert(server.url === 'https://portal.sqd.dev/mcp', 'SQD MCP URL should be the hosted endpoint')
  assertNoCommittedSecretOrLocalPath(mcp)
  return server.url
}

function assertDirectoryListing() {
  const submission = readFileSync(DIRECTORY_SUBMISSION_PATH, 'utf8')
  assert(
    submission.includes('https://claude.ai/directory/connectors/sqd'),
    'Claude submission packet should record the public SQD connector listing',
  )
  assert(
    submission.includes('Tagline: `Explore blockchain data across 130+ networks`'),
    'Claude submission packet should keep the broad coverage tagline',
  )
  assert(submission.includes('Authentication: none'), 'Claude submission packet should declare no authentication')
  assert(
    submission.includes('canonical black-background SQD logo'),
    'Claude submission packet should use the canonical black-background logo',
  )
  assert(!/[\u2014\u2013]/.test(submission), 'Claude submission packet should not use em or en dashes')
}

async function assertHostedMcp(endpoint: string) {
  const init = await postRpc(endpoint, 'initialize', {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'portal-mcp-claude-plugin-release-gate', version: '1.0.0' },
  })
  assertRecord(init.serverInfo, 'initialize should return serverInfo')
  assert(init.serverInfo.name === 'sqd-portal-mcp-server', 'unexpected MCP server name')
  if (REQUIRE_MCP_2026_LIVE) {
    assert(init.protocolVersion === '2026-07-28', 'Claude plugin should negotiate MCP 2026-07-28')
  }

  const list = await postRpc(endpoint, 'tools/list', {})
  assert(Array.isArray(list.tools), 'tools/list should return tools array')
  const toolNames = new Set(list.tools.map((tool) => (tool as JsonObject).name))
  assert(toolNames.has('portal_list_networks'), 'tools/list should include portal_list_networks')
  assert(toolNames.has('portal_resolve_entity'), 'tools/list should include portal_resolve_entity')
}

async function main() {
  assertMarketplace()
  assertDirectoryListing()
  const endpoint = getEndpoint()
  await assertHostedMcp(endpoint)
  console.log(
    `Claude plugin release gate passed: marketplace, manifest, MCP config, and hosted MCP smoke are valid${REQUIRE_MCP_2026_LIVE ? ' with live MCP 2026-07-28' : ''}`,
  )
}

await main()
