# Release checks

This document summarises what a release of the SQD Portal MCP server verifies before it is published, and the behavioural contracts those checks hold. A release means every applicable check passed on the release commit. It does not mean upstream data services or networks can never fail.

## Two gates

- `npm run test:offline` builds the server, runs the linter, the type checker, and the unit tests, and runs every suite that needs no Portal access. It is the required pull-request check.
- `npm run test:live` runs the suites that talk to SQD Portal or an installed client. It reports on every pull request and is required on a release tag.

[scripts/README.md](scripts/README.md) lists every suite and the gate it belongs to.

## What a release verifies

**Data correctness.** Timestamp units and window boundaries on every supported chain family, with future or unverifiable windows rejected. Stable row identities with no missing or duplicate ids. Exact page continuation with no repeated or skipped rows, including inside dense blocks. Wallet membership and paging. Bitcoin units and exact satoshi fee accounting. Aggregate and candle arithmetic, including Hyperliquid candles reproduced from raw fills. Representative results are compared row for row with direct Portal queries for EVM, Solana, Bitcoin, Substrate, Hyperliquid, and Tron.

**Coverage and pagination.** `_pagination.has_more` is true exactly when a cursor is present. A scan that stopped before the start of the requested window reports `window_complete: false` and names what it read. An oldest-first page describes itself as such, and a truncated list says so.

**Input validation.** Malformed Solana, Bitcoin, Hyperliquid, and Tron identifiers, and filters that do not fit the selected query, fail before any Portal request.

**Response budgets.** Every tool has a measured size and latency budget. Oversized output fails with structured recovery guidance and never drops rows silently. The tool catalog a client loads is measured per tool and may not grow past its budget without a documented reason.

**Protocol.** Stateless MCP `2026-07-28` and the legacy negotiation path over stdio and Streamable HTTP. One tool registry with all 31 tools listed and callable, and 21 tools keeping structured and text results in both the App-enabled and App-disabled surfaces. Every declared negative fixture returns the expected structured error.

**Transport and runtime.** Host and Origin checks, request timeouts, the body cap, and readiness. Weighted tool admission with fair promotion, per-caller share, cancellation, timeout, overload, and no capacity leaks. Retry budgets, malformed and truncated response bodies, and large results over stdio. Sustained mixed load with bounded error rate and process memory.

**Explorer.** The portable MCP Apps contract, exact CSP, and bundle size. Every preview and screenshot renders recorded Portal data; only sparse, mixed, and error cells are synthetic. Rendered values reconcile with the structured content, missing buckets stay gaps, a locked layout baseline across fixtures, viewports, and themes, keyboard reach and zero serious or critical accessibility findings, and every host action driven through the official MCP Apps bridge.

**Distribution.** The Codex, Claude Code, Grok Build, Gemini CLI, and Cursor packages and the Claude Desktop bundle share the release version and start. The published npm package contains only runtime files, and the dependency tree has no known audit finding.

**Model-in-the-loop eval.** A model answers a pinned set of questions through the server and its final answers are graded against Portal-verified values, including cases it should decline.

## Untrusted text policy

Some strings in a result were written by someone other than SQD: token names and symbols from open token lists, Substrate pallet, call, and event names, Solana program labels, Hyperliquid coin names, protocol names and slugs, and any label copied from on-chain data. Every tool result names those fields in `_tool_contract.untrusted_fields` so an agent knows which values are third-party names.

- The raw value is preserved exactly in `structuredContent` (`items`, `matches`, `summary`, `_evidence`, and every other data field).
- A third-party value enters prose (`answer`, `_summary`, `_notice`, `_notices`, `_ui.headline`, panel titles, `next_steps` labels, error summaries and suggestions) only after control, zero-width, and bidirectional override characters are removed, whitespace is collapsed, the length is capped, and the value is wrapped in double quotes unless it is a plain ticker such as `USDC`.
- Every prose field is cleaned once more in the shared formatter and in the error envelope.
- The Explorer renders every value as a text node, and its CSV export prefixes cells that start with `=`, `+`, `-`, or `@` with a quote so spreadsheets do not evaluate them.
- The server never fetches behavioural instructions from external sources; token lists supply names and addresses only.

## Terminal outcome contract

Every tool invocation increments `mcp_tool_calls_total` exactly once with one terminal status:

- `success`: complete, usable result.
- `partial`: usable result that explicitly reports incomplete coverage or an unavailable section.
- `tool_error`: MCP completed the invocation with `isError: true`, including expected validation and bounded upstream failures.
- `request_error`: the invocation failed before a structured MCP tool result could be produced.
- `cancelled`: the client cancelled the invocation or its propagated request.

Only `tool_error` and `request_error` increment `mcp_tool_errors_total`. Partial results and cancellations remain independently measurable instead of inflating the server-error rate.

## Metrics and privacy

All 31 tools pass through one instrumented registration surface, which guarantees the common per-tool series without copying metric code into individual tools:

| Metric | Purpose | Bounded labels |
|---|---|---|
| `mcp_tool_calls_total` | Calls and terminal outcomes | tool, status, transport, server version |
| `mcp_tool_outcomes_total` | Result state and failure attribution | tool, status, result state, error origin, error code, transport, server version |
| `mcp_tool_call_duration_seconds` | End-to-end tool latency | tool, transport |
| `mcp_tool_calls_active` | In-flight calls | tool, transport |
| `mcp_tool_errors_total` | Tool and request error classes | tool, transport, error type |
| `mcp_tool_response_size_bytes` | Serialized response size | tool, transport |
| `mcp_tool_intent_calls_total` | Product intent usage | tool, declared intent, VM |
| `mcp_portal_api_requests_total` | Portal request outcomes | method, HTTP status |
| `mcp_portal_upstream_active` | Active Portal requests admitted by the shared capacity controller | none |
| `mcp_portal_upstream_queued` | Portal requests waiting for capacity | none |
| `mcp_portal_admission_rejected_total` | Requests rejected before upstream work | bounded reason |
| `mcp_portal_admission_wait_seconds` | Time spent waiting for upstream capacity | none |
| `mcp_dataset_queries_total` | Canonical dataset usage | dataset, VM |
| `mcp_tool_admission_active_by_family` | Admitted calls per bounded client family | client family |
| `mcp_tool_client_calls_total` | Protocol-declared client usage | transport, bounded client family, major version, active toolset (`all`, one toolset name, or `custom`) |

Metric labels never contain wallet addresses, transaction hashes, free-form prompts, authorization values, request bodies, raw error messages, or arbitrary client headers. The bundled Grafana dashboard is checked against the emitted metric names, so a stale dashboard query fails the offline gate. The metrics endpoint is disabled unless deliberately configured.

## Reliability invariants

- Full-response deadlines cover headers and bodies for JSON and NDJSON requests.
- Invalid JSON, truncated NDJSON, and premature body termination never become complete-looking data.
- The formatter never silently drops rows or nested evidence to fit the response budget.
- MCP cancellation reaches active Portal fetches and retry backoff.
- Retry counts and concurrent scans are finite, use jitter, and share one wall-clock retry budget.
- Admission bounds active and queued Portal work, releases capacity before backoff, and fails overload with retry guidance.
- Sparse searches and result accumulation use explicit bounds and disclose incomplete coverage.
- Shared cache cancellation is isolated between callers.
- Cursor data is signed and invalid cursors fail safely.
- User-facing errors redact query strings, authorization-like fields, and full request bodies.
- MCP discovery comes from one registry; there is no duplicate HTTP tool catalog or bespoke session router.
- The package, the registry entry, and every client manifest share the same release version.
