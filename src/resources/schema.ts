import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/server'

import { getDatasets, resolveDataset } from '../cache/datasets.js'
import { EVENT_SIGNATURES, PORTAL_URL } from '../constants/index.js'
import { portalFetch } from '../helpers/fetch.js'
import {
  buildEvmBlockFields,
  buildEvmLogFields,
  buildEvmStateDiffFields,
  buildEvmTraceFields,
  buildEvmTransactionFields,
  buildSolanaBalanceFields,
  buildSolanaInstructionFields,
  buildSolanaLogFields,
  buildSolanaRewardFields,
  buildSolanaTokenBalanceFields,
  buildSolanaTransactionFields,
} from '../helpers/fields.js'
import { type ToolGuideEntry, getToolGuideEntries, getToolGuideEntry } from '../helpers/tool-ux.js'
import type { BlockHead, DatasetMetadata } from '../types/index.js'
import { npmVersion } from '../version.js'

// ============================================================================
// MCP Resources
// ============================================================================

function groupToolsByCategory(tools: ToolGuideEntry[]) {
  return tools.reduce<Record<string, string[]>>((groups, tool) => {
    groups[tool.category] ??= []
    groups[tool.category].push(tool.name)
    return groups
  }, {})
}

function buildDeveloperToolGuide() {
  const tools = getToolGuideEntries()
  const publicTools = tools.filter((tool) => tool.audience === 'public')
  const advancedTools = tools.filter((tool) => tool.audience === 'advanced')

  return {
    description: 'Developer-facing guide for selecting SQD Portal MCP tools and starting from common workflows.',
    version: npmVersion,
    counts: {
      tools: tools.length,
      public: publicTools.length,
      advanced: advancedTools.length,
    },
    recommended_starting_points: [
      {
        job: 'Find the right network name or VM family',
        tool: 'portal_list_networks',
        reason:
          'Use this before any query when a user says "Base", "Polkadot", "Hyperliquid", or another fuzzy chain name.',
      },
      {
        job: 'Check whether a network is indexed and fresh',
        tool: 'portal_get_network_info',
        reason: 'Use this before debugging missing data or stale-looking results.',
      },
      {
        job: 'Resolve user-facing entity names before querying',
        tool: 'portal_resolve_entity',
        reason:
          'Use this when a user says a token symbol, contract alias, pool identifier, protocol name, or Hyperliquid coin name and you need explicit filters.',
      },
      {
        job: 'Show recent activity without manual block math',
        tool: 'portal_get_recent_activity',
        reason: 'Best first tool for broad "what happened recently?" prompts across supported VMs.',
      },
      {
        job: 'Summarize a wallet before drilling into raw records',
        tool: 'portal_get_wallet_summary',
        reason: 'Returns a cross-chain overview, recent activity, counterparties, and chain-specific sections.',
      },
      {
        job: 'Build chart-ready buckets or period comparisons',
        tool: 'portal_get_time_series',
        reason: 'Use when the developer or model needs time-series, grouped trend, or compare-previous output.',
      },
    ],
    common_question_routes: [
      {
        ask: 'Investigate this wallet or suspicious address',
        start_with: 'portal_get_wallet_summary',
        then_use: [
          'portal_evm_query_transactions',
          'portal_evm_query_token_transfers',
          'portal_solana_query_transactions',
          'portal_hyperliquid_query_fills',
        ],
        reason:
          'Wallet summary returns fund_flow, counterparties, largest movements, and investigation pivots before raw record drill-down.',
      },
      {
        ask: 'Trace USDC or token outflows',
        start_with: 'portal_resolve_entity',
        then_use: ['portal_evm_query_token_transfers', 'portal_get_wallet_summary'],
        reason:
          'Resolve the token symbol first, then query exact transfer evidence and summarize the sender or recipient wallet.',
      },
      {
        ask: 'Explain why network or contract activity spiked',
        start_with: 'portal_get_time_series',
        then_use: ['portal_evm_query_logs', 'portal_evm_query_transactions', 'portal_evm_get_contract_activity'],
        reason:
          'Use complete buckets to find the spike, then pivot into exact logs, transactions, or contract activity.',
      },
      {
        ask: 'What did this contract do recently?',
        start_with: 'portal_evm_get_contract_activity',
        then_use: ['portal_evm_query_logs', 'portal_evm_query_transactions'],
        reason: 'Contract activity gives the overview; raw logs and transactions provide exact evidence rows.',
      },
    ],
    integration_notes: [
      'Prefer public tools for normal agent flows; advanced tools are for debugging Portal coverage or exact block resolution.',
      'Use network parameters in public APIs. Raw Portal dataset names are resolved internally.',
      'Most query tools support timeframe or timestamp inputs, so clients rarely need to calculate block ranges themselves.',
      'Use portal_resolve_entity or token_symbols on supported EVM tools instead of hardcoding entity identifiers in client code.',
      'Raw query tools default to compact output. Use response_format: "full" only when the caller needs chain-specific raw fields.',
      'Wallet investigations should start from fund_flow and investigation.pivots, then use raw tools only for evidence drill-down.',
      'For chartable responses, read chart and tables metadata before inferring visual structure from raw arrays.',
    ],
    categories: groupToolsByCategory(tools),
    tools,
  }
}

export function registerSchemaResource(server: McpServer) {
  server.registerResource(
    'tool-guide',
    'sqd://tools',
    { mimeType: 'application/json', cacheHint: { ttlMs: 300_000, cacheScope: 'public' } },
    async (uri) => {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(buildDeveloperToolGuide(), null, 2),
          },
        ],
      }
    },
  )

  server.registerResource(
    'tool-guide-entry',
    new ResourceTemplate('sqd://tools/{name}', { list: undefined }),
    { mimeType: 'application/json', cacheHint: { ttlMs: 300_000, cacheScope: 'public' } },
    async (uri, { name }) => {
      const toolName = Array.isArray(name) ? name[0] : name
      const tool = getToolGuideEntry(toolName)
      if (!tool) {
        throw new Error(`Unknown Portal MCP tool "${toolName}". Read sqd://tools for the current tool guide.`)
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(tool, null, 2),
          },
        ],
      }
    },
  )

  // Resource: List all datasets
  server.registerResource(
    'datasets',
    'sqd://datasets',
    { mimeType: 'application/json', cacheHint: { ttlMs: 60_000, cacheScope: 'public' } },
    async (uri) => {
      const datasets = await getDatasets()
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(datasets, null, 2),
          },
        ],
      }
    },
  )

  // Resource: Dataset info template
  server.registerResource(
    'dataset-info',
    new ResourceTemplate('sqd://datasets/{name}', { list: undefined }),
    { mimeType: 'application/json', cacheHint: { ttlMs: 30_000, cacheScope: 'public' } },
    async (uri, { name }) => {
      let datasetName = Array.isArray(name) ? name[0] : name
      datasetName = await resolveDataset(datasetName)
      const metadata = await portalFetch<DatasetMetadata>(`${PORTAL_URL}/datasets/${datasetName}/metadata`)
      const head = await portalFetch<BlockHead>(`${PORTAL_URL}/datasets/${datasetName}/head`)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ ...metadata, head }, null, 2),
          },
        ],
      }
    },
  )

  // Resource: EVM API Schema
  server.registerResource(
    'schema-evm',
    'sqd://schema/evm',
    { mimeType: 'application/json', cacheHint: { ttlMs: 300_000, cacheScope: 'public' } },
    async (uri) => {
      const schema = {
        description: 'SQD Portal EVM API Documentation',
        version: npmVersion,
        endpoints: {
          blocks: {
            description: 'Query block data',
            fields: Object.keys(buildEvmBlockFields(true)),
            filters: ['number', 'hash'],
          },
          transactions: {
            description: 'Query transaction data',
            fields: Object.keys(buildEvmTransactionFields(true)),
            filters: ['from', 'to', 'sighash', 'firstNonce', 'lastNonce'],
            relatedData: ['logs', 'traces', 'stateDiffs'],
          },
          logs: {
            description: 'Query event logs',
            fields: Object.keys(buildEvmLogFields()),
            filters: ['address', 'topic0', 'topic1', 'topic2', 'topic3'],
            relatedData: ['transaction', 'transactionTraces', 'transactionLogs'],
          },
          traces: {
            description: 'Query internal transactions/traces',
            fields: Object.keys(buildEvmTraceFields()),
            filters: [
              'type',
              'callFrom',
              'callTo',
              'callSighash',
              'suicideRefundAddress',
              'rewardAuthor',
              'createResultAddress',
            ],
            relatedData: ['transaction', 'transactionLogs', 'subtraces', 'parents'],
          },
          stateDiffs: {
            description: 'Query state changes',
            fields: Object.keys(buildEvmStateDiffFields()),
            filters: ['address', 'key', 'kind'],
            kindValues: {
              '=': 'exists (no change)',
              '+': 'created',
              '*': 'modified',
              '-': 'deleted',
            },
          },
        },
        l2Fields: [
          'l1Fee',
          'l1FeeScalar',
          'l1GasPrice',
          'l1GasUsed',
          'l1BlobBaseFee',
          'l1BlobBaseFeeScalar',
          'l1BaseFeeScalar',
          'l1BlockNumber',
        ],
        eventSignatures: EVENT_SIGNATURES,
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(schema, null, 2),
          },
        ],
      }
    },
  )

  // Resource: Solana API Schema
  server.registerResource(
    'schema-solana',
    'sqd://schema/solana',
    { mimeType: 'application/json', cacheHint: { ttlMs: 300_000, cacheScope: 'public' } },
    async (uri) => {
      const schema = {
        description: 'SQD Portal Solana API Documentation',
        version: npmVersion,
        endpoints: {
          instructions: {
            description: 'Query instruction data',
            fields: Object.keys(buildSolanaInstructionFields(true)),
            filters: [
              'programId',
              'd1',
              'd2',
              'd4',
              'd8',
              'a0-a15 (account positions)',
              'mentionsAccount',
              'isCommitted',
              'transactionFeePayer',
            ],
            discriminatorInfo: {
              d1: '1-byte discriminator (0x-prefixed hex)',
              d2: '2-byte discriminator (0x-prefixed hex)',
              d4: '4-byte discriminator (0x-prefixed hex)',
              d8: '8-byte discriminator - Anchor standard (0x-prefixed hex)',
            },
            relatedData: [
              'transaction',
              'transactionBalances',
              'transactionTokenBalances',
              'transactionInstructions',
              'innerInstructions',
              'logs',
            ],
          },
          transactions: {
            description: 'Query transaction data',
            fields: Object.keys(buildSolanaTransactionFields()),
            filters: ['feePayer', 'isCommitted'],
          },
          balances: {
            description: 'Query SOL balance changes',
            fields: Object.keys(buildSolanaBalanceFields()),
            filters: ['account'],
          },
          tokenBalances: {
            description: 'Query SPL token balance changes',
            fields: Object.keys(buildSolanaTokenBalanceFields()),
            filters: ['account', 'mint', 'owner', 'preProgramId', 'postProgramId'],
          },
          logs: {
            description: 'Query log messages',
            fields: Object.keys(buildSolanaLogFields()),
            filters: ['programId', 'kind'],
            kindValues: ['log', 'data', 'other'],
          },
          rewards: {
            description: 'Query block rewards',
            fields: Object.keys(buildSolanaRewardFields()),
            filters: ['pubkey'],
          },
        },
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(schema, null, 2),
          },
        ],
      }
    },
  )
}
