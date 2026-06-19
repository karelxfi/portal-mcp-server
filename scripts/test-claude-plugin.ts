#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { assertPluginOutputSmoke } from './plugin-output-smoke.ts'

type JsonObject = Record<string, unknown>

const PLUGIN_ROOT = 'plugins/portal'
const MARKETPLACE_PATH = '.claude-plugin/marketplace.json'
const METADATA_PATH = `${PLUGIN_ROOT}/plugin-metadata.json`
const PLUGIN_JSON_PATH = `${PLUGIN_ROOT}/.claude-plugin/plugin.json`
const MCP_JSON_PATH = `${PLUGIN_ROOT}/.mcp.json`
const metadata = readJson(METADATA_PATH)
const metadataAssets = metadata.assets as JsonObject

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

function assertOptionalAsset(value: unknown, field: string) {
  if (value === undefined) return
  assertString(value, `${field} must be a string when present`)
  assert(value.startsWith('./assets/'), `${field} must live under ./assets/`)
  assert(existsSync(resolve(PLUGIN_ROOT, value)), `${field} points to a missing asset: ${value}`)
}

function assertSkillComposerIcon(skillRoot: string, value: string, field: string) {
  assert(value === './assets/sqd-composer-icon.svg', `${field} should use the pinned black SQD composer icon`)
  assert(existsSync(resolve(skillRoot, value)), `${field} points to a missing skill icon asset`)
  const icon = readFileSync(resolve(skillRoot, value), 'utf8')
  assert(
    icon.includes('<rect width="305" height="305" rx="42" transform="translate(0.117798 0.453125)" fill="black"/>'),
    `${field} must use the softened black SQD square`,
  )
  assert(
    !icon.includes('<g transform=') && icon.includes('M208.004 125.812'),
    `${field} should keep the canonical SQD mark proportions`,
  )
  assert(icon.includes('fill="white"'), `${field} must contain the white SQD mark`)
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

function assertBundledSkills(manifest: JsonObject) {
  assert(manifest.skills === './skills/', 'Claude plugin should declare bundled skills at ./skills/')
  assert(Array.isArray(metadata.skills), 'plugin metadata should list bundled skills')

  for (const skill of metadata.skills as JsonObject[]) {
    assertString(skill.name, 'metadata skill name must be a string')
    assertString(skill.displayName, `metadata skill ${skill.name} must have a displayName`)
    assertString(skill.path, `metadata skill ${skill.name} must have a path`)
    const frontmatterName = typeof skill.frontmatterName === 'string' ? skill.frontmatterName : skill.name
    const skillPath = resolve(PLUGIN_ROOT, skill.path.replace(/^\.\//, ''))
    assert(existsSync(skillPath), `bundled skill should exist: ${skill.path}`)
    const text = readFileSync(skillPath, 'utf8')
    assert(text.includes(`name: ${frontmatterName}`), `${skill.name} skill frontmatter should match metadata`)
    if (skill.displayName === 'Pipes SDK') {
      assert(skill.name === 'pipes', 'Pipes SDK skill preview slug should avoid acronym-lowercasing in skill cards')
      assert(frontmatterName === 'pipes', 'Pipes SDK skill frontmatter should match preview-safe slug')
      assert((skill.path as string).includes('/pipes/'), 'Pipes SDK skill folder should use the preview-safe slug')
    }
    const openAiYamlPath = resolve(skillPath, '../agents/openai.yaml')
    assert(existsSync(openAiYamlPath), `${skill.name} skill should expose UI metadata`)
    const openAiYaml = readFileSync(openAiYamlPath, 'utf8')
    assert(openAiYaml.includes(`display_name: "${skill.displayName}"`), `${skill.name} skill UI display name should be ${skill.displayName}`)
    assert(openAiYaml.includes('icon_small: "./assets/sqd-composer-icon.svg"'), `${skill.name} skill should pin the small icon`)
    assert(openAiYaml.includes('icon_large: "./assets/sqd-composer-icon.svg"'), `${skill.name} skill should pin the large icon`)
    const skillRoot = resolve(skillPath, '..')
    assertSkillComposerIcon(skillRoot, './assets/sqd-composer-icon.svg', `${skill.name} icon_small`)
    assertSkillComposerIcon(skillRoot, './assets/sqd-composer-icon.svg', `${skill.name} icon_large`)
    assert(openAiYaml.includes(`default_prompt: "Use $${frontmatterName}`), `${skill.name} skill default prompt should reference its skill name`)
    if (skill.name === 'portal') {
      assert(skill.displayName === 'SQD Portal', 'Portal skill should use the branded display name so the preview can keep the compact Portal slug')
      assert(text.includes('sqd://tools'), `${skill.name} skill should defer live MCP catalog details to sqd://tools`)
      assert(
        text.includes('Do not use this skill for direct raw-row, last-N, CSV/NDJSON, file, or obvious one-shot SQD MCP queries'),
        'Portal skill trigger should not capture obvious raw/export prompts',
      )
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
  assert(marketplace.name === metadata.marketplaceName, 'Claude marketplace name should match plugin metadata')
  assertRecord(marketplace.owner, 'Claude marketplace owner must be an object')
  assert(marketplace.owner.name === metadata.developerName, 'Claude marketplace owner should be Subsquid Labs')
  assert(marketplace.version === metadata.version, 'Claude marketplace version should match the plugin release')
  assert(Array.isArray(marketplace.plugins), 'Claude marketplace plugins must be an array')
  const entry = marketplace.plugins.find((plugin) => plugin?.name === 'portal') as JsonObject | undefined
  assertRecord(entry, 'Claude marketplace should include portal')
  assert(entry.source === './plugins/portal', 'Claude marketplace portal source should point at ./plugins/portal')
  assert(entry.displayName === metadata.displayName, 'Claude marketplace display name should be SQD Portal')
  assert(entry.version === metadata.version, 'Claude marketplace plugin entry version should match metadata')
  assertString(entry.description, 'Claude marketplace plugin entry should expose a useful description')
  assert(entry.description.includes('validated onchain data'), 'Claude marketplace entry should use polished validated-data copy')
  assert(entry.description.includes('Pipes SDK'), 'Claude marketplace entry should use correct Pipes SDK casing')
  assertNoCommittedSecretOrLocalPath(marketplace)
}

function getEndpoint() {
  const manifest = readJson(PLUGIN_JSON_PATH)
  const pkg = readJson('package.json')
  assert(pkg.version === metadata.version, 'package.json version should match plugin metadata')
  assert(manifest.name === metadata.pluginName, 'Claude plugin name should match plugin metadata')
  assert(manifest.displayName === metadata.displayName, 'Claude plugin display name should be SQD Portal')
  assert(manifest.version === metadata.version, 'Claude plugin version should match metadata')
  assert(manifest.description === (metadata.description as JsonObject).claude, 'Claude plugin description should match plugin metadata')
  assert(manifest.mcpServers === './.mcp.json', 'Claude plugin should reference ./.mcp.json')
  assert(existsSync(resolve(PLUGIN_ROOT, '.mcp.json')), 'Claude plugin MCP config should exist')
  assertRecord(manifest.interface, 'Claude plugin should include interface metadata when supported')
  assert(manifest.interface.displayName === metadata.displayName, 'Claude interface displayName should match metadata')
  assert(manifest.interface.shortDescription === (metadata.description as JsonObject).short, 'Claude interface shortDescription should match metadata')
  assert(manifest.interface.longDescription === (metadata.description as JsonObject).long, 'Claude interface longDescription should match metadata')
  assert(JSON.stringify(manifest.interface.defaultPrompt) === JSON.stringify(metadata.defaultPrompts), 'Claude starter prompts should match metadata')
  assertRecord(metadataAssets, 'plugin metadata assets must be an object')
  assert(manifest.interface.logo === metadataAssets.logo, 'Claude logo should match plugin metadata assets.logo')
  assert(manifest.interface.logoDark === metadataAssets.logoDark, 'Claude logoDark should match plugin metadata assets.logoDark')
  assertOptionalAsset(manifest.interface.logo, 'interface.logo')
  assertOptionalAsset(manifest.interface.logoDark, 'interface.logoDark')
  assertBundledSkills(manifest)
  assertNoCommittedSecretOrLocalPath(manifest)

  const mcp = readJson(MCP_JSON_PATH)
  assertRecord(mcp.mcpServers, '.mcp.json mcpServers must be an object')
  const serverNames = Object.keys(mcp.mcpServers)
  assert(JSON.stringify(serverNames) === JSON.stringify([metadata.mcpServerLabel]), '.mcp.json should expose the MCP server as SQD')
  const server = mcp.mcpServers[metadata.mcpServerLabel as string]
  assertRecord(server, '.mcp.json should include the SQD server')
  assert(server.type === 'http', 'SQD MCP server should use HTTP transport')
  assertString(server.url, 'SQD MCP server must define a URL')
  assert(server.url === metadata.mcpEndpoint, 'SQD MCP URL should be the hosted endpoint')
  assertNoCommittedSecretOrLocalPath(mcp)
  return server.url
}

async function assertHostedMcp(endpoint: string) {
  const init = await postRpc(endpoint, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'portal-mcp-claude-plugin-release-gate', version: '1.0.0' },
  })
  assertRecord(init.serverInfo, 'initialize should return serverInfo')
  assert(init.serverInfo.name === metadata.serverName, 'unexpected MCP server name')
  if (process.env.EXPECTED_HOSTED_VERSION) {
    assert(init.serverInfo.version === process.env.EXPECTED_HOSTED_VERSION, `hosted MCP version should be ${process.env.EXPECTED_HOSTED_VERSION}`)
  }

  const list = await postRpc(endpoint, 'tools/list', {})
  assert(Array.isArray(list.tools), 'tools/list should return tools array')
  const toolNames = new Set(list.tools.map((tool) => (tool as JsonObject).name))
  assert(toolNames.has('portal_list_networks'), 'tools/list should include portal_list_networks')
  assert(toolNames.has('portal_resolve_entity'), 'tools/list should include portal_resolve_entity')
}

function assertOptionalClaudeCliInstall() {
  if (process.env.PORTAL_PLUGIN_RUN_CLI_INSTALL !== '1') {
    console.log('Skipping isolated Claude CLI install smoke; set PORTAL_PLUGIN_RUN_CLI_INSTALL=1 to enable')
    return
  }

  const home = mkdtempSync(join(tmpdir(), 'portal-claude-plugin-'))
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
  }

  try {
    execFileSync('claude', ['plugin', 'marketplace', 'add', './'], { cwd: process.cwd(), env, stdio: 'pipe' })
    const list = execFileSync('claude', ['plugin', 'marketplace', 'list'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    })
    assert(list.includes(metadata.marketplaceName as string), 'isolated Claude marketplace listing should include sqd')
    execFileSync('claude', ['plugin', 'install', metadata.selector as string, '--scope', 'user'], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe',
    })
    const details = execFileSync('claude', ['plugin', 'details', metadata.selector as string], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    })
    assert(details.includes('SQD Portal') || details.includes('portal'), 'Claude plugin details should describe the installed plugin')
  } catch (error) {
    const stderr = Buffer.isBuffer((error as { stderr?: unknown }).stderr)
      ? ((error as { stderr: Buffer }).stderr).toString('utf8')
      : ''
    const stdout = Buffer.isBuffer((error as { stdout?: unknown }).stdout)
      ? ((error as { stdout: Buffer }).stdout).toString('utf8')
      : ''
    throw new Error(`Isolated Claude CLI install smoke failed: ${(error as Error).message}\n${stdout}\n${stderr}`.trim())
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

async function main() {
  assertMarketplace()
  const endpoint = getEndpoint()
  await assertHostedMcp(endpoint)
  await assertPluginOutputSmoke(endpoint, 'Claude')
  assertOptionalClaudeCliInstall()
  console.log('Claude plugin release gate passed: marketplace, manifest, MCP config, hosted MCP, and output UX smoke are valid')
}

await main()
