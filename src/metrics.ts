import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client'

import { npmVersion } from './version.js'

// ============================================================================
// Prometheus Metrics
// ============================================================================

export const register = new Registry()

collectDefaultMetrics({ register })

export const serverInfo = new Gauge({
  name: 'mcp_server_info',
  help: 'Static server info for the running MCP instance',
  labelNames: ['server_version', 'service_name', 'runtime'] as const,
  registers: [register],
})

serverInfo.set(
  {
    server_version: npmVersion,
    service_name: 'sqd-portal-mcp',
    runtime: 'node',
  },
  1,
)

// --- MCP Tool Metrics ---

export const toolCallsTotal = new Counter({
  name: 'mcp_tool_calls_total',
  help: 'Total MCP tool invocations, with exactly one terminal outcome per invocation',
  labelNames: ['tool', 'status', 'transport', 'server_version'] as const,
  registers: [register],
})

export const toolOutcomesTotal = new Counter({
  name: 'mcp_tool_outcomes_total',
  help: 'Canonical MCP tool outcomes by terminal status, result state, and bounded failure attribution',
  labelNames: [
    'tool',
    'status',
    'result_state',
    'error_origin',
    'error_code',
    'transport',
    'server_version',
  ] as const,
  registers: [register],
})

export const toolCallDuration = new Histogram({
  name: 'mcp_tool_call_duration_seconds',
  help: 'Duration of MCP tool invocations in seconds',
  labelNames: ['tool', 'transport'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
})

export const toolCallsActive = new Gauge({
  name: 'mcp_tool_calls_active',
  help: 'Number of currently in-flight MCP tool calls',
  labelNames: ['tool', 'transport'] as const,
  registers: [register],
})

export const toolErrorsTotal = new Counter({
  name: 'mcp_tool_errors_total',
  help: 'Total number of MCP tool errors by type',
  labelNames: ['tool', 'transport', 'error_type'] as const,
  registers: [register],
})

export const toolResponseSizeBytes = new Histogram({
  name: 'mcp_tool_response_size_bytes',
  help: 'Serialized MCP response size in bytes',
  labelNames: ['tool', 'transport'] as const,
  buckets: [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072],
  registers: [register],
})

export const toolIntentCallsTotal = new Counter({
  name: 'mcp_tool_intent_calls_total',
  help: 'Total number of MCP tool invocations by intent and VM family',
  labelNames: ['tool', 'intent', 'vm'] as const,
  registers: [register],
})

// --- Portal API Metrics ---

export const portalRequestsTotal = new Counter({
  name: 'mcp_portal_api_requests_total',
  help: 'Total number of requests to the Portal API',
  labelNames: ['method', 'status_code'] as const,
  registers: [register],
})

export const portalUpstreamActive = new Gauge({
  name: 'mcp_portal_upstream_active',
  help: 'Current Portal API requests admitted for execution',
  registers: [register],
})

export const portalUpstreamQueued = new Gauge({
  name: 'mcp_portal_upstream_queued',
  help: 'Current Portal API requests waiting for admission',
  registers: [register],
})

export const portalAdmissionRejectedTotal = new Counter({
  name: 'mcp_portal_admission_rejected_total',
  help: 'Portal API requests rejected before execution by bounded admission control',
  labelNames: ['reason'] as const,
  registers: [register],
})

export const portalAdmissionWait = new Histogram({
  name: 'mcp_portal_admission_wait_seconds',
  help: 'Time Portal API requests wait for an execution slot',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 3],
  registers: [register],
})

export const tokenListRequestsTotal = new Counter({
  name: 'mcp_token_list_requests_total',
  help: 'Total number of external token-list fetch attempts by source, chain, and outcome',
  labelNames: ['source', 'chain', 'status'] as const,
  registers: [register],
})

export const tokenListCacheEventsTotal = new Counter({
  name: 'mcp_token_list_cache_events_total',
  help: 'Total number of token-list cache events by source and chain',
  labelNames: ['source', 'chain', 'event'] as const,
  registers: [register],
})

export const tokenListUnsupportedNetworksTotal = new Counter({
  name: 'mcp_token_list_unsupported_networks_total',
  help: 'Total number of token-list resolution attempts for unsupported datasets',
  labelNames: ['dataset'] as const,
  registers: [register],
})

// --- Dataset Metrics ---

export const datasetQueriesTotal = new Counter({
  name: 'mcp_dataset_queries_total',
  help: 'Total number of queries per dataset',
  labelNames: ['dataset', 'vm'] as const,
  registers: [register],
})

export const toolClientCallsTotal = new Counter({
  name: 'mcp_tool_client_calls_total',
  help: 'Total tool calls by bounded MCP client family and major version',
  labelNames: ['transport', 'client_family', 'client_major'] as const,
  registers: [register],
})

export const observabilityExportsTotal = new Counter({
  name: 'mcp_observability_exports_total',
  help: 'Total number of observability export attempts',
  labelNames: ['sink', 'status'] as const,
  registers: [register],
})
