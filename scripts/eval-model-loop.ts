#!/usr/bin/env tsx
/* Model-in-the-loop eval.

   A model answers pinned questions through the real MCP server over stdio and is
   graded on the final answer. The run records tool calls, tokens, and wall time per
   question, writes a JSON artifact and a Markdown summary, and fails when the pass
   rate falls under the threshold or the median tool-call count rises more than the
   allowed share over the previous runs in a history directory.

   Models: the Anthropic Messages API (EVAL_MODEL, default claude-sonnet-5) or
   `mock`, which replays each case's reference calls through the server and reads the
   answer from the recorded answer path. The mock run verifies the question set and
   the harness without an API key; it does not measure a model. */

import { execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  type ConnectedTestClient,
  closeTestClient,
  connectTestClient,
  getStructuredContent,
  getText,
} from './test-helpers.ts'

type ExpectedAnswer = { type: 'number' | 'text' | 'address' | 'refusal'; value?: string }

type ReferenceCall = { tool: string; arguments: Record<string, unknown> }

type EvalCase = {
  id: string
  family: string
  question: string
  expected: ExpectedAnswer
  min_tool_calls?: number
  reference_calls: ReferenceCall[]
  answer_path?: string
  verified?: string
}

type EvalSet = {
  version: number
  description: string
  defaults: {
    max_tool_calls: number
    min_pass_rate: number
    max_tool_call_growth: number
    refusal_phrases: string[]
  }
  cases: EvalCase[]
}

type ToolCallRecord = {
  tool: string
  arguments: Record<string, unknown>
  is_error: boolean
  elapsed_ms: number
  error_code?: string
}

type ModelRun = {
  answer_text: string
  tool_calls: ToolCallRecord[]
  input_tokens: number
  output_tokens: number
  turns: number
}

type CaseResult = {
  id: string
  family: string
  passed: boolean
  expected: ExpectedAnswer
  answer_line: string
  answer_text: string
  tool_call_count: number
  min_tool_calls: number
  tool_calls: ToolCallRecord[]
  input_tokens: number
  output_tokens: number
  wall_ms: number
  error?: string
}

type RunArtifact = {
  version: 1
  run: {
    model: string
    eval_set: string
    eval_set_version: number
    started_at: string
    finished_at: string
    git_commit: string
    server_version: string
    tool_count: number
    max_tool_calls: number
  }
  summary: {
    cases: number
    passed: number
    failed: number
    pass_rate: number
    min_pass_rate: number
    median_tool_calls: number
    baseline_median_tool_calls: number | null
    max_tool_call_growth: number
    history_runs: number
    total_input_tokens: number
    total_output_tokens: number
    wall_ms: number
    verdict: 'pass' | 'fail'
    reasons: string[]
  }
  cases: CaseResult[]
}

const SYSTEM_PROMPT = [
  'You answer blockchain questions with the SQD Portal tools available to you.',
  'Use the tools for every fact; never answer from memory.',
  'Check _coverage and _pagination before treating a count as complete.',
  'When the tools cannot answer (unknown network, invalid input, a window outside the indexed data), say so plainly instead of guessing.',
  'Finish with one line of the form "ANSWER: <value>" holding only the value asked for (a number, an address, a name), or "ANSWER: cannot answer" when the question cannot be answered, followed by at most two sentences of justification.',
].join(' ')

const MAX_TOOL_RESULT_CHARS = 16_000
const MAX_TURNS = 16
const CASE_BUDGET_MS = 240_000
const DEFAULT_ENDPOINT = 'https://api.anthropic.com'
const DEFAULT_MODEL = 'claude-sonnet-5'

function parseArgs(argv: string[]) {
  const options: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      options[key] = next
      index += 1
    } else {
      options[key] = 'true'
    }
  }
  return options
}

function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return process.env.GITHUB_SHA ?? 'unknown'
  }
}

function getPath(value: unknown, pathExpression: string): unknown {
  const segments = pathExpression
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0)
  let current: unknown = value
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function extractAnswerLine(text: string): string {
  const matches = [...text.matchAll(/ANSWER:\s*(.+)/gi)]
  if (matches.length > 0) return matches[matches.length - 1][1].trim()
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines[lines.length - 1] ?? ''
}

function numberTokens(text: string): string[] {
  return (text.match(/-?\d[\d,_ ]*(?:\.\d+)?/g) ?? []).map((token) => token.replace(/[,_ ]/g, ''))
}

function grade(
  evalCase: EvalCase,
  answerText: string,
  refusalPhrases: string[],
): { passed: boolean; answerLine: string } {
  const answerLine = extractAnswerLine(answerText)
  const expected = evalCase.expected
  switch (expected.type) {
    case 'number': {
      const target = String(expected.value ?? '').replace(/[,_ ]/g, '')
      return { passed: numberTokens(answerLine).includes(target), answerLine }
    }
    case 'address':
      return { passed: answerLine.toLowerCase().includes(String(expected.value ?? '').toLowerCase()), answerLine }
    case 'text': {
      const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()
      return { passed: normalize(answerLine).includes(normalize(String(expected.value ?? ''))), answerLine }
    }
    case 'refusal': {
      const haystack = answerText.toLowerCase()
      return { passed: refusalPhrases.some((phrase) => haystack.includes(phrase.toLowerCase())), answerLine }
    }
    default:
      return { passed: false, answerLine }
  }
}

function summarizeToolResult(result: unknown): { text: string; isError: boolean; errorCode?: string } {
  const text = getText(result)
  const structured = getStructuredContent(result)
  const error = structured?.error
  const isError = Boolean((result as { isError?: boolean })?.isError) || text.startsWith('Error:')
  const errorCode = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined
  const body = structured ? JSON.stringify(structured) : text
  return {
    text: body.length > MAX_TOOL_RESULT_CHARS ? `${body.slice(0, MAX_TOOL_RESULT_CHARS)}…` : body,
    isError,
    errorCode,
  }
}

async function callTool(
  connected: ConnectedTestClient,
  tool: string,
  args: Record<string, unknown>,
  records: ToolCallRecord[],
) {
  const started = Date.now()
  let result: unknown
  try {
    result = await connected.client.callTool({ name: tool, arguments: args }, { timeout: 90_000 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    records.push({
      tool,
      arguments: args,
      is_error: true,
      elapsed_ms: Date.now() - started,
      error_code: 'transport_error',
    })
    return { text: `Error: ${message}`, isError: true, structured: undefined as Record<string, unknown> | undefined }
  }
  const summary = summarizeToolResult(result)
  records.push({
    tool,
    arguments: args,
    is_error: summary.isError,
    elapsed_ms: Date.now() - started,
    ...(summary.errorCode ? { error_code: summary.errorCode } : {}),
  })
  return { ...summary, structured: getStructuredContent(result) }
}

async function runMockModel(connected: ConnectedTestClient, evalCase: EvalCase): Promise<ModelRun> {
  const records: ToolCallRecord[] = []
  let last: Awaited<ReturnType<typeof callTool>> | undefined
  for (const reference of evalCase.reference_calls) {
    last = await callTool(connected, reference.tool, reference.arguments, records)
  }
  let answer: string
  if (evalCase.expected.type === 'refusal') {
    const summary = last?.structured?.error?.summary
    answer = last?.isError
      ? `ANSWER: cannot answer (${summary ?? 'the tool returned an error'})`
      : 'ANSWER: the tool returned data'
  } else if (last?.isError) {
    answer = `ANSWER: cannot answer (${last.structured?.error?.summary ?? last.text.slice(0, 200)})`
  } else {
    const value = evalCase.answer_path ? getPath(last?.structured, evalCase.answer_path) : undefined
    answer = `ANSWER: ${value === undefined ? 'missing answer path' : String(value)}`
  }
  return { answer_text: answer, tool_calls: records, input_tokens: 0, output_tokens: 0, turns: records.length }
}

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicContent[] }

async function postMessages(endpoint: string, apiKey: string, body: Record<string, unknown>) {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
    if (response.ok) return (await response.json()) as Record<string, any>
    const text = await response.text()
    lastError = new Error(`Anthropic API ${response.status}: ${text.slice(0, 400)}`)
    if (response.status === 429 || response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
      continue
    }
    throw lastError
  }
  throw lastError ?? new Error('Anthropic API request failed')
}

async function runAnthropicModel(
  connected: ConnectedTestClient,
  evalCase: EvalCase,
  toolDefinitions: Record<string, unknown>[],
  options: { model: string; endpoint: string; apiKey: string; maxToolCalls: number },
): Promise<ModelRun> {
  const records: ToolCallRecord[] = []
  const messages: AnthropicMessage[] = [{ role: 'user', content: evalCase.question }]
  let inputTokens = 0
  let outputTokens = 0
  let turns = 0
  let answerText = ''

  while (turns < MAX_TURNS) {
    turns += 1
    const budgetExhausted = records.length >= options.maxToolCalls
    if (budgetExhausted && turns > 1) {
      messages.push({
        role: 'user',
        content: 'The tool budget is used up. Give the final ANSWER line now from the results you already have.',
      })
    }
    const response = await postMessages(options.endpoint, options.apiKey, {
      model: options.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages,
      ...(budgetExhausted ? { tool_choice: { type: 'none' } } : {}),
    })
    inputTokens += Number(response.usage?.input_tokens ?? 0)
    outputTokens += Number(response.usage?.output_tokens ?? 0)
    const content = (response.content ?? []) as AnthropicContent[]
    messages.push({ role: 'assistant', content })
    const toolUses = content.filter(
      (block): block is Extract<AnthropicContent, { type: 'tool_use' }> => block.type === 'tool_use',
    )
    const text = content
      .filter((block): block is Extract<AnthropicContent, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      answerText = text
      break
    }
    const results: AnthropicContent[] = []
    for (const use of toolUses) {
      const result = await callTool(connected, use.name, use.input ?? {}, records)
      results.push({ type: 'tool_result', tool_use_id: use.id, content: result.text, is_error: result.isError })
    }
    messages.push({ role: 'user', content: results })
  }

  return { answer_text: answerText, tool_calls: records, input_tokens: inputTokens, output_tokens: outputTokens, turns }
}

function loadHistory(directory: string | undefined): number[] {
  if (!directory || !existsSync(directory)) return []
  const medians: number[] = []
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry)
      if (statSync(full).isDirectory()) {
        visit(full)
        continue
      }
      if (!entry.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(readFileSync(full, 'utf8')) as Partial<RunArtifact>
        const value = parsed?.summary?.median_tool_calls
        if (parsed?.version === 1 && typeof value === 'number' && parsed.run?.model !== 'mock') medians.push(value)
      } catch {
        // Ignore files that are not eval artifacts.
      }
    }
  }
  visit(directory)
  return medians
}

function renderMarkdown(artifact: RunArtifact): string {
  const { run, summary } = artifact
  const lines = [
    `## Model-in-the-loop eval: ${summary.verdict.toUpperCase()}`,
    '',
    `Model \`${run.model}\`, server ${run.server_version}, ${run.tool_count} tools, commit \`${run.git_commit.slice(0, 12)}\`.`,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Cases passed | ${summary.passed} / ${summary.cases} (${(summary.pass_rate * 100).toFixed(1)}%, threshold ${(summary.min_pass_rate * 100).toFixed(0)}%) |`,
    `| Median tool calls | ${summary.median_tool_calls}${summary.baseline_median_tool_calls === null ? ' (no history)' : ` (previous ${summary.baseline_median_tool_calls} over ${summary.history_runs} runs, limit +${(summary.max_tool_call_growth * 100).toFixed(0)}%)`} |`,
    `| Tokens | ${summary.total_input_tokens} in, ${summary.total_output_tokens} out |`,
    `| Wall time | ${(summary.wall_ms / 1000).toFixed(1)} s |`,
    '',
    '| Case | Family | Result | Tool calls | Tokens | Time | Answer |',
    '|---|---|---|---:|---:|---:|---|',
  ]
  for (const item of artifact.cases) {
    const answer = (item.error ? `error: ${item.error}` : item.answer_line).replace(/\|/g, '\\|').slice(0, 80)
    lines.push(
      `| ${item.id} | ${item.family} | ${item.passed ? 'pass' : 'FAIL'} | ${item.tool_call_count} | ${item.input_tokens + item.output_tokens} | ${(item.wall_ms / 1000).toFixed(1)} s | ${answer} |`,
    )
  }
  if (summary.reasons.length > 0) {
    lines.push('', ...summary.reasons.map((reason) => `- ${reason}`))
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const setPath = options.set ?? 'evals/portal-mcp.json'
  const model = options.model ?? process.env.EVAL_MODEL ?? DEFAULT_MODEL
  const endpoint = options.endpoint ?? process.env.EVAL_ENDPOINT ?? DEFAULT_ENDPOINT
  const outDir = options.out ?? 'artifacts/model-eval'
  const historyDir = options.history ?? process.env.EVAL_HISTORY_DIR
  const only = options.only ? new Set(options.only.split(',').map((value) => value.trim())) : undefined
  const evalSet = JSON.parse(readFileSync(setPath, 'utf8')) as EvalSet
  const maxToolCalls = readNumber(
    options['max-tool-calls'] ?? process.env.EVAL_MAX_TOOL_CALLS,
    evalSet.defaults.max_tool_calls,
  )
  const minPassRate = readNumber(process.env.EVAL_MIN_PASS_RATE, evalSet.defaults.min_pass_rate)
  const maxGrowth = readNumber(process.env.EVAL_MAX_TOOL_CALL_GROWTH, evalSet.defaults.max_tool_call_growth)
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''

  if (model !== 'mock' && !apiKey) {
    console.error(
      'FAIL  ANTHROPIC_API_KEY is not set; run with --model mock to verify the question set without a model',
    )
    process.exit(2)
  }

  const cases = evalSet.cases.filter((item) => !only || only.has(item.id))
  if (cases.length === 0) {
    console.error('FAIL  no cases selected')
    process.exit(2)
  }

  const serverEnv: Record<string, string> = {}
  for (const key of ['PORTAL_URL', 'PORTAL_API_KEY', 'MCP_TOOLSETS', 'MCP_TOOLS']) {
    if (process.env[key]) serverEnv[key] = process.env[key] as string
  }
  const connected = await connectTestClient('model-loop-eval', { env: serverEnv })
  const startedAt = new Date()
  const results: CaseResult[] = []
  let serverVersion = 'unknown'
  let toolDefinitions: Record<string, unknown>[] = []
  try {
    const listed = await connected.client.listTools()
    toolDefinitions = listed.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      input_schema: tool.inputSchema,
    }))
    serverVersion = String(
      (connected.client.getServerVersion() as { version?: string } | undefined)?.version ?? 'unknown',
    )
    console.log(
      `Model ${model}; ${toolDefinitions.length} tools; ${cases.length} cases; tool budget ${maxToolCalls} per case`,
    )

    for (const evalCase of cases) {
      const caseStarted = Date.now()
      let run: ModelRun | undefined
      let error: string | undefined
      try {
        const work =
          model === 'mock'
            ? runMockModel(connected, evalCase)
            : runAnthropicModel(connected, evalCase, toolDefinitions, { model, endpoint, apiKey, maxToolCalls })
        run = await Promise.race([
          work,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`case exceeded ${CASE_BUDGET_MS}ms`)), CASE_BUDGET_MS),
          ),
        ])
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught)
      }
      const answerText = run?.answer_text ?? ''
      const graded = error
        ? { passed: false, answerLine: '' }
        : grade(evalCase, answerText, evalSet.defaults.refusal_phrases)
      const result: CaseResult = {
        id: evalCase.id,
        family: evalCase.family,
        passed: graded.passed,
        expected: evalCase.expected,
        answer_line: graded.answerLine,
        answer_text: answerText.slice(0, 2_000),
        tool_call_count: run?.tool_calls.length ?? 0,
        min_tool_calls: evalCase.min_tool_calls ?? 1,
        tool_calls: run?.tool_calls ?? [],
        input_tokens: run?.input_tokens ?? 0,
        output_tokens: run?.output_tokens ?? 0,
        wall_ms: Date.now() - caseStarted,
        ...(error ? { error } : {}),
      }
      results.push(result)
      const tools = result.tool_calls.map((call) => `${call.tool}${call.is_error ? '!' : ''}`).join(', ')
      console.log(
        `${result.passed ? 'PASS' : 'FAIL'}  ${evalCase.id.padEnd(40)} ${String(result.tool_call_count).padStart(2)} calls  ${String(result.wall_ms).padStart(6)} ms  ${error ? `error: ${error}` : `answer: ${result.answer_line.slice(0, 60)}`}${tools ? `  [${tools}]` : ''}`,
      )
    }
  } finally {
    await closeTestClient(connected)
  }

  const finishedAt = new Date()
  const passed = results.filter((item) => item.passed).length
  const passRate = results.length === 0 ? 0 : passed / results.length
  const medianToolCalls = median(results.map((item) => item.tool_call_count))
  const history = loadHistory(historyDir)
  const baseline = history.length > 0 ? median(history) : null
  const reasons: string[] = []
  if (passRate < minPassRate) {
    reasons.push(`pass rate ${(passRate * 100).toFixed(1)}% is under the ${(minPassRate * 100).toFixed(0)}% threshold`)
  }
  if (baseline !== null && baseline > 0 && medianToolCalls > baseline * (1 + maxGrowth)) {
    reasons.push(
      `median tool calls ${medianToolCalls} rose more than ${(maxGrowth * 100).toFixed(0)}% over the previous ${history.length} runs (${baseline})`,
    )
  }
  const underCalled = results.filter((item) => item.passed && item.tool_call_count < item.min_tool_calls)
  if (underCalled.length > 0) {
    reasons.push(
      `note: ${underCalled.length} case(s) passed with fewer tool calls than the reference path: ${underCalled.map((item) => item.id).join(', ')}`,
    )
  }
  const verdict: 'pass' | 'fail' = reasons.some((reason) => !reason.startsWith('note:')) ? 'fail' : 'pass'

  const artifact: RunArtifact = {
    version: 1,
    run: {
      model,
      eval_set: setPath,
      eval_set_version: evalSet.version,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      git_commit: gitCommit(),
      server_version: serverVersion,
      tool_count: toolDefinitions.length,
      max_tool_calls: maxToolCalls,
    },
    summary: {
      cases: results.length,
      passed,
      failed: results.length - passed,
      pass_rate: Number(passRate.toFixed(4)),
      min_pass_rate: minPassRate,
      median_tool_calls: medianToolCalls,
      baseline_median_tool_calls: baseline,
      max_tool_call_growth: maxGrowth,
      history_runs: history.length,
      total_input_tokens: results.reduce((sum, item) => sum + item.input_tokens, 0),
      total_output_tokens: results.reduce((sum, item) => sum + item.output_tokens, 0),
      wall_ms: finishedAt.getTime() - startedAt.getTime(),
      verdict,
      reasons,
    },
    cases: results,
  }

  mkdirSync(outDir, { recursive: true })
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(outDir, `model-eval-${model.replace(/[^a-z0-9.-]+/gi, '_')}-${stamp}.json`)
  const markdown = renderMarkdown(artifact)
  writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`)
  writeFileSync(path.join(outDir, 'latest.md'), markdown)
  writeFileSync(path.join(outDir, 'latest.json'), `${JSON.stringify(artifact, null, 2)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  console.log(`\n${markdown}`)
  console.log(`Artifact: ${jsonPath}`)
  if (verdict === 'fail') process.exit(1)
}

main().catch((error) => {
  console.error(`FAIL  ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  process.exit(2)
})
