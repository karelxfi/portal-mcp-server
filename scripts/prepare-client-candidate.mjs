#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { digestClientCandidate } from './lib/client-candidate-digest.mjs'

const destination = process.argv[2]
if (!destination) {
  console.error('Usage: node scripts/prepare-client-candidate.mjs <empty-output-directory>')
  process.exit(1)
}

const root = resolve(destination)
const runtime = resolve('dist/index.js')
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))

await mkdir(root, { recursive: true })
if ((await readdir(root)).length > 0) {
  console.error(`Candidate output directory must be empty: ${root}`)
  process.exit(1)
}

await mkdir(resolve(root, 'plugins'), { recursive: true })
await mkdir(resolve(root, '.agents/plugins'), { recursive: true })
await mkdir(resolve(root, '.claude-plugin'), { recursive: true })
await mkdir(resolve(root, '.cursor-plugin'), { recursive: true })
await cp('plugins/portal', resolve(root, 'plugins/portal'), { recursive: true })
await cp('.agents/plugins/marketplace.json', resolve(root, '.agents/plugins/marketplace.json'))
await cp('.claude-plugin/marketplace.json', resolve(root, '.claude-plugin/marketplace.json'))
await cp('.cursor-plugin/marketplace.json', resolve(root, '.cursor-plugin/marketplace.json'))

const stdioServer = { command: process.execPath, args: [runtime] }
await writeFile(
  resolve(root, 'plugins/portal/.mcp.json'),
  `${JSON.stringify({ mcpServers: { SQD: stdioServer } }, null, 2)}\n`,
)

const geminiPath = resolve(root, 'plugins/portal/gemini-extension.json')
const gemini = JSON.parse(await readFile(geminiPath, 'utf8'))
gemini.mcpServers = { SQD: stdioServer }
await writeFile(geminiPath, `${JSON.stringify(gemini, null, 2)}\n`)

const manifestFiles = [
  '.agents/plugins/marketplace.json',
  '.claude-plugin/marketplace.json',
  '.cursor-plugin/marketplace.json',
  'plugins/portal/.claude-plugin/plugin.json',
  'plugins/portal/.codex-plugin/plugin.json',
  'plugins/portal/.cursor-plugin/plugin.json',
  'plugins/portal/gemini-extension.json',
  'plugins/portal/.mcp.json',
]
const candidateDigest = await digestClientCandidate({
  projectRoot: resolve('.'),
  manifestRoot: root,
  manifestFiles,
  runtimeRoot: resolve('dist'),
  runtimeMetadataFiles: [resolve('package.json'), resolve('package-lock.json')],
})

const metadata = {
  schemaVersion: 'sqd_local_client_candidate_v1',
  releaseVersion: packageJson.version,
  transport: 'stdio',
  runtime: basename(runtime),
  packageSha256: candidateDigest.packageSha256,
  runtimeFileCount: candidateDigest.runtimeFileCount,
  hashedFileCount: candidateDigest.hashedFileCount,
  proofBoundary:
    'This package swaps only the hosted MCP connection for the exact local release-candidate stdio build. The digest covers every compiled JavaScript runtime module, package metadata, the lockfile, and all client manifests. Public release packages keep https://portal.sqd.dev/mcp.',
}
await writeFile(resolve(root, 'candidate.json'), `${JSON.stringify(metadata, null, 2)}\n`)
console.log(JSON.stringify({ root, ...metadata }))
