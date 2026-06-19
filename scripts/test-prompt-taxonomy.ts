#!/usr/bin/env tsx

import { classify } from './prompt-taxonomy.ts'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const cases: Array<{ prompt: string; expected: string }> = [
  {
    prompt: 'Show the last 200 BTC perp fills on Hyperliquid with price, size, side, and raw rows only.',
    expected: 'raw_export',
  },
  {
    prompt: 'Can you give me 20000 rows?',
    expected: 'raw_export',
  },
  {
    prompt: 'Give me 20,000 rows of Hyperliquid BTC fills.',
    expected: 'raw_export',
  },
  {
    prompt: 'Give me 20k rows as NDJSON.',
    expected: 'raw_export',
  },
  {
    prompt: 'Return the latest 20,000 Hyperliquid BTC fills as raw rows, no tool chatter.',
    expected: 'raw_export',
  },
  {
    prompt: 'Export BTC perp fills to NDJSON and hand me the file, not a summary.',
    expected: 'raw_export',
  },
  {
    prompt: 'No progress updates; just fetch recent Hyperliquid fills.',
    expected: 'raw_export',
  },
  {
    prompt: 'Export Base USDC transfers to CSV with tx hashes.',
    expected: 'raw_export',
  },
  {
    prompt: 'This Base chart should become a recurring dashboard backed by a data pipeline.',
    expected: 'durable_pipeline',
  },
  {
    prompt: 'Create a Pipes SDK backfill for this Portal query.',
    expected: 'durable_pipeline',
  },
  {
    prompt: 'Summarize this wallet and its counterparties.',
    expected: 'wallet_investigation',
  },
  {
    prompt: 'Chart transaction throughput on Base in 15-minute buckets.',
    expected: 'time_series',
  },
]

for (const testCase of cases) {
  const actual = classify(testCase.prompt)
  assert(actual === testCase.expected, `"${testCase.prompt}" should classify as ${testCase.expected}, got ${actual}`)
}

console.log(`Prompt taxonomy tests passed: ${cases.length} routing labels are stable`)
