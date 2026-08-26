import { EVENT_SIGNATURES } from '../../constants/index.js'

// ============================================================================
// Known Event Signatures
// ============================================================================

type EventInput = { name: string; indexed: boolean }

const ADDRESS_INPUT_NAMES = new Set(['from', 'to', 'owner', 'spender', 'operator', 'sender', 'recipient', 'dst', 'src'])

const NUMERIC_INPUT_NAMES = new Set([
  'value',
  'wad',
  'id',
  'amount0',
  'amount1',
  'amount0In',
  'amount1In',
  'amount0Out',
  'amount1Out',
  'reserve0',
  'reserve1',
  'liquidity',
  'sqrtPriceX96',
  'amount',
  'tokenId',
])

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function normalizeTopic(topic: string | undefined): string {
  return typeof topic === 'string' ? topic.toLowerCase() : ''
}
function decodeIndexedAddress(topic: string | undefined): string {
  const clean = normalizeTopic(topic).replace(/^0x/, '').padStart(64, '0')
  return `0x${clean.slice(-40)}`
}

function decodeTopicUint(topic: string | undefined): string {
  const normalized = normalizeTopic(topic)
  if (!normalized) return '0'
  try {
    return BigInt(normalized).toString()
  } catch {
    return normalized
  }
}

function isErc721LikeTransfer(topic0: string, topics: string[]): boolean {
  return topic0 === EVENT_SIGNATURES.TRANSFER_ERC20 && topics.length >= 4
}

const KNOWN_EVENTS: Record<string, { name: string; inputs: EventInput[] }> = {
  // ERC20 - Transfer(address indexed from, address indexed to, uint256 value)
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': {
    name: 'Transfer',
    inputs: [
      { name: 'from', indexed: true },
      { name: 'to', indexed: true },
      { name: 'value', indexed: false },
    ],
  },
  // ERC20 - Approval(address indexed owner, address indexed spender, uint256 value)
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': {
    name: 'Approval',
    inputs: [
      { name: 'owner', indexed: true },
      { name: 'spender', indexed: true },
      { name: 'value', indexed: false },
    ],
  },
  // ERC721 - ApprovalForAll(address indexed owner, address indexed operator, bool approved)
  '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31': {
    name: 'ApprovalForAll',
    inputs: [
      { name: 'owner', indexed: true },
      { name: 'operator', indexed: true },
      { name: 'approved', indexed: false },
    ],
  },
  // ERC1155 - TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62': {
    name: 'TransferSingle',
    inputs: [
      { name: 'operator', indexed: true },
      { name: 'from', indexed: true },
      { name: 'to', indexed: true },
      { name: 'id', indexed: false },
      { name: 'value', indexed: false },
    ],
  },
  // ERC1155 - TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb': {
    name: 'TransferBatch',
    inputs: [
      { name: 'operator', indexed: true },
      { name: 'from', indexed: true },
      { name: 'to', indexed: true },
      { name: 'ids', indexed: false },
      { name: 'values', indexed: false },
    ],
  },
  // Uniswap V2 - NOTE: sender and to are INDEXED (in topics), amounts are in data
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': {
    name: 'Swap',
    inputs: [
      { name: 'sender', indexed: true },
      { name: 'amount0In', indexed: false },
      { name: 'amount1In', indexed: false },
      { name: 'amount0Out', indexed: false },
      { name: 'amount1Out', indexed: false },
      { name: 'to', indexed: true },
    ],
  },
  // Uniswap V2 - Sync(uint112 reserve0, uint112 reserve1)
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1': {
    name: 'Sync',
    inputs: [
      { name: 'reserve0', indexed: false },
      { name: 'reserve1', indexed: false },
    ],
  },
  // Uniswap V3 - Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67': {
    name: 'Swap',
    inputs: [
      { name: 'sender', indexed: true },
      { name: 'recipient', indexed: true },
      { name: 'amount0', indexed: false },
      { name: 'amount1', indexed: false },
      { name: 'sqrtPriceX96', indexed: false },
      { name: 'liquidity', indexed: false },
      { name: 'tick', indexed: false },
    ],
  },
  // Uniswap V4 - Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)
  '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f': {
    name: 'Swap',
    inputs: [
      { name: 'id', indexed: true },
      { name: 'sender', indexed: true },
      { name: 'amount0', indexed: false },
      { name: 'amount1', indexed: false },
      { name: 'sqrtPriceX96', indexed: false },
      { name: 'liquidity', indexed: false },
      { name: 'tick', indexed: false },
      { name: 'fee', indexed: false },
    ],
  },
  // WETH - Deposit(address indexed dst, uint wad)
  '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c': {
    name: 'Deposit',
    inputs: [
      { name: 'dst', indexed: true },
      { name: 'wad', indexed: false },
    ],
  },
  // WETH - Withdrawal(address indexed src, uint wad)
  '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65': {
    name: 'Withdrawal',
    inputs: [
      { name: 'src', indexed: true },
      { name: 'wad', indexed: false },
    ],
  },
  // Burn(address indexed account, uint256 amount)
  '0xcc16f5dbb4873280815c1ee09dbd06736cffcc184412cf7a71a0fdb75d397ca5': {
    name: 'Burn',
    inputs: [
      { name: 'account', indexed: true },
      { name: 'amount', indexed: false },
    ],
  },
  // Mint(address indexed account, uint256 amount)
  '0xab8530f87dc9b59234c4623bf917212bb2536d647574c8e7e5da92c2ede0c9f8': {
    name: 'Mint',
    inputs: [
      { name: 'account', indexed: true },
      { name: 'amount', indexed: false },
    ],
  },
  // Uniswap V3 - IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
  '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f': {
    name: 'IncreaseLiquidity',
    inputs: [
      { name: 'tokenId', indexed: true },
      { name: 'liquidity', indexed: false },
      { name: 'amount0', indexed: false },
      { name: 'amount1', indexed: false },
    ],
  },
  // Uniswap V3 - DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
  '0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4': {
    name: 'DecreaseLiquidity',
    inputs: [
      { name: 'tokenId', indexed: true },
      { name: 'liquidity', indexed: false },
      { name: 'amount0', indexed: false },
      { name: 'amount1', indexed: false },
    ],
  },
  // EIP-3009 - AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)
  '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5': {
    name: 'AuthorizationUsed',
    inputs: [
      { name: 'authorizer', indexed: true },
      { name: 'nonce', indexed: true },
    ],
  },
}

export function decodeLog(log: {
  address: string
  topics: string[]
  data: string
  transactionHash?: string
  logIndex?: number
}): {
  address: string
  event_name: string | null
  decoded: Record<string, string> | null
  raw?: { topics: string[]; data: string }
  transaction_hash?: string
  log_index?: number
} {
  const topic0 = normalizeTopic(log.topics[0])

  if (isErc721LikeTransfer(topic0, log.topics)) {
    const from = decodeIndexedAddress(log.topics[1])
    const to = decodeIndexedAddress(log.topics[2])
    const tokenId = decodeTopicUint(log.topics[3])
    const transferType = from === ZERO_ADDRESS ? 'mint' : to === ZERO_ADDRESS ? 'burn' : 'transfer'

    return {
      address: log.address,
      event_name: 'Transfer',
      decoded: {
        standard: 'erc721',
        transfer_type: transferType,
        from,
        to,
        token_id: tokenId,
        tokenId,
        id: tokenId,
      },
      transaction_hash: log.transactionHash,
      log_index: log.logIndex,
    }
  }

  const eventInfo = KNOWN_EVENTS[topic0]

  if (!eventInfo) {
    return {
      address: log.address,
      event_name: null,
      decoded: null,
      raw: { topics: log.topics, data: log.data },
      transaction_hash: log.transactionHash,
      log_index: log.logIndex,
    }
  }

  const decoded: Record<string, string> = {}

  // Separate indexed and non-indexed inputs
  const indexedInputs = eventInfo.inputs.filter((inp) => inp.indexed)
  const nonIndexedInputs = eventInfo.inputs.filter((inp) => !inp.indexed)

  // Decode indexed parameters from topics (topic0 is event signature, skip it)
  let topicIndex = 1 // Start from topic1
  for (const input of indexedInputs) {
    if (topicIndex >= log.topics.length) break

    const topic = log.topics[topicIndex]
    if (ADDRESS_INPUT_NAMES.has(input.name)) {
      decoded[input.name] = decodeIndexedAddress(topic)
    } else if (NUMERIC_INPUT_NAMES.has(input.name)) {
      decoded[input.name] = decodeTopicUint(topic)
    } else {
      decoded[input.name] = normalizeTopic(topic)
    }
    topicIndex++
  }

  // Decode non-indexed parameters from data
  if (log.data && log.data !== '0x') {
    const dataWithoutPrefix = log.data.slice(2)
    const chunks = dataWithoutPrefix.match(/.{64}/g) || []

    for (let i = 0; i < nonIndexedInputs.length && i < chunks.length; i++) {
      const input = nonIndexedInputs[i]
      const rawHex = '0x' + chunks[i]

      // Convert numeric values to decimal strings for readability
      if (NUMERIC_INPUT_NAMES.has(input.name)) {
        try {
          decoded[input.name] = BigInt(rawHex).toString()
        } catch {
          decoded[input.name] = rawHex
        }
      } else {
        decoded[input.name] = rawHex
      }
    }
  }

  // Omit raw section for successfully decoded events — the decoded fields
  // contain the same info in human-readable form, so raw just bloats the response.
  return {
    address: log.address,
    event_name: eventInfo.name,
    decoded,
    transaction_hash: log.transactionHash,
    log_index: log.logIndex,
  }
}
