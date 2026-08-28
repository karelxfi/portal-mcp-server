import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'

import { ActionableError } from './errors.js'

const CURSOR_VERSION = 1
// Production deployments should set MCP_CURSOR_SECRET. The fallback is
// deterministic only so local dev/tests can continue cursors across restarts.
const LOCAL_DEV_CURSOR_SECRET = 'sqd-portal-mcp-local-dev-cursor-secret-v1'

type CursorPayload = {
  version?: number
  tool?: unknown
  [key: string]: unknown
}

export interface PaginationInfo {
  [key: string]: unknown
  type: 'cursor'
  page_size: number
  returned: number
  has_more: boolean
  next_cursor?: string
  continuation_scope?: 'remaining_results' | 'adjacent_window'
}

export interface BlockBoundaryCursor {
  page_to_block: number
  skip_inclusive_block: number
}

export interface RecentPageCursor<TRequest extends Record<string, unknown>> extends BlockBoundaryCursor {
  [key: string]: unknown
  tool: string
  dataset: string
  request: TRequest
  window_from_block: number
  window_to_block: number
}

export interface OffsetPageCursor<TRequest extends Record<string, unknown>> {
  [key: string]: unknown
  tool: string
  dataset: string
  request: TRequest
  offset: number
}

function getCursorSecret(): string {
  const configured = process.env.MCP_CURSOR_SECRET?.trim()
  return configured || LOCAL_DEV_CURSOR_SECRET
}

function signCursorPayload(payload: string): string {
  return createHmac('sha256', getCursorSecret()).update(payload).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function assertCursorObject(value: unknown): asserts value is CursorPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cursor payload must be an object')
  }
}

function assertStringField(payload: Record<string, unknown>, key: string): void {
  if (typeof payload[key] !== 'string' || String(payload[key]).length === 0) {
    throw new Error(`Cursor field '${key}' must be a non-empty string`)
  }
}

function assertRecordField(payload: Record<string, unknown>, key: string): void {
  const value = payload[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Cursor field '${key}' must be an object`)
  }
}

function assertIntegerField(payload: Record<string, unknown>, key: string, min: number): void {
  const value = payload[key]
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    throw new Error(`Cursor field '${key}' must be a safe integer >= ${min}`)
  }
}

function decodeSignedCursorPayload(cursor: string): string {
  const parts = cursor.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Cursor is unsigned or malformed')
  }

  const [payload, signature] = parts
  const expectedSignature = signCursorPayload(payload)
  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('Cursor signature is invalid')
  }

  return payload
}

function validateBaseCursorPayload(parsed: CursorPayload, expectedTool: string): void {
  if (parsed.version !== CURSOR_VERSION) {
    throw new Error(`Unsupported cursor version: ${String(parsed.version)}`)
  }

  if (typeof parsed.tool !== 'string') {
    throw new Error("Cursor field 'tool' must be a string")
  }

  if (parsed.tool !== expectedTool) {
    throw new Error(`Cursor is for ${String(parsed.tool ?? 'another tool')}, not ${expectedTool}`)
  }
}

function validateRecentPageCursorPayload(payload: Record<string, unknown>): void {
  assertStringField(payload, 'dataset')
  assertRecordField(payload, 'request')
  assertIntegerField(payload, 'window_from_block', 0)
  assertIntegerField(payload, 'window_to_block', 0)
  assertIntegerField(payload, 'page_to_block', 0)
  assertIntegerField(payload, 'skip_inclusive_block', 0)

  if ((payload.window_from_block as number) > (payload.window_to_block as number)) {
    throw new Error("Cursor field 'window_from_block' must be <= 'window_to_block'")
  }
}

function validateOffsetPageCursorPayload(payload: Record<string, unknown>): void {
  assertStringField(payload, 'dataset')
  assertRecordField(payload, 'request')
  assertIntegerField(payload, 'offset', 0)
}

export function encodeCursor(payload: Record<string, unknown>): string {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      version: CURSOR_VERSION,
      ...payload,
    }),
    'utf8',
  ).toString('base64url')

  return `${encodedPayload}.${signCursorPayload(encodedPayload)}`
}

export function decodeCursor<T extends CursorPayload>(cursor: string, expectedTool: string): T {
  try {
    const encodedPayload = decodeSignedCursorPayload(cursor)
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as T
    assertCursorObject(parsed)
    validateBaseCursorPayload(parsed, expectedTool)

    return parsed
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ActionableError('Invalid pagination cursor.', [
      'Use the exact next_cursor value from the previous response.',
      'Do not edit or truncate the cursor string.',
      'Start a fresh query without cursor if you want a new preview window.',
    ], { expected_tool: expectedTool, detail })
  }
}

export function trimBoundaryItemsFromEnd<T>(
  items: T[],
  cursor: BlockBoundaryCursor | undefined,
  getBlockNumber: (item: T) => number | undefined,
): T[] {
  if (!cursor || cursor.skip_inclusive_block <= 0) {
    return items.slice()
  }

  const trimmed = items.slice()
  let remainingToSkip = cursor.skip_inclusive_block

  while (remainingToSkip > 0 && trimmed.length > 0) {
    const lastItem = trimmed[trimmed.length - 1]
    if (getBlockNumber(lastItem) !== cursor.page_to_block) {
      break
    }
    trimmed.pop()
    remainingToSkip--
  }

  return trimmed
}

export function buildNextBoundaryCursor<T>(
  pageItems: T[],
  getBlockNumber: (item: T) => number | undefined,
): BlockBoundaryCursor | undefined {
  if (pageItems.length === 0) {
    return undefined
  }

  const boundaryBlock = getBlockNumber(pageItems[0])
  if (boundaryBlock === undefined) {
    return undefined
  }

  const skip_inclusive_block = pageItems.filter((item) => getBlockNumber(item) === boundaryBlock).length
  if (skip_inclusive_block <= 0) {
    return undefined
  }

  return {
    page_to_block: boundaryBlock,
    skip_inclusive_block,
  }
}

export function paginateAscendingItems<T>(
  items: T[],
  limit: number,
  getBlockNumber: (item: T) => number | undefined,
  cursor?: BlockBoundaryCursor,
): {
  pageItems: T[]
  hasMore: boolean
  nextBoundary?: BlockBoundaryCursor
} {
  const remainingItems = trimBoundaryItemsFromEnd(items, cursor, getBlockNumber)
  const hasMore = remainingItems.length > limit
  const pageItems = remainingItems.slice(Math.max(0, remainingItems.length - limit))

  return {
    pageItems,
    hasMore,
    nextBoundary: hasMore ? buildNextBoundaryCursor(pageItems, getBlockNumber) : undefined,
  }
}

export function buildPaginationInfo(
  pageSize: number,
  returned: number,
  nextCursor?: string,
  options?: { continuationScope?: 'remaining_results' | 'adjacent_window' },
): PaginationInfo {
  return {
    type: 'cursor',
    page_size: pageSize,
    returned,
    has_more: Boolean(nextCursor),
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
    ...(nextCursor ? { continuation_scope: options?.continuationScope ?? 'remaining_results' } : {}),
  }
}

export function decodeRecentPageCursor<TRequest extends Record<string, unknown>>(
  cursor: string,
  expectedTool: string,
): RecentPageCursor<TRequest> {
  const decoded = decodeCursor<RecentPageCursor<TRequest>>(cursor, expectedTool)
  validateRecentPageCursorPayload(decoded)
  return decoded
}

export function encodeRecentPageCursor<TRequest extends Record<string, unknown>>(
  params: RecentPageCursor<TRequest>,
): string {
  return encodeCursor(params)
}

export function paginateOffsetItems<T>(
  items: T[],
  limit: number,
  offset: number = 0,
): {
  pageItems: T[]
  hasMore: boolean
  nextOffset?: number
} {
  const pageItems = items.slice(offset, offset + limit)
  const nextOffset = offset + pageItems.length
  return {
    pageItems,
    hasMore: nextOffset < items.length,
    ...(nextOffset < items.length ? { nextOffset } : {}),
  }
}

export function decodeOffsetPageCursor<TRequest extends Record<string, unknown>>(
  cursor: string,
  expectedTool: string,
): OffsetPageCursor<TRequest> {
  const decoded = decodeCursor<OffsetPageCursor<TRequest>>(cursor, expectedTool)
  validateOffsetPageCursorPayload(decoded)
  return decoded
}

export function encodeOffsetPageCursor<TRequest extends Record<string, unknown>>(
  params: OffsetPageCursor<TRequest>,
): string {
  return encodeCursor(params)
}
