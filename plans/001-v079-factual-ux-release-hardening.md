# Plan 001: v0.7.9 Factual UX Release Hardening

Status: Done

Generated on 2026-06-15 for branch `v0.7.9` at commit `30362dd5f769`.
Completed on 2026-06-15.

## Goal

Finish the v0.7.9 response-shape, factuality, and transport-hardening pass without adding a new product feature. The release should be safer for MCP clients and clearer for users when data is estimated, partial, capped, or paginated.

## Completed Changes

### 1. Estimated Timeframe Provenance

Relative timeframe fallbacks now include machine-readable estimated block-window provenance in `_freshness.estimated_timeframe`. User-facing notices explain when timestamp lookup was unsupported or unavailable and the block window was estimated.

Evidence:
- `src/helpers/timeframe.ts`
- `src/helpers/result-metadata.ts`
- `scripts/test-timestamps.ts`

### 2. Honest Contract-Activity Coverage

`portal_evm_get_contract_activity` now tracks requested and analyzed block bounds separately. Fast bounded previews mark `window_complete: false` when they analyze only part of the requested window, while `result_complete` remains tied to result pagination.

Evidence:
- `src/tools/convenience/contract-activity.ts`
- `scripts/test-quality.ts`

### 3. Optional HTTP MCP POST Protection

HTTP mode now supports `MCP_HTTP_BEARER_TOKEN` for `POST /` and `POST /mcp`. `/health`, `GET /tools`, and `GET /tools.json` remain public read-only surfaces.

Evidence:
- `src/http.ts`
- `README.md`

### 4. Redacted Client-Facing Errors

Actionable errors now strip URL query strings, redact authorization-like fields, and summarize large query bodies instead of echoing full request material.

Evidence:
- `src/helpers/errors.ts`
- `scripts/test-negative.ts`

### 5. Signed Pagination Cursors

Pagination cursors are HMAC-signed and revalidated on decode. Unsigned, malformed, cross-tool, or edited cursors fail with actionable guidance.

Evidence:
- `src/helpers/pagination.ts`
- `scripts/test-negative.ts`

### 6. Bounded Public Limits

Solana transaction, Bitcoin transaction, and Hyperliquid fill limits are capped at 200. EVM transaction and log descriptions now match their actual 200-item caps.

Evidence:
- `src/tools/solana/query-transactions.ts`
- `src/tools/bitcoin/query-transactions.ts`
- `src/tools/hyperliquid/query-fills.ts`
- `src/tools/evm/query-transactions.ts`
- `src/tools/evm/query-logs.ts`

### 7. Structured MCP Results

Successful tools now return the unified envelope through MCP `structuredContent` and keep an equivalent compact JSON text fallback for older clients.

Evidence:
- `src/helpers/format.ts`
- `scripts/test-helpers.ts`
- `scripts/test-quality.ts`

### 8. Executable Follow-Up Actions

Safe pagination continuations now include executable tool-call metadata with explicit cursor arguments. Suggestions that cannot be safely reconstructed are marked non-executable.

Evidence:
- `src/helpers/ui-metadata.ts`
- `src/helpers/format.ts`
- `src/helpers/llm-hints.ts`
- `scripts/test-quality.ts`

## Verification

The release-hardening pass was verified with:

```bash
npm run build
npm run test:timestamps
npm run test:negative
npm run test:tools
npm run test:evm-investigator
npm run test:all
```

Additional manual HTTP smoke covered public `/health` and tool discovery plus protected MCP POST behavior.

## Deferred After v0.7.9

- Expand schema resources beyond EVM and Solana.
- Collapse tool registry, tool catalog, manifest specs, and README counts into one source of truth.
- Review dependency and workflow pinning in a separate release-hardening pass.
