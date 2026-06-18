#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type JsonObject = Record<string, unknown>

const PLUGIN_ROOT = 'plugins/sqd-portal-mcp'
const MARKETPLACE_PATH = '.agents/plugins/marketplace.json'
const PLUGIN_JSON_PATH = `${PLUGIN_ROOT}/.codex-plugin/plugin.json`
const MCP_JSON_PATH = `${PLUGIN_ROOT}/.mcp.json`

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonObject
}

function assertString(value: unknown, message: string): asserts value is string {
  assert(typeof value === 'string' && value.trim().length > 0, message)
}

function assertRecord(value: unknown, message: string): asserts value is JsonObject {
  assert(Boolean(value) && typeof value === 'object' && !Array.isArray(value), message)
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

function assertOptionalAsset(pluginRoot: string, value: unknown, field: string) {
  if (value === undefined) return
  assertString(value, `${field} must be a string when present`)
  assert(value.startsWith('./assets/'), `${field} must live under ./assets/`)
  assert(existsSync(resolve(pluginRoot, value)), `${field} points to a missing asset: ${value}`)
}

function assertSquareLogoVariants(pluginRoot: string, interfaceConfig: JsonObject) {
  assertString(interfaceConfig.logo, 'interface.logo must be a string')
  assertString(interfaceConfig.logoDark, 'interface.logoDark must be a string')
  const lightSurfaceLogo = readFileSync(resolve(pluginRoot, interfaceConfig.logo), 'utf8')
  const darkSurfaceLogo = readFileSync(resolve(pluginRoot, interfaceConfig.logoDark), 'utf8')
  assert(
    lightSurfaceLogo.includes('<rect width="305" height="305" transform="translate(0.117798 0.453125)" fill="black"/>'),
    'interface.logo must use the black-background SQD square symbol'
  )
  assert(lightSurfaceLogo.includes('fill="white"'), 'interface.logo must contain the white SQD mark')
  assert(
    darkSurfaceLogo.includes('<rect width="305" height="305" transform="translate(0.117798 0.453125)" fill="white"/>'),
    'interface.logoDark must use the white-background SQD square symbol'
  )
  assert(darkSurfaceLogo.includes('fill="black"'), 'interface.logoDark must contain the black SQD mark')
}

function assertComposerIcon(pluginRoot: string, value: unknown) {
  assertString(value, 'interface.composerIcon must be a string')
  assert(value === './assets/sqd-composer-icon.svg', 'plugin should use the trimmed SQD composer icon in prompt previews')
  const composerIcon = readFileSync(resolve(pluginRoot, value), 'utf8')
  assert(
    composerIcon.includes('<rect width="305" height="305" rx="42" transform="translate(0.117798 0.453125)" fill="black"/>'),
    'interface.composerIcon must use a softened black SQD square for prompt previews'
  )
  assert(composerIcon.includes('fill="white"'), 'interface.composerIcon must contain the white SQD mark')
}

function assertPromptList(value: unknown) {
  assert(Array.isArray(value), 'interface.defaultPrompt must be an array')
  assert(value.length > 0 && value.length <= 3, 'interface.defaultPrompt must contain 1-3 prompts')
  const expectedPrompts = [
    'Show me the last 200 BTC perp fills on Hyperliquid.',
    'How many transactions landed on Base in the past 2h?',
    'Who sent the most USDC on Base in the past hour?',
  ]
  assert(JSON.stringify(value) === JSON.stringify(expectedPrompts), 'interface.defaultPrompt should stay concrete and analysis-oriented')
  for (const [index, prompt] of value.entries()) {
    assertString(prompt, `interface.defaultPrompt[${index}] must be a non-empty string`)
    assert(prompt.length <= 128, `interface.defaultPrompt[${index}] must be at most 128 characters`)
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
      'x-mcp-client-name': 'portal-mcp-plugin-release-gate',
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

function assertManifest() {
  const manifest = readJson(PLUGIN_JSON_PATH)
  assert(manifest.name === 'sqd-portal-mcp', 'plugin name should be sqd-portal-mcp')
  assert(manifest.mcpServers === './.mcp.json', 'plugin should reference ./.mcp.json')
  assertRecord(manifest.interface, 'plugin interface must be an object')
  assert(manifest.interface.displayName === 'SQD Portal', 'plugin display name should be polished for end users')
  assert(manifest.interface.websiteURL === 'https://sqd.dev/portal/', 'plugin website should point at the SQD Portal product page')
  assert(manifest.interface.privacyPolicyURL === 'https://sqd.dev/imprint/', 'plugin privacy policy should point at SQD imprint/privacy page')
  assert(manifest.interface.brandColor === '#08090A', 'plugin brand color should match SQD surface black')
  assert(manifest.interface.logo === './assets/sqd-logo.svg', 'plugin should use the black SQD square logo in light mode')
  assert(manifest.interface.logoDark === './assets/sqd-logo-dark.svg', 'plugin should use the white SQD square logo in dark mode')
  assertPromptList(manifest.interface.defaultPrompt)
  assertOptionalAsset(PLUGIN_ROOT, manifest.interface.composerIcon, 'interface.composerIcon')
  assertOptionalAsset(PLUGIN_ROOT, manifest.interface.logo, 'interface.logo')
  assertOptionalAsset(PLUGIN_ROOT, manifest.interface.logoDark, 'interface.logoDark')
  assertComposerIcon(PLUGIN_ROOT, manifest.interface.composerIcon)
  assertSquareLogoVariants(PLUGIN_ROOT, manifest.interface)
  const screenshots = manifest.interface.screenshots
  if (screenshots !== undefined) {
    assert(Array.isArray(screenshots), 'interface.screenshots must be an array when present')
    screenshots.forEach((screenshot, index) => assertOptionalAsset(PLUGIN_ROOT, screenshot, `interface.screenshots[${index}]`))
  }
  assertNoCommittedSecretOrLocalPath(manifest)
}

function assertMarketplace() {
  const marketplace = readJson(MARKETPLACE_PATH)
  assert(marketplace.name === 'portal-mcp-server', 'marketplace name should be portal-mcp-server')
  assert(Array.isArray(marketplace.plugins), 'marketplace.plugins must be an array')
  const entry = marketplace.plugins.find((plugin) => plugin?.name === 'sqd-portal-mcp') as JsonObject | undefined
  assertRecord(entry, 'marketplace should include sqd-portal-mcp')
  assertRecord(entry.source, 'marketplace source must be an object')
  assert(entry.source.source === 'local', 'marketplace source.source should be local')
  assert(entry.source.path === './plugins/sqd-portal-mcp', 'marketplace source.path should stay stable')
  assertRecord(entry.policy, 'marketplace policy must be an object')
  assert(entry.policy.installation === 'AVAILABLE', 'marketplace installation policy should be AVAILABLE')
  assert(entry.policy.authentication === 'ON_INSTALL', 'marketplace authentication policy should be ON_INSTALL')
  assert(entry.category === 'Data & Analytics', 'marketplace category should be Data & Analytics')
}

function getEndpoint() {
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

async function assertHostedMcp(endpoint: string) {
  const init = await postRpc(endpoint, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'portal-mcp-plugin-release-gate', version: '1.0.0' },
  })
  assertRecord(init.serverInfo, 'initialize should return serverInfo')
  assert(init.serverInfo.name === 'sqd-portal-mcp-server', 'unexpected MCP server name')

  const list = await postRpc(endpoint, 'tools/list', {})
  assert(Array.isArray(list.tools), 'tools/list should return tools array')
  const toolNames = new Set(list.tools.map((tool) => (tool as JsonObject).name))
  assert(toolNames.has('portal_list_networks'), 'tools/list should include portal_list_networks')
  assert(toolNames.has('portal_resolve_entity'), 'tools/list should include portal_resolve_entity')

  const discovery = await postRpc(endpoint, 'tools/call', {
    name: 'portal_list_networks',
    arguments: { query: 'base', limit: 1 },
  })
  const text = (discovery.content as JsonObject[] | undefined)?.find((item) => item.type === 'text')?.text
  assertString(text, 'portal_list_networks should return text content')
  const body = JSON.parse(text) as JsonObject
  assert(Array.isArray(body.items) && body.items.length > 0, 'portal_list_networks should return at least one item')
}

async function main() {
  assertManifest()
  assertMarketplace()
  const endpoint = getEndpoint()
  await assertHostedMcp(endpoint)
  console.log('Codex plugin release gate passed: manifest, marketplace, assets, and hosted MCP smoke are valid')
}

await main()
