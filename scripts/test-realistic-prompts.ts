#!/usr/bin/env tsx

import {
  assert,
  assertChatSurface,
  callToolWithRetry,
  classifySpeed,
  closeTestClient,
  connectTestClient,
  printSection,
} from './test-helpers.ts'
import { loadToolTestContext } from './tool-manifest.ts'

type TestContext = Awaited<ReturnType<typeof loadToolTestContext>>

type RealisticPromptCase = {
  prompt: string
  expectedTool: string
  why: string
  args: (context: TestContext) => Record<string, unknown>
  validate: (data: any) => void
}

function assertInvestigation(data: any, label: string) {
  assert(data.investigation?.version === 'portal_investigation_v1', `${label} should include investigation guide`)
  assert(data.investigation?.evidence?.primary_path !== undefined, `${label} should expose primary evidence path`)
  assert(Array.isArray(data.investigation?.follow_up_filters), `${label} should expose follow-up filters`)
  assert(Array.isArray(data.investigation?.limitations), `${label} should expose limitations`)
}

function assertSurfaceGuidance(data: any, label: string, surfaces: string[]) {
  const recommended = data._llm?.execution_guidance?.recommended_surfaces
  assert(Array.isArray(recommended), `${label} should expose recommended execution surfaces`)
  for (const surface of surfaces) {
    assert(recommended.includes(surface), `${label} should recommend ${surface}`)
  }
}

const PROCESS_NARRATION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bloaded (?:a )?(?:tool|file|reference|skill)\b/i, reason: 'loaded-tool/file chatter' },
  { pattern: /\bread (?:a |\d+ )?(?:file|files|reference|references|memory|memories)\b/i, reason: 'reference-loading chatter' },
  { pattern: /\bprior Hyperliquid notes\b/i, reason: 'prepared-note chatter' },
  { pattern: /\bprepared notes?\b/i, reason: 'prepared-note chatter' },
  { pattern: /\bfreshness check (?:is )?(?:clean|passed|good)\b/i, reason: 'freshness-check narration' },
  { pattern: /\banchoring (?:the )?(?:export|query)\b/i, reason: 'head-anchoring narration' },
  { pattern: /\b(?:confirmed|checking|verify|verifying) (?:the )?query shape\b/i, reason: 'query-shape narration' },
  { pattern: /\brunning (?:count|line) checks?\b/i, reason: 'count-check narration' },
  { pattern: /\bexpand(?:ing)? (?:the )?(?:block|time) window\b/i, reason: 'window-expansion narration' },
  { pattern: /\bI(?:'|’)ll (?:use|check|read|load|verify|run|export)\b/i, reason: 'process preamble' },
  { pattern: /\blet me (?:check|read|load|inspect|verify|run)\b/i, reason: 'process preamble' },
]

function collectNarrativeText(value: unknown, path = '$', out: Array<{ path: string; text: string }> = []) {
  if (typeof value === 'string') {
    out.push({ path, text: value })
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNarrativeText(item, `${path}[${index}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectNarrativeText(item, `${path}.${key}`, out)
    }
  }
  return out
}

function assertNoProcessNarration(data: any, label: string) {
  const narrativeSurface = {
    answer: data.answer,
    display: data.display,
    next_steps: data.next_steps,
    investigation: data.investigation,
    llm: {
      answer_sequence: data._llm?.answer_sequence,
      sections: data._llm?.sections,
      recommended_views: data._llm?.recommended_views,
      execution_guidance: data._llm?.execution_guidance,
    },
  }

  for (const { path, text } of collectNarrativeText(narrativeSurface)) {
    for (const { pattern, reason } of PROCESS_NARRATION_PATTERNS) {
      assert(!pattern.test(text), `${label} should not include ${reason} at ${path}: ${text}`)
    }
  }
}

function hasPivot(data: any, fields: string[]) {
  return data.investigation?.pivots?.some((pivot: any) => fields.includes(String(pivot.field)))
}

function summarizeArtifact(data: any): string {
  const parts: string[] = []
  const evidence = data.investigation?.evidence
  if (evidence?.primary_path) parts.push(`evidence=${evidence.primary_path}`)
  if (evidence?.primary_kind) parts.push(`kind=${evidence.primary_kind}`)
  if (Array.isArray(data.investigation?.pivots) && data.investigation.pivots.length > 0) {
    const fields = [...new Set(data.investigation.pivots.map((pivot: any) => String(pivot.field)))].slice(0, 5)
    parts.push(`pivots=${fields.join(',')}`)
  }
  if (Array.isArray(data.items)) parts.push(`items=${data.items.length}`)
  if (typeof data.block_number === 'number') parts.push(`block=${data.block_number}`)
  if (data.suggested_arguments) parts.push(`suggestions=${Object.keys(data.suggested_arguments).join(',')}`)
  if (Array.isArray(data.investigation?.limitations)) parts.push(`limits=${data.investigation.limitations.length}`)
  return parts.join(' | ') || 'artifact=validated'
}

function firstArrayItem(data: any) {
  if (Array.isArray(data.items)) return data.items[0]
  if (Array.isArray(data.activity?.items)) return data.activity.items[0]
  if (Array.isArray(data.matches)) return data.matches[0]
  return undefined
}

function excerpt(value: unknown, maxChars = 1_800) {
  const text = JSON.stringify(value, null, 2)
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...`
}

function buildOutputExcerpt(data: any) {
  return {
    answer: data.answer,
    display: data.display,
    investigation: data.investigation
      ? {
          evidence: data.investigation.evidence,
          pivots: data.investigation.pivots?.slice(0, 5),
          follow_up_filters: data.investigation.follow_up_filters,
          limitations: data.investigation.limitations,
        }
      : undefined,
    suggested_arguments: data.suggested_arguments,
    first_item: firstArrayItem(data),
    execution: data._execution,
    coverage: data._coverage,
  }
}

const CASES: RealisticPromptCase[] = [
  {
    prompt:
      "I think this Base wallet touched stolen funds. Don't just dump rows; tell me what evidence exists and what I should pivot on next.",
    expectedTool: 'portal_get_wallet_summary',
    why: 'Suspicious-wallet triage should start with the existing cross-chain wallet summary, not a new forensic tool.',
    args: (context) => ({
      network: 'base',
      address: context.evmWallet,
      timeframe: '24h',
      limit_per_type: 3,
    }),
    validate: (data) => {
      assert(data.overview?.vm === 'evm', 'wallet triage should resolve the wallet as EVM')
      assert(data.fund_flow?.summary !== undefined, 'wallet triage should expose fund_flow summary')
      assert(Array.isArray(data.fund_flow?.largest_movements), 'wallet triage should expose largest movements')
      assertInvestigation(data, 'wallet triage')
      assert(
        data.investigation.follow_up_filters.length > 0,
        'wallet triage should suggest at least one follow-up filter',
      )
    },
  },
  {
    prompt:
      'Trace recent USDC movement on Base like an incident response note: I need sender, recipient, tx hash, and the next exact filters.',
    expectedTool: 'portal_evm_query_token_transfers',
    why: 'Asset-flow prompts should use the existing token-transfer query with token symbol resolution.',
    args: (context) => ({
      network: 'base',
      from_block: context.baseHead - 2_000,
      to_block: context.baseHead,
      token_symbols: ['USDC'],
      include_token_info: true,
      limit: 3,
    }),
    validate: (data) => {
      assert(Array.isArray(data.items) && data.items.length > 0, 'USDC trace should return transfer rows')
      assertInvestigation(data, 'USDC trace')
      assert(
        hasPivot(data, ['from', 'to', 'token_address', 'transaction_hash']),
        'USDC trace should expose sender, recipient, token, or transaction pivots',
      )
      assert(
        data.items.some((item: any) => item.transaction_hash || item.tx_hash),
        'USDC trace should include transaction hashes in returned rows',
      )
    },
  },
  {
    prompt:
      'Now show raw Base transactions in the same window so I can correlate hashes and callers myself.',
    expectedTool: 'portal_evm_query_transactions',
    why: 'Raw evidence prompts should route to EVM transactions and keep bounded-window metadata.',
    args: (context) => ({
      network: 'base',
      from_block: context.baseHead - 200,
      to_block: context.baseHead,
      limit: 3,
      field_preset: 'standard',
    }),
    validate: (data) => {
      assert(Array.isArray(data.items) && data.items.length > 0, 'raw transaction evidence should return rows')
      assertInvestigation(data, 'raw transaction evidence')
      assert(hasPivot(data, ['hash', 'from', 'to']), 'raw transaction evidence should expose hash or address pivots')
      assert(data._execution !== undefined, 'raw transaction evidence should describe execution window')
    },
  },
  {
    prompt: 'Show the last 200 BTC perp fills on Hyperliquid with price, size, side, and raw rows only.',
    expectedTool: 'portal_hyperliquid_query_fills',
    why: 'Last-N market-data prompts should return the requested raw rows and preserve exact continuation metadata.',
    args: () => ({
      network: 'hyperliquid-fills',
      timeframe: '6h',
      coin: ['BTC'],
      limit: 200,
    }),
    validate: (data) => {
      assert(Array.isArray(data.items) && data.items.length > 0, 'BTC fills should return visible row evidence')
      assert(data.items.every((item: any) => item.coin === 'BTC'), 'BTC fills should only include BTC rows')
      for (const item of data.items) {
        assert(item.px !== undefined, 'BTC fill rows should include price')
        assert(item.sz !== undefined, 'BTC fill rows should include size')
        assert(item.side !== undefined, 'BTC fill rows should include side')
      }
      assert(data.page_summary?.visible_fills === 200, 'BTC fills should report the requested 200-fill page')
      assert(data._pagination?.returned === 200, 'BTC fills should record 200 returned rows')
      assert(data._pagination?.page_size === 200, 'BTC fills should preserve the 200-row page size')
      assert(data._pagination?.has_more === true, 'BTC fills should expose continuation for older fills')
      assert(data._coverage?.returned_items === 200, 'BTC fills coverage should record 200 returned items')
      assertSurfaceGuidance(data, 'BTC fills', ['portal_stream_api'])
      assert(data._llm?.answer_sequence?.[0] === 'page_summary', 'BTC fills answer sequence should start with results, not setup')
      assert(data._llm?.answer_sequence?.[1] === 'items', 'BTC fills answer sequence should put raw rows before continuation mechanics')
      assertNoProcessNarration(data, 'BTC fills')
    },
  },
  {
    prompt:
      'Export the latest 20,000 BTC perp fills on Hyperliquid to CSV/NDJSON. Raw rows only; no progress updates.',
    expectedTool: 'portal_hyperliquid_query_fills',
    why: 'Large export prompts should use a bounded MCP page only as evidence, then route to Portal Stream API/curl without process narration.',
    args: () => ({
      network: 'hyperliquid-fills',
      timeframe: '6h',
      coin: ['BTC'],
      limit: 200,
    }),
    validate: (data) => {
      assert(Array.isArray(data.items) && data.items.length > 0, 'large BTC export setup should return visible row evidence')
      assert(data.items.every((item: any) => item.coin === 'BTC'), 'large BTC export setup should only include BTC rows')
      assert(data._pagination?.page_size === 200, 'large BTC export setup should preserve the MCP page-size boundary')
      assert(data._pagination?.has_more === true, 'large BTC export setup should expose continuation for larger exports')
      assertSurfaceGuidance(data, 'large BTC export setup', ['portal_stream_api'])
      assert(
        data._llm?.execution_guidance?.switch_to_portal_api_when?.some((item: string) => /NDJSON|CSV|file|curl/i.test(item)),
        'large BTC export setup should explain file/curl export triggers',
      )
      assert(data._llm?.answer_sequence?.[0] === 'page_summary', 'large BTC export answer sequence should start with row evidence')
      assertNoProcessNarration(data, 'large BTC export setup')
    },
  },
  {
    prompt:
      'Give me raw Base USDC transfers as a reproducible export, not just a chat summary.',
    expectedTool: 'portal_evm_query_token_transfers',
    why: 'Raw export prompts should keep MCP bounded but tell the agent when to switch to Portal Stream API/curl.',
    args: (context) => ({
      network: 'base',
      from_block: context.baseHead - 500,
      to_block: context.baseHead,
      token_symbols: ['USDC'],
      limit: 3,
    }),
    validate: (data) => {
      assert(Array.isArray(data.items) && data.items.length > 0, 'raw export setup should return proof rows')
      for (const item of data.items) {
        assert(item.tx_hash || item.transaction_hash, 'raw export rows should include transaction hashes')
        assert(item.sender || item.from, 'raw export rows should include senders')
        assert(item.recipient || item.to, 'raw export rows should include recipients')
        assert(item.token_address, 'raw export rows should include token addresses')
        assert(item.value_formatted, 'raw export rows should include formatted values')
      }
      assertSurfaceGuidance(data, 'raw export setup', ['portal_stream_api'])
      assert(
        data._llm?.execution_guidance?.switch_to_portal_api_when?.some((item: string) => /NDJSON|CSV|file|curl/i.test(item)),
        'raw export setup should explain file/curl export triggers',
      )
      assertNoProcessNarration(data, 'raw export setup')
    },
  },
  {
    prompt:
      'This Base activity chart should become a recurring dashboard. Should I keep using MCP or build a data pipeline?',
    expectedTool: 'portal_get_time_series',
    why: 'Durable dashboard prompts should surface the Pipes SDK handoff instead of stretching MCP into production architecture.',
    args: () => ({
      network: 'base',
      metric: 'transaction_count',
      interval: '15m',
      duration: '2h',
    }),
    validate: (data) => {
      assert(Array.isArray(data.time_series) && data.time_series.length > 0, 'dashboard handoff should return chart buckets')
      assert(data.pipes_handoff?.version === 'pipes_recipe_v1', 'dashboard handoff should include a Pipes recipe')
      assert(
        JSON.stringify(data.pipes_handoff?.recommended_skills) === JSON.stringify(['portal', 'pipes']),
        'dashboard handoff should resolve to bundled SQD skills',
      )
      assertSurfaceGuidance(data, 'dashboard handoff', ['pipes_squid'])
      assert(/data pipeline/i.test(JSON.stringify(data.pipes_handoff)), 'dashboard handoff should use data pipeline language')
    },
  },
  {
    prompt:
      'Before I search logs, resolve what USDC means on Base so I can avoid hallucinating the token contract.',
    expectedTool: 'portal_resolve_entity',
    why: 'Named-entity prompts should resolve symbols into deterministic query filters before raw queries.',
    args: () => ({
      network: 'base',
      kind: 'token',
      query: 'USDC',
      limit: 5,
    }),
    validate: (data) => {
      assert(data.kind === 'token', 'entity resolver should preserve token kind')
      assert(data.match_count > 0, 'entity resolver should find at least one USDC match')
      assert(
        Array.isArray(data.suggested_arguments?.token_addresses) &&
          data.suggested_arguments.token_addresses.length > 0,
        'entity resolver should suggest token_addresses for deterministic follow-up queries',
      )
      assert(
        data._execution?.notes?.some((note: string) => /token-list/i.test(note)),
        'entity resolver should disclose token-list sourcing',
      )
    },
  },
  {
    prompt:
      'This incident report has a timestamp. Which Base block should I anchor my evidence window around?',
    expectedTool: 'portal_debug_resolve_time_to_block',
    why: 'Timestamp-to-block prompts should use the existing timestamp resolver and return lookup evidence.',
    args: (context) => ({
      network: 'base',
      timestamp: new Date((context.nowTimestamp - 3_600) * 1000).toISOString(),
    }),
    validate: (data) => {
      assert(typeof data.block_number === 'number', 'timestamp lookup should return a block_number')
      assert(data._execution?.timestamp !== undefined, 'timestamp lookup should record the requested timestamp')
      assertInvestigation(data, 'timestamp lookup')
      assert(
        data.investigation.evidence.primary_kind === 'lookup',
        'timestamp lookup should classify the evidence as a lookup',
      )
    },
  },
]

async function main() {
  const connected = await connectTestClient('realistic-prompts-test')
  const { client } = connected
  const showOutputDetails = process.env.REALISTIC_OUTPUT_DETAIL === '1'

  try {
    const context = await loadToolTestContext(client)
    let passed = 0
    let failed = 0

    printSection(`Realistic prompt audit: ${CASES.length} prompts`)

    for (const testCase of CASES) {
      try {
        const result = await callToolWithRetry(client, testCase.expectedTool, testCase.args(context))
        assert(!result.isError, `${testCase.expectedTool} should not error`)

        const data = result.data
        assertChatSurface(data, testCase.expectedTool)
        testCase.validate(data)

        console.log(`PASS  ${testCase.prompt}`)
        console.log(`      tool: ${testCase.expectedTool} [${result.elapsedMs}ms ${classifySpeed(result.elapsedMs)}]`)
        console.log(`      artifact: ${summarizeArtifact(data)}`)
        if (showOutputDetails) {
          console.log(excerpt(buildOutputExcerpt(data)))
        }
        console.log(`      why: ${testCase.why}`)
        passed++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(`FAIL  ${testCase.prompt}`)
        console.log(`      expected tool: ${testCase.expectedTool}`)
        console.log(`      ${message.slice(0, 320)}`)
        failed++
      }
    }

    printSection(`Realistic prompt results: ${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
