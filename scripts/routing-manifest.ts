import { TOOL_SPECS } from './tool-manifest.ts'

export interface RoutingEvalCase {
  prompt: string
  expected: string
  max_rank?: number
  acceptable?: string[]
  source: 'manifest' | 'extra'
}

const MANIFEST_ROUTING_CASES: RoutingEvalCase[] = TOOL_SPECS.map((spec) => ({
  prompt: spec.prompt,
  expected: spec.name,
  max_rank: 1,
  source: 'manifest',
}))

const EXTRA_ROUTING_CASES: RoutingEvalCase[] = [
  {
    prompt: 'which chain name am i supposed to use for Base',
    expected: 'portal_list_networks',
    max_rank: 1,
    source: 'extra',
  },
  { prompt: 'is monad indexed yet or is it behind', expected: 'portal_get_network_info', max_rank: 1, source: 'extra' },
  { prompt: 'what is the current head on optimism', expected: 'portal_get_head', max_rank: 1, source: 'extra' },
  {
    prompt: 'show me recent stuff on solana without making me think too hard',
    expected: 'portal_get_recent_activity',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'i have a wallet address, can you just summarize what it has been doing',
    expected: 'portal_get_wallet_summary',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'graph transactions on base over the last 24h',
    expected: 'portal_get_time_series',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'give me raw base transactions from the last hour',
    expected: 'portal_evm_query_transactions',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'which tx was the first one on ethereum mainnet with tx type 0x1 starting from block 12244000',
    expected: 'portal_evm_query_transactions',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'show me the biggest gas used transfer calls to USDC on Base',
    expected: 'portal_evm_query_transactions',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'top senders on Base over the past hour',
    expected: 'portal_evm_query_transactions',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'top receivers by transaction count on Base today',
    expected: 'portal_evm_query_transactions',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'show me usdc transfer events on base',
    expected: 'portal_evm_query_logs',
    acceptable: ['portal_evm_query_token_transfers'],
    max_rank: 2,
    source: 'extra',
  },
  {
    prompt: 'find the first transfer event emitted by this contract in that block range',
    expected: 'portal_evm_query_logs',
    acceptable: ['portal_evm_query_token_transfers'],
    max_rank: 2,
    source: 'extra',
  },
  {
    prompt:
      "DSQDAccessPass is deployed on Base mainnet at 0xE4E70FdF2Fc1147a7f35c4c5de88E6BeA63eeAfA. Using SQD Portal, find out what's the ID of the latest pass minted and give me the tx hash as well.",
    expected: 'portal_evm_query_logs',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'just show me token transfers for usdc on base, not all logs',
    expected: 'portal_evm_query_token_transfers',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'investigate this suspicious wallet on base and show the evidence trail',
    expected: 'portal_get_wallet_summary',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'trace suspicious usdc movement on base after a hack',
    expected: 'portal_evm_query_token_transfers',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'show exact raw base transactions for this onchain investigation',
    expected: 'portal_evm_query_transactions',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'what contract address does bored apes resolve to',
    expected: 'portal_resolve_entity',
    max_rank: 1,
    source: 'extra',
  },
  { prompt: 'which protocol slug is uniswap', expected: 'portal_resolve_entity', max_rank: 1, source: 'extra' },
  { prompt: 'resolve bitcoin ticker for hyperliquid', expected: 'portal_resolve_entity', max_rank: 1, source: 'extra' },
  {
    prompt: 'who deployed this evm contract and what was the deployment tx',
    expected: 'portal_evm_get_contract_deployment',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'find the deployment of bored apes',
    expected: 'portal_evm_get_contract_deployment',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'is this base contract busy lately',
    expected: 'portal_evm_get_contract_activity',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'what are the hottest contracts on base right now',
    expected: 'portal_evm_get_analytics',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'make me 5 minute candles for this pool on base',
    expected: 'portal_evm_get_ohlc',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'give me a quick preview chart for this base pool with trades',
    expected: 'portal_evm_get_ohlc',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'make me a dexscreener style chart for this base pool and include recent trades',
    expected: 'portal_evm_get_ohlc',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'show me raw solana transactions for the last few slots',
    expected: 'portal_solana_query_transactions',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'show me program instructions on solana',
    expected: 'portal_solana_query_instructions',
    max_rank: 1,
    source: 'extra',
  },
  { prompt: 'how healthy is solana right now', expected: 'portal_solana_get_analytics', max_rank: 1, source: 'extra' },
  {
    prompt: 'show me raw bitcoin transactions with inputs and outputs',
    expected: 'portal_bitcoin_query_transactions',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'how is bitcoin mainnet doing right now',
    expected: 'portal_bitcoin_get_analytics',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'who sent trx to this tron wallet in the last hour',
    expected: 'portal_tron_query_transactions',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'what did this ethereum transaction call internally',
    expected: 'portal_evm_query_traces',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'which contracts did this deployer create',
    expected: 'portal_evm_query_traces',
    max_rank: 2,
    source: 'extra',
  },
  {
    prompt: 'recent usdt trc20 transfer events on tron',
    expected: 'portal_tron_query_logs',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'show me raw polkadot events with the parent extrinsic',
    expected: 'portal_substrate_query_events',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'show me raw polkadot calls and the events they emitted',
    expected: 'portal_substrate_query_calls',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'how is polkadot doing in this indexed window',
    expected: 'portal_substrate_get_analytics',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'show me the latest fills on hyperliquid',
    expected: 'portal_hyperliquid_query_fills',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'who traded the most on hyperliquid lately',
    expected: 'portal_hyperliquid_get_analytics',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'give me eth candles on hyperliquid for the last 6 hours',
    expected: 'portal_hyperliquid_get_ohlc',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'i am debugging, show me raw base blocks directly',
    expected: 'portal_debug_query_blocks',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'what base block matches this exact timestamp',
    expected: 'portal_debug_resolve_time_to_block',
    max_rank: 1,
    source: 'extra',
  },
  {
    prompt: 'i need raw hyperliquid order and cancel commands, not fills',
    expected: 'portal_debug_hyperliquid_query_replica_commands',
    max_rank: 1,
    source: 'extra',
  },
]

export const ROUTING_EVAL_CASES: RoutingEvalCase[] = [...MANIFEST_ROUTING_CASES, ...EXTRA_ROUTING_CASES]
