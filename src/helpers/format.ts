// ============================================================================
// Result Formatting
// ============================================================================

import type { LlmOverrides } from './llm-hints.js'
import { buildLlmHints } from './llm-hints.js'
import type { PipesRecipe } from './pipes-recipe.js'
import { getToolContract } from './tool-ux.js'

const MAX_RESPONSE_LENGTH = 50_000 // 50KB - keeps responses within MCP client context limits

export interface FormatOptions {
  maxItems?: number
  warnOnTruncation?: boolean
  notices?: string[]
  pagination?: Record<string, unknown>
  ordering?: unknown
  freshness?: unknown
  coverage?: unknown
  toolName?: string
  execution?: Record<string, unknown>
  ui?: unknown
  llm?: LlmOverrides
  pipes?: PipesRecipe
  metadata?: {
    network?: string
    dataset?: string
    from_block?: number
    to_block?: number
    query_start_time?: number
  }
}

export interface ResponseMetadata {
  network?: string
  dataset?: string
  queried_blocks?: string
  response_time_ms?: number
  returned?: number
  has_more?: boolean
}

type RecordLike = Record<string, unknown>

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  'base-mainnet': 'Base',
  'ethereum-mainnet': 'Ethereum',
  'optimism-mainnet': 'Optimism',
  'arbitrum-one': 'Arbitrum',
  'solana-mainnet': 'Solana',
  'bitcoin-mainnet': 'Bitcoin',
  'hyperliquid-fills': 'Hyperliquid',
  'hyperliquid-replica-cmds': 'Hyperliquid Replica Commands',
  portal_list_networks: 'Find Networks',
  portal_get_network_info: 'Network Info',
  portal_get_head: 'Network Head',
  portal_resolve_entity: 'Entity Resolver',
  portal_get_recent_activity: 'Recent Activity',
  portal_get_wallet_summary: 'Wallet Summary',
  portal_get_time_series: 'Time Series',
  portal_evm_query_transactions: 'EVM Transactions',
  portal_evm_query_logs: 'EVM Logs',
  portal_evm_query_token_transfers: 'Token Transfers',
  portal_evm_get_contract_deployment: 'Contract Deployment',
  portal_evm_get_contract_activity: 'Contract Activity',
  portal_evm_get_analytics: 'EVM Analytics',
  portal_evm_get_ohlc: 'EVM OHLC',
  portal_solana_query_transactions: 'Solana Transactions',
  portal_solana_query_instructions: 'Solana Instructions',
  portal_solana_get_analytics: 'Solana Analytics',
  portal_bitcoin_query_transactions: 'Bitcoin Transactions',
  portal_bitcoin_get_analytics: 'Bitcoin Analytics',
  portal_substrate_query_events: 'Substrate Events',
  portal_substrate_query_calls: 'Substrate Calls',
  portal_substrate_get_analytics: 'Substrate Analytics',
  portal_hyperliquid_query_fills: 'Hyperliquid Fills',
  portal_hyperliquid_get_analytics: 'Hyperliquid Analytics',
  portal_hyperliquid_get_ohlc: 'Hyperliquid OHLC',
  portal_debug_query_blocks: 'Block Lookup',
  portal_debug_resolve_time_to_block: 'Timestamp Lookup',
  portal_debug_hyperliquid_query_replica_commands: 'Hyperliquid Commands',
  uniswap_v2_swap: 'Uniswap v2 swap',
  uniswap_v3_swap: 'Uniswap v3 swap',
  uniswap_v4_swap: 'Uniswap v4 swap',
  aerodrome_slipstream_swap: 'Aerodrome Slipstream swap',
  uniswap_v2_sync: 'Uniswap v2 Sync',
  transaction_count: 'Transaction count',
  unique_addresses: 'Unique addresses',
  avg_gas_price: 'Average gas price',
  gas_used: 'Gas used',
  block_utilization: 'Block utilization',
  transactions_per_block: 'Transactions per block',
  block_size_bytes: 'Block size',
  fees_btc: 'Fees',
  fill_count: 'Fill count',
  token0: 'Token 0',
  token1: 'Token 1',
  evm: 'EVM',
  ohlc: 'OHLC',
  btc: 'BTC',
  eth: 'ETH',
  usd: 'USD',
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function getByPath(value: unknown, path?: string): unknown {
  if (!path) return value

  const tokens = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((token) => token.trim())
    .filter(Boolean)

  let current: unknown = value
  for (const token of tokens) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[token]
  }

  return current
}

function capitalizeWord(word: string): string {
  const lower = word.toLowerCase()
  if (DISPLAY_NAME_OVERRIDES[lower]) return DISPLAY_NAME_OVERRIDES[lower]
  if (['api', 'btc', 'dex', 'eth', 'evm', 'ohlc', 'rpc', 'sol', 'sql', 'ui', 'usd', 'usdc', 'usdt', 'vm'].includes(lower)) {
    return lower.toUpperCase()
  }
  if (/^[0-9]+[mhdw]$/.test(lower)) return lower
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function collectPayloadNotices(payload: RecordLike): string[] {
  return [
    ...asArray<string>(payload._notices),
    ...(typeof payload._notice === 'string' ? [payload._notice] : []),
  ].filter((notice) => notice.trim().length > 0)
}

function makeCompletenessAwareAnswer(answer: string, payload: RecordLike): string {
  const coverage = isRecord(payload._coverage) ? payload._coverage : undefined
  if (coverage?.window_complete !== false && coverage?.result_complete !== false) {
    return answer
  }

  const notice = collectPayloadNotices(payload)
    .find((item) => /\b(partial|incomplete|coverage|analyzed\b.*\brequested|sample|truncated|shortened)\b/i.test(item))
  const suffixes: string[] = []
  if (coverage?.window_complete === false) {
    if (!/\b(partial|incomplete|coverage|analyzed\b.*\brequested|only\b.*\brequested)\b/i.test(answer)) {
      suffixes.push(`Partial window: ${notice ?? 'coverage metadata marks this window as partially analyzed.'}`)
    }
  }

  if (coverage?.result_complete === false) {
    if (!/\b(preview|cursor|continue|more matching|older results|limited to)\b/i.test(answer)) {
      suffixes.push('Preview page: continue with the cursor for remaining rows.')
    }
  }

  return suffixes.length > 0 ? `${answer} ${suffixes.join(' ')}` : answer
}

export function humanizeLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const lower = trimmed.toLowerCase()
  if (DISPLAY_NAME_OVERRIDES[lower]) return DISPLAY_NAME_OVERRIDES[lower]
  if (/^0x[0-9a-f]{40,64}$/i.test(trimmed)) return trimmed

  const normalized = trimmed
    .replace(/[-_]+/g, ' ')
    .replace(/\bmainnet\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return trimmed
  return normalized.split(' ').map((word) => capitalizeWord(word)).join(' ')
}

/**
 * Convert hex string to decimal number.
 */
export function hexToNumber(hex: string): number {
  if (!hex || hex === '0x' || hex === '0x0') return 0
  return parseInt(hex, 16)
}

/**
 * Convert hex string to bigint for values that can exceed Number.MAX_SAFE_INTEGER.
 */
export function hexToBigInt(hex: string): bigint {
  if (!hex || hex === '0x' || hex === '0x0') return 0n
  return BigInt(hex)
}

/**
 * Convert hex string to decimal string.
 */
export function hexToDecimal(hex: string): string {
  if (!hex || hex === '0x' || hex === '0x0') {
    return '0'
  }

  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  try {
    return BigInt('0x' + cleanHex).toString()
  } catch {
    return '0'
  }
}

/**
 * Convert wei (hex or bigint) to ETH with specified decimals.
 */
export function weiToEth(wei: string | bigint, decimals: number = 18): string {
  const weiValue = typeof wei === 'string' ? hexToBigInt(wei) : wei
  const divisor = 10n ** BigInt(decimals)
  const ethValue = Number(weiValue) / Number(divisor)

  if (ethValue === 0) return '0'
  if (ethValue < 0.000001) return ethValue.toExponential(4)
  if (ethValue < 0.01) return ethValue.toFixed(6)
  if (ethValue < 1) return ethValue.toFixed(4)
  if (ethValue < 1000) return ethValue.toFixed(2)
  return ethValue.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/**
 * Convert wei to Gwei for gas prices.
 */
export function weiToGwei(wei: string | bigint): string {
  const weiValue = typeof wei === 'string' ? hexToBigInt(wei) : wei
  const gwei = Number(weiValue) / 1e9

  if (gwei === 0) return '0'
  if (gwei < 0.01) return gwei.toFixed(4)
  if (gwei < 100) return gwei.toFixed(2)
  return gwei.toFixed(1)
}

export function formatTokenAmount(value: string, decimals: number = 18, symbol?: string): string {
  const formatted = weiToEth(value, decimals)
  return symbol ? `${formatted} ${symbol}` : formatted
}

export function formatTokenValue(
  hexValue: string,
  decimals: number = 18,
  symbol?: string,
): {
  raw: string
  decimal: string
  formatted: string
} {
  const decimal = hexToDecimal(hexValue)
  const bigIntValue = BigInt(decimal)
  const divisor = BigInt(10) ** BigInt(decimals)
  const integerPart = bigIntValue / divisor
  const fractionalPart = bigIntValue % divisor
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
  const trimmedFractional = fractionalStr.replace(/0+$/, '')

  let formatted: string
  if (trimmedFractional.length > 0) {
    const displayDecimals = Math.min(trimmedFractional.length, 6)
    formatted = `${integerPart}.${trimmedFractional.slice(0, displayDecimals)}`
  } else {
    formatted = integerPart.toString()
  }

  if (symbol) formatted += ` ${symbol}`

  return {
    raw: hexValue,
    decimal,
    formatted,
  }
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return date.toISOString().replace('T', ' ').split('.')[0] + ' UTC'
}

export function formatTimestampRelative(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp

  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return formatTimestamp(timestamp)
}

export function formatGas(gasHex: string): {
  raw: string
  decimal: number
  formatted: string
} {
  const decimal = hexToNumber(gasHex)
  return {
    raw: gasHex,
    decimal,
    formatted: decimal.toLocaleString('en-US'),
  }
}

export function formatGasPrice(gasPriceHex: string): {
  raw: string
  gwei: string
  formatted: string
} {
  const gwei = weiToGwei(gasPriceHex)
  return {
    raw: gasPriceHex,
    gwei,
    formatted: `${gwei} Gwei`,
  }
}

export function formatGasAmount(hexValue: string): {
  raw: string
  decimal: string
  formatted_eth: string
  formatted_gwei: string
} {
  const decimal = hexToDecimal(hexValue)
  const bigIntValue = BigInt(decimal)
  const ethValue = Number(bigIntValue) / Number(BigInt(10) ** BigInt(18))
  const gweiValue = Number(bigIntValue) / Number(BigInt(10) ** BigInt(9))

  return {
    raw: hexValue,
    decimal,
    formatted_eth: `${ethValue.toFixed(6)} ETH`,
    formatted_gwei: `${gweiValue.toFixed(2)} Gwei`,
  }
}

export function formatValue(valueHex: string): {
  raw: string
  eth: string
  formatted: string
} {
  const eth = weiToEth(valueHex)
  return {
    raw: valueHex,
    eth,
    formatted: `${eth} ETH`,
  }
}

function isHexValue(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value) && value.length > 4
}

function isAnyHexValue(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)
}

export function formatTransactionFields(tx: Record<string, unknown>): Record<string, unknown> {
  const result = { ...tx }

  if (isAnyHexValue(result.value)) {
    const ethValue = weiToEth(result.value as string)
    result.value_eth = ethValue
    delete result.value
  }

  for (const field of ['gasPrice', 'effectiveGasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']) {
    if (isHexValue(result[field])) {
      result[`${field}_gwei`] = weiToGwei(result[field] as string)
      delete result[field]
    }
  }

  for (const field of ['gas', 'gasUsed', 'cumulativeGasUsed']) {
    if (isHexValue(result[field])) {
      result[field] = hexToNumber(result[field] as string)
    }
  }

  for (const field of ['nonce', 'transactionIndex', 'type', 'status']) {
    if (isHexValue(result[field])) {
      result[field] = hexToNumber(result[field] as string)
    }
  }

  if (isHexValue(result.l1Fee)) {
    result.l1Fee_eth = weiToEth(result.l1Fee as string)
    delete result.l1Fee
  }
  if (isHexValue(result.l1GasUsed)) {
    result.l1GasUsed = hexToNumber(result.l1GasUsed as string)
  }
  if (isHexValue(result.l1GasPrice)) {
    result.l1GasPrice_gwei = weiToGwei(result.l1GasPrice as string)
    delete result.l1GasPrice
  }

  for (const field of ['v', 'r', 's', 'yParity', 'logsBloom']) {
    delete result[field]
  }

  return result
}

export function addValueConversions<T extends Record<string, unknown>>(
  obj: T,
  options: {
    tokenDecimals?: number
    tokenSymbol?: string
  } = {},
): T & {
  value_decimal?: string
  value_formatted?: string
  gas_decimal?: string
  gas_formatted?: string
} {
  const result = { ...obj }

  if (typeof obj.value === 'string' && obj.value.startsWith('0x')) {
    const converted = formatTokenValue(obj.value, options.tokenDecimals, options.tokenSymbol)
    return {
      ...result,
      value_decimal: converted.decimal,
      value_formatted: converted.formatted,
    }
  }

  if (typeof obj.gas === 'string' && obj.gas.startsWith('0x')) {
    const converted = formatGasAmount(obj.gas)
    return {
      ...result,
      gas_decimal: converted.decimal,
      gas_formatted: converted.formatted_gwei,
    }
  }

  return result
}

export function formatNumber(n: number): string {
  if (n === 0) return '0'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M'
  if (abs >= 1e4) return sign + (abs / 1e3).toFixed(1) + 'K'
  if (abs >= 1000) return sign + abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (abs >= 1) return sign + abs.toFixed(2)
  if (abs >= 0.01) return sign + abs.toFixed(4)
  return sign + abs.toFixed(8)
}

export function formatUSD(n: number): string {
  if (n === 0) return '$0'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K'
  return sign + '$' + abs.toFixed(2)
}

export function formatPct(n: number): string {
  return n.toFixed(1) + '%'
}

export function formatBTC(btc: number): string {
  if (btc === 0) return '0 BTC'
  if (Math.abs(btc) < 0.001) return Math.round(btc * 1e8).toLocaleString('en-US') + ' sats'
  return btc.toFixed(8) + ' BTC'
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return Math.round(seconds) + 's'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's'
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm'
  return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h'
}

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function formatAddress(address: string, label?: string): string {
  if (label) return `${label} (${shortenAddress(address)})`
  return address
}

function buildChatAnswer(payload: RecordLike): string | undefined {
  if (typeof payload._summary === 'string' && payload._summary.trim()) {
    return makeCompletenessAwareAnswer(payload._summary.trim(), payload)
  }

  const headline = isRecord(payload._ui) && isRecord(payload._ui.headline) ? payload._ui.headline : undefined
  const title = typeof headline?.title === 'string' ? headline.title : undefined
  const subtitle = typeof headline?.subtitle === 'string' ? headline.subtitle : undefined
  if (title && subtitle) return makeCompletenessAwareAnswer(`${title}: ${subtitle}`, payload)
  if (title) return makeCompletenessAwareAnswer(title, payload)
  if (subtitle) return makeCompletenessAwareAnswer(subtitle, payload)

  if (typeof payload.number === 'number') {
    return makeCompletenessAwareAnswer(`Current value: ${payload.number.toLocaleString('en-US')}.`, payload)
  }

  if (typeof payload.value === 'number' || typeof payload.value === 'string') {
    return makeCompletenessAwareAnswer(`Current value: ${String(payload.value)}.`, payload)
  }

  if (isRecord(payload.head) && typeof payload.head.number === 'number') {
    return makeCompletenessAwareAnswer(`Current head is ${payload.head.number.toLocaleString('en-US')}.`, payload)
  }

  if (Array.isArray(payload.items)) {
    return makeCompletenessAwareAnswer(`Returned ${payload.items.length.toLocaleString('en-US')} result${payload.items.length === 1 ? '' : 's'}.`, payload)
  }

  const meta = isRecord(payload._meta) ? payload._meta : undefined
  const summary = isRecord(payload.summary) ? payload.summary : undefined
  const toolContract = isRecord(payload._tool_contract) ? payload._tool_contract : undefined
  const network = humanizeLabel(
    meta?.network
    ?? meta?.dataset
    ?? summary?.network
    ?? payload.network
    ?? payload.display_name,
  )
  const toolName = typeof toolContract?.name === 'string' ? toolContract.name : undefined
  const toolLabel = humanizeLabel(toolName?.replace(/^portal_/, ''))
  if (toolLabel && network) {
    return makeCompletenessAwareAnswer(`${toolLabel} for ${network}.`, payload)
  }
  if (toolLabel) {
    return makeCompletenessAwareAnswer(toolLabel, payload)
  }

  return undefined
}

function buildDisplay(payload: RecordLike): RecordLike | undefined {
  const headline = isRecord(payload._ui) && isRecord(payload._ui.headline) ? payload._ui.headline : undefined
  const summary = isRecord(payload.summary) ? payload.summary : undefined
  const meta = isRecord(payload._meta) ? payload._meta : undefined
  const toolContract = isRecord(payload._tool_contract) ? payload._tool_contract : undefined

  const title =
    (typeof headline?.title === 'string' && headline.title)
    || humanizeLabel(summary?.pair_label)
    || humanizeLabel(summary?.venue_label)
    || humanizeLabel(summary?.metric)
    || humanizeLabel(toolContract?.name)
  const resolvedNetwork =
    humanizeLabel(meta?.network)
    || humanizeLabel(meta?.dataset)
    || humanizeLabel(summary?.network)
    || humanizeLabel(payload.network)
    || humanizeLabel(payload.display_name)

  const subtitle =
    (typeof headline?.subtitle === 'string' && headline.subtitle)
    || [
      resolvedNetwork,
      humanizeLabel(summary?.venue_label),
      typeof summary?.interval === 'string' ? summary.interval : undefined,
      typeof summary?.duration === 'string' ? summary.duration : undefined,
    ].filter((value): value is string => Boolean(value)).join(' • ')

  const display: RecordLike = {}
  if (title) display.title = title
  if (subtitle) display.subtitle = subtitle

  if (resolvedNetwork) display.network = resolvedNetwork

  const vmValues = asArray<string>(toolContract?.vm).filter((value) => value !== 'cross-chain')
  if (vmValues.length === 1) {
    const vm = humanizeLabel(vmValues[0])
    if (vm) display.vm = vm
  }

  const focus =
    humanizeLabel(summary?.pair_label)
    || humanizeLabel(summary?.metric)
    || humanizeLabel(summary?.base_token)
    || (typeof payload.address === 'string' ? payload.address : undefined)
  if (focus) display.focus = focus

  const source =
    humanizeLabel(summary?.venue_label)
    || humanizeLabel(summary?.source)
  if (source) display.source = source

  return Object.keys(display).length > 0 ? display : undefined
}

function buildNextSteps(payload: RecordLike): RecordLike | undefined {
  const ui = isRecord(payload._ui) ? payload._ui : undefined
  const pipesHandoff = isRecord(payload.pipes_handoff) ? payload.pipes_handoff : undefined
  const actions = asArray<RecordLike>(ui?.follow_up_actions)
    .slice(0, 6)
    .map((action) => ({
      label: typeof action.label === 'string' ? action.label : 'Continue',
      ...(typeof action.intent === 'string' ? { intent: action.intent } : {}),
      ...(typeof action.target === 'string' ? { target: action.target } : {}),
    }))

  const pagination = isRecord(payload._pagination) ? payload._pagination : undefined
  const hasContinuation = typeof pagination?.next_cursor === 'string'
  const hasExplicitContinueAction = actions.some((action) => action.intent === 'continue')

  if (hasContinuation && !hasExplicitContinueAction) {
    actions.unshift({
      label: 'Load older results',
      intent: 'continue',
      target: '_pagination.next_cursor',
    })
  }

  if (actions.length === 0 && typeof pagination?.next_cursor !== 'string' && !pipesHandoff) {
    return undefined
  }

  return {
    actions,
    ...(hasContinuation
      ? {
          continuation: {
            available: true,
            label: 'Load older results',
            how_to_continue: 'Call the same tool again with the next cursor from _pagination.next_cursor.',
            note: 'This response is a preview page, so older matching results are still available.',
          },
        }
      : {}),
    ...(pipesHandoff
      ? {
          custom_data: {
            available: true,
            label: typeof pipesHandoff.title === 'string' ? pipesHandoff.title : 'Need more data?',
            note:
              typeof pipesHandoff.summary === 'string'
                ? pipesHandoff.summary
                : 'Use Pipes SDK plus SQD agent skills when you need custom indexing or protocol-specific depth.',
          },
        }
      : {}),
  }
}

function buildTechnicalDetails(payload: RecordLike): RecordLike | undefined {
  const technicalDetails: RecordLike = {}

  if (payload._meta !== undefined) technicalDetails.meta = payload._meta
  if (payload._freshness !== undefined) technicalDetails.freshness = payload._freshness
  if (payload._coverage !== undefined) technicalDetails.coverage = payload._coverage
  if (payload._execution !== undefined) technicalDetails.execution = payload._execution
  if (payload._pagination !== undefined) technicalDetails.pagination = payload._pagination
  if (payload._ordering !== undefined) technicalDetails.ordering = payload._ordering
  if (payload._tool_contract !== undefined) technicalDetails.tool_contract = payload._tool_contract

  return Object.keys(technicalDetails).length > 0 ? technicalDetails : undefined
}

function buildDefaultFreshness(): RecordLike {
  return { kind: 'not_applicable' }
}

function buildDefaultPagination(): RecordLike {
  return { has_more: false }
}

function buildDefaultCoverage(): RecordLike {
  return {
    kind: 'not_applicable',
    result_complete: true,
  }
}

function buildDefaultOrdering(): RecordLike {
  return { kind: 'not_applicable' }
}

function buildDefaultExecution(toolName?: string): RecordLike {
  return {
    kind: 'not_applicable',
    source: 'portal_mcp',
    ...(toolName ? { tool: toolName } : {}),
  }
}

function inferPrimaryEvidencePath(payload: RecordLike): string | undefined {
  const table = asArray<RecordLike>(payload.tables).find((entry) => typeof entry.data_key === 'string')
  if (typeof table?.data_key === 'string') return table.data_key

  const chart = isRecord(payload.chart) ? payload.chart : undefined
  if (typeof chart?.data_key === 'string') return chart.data_key

  const preferredKeys = [
    'items',
    'matches',
    'activity.items',
    'token_transfers.items',
    'transactions.items',
    'ohlc',
    'time_series',
    'volume_by_coin',
    'top_traders_by_volume',
    'top_senders',
    'top_receivers',
    'top_contracts',
    'recent_outputs',
    'recent_inputs',
    'summary_rows',
    'overview',
    'summary',
    'interactions',
    'network',
    'block_details',
    'block_number',
    'timestamp',
  ]

  return preferredKeys.find((path) => {
    const value = getByPath(payload, path)
    return value !== undefined
  })
}

function inferPrimaryEvidenceKind(payload: RecordLike, primaryPath?: string): string | undefined {
  const table = asArray<RecordLike>(payload.tables).find((entry) => entry.data_key === primaryPath)
  if (typeof table?.title === 'string') return table.title

  const chart = isRecord(payload.chart) ? payload.chart : undefined
  if (chart && chart.data_key === primaryPath && typeof chart.kind === 'string') return chart.kind

  if (!primaryPath) return undefined
  if (primaryPath === 'answer' || primaryPath === '_summary') return 'summary_text'
  if (primaryPath.includes('ohlc')) return 'candles'
  if (primaryPath.includes('time_series')) return 'time_series'
  if (primaryPath.includes('activity')) return 'activity'
  if (primaryPath.includes('transaction')) return 'transactions'
  if (primaryPath.includes('transfer')) return 'token_transfers'
  if (primaryPath.includes('top_')) return 'ranked_summary'
  if (primaryPath.includes('overview') || primaryPath.includes('summary')) return 'summary'
  if (primaryPath.includes('block_number') || primaryPath.includes('timestamp')) return 'lookup'
  return 'records'
}

function inferReturnedCount(payload: RecordLike, primaryPath?: string): number | undefined {
  const meta = isRecord(payload._meta) ? payload._meta : undefined
  if (typeof meta?.returned === 'number') return meta.returned

  const primaryValue = getByPath(payload, primaryPath)
  if (Array.isArray(primaryValue)) return primaryValue.length

  const overview = isRecord(payload.overview) ? payload.overview : undefined
  if (typeof overview?.activity_count === 'number') return overview.activity_count
  if (typeof overview?.transaction_count === 'number') return overview.transaction_count

  return undefined
}

function collectCandidateRows(payload: RecordLike): Array<{ path: string; row: RecordLike }> {
  const paths = [
    'items',
    'activity.items',
    'token_transfers.items',
    'transactions.items',
    'top_senders',
    'top_receivers',
    'top_contracts',
    'volume_by_coin',
    'top_traders_by_volume',
    'recent_outputs',
    'recent_inputs',
  ]
  const rows: Array<{ path: string; row: RecordLike }> = []

  rows.push({ path: '$', row: payload })

  for (const path of paths) {
    const value = getByPath(payload, path)
    if (!Array.isArray(value)) continue
    value.slice(0, 3).forEach((entry, index) => {
      if (isRecord(entry)) rows.push({ path: `${path}[${index}]`, row: entry })
    })
  }

  return rows
}

function collectInvestigationPivots(payload: RecordLike): RecordLike[] {
  const pivotKeys: Record<string, string> = {
    address: 'address',
    contract_address: 'address',
    token_address: 'token_address',
    pool_address: 'pool_address',
    pool_id: 'pool_id',
    block_number: 'from_block/to_block',
    from: 'from_addresses',
    to: 'to_addresses',
    sender: 'from_addresses',
    recipient: 'to_addresses',
    user: 'user',
    coin: 'coin',
    program_id: 'program_id',
    transaction_hash: 'transaction_hash',
    tx_hash: 'transaction_hash',
    hash: 'transaction_hash',
    primary_id: 'primary_id',
  }
  const seen = new Set<string>()
  const pivots: RecordLike[] = []

  for (const { path, row } of collectCandidateRows(payload)) {
    for (const [key, useAs] of Object.entries(pivotKeys)) {
      const value = row[key]
      if (typeof value !== 'string' && typeof value !== 'number') continue
      const text = String(value)
      if (!text || text === '0x') continue
      const dedupeKey = `${key}:${text}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      pivots.push({
        field: key,
        path: `${path}.${key}`,
        value: text,
        use_as: useAs,
      })
      if (pivots.length >= 10) return pivots
    }
  }

  return pivots
}

function buildInvestigationGuide(payload: RecordLike): RecordLike | undefined {
  const toolContract = isRecord(payload._tool_contract) ? payload._tool_contract : undefined
  const intent = typeof toolContract?.intent === 'string' ? toolContract.intent : undefined
  const meta = isRecord(payload._meta) ? payload._meta : undefined
  const pagination = isRecord(payload._pagination) ? payload._pagination : undefined
  const coverage = isRecord(payload._coverage) ? payload._coverage : undefined
  const execution = isRecord(payload._execution) ? payload._execution : undefined
  const notices = [
    ...asArray<string>(payload._notices),
    ...(typeof payload._notice === 'string' ? [payload._notice] : []),
  ].slice(0, 4)
  const primaryPath = inferPrimaryEvidencePath(payload) ?? (typeof payload.answer === 'string' ? 'answer' : undefined) ?? '_summary'
  const primaryKind = inferPrimaryEvidenceKind(payload, primaryPath)
  const returned = inferReturnedCount(payload, primaryPath)
  const pivots = collectInvestigationPivots(payload)
  const limitations: string[] = []

  if (typeof meta?.queried_blocks === 'string') {
    limitations.push(`Evidence is limited to queried blocks ${meta.queried_blocks}.`)
  }
  if (typeof pagination?.next_cursor === 'string') {
    limitations.push('This is a preview page. Continue with _pagination.next_cursor before treating the history as complete.')
  }
  if (coverage?.has_more === true || coverage?.result_complete === false || coverage?.window_complete === false) {
    limitations.push('Coverage metadata says more matching data may exist outside this response.')
  }
  if (typeof execution?.max_scan_blocks === 'number' && typeof execution?.scanned_blocks === 'number') {
    limitations.push(
      `Bounded scan covered ${execution.scanned_blocks.toLocaleString('en-US')} of up to ${execution.max_scan_blocks.toLocaleString('en-US')} allowed blocks.`,
    )
  }
  limitations.push(...notices)

  const followUpFilters: RecordLike[] = []
  const pivotFields = new Set(pivots.map((pivot) => (typeof pivot.field === 'string' ? pivot.field : undefined)))
  if (typeof pagination?.next_cursor === 'string') {
    followUpFilters.push({
      goal: 'Continue the timeline',
      use: 'Call the same tool with cursor from _pagination.next_cursor.',
    })
  }
  if (pivotFields.has('block_number')) {
    followUpFilters.push({
      goal: 'Anchor a block window',
      use: 'Use the block_number pivot as from_block/to_block, or expand around it for incident context.',
    })
  }
  if (pivots.some((pivot) => pivot.field !== 'block_number')) {
    followUpFilters.push({
      goal: 'Pivot from a concrete entity',
      use: 'Reuse values from investigation.pivots as exact filters in wallet, transaction, log, transfer, fill, or instruction queries.',
    })
  }
  if (typeof meta?.queried_blocks === 'string' || execution?.range_kind !== undefined) {
    followUpFilters.push({
      goal: 'Expand or narrow the time window',
      use: 'Adjust timeframe/from_block/to_block/from_timestamp/to_timestamp and compare results.',
    })
  }

  return {
    version: 'portal_investigation_v1',
    status:
      typeof pagination?.next_cursor === 'string'
        ? 'partial_page'
        : intent === 'discover'
          ? 'reference_result'
          : 'bounded_result',
    evidence: {
      ...(typeof toolContract?.name === 'string' ? { tool: toolContract.name } : {}),
      ...(primaryPath ? { primary_path: primaryPath } : {}),
      ...(primaryKind ? { primary_kind: primaryKind } : {}),
      ...(typeof meta?.network === 'string' ? { network: meta.network } : {}),
      ...(typeof meta?.dataset === 'string' ? { dataset: meta.dataset } : {}),
      ...(typeof meta?.queried_blocks === 'string' ? { queried_blocks: meta.queried_blocks } : {}),
      ...(typeof meta?.response_time_ms === 'number' ? { response_time_ms: meta.response_time_ms } : {}),
      ...(returned !== undefined ? { returned } : {}),
    },
    pivots,
    follow_up_filters: followUpFilters,
    limitations: Array.from(new Set(limitations)).slice(0, 6),
  }
}

const TRUNCATABLE_ARRAY_KEYS = new Set([
  'items',
  'time_series',
  'ohlc',
  'current_series',
  'previous_series',
  'comparison_series',
  'bucket_deltas',
  'top_contracts',
  'top_senders',
  'top_receivers',
  'top_programs',
  'programs',
  'volume_by_coin',
  'top_traders_by_volume',
  'top_pnl_winners',
  'top_pnl_losers',
  'recent_outputs',
  'recent_inputs',
  'summary_rows',
])

type TruncatableArrayRef = {
  key: string
  path: string
  values: unknown[]
  replace: (nextValues: unknown[]) => void
}

function buildInferredExecutionMetadata(metadata?: FormatOptions['metadata']) {
  if (!metadata) return undefined

  if (metadata.from_block === undefined && metadata.to_block === undefined) {
    return undefined
  }

  return {
    scan_window: {
      ...(metadata.from_block !== undefined ? { from_block: metadata.from_block } : {}),
      ...(metadata.to_block !== undefined ? { to_block: metadata.to_block } : {}),
    },
  }
}

function mergeExecutionMetadata(
  inferredExecution: Record<string, unknown> | undefined,
  explicitExecution: Record<string, unknown> | undefined,
) {
  if (!inferredExecution && !explicitExecution) {
    return undefined
  }

  const merged = {
    ...(inferredExecution || {}),
    ...(explicitExecution || {}),
  } as Record<string, unknown>

  if (
    inferredExecution?.['scan_window']
    && explicitExecution?.['scan_window']
    && typeof inferredExecution['scan_window'] === 'object'
    && inferredExecution['scan_window'] !== null
    && typeof explicitExecution['scan_window'] === 'object'
    && explicitExecution['scan_window'] !== null
  ) {
    merged.scan_window = {
      ...(inferredExecution['scan_window'] as Record<string, unknown>),
      ...(explicitExecution['scan_window'] as Record<string, unknown>),
    }
  }

  return merged
}

function normalizeExecutionMetadata(
  execution: Record<string, unknown>,
  toolName?: string,
): Record<string, unknown> {
  const hasWindowOrResolution =
    execution.kind !== undefined
    || execution.range_kind !== undefined
    || execution.scan_window !== undefined
    || execution.timestamp !== undefined
    || execution.resolution !== undefined

  if (hasWindowOrResolution) {
    return {
      ...(toolName && execution.tool === undefined ? { tool: toolName } : {}),
      ...execution,
    }
  }

  return {
    kind: 'not_applicable',
    ...(toolName ? { tool: toolName } : {}),
    ...execution,
  }
}

function collectTruncatableArrays(
  value: unknown,
  path = '$',
  results: TruncatableArrayRef[] = [],
): TruncatableArrayRef[] {
  if (!value || typeof value !== 'object') {
    return results
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectTruncatableArrays(entry, `${path}[${index}]`, results))
    return results
  }

  const record = value as Record<string, unknown>
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`
    if (Array.isArray(child)) {
      if (TRUNCATABLE_ARRAY_KEYS.has(key) || key.endsWith('_items') || key.endsWith('_series')) {
        results.push({
          key,
          path: childPath,
          values: child,
          replace: (nextValues) => {
            record[key] = nextValues
          },
        })
      }
      child.forEach((entry, index) => collectTruncatableArrays(entry, `${childPath}[${index}]`, results))
      continue
    }

    collectTruncatableArrays(child, childPath, results)
  }

  return results
}

function truncateNestedArraysToFit(
  value: unknown,
  maxLength: number,
): { data: unknown; truncatedPaths: string[]; jsonString?: string } | undefined {
  let working: unknown
  try {
    working = JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }

  const truncatedPaths = new Set<string>()
  let jsonString = JSON.stringify(working, null, 2)
  if (jsonString.length <= maxLength) {
    return { data: working, truncatedPaths: [], jsonString }
  }

  while (jsonString.length > maxLength) {
    const candidates = collectTruncatableArrays(working).filter((candidate) => candidate.values.length > 1)
    if (candidates.length === 0) {
      return undefined
    }

    candidates.sort((left, right) => right.values.length - left.values.length)
    const target = candidates[0]
    const nextLength = Math.max(1, Math.floor(target.values.length / 2))
    if (nextLength >= target.values.length) {
      return undefined
    }

    target.replace(target.values.slice(0, nextLength))
    truncatedPaths.add(target.path)
    jsonString = JSON.stringify(working, null, 2)
  }

  return {
    data: working,
    truncatedPaths: Array.from(truncatedPaths),
    jsonString,
  }
}

/**
 * Format results as MCP text content with optional metadata and truncation.
 */
export function formatResult(
  data: unknown,
  message?: string,
  options?: FormatOptions,
): { content: Array<{ type: 'text'; text: string }> } {
  const maxItems = options?.maxItems

  let dataToFormat = data
  let truncated = false
  let truncationKind: 'array' | 'nested' | undefined
  let originalCount = 0
  const notices = [...(options?.notices || [])]

  // Handle array truncation
  if (Array.isArray(data) && maxItems && data.length > maxItems) {
    originalCount = data.length
    dataToFormat = data.slice(0, maxItems)
    truncated = true
    truncationKind = 'array'
  }

  let jsonString: string
  try {
    jsonString = JSON.stringify(dataToFormat, null, 2)
  } catch {
    try {
      jsonString = JSON.stringify(dataToFormat)
    } catch {
      return {
        content: [{ type: 'text', text: 'Error: Unable to serialize response.' }],
      }
    }
  }

  // Truncate if too large
  if (jsonString.length > MAX_RESPONSE_LENGTH) {
    if (Array.isArray(dataToFormat)) {
      const safeCount = Math.floor(((dataToFormat as unknown[]).length * MAX_RESPONSE_LENGTH) / jsonString.length)
      originalCount = originalCount || (dataToFormat as unknown[]).length
      dataToFormat = (dataToFormat as unknown[]).slice(0, Math.max(1, safeCount))
      jsonString = JSON.stringify(dataToFormat, null, 2)
      truncated = true
      truncationKind = 'array'
    } else {
      const nestedTruncation = truncateNestedArraysToFit(dataToFormat, MAX_RESPONSE_LENGTH)
      if (nestedTruncation) {
        dataToFormat = nestedTruncation.data
        jsonString = nestedTruncation.jsonString ?? JSON.stringify(dataToFormat, null, 2)
        truncated = true
        truncationKind = 'nested'
        const pathLabel = nestedTruncation.truncatedPaths.slice(0, 3).join(', ')
        const extraCount = Math.max(0, nestedTruncation.truncatedPaths.length - 3)
        notices.push(
          extraCount > 0
            ? `Large nested arrays were truncated to fit MCP limits (${pathLabel}, +${extraCount} more).`
            : `Large nested arrays were truncated to fit MCP limits (${pathLabel}).`,
        )
      } else {
        return {
          content: [{ type: 'text', text: `Error: Response too large. Add filters or reduce block range.` }],
        }
      }
    }
  }

  if (truncated && (options?.warnOnTruncation ?? true)) {
    if (truncationKind === 'array' && Array.isArray(dataToFormat) && originalCount > dataToFormat.length) {
      notices.push(`Results truncated: showing ${(dataToFormat as unknown[]).length} of ${originalCount} items.`)
    } else if (truncationKind === 'nested') {
      notices.push('Some nested sections were shortened to keep the response fast and readable in MCP clients.')
    }
  }

  // Attach metadata
  const metadata = options?.metadata
  let responsePayload: unknown = dataToFormat

  if (metadata) {
    const meta: ResponseMetadata = {}
    if (metadata.network) meta.network = metadata.network
    if (metadata.dataset) meta.dataset = metadata.dataset
    if (metadata.from_block !== undefined && metadata.to_block !== undefined) {
      meta.queried_blocks = `${metadata.from_block}-${metadata.to_block}`
    }
    if (metadata.query_start_time) meta.response_time_ms = Date.now() - metadata.query_start_time
    if (Array.isArray(dataToFormat)) {
      meta.returned = (dataToFormat as unknown[]).length
      if (truncated) meta.has_more = true
    }

    if (Array.isArray(dataToFormat)) {
      responsePayload = { items: dataToFormat, _meta: meta }
    } else if (typeof dataToFormat === 'object' && dataToFormat !== null) {
      responsePayload = { ...dataToFormat, _meta: meta }
    } else {
      responsePayload = { value: dataToFormat, _meta: meta }
    }
  } else if (Array.isArray(dataToFormat)) {
    responsePayload = { items: dataToFormat }
  } else if (typeof dataToFormat !== 'object' || dataToFormat === null) {
    responsePayload = { value: dataToFormat }
  }

  if (typeof responsePayload === 'object' && responsePayload !== null) {
    const payloadRecord = responsePayload as Record<string, unknown>
    const toolContract = options?.toolName ? getToolContract(options.toolName) : undefined
    const execution = normalizeExecutionMetadata(
      mergeExecutionMetadata(buildInferredExecutionMetadata(metadata), options?.execution)
        ?? buildDefaultExecution(options?.toolName),
      options?.toolName,
    )

    if (message?.trim()) {
      payloadRecord._summary = message.trim()
    }
    if (toolContract) {
      payloadRecord._tool_contract = toolContract
    }
    payloadRecord._pagination = options?.pagination ?? buildDefaultPagination()
    payloadRecord._ordering = options?.ordering ?? buildDefaultOrdering()
    payloadRecord._freshness = options?.freshness ?? buildDefaultFreshness()
    payloadRecord._coverage = options?.coverage ?? buildDefaultCoverage()
    payloadRecord._execution = execution
    if (options?.ui !== undefined) {
      payloadRecord._ui = options.ui
    }
    if (options?.pipes !== undefined) {
      payloadRecord.pipes_handoff = options.pipes
    }

    if (notices.length === 1) {
      payloadRecord._notice = notices[0]
    } else if (notices.length > 1) {
      payloadRecord._notices = notices
    }

    const answer = buildChatAnswer(payloadRecord)
    const display = buildDisplay(payloadRecord)
    const nextSteps = buildNextSteps(payloadRecord) ?? { actions: [] }
    if (answer) payloadRecord.answer = answer
    if (display) payloadRecord.display = display
    payloadRecord.next_steps = nextSteps

    payloadRecord.investigation = buildInvestigationGuide(payloadRecord)
    payloadRecord._llm = buildLlmHints(payloadRecord, options?.llm)

    const orderedPayload: Record<string, unknown> = {}

    if (answer) {
      orderedPayload.answer = answer
    }
    if (display) {
      orderedPayload.display = display
    }
    if (nextSteps) {
      orderedPayload.next_steps = nextSteps
    }

    for (const [key, value] of Object.entries(payloadRecord)) {
      if (key.startsWith('_')) continue
      orderedPayload[key] = value
    }

    for (const [key, value] of Object.entries(payloadRecord)) {
      if (!key.startsWith('_')) continue
      orderedPayload[key] = value
    }

    responsePayload = orderedPayload
  }

  try {
    jsonString = JSON.stringify(responsePayload, null, 2)
  } catch {
    try {
      jsonString = JSON.stringify(responsePayload)
    } catch {
      return {
        content: [{ type: 'text', text: 'Error: Unable to serialize response.' }],
      }
    }
  }

  return { content: [{ type: 'text', text: jsonString }] }
}

/**
 * Format result with automatic array truncation
 */
export function formatResultWithLimit(
  data: unknown,
  message: string,
  limit: number,
): { content: Array<{ type: 'text'; text: string }> } {
  return formatResult(data, message, { maxItems: limit, warnOnTruncation: true })
}
