#!/usr/bin/env tsx

import { TOOL_SPECS, loadToolTestContext } from './tool-manifest.ts'
import {
  assert,
  assertChatSurface,
  callToolWithRetry,
  classifySpeed,
  closeTestClient,
  connectTestClient,
  hasLegacyWording,
  printSection,
  truncateText,
} from './test-helpers.ts'

type QualityWarning = {
  tool: string
  message: string
}

type ResponseSizeSample = {
  tool: string
  chars: number
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

const RESPONSE_SIZE_BASELINE_MEDIAN_CHARS = 12_881
const RESPONSE_SIZE_REDUCTION_TARGET = 0.3
const RESPONSE_SIZE_TARGET_MEDIAN_CHARS = Math.floor(
  RESPONSE_SIZE_BASELINE_MEDIAN_CHARS * (1 - RESPONSE_SIZE_REDUCTION_TARGET),
)

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

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
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
      if (!/fast.*deep|deep.*fast/i.test(description)) {
        failures.push({ tool: tool.name, message: 'mode should describe the shared fast/deep semantics' })
      }
    }
  }
}

async function main() {
  const connected = await connectTestClient('quality-test')
  const { client } = connected

  try {
    const { tools } = await client.listTools()
    const context = await loadToolTestContext(client)
    const warnings: QualityWarning[] = []
    const failures: QualityWarning[] = []
    const responseSizes: ResponseSizeSample[] = []

    printSection(`Quality audit for ${TOOL_SPECS.length} tools`)
    validateCatalogSemantics(tools, failures)

    for (const spec of TOOL_SPECS) {
      try {
        const args = spec.args(context)
        let result = await callToolWithRetry(client, spec.name, args)
        assert(!result.isError, `${spec.name} should succeed in the quality audit`)

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
        responseSizes.push({ tool: spec.name, chars: result.text.length })
        assertChatSurface(data, `${spec.name} quality audit`, {
          expectNextSteps: Array.isArray(data?._ui?.follow_up_actions) && data._ui.follow_up_actions.length > 0,
        })

        const responseSizeBudget = getResponseSizeBudget(data)
        if (result.text.length > responseSizeBudget) {
          failures.push({ tool: spec.name, message: `response exceeded size budget (${result.text.length} chars > ${responseSizeBudget})` })
        } else if (result.text.length > Math.floor(responseSizeBudget * 0.8)) {
          warnings.push({ tool: spec.name, message: `response is approaching size budget (${result.text.length}/${responseSizeBudget} chars)` })
        }

        if (String(data.answer || '').length > 220) {
          warnings.push({ tool: spec.name, message: `answer is quite long (${String(data.answer).length} chars)` })
        }

        if (data._notice && /truncated/i.test(String(data._notice))) {
          failures.push({ tool: spec.name, message: 'response was truncated' })
        }
        if (Array.isArray(data._notices) && data._notices.some((notice: string) => /truncated/i.test(notice))) {
          failures.push({ tool: spec.name, message: 'response emitted truncation notices' })
        }

        if (hasLegacyWording(JSON.stringify(data.display ?? {})) || hasLegacyWording(String(data.answer ?? ''))) {
          failures.push({ tool: spec.name, message: 'chat surface still uses legacy wording' })
        }

        if (typeof data.display?.network === 'string' && data.display.network.includes('-mainnet')) {
          failures.push({ tool: spec.name, message: `display.network is not humanized (${data.display.network})` })
        }

        if (recoveredFromLatencySpike && originalSlowElapsedMs !== undefined) {
          warnings.push({
            tool: spec.name,
            message: `transient latency spike recovered on retry (${originalSlowElapsedMs}ms -> ${result.elapsedMs}ms)`,
          })
        } else if (result.elapsedMs > hardLatencyBudget) {
          failures.push({ tool: spec.name, message: `latency exceeded budget (${result.elapsedMs}ms > ${hardLatencyBudget}ms)` })
        } else if (result.elapsedMs > softLatencyBudget) {
          warnings.push({ tool: spec.name, message: `slow live response (${result.elapsedMs}ms ${classifySpeed(result.elapsedMs)}; budget ${hardLatencyBudget}ms)` })
        }

        if (
          intent === 'query'
          && !hasExplicitResponseFormat(args)
          && typeof data?._execution?.response_format === 'string'
          && data._execution.response_format === 'full'
        ) {
          failures.push({ tool: spec.name, message: 'default query response_format regressed to full instead of compact' })
        }

        console.log(`PASS  ${spec.name} [${result.elapsedMs}ms ${classifySpeed(result.elapsedMs)}]`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ tool: spec.name, message: message.slice(0, 320) })
        console.log(`FAIL  ${spec.name}`)
        console.log(`      ${truncateText(message, 8)}`)
      }
    }

    printSection('Quality audit summary')
    const sizes = responseSizes.map((sample) => sample.chars)
    const medianSize = percentile(sizes, 50)
    const p90Size = percentile(sizes, 90)
    const reduction = RESPONSE_SIZE_BASELINE_MEDIAN_CHARS > 0
      ? 1 - medianSize / RESPONSE_SIZE_BASELINE_MEDIAN_CHARS
      : 0
    const largest = [...responseSizes].sort((a, b) => b.chars - a.chars).slice(0, 5)
    console.log(
      `Response sizes: median ${medianSize} chars, p90 ${p90Size} chars, reduction ${(reduction * 100).toFixed(1)}% from ${RESPONSE_SIZE_BASELINE_MEDIAN_CHARS}`,
    )
    largest.forEach((sample) => console.log(`  - ${sample.tool}: ${sample.chars} chars`))
    if (medianSize > RESPONSE_SIZE_TARGET_MEDIAN_CHARS) {
      failures.push({
        tool: 'response-size',
        message: `median response size ${medianSize} exceeds target ${RESPONSE_SIZE_TARGET_MEDIAN_CHARS}`,
      })
    }
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
