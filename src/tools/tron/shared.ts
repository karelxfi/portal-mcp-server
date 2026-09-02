import { resolveDataset } from '../../cache/datasets.js'
import { detectChainType } from '../../helpers/chain.js'
import { ActionableError, createUnsupportedChainError } from '../../helpers/errors.js'
import {
  normalizeTronInternalTransactionResult,
  normalizeTronLogResult,
  normalizeTronTransactionResult,
} from '../../helpers/normalized-results.js'
import { TronInputError } from '../../helpers/tron.js'

export const TRON_DEFAULT_DATASET = 'tron-mainnet'

type RecordLike = Record<string, unknown>

type TronBlockRecord = {
  header?: { number?: number; hash?: string; timestamp?: number }
  transactions?: RecordLike[]
  logs?: RecordLike[]
  internalTransactions?: RecordLike[]
}

export type TronTransactionItem = RecordLike & {
  block_number?: number
  transactionIndex?: number
  hash?: string
}

export type TronLogItem = RecordLike & {
  block_number?: number
  transactionIndex?: number
  logIndex?: number
}

/** Resolve the network and refuse anything that is not the native Tron dataset. */
export async function resolveTronDataset(toolName: string, network: string | undefined): Promise<string> {
  const dataset = network ? await resolveDataset(network) : TRON_DEFAULT_DATASET
  const chainType = detectChainType(dataset)
  if (chainType !== 'tron') {
    throw createUnsupportedChainError({
      toolName,
      dataset,
      actualChainType: chainType,
      supportedChains: ['tron'],
      suggestions: [
        'Use portal_evm_query_transactions or portal_evm_query_logs for Ethereum-compatible networks.',
        'Use portal_list_networks with query="tron" to find the Tron dataset.',
      ],
    })
  }
  return dataset
}

/** Turn a Tron input problem into the structured client_input error before any Portal request. */
export function toTronInputError(error: unknown): unknown {
  if (error instanceof TronInputError) {
    return new ActionableError(error.message, error.suggestions, undefined, {
      code: 'invalid_request',
      origin: 'client_input',
      retryable: false,
    })
  }
  return error
}

export function tronValidationError(message: string, suggestions: string[]): ActionableError {
  return new ActionableError(message, suggestions, undefined, {
    code: 'invalid_request',
    origin: 'client_input',
    retryable: false,
  })
}

function toIndex(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function blockContext(block: TronBlockRecord) {
  const header = block.header ?? {}
  return {
    ...(typeof header.number === 'number' ? { block_number: header.number } : {}),
    ...(typeof header.hash === 'string' ? { block_hash: header.hash } : {}),
    ...(typeof header.timestamp === 'number' ? { block_timestamp: header.timestamp } : {}),
  }
}

/**
 * Flatten Portal block records into transaction rows. Logs and internal
 * transactions requested inline are joined to their parent by transactionIndex.
 */
export function flattenTronTransactions(
  blocks: unknown[],
  options: { includeLogs: boolean; includeInternalTransactions: boolean },
): TronTransactionItem[] {
  const rows: TronTransactionItem[] = []
  for (const rawBlock of blocks) {
    const block = rawBlock as TronBlockRecord
    const context = blockContext(block)
    const transactions = block.transactions ?? []
    const hashByIndex = new Map<number, string>()
    for (const transaction of transactions) {
      const index = toIndex(transaction.transactionIndex)
      if (index !== undefined && typeof transaction.hash === 'string') hashByIndex.set(index, transaction.hash)
    }
    const logsByIndex = new Map<number, RecordLike[]>()
    if (options.includeLogs) {
      for (const log of block.logs ?? []) {
        const index = toIndex(log.transactionIndex)
        if (index === undefined) continue
        const list = logsByIndex.get(index) ?? []
        list.push(normalizeTronLogResult({ ...log, ...context, tx_hash: hashByIndex.get(index) }))
        logsByIndex.set(index, list)
      }
    }
    const internalByIndex = new Map<number, RecordLike[]>()
    if (options.includeInternalTransactions) {
      for (const internal of block.internalTransactions ?? []) {
        const index = toIndex(internal.transactionIndex)
        if (index === undefined) continue
        const list = internalByIndex.get(index) ?? []
        list.push(normalizeTronInternalTransactionResult({ ...internal, ...context, tx_hash: hashByIndex.get(index) }))
        internalByIndex.set(index, list)
      }
    }
    for (const transaction of transactions) {
      const index = toIndex(transaction.transactionIndex)
      rows.push(
        normalizeTronTransactionResult({
          ...transaction,
          ...context,
          ...(options.includeLogs ? { logs: index !== undefined ? (logsByIndex.get(index) ?? []) : [] } : {}),
          ...(options.includeInternalTransactions
            ? { internal_transactions: index !== undefined ? (internalByIndex.get(index) ?? []) : [] }
            : {}),
        }) as TronTransactionItem,
      )
    }
  }
  return rows
}

/** Flatten Portal block records into log rows with the parent transaction hash on every row. */
export function flattenTronLogs(blocks: unknown[], options: { includeTransaction: boolean }): TronLogItem[] {
  const rows: TronLogItem[] = []
  for (const rawBlock of blocks) {
    const block = rawBlock as TronBlockRecord
    const context = blockContext(block)
    const transactionsByIndex = new Map<number, RecordLike>()
    for (const transaction of block.transactions ?? []) {
      const index = toIndex(transaction.transactionIndex)
      if (index !== undefined) transactionsByIndex.set(index, transaction)
    }
    for (const log of block.logs ?? []) {
      const index = toIndex(log.transactionIndex)
      const parent = index !== undefined ? transactionsByIndex.get(index) : undefined
      rows.push(
        normalizeTronLogResult({
          ...log,
          ...context,
          ...(typeof parent?.hash === 'string' ? { tx_hash: parent.hash } : {}),
          ...(options.includeTransaction && parent
            ? { transaction: normalizeTronTransactionResult({ ...parent, ...context }) }
            : {}),
        }) as TronLogItem,
      )
    }
  }
  return rows
}

export function getTronBlockNumber(item: RecordLike): number | undefined {
  return typeof item.block_number === 'number' ? item.block_number : undefined
}

export function getTronTransactionIndex(item: RecordLike): number {
  return toIndex(item.transactionIndex) ?? 0
}

export function sortTronTransactions(items: TronTransactionItem[]): TronTransactionItem[] {
  return items.sort((left, right) => {
    const blockDelta = (getTronBlockNumber(left) ?? 0) - (getTronBlockNumber(right) ?? 0)
    if (blockDelta !== 0) return blockDelta
    const indexDelta = getTronTransactionIndex(left) - getTronTransactionIndex(right)
    if (indexDelta !== 0) return indexDelta
    return String(left.hash ?? '').localeCompare(String(right.hash ?? ''))
  })
}

export function sortTronLogs(items: TronLogItem[]): TronLogItem[] {
  return items.sort((left, right) => {
    const blockDelta = (getTronBlockNumber(left) ?? 0) - (getTronBlockNumber(right) ?? 0)
    if (blockDelta !== 0) return blockDelta
    const indexDelta = getTronTransactionIndex(left) - getTronTransactionIndex(right)
    if (indexDelta !== 0) return indexDelta
    return (toIndex(left.logIndex) ?? 0) - (toIndex(right.logIndex) ?? 0)
  })
}

/** Chunk sizes for the recent-first scan: Tron produces a block every 3 seconds. */
export function tronChunkSize(filtered: boolean): number {
  return filtered ? 400 : 10
}

export const TRON_DEFAULT_MAX_SCAN_BLOCKS = 50_000
