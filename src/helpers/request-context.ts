import { AsyncLocalStorage } from 'node:async_hooks'

import { RequestCancelledError, createTimeoutError } from './errors.js'

const requestSignalStorage = new AsyncLocalStorage<AbortSignal>()

export type RequestAbortContext = {
  signal: AbortSignal
  didTimeout: () => boolean
  wasCancelled: () => boolean
  cleanup: () => void
}

/**
 * Keep the MCP request cancellation signal available to shared Portal helpers
 * without threading it through every tool and cache helper signature.
 */
export function runWithPortalRequestSignal<T>(signal: AbortSignal | undefined, callback: () => T): T {
  if (!signal) return callback()
  return requestSignalStorage.run(signal, callback)
}

export function getPortalRequestSignal(): AbortSignal | undefined {
  return requestSignalStorage.getStore()
}

export function createRequestAbortContext(timeout: number): RequestAbortContext {
  const controller = new AbortController()
  const requestSignal = getPortalRequestSignal()
  let timedOut = false
  let cancelled = false

  const cancelFromRequest = () => {
    cancelled = true
    controller.abort()
  }

  if (requestSignal?.aborted) {
    cancelFromRequest()
  } else {
    requestSignal?.addEventListener('abort', cancelFromRequest, { once: true })
  }

  const timeoutId = setTimeout(() => {
    if (controller.signal.aborted) return
    timedOut = true
    controller.abort()
  }, timeout)

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    wasCancelled: () => cancelled,
    cleanup: () => {
      clearTimeout(timeoutId)
      requestSignal?.removeEventListener('abort', cancelFromRequest)
    },
  }
}

/**
 * Bound a multi-request operation with one wall-clock deadline while preserving
 * the distinction between an MCP client cancellation and an internal timeout.
 */
export async function runWithPortalRequestDeadline<T>(
  timeout: number,
  callback: () => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  const abortContext = createRequestAbortContext(timeout)

  try {
    return await runWithPortalRequestSignal(abortContext.signal, callback)
  } catch (error) {
    if (abortContext.wasCancelled()) throw new RequestCancelledError()
    if (abortContext.didTimeout() && (abortContext.signal.aborted || isAbortLike(error))) {
      throw createTimeoutError(timeout, context)
    }
    throw error
  } finally {
    abortContext.cleanup()
  }
}

export function isAbortLike(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return error.name === 'AbortError' || message.includes('abort')
}
