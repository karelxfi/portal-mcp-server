#!/usr/bin/env tsx

import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { RETAINED_ACTIVITY_EXPLORER_RESOURCE_URIS } from '../dist/apps/activity-explorer-compat.js'
import { assert, callToolWithRetry, closeTestClient, connectTestClient, sleep } from './test-helpers.ts'

const CLIENTS = [
  { family: 'claude', name: 'claude-desktop' },
  { family: 'codex', name: 'codex' },
  { family: 'grok', name: 'grok' },
  { family: 'gemini', name: 'gemini-cli' },
  { family: 'cursor', name: 'cursor' },
] as const

const CLIENT_BOUNDARY_COOLDOWN_MS = 5_000

const PRE_UPGRADE_SCHEMA_FIXTURE = {
  hyperliquid_fill_limit: 200,
  wallet_limit_per_type: 10,
  app_resource_uri: RETAINED_ACTIVITY_EXPLORER_RESOURCE_URIS[0],
} as const

function assertCompleteOrContinuable(data: any, label: string) {
  const complete = data?._coverage?.result_complete === true
  const continuable = data?._coverage?.result_complete === false && typeof data?._pagination?.next_cursor === 'string'
  assert(complete || continuable, `${label} should be complete or expose an exact continuation cursor`)
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function assertEvidence(data: any, tool: string, label: string) {
  const evidence = data?._evidence
  assert(evidence?.version === 'sqd_evidence_v1', `${label} should include the v1 evidence receipt`)
  assert(evidence?.tool === tool, `${label} receipt should identify ${tool}`)
  assert(evidence?.source?.provider === 'SQD Portal', `${label} receipt should identify SQD Portal`)
  assert(/^[a-f0-9]{64}$/.test(String(evidence?.request?.arguments_sha256 ?? '')), `${label} should hash its request`)
  assert(/^[a-f0-9]{64}$/.test(String(evidence?.result?.exact_data_sha256 ?? '')), `${label} should hash exact data`)
  assert(
    Number.isInteger(evidence?.result?.row_count) && evidence.result.row_count >= 0,
    `${label} should count exact rows`,
  )
  if (typeof evidence?.result?.primary_evidence_path === 'string') {
    const rows = readPath(data, evidence.result.primary_evidence_path)
    assert(Array.isArray(rows), `${label} primary evidence path should resolve to rows`)
    assert(rows.length === evidence.result.row_count, `${label} receipt row count should match the exact rows`)
  }
  if (evidence?.result?.completeness === 'partial') {
    assert(
      Array.isArray(evidence.result.partial_reasons) && evidence.result.partial_reasons.length > 0,
      `${label} partial receipt should explain why`,
    )
  }
}

async function runClientJourney(clientIdentity: (typeof CLIENTS)[number]) {
  const connected = await connectTestClient(clientIdentity.name)
  const startedAt = Date.now()
  const steps: Record<string, unknown>[] = []

  try {
    const { tools } = await connected.client.listTools()
    assert(tools.length === 30, `${clientIdentity.family} should discover 30 tools`)
    const prompts = await connected.client.listPrompts()
    assert(
      ['investigate-wallet', 'investigate-contract', 'investigate-market'].every((name) =>
        prompts.prompts.some((prompt) => prompt.name === name),
      ),
      `${clientIdentity.family} should discover all three investigation prompts`,
    )
    const marketPrompt = await connected.client.getPrompt({
      name: 'investigate-market',
      arguments: { network: 'hyperliquid-fills', market: 'BTC', timeframe: '1h' },
    })
    assert(
      marketPrompt.messages.some(
        (message) => message.content.type === 'text' && message.content.text.includes('Never make a claim'),
      ),
      `${clientIdentity.family} market prompt should enforce factual evidence`,
    )
    const resources = await connected.client.listResources()
    assert(
      resources.resources.some((resource) => resource.uri === 'sqd://investigations') &&
        resources.resources.some((resource) => resource.uri.startsWith('ui://sqd/activity-explorer.')) &&
        resources.resources.some((resource) => resource.uri === PRE_UPGRADE_SCHEMA_FIXTURE.app_resource_uri),
      `${clientIdentity.family} should discover the investigation guide and MCP App`,
    )
    const retainedApp = await connected.client.readResource({ uri: PRE_UPGRADE_SCHEMA_FIXTURE.app_resource_uri })
    assert(
      retainedApp.contents.some(
        (content) =>
          content.uri === PRE_UPGRADE_SCHEMA_FIXTURE.app_resource_uri &&
          content.mimeType === 'text/html;profile=mcp-app',
      ),
      `${clientIdentity.family} should read the App URI cached before the upgrade`,
    )
    steps.push({
      step: 'discovery',
      tools: tools.length,
      prompts: prompts.prompts.length,
      resources: resources.resources.length,
    })

    const firstPage = await callToolWithRetry(connected.client, 'portal_list_networks', { limit: 3 }, { retries: 1 })
    assert(!firstPage.isError, `${clientIdentity.family} first call should succeed`)
    assert(firstPage.dataSource === 'structuredContent', `${clientIdentity.family} should receive structuredContent`)
    assertEvidence(firstPage.data, 'portal_list_networks', `${clientIdentity.family} network discovery`)
    assert(
      JSON.stringify(firstPage.structuredContent) ===
        JSON.stringify(JSON.parse(firstPage.result.content.map((entry: any) => entry?.text ?? '').join('\n'))),
      `${clientIdentity.family} structured and text fallback envelopes should match`,
    )
    const cursor = firstPage.data?._pagination?.next_cursor
    assert(typeof cursor === 'string', `${clientIdentity.family} discovery should return a continuation cursor`)
    const secondPage = await callToolWithRetry(connected.client, 'portal_list_networks', { cursor }, { retries: 1 })
    assert(!secondPage.isError, `${clientIdentity.family} continuation should succeed`)
    steps.push({ step: 'continuation', elapsedMs: firstPage.elapsedMs + secondPage.elapsedMs })

    const head = await callToolWithRetry(
      connected.client,
      'portal_get_head',
      { network: 'base-mainnet' },
      { retries: 1 },
    )
    assert(!head.isError && Number.isFinite(head.data?.number), `${clientIdentity.family} should resolve Base head`)
    assertEvidence(head.data, 'portal_get_head', `${clientIdentity.family} Base head`)
    const transactions = await callToolWithRetry(
      connected.client,
      'portal_evm_query_transactions',
      {
        network: 'base-mainnet',
        from_block: Math.max(0, head.data.number - 100),
        to_block: head.data.number,
        limit: 3,
        field_preset: 'minimal',
      },
      { retries: 1 },
    )
    assert(!transactions.isError, `${clientIdentity.family} multi-step evidence query should succeed`)
    assertEvidence(transactions.data, 'portal_evm_query_transactions', `${clientIdentity.family} transaction result`)
    assertCompleteOrContinuable(transactions.data, `${clientIdentity.family} transaction result`)
    if (typeof transactions.data?._pagination?.next_cursor === 'string') {
      const continuedTransactions = await callToolWithRetry(
        connected.client,
        'portal_evm_query_transactions',
        { cursor: transactions.data._pagination.next_cursor },
        { retries: 1 },
      )
      assert(!continuedTransactions.isError, `${clientIdentity.family} transaction continuation should succeed`)
      assertCompleteOrContinuable(continuedTransactions.data, `${clientIdentity.family} continued transaction result`)
    }
    steps.push({ step: 'multi_step_evidence', elapsedMs: head.elapsedMs + transactions.elapsedMs })

    const concurrentHeads = await Promise.all(
      Array.from({ length: 8 }, () =>
        callToolWithRetry(connected.client, 'portal_get_head', { network: 'base-mainnet' }, { retries: 0 }),
      ),
    )
    const failedConcurrentHeads = concurrentHeads.flatMap((result, index) =>
      result.isError
        ? [
            {
              call: index + 1,
              elapsedMs: result.elapsedMs,
              error: result.structuredContent?.error ?? result.text.slice(0, 240),
            },
          ]
        : [],
    )
    assert(
      failedConcurrentHeads.length === 0,
      `${clientIdentity.family} bounded concurrency should complete all eight calls: ${JSON.stringify(failedConcurrentHeads)}`,
    )
    steps.push({
      step: 'bounded_concurrency',
      calls: concurrentHeads.length,
      maxElapsedMs: Math.max(...concurrentHeads.map((result) => result.elapsedMs)),
    })

    const invalid = await callToolWithRetry(
      connected.client,
      'portal_get_head',
      { network: 'not-a-real-network' },
      { retries: 0, parseJson: false },
    )
    assert(invalid.isError, `${clientIdentity.family} invalid request should be a structured tool error`)
    const recovery = await callToolWithRetry(
      connected.client,
      'portal_hyperliquid_query_fills',
      {
        network: 'hyperliquid-fills',
        timeframe: '5m',
        coin: ['BTC'],
        limit: PRE_UPGRADE_SCHEMA_FIXTURE.hyperliquid_fill_limit,
      },
      { retries: 1 },
    )
    assert(!recovery.isError, `${clientIdentity.family} should recover after a tool error`)
    assertEvidence(recovery.data, 'portal_hyperliquid_query_fills', `${clientIdentity.family} recovery result`)
    assertCompleteOrContinuable(recovery.data, `${clientIdentity.family} recovery result`)
    assert(
      recovery.data?._pagination?.page_size === 25,
      `${clientIdentity.family} retained fill limit should adapt to 25 rows`,
    )
    steps.push({ step: 'tool_error_recovery', elapsedMs: invalid.elapsedMs + recovery.elapsedMs })

    const retainedWallet = await callToolWithRetry(
      connected.client,
      'portal_get_wallet_summary',
      {
        network: 'base-mainnet',
        address: '0x0000000000000000000000000000000000000001',
        timeframe: '10',
        limit_per_type: PRE_UPGRADE_SCHEMA_FIXTURE.wallet_limit_per_type,
      },
      { retries: 1 },
    )
    assert(!retainedWallet.isError, `${clientIdentity.family} retained wallet schema should remain callable`)
    assert(
      retainedWallet.data?._pagination?.page_size === 4,
      `${clientIdentity.family} retained wallet limit should adapt to 4 rows`,
    )
    steps.push({ step: 'retained_schema_execution', elapsedMs: recovery.elapsedMs + retainedWallet.elapsedMs })

    const reconnected = await connectTestClient(`${clientIdentity.name}-reconnected`)
    try {
      const reconnectedApp = await reconnected.client.readResource({ uri: PRE_UPGRADE_SCHEMA_FIXTURE.app_resource_uri })
      assert(
        reconnectedApp.contents.length === 1,
        `${clientIdentity.family} reconnect should retain the cached App resource`,
      )
      const reconnectedDiscovery = await callToolWithRetry(
        reconnected.client,
        'portal_list_networks',
        { limit: 1 },
        { retries: 1 },
      )
      assert(
        !reconnectedDiscovery.isError,
        `${clientIdentity.family} reconnect should execute a tool after resource restoration`,
      )
      steps.push({ step: 'retained_connection_reconnect', elapsedMs: reconnectedDiscovery.elapsedMs })
    } finally {
      await closeTestClient(reconnected)
    }

    return {
      family: clientIdentity.family,
      declaredClientName: clientIdentity.name,
      transport: 'stdio',
      durationMs: Date.now() - startedAt,
      status: 'pass',
      steps,
    }
  } finally {
    await closeTestClient(connected)
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
  const results = []
  for (const [index, client] of CLIENTS.entries()) {
    const result = await runClientJourney(client)
    results.push(result)
    console.log(`PASS  ${client.family} declared-client MCP journey [${result.durationMs}ms]`)
    if (index < CLIENTS.length - 1) {
      console.log(
        `Pausing ${CLIENT_BOUNDARY_COOLDOWN_MS / 1_000}s before the next declared-client journey to isolate client families.`,
      )
      await sleep(CLIENT_BOUNDARY_COOLDOWN_MS)
    }
  }

  const outputPath = `artifacts/client-journeys/v${packageJson.version}.json`
  await mkdir('artifacts/client-journeys', { recursive: true })
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        schemaVersion: 'sqd_mcp_declared_client_journeys_v1',
        createdAt: new Date().toISOString(),
        releaseVersion: packageJson.version,
        proofBoundary:
          'Exercises the real MCP server with each client family declared in protocol metadata. It does not prove the installed host UI or model routing behavior.',
        results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`Wrote ${outputPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
