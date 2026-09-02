import { randomUUID, timingSafeEqual } from 'node:crypto'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'

import { toNodeHandler } from '@modelcontextprotocol/node'
import { type McpRequestContext, createMcpHandler } from '@modelcontextprotocol/server'

import { resolveActivityExplorerSurface } from './apps/activity-explorer.js'
import { register } from './metrics.js'
import { type RuntimeRequestContext, getObservabilityStatus } from './observability.js'
import { createPortalServer } from './server.js'
import { gitCommit, npmVersion } from './version.js'

// ============================================================================
// SQD Portal MCP Server - Node.js HTTP Entry Point
// ============================================================================

const PORT = Number(process.env.PORT) || 3000
const METRICS_PUBLIC = process.env.METRICS_PUBLIC === 'true'
const METRICS_BEARER_TOKEN = process.env.METRICS_BEARER_TOKEN

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  if (typeof value === 'string') return value
  return Array.isArray(value) ? value[0] : undefined
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function readBearerToken(req: IncomingMessage): string | undefined {
  const authorization = readHeader(req, 'authorization')
  if (!authorization) return undefined
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]
}

function isMetricsAuthorized(req: IncomingMessage): boolean {
  if (METRICS_PUBLIC) return true
  if (!METRICS_BEARER_TOKEN) return false
  const token = readBearerToken(req)
  return Boolean(token && safeEqual(token, METRICS_BEARER_TOKEN))
}

function runtimeContextFromRequest(ctx: McpRequestContext): RuntimeRequestContext {
  const headers = ctx.requestInfo?.headers

  return {
    transport: 'http',
    requestId: headers?.get('x-request-id') || undefined,
    protocolVersion: ctx.era === 'modern' ? '2026-07-28' : undefined,
    appEnabled: resolveActivityExplorerSurface(ctx.requestInfo),
  }
}

const mcpHandler = createMcpHandler((ctx) => createPortalServer(runtimeContextFromRequest(ctx)), {
  legacy: 'stateless',
  responseMode: 'auto',
  onerror(error) {
    console.error('[mcp:http]', error)
  },
})

const handleMcpRequest = toNodeHandler(mcpHandler, {
  onerror(error) {
    console.error('[mcp:http-adapter]', error)
  },
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const requestId = readHeader(req, 'x-request-id') || randomUUID()
  req.headers['x-request-id'] = requestId
  res.setHeader('x-request-id', requestId)

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(
      JSON.stringify({ status: 'ok', version: npmVersion, commit: gitCommit, observability: getObservabilityStatus() }),
    )
    return
  }

  if (url.pathname === '/metrics') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    if (!isMetricsAuthorized(req)) {
      const isTokenConfigured = Boolean(METRICS_BEARER_TOKEN)
      res.writeHead(isTokenConfigured ? 401 : 404, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(isTokenConfigured ? { 'WWW-Authenticate': 'Bearer realm="metrics"' } : {}),
      })
      res.end(JSON.stringify({ error: isTokenConfigured ? 'Unauthorized' : 'Not found' }))
      return
    }

    res.writeHead(200, { 'Content-Type': register.contentType, 'Cache-Control': 'no-store' })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(await register.metrics())
    return
  }

  if (url.pathname === '/' || url.pathname === '/mcp') {
    await handleMcpRequest(req, res)
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`SQD Portal MCP Server listening on http://localhost:${PORT}`)
})

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('Shutting down...')
  await mcpHandler.close()
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
