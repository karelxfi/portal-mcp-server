#!/usr/bin/env tsx

/* Scan-order truth gate. A page that says has_more must carry the cursor it
   promises, _coverage.continuation must say the same thing as _pagination, an
   oldest-first page must describe itself as oldest-first, and following the
   cursor must produce later rows with no row repeated. Live only: the defect
   this gate holds lived in the interplay of scan, cursor, coverage and prose
   across four tools, which no unit test reaches. Upstream overload is a
   bounded outcome and never counted as a pass. */

import {
  type ConnectedTestClient,
  callToolWithRetry,
  closeTestClient,
  connectTestClient,
  isBoundedUpstreamToolError,
} from './test-helpers.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type Payload = Record<string, any>

const NETWORK = 'base-mainnet'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const CALL_OPTIONS = { requestTimeoutMs: 120_000, totalBudgetMs: 240_000 }

class BoundedOutcome extends Error {}

async function call(connected: ConnectedTestClient, tool: string, args: Record<string, unknown>): Promise<Payload> {
  const result = await callToolWithRetry(connected.client, tool, args, CALL_OPTIONS)
  if (result.isError && isBoundedUpstreamToolError(result)) {
    throw new BoundedOutcome(`${tool}: upstream overload (${result.text.slice(0, 120)})`)
  }
  assert(!result.isError, `${tool} must succeed: ${result.text.slice(0, 300)}`)
  return (result.data ?? {}) as Payload
}

/* One notice is emitted as `_notice`; several as `_notices`. */
function noticesOf(payload: Payload): string[] {
  return [
    ...(Array.isArray(payload._notices) ? payload._notices : []),
    ...(typeof payload._notice === 'string' ? [payload._notice] : []),
  ]
}

function hasCursor(payload: Payload): boolean {
  const cursor = payload._pagination?.next_cursor
  return typeof cursor === 'string' && cursor.length > 0
}

/* The three blocks and the prose must tell one story about continuation. */
function assertContractAgreement(label: string, payload: Payload) {
  const pagination = payload._pagination ?? {}
  const coverage = payload._coverage ?? {}
  const cursor = hasCursor(payload)
  assert(
    pagination.has_more === cursor,
    `${label}: has_more must equal cursor presence (has_more=${pagination.has_more}, cursor=${cursor})`,
  )
  assert(
    coverage.continuation === (cursor ? 'cursor' : 'none'),
    `${label}: _coverage.continuation '${coverage.continuation}' disagrees with cursor presence ${cursor}`,
  )
  if (cursor) assert(coverage.result_complete === false, `${label}: a page with a cursor cannot be result_complete`)
  const answer = String(payload.answer ?? '')
  /* result_complete is about pagination and window_complete about coverage, so
     an unread window has to be said out loud rather than folded into the other
     field. */
  if (coverage.window_complete === false) {
    assert(
      /\b(partial|incomplete|coverage|only\b.*\brequested|searched only)\b/i.test(answer),
      `${label}: window_complete is false but the answer does not disclose it: ${answer}`,
    )
  }
  const notices = noticesOf(payload)
  if (!cursor) {
    assert(
      !/continue with the cursor|next_cursor/i.test(answer),
      `${label}: the answer offers a cursor the page lacks: ${answer}`,
    )
    assert(
      !notices.some((notice) => /next_cursor|page forward/i.test(notice)),
      `${label}: a notice offers a cursor the page lacks: ${JSON.stringify(notices)}`,
    )
  }
}

function assertOldestFirstPage(label: string, payload: Payload) {
  const ordering = payload._ordering ?? {}
  assert(
    ordering.window_focus === 'oldest_matches',
    `${label}: window_focus must be oldest_matches, got ${ordering.window_focus}`,
  )
  assert(
    ordering.continuation === 'newer',
    `${label}: ordering continuation must be newer, got ${ordering.continuation}`,
  )
  const answer = String(payload.answer ?? '')
  assert(!/\bnewest\b/i.test(answer), `${label}: an oldest-first answer describes the newest blocks: ${answer}`)
  const notices = noticesOf(payload)
  assert(
    !notices.some((notice) => /^Older results are available/.test(notice)),
    `${label}: an oldest-first page offers older results`,
  )
  if (hasCursor(payload)) {
    assert(
      notices.some((notice) => /^Newer results are available/.test(notice)),
      `${label}: a forward cursor must be announced as newer results: ${JSON.stringify(notices)}`,
    )
  }
}

function assertNewestFirstPage(label: string, payload: Payload) {
  const ordering = payload._ordering ?? {}
  assert(
    ordering.window_focus === 'most_recent_matches',
    `${label}: window_focus must be most_recent_matches, got ${ordering.window_focus}`,
  )
  assert(
    ordering.continuation === 'older',
    `${label}: ordering continuation must be older, got ${ordering.continuation}`,
  )
}

function rowsOf(payload: Payload): Payload[] {
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.length > 0 && value.every((row) => row && typeof row.block_number === 'number')) {
      return value as Payload[]
    }
  }
  return []
}

/* Every row type carries a stable identity: a primary_id where the tool
   builds one, otherwise the transaction hash plus whatever distinguishes the
   row inside its transaction. */
function identityOf(row: Payload): string {
  if (typeof row.primary_id === 'string') return row.primary_id
  const hash = String(row.transaction_hash ?? row.hash ?? '')
  const within = [
    row.log_index ?? row.logIndex,
    Array.isArray(row.trace_address) ? row.trace_address.join('.') : undefined,
  ]
    .filter((part) => part !== undefined)
    .join('/')
  return `${row.block_number}:${hash}:${within}`
}

function assertBlocksNonDecreasing(label: string, rows: Payload[]) {
  for (let position = 1; position < rows.length; position += 1) {
    assert(
      rows[position - 1].block_number <= rows[position].block_number,
      `${label}: rows must be in block order at position ${position}`,
    )
  }
}

async function checkForwardScan(connected: ConnectedTestClient, tool: string, args: Record<string, unknown>) {
  const label = `${tool} earliest`
  const first = await call(connected, tool, { network: NETWORK, ...args, scan_order: 'earliest', limit: 3 })
  assertContractAgreement(label, first)
  assertOldestFirstPage(label, first)
  const firstRows = rowsOf(first)
  assert(firstRows.length > 0, `${label}: the window must hold rows for the gate to mean anything`)
  assertBlocksNonDecreasing(label, firstRows)
  assert(
    first._coverage?.returned_from_block === firstRows[0].block_number,
    `${label}: returned_from_block must be the first row's block`,
  )

  if (!hasCursor(first)) {
    console.log(`PASS  ${label}: one page, no cursor, and the blocks agree`)
    return
  }
  const second = await call(connected, tool, { cursor: first._pagination.next_cursor })
  const secondLabel = `${label} page 2`
  assertContractAgreement(secondLabel, second)
  assertOldestFirstPage(secondLabel, second)
  const secondRows = rowsOf(second)
  assert(secondRows.length > 0, `${secondLabel}: a cursor that was promised must lead to rows`)
  assertBlocksNonDecreasing(secondLabel, secondRows)
  const lastOfFirst = firstRows[firstRows.length - 1]
  assert(
    lastOfFirst.block_number <= secondRows[0].block_number,
    `${secondLabel}: page 2 must not start before page 1 ended (${lastOfFirst.block_number} vs ${secondRows[0].block_number})`,
  )
  const seen = new Set(firstRows.map(identityOf))
  const repeated = secondRows.map(identityOf).filter((identity) => seen.has(identity))
  assert(repeated.length === 0, `${secondLabel}: page 2 repeats rows of page 1: ${repeated.join(', ')}`)
  assert(
    second._coverage?.window_from_block === first._coverage?.window_from_block &&
      second._coverage?.window_to_block === first._coverage?.window_to_block,
    `${secondLabel}: the cursor must stay inside the window it was minted for`,
  )
  console.log(`PASS  ${label}: two pages in order, no row repeated, contract blocks agree`)
}

async function checkBackwardScan(connected: ConnectedTestClient, tool: string, args: Record<string, unknown>) {
  const label = `${tool} latest`
  const page = await call(connected, tool, { network: NETWORK, ...args, scan_order: 'latest', limit: 3 })
  assertContractAgreement(label, page)
  assertNewestFirstPage(label, page)
  console.log(`PASS  ${label}: contract blocks agree`)
}

async function checkCappedLookup(connected: ConnectedTestClient) {
  const label = 'portal_evm_get_contract_deployment capped'
  const page = await call(connected, 'portal_evm_get_contract_deployment', {
    network: NETWORK,
    contract_address: USDC,
    max_scan_blocks: 200,
  })
  assertContractAgreement(label, page)
  assert(page._pagination?.has_more === false, `${label}: a capped lookup has no next page`)
  assert(page._coverage?.window_complete === false, `${label}: a capped lookup did not read its window`)
  assert(
    /Partial window/.test(String(page.answer ?? '')),
    `${label}: the answer must say the window was partial: ${page.answer}`,
  )
  console.log(`PASS  ${label}: a capped miss says so without offering a cursor`)
}

async function main() {
  const connected = await connectTestClient('scan-order-gate')
  try {
    await checkForwardScan(connected, 'portal_evm_query_transactions', { timeframe: '5m' })
    await checkForwardScan(connected, 'portal_evm_query_logs', { timeframe: '10m', addresses: [USDC] })
    await checkForwardScan(connected, 'portal_evm_query_token_transfers', { timeframe: '10m', token_addresses: [USDC] })
    await checkForwardScan(connected, 'portal_evm_query_traces', { timeframe: '10m' })
    await checkBackwardScan(connected, 'portal_evm_query_logs', { timeframe: '10m', addresses: [USDC] })
    await checkBackwardScan(connected, 'portal_evm_query_traces', { timeframe: '10m' })
    await checkCappedLookup(connected)
    console.log('PASS  scan-order truth gate')
  } catch (error) {
    if (error instanceof BoundedOutcome) {
      console.log(`BOUNDED  scan-order truth gate was not proven this run: ${error.message}`)
      return
    }
    throw error
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
})
