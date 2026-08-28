#!/usr/bin/env tsx

import {
  assert,
  assertChatSurface,
  callToolWithRetry,
  classifySpeed,
  closeTestClient,
  connectTestClient,
  extractJson,
  getText,
} from './test-helpers.ts'
import { LEGACY_TOOL_NAMES, TOOL_SPECS, loadToolTestContext } from './tool-manifest.ts'

const FIRST_CHOICE_TOOLS = new Set([
  'portal_list_networks',
  'portal_get_network_info',
  'portal_get_head',
  'portal_resolve_entity',
  'portal_get_recent_activity',
  'portal_get_wallet_summary',
  'portal_get_time_series',
])

function assertCatalogUx(
  tools: Array<{
    name: string
    title?: string
    description?: string
    annotations?: {
      readOnlyHint?: boolean
      destructiveHint?: boolean
      openWorldHint?: boolean
    }
    inputSchema?: {
      properties?: Record<string, { description?: string }>
    }
  }>,
) {
  const publicTools = tools.filter((tool) => !tool.name.startsWith('portal_debug_'))
  const advancedTools = tools.filter((tool) => tool.name.startsWith('portal_debug_'))

  for (const tool of publicTools) {
    assert(typeof tool.title === 'string' && tool.title.length > 0, `${tool.name} should expose a plain-language title`)
    assert(!tool.title.includes('portal_'), `${tool.name} title should not expose its internal identifier`)
    assert(tool.annotations?.readOnlyHint === true, `${tool.name} should be marked read-only`)
    assert(tool.annotations?.destructiveHint === false, `${tool.name} should be marked non-destructive`)
    assert(tool.annotations?.openWorldHint === true, `${tool.name} should disclose its external blockchain data source`)
    const description = tool.description ?? ''
    assert(description.includes('COMMON USER ASKS:'), `${tool.name} description should include COMMON USER ASKS`)
    assert(description.includes('WHEN TO USE:'), `${tool.name} description should include WHEN TO USE`)
    assert(description.includes('EXAMPLES:'), `${tool.name} description should include EXAMPLES`)
    assert(!/\bdataset\b/i.test(description), `${tool.name} description should avoid old 'dataset' wording`)
    assert(!/\bchain_type\b/i.test(description), `${tool.name} description should avoid old 'chain_type' wording`)

    if (FIRST_CHOICE_TOOLS.has(tool.name)) {
      assert(description.includes('FIRST CHOICE FOR:'), `${tool.name} description should include FIRST CHOICE FOR`)
    }
  }

  for (const tool of advancedTools) {
    assert(typeof tool.title === 'string' && tool.title.length > 0, `${tool.name} should expose a plain-language title`)
    assert(tool.annotations?.readOnlyHint === true, `${tool.name} should be marked read-only`)
    assert(tool.annotations?.destructiveHint === false, `${tool.name} should be marked non-destructive`)
    assert(tool.annotations?.openWorldHint === true, `${tool.name} should disclose its external blockchain data source`)
    const description = tool.description ?? ''
    assert(description.includes('ADVANCED:'), `${tool.name} description should be clearly marked ADVANCED`)
    assert(description.includes('COMMON USER ASKS:'), `${tool.name} description should include COMMON USER ASKS`)
    assert(description.includes('WHEN TO USE:'), `${tool.name} description should include WHEN TO USE`)
    assert(description.includes('EXAMPLES:'), `${tool.name} description should include EXAMPLES`)
  }

  for (const toolName of ['portal_evm_query_transactions', 'portal_evm_query_logs']) {
    const timeframeDescription = tools.find((tool) => tool.name === toolName)?.inputSchema?.properties?.timeframe?.description ?? ''
    assert(timeframeDescription.includes('5m'), `${toolName} should document the supported 5m timeframe`)
    assert(!timeframeDescription.includes('Supported:'), `${toolName} should not publish a restrictive fixed timeframe list`)
  }
}

async function main() {
  console.log('Starting MCP tool tests...\n')

  const connected = await connectTestClient('test-runner')
  const { client } = connected

  try {
    const { tools } = await client.listTools()
    const actualNames = new Set(tools.map((tool) => tool.name))
    const manifestNames = new Set(TOOL_SPECS.map((tool) => tool.name))
    const missingFromServer = TOOL_SPECS.map((tool) => tool.name).filter((name) => !actualNames.has(name))
    const missingFromManifest = tools.map((tool) => tool.name).filter((name) => !manifestNames.has(name))
    const publicTools = tools.filter((tool) => !tool.name.startsWith('portal_debug_'))
    const advancedTools = tools.filter((tool) => tool.name.startsWith('portal_debug_'))
    const legacyStillExposed = LEGACY_TOOL_NAMES.filter((name) => actualNames.has(name))

    console.log(`Server reports ${tools.length} tools`)
    console.log(`Manifest covers ${TOOL_SPECS.length} tools\n`)

    assert(missingFromServer.length === 0, `Manifest tools missing from server: ${missingFromServer.join(', ')}`)
    assert(missingFromManifest.length === 0, `Server tools missing from manifest: ${missingFromManifest.join(', ')}`)
    assert(tools.length === 28, `Expected exactly 28 registered tools, got ${tools.length}`)
    assert(publicTools.length === 25, `Expected exactly 25 public tools, got ${publicTools.length}`)
    assert(advancedTools.length === 3, `Expected exactly 3 advanced tools, got ${advancedTools.length}`)
    assert(legacyStillExposed.length === 0, `Legacy tool names are still exposed: ${legacyStillExposed.join(', ')}`)
    assertCatalogUx(tools)

    const context = await loadToolTestContext(client)
    console.log(`Base head: ${context.baseHead}`)
    console.log(`Solana head: ${context.solHead}`)
    console.log(`Hyperliquid fills head: ${context.hlFillsHead}`)
    console.log(`Hyperliquid replica head: ${context.hlReplicaHead}\n`)
    console.log('Catalog UX checks passed\n')

    let passed = 0
    let failed = 0
    const failures: { name: string; error: string }[] = []
    const perf: Array<{ name: string; elapsedMs: number; attempts: number }> = []

    for (const spec of TOOL_SPECS) {
      const args = spec.args(context)
      const serializedArgs = JSON.stringify(args)
      const testLabel = `${spec.name} <- "${spec.prompt}" (${serializedArgs.slice(0, 80)}${serializedArgs.length > 80 ? '...' : ''})`

      try {
        const toolCall = await callToolWithRetry(client, spec.name, args)
        const text = toolCall.text

        if (toolCall.isError) {
          if (spec.validateError) {
            spec.validateError(text, context)
            console.log(
              `  PASS  ${testLabel} [expected error after ${toolCall.attempts} attempt${toolCall.attempts === 1 ? '' : 's'}]`,
            )
            passed++
            continue
          }
          throw new Error(`Tool returned error: ${text.slice(0, 240)}`)
        }

        if (spec.validateError) {
          throw new Error('Expected tool to return an error')
        }

        spec.validate(text, context)
        const parsed = toolCall.data ?? extractJson(text)
        assertChatSurface(parsed, spec.name, {
          expectNextSteps: Array.isArray(parsed?._ui?.follow_up_actions) && parsed._ui.follow_up_actions.length > 0,
        })
        const hasTableDescriptors =
          Array.isArray(parsed?.tables) &&
          parsed.tables.every(
            (table: any) =>
              table && typeof table === 'object' && table.kind === 'table' && typeof table.id === 'string',
          )
        assert(
          parsed?._tool_contract?.name === spec.name,
          `${spec.name} should include matching _tool_contract metadata`,
        )
        if (parsed?._ui !== undefined) {
          assert(parsed?._ui?.version === 'portal_ui_v1', `${spec.name} should expose the portal_ui_v1 contract`)
          if (Array.isArray(parsed?._ui?.follow_up_actions) && parsed._ui.follow_up_actions.length > 0) {
            assert(
              parsed?.next_steps !== undefined,
              `${spec.name} should expose next_steps when follow-up actions exist`,
            )
          }
        }
        if (parsed?.chart !== undefined || hasTableDescriptors) {
          assert(parsed?._ui !== undefined, `${spec.name} should include _ui when chart/table metadata is present`)
        }
        if (parsed?.chart !== undefined) {
          assert(parsed?.chart?.tooltip !== undefined, `${spec.name} chart metadata should include tooltip guidance`)
          assert(
            parsed?.chart?.interactions !== undefined,
            `${spec.name} chart metadata should include interaction guidance`,
          )
        }
        if (hasTableDescriptors) {
          parsed.tables.forEach((table: any, index: number) => {
            assert(table?.interactions !== undefined, `${spec.name} table ${index} should include interaction guidance`)
          })
        }
        if (spec.validateFollowUp) {
          await spec.validateFollowUp(text, client, context)
        }

        perf.push({ name: spec.name, elapsedMs: toolCall.elapsedMs, attempts: toolCall.attempts })
        const speed = classifySpeed(toolCall.elapsedMs)
        const retryNote = toolCall.attempts > 1 ? ` retry=${toolCall.attempts}` : ''
        console.log(`  PASS  ${testLabel} [${toolCall.elapsedMs}ms ${speed}${retryNote}]`)
        passed++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(`  FAIL  ${testLabel}`)
        console.log(`        ${message.slice(0, 240)}`)
        failed++
        failures.push({ name: spec.name, error: message.slice(0, 240) })
      }
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`Results: ${passed} passed, ${failed} failed out of ${TOOL_SPECS.length} tests`)

    if (perf.length > 0) {
      const slowest = [...perf].sort((left, right) => right.elapsedMs - left.elapsedMs).slice(0, 5)
      const retried = perf.filter((entry) => entry.attempts > 1)
      console.log('\nSlowest tool calls:')
      slowest.forEach((entry) => {
        console.log(`  - ${entry.name}: ${entry.elapsedMs}ms (${classifySpeed(entry.elapsedMs)})`)
      })
      if (retried.length > 0) {
        console.log('\nRetried tool calls:')
        retried.forEach((entry) => {
          console.log(`  - ${entry.name}: ${entry.attempts} attempts`)
        })
      }
    }

    if (failures.length > 0) {
      console.log('\nFailures:')
      failures.forEach((failure) => {
        console.log(`  - ${failure.name}: ${failure.error}`)
      })
    }

    console.log(`${'='.repeat(60)}`)
    process.exit(failed > 0 ? 1 : 0)
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
