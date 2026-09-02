# SQD Plugin Directory Submission

This is the source packet for SQD's OpenAI, Claude, Grok, Gemini, and Cursor directory listings.

## Release automation

Directory metadata is tied to releases so public catalogs do not depend on manual version updates.

- A `v*` tag runs `.github/workflows/publish-mcp-registry.yml`. It validates the tag and manifests, authenticates to the official MCP Registry with GitHub OIDC, publishes only when the version is missing, and verifies that the new version is latest.
- A published GitHub release runs `.github/workflows/publish-gemini-extension.yml`. It validates and packages the Gemini extension, requires the `gemini-cli-extension` topic, and uploads `sqd.tar.gz` to the matching release.
- `.github/workflows/directory-health.yml` checks the official MCP Registry, Gemini discovery prerequisites and gallery, Glama, Smithery, Awesome MCP Servers, and the Grok marketplace pull request every day. It stores a JSON health artifact and writes a compact Actions summary.
- `npm run test:distribution` keeps `package.json`, `server.json`, and the Claude, Codex, Cursor, and Gemini manifests on one version.

The supported publication routes and update modes live in `distribution/targets.json`. Reusable, directory-specific public copy lives in `distribution/submission-packets.json`. Glama requires one owner claim and then supports repository sync. Smithery is published at `https://smithery.ai/servers/sqd/sqd` under the official `sqd` namespace and supports remote release scans. MCP.so currently offers a paid submission route, so publishing there requires explicit spend approval. PulseMCP ingests servers from the official MCP Registry and does not need a separate submission. APITracker uses an editorial contact route rather than an automatic registry crawl. Perplexity supports SQD as a custom remote connector but does not currently offer a public connector-directory submission route. Do not add credentials or private review details to the tracker.

## Public listing

Name: `SQD`

Developer: `Subsquid Labs`

Category: `Data & Analytics`

Short description:

> Query blockchain data across 130+ networks with SQD Portal.

Long description:

> Query blockchain data across 130+ networks with SQD Portal, including Ethereum, Base, Solana, Polkadot, Bitcoin, Tron, and Hyperliquid. The SQD plugin also includes Pipes SDK and Squid SDK skills for building, migrating, troubleshooting, and improving blockchain data projects.

Starter prompts:

1. Show me the last 200 BTC perp fills on Hyperliquid.
2. How many transactions landed on Base in the past 2h?
3. Show me the latest 20 USDC transfers on Base from the past hour.

Public URLs:

- Website: `https://sqd.dev/portal/`
- Documentation: `https://docs.sqd.dev/en/ai/mcp-server`
- Claude setup guide: `https://docs.sqd.dev/en/ai/claude-connector`
- Claude listing: `https://claude.ai/directory/connectors/sqd`
- Support: `https://sqd.dev/contact/`
- Privacy: `https://sqd.dev/imprint/`
- Terms: `https://cloud.sqd.dev/terms.pdf`
- Public server: `https://portal.sqd.dev/mcp`

Logo: use `https://sqd.dev/brand/Symbol_bl-bg.svg`. It is the canonical white SQD symbol on a black square. The package keeps a local SVG at `assets/sqd-logo.svg`, a 1024 x 1024 OpenAI directory PNG at `assets/sqd-directory-icon.png`, and a 256 x 256 ChatGPT composer PNG at `assets/sqd-chatgpt-composer-icon.png`.

Do not add Robinhood Chain to the published listing until it appears in the live SQD network catalog and a real query passes. Once live, add `Robinhood Chain` to the description, prompt tests, and discovery checks together.

## Claude directory

SQD is already published in the Claude Connectors Directory at `https://claude.ai/directory/connectors/sqd`. The public SQD documentation links to that listing and describes the no-login connection flow.

The hosted connector and the installable Claude Code plugin are complementary:

- The directory listing connects Claude on web, desktop, and mobile to `https://portal.sqd.dev/mcp`.
- The package in this repository gives Claude Code the same hosted MCP server plus the four official SQD skills.

For a new version or listing change, use the connector submission portal in the publishing Claude Team or Enterprise organization's settings. The submitter must be an Owner, Primary Owner, or a member with the Directory permission. Use these values:

- Server URL: `https://portal.sqd.dev/mcp`
- Transport: Streamable HTTP
- Connection model: one URL for every user
- Authentication: none
- Name: `SQD`
- Tagline: `Query blockchain data across 130+ networks`
- Description: `Query blockchain data across 130+ networks with SQD Portal, including Ethereum, Base, Solana, Polkadot, Bitcoin, Tron, and Hyperliquid.`
- Documentation: `https://docs.sqd.dev/en/ai/claude-connector`
- Privacy: `https://sqd.dev/imprint/`
- Support: `https://sqd.dev/contact/`
- Icon: use the canonical black-background SQD logo
- Setup requirement: no account, login, or API key
- Data handling: SQD's own public read-only blockchain data API; no health data or sponsored content

The hosted endpoint serves the full 28-tool default; toolsets (`MCP_TOOLSETS`, `MCP_TOOLS`, `?toolsets=`, `X-MCP-Toolsets`) exist for self-hosted deployments and single connections that want a smaller catalog, and they do not change what the directory listing scans. Before submitting an update, confirm that Claude syncs all 28 tools and the three investigation prompts, every tool has a title and the applicable annotations, and each tool passes an end-to-end call. The current Claude Code tool namespace for an install from this package is `mcp__plugin_portal_SQD__<tool-name>`, for example `mcp__plugin_portal_SQD__portal_get_head`. Treat this as client-generated configuration, not part of the public MCP tool name.

## OpenAI directory

OpenAI uses one Plugins Directory for both ChatGPT and Codex. Submit SQD as a plugin with MCP through the OpenAI Platform plugin submission portal.

Import the repository-root `chatgpt-app-submission.json` file into the submission form. It covers all 28 public tools, their safety labels and justifications, five positive review tests, and three negative review tests.

The 28 tools do not currently declare MCP `outputSchema` values. OpenAI does not require them for submission, and the submission JSON must not invent them. Add real schemas in a future release only together with matching structured tool results.

OpenAI submission values:

1. Organization: the verified OpenAI Platform organization that owns SQD.
2. Developer Identity: `Business - Subsquid Labs GmbH`.
3. Plugin Author: `Subsquid Labs GmbH`.
4. Name: `SQD`.
5. Version: the current production MCP release.
6. Directory icon: `assets/sqd-directory-icon.png`.
7. ChatGPT composer icon: `assets/sqd-chatgpt-composer-icon.png`.
8. Universal MCP server URL: `https://portal.sqd.dev/mcp`.
9. Authentication: none.
10. Domain challenge URL: `https://portal.sqd.dev/.well-known/openai-apps-challenge`.
11. Website: `https://sqd.dev/portal/`.
12. Support: `https://sqd.dev/contact/`.
13. Privacy: `https://sqd.dev/imprint/`.
14. Terms: `https://cloud.sqd.dev/terms.pdf`.
15. Availability: all supported countries.

After scanning, confirm all 28 tools show `readOnlyHint: true`, `destructiveHint: false`, and `openWorldHint: true`. Upload the four skill folders from `plugins/portal/skills`, enter the prompts and tests from this packet, and submit the completed draft for review.

Treat submitted OpenAI metadata as a versioned snapshot. Prepare the MCP App update only after the current review concludes, use screenshots captured from the deployed exact release, and keep the underlying non-UI fallback tests in the review packet.

Suggested initial release notes:

> Initial SQD plugin submission. Query blockchain data across 130+ networks with SQD Portal, including Ethereum, Base, Solana, Polkadot, Bitcoin, Tron, and Hyperliquid. The plugin also includes Pipes SDK and Squid SDK skills for building, migrating, troubleshooting, and improving blockchain data projects.

### Positive review tests

| Prompt | Expected tool | Expected result |
|---|---|---|
| Show me the last 200 BTC perp fills on Hyperliquid. | `portal_hyperliquid_query_fills` | The latest 200 BTC fills with time, direction, price, size, and trader fields. |
| How many transactions landed on Base in the past 2h? | `portal_get_time_series` | Time buckets and a total transaction count for Base over the requested period. |
| Show me the latest 20 USDC transfers on Base from the past hour. | `portal_evm_query_token_transfers` | The latest 20 Base USDC transfers with sender, recipient, amount, time, and transaction hash. |
| Which blockchain networks can SQD query? | `portal_list_networks` | A searchable list of supported networks and their availability. |
| Summarize this wallet's activity on Base over the past day. | `portal_get_wallet_summary` | A wallet summary with incoming and outgoing activity, counterparties, and clear coverage. |

### Negative review tests

| Prompt | Expected behavior | Reason |
|---|---|---|
| Send 1 ETH from this wallet. | Explain that SQD is read-only and cannot sign or send transactions. | The plugin never changes blockchain state. |
| Place a Hyperliquid BTC trade for me. | Explain that SQD can retrieve market data but cannot place or sign trades. | The plugin does not execute market actions. |
| Predict the BTC price tomorrow. | Explain that SQD provides historical and live data, not financial predictions. | A prediction would go beyond the plugin's data tools. |

## Grok Build marketplace

xAI accepts third-party plugins through a pull request to `xai-org/plugin-marketplace`. Use a remote source that points to the public SQD repository and pins the exact merged commit.

Add this entry to `.grok-plugin/marketplace.json` after the SQD source change is merged. Replace the SHA value with the full lowercase commit from the public repository.

```json
{
  "name": "sqd",
  "description": "Query blockchain data across 130+ networks with SQD Portal, including Ethereum, Base, Solana, Polkadot, Bitcoin, Tron, and Hyperliquid. The SQD plugin also includes Pipes SDK and Squid SDK skills for building, migrating, troubleshooting, and improving blockchain data projects.",
  "category": "development",
  "source": {
    "source": "url",
    "url": "https://github.com/subsquid-labs/portal-mcp-server.git",
    "sha": "FULL_MERGED_COMMIT_SHA",
    "path": "plugins/portal"
  },
  "homepage": "https://sqd.dev/portal/",
  "keywords": [
    "sqd",
    "subsquid",
    "sqd blockchain",
    "sqd blockchain data",
    "sqd hyperliquid",
    "sqd tron",
    "sqd portal"
  ],
  "domains": [
    "sqd.dev",
    "portal.sqd.dev",
    "docs.sqd.dev"
  ]
}
```

Then run in the marketplace fork:

```bash
python3 scripts/generate-plugin-index.py
python3 scripts/validate-catalog.py
python3 scripts/generate-plugin-index.py --check
```

Open the pull request using xAI's template and include only the public product, source, license, network endpoint, and validation facts needed for review.

## Grok chat connector catalog

Grok chat already accepts SQD as a Custom connector using `https://portal.sqd.dev/mcp`. xAI does not currently document an open submission form or pull request route for adding a new service to the consumer connector catalog. The public path available today is:

1. Publish SQD in the Grok Build marketplace.
2. Document the Custom connector setup for Grok chat.
3. Use the public marketplace listing and measured adoption when asking xAI to consider SQD for the consumer connector catalog.

## Gemini CLI extension gallery

Gemini CLI installs the generated `sqd.tar.gz` release asset. The archive keeps `gemini-extension.json` at its root and includes the same four official SQD skills from `plugins/portal/skills`.

Publish with these steps:

1. Run `npm run test:gemini-extension`.
2. Run `npm run package:gemini`.
3. Upload `dist/gemini/sqd.tar.gz` as the only custom asset on the matching GitHub release.
4. Add the `gemini-cli-extension` GitHub topic to the public repository.
5. Confirm the manifest version matches the release tag.
6. Install from `https://github.com/subsquid-labs/portal-mcp-server` and confirm the SQD server and all four skills load.

Gemini indexes tagged public repositories with that topic daily. No separate submission form or pull request is required.

The internal extension identifier is `sqd` because Gemini requires lowercase names. The public product name remains `SQD` in the repository, description, documentation, and MCP server name.

## Cursor Marketplace

The repository-root `.cursor-plugin/marketplace.json` points at `plugins/portal`. The Cursor manifest in that folder reuses the existing `skills/`, `.mcp.json`, and black SQD logo without copying them.

Use these listing values:

- Display name: `SQD`
- Plugin identifier: `sqd`
- Repository: `https://github.com/subsquid-labs/portal-mcp-server`
- Website: `https://sqd.dev/portal/`
- Documentation: `https://docs.sqd.dev/en/ai/mcp-server`
- Support: `https://sqd.dev/contact/`
- Logo: `plugins/portal/assets/sqd-logo.svg`
- Authentication: none
- Components: one read-only MCP server and four skills
- Short description: `Query blockchain data across 130+ networks with SQD Portal.`
- Long description: `Query blockchain data across 130+ networks with SQD Portal, including Ethereum, Base, Solana, Polkadot, Bitcoin, Tron, and Hyperliquid. The SQD plugin also includes Pipes SDK and Squid SDK skills for building, migrating, troubleshooting, and improving blockchain data projects.`

Before submitting at `https://cursor.com/marketplace/publish`, run `npm run test:cursor-plugin` and test the plugin locally in Cursor. Cursor reviews every public marketplace submission.
