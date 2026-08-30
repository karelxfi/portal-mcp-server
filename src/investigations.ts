import { type McpServer, ResourceTemplate, completable } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { npmVersion } from './version.js'

const COMMON_NETWORKS = [
  'ethereum-mainnet',
  'base-mainnet',
  'arbitrum-one',
  'optimism-mainnet',
  'polygon-mainnet',
  'solana-mainnet',
  'bitcoin-mainnet',
  'tron-mainnet',
  'polkadot',
  'hyperliquid-fills',
]

const TIMEFRAMES = ['1h', '6h', '24h', '7d', '30d']

const networkArgument = completable(
  z.string().min(1).describe('Blockchain network or SQD network name'),
  (value) => COMMON_NETWORKS.filter((network) => network.includes(String(value ?? '').toLowerCase())).slice(0, 10),
)

const timeframeArgument = completable(
  z.string().min(1).default('24h').describe('Recent time window such as 1h, 24h, 7d, or 30d'),
  (value) => TIMEFRAMES.filter((timeframe) => timeframe.startsWith(String(value ?? '').toLowerCase())),
)

type InvestigationDefinition = {
  name: string
  title: string
  description: string
  outcome: string
  required_evidence: string[]
  workflow: Array<{ step: number; use: string; purpose: string }>
  completion_contract: string[]
}

export const INVESTIGATIONS: InvestigationDefinition[] = [
  {
    name: 'wallet-incident',
    title: 'Investigate a wallet incident',
    description: 'Trace wallet activity, counterparties, token flows, and exact blockchain records.',
    outcome:
      'Explain what happened to a wallet, when it happened, which assets and counterparties were involved, and which exact rows prove each finding.',
    required_evidence: [
      'Wallet summary with the requested network and exact window',
      'Fund flows, largest movements, and ranked counterparties',
      'Exact transactions or transfers for every material finding',
      'Coverage, freshness, pagination, ordering, and the evidence receipt',
    ],
    workflow: [
      { step: 1, use: 'portal_list_networks', purpose: 'Resolve a fuzzy network name if needed.' },
      { step: 2, use: 'portal_get_network_info', purpose: 'Check indexed coverage and freshness.' },
      { step: 3, use: 'portal_get_wallet_summary', purpose: 'Build the wallet overview and identify pivots.' },
      {
        step: 4,
        use: 'chain-specific transaction, transfer, instruction, or fill tools',
        purpose: 'Verify material findings with exact records.',
      },
    ],
    completion_contract: [
      'Do not call a bounded page complete when _evidence.result.completeness is partial or unknown.',
      'Name the analyzed window and disclose any sampling, missing window, or continuation.',
      'Cite exact hashes, block or time identities, and evidence paths for the key findings.',
      'Use the MCP App when available, but keep the structured answer complete without it.',
    ],
  },
  {
    name: 'contract-activity',
    title: 'Investigate a smart contract',
    description: 'Explain deployment, calls, events, token flows, actors, and changes over time.',
    outcome:
      'Explain what a contract did during the requested window, who interacted with it, how activity changed, and which exact rows support the explanation.',
    required_evidence: [
      'Resolved network and contract identity',
      'Deployment record when available',
      'Contract activity overview and previous-period comparison',
      'Exact event logs, transactions, or token transfers for important behavior',
      'Coverage, freshness, pagination, ordering, and the evidence receipt',
    ],
    workflow: [
      { step: 1, use: 'portal_resolve_entity', purpose: 'Resolve the protocol, token, or contract name.' },
      { step: 2, use: 'portal_evm_get_contract_deployment', purpose: 'Find deployment evidence.' },
      { step: 3, use: 'portal_evm_get_contract_activity', purpose: 'Measure calls, events, actors, and flows.' },
      { step: 4, use: 'portal_get_time_series', purpose: 'Compare the current and previous periods.' },
      {
        step: 5,
        use: 'portal_evm_query_logs, portal_evm_query_transactions, or portal_evm_query_token_transfers',
        purpose: 'Verify the explanation with exact records.',
      },
    ],
    completion_contract: [
      'Keep contract creation, calls, logs, and transfers distinct.',
      'Do not infer event meaning without a supported signature or decoded field.',
      'Compare periods using independent exact windows and evidence receipts.',
      'Use the MCP App when available, but keep the structured answer complete without it.',
    ],
  },
  {
    name: 'market-activity',
    title: 'Investigate blockchain market activity',
    description: 'Analyze Hyperliquid fills, price, volume, participants, and exact market records.',
    outcome:
      'Explain price and trading activity during the requested window with chart-ready data, exact fills, a previous-period comparison, and factual limitations.',
    required_evidence: [
      'Exact market, coin, pool, or token identity',
      'OHLC and volume buckets with gap diagnostics',
      'Exact fills, swaps, or transfers behind material observations',
      'Current and previous windows when a comparison is requested',
      'Coverage, freshness, pagination, ordering, and the evidence receipt',
    ],
    workflow: [
      { step: 1, use: 'portal_resolve_entity', purpose: 'Resolve a coin, token, pool, or contract name.' },
      {
        step: 2,
        use: 'portal_hyperliquid_get_ohlc or portal_evm_get_ohlc',
        purpose: 'Build complete price and volume buckets.',
      },
      {
        step: 3,
        use: 'portal_hyperliquid_get_analytics or portal_get_time_series',
        purpose: 'Measure volume, fills, participants, and period change.',
      },
      {
        step: 4,
        use: 'portal_hyperliquid_query_fills or exact EVM query tools',
        purpose: 'Verify peaks and outliers with exact market records.',
      },
    ],
    completion_contract: [
      'Do not invent liquidations, leverage, or position state when the selected source does not provide them.',
      'Distinguish zero activity from missing source coverage.',
      'Reconcile OHLC, volume, and fill counts to the returned exact evidence.',
      'Use the MCP App when available, but keep the structured answer complete without it.',
    ],
  },
]

function findInvestigation(name: string): InvestigationDefinition | undefined {
  return INVESTIGATIONS.find((investigation) => investigation.name === name)
}

function promptText(params: {
  investigation: InvestigationDefinition
  network: string
  subject: string
  timeframe: string
  question?: string
}): string {
  const { investigation, network, subject, timeframe, question } = params
  return [
    `Run the SQD ${investigation.title.toLowerCase()} workflow.`,
    '',
    `Network: ${network}`,
    `Subject: ${subject}`,
    `Window: ${timeframe}`,
    ...(question ? [`Question: ${question}`] : []),
    '',
    `Outcome: ${investigation.outcome}`,
    '',
    'Work through these steps:',
    ...investigation.workflow.map((step) => `${step.step}. Use ${step.use}. ${step.purpose}`),
    '',
    'Factual contract:',
    ...investigation.completion_contract.map((rule) => `- ${rule}`),
    '- Read _evidence, _coverage, _freshness, _ordering, and _pagination before making factual claims.',
    '- Continue through all result pages needed for the question, or state clearly what remains.',
    '- Separate observations from interpretations. Never make a claim that the exact rows do not support.',
  ].join('\n')
}

export function registerInvestigationPromptsAndResources(server: McpServer) {
  server.registerResource(
    'investigation-guide',
    'sqd://investigations',
    { mimeType: 'application/json', cacheHint: { ttlMs: 300_000, cacheScope: 'public' } },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ version: npmVersion, investigations: INVESTIGATIONS }, null, 2),
        },
      ],
    }),
  )

  server.registerResource(
    'investigation-guide-entry',
    new ResourceTemplate('sqd://investigations/{name}', { list: undefined }),
    { mimeType: 'application/json', cacheHint: { ttlMs: 300_000, cacheScope: 'public' } },
    async (uri, { name }) => {
      const investigationName = Array.isArray(name) ? name[0] : name
      const investigation = findInvestigation(investigationName)
      if (!investigation) throw new Error(`Unknown SQD investigation "${investigationName}".`)
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(investigation, null, 2) },
        ],
      }
    },
  )

  server.registerPrompt(
    'investigate-wallet',
    {
      title: 'Investigate a wallet incident',
      description: 'Trace wallet activity, token flows, counterparties, and exact blockchain evidence.',
      argsSchema: z.object({
        network: networkArgument,
        address: z.string().min(1).describe('Wallet address to investigate'),
        timeframe: timeframeArgument,
        question: z.string().optional().describe('Optional incident question or concern'),
      }),
    },
    ({ network, address, timeframe, question }) => ({
      description: `Investigate ${address} on ${network}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: promptText({
              investigation: INVESTIGATIONS[0],
              network,
              subject: address,
              timeframe,
              question,
            }),
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'investigate-contract',
    {
      title: 'Investigate a smart contract',
      description: 'Explain deployment, calls, events, token flows, actors, and changes over time.',
      argsSchema: z.object({
        network: networkArgument,
        contract: z.string().min(1).describe('Contract address, token, or protocol name'),
        timeframe: timeframeArgument,
        question: z.string().optional().describe('Optional behavior or event to explain'),
      }),
    },
    ({ network, contract, timeframe, question }) => ({
      description: `Investigate ${contract} on ${network}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: promptText({
              investigation: INVESTIGATIONS[1],
              network,
              subject: contract,
              timeframe,
              question,
            }),
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'investigate-market',
    {
      title: 'Investigate blockchain market activity',
      description: 'Analyze Hyperliquid or onchain price, volume, fills, swaps, and exact market evidence.',
      argsSchema: z.object({
        network: networkArgument,
        market: z.string().min(1).describe('Coin, token, pool, or market to investigate'),
        timeframe: timeframeArgument,
        question: z.string().optional().describe('Optional price or trading question'),
      }),
    },
    ({ network, market, timeframe, question }) => ({
      description: `Investigate ${market} on ${network}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: promptText({
              investigation: INVESTIGATIONS[2],
              network,
              subject: market,
              timeframe,
              question,
            }),
          },
        },
      ],
    }),
  )
}
