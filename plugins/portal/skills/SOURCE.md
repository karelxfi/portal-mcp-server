# Official SQD skills snapshot

These skills are bundled from `subsquid-labs/skills` so Codex, Claude, and Grok receive the same maintained guidance alongside the SQD tools.

- Repository: `https://github.com/subsquid-labs/skills`
- Commit: `66aebe851af0258bf9d38c0bc43fcbb33ae7e47d`
- Synced: `2026-09-01`
- Packaging normalization: trailing spaces are removed from the generated report wrapper. The Portal skill is bundled without content changes.

Bundled skills:

- `portal`
- `pipes-sdk`
- `migrate-to-portal` (upstream path: `squid-sdk/migrate-to-portal`)
- `squid-perf` (upstream path: `squid-sdk/squid-perf`)

The two Squid SDK skills are flattened in this plugin so Codex, Claude, Grok,
Gemini, and Cursor can discover all four skills from one `skills/` directory.
