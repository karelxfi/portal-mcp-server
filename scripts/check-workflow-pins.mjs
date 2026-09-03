#!/usr/bin/env node
/* Offline gate for workflow supply-chain hygiene: every third-party action is
   pinned to a full commit SHA with a version comment, every checkout drops its
   credentials, and every workflow starts from an empty permission set.

   The workflows are parsed as YAML rather than scanned as text. Three rounds
   of review holed the text scanner in three different ways — a flow mapping it
   could not see, a `with:` written inside a block scalar that it mistook for
   the step's own, a comment that ended a step early — and each fix opened
   another gap. Asking a parser what the step actually is removes that whole
   class of question. */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { LineCounter, isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml'

/** `persist-credentials` is an action input, so GitHub reads it as a string. */
const DISABLED_CREDENTIALS = new Set(['false'])

function lineOf(lineCounter, node) {
  const offset = node?.range?.[0]
  return offset === undefined ? 0 : lineCounter.linePos(offset).line
}

function pairFor(map, key) {
  return isMap(map) ? map.items.find((item) => isPair(item) && isScalar(item.key) && item.key.value === key) : undefined
}

/**
 * The trailing comment on `uses:`, which is where the version is recorded. The
 * parser hands back the comment text without its leading `#`, so the version
 * is matched on the text itself.
 */
function trailingComment(pair, step) {
  // A flow-mapping step carries the line's comment on the step itself, since
  // there is only one line for the whole mapping.
  return [pair?.value?.comment, pair?.comment, step?.comment].filter(Boolean).join(' ')
}

/*
 * `resolved` is the step as plain JavaScript, which is where the checks read
 * their values: it has anchors, aliases and merge keys already applied, so a
 * `with: *defaults` block is the mapping it stands for rather than an alias
 * node the AST walk would find empty. `node` is the same step in the syntax
 * tree, used only for the line number and for the version comment, which the
 * plain value cannot carry.
 */
function checkStep(file, lineCounter, resolved, node, errors) {
  if (!resolved || typeof resolved !== 'object') return
  const reference = typeof resolved.uses === 'string' ? resolved.uses.trim() : undefined
  if (reference === undefined) return

  const usesPair = pairFor(node, 'uses')
  const line = lineOf(lineCounter, usesPair?.value ?? node)
  if (reference.startsWith('./')) return

  if (!/@[0-9a-f]{40}$/.test(reference) || !/(^|\s)v\d+/.test(trailingComment(usesPair, node))) {
    errors.push(`${file}:${line}: ${reference} must be pinned to a 40-character commit SHA with a # vX.Y.Z comment`)
  }

  // GitHub resolves owner/repo case-insensitively, so the check has to as well.
  if (!reference.toLowerCase().startsWith('actions/checkout@')) return

  const withBlock = resolved.with
  const persist =
    withBlock && typeof withBlock === 'object' && !Array.isArray(withBlock)
      ? withBlock['persist-credentials']
      : undefined
  const declared = persist === undefined || persist === null ? undefined : String(persist)
  if (declared === undefined || !DISABLED_CREDENTIALS.has(declared)) {
    errors.push(
      `${file}:${line}: actions/checkout must set persist-credentials: false in its own with: block${
        declared === undefined ? '' : ` (found ${declared})`
      }`,
    )
  }
}

function checkWorkflow(file, text, errors) {
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { lineCounter, merge: true })
  if (doc.errors.length > 0) {
    errors.push(`${file}: is not valid YAML (${doc.errors[0].message})`)
    return
  }

  const workflow = doc.toJS({ maxAliasCount: -1 }) ?? {}
  const permissions = workflow.permissions
  const empty =
    permissions !== null &&
    typeof permissions === 'object' &&
    !Array.isArray(permissions) &&
    Object.keys(permissions).length === 0
  if (!empty) {
    errors.push(`${file}: workflow must start from permissions: {} and grant per job`)
  }

  const jobs = workflow.jobs
  if (!jobs || typeof jobs !== 'object') return
  const jobsNode = doc.get('jobs', true)

  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object') continue
    const jobNode = isMap(jobsNode) ? pairFor(jobsNode, jobId)?.value : undefined

    // A reusable workflow is referenced by the job's own `uses`.
    checkStep(file, lineCounter, job, jobNode, errors)

    if (!Array.isArray(job.steps)) continue
    const stepsNode = pairFor(jobNode, 'steps')?.value
    job.steps.forEach((step, index) => {
      checkStep(file, lineCounter, step, isSeq(stepsNode) ? stepsNode.items[index] : undefined, errors)
    })
  }
}

function checkWorkflows(directory) {
  const errors = []
  for (const file of readdirSync(directory)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()) {
    checkWorkflow(file, readFileSync(path.join(directory, file), 'utf8'), errors)
  }
  return errors
}

/*
 * The gate checks itself before it checks anything else. It has three times
 * reported PASS over a workflow it was not really reading, so every construct
 * that fooled it is kept as a fixture: `pass/` must raise nothing and every
 * file in `fail/` must raise something. Add the fixture before the fix.
 */
function selfTest() {
  const root = path.resolve('scripts/fixtures/workflow-pins')
  const failures = []
  const passing = readdirSync(path.join(root, 'pass')).filter((name) => /\.ya?ml$/.test(name))
  const failing = readdirSync(path.join(root, 'fail')).filter((name) => /\.ya?ml$/.test(name))

  for (const error of checkWorkflows(path.join(root, 'pass'))) {
    failures.push(`a workflow that is safe was rejected: ${error}`)
  }
  const flagged = new Set(checkWorkflows(path.join(root, 'fail')).map((error) => error.split(':')[0]))
  for (const file of failing) {
    if (!flagged.has(file)) failures.push(`a workflow that is unsafe was accepted: fail/${file}`)
  }

  return { failures, checked: passing.length + failing.length }
}

const { failures, checked } = selfTest()
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  self-test: ${failure}`)
  process.exit(1)
}

const errors = checkWorkflows(path.resolve('.github/workflows'))
if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL  ${error}`)
  process.exit(1)
}
console.log(
  `PASS  workflows pin every action by commit SHA, drop checkout credentials, and start from empty permissions (${checked} gate fixtures verified)`,
)
