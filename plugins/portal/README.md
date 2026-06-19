# SQD Portal MCP Codex Plugin

This directory contains the Codex and Claude Code plugin wrappers for the hosted SQD Portal MCP endpoint.
Installing `portal@sqd` adds the hosted MCP server plus bundled Portal and Pipes SDK skills.

The first distribution target is the repo-local marketplace in `.agents/plugins/marketplace.json`.
The marketplace entry points at this plugin with the stable source path `./plugins/portal`,
so the repository root is the marketplace root.

## Presentation

The plugin uses official SQD brand assets from `https://sqd.dev/brand/`:

- `assets/sqd-logo.svg` is the black-background SQD symbol used for light-mode plugin surfaces.
- `assets/sqd-logo-dark.svg` is the white-background SQD symbol used for dark-mode plugin surfaces.
- `assets/sqd-composer-icon.svg` keeps the black SQD symbol proportions but rounds the square for
  small prompt and composer previews.
- `skills/*/assets/sqd-composer-icon.svg` pins skill prompt-card icons to that same black
  composer symbol so previews do not fall back to alternate logo variants.

The default logo matches the GitHub-style SQD profile picture. Keep the original colors and
proportions intact across plugin detail, MCP rows, and compact prompt-card surfaces.

## Codex Install From This Repo

Register the repo-local marketplace once:

```bash
codex plugin marketplace add .
```

Then install the plugin from the marketplace name in `.agents/plugins/marketplace.json`:

```bash
codex plugin add portal@sqd
```

Open a new Codex thread after installing so Codex picks up the plugin MCP server.

## Claude Code Install From This Repo

Register the Claude Code marketplace once:

```bash
claude plugin marketplace add ./
```

Then install the plugin from the marketplace name in `.claude-plugin/marketplace.json`:

```bash
claude plugin install portal@sqd
```

Open a new Claude Code session after installing so the plugin MCP server is loaded.

## First-use Prompts

The plugin exposes these starter prompts:

- Show the last 200 BTC perp fills on Hyperliquid with price, size, side, and raw rows only.
- Chart Base transaction throughput over the last 2 hours in 15-minute buckets.
- Trace Base USDC flows from the past hour with amounts, counterparties, and tx hashes.

Expected answer shape:

- MCP answers return a compact `answer`, `display`, `next_steps`, `investigation`, and `_llm.execution_guidance` envelope.
- Raw/export requests should skip setup narration and reference-file reading. Query directly, return rows or files first, and only then add one short note if MCP pagination/caps require Portal Stream API or curl.
- Durable workflows should point to the bundled Portal and Pipes SDK skills and preserve the MCP or Portal query as the validation baseline.

## Bundled Skills

- `skills/portal` — non-obvious Portal MCP vs Portal exports vs Pipes SDK routing, entity resolution, dataset naming, and raw export fallback. Obvious raw-row/export prompts should bypass the skill and call SQD tools or Portal directly.
- `skills/pipes` — durable Pipes SDK data pipelines, troubleshooting, deployment, and Portal baseline validation.

## Release Gate

Run the plugin release gate before publishing plugin changes:

```bash
npm run test:plugin
npm run test:claude-plugin
npm run test:plugin-presentation
npm run test:hosted-release
```

`test:plugin-presentation` validates product copy, starter prompts, skill cards, and icon parity.
`test:plugin` and `test:claude-plugin` validate manifests, marketplace entries, bundled skills,
asset paths, hosted MCP compatibility, and real starter-prompt output UX. `test:hosted-release` is the release-day gate that
requires the hosted MCP server and `sqd://tools` to report the expected release version.

## Local Iteration

The public plugin manifest should keep the release version, for example `0.8.0`, without a Codex
cachebuster suffix.

From the repository root:

```bash
codex plugin marketplace add .
codex plugin add portal@sqd
```

Start a new Codex thread after reinstalling. During local-only iteration, a temporary cachebuster
suffix can be useful to force reinstall behavior, but remove it before publishing.

## Current MCP Endpoint

The default plugin MCP server is the hosted HTTP endpoint:

```json
{
  "type": "http",
  "url": "https://portal.sqd.dev/mcp"
}
```

The checked-in MCP server key is `SQD` so Codex shows the server as `SQD` in plugin details.

The managed hosted deployment may expose only MCP discovery. In that case, validate it with
MCP `initialize`, `tools/list`, `sqd://tools`, and `sqd://execution-guidance`. Self-hosted HTTP mode
also exposes public `GET /health`, `GET /tools`, and `GET /tools.json`.

Do not add tenant credentials, bearer tokens, local checkout paths, or personal marketplace paths to
the plugin manifest.

## Local And Offline Fallback

The default plugin should stay hosted. For local Codex development, use a checkout-local stdio
launcher instead of npm, Docker, or vendored build output.

Recommended local fallback:

```bash
npm install
npm run build
node dist/index.js
```

Use that build through a local-only MCP config override such as:

```json
{
  "mcpServers": {
    "SQD Local": {
      "cwd": "/absolute/path/to/portal-mcp-server",
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

Do not commit that local override to this plugin. The checked-in plugin remains hosted and portable.

Do not document a package-runner fallback until the package is actually published to npm. The
package was not available in the public npm registry during the v0.8.0 plugin work.

Docker is useful for self-hosted HTTP mode, not as the first Codex stdio fallback. The public
`subsquid/portal-mcp-server:0.7.9` image was linux/amd64-only during the v0.8.0 plugin work, and
`subsquid/portal-mcp-server:0.8.0` was not published yet. Add a multi-arch image before promoting
Docker as the local plugin path for Apple Silicon users.

Stdio safety rule: stdout is the MCP transport. Keep runtime logs on stderr, and do not add
`console.log` or other stdout writes to the stdio entrypoint or helpers used by `dist/index.js`.
