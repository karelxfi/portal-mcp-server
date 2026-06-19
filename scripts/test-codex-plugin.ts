#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { assertPluginOutputSmoke } from './plugin-output-smoke.ts'

type JsonObject = Record<string, unknown>

const PLUGIN_ROOT = 'plugins/portal'
const MARKETPLACE_PATH = '.agents/plugins/marketplace.json'
const METADATA_PATH = `${PLUGIN_ROOT}/plugin-metadata.json`
const PLUGIN_JSON_PATH = `${PLUGIN_ROOT}/.codex-plugin/plugin.json`
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
  const composerIcon = readFileSync(resolve(pluginRoot, value), 'utf8')
  assert(
    composerIcon.includes('<rect width="305" height="305" rx="42" transform="translate(0.117798 0.453125)" fill="black"/>'),
    'interface.composerIcon must use a softened black SQD square for prompt previews'
  )
  assert(
    !composerIcon.includes('<g transform=') && composerIcon.includes('M208.004 125.812'),
    'interface.composerIcon should keep the canonical SQD mark proportions so prompt previews match the main logo'
  )
  assert(composerIcon.includes('fill="white"'), 'interface.composerIcon must contain the white SQD mark')
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

function assertPromptList(value: unknown) {
  assert(Array.isArray(value), 'interface.defaultPrompt must be an array')
  assert(value.length > 0 && value.length <= 3, 'interface.defaultPrompt must contain 1-3 prompts')
  const expectedPrompts = metadata.defaultPrompts
  assert(Array.isArray(expectedPrompts), 'plugin metadata defaultPrompts must be an array')
  assert(JSON.stringify(value) === JSON.stringify(expectedPrompts), 'interface.defaultPrompt should stay concrete and analysis-oriented')
  for (const [index, prompt] of value.entries()) {
    assertString(prompt, `interface.defaultPrompt[${index}] must be a non-empty string`)
    assert(prompt.length <= 128, `interface.defaultPrompt[${index}] must be at most 128 characters`)
  }
  const promptText = value.join('\n')
  assert(promptText.includes('price, size, side'), 'starter prompts should market raw Hyperliquid fill detail')
  assert(promptText.includes('transaction throughput'), 'starter prompts should market chain activity charting')
  assert(promptText.includes('USDC flows'), 'starter prompts should market money-flow tracing')
  assert(!promptText.includes('chat truncates'), 'starter prompts should avoid implementation-flavored truncation copy')
  assert(!promptText.includes('pivot on'), 'starter prompts should avoid internal pivoting jargon')
}

function assertBundledSkills(manifest: JsonObject) {
  assert(manifest.skills === './skills/', 'plugin should declare bundled skills at ./skills/')
  assert(Array.isArray(metadata.skills), 'plugin metadata should list bundled skills')

  const legacyNames = [
    'portal_list_datasets',
    'portal_get_dataset_info',
    'portal_get_block_number',
    'portal_block_at_timestamp',
    'portal_query_logs',
    'portal_count_events',
    'portal_query_transactions',
    'portal_get_erc20_transfers',
    'portal_query_hyperliquid_fills',
  ]

  for (const skill of metadata.skills as JsonObject[]) {
    assertString(skill.name, 'metadata skill name must be a string')
    assertString(skill.displayName, `metadata skill ${skill.name} must have a displayName`)
    assertString(skill.path, `metadata skill ${skill.name} must have a path`)
    const frontmatterName = typeof skill.frontmatterName === 'string' ? skill.frontmatterName : skill.name
    const skillPath = resolve(PLUGIN_ROOT, skill.path.replace(/^\.\//, ''))
    assert(existsSync(skillPath), `bundled skill should exist: ${skill.path}`)
    const text = readFileSync(skillPath, 'utf8')
    assert(text.startsWith('---\n'), `${skill.name} skill should have frontmatter`)
    assert(text.includes(`name: ${frontmatterName}`), `${skill.name} skill frontmatter should match metadata`)
    if (skill.displayName === 'Pipes SDK') {
      assert(skill.name === 'pipes', 'Pipes SDK skill preview slug should avoid acronym-lowercasing in Codex skill cards')
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
    for (const legacyName of legacyNames) {
      assert(!text.includes(legacyName), `${skill.name} skill should not mention stale MCP tool ${legacyName}`)
    }
  }
}

function assertReleaseMetadata(manifest: JsonObject) {
  const pkg = readJson('package.json')
  assert(pkg.version === metadata.version, 'package.json version should match plugin metadata')
  assert(manifest.version === metadata.version, 'Codex plugin version should match plugin metadata')
  assert(manifest.name === metadata.pluginName, 'Codex plugin name should match plugin metadata')
  assert(manifest.description === (metadata.description as JsonObject).codex, 'Codex plugin description should match plugin metadata')
  assertRecord(manifest.interface, 'plugin interface must be an object')
  assert(manifest.interface.displayName === metadata.displayName, 'Codex display name should match plugin metadata')
  assert(manifest.interface.shortDescription === (metadata.description as JsonObject).short, 'Codex short description should match plugin metadata')
  assert(manifest.interface.longDescription === (metadata.description as JsonObject).long, 'Codex long description should match plugin metadata')
  assert(manifest.interface.websiteURL === metadata.websiteURL, 'Codex website URL should match plugin metadata')
  assert(manifest.interface.privacyPolicyURL === metadata.privacyPolicyURL, 'Codex privacy URL should match plugin metadata')
  assert(manifest.interface.brandColor === metadata.brandColor, 'Codex brand color should match plugin metadata')
  assertRecord(metadataAssets, 'plugin metadata assets must be an object')
  assert(manifest.interface.logo === metadataAssets.logo, 'Codex logo should match plugin metadata assets.logo')
  assert(manifest.interface.logoDark === metadataAssets.logoDark, 'Codex logoDark should match plugin metadata assets.logoDark')
  assert(manifest.interface.composerIcon === metadataAssets.composerIcon, 'Codex composerIcon should match plugin metadata assets.composerIcon')
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
  assertReleaseMetadata(manifest)
  assert(manifest.mcpServers === './.mcp.json', 'plugin should reference ./.mcp.json')
  assertPromptList(manifest.interface.defaultPrompt)
  assertOptionalAsset(PLUGIN_ROOT, manifest.interface.composerIcon, 'interface.composerIcon')
  assertOptionalAsset(PLUGIN_ROOT, manifest.interface.logo, 'interface.logo')
  assertOptionalAsset(PLUGIN_ROOT, manifest.interface.logoDark, 'interface.logoDark')
  assertComposerIcon(PLUGIN_ROOT, manifest.interface.composerIcon)
  assertSquareLogoVariants(PLUGIN_ROOT, manifest.interface)
  assertBundledSkills(manifest)
  assertNoCommittedSecretOrLocalPath(manifest)
}

function assertMarketplace() {
  const marketplace = readJson(MARKETPLACE_PATH)
  assert(marketplace.name === metadata.marketplaceName, 'marketplace name should match plugin metadata')
  assertRecord(marketplace.interface, 'marketplace interface must be an object')
  assert(marketplace.interface.displayName === 'SQD', 'marketplace display name should be SQD')
  assert(Array.isArray(marketplace.plugins), 'marketplace.plugins must be an array')
  const entry = marketplace.plugins.find((plugin) => plugin?.name === 'portal') as JsonObject | undefined
  assertRecord(entry, 'marketplace should include portal')
  assert(entry.displayName === metadata.displayName, 'marketplace entry should expose polished displayName')
  assertString(entry.description, 'marketplace entry should expose a useful description')
  assert(entry.description.includes('validated onchain data'), 'marketplace entry should use polished validated-data copy')
  assert(entry.description.includes('Pipes SDK'), 'marketplace entry should use correct Pipes SDK casing')
  assertRecord(entry.source, 'marketplace source must be an object')
  assert(entry.source.source === 'local', 'marketplace source.source should be local')
  assert(entry.source.path === './plugins/portal', 'marketplace source.path should stay stable')
  assertRecord(entry.policy, 'marketplace policy must be an object')
  assert(entry.policy.installation === 'AVAILABLE', 'marketplace installation policy should be AVAILABLE')
  assert(entry.policy.authentication === 'ON_INSTALL', 'marketplace authentication policy should be ON_INSTALL')
  assert(entry.category === 'Data & Analytics', 'marketplace category should be Data & Analytics')
}

function getEndpoint() {
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

function assertCachedCodexInstall(codexHome: string) {
  const cacheRoot = join(codexHome, 'plugins/cache', metadata.marketplaceName as string, 'portal', metadata.version as string)
  assert(existsSync(cacheRoot), `isolated Codex install should create cache root: ${cacheRoot}`)

  const cachedManifest = readJson(join(cacheRoot, '.codex-plugin/plugin.json'))
  assert(cachedManifest.name === metadata.pluginName, 'cached Codex plugin name should match metadata')
  assert(cachedManifest.version === metadata.version, 'cached Codex plugin version should stay the clean release version')
  assert(!String(cachedManifest.version).includes('+codex.'), 'cached Codex plugin should not use a cachebuster release version')
  assert(cachedManifest.interface?.displayName === metadata.displayName, 'cached Codex display name should match metadata')
  assert(cachedManifest.interface?.shortDescription === (metadata.description as JsonObject).short, 'cached Codex short description should match metadata')
  assert(JSON.stringify(cachedManifest.interface?.defaultPrompt) === JSON.stringify(metadata.defaultPrompts), 'cached Codex starter prompts should match metadata')
  assert(cachedManifest.interface?.composerIcon === metadataAssets.composerIcon, 'cached Codex composer icon should match metadata')
  assert(cachedManifest.interface?.logo === metadataAssets.logo, 'cached Codex logo should match metadata')
  assert(cachedManifest.interface?.logoDark === metadataAssets.logoDark, 'cached Codex logoDark should match metadata')
  assertNoCommittedSecretOrLocalPath(cachedManifest)

  const repoComposer = readFileSync(resolve(PLUGIN_ROOT, metadataAssets.composerIcon as string), 'utf8')
  for (const relativePath of [
    'assets/sqd-composer-icon.svg',
    'skills/portal/assets/sqd-composer-icon.svg',
    'skills/pipes/assets/sqd-composer-icon.svg',
  ]) {
    const cachedIcon = readFileSync(join(cacheRoot, relativePath), 'utf8')
    assert(cachedIcon === repoComposer, `cached ${relativePath} should be byte-identical to the root composer icon`)
    assert(!cachedIcon.includes('<g transform='), `cached ${relativePath} should not use scaled prompt-logo artwork`)
  }

  const portalUi = readFileSync(join(cacheRoot, 'skills/portal/agents/openai.yaml'), 'utf8')
  const pipesUi = readFileSync(join(cacheRoot, 'skills/pipes/agents/openai.yaml'), 'utf8')
  assert(portalUi.includes('display_name: "SQD Portal"'), 'cached Portal skill card should render as SQD Portal')
  assert(portalUi.includes('short_description: "Plan Portal queries and exports"'), 'cached Portal skill card should be scoped to planning')
  assert(
    portalUi.includes('default_prompt: "Use $portal to choose between MCP, raw exports, and Pipes SDK."'),
    'cached Portal skill default prompt should avoid direct-query wording',
  )
  assert(pipesUi.includes('display_name: "Pipes SDK"'), 'cached Pipes skill card should preserve SDK casing')
  assert(pipesUi.includes('short_description: "Build Pipes SDK data pipelines"'), 'cached Pipes skill card should use data pipeline copy')
}

async function assertHostedMcp(endpoint: string) {
  const init = await postRpc(endpoint, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'portal-mcp-plugin-release-gate', version: '1.0.0' },
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

  const discovery = await postRpc(endpoint, 'tools/call', {
    name: 'portal_list_networks',
    arguments: { query: 'base', limit: 1 },
  })
  const text = (discovery.content as JsonObject[] | undefined)?.find((item) => item.type === 'text')?.text
  assertString(text, 'portal_list_networks should return text content')
  const body = JSON.parse(text) as JsonObject
  assert(Array.isArray(body.items) && body.items.length > 0, 'portal_list_networks should return at least one item')
}

function assertOptionalCodexCliInstall() {
  if (process.env.PORTAL_PLUGIN_RUN_CLI_INSTALL !== '1') {
    console.log('Skipping isolated Codex CLI install smoke; set PORTAL_PLUGIN_RUN_CLI_INSTALL=1 to enable')
    return
  }

  const home = mkdtempSync(join(tmpdir(), 'portal-codex-plugin-'))
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, '.codex'),
    XDG_CONFIG_HOME: join(home, '.config'),
  }
  mkdirSync(env.CODEX_HOME, { recursive: true })
  mkdirSync(env.XDG_CONFIG_HOME, { recursive: true })

  try {
    execFileSync('codex', ['plugin', 'marketplace', 'add', '.'], { cwd: process.cwd(), env, stdio: 'pipe' })
    const list = execFileSync('codex', ['plugin', 'list', '--marketplace', metadata.marketplaceName as string], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    })
    assert(list.includes('portal'), 'isolated Codex marketplace listing should include portal')
    const addOutput = execFileSync('codex', ['plugin', 'add', metadata.selector as string], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    })
    assert(addOutput.includes('Added plugin `portal`'), 'isolated Codex install should report portal installation')
    assert(
      addOutput.includes(`/plugins/cache/${metadata.marketplaceName as string}/portal/${metadata.version as string}`),
      'isolated Codex install should cache the release-versioned portal plugin',
    )
    const config = readFileSync(join(env.CODEX_HOME, 'config.toml'), 'utf8')
    assert(config.includes('[plugins."portal@sqd"]'), 'isolated Codex config should include portal@sqd')
    assert(config.includes('enabled = true'), 'isolated Codex config should enable portal@sqd')
    assertCachedCodexInstall(env.CODEX_HOME)
  } catch (error) {
    const stderr = Buffer.isBuffer((error as { stderr?: unknown }).stderr)
      ? ((error as { stderr: Buffer }).stderr).toString('utf8')
      : ''
    const stdout = Buffer.isBuffer((error as { stdout?: unknown }).stdout)
      ? ((error as { stdout: Buffer }).stdout).toString('utf8')
      : ''
    throw new Error(`Isolated Codex CLI install smoke failed: ${(error as Error).message}\n${stdout}\n${stderr}`.trim())
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

async function main() {
  assertManifest()
  assertMarketplace()
  const endpoint = getEndpoint()
  await assertHostedMcp(endpoint)
  await assertPluginOutputSmoke(endpoint, 'Codex')
  assertOptionalCodexCliInstall()
  console.log('Codex plugin release gate passed: manifest, marketplace, assets, hosted MCP, and output UX smoke are valid')
}

await main()
