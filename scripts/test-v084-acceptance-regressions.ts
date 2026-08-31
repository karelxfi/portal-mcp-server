#!/usr/bin/env tsx

import { assert, callToolWithRetry, closeTestClient, connectTestClient } from './test-helpers.js'

const POLKADOT_SAMPLE_FROM_BLOCK = 30_736_840
const POLKADOT_SAMPLE_TO_BLOCK = 30_736_842

function assertAppDelivery(data: any, label: string) {
  assert(data?._app?.name === 'SQD Blockchain Activity Explorer', `${label} must identify the SQD App`)
  assert(data?._app?.server_delivery_state === 'ready', `${label} must report a ready App resource`)
  assert(
    data?._app?.host_render_state === 'not_observable_from_tool_result',
    `${label} must not claim that the host did or did not render the App`,
  )
  assert(data?._ui?.version === 'portal_ui_v1', `${label} must include portable UI metadata`)
  assert(Array.isArray(data?._ui?.panels), `${label} must declare its App panels`)
}

function assertEvidence(data: any, label: string, options?: { allowEmpty?: boolean }) {
  assert(typeof data?._evidence?.result?.exact_data_sha256 === 'string', `${label} must include a data digest`)
  assert(typeof data?._evidence?.result?.row_count === 'number', `${label} must include an evidence row count`)
  if (!options?.allowEmpty) {
    assert(data._evidence.result.row_count > 0, `${label} evidence must point to returned data`)
    assert(typeof data?._evidence?.result?.primary_evidence_path === 'string', `${label} must identify its evidence path`)
  }
}

function assertNoDanglingWalletTables(data: any) {
  const tableIds = new Set((data?.tables ?? []).map((table: any) => table?.id).filter(Boolean))
  const panelTableIds = new Set(
    (data?._ui?.panels ?? [])
      .filter((panel: any) => panel?.kind === 'table_panel')
      .map((panel: any) => panel?.table_id)
      .filter(Boolean),
  )
  for (const tableId of tableIds) {
    assert(panelTableIds.has(tableId), `wallet table ${tableId} must have a visible App panel`)
  }
  for (const card of data?._ui?.metric_cards ?? []) {
    assert(!String(card?.value_path ?? '').endsWith('.length'), 'wallet metric paths must resolve to explicit values')
  }
}

async function main() {
  const connected = await connectTestClient('v084-acceptance-regressions')
  try {
    const invalidNetwork = await callToolWithRetry(
      connected.client,
      'portal_get_head',
      { network: 'definitely-not-a-network' },
      { retries: 0 },
    )
    assert(invalidNetwork.isError, 'the negative fixture must return a structured error')
    assert(
      invalidNetwork.structuredContent?._server?.name === 'SQD' &&
        invalidNetwork.structuredContent?._server?.version === '0.8.4',
      'structured errors must identify the exact server version',
    )

    const recentActivity = await callToolWithRetry(connected.client, 'portal_get_recent_activity', {
      network: 'base',
      timeframe: '15m',
      limit: 5,
    })
    assert(!recentActivity.isError, `Base recent activity failed: ${recentActivity.text.slice(0, 240)}`)
    assertAppDelivery(recentActivity.data, 'Base recent activity')
    assert((recentActivity.data?._ui?.metric_cards ?? []).length >= 3, 'recent activity must include useful metrics')
    assert(recentActivity.data?._freshness?.timestamp_bounds?.from, 'recent activity must report the resolved lower timestamp')
    assert(recentActivity.data?._freshness?.timestamp_bounds?.to, 'recent activity must report the resolved upper timestamp')

    const activeRow = (recentActivity.data?.items ?? []).find((row: any) =>
      typeof row?.sender === 'string' || typeof row?.recipient === 'string' ||
      typeof row?.from === 'string' || typeof row?.to === 'string',
    )
    const activeAddress = activeRow?.sender ?? activeRow?.recipient ?? activeRow?.from ?? activeRow?.to
    assert(/^0x[0-9a-fA-F]{40}$/.test(String(activeAddress ?? '')), 'recent Base activity must expose a wallet fixture')

    const wallet = await callToolWithRetry(
      connected.client,
      'portal_get_wallet_summary',
      {
        network: 'base',
        address: activeAddress,
        timeframe: '1h',
        include_tokens: false,
        include_nfts: false,
        limit_per_type: 5,
        response_format: 'full',
      },
      { retries: 2, totalBudgetMs: 90_000 },
    )
    assert(!wallet.isError, `Base wallet summary failed: ${wallet.text.slice(0, 240)}`)
    assertAppDelivery(wallet.data, 'Base wallet summary')
    assert(wallet.data?.section_status?.token_transfers === 'omitted', 'omitted token data must be marked omitted')
    assert(wallet.data?.section_status?.nft_transfers === 'omitted', 'omitted NFT data must be marked omitted')
    assert(wallet.data?.assets?.token_transfers === undefined, 'omitted token data must not be reported as zero')
    assert(wallet.data?.assets?.nft_transfers === undefined, 'omitted NFT data must not be reported as zero')
    assert(
      !(wallet.data?._ui?.metric_cards ?? []).some((card: any) => ['token-transfers', 'nft-transfers'].includes(card?.id)),
      'omitted wallet sections must not produce zero-valued App cards',
    )
    assertNoDanglingWalletTables(wallet.data)
    assert(
      !String(wallet.data?._execution?.recommended_window ?? '').includes('6h'),
      'the wallet must not recommend a larger six-hour window for a smaller result',
    )

    const tokenTransfers = await callToolWithRetry(connected.client, 'portal_evm_query_token_transfers', {
      network: 'base',
      timeframe: '15m',
      token_symbols: ['USDC'],
      include_token_info: true,
      limit: 3,
    })
    assert(!tokenTransfers.isError, `Base token transfers failed: ${tokenTransfers.text.slice(0, 240)}`)
    assertAppDelivery(tokenTransfers.data, 'Base token transfers')
    assertEvidence(tokenTransfers.data, 'Base token transfers', { allowEmpty: true })

    const solanaAnalytics = await callToolWithRetry(
      connected.client,
      'portal_solana_get_analytics',
      {
        network: 'solana-mainnet',
        timeframe: '5m',
        mode: 'fast',
        include_programs: true,
        program_limit: 3,
        response_format: 'compact',
      },
      { retries: 2, totalBudgetMs: 90_000 },
    )
    assert(!solanaAnalytics.isError, `Solana analytics failed: ${solanaAnalytics.text.slice(0, 240)}`)
    assertAppDelivery(solanaAnalytics.data, 'Solana analytics')
    assertEvidence(solanaAnalytics.data, 'Solana analytics')
    assert(typeof solanaAnalytics.data?.fees?.total_fees_lamports === 'string', 'Solana total fees must be exact')
    assert(typeof solanaAnalytics.data?.fees?.total_fees_sol === 'string', 'Solana SOL fees must be exact')
    assert(
      !JSON.stringify(solanaAnalytics.data?.fees?.fee_percentiles_lamports ?? {}).includes('999999'),
      'Solana fee percentiles must not expose floating-point artifacts',
    )

    const bitcoinAnalytics = await callToolWithRetry(
      connected.client,
      'portal_bitcoin_get_analytics',
      { network: 'bitcoin-mainnet', timeframe: '1h', mode: 'fast', response_format: 'compact' },
      { retries: 2, totalBudgetMs: 90_000 },
    )
    assert(!bitcoinAnalytics.isError, `Bitcoin analytics failed: ${bitcoinAnalytics.text.slice(0, 240)}`)
    assertAppDelivery(bitcoinAnalytics.data, 'Bitcoin analytics')
    assertEvidence(bitcoinAnalytics.data, 'Bitcoin analytics')

    const substrateAnalytics = await callToolWithRetry(
      connected.client,
      'portal_substrate_get_analytics',
      {
        network: 'polkadot',
        from_block: POLKADOT_SAMPLE_FROM_BLOCK,
        to_block: POLKADOT_SAMPLE_TO_BLOCK,
        response_format: 'compact',
        section_limit: 3,
      },
      { retries: 2, totalBudgetMs: 90_000 },
    )
    assert(!substrateAnalytics.isError, `Substrate analytics failed: ${substrateAnalytics.text.slice(0, 240)}`)
    assertAppDelivery(substrateAnalytics.data, 'Substrate analytics')
    assertEvidence(substrateAnalytics.data, 'Substrate analytics')

    const substrateEvents = await callToolWithRetry(
      connected.client,
      'portal_substrate_query_events',
      {
        network: 'polkadot',
        from_block: POLKADOT_SAMPLE_FROM_BLOCK,
        to_block: POLKADOT_SAMPLE_TO_BLOCK,
        limit: 3,
        response_format: 'compact',
      },
      { retries: 2, totalBudgetMs: 90_000 },
    )
    assert(!substrateEvents.isError, `Substrate events failed: ${substrateEvents.text.slice(0, 240)}`)
    assertAppDelivery(substrateEvents.data, 'Substrate events')
    assertEvidence(substrateEvents.data, 'Substrate events')

    const timestampBoundary = await callToolWithRetry(connected.client, 'portal_debug_resolve_time_to_block', {
      network: 'bitcoin-mainnet',
      timestamp: '1h ago',
    })
    assert(!timestampBoundary.isError, `Bitcoin timestamp lookup failed: ${timestampBoundary.text.slice(0, 240)}`)
    assert(timestampBoundary.data?.resolution === 'verified_boundary', 'timestamp lookup must describe its actual boundary semantics')
    assert(
      typeof timestampBoundary.data?.timestamp_delta_seconds === 'number',
      'timestamp lookup must expose the difference between requested and resolved timestamps',
    )

    const hyperliquidAnalytics = await callToolWithRetry(
      connected.client,
      'portal_hyperliquid_get_analytics',
      {
        network: 'hyperliquid-fills',
        timeframe: '1h',
        mode: 'fast',
        response_format: 'compact',
        section_limit: 1,
      },
      { retries: 3, totalBudgetMs: 120_000 },
    )
    assert(!hyperliquidAnalytics.isError, `Hyperliquid analytics failed: ${hyperliquidAnalytics.text.slice(0, 240)}`)
    assertEvidence(hyperliquidAnalytics.data, 'Hyperliquid analytics')
    const continuation = hyperliquidAnalytics.data?._pagination?.next_cursor
    if (typeof continuation === 'string') {
      assert(
        hyperliquidAnalytics.data?.next_steps?.continuation?.label === 'Load more results',
        'same-window analytics continuation must not claim to load an older window',
      )
      const continued = await callToolWithRetry(
        connected.client,
        'portal_hyperliquid_get_analytics',
        { cursor: continuation },
        { retries: 3, totalBudgetMs: 120_000 },
      )
      assert(!continued.isError, `Hyperliquid analytics continuation failed: ${continued.text.slice(0, 240)}`)
      assert(continued.data?._freshness?.timestamp_bounds?.from, 'continued analytics must retain the lower timestamp')
      assert(continued.data?._freshness?.timestamp_bounds?.to, 'continued analytics must retain the upper timestamp')
      assert(
        continued.data?._evidence?.request?.requested_window?.timeframe === '1h',
        'continued analytics evidence must retain the original requested window',
      )
    }

    const hyperliquidFills = await callToolWithRetry(
      connected.client,
      'portal_hyperliquid_query_fills',
      { network: 'hyperliquid-fills', timeframe: '1m', limit: 1 },
      { retries: 3, totalBudgetMs: 120_000 },
    )
    assert(!hyperliquidFills.isError, `Hyperliquid fills failed: ${hyperliquidFills.text.slice(0, 240)}`)
    const fillsContinuation = hyperliquidFills.data?._pagination?.next_cursor
    if (typeof fillsContinuation === 'string') {
      assert(
        hyperliquidFills.data?.next_steps?.continuation?.label === 'Load more results',
        'same-window fill continuation must not claim to load an older window',
      )
      const continuedFills = await callToolWithRetry(
        connected.client,
        'portal_hyperliquid_query_fills',
        { cursor: fillsContinuation },
        { retries: 3, totalBudgetMs: 120_000 },
      )
      assert(!continuedFills.isError, `Hyperliquid fill continuation failed: ${continuedFills.text.slice(0, 240)}`)
      assert(continuedFills.data?._freshness?.timestamp_bounds?.from, 'continued fills must retain the lower timestamp')
      assert(continuedFills.data?._freshness?.timestamp_bounds?.to, 'continued fills must retain the upper timestamp')
      assert(
        continuedFills.data?._evidence?.request?.requested_window?.timeframe === '1m',
        'continued fill evidence must retain the original requested window',
      )
    }

    console.log('PASS v0.8.4 acceptance regressions')
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
