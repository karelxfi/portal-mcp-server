import { AsyncLocalStorage } from 'node:async_hooks'

import { CLIENT_CAPABILITIES_META_KEY, type McpServer } from '@modelcontextprotocol/server'

import { LOGO_ORIGINS } from '../app-ui/chains.generated.js'
import { ACTIVITY_EXPLORER_HTML } from '../generated/activity-explorer.generated.js'
import { ACTIVITY_EXPLORER_BYTES, ACTIVITY_EXPLORER_HASH } from '../generated/activity-explorer.version.js'
import { appRenderPayloadBytes, appResourceReadsTotal, appResourceSizeBytes, appToolResultsTotal } from '../metrics.js'
import type { RuntimeRequestContext } from '../observability.js'
import { npmVersion } from '../version.js'
import { RETAINED_ACTIVITY_EXPLORER_RESOURCE_URIS } from './activity-explorer-compat.js'

export { RETAINED_ACTIVITY_EXPLORER_RESOURCE_URIS } from './activity-explorer-compat.js'

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'
export const MCP_APP_EXTENSION_ID = 'io.modelcontextprotocol/ui'
export const ACTIVITY_EXPLORER_RESOURCE_URI = `ui://sqd/activity-explorer.${ACTIVITY_EXPLORER_HASH}.html`

export const ACTIVITY_EXPLORER_TOOLS = new Set([
  'portal_get_recent_activity',
  'portal_get_wallet_summary',
  'portal_get_time_series',
  'portal_substrate_query_events',
  'portal_substrate_query_calls',
  'portal_substrate_get_analytics',
  'portal_evm_query_transactions',
  'portal_evm_query_logs',
  'portal_evm_query_token_transfers',
  'portal_evm_get_contract_deployment',
  'portal_evm_get_contract_activity',
  'portal_evm_get_analytics',
  'portal_evm_get_ohlc',
  'portal_solana_query_transactions',
  'portal_solana_query_instructions',
  'portal_solana_get_analytics',
  'portal_bitcoin_query_transactions',
  'portal_bitcoin_get_analytics',
  'portal_hyperliquid_query_fills',
  'portal_hyperliquid_get_analytics',
  'portal_hyperliquid_get_ohlc',
])

export type UiCapabilityStatus = 'declared' | 'unsupported' | 'undeclared'

/**
 * SQD Explorer is a beta surface, so hosts never render it unless someone opts
 * in: a deployment through MCP_APP_ENABLED, or a single connection through the
 * ?app= query parameter. The resource stays registered either way, so a host
 * that wants the beta can still read it, but no tool result asks a host to open
 * it on its own.
 */
const appSurfaceStorage = new AsyncLocalStorage<boolean>()

function parseAppFlag(value: string | undefined | null): boolean | undefined {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return undefined
}

export function isActivityExplorerEnabledByDeployment(): boolean {
  return parseAppFlag(process.env.MCP_APP_ENABLED) ?? false
}

/** An explicit ?app= on the connection wins over the deployment default, in both directions. */
export function resolveActivityExplorerSurface(request: { url?: string } | undefined): boolean {
  if (!request?.url) return isActivityExplorerEnabledByDeployment()
  let requested: boolean | undefined
  try {
    requested = parseAppFlag(new URL(request.url).searchParams.get('app'))
  } catch {
    requested = undefined
  }
  return requested ?? isActivityExplorerEnabledByDeployment()
}

export function runWithActivityExplorerSurface<T>(enabled: boolean, callback: () => T): T {
  return appSurfaceStorage.run(enabled, callback)
}

export function isActivityExplorerEnabled(): boolean {
  return appSurfaceStorage.getStore() ?? isActivityExplorerEnabledByDeployment()
}

export function getActivityExplorerToolMeta(toolName: string): Record<string, unknown> | undefined {
  if (!ACTIVITY_EXPLORER_TOOLS.has(toolName)) return undefined
  if (!isActivityExplorerEnabled()) return undefined
  return {
    ui: {
      resourceUri: ACTIVITY_EXPLORER_RESOURCE_URI,
      visibility: ['model', 'app'],
    },
    'ui/resourceUri': ACTIVITY_EXPLORER_RESOURCE_URI,
    'openai/outputTemplate': ACTIVITY_EXPLORER_RESOURCE_URI,
    'openai/toolInvocation/invoking': 'Reading blockchain data',
    'openai/toolInvocation/invoked': 'Blockchain data ready',
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export function classifyUiCapability(
  envelope: Record<string, unknown> | undefined,
  fallbackCapabilities: unknown,
): UiCapabilityStatus {
  const fromEnvelope = asRecord(envelope?.[CLIENT_CAPABILITIES_META_KEY])
  const capabilities = fromEnvelope ?? asRecord(fallbackCapabilities)
  if (!capabilities) return 'undeclared'
  const extensions = asRecord(capabilities.extensions)
  const ui = asRecord(extensions?.[MCP_APP_EXTENSION_ID])
  if (!ui) return 'unsupported'
  const mimeTypes = Array.isArray(ui.mimeTypes) ? ui.mimeTypes : []
  return mimeTypes.includes(MCP_APP_MIME_TYPE) ? 'declared' : 'unsupported'
}

export function recordActivityExplorerResult(params: {
  toolName: string
  result: unknown
  transport: RuntimeRequestContext['transport']
  uiCapability: UiCapabilityStatus
  resultState: string
}) {
  if (!ACTIVITY_EXPLORER_TOOLS.has(params.toolName)) return
  const result = asRecord(params.result)
  const structured = asRecord(result?.structuredContent)
  const content = Array.isArray(result?.content) ? result.content : []
  const first = asRecord(content[0])
  const bytes =
    typeof first?.text === 'string'
      ? Buffer.byteLength(first.text)
      : structured
        ? Buffer.byteLength(JSON.stringify(structured))
        : 0
  appToolResultsTotal.inc({
    tool: params.toolName,
    transport: params.transport,
    ui_capability: params.uiCapability,
    result_state: params.resultState,
  })
  appRenderPayloadBytes.observe({ tool: params.toolName, transport: params.transport }, bytes)
}

/* Chain logos come from SQD's own CDN and site; nothing else loads. The
   generated chain map is filtered to these origins, and both CSP
   declarations name the same list.

   No dedicated origin is claimed. A host that offers one (Claude derives it
   from the connector URL) checks the value and refuses to render the app when
   it does not match, and this server has no single URL: the hosted endpoint,
   its ?app= variants, self-hosted deployments and stdio all serve the same
   resource. The app needs no origin of its own either, since it never calls
   the network. The ChatGPT alias makes the same claim and is left out for the
   same reason. */
const resourceUiMeta = {
  csp: {
    connectDomains: [] as string[],
    resourceDomains: [...LOGO_ORIGINS],
  },
}

export function registerActivityExplorerResource(server: McpServer, runtime: RuntimeRequestContext) {
  appResourceSizeBytes.set({ resource_hash: ACTIVITY_EXPLORER_HASH }, ACTIVITY_EXPLORER_BYTES)
  const resourceUris = Array.from(
    new Set([ACTIVITY_EXPLORER_RESOURCE_URI, ...RETAINED_ACTIVITY_EXPLORER_RESOURCE_URIS]),
  )

  resourceUris.forEach((resourceUri, index) => {
    server.registerResource(
      index === 0 ? 'sqd-blockchain-activity-explorer' : `sqd-blockchain-activity-explorer-compat-${index}`,
      resourceUri,
      {
        title: 'SQD Explorer',
        description:
          index === 0
            ? 'Beta. Interactive evidence views for blockchain activity, wallets, contracts, token flows, markets, and network analytics. Opt in per deployment with MCP_APP_ENABLED=true or per connection with ?app=1; ?app=0 opts a connection out.'
            : 'Retained SQD Explorer URI for installed-client compatibility.',
        mimeType: MCP_APP_MIME_TYPE,
        cacheHint: { ttlMs: 86_400_000, cacheScope: 'public' },
        _meta: { ui: resourceUiMeta },
      } as Parameters<McpServer['registerResource']>[2],
      async (uri) => {
        appResourceReadsTotal.inc({ transport: runtime.transport, server_version: npmVersion })
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: MCP_APP_MIME_TYPE,
              text: ACTIVITY_EXPLORER_HTML,
              _meta: {
                ui: resourceUiMeta,
                'openai/widgetDescription':
                  'Explore the exact blockchain evidence returned by SQD with charts, metrics, tables, timelines, coverage, freshness, and continuation controls.',
                'openai/widgetCSP': { connect_domains: [], resource_domains: [...LOGO_ORIGINS] },
              },
            },
          ],
        } as Awaited<ReturnType<Parameters<McpServer['registerResource']>[3]>>
      },
    )
  })
}
