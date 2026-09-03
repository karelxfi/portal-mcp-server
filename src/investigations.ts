import { type McpServer, ResourceTemplate, completable } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { detectChainType } from './helpers/chain.js'
import { captureToolActivePredicate } from './toolsets.js'
import { npmVersion } from './version.js'

const WALLET_NETWORKS = [
  'ethereum-mainnet',
  'base-mainnet',
  'arbitrum-one',
  'optimism-mainnet',
  'polygon-mainnet',
  'solana-mainnet',
  'bitcoin-mainnet',
  'hyperliquid-fills',
]

const CONTRACT_NETWORKS = WALLET_NETWORKS.filter((network) => detectChainType(network) === 'evm')
const MARKET_NETWORKS = [...CONTRACT_NETWORKS, 'hyperliquid-fills']

const TIMEFRAMES = ['1h', '6h', '24h', '7d', '30d']

function networkArgument(networks: string[], supported: ReturnType<typeof detectChainType>[], description: string) {
  return completable(
    z
      .string()
      .min(1)
      .refine((network) => supported.includes(detectChainType(network)), description)
      .describe(description),
    (value) => networks.filter((network) => network.includes(String(value ?? '').toLowerCase())).slice(0, 10),
  )
}

const walletNetworkArgument = networkArgument(
  WALLET_NETWORKS,
  ['evm', 'solana', 'bitcoin', 'hyperliquidFills'],
  'Network supported by the wallet investigation: EVM, Solana, Bitcoin, or Hyperliquid fills',
)
const contractNetworkArgument = networkArgument(
  CONTRACT_NETWORKS,
  ['evm'],
  'EVM network supported by the smart-contract investigation',
)
const marketNetworkArgument = networkArgument(
  MARKET_NETWORKS,
  ['evm', 'hyperliquidFills'],
  'EVM or Hyperliquid fills network supported by the market investigation',
)

const timeframeArgument = completable(
  z.string().min(1).default('24h').describe('Recent time window such as 1h, 24h, 7d, or 30d'),
  (value) => TIMEFRAMES.filter((timeframe) => timeframe.startsWith(String(value ?? '').toLowerCase())),
)

/* A workflow step names either tools or a prose instruction, never both.
   `tools` is the source of truth: the step's text is rendered from the tools
   that are actually registered, so a step can never name a tool this
   deployment does not serve. Any one of the listed tools carries the step;
   `optional` marks a pivot the investigation can be run without. */
type InvestigationStep = {
  step: number
  use?: string
  tools?: string[]
  optional?: boolean
  purpose: string
}

type InvestigationDefinition = {
  name: string
  title: string
  description: string
  outcome: string
  required_evidence: string[]
  workflow: InvestigationStep[]
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
      'Fund flows, largest movements within each asset, and separately ranked activity and movement counterparties',
      'Exact transactions or transfers for every material finding',
      'Coverage, freshness, pagination, ordering, and the evidence receipt',
    ],
    workflow: [
      { step: 1, tools: ['portal_list_networks'], purpose: 'Resolve a fuzzy network name if needed.' },
      { step: 2, tools: ['portal_get_network_info'], purpose: 'Check indexed coverage and freshness.' },
      { step: 3, tools: ['portal_get_wallet_summary'], purpose: 'Build the wallet overview and identify pivots.' },
      {
        step: 4,
        use: 'chain-specific transaction, transfer, instruction, or fill tools',
        purpose: 'Verify material findings with exact records.',
      },
      {
        step: 5,
        tools: ['portal_evm_query_traces'],
        optional: true,
        purpose:
          'Pivot from a suspicious transaction hash to its internal calls, created contracts, and value moved below the top-level transaction.',
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
      { step: 1, tools: ['portal_resolve_entity'], purpose: 'Resolve the protocol, token, or contract name.' },
      { step: 2, tools: ['portal_evm_get_contract_deployment'], purpose: 'Find deployment evidence.' },
      { step: 3, tools: ['portal_evm_get_contract_activity'], purpose: 'Measure calls, events, actors, and flows.' },
      { step: 4, tools: ['portal_get_time_series'], purpose: 'Compare the current and previous periods.' },
      {
        step: 5,
        tools: ['portal_evm_query_logs', 'portal_evm_query_transactions', 'portal_evm_query_token_transfers'],
        purpose: 'Verify the explanation with exact records.',
      },
      {
        step: 6,
        tools: ['portal_evm_query_traces'],
        optional: true,
        purpose:
          'Follow one transaction into its internal calls and contract creations when logs alone do not explain it.',
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
      { step: 1, tools: ['portal_resolve_entity'], purpose: 'Resolve a coin, token, pool, or contract name.' },
      {
        step: 2,
        tools: ['portal_hyperliquid_get_ohlc', 'portal_evm_get_ohlc'],
        purpose: 'Build complete price and volume buckets.',
      },
      {
        step: 3,
        tools: ['portal_hyperliquid_get_analytics', 'portal_get_time_series'],
        purpose: 'Measure volume, fills, participants, and period change.',
      },
      {
        step: 4,
        tools: ['portal_hyperliquid_query_fills'],
        purpose: 'Verify peaks and outliers with exact market records, alongside the exact EVM query tools.',
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

function joinToolNames(tools: string[]): string {
  if (tools.length <= 1) return tools[0] ?? ''
  if (tools.length === 2) return `${tools[0]} or ${tools[1]}`
  return `${tools.slice(0, -1).join(', ')}, or ${tools[tools.length - 1]}`
}

/* The workflow as this deployment can actually run it: a step is kept when at
   least one of the tools it names is registered, its text lists only those
   tools, and the surviving steps are renumbered so the sequence has no holes.
   A step with no tools is prose and always survives. */
function activeWorkflow(
  investigation: InvestigationDefinition,
  isActive: (toolName: string) => boolean,
): Array<{ step: number; use: string; purpose: string }> {
  const steps: Array<{ step: number; use: string; purpose: string }> = []
  for (const step of investigation.workflow) {
    if (!step.tools) {
      if (step.use) steps.push({ step: steps.length + 1, use: step.use, purpose: step.purpose })
      continue
    }
    const active = step.tools.filter((tool) => isActive(tool))
    if (active.length === 0) continue
    steps.push({ step: steps.length + 1, use: joinToolNames(active), purpose: step.purpose })
  }
  return steps
}

/* An investigation is offered only when every step it cannot be run without
   has a registered tool. A prompt that survives this still names no missing
   tool, because its text is rendered from the active workflow. */
function investigationAvailable(
  investigation: InvestigationDefinition,
  isActive: (toolName: string) => boolean,
): boolean {
  return investigation.workflow.every(
    (step) => step.optional || !step.tools || step.tools.some((tool) => isActive(tool)),
  )
}

function asServedInvestigation(investigation: InvestigationDefinition, isActive: (toolName: string) => boolean) {
  return { ...investigation, workflow: activeWorkflow(investigation, isActive) }
}

function promptText(params: {
  investigation: InvestigationDefinition
  network: string
  subject: string
  timeframe: string
  question?: string
  isActive: (toolName: string) => boolean
}): string {
  const { investigation, network, subject, timeframe, question, isActive } = params
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
    ...activeWorkflow(investigation, isActive).map((step) => `${step.step}. Use ${step.use}. ${step.purpose}`),
    '',
    'Factual contract:',
    ...investigation.completion_contract.map((rule) => `- ${rule}`),
    '- Read _evidence, _coverage, _freshness, _ordering, and _pagination before making factual claims.',
    '- Continue through all result pages needed for the question, or state clearly what remains.',
    '- Separate observations from interpretations. Never make a claim that the exact rows do not support.',
  ].join('\n')
}

export function registerInvestigationPromptsAndResources(server: McpServer) {
  const isActive = captureToolActivePredicate()

  server.registerResource(
    'investigation-guide',
    'sqd://investigations',
    { mimeType: 'application/json', cacheHint: { ttlMs: 300_000, cacheScope: 'public' } },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              version: npmVersion,
              investigations: INVESTIGATIONS.map((item) => asServedInvestigation(item, isActive)),
            },
            null,
            2,
          ),
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
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(asServedInvestigation(investigation, isActive), null, 2),
          },
        ],
      }
    },
  )

  if (investigationAvailable(INVESTIGATIONS[0], isActive)) {
    server.registerPrompt(
      'investigate-wallet',
      {
        title: 'Investigate a wallet incident',
        description: 'Trace wallet activity, token flows, counterparties, and exact blockchain evidence.',
        argsSchema: z.object({
          network: walletNetworkArgument,
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
                isActive,
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
  }

  if (investigationAvailable(INVESTIGATIONS[1], isActive)) {
    server.registerPrompt(
      'investigate-contract',
      {
        title: 'Investigate a smart contract',
        description: 'Explain deployment, calls, events, token flows, actors, and changes over time.',
        argsSchema: z.object({
          network: contractNetworkArgument,
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
                isActive,
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
  }

  if (investigationAvailable(INVESTIGATIONS[2], isActive)) {
    server.registerPrompt(
      'investigate-market',
      {
        title: 'Investigate blockchain market activity',
        description: 'Analyze Hyperliquid or onchain price, volume, fills, swaps, and exact market evidence.',
        argsSchema: z.object({
          network: marketNetworkArgument,
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
                isActive,
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
}
