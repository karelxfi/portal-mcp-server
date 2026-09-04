import {
  type Column,
  EVIDENCE_ANCHOR_ID,
  type EvidencePager,
  INLINE_TABLE_ROWS,
  type Panel,
  type PanelOptions,
  TABLE_PAGE_SIZE,
  asArray,
  card,
  displayLimitNotice,
  element,
  evidenceIdentity,
  formatValue,
  getByPath,
  humanize,
  identifierLink,
  isIdentifierColumn,
  isRecord,
  numeric,
  showDetails,
  text,
  withFocusKey,
} from './common.js'

export function tableDescriptor(
  payload: Record<string, unknown>,
  tableId: string,
): Record<string, unknown> | undefined {
  return asArray(payload.tables)
    .filter(isRecord)
    .find((entry) => entry.id === tableId)
}

function inferredColumns(rows: Record<string, unknown>[]): Column[] {
  if (!rows.length) return []
  const priority = [
    'timestamp_human',
    'block_number',
    'blockNumber',
    'coin',
    'type',
    'dir',
    'hash',
    'tx_hash',
    'sender',
    'from',
    'recipient',
    'to',
    'address',
    'value_formatted',
    'value',
    'volume_usd',
    'price',
    'px',
    'size',
    'sz',
    'status',
  ]
  const keys = Array.from(new Set(rows.slice(0, 20).flatMap((row) => Object.keys(row)))).filter(
    (key) => !key.startsWith('_') && !isRecord(rows[0]?.[key]) && !Array.isArray(rows[0]?.[key]),
  )
  keys.sort((a, b) => {
    const ai = priority.indexOf(a)
    const bi = priority.indexOf(b)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })
  const columns: Column[] = keys.slice(0, 9).map((key) => ({
    key,
    label: key === 'timestamp_human' ? 'Time' : humanize(key),
    align: typeof rows[0]?.[key] === 'number' ? 'right' : 'left',
    format: /address|hash|sender|recipient|^from$|^to$/.test(key)
      ? 'address'
      : /timestamp$/.test(key)
        ? 'timestamp'
        : typeof rows[0]?.[key] === 'number'
          ? 'decimal'
          : undefined,
  }))
  const nestedNumericField = Object.keys(rows[0] ?? {}).find((key) => {
    const value = rows[0]?.[key]
    return isRecord(value) && Object.values(value).some((entry) => typeof entry === 'number')
  })
  if (nestedNumericField && isRecord(rows[0]?.[nestedNumericField])) {
    for (const sub of Object.keys(rows[0][nestedNumericField] as Record<string, unknown>).slice(0, 4)) {
      columns.push({
        key: `${nestedNumericField}.${sub}`,
        path: `${nestedNumericField}.${sub}`,
        label: humanize(sub),
        align: 'right',
        format: 'decimal',
      })
    }
  }
  return columns.slice(0, 9)
}

export function tablePanel(payload: Record<string, unknown>, panel: Panel, options: PanelOptions): HTMLElement {
  const inline = options.mode === 'inline'
  const pageSize = inline ? INLINE_TABLE_ROWS : TABLE_PAGE_SIZE
  const descriptor = tableDescriptor(payload, text(panel.table_id)) ?? {}
  const rows = asArray(getByPath(payload, text(descriptor.data_key ?? panel.data_key ?? 'items'))).filter(isRecord)
  const columns = asArray(descriptor.columns).filter(isRecord) as Column[]
  const effectiveColumns = columns.length ? columns : inferredColumns(rows)
  const { root, body } = card(
    text(panel.title ?? descriptor.title ?? 'Evidence'),
    text(panel.subtitle ?? descriptor.subtitle),
    panel.emphasis === 'primary' ? 'sqd-card--primary' : '',
  )
  if (!rows.length || !effectiveColumns.length) {
    body.append(element('div', 'sqd-chart-empty', 'No evidence rows were returned for this section.'))
    return root
  }
  if (inline) {
    /* The inline card shows the first rows as a preview; filtering, sorting
       pages, and exact-row dialogs live in fullscreen. */
    const wrap = element('div', 'sqd-table-wrap')
    /* The preview has no focusable cells, so the sideways-scrolling region
       itself takes focus for keyboard users. */
    wrap.tabIndex = 0
    wrap.setAttribute('role', 'region')
    wrap.setAttribute('aria-label', `${text(panel.title ?? 'Evidence')} preview, scroll sideways for more columns`)
    const table = element('table', 'sqd-table')
    table.dataset.cols = String(effectiveColumns.length)
    table.append(element('caption', 'sqd-visually-hidden', text(panel.title ?? 'Blockchain evidence rows')))
    const thead = element('thead')
    const headRow = element('tr')
    for (const column of effectiveColumns) {
      const th = element('th', undefined, text(column.label ?? humanize(column.key)))
      th.dataset.align = column.align ?? 'left'
      headRow.append(th)
    }
    thead.append(headRow)
    table.append(thead)
    const tbody = element('tbody')
    for (const row of rows.slice(0, pageSize)) {
      const tr = element('tr')
      tr.dataset.evidenceKey = evidenceIdentity(row)
      tr.dataset.selected = 'false'
      for (const column of effectiveColumns) {
        const td = element('td')
        td.dataset.align = column.align ?? 'left'
        const rawValue = getByPath(row, column.path ?? column.key)
        const missing = rawValue === null || rawValue === undefined || rawValue === ''
        const formatted = missing ? '' : formatValue(rawValue, column.format, column.unit)
        if (missing) td.setAttribute('aria-label', 'Not available')
        if (isIdentifierColumn(column, rawValue)) td.classList.add('sqd-hash')
        const cellLink = missing
          ? null
          : identifierLink(payload, column.key, text(rawValue), options.actions, formatted)
        if (cellLink) td.append(cellLink)
        else {
          td.textContent = formatted
          td.title = formatted
        }
        tr.append(td)
      }
      tbody.append(tr)
    }
    table.append(tbody)
    wrap.append(table)
    body.append(wrap)
    const declaredRows = Number(descriptor.row_count)
    const totalRows = Number.isFinite(declaredRows) ? Math.max(rows.length, declaredRows) : rows.length
    if (totalRows > pageSize) {
      body.append(
        element(
          'p',
          'sqd-table-more',
          `${Math.min(rows.length, pageSize)} of ${totalRows} rows shown. Open full screen to filter, sort, and page through every row.`,
        ),
      )
    }
    return root
  }
  const tools = element('div', 'sqd-table-tools')
  const search = withFocusKey(element('input', 'sqd-input'), 'table-search')
  search.type = 'search'
  search.placeholder = 'Filter result evidence'
  search.setAttribute('aria-label', `Filter ${text(panel.title ?? 'evidence')} rows`)
  tools.append(search)
  const count = element('span', 'sqd-brand-subtitle')
  tools.append(count)
  body.append(tools)
  const wrap = element('div', 'sqd-table-wrap')
  if (!document.getElementById(EVIDENCE_ANCHOR_ID)) wrap.id = EVIDENCE_ANCHOR_ID
  const table = element('table', 'sqd-table')
  table.dataset.cols = String(effectiveColumns.length)
  const caption = element('caption', 'sqd-visually-hidden', text(panel.title ?? 'Blockchain evidence rows'))
  table.append(caption)
  const thead = element('thead')
  const headRow = element('tr')
  let sortKey = ''
  let sortDirection: 'asc' | 'desc' = 'asc'
  let filter = ''
  let pageIndex = 0
  const headerByKey = new Map<string, HTMLTableCellElement>()
  for (const column of effectiveColumns) {
    const th = element('th')
    th.dataset.align = column.align ?? 'left'
    th.setAttribute('aria-sort', 'none')
    headerByKey.set(column.key, th)
    const button = withFocusKey(
      element('button', 'sqd-sort', text(column.label ?? humanize(column.key))),
      `table-sort:${text(column.key)}`,
    )
    button.type = 'button'
    button.addEventListener('click', () => {
      sortDirection = sortKey === column.key && sortDirection === 'asc' ? 'desc' : 'asc'
      sortKey = column.key
      headerByKey.forEach((header, key) =>
        header.setAttribute(
          'aria-sort',
          key === sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none',
        ),
      )
      pageIndex = 0
      renderBody()
    })
    th.append(button)
    headRow.append(th)
  }
  thead.append(headRow)
  table.append(thead)
  const tbody = element('tbody')
  table.append(tbody)
  wrap.append(table)
  body.append(wrap)
  const pagination = element('nav', 'sqd-table-pagination')
  pagination.setAttribute('aria-label', `${text(panel.title ?? 'Evidence')} table pages`)
  const previous = withFocusKey(element('button', 'sqd-button', 'Previous rows'), 'table-previous')
  previous.type = 'button'
  const pageStatus = element('span', 'sqd-brand-subtitle')
  pageStatus.setAttribute('aria-live', 'polite')
  const next = withFocusKey(element('button', 'sqd-button', 'Next rows'), 'table-next')
  next.type = 'button'
  pagination.append(previous, pageStatus, next)
  body.append(pagination)

  function computeMatches(): Record<string, unknown>[] {
    const matches = rows.filter((row) => !filter || JSON.stringify(row).toLowerCase().includes(filter))
    if (sortKey)
      matches.sort(
        (a, b) =>
          text(getByPath(a, effectiveColumns.find((column) => column.key === sortKey)?.path ?? sortKey)).localeCompare(
            text(getByPath(b, effectiveColumns.find((column) => column.key === sortKey)?.path ?? sortKey)),
            undefined,
            { numeric: true },
          ) * (sortDirection === 'asc' ? 1 : -1),
      )
    return matches
  }

  ;(wrap as EvidencePager).__sqdShowEvidence = (identity: string) => {
    const position = computeMatches().findIndex((row) => evidenceIdentity(row) === identity)
    if (position < 0) return
    const targetPage = Math.floor(position / pageSize)
    if (targetPage !== pageIndex) {
      pageIndex = targetPage
      renderBody()
    }
  }

  function renderBody() {
    const matches = computeMatches()
    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize))
    pageIndex = Math.min(pageIndex, totalPages - 1)
    const pageStart = pageIndex * pageSize
    const visible = matches.slice(pageStart, pageStart + pageSize)
    count.textContent = `${matches.length} matching row${matches.length === 1 ? '' : 's'}`
    pageStatus.textContent = `Page ${pageIndex + 1} of ${totalPages}`
    previous.disabled = pageIndex === 0
    next.disabled = pageIndex >= totalPages - 1
    pagination.hidden = matches.length <= pageSize
    tbody.replaceChildren()
    for (const [index, row] of visible.entries()) {
      const tr = element('tr')
      tr.dataset.evidenceKey = evidenceIdentity(row)
      tr.dataset.selected = 'false'
      for (const [columnIndex, column] of effectiveColumns.entries()) {
        const td = element('td')
        td.dataset.align = column.align ?? 'left'
        const rawValue = getByPath(row, column.path ?? column.key)
        const missing = rawValue === null || rawValue === undefined || rawValue === ''
        const formatted = missing ? '' : formatValue(rawValue, column.format, column.unit)
        if (missing) td.setAttribute('aria-label', 'Not available')
        if (isIdentifierColumn(column, rawValue)) td.classList.add('sqd-hash')
        if (column.format === 'signed' || /^(direction|change|net)/.test(column.key)) {
          const signedValue = numeric(rawValue)
          if (signedValue !== undefined && signedValue !== 0) {
            td.dataset.signed = signedValue > 0 ? 'positive' : 'negative'
          }
        }
        if (columnIndex === 0) {
          const button = element('button', 'sqd-row-button', formatted)
          button.type = 'button'
          button.title = 'Open exact row'
          button.addEventListener('click', () => showDetails(`Evidence row ${pageStart + index + 1}`, row))
          td.append(button)
        } else {
          const cellLink = missing
            ? null
            : identifierLink(payload, column.key, text(rawValue), options.actions, formatted)
          if (cellLink) td.append(cellLink)
          else {
            td.textContent = formatted
            td.title = formatted
          }
        }
        tr.append(td)
      }
      tbody.append(tr)
    }
  }
  search.addEventListener('input', () => {
    filter = search.value.trim().toLowerCase()
    pageIndex = 0
    renderBody()
  })
  previous.addEventListener('click', () => {
    pageIndex = Math.max(0, pageIndex - 1)
    renderBody()
  })
  next.addEventListener('click', () => {
    pageIndex += 1
    renderBody()
  })
  renderBody()
  const declaredRows = Number(descriptor.row_count)
  const totalRows = Number.isFinite(declaredRows) ? Math.max(rows.length, declaredRows) : rows.length
  const limitNotice = displayLimitNotice('evidence rows', Math.min(rows.length, pageSize), rows.length, totalRows)
  if (limitNotice) body.append(limitNotice)
  return root
}

/* Inline points at full screen. Full screen shows a short page with one
   control that reveals every row already in the result, then folds back. */
export function panelLimit(
  label: string,
  shown: number,
  available: number,
  options: PanelOptions,
  toggle?: { expanded: boolean; pageSize: number; onToggle: (expanded: boolean) => void },
): HTMLElement[] {
  if (!toggle && shown >= available) return []
  if (options.mode === 'inline') {
    return [element('p', 'sqd-table-more', `${shown} of ${available} ${label} shown. Open full screen for every row.`)]
  }
  if (!toggle) {
    const limitNotice = displayLimitNotice(label, shown, available)
    return limitNotice ? [limitNotice] : []
  }
  if (available <= toggle.pageSize) return []
  const line = element('p', 'sqd-table-more')
  line.append(element('span', 'sqd-table-more-copy', `${shown} of ${available} ${label}`))
  const button = element(
    'button',
    'sqd-more-button',
    toggle.expanded ? `Show ${toggle.pageSize}` : `Show all ${available}`,
  )
  button.type = 'button'
  button.addEventListener('click', () => toggle.onToggle(!toggle.expanded))
  line.append(button)
  return [line]
}
