import { getActiveDelegatedCredentialCacheScope } from '../auth/delegated.js'
import { createCache } from '../helpers/cache-manager.js'
import { createBlockRangeError, createDatasetError } from '../helpers/errors.js'
import { portalFetch } from '../helpers/fetch.js'
import { type PortalEndpoint, buildPortalUrl, getDefaultPortalEndpoint, portalEndpointKey } from '../portal/endpoints.js'
import type { BlockHead, ChainType, Dataset, DatasetMetadata } from '../types/index.js'

// ============================================================================
// Dataset Cache & Request Deduplication
// ============================================================================

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const HEAD_CACHE_TTL = 30 * 1000 // 30 seconds (blocks change every 2-12s)

const headCache = createCache<BlockHead>(HEAD_CACHE_TTL, 100)
const metadataCache = createCache<{ start_block: number; head: BlockHead; finalized_head?: BlockHead }>(
  HEAD_CACHE_TTL,
  100,
)
const datasetsCache = new Map<string, { data: Dataset[]; timestamp: number }>()
const knownDatasetKinds = new Map<string, ChainType>()

const pendingRequests = new Map<string, Promise<any>>()

function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!pendingRequests.has(key)) {
    const promise = fn().finally(() => pendingRequests.delete(key))
    pendingRequests.set(key, promise)
  }
  return pendingRequests.get(key) as Promise<T>
}

function scopedKey(endpoint: PortalEndpoint, key: string): string {
  const credentialScope = getActiveDelegatedCredentialCacheScope(endpoint)
  return `${portalEndpointKey(endpoint)}:${credentialScope ?? 'shared'}:${key}`
}

function rememberDatasetKinds(datasets: Dataset[], endpoint: PortalEndpoint) {
  for (const dataset of datasets) {
    const kind = dataset.metadata?.kind
    if (!kind) continue

    knownDatasetKinds.set(scopedKey(endpoint, dataset.dataset.toLowerCase()), kind)
    dataset.aliases.forEach((alias) => knownDatasetKinds.set(scopedKey(endpoint, alias.toLowerCase()), kind))
  }
}

export function peekKnownChainType(dataset: string, endpoint: PortalEndpoint = getDefaultPortalEndpoint()): ChainType | undefined {
  return knownDatasetKinds.get(scopedKey(endpoint, dataset.toLowerCase()))
}

/**
 * Fetch all datasets with expanded metadata and schema.
 * Uses ?expand[]=metadata&expand[]=schema to get chain kind, chain_id, display_name, and available tables.
 */
export async function getDatasets(endpoint: PortalEndpoint = getDefaultPortalEndpoint()): Promise<Dataset[]> {
  const cacheKey = scopedKey(endpoint, 'datasets')
  const cached = datasetsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  return dedupe(cacheKey, async () => {
    const data = await portalFetch<Dataset[]>(
      buildPortalUrl('/datasets?expand%5B%5D=metadata&expand%5B%5D=schema', endpoint),
      { endpoint },
    )
    rememberDatasetKinds(data, endpoint)
    datasetsCache.set(cacheKey, { data, timestamp: Date.now() })
    return data
  })
}

/**
 * Get the chain type for a resolved dataset name from its metadata.
 * Falls back to heuristic if metadata.kind is not available.
 */
export async function getChainType(dataset: string, endpoint: PortalEndpoint = getDefaultPortalEndpoint()): Promise<ChainType> {
  const datasets = await getDatasets(endpoint)
  const ds = datasets.find((d) => d.dataset === dataset || d.aliases.includes(dataset))
  if (ds?.metadata?.kind) {
    return ds.metadata.kind
  }

  const cachedKind = peekKnownChainType(dataset, endpoint)
  if (cachedKind) {
    return cachedKind
  }

  // Fallback heuristic for datasets without metadata
  const lower = dataset.toLowerCase()
  if (lower.includes('solana') || lower.includes('eclipse')) {
    return 'solana'
  }
  if (lower.includes('bitcoin')) {
    return 'bitcoin'
  }
  if (lower === 'hyperliquid-fills') {
    return 'hyperliquidFills'
  }
  if (lower === 'hyperliquid-replica-cmds') {
    return 'hyperliquidReplicaCmds'
  }
  if (
    lower.includes('substrate') ||
    [
      'acala',
      'aleph-zero',
      'asset-hub-kusama',
      'asset-hub-polkadot',
      'astar-substrate',
      'avail',
      'basilisk',
      'bifrost-kusama',
      'bifrost-polkadot',
      'bridge-hub-kusama',
      'bridge-hub-polkadot',
      'hydradx',
      'interlay',
      'karura',
      'kusama',
      'moonbeam-substrate',
      'moonriver-substrate',
      'people-chain',
      'polkadot',
      'rococo',
      'shibuya-substrate',
      'shiden-substrate',
      'vara',
      'westend',
    ].includes(lower)
  ) {
    return 'substrate'
  }
  return 'evm'
}

/**
 * Check if a dataset is an L2 chain.
 */
export function isL2Chain(dataset: string): boolean {
  const lower = dataset.toLowerCase()
  const l2Patterns = [
    'arbitrum', 'optimism', 'base', 'zksync', 'linea', 'scroll',
    'blast', 'mantle', 'mode', 'zora', 'polygon-zkevm', 'starknet',
    'taiko', 'manta', 'metis',
  ]
  return l2Patterns.some((pattern) => lower.includes(pattern))
}

/**
 * Get the available tables for a dataset from schema metadata.
 */
export async function getDatasetTables(dataset: string, endpoint: PortalEndpoint = getDefaultPortalEndpoint()): Promise<string[]> {
  const datasets = await getDatasets(endpoint)
  const ds = datasets.find((d) => d.dataset === dataset)
  if (ds?.schema?.tables) {
    return Object.keys(ds.schema.tables)
  }
  return []
}

// Common chain name aliases for fuzzy resolution
// Source: https://github.com/subsquid-labs/agent-skills/blob/main/portal/portal-dataset-discovery/references/full-chain-mapping.md
const CHAIN_ALIASES: Record<string, string[]> = {
  'ethereum-mainnet': ['ethereum', 'eth'],
  'arbitrum-one': ['arbitrum', 'arb'],
  'optimism-mainnet': ['optimism', 'op'],
  'base-mainnet': ['base'],
  'polygon-mainnet': ['polygon', 'matic'],
  'binance-mainnet': ['bsc', 'bnb', 'binance'],
  'avalanche-mainnet': ['avalanche', 'avax'],
  'gnosis-mainnet': ['gnosis', 'xdai'],
  'zksync-mainnet': ['zksync', 'zksync-era'],
  'blast-l2-mainnet': ['blast'],
  'scroll-mainnet': ['scroll'],
  'linea-mainnet': ['linea'],
  'mantle-mainnet': ['mantle'],
  'mode-mainnet': ['mode'],
  'taiko-mainnet': ['taiko'],
  'moonbeam-mainnet': ['moonbeam', 'glmr'],
  'moonriver-mainnet': ['moonriver', 'movr'],
  'fantom-mainnet': ['fantom', 'ftm'],
  'celo-mainnet': ['celo'],
  'worldchain-mainnet': ['worldchain', 'world'],
  'zora-mainnet': ['zora'],
  'hyperliquid-mainnet': ['hyperevm', 'hyperl', 'hyper'],
  'hyperliquid-fills': ['hl-fills', 'hlfills'],
  'hyperliquid-replica-cmds': ['hl-replica', 'hlreplica', 'hl-cmds'],
  'solana-mainnet': ['solana', 'sol'],
  'bitcoin-mainnet': ['bitcoin', 'btc'],
  polkadot: ['dot'],
  kusama: ['ksm'],
  'asset-hub-polkadot': ['asset-hub', 'assethub-polkadot', 'ah-polkadot'],
  'people-chain': ['people'],
  hydradx: ['hydra'],
  acala: ['aca'],
  'moonbeam-substrate': ['moonbeam-substrate', 'moonbeam substrate'],
  'moonriver-substrate': ['moonriver-substrate', 'moonriver substrate'],
  'astar-substrate': ['astar-substrate'],
  'shiden-substrate': ['shiden'],
  'shibuya-substrate': ['shibuya'],
  vara: ['gear', 'vara-network'],
  avail: ['data-avail'],
}

/**
 * Resolve a dataset name or alias to the canonical dataset name.
 */
export async function resolveDataset(dataset: string, endpoint: PortalEndpoint = getDefaultPortalEndpoint()): Promise<string> {
  const datasets = await getDatasets(endpoint)

  // Exact match
  const exactMatch = datasets.find((d) => d.dataset === dataset || d.aliases.includes(dataset))
  if (exactMatch) {
    return exactMatch.dataset
  }

  const lowerDataset = dataset.toLowerCase()

  // Check common aliases
  for (const [canonicalName, aliases] of Object.entries(CHAIN_ALIASES)) {
    const canonicalDataset = datasets.find((d) => d.dataset === canonicalName || d.aliases.includes(canonicalName))
    if (canonicalDataset && aliases.some((a) => a === lowerDataset || lowerDataset.includes(a) || a.includes(lowerDataset))) {
      return canonicalDataset.dataset
    }
  }

  // Try "{name}-mainnet"
  const mainnetMatch = datasets.find((d) => d.dataset === `${lowerDataset}-mainnet`)
  if (mainnetMatch) {
    return mainnetMatch.dataset
  }

  // Partial match, prefer mainnet
  const partialMatches = datasets.filter(
    (d) =>
      d.dataset.toLowerCase().startsWith(lowerDataset) ||
      d.dataset.toLowerCase().includes(`-${lowerDataset}-`) ||
      (lowerDataset.includes('-') && d.dataset.toLowerCase().includes(lowerDataset)),
  )

  if (partialMatches.length > 0) {
    const preferredMatch = partialMatches.find((d) => d.dataset.includes('-mainnet')) || partialMatches[0]
    return preferredMatch.dataset
  }

  throw createDatasetError(dataset, datasets.length)
}

export async function validateDataset(dataset: string, endpoint: PortalEndpoint = getDefaultPortalEndpoint()): Promise<void> {
  await resolveDataset(dataset, endpoint)
}

export async function getBlockHead(dataset: string, finalized = false, endpoint: PortalEndpoint = getDefaultPortalEndpoint()): Promise<BlockHead> {
  const cacheKey = scopedKey(endpoint, `${dataset}:${finalized ? 'finalized' : 'head'}`)
  const cached = headCache.get(cacheKey)

  if (cached) {
    return cached
  }

  return dedupe(cacheKey, async () => {
    const portalPath = finalized ? 'finalized-head' : 'head'
    const head = await portalFetch<BlockHead>(buildPortalUrl(`/datasets/${dataset}/${portalPath}`, endpoint), { endpoint })
    headCache.set(cacheKey, head)
    return head
  })
}

export async function getDatasetMetadata(
  dataset: string,
  endpoint: PortalEndpoint = getDefaultPortalEndpoint(),
): Promise<{
  start_block: number
  head: BlockHead
  finalized_head?: BlockHead
}> {
  const cacheKey = scopedKey(endpoint, `metadata:${dataset}`)
  const cached = metadataCache.get(cacheKey)
  if (cached) {
    return cached
  }

  return dedupe(cacheKey, async () => {
    const [metadata, head, finalizedHead] = await Promise.all([
      portalFetch<DatasetMetadata>(buildPortalUrl(`/datasets/${dataset}/metadata`, endpoint), { endpoint }),
      getBlockHead(dataset, false, endpoint),
      getBlockHead(dataset, true, endpoint).catch(() => undefined),
    ])

    const result = {
      start_block: metadata.start_block,
      head,
      finalized_head: finalizedHead,
    }

    metadataCache.set(cacheKey, result)
    return result
  })
}

export async function validateBlockRange(
  dataset: string,
  fromBlock: number,
  toBlock: number,
  finalizedOnly: boolean = false,
  endpoint: PortalEndpoint = getDefaultPortalEndpoint(),
): Promise<{ validatedToBlock: number; head: BlockHead }> {
  const meta = await getDatasetMetadata(dataset, endpoint)

  if (fromBlock < meta.start_block) {
    throw createBlockRangeError(
      fromBlock,
      toBlock,
      `fromBlock (${fromBlock.toLocaleString()}) is before dataset start block (${meta.start_block.toLocaleString()})`,
    )
  }

  const maxBlock = finalizedOnly && meta.finalized_head ? meta.finalized_head.number : meta.head.number

  if (fromBlock > maxBlock) {
    throw createBlockRangeError(
      fromBlock,
      toBlock,
      `fromBlock (${fromBlock.toLocaleString()}) is beyond ${finalizedOnly ? 'finalized' : 'latest'} block (${maxBlock.toLocaleString()})`,
    )
  }

  if (toBlock < fromBlock) {
    throw createBlockRangeError(fromBlock, toBlock, 'toBlock must be >= fromBlock')
  }

  const validatedToBlock = Math.min(toBlock, maxBlock)

  return {
    validatedToBlock,
    head: finalizedOnly && meta.finalized_head ? meta.finalized_head : meta.head,
  }
}
