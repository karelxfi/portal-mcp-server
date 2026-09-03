import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { runWithActivityExplorerSurface } from './apps/activity-explorer.js'
import { PORTAL_TOOL_NAMES } from './helpers/mcp-registration.js'
import { getPortalServerInstructions } from './server.js'
import { isToolEnabled, resolveDeploymentToolSelection } from './toolsets.js'

const SELECTIONS = [
  undefined,
  'discovery',
  'discovery,convenience',
  'discovery,convenience,evm',
  'evm',
  'tron',
  'hyperliquid,solana',
  'bitcoin,substrate',
]

describe('server instructions', () => {
  it('never names a tool this connection does not serve', () => {
    // The instructions are the first thing a model reads. A tool named here
    // that is not registered sends it into a method-not-found, and the model
    // has no way to know the name was wrong rather than the call.
    for (const raw of SELECTIONS) {
      const selection = resolveDeploymentToolSelection(raw === undefined ? {} : { MCP_TOOLSETS: raw })

      for (const appEnabled of [false, true]) {
        const instructions = runWithActivityExplorerSurface(appEnabled, () => getPortalServerInstructions(selection))
        const named = instructions.match(/portal_[a-z0-9_]+/g) ?? []

        for (const tool of named) {
          assert.equal(
            PORTAL_TOOL_NAMES.includes(tool),
            true,
            `instructions for "${raw ?? 'all'}" name ${tool}, which is not a tool`,
          )
          assert.equal(
            isToolEnabled(selection, tool),
            true,
            `instructions for "${raw ?? 'all'}" name ${tool}, which that selection does not register`,
          )
        }
      }
    }
  })

  it('never names an unregistered tool under an exact-name selection either', () => {
    // MCP_TOOLS narrows to exact names while every toolset stays in the
    // selection, so a check written against the toolsets alone still claimed
    // the whole catalog.
    const selection = resolveDeploymentToolSelection({ MCP_TOOLS: 'portal_list_networks,portal_get_network_info' })
    const instructions = runWithActivityExplorerSurface(true, () => getPortalServerInstructions(selection))

    for (const tool of instructions.match(/portal_[a-z0-9_]+/g) ?? []) {
      assert.equal(isToolEnabled(selection, tool), true, `instructions name ${tool}, which MCP_TOOLS excluded`)
    }
    assert.equal(instructions.includes('Tron'), false)
    assert.equal(instructions.includes('Solana'), false)
  })

  it('describes only the chain families the selection registers', () => {
    const discoveryOnly = resolveDeploymentToolSelection({ MCP_TOOLSETS: 'discovery' })
    const withTron = resolveDeploymentToolSelection({ MCP_TOOLSETS: 'discovery,tron' })

    assert.equal(getPortalServerInstructions(discoveryOnly).includes('Tron'), false)
    assert.equal(getPortalServerInstructions(discoveryOnly).includes('Solana'), false)
    assert.equal(getPortalServerInstructions(withTron).includes('portal_tron_query_transactions'), true)
    assert.equal(getPortalServerInstructions(withTron).includes('Solana'), false)

    const everything = getPortalServerInstructions(resolveDeploymentToolSelection({}))
    for (const family of ['Ethereum-compatible networks', 'Solana', 'Bitcoin', 'Hyperliquid', 'Tron']) {
      assert.equal(everything.includes(family), true, `the full catalog should describe ${family}`)
    }
  })

  it('keeps the App paragraph honest about which views it can open', () => {
    const evmOnly = resolveDeploymentToolSelection({ MCP_TOOLSETS: 'discovery,convenience,evm' })
    const instructions = runWithActivityExplorerSurface(true, () => getPortalServerInstructions(evmOnly))

    assert.equal(instructions.includes('SQD Explorer'), true)
    assert.equal(instructions.includes('portal_hyperliquid_get_ohlc'), false)
    assert.equal(instructions.includes('portal_evm_get_analytics'), true)
  })
})
