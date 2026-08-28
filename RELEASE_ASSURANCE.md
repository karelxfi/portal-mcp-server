# v0.8.2 MCP Release Assurance

This document defines the bounded meaning of “100% hardened and measured” for v0.8.2. It means every applicable cell in the declared release matrix passes on the exact release commit. It does not mean upstream data services or networks can never fail.

## Declared hardening matrix

| Release property | Required coverage | Automated gate |
|---|---:|---|
| Registry and schema discovery | 28/28 tools | `test:protocol`, `test:tools`, `test:lean` |
| Representative live success | 28/28 tools | `test:tools` |
| Shared response contract, size, and latency budgets | 28/28 tools, cold and warm | `test:quality` |
| Tool-selection routing | 70/70 declared prompt cases | `test:routing` |
| Controlled timeout and cancellation paths | Every shared Portal fetch mode | `test:fetch-reliability` |
| Malformed and prematurely ended response bodies | JSON and NDJSON paths | `test:fetch-reliability` |
| Lossless response-size boundary | Oversized output fails with structured recovery guidance; no rows are silently removed | `test:fetch-reliability`, `test:quality` |
| Exact continuation inside dense blocks | No repeated or skipped rows across same-block pages | `test:pagination`, `test:tools` |
| Capacity and retry behavior | Bounded active work, queue, wait, cancellation, overload, and jitter | `test:fetch-reliability`, `test:http-runtime` |
| Terminal metric reconciliation | Exactly one of five outcomes per invocation | `test:fetch-reliability` |
| Result-state and failure attribution | Data, empty, partial, error, cancelled; bounded origin and code | `test:fetch-reliability`, `test:http-runtime` |
| Modern and retained legacy MCP paths | stdio and Streamable HTTP | `test:protocol`, `test:http-runtime` |
| Invalid and unsupported requests | Every declared negative fixture | `test:negative` |
| VM-specific regression coverage | EVM, Solana, Bitcoin, Substrate, Hyperliquid | `test:tools`, `test:evm-investigator`, `test:substrate`, `test:reliability-live` |
| Distribution packages | Codex, Claude Code, Grok Build, Gemini CLI, Cursor | `test:plugin`, `test:claude-plugin`, `test:grok-plugin`, `test:gemini-extension`, `test:cursor-plugin` |
| Declared-client protocol journeys | Claude, Codex, Grok, Gemini, Cursor | `test:client-journeys` |
| Open-loop performance profiles | Cold c1; warm c1, c4, c8; c8 burst | `benchmark:v082`, `benchmark:compare` |
| Sustained mixed load | 60 minutes with bursts, latency recovery, error rate, and child-process RSS | `soak:v082` |
| Published package boundary | Allowlisted runtime and public files only | `test:package` |
| Dependency findings | No known npm audit finding | `test:package` |

`npm run test:release` runs the deterministic and live functional matrix. Adding a tool without adding it to the registry-derived manifests fails the release gate. A release candidate also requires clean-commit benchmark comparison, the 60-minute soak, and installed-host evidence. Those artifacts are intentionally separate because they take longer and must identify the exact commit under test.

## Terminal outcome contract

Every tool invocation increments `mcp_tool_calls_total` exactly once with one terminal status:

- `success`: complete, usable result.
- `partial`: usable result that explicitly reports incomplete coverage or an unavailable section.
- `tool_error`: MCP completed the invocation with `isError: true`, including expected validation and bounded upstream failures.
- `request_error`: the invocation failed before a structured MCP tool result could be produced.
- `cancelled`: the client cancelled the invocation or its propagated request.

Only `tool_error` and `request_error` increment `mcp_tool_errors_total`. Partial results and cancellations remain independently measurable instead of inflating the server-error rate.

## Metric coverage and privacy

All 28 tools pass through one instrumented registration surface. This guarantees the common per-tool series without copying metric code into individual tools:

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
| `mcp_tool_client_calls_total` | Protocol-declared client usage | transport, bounded client family, major version |

Metric labels never contain wallet addresses, transaction hashes, free-form prompts, authorization values, request bodies, raw error messages, or arbitrary client headers. Structured event export records bounded client identity and failure attribution but never captures forwarded user questions.

The Grafana dashboard is checked against emitted metric names during `test:http-runtime`, so stale dashboard queries fail CI. The metrics endpoint is disabled unless deliberately configured and is separate from v0.8.2’s public, credential-free MCP product surface.

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
- Package, registry, Codex, Claude, Grok-compatible, Gemini, and Cursor manifests share the same release version.

## Release-candidate evidence

The exact release commit must have all of these artifacts:

1. `npm run test:release` passes.
2. A baseline and candidate artifact from `npm run benchmark:v082`, each created from a clean commit with every registered tool and at least 50 samples per warm profile.
3. `npm run benchmark:compare -- <baseline.json> <candidate.json>` reports no statistically supported regression above 10 percent.
4. `SOAK_RELEASE=1 npm run soak:v082` completes the default 60-minute mixed-tool run with at most 1 percent tool errors and records latency and child-process RSS.
5. Installed Claude, Codex, Grok, Gemini, and Cursor hosts each complete the declared user journeys. `test:client-journeys` verifies protocol identity and behavior, but does not replace installed-host proof.
