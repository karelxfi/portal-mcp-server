/* Exact Bitcoin fee accounting shared by the analytics and time-series
   tools. A block's fees are the non-coinbase input value minus the
   non-coinbase output value, summed in satoshis; BTC strings appear only at
   the edge of the response. */

import { PORTAL_URL } from '../constants/index.js'
import { portalFetchStreamRange } from './fetch.js'

export type BitcoinBlockFees = {
  block_number: number
  timestamp: number
  fee_sats: bigint
  /* Transactions other than the coinbase, counted from distinct output
     transaction indexes because every transaction has at least one output. */
  transaction_count: number
  input_count: number
  output_count: number
}

export type BitcoinFeeComputation = {
  blocks: BitcoinBlockFees[]
  /* Blocks seen in only one of the two record sets, or with a non-coinbase
     input whose previous output value is unknown. They are excluded from
     every total so a partial block never looks like a whole one. */
  excluded_blocks: number[]
}

export type BitcoinFeeTotals = {
  blocks: number
  transactions: number
  total_fee_sats: bigint
  fees_per_block_sats: bigint
  avg_fee_per_tx_sats: bigint
}

export const SATS_PER_BTC = 100_000_000n

/* Portal serialises Bitcoin amounts as BTC decimals (numbers or strings).
   Eight fractional digits are exact in satoshis. */
export function btcToSats(value: unknown): bigint | undefined {
  let text =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number' && Number.isFinite(value)
        ? value.toFixed(8)
        : ''
  if (/e/i.test(text)) {
    const numeric = Number(text)
    text = Number.isFinite(numeric) ? numeric.toFixed(8) : ''
  }
  const match = /^(-?)(\d+)(?:\.(\d{0,8}))?$/.exec(text)
  if (!match) return undefined
  const magnitude = BigInt(match[2]) * SATS_PER_BTC + BigInt((match[3] ?? '').padEnd(8, '0') || '0')
  return match[1] ? -magnitude : magnitude
}

export function satsToBtcString(value: bigint): string {
  const sign = value < 0n ? '-' : ''
  const absolute = value < 0n ? -value : value
  const integer = absolute / SATS_PER_BTC
  const fraction = (absolute % SATS_PER_BTC).toString().padStart(8, '0').replace(/0+$/, '')
  return fraction ? `${sign}${integer}.${fraction}` : `${sign}${integer}`
}

type StreamRecord = {
  header?: { number?: number; timestamp?: number }
  number?: number
  timestamp?: number
  inputs?: Array<{ transactionIndex?: number; prevoutValue?: unknown }>
  outputs?: Array<{ transactionIndex?: number; value?: unknown }>
}

function recordBlockNumber(record: StreamRecord): number | undefined {
  const number = record.header?.number ?? record.number
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

function recordTimestamp(record: StreamRecord): number {
  const timestamp = record.header?.timestamp ?? record.timestamp
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : 0
}

/* Pure: turns Portal stream records into per-block fee rows. Inputs and
   outputs may come from one combined stream (pass the same array twice) or
   from two separate streams; only blocks present in both count. */
export function computeBitcoinBlockFees(params: {
  inputRecords: unknown[]
  outputRecords: unknown[]
}): BitcoinFeeComputation {
  type Partial = { timestamp: number; inputSats: bigint; inputs: number; unknownInputs: number }
  const inputsByBlock = new Map<number, Partial>()
  for (const raw of params.inputRecords as StreamRecord[]) {
    const number = recordBlockNumber(raw)
    if (number === undefined || !Array.isArray(raw.inputs)) continue
    const entry = inputsByBlock.get(number) ?? {
      timestamp: recordTimestamp(raw),
      inputSats: 0n,
      inputs: 0,
      unknownInputs: 0,
    }
    for (const input of raw.inputs) {
      entry.inputs += 1
      if (input.transactionIndex === 0) continue
      const sats = btcToSats(input.prevoutValue)
      if (sats === undefined) entry.unknownInputs += 1
      else entry.inputSats += sats
    }
    inputsByBlock.set(number, entry)
  }

  type OutputPartial = {
    timestamp: number
    outputSats: bigint
    outputs: number
    txIndexes: Set<number>
    unknownOutputs: number
  }
  const outputsByBlock = new Map<number, OutputPartial>()
  for (const raw of params.outputRecords as StreamRecord[]) {
    const number = recordBlockNumber(raw)
    if (number === undefined || !Array.isArray(raw.outputs)) continue
    const entry = outputsByBlock.get(number) ?? {
      timestamp: recordTimestamp(raw),
      outputSats: 0n,
      outputs: 0,
      txIndexes: new Set<number>(),
      unknownOutputs: 0,
    }
    for (const output of raw.outputs) {
      entry.outputs += 1
      if (typeof output.transactionIndex === 'number') entry.txIndexes.add(output.transactionIndex)
      if (output.transactionIndex === 0) continue
      const sats = btcToSats(output.value)
      if (sats === undefined) entry.unknownOutputs += 1
      else entry.outputSats += sats
    }
    outputsByBlock.set(number, entry)
  }

  const numbers = new Set<number>([...inputsByBlock.keys(), ...outputsByBlock.keys()])
  const blocks: BitcoinBlockFees[] = []
  const excluded: number[] = []
  for (const number of [...numbers].sort((left, right) => left - right)) {
    const inputs = inputsByBlock.get(number)
    const outputs = outputsByBlock.get(number)
    if (!inputs || !outputs || inputs.unknownInputs > 0 || outputs.unknownOutputs > 0) {
      excluded.push(number)
      continue
    }
    const fee = inputs.inputSats - outputs.outputSats
    blocks.push({
      block_number: number,
      timestamp: inputs.timestamp || outputs.timestamp,
      fee_sats: fee < 0n ? 0n : fee,
      transaction_count: [...outputs.txIndexes].filter((index) => index !== 0).length,
      input_count: inputs.inputs,
      output_count: outputs.outputs,
    })
  }
  return { blocks, excluded_blocks: excluded }
}

export function totalBitcoinFees(blocks: BitcoinBlockFees[]): BitcoinFeeTotals {
  const totalFeeSats = blocks.reduce((sum, block) => sum + block.fee_sats, 0n)
  const transactions = blocks.reduce((sum, block) => sum + block.transaction_count, 0)
  return {
    blocks: blocks.length,
    transactions,
    total_fee_sats: totalFeeSats,
    fees_per_block_sats: blocks.length > 0 ? totalFeeSats / BigInt(blocks.length) : 0n,
    avg_fee_per_tx_sats: transactions > 0 ? totalFeeSats / BigInt(transactions) : 0n,
  }
}

const FEE_STREAM_FIELDS = {
  block: { number: true, timestamp: true },
  input: { prevoutValue: true, transactionIndex: true },
  output: { value: true, transactionIndex: true },
}

/* One Portal stream carries a block's inputs and outputs together, about one
   megabyte per mainnet block, so ranges are fetched in small chunks with
   bounded concurrency. */
export async function fetchBitcoinBlockFees(params: {
  dataset: string
  fromBlock: number
  toBlock: number
  chunkBlocks?: number
  concurrency?: number
  maxBytes?: number
}): Promise<BitcoinFeeComputation> {
  const chunkBlocks = Math.max(1, params.chunkBlocks ?? 6)
  const concurrency = Math.max(1, params.concurrency ?? 3)
  const ranges: [number, number][] = []
  for (let from = params.fromBlock; from <= params.toBlock; from += chunkBlocks) {
    ranges.push([from, Math.min(from + chunkBlocks - 1, params.toBlock)])
  }
  const records: unknown[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ranges.length) }, async () => {
      while (next < ranges.length) {
        const [from, to] = ranges[next++]
        const chunk = await portalFetchStreamRange(
          `${PORTAL_URL}/datasets/${params.dataset}/stream`,
          {
            type: 'bitcoin',
            fromBlock: from,
            toBlock: to,
            includeAllBlocks: true,
            fields: FEE_STREAM_FIELDS,
            inputs: [{}],
            outputs: [{}],
          },
          { maxBytes: params.maxBytes ?? 100 * 1024 * 1024 },
        )
        records.push(...chunk)
      }
    }),
  )
  const computed = computeBitcoinBlockFees({ inputRecords: records, outputRecords: records })
  /* Blocks Portal did not return at all are excluded too, so the caller's
     block count is the number of blocks actually accounted for. */
  const returned = new Set(computed.blocks.map((block) => block.block_number))
  for (let number = params.fromBlock; number <= params.toBlock; number += 1) {
    if (!returned.has(number) && !computed.excluded_blocks.includes(number)) computed.excluded_blocks.push(number)
  }
  computed.excluded_blocks.sort((left, right) => left - right)
  return computed
}
