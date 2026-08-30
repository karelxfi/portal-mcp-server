#!/usr/bin/env tsx

import { readFileSync } from 'node:fs'
import type { Client } from '@modelcontextprotocol/client'

import { TOOL_SPECS, loadToolTestContext } from './tool-manifest.ts'
import {
  assert,
  assertChatSurface,
  callToolWithRetry,
  classifySpeed,
  closeTestClient,
  connectTestClient,
  hasLegacyWording,
  parseToolResultData,
  printSection,
  truncateText,
} from './test-helpers.ts'

type QualityWarning = {
  tool: string
  message: string
}

type ResponseSizeSample = {
  tool: string
  pass: 'cold' | 'warm'
  chars: number
}

type QualityBaseline = {
  version: string
  captured_at: string
  passes: Array<'cold' | 'warm'>
  aggregate?: {
    median_chars: number
    p90_chars: number
    max_median_chars: number
    max_p90_chars: number
  }
  tools: Record<string, {
    median_chars: number
    p95_chars: number
    max_median_chars: number
    max_p95_chars: number
  }>
}

const HARD_LATENCY_BUDGET_MS: Record<string, number> = {
  discover: 4_000,
  lookup: 4_000,
  query: 10_000,
  summary: 12_000,
  analytics: 12_000,
  chart: 12_000,
  debug: 12_000,
}

const SOFT_LATENCY_BUDGET_MS: Record<string, number> = {
  discover: 1_500,
  lookup: 1_500,
  query: 4_000,
  summary: 5_000,
  analytics: 6_000,
  chart: 6_000,
  debug: 6_000,
}

const TOOL_LATENCY_BUDGET_MS: Record<string, { soft: number; hard: number }> = {
  portal_get_time_series: { soft: 3_000, hard: 8_000 },
  portal_get_wallet_summary: { soft: 1_500, hard: 4_000 },
  portal_evm_get_analytics: { soft: 3_000, hard: 8_000 },
}

const QUALITY_BASELINE_PATH = new URL('./quality-baseline-v0.7.9.json', import.meta.url)

function getIntent(data: any): string {
  return typeof data?._tool_contract?.intent === 'string' ? data._tool_contract.intent : 'query'
}

function getHardLatencyBudget(intent: string, toolName: string) {
  return TOOL_LATENCY_BUDGET_MS[toolName]?.hard ?? HARD_LATENCY_BUDGET_MS[intent] ?? 10_000
}

function getSoftLatencyBudget(intent: string, toolName: string) {
  return TOOL_LATENCY_BUDGET_MS[toolName]?.soft ?? SOFT_LATENCY_BUDGET_MS[intent] ?? 5_000
}

function getResponseSizeBudget(data: any) {
  const intent = getIntent(data)
  return intent === 'query' || intent === 'debug' ? 90_000 : 45_000
}

function hasExplicitResponseFormat(args: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(args, 'response_format')
}

function answerDisclosesPartialWindow(answer: unknown) {
  return /\b(partial|incomplete|coverage|analyzed\b.*\brequested|only\b.*\brequested)\b/i.test(String(answer ?? ''))
}

function answerDisclosesPreview(answer: unknown) {
  return /\b(preview|cursor|continue|more matching|older results|limited to)\b/i.test(String(answer ?? ''))
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function loadQualityBaseline(): QualityBaseline {
  try {
    return JSON.parse(readFileSync(QUALITY_BASELINE_PATH, 'utf8')) as QualityBaseline
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to load quality baseline ${QUALITY_BASELINE_PATH.pathname}: ${message}`)
  }
}

function summarizeResponseSizes(responseSizes: ResponseSizeSample[]) {
  const byTool = new Map<string, number[]>()
  for (const sample of responseSizes) {
    const values = byTool.get(sample.tool) ?? []
    values.push(sample.chars)
    byTool.set(sample.tool, values)
  }

  return [...byTool.entries()]
    .map(([tool, values]) => ({
      tool,
      median: percentile(values, 50),
      p95: percentile(values, 95),
      samples: values.length,
      max: Math.max(...values),
    }))
    .sort((left, right) => left.tool.localeCompare(right.tool))
}

function validateResponseSizeBaseline(
  responseSizes: ResponseSizeSample[],
  baseline: QualityBaseline,
  failures: QualityWarning[],
) {
  const observed = summarizeResponseSizes(responseSizes)
  const observedNames = new Set(observed.map((entry) => entry.tool))
  const baselineNames = new Set(Object.keys(baseline.tools))

  const missingBaseline = [...observedNames].filter((name) => !baselineNames.has(name))
  const staleBaseline = [...baselineNames].filter((name) => !observedNames.has(name))
  if (missingBaseline.length > 0) {
    failures.push({ tool: 'response-size', message: `baseline missing tools: ${missingBaseline.join(', ')}` })
  }
  if (staleBaseline.length > 0) {
    failures.push({ tool: 'response-size', message: `baseline contains removed tools: ${staleBaseline.join(', ')}` })
  }

  for (const entry of observed) {
    const toolBaseline = baseline.tools[entry.tool]
    if (!toolBaseline) continue

    if (entry.median > toolBaseline.max_median_chars) {
      failures.push({
        tool: entry.tool,
        message: `median response size regressed (${entry.median} chars > v${baseline.version} budget ${toolBaseline.max_median_chars}; snapshot median ${toolBaseline.median_chars})`,
      })
    }

    if (entry.p95 > toolBaseline.max_p95_chars) {
      failures.push({
        tool: entry.tool,
        message: `p95 response size regressed (${entry.p95} chars > v${baseline.version} budget ${toolBaseline.max_p95_chars}; snapshot p95 ${toolBaseline.p95_chars})`,
      })
    }
  }

  const aggregateSizes = responseSizes.map((sample) => sample.chars)
  const aggregateMedian = percentile(aggregateSizes, 50)
  const aggregateP90 = percentile(aggregateSizes, 90)
  if (baseline.aggregate && aggregateMedian > baseline.aggregate.max_median_chars) {
    failures.push({
      tool: 'response-size',
      message: `aggregate median response size regressed (${aggregateMedian} chars > v${baseline.version} budget ${baseline.aggregate.max_median_chars})`,
    })
  }
  if (baseline.aggregate && aggregateP90 > baseline.aggregate.max_p90_chars) {
    failures.push({
      tool: 'response-size',
      message: `aggregate p90 response size regressed (${aggregateP90} chars > v${baseline.version} budget ${baseline.aggregate.max_p90_chars})`,
    })
  }
}

function getSchemaProperties(tool: any): Record<string, any> {
  const schema = tool.inputSchema
  return schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : {}
}

function validateCatalogSemantics(tools: any[], failures: QualityWarning[]) {
  const actualToolNames = new Set(tools.map((tool) => tool.name))
  const manifestToolNames = new Set(TOOL_SPECS.map((spec) => spec.name))
  const missingFromCatalog = [...manifestToolNames].filter((name) => !actualToolNames.has(name))
  const missingFromManifest = [...actualToolNames].filter((name) => !manifestToolNames.has(name))

  if (missingFromCatalog.length > 0) {
    failures.push({ tool: 'catalog', message: `manifest tools missing from catalog: ${missingFromCatalog.join(', ')}` })
  }
  if (missingFromManifest.length > 0) {
    failures.push({ tool: 'catalog', message: `catalog tools missing from manifest: ${missingFromManifest.join(', ')}` })
  }

  for (const tool of tools) {
    const properties = getSchemaProperties(tool)
    const hasFromTimestamp = Object.prototype.hasOwnProperty.call(properties, 'from_timestamp')
    const hasToTimestamp = Object.prototype.hasOwnProperty.call(properties, 'to_timestamp')

    if (hasFromTimestamp !== hasToTimestamp) {
      failures.push({
        tool: tool.name,
        message: 'timestamp inputs should expose from_timestamp and to_timestamp together',
      })
    }

    for (const key of ['from_timestamp', 'to_timestamp']) {
      const description = String(properties[key]?.description ?? '')
      if (
        Object.prototype.hasOwnProperty.call(properties, key) &&
        !/Unix seconds, Unix milliseconds, ISO datetime, or relative input/.test(description)
      ) {
        failures.push({
          tool: tool.name,
          message: `${key} should use the shared timestamp semantics description`,
        })
      }
    }

    if (properties.mode !== undefined) {
      const enumValues = properties.mode?.enum
      const description = String(properties.mode?.description ?? '')
      if (!Array.isArray(enumValues) || enumValues.join(',') !== 'fast,deep') {
        failures.push({ tool: tool.name, message: 'mode should expose the shared fast/deep enum' })
      }
      if (!/fast.*deep|deep.*fast|complete requested-window|bounded preview/i.test(description)) {
        failures.push({ tool: tool.name, message: 'mode should describe complete-window or bounded-preview semantics' })
      }
    }
  }
}

function validateTextFallbackParsing() {
  const fallback = parseToolResultData({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ answer: 'Fallback response', display: { title: 'Fallback' } }),
      },
    ],
  })

  assert(fallback.source === 'text', 'Text-only tool results should parse through the fallback path')
  assert(fallback.data.answer === 'Fallback response', 'Text fallback should parse JSON response content')
}

async function validateContractActivityFastModeCoverage(params: {
  client: Client
  context: Awaited<ReturnType<typeof loadToolTestContext>>
  failures: QualityWarning[]
}) {
  const { client, context, failures } = params

  try {
    const result = await callToolWithRetry(client, 'portal_evm_get_contract_activity', {
      network: 'base',
      contract_address: context.baseUniswapV3Pool,
      timeframe: '10000',
      mode: 'fast',
      include_events: false,
    })

    assert(!result.isError, 'portal_evm_get_contract_activity fast-mode coverage probe should succeed')
    const data = result.data
    assert(data?._coverage?.window_complete === false, 'fast-mode contract activity should mark trimmed window coverage incomplete')
    assert(data?._coverage?.result_complete === true, 'fast-mode contract activity should keep result_complete about pagination/caps')
    assert(data?._coverage?.continuation === 'none', 'fast-mode contract activity should not invent a continuation cursor')
    assert(
      typeof data?._coverage?.analyzed_from_block === 'number' &&
        data._coverage.analyzed_from_block > data._coverage.window_from_block,
      'fast-mode contract activity should expose analyzed_from_block after trimming',
    )
    assert(
      data?._coverage?.analyzed_to_block === data?._coverage?.window_to_block,
      'fast-mode contract activity should expose analyzed_to_block at the requested window end',
    )
    assert(data?._execution?.result_scope === 'partial_window', 'fast-mode contract activity should expose partial_window execution scope')
    assert(
      data?._execution?.scan_estimate?.requested_blocks > data?._execution?.scan_estimate?.analyzed_blocks,
      'fast-mode contract activity should report requested versus analyzed block counts',
    )
    assert(
      answerDisclosesPartialWindow(data?.answer) ||
        (Array.isArray(data?._notices) && data._notices.some((notice: string) => answerDisclosesPartialWindow(notice))),
      'fast-mode contract activity should disclose partial window coverage in answer or notices',
    )

    console.log(`PASS  portal_evm_get_contract_activity fast coverage [${result.elapsedMs}ms ${classifySpeed(result.elapsedMs)}]`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ tool: 'portal_evm_get_contract_activity', message: `fast-mode coverage probe: ${message.slice(0, 320)}` })
    console.log('FAIL  portal_evm_get_contract_activity fast coverage')
    console.log(`      ${truncateText(message, 8)}`)
  }
}

async function runQualityPass(params: {
  client: Client
  context: Awaited<ReturnType<typeof loadToolTestContext>>
  pass: 'cold' | 'warm'
  warnings: QualityWarning[]
  failures: QualityWarning[]
  responseSizes: ResponseSizeSample[]
}) {
  const { client, context, pass, warnings, failures, responseSizes } = params

  printSection(`Quality audit ${pass} pass`)

  for (const spec of TOOL_SPECS) {
    try {
      const args = spec.args(context)
      let result = await callToolWithRetry(client, spec.name, args)
      assert(
        !result.isError,
        `${spec.name} should succeed in the quality audit: ${truncateText(result.text, 4)}`,
      )

      const intent = getIntent(result.data)
      const hardLatencyBudget = getHardLatencyBudget(intent, spec.name)
      const softLatencyBudget = getSoftLatencyBudget(intent, spec.name)
      let recoveredFromLatencySpike = false
      let originalSlowElapsedMs: number | undefined

      if (result.elapsedMs > hardLatencyBudget) {
        const retryResult = await callToolWithRetry(client, spec.name, args)
        if (!retryResult.isError) {
          originalSlowElapsedMs = result.elapsedMs
          result = retryResult.elapsedMs <= result.elapsedMs ? retryResult : result
          recoveredFromLatencySpike = retryResult.elapsedMs <= hardLatencyBudget
        }
      }

      const data = result.data
      assert(result.dataSource === 'structuredContent', `${spec.name} ${pass} should prefer structuredContent`)
      assert(result.structuredContent !== undefined, `${spec.name} ${pass} should emit structuredContent`)
      assert(
        JSON.stringify(result.structuredContent) === JSON.stringify(parseToolResultData({ content: result.result.content }).data),
        `${spec.name} ${pass} structuredContent should match JSON text fallback envelope`,
      )
      responseSizes.push({ tool: spec.name, pass, chars: result.text.length })
      assertChatSurface(data, `${spec.name} ${pass} quality audit`, {
        expectNextSteps: Array.isArray(data?._ui?.follow_up_actions) && data._ui.follow_up_actions.length > 0,
      })

      const responseSizeBudget = getResponseSizeBudget(data)
      if (result.text.length > responseSizeBudget) {
        failures.push({ tool: spec.name, message: `${pass} response exceeded size budget (${result.text.length} chars > ${responseSizeBudget})` })
      } else if (result.text.length > Math.floor(responseSizeBudget * 0.8)) {
        warnings.push({ tool: spec.name, message: `${pass} response is approaching size budget (${result.text.length}/${responseSizeBudget} chars)` })
      }

      if (String(data.answer || '').length > 220) {
        warnings.push({ tool: spec.name, message: `${pass} answer is quite long (${String(data.answer).length} chars)` })
      }

      if (data._notice && /truncated/i.test(String(data._notice))) {
        failures.push({ tool: spec.name, message: `${pass} response was truncated` })
      }
      if (Array.isArray(data._notices) && data._notices.some((notice: string) => /truncated/i.test(notice))) {
        failures.push({ tool: spec.name, message: `${pass} response emitted truncation notices` })
      }

      if (data?._coverage?.window_complete === false && !answerDisclosesPartialWindow(data.answer)) {
        failures.push({ tool: spec.name, message: `${pass} partial analysis/window coverage was not disclosed in answer` })
      }
      if (data?._coverage?.result_complete === false && !answerDisclosesPreview(data.answer)) {
        failures.push({ tool: spec.name, message: `${pass} preview/paginated result was not disclosed in answer` })
      }

      if (hasLegacyWording(JSON.stringify(data.display ?? {})) || hasLegacyWording(String(data.answer ?? ''))) {
        failures.push({ tool: spec.name, message: `${pass} chat surface still uses legacy wording` })
      }

      if (typeof data.display?.network === 'string' && data.display.network.includes('-mainnet')) {
        failures.push({ tool: spec.name, message: `${pass} display.network is not humanized (${data.display.network})` })
      }

      if (recoveredFromLatencySpike && originalSlowElapsedMs !== undefined) {
        warnings.push({
          tool: spec.name,
          message: `${pass} transient latency spike recovered on retry (${originalSlowElapsedMs}ms -> ${result.elapsedMs}ms)`,
        })
      } else if (result.elapsedMs > hardLatencyBudget) {
        failures.push({ tool: spec.name, message: `${pass} latency exceeded budget (${result.elapsedMs}ms > ${hardLatencyBudget}ms)` })
      } else if (result.elapsedMs > softLatencyBudget) {
        warnings.push({ tool: spec.name, message: `${pass} slow live response (${result.elapsedMs}ms ${classifySpeed(result.elapsedMs)}; budget ${hardLatencyBudget}ms)` })
      }

      if (
        intent === 'query'
        && !hasExplicitResponseFormat(args)
        && typeof data?._execution?.response_format === 'string'
        && data._execution.response_format === 'full'
      ) {
        failures.push({ tool: spec.name, message: `${pass} default query response_format regressed to full instead of compact` })
      }

      console.log(`PASS  ${spec.name} [${pass}; ${result.elapsedMs}ms ${classifySpeed(result.elapsedMs)}; ${result.text.length} chars]`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ tool: spec.name, message: `${pass}: ${message.slice(0, 320)}` })
      console.log(`FAIL  ${spec.name} [${pass}]`)
      console.log(`      ${truncateText(message, 8)}`)
    }
  }
}

async function main() {
  const baseline = loadQualityBaseline()
  const connected = await connectTestClient('quality-test')
  const { client } = connected

  try {
    const { tools } = await client.listTools()
    const context = await loadToolTestContext(client)
    const warnings: QualityWarning[] = []
    const failures: QualityWarning[] = []
    const responseSizes: ResponseSizeSample[] = []

    printSection(`Quality audit for ${TOOL_SPECS.length} tools`)
    validateTextFallbackParsing()
    validateCatalogSemantics(tools, failures)

    await runQualityPass({ client, context, pass: 'cold', warnings, failures, responseSizes })
    await runQualityPass({ client, context, pass: 'warm', warnings, failures, responseSizes })
    await validateContractActivityFastModeCoverage({ client, context, failures })

    validateResponseSizeBaseline(responseSizes, baseline, failures)

    printSection('Quality audit summary')
    const sizes = responseSizes.map((sample) => sample.chars)
    const medianSize = percentile(sizes, 50)
    const p90Size = percentile(sizes, 90)
    const largest = [...responseSizes].sort((a, b) => b.chars - a.chars).slice(0, 5)
    console.log(`Response sizes: median ${medianSize} chars, p90 ${p90Size} chars, baseline v${baseline.version} captured ${baseline.captured_at}`)
    largest.forEach((sample) => console.log(`  - ${sample.tool} (${sample.pass}): ${sample.chars} chars`))

    console.log('Per-tool size summary:')
    summarizeResponseSizes(responseSizes)
      .slice()
      .sort((a, b) => b.p95 - a.p95)
      .slice(0, 10)
      .forEach((entry) => console.log(`  - ${entry.tool}: median ${entry.median}, p95 ${entry.p95}, samples ${entry.samples}`))

    console.log(`Warnings: ${warnings.length}`)
    warnings.slice(0, 20).forEach((warning) => console.log(`  - ${warning.tool}: ${warning.message}`))
    console.log(`Failures: ${failures.length}`)
    failures.slice(0, 20).forEach((failure) => console.log(`  - ${failure.tool}: ${failure.message}`))

    process.exit(failures.length > 0 ? 1 : 0)
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
