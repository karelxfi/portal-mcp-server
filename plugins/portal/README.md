# SQD Plugin

SQD lets Codex, ChatGPT, Claude, and Grok find 130+ blockchain networks and explore the live and historical data available for each. It can answer questions about wallets, transactions, token transfers, smart contracts, network activity, and markets across Ethereum, Base, Solana, Bitcoin, Polkadot, Hyperliquid, and many more. Its live catalog also shows current Tron availability.

The plugin uses the public SQD endpoint at `https://portal.sqd.dev/mcp`. No account or login is required.

The packaged server runtime uses stateless HTTP and negotiates MCP 2026-07-28, matching the current Claude rollout. Set `REQUIRE_MCP_2026_LIVE=1` when running the plugin checks after deployment to verify the public endpoint.

It also includes the four official SQD agent skills for Portal, Pipes SDK, Portal migration, and indexer performance. The bundled snapshot comes from `subsquid-labs/skills` at commit `684055c3d6e6c98953309280108600310e8a0be3`; see `skills/SOURCE.md`.

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

## Starter prompts

- Which blockchain networks can SQD query?
- Show the latest Hyperliquid BTC trades.
- Is Tron available in SQD?

## Checks

```bash
npm run test:plugin
npm run test:claude-plugin
npm run test:grok-plugin
```

The checks validate the name, black logo, listing copy, marketplace files, hosted endpoint, and Grok compatibility.

## Public directory submission

See [DIRECTORY_SUBMISSION.md](./DIRECTORY_SUBMISSION.md) for the exact OpenAI and xAI publication routes, listing copy, review tests, and remaining owner actions.

Do not commit credentials, personal paths, or private endpoints to this package.
