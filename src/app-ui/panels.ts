import { chartPanel } from './charts/terminal.js'
import {
  MAX_INLINE_RANKED_ROWS,
  MAX_INLINE_TIMELINE_ROWS,
  MAX_RANKED_ROWS,
  MAX_STAT_ROWS,
  MAX_TIMELINE_ROWS,
  type Panel,
  type PanelOptions,
  type PanelSet,
  asArray,
  card,
  displayLimitNotice,
  element,
  eventTimeLabel,
  formatValue,
  getByPath,
  humanize,
  identifierLink,
  identifierNode,
  isHexIdentifier,
  isRecord,
  numberRows,
  numeric,
  shortIdentifier,
  text,
} from './common.js'
import { panelLimit, tableDescriptor, tablePanel } from './tables.js'

function timelinePanel(payload: Record<string, unknown>, panel: Panel, options: PanelOptions): HTMLElement {
  const sourceRows = numberRows(payload, panel)
  const pageSize = options.mode === 'inline' ? MAX_INLINE_TIMELINE_ROWS : MAX_TIMELINE_ROWS
  const { root, body } = card(text(panel.title ?? 'Activity timeline'), text(panel.subtitle))
  const render = (expanded: boolean) => {
    const rows = expanded ? sourceRows : sourceRows.slice(0, pageSize)
    const timeline = element('div', 'sqd-timeline')
    const valueKey = text(panel.value_key)
    const directionKey = text(panel.direction_key)
    for (const row of rows) {
      const event = element('article', 'sqd-event')
      const stamp = text(getByPath(row, text(panel.timestamp_key)))
      const time = element('time', 'sqd-event-time', eventTimeLabel(stamp))
      if (time.textContent !== stamp) {
        time.title = stamp
        time.setAttribute('aria-label', stamp)
      }
      event.append(time)
      const direction = directionKey ? text(getByPath(row, directionKey)).toLowerCase() : ''
      const dotTone = direction === 'in' ? ' sqd-event-dot--in' : direction === 'out' ? ' sqd-event-dot--out' : ''
      const dot = element('span', `sqd-event-dot${dotTone}`)
      /* Colour alone does not carry the direction: a glyph shows it to anyone
         who cannot see the hue, and the label reads it out. */
      if (direction === 'in' || direction === 'out') {
        dot.textContent = direction === 'in' ? '↓' : '↑'
        dot.setAttribute('role', 'img')
        dot.setAttribute('aria-label', direction === 'in' ? 'inbound' : 'outbound')
      }
      event.append(dot)
      const copy = element('div')
      const rawTitle = text(getByPath(row, text(panel.title_key)) ?? 'Activity')
      const titleNode = element('div', 'sqd-event-title')
      const titleLink = identifierLink(payload, text(panel.title_key), rawTitle, options.actions, rawTitle)
      if (titleLink) titleNode.append(titleLink)
      else titleNode.textContent = /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(rawTitle) ? humanize(rawTitle) : rawTitle
      copy.append(titleNode)
      const subtitleParts = asArray(panel.subtitle_keys)
        .map((key) => ({ key: text(key), value: text(getByPath(row, text(key))) }))
        .filter((part) => part.value)
      const joiner = directionKey && subtitleParts.length === 2 ? ' → ' : ' · '
      const subtitleNode = element('div', 'sqd-event-subtitle')
      subtitleParts.forEach((part, index) => {
        if (index) subtitleNode.append(joiner)
        subtitleNode.append(identifierNode(payload, part.key, part.value, options.actions))
      })
      /* The row's transaction stays one click away even when the title is a
         type or an amount. */
      const txKey = ['tx_hash', 'hash', 'transaction_hash', 'signature'].find((key) => typeof row[key] === 'string')
      const txValue = txKey ? text(row[txKey]) : ''
      if (txKey && txValue && rawTitle.split(':')[0] !== txValue && !subtitleParts.some((part) => part.key === txKey)) {
        if (subtitleParts.length) subtitleNode.append(' · ')
        subtitleNode.append(identifierNode(payload, txKey, text(row[txKey]), options.actions))
      }
      if (subtitleNode.childNodes.length) copy.append(subtitleNode)
      event.append(copy)
      if (valueKey) {
        const rawValue = getByPath(row, valueKey)
        const amount = numeric(rawValue)
        if (amount !== undefined) {
          const tone = direction === 'in' ? 'in' : direction === 'out' ? 'out' : 'flat'
          const sign = direction === 'in' ? '+' : direction === 'out' ? '-' : ''
          const unit = panel.unit_key
            ? text(getByPath(row, text(panel.unit_key))) || text(panel.unit)
            : text(panel.unit)
          event.append(
            element(
              'span',
              `sqd-event-value sqd-event-value--${tone}`,
              `${sign}${formatValue(amount, text(panel.value_format), unit)}`,
            ),
          )
        }
      }
      timeline.append(event)
    }
    body.replaceChildren(rows.length ? timeline : element('div', 'sqd-chart-empty', 'No activity rows were returned.'))
    body.append(
      ...panelLimit('timeline rows', rows.length, sourceRows.length, options, { expanded, pageSize, onToggle: render }),
    )
  }
  render(false)
  return root
}

function rankedPanel(payload: Record<string, unknown>, panel: Panel, options: PanelOptions): HTMLElement {
  const sourceRows = numberRows(payload, panel)
  const pageSize = options.mode === 'inline' ? MAX_INLINE_RANKED_ROWS : MAX_RANKED_ROWS
  /* Bars scale to the largest value in the whole result, so revealing more
     rows never rescales the ones already on screen. */
  const values = sourceRows
    .map((row) => numeric(getByPath(row, text(panel.value_key))))
    .filter((value): value is number => value !== undefined)
  const max = Math.max(...values, 1)
  const { root, body } = card(
    text(panel.title ?? 'Ranked activity'),
    text(panel.subtitle),
    panel.emphasis === 'primary' ? 'sqd-card--primary' : '',
  )
  const render = (expanded: boolean) => {
    const rows = expanded ? sourceRows : sourceRows.slice(0, pageSize)
    const ranked = element('div', 'sqd-ranked')
    for (const row of rows) {
      const value = numeric(getByPath(row, text(panel.value_key))) ?? 0
      const item = element('div', 'sqd-ranked-row')
      const rawLabel = text(getByPath(row, text(panel.category_key)) ?? 'Unknown')
      const label = element(
        'div',
        `sqd-ranked-label${isHexIdentifier(rawLabel) ? ' sqd-ranked-label--id' : ''}`,
        shortIdentifier(rawLabel),
      )
      label.title = rawLabel
      const labelLink = identifierLink(payload, text(panel.category_key), rawLabel, options.actions)
      if (labelLink) label.replaceChildren(labelLink)
      item.append(label)
      const track = element('div', 'sqd-ranked-track')
      const fill = element('div', 'sqd-ranked-fill')
      fill.style.width = `${Math.max(2, (value / max) * 100)}%`
      track.append(fill)
      item.append(track)
      item.append(element('div', 'sqd-ranked-value', formatValue(value, text(panel.value_format), text(panel.unit))))
      ranked.append(item)
    }
    body.replaceChildren(rows.length ? ranked : element('div', 'sqd-chart-empty', 'No ranked values were returned.'))
    body.append(
      ...panelLimit('ranked rows', rows.length, sourceRows.length, options, { expanded, pageSize, onToggle: render }),
    )
  }
  render(false)
  return root
}

function statPanel(payload: Record<string, unknown>, panel: Panel, _options: PanelOptions): HTMLElement {
  const sourceRows = numberRows(payload, panel)
  const rows = sourceRows.slice(0, MAX_STAT_ROWS)
  const { root, body } = card(text(panel.title ?? 'Details'), text(panel.subtitle), 'sqd-card--half')
  const list = element('div', 'sqd-stat-list')
  for (const row of rows) {
    const stat = element('div', 'sqd-stat')
    stat.append(element('span', 'sqd-stat-label', text(getByPath(row, text(panel.label_key)))))
    stat.append(
      element(
        'span',
        'sqd-stat-value',
        formatValue(getByPath(row, text(panel.value_key)), text(panel.value_format), text(panel.unit)),
      ),
    )
    list.append(stat)
  }
  body.append(list)
  const limitNotice = displayLimitNotice('detail rows', rows.length, sourceRows.length)
  if (limitNotice) body.append(limitNotice)
  return root
}

function inferredPanel(payload: Record<string, unknown>, options: PanelOptions): HTMLElement | null {
  const keys = [
    'items',
    'transactions',
    'transfers',
    'logs',
    'events',
    'calls',
    'instructions',
    'ohlc',
    'time_series',
    'volume_by_coin',
    'top_contracts',
  ]
  const key = keys.find((candidate) => asArray(payload[candidate]).some(isRecord))
  if (!key) return null
  return tablePanel(payload, { title: humanize(key), data_key: key }, options)
}

/* One primary instrument per result (the declared primary, else the first
   chart, else the first non-table panel), secondary panels beside it, and
   every evidence table in the ledger beneath. Inline shows the primary only. */
export function panels(payload: Record<string, unknown>, options: PanelOptions): PanelSet {
  const ui = isRecord(payload._ui) ? payload._ui : {}
  const specs = asArray(ui.panels).filter(isRecord)
  const built: Array<{ panel: Panel; node: HTMLElement; table: boolean }> = []
  const build = (panel: Panel) => {
    const kind = text(panel.kind)
    if (kind === 'chart_panel')
      built.push({ panel, node: chartPanel(payload, panel, options.actions?.reportChartView), table: false })
    else if (kind === 'table_panel') built.push({ panel, node: tablePanel(payload, panel, options), table: true })
    else if (kind === 'timeline_panel')
      built.push({ panel, node: timelinePanel(payload, panel, options), table: false })
    else if (kind === 'ranked_bars_panel')
      built.push({ panel, node: rankedPanel(payload, panel, options), table: false })
    else if (kind === 'stat_list_panel') built.push({ panel, node: statPanel(payload, panel, options), table: false })
  }
  for (const panel of specs) build(panel)
  const tableKeys = new Set(
    specs
      .filter((panel) => text(panel.kind) === 'table_panel')
      .map((panel) => {
        const descriptor = tableDescriptor(payload, text(panel.table_id))
        return text(descriptor?.data_key ?? panel.data_key)
      })
      .filter(Boolean),
  )
  /* Charts and timelines summarize a row list; fullscreen always keeps the
     exact rows behind them as a filterable table, even when the tool only
     declared the summary panel. */
  const chartKeys = specs
    .filter((panel) => text(panel.kind) === 'chart_panel')
    .map((panel) => getByPath(payload, text(panel.chart_key)))
    .filter(isRecord)
    .map((chart) => text(chart.data_key))
    .filter(Boolean)
  const timelineKeys = specs
    .filter((panel) => text(panel.kind) === 'timeline_panel')
    .map((panel) => text(panel.data_key))
    .filter(Boolean)
  for (const dataKey of new Set([...chartKeys, ...timelineKeys])) {
    if (!tableKeys.has(dataKey) && asArray(getByPath(payload, dataKey)).some(isRecord)) {
      const panel = { title: `Exact ${humanize(dataKey)} evidence`, data_key: dataKey }
      built.push({ panel, node: tablePanel(payload, panel, options), table: true })
      tableKeys.add(dataKey)
    }
  }
  if (!specs.length) {
    const contract = isRecord(payload._tool_contract) ? payload._tool_contract : {}
    if (contract.name === 'portal_evm_get_contract_activity') {
      build({
        kind: 'ranked_bars_panel',
        title: 'Top callers',
        subtitle: 'Caller frequency inside the exact analyzed window.',
        data_key: 'interactions.top_callers',
        category_key: 'address',
        value_key: 'interaction_count',
        value_format: 'integer',
        emphasis: 'primary',
      })
      if (isRecord(getByPath(payload, 'events.events_by_type'))) {
        build({
          kind: 'ranked_bars_panel',
          title: 'Top event types',
          subtitle: 'Observed event signatures ranked by count.',
          data_key: 'events.events_by_type',
          object_map: true,
          category_key: 'event',
          value_key: 'count',
          value_format: 'integer',
        })
      }
    } else {
      const inferred = inferredPanel(payload, options)
      if (inferred) built.push({ panel: {}, node: inferred, table: true })
    }
  }
  const nonTable = built.filter((entry) => !entry.table)
  const primaryEntry =
    nonTable.find((entry) => entry.panel.emphasis === 'primary') ??
    nonTable.find((entry) => text(entry.panel.kind) === 'chart_panel') ??
    nonTable[0] ??
    built.find((entry) => entry.panel.emphasis === 'primary') ??
    built[0]
  if (primaryEntry) primaryEntry.node.classList.add('sqd-card--primary')
  return {
    primary: primaryEntry?.node ?? null,
    secondary: nonTable.filter((entry) => entry !== primaryEntry).map((entry) => entry.node),
    ledger: built.filter((entry) => entry.table && entry !== primaryEntry).map((entry) => entry.node),
  }
}
