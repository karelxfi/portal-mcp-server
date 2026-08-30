import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { ActionableError } from './errors.js'
import { inferPrimaryEvidencePath } from './format.js'

const MAX_RESPONSE_BYTES = 50_000
const RECEIPT_VERSION = 'sqd_evidence_v1'

type JsonRecord = Record<string, unknown>
type TextContent = { type: 'text'; text: string; [key: string]: unknown }

export interface EvidenceReceipt {
  version: typeof RECEIPT_VERSION
  tool: string
  source: {
    provider: 'SQD Portal'
    dataset?: string
    network?: string
    query_type: string
  }
  request: {
    arguments: JsonRecord
    arguments_sha256: string
    requested_window?: JsonRecord
    analyzed_window?: JsonRecord
  }
  result: {
    exact_data_sha256: string
    row_count: number
    primary_evidence_path?: string
    completeness: 'complete' | 'partial' | 'unknown'
    partial_reasons?: string[]
    metadata: Array<'_coverage' | '_freshness' | '_ordering' | '_pagination'>
  }
  replay: {
    arguments_path: '_evidence.request.arguments'
    mode: 'exact' | 'semantic'
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Convert JSON-like values into a deterministic representation. Undefined
 * object fields are omitted, undefined array items become null, and object
 * keys are sorted recursively.
 */
export function canonicalizeEvidenceValue(value: unknown, inArray = false): unknown {
  if (value === undefined) return inArray ? null : undefined
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map((entry) => canonicalizeEvidenceValue(entry, true))
  if (!isRecord(value)) return value

  const normalized: JsonRecord = {}
  for (const key of Object.keys(value).sort()) {
    const item = canonicalizeEvidenceValue(value[key])
    if (item !== undefined) normalized[key] = item
  }
  return normalized
}

export function stableEvidenceJson(value: unknown): string {
  return JSON.stringify(canonicalizeEvidenceValue(value))
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableEvidenceJson(value)).digest('hex')
}

const NON_EVIDENCE_KEYS = new Set([
  '_evidence',
  '_llm',
  '_ui',
  'answer',
  'display',
  'investigation',
  'next_steps',
  'pipes_handoff',
])

function exactEvidencePayload(payload: JsonRecord): JsonRecord {
  const exact: JsonRecord = {}
  for (const [key, value] of Object.entries(payload)) {
    if (NON_EVIDENCE_KEYS.has(key)) continue
    if (key === '_meta' && isRecord(value)) {
      const { response_time_ms: _responseTime, ...stableMeta } = value
      exact[key] = stableMeta
      continue
    }
    exact[key] = value
  }
  return exact
}

function queryType(toolName: string): string {
  if (toolName.includes('_evm_')) return 'evm'
  if (toolName.includes('_solana_')) return 'solana'
  if (toolName.includes('_bitcoin_')) return 'bitcoin'
  if (toolName.includes('_substrate_')) return 'substrate'
  if (toolName.includes('_hyperliquid_')) return 'hyperliquid'
  if (toolName.includes('_debug_')) return 'debug'
  if (toolName.includes('_network') || toolName === 'portal_get_head' || toolName === 'portal_list_networks') {
    return 'network_metadata'
  }
  return 'cross_chain'
}

function copyFields(source: JsonRecord, keys: string[]): JsonRecord | undefined {
  const result: JsonRecord = {}
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key]
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function requestedWindow(args: JsonRecord): JsonRecord | undefined {
  return copyFields(args, [
    'timeframe',
    'from_block',
    'to_block',
    'from_time',
    'to_time',
    'start_time',
    'end_time',
    'interval',
    'finalized_only',
    'scan_order',
  ])
}

function analyzedWindow(payload: JsonRecord): JsonRecord | undefined {
  const coverage = isRecord(payload._coverage) ? payload._coverage : {}
  const freshness = isRecord(payload._freshness) ? payload._freshness : {}
  const execution = isRecord(payload._execution) ? payload._execution : {}
  const window = {
    ...copyFields(coverage, [
      'window_from_block',
      'window_to_block',
      'analyzed_from_block',
      'analyzed_to_block',
      'page_to_block',
      'expected_buckets',
      'returned_buckets',
      'anchor',
    ]),
    ...copyFields(freshness, [
      'finality',
      'indexed_head_block',
      'window_to_block',
      'timestamp_bounds',
      'requested_timestamp',
      'resolved_block_number',
    ]),
    ...copyFields(execution, ['from_block', 'to_block', 'timestamp', 'resolution']),
  }
  return Object.keys(window).length > 0 ? window : undefined
}

function replayMode(args: JsonRecord): EvidenceReceipt['replay']['mode'] {
  if (typeof args.cursor === 'string' && args.cursor.length > 0) return 'exact'
  if (args.from_block !== undefined && args.to_block !== undefined) return 'exact'
  return 'semantic'
}

function primaryEvidence(payload: JsonRecord): { path?: string; count: number } {
  const path = inferPrimaryEvidencePath(payload, { arraysOnly: true })
  if (path) {
    const value = path
      .split('.')
      .reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), payload)
    if (Array.isArray(value)) return { path, count: value.length }
  }

  const meta = isRecord(payload._meta) ? payload._meta : undefined
  const returned = meta?.returned
  if (typeof returned === 'number' && Number.isFinite(returned)) return { count: returned }
  return { count: 0 }
}

function completeness(payload: JsonRecord): {
  completeness: EvidenceReceipt['result']['completeness']
  partialReasons?: string[]
} {
  const coverage = isRecord(payload._coverage) ? payload._coverage : undefined
  const pagination = isRecord(payload._pagination) ? payload._pagination : undefined
  const reasons: string[] = []

  if (coverage?.window_complete === false) reasons.push('requested_window_not_fully_analyzed')
  if (coverage?.result_complete === false) reasons.push('more_matching_results_exist')
  if (coverage?.sampled === true) reasons.push('sampled_window')
  if (pagination?.has_more === true && pagination.continuation_scope !== 'adjacent_window') {
    reasons.push('continuation_available')
  }

  if (reasons.length > 0) return { completeness: 'partial', partialReasons: reasons }
  if (coverage?.window_complete === true && coverage?.result_complete === true) return { completeness: 'complete' }
  if (coverage?.result_complete === true && coverage?.kind === 'not_applicable') return { completeness: 'complete' }
  return { completeness: 'unknown' }
}

export function buildEvidenceReceipt(toolName: string, toolArgs: JsonRecord, payload: JsonRecord): EvidenceReceipt {
  const normalizedArgs = canonicalizeEvidenceValue(toolArgs) as JsonRecord
  const meta = isRecord(payload._meta) ? payload._meta : {}
  const dataset = typeof normalizedArgs.dataset === 'string'
    ? normalizedArgs.dataset
    : typeof meta.dataset === 'string'
      ? meta.dataset
      : undefined
  const network = typeof normalizedArgs.network === 'string'
    ? normalizedArgs.network
    : typeof meta.network === 'string'
      ? meta.network
      : undefined
  const evidence = primaryEvidence(payload)
  const completion = completeness(payload)
  const exactPayload = exactEvidencePayload(payload)
  const requested = requestedWindow(normalizedArgs)
  const analyzed = analyzedWindow(payload)

  return {
    version: RECEIPT_VERSION,
    tool: toolName,
    source: {
      provider: 'SQD Portal',
      ...(dataset ? { dataset } : {}),
      ...(network ? { network } : {}),
      query_type: queryType(toolName),
    },
    request: {
      arguments: normalizedArgs,
      arguments_sha256: sha256(normalizedArgs),
      ...(requested ? { requested_window: requested } : {}),
      ...(analyzed ? { analyzed_window: analyzed } : {}),
    },
    result: {
      exact_data_sha256: sha256(exactPayload),
      row_count: evidence.count,
      ...(evidence.path ? { primary_evidence_path: evidence.path } : {}),
      completeness: completion.completeness,
      ...(completion.partialReasons ? { partial_reasons: completion.partialReasons } : {}),
      metadata: ['_coverage', '_freshness', '_ordering', '_pagination'],
    },
    replay: {
      arguments_path: '_evidence.request.arguments',
      mode: replayMode(normalizedArgs),
    },
  }
}

/** Add one receipt to successful results and keep the compact text fallback exact. */
export function attachEvidenceReceipt(toolName: string, toolArgs: JsonRecord, result: unknown): unknown {
  if (!isRecord(result) || result.isError === true || !isRecord(result.structuredContent)) return result

  const payload = { ...result.structuredContent }
  payload._evidence = buildEvidenceReceipt(toolName, toolArgs, payload)
  const compact = JSON.stringify(payload)
  const bytes = Buffer.byteLength(compact, 'utf8')
  if (bytes > MAX_RESPONSE_BYTES) {
    throw new ActionableError(
      `Response plus its factual evidence receipt is too large (${bytes.toLocaleString('en-US')} bytes).`,
      ['Retry with a smaller limit', 'Narrow the time or block window', 'Add a more selective address or event filter'],
      { formatted_bytes: bytes, maximum_formatted_bytes: MAX_RESPONSE_BYTES },
      { code: 'response_too_large', origin: 'client_input', retryable: true },
    )
  }

  const content = Array.isArray(result.content)
    ? result.content.map((entry, index) =>
        index === 0 && isRecord(entry) && entry.type === 'text'
          ? ({ ...(entry as TextContent), text: compact } satisfies TextContent)
          : entry,
      )
    : result.content

  return {
    ...result,
    content,
    structuredContent: payload,
  }
}
