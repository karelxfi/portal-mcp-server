import { CLIENT_INFO_META_KEY, McpServer, type ServerContext } from '@modelcontextprotocol/server'

import {
  classifyUiCapability,
  isActivityExplorerEnabled,
  isActivityExplorerEnabledByDeployment,
  recordActivityExplorerResult,
  registerActivityExplorerResource,
  runWithActivityExplorerSurface,
} from './apps/activity-explorer.js'
import { RequestCancelledError } from './helpers/errors.js'
import { attachEvidenceReceipt } from './helpers/evidence-receipt.js'
import { runWithPortalRequestSignal } from './helpers/request-context.js'
import { getToolWorkProfile, toolAdmission } from './helpers/tool-admission.js'
import { formatToolError } from './helpers/tool-error.js'
import { registerInvestigationPromptsAndResources } from './investigations.js'
import { toolCallDuration, toolCallsActive, toolCallsTotal } from './metrics.js'
import {
  type RuntimeRequestContext,
  classifyToolOutcome,
  createInvocationId,
  recordToolOutcome,
} from './observability.js'
import { registerSchemaResource } from './resources/schema.js'
import { registerAllTools } from './tools/index.js'
import {
  type ToolSelection,
  getActiveToolSelection,
  isToolEnabled,
  narrowToolSelection,
  resolveDeploymentToolSelection,
  runWithToolSelection,
} from './toolsets.js'
import { npmVersion } from './version.js'

// ============================================================================
// Server Factory
// ============================================================================

const PORTAL_BASE_INSTRUCTIONS =
  'SQD provides read-only blockchain data from SQD Portal. Start with portal_list_networks to resolve a network, then use portal_get_network_info to check availability and freshness. Check _coverage and _pagination before claiming completeness, and reuse _pagination.next_cursor when present.'

/* Only an opted-in deployment may point the model at the beta App. */
const PORTAL_APP_INSTRUCTIONS =
  ' Its MCP App is named SQD Explorer. A successful result from any tool whose _meta carries ui.resourceUri can open in the Explorer with exact charts, tables, timelines, coverage, freshness, and safe follow-ups; a result being App-ready is not proof that the host rendered it. To demonstrate the App, run a successful App-enabled tool and only say it rendered when the host confirms a render. Use portal_get_recent_activity for the activity view, portal_hyperliquid_get_ohlc for the market chart, portal_evm_get_analytics for the analytics dashboard, and portal_get_wallet_summary for the wallet view.'

const PORTAL_NETWORK_INSTRUCTIONS =
  ' Chain-specific MCP query tools cover Ethereum-compatible networks, Solana, Bitcoin, Polkadot and other Substrate networks, and Hyperliquid. Tron is available for network discovery, head, freshness, and timestamp-to-block lookups; use the bundled SQD Portal skill for native Tron Stream API queries. Prefer timeframe for recent windows and from_block/to_block for exact evidence. No authentication is required.'

const PORTAL_TRIMMED_BASE_INSTRUCTIONS =
  'SQD provides read-only blockchain data from SQD Portal. This connection exposes a subset of the SQD tool catalog. Check _coverage and _pagination before claiming completeness, and reuse _pagination.next_cursor when present.'

export function getPortalServerInstructions(selection: ToolSelection = getActiveToolSelection()): string {
  return (
    (selection.toolsets.has('discovery') && isToolEnabled(selection, 'portal_list_networks')
      ? PORTAL_BASE_INSTRUCTIONS
      : PORTAL_TRIMMED_BASE_INSTRUCTIONS) +
    (isActivityExplorerEnabled() ? PORTAL_APP_INSTRUCTIONS : '') +
    PORTAL_NETWORK_INSTRUCTIONS
  )
}

/* Resolved once per process; a connection may only narrow it. */
const DEPLOYMENT_TOOL_SELECTION = resolveDeploymentToolSelection(process.env)
for (const warning of DEPLOYMENT_TOOL_SELECTION.warnings) {
  console.error(`[mcp:toolsets] ${warning}`)
}

export function getDeploymentToolSelection(): ToolSelection {
  return DEPLOYMENT_TOOL_SELECTION
}

export function createPortalServer(runtimeContext: RuntimeRequestContext = { transport: 'stdio' }): McpServer {
  const appEnabled = runtimeContext.appEnabled ?? isActivityExplorerEnabledByDeployment()
  const selection = narrowToolSelection(DEPLOYMENT_TOOL_SELECTION, runtimeContext.toolsets)
  const context: RuntimeRequestContext = { ...runtimeContext, toolsetLabel: selection.label }
  return runWithActivityExplorerSurface(appEnabled, () =>
    runWithToolSelection(selection, () => buildPortalServer(context, appEnabled)),
  )
}

function buildPortalServer(runtimeContext: RuntimeRequestContext, appEnabled: boolean): McpServer {
  const server = new McpServer(
    {
      name: 'sqd-portal-mcp-server',
      version: npmVersion,
    },
    {
      instructions: getPortalServerInstructions(),
    },
  )

  function instrumentToolHandler<TArgs extends unknown[]>(
    toolName: string,
    handler: (...handlerArgs: TArgs) => Promise<unknown>,
  ) {
    return async (...handlerArgs: TArgs) => {
      const invocationId = createInvocationId()
      const startedAt = Date.now()
      const end = toolCallDuration.startTimer({ tool: toolName, transport: runtimeContext.transport })
      let admitted = false
      let releaseAdmission: (() => void) | undefined
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
      const uiCapability = classifyUiCapability(envelope, server.server.getClientCapabilities())

      try {
        const lease = await toolAdmission.acquire(getToolWorkProfile(toolName), runtimeContext.transport, requestSignal)
        releaseAdmission = lease.release
        admitted = true
        toolCallsActive.inc({ tool: toolName, transport: runtimeContext.transport })
        /* Handlers run outside the factory's scope, so the connection's app
           choice is re-entered here for the result formatters. */
        const handlerResult = await runWithActivityExplorerSurface(appEnabled, () =>
          runWithPortalRequestSignal(requestSignal, () => handler(...handlerArgs)),
        )
        const result = attachEvidenceReceipt(toolName, toolArgs, handlerResult)
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
        recordActivityExplorerResult({
          toolName,
          result,
          transport: runtimeContext.transport,
          uiCapability,
          resultState: status,
        })
        return result
      } catch (error) {
        const cancelled = requestSignal?.aborted || error instanceof RequestCancelledError
        const status = cancelled ? 'cancelled' : 'tool_error'
        const toolErrorResult = cancelled ? undefined : formatToolError(error, toolName)
        toolCallsTotal.inc({ tool: toolName, status, transport: runtimeContext.transport, server_version: npmVersion })
        recordToolOutcome({
          toolName,
          args: toolArgs,
          ...(cancelled ? { error: new RequestCancelledError() } : { result: toolErrorResult }),
          durationMs: Date.now() - startedAt,
          runtime: effectiveRuntime,
          invocationId,
          status,
        })
        recordActivityExplorerResult({
          toolName,
          result: toolErrorResult,
          transport: runtimeContext.transport,
          uiCapability,
          resultState: status,
        })
        if (cancelled) throw error
        return toolErrorResult
      } finally {
        end()
        if (admitted) toolCallsActive.dec({ tool: toolName, transport: runtimeContext.transport })
        releaseAdmission?.()
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
  registerInvestigationPromptsAndResources(server)
  registerActivityExplorerResource(server, runtimeContext)

  // Register all tools
  registerAllTools(server)

  return server
}
