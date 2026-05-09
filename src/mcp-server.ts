#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { normalizeRegion } from "./utils.js";
import { VERSION } from "./version.js";
import { installSqliteWarningFilter } from "./warnings.js";

installSqliteWarningFilter();
const regionSchema = z.enum(["CN", "JP", "NA", "KR", "TW"]).optional();
const { FgoService } = await import("./service.js");
const service = new FgoService(process.env.FGO_AGENT_DATA_DIR);

const server = new McpServer({
  name: "fgo-agent",
  version: VERSION,
});

server.tool(
  "fgo_version",
  "Show the FGO agent version and database path. Useful for detecting stale long-running MCP processes.",
  {},
  async () => jsonContent(service.version()),
);

server.tool(
  "fgo_doctor",
  "Run health checks and golden-sample checks against the local FGO database.",
  {
    region: regionSchema,
  },
  async (args) => jsonContent(service.doctor(normalizeRegion(args.region, "CN"))),
);

server.tool(
  "fgo_ask",
  "Ask a natural-language FGO question. This parses Chinese terms, runs structured lookup, and returns a readable answer plus results.",
  {
    question: z.string(),
    region: regionSchema,
    limit: z.number().int().positive().max(200).optional(),
  },
  async (args) => jsonContent(service.ask(args.question, {
    region: normalizeRegion(args.region, "CN"),
    limit: args.limit,
  })),
);

server.tool(
  "fgo_search",
  "Search all indexed FGO entities by name, alias, text, or raw JSON strings.",
  {
    query: z.string(),
    region: regionSchema,
    entityType: z.string().optional(),
    limit: z.number().int().positive().max(200).optional(),
  },
  async (args) => jsonContent(service.search(args.query, {
    region: args.region,
    entityType: args.entityType,
    limit: args.limit,
  })),
);

server.tool(
  "fgo_get_entity",
  "Get one FGO entity by type and id, collectionNo, exact name, or alias.",
  {
    region: regionSchema,
    entityType: z.string(),
    idOrName: z.string(),
    includeRaw: z.boolean().optional(),
  },
  async (args) => {
    const entity = service.getEntity(normalizeRegion(args.region, "CN"), args.entityType, args.idOrName);
    return jsonContent(args.includeRaw ? entity ?? null : entity?.result ?? null);
  },
);

server.tool(
  "fgo_query_entities",
  "Query entities by common structured filters. Use specialized tools for servant trait/effect queries.",
  {
    region: regionSchema,
    entityType: z.string().optional(),
    className: z.string().optional(),
    rarity: z.number().int().optional(),
    limit: z.number().int().positive().max(500).optional(),
  },
  async (args) => jsonContent(service.queryEntities({
    region: args.region,
    entityType: args.entityType,
    className: args.className,
    rarity: args.rarity,
    limit: args.limit,
  })),
);

server.tool(
  "fgo_query_json",
  "Read raw JSON from an entity and optionally return a dot path such as skills[0].functions.",
  {
    region: regionSchema,
    entityType: z.string(),
    id: z.string(),
    path: z.string().optional(),
  },
  async (args) => jsonContent(service.queryJson({
    region: args.region,
    entityType: args.entityType,
    id: args.id,
    path: args.path,
  }) ?? null),
);

server.tool(
  "fgo_list_entity_types",
  "List indexed FGO entity types and counts.",
  {
    region: regionSchema,
  },
  async (args) => jsonContent(service.listEntityTypes(args.region)),
);

server.tool(
  "fgo_list_servants_by_trait",
  "List servants by trait/alignment/class aliases, e.g. 秩序善, 善, attribute:sky, class:saber.",
  {
    region: regionSchema,
    trait: z.union([z.string(), z.array(z.string())]),
    limit: z.number().int().positive().max(500).optional(),
  },
  async (args) => jsonContent(service.listServantsByTrait(normalizeRegion(args.region, "CN"), args.trait, args.limit)),
);

server.tool(
  "fgo_list_servants_by_effect",
  "List servants whose skills, passives, or noble phantasms contain an effect such as 无敌贯通 or NP充能.",
  {
    region: regionSchema,
    effect: z.union([z.string(), z.array(z.string())]),
    limit: z.number().int().positive().max(500).optional(),
  },
  async (args) => jsonContent(service.listServantsByEffect(normalizeRegion(args.region, "CN"), args.effect, args.limit)),
);

server.tool(
  "fgo_upcoming_banners",
  "List upcoming banners. CN future-view results are Mooncell non-official predictions.",
  {
    region: regionSchema,
    limit: z.number().int().positive().max(100).optional(),
  },
  async (args) => jsonContent(service.upcomingBanners(normalizeRegion(args.region, "CN"), args.limit)),
);

server.tool(
  "fgo_get_related",
  "Return indexed relations for an entity, such as servant buffs or event wars.",
  {
    region: regionSchema,
    ownerType: z.string(),
    ownerId: z.string(),
    relation: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
  },
  async (args) => jsonContent(service.related(
    normalizeRegion(args.region, "CN"),
    args.ownerType,
    args.ownerId,
    args.relation,
    args.limit,
  )),
);

server.tool(
  "fgo_get_resource_links",
  "Return indexed resource URLs for an entity; media files are not mirrored locally.",
  {
    region: regionSchema,
    ownerType: z.string(),
    ownerId: z.string(),
    limit: z.number().int().positive().max(1000).optional(),
  },
  async (args) => jsonContent(service.resources(
    normalizeRegion(args.region, "CN"),
    args.ownerType,
    args.ownerId,
    args.limit,
  )),
);

server.tool(
  "fgo_source_status",
  "Show sync source status, fetch timestamps, skipped endpoints, and failures.",
  {
    limit: z.number().int().positive().max(500).optional(),
  },
  async (args) => jsonContent(service.sourceStatus(args.limit)),
);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => {
  service.close();
  process.exit(0);
});

function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
