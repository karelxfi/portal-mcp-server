import type { ReactNode } from 'react'

import { Card } from '../../components/primitives.js'
import { formatAxisValue } from '../../format.js'
import type { ChartModel, ChartSummary } from './model.js'

export type ChartStat = {
  label: string
  value: string
  tone?: 'default' | 'muted'
}

const SHORT_STAT_LABELS: Record<string, string> = {
  Open: 'O',
  High: 'H',
  Low: 'L',
  Close: 'C',
  Peak: 'PEAK',
  Avg: 'AVG',
  Points: 'PTS',
}

function shortStatLabel(label: string): string {
  return SHORT_STAT_LABELS[label] ?? label
}

/** Chart-first wrapper shared by every Wick chart variant. */
export function ChartCard({
  title,
  subtitle,
  summary,
  stats,
  chart,
  footer,
  showSummary = true,
}: {
  title?: string
  subtitle?: string
  summary: ChartSummary
  stats?: ChartStat[]
  chart: ReactNode
  footer?: ReactNode
  showSummary?: boolean
}) {
  return (
    <Card span="full" bodyFlush className="pt-card--chart">
      <div className="pt-chart-wrap">
        <div className="pt-chart-toolbar">
          <div className="pt-chart-toolbar__identity">
            {title && <span className="pt-chart-toolbar__title">{title}</span>}
            {subtitle && <span className="pt-chart-toolbar__subtitle">{subtitle}</span>}
          </div>
          <div className="pt-chart-toolbar__values" aria-label={summary.heroLabel}>
            {showSummary && <span className="pt-chart-live-value">{summary.hero}</span>}
            {showSummary && summary.showDelta && (
              <span className={`pt-chart-inline-delta ${summary.deltaClass}`}>
                {summary.deltaLabel}
              </span>
            )}
            {stats?.map((stat) => (
              <span key={stat.label} className="pt-chart-inline-stat">
                <span className="pt-chart-inline-stat__label">{shortStatLabel(stat.label)}</span>
                <span className="pt-chart-inline-stat__value">{stat.value}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="pt-chart-container">
          {chart}
        </div>

        {footer}
      </div>
    </Card>
  )
}

/** Multi-series legend row. Hidden automatically for single-series charts. */
export function ChartLegend({ model }: { model: ChartModel }) {
  if (model.series.length <= 1) return null
  return (
    <div className="pt-chart-legend">
      {model.series.map((s) => {
        const total = s.points.reduce((acc, p) => acc + p.value, 0)
        return (
          <div key={s.key} className="pt-chart-legend__item">
            <span className="pt-chart-legend__swatch" style={{ background: s.color }} />
            <span>{s.label}</span>
            <span className="pt-chart-legend__value">
              {formatAxisValue(total, model.valueFormat, model.unit)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
