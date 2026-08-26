import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { getBlockHead, resolveDataset } from '../../cache/datasets.js'
import { createQueryCache, stableCacheKey } from '../../cache/query-cache.js'
import { EVENT_SIGNATURES, PORTAL_URL } from '../../constants/index.js'
import { detectChainType, isL2Chain } from '../../helpers/chain.js'
import { buildTableDescriptor } from '../../helpers/chart-metadata.js'
import {
  buildTokenListLookupNotices,
  getTokenMetadataMapForDatasetWithStatus,
} from '../../helpers/entity-resolution.js'
import { ActionableError, RequestCancelledError, createUnsupportedChainError, sanitizeText } from '../../helpers/errors.js'
import { portalFetchRecentRecords } from '../../helpers/fetch.js'
import { buildEvmLogFields } from '../../helpers/fields.js'
import { formatResult, humanizeLabel } from '../../helpers/format.js'
import { formatTimestamp, formatTokenAmount, formatTransactionFields, hexToBigInt } from '../../helpers/format.js'
import { normalizeEvmTransactionResult } from '../../helpers/normalized-results.js'
import { decodeCursor, encodeCursor, paginateAscendingItems } from '../../helpers/pagination.js'
import { buildWalletPipesRecipe } from '../../helpers/pipes-recipe.js'
import { resolveDefaultResponseFormat, type ResponseFormat } from '../../helpers/response-modes.js'
import { buildQueryFreshness, buildSectionCoverage } from '../../helpers/result-metadata.js'
import { describeTimeWindowInput, type TimestampInput, resolveTimeframeOrBlocks } from '../../helpers/timeframe.js'
import { buildExecutionMetadata, buildToolDescription } from '../../helpers/tool-ux.js'
import {
  buildMetricCard,
  buildPortalUi,
  buildStatListPanel,
  buildTablePanel,
  buildTimelinePanel,
} from '../../helpers/ui-metadata.js'
import { normalizeEvmAddress } from '../../helpers/validation.js'

// ============================================================================
// Tool: Get Wallet Summary (Convenience Wrapper)
// ============================================================================

/**
 * One-call wallet activity summary.
 * Combines multiple queries into a single comprehensive view:
 * - Recent transactions sent
 * - Recent transactions received
 * - Token transfers (ERC20)
 * - NFT transfers (ERC721/1155)
 */

type WalletBoundaryCursor = {
  page_to_block: number
  skip_inclusive_block: number
}

type WalletSummaryCursor = {
  tool: 'portal_get_wallet_summary'
  dataset: string
  address: string
  timeframe: string
  mode: 'fast' | 'deep'
  response_format: ResponseFormat
  include_tokens: boolean
  include_nfts: boolean
  limit_per_type: number
  window_from_block: number
  window_to_block: number
  sections: {
    transactions: WalletBoundaryCursor | null
    token_transfers?: WalletBoundaryCursor | null
    nft_transfers?: WalletBoundaryCursor | null
  }
}

type WalletSectionName = 'transactions' | 'token_transfers' | 'nft_transfers'

type WalletSectionPage<T> = {
  pageItems: T[]
  hasMore: boolean
  nextBoundary: WalletBoundaryCursor | null
  notices?: string[]
}

const WALLET_SECTION_CACHE_TTL_MS = 30_000
const WALLET_SECTION_CACHE_MAX_ENTRIES = 48

const walletSectionQueryCache = createQueryCache<unknown[]>({
  ttl: WALLET_SECTION_CACHE_TTL_MS,
  maxEntries: WALLET_SECTION_CACHE_MAX_ENTRIES,
})

type WalletTransactionItem = Record<string, unknown> & {
  block_number?: number
  transactionIndex?: number
  from?: string
}

type WalletLogItem = Record<string, unknown> & {
  block_number?: number
  log_index?: number
}

type WalletCounterpartyRow = {
  address: string
  activity_count: number
  sent_count: number
  received_count: number
  record_types: string[]
}

type WalletFlowMovement = {
  direction: 'in' | 'out'
  asset_type: 'native' | 'token' | 'btc' | 'fee' | 'hyperliquid_coin'
  asset: string
  amount: string
  amount_numeric?: number
  counterparty?: string
  tx_hash?: string
  block_number?: number
  timestamp?: number
  timestamp_human?: string
  record_type: string
}

type WalletAssetFlowRow = {
  asset_type: string
  asset: string
  asset_id?: string
  symbol?: string
  inbound_count: number
  outbound_count: number
  inbound_amount: string
  outbound_amount: string
  net_amount: string
  net_direction: 'in' | 'out' | 'flat'
}

type WalletFlowCounterpartyRow = {
  address: string
  activity_count: number
  inbound_count: number
  outbound_count: number
  native_received_eth?: number
  native_sent_eth?: number
  token_received_count?: number
  token_sent_count?: number
  record_types: string[]
}

function getBlockNumber(item: { block_number?: number }) {
  return typeof item.block_number === 'number' ? item.block_number : undefined
}

function getTransactionIndex(item: WalletTransactionItem): number {
  if (typeof item.transactionIndex === 'number') {
    return item.transactionIndex
  }
  if (typeof item.transactionIndex === 'string') {
    const parsed = Number(item.transactionIndex)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 0
}

function getLogIndex(item: WalletLogItem): number {
  if (typeof item.log_index === 'number') {
    return item.log_index
  }
  if (typeof item.log_index === 'string') {
    const parsed = Number(item.log_index)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 0
}

function sortTransactions(items: WalletTransactionItem[]) {
  return items.sort((left, right) => {
    const leftBlock = getBlockNumber(left) ?? 0
    const rightBlock = getBlockNumber(right) ?? 0
    if (leftBlock !== rightBlock) {
      return leftBlock - rightBlock
    }

    const leftIndex = getTransactionIndex(left)
    const rightIndex = getTransactionIndex(right)
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex
    }

    return String(left['hash'] ?? '').localeCompare(String(right['hash'] ?? ''))
  })
}

function sortLogs(items: WalletLogItem[]) {
  return items.sort((left, right) => {
    const leftBlock = getBlockNumber(left) ?? 0
    const rightBlock = getBlockNumber(right) ?? 0
    if (leftBlock !== rightBlock) {
      return leftBlock - rightBlock
    }

    const leftIndex = getLogIndex(left)
    const rightIndex = getLogIndex(right)
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex
    }

    return String(left['transaction_hash'] ?? '').localeCompare(String(right['transaction_hash'] ?? ''))
  })
}

function describeWalletWindow(timeframe: string) {
  if (timeframe.includes('->')) {
    return timeframe
  }
  return /^\d+$/.test(timeframe) ? `last ${timeframe} blocks` : describeTimeWindowInput(timeframe)
}

function createWalletSummaryCursor(params: Omit<WalletSummaryCursor, 'tool'>) {
  return encodeCursor({
    tool: 'portal_get_wallet_summary',
    ...params,
  })
}

function buildSectionPagination(returned: number, hasMore: boolean) {
  return {
    returned,
    has_more: hasMore,
  }
}

async function fetchCachedWalletSection(params: {
  dataset: string
  section: WalletSectionName
  query: Record<string, unknown>
  itemKeys: string[]
  limit: number
  chunkSize: number
  concurrency: number
  initialSequentialChunks: number
}) {
  const { dataset, section, query, itemKeys, limit, chunkSize, concurrency, initialSequentialChunks } = params
  const cacheKey = stableCacheKey('wallet-section', {
    dataset,
    section,
    query,
    itemKeys,
    limit,
    chunkSize,
    concurrency,
    initialSequentialChunks,
  })
  const { value } = await walletSectionQueryCache.getOrLoad(cacheKey, async () =>
    portalFetchRecentRecords(`${PORTAL_URL}/datasets/${dataset}/stream`, query, {
      itemKeys,
      limit,
      chunkSize,
      concurrency,
      initialSequentialChunks,
    }),
  )
  return value
}

function compactWalletTransactionItem(tx: WalletTransactionItem) {
  const txHash =
    typeof tx['hash'] === 'string'
      ? String(tx['hash'])
      : typeof tx['tx_hash'] === 'string'
        ? String(tx['tx_hash'])
        : undefined
  const timestamp = typeof tx['timestamp'] === 'number' ? Number(tx['timestamp']) : undefined

  return {
    chain_kind: 'evm',
    record_type: 'transaction',
    primary_id: txHash,
    tx_hash: txHash,
    sender: typeof tx['from'] === 'string' ? String(tx['from']) : undefined,
    recipient: typeof tx['to'] === 'string' ? String(tx['to']) : undefined,
    block_number: getBlockNumber(tx),
    transactionIndex: getTransactionIndex(tx),
    ...(timestamp !== undefined ? { timestamp, timestamp_human: formatTimestamp(timestamp) } : {}),
    ...(tx['value'] !== undefined ? { value: tx['value'] } : {}),
    ...(tx['nonce'] !== undefined ? { nonce: tx['nonce'] } : {}),
    ...(tx['status'] !== undefined ? { status: tx['status'] } : {}),
  }
}

function compactWalletTokenTransferItem(item: WalletLogItem) {
  const txHash = typeof item['transaction_hash'] === 'string' ? String(item['transaction_hash']) : undefined
  const logIndex = typeof item['log_index'] === 'number' ? Number(item['log_index']) : undefined
  const timestamp = typeof item['timestamp'] === 'number' ? Number(item['timestamp']) : undefined

  return {
    chain_kind: 'evm',
    record_type: 'token_transfer',
    primary_id: txHash && logIndex !== undefined ? `${txHash}:${logIndex}` : txHash,
    tx_hash: txHash,
    sender: typeof item['from'] === 'string' ? String(item['from']) : undefined,
    recipient: typeof item['to'] === 'string' ? String(item['to']) : undefined,
    block_number: getBlockNumber(item),
    ...(timestamp !== undefined ? { timestamp, timestamp_human: formatTimestamp(timestamp) } : {}),
    token_address: typeof item['token_address'] === 'string' ? String(item['token_address']) : undefined,
    token_name: typeof item['token_name'] === 'string' ? String(item['token_name']) : undefined,
    token_symbol: typeof item['token_symbol'] === 'string' ? String(item['token_symbol']) : undefined,
    token_decimals: typeof item['token_decimals'] === 'number' ? Number(item['token_decimals']) : undefined,
    value: item['value'],
    value_raw: item['value_raw'],
    value_decimal: item['value_decimal'],
    direction: item['direction'],
  }
}

function compactWalletNftTransferItem(item: WalletLogItem) {
  const txHash = typeof item['transaction_hash'] === 'string' ? String(item['transaction_hash']) : undefined
  const logIndex = typeof item['log_index'] === 'number' ? Number(item['log_index']) : undefined
  const timestamp = typeof item['timestamp'] === 'number' ? Number(item['timestamp']) : undefined

  return {
    chain_kind: 'evm',
    record_type: 'nft_transfer',
    primary_id: txHash && logIndex !== undefined ? `${txHash}:${logIndex}` : txHash,
    tx_hash: txHash,
    block_number: getBlockNumber(item),
    ...(timestamp !== undefined ? { timestamp, timestamp_human: formatTimestamp(timestamp) } : {}),
    contract_address: typeof item['contract_address'] === 'string' ? String(item['contract_address']) : undefined,
    token_id: item['token_id'],
  }
}

function buildWalletActivityTable(title: string, rowCount: number) {
  return buildTableDescriptor({
    id: 'activity',
    dataKey: 'activity.items',
    rowCount,
    title,
    subtitle: 'Normalized wallet activity rows across the selected window',
    keyField: 'primary_id',
    defaultSort: { key: 'timestamp', direction: 'asc' },
    dense: true,
    columns: [
      { key: 'timestamp_human', label: 'Time', kind: 'time', format: 'timestamp_human' },
      { key: 'record_type', label: 'Type', kind: 'dimension' },
      { key: 'primary_id', label: 'Primary id', kind: 'dimension' },
      { key: 'sender', label: 'Sender', kind: 'dimension', format: 'address' },
      { key: 'recipient', label: 'Recipient', kind: 'dimension', format: 'address' },
      { key: 'block_number', label: 'Block', kind: 'metric', format: 'integer', align: 'right' },
    ],
  })
}

function buildWalletAssetFlowsTable(rowCount: number) {
  return buildTableDescriptor({
    id: 'asset_flows',
    dataKey: 'fund_flow.asset_flows',
    rowCount,
    title: 'Asset flow',
    subtitle: 'Inbound, outbound, and net movement by asset in the selected wallet view',
    keyField: 'asset',
    defaultSort: { key: 'inbound_count', direction: 'desc' },
    dense: true,
    columns: [
      { key: 'asset', label: 'Asset', kind: 'dimension' },
      { key: 'inbound_count', label: 'Inbound events', kind: 'metric', format: 'integer', align: 'right' },
      { key: 'outbound_count', label: 'Outbound events', kind: 'metric', format: 'integer', align: 'right' },
      { key: 'inbound_amount', label: 'Inbound amount', kind: 'metric', align: 'right' },
      { key: 'outbound_amount', label: 'Outbound amount', kind: 'metric', align: 'right' },
      { key: 'net_amount', label: 'Net', kind: 'metric', align: 'right' },
      { key: 'net_direction', label: 'Net direction', kind: 'dimension' },
    ],
  })
}

function buildWalletFlowCounterpartiesTable(rowCount: number) {
  return buildTableDescriptor({
    id: 'flow_counterparties',
    dataKey: 'fund_flow.counterparties',
    rowCount,
    title: 'Flow counterparties',
    subtitle: 'Counterparties ranked by inbound and outbound wallet movement',
    keyField: 'address',
    defaultSort: { key: 'activity_count', direction: 'desc' },
    dense: true,
    columns: [
      { key: 'address', label: 'Counterparty', kind: 'dimension', format: 'address' },
      { key: 'activity_count', label: 'Events', kind: 'metric', format: 'integer', align: 'right' },
      { key: 'inbound_count', label: 'Inbound', kind: 'metric', format: 'integer', align: 'right' },
      { key: 'outbound_count', label: 'Outbound', kind: 'metric', format: 'integer', align: 'right' },
      { key: 'native_received_eth', label: 'Native received', kind: 'metric', format: 'decimal', align: 'right', unit: 'ETH' },
      { key: 'native_sent_eth', label: 'Native sent', kind: 'metric', format: 'decimal', align: 'right', unit: 'ETH' },
    ],
  })
}

function buildWalletLargestMovementsTable(rowCount: number) {
  return buildTableDescriptor({
    id: 'largest_movements',
    dataKey: 'fund_flow.largest_movements',
    rowCount,
    title: 'Largest movements',
    subtitle: 'Largest observed value movements from the wallet view',
    keyField: 'tx_hash',
    defaultSort: { key: 'amount_numeric', direction: 'desc' },
    dense: true,
    columns: [
      { key: 'timestamp_human', label: 'Time', kind: 'time', format: 'timestamp_human' },
      { key: 'direction', label: 'Direction', kind: 'dimension' },
      { key: 'asset', label: 'Asset', kind: 'dimension' },
      { key: 'amount', label: 'Amount', kind: 'metric', align: 'right' },
      { key: 'counterparty', label: 'Counterparty', kind: 'dimension', format: 'address' },
      { key: 'tx_hash', label: 'Tx hash', kind: 'dimension' },
    ],
  })
}

function buildBitcoinOutputsTable(title: string, rowCount: number) {
  return buildTableDescriptor({
    id: 'bitcoin_outputs',
    dataKey: 'bitcoin.recent_outputs',
    rowCount,
    title,
    subtitle: 'Recent outputs sent to the wallet address',
    keyField: 'primary_id',
    defaultSort: { key: 'timestamp', direction: 'desc' },
    dense: true,
    columns: [
      { key: 'timestamp_human', label: 'Time', kind: 'time', format: 'timestamp_human' },
      { key: 'tx_hash', label: 'Tx hash', kind: 'dimension' },
      { key: 'value', label: 'Value (sats)', kind: 'metric', format: 'integer', align: 'right' },
      { key: 'outputIndex', label: 'Output index', kind: 'dimension' },
    ],
  })
}

function buildBitcoinInputsTable(title: string, rowCount: number) {
  return buildTableDescriptor({
    id: 'bitcoin_inputs',
    dataKey: 'bitcoin.recent_inputs',
    rowCount,
    title,
    subtitle: 'Recent inputs spent by the wallet address',
    keyField: 'primary_id',
    defaultSort: { key: 'timestamp', direction: 'desc' },
    dense: true,
    columns: [
      { key: 'timestamp_human', label: 'Time', kind: 'time', format: 'timestamp_human' },
      { key: 'tx_hash', label: 'Tx hash', kind: 'dimension' },
      { key: 'prevoutValue', label: 'Value (sats)', kind: 'metric', format: 'integer', align: 'right' },
      { key: 'inputIndex', label: 'Input index', kind: 'dimension' },
    ],
  })
}

function buildTopCounterparties(
  items: Array<Record<string, unknown>>,
  walletAddress: string,
  limit: number = 5,
): WalletCounterpartyRow[] {
  const normalizedWallet = walletAddress.toLowerCase()
  const counterparties = new Map<
    string,
    { activityCount: number; sentCount: number; receivedCount: number; recordTypes: Set<string> }
  >()

  for (const item of items) {
    const sender = typeof item.sender === 'string' ? item.sender.toLowerCase() : undefined
    const recipient = typeof item.recipient === 'string' ? item.recipient.toLowerCase() : undefined
    const recordType = typeof item.record_type === 'string' ? item.record_type : undefined

    const seenInItem = new Set<string>()
    if (sender && sender !== normalizedWallet) {
      seenInItem.add(sender)
    }
    if (recipient && recipient !== normalizedWallet) {
      seenInItem.add(recipient)
    }

    for (const counterparty of seenInItem) {
      const existing = counterparties.get(counterparty) ?? {
        activityCount: 0,
        sentCount: 0,
        receivedCount: 0,
        recordTypes: new Set<string>(),
      }

      existing.activityCount += 1
      if (sender === normalizedWallet && recipient === counterparty) {
        existing.sentCount += 1
      }
      if (recipient === normalizedWallet && sender === counterparty) {
        existing.receivedCount += 1
      }
      if (recordType) {
        existing.recordTypes.add(recordType)
      }

      counterparties.set(counterparty, existing)
    }
  }

  return Array.from(counterparties.entries())
    .map(([address, value]) => ({
      address,
      activity_count: value.activityCount,
      sent_count: value.sentCount,
      received_count: value.receivedCount,
      record_types: Array.from(value.recordTypes).sort(),
    }))
    .sort((left, right) => {
      if (right.activity_count !== left.activity_count) {
        return right.activity_count - left.activity_count
      }
      if (right.sent_count !== left.sent_count) {
        return right.sent_count - left.sent_count
      }
      if (right.received_count !== left.received_count) {
        return right.received_count - left.received_count
      }
      return left.address.localeCompare(right.address)
    })
    .slice(0, limit)
}

export function parseNumericAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function parseBigIntAmount(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  return 0n
}

function formatDecimalAmount(value: bigint, decimals: number, symbol?: string): string {
  const sign = value < 0n ? '-' : ''
  const abs = value < 0n ? -value : value
  const divisor = 10n ** BigInt(Math.max(0, decimals))
  const whole = abs / divisor
  const fraction = abs % divisor
  const fractionText = fraction
    .toString()
    .padStart(Math.max(0, decimals), '0')
    .replace(/0+$/, '')
    .slice(0, 6)
  const amount = fractionText ? `${sign}${whole}.${fractionText}` : `${sign}${whole}`
  return symbol ? `${amount} ${symbol}` : amount
}

function addCounterpartyFlow(
  counterparties: Map<string, {
    inboundCount: number
    outboundCount: number
    nativeReceivedEth: number
    nativeSentEth: number
    tokenReceivedCount: number
    tokenSentCount: number
    recordTypes: Set<string>
  }>,
  address: string | undefined,
  direction: 'in' | 'out',
  recordType: string,
  opts?: { nativeEth?: number; tokenEvent?: boolean },
) {
  if (!address) return
  const normalized = address.toLowerCase()
  const existing = counterparties.get(normalized) ?? {
    inboundCount: 0,
    outboundCount: 0,
    nativeReceivedEth: 0,
    nativeSentEth: 0,
    tokenReceivedCount: 0,
    tokenSentCount: 0,
    recordTypes: new Set<string>(),
  }

  if (direction === 'in') {
    existing.inboundCount += 1
    existing.nativeReceivedEth += opts?.nativeEth ?? 0
    if (opts?.tokenEvent) existing.tokenReceivedCount += 1
  } else {
    existing.outboundCount += 1
    existing.nativeSentEth += opts?.nativeEth ?? 0
    if (opts?.tokenEvent) existing.tokenSentCount += 1
  }
  existing.recordTypes.add(recordType)
  counterparties.set(normalized, existing)
}

function buildFlowCounterpartyRows(
  counterparties: Map<string, {
    inboundCount: number
    outboundCount: number
    nativeReceivedEth: number
    nativeSentEth: number
    tokenReceivedCount: number
    tokenSentCount: number
    recordTypes: Set<string>
  }>,
  limit = 10,
): WalletFlowCounterpartyRow[] {
  return Array.from(counterparties.entries())
    .map(([address, value]) => ({
      address,
      activity_count: value.inboundCount + value.outboundCount,
      inbound_count: value.inboundCount,
      outbound_count: value.outboundCount,
      native_received_eth: Number(value.nativeReceivedEth.toFixed(8)),
      native_sent_eth: Number(value.nativeSentEth.toFixed(8)),
      token_received_count: value.tokenReceivedCount,
      token_sent_count: value.tokenSentCount,
      record_types: Array.from(value.recordTypes).sort(),
    }))
    .sort((left, right) => {
      if (right.activity_count !== left.activity_count) return right.activity_count - left.activity_count
      if (right.outbound_count !== left.outbound_count) return right.outbound_count - left.outbound_count
      return left.address.localeCompare(right.address)
    })
    .slice(0, limit)
}

function buildEvmFundFlow(params: {
  walletAddress: string
  transactions: WalletTransactionItem[]
  tokenTransfers: WalletLogItem[]
}) {
  const wallet = params.walletAddress.toLowerCase()
  let nativeReceivedEth = 0
  let nativeSentEth = 0
  let nativeInboundCount = 0
  let nativeOutboundCount = 0
  let inboundEvents = 0
  let outboundEvents = 0
  const counterparties = new Map<string, {
    inboundCount: number
    outboundCount: number
    nativeReceivedEth: number
    nativeSentEth: number
    tokenReceivedCount: number
    tokenSentCount: number
    recordTypes: Set<string>
  }>()
  const tokenAssets = new Map<string, {
    assetId: string
    symbol?: string
    decimals: number
    inbound: bigint
    outbound: bigint
    inboundCount: number
    outboundCount: number
  }>()
  const movements: WalletFlowMovement[] = []

  for (const tx of params.transactions) {
    const sender = typeof tx.from === 'string' ? tx.from.toLowerCase() : undefined
    const recipient = typeof tx.to === 'string' ? tx.to.toLowerCase() : undefined
    const valueEth = parseNumericAmount(tx.value_eth)
    if (valueEth <= 0) continue

    const direction = sender === wallet ? 'out' : recipient === wallet ? 'in' : undefined
    if (!direction) continue
    const counterparty = direction === 'out' ? recipient : sender
    if (direction === 'in') {
      nativeReceivedEth += valueEth
      nativeInboundCount += 1
      inboundEvents += 1
    } else {
      nativeSentEth += valueEth
      nativeOutboundCount += 1
      outboundEvents += 1
    }
    addCounterpartyFlow(counterparties, counterparty, direction, 'transaction', { nativeEth: valueEth })
    movements.push({
      direction,
      asset_type: 'native',
      asset: 'ETH',
      amount: `${valueEth.toFixed(valueEth >= 1 ? 4 : 8).replace(/0+$/, '').replace(/\.$/, '')} ETH`,
      amount_numeric: valueEth,
      counterparty,
      tx_hash: typeof tx.hash === 'string' ? tx.hash : typeof tx.tx_hash === 'string' ? tx.tx_hash : undefined,
      block_number: getBlockNumber(tx),
      timestamp: typeof tx.timestamp === 'number' ? tx.timestamp : undefined,
      timestamp_human: typeof tx.timestamp === 'number' ? formatTimestamp(tx.timestamp) : undefined,
      record_type: 'transaction',
    })
  }

  for (const transfer of params.tokenTransfers) {
    const sender = typeof transfer.from === 'string' ? transfer.from.toLowerCase() : undefined
    const recipient = typeof transfer.to === 'string' ? transfer.to.toLowerCase() : undefined
    const direction = transfer.direction === 'out' || sender === wallet
      ? 'out'
      : transfer.direction === 'in' || recipient === wallet
        ? 'in'
        : undefined
    if (!direction) continue

    const tokenAddress = typeof transfer.token_address === 'string' ? transfer.token_address.toLowerCase() : 'unknown-token'
    const symbol = typeof transfer.token_symbol === 'string' ? transfer.token_symbol : undefined
    const decimals = typeof transfer.token_decimals === 'number' ? transfer.token_decimals : 18
    const amountRaw = parseBigIntAmount(transfer.value_decimal)
    const asset = tokenAssets.get(tokenAddress) ?? {
      assetId: tokenAddress,
      symbol,
      decimals,
      inbound: 0n,
      outbound: 0n,
      inboundCount: 0,
      outboundCount: 0,
    }
    if (direction === 'in') {
      asset.inbound += amountRaw
      asset.inboundCount += 1
      inboundEvents += 1
    } else {
      asset.outbound += amountRaw
      asset.outboundCount += 1
      outboundEvents += 1
    }
    tokenAssets.set(tokenAddress, asset)

    const counterparty = direction === 'out' ? recipient : sender
    addCounterpartyFlow(counterparties, counterparty, direction, 'token_transfer', { tokenEvent: true })
    movements.push({
      direction,
      asset_type: 'token',
      asset: symbol ?? tokenAddress,
      amount: formatDecimalAmount(amountRaw, decimals, symbol),
      amount_numeric: Number(amountRaw) / 10 ** Math.min(decimals, 18),
      counterparty,
      tx_hash: typeof transfer.transaction_hash === 'string' ? transfer.transaction_hash : undefined,
      block_number: getBlockNumber(transfer),
      timestamp: typeof transfer.timestamp === 'number' ? transfer.timestamp : undefined,
      timestamp_human: typeof transfer.timestamp === 'number' ? formatTimestamp(transfer.timestamp) : undefined,
      record_type: 'token_transfer',
    })
  }

  const assetFlows: WalletAssetFlowRow[] = [
    ...(nativeReceivedEth > 0 || nativeSentEth > 0
      ? [{
          asset_type: 'native',
          asset: 'ETH',
          symbol: 'ETH',
          inbound_count: nativeInboundCount,
          outbound_count: nativeOutboundCount,
          inbound_amount: `${Number(nativeReceivedEth.toFixed(8))} ETH`,
          outbound_amount: `${Number(nativeSentEth.toFixed(8))} ETH`,
          net_amount: `${Number((nativeReceivedEth - nativeSentEth).toFixed(8))} ETH`,
          net_direction: nativeReceivedEth > nativeSentEth ? 'in' as const : nativeSentEth > nativeReceivedEth ? 'out' as const : 'flat' as const,
        }]
      : []),
    ...Array.from(tokenAssets.values()).map((asset) => {
      const net = asset.inbound - asset.outbound
      return {
        asset_type: 'token',
        asset: asset.symbol ?? asset.assetId,
        asset_id: asset.assetId,
        symbol: asset.symbol,
        inbound_count: asset.inboundCount,
        outbound_count: asset.outboundCount,
        inbound_amount: formatDecimalAmount(asset.inbound, asset.decimals, asset.symbol),
        outbound_amount: formatDecimalAmount(asset.outbound, asset.decimals, asset.symbol),
        net_amount: formatDecimalAmount(net, asset.decimals, asset.symbol),
        net_direction: net > 0n ? 'in' as const : net < 0n ? 'out' as const : 'flat' as const,
      }
    }),
  ].sort((left, right) => (right.inbound_count + right.outbound_count) - (left.inbound_count + left.outbound_count))

  const sortedMovements = movements
    .filter((movement) => (movement.amount_numeric ?? 0) > 0)
    .sort((left, right) => (right.amount_numeric ?? 0) - (left.amount_numeric ?? 0))
    .slice(0, 10)

  const flowCounterparties = buildFlowCounterpartyRows(counterparties, 10)
  const topCounterparty = flowCounterparties[0]

  return {
    summary: {
      inbound_events: inboundEvents,
      outbound_events: outboundEvents,
      native_received_eth: Number(nativeReceivedEth.toFixed(8)),
      native_sent_eth: Number(nativeSentEth.toFixed(8)),
      native_net_eth: Number((nativeReceivedEth - nativeSentEth).toFixed(8)),
      asset_count: assetFlows.length,
      top_counterparty: topCounterparty?.address,
      largest_movement: sortedMovements[0],
    },
    asset_flows: assetFlows,
    counterparties: flowCounterparties,
    largest_movements: sortedMovements,
    next_pivots: [
      ...(topCounterparty
        ? [{
            goal: 'Investigate the top counterparty',
            tool: 'portal_get_wallet_summary',
            network_field: 'overview.network',
            address: topCounterparty.address,
          }]
        : []),
      ...(sortedMovements[0]?.tx_hash
        ? [{
            goal: 'Inspect the largest movement transaction',
            tool: 'portal_evm_query_transactions',
            transaction_hash: sortedMovements[0].tx_hash,
          }]
        : []),
    ],
  }
}

function buildSimpleAssetFlow(params: {
  assetType: WalletAssetFlowRow['asset_type']
  asset: string
  inboundCount: number
  outboundCount: number
  inboundAmount: string
  outboundAmount: string
  netAmount: string
  netDirection: WalletAssetFlowRow['net_direction']
}): WalletAssetFlowRow {
  return {
    asset_type: params.assetType,
    asset: params.asset,
    inbound_count: params.inboundCount,
    outbound_count: params.outboundCount,
    inbound_amount: params.inboundAmount,
    outbound_amount: params.outboundAmount,
    net_amount: params.netAmount,
    net_direction: params.netDirection,
  }
}

function applyWalletSummaryResponseFormat<T extends Record<string, unknown>>(summary: T, responseFormat: ResponseFormat): T {
  const activity = summary.activity && typeof summary.activity === 'object' && !Array.isArray(summary.activity)
    ? summary.activity as Record<string, unknown>
    : undefined
  const fundFlow = summary.fund_flow && typeof summary.fund_flow === 'object' && !Array.isArray(summary.fund_flow)
    ? summary.fund_flow as Record<string, unknown>
    : undefined

  if (responseFormat === 'compact') {
    const activityItems = Array.isArray(activity?.items) ? activity.items : undefined
    const compactActivityItems = activityItems && activityItems.length > 10 ? activityItems.slice(-10) : activityItems
    const relationships = summary.relationships && typeof summary.relationships === 'object' && !Array.isArray(summary.relationships)
      ? summary.relationships as Record<string, unknown>
      : undefined

    return {
      ...summary,
      ...(activity
        ? {
            activity: {
              ...activity,
              ...(compactActivityItems
                ? {
                    items: compactActivityItems,
                    ...(activityItems && activityItems.length > compactActivityItems.length
                      ? {
                          items_sampled: true,
                          item_sample_size: compactActivityItems.length,
                          total_returned_items: activityItems.length,
                        }
                      : {}),
                  }
                : {}),
            },
          }
        : {}),
      ...(relationships
        ? {
            relationships: {
              ...relationships,
              top_counterparties: Array.isArray(relationships.top_counterparties)
                ? relationships.top_counterparties.slice(0, 5)
                : relationships.top_counterparties,
            },
          }
        : {}),
      ...(fundFlow
        ? {
            fund_flow: {
              ...fundFlow,
              asset_flows: Array.isArray(fundFlow.asset_flows) ? fundFlow.asset_flows.slice(0, 5) : fundFlow.asset_flows,
              counterparties: Array.isArray(fundFlow.counterparties) ? fundFlow.counterparties.slice(0, 5) : fundFlow.counterparties,
              largest_movements: Array.isArray(fundFlow.largest_movements) ? fundFlow.largest_movements.slice(0, 5) : fundFlow.largest_movements,
            },
          }
        : {}),
    }
  }

  if (responseFormat !== 'summary') return summary

  return {
    ...summary,
    ...(activity ? { activity: { count: activity.count } } : {}),
    ...(fundFlow
      ? {
          fund_flow: {
            ...fundFlow,
            asset_flows: Array.isArray(fundFlow.asset_flows) ? fundFlow.asset_flows.slice(0, 5) : fundFlow.asset_flows,
            counterparties: Array.isArray(fundFlow.counterparties) ? fundFlow.counterparties.slice(0, 5) : fundFlow.counterparties,
            largest_movements: Array.isArray(fundFlow.largest_movements) ? fundFlow.largest_movements.slice(0, 5) : fundFlow.largest_movements,
          },
        }
      : {}),
  }
}

function buildWalletUi(params: {
  title: string
  subtitle: string
  activityCountPath?: string
  primaryValuePath?: string
  primaryLabel?: string
  primaryFormat?: 'integer' | 'decimal' | 'currency_usd' | 'btc'
  primaryUnit?: string
  secondaryCards?: Array<ReturnType<typeof buildMetricCard>>
  panels?: Array<
    ReturnType<typeof buildTablePanel> | ReturnType<typeof buildTimelinePanel> | ReturnType<typeof buildStatListPanel>
  >
  followUpActions?: Array<{ label: string; intent: 'continue' | 'show_raw' | 'drilldown'; target?: string }>
}) {
  return buildPortalUi({
    version: 'portal_ui_v1',
    layout: 'dashboard',
    density: 'compact',
    design_intent: 'activity_investigator',
    headline: {
      title: params.title,
      subtitle: params.subtitle,
    },
    metric_cards: [
      ...(params.activityCountPath
        ? [
            buildMetricCard({
              id: 'activity-count',
              label: 'Activity',
              value_path: params.activityCountPath,
              format: 'integer',
              emphasis: 'primary',
            }),
          ]
        : []),
      ...(params.primaryValuePath
        ? [
            buildMetricCard({
              id: 'primary-value',
              label: params.primaryLabel ?? 'Primary',
              value_path: params.primaryValuePath,
              ...(params.primaryFormat ? { format: params.primaryFormat } : {}),
              ...(params.primaryUnit ? { unit: params.primaryUnit } : {}),
            }),
          ]
        : []),
      ...(params.secondaryCards ?? []),
    ],
    panels: params.panels ?? [
      buildTimelinePanel({
        id: 'wallet-timeline',
        kind: 'timeline_panel',
        title: 'Activity timeline',
        subtitle: 'Chronological wallet activity with timestamps and normalized labels.',
        data_key: 'activity.items',
        timestamp_key: 'timestamp_human',
        title_key: 'primary_id',
        subtitle_keys: ['record_type', 'sender', 'recipient'],
        badge_key: 'record_type',
        emphasis: 'primary',
      }),
      buildTablePanel({
        id: 'wallet-table',
        kind: 'table_panel',
        title: 'Activity table',
        subtitle: 'Exact normalized rows for the selected wallet window.',
        table_id: 'activity',
      }),
    ],
    follow_up_actions: params.followUpActions,
  })
}

function buildWalletLlmOverrides(vm: 'evm' | 'solana' | 'bitcoin' | 'hyperliquid') {
  const answerSequenceByVm: Record<typeof vm, string[]> = {
    evm: [
      'overview',
      'fund_flow.summary',
      'fund_flow.asset_flows',
      'fund_flow.counterparties',
      'activity.count',
      'evm.transactions.count',
      'relationships.top_counterparties',
      'assets.token_transfers',
      'assets.nft_transfers',
      'activity.items',
    ],
    solana: [
      'overview',
      'fund_flow.summary',
      'activity.count',
      'solana.fee_summary.total_fees_lamports',
      'solana.fee_summary.avg_fee_lamports',
      'activity.items',
    ],
    bitcoin: [
      'overview',
      'fund_flow.summary',
      'fund_flow.asset_flows',
      'activity.count',
      'assets.total_btc_received_sats',
      'assets.total_btc_spent_sats',
      'bitcoin.outputs_count',
      'bitcoin.inputs_count',
      'activity.items',
    ],
    hyperliquid: [
      'overview',
      'fund_flow.summary',
      'activity.count',
      'hyperliquid.fee_summary.total_fees',
      'assets.volume_by_coin',
      'activity.items',
    ],
  }

  const parserNotesByVm: Record<typeof vm, string[]> = {
    evm: [
      'Start with fund_flow.summary and fund_flow.asset_flows, then mention activity.count, counterparties, and EVM transaction/token counts.',
      'activity.items is the normalized cross-chain wallet feed; fund_flow.next_pivots and fund_flow.counterparties contain the most useful EVM drill-downs.',
    ],
    solana: [
      'Start with overview and activity.count, then mention the fee summary before drilling into activity.items.',
      'activity.items is the normalized transaction feed; solana.fee_summary is the VM-specific wallet section.',
    ],
    bitcoin: [
      'Start with overview and activity.count, then mention BTC received and spent totals plus input and output counts.',
      'activity.items mixes normalized inputs and outputs; bitcoin contains the UTXO-style wallet breakdown.',
    ],
    hyperliquid: [
      'Start with overview and activity.count, then mention fee_summary and volume_by_coin before listing individual fills.',
      'activity.items is the normalized fill feed; assets.volume_by_coin is the best section for what this wallet traded.',
    ],
  }

  return {
    answer_sequence: answerSequenceByVm[vm],
    parser_notes: [
      ...parserNotesByVm[vm],
      'If _pagination.has_more is true, treat the wallet response as a preview page rather than a complete lifetime history.',
    ],
  }
}

export function registerGetWalletSummaryTool(server: McpServer) {
  const FAST_MODE_BLOCK_CAP = 3000

  server.tool(
    'portal_get_wallet_summary',
    buildToolDescription('portal_get_wallet_summary'),
    {
      network: z.string().optional().describe('Network name or alias. Optional when continuing with cursor.'),
      address: z.string().optional().describe('Wallet address to analyze. Optional when continuing with cursor.'),
      timeframe: z
        .string()
        .optional()
        .default('1000')
        .describe("Look-back period as timeframe or block count. Examples: '1h', '24h', '7d', '3d', '1000'."),
      from_timestamp: z
        .union([z.string(), z.number()])
        .optional()
        .describe('Starting timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input like "1h ago".'),
      to_timestamp: z
        .union([z.string(), z.number()])
        .optional()
        .describe('Ending timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input like "now".'),
      include_tokens: z.boolean().optional().default(true).describe('Include ERC20 token transfers'),
      include_nfts: z.boolean().optional().default(false).describe('Include NFT transfers (ERC721/1155)'),
      limit_per_type: z.number().optional().default(10).describe('Max items per category (txs, tokens, nfts)'),
      mode: z
        .enum(['fast', 'deep'])
        .optional()
        .default('deep')
        .describe('Execution depth. Defaults to complete requested-window analysis; the optional fast value is only for explicitly bounded previews.'),
      response_format: z
        .enum(['full', 'compact', 'summary'])
        .optional()
        .describe("Response format: defaults to 'compact' for a readable wallet investigation. Use 'summary' for headline flow only or 'full' for all returned activity rows."),
      cursor: z.string().optional().describe('Continuation cursor from a previous response'),
    },
    async ({
      network,
      address,
      timeframe,
      from_timestamp,
      to_timestamp,
      include_tokens,
      include_nfts,
      limit_per_type,
      mode,
      response_format,
      cursor,
    }) => {
      const queryStartTime = Date.now()
      const paginationCursor = cursor
        ? decodeCursor<WalletSummaryCursor>(cursor, 'portal_get_wallet_summary')
        : undefined
      const requestedDataset = network ? await resolveDataset(network) : undefined
      let dataset = paginationCursor?.dataset ?? requestedDataset
      if (!dataset) {
        throw new ActionableError('network is required unless you are continuing with cursor.', [
          'Provide network for a fresh wallet summary.',
          'Reuse _pagination.next_cursor from a previous response to continue paging.',
        ])
      }
      const chainType = detectChainType(dataset)
      const networkLabel = humanizeLabel(dataset) ?? dataset

      if (chainType === 'substrate') {
        throw createUnsupportedChainError({
          toolName: 'portal_get_wallet_summary',
          dataset,
          actualChainType: chainType,
          supportedChains: ['evm', 'solana', 'bitcoin', 'hyperliquidFills'],
          suggestions: [
            'Use portal_debug_query_blocks plus a Substrate-specific event or call query for now.',
            'Add a dedicated Substrate wallet summary once address and account filters are productized for Substrate networks.',
          ],
        })
      }

      if (chainType !== 'evm') {
        return await buildNonEvmWalletSummary({
          dataset,
          chainType,
          address,
          timeframe,
          from_timestamp,
          to_timestamp,
          mode,
          limit_per_type,
          response_format,
          queryStartTime,
        })
      }

      const requestedAddress = address ? normalizeEvmAddress(address) : undefined
      const normalizedAddress = paginationCursor?.address ?? requestedAddress
      if (!normalizedAddress) {
        throw new ActionableError('address is required unless you are continuing with cursor.', [
          'Provide address for a fresh wallet summary.',
          'Reuse _pagination.next_cursor from a previous response to continue paging.',
        ])
      }

      if (paginationCursor && requestedDataset && paginationCursor.dataset !== requestedDataset) {
        throw new ActionableError(
          'This cursor belongs to a different network.',
          [
            'Reuse the cursor with the same network and wallet address.',
            'Omit cursor to start a fresh wallet summary.',
          ],
          {
            cursor_dataset: paginationCursor.dataset,
            requested_dataset: requestedDataset,
          },
        )
      }
      if (paginationCursor && requestedAddress && paginationCursor.address !== requestedAddress) {
        throw new ActionableError(
          'This cursor belongs to a different wallet address.',
          [
            'Reuse the cursor with the same wallet address as the previous response.',
            'Omit cursor to start a fresh wallet summary.',
          ],
          {
            cursor_address: paginationCursor.address,
            requested_address: requestedAddress,
          },
        )
      }

      if (paginationCursor) {
        timeframe = paginationCursor.timeframe
        mode = paginationCursor.mode
        include_tokens = paginationCursor.include_tokens
        include_nfts = paginationCursor.include_nfts
        limit_per_type = paginationCursor.limit_per_type
        response_format = paginationCursor.response_format
      }

      const effectiveResponseFormat = resolveDefaultResponseFormat(response_format as ResponseFormat | undefined)

      const pipesRecipe = buildWalletPipesRecipe({
        network: dataset,
        address: normalizedAddress,
        timeframe,
        mode,
        include_tokens,
        include_nfts,
      })

      // Resolve block range — numeric values are exact block counts,
      // time-based values use Portal's /timestamps/ API
      let fromBlock: number
      let windowToBlock: number
      let head = paginationCursor ? await getBlockHead(dataset) : undefined
      let resolvedWindow:
        | { range_kind: string; from_lookup?: never; to_lookup?: never }
        | Awaited<ReturnType<typeof resolveTimeframeOrBlocks>>
      let windowDescription = timeframe

      if (paginationCursor) {
        fromBlock = paginationCursor.window_from_block
        windowToBlock = paginationCursor.window_to_block
        windowDescription = paginationCursor.timeframe
        resolvedWindow = {
          range_kind: /^\d+$/.test(timeframe) ? 'block_range' : 'timeframe',
        }
      } else {
        const isBlockCount = /^\d+$/.test(timeframe)
        if (isBlockCount && from_timestamp === undefined && to_timestamp === undefined) {
          head = await getBlockHead(dataset)
          const blockRange = parseInt(timeframe, 10)
          windowToBlock = head.number
          fromBlock = Math.max(0, windowToBlock - blockRange)
          resolvedWindow = {
            range_kind: 'block_range',
          }
        } else {
          const resolved = await resolveTimeframeOrBlocks({
            dataset,
            ...(from_timestamp !== undefined || to_timestamp !== undefined
              ? {
                  from_timestamp: from_timestamp as TimestampInput | undefined,
                  to_timestamp: to_timestamp as TimestampInput | undefined,
                }
              : { timeframe }),
          })
          fromBlock = resolved.from_block
          windowToBlock = resolved.to_block
          resolvedWindow = resolved
          head = await getBlockHead(dataset)
          if (from_timestamp !== undefined || to_timestamp !== undefined) {
            const fromLabel =
              resolved.from_lookup?.normalized_input ??
              (from_timestamp !== undefined ? String(from_timestamp) : 'start')
            const toLabel =
              resolved.to_lookup?.normalized_input ?? (to_timestamp !== undefined ? String(to_timestamp) : 'now')
            windowDescription = `${fromLabel} -> ${toLabel}`
          }
        }
      }

      const requestedFromBlock = fromBlock
      if (!paginationCursor && mode === 'fast') {
        const requestedRange = windowToBlock - fromBlock + 1
        if (requestedRange > FAST_MODE_BLOCK_CAP) {
          fromBlock = Math.max(fromBlock, windowToBlock - FAST_MODE_BLOCK_CAP + 1)
        }
      }

      const includeL2 = isL2Chain(dataset)
      const sectionCursors = paginationCursor?.sections ?? {
        transactions: undefined,
        token_transfers: include_tokens ? undefined : null,
        nft_transfers: include_nfts ? undefined : null,
      }

      // Query 1: Transactions
      // Use minimal transaction fields for summary (avoid context bloat)
      const txFields: Record<string, boolean> = {
        transactionIndex: true,
        hash: true,
        from: true,
        to: true,
        value: true,
        nonce: true,
        gas: true,
        gasPrice: true,
        gasUsed: true,
        effectiveGasPrice: true,
        type: true,
        status: true,
        sighash: true,
        contractAddress: true,
      }

      if (includeL2) {
        txFields.l1Fee = true
        txFields.l1GasUsed = true
      }

      const paddedAddress = '0x' + normalizedAddress.slice(2).padStart(64, '0')

      const fetchTransactionsSection = async (): Promise<WalletSectionPage<WalletTransactionItem>> => {
        if (sectionCursors.transactions === null) {
          return {
            pageItems: [],
            hasMore: false,
            nextBoundary: null,
          }
        }

        const txCursor = sectionCursors.transactions ?? undefined
        const txQuery = {
          type: 'evm',
          fromBlock,
          toBlock: txCursor?.page_to_block ?? windowToBlock,
          fields: {
            block: { number: true, timestamp: true },
            transaction: txFields,
          },
          transactions: [{ from: [normalizedAddress] }, { to: [normalizedAddress] }],
        }

        const txFetchLimit = limit_per_type + (txCursor?.skip_inclusive_block ?? 0) + 1
        const txResults = await fetchCachedWalletSection({
          dataset,
          section: 'transactions',
          query: txQuery,
          itemKeys: ['transactions'],
          limit: txFetchLimit,
          chunkSize: 1_000,
          concurrency: 6,
          initialSequentialChunks: 1,
        })

        const pagedTransactions = paginateAscendingItems(
          sortTransactions(
            txResults.flatMap((block: unknown) => {
              const typedBlock = block as {
                number?: number
                timestamp?: number
                header?: { number?: number; timestamp?: number }
                transactions?: Array<Record<string, unknown>>
              }
              const blockNumber = typedBlock.number ?? typedBlock.header?.number
              const timestamp = typedBlock.timestamp ?? typedBlock.header?.timestamp

              return (typedBlock.transactions || []).map(
                (tx) =>
                  normalizeEvmTransactionResult(
                    formatTransactionFields({
                      ...tx,
                      ...(blockNumber !== undefined ? { block_number: blockNumber } : {}),
                      ...(timestamp !== undefined
                        ? {
                            timestamp,
                            timestamp_human: formatTimestamp(timestamp),
                          }
                        : {}),
                    }),
                  ) as WalletTransactionItem,
              )
            }),
          ),
          limit_per_type,
          getBlockNumber,
          txCursor,
        )

        return {
          pageItems: pagedTransactions.pageItems,
          hasMore: pagedTransactions.hasMore,
          nextBoundary: pagedTransactions.hasMore ? (pagedTransactions.nextBoundary ?? null) : null,
        }
      }

      const fetchTokenTransfersSection = async (): Promise<WalletSectionPage<WalletLogItem>> => {
        if (!include_tokens || sectionCursors.token_transfers === null) {
          return {
            pageItems: [],
            hasMore: false,
            nextBoundary: null,
          }
        }

        const tokenCursor = sectionCursors.token_transfers ?? undefined
        const tokenQuery = {
          type: 'evm',
          fromBlock,
          toBlock: tokenCursor?.page_to_block ?? windowToBlock,
          fields: {
            block: { number: true, timestamp: true },
            log: buildEvmLogFields(),
          },
          logs: [
            {
              topic0: [EVENT_SIGNATURES.TRANSFER_ERC20],
              topic1: [paddedAddress],
            },
            {
              topic0: [EVENT_SIGNATURES.TRANSFER_ERC20],
              topic2: [paddedAddress],
            },
          ],
        }

        const tokenFetchLimit = limit_per_type + (tokenCursor?.skip_inclusive_block ?? 0) + 1
        const tokenResults = await fetchCachedWalletSection({
          dataset,
          section: 'token_transfers',
          query: tokenQuery,
          itemKeys: ['logs'],
          limit: tokenFetchLimit,
          chunkSize: 1_000,
          concurrency: 6,
          initialSequentialChunks: 1,
        })

        let tokenMetadataByAddress = new Map<string, { symbol?: string; name?: string; decimals?: number }>()
        const tokenMetadataNotices: string[] = []
        try {
          const tokenMetadataResult = await getTokenMetadataMapForDatasetWithStatus(dataset)
          tokenMetadataByAddress = tokenMetadataResult.metadata
          tokenMetadataNotices.push(...buildTokenListLookupNotices(tokenMetadataResult.lookup))
        } catch (error) {
          if (error instanceof RequestCancelledError) throw error
          console.error('Failed to fetch token-list metadata:', error)
          tokenMetadataNotices.push(
            'Token-list metadata enrichment failed; token transfer values use 18 decimals unless a known token match was already cached.',
          )
        }

        const pagedTokens = paginateAscendingItems(
          sortLogs(
            tokenResults.flatMap((block: unknown) => {
              const typedBlock = block as {
                header?: { number: number; timestamp: number }
                logs?: Array<{
                  transactionHash: string
                  logIndex: number
                  address: string
                  topics?: string[]
                  data: string
                }>
              }

              return (typedBlock.logs || []).map((log) => {
                const tokenAddress = log.address.toLowerCase()
                const rawValue = log.data
                const tokenInfo = tokenMetadataByAddress.get(tokenAddress)
                const decimals = tokenInfo?.decimals ?? 18
                const formattedValue = formatTokenAmount(rawValue, decimals, tokenInfo?.symbol)

                return {
                  block_number: typedBlock.header?.number,
                  timestamp: typedBlock.header?.timestamp,
                  timestamp_human: typedBlock.header?.timestamp
                    ? formatTimestamp(typedBlock.header.timestamp)
                    : undefined,
                  transaction_hash: log.transactionHash,
                  log_index: log.logIndex,
                  token_address: tokenAddress,
                  token_name: tokenInfo?.name,
                  token_symbol: tokenInfo?.symbol,
                  token_decimals: decimals,
                  from: '0x' + (log.topics?.[1]?.slice(-40) || ''),
                  to: '0x' + (log.topics?.[2]?.slice(-40) || ''),
                  value_raw: rawValue,
                  value: formattedValue,
                  value_decimal: hexToBigInt(rawValue).toString(),
                  direction: '0x' + (log.topics?.[1]?.slice(-40) || '') === normalizedAddress ? 'out' : 'in',
                } as WalletLogItem
              })
            }),
          ),
          limit_per_type,
          getBlockNumber,
          tokenCursor,
        )

        return {
          pageItems: pagedTokens.pageItems,
          hasMore: pagedTokens.hasMore,
          nextBoundary: pagedTokens.hasMore ? (pagedTokens.nextBoundary ?? null) : null,
          notices: tokenMetadataNotices,
        }
      }

      const fetchNftTransfersSection = async (): Promise<WalletSectionPage<WalletLogItem>> => {
        if (!include_nfts || sectionCursors.nft_transfers === null) {
          return {
            pageItems: [],
            hasMore: false,
            nextBoundary: null,
          }
        }

        const nftCursor = sectionCursors.nft_transfers ?? undefined
        const nftQuery = {
          type: 'evm',
          fromBlock,
          toBlock: nftCursor?.page_to_block ?? windowToBlock,
          fields: {
            block: { number: true, timestamp: true },
            log: buildEvmLogFields(),
          },
          logs: [
            {
              topic0: [
                EVENT_SIGNATURES.TRANSFER_ERC721,
                EVENT_SIGNATURES.TRANSFER_SINGLE,
                EVENT_SIGNATURES.TRANSFER_BATCH,
              ],
              topic1: [paddedAddress],
            },
            {
              topic0: [
                EVENT_SIGNATURES.TRANSFER_ERC721,
                EVENT_SIGNATURES.TRANSFER_SINGLE,
                EVENT_SIGNATURES.TRANSFER_BATCH,
              ],
              topic2: [paddedAddress],
            },
            {
              topic0: [EVENT_SIGNATURES.TRANSFER_SINGLE, EVENT_SIGNATURES.TRANSFER_BATCH],
              topic3: [paddedAddress],
            },
          ],
        }

        const nftFetchLimit = limit_per_type + (nftCursor?.skip_inclusive_block ?? 0) + 1
        const nftResults = await fetchCachedWalletSection({
          dataset,
          section: 'nft_transfers',
          query: nftQuery,
          itemKeys: ['logs'],
          limit: nftFetchLimit,
          chunkSize: 1_000,
          concurrency: 6,
          initialSequentialChunks: 1,
        })

        const pagedNfts = paginateAscendingItems(
          sortLogs(
            nftResults.flatMap((block: unknown) => {
              const typedBlock = block as {
                header?: { number: number; timestamp: number }
                logs?: Array<{
                  transactionHash: string
                  logIndex: number
                  address: string
                  topics?: string[]
                  data: string
                }>
              }

              return (typedBlock.logs || []).map(
                (log) =>
                  ({
                    block_number: typedBlock.header?.number,
                    timestamp: typedBlock.header?.timestamp,
                    transaction_hash: log.transactionHash,
                    log_index: log.logIndex,
                    contract_address: log.address,
                    token_id: log.topics?.[3],
                    data: log.data,
                  }) as WalletLogItem,
              )
            }),
          ),
          limit_per_type,
          getBlockNumber,
          nftCursor,
        )

        return {
          pageItems: pagedNfts.pageItems,
          hasMore: pagedNfts.hasMore,
          nextBoundary: pagedNfts.hasMore ? (pagedNfts.nextBoundary ?? null) : null,
        }
      }

      const [transactionOutcome, tokenOutcome, nftOutcome] = await Promise.allSettled([
        fetchTransactionsSection(),
        fetchTokenTransfersSection(),
        fetchNftTransfersSection(),
      ])

      const activeSectionOutcomes = [
        { key: 'transactions', label: 'transactions', enabled: sectionCursors.transactions !== null, outcome: transactionOutcome },
        { key: 'token_transfers', label: 'token transfers', enabled: include_tokens && sectionCursors.token_transfers !== null, outcome: tokenOutcome },
        { key: 'nft_transfers', label: 'NFT transfers', enabled: include_nfts && sectionCursors.nft_transfers !== null, outcome: nftOutcome },
      ] as const
      const cancelledSection = activeSectionOutcomes.find(
        (section) => section.outcome.status === 'rejected' && section.outcome.reason instanceof RequestCancelledError,
      )
      if (cancelledSection?.outcome.status === 'rejected') throw cancelledSection.outcome.reason

      const failedActiveSections = activeSectionOutcomes.filter(
        (section) => section.enabled && section.outcome.status === 'rejected',
      )
      const enabledSectionCount = activeSectionOutcomes.filter((section) => section.enabled).length
      if (failedActiveSections.length === enabledSectionCount && failedActiveSections[0]?.outcome.status === 'rejected') {
        throw failedActiveSections[0].outcome.reason
      }

      const sectionFailures: Array<{ key: string; label: string; message: string }> = []
      const resolveSection = <T>(
        key: string,
        label: string,
        outcome: PromiseSettledResult<WalletSectionPage<T>>,
      ): WalletSectionPage<T> => {
        if (outcome.status === 'fulfilled') return outcome.value
        const message = sanitizeText(outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason))
        sectionFailures.push({ key, label, message: message.slice(0, 180) })
        return {
          pageItems: [],
          hasMore: false,
          nextBoundary: null,
          notices: [`The ${label} section was unavailable for this response: ${message.slice(0, 180)}`],
        }
      }

      const transactionSection = resolveSection('transactions', 'transactions', transactionOutcome)
      const tokenSection = resolveSection('token_transfers', 'token transfers', tokenOutcome)
      const nftSection = resolveSection('nft_transfers', 'NFT transfers', nftOutcome)

      const transactions = transactionSection.pageItems
      const txHasMore = transactionSection.hasMore
      const txNextBoundary = transactionSection.nextBoundary

      const tokenTransfers = tokenSection.pageItems
      const tokenHasMore = tokenSection.hasMore
      const tokenNextBoundary = tokenSection.nextBoundary

      const nftTransfers = nftSection.pageItems
      const nftHasMore = nftSection.hasMore
      const nftNextBoundary = nftSection.nextBoundary

      const hasMore = txHasMore || tokenHasMore || nftHasMore
      const nextCursor = hasMore
        ? createWalletSummaryCursor({
            dataset,
            address: normalizedAddress,
            timeframe: windowDescription,
            mode,
            response_format: effectiveResponseFormat,
            include_tokens,
            include_nfts,
            limit_per_type,
            window_from_block: fromBlock,
            window_to_block: windowToBlock,
            sections: {
              transactions: txNextBoundary,
              ...(include_tokens ? { token_transfers: tokenNextBoundary } : {}),
              ...(include_nfts ? { nft_transfers: nftNextBoundary } : {}),
            },
          })
        : undefined

      const notices: string[] = []
      notices.push(...(transactionSection.notices ?? []))
      notices.push(...(tokenSection.notices ?? []))
      notices.push(...(nftSection.notices ?? []))
      if (hasMore) {
        const limitedItems = []
        if (txHasMore) limitedItems.push('transactions')
        if (tokenHasMore) limitedItems.push('token transfers')
        if (nftHasMore) limitedItems.push('NFT transfers')
        notices.push(
          `Showing the latest ${limit_per_type} ${limitedItems.join(', ')} in this page. Call the same tool again with _pagination.next_cursor to load older wallet activity.`,
        )
      }
      if (!paginationCursor && mode === 'fast' && fromBlock > requestedFromBlock) {
        notices.push(
          `Analyzed the most recent ${FAST_MODE_BLOCK_CAP.toLocaleString()} blocks in the requested wallet window because the caller requested a bounded preview.`,
        )
      }

      const compactTransactions = transactions.map(compactWalletTransactionItem)
      const compactTokenTransfers = tokenTransfers.map(compactWalletTokenTransferItem)
      const compactNftTransfers = nftTransfers.map(compactWalletNftTransferItem)
      const combinedActivity = [...compactTransactions, ...compactTokenTransfers, ...compactNftTransfers].sort(
        (left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0),
      )
      const topCounterparties = buildTopCounterparties(combinedActivity, normalizedAddress)
      const fundFlow = buildEvmFundFlow({
        walletAddress: normalizedAddress,
        transactions,
        tokenTransfers,
      })
      const tables = [
        buildWalletActivityTable('Wallet activity', combinedActivity.length),
        ...(fundFlow.asset_flows.length > 0 ? [buildWalletAssetFlowsTable(fundFlow.asset_flows.length)] : []),
        ...(fundFlow.counterparties.length > 0
          ? [buildWalletFlowCounterpartiesTable(fundFlow.counterparties.length)]
          : []),
        ...(fundFlow.largest_movements.length > 0
          ? [buildWalletLargestMovementsTable(fundFlow.largest_movements.length)]
          : []),
      ]
      const panels = [
        buildTimelinePanel({
          id: 'wallet-timeline',
          kind: 'timeline_panel',
          title: 'Activity timeline',
          subtitle: 'Chronological wallet activity with timestamps and normalized labels.',
          data_key: 'activity.items',
          timestamp_key: 'timestamp_human',
          title_key: 'primary_id',
          subtitle_keys: ['record_type', 'sender', 'recipient'],
          badge_key: 'record_type',
          emphasis: 'primary',
        }),
        buildTablePanel({
          id: 'wallet-table',
          kind: 'table_panel',
          title: 'Activity table',
          subtitle: 'Exact normalized rows for the selected wallet window.',
          table_id: 'activity',
        }),
        ...(fundFlow.asset_flows.length > 0
          ? [
              buildTablePanel({
                id: 'wallet-asset-flow',
                kind: 'table_panel',
                title: 'Asset flow',
                subtitle: 'Inbound, outbound, and net observed movement by asset.',
                table_id: 'asset_flows',
              }),
            ]
          : []),
      ]

      const summary: Record<string, unknown> = {
        overview: {
          network: dataset,
          vm: 'evm',
          address: normalizedAddress,
          from_block: requestedFromBlock,
          to_block: windowToBlock,
          analyzed_from_block: fromBlock,
          description: windowDescription,
          preview: hasMore,
          partial: sectionFailures.length > 0,
        },
        section_status: {
          transactions: sectionFailures.some((failure) => failure.key === 'transactions') ? 'unavailable' : 'available',
          token_transfers: !include_tokens
            ? 'omitted'
            : sectionFailures.some((failure) => failure.key === 'token_transfers')
              ? 'unavailable'
              : 'available',
          nft_transfers: !include_nfts
            ? 'omitted'
            : sectionFailures.some((failure) => failure.key === 'nft_transfers')
              ? 'unavailable'
              : 'available',
        },
        activity: {
          count: combinedActivity.length,
          items: combinedActivity,
        },
        fund_flow: fundFlow,
        relationships: {
          top_counterparties: topCounterparties,
        },
        assets: {
          token_transfers: include_tokens ? compactTokenTransfers.length : 0,
          nft_transfers: include_nfts ? compactNftTransfers.length : 0,
        },
        evm: {
          transactions: {
            count: compactTransactions.length,
            sent: transactions.filter((tx) => String(tx.from || '').toLowerCase() === normalizedAddress).length,
            received: transactions.filter((tx) => String(tx.from || '').toLowerCase() !== normalizedAddress).length,
          },
          token_transfers: include_tokens
            ? {
                count: compactTokenTransfers.length,
              }
            : null,
          nft_transfers: include_nfts
            ? {
                count: compactNftTransfers.length,
              }
            : null,
        },
        tables,
      }

      const topFlowCounterparty = fundFlow.summary.top_counterparty
        ? ` Top counterparty: ${fundFlow.summary.top_counterparty}.`
        : ''
      const partialPrefix = sectionFailures.length > 0
        ? `Partial wallet summary; ${sectionFailures.map((failure) => failure.label).join(', ')} unavailable. `
        : ''
      const message = hasMore
        ? `${partialPrefix}Wallet flow for ${normalizedAddress}: ${fundFlow.summary.inbound_events} inbound and ${fundFlow.summary.outbound_events} outbound movement events from ${describeWalletWindow(windowDescription)} (preview page capped at ${limit_per_type}; continue with cursor for older rows).${topFlowCounterparty}`
        : `${partialPrefix}Wallet flow for ${normalizedAddress}: ${fundFlow.summary.inbound_events} inbound and ${fundFlow.summary.outbound_events} outbound movement events from ${describeWalletWindow(windowDescription)}.${topFlowCounterparty}`

      return formatResult(applyWalletSummaryResponseFormat(summary, effectiveResponseFormat), message, {
        toolName: 'portal_get_wallet_summary',
        notices,
        pagination: {
          type: 'cursor',
          page_size: limit_per_type,
          returned: transactions.length + tokenTransfers.length + nftTransfers.length,
          has_more: hasMore,
          ...(nextCursor ? { next_cursor: nextCursor } : {}),
          sections: {
            transactions: buildSectionPagination(transactions.length, txHasMore),
            ...(include_tokens ? { token_transfers: buildSectionPagination(tokenTransfers.length, tokenHasMore) } : {}),
            ...(include_nfts ? { nft_transfers: buildSectionPagination(nftTransfers.length, nftHasMore) } : {}),
          },
        },
        freshness: buildQueryFreshness({
          finality: 'latest',
          headBlockNumber: head?.number ?? windowToBlock,
          windowToBlock,
          resolvedWindow,
        }),
        coverage: buildSectionCoverage({
          windowFromBlock: requestedFromBlock,
          windowToBlock,
          hasMore,
          windowComplete: fromBlock <= requestedFromBlock && sectionFailures.length === 0,
          sections: {
            transactions: buildSectionPagination(transactions.length, txHasMore),
            ...(include_tokens ? { token_transfers: buildSectionPagination(tokenTransfers.length, tokenHasMore) } : {}),
            ...(include_nfts ? { nft_transfers: buildSectionPagination(nftTransfers.length, nftHasMore) } : {}),
          },
        }),
        execution: buildExecutionMetadata({
          mode,
          response_format: effectiveResponseFormat,
          result_scope: hasMore
            ? 'preview_page'
            : fromBlock > requestedFromBlock || sectionFailures.length > 0
              ? 'partial_window'
              : 'complete_window',
          requested_blocks: Math.max(0, windowToBlock - requestedFromBlock + 1),
          analyzed_blocks: Math.max(0, windowToBlock - fromBlock + 1),
          estimated_scan_blocks: Math.max(0, windowToBlock - fromBlock + 1),
          estimated_runtime_class:
            windowToBlock - fromBlock + 1 <= 3_000
              ? 'interactive'
              : windowToBlock - fromBlock + 1 <= 50_000
                ? 'long_window'
                : 'expensive',
          recommended_window: 'Use timeframe="6h" for a smaller interactive triage window, or continue with the cursor for older rows.',
          from_block: fromBlock,
          to_block: windowToBlock,
          range_kind: resolvedWindow.range_kind,
          limit: limit_per_type,
          notes: [
            include_tokens ? 'Token-transfer section included.' : 'Token-transfer section omitted.',
            include_nfts ? 'NFT section included.' : 'NFT section omitted.',
            ...sectionFailures.map((failure) => `${failure.label} unavailable: ${failure.message}`),
          ],
        }),
        pipes: pipesRecipe,
        ui: buildWalletUi({
          title: `Wallet summary: ${normalizedAddress}`,
          subtitle: `${describeWalletWindow(windowDescription)} on ${networkLabel}`,
          activityCountPath: 'activity.count',
          primaryValuePath: 'evm.transactions.count',
          primaryLabel: 'Transactions',
          primaryFormat: 'integer',
          secondaryCards: [
            buildMetricCard({
              id: 'counterparties',
              label: 'Counterparties',
              value_path: 'relationships.top_counterparties.length',
              format: 'integer',
            }),
            buildMetricCard({
              id: 'token-transfers',
              label: 'Token transfers',
              value_path: 'assets.token_transfers',
              format: 'integer',
            }),
            buildMetricCard({
              id: 'nft-transfers',
              label: 'NFT transfers',
              value_path: 'assets.nft_transfers',
              format: 'integer',
            }),
          ],
          panels,
          followUpActions: [
            ...(nextCursor
              ? [
                  {
                    label: 'Load older wallet activity',
                    intent: 'continue' as const,
                    target: '_pagination.next_cursor',
                  },
                ]
              : []),
            { label: 'Show raw activity rows', intent: 'show_raw', target: 'activity.items' },
          ],
        }),
        llm: buildWalletLlmOverrides('evm'),
        metadata: {
          network: dataset,
          dataset,
          from_block: fromBlock,
          to_block: windowToBlock,
          query_start_time: queryStartTime,
        },
      })
    },
  )
}

async function buildNonEvmWalletSummary(params: {
  dataset: string
  chainType: ReturnType<typeof detectChainType>
  address?: string
  timeframe: string
  from_timestamp?: string | number
  to_timestamp?: string | number
  mode: 'fast' | 'deep'
  limit_per_type: number
  response_format?: ResponseFormat
  queryStartTime: number
}) {
  const { dataset, chainType, address, timeframe, from_timestamp, to_timestamp, mode, limit_per_type, response_format, queryStartTime } =
    params
  const effectiveResponseFormat = resolveDefaultResponseFormat(response_format)
  const networkLabel = humanizeLabel(dataset) ?? dataset
  const pipesRecipe = buildWalletPipesRecipe({
    network: dataset,
    address: address ?? 'unknown-wallet',
    timeframe,
    mode,
  })
  if (!address) {
    throw new ActionableError('address is required for wallet summary.', [
      'Provide address for a fresh wallet summary.',
    ])
  }

  const head = await getBlockHead(dataset)
  const resolvedWindow =
    from_timestamp !== undefined || to_timestamp !== undefined || !/^\d+$/.test(timeframe)
      ? await resolveTimeframeOrBlocks({
          dataset,
          ...(from_timestamp !== undefined || to_timestamp !== undefined
            ? {
                from_timestamp: from_timestamp as TimestampInput | undefined,
                to_timestamp: to_timestamp as TimestampInput | undefined,
              }
            : { timeframe }),
        })
      : {
          from_block: Math.max(0, head.number - parseInt(timeframe, 10)),
          to_block: head.number,
          range_kind: 'block_range' as const,
        }

  const requestedFromBlock = resolvedWindow.from_block
  const toBlock = resolvedWindow.to_block
  let fromBlock = requestedFromBlock
  const notices = [
    'This non-EVM wallet summary currently returns a cross-chain overview rather than the richer EVM multi-section scan.',
  ]

  if (mode === 'fast') {
    const fastBlockCap =
      chainType === 'solana'
        ? 250
        : chainType === 'hyperliquidFills' || chainType === 'hyperliquidReplicaCmds'
          ? 2_000
          : undefined

    if (fastBlockCap !== undefined && toBlock - fromBlock + 1 > fastBlockCap) {
      fromBlock = Math.max(fromBlock, toBlock - fastBlockCap + 1)
      notices.push(
        `Analyzed the most recent ${fastBlockCap.toLocaleString()} blocks in the requested wallet window because the caller requested a bounded preview.`,
      )
    }
  }

  if (chainType === 'solana') {
    const txQuery = {
      type: 'solana',
      fromBlock,
      toBlock,
      fields: {
        block: { number: true, timestamp: true },
        transaction: {
          transactionIndex: true,
          signatures: true,
          fee: true,
          feePayer: true,
          err: true,
        },
      },
      transactions: [{ feePayer: [address] }],
    }

    const results = await portalFetchRecentRecords(`${PORTAL_URL}/datasets/${dataset}/stream`, txQuery, {
      itemKeys: ['transactions'],
      limit: limit_per_type,
      chunkSize: Math.max(25, Math.min(100, limit_per_type * 4)),
    })

    const items = results.flatMap((block: any) => {
      const blockNumber = block.number ?? block.header?.number
      const timestamp = block.timestamp ?? block.header?.timestamp
      return (block.transactions || []).map((tx: any) => ({
        ...tx,
        block_number: blockNumber,
        slot_number: blockNumber,
        timestamp,
        timestamp_human: timestamp ? formatTimestamp(timestamp) : undefined,
        primary_id: tx.signatures?.[0],
        tx_hash: tx.signatures?.[0],
        chain_kind: 'solana',
        record_type: 'transaction',
      }))
    })
    const totalFees = items.reduce((sum, item) => sum + Number(item.fee || 0), 0)
    const fundFlow = {
      summary: {
        inbound_events: 0,
        outbound_events: items.length,
        fee_outflow_lamports: totalFees,
        asset_count: 1,
        scope: 'Solana wallet flow currently covers fee-payer transactions and fee outflow for this address.',
      },
      asset_flows: [
        buildSimpleAssetFlow({
          assetType: 'fee',
          asset: 'SOL fees',
          inboundCount: 0,
          outboundCount: items.length,
          inboundAmount: '0 lamports',
          outboundAmount: `${totalFees} lamports`,
          netAmount: `-${totalFees} lamports`,
          netDirection: totalFees > 0 ? 'out' : 'flat',
        }),
      ],
      counterparties: [],
      largest_movements: items
        .map((item) => ({
          direction: 'out' as const,
          asset_type: 'fee' as const,
          asset: 'SOL fees',
          amount: `${Number(item.fee || 0)} lamports`,
          amount_numeric: Number(item.fee || 0),
          tx_hash: typeof item.tx_hash === 'string' ? item.tx_hash : undefined,
          block_number: getBlockNumber(item),
          timestamp: typeof item.timestamp === 'number' ? item.timestamp : undefined,
          timestamp_human: typeof item.timestamp_human === 'string' ? item.timestamp_human : undefined,
          record_type: 'transaction',
        }))
        .sort((left, right) => (right.amount_numeric ?? 0) - (left.amount_numeric ?? 0))
        .slice(0, 5),
      next_pivots: items[0]?.tx_hash
        ? [{ goal: 'Inspect a Solana transaction', tool: 'portal_solana_query_transactions', tx_hash: items[0].tx_hash }]
        : [],
    }

    return formatResult(
      applyWalletSummaryResponseFormat({
        overview: {
          network: dataset,
          vm: 'solana',
          address,
          from_block: requestedFromBlock,
          to_block: toBlock,
          analyzed_from_block: fromBlock,
          recent_activity_count: items.length,
        },
        activity: {
          count: items.length,
          items,
        },
        fund_flow: fundFlow,
        assets: {
          token_balance_changes: [],
        },
        solana: {
          fee_summary: {
            total_fees_lamports: totalFees,
            avg_fee_lamports: items.length > 0 ? totalFees / items.length : 0,
          },
        },
        tables: [
          buildWalletActivityTable('Wallet activity', items.length),
          buildWalletAssetFlowsTable(fundFlow.asset_flows.length),
          buildWalletLargestMovementsTable(fundFlow.largest_movements.length),
        ],
      }, effectiveResponseFormat),
      `Wallet flow for ${address} on ${networkLabel}: ${items.length} recent Solana transactions and ${totalFees} lamports in observed fees.`,
      {
        toolName: 'portal_get_wallet_summary',
        notices,
        pagination: buildSectionPagination(items.length, false),
        freshness: buildQueryFreshness({
          finality: 'latest',
          headBlockNumber: head.number,
          windowToBlock: toBlock,
          resolvedWindow,
        }),
        execution: buildExecutionMetadata({
          mode,
          response_format: effectiveResponseFormat,
          result_scope: fromBlock > requestedFromBlock ? 'partial_window' : 'complete_window',
          requested_blocks: Math.max(0, toBlock - requestedFromBlock + 1),
          analyzed_blocks: Math.max(0, toBlock - fromBlock + 1),
          estimated_scan_blocks: Math.max(0, toBlock - fromBlock + 1),
          estimated_runtime_class:
            toBlock - fromBlock + 1 <= 2_000 ? 'interactive' : toBlock - fromBlock + 1 <= 100_000 ? 'long_window' : 'expensive',
          recommended_window: 'Use timeframe="6h" for a smaller interactive Solana triage window.',
          from_block: fromBlock,
          to_block: toBlock,
          range_kind: resolvedWindow.range_kind,
          normalized_output: true,
        }),
        pipes: pipesRecipe,
        ui: buildWalletUi({
          title: `Wallet summary: ${address}`,
          subtitle: `${describeWalletWindow(timeframe)} on ${networkLabel}`,
          activityCountPath: 'activity.count',
          primaryValuePath: 'solana.fee_summary.total_fees_lamports',
          primaryLabel: 'Total fees',
          primaryFormat: 'decimal',
          secondaryCards: [
            buildMetricCard({
              id: 'avg-fee',
              label: 'Average fee',
              value_path: 'solana.fee_summary.avg_fee_lamports',
              format: 'decimal',
            }),
          ],
          followUpActions: [{ label: 'Show raw activity rows', intent: 'show_raw', target: 'activity.items' }],
        }),
        llm: buildWalletLlmOverrides('solana'),
        coverage: buildSectionCoverage({
          windowFromBlock: requestedFromBlock,
          windowToBlock: toBlock,
          hasMore: false,
          windowComplete: fromBlock <= requestedFromBlock,
          sections: {
            activity: buildSectionPagination(items.length, false),
          },
        }),
        metadata: {
          network: dataset,
          dataset,
          from_block: fromBlock,
          to_block: toBlock,
          query_start_time: queryStartTime,
        },
      },
    )
  }

  if (chainType === 'bitcoin') {
    const [outputBlocks, inputBlocks] = await Promise.all([
      portalFetchRecentRecords(
        `${PORTAL_URL}/datasets/${dataset}/stream`,
        {
          type: 'bitcoin',
          fromBlock,
          toBlock,
          fields: {
            block: { number: true, timestamp: true },
            output: { transactionIndex: true, outputIndex: true, value: true, scriptPubKeyAddress: true },
            transaction: { hash: true },
          },
          outputs: [{ scriptPubKeyAddress: [address], transaction: true }],
        },
        {
          itemKeys: ['outputs'],
          limit: limit_per_type,
          chunkSize: 20,
        },
      ),
      portalFetchRecentRecords(
        `${PORTAL_URL}/datasets/${dataset}/stream`,
        {
          type: 'bitcoin',
          fromBlock,
          toBlock,
          fields: {
            block: { number: true, timestamp: true },
            input: { transactionIndex: true, inputIndex: true, prevoutValue: true, prevoutScriptPubKeyAddress: true },
            transaction: { hash: true },
          },
          inputs: [{ prevoutScriptPubKeyAddress: [address], transaction: true }],
        },
        {
          itemKeys: ['inputs'],
          limit: limit_per_type,
          chunkSize: 20,
        },
      ),
    ])

    const outputs = outputBlocks.flatMap((block: any) =>
      (block.outputs || []).map((output: any) => ({
        ...output,
        block_number: block.number ?? block.header?.number,
        timestamp: block.timestamp ?? block.header?.timestamp,
        timestamp_human:
          (block.timestamp ?? block.header?.timestamp)
            ? formatTimestamp(block.timestamp ?? block.header?.timestamp)
            : undefined,
        chain_kind: 'bitcoin',
        record_type: 'output',
        primary_id:
          output.transaction?.hash && output.outputIndex !== undefined
            ? `${output.transaction.hash}:${output.outputIndex}`
            : output.transaction?.hash,
        tx_hash: output.transaction?.hash,
        recipient: output.scriptPubKeyAddress,
      })),
    )
    const inputs = inputBlocks.flatMap((block: any) =>
      (block.inputs || []).map((input: any) => ({
        ...input,
        block_number: block.number ?? block.header?.number,
        timestamp: block.timestamp ?? block.header?.timestamp,
        timestamp_human:
          (block.timestamp ?? block.header?.timestamp)
            ? formatTimestamp(block.timestamp ?? block.header?.timestamp)
            : undefined,
        chain_kind: 'bitcoin',
        record_type: 'input',
        primary_id:
          input.transaction?.hash && input.inputIndex !== undefined
            ? `${input.transaction.hash}:${input.inputIndex}`
            : input.transaction?.hash,
        tx_hash: input.transaction?.hash,
        sender: input.prevoutScriptPubKeyAddress,
      })),
    )
    const totalIn = outputs.reduce((sum, item) => sum + Number(item.value || 0), 0)
    const totalOut = inputs.reduce((sum, item) => sum + Number(item.prevoutValue || 0), 0)
    const netSats = totalIn - totalOut
    const bitcoinMovements: WalletFlowMovement[] = [
      ...outputs.map((item) => ({
        direction: 'in' as const,
        asset_type: 'btc' as const,
        asset: 'BTC',
        amount: `${Number(item.value || 0)} sats`,
        amount_numeric: Number(item.value || 0),
        counterparty: typeof item.sender === 'string' ? item.sender : undefined,
        tx_hash: typeof item.tx_hash === 'string' ? item.tx_hash : undefined,
        block_number: getBlockNumber(item),
        timestamp: typeof item.timestamp === 'number' ? item.timestamp : undefined,
        timestamp_human: typeof item.timestamp_human === 'string' ? item.timestamp_human : undefined,
        record_type: 'output',
      })),
      ...inputs.map((item) => ({
        direction: 'out' as const,
        asset_type: 'btc' as const,
        asset: 'BTC',
        amount: `${Number(item.prevoutValue || 0)} sats`,
        amount_numeric: Number(item.prevoutValue || 0),
        counterparty: typeof item.recipient === 'string' ? item.recipient : undefined,
        tx_hash: typeof item.tx_hash === 'string' ? item.tx_hash : undefined,
        block_number: getBlockNumber(item),
        timestamp: typeof item.timestamp === 'number' ? item.timestamp : undefined,
        timestamp_human: typeof item.timestamp_human === 'string' ? item.timestamp_human : undefined,
        record_type: 'input',
      })),
    ].sort((left, right) => (right.amount_numeric ?? 0) - (left.amount_numeric ?? 0))
    const fundFlow = {
      summary: {
        inbound_events: outputs.length,
        outbound_events: inputs.length,
        received_sats: totalIn,
        spent_sats: totalOut,
        net_sats: netSats,
        asset_count: 1,
      },
      asset_flows: [
        buildSimpleAssetFlow({
          assetType: 'btc',
          asset: 'BTC',
          inboundCount: outputs.length,
          outboundCount: inputs.length,
          inboundAmount: `${totalIn} sats`,
          outboundAmount: `${totalOut} sats`,
          netAmount: `${netSats} sats`,
          netDirection: netSats > 0 ? 'in' : netSats < 0 ? 'out' : 'flat',
        }),
      ],
      counterparties: [],
      largest_movements: bitcoinMovements.slice(0, 10),
      next_pivots: bitcoinMovements[0]?.tx_hash
        ? [{ goal: 'Inspect the largest Bitcoin movement', tool: 'portal_bitcoin_query_transactions', tx_hash: bitcoinMovements[0].tx_hash }]
        : [],
    }

    return formatResult(
      applyWalletSummaryResponseFormat({
        overview: {
          network: dataset,
          vm: 'bitcoin',
          address,
          from_block: requestedFromBlock,
          to_block: toBlock,
          analyzed_from_block: fromBlock,
        },
        activity: {
          count: outputs.length + inputs.length,
          items: [...outputs, ...inputs].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)),
        },
        fund_flow: fundFlow,
        assets: {
          total_btc_received_sats: totalIn,
          total_btc_spent_sats: totalOut,
        },
        bitcoin: {
          outputs_count: outputs.length,
          inputs_count: inputs.length,
          recent_outputs: outputs,
          recent_inputs: inputs,
        },
        tables: [
          buildWalletActivityTable('Wallet activity', outputs.length + inputs.length),
          buildWalletAssetFlowsTable(fundFlow.asset_flows.length),
          buildWalletLargestMovementsTable(fundFlow.largest_movements.length),
          buildBitcoinOutputsTable('Recent outputs', outputs.length),
          buildBitcoinInputsTable('Recent inputs', inputs.length),
        ],
      }, effectiveResponseFormat),
      `Wallet flow for ${address} on ${networkLabel}: ${outputs.length} inbound outputs, ${inputs.length} outbound inputs, net ${netSats} sats.`,
      {
        toolName: 'portal_get_wallet_summary',
        notices,
        freshness: buildQueryFreshness({
          finality: 'latest',
          headBlockNumber: head.number,
          windowToBlock: toBlock,
          resolvedWindow,
        }),
        execution: buildExecutionMetadata({
          mode,
          response_format: effectiveResponseFormat,
          result_scope: fromBlock > requestedFromBlock ? 'partial_window' : 'complete_window',
          requested_blocks: Math.max(0, toBlock - requestedFromBlock + 1),
          analyzed_blocks: Math.max(0, toBlock - fromBlock + 1),
          estimated_scan_blocks: Math.max(0, toBlock - fromBlock + 1),
          estimated_runtime_class:
            toBlock - fromBlock + 1 <= 250 ? 'interactive' : toBlock - fromBlock + 1 <= 2_000 ? 'long_window' : 'expensive',
          recommended_window: 'Use timeframe="24h" or a cursor continuation for bounded Bitcoin triage.',
          from_block: fromBlock,
          to_block: toBlock,
          range_kind: resolvedWindow.range_kind,
          normalized_output: true,
        }),
        pipes: pipesRecipe,
        ui: buildWalletUi({
          title: `Wallet summary: ${address}`,
          subtitle: `${describeWalletWindow(timeframe)} on ${networkLabel}`,
          activityCountPath: 'activity.count',
          primaryValuePath: 'assets.total_btc_received_sats',
          primaryLabel: 'BTC received (sats)',
          primaryFormat: 'decimal',
          secondaryCards: [
            buildMetricCard({
              id: 'btc-spent',
              label: 'BTC spent (sats)',
              value_path: 'assets.total_btc_spent_sats',
              format: 'decimal',
            }),
            buildMetricCard({
              id: 'outputs',
              label: 'Outputs',
              value_path: 'bitcoin.outputs_count',
              format: 'integer',
            }),
            buildMetricCard({ id: 'inputs', label: 'Inputs', value_path: 'bitcoin.inputs_count', format: 'integer' }),
          ],
          panels: [
            buildTimelinePanel({
              id: 'wallet-timeline',
              kind: 'timeline_panel',
              title: 'Activity timeline',
              subtitle: 'Chronological Bitcoin activity for this wallet.',
              data_key: 'activity.items',
              timestamp_key: 'timestamp_human',
              title_key: 'primary_id',
              subtitle_keys: ['record_type', 'tx_hash'],
              badge_key: 'record_type',
              emphasis: 'primary',
            }),
            buildTablePanel({
              id: 'wallet-table',
              kind: 'table_panel',
              title: 'Wallet activity',
              subtitle: 'Normalized inputs and outputs for this wallet window.',
              table_id: 'activity',
            }),
            buildTablePanel({
              id: 'wallet-outputs',
              kind: 'table_panel',
              title: 'Recent outputs',
              subtitle: 'Most recent outputs sent to the wallet.',
              table_id: 'bitcoin_outputs',
            }),
            buildTablePanel({
              id: 'wallet-inputs',
              kind: 'table_panel',
              title: 'Recent inputs',
              subtitle: 'Most recent inputs spent by the wallet.',
              table_id: 'bitcoin_inputs',
            }),
          ],
          followUpActions: [{ label: 'Show raw activity rows', intent: 'show_raw', target: 'activity.items' }],
        }),
        llm: buildWalletLlmOverrides('bitcoin'),
        coverage: buildSectionCoverage({
          windowFromBlock: requestedFromBlock,
          windowToBlock: toBlock,
          hasMore: false,
          windowComplete: fromBlock <= requestedFromBlock,
          sections: {
            activity: buildSectionPagination(outputs.length + inputs.length, false),
          },
        }),
        metadata: {
          network: dataset,
          dataset,
          from_block: fromBlock,
          to_block: toBlock,
          query_start_time: queryStartTime,
        },
      },
    )
  }

  const fillBlocks = await portalFetchRecentRecords(
    `${PORTAL_URL}/datasets/${dataset}/stream`,
    {
      type: 'hyperliquidFills',
      fromBlock,
      toBlock,
      fields: {
        block: { number: true, timestamp: true },
        fill: {
          fillIndex: true,
          user: true,
          coin: true,
          px: true,
          sz: true,
          fee: true,
          dir: true,
          side: true,
          hash: true,
          time: true,
        },
      },
      fills: [{ user: [address.toLowerCase()] }],
    },
    {
      itemKeys: ['fills'],
      limit: limit_per_type,
      chunkSize: Math.max(50, Math.min(250, limit_per_type * 10)),
      maxBytes: 25 * 1024 * 1024,
    },
  )

  const fills = fillBlocks.flatMap((block: any) =>
    (block.fills || []).map((fill: any) => {
      const timestamp = block.timestamp ?? block.header?.timestamp
      return {
        ...fill,
        block_number: block.number ?? block.header?.number,
        timestamp,
        timestamp_human: timestamp ? formatTimestamp(timestamp) : undefined,
        chain_kind: 'hyperliquid',
        record_type: 'fill',
        primary_id: fill.hash && fill.fillIndex !== undefined ? `${fill.hash}:${fill.fillIndex}` : fill.hash,
        tx_hash: fill.hash,
        sender: fill.user,
      }
    }),
  )
  const byCoin = new Map<string, number>()
  let totalFees = 0
  fills.forEach((fill: any) => {
    const coin = String(fill.coin || 'UNKNOWN')
    byCoin.set(coin, (byCoin.get(coin) || 0) + Number(fill.px || 0) * Number(fill.sz || 0))
    totalFees += Math.abs(Number(fill.fee || 0))
  })
  const sideBreakdown = fills.reduce((acc: Record<string, number>, fill: any) => {
    const side = String(fill.side || 'unknown')
    acc[side] = (acc[side] || 0) + 1
    return acc
  }, {})
  const coinFlows = Array.from(byCoin.entries())
    .map(([coin, volume]) =>
      buildSimpleAssetFlow({
        assetType: 'hyperliquid_coin',
        asset: coin,
        inboundCount: 0,
        outboundCount: 0,
        inboundAmount: `$0`,
        outboundAmount: `$0`,
        netAmount: `$${Number(volume.toFixed(2))} traded`,
        netDirection: 'flat',
      }),
    )
    .sort((left, right) => parseNumericAmount(right.net_amount.replace(/[$, traded]/g, '')) - parseNumericAmount(left.net_amount.replace(/[$, traded]/g, '')))
  const largestFills = fills
    .map((fill: any) => {
      const volume = Number(fill.px || 0) * Number(fill.sz || 0)
      return {
        direction: String(fill.side || '').toLowerCase().includes('sell') ? 'out' as const : 'in' as const,
        asset_type: 'hyperliquid_coin' as const,
        asset: String(fill.coin || 'UNKNOWN'),
        amount: `$${Number(volume.toFixed(2))}`,
        amount_numeric: volume,
        counterparty: typeof fill.user === 'string' ? fill.user : undefined,
        tx_hash: typeof fill.hash === 'string' ? fill.hash : undefined,
        block_number: getBlockNumber(fill),
        timestamp: typeof fill.timestamp === 'number' ? fill.timestamp : undefined,
        timestamp_human: typeof fill.timestamp_human === 'string' ? fill.timestamp_human : undefined,
        record_type: 'fill',
      }
    })
    .sort((left, right) => (right.amount_numeric ?? 0) - (left.amount_numeric ?? 0))
  const fundFlow = {
    summary: {
      fill_events: fills.length,
      traded_volume_usd: Number(Array.from(byCoin.values()).reduce((sum, value) => sum + value, 0).toFixed(2)),
      total_fees: totalFees,
      coins_touched: byCoin.size,
      side_breakdown: sideBreakdown,
    },
    asset_flows: coinFlows,
    counterparties: [],
    largest_movements: largestFills.slice(0, 10),
    next_pivots: largestFills[0]?.tx_hash
      ? [{ goal: 'Inspect the largest Hyperliquid fill hash', tool: 'portal_hyperliquid_query_fills', hash: largestFills[0].tx_hash }]
      : [],
  }

  return formatResult(
    applyWalletSummaryResponseFormat({
      overview: {
        network: dataset,
        vm: 'hyperliquid',
        address,
        from_block: requestedFromBlock,
        to_block: toBlock,
        analyzed_from_block: fromBlock,
      },
      activity: {
        count: fills.length,
        items: fills,
      },
      fund_flow: fundFlow,
      assets: {
        volume_by_coin: Array.from(byCoin.entries()).map(([coin, volume]) => ({ coin, volume_usd: volume })),
      },
      hyperliquid: {
        fee_summary: {
          total_fees: totalFees,
        },
        side_breakdown: sideBreakdown,
      },
      tables: [
        buildWalletActivityTable('Wallet activity', fills.length),
        buildWalletAssetFlowsTable(fundFlow.asset_flows.length),
        buildWalletLargestMovementsTable(fundFlow.largest_movements.length),
        buildTableDescriptor({
          id: 'volume_by_coin',
          dataKey: 'assets.volume_by_coin',
          rowCount: byCoin.size,
          title: 'Volume by coin',
          subtitle: 'Coin-level notional volume for this wallet in the selected window',
          keyField: 'coin',
          defaultSort: { key: 'volume_usd', direction: 'desc' },
          dense: true,
          columns: [
            { key: 'coin', label: 'Coin', kind: 'dimension' },
            { key: 'volume_usd', label: 'Volume', kind: 'metric', format: 'currency_usd', unit: 'USD', align: 'right' },
          ],
        }),
      ],
    }, effectiveResponseFormat),
    `Wallet flow for ${address} on ${networkLabel}: ${fills.length} recent fills across ${byCoin.size} coins, $${fundFlow.summary.traded_volume_usd} observed notional volume.`,
    {
      toolName: 'portal_get_wallet_summary',
      notices,
      freshness: buildQueryFreshness({
        finality: 'latest',
        headBlockNumber: head.number,
        windowToBlock: toBlock,
        resolvedWindow,
      }),
      execution: buildExecutionMetadata({
        mode,
        response_format: effectiveResponseFormat,
        result_scope: fromBlock > requestedFromBlock ? 'partial_window' : 'complete_window',
        requested_blocks: Math.max(0, toBlock - requestedFromBlock + 1),
        analyzed_blocks: Math.max(0, toBlock - fromBlock + 1),
        estimated_scan_blocks: Math.max(0, toBlock - fromBlock + 1),
        estimated_runtime_class:
          toBlock - fromBlock + 1 <= 2_000 ? 'interactive' : toBlock - fromBlock + 1 <= 500_000 ? 'long_window' : 'expensive',
        recommended_window: 'Use timeframe="1h" for a smaller Hyperliquid trader triage window.',
        from_block: fromBlock,
        to_block: toBlock,
        range_kind: resolvedWindow.range_kind,
        normalized_output: true,
      }),
      pipes: pipesRecipe,
      ui: buildWalletUi({
        title: `Wallet summary: ${address}`,
        subtitle: `${describeWalletWindow(timeframe)} on ${networkLabel}`,
        activityCountPath: 'activity.count',
        primaryValuePath: 'hyperliquid.fee_summary.total_fees',
        primaryLabel: 'Total fees',
        primaryFormat: 'decimal',
        secondaryCards: [
          buildMetricCard({
            id: 'coins',
            label: 'Coins traded',
            value_path: 'assets.volume_by_coin.length',
            format: 'integer',
          }),
        ],
        panels: [
          buildTimelinePanel({
            id: 'wallet-timeline',
            kind: 'timeline_panel',
            title: 'Fill timeline',
            subtitle: 'Chronological fill activity with trader and coin context.',
            data_key: 'activity.items',
            timestamp_key: 'timestamp_human',
            title_key: 'primary_id',
            subtitle_keys: ['record_type', 'sender', 'coin'],
            badge_key: 'record_type',
            emphasis: 'primary',
          }),
          buildTablePanel({
            id: 'wallet-table',
            kind: 'table_panel',
            title: 'Fill activity table',
            subtitle: 'Exact normalized fill rows.',
            table_id: 'activity',
          }),
          buildStatListPanel({
            id: 'coin-volume',
            kind: 'stat_list_panel',
            title: 'Volume by coin',
            subtitle: 'Top coin exposure in the selected wallet window.',
            data_key: 'assets.volume_by_coin',
            label_key: 'coin',
            value_key: 'volume_usd',
            value_format: 'currency_usd',
            unit: 'USD',
          }),
        ],
        followUpActions: [{ label: 'Show raw activity rows', intent: 'show_raw', target: 'activity.items' }],
      }),
      llm: buildWalletLlmOverrides('hyperliquid'),
      coverage: buildSectionCoverage({
        windowFromBlock: requestedFromBlock,
        windowToBlock: toBlock,
        hasMore: false,
        windowComplete: fromBlock <= requestedFromBlock,
        sections: {
          activity: buildSectionPagination(fills.length, false),
        },
      }),
      metadata: {
        network: dataset,
        dataset,
        from_block: fromBlock,
        to_block: toBlock,
        query_start_time: queryStartTime,
      },
    },
  )
}
