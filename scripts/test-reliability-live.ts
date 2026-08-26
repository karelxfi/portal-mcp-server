#!/usr/bin/env tsx

import { type ToolCallResult, assert, callToolWithRetry, closeTestClient, connectTestClient } from './test-helpers.ts'

const MAX_INTERACTIVE_MS = 10_000

async function callWithoutRetry(
  client: Parameters<typeof callToolWithRetry>[0],
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const result = await callToolWithRetry(client, tool, args, { retries: 0 })
  assert(!result.isError, `${tool} returned a tool error: ${result.text.slice(0, 240)}`)
  assert(result.elapsedMs < MAX_INTERACTIVE_MS, `${tool} took ${result.elapsedMs}ms`)
  return result
}

async function main() {
  console.log('Starting live reliability regression sweep...')
  const connected = await connectTestClient('reliability-live-test')
  const { client } = connected

  try {
    const [baseHeadResult, solanaHeadResult, usdcResult, tronNetworksResult, tronInfoResult] = await Promise.all([
      callWithoutRetry(client, 'portal_get_head', { network: 'base' }),
      callWithoutRetry(client, 'portal_get_head', { network: 'solana-mainnet' }),
      callWithoutRetry(client, 'portal_resolve_entity', { network: 'base', kind: 'token', query: 'USDC', limit: 5 }),
      callWithoutRetry(client, 'portal_list_networks', { vm: 'tron', limit: 10 }),
      callWithoutRetry(client, 'portal_get_network_info', { network: 'tron-mainnet' }),
    ])
    const baseHead = Number(baseHeadResult.data.number)
    const solanaHead = Number(solanaHeadResult.data.number)
    const usdc = String(
      usdcResult.data.matches?.find((match: any) => String(match?.symbol).toUpperCase() === 'USDC')?.address || '',
    ).toLowerCase()
    assert(Number.isFinite(baseHead) && baseHead > 0, 'Expected current Base head')
    assert(Number.isFinite(solanaHead) && solanaHead > 0, 'Expected current Solana head')
    assert(/^0x[0-9a-f]{40}$/.test(usdc), 'Expected Base USDC address from entity resolver')
    assert(
      tronNetworksResult.data.items?.some(
        (network: any) => network.network === 'tron-mainnet' && network.vm === 'tron',
      ),
      'Expected Tron discovery to use the native VM family',
    )
    assert(tronInfoResult.data.vm === 'tron', 'Expected Tron network info to use the native VM family')
    assert(
      Number(tronInfoResult.data.indexing?.indexed_head?.timestamp) > 1_000_000_000,
      'Expected Tron network info to resolve its indexed head timestamp',
    )

    const walletFixtureResult = await callWithoutRetry(client, 'portal_evm_query_transactions', {
      network: 'base',
      from_block: baseHead - 500,
      to_block: baseHead,
      limit: 20,
      field_preset: 'standard',
      response_format: 'full',
    })
    const wallets = Array.from(
      new Set(
        (walletFixtureResult.data.items ?? [])
          .map((item: any) => String(item?.from || '').toLowerCase())
          .filter((address: string) => /^0x[0-9a-f]{40}$/.test(address)),
      ),
    ).slice(0, 5)
    assert(wallets.length >= 3, `Expected at least 3 active Base wallets, got ${wallets.length}`)

    let partialWallets = 0
    for (const address of wallets) {
      const result = await callWithoutRetry(client, 'portal_get_wallet_summary', {
        network: 'base',
        address,
        timeframe: '5m',
      })
      assert(result.data.overview?.vm === 'evm', 'Wallet summary should return EVM overview')
      assert(Array.isArray(result.data.activity?.items), 'Wallet summary should return activity items')
      if (result.data.overview?.partial) partialWallets += 1
    }
    assert(
      partialWallets <= Math.floor(wallets.length / 2),
      `Too many partial wallet summaries: ${partialWallets}/${wallets.length}`,
    )
    console.log(`PASS  portal_get_wallet_summary: ${wallets.length}/${wallets.length} calls, ${partialWallets} partial`)

    const durations = ['30m', '45m', '1h']
    for (let index = 0; index < 3; index += 1) {
      const baseFrom = baseHead - 200 - index * 50
      await callWithoutRetry(client, 'portal_evm_query_transactions', {
        network: 'base',
        from_block: baseFrom,
        to_block: baseHead,
        limit: 5,
        field_preset: 'standard',
      })
      await callWithoutRetry(client, 'portal_evm_query_logs', {
        network: 'base',
        from_block: baseFrom,
        to_block: baseHead,
        addresses: [usdc],
        limit: 5,
      })
      await callWithoutRetry(client, 'portal_evm_query_token_transfers', {
        network: 'base',
        from_block: baseFrom,
        to_block: baseHead,
        token_addresses: [usdc],
        limit: 5,
      })
      await callWithoutRetry(client, 'portal_get_time_series', {
        network: 'base',
        metric: 'transaction_count',
        interval: '5m',
        duration: durations[index],
      })
      await callWithoutRetry(client, 'portal_solana_query_transactions', {
        network: 'solana-mainnet',
        from_block: solanaHead - 10 - index * 10,
        to_block: solanaHead,
        limit: 5,
      })
    }

    console.log('PASS  highest-error raw and time-series tools: 15/15 calls without retries')
    console.log('Live reliability regression sweep passed')
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(`Live reliability regression sweep failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
