import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { validateBlockRange } from '../../cache/datasets.js'
import { PORTAL_URL } from '../../constants/index.js'
import { resolveEventTopic0 } from '../../helpers/evm-aliases.js'
import { portalFetchRecentRecords } from '../../helpers/fetch.js'
import { buildTronBlockFields, buildTronLogFields, buildTronTransactionFields } from '../../helpers/fields.js'
import { formatResult } from '../../helpers/format.js'
import { registerPortalTool } from '../../helpers/mcp-registration.js'
import {
  buildPaginationInfo,
  decodeRecentPageCursor,
  encodeRecentPageCursor,
  paginateAscendingItems,
} from '../../helpers/pagination.js'
import { type ResponseFormat, applyResponseFormat, resolveDefaultResponseFormat } from '../../helpers/response-modes.js'
import {
  buildChronologicalPageOrdering,
  buildQueryCoverage,
  buildQueryFreshness,
} from '../../helpers/result-metadata.js'
import { type TimestampInput, getTimestampWindowNotices, resolveTimeframeOrBlocks } from '../../helpers/timeframe.js'
import { buildExecutionMetadata, buildToolDescription } from '../../helpers/tool-ux.js'
import { normalizeTronAddresses, normalizeTronTopic, stripHexPrefix, tronHexToBase58 } from '../../helpers/tron.js'
import { decodeLog } from '../utilities/decode-logs.js'
import {
  TRON_DEFAULT_MAX_SCAN_BLOCKS,
  type TronLogItem,
  flattenTronLogs,
  getTronBlockNumber,
  resolveTronDataset,
  sortTronLogs,
  toTronInputError,
  tronChunkSize,
} from './shared.js'

const TOOL_NAME = 'portal_tron_query_logs'

type TronLogsRequest = {
  timeframe?: string
  from_timestamp?: TimestampInput
  to_timestamp?: TimestampInput
  limit: number
  finalized_only: boolean
  addresses?: string[]
  topic0?: string[]
  topic1?: string[]
  topic2?: string[]
  topic3?: string[]
  include_transaction: boolean
  decode: boolean
  max_scan_blocks?: number
  response_format: ResponseFormat
}

function normalizeTopics(values: string[] | undefined, label: string): string[] | undefined {
  if (!values || values.length === 0) return undefined
  return Array.from(new Set(values.map((value) => normalizeTronTopic(value, label))))
}

/** Decode with the shared EVM decoder (TVM uses the same ABI), then show addresses as Base58. */
function decodeTronLog(log: TronLogItem): Record<string, unknown> | undefined {
  const topics = Array.isArray(log.topics)
    ? (log.topics as unknown[]).filter((t): t is string => typeof t === 'string')
    : []
  if (typeof log.address !== 'string' || topics.length === 0) return undefined
  try {
    const decoded = decodeLog({
      address: `0x${stripHexPrefix(log.address)}`,
      topics: topics.map((topic) => `0x${stripHexPrefix(topic)}`),
      data: `0x${typeof log.data === 'string' ? stripHexPrefix(log.data) : ''}`,
    })
    const values = decoded.decoded
      ? Object.fromEntries(
          Object.entries(decoded.decoded).map(([key, value]) => [
            key,
            /^0x[0-9a-f]{40}$/i.test(value) ? tronHexToBase58(`41${value.slice(2).toLowerCase()}`) : value,
          ]),
        )
      : null
    return { event_name: decoded.event_name, decoded: values, address_form: 'base58' }
  } catch {
    return undefined
  }
}

export function registerTronQueryLogsTool(server: McpServer) {
  registerPortalTool(
    server,
    TOOL_NAME,
    buildToolDescription(TOOL_NAME),
    {
      network: z
        .string()
        .optional()
        .describe('Network name (default: tron-mainnet). Optional when continuing with cursor.'),
      from_block: z.number().optional().describe('Starting block number'),
      to_block: z.number().optional().describe('Ending block number. Tron produces a block every 3 seconds.'),
      timeframe: z.string().optional().describe("Time range (e.g., '5m', '1h'). Alternative to from_block/to_block."),
      from_timestamp: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          'Starting timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input like "1h ago".',
        ),
      to_timestamp: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          'Ending timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input like "now".',
        ),
      addresses: z
        .array(z.string())
        .optional()
        .describe(
          'FILTER: emitting contract addresses in any form (Base58 T..., 41-prefixed hex, 0x or bare 20-byte hex). Always include this or topic0 for fast queries.',
        ),
      event: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          'FILTER: common event alias (transfer, approval, swap, mint, burn) or a topic0 hash. Merges with topic0.',
        ),
      topic0: z.array(z.string()).optional().describe('FILTER: event signature hashes, with or without 0x.'),
      topic1: z
        .array(z.string())
        .optional()
        .describe('FILTER: indexed parameter 1 (often the sender). An address in any form is padded to a topic.'),
      topic2: z
        .array(z.string())
        .optional()
        .describe('FILTER: indexed parameter 2 (often the recipient). An address in any form is padded to a topic.'),
      topic3: z.array(z.string()).optional().describe('FILTER: indexed parameter 3.'),
      include_transaction: z
        .boolean()
        .optional()
        .default(false)
        .describe('Attach the parent transaction (type, caller, contract, result, fee). The hash is always attached.'),
      decode: z
        .boolean()
        .optional()
        .default(false)
        .describe('Decode known event signatures inline with Base58 addresses'),
      finalized_only: z.boolean().optional().default(false).describe('Only query finalized blocks'),
      max_scan_blocks: z
        .number()
        .int()
        .min(1)
        .max(500_000)
        .optional()
        .describe(`Safety cap for filtered latest-first scans. Default: min(window, ${TRON_DEFAULT_MAX_SCAN_BLOCKS}).`),
      response_format: z
        .enum(['full', 'compact', 'summary'])
        .optional()
        .describe(
          "Response format: defaults to 'compact' for chat-friendly output. Use 'summary' for counts by contract and event.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .default(20)
        .describe('Max logs to return (default: 20, max: 25)'),
      cursor: z.string().optional().describe('Continuation cursor from a previous response'),
    },
    async (args) => {
      const queryStartTime = Date.now()
      const paginationCursor = args.cursor ? decodeRecentPageCursor<TronLogsRequest>(args.cursor, TOOL_NAME) : undefined
      const dataset = paginationCursor?.dataset ?? (await resolveTronDataset(TOOL_NAME, args.network))

      let request: TronLogsRequest
      if (paginationCursor) {
        request = paginationCursor.request
      } else {
        try {
          const addresses = normalizeTronAddresses(args.addresses, 'log')
          const topic0 = Array.from(
            new Set([
              ...(args.topic0 ?? []).map((value) => normalizeTronTopic(value, 'topic0')),
              ...resolveEventTopic0(args.event).map((value) => stripHexPrefix(value).toLowerCase()),
            ]),
          )
          request = {
            ...(args.timeframe ? { timeframe: args.timeframe } : {}),
            ...(args.from_timestamp !== undefined ? { from_timestamp: args.from_timestamp } : {}),
            ...(args.to_timestamp !== undefined ? { to_timestamp: args.to_timestamp } : {}),
            limit: args.limit,
            finalized_only: args.finalized_only,
            ...(addresses ? { addresses } : {}),
            ...(topic0.length > 0 ? { topic0 } : {}),
            ...(normalizeTopics(args.topic1, 'topic1') ? { topic1: normalizeTopics(args.topic1, 'topic1') } : {}),
            ...(normalizeTopics(args.topic2, 'topic2') ? { topic2: normalizeTopics(args.topic2, 'topic2') } : {}),
            ...(normalizeTopics(args.topic3, 'topic3') ? { topic3: normalizeTopics(args.topic3, 'topic3') } : {}),
            include_transaction: args.include_transaction,
            decode: args.decode,
            ...(args.max_scan_blocks !== undefined ? { max_scan_blocks: args.max_scan_blocks } : {}),
            response_format: resolveDefaultResponseFormat(args.response_format),
          }
        } catch (error) {
          throw toTronInputError(error)
        }
      }
      const effectiveResponseFormat = resolveDefaultResponseFormat(request.response_format)

      const resolvedBlocks = paginationCursor
        ? {
            from_block: paginationCursor.window_from_block,
            to_block: paginationCursor.window_to_block,
            range_kind:
              request.from_timestamp !== undefined || request.to_timestamp !== undefined
                ? 'timestamp_range'
                : request.timeframe
                  ? 'timeframe'
                  : 'block_range',
          }
        : await resolveTimeframeOrBlocks({
            dataset,
            timeframe: request.timeframe,
            from_block: args.from_block,
            to_block: args.to_block,
            from_timestamp: request.from_timestamp,
            to_timestamp: request.to_timestamp,
          })
      const resolvedFromBlock = resolvedBlocks.from_block
      const { validatedToBlock: endBlock, head } = await validateBlockRange(
        dataset,
        resolvedFromBlock,
        resolvedBlocks.to_block ?? Number.MAX_SAFE_INTEGER,
        request.finalized_only,
      )
      const pageToBlock = paginationCursor?.page_to_block ?? endBlock

      const filtered = Boolean(
        request.addresses || request.topic0 || request.topic1 || request.topic2 || request.topic3,
      )
      const logFilter = Object.fromEntries(
        Object.entries({
          address: request.addresses,
          topic0: request.topic0,
          topic1: request.topic1,
          topic2: request.topic2,
          topic3: request.topic3,
          transaction: true,
        }).filter(([, value]) => value !== undefined),
      )
      const query = {
        type: 'tron',
        fromBlock: resolvedFromBlock,
        toBlock: pageToBlock,
        fields: {
          block: buildTronBlockFields(),
          log: buildTronLogFields(),
          transaction: request.include_transaction
            ? buildTronTransactionFields({ includeParameter: false })
            : { transactionIndex: true, hash: true },
        },
        logs: [logFilter],
      }

      const chunkSize = tronChunkSize(filtered)
      const windowBlocks = pageToBlock - resolvedFromBlock + 1
      const maxScanBlocks = Math.min(windowBlocks, request.max_scan_blocks ?? TRON_DEFAULT_MAX_SCAN_BLOCKS)
      const maxChunks = Math.max(1, Math.ceil(maxScanBlocks / chunkSize))
      const cursorSkip = paginationCursor?.skip_inclusive_block ?? 0
      const results = await portalFetchRecentRecords(`${PORTAL_URL}/datasets/${dataset}/stream`, query, {
        itemKeys: ['logs'],
        limit: request.limit + cursorSkip + 1,
        chunkSize,
        maxChunks,
      })
      const scannedFromBlock = Math.max(resolvedFromBlock, pageToBlock - maxChunks * chunkSize + 1)

      const allLogs = sortTronLogs(flattenTronLogs(results, { includeTransaction: request.include_transaction }))
      const page = paginateAscendingItems(
        allLogs,
        request.limit,
        getTronBlockNumber,
        paginationCursor
          ? {
              page_to_block: paginationCursor.page_to_block,
              skip_inclusive_block: paginationCursor.skip_inclusive_block,
            }
          : undefined,
      )
      const scanBounded = scannedFromBlock > resolvedFromBlock && !page.hasMore
      const nextBoundary = page.hasMore
        ? page.nextBoundary
        : scanBounded
          ? { page_to_block: scannedFromBlock - 1, skip_inclusive_block: 0 }
          : undefined
      const hasMore = page.hasMore || scanBounded
      const nextCursor = nextBoundary
        ? encodeRecentPageCursor<TronLogsRequest>({
            tool: TOOL_NAME,
            dataset,
            request,
            window_from_block: resolvedFromBlock,
            window_to_block: endBlock,
            page_to_block: nextBoundary.page_to_block,
            skip_inclusive_block: nextBoundary.skip_inclusive_block,
          })
        : undefined

      const pageItems = request.decode
        ? page.pageItems.map((log) => {
            const decoded = decodeTronLog(log)
            return decoded ? { ...log, decoded_log: decoded } : log
          })
        : page.pageItems
      const formattedData = applyResponseFormat(pageItems, effectiveResponseFormat, 'tron_logs')
      const notices = getTimestampWindowNotices(resolvedBlocks)
      if (!filtered)
        notices.push('No address or topic filter was given; add addresses or event for faster, more specific results.')
      if (scanBounded) {
        notices.push(
          `Bounded scan covered blocks ${scannedFromBlock}-${pageToBlock} of the requested ${resolvedFromBlock}-${endBlock}; continue with _pagination.next_cursor or raise max_scan_blocks.`,
        )
      } else if (nextCursor) {
        notices.push('Older results are available via _pagination.next_cursor.')
      }
      const freshness = buildQueryFreshness({
        finality: request.finalized_only ? 'finalized' : 'latest',
        headBlockNumber: head.number,
        windowToBlock: endBlock,
        resolvedWindow: resolvedBlocks,
      })
      const coverage = buildQueryCoverage({
        windowFromBlock: resolvedFromBlock,
        windowToBlock: endBlock,
        pageToBlock,
        items: page.pageItems,
        getBlockNumber: getTronBlockNumber,
        hasMore,
      })
      const message =
        effectiveResponseFormat === 'summary'
          ? `Summary of ${page.pageItems.length} Tron logs${hasMore ? ' (latest preview page)' : ''}`
          : `Retrieved ${page.pageItems.length} Tron logs${hasMore ? ` from the most recent matching blocks (preview page limited to ${request.limit})` : ''}`

      return formatResult(formattedData, message, {
        toolName: TOOL_NAME,
        notices,
        pagination: buildPaginationInfo(request.limit, page.pageItems.length, nextCursor),
        ordering: buildChronologicalPageOrdering({
          sortedBy: 'block_number',
          tieBreakers: ['transactionIndex', 'logIndex'],
        }),
        freshness,
        coverage,
        execution: buildExecutionMetadata({
          response_format: effectiveResponseFormat,
          finalized_only: request.finalized_only,
          limit: request.limit,
          from_block: resolvedFromBlock,
          to_block: endBlock,
          page_to_block: pageToBlock,
          range_kind: resolvedBlocks.range_kind,
          decode: request.decode,
          estimated_scan_blocks: Math.min(windowBlocks, maxChunks * chunkSize),
          normalized_output: true,
          notes: [
            'Native Tron query (logs); contract addresses were normalized to the 20-byte form Portal expects for logs and topics, and the parent transaction hash is joined onto every row.',
            'Log data and topics are bare hex; timestamps are Unix milliseconds on the raw record and seconds on the aliases.',
          ],
        }),
        metadata: {
          network: dataset,
          dataset,
          from_block: resolvedFromBlock,
          to_block: pageToBlock,
          query_start_time: queryStartTime,
        },
      })
    },
  )
}
