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
    { openLinks: {}, serverTools: {}, downloadFile: {}, logging: {} },
    {
      hostContext: {
        theme: 'dark',
        displayMode: 'inline',
        availableDisplayModes: ['inline', 'fullscreen'],
      },
    },
  )
  /* A real host answers a display-mode request and then announces the new
     context, which is how the inline card becomes the fullscreen workspace. */
  bridge.onrequestdisplaymode = async ({ mode }) => {
    bridge.setHostContext({ theme: 'dark', displayMode: mode, availableDisplayModes: ['inline', 'fullscreen'] })
    window.__SQD_HOST_DISPLAY_MODE__ = mode
    return { mode }
  }
  /* Tool calls go to the real server through the Node side of the test;
     links and downloads are recorded the way a host would act on them. */
  bridge.oncalltool = async (params) => {
    const result = await window.__sqdCallTool(params)
    ;(window.__SQD_TOOL_CALLS__ ||= []).push({
      name: params.name,
      isError: result?.isError,
      structured: Object.keys(result?.structuredContent ?? {}).slice(0, 6),
      contentTypes: (result?.content ?? []).map((part) => part.type),
    })
    return result
  }
  bridge.onopenlink = async ({ url }) => {
    ;(window.__SQD_OPENED_LINKS__ ||= []).push(url)
    return {}
  }
  bridge.ondownloadfile = async ({ contents }) => {
    ;(window.__SQD_DOWNLOADS__ ||= []).push(contents)
    return {}
  }
  bridge.onsizechange = ({ height }) => {
    ;(window.__SQD_SIZES__ ||= []).push(height)
  }
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
  const server = createPortalServer({ transport: 'stdio', appEnabled: true })
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

    const toolInput = { network: 'base', timeframe: '1h', limit: 3 }
    const toolResult = await client.callTool({ name: 'portal_get_recent_activity', arguments: toolInput })
    const structured = toolResult.structuredContent as Record<string, any> | undefined
    assert(toolResult.isError !== true, 'the live recent activity result must succeed before host rendering')
    assert(
      structured?._ui?.design_intent === 'activity_investigator',
      'the live result must contain its App UI contract',
    )
    const expectedHeading = String(
      structured?._ui?.headline?.title ?? structured?.display?.title ?? structured?.answer ?? '',
    )
    assert(expectedHeading.length > 0, 'the live result must include a subject for the App heading')

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
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#08090a"><iframe id="sqd-app-frame" title="SQD Explorer" sandbox="allow-scripts" style="width:100%;height:880px;border:0"></iframe></body></html>`,
    )
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
    await page.exposeFunction('__sqdCallTool', async (params: { name: string; arguments?: Record<string, unknown> }) =>
      client.callTool({ name: params.name, arguments: params.arguments ?? {} }),
    )
    await page.addScriptTag({ path: hostBundle })
    await page.waitForFunction(() => (window as any).__SQD_HOST_INITIALIZED__ === true, undefined, { timeout: 10_000 })

    const frame = page.frameLocator('#sqd-app-frame')
    await frame.locator('.sqd-shell').waitFor({ state: 'visible', timeout: 10_000 })
    const resultHeading = frame.locator('h1#sqd-result-title')
    assert(await resultHeading.isVisible(), 'the App heading must render visibly')
    assert(
      (await resultHeading.textContent()) === expectedHeading,
      'the App heading must preserve the live result claim exactly',
    )
    assert(
      (await frame.locator('.sqd-timeline .sqd-event').count()) > 0,
      'the App must render live recent activity rows',
    )
    assert(await frame.locator('.sqd-mark').first().isVisible(), 'the rendered App must retain the SQD mark')
    assert(
      (await frame.locator('.sqd-app[data-mode="inline"]').count()) === 1,
      'the host opens the App as an inline summary card',
    )
    assert((await frame.locator('.sqd-followups button').count()) <= 2, 'the inline card offers at most two actions')
    assert((await frame.locator('.sqd-raw').count()) === 0, 'the inline card leaves raw evidence to fullscreen')

    const openFullscreen = frame.getByRole('button', { name: 'Open full screen' })
    assert(await openFullscreen.isVisible(), 'the inline card must offer the way into fullscreen')
    await openFullscreen.click()
    await frame.locator('.sqd-app[data-mode="fullscreen"]').waitFor({ state: 'attached', timeout: 10_000 })
    assert(
      (await page.evaluate(() => (window as any).__SQD_HOST_DISPLAY_MODE__)) === 'fullscreen',
      'the App must request fullscreen through the host bridge',
    )
    const showRaw = frame.getByRole('button', { name: 'Show raw rows' })
    assert(await showRaw.isVisible(), 'the rendered App must expose its result interaction in fullscreen')
    await showRaw.click()
    assert(await frame.locator('.sqd-raw[open] pre').isVisible(), 'the App interaction must reveal exact row evidence')

    /* Every action a person can reach must do its job through the host. */
    const until = async (probe: () => Promise<boolean>, message: string, timeout = 60_000) => {
      const started = Date.now()
      while (Date.now() - started < timeout) {
        if (await probe()) return
        await page.waitForTimeout(150)
      }
      const dangers = await frame.locator('.sqd-notice--danger').allInnerTexts()
      const busy = await frame.locator('.sqd-shell[aria-busy="true"]').count()
      const calls = await page.evaluate(() => (window as any).__SQD_TOOL_CALLS__ ?? [])
      const backState = await frame
        .locator('.sqd-topbar button', { hasText: 'Back' })
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLButtonElement).disabled))
      const topbar = await frame.locator('.sqd-topbar').innerText()
      const mode = await frame.locator('.sqd-app').first().getAttribute('data-mode')
      const receipt = await frame
        .locator('.sqd-receipt-line, .sqd-receipt')
        .first()
        .innerText()
        .catch(() => '')
      throw new Error(
        `${message} (danger notices: ${JSON.stringify(dangers)}; busy: ${busy}; tool calls: ${JSON.stringify(calls)}; back: ${JSON.stringify(backState)}; mode: ${mode}; topbar: ${JSON.stringify(topbar)}; receipt: ${JSON.stringify(receipt)}; page errors: ${errors.join(' | ')})`,
      )
    }
    const timelineText = () => frame.locator('.sqd-timeline').first().innerText()
    const firstPage = await timelineText()
    const loadOlder = frame.getByRole('button', { name: 'Load older activity' })
    assert(
      (await loadOlder.count()) === 1 && (await loadOlder.isEnabled()),
      'the continuation action must be offered and enabled',
    )
    await loadOlder.click()
    const back = frame.locator('.sqd-topbar button', { hasText: 'Back' })
    await until(
      async () => (await back.count()) === 1 && (await back.isEnabled()),
      'loading older activity must produce a second result the person can step back from',
    )
    const secondPage = await timelineText()
    assert(secondPage !== firstPage, 'loading older activity must show different rows than the first page')
    assert(
      (await frame.locator('.sqd-notice--danger').count()) === 0,
      'the continuation call through the host must not fail',
    )
    await back.click()
    assert((await timelineText()) === firstPage, 'Back must restore the first page exactly')
    const forward = frame.locator('.sqd-topbar button', { hasText: 'Forward' })
    assert(await forward.isEnabled(), 'Forward must be available after stepping back')
    await forward.click()
    assert((await timelineText()) === secondPage, 'Forward must return to the loaded page exactly')
    console.log('PASS  Load older, Back and Forward round-trip live pages through the host bridge')

    const downloads = () =>
      page.evaluate(() => ((window as any).__SQD_DOWNLOADS__ ?? []) as Array<Array<Record<string, any>>>)
    await frame.getByRole('button', { name: 'Download JSON' }).click()
    await until(async () => (await downloads()).length >= 1, 'Download JSON must reach the host as a download request')
    await frame.getByRole('button', { name: 'Download CSV' }).click()
    await until(async () => (await downloads()).length >= 2, 'Download CSV must reach the host as a download request')
    const [jsonDownload, csvDownload] = await downloads()
    const jsonResource = jsonDownload[0]?.resource
    const csvResource = csvDownload[0]?.resource
    assert(
      jsonResource?.uri?.endsWith('.json') && String(jsonResource.mimeType).startsWith('application/json'),
      'the JSON download must be a JSON file',
    )
    const parsedJson = JSON.parse(String(jsonResource.text))
    assert(
      Array.isArray(parsedJson.items) && parsedJson._evidence?.result?.exact_data_sha256,
      'the JSON download must carry the exact rows and receipt',
    )
    assert(
      csvResource?.uri?.endsWith('.csv') && String(csvResource.mimeType).startsWith('text/csv'),
      'the CSV download must be a CSV file',
    )
    const csvLines = String(csvResource.text).split('\r\n').filter(Boolean)
    assert(
      csvLines[0].includes('sqd_evidence_sha256') && csvLines.length === parsedJson.items.length + 1,
      'the CSV download must hold one header and every exact row',
    )
    console.log('PASS  Download JSON and Download CSV deliver exact evidence through the host download request')

    await frame.getByRole('button', { name: 'Full receipt' }).click()
    const dialog = frame.locator('.sqd-dialog[open]')
    assert(await dialog.isVisible(), 'Full receipt must open the receipt dialog')
    assert((await dialog.innerText()).includes('exact_data_sha256'), 'the receipt dialog must show the evidence digest')
    await dialog.getByRole('button', { name: 'Close' }).click()
    assert((await frame.locator('.sqd-dialog[open]').count()) === 0, 'Close must dismiss the receipt dialog')

    const rowButton = frame.locator('table.sqd-table .sqd-row-button').first()
    await rowButton.click()
    assert(await frame.locator('.sqd-dialog[open]').isVisible(), 'a table row must open its exact JSON')
    await frame.locator('.sqd-dialog[open]').getByRole('button', { name: 'Close' }).click()
    console.log('PASS  Full receipt and row dialogs open and close')

    const link = frame.locator('table.sqd-table a.sqd-link[href*="/tx/"]').first()
    assert((await link.count()) === 1, 'identifiers in the exact table must link to the public explorer')
    const linkedId = (await link.innerText()).trim()
    await link.click()
    await until(
      async () => ((await page.evaluate(() => (window as any).__SQD_OPENED_LINKS__ ?? [])) as string[]).length >= 1,
      'clicking an identifier must ask the host to open the explorer link',
      10_000,
    )
    const opened = (await page.evaluate(() => (window as any).__SQD_OPENED_LINKS__)) as string[]
    assert(
      opened[0] === `https://basescan.org/tx/${linkedId.split(':')[0]}`,
      `the explorer link must point at the same record on Basescan: ${opened[0]}`,
    )
    console.log('PASS  identifier links open the matching Basescan record through the host')

    const table = frame.locator('table.sqd-table').first()
    const rowsBefore = await table.locator('tbody tr').count()
    const filter = frame.locator('.sqd-input').first()
    await filter.fill(linkedId.slice(0, 12))
    assert(
      (await table.locator('tbody tr').count()) >= 1 && (await table.locator('tbody tr').count()) <= rowsBefore,
      'filtering must narrow the exact rows',
    )
    await filter.fill('sqd-no-such-row')
    assert((await table.locator('tbody tr').count()) === 0, 'filtering must hide non-matching rows')
    await filter.fill('')
    assert((await table.locator('tbody tr').count()) === rowsBefore, 'clearing the filter must restore every row')
    await table.locator('.sqd-sort').first().click()
    assert(
      (await table.locator('th[aria-sort="ascending"], th[aria-sort="descending"]').count()) === 1,
      'sorting must mark the sorted column',
    )
    console.log('PASS  table filter and sort work in the host')

    await frame.locator('.sqd-topbar button', { hasText: 'Exit full screen' }).click()
    await frame.locator('.sqd-app[data-mode="inline"]').waitFor({ state: 'attached', timeout: 10_000 })
    assert(
      (await page.evaluate(() => (window as any).__SQD_HOST_DISPLAY_MODE__)) === 'inline',
      'Exit full screen must hand the display mode back to the host',
    )
    console.log('PASS  Exit full screen returns to the inline card through the host')

    /* A chat host sizes the inline card from the app's size report; without
       it the card falls back to a host default and shows blank space. */
    const contentHeight = await frame.locator('.sqd-app').evaluate((node) => node.getBoundingClientRect().height)
    const sizes = () => page.evaluate(() => ((window as any).__SQD_SIZES__ ?? []) as number[])
    await until(
      async () => Math.abs(((await sizes()).at(-1) ?? -1) - contentHeight) <= 2,
      `the app must report its content height to the host (reported ${(await sizes()).join(', ')}; content ${contentHeight})`,
      5_000,
    )
    console.log('PASS  the inline card reports its exact content height through size-changed')

    const hostError = await page.evaluate(() => (window as any).__SQD_HOST_ERROR__)
    assert(hostError === undefined, `the MCP Apps host bridge must stay error-free: ${hostError}`)
    assert(errors.length === 0, `the MCP Apps host bridge and view must not log errors: ${errors.join(' | ')}`)

    console.log(
      'PASS  official MCP Apps AppBridge initialized the SQD resource and visibly rendered a live recent-activity result',
    )
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
