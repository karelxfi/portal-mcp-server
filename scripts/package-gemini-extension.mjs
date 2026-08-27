#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = join(repoRoot, 'plugins', 'portal')
const outputPath = resolve(repoRoot, process.argv[2] ?? 'dist/gemini/sqd.tar.gz')
const stageRoot = mkdtempSync(join(tmpdir(), 'sqd-gemini-extension-'))

try {
  for (const name of ['gemini-extension.json', 'README.md']) {
    copyFileSync(join(pluginRoot, name), join(stageRoot, name))
  }
  for (const name of ['assets', 'skills']) {
    cpSync(join(pluginRoot, name), join(stageRoot, name), { recursive: true })
  }
  copyFileSync(join(repoRoot, 'LICENSE'), join(stageRoot, 'LICENSE'))

  mkdirSync(dirname(outputPath), { recursive: true })
  const archive = spawnSync('tar', ['-czf', outputPath, '-C', stageRoot, '.'], {
    encoding: 'utf8',
  })
  if (archive.error) throw archive.error
  if (archive.status !== 0) {
    throw new Error(`tar failed: ${archive.stderr || archive.stdout}`)
  }
  console.log(outputPath)
} finally {
  rmSync(stageRoot, { recursive: true, force: true })
}
