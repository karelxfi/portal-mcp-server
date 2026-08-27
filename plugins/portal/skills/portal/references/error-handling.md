# Portal Structured Errors

Every error the Portal returns — on any endpoint, from any data source — uses one envelope. Verified against the live API and the [Portal API reference](https://portal.sqd.dev/docs#description/error-handling).

```json
{
  "error": {
    "type": "rate_limit_error",
    "code": "overloaded",
    "message": "Service is overloaded, please try again later",
    "param": "buffer_size",
    "request_id": "0198c3f1-..."
  }
}
```

Two fields carry the meaning:

- **`type`** — the coarse category. The public Portal normally exposes four operational values; protected deployments add two credential values. **Branch on this.**
- **`code`** — the specific cause, open set (codes are added over time). Match on this when you handle one case; treat an unknown `code` as its `type`.

`message` is prose for humans — not stable, not part of the contract; never parse or match on it. `param` appears when the error is about one request parameter. `request_id` appears on 5xx bodies; the same id is on **every** response as the `x-request-id` header — quote it when reporting a problem.

> **204 No Content is not an error.** It is the correct answer when the requested range has no blocks yet; it carries no body.

## Error Types

| `type` | Whose fault | Retry the same request? |
|---|---|---|
| `invalid_request_error` | Yours | **No.** The same request reproduces it exactly — fix the request. |
| `authentication_error` | Yours — the credential | **No.** Present a valid credential. |
| `permission_error` | Yours — the credential's scope | **No.** Use a credential that covers the portal and dataset. |
| `rate_limit_error` | Capacity | **Yes**, after the interval in `Retry-After`. |
| `availability_error` | Portal/upstream, transient | **Yes.** Honor `Retry-After` when present; otherwise back off. |
| `api_error` | A Portal bug | **No.** Retrying cannot succeed — report it with `request_id`. |

The split between the last two matters: `availability_error` means a later attempt can still work; `api_error` means an invariant broke and a retry loop only wastes time.

## Codes

| `code` | `type` | Status | Meaning |
|---|---|---|---|
| `malformed_request` | `invalid_request_error` | 400 | Request/query does not parse or validate; `param` names the field when one is at fault |
| `method_not_allowed` | `invalid_request_error` | 405 | Right path, wrong verb; `Allow` lists accepted verbs |
| `unknown_dataset` | `invalid_request_error` | 404 | No such dataset on this portal |
| `not_found` | `invalid_request_error` | 404 | No such route or resource (also: timestamp resolution beyond the head — message `"block not in hotblocks"`) |
| `base_block_mismatch` | `invalid_request_error` | 409 | `parentBlockHash` doesn't match the canonical parent of the first requested block — a reorg; see below |
| `missing_credential` | `authentication_error` | 403 | No API key was presented |
| `invalid_credential` | `authentication_error` | 403 | Key is unreadable, unknown, or has the wrong secret |
| `revoked_credential` | `authentication_error` | 403 | Key was revoked |
| `expired_credential` | `authentication_error` | 403 | Key is past its expiry |
| `portal_not_allowed` | `permission_error` | 403 | Key is not valid on this Portal deployment |
| `dataset_not_allowed` | `permission_error` | 403 | Key does not cover the requested dataset |
| `overloaded` | `rate_limit_error` | 529 (proxied 429/529) | At capacity; **always** carries `Retry-After` (seconds, ≥ 1, never an HTTP date) |
| `no_workers` | `availability_error` | 503 | No worker currently holds the requested data |
| `retries_exhausted` | `availability_error` | 503 | Workers reachable; every attempt failed transiently |
| `upstream_unavailable` | `availability_error` | 502 (proxied 5xx) | A data source the Portal depends on is down; may preserve the source's `Retry-After` |
| `not_ready` | `availability_error` | 503 | Portal starting up or draining (only `/ready` returns this) |
| `worker_failure` | `api_error` | 500 | A worker returned something that cannot be right |
| `internal_error` | `api_error` | 500 | An invariant the Portal owns was violated |
| `unclassified` | `api_error` | 5xx | Escaped classification — always a bug, please report |

## Fork Recovery (`base_block_mismatch`)

Chains reorg. When you **resume** a `/stream`, pass `parentBlockHash` — the hash of the parent of `fromBlock` (the last block you already trust). If it doesn't match the canonical parent the Portal sees, you get `409` with the standard envelope plus a **top-level** `previousBlocks` array (beside `error`, not inside it):

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "base_block_mismatch",
    "message": "Base block mismatch"
  },
  "previousBlocks": [
    {"number": 21780872, "hash": "0xf6a96a29..."},
    {"number": 21780871, "hash": "0xab12cd..."}
  ]
}
```

`previousBlocks` is a slice of the **current canonical chain** at and below the conflict point, most recent first, guaranteed to contain at least the parent of the requested `fromBlock`.

Recovery:

1. Walk `previousBlocks` looking for a `{number, hash}` you have already processed and stored.
2. Found a shared ancestor at block `K` → resume from `K+1` with `parentBlockHash = hash(K)`.
3. No recognized block → the divergence is deeper than the slice: re-request with an earlier `fromBlock` (still passing `parentBlockHash`) and repeat — each conflict narrows the search.

A client that omits `parentBlockHash` on resume gets no conflict signal and silently processes blocks from a forked chain. `/finalized-stream` never returns 409 — finalized blocks don't reorg.

## Backing Off

- `Retry-After` is mandatory on every `overloaded` response, always ≥ 1 second, always seconds (never an HTTP date). Honor it.
- `upstream_unavailable` may carry a `Retry-After` from the data source; honor it when present, otherwise use your own backoff.
- `authentication_error` and `permission_error` never carry `Retry-After`; waiting cannot make the same credential valid or broaden its scope.
- The Portal does not prescribe a give-up policy — hand-rolled clients should cap total attempts or elapsed time themselves and surface the last `error.type`/`code`/`request_id` when giving up.
- CORS exposes `retry-after` and `x-request-id` (plus the `x-sqd-*` stream metadata headers), so browser clients can read them.

## Client Sketch

```bash
# curl: capture status + body, branch on error.type / error.code
RES=$(curl -sS -w '\n%{http_code}' -X POST "https://portal.sqd.dev/datasets/base-mainnet/stream" \
  -H "content-type: application/json" --data @query.json)
STATUS=$(tail -n1 <<<"$RES"); BODY=$(sed '$d' <<<"$RES")
[ "$STATUS" = 204 ] && echo "no blocks in range yet"        # not an error
jq -r '.error.type + "/" + .error.code' <<<"$BODY" 2>/dev/null  # e.g. rate_limit_error/overloaded
```

The Pipes SDK already implements all of this (infinite retry on retryable types, `Retry-After` honored, fork recovery via `parentBlockHash`) — hand-rolled clients are the ones that need this page.
