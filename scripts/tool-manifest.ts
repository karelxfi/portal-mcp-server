import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { EVENT_SIGNATURES } from '../src/constants/index.js'
import { assert, callToolWithRetry, extractJson, getText, sleep } from './test-helpers.ts'

const POLKADOT_SAMPLE_FROM_BLOCK = 30_736_840
const POLKADOT_SAMPLE_TO_BLOCK = 30_736_842
const BASE_RPC_URL = 'https://mainnet.base.org'
const PORTAL_API_URL = 'https://portal.sqd.dev'
const BASE_UNISWAP_V4_POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b'
const AERODROME_SLIPSTREAM_FACTORY = '0xf8f2eb4940cfe7d13603dddd87f123820fc061ef'
const SOLANA_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const BASE_UNISWAP_V3_TEST_POOL_CANDIDATES = [
  '0xf0125d06b76cebc2ab3831a938e07ab6988b00c9',
  '0x3c4384f3664b37a3cb5a5cb3452b4b4a3aa1256f',
  '0xd0b53d9277642d899df5c87a3966a349a798f224',
  '0xe69def85897c95e9ef8439128ee015603b360a71',
  '0xedc625b74537ee3a10874f53d170e9c17a906b9c',
  '0xbc3231036ee1eca03e5f67fecedc640d21610823',
] as const
const SELECTORS = {
  allPools: '0x41d1de97',
} as const

export interface ToolTestContext {
  nowTimestamp: number
  baseHead: number
  solHead: number
  btcHead: number
  hlFillsHead: number
  hlReplicaHead: number
  usdcBase: string
  baseUniswapV2Pool: string
  baseUniswapV3Pool: string
  baseUniswapV4PoolId: string
  aerodromeSlipstreamPool: string
  recentDeploymentContract: string
  recentDeploymentFromBlock: number
  recentDeploymentToBlock: number
  evmWallet: string
  solWallet: string
  btcAddress: string
  hlUser: string
  tokenProgram: string
  solProgramFromBlock: number
  solProgramToBlock: number
}

export interface ToolSpec {
  name: string
  prompt: string
  args: (context: ToolTestContext) => Record<string, unknown>
  validate: (text: string, context: ToolTestContext) => void
  validateError?: (text: string, context: ToolTestContext) => void
  validateFollowUp?: (text: string, client: Client, context: ToolTestContext) => Promise<void>
}

function getItems(data: any): any[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.time_series)) return data.time_series
  if (Array.isArray(data?.candles)) return data.candles
  if (Array.isArray(data?.ohlc)) return data.ohlc
  if (Array.isArray(data?.top_contracts)) return data.top_contracts
  if (Array.isArray(data?.top_events)) return data.top_events
  if (Array.isArray(data?.top_calls)) return data.top_calls
  if (Array.isArray(data?.volume_by_coin)) return data.volume_by_coin
  if (Array.isArray(data?.top_traders_by_volume)) return data.top_traders_by_volume
  if (Array.isArray(data?.programs)) return data.programs
  return []
}

function expectItems(text: string, label: string, minItems = 1): any[] {
  const items = getItems(extractJson(text))
  assert(items.length >= minItems, `${label} should return at least ${minItems} item(s)`)
  return items
}

function expectKey(text: string, key: string, label: string) {
  const data = extractJson(text)
  assert(data?.[key] !== undefined, `${label} should include '${key}'`)
  return data
}

function expectWindowMetadata(data: any, label: string) {
  assert(data?._freshness !== undefined, `${label} should include _freshness`)
  assert(data?._coverage !== undefined, `${label} should include _coverage`)
}

function expectOrdering(data: any, label: string) {
  assert(data?._ordering !== undefined, `${label} should include _ordering`)
}

function expectCompactDefault(data: any, label: string) {
  assert(data?._execution?.response_format === 'compact', `${label} should default to compact response_format`)
}

function expectGapDiagnostics(data: any, label: string) {
  assert(data?.gap_diagnostics !== undefined, `${label} should include gap_diagnostics`)
}

function expectPresentation(data: any, label: string, options?: { chartDataKey?: string; tableId?: string }) {
  assert(data?.chart !== undefined, `${label} should include chart metadata`)
  assert(Array.isArray(data?.tables) && data.tables.length > 0, `${label} should include table metadata`)
  if (options?.chartDataKey) {
    assert(data.chart?.data_key === options.chartDataKey, `${label} chart should point at ${options.chartDataKey}`)
  }
  if (options?.tableId) {
    assert(
      data.tables.some((table: any) => table?.id === options.tableId),
      `${label} should include table ${options.tableId}`,
    )
  }
}

async function getHeadNumber(client: Client, network: string): Promise<number> {
  const result = await callToolWithRetry(client, 'portal_get_head', { network })
  return result.data.number
}

function encodeAddress(value: string) {
  return value.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

function encodeUint(value: number) {
  return value.toString(16).padStart(64, '0')
}

async function baseRpcCall(method: string, params: unknown[]) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(BASE_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    })

    if (response.status === 429 && attempt < 4) {
      await sleep(500 * (attempt + 1))
      continue
    }

    assert(response.ok, `Base RPC ${method} failed with HTTP ${response.status}`)
    const data = (await response.json()) as { result?: unknown; error?: { message?: string } }
    assert(!data.error, `Base RPC ${method} error: ${data.error?.message || 'unknown error'}`)
    assert(data.result !== undefined, `Base RPC ${method} returned no result`)
    return data.result
  }

  throw new Error(`Base RPC ${method} failed after retries`)
}

function decodeAddressWord(value: string) {
  const clean = value.toLowerCase().replace(/^0x/, '')
  assert(clean.length >= 40, 'Expected ABI-encoded address word')
  return `0x${clean.slice(-40)}`
}

function isZeroAddress(value: string) {
  return /^0x0{40}$/.test(value)
}

async function portalStream(dataset: string, body: Record<string, unknown>) {
  const response = await fetch(`${PORTAL_API_URL}/datasets/${dataset}/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (response.status === 204) return []
  if (!response.ok) {
    throw new Error(`Portal stream fixture query failed with HTTP ${response.status}: ${await response.text()}`)
  }
  const text = await response.text()
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function pickCreateTrace(records: Array<Record<string, unknown>>) {
  for (const block of [...records].reverse()) {
    const blockNumber =
      typeof block.number === 'number'
        ? block.number
        : typeof (block.header as Record<string, unknown> | undefined)?.number === 'number'
          ? ((block.header as Record<string, unknown>).number as number)
          : undefined
    const traces = Array.isArray(block.traces) ? (block.traces as Array<Record<string, unknown>>) : []
    for (const trace of [...traces].reverse()) {
      const contractAddress =
        typeof trace.createResultAddress === 'string'
          ? trace.createResultAddress.toLowerCase()
          : typeof (trace.result as Record<string, unknown> | undefined)?.address === 'string'
            ? ((trace.result as Record<string, unknown>).address as string).toLowerCase()
            : undefined
      if (blockNumber !== undefined && contractAddress && !isZeroAddress(contractAddress)) {
        return { blockNumber, contractAddress }
      }
    }
  }
  return undefined
}

async function pickRecentBaseDeployment(baseHead: number) {
  const searchFrom = Math.max(0, baseHead - 20_000)
  const chunkSize = 1_000

  for (let chunkTo = baseHead; chunkTo >= searchFrom; chunkTo -= chunkSize) {
    const chunkFrom = Math.max(searchFrom, chunkTo - chunkSize + 1)
    const records = await portalStream('base-mainnet', {
      type: 'evm',
      fromBlock: chunkFrom,
      toBlock: chunkTo,
      fields: {
        block: { number: true, timestamp: true },
        transaction: {
          hash: true,
          transactionIndex: true,
          from: true,
          to: true,
          status: true,
        },
        trace: {
          type: true,
          transactionIndex: true,
          createFrom: true,
          createResultAddress: true,
          createResultGasUsed: true,
          error: true,
        },
      },
      traces: [{ type: ['create'], transaction: true }],
    })

    const deployment = pickCreateTrace(records)
    if (deployment) {
      return {
        recentDeploymentContract: deployment.contractAddress,
        recentDeploymentFromBlock: Math.max(0, deployment.blockNumber - 3),
        recentDeploymentToBlock: deployment.blockNumber + 3,
      }
    }
  }

  throw new Error('Expected at least one recent Base create trace for deployment lookup tests')
}

async function pickRecentPoolFromCandidates(client: Client, candidates: readonly string[]): Promise<string> {
  const result = await callToolWithRetry(client, 'portal_evm_query_logs', {
    network: 'base-mainnet',
    from_timestamp: '24h ago',
    to_timestamp: 'now',
    addresses: [...candidates],
    topic0: [EVENT_SIGNATURES.UNISWAP_V3_SWAP],
    limit: 20,
    field_preset: 'minimal',
  })

  const items = getItems(result.data)
  const selected = items
    .map((item: any) => String(item?.address || item?.contract_address || '').toLowerCase())
    .find((address) => candidates.includes(address as (typeof candidates)[number]))

  assert(Boolean(selected), 'Expected at least one responsive Base Uniswap v3 test pool candidate')
  return selected!
}

async function baseEthCall(to: string, data: string) {
  const result = await baseRpcCall('eth_call', [{ to, data }, 'latest'])
  assert(typeof result === 'string', 'Expected eth_call to return a hex string')
  return result
}

async function getFactoryPoolAtIndex(factory: string, index: number) {
  const result = await baseEthCall(factory, `${SELECTORS.allPools}${encodeUint(index)}`)
  return decodeAddressWord(result)
}

async function getFactoryPools(factory: string, count: number) {
  const pools: string[] = []
  for (let index = 0; index < count; index += 1) {
    try {
      pools.push(await getFactoryPoolAtIndex(factory, index))
    } catch (error) {
      if (pools.length > 0) break
      throw error
    }
    if (index < count - 1) await sleep(350)
  }
  return pools.map((pool) => pool.toLowerCase()).filter((pool) => !isZeroAddress(pool))
}

async function pickAerodromeSlipstreamPool(client: Client, fallbackPool: string): Promise<string> {
  try {
    const factoryPools = await getFactoryPools(AERODROME_SLIPSTREAM_FACTORY, 24)
    if (factoryPools.length > 0) {
      return await pickRecentPoolFromCandidates(client, factoryPools)
    }
  } catch {
    // Public Base RPC can rate-limit eth_call during CI. The Slipstream test
    // exercises the sqrtPriceX96 swap decoding path, which is shared with V3.
  }

  return fallbackPool
}

async function pickRecentSolanaTokenInstructionSlot(solHead: number): Promise<number> {
  const searchFrom = Math.max(0, solHead - 2_000)
  const chunkSize = 25

  for (let chunkTo = solHead; chunkTo >= searchFrom; chunkTo -= chunkSize) {
    const chunkFrom = Math.max(searchFrom, chunkTo - chunkSize + 1)
    const records = await portalStream('solana-mainnet', {
      type: 'solana',
      fromBlock: chunkFrom,
      toBlock: chunkTo,
      fields: {
        block: { number: true },
        instruction: {
          transactionIndex: true,
          instructionAddress: true,
          programId: true,
        },
      },
      instructions: [{ programId: [SOLANA_TOKEN_PROGRAM_ID] }],
    })

    for (const block of [...records].reverse()) {
      const blockNumber =
        typeof block.number === 'number'
          ? block.number
          : typeof (block.header as Record<string, unknown> | undefined)?.number === 'number'
            ? ((block.header as Record<string, unknown>).number as number)
            : undefined
      const instructions = Array.isArray(block.instructions) ? block.instructions : []
      if (blockNumber !== undefined && instructions.length > 0) {
        return blockNumber
      }
    }
  }

  throw new Error('Expected at least one recent Solana token-program instruction slot')
}

export async function loadToolTestContext(client: Client): Promise<ToolTestContext> {
  const [baseHead, solHead, btcHead, hlFillsHead, hlReplicaHead] = await Promise.all([
    getHeadNumber(client, 'base-mainnet'),
    getHeadNumber(client, 'solana-mainnet'),
    getHeadNumber(client, 'bitcoin-mainnet'),
    getHeadNumber(client, 'hyperliquid-fills'),
    getHeadNumber(client, 'hyperliquid-replica-cmds'),
  ])

  const [
    usdcResolveResult,
    recentDeployment,
    recentV2SwapResult,
    recentSwapResult,
    recentV4SwapResult,
    evmTxResult,
    solTxResult,
    solInstructionSlot,
    btcTxResult,
    hlFillResult,
  ] = await Promise.all([
    callToolWithRetry(client, 'portal_resolve_entity', {
      network: 'base-mainnet',
      kind: 'token',
      query: 'USDC',
      limit: 5,
    }),
    pickRecentBaseDeployment(baseHead),
    callToolWithRetry(client, 'portal_evm_query_logs', {
      network: 'base-mainnet',
      from_timestamp: '6h ago',
      to_timestamp: 'now',
      topic0: [EVENT_SIGNATURES.UNISWAP_V2_SWAP],
      limit: 1,
      field_preset: 'minimal',
    }),
    callToolWithRetry(client, 'portal_evm_query_logs', {
      network: 'base-mainnet',
      from_timestamp: '6h ago',
      to_timestamp: 'now',
      topic0: [EVENT_SIGNATURES.UNISWAP_V3_SWAP],
      limit: 1,
      field_preset: 'minimal',
    }),
    callToolWithRetry(client, 'portal_evm_query_logs', {
      network: 'base-mainnet',
      from_block: baseHead - 2_000,
      to_block: baseHead,
      addresses: [BASE_UNISWAP_V4_POOL_MANAGER],
      topic0: [EVENT_SIGNATURES.UNISWAP_V4_SWAP],
      limit: 50,
      field_preset: 'standard',
    }),
    callToolWithRetry(client, 'portal_evm_query_transactions', {
      network: 'base-mainnet',
      from_block: baseHead - 200,
      to_block: baseHead,
      limit: 1,
      field_preset: 'minimal',
    }),
    callToolWithRetry(client, 'portal_solana_query_transactions', {
      network: 'solana-mainnet',
      from_block: solHead - 20,
      to_block: solHead,
      limit: 1,
    }),
    pickRecentSolanaTokenInstructionSlot(solHead),
    callToolWithRetry(client, 'portal_bitcoin_query_transactions', {
      network: 'bitcoin-mainnet',
      timeframe: '1h',
      limit: 3,
      include_outputs: true,
    }),
    callToolWithRetry(client, 'portal_hyperliquid_query_fills', {
      network: 'hyperliquid-fills',
      timeframe: '5m',
      limit: 1,
    }),
  ])

  const recentV2SwapItems = getItems(recentV2SwapResult.data)
  assert(recentV2SwapItems.length > 0, 'Expected at least one active Base Uniswap v2-style pool')
  const baseUniswapV2Pool = String(recentV2SwapItems[0].address || '').toLowerCase()
  assert(baseUniswapV2Pool.startsWith('0x'), 'Expected an active Base Uniswap v2-style pool address')

  const usdcMatches = Array.isArray(usdcResolveResult.data?.matches) ? usdcResolveResult.data.matches : []
  const usdcBase = String(
    usdcMatches.find((item: any) => String(item?.symbol || '').toUpperCase() === 'USDC')?.address || '',
  ).toLowerCase()
  assert(/^0x[0-9a-f]{40}$/.test(usdcBase), 'Expected USDC to resolve from token-list data on Base')

  const recentSwapItems = getItems(recentSwapResult.data)
  assert(recentSwapItems.length > 0, 'Expected at least one active Base Uniswap V3 pool')
  const baseUniswapV3Pool = await pickRecentPoolFromCandidates(client, BASE_UNISWAP_V3_TEST_POOL_CANDIDATES)

  const recentV4SwapItems = getItems(recentV4SwapResult.data)
  assert(recentV4SwapItems.length > 0, 'Expected at least one active Base Uniswap v4 pool id')
  const baseUniswapV4PoolId =
    [
      ...recentV4SwapItems
        .reduce((counts, item: any) => {
          const poolId = String(item?.topics?.[1] || '').toLowerCase()
          if (poolId) counts.set(poolId, (counts.get(poolId) || 0) + 1)
          return counts
        }, new Map<string, number>())
        .entries(),
    ].sort((left, right) => right[1] - left[1])[0]?.[0] || ''
  assert(/^0x[0-9a-f]{64}$/.test(baseUniswapV4PoolId), 'Expected a recent Base Uniswap v4 pool id')

  const aerodromeSlipstreamPool = await pickAerodromeSlipstreamPool(client, baseUniswapV3Pool)
  assert(!isZeroAddress(aerodromeSlipstreamPool), 'Expected an active sqrtPriceX96 pool candidate on Base')

  const evmWallet = String(evmTxResult.data.items?.[0]?.from || '')
  assert(evmWallet.startsWith('0x'), 'Expected an active Base wallet')

  const solItem = solTxResult.data.items?.[0]
  const solWallet = String(solItem?.feePayer || solItem?.sender || '')
  assert(solWallet.length > 20, 'Expected an active Solana fee payer')

  const solInstructionProgram = SOLANA_TOKEN_PROGRAM_ID
  assert(Number.isFinite(solInstructionSlot), 'Expected an active Solana instruction slot')

  const btcItems = btcTxResult.data.items || []
  const btcAddress = String(
    btcItems
      .flatMap((item: any) => item.outputs || [])
      .find((output: any) => typeof output?.scriptPubKeyAddress === 'string' || typeof output?.address === 'string')
      ?.scriptPubKeyAddress ||
      btcItems.flatMap((item: any) => item.outputs || []).find((output: any) => typeof output?.address === 'string')
        ?.address ||
      '',
  )
  assert(btcAddress.length > 10, 'Expected a recent Bitcoin output address')

  const hlUser = String(hlFillResult.data.items?.[0]?.user || '')
  assert(hlUser.startsWith('0x'), 'Expected an active Hyperliquid user')

  return {
    nowTimestamp: Math.floor(Date.now() / 1000),
    baseHead,
    solHead,
    btcHead,
    hlFillsHead,
    hlReplicaHead,
    usdcBase,
    baseUniswapV2Pool,
    baseUniswapV3Pool,
    baseUniswapV4PoolId,
    aerodromeSlipstreamPool,
    ...recentDeployment,
    evmWallet,
    solWallet,
    btcAddress,
    hlUser,
    tokenProgram: solInstructionProgram,
    solProgramFromBlock: solInstructionSlot,
    solProgramToBlock: solInstructionSlot,
  }
}

export const LEGACY_TOOL_NAMES = [
  'portal_list_datasets',
  'portal_get_dataset_info',
  'portal_get_block_number',
  'portal_query_transactions',
  'portal_query_logs',
  'portal_get_erc20_transfers',
  'portal_get_contract_activity',
  'portal_evm_ohlc',
  'portal_query_solana_transactions',
  'portal_query_solana_instructions',
  'portal_solana_analytics',
  'portal_query_bitcoin_transactions',
  'portal_bitcoin_analytics',
  'portal_query_hyperliquid_fills',
  'portal_hyperliquid_analytics',
  'portal_hyperliquid_ohlc',
  'portal_query_blocks',
  'portal_block_at_timestamp',
  'portal_query_hyperliquid_replica_cmds',
  'portal_get_recent_transactions',
  'portal_compare_periods',
  'portal_get_top_contract_trends',
  'portal_get_transaction_density',
  'portal_get_top_contracts',
  'portal_decode_logs',
  'portal_solana_time_series',
  'portal_bitcoin_time_series',
  'portal_hyperliquid_time_series',
  'portal_query_bitcoin_inputs',
  'portal_query_bitcoin_outputs',
  'portal_aggregate_hyperliquid_fills',
] as const

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'portal_list_networks',
    prompt: "what's the actual network name for Base again",
    args: () => ({ vm: 'evm', network_type: 'mainnet', limit: 10 }),
    validate: (text) => {
      const items = expectItems(text, 'portal_list_networks')
      assert(
        items.some((item: any) => item.vm === 'evm'),
        'Expected at least one EVM network',
      )
    },
  },
  {
    name: 'portal_get_network_info',
    prompt: 'is Base even indexed and caught up right now',
    args: () => ({ network: 'base' }),
    validate: (text) => {
      const data = expectKey(text, 'head', 'portal_get_network_info')
      assert(data.vm === 'evm', 'Base should resolve to an EVM network')
      assert(data.indexing?.indexed_head?.block_number === data.head?.number, 'Expected indexed head metadata')
    },
  },
  {
    name: 'portal_get_head',
    prompt: 'what block is Base on right now',
    args: () => ({ network: 'base' }),
    validate: (text) => {
      const data = extractJson(text)
      assert(typeof data.number === 'number' && data.number > 1_000_000, 'Expected a recent block number')
    },
  },
  {
    name: 'portal_resolve_entity',
    prompt: 'what token contract does USDC mean on Base',
    args: () => ({ network: 'base', kind: 'token', query: 'USDC', limit: 5 }),
    validate: (text) => {
      const data = extractJson(text)
      const matches = Array.isArray(data.matches) ? data.matches : []
      assert(matches.length > 0, 'Expected at least one USDC token-list match')
      assert(
        matches.some((item: any) => String(item.symbol || '').toUpperCase() === 'USDC'),
        'Expected a USDC symbol match',
      )
      assert(
        matches.every((item: any) => item.source === 'coingecko_token_list'),
        'Expected token-list source metadata',
      )
      assert(data.token_list_lookup?.source === 'coingecko_token_list', 'Expected token-list lookup metadata')
      assert(data.suggested_arguments?.token_addresses?.length > 0, 'Expected suggested token_addresses')
    },
    validateFollowUp: async (_text, client, context) => {
      const [contractResult, protocolResult, hyperliquidCoinResult, poolResult] = await Promise.all([
        callToolWithRetry(client, 'portal_resolve_entity', {
          network: 'ethereum-mainnet',
          kind: 'contract',
          query: 'bored apes',
          limit: 5,
        }),
        callToolWithRetry(client, 'portal_resolve_entity', {
          kind: 'protocol',
          query: 'uniswap',
          limit: 5,
        }),
        callToolWithRetry(client, 'portal_resolve_entity', {
          kind: 'hyperliquid_coin',
          query: 'bitcoin',
          limit: 5,
        }),
        callToolWithRetry(client, 'portal_resolve_entity', {
          network: 'base-mainnet',
          kind: 'pool',
          query: context.baseUniswapV4PoolId,
          limit: 5,
        }),
      ])

      const contractData = contractResult.data
      assert(
        contractData.matches?.[0]?.address === '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
        'Expected BAYC alias to resolve to the canonical Ethereum contract',
      )
      assert(contractData.suggested_arguments?.contract_address, 'Expected contract suggested arguments')

      const protocolData = protocolResult.data
      assert(
        protocolData.matches?.some((item: any) => String(item.slug || '').includes('uniswap')),
        'Expected Uniswap protocol match',
      )
      assert(protocolData.suggested_arguments?.protocol_slugs?.length > 0, 'Expected protocol slug suggestions')

      const hyperliquidCoinData = hyperliquidCoinResult.data
      assert(hyperliquidCoinData.matches?.[0]?.coin === 'BTC', 'Expected bitcoin to normalize to BTC')
      assert(
        hyperliquidCoinData.suggested_arguments?.coin?.includes('BTC'),
        'Expected Hyperliquid coin suggestion',
      )

      const poolData = poolResult.data
      assert(poolData.matches?.[0]?.identifier === context.baseUniswapV4PoolId, 'Expected pool id match')
      assert(poolData.matches?.[0]?.validation_status === 'format_only', 'Expected explicit pool validation status')
    },
  },
  {
    name: 'portal_get_recent_activity',
    prompt: 'what has been happening on Base lately',
    args: () => ({ network: 'base', timeframe: '100', limit: 3 }),
    validate: (text) => {
      const data = extractJson(text)
      const items = getItems(data)
      assert(items.length === 3, 'Expected 3 recent Base activity items')
      expectWindowMetadata(data, 'portal_get_recent_activity')
      expectOrdering(data, 'portal_get_recent_activity')
      assert(typeof items[0].primary_id === 'string', 'Expected normalized primary_id')
    },
  },
  {
    name: 'portal_get_wallet_summary',
    prompt: 'can you just tell me what this Base wallet has been doing',
    args: (context) => ({ network: 'base', address: context.evmWallet, timeframe: '5m' }),
    validate: (text) => {
      const data = extractJson(text)
      expectKey(text, 'overview', 'portal_get_wallet_summary evm')
      assert(data.overview?.vm === 'evm', 'Expected EVM wallet overview')
      assert(Array.isArray(data.activity?.items), 'Expected activity items on EVM wallet summary')
      assert(data.pipes_handoff?.version === 'pipes_recipe_v1', 'Expected wallet summary Pipes handoff')
      expectWindowMetadata(data, 'portal_get_wallet_summary evm')
    },
    validateFollowUp: async (_text, client, context) => {
      const [solanaResult, bitcoinResult, hyperliquidResult] = await Promise.all([
        callToolWithRetry(client, 'portal_get_wallet_summary', {
          network: 'solana-mainnet',
          address: context.solWallet,
          timeframe: '1h',
        }),
        callToolWithRetry(client, 'portal_get_wallet_summary', {
          network: 'bitcoin-mainnet',
          address: context.btcAddress,
          timeframe: '24h',
        }),
        callToolWithRetry(client, 'portal_get_wallet_summary', {
          network: 'hyperliquid-fills',
          address: context.hlUser,
          timeframe: '5m',
        }),
      ])

      const solanaData = solanaResult.data
      assert(solanaData.overview?.vm === 'solana', 'Expected Solana wallet overview')
      assert(solanaData.solana?.fee_summary !== undefined, 'Expected Solana-specific fee summary')
      expectWindowMetadata(solanaData, 'portal_get_wallet_summary solana')

      const bitcoinData = bitcoinResult.data
      assert(bitcoinData.overview?.vm === 'bitcoin', 'Expected Bitcoin wallet overview')
      assert(bitcoinData.bitcoin?.outputs_count !== undefined, 'Expected Bitcoin-specific counts')
      expectWindowMetadata(bitcoinData, 'portal_get_wallet_summary bitcoin')

      const hyperliquidData = hyperliquidResult.data
      assert(hyperliquidData.overview?.vm === 'hyperliquid', 'Expected Hyperliquid wallet overview')
      assert(hyperliquidData.hyperliquid?.fee_summary !== undefined, 'Expected Hyperliquid fee summary')
      expectWindowMetadata(hyperliquidData, 'portal_get_wallet_summary hyperliquid')
    },
  },
  {
    name: 'portal_get_time_series',
    prompt: 'make me a simple Base activity chart for the last hour',
    args: () => ({ network: 'base', metric: 'transaction_count', interval: '5m', duration: '1h' }),
    validate: (text) => {
      const data = extractJson(text)
      expectItems(text, 'portal_get_time_series base', 12)
      expectWindowMetadata(data, 'portal_get_time_series base')
      expectGapDiagnostics(data, 'portal_get_time_series base')
      assert(data.chart?.kind === 'time_series', 'Expected time-series chart metadata')
      assert(data.pipes_handoff?.version === 'pipes_recipe_v1', 'Expected time-series Pipes handoff')
      expectPresentation(data, 'portal_get_time_series base', { chartDataKey: 'time_series', tableId: 'main' })
    },
    validateFollowUp: async (_text, client) => {
      const [compareResult, groupedResult, solanaResult, bitcoinResult, hyperliquidResult] = await Promise.all([
        callToolWithRetry(client, 'portal_get_time_series', {
          network: 'base',
          metric: 'transaction_count',
          interval: '5m',
          duration: '1h',
          compare_previous: true,
        }),
        callToolWithRetry(client, 'portal_get_time_series', {
          network: 'base',
          metric: 'transaction_count',
          interval: '5m',
          duration: '1h',
          group_by: 'contract',
          group_limit: 3,
        }),
        callToolWithRetry(client, 'portal_get_time_series', {
          network: 'solana-mainnet',
          metric: 'tps',
          interval: '5m',
          duration: '1h',
        }),
        callToolWithRetry(client, 'portal_get_time_series', {
          network: 'bitcoin-mainnet',
          metric: 'block_size_bytes',
          interval: '1h',
          duration: '24h',
        }),
        callToolWithRetry(client, 'portal_get_time_series', {
          network: 'hyperliquid-fills',
          metric: 'volume',
          interval: '5m',
          duration: 'in last 38 mins',
        }),
      ])

      const compareData = compareResult.data
      assert(Array.isArray(compareData.current_series), 'Expected current_series')
      assert(Array.isArray(compareData.previous_series), 'Expected previous_series')
      assert(Array.isArray(compareData.comparison_series), 'Expected comparison_series')
      assert(Array.isArray(compareData.bucket_deltas), 'Expected bucket_deltas')
      expectWindowMetadata(compareData, 'portal_get_time_series compare_previous')
      expectPresentation(compareData, 'portal_get_time_series compare_previous', {
        chartDataKey: 'comparison_series',
        tableId: 'comparison_series',
      })

      const groupedData = groupedResult.data
      assert(Array.isArray(groupedData.top_contracts) && groupedData.top_contracts.length > 0, 'Expected top_contracts')
      assert(groupedData.chart?.grouped_value_field === 'contract_address', 'Expected grouped contract chart metadata')
      expectWindowMetadata(groupedData, 'portal_get_time_series grouped')
      expectGapDiagnostics(groupedData, 'portal_get_time_series grouped')
      expectPresentation(groupedData, 'portal_get_time_series grouped', {
        chartDataKey: 'time_series',
        tableId: 'contract_series',
      })

      const solanaData = solanaResult.data
      assert(getItems(solanaData).length >= 12, 'portal_get_time_series solana should return at least 12 item(s)')
      assert(solanaData.summary?.metric === 'tps', 'Expected Solana TPS summary')
      expectWindowMetadata(solanaData, 'portal_get_time_series solana')
      expectPresentation(solanaData, 'portal_get_time_series solana', { chartDataKey: 'time_series', tableId: 'main' })

      const bitcoinData = bitcoinResult.data
      assert(getItems(bitcoinData).length >= 12, 'portal_get_time_series bitcoin should return at least 12 item(s)')
      assert(bitcoinData.summary?.metric === 'block_size_bytes', 'Expected Bitcoin metric summary')
      expectWindowMetadata(bitcoinData, 'portal_get_time_series bitcoin')
      expectPresentation(bitcoinData, 'portal_get_time_series bitcoin', {
        chartDataKey: 'time_series',
        tableId: 'main',
      })

      const hyperliquidData = hyperliquidResult.data
      const hyperliquidRows = getItems(hyperliquidData)
      assert(
        hyperliquidRows.length === 8,
        'portal_get_time_series hyperliquid should return 8 buckets for 38m at 5m granularity',
      )
      assert(
        hyperliquidRows.some((row: any) => Number(row.value ?? 0) > 0 || Number(row.blocks_in_bucket ?? 0) > 0),
        'portal_get_time_series hyperliquid should not emit all-empty buckets for an active recent window',
      )
      assert(hyperliquidData._coverage?.expected_buckets === 8, 'Expected Hyperliquid coverage to report 8 buckets')
      assert(hyperliquidData._coverage?.returned_buckets === 8, 'Expected Hyperliquid coverage to return all buckets')
      assert(hyperliquidData.summary?.metric === 'volume', 'Expected Hyperliquid metric summary')
      expectWindowMetadata(hyperliquidData, 'portal_get_time_series hyperliquid')
      expectPresentation(hyperliquidData, 'portal_get_time_series hyperliquid', {
        chartDataKey: 'time_series',
        tableId: 'main',
      })
    },
  },
  {
    name: 'portal_evm_query_transactions',
    prompt: 'show me a few raw Base transactions so I can inspect them',
    args: (context) => ({
      network: 'base',
      from_block: context.baseHead - 200,
      to_block: context.baseHead,
      limit: 3,
      field_preset: 'minimal',
    }),
    validate: (text) => {
      const data = extractJson(text)
      const items = getItems(data)
      assert(items.length === 3, 'Expected 3 EVM transactions')
      expectCompactDefault(data, 'portal_evm_query_transactions')
      expectWindowMetadata(data, 'portal_evm_query_transactions')
      expectOrdering(data, 'portal_evm_query_transactions')
    },
    validateFollowUp: async (_text, client, context) => {
      const result = await callToolWithRetry(client, 'portal_evm_query_transactions', {
        network: 'ethereum-mainnet',
        from_block: 12_244_000,
        to_block: 12_244_200,
        transaction_type: '0x1',
        scan_order: 'earliest',
        limit: 1,
        field_preset: 'minimal',
      })
      const data = result.data
      const items = getItems(data)
      assert(items.length === 1, 'Expected first Ethereum type 0x1 transaction')
      assert(items[0].block_number === 12_244_145, 'Expected first type 0x1 tx in block 12244145')
      assert(items[0].transactionIndex === 14, 'Expected first type 0x1 tx at transaction index 14')
      assert(
        items[0].hash === '0x851bad0415758075a1eb86776749c829b866d43179c57c3e4a4b9359a0358231',
        'Expected known first type 0x1 transaction hash',
      )
      assert(items[0].type === 1, 'Expected normalized transaction type 1')
      assert(data._execution?.scan_order === 'earliest', 'Expected earliest scan execution metadata')
      assert(typeof data._execution?.scanned_blocks === 'number', 'Expected shared bounded-search metadata')
      assert(typeof data._execution?.max_scan_blocks === 'number', 'Expected max scan metadata')

      const methodAliasResult = await callToolWithRetry(client, 'portal_evm_query_transactions', {
        network: 'base',
        from_block: context.baseHead - 5_000,
        to_block: context.baseHead,
        to_token_symbols: ['USDC'],
        method: 'transfer',
        order_by: 'gas_used_desc',
        scan_order: 'latest',
        max_scan_blocks: 5_000,
        limit: 3,
        field_preset: 'standard',
      })
      const methodAliasData = methodAliasResult.data
      const methodAliasItems = getItems(methodAliasData)
      assert(methodAliasItems.length > 0, 'Expected recent Base USDC transfer transactions via method alias')
      assert(
        methodAliasItems.every((item: any) => /^0x[0-9a-f]{40}$/.test(String(item.to || '').toLowerCase())),
        'Expected method alias results to target token contracts',
      )
      assert(
        methodAliasData._execution?.notes?.some((note: string) => note.includes('to_token_symbols')),
        'Expected transaction token symbol resolution metadata',
      )
      assert(methodAliasData._execution?.order_by === 'gas_used_desc', 'Expected order_by execution metadata')
      for (let index = 1; index < methodAliasItems.length; index += 1) {
        const previousGasUsed = BigInt(methodAliasItems[index - 1].gasUsed ?? 0)
        const currentGasUsed = BigInt(methodAliasItems[index].gasUsed ?? 0)
        assert(previousGasUsed >= currentGasUsed, 'Expected gas_used_desc ranking to be descending')
      }
    },
  },
  {
    name: 'portal_evm_query_logs',
    prompt: 'show me recent USDC event logs on Base',
    args: (context) => ({
      network: 'base',
      from_block: context.baseHead - 200,
      to_block: context.baseHead,
      addresses: [context.usdcBase],
      limit: 3,
      field_preset: 'minimal',
    }),
    validate: (text, context) => {
      const data = extractJson(text)
      const items = getItems(data)
      assert(items[0].address?.toLowerCase() === context.usdcBase, 'Expected USDC log results')
      expectCompactDefault(data, 'portal_evm_query_logs')
      expectWindowMetadata(data, 'portal_evm_query_logs')
      expectOrdering(data, 'portal_evm_query_logs')
    },
    validateFollowUp: async (_text, client, context) => {
      const decodeResult = await callToolWithRetry(client, 'portal_evm_query_logs', {
        network: 'base',
        from_block: context.baseHead - 200,
        to_block: context.baseHead,
        addresses: [context.usdcBase],
        limit: 1,
        decode: true,
      })
      const data = decodeResult.data
      const items = getItems(data)
      assert(items[0].decoded_log !== undefined, 'Expected decoded_log on EVM log results')
      expectCompactDefault(data, 'portal_evm_query_logs decode')
      expectWindowMetadata(data, 'portal_evm_query_logs decode')

      const eventAliasResult = await callToolWithRetry(client, 'portal_evm_query_logs', {
        network: 'base',
        from_block: context.baseHead - 2_000,
        to_block: context.baseHead,
        addresses: [context.usdcBase],
        event: 'transfer',
        scan_order: 'earliest',
        limit: 1,
        field_preset: 'minimal',
      })
      const eventAliasData = eventAliasResult.data
      const eventAliasItems = getItems(eventAliasData)
      assert(eventAliasItems.length === 1, 'Expected first recent USDC Transfer log via event alias')
      assert(
        eventAliasItems[0].topics?.[0] === EVENT_SIGNATURES.TRANSFER_ERC20,
        'Expected Transfer topic from event alias',
      )
      assert(eventAliasData._execution?.scan_order === 'earliest', 'Expected earliest log scan metadata')
      assert(
        typeof eventAliasData._execution?.scanned_blocks === 'number',
        'Expected shared bounded-search metadata on log scan',
      )

      const tokenSymbolResult = await callToolWithRetry(client, 'portal_evm_query_logs', {
        network: 'base',
        from_block: context.baseHead - 2_000,
        to_block: context.baseHead,
        token_symbols: ['USDC'],
        event: 'transfer',
        limit: 1,
        field_preset: 'minimal',
      })
      const tokenSymbolItems = getItems(tokenSymbolResult.data)
      assert(tokenSymbolItems.length === 1, 'Expected token_symbols to resolve USDC log filters')
    },
  },
  {
    name: 'portal_evm_query_token_transfers',
    prompt: 'did USDC move around on Base recently',
    args: (context) => ({
      network: 'base',
      from_block: context.baseHead - 200,
      to_block: context.baseHead,
      token_addresses: [context.usdcBase],
      limit: 3,
    }),
    validate: (text, context) => {
      const data = extractJson(text)
      const items = getItems(data)
      assert(items[0].token_address?.toLowerCase() === context.usdcBase, 'Expected USDC transfers')
      expectWindowMetadata(data, 'portal_evm_query_token_transfers')
      expectOrdering(data, 'portal_evm_query_token_transfers')
    },
    validateFollowUp: async (_text, client, context) => {
      const result = await callToolWithRetry(client, 'portal_evm_query_token_transfers', {
        network: 'base',
        from_block: context.baseHead - 2_000,
        to_block: context.baseHead,
        token_addresses: [context.usdcBase],
        scan_order: 'earliest',
        limit: 1,
      })
      const data = result.data
      const items = getItems(data)
      assert(items.length === 1, 'Expected earliest recent USDC token transfer')
      assert(
        items[0].token_address?.toLowerCase() === context.usdcBase,
        'Expected earliest transfer to preserve token address',
      )
      assert(data._execution?.scan_order === 'earliest', 'Expected token transfer scan metadata')
      assert(typeof data._execution?.scanned_blocks === 'number', 'Expected shared bounded-search metadata')

      const symbolResult = await callToolWithRetry(client, 'portal_evm_query_token_transfers', {
        network: 'base',
        from_block: context.baseHead - 2_000,
        to_block: context.baseHead,
        token_symbols: ['USDC'],
        include_token_info: true,
        limit: 1,
      })
      const symbolItems = getItems(symbolResult.data)
      assert(symbolItems.length === 1, 'Expected token_symbols to resolve USDC token transfer filters')
      assert(
        String(symbolItems[0].token_symbol || '').toUpperCase() === 'USDC',
        'Expected token-list metadata enrichment',
      )
      assert(
        String(symbolItems[0].value_formatted || '').includes('USDC'),
        'Expected human-readable token units in value_formatted',
      )
    },
  },
  {
    name: 'portal_evm_get_contract_deployment',
    prompt: 'who deployed this recent Base contract and in which tx',
    args: (context) => ({
      network: 'base',
      contract_address: context.recentDeploymentContract,
      from_block: context.recentDeploymentFromBlock,
      to_block: context.recentDeploymentToBlock,
      scan_order: 'earliest',
    }),
    validate: (text, context) => {
      const data = extractJson(text)
      const items = getItems(data)
      assert(items.length === 1, 'Expected one deployment lookup result')
      assert(
        items[0].deployed_contract_address?.toLowerCase() === context.recentDeploymentContract,
        'Expected deployment contract address match',
      )
      assert(
        typeof items[0].transaction_hash === 'string' && items[0].transaction_hash.startsWith('0x'),
        'Expected parent deployment transaction hash',
      )
      assert(typeof items[0].deployer === 'string' && items[0].deployer.startsWith('0x'), 'Expected deployer address')
      assert(data._execution?.scan_order === 'earliest', 'Expected deployment scan metadata')
      assert(typeof data._execution?.scanned_blocks === 'number', 'Expected shared bounded-search metadata')
      expectWindowMetadata(data, 'portal_evm_get_contract_deployment')
    },
  },
  {
    name: 'portal_evm_get_contract_activity',
    prompt: 'what has this Base contract been doing',
    args: (context) => ({ network: 'base', contract_address: context.baseUniswapV3Pool, timeframe: '1h' }),
    validate: (text) => {
      const data = extractJson(text)
      assert(data.interactions !== undefined || data.overview !== undefined, 'Expected contract activity payload')
      expectWindowMetadata(data, 'portal_evm_get_contract_activity')
    },
  },
  {
    name: 'portal_evm_get_analytics',
    prompt: 'give me the big picture for Base activity',
    args: () => ({ network: 'base', timeframe: 'past 30 minutes', limit: 3 }),
    validate: (text) => {
      const data = extractJson(text)
      assert(Array.isArray(data.top_contracts), 'Expected top_contracts section')
      assert(data.overview !== undefined, 'Expected overview section')
      expectWindowMetadata(data, 'portal_evm_get_analytics')
      expectOrdering(data, 'portal_evm_get_analytics')
    },
  },
  {
    name: 'portal_evm_get_ohlc',
    prompt: 'make me price candles for this Base pool',
    args: (context) => ({
      network: 'base',
      pool_address: context.baseUniswapV3Pool,
      source: 'uniswap_v3_swap',
      duration: '1h',
      interval: 'auto',
      mode: 'deep',
      price_in: 'auto',
      include_recent_trades: true,
      recent_trades_limit: 5,
    }),
    validate: (text) => {
      const data = extractJson(text)
      const candles = Array.isArray(data.ohlc) ? data.ohlc : getItems(data)
      assert(candles.length > 0, 'Expected EVM candles')
      assert(data.summary?.mode === 'deep', 'Expected explicit OHLC mode in summary')
      assert(data.summary?.price_in_resolved !== undefined, 'Expected resolved OHLC price orientation')
      assert(data.market_context?.pair !== undefined, 'Expected structured market_context pair section')
      assert(data.guidance?.recommended_mode !== undefined, 'Expected guidance section for OHLC')
      assert(Array.isArray(data.recent_trades), 'Expected recent_trades array')
      assert(
        Array.isArray(data.tables) && data.tables.some((table: any) => table?.id === 'recent_trades'),
        'Expected recent_trades table descriptor',
      )
      expectWindowMetadata(data, 'portal_evm_get_ohlc')
      expectGapDiagnostics(data, 'portal_evm_get_ohlc')
      expectOrdering(data, 'portal_evm_get_ohlc')
      expectPresentation(data, 'portal_evm_get_ohlc', { chartDataKey: 'ohlc', tableId: 'ohlc' })
    },
    validateFollowUp: async (_text, client, context) => {
      const callOhlcVariant = async (label: string, args: Record<string, unknown>) => {
        try {
          return await callToolWithRetry(client, 'portal_evm_get_ohlc', args, {
            retries: 3,
            retryDelayMs: 1_200,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`${label}: ${message}`)
        }
      }

      const uniswapV2Result = await callOhlcVariant('uniswap v2-style OHLC follow-up', {
        network: 'base-mainnet',
        pool_address: context.baseUniswapV2Pool,
        source: 'uniswap_v2_swap',
        duration: '1h',
        interval: '5m',
        mode: 'fast',
        price_in: 'auto',
        include_recent_trades: true,
        recent_trades_limit: 3,
      })
      await sleep(400)
      const aerodromeSlipstreamResult = await callOhlcVariant('aerodrome slipstream OHLC follow-up', {
        network: 'base-mainnet',
        pool_address: context.aerodromeSlipstreamPool,
        source: 'aerodrome_slipstream_swap',
        duration: '1h',
        interval: '5m',
        mode: 'fast',
        price_in: 'auto',
        include_recent_trades: true,
        recent_trades_limit: 3,
      })
      await sleep(400)
      const uniswapV4Result = await callOhlcVariant('uniswap v4 OHLC follow-up', {
        network: 'base-mainnet',
        source: 'uniswap_v4_swap',
        pool_id: context.baseUniswapV4PoolId,
        duration: '1h',
        interval: '5m',
        mode: 'deep',
        price_in: 'auto',
        include_recent_trades: true,
        recent_trades_limit: 3,
      })

      const uniswapV2Data = uniswapV2Result.data
      const uniswapV2Candles = Array.isArray(uniswapV2Data.ohlc) ? uniswapV2Data.ohlc : []
      assert(uniswapV2Data.summary?.source === 'uniswap_v2_swap', 'Expected Uniswap v2-style OHLC source')
      assert(
        uniswapV2Data.summary?.source_family === 'uniswap_v2_style_swap',
        'Expected Uniswap v2-style source family',
      )
      assert(
        uniswapV2Data.summary?.price_method === 'execution_ratio',
        'Expected execution_ratio price method for Uniswap v2-style swaps',
      )
      assert(uniswapV2Data.summary?.mode === 'fast', 'Expected fast mode for Uniswap v2-style OHLC')
      assert(
        uniswapV2Data.summary?.volume_available === true,
        'Expected volume_available=true for Uniswap v2-style swaps',
      )
      assert(uniswapV2Candles.length > 0, 'Expected Uniswap v2-style candles')
      assert(
        Array.isArray(uniswapV2Data.recent_trades) && uniswapV2Data.recent_trades.length > 0,
        'Expected recent_trades for Uniswap v2-style OHLC',
      )
      expectWindowMetadata(uniswapV2Data, 'portal_evm_get_ohlc uniswap v2-style swap')
      expectGapDiagnostics(uniswapV2Data, 'portal_evm_get_ohlc uniswap v2-style swap')
      expectPresentation(uniswapV2Data, 'portal_evm_get_ohlc uniswap v2-style swap', {
        chartDataKey: 'ohlc',
        tableId: 'ohlc',
      })

      const aerodromeSlipstreamData = aerodromeSlipstreamResult.data
      const aerodromeSlipstreamCandles = Array.isArray(aerodromeSlipstreamData.ohlc) ? aerodromeSlipstreamData.ohlc : []
      assert(
        aerodromeSlipstreamData.summary?.source === 'aerodrome_slipstream_swap',
        'Expected Aerodrome Slipstream OHLC source',
      )
      assert(
        aerodromeSlipstreamData.summary?.source_family === 'aerodrome_slipstream',
        'Expected Aerodrome Slipstream source family',
      )
      assert(
        aerodromeSlipstreamData.summary?.price_method === 'sqrt_price_x96',
        'Expected sqrt_price_x96 price method for Slipstream',
      )
      assert(aerodromeSlipstreamData.summary?.mode === 'fast', 'Expected fast mode for Slipstream OHLC')
      assert(
        aerodromeSlipstreamData.summary?.volume_available === true,
        'Expected volume_available=true for Slipstream swaps',
      )
      assert(aerodromeSlipstreamCandles.length > 0, 'Expected Aerodrome Slipstream candles')
      assert(Array.isArray(aerodromeSlipstreamData.recent_trades), 'Expected recent_trades for Slipstream OHLC')
      expectWindowMetadata(aerodromeSlipstreamData, 'portal_evm_get_ohlc aerodrome slipstream')
      expectGapDiagnostics(aerodromeSlipstreamData, 'portal_evm_get_ohlc aerodrome slipstream')
      expectPresentation(aerodromeSlipstreamData, 'portal_evm_get_ohlc aerodrome slipstream', {
        chartDataKey: 'ohlc',
        tableId: 'ohlc',
      })

      const uniswapV4Data = uniswapV4Result.data
      const uniswapV4Candles = Array.isArray(uniswapV4Data.ohlc) ? uniswapV4Data.ohlc : []
      assert(uniswapV4Data.summary?.source === 'uniswap_v4_swap', 'Expected Uniswap v4 OHLC source')
      assert(uniswapV4Data.summary?.source_family === 'uniswap_v4', 'Expected Uniswap v4 source family')
      assert(
        uniswapV4Data.summary?.price_method === 'sqrt_price_x96',
        'Expected sqrt_price_x96 price method for Uniswap v4',
      )
      assert(uniswapV4Data.summary?.mode === 'deep', 'Expected deep mode for Uniswap v4 OHLC')
      assert(uniswapV4Data.summary?.volume_available === true, 'Expected volume_available=true for Uniswap v4 swaps')
      assert(
        uniswapV4Data.summary?.pool_id === context.baseUniswapV4PoolId,
        'Expected the requested Uniswap v4 pool id in summary',
      )
      assert(
        uniswapV4Data.summary?.pool_manager_address === BASE_UNISWAP_V4_POOL_MANAGER,
        'Expected the official Base PoolManager address',
      )
      assert(uniswapV4Data.summary?.price_in_resolved !== undefined, 'Expected resolved Uniswap v4 price orientation')
      assert(Array.isArray(uniswapV4Data.recent_trades), 'Expected recent_trades for Uniswap v4 OHLC')
      assert(
        uniswapV4Data.market_context?.pool?.metadata_resolution_status !== undefined,
        'Expected explicit Uniswap v4 metadata resolution status',
      )
      if (uniswapV4Data.market_context?.pool?.metadata_resolved_from_initialize === true) {
        assert(
          uniswapV4Data.summary?.currency0_address !== undefined,
          'Expected resolved Uniswap v4 currency0 metadata when Initialize lookup succeeds',
        )
        assert(
          uniswapV4Data.summary?.currency1_address !== undefined,
          'Expected resolved Uniswap v4 currency1 metadata when Initialize lookup succeeds',
        )
      }
      assert(uniswapV4Candles.length > 0, 'Expected Uniswap v4 candles')
      expectWindowMetadata(uniswapV4Data, 'portal_evm_get_ohlc uniswap v4')
      expectGapDiagnostics(uniswapV4Data, 'portal_evm_get_ohlc uniswap v4')
      expectPresentation(uniswapV4Data, 'portal_evm_get_ohlc uniswap v4', { chartDataKey: 'ohlc', tableId: 'ohlc' })
    },
  },
  {
    name: 'portal_solana_query_transactions',
    prompt: 'show me some recent Solana transactions',
    args: (context) => ({
      network: 'solana-mainnet',
      from_block: context.solHead - 20,
      to_block: context.solHead,
      limit: 3,
    }),
    validate: (text) => {
      const data = extractJson(text)
      expectItems(text, 'portal_solana_query_transactions', 1)
      expectCompactDefault(data, 'portal_solana_query_transactions')
      expectWindowMetadata(data, 'portal_solana_query_transactions')
      expectOrdering(data, 'portal_solana_query_transactions')
    },
  },
  {
    name: 'portal_solana_query_instructions',
    prompt: 'show me recent Solana program instructions',
    args: (context) => ({
      network: 'solana-mainnet',
      from_block: context.solProgramFromBlock,
      to_block: context.solProgramToBlock,
      program_id: context.tokenProgram,
      limit: 1,
    }),
    validate: (text) => {
      const data = extractJson(text)
      expectItems(text, 'portal_solana_query_instructions', 1)
      expectWindowMetadata(data, 'portal_solana_query_instructions')
      expectOrdering(data, 'portal_solana_query_instructions')
    },
    validateFollowUp: async (_text, client, context) => {
      const result = await callToolWithRetry(client, 'portal_solana_query_instructions', {
        network: 'solana-mainnet',
        from_block: context.solProgramFromBlock,
        to_block: context.solProgramToBlock,
        program_id: context.tokenProgram,
        include_transaction: true,
        limit: 2,
      })
      const data = result.data
      const items = getItems(data)
      assert(items.length > 0, 'Expected Solana program instruction rows')
      assert(
        data._execution !== undefined,
        'Expected Solana execution window metadata',
      )
      expectWindowMetadata(data, 'portal_solana_query_instructions token program')
      expectOrdering(data, 'portal_solana_query_instructions token program')
    },
  },
  {
    name: 'portal_solana_get_analytics',
    prompt: 'give me the big picture for Solana right now',
    args: () => ({ network: 'solana-mainnet', timeframe: '15m', include_programs: false }),
    validate: (text) => {
      const data = extractJson(text)
      assert(data.network !== undefined || data.overview !== undefined, 'Expected Solana analytics payload')
      expectWindowMetadata(data, 'portal_solana_get_analytics')
    },
  },
  {
    name: 'portal_bitcoin_query_transactions',
    prompt: 'show me a few recent Bitcoin transactions',
    args: () => ({ network: 'bitcoin-mainnet', timeframe: '1h', limit: 3 }),
    validate: (text) => {
      const data = extractJson(text)
      expectItems(text, 'portal_bitcoin_query_transactions', 1)
      expectCompactDefault(data, 'portal_bitcoin_query_transactions')
      expectWindowMetadata(data, 'portal_bitcoin_query_transactions')
      expectOrdering(data, 'portal_bitcoin_query_transactions')
    },
    validateFollowUp: async (_text, client, context) => {
      const ioResult = await callToolWithRetry(client, 'portal_bitcoin_query_transactions', {
        network: 'bitcoin-mainnet',
        timeframe: '1h',
        limit: 1,
        include_inputs: true,
        include_outputs: true,
      })
      const data = ioResult.data
      const items = getItems(data)
      expectCompactDefault(data, 'portal_bitcoin_query_transactions io')
      assert(items[0].inputs !== undefined, 'Expected inline inputs')
      assert(items[0].outputs !== undefined, 'Expected inline outputs')
      expectWindowMetadata(data, 'portal_bitcoin_query_transactions io')

      const walletResult = await callToolWithRetry(client, 'portal_get_wallet_summary', {
        network: 'bitcoin-mainnet',
        address: context.btcAddress,
        timeframe: '24h',
      })
      const walletData = walletResult.data
      assert(walletData.overview?.vm === 'bitcoin', 'Expected Bitcoin address flow to route through wallet summary')
      assert(walletData.bitcoin?.outputs_count !== undefined, 'Expected Bitcoin address output counts')
    },
  },
  {
    name: 'portal_bitcoin_get_analytics',
    prompt: 'give me the big picture for Bitcoin right now',
    args: () => ({ network: 'bitcoin-mainnet', timeframe: '1h', response_format: 'summary' }),
    validate: (text) => {
      const data = extractJson(text)
      assert(data.overview !== undefined, 'Expected Bitcoin analytics summary')
      expectWindowMetadata(data, 'portal_bitcoin_get_analytics')
    },
  },
  {
    name: 'portal_substrate_query_events',
    prompt: 'show me raw Polkadot events and keep the parent context inline',
    args: () => ({
      network: 'polkadot',
      from_block: POLKADOT_SAMPLE_FROM_BLOCK,
      to_block: POLKADOT_SAMPLE_TO_BLOCK,
      event_names: ['ParaInclusion.CandidateIncluded'],
      include_extrinsic: true,
      include_call: true,
      limit: 3,
    }),
    validate: (text) => {
      const data = extractJson(text)
      const items = getItems(data)
      assert(items.length > 0, 'Expected Substrate event rows')
      assert(
        items[0].event_name === 'ParaInclusion.CandidateIncluded' ||
          items[0].name === 'ParaInclusion.CandidateIncluded',
        'Expected CandidateIncluded events',
      )
      expectCompactDefault(data, 'portal_substrate_query_events')
      assert(items[0].extrinsic !== undefined, 'Expected inline extrinsic context on Substrate events')
      assert(items[0].call !== undefined, 'Expected inline call context on Substrate events')
      expectWindowMetadata(data, 'portal_substrate_query_events')
      expectOrdering(data, 'portal_substrate_query_events')
    },
  },
  {
    name: 'portal_substrate_query_calls',
    prompt: 'show me raw Polkadot calls with emitted events',
    args: () => ({
      network: 'polkadot',
      from_block: POLKADOT_SAMPLE_FROM_BLOCK,
      to_block: POLKADOT_SAMPLE_TO_BLOCK,
      call_names: ['ParaInherent.enter'],
      include_extrinsic: true,
      include_events: true,
      limit: 3,
    }),
    validate: (text) => {
      const data = extractJson(text)
      const items = getItems(data)
      assert(items.length > 0, 'Expected Substrate call rows')
      assert(
        items[0].call_name === 'ParaInherent.enter' || items[0].name === 'ParaInherent.enter',
        'Expected ParaInherent.enter calls',
      )
      expectCompactDefault(data, 'portal_substrate_query_calls')
      assert(items[0].extrinsic !== undefined, 'Expected inline extrinsic context on Substrate calls')
      assert(Array.isArray(items[0].events) && items[0].events.length > 0, 'Expected emitted events on Substrate calls')
      expectWindowMetadata(data, 'portal_substrate_query_calls')
      expectOrdering(data, 'portal_substrate_query_calls')
    },
  },
  {
    name: 'portal_substrate_get_analytics',
    prompt: 'give me the big picture for Polkadot activity in this sample window',
    args: () => ({
      network: 'polkadot',
      from_block: POLKADOT_SAMPLE_FROM_BLOCK,
      to_block: POLKADOT_SAMPLE_TO_BLOCK,
    }),
    validate: (text) => {
      const data = extractJson(text)
      assert(data.overview !== undefined, 'Expected Substrate analytics overview')
      assert(Array.isArray(data.top_events) && data.top_events.length > 0, 'Expected ranked Substrate events')
      assert(Array.isArray(data.top_calls) && data.top_calls.length > 0, 'Expected ranked Substrate calls')
      assert(
        Array.isArray(data.tables) && data.tables.some((table: any) => table?.id === 'top_events'),
        'Expected top_events table metadata',
      )
      assert(
        Array.isArray(data.tables) && data.tables.some((table: any) => table?.id === 'top_calls'),
        'Expected top_calls table metadata',
      )
      expectWindowMetadata(data, 'portal_substrate_get_analytics')
    },
  },
  {
    name: 'portal_hyperliquid_query_fills',
    prompt: 'show me some recent Hyperliquid fills',
    args: () => ({ network: 'hyperliquid-fills', timeframe: '5m', limit: 3 }),
    validate: (text) => {
      const data = extractJson(text)
      expectItems(text, 'portal_hyperliquid_query_fills', 1)
      expectCompactDefault(data, 'portal_hyperliquid_query_fills')
      expectWindowMetadata(data, 'portal_hyperliquid_query_fills')
      expectOrdering(data, 'portal_hyperliquid_query_fills')
    },
    validateFollowUp: async (_text, client, context) => {
      const [coinResult, traderResult] = await Promise.all([
        callToolWithRetry(client, 'portal_hyperliquid_query_fills', {
          network: 'hyperliquid-fills',
          timeframe: '1h',
          coin: ['BTC'],
          limit: 2,
        }),
        callToolWithRetry(client, 'portal_hyperliquid_query_fills', {
          network: 'hyperliquid-fills',
          timeframe: '1h',
          user: [context.hlUser],
          include_pnl: true,
          limit: 2,
        }),
      ])
      const coinItems = getItems(coinResult.data)
      assert(coinItems.length > 0, 'Expected Hyperliquid BTC fill rows')
      assert(
        coinItems.every((item: any) => String(item.coin || '').toUpperCase() === 'BTC'),
        'Expected Hyperliquid coin filter to preserve BTC',
      )
      const traderItems = getItems(traderResult.data)
      assert(traderItems.length > 0, 'Expected Hyperliquid trader fill rows')
      expectWindowMetadata(traderResult.data, 'portal_hyperliquid_query_fills trader')
    },
  },
  {
    name: 'portal_hyperliquid_get_analytics',
    prompt: 'give me the big picture for Hyperliquid fills',
    args: () => ({ network: 'hyperliquid-fills', timeframe: '1h' }),
    validate: (text) => {
      const data = extractJson(text)
      assert(
        data.volume_by_coin !== undefined || data.overview !== undefined,
        'Expected Hyperliquid analytics sections',
      )
      expectWindowMetadata(data, 'portal_hyperliquid_get_analytics')
    },
  },
  {
    name: 'portal_hyperliquid_get_ohlc',
    prompt: 'make me BTC candles from recent Hyperliquid fills',
    args: () => ({ network: 'hyperliquid-fills', coin: 'BTC', duration: 'in last 38 mins', interval: '5m' }),
    validate: (text) => {
      const data = extractJson(text)
      const candles = Array.isArray(data.ohlc) ? data.ohlc : getItems(data)
      assert(candles.length > 0, 'Expected Hyperliquid candles')
      assert(candles.length === 8, 'Expected 8 Hyperliquid candles for 38m at 5m granularity')
      assert(
        candles.some((candle: any) => Number(candle.close ?? 0) > 0 || Number(candle.fill_count ?? 0) > 0),
        'Expected Hyperliquid candles to include non-empty buckets',
      )
      expectWindowMetadata(data, 'portal_hyperliquid_get_ohlc')
      expectGapDiagnostics(data, 'portal_hyperliquid_get_ohlc')
      expectOrdering(data, 'portal_hyperliquid_get_ohlc')
      expectPresentation(data, 'portal_hyperliquid_get_ohlc', { chartDataKey: 'ohlc', tableId: 'ohlc' })
    },
  },
  {
    name: 'portal_debug_query_blocks',
    prompt: 'show me the last few Base blocks directly',
    args: () => ({ network: 'base', from_timestamp: '10m ago', to_timestamp: 'now', limit: 3 }),
    validate: (text) => {
      const data = extractJson(text)
      expectItems(text, 'portal_debug_query_blocks', 3)
      expectWindowMetadata(data, 'portal_debug_query_blocks')
      expectOrdering(data, 'portal_debug_query_blocks')
    },
  },
  {
    name: 'portal_debug_resolve_time_to_block',
    prompt: 'what Base block matches this timestamp',
    args: (context) => ({
      network: 'base',
      timestamp: new Date((context.nowTimestamp - 24 * 3600) * 1000).toISOString(),
    }),
    validate: (text) => {
      const data = extractJson(text)
      assert(typeof data.block_number === 'number' && data.block_number > 0, 'Expected a block number')
      assert(typeof data.timestamp_human === 'string', 'Expected human-readable timestamp')
      assert(typeof data.resolution === 'string', 'Expected resolution kind')
      expectWindowMetadata(data, 'portal_debug_resolve_time_to_block')
    },
  },
  {
    name: 'portal_debug_hyperliquid_query_replica_commands',
    prompt: 'show me recent Hyperliquid order and cancel commands',
    args: () => ({
      network: 'hyperliquid-replica-cmds',
      from_timestamp: '5m ago',
      to_timestamp: 'now',
      action_type: ['order'],
      limit: 1,
    }),
    validate: (text) => {
      const data = extractJson(text)
      expectItems(text, 'portal_debug_hyperliquid_query_replica_commands', 1)
      expectWindowMetadata(data, 'portal_debug_hyperliquid_query_replica_commands')
      expectOrdering(data, 'portal_debug_hyperliquid_query_replica_commands')
    },
  },
]
