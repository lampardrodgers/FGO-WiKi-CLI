# FGO Agent

FGO Agent is a local full-data knowledge layer for Fate/Grand Order. It provides:

- a CLI named `fgo`
- a Codex-backed natural-language runner named `fgo-agent`
- an MCP server named `fgo-mcp`
- a SQLite cache/index shared by both
- structured queries over Atlas Academy and Mooncell data

The design keeps factual lookup deterministic. `fgo ask` is a fast structured parser/query path, while `fgo-agent` delegates natural-language reasoning to Codex and requires Codex to verify facts with the local database before answering.

## Requirements

- Node.js 24+
- pnpm

This project uses Node's built-in `node:sqlite`, so it does not require native SQLite npm packages.

## Install

```bash
pnpm install
pnpm build
```

## Sync Data

```bash
fgo sync --regions CN,JP
```

By default, the data directory is `./.fgo-agent`. You can override it:

```bash
FGO_AGENT_DATA_DIR=/path/to/fgo-data fgo sync --regions CN,JP
```

The sync stores raw JSON cache files and a SQLite database. It indexes resource URLs but does not download media files.

## CLI Examples

```bash
fgo ask "中立善并且狂阶的，蓝卡宝具的带有神性特攻的从者" --region CN
fgo ask "国服接下来预计有哪些卡池 up？" --region CN
fgo search "无敌贯通" --region CN
fgo get servant 2 --region CN
fgo query --type servant --trait 秩序善 --region CN
fgo query --effect 无敌贯通 --region CN --limit 20
fgo banners --region CN --upcoming --limit 10
fgo quests --bond --limit 5 --region CN
fgo doctor --region CN
fgo version
fgo resources servant 2 --region CN
fgo raw --type servant --id 100100 --path skills
fgo types --region CN
fgo status
```

`CN` future banners come from Mooncell future-view data and must be treated as non-official predictions.
`fgo doctor` checks database health, quest-index audit metadata, and golden samples such as the CN Ordeal Call "月光矿区" bond value so stale or incomplete indexes fail visibly.

For direct Codex-style use from a terminal, run:

```bash
fgo-agent "中立善并且狂阶的，蓝卡宝具的带有神性特攻的从者"
fgo-agent --model gpt-5.5 --fast "国服接下来预计有哪些卡池？"
fgo-agent --mini "国服接下来预计有哪些卡池？"
fgo-agent --local "中立善，术阶女性从者"
fgo-agent --quiet --model gpt-5.5 --fast "国服接下来预计有哪些卡池？"
fgo-agent --model gpt-5.4-mini --reasoning low "中立善，术阶女性从者"
```

`fgo-agent` starts `codex exec`, asks Codex to interpret the question, and then makes Codex call `fgo_ask` or `fgo` CLI commands for facts. Use `fgo ask` when you want raw structured JSON; use `fgo-agent --local` when you want a fast plain-text answer from the structured query layer; use plain `fgo-agent` when you want Codex to do extra interpretation and answer shaping. By default it inherits your Codex config, shows Codex progress in the terminal, ignores stdin, and runs as an ephemeral one-shot session so separate commands do not share chat context. Add `--quiet` or `--silent` when you only want the final answer. `--persist-session` allows Codex to save a resumable run if you explicitly want that. `--fast` enables Codex native `service_tier="fast"` on models that support it, such as `gpt-5.5` and `gpt-5.4`; `--mini` is a separate lightweight model preset. `--model`, `--reasoning`, `--service-tier`, `--profile`, `--lean`, and `--show-config` are available for manual control.

## MCP Usage

Build the project, then point Codex, Claude Code, or another MCP client at:

```bash
node --no-warnings=ExperimentalWarning /absolute/path/to/fgowiki/dist/src/mcp-server.js
```

Useful environment variable:

```bash
FGO_AGENT_DATA_DIR=/absolute/path/to/.fgo-agent
```

Exposed tools:

- `fgo_version`
- `fgo_doctor`
- `fgo_ask`
- `fgo_search`
- `fgo_get_entity`
- `fgo_query_entities`
- `fgo_query_json`
- `fgo_list_entity_types`
- `fgo_list_servants_by_trait`
- `fgo_list_servants_by_effect`
- `fgo_upcoming_banners`
- `fgo_get_related`
- `fgo_get_resource_links`
- `fgo_source_status`

## Data Coverage

Atlas exports are ingested when available for each region:

- servants, CEs, command codes, mystic codes
- items/materials, events, wars, master missions
- illustrators, voice actors, BGM
- basic index datasets and asset storage
- trait and enum mappings

Mooncell is used for Chinese supplement data, especially CN future-view banners.

The generic entity index stores the original raw JSON, so data without a specialized parser remains available through `search`, `get`, and `raw`.

## Tests

```bash
pnpm test
```
