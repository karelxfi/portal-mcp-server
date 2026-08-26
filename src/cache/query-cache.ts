import { ManagedCache, estimateSize } from '../helpers/cache-manager.js'
import { RequestCancelledError } from '../helpers/errors.js'
import { getPortalRequestSignal } from '../helpers/request-context.js'

export interface QueryCacheOptions {
  ttl: number
  maxEntries?: number
  maxSize?: number
  cleanupInterval?: number
}

export type QueryCacheResultSource = 'cache' | 'pending' | 'fresh'

export type QueryCacheResult<T> = {
  value: T
  source: QueryCacheResultSource
  cachedAt: number
}

type CachedValue<T> = {
  value: T
  cachedAt: number
}

export class QueryCache<T> {
  private readonly cache: ManagedCache<CachedValue<T>>
  private readonly pending = new Map<string, { promise: Promise<CachedValue<T>>; requestSignal?: AbortSignal }>()

  constructor(options: QueryCacheOptions) {
    this.cache = new ManagedCache<CachedValue<T>>(options)
  }

  async getOrLoad(key: string, loader: () => Promise<T>): Promise<QueryCacheResult<T>> {
    const requestSignal = getPortalRequestSignal()
    if (requestSignal?.aborted) throw new RequestCancelledError()

    const cached = this.cache.get(key)
    if (cached) {
      return {
        value: cached.value,
        source: 'cache',
        cachedAt: cached.cachedAt,
      }
    }

    const existingPending = this.pending.get(key)
    if (existingPending && existingPending.requestSignal === requestSignal) {
      const shared = await existingPending.promise
      return {
        value: shared.value,
        source: 'pending',
        cachedAt: shared.cachedAt,
      }
    }

    const loadFresh = async () => {
      const value = await loader()
      const cachedValue: CachedValue<T> = {
        value,
        cachedAt: Date.now(),
      }
      this.cache.set(key, cachedValue, estimateSize(cachedValue))
      return cachedValue
    }

    // A pending load tied to another MCP request must not be shared: cancelling
    // its request would otherwise fail unrelated callers waiting on the cache.
    if (existingPending) {
      const fresh = await loadFresh()
      return {
        value: fresh.value,
        source: 'fresh',
        cachedAt: fresh.cachedAt,
      }
    }

    const pendingLoad = loadFresh()

    this.pending.set(key, { promise: pendingLoad, requestSignal })

    try {
      const fresh = await pendingLoad
      return {
        value: fresh.value,
        source: 'fresh',
        cachedAt: fresh.cachedAt,
      }
    } finally {
      if (this.pending.get(key)?.promise === pendingLoad) {
        this.pending.delete(key)
      }
    }
  }
}

export function createQueryCache<T>(options: QueryCacheOptions): QueryCache<T> {
  return new QueryCache<T>(options)
}

export function stableCacheKey(prefix: string, value: unknown): string {
  return `${prefix}:${JSON.stringify(normalizeForCacheKey(value))}`
}

function normalizeForCacheKey(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForCacheKey(entry))
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entryValue]) => [entryKey, normalizeForCacheKey(entryValue)]),
    )
  }

  return value
}
