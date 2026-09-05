import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  isValidBitcoinAddress,
  isValidEvmAddress,
  isValidHyperliquidAddress,
  isValidSolanaAddress,
  isValidTronAddress,
  normalizeAddresses,
  normalizeBitcoinAddressForPortal,
  normalizeEvmAddress,
} from './validation.js'

describe('address validation', () => {
  it('accepts well-formed EVM and Hyperliquid addresses and rejects the rest', () => {
    assert.equal(isValidEvmAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), true)
    assert.equal(isValidHyperliquidAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'), true)
    assert.equal(isValidEvmAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA0291'), false)
    assert.equal(isValidEvmAddress('833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), false)
  })

  it('checks Solana keys by base58 decoding to 32 bytes', () => {
    assert.equal(isValidSolanaAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), true)
    assert.equal(isValidSolanaAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5D0'), false)
    assert.equal(isValidSolanaAddress('11111111111111111111111111111111'), true)
    assert.equal(isValidSolanaAddress('tooshort'), false)
  })

  it('accepts legacy, script-hash, and bech32 Bitcoin forms', () => {
    assert.equal(isValidBitcoinAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'), true)
    assert.equal(isValidBitcoinAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'), true)
    assert.equal(isValidBitcoinAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), true)
    assert.equal(isValidBitcoinAddress('bc1qbad'), false)
    assert.equal(isValidBitcoinAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), false)
    assert.equal(
      normalizeBitcoinAddressForPortal('BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ'),
      'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    )
    assert.equal(
      normalizeBitcoinAddressForPortal('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'),
      '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    )
  })

  it('accepts Tron base58 and hex forms only', () => {
    assert.equal(isValidTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), true)
    assert.equal(isValidTronAddress('41a614f803b6fd780986a42c78ec9c7f77e6ded13c'), true)
    assert.equal(isValidTronAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), false)
  })
})

describe('address normalisation', () => {
  it('lowercases EVM addresses and adds the prefix', () => {
    assert.equal(
      normalizeEvmAddress('833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    )
    assert.deepEqual(normalizeAddresses(['0xABC0000000000000000000000000000000000001'], 'evm'), [
      '0xabc0000000000000000000000000000000000001',
    ])
    assert.equal(normalizeAddresses([], 'evm'), undefined)
    assert.equal(normalizeAddresses(undefined, 'evm'), undefined)
  })
})
