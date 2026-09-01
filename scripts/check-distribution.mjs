#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const SERVER_NAME = 'io.github.subsquid-labs/portal-mcp-server'
const REPOSITORY = 'https://github.com/subsquid-labs/portal-mcp-server'
const SERVER_URL = 'https://portal.sqd.dev/mcp'
const LIVE = process.argv.includes('--live')
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))
const outputPath = outputArgument?.slice('--output='.length)

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function result(target, status, detail) {
  return { target, status, detail }
}

function fail(message) {
  throw new Error(message)
}

function validateMetadata() {
  const packageJson = readJson('package.json')
  const server = readJson('server.json')
  const glama = readJson('glama.json')
  const gemini = readJson('plugins/portal/gemini-extension.json')
  const codex = readJson('plugins/portal/.codex-plugin/plugin.json')
  const claude = readJson('plugins/portal/.claude-plugin/plugin.json')
  const cursor = readJson('plugins/portal/.cursor-plugin/plugin.json')
  const targets = readJson('distribution/targets.json')
  const submissions = readJson('distribution/submission-packets.json')
  const dockerWorkflow = readFileSync('.github/workflows/docker-build.yml', 'utf8')

  const errors = []
  const assert = (condition, message) => {
    if (!condition) errors.push(message)
  }

  assert(server.name === SERVER_NAME, `server.json name must be ${SERVER_NAME}`)
  assert(server.title === 'SQD', 'server.json title must be SQD')
  assert(server.version === packageJson.version, 'server.json version must match package.json')
  assert(server.repository?.url === REPOSITORY, 'server.json repository must use the canonical GitHub URL')
  assert(server.description.length <= 100, 'server.json description must fit the MCP Registry 100-character limit')
  assert(
    server.remotes?.some((remote) => remote.url === SERVER_URL),
    'server.json must publish the hosted MCP URL',
  )
  assert(/130\+ SQD Portal datasets/.test(server.description), 'server.json description must state the conservative dataset coverage')
  assert(/Tron/.test(server.description), 'server.json description must include Tron')
  assert(/heads and timestamps/.test(server.description), 'server.json must describe the bounded Tron MCP capability')
  assert(!/[\u2013\u2014]/.test(server.description), 'server.json description must not use en or em dashes')

  for (const [name, manifest] of [
    ['Gemini', gemini],
    ['Codex', codex],
    ['Claude', claude],
    ['Cursor', cursor],
  ]) {
    assert(manifest.version === packageJson.version, `${name} manifest version must match package.json`)
  }

  assert(gemini.name === 'sqd', 'Gemini extension identifier must remain sqd')
  assert(gemini.mcpServers?.SQD?.httpUrl === SERVER_URL, 'Gemini must use the hosted MCP URL')
  assert(glama.maintainers?.includes('karelxfi'), 'Glama ownership metadata must include karelxfi')
  assert(
    !dockerWorkflow.includes('type=raw,value=${{ steps.package.outputs.version }}'),
    'default-branch Docker builds must not overwrite an immutable semantic-version image tag',
  )
  assert(
    dockerWorkflow.includes('type=raw,value=latest,enable={{is_default_branch}}') &&
      dockerWorkflow.includes('type=semver,pattern={{version}}') &&
      dockerWorkflow.includes('type=sha'),
    'Docker builds must keep latest for main, semantic versions for release tags, and immutable SHA tags',
  )

  assert(targets.repository === REPOSITORY, 'distribution repository must use the canonical GitHub URL')
  assert(targets.serverUrl === SERVER_URL, 'distribution server URL must use the hosted MCP URL')
  const targetIds = targets.targets.map((target) => target.id)
  assert(targetIds.length === new Set(targetIds).size, 'distribution target IDs must be unique')
  for (const requiredTarget of [
    'claude-connectors',
    'openai-plugins',
    'grok-build',
    'cursor-marketplace',
    'official-mcp-registry',
    'gemini-cli',
    'glama',
    'awesome-mcp-servers',
    'smithery',
  ]) {
    assert(targetIds.includes(requiredTarget), `distribution targets must include ${requiredTarget}`)
  }

  assert(submissions.product === 'SQD', 'submission packets must use the public product name SQD')
  assert(submissions.developer === 'Subsquid Labs GmbH', 'submission packets must use the company identity')
  assert(submissions.repository === REPOSITORY, 'submission packets must use the canonical GitHub URL')
  assert(submissions.serverUrl === SERVER_URL, 'submission packets must use the hosted MCP URL')
  assert(submissions.authentication === 'none', 'submission packets must state that authentication is not required')
  assert(/Symbol_bl-bg\.svg$/.test(submissions.logo), 'submission packets must use the black-background SQD logo')
  for (const targetId of ['smithery', 'mcp-so', 'pulse-mcp', 'api-tracker']) {
    const packet = submissions.packets?.[targetId]
    assert(packet?.name === 'SQD', `${targetId} submission must use the product name SQD`)
    assert(
      /blockchain/i.test(`${packet?.tagline} ${packet?.description}`),
      `${targetId} submission must mention blockchain`,
    )
    assert(/Hyperliquid/.test(packet?.description ?? ''), `${targetId} submission must mention Hyperliquid`)
    assert(/Tron/.test(packet?.description ?? ''), `${targetId} submission must mention Tron`)
    assert(
      /Tron dataset heads and timestamps|Tron datasets and resolve their heads and timestamps/.test(packet?.description ?? ''),
      `${targetId} submission must describe the bounded Tron MCP capability`,
    )
    assert(
      !/[\u2013\u2014]/.test(`${packet?.tagline} ${packet?.description}`),
      `${targetId} submission must not use en or em dashes`,
    )
  }

  if (errors.length > 0) fail(errors.join('\n'))
  return { version: packageJson.version, targets }
}

async function fetchText(url) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'SQD-Directory-Health/1.0' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.text()
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
  }
  throw lastError
}

async function checkRegistry(version) {
  const encodedName = encodeURIComponent(SERVER_NAME)
  const body = await fetchText(
    `https://registry.modelcontextprotocol.io/v0.1/servers/${encodedName}/versions/${encodeURIComponent(version)}`,
  )
  const match = JSON.parse(body)
  if (match.server?.name !== SERVER_NAME || match.server?.version !== version) {
    return result('Official MCP Registry', 'fail', `version ${version} is not published`)
  }
  if (!match._meta?.['io.modelcontextprotocol.registry/official']?.isLatest) {
    return result('Official MCP Registry', 'fail', `version ${version} is present but not marked latest`)
  }
  return result('Official MCP Registry', 'pass', `version ${version} is latest`)
}

async function checkGemini(version) {
  const body = await fetchText('https://geminicli.com/extensions.json')
  const extensions = JSON.parse(body)
  const match = extensions.find((extension) => extension.fullName === 'subsquid-labs/portal-mcp-server')
  if (!match) return result('Gemini CLI Extension Gallery', 'fail', 'repository is not indexed')
  if (match.extensionVersion !== version) {
    return result(
      'Gemini CLI Extension Gallery',
      'fail',
      `gallery has ${match.extensionVersion ?? 'no version'}, expected ${version}`,
    )
  }
  return result('Gemini CLI Extension Gallery', 'pass', `version ${version} is indexed`)
}

async function checkGeminiPrerequisites(version) {
  const [repositoryBody, releaseBody] = await Promise.all([
    fetchText('https://api.github.com/repos/subsquid-labs/portal-mcp-server'),
    fetchText(`https://api.github.com/repos/subsquid-labs/portal-mcp-server/releases/tags/v${version}`),
  ])
  const repository = JSON.parse(repositoryBody)
  const release = JSON.parse(releaseBody)
  if (!repository.topics?.includes('gemini-cli-extension')) {
    return result('Gemini discovery prerequisites', 'fail', 'repository topic gemini-cli-extension is missing')
  }
  if (!release.assets?.some((asset) => asset.name === 'sqd.tar.gz')) {
    return result('Gemini discovery prerequisites', 'fail', `release v${version} is missing sqd.tar.gz`)
  }
  return result('Gemini discovery prerequisites', 'pass', `topic and v${version} release archive are present`)
}

async function checkGlama(version) {
  const body = await fetchText('https://glama.ai/mcp/servers/subsquid-labs/portal-mcp-server')
  if (body.includes('Unclaimed servers have limited discoverability.')) {
    return result('Glama', 'fail', 'listing is live but unclaimed')
  }

  const decoded = body.replaceAll('\\"', '"')
  const releaseIndex = decoded.lastIndexOf('"latestRelease"')
  const releaseWindow = releaseIndex >= 0 ? decoded.slice(releaseIndex, releaseIndex + 800) : ''
  const listedVersion = releaseWindow.match(/"version","([^"]+)"/)?.[1]
  if (!listedVersion) return result('Glama', 'fail', 'latest release version could not be read')
  if (listedVersion !== version) {
    return result('Glama', 'fail', `listing has ${listedVersion}, expected ${version}`)
  }
  return result('Glama', 'pass', `version ${version} is indexed and the listing is claimed`)
}

async function checkAwesomeList() {
  const body = await fetchText('https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md')
  if (!body.includes(REPOSITORY)) {
    return result('Awesome MCP Servers', 'fail', 'canonical repository is missing')
  }
  return result('Awesome MCP Servers', 'pass', 'canonical repository is listed')
}

async function checkSmithery() {
  const body = await fetchText('https://smithery.ai/servers/sqd/sqd')
  if (!body.includes('Connect AI agents to live blockchain data across 130+ networks')) {
    return result('Smithery', 'fail', 'official listing metadata is missing')
  }
  if (!body.includes(SERVER_URL)) {
    return result('Smithery', 'fail', 'hosted MCP endpoint is missing')
  }
  return result('Smithery', 'pass', 'official sqd/sqd listing is live')
}

async function checkGrokPullRequest() {
  const body = await fetchText('https://api.github.com/repos/xai-org/plugin-marketplace/pulls/384')
  const pullRequest = JSON.parse(body)
  if (pullRequest.merged_at)
    return result('Grok Build Marketplace', 'pass', `pull request #384 merged at ${pullRequest.merged_at}`)
  if (pullRequest.state === 'open')
    return result('Grok Build Marketplace', 'pending', 'pull request #384 is open for review')
  return result('Grok Build Marketplace', 'fail', 'pull request #384 closed without merging')
}

async function runLiveChecks(version) {
  const checks = [
    ['Official MCP Registry', () => checkRegistry(version)],
    ['Gemini discovery prerequisites', () => checkGeminiPrerequisites(version)],
    ['Gemini CLI Extension Gallery', () => checkGemini(version)],
    ['Glama', () => checkGlama(version)],
    ['Awesome MCP Servers', checkAwesomeList],
    ['Smithery', checkSmithery],
    ['Grok Build Marketplace', checkGrokPullRequest],
  ]

  return Promise.all(
    checks.map(async ([name, check]) => {
      try {
        return await check()
      } catch (error) {
        return result(name, 'fail', error instanceof Error ? error.message : String(error))
      }
    }),
  )
}

function renderMarkdown(version, results) {
  const rows = results.map(({ target, status, detail }) => `| ${target} | ${status} | ${detail} |`).join('\n')
  return `## SQD directory health\n\nExpected version: \`${version}\`\n\n| Directory | Status | Detail |\n| --- | --- | --- |\n${rows}\n`
}

const { version } = validateMetadata()
const results = LIVE
  ? await runLiveChecks(version)
  : [result('Distribution metadata', 'pass', `all manifests match version ${version}`)]
const report = {
  checkedAt: new Date().toISOString(),
  expectedVersion: version,
  live: LIVE,
  results,
}

if (outputPath) writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderMarkdown(version, results))

for (const entry of results) console.log(`${entry.status.toUpperCase()} ${entry.target}: ${entry.detail}`)
if (results.some((entry) => entry.status === 'fail')) process.exitCode = 1
