import type {
  CallToolResult,
  InputRequiredResult,
  McpServer,
  RegisteredTool,
  ServerContext,
} from '@modelcontextprotocol/server'
import { type ZodRawShape, z } from 'zod'

import { runWithPortalRequestDeadline } from './request-context.js'

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
  openWorldHint: true,
} as const

/**
 * Every Portal tool returns the same machine-readable envelope around its
 * tool-specific blockchain data. The catchall is intentional: transaction,
 * log, analytics, and market-data tools expose different primary data keys,
 * while the documented envelope stays stable across the full catalog.
 */
const PORTAL_TOOL_OUTPUT_SCHEMA = z
  .object({
    answer: z.string().optional().describe('Concise answer grounded in the returned blockchain data.'),
    display: z.record(z.string(), z.unknown()).optional().describe('Plain-language labels for presenting the result.'),
    next_steps: z
      .object({
        actions: z.array(z.record(z.string(), z.unknown())),
        continuation: z.record(z.string(), z.unknown()).optional(),
        custom_data: z.record(z.string(), z.unknown()).optional(),
      })
      .catchall(z.unknown())
      .optional()
      .describe('Safe follow-up actions and continuation guidance.'),
    items: z.array(z.unknown()).optional().describe('Primary result rows when the tool returns a list.'),
    value: z.unknown().optional().describe('Primary result when the tool returns a scalar value.'),
    investigation: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Evidence paths, useful pivots, and result limitations.'),
    error: z
      .object({
        code: z.string(),
        origin: z.string(),
        summary: z.string(),
        retryable: z.boolean(),
        retry_after_ms: z.number().optional(),
        suggestions: z.array(z.string()),
      })
      .catchall(z.unknown())
      .optional()
      .describe('Structured failure details when the tool cannot complete the request.'),
    _meta: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Network, block range, timing, and row-count metadata.'),
    _summary: z.string().optional().describe('Human-readable summary of the result.'),
    _tool_contract: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Tool identity, intent, and supported blockchain families.'),
    _pagination: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Pagination state and an optional continuation cursor.'),
    _ordering: z.unknown().optional().describe('Ordering guarantees for the returned data.'),
    _freshness: z.unknown().optional().describe('Freshness and finality information for the returned data.'),
    _coverage: z.unknown().optional().describe('Completeness of the requested window and result set.'),
    _execution: z.record(z.string(), z.unknown()).optional().describe('Bounded execution and scan details.'),
    _ui: z.unknown().optional().describe('Optional chart, table, and follow-up presentation metadata.'),
    pipes_handoff: z.unknown().optional().describe('Optional SQD Pipes guidance for custom data needs.'),
    _notice: z.string().optional().describe('Important limitation or truncation notice.'),
    _notices: z.array(z.string()).optional().describe('Important limitations or truncation notices.'),
    _llm: z.unknown().optional().describe('Hints that help an AI client locate the primary evidence.'),
  })
  .catchall(z.unknown())

function getPortalToolTitle(name: string): string {
  const title = PORTAL_TOOL_TITLES[name]
  if (name.startsWith('__test_')) return name.slice('__test_'.length).replaceAll('_', ' ')
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
  options?: { deadlineMs?: number },
): RegisteredTool {
  const deadlineMs = options?.deadlineMs
  const boundedHandler = deadlineMs !== undefined
    ? (args: z.infer<z.ZodObject<InputShape>>, context: ServerContext) =>
        runWithPortalRequestDeadline(
          deadlineMs,
          async () => handler(args, context),
          { tool: name, stage: 'tool' },
        )
    : handler

  return server.registerTool(
    name,
    {
      title: getPortalToolTitle(name),
      description,
      inputSchema: z.object(inputShape),
      outputSchema: PORTAL_TOOL_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    boundedHandler,
  )
}
