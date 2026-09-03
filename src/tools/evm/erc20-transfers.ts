import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { resolveDataset, validateBlockRange } from '../../cache/datasets.js'
import { EVENT_SIGNATURES, PORTAL_URL } from '../../constants/index.js'
import {
  buildBoundedSearchExecution,
  buildBoundedSearchNotice,
  scanBoundedBlockRange,
} from '../../helpers/bounded-search.js'
import { detectChainType } from '../../helpers/chain.js'
import {
  type TokenListLookupMetadata,
  type TokenSymbolResolution,
  buildTokenListLookupNotices,
  getTokenMetadataMapForDatasetWithStatus,
  resolveTokenSymbolsForQuery,
} from '../../helpers/entity-resolution.js'
import { ActionableError, RequestCancelledError, createUnsupportedChainError } from '../../helpers/errors.js'
import { portalFetchRecentRecords, portalFetchStreamRange } from '../../helpers/fetch.js'
import { buildEvmLogFields } from '../../helpers/fields.js'
import { formatResult, formatTimestamp, formatTokenValue } from '../../helpers/format.js'
import { registerPortalTool } from '../../helpers/mcp-registration.js'
import { normalizeErc20TransferResult } from '../../helpers/normalized-results.js'
import {
  buildPaginationInfo,
  decodeRecentPageCursor,
  encodeRecentPageCursor,
  paginateAscendingItems,
} from '../../helpers/pagination.js'
import {
  buildChronologicalPageOrdering,
  buildQueryCoverage,
  buildQueryFreshness,
} from '../../helpers/result-metadata.js'
import { type TimestampInput, getTimestampWindowNotices, resolveTimeframeOrBlocks } from '../../helpers/timeframe.js'
import { buildExecutionMetadata, buildToolDescription } from '../../helpers/tool-ux.js'
import { buildMetricCard, buildPortalUi, buildTimelinePanel } from '../../helpers/ui-metadata.js'
import { quoteUntrusted } from '../../helpers/untrusted-text.js'
import { normalizeAddresses, normalizeEvmAddress } from '../../helpers/validation.js'
import type { BlockHead } from '../../types/index.js'

// ============================================================================
// Tool: Get ERC20 Transfers
// ============================================================================

export function registerGetErc20TransfersTool(server: McpServer) {
  type Erc20Request = {
    timeframe?: string
    from_block?: number
    to_block?: number
    from_timestamp?: TimestampInput
    to_timestamp?: TimestampInput
    limit: number
    token_addresses?: string[]
    token_symbols?: string[]
    max_token_symbol_matches?: number
    from_addresses?: string[]
    to_addresses?: string[]
    scan_order?: 'earliest' | 'latest'
    include_token_info: boolean
  }

  type Erc20Cursor = {
    tool: 'portal_evm_query_token_transfers'
    dataset: string
    request: Erc20Request
    window_from_block: number
    window_to_block: number
    page_to_block: number
    skip_inclusive_block: number
  }

  type Erc20TransferItem = Record<string, unknown> & {
    block_number?: number
    log_index?: number
    transaction_hash?: string
  }

  const buildTransferPresentation = (items: Erc20TransferItem[], nextCursor?: string) => {
    return {
      response: { page_summary: { visible_transfers: items.length }, items },
      ui: buildPortalUi({
        version: 'portal_ui_v1',
        layout: 'split',
        density: 'compact',
        design_intent: 'activity_investigator',
        headline: {
          title: 'Token transfers',
          subtitle: 'Exact onchain asset movements with full identifiers and units.',
        },
        metric_cards: [
          buildMetricCard({
            id: 'visible-transfers',
            label: 'Visible transfers',
            value_path: 'page_summary.visible_transfers',
            format: 'integer',
            emphasis: 'primary',
          }),
        ],
        panels: [
          buildTimelinePanel({
            id: 'transfer-timeline',
            kind: 'timeline_panel',
            title: 'Transfer timeline',
            subtitle: 'Chronological token movements for this page.',
            data_key: 'items',
            timestamp_key: 'timestamp_human',
            title_key: 'value_formatted',
            subtitle_keys: ['token_symbol', 'sender', 'recipient'],
            badge_key: 'record_type',
            emphasis: 'primary',
          }),
        ],
        follow_up_actions: [
          ...(nextCursor
            ? [{ label: 'Load older transfers', intent: 'continue' as const, target: '_pagination.next_cursor' }]
            : []),
          { label: 'Show raw rows', intent: 'show_raw', target: 'items' },
        ],
      }),
    }
  }

  const getBlockNumber = (item: Erc20TransferItem) =>
    typeof item.block_number === 'number' ? item.block_number : undefined
  const uniqueStrings = (values: string[]) => Array.from(new Set(values))
  const buildTokenResolutionNotices = (resolutions: TokenSymbolResolution[], unresolvedSymbols: string[]) => {
    const notices: string[] = []
    if (unresolvedSymbols.length > 0) {
      notices.push(`No token-list match found for symbol(s): ${unresolvedSymbols.join(', ')}.`)
    }
    for (const resolution of resolutions) {
      if (resolution.matches.length > 1) {
        notices.push(
          `Token symbol ${quoteUntrusted(resolution.symbol)} resolved to ${resolution.matches.length} token-list matches; all selected addresses were included. Use token_addresses for a single deterministic contract.`,
        )
      }
      if (resolution.truncated) {
        notices.push(
          `Token symbol ${quoteUntrusted(resolution.symbol)} had more matches than max_token_symbol_matches; results were capped.`,
        )
      }
    }
    return notices
  }
  const sortTransfers = (items: Erc20TransferItem[]) =>
    items.sort((left, right) => {
      const leftBlock = getBlockNumber(left) ?? 0
      const rightBlock = getBlockNumber(right) ?? 0
      if (leftBlock !== rightBlock) return leftBlock - rightBlock

      const leftIndex = typeof left.log_index === 'number' ? left.log_index : 0
      const rightIndex = typeof right.log_index === 'number' ? right.log_index : 0
      if (leftIndex !== rightIndex) return leftIndex - rightIndex

      return String(left.transaction_hash ?? '').localeCompare(String(right.transaction_hash ?? ''))
    })

  const fetchTransferBlocksByScanOrder = async ({
    url,
    query,
    fromBlock,
    toBlock,
    limit,
    chunkSize,
    scanOrder,
  }: {
    url: string
    query: Record<string, unknown>
    fromBlock: number
    toBlock: number
    limit: number
    chunkSize: number
    scanOrder: 'earliest' | 'latest'
  }) => {
    const records: unknown[] = []
    const targetCount = limit + 1
    let matchedLogs = 0

    const scan = await scanBoundedBlockRange<unknown>({
      fromBlock,
      toBlock,
      chunkSize,
      scanOrder,
      shouldContinue: () => matchedLogs < targetCount,
      fetchChunk: async (chunkBounds) => {
        const chunk = await portalFetchStreamRange(url, {
          ...query,
          fromBlock: chunkBounds.fromBlock,
          toBlock: chunkBounds.toBlock,
        })
        matchedLogs += chunk.reduce<number>((sum, block: unknown) => {
          const logs = (block as { logs?: unknown[] })?.logs
          return sum + (Array.isArray(logs) ? logs.length : 0)
        }, 0)
        return chunk
      },
      mergeChunkItems: scanOrder === 'latest' ? (existing, chunk) => [...chunk, ...existing] : undefined,
    })
    records.push(...scan.items)

    return { ...scan, records, hasMore: matchedLogs > limit }
  }

  registerPortalTool(
    server,
    'portal_evm_query_token_transfers',
    buildToolDescription('portal_evm_query_token_transfers'),
    {
      network: z.string().optional().describe('Network name or alias. Optional when continuing with cursor.'),
      from_block: z.number().optional().describe('Starting block number'),
      to_block: z.number().optional().describe('Ending block number. RECOMMENDED: <10k blocks for fast responses.'),
      timeframe: z.string().optional().describe("Time range (e.g., '1h', '24h'). Alternative to block numbers."),
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
      token_addresses: z.array(z.string()).optional().describe('Token contract addresses'),
      token_symbols: z
        .array(z.string())
        .optional()
        .describe('Token symbols to resolve via open token-list data, e.g. ["USDC"]. Merges with token_addresses.'),
      max_token_symbol_matches: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe(
          'Maximum token-list matches to include per token symbol. Use token_addresses for deterministic single-contract filters.',
        ),
      from_addresses: z.array(z.string()).optional().describe('Sender addresses'),
      to_addresses: z.array(z.string()).optional().describe('Recipient addresses'),
      scan_order: z
        .enum(['latest', 'earliest'])
        .optional()
        .default('latest')
        .describe('Which side of the block window to scan first. Use earliest for first-transfer questions.'),
      limit: z.number().optional().default(50).describe('Max transfers'),
      include_token_info: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include token metadata (symbol, decimals) inline. Avoids separate token metadata lookups.'),
      cursor: z.string().optional().describe('Continuation cursor from a previous response'),
    },
    async ({
      network,
      timeframe,
      from_block,
      to_block,
      from_timestamp,
      to_timestamp,
      token_addresses,
      token_symbols,
      max_token_symbol_matches,
      from_addresses,
      to_addresses,
      scan_order,
      limit,
      include_token_info,
      cursor,
    }) => {
      const queryStartTime = Date.now()
      const paginationCursor = cursor
        ? decodeRecentPageCursor<Erc20Request>(cursor, 'portal_evm_query_token_transfers')
        : undefined
      let dataset = paginationCursor?.dataset ?? (network ? await resolveDataset(network) : undefined)
      if (!dataset) {
        throw new Error('network is required unless you are continuing with cursor.')
      }
      const chainType = detectChainType(dataset)

      if (chainType !== 'evm') {
        throw createUnsupportedChainError({
          toolName: 'portal_evm_query_token_transfers',
          dataset,
          actualChainType: chainType,
          supportedChains: ['evm'],
          suggestions: [
            'Use portal_solana_query_instructions for Solana token program activity.',
            'Use portal_bitcoin_query_transactions with include_outputs for Bitcoin value movement.',
          ],
        })
      }
      if (paginationCursor) {
        dataset = paginationCursor.dataset
        timeframe = paginationCursor.request.timeframe
        from_block = paginationCursor.request.from_block
        to_block = paginationCursor.request.to_block
        from_timestamp = paginationCursor.request.from_timestamp
        to_timestamp = paginationCursor.request.to_timestamp
        limit = paginationCursor.request.limit
        token_addresses = paginationCursor.request.token_addresses
        token_symbols = paginationCursor.request.token_symbols
        max_token_symbol_matches = paginationCursor.request.max_token_symbol_matches ?? 5
        from_addresses = paginationCursor.request.from_addresses
        to_addresses = paginationCursor.request.to_addresses
        scan_order = paginationCursor.request.scan_order ?? 'latest'
        include_token_info = paginationCursor.request.include_token_info
      }
      if (!paginationCursor && from_block === undefined && timeframe === undefined && from_timestamp === undefined) {
        throw new ActionableError(
          'portal_evm_query_token_transfers requires from_block, timeframe, or from_timestamp unless you are continuing with cursor.',
          [
            'Provide from_block for a fresh query.',
            'Or use timeframe for a recent window like "1h".',
            'Or use from_timestamp/to_timestamp for a natural time window.',
            'Reuse _pagination.next_cursor from a previous response to continue paging.',
          ],
        )
      }

      const normalizedTokenAddressFilters = normalizeAddresses(token_addresses, chainType) ?? []
      let tokenSymbolResolutions: TokenSymbolResolution[] = []
      let unresolvedTokenSymbols: string[] = []
      let resolvedTokenSymbolAddresses: string[] = []
      let tokenSymbolLookup: TokenListLookupMetadata | undefined
      if (!paginationCursor && token_symbols && token_symbols.length > 0) {
        const resolvedSymbols = await resolveTokenSymbolsForQuery({
          dataset,
          symbols: token_symbols,
          maxMatchesPerSymbol: max_token_symbol_matches,
        })
        tokenSymbolResolutions = resolvedSymbols.resolutions
        unresolvedTokenSymbols = resolvedSymbols.unresolved_symbols
        resolvedTokenSymbolAddresses = resolvedSymbols.addresses
        tokenSymbolLookup = resolvedSymbols.lookup
        if (resolvedTokenSymbolAddresses.length === 0 && normalizedTokenAddressFilters.length === 0) {
          throw new ActionableError(
            `No token-list matches found for token_symbols: ${token_symbols.map((symbol) => quoteUntrusted(symbol)).join(', ')}.`,
            [
              'Use portal_resolve_entity to inspect available token-list matches.',
              'Pass token_addresses directly if you know the exact contract address.',
              'Check the network name; supported token symbols differ across chains.',
            ],
          )
        }
      }
      const normalizedTokens = uniqueStrings([...normalizedTokenAddressFilters, ...resolvedTokenSymbolAddresses])
      const tokenFilterAddresses = normalizedTokens.length > 0 ? normalizedTokens : undefined
      const normalizedFrom = from_addresses
        ? from_addresses.map((a) => '0x' + normalizeEvmAddress(a).slice(2).padStart(64, '0'))
        : undefined
      const normalizedTo = to_addresses
        ? to_addresses.map((a) => '0x' + normalizeEvmAddress(a).slice(2).padStart(64, '0'))
        : undefined

      const resolvedBlocks = paginationCursor
        ? {
            from_block: paginationCursor.window_from_block,
            to_block: paginationCursor.window_to_block,
            range_kind:
              paginationCursor.request.from_timestamp !== undefined ||
              paginationCursor.request.to_timestamp !== undefined
                ? 'timestamp_range'
                : paginationCursor.request.timeframe
                  ? 'timeframe'
                  : 'block_range',
          }
        : await resolveTimeframeOrBlocks({
            dataset,
            timeframe,
            from_block,
            to_block,
            from_timestamp,
            to_timestamp,
          })
      const resolvedFromBlock = resolvedBlocks.from_block
      const resolvedToBlock = resolvedBlocks.to_block
      const { validatedToBlock: endBlock, head } = await validateBlockRange(
        dataset,
        resolvedFromBlock,
        resolvedToBlock ?? Number.MAX_SAFE_INTEGER,
        false,
      )
      const pageToBlock = paginationCursor?.page_to_block ?? endBlock

      const logFilter: Record<string, unknown> = {
        topic0: [EVENT_SIGNATURES.TRANSFER_ERC20],
      }
      if (tokenFilterAddresses) logFilter.address = tokenFilterAddresses
      if (normalizedFrom) logFilter.topic1 = normalizedFrom
      if (normalizedTo) logFilter.topic2 = normalizedTo

      const query = {
        type: 'evm',
        fromBlock: resolvedFromBlock,
        toBlock: pageToBlock,
        fields: {
          block: { number: true, timestamp: true },
          log: buildEvmLogFields(),
        },
        logs: [logFilter],
      }

      const hasAddressFilters = !!(tokenFilterAddresses || normalizedFrom || normalizedTo)
      const cursorSkip = paginationCursor?.skip_inclusive_block ?? 0
      const fetchLimit = limit + cursorSkip + 1
      const portalUrl = `${PORTAL_URL}/datasets/${dataset}/stream`
      const scanResult =
        scan_order === 'earliest'
          ? await fetchTransferBlocksByScanOrder({
              url: portalUrl,
              query,
              fromBlock: resolvedFromBlock,
              toBlock: pageToBlock,
              limit: fetchLimit,
              chunkSize: hasAddressFilters ? 500 : 100,
              scanOrder: scan_order,
            })
          : undefined
      const results = scanResult
        ? scanResult.records
        : await portalFetchRecentRecords(portalUrl, query, {
            itemKeys: ['logs'],
            limit: fetchLimit,
            chunkSize: hasAddressFilters ? 500 : 100,
          })

      let tokenMetadataByAddress = new Map<string, { symbol?: string; name?: string; decimals?: number }>()
      let tokenMetadataLookup: TokenListLookupMetadata | undefined
      let tokenMetadataFetchFailed = false
      if (tokenFilterAddresses || include_token_info) {
        try {
          const tokenMetadataResult = await getTokenMetadataMapForDatasetWithStatus(dataset)
          tokenMetadataByAddress = tokenMetadataResult.metadata
          tokenMetadataLookup = tokenMetadataResult.lookup
        } catch (error) {
          if (error instanceof RequestCancelledError) throw error
          tokenMetadataFetchFailed = true
          console.error('Failed to fetch token-list metadata:', error)
        }
      }

      const allTransfers = sortTransfers(
        results.flatMap((block: unknown) => {
          const b = block as {
            header?: { number: number; timestamp: number }
            logs?: Array<{
              transactionHash: string
              logIndex: number
              address: string
              topics?: string[]
              data: string
            }>
          }
          return (b.logs || []).map((log) => {
            const tokenAddress = log.address
            const tokenInfo = tokenMetadataByAddress.get(tokenAddress.toLowerCase())
            const decimals = tokenInfo?.decimals ?? 18
            const valueFormatted = formatTokenValue(log.data, decimals, tokenInfo?.symbol)

            return {
              block_number: b.header?.number,
              timestamp: b.header?.timestamp,
              timestamp_human: b.header?.timestamp ? formatTimestamp(b.header.timestamp) : undefined,
              transaction_hash: log.transactionHash,
              log_index: log.logIndex,
              token_address: tokenAddress,
              from: '0x' + (log.topics?.[1]?.slice(-40) || ''),
              to: '0x' + (log.topics?.[2]?.slice(-40) || ''),
              value: log.data,
              value_decimal: valueFormatted.decimal,
              value_formatted: valueFormatted.formatted,
            }
          })
        }) as Erc20TransferItem[],
      ).map((item) => normalizeErc20TransferResult(item))
      // paginateAscendingItems keeps the newest rows of an ascending list, which
      // is the right page for a backward scan. A forward scan collects the
      // oldest rows in the window, so keeping its tail answered "the first
      // transfers" with the newest rows of the scanned region: asking for fewer
      // rows returned later ones.
      const page = scanResult
        ? {
            pageItems: allTransfers.slice(0, limit),
            hasMore: allTransfers.length > limit,
            nextBoundary: undefined,
          }
        : paginateAscendingItems(
            allTransfers,
            limit,
            getBlockNumber,
            paginationCursor
              ? {
                  page_to_block: paginationCursor.page_to_block,
                  skip_inclusive_block: paginationCursor.skip_inclusive_block,
                }
              : undefined,
          )
      const nextCursor =
        !scanResult && page.hasMore && page.nextBoundary
          ? encodeRecentPageCursor<Erc20Request>({
              tool: 'portal_evm_query_token_transfers',
              dataset,
              request: {
                ...(timeframe ? { timeframe } : {}),
                ...(from_block !== undefined ? { from_block } : {}),
                ...(to_block !== undefined ? { to_block } : {}),
                ...(from_timestamp !== undefined ? { from_timestamp } : {}),
                ...(to_timestamp !== undefined ? { to_timestamp } : {}),
                limit,
                ...(tokenFilterAddresses ? { token_addresses: tokenFilterAddresses } : {}),
                ...(token_symbols ? { token_symbols } : {}),
                ...(max_token_symbol_matches !== undefined ? { max_token_symbol_matches } : {}),
                ...(from_addresses ? { from_addresses } : {}),
                ...(to_addresses ? { to_addresses } : {}),
                scan_order,
                include_token_info,
              },
              window_from_block: resolvedFromBlock,
              window_to_block: endBlock,
              page_to_block: page.nextBoundary.page_to_block,
              skip_inclusive_block: page.nextBoundary.skip_inclusive_block,
            })
          : undefined

      let enrichedTransfers = page.pageItems
      if (include_token_info) {
        enrichedTransfers = page.pageItems.map((transfer: any) => {
          const tokenInfo = tokenMetadataByAddress.get(String(transfer.token_address ?? '').toLowerCase())
          if (!tokenInfo) return transfer
          return {
            ...transfer,
            token_symbol: tokenInfo.symbol,
            token_name: tokenInfo.name,
            token_decimals: tokenInfo.decimals,
          }
        })
      }
      const notices = [
        ...getTimestampWindowNotices(resolvedBlocks),
        ...buildTokenResolutionNotices(tokenSymbolResolutions, unresolvedTokenSymbols),
        ...buildTokenListLookupNotices(tokenSymbolLookup),
        ...buildTokenListLookupNotices(tokenMetadataLookup),
      ]
      if (tokenMetadataFetchFailed)
        notices.push('Token-list metadata enrichment failed; raw values were formatted with 18 decimals as a fallback.')
      if (nextCursor) notices.push('Older results are available via _pagination.next_cursor.')
      if (scanResult && page.hasMore)
        notices.push(
          `More matching transfers exist in the scanned ${scanResult.scannedFromBlock}-${scanResult.scannedToBlock} block slice; narrow filters or reduce limit pressure before expanding the window.`,
        )
      const boundedSearchNotice = scanResult ? buildBoundedSearchNotice(scanResult, 'ERC20 transfer scan') : undefined
      if (boundedSearchNotice) notices.push(boundedSearchNotice)
      const freshness = buildQueryFreshness({
        finality: 'latest',
        headBlockNumber: head.number,
        windowToBlock: endBlock,
        resolvedWindow: resolvedBlocks,
      })
      const coverage = buildQueryCoverage({
        windowFromBlock: resolvedFromBlock,
        windowToBlock: endBlock,
        pageToBlock: scanResult && scan_order === 'earliest' ? scanResult.scannedToBlock : pageToBlock,
        items: enrichedTransfers,
        getBlockNumber,
        hasMore: page.hasMore,
        // The forward scan emits no cursor, so claiming one would point a
        // client at a continuation that does not exist.
        ...(scanResult ? { continuation: 'none' as const } : {}),
      })

      const presentation = buildTransferPresentation(enrichedTransfers as Erc20TransferItem[], nextCursor)

      return formatResult(
        presentation.response,
        scanResult
          ? `Retrieved ${page.pageItems.length} ERC20 transfers by scanning forward from the start of the window`
          : `Retrieved ${page.pageItems.length} ERC20 transfers${page.hasMore ? ` from the most recent matching blocks (preview page limited to ${limit})` : ''}`,
        {
          toolName: 'portal_evm_query_token_transfers',
          notices,
          pagination: buildPaginationInfo(limit, page.pageItems.length, nextCursor, {
            ...(scanResult && page.hasMore ? { hasMoreWithoutCursor: true } : {}),
          }),
          ordering: buildChronologicalPageOrdering({
            sortedBy: 'block_number',
            tieBreakers: ['log_index', 'transaction_index', 'tx_hash'],
            ...(scanResult ? { windowFocus: 'oldest_matches' as const, continuation: 'newer' as const } : {}),
          }),
          freshness,
          coverage,
          execution: {
            ...buildExecutionMetadata({
              limit,
              from_block: resolvedFromBlock,
              to_block: endBlock,
              page_to_block: pageToBlock,
              scan_order,
              range_kind: resolvedBlocks.range_kind,
              normalized_output: true,
              notes: [
                token_symbols && token_symbols.length > 0
                  ? 'token_symbols were resolved from open token-list data and merged into token_addresses.'
                  : undefined,
                include_token_info
                  ? 'Token metadata was enriched inline from open token-list data.'
                  : 'Token metadata enrichment was disabled for a lighter response.',
              ].filter((note): note is string => Boolean(note)),
            }),
            ...(scanResult ? buildBoundedSearchExecution(scanResult) : {}),
          },
          ui: presentation.ui,
          llm: {
            compact: true,
            answer_sequence: ['page_summary', 'items', '_pagination.next_cursor'],
            parser_notes: [
              'items contains the exact chronological transfer page; value_formatted carries the decoded token amount and symbol when metadata is available.',
            ],
          },
          metadata: {
            network: dataset,
            dataset,
            from_block: resolvedFromBlock,
            to_block: pageToBlock,
            query_start_time: queryStartTime,
          },
        },
      )
    },
  )
}
