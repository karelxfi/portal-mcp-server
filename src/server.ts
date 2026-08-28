import { CLIENT_INFO_META_KEY, McpServer, type ServerContext } from '@modelcontextprotocol/server'

import { RequestCancelledError } from './helpers/errors.js'
import { runWithPortalRequestSignal } from './helpers/request-context.js'
import { toolCallDuration, toolCallsActive, toolCallsTotal } from './metrics.js'
import {
  classifyToolOutcome,
  type RuntimeRequestContext,
  createInvocationId,
  recordToolOutcome,
} from './observability.js'
import { registerSchemaResource } from './resources/schema.js'
import { registerAllTools } from './tools/index.js'
import { npmVersion } from './version.js'

// ============================================================================
// Server Factory
// ============================================================================

export const PORTAL_SERVER_INSTRUCTIONS =
  'SQD provides read-only blockchain data from SQD Portal. Start with portal_list_networks to resolve a network, then use portal_get_network_info to check availability and freshness. Use chain-specific query tools for Ethereum-compatible networks, Tron, Solana, Bitcoin, Polkadot and other Substrate networks, and Hyperliquid. Prefer timeframe for recent windows and from_block/to_block for exact evidence. Check _coverage and _pagination before claiming completeness, and reuse _pagination.next_cursor when present. No authentication is required.'

export function createPortalServer(runtimeContext: RuntimeRequestContext = { transport: 'stdio' }): McpServer {
  const server = new McpServer({
    name: 'sqd-portal-mcp-server',
    version: npmVersion,
  }, {
    instructions: PORTAL_SERVER_INSTRUCTIONS,
  })

  function instrumentToolHandler<TArgs extends unknown[]>(
    toolName: string,
    handler: (...handlerArgs: TArgs) => Promise<unknown>,
  ) {
    return async (...handlerArgs: TArgs) => {
      const invocationId = createInvocationId()
      const startedAt = Date.now()
      const end = toolCallDuration.startTimer({ tool: toolName, transport: runtimeContext.transport })
      toolCallsActive.inc({ tool: toolName, transport: runtimeContext.transport })
      const extraCandidate = handlerArgs[handlerArgs.length - 1]
      const requestContext =
        extraCandidate && typeof extraCandidate === 'object' && 'mcpReq' in extraCandidate
          ? (extraCandidate as ServerContext)
          : undefined
      const toolArgs = (
        handlerArgs.length > 1 && handlerArgs[0] && typeof handlerArgs[0] === 'object' ? handlerArgs[0] : {}
      ) as Record<string, unknown>
      const requestSignal = requestContext?.mcpReq.signal
      const envelope = requestContext?.mcpReq.envelope as Record<string, unknown> | undefined
      const envelopeClient = envelope?.[CLIENT_INFO_META_KEY]
      const declaredClient =
        envelopeClient && typeof envelopeClient === 'object'
          ? (envelopeClient as { name?: unknown; version?: unknown })
          : server.server.getClientVersion()
      const effectiveRuntime: RuntimeRequestContext = {
        ...runtimeContext,
        clientName: typeof declaredClient?.name === 'string' ? declaredClient.name : runtimeContext.clientName,
        clientVersion:
          typeof declaredClient?.version === 'string' ? declaredClient.version : runtimeContext.clientVersion,
        protocolVersion: server.server.getNegotiatedProtocolVersion(),
      }

      try {
        const result = await runWithPortalRequestSignal(requestSignal, () => handler(...handlerArgs))
        const status = classifyToolOutcome({ result })
        toolCallsTotal.inc({
          tool: toolName,
          status,
          transport: runtimeContext.transport,
          server_version: npmVersion,
        })
        recordToolOutcome({
          toolName,
          args: toolArgs,
          result,
          durationMs: Date.now() - startedAt,
          runtime: effectiveRuntime,
          invocationId,
          status,
        })
        return result
      } catch (error) {
        const status = classifyToolOutcome({
          error,
          cancelled: requestSignal?.aborted || error instanceof RequestCancelledError,
        })
        toolCallsTotal.inc({ tool: toolName, status, transport: runtimeContext.transport, server_version: npmVersion })
        recordToolOutcome({
          toolName,
          args: toolArgs,
          error: status === 'cancelled' ? new RequestCancelledError() : error,
          durationMs: Date.now() - startedAt,
          runtime: effectiveRuntime,
          invocationId,
          status,
        })
        throw error
      } finally {
        end()
        toolCallsActive.dec({ tool: toolName, transport: runtimeContext.transport })
      }
    }
  }

  // Instrument the single MCP SDK v2 registration surface used by every tool.
  const originalRegisterTool = server.registerTool.bind(server)

  ;(server as any).registerTool = (...args: any[]) => {
    const toolName = args[0] as string
    const handler = args[2] as ((...handlerArgs: any[]) => Promise<any>) | undefined

    if (typeof handler === 'function') {
      args[2] = instrumentToolHandler(toolName, handler)
    }

    return originalRegisterTool(
      ...(args as [string, Parameters<typeof server.registerTool>[1], Parameters<typeof server.registerTool>[2]]),
    )
  }

  // Register resources
  registerSchemaResource(server)

  // Register all tools
  registerAllTools(server)

  return server
}
