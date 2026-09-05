import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { resolveDataset, validateBlockRange } from '../../cache/datasets.js'
import { type ChartTooltipDescriptor, buildCandlestickChart, buildOhlcTable } from '../../helpers/chart-metadata.js'
import {
  EXACT_DECIMAL_ZERO,
  type ExactDecimal,
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  formatExactDecimal,
  multiplyExactDecimals,
  parseExactDecimal,
} from '../../helpers/exact-decimal.js'
import { formatResult, formatTimestamp } from '../../helpers/format.js'
import { registerPortalTool } from '../../helpers/mcp-registration.js'
import { buildPaginationInfo, decodeCursor, encodeCursor } from '../../helpers/pagination.js'
import {
  buildBucketCoverage,
  buildBucketGapDiagnostics,
  buildChronologicalPageOrdering,
  buildQueryFreshness,
} from '../../helpers/result-metadata.js'
import {
  type TimestampInput,
  describeTimeWindowInput,
  estimateBlockTime,
  getHeadTimestamp,
  getTimestampWindowNotices,
  parseTimeframeToSeconds,
  resolveTimeframeOrBlocks,
} from '../../helpers/timeframe.js'
import { buildExecutionMetadata, buildToolDescription } from '../../helpers/tool-ux.js'
import { buildChartPanel, buildMetricCard, buildPortalUi, buildTablePanel } from '../../helpers/ui-metadata.js'
import { quoteUntrusted, untrustedLabel } from '../../helpers/untrusted-text.js'
import { assertHyperliquidDataset, normalizeHyperliquidAddress } from './dataset-guard.js'
import { visitHyperliquidFillBlocks } from './fill-stream.js'

type OhlcDuration = '1h' | '6h' | '12h' | '24h' | '7d' | '30d'
type OhlcInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '6h' | '1d'
type OhlcIntervalInput = OhlcInterval | 'auto'

export type HyperliquidFill = Record<string, unknown> & {
  time?: number | string
  fillIndex?: number | string
  px?: number | string
  sz?: number | string
}

type CandleAccumulator = {
  open: ExactDecimal | null
  open_order: HyperliquidOhlcFillOrder | null
  high: ExactDecimal | null
  low: ExactDecimal | null
  close: ExactDecimal | null
  close_order: HyperliquidOhlcFillOrder | null
  volume: ExactDecimal
  base_volume: ExactDecimal
  fill_count: number
  notional_sum: ExactDecimal
}

export type HyperliquidOhlcFillOrder = {
  time_milliseconds: number
  fill_index: number
  block_number: number
  position_in_block: number
  stable_identity: string
}

type HyperliquidOhlcCursor = {
  tool: 'portal_hyperliquid_get_ohlc'
  dataset: string
  request: {
    coin: string
    interval: OhlcIntervalInput
    duration: string
    from_timestamp?: number
    to_timestamp?: number
    user?: string
  }
  window_start_timestamp: number
  window_end_exclusive: number
}

const AUTO_INTERVAL_BY_DURATION: Record<OhlcDuration, OhlcInterval> = {
  '1h': '5m',
  '6h': '15m',
  '12h': '30m',
  '24h': '1h',
  '7d': '6h',
  '30d': '1d',
}

function getFillIndex(fill: HyperliquidFill): number {
  if (typeof fill.fillIndex === 'number' && Number.isFinite(fill.fillIndex)) {
    return fill.fillIndex
  }

  if (typeof fill.fillIndex === 'string') {
    const parsed = Number(fill.fillIndex)
    if (Number.isFinite(parsed)) return parsed
  }

  return 0
}

function toMilliseconds(timestamp: number | string | undefined): number {
  const numeric = Number(timestamp ?? 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  if (numeric > 1e12) return Math.floor(numeric)
  return Math.floor(numeric * 1000)
}

function toSeconds(timestamp: number | string | undefined): number {
  const milliseconds = toMilliseconds(timestamp)
  return milliseconds > 0 ? Math.floor(milliseconds / 1000) : 0
}

function getStableFillIdentity(fill: HyperliquidFill): string {
  return ['hash', 'tid', 'oid', 'user', 'coin', 'dir', 'side', 'px', 'sz', 'fee', 'feeToken']
    .map((key) => `${key}:${String(fill[key] ?? '')}`)
    .join('|')
}

export function sortHyperliquidFillsForOhlc(fills: HyperliquidFill[]): HyperliquidFill[] {
  return fills.slice().sort((left, right) => {
    const leftTime = toMilliseconds(left.time)
    const rightTime = toMilliseconds(right.time)
    if (leftTime !== rightTime) return leftTime - rightTime

    const leftIndex = getFillIndex(left)
    const rightIndex = getFillIndex(right)
    if (leftIndex !== rightIndex) return leftIndex - rightIndex

    return getStableFillIdentity(left).localeCompare(getStableFillIdentity(right))
  })
}

export function compareHyperliquidOhlcFillOrder(
  left: HyperliquidOhlcFillOrder,
  right: HyperliquidOhlcFillOrder,
): number {
  return (
    left.time_milliseconds - right.time_milliseconds ||
    left.fill_index - right.fill_index ||
    left.block_number - right.block_number ||
    left.position_in_block - right.position_in_block ||
    left.stable_identity.localeCompare(right.stable_identity)
  )
}

function getOrCreateBucket(buckets: Map<number, CandleAccumulator>, bucketTimestamp: number): CandleAccumulator {
  let bucket = buckets.get(bucketTimestamp)
  if (!bucket) {
    bucket = {
      open: null,
      open_order: null,
      high: null,
      low: null,
      close: null,
      close_order: null,
      volume: EXACT_DECIMAL_ZERO,
      base_volume: EXACT_DECIMAL_ZERO,
      fill_count: 0,
      notional_sum: EXACT_DECIMAL_ZERO,
    }
    buckets.set(bucketTimestamp, bucket)
  }
  return bucket
}

function resolveOhlcInterval(duration: string, requestedInterval: OhlcIntervalInput): OhlcInterval {
  if (requestedInterval !== 'auto') return requestedInterval

  const presetInterval = AUTO_INTERVAL_BY_DURATION[duration as OhlcDuration]
  if (presetInterval) return presetInterval

  const durationSeconds = parseTimeframeToSeconds(duration)
  if (durationSeconds <= 3600) return '5m'
  if (durationSeconds <= 21600) return '15m'
  if (durationSeconds <= 43200) return '30m'
  if (durationSeconds <= 86400) return '1h'
  if (durationSeconds <= 604800) return '6h'
  return '1d'
}

export function registerHyperliquidOhlcTool(server: McpServer) {
  registerPortalTool(
    server,
    'portal_hyperliquid_get_ohlc',
    buildToolDescription('portal_hyperliquid_get_ohlc'),
    {
      network: z
        .string()
        .optional()
        .default('hyperliquid-fills')
        .describe("Network name (default: 'hyperliquid-fills')"),
      coin: z
        .string()
        .optional()
        .describe(
          'Asset symbol to build candles for (for example: "BTC", "ETH", "SOL"). Optional when continuing with cursor.',
        ),
      interval: z
        .enum(['auto', '1m', '5m', '15m', '30m', '1h', '4h', '6h', '1d'])
        .optional()
        .default('auto')
        .describe('Candle interval. Use auto for chart-friendly defaults: 1h→5m, 6h→15m, 12h→30m, 24h→1h.'),
      duration: z
        .string()
        .optional()
        .describe(
          'How much recent trading history to cover when exact timestamps are omitted. Defaults to "1h". Accepts compact durations like "1h" or natural phrases like "past 30 minutes".',
        ),
      from_timestamp: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          'Exact candle-window start. Use together with to_timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input.',
        ),
      to_timestamp: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          'Exact inclusive candle-window end. Use together with from_timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input.',
        ),
      user: z.string().optional().describe('Optional trader wallet address (0x-prefixed, lowercase)'),
      cursor: z.string().optional().describe('Continuation cursor from a previous candle page'),
    },
    async ({ network, coin, interval, duration, from_timestamp, to_timestamp, user, cursor }) => {
      const queryStartTime = Date.now()
      const paginationCursor = cursor
        ? decodeCursor<HyperliquidOhlcCursor>(cursor, 'portal_hyperliquid_get_ohlc')
        : undefined
      const requestedDataset = cursor
        ? network
          ? await resolveDataset(network)
          : undefined
        : await resolveDataset(network)
      const effectiveDataset = paginationCursor?.dataset ?? requestedDataset
      if (!effectiveDataset) {
        throw new Error('network is required unless you are continuing with cursor')
      }
      let dataset = effectiveDataset
      assertHyperliquidDataset('portal_hyperliquid_get_ohlc', dataset, 'hyperliquidFills')
      if (user !== undefined) normalizeHyperliquidAddress(user)
      if (paginationCursor && requestedDataset && requestedDataset !== paginationCursor.dataset) {
        throw new Error(
          'This cursor belongs to a different network. Reuse the same network or omit cursor to start a fresh candle window.',
        )
      }

      coin = paginationCursor?.request.coin ?? coin
      interval = paginationCursor?.request.interval ?? interval
      duration = paginationCursor?.request.duration ?? duration ?? '1h'
      from_timestamp = paginationCursor?.request.from_timestamp ?? from_timestamp
      to_timestamp = paginationCursor?.request.to_timestamp ?? to_timestamp
      user = paginationCursor?.request.user ?? user
      if (!coin) {
        throw new Error('coin is required unless you are continuing with cursor')
      }

      const resolvedInterval = resolveOhlcInterval(duration, interval as OhlcIntervalInput)

      const intervalSeconds = parseTimeframeToSeconds(resolvedInterval)
      let durationSeconds = parseTimeframeToSeconds(duration)
      let expectedBuckets = Math.max(1, Math.ceil(durationSeconds / intervalSeconds))
      const exactTimestampWindowRequested = from_timestamp !== undefined || to_timestamp !== undefined
      if (
        !paginationCursor &&
        exactTimestampWindowRequested &&
        (from_timestamp === undefined || to_timestamp === undefined)
      ) {
        throw new Error('Provide both from_timestamp and to_timestamp for an exact Hyperliquid OHLC window.')
      }
      const buckets = new Map<number, CandleAccumulator>()
      let latestTimestamp = 0
      let earliestObservedBelowPageEnd = Number.MAX_SAFE_INTEGER
      let earliestObservedBlock = Number.MAX_SAFE_INTEGER
      let totalFills = 0
      let chunksFetched = 0
      let chunkSizeReduced = false
      let scannedFromBlock = 0
      let seriesStartTimestamp = 0
      let seriesEndExclusive = 0
      let requestedWindowStartTimestamp = 0
      let requestedWindowEndExclusive = 0
      let indexedEvidenceEndExclusive = 0
      let initialScanCoversSeriesStart = false
      let seriesAnchor: 'requested_timestamp_window' | 'indexed_head' | 'latest_fill' = 'latest_fill'
      let indexedHeadTimestamp: number | undefined
      let resolvedWindow
      let endBlock = 0
      let head

      const fillFilter: Record<string, unknown> = {
        coin: [coin],
        ...(user ? { user: [user.toLowerCase()] } : {}),
      }
      const fillFields = {
        time: true,
        fillIndex: true,
        px: true,
        sz: true,
      }

      const accumulateRange = async (
        rangeFrom: number,
        rangeTo: number,
        options?: { pageEndExclusive?: number; pageStartTimestamp?: number },
      ) => {
        const result = await visitHyperliquidFillBlocks({
          dataset,
          fromBlock: rangeFrom,
          toBlock: rangeTo,
          fillFilter,
          fillFields,
          initialChunkSize: 100_000,
          minChunkSize: 10_000,
          maxBytes: 200 * 1024 * 1024,
          concurrency: 4,
          onBlock: (block) => {
            const blockNumber = typeof block.header?.number === 'number' ? block.header.number : undefined
            const fills = sortHyperliquidFillsForOhlc((block.fills || []) as HyperliquidFill[])
            for (let index = 0; index < fills.length; index += 1) {
              const fill = fills[index]
              const timestamp = toSeconds(fill.time)
              const order: HyperliquidOhlcFillOrder = {
                time_milliseconds: toMilliseconds(fill.time),
                fill_index: getFillIndex(fill),
                block_number: blockNumber ?? 0,
                position_in_block: index,
                stable_identity: getStableFillIdentity(fill),
              }
              const price = parseExactDecimal(fill.px)
              const size = parseExactDecimal(fill.sz)

              if (!timestamp || !price || !size || price.coefficient <= 0n || size.coefficient <= 0n) {
                continue
              }

              if (options?.pageEndExclusive !== undefined && timestamp >= options.pageEndExclusive) {
                continue
              }

              earliestObservedBelowPageEnd = Math.min(earliestObservedBelowPageEnd, timestamp)
              if (blockNumber !== undefined) {
                earliestObservedBlock = Math.min(earliestObservedBlock, blockNumber)
              }

              if (options?.pageStartTimestamp !== undefined && timestamp < options.pageStartTimestamp) {
                continue
              }

              latestTimestamp = Math.max(latestTimestamp, timestamp)
              totalFills += 1

              const bucketTimestamp = Math.floor(timestamp / intervalSeconds) * intervalSeconds
              const bucket = getOrCreateBucket(buckets, bucketTimestamp)
              const notional = multiplyExactDecimals(price, size)

              if (bucket.open_order === null || compareHyperliquidOhlcFillOrder(order, bucket.open_order) < 0) {
                bucket.open = price
                bucket.open_order = order
              }
              bucket.high = bucket.high === null || compareExactDecimals(price, bucket.high) > 0 ? price : bucket.high
              bucket.low = bucket.low === null || compareExactDecimals(price, bucket.low) < 0 ? price : bucket.low
              if (bucket.close_order === null || compareHyperliquidOhlcFillOrder(order, bucket.close_order) > 0) {
                bucket.close = price
                bucket.close_order = order
              }
              bucket.volume = addExactDecimals(bucket.volume, notional)
              bucket.base_volume = addExactDecimals(bucket.base_volume, size)
              bucket.fill_count += 1
              bucket.notional_sum = addExactDecimals(bucket.notional_sum, notional)
            }
          },
        })

        chunksFetched += result.chunksFetched
        chunkSizeReduced = chunkSizeReduced || result.chunkSizeReduced
      }

      if (paginationCursor) {
        seriesStartTimestamp = paginationCursor.window_start_timestamp
        seriesEndExclusive = paginationCursor.window_end_exclusive
        requestedWindowStartTimestamp = seriesStartTimestamp
        requestedWindowEndExclusive = seriesEndExclusive
        durationSeconds = Math.max(1, seriesEndExclusive - seriesStartTimestamp)
        expectedBuckets = Math.max(1, Math.ceil(durationSeconds / intervalSeconds))
        seriesAnchor = 'requested_timestamp_window'
        resolvedWindow = await resolveTimeframeOrBlocks({
          dataset,
          from_timestamp: seriesStartTimestamp,
          to_timestamp: Math.max(0, seriesEndExclusive - 1),
        })

        const estimatedBlocksPerSecond = 1 / estimateBlockTime(dataset, 'hyperliquidFills')
        const cushionBlocks = Math.max(25_000, Math.ceil(durationSeconds * estimatedBlocksPerSecond * 0.15))
        const rangeFrom = Math.max(0, resolvedWindow.from_block - cushionBlocks)
        const rangeTo = resolvedWindow.to_block + cushionBlocks

        const validated = await validateBlockRange(dataset, rangeFrom, rangeTo ?? Number.MAX_SAFE_INTEGER, false)
        endBlock = validated.validatedToBlock
        head = validated.head
        scannedFromBlock = rangeFrom
        indexedEvidenceEndExclusive = seriesEndExclusive
        initialScanCoversSeriesStart = true

        await accumulateRange(rangeFrom, endBlock, {
          pageStartTimestamp: requestedWindowStartTimestamp,
          pageEndExclusive: requestedWindowEndExclusive,
        })
      } else {
        resolvedWindow = await resolveTimeframeOrBlocks({
          dataset,
          ...(exactTimestampWindowRequested
            ? {
                from_timestamp: from_timestamp as TimestampInput,
                to_timestamp: to_timestamp as TimestampInput,
              }
            : { timeframe: duration }),
        })
        const fromBlock = resolvedWindow.from_block

        const validated = await validateBlockRange(
          dataset,
          fromBlock,
          resolvedWindow.to_block ?? Number.MAX_SAFE_INTEGER,
          false,
        )
        endBlock = validated.validatedToBlock
        head = validated.head
        scannedFromBlock = fromBlock

        indexedHeadTimestamp = resolvedWindow.from_lookup?.head_timestamp ?? resolvedWindow.to_lookup?.head_timestamp
        if (indexedHeadTimestamp === undefined) {
          try {
            indexedHeadTimestamp = await getHeadTimestamp(dataset, head.number, 2)
          } catch {
            indexedHeadTimestamp = undefined
          }
        }

        if (exactTimestampWindowRequested) {
          requestedWindowStartTimestamp = resolvedWindow.from_lookup?.timestamp ?? 0
          requestedWindowEndExclusive = (resolvedWindow.to_lookup?.timestamp ?? 0) + 1
          durationSeconds = Math.max(1, requestedWindowEndExclusive - requestedWindowStartTimestamp)
          seriesAnchor = 'requested_timestamp_window'
        } else if (indexedHeadTimestamp !== undefined) {
          requestedWindowEndExclusive = indexedHeadTimestamp + 1
          requestedWindowStartTimestamp = Math.max(0, requestedWindowEndExclusive - durationSeconds)
          seriesAnchor = 'indexed_head'
        }

        if (requestedWindowEndExclusive > requestedWindowStartTimestamp) {
          seriesStartTimestamp = Math.floor(requestedWindowStartTimestamp / intervalSeconds) * intervalSeconds
          seriesEndExclusive = Math.ceil(requestedWindowEndExclusive / intervalSeconds) * intervalSeconds
          expectedBuckets = Math.max(1, Math.ceil((seriesEndExclusive - seriesStartTimestamp) / intervalSeconds))
          indexedEvidenceEndExclusive = Math.min(
            requestedWindowEndExclusive,
            (indexedHeadTimestamp ?? requestedWindowEndExclusive - 1) + 1,
          )
        }
        initialScanCoversSeriesStart =
          resolvedWindow.from_lookup?.resolution === 'verified_boundary' &&
          resolvedWindow.from_lookup.timestamp <= requestedWindowStartTimestamp

        await accumulateRange(fromBlock, endBlock, {
          ...(requestedWindowStartTimestamp > 0 ? { pageStartTimestamp: requestedWindowStartTimestamp } : {}),
          ...(requestedWindowEndExclusive > 0 ? { pageEndExclusive: requestedWindowEndExclusive } : {}),
        })
      }

      if ((latestTimestamp === 0 || totalFills === 0) && seriesEndExclusive === 0) {
        throw new Error(
          `No Hyperliquid fills found for ${quoteUntrusted(coin)}${user ? ` and user ${user}` : ''} in the requested window`,
        )
      }

      if (!paginationCursor && seriesEndExclusive === 0) {
        seriesEndExclusive = Math.floor(latestTimestamp / intervalSeconds) * intervalSeconds + intervalSeconds
        const bucketSpanSeconds = expectedBuckets * intervalSeconds
        seriesStartTimestamp = seriesEndExclusive - bucketSpanSeconds
        requestedWindowStartTimestamp = seriesStartTimestamp
        requestedWindowEndExclusive = latestTimestamp + 1
        indexedEvidenceEndExclusive = latestTimestamp + 1
        seriesAnchor = 'latest_fill'
      }

      let backfillAttempts = 0
      while (
        !initialScanCoversSeriesStart &&
        earliestObservedBelowPageEnd !== Number.MAX_SAFE_INTEGER &&
        earliestObservedBelowPageEnd > requestedWindowStartTimestamp &&
        scannedFromBlock > 0 &&
        backfillAttempts < 8
      ) {
        const observedSeconds = Math.max(
          1,
          Math.max(latestTimestamp, seriesEndExclusive - intervalSeconds) - earliestObservedBelowPageEnd,
        )
        const observedBlocks = Math.max(1, endBlock - earliestObservedBlock + 1)
        const missingSeconds = earliestObservedBelowPageEnd - requestedWindowStartTimestamp
        const estimatedBlocksNeeded = Math.ceil((observedBlocks / observedSeconds) * missingSeconds * 2)
        const extensionSize = Math.max(25_000, estimatedBlocksNeeded)
        const extensionFromBlock = Math.max(0, scannedFromBlock - extensionSize)

        if (extensionFromBlock >= scannedFromBlock) {
          break
        }

        await accumulateRange(extensionFromBlock, scannedFromBlock - 1, {
          pageStartTimestamp: requestedWindowStartTimestamp,
          pageEndExclusive: requestedWindowEndExclusive,
        })
        scannedFromBlock = extensionFromBlock
        backfillAttempts += 1
      }

      const alignedBuckets = Array.from({ length: expectedBuckets }, (_, bucketIndex) => {
        const bucketTimestamp = seriesStartTimestamp + bucketIndex * intervalSeconds
        return { bucketTimestamp, bucket: buckets.get(bucketTimestamp) }
      })
      const ohlc = alignedBuckets.map(({ bucketTimestamp, bucket }, bucketIndex) => {
        const vwap =
          bucket && bucket.base_volume.coefficient > 0n
            ? divideExactDecimals(bucket.notional_sum, bucket.base_volume, 18)
            : { value: null, rounded: false }
        const bucketEnd = bucketTimestamp + intervalSeconds
        const bucketStartInclusive = Math.max(bucketTimestamp, requestedWindowStartTimestamp)
        const bucketEndExclusive = Math.min(bucketEnd, requestedWindowEndExclusive, indexedEvidenceEndExclusive)
        const bucketComplete =
          bucketTimestamp >= requestedWindowStartTimestamp &&
          bucketEnd <= requestedWindowEndExclusive &&
          bucketEnd <= indexedEvidenceEndExclusive

        return {
          bucket_index: bucketIndex,
          timestamp: bucketTimestamp,
          timestamp_human: formatTimestamp(bucketTimestamp),
          bucket_start_inclusive: bucketStartInclusive,
          bucket_end_exclusive: Math.max(bucketStartInclusive, bucketEndExclusive),
          bucket_complete: bucketComplete,
          bucket_state: bucketComplete ? 'closed' : 'open_or_partial',
          open: bucket?.open ? formatExactDecimal(bucket.open) : null,
          high: bucket?.high ? formatExactDecimal(bucket.high) : null,
          low: bucket?.low ? formatExactDecimal(bucket.low) : null,
          close: bucket?.close ? formatExactDecimal(bucket.close) : null,
          volume: bucket ? formatExactDecimal(bucket.volume) : '0',
          base_volume: bucket ? formatExactDecimal(bucket.base_volume) : '0',
          vwap: vwap.value,
          vwap_rounded: vwap.rounded,
          fill_count: bucket?.fill_count ?? 0,
          has_fills: (bucket?.fill_count ?? 0) > 0,
        }
      })

      const filledBuckets = ohlc.filter((bucket) => bucket.fill_count > 0).length
      const totalWindowFills = ohlc.reduce((sum, bucket) => sum + bucket.fill_count, 0)
      const totalWindowVolume = alignedBuckets.reduce(
        (sum, { bucket }) => addExactDecimals(sum, bucket?.volume ?? EXACT_DECIMAL_ZERO),
        EXACT_DECIMAL_ZERO,
      )
      const totalWindowBaseVolume = alignedBuckets.reduce(
        (sum, { bucket }) => addExactDecimals(sum, bucket?.base_volume ?? EXACT_DECIMAL_ZERO),
        EXACT_DECIMAL_ZERO,
      )
      const firstFilledCandle = ohlc.find((bucket) => bucket.fill_count > 0)
      const lastFilledCandle = [...ohlc].reverse().find((bucket) => bucket.fill_count > 0)
      const finalBucketComplete = ohlc.at(-1)?.bucket_complete ?? false
      const allBucketsComplete = ohlc.every((bucket) => bucket.bucket_complete)
      const sourceWindowComplete =
        initialScanCoversSeriesStart || earliestObservedBelowPageEnd <= requestedWindowStartTimestamp
      const resultComplete = sourceWindowComplete && allBucketsComplete
      const gapDiagnostics = buildBucketGapDiagnostics({
        buckets: ohlc,
        intervalSeconds,
        isFilled: (bucket) => bucket.fill_count > 0,
        anchor: seriesAnchor,
        windowComplete: sourceWindowComplete,
        ...(earliestObservedBelowPageEnd !== Number.MAX_SAFE_INTEGER
          ? { firstObservedTimestamp: earliestObservedBelowPageEnd }
          : {}),
        ...(latestTimestamp > 0 ? { lastObservedTimestamp: latestTimestamp } : {}),
      })
      const continuationSpanSeconds = Math.max(intervalSeconds, seriesEndExclusive - seriesStartTimestamp)
      const nextCursor =
        seriesStartTimestamp > 0
          ? encodeCursor({
              tool: 'portal_hyperliquid_get_ohlc',
              dataset,
              request: {
                coin,
                interval,
                duration: `${continuationSpanSeconds}s`,
                ...(user ? { user: user.toLowerCase() } : {}),
              },
              window_start_timestamp: Math.max(0, seriesStartTimestamp - continuationSpanSeconds),
              window_end_exclusive: seriesStartTimestamp,
            })
          : undefined

      const effectiveDuration = exactTimestampWindowRequested ? `${durationSeconds}s` : duration

      const summary = {
        coin,
        interval: resolvedInterval,
        interval_requested: interval,
        duration: effectiveDuration,
        duration_seconds: durationSeconds,
        total_buckets: ohlc.length,
        filled_buckets: filledBuckets,
        empty_buckets: ohlc.length - filledBuckets,
        total_fills: totalWindowFills,
        total_volume: formatExactDecimal(totalWindowVolume),
        total_base_volume: formatExactDecimal(totalWindowBaseVolume),
        from_block: scannedFromBlock,
        to_block: endBlock,
        ...(latestTimestamp > 0
          ? {
              latest_fill_timestamp: latestTimestamp,
              latest_fill_timestamp_human: formatTimestamp(latestTimestamp),
            }
          : {}),
        window_anchor: seriesAnchor,
        /* Buckets start on interval boundaries (wall clock), unlike the generic
           time series whose buckets are anchored to the latest block. */
        bucket_alignment: 'interval_boundary',
        requested_window_start_timestamp: requestedWindowStartTimestamp,
        requested_window_start_timestamp_human: formatTimestamp(requestedWindowStartTimestamp),
        requested_window_end_exclusive: requestedWindowEndExclusive,
        requested_window_end_exclusive_human: formatTimestamp(requestedWindowEndExclusive),
        window_start_timestamp: seriesStartTimestamp,
        window_start_timestamp_human: formatTimestamp(seriesStartTimestamp),
        window_end_exclusive: seriesEndExclusive,
        window_end_exclusive_human: formatTimestamp(seriesEndExclusive),
        indexed_evidence_end_exclusive: indexedEvidenceEndExclusive,
        indexed_evidence_end_exclusive_human: formatTimestamp(indexedEvidenceEndExclusive),
        final_bucket_complete: finalBucketComplete,
        all_buckets_complete: allBucketsComplete,
        result_complete: resultComplete,
        ...(user ? { filtered_user: user.toLowerCase() } : {}),
        ...(firstFilledCandle ? { series_open: firstFilledCandle.open } : {}),
        ...(lastFilledCandle ? { series_close: lastFilledCandle.close } : {}),
        ...(chunksFetched > 1 ? { chunks_fetched: chunksFetched } : {}),
        ...(chunkSizeReduced ? { chunk_size_reduced: true } : {}),
        ...(backfillAttempts > 0 ? { backfill_attempts: backfillAttempts } : {}),
      }

      const freshness = buildQueryFreshness({
        finality: 'latest',
        headBlockNumber: head.number,
        windowToBlock: endBlock,
        resolvedWindow,
      })
      const durationLabel = exactTimestampWindowRequested
        ? `${formatTimestamp(requestedWindowStartTimestamp)} to ${formatTimestamp(
            Math.max(requestedWindowStartTimestamp, requestedWindowEndExclusive - 1),
          )}`
        : describeTimeWindowInput(duration)
      const notices = getTimestampWindowNotices(resolvedWindow)
      if (!finalBucketComplete) {
        notices.push(
          'The final candle is still open or covers only part of the requested interval. Do not treat it as a closed candle.',
        )
      }
      if (nextCursor) notices.push('Older candles are available via _pagination.next_cursor.')

      const chartTooltip: ChartTooltipDescriptor = {
        mode: 'axis',
        title_field: 'timestamp_human',
        title_label: 'Time',
        title_format: 'timestamp_human',
        fields: [
          { key: 'open', label: 'Open', format: 'currency_usd', unit: 'USD', emphasis: 'primary' },
          { key: 'high', label: 'High', format: 'currency_usd', unit: 'USD' },
          { key: 'low', label: 'Low', format: 'currency_usd', unit: 'USD' },
          { key: 'close', label: 'Close', format: 'currency_usd', unit: 'USD', emphasis: 'primary' },
          { key: 'volume', label: 'Volume', format: 'currency_usd', unit: 'USD' },
          { key: 'base_volume', label: `${untrustedLabel(coin)} size`, format: 'decimal', unit: untrustedLabel(coin) },
          { key: 'fill_count', label: 'Fills', format: 'integer' },
          { key: 'bucket_complete', label: 'Closed candle' },
          { key: 'vwap', label: 'VWAP', format: 'currency_usd', unit: 'USD' },
        ],
      }

      const ui = buildPortalUi({
        version: 'portal_ui_v1',
        layout: 'chart_focus',
        density: 'compact',
        design_intent: 'market_terminal',
        headline: {
          title: `${untrustedLabel(coin)} Hyperliquid candles`,
          subtitle: `${resolvedInterval} candles over ${durationLabel}${user ? ` for ${user.toLowerCase()}` : ''}`,
        },
        metric_cards: [
          buildMetricCard({
            id: 'last_close',
            label: 'Last close',
            value_path: 'summary.series_close',
            format: 'currency_usd',
            unit: 'USD',
            emphasis: 'primary',
          }),
          buildMetricCard({
            id: 'volume',
            label: 'Volume',
            value_path: 'summary.total_volume',
            format: 'currency_usd',
            unit: 'USD',
          }),
          buildMetricCard({ id: 'fills', label: 'Fills', value_path: 'summary.total_fills', format: 'integer' }),
          buildMetricCard({
            id: 'filled_buckets',
            label: 'Filled buckets',
            value_path: 'summary.filled_buckets',
            format: 'integer',
          }),
        ],
        panels: [
          buildChartPanel({
            id: 'candles',
            kind: 'chart_panel',
            title: `${untrustedLabel(coin)} price action`,
            subtitle: 'Hover or focus a candle for OHLC, volume, fills, and VWAP.',
            chart_key: 'chart',
            emphasis: 'primary',
          }),
          buildTablePanel({
            id: 'ohlc-table',
            kind: 'table_panel',
            title: 'Candle table',
            subtitle: 'Each bucket with OHLC, USD volume, and fill count.',
            table_id: 'ohlc',
          }),
        ],
        follow_up_actions: [
          ...(nextCursor
            ? [{ label: 'Load older candles', intent: 'continue' as const, target: '_pagination.next_cursor' }]
            : []),
          { label: 'Show raw candle rows', intent: 'show_raw', target: 'ohlc' },
          { label: 'Query a shorter recent window', intent: 'zoom_in', target: 'chart' },
        ],
      })

      return formatResult(
        {
          summary,
          chart: buildCandlestickChart({
            dataKey: 'ohlc',
            interval: resolvedInterval,
            totalCandles: ohlc.length,
            title: `${untrustedLabel(coin)} Hyperliquid candles`,
            subtitle: 'Interactive OHLC chart with exact point labels and candle table',
            volumePanel: true,
            volumeField: 'volume',
            volumeUnit: 'USD',
            priceUnit: 'USD',
            priceFormat: 'currency_usd',
            tooltip: chartTooltip,
          }),
          tables: [
            buildOhlcTable({
              id: 'ohlc',
              rowCount: ohlc.length,
              title: `${untrustedLabel(coin)} candle table`,
              subtitle: 'Bucket-aligned OHLC candles with USD volume and fill counts available in the rows',
              volumeField: 'volume',
              volumeLabel: 'Volume',
              volumeUnit: 'USD',
              extraColumns: [
                { key: 'fill_count', label: 'Fills', kind: 'metric', format: 'integer', align: 'right' },
                { key: 'bucket_state', label: 'Candle state', kind: 'dimension' },
              ],
            }),
          ],
          gap_diagnostics: gapDiagnostics,
          ohlc,
        },
        `Built ${resolvedInterval} ${untrustedLabel(coin)} Hyperliquid candles over ${durationLabel}. ${filledBuckets}/${ohlc.length} buckets contain trades.`,
        {
          toolName: 'portal_hyperliquid_get_ohlc',
          ...(notices.length > 0 ? { notices } : {}),
          pagination: buildPaginationInfo(expectedBuckets, ohlc.length, nextCursor, {
            continuationScope: 'adjacent_window',
          }),
          ordering: buildChronologicalPageOrdering({
            sortedBy: 'timestamp',
            continuation: nextCursor ? 'older' : 'none',
          }),
          freshness,
          execution: buildExecutionMetadata({
            interval: resolvedInterval,
            duration: effectiveDuration,
            duration_seconds: durationSeconds,
            from_block: scannedFromBlock,
            to_block: endBlock,
            range_kind: resolvedWindow.range_kind,
          }),
          ui,
          llm: {
            answer_sequence: [
              'summary.series_close',
              'summary.total_volume',
              'summary.total_fills',
              'summary.filled_buckets',
              'ohlc',
            ],
            parser_notes: [
              'Use summary.series_close as the headline price and primary_preview as the latest candle instead of scanning the whole ohlc array.',
              'Check summary.final_bucket_complete, _coverage, and gap_diagnostics before treating the latest candle as closed or the result as complete.',
            ],
          },
          coverage: buildBucketCoverage({
            expectedBuckets,
            returnedBuckets: ohlc.length,
            filledBuckets,
            anchor: seriesAnchor,
            windowComplete: sourceWindowComplete,
            resultComplete,
            requestedFromTimestamp: requestedWindowStartTimestamp,
            requestedToTimestamp: Math.max(requestedWindowStartTimestamp, requestedWindowEndExclusive - 1),
            analyzedFromTimestamp: requestedWindowStartTimestamp,
            analyzedToTimestamp: Math.max(requestedWindowStartTimestamp, indexedEvidenceEndExclusive - 1),
            indexedEvidenceEndTimestamp: Math.max(requestedWindowStartTimestamp, indexedEvidenceEndExclusive - 1),
            finalBucketComplete,
          }),
          metadata: {
            dataset,
            from_block: scannedFromBlock,
            to_block: endBlock,
            query_start_time: queryStartTime,
          },
        },
      )
    },
  )
}
