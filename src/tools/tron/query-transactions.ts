import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { validateBlockRange } from '../../cache/datasets.js'
import { PORTAL_URL } from '../../constants/index.js'
import { resolveMethodSighashes } from '../../helpers/evm-aliases.js'
import { portalFetchRecentRecords } from '../../helpers/fetch.js'
import {
  buildTronBlockFields,
  buildTronInternalTransactionFields,
  buildTronLogFields,
  buildTronTransactionFields,
} from '../../helpers/fields.js'
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
import { encodeTronAssetFilter, normalizeTronAddresses, normalizeTronHex, stripHexPrefix } from '../../helpers/tron.js'
import {
  TRON_DEFAULT_MAX_SCAN_BLOCKS,
  flattenTronTransactions,
  getTronBlockNumber,
  resolveTronDataset,
  sortTronTransactions,
  toTronInputError,
  tronChunkSize,
  tronValidationError,
} from './shared.js'

const TOOL_NAME = 'portal_tron_query_transactions'

const TRON_KINDS = ['auto', 'all', 'transfer', 'transfer_asset', 'trigger_smart_contract'] as const
type TronKind = (typeof TRON_KINDS)[number]
type ResolvedTronKind = Exclude<TronKind, 'auto'>

type TronTransactionsRequest = {
  timeframe?: string
  from_timestamp?: TimestampInput
  to_timestamp?: TimestampInput
  limit: number
  finalized_only: boolean
  kind: ResolvedTronKind
  types?: string[]
  from_addresses?: string[]
  to_addresses?: string[]
  contract_addresses?: string[]
  sighash?: string[]
  asset?: string[]
  include_logs: boolean
  include_internal_transactions: boolean
  max_scan_blocks?: number
  response_format: ResponseFormat
}

const KIND_LABELS: Record<ResolvedTronKind, string> = {
  all: 'transactions of any contract type',
  transfer: 'native TRX transfers',
  transfer_asset: 'TRC-10 asset transfers',
  trigger_smart_contract: 'smart-contract calls',
}

function resolveKind(
  requested: TronKind,
  filters: { from: boolean; to: boolean; contract: boolean; sighash: boolean; asset: boolean; types: boolean },
): { kind: ResolvedTronKind; note?: string } {
  if (requested !== 'auto') return { kind: requested }
  if (filters.asset) return { kind: 'transfer_asset', note: 'kind inferred as transfer_asset from the asset filter.' }
  if (filters.contract || filters.sighash) {
    return {
      kind: 'trigger_smart_contract',
      note: 'kind inferred as trigger_smart_contract from the contract or method filter.',
    }
  }
  if (filters.to || filters.from) {
    return {
      kind: 'transfer',
      note: 'kind inferred as transfer (native TRX) from the address filter; set kind=trigger_smart_contract for contract calls by the same wallet.',
    }
  }
  if (filters.types) return { kind: 'all' }
  return { kind: 'all' }
}

function assertKindFilters(
  kind: ResolvedTronKind,
  filters: { from: boolean; to: boolean; contract: boolean; sighash: boolean; asset: boolean; types: boolean },
) {
  const reject = (what: string, fix: string) =>
    tronValidationError(`${what} cannot be used together with kind=${kind} (${KIND_LABELS[kind]}).`, [fix])
  if (kind === 'all') {
    if (filters.from || filters.to || filters.contract || filters.sighash || filters.asset) {
      throw reject(
        'Address, contract, method, and asset filters',
        'Portal filters unrestricted Tron transactions by contract type only. Choose kind=transfer, kind=transfer_asset, or kind=trigger_smart_contract for those filters, or keep kind=all with types only.',
      )
    }
    return
  }
  if (filters.types) throw reject('types', 'The types filter applies to kind=all only.')
  if (kind === 'transfer' && (filters.contract || filters.sighash || filters.asset)) {
    throw reject(
      'Contract, method, and asset filters',
      'Native TRX transfers accept from_addresses and to_addresses only.',
    )
  }
  if (kind === 'transfer_asset' && (filters.contract || filters.sighash)) {
    throw reject('Contract and method filters', 'TRC-10 transfers accept from_addresses, to_addresses, and asset.')
  }
  if (kind === 'trigger_smart_contract' && (filters.to || filters.asset)) {
    throw reject(
      'to_addresses and asset',
      'Smart-contract calls accept from_addresses (caller), contract_addresses, and method or sighash; the called contract is the recipient.',
    )
  }
}

export function registerTronQueryTransactionsTool(server: McpServer) {
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
      kind: z
        .enum(TRON_KINDS)
        .optional()
        .default('auto')
        .describe(
          'Which Tron transaction family to query: transfer (native TRX), transfer_asset (TRC-10), trigger_smart_contract (contract calls), all (any contract type, filter by types only). auto picks from the filters you pass.',
        ),
      types: z
        .array(z.string())
        .optional()
        .describe(
          'FILTER (kind=all): Tron contract types such as TransferContract, TriggerSmartContract, DelegateResourceContract.',
        ),
      from_addresses: z
        .array(z.string())
        .optional()
        .describe(
          'FILTER: sender or caller addresses. Accepts Base58 (T...), 41-prefixed hex, or 0x/bare 20-byte hex.',
        ),
      to_addresses: z
        .array(z.string())
        .optional()
        .describe('FILTER (transfer, transfer_asset): recipient addresses in any accepted form.'),
      contract_addresses: z
        .array(z.string())
        .optional()
        .describe('FILTER (trigger_smart_contract): called contract addresses in any accepted form, e.g. USDT.'),
      method: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          'FILTER (trigger_smart_contract): method alias such as transfer, approve, transferFrom, or a 4-byte sighash.',
        ),
      sighash: z
        .array(z.string())
        .optional()
        .describe('FILTER (trigger_smart_contract): 4-byte method selectors, with or without 0x. Merges with method.'),
      asset: z
        .array(z.string())
        .optional()
        .describe('FILTER (transfer_asset): TRC-10 asset id such as 1005157, or the raw hex asset name.'),
      include_logs: z.boolean().optional().default(false).describe('Attach the event logs each transaction emitted'),
      include_internal_transactions: z
        .boolean()
        .optional()
        .default(false)
        .describe('Attach the internal transactions of each transaction'),
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
          "Response format: defaults to 'compact' for chat-friendly output. Use 'summary' for counts by type, TRX moved, and top callers.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .default(20)
        .describe('Max transactions to return (default: 20, max: 25)'),
      cursor: z.string().optional().describe('Continuation cursor from a previous response'),
    },
    async (args) => {
      const queryStartTime = Date.now()
      const paginationCursor = args.cursor
        ? decodeRecentPageCursor<TronTransactionsRequest>(args.cursor, TOOL_NAME)
        : undefined
      const dataset = paginationCursor?.dataset ?? (await resolveTronDataset(TOOL_NAME, args.network))

      let request: TronTransactionsRequest
      const notes: string[] = []
      if (paginationCursor) {
        request = paginationCursor.request
      } else {
        try {
          const from = normalizeTronAddresses(args.from_addresses, 'transaction')
          const to = normalizeTronAddresses(args.to_addresses, 'transaction')
          const contract = normalizeTronAddresses(args.contract_addresses, 'transaction')
          const sighash = Array.from(
            new Set([
              ...(args.sighash ?? []).map((value) => normalizeTronHex(value, 4, 'sighash')),
              ...resolveMethodSighashes(args.method).map((value) => stripHexPrefix(value)),
            ]),
          )
          const asset = args.asset?.map((value) => encodeTronAssetFilter(value))
          const types = args.types?.map((value) => value.trim()).filter((value) => value.length > 0)
          const filters = {
            from: Boolean(from?.length),
            to: Boolean(to?.length),
            contract: Boolean(contract?.length),
            sighash: sighash.length > 0,
            asset: Boolean(asset?.length),
            types: Boolean(types?.length),
          }
          const resolved = resolveKind(args.kind, filters)
          assertKindFilters(resolved.kind, filters)
          if (resolved.note) notes.push(resolved.note)
          request = {
            ...(args.timeframe ? { timeframe: args.timeframe } : {}),
            ...(args.from_timestamp !== undefined ? { from_timestamp: args.from_timestamp } : {}),
            ...(args.to_timestamp !== undefined ? { to_timestamp: args.to_timestamp } : {}),
            limit: args.limit,
            finalized_only: args.finalized_only,
            kind: resolved.kind,
            ...(types?.length ? { types } : {}),
            ...(from ? { from_addresses: from } : {}),
            ...(to ? { to_addresses: to } : {}),
            ...(contract ? { contract_addresses: contract } : {}),
            ...(sighash.length > 0 ? { sighash } : {}),
            ...(asset?.length ? { asset } : {}),
            include_logs: args.include_logs,
            include_internal_transactions: args.include_internal_transactions,
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

      const inline = {
        ...(request.include_logs ? { logs: true } : {}),
        ...(request.include_internal_transactions ? { internalTransactions: true } : {}),
      }
      const filtered = Boolean(
        request.from_addresses ||
          request.to_addresses ||
          request.contract_addresses ||
          request.sighash ||
          request.asset,
      )
      const dataKey =
        request.kind === 'transfer'
          ? 'transferTransactions'
          : request.kind === 'transfer_asset'
            ? 'transferAssetTransactions'
            : request.kind === 'trigger_smart_contract'
              ? 'triggerSmartContractTransactions'
              : 'transactions'
      const filter =
        request.kind === 'transfer'
          ? { owner: request.from_addresses, to: request.to_addresses, ...inline }
          : request.kind === 'transfer_asset'
            ? { owner: request.from_addresses, to: request.to_addresses, asset: request.asset, ...inline }
            : request.kind === 'trigger_smart_contract'
              ? {
                  owner: request.from_addresses,
                  contract: request.contract_addresses,
                  sighash: request.sighash,
                  ...inline,
                }
              : { type: request.types, ...inline }
      const cleanFilter = Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined))

      const query = {
        type: 'tron',
        fromBlock: resolvedFromBlock,
        toBlock: pageToBlock,
        fields: {
          block: buildTronBlockFields(),
          transaction: buildTronTransactionFields(),
          ...(request.include_logs ? { log: buildTronLogFields() } : {}),
          ...(request.include_internal_transactions
            ? { internalTransaction: buildTronInternalTransactionFields() }
            : {}),
        },
        [dataKey]: [cleanFilter],
      }

      const chunkSize = tronChunkSize(filtered || Boolean(request.types?.length))
      const windowBlocks = pageToBlock - resolvedFromBlock + 1
      const maxScanBlocks = Math.min(windowBlocks, request.max_scan_blocks ?? TRON_DEFAULT_MAX_SCAN_BLOCKS)
      const maxChunks = Math.max(1, Math.ceil(maxScanBlocks / chunkSize))
      const cursorSkip = paginationCursor?.skip_inclusive_block ?? 0
      const results = await portalFetchRecentRecords(`${PORTAL_URL}/datasets/${dataset}/stream`, query, {
        itemKeys: ['transactions'],
        limit: request.limit + cursorSkip + 1,
        chunkSize,
        maxChunks,
      })
      const scannedFromBlock = Math.max(resolvedFromBlock, pageToBlock - maxChunks * chunkSize + 1)

      const allTransactions = sortTronTransactions(
        flattenTronTransactions(results, {
          includeLogs: request.include_logs,
          includeInternalTransactions: request.include_internal_transactions,
        }),
      )
      const page = paginateAscendingItems(
        allTransactions,
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
        ? encodeRecentPageCursor<TronTransactionsRequest>({
            tool: TOOL_NAME,
            dataset,
            request,
            window_from_block: resolvedFromBlock,
            window_to_block: endBlock,
            page_to_block: nextBoundary.page_to_block,
            skip_inclusive_block: nextBoundary.skip_inclusive_block,
          })
        : undefined

      const formattedData = applyResponseFormat(page.pageItems, effectiveResponseFormat, 'tron_transactions')
      const notices = getTimestampWindowNotices(resolvedBlocks)
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
        // A bounded scan only reads back to scannedFromBlock, so the requested
        // window was not fully analyzed. buildQueryCoverage defaults this to
        // true, which claimed complete coverage of a window it never read.
        windowComplete: scannedFromBlock <= resolvedFromBlock,
      })
      const label = KIND_LABELS[request.kind]
      const message =
        effectiveResponseFormat === 'summary'
          ? `Summary of ${page.pageItems.length} Tron ${label}${hasMore ? ' (latest preview page)' : ''}`
          : `Retrieved ${page.pageItems.length} Tron ${label}${hasMore ? ` from the most recent matching blocks (preview page limited to ${request.limit})` : ''}`

      return formatResult(formattedData, message, {
        toolName: TOOL_NAME,
        notices,
        pagination: buildPaginationInfo(request.limit, page.pageItems.length, nextCursor),
        ordering: buildChronologicalPageOrdering({
          sortedBy: 'block_number',
          tieBreakers: ['transactionIndex', 'hash'],
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
          estimated_scan_blocks: Math.min(windowBlocks, maxChunks * chunkSize),
          normalized_output: true,
          notes: [
            `Native Tron query (${dataKey}); addresses were normalized to the 41-prefixed hex Portal expects and are also shown as Base58.`,
            'Amounts are decoded from SUN to exact TRX; timestamps are Unix milliseconds on the raw record and seconds on the aliases.',
            ...notes,
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
