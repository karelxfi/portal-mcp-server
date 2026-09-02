import type { McpServer } from '@modelcontextprotocol/server'

import { registerPortalTool } from '../../helpers/mcp-registration.js'
import { z } from 'zod'

import { resolveDataset, validateBlockRange } from '../../cache/datasets.js'
import { PORTAL_URL } from '../../constants/index.js'
import { detectChainType } from '../../helpers/chain.js'
import { buildTableDescriptor } from '../../helpers/chart-metadata.js'
import { createUnsupportedChainError } from '../../helpers/errors.js'
import { portalFetchStreamRange } from '../../helpers/fetch.js'
import { formatResult } from '../../helpers/format.js'
import { formatNumber, formatBTC, formatPct, formatDuration } from '../../helpers/format.js'
import { fetchBitcoinBlockFees, satsToBtcString, totalBitcoinFees } from '../../helpers/bitcoin-fees.js'
import {
  type AnalysisSectionCoverage,
  buildAnalysisCoverage,
  buildAnalysisSectionCoverage,
  buildQueryFreshness,
} from '../../helpers/result-metadata.js'
import type { ResponseFormat } from '../../helpers/response-modes.js'
import { buildPercentileSummary } from '../../helpers/statistics.js'
import { resolveTimeframeOrBlocks, type TimestampInput } from '../../helpers/timeframe.js'
import { buildExecutionMetadata, buildToolDescription } from '../../helpers/tool-ux.js'
import { buildMetricCard, buildPortalUi, buildRankedBarsPanel, buildTablePanel } from '../../helpers/ui-metadata.js'

function formatBitcoinAnalyticsResponse(response: Record<string, any>, responseFormat: ResponseFormat) {
  if (responseFormat === 'full') {
    return response
  }

  if (responseFormat === 'summary') {
    return {
      overview: {
        mode: response.block_details?.mode,
        blocks_analyzed: response.block_details?.blocks_analyzed,
        block_range: response.block_details?.block_range,
        avg_block_time_seconds: response.block_details?.avg_block_time_seconds,
        avg_transactions_per_block: response.block_details?.avg_transactions_per_block,
        total_transactions: response.block_details?.total_transactions,
        segwit_percentage: response.transaction_stats?.segwit_percentage,
        tx_rate_per_second: response.transaction_stats?.tx_rate_per_second,
        avg_fee_per_tx_btc: response.fee_analysis?.avg_fee_per_tx_btc,
        fee_scope: response.fee_analysis?.scope,
        fee_blocks_scanned: response.fee_analysis?.blocks_scanned,
        unique_addresses: response.network_activity?.unique_addresses,
      },
      percentiles: {
        tx_size_bytes: response.transaction_stats?.tx_size_percentiles_bytes,
        transactions_per_block: response.block_details?.tx_count_percentiles,
      },
    }
  }

  return {
    block_details: response.block_details,
    transaction_stats: {
      avg_tx_size_bytes: response.transaction_stats?.avg_tx_size_bytes,
      avg_tx_vsize: response.transaction_stats?.avg_tx_vsize,
      avg_tx_weight: response.transaction_stats?.avg_tx_weight,
      total_size_mb: response.transaction_stats?.total_size_mb,
      segwit_percentage: response.transaction_stats?.segwit_percentage,
      tx_rate_per_second: response.transaction_stats?.tx_rate_per_second,
      tx_size_percentiles_bytes: response.transaction_stats?.tx_size_percentiles_bytes,
    },
    ...(response.network_activity ? { network_activity: response.network_activity } : {}),
    ...(response.script_type_adoption
      ? {
          script_type_adoption: {
            taproot_percentage: response.script_type_adoption.taproot_percentage,
            segwit_v0_percentage: response.script_type_adoption.segwit_v0_percentage,
            breakdown: response.script_type_adoption.breakdown,
          },
        }
      : {}),
    ...(response.fee_analysis
      ? {
          fee_analysis: {
            scope: response.fee_analysis.scope,
            sampled: response.fee_analysis.sampled,
            blocks_scanned: response.fee_analysis.blocks_scanned,
            window_blocks: response.fee_analysis.window_blocks,
            block_range: response.fee_analysis.block_range,
            transactions: response.fee_analysis.transactions,
            total_fees_btc: response.fee_analysis.total_fees_btc,
            total_fees_sats: response.fee_analysis.total_fees_sats,
            avg_fee_per_tx_btc: response.fee_analysis.avg_fee_per_tx_btc,
            avg_fee_per_tx_sats: response.fee_analysis.avg_fee_per_tx_sats,
            fees_per_block_btc: response.fee_analysis.fees_per_block_btc,
            fees_per_block_sats: response.fee_analysis.fees_per_block_sats,
            ...(response.fee_analysis.error ? { error: response.fee_analysis.error } : {}),
          },
        }
      : {}),
  }
}

function decorateBitcoinAnalyticsPresentation(response: Record<string, any>) {
  const breakdown = response.script_type_adoption?.breakdown
  const scriptTypes = breakdown && typeof breakdown === 'object'
    ? Object.entries(breakdown).map(([type, value], index) => ({
        rank: index + 1,
        type,
        count: Number((value as Record<string, unknown>)?.count ?? 0),
        percentage: Number((value as Record<string, unknown>)?.percentage ?? 0),
      })).sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
        .map((row, index) => ({ ...row, rank: index + 1 }))
    : []
  const block = response.block_details ?? response.overview ?? {}
  const transaction = response.transaction_stats ?? {}
  const presentationSummary = {
    blocks_analyzed: block.blocks_analyzed,
    total_transactions: block.total_transactions,
    avg_block_time_seconds: block.avg_block_time_seconds,
    segwit_percentage: transaction.segwit_percentage ?? response.overview?.segwit_percentage,
    avg_fee_per_tx_btc: response.fee_analysis?.avg_fee_per_tx_btc ?? response.overview?.avg_fee_per_tx_btc,
  }
  const table = scriptTypes.length > 0
    ? buildTableDescriptor({
        id: 'bitcoin_script_types',
        dataKey: 'script_types',
        rowCount: scriptTypes.length,
        title: 'Bitcoin output script types',
        subtitle: 'Observed output scripts ranked by count in the sampled blocks',
        keyField: 'type',
        defaultSort: { key: 'rank', direction: 'asc' },
        dense: true,
        columns: [
          { key: 'rank', label: 'Rank', kind: 'rank', format: 'integer', align: 'right' },
          { key: 'type', label: 'Script type', kind: 'dimension' },
          { key: 'count', label: 'Outputs', kind: 'metric', format: 'integer', align: 'right' },
          { key: 'percentage', label: 'Share', kind: 'metric', format: 'percent', unit: '%', align: 'right' },
        ],
      })
    : undefined
  const normalizedResponse = {
    ...response,
    presentation_summary: presentationSummary,
    ...(scriptTypes.length > 0 ? { script_types: scriptTypes } : {}),
    ...(table ? { tables: [table] } : {}),
  }

  return {
    response: normalizedResponse,
    ui: buildPortalUi({
      version: 'portal_ui_v1',
      layout: 'dashboard',
      density: 'compact',
      design_intent: 'analytics_dashboard',
      headline: { title: 'Bitcoin network analytics' },
      metric_cards: [
        buildMetricCard({ id: 'blocks', label: 'Blocks analyzed', value_path: 'presentation_summary.blocks_analyzed', format: 'integer', emphasis: 'primary' }),
        buildMetricCard({ id: 'transactions', label: 'Transactions', value_path: 'presentation_summary.total_transactions', format: 'integer' }),
        buildMetricCard({ id: 'block-time', label: 'Average block time', value_path: 'presentation_summary.avg_block_time_seconds', format: 'decimal', unit: 'seconds' }),
        buildMetricCard({ id: 'segwit', label: 'SegWit share', value_path: 'presentation_summary.segwit_percentage', format: 'percent' }),
      ],
      panels: table
        ? [
            buildRankedBarsPanel({
              id: 'script-type-bars',
              kind: 'ranked_bars_panel',
              title: 'Output script adoption',
              subtitle: 'Observed script types ranked by output count.',
              data_key: 'script_types',
              category_key: 'type',
              value_key: 'count',
              rank_key: 'rank',
              value_format: 'integer',
              emphasis: 'primary',
            }),
            buildTablePanel({
              id: 'script-type-table-panel',
              kind: 'table_panel',
              title: 'Script type evidence',
              subtitle: 'Counts and shares from the sampled output rows.',
              table_id: 'bitcoin_script_types',
            }),
          ]
        : [],
      ...(scriptTypes.length > 0
        ? { follow_up_actions: [{ label: 'Show script type rows', intent: 'show_raw' as const, target: 'script_types' }] }
        : {}),
    }),
  }
}

// ============================================================================
// Tool: Bitcoin Network Analytics
// ============================================================================

/**
 * Comprehensive Bitcoin network analytics — block stats, fee analysis,
 * address activity, segwit/taproot adoption, and UTXO patterns.
 */
export function registerBitcoinAnalyticsTool(server: McpServer) {
  const FAST_MODE_MAX_BLOCKS = 72
  const DEEP_MODE_MAX_BLOCKS = 200
  /* Inputs and outputs weigh about a megabyte per block, so fee and
     address sections scan the newest blocks of the window up to these caps
     and say so in the coverage, notices, execution notes, and answer. */
  const FEE_SCAN_MAX_BLOCKS = 36
  const ADDRESS_SCAN_MAX_BLOCKS = 50

  registerPortalTool(server,
    'portal_bitcoin_get_analytics',
    buildToolDescription('portal_bitcoin_get_analytics'),
    {
      network: z.string().default('bitcoin-mainnet').describe('Network name (default: bitcoin-mainnet)'),
      timeframe: z
        .string()
        .optional()
        .describe("Time range: '1h' (~6 blocks), '6h' (~36 blocks), '24h' (~144 blocks). Default: '1h'"),
      mode: z
        .enum(['fast', 'deep'])
        .optional()
        .default('deep')
        .describe('Execution depth. Defaults to complete requested-window analysis; the optional fast value is only for explicitly bounded previews.'),
      from_block: z.number().optional().describe('Starting block number (use this OR timeframe)'),
      to_block: z.number().optional().describe('Ending block number'),
      from_timestamp: z
        .union([z.string(), z.number()])
        .optional()
        .describe('Starting timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input like "6h ago".'),
      to_timestamp: z
        .union([z.string(), z.number()])
        .optional()
        .describe('Ending timestamp. Accepts Unix seconds, Unix milliseconds, ISO datetime, or relative input like "now".'),
      include_address_activity: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include unique address count and output value (requires extra queries, slower)'),
      response_format: z
        .enum(['full', 'compact', 'summary'])
        .optional()
        .default('full')
        .describe("Response format: 'summary' (high-level metrics only), 'compact' (core sections, lighter payload), 'full' (complete analytics)."),
    },
    async ({ network, timeframe, mode, from_block, to_block, from_timestamp, to_timestamp, include_address_activity, response_format }) => {
      const queryStartTime = Date.now()
      let dataset = await resolveDataset(network)
      const chainType = detectChainType(dataset)

      if (chainType !== 'bitcoin') {
        throw createUnsupportedChainError({
          toolName: 'portal_bitcoin_get_analytics',
          dataset,
          actualChainType: chainType,
          supportedChains: ['bitcoin'],
          suggestions: [
            'Use portal_solana_get_analytics for Solana snapshots.',
            'Use EVM convenience tools like portal_get_contract_activity for smart-contract chains.',
          ],
        })
      }

      // Default to 1h
      if (!timeframe && from_block === undefined && from_timestamp === undefined) {
        timeframe = '1h'
      }

      const resolvedWindow = await resolveTimeframeOrBlocks({
        dataset,
        timeframe,
        from_block,
        to_block,
        from_timestamp: from_timestamp as TimestampInput | undefined,
        to_timestamp: to_timestamp as TimestampInput | undefined,
      })
      const resolvedFromBlock = resolvedWindow.from_block

      const { validatedToBlock: endBlock, head } = await validateBlockRange(
        dataset,
        resolvedFromBlock,
        resolvedWindow.to_block ?? Number.MAX_SAFE_INTEGER,
        false,
      )

      // Cap block range for performance
      const requestedBlocks = endBlock - resolvedFromBlock + 1
      const maxBlocks = mode === 'deep' ? DEEP_MODE_MAX_BLOCKS : FAST_MODE_MAX_BLOCKS
      const effectiveFrom = requestedBlocks > maxBlocks ? endBlock - maxBlocks + 1 : resolvedFromBlock

      // Query 1: Blocks + transactions (for block stats and tx counts)
      const txQuery = {
        type: 'bitcoin',
        fromBlock: effectiveFrom,
        toBlock: endBlock,
        fields: {
          block: { number: true, hash: true, timestamp: true },
          transaction: {
            transactionIndex: true,
            hash: true,
            size: true,
            vsize: true,
            weight: true,
            version: true,
          },
        },
        transactions: [{}],
      }

      const txResults = await portalFetchStreamRange(
        `${PORTAL_URL}/datasets/${dataset}/stream`,
        txQuery,
        {
          maxBytes: 100 * 1024 * 1024,
        },
      )

      // Compute block & transaction stats
      let totalTxs = 0
      let totalSize = 0
      let totalVsize = 0
      let totalWeight = 0
      const blockTimes: number[] = []
      const blockTxCounts: number[] = []
      const txSizes: number[] = []
      const versions = new Map<number, number>()

      for (let i = 0; i < txResults.length; i++) {
        const block = txResults[i] as any
        const txs = block.transactions || []
        const txCount = txs.length
        totalTxs += txCount
        blockTxCounts.push(txCount)

        txs.forEach((tx: any) => {
          totalSize += tx.size || 0
          totalVsize += tx.vsize || 0
          totalWeight += tx.weight || 0
          if (typeof tx.size === 'number' && Number.isFinite(tx.size)) txSizes.push(tx.size)
          const v = tx.version || 0
          versions.set(v, (versions.get(v) || 0) + 1)
        })

        // Block time (gap between consecutive blocks)
        if (i > 0) {
          const prevBlock = txResults[i - 1] as any
          const prevTs = prevBlock.header?.timestamp ?? prevBlock.timestamp
          const curTs = block.header?.timestamp ?? block.timestamp
          if (prevTs && curTs) {
            blockTimes.push(curTs - prevTs)
          }
        }
      }

      const numBlocks = txResults.length
      const avgBlockTime = blockTimes.length > 0 ? blockTimes.reduce((a, b) => a + b, 0) / blockTimes.length : 0
      const avgTxsPerBlock = numBlocks > 0 ? totalTxs / numBlocks : 0
      const avgTxSize = totalTxs > 0 ? totalSize / totalTxs : 0
      const avgBlockSize = numBlocks > 0 ? totalSize / numBlocks : 0

      // Segwit detection: if vsize < size, it uses segwit
      let segwitTxs = 0
      txResults.forEach((block: any) => {
        ;(block.transactions || []).forEach((tx: any) => {
          if (tx.vsize && tx.size && tx.vsize < tx.size) segwitTxs++
        })
      })
      const segwitPct = totalTxs > 0 ? (segwitTxs / totalTxs) * 100 : 0

      // Build response
      const txRate = avgBlockTime > 0 ? avgTxsPerBlock / avgBlockTime : 0

      const response: any = {
        block_details: {
          mode,
          blocks_analyzed: numBlocks,
          block_range: `${effectiveFrom}-${endBlock}`,
          avg_block_time_seconds: parseFloat(avgBlockTime.toFixed(1)),
          avg_block_time_formatted: formatDuration(avgBlockTime),
          avg_block_size_mb: parseFloat((avgBlockSize / 1024 / 1024).toFixed(2)),
          avg_block_size_formatted: (avgBlockSize / 1024 / 1024).toFixed(2) + ' MB',
          avg_transactions_per_block: parseFloat(avgTxsPerBlock.toFixed(1)),
          avg_txs_formatted: formatNumber(avgTxsPerBlock),
          total_transactions: totalTxs,
          total_transactions_formatted: formatNumber(totalTxs),
          tx_count_percentiles: buildPercentileSummary(blockTxCounts),
        },
        transaction_stats: {
          avg_tx_size_bytes: Math.round(avgTxSize),
          avg_tx_vsize: totalTxs > 0 ? Math.round(totalVsize / totalTxs) : 0,
          avg_tx_weight: totalTxs > 0 ? Math.round(totalWeight / totalTxs) : 0,
          total_size_mb: parseFloat((totalSize / 1024 / 1024).toFixed(2)),
          segwit_percentage: parseFloat(segwitPct.toFixed(1)),
          segwit_formatted: formatPct(segwitPct) + ' segwit',
          version_breakdown: Object.fromEntries(versions),
          tx_rate_per_second: parseFloat(txRate.toFixed(2)),
          tx_rate_formatted: formatNumber(txRate) + ' tx/s',
          tx_size_percentiles_bytes: buildPercentileSummary(txSizes),
        },
      }

      const analyzedBlocks = endBlock - effectiveFrom + 1
      const sections: Record<string, AnalysisSectionCoverage> = {}
      const sectionNotices: string[] = []

      // Query 2: Outputs for address activity and value flow (optional)
      if (include_address_activity) {
        // Limit output query to fewer blocks to keep it fast
        const outputMaxBlocks = Math.min(analyzedBlocks, ADDRESS_SCAN_MAX_BLOCKS)
        const outputFrom = endBlock - outputMaxBlocks + 1
        sections.address_activity = buildAnalysisSectionCoverage({
          windowFromBlock: effectiveFrom,
          windowToBlock: endBlock,
          analyzedFromBlock: outputFrom,
          analyzedToBlock: endBlock,
        })
        if (sections.address_activity.sampled) {
          sectionNotices.push(
            `Address activity and script types cover the latest ${outputMaxBlocks} of ${analyzedBlocks} analyzed blocks (${outputFrom}-${endBlock}).`,
          )
        }

        const outputQuery = {
          type: 'bitcoin',
          fromBlock: outputFrom,
          toBlock: endBlock,
          fields: {
            block: { number: true, timestamp: true },
            output: {
              value: true,
              scriptPubKeyAddress: true,
              scriptPubKeyType: true,
            },
          },
          outputs: [{}],
        }

        try {
          const outputResults = await portalFetchStreamRange(
            `${PORTAL_URL}/datasets/${dataset}/stream`,
            outputQuery,
            {
              maxBlocks: outputMaxBlocks,
              maxBytes: 100 * 1024 * 1024,
            },
          )

          const addresses = new Set<string>()
          const scriptTypes = new Map<string, number>()
          let totalOutputValue = 0
          let totalOutputs = 0

          outputResults.forEach((block: any) => {
            ;(block.outputs || []).forEach((output: any) => {
              totalOutputs++
              if (output.scriptPubKeyAddress) addresses.add(output.scriptPubKeyAddress)
              totalOutputValue += output.value || 0

              const sType = output.scriptPubKeyType || 'unknown'
              scriptTypes.set(sType, (scriptTypes.get(sType) || 0) + 1)
            })
          })

          // Calculate adoption percentages
          const scriptTypeBreakdown: Record<string, { count: number; percentage: number }> = {}
          scriptTypes.forEach((count, type) => {
            scriptTypeBreakdown[type] = {
              count,
              percentage: parseFloat(((count / totalOutputs) * 100).toFixed(1)),
            }
          })

          const taprootCount = scriptTypes.get('witness_v1_taproot') || 0
          const segwitV0Count =
            (scriptTypes.get('witness_v0_keyhash') || 0) + (scriptTypes.get('witness_v0_scripthash') || 0)

          response.network_activity = {
            blocks_sampled: outputMaxBlocks,
            block_range: `${outputFrom}-${endBlock}`,
            sampled: sections.address_activity.sampled,
            unique_addresses: addresses.size,
            total_outputs: totalOutputs,
            total_output_value_btc: parseFloat(totalOutputValue.toFixed(8)),
            avg_outputs_per_block: parseFloat((totalOutputs / outputMaxBlocks).toFixed(1)),
          }

          response.script_type_adoption = {
            taproot_percentage: parseFloat(((taprootCount / totalOutputs) * 100).toFixed(1)),
            segwit_v0_percentage: parseFloat(((segwitV0Count / totalOutputs) * 100).toFixed(1)),
            breakdown: scriptTypeBreakdown,
          }
        } catch {
          response.network_activity = { error: 'Failed to fetch output data — try a smaller range' }
        }
      }

      // Query 3: Inputs and outputs for exact fees over the newest blocks of
      // the analyzed window. Fees are summed in satoshis per block; every
      // section field names the exact block set it came from.
      const feeScanBlocks = Math.min(analyzedBlocks, FEE_SCAN_MAX_BLOCKS)
      const feeFrom = endBlock - feeScanBlocks + 1
      try {
        const fees = await fetchBitcoinBlockFees({ dataset, fromBlock: feeFrom, toBlock: endBlock })
        const totals = totalBitcoinFees(fees.blocks)
        sections.fee_analysis = buildAnalysisSectionCoverage({
          windowFromBlock: effectiveFrom,
          windowToBlock: endBlock,
          analyzedFromBlock: feeFrom,
          analyzedToBlock: endBlock,
          excludedBlocks: fees.excluded_blocks,
        })
        const sampled = sections.fee_analysis.sampled
        const totalFeesBtc = satsToBtcString(totals.total_fee_sats)
        const avgFeeBtc = satsToBtcString(totals.avg_fee_per_tx_sats)
        const feesPerBlockBtc = satsToBtcString(totals.fees_per_block_sats)
        response.fee_analysis = {
          scope: sampled ? 'sample' : 'window',
          sampled,
          blocks_scanned: totals.blocks,
          blocks_sampled: totals.blocks,
          window_blocks: analyzedBlocks,
          block_range: `${feeFrom}-${endBlock}`,
          from_block: feeFrom,
          to_block: endBlock,
          transactions: totals.transactions,
          total_fees_sats: totals.total_fee_sats.toString(),
          total_fees_btc: totalFeesBtc,
          total_fees_formatted: formatBTC(Number(totalFeesBtc)),
          avg_fee_per_tx_sats: totals.avg_fee_per_tx_sats.toString(),
          avg_fee_per_tx_btc: avgFeeBtc,
          avg_fee_per_tx_formatted: formatBTC(Number(avgFeeBtc)),
          fees_per_block_sats: totals.fees_per_block_sats.toString(),
          fees_per_block_btc: feesPerBlockBtc,
          fees_per_block_formatted: formatBTC(Number(feesPerBlockBtc)),
          ...(fees.excluded_blocks.length > 0 ? { excluded_blocks: fees.excluded_blocks } : {}),
        }
        if (sampled) {
          sectionNotices.push(
            fees.excluded_blocks.length > 0
              ? `Fee analysis covers ${totals.blocks} of ${analyzedBlocks} analyzed blocks (${feeFrom}-${endBlock}, ${fees.excluded_blocks.length} excluded because their inputs or outputs were incomplete); block and transaction statistics cover all ${analyzedBlocks}.`
              : `Fee analysis covers the latest ${totals.blocks} of ${analyzedBlocks} analyzed blocks (${feeFrom}-${endBlock}); block and transaction statistics cover all ${analyzedBlocks}.`,
          )
        }
      } catch {
        sections.fee_analysis = buildAnalysisSectionCoverage({
          windowFromBlock: effectiveFrom,
          windowToBlock: endBlock,
          analyzedFromBlock: endBlock + 1,
          analyzedToBlock: endBlock,
        })
        sectionNotices.push('Fee analysis is unavailable for this window because the fee scan failed; retry or use a smaller range.')
        response.fee_analysis = {
          scope: 'unavailable',
          sampled: true,
          blocks_scanned: 0,
          window_blocks: analyzedBlocks,
          error: 'Failed to compute fees — try a smaller range',
        }
      }

      const notices = [
        ...(requestedBlocks > maxBlocks
          ? [`Analyzed ${numBlocks} of ${requestedBlocks} requested blocks because the requested window exceeds the current Bitcoin analytics scan budget.`]
          : []),
        ...sectionNotices,
      ]
      const feeScope =
        response.fee_analysis?.scope === 'sample'
          ? `, fees from the latest ${response.fee_analysis.blocks_scanned} of ${analyzedBlocks} blocks`
          : response.fee_analysis?.scope === 'unavailable'
            ? ', fees unavailable'
            : ''
      const formattedResponse = formatBitcoinAnalyticsResponse(response, response_format as ResponseFormat)
      const presentation = decorateBitcoinAnalyticsPresentation(formattedResponse)
      const message = response_format === 'summary'
        ? `Bitcoin summary: ${numBlocks} blocks, ${totalTxs.toLocaleString()} txs, ${avgBlockTime.toFixed(0)}s avg block time${feeScope}`
        : `Bitcoin network analytics: ${numBlocks} blocks, ${totalTxs.toLocaleString()} txs, ${avgTxsPerBlock.toFixed(0)} avg txs/block, ${avgBlockTime.toFixed(0)}s avg block time, ${segwitPct.toFixed(0)}% segwit${feeScope}`

      return formatResult(
        presentation.response,
        message,
        {
          toolName: 'portal_bitcoin_get_analytics',
          ...(notices.length > 0 ? { notices } : {}),
          ordering: {
            kind: 'sections',
            block_series: 'oldest_to_newest',
          },
          freshness: buildQueryFreshness({
            finality: 'latest',
            headBlockNumber: head.number,
            windowToBlock: endBlock,
            resolvedWindow,
          }),
          coverage: buildAnalysisCoverage({
            windowFromBlock: resolvedFromBlock,
            windowToBlock: endBlock,
            analyzedFromBlock: effectiveFrom,
            analyzedToBlock: endBlock,
            sections,
          }),
          execution: buildExecutionMetadata({
            mode,
            response_format,
            from_block: effectiveFrom,
            to_block: endBlock,
            range_kind: resolvedWindow.range_kind,
            notes: [
              include_address_activity ? 'Address-activity enrichment was included.' : 'Address-activity enrichment was skipped for speed.',
              ...sectionNotices,
            ],
          }),
          ui: presentation.ui,
          llm: {
            compact: true,
            primary_path: presentation.response.script_types?.length ? 'script_types' : 'presentation_summary',
            answer_sequence: ['presentation_summary', 'block_details', 'transaction_stats', 'network_activity', 'fee_analysis', 'script_types'],
            parser_notes: [
              'Bitcoin values use BTC units in analytics summaries with exact satoshi companions; script_types contains ranked output-script evidence when address activity is enabled.',
              'fee_analysis.scope says whether fees cover the whole analyzed window or only its newest blocks; _coverage.sections carries the exact block set per section.',
            ],
          },
          metadata: {
            dataset,
            from_block: effectiveFrom,
            to_block: endBlock,
            query_start_time: queryStartTime,
          },
        },
      )
    },
  )
}
