#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { normalizeRegion, parseRegions } from "./utils.js";
import { installSqliteWarningFilter } from "./warnings.js";

installSqliteWarningFilter();

interface ParsedArgs {
  command: string;
  positional: string[];
  options: Record<string, string | boolean>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === "help" || args.options.help) {
    printHelp();
    return;
  }

  if (args.command === "version" || args.command === "--version") {
    const { VERSION } = await import("./version.js");
    print({ name: "fgo-agent", version: VERSION });
    return;
  }

  if (args.command === "sync") {
    const { syncAll } = await import("./sync.js");
    const summary = await syncAll({
      regions: parseRegions(stringOpt(args, "regions")),
      dataDir: stringOpt(args, "data-dir"),
      includeBasic: !boolOpt(args, "no-basic"),
      includeNice: !boolOpt(args, "no-nice"),
      includeMooncell: !boolOpt(args, "no-mooncell"),
      includeAssets: !boolOpt(args, "no-assets"),
      verbose: boolOpt(args, "verbose"),
    });
    print(summary);
    return;
  }

  const { FgoService } = await import("./service.js");
  const service = new FgoService(stringOpt(args, "data-dir"));
  try {
    switch (args.command) {
      case "search": {
        const query = args.positional.join(" ").trim();
        if (!query) throw new Error("Missing search query.");
        print(
          service.search(query, {
            region: maybeRegion(args),
            entityType: stringOpt(args, "type"),
            limit: numberOpt(args, "limit", 20),
          }),
        );
        return;
      }
      case "get": {
        const [entityType, idOrName] = args.positional;
        if (!entityType || !idOrName) throw new Error("Usage: fgo get <type> <id-or-name> [--region CN]");
        const entity = service.getEntity(regionOpt(args), entityType, idOrName);
        if (!entity) {
          print({ error: "not_found", entityType, idOrName });
          return;
        }
        print(boolOpt(args, "raw") ? entity : entity.result);
        return;
      }
      case "query": {
        print(
          service.queryEntities({
            region: maybeRegion(args),
            entityType: stringOpt(args, "type"),
            trait: stringOpt(args, "trait"),
            effect: stringOpt(args, "effect"),
            className: stringOpt(args, "class"),
            rarity: numberOpt(args, "rarity"),
            limit: numberOpt(args, "limit", 100),
          }),
        );
        return;
      }
      case "banners": {
        print(service.upcomingBanners(regionOpt(args), numberOpt(args, "limit", 10)));
        return;
      }
      case "quests": {
        if (boolOpt(args, "bond")) {
          print(service.topBondQuests(regionOpt(args), numberOpt(args, "limit", numberOpt(args, "top", 5))));
          return;
        }
        throw new Error("Usage: fgo quests --bond --limit 5 [--region CN]");
      }
      case "resources": {
        const [ownerType, ownerId] = args.positional;
        if (!ownerType || !ownerId) throw new Error("Usage: fgo resources <type> <id-or-name> [--region CN]");
        print(service.resources(regionOpt(args), ownerType, ownerId, numberOpt(args, "limit", 200)));
        return;
      }
      case "raw": {
        const entityType = stringOpt(args, "type") ?? args.positional[0];
        const id = stringOpt(args, "id") ?? args.positional[1];
        if (!entityType || !id) throw new Error("Usage: fgo raw --type servant --id 100100 [--path skills]");
        const result = service.queryJson({
          region: regionOpt(args),
          entityType,
          id,
          path: stringOpt(args, "path"),
        });
        print(result ?? { error: "not_found", entityType, id });
        return;
      }
      case "types": {
        print(service.listEntityTypes(maybeRegion(args)));
        return;
      }
      case "related": {
        const [ownerType, ownerId] = args.positional;
        if (!ownerType || !ownerId) throw new Error("Usage: fgo related <type> <id-or-name> [--relation has_buff]");
        print(
          service.related(
            regionOpt(args),
            ownerType,
            ownerId,
            stringOpt(args, "relation"),
            numberOpt(args, "limit", 200),
          ),
        );
        return;
      }
      case "status": {
        print(service.sourceStatus(numberOpt(args, "limit", 50)));
        return;
      }
      case "doctor": {
        print(service.doctor(regionOpt(args)));
        return;
      }
      case "ask": {
        const question = args.positional.join(" ").trim();
        if (!question) throw new Error("Missing question.");
        print(service.ask(question, { region: regionOpt(args), limit: numberOpt(args, "limit", 20) }));
        return;
      }
      default:
        throw new Error(`Unknown command: ${args.command}`);
    }
  } finally {
    service.close();
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg?.startsWith("--")) {
      if (arg) positional.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey;
    if (!key) continue;
    if (inlineValue != null) {
      options[key] = inlineValue;
      continue;
    }
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { command, positional, options };
}

function stringOpt(args: ParsedArgs, key: string): string | undefined {
  const value = args.options[key];
  return typeof value === "string" ? value : undefined;
}

function boolOpt(args: ParsedArgs, key: string): boolean {
  return args.options[key] === true || args.options[key] === "true";
}

function numberOpt(args: ParsedArgs, key: string): number | undefined;
function numberOpt(args: ParsedArgs, key: string, fallback: number): number;
function numberOpt(args: ParsedArgs, key: string, fallback?: number): number | undefined {
  const value = stringOpt(args, key);
  if (value == null) {
    if (fallback == null) return undefined;
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number for --${key}: ${value}`);
  return parsed;
}

function regionOpt(args: ParsedArgs) {
  return normalizeRegion(stringOpt(args, "region"), "CN");
}

function maybeRegion(args: ParsedArgs) {
  const region = stringOpt(args, "region");
  return region ? normalizeRegion(region) : undefined;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(`FGO Agent CLI

Usage:
  fgo sync --regions CN,JP
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

Options:
  --data-dir <path>  Override data directory. Default: ./.fgo-agent or FGO_AGENT_DATA_DIR.
  --region <code>   CN, JP, NA, KR, TW. Default: CN.
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
