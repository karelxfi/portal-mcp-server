export type ExactDecimal = {
  coefficient: bigint
  scale: number
}

export const EXACT_DECIMAL_ZERO: ExactDecimal = { coefficient: 0n, scale: 0 }
const MAX_EXACT_DECIMAL_DIGITS = 4_096

function safeScale(value: number): number {
  const scale = Math.max(0, Math.trunc(value))
  if (!Number.isSafeInteger(scale) || scale > MAX_EXACT_DECIMAL_DIGITS) {
    throw new RangeError(`Exact decimal scale must be between 0 and ${MAX_EXACT_DECIMAL_DIGITS}`)
  }
  return scale
}

function normalize(value: ExactDecimal): ExactDecimal {
  let coefficient = value.coefficient
  let scale = safeScale(value.scale)
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n
    scale -= 1
  }
  return { coefficient, scale }
}

export function parseExactDecimal(value: unknown): ExactDecimal | undefined {
  if (typeof value === 'bigint') return { coefficient: value, scale: 0 }
  if (typeof value !== 'string' && typeof value !== 'number') return undefined

  const source = String(value).trim()
  if (!source) return undefined
  if (source.length > MAX_EXACT_DECIMAL_DIGITS) return undefined
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(source)
  if (!match) return undefined

  const sign = match[1] === '-' ? -1n : 1n
  const whole = match[2] ?? '0'
  const fraction = match[3] ?? match[4] ?? ''
  const exponent = Number(match[5] ?? 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_EXACT_DECIMAL_DIGITS) return undefined

  let coefficient = BigInt(`${whole}${fraction}` || '0') * sign
  let scale = fraction.length - exponent
  if (scale > MAX_EXACT_DECIMAL_DIGITS) return undefined
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale)
    scale = 0
  }
  return normalize({ coefficient, scale })
}

export function formatExactDecimal(value: ExactDecimal): string {
  const normalized = normalize(value)
  const sign = normalized.coefficient < 0n ? '-' : ''
  const magnitude = normalized.coefficient < 0n ? -normalized.coefficient : normalized.coefficient
  if (normalized.scale === 0) return `${sign}${magnitude}`

  const digits = magnitude.toString().padStart(normalized.scale + 1, '0')
  const split = digits.length - normalized.scale
  return `${sign}${digits.slice(0, split)}.${digits.slice(split)}`
}

export function addExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale)
  const leftCoefficient = left.coefficient * 10n ** BigInt(scale - left.scale)
  const rightCoefficient = right.coefficient * 10n ** BigInt(scale - right.scale)
  return normalize({ coefficient: leftCoefficient + rightCoefficient, scale })
}

export function multiplyExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return normalize({ coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale })
}

export function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): number {
  const scale = Math.max(left.scale, right.scale)
  const leftCoefficient = left.coefficient * 10n ** BigInt(scale - left.scale)
  const rightCoefficient = right.coefficient * 10n ** BigInt(scale - right.scale)
  return leftCoefficient < rightCoefficient ? -1 : leftCoefficient > rightCoefficient ? 1 : 0
}

export function formatIntegerUnitsExact(value: bigint, decimals: number): string {
  return formatExactDecimal({ coefficient: value, scale: safeScale(decimals) })
}

/**
 * Decimal division cannot always terminate. This returns a deterministic,
 * truncated decimal and reports whether any remainder was discarded.
 */
export function divideExactDecimals(
  numerator: ExactDecimal,
  denominator: ExactDecimal,
  precision = 18,
): { value: string | null; rounded: boolean } {
  if (denominator.coefficient === 0n) return { value: null, rounded: false }
  const safePrecision = safeScale(precision)
  const negative = numerator.coefficient < 0n !== denominator.coefficient < 0n
  const numeratorMagnitude = numerator.coefficient < 0n ? -numerator.coefficient : numerator.coefficient
  const denominatorMagnitude = denominator.coefficient < 0n ? -denominator.coefficient : denominator.coefficient
  const scaledNumerator = numeratorMagnitude * 10n ** BigInt(denominator.scale + safePrecision)
  const scaledDenominator = denominatorMagnitude * 10n ** BigInt(numerator.scale)
  const quotient = scaledNumerator / scaledDenominator
  const remainder = scaledNumerator % scaledDenominator
  return {
    value: formatExactDecimal({ coefficient: negative ? -quotient : quotient, scale: safePrecision }),
    rounded: remainder !== 0n,
  }
}
