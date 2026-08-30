# Official SQD skills snapshot

These skills are bundled from `subsquid-labs/skills` so Codex, Claude, and Grok receive the same maintained guidance alongside the SQD tools.

- Repository: `https://github.com/subsquid-labs/skills`
- Commit: `6eed8d82d0ceac35855742d6e4b5cc150bc5d402`
- Synced: `2026-08-30`
- Packaging normalization: trailing spaces were removed from the generated report wrapper.

Bundled skills:

- `portal`
- `pipes-sdk`
- `migrate-to-portal` (upstream path: `squid-sdk/migrate-to-portal`)
- `squid-perf` (upstream path: `squid-sdk/squid-perf`)

The two Squid SDK skills are flattened in this plugin so Codex, Claude, Grok,
Gemini, and Cursor can discover all four skills from one `skills/` directory.
