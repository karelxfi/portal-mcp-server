// Timeframe parsing for ergonomic queries
// Converts "24h", "7d" etc. into block numbers using Portal's /timestamps/ API
// Falls back to per-chain block time estimation when the endpoint is unavailable.

import { getBlockHead } from '../cache/datasets.js'
import { PORTAL_URL } from '../constants/index.js'
import { detectChainType } from './chain.js'
import { ActionableError } from './errors.js'
import { formatTimestamp } from './formatting.js'
import { portalFetch, portalFetchStream } from './fetch.js'

export type Timeframe = '1h' | '6h' | '12h' | '24h' | '3d' | '7d' | '14d' | '30d'
export type TimestampInput = string | number

// ---------------------------------------------------------------------------
// Block time estimates
// ---------------------------------------------------------------------------

/**
 * Block time estimates (seconds) by chain type — used as fallback when
 * the /timestamps/ endpoint fails or is known to be down.
 */
const BLOCK_TIME_ESTIMATES: Record<string, number> = {
  evm: 12, // Ethereum mainnet default (~12s)
  solana: 0.4, // Solana slots (~400ms)
  bitcoin: 600, // Bitcoin (~10 min)
  substrate: 6, // Polkadot-family default (~6s)
  hyperliquidFills: 0.083, // ~12 blocks/second
  hyperliquidReplicaCmds: 0.083,
}

/**
 * More specific block time estimates for known fast chains.
 * Checked by dataset name prefix before falling back to chain-type defaults.
 */
const DATASET_BLOCK_TIMES: Record<string, number> = {
  'base-': 2,
  'monad-': 0.4,
  'optimism-': 2,
  'arbitrum-': 0.25,
  'polygon-': 2,
  'bsc-': 3,
  'avalanche-': 2,
  'fantom-': 1,
  'gnosis-': 5,
  'zksync-': 1,
  'linea-': 2,
  'scroll-': 3,
  'blast-': 2,
  'mantle-': 2,
  'mode-': 2,
  'zora-': 2,
  'celo-': 5,
  'polkadot': 6,
  'kusama': 6,
  'westend': 6,
  'rococo': 6,
  'asset-hub-polkadot': 6,
  'asset-hub-kusama': 6,
  'people-chain': 6,
  'moonbeam-substrate': 12,
  'moonriver-substrate': 12,
  'moonbase-substrate': 12,
  'astar-substrate': 12,
  'shiden-substrate': 12,
  'shibuya-substrate': 12,
}

export type ParsedTimestampInput = {
  timestamp: number
  source: 'unix_seconds' | 'unix_milliseconds' | 'iso_datetime' | 'relative' | 'keyword'
  normalized_input: string
}

export interface BlockAtTimestampResult extends ParsedTimestampInput {
  block_number: number
  dataset: string
  resolution: 'exact' | 'estimated'
  timestamp_human: string
  head_block_number?: number
  head_timestamp?: number
  head_timestamp_human?: string
  estimated_block_time_seconds?: number
}

export interface ResolvedBlockWindow {
  from_block: number
  to_block: number
  range_kind: 'timeframe' | 'block_range' | 'timestamp_range'
  from_lookup?: BlockAtTimestampResult
  to_lookup?: BlockAtTimestampResult
}

export function estimateBlockTime(dataset: string, chainType: string): number {
  const lower = dataset.toLowerCase()
  for (const [prefix, blockTime] of Object.entries(DATASET_BLOCK_TIMES)) {
    if (lower.startsWith(prefix)) return blockTime
  }
  return BLOCK_TIME_ESTIMATES[chainType] ?? 12
}

function estimateFromBlock(latestBlock: number, seconds: number, dataset: string, chainType: string) {
  const blockTime = estimateBlockTime(dataset, chainType)
  const blockCount = Math.floor(seconds / blockTime)
  return {
    from_block: Math.max(0, latestBlock - blockCount + 1),
    to_block: latestBlock,
  }
}

// ---------------------------------------------------------------------------
// Timestamp endpoint failure cache
// ---------------------------------------------------------------------------
// The Portal /timestamps/ endpoint can lag ~1-2h behind the chain head.
// When it fails for a dataset, we cache that failure to skip the attempt
// entirely on subsequent calls (avoiding wasted retries + timeout).

const TIMESTAMP_FAILURE_TTL = 5 * 60 * 1000 // 5 minutes
const timestampFailures = new Map<string, number>() // dataset → failure timestamp

function isTimestampEndpointDown(dataset: string): boolean {
  const failedAt = timestampFailures.get(dataset)
  if (!failedAt) return false
  if (Date.now() - failedAt > TIMESTAMP_FAILURE_TTL) {
    timestampFailures.delete(dataset)
    return false
  }
  return true
}

function markTimestampEndpointDown(dataset: string): void {
  timestampFailures.set(dataset, Date.now())
}

function markTimestampEndpointUp(dataset: string): void {
  timestampFailures.delete(dataset)
}

// ---------------------------------------------------------------------------
// Timeframe parsing
// ---------------------------------------------------------------------------

/**
 * Parse timeframe string to seconds
 */
export function parseTimeframeToSeconds(timeframe: string): number {
  const parsed = parseNaturalDuration(timeframe)
  if (!parsed) {
    throw new Error(
      `Invalid timeframe format: ${timeframe}. Use compact durations like "30m", "1h", "24h", or natural phrases like "past 30 minutes", "in the past 1h", or "in last 38 mins".`,
    )
  }

  return parsed.seconds
}

type ParsedDuration = {
  seconds: number
  canonical: string
}

type DurationUnitInfo = {
  seconds: number
  canonical: 's' | 'm' | 'h' | 'd' | 'w' | 'mo' | 'y'
}

const DURATION_UNITS: Record<string, DurationUnitInfo> = {
  s: { seconds: 1, canonical: 's' },
  sec: { seconds: 1, canonical: 's' },
  secs: { seconds: 1, canonical: 's' },
  second: { seconds: 1, canonical: 's' },
  seconds: { seconds: 1, canonical: 's' },
  m: { seconds: 60, canonical: 'm' },
  min: { seconds: 60, canonical: 'm' },
  mins: { seconds: 60, canonical: 'm' },
  minute: { seconds: 60, canonical: 'm' },
  minutes: { seconds: 60, canonical: 'm' },
  h: { seconds: 3600, canonical: 'h' },
  hr: { seconds: 3600, canonical: 'h' },
  hrs: { seconds: 3600, canonical: 'h' },
  hour: { seconds: 3600, canonical: 'h' },
  hours: { seconds: 3600, canonical: 'h' },
  d: { seconds: 86400, canonical: 'd' },
  day: { seconds: 86400, canonical: 'd' },
  days: { seconds: 86400, canonical: 'd' },
  w: { seconds: 604800, canonical: 'w' },
  wk: { seconds: 604800, canonical: 'w' },
  wks: { seconds: 604800, canonical: 'w' },
  week: { seconds: 604800, canonical: 'w' },
  weeks: { seconds: 604800, canonical: 'w' },
  mo: { seconds: 2592000, canonical: 'mo' },
  mos: { seconds: 2592000, canonical: 'mo' },
  month: { seconds: 2592000, canonical: 'mo' },
  months: { seconds: 2592000, canonical: 'mo' },
  y: { seconds: 31536000, canonical: 'y' },
  yr: { seconds: 31536000, canonical: 'y' },
  yrs: { seconds: 31536000, canonical: 'y' },
  year: { seconds: 31536000, canonical: 'y' },
  years: { seconds: 31536000, canonical: 'y' },
}

function normalizeDurationText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[,_]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
}

function getDurationExpression(input: string): string {
  let normalized = normalizeDurationText(input)

  const rangeMatch = normalized.match(
    /\b(?:past|last|previous)\s+((?:\d+(?:\.\d+)?|a|an|one|half)(?:\s+an?)?\s*[a-z.]+|[a-z.]+)\b/,
  )
  if (rangeMatch) {
    return rangeMatch[1]
  }

  normalized = normalized
    .replace(/\s+ago$/, '')
    .replace(/^(?:for|over|during|within)\s+(?:the\s+)?/, '')
    .replace(/^the\s+/, '')

  return normalized
}

function parseDurationValue(valueText: string): number {
  switch (valueText) {
    case 'a':
    case 'an':
    case 'one':
      return 1
    case 'half':
      return 0.5
    default:
      return Number(valueText)
  }
}

function formatCanonicalDuration(seconds: number, fallbackUnit: DurationUnitInfo['canonical']): string {
  const units: Array<[DurationUnitInfo['canonical'], number]> = [
    ['y', 31536000],
    ['mo', 2592000],
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ]

  const exact = units.find(([, unitSeconds]) => seconds % unitSeconds === 0)
  if (exact) return `${seconds / exact[1]}${exact[0]}`

  const fallbackSeconds = Object.values(DURATION_UNITS).find((unit) => unit.canonical === fallbackUnit)?.seconds ?? 1
  const value = seconds / fallbackSeconds
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}${fallbackUnit}`
}

function parseNaturalDuration(input: string): ParsedDuration | undefined {
  const expression = getDurationExpression(input)
  const durationMatch = expression.match(
    /^(?:(\d+(?:\.\d+)?)|(a|an|one|half))?(?:\s+an?)?\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?|mo|mos|months?|y|yrs?|years?)\.?$/,
  )
  if (!durationMatch) {
    return undefined
  }

  const value = parseDurationValue(durationMatch[1] ?? durationMatch[2] ?? '1')
  const unit = DURATION_UNITS[durationMatch[3]]
  if (!Number.isFinite(value) || value <= 0 || !unit) {
    return undefined
  }

  const seconds = Math.max(1, Math.round(value * unit.seconds))
  return {
    seconds,
    canonical: formatCanonicalDuration(seconds, unit.canonical),
  }
}

// ---------------------------------------------------------------------------
// Timestamp-to-block conversion
// ---------------------------------------------------------------------------

/** Timeout for the /timestamps/ endpoint — fast-fail since we have a fallback. */
const TIMESTAMP_TIMEOUT = 3000

/**
 * Convert a Unix timestamp to a block number using Portal's /timestamps/ endpoint.
 * Works for supported Portal datasets, including real-time datasets that expose
 * timestamp lookups.
 *
 * Uses a short timeout and zero retries — the caller should fall back to
 * block time estimation on failure.
 */
export async function timestampToBlock(dataset: string, timestamp: number): Promise<number> {
  const result = await portalFetch<{ block_number: number }>(
    `${PORTAL_URL}/datasets/${dataset}/timestamps/${Math.floor(timestamp)}/block`,
    { timeout: TIMESTAMP_TIMEOUT, retries: 0 },
  )
  return result.block_number
}

/**
 * Get the head block's timestamp by querying Portal for the actual block data.
 */
export async function getHeadTimestamp(dataset: string, headBlock: number): Promise<number> {
  const chainType = detectChainType(dataset)

  // Determine the query type and field key based on chain type
  let type: string
  let fieldKey: string
  switch (chainType) {
    case 'solana':
      type = 'solana'
      fieldKey = 'block'
      break
    case 'bitcoin':
      type = 'bitcoin'
      fieldKey = 'block'
      break
    case 'substrate':
      type = 'substrate'
      fieldKey = 'block'
      break
    case 'hyperliquidFills':
      type = 'hyperliquidFills'
      fieldKey = 'block'
      break
    case 'hyperliquidReplicaCmds':
      type = 'hyperliquidReplicaCmds'
      fieldKey = 'block'
      break
    default:
      type = 'evm'
      fieldKey = 'block'
  }

  const query = {
    type,
    fromBlock: headBlock,
    toBlock: headBlock,
    includeAllBlocks: true,
    fields: {
      [fieldKey]: {
        number: true,
        timestamp: true,
      },
    },
  }

  const response = await portalFetchStream(
    `${PORTAL_URL}/datasets/${dataset}/stream`,
    query,
    TIMESTAMP_TIMEOUT,
  )

  if (!response || response.length === 0) {
    throw new Error(`Could not get timestamp for head block ${headBlock}`)
  }

  const block = (response[0] as any).header || response[0]
  const timestamp = Number(block.timestamp)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error(`Could not parse timestamp for head block ${headBlock}`)
  }
  return timestamp > 1_000_000_000_000 ? Math.floor(timestamp / 1000) : Math.floor(timestamp)
}

function parseRelativeTimestamp(input: string, nowUnix: number): ParsedTimestampInput | undefined {
  const normalized = input.trim().toLowerCase()

  if (normalized === 'now') {
    return {
      timestamp: nowUnix,
      source: 'keyword',
      normalized_input: 'now',
    }
  }

  if (normalized === 'today') {
    const now = new Date(nowUnix * 1000)
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000
    return {
      timestamp: today,
      source: 'keyword',
      normalized_input: 'today',
    }
  }

  if (normalized === 'yesterday') {
    const now = new Date(nowUnix * 1000)
    const yesterday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000 - 86400
    return {
      timestamp: yesterday,
      source: 'keyword',
      normalized_input: 'yesterday',
    }
  }

  const dayTimeMatch = normalized.match(/^(today|yesterday)\s+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/)
  if (dayTimeMatch) {
    const [, keyword, hourText, minuteText = '0', secondText = '0'] = dayTimeMatch
    const hour = parseInt(hourText, 10)
    const minute = parseInt(minuteText, 10)
    const second = parseInt(secondText, 10)

    if (hour > 23 || minute > 59 || second > 59) {
      throw new Error(`Invalid time in timestamp input: ${input}. Use HH:MM or HH:MM:SS in 24-hour format.`)
    }

    const now = new Date(nowUnix * 1000)
    const dayOffset = keyword === 'yesterday' ? 86400 : 0
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000 - dayOffset

    return {
      timestamp: dayStart + hour * 3600 + minute * 60 + second,
      source: 'keyword',
      normalized_input: `${keyword} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`,
    }
  }

  const duration = parseNaturalDuration(normalized)
  if (!duration) {
    return undefined
  }

  return {
    timestamp: Math.max(0, nowUnix - duration.seconds),
    source: 'relative',
    normalized_input: `${duration.canonical} ago`,
  }
}

export function parseTimestampInput(input: string | number, nowUnix: number = Math.floor(Date.now() / 1000)): ParsedTimestampInput {
  if (typeof input === 'number' && Number.isFinite(input)) {
    const timestamp = input > 1_000_000_000_000 ? Math.floor(input / 1000) : Math.floor(input)
    return {
      timestamp,
      source: input > 1_000_000_000_000 ? 'unix_milliseconds' : 'unix_seconds',
      normalized_input: String(input),
    }
  }

  const trimmed = String(input).trim()
  if (!trimmed) {
    throw new Error('Timestamp cannot be empty. Use a Unix timestamp, ISO datetime, or relative input like "1h ago".')
  }

  if (/^\d+$/.test(trimmed)) {
    const numericValue = Number(trimmed)
    if (!Number.isFinite(numericValue)) {
      throw new Error(`Invalid numeric timestamp: ${trimmed}`)
    }
    const timestamp = numericValue > 1_000_000_000_000 ? Math.floor(numericValue / 1000) : Math.floor(numericValue)
    return {
      timestamp,
      source: numericValue > 1_000_000_000_000 ? 'unix_milliseconds' : 'unix_seconds',
      normalized_input: trimmed,
    }
  }

  const relative = parseRelativeTimestamp(trimmed, nowUnix)
  if (relative) {
    return relative
  }

  const parsedDate = Date.parse(trimmed)
  if (!Number.isNaN(parsedDate)) {
    return {
      timestamp: Math.floor(parsedDate / 1000),
      source: 'iso_datetime',
      normalized_input: new Date(parsedDate).toISOString(),
    }
  }

  throw new Error(
    `Invalid timestamp input: ${trimmed}. Use Unix seconds, Unix milliseconds, ISO datetime, or relative input like "1h ago", "past 30 minutes", "in the past 1h", or "in last 38 mins".`,
  )
}

export function describeTimeWindowInput(input: string): string {
  const trimmed = input.trim()
  const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ')

  const inPastMatch = normalized.match(/^in\s+(?:the\s+)?past\s+(.+)$/)
  if (inPastMatch) return `the past ${inPastMatch[1]}`

  const inLastMatch = normalized.match(/^in\s+last\s+(.+)$/)
  if (inLastMatch) return `the last ${inLastMatch[1]}`

  const inPreviousMatch = normalized.match(/^in\s+(?:the\s+)?previous\s+(.+)$/)
  if (inPreviousMatch) return `the previous ${inPreviousMatch[1]}`

  if (/^(?:past|last|previous)\s+/.test(normalized)) return `the ${trimmed}`

  return `last ${trimmed}`
}

export async function resolveBlockAtTimestamp(dataset: string, input: string | number): Promise<BlockAtTimestampResult> {
  const parsed = parseTimestampInput(input)

  try {
    const blockNumber = await timestampToBlock(dataset, parsed.timestamp)
    return {
      ...parsed,
      block_number: blockNumber,
      dataset,
      resolution: 'exact',
      timestamp_human: formatTimestamp(parsed.timestamp),
    }
  } catch {
    const head = await getBlockHead(dataset)
    const headTimestamp = await getHeadTimestamp(dataset, head.number)
    const chainType = detectChainType(dataset)
    const estimatedBlockTimeSeconds = estimateBlockTime(dataset, chainType)
    const deltaSeconds = Math.max(0, headTimestamp - parsed.timestamp)
    const estimatedOffset = Math.round(deltaSeconds / estimatedBlockTimeSeconds)
    const estimatedBlockNumber = parsed.timestamp >= headTimestamp ? head.number : Math.max(0, head.number - estimatedOffset)

    return {
      ...parsed,
      block_number: estimatedBlockNumber,
      dataset,
      resolution: 'estimated',
      timestamp_human: formatTimestamp(parsed.timestamp),
      head_block_number: head.number,
      head_timestamp: headTimestamp,
      head_timestamp_human: formatTimestamp(headTimestamp),
      estimated_block_time_seconds: estimatedBlockTimeSeconds,
    }
  }
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve timeframe to from_block/to_block.
 *
 * Strategy:
 * 1. Datasets without /timestamps/ support → estimate
 * 2. Cached failure for this dataset → estimate (avoid known-broken endpoint)
 * 3. Otherwise → fetch the indexed head timestamp, subtract the timeframe,
 *    and resolve that target through /timestamps/.
 *    - On success → return accurate block range
 *    - On failure → cache failure for 5 min, return estimated range
 */
export async function resolveTimeframeOrBlocks(params: {
  dataset: string
  timeframe?: string
  from_block?: number
  to_block?: number
  from_timestamp?: TimestampInput
  to_timestamp?: TimestampInput
}): Promise<ResolvedBlockWindow> {
  const { dataset, timeframe, from_block, to_block, from_timestamp, to_timestamp } = params
  const hasTimestampWindow = from_timestamp !== undefined || to_timestamp !== undefined
  const hasBlockWindow = from_block !== undefined || to_block !== undefined

  if (hasTimestampWindow && (timeframe || hasBlockWindow)) {
    throw new ActionableError(
      "Use either timeframe, block numbers, or timestamps for the query window.",
      [
        "Use timeframe for relative presets like '1h', 'past 30 minutes', or 'in last 38 mins'.",
        "Use from_block/to_block for exact block windows.",
        "Use from_timestamp/to_timestamp for natural time windows like '1h ago', 'past 30 minutes', or ISO datetimes.",
      ],
      {
        timeframe,
        from_block,
        to_block,
        from_timestamp,
        to_timestamp,
      },
    )
  }

  if (timeframe) {
    const head = await getBlockHead(dataset)
    const latestBlock = head.number
    const chainType = detectChainType(dataset)
    const seconds = parseTimeframeToSeconds(timeframe)

    const useEstimation =
      chainType === 'hyperliquidReplicaCmds' ||
      isTimestampEndpointDown(dataset)

    if (useEstimation) {
      return {
        ...estimateFromBlock(latestBlock, seconds, dataset, chainType),
        range_kind: 'timeframe',
      }
    }

    // Real-time datasets expose head block timestamps, so anchor relative
    // windows to the latest indexed block instead of wall-clock time.
    try {
      const headTimestamp = await getHeadTimestamp(dataset, latestBlock)
      const targetTimestamp = Math.max(0, headTimestamp - seconds)
      const fromBlock = await timestampToBlock(dataset, targetTimestamp)
      markTimestampEndpointUp(dataset)
      return {
        from_block: Math.min(fromBlock, latestBlock),
        to_block: latestBlock,
        range_kind: 'timeframe',
        from_lookup: {
          timestamp: targetTimestamp,
          source: 'relative',
          normalized_input: `${timeframe} before indexed head`,
          block_number: Math.min(fromBlock, latestBlock),
          dataset,
          resolution: 'exact',
          timestamp_human: formatTimestamp(targetTimestamp),
          head_block_number: latestBlock,
          head_timestamp: headTimestamp,
          head_timestamp_human: formatTimestamp(headTimestamp),
        },
      }
    } catch {
      // Cache the failure so subsequent calls skip straight to estimation
      markTimestampEndpointDown(dataset)
      return {
        ...estimateFromBlock(latestBlock, seconds, dataset, chainType),
        range_kind: 'timeframe',
      }
    }
  } else if (hasTimestampWindow) {
    const [resolvedFrom, resolvedTo] = await Promise.all([
      from_timestamp !== undefined ? resolveBlockAtTimestamp(dataset, from_timestamp) : Promise.resolve(undefined),
      to_timestamp !== undefined ? resolveBlockAtTimestamp(dataset, to_timestamp) : Promise.resolve(undefined),
    ])

    const head = resolvedTo ? undefined : await getBlockHead(dataset)
    const resolvedFromBlock = resolvedFrom?.block_number ?? resolvedTo?.block_number
    const resolvedToBlock = resolvedTo?.block_number ?? head?.number

    if (resolvedFromBlock === undefined || resolvedToBlock === undefined) {
      throw new Error('Could not resolve timestamp window to block numbers.')
    }

    if (resolvedFromBlock > resolvedToBlock) {
      throw new ActionableError(
        'from_timestamp resolves after to_timestamp.',
        [
          'Swap the timestamps so from_timestamp is earlier than to_timestamp.',
          'Use portal_debug_resolve_time_to_block first if you want to inspect the resolved block numbers.',
        ],
        {
          from_timestamp: resolvedFrom?.normalized_input ?? from_timestamp,
          to_timestamp: resolvedTo?.normalized_input ?? to_timestamp,
          from_block: resolvedFromBlock,
          to_block: resolvedToBlock,
        },
      )
    }

    return {
      from_block: resolvedFromBlock,
      to_block: resolvedToBlock,
      range_kind: 'timestamp_range',
      ...(resolvedFrom ? { from_lookup: resolvedFrom } : {}),
      ...(resolvedTo ? { to_lookup: resolvedTo } : {}),
    }
  } else if (from_block !== undefined) {
    return {
      from_block,
      to_block: to_block || from_block + 1000,
      range_kind: 'block_range',
    }
  }

  throw new Error("Provide timeframe, from_block, or from_timestamp/to_timestamp to define the query window.")
}

export function getTimestampWindowNotices(window: unknown): string[] {
  const notices: string[] = []
  const typedWindow = (window && typeof window === 'object' ? window : {}) as {
    from_lookup?: BlockAtTimestampResult
    to_lookup?: BlockAtTimestampResult
  }

  if (typedWindow.from_lookup?.resolution === 'estimated') {
    notices.push(
      `from_timestamp (${typedWindow.from_lookup.timestamp_human}) was estimated from the latest indexed block because the exact boundary is not indexed yet.`,
    )
  }

  if (typedWindow.to_lookup?.resolution === 'estimated') {
    notices.push(
      `to_timestamp (${typedWindow.to_lookup.timestamp_human}) was estimated from the latest indexed block because the exact boundary is not indexed yet.`,
    )
  }

  return notices
}

/**
 * Convert timeframe to approximate block count using per-chain block time estimates.
 *
 * @deprecated Use resolveTimeframeOrBlocks() instead for accurate conversion.
 */
export function timeframeToBlocks(timeframe: string, dataset: string): number {
  const seconds = parseTimeframeToSeconds(timeframe)
  const chainType = detectChainType(dataset)
  const blockTime = estimateBlockTime(dataset, chainType)
  return Math.floor(seconds / blockTime)
}

/**
 * Get examples for tool descriptions
 */
export function getTimeframeExamples(): string {
  return `
TIMEFRAME EXAMPLES:
  - "24h" = last 24 hours
  - "7d" = last 7 days
  - "1h" = last hour
  - "past 30 minutes" = last 30 minutes
  - "in the past 1h" = last hour
  - "in last 38 mins" = last 38 minutes

Supported: compact forms like 30m/1h/7d and natural phrases like "past 30 minutes", "last hour", and "in last 38 mins"`
}
