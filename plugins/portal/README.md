# SQD Plugin

SQD lets Codex, ChatGPT, Claude, and Grok explore live and historical blockchain data. It can answer questions about wallets, transactions, token transfers, smart contracts, network activity, and Hyperliquid trades.

The plugin uses the public SQD endpoint at `https://portal.sqd.dev/mcp`. No account or login is required.

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

- Show the latest Hyperliquid BTC trades.
- How many transactions were on Base in the past two hours?
- Show the largest USDC transfers on Ethereum in the past hour.

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
