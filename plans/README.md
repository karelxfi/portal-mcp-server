# v0.7.9 Advisor Findings

Generated on 2026-06-15 for branch `v0.7.9` at commit `30362dd5f769`.

These findings were imported from the MCP UX/factuality audit and reconciled against the v0.7.9 release branch. v0.7.9 has already landed several of the original UX findings, so this directory records both the remaining actionable follow-ups and the items already covered by the release branch.

Do not treat this plan as a source change. It is a handoff plan for a separate executor agent.

## Execution Order And Status

| Plan | Title | Priority | Effort | Depends on | Status |
|---|---|---:|---:|---|---|
| 001 | v0.7.9 factual UX release hardening | P1 | L | - | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED with reason | REJECTED with rationale.

## Plan File

- `plans/001-v079-factual-ux-release-hardening.md`

## Open Findings On v0.7.9

| # | Finding | Category | Impact | Evidence |
|---:|---|---|---|---|
| 1 | Timeframe fallback estimation still loses explicit estimated-resolution provenance for relative timeframe windows. Explicit timestamp lookups can report `resolution`, but `estimateFromBlock` returns only block bounds, and the timeframe fallback path spreads that bare object into the resolved window. | Correctness | Relative-window answers can sound exact after timestamp endpoint fallback or known-unsupported datasets. | `src/helpers/timeframe.ts:102`, `src/helpers/timeframe.ts:593`, `src/helpers/timeframe.ts:624`, `src/helpers/result-metadata.ts:137` |
| 2 | `portal_evm_get_contract_activity` fast mode caps the analyzed block window but still reports `window_complete: true` and `result_complete: true`. | Correctness | A bounded preview can be presented as full requested-window analysis. | `src/tools/convenience/contract-activity.ts:117`, `src/tools/convenience/contract-activity.ts:229` |
| 3 | HTTP POST on `/` and `/mcp` has no MCP auth gate, while the same file already has metrics bearer-token helpers. | Security | A network-reachable deployment can expose the full tool surface unless protected externally. | `src/http.ts:87`, `src/http.ts:103`, `src/http.ts:205` |
| 4 | Error messages and observability can include raw URL, query, and user query material. | Security | Sensitive query filters, RPC URLs, or user prompts can leak to clients or logs. | `src/helpers/fetch.ts:190`, `src/helpers/fetch.ts:384`, `src/helpers/errors.ts:21`, `src/observability.ts:416` |
| 5 | Pagination cursors are unsigned base64url JSON. | Security | A client can edit cursor payloads unless every tool fully revalidates every cursor field. | `src/helpers/pagination.ts:45`, `src/helpers/pagination.ts:54` |
| 6 | Several public limits are still uncapped or documented incorrectly. Solana, Bitcoin, and Hyperliquid transaction/fill limits have no schema maximum, while EVM transaction/log descriptions say max 1000 despite `.max(200)`. | Performance, UX | Large calls can overfetch, and clients receive stale validation guidance. | `src/tools/solana/query-transactions.ts:132`, `src/tools/bitcoin/query-transactions.ts:132`, `src/tools/hyperliquid/query-fills.ts:186`, `src/tools/evm/query-transactions.ts:654`, `src/tools/evm/query-logs.ts:335` |
| 7 | v0.7.9 has a unified JSON envelope, but it is still returned only as text content, and test helpers parse JSON out of text. | UX, DX | MCP clients must parse text instead of consuming structured tool results directly. | `src/helpers/format.ts:1120`, `src/helpers/format.ts:1291`, `src/helpers/format.ts:1303`, `scripts/test-helpers.ts:57` |
| 8 | Follow-up actions are labels/intents/targets rather than executable tool calls with arguments. | UX, DX | Clients can show a suggestion, but cannot safely invoke the next call without reinterpreting state. | `src/helpers/ui-metadata.ts:65`, `src/helpers/format.ts:613`, `src/helpers/format.ts:628`, `src/helpers/llm-hints.ts:750` |

## Findings Already Covered By v0.7.9

These original audit items should not be re-planned unless a drift check proves they regressed:

| Original finding | v0.7.9 evidence |
|---|---|
| Unified response envelope missing. | `CHANGELOG.md:16`, `src/helpers/format.ts:1256`, `src/helpers/format.ts:1261` |
| Response-size budget not checked after enrichment. | `CHANGELOG.md:17`, `scripts/test-quality.ts:291`, `scripts/test-quality.ts:302` |
| Partial coverage answers not ratcheted. | `scripts/test-quality.ts:309`, `scripts/test-quality.ts:312` |
| `/tools` discovery docs absent. | `src/http.ts:171`, `src/http.ts:180`, `README.md:123` |
| Complete-window defaults not visible to callers. | `CHANGELOG.md:22`, `src/tools/convenience/contract-activity.ts:57`, `src/tools/convenience/time-series.ts:642` |

## Verification Baseline

Every executor should run at least:

```bash
npm run build
npm run test:quality
```

When touching timestamp, coverage, cursor, routing, or transport behavior, also run the focused command named in the plan plus the full release gate when feasible:

```bash
npm run test:timestamps
npm run test:tools
npm run test:negative
npm run test:all
```

## Deferred Direction

- Extend schema resources beyond EVM and Solana after structured output is settled.
- Collapse tool registry, tool catalog, manifest specs, and README counts into one source of truth after the v0.7.9 release branch is stable.
- Consider supply-chain hardening, including pinned GitHub Actions and production dependency advisories, as a separate release-security pass.
