#!/usr/bin/env tsx

import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { assert, callToolWithRetry, closeTestClient, connectTestClient } from './test-helpers.ts'

const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function assertEvidence(data: any, tool: string, label: string) {
  const receipt = data?._evidence
  assert(receipt?.tool === tool, `${label} should identify the tool in its receipt`)
  assert(receipt?.source?.provider === 'SQD Portal', `${label} should identify SQD Portal`)
  assert(/^[a-f0-9]{64}$/.test(String(receipt?.result?.exact_data_sha256 ?? '')), `${label} should hash exact data`)
  assert(
    ['complete', 'partial', 'unknown'].includes(receipt?.result?.completeness),
    `${label} should disclose completeness`,
  )
  if (typeof receipt?.result?.primary_evidence_path === 'string') {
    const rows = readPath(data, receipt.result.primary_evidence_path)
    assert(Array.isArray(rows), `${label} primary evidence path should resolve`)
    assert(rows.length === receipt.result.row_count, `${label} receipt row count should reconcile`)
  }
  if (receipt?.result?.completeness === 'partial') {
    assert(
      Array.isArray(receipt.result.partial_reasons) && receipt.result.partial_reasons.length > 0,
      `${label} partial result should explain every material limit`,
    )
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
  const connected = await connectTestClient('sqd-v083-investigation-gate')
  const evidence: Record<string, unknown>[] = []

  try {
    const head = await callToolWithRetry(connected.client, 'portal_get_head', { network: 'base-mainnet' }, { retries: 1 })
    assert(!head.isError && Number.isInteger(head.data?.number), 'Base head should resolve')

    const seed = await callToolWithRetry(
      connected.client,
      'portal_evm_query_transactions',
      {
        network: 'base-mainnet',
        from_block: Math.max(0, head.data.number - 250),
        to_block: head.data.number,
        limit: 20,
        field_preset: 'standard',
        response_format: 'full',
      },
      { retries: 1 },
    )
    assert(!seed.isError && seed.data?.items?.length > 0, 'wallet journey should find a recent exact Base transaction')
    const wallet = String(seed.data.items.find((item: any) => /^0x[0-9a-f]{40}$/i.test(item?.from))?.from ?? '').toLowerCase()
    assert(/^0x[0-9a-f]{40}$/.test(wallet), 'wallet journey should derive a factual active wallet')

    const walletResult = await callToolWithRetry(
      connected.client,
      'portal_get_wallet_summary',
      { network: 'base-mainnet', address: wallet, timeframe: '500' },
      { retries: 1 },
    )
    assert(!walletResult.isError, 'wallet investigation should succeed')
    assertEvidence(walletResult.data, 'portal_get_wallet_summary', 'wallet investigation')
    const walletRows = walletResult.data?.activity?.items ?? []
    assert(walletRows.length > 0, 'wallet investigation should retain exact activity rows')
    assert(
      walletRows.every((row: any) => row?.sender?.toLowerCase() === wallet || row?.recipient?.toLowerCase() === wallet),
      'every wallet activity row should factually involve the requested wallet',
    )
    evidence.push({ journey: 'wallet', wallet, receipt: walletResult.data._evidence })

    const contractResult = await callToolWithRetry(
      connected.client,
      'portal_evm_get_contract_activity',
      {
        network: 'base-mainnet',
        contract_address: BASE_USDC,
        timeframe: '500',
        include_events: true,
        mode: 'deep',
      },
      { retries: 1 },
    )
    assert(!contractResult.isError, 'contract investigation should succeed')
    assertEvidence(contractResult.data, 'portal_evm_get_contract_activity', 'contract investigation')
    assert(contractResult.data?.interactions?.total_transactions > 0, 'active USDC contract should have recent interactions')
    assert(
      contractResult.data.interactions.top_callers.reduce((sum: number, row: any) => sum + row.interaction_count, 0) <=
        contractResult.data.interactions.total_transactions,
      'ranked callers should not exceed the exact interaction total',
    )
    assert(contractResult.data?.events?.total_events >= 0, 'contract event count should be explicit')
    evidence.push({ journey: 'contract', contract: BASE_USDC, receipt: contractResult.data._evidence })

    const marketResult = await callToolWithRetry(
      connected.client,
      'portal_hyperliquid_get_ohlc',
      { network: 'hyperliquid-fills', coin: 'BTC', duration: '5m', interval: '1m' },
      { retries: 1 },
    )
    assert(!marketResult.isError, 'market investigation should succeed')
    assertEvidence(marketResult.data, 'portal_hyperliquid_get_ohlc', 'market investigation')
    assert(marketResult.data?.ohlc?.length === 5, 'five-minute market journey should return five one-minute buckets')
    assert(
      marketResult.data.ohlc.reduce((sum: number, row: any) => sum + row.fill_count, 0) ===
        marketResult.data.summary.total_fills,
      'candle fill counts should reconcile to the exact summary total',
    )
    assert(
      marketResult.data.ohlc.reduce((sum: number, row: any) => sum + row.volume, 0).toFixed(2) ===
        Number(marketResult.data.summary.total_volume).toFixed(2),
      'candle volume should reconcile to the exact summary total',
    )
    assert(marketResult.data._evidence.replay.mode === 'semantic', 'a moving recent window must not claim exact replay')
    evidence.push({ journey: 'market', coin: 'BTC', receipt: marketResult.data._evidence })

    await mkdir('artifacts/investigations', { recursive: true })
    const outputPath = `artifacts/investigations/v${packageJson.version}.json`
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          schemaVersion: 'sqd_investigation_journeys_v1',
          createdAt: new Date().toISOString(),
          releaseVersion: packageJson.version,
          proofBoundary:
            'Wallet and contract journeys reconcile their returned records and aggregates. Hyperliquid candle rows reconcile to the summary; direct Portal row parity is enforced separately by test:data-integrity.',
          evidence,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    console.log('PASS  wallet investigation returns complete factual wallet-involved rows')
    console.log('PASS  contract investigation reconciles ranked callers with exact interaction totals')
    console.log('PASS  market investigation reconciles every candle to fill and volume totals')
    console.log(`Wrote ${outputPath}`)
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
