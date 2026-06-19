# Full Portal Chain Name Mapping

## Ethereum & L2s

| Common Name | Portal Dataset Name | Type |
|-------------|-------------------|------|
| Ethereum | `ethereum-mainnet` | EVM |
| Ethereum Sepolia | `ethereum-sepolia` | EVM |
| Arbitrum | `arbitrum-one` | EVM |
| Arbitrum Sepolia | `arbitrum-sepolia` | EVM |
| Optimism | `optimism-mainnet` | EVM |
| Optimism Sepolia | `optimism-sepolia` | EVM |
| Base | `base-mainnet` | EVM |
| Base Sepolia | `base-sepolia` | EVM |
| Polygon | `polygon-mainnet` | EVM |
| Polygon zkEVM | `polygon-zkevm-mainnet` | EVM |
| zkSync Era | `zksync-mainnet` | EVM |
| Scroll | `scroll-mainnet` | EVM |
| Linea | `linea-mainnet` | EVM |
| Blast | `blast-l2-mainnet` | EVM |
| Blast Sepolia | `blast-sepolia` | EVM |
| Mantle | `mantle-mainnet` | EVM |
| Mode | `mode-mainnet` | EVM |
| Taiko | `taiko-mainnet` | EVM |
| Worldchain | `worldchain-mainnet` | EVM |

## Alt-L1 Chains

| Common Name | Portal Dataset Name | Type |
|-------------|-------------------|------|
| BSC / Binance Smart Chain | `binance-mainnet` | EVM |
| Avalanche C-Chain | `avalanche-mainnet` | EVM |
| Gnosis Chain | `gnosis-mainnet` | EVM |
| Moonbeam | `moonbeam-mainnet` | EVM |
| Moonriver | `moonriver-mainnet` | EVM |
| Celo | `celo-mainnet` | EVM |
| Fantom | `fantom-mainnet` | EVM |
| Berachain | `berachain-mainnet` | EVM |

## Substrate Chains

| Common Name | Portal Dataset Name | Type |
|-------------|-------------------|------|
| Polkadot | `polkadot` | Substrate |
| Kusama | `kusama` | Substrate |
| Acala | `acala-substrate` | Substrate |
| Astar (Substrate) | `astar-substrate` | Substrate |
| Moonbeam (Substrate) | `moonbeam-substrate` | Substrate |
| Moonriver (Substrate) | `moonriver-substrate` | Substrate |
| Phala | `phala` | Substrate |
| Subsocial | `subsocial` | Substrate |

> **Note:** Frontier EVM parachains (Moonbeam, Astar) have both EVM and Substrate datasets. Use `-substrate` suffix for Substrate queries with `"type": "substrate"`. Use the EVM dataset (e.g., `moonbeam-mainnet`) with `"type": "evm"` for EVM-only queries.

> **Important:** Real-time streaming is NOT supported for Substrate chains. Only finalized historical data is available.

## Non-EVM Chains

| Common Name | Portal Dataset Name | Type |
|-------------|-------------------|------|
| Bitcoin | `bitcoin-mainnet` | Bitcoin |
| Solana | `solana-mainnet` | Solana |
| HyperEVM | `hyperliquid-mainnet` | EVM |
| HyperEVM Testnet | `hyperliquid-testnet` | EVM |
| Hyperliquid Fills | `hyperliquid-fills` | HyperliquidFills |
| Hyperliquid Replica Cmds | `hyperliquid-replica-cmds` | HyperliquidReplicaCmds |

## Testnets

| Common Name | Portal Dataset Name |
|-------------|-------------------|
| Ethereum Sepolia | `ethereum-sepolia` |
| Arbitrum Sepolia | `arbitrum-sepolia` |
| Base Sepolia | `base-sepolia` |
| Optimism Sepolia | `optimism-sepolia` |
| Blast Sepolia | `blast-sepolia` |

## Platform Name Comparison

Different platforms use different names for the same chains:

| Blockchain | DeFiLlama | Portal | Etherscan |
|-----------|-----------|--------|-----------|
| Arbitrum | arbitrum | arbitrum-one | arbiscan.io |
| BSC | bsc | binance-mainnet | bscscan.com |
| zkSync Era | zksync-era | zksync-mainnet | explorer.zksync.io |
| Blast | blast | blast-l2-mainnet | blastscan.io |

**Always use Portal-specific names when querying the Portal API.**

## Quick Reference: Top 20 Chains

```json
{
  "Ethereum": "ethereum-mainnet",
  "Arbitrum": "arbitrum-one",
  "Base": "base-mainnet",
  "Optimism": "optimism-mainnet",
  "Polygon": "polygon-mainnet",
  "BSC": "binance-mainnet",
  "Avalanche": "avalanche-mainnet",
  "zkSync Era": "zksync-mainnet",
  "Blast": "blast-l2-mainnet",
  "Scroll": "scroll-mainnet",
  "Linea": "linea-mainnet",
  "Mantle": "mantle-mainnet",
  "Polygon zkEVM": "polygon-zkevm-mainnet",
  "Gnosis": "gnosis-mainnet",
  "Celo": "celo-mainnet",
  "Moonbeam": "moonbeam-mainnet",
  "Moonriver": "moonriver-mainnet",
  "Mode": "mode-mainnet",
  "Polkadot": "polkadot",
  "Kusama": "kusama",
  "Moonbeam (Substrate)": "moonbeam-substrate",
  "Solana": "solana-mainnet",
  "Hyperliquid Fills": "hyperliquid-fills",
  "HyperEVM": "hyperliquid-mainnet"
}
```

## Using Dataset Names as Constants

```typescript
const PORTAL_DATASETS = {
  ETHEREUM: 'ethereum-mainnet',
  ARBITRUM: 'arbitrum-one',
  BASE: 'base-mainnet',
  OPTIMISM: 'optimism-mainnet',
  BSC: 'binance-mainnet',
  SOLANA: 'solana-mainnet'
} as const;

// Use:
const url = `https://portal.sqd.dev/datasets/${PORTAL_DATASETS.ARBITRUM}/stream`;
```
