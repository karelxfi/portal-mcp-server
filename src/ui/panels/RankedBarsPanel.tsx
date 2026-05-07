import { useMemo } from 'react'

import { Card, Text } from '../components/primitives.js'
import { asArray, formatValue, getByPath, toNumber } from '../format.js'

export type RankedBarsPanel = {
  kind: 'ranked_bars_panel'
  title?: string
  subtitle?: string
  data_key: string
  category_key: string
  value_key: string
  value_format?: string
  unit?: string
}

const VISIBLE = 15

export function RankedBarsPanelView({
  panel,
  payload,
  onRowClick,
}: {
  panel: RankedBarsPanel
  payload: unknown
  onRowClick?: (title: string, row: unknown) => void
}) {
  const rows = useMemo(() => asArray<Record<string, unknown>>(getByPath(payload, panel.data_key)), [
    panel,
    payload,
  ])

  if (!rows.length) {
    return (
      <Card title={panel.title || 'Top'} subtitle={panel.subtitle} span="half">
        <Text tone="muted">No ranked rows available for this view.</Text>
      </Card>
    )
  }

  const values = rows.map((r) => toNumber(getByPath(r, panel.value_key)) ?? 0)
  const maxValue = Math.max(...values, 0)
  const visible = rows.slice(0, VISIBLE)

  return (
    <Card title={panel.title || 'Top results'} subtitle={panel.subtitle} span="half" bodyFlush>
      <div className="pt-bars">
        {visible.map((row, i) => {
          const raw = toNumber(getByPath(row, panel.value_key)) ?? 0
          const pct = maxValue > 0 ? Math.max(1.5, (raw / maxValue) * 100) : 0
          const share = toNumber(getByPath(row, 'percentage'))
          const name = String(getByPath(row, panel.category_key) ?? 'Unknown')
          return (
            <div
              key={`${name}-${i}`}
              className="pt-bar-row"
              style={{ ['--pt-bar-pct' as any]: `${pct}%` }}
              onClick={() => onRowClick?.(name, row)}
            >
              <div className="pt-bar-row__rank">{String(i + 1).padStart(2, '0')}</div>
              <div className="pt-bar-row__name" title={name}>
                {name.length > 24 ? `${name.slice(0, 10)}…${name.slice(-6)}` : name}
              </div>
              <div className="pt-bar-row__value">
                <span>{formatValue(raw, panel.value_format, panel.unit)}</span>
                {share !== null ? <small>{formatValue(share, 'percent')}</small> : null}
              </div>
            </div>
          )
        })}
      </div>
      {rows.length > VISIBLE && (
        <div style={{ padding: '10px 4px 2px', textAlign: 'center' }}>
          <Text variant="caption" tone="subtle">
            and {rows.length - VISIBLE} more
          </Text>
        </div>
      )}
    </Card>
  )
}
