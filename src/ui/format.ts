export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function getByPath(value: unknown, path?: string): unknown {
  if (!path) return value
  const tokens = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)

  let current: unknown = value
  for (const token of tokens) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[token]
  }
  return current
}

export function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function formatTimestamp(value: unknown): string {
  const numeric = toNumber(value)
  if (numeric === null) return String(value ?? '')
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000
  return new Date(millis).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
}

export function formatTimestampShort(value: unknown): string {
  const numeric = toNumber(value)
  if (numeric === null) return String(value ?? '')
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000
  return new Date(millis).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function appendUnit(value: string, unit?: string): string {
  return unit ? `${value} ${unit}` : value
}

function fractionDigitsFor(value: number): { minimumFractionDigits?: number; maximumFractionDigits: number } {
  const abs = Math.abs(value)
  if (abs === 0) return { maximumFractionDigits: 0 }
  if (abs >= 1000) return { maximumFractionDigits: 0 }
  if (abs >= 100) return { maximumFractionDigits: 1 }
  if (abs >= 1) return { maximumFractionDigits: 2 }
  if (abs >= 0.1) return { maximumFractionDigits: 4 }
  if (abs >= 0.01) return { maximumFractionDigits: 6 }
  if (abs >= 0.0001) return { maximumFractionDigits: 8 }
  return { maximumFractionDigits: 10 }
}

function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
    ...options,
  }).format(value)
}

function formatScientific(value: number, maximumFractionDigits = 2): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  return value
    .toExponential(maximumFractionDigits)
    .replace(/\.?0+e/, 'e')
    .replace('e+', 'e')
}

function formatEvmTransactionType(value: number): string {
  switch (value) {
    case 0:
      return 'Legacy (0)'
    case 1:
      return 'EIP-2930 (1)'
    case 2:
      return 'EIP-1559 (2)'
    case 3:
      return 'Blob (3)'
    default:
      return `Type ${formatNumber(value, { maximumFractionDigits: 0 })}`
  }
}

function formatEvmStatus(value: number): string {
  if (value === 1) return 'Success'
  if (value === 0) return 'Reverted'
  return formatNumber(value, { maximumFractionDigits: 0 })
}

function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `$${formatNumber(value / 1_000_000_000, { maximumFractionDigits: 1 })}B`
  if (abs >= 1_000_000) return `$${formatNumber(value / 1_000_000, { maximumFractionDigits: 1 })}M`
  if (abs >= 100_000) return `$${formatNumber(value / 1_000, { maximumFractionDigits: 0 })}K`
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    ...fractionDigitsFor(value),
  }).format(value)
}

export function formatAxisValue(value: unknown, format?: string, unit?: string): string {
  const numeric = toNumber(value)
  if (numeric === null) return formatValue(value, format, unit)

  switch (format) {
    case 'currency_usd':
      return formatCompactCurrency(numeric)
    case 'percent':
      return `${formatNumber(numeric, { maximumFractionDigits: Math.abs(numeric) >= 10 ? 1 : 2 })}%`
    case 'integer':
      if (Math.abs(numeric) >= 100_000) return formatValue(numeric, 'compact_number')
      return formatValue(numeric, 'integer')
    case 'compact_number':
      return formatValue(numeric, 'compact_number')
    case 'scientific':
      return appendUnit(formatScientific(numeric), unit)
    case 'gwei':
      return `${formatNumber(numeric, fractionDigitsFor(numeric))}gwei`
    case 'bytes':
      return formatValue(numeric, 'bytes')
    case 'btc':
      return `${formatNumber(numeric, { maximumFractionDigits: 4 })} BTC`
    case 'decimal':
    default:
      if (Math.abs(numeric) >= 100_000) return formatValue(numeric, 'compact_number', unit)
      return formatValue(numeric, format, unit)
  }
}

export function formatValue(value: unknown, format?: string, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—'

  if (format === 'timestamp_human') {
    return typeof value === 'string' ? value : formatTimestamp(value)
  }
  if (format === 'timestamp') {
    return formatTimestamp(value)
  }
  if (format === 'address' && typeof value === 'string') {
    return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
  }
  if (typeof value === 'string' && /^0x[0-9a-f]{20,}$/i.test(value)) {
    return `${value.slice(0, 8)}…${value.slice(-6)}`
  }

  const numeric = toNumber(value)
  if (numeric !== null) {
    switch (format) {
      case 'integer':
        return appendUnit(formatNumber(Math.round(numeric), { maximumFractionDigits: 0 }), unit)
      case 'percent':
        return `${formatNumber(numeric, { maximumFractionDigits: Math.abs(numeric) >= 10 ? 1 : 2 })}%`
      case 'currency_usd':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          ...fractionDigitsFor(numeric),
        }).format(numeric)
      case 'gwei':
        return `${formatNumber(numeric, fractionDigitsFor(numeric))} gwei`
      case 'bytes':
        return formatBytes(numeric)
      case 'btc':
        return `${formatNumber(numeric, { maximumFractionDigits: 8 })} BTC`
      case 'evm_tx_type':
        return formatEvmTransactionType(Math.round(numeric))
      case 'evm_status':
        return formatEvmStatus(Math.round(numeric))
      case 'compact_number':
        return appendUnit(new Intl.NumberFormat('en-US', {
          notation: 'compact',
          maximumFractionDigits: Math.abs(numeric) >= 10_000 ? 1 : 2,
        }).format(numeric), unit)
      case 'scientific':
        return appendUnit(formatScientific(numeric), unit)
      case 'decimal':
      default:
        return appendUnit(formatNumber(numeric, fractionDigitsFor(numeric)), unit)
    }
  }

  if (typeof value === 'string') return value
  return stringifyCellValue(value)
}

export function humanize(value: unknown): string {
  return String(value ?? '')
    .replace(/^portal_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\bmainnet\b/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (['evm', 'btc', 'usd', 'ohlc', 'tps'].includes(lower)) return lower.toUpperCase()
      if (/^0x[0-9a-f]+$/i.test(part)) return part
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

export function compareValues(left: unknown, right: unknown, direction: 'asc' | 'desc'): number {
  const multiplier = direction === 'desc' ? -1 : 1
  const leftNumeric = toNumber(left)
  const rightNumeric = toNumber(right)
  if (leftNumeric !== null && rightNumeric !== null) {
    return (leftNumeric - rightNumeric) * multiplier
  }
  return String(left ?? '').localeCompare(String(right ?? '')) * multiplier
}
