# SQD Portal MCP Codex Plugin

This directory contains the Codex plugin wrapper for the hosted SQD Portal MCP endpoint.
It also contains the Claude Code plugin manifest for the same hosted MCP endpoint.
Grok Build consumes that Claude-compatible package directly, while Grok chat connects to the hosted URL as a custom MCP connector.

The first distribution target is the repo-local marketplace in `.agents/plugins/marketplace.json`.
The marketplace entry points at this plugin with the stable source path `./plugins/portal`,
so the repository root is the marketplace root.

## Presentation

The plugin uses official SQD brand assets from `https://sqd.dev/brand/`:

- `assets/sqd-logo.svg` is the black-background SQD symbol used for light-mode plugin surfaces.
- `assets/sqd-logo-dark.svg` is the white-background SQD symbol used for dark-mode plugin surfaces.
- `assets/sqd-composer-icon.svg` keeps the black SQD symbol but rounds the square for small prompt
  and composer previews.

The default logo matches the GitHub-style SQD profile picture. Keep the original colors and
proportions intact for plugin detail surfaces, and use the trimmed composer icon for compact
preview rows where the app does not apply the same outer corner treatment.

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

## Grok Build Install From This Repo

Grok Build is compatible with Claude Code plugin manifests, so no separate Grok-only manifest is needed:

```bash
grok plugin install --trust ./plugins/portal
```

For Grok chat, create a Custom connector at `grok.com/connectors` and use `https://portal.sqd.dev/mcp` with no authentication.

## First-use Prompts

The plugin exposes these starter prompts:

- Show me the last 200 BTC perp fills on Hyperliquid.
- How many transactions landed on Base in the past 2h?
- Who sent the most USDC on Base in the past hour?

## Release Gate

Run the plugin release gate before publishing plugin changes:

```bash
npm run test:plugin
npm run test:claude-plugin
npm run test:grok-plugin
```

These validate the Codex and Claude Code plugin manifests, marketplace entries, optional asset
paths, and a small hosted MCP smoke check.

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
    "sqd-portal-local": {
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
`subsquid/portal-mcp-server` image is linux/amd64-only for v0.8.0. Add a multi-arch image before
promoting Docker as the local plugin path for Apple Silicon users.

Stdio safety rule: stdout is the MCP transport. Keep runtime logs on stderr, and do not add
`console.log` or other stdout writes to the stdio entrypoint or helpers used by `dist/index.js`.
