#!/usr/bin/env tsx

import { EVENT_SIGNATURES } from '../src/constants/index.js'
import { decodeLog } from '../src/tools/utilities/decode-logs.js'
import {
  assert,
  callToolWithRetry,
  classifySpeed,
  closeTestClient,
  connectTestClient,
  printSection,
} from './test-helpers.ts'
import { loadToolTestContext, type ToolTestContext } from './tool-manifest.ts'

const ERC20_TRANSFER_SIGHASH = '0xa9059cbb'
const ERC20_APPROVE_SIGHASH = '0x095ea7b3'
const ZERO_TOPIC = `0x${'0'.repeat(64)}`
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

type TestCase = {
  name: string
  run: () => Promise<void>
}

function getItems(data: any): any[] {
  return Array.isArray(data?.items) ? data.items : []
}

function readBigInt(value: unknown): bigint {
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  if (typeof value === 'bigint') return value
  if (typeof value === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(value.trim())) return BigInt(value.trim())
  return 0n
}

function expectDescending(items: any[], field: string, label: string) {
  for (let index = 1; index < items.length; index += 1) {
    assert(
      readBigInt(items[index - 1]?.[field]) >= readBigInt(items[index]?.[field]),
      `${label} should be sorted descending by ${field}`,
    )
  }
}

function topicAddress(topic: string): string {
  const clean = topic.toLowerCase().replace(/^0x/, '')
  assert(clean.length === 64, 'Expected indexed address topic')
  return `0x${clean.slice(24)}`
}

function addressTopic(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, '')
  assert(clean.length === 40, 'Expected EVM address')
  return `0x${clean.padStart(64, '0')}`
}

function uintTopic(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`
}

async function main() {
  printSection('EVM investigator regression tests')
  const connected = await connectTestClient('evm-investigator-test')
  const { client } = connected

  try {
    const context = await loadToolTestContext(client)
    const ethereumHead = (await callToolWithRetry(client, 'portal_get_head', { network: 'ethereum-mainnet' })).data
      .number as number
    const baseWindowFrom = context.baseHead - 5_000
    const wideBaseWindowFrom = context.baseHead - 50_000

    const latestFailed = await callToolWithRetry(client, 'portal_evm_query_transactions', {
      network: 'base',
      from_block: wideBaseWindowFrom,
      to_block: context.baseHead,
      transaction_status: 'failed',
      scan_order: 'latest',
      max_scan_blocks: 50_000,
      limit: 1,
      field_preset: 'standard',
      response_format: 'full',
    })
    const failedTx = getItems(latestFailed.data)[0]
    assert(failedTx?.to, 'Expected a recent failed Base transaction with a recipient')

    const creationFixture = await callToolWithRetry(client, 'portal_evm_query_transactions', {
      network: 'base',
      from_block: wideBaseWindowFrom,
      to_block: context.baseHead,
      contract_creation: true,
      scan_order: 'latest',
      max_scan_blocks: 50_000,
      limit: 1,
      field_preset: 'standard',
      response_format: 'full',
    })
    const creationTx = getItems(creationFixture.data)[0]
    assert(
      creationTx?.from && typeof creationTx.block_number === 'number',
      'Expected a recent Base contract creation fixture',
    )

    const approvalFixture = await callToolWithRetry(client, 'portal_evm_query_logs', {
      network: 'base',
      from_block: wideBaseWindowFrom,
      to_block: context.baseHead,
      addresses: [context.usdcBase],
      event: 'approval',
      scan_order: 'latest',
      limit: 1,
      field_preset: 'minimal',
    })
    const approvalLog = getItems(approvalFixture.data)[0]
    assert(
      approvalLog?.topics?.[0] === EVENT_SIGNATURES.APPROVAL_ERC20 && approvalLog?.topics?.[1],
      'Expected a recent USDC Approval fixture',
    )
    const approvalOwnerTopic = approvalLog.topics[1]
    const approvalOwner = topicAddress(approvalOwnerTopic)

    const tests: TestCase[] = [
      {
        name: 'decoded latest ERC721 mint exposes token ID and tx hash',
        run: async () => {
          const recipient = '0x1111111111111111111111111111111111111111'
          const txHash = `0x${'a'.repeat(64)}`
          const decoded = decodeLog({
            address: '0xE4E70FdF2Fc1147a7f35c4c5de88E6BeA63eeAfA',
            topics: [EVENT_SIGNATURES.TRANSFER_ERC20, ZERO_TOPIC, addressTopic(recipient), uintTopic(12345n)],
            data: '0x',
            transactionHash: txHash,
            logIndex: 7,
          })

          assert(decoded.event_name === 'Transfer', 'Expected Transfer decode')
          assert(decoded.transaction_hash === txHash, 'Expected parent transaction hash passthrough')
          assert(decoded.log_index === 7, 'Expected log index passthrough')
          assert(decoded.decoded?.standard === 'erc721', 'Expected ERC721-like transfer classification')
          assert(decoded.decoded?.transfer_type === 'mint', 'Expected zero-address Transfer to classify as mint')
          assert(decoded.decoded?.from === ZERO_ADDRESS, 'Expected mint from zero address')
          assert(decoded.decoded?.to === recipient, 'Expected recipient address decode')
          assert(decoded.decoded?.token_id === '12345', 'Expected token_id decimal decode')
          assert(decoded.decoded?.id === '12345', 'Expected generic id alias for pass/NFT prompts')
        },
      },
      {
        name: 'broad selective latest mint scan attempts reverse search',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_query_logs', {
            network: 'base-mainnet',
            from_block: context.baseHead - 150_000,
            to_block: context.baseHead,
            addresses: ['0xE4E70FdF2Fc1147a7f35c4c5de88E6BeA63eeAfA'],
            event: 'transfer',
            topic1: [ZERO_TOPIC],
            scan_order: 'latest',
            decode: true,
            include_transaction: true,
            limit: 1,
            field_preset: 'full',
            response_format: 'full',
          })
          assert(!result.isError, 'Expected broad selective latest mint query to scan instead of fail fast')
          assert(result.data._execution?.scan_order === 'latest', 'Expected latest scan metadata')
          assert(
            result.data._execution?.scanned_blocks > 100_000,
            'Expected selective latest scan to cover a broad block range',
          )
          assert(
            Array.isArray(result.data._notices) &&
              result.data._notices.some((notice: string) => /complete filtered latest scan/i.test(notice)),
            'Expected complete filtered latest scan notice',
          )
        },
      },
      {
        name: 'first EIP-1559 tx on Ethereum from London fork block',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'ethereum-mainnet',
            from_block: 12_965_000,
            to_block: 12_965_200,
            transaction_type: '0x2',
            scan_order: 'earliest',
            limit: 1,
            field_preset: 'minimal',
          })
          const item = getItems(result.data)[0]
          assert(item?.type === 2, 'Expected EIP-1559 transaction type 2')
          assert(result.data._execution?.scan_order === 'earliest', 'Expected earliest scan metadata')
        },
      },
      {
        name: 'first and last tx with transfer sighash',
        run: async () => {
          const first = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: baseWindowFrom,
            to_block: context.baseHead,
            to_addresses: [context.usdcBase],
            sighash: [ERC20_TRANSFER_SIGHASH],
            scan_order: 'earliest',
            limit: 1,
            field_preset: 'full',
            response_format: 'full',
          })
          const last = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: baseWindowFrom,
            to_block: context.baseHead,
            to_addresses: [context.usdcBase],
            sighash: [ERC20_TRANSFER_SIGHASH],
            scan_order: 'latest',
            limit: 1,
            field_preset: 'full',
            response_format: 'full',
          })
          const firstTx = getItems(first.data)[0]
          const lastTx = getItems(last.data)[0]
          assert(firstTx?.sighash === ERC20_TRANSFER_SIGHASH, 'Expected first tx to use transfer sighash')
          assert(lastTx?.sighash === ERC20_TRANSFER_SIGHASH, 'Expected last tx to use transfer sighash')
          assert(
            firstTx.block_number <= lastTx.block_number,
            'Expected first transfer call block <= latest transfer call block',
          )
        },
      },
      {
        name: 'first failed tx to a Base contract after a block',
        run: async () => {
          const failedTo = String(failedTx.to).toLowerCase()
          const result = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: Math.max(0, Number(failedTx.block_number ?? context.baseHead) - 2_000),
            to_block: context.baseHead,
            to_addresses: [failedTo],
            transaction_status: 'failed',
            scan_order: 'earliest',
            max_scan_blocks: 10_000,
            limit: 1,
            field_preset: 'standard',
            response_format: 'full',
          })
          const item = getItems(result.data)[0]
          assert(item?.status === 0, 'Expected failed tx status')
          assert(String(item?.to).toLowerCase() === failedTo, 'Expected failed tx recipient match')
        },
      },
      {
        name: 'first contract creation from a wallet',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: Math.max(0, creationTx.block_number - 20),
            to_block: creationTx.block_number + 20,
            from_addresses: [creationTx.from],
            contract_creation: true,
            scan_order: 'earliest',
            limit: 1,
            field_preset: 'standard',
          })
          const item = getItems(result.data)[0]
          assert(
            String(item?.from).toLowerCase() === String(creationTx.from).toLowerCase(),
            'Expected contract creation sender match',
          )
          assert(item?.to === null || item?.contractAddress, 'Expected contract creation shape')
        },
      },
      {
        name: 'tx above native value and gas thresholds',
        run: async () => {
          const valueResult = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'ethereum-mainnet',
            from_block: ethereumHead - 500,
            to_block: ethereumHead,
            min_value_wei: '1',
            order_by: 'value_desc',
            scan_order: 'latest',
            max_scan_blocks: 500,
            limit: 3,
            field_preset: 'standard',
            response_format: 'full',
          })
          const valueItems = getItems(valueResult.data)
          assert(valueItems.length > 0, 'Expected native-value txs on Ethereum')
          assert(
            valueItems.every((item) => readBigInt(item.value_wei) >= 1n),
            'Expected value threshold to hold',
          )
          expectDescending(valueItems, 'value_wei', 'Native transfer ranking')

          const gasResult = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: baseWindowFrom,
            to_block: context.baseHead,
            min_gas_used: '21000',
            scan_order: 'latest',
            limit: 3,
            field_preset: 'standard',
            response_format: 'full',
          })
          assert(
            getItems(gasResult.data).every((item) => readBigInt(item.gasUsed) >= 21_000n),
            'Expected gas threshold to hold',
          )
        },
      },
      {
        name: 'first USDC transfer on Base after block X',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_query_token_transfers', {
            network: 'base',
            from_block: baseWindowFrom,
            to_block: context.baseHead,
            token_addresses: [context.usdcBase],
            scan_order: 'earliest',
            limit: 1,
          })
          const item = getItems(result.data)[0]
          assert(item?.token_address?.toLowerCase() === context.usdcBase, 'Expected USDC transfer')
          assert(result.data._execution?.scan_order === 'earliest', 'Expected earliest token-transfer scan metadata')
        },
      },
      {
        name: 'first Swap event for an active Uniswap pool',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_query_logs', {
            network: 'base',
            from_timestamp: '24h ago',
            to_timestamp: 'now',
            addresses: [context.baseUniswapV3Pool],
            event: 'swap',
            scan_order: 'earliest',
            limit: 1,
            field_preset: 'minimal',
          })
          const item = getItems(result.data)[0]
          assert(item?.address?.toLowerCase() === context.baseUniswapV3Pool, 'Expected swap event from selected pool')
          assert(
            [
              EVENT_SIGNATURES.UNISWAP_V2_SWAP,
              EVENT_SIGNATURES.UNISWAP_V3_SWAP,
              EVENT_SIGNATURES.UNISWAP_V4_SWAP,
            ].includes(item?.topics?.[0]),
            'Expected swap alias topic',
          )
        },
      },
      {
        name: 'latest Approval event from a wallet',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_query_logs', {
            network: 'base',
            from_block: wideBaseWindowFrom,
            to_block: context.baseHead,
            addresses: [context.usdcBase],
            event: 'approval',
            topic1: [approvalOwnerTopic],
            scan_order: 'latest',
            limit: 1,
            field_preset: 'minimal',
          })
          const item = getItems(result.data)[0]
          assert(item?.topics?.[0] === EVENT_SIGNATURES.APPROVAL_ERC20, 'Expected Approval alias topic')
          assert(topicAddress(item.topics[1]) === approvalOwner, 'Expected Approval owner match')
        },
      },
      {
        name: 'first approve call to USDC after block X',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: wideBaseWindowFrom,
            to_block: context.baseHead,
            to_addresses: [context.usdcBase],
            method: 'approve',
            scan_order: 'earliest',
            max_scan_blocks: 50_000,
            limit: 1,
            field_preset: 'full',
            response_format: 'full',
          })
          const item = getItems(result.data)[0]
          assert(item?.sighash === ERC20_APPROVE_SIGHASH, 'Expected approve method alias to resolve to sighash')
          assert(String(item?.to).toLowerCase() === context.usdcBase, 'Expected approve call recipient to be USDC')
        },
      },
      {
        name: 'contract deployment lookup',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_get_contract_deployment', {
            network: 'base',
            contract_address: context.recentDeploymentContract,
            from_block: context.recentDeploymentFromBlock,
            to_block: context.recentDeploymentToBlock,
            scan_order: 'earliest',
          })
          const item = getItems(result.data)[0]
          assert(
            item?.deployed_contract_address?.toLowerCase() === context.recentDeploymentContract,
            'Expected deployment contract match',
          )
          assert(item?.transaction_hash?.startsWith('0x'), 'Expected deployment tx hash')
          assert(item?.deployer?.startsWith('0x'), 'Expected deployer address')
        },
      },
      {
        name: 'BAYC alias deployment lookup in a bounded historical window',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_get_contract_deployment', {
            network: 'ethereum-mainnet',
            contract: 'bored apes',
            from_block: 12_287_500,
            to_block: 12_287_510,
            scan_order: 'earliest',
            max_scan_blocks: 20,
          })
          const item = getItems(result.data)[0]
          assert(
            item?.deployed_contract_address?.toLowerCase() === '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
            'Expected BAYC alias to resolve to the BAYC contract',
          )
          assert(item?.block_number === 12_287_507, 'Expected BAYC deployment block')
          assert(
            item?.transaction_hash === '0x22199329b0aa1aa68902a78e3b32ca327c872fab166c7a2838273de6ad383eba',
            'Expected BAYC deployment tx',
          )
          assert(JSON.stringify(result.data).includes('Resolved contract alias'), 'Expected alias resolution notice')
        },
      },
      {
        name: 'contract deployment empty window guidance',
        run: async () => {
          const result = await callToolWithRetry(client, 'portal_evm_get_contract_deployment', {
            network: 'ethereum-mainnet',
            contract_address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
            from_block: 12_290_000,
            to_block: 12_300_000,
            scan_order: 'earliest',
          })
          assert(getItems(result.data).length === 0, 'Expected empty result after BAYC deployment block')
          assert(
            JSON.stringify(result.data).includes('Move from_block earlier'),
            'Expected guidance to expand the search backward',
          )
        },
      },
      {
        name: 'top-N transaction rankings',
        run: async () => {
          const gasResult = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: baseWindowFrom,
            to_block: context.baseHead,
            to_addresses: [context.usdcBase],
            method: 'transfer',
            order_by: 'gas_used_desc',
            scan_order: 'latest',
            max_scan_blocks: 5_000,
            limit: 3,
            field_preset: 'standard',
            response_format: 'full',
          })
          expectDescending(getItems(gasResult.data), 'gasUsed', 'Highest gas txs to USDC')

          const priceResult = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: context.baseHead - 500,
            to_block: context.baseHead,
            order_by: 'effective_gas_price_desc',
            scan_order: 'latest',
            max_scan_blocks: 500,
            limit: 3,
            field_preset: 'standard',
            response_format: 'full',
          })
          expectDescending(getItems(priceResult.data), 'effectiveGasPrice_wei', 'Highest effective gas price txs')

          const failedResult = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: Math.max(0, Number(failedTx.block_number ?? context.baseHead) - 2_000),
            to_block: context.baseHead,
            to_addresses: [String(failedTx.to).toLowerCase()],
            transaction_status: 'failed',
            scan_order: 'latest',
            limit: 3,
            field_preset: 'standard',
            response_format: 'full',
          })
          assert(
            getItems(failedResult.data).every((item) => item.status === 0),
            'Expected failed tx ranking/filter results',
          )
        },
      },
      {
        name: 'top senders and receivers in a bounded window',
        run: async () => {
          const senders = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: context.baseHead - 500,
            to_block: context.baseHead,
            aggregate_by: 'sender',
            aggregate_metric: 'count',
            max_scan_blocks: 500,
            limit: 5,
            field_preset: 'minimal',
          })
          const senderRows = senders.data.top_senders ?? []
          assert(senderRows.length > 0, 'Expected top_senders rows')
          expectDescending(senderRows, 'transaction_count', 'Top senders')

          const receivers = await callToolWithRetry(client, 'portal_evm_query_transactions', {
            network: 'base',
            from_block: context.baseHead - 500,
            to_block: context.baseHead,
            aggregate_by: 'receiver',
            aggregate_metric: 'count',
            max_scan_blocks: 500,
            limit: 5,
            field_preset: 'minimal',
          })
          const receiverRows = receivers.data.top_receivers ?? []
          assert(receiverRows.length > 0, 'Expected top_receivers rows')
          expectDescending(receiverRows, 'transaction_count', 'Top receivers')
        },
      },
    ]

    let passed = 0
    let failed = 0
    const failures: string[] = []

    for (const test of tests) {
      const started = Date.now()
      try {
        await test.run()
        const elapsed = Date.now() - started
        console.log(`PASS  ${test.name} [${elapsed}ms ${classifySpeed(elapsed)}]`)
        passed++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(`FAIL  ${test.name}`)
        console.log(`      ${message.slice(0, 320)}`)
        failures.push(`${test.name}: ${message}`)
        failed++
      }
    }

    printSection(`EVM investigator results: ${passed} passed, ${failed} failed`)
    if (failures.length > 0) {
      failures.forEach((failure) => console.log(`- ${failure}`))
    }
    process.exit(failed > 0 ? 1 : 0)
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
