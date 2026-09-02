/**
 * Smoke test: build, boot the MCP server, check developer resources, call 3 fast tools, assert results.
 * Usage: npm test
 */
import { execSync, spawn } from 'node:child_process'

const TIMEOUT_MS = 15_000
let child: ReturnType<typeof spawn> | null = null
let msgId = 0
let stdoutBuffer = ''

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  child?.kill()
  process.exit(1)
}

function send(method: string, params: Record<string, unknown> = {}): string {
  const id = String(++msgId)
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params })
  child!.stdin!.write(msg + '\n')
  return id
}

async function readResponse(expectedId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for response')), 8000)

    const onData = (chunk: Buffer) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.id === expectedId) {
            clearTimeout(timer)
            child!.stdout!.off('data', onData)
            resolve(parsed)
            return
          }
        } catch {
          // not JSON, skip
        }
      }
    }

    child!.stdout!.on('data', onData)
  })
}

async function main() {
  const start = Date.now()

  // Step 1: Build
  console.log('Building...')
  try {
    execSync('npm run build', { stdio: 'pipe', cwd: process.cwd() })
  } catch (e: any) {
    fail(`Build failed: ${e.stderr?.toString() || e.message}`)
  }
  console.log('Build OK')

  // Step 2: Boot server via stdio
  child = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
  })

  child.on('error', (err) => fail(`Server failed to start: ${err.message}`))
  child.stderr!.on('data', () => {
    // stderr is for logs, ignore unless debugging
  })

  // Step 3: Initialize MCP
  const initId = send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '1.0.0' },
  })
  const initResp = await readResponse(initId)
  if (initResp.error) fail(`Initialize error: ${JSON.stringify(initResp.error)}`)
  console.log(`Server: ${initResp.result?.serverInfo?.name} v${initResp.result?.serverInfo?.version}`)

  // Send initialized notification
  child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  // Step 4: List tools
  const listId = send('tools/list')
  const listResp = await readResponse(listId)
  if (listResp.error) fail(`tools/list error: ${JSON.stringify(listResp.error)}`)
  const tools = listResp.result?.tools ?? []
  const toolCount = tools.length
  const publicToolCount = tools.filter((tool: any) => !String(tool.name || '').startsWith('portal_debug_')).length
  const advancedToolCount = tools.filter((tool: any) => String(tool.name || '').startsWith('portal_debug_')).length
  const legacyNames = [
    'portal_list_datasets',
    'portal_get_dataset_info',
    'portal_get_block_number',
    'portal_query_transactions',
    'portal_query_logs',
    'portal_get_erc20_transfers',
    'portal_query_solana_transactions',
    'portal_query_solana_instructions',
    'portal_solana_analytics',
    'portal_query_bitcoin_transactions',
    'portal_bitcoin_analytics',
    'portal_query_hyperliquid_fills',
    'portal_hyperliquid_analytics',
    'portal_hyperliquid_ohlc',
    'portal_query_blocks',
    'portal_block_at_timestamp',
    'portal_query_hyperliquid_replica_cmds',
    'portal_get_recent_transactions',
  ]
  const stillExposed = tools.map((tool: any) => tool.name).filter((name: string) => legacyNames.includes(name))
  console.log(`Tools registered: ${toolCount} (${publicToolCount} public, ${advancedToolCount} advanced)`)
  if (toolCount !== 30) fail(`Expected exactly 30 tools, got ${toolCount}`)
  if (publicToolCount !== 27) fail(`Expected exactly 27 public tools, got ${publicToolCount}`)
  if (advancedToolCount !== 3) fail(`Expected exactly 3 advanced tools, got ${advancedToolCount}`)
  if (stillExposed.length > 0) fail(`Legacy tool names are still exposed: ${stillExposed.join(', ')}`)

  // Step 4b: List and read developer-facing resources
  const resourcesId = send('resources/list')
  const resourcesResp = await readResponse(resourcesId)
  if (resourcesResp.error) fail(`resources/list error: ${JSON.stringify(resourcesResp.error)}`)
  const resources = resourcesResp.result?.resources ?? []
  const resourceUris = resources.map((resource: any) => resource.uri)
  if (!resourceUris.includes('sqd://tools')) fail(`Expected sqd://tools developer guide resource`)
  console.log('resources/list OK')

  const resourceTemplatesId = send('resources/templates/list')
  const resourceTemplatesResp = await readResponse(resourceTemplatesId)
  if (resourceTemplatesResp.error)
    fail(`resources/templates/list error: ${JSON.stringify(resourceTemplatesResp.error)}`)
  const resourceTemplates = resourceTemplatesResp.result?.resourceTemplates ?? []
  const templateUris = resourceTemplates.map((template: any) => template.uriTemplate)
  if (!templateUris.includes('sqd://tools/{name}')) fail(`Expected sqd://tools/{name} developer guide template`)
  console.log('resources/templates/list OK')

  const toolGuideId = send('resources/read', { uri: 'sqd://tools' })
  const toolGuideResp = await readResponse(toolGuideId)
  if (toolGuideResp.error) fail(`resources/read sqd://tools error: ${JSON.stringify(toolGuideResp.error)}`)
  const toolGuideText = toolGuideResp.result?.contents?.[0]?.text
  if (!toolGuideText) fail('sqd://tools returned empty content')
  const toolGuide = JSON.parse(toolGuideText)
  if (toolGuide.counts?.tools !== 30) fail(`sqd://tools expected 30 tool guide entries, got ${toolGuide.counts?.tools}`)
  if (!toolGuide.categories?.convenience?.includes('portal_get_time_series')) {
    fail('sqd://tools should group portal_get_time_series under convenience')
  }
  console.log('sqd://tools OK')

  const toolGuideEntryId = send('resources/read', { uri: 'sqd://tools/portal_get_time_series' })
  const toolGuideEntryResp = await readResponse(toolGuideEntryId)
  if (toolGuideEntryResp.error)
    fail(`resources/read sqd://tools/portal_get_time_series error: ${JSON.stringify(toolGuideEntryResp.error)}`)
  const toolGuideEntryText = toolGuideEntryResp.result?.contents?.[0]?.text
  if (!toolGuideEntryText) fail('sqd://tools/portal_get_time_series returned empty content')
  const toolGuideEntry = JSON.parse(toolGuideEntryText)
  if (toolGuideEntry.name !== 'portal_get_time_series')
    fail('Expected the single-tool guide to return portal_get_time_series')
  if (!Array.isArray(toolGuideEntry.examples) || toolGuideEntry.examples.length === 0) {
    fail('Expected the single-tool guide to include examples')
  }
  console.log('sqd://tools/{name} OK')

  // Step 5: Call portal_list_networks
  const dsId = send('tools/call', {
    name: 'portal_list_networks',
    arguments: { network_type: 'mainnet' },
  })
  const dsResp = await readResponse(dsId)
  if (dsResp.error) fail(`portal_list_networks error: ${JSON.stringify(dsResp.error)}`)
  const dsContent = dsResp.result?.content?.[0]?.text
  if (!dsContent || !dsContent.includes('ethereum-mainnet')) {
    fail(`portal_list_networks: expected ethereum-mainnet in results`)
  }
  console.log('portal_list_networks OK')

  // Step 6: Call portal_get_network_info
  const infoId = send('tools/call', {
    name: 'portal_get_network_info',
    arguments: { network: 'ethereum' },
  })
  const infoResp = await readResponse(infoId)
  if (infoResp.error) fail(`portal_get_network_info error: ${JSON.stringify(infoResp.error)}`)
  const infoContent = infoResp.result?.content?.[0]?.text
  if (!infoContent || !infoContent.includes('ethereum')) {
    fail(`portal_get_network_info: expected ethereum in results`)
  }
  console.log('portal_get_network_info OK')

  // Step 7: Call portal_get_head
  const blockId = send('tools/call', {
    name: 'portal_get_head',
    arguments: { network: 'ethereum' },
  })
  const blockResp = await readResponse(blockId)
  if (blockResp.error) fail(`portal_get_head error: ${JSON.stringify(blockResp.error)}`)
  const blockContent = blockResp.result?.content?.[0]?.text
  if (!blockContent) fail(`portal_get_head: empty response`)
  const parsed = JSON.parse(blockContent)
  const blockNum = parsed.number ?? parsed.block_number
  if (typeof blockNum !== 'number' || blockNum < 1_000_000) {
    fail(`portal_get_head: unexpected block number ${blockNum}`)
  }
  console.log(`portal_get_head OK (block ${blockNum})`)

  // Done
  child.kill()
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\nAll smoke tests passed in ${elapsed}s`)
}

const timer = setTimeout(() => fail('Global timeout'), TIMEOUT_MS)
main()
  .then(() => {
    clearTimeout(timer)
    process.exit(0)
  })
  .catch((err) => {
    clearTimeout(timer)
    fail(err.message)
  })
