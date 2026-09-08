import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { pickDataset } from './datasets.js'

/*
 * Resolve exact network names and aliases without substring substitutions.
 * In particular, `opbnb` must not resolve to Optimism through the alias `op`.
 */
const DATASETS = [
  'ethereum-mainnet',
  'ethereum-sepolia',
  'optimism-mainnet',
  'opbnb-mainnet',
  'base-mainnet',
  'base-sepolia',
  'bitcoin-mainnet',
  'solana-mainnet',
  'binance-mainnet',
  'arbitrum-one',
  'moonbeam-substrate',
  'worldchain-mainnet',
  'hyperliquid-mainnet',
  'polkadot',
].map((dataset) => ({ dataset, aliases: [] as string[] }))

const pick = (name: string) => pickDataset(name, DATASETS)

describe('a name never resolves to a different chain', () => {
  it('sends opbnb to opBNB, not to Optimism', () => {
    assert.equal(pick('opbnb'), 'opbnb-mainnet')
    assert.equal(pick('opbnb-mainnet'), 'opbnb-mainnet')
    assert.equal(pick('op'), 'optimism-mainnet')
  })

  it('refuses a testnet it does not have instead of answering with mainnet', () => {
    for (const name of ['ethereum-holesky', 'btc-testnet', 'solana-devnet', 'bitcoin-testnet']) {
      assert.equal(pick(name), undefined, `${name} must not resolve to a mainnet`)
    }
  })

  it('refuses an empty or blank name, which used to match every alias', () => {
    assert.equal(pick(''), undefined)
    assert.equal(pick('   '), undefined)
  })

  it('does not let one chain name swallow another that contains it', () => {
    assert.equal(pick('binance'), 'binance-mainnet')
    assert.equal(pick('bnb'), 'binance-mainnet')
    assert.equal(pick('world'), 'worldchain-mainnet')
    assert.equal(pick('hyper'), 'hyperliquid-mainnet')
  })
})

describe('the names people do use still work', () => {
  it('takes exact dataset names', () => {
    assert.equal(pick('base-mainnet'), 'base-mainnet')
    assert.equal(pick('BASE-MAINNET'), 'base-mainnet')
    assert.equal(pick('polkadot'), 'polkadot')
  })

  it('takes the short nicknames', () => {
    assert.equal(pick('eth'), 'ethereum-mainnet')
    assert.equal(pick('ethereum'), 'ethereum-mainnet')
    assert.equal(pick('btc'), 'bitcoin-mainnet')
    assert.equal(pick('sol'), 'solana-mainnet')
    assert.equal(pick('arb'), 'arbitrum-one')
  })

  it('completes a bare chain name to its mainnet', () => {
    assert.equal(pick('base'), 'base-mainnet')
    assert.equal(pick('worldchain'), 'worldchain-mainnet')
  })

  it('still finds a real testnet the Portal actually carries', () => {
    assert.equal(pick('ethereum-sepolia'), 'ethereum-sepolia')
    assert.equal(pick('base-sepolia'), 'base-sepolia')
  })

  it('prefers a declared alias over any guess', () => {
    const withAlias = [{ dataset: 'some-chain-mainnet', aliases: ['nickname'] }]
    assert.equal(pickDataset('nickname', withAlias), 'some-chain-mainnet')
  })

  it('prefers mainnet when a suffix match is ambiguous', () => {
    assert.equal(pick('substrate'), 'moonbeam-substrate')
    assert.equal(pick('sepolia'), 'ethereum-sepolia')
  })
})
