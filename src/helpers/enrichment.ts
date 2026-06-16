import { getTokenMetadataMapForDataset } from './entity-resolution.js'

/**
 * Value Enrichment Helpers
 *
 * Converts hex values to human-readable amounts using token decimals.
 * Solves: "Every transfer returns raw value: '0x2386f26fc10000'"
 */

interface TokenInfo {
  symbol?: string
  decimals?: number
  name?: string
}

/**
 * Convert hex value to human-readable decimal string
 */
export function hexToDecimal(hex: string, decimals: number = 18): string {
  if (!hex || hex === '0x' || hex === '0x0') {
    return '0'
  }

  // Remove 0x prefix
  const hexValue = hex.startsWith('0x') ? hex.slice(2) : hex

  // Convert to BigInt
  let value: bigint
  try {
    value = BigInt('0x' + hexValue)
  } catch {
    return hex // Return original if conversion fails
  }

  if (decimals === 0) {
    return value.toString()
  }

  // Split into integer and decimal parts
  const divisor = BigInt(10 ** decimals)
  const integerPart = value / divisor
  const remainder = value % divisor

  if (remainder === BigInt(0)) {
    return integerPart.toString()
  }

  // Format decimal part with leading zeros
  const decimalPart = remainder.toString().padStart(decimals, '0')
  // Trim trailing zeros
  const trimmed = decimalPart.replace(/0+$/, '')

  return trimmed ? `${integerPart}.${trimmed}` : integerPart.toString()
}

/**
 * Format value with token symbol (e.g., "1000.5 USDC")
 */
export function formatTokenAmount(hex: string, tokenInfo?: TokenInfo): string {
  if (!tokenInfo) {
    return hex // Return raw if no token info
  }

  const decimals = tokenInfo.decimals ?? 18
  const amount = hexToDecimal(hex, decimals)
  const symbol = tokenInfo.symbol || 'tokens'

  return `${amount} ${symbol}`
}

/**
 * Enrich transfer object with human-readable amount
 */
export function enrichTransfer(transfer: any, tokenInfo?: TokenInfo): any {
  if (!transfer.value) {
    return transfer
  }

  return {
    ...transfer,
    value_raw: transfer.value, // Keep original
    value_formatted: formatTokenAmount(transfer.value, tokenInfo),
    value_decimal: hexToDecimal(transfer.value, tokenInfo?.decimals),
  }
}

/**
 * Enrich array of transfers
 */
export function enrichTransfers(transfers: any[], tokenInfoMap?: Map<string, TokenInfo>): any[] {
  if (!tokenInfoMap) {
    return transfers
  }

  return transfers.map((transfer) => {
    const tokenAddr = transfer.address?.toLowerCase()
    const tokenInfo = tokenAddr ? tokenInfoMap.get(tokenAddr) : undefined
    return enrichTransfer(transfer, tokenInfo)
  })
}

/**
 * Fetch token info from Portal API
 */
export async function fetchTokenInfo(dataset: string, addresses: string[]): Promise<Map<string, TokenInfo>> {
  const tokenMap = new Map<string, TokenInfo>()
  const tokenListMetadata = await getTokenMetadataMapForDataset(dataset).catch(() => new Map<string, TokenInfo>())

  for (const addr of addresses) {
    const normalized = addr.toLowerCase()
    const tokenInfo = tokenListMetadata.get(normalized)
    if (tokenInfo) {
      tokenMap.set(normalized, {
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        name: tokenInfo.name,
      })
    } else {
      tokenMap.set(normalized, { decimals: 18 })
    }
  }

  return tokenMap
}

/**
 * Smart formatting for different value ranges
 */
export function formatCompactAmount(hex: string, decimals: number = 18, symbol?: string): string {
  const decimal = hexToDecimal(hex, decimals)
  const num = parseFloat(decimal)

  let formatted: string
  if (num >= 1_000_000_000) {
    formatted = (num / 1_000_000_000).toFixed(2) + 'B'
  } else if (num >= 1_000_000) {
    formatted = (num / 1_000_000).toFixed(2) + 'M'
  } else if (num >= 1_000) {
    formatted = (num / 1_000).toFixed(2) + 'K'
  } else if (num >= 1) {
    formatted = num.toFixed(2)
  } else if (num > 0) {
    formatted = num.toFixed(6).replace(/\.?0+$/, '')
  } else {
    formatted = '0'
  }

  return symbol ? `${formatted} ${symbol}` : formatted
}
