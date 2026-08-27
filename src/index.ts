#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { createPortalServer } from './server.js'

// ============================================================================
// SQD Portal MCP Server - Node.js Entry Point
// ============================================================================

serveStdio(() => createPortalServer({ transport: 'stdio' }), {
  legacy: 'serve',
  onerror(error) {
    console.error('[mcp:stdio]', error)
  },
})

console.error('SQD Portal MCP Server running on stdio')
