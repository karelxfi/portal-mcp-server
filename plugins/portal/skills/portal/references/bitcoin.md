# Bitcoin — Query Reference

## Query Structure

Portal Stream API uses POST requests to `/datasets/bitcoin-mainnet/stream`.

**Basic Bitcoin query structure:**

```json
{
  "type": "bitcoin",
  "fromBlock": 942000,
  "toBlock": 942010,
  "transactions": [{}],
  "fields": {
    "block": {"number": true, "hash": true, "timestamp": true},
    "transaction": {"txid": true, "size": true, "vsize": true}
  }
}
```

**Field explanations:**
- `type: "bitcoin"` — **Required** (not "evm" or "solana")
- `fromBlock/toBlock` — Block range (dataset starts at block 0, current ~942K)
- Data keys: `transactions`, `inputs`, `outputs` — arrays of filter objects
- Fields keys: `block`, `transaction`, `input`, `output`

---

## Data Keys & Filters

### Transactions

Filter key: `transactions`

No filter fields — use `[{}]` to match all transactions, or omit entirely and use `inputs`/`outputs` with `transaction: true` to pull related transactions.

### Inputs

Filter key: `inputs`

| Filter Field | Type | Description |
|---|---|---|
| `type` | string[] | Input type: `"coinbase"` or `"tx"` |
| `prevoutScriptPubKeyAddress` | string[] | Previous output's address (who is spending) |
| `prevoutScriptPubKeyType` | string[] | Previous output's script type |
| `prevoutGenerated` | boolean | Whether the prevout was from a coinbase tx |

### Outputs

Filter key: `outputs`

| Filter Field | Type | Description |
|---|---|---|
| `scriptPubKeyAddress` | string[] | Recipient address |
| `scriptPubKeyType` | string[] | Script type (see below) |

### Script Types (for filtering)

| Type | Description |
|---|---|
| `witness_v0_keyhash` | Native SegWit (P2WPKH) — most common |
| `witness_v1_taproot` | Taproot (P2TR) |
| `pubkeyhash` | Legacy (P2PKH) |
| `scripthash` | P2SH |
| `witness_v0_scripthash` | SegWit P2WSH |
| `nulldata` | OP_RETURN (data outputs, 0 value) |

### Relation Flags (on input/output filters)

These boolean flags pull related data when filtering inputs or outputs:

| Flag | On Filter | Effect |
|---|---|---|
| `transaction` | inputs or outputs | Include the parent transaction |
| `transactionInputs` | inputs or outputs | Include all inputs of the parent tx |
| `transactionOutputs` | inputs or outputs | Include all outputs of the parent tx |

**Example:** Find coinbase inputs and get the full coinbase transaction with all outputs:
```json
{
  "inputs": [{"type": ["coinbase"], "transaction": true, "transactionOutputs": true}]
}
```

---

## Examples

### Example 1: Recent Blocks with Metadata

```json
{
  "type": "bitcoin",
  "fromBlock": 942000,
  "toBlock": 942005,
  "fields": {
    "block": {
      "number": true, "hash": true, "timestamp": true,
      "size": true, "weight": true, "difficulty": true
    }
  }
}
```

**Dataset:** `bitcoin-mainnet`
**Notes:** Returns block headers only (no transactions/inputs/outputs). Timestamps are Unix seconds.

---

### Example 2: All Transactions in a Block

```json
{
  "type": "bitcoin",
  "fromBlock": 942000,
  "toBlock": 942000,
  "transactions": [{}],
  "fields": {
    "block": {"number": true, "hash": true, "timestamp": true},
    "transaction": {"txid": true, "size": true, "vsize": true, "weight": true, "version": true, "locktime": true}
  }
}
```

**Notes:** A single block typically has 2000-4000 transactions. Use narrow ranges.

---

### Example 3: Track Payments to an Address

**Use case:** Find all outputs sent to a specific Bitcoin address.

```json
{
  "type": "bitcoin",
  "fromBlock": 940000,
  "toBlock": 942000,
  "outputs": [{
    "scriptPubKeyAddress": ["bc1qxhmdufsvnuaaaer4ynz88fspdsxq2h9e9cetdj"],
    "transaction": true
  }],
  "fields": {
    "block": {"number": true, "timestamp": true},
    "transaction": {"txid": true},
    "output": {"transactionIndex": true, "outputIndex": true, "value": true, "scriptPubKeyAddress": true}
  }
}
```

**Notes:**
- `transaction: true` on the output filter pulls the parent transaction's txid
- Values are in **BTC** (float), not satoshis — e.g., `0.54199819` = 0.542 BTC

---

### Example 4: Track Spending From an Address

**Use case:** Find all inputs that spend UTXOs previously sent to an address.

```json
{
  "type": "bitcoin",
  "fromBlock": 940000,
  "toBlock": 942000,
  "inputs": [{
    "prevoutScriptPubKeyAddress": ["bc1qxhmdufsvnuaaaer4ynz88fspdsxq2h9e9cetdj"],
    "transaction": true
  }],
  "fields": {
    "block": {"number": true, "timestamp": true},
    "transaction": {"txid": true},
    "input": {"transactionIndex": true, "inputIndex": true, "txid": true, "vout": true, "prevoutValue": true, "prevoutScriptPubKeyAddress": true}
  }
}
```

**Notes:**
- `prevoutScriptPubKeyAddress` matches the address of the UTXO being spent
- `txid` + `vout` on the input reference the previous output being consumed
- `prevoutValue` is the value of the spent UTXO (in BTC)

---

### Example 5: Monitor Taproot Activity

**Use case:** Track all Taproot (P2TR) outputs in recent blocks.

```json
{
  "type": "bitcoin",
  "fromBlock": 942000,
  "toBlock": 942005,
  "outputs": [{"scriptPubKeyType": ["witness_v1_taproot"]}],
  "fields": {
    "block": {"number": true, "timestamp": true},
    "output": {"transactionIndex": true, "outputIndex": true, "value": true, "scriptPubKeyType": true, "scriptPubKeyAddress": true}
  }
}
```

---

### Example 6: Coinbase Transactions (Mining Rewards)

**Use case:** Find coinbase transactions and their reward outputs.

```json
{
  "type": "bitcoin",
  "fromBlock": 942000,
  "toBlock": 942010,
  "inputs": [{
    "type": ["coinbase"],
    "transaction": true,
    "transactionOutputs": true
  }],
  "fields": {
    "block": {"number": true, "timestamp": true},
    "transaction": {"txid": true},
    "input": {"transactionIndex": true, "coinbase": true},
    "output": {"transactionIndex": true, "outputIndex": true, "value": true, "scriptPubKeyAddress": true}
  }
}
```

**Notes:**
- Coinbase inputs have `txid: null`, `vout: null`, and a hex `coinbase` field containing the mining pool's signature
- The first output of a coinbase tx is typically the block reward (currently 3.125 BTC + fees)
- Outputs with `value: 0.0` and `address: null` are OP_RETURN data outputs

---

### Example 7: Full Transaction Detail (Inputs + Outputs)

**Use case:** Get complete transaction data including all inputs and outputs for a block range.

```json
{
  "type": "bitcoin",
  "fromBlock": 942000,
  "toBlock": 942000,
  "transactions": [{}],
  "fields": {
    "block": {"number": true, "hash": true, "timestamp": true},
    "transaction": {"txid": true, "hash": true, "size": true, "vsize": true, "weight": true},
    "input": {"transactionIndex": true, "inputIndex": true, "txid": true, "vout": true, "type": true, "prevoutValue": true, "prevoutScriptPubKeyAddress": true, "txInWitness": true},
    "output": {"transactionIndex": true, "outputIndex": true, "value": true, "scriptPubKeyType": true, "scriptPubKeyAddress": true}
  }
}
```

**Notes:**
- Without any filter in `transactions`, `inputs`, or `outputs`, adding fields for input/output still returns all data for that block
- `hash` on transaction is the witness-inclusive hash (different from `txid` for SegWit txs)
- `txInWitness` is an array of hex strings (witness data)

---

## Block Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `number` | integer | Block height |
| `hash` | string | Block hash (64 hex chars with leading zeros) |
| `parentHash` | string | Previous block hash |
| `timestamp` | integer | Unix timestamp (seconds) |
| `medianTime` | integer | Median time of previous 11 blocks |
| `version` | integer | Block version |
| `merkleRoot` | string | Merkle root hash |
| `nonce` | integer | Mining nonce |
| `target` | string | Mining target |
| `bits` | string | Compact target representation |
| `difficulty` | float | Mining difficulty |
| `chainWork` | string | Cumulative chain work |
| `strippedSize` | integer | Block size without witness data |
| `size` | integer | Full block size (bytes) |
| `weight` | integer | Block weight (WU) |

## Transaction Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `transactionIndex` | integer | Position in block (0 = coinbase) |
| `txid` | string | Transaction ID (non-witness hash) |
| `hash` | string | Witness-inclusive hash |
| `hex` | string | Raw transaction hex |
| `size` | integer | Transaction size (bytes) |
| `vsize` | integer | Virtual size (weight/4) |
| `weight` | integer | Transaction weight (WU) |
| `version` | integer | Transaction version |
| `locktime` | integer | Lock time |

## Input Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `transactionIndex` | integer | Parent transaction position |
| `inputIndex` | integer | Input position within transaction |
| `type` | string | `"coinbase"` or `"tx"` |
| `txid` | string/null | Previous output's transaction ID (null for coinbase) |
| `vout` | integer/null | Previous output's index (null for coinbase) |
| `scriptSigHex` | string | ScriptSig hex |
| `scriptSigAsm` | string | ScriptSig assembly |
| `sequence` | integer | Sequence number |
| `coinbase` | string/null | Coinbase hex data (only for coinbase inputs) |
| `txInWitness` | string[] | Witness data (array of hex strings) |
| `prevoutValue` | float/null | Value of spent UTXO (BTC, null for coinbase) |
| `prevoutHeight` | integer/null | Block height of spent UTXO |
| `prevoutGenerated` | boolean/null | Whether spent UTXO was from coinbase |
| `prevoutScriptPubKeyType` | string/null | Script type of spent UTXO |
| `prevoutScriptPubKeyAddress` | string/null | Address of spent UTXO |

## Output Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `transactionIndex` | integer | Parent transaction position |
| `outputIndex` | integer | Output position (vout) |
| `value` | float | Output value in **BTC** (not satoshis) |
| `scriptPubKeyHex` | string | ScriptPubKey hex |
| `scriptPubKeyAsm` | string | ScriptPubKey assembly |
| `scriptPubKeyType` | string | Script type (see Script Types table) |
| `scriptPubKeyAddress` | string/null | Recipient address (null for OP_RETURN) |

---

## Key Concepts

**Values are in BTC (float), not satoshis:**
```json
{"value": 3.15237202}  // = 3.15 BTC = 315,237,202 satoshis
{"value": 0.00007336}  // = 7,336 satoshis
```

**Timestamps are in seconds** (same as EVM, unlike Hyperliquid which uses milliseconds).

**UTXO model:** Bitcoin uses Unspent Transaction Outputs, not account balances. To track an address's activity:
- **Receiving:** Filter `outputs` by `scriptPubKeyAddress`
- **Spending:** Filter `inputs` by `prevoutScriptPubKeyAddress`

**Coinbase transactions:** The first transaction (index 0) in every block is the coinbase. Its input has `type: "coinbase"`, `txid: null`, and contains pool identification data in the `coinbase` hex field.

**SegWit transaction hashes:** `txid` excludes witness data; `hash` includes it. For non-SegWit transactions they're identical.

---

## Common Mistakes

### Mistake 1: Using Wrong Type Field

```json
{"type": "evm"}  // Wrong - Bitcoin is not EVM
```
**Fix:** Always use `"type": "bitcoin"`.

---

### Mistake 2: Expecting Values in Satoshis

```json
// Output: {"value": 0.54199819}
// This is 0.542 BTC, NOT 54199819 satoshis
```
Portal returns Bitcoin values as **BTC floats**. Multiply by 100,000,000 for satoshis.

---

### Mistake 3: Using `coinbase` as a Filter Field

```json
{"inputs": [{"coinbase": true}]}  // Wrong - coinbase is not a filter field
```
**Fix:** Use `"type": ["coinbase"]` to filter for coinbase inputs:
```json
{"inputs": [{"type": ["coinbase"]}]}
```

---

### Mistake 4: Missing Relation Flags

```json
// Filtering outputs but wanting transaction data too
{"outputs": [{"scriptPubKeyAddress": ["bc1q..."]}]}  // Gets outputs only
```
**Fix:** Add `"transaction": true` to the filter to pull related transactions:
```json
{"outputs": [{"scriptPubKeyAddress": ["bc1q..."], "transaction": true}]}
```

---

### Mistake 5: Using EVM-style Field Keys

```json
{"fields": {"log": {"address": true}}}  // Wrong - no logs in Bitcoin
```
**Fix:** Use Bitcoin field keys: `block`, `transaction`, `input`, `output`.

---

### Mistake 6: Too Broad Query

```json
{"transactions": [{}], "fromBlock": 0, "toBlock": 942000}  // Millions of results
```
**Fix:** Use narrow block ranges (10-100 blocks) or specific address filters.

---

## Performance Tips

- **Filter by address** when possible — `scriptPubKeyAddress` on outputs or `prevoutScriptPubKeyAddress` on inputs
- **Use narrow block ranges** for unfiltered queries (1-10 blocks per request)
- **Request only needed fields** — omit `hex`, `scriptSigHex`, `scriptPubKeyHex`, `txInWitness` unless needed
- **Use relation flags** (`transaction: true`) instead of separate queries to get related data in one request
- **Filter by script type** to narrow results (e.g., only Taproot outputs)
