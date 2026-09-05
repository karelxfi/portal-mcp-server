import type { McpServer } from '@modelcontextprotocol/server'

// Bitcoin
import { registerBitcoinAnalyticsTool, registerQueryBitcoinTransactionsTool } from './bitcoin/index.js'
import {
  registerGetContractActivityTool,
  registerGetRecentTransactionsTool,
  registerGetTimeSeriesDataTool,
  registerGetTopContractsTool,
  registerGetWalletSummaryTool,
} from './convenience/index.js'
import { registerGetDatasetInfoTool } from './datasets/info.js'
// Discovery
import { registerListDatasetsTool } from './datasets/list.js'
import { registerResolveEntityTool } from './datasets/resolve-entity.js'
import { registerBlockAtTimestampTool } from './evm/block-at-timestamp.js'
// Global / debug
import { registerGetBlockNumberTool } from './evm/block-number.js'
import { registerContractDeploymentTool } from './evm/contract-deployment.js'
import { registerGetErc20TransfersTool } from './evm/erc20-transfers.js'
import { registerEvmOhlcTool } from './evm/ohlc.js'
import { registerQueryBlocksTool } from './evm/query-blocks.js'
// EVM
import { registerQueryLogsTool } from './evm/query-logs.js'
import { registerQueryTracesTool } from './evm/query-traces.js'
import { registerQueryTransactionsTool } from './evm/query-transactions.js'
// Hyperliquid
import {
  registerHyperliquidAnalyticsTool,
  registerHyperliquidOhlcTool,
  registerQueryHyperliquidFillsTool,
  registerQueryHyperliquidReplicaCmdsTool,
} from './hyperliquid/index.js'
import { registerSolanaAnalyticsTool } from './solana/analytics.js'
// Solana
import { registerQuerySolanaInstructionsTool } from './solana/query-instructions.js'
import { registerQuerySolanaTransactionsTool } from './solana/query-transactions.js'
import {
  registerSubstrateAnalyticsTool,
  registerSubstrateQueryCallsTool,
  registerSubstrateQueryEventsTool,
} from './substrate/index.js'
// Tron
import { registerTronQueryLogsTool, registerTronQueryTransactionsTool } from './tron/index.js'

export function registerAllTools(server: McpServer) {
  // Public discovery (4)
  registerListDatasetsTool(server)
  registerGetDatasetInfoTool(server)
  registerGetBlockNumberTool(server)
  registerResolveEntityTool(server)

  // Public convenience (3)
  registerGetRecentTransactionsTool(server)
  registerGetWalletSummaryTool(server)
  registerGetTimeSeriesDataTool(server)

  // Public EVM (8)
  registerQueryLogsTool(server)
  registerQueryTransactionsTool(server)
  registerQueryTracesTool(server)
  registerGetErc20TransfersTool(server)
  registerContractDeploymentTool(server)
  registerGetContractActivityTool(server)
  registerGetTopContractsTool(server)
  registerEvmOhlcTool(server)

  // Public Solana (3)
  registerQuerySolanaInstructionsTool(server)
  registerQuerySolanaTransactionsTool(server)
  registerSolanaAnalyticsTool(server)

  // Public Bitcoin (2)
  registerQueryBitcoinTransactionsTool(server)
  registerBitcoinAnalyticsTool(server)

  // Public Substrate (3)
  registerSubstrateQueryEventsTool(server)
  registerSubstrateQueryCallsTool(server)
  registerSubstrateAnalyticsTool(server)

  // Public Hyperliquid (3)
  registerQueryHyperliquidFillsTool(server)
  registerHyperliquidAnalyticsTool(server)
  registerHyperliquidOhlcTool(server)

  // Public Tron (2)
  registerTronQueryTransactionsTool(server)
  registerTronQueryLogsTool(server)

  // Advanced/debug (3)
  registerQueryBlocksTool(server)
  registerBlockAtTimestampTool(server)
  registerQueryHyperliquidReplicaCmdsTool(server)
}
