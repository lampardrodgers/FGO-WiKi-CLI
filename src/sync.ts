import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDataDirs, resolveCacheDir, resolveDbPath } from "./config.js";
import { FgoDatabase } from "./db.js";
import type { EntityRecord, QuestIndexAudit, Region, SyncOptions } from "./types.js";
import {
  collectStrings,
  extractUrls,
  hashText,
  isRecord,
  nowIso,
  stringifyJson,
  toUnixIso,
  uniqueStrings,
} from "./utils.js";

interface AtlasExportConfig {
  entityType: string;
  file: string;
  kind: "basic" | "nice" | "asset" | "static";
  regions?: Region[];
}

type SyncStatus = "ok" | "partial" | "failed" | "skipped";

interface SourceSyncStats {
  total: number;
  fetched: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

interface SyncFailure {
  id: string;
  source: "atlas" | "mooncell";
  kind: string;
  region?: Region;
  url: string;
  error: string;
}

interface SyncDatabaseSummary {
  name: "atlas" | "mooncell" | "quest_index";
  status: SyncStatus;
  message: string;
  stats?: SourceSyncStats;
  regions?: Array<{
    region: Region;
    indexedQuests?: number;
    failedQuestDetails?: number;
    candidateQuests?: number;
  }>;
}

interface SyncCountSummary {
  regions: Array<{
    region: Region;
    totalEntities: number;
    entityTypes: number;
    entities: Record<string, number>;
    otherEntities: number;
    questIndex: number;
    banners: number;
    resources: number;
  }>;
}

const ATLAS_BASE = "https://api.atlasacademy.io";
const MOONCELL_API = "https://fgo.wiki/api.php";

const ATLAS_EXPORTS: AtlasExportConfig[] = [
  { kind: "nice", entityType: "servant", file: "nice_servant.json" },
  { kind: "nice", entityType: "equip", file: "nice_equip.json" },
  { kind: "nice", entityType: "war", file: "nice_war.json" },
  { kind: "nice", entityType: "event", file: "nice_event.json" },
  { kind: "nice", entityType: "command_code", file: "nice_command_code.json" },
  { kind: "nice", entityType: "item", file: "nice_item.json" },
  { kind: "nice", entityType: "mystic_code", file: "nice_mystic_code.json" },
  { kind: "nice", entityType: "master_mission", file: "nice_master_mission.json" },
  { kind: "nice", entityType: "illustrator", file: "nice_illustrator.json" },
  { kind: "nice", entityType: "cv", file: "nice_cv.json" },
  { kind: "nice", entityType: "bgm", file: "nice_bgm.json" },
  { kind: "asset", entityType: "asset_storage", file: "asset_storage.json" },
  { kind: "basic", entityType: "basic_servant", file: "basic_servant.json" },
  { kind: "basic", entityType: "basic_svt", file: "basic_svt.json" },
  { kind: "basic", entityType: "basic_equip", file: "basic_equip.json" },
  { kind: "basic", entityType: "basic_war", file: "basic_war.json" },
  { kind: "basic", entityType: "basic_event", file: "basic_event.json" },
  { kind: "basic", entityType: "basic_command_code", file: "basic_command_code.json" },
  { kind: "basic", entityType: "basic_mystic_code", file: "basic_mystic_code.json" },
  { kind: "static", entityType: "trait", file: "nice_trait.json" },
  { kind: "static", entityType: "enums", file: "nice_enums.json" },
];

export interface SyncSummary {
  status: SyncStatus;
  message: string;
  dbPath: string;
  regions: Region[];
  completedAt?: string;
  fetched: number;
  unchanged: number;
  skipped: number;
  failed: number;
  entities: number;
  banners: number;
  questAudits: QuestIndexAudit[];
  databases: SyncDatabaseSummary[];
  counts?: SyncCountSummary;
  failures: SyncFailure[];
}

export async function syncAll(options: SyncOptions): Promise<SyncSummary> {
  const includeBasic = options.includeBasic ?? true;
  const includeNice = options.includeNice ?? true;
  const includeMooncell = options.includeMooncell ?? true;
  const includeAssets = options.includeAssets ?? true;
  const atlasStats = emptySourceSyncStats();
  const mooncellStats = emptySourceSyncStats();
  const failures: SyncFailure[] = [];
  let mooncellStatus: SyncStatus = includeMooncell && options.regions.includes("CN") ? "skipped" : "skipped";
  await ensureDataDirs(options.dataDir);
  const db = new FgoDatabase(resolveDbPath(options.dataDir));
  const summary: SyncSummary = {
    status: "ok",
    message: "Sync not finished.",
    dbPath: resolveDbPath(options.dataDir),
    regions: options.regions,
    fetched: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    entities: 0,
    banners: 0,
    questAudits: [],
    databases: [],
    failures,
  };

  try {
    const infoUrl = `${ATLAS_BASE}/info`;
    atlasStats.total += 1;
    try {
      const fetchedAt = nowIso();
      const info = await fetchJson(infoUrl);
      db.setMetadata("atlas.info", info, fetchedAt);
      db.upsertSource({
        id: "atlas:info",
        source: "atlas",
        kind: "metadata",
        url: infoUrl,
        hash: hashText(stringifyJson(info)),
        fetchedAt,
        status: "ok",
      });
      atlasStats.fetched += 1;
      summary.fetched += 1;
    } catch (error) {
      const message = errorMessage(error);
      summary.failed += 1;
      atlasStats.failed += 1;
      failures.push({
        id: "atlas:info",
        source: "atlas",
        kind: "metadata",
        url: infoUrl,
        error: message,
      });
      db.upsertSource({
        id: "atlas:info",
        source: "atlas",
        kind: "metadata",
        url: infoUrl,
        fetchedAt: nowIso(),
        status: "failed",
        error: message,
      });
    }

    for (const region of options.regions) {
      for (const config of ATLAS_EXPORTS) {
        if (config.regions && !config.regions.includes(region)) continue;
        if (config.kind === "basic" && !includeBasic) continue;
        if (config.kind === "nice" && !includeNice) continue;
        if (config.kind === "asset" && !includeAssets) continue;
        atlasStats.total += 1;
        const url = `${ATLAS_BASE}/export/${region}/${config.file}`;
        const sourceId = `atlas:${region}:${config.file}`;
        if (options.verbose) console.error(`[sync] ${region} ${config.file}`);
        const previous = db.getSource(sourceId);
        try {
          const fetched = await fetchJsonWithHttpCache(url, options.force ? undefined : previous);
          const previousHash = sourceString(previous, "hash");
          const etag = fetched.status === "not_modified" ? fetched.etag ?? sourceString(previous, "etag") : fetched.etag;
          const lastModified =
            fetched.status === "not_modified"
              ? fetched.lastModified ?? sourceString(previous, "last_modified")
              : fetched.lastModified;
          if (fetched.status === "not_modified") {
            let hash = previousHash;
            if (isQuestIndexSource(config)) {
              const cached = await readCachedJson(options.dataDir, region, config.file);
              if (cached) {
                await refreshQuestIndex(db, summary, {
                  region,
                  payload: cached.payload,
                  dataDir: options.dataDir,
                  verbose: options.verbose,
                });
              } else {
                const refetched = await fetchModifiedJson(url);
                hash = hashText(refetched.text);
                await ingestFetchedAtlasExport(db, summary, {
                  region,
                  config,
                  payload: refetched.payload,
                  text: refetched.text,
                  hash,
                  etag: refetched.etag,
                  lastModified: refetched.lastModified,
                  url,
                  sourceId,
                  dataDir: options.dataDir,
                  verbose: options.verbose,
                  stats: atlasStats,
                });
                continue;
              }
            }
            db.upsertSource({
              id: sourceId,
              region,
              source: "atlas",
              kind: config.kind,
              url,
              hash,
              etag,
              lastModified,
              fetchedAt: nowIso(),
              status: "unchanged",
            });
            summary.unchanged += 1;
            atlasStats.unchanged += 1;
            continue;
          }

          const text = fetched.text;
          const hash = hashText(text);
          if (!options.force && previousHash === hash) {
            await writeCache(options.dataDir, region, config.file, text);
            if (isQuestIndexSource(config)) {
              await refreshQuestIndex(db, summary, {
                region,
                payload: fetched.payload,
                dataDir: options.dataDir,
                verbose: options.verbose,
              });
            }
            db.upsertSource({
              id: sourceId,
              region,
              source: "atlas",
              kind: config.kind,
              url,
              hash,
              etag,
              lastModified,
              fetchedAt: nowIso(),
              status: "unchanged",
            });
            summary.unchanged += 1;
            atlasStats.unchanged += 1;
            continue;
          }

          await ingestFetchedAtlasExport(db, summary, {
            region,
            config,
            payload: fetched.payload,
            text,
            hash,
            etag,
            lastModified,
            url,
            sourceId,
            dataDir: options.dataDir,
            verbose: options.verbose,
            stats: atlasStats,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("HTTP 404")) {
            summary.skipped += 1;
            atlasStats.skipped += 1;
            db.upsertSource({
              id: sourceId,
              region,
              source: "atlas",
              kind: config.kind,
              url,
              fetchedAt: nowIso(),
              status: "skipped",
              error: message,
            });
          } else {
            summary.failed += 1;
            atlasStats.failed += 1;
            failures.push({
              id: sourceId,
              source: "atlas",
              kind: config.kind,
              region,
              url,
              error: message,
            });
            db.upsertSource({
              id: sourceId,
              region,
              source: "atlas",
              kind: config.kind,
              url,
              hash: sourceString(previous, "hash"),
              etag: sourceString(previous, "etag"),
              lastModified: sourceString(previous, "last_modified"),
              fetchedAt: nowIso(),
              status: "failed",
              error: message,
            });
          }
        }
      }
    }

    if (includeMooncell && options.regions.includes("CN")) {
      mooncellStats.total += 1;
      if (options.verbose) console.error("[sync] Mooncell future banners");
      const sourceId = "mooncell:CN:banners";
      const previous = db.getSource(sourceId);
      try {
        const banners = await fetchMooncellBanners();
        const hash = hashMooncellBanners(banners);
        if (!options.force && sourceString(previous, "hash") === hash) {
          db.upsertSource({
            id: sourceId,
            region: "CN",
            source: "mooncell",
            kind: "banner",
            url: MOONCELL_API,
            hash,
            fetchedAt: nowIso(),
            status: "unchanged",
          });
          summary.unchanged += 1;
          mooncellStats.unchanged += 1;
          mooncellStatus = "ok";
        } else {
          db.transaction(() => {
            for (const banner of banners) {
              db.upsertBanner(banner);
              db.upsertEntity({
                region: "CN",
                entityType: "banner",
                entityId: banner.id,
                name: banner.title,
                aliases: uniqueStrings([banner.title, ...banner.pickupServants]),
                summary: `${banner.title} ${banner.startAt ?? ""} ~ ${banner.endAt ?? ""} ${banner.pickupServants.join(" ")}`,
                rawJson: banner.rawJson,
                sourceUrl: banner.sourceUrl,
                updatedAt: banner.updatedAt,
              });
            }
          });
          db.upsertSource({
            id: sourceId,
            region: "CN",
            source: "mooncell",
            kind: "banner",
            url: MOONCELL_API,
            hash,
            fetchedAt: nowIso(),
            status: "ok",
          });
          summary.banners = banners.length;
          mooncellStats.fetched += 1;
          mooncellStatus = "ok";
        }
      } catch (error) {
        const message = errorMessage(error);
        summary.failed += 1;
        mooncellStats.failed += 1;
        mooncellStatus = "failed";
        failures.push({
          id: sourceId,
          source: "mooncell",
          kind: "banner",
          region: "CN",
          url: MOONCELL_API,
          error: message,
        });
        db.upsertSource({
          id: sourceId,
          region: "CN",
          source: "mooncell",
          kind: "banner",
          url: MOONCELL_API,
          hash: sourceString(previous, "hash"),
          fetchedAt: nowIso(),
          status: "failed",
          error: message,
        });
      }
    }
    finalizeSyncSummary(db, summary, {
      atlasStats,
      includeMooncell,
      mooncellStatus,
      mooncellStats,
    });
  } finally {
    db.close();
  }

  return summary;
}

function emptySourceSyncStats(): SourceSyncStats {
  return {
    total: 0,
    fetched: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  };
}

function finalizeSyncSummary(
  db: FgoDatabase,
  summary: SyncSummary,
  input: {
    atlasStats: SourceSyncStats;
    includeMooncell: boolean;
    mooncellStatus: SyncStatus;
    mooncellStats: SourceSyncStats;
  },
): void {
  const atlasStatus: SyncStatus = input.atlasStats.failed > 0 ? "partial" : "ok";
  const questIndexStatus = questIndexSyncStatus(summary);
  summary.completedAt = nowIso();
  summary.counts = {
    regions: summary.regions.map((region) => {
      const entityCounts = db.listEntityTypes(region);
      const selectedEntities = selectSummaryEntityCounts(entityCounts);
      return {
        region,
        totalEntities: db.countEntities(region),
        entityTypes: entityCounts.length,
        entities: selectedEntities.counts,
        otherEntities: selectedEntities.other,
        questIndex: db.countQuestIndex(region),
        banners: db.countBanners(region),
        resources: db.countResources(region),
      };
    }),
  };
  summary.databases = [
    {
      name: "atlas",
      status: atlasStatus,
      message: sourceStatsMessage("Atlas", input.atlasStats),
      stats: { ...input.atlasStats },
    },
    {
      name: "quest_index",
      status: questIndexStatus,
      message: questIndexMessage(summary),
      regions: summary.questAudits.map((audit) => ({
        region: audit.region,
        indexedQuests: audit.indexedQuests,
        failedQuestDetails: audit.failedQuestDetails,
        candidateQuests: audit.candidateQuests,
      })),
    },
    {
      name: "mooncell",
      status: input.includeMooncell && summary.regions.includes("CN") ? input.mooncellStatus : "skipped",
      message: mooncellMessage(summary, input.includeMooncell),
      stats:
        input.includeMooncell && summary.regions.includes("CN")
          ? { ...input.mooncellStats }
          : { total: 0, fetched: 0, unchanged: 0, skipped: 1, failed: 0 },
    },
  ];
  summary.status = summary.failed > 0 ? "partial" : "ok";
  summary.message =
    summary.status === "ok"
      ? `同步完成：${summary.fetched} 个数据源已更新，${summary.unchanged} 个数据源未变化。`
      : `同步完成但有 ${summary.failed} 个数据源失败；可用 fgo status --limit 10 查看明细。`;
}

function selectSummaryEntityCounts(entityCounts: Array<{ entityType: string; count: number }>): {
  counts: Record<string, number>;
  other: number;
} {
  const preferred = new Set([
    "servant",
    "equip",
    "event",
    "war",
    "item",
    "command_code",
    "mystic_code",
    "asset_storage",
    "trait",
    "banner",
  ]);
  const counts: Record<string, number> = {};
  let other = 0;
  for (const item of entityCounts) {
    if (preferred.has(item.entityType)) {
      counts[item.entityType] = item.count;
    } else {
      other += item.count;
    }
  }
  return { counts, other };
}

function sourceStatsMessage(name: string, stats: SourceSyncStats): string {
  if (stats.failed > 0) {
    return `${name} 部分完成：${stats.fetched} 个更新，${stats.unchanged} 个未变化，${stats.failed} 个失败，${stats.skipped} 个跳过。`;
  }
  return `${name} 正常：${stats.fetched} 个更新，${stats.unchanged} 个未变化，${stats.skipped} 个跳过。`;
}

function questIndexSyncStatus(summary: SyncSummary): SyncStatus {
  if (summary.questAudits.length === 0) return "skipped";
  return summary.questAudits.some((audit) => audit.failedQuestDetails > 0 || audit.indexedQuests === 0) ? "partial" : "ok";
}

function questIndexMessage(summary: SyncSummary): string {
  if (summary.questAudits.length === 0) return "quest_index 未刷新；通常是未同步 nice_war 或本次未包含 nice 数据。";
  const details = summary.questAudits
    .map((audit) => `${audit.region}: ${audit.indexedQuests}/${audit.candidateQuests} 个常驻自由本`)
    .join("，");
  return `quest_index 已刷新：${details}。`;
}

function mooncellMessage(summary: SyncSummary, includeMooncell: boolean): string {
  if (!includeMooncell || !summary.regions.includes("CN")) return "Mooncell 未启用或本次未同步 CN。";
  const failure = summary.failures.find((item) => item.source === "mooncell");
  if (failure) return `Mooncell 同步失败：${failure.error}`;
  if (summary.banners > 0) return `Mooncell 正常：更新 ${summary.banners} 个预测卡池。`;
  return "Mooncell 正常：预测卡池数据未变化。";
}

function isQuestIndexSource(config: AtlasExportConfig): boolean {
  return config.entityType === "war" && config.kind === "nice";
}

async function ingestFetchedAtlasExport(
  db: FgoDatabase,
  summary: SyncSummary,
  input: {
    region: Region;
    config: AtlasExportConfig;
    payload: unknown;
    text: string;
    hash: string;
    etag?: string;
    lastModified?: string;
    url: string;
    sourceId: string;
    dataDir?: string;
    verbose?: boolean;
    stats?: SourceSyncStats;
  },
): Promise<void> {
  await writeCache(input.dataDir, input.region, input.config.file, input.text);
  const count = ingestAtlasPayload(db, {
    region: input.region,
    entityType: input.config.entityType,
    payload: input.payload,
    sourceUrl: input.url,
    updatedAt: nowIso(),
  });
  if (isQuestIndexSource(input.config)) {
    await refreshQuestIndex(db, summary, {
      region: input.region,
      payload: input.payload,
      dataDir: input.dataDir,
      verbose: input.verbose,
    });
  }
  db.upsertSource({
    id: input.sourceId,
    region: input.region,
    source: "atlas",
    kind: input.config.kind,
    url: input.url,
    hash: input.hash,
    etag: input.etag,
    lastModified: input.lastModified,
    fetchedAt: nowIso(),
    status: "ok",
  });
  summary.fetched += 1;
  summary.entities += count;
  if (input.stats) input.stats.fetched += 1;
}

async function refreshQuestIndex(
  db: FgoDatabase,
  summary: SyncSummary,
  input: {
    region: Region;
    payload: unknown;
    dataDir?: string;
    verbose?: boolean;
  },
): Promise<void> {
  const questSync = await syncQuestIndex(db, {
    region: input.region,
    payload: input.payload,
    dataDir: input.dataDir,
    verbose: input.verbose,
    updatedAt: nowIso(),
  });
  summary.questAudits.push(questSync.audit);
  if (questSync.indexed > 0) {
    db.upsertSource({
      id: `atlas:${input.region}:quest_index`,
      region: input.region,
      source: "atlas",
      kind: "quest_index",
      url: `${ATLAS_BASE}/nice/${input.region}/quest/{questId}/{phase}`,
      fetchedAt: nowIso(),
      status: "ok",
    });
  }
}

export function ingestAtlasPayload(
  db: FgoDatabase,
  input: {
    region: Region;
    entityType: string;
    payload: unknown;
    sourceUrl: string;
    updatedAt: string;
  },
): number {
  const records = explodeRecords(input.payload);
  let count = 0;
  db.transaction(() => {
    db.clearEntityType(input.region, input.entityType);
    for (const { key, value } of records) {
      const record = normalizeEntity({
        region: input.region,
        entityType: input.entityType,
        key,
        value,
        sourceUrl: input.sourceUrl,
        updatedAt: input.updatedAt,
      });
      db.upsertEntity(record, { ftsAlreadyCleared: true });
      indexDerivedData(db, record);
      count += 1;
    }
  });
  return count;
}

function explodeRecords(payload: unknown): Array<{ key: string; value: unknown }> {
  if (Array.isArray(payload)) {
    return payload.map((value, index) => ({ key: String(index), value }));
  }
  if (isRecord(payload)) {
    const entries = Object.entries(payload);
    const looksLikeSingleEntity =
      "id" in payload || "collectionNo" in payload || "name" in payload || "originalName" in payload;
    if (looksLikeSingleEntity && entries.length < 200) {
      return [{ key: String(entityIdFromValue(payload, "0")), value: payload }];
    }
    return entries.map(([key, value]) => {
      if (isRecord(value)) return { key, value: { key, ...value } };
      return { key, value: { key, value, name: String(value) } };
    });
  }
  return [{ key: "value", value: { key: "value", value: payload, name: String(payload) } }];
}

function normalizeEntity(input: {
  region: Region;
  entityType: string;
  key: string;
  value: unknown;
  sourceUrl: string;
  updatedAt: string;
}): EntityRecord {
  const raw = isRecord(input.value) ? input.value : { value: input.value };
  const entityId = entityIdFromValue(raw, input.key);
  const name = nameFromValue(raw, `${input.entityType}:${entityId}`);
  const aliases = aliasesFromValue(raw, name);
  const collectionNo =
    typeof raw.collectionNo === "number"
      ? raw.collectionNo
      : typeof raw.collectionNo === "string"
        ? Number(raw.collectionNo)
        : null;
  return {
    region: input.region,
    entityType: input.entityType,
    entityId,
    collectionNo: Number.isFinite(collectionNo) ? collectionNo : null,
    name,
    originalName: typeof raw.originalName === "string" ? raw.originalName : null,
    aliases,
    summary: summaryFromValue(input.entityType, raw, name),
    rawJson: raw,
    sourceUrl: input.sourceUrl,
    updatedAt: input.updatedAt,
  };
}

function entityIdFromValue(raw: Record<string, unknown>, fallback: string): string {
  const candidate =
    raw.id ??
    raw.collectionNo ??
    raw.key ??
    raw.svtId ??
    raw.eventId ??
    raw.warId ??
    raw.questId ??
    raw.name ??
    fallback;
  return String(candidate);
}

function nameFromValue(raw: Record<string, unknown>, fallback: string): string {
  const candidates = [
    raw.name,
    raw.originalName,
    raw.shortName,
    raw.title,
    raw.detail,
    raw.value,
    raw.key,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number") return String(candidate);
  }
  return fallback;
}

function aliasesFromValue(raw: Record<string, unknown>, name: string): string[] {
  const aliases: Array<string | undefined> = [
    name,
    stringField(raw, "originalName"),
    stringField(raw, "ruby"),
    stringField(raw, "battleName"),
    stringField(raw, "originalBattleName"),
    stringField(raw, "shortName"),
    stringField(raw, "detail"),
    stringField(raw, "key"),
  ];
  for (const listKey of ["nicknames", "aliases", "names"]) {
    const value = raw[listKey];
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") aliases.push(item);
    }
  }
  aliases.push(...localAliases(raw, name));
  return uniqueStrings(aliases);
}

function localAliases(raw: Record<string, unknown>, name: string): string[] {
  const collectionNo = Number(raw.collectionNo);
  if (name === "阿尔托莉雅·卡斯特" && collectionNo === 284) {
    return ["C呆", "c呆", "术呆", "術呆", "阿尔托莉雅Caster", "阿尔托莉雅·Caster"];
  }
  if (name === "阿尔托莉雅·卡斯特" && collectionNo === 386) {
    return ["水C呆", "水c呆", "泳装C呆", "泳裝C呆", "泳装术呆", "泳裝術呆", "狂呆", "阿尔托莉雅Caster(Berserker)"];
  }
  return [];
}

function stringField(raw: Record<string, unknown>, key: string): string | undefined {
  return typeof raw[key] === "string" ? String(raw[key]) : undefined;
}

function numberField(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function summaryFromValue(entityType: string, raw: Record<string, unknown>, name: string): string {
  if (entityType === "servant") {
    const parts = [
      raw.collectionNo == null ? undefined : `No.${String(raw.collectionNo)}`,
      raw.rarity == null ? undefined : `${String(raw.rarity)}★`,
      stringField(raw, "className"),
      stringField(raw, "attribute"),
      name,
      traitsFromRaw(raw).join(" "),
      skillNames(raw).join(" "),
    ];
    return uniqueStrings(parts).join(" ").slice(0, 2000);
  }
  if (entityType === "event") {
    return uniqueStrings([
      name,
      stringField(raw, "type"),
      raw.startedAt == null ? undefined : `start:${toUnixIso(raw.startedAt)}`,
      raw.endedAt == null ? undefined : `end:${toUnixIso(raw.endedAt)}`,
      collectStrings(raw, 1200),
    ]).join(" ");
  }
  return uniqueStrings([name, collectStrings(raw, 1800)]).join(" ").slice(0, 2000);
}

function indexDerivedData(db: FgoDatabase, record: EntityRecord): void {
  const raw = isRecord(record.rawJson) ? record.rawJson : {};
  for (const resource of extractUrls(raw)) {
    db.insertResource({
      region: record.region,
      ownerType: record.entityType,
      ownerId: record.entityId,
      assetType: resource.path || "url",
      url: resource.url,
      sourceRegion: record.region,
      data: { path: resource.path },
    });
  }

  if (record.entityType === "servant") {
    indexServant(db, record, raw);
  } else if (record.entityType === "event") {
    indexEvent(db, record, raw);
  } else if (record.entityType === "war") {
    indexWar(db, record, raw);
  }
}

function indexServant(db: FgoDatabase, record: EntityRecord, raw: Record<string, unknown>): void {
  const className = stringField(raw, "className");
  const rarity = typeof raw.rarity === "number" ? raw.rarity : undefined;
  const traits = traitsFromRaw(raw);
  for (const trait of traits) {
    db.insertServantTrait({
      region: record.region,
      servantId: record.entityId,
      collectionNo: record.collectionNo,
      servantName: record.name,
      className,
      rarity,
      trait,
      sourceUrl: record.sourceUrl,
    });
  }
  if (className) {
    db.insertServantTrait({
      region: record.region,
      servantId: record.entityId,
      collectionNo: record.collectionNo,
      servantName: record.name,
      className,
      rarity,
      trait: `class:${className}`,
      sourceUrl: record.sourceUrl,
    });
  }
  const attribute = stringField(raw, "attribute");
  if (attribute) {
    db.insertServantTrait({
      region: record.region,
      servantId: record.entityId,
      collectionNo: record.collectionNo,
      servantName: record.name,
      className,
      rarity,
      trait: `attribute:${attribute}`,
      sourceUrl: record.sourceUrl,
    });
  }
  const gender = stringField(raw, "gender");
  if (gender) {
    db.insertServantTrait({
      region: record.region,
      servantId: record.entityId,
      collectionNo: record.collectionNo,
      servantName: record.name,
      className,
      rarity,
      trait: `gender:${gender}`,
      sourceUrl: record.sourceUrl,
    });
  }

  indexSkillLikeSources(db, record, raw, "skill", raw.skills);
  indexSkillLikeSources(db, record, raw, "classPassive", raw.classPassive);
  indexSkillLikeSources(db, record, raw, "appendPassive", raw.appendPassive);
  indexSkillLikeSources(db, record, raw, "noblePhantasm", raw.noblePhantasms);
}

function traitsFromRaw(raw: Record<string, unknown>): string[] {
  const traits: string[] = [];
  const rawTraits = raw.traits;
  if (Array.isArray(rawTraits)) {
    for (const trait of rawTraits) {
      if (typeof trait === "string" || typeof trait === "number") {
        traits.push(String(trait));
      } else if (isRecord(trait)) {
        const value = trait.name ?? trait.value ?? trait.id;
        if (value != null) traits.push(String(value));
      }
    }
  }
  return uniqueStrings(traits);
}

function skillNames(raw: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const key of ["skills", "classPassive", "appendPassive", "noblePhantasms"]) {
    const value = raw[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (isRecord(item) && typeof item.name === "string") names.push(item.name);
    }
  }
  return uniqueStrings(names);
}

function indexSkillLikeSources(
  db: FgoDatabase,
  record: EntityRecord,
  raw: Record<string, unknown>,
  sourceType: string,
  sources: unknown,
): void {
  if (!Array.isArray(sources)) return;
  const className = stringField(raw, "className");
  const rarity = typeof raw.rarity === "number" ? raw.rarity : undefined;
  for (const source of sources) {
    if (!isRecord(source)) continue;
    const sourceName = nameFromValue(source, sourceType);
    const sourceId = entityIdFromValue(source, sourceName);
    const npCard = sourceType === "noblePhantasm" ? npCardName(source.card) : undefined;
    if (npCard) {
      db.insertEffectMatch({
        region: record.region,
        servantId: record.entityId,
        collectionNo: record.collectionNo,
        servantName: record.name,
        className,
        rarity,
        sourceType,
        sourceName,
        sourceId,
        buffType: `npCard:${npCard.key}`,
        buffName: `${npCard.cn}宝具`,
        detail: `宝具卡色：${npCard.cn}`,
        target: "noblePhantasm",
        sourceUrl: record.sourceUrl,
        data: source,
      });
      db.insertRelation({
        region: record.region,
        fromType: "servant",
        fromId: record.entityId,
        relation: "has_np_card",
        toType: "np_card",
        toId: npCard.key,
        label: `${npCard.cn}宝具`,
        data: { sourceType, sourceName, card: source.card },
      });
    }
    db.insertRelation({
      region: record.region,
      fromType: "servant",
      fromId: record.entityId,
      relation: `has_${sourceType}`,
      toType: sourceType,
      toId: sourceId,
      label: sourceName,
      data: source,
    });
    const functions = Array.isArray(source.functions) ? source.functions : [];
    for (const func of functions) {
      if (!isRecord(func)) continue;
      const funcType = String(func.funcType ?? func.type ?? "function");
      for (const specialTarget of specialAttackTargets(func)) {
        db.insertEffectMatch({
          region: record.region,
          servantId: record.entityId,
          collectionNo: record.collectionNo,
          servantName: record.name,
          className,
          rarity,
          sourceType,
          sourceName,
          sourceId,
          buffType: `specialAttack:${specialTarget.key}`,
          buffName: `${specialTarget.cn}特攻`,
          detail: `对${specialTarget.cn}特攻`,
          target: specialTarget.key,
          duration: durationFromFunction(func),
          sourceUrl: record.sourceUrl,
          data: func,
        });
      }
      const buffs = Array.isArray(func.buffs) ? func.buffs : [];
      if (buffs.length === 0) {
        db.insertEffectMatch({
          region: record.region,
          servantId: record.entityId,
          collectionNo: record.collectionNo,
          servantName: record.name,
          className,
          rarity,
          sourceType,
          sourceName,
          sourceId,
          buffType: funcType,
          buffName: String(func.funcPopupText ?? funcType),
          detail: typeof func.detail === "string" ? func.detail : undefined,
          target: String(func.funcTargetType ?? func.targetType ?? ""),
          duration: durationFromFunction(func),
          sourceUrl: record.sourceUrl,
          data: func,
        });
      }
      for (const buff of buffs) {
        if (!isRecord(buff)) continue;
        const buffType = String(buff.type ?? buff.name ?? funcType);
        const buffName = String(buff.name ?? buffType);
        db.insertEffectMatch({
          region: record.region,
          servantId: record.entityId,
          collectionNo: record.collectionNo,
          servantName: record.name,
          className,
          rarity,
          sourceType,
          sourceName,
          sourceId,
          buffType,
          buffName,
          detail: typeof buff.detail === "string" ? buff.detail : undefined,
          target: String(func.funcTargetType ?? func.targetType ?? ""),
          duration: durationFromFunction(func),
          sourceUrl: record.sourceUrl,
          data: { function: func, buff },
        });
        db.insertRelation({
          region: record.region,
          fromType: "servant",
          fromId: record.entityId,
          relation: "has_buff",
          toType: "buff",
          toId: buffType,
          label: buffName,
          data: { sourceType, sourceName, buff },
        });
      }
    }
  }
}

function npCardName(value: unknown): { key: "arts" | "buster" | "quick"; cn: "蓝卡" | "红卡" | "绿卡" } | undefined {
  const card = String(value ?? "");
  if (card === "1" || /^arts$/i.test(card)) return { key: "arts", cn: "蓝卡" };
  if (card === "2" || /^buster$/i.test(card)) return { key: "buster", cn: "红卡" };
  if (card === "3" || /^quick$/i.test(card)) return { key: "quick", cn: "绿卡" };
  return undefined;
}

const SPECIAL_TARGETS: Record<number, { key: string; cn: string }> = {
  2000: { key: "divine", cn: "神性" },
  2001: { key: "humanoid", cn: "人型" },
  2008: { key: "weakToEnumaElish", cn: "天地从者" },
  2019: { key: "demonic", cn: "魔性" },
  2023: { key: "dragon", cn: "龙" },
  2113: { key: "king", cn: "王" },
};

const SPECIAL_TEXT_TARGETS: Array<{ key: string; cn: string; patterns: RegExp[] }> = [
  { key: "divine", cn: "神性", patterns: [/神性/] },
  { key: "alignmentChaotic", cn: "混沌", patterns: [/混沌/] },
  { key: "demonic", cn: "魔性", patterns: [/魔性/] },
  { key: "dragon", cn: "龙", patterns: [/龙|龍/] },
  { key: "king", cn: "王", patterns: [/王/] },
  { key: "humanoid", cn: "人型", patterns: [/人型/] },
  { key: "threatToHumanity", cn: "人类的威胁", patterns: [/人类的威胁|人類的威脅|Threat to Humanity/i] },
];

function specialAttackTargets(func: Record<string, unknown>): Array<{ key: string; cn: string }> {
  const funcType = String(func.funcType ?? "");
  const text = collectStrings(func, 5000);
  const mightBeSpecial =
    /Individual|Special|特攻|特效|supereffective/i.test(funcType) ||
    /特攻|特效|威力提升|伤害提升|傷害提升|特性.*伤害|特性.*傷害/.test(text);
  if (!mightBeSpecial) return [];
  const ids = new Set<number>();
  const svals = Array.isArray(func.svals) ? func.svals : [];
  for (const sval of svals) {
    if (!isRecord(sval)) continue;
    for (const key of [
      "Target",
      "Individuality",
      "TargetIndividuality",
      "TargetFunctionIndividuality",
      "TargetBuffIndividuality",
    ]) {
      const value = sval[key];
      if (typeof value === "number") ids.add(value);
    }
    for (const key of ["TargetList", "IndividualityList", "TargetIndividualityList"]) {
      const value = sval[key];
      if (Array.isArray(value)) {
        for (const item of value) if (typeof item === "number") ids.add(item);
      }
    }
  }
  const targets = [...ids].map((id) => SPECIAL_TARGETS[id]).filter((value): value is { key: string; cn: string } => Boolean(value));
  for (const target of SPECIAL_TEXT_TARGETS) {
    if (target.patterns.some((pattern) => pattern.test(text))) targets.push({ key: target.key, cn: target.cn });
  }
  return uniqueByKey(targets);
}

function uniqueByKey(values: Array<{ key: string; cn: string }>): Array<{ key: string; cn: string }> {
  const seen = new Set<string>();
  const result: Array<{ key: string; cn: string }> = [];
  for (const value of values) {
    if (seen.has(value.key)) continue;
    seen.add(value.key);
    result.push(value);
  }
  return result;
}

function durationFromFunction(func: Record<string, unknown>): string | undefined {
  const vals = Array.isArray(func.svals) ? func.svals[0] : undefined;
  if (!isRecord(vals)) return undefined;
  const turn = vals.Turn ?? vals.turn;
  const count = vals.Count ?? vals.count;
  const parts = [];
  if (turn != null) parts.push(`${String(turn)}T`);
  if (count != null) parts.push(`${String(count)}次`);
  return parts.length ? parts.join("/") : undefined;
}

function indexEvent(db: FgoDatabase, record: EntityRecord, raw: Record<string, unknown>): void {
  for (const warId of arrayValues(raw.warIds)) {
    db.insertRelation({
      region: record.region,
      fromType: "event",
      fromId: record.entityId,
      relation: "has_war",
      toType: "war",
      toId: String(warId),
      data: { warId },
    });
  }
  for (const [key, relation, toType] of [
    ["shop", "has_shop_entry", "shop"],
    ["missions", "has_mission", "event_mission"],
    ["svts", "has_servant", "servant"],
    ["campaignQuests", "has_campaign_quest", "quest"],
  ] as const) {
    const items = raw[key];
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      const id = isRecord(item) ? entityIdFromValue(item, String(index)) : String(index);
      db.insertRelation({
        region: record.region,
        fromType: "event",
        fromId: record.entityId,
        relation,
        toType,
        toId: id,
        label: isRecord(item) ? nameFromValue(item, id) : id,
        data: item,
      });
    });
  }
}

function indexWar(db: FgoDatabase, record: EntityRecord, raw: Record<string, unknown>): void {
  const quests = questsFromWar(raw);
  quests.forEach((quest, index) => {
    const id = entityIdFromValue(quest, String(index));
    db.insertRelation({
      region: record.region,
      fromType: "war",
      fromId: record.entityId,
      relation: "has_quest",
      toType: "quest",
      toId: id,
      label: nameFromValue(quest, id),
      data: quest,
    });
  });
}

async function syncQuestIndex(
  db: FgoDatabase,
  input: {
    region: Region;
    payload: unknown;
    dataDir?: string;
    verbose?: boolean;
    updatedAt: string;
  },
): Promise<{ indexed: number; audit: QuestIndexAudit }> {
  const { candidates: quests, audit } = collectPermanentFreeQuests(input.region, input.payload, input.updatedAt);
  if (input.verbose) {
    console.error(
      `[sync] ${input.region} quest phase details (${quests.length}); consumeTypes=${stringifyJson(audit.consumeTypes)}`,
    );
    if (audit.unknownConsumeTypes.length > 0) {
      console.error(`[sync] ${input.region} unknown quest consume types: ${audit.unknownConsumeTypes.join(", ")}`);
    }
  }
  const results: QuestIndexRecord[] = [];
  let failedQuestDetails = 0;
  let cursor = 0;
  const workerCount = Math.min(8, Math.max(1, quests.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const current = quests[cursor];
        cursor += 1;
        if (!current) return;
        try {
          const detail = await fetchQuestPhase(input.region, current.questId, current.phase);
          if (!isRecord(detail)) continue;
          const bond = numberField(detail, "bond");
          if (bond == null) continue;
          results.push({
            ...current,
            bond,
            exp: numberField(detail, "exp"),
            sourceUrl: `${ATLAS_BASE}/nice/${input.region}/quest/${current.questId}/${current.phase}`,
            rawJson: detail,
          });
        } catch {
          failedQuestDetails += 1;
          continue;
        }
      }
    }),
  );

  const completedAudit: QuestIndexAudit = {
    ...audit,
    indexedQuests: results.length,
    failedQuestDetails,
  };
  db.transaction(() => {
    db.clearQuestIndex(input.region);
    for (const result of results) {
      db.upsertQuestIndex({
        region: input.region,
        questId: result.questId,
        phase: result.phase,
        name: result.name,
        spotName: result.spotName,
        warId: result.warId,
        warName: result.warName,
        questType: result.questType,
        consumeType: result.consumeType,
        consume: result.consume,
        bond: result.bond,
        exp: result.exp,
        openedAt: result.openedAt,
        closedAt: result.closedAt,
        sourceUrl: result.sourceUrl,
        rawJson: result.rawJson,
        updatedAt: input.updatedAt,
      });
    }
    db.setMetadata(`quest_index.audit.${input.region}`, completedAudit, input.updatedAt);
  });
  return { indexed: results.length, audit: completedAudit };
}

interface QuestIndexCandidate {
  questId: string;
  phase: number;
  name: string;
  spotName?: string;
  warId?: string;
  warName?: string;
  questType?: string;
  consumeType?: string;
  consume?: number;
  openedAt?: string;
  closedAt?: string;
}

interface QuestIndexRecord extends QuestIndexCandidate {
  bond: number;
  exp?: number;
  sourceUrl: string;
  rawJson: unknown;
}

function collectPermanentFreeQuests(region: Region, payload: unknown, updatedAt: string): {
  candidates: QuestIndexCandidate[];
  audit: QuestIndexAudit;
} {
  const candidates: QuestIndexCandidate[] = [];
  const audit: QuestIndexAudit = {
    region,
    totalWars: 0,
    totalQuests: 0,
    skippedEventWars: 0,
    candidateQuests: 0,
    indexedQuests: 0,
    failedQuestDetails: 0,
    skippedReasons: {},
    consumeTypes: {},
    unknownConsumeTypes: [],
    updatedAt,
  };
  const knownConsumeTypes = new Set(["ap", "apAndItem"]);

  for (const { value } of explodeRecords(payload)) {
    const war = isRecord(value) ? value : {};
    const warId = String(war.id ?? war.warId ?? "");
    const warName = nameFromValue(war, warId);
    const warEventId = Number(war.eventId ?? 0);
    const quests = questsFromWar(war);
    audit.totalWars += 1;
    audit.totalQuests += quests.length;
    if (warEventId !== 0) {
      audit.skippedEventWars += 1;
      increment(audit.skippedReasons, "event_war", quests.length);
      continue;
    }
    for (const quest of quests) {
      const reason = permanentFreeQuestSkipReason(quest);
      if (reason) {
        increment(audit.skippedReasons, reason);
        continue;
      }
      const consumeType = stringField(quest, "consumeType") ?? "unknown";
      increment(audit.consumeTypes, consumeType);
      if (!knownConsumeTypes.has(consumeType) && !audit.unknownConsumeTypes.includes(consumeType)) {
        audit.unknownConsumeTypes.push(consumeType);
      }
      const phases = Array.isArray(quest.phases) ? quest.phases.map(Number).filter(Number.isFinite) : [];
      const phase = phases.length ? Math.max(...phases) : 1;
      const questId = entityIdFromValue(quest, "");
      candidates.push({
        questId,
        phase,
        name: nameFromValue(quest, questId),
        spotName: stringField(quest, "spotName"),
        warId,
        warName: stringField(quest, "warLongName") ?? warName,
        questType: stringField(quest, "type"),
        consumeType: stringField(quest, "consumeType"),
        consume: numberField(quest, "consume"),
        openedAt: quest.openedAt == null ? undefined : toUnixIso(quest.openedAt),
        closedAt: quest.closedAt == null ? undefined : toUnixIso(quest.closedAt),
      });
    }
  }
  audit.candidateQuests = candidates.length;
  audit.unknownConsumeTypes.sort();
  return { candidates, audit };
}

function questsFromWar(raw: Record<string, unknown>): Record<string, unknown>[] {
  const direct = raw.quests ?? raw.mstQuest;
  if (Array.isArray(direct)) return direct.filter(isRecord);
  const result: Record<string, unknown>[] = [];
  const spots = raw.spots;
  if (Array.isArray(spots)) {
    for (const spot of spots) {
      if (!isRecord(spot) || !Array.isArray(spot.quests)) continue;
      for (const quest of spot.quests) {
        if (isRecord(quest)) result.push(quest);
      }
    }
  }
  return result;
}

function permanentFreeQuestSkipReason(quest: Record<string, unknown>): string | undefined {
  if (stringField(quest, "type") !== "free") return "not_free";
  if (stringField(quest, "afterClear") !== "repeatLast") return "not_repeat_last";
  if (numberField(quest, "consume") == null) return "missing_consume";
  const closedAt = numberField(quest, "closedAt");
  if (closedAt != null && closedAt > 0 && closedAt < Math.floor(Date.now() / 1000)) return "closed";
  if (!entityIdFromValue(quest, "")) return "missing_quest_id";
  return undefined;
}

function increment(record: Record<string, number>, key: string, amount = 1): void {
  record[key] = (record[key] ?? 0) + amount;
}

async function fetchQuestPhase(region: Region, questId: string, phase: number): Promise<unknown> {
  return fetchJson(`${ATLAS_BASE}/nice/${region}/quest/${questId}/${phase}`);
}

function arrayValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type FetchJsonWithHttpCacheResult =
  | {
      status: "modified";
      payload: unknown;
      text: string;
      etag?: string;
      lastModified?: string;
    }
  | {
      status: "not_modified";
      etag?: string;
      lastModified?: string;
    };

async function fetchJson(url: string): Promise<unknown> {
  const fetched = await fetchJsonWithHttpCache(url);
  if (fetched.status === "not_modified") {
    throw new Error(`HTTP 304 Not Modified without cache handler: ${url}`);
  }
  return fetched.payload;
}

async function fetchModifiedJson(url: string): Promise<Extract<FetchJsonWithHttpCacheResult, { status: "modified" }>> {
  const fetched = await fetchJsonWithHttpCache(url);
  if (fetched.status === "not_modified") {
    throw new Error(`HTTP 304 Not Modified without cache handler: ${url}`);
  }
  return fetched;
}

async function fetchJsonWithHttpCache(
  url: string,
  previous?: Record<string, unknown>,
): Promise<FetchJsonWithHttpCacheResult> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "fgo-agent/0.1.1",
  };
  const etag = sourceString(previous, "etag");
  const lastModified = sourceString(previous, "last_modified");
  if (etag) headers["if-none-match"] = etag;
  if (lastModified) headers["if-modified-since"] = lastModified;

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw new Error(`Fetch failed for ${url}: ${errorMessage(error)}`);
  }
  const nextEtag = response.headers.get("etag") ?? undefined;
  const nextLastModified = response.headers.get("last-modified") ?? undefined;
  if (response.status === 304) {
    return {
      status: "not_modified",
      etag: nextEtag ?? etag,
      lastModified: nextLastModified ?? lastModified,
    };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }
  const text = await response.text();
  try {
    return {
      status: "modified",
      payload: JSON.parse(text) as unknown,
      text,
      etag: nextEtag,
      lastModified: nextLastModified,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON from ${url}: ${message}`);
  }
}

function sourceString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`;
  return error.message;
}

async function readCachedJson(
  dataDir: string | undefined,
  region: Region,
  file: string,
): Promise<{ payload: unknown; text: string } | undefined> {
  const cachePath = path.join(resolveCacheDir(dataDir), region, file);
  try {
    const text = await readFile(cachePath, "utf8");
    return { payload: JSON.parse(text) as unknown, text };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid cached JSON from ${cachePath}: ${error.message}`);
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function writeCache(dataDir: string | undefined, region: Region, file: string, text: string): Promise<void> {
  const cacheDir = path.join(resolveCacheDir(dataDir), region);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(cacheDir, file), text);
}

interface MooncellBanner {
  id: string;
  region: Region;
  title: string;
  startAt?: string;
  endAt?: string;
  pickupServants: string[];
  pickupCEs: string[];
  confidence: "prediction";
  source: "mooncell";
  sourceUrl: string;
  rawJson: unknown;
  updatedAt: string;
}

function hashMooncellBanners(banners: MooncellBanner[]): string {
  return hashText(
    stringifyJson(
      banners.map((banner) => ({
        id: banner.id,
        region: banner.region,
        title: banner.title,
        startAt: banner.startAt,
        endAt: banner.endAt,
        pickupServants: banner.pickupServants,
        pickupCEs: banner.pickupCEs,
        confidence: banner.confidence,
        source: banner.source,
        sourceUrl: banner.sourceUrl,
        rawJson: banner.rawJson,
      })),
    ),
  );
}

async function fetchMooncellBanners(): Promise<MooncellBanner[]> {
  const params = new URLSearchParams({
    action: "ask",
    format: "json",
    query:
      "[[分类:限时召唤]][[SummonRecentServer::jp]]|?SummonTitleCN|?SummonTitleJP|?SummonStartCN|?SummonEndCN|?SummonStartJP|?SummonEndJP|?推荐召唤从者|?推荐召唤礼装|limit=500|sort=SummonStartCN",
  });
  const payload = await fetchJson(`${MOONCELL_API}?${params.toString()}`);
  const query = isRecord(payload) && isRecord(payload.query) ? payload.query : {};
  const results = isRecord(query.results) ? query.results : {};
  const banners: MooncellBanner[] = [];
  const updatedAt = nowIso();
  for (const [pageName, rawResult] of Object.entries(results)) {
    if (!isRecord(rawResult) || !isRecord(rawResult.printouts)) continue;
    const printouts = rawResult.printouts;
    const title = firstString(printouts.SummonTitleCN) ?? firstString(printouts.SummonTitleJP) ?? pageName;
    const startAt = firstDate(printouts.SummonStartCN) ?? firstDate(printouts.SummonStartJP);
    const endAt = firstDate(printouts.SummonEndCN) ?? firstDate(printouts.SummonEndJP);
    const pickupServants = pageList(printouts["推荐召唤从者"]);
    const pickupCEs = pageList(printouts["推荐召唤礼装"]);
    const sourceUrl = `https://fgo.wiki/w/${encodeURIComponent(pageName).replaceAll("%2F", "/")}`;
    banners.push({
      id: hashText(`mooncell:${pageName}:${startAt ?? ""}:${endAt ?? ""}`),
      region: "CN",
      title,
      startAt,
      endAt,
      pickupServants,
      pickupCEs,
      confidence: "prediction",
      source: "mooncell",
      sourceUrl,
      rawJson: rawResult,
      updatedAt,
    });
  }
  return banners;
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const first = value[0];
  return typeof first === "string" ? first : undefined;
}

function firstDate(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return toUnixIso(value[0]);
}

function pageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === "string") names.push(item);
    if (isRecord(item)) {
      const name = item.fulltext ?? item.displaytitle;
      if (typeof name === "string" && name.trim()) names.push(name.trim());
    }
  }
  return uniqueStrings(names);
}
