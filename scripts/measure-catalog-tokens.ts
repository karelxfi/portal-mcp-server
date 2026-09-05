#!/usr/bin/env tsx
// ============================================================================
// Catalog token gate
// ============================================================================
//
// Every connected client pays for tools/list, prompts/list, and resources/list
// on each session. This script measures that cost per tool and per surface
// (App disabled, App enabled), compares it with the committed baseline, and
// fails when the total or any single tool grows more than the allowed share.
//
//   npm run test:catalog-tokens                 gate against scripts/catalog-token-baseline.json
//   npm run baseline:catalog-tokens -- --note "why the catalog changed"
//                                               refresh the baseline (a note is required)
//
// Counts come from the o200k_base tokenizer (gpt-tokenizer), which is
// deterministic and offline. When ANTHROPIC_API_KEY is set, the Anthropic
// token-count API is asked for the same surfaces and its numbers are printed
// beside the local ones; the gate itself always uses the local count so a
// pull request cannot fail because an API changed.

import { appendFile, readFile, writeFile } from 'node:fs/promises'

import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'

import { createPortalServer } from '../src/server.js'

const BASELINE_PATH = new URL('./catalog-token-baseline.json', import.meta.url)
const MAX_GROWTH_RATIO = 0.05
const TOKENIZER = 'o200k_base'

type Surface = 'app_disabled' | 'app_enabled'

interface ToolCost {
  name: string
  total: number
  description: number
  input_schema: number
  output_schema: number
  annotations: number
  meta: number
  other: number
}

interface SurfaceMeasurement {
  tools_total: number
  prompts_total: number
  resources_total: number
  instructions_total: number
  catalog_total: number
  tool_count: number
  tools: ToolCost[]
}

interface Baseline {
  tokenizer: string
  max_growth_ratio: number
  generated_at: string
  note: string
  surfaces: Record<Surface, SurfaceMeasurement>
}

function countTokens(value: unknown): number {
  if (value === undefined) return 0
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return encode(text).length
}

async function measureSurface(surface: Surface): Promise<SurfaceMeasurement> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createPortalServer({ transport: 'stdio', appEnabled: surface === 'app_enabled' })
  const client = new Client({ name: `sqd-catalog-tokens-${surface}`, version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const [tools, prompts, resources] = await Promise.all([
      client.listTools(),
      client.listPrompts().catch(() => ({ prompts: [] })),
      client.listResources().catch(() => ({ resources: [] })),
    ])
    const toolCosts: ToolCost[] = tools.tools
      .map((tool) => {
        const { name, description, inputSchema, outputSchema, annotations, _meta, ...rest } = tool as Record<
          string,
          unknown
        > & { name: string }
        const cost = {
          name,
          description: countTokens(description),
          input_schema: countTokens(inputSchema),
          output_schema: countTokens(outputSchema),
          annotations: countTokens(annotations),
          meta: countTokens(_meta),
          other: countTokens(rest),
          total: countTokens(tool),
        }
        return cost
      })
      .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name))
    const toolsTotal = countTokens(tools.tools)
    const promptsTotal = countTokens(prompts.prompts)
    const resourcesTotal = countTokens(resources.resources)
    const instructionsTotal = countTokens(client.getInstructions() ?? '')
    return {
      tools_total: toolsTotal,
      prompts_total: promptsTotal,
      resources_total: resourcesTotal,
      instructions_total: instructionsTotal,
      catalog_total: toolsTotal + promptsTotal + resourcesTotal + instructionsTotal,
      tool_count: tools.tools.length,
      tools: toolCosts,
    }
  } finally {
    await client.close()
    await server.close()
  }
}

async function countWithAnthropic(surface: Surface): Promise<number | undefined> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return undefined
  const model = process.env.ANTHROPIC_TOKEN_COUNT_MODEL || 'claude-sonnet-5'
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createPortalServer({ transport: 'stdio', appEnabled: surface === 'app_enabled' })
  const client = new Client({ name: `sqd-catalog-tokens-api-${surface}`, version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const tools = (await client.listTools()).tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      input_schema: tool.inputSchema,
    }))
    const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        system: client.getInstructions() ?? '',
        tools,
        messages: [{ role: 'user', content: 'List the networks you support.' }],
      }),
    })
    if (!response.ok) {
      console.warn(`Anthropic token count skipped: ${response.status} ${await response.text()}`)
      return undefined
    }
    const payload = (await response.json()) as { input_tokens?: number }
    return payload.input_tokens
  } finally {
    await client.close()
    await server.close()
  }
}

function formatDelta(current: number, previous: number | undefined): string {
  if (previous === undefined) return 'new'
  const delta = current - previous
  const ratio = previous === 0 ? 0 : delta / previous
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta} (${sign}${(ratio * 100).toFixed(1)}%)`
}

function renderTable(surface: Surface, current: SurfaceMeasurement, baseline?: SurfaceMeasurement): string {
  const previousByName = new Map((baseline?.tools ?? []).map((tool) => [tool.name, tool]))
  const lines = [
    `### ${surface === 'app_enabled' ? 'App enabled' : 'App disabled'} (${TOKENIZER})`,
    '',
    '| Item | Tokens | Baseline | Delta |',
    '|---|---:|---:|---|',
    `| Catalog total | ${current.catalog_total} | ${baseline?.catalog_total ?? ''} | ${formatDelta(current.catalog_total, baseline?.catalog_total)} |`,
    `| tools/list | ${current.tools_total} | ${baseline?.tools_total ?? ''} | ${formatDelta(current.tools_total, baseline?.tools_total)} |`,
    `| prompts/list | ${current.prompts_total} | ${baseline?.prompts_total ?? ''} | ${formatDelta(current.prompts_total, baseline?.prompts_total)} |`,
    `| resources/list | ${current.resources_total} | ${baseline?.resources_total ?? ''} | ${formatDelta(current.resources_total, baseline?.resources_total)} |`,
    `| instructions | ${current.instructions_total} | ${baseline?.instructions_total ?? ''} | ${formatDelta(current.instructions_total, baseline?.instructions_total)} |`,
    '',
    '| Tool (top ten) | Total | Description | Input | Output | Meta | Baseline | Delta |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
  ]
  for (const tool of current.tools.slice(0, 10)) {
    const previous = previousByName.get(tool.name)
    lines.push(
      `| ${tool.name} | ${tool.total} | ${tool.description} | ${tool.input_schema} | ${tool.output_schema} | ${tool.meta} | ${previous?.total ?? ''} | ${formatDelta(tool.total, previous?.total)} |`,
    )
  }
  return lines.join('\n')
}

function findRegressions(current: SurfaceMeasurement, baseline: SurfaceMeasurement, surface: Surface): string[] {
  const failures: string[] = []
  const limit = (previous: number) => Math.floor(previous * (1 + MAX_GROWTH_RATIO))
  if (current.catalog_total > limit(baseline.catalog_total)) {
    failures.push(
      `${surface}: catalog total ${current.catalog_total} exceeds baseline ${baseline.catalog_total} by more than ${MAX_GROWTH_RATIO * 100}%`,
    )
  }
  const previousByName = new Map(baseline.tools.map((tool) => [tool.name, tool]))
  for (const tool of current.tools) {
    const previous = previousByName.get(tool.name)
    if (!previous) {
      failures.push(`${surface}: ${tool.name} is not in the baseline; refresh it with a note`)
      continue
    }
    if (tool.total > limit(previous.total)) {
      failures.push(
        `${surface}: ${tool.name} costs ${tool.total} tokens, baseline ${previous.total}, more than ${MAX_GROWTH_RATIO * 100}% growth`,
      )
    }
  }
  for (const previous of baseline.tools) {
    if (!current.tools.some((tool) => tool.name === previous.name)) {
      failures.push(`${surface}: ${previous.name} left the catalog; refresh the baseline with a note`)
    }
  }
  return failures
}

async function readBaseline(): Promise<Baseline | undefined> {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as Baseline
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  const writeBaseline = args.includes('--write')
  const noteIndex = args.indexOf('--note')
  const note = noteIndex === -1 ? '' : (args[noteIndex + 1] ?? '').trim()

  const surfaces: Surface[] = ['app_disabled', 'app_enabled']
  const current = {} as Record<Surface, SurfaceMeasurement>
  for (const surface of surfaces) current[surface] = await measureSurface(surface)

  const baseline = await readBaseline()
  const sections: string[] = ['## Catalog token cost', '']
  for (const surface of surfaces) {
    sections.push(renderTable(surface, current[surface], baseline?.surfaces[surface]), '')
    const apiTokens = await countWithAnthropic(surface)
    if (apiTokens !== undefined) {
      sections.push(
        `Anthropic count_tokens (${process.env.ANTHROPIC_TOKEN_COUNT_MODEL || 'claude-sonnet-5'}, tools plus instructions): ${apiTokens} input tokens`,
        '',
      )
    }
  }
  const report = sections.join('\n')
  console.log(report)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`)
  }

  if (writeBaseline) {
    if (!note) {
      throw new Error('Refreshing the baseline needs --note "<why the catalog cost changed>" and a CHANGELOG entry')
    }
    const next: Baseline = {
      tokenizer: TOKENIZER,
      max_growth_ratio: MAX_GROWTH_RATIO,
      generated_at: new Date().toISOString(),
      note,
      surfaces: current,
    }
    await writeFile(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`\nBaseline written to ${BASELINE_PATH.pathname}`)
    return
  }

  if (!baseline) {
    throw new Error('No baseline. Run: npm run baseline:catalog-tokens -- --note "initial baseline"')
  }
  if (baseline.tokenizer !== TOKENIZER) {
    throw new Error(`Baseline tokenizer ${baseline.tokenizer} differs from ${TOKENIZER}; refresh the baseline`)
  }
  const failures = surfaces.flatMap((surface) => findRegressions(current[surface], baseline.surfaces[surface], surface))
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL  ${failure}`)
    console.error(
      '\nThe catalog grew more than the allowed share. Trim the description or schema, or refresh the baseline deliberately with `npm run baseline:catalog-tokens -- --note "<why>"` and a CHANGELOG entry.',
    )
    process.exitCode = 1
    return
  }
  console.log(
    `\nPASS  catalog cost within ${MAX_GROWTH_RATIO * 100}% of the baseline (${baseline.generated_at}: ${baseline.note})`,
  )
}

main().catch((error) => {
  console.error('Catalog token gate failed:', error)
  process.exitCode = 1
})
