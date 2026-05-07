import { Card, Text } from '../components/primitives.js'
import { asArray, formatValue, getByPath, toNumber } from '../format.js'

export type TimelinePanel = {
  kind: 'timeline_panel'
  title?: string
  subtitle?: string
  data_key: string
  timestamp_key: string
  title_key: string
  subtitle_keys?: string[]
  badge_key?: string
  emphasis?: 'primary' | 'secondary'
}

function truncateHex(value: string): string {
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

function formatAny(value: unknown): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  if (/^0x[0-9a-fA-F]{20,}$/.test(s)) return truncateHex(s)
  return s
}

function badgeVariant(value: unknown): 'default' | 'success' | 'danger' | 'warning' {
  const s = String(value ?? '').toLowerCase()
  if (!s) return 'default'
  if (['success', 'confirmed', 'ok', 'true', 'finalized'].includes(s)) return 'success'
  if (['reverted', 'failed', 'error', 'false'].includes(s)) return 'danger'
  if (['pending', 'partial', 'warning'].includes(s)) return 'warning'
  return 'default'
}

function formatTimelineTimestamp(value: unknown): string {
  const numeric = toNumber(value)
  if (numeric !== null) {
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000
    return new Date(millis).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    })
  }

  const formatted = formatValue(value, 'timestamp_human')
  const time = formatted.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)
  return time?.[0] ?? formatted
}

function timelineKind(row: Record<string, unknown>, badge: unknown): string {
  const value =
    getByPath(row, 'kind') ??
    getByPath(row, 'type') ??
    getByPath(row, 'event_type') ??
    getByPath(row, 'method') ??
    badge ??
    'event'
  return formatAny(value)
}

export function TimelinePanelView({
  panel,
  payload,
  onRowClick,
}: {
  panel: TimelinePanel
  payload: unknown
  onRowClick?: (title: string, row: unknown) => void
}) {
  const rows = asArray<Record<string, unknown>>(getByPath(payload, panel.data_key))
  const visible = rows.slice(0, 20)

  if (!rows.length) {
    return (
      <Card title={panel.title || 'Timeline'} subtitle={panel.subtitle} span={panel.emphasis === 'primary' ? 'full' : 'half'}>
        <Text tone="muted">No timeline rows available in this window.</Text>
      </Card>
    )
  }

  return (
    <Card
      title={panel.title || 'Timeline'}
      subtitle={panel.subtitle}
      span={panel.emphasis === 'primary' ? 'full' : 'half'}
      bodyFlush
    >
      <div className="pt-timeline">
        {visible.map((row, i) => {
          const timestamp = getByPath(row, panel.timestamp_key)
          const rawTitle = getByPath(row, panel.title_key)
          const title = formatAny(rawTitle) || `Event ${i + 1}`
          const subtitleParts = asArray(panel.subtitle_keys)
            .map((k) => {
              const v = getByPath(row, String(k))
              return formatAny(v)
            })
            .filter(Boolean)
          const subtitle = subtitleParts.join(' • ')
          const badge = panel.badge_key ? getByPath(row, panel.badge_key) : undefined
          const variant = badgeVariant(badge)
          const kind = timelineKind(row, badge)
          const isHexTitle = typeof rawTitle === 'string' && /^0x[0-9a-fA-F]{20,}$/.test(rawTitle)
          return (
            <div
              key={i}
              className="pt-timeline-item"
              onClick={() => onRowClick?.(title, row)}
            >
              <span className="pt-timeline-item__ts">{formatTimelineTimestamp(timestamp)}</span>
              <span
                className={`pt-timeline-item__dot ${variant !== 'default' ? `pt-timeline-item__dot--${variant}` : ''}`}
              />
              <div className="pt-timeline-item__body">
                <span
                  className={`pt-timeline-item__title ${isHexTitle ? 'pt-text--code' : ''}`}
                  title={typeof rawTitle === 'string' ? rawTitle : undefined}
                >
                  {title}
                </span>
                {subtitle && (
                  <span className="pt-timeline-item__sub" title={subtitle}>
                    {subtitle}
                  </span>
                )}
              </div>
              <span className="pt-timeline-item__kind">{kind}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
