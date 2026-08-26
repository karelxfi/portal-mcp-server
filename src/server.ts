import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { RequestCancelledError } from './helpers/errors.js'
import { runWithPortalRequestSignal } from './helpers/request-context.js'
import { toolCallDuration, toolCallsActive, toolCallsTotal } from './metrics.js'
import { type RuntimeRequestContext, createInvocationId, recordToolOutcome } from './observability.js'
import { registerSchemaResource } from './resources/schema.js'
import { registerAllTools } from './tools/index.js'
import { npmVersion } from './version.js'

// ============================================================================
// Server Factory
// ============================================================================

export function createPortalServer(runtimeContext: RuntimeRequestContext = { transport: 'stdio' }): McpServer {
  const server = new McpServer({
    name: 'sqd-portal-mcp-server',
    version: npmVersion,
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
      const requestExtra =
        extraCandidate && typeof extraCandidate === 'object' && 'signal' in extraCandidate
          ? (extraCandidate as { signal?: AbortSignal })
          : undefined
      const toolArgs = (
        handlerArgs.length > 1 && handlerArgs[0] && typeof handlerArgs[0] === 'object' ? handlerArgs[0] : {}
      ) as Record<string, unknown>
      const requestSignal = requestExtra?.signal

      try {
        const result = await runWithPortalRequestSignal(requestSignal, () => handler(...handlerArgs))
        toolCallsTotal.inc({
          tool: toolName,
          status: 'success',
          transport: runtimeContext.transport,
          server_version: npmVersion,
        })
        recordToolOutcome({
          toolName,
          args: toolArgs,
          result,
          durationMs: Date.now() - startedAt,
          runtime: runtimeContext,
          invocationId,
        })
        return result
      } catch (error) {
        const status = requestSignal?.aborted || error instanceof RequestCancelledError ? 'cancelled' : 'error'
        toolCallsTotal.inc({ tool: toolName, status, transport: runtimeContext.transport, server_version: npmVersion })
        recordToolOutcome({
          toolName,
          args: toolArgs,
          error: status === 'cancelled' ? new RequestCancelledError() : error,
          durationMs: Date.now() - startedAt,
          runtime: runtimeContext,
          invocationId,
        })
        throw error
      } finally {
        end()
        toolCallsActive.dec({ tool: toolName, transport: runtimeContext.transport })
      }
    }
  }

  // Wrap server.tool() and server.registerTool() to automatically instrument all tools with metrics
  const originalTool = server.tool.bind(server)
  const originalRegisterTool = server.registerTool.bind(server)

  ;(server as any).tool = (...args: any[]) => {
    const handler = args[args.length - 1] as (...handlerArgs: any[]) => Promise<any>
    const toolName = args[0] as string

    args[args.length - 1] = instrumentToolHandler(toolName, handler)

    return originalTool(...(args as Parameters<typeof server.tool>))
  }

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
