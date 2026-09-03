#!/usr/bin/env node
/* Offline gate for workflow supply-chain hygiene: every third-party action is
   pinned to a full commit SHA with a version comment, every checkout drops
   its credentials, and every workflow starts from an empty permission set. */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const directory = path.resolve('.github/workflows')
const errors = []

/* The lines that belong to the step introduced on `index`. A fixed-size window
   read whatever followed, so a `persist-credentials: false` on a later step
   could satisfy an earlier checkout, and a checkout with more than a handful
   of `with:` keys could fail while setting it correctly. A step body is every
   following line indented at least as far as the step's own keys. */
function stepBody(lines, index) {
  const keyIndent = lines[index].length - lines[index].replace(/^[\s-]*/, '').length
  const body = []
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (indent < keyIndent) break
    body.push(line)
  }
  return body.join('\n')
}

for (const file of readdirSync(directory)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()) {
  const text = readFileSync(path.join(directory, file), 'utf8')
  const lines = text.split('\n')
  if (!/^permissions: \{\}$/m.test(text)) {
    errors.push(`${file}: workflow must start from permissions: {} and grant per job`)
  }
  lines.forEach((line, index) => {
    const match = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line)
    if (!match) return
    const [, reference, rest] = match
    if (reference.startsWith('./')) return
    const pinned = /@[0-9a-f]{40}$/.test(reference)
    const commented = /#\s*v\d+/.test(rest)
    if (!pinned || !commented) {
      errors.push(
        `${file}:${index + 1}: ${reference} must be pinned to a 40-character commit SHA with a # vX.Y.Z comment`,
      )
    }
    if (reference.startsWith('actions/checkout@')) {
      if (!/persist-credentials:\s*false/.test(stepBody(lines, index))) {
        errors.push(`${file}:${index + 1}: actions/checkout must set persist-credentials: false`)
      }
    }
  })
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL  ${error}`)
  process.exit(1)
}
console.log(
  'PASS  workflows pin every action by commit SHA, drop checkout credentials, and start from empty permissions',
)
