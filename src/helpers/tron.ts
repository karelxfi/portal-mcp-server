// ============================================================================
// Tron identifiers: one address in four forms, bare hex, and SUN amounts
// ============================================================================
//
// Portal's native Tron dataset speaks bare hex. Transaction-level filters and
// fields carry the 21-byte form with a `41` prefix; log filters and log fields
// carry the 20-byte EVM-style form; topics carry the 32-byte padded form; users
// and explorers carry Base58Check (`T...`). Every input a tool accepts goes
// through here so the caller can pass any of the four and Portal always sees
// the one it expects. Timestamps on Tron records are Unix milliseconds and
// amounts are SUN (1 TRX = 1,000,000 SUN); both are converted here as well.

import { sha256 } from '@noble/hashes/sha256'

import { formatExactDecimal, parseExactDecimal } from './exact-decimal.js'
import { decodeBase58 } from './validation.js'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const TRON_ADDRESS_VERSION = 0x41
const SUN_PER_TRX = 1_000_000n

export type TronAddressForm = 'transaction' | 'log' | 'topic' | 'base58'

export class TronInputError extends Error {
  constructor(
    message: string,
    public readonly suggestions: string[],
  ) {
    super(message)
    this.name = 'TronInputError'
  }
}

export function stripHexPrefix(value: string): string {
  const trimmed = value.trim()
  return trimmed.toLowerCase().startsWith('0x') ? trimmed.slice(2) : trimmed
}

function isHex(value: string): boolean {
  return /^[0-9a-fA-F]*$/.test(value)
}

function encodeBase58(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  let encoded = ''
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded
    value /= 58n
  }
  let leadingZeros = 0
  for (const byte of bytes) {
    if (byte !== 0) break
    leadingZeros += 1
  }
  return '1'.repeat(leadingZeros) + encoded
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

/** Base58Check `T...` to the 21-byte `41...` hex form, or undefined when the checksum fails. */
export function tronBase58ToHex(address: string): string | undefined {
  const decoded = decodeBase58(address)
  if (!decoded || decoded.length !== 25 || decoded[0] !== TRON_ADDRESS_VERSION) return undefined
  const payload = decoded.slice(0, 21)
  const checksum = sha256(sha256(payload)).slice(0, 4)
  if (!checksum.every((byte, index) => byte === decoded[21 + index])) return undefined
  return bytesToHex(payload)
}

/** The 21-byte `41...` hex form to Base58Check `T...`. */
export function tronHexToBase58(hex41: string): string {
  const payload = hexToBytes(hex41.toLowerCase())
  const checksum = sha256(sha256(payload)).slice(0, 4)
  const full = new Uint8Array(25)
  full.set(payload, 0)
  full.set(checksum, 21)
  return encodeBase58(full)
}

/**
 * Parse any accepted address form into the canonical 21-byte `41...` hex.
 * Accepts Base58Check, `41` + 40 hex, `0x41` + 40 hex, bare 40 hex, and
 * `0x` + 40 hex. Anything else throws a TronInputError with the fix.
 */
export function parseTronAddress(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0)
    throw new TronInputError('Empty Tron address.', ['Provide a T... Base58 address or 41... hex.'])
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) {
    const hex = tronBase58ToHex(trimmed)
    if (!hex) {
      throw new TronInputError(`Invalid Tron address checksum: ${trimmed}`, [
        'Copy the Base58 address again from the wallet or explorer; one character is wrong.',
        'The 41-prefixed hex form is also accepted.',
      ])
    }
    return hex
  }
  const bare = stripHexPrefix(trimmed).toLowerCase()
  if (!isHex(bare)) {
    throw new TronInputError(`Invalid Tron address: ${trimmed}`, [
      'Use a Base58 address starting with T (34 characters), the 21-byte hex form starting with 41, or the 20-byte hex form.',
    ])
  }
  if (bare.length === 42 && bare.startsWith('41')) return bare
  if (bare.length === 40) return `41${bare}`
  throw new TronInputError(`Invalid Tron address length: ${trimmed}`, [
    'A Tron address is 34 Base58 characters, 42 hex characters starting with 41, or 40 hex characters (optionally 0x-prefixed).',
  ])
}

/** Convert any accepted form to the form Portal expects in a given position. */
export function normalizeTronAddress(input: string, form: TronAddressForm): string {
  const hex41 = parseTronAddress(input)
  switch (form) {
    case 'transaction':
      return hex41
    case 'log':
      return hex41.slice(2)
    case 'topic':
      return hex41.slice(2).padStart(64, '0')
    case 'base58':
      return tronHexToBase58(hex41)
    default:
      return hex41
  }
}

export function normalizeTronAddresses(values: string[] | undefined, form: TronAddressForm): string[] | undefined {
  if (!values || values.length === 0) return undefined
  return Array.from(new Set(values.map((value) => normalizeTronAddress(value, form))))
}

/** Display both hex and Base58 for a 21-byte or 20-byte address value from Portal. */
export function describeTronAddress(value: unknown): { hex: string; base58: string } | undefined {
  if (typeof value !== 'string') return undefined
  const bare = stripHexPrefix(value).toLowerCase()
  if (!isHex(bare)) return undefined
  const hex41 = bare.length === 42 && bare.startsWith('41') ? bare : bare.length === 40 ? `41${bare}` : undefined
  if (!hex41) return undefined
  return { hex: hex41, base58: tronHexToBase58(hex41) }
}

/** A 32-byte topic in bare hex; an address in any form is padded to a topic. */
export function normalizeTronTopic(value: string, label: string): string {
  const trimmed = value.trim()
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) return normalizeTronAddress(trimmed, 'topic')
  const bare = stripHexPrefix(trimmed).toLowerCase()
  if (!isHex(bare)) {
    throw new TronInputError(`Invalid ${label}: ${value}`, ['Topics are 32-byte hex values, with or without 0x.'])
  }
  if (bare.length === 64) return bare
  if (bare.length === 40 || (bare.length === 42 && bare.startsWith('41'))) return normalizeTronAddress(bare, 'topic')
  throw new TronInputError(`Invalid ${label} length: ${value}`, [
    'Use a 32-byte topic hash (64 hex characters) or an address, which is padded to a topic.',
  ])
}

/** Bare hex of a fixed byte length, accepting an optional 0x prefix. */
export function normalizeTronHex(value: string, bytes: number, label: string): string {
  const bare = stripHexPrefix(value).toLowerCase()
  if (!isHex(bare) || bare.length !== bytes * 2) {
    throw new TronInputError(`Invalid ${label}: ${value}`, [`Use ${bytes * 2} hex characters, with or without 0x.`])
  }
  return bare
}

/** Tron transaction and block timestamps are Unix milliseconds. */
export function tronMillisToSeconds(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined
  if (numeric === undefined || !Number.isFinite(numeric) || numeric <= 0) return undefined
  return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric)
}

/** SUN (integer) to an exact TRX decimal string. */
export function sunToTrx(value: unknown): string | undefined {
  const parsed = parseExactDecimal(value)
  if (!parsed) return undefined
  const text = formatExactDecimal(parsed)
  if (!/^-?\d+$/.test(text)) return undefined
  const negative = text.startsWith('-')
  const sun = BigInt(negative ? text.slice(1) : text)
  const whole = sun / SUN_PER_TRX
  const fraction = (sun % SUN_PER_TRX).toString().padStart(6, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/** Portal returns TRC-10 asset names and internal-transaction notes as hex-encoded ASCII. */
export function decodeTronHexText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length % 2 !== 0 || !isHex(value)) return undefined
  const text = Buffer.from(value, 'hex').toString('utf8')
  return /^[\x20-\x7e]+$/.test(text) ? text : undefined
}

/** Encode a TRC-10 asset id or name the way the Portal `asset` filter expects it. */
export function encodeTronAssetFilter(value: string): string {
  const trimmed = value.trim()
  // A TRC-10 id is a short decimal number; Portal wants the hex of its ASCII text.
  if (/^\d{1,10}$/.test(trimmed)) return Buffer.from(trimmed, 'utf8').toString('hex')
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) return trimmed.toLowerCase()
  return Buffer.from(trimmed, 'utf8').toString('hex')
}
