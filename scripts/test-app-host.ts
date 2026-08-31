#!/usr/bin/env tsx

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { build } from 'esbuild'
import { chromium } from 'playwright'

import { ACTIVITY_EXPLORER_RESOURCE_URI, MCP_APP_MIME_TYPE } from '../src/apps/activity-explorer.ts'
import { createPortalServer } from '../src/server.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const hostEntry = `
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'

async function main() {
  const iframe = document.querySelector('#sqd-app-frame')
  const resourceHtml = window.__SQD_RESOURCE_HTML__
  const toolInput = window.__SQD_TOOL_INPUT__
  const toolResult = window.__SQD_TOOL_RESULT__
  if (!(iframe instanceof HTMLIFrameElement) || typeof resourceHtml !== 'string') {
    throw new Error('SQD reference host fixture is incomplete')
  }

  const bridge = new AppBridge(
    null,
    { name: 'SQD release acceptance host', version: '1.0.0' },
    { serverTools: {}, logging: {} },
    {
      hostContext: {
        theme: 'dark',
        displayMode: 'inline',
        availableDisplayModes: ['inline', 'fullscreen'],
      },
    },
  )
  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: toolInput })
    await bridge.sendToolResult(toolResult)
    window.__SQD_HOST_INITIALIZED__ = true
  }
  const transport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow)
  await bridge.connect(transport)
  iframe.srcdoc = resourceHtml
  window.__SQD_HOST_BRIDGE__ = bridge
}

main().catch((error) => {
  window.__SQD_HOST_ERROR__ = error instanceof Error ? error.message : String(error)
})
`

async function main() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createPortalServer({ transport: 'stdio' })
  const client = new Client({ name: 'sqd-app-host-acceptance', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sqd-app-host-'))
  const hostSource = path.join(temporaryDirectory, 'host-entry.js')
  const hostBundle = path.join(temporaryDirectory, 'host-bundle.js')
  const browser = await chromium.launch({ headless: true })

  try {
    const tools = await client.listTools()
    const recentTool = tools.tools.find((tool) => tool.name === 'portal_get_recent_activity')
    assert(
      recentTool?._meta?.ui?.resourceUri === ACTIVITY_EXPLORER_RESOURCE_URI,
      'recent activity must advertise the standard MCP App resource URI',
    )

    const resource = await client.readResource({ uri: ACTIVITY_EXPLORER_RESOURCE_URI })
    const resourceContent = resource.contents[0] as { text?: string; mimeType?: string }
    assert(resourceContent.mimeType === MCP_APP_MIME_TYPE, 'the App resource must use the standard MCP Apps MIME type')
    assert(typeof resourceContent.text === 'string', 'the App resource must contain self-contained HTML')

    const toolInput = { network: 'base', timeframe: '10', limit: 3 }
    const toolResult = await client.callTool({ name: 'portal_get_recent_activity', arguments: toolInput })
    const structured = toolResult.structuredContent as Record<string, any> | undefined
    assert(toolResult.isError !== true, 'the live recent activity result must succeed before host rendering')
    assert(structured?._ui?.design_intent === 'activity_investigator', 'the live result must contain its App UI contract')

    await writeFile(hostSource, hostEntry)
    await build({
      entryPoints: [hostSource],
      outfile: hostBundle,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      nodePaths: [path.resolve('node_modules')],
      logLevel: 'silent',
    })

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#08090a"><iframe id="sqd-app-frame" title="SQD Blockchain Activity Explorer" sandbox="allow-scripts" style="width:100%;height:880px;border:0"></iframe></body></html>`)
    await page.evaluate(
      ({ resourceHtml, toolInputValue, toolResultValue }) => {
        Object.assign(window, {
          __SQD_RESOURCE_HTML__: resourceHtml,
          __SQD_TOOL_INPUT__: toolInputValue,
          __SQD_TOOL_RESULT__: toolResultValue,
        })
      },
      { resourceHtml: resourceContent.text, toolInputValue: toolInput, toolResultValue: toolResult },
    )
    await page.addScriptTag({ path: hostBundle })
    await page.waitForFunction(() => (window as any).__SQD_HOST_INITIALIZED__ === true, undefined, { timeout: 10_000 })

    const frame = page.frameLocator('#sqd-app-frame')
    await frame.locator('.sqd-shell').waitFor({ state: 'visible', timeout: 10_000 })
    assert(await frame.getByRole('heading', { name: 'Recent blockchain activity' }).isVisible(), 'the App heading must render visibly')
    assert((await frame.locator('.sqd-timeline .sqd-event').count()) > 0, 'the App must render live recent activity rows')
    assert(await frame.getByText('Read-only blockchain data from SQD Portal').isVisible(), 'the rendered App must retain SQD provenance')

    const showRaw = frame.getByRole('button', { name: 'Show raw rows' })
    assert(await showRaw.isVisible(), 'the rendered App must expose its result interaction')
    await showRaw.click()
    assert(await frame.locator('.sqd-raw[open] pre').isVisible(), 'the App interaction must reveal exact row evidence')

    const hostError = await page.evaluate(() => (window as any).__SQD_HOST_ERROR__)
    assert(hostError === undefined, `the MCP Apps host bridge must stay error-free: ${hostError}`)
    assert(errors.length === 0, `the MCP Apps host bridge and view must not log errors: ${errors.join(' | ')}`)

    console.log('PASS  official MCP Apps AppBridge initialized the SQD resource and visibly rendered a live recent-activity result')
    console.log('PASS  rendered SQD App interaction revealed exact row evidence')
  } finally {
    await browser.close()
    await client.close()
    await server.close()
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
