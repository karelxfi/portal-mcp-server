#!/usr/bin/env node
/* Prints the CHANGELOG.md section for one released version so the GitHub
   release body is the changelog entry, not a second hand-written text.
   Usage: node scripts/extract-changelog-section.mjs 0.8.5 */

import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: extract-changelog-section.mjs <X.Y.Z>')
  process.exit(1)
}

const text = readFileSync('CHANGELOG.md', 'utf8')
const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2}|Unreleased)$`, 'm')
const start = heading.exec(text)
if (!start) {
  console.error(`CHANGELOG.md has no entry for ${version}`)
  process.exit(1)
}
if (start[1] === 'Unreleased') {
  console.error(`CHANGELOG.md entry for ${version} is still marked Unreleased; run the release script first`)
  process.exit(1)
}
const bodyStart = start.index + start[0].length
const next = /^## \[/m.exec(text.slice(bodyStart))
const body = text.slice(bodyStart, next ? bodyStart + next.index : undefined).trim()
if (!body) {
  console.error(`CHANGELOG.md entry for ${version} is empty`)
  process.exit(1)
}
process.stdout.write(`${body}\n`)
