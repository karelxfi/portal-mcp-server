import {
  portalAdmissionRejectedTotal,
  portalAdmissionWait,
  portalUpstreamActive,
  portalUpstreamQueued,
} from '../metrics.js'
import { ActionableError, RequestCancelledError } from './errors.js'

export type AdmissionSnapshot = {
  active: number
  queued: number
  maxActive: number
  maxQueued: number
}

type QueueEntry = {
  enqueuedAt: number
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  timeoutId: ReturnType<typeof setTimeout>
  abort: () => void
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
}

function overloadError(reason: 'queue_full' | 'queue_timeout', snapshot: AdmissionSnapshot): ActionableError {
  const retryAfterMs = reason === 'queue_full' ? 500 : 250
  return new ActionableError(
    'The SQD server is busy and could not start this blockchain query within its bounded admission budget.',
    [
      `Retry this same request after ${retryAfterMs}ms`,
      'Reduce concurrent requests when several analytics or wallet queries are running',
      'Use a smaller timeframe or block range for expensive queries',
    ],
    {
      reason,
      active_requests: snapshot.active,
      queued_requests: snapshot.queued,
      max_active_requests: snapshot.maxActive,
      max_queued_requests: snapshot.maxQueued,
    },
    {
      code: 'overloaded',
      origin: 'server',
      retryable: true,
      retryAfterMs,
    },
  )
}

export class AdmissionController {
  private active = 0
  private readonly queue: QueueEntry[] = []

  constructor(
    readonly maxActive: number,
    readonly maxQueued: number,
    readonly queueTimeoutMs: number,
  ) {
    if (!Number.isInteger(maxActive) || maxActive < 1) throw new Error('maxActive must be a positive integer')
    if (!Number.isInteger(maxQueued) || maxQueued < 0) throw new Error('maxQueued must be a non-negative integer')
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 1) throw new Error('queueTimeoutMs must be positive')
    this.updateGauges()
  }

  snapshot(): AdmissionSnapshot {
    return {
      active: this.active,
      queued: this.queue.length,
      maxActive: this.maxActive,
      maxQueued: this.maxQueued,
    }
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new RequestCancelledError()

    if (this.active < this.maxActive) {
      return this.grant(Date.now())
    }

    if (this.queue.length >= this.maxQueued) {
      portalAdmissionRejectedTotal.inc({ reason: 'queue_full' })
      throw overloadError('queue_full', this.snapshot())
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry = {} as QueueEntry
      entry.enqueuedAt = Date.now()
      entry.resolve = resolve
      entry.reject = reject
      entry.signal = signal
      entry.abort = () => {
        if (!this.removeQueued(entry)) return
        reject(new RequestCancelledError())
      }
      entry.timeoutId = setTimeout(() => {
        if (!this.removeQueued(entry)) return
        portalAdmissionRejectedTotal.inc({ reason: 'queue_timeout' })
        reject(overloadError('queue_timeout', this.snapshot()))
      }, this.queueTimeoutMs)

      signal?.addEventListener('abort', entry.abort, { once: true })
      this.queue.push(entry)
      this.updateGauges()
    })
  }

  private removeQueued(entry: QueueEntry): boolean {
    const index = this.queue.indexOf(entry)
    if (index === -1) return false
    this.queue.splice(index, 1)
    clearTimeout(entry.timeoutId)
    entry.signal?.removeEventListener('abort', entry.abort)
    this.updateGauges()
    return true
  }

  private grant(enqueuedAt: number): () => void {
    this.active += 1
    portalAdmissionWait.observe(Math.max(0, Date.now() - enqueuedAt) / 1000)
    this.updateGauges()
    let released = false

    return () => {
      if (released) return
      released = true
      this.active = Math.max(0, this.active - 1)
      this.promote()
    }
  }

  private promote(): void {
    while (this.active < this.maxActive && this.queue.length > 0) {
      const entry = this.queue.shift()!
      clearTimeout(entry.timeoutId)
      entry.signal?.removeEventListener('abort', entry.abort)
      if (entry.signal?.aborted) {
        entry.reject(new RequestCancelledError())
        continue
      }
      entry.resolve(this.grant(entry.enqueuedAt))
    }
    this.updateGauges()
  }

  private updateGauges(): void {
    portalUpstreamActive.set(this.active)
    portalUpstreamQueued.set(this.queue.length)
  }
}

export const portalAdmission = new AdmissionController(
  boundedInteger(process.env.PORTAL_MAX_CONCURRENCY, 32, 1, 256),
  boundedInteger(process.env.PORTAL_MAX_QUEUE, 64, 0, 1024),
  boundedInteger(process.env.PORTAL_QUEUE_TIMEOUT_MS, 2_000, 50, 30_000),
)
