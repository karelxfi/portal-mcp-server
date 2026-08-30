type JsonRecord = Record<string, unknown>

export type EvidenceExport = {
  filename: string
  mimeType: string
  content: string
  rowCount: number
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value)
}

function getByPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)
}

function csvCell(value: unknown): string {
  let rendered = text(value)
  if (/^[=+@]/.test(rendered) || (/^-/.test(rendered) && !/^-\d+(?:\.\d+)?$/.test(rendered))) rendered = `'${rendered}`
  return `"${rendered.replaceAll('"', '""')}"`
}

function safePart(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

function evidenceRows(payload: JsonRecord): { path: string; rows: JsonRecord[] } {
  const evidence = isRecord(payload._evidence) ? payload._evidence : {}
  const result = isRecord(evidence.result) ? evidence.result : {}
  const declaredPath = typeof result.primary_evidence_path === 'string' ? result.primary_evidence_path : undefined
  const preferred = [
    declaredPath,
    'items',
    'fills',
    'candles',
    'ohlc',
    'time_series',
    'transactions',
    'transfers',
    'logs',
    'events',
    'calls',
    'instructions',
  ].filter((entry): entry is string => Boolean(entry))
  for (const path of preferred) {
    const value = getByPath(payload, path)
    if (Array.isArray(value)) return { path, rows: value.filter(isRecord) }
  }
  const scalar = Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => !key.startsWith('_') && !Array.isArray(value) && !isRecord(value)),
  )
  return { path: 'result', rows: Object.keys(scalar).length ? [scalar] : [] }
}

export function buildEvidenceExport(payload: JsonRecord, format: 'json' | 'csv'): EvidenceExport {
  const evidence = isRecord(payload._evidence) ? payload._evidence : {}
  const source = isRecord(evidence.source) ? evidence.source : {}
  const result = isRecord(evidence.result) ? evidence.result : {}
  const tool = text(evidence.tool || (isRecord(payload._tool_contract) ? payload._tool_contract.name : '') || 'result')
  const digest = text(result.exact_data_sha256).slice(0, 12) || 'unverified'
  const network = text(source.network || source.dataset)
  const stem = ['sqd', safePart(tool), safePart(network), digest].filter(Boolean).join('-')
  const located = evidenceRows(payload)

  if (format === 'json') {
    return {
      filename: `${stem}.json`,
      mimeType: 'application/json;charset=utf-8',
      content: JSON.stringify(payload, null, 2),
      rowCount: located.rows.length,
    }
  }

  const metadata = {
    sqd_evidence_sha256: text(result.exact_data_sha256),
    sqd_tool: tool,
    sqd_network: network,
    sqd_completeness: text(result.completeness),
    sqd_evidence_path: located.path,
  }
  const columns = Array.from(new Set(located.rows.flatMap((row) => Object.keys(row))))
  const headers = [...Object.keys(metadata), ...columns]
  const lines = [headers.map(csvCell).join(',')]
  for (const row of located.rows) {
    lines.push([...Object.values(metadata), ...columns.map((column) => row[column])].map(csvCell).join(','))
  }
  return {
    filename: `${stem}.csv`,
    mimeType: 'text/csv;charset=utf-8',
    content: `\uFEFF${lines.join('\r\n')}\r\n`,
    rowCount: located.rows.length,
  }
}

export function downloadEvidence(payload: JsonRecord, format: 'json' | 'csv'): EvidenceExport {
  const exported = buildEvidenceExport(payload, format)
  const blob = new Blob([exported.content], { type: exported.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exported.filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return exported
}
