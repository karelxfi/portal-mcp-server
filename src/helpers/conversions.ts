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

/**
 * Detect common ERC20 tokens and return their decimals
 */
type KnownTokenMetadata = {
  symbol: string
  decimals: number
}

const KNOWN_TOKEN_METADATA: Record<string, KnownTokenMetadata> = {
  // USDC
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 }, // Ethereum
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 }, // Base
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', decimals: 6 }, // Arbitrum
  // USDT
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6 }, // Ethereum
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { symbol: 'USDT', decimals: 6 }, // Arbitrum
  // DAI
  '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18 }, // Ethereum
  // WETH
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18 }, // Ethereum
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 }, // Base / OP-style
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { symbol: 'WETH', decimals: 18 }, // Arbitrum
  // Base active long-tail pools used by the OHLC visual QA harness
  '0x9126236476efba9ad8ab77855c60eb5bf37586eb': { symbol: 'CHECK', decimals: 18 },
  // WBTC
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { symbol: 'WBTC', decimals: 8 }, // Ethereum
  // Liquid staking majors
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { symbol: 'stETH', decimals: 18 }, // Ethereum
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': { symbol: 'wstETH', decimals: 18 }, // Ethereum
  '0xae78736cd615f374d3085123a210448e74fc6393': { symbol: 'rETH', decimals: 18 }, // Ethereum
}

export function getKnownTokenMetadata(tokenAddress: string): KnownTokenMetadata | undefined {
  return KNOWN_TOKEN_METADATA[tokenAddress.toLowerCase()]
}

export function getKnownTokenDecimals(tokenAddress: string): number | undefined {
  return getKnownTokenMetadata(tokenAddress)?.decimals
}

export function getKnownTokenSymbol(tokenAddress: string): string | undefined {
  return getKnownTokenMetadata(tokenAddress)?.symbol
}

/**
 * Well-known Uniswap v3 pool → token0/token1 address map.
 *
 * Auto-resolves token metadata when callers pass a pool address without
 * token addresses. Unlocks human-readable OHLC prices without requiring
 * every tool invocation to pass `token0_decimals` / `token1_decimals`.
 *
 * Only the most-traded pools are seeded here. Addresses stored lower-case.
 */
type KnownPoolMetadata = {
  token0: string
  token1: string
  /** Human-readable label used in UI/summary copy. */
  label?: string
}

const KNOWN_POOL_METADATA: Record<string, KnownPoolMetadata> = {
  // Ethereum — Uniswap v3
  '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640': {
    token0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    label: 'USDC/WETH 0.05%',
  },
  '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8': {
    token0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    label: 'USDC/WETH 0.30%',
  },
  '0x11b815efb8f581194ae79006d24e0d814b7697f6': {
    token0: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    token1: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    label: 'WETH/USDT 0.05%',
  },
  '0x4e68ccd3e89f51c3074ca5072bbac773960dfa36': {
    token0: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    token1: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    label: 'WETH/USDT 0.30%',
  },
  '0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8': {
    token0: '0x6b175474e89094c44da98b954eedeac495271d0f',
    token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    label: 'DAI/WETH 0.30%',
  },
  '0x99ac8ca7087fa4a2a1fb6357269965a2014abc35': {
    token0: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    token1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    label: 'WBTC/USDC 0.30%',
  },
  '0xcbcdf9626bc03e24f779434178a73a0b4bad62ed': {
    token0: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    label: 'WBTC/WETH 0.30%',
  },
  // Base — Uniswap v3 / Aerodrome Slipstream
  '0xd0b53d9277642d899df5c87a3966a349a798f224': {
    token0: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    token1: '0x4200000000000000000000000000000000000006',
    label: 'USDC/WETH 0.05%',
  },
  '0x3c4384f3664b37a3cb5a5cb3452b4b4a3aa1256f': {
    token0: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    token1: '0x9126236476efba9ad8ab77855c60eb5bf37586eb',
    label: 'USDC/CHECK 0.01%',
  },
  '0x10648ba41b8565907cfa1496765fa4d95390aa0d': {
    token0: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
    token1: '0x4200000000000000000000000000000000000006',
    label: 'cbBTC/WETH 0.05%',
  },
}

export function getKnownPoolMetadata(poolAddress: string): KnownPoolMetadata | undefined {
  return KNOWN_POOL_METADATA[poolAddress.toLowerCase()]
}
