import { useCallback, useMemo } from 'react'

import { Badge, Button, Card, Skeleton, Stack, Text } from './components/primitives.js'
import { asArray, formatValue, getByPath, humanize, isRecord } from './format.js'
import { ChartPanelView, type ChartPanel } from './panels/ChartPanel.js'
import { KpiPanelView, type KpiPanel } from './panels/KpiPanel.js'
import { RankedBarsPanelView, type RankedBarsPanel } from './panels/RankedBarsPanel.js'
import { StatListPanelView, type StatListPanel } from './panels/StatListPanel.js'
import { TablePanelView, type TablePanel } from './panels/TablePanel.js'
import { TimelinePanelView, type TimelinePanel } from './panels/TimelinePanel.js'

type Panel =
  | ChartPanel
  | TablePanel
  | RankedBarsPanel
  | TimelinePanel
  | StatListPanel
  | KpiPanel

type FallbackTable = {
  panels: Panel[]
  payload: Record<string, unknown> | null
}

type FallbackSummaryRow = {
  label: string
  value: number
  format?: string
  unit?: string
}

export type DrawerState = { title: string; item: unknown } | null

export type AppState = {
  payload: Record<string, unknown> | null
  rawText: string
  loading: boolean
  error: string
  drawer: DrawerState
  rawOpen: boolean
}

export type AppActions = {
  openDrawer: (title: string, item: unknown) => void
  closeDrawer: () => void
  toggleRaw: () => void
  runFollowup: (intent: string, target?: string) => void
}

function isPartialResult(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false
  const pagination = payload._pagination as { has_more?: boolean } | undefined
  if (pagination?.has_more) return true
  const coverage = payload._coverage as { result_complete?: boolean; sampled?: boolean } | undefined
  if (!coverage || typeof coverage !== 'object') return false
  return coverage.result_complete === false || coverage.sampled === true
}

function Header({
  payload,
  loading,
  isPartial,
  actions,
  onFollowup,
  onToggleRaw,
}: {
  payload: Record<string, unknown>
  loading: boolean
  isPartial: boolean
  actions: unknown[]
  onFollowup: (intent: string, target?: string) => void
  onToggleRaw: () => void
}) {
  const ui = (payload._ui as Record<string, unknown>) || {}
  const headline = (ui.headline as Record<string, unknown>) || (payload.display as Record<string, unknown>) || {}
  const display = (payload.display as Record<string, unknown>) || {}
  const toolContract = (payload._tool_contract as Record<string, unknown>) || {}
  const pagination = (payload._pagination as Record<string, unknown>) || {}

  const title = String(headline.title || display.title || 'Portal Explorer')
  const subtitle = String(headline.subtitle || display.subtitle || payload._summary || payload.answer || '')

  const compactLabel = (intent: string, raw?: string) => {
    switch (intent) {
      case 'continue':
        return 'Load more'
      case 'compare_previous':
        return 'Compare previous'
      case 'zoom_in':
        return 'Zoom in'
      case 'show_raw':
        return 'Raw JSON'
      default:
        return raw || humanize(intent)
    }
  }

  const statusBadges = (
    <>
      {isPartial ? <Badge variant="warning">Partial preview</Badge> : null}
      {loading ? <Badge>Refreshing…</Badge> : null}
    </>
  )

  return (
    <header className="pt-header">
      <div className="pt-header__title-block">
        <Text variant="h1" as="h1">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </div>
      {(isPartial || loading) && <div className="pt-header__eyebrow">{statusBadges}</div>}
      <div className="pt-header__actions">
        {actions.map((action, i) => {
          if (!isRecord(action)) return null
          const intent = String(action.intent || 'show_raw')
          // Hide actions that don't earn their space: raw is behind Raw JSON link,
          // zoom_in is a stub without real semantics, and we drop non-functional
          // affordances entirely per Linear/Vercel guidance.
          if (intent === 'show_raw' || intent === 'zoom_in') return null
          const disabled =
            loading ||
            (intent === 'continue' && !pagination.next_cursor) ||
            (intent === 'compare_previous' && !toolContract.name)
          return (
            <Button
              key={i}
              variant={intent === 'continue' ? 'primary' : 'default'}
              disabled={disabled}
              onClick={() => onFollowup(intent, action.target as string | undefined)}
            >
              {compactLabel(intent, action.label as string | undefined)}
            </Button>
          )
        })}
      </div>
    </header>
  )
}

function Notices({ notices }: { notices: string[] }) {
  if (!notices.length) return null
  return (
    <div className="pt-notices">
      {notices.map((n, i) => (
        <div key={i} className="pt-notice">
          {n}
        </div>
      ))}
    </div>
  )
}

const FALLBACK_COLUMN_ORDER = [
  'timestamp_human',
  'block_number',
  'transactionIndex',
  'tx_hash',
  'sender',
  'recipient',
  'hash',
  'from',
  'to',
  'timestamp',
  'blockNumber',
  'address',
  'token_address',
  'label',
  'name',
  'value_formatted',
  'value',
  'value_eth',
  'gasPrice_gwei',
  'type',
  'status',
  'log_index',
  'primary_id',
  'transaction_count',
  'percentage',
]

const FALLBACK_HIDDEN_KEYS = new Set([
  'chain_kind',
  'record_type',
  'technical_details',
  'value_decimal',
])

function pruneFallbackAliases(keys: string[]): string[] {
  const omit = new Set<string>()
  if (keys.includes('timestamp_human')) omit.add('timestamp')
  if (keys.includes('block_number')) omit.add('blockNumber')
  if (keys.includes('tx_hash')) {
    omit.add('hash')
    omit.add('primary_id')
    omit.add('transaction_hash')
  } else if (keys.includes('hash')) {
    omit.add('primary_id')
  }
  if (keys.includes('sender')) omit.add('from')
  if (keys.includes('recipient')) omit.add('to')
  if (keys.includes('value_formatted')) omit.add('value')
  return keys.filter((key) => !omit.has(key))
}

function fallbackLabelForKey(key: string): string {
  switch (key) {
    case 'timestamp_human':
      return 'Time'
    case 'block_number':
    case 'blockNumber':
      return 'Block'
    case 'transactionIndex':
      return 'Index'
    case 'tx_hash':
    case 'hash':
    case 'primary_id':
      return 'Tx hash'
    case 'sender':
    case 'from':
      return 'From'
    case 'recipient':
    case 'to':
      return 'To'
    case 'value_eth':
    case 'value_formatted':
      return 'Value'
    case 'gasPrice_gwei':
      return 'Gas price'
    case 'token_address':
      return 'Token'
    case 'log_index':
      return 'Log'
    case 'type':
      return 'Tx type'
    case 'status':
      return 'Status'
    case 'transaction_count':
      return 'Transactions'
    default:
      return humanize(key)
  }
}

function fallbackFormatForKey(key: string): string | undefined {
  const lower = key.toLowerCase()
  if (lower.includes('timestamp')) return key === 'timestamp_human' ? 'timestamp_human' : 'timestamp'
  if (lower.includes('hash') || lower.includes('address') || lower === 'from' || lower === 'to' || lower === 'sender' || lower === 'recipient') {
    return 'address'
  }
  if (lower.includes('percentage') || lower === 'share') return 'percent'
  if (lower.includes('gwei')) return 'gwei'
  if (key === 'value_formatted') return 'decimal'
  if (lower.includes('eth') || lower === 'value') return 'decimal'
  if (lower === 'type') return 'evm_tx_type'
  if (lower === 'status') return 'evm_status'
  if (lower.includes('count') || lower.includes('number') || lower.includes('index')) return 'integer'
  return undefined
}

function fallbackKindForKey(key: string): 'time' | 'dimension' | 'metric' | 'rank' {
  const lower = key.toLowerCase()
  if (lower.includes('timestamp')) return 'time'
  if (lower === 'rank' || lower === 'bucket_index' || lower.endsWith('index')) return 'rank'
  if (lower === 'type' || lower === 'status') return 'dimension'
  if (
    lower.includes('count') ||
    lower.includes('number') ||
    lower.includes('gas') ||
    lower.includes('value') ||
    lower.includes('percentage')
  ) return 'metric'
  return 'dimension'
}

function buildFallbackItemTable(payload: Record<string, unknown> | null): FallbackTable {
  const items = asArray<Record<string, unknown>>(payload?.items)
  const rows = items.filter(isRecord)
  if (!payload) return { panels: [], payload }
  if (!rows.length) return buildFallbackSummaryView(payload)

  const seen = new Set<string>()
  const availableKeys = rows
    .slice(0, 12)
    .flatMap((row) => Object.keys(row))
    .filter((key) => !FALLBACK_HIDDEN_KEYS.has(key))
    .filter((key) => {
      if (seen.has(key)) return false
      seen.add(key)
      return rows.some((row) => {
        const value = row[key]
        return value !== undefined && value !== null && typeof value !== 'object'
      })
    })

  const orderedKeys = pruneFallbackAliases([
    ...FALLBACK_COLUMN_ORDER.filter((key) => availableKeys.includes(key)),
    ...availableKeys.filter((key) => !FALLBACK_COLUMN_ORDER.includes(key)),
  ]).slice(0, 8)

  if (!orderedKeys.length) return { panels: [], payload }

  const fallbackTable = {
    id: 'fallback_items',
    kind: 'table',
    data_key: 'items',
    row_count: rows.length,
    title: 'Returned rows',
    subtitle: `${rows.length.toLocaleString()} ${rows.length === 1 ? 'item' : 'items'}`,
    default_sort: {
      key: orderedKeys.includes('timestamp_human') ? 'timestamp_human' : orderedKeys[0]!,
      direction: orderedKeys.includes('timestamp_human') ? 'desc' : 'asc',
    },
    dense: true,
    columns: orderedKeys.map((key) => ({
      key,
      label: fallbackLabelForKey(key),
      kind: fallbackKindForKey(key),
      format: fallbackFormatForKey(key),
      align: fallbackKindForKey(key) === 'metric' || fallbackKindForKey(key) === 'rank' ? 'right' : 'left',
    })),
    interactions: {
      sortable: true,
      searchable: rows.length > 4,
      sticky_header: true,
      row_hover: true,
      row_expand: true,
      default_page_size: Math.min(Math.max(rows.length, 1), 25),
    },
  }

  return {
    panels: [
      {
        id: 'fallback-items',
        kind: 'table_panel',
        title: 'Returned rows',
        subtitle: payload.display && isRecord(payload.display) && typeof payload.display.subtitle === 'string'
          ? payload.display.subtitle
          : undefined,
        table_id: 'fallback_items',
      } as TablePanel,
    ],
    payload: {
      ...payload,
      tables: [...asArray(payload.tables), fallbackTable],
    },
  }
}

function buildFallbackSummaryView(payload: Record<string, unknown>): FallbackTable {
  const throughput = isRecord(payload.throughput) ? payload.throughput : {}
  const fees = isRecord(payload.fees) ? payload.fees : {}
  const activity = isRecord(payload.activity) ? payload.activity : {}
  const network = isRecord(payload.network) ? payload.network : {}
  const topPrograms = isRecord(payload.top_programs) ? payload.top_programs : {}
  const programRows = asArray<Record<string, unknown>>(topPrograms.programs).filter(isRecord)

  const summaryRows = ([
    typeof throughput.tps === 'number'
      ? { label: 'TPS', value: throughput.tps, format: 'decimal', unit: 'tx/s' }
      : undefined,
    typeof throughput.total_transactions === 'number'
      ? { label: 'Transactions', value: throughput.total_transactions, format: 'compact_number' }
      : undefined,
    typeof activity.unique_wallets === 'number'
      ? { label: 'Wallets', value: activity.unique_wallets, format: 'compact_number' }
      : undefined,
    typeof activity.success_rate === 'number'
      ? { label: 'Success rate', value: activity.success_rate, format: 'percent' }
      : undefined,
    typeof fees.avg_fee_lamports === 'number'
      ? { label: 'Avg fee', value: fees.avg_fee_lamports, format: 'compact_number', unit: 'lamports' }
      : undefined,
    typeof network.slots_analyzed === 'number'
      ? { label: 'Slots analyzed', value: network.slots_analyzed, format: 'compact_number' }
      : undefined,
  ] as Array<FallbackSummaryRow | undefined>).filter((row): row is FallbackSummaryRow => Boolean(row))

  if (!summaryRows.length && !programRows.length) return { panels: [], payload }

  const panels: Panel[] = []
  const tables = [...asArray(payload.tables)]

  if (summaryRows.length) {
    panels.push({
      id: 'fallback-summary',
      kind: 'stat_list_panel',
      title: 'Summary',
      subtitle: typeof payload._summary === 'string' ? payload._summary : undefined,
      data_key: '_fallback.summary_rows',
      label_key: 'label',
      value_key: 'value',
    } as StatListPanel)
  }

  if (programRows.length) {
    panels.push({
      id: 'fallback-top-programs-bars',
      kind: 'ranked_bars_panel',
      title: 'Top programs',
      subtitle: 'Ranked by instruction count.',
      data_key: '_fallback.top_programs',
      category_key: 'program_name',
      value_key: 'instruction_count',
      value_format: 'compact_number',
    } as RankedBarsPanel)

    tables.push({
      id: 'fallback_top_programs',
      kind: 'table',
      data_key: '_fallback.top_programs',
      row_count: programRows.length,
      title: 'Top programs',
      subtitle: 'Program instruction activity in the selected window',
      default_sort: { key: 'rank', direction: 'asc' },
      dense: true,
      columns: [
        { key: 'rank', label: 'Rank', kind: 'rank', format: 'integer', align: 'right' },
        { key: 'program_name', label: 'Program', kind: 'dimension' },
        { key: 'instruction_count', label: 'Instructions', kind: 'metric', format: 'compact_number', align: 'right' },
        { key: 'share', label: 'Share', kind: 'metric', align: 'right' },
        { key: 'avg_compute_units', label: 'Avg compute', kind: 'metric', format: 'compact_number', align: 'right' },
      ],
      interactions: {
        sortable: true,
        searchable: programRows.length > 8,
        sticky_header: true,
        row_hover: true,
        row_expand: true,
        default_page_size: Math.min(Math.max(programRows.length, 1), 20),
      },
    })

    panels.push({
      id: 'fallback-top-programs-table',
      kind: 'table_panel',
      title: 'Program table',
      subtitle: 'Exact ranked program rows.',
      table_id: 'fallback_top_programs',
    } as TablePanel)
  }

  return {
    panels,
    payload: {
      ...payload,
      _fallback: {
        summary_rows: summaryRows,
        top_programs: programRows,
      },
      tables,
    },
  }
}

function Drawer({ state, onClose }: { state: DrawerState; onClose: () => void }) {
  if (!state) return null
  const item = state.item
  const entries: Array<[string, unknown]> = isRecord(item) ? Object.entries(item) : []
  return (
    <div className="pt-drawer-backdrop" onClick={onClose}>
      <aside className="pt-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="pt-drawer__header">
          <div>
            <Text variant="h2" as="h2">
              {state.title}
            </Text>
            <Text variant="caption" tone="muted">
              Evidence view for the selected result row.
            </Text>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="pt-drawer__body">
          {entries.length ? (
            <dl className="pt-kv">
              {entries.map(([k, v]) => (
                <>
                  <dt key={`${k}-k`}>{humanize(k)}</dt>
                  <dd key={`${k}-v`}>
                    {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')}
                  </dd>
                </>
              ))}
            </dl>
          ) : (
            <pre className="pt-json">{JSON.stringify(item, null, 2)}</pre>
          )}
        </div>
      </aside>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="pt-panels">
      <Card span="full" title={<Skeleton width={260} height={20} />}>
        <Stack direction="col" gap={14}>
          <Skeleton height={18} width="40%" />
          <Skeleton height={220} />
        </Stack>
      </Card>
      <Card title={<Skeleton width={180} height={18} />}>
        <Stack direction="col" gap={10}>
          <Skeleton height={14} />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="70%" />
          <Skeleton height={14} width="80%" />
        </Stack>
      </Card>
      <Card title={<Skeleton width={180} height={18} />}>
        <Stack direction="col" gap={10}>
          <Skeleton height={14} />
          <Skeleton height={14} width="85%" />
          <Skeleton height={14} width="60%" />
        </Stack>
      </Card>
    </div>
  )
}

function ErrorState({ message, onToggleRaw }: { message: string; onToggleRaw: () => void }) {
  return (
    <div className="pt-state pt-state--error">
      <strong>Something went wrong</strong>
      <p>{message}</p>
      <div style={{ marginTop: 8 }}>
        <Button onClick={onToggleRaw}>Show raw response</Button>
      </div>
    </div>
  )
}

function RawPanel({ rawText }: { rawText: string }) {
  return (
    <Card title="Raw result" subtitle="Exact JSON payload returned by the Portal MCP tool" span="full">
      <pre className="pt-json">{rawText}</pre>
    </Card>
  )
}

export function AppShell({
  state,
  actions,
}: {
  state: AppState
  actions: AppActions
}) {
  const { payload, loading, error, drawer, rawOpen, rawText } = state

  const hasPayload = Boolean(payload)
  const ui = useMemo(() => (isRecord(payload?._ui) ? (payload!._ui as Record<string, unknown>) : {}), [payload])
  const panels = useMemo(() => {
    return asArray<Panel>(ui.panels)
  }, [ui])
  const fallback = useMemo(() => buildFallbackItemTable(payload), [payload])
  const renderedPanels = panels.length ? panels : fallback.panels
  const panelPayload = panels.length ? payload : fallback.payload
  const followUpActions = useMemo(() => asArray(ui.follow_up_actions), [ui])
  const notices = useMemo(() => {
    if (!payload) return []
    const list: string[] = []
    if (typeof payload._notice === 'string') list.push(payload._notice)
    for (const n of asArray(payload._notices)) {
      if (typeof n === 'string') list.push(n)
    }
    return list
  }, [payload])

  const isPartial = hasPayload && isPartialResult(payload)
  const hideHeader =
    hasPayload &&
    ui.layout === 'chart_focus' &&
    renderedPanels.length === 1 &&
    isRecord(renderedPanels[0]) &&
    renderedPanels[0].kind === 'chart_panel' &&
    followUpActions.length === 0 &&
    !isPartial &&
    !loading

  const handleRowClick = useCallback(
    (title: string, row: unknown) => {
      actions.openDrawer(title, row)
    },
    [actions],
  )

  const renderPanel = (panel: Panel, i: number) => {
    if (!isRecord(panel) || typeof panel.kind !== 'string') return null
    const key = `${panel.kind}-${i}`
    switch (panel.kind) {
      case 'chart_panel':
        return <ChartPanelView key={key} panel={panel} payload={panelPayload} />
      case 'table_panel':
        return (
          <TablePanelView
            key={key}
            panel={panel}
            payload={panelPayload}
            onRowClick={handleRowClick}
          />
        )
      case 'ranked_bars_panel':
        return (
          <RankedBarsPanelView
            key={key}
            panel={panel}
            payload={panelPayload}
            onRowClick={handleRowClick}
          />
        )
      case 'timeline_panel':
        return (
          <TimelinePanelView
            key={key}
            panel={panel}
            payload={panelPayload}
            onRowClick={handleRowClick}
          />
        )
      case 'stat_list_panel':
        return <StatListPanelView key={key} panel={panel} payload={panelPayload} />
      case 'kpi_panel':
        return <KpiPanelView key={key} panel={panel} payload={panelPayload} />
      default:
        return null
    }
  }

  return (
    <main className="pt-app">
      {hasPayload && !hideHeader && (
        <Header
          payload={payload!}
          loading={loading}
          isPartial={isPartial}
          actions={followUpActions}
          onFollowup={actions.runFollowup}
          onToggleRaw={actions.toggleRaw}
        />
      )}
      <Notices notices={notices} />

      {/* Metric cards strip is intentionally not rendered here: KPI cards without
          a delta / comparison violate "a value without a comparison is a stat, not
          a KPI" (Tremor/Refactoring UI). The metric_cards payload is preserved in
          raw JSON for consumers that explicitly want it. */}

      {error && !loading ? (
        <ErrorState message={error} onToggleRaw={actions.toggleRaw} />
      ) : loading && !hasPayload ? (
        <LoadingState />
      ) : !hasPayload ? (
        /* No empty-state copy. In production, this view only mounts in response
           to a tool call, so a payload is always on the way. Rendering nothing
           lets the iframe collapse to zero height until the result arrives. */
        null
      ) : (
        <div className="pt-panels">
          {loading && <LoadingState />}
          {renderedPanels.map(renderPanel)}
          {rawOpen && rawText ? <RawPanel rawText={rawText} /> : null}
        </div>
      )}

      <Drawer state={drawer} onClose={actions.closeDrawer} />
    </main>
  )
}
