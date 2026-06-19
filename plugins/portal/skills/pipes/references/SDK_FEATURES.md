# SDK 1.0 Features & Testing

Reference for SDK 1.0+ APIs: time-based ranges, `defineAbi`, query builder shorthands, typed errors, and the testing library.

## Time-Based Ranges

Ranges accept ISO date strings and `Date` objects. Dates are auto-resolved to block numbers via the Portal API.

```typescript
evmDecoder({
  range: { from: '2024-01-01' },  // ISO date → block number
  events: { transfers: erc20.events.Transfer },
})

// Date objects
evmDecoder({
  range: { from: new Date('2024-01-01'), to: new Date('2024-02-01') },
  events: { ... },
})

// Formatted block numbers (underscores OK)
evmDecoder({ range: { from: '18_908_900' }, ... })

// Latest block (only for `from`)
evmDecoder({ range: { from: 'latest' }, ... })
```

**Validation:** Inverted ranges (`from > to`) and unresolvable timestamps throw `BlockRangeConfigurationError` (E0002).

## `defineAbi` — Use JSON ABIs Without Codegen

`defineAbi()` converts a standard JSON ABI into decoder objects at runtime — no `squid-evm-typegen` step needed.

```typescript
import erc20Json from './erc20.json'
import { defineAbi } from '@subsquid/pipes'

const erc20 = defineAbi(erc20Json)

evmDecoder({
  events: {
    transfers: erc20.events.Transfer,
    approvals: erc20.events.Approval,
  },
})
```

Accepts: plain ABI array, `as const` literal (full type inference), or Hardhat/Foundry artifact with `.abi` field. Uses `@subsquid/evm-codec` (~10x faster than viem).

## Query Builder Shorthands

Factory functions replace `new *QueryBuilder()`:

| Old | New |
|-----|-----|
| `new EvmQueryBuilder()` | `evmQuery()` |
| `new SolanaQueryBuilder()` | `solanaQuery()` |
| `new HyperliquidFillsQueryBuilder()` | `hyperliquidFillsQuery()` |

## Typed Error System

Framework errors carry unique codes linking to docs.

| Error | Code | When |
|-------|------|------|
| `DefaultPipeIdError` | E0001 | `.pipeTo()` called without `id` on source |
| `BlockRangeConfigurationError` | E0002 | Inverted range, invalid date with `'latest'`, unresolvable timestamp |

## Testing with `@subsquid/pipes/testing/evm`

Test pipe logic end-to-end without hitting a real portal. Requires `vitest` and `viem` as dev dependencies.

The library provides:
- **`encodeEvent`** — encode events with full type inference from viem ABIs
- **`mockBlock`** — build mock blocks with auto-generated metadata
- **`evmPortalMockStream`** — spin up a mock portal HTTP server
- **`resetMockBlockCounter`** — reset block numbering between tests

### Basic test setup

```typescript
import { commonAbis, evmDecoder, evmPortalStream } from '@subsquid/pipes/evm'
import {
  type MockPortal,
  encodeEvent,
  evmPortalMockStream,
  mockBlock,
  resetMockBlockCounter,
} from '@subsquid/pipes/testing/evm'

// Helper: collect stream output
async function readAll<T>(stream: AsyncIterable<{ data: T[] }>): Promise<T[]> {
  const res: T[] = []
  for await (const chunk of stream) res.push(...chunk.data)
  return res
}

const ERC20_ABI = [
  {
    type: 'event' as const,
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const
const ALICE = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d' as const
const BOB = '0xc82e11e709deb68f3631fc165ebd8b4e3fc3d18f' as const
```

### Test 1: Decode events from mock blocks

```typescript
let portal: MockPortal

beforeEach(() => resetMockBlockCounter())
afterEach(async () => await portal?.close())

it('should decode ERC20 transfers', async () => {
  const transfer = encodeEvent({
    abi: ERC20_ABI,
    eventName: 'Transfer',
    address: USDC,
    args: { from: ALICE, to: BOB, value: 1_000_000n },
  })

  portal = await evmPortalMockStream({
    blocks: [mockBlock({ transactions: [{ logs: [transfer] }] })],
  })

  const stream = evmPortalStream({
    id: 'test',
    portal: portal.url,
    outputs: evmDecoder({
      range: { from: 0, to: 1 },
      events: { transfers: commonAbis.erc20.events.Transfer },
    }),
  }).pipe((batch) => batch.transfers)

  const transfers = await readAll(stream)
  expect(transfers).toHaveLength(1)
  expect(transfers[0].event.from).toBe(ALICE)
  expect(transfers[0].event.value).toBe(1_000_000n)
  expect(transfers[0].contract).toBe(USDC)
})
```

### Test 2: Custom pipe transformations

```typescript
it('should test custom transformations', async () => {
  const transfer = encodeEvent({
    abi: ERC20_ABI, eventName: 'Transfer', address: USDC,
    args: { from: ALICE, to: BOB, value: 2_000_000n },
  })

  portal = await evmPortalMockStream({
    blocks: [mockBlock({ transactions: [{ logs: [transfer] }] })],
  })

  const stream = evmPortalStream({
    id: 'test',
    portal: portal.url,
    outputs: evmDecoder({
      range: { from: 0, to: 1 },
      events: { transfers: commonAbis.erc20.events.Transfer },
    }),
  })
    .pipe((batch) => batch.transfers)
    .pipe((transfers) =>
      transfers.map((t) => ({
        from: t.event.from,
        to: t.event.to,
        amount: Number(t.event.value) / 1e6,
      })),
    )

  const results = await readAll(stream)
  expect(results[0]).toEqual({ from: ALICE, to: BOB, amount: 2 })
})
```

### Key testing patterns

- `encodeEvent` accepts `abi`, `eventName`, `address`, and typed `args`
- `mockBlock` auto-generates `number`, `hash`, `timestamp` — call `resetMockBlockCounter()` in `beforeEach`
- `evmPortalMockStream` returns `{ url, close() }` — use `portal.url` with `evmPortalStream`
- Chain `.pipe()` on the stream to test transformations
- Multiple event types: pass multiple in `events: { transfers: ..., approvals: ... }` and access `batch.transfers`, `batch.approvals`

## Decoded Event Field Access in `.pipe()`

When using `evmDecoder` with a manual `.pipe()` transform, each decoded event `d` has:

| Field | Type | Description |
|-------|------|-------------|
| `d.event.*` | object | Decoded event parameters (e.g., `d.event.vault`) |
| `d.block.number` | number | Block number |
| `d.rawEvent.transactionHash` | string | Transaction hash |
| `d.rawEvent.logIndex` | number | Log index within the block |
| `d.timestamp` | Date | Block timestamp as JS Date |
| `d.contract` | string | Emitter contract address |
| `d.factory` | object/null | Factory metadata (if using factory pattern) |

**⚠️ Common mistake:** Using `d.blockNumber` or `d.txHash` (which don't exist). These silently return `undefined`, stored as `0` or `""` in ClickHouse.

**⚠️ DateTime64(3) gotcha:** For `DateTime64(3, 'UTC')` columns, pass ISO strings via `d.timestamp.toISOString()` with `date_time_input_format: 'best_effort'`. Passing epoch seconds (e.g., `1700392127`) is misinterpreted as `1970-01-20`.

This differs from the CLI-generated `enrichEvents` helper, which flattens into `{ blockNumber, txHash, timestamp, ...eventParams }` and handles unit conversion internally.

## Timestamp Handling (CRITICAL)

ClickHouse `DateTime` expects seconds, but `d.timestamp.getTime()` returns milliseconds.

### Using `enrichEvents` (auto-generated)

Handles this correctly — divides by 1000 internally:
```typescript
timestamp: new Date(v.timestamp).getTime() / 1000
```

### Manual `.pipe()` transforms

You handle timestamps yourself. **Always divide by 1000:**
```typescript
// WRONG — produces 1970 dates
timestamp: d.timestamp.getTime()

// CORRECT — produces proper dates
timestamp: Math.floor(d.timestamp.getTime() / 1000)
```

### When to use which

| Scenario | Approach |
|----------|----------|
| Standard events, no factory metadata | `enrichEvents` — handles everything |
| Need factory metadata (`d.factory?.event.*`) | Manual `.pipe()` — handle timestamps yourself |
| Both | Manual `.pipe()` + `Math.floor(d.timestamp.getTime() / 1000)` |

## Target Configuration

### ClickHouse

```typescript
import { clickhouseTarget } from '@subsquid/pipes/targets/clickhouse'

stream.pipeTo(clickhouseTarget({
  client: createClient({ url: process.env.CLICKHOUSE_URL }),
  onData: async (ctx, data) => {
    await ctx.insert('transfers', data.transfers)
  },
  onRollback: async (ctx, range) => {
    // Handle chain reorgs
  },
}))
```

### PostgreSQL with Drizzle

```typescript
import { drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres'

stream.pipeTo(drizzleTarget({
  db: drizzle(pool),
  tables: [transfersTable],
  onData: async (ctx, data) => {
    await ctx.db.insert(transfersTable).values(data.transfers)
  },
}))
```
