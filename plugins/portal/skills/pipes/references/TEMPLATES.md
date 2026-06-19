# Templates & Network-Specific Setup

The Pipes CLI ships with a catalog of templates; discover them with:
```bash
pnpx @subsquid/pipes-cli@1.0.0-alpha.4 init --schema
```

Template IDs are **camelCase** (`uniswapV3Swaps`, not `uniswap-v3-swaps`). Each template has a required `params` schema — check `--schema` for the exact fields.

## EVM Templates

### erc20Transfers — ERC20 Transfer events

```json
{
  "templateId": "erc20Transfers",
  "params": {
    "contractAddresses": ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
    "range": {"from": "21000000"}
  }
}
```

### uniswapV3Swaps — Uniswap V3 swaps via factory pattern

```json
{
  "templateId": "uniswapV3Swaps",
  "params": {
    "factoryAddress": "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    "range": {"from": "21000000"}
  }
}
```

**Known CLI bug:** `factoryAddress` is silently dropped. After generation, `grep "address:" src/index.ts` — if empty (`['']`), patch manually:
```bash
sed -i '' "s|address: \[''\]|address: ['<FACTORY>']|" src/index.ts
```

### custom — Custom contract events

**Requires full ABI event objects, NOT just event names.**

```json
{
  "templateId": "custom",
  "params": {
    "contracts": [{
      "contractAddress": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "contractName": "WETH",
      "contractEvents": [
        {
          "name": "Deposit",
          "type": "event",
          "inputs": [
            {"name": "dst", "type": "address", "indexed": true},
            {"name": "wad", "type": "uint256"}
          ]
        }
      ],
      "range": {"from": "21000000"}
    }]
  }
}
```

**Common mistake:** `"contractEvents": ["Deposit", "Withdrawal"]` (just names) fails with `Invalid input: expected array, received undefined`. Each event needs full `{name, type, inputs}` with `indexed: true` for indexed params.

### Template Parameter Mapping

| templateId | Required params | Description |
|------------|----------------|-------------|
| `custom` | `contracts[]` with `{contractAddress, contractName, contractEvents, range}` | Custom contract events with full ABI |
| `erc20Transfers` | `contractAddresses[]`, `range` | ERC20 Transfer events |
| `uniswapV3Swaps` | `factoryAddress`, `range` | Uniswap V3 swaps via factory pattern |

## Solana (SVM) Templates

### custom — Blank template

**Note:** SVM `custom` template may fail with `Invalid input: expected array, received undefined`. If so, scaffold manually (package.json, tsconfig, src/index.ts, docker-compose.yml).

### Anchor vs Non-Anchor: Determine First

Before writing any Solana indexer, determine the program type — it dictates the entire approach:

|  | Anchor | Non-Anchor |
|---|---|---|
| Discriminator | `d8` (8 bytes, from `sha256("global:<name>")`) | `d1` (1 byte, Borsh enum index) |
| Typegen | Yes — `@subsquid/solana-typegen` | No — manual Borsh decoding |
| IDL available | On-chain or GitHub (`target/idl/*.json`) | No IDL — read Rust source |
| Decoding | `instructions.swap.decode(ins)` → typed `{ accounts, data }` | Manual: read bytes from base58-decoded data |
| Examples | Jito Tip Distribution, Jupiter Lend, Orca Whirlpool | SPL Token, SPL Stake Pool, System Program |

**Detection:** Query Portal for the program's instructions and check `d8` values. 8-byte hex (`0x3ec6d6c1d59f6cd2`) = Anchor. Single meaningful byte in `d1` = non-Anchor.

### Anchor Programs: Use Typegen

```bash
npm install @subsquid/solana-typegen

# Method 1: Local IDL JSON
npx squid-solana-typegen src/abi whirlpool.json

# Method 2: Fetch IDL from on-chain
npx squid-solana-typegen src/abi whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc#whirlpool

# Method 3: Glob pattern
npx squid-solana-typegen src/abi ./idl/*
```

Generated module exports:
- `programId` — public key constant
- `instructions.<name>.d8` — 8-byte discriminator
- `instructions.<name>.decode(ins)` — typed decoder → `{ accounts, data }`
- `instructions.<name>.accountSelection(mapping)` — account-position filter helper

**Usage with SolanaQueryBuilder:**
```typescript
import * as whirlpool from './abi/whirlpool'
import { solanaPortalStream, solanaQuery } from '@subsquid/pipes/solana'

const query = solanaQuery()
  .addFields({
    block: { number: true, timestamp: true },
    transaction: { signatures: true },
    instruction: { programId: true, accounts: true, data: true },
  })
  .addInstruction({
    range: { from: 280000000 },
    request: {
      programId: [whirlpool.programId],
      d8: [whirlpool.instructions.swap.d8],
      ...whirlpool.instructions.swap.accountSelection({
        whirlpool: ['7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm']
      }),
      transaction: true,
    },
  })
```

**Decoding in `.pipe()`:**
```typescript
.pipe((blocks) => {
  const swaps = []
  for (const block of blocks) {
    for (const ins of block.instructions ?? []) {
      if (ins.programId === whirlpool.programId && ins.d8 === whirlpool.instructions.swap.d8) {
        const decoded = whirlpool.instructions.swap.decode(ins)
        swaps.push({
          slot: block.header.number,
          timestamp: new Date(block.header.timestamp * 1000).toISOString(),
          ...decoded.data,
        })
      }
    }
  }
  return { swaps }
})
```

**Where to find IDLs:**
1. **On-chain** — `npx squid-solana-typegen src/abi <programId>#<name>` queries the chain
2. **GitHub** — most protocols publish `target/idl/*.json`
3. **Anchor IDL registries** — stored at a PDA derived from program ID
4. **Protocol docs** — some link IDLs directly

**When on-chain IDL is missing:** Some Anchor programs don't store IDLs on-chain. `programId#name` fails with `Failed to fetch IDL`. Download from the protocol's GitHub repo and pass local files.

### Non-Anchor Programs: Manual d1 Decoding

**Typegen does NOT work for non-Anchor programs** (SPL Token, SPL Stake Pool, System Program, etc.).

**Step 1: Discover d1 discriminators from Portal:**
```bash
curl -s 'https://portal.sqd.dev/datasets/solana-mainnet/stream' \
  -H 'content-type: application/json' \
  -H 'accept: application/x-ndjson' \
  -d '{"type":"solana","fromBlock":400000000,"toBlock":400010000,
       "instructions":[{"programId":["SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy"]}],
       "fields":{"instruction":{"programId":true,"d1":true}}}' \
  | python3 -c "import sys,json; counts={}
for l in sys.stdin:
  for i in json.loads(l).get('instructions',[]):
    d=i.get('d1','?'); counts[d]=counts.get(d,0)+1
for k,v in sorted(counts.items(),key=lambda x:-x[1]): print(f'{k}: {v}')"
```

**Step 2: Map d1 values to instruction names from the Rust source:**
```typescript
const INSTRUCTIONS: Record<string, string> = {
  '0x09': 'DepositStake',
  '0x0a': 'WithdrawStake',
  '0x0e': 'DepositSol',
  '0x10': 'WithdrawSol',
}
```

**Step 3: Filter by d1 in SolanaQueryBuilder:**
```typescript
.addInstruction({
  range: { from: FROM_SLOT },
  request: {
    programId: [SPL_STAKE_POOL],
    d1: Object.keys(INSTRUCTIONS),
    isCommitted: true,
    transaction: true,
  },
})
```

**Step 4: Decode manually in `.pipe()`:**
```typescript
const data = base58Decode(ins.data)
const d1Hex = '0x' + data[0].toString(16).padStart(2, '0')
const instrName = INSTRUCTIONS[d1Hex]

// Read u64 LE amount after d1 byte (if present)
let amount = 0n
if (data.length >= 9) {
  for (let i = 0; i < 8; i++) amount |= BigInt(data[1 + i]) << BigInt(i * 8)
}

const pool = ins.accounts?.[0] ?? ''
```

**Volume warning:** Many non-Anchor programs (especially SPL Stake Pool) have very low on-chain instruction volume. Check volume with Portal BEFORE building.

### CPI (Cross-Program Invocation) — CRITICAL for DeFi

Many Solana DeFi protocols use layered architecture where user-facing programs call core programs via CPI. Example: Jupiter Lend's Lending/Vaults call the Liquidity program's `operate` via CPI.

**Symptom:** Indexer returns zero data but Portal shows instructions exist → instructions are CPI (inner instructions).

**Fix:** Add `innerInstructions: true` to `addInstruction()`:
```typescript
.addInstruction({
  range: { from: FROM_SLOT },
  request: {
    programId: [myProgram.programId],
    d8: [myProgram.instructions.operate.d8],
    isCommitted: true,
    transaction: true,
    innerInstructions: true,
  },
})
```

**Detect:** Query Portal for the program's instructions and check `instructionAddress`. All entries with `len > 1` = all CPI. Without this flag, the indexer silently captures zero data.

## Hyperliquid Fills (No CLI Template)

The Pipes SDK supports Hyperliquid fills natively via `@subsquid/pipes/hyperliquid`, but there is **no CLI template yet**. Scaffold manually. See [HYPERLIQUID_GUIDE.md](HYPERLIQUID_GUIDE.md) for the complete walkthrough.

Quick pattern:
```typescript
import { hyperliquidFillsPortalStream, hyperliquidFillsQuery } from '@subsquid/pipes/hyperliquid'

const query = hyperliquidFillsQuery()
  .addRange({ from: 920000000 })
  .addFields({
    block: { number: true, timestamp: true },
    fill: { user: true, coin: true, px: true, sz: true, side: true, dir: true,
            closedPnl: true, fee: true, feeToken: true, crossed: true, startPosition: true },
  })
  .addFill({ range: { from: 920000000 }, request: { coin: ['BTC', 'ETH', 'SOL'] } })

await hyperliquidFillsPortalStream({
  id: 'hl-perps-fills',
  portal: 'https://portal.sqd.dev/datasets/hyperliquid-fills',
  outputs: query,
})
```

**Critical:** `.addFill()` requires a `range` — omitting it crashes. Dataset starts at block **750,000,000**. Blocks increment at ~1/second, so `current_block - (days × 86400)` estimates a start.

## Supported Sinks

- **ClickHouse** — high-performance analytics (recommended)
- **PostgreSQL** — relational with Drizzle ORM

**Memory sink** is listed in the schema but not yet implemented in the CLI.
