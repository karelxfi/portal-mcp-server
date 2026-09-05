import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildEvidenceExport } from './export.js'

describe('buildEvidenceExport', () => {
  const payload = {
    _tool_contract: { name: 'portal_resolve_entity' },
    _meta: { network: 'base-mainnet' },
    _evidence: { result: { primary_evidence_path: 'matches' } },
    matches: [
      { symbol: '=CMD("calc")', name: '+SUM(A1)', note: '@import', delta: '-5', text: '-not a number', quoted: 'a"b' },
    ],
  }

  it('neutralises spreadsheet formulas and keeps numbers and JSON exact', () => {
    const csv = buildEvidenceExport(payload, 'csv')
    assert.equal(csv.mimeType, 'text/csv;charset=utf-8')
    assert.equal(csv.rowCount, 1)
    const row = csv.content.split('\r\n')[1]
    assert.equal(row.includes(`"'=CMD(""calc"")"`), true)
    assert.equal(row.includes(`"'+SUM(A1)"`), true)
    assert.equal(row.includes(`"'@import"`), true)
    assert.equal(row.includes('"-5"'), true)
    assert.equal(row.includes(`"'-not a number"`), true)
    assert.equal(row.includes('"a""b"'), true)

    const json = buildEvidenceExport(payload, 'json')
    const parsed = JSON.parse(json.content) as Record<string, any>
    assert.equal(JSON.stringify(parsed.matches ?? parsed.rows ?? parsed).includes('=CMD(\\"calc\\")'), true)
  })
})
