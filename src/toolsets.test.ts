import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PORTAL_TOOL_NAMES } from './helpers/mcp-registration.js'
import {
  FULL_TOOL_SELECTION,
  TOOLSETS,
  isToolEnabled,
  narrowToolSelection,
  parseToolsetList,
  requestedToolsetsFromRequest,
  resolveDeploymentToolSelection,
  toolsetOf,
} from './toolsets.js'

describe('toolset coverage', () => {
  it('gives every registered tool exactly one known toolset, matching the README groups', () => {
    assert.equal(PORTAL_TOOL_NAMES.length, 31)
    const counts = new Map<string, number>()
    for (const name of PORTAL_TOOL_NAMES) {
      const toolset = toolsetOf(name)
      assert.ok(toolset && (TOOLSETS as readonly string[]).includes(toolset), `${name} has no toolset`)
      counts.set(toolset, (counts.get(toolset) ?? 0) + 1)
    }
    assert.deepEqual(Object.fromEntries([...counts.entries()].sort()), {
      bitcoin: 2,
      convenience: 3,
      debug: 3,
      discovery: 4,
      evm: 8,
      hyperliquid: 3,
      solana: 3,
      substrate: 3,
      tron: 2,
    })
  })
})

describe('resolveDeploymentToolSelection', () => {
  it('serves the full surface with nothing configured', () => {
    const selection = resolveDeploymentToolSelection({})
    assert.equal(selection.label, 'all')
    assert.deepEqual(selection.warnings, [])
    for (const name of PORTAL_TOOL_NAMES) assert.equal(isToolEnabled(selection, name), true)
  })

  it('keeps only the named toolsets and reports unknown names', () => {
    const selection = resolveDeploymentToolSelection({ MCP_TOOLSETS: 'discovery, EVM, nonsense' })
    assert.deepEqual([...selection.toolsets], ['discovery', 'evm'])
    assert.equal(selection.label, 'custom')
    assert.match(selection.warnings[0], /unknown toolset name\(s\): nonsense/)
    assert.equal(isToolEnabled(selection, 'portal_get_head'), true)
    assert.equal(isToolEnabled(selection, 'portal_evm_query_logs'), true)
    assert.equal(isToolEnabled(selection, 'portal_debug_query_blocks'), false)
    assert.equal(resolveDeploymentToolSelection({ MCP_TOOLSETS: 'debug' }).label, 'debug')
    assert.equal(resolveDeploymentToolSelection({ MCP_TOOLSETS: 'all' }).label, 'all')
  })

  it('falls back to the full surface when only unknown names are given', () => {
    const selection = resolveDeploymentToolSelection({ MCP_TOOLSETS: 'nonsense' })
    assert.equal(selection.label, 'all')
    assert.equal(selection.warnings.length, 2)
  })

  it('accepts exact tool names through MCP_TOOLS and lets MCP_TOOLSETS win', () => {
    const exact = resolveDeploymentToolSelection({ MCP_TOOLS: 'portal_get_head, portal_list_networks, nope' })
    assert.equal(exact.label, 'custom')
    assert.equal(isToolEnabled(exact, 'portal_get_head'), true)
    assert.equal(isToolEnabled(exact, 'portal_get_network_info'), false)
    assert.match(exact.warnings[0], /unknown tool name\(s\): nope/)
    const both = resolveDeploymentToolSelection({ MCP_TOOLSETS: 'solana', MCP_TOOLS: 'portal_get_head' })
    assert.equal(isToolEnabled(both, 'portal_get_head'), false)
    assert.equal(isToolEnabled(both, 'portal_solana_get_analytics'), true)
    assert.match(both.warnings[0], /MCP_TOOLS is ignored/)
  })
})

describe('narrowToolSelection', () => {
  it('intersects with the deployment set and never widens it', () => {
    const deployment = resolveDeploymentToolSelection({ MCP_TOOLSETS: 'discovery,evm' })
    const narrowed = narrowToolSelection(deployment, ['evm,debug'])
    assert.deepEqual([...narrowed.toolsets], ['evm'])
    assert.equal(narrowed.label, 'evm')
    assert.equal(isToolEnabled(narrowed, 'portal_debug_query_blocks'), false)
    assert.equal(isToolEnabled(narrowed, 'portal_get_head'), false)
    assert.equal(narrowToolSelection(deployment, ['nonsense']), deployment)
    assert.equal(narrowToolSelection(deployment, undefined), deployment)
    assert.equal(narrowToolSelection(deployment, ['all']), deployment)
    const onlyDebug = narrowToolSelection(deployment, ['debug'])
    assert.equal(onlyDebug.toolsets.size, 0)
  })

  it('keeps an exact MCP_TOOLS list when a connection narrows by toolset', () => {
    const deployment = resolveDeploymentToolSelection({ MCP_TOOLS: 'portal_get_head,portal_evm_query_logs' })
    const narrowed = narrowToolSelection(deployment, ['evm'])
    assert.equal(isToolEnabled(narrowed, 'portal_evm_query_logs'), true)
    assert.equal(isToolEnabled(narrowed, 'portal_get_head'), false)
    assert.equal(isToolEnabled(narrowed, 'portal_evm_get_ohlc'), false)
  })
})

describe('request parsing', () => {
  it('reads the header and the query parameter', () => {
    const headers = new Headers({ 'x-mcp-toolsets': 'discovery' })
    assert.deepEqual(requestedToolsetsFromRequest({ url: 'http://localhost/mcp?toolsets=evm', headers }), [
      'discovery',
      'evm',
    ])
    assert.equal(requestedToolsetsFromRequest({ url: 'http://localhost/mcp' }), undefined)
    assert.equal(requestedToolsetsFromRequest(undefined), undefined)
    assert.deepEqual(parseToolsetList(' evm , Solana,,x '), { toolsets: ['evm', 'solana'], unknown: ['x'], all: false })
    assert.equal(FULL_TOOL_SELECTION.label, 'all')
  })
})
