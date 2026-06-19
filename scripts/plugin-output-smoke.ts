type JsonObject = Record<string, unknown>

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertRecord(value: unknown, message: string): asserts value is JsonObject {
  assert(Boolean(value) && typeof value === 'object' && !Array.isArray(value), message)
}

function assertString(value: unknown, message: string): asserts value is string {
  assert(typeof value === 'string' && value.trim().length > 0, message)
}

function assertArray(value: unknown, message: string): asserts value is unknown[] {
  assert(Array.isArray(value), message)
}

const PROCESS_NARRATION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bloaded (?:a )?(?:tool|file|reference|skill)\b/i, reason: 'loaded-tool/file chatter' },
  { pattern: /\bread (?:a |\d+ )?(?:file|files|reference|references|memory|memories)\b/i, reason: 'reference-loading chatter' },
  { pattern: /\bprior Hyperliquid notes\b/i, reason: 'prepared-note chatter' },
  { pattern: /\bprepared notes?\b/i, reason: 'prepared-note chatter' },
  { pattern: /\bfreshness check (?:is )?(?:clean|passed|good)\b/i, reason: 'freshness-check narration' },
  { pattern: /\banchoring (?:the )?(?:export|query)\b/i, reason: 'head-anchoring narration' },
  { pattern: /\b(?:confirmed|checking|verify|verifying) (?:the )?query shape\b/i, reason: 'query-shape narration' },
  { pattern: /\brunning (?:count|line) checks?\b/i, reason: 'count-check narration' },
  { pattern: /\bexpand(?:ing)? (?:the )?(?:block|time) window\b/i, reason: 'window-expansion narration' },
  { pattern: /\bI(?:'|’)ll (?:use|check|read|load|verify|run|export)\b/i, reason: 'process preamble' },
  { pattern: /\blet me (?:check|read|load|inspect|verify|run)\b/i, reason: 'process preamble' },
]

function collectNarrativeText(value: unknown, path = '$', out: Array<{ path: string; text: string }> = []) {
  if (typeof value === 'string') {
    out.push({ path, text: value })
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNarrativeText(item, `${path}[${index}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectNarrativeText(item, `${path}.${key}`, out)
    }
  }
  return out
}

function assertNoProcessNarration(data: JsonObject, label: string) {
  const narrativeSurface = {
    answer: data.answer,
    display: data.display,
    next_steps: data.next_steps,
    investigation: data.investigation,
    llm: data._llm,
  }

  for (const { path, text } of collectNarrativeText(narrativeSurface)) {
    for (const { pattern, reason } of PROCESS_NARRATION_PATTERNS) {
      assert(!pattern.test(text), `${label} should not include ${reason} at ${path}: ${text}`)
    }
  }
}

function parseSseJson(text: string) {
  const dataLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data: '))
  assert(Boolean(dataLine), `Expected SSE data line, got: ${text.slice(0, 240)}`)
  return JSON.parse(dataLine!.slice('data: '.length)) as JsonObject
}

async function postRpc(endpoint: string, method: string, params: JsonObject, clientName: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-mcp-client-name': clientName,
      'x-mcp-client-version': '1.0.0',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  })
  const text = await response.text()
  assert(response.ok, `RPC ${method} should return HTTP 2xx, got ${response.status}: ${text.slice(0, 240)}`)
  const parsed = parseSseJson(text)
  assert(!parsed.error, `RPC ${method} returned JSON-RPC error: ${JSON.stringify(parsed.error)}`)
  return parsed.result as JsonObject
}

async function callTool(endpoint: string, clientName: string, name: string, args: JsonObject) {
  const result = await postRpc(endpoint, 'tools/call', { name, arguments: args }, clientName)
  const content = result.content
  assertArray(content, `${name} should return content`)
  const text = (content as JsonObject[]).find((entry) => entry.type === 'text')?.text
  assertString(text, `${name} should return text content`)
  return JSON.parse(text) as JsonObject
}

function assertPluginAnswerEnvelope(data: JsonObject, label: string) {
  assertString(data.answer, `${label} should include a readable answer`)
  assertRecord(data.display, `${label} should include display metadata`)
  assertString(data.display.title, `${label} display title should be readable`)
  assert(!String(data.display.title).includes('portal_'), `${label} display title should be product-friendly`)
  assertRecord(data.next_steps, `${label} should include next steps`)
  assertArray(data.next_steps.actions, `${label} next steps should expose actions`)
  assertRecord(data._coverage, `${label} should include coverage metadata`)
  assertRecord(data._execution, `${label} should include execution metadata`)
  assertRecord(data._pagination, `${label} should include pagination metadata`)
}

function assertOptionalExecutionGuidance(data: JsonObject, label: string, expectedSurface: string) {
  const llm = data._llm
  if (!llm || typeof llm !== 'object' || Array.isArray(llm)) return
  const guidance = (llm as JsonObject).execution_guidance
  if (!guidance || typeof guidance !== 'object' || Array.isArray(guidance)) return
  const surfaces = (guidance as JsonObject).recommended_surfaces
  assertArray(surfaces, `${label} execution guidance should expose recommended surfaces`)
  assert(surfaces.includes(expectedSurface), `${label} execution guidance should recommend ${expectedSurface}`)
}

function assertHyperliquidBtcFills(data: JsonObject) {
  assertPluginAnswerEnvelope(data, 'Hyperliquid BTC fills')
  assert(/200/.test(data.answer), 'Hyperliquid BTC fills answer should acknowledge the requested 200 fills')
  assertRecord(data.page_summary, 'Hyperliquid BTC fills should include page_summary')
  assert(data.page_summary.visible_fills === 200, 'Hyperliquid BTC fills should report 200 visible fills')
  assert(data._pagination.page_size === 200, 'Hyperliquid BTC fills should preserve the 200-row page size')
  assert(data._pagination.returned === 200, 'Hyperliquid BTC fills should report 200 returned fills in metadata')
  assert(data._pagination.has_more === true, 'Hyperliquid BTC fills should expose cursor continuation for older fills')
  assert(data._coverage.result_complete === false, 'Hyperliquid BTC fills should disclose that older matching fills remain')
  assertArray(data.items, 'Hyperliquid BTC fills should include row evidence')
  assert(data.items.length > 0, 'Hyperliquid BTC fills should include at least one visible row')
  assert(
    (data.items as JsonObject[]).every((item) => item.coin === 'BTC'),
    'Hyperliquid BTC fills visible rows should all be BTC',
  )
  for (const item of data.items as JsonObject[]) {
    assert(item.px !== undefined, 'Hyperliquid BTC fill rows should include price')
    assert(item.sz !== undefined, 'Hyperliquid BTC fill rows should include size')
    assert(item.side !== undefined, 'Hyperliquid BTC fill rows should include side')
  }
  const actionLabels = (data.next_steps.actions as JsonObject[]).map((action) => String(action.label ?? '').toLowerCase())
  assert(actionLabels.some((label) => label.includes('older')), 'Hyperliquid BTC fills should offer cursor continuation')
  assert(actionLabels.some((label) => label.includes('raw')), 'Hyperliquid BTC fills should expose a raw-row action')
  assertOptionalExecutionGuidance(data, 'Hyperliquid BTC fills', 'portal_stream_api')
  assertNoProcessNarration(data, 'Hyperliquid BTC fills')
}

function assertBaseTransactionBuckets(data: JsonObject) {
  assertPluginAnswerEnvelope(data, 'Base transaction buckets')
  assert(/Base/.test(data.answer), 'Base transaction buckets answer should name Base')
  assert(/2h|2 h|2 hours/i.test(data.answer), 'Base transaction buckets answer should describe the 2h window')
  assertRecord(data.summary, 'Base transaction buckets should include summary')
  assert(data.summary.total_buckets === 8, 'Base transaction buckets should contain 8 x 15-minute buckets')
  assert(data.summary.expected_buckets === 8, 'Base transaction buckets should expect 8 buckets')
  assertArray(data.time_series, 'Base transaction buckets should include chart rows')
  assert(data.time_series.length === 8, 'Base transaction buckets should return 8 chart rows')
  assert(data._coverage.window_complete === true, 'Base transaction buckets should complete the requested window')
  assertRecord(data.chart, 'Base transaction buckets should include chart metadata')
  assertArray(data.tables, 'Base transaction buckets should include table metadata')
  assertOptionalExecutionGuidance(data, 'Base transaction buckets', 'pipes_squid')
  assertNoProcessNarration(data, 'Base transaction buckets')
}

function assertBaseUsdcFlows(data: JsonObject) {
  assertPluginAnswerEnvelope(data, 'Base USDC flows')
  assert(/USDC|ERC20|transfers/i.test(data.answer), 'Base USDC flows answer should describe USDC transfer rows')
  assertRecord(data.display, 'Base USDC flows should include display metadata')
  assert(/Base/.test(String(data.display.subtitle ?? data.display.network ?? '')), 'Base USDC flows display should name Base')
  assertArray(data.items, 'Base USDC flows should include row evidence')
  assert(data.items.length > 0, 'Base USDC flows should return transfer rows')
  assert(data.items.length <= 50, 'Base USDC flows should keep the preview bounded')
  for (const item of data.items as JsonObject[]) {
    assertString(item.tx_hash ?? item.transaction_hash, 'Base USDC flow row should include a tx hash')
    assertString(item.sender ?? item.from, 'Base USDC flow row should include a sender')
    assertString(item.recipient ?? item.to, 'Base USDC flow row should include a recipient')
    assertString(item.value_formatted, 'Base USDC flow row should include a formatted amount')
    assert(String(item.value_formatted).includes('USDC'), 'Base USDC flow row should format amounts as USDC')
  }
  assertRecord(data._coverage, 'Base USDC flows should include coverage metadata')
  assert(data._coverage.window_complete === true, 'Base USDC flows should complete the requested 1h window')
  assertRecord(data._pagination, 'Base USDC flows should include pagination metadata')
  assert(data._pagination.page_size === 50, 'Base USDC flows should preserve the 50-row page size')
  const actionLabels = (data.next_steps.actions as JsonObject[]).map((action) => String(action.label ?? '').toLowerCase())
  assert(actionLabels.some((label) => label.includes('older') || label.includes('continue')), 'Base USDC flows should offer continuation when available')
  assertNoProcessNarration(data, 'Base USDC flows')
}

export async function assertPluginOutputSmoke(endpoint: string, runtimeLabel: string) {
  const clientName = `portal-mcp-${runtimeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-output-smoke`

  const btcFills = await callTool(endpoint, clientName, 'portal_hyperliquid_query_fills', {
    network: 'hyperliquid-fills',
    timeframe: '6h',
    coin: ['BTC'],
    limit: 200,
  })
  assertHyperliquidBtcFills(btcFills)

  const baseBuckets = await callTool(endpoint, clientName, 'portal_get_time_series', {
    network: 'base',
    metric: 'transaction_count',
    interval: '15m',
    duration: '2h',
  })
  assertBaseTransactionBuckets(baseBuckets)

  const usdcFlows = await callTool(endpoint, clientName, 'portal_evm_query_token_transfers', {
    network: 'base',
    timeframe: '1h',
    token_symbols: ['USDC'],
    limit: 50,
  })
  assertBaseUsdcFlows(usdcFlows)

  console.log(`${runtimeLabel} plugin output smoke passed: BTC fills, Base throughput buckets, and Base USDC flow UX are valid`)
}
