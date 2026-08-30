#!/usr/bin/env tsx

import { readFile } from 'node:fs/promises'

import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'

import {
  ACTIVITY_EXPLORER_RESOURCE_URI,
  ACTIVITY_EXPLORER_TOOLS,
  MCP_APP_MIME_TYPE,
  classifyUiCapability,
  recordActivityExplorerResult,
} from '../src/apps/activity-explorer.js'
import { ACTIVITY_EXPLORER_BYTES, ACTIVITY_EXPLORER_HASH } from '../src/generated/activity-explorer.version.js'
import { evidenceArguments, planFollowup, shorterDuration } from '../src/app-ui/followup-state.js'
import { buildEvidenceExport } from '../src/app-ui/export.js'
import { APP_FIXTURES } from '../src/app-ui/fixtures.js'
import { buildCandlestickChart, buildTimeSeriesChart } from '../src/helpers/chart-metadata.js'
import { register } from '../src/metrics.js'
import { createPortalServer } from '../src/server.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  assert(shorterDuration('in last 38 mins') === '19m', 'natural-language chart windows should narrow deterministically')
  assert(
    evidenceArguments(
      { _evidence: { request: { arguments: { duration: '1h', coin: 'BTC' } } } },
      { coin: 'BTC' },
    ).duration === '1h',
    'follow-ups should recover schema defaults from the factual evidence receipt',
  )
  assert(
    planFollowup({
      intent: 'zoom_in',
      currentArgs: evidenceArguments(
        { _evidence: { request: { arguments: { duration: '1h', coin: 'BTC' } } } },
        { coin: 'BTC' },
      ),
    }).callArgs?.duration === '30m',
    'default one-hour chart windows should narrow to thirty minutes',
  )
  const continuationPlan = planFollowup({
    intent: 'continue',
    currentArgs: { network: 'hyperliquid-fills', coin: 'BTC', duration: '1h', cursor: 'old' },
    nextCursor: 'next',
  })
  assert(
    JSON.stringify(continuationPlan.callArgs) === JSON.stringify({ cursor: 'next' }) &&
      JSON.stringify(continuationPlan.persistedArgs) === JSON.stringify({ network: 'hyperliquid-fills', coin: 'BTC', duration: '1h' }),
    'continuation should call by cursor while preserving the investigation arguments for later follow-ups',
  )
  const timeSeriesContract = buildTimeSeriesChart({ interval: '1m', totalPoints: 12 })
  const candleContract = buildCandlestickChart({ interval: '1m', totalCandles: 12 })
  for (const [name, chart] of [['time series', timeSeriesContract], ['candlestick', candleContract]] as const) {
    assert(chart.interactions?.hover?.enabled === true, `${name} charts should declare exact point inspection`)
    assert(chart.interactions?.zoom?.enabled === true, `${name} charts should declare implemented x-axis range focus`)
    assert(chart.interactions?.toolbar?.enabled === true, `${name} charts should expose the implemented range controls`)
    assert(chart.interactions?.toolbar?.actions.includes('reset_zoom') === true, `${name} charts should expose reset range`)
  }
  const shortChart = buildTimeSeriesChart({ interval: '1m', totalPoints: 4 })
  assert(shortChart.interactions?.zoom?.enabled === false, 'short charts should not advertise unnecessary range controls')

  const jsonExport = buildEvidenceExport(APP_FIXTURES.hyperliquid, 'json')
  const csvExport = buildEvidenceExport(APP_FIXTURES.hyperliquid, 'csv')
  const hyperliquidRows = (APP_FIXTURES.hyperliquid.ohlc as unknown[]).length
  assert(jsonExport.filename.endsWith('.json') && jsonExport.rowCount === hyperliquidRows, 'JSON evidence export should include all candles')
  assert(csvExport.filename.endsWith('.csv') && csvExport.rowCount === hyperliquidRows, 'CSV evidence export should include all candles')
  assert(csvExport.content.includes('sqd_evidence_sha256'), 'CSV evidence export should preserve receipt identity')
  assert(csvExport.content.split('\r\n').length === hyperliquidRows + 2, 'CSV export should contain one header and every exact row')
  assert(
    ACTIVITY_EXPLORER_HASH !== 'unbuilt' && /^[a-f0-9]{12}$/.test(ACTIVITY_EXPLORER_HASH),
    'app resource needs a content hash',
  )
  assert(
    ACTIVITY_EXPLORER_RESOURCE_URI.includes(ACTIVITY_EXPLORER_HASH),
    'resource URI must use the bundle hash as its cache key',
  )
  assert(
    ACTIVITY_EXPLORER_BYTES > 20_000 && ACTIVITY_EXPLORER_BYTES < 700_000,
    'embedded app must stay inside its release byte budget',
  )
  for (const tool of ['portal_list_networks', 'portal_get_network_info', 'portal_get_head', 'portal_debug_resolve_time_to_block']) {
    assert(!ACTIVITY_EXPLORER_TOOLS.has(tool), `${tool} is metadata evidence and must not advertise a data explorer`)
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createPortalServer({ transport: 'stdio' })
  const client = new Client({ name: 'sqd-app-contract', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const listedTools = await client.listTools()
    assert(listedTools.tools.length === 28, 'the MCP App must not change the 28-tool catalog')
    for (const tool of listedTools.tools) {
      const meta = tool._meta as Record<string, any> | undefined
      if (ACTIVITY_EXPLORER_TOOLS.has(tool.name)) {
        assert(
          meta?.ui?.resourceUri === ACTIVITY_EXPLORER_RESOURCE_URI,
          `${tool.name} should advertise standard UI metadata`,
        )
        assert(
          meta?.['ui/resourceUri'] === ACTIVITY_EXPLORER_RESOURCE_URI,
          `${tool.name} should retain the MCP Apps compatibility alias`,
        )
        assert(
          meta?.['openai/outputTemplate'] === ACTIVITY_EXPLORER_RESOURCE_URI,
          `${tool.name} should expose the ChatGPT output template alias`,
        )
      } else {
        assert(meta?.ui?.resourceUri === undefined, `${tool.name} should not open the explorer for a non-visual lookup`)
      }
      assert(tool.annotations?.readOnlyHint === true, `${tool.name} must remain read-only`)
    }

    const resources = await client.listResources()
    const resource = resources.resources.find((entry) => entry.uri === ACTIVITY_EXPLORER_RESOURCE_URI)
    assert(resource?.mimeType === MCP_APP_MIME_TYPE, 'resources/list should advertise the standard MCP App MIME type')
    const read = await client.readResource({ uri: ACTIVITY_EXPLORER_RESOURCE_URI })
    const content = read.contents[0] as Record<string, any> | undefined
    assert(content?.mimeType === MCP_APP_MIME_TYPE, 'resources/read should retain the app MIME type')
    assert(
      typeof content?.text === 'string' && Buffer.byteLength(content.text) === ACTIVITY_EXPLORER_BYTES,
      'resource bytes must match the generated artifact',
    )
    assert(
      content.text.includes('Blockchain Activity Explorer')
        && content.text.includes('viewBox="0 0 306 306"')
        && content.text.includes('#08090a')
        && content.text.includes('#818cf8')
        && content.text.includes('Inter SQD')
        && content.text.includes('JetBrains Mono SQD'),
      'the app should contain the official SQD mark, dark product tokens, and embedded typefaces',
    )
    assert(
      !content.text.includes('<script src=') && !content.text.includes('<link rel='),
      'the app must be self-contained',
    )
    const publicCopySources = await Promise.all([
      readFile('src/app-ui/view.ts', 'utf8'),
      readFile('src/app-ui/index.ts', 'utf8'),
      readFile('src/app-ui/fixtures.ts', 'utf8'),
    ])
    assert(
      publicCopySources.every((source) => !source.includes('—')),
      'public app copy must not contain em dashes',
    )
    const appBridgeSource = publicCopySources[1]
    assert(
      appBridgeSource.includes("from '@modelcontextprotocol/ext-apps'") &&
        appBridgeSource.includes('new App(') &&
        appBridgeSource.includes('{ strict: true }') &&
        appBridgeSource.includes('app.callServerTool') &&
        appBridgeSource.includes('app.requestDisplayMode'),
      'the app should use the strict portable MCP Apps bridge for results, follow-ups, and display mode',
    )
    assert(
      !appBridgeSource.includes('localStorage') && !appBridgeSource.includes('sessionStorage'),
      'the app should keep ephemeral history in the active UI instance instead of browser storage',
    )
    assert(content._meta?.ui?.csp?.connectDomains?.length === 0, 'the app must not make external network requests')
    assert(content._meta?.ui?.csp?.resourceDomains?.length === 0, 'the app must not load external resources')
    assert(
      content._meta?.['openai/widgetDomain'] === 'https://portal.sqd.dev',
      'ChatGPT compatibility metadata should use the canonical SQD domain',
    )

    const declared = classifyUiCapability(
      {
        'io.modelcontextprotocol/clientCapabilities': {
          extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [MCP_APP_MIME_TYPE] } },
        },
      },
      undefined,
    )
    const unsupported = classifyUiCapability(
      { 'io.modelcontextprotocol/clientCapabilities': { extensions: {} } },
      undefined,
    )
    assert(
      declared === 'declared' &&
        unsupported === 'unsupported' &&
        classifyUiCapability(undefined, undefined) === 'undeclared',
      'capability states should be deterministic and client-name independent',
    )

    recordActivityExplorerResult({
      toolName: 'portal_hyperliquid_get_analytics',
      result: { structuredContent: { answer: 'fixture', overview: { total_fills: 3 } } },
      transport: 'stdio',
      uiCapability: 'declared',
      resultState: 'success',
    })

    const metrics = await register.metrics()
    for (const name of [
      'mcp_app_resource_reads_total',
      'mcp_app_resource_size_bytes',
      'mcp_tool_admission_active_weight',
      'mcp_app_render_payload_bytes',
    ]) {
      assert(metrics.includes(`# HELP ${name} `), `metrics surface should expose ${name}`)
    }
    assert(
      metrics.includes('mcp_app_resource_reads_total{transport="stdio"'),
      'resource reads should complete the app render funnel',
    )
    assert(
      metrics.includes(
        'mcp_app_tool_results_total{tool="portal_hyperliquid_get_analytics",transport="stdio",ui_capability="declared",result_state="success"} 1',
      ),
      'app-enabled results should record capability and outcome',
    )
  } finally {
    await client.close()
    await server.close()
  }

  console.log('PASS  28 tool contracts remain intact with selective app metadata')
  console.log('PASS  versioned self-contained resource exposes exact standard and ChatGPT metadata')
  console.log('PASS  capability states and app runtime metrics are bounded and deterministic')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
