#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'

type PackedFile = {
  path: string
}

type PackResult = {
  filename: string
  files: PackedFile[]
  size: number
  unpackedSize: number
}

function fail(message: string): never {
  throw new Error(message)
}

function parsePackOutput(raw: string): PackResult {
  const parsed = JSON.parse(raw) as PackResult[]
  const result = parsed[0]
  if (!result || !Array.isArray(result.files)) {
    fail('npm pack output did not include a file list')
  }
  return result
}

const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  env: {
    ...process.env,
    npm_config_loglevel: 'silent',
  },
})

const pack = parsePackOutput(raw)
const files = pack.files.map((file) => file.path).sort()
const fileSet = new Set(files)

const requiredFiles = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'dist/index.js',
  'dist/http.js',
  'dist/server.js',
  'docs/portal-app-mcp-auth-contract.md',
  'docs/enterprise-http-deployment.md',
  'docs/v0.8.0-migration.md',
  'docs/v0.8.0-release-runbook.md',
]

const forbiddenPrefixes = ['src/', 'scripts/', 'plans/', '.github/', 'grafana/', 'node_modules/']
const forbiddenFiles = [
  '.dockerignore',
  '.mise.toml',
  'Dockerfile',
  'biome.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
]

const errors: string[] = []

for (const file of requiredFiles) {
  if (!fileSet.has(file)) {
    errors.push(`Missing required package file: ${file}`)
  }
}

for (const file of files) {
  if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
    errors.push(`Forbidden package path: ${file}`)
  }
  if (forbiddenFiles.includes(file)) {
    errors.push(`Forbidden package file: ${file}`)
  }
  if (file.endsWith('.map')) {
    errors.push(`Forbidden package source map: ${file}`)
  }
}

if (errors.length > 0) {
  console.error(`Package content check failed for ${pack.filename}:`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(
  `Package contents OK: ${pack.filename} includes ${files.length} files (${Math.round(pack.unpackedSize / 1024)} KiB unpacked)`,
)
