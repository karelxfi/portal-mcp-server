import { detectChainType } from '../../helpers/chain.js'
import { createAddressFormatError, createUnsupportedChainError } from '../../helpers/errors.js'
import { isValidHyperliquidAddress } from '../../helpers/validation.js'

type HyperliquidKind = 'hyperliquidFills' | 'hyperliquidReplicaCmds'

/*
 * resolveDataset answers any network name, so 'hyperliquid-mainnet', which is
 * HyperEVM and an EVM chain, reached the fills tools and failed inside the
 * Portal as a malformed request. The kind is decided here, with the error
 * every other tool gives for the wrong chain family.
 */
export function assertHyperliquidDataset(toolName: string, dataset: string, expected: HyperliquidKind): void {
  const actual = detectChainType(dataset)
  if (actual === expected) return
  throw createUnsupportedChainError({
    toolName,
    dataset,
    actualChainType: actual,
    supportedChains: [expected],
    suggestions: [
      expected === 'hyperliquidFills'
        ? "Use network 'hyperliquid-fills' for trades on Hyperliquid."
        : "Use network 'hyperliquid-replica-cmds' for Hyperliquid replica commands.",
      ...(actual === 'evm' && dataset.startsWith('hyperliquid')
        ? ["'hyperliquid-mainnet' is HyperEVM, an EVM network: the portal_evm_* tools read it."]
        : []),
    ],
  })
}

/*
 * A Hyperliquid user is an EVM-shaped address. An unchecked filter went to the
 * Portal as written and came back as a complete, empty window, which reads as
 * "this user never traded" when the truth is "that is not an address".
 */
export function normalizeHyperliquidAddress(address: string): string {
  if (!isValidHyperliquidAddress(address)) throw createAddressFormatError(address)
  return address.toLowerCase()
}

export function normalizeHyperliquidAddresses(addresses: string[] | undefined): string[] | undefined {
  return addresses?.map((address) => normalizeHyperliquidAddress(address))
}
