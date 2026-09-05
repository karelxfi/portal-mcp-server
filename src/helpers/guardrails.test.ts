import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { register } from '../metrics.js'
import { scanBoundedBlockRange } from './bounded-search.js'
import { ActionableError } from './errors.js'
import {
  type GuardrailSettings,
  applyGuardrail,
  assertWindowWithinGuardrail,
  envVariableName,
  guardrailStatus,
  readGuardrailSettings,
  resetGuardrailSettingsForTest,
  runWithGuardrailScope,
} from './guardrails.js'

const RAW_QUERY = { tool: 'portal_evm_query_logs', workClass: 'raw_query' as const }

function settings(mode: GuardrailSettings['mode'], raw: Partial<Record<string, number>> = {}): GuardrailSettings {
  return {
    mode,
    limits: {
      lookup: {},
      raw_query: raw,
      summary: {},
      analytics: {},
    },
  }
}

async function counterValue(name: string, labels: Record<string, string>): Promise<number> {
  const metrics = await register.getMetricsAsJSON()
  const metric = metrics.find((entry) => entry.name === name)
  const match = metric?.values.find((value) =>
    Object.entries(labels).every(([key, expected]) => value.labels[key] === expected),
  )
  return match?.value ?? 0
}

/** A scan that never touches the network, so the clamp is the only variable. */
async function scan(maxScanBlocks: number) {
  const fetched: Array<{ fromBlock: number; toBlock: number }> = []
  const result = await scanBoundedBlockRange<number>({
    fromBlock: 1,
    toBlock: 10_000,
    chunkSize: 100,
    scanOrder: 'latest',
    maxScanBlocks,
    fetchChunk: async (chunk) => {
      fetched.push({ fromBlock: chunk.fromBlock, toBlock: chunk.toBlock })
      return []
    },
  })
  return { result, fetched }
}

afterEach(() => resetGuardrailSettingsForTest())

describe('guardrail settings', () => {
  it('is off with nothing configured, and nothing is configured', () => {
    const read = readGuardrailSettings({})
    assert.equal(read.mode, 'off')
    for (const workClass of ['lookup', 'raw_query', 'summary', 'analytics'] as const) {
      assert.deepEqual(read.limits[workClass], {}, `${workClass} should start with no ceiling`)
    }
  })

  it('names its environment variables the way the README says', () => {
    assert.equal(envVariableName('raw_query', 'max_scan_blocks'), 'MCP_GUARDRAIL_RAW_QUERY_MAX_SCAN_BLOCKS')
    assert.equal(envVariableName('analytics', 'max_window_seconds'), 'MCP_GUARDRAIL_ANALYTICS_MAX_WINDOW_SECONDS')
  })

  it('ignores a mode it does not know rather than guessing at one', () => {
    assert.equal(readGuardrailSettings({ MCP_GUARDRAIL_MODE: 'ENFORCE ' }).mode, 'enforce')
    assert.equal(readGuardrailSettings({ MCP_GUARDRAIL_MODE: 'strict' }).mode, 'off')
    assert.equal(readGuardrailSettings({ MCP_GUARDRAIL_MODE: '' }).mode, 'off')
  })

  it('refuses a limit that does not parse instead of capping at zero', () => {
    const read = readGuardrailSettings({
      MCP_GUARDRAIL_MODE: 'enforce',
      MCP_GUARDRAIL_RAW_QUERY_MAX_SCAN_BLOCKS: 'lots',
      MCP_GUARDRAIL_SUMMARY_MAX_SCAN_BLOCKS: '0',
      MCP_GUARDRAIL_ANALYTICS_MAX_SCAN_BLOCKS: '-5',
    })
    assert.equal(read.limits.raw_query.max_scan_blocks, undefined)
    assert.equal(read.limits.summary.max_scan_blocks, undefined)
    assert.equal(read.limits.analytics.max_scan_blocks, undefined)
  })

  it('reports what is configured without inventing defaults', () => {
    resetGuardrailSettingsForTest(settings('shadow', { max_scan_blocks: 500 }))
    assert.deepEqual(guardrailStatus(), {
      mode: 'shadow',
      configured: [{ class: 'raw_query', limit: 'max_scan_blocks', value: 500 }],
    })
  })
})

describe('guardrail modes', () => {
  it('leaves the request alone when it is off, whatever is configured', () => {
    resetGuardrailSettingsForTest(settings('off', { max_scan_blocks: 10 }))
    const outcome = runWithGuardrailScope(RAW_QUERY, () => applyGuardrail('max_scan_blocks', 9_000))
    assert.deepEqual(outcome, { value: 9_000, wouldBlock: false, blocked: false })
  })

  it('counts in shadow mode but does not change the request', async () => {
    resetGuardrailSettingsForTest(settings('shadow', { max_scan_blocks: 500 }))
    const before = await counterValue('mcp_guardrail_would_block_total', {
      class: 'raw_query',
      limit: 'max_scan_blocks',
    })
    const outcome = runWithGuardrailScope(RAW_QUERY, () => applyGuardrail('max_scan_blocks', 9_000))
    assert.equal(outcome.value, 9_000, 'shadow mode must not narrow the request')
    assert.equal(outcome.wouldBlock, true)
    assert.equal(outcome.blocked, false)
    assert.equal(
      await counterValue('mcp_guardrail_would_block_total', { class: 'raw_query', limit: 'max_scan_blocks' }),
      before + 1,
    )
  })

  it('clamps to the ceiling in enforce mode and counts it', async () => {
    resetGuardrailSettingsForTest(settings('enforce', { max_scan_blocks: 500 }))
    const before = await counterValue('mcp_guardrail_blocked_total', { class: 'raw_query', limit: 'max_scan_blocks' })
    const outcome = runWithGuardrailScope(RAW_QUERY, () => applyGuardrail('max_scan_blocks', 9_000))
    assert.equal(outcome.value, 500)
    assert.equal(outcome.blocked, true)
    assert.equal(
      await counterValue('mcp_guardrail_blocked_total', { class: 'raw_query', limit: 'max_scan_blocks' }),
      before + 1,
    )
  })

  it('leaves a class nobody configured alone, even in enforce', () => {
    resetGuardrailSettingsForTest(settings('enforce', { max_scan_blocks: 500 }))
    const outcome = runWithGuardrailScope({ tool: 'portal_get_head', workClass: 'lookup' }, () =>
      applyGuardrail('max_scan_blocks', 9_000),
    )
    assert.equal(outcome.value, 9_000)
    assert.equal(outcome.blocked, false)
  })

  it('does nothing outside a tool call, where there is no class to look up', () => {
    resetGuardrailSettingsForTest(settings('enforce', { max_scan_blocks: 1 }))
    assert.equal(applyGuardrail('max_scan_blocks', 9_000).value, 9_000)
  })
})

describe('window ceiling', () => {
  it('refuses an over-cap window before anything is fetched, and names the cap', () => {
    resetGuardrailSettingsForTest(settings('enforce', { max_window_seconds: 3_600 }))
    assert.throws(
      () => runWithGuardrailScope(RAW_QUERY, () => assertWindowWithinGuardrail(86_400)),
      (error: unknown) => {
        assert.ok(error instanceof ActionableError)
        assert.match(error.message, /caps a raw_query query window at 1h/)
        assert.match(error.message, /asked for 1d/)
        assert.equal(error.code, 'unsupported_operation', 'an operator cap is not an internal error')
        assert.equal(error.origin, 'client_input')
        assert.equal(error.retryable, false)
        return true
      },
    )
  })

  it('lets a window inside the cap through', () => {
    resetGuardrailSettingsForTest(settings('enforce', { max_window_seconds: 3_600 }))
    runWithGuardrailScope(RAW_QUERY, () => assertWindowWithinGuardrail(1_800))
  })

  it('does not refuse in shadow mode', () => {
    resetGuardrailSettingsForTest(settings('shadow', { max_window_seconds: 3_600 }))
    runWithGuardrailScope(RAW_QUERY, () => assertWindowWithinGuardrail(86_400))
  })
})

describe('a capped scan stays honest', () => {
  it('scans the whole window when nothing is configured', async () => {
    resetGuardrailSettingsForTest(settings('off'))
    const { result } = await runWithGuardrailScope(RAW_QUERY, () => scan(10_000))
    assert.equal(result.scannedBlocks, 10_000)
    assert.equal(result.reachedMaxScanBlocks, false)
    assert.equal(result.hasUnscannedBlocks, false)
  })

  it('stops at the ceiling and reports the window it did not cover', async () => {
    resetGuardrailSettingsForTest(settings('enforce', { max_scan_blocks: 300 }))
    const { result, fetched } = await runWithGuardrailScope(RAW_QUERY, () => scan(10_000))
    assert.equal(result.scannedBlocks, 300, 'the scan must stop at the ceiling')
    assert.equal(result.reachedMaxScanBlocks, true)
    assert.equal(result.hasUnscannedBlocks, true, 'this is what drives _coverage.result_complete to false')
    assert.equal(result.requestedToBlock, 10_000, 'the request it could not finish is still reported')
    assert.ok(fetched.length <= 3, `a capped scan must not keep fetching: ${fetched.length} chunks`)
  })

  it('does not narrow the scan in shadow mode', async () => {
    resetGuardrailSettingsForTest(settings('shadow', { max_scan_blocks: 300 }))
    const { result } = await runWithGuardrailScope(RAW_QUERY, () => scan(10_000))
    assert.equal(result.scannedBlocks, 10_000)
    assert.equal(result.hasUnscannedBlocks, false)
  })
})
