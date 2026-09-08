import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ActionableError } from '../../helpers/errors.js'
import { MAX_SERIES_SCAN_BLOCKS, assertSeriesDurationScannable, assertSeriesWindowScannable } from './time-series.js'

/*
 * Bound series scans by block count because the same duration spans different
 * amounts of data on different networks.
 */
const window = (dataset: string, chainType: string, blocks: number, duration: string) =>
  assertSeriesWindowScannable({ dataset, chainType, fromBlock: 1, toBlock: blocks, duration })

describe('a series window that cannot be read is refused, not attempted', () => {
  it('lets a window at the ceiling through', () => {
    window('base-mainnet', 'evm', MAX_SERIES_SCAN_BLOCKS, '6h')
  })

  it('refuses one block past it', () => {
    assert.throws(() => window('base-mainnet', 'evm', MAX_SERIES_SCAN_BLOCKS + 1, '6h'), ActionableError)
  })

  it('refuses the seven-day window that used to hang, and says why', () => {
    assert.throws(
      () => window('base-mainnet', 'evm', 302_400, '7d'),
      (error: unknown) => {
        assert.ok(error instanceof ActionableError)
        assert.match(error.message, /302,400 blocks on base-mainnet/)
        assert.match(error.message, /reads every block in the window/)
        assert.equal(error.code, 'unsupported_operation')
        assert.equal(error.origin, 'client_input')
        assert.equal(error.retryable, false, 'retrying the same request cannot help')
        return true
      },
    )
  })

  it('names a duration that would actually fit on this chain', () => {
    assert.throws(
      () => window('base-mainnet', 'evm', 302_400, '7d'),
      (error: unknown) => {
        assert.ok(error instanceof ActionableError)
        /* Base is 2s a block, so 12,000 blocks is under seven hours: the
           suggestion has to be 6h or smaller, never the window just refused. */
        const suggested = error.suggestions[0]
        assert.match(suggested, /duration '(15m|30m|1h|3h|6h)'/, `unusable suggestion: ${suggested}`)
        assert.doesNotMatch(suggested, /'7d'/)
        return true
      },
    )
  })

  it('carries the numbers a caller needs to pick a smaller window', () => {
    assert.throws(
      () => window('base-mainnet', 'evm', 302_400, '7d'),
      (error: unknown) => {
        assert.ok(error instanceof ActionableError)
        assert.equal(error.context?.requested_blocks, 302_400)
        assert.equal(error.context?.max_scan_blocks, MAX_SERIES_SCAN_BLOCKS)
        assert.equal(error.context?.requested_duration, '7d')
        return true
      },
    )
  })

  it('is a limit on blocks, not on time: the same window passes on a slow chain', () => {
    /* Seven days is 302,400 blocks on Base and about 1,008 on Bitcoin. */
    window('bitcoin-mainnet', 'bitcoin', 1_008, '7d')
    assert.throws(() => window('base-mainnet', 'evm', 302_400, '7d'), ActionableError)
  })

  it('lets a 24h Ethereum window through and stops a 24h Base one', () => {
    window('ethereum-mainnet', 'evm', 7_200, '24h')
    assert.throws(() => window('base-mainnet', 'evm', 43_200, '24h'), ActionableError)
  })
})

/*
 * Reject clearly oversized durations before timestamp lookups. Use the exact
 * block count when the estimate is close to the limit.
 */
describe('assertSeriesDurationScannable', () => {
  it('refuses a window far over the bound before any lookup, and says the count is an estimate', () => {
    assert.throws(
      () => assertSeriesDurationScannable({ dataset: 'base-mainnet', chainType: 'evm', duration: '7d' }),
      (error: any) =>
        error instanceof ActionableError &&
        /about 302,400 blocks on base-mainnet by its typical block time/.test(error.message) &&
        error.context?.requested_blocks_estimated === true,
    )
  })

  it('leaves a window under the bound, and a borderline one, to the exact check', () => {
    assert.doesNotThrow(() =>
      assertSeriesDurationScannable({ dataset: 'ethereum-mainnet', chainType: 'evm', duration: '24h' }),
    )
    assert.doesNotThrow(() =>
      assertSeriesDurationScannable({ dataset: 'bitcoin-mainnet', chainType: 'bitcoin', duration: '30d' }),
    )
    // 16,200 blocks by estimate: over the bound, but under the margin the estimate is trusted for.
    assert.doesNotThrow(() =>
      assertSeriesDurationScannable({ dataset: 'ethereum-mainnet', chainType: 'evm', duration: '54h' }),
    )
  })

  it('does not refuse what it cannot parse; the exact check will see it', () => {
    assert.doesNotThrow(() =>
      assertSeriesDurationScannable({ dataset: 'base-mainnet', chainType: 'evm', duration: 'whenever' }),
    )
  })
})
