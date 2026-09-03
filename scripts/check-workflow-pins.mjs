#!/usr/bin/env node
/* Offline gate for workflow supply-chain hygiene: every third-party action is
   pinned to a full commit SHA with a version comment, every checkout drops
   its credentials, and every workflow starts from an empty permission set.

   The scanner reads indentation rather than parsing YAML, so it refuses the
   constructs it cannot read instead of passing them. A gate that quietly skips
   what it does not understand is the failure this file exists to avoid. */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const indentOf = (line) => line.length - line.trimStart().length

/* A comment is not configuration. Stripping them up front, before any
   indentation is measured, keeps a full-line comment from ending a step early
   and keeps `# persist-credentials: false` from satisfying a check. Lines are
   blanked rather than removed so reported line numbers stay true. A `#` inside
   a quoted string is left alone. */
function stripComments(line) {
  let quote
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quote) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index)
  }
  return line
}

/* Every line of the list item that contains `index`, including the keys written
   above `uses:`. Reading only forward missed a step whose `with:` block came
   first; a fixed-size window read past the step entirely. */
function stepLines(lines, index) {
  let start = index
  while (start > 0 && !/^\s*-\s/.test(lines[start])) {
    if (lines[start].trim() !== '' && indentOf(lines[start]) < indentOf(lines[index])) break
    start -= 1
  }
  if (!/^\s*-\s/.test(lines[start])) start = index

  const itemIndent = indentOf(lines[start])
  const body = [{ line: lines[start].replace(/^(\s*)-\s/, '$1  '), number: start + 1 }]
  for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor].trim() === '') continue
    if (indentOf(lines[cursor]) <= itemIndent) break
    body.push({ line: lines[cursor], number: cursor + 1 })
  }
  return body
}

/* `persist-credentials: false` written as a key of this step's own `with:`
   block. Matching the text anywhere in the step accepted it as an `env:` entry,
   inside a `run:` script, or under a nested mapping. */
function dropsCheckoutCredentials(body) {
  const withEntry = body.find(({ line }) => /^\s*with:\s*$/.test(line))
  if (!withEntry) return false
  const withIndent = indentOf(withEntry.line)
  return body
    .filter(({ number }) => number > withEntry.number)
    .filter(({ line }) => indentOf(line) > withIndent)
    .some(({ line }) => indentOf(line) === withIndent + 2 && /^\s*persist-credentials:\s*false\s*$/.test(line))
}

function checkWorkflows(directory) {
  const errors = []
  for (const file of readdirSync(directory)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()) {
    const raw = readFileSync(path.join(directory, file), 'utf8')
    const lines = raw.split('\n').map(stripComments)
    const rawLines = raw.split('\n')

    if (!/^permissions:\s*\{\s*\}\s*$/m.test(lines.join('\n'))) {
      errors.push(`${file}: workflow must start from permissions: {} and grant per job`)
    }

    lines.forEach((line, index) => {
      // A flow mapping hides the step from every check below, so it is refused
      // rather than skipped.
      if (/[[{][^}\]]*\buses\s*:/.test(line)) {
        errors.push(`${file}:${index + 1}: write steps as block mappings; this gate cannot verify a flow mapping`)
        return
      }

      const match = /^\s*(?:-\s*)?uses:\s*(\S+)\s*$/.exec(line)
      if (!match) return
      const [, reference] = match
      if (reference.startsWith('./')) return

      const pinned = /@[0-9a-f]{40}$/.test(reference)
      // The version comment lives on the original line; comments are stripped above.
      const commented = /#\s*v\d+/.test(rawLines[index])
      if (!pinned || !commented) {
        errors.push(
          `${file}:${index + 1}: ${reference} must be pinned to a 40-character commit SHA with a # vX.Y.Z comment`,
        )
      }

      // GitHub resolves owner/repo case-insensitively, so the check has to as well.
      if (reference.toLowerCase().startsWith('actions/checkout@')) {
        if (!dropsCheckoutCredentials(stepLines(lines, index))) {
          errors.push(
            `${file}:${index + 1}: actions/checkout must set persist-credentials: false in its own with: block`,
          )
        }
      }
    })
  }
  return errors
}

/*
 * The gate checks itself first. It has twice reported PASS over a workflow it
 * was not really reading, so each construct that fooled it is kept as a
 * fixture: `pass/` must raise nothing and every file in `fail/` must raise
 * something. Add a fixture here before fixing a hole, not after.
 */
function selfTest() {
  const root = path.resolve('scripts/fixtures/workflow-pins')
  const failures = []
  let checked = 0

  for (const error of checkWorkflows(path.join(root, 'pass'))) {
    failures.push(`a workflow that is correct was rejected: ${error}`)
  }

  checked += readdirSync(path.join(root, 'pass')).filter((name) => /\.ya?ml$/.test(name)).length

  const flagged = new Set(checkWorkflows(path.join(root, 'fail')).map((error) => error.split(':')[0]))
  for (const file of readdirSync(path.join(root, 'fail')).filter((name) => /\.ya?ml$/.test(name))) {
    checked += 1
    if (!flagged.has(file)) failures.push(`a workflow that is unsafe was accepted: fail/${file}`)
  }

  return { failures, checked }
}

const selfTest_ = selfTest()
if (selfTest_.failures.length > 0) {
  for (const failure of selfTest_.failures) console.error(`FAIL  self-test: ${failure}`)
  process.exit(1)
}

const errors = checkWorkflows(path.resolve('.github/workflows'))
if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL  ${error}`)
  process.exit(1)
}
console.log(
  `PASS  workflows pin every action by commit SHA, drop checkout credentials, and start from empty permissions (${selfTest_.checked} gate fixtures verified)`,
)
