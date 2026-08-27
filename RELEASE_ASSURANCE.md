# v0.8.0 MCP Release Assurance

This document defines the bounded meaning of “100% hardened and measured” for v0.8.0. It means every applicable cell in the declared release matrix passes on the exact release commit. It does not mean upstream data services or networks can never fail.

## Declared hardening matrix

| Release property | Required coverage | Automated gate |
|---|---:|---|
| Registry and schema discovery | 28/28 tools | `test:protocol`, `test:tools`, `test:lean` |
| Representative live success | 28/28 tools | `test:tools` |
| Shared response contract, size, and latency budgets | 28/28 tools, cold and warm | `test:quality` |
| Tool-selection routing | 70/70 declared prompt cases | `test:routing` |
| Controlled timeout and cancellation paths | Every shared Portal fetch mode | `test:fetch-reliability` |
| Terminal metric reconciliation | Exactly one of five outcomes per invocation | `test:fetch-reliability` |
| Modern and retained legacy MCP paths | stdio and Streamable HTTP | `test:protocol`, `test:http-runtime` |
| Invalid and unsupported requests | Every declared negative fixture | `test:negative` |
| VM-specific regression coverage | EVM, Solana, Bitcoin, Substrate, Hyperliquid | `test:tools`, `test:evm-investigator`, `test:substrate`, `test:reliability-live` |
| Distribution packages | Codex, Claude Code, Grok Build | `test:plugin`, `test:claude-plugin`, `test:grok-plugin` |
| Published package boundary | Allowlisted runtime and public files only | `test:package` |
| Dependency findings | No known npm audit finding | `test:package` |

`npm run test:release` runs the complete matrix. Adding a tool without adding it to the registry-derived manifests fails the release gate.

## Terminal outcome contract

Every tool invocation increments `mcp_tool_calls_total` exactly once with one terminal status:

- `success`: complete, usable result.
- `partial`: usable result that explicitly reports incomplete coverage or an unavailable section.
- `tool_error`: MCP completed the invocation with `isError: true`.
- `request_error`: the handler threw before producing an MCP result.
- `cancelled`: the client cancelled the invocation or its propagated request.

Only `tool_error` and `request_error` increment `mcp_tool_errors_total`. Partial results and cancellations remain independently measurable instead of inflating the server-error rate.

## Metric coverage and privacy

All 28 tools pass through one instrumented registration surface. This guarantees the common per-tool series without copying metric code into individual tools:

| Metric | Purpose | Bounded labels |
|---|---|---|
| `mcp_tool_calls_total` | Calls and terminal outcomes | tool, status, transport, server version |
| `mcp_tool_call_duration_seconds` | End-to-end tool latency | tool, transport |
| `mcp_tool_calls_active` | In-flight calls | tool, transport |
| `mcp_tool_errors_total` | Tool and request error classes | tool, transport, error type |
| `mcp_tool_response_size_bytes` | Serialized response size | tool, transport |
| `mcp_tool_intent_calls_total` | Product intent usage | tool, declared intent, VM |
| `mcp_portal_api_requests_total` | Portal request outcomes | method, HTTP status |
| `mcp_dataset_queries_total` | Canonical dataset usage | dataset, VM |
| `mcp_client_requests_total` | Declared HTTP client usage | transport, client name, client version |

Metric labels never contain wallet addresses, transaction hashes, free-form prompts, authorization values, request bodies, or raw error messages. Optional structured event export sanitizes errors; free-form user-query capture is disabled unless deliberately enabled.

The Grafana dashboard is checked against emitted metric names during `test:http-runtime`, so stale dashboard queries fail CI. The metrics endpoint is disabled unless deliberately configured and is separate from v0.8.0’s public, credential-free MCP product surface.

## Reliability invariants

- Full-response deadlines cover headers and bodies for JSON and NDJSON requests.
- MCP cancellation reaches active Portal fetches and retry backoff.
- Retry counts and concurrent scans are finite.
- Sparse searches and result accumulation use explicit bounds and disclose incomplete coverage.
- Shared cache cancellation is isolated between callers.
- Cursor data is signed and invalid cursors fail safely.
- User-facing errors redact query strings, authorization-like fields, and full request bodies.
- MCP discovery comes from one registry; there is no duplicate HTTP tool catalog or bespoke session router.
