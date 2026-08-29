import {
  toolAdmissionActive,
  toolAdmissionActiveWeight,
  toolAdmissionQueued,
  toolAdmissionRejectedTotal,
  toolAdmissionWait,
} from '../metrics.js'
import type { RuntimeRequestContext } from '../observability.js'
import { ActionableError, RequestCancelledError } from './errors.js'

export type ToolWorkClass = 'lookup' | 'raw_query' | 'summary' | 'analytics'

export type ToolWorkProfile = {
  class: ToolWorkClass
  weight: number
}

export type ToolAdmissionSnapshot = {
  activeWeight: number
  activeCalls: number
  queuedCalls: number
  maxWeight: number
  maxQueued: number
}

type QueueEntry = {
  profile: ToolWorkProfile
  transport: RuntimeRequestContext['transport']
  enqueuedAt: number
  resolve: (value: ToolAdmissionLease) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  timeoutId: ReturnType<typeof setTimeout>
  abort: () => void
}

export type ToolAdmissionLease = {
  waitMs: number
  release: () => void
}

const PROFILES: Record<ToolWorkClass, ToolWorkProfile> = {
  lookup: { class: 'lookup', weight: 1 },
  raw_query: { class: 'raw_query', weight: 2 },
  summary: { class: 'summary', weight: 3 },
  analytics: { class: 'analytics', weight: 4 },
}

const ANALYTICS = new Set([
  'portal_evm_get_analytics',
  'portal_solana_get_analytics',
  'portal_bitcoin_get_analytics',
  'portal_substrate_get_analytics',
  'portal_hyperliquid_get_analytics',
])

const SUMMARIES = new Set([
  'portal_get_recent_activity',
  'portal_get_wallet_summary',
  'portal_get_time_series',
  'portal_evm_get_contract_activity',
  'portal_evm_get_ohlc',
  'portal_hyperliquid_get_ohlc',
])

const LOOKUPS = new Set([
  'portal_list_networks',
  'portal_get_network_info',
  'portal_get_head',
  'portal_resolve_entity',
  'portal_debug_resolve_time_to_block',
])

export function getToolWorkProfile(toolName: string): ToolWorkProfile {
  if (ANALYTICS.has(toolName)) return PROFILES.analytics
  if (SUMMARIES.has(toolName)) return PROFILES.summary
  if (LOOKUPS.has(toolName)) return PROFILES.lookup
  return PROFILES.raw_query
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
}

function overloadError(reason: 'queue_full' | 'queue_timeout', snapshot: ToolAdmissionSnapshot): ActionableError {
  const retryAfterMs = reason === 'queue_full' ? 500 : 250
  return new ActionableError(
    'SQD is busy and could not start this blockchain request inside its bounded wait budget.',
    [
      `Retry this request after ${retryAfterMs}ms`,
      'Reduce the number of simultaneous analytics or wallet requests',
      'Use a smaller timeframe for expensive analysis',
    ],
    {
      reason,
      active_weight: snapshot.activeWeight,
      queued_calls: snapshot.queuedCalls,
      max_weight: snapshot.maxWeight,
      max_queued_calls: snapshot.maxQueued,
    },
    { code: 'overloaded', origin: 'server', retryable: true, retryAfterMs },
  )
}

export class WeightedToolAdmissionController {
  private activeWeight = 0
  private activeCalls = 0
  private readonly activeByKey = new Map<string, number>()
  private readonly queuedByKey = new Map<string, number>()
  private readonly queue: QueueEntry[] = []

  constructor(
    readonly maxWeight: number,
    readonly maxQueued: number,
    readonly queueTimeoutMs: number,
    private readonly emitMetrics = true,
  ) {
    if (!Number.isInteger(maxWeight) || maxWeight < 1) throw new Error('maxWeight must be a positive integer')
    if (!Number.isInteger(maxQueued) || maxQueued < 0) throw new Error('maxQueued must be a non-negative integer')
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 1) throw new Error('queueTimeoutMs must be positive')
    this.updateMetrics()
  }

  snapshot(): ToolAdmissionSnapshot {
    return {
      activeWeight: this.activeWeight,
      activeCalls: this.activeCalls,
      queuedCalls: this.queue.length,
      maxWeight: this.maxWeight,
      maxQueued: this.maxQueued,
    }
  }

  async acquire(
    profile: ToolWorkProfile,
    transport: RuntimeRequestContext['transport'],
    signal?: AbortSignal,
  ): Promise<ToolAdmissionLease> {
    if (profile.weight > this.maxWeight) throw new Error(`Tool weight ${profile.weight} exceeds the scheduler budget`)
    if (signal?.aborted) throw new RequestCancelledError()
    const now = Date.now()
    if (this.canGrant(profile.weight) && this.queue.length === 0) return this.grant(profile, transport, now)
    if (this.queue.length >= this.maxQueued) {
      this.rejectMetric(profile, transport, 'queue_full')
      throw overloadError('queue_full', this.snapshot())
    }
    return new Promise<ToolAdmissionLease>((resolve, reject) => {
      const entry = {} as QueueEntry
      entry.profile = profile
      entry.transport = transport
      entry.enqueuedAt = now
      entry.resolve = resolve
      entry.reject = reject
      entry.signal = signal
      entry.abort = () => {
        if (!this.removeQueued(entry)) return
        reject(new RequestCancelledError())
        this.promote()
      }
      entry.timeoutId = setTimeout(() => {
        if (!this.removeQueued(entry)) return
        this.rejectMetric(profile, transport, 'queue_timeout')
        reject(overloadError('queue_timeout', this.snapshot()))
        this.promote()
      }, this.queueTimeoutMs)
      signal?.addEventListener('abort', entry.abort, { once: true })
      this.queue.push(entry)
      this.adjustMap(this.queuedByKey, this.key(profile, transport), 1)
      this.updateMetrics()
      this.promote()
    })
  }

  private canGrant(weight: number): boolean {
    return this.activeWeight + weight <= this.maxWeight
  }

  private key(profile: ToolWorkProfile, transport: RuntimeRequestContext['transport']): string {
    return `${profile.class}:${transport}`
  }

  private adjustMap(map: Map<string, number>, key: string, delta: number) {
    const next = Math.max(0, (map.get(key) ?? 0) + delta)
    if (next === 0) map.delete(key)
    else map.set(key, next)
  }

  private removeQueued(entry: QueueEntry): boolean {
    const index = this.queue.indexOf(entry)
    if (index < 0) return false
    this.queue.splice(index, 1)
    clearTimeout(entry.timeoutId)
    entry.signal?.removeEventListener('abort', entry.abort)
    this.adjustMap(this.queuedByKey, this.key(entry.profile, entry.transport), -1)
    this.updateMetrics()
    return true
  }

  private grant(
    profile: ToolWorkProfile,
    transport: RuntimeRequestContext['transport'],
    enqueuedAt: number,
  ): ToolAdmissionLease {
    const waitMs = Math.max(0, Date.now() - enqueuedAt)
    this.activeWeight += profile.weight
    this.activeCalls += 1
    this.adjustMap(this.activeByKey, this.key(profile, transport), 1)
    if (this.emitMetrics) toolAdmissionWait.observe({ tool_class: profile.class, transport }, waitMs / 1000)
    this.updateMetrics()
    let released = false
    return {
      waitMs,
      release: () => {
        if (released) return
        released = true
        this.activeWeight = Math.max(0, this.activeWeight - profile.weight)
        this.activeCalls = Math.max(0, this.activeCalls - 1)
        this.adjustMap(this.activeByKey, this.key(profile, transport), -1)
        this.promote()
      },
    }
  }

  private promote() {
    let promoted = true
    while (promoted && this.queue.length > 0) {
      promoted = false
      const index = this.queue.findIndex((entry) => this.canGrant(entry.profile.weight))
      if (index < 0) break
      const entry = this.queue.splice(index, 1)[0]!
      clearTimeout(entry.timeoutId)
      entry.signal?.removeEventListener('abort', entry.abort)
      this.adjustMap(this.queuedByKey, this.key(entry.profile, entry.transport), -1)
      if (entry.signal?.aborted) {
        entry.reject(new RequestCancelledError())
        promoted = true
        continue
      }
      entry.resolve(this.grant(entry.profile, entry.transport, entry.enqueuedAt))
      promoted = true
    }
    this.updateMetrics()
  }

  private rejectMetric(profile: ToolWorkProfile, transport: RuntimeRequestContext['transport'], reason: string) {
    if (this.emitMetrics) toolAdmissionRejectedTotal.inc({ tool_class: profile.class, transport, reason })
  }

  private updateMetrics() {
    if (!this.emitMetrics) return
    toolAdmissionActiveWeight.set(this.activeWeight)
    for (const profile of Object.values(PROFILES)) {
      for (const transport of ['stdio', 'http'] as const) {
        const key = this.key(profile, transport)
        toolAdmissionActive.set({ tool_class: profile.class, transport }, this.activeByKey.get(key) ?? 0)
        toolAdmissionQueued.set({ tool_class: profile.class, transport }, this.queuedByKey.get(key) ?? 0)
      }
    }
  }
}

export const toolAdmission = new WeightedToolAdmissionController(
  boundedInteger(process.env.MCP_TOOL_WEIGHT_BUDGET, 24, 4, 256),
  boundedInteger(process.env.MCP_TOOL_MAX_QUEUE, 64, 0, 1024),
  boundedInteger(process.env.MCP_TOOL_QUEUE_TIMEOUT_MS, 2_500, 50, 30_000),
)
