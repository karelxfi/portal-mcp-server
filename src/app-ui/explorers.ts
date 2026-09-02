/* Public block explorers keyed by SQD Portal dataset name. Links carry a
   person from an exact identifier in the Explorer to the same record on the
   network's usual explorer; the App never fetches anything from them. */

export type ExplorerKind = 'tx' | 'address' | 'block'

export type Explorer = { name: string; tx: string; address: string; block: string }

function etherscanFamily(host: string): Explorer {
  return {
    name: host,
    tx: `https://${host}/tx/{id}`,
    address: `https://${host}/address/{id}`,
    block: `https://${host}/block/{id}`,
  }
}

const EXPLORERS: Record<string, Explorer> = {
  'ethereum-mainnet': etherscanFamily('etherscan.io'),
  'base-mainnet': etherscanFamily('basescan.org'),
  'arbitrum-one': etherscanFamily('arbiscan.io'),
  'optimism-mainnet': etherscanFamily('optimistic.etherscan.io'),
  'polygon-mainnet': etherscanFamily('polygonscan.com'),
  'binance-mainnet': etherscanFamily('bscscan.com'),
  'avalanche-mainnet': etherscanFamily('snowtrace.io'),
  'gnosis-mainnet': etherscanFamily('gnosisscan.io'),
  'linea-mainnet': etherscanFamily('lineascan.build'),
  'scroll-mainnet': etherscanFamily('scrollscan.com'),
  'zksync-mainnet': etherscanFamily('era.zksync.network'),
  'blast-l2-mainnet': etherscanFamily('blastscan.io'),
  'mantle-mainnet': etherscanFamily('mantlescan.xyz'),
  'mode-mainnet': etherscanFamily('explorer.mode.network'),
  'zora-mainnet': etherscanFamily('explorer.zora.energy'),
  'celo-mainnet': etherscanFamily('celoscan.io'),
  'fantom-mainnet': etherscanFamily('ftmscan.com'),
  'moonbeam-mainnet': etherscanFamily('moonscan.io'),
  'moonriver-mainnet': etherscanFamily('moonriver.moonscan.io'),
  'taiko-mainnet': etherscanFamily('taikoscan.io'),
  'worldchain-mainnet': etherscanFamily('worldscan.org'),
  'solana-mainnet': {
    name: 'Solscan',
    tx: 'https://solscan.io/tx/{id}',
    address: 'https://solscan.io/account/{id}',
    block: 'https://solscan.io/block/{id}',
  },
  'bitcoin-mainnet': {
    name: 'mempool.space',
    tx: 'https://mempool.space/tx/{id}',
    address: 'https://mempool.space/address/{id}',
    block: 'https://mempool.space/block/{id}',
  },
  'hyperliquid-mainnet': {
    name: 'Hyperliquid Explorer',
    tx: 'https://app.hyperliquid.xyz/explorer/tx/{id}',
    address: 'https://app.hyperliquid.xyz/explorer/address/{id}',
    block: 'https://app.hyperliquid.xyz/explorer/block/{id}',
  },
  polkadot: {
    name: 'Subscan',
    tx: 'https://polkadot.subscan.io/extrinsic/{id}',
    address: 'https://polkadot.subscan.io/account/{id}',
    block: 'https://polkadot.subscan.io/block/{id}',
  },
  kusama: {
    name: 'Subscan',
    tx: 'https://kusama.subscan.io/extrinsic/{id}',
    address: 'https://kusama.subscan.io/account/{id}',
    block: 'https://kusama.subscan.io/block/{id}',
  },
  'tron-mainnet': {
    name: 'Tronscan',
    tx: 'https://tronscan.org/#/transaction/{id}',
    address: 'https://tronscan.org/#/address/{id}',
    block: 'https://tronscan.org/#/block/{id}',
  },
}

const ALIASES: Record<string, string> = {
  solana: 'solana-mainnet',
  bitcoin: 'bitcoin-mainnet',
  tron: 'tron-mainnet',
  'hyperliquid-fills': 'hyperliquid-mainnet',
  'hl-fills': 'hyperliquid-mainnet',
  'hyperliquid-replica-cmds': 'hyperliquid-mainnet',
}

export function explorerFor(network: string): Explorer | undefined {
  const key = network.trim().toLowerCase()
  return EXPLORERS[ALIASES[key] ?? key]
}

/* Which explorer record a row field points at, decided by the field name so
   base58 Solana signatures link as well as 0x hashes. */
export function identifierKind(key: string): ExplorerKind | undefined {
  const name = key.toLowerCase()
  if (/^(tx_hash|hash|transaction_hash|signature|txid|extrinsic_hash)$/.test(name)) return 'tx'
  if (/^(block_number|block|height|slot)$/.test(name)) return 'block'
  if (/(^|_)(address|sender|recipient|from|to|counterparty|user|owner|account|contract|token_address|coin_address)(_|$)/.test(name))
    return 'address'
  if (name === 'primary_id') return 'tx'
  return undefined
}

export function explorerLink(
  network: string,
  kind: ExplorerKind,
  rawId: string,
): { url: string; name: string; id: string } | undefined {
  const explorer = explorerFor(network)
  if (!explorer) return undefined
  /* A composite id like "hash:logIndex" points at its transaction. */
  const id = kind === 'tx' ? rawId.split(':')[0] : rawId
  if (!/^[0-9a-zA-Z]{1,128}$/.test(id)) return undefined
  if (kind === 'block' && !/^\d+$/.test(id)) return undefined
  if (kind !== 'block' && id.length < 8) return undefined
  return { url: explorer[kind].replace('{id}', id), name: explorer.name, id }
}
