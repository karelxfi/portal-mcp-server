import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Button, Card, Text } from '../components/primitives.js'
import {
  asArray,
  compareValues,
  formatValue,
  getByPath,
  isRecord,
  stringifyCellValue,
} from '../format.js'

type Column = {
  key: string
  label: string
  kind?: string
  format?: string
  unit?: string
  align?: 'left' | 'right'
  path?: string
}

type TableDescriptor = {
  id: string
  title?: string
  subtitle?: string
  data_key: string
  columns: Column[]
  default_sort?: { key?: string; direction?: 'asc' | 'desc' }
  interactions?: {
    sortable?: boolean
    searchable?: boolean
    default_page_size?: number
  }
}

export type TablePanel = {
  kind: 'table_panel'
  title?: string
  subtitle?: string
  table_id: string
}

const VIRTUAL_THRESHOLD = 50

export function TablePanelView({
  panel,
  payload,
  onRowClick,
}: {
  panel: TablePanel
  payload: unknown
  onRowClick?: (title: string, row: unknown) => void
}) {
  const descriptor = useMemo<TableDescriptor | undefined>(() => {
    const tables = asArray<TableDescriptor>((payload as Record<string, unknown>)?.tables)
    return tables.find((d) => isRecord(d) && d.id === panel.table_id)
  }, [panel, payload])

  const allRows = useMemo(
    () => (descriptor ? asArray<Record<string, unknown>>(getByPath(payload, descriptor.data_key)) : []),
    [descriptor, payload],
  )

  const defaultSortKey = descriptor?.default_sort?.key || descriptor?.columns[0]?.key || ''
  const defaultSortDir = descriptor?.default_sort?.direction || 'desc'

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState(defaultSortKey)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir)

  useEffect(() => {
    setSortKey(defaultSortKey)
    setSortDir(defaultSortDir)
  }, [defaultSortDir, defaultSortKey])

  const searchEnabled = descriptor?.interactions?.searchable !== false
  const sortable = descriptor?.interactions?.sortable !== false

  const filtered = useMemo(() => {
    if (!descriptor) return []
    if (!search.trim()) return allRows
    const needle = search.trim().toLowerCase()
    return allRows.filter((row) =>
      descriptor.columns.some((col) =>
        stringifyCellValue(getByPath(row, col.path || col.key)).toLowerCase().includes(needle),
      ),
    )
  }, [allRows, descriptor, search])

  const sorted = useMemo(() => {
    if (!descriptor) return []
    const col = descriptor.columns.find((c) => c.key === sortKey) || descriptor.columns[0]
    if (!col) return filtered
    return [...filtered].sort((a, b) =>
      compareValues(getByPath(a, col.path || col.key), getByPath(b, col.path || col.key), sortDir),
    )
  }, [filtered, descriptor, sortKey, sortDir])

  const handleSort = (key: string) => {
    if (!sortable) return
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const virtualize = sorted.length > VIRTUAL_THRESHOLD
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 8,
    enabled: virtualize,
  })

  if (!descriptor) {
    return (
      <Card title={panel.title || 'Table'} subtitle={panel.subtitle} span="full">
        <Text tone="muted">No table metadata is available for this section.</Text>
      </Card>
    )
  }

  return (
    <Card title={panel.title || descriptor.title} subtitle={panel.subtitle || descriptor.subtitle} span="full" bodyFlush>
      <div className="pt-table-tools">
        {searchEnabled ? (
          <input
            className="pt-input"
            type="search"
            placeholder="Search rows"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        ) : (
          <div />
        )}
        <Text variant="caption" tone="subtle">
          {sorted.length.toLocaleString()} {sorted.length === 1 ? 'row' : 'rows'}
        </Text>
      </div>
      <div
        className="pt-table-wrap"
        ref={scrollRef}
        style={{ maxHeight: virtualize ? 560 : undefined }}
      >
        <table className="pt-table">
          <thead>
            <tr>
              {descriptor.columns.map((col) => {
                const active = col.key === sortKey
                return (
                  <th
                    key={col.key}
                    className={
                      (sortable ? 'pt-th--sortable ' : '') + (active ? 'pt-th--active' : '')
                    }
                    onClick={() => handleSort(col.key)}
                    style={{ textAlign: col.align === 'right' ? 'right' : 'left' }}
                  >
                    {col.label}
                    {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {virtualize ? (
              <tr>
                <td colSpan={descriptor.columns.length} style={{ padding: 0 }}>
                  <div
                    style={{
                      height: rowVirtualizer.getTotalSize(),
                      position: 'relative',
                      width: '100%',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((vRow) => {
                      const row = sorted[vRow.index]!
                      return (
                        <div
                          key={vRow.key}
                          onClick={() =>
                            onRowClick?.(`${descriptor.title || 'Row'} #${vRow.index + 1}`, row)
                          }
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            transform: `translateY(${vRow.start}px)`,
                            height: vRow.size,
                            display: 'grid',
                            gridTemplateColumns: `repeat(${descriptor.columns.length}, minmax(0, 1fr))`,
                            alignItems: 'center',
                            padding: '0 14px',
                            borderBottom: '1px solid var(--pt-border)',
                            cursor: 'pointer',
                            fontSize: 13,
                          }}
                        >
                          {descriptor.columns.map((col) => {
                            const value = getByPath(row, col.path || col.key)
                            return (
                              <span
                                key={col.key}
                                title={stringifyCellValue(value)}
                                style={{
                                  textAlign: col.align === 'right' ? 'right' : 'left',
                                  fontFamily:
                                    col.format === 'address' || col.kind === 'dimension'
                                      ? 'var(--pt-font-mono)'
                                      : undefined,
                                  fontSize:
                                    col.format === 'address' || col.kind === 'dimension'
                                      ? 12.5
                                      : 13,
                                  color:
                                    col.kind === 'rank'
                                      ? 'var(--pt-text-subtle)'
                                      : 'var(--pt-text)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  padding: '0 8px',
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {formatValue(value, col.format, col.unit)}
                              </span>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </td>
              </tr>
            ) : sorted.length ? (
              sorted.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => onRowClick?.(`${descriptor.title || 'Row'} #${i + 1}`, row)}
                >
                  {descriptor.columns.map((col) => {
                    const value = getByPath(row, col.path || col.key)
                    const cls = [
                      col.align === 'right' && 'pt-td--right',
                      (col.format === 'address' || col.kind === 'dimension') && 'pt-td--mono',
                      col.kind === 'rank' && 'pt-td--rank',
                    ]
                      .filter(Boolean)
                      .join(' ')
                    return (
                      <td
                        key={col.key}
                        className={cls}
                        title={stringifyCellValue(value)}
                        data-label={col.label}
                      >
                        {formatValue(value, col.format, col.unit)}
                      </td>
                    )
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={descriptor.columns.length} style={{ textAlign: 'center', color: 'var(--pt-text-subtle)', padding: 28 }}>
                  No rows match the current view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
