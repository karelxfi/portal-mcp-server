# Portal API Versioning and Change Detection

Portal has no version in its URL or headers. Every client talks to the same surface at `https://portal.sqd.dev`.

## Stable Contract

- Endpoint paths and HTTP methods
- Accepted field names in selectors
- The structured error envelope and documented `error.type` values, including credential errors on protected deployments
- Published `error.code` values

The surface grows by addition: new fields, dataset families, and datasets can appear without changing what an existing request means.

## Changing State

- Dataset membership and ordering
- Prose in `error.message`
- Worker assignments from dataset state endpoints

Never parse `error.message` or depend on the order of `GET /datasets`. Treat an unknown error code according to its stable `error.type`.

## Automated Change Detection

Use the generic [Portal OpenAPI specification](https://docs.sqd.dev/openapi.json) for shared endpoints and stable `operationId` values. Its generic query object intentionally leaves family selectors open, so use the family-specific specifications for client generation and selector validation: [EVM](https://docs.sqd.dev/en/ai/evm-openapi), [Solana](https://docs.sqd.dev/en/ai/solana-openapi), [Substrate](https://docs.sqd.dev/en/ai/substrate-openapi), [Bitcoin](https://docs.sqd.dev/en/ai/bitcoin-openapi), [Tron](https://docs.sqd.dev/en/ai/tron-openapi), and [Hyperliquid](https://docs.sqd.dev/en/ai/hyperliquid-openapi).

Watch [Announcements](https://docs.sqd.dev/announcements) for dataset retirements. Treat `unknown_dataset` as fatal for that dataset, and check announced retirements before assuming a catalog entry is actively ingesting.
