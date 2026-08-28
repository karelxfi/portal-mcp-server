# SQD Plugin

Query blockchain data across 140+ networks with SQD Portal, including Ethereum, Base, Solana, Polkadot, Bitcoin, Tron, and Hyperliquid. The SQD plugin also includes Pipes SDK and Squid SDK skills for building, migrating, troubleshooting, and improving blockchain data projects.

The plugin uses the public SQD endpoint at `https://portal.sqd.dev/mcp`. No account or login is required.

The packaged server runtime uses stateless HTTP and negotiates MCP 2026-07-28, matching the current Claude rollout. Set `REQUIRE_MCP_2026_LIVE=1` when running the plugin checks after deployment to verify the public endpoint.

It also includes the four official SQD agent skills for Portal, Pipes SDK, Portal migration, and indexer performance. The bundled snapshot comes from `subsquid-labs/skills` at commit `06936ddfa9ae423638e187d8e9ac5d1f831095a8`; see `skills/SOURCE.md`.

## Name and logo

- The visible name is `SQD` in every client and marketplace.
- The internal package ID remains `portal` so existing installs keep working.
- `assets/sqd-logo.svg` is the white SQD symbol on a black square. Use it in both light and dark themes.
- `assets/sqd-composer-icon.svg` is the same black square with rounded corners for compact views.

## Codex

Register this repository as a local marketplace, then install the plugin:

```bash
codex plugin marketplace add .
codex plugin add portal@sqd
```

Start a new Codex task after installing it.

## Claude Code

```bash
claude plugin marketplace add ./
claude plugin install portal@sqd
```

Start a new Claude Code session after installing it.

## Grok Build

Grok Build accepts the included Claude-compatible package:

```bash
grok plugin install --trust ./plugins/portal
```

For Grok chat, add a Custom connector at `grok.com/connectors` and enter `https://portal.sqd.dev/mcp` with no authentication.

## Gemini CLI

Install SQD from its public GitHub release:

```bash
gemini extensions install https://github.com/subsquid-labs/portal-mcp-server
```

The release archive contains this manifest, the public SQD MCP connection, and the same four skills. No API key or extension setting is required.

## Cursor

Open **Customize** in Cursor, search for `SQD`, and install the plugin for your user or project. Until the public listing is approved, add this repository as a marketplace or link `plugins/portal` as a local plugin.

Cursor loads the public SQD MCP connection and the same four skills. No API key or plugin variable is required.

## Starter prompts

- Show me the last 200 BTC perp fills on Hyperliquid.
- How many transactions landed on Base in the past 2h?
- Show me the latest 20 USDC transfers on Base from the past hour.

## Checks

```bash
npm run test:plugin
npm run test:claude-plugin
npm run test:grok-plugin
npm run test:gemini-extension
npm run test:cursor-plugin
```

The checks validate the name, black logo, listing copy, marketplace files, hosted endpoint, Gemini archive, Cursor package, and Grok compatibility.

## Public directory submission

See [DIRECTORY_SUBMISSION.md](./DIRECTORY_SUBMISSION.md) for the exact OpenAI, Claude, xAI, Gemini, and Cursor publication routes, listing copy, review tests, and remaining owner actions.

Do not commit credentials, personal paths, or private endpoints to this package.
