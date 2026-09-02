// ============================================================================
// Readiness: has the dataset catalog loaded, and is Portal still reachable?
// ============================================================================
//
// `/health` answers "is the process up" and stays 200 from the first tick.
// `/ready` answers "can this instance serve a tool call now": the catalog must
// have loaded at least once and the most recent Portal probe must have
// succeeded within `MCP_READY_MAX_AGE_MS`.

import { getDatasets } from './cache/datasets.js'
import { PORTAL_URL } from './constants/index.js'
import { portalFetch } from './helpers/fetch.js'

export type ReadinessReason = 'catalog_not_loaded' | 'portal_probe_failed' | 'portal_probe_stale'

export interface ReadinessSnapshot {
  ready: boolean
  reason?: ReadinessReason
  catalog_loaded_at?: string
  catalog_datasets?: number
  last_probe_ok_at?: string
  last_probe_error?: string
  probe_interval_ms: number
  max_age_ms: number
}

export interface ReadinessOptions {
  probeIntervalMs: number
  maxAgeMs: number
  probeTimeoutMs?: number
  now?: () => number
  loadCatalog?: () => Promise<{ length: number }>
  probe?: () => Promise<void>
}

export interface ReadinessTracker {
  snapshot(): ReadinessSnapshot
  /** Run one catalog load or probe now. Never throws. */
  tick(): Promise<void>
  start(): void
  stop(): void
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 197)}...` : message
}

export function createReadinessTracker(options: ReadinessOptions): ReadinessTracker {
  const now = options.now ?? Date.now
  const probeTimeoutMs = options.probeTimeoutMs ?? 5_000
  const loadCatalog = options.loadCatalog ?? getDatasets
  const probe =
    options.probe ??
    (async () => {
      await portalFetch<unknown>(`${PORTAL_URL}/datasets`, { timeout: probeTimeoutMs, retries: 0 })
    })

  let catalogLoadedAt: number | undefined
  let catalogDatasets: number | undefined
  let lastProbeOkAt: number | undefined
  let lastProbeError: string | undefined
  let timer: NodeJS.Timeout | undefined
  let inFlight: Promise<void> | undefined

  async function runTick() {
    if (catalogLoadedAt === undefined) {
      try {
        const datasets = await loadCatalog()
        catalogLoadedAt = now()
        catalogDatasets = datasets.length
        lastProbeOkAt = catalogLoadedAt
        lastProbeError = undefined
        return
      } catch (error) {
        lastProbeError = describeError(error)
        return
      }
    }
    try {
      await probe()
      lastProbeOkAt = now()
      lastProbeError = undefined
    } catch (error) {
      lastProbeError = describeError(error)
    }
  }

  return {
    snapshot() {
      const base = {
        probe_interval_ms: options.probeIntervalMs,
        max_age_ms: options.maxAgeMs,
        ...(catalogLoadedAt !== undefined ? { catalog_loaded_at: new Date(catalogLoadedAt).toISOString() } : {}),
        ...(catalogDatasets !== undefined ? { catalog_datasets: catalogDatasets } : {}),
        ...(lastProbeOkAt !== undefined ? { last_probe_ok_at: new Date(lastProbeOkAt).toISOString() } : {}),
        ...(lastProbeError !== undefined ? { last_probe_error: lastProbeError } : {}),
      }
      if (catalogLoadedAt === undefined) return { ready: false, reason: 'catalog_not_loaded', ...base }
      if (lastProbeOkAt === undefined) return { ready: false, reason: 'portal_probe_failed', ...base }
      if (now() - lastProbeOkAt > options.maxAgeMs) {
        return { ready: false, reason: lastProbeError ? 'portal_probe_failed' : 'portal_probe_stale', ...base }
      }
      return { ready: true, ...base }
    },
    tick() {
      if (!inFlight) {
        inFlight = runTick().finally(() => {
          inFlight = undefined
        })
      }
      return inFlight
    },
    start() {
      if (timer) return
      void this.tick()
      timer = setInterval(() => void this.tick(), options.probeIntervalMs)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
  }
}
