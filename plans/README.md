# Portal MCP Release Hardening Notes

This directory records release-hardening passes for Portal MCP.

## Status

| Plan | Title | Status |
|---|---|---|
| 001 | v0.7.9 factual UX release hardening | Done |
| 002 | v0.8.0 plugin and skills release hardening | In progress |

## v0.8.0 Release Checklist

- Bundle refreshed SQD skills into `portal@sqd`.
- Keep package, plugin metadata, Claude marketplace, changelog, and hosted MCP version coherent.
- Validate `portal@sqd` for Codex and Claude Code from repo-local marketplaces.
- Validate the managed hosted endpoint through MCP initialize, `tools/list`, `sqd://tools`, and `sqd://execution-guidance`.
- Document that self-hosted HTTP mode exposes `/health` and `/tools`, while hosted discovery may be MCP-only until public edge routes are configured.
- Keep plugin presentation polished: `SQD Portal` as product name, `portal@sqd` as selector, `SQD` as compact MCP server label, and current black/white SQD logo assets.

## Completed Scope

- Estimated relative time windows are identified as estimated in the response metadata and user-facing notices.
- Bounded contract-activity previews distinguish requested block bounds from analyzed block bounds.
- HTTP MCP POST calls can be protected with `MCP_HTTP_BEARER_TOKEN`, while `/health` and read-only tool discovery stay public.
- Client-facing errors redact sensitive-looking request material and summarize large query bodies.
- Pagination cursors are signed and rejected if unsigned, malformed, for another tool, or edited.
- Solana transaction, Bitcoin transaction, and Hyperliquid fill limits are capped at 200; EVM limit descriptions match the same cap.
- Tool results include MCP `structuredContent` while preserving a compact JSON text fallback.
- Safe pagination continuations expose executable follow-up metadata; descriptive suggestions are clearly non-executable.

## Verification

The completed pass was verified with:

```bash
npm run build
npm run test:timestamps
npm run test:negative
npm run test:tools
npm run test:evm-investigator
npm run test:all
```

`test:all` covers build, smoke, live tool manifest, EVM investigator prompts, routing, Substrate, timestamp, HTTP mode, conversations, realistic prompts, negative paths, quality audit, and package contents.

## Deferred Direction

- Extend schema resources beyond EVM and Solana after structured output is settled.
- Collapse tool registry, tool catalog, manifest specs, and README counts into one source of truth after v0.8.0.
- Treat dependency and workflow pinning as a separate release-hardening pass.

## Plan File

- `plans/001-v079-factual-ux-release-hardening.md`
- `plans/002-v080-plugin-skills-release-hardening.md`
