import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { resolveDataset, validateBlockRange } from '../../cache/datasets.js'
import { PORTAL_URL } from '../../constants/index.js'
import {
  buildBoundedSearchExecution,
  buildBoundedSearchNotice,
  scanBoundedBlockRange,
} from '../../helpers/bounded-search.js'
import { detectChainType, isL2Chain } from '../../helpers/chain.js'
import { ActionableError, createUnsupportedChainError } from '../../helpers/errors.js'
import { resolveMethodSighashes } from '../../helpers/evm-aliases.js'
import { portalFetchStreamRange } from '../../helpers/fetch.js'
import { type FieldPreset, getTraceFields } from '../../helpers/field-presets.js'
import { buildEvmTransactionFields } from '../../helpers/fields.js'
import { formatResult } from '../../helpers/format.js'
import { registerPortalTool } from '../../helpers/mcp-registration.js'
import { normalizeEvmTraceResult, normalizeEvmTransactionResult } from '../../helpers/normalized-results.js'
import {
  buildCursorDirectionNotice,
  buildPaginationInfo,
  decodeRecentPageCursor,
  encodeRecentPageCursor,
  paginateAscendingItems,
  paginateForwardItems,
} from '../../helpers/pagination.js'
import { type ResponseFormat, applyResponseFormat, resolveDefaultResponseFormat } from '../../helpers/response-modes.js'
import {
  buildChronologicalPageOrdering,
  buildQueryCoverage,
  buildQueryFreshness,
} from '../../helpers/result-metadata.js'
import { type TimestampInput, getTimestampWindowNotices, resolveTimeframeOrBlocks } from '../../helpers/timeframe.js'
import { buildExecutionMetadata, buildToolDescription } from '../../helpers/tool-ux.js'
import { getValidationNotices, normalizeAddresses, validateQuerySize } from '../../helpers/validation.js'

const TOOL_NAME = 'portal_evm_query_traces'
const TRACE_TYPES = ['call', 'create', 'suicide', 'reward'] as const
const FILTERED_CHUNK_BLOCKS = 500
const UNFILTERED_CHUNK_BLOCKS = 10
const DEFAULT_FILTERED_MAX_SCAN_BLOCKS = 5_000
const DEFAULT_UNFILTERED_MAX_SCAN_BLOCKS = 100
const TRANSACTION_HASH_MAX_WINDOW_BLOCKS = 1_000

type TraceType = (typeof TRACE_TYPES)[number]

type QueryTracesRequest = {
  timeframe?: string
  from_timestamp?: TimestampInput
  to_timestamp?: TimestampInput
  limit: number
  finalized_only: boolean
  type?: TraceType[]
  call_from?: string[]
  call_to?: string[]
  call_sighash?: string[]
  create_from?: string[]
  create_result_address?: string[]
  transaction_hash?: string
  include_transaction: boolean
  include_subtraces: boolean
  scan_order: 'earliest' | 'latest'
  max_scan_blocks?: number
  field_preset: FieldPreset
  response_format: ResponseFormat
}

type TraceItem = Record<string, unknown> & {
  block_number?: number
  transactionIndex?: number
  traceAddress?: unknown
  tx_hash?: string
}

function getBlockNumber(item: TraceItem): number | undefined {
  return typeof item.block_number === 'number' ? item.block_number : undefined
}

function traceAddressParts(item: TraceItem): number[] {
  return Array.isArray(item.traceAddress) ? item.traceAddress.map((part) => Number(part)) : []
}

function compareTraceAddress(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a !== b) return a - b
  }
  return 0
}

function sortTraces(items: TraceItem[]): TraceItem[] {
  return items.sort((left, right) => {
    const blockDelta = (getBlockNumber(left) ?? 0) - (getBlockNumber(right) ?? 0)
    if (blockDelta !== 0) return blockDelta
    const indexDelta = Number(left.transactionIndex ?? 0) - Number(right.transactionIndex ?? 0)
    if (indexDelta !== 0) return indexDelta
    return compareTraceAddress(traceAddressParts(left), traceAddressParts(right))
  })
}

function flattenTraces(
  records: unknown[],
  options: { includeTransaction: boolean; transactionHash?: string },
): TraceItem[] {
  const rows: TraceItem[] = []
  for (const rawBlock of records) {
    const block = rawBlock as {
      header?: { number?: number; timestamp?: number; hash?: string }
      transactions?: Record<string, unknown>[]
      traces?: Record<string, unknown>[]
    }
    const blockNumber = block.header?.number
    const timestamp = block.header?.timestamp
    const transactionsByIndex = new Map<number, Record<string, unknown>>()
    for (const transaction of block.transactions ?? []) {
      if (typeof transaction.transactionIndex === 'number') {
        transactionsByIndex.set(transaction.transactionIndex, transaction)
      }
    }
    for (const trace of block.traces ?? []) {
      const transactionIndex = typeof trace.transactionIndex === 'number' ? trace.transactionIndex : undefined
      const parent = transactionIndex !== undefined ? transactionsByIndex.get(transactionIndex) : undefined
      const txHash = typeof parent?.hash === 'string' ? parent.hash : undefined
      if (options.transactionHash && txHash !== options.transactionHash) continue
      rows.push(
        normalizeEvmTraceResult({
          ...trace,
          ...(blockNumber !== undefined ? { block_number: blockNumber } : {}),
          ...(timestamp !== undefined ? { timestamp } : {}),
          ...(txHash ? { tx_hash: txHash } : {}),
          ...(options.includeTransaction && parent
            ? {
                transaction: normalizeEvmTransactionResult({
                  ...parent,
                  ...(blockNumber !== undefined ? { block_number: blockNumber } : {}),
                  ...(timestamp !== undefined ? { timestamp } : {}),
                }),
              }
            : {}),
        }) as TraceItem,
      )
    }
  }
  return rows
}

function normalizeSighashes(values: string[] | undefined, method: string | string[] | undefined): string[] {
  const merged = new Set<string>()
  for (const value of values ?? []) {
    const trimmed = value.trim().toLowerCase()
    if (!/^0x[0-9a-f]{8}$/.test(trimmed)) {
      throw new ActionableError(
        `Invalid call_sighash: ${value}`,
        ['Use a 4-byte selector such as 0xa9059cbb, or a method alias such as transfer through the method argument.'],
        undefined,
        { code: 'invalid_request', origin: 'client_input', retryable: false },
      )
    }
    merged.add(trimmed)
  }
  for (const value of resolveMethodSighashes(method)) merged.add(value.toLowerCase())
  return [...merged]
}

function normalizeTransactionHash(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim().toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(trimmed)) {
    throw new ActionableError(
      `Invalid transaction_hash: ${value}`,
      ['A transaction hash is 0x followed by 64 hex characters.'],
      undefined,
      { code: 'invalid_request', origin: 'client_input', retryable: false },
    )
  }
  return trimmed
}

function invalidAddresses(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  throw new ActionableError(message, ['EVM addresses are 0x followed by 40 hex characters.'], undefined, {
    code: 'invalid_request',
    origin: 'client_input',
    retryable: false,
  })
}

export function registerQueryTracesTool(server: McpServer) {
  registerPortalTool(
    server,
    TOOL_NAME,
    buildToolDescription(TOOL_NAME),
    {
      network: z.string().optional().describe('Network name or alias. Optional when continuing with cursor.'),
      from_block: z.number().optional().describe('Starting block number (use this OR timeframe)'),
      to_block: z
        .number()
        .optional()
        .describe('Ending block number. Traces are expensive: keep filtered windows under 5,000 blocks.'),
      timeframe: z
        .string()
        .optional()
        .describe("Time range (e.g., '10m', '1h'). Alternative to from_block/to_block. Keep it short for traces."),
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
      type: z
        .array(z.enum(TRACE_TYPES))
        .optional()
        .describe(
          "FILTER: trace types. 'create' covers both CREATE and CREATE2; 'reward' only exists on proof-of-work history.",
        ),
      call_from: z
        .array(z.string())
        .optional()
        .describe('FILTER (call traces): calling addresses, contracts or wallets.'),
      call_to: z.array(z.string()).optional().describe('FILTER (call traces): called addresses.'),
      call_sighash: z
        .array(z.string())
        .optional()
        .describe('FILTER (call traces): 4-byte selectors such as 0xa9059cbb.'),
      method: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          'FILTER (call traces): method alias such as transfer, approve, deposit, or a 4-byte selector. Merges with call_sighash.',
        ),
      create_from: z.array(z.string()).optional().describe('FILTER (create traces): deployer addresses.'),
      create_result_address: z
        .array(z.string())
        .optional()
        .describe('FILTER (create traces): deployed contract addresses.'),
      transaction_hash: z
        .string()
        .optional()
        .describe(
          `FILTER: keep only traces of this transaction. Give its block (from_block = to_block) or a window of at most ${TRANSACTION_HASH_MAX_WINDOW_BLOCKS.toLocaleString()} blocks; find the block with portal_evm_query_transactions first when unknown.`,
        ),
      include_transaction: z
        .boolean()
        .optional()
        .default(false)
        .describe('Attach the parent transaction (sender, recipient, value, status). The hash is always attached.'),
      include_subtraces: z
        .boolean()
        .optional()
        .default(false)
        .describe('Also return the child traces of each matching trace'),
      scan_order: z
        .enum(['earliest', 'latest'])
        .optional()
        .default('latest')
        .describe('Which side of the block window to scan first. Use earliest for first-occurrence questions.'),
      max_scan_blocks: z
        .number()
        .int()
        .min(1)
        .max(50_000)
        .optional()
        .describe(
          `Safety cap for bounded scans. Default: ${DEFAULT_FILTERED_MAX_SCAN_BLOCKS.toLocaleString()} blocks with filters, ${DEFAULT_UNFILTERED_MAX_SCAN_BLOCKS} without.`,
        ),
      finalized_only: z.boolean().optional().default(false).describe('Only query finalized blocks'),
      field_preset: z
        .enum(['minimal', 'standard', 'full'])
        .optional()
        .default('standard')
        .describe(
          "Field preset: 'minimal' (type, from, to), 'standard' (value, selector, gas, result address), 'full' (adds call input and output and creation code).",
        ),
      response_format: z
        .enum(['full', 'compact', 'summary'])
        .optional()
        .describe(
          "Response format: defaults to 'compact' for chat-friendly output. Use 'summary' for counts by type, failures, value moved, and top callers.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .default(20)
        .describe('Max traces to return (default: 20, max: 25)'),
      cursor: z.string().optional().describe('Continuation cursor from a previous response'),
    },
    async (args) => {
      const queryStartTime = Date.now()
      const paginationCursor = args.cursor
        ? decodeRecentPageCursor<QueryTracesRequest>(args.cursor, TOOL_NAME)
        : undefined
      const dataset = paginationCursor?.dataset ?? (await resolveDataset(args.network ?? ''))
      const chainType = detectChainType(dataset)
      if (chainType !== 'evm') {
        throw createUnsupportedChainError({
          toolName: TOOL_NAME,
          dataset,
          actualChainType: chainType,
          supportedChains: ['evm'],
          suggestions: [
            'Use portal_solana_query_instructions for Solana program activity.',
            'Use portal_tron_query_transactions with include_internal_transactions for Tron internal transactions.',
          ],
        })
      }

      let request: QueryTracesRequest
      if (paginationCursor) {
        request = paginationCursor.request
      } else {
        let callFrom: string[] | undefined
        let callTo: string[] | undefined
        let createFrom: string[] | undefined
        let createResult: string[] | undefined
        try {
          callFrom = normalizeAddresses(args.call_from, chainType)
          callTo = normalizeAddresses(args.call_to, chainType)
          createFrom = normalizeAddresses(args.create_from, chainType)
          createResult = normalizeAddresses(args.create_result_address, chainType)
        } catch (error) {
          invalidAddresses(error)
        }
        const sighash = normalizeSighashes(args.call_sighash, args.method)
        const transactionHash = normalizeTransactionHash(args.transaction_hash)
        request = {
          ...(args.timeframe ? { timeframe: args.timeframe } : {}),
          ...(args.from_timestamp !== undefined ? { from_timestamp: args.from_timestamp } : {}),
          ...(args.to_timestamp !== undefined ? { to_timestamp: args.to_timestamp } : {}),
          limit: args.limit,
          finalized_only: args.finalized_only,
          ...(args.type?.length ? { type: args.type } : {}),
          ...(callFrom ? { call_from: callFrom } : {}),
          ...(callTo ? { call_to: callTo } : {}),
          ...(sighash.length > 0 ? { call_sighash: sighash } : {}),
          ...(createFrom ? { create_from: createFrom } : {}),
          ...(createResult ? { create_result_address: createResult } : {}),
          ...(transactionHash ? { transaction_hash: transactionHash } : {}),
          include_transaction: args.include_transaction,
          include_subtraces: args.include_subtraces,
          scan_order: args.scan_order,
          ...(args.max_scan_blocks !== undefined ? { max_scan_blocks: args.max_scan_blocks } : {}),
          field_preset: args.field_preset,
          response_format: resolveDefaultResponseFormat(args.response_format),
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
      const windowBlocks = pageToBlock - resolvedFromBlock + 1

      // `type` is not a narrowing filter: every EVM block is mostly call traces,
      // so a type-only query gets the unfiltered budget and chunk size. Granting
      // it the filtered budget invited 5,000-block scans that always died on the
      // response size limit.
      const hasPortalFilters = Boolean(
        request.call_from ||
          request.call_to ||
          request.call_sighash ||
          request.create_from ||
          request.create_result_address,
      )
      if (request.transaction_hash && !hasPortalFilters && windowBlocks > TRANSACTION_HASH_MAX_WINDOW_BLOCKS) {
        throw new ActionableError(
          `A transaction_hash filter is supported only for windows of at most ${TRANSACTION_HASH_MAX_WINDOW_BLOCKS.toLocaleString()} blocks; the requested window spans ${windowBlocks.toLocaleString()}.`,
          [
            'Set from_block and to_block to the transaction block.',
            'Find the block first with portal_evm_query_transactions filtered by from_addresses or to_addresses, then query its traces.',
          ],
          undefined,
          { code: 'invalid_request', origin: 'client_input', retryable: false },
        )
      }
      const validation = validateQuerySize({
        blockRange: windowBlocks,
        hasFilters: hasPortalFilters,
        queryType: 'traces',
        limit: request.limit,
      })
      if (!validation.valid) {
        throw new ActionableError(
          validation.error ?? 'Trace window too large.',
          [
            'Narrow the window with from_block/to_block or a shorter timeframe.',
            'Add call_from, call_to, method, or create_from filters so Portal can index the scan.',
          ],
          undefined,
          { code: 'invalid_request', origin: 'client_input', retryable: false },
        )
      }

      const traceFilter: Record<string, unknown> = { transaction: true }
      if (request.type?.length) traceFilter.type = request.type
      if (request.call_from) traceFilter.callFrom = request.call_from
      if (request.call_to) traceFilter.callTo = request.call_to
      if (request.call_sighash) traceFilter.callSighash = request.call_sighash
      if (request.create_from) traceFilter.createFrom = request.create_from
      if (request.create_result_address) traceFilter.createResultAddress = request.create_result_address
      if (request.include_subtraces) traceFilter.subtraces = true

      // A summary aggregates value, selector and endpoint fields. The 'minimal'
      // preset does not request them, which produced a confident total_value_eth
      // of 0 for pages that moved real value, so summaries read at least the
      // standard field set.
      const effectiveFieldPreset =
        effectiveResponseFormat === 'summary' && request.field_preset === 'minimal' ? 'standard' : request.field_preset
      const presetFields = getTraceFields(effectiveFieldPreset) as { trace: Record<string, boolean> }
      const query = {
        type: 'evm',
        fields: {
          block: { number: true, timestamp: true, hash: true },
          trace: {
            ...presetFields.trace,
            traceAddress: true,
            subtraces: true,
            transactionIndex: true,
            type: true,
            error: true,
            ...(effectiveFieldPreset === 'full'
              ? { callInput: true, callResultOutput: true, createResultCode: true }
              : {}),
          },
          transaction: request.include_transaction
            ? buildEvmTransactionFields(isL2Chain(dataset))
            : { transactionIndex: true, hash: true },
        },
        traces: [traceFilter],
      }

      const chunkSize = Math.max(
        1,
        Math.min(hasPortalFilters ? FILTERED_CHUNK_BLOCKS : UNFILTERED_CHUNK_BLOCKS, windowBlocks),
      )
      const maxScanBlocks = Math.min(
        windowBlocks,
        request.max_scan_blocks ??
          (hasPortalFilters ? DEFAULT_FILTERED_MAX_SCAN_BLOCKS : DEFAULT_UNFILTERED_MAX_SCAN_BLOCKS),
      )
      const cursorSkip = paginationCursor?.skip_inclusive_block ?? 0
      const targetCount = request.limit + cursorSkip + 1
      const scan = await scanBoundedBlockRange<TraceItem>({
        fromBlock: resolvedFromBlock,
        toBlock: pageToBlock,
        chunkSize,
        scanOrder: request.scan_order,
        maxScanBlocks,
        shouldContinue: (state) => state.items.length < targetCount,
        fetchChunk: async (chunk) => {
          const records = await portalFetchStreamRange(`${PORTAL_URL}/datasets/${dataset}/stream`, {
            ...query,
            fromBlock: chunk.fromBlock,
            toBlock: chunk.toBlock,
          })
          const traces = sortTraces(
            flattenTraces(records, {
              includeTransaction: request.include_transaction,
              transactionHash: request.transaction_hash,
            }),
          )
          return request.scan_order === 'latest' ? traces.reverse() : traces
        },
      })

      const collected = sortTraces([...scan.items])
      let pageItems: TraceItem[]
      let hasMore: boolean
      let nextCursor: string | undefined
      if (request.scan_order === 'latest') {
        const page = paginateAscendingItems(
          collected,
          request.limit,
          getBlockNumber,
          paginationCursor
            ? {
                page_to_block: paginationCursor.page_to_block,
                skip_inclusive_block: paginationCursor.skip_inclusive_block,
              }
            : undefined,
        )
        pageItems = page.pageItems
        const scanBounded = scan.hasUnscannedBlocks && !page.hasMore
        hasMore = page.hasMore || scanBounded
        const nextBoundary = page.hasMore
          ? page.nextBoundary
          : scanBounded
            ? { page_to_block: scan.scannedFromBlock - 1, skip_inclusive_block: 0 }
            : undefined
        nextCursor = nextBoundary
          ? encodeRecentPageCursor<QueryTracesRequest>({
              tool: TOOL_NAME,
              dataset,
              request,
              window_from_block: resolvedFromBlock,
              window_to_block: endBlock,
              page_to_block: nextBoundary.page_to_block,
              skip_inclusive_block: nextBoundary.skip_inclusive_block,
            })
          : undefined
      } else {
        /* A forward scan pages by offset: the cursor says how many rows of the
           window were already shown, and the next call re-scans from the window
           start past them. An unscanned remainder is not "more rows" here; it
           is reported through window_complete and the bounded-search notice,
           because a cursor could not reach past the same cap. */
        const page = paginateForwardItems(collected, request.limit, cursorSkip, endBlock)
        pageItems = page.pageItems
        hasMore = page.hasMore
        nextCursor = page.nextBoundary
          ? encodeRecentPageCursor<QueryTracesRequest>({
              tool: TOOL_NAME,
              dataset,
              request,
              window_from_block: resolvedFromBlock,
              window_to_block: endBlock,
              page_to_block: page.nextBoundary.page_to_block,
              skip_inclusive_block: page.nextBoundary.skip_inclusive_block,
            })
          : undefined
      }

      const formattedData = applyResponseFormat(pageItems, effectiveResponseFormat, 'traces')
      const notices = [...getTimestampWindowNotices(resolvedBlocks), ...getValidationNotices(validation)]
      if (!hasPortalFilters && !request.transaction_hash) {
        notices.push(
          'No trace filter was given; add call_to, call_from, method, create_from, or type for a faster and more specific scan.',
        )
      }
      const boundedNotice = buildBoundedSearchNotice(scan, 'Trace scan')
      if (boundedNotice) notices.push(boundedNotice)
      if (nextCursor) notices.push(buildCursorDirectionNotice(request.scan_order))

      const freshness = buildQueryFreshness({
        finality: request.finalized_only ? 'finalized' : 'latest',
        headBlockNumber: head.number,
        windowToBlock: endBlock,
        resolvedWindow: resolvedBlocks,
      })
      const coverage = buildQueryCoverage({
        windowFromBlock: resolvedFromBlock,
        windowToBlock: endBlock,
        pageToBlock: request.scan_order === 'earliest' ? scan.scannedToBlock : pageToBlock,
        items: pageItems,
        getBlockNumber,
        hasMore,
        windowComplete: !scan.hasUnscannedBlocks,
      })
      const subject = request.transaction_hash
        ? `traces of transaction ${request.transaction_hash}`
        : `${request.type?.length ? request.type.join('/') : 'EVM'} traces`
      const message =
        effectiveResponseFormat === 'summary'
          ? `Summary of ${pageItems.length} ${subject}${hasMore ? ' (preview page)' : ''}`
          : scan.hasUnscannedBlocks
            ? `Retrieved ${pageItems.length} ${subject} from the scanned ${scan.scannedBlocks.toLocaleString()} blocks; the rest of the window was not scanned`
            : `Retrieved ${pageItems.length} ${subject}${hasMore ? ` (preview page limited to ${request.limit})` : ''}`

      return formatResult(formattedData, message, {
        toolName: TOOL_NAME,
        notices,
        pagination: buildPaginationInfo(request.limit, pageItems.length, nextCursor),
        ordering: buildChronologicalPageOrdering({
          sortedBy: 'block_number',
          tieBreakers: ['transactionIndex', 'traceAddress'],
          ...(request.scan_order === 'earliest'
            ? { windowFocus: 'oldest_matches' as const, continuation: 'newer' as const }
            : {}),
        }),
        freshness,
        coverage,
        execution: {
          ...buildExecutionMetadata({
            response_format: effectiveResponseFormat,
            finalized_only: request.finalized_only,
            limit: request.limit,
            from_block: resolvedFromBlock,
            to_block: endBlock,
            page_to_block: pageToBlock,
            scan_order: request.scan_order,
            range_kind: resolvedBlocks.range_kind,
            normalized_output: true,
            notes: [
              'Trace rows carry the parent transaction hash and a deterministic id (hash plus trace address); action and result fields are flattened into call_from, call_to, value_eth, call_sighash, created_contract_address, and gas_used.',
              request.transaction_hash
                ? 'Traces were filtered to one transaction after the block scan; Portal has no transaction-hash trace filter.'
                : `Using ${request.field_preset} field preset.`,
            ],
          }),
          ...buildBoundedSearchExecution(scan),
        },
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
