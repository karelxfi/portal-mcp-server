#!/usr/bin/env tsx

import { Buffer } from 'node:buffer'

import { ActionableError, parsePortalError, sanitizeErrorContext, sanitizeText } from '../src/helpers/errors.ts'
import { encodeCursor } from '../src/helpers/pagination.ts'
import { parseNumericAmount } from '../src/tools/convenience/wallet-summary.ts'
import {
  assert,
  assertErrorQuality,
  callToolWithRetry,
  closeTestClient,
  connectTestClient,
  printSection,
} from './test-helpers.ts'

type NegativeCase = {
  name: string
  tool: string
  args: Record<string, unknown>
  expectedCode?: string
  expect: (text: string) => void
}

const TAMPERED_CURSOR = tamperCursorPayload(
  encodeCursor({
    tool: 'portal_get_recent_activity',
    dataset: 'base-mainnet',
    request: { limit: 5 },
    window_from_block: 1,
    window_to_block: 100,
    page_to_block: 100,
    skip_inclusive_block: 1,
  }),
)

const CASES: NegativeCase[] = [
  {
    name: 'Unknown network alias',
    tool: 'portal_get_head',
    args: { network: 'definitely-not-a-real-network-xyz' },
    expect: (text) => {
      assert(/Unknown network/i.test(text), 'Unknown network should mention unknown network')
      assert(/portal_list_networks/i.test(text), 'Unknown network should suggest portal_list_networks')
    },
  },
  {
    name: 'Unsupported Substrate recent activity',
    tool: 'portal_get_recent_activity',
    args: { network: 'polkadot', timeframe: '1h', limit: 5 },
    expect: (text) => {
      assert(/does not support network 'polkadot'/i.test(text), 'Unsupported flow should mention polkadot clearly')
      assert(/supported chain types/i.test(text), 'Unsupported flow should explain supported chain types')
    },
  },
  {
    name: 'Unsupported Tron EVM query',
    tool: 'portal_evm_query_logs',
    args: { network: 'tron-mainnet', from_block: 1, to_block: 2, limit: 1 },
    expect: (text) => {
      assert(/does not support network 'tron-mainnet'/i.test(text), 'Unsupported flow should mention Tron clearly')
      assert(/Tron network/i.test(text), 'Unsupported flow should identify the native Tron query family')
    },
  },
  ...['portal_get_recent_activity', 'portal_get_time_series', 'portal_get_wallet_summary'].map((tool) => ({
    name: `Unsupported Tron ${tool}`,
    tool,
    expectedCode: 'unsupported_operation',
    args:
      tool === 'portal_get_time_series'
        ? { network: 'tron-mainnet', metric: 'transaction_count', duration: '1h', interval: '5m' }
        : tool === 'portal_get_wallet_summary'
          ? { network: 'tron-mainnet', address: 'TExampleAddress', timeframe: '1h' }
          : { network: 'tron-mainnet', timeframe: '1h', limit: 5 },
    expect: (text: string) => {
      assert(/does not support network 'tron-mainnet'/i.test(text), `${tool} should identify unsupported Tron input`)
      assert(/Tron network/i.test(text), `${tool} should identify the native Tron query family`)
      assert(!/malformed_request/i.test(text), `${tool} should not leak an upstream malformed request`)
    },
  })),
  {
    name: 'Conflicting compare/group args',
    tool: 'portal_get_time_series',
    args: { network: 'base', metric: 'transaction_count', duration: '1h', interval: '5m', compare_previous: true, group_by: 'contract' },
    expect: (text) => {
      assert(/compare_previous and group_by="contract" cannot be used together/i.test(text), 'Invalid combo should explain the conflict')
    },
  },
  {
    name: 'Missing OHLC pool address',
    tool: 'portal_evm_get_ohlc',
    args: { network: 'base', source: 'uniswap_v3_swap', duration: '1h', interval: '5m' },
    expect: (text) => {
      assert(/pool_address is required/i.test(text), 'Missing OHLC pool should mention pool_address')
    },
  },
  {
    name: 'Invalid pagination cursor',
    tool: 'portal_get_recent_activity',
    args: { cursor: 'definitely-not-a-valid-cursor' },
    expect: (text) => {
      assert(/Invalid pagination cursor/i.test(text), 'Invalid cursor should be called out clearly')
    },
  },
  {
    name: 'Tampered pagination cursor',
    tool: 'portal_get_recent_activity',
    args: { cursor: TAMPERED_CURSOR },
    expect: (text) => {
      assert(/Invalid pagination cursor/i.test(text), 'Tampered cursor should be rejected clearly')
    },
  },
]

function tamperCursorPayload(cursor: string): string {
  const [payload, signature] = cursor.split('.')
  assert(Boolean(payload && signature), 'Generated cursor should be signed')
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  parsed.dataset = 'ethereum-mainnet'
  const tamperedPayload = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url')
  return `${tamperedPayload}.${signature}`
}

function assertNoSecretText(text: string, label: string) {
  for (const secret of [
    'super-secret',
    'bad-bearer',
    'nested-secret',
    'header-secret',
    'body-secret',
    'access-secret',
    'message-secret',
    'message-bearer',
    'tip-secret',
  ]) {
    assert(!text.includes(secret), `${label} should not expose ${secret}`)
  }
}

function runRedactionAssertions() {
  const sensitiveContext = {
    url: 'https://portal.sqd.dev/datasets/base-mainnet/stream?api_key=super-secret&limit=10',
    authorization: 'Bearer bad-bearer',
    headers: {
      Authorization: 'Bearer nested-secret',
      'x-api-key': 'header-secret',
    },
    query: {
      type: 'evm',
      fromBlock: 1,
      toBlock: 2,
      logs: [{ address: ['0xabc'], topics: ['0xdef'] }],
      fields: { logs: { address: true, data: true } },
      api_key: 'body-secret',
      access_token: 'access-secret',
    },
  }

  const actionable = new ActionableError(
    'Request failed for https://example.test/path?token=message-secret with Authorization: Bearer message-bearer',
    ['Retry without token=tip-secret'],
    sensitiveContext,
  )
  assertNoSecretText(actionable.message, 'ActionableError message')
  assert(actionable.message.includes('https://portal.sqd.dev/datasets/base-mainnet/stream'), 'Sanitized context should keep URL path')
  assert(!actionable.message.includes('?api_key='), 'Sanitized context should remove URL query strings')
  assert(actionable.message.includes('"logs_count":1'), 'Sanitized context should summarize query array counts')
  assert(!actionable.message.includes('0xabc'), 'Sanitized context should not embed full query JSON')

  const parsed = parsePortalError(
    400,
    'invalid api_key=body-secret for https://portal.sqd.dev/datasets/base-mainnet/stream?token=super-secret',
    sensitiveContext,
  )
  assertNoSecretText(parsed.message, 'parsePortalError message')

  const sanitizedContext = sanitizeErrorContext(sensitiveContext)
  assert(sanitizedContext?.authorization === '[REDACTED]', 'Authorization context should be redacted')
  assert(JSON.stringify(sanitizedContext?.query).includes('"logs_count":1'), 'Query context should be summarized')

  const sanitizedUserQuery = sanitizeText(
    'show https://example.test/path?access_token=access-secret with Authorization: Bearer message-bearer',
  )
  assertNoSecretText(sanitizedUserQuery, 'sanitizeText')
  assert(!sanitizedUserQuery.includes('?access_token='), 'sanitizeText should remove URL query strings')

  console.log('PASS  Error context and telemetry text redaction')
}

function runNumericParsingAssertions() {
  assert(parseNumericAmount('1,234.56') === 1234.56, 'Comma-formatted native amounts should parse')
  assert(parseNumericAmount('0.00000001') === 0.00000001, 'Small native amounts should parse')
  assert(parseNumericAmount('not-a-number') === 0, 'Invalid numeric strings should be zeroed')

  console.log('PASS  Wallet fund-flow numeric parsing')
}

async function main() {
  runRedactionAssertions()
  runNumericParsingAssertions()

  const connected = await connectTestClient('negative-test')
  const { client } = connected

  try {
    let passed = 0
    let failed = 0

    printSection('Negative-path quality tests')

    for (const testCase of CASES) {
      try {
        const result = await callToolWithRetry(client, testCase.tool, testCase.args, { parseJson: false })
        assert(result.isError, `${testCase.name} should return an error`)
        const error = result.structuredContent?.error as Record<string, unknown> | undefined
        assert(typeof error?.code === 'string' && error.code.length > 0, `${testCase.name} should expose an error code`)
        if (testCase.expectedCode) {
          assert(error.code === testCase.expectedCode, `${testCase.name} should return ${testCase.expectedCode}`)
        }
        assert(
          ['client_input', 'upstream', 'server', 'transport'].includes(String(error?.origin)),
          `${testCase.name} should expose a bounded error origin`,
        )
        assert(typeof error?.retryable === 'boolean', `${testCase.name} should say whether retry is safe`)
        assert(Array.isArray(error?.suggestions), `${testCase.name} should expose structured suggestions`)
        const qualityText = [error?.summary, ...(error?.suggestions as unknown[])].join('\n')
        assertErrorQuality(qualityText, testCase.name)
        testCase.expect(qualityText)
        console.log(`PASS  ${testCase.name}`)
        passed++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(`FAIL  ${testCase.name}`)
        console.log(`      ${message.slice(0, 320)}`)
        failed++
      }
    }

    printSection(`Negative-path results: ${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
