#!/usr/bin/env node

// One lockfile, installed by everything that builds this repository.
//
// This repository used to carry both package-lock.json and pnpm-lock.yaml:
// CI installed from the first, the Docker image installed from the second.
// Nothing compared them, so the two trees drifted apart, and a difference only
// ever surfaced as a broken image build after every gate had gone green. This
// check keeps that from coming back: exactly one lockfile, and the Dockerfile
// installs from it.

import { readFile, stat } from 'node:fs/promises'

const repoRoot = new URL('../', import.meta.url)
const errors = []

const foreignLockfiles = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']
for (const name of foreignLockfiles) {
  const exists = await stat(new URL(name, repoRoot)).then(
    () => true,
    () => false,
  )
  if (exists) {
    errors.push(
      `${name} is present. This repository installs from package-lock.json only; a second lockfile resolves its own versions and drifts out of sight of CI.`,
    )
  }
}

const packageJson = JSON.parse(await readFile(new URL('package.json', repoRoot), 'utf8'))
const packageLock = JSON.parse(await readFile(new URL('package-lock.json', repoRoot), 'utf8'))

const declared = Object.entries({
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
  ...(packageJson.optionalDependencies ?? {}),
})

// npm ci fails outright when the lockfile does not cover package.json, but it
// fails inside the image build rather than here, where the message is useful.
const lockRoot = packageLock.packages?.['']
for (const [name, specifier] of declared) {
  const lockedSpecifier =
    lockRoot?.dependencies?.[name] ?? lockRoot?.devDependencies?.[name] ?? lockRoot?.optionalDependencies?.[name]
  if (lockedSpecifier === undefined) {
    errors.push(`${name} is declared in package.json but missing from package-lock.json. Run \`npm install\`.`)
    continue
  }
  if (lockedSpecifier !== specifier) {
    errors.push(
      `${name}: package.json=${specifier}, package-lock.json=${lockedSpecifier}. Run \`npm install\` to refresh the lockfile.`,
    )
  }
}

const dockerfile = await readFile(new URL('Dockerfile', repoRoot), 'utf8')
if (!/^COPY .*\bpackage-lock\.json\b/m.test(dockerfile)) {
  errors.push('Dockerfile does not copy package-lock.json, so the image would install an unlocked tree.')
}
if (!/^RUN npm ci\b/m.test(dockerfile)) {
  errors.push('Dockerfile does not install with `npm ci`, so the image would not build the tree CI tested.')
}

if (errors.length > 0) {
  console.error(`Lockfile check failed:\n${errors.map((item) => `  - ${item}`).join('\n')}`)
  process.exit(1)
}

console.log(`Lockfile OK: ${declared.length} declared packages locked in package-lock.json, and the image installs it`)
