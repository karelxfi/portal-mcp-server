#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

type JsonObject = Record<string, any>

const PLUGIN_ROOT = 'plugins/portal'
const CODEX_PLUGIN_JSON = `${PLUGIN_ROOT}/.codex-plugin/plugin.json`
const CLAUDE_PLUGIN_JSON = `${PLUGIN_ROOT}/.claude-plugin/plugin.json`
const CODEX_MARKETPLACE_JSON = '.agents/plugins/marketplace.json'
const CLAUDE_MARKETPLACE_JSON = '.claude-plugin/marketplace.json'
const METADATA_JSON = `${PLUGIN_ROOT}/plugin-metadata.json`
const MCP_JSON = `${PLUGIN_ROOT}/.mcp.json`
const PORTAL_SKILL = `${PLUGIN_ROOT}/skills/portal/SKILL.md`
const PORTAL_SKILL_UI = `${PLUGIN_ROOT}/skills/portal/agents/openai.yaml`
const PIPES_SKILL_UI = `${PLUGIN_ROOT}/skills/pipes/agents/openai.yaml`
const APPROVED_PROMPTS = [
  'Show the last 200 BTC perp fills on Hyperliquid with price, size, side, and raw rows only.',
  'Chart Base transaction throughput over the last 2 hours in 15-minute buckets.',
  'Trace Base USDC flows from the past hour with amounts, counterparties, and tx hashes.',
]

const RAW_EXPORT_PROMPTS = [
  'Can you give me 20000 rows?',
  'Export the latest 20,000 BTC perp fills on Hyperliquid to CSV and NDJSON.',
  'Show raw rows only for the last 200 BTC fills.',
]

const REQUIRED_NO_CHATTER_SNIPPETS = [
  'loaded tools',
  'loaded files',
  'memories',
  'references',
  'prepared notes',
  'freshness checks',
  'head anchoring',
  'query-shape validation',
  'count checks',
  'block-window expansion',
  'Avoid a process log',
]

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonObject
}

function assertString(value: unknown, message: string): asserts value is string {
  assert(typeof value === 'string' && value.trim().length > 0, message)
}

function listFiles(root: string): string[] {
  const entries = readdirSync(root)
  const files: string[] = []

  for (const entry of entries) {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) {
      files.push(...listFiles(path))
    } else {
      files.push(path)
    }
  }

  return files
}

function walkStrings(value: unknown, visit: (text: string, path: string) => void, path = '$') {
  if (typeof value === 'string') {
    visit(value, path)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visit, `${path}[${index}]`))
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      walkStrings(item, visit, `${path}.${key}`)
    }
  }
}

const presentationCopyFiles = [
  'README.md',
  `${PLUGIN_ROOT}/README.md`,
  METADATA_JSON,
  CODEX_PLUGIN_JSON,
  CLAUDE_PLUGIN_JSON,
  CODEX_MARKETPLACE_JSON,
  CLAUDE_MARKETPLACE_JSON,
  MCP_JSON,
  PORTAL_SKILL_UI,
  PIPES_SKILL_UI,
]

const forbiddenPresentationCopy: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bPipes sdk\b/, reason: 'Pipes SDK must keep the acronym casing' },
  { pattern: /\bPipes\/Squid\b|\bPipes \/ Squid\b/, reason: 'user-facing copy should say Pipes SDK or data pipelines' },
  { pattern: /\bSqd-portal\b|\bSqd portal\b/, reason: 'user-facing copy should not expose slug-cased branding' },
  { pattern: /\bsqd-portal-mcp@/, reason: 'plugin selectors should use portal@sqd' },
  { pattern: /\bsqd@sqd-portal\b/, reason: 'plugin selectors should use portal@sqd' },
  { pattern: /\b0\.8\.0\+codex\./, reason: 'release manifests should not carry a Codex cachebuster suffix' },
  { pattern: /\bsqd-preview\b/i, reason: 'do not ship made-up preview artwork' },
  { pattern: /\bchat truncates\b/i, reason: 'starter prompts should avoid implementation-flavored truncation copy' },
  { pattern: /\bpivot on\b/i, reason: 'starter prompts should avoid internal pivoting jargon' },
  { pattern: /\bverified onchain data\b/i, reason: 'SQD Portal copy should say validated onchain data' },
  { pattern: /\bPipes SDK indexer\b/i, reason: 'presentation copy should frame durable work as data pipelines' },
  { pattern: /\bfirst I(?:'|’)ll check\b/i, reason: 'presentation copy should avoid process narration' },
  { pattern: /\blet me inspect\b/i, reason: 'presentation copy should avoid process narration' },
  { pattern: /\breading references\b/i, reason: 'presentation copy should avoid reference-loading chatter' },
  { pattern: /\bquery shape\b/i, reason: 'presentation copy should avoid implementation chatter' },
  { pattern: /\brow count check\b/i, reason: 'presentation copy should avoid implementation chatter' },
  { pattern: /\brunning curl\b/i, reason: 'presentation copy should avoid implementation chatter' },
  { pattern: /\bwriting the export\b/i, reason: 'presentation copy should avoid implementation chatter' },
]

function assertPresentationCopy() {
  for (const file of presentationCopyFiles) {
    const text = readFileSync(file, 'utf8')
    for (const { pattern, reason } of forbiddenPresentationCopy) {
      assert(!pattern.test(text), `${file} uses forbidden presentation copy (${reason}): ${pattern}`)
    }
  }
}

function assertPromptQuality(prompts: unknown, source: string) {
  assert(Array.isArray(prompts), `${source} default prompts should be an array`)
  assert(prompts.length === 3, `${source} should expose exactly 3 starter prompts`)
  assert(JSON.stringify(prompts) === JSON.stringify(APPROVED_PROMPTS), `${source} should keep the approved v0.8.0 starter prompts`)

  const promptText = prompts.join('\n')
  const expectedTopics = ['Hyperliquid', 'BTC', 'Base', '15-minute', 'USDC', 'tx hashes']
  for (const topic of expectedTopics) {
    assert(promptText.includes(topic), `${source} starter prompts should include ${topic}`)
  }

  prompts.forEach((prompt, index) => {
    assertString(prompt, `${source} prompt ${index + 1} should be a string`)
    assert(prompt.length <= 128, `${source} prompt ${index + 1} should fit compact plugin cards`)
    assert(/^(Show|Chart|Trace)\b/.test(prompt), `${source} prompt ${index + 1} should start with a concrete action verb`)
    assert(!/[?]$/.test(prompt), `${source} prompt ${index + 1} should be an instruction, not a question`)
    assert(!/\bmaybe\b|\bsomething like\b|\bstuff\b/i.test(prompt), `${source} prompt ${index + 1} should be specific`)
  })

  assert(/raw rows/i.test(promptText), `${source} should market raw evidence retrieval`)
  assert(/throughput/i.test(promptText), `${source} should market chartable chain activity`)
  assert(/flows/i.test(promptText), `${source} should market money-flow tracing`)
}

function assertMetadataContracts() {
  const pkg = readJson('package.json')
  const metadata = readJson(METADATA_JSON)
  const codex = readJson(CODEX_PLUGIN_JSON)
  const claude = readJson(CLAUDE_PLUGIN_JSON)
  const codexMarketplace = readJson(CODEX_MARKETPLACE_JSON)
  const claudeMarketplace = readJson(CLAUDE_MARKETPLACE_JSON)
  const mcp = readJson(MCP_JSON)

  assert(pkg.version === '0.8.0', 'package version should stay the clean release version')
  assert(metadata.version === pkg.version, 'plugin metadata should match package version')
  assert(metadata.selector === 'portal@sqd', 'plugin selector should stay portal@sqd')
  assert(metadata.pluginName === 'portal', 'plugin name should stay the user-friendly marketplace entry name')
  assert(metadata.marketplaceName === 'sqd', 'marketplace name should stay SQD')
  assert(metadata.mcpServerLabel === 'SQD', 'MCP server label should render as SQD')
  assert(metadata.displayName === 'SQD Portal', 'plugin display name should stay SQD Portal')
  assert(metadata.description?.short === 'Query validated onchain data.', 'short description should stay polished')
  assert(
    metadata.description?.long ===
      'Use SQD Portal to inspect wallets, contracts, transfers, blocks, and market activity with read-only MCP tools. For larger jobs, switch to Portal for raw exports or Pipes SDK for durable data pipelines.',
    'long description should explain MCP, Portal exports, and Pipes SDK data pipelines clearly',
  )
  assertPromptQuality(metadata.defaultPrompts, 'plugin metadata')

  for (const [label, manifest] of [
    ['Codex', codex],
    ['Claude', claude],
  ] as const) {
    assert(manifest.name === metadata.pluginName, `${label} manifest name should match metadata`)
    assert(manifest.version === metadata.version, `${label} manifest version should match metadata`)
    assert(manifest.interface?.displayName === metadata.displayName, `${label} interface displayName should match metadata`)
    assert(manifest.interface?.shortDescription === metadata.description.short, `${label} short description should match metadata`)
    assert(manifest.interface?.longDescription === metadata.description.long, `${label} long description should match metadata`)
    assertPromptQuality(manifest.interface?.defaultPrompt, `${label} manifest`)
    assert(manifest.interface?.screenshots === undefined, `${label} manifest should not ship screenshots until real captures are approved`)
  }

  assert(codexMarketplace.name === 'sqd', 'Codex marketplace should keep the sqd namespace')
  assert(codexMarketplace.interface?.displayName === 'SQD', 'Codex marketplace should render as SQD')
  const codexEntry = codexMarketplace.plugins?.find((entry: JsonObject) => entry.name === 'portal')
  assert(codexEntry?.displayName === metadata.displayName, 'Codex marketplace entry should expose SQD Portal')
  assert(codexEntry?.description?.includes('Pipes SDK'), 'Codex marketplace entry should mention Pipes SDK with correct casing')

  assert(claudeMarketplace.name === 'sqd', 'Claude marketplace should keep the sqd namespace')
  const claudeEntry = claudeMarketplace.plugins?.find((entry: JsonObject) => entry.name === 'portal')
  assert(claudeEntry?.displayName === metadata.displayName, 'Claude marketplace entry should expose SQD Portal')
  assert(claudeEntry?.description?.includes('Pipes SDK'), 'Claude marketplace entry should mention Pipes SDK with correct casing')

  const mcpServers = Object.keys(mcp.mcpServers ?? {})
  assert(JSON.stringify(mcpServers) === JSON.stringify(['SQD']), 'plugin MCP server key should render as SQD')
}

function assertAssets() {
  const metadata = readJson(METADATA_JSON)
  const composerIconPath = resolve(PLUGIN_ROOT, metadata.assets.composerIcon)
  const rootComposerIcon = readFileSync(composerIconPath, 'utf8')
  const portalSkillIcon = readFileSync(`${PLUGIN_ROOT}/skills/portal/assets/sqd-composer-icon.svg`, 'utf8')
  const pipesSkillIcon = readFileSync(`${PLUGIN_ROOT}/skills/pipes/assets/sqd-composer-icon.svg`, 'utf8')

  assert(rootComposerIcon === portalSkillIcon, 'Portal skill prompt icon should be byte-identical to the root composer icon')
  assert(rootComposerIcon === pipesSkillIcon, 'Pipes skill prompt icon should be byte-identical to the root composer icon')
  assert(rootComposerIcon.includes('rx="42"'), 'composer icon should keep the softened square corners')
  assert(rootComposerIcon.includes('fill="black"'), 'composer icon should use the black SQD square')
  assert(rootComposerIcon.includes('M208.004 125.812'), 'composer icon should keep the canonical SQD mark proportions')
  assert(!rootComposerIcon.includes('<g transform='), 'composer icon should not scale the mark differently in prompt previews')

  for (const file of listFiles(PLUGIN_ROOT)) {
    const name = file.toLowerCase()
    assert(!name.includes('sqd-preview'), `plugin should not include synthetic preview asset: ${file}`)
    if (file.includes('/assets/')) {
      assert(!['.png', '.jpg', '.jpeg', '.webp'].includes(extname(name)), `plugin assets should stay canonical SVGs: ${file}`)
    }
  }
}

function parseSimpleYamlInterface(path: string): JsonObject {
  const text = readFileSync(path, 'utf8')
  const result: JsonObject = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^\s{2}([a-z_]+):\s+"([^"]*)"$/)
    if (match) result[match[1]] = match[2]
  }
  return result
}

function getFrontmatter(text: string) {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  assert(Boolean(match), 'skill should include YAML frontmatter')
  return match![1]
}

function assertSkillPreviewContracts() {
  const metadata = readJson(METADATA_JSON)
  const portalSkill = readFileSync(PORTAL_SKILL, 'utf8')
  const portalFrontmatter = getFrontmatter(portalSkill)
  const portalUi = parseSimpleYamlInterface(PORTAL_SKILL_UI)
  const pipesUi = parseSimpleYamlInterface(PIPES_SKILL_UI)

  assert(portalSkill.includes('durable Pipes SDK data pipeline'), 'Portal skill intro should use data pipeline language')
  assert(portalSkill.includes('data pipelines'), 'Portal skill should use durable data pipeline language')
  assert(!/Pipes SDK indexer/i.test(portalSkill.split('\n').slice(0, 28).join('\n')), 'Portal skill opening should avoid indexer wording')
  assert(portalFrontmatter.includes('Plan SQD Portal work'), 'Portal skill trigger should be scoped to planning/routing')
  assert(
      portalFrontmatter.includes('Do not use this skill for direct raw-row, last-N, CSV/NDJSON, file, or obvious one-shot SQD MCP queries') &&
      portalFrontmatter.includes('do not read skills, references, memory, or old notes first') &&
      /Call the SQD MCP tool or Portal Stream API directly and return rows\/files first/i.test(portalFrontmatter),
    'Portal skill trigger should bypass obvious raw/export prompts before the skill loads',
  )
  assert(
    !portalFrontmatter.includes('Query blockchain data across'),
    'Portal skill trigger should not invite direct query prompts into the skill path',
  )
  assert(portalSkill.includes('## Raw Row Fast Path'), 'Portal skill should include a raw-row fast path')
  assert(portalSkill.includes('## Large Export Silence Rule'), 'Portal skill should include a large-export silence rule')
  assert(
    portalSkill.includes('Do not narrate setup') &&
      portalSkill.includes('Do not read `references/*.md`, `sqd://tools`, memory') &&
      portalSkill.includes('portal_hyperliquid_query_fills') &&
      portalSkill.includes('timeframe: "6h"'),
    'Portal skill should force direct, low-chatter execution for obvious Hyperliquid last-N row requests',
  )
  assert(
    portalSkill.indexOf('## Raw Row Fast Path') < portalSkill.indexOf('## When to Use This Skill'),
    'Portal raw-row fast path should appear before general workflow guidance',
  )
  assert(
    portalSkill.includes('Default order for non-fast-path requests') &&
      portalSkill.includes('This order does not apply to explicit raw rows, last-N records, CSV/NDJSON, file, or curl prompts'),
    'Portal default workflow should explicitly exclude raw/export fast-path prompts',
  )
  assert(
    portalSkill.includes('Use Portal Stream API/curl directly once dataset, type, and filters are obvious') &&
      portalSkill.includes('Do not mention loaded tools, loaded files, memories, references, prepared notes, freshness checks') &&
      portalSkill.includes('requested rows or exported file first') &&
      portalSkill.includes('at most one short note') &&
      portalSkill.includes('file paths first') &&
      portalSkill.includes('Avoid a process log') &&
      portalSkill.includes('expand it silently'),
    'Portal skill should force artifact-first, low-chatter UX for large raw exports',
  )
  assert(
    portalSkill.includes('skip MCP discovery when the dataset, type, and filters are already clear'),
    'Portal raw export fallback should not force noisy MCP discovery for obvious exports',
  )

  assert(portalUi.display_name === 'SQD Portal', 'Portal skill card should show SQD Portal')
  assert(portalUi.short_description === 'Plan Portal queries and exports', 'Portal skill card should be scoped to planning, not direct row pulls')
  assert(portalUi.icon_small === './assets/sqd-composer-icon.svg', 'Portal skill small icon should use the composer icon')
  assert(portalUi.icon_large === './assets/sqd-composer-icon.svg', 'Portal skill large icon should use the composer icon')
  assert(
    portalUi.default_prompt === 'Use $portal to choose between MCP, raw exports, and Pipes SDK.',
    'Portal skill default prompt should reference planning/routing instead of direct queries',
  )

  assert(pipesUi.display_name === 'Pipes SDK', 'Pipes skill card should preserve SDK casing')
  assert(pipesUi.short_description === 'Build Pipes SDK data pipelines', 'Pipes skill card should say data pipelines')
  assert(pipesUi.icon_small === './assets/sqd-composer-icon.svg', 'Pipes skill small icon should use the composer icon')
  assert(pipesUi.icon_large === './assets/sqd-composer-icon.svg', 'Pipes skill large icon should use the composer icon')
  assert(
    pipesUi.default_prompt === 'Use $pipes to turn this Portal query into a durable data pipeline.',
    'Pipes skill default prompt should stay polished and reference $pipes',
  )

  const skillNames = metadata.skills.map((skill: JsonObject) => skill.name).sort()
  assert(JSON.stringify(skillNames) === JSON.stringify(['pipes', 'portal']), 'bundled skill slugs should be portal and pipes')
  assert(
    metadata.skills.some(
      (skill: JsonObject) =>
        skill.name === 'portal' &&
        /Direct raw-row\/export prompts should use the SQD MCP tool or Portal Stream API without loading this skill/.test(
          String(skill.purpose ?? ''),
        ),
    ),
    'Portal skill metadata should discourage loading the skill for direct raw/export prompts',
  )
  walkStrings(metadata.skills, (text, path) => {
    assert(!/\bPipes sdk\b/.test(text), `metadata skills ${path} should keep Pipes SDK casing`)
  })
}

function assertRawExportUxContract() {
  const portalSkill = readFileSync(PORTAL_SKILL, 'utf8')
  const rootReadme = readFileSync('README.md', 'utf8')
  const pluginReadme = readFileSync(`${PLUGIN_ROOT}/README.md`, 'utf8')
  for (const prompt of RAW_EXPORT_PROMPTS) {
    assert(
      /rows?|CSV|NDJSON|export/i.test(prompt),
      `raw export fixture should exercise row/export language: ${prompt}`,
    )
  }
  for (const snippet of REQUIRED_NO_CHATTER_SNIPPETS) {
    assert(
      portalSkill.includes(snippet),
      `Portal skill should explicitly suppress large-export process chatter about ${snippet}`,
    )
  }
  assert(
    portalSkill.indexOf('## Large Export Silence Rule') < portalSkill.indexOf('## Raw Portal Stream API / Curl Fallback'),
    'large-export UX contract should appear before detailed curl fallback instructions',
  )
  assert(
    rootReadme.includes('put the requested rows or file first') &&
      rootReadme.includes('add no more than one short postscript'),
    'root README should document artifact-first raw/export UX',
  )
  assert(
    pluginReadme.includes('return rows or files first') &&
      pluginReadme.includes('only then add one short note'),
    'plugin README should document artifact-first raw/export UX',
  )
}

function main() {
  for (const file of presentationCopyFiles) {
    assert(existsSync(file), `expected presentation file to exist: ${file}`)
  }

  assertPresentationCopy()
  assertMetadataContracts()
  assertAssets()
  assertSkillPreviewContracts()
  assertRawExportUxContract()

  console.log('Plugin presentation contract passed: copy, prompts, skill cards, assets, and marketplace metadata are polished')
}

main()
