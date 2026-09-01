export function calculatePercentile(values: number[], percentile: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = values.slice().sort((a, b) => a - b)
  const clamped = Math.max(0, Math.min(100, percentile))
  const index = (clamped / 100) * (sorted.length - 1)
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lower = sorted[lowerIndex]
  const upper = sorted[upperIndex]

  if (lowerIndex === upperIndex) {
    return lower
  }

  if (Number.isInteger(clamped) && Number.isSafeInteger(lower) && Number.isSafeInteger(upper)) {
    const denominator = 100n
    const positionNumerator = BigInt(clamped) * BigInt(sorted.length - 1)
    const remainder = positionNumerator % denominator
    const exactNumerator = BigInt(lower) * denominator + BigInt(upper - lower) * remainder
    const sign = exactNumerator < 0n ? '-' : ''
    const absolute = exactNumerator < 0n ? -exactNumerator : exactNumerator
    const whole = absolute / denominator
    const fraction = (absolute % denominator).toString().padStart(2, '0').replace(/0+$/, '')
    return Number(fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`)
  }

  const weight = index - lowerIndex
  const interpolated = lower + (upper - lower) * weight
  return Number.parseFloat(interpolated.toPrecision(12))
}

export function buildPercentileSummary(values: number[], percentiles: number[] = [50, 95]): Record<string, number> | undefined {
  if (values.length === 0) return undefined

  const summary: Record<string, number> = {}
  for (const percentile of percentiles) {
    const value = calculatePercentile(values, percentile)
    if (value !== undefined && Number.isFinite(value)) {
      summary[`p${percentile}`] = value
    }
  }
  return summary
}
