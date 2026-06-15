# Plan 001: v0.7.9 Factual UX Release Hardening

Generated on 2026-06-15 for branch `v0.7.9` at commit `30362dd5f769`.

## Goal

Merge the remaining MCP UX, factuality, and safety findings into one release-ready implementation pass for v0.7.9. After this plan lands, the server should:

- Never present estimated, partial, sampled, capped, or paginated data as exact or complete.
- Protect network-reachable MCP POST usage, error messages, logs, cursors, and limit schemas.
- Return the v0.7.9 unified envelope in structured MCP output while preserving the existing text fallback.
- Offer follow-up actions that are executable when safe, and clearly descriptive when not.
- Keep the v0.7.9 release scope grounded in tests and changelog notes.

## Current v0.7.9 Baseline

v0.7.9 already landed important parts of the original audit:

| Covered item | Evidence |
|---|---|
| Unified response envelope | `CHANGELOG.md:16`, `src/helpers/format.ts:1256`, `src/helpers/format.ts:1261` |
| Response-size quality budget | `CHANGELOG.md:17`, `scripts/test-quality.ts:291`, `scripts/test-quality.ts:302` |
| Partial coverage answer disclosure ratchet | `scripts/test-quality.ts:309`, `scripts/test-quality.ts:312` |
| Public `/tools` discovery | `src/http.ts:171`, `src/http.ts:180`, `README.md:123` |
| Complete-window defaults made visible | `CHANGELOG.md:22`, `src/tools/convenience/contract-activity.ts:57`, `src/tools/convenience/time-series.ts:642` |

Do not reimplement those from scratch. Preserve them and extend them.

## Open Findings To Merge

| # | Finding | Impact | Evidence |
|---:|---|---|---|
| 1 | Relative timeframe fallback estimation loses explicit estimated-resolution provenance. | Answers can sound exact when block bounds were estimated. | `src/helpers/timeframe.ts:102`, `src/helpers/timeframe.ts:593`, `src/helpers/timeframe.ts:624`, `src/helpers/result-metadata.ts:137` |
| 2 | `portal_evm_get_contract_activity` fast mode caps analysis but reports complete coverage. | Bounded previews can be presented as full requested-window analysis. | `src/tools/convenience/contract-activity.ts:117`, `src/tools/convenience/contract-activity.ts:229` |
| 3 | HTTP MCP POST on `/` and `/mcp` has no auth gate. | Network-reachable deployments can expose the full tool surface unless protected externally. | `src/http.ts:87`, `src/http.ts:103`, `src/http.ts:205` |
| 4 | Error messages and observability can include raw URL, query, and user-query material. | Sensitive request details can leak to clients or logs. | `src/helpers/fetch.ts:190`, `src/helpers/fetch.ts:384`, `src/helpers/errors.ts:21`, `src/observability.ts:416` |
| 5 | Pagination cursors are unsigned base64url JSON. | Clients can tamper with continuation state unless every tool fully revalidates every field. | `src/helpers/pagination.ts:45`, `src/helpers/pagination.ts:54` |
| 6 | Public limits are uncapped or documented incorrectly. | Large calls can overfetch, and clients get stale guidance. | `src/tools/solana/query-transactions.ts:132`, `src/tools/bitcoin/query-transactions.ts:132`, `src/tools/hyperliquid/query-fills.ts:186`, `src/tools/evm/query-transactions.ts:654`, `src/tools/evm/query-logs.ts:335` |
| 7 | The unified envelope is still emitted only as JSON text. | MCP clients must parse text instead of using structured tool results. | `src/helpers/format.ts:1120`, `src/helpers/format.ts:1291`, `src/helpers/format.ts:1303`, `scripts/test-helpers.ts:57` |
| 8 | Follow-up actions are descriptive labels rather than executable calls with arguments. | Clients cannot safely continue without reinterpreting state. | `src/helpers/ui-metadata.ts:65`, `src/helpers/format.ts:613`, `src/helpers/format.ts:628`, `src/helpers/llm-hints.ts:750` |

## Files In Scope

- `src/helpers/timeframe.ts`
- `src/helpers/result-metadata.ts`
- `src/helpers/format.ts`
- `src/helpers/ui-metadata.ts`
- `src/helpers/llm-hints.ts`
- `src/helpers/errors.ts`
- `src/helpers/fetch.ts`
- `src/helpers/pagination.ts`
- `src/http.ts`
- `src/observability.ts`
- Public limit schemas in:
  - `src/tools/solana/query-transactions.ts`
  - `src/tools/bitcoin/query-transactions.ts`
  - `src/tools/hyperliquid/query-fills.ts`
  - `src/tools/evm/query-transactions.ts`
  - `src/tools/evm/query-logs.ts`
- Tests and test helpers under `scripts/`
- `README.md`, `CHANGELOG.md`, and `scripts/README.md` only for public contract or release-scope documentation

## Files Out Of Scope

- New analytics features or chart types
- Full tool registry consolidation
- OAuth, account management, or multi-tenant identity
- Replacing Portal API networking
- Editing ignored local directories such as `.preview/`, `output/`, or `web-analytics-starter-kit/`
- Package-manager standardization or broad dependency upgrades

## Implementation Sequence

### 1. Preserve Estimated Timeframe Provenance

Current evidence:

```ts
function estimateFromBlock(latestBlock: number, seconds: number, dataset: string, chainType: string) {
  const blockTime = estimateBlockTime(dataset, chainType)
  const blockCount = Math.floor(seconds / blockTime)
  return {
    from_block: Math.max(0, latestBlock - blockCount + 1),
    to_block: latestBlock,
  }
}
```

The fallback branches then return only block bounds plus `range_kind: 'timeframe'`.

Required change:

- Extend `ResolvedBlockWindow` with additive estimated-timeframe provenance. Prefer a field like `timeframe_resolution` or `estimation`, not fake `from_lookup` data.
- Include at least:
  - `resolution: 'estimated'`
  - `dataset`
  - `from_block`
  - `to_block`
  - `estimated_block_time_seconds`
  - `reason`, for example `timestamp_endpoint_unavailable` or `timestamp_endpoint_unsupported`
- Populate it in both timeframe estimation paths:
  - Known unsupported/down endpoint path around `src/helpers/timeframe.ts:589`.
  - Catch fallback around `src/helpers/timeframe.ts:624`.
- Thread the field into `_freshness` or `_execution`, whichever fits the existing envelope best.
- Add answer or notice wording so users see that a relative timeframe was estimated.

Do not break exact timestamp lookup metadata; `from_lookup` and `to_lookup` should keep their current behavior.

### 2. Make Coverage Honest For Bounded Contract Activity

Current evidence:

```ts
if (mode === 'fast') {
  const requestedRange = toBlock - fromBlock + 1
  if (requestedRange > FAST_MODE_BLOCK_CAP) {
    fromBlock = Math.max(fromBlock, toBlock - FAST_MODE_BLOCK_CAP + 1)
    notices.push(
      `Analyzed the most recent ${FAST_MODE_BLOCK_CAP.toLocaleString()} blocks in the requested window because the caller requested a bounded preview.`,
    )
  }
}
```

But the response currently sets:

```ts
coverage: {
  kind: 'block_window',
  window_complete: true,
  result_complete: true,
  continuation: 'none',
  window_from_block: requestedFromBlock,
  window_to_block: toBlock,
  page_to_block: toBlock,
  returned_items: totalTransactions,
},
```

Required change:

- Track both requested bounds and analyzed bounds.
- If fast mode trimmed the window, set `window_complete: false`.
- Keep `result_complete` about returned result pagination/capping, not requested-window coverage.
- Include analyzed bounds in the coverage object, preferably using the same naming as `buildAnalysisCoverage`.
- Rely on the existing `scripts/test-quality.ts` partial-coverage answer check to force the `answer` to disclose the bounded preview.

### 3. Add Optional Auth For HTTP MCP POST

Current evidence:

`src/http.ts` already has bearer helpers for metrics:

```ts
function readBearerToken(req: IncomingMessage): string | undefined {
  const authorization = readHeader(req, 'authorization')
  if (!authorization) return undefined
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}
```

But `POST /` and `POST /mcp` handle tool calls without an auth check.

Required change:

- Keep `/health` public.
- Keep read-only `GET /tools` public.
- Add a separate optional env var, for example `MCP_HTTP_BEARER_TOKEN`.
- If the env var is set, require `Authorization: Bearer <token>` for `POST /` and `POST /mcp`.
- Use constant-time comparison via the existing `safeEqual`.
- Return a JSON-RPC-compatible unauthorized error without echoing the supplied token.
- Preserve local developer startup when no token is configured, but document the deployment risk in README or startup logs.

### 4. Redact Error Context And Observability

Current evidence:

```ts
throw parsePortalError(response.status, errorText, { url, query: body })
```

```ts
throw createTimeoutError(timeout, { url, query: body })
```

```ts
Object.entries(context).forEach(([key, value]) => {
  parts.push(`  ${key}: ${JSON.stringify(value)}`)
})
```

```ts
...(OBS_CAPTURE_USER_QUERY && runtime.userQuery ? { user_query: truncateText(runtime.userQuery, 400) } : {}),
```

Required change:

- Add a shared redaction/sanitization helper.
- Remove URL query strings and authorization-like fields from error context.
- Summarize query bodies instead of embedding full query JSON. Safe examples: dataset, status, attempt, max attempts, block bounds, and field counts.
- Sanitize `ActionableError` context before building `error.message`.
- Sanitize `runtime.userQuery` when `OBS_CAPTURE_USER_QUERY` is enabled.
- Add tests that prove synthetic bearer-like strings, URL tokens, and full query bodies are absent from errors/log payloads.

Never put real secret values in tests or fixtures.

### 5. Sign And Revalidate Pagination Cursors

Current evidence:

```ts
return Buffer.from(
  JSON.stringify({
    version: CURSOR_VERSION,
    ...payload,
  }),
  'utf8',
).toString('base64url')
```

```ts
const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T
```

Required change:

- Add HMAC signing for cursor payloads using Node crypto.
- Use an env secret such as `MCP_CURSOR_SECRET`, with a documented local-development fallback only if acceptable for this repo.
- Keep `version` and `tool` checks.
- Revalidate decoded cursor fields after signature verification.
- Decide and document migration behavior:
  - Prefer rejecting unsigned cursors with an actionable error.
  - If compatibility demands a grace period, gate it behind an explicit env flag.
- Add tests for:
  - Untouched cursor decodes successfully.
  - Cursor for another tool fails.
  - Edited cursor payload fails signature verification.
  - Malformed cursor fails without leaking decoded internals.

### 6. Bound Public Limits And Fix Descriptions

Current evidence:

```ts
// src/tools/solana/query-transactions.ts
limit: z.number().optional().default(50).describe('Max transactions')

// src/tools/bitcoin/query-transactions.ts
limit: z.number().optional().default(50).describe('Max transactions to return (default: 50)')

// src/tools/hyperliquid/query-fills.ts
limit: z.number().optional().default(50).describe('Max fills to return')
```

EVM schemas cap at 200 while descriptions say max 1000.

Required change:

- Add `.int().min(1).max(...)` to Solana transaction, Bitcoin transaction, and Hyperliquid fill limits.
- Use a cap consistent with MCP response-size goals. If no tool-specific lower cap is justified, use 200 to match EVM.
- Fix EVM descriptions from `max: 1000` to `max: 200`.
- Update manifest, tool, or catalog tests if they snapshot schemas or descriptions.

### 7. Add Structured MCP Output While Preserving Text Fallback

Current evidence:

```ts
export function formatResult(
  data: unknown,
  message?: string,
  options?: FormatOptions,
): { content: Array<{ type: 'text'; text: string }> } {
```

```ts
jsonString = JSON.stringify(responsePayload, null, 2)
return { content: [{ type: 'text', text: jsonString }] }
```

Tests parse JSON from text:

```ts
export function extractJson(text: string): any {
  const jsonStart = text.search(/[\[{]/)
  if (jsonStart === -1) {
    throw new Error(`No JSON found in response: ${text.slice(0, 240)}`)
  }

  return JSON.parse(text.slice(jsonStart))
}
```

Required change:

- Confirm the installed `@modelcontextprotocol/sdk` result type supports structured tool result fields, such as `structuredContent`.
- If supported, return the enriched response envelope as structured content and keep the existing JSON text content for backward compatibility.
- Update formatter return types to use SDK-compatible types instead of hard-coded text-only types where practical.
- Update test helpers to prefer structured payloads and fall back to text parsing.
- Add a quality assertion that every current tool emits structured payloads.
- Keep one explicit text-fallback test so older clients remain protected.

Stop if the installed MCP SDK version does not support structured tool results.

### 8. Make Follow-Up Actions Executable When Safe

Current evidence:

```ts
export interface UiFollowUpAction {
  label: string
  intent: 'continue' | 'show_raw' | 'compare_previous' | 'zoom_in' | 'drilldown'
  target?: string
}
```

```ts
actions.unshift({
  label: 'Load older results',
  intent: 'continue',
  target: '_pagination.next_cursor',
})
```

Required change:

- Extend follow-up action metadata additively with fields like:
  - `executable: boolean`
  - `tool?: string`
  - `arguments?: Record<string, unknown>`
  - `cursor_path?: string`
- For pagination continuation, synthesize a safe executable action only when the same tool name and required cursor argument are known.
- Do not guess arguments. If the server cannot safely reconstruct a call, keep a descriptive action with `executable: false`.
- Keep action counts bounded to the existing limit of 6.
- Do not include hidden credentials, raw Portal queries, or unredacted URLs in executable arguments.
- Mirror the executable/descriptive distinction into `_llm.follow_up.actions`.

If cursor signing from step 5 has not landed, avoid making unsigned cursors look like a stronger contract without documenting that dependency in code comments and tests.

### 9. Update Release-Scope Documentation

Required change:

- Add a short v0.7.9 changelog note only after implementation is complete and verified.
- Mention the merged scope as factual UX hardening: provenance, coverage honesty, HTTP/error/cursor safety, structured output, executable next steps, and limit schema cleanup.
- Keep the existing release hygiene note about ignored local directories out of the release.
- Do not add this plan text to the changelog; summarize outcomes, not implementation details.

## Test Plan

Add or update tests to cover:

- Estimated timeframe fallback returns machine-readable estimated provenance.
- Estimated timeframe fallback produces answer or notice wording that discloses estimation.
- Contract activity fast mode over a range larger than `FAST_MODE_BLOCK_CAP` reports `window_complete: false`.
- HTTP MCP POST rejects missing or invalid bearer tokens when `MCP_HTTP_BEARER_TOKEN` is set.
- `GET /tools` remains public.
- Error redaction removes synthetic secret-like substrings and full query bodies.
- Cursor tampering fails.
- Solana, Bitcoin, and Hyperliquid limits reject values above the cap.
- EVM limit descriptions match `.max(200)`.
- Structured payload exists and matches the text fallback envelope.
- Continuation next steps include executable tool and cursor arguments when safe.
- Non-executable follow-ups are clearly marked.

## Verification Commands

Run these during the work as relevant:

```bash
npm run build
npm run test:timestamps
npm run test:tools
npm run test:negative
npm run test:conversations
npm run test:quality
```

Before considering the release branch ready, run:

```bash
npm run test:all
```

Expected final result:

- Build passes.
- Quality gate passes with structured output and no response-size regression.
- Negative tests cover HTTP auth, redaction, and cursor tamper behavior.
- Timestamp and coverage tests prove estimated/partial answers are disclosed.
- The changelog accurately describes the implemented v0.7.9 hardening scope.

## Done Criteria

This plan is done only when all of these are true:

- Estimated timeframe windows are machine-readable as estimated.
- Fast-mode capped windows are machine-readable as partial.
- MCP HTTP POST can be protected with a bearer token without locking down public discovery.
- Client-facing errors and observability payloads redact sensitive request material.
- Cursors are signed and tamper-resistant.
- Public limit schemas are bounded and descriptions match the actual caps.
- Tool results expose structured payloads and text fallback.
- Follow-up actions distinguish executable calls from descriptive suggestions.
- `npm run test:all` passes, or any failure is unrelated, documented, and accepted by the maintainer.

## Stop Conditions

Stop and report back instead of improvising if:

- The release must remain unauthenticated for all HTTP MCP deployments.
- The installed MCP SDK cannot represent structured tool results.
- Existing clients require unsigned editable cursors.
- Additive metadata breaks a known downstream consumer.
- Any change requires editing ignored local directories or broad dependency upgrades.
- Tests require live credentials or real secret values.

## Maintenance Notes

For future MCP tools, preserve this invariant: the response envelope must make uncertainty, sampling, pagination, and continuation state machine-readable, and the human `answer` must not overstate completeness. Security-sensitive context should be summarized, not echoed. Follow-up actions should be executable only when the server can provide safe, explicit tool arguments.
