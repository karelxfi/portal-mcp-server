import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { getBlockHead, resolveDataset, validateBlockRange } from '../../cache/datasets.js'
import { PORTAL_URL } from '../../constants/index.js'
import { detectChainType } from '../../helpers/chain.js'
import { createUnsupportedChainError } from '../../helpers/errors.js'
import { portalFetchStreamRange } from '../../helpers/fetch.js'
import { buildEvmTraceFields, buildEvmTransactionFields } from '../../helpers/fields.js'
import { formatResult } from '../../helpers/format.js'
import { formatTimestamp } from '../../helpers/formatting.js'
import { buildQueryCoverage, buildQueryFreshness } from '../../helpers/result-metadata.js'
import { getTimestampWindowNotices, resolveTimeframeOrBlocks } from '../../helpers/timeframe.js'
import { buildExecutionMetadata, buildToolDescription } from '../../helpers/tool-ux.js'
import { normalizeEvmAddress } from '../../helpers/validation.js'

type DeploymentTrace = Record<string, unknown> & {
  block_number?: number
  timestamp?: number
  timestamp_human?: string
  transaction_hash?: string
  transaction_from?: string
  transaction_to?: string | null
  transaction_index?: number
  transaction_status?: number
  deployer?: string
  deployed_contract_address?: string
  gas_used?: string | number
  error?: string | null
}

function readNestedString(value: unknown, ...path: string[]): string | undefined {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current : undefined
}

function readNestedNumber(value: unknown, ...path: string[]): number | undefined {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'number' ? current : undefined
}

function flattenCreateTraces(records: unknown[], targetAddress: string): DeploymentTrace[] {
  return records.flatMap((block: unknown) => {
    const typedBlock = block as {
      number?: number
      timestamp?: number
      header?: { number?: number; timestamp?: number }
      transactions?: Array<Record<string, unknown>>
      traces?: Array<Record<string, unknown>>
    }
    const blockNumber = typedBlock.number ?? typedBlock.header?.number
    const timestamp = typedBlock.timestamp ?? typedBlock.header?.timestamp
    const transactionsByIndex = new Map<number, Record<string, unknown>>()
    for (const tx of typedBlock.transactions ?? []) {
      const index = typeof tx.transactionIndex === 'number' ? tx.transactionIndex : undefined
      if (index !== undefined) transactionsByIndex.set(index, tx)
    }

    const matches: DeploymentTrace[] = []
    for (const trace of typedBlock.traces ?? []) {
      const resultAddress =
        typeof trace.createResultAddress === 'string'
          ? trace.createResultAddress
          : readNestedString(trace, 'result', 'address')
      if (!resultAddress || resultAddress.toLowerCase() !== targetAddress) continue

      const transactionIndex =
        typeof trace.transactionIndex === 'number'
          ? trace.transactionIndex
          : readNestedNumber(trace, 'transactionIndex')
      const tx = transactionIndex !== undefined ? transactionsByIndex.get(transactionIndex) : undefined

      matches.push({
        block_number: blockNumber,
        timestamp,
        ...(timestamp !== undefined ? { timestamp_human: formatTimestamp(timestamp) } : {}),
        transaction_hash: typeof tx?.hash === 'string' ? tx.hash : undefined,
        transaction_from: typeof tx?.from === 'string' ? tx.from : undefined,
        transaction_to: typeof tx?.to === 'string' || tx?.to === null ? tx.to as string | null : undefined,
        transaction_index: transactionIndex,
        transaction_status: typeof tx?.status === 'number' ? tx.status : undefined,
        deployer:
          typeof trace.createFrom === 'string'
            ? trace.createFrom
            : readNestedString(trace, 'action', 'from'),
        deployed_contract_address: resultAddress.toLowerCase(),
        gas_used:
          typeof trace.createResultGasUsed === 'string' || typeof trace.createResultGasUsed === 'number'
            ? trace.createResultGasUsed
            : readNestedString(trace, 'result', 'gasUsed'),
        error: typeof trace.error === 'string' || trace.error === null ? trace.error : undefined,
      })
    }
    return matches
  })
}

function getBlockNumber(item: DeploymentTrace): number | undefined {
  return typeof item.block_number === 'number' ? item.block_number : undefined
}

export function registerContractDeploymentTool(server: McpServer) {
  server.tool(
    'portal_evm_get_contract_deployment',
    buildToolDescription('portal_evm_get_contract_deployment'),
    {
      network: z.string().describe('EVM network name or alias, e.g. base, ethereum, arbitrum.'),
      contract_address: z.string().describe('Contract address whose deployment transaction should be located.'),
      timeframe: z.string().optional().describe('Optional recent time window to search, e.g. "24h" or "7d".'),
      from_block: z.number().optional().describe('Optional starting block. Provide this for older contracts when the deployment is not recent.'),
      to_block: z.number().optional().describe('Optional ending block. Defaults to the indexed head.'),
      from_timestamp: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Optional start timestamp. Accepts Unix seconds, milliseconds, ISO datetime, or relative input like "7d ago".'),
      to_timestamp: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Optional end timestamp. Accepts Unix seconds, milliseconds, ISO datetime, or relative input like "now".'),
      search_depth_blocks: z
        .number()
        .max(250000)
        .optional()
        .default(100000)
        .describe('When no explicit range is given, search this many recent blocks backward from the indexed head.'),
      scan_order: z
        .enum(['latest', 'earliest'])
        .optional()
        .default('latest')
        .describe('Scan latest first for recent deployments, or earliest first when you provide a historical from_block.'),
    },
    async ({ network, contract_address, timeframe, from_block, to_block, from_timestamp, to_timestamp, search_depth_blocks, scan_order }) => {
      const queryStartTime = Date.now()
      const dataset = await resolveDataset(network)
      const chainType = detectChainType(dataset)
      if (chainType !== 'evm') {
        throw createUnsupportedChainError({
          toolName: 'portal_evm_get_contract_deployment',
          dataset,
          actualChainType: chainType,
          supportedChains: ['evm'],
          suggestions: ['Use this only for EVM smart-contract datasets.'],
        })
      }

      const normalizedContract = normalizeEvmAddress(contract_address)
      const hasExplicitWindow = timeframe !== undefined || from_block !== undefined || from_timestamp !== undefined || to_timestamp !== undefined
      const head = await getBlockHead(dataset, false)
      const resolvedBlocks = hasExplicitWindow
        ? await resolveTimeframeOrBlocks({
            dataset,
            timeframe,
            from_block,
            to_block,
            from_timestamp,
            to_timestamp,
          })
        : {
            from_block: Math.max(0, head.number - search_depth_blocks + 1),
            to_block: head.number,
            range_kind: 'block_range' as const,
          }

      const { validatedToBlock: endBlock, head: validatedHead } = await validateBlockRange(
        dataset,
        resolvedBlocks.from_block,
        resolvedBlocks.to_block ?? Number.MAX_SAFE_INTEGER,
        false,
      )

      const transactionFields = buildEvmTransactionFields(false)
      delete transactionFields.input
      const portalUrl = `${PORTAL_URL}/datasets/${dataset}/stream`
      const query = {
        type: 'evm',
        fromBlock: resolvedBlocks.from_block,
        toBlock: endBlock,
        fields: {
          block: { number: true, timestamp: true },
          transaction: transactionFields,
          trace: buildEvmTraceFields(),
        },
        traces: [{ type: ['create'], transaction: true }],
      }

      const chunkSize = 1000
      let scannedFromBlock = scan_order === 'earliest' ? resolvedBlocks.from_block : endBlock
      let scannedToBlock = scan_order === 'earliest' ? resolvedBlocks.from_block : endBlock
      let deployment: DeploymentTrace | undefined

      if (scan_order === 'earliest') {
        for (let chunkFrom = resolvedBlocks.from_block; chunkFrom <= endBlock && !deployment; chunkFrom += chunkSize) {
          const chunkTo = Math.min(endBlock, chunkFrom + chunkSize - 1)
          scannedToBlock = chunkTo
          const records = await portalFetchStreamRange(portalUrl, { ...query, fromBlock: chunkFrom, toBlock: chunkTo })
          deployment = flattenCreateTraces(records, normalizedContract)[0]
        }
      } else {
        for (let chunkTo = endBlock; chunkTo >= resolvedBlocks.from_block && !deployment; chunkTo -= chunkSize) {
          const chunkFrom = Math.max(resolvedBlocks.from_block, chunkTo - chunkSize + 1)
          scannedFromBlock = chunkFrom
          const records = await portalFetchStreamRange(portalUrl, { ...query, fromBlock: chunkFrom, toBlock: chunkTo })
          deployment = flattenCreateTraces(records, normalizedContract).at(-1)
        }
      }

      const items = deployment ? [deployment] : []
      const notices = [...getTimestampWindowNotices(resolvedBlocks)]
      if (!hasExplicitWindow) {
        notices.push(`Searched the most recent ${search_depth_blocks.toLocaleString()} blocks. For older contracts, pass from_block or from_timestamp.`)
      }
      if (!deployment) {
        notices.push(`No deployment create trace for ${normalizedContract} was found in scanned blocks ${scannedFromBlock}-${scannedToBlock}.`)
      }

      const freshness = buildQueryFreshness({
        finality: 'latest',
        headBlockNumber: validatedHead.number,
        windowToBlock: endBlock,
        resolvedWindow: resolvedBlocks,
      })
      const coverage = buildQueryCoverage({
        windowFromBlock: resolvedBlocks.from_block,
        windowToBlock: endBlock,
        pageToBlock: scan_order === 'earliest' ? scannedToBlock : endBlock,
        items,
        getBlockNumber,
        hasMore: false,
      })

      return formatResult(
        items,
        deployment
          ? `Found deployment for ${normalizedContract} in block ${deployment.block_number}; deployer ${deployment.deployer ?? 'unknown'}.`
          : `No deployment trace found for ${normalizedContract} in the scanned window.`,
        {
          toolName: 'portal_evm_get_contract_deployment',
          notices,
          freshness,
          coverage,
          execution: buildExecutionMetadata({
            limit: 1,
            from_block: resolvedBlocks.from_block,
            to_block: endBlock,
            page_to_block: scan_order === 'earliest' ? scannedToBlock : scannedFromBlock,
            scan_order,
            range_kind: resolvedBlocks.range_kind,
            normalized_output: true,
            notes: ['Uses Portal create traces and parent transaction context; no custom chain indexing is performed.'],
          }),
          metadata: {
            network: dataset,
            dataset,
            from_block: resolvedBlocks.from_block,
            to_block: endBlock,
            query_start_time: queryStartTime,
          },
        },
      )
    },
  )
}
