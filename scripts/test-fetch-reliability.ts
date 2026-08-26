#!/usr/bin/env tsx

import { createServer } from 'node:http'
import type { Socket } from 'node:net'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createQueryCache } from '../src/cache/query-cache.js'
import { scanBoundedBlockRange } from '../src/helpers/bounded-search.js'
import { RequestCancelledError } from '../src/helpers/errors.js'
import { fetchExternalJson } from '../src/helpers/external-apis.js'
import {
  portalFetch,
  portalFetchRecentRecords,
  portalFetchStream,
  portalFetchStreamVisit,
  sleep,
} from '../src/helpers/fetch.js'
import { runWithPortalRequestSignal } from '../src/helpers/request-context.js'
import { toolCallsTotal, toolErrorsTotal } from '../src/metrics.js'
import { createPortalServer } from '../src/server.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function expectFastFailure(
  label: string,
  action: () => Promise<unknown>,
  validate: (error: unknown) => void,
  maxElapsedMs = 1_000,
) {
  const startedAt = Date.now()
  try {
    await action()
    throw new Error(`${label} unexpectedly succeeded`)
  } catch (error) {
    if (error instanceof Error && error.message === `${label} unexpectedly succeeded`) throw error
    validate(error)
  }
  const elapsedMs = Date.now() - startedAt
  assert(elapsedMs < maxElapsedMs, `${label} should fail within ${maxElapsedMs}ms, took ${elapsedMs}ms`)
  console.log(`PASS  ${label} [${elapsedMs}ms]`)
}

async function main() {
  let activeScans = 0
  let maxActiveScans = 0
  const scanResult = await scanBoundedBlockRange({
    fromBlock: 1,
    toBlock: 50,
    chunkSize: 10,
    concurrency: 3,
    scanOrder: 'latest',
    fetchChunk: async () => {
      activeScans += 1
      maxActiveScans = Math.max(maxActiveScans, activeScans)
      await new Promise((resolve) => setTimeout(resolve, 20))
      activeScans -= 1
      return []
    },
  })
  assert(maxActiveScans === 3, `bounded reverse scan should use concurrency 3, observed ${maxActiveScans}`)
  assert(scanResult.scannedBlocks === 50 && scanResult.exhaustedWindow, 'bounded reverse scan should cover its window')
  console.log('PASS  bounded reverse scans preserve coverage while fetching ordered batches concurrently')

  const sockets = new Set<Socket>()
  let closedRequests = 0
  let activeRangeRequests = 0
  let maxActiveRangeRequests = 0
  const server = createServer((req, res) => {
    req.on('close', () => {
      closedRequests += 1
    })

    if (req.url === '/range') {
      activeRangeRequests += 1
      maxActiveRangeRequests = Math.max(maxActiveRangeRequests, activeRangeRequests)
      setTimeout(() => {
        activeRangeRequests -= 1
        res.writeHead(204)
        res.end()
      }, 20)
      return
    }

    if (req.url === '/json-stall') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '2' })
      res.flushHeaders()
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    res.flushHeaders()
    res.write('{"number":1}\n')
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object', 'test server should expose a TCP address')
  const baseUrl = `http://127.0.0.1:${address.port}`

  try {
    const recentRecords = await portalFetchRecentRecords(
      `${baseUrl}/range`,
      { fromBlock: 1, toBlock: 50 },
      { itemKeys: ['logs'], limit: 1, chunkSize: 10, concurrency: 3, retries: 0 },
    )
    assert(recentRecords.length === 0, 'empty range fixtures should return no recent records')
    assert(
      maxActiveRangeRequests === 3,
      `recent record scanner should use concurrency 3, observed ${maxActiveRangeRequests}`,
    )
    console.log('PASS  recent record scans preserve reverse coverage with bounded concurrency')

    await expectFastFailure(
      'regular fetch times out while reading a stalled body',
      () => portalFetch(`${baseUrl}/json-stall`, { timeout: 100, retries: 0 }),
      (error) =>
        assert(error instanceof Error && /Request timeout after 100ms/.test(error.message), 'expected timeout error'),
    )

    await expectFastFailure(
      'external enrichment times out while reading a stalled body',
      () => fetchExternalJson(`${baseUrl}/json-stall`, 'External test API', { timeout: 100 }),
      (error) =>
        assert(
          error instanceof Error && /External test API timed out after 100ms/.test(error.message),
          'expected external enrichment timeout error',
        ),
    )

    await expectFastFailure(
      'stream fetch times out while reading a stalled body',
      () => portalFetchStream(`${baseUrl}/stream-stall`, {}, { timeout: 100, retries: 0 }),
      (error) =>
        assert(error instanceof Error && /Request timeout after 100ms/.test(error.message), 'expected timeout error'),
    )

    await expectFastFailure(
      'stream visitor times out while reading a stalled body',
      () =>
        portalFetchStreamVisit(`${baseUrl}/visit-stall`, {}, { timeout: 100, retries: 0, onRecord: () => undefined }),
      (error) =>
        assert(error instanceof Error && /Request timeout after 100ms/.test(error.message), 'expected timeout error'),
    )

    const cancellation = new AbortController()
    setTimeout(() => cancellation.abort(), 50)
    await expectFastFailure(
      'MCP cancellation aborts the active Portal stream',
      () =>
        runWithPortalRequestSignal(cancellation.signal, () =>
          portalFetchStream(`${baseUrl}/cancel-stall`, {}, { timeout: 5_000, retries: 0 }),
        ),
      (error) => assert(error instanceof RequestCancelledError, 'expected RequestCancelledError'),
      750,
    )

    const retryCancellation = new AbortController()
    setTimeout(() => retryCancellation.abort(), 50)
    await expectFastFailure(
      'MCP cancellation interrupts retry backoff',
      () => runWithPortalRequestSignal(retryCancellation.signal, () => sleep(5_000)),
      (error) => assert(error instanceof RequestCancelledError, 'expected RequestCancelledError'),
      750,
    )

    const queryCache = createQueryCache<string>({ ttl: 1_000 })
    const firstCacheRequest = new AbortController()
    const firstLoad = runWithPortalRequestSignal(firstCacheRequest.signal, () =>
      queryCache.getOrLoad('shared-key', async () => {
        await portalFetch(`${baseUrl}/json-stall`, { timeout: 5_000, retries: 0 })
        return 'first'
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    const secondCacheRequest = new AbortController()
    const secondLoad = runWithPortalRequestSignal(secondCacheRequest.signal, () =>
      queryCache.getOrLoad('shared-key', async () => 'second'),
    )
    firstCacheRequest.abort()
    const firstCacheError = await firstLoad.catch((error) => error)
    const secondCacheResult = await secondLoad
    assert(firstCacheError instanceof RequestCancelledError, 'cancelled cache loader should fail its own request')
    assert(
      secondCacheResult.value === 'second',
      'unrelated request should not inherit another cache loader cancellation',
    )
    console.log('PASS  in-flight query cache cancellation is isolated between MCP requests')

    await new Promise((resolve) => setTimeout(resolve, 50))
    assert(closedRequests >= 5, `all stalled upstream requests should close, observed ${closedRequests}`)
    console.log('PASS  timed-out and cancelled upstream requests release their connections')

    const mcpServer = createPortalServer()
    mcpServer.tool('__test_cancel_portal_fetch', {}, async () => {
      await portalFetchStream(`${baseUrl}/mcp-cancel-stall`, {}, { timeout: 5_000, retries: 0 })
      return { content: [{ type: 'text' as const, text: 'unexpected success' }] }
    })
    mcpServer.tool('__test_cancel_no_args', async () => {
      await portalFetchStream(`${baseUrl}/mcp-no-args-cancel-stall`, {}, { timeout: 5_000, retries: 0 })
      return { content: [{ type: 'text' as const, text: 'unexpected success' }] }
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'fetch-reliability-test', version: '1.0.0' })
    await mcpServer.connect(serverTransport)
    await client.connect(clientTransport)
    const mcpCancellation = new AbortController()
    const closedBeforeMcpCancellation = closedRequests
    setTimeout(() => mcpCancellation.abort(), 50)

    try {
      await expectFastFailure(
        'MCP handler propagates client cancellation to Portal fetches',
        () =>
          client.callTool({ name: '__test_cancel_portal_fetch', arguments: {} }, undefined, {
            signal: mcpCancellation.signal,
            timeout: 2_000,
          }),
        (error) =>
          assert(
            error instanceof Error && (error.name === 'AbortError' || /abort|cancel/i.test(error.message)),
            `expected client cancellation error, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
          ),
        750,
      )

      const cancellationDeadline = Date.now() + 750
      while (closedRequests <= closedBeforeMcpCancellation && Date.now() < cancellationDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert(closedRequests > closedBeforeMcpCancellation, 'MCP cancellation should close the upstream request')

      const noArgsCancellation = new AbortController()
      setTimeout(() => noArgsCancellation.abort(), 50)
      await expectFastFailure(
        'no-argument MCP tools also propagate client cancellation',
        () =>
          client.callTool({ name: '__test_cancel_no_args', arguments: {} }, undefined, {
            signal: noArgsCancellation.signal,
            timeout: 2_000,
          }),
        (error) =>
          assert(
            error instanceof Error && (error.name === 'AbortError' || /abort|cancel/i.test(error.message)),
            'expected no-argument tool cancellation error',
          ),
        750,
      )

      const toolMetrics = await toolCallsTotal.get()
      assert(
        toolMetrics.values.some(
          (value) =>
            value.labels.tool === '__test_cancel_portal_fetch' &&
            value.labels.status === 'cancelled' &&
            value.value === 1,
        ),
        'MCP cancellation should be counted separately from tool errors',
      )
      const errorMetrics = await toolErrorsTotal.get()
      assert(
        !errorMetrics.values.some((value) => String(value.labels.tool).startsWith('__test_cancel')),
        'MCP cancellations should not increment tool error counters',
      )
      console.log('PASS  MCP cancellations are classified separately from tool errors')
    } finally {
      await client.close()
      await mcpServer.close()
    }
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

main().catch((error) => {
  console.error(`Fetch reliability QA failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
