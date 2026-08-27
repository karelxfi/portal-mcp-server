import type { McpServer } from '@modelcontextprotocol/server'

import { registerPortalTool } from '../../helpers/mcp-registration.js'
import { z } from 'zod'

import {
  buildTokenListLookupNotices,
  resolveContractQuery,
  resolveHyperliquidCoinQuery,
  resolvePoolQuery,
  resolveProtocolQuery,
  resolveTokenQueryFromList,
} from '../../helpers/entity-resolution.js'
import { ActionableError } from '../../helpers/errors.js'
import { formatResult } from '../../helpers/format.js'
import { buildExecutionMetadata, buildToolDescription } from '../../helpers/tool-ux.js'

export function registerResolveEntityTool(server: McpServer) {
  registerPortalTool(server,
    'portal_resolve_entity',
    buildToolDescription('portal_resolve_entity'),
    {
      network: z
        .string()
        .optional()
        .describe(
          'Network name or alias when the entity is network-scoped, e.g. "base", "ethereum", "arbitrum-one", or "hyperliquid-fills".',
        ),
      kind: z
        .enum(['token', 'contract', 'pool', 'protocol', 'hyperliquid_coin'])
        .optional()
        .default('token')
        .describe(
          'Entity kind to resolve: token, contract alias/address, pool identifier, protocol name, or Hyperliquid coin/ticker.',
        ),
      query: z
        .string()
        .describe('Entity string to resolve, e.g. "USDC", "bayc", "uniswap", "BTC", or "0x...".'),
      limit: z.number().min(1).max(50).optional().default(10).describe('Maximum matches to return.'),
    },
    async ({ network, kind, query, limit }) => {
      const queryStartTime = Date.now()
      const effectiveKind = kind ?? 'token'
      const notices: string[] = []

      if ((effectiveKind === 'token' || effectiveKind === 'contract' || effectiveKind === 'pool') && !network) {
        throw new ActionableError(`${effectiveKind} resolution requires network.`, [
          'Pass network for chain-scoped entities, for example "base-mainnet" or "ethereum-mainnet".',
          'Use kind="protocol" when resolving a cross-chain protocol name.',
          'Use kind="hyperliquid_coin" for Hyperliquid tickers.',
        ])
      }

      let result:
        | Awaited<ReturnType<typeof resolveTokenQueryFromList>>
        | Awaited<ReturnType<typeof resolveContractQuery>>
        | Awaited<ReturnType<typeof resolvePoolQuery>>
        | Awaited<ReturnType<typeof resolveProtocolQuery>>
        | ReturnType<typeof resolveHyperliquidCoinQuery>

      if (effectiveKind === 'token') {
        result = await resolveTokenQueryFromList({ network: network!, query, limit })
        notices.push(...buildTokenListLookupNotices(result.lookup))
      } else if (effectiveKind === 'contract') {
        result = await resolveContractQuery({ network: network!, query, limit })
      } else if (effectiveKind === 'pool') {
        result = await resolvePoolQuery({ network: network!, query })
      } else if (effectiveKind === 'protocol') {
        result = await resolveProtocolQuery({ query, limit })
      } else {
        result = resolveHyperliquidCoinQuery({ query, limit })
      }

      const matches = result.matches
      const tokenAddresses =
        effectiveKind === 'token'
          ? matches.flatMap((match) => ('address' in match ? [match.address] : []))
          : []
      const contractAddresses =
        effectiveKind === 'contract'
          ? matches.flatMap((match) => ('address' in match ? [match.address] : []))
          : []
      const poolIdentifiers =
        effectiveKind === 'pool'
          ? matches.flatMap((match) => ('identifier' in match ? [match.identifier] : []))
          : []
      const hyperliquidCoins =
        effectiveKind === 'hyperliquid_coin'
          ? matches.flatMap((match) => ('coin' in match ? [match.coin] : []))
          : []
      const protocolSlugs =
        effectiveKind === 'protocol'
          ? matches.flatMap((match) => ('slug' in match ? [match.slug] : []))
          : []

      const suggestedArguments =
        matches.length > 0
          ? effectiveKind === 'token'
            ? {
                token_addresses: tokenAddresses,
                token_symbols: [result.query],
                note: 'Use token_addresses when you need a deterministic contract filter; token_symbols can be used by supported EVM token/log tools.',
              }
            : effectiveKind === 'contract'
              ? {
                  contract_address: contractAddresses[0],
                  addresses: contractAddresses,
                  note: 'Use the address fields for deterministic EVM contract filters.',
                }
              : effectiveKind === 'pool'
                ? {
                    pool_address: poolIdentifiers.find((value) => value.length === 42),
                    pool_id: poolIdentifiers.find((value) => value.length === 66),
                    note: 'Pool identifiers are format-normalized only; use the matching pool_address or pool_id field on pool-aware tools.',
                  }
                : effectiveKind === 'hyperliquid_coin'
                  ? {
                      coin: hyperliquidCoins,
                      note: 'Use coin filters on Hyperliquid fill, analytics, or OHLC tools.',
                    }
                  : {
                      protocol_slugs: protocolSlugs,
                      note: 'Use the slug to continue with protocol-aware research or external protocol metadata.',
                    }
          : undefined

      if (matches.length === 0) {
        notices.push(
          effectiveKind === 'token'
            ? 'No token-list match found. Check the network, use the exact token contract address, or try a canonical symbol.'
            : effectiveKind === 'contract'
              ? 'No built-in contract alias match found. Pass the exact contract address for deterministic EVM queries.'
              : effectiveKind === 'pool'
                ? 'No pool identifier match found. Pass a 20-byte EVM pool address or 32-byte pool id.'
                : effectiveKind === 'hyperliquid_coin'
                  ? 'No Hyperliquid coin candidate could be normalized from the query.'
                  : 'No protocol match found from DeFi Llama protocol metadata.',
        )
      } else if (matches.length > 1) {
        notices.push(
          effectiveKind === 'token'
            ? 'Multiple token-list matches were found. Use token_addresses for deterministic queries when bridged variants matter.'
            : `Multiple ${effectiveKind} matches were found. Pick one explicit identifier before issuing a chain query.`,
        )
      }
      if (effectiveKind === 'pool' && matches.length > 0) {
        notices.push('Pool resolution validates identifier shape only; it does not prove the pool exists on-chain.')
      }
      if (effectiveKind === 'hyperliquid_coin' && matches.length > 0) {
        notices.push('Hyperliquid coin resolution normalizes ticker/name input but does not validate current market listing.')
      }

      return formatResult(
        {
          kind: effectiveKind,
          query: result.query,
          ...('dataset' in result ? { network: result.dataset } : {}),
          match_count: matches.length,
          source: result.source,
          matches,
          ...('lookup' in result ? { token_list_lookup: result.lookup } : {}),
          ...(suggestedArguments ? { suggested_arguments: suggestedArguments } : {}),
        },
        matches.length === 1
          ? `Resolved ${result.query} to 1 ${effectiveKind} match`
          : `Resolved ${result.query} to ${matches.length} ${effectiveKind} matches`,
        {
          toolName: 'portal_resolve_entity',
          notices,
          execution: buildExecutionMetadata({
            limit,
            normalized_output: true,
            notes: [
              effectiveKind === 'token'
                ? 'Token addresses and metadata come from open token-list data, not hardcoded constants.'
                : undefined,
              effectiveKind === 'protocol'
                ? 'Protocol matches come from DeFi Llama metadata and are not Portal chain records.'
                : undefined,
              effectiveKind === 'hyperliquid_coin'
                ? 'Hyperliquid coin names are normalized for Portal filters; listing validation is left to the query tool.'
                : undefined,
            ].filter((note): note is string => Boolean(note)),
          }),
          metadata: {
            ...('dataset' in result ? { network: result.dataset, dataset: result.dataset } : {}),
            query_start_time: queryStartTime,
          },
        },
      )
    },
  )
}
