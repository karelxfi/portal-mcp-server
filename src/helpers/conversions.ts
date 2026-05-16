/**
 * Conversion utilities for blockchain data
 */

// ============================================================================
// Hex to Decimal Conversions
// ============================================================================

/**
 * Convert hex string to decimal string
 * Handles large numbers that exceed JavaScript's Number.MAX_SAFE_INTEGER
 */
export function hexToDecimal(hex: string): string {
  if (!hex || hex === '0x' || hex === '0x0') {
    return '0'
  }

  // Remove 0x prefix
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex

  // Use BigInt for large numbers
  try {
    return BigInt('0x' + cleanHex).toString()
  } catch (e) {
    // Fallback for invalid hex
    return '0'
  }
}

/**
 * Format token value with decimals
 * @param hexValue - Hex value from blockchain
 * @param decimals - Token decimals (e.g., 18 for ETH, 6 for USDC)
 * @param symbol - Token symbol for formatting (optional)
 */
export function formatTokenValue(
  hexValue: string,
  decimals: number = 18,
  symbol?: string,
): {
  raw: string
  decimal: string
  formatted: string
} {
  const decimal = hexToDecimal(hexValue)
  const bigIntValue = BigInt(decimal)
  const divisor = BigInt(10) ** BigInt(decimals)

  // Calculate integer and fractional parts
  const integerPart = bigIntValue / divisor
  const fractionalPart = bigIntValue % divisor

  // Format with proper decimal places
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
  const trimmedFractional = fractionalStr.replace(/0+$/, '') // Remove trailing zeros

  let formatted: string
  if (trimmedFractional.length > 0) {
    // Show up to 6 decimal places for readability
    const displayDecimals = Math.min(trimmedFractional.length, 6)
    formatted = `${integerPart}.${trimmedFractional.slice(0, displayDecimals)}`
  } else {
    formatted = integerPart.toString()
  }

  if (symbol) {
    formatted += ` ${symbol}`
  }

  return {
    raw: hexValue,
    decimal,
    formatted,
  }
}

/**
 * Format gas amount (always 18 decimals for ETH/native token)
 */
export function formatGasAmount(hexValue: string): {
  raw: string
  decimal: string
  formatted_eth: string
  formatted_gwei: string
} {
  const decimal = hexToDecimal(hexValue)
  const bigIntValue = BigInt(decimal)

  // ETH (18 decimals)
  const ethDivisor = BigInt(10) ** BigInt(18)
  const ethValue = Number(bigIntValue) / Number(ethDivisor)

  // Gwei (9 decimals)
  const gweiDivisor = BigInt(10) ** BigInt(9)
  const gweiValue = Number(bigIntValue) / Number(gweiDivisor)

  return {
    raw: hexValue,
    decimal,
    formatted_eth: `${ethValue.toFixed(6)} ETH`,
    formatted_gwei: `${gweiValue.toFixed(2)} Gwei`,
  }
}

/**
 * Add decimal conversions to a value object
 * Detects common value fields and adds conversions
 */
export function addValueConversions<T extends Record<string, unknown>>(
  obj: T,
  options: {
    tokenDecimals?: number
    tokenSymbol?: string
  } = {},
): T & {
  value_decimal?: string
  value_formatted?: string
  gas_decimal?: string
  gas_formatted?: string
} {
  const result = { ...obj }

  // Convert 'value' field (token transfers, transaction values)
  if (typeof obj.value === 'string' && obj.value.startsWith('0x')) {
    const converted = formatTokenValue(obj.value, options.tokenDecimals, options.tokenSymbol)
    return {
      ...result,
      value_decimal: converted.decimal,
      value_formatted: converted.formatted,
    }
  }

  // Convert 'gas' field
  if (typeof obj.gas === 'string' && obj.gas.startsWith('0x')) {
    const converted = formatGasAmount(obj.gas)
    return {
      ...result,
      gas_decimal: converted.decimal,
      gas_formatted: converted.formatted_gwei,
    }
  }

  return result
}
