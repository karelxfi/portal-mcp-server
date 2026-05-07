import { createServer, type IncomingMessage } from 'node:http'
import { randomUUID } from 'node:crypto'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

import { clientRequestsTotal } from './metrics.js'
import { getObservabilityStatus } from './observability.js'
import { register } from './metrics.js'
import { createPortalServer } from './server.js'
import { npmVersion } from './version.js'

// ----------------------------------------------------------------------------
// Tool catalog cache
//
// `GET /tools` exposes the same data the MCP `tools/list` JSON-RPC method
// returns, but as a plain HTTP endpoint a browser or curl can hit. Useful
// for changelog links and quick discoverability without an MCP client.
//
// The catalog is built once on first request and cached for the process
// lifetime — registration is deterministic, so there's no point rebuilding.
// ----------------------------------------------------------------------------

type ToolCatalogEntry = {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
}

let catalogCache: { entries: ToolCatalogEntry[]; generatedAt: string } | null = null

function buildToolCatalog(): { entries: ToolCatalogEntry[]; generatedAt: string } {
  if (catalogCache) return catalogCache

  // Spin up a throwaway server purely to walk its registered-tool table.
  // No transport is connected, so nothing actually runs.
  const probe = createPortalServer({ transport: 'http' })
  // biome-ignore lint: SDK exposes _registeredTools as the same source tools/list reads from
  const registry = (probe as unknown as { _registeredTools: Record<string, any> })._registeredTools ?? {}

  const entries: ToolCatalogEntry[] = Object.entries(registry)
    .filter(([, tool]) => tool?.enabled !== false)
    .map(([name, tool]) => {
      const entry: ToolCatalogEntry = { name }
      if (typeof tool.title === 'string') entry.title = tool.title
      if (typeof tool.description === 'string') entry.description = tool.description
      if (tool.inputSchema) {
        try {
          // tool.inputSchema is either a zod object or a plain props record
          // depending on which registration overload the tool used. Wrap
          // plain records in z.object() so zod-to-json-schema accepts them.
          const schema =
            tool.inputSchema instanceof z.ZodType
              ? tool.inputSchema
              : z.object(tool.inputSchema as Record<string, z.ZodTypeAny>)
          entry.inputSchema = zodToJsonSchema(schema, { target: 'jsonSchema7' })
        } catch {
          /* schema unrepresentable; skip */
        }
      }
      return entry
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  catalogCache = { entries, generatedAt: new Date().toISOString() }
  // The probe server is unreferenced after this; let it be GC'd.
  return catalogCache
}

// ============================================================================
// SQD Portal MCP Server - Node.js HTTP Entry Point
// ============================================================================

const PORT = Number(process.env.PORT) || 3000

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  if (typeof value === 'string') return value
  return Array.isArray(value) ? value[0] : undefined
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const requestId = readHeader(req, 'x-request-id') || randomUUID()
  res.setHeader('x-request-id', requestId)

  const userAgent = readHeader(req, 'user-agent')
  const clientName =
    readHeader(req, 'x-mcp-client-name')
    || readHeader(req, 'x-client-name')
    || 'unknown'
  const clientVersion =
    readHeader(req, 'x-mcp-client-version')
    || readHeader(req, 'x-client-version')
    || 'unknown'

  // Health check endpoint
  // NOTE: Do not expose PORTAL_URL here — it may contain a sensitive token
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'ok',
        version: npmVersion,
        observability: getObservabilityStatus(),
      }),
    )
    return
  }

  // Prometheus metrics endpoint
  if (url.pathname === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType })
    res.end(await register.metrics())
    return
  }

  // Public tool catalog — same data as MCP `tools/list`, served as plain
  // JSON so a browser, curl, or docs page can introspect the available
  // tools without an MCP client. Read-only, no auth, GET only.
  if (url.pathname === '/tools' || url.pathname === '/tools.json') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    const catalog = buildToolCatalog()
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(
      JSON.stringify(
        {
          server: 'sqd-portal-mcp-server',
          version: npmVersion,
          generated_at: catalog.generatedAt,
          tool_count: catalog.entries.length,
          tools: catalog.entries,
        },
        null,
        2,
      ),
    )
    return
  }

  // MCP endpoint. Keep /mcp as an alias because remote MCP clients and
  // quick-tunnel prompts commonly use that path.
  if (url.pathname === '/' || url.pathname === '/mcp') {
    if (req.method === 'POST') {
      try {
        clientRequestsTotal.inc({
          transport: 'http',
          client_name: clientName,
          client_version: clientVersion,
        })

        const mcpServer = createPortalServer({
          transport: 'http',
          requestId,
          clientName,
          clientVersion,
          sessionId: readHeader(req, 'x-mcp-session-id') || readHeader(req, 'x-session-id'),
          userQuery: readHeader(req, 'x-mcp-user-query'),
          userAgent,
          forwardedFor: readHeader(req, 'x-forwarded-for'),
        })
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        })

        await mcpServer.connect(transport)
        await transport.handleRequest(req, res)

        res.on('close', () => {
          transport.close()
          mcpServer.close()
        })
      } catch (error) {
        console.error('MCP error:', error)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: error instanceof Error ? error.message : 'Internal server error',
              },
              id: null,
            }),
          )
        }
      }
      return
    }

    // GET and DELETE aren't supported in stateless mode
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      }),
    )
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`SQD Portal MCP Server listening on http://localhost:${PORT}`)
})

process.on('SIGINT', () => {
  console.log('Shutting down...')
  server.close()
  process.exit(0)
})
