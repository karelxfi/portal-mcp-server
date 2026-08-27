#!/usr/bin/env tsx

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function main() {
  console.log('Starting MCP 2026 protocol QA...\n')

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: process.cwd(),
    stderr: 'pipe',
  })
  const client = new Client(
    { name: 'mcp-2026-stdio-smoke', version: '0.8.0' },
    { versionNegotiation: { mode: 'auto', probe: { timeoutMs: 5_000 } } },
  )

  await client.connect(transport)
  try {
    assert(client.getProtocolEra() === 'modern', `expected modern era, got ${client.getProtocolEra()}`)
    assert(
      client.getNegotiatedProtocolVersion() === '2026-07-28',
      `expected protocol 2026-07-28, got ${client.getNegotiatedProtocolVersion()}`,
    )
    assert(client.getServerVersion()?.version === '0.8.0', 'expected server version 0.8.0')
    assert(
      client.getDiscoverResult()?.supportedVersions?.includes('2026-07-28') === true,
      'server/discover should advertise 2026-07-28',
    )

    const { tools } = await client.listTools()
    assert(tools.length === 28, `expected 28 tools, got ${tools.length}`)
    assert(
      tools.every((tool) => tool.inputSchema?.type === 'object'),
      'every tool should expose an object input schema',
    )

    const { resources } = await client.listResources()
    assert(
      resources.some((resource) => resource.uri === 'sqd://tools'),
      'expected sqd://tools resource',
    )

    const result = await client.callTool({ name: 'portal_get_head', arguments: { network: 'base' } })
    const text = result.content.find((entry) => entry.type === 'text')?.text
    assert(typeof text === 'string', 'portal_get_head should return text content')
    const payload = JSON.parse(text)
    assert(typeof (payload.number ?? payload.block_number) === 'number', 'portal_get_head should return a block number')

    console.log('PASS  server/discover negotiates MCP 2026-07-28 over stdio')
    console.log('PASS  modern tools/resources discovery exposes the complete 28-tool surface')
    console.log('PASS  modern tools/call reaches SQD Portal successfully')
    console.log('\nMCP 2026 protocol QA passed')
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error('MCP 2026 protocol QA failed:', error)
  process.exitCode = 1
})
