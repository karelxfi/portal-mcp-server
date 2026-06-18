# SQD Portal MCP Codex Plugin

This directory contains the Codex plugin wrapper for the hosted SQD Portal MCP endpoint.

The first distribution target is the repo-local marketplace in `.agents/plugins/marketplace.json`.
The marketplace entry points at this plugin with the stable source path `./plugins/sqd-portal-mcp`,
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

## Install From This Repo

Register the repo-local marketplace once:

```bash
codex plugin marketplace add .
```

Then install the plugin from the marketplace name in `.agents/plugins/marketplace.json`:

```bash
codex plugin add sqd-portal-mcp@portal-mcp-server
```

Open a new Codex thread after installing so Codex picks up the plugin MCP server.

## First-use Prompts

The plugin exposes these starter prompts:

- Show me the last 200 BTC perp fills on Hyperliquid.
- How many transactions landed on Base in the past 2h?
- Who sent the most USDC on Base in the past hour?

## Release Gate

Run the plugin release gate before publishing plugin changes:

```bash
npm run test:plugin
```

This validates the plugin manifest, marketplace entry, optional asset paths, and a small hosted MCP
smoke check.

## Local Iteration

When changing the plugin during development, use the plugin-creator helper scripts instead of
editing marketplace or installed-plugin state by hand.

From the repository root:

```bash
PLUGIN_CREATOR=/path/to/plugin-creator

python3 "$PLUGIN_CREATOR/scripts/update_plugin_cachebuster.py" \
  plugins/sqd-portal-mcp

python3 "$PLUGIN_CREATOR/scripts/read_marketplace_name.py" \
  --marketplace-path .agents/plugins/marketplace.json

codex plugin add sqd-portal-mcp@portal-mcp-server
```

Use the marketplace name printed by `read_marketplace_name.py` if it ever differs from
`portal-mcp-server`. Start a new Codex thread after reinstalling.

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
`subsquid/portal-mcp-server:0.7.9` image was linux/amd64-only during the v0.8.0 plugin work, and
`subsquid/portal-mcp-server:0.8.0` was not published yet. Add a multi-arch image before promoting
Docker as the local plugin path for Apple Silicon users.

Stdio safety rule: stdout is the MCP transport. Keep runtime logs on stderr, and do not add
`console.log` or other stdout writes to the stdio entrypoint or helpers used by `dist/index.js`.
