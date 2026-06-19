export const EXECUTION_GUIDANCE_VERSION = 'portal_execution_guidance_v1'
export const PORTAL_PLUGIN_SELECTOR = 'portal@sqd'
export const PORTAL_MCP_SERVER_LABEL = 'SQD'

export type SqdExecutionSurface = 'portal_mcp' | 'portal_stream_api' | 'pipes_squid'

type ExecutionGuidanceInput = {
  toolName?: string
  responseFormat?: string
  hasPagination?: boolean
  resultComplete?: boolean
  windowComplete?: boolean
  hasPipesHandoff?: boolean
}

export function getExecutionGuidance() {
  return {
    version: EXECUTION_GUIDANCE_VERSION,
    default_order: ['portal_mcp', 'portal_stream_api', 'pipes_squid'] satisfies SqdExecutionSurface[],
    surfaces: {
      portal_mcp: {
        label: 'Portal MCP',
        best_for: [
          'bounded interactive answers',
          'network, tool, and entity discovery',
          'wallet or contract summaries',
          'charts and compact analytics',
          'investigation pivots before raw drill-down',
        ],
        avoid_when: [
          'the user explicitly needs raw rows or a file export',
          'chat payload limits would hide important evidence',
          'the workflow needs recurring sync or app-owned state',
        ],
      },
      portal_stream_api: {
        label: 'Portal Stream API / curl',
        best_for: [
          'raw NDJSON rows',
          'CSV or file exports',
          'exact reproducible requests',
          'large result sets after MCP proves the query shape',
        ],
        discovery_first: [
          'Use portal_list_networks or sqd://datasets for network names.',
          'Use portal_resolve_entity before turning symbols, pools, protocols, or coins into filters.',
          'Use portal_get_head or timestamp-to-block resolution before constructing recent windows.',
        ],
      },
      pipes_squid: {
        label: 'Pipes SDK data pipelines',
        best_for: [
          'recurring syncs',
          'long backfills',
          'protocol-specific joins',
          'durable database tables',
          'transforms, alerts, dashboards, or production APIs',
        ],
        handoff: 'Use bundled SQD skills, especially Portal and Pipes SDK, to preserve the MCP/curl query as the validation baseline for the durable data pipeline.',
      },
    },
    decision_rules: [
      {
        choose: 'portal_mcp',
        when: 'The user wants an answer, summary, chart, discovery result, or bounded investigation in chat.',
      },
      {
        choose: 'portal_stream_api',
        when: 'The user asks for raw rows, last N records, NDJSON/CSV/files, curl, exact request bodies, or full export after MCP output is capped.',
      },
      {
        choose: 'pipes_squid',
        when: 'The user needs a durable data pipeline for sync, backfill, joins, storage, scheduled dashboards, alerts, or app-owned state.',
      },
    ],
    plugin: {
      selector: PORTAL_PLUGIN_SELECTOR,
      mcp_server_label: PORTAL_MCP_SERVER_LABEL,
      bundled_skills: ['portal', 'pipes'],
    },
  }
}

export function buildResponseExecutionGuidance(input: ExecutionGuidanceInput) {
  const recommendations: SqdExecutionSurface[] = ['portal_mcp']
  const reasons: string[] = ['This response was produced by a bounded Portal MCP tool call.']

  if (input.responseFormat === 'full' || input.hasPagination || input.resultComplete === false || input.windowComplete === false) {
    recommendations.push('portal_stream_api')
    reasons.push('Use Portal Stream API/curl when the user needs raw rows, a complete export, or a reproducible request outside chat.')
  }

  if (input.hasPipesHandoff) {
    recommendations.push('pipes_squid')
    reasons.push('A Pipes SDK handoff is available because this query can become a durable data pipeline, recurring dashboard, or app-owned dataset.')
  }

  return {
    version: EXECUTION_GUIDANCE_VERSION,
    current_surface: 'portal_mcp' as SqdExecutionSurface,
    tool: input.toolName,
    recommended_surfaces: [...new Set(recommendations)],
    reasons,
    switch_to_portal_api_when: [
      'raw rows or exact last-N records are requested',
      'the answer needs NDJSON, CSV, a file, or a reproducible curl command',
      'MCP metadata says the result is paginated, capped, sampled, or partial and the user needs the full payload',
    ],
    recommend_pipes_when: [
      'the user asks for recurring sync, long backfill, joins, transforms, dashboards, alerts, production APIs, or a durable data pipeline',
      'the query should become app-owned state rather than an ad hoc answer',
    ],
    bundled_skills: ['portal', 'pipes'],
  }
}
