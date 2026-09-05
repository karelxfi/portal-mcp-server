import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assertHyperliquidDataset, normalizeHyperliquidAddresses } from './dataset-guard.js'

/*
 * 'hyperliquid-mainnet' is HyperEVM, an EVM chain the resolver happily
 * returns, and it reached the fills tools as a dataset to stream from. The
 * Portal then failed the request as malformed, which told the caller nothing
 * about what was wrong. The same tools sent a user filter that was not an
 * address to the Portal as written and answered with a complete, empty
 * window, which reads as "this user never traded".
 */
describe('Hyperliquid tools take Hyperliquid datasets and addresses only', () => {
  it('accepts the dataset kind the tool reads', () => {
    assert.doesNotThrow(() =>
      assertHyperliquidDataset('portal_hyperliquid_query_fills', 'hyperliquid-fills', 'hyperliquidFills'),
    )
    assert.doesNotThrow(() =>
      assertHyperliquidDataset(
        'portal_debug_hyperliquid_query_replica_commands',
        'hyperliquid-replica-cmds',
        'hyperliquidReplicaCmds',
      ),
    )
  })

  it('refuses HyperEVM with the unsupported-chain error and points at the right tools', () => {
    assert.throws(
      () => assertHyperliquidDataset('portal_hyperliquid_query_fills', 'hyperliquid-mainnet', 'hyperliquidFills'),
      (error: any) =>
        /does not support network 'hyperliquid-mainnet'/.test(error.message) &&
        error.suggestions.some((line: string) => /HyperEVM/.test(line)),
    )
  })

  it('refuses the other Hyperliquid dataset kind too', () => {
    assert.throws(() =>
      assertHyperliquidDataset('portal_hyperliquid_get_ohlc', 'hyperliquid-replica-cmds', 'hyperliquidFills'),
    )
  })

  it('lowercases valid addresses and rejects anything else before the Portal sees it', () => {
    assert.deepEqual(normalizeHyperliquidAddresses(['0xAbC0000000000000000000000000000000000001']), [
      '0xabc0000000000000000000000000000000000001',
    ])
    assert.equal(normalizeHyperliquidAddresses(undefined), undefined)
    assert.throws(
      () => normalizeHyperliquidAddresses(['not-an-addr']),
      (error: any) => error.code === 'invalid_request' && /Invalid address format: not-an-addr/.test(error.message),
    )
  })
})
