#!/usr/bin/env tsx

import {
  attachEvidenceReceipt,
  buildEvidenceReceipt,
  canonicalizeEvidenceValue,
  stableEvidenceJson,
} from '../src/helpers/evidence-receipt.ts'
import { assert } from './test-helpers.ts'

const completePayload = {
  items: [
    { block_number: 2, hash: '0x2', value: '900719925474099312345' },
    { block_number: 3, hash: '0x3', value: '-1' },
  ],
  _meta: { network: 'base-mainnet', dataset: 'base-mainnet', response_time_ms: 12 },
  _coverage: {
    kind: 'block_window',
    window_complete: true,
    result_complete: true,
    window_from_block: 2,
    window_to_block: 3,
    returned_items: 2,
  },
  _freshness: { kind: 'query_window', finality: 'finalized', indexed_head_block: 3, window_to_block: 3 },
  _ordering: { kind: 'chronological_page', sorted_by: 'block_number', direction: 'asc' },
  _pagination: { type: 'cursor', page_size: 10, returned: 2, has_more: false },
  _execution: { kind: 'block_window', from_block: 2, to_block: 3 },
  answer: 'Two exact rows.',
  display: { title: 'Rows' },
  next_steps: { actions: [] },
  investigation: { version: 'portal_investigation_v1' },
  _llm: { version: 'portal_llm_v1' },
  _tool_contract: { name: 'portal_evm_query_transactions' },
}

function main() {
  const args = { to_block: 3, network: 'base-mainnet', from_block: 2, unused: undefined }
  const reorderedArgs = { from_block: 2, unused: undefined, network: 'base-mainnet', to_block: 3 }
  assert(
    stableEvidenceJson(args) === stableEvidenceJson(reorderedArgs),
    'canonical JSON should ignore input key order and undefined object fields',
  )
  assert(
    stableEvidenceJson(canonicalizeEvidenceValue([1, undefined, 3])) === '[1,null,3]',
    'canonical arrays should retain positional gaps as null',
  )

  const receipt = buildEvidenceReceipt('portal_evm_query_transactions', args, completePayload)
  const sameReceipt = buildEvidenceReceipt(
    'portal_evm_query_transactions',
    reorderedArgs,
    { ...completePayload, _meta: { ...completePayload._meta, response_time_ms: 999 } },
  )
  assert(receipt.version === 'sqd_evidence_v1', 'receipt should use the documented version')
  assert(receipt.source.query_type === 'evm', 'receipt should classify EVM tools')
  assert(receipt.source.dataset === 'base-mainnet', 'receipt should identify the exact dataset')
  assert(receipt.request.arguments_sha256 === sameReceipt.request.arguments_sha256, 'argument digest should be stable')
  assert(receipt.result.exact_data_sha256 === sameReceipt.result.exact_data_sha256, 'timing must not alter exact-data digest')
  assert(receipt.result.row_count === 2, 'receipt should count exact primary rows')
  assert(receipt.result.primary_evidence_path === 'items', 'receipt should locate primary evidence')
  assert(receipt.result.completeness === 'complete', 'receipt should prove complete results')
  assert(receipt.request.analyzed_window?.window_from_block === 2, 'receipt should expose the analyzed window')
  assert(
    receipt.replay.arguments_path === '_evidence.request.arguments',
    'receipt should replay the canonical tool field and arguments without duplicating them',
  )
  assert(receipt.replay.mode === 'exact', 'fixed block bounds should be marked as exact replay')
  const relativeReceipt = buildEvidenceReceipt(
    'portal_hyperliquid_get_ohlc',
    { network: 'hyperliquid-fills', coin: 'BTC', duration: '5m', interval: '1m' },
    completePayload,
  )
  assert(
    relativeReceipt.replay.mode === 'semantic',
    'relative windows should not claim that a later replay reproduces the same snapshot',
  )

  const reorderedRows = buildEvidenceReceipt('portal_evm_query_transactions', args, {
    ...completePayload,
    items: [...completePayload.items].reverse(),
  })
  assert(
    reorderedRows.result.exact_data_sha256 !== receipt.result.exact_data_sha256,
    'row order should be part of exact evidence',
  )

  const partial = buildEvidenceReceipt('portal_evm_query_transactions', args, {
    ...completePayload,
    _coverage: { ...completePayload._coverage, result_complete: false },
    _pagination: { ...completePayload._pagination, has_more: true, next_cursor: 'opaque' },
  })
  assert(partial.result.completeness === 'partial', 'continuable results should be partial')
  assert(
    partial.result.partial_reasons?.includes('more_matching_results_exist') === true &&
      partial.result.partial_reasons?.includes('continuation_available') === true,
    'partial receipt should explain every material reason',
  )

  const wrapped = attachEvidenceReceipt('portal_evm_query_transactions', args, {
    content: [{ type: 'text', text: JSON.stringify(completePayload) }],
    structuredContent: completePayload,
  }) as any
  assert(wrapped.structuredContent._evidence.version === 'sqd_evidence_v1', 'server wrapper should attach receipt')
  assert(
    stableEvidenceJson(JSON.parse(wrapped.content[0].text)) === stableEvidenceJson(wrapped.structuredContent),
    'text and structured results should remain exactly equivalent',
  )

  console.log('PASS  canonical evidence receipts are stable, complete, replay-honest, and lossless')
}

main()
