#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { SerializedStdioServerTransport } from './helpers/serialized-stdio-transport.js'
import { createPortalServer } from './server.js'
import { startTracing, stopTracing, tracingStatus } from './tracing.js'
import { npmVersion } from './version.js'

// ============================================================================
// SQD Portal MCP Server - Node.js Entry Point
// ============================================================================

/* Nothing is imported, allocated, or sent unless OTEL_EXPORTER_OTLP_ENDPOINT
   is set; see src/tracing.ts. */
await startTracing({ serviceName: 'sqd-portal-mcp-server', serviceVersion: npmVersion })

if (tracingStatus().active) {
  /* Spans are batched, so without a flush the last few seconds of a session
     are lost exactly when they are most interesting. The handler is removed by
     `once` before the signal is re-raised, so the process still dies of the
     signal it was sent and keeps its exit code. */
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stopTracing().finally(() => process.kill(process.pid, signal))
    })
  }
}

serveStdio(() => createPortalServer({ transport: 'stdio' }), {
  legacy: 'serve',
  transport: new SerializedStdioServerTransport(),
  onerror(error) {
    console.error('[mcp:stdio]', error)
  },
})

console.error('SQD Portal MCP Server running on stdio')
