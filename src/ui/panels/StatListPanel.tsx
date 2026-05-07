import { Card, Text } from '../components/primitives.js'
import { asArray, formatValue, getByPath } from '../format.js'

export type StatListPanel = {
  kind: 'stat_list_panel'
  title?: string
  subtitle?: string
  data_key: string
  label_key: string
  value_key: string
  value_format?: string
  unit?: string
}

export function StatListPanelView({
  panel,
  payload,
}: {
  panel: StatListPanel
  payload: unknown
}) {
  const rows = asArray<Record<string, unknown>>(getByPath(payload, panel.data_key))
  if (!rows.length) {
    return (
      <Card title={panel.title || 'Summary'} subtitle={panel.subtitle} span="full">
        <Text tone="muted">No summary rows available for this section.</Text>
      </Card>
    )
  }

  return (
    <Card title={panel.title || 'Summary'} subtitle={panel.subtitle} span="full" bodyFlush>
      <div className="pt-stat-grid">
        {rows.slice(0, 12).map((row, i) => {
          const format = (row.format as string | undefined) ?? panel.value_format
          const unit = (row.unit as string | undefined) ?? panel.unit
          return (
            <div className="pt-stat-cell" key={i}>
              <Text variant="label">{String(getByPath(row, panel.label_key) ?? 'Metric')}</Text>
              <Text variant="metric-sm">
                {formatValue(getByPath(row, panel.value_key), format, unit)}
              </Text>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
