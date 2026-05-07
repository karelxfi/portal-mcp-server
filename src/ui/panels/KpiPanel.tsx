import { Card, Text } from '../components/primitives.js'
import { Sparkline } from '../components/Sparkline.js'
import { asArray, formatValue, getByPath, isRecord, toNumber } from '../format.js'
import { CHART } from './chart/theme.js'

export type KpiCard = {
  /** Small uppercase label above the hero number. */
  label: string
  /** Dot-path into the payload for the hero value. Required. */
  value_path: string
  /** Format name — reuses the shared formatter. */
  format?: string
  unit?: string

  /**
   * Optional comparison. If present, a delta pill is rendered next to the
   * hero number. Either a direct comparison value (e.g. "previous period")
   * or we compute it from trend data when both are set.
   */
  comparison_value_path?: string

  /**
   * Optional inline sparkline. Provide either an array of numbers directly
   * via `trend_values_path`, or an array of objects + a field name.
   */
  trend_values_path?: string
  trend_value_field?: string

  /** Color for the sparkline. Defaults to accent. */
  color?: string
}

export type KpiPanel = {
  kind: 'kpi_panel'
  title?: string
  subtitle?: string
  cards: KpiCard[]
}

function extractTrendValues(
  payload: unknown,
  valuesPath?: string,
  valueField?: string,
): number[] {
  if (!valuesPath) return []
  const raw = getByPath(payload, valuesPath)
  if (!Array.isArray(raw)) return []

  if (valueField) {
    return raw
      .map((row) => toNumber(getByPath(row, valueField)))
      .filter((v): v is number => v !== null)
  }

  return raw.map((v) => toNumber(v)).filter((v): v is number => v !== null)
}

function computeDelta(
  current: number | null,
  comparison: number | null,
): { show: boolean; label: string; className: string } {
  if (current === null || comparison === null || comparison <= 0) {
    return { show: false, label: '', className: '' }
  }
  const pct = ((current - comparison) / comparison) * 100
  const show = Math.abs(pct) >= CHART.deltaMinPct
  const arrow = pct >= 0 ? '▲' : '▼'
  return {
    show,
    label: `${arrow} ${Math.abs(pct).toFixed(1)}%`,
    className:
      pct >= 0 ? 'pt-chart-summary__delta--pos' : 'pt-chart-summary__delta--neg',
  }
}

function KpiCardView({ card, payload }: { card: KpiCard; payload: unknown }) {
  const valueRaw = toNumber(getByPath(payload, card.value_path))
  const comparisonRaw =
    card.comparison_value_path !== undefined
      ? toNumber(getByPath(payload, card.comparison_value_path))
      : null

  const heroDisplay = formatValue(valueRaw, card.format, undefined)
  const delta = computeDelta(valueRaw, comparisonRaw)
  const trendValues = extractTrendValues(
    payload,
    card.trend_values_path,
    card.trend_value_field,
  )

  return (
    <div className="pt-kpi-card">
      <div className="pt-kpi-card__head">
        <Text variant="label">
          {card.label}
          {card.unit ? ` · ${card.unit}` : ''}
        </Text>
      </div>
      <div className="pt-kpi-card__metric">
        <div className="pt-chart-summary__value">{heroDisplay}</div>
        {delta.show && (
          <div className={`pt-chart-summary__delta ${delta.className}`}>{delta.label}</div>
        )}
      </div>
      {trendValues.length >= 2 && (
        <div className="pt-kpi-card__spark">
          <Sparkline values={trendValues} color={card.color} />
        </div>
      )}
    </div>
  )
}

export function KpiPanelView({
  panel,
  payload,
}: {
  panel: KpiPanel
  payload: unknown
}) {
  const cards = asArray<KpiCard>(panel.cards).filter((c) => isRecord(c) && typeof c.label === 'string')
  if (!cards.length) return null

  return (
    <Card
      title={panel.title}
      subtitle={panel.subtitle}
      span="full"
      bodyFlush
    >
      <div className="pt-kpi-grid">
        {cards.map((card, i) => (
          <KpiCardView key={i} card={card} payload={payload} />
        ))}
      </div>
    </Card>
  )
}
