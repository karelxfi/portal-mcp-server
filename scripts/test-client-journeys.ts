#!/usr/bin/env tsx

import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { assert, callToolWithRetry, closeTestClient, connectTestClient } from './test-helpers.ts'

const CLIENTS = [
  { family: 'claude', name: 'claude-desktop' },
  { family: 'codex', name: 'codex' },
  { family: 'grok', name: 'grok' },
  { family: 'gemini', name: 'gemini-cli' },
  { family: 'cursor', name: 'cursor' },
] as const

function assertCompleteOrContinuable(data: any, label: string) {
  const complete = data?._coverage?.result_complete === true
  const continuable = data?._coverage?.result_complete === false && typeof data?._pagination?.next_cursor === 'string'
  assert(complete || continuable, `${label} should be complete or expose an exact continuation cursor`)
}

async function runClientJourney(clientIdentity: (typeof CLIENTS)[number]) {
  const connected = await connectTestClient(clientIdentity.name)
  const startedAt = Date.now()
  const steps: Record<string, unknown>[] = []

  try {
    const { tools } = await connected.client.listTools()
    assert(tools.length === 28, `${clientIdentity.family} should discover 28 tools`)
    steps.push({ step: 'discovery', tools: tools.length })

    const firstPage = await callToolWithRetry(connected.client, 'portal_list_networks', { limit: 3 }, { retries: 1 })
    assert(!firstPage.isError, `${clientIdentity.family} first call should succeed`)
    assert(firstPage.dataSource === 'structuredContent', `${clientIdentity.family} should receive structuredContent`)
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
    assert(
      concurrentHeads.every((result) => !result.isError),
      `${clientIdentity.family} bounded concurrency should complete all eight calls`,
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
      { network: 'hyperliquid-fills', timeframe: '5m', limit: 3 },
      { retries: 1 },
    )
    assert(!recovery.isError, `${clientIdentity.family} should recover after a tool error`)
    assertCompleteOrContinuable(recovery.data, `${clientIdentity.family} recovery result`)
    steps.push({ step: 'tool_error_recovery', elapsedMs: invalid.elapsedMs + recovery.elapsedMs })

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
  for (const client of CLIENTS) {
    const result = await runClientJourney(client)
    results.push(result)
    console.log(`PASS  ${client.family} declared-client MCP journey [${result.durationMs}ms]`)
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
