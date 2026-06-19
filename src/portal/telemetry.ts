import { AsyncLocalStorage } from 'node:async_hooks'

import type { PortalEndpointAuthMode, PortalEndpointClass } from './endpoints.js'

const MAX_STATUS_CODES = 8
const activePortalTelemetry = new AsyncLocalStorage<PortalRequestTelemetry>()

export interface PortalRequestObservation {
  method: string
  statusCode: number
  endpointId: string
  endpointClass: PortalEndpointClass
  authMode: PortalEndpointAuthMode
}

export interface PortalRequestTelemetrySnapshot {
  request_count: number
  status_codes: string[]
  status_classes: string[]
  last_status_code?: string
}

interface PortalRequestTelemetry {
  record(observation: PortalRequestObservation): void
  snapshot(): PortalRequestTelemetrySnapshot
}

export function createPortalRequestTelemetry(): PortalRequestTelemetry {
  let requestCount = 0
  let lastStatusCode: string | undefined
  const statusCodes = new Set<string>()
  const statusClasses = new Set<string>()

  return {
    record(observation: PortalRequestObservation) {
      requestCount++
      const statusCode = String(observation.statusCode)
      lastStatusCode = statusCode
      if (statusCodes.size < MAX_STATUS_CODES || statusCodes.has(statusCode)) {
        statusCodes.add(statusCode)
      }
      statusClasses.add(`${Math.floor(observation.statusCode / 100)}xx`)
    },
    snapshot() {
      return {
        request_count: requestCount,
        status_codes: Array.from(statusCodes).sort(),
        status_classes: Array.from(statusClasses).sort(),
        ...(lastStatusCode ? { last_status_code: lastStatusCode } : {}),
      }
    },
  }
}

export function runWithPortalRequestTelemetry<T>(telemetry: PortalRequestTelemetry, callback: () => Promise<T>): Promise<T> {
  return activePortalTelemetry.run(telemetry, callback)
}

export function recordPortalRequestObservation(observation: PortalRequestObservation): void {
  activePortalTelemetry.getStore()?.record(observation)
}
