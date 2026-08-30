#!/usr/bin/env tsx

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

import { ACTIVITY_EXPLORER_RESOURCE_URI } from '../src/apps/activity-explorer.js'
import { npmVersion } from '../src/version.js'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function assertCacheHint(
  result: unknown,
  label: string,
  expected?: { cacheScope?: 'public' | 'private'; minimumTtlMs?: number },
) {
  const value = result as { ttlMs?: unknown; cacheScope?: unknown }
  assert(Number.isInteger(value.ttlMs) && Number(value.ttlMs) >= 0, `${label} should expose a non-negative ttlMs`)
  assert(value.cacheScope === 'public' || value.cacheScope === 'private', `${label} should expose a valid cacheScope`)
  if (expected?.cacheScope) {
    assert(value.cacheScope === expected.cacheScope, `${label} should use ${expected.cacheScope} cache scope`)
  }
  if (expected?.minimumTtlMs !== undefined) {
    assert(Number(value.ttlMs) >= expected.minimumTtlMs, `${label} should expose the expected cache lifetime`)
  }
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
    { name: 'mcp-2026-stdio-smoke', version: npmVersion },
    { versionNegotiation: { mode: 'auto', probe: { timeoutMs: 5_000 } } },
  )

  await client.connect(transport)
  try {
    assert(client.getProtocolEra() === 'modern', `expected modern era, got ${client.getProtocolEra()}`)
    assert(
      client.getNegotiatedProtocolVersion() === '2026-07-28',
      `expected protocol 2026-07-28, got ${client.getNegotiatedProtocolVersion()}`,
    )
    assert(client.getServerVersion()?.version === npmVersion, `expected server version ${npmVersion}`)
    const discover = client.getDiscoverResult()
    assert(
      discover?.supportedVersions?.includes('2026-07-28') === true,
      'server/discover should advertise 2026-07-28',
    )
    assert(discover?.resultType === 'complete', 'server/discover should identify the complete result')
    assertCacheHint(discover, 'server/discover')
    const instructions = client.getInstructions()
    assert(typeof instructions === 'string' && instructions.length > 0, 'server should expose usage instructions')
    assert(
      instructions.slice(0, 512).includes('portal_list_networks') &&
        instructions.slice(0, 512).includes('_coverage') &&
        instructions.slice(0, 512).includes('_pagination'),
      'the first 512 instruction characters should explain discovery and completeness checks',
    )

    const toolList = await client.listTools()
    const { tools } = toolList
    assertCacheHint(toolList, 'tools/list')
    assert(tools.length === 28, `expected 28 tools, got ${tools.length}`)
    assert(
      tools.every((tool) => tool.inputSchema?.type === 'object'),
      'every tool should expose an object input schema',
    )
    assert(
      tools.every((tool) => tool.outputSchema?.type === 'object'),
      'every tool should expose an object output schema',
    )
    assert(
      tools.every(
        (tool) =>
          tool.outputSchema?.properties?._coverage !== undefined &&
          tool.outputSchema?.properties?._pagination !== undefined &&
          tool.outputSchema?.properties?._execution !== undefined,
      ),
      'every output schema should describe the stable completeness and execution envelope',
    )

    const promptList = await client.listPrompts()
    assertCacheHint(promptList, 'prompts/list')

    const resourceList = await client.listResources()
    const { resources } = resourceList
    assertCacheHint(resourceList, 'resources/list')
    assert(
      resources.some((resource) => resource.uri === 'sqd://tools'),
      'expected sqd://tools resource',
    )

    const resourceTemplateList = await client.listResourceTemplates()
    assertCacheHint(resourceTemplateList, 'resources/templates/list')

    assert(
      resources.some((resource) => resource.uri === ACTIVITY_EXPLORER_RESOURCE_URI),
      'expected the versioned SQD MCP App resource',
    )
    const appResource = await client.readResource({ uri: ACTIVITY_EXPLORER_RESOURCE_URI })
    assertCacheHint(appResource, 'resources/read for SQD MCP App', { cacheScope: 'public', minimumTtlMs: 1 })

    const result = await client.callTool({ name: 'portal_get_head', arguments: { network: 'base' } })
    const text = result.content.find((entry) => entry.type === 'text')?.text
    assert(typeof text === 'string', 'portal_get_head should return text content')
    const payload = JSON.parse(text)
    assert(typeof (payload.number ?? payload.block_number) === 'number', 'portal_get_head should return a block number')

    console.log('PASS  server/discover negotiates MCP 2026-07-28 over stdio')
    console.log('PASS  server instructions are self-contained for Codex discovery')
    console.log('PASS  every cacheable complete MCP operation exposes a valid cache hint')
    console.log('PASS  modern tools/resources discovery exposes the complete 28-tool surface with structured outputs')
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
