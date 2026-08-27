#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const pnpmLock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')

const expected = new Map(
  Object.entries({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  }),
)
const actual = new Map()
let dependencySection = false
let dependencyName

for (const line of pnpmLock.split('\n')) {
  if (/^    (?:dependencies|devDependencies|optionalDependencies):$/.test(line)) {
    dependencySection = true
    dependencyName = undefined
    continue
  }

  if (/^    \S/.test(line)) {
    dependencySection = false
    dependencyName = undefined
    continue
  }

  if (!dependencySection) continue

  const dependencyMatch = line.match(/^      (.+):$/)
  if (dependencyMatch) {
    dependencyName = dependencyMatch[1].replace(/^['"]|['"]$/g, '')
    continue
  }

  const specifierMatch = line.match(/^        specifier: (.+)$/)
  if (dependencyName && specifierMatch) {
    actual.set(dependencyName, specifierMatch[1].replace(/^['"]|['"]$/g, ''))
  }
}

const mismatches = []
for (const [name, specifier] of expected) {
  if (actual.get(name) !== specifier) {
    mismatches.push(`${name}: package.json=${specifier}, pnpm-lock.yaml=${actual.get(name) ?? '(missing)'}`)
  }
}
for (const name of actual.keys()) {
  if (!expected.has(name)) mismatches.push(`${name}: present only in pnpm-lock.yaml`)
}

if (mismatches.length > 0) {
  console.error(`pnpm lockfile is out of sync:\n${mismatches.map((item) => `  - ${item}`).join('\n')}`)
  process.exit(1)
}

console.log(`Lockfile sync OK: ${actual.size} package specifiers match package.json`)
