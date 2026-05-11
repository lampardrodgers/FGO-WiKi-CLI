# Changelog

## V0.1.1 - 2026-05-11

- Improved `fgo sync` resilience so Atlas and Mooncell failures are recorded in the sync summary instead of aborting the whole run.
- Added incremental sync support using upstream ETag and Last-Modified metadata, with unchanged exports skipped when possible.
- Added `fgo sync --force` to re-download and rebuild indexes and `fgo sync --json` to print the full structured sync result.
- Added a readable default sync summary with data-source status, failure details, and per-region data counts.
- Added tests covering unchanged Atlas war exports, quest-index refresh, preserved source metadata after failures, and Mooncell timeout handling.

## V0.1.0 - 2026-05-09

- Initial release of the FGO Agent CLI and MCP server.
- Added local Atlas Academy and Mooncell data sync, SQLite cache/index storage, and structured entity lookup.
- Added `fgo` commands for natural-language asks, search, get, query, banners, quests, doctor checks, resources, raw JSON access, type listing, and source status.
- Added `fgo-agent` Codex runner presets for verified natural-language answers.
- Added MCP tools for FGO fact lookup, servant trait/effect filtering, upcoming banner lookup, related data, raw JSON paths, and resource URLs.
