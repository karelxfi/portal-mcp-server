import type {
  CallToolResult,
  InputRequiredResult,
  McpServer,
  RegisteredTool,
  ServerContext,
} from '@modelcontextprotocol/server'
import { type ZodRawShape, z } from 'zod'

type PortalToolResult = CallToolResult | InputRequiredResult

const PORTAL_TOOL_TITLES: Record<string, string> = {
  portal_list_networks: 'Find blockchain networks',
  portal_get_network_info: 'Check network status',
  portal_get_head: 'Get the latest block',
  portal_resolve_entity: 'Find a token or contract',
  portal_get_recent_activity: 'View recent blockchain activity',
  portal_get_wallet_summary: 'Review wallet activity',
  portal_get_time_series: 'Chart blockchain activity',
  portal_substrate_query_events: 'Find Polkadot events',
  portal_substrate_query_calls: 'Find Polkadot calls',
  portal_substrate_get_analytics: 'Analyze Polkadot activity',
  portal_evm_query_transactions: 'Find Ethereum and Base transactions',
  portal_evm_query_logs: 'Find smart contract events',
  portal_evm_query_token_transfers: 'Find token transfers',
  portal_evm_get_contract_deployment: 'Find a contract deployment',
  portal_evm_get_contract_activity: 'Review smart contract activity',
  portal_evm_get_analytics: 'Analyze Ethereum and Base activity',
  portal_evm_get_ohlc: 'Chart token price history',
  portal_solana_query_transactions: 'Find Solana transactions',
  portal_solana_query_instructions: 'Find Solana program activity',
  portal_solana_get_analytics: 'Analyze Solana activity',
  portal_bitcoin_query_transactions: 'Find Bitcoin transactions',
  portal_bitcoin_get_analytics: 'Analyze Bitcoin activity',
  portal_hyperliquid_query_fills: 'Find Hyperliquid trades',
  portal_hyperliquid_get_analytics: 'Analyze Hyperliquid trading',
  portal_hyperliquid_get_ohlc: 'Chart Hyperliquid prices',
  portal_debug_query_blocks: 'Inspect raw blocks',
  portal_debug_resolve_time_to_block: 'Match a time to a block',
  portal_debug_hyperliquid_query_replica_commands: 'Inspect Hyperliquid command records',
}

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const

function getPortalToolTitle(name: string): string {
  const title = PORTAL_TOOL_TITLES[name]
  if (!title) throw new Error(`Missing public title for MCP tool: ${name}`)
  return title
}

/**
 * Registers Portal's concise Zod raw shapes through the MCP SDK v2 schema API.
 * Keeping this translation in one place lets every tool use the modern API
 * without duplicating schema wrapping or reaching into SDK internals.
 */
export function registerPortalTool<InputShape extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputShape: InputShape,
  handler: (
    args: z.infer<z.ZodObject<InputShape>>,
    context: ServerContext,
  ) => PortalToolResult | Promise<PortalToolResult>,
): RegisteredTool {
  return server.registerTool(
    name,
    {
      title: getPortalToolTitle(name),
      description,
      inputSchema: z.object(inputShape),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    handler,
  )
}
