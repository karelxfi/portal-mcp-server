import { CLIENT_CAPABILITIES_META_KEY, type McpServer } from '@modelcontextprotocol/server'

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

export function getActivityExplorerToolMeta(toolName: string): Record<string, unknown> | undefined {
  if (!ACTIVITY_EXPLORER_TOOLS.has(toolName)) return undefined
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

const resourceUiMeta = {
  csp: {
    connectDomains: [] as string[],
    resourceDomains: [] as string[],
  },
  domain: 'https://portal.sqd.dev',
  prefersBorder: true,
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
        title: 'SQD Blockchain Activity Explorer',
        description:
          index === 0
            ? 'Interactive evidence views for blockchain activity, wallets, contracts, token flows, markets, and network analytics.'
            : 'Retained SQD Blockchain Activity Explorer URI for installed-client compatibility.',
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
                'openai/widgetPrefersBorder': true,
                'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
                'openai/widgetDomain': 'https://portal.sqd.dev',
              },
            },
          ],
        } as Awaited<ReturnType<Parameters<McpServer['registerResource']>[3]>>
      },
    )
  })
}
