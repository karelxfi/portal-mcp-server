import { Sparkline as WickSparkline } from '@wick-charts/react'

import { WICK_THEME } from '../panels/chart/theme.js'

type SparklineProps = {
  values: number[]
  width?: number
  height?: number
  color?: string
  filled?: boolean
  strokeWidth?: number
}

export function Sparkline({
  values,
  width = 96,
  height = 28,
  color,
  filled = true,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (values.length < 2) return null

  const data = values.map((value, index) => ({
    time: Date.UTC(2026, 0, 1, 0, index, 0),
    value,
  }))

  return (
    <WickSparkline
      data={data}
      theme={WICK_THEME}
      width={width}
      height={height}
      color={color}
      area={{ visible: filled }}
      gradient={false}
      valuePosition="none"
      strokeWidth={strokeWidth}
      style={{ display: 'block', overflow: 'hidden' }}
    />
  )
}
