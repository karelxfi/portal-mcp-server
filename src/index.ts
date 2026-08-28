#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { SerializedStdioServerTransport } from './helpers/serialized-stdio-transport.js'
import { createPortalServer } from './server.js'

// ============================================================================
// SQD Portal MCP Server - Node.js Entry Point
// ============================================================================

serveStdio(() => createPortalServer({ transport: 'stdio' }), {
  legacy: 'serve',
  transport: new SerializedStdioServerTransport(),
  onerror(error) {
    console.error('[mcp:stdio]', error)
  },
})

console.error('SQD Portal MCP Server running on stdio')
