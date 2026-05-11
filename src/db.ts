import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type {
  BannerResult,
  EffectMatch,
  EntityRecord,
  EntityResult,
  QuestIndexAudit,
  QuestBondResult,
  Region,
  ResourceLink,
  SearchOptions,
  ServantResult,
  SourceRef,
} from "./types.js";
import { collectStrings, parseJson, stringifyJson } from "./utils.js";

type Row = Record<string, unknown>;

export class FgoDatabase {
  readonly db: DatabaseSync;

  constructor(readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.init();
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        region TEXT,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        hash TEXT,
        etag TEXT,
        last_modified TEXT,
        fetched_at TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS entities (
        region TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        collection_no INTEGER,
        name TEXT NOT NULL,
        original_name TEXT,
        aliases_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        source_url TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (region, entity_type, entity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_entities_type_name
        ON entities(region, entity_type, name);
      CREATE INDEX IF NOT EXISTS idx_entities_collection
        ON entities(region, entity_type, collection_no);

      CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
        region UNINDEXED,
        entity_type UNINDEXED,
        entity_id UNINDEXED,
        name,
        aliases,
        summary,
        raw_text,
        tokenize='unicode61'
      );

      CREATE TABLE IF NOT EXISTS relations (
        region TEXT NOT NULL,
        from_type TEXT NOT NULL,
        from_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        to_type TEXT NOT NULL,
        to_id TEXT NOT NULL,
        label TEXT,
        data_json TEXT NOT NULL,
        PRIMARY KEY (region, from_type, from_id, relation, to_type, to_id, label)
      );

      CREATE INDEX IF NOT EXISTS idx_relations_from
        ON relations(region, from_type, from_id, relation);
      CREATE INDEX IF NOT EXISTS idx_relations_to
        ON relations(region, to_type, to_id, relation);

      CREATE TABLE IF NOT EXISTS resources (
        region TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        url TEXT NOT NULL,
        source_region TEXT,
        data_json TEXT NOT NULL,
        PRIMARY KEY (region, owner_type, owner_id, asset_type, url)
      );

      CREATE INDEX IF NOT EXISTS idx_resources_owner
        ON resources(region, owner_type, owner_id);

      CREATE TABLE IF NOT EXISTS servant_traits (
        region TEXT NOT NULL,
        servant_id TEXT NOT NULL,
        collection_no INTEGER,
        servant_name TEXT NOT NULL,
        class_name TEXT,
        rarity INTEGER,
        trait TEXT NOT NULL,
        trait_id TEXT,
        source_url TEXT NOT NULL,
        PRIMARY KEY (region, servant_id, trait)
      );

      CREATE INDEX IF NOT EXISTS idx_servant_traits_trait
        ON servant_traits(region, trait);

      CREATE TABLE IF NOT EXISTS effect_matches (
        region TEXT NOT NULL,
        servant_id TEXT NOT NULL,
        collection_no INTEGER,
        servant_name TEXT NOT NULL,
        class_name TEXT,
        rarity INTEGER,
        source_type TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_id TEXT,
        buff_type TEXT NOT NULL,
        buff_name TEXT NOT NULL,
        detail TEXT,
        target TEXT,
        duration TEXT,
        source_url TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_effect_matches_type
        ON effect_matches(region, buff_type);
      CREATE INDEX IF NOT EXISTS idx_effect_matches_servant
        ON effect_matches(region, servant_id);

      CREATE TABLE IF NOT EXISTS banners (
        id TEXT PRIMARY KEY,
        region TEXT NOT NULL,
        title TEXT NOT NULL,
        start_at TEXT,
        end_at TEXT,
        pickup_servants_json TEXT NOT NULL,
        pickup_ces_json TEXT NOT NULL,
        confidence TEXT NOT NULL,
        source TEXT NOT NULL,
        source_url TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_banners_region_start
        ON banners(region, start_at);

      CREATE TABLE IF NOT EXISTS quest_index (
        region TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        phase INTEGER NOT NULL,
        name TEXT NOT NULL,
        spot_name TEXT,
        war_id TEXT,
        war_name TEXT,
        quest_type TEXT,
        consume_type TEXT,
        consume INTEGER,
        bond INTEGER,
        exp INTEGER,
        opened_at TEXT,
        closed_at TEXT,
        source_url TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (region, quest_id, phase)
      );

      CREATE INDEX IF NOT EXISTS idx_quest_index_bond
        ON quest_index(region, quest_type, bond);
    `);
    this.ensureSourceHttpCacheColumns();
  }

  private ensureSourceHttpCacheColumns(): void {
    const columns = new Set(
      (this.db.prepare(`PRAGMA table_info(sources)`).all() as Row[]).map((row) => String(row.name)),
    );
    if (!columns.has("etag")) {
      this.db.exec(`ALTER TABLE sources ADD COLUMN etag TEXT`);
    }
    if (!columns.has("last_modified")) {
      this.db.exec(`ALTER TABLE sources ADD COLUMN last_modified TEXT`);
    }
  }

  setMetadata(key: string, value: unknown, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO metadata(key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, stringifyJson(value), updatedAt);
  }

  getMetadata<T = unknown>(key: string, fallback?: T): T | undefined {
    const row = this.db.prepare(`SELECT value FROM metadata WHERE key = ?`).get(key) as Row | undefined;
    if (!row) return fallback;
    return parseJson(String(row.value), fallback as T);
  }

  upsertSource(input: {
    id: string;
    region?: Region;
    source: string;
    kind: string;
    url: string;
    hash?: string;
    etag?: string;
    lastModified?: string;
    fetchedAt: string;
    status: string;
    error?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sources(id, region, source, kind, url, hash, etag, last_modified, fetched_at, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           region = excluded.region,
           source = excluded.source,
           kind = excluded.kind,
           url = excluded.url,
           hash = excluded.hash,
           etag = excluded.etag,
           last_modified = excluded.last_modified,
           fetched_at = excluded.fetched_at,
           status = excluded.status,
           error = excluded.error`,
      )
      .run(
        input.id,
        input.region ?? null,
        input.source,
        input.kind,
        input.url,
        input.hash ?? null,
        input.etag ?? null,
        input.lastModified ?? null,
        input.fetchedAt,
        input.status,
        input.error ?? null,
      );
  }

  getSource(id: string): Record<string, unknown> | undefined {
    return this.db.prepare(`SELECT * FROM sources WHERE id = ?`).get(id) as Row | undefined;
  }

  upsertEntity(record: EntityRecord, options: { ftsAlreadyCleared?: boolean } = {}): void {
    const aliasesJson = stringifyJson(record.aliases);
    const rawJson = stringifyJson(record.rawJson);
    this.db
      .prepare(
        `INSERT INTO entities(
          region, entity_type, entity_id, collection_no, name, original_name,
          aliases_json, summary, raw_json, source_url, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(region, entity_type, entity_id) DO UPDATE SET
          collection_no = excluded.collection_no,
          name = excluded.name,
          original_name = excluded.original_name,
          aliases_json = excluded.aliases_json,
          summary = excluded.summary,
          raw_json = excluded.raw_json,
          source_url = excluded.source_url,
          updated_at = excluded.updated_at`,
      )
      .run(
        record.region,
        record.entityType,
        record.entityId,
        record.collectionNo ?? null,
        record.name,
        record.originalName ?? null,
        aliasesJson,
        record.summary,
        rawJson,
        record.sourceUrl,
        record.updatedAt,
      );

    if (!options.ftsAlreadyCleared) {
      this.db
        .prepare(`DELETE FROM entity_fts WHERE region = ? AND entity_type = ? AND entity_id = ?`)
        .run(record.region, record.entityType, record.entityId);
    }
    this.db
      .prepare(
        `INSERT INTO entity_fts(region, entity_type, entity_id, name, aliases, summary, raw_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.region,
        record.entityType,
        record.entityId,
        record.name,
        record.aliases.join(" "),
        record.summary,
        collectStrings(record.rawJson, 40_000),
      );
  }

  clearEntityType(region: Region, entityType: string): void {
    this.db.prepare(`DELETE FROM entity_fts WHERE region = ? AND entity_type = ?`).run(region, entityType);
    this.db.prepare(`DELETE FROM resources WHERE region = ? AND owner_type = ?`).run(region, entityType);
    this.db.prepare(`DELETE FROM relations WHERE region = ? AND from_type = ?`).run(region, entityType);
    if (entityType === "servant") {
      this.db.prepare(`DELETE FROM servant_traits WHERE region = ?`).run(region);
      this.db.prepare(`DELETE FROM effect_matches WHERE region = ?`).run(region);
    }
    this.db.prepare(`DELETE FROM entities WHERE region = ? AND entity_type = ?`).run(region, entityType);
  }

  clearDerivedForEntity(region: Region, entityType: string, entityId: string): void {
    this.db
      .prepare(`DELETE FROM resources WHERE region = ? AND owner_type = ? AND owner_id = ?`)
      .run(region, entityType, entityId);
    this.db
      .prepare(`DELETE FROM relations WHERE region = ? AND from_type = ? AND from_id = ?`)
      .run(region, entityType, entityId);
    if (entityType === "servant") {
      this.db.prepare(`DELETE FROM servant_traits WHERE region = ? AND servant_id = ?`).run(region, entityId);
      this.db.prepare(`DELETE FROM effect_matches WHERE region = ? AND servant_id = ?`).run(region, entityId);
    }
  }

  insertResource(input: {
    region: Region;
    ownerType: string;
    ownerId: string;
    assetType: string;
    url: string;
    sourceRegion?: Region;
    data?: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO resources(
          region, owner_type, owner_id, asset_type, url, source_region, data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.region,
        input.ownerType,
        input.ownerId,
        input.assetType,
        input.url,
        input.sourceRegion ?? input.region,
        stringifyJson(input.data ?? {}),
      );
  }

  insertRelation(input: {
    region: Region;
    fromType: string;
    fromId: string;
    relation: string;
    toType: string;
    toId: string;
    label?: string;
    data?: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO relations(
          region, from_type, from_id, relation, to_type, to_id, label, data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.region,
        input.fromType,
        input.fromId,
        input.relation,
        input.toType,
        input.toId,
        input.label ?? "",
        stringifyJson(input.data ?? {}),
      );
  }

  insertServantTrait(input: {
    region: Region;
    servantId: string;
    collectionNo?: number | null;
    servantName: string;
    className?: string;
    rarity?: number;
    trait: string;
    traitId?: string;
    sourceUrl: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO servant_traits(
          region, servant_id, collection_no, servant_name, class_name, rarity,
          trait, trait_id, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.region,
        input.servantId,
        input.collectionNo ?? null,
        input.servantName,
        input.className ?? null,
        input.rarity ?? null,
        input.trait,
        input.traitId ?? null,
        input.sourceUrl,
      );
  }

  insertEffectMatch(input: {
    region: Region;
    servantId: string;
    collectionNo?: number | null;
    servantName: string;
    className?: string;
    rarity?: number;
    sourceType: string;
    sourceName: string;
    sourceId?: string;
    buffType: string;
    buffName: string;
    detail?: string;
    target?: string;
    duration?: string;
    sourceUrl: string;
    data?: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO effect_matches(
          region, servant_id, collection_no, servant_name, class_name, rarity,
          source_type, source_name, source_id, buff_type, buff_name, detail,
          target, duration, source_url, data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.region,
        input.servantId,
        input.collectionNo ?? null,
        input.servantName,
        input.className ?? null,
        input.rarity ?? null,
        input.sourceType,
        input.sourceName,
        input.sourceId ?? null,
        input.buffType,
        input.buffName,
        input.detail ?? null,
        input.target ?? null,
        input.duration ?? null,
        input.sourceUrl,
        stringifyJson(input.data ?? {}),
      );
  }

  upsertBanner(input: {
    id: string;
    region: Region;
    title: string;
    startAt?: string;
    endAt?: string;
    pickupServants: string[];
    pickupCEs: string[];
    confidence: BannerResult["confidence"];
    source: string;
    sourceUrl: string;
    rawJson: unknown;
    updatedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO banners(
          id, region, title, start_at, end_at, pickup_servants_json, pickup_ces_json,
          confidence, source, source_url, raw_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          region = excluded.region,
          title = excluded.title,
          start_at = excluded.start_at,
          end_at = excluded.end_at,
          pickup_servants_json = excluded.pickup_servants_json,
          pickup_ces_json = excluded.pickup_ces_json,
          confidence = excluded.confidence,
          source = excluded.source,
          source_url = excluded.source_url,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.id,
        input.region,
        input.title,
        input.startAt ?? null,
        input.endAt ?? null,
        stringifyJson(input.pickupServants),
        stringifyJson(input.pickupCEs),
        input.confidence,
        input.source,
        input.sourceUrl,
        stringifyJson(input.rawJson),
        input.updatedAt,
      );
  }

  clearQuestIndex(region: Region): void {
    this.db.prepare(`DELETE FROM quest_index WHERE region = ?`).run(region);
  }

  upsertQuestIndex(input: {
    region: Region;
    questId: string;
    phase: number;
    name: string;
    spotName?: string;
    warId?: string;
    warName?: string;
    questType?: string;
    consumeType?: string;
    consume?: number;
    bond?: number;
    exp?: number;
    openedAt?: string;
    closedAt?: string;
    sourceUrl: string;
    rawJson: unknown;
    updatedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO quest_index(
          region, quest_id, phase, name, spot_name, war_id, war_name,
          quest_type, consume_type, consume, bond, exp, opened_at, closed_at,
          source_url, raw_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(region, quest_id, phase) DO UPDATE SET
          name = excluded.name,
          spot_name = excluded.spot_name,
          war_id = excluded.war_id,
          war_name = excluded.war_name,
          quest_type = excluded.quest_type,
          consume_type = excluded.consume_type,
          consume = excluded.consume,
          bond = excluded.bond,
          exp = excluded.exp,
          opened_at = excluded.opened_at,
          closed_at = excluded.closed_at,
          source_url = excluded.source_url,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.region,
        input.questId,
        input.phase,
        input.name,
        input.spotName ?? null,
        input.warId ?? null,
        input.warName ?? null,
        input.questType ?? null,
        input.consumeType ?? null,
        input.consume ?? null,
        input.bond ?? null,
        input.exp ?? null,
        input.openedAt ?? null,
        input.closedAt ?? null,
        input.sourceUrl,
        stringifyJson(input.rawJson),
        input.updatedAt,
      );
  }

  listEntityTypes(region?: Region): Array<{ entityType: string; count: number }> {
    const rows = region
      ? this.db
          .prepare(
            `SELECT entity_type AS entityType, COUNT(*) AS count
             FROM entities WHERE region = ? GROUP BY entity_type ORDER BY entity_type`,
          )
          .all(region)
      : this.db
          .prepare(
            `SELECT entity_type AS entityType, COUNT(*) AS count
             FROM entities GROUP BY entity_type ORDER BY entity_type`,
          )
          .all();
    return rows.map((row) => ({
      entityType: String((row as Row).entityType),
      count: Number((row as Row).count),
    }));
  }

  countEntities(region?: Region): number {
    return this.countRows("entities", region);
  }

  countResources(region?: Region): number {
    return this.countRows("resources", region);
  }

  countBanners(region?: Region): number {
    return this.countRows("banners", region);
  }

  countQuestIndex(region?: Region): number {
    return this.countRows("quest_index", region);
  }

  private countRows(table: "entities" | "resources" | "banners" | "quest_index", region?: Region): number {
    const row = region
      ? (this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE region = ?`).get(region) as Row | undefined)
      : (this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row | undefined);
    return Number(row?.count ?? 0);
  }

  searchEntities(query: string, options: SearchOptions = {}): EntityResult[] {
    const limit = options.limit ?? 20;
    const exactRows = this.searchEntitiesLike(query, options, limit);
    const ftsRows = this.searchEntitiesFts(query, options, limit);
    const merged = new Map<string, Row>();
    for (const row of [...exactRows, ...ftsRows]) {
      merged.set(`${row.region}:${row.entity_type}:${row.entity_id}`, row);
      if (merged.size >= limit) break;
    }
    return [...merged.values()].map((row) => this.rowToEntityResult(row));
  }

  private searchEntitiesLike(query: string, options: SearchOptions, limit: number): Row[] {
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (options.region) {
      where.push("region = ?");
      params.push(options.region);
    }
    if (options.entityType) {
      where.push("entity_type = ?");
      params.push(options.entityType);
    }
    const like = `%${query}%`;
    where.push("(name LIKE ? OR aliases_json LIKE ? OR summary LIKE ? OR raw_json LIKE ?)");
    params.push(like, like, like, like);
    params.push(limit);
    return this.db
      .prepare(`SELECT * FROM entities WHERE ${where.join(" AND ")} ORDER BY name LIMIT ?`)
      .all(...params) as Row[];
  }

  private searchEntitiesFts(query: string, options: SearchOptions, limit: number): Row[] {
    const ftsQuery = query
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(" ");
    if (!ftsQuery) return [];
    const where: string[] = ["f.entity_fts MATCH ?"];
    const params: Array<string | number | null> = [ftsQuery];
    if (options.region) {
      where.push("f.region = ?");
      params.push(options.region);
    }
    if (options.entityType) {
      where.push("f.entity_type = ?");
      params.push(options.entityType);
    }
    params.push(limit);
    try {
      return this.db
        .prepare(
          `SELECT e.*
           FROM entity_fts f
           JOIN entities e
             ON e.region = f.region AND e.entity_type = f.entity_type AND e.entity_id = f.entity_id
           WHERE ${where.join(" AND ")}
           LIMIT ?`,
        )
        .all(...params) as Row[];
    } catch {
      return [];
    }
  }

  getEntity(region: Region, entityType: string, idOrName: string): { result: EntityResult; rawJson: unknown } | undefined {
    const numeric = Number(idOrName);
    const row = this.db
      .prepare(
        `SELECT * FROM entities
         WHERE region = ?
           AND entity_type = ?
           AND (
             entity_id = ?
             OR collection_no = ?
             OR name = ?
             OR aliases_json LIKE ?
           )
         ORDER BY CASE WHEN entity_id = ? THEN 0 WHEN collection_no = ? THEN 1 WHEN name = ? THEN 2 ELSE 3 END
         LIMIT 1`,
      )
      .get(
        region,
        entityType,
        idOrName,
        Number.isFinite(numeric) ? numeric : -1,
        idOrName,
        `%${idOrName}%`,
        idOrName,
        Number.isFinite(numeric) ? numeric : -1,
        idOrName,
      ) as Row | undefined;
    if (!row) return undefined;
    return {
      result: this.rowToEntityResult(row),
      rawJson: parseJson(String(row.raw_json), {}),
    };
  }

  queryEntities(input: {
    region?: Region;
    entityType?: string;
    className?: string;
    rarity?: number;
    limit?: number;
  }): EntityResult[] {
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (input.region) {
      where.push("region = ?");
      params.push(input.region);
    }
    if (input.entityType) {
      where.push("entity_type = ?");
      params.push(input.entityType);
    }
    if (input.className) {
      where.push("raw_json LIKE ?");
      params.push(`%"className":"${input.className}"%`);
    }
    if (input.rarity != null) {
      where.push("raw_json LIKE ?");
      params.push(`%"rarity":${input.rarity}%`);
    }
    params.push(input.limit ?? 50);
    const sql = `SELECT * FROM entities ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY name LIMIT ?`;
    return (this.db.prepare(sql).all(...params) as Row[]).map((row) => this.rowToEntityResult(row));
  }

  listServantsByTrait(region: Region, traits: string[], limit = 200): ServantResult[] {
    if (traits.length === 0) return [];
    const placeholders = traits.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT
           servant_id,
           collection_no,
           servant_name,
           class_name,
           rarity,
           GROUP_CONCAT(DISTINCT trait) AS matched,
           (SELECT GROUP_CONCAT(DISTINCT trait) FROM servant_traits all_traits
             WHERE all_traits.region = st.region AND all_traits.servant_id = st.servant_id) AS all_traits,
           MIN(source_url) AS source_url
         FROM servant_traits st
         WHERE region = ?
           AND trait IN (${placeholders})
           AND (collection_no IS NULL OR collection_no > 0)
         GROUP BY servant_id, collection_no, servant_name, class_name, rarity
         HAVING COUNT(DISTINCT trait) >= ?
         ORDER BY rarity DESC, collection_no
         LIMIT ?`,
      )
      .all(region, ...traits, traits.length, limit) as Row[];

    return rows.map((row) => ({
      region,
      servantId: String(row.servant_id),
      collectionNo: row.collection_no == null ? null : Number(row.collection_no),
      name: String(row.servant_name),
      className: row.class_name == null ? undefined : String(row.class_name),
      rarity: row.rarity == null ? undefined : Number(row.rarity),
      traits: String(row.all_traits ?? "")
        .split(",")
        .filter(Boolean),
      matchedTerms: String(row.matched ?? "")
        .split(",")
        .filter(Boolean),
      sourceRefs: [{ source: "atlas", region, url: String(row.source_url) }],
    }));
  }

  listServantsByEffect(region: Region, terms: string[], limit = 200): EffectMatch[] {
    if (terms.length === 0) return [];
    const whereParts = terms.map(() => "(buff_type = ? OR buff_name LIKE ? OR detail LIKE ? OR source_name LIKE ?)");
    const params: Array<string | number | null> = [region];
    for (const term of terms) {
      params.push(term, `%${term}%`, `%${term}%`, `%${term}%`);
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM effect_matches
         WHERE region = ?
           AND (collection_no IS NULL OR collection_no > 0)
           AND (${whereParts.join(" OR ")})
         ORDER BY collection_no, source_type, source_name
         LIMIT ?`,
      )
      .all(...params) as Row[];

    return rows.map((row) => ({
      region,
      servant: {
        servantId: String(row.servant_id),
        collectionNo: row.collection_no == null ? null : Number(row.collection_no),
        name: String(row.servant_name),
        className: row.class_name == null ? undefined : String(row.class_name),
        rarity: row.rarity == null ? undefined : Number(row.rarity),
      },
      sourceType: String(row.source_type),
      sourceName: String(row.source_name),
      sourceId: row.source_id == null ? undefined : String(row.source_id),
      buffType: String(row.buff_type),
      buffName: String(row.buff_name),
      detail: row.detail == null ? undefined : String(row.detail),
      target: row.target == null ? undefined : String(row.target),
      duration: row.duration == null ? undefined : String(row.duration),
      sourceRefs: [{ source: "atlas", region, url: String(row.source_url) }],
    }));
  }

  upcomingBanners(region: Region, limit = 10, after = new Date()): BannerResult[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM banners
         WHERE region = ? AND (start_at IS NULL OR start_at >= ?)
         ORDER BY start_at IS NULL, start_at
         LIMIT ?`,
      )
      .all(region, after.toISOString(), limit) as Row[];
    return rows.map((row) => this.rowToBannerResult(row));
  }

  topBondQuests(region: Region, limit = 5, now = new Date()): QuestBondResult[] {
    const nowIso = now.toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM quest_index
         WHERE region = ?
           AND quest_type = 'free'
           AND bond IS NOT NULL
           AND (opened_at IS NULL OR opened_at <= ?)
           AND (closed_at IS NULL OR closed_at >= ?)
         ORDER BY bond DESC, consume DESC, war_id, spot_name, name
         LIMIT ?`,
      )
      .all(region, nowIso, nowIso, limit) as Row[];
    return rows.map((row) => ({
      region,
      questId: String(row.quest_id),
      phase: Number(row.phase),
      name: String(row.name),
      spotName: row.spot_name == null ? undefined : String(row.spot_name),
      warId: row.war_id == null ? undefined : String(row.war_id),
      warName: row.war_name == null ? undefined : String(row.war_name),
      questType: row.quest_type == null ? undefined : String(row.quest_type),
      consumeType: row.consume_type == null ? undefined : String(row.consume_type),
      consume: row.consume == null ? undefined : Number(row.consume),
      bond: Number(row.bond),
      exp: row.exp == null ? undefined : Number(row.exp),
      openedAt: row.opened_at == null ? undefined : String(row.opened_at),
      closedAt: row.closed_at == null ? undefined : String(row.closed_at),
      sourceUrl: String(row.source_url),
      sourceRefs: [{ source: "atlas", region, url: String(row.source_url) }],
    }));
  }

  getQuestIndex(region: Region, questId: string, phase?: number): QuestBondResult | undefined {
    const row =
      phase == null
        ? (this.db
            .prepare(
              `SELECT * FROM quest_index
               WHERE region = ? AND quest_id = ?
               ORDER BY phase DESC
               LIMIT 1`,
            )
            .get(region, questId) as Row | undefined)
        : (this.db
            .prepare(
              `SELECT * FROM quest_index
               WHERE region = ? AND quest_id = ? AND phase = ?
               LIMIT 1`,
            )
            .get(region, questId, phase) as Row | undefined);
    return row ? this.rowToQuestBondResult(region, row) : undefined;
  }

  questIndexAudit(region: Region): QuestIndexAudit | undefined {
    return this.getMetadata<QuestIndexAudit>(`quest_index.audit.${region}`);
  }

  getResources(region: Region, ownerType: string, ownerId: string, limit = 200): ResourceLink[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM resources
         WHERE region = ? AND owner_type = ? AND owner_id = ?
         ORDER BY asset_type, url
         LIMIT ?`,
      )
      .all(region, ownerType, ownerId, limit) as Row[];
    return rows.map((row) => ({
      region,
      ownerType: String(row.owner_type),
      ownerId: String(row.owner_id),
      assetType: String(row.asset_type),
      url: String(row.url),
      sourceRegion: row.source_region == null ? undefined : (String(row.source_region) as Region),
      sourceRefs: [{ source: "atlas", region }],
    }));
  }

  getRelated(region: Region, ownerType: string, ownerId: string, relation?: string, limit = 200): Row[] {
    const rows = relation
      ? this.db
          .prepare(
            `SELECT * FROM relations
             WHERE region = ? AND from_type = ? AND from_id = ? AND relation = ?
             ORDER BY relation, label
             LIMIT ?`,
          )
          .all(region, ownerType, ownerId, relation, limit)
      : this.db
          .prepare(
            `SELECT * FROM relations
             WHERE region = ? AND from_type = ? AND from_id = ?
             ORDER BY relation, label
             LIMIT ?`,
          )
          .all(region, ownerType, ownerId, limit);
    return rows as Row[];
  }

  sourceStatus(limit = 50): Row[] {
    return this.db
      .prepare(`SELECT * FROM sources ORDER BY fetched_at DESC LIMIT ?`)
      .all(limit) as Row[];
  }

  private rowToEntityResult(row: Row): EntityResult {
    const region = String(row.region) as Region;
    return {
      region,
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      collectionNo: row.collection_no == null ? null : Number(row.collection_no),
      name: String(row.name),
      aliases: parseJson(String(row.aliases_json), [] as string[]),
      summary: String(row.summary),
      sourceRefs: [{ source: sourceFromUrl(String(row.source_url)), region, url: String(row.source_url) }],
    };
  }

  private rowToBannerResult(row: Row): BannerResult {
    const region = String(row.region) as Region;
    return {
      region,
      title: String(row.title),
      startAt: row.start_at == null ? undefined : String(row.start_at),
      endAt: row.end_at == null ? undefined : String(row.end_at),
      pickupServants: parseJson(String(row.pickup_servants_json), [] as string[]),
      pickupCEs: parseJson(String(row.pickup_ces_json), [] as string[]),
      confidence: String(row.confidence) as BannerResult["confidence"],
      sourceUrl: String(row.source_url),
      sourceRefs: [{ source: sourceFromUrl(String(row.source_url)), region, url: String(row.source_url) }],
    };
  }

  private rowToQuestBondResult(region: Region, row: Row): QuestBondResult {
    return {
      region,
      questId: String(row.quest_id),
      phase: Number(row.phase),
      name: String(row.name),
      spotName: row.spot_name == null ? undefined : String(row.spot_name),
      warId: row.war_id == null ? undefined : String(row.war_id),
      warName: row.war_name == null ? undefined : String(row.war_name),
      questType: row.quest_type == null ? undefined : String(row.quest_type),
      consumeType: row.consume_type == null ? undefined : String(row.consume_type),
      consume: row.consume == null ? undefined : Number(row.consume),
      bond: Number(row.bond),
      exp: row.exp == null ? undefined : Number(row.exp),
      openedAt: row.opened_at == null ? undefined : String(row.opened_at),
      closedAt: row.closed_at == null ? undefined : String(row.closed_at),
      sourceUrl: String(row.source_url),
      sourceRefs: [{ source: "atlas", region, url: String(row.source_url) }],
    };
  }
}

function sourceFromUrl(url: string): SourceRef["source"] {
  if (url.includes("fgo.wiki")) return "mooncell";
  if (url.includes("atlasacademy")) return "atlas";
  return "local";
}
