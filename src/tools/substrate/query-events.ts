import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { resolveDataset, validateBlockRange } from '../../cache/datasets.js'
import { PORTAL_URL } from '../../constants/index.js'
import { detectChainType } from '../../helpers/chain.js'
import { createUnsupportedChainError } from '../../helpers/errors.js'
import { portalFetchRecentRecords } from '../../helpers/fetch.js'
import {
  buildSubstrateBlockFields,
  buildSubstrateCallFields,
  buildSubstrateEventFields,
  buildSubstrateExtrinsicFields,
} from '../../helpers/fields.js'
import { formatResult } from '../../helpers/format.js'
import { registerPortalTool } from '../../helpers/mcp-registration.js'
import { normalizeSubstrateEventResult } from '../../helpers/normalized-results.js'
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
import { buildMetricCard, buildPortalUi, buildTimelinePanel } from '../../helpers/ui-metadata.js'
import { getValidationNotices, validateSubstrateQuerySize } from '../../helpers/validation.js'
import {
  SUBSTRATE_INDEXING_NOTICE,
  type SubstrateEventRequest,
  buildSubstrateWindowLabel,
  flattenSubstrateEvents,
  getSubstrateEventIndex,
} from './shared.js'

type SubstrateEventCursor = {
  tool: 'portal_substrate_query_events'
  dataset: string
  request: SubstrateEventRequest
  window_from_block: number
  window_to_block: number
  page_to_block: number
  skip_inclusive_block: number
}

type SubstrateEventItem = Record<string, unknown> & {
  block_number?: number
  index?: number
  event_index?: number
  primary_id?: string
}

function getBlockNumber(item: SubstrateEventItem) {
  return typeof item.block_number === 'number' ? item.block_number : undefined
}

function sortEvents(items: SubstrateEventItem[]) {
  return items.sort((left, right) => {
    const leftBlock = getBlockNumber(left) ?? 0
    const rightBlock = getBlockNumber(right) ?? 0
    if (leftBlock !== rightBlock) return leftBlock - rightBlock

    const leftIndex = getSubstrateEventIndex(left)
    const rightIndex = getSubstrateEventIndex(right)
    if (leftIndex !== rightIndex) return leftIndex - rightIndex

    return String(left.primary_id ?? '').localeCompare(String(right.primary_id ?? ''))
  })
}

function buildSubstrateEventPresentation(data: unknown, visibleCount: number, nextCursor?: string) {
  const items = Array.isArray(data) ? (data as SubstrateEventItem[]) : undefined
  const response = items
    ? { page_summary: { visible_events: visibleCount }, items }
    : {
        ...(data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}),
        page_summary: { visible_events: visibleCount },
      }

  return {
    response,
    ui: buildPortalUi({
      version: 'portal_ui_v1',
      layout: 'split',
      density: 'compact',
      design_intent: 'activity_investigator',
      headline: { title: 'Substrate events', subtitle: 'Indexed events with freshness.' },
      metric_cards: [
        buildMetricCard({
          id: 'visible-events',
          label: 'Visible events',
          value_path: 'page_summary.visible_events',
          format: 'integer',
          emphasis: 'primary',
        }),
      ],
      panels: items
        ? [
            buildTimelinePanel({
              id: 'substrate-event-timeline',
              kind: 'timeline_panel',
              title: 'Event timeline',
              data_key: 'items',
              timestamp_key: 'timestamp_human',
              title_key: 'name',
              subtitle_keys: ['block_number', 'primary_id'],
              badge_key: 'record_type',
              emphasis: 'primary',
            }),
          ]
        : [],
      follow_up_actions: [
        ...(nextCursor
          ? [{ label: 'Load older events', intent: 'continue' as const, target: '_pagination.next_cursor' }]
          : []),
        ...(items ? [{ label: 'Show raw rows', intent: 'show_raw' as const, target: 'items' }] : []),
      ],
    }),
  }
}

export function registerSubstrateQueryEventsTool(server: McpServer) {
  registerPortalTool(
    server,
    'portal_substrate_query_events',
    buildToolDescription('portal_substrate_query_events'),
    {
      network: z.string().optional().describe('Substrate network name or alias. Optional when continuing with cursor.'),
      timeframe: z.string().optional().describe("Time range (e.g. '1h', '24h'). Alternative to from_block/to_block."),
      from_block: z.number().optional().describe('Starting block number'),
      to_block: z.number().optional().describe('Ending block number'),
      from_timestamp: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          'Starting timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input like "6h ago".',
        ),
      to_timestamp: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          'Ending timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input like "now".',
        ),
      finalized_only: z.boolean().optional().default(false).describe('Only query finalized blocks'),
      event_names: z
        .array(z.string())
        .optional()
        .describe('Optional qualified event names like Balances.Transfer or System.ExtrinsicSuccess'),
      include_extrinsic: z
        .boolean()
        .optional()
        .default(false)
        .describe('Attach the parent extrinsic inline for each matching event'),
      include_call: z
        .boolean()
        .optional()
        .default(false)
        .describe('Attach the emitting call inline when the event has call context'),
      include_stack: z
        .boolean()
        .optional()
        .default(false)
        .describe('Attach the parent call stack when the event has nested call context'),
      response_format: z
        .enum(['full', 'compact', 'summary'])
        .optional()
        .describe(
          "Response format: defaults to 'compact' for chat-friendly output. Compact mode keeps requested extrinsic or call context in a smaller inline shape.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(10)
        .describe('Max events to return (max: 10; use compact mode for context-rich rows)'),
      cursor: z.string().optional().describe('Continuation cursor from a previous response'),
    },
    async ({
      network,
      timeframe,
      from_block,
      to_block,
      from_timestamp,
      to_timestamp,
      finalized_only,
      event_names,
      include_extrinsic,
      include_call,
      include_stack,
      response_format,
      limit,
      cursor,
    }) => {
      const queryStartTime = Date.now()
      const paginationCursor = cursor
        ? decodeRecentPageCursor<SubstrateEventRequest>(cursor, 'portal_substrate_query_events')
        : undefined

      let dataset = paginationCursor?.dataset ?? (network ? await resolveDataset(network) : undefined)
      if (!dataset) {
        throw new Error('network is required unless you are continuing with cursor.')
      }
      const chainType = detectChainType(dataset)

      if (chainType !== 'substrate') {
        throw createUnsupportedChainError({
          toolName: 'portal_substrate_query_events',
          dataset,
          actualChainType: chainType,
          supportedChains: ['substrate'],
          suggestions: [
            'Use portal_evm_query_logs for EVM events.',
            'Use portal_solana_query_instructions for Solana program activity.',
          ],
        })
      }

      if (paginationCursor) {
        dataset = paginationCursor.dataset
        timeframe = paginationCursor.request.timeframe
        from_timestamp = paginationCursor.request.from_timestamp
        to_timestamp = paginationCursor.request.to_timestamp
        limit = paginationCursor.request.limit
        finalized_only = paginationCursor.request.finalized_only
        event_names = paginationCursor.request.event_names
        include_extrinsic = paginationCursor.request.include_extrinsic
        include_call = paginationCursor.request.include_call
        include_stack = paginationCursor.request.include_stack
        response_format = paginationCursor.request.response_format
      }
      const effectiveResponseFormat = resolveDefaultResponseFormat(response_format)

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
        finalized_only,
      )
      const pageToBlock = paginationCursor?.page_to_block ?? endBlock
      const blockRange = pageToBlock - resolvedFromBlock + 1
      const hasFilters = Boolean(event_names?.length)
      const validation = validateSubstrateQuerySize({
        blockRange,
        hasFilters,
        queryType: 'events',
        limit,
      })
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      const fields: Record<string, unknown> = {
        block: buildSubstrateBlockFields(),
        event: buildSubstrateEventFields(),
      }
      if (include_extrinsic) fields.extrinsic = buildSubstrateExtrinsicFields()
      if (include_call || include_stack) fields.call = buildSubstrateCallFields()

      const query = {
        type: 'substrate',
        fromBlock: resolvedFromBlock,
        toBlock: pageToBlock,
        fields,
        events: [
          {
            ...(event_names?.length ? { name: event_names } : {}),
            ...(include_extrinsic ? { extrinsic: true } : {}),
            ...(include_call ? { call: true } : {}),
            ...(include_stack ? { stack: true } : {}),
          },
        ],
      }

      const cursorSkip = paginationCursor?.skip_inclusive_block ?? 0
      const fetchLimit = limit + cursorSkip + 1
      const blocks = await portalFetchRecentRecords(`${PORTAL_URL}/datasets/${dataset}/stream`, query, {
        itemKeys: ['events'],
        limit: fetchLimit,
        chunkSize: 200,
      })

      const allEvents = sortEvents(
        flattenSubstrateEvents(blocks, {
          include_extrinsic,
          include_call,
          include_stack,
        }).map((item) => normalizeSubstrateEventResult(item) as SubstrateEventItem),
      )

      const page = paginateAscendingItems(
        allEvents,
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
        page.hasMore && page.nextBoundary
          ? encodeRecentPageCursor<SubstrateEventRequest>({
              tool: 'portal_substrate_query_events',
              dataset,
              request: {
                ...(timeframe ? { timeframe } : {}),
                ...(from_timestamp !== undefined ? { from_timestamp } : {}),
                ...(to_timestamp !== undefined ? { to_timestamp } : {}),
                limit,
                finalized_only,
                ...(event_names?.length ? { event_names } : {}),
                include_extrinsic,
                include_call,
                include_stack,
                response_format: effectiveResponseFormat,
              },
              window_from_block: resolvedFromBlock,
              window_to_block: endBlock,
              page_to_block: page.nextBoundary.page_to_block,
              skip_inclusive_block: page.nextBoundary.skip_inclusive_block,
            })
          : undefined

      const formattedData = applyResponseFormat(page.pageItems, effectiveResponseFormat, 'substrate_events')
      const notices = [
        SUBSTRATE_INDEXING_NOTICE,
        ...getTimestampWindowNotices(resolvedBlocks),
        ...getValidationNotices(validation),
      ]
      if (/"(?:refTime|proofSize)"/.test(JSON.stringify(formattedData))) {
        notices.push('Substrate Weight v2 refTime values are picoseconds and proofSize values are bytes.')
      }
      if (nextCursor) notices.push('Older results are available via _pagination.next_cursor.')
      const freshness = buildQueryFreshness({
        finality: finalized_only ? 'finalized' : 'latest',
        headBlockNumber: head.number,
        windowToBlock: endBlock,
        resolvedWindow: resolvedBlocks,
      })
      const coverage = buildQueryCoverage({
        windowFromBlock: resolvedFromBlock,
        windowToBlock: endBlock,
        pageToBlock,
        items: page.pageItems,
        getBlockNumber,
        hasMore: page.hasMore,
      })

      const windowLabel = buildSubstrateWindowLabel({
        timeframe,
        from_timestamp,
        to_timestamp,
        from_block: resolvedFromBlock,
        to_block: endBlock,
        resolvedWindow: resolvedBlocks,
      })
      const message =
        effectiveResponseFormat === 'summary'
          ? `Substrate event summary for ${page.pageItems.length} rows across ${windowLabel}${page.hasMore ? ' (latest preview page)' : ''}`
          : `Retrieved ${page.pageItems.length} Substrate events${page.hasMore ? ` from the most recent matching blocks (preview page limited to ${limit})` : ''}`
      const presentation = buildSubstrateEventPresentation(formattedData, page.pageItems.length, nextCursor)

      return formatResult(presentation.response, message, {
        toolName: 'portal_substrate_query_events',
        notices,
        pagination: buildPaginationInfo(limit, page.pageItems.length, nextCursor),
        ordering: buildChronologicalPageOrdering({
          sortedBy: 'block_number',
          tieBreakers: ['event_index', 'primary_id'],
        }),
        freshness,
        coverage,
        execution: buildExecutionMetadata({
          response_format: effectiveResponseFormat,
          finalized_only,
          limit,
          from_block: resolvedFromBlock,
          to_block: endBlock,
          page_to_block: pageToBlock,
          range_kind: resolvedBlocks.range_kind,
          normalized_output: true,
          notes: [
            event_names?.length
              ? `Filtered by ${event_names.length} event name${event_names.length === 1 ? '' : 's'}.`
              : 'Unfiltered Substrate event scan.',
            include_extrinsic || include_call || include_stack
              ? 'Requested inline parent context for matching events.'
              : 'Event rows only.',
          ],
        }),
        ui: presentation.ui,
        llm: {
          compact: true,
          answer_sequence: [
            'page_summary',
            ...(Array.isArray(formattedData) ? ['items'] : ['summary']),
            '_pagination.next_cursor',
          ],
          parser_notes: [
            'items is a chronological event page when row output is requested; always inspect the Substrate indexing notice before describing recency.',
          ],
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
