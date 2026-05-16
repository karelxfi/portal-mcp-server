import { resolveDataset } from '../cache/datasets.js'
import { tokenListUnsupportedNetworksTotal } from '../metrics.js'
import { detectChainType } from './chain.js'
import { ActionableError } from './errors.js'
import {
  type CoinGeckoToken,
  type CoinGeckoTokenListResult,
  type DefiLlamaProtocol,
  getCoinGeckoTokenListWithStatus,
  getDefiLlamaProtocols,
} from './external-apis.js'
import { isValidEvmAddress, normalizeEvmAddress } from './validation.js'

export type TokenListSource = 'coingecko_token_list'
export type EntityResolverSource =
  | TokenListSource
  | 'built_in_contract_alias'
  | 'input_address'
  | 'defillama_protocols'
  | 'user_input_format'
  | 'user_input_normalized'
  | 'built_in_coin_alias'

export type TokenListLookupMetadata = Omit<CoinGeckoTokenListResult, 'tokens'>

export type ResolvedTokenEntity = {
  kind: 'token'
  network: string
  token_list_chain: string
  address: string
  symbol: string
  name: string
  decimals: number
  chain_id: number
  source: TokenListSource
}

export type ResolvedContractEntity = {
  kind: 'contract'
  network: string
  address: string
  alias?: string
  name?: string
  source: 'built_in_contract_alias' | 'input_address'
}

export type ResolvedProtocolEntity = {
  kind: 'protocol'
  name: string
  slug: string
  symbol?: string
  category?: string
  chains: string[]
  url?: string
  tvl_usd?: number
  source: 'defillama_protocols'
}

export type ResolvedPoolEntity = {
  kind: 'pool'
  network: string
  identifier: string
  identifier_type: 'evm_address' | 'evm_bytes32_pool_id'
  validation_status: 'format_only'
  source: 'user_input_format'
}

export type ResolvedHyperliquidCoinEntity = {
  kind: 'hyperliquid_coin'
  network: 'hyperliquid-fills'
  coin: string
  input: string
  validation_status: 'not_validated'
  source: 'user_input_normalized' | 'built_in_coin_alias'
}

export type ResolvedEntity =
  | ResolvedTokenEntity
  | ResolvedContractEntity
  | ResolvedProtocolEntity
  | ResolvedPoolEntity
  | ResolvedHyperliquidCoinEntity

export type TokenSymbolResolution = {
  symbol: string
  matches: ResolvedTokenEntity[]
  selected_addresses: string[]
  truncated: boolean
}

type ResolveTokenSymbolsOptions = {
  dataset: string
  symbols?: string[]
  maxMatchesPerSymbol?: number
}

const TOKEN_LIST_CHAIN_BY_DATASET: Record<string, string> = {
  'ethereum-mainnet': 'ethereum',
  'base-mainnet': 'base',
  'arbitrum-one': 'arbitrum',
  'optimism-mainnet': 'optimism',
  'polygon-mainnet': 'polygon',
  'avalanche-mainnet': 'avalanche',
  'binance-mainnet': 'bsc',
  'bsc-mainnet': 'bsc',
}

const KNOWN_CONTRACT_ALIASES: Record<string, Record<string, { address: string; name: string; aliases: string[] }>> = {
  'ethereum-mainnet': {
    bayc: {
      address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
      name: 'Bored Ape Yacht Club',
      aliases: ['bayc', 'bored_apes', 'bored_ape_yacht_club', 'boredapes'],
    },
    cryptopunks: {
      address: '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb',
      name: 'CryptoPunks',
      aliases: ['cryptopunks', 'crypto_punks', 'punks'],
    },
    mayc: {
      address: '0x60e4d786628fea6478f785a6d7e704777c86a7c6',
      name: 'Mutant Ape Yacht Club',
      aliases: ['mayc', 'mutant_ape_yacht_club'],
    },
  },
}

const HYPERLIQUID_COIN_ALIASES: Record<string, string[]> = {
  bitcoin: ['BTC'],
  btc: ['BTC'],
  ethereum: ['ETH'],
  ether: ['ETH'],
  eth: ['ETH'],
  solana: ['SOL'],
  sol: ['SOL'],
  dogecoin: ['DOGE'],
  doge: ['DOGE'],
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values))
}

export function normalizeEntityAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function asResolvedToken(dataset: string, tokenListChain: string, token: CoinGeckoToken): ResolvedTokenEntity {
  return {
    kind: 'token',
    network: dataset,
    token_list_chain: tokenListChain,
    address: token.address.toLowerCase(),
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    chain_id: token.chainId,
    source: 'coingecko_token_list',
  }
}

function lookupFromTokenListResult(result: CoinGeckoTokenListResult): TokenListLookupMetadata {
  return {
    source: result.source,
    chain: result.chain,
    cache_status: result.cache_status,
    fetched_at: result.fetched_at,
    age_ms: result.age_ms,
  }
}

export function buildTokenListLookupNotices(lookup?: TokenListLookupMetadata): string[] {
  if (!lookup || lookup.cache_status !== 'stale') return []
  const fetchedAt = new Date(lookup.fetched_at).toISOString()
  const ageMinutes = Math.max(1, Math.round(lookup.age_ms / 60_000))
  return [
    `Token-list data for ${lookup.chain} was served from stale cache because the upstream refresh failed; cached copy fetched at ${fetchedAt} (${ageMinutes}m old).`,
  ]
}

function recordUnsupportedTokenListNetwork(dataset: string) {
  tokenListUnsupportedNetworksTotal.inc({ dataset })
}

function filterTokensByQuery(tokens: CoinGeckoToken[], query: string) {
  const trimmed = query.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    const normalizedAddress = normalizeEvmAddress(trimmed)
    return tokens.filter((token) => token.address.toLowerCase() === normalizedAddress)
  }

  const normalizedSymbol = trimmed.toUpperCase()
  const exactSymbol = tokens.filter((token) => token.symbol.toUpperCase() === normalizedSymbol)
  if (exactSymbol.length > 0) return exactSymbol

  const normalizedName = trimmed.toLowerCase()
  return tokens.filter((token) => token.name.toLowerCase() === normalizedName)
}

export function getTokenListChainForDataset(dataset: string): string | undefined {
  if (TOKEN_LIST_CHAIN_BY_DATASET[dataset]) return TOKEN_LIST_CHAIN_BY_DATASET[dataset]

  const normalized = dataset.toLowerCase()
  if (normalized.startsWith('ethereum-')) return 'ethereum'
  if (normalized.startsWith('base-')) return 'base'
  if (normalized.startsWith('arbitrum-')) return 'arbitrum'
  if (normalized.startsWith('optimism-')) return 'optimism'
  if (normalized.startsWith('polygon-')) return 'polygon'
  if (normalized.startsWith('avalanche-')) return 'avalanche'
  if (normalized.startsWith('binance-') || normalized.startsWith('bsc-')) return 'bsc'
  return undefined
}

export async function getTokenListForDatasetWithStatus(
  dataset: string,
): Promise<{ tokens: ResolvedTokenEntity[]; lookup: TokenListLookupMetadata }> {
  if (detectChainType(dataset) !== 'evm') {
    recordUnsupportedTokenListNetwork(dataset)
    throw new ActionableError(`Token-list resolution is only supported for EVM datasets. Got ${dataset}.`, [
      'Use Solana, Bitcoin, Substrate, or Hyperliquid-specific tools for non-EVM assets.',
      'Call portal_list_networks if you are unsure which network name to use.',
    ])
  }

  const tokenListChain = getTokenListChainForDataset(dataset)
  if (!tokenListChain) {
    recordUnsupportedTokenListNetwork(dataset)
    throw new ActionableError(`No open token list is configured for ${dataset}.`, [
      'Use token_addresses directly for this network.',
      'Use portal_list_networks to check whether another network alias maps to a supported EVM mainnet.',
    ])
  }

  const result = await getCoinGeckoTokenListWithStatus(tokenListChain)
  return {
    tokens: result.tokens.map((token) => asResolvedToken(dataset, tokenListChain, token)),
    lookup: lookupFromTokenListResult(result),
  }
}

export async function getTokenListForDataset(dataset: string): Promise<ResolvedTokenEntity[]> {
  const result = await getTokenListForDatasetWithStatus(dataset)
  return result.tokens
}

export async function getTokenMetadataMapForDatasetWithStatus(
  dataset: string,
): Promise<{ metadata: Map<string, ResolvedTokenEntity>; lookup: TokenListLookupMetadata }> {
  const result = await getTokenListForDatasetWithStatus(dataset)
  return {
    metadata: new Map(result.tokens.map((token) => [token.address.toLowerCase(), token])),
    lookup: result.lookup,
  }
}

export async function getTokenMetadataMapForDataset(dataset: string): Promise<Map<string, ResolvedTokenEntity>> {
  const result = await getTokenMetadataMapForDatasetWithStatus(dataset)
  return result.metadata
}

export async function resolveTokenByAddressFromList(
  dataset: string,
  address: string,
): Promise<ResolvedTokenEntity | undefined> {
  const result = await resolveTokenByAddressFromListWithStatus(dataset, address)
  return result.match
}

export async function resolveTokenByAddressFromListWithStatus(
  dataset: string,
  address: string,
): Promise<{ match?: ResolvedTokenEntity; lookup?: TokenListLookupMetadata }> {
  const tokenListChain = getTokenListChainForDataset(dataset)
  if (!tokenListChain) {
    recordUnsupportedTokenListNetwork(dataset)
    return {}
  }

  const result = await getCoinGeckoTokenListWithStatus(tokenListChain)
  const normalizedAddress = normalizeEvmAddress(address)
  const token = result.tokens.find((entry) => entry.address.toLowerCase() === normalizedAddress)
  return {
    match: token ? asResolvedToken(dataset, tokenListChain, token) : undefined,
    lookup: lookupFromTokenListResult(result),
  }
}

export async function resolveTokenQueryFromList({
  network,
  query,
  limit = 10,
}: {
  network: string
  query: string
  limit?: number
}): Promise<{
  dataset: string
  query: string
  matches: ResolvedTokenEntity[]
  source: TokenListSource
  lookup: TokenListLookupMetadata
}> {
  const dataset = await resolveDataset(network)
  const tokenListChain = getTokenListChainForDataset(dataset)
  if (!tokenListChain) {
    recordUnsupportedTokenListNetwork(dataset)
    throw new ActionableError(`No open token list is configured for ${dataset}.`, [
      'Use token_addresses directly for this network.',
      'Try a supported EVM mainnet such as ethereum-mainnet, base-mainnet, arbitrum-one, optimism-mainnet, polygon-mainnet, avalanche-mainnet, or binance-mainnet.',
    ])
  }

  const trimmed = query.trim()
  if (!trimmed) {
    throw new ActionableError('Token query cannot be empty.', [
      'Pass a token symbol such as "USDC".',
      'Or pass a token contract address such as "0x...".',
    ])
  }

  const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 50)
  const result = await getCoinGeckoTokenListWithStatus(tokenListChain)
  const matches = filterTokensByQuery(result.tokens, trimmed)

  return {
    dataset,
    query: trimmed,
    matches: matches.slice(0, normalizedLimit).map((token) => asResolvedToken(dataset, tokenListChain, token)),
    source: 'coingecko_token_list',
    lookup: lookupFromTokenListResult(result),
  }
}

export async function resolveTokenSymbolsForQuery({
  dataset,
  symbols,
  maxMatchesPerSymbol = 5,
}: ResolveTokenSymbolsOptions): Promise<{
  addresses: string[]
  resolutions: TokenSymbolResolution[]
  unresolved_symbols: string[]
  lookup?: TokenListLookupMetadata
}> {
  const requestedSymbols = uniqueStrings((symbols ?? []).map((symbol) => symbol.trim()).filter(Boolean))
  if (requestedSymbols.length === 0) {
    return { addresses: [], resolutions: [], unresolved_symbols: [] }
  }

  const tokenListChain = getTokenListChainForDataset(dataset)
  if (!tokenListChain) {
    recordUnsupportedTokenListNetwork(dataset)
    throw new ActionableError(`No open token list is configured for ${dataset}.`, [
      'Use token_addresses directly for this network.',
      'Try a supported EVM mainnet such as ethereum-mainnet, base-mainnet, arbitrum-one, optimism-mainnet, polygon-mainnet, avalanche-mainnet, or binance-mainnet.',
    ])
  }

  const normalizedMaxMatches = Math.min(Math.max(Math.floor(maxMatchesPerSymbol), 1), 20)
  const resolutions: TokenSymbolResolution[] = []
  const unresolved_symbols: string[] = []
  const result = await getCoinGeckoTokenListWithStatus(tokenListChain)
  const lookup = lookupFromTokenListResult(result)

  for (const symbol of requestedSymbols) {
    const matches = filterTokensByQuery(result.tokens, symbol)
    const selected = matches
      .slice(0, normalizedMaxMatches)
      .map((token) => asResolvedToken(dataset, tokenListChain, token))
    if (selected.length === 0) {
      unresolved_symbols.push(symbol)
    }
    resolutions.push({
      symbol,
      matches: selected,
      selected_addresses: selected.map((token) => token.address),
      truncated: matches.length > selected.length,
    })
  }

  return {
    addresses: uniqueStrings(resolutions.flatMap((resolution) => resolution.selected_addresses)),
    resolutions,
    unresolved_symbols,
    lookup,
  }
}

export function getKnownContractAliases(dataset: string): ResolvedContractEntity[] {
  const aliases = KNOWN_CONTRACT_ALIASES[dataset] ?? {}
  return Object.values(aliases).map((entry) => ({
    kind: 'contract',
    network: dataset,
    address: entry.address,
    name: entry.name,
    alias: entry.aliases[0],
    source: 'built_in_contract_alias',
  }))
}

export function resolveKnownContractReference(dataset: string, input: string): ResolvedContractEntity {
  const trimmed = input.trim()
  const normalizedCandidate = normalizeEvmAddress(trimmed)
  if (isValidEvmAddress(normalizedCandidate)) {
    return {
      kind: 'contract',
      network: dataset,
      address: normalizedCandidate,
      source: 'input_address',
    }
  }

  const alias = normalizeEntityAlias(trimmed)
  const match = Object.values(KNOWN_CONTRACT_ALIASES[dataset] ?? {}).find((entry) => entry.aliases.includes(alias))
  if (match) {
    return {
      kind: 'contract',
      network: dataset,
      address: match.address,
      alias: trimmed,
      name: match.name,
      source: 'built_in_contract_alias',
    }
  }

  throw new ActionableError(
    `Unknown EVM contract reference: ${input}`,
    [
      'Pass a 20-byte EVM contract address when the contract is not in the small built-in alias list.',
      'For Ethereum BAYC/Bored Apes, use contract: "bored apes" or contract_address: "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d".',
      'If you only know a project name, resolve it to a contract address first, then retry this lookup.',
    ],
    {
      dataset,
      contract_reference: input,
    },
  )
}

export async function resolveContractQuery({
  network,
  query,
  limit = 10,
}: {
  network: string
  query: string
  limit?: number
}): Promise<{ dataset: string; query: string; matches: ResolvedContractEntity[]; source: EntityResolverSource }> {
  const dataset = await resolveDataset(network)
  if (detectChainType(dataset) !== 'evm') {
    throw new ActionableError(`Contract alias resolution is only supported for EVM datasets. Got ${dataset}.`, [
      'Use Solana program IDs, Bitcoin addresses, or Hyperliquid coin filters with their chain-specific tools.',
    ])
  }

  const trimmed = query.trim()
  if (!trimmed) {
    throw new ActionableError('Contract query cannot be empty.', [
      'Pass a contract address such as "0x...".',
      'Or pass a supported contract alias such as "bayc" on Ethereum.',
    ])
  }

  const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 50)
  const normalizedCandidate = normalizeEvmAddress(trimmed)
  if (isValidEvmAddress(normalizedCandidate)) {
    return {
      dataset,
      query: trimmed,
      matches: [
        {
          kind: 'contract',
          network: dataset,
          address: normalizedCandidate,
          source: 'input_address',
        },
      ],
      source: 'input_address',
    }
  }

  const alias = normalizeEntityAlias(trimmed)
  const matches = Object.values(KNOWN_CONTRACT_ALIASES[dataset] ?? {})
    .filter((entry) => entry.aliases.some((entryAlias) => entryAlias === alias || entryAlias.includes(alias)))
    .slice(0, normalizedLimit)
    .map((entry) => ({
      kind: 'contract' as const,
      network: dataset,
      address: entry.address,
      alias: trimmed,
      name: entry.name,
      source: 'built_in_contract_alias' as const,
    }))

  return {
    dataset,
    query: trimmed,
    matches,
    source: 'built_in_contract_alias',
  }
}

function protocolScore(protocol: DefiLlamaProtocol, query: string) {
  const normalized = query.toLowerCase()
  const name = protocol.name.toLowerCase()
  const slug = protocol.slug.toLowerCase()
  const symbol = protocol.symbol?.toLowerCase()
  if (slug === normalized || name === normalized || symbol === normalized) return 0
  if (slug.startsWith(normalized) || name.startsWith(normalized) || symbol?.startsWith(normalized)) return 1
  if (slug.includes(normalized) || name.includes(normalized) || symbol?.includes(normalized)) return 2
  return 99
}

export async function resolveProtocolQuery({
  query,
  limit = 10,
}: {
  query: string
  limit?: number
}): Promise<{ query: string; matches: ResolvedProtocolEntity[]; source: 'defillama_protocols' }> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new ActionableError('Protocol query cannot be empty.', [
      'Pass a protocol name or slug such as "uniswap", "aave", or "morpho".',
    ])
  }

  const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 50)
  const protocols = await getDefiLlamaProtocols()
  const matches = protocols
    .map((protocol) => ({ protocol, score: protocolScore(protocol, trimmed) }))
    .filter((entry) => entry.score < 99)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score
      return (right.protocol.tvl ?? 0) - (left.protocol.tvl ?? 0)
    })
    .slice(0, normalizedLimit)
    .map(({ protocol }) => ({
      kind: 'protocol' as const,
      name: protocol.name,
      slug: protocol.slug,
      symbol: protocol.symbol || undefined,
      category: protocol.category || undefined,
      chains: protocol.chains ?? [],
      url: protocol.url || undefined,
      tvl_usd: typeof protocol.tvl === 'number' ? protocol.tvl : undefined,
      source: 'defillama_protocols' as const,
    }))

  return {
    query: trimmed,
    matches,
    source: 'defillama_protocols',
  }
}

export async function resolvePoolQuery({
  network,
  query,
}: {
  network: string
  query: string
}): Promise<{ dataset: string; query: string; matches: ResolvedPoolEntity[]; source: 'user_input_format' }> {
  const dataset = await resolveDataset(network)
  if (detectChainType(dataset) !== 'evm') {
    throw new ActionableError(`Pool identifier resolution is only supported for EVM datasets. Got ${dataset}.`, [
      'Use Hyperliquid coin filters for Hyperliquid markets.',
      'Use raw Solana program or account filters for Solana DEX activity.',
    ])
  }

  const trimmed = query.trim()
  const lower = trimmed.toLowerCase()
  const match =
    /^0x[0-9a-f]{40}$/.test(lower)
      ? {
          kind: 'pool' as const,
          network: dataset,
          identifier: lower,
          identifier_type: 'evm_address' as const,
          validation_status: 'format_only' as const,
          source: 'user_input_format' as const,
        }
      : /^0x[0-9a-f]{64}$/.test(lower)
        ? {
            kind: 'pool' as const,
            network: dataset,
            identifier: lower,
            identifier_type: 'evm_bytes32_pool_id' as const,
            validation_status: 'format_only' as const,
            source: 'user_input_format' as const,
          }
        : undefined

  return {
    dataset,
    query: trimmed,
    matches: match ? [match] : [],
    source: 'user_input_format',
  }
}

export function resolveHyperliquidCoinQuery({
  query,
  limit = 10,
}: {
  query: string
  limit?: number
}): { query: string; matches: ResolvedHyperliquidCoinEntity[]; source: EntityResolverSource } {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new ActionableError('Hyperliquid coin query cannot be empty.', [
      'Pass a coin ticker such as "BTC" or a common coin name such as "bitcoin".',
    ])
  }

  const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 50)
  const aliasKey = normalizeEntityAlias(trimmed)
  const aliasMatches = HYPERLIQUID_COIN_ALIASES[aliasKey] ?? []
  const candidates = aliasMatches.length > 0 ? aliasMatches : [trimmed.toUpperCase().replace(/[^A-Z0-9_.-]/g, '')]
  const matches = uniqueStrings(candidates)
    .filter(Boolean)
    .slice(0, normalizedLimit)
    .map((coin) => ({
      kind: 'hyperliquid_coin' as const,
      network: 'hyperliquid-fills' as const,
      coin,
      input: trimmed,
      validation_status: 'not_validated' as const,
      source: aliasMatches.length > 0 ? ('built_in_coin_alias' as const) : ('user_input_normalized' as const),
    }))

  return {
    query: trimmed,
    matches,
    source: aliasMatches.length > 0 ? 'built_in_coin_alias' : 'user_input_normalized',
  }
}
