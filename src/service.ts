import { resolveDbPath } from "./config.js";
import { FgoDatabase } from "./db.js";
import {
  describeTerm,
  extractEffectTermGroups,
  extractTraitTerms,
  resolveEffectTerms,
  resolveTraitTerms,
} from "./semantic.js";
import type { DoctorCheck, DoctorReport, EffectMatch, Region, SearchOptions, ServantResult } from "./types.js";
import { getByPath, normalizeRegion, uniqueStrings } from "./utils.js";
import { VERSION } from "./version.js";

export interface AskServantResult {
  region: Region;
  servantId: string;
  collectionNo?: number | null;
  name: string;
  className?: string;
  rarity?: number;
  matchedTraits: string[];
  matchedEffects: Array<{
    condition: string;
    sourceType: string;
    sourceName: string;
    buffName: string;
    buffType: string;
    detail?: string;
  }>;
}

export interface AskResponse {
  question: string;
  region: Region;
  intent: "servant_filter" | "banners" | "quest_bond" | "search";
  interpreted: Record<string, unknown>;
  answer: string;
  results: unknown[];
}

export class FgoService {
  readonly db: FgoDatabase;

  constructor(dataDir?: string) {
    this.db = new FgoDatabase(resolveDbPath(dataDir));
  }

  close(): void {
    this.db.close();
  }

  search(query: string, options: SearchOptions = {}) {
    return this.db.searchEntities(query, options);
  }

  getEntity(region: Region, entityType: string, idOrName: string) {
    return this.db.getEntity(region, entityType, idOrName);
  }

  queryEntities(input: {
    region?: Region;
    entityType?: string;
    trait?: string | string[];
    effect?: string | string[];
    className?: string;
    rarity?: number;
    limit?: number;
  }) {
    const region = input.region ?? "CN";
    if (input.trait) {
      return this.db.listServantsByTrait(region, resolveTraitTerms(input.trait), input.limit);
    }
    if (input.effect) {
      return this.db.listServantsByEffect(region, resolveEffectTerms(input.effect), input.limit);
    }
    return this.db.queryEntities({
      region: input.region,
      entityType: input.entityType,
      className: input.className,
      rarity: input.rarity,
      limit: input.limit,
    });
  }

  listServantsByTrait(region: Region, trait: string | string[], limit?: number) {
    return this.db.listServantsByTrait(region, resolveTraitTerms(trait), limit);
  }

  listServantsByEffect(region: Region, effect: string | string[], limit?: number) {
    return this.db.listServantsByEffect(region, resolveEffectTerms(effect), limit);
  }

  upcomingBanners(region: Region, limit?: number) {
    return this.db.upcomingBanners(region, limit);
  }

  topBondQuests(region: Region, limit?: number) {
    return this.db.topBondQuests(region, limit);
  }

  listEntityTypes(region?: Region) {
    return this.db.listEntityTypes(region);
  }

  queryJson(input: { region?: Region; entityType: string; id: string; path?: string }) {
    const region = input.region ?? normalizeRegion(undefined);
    const entity = this.db.getEntity(region, input.entityType, input.id);
    if (!entity) return undefined;
    return {
      entity: entity.result,
      value: getByPath(entity.rawJson, input.path),
    };
  }

  resources(region: Region, ownerType: string, ownerId: string, limit?: number) {
    const entity = this.db.getEntity(region, ownerType, ownerId);
    const id = entity?.result.entityId ?? ownerId;
    return this.db.getResources(region, ownerType, id, limit);
  }

  related(region: Region, ownerType: string, ownerId: string, relation?: string, limit?: number) {
    const entity = this.db.getEntity(region, ownerType, ownerId);
    const id = entity?.result.entityId ?? ownerId;
    return this.db.getRelated(region, ownerType, id, relation, limit);
  }

  sourceStatus(limit?: number) {
    return this.db.sourceStatus(limit);
  }

  version() {
    return {
      name: "fgo-agent",
      version: VERSION,
      dbPath: this.db.dbPath,
    };
  }

  doctor(region: Region = "CN"): DoctorReport {
    const checks: DoctorCheck[] = [];
    const entityTypes = this.listEntityTypes(region);
    const typeCounts = new Map(entityTypes.map((item) => [item.entityType, item.count]));
    const servantCount = typeCounts.get("servant") ?? 0;
    checks.push({
      id: "servant_entities",
      ok: servantCount > 0,
      severity: "error",
      message: servantCount > 0 ? `已索引 ${servantCount} 个从者实体。` : "没有索引到从者实体，请先运行 fgo sync。",
      detail: { count: servantCount },
    });

    const questAudit = this.db.questIndexAudit(region);
    checks.push({
      id: "quest_index_audit",
      ok: questAudit != null,
      severity: "error",
      message: questAudit ? `已找到 ${region} 关卡索引审计。` : "没有找到关卡索引审计，请重新运行 fgo sync。",
      detail: questAudit,
    });
    if (questAudit) {
      checks.push({
        id: "quest_index_failures",
        ok: questAudit.failedQuestDetails === 0,
        severity: "warning",
        message:
          questAudit.failedQuestDetails === 0
            ? "关卡 phase 详情抓取没有失败项。"
            : `有 ${questAudit.failedQuestDetails} 个关卡 phase 详情抓取失败，需要看源站或网络状态。`,
        detail: { failedQuestDetails: questAudit.failedQuestDetails },
      });
      checks.push({
        id: "quest_consume_types_visible",
        ok: questAudit.unknownConsumeTypes.length === 0,
        severity: "warning",
        message:
          questAudit.unknownConsumeTypes.length === 0
            ? "关卡索引未发现未知 consumeType。"
            : `发现未知 consumeType：${questAudit.unknownConsumeTypes.join("、")}，已纳入索引但需要人工确认语义。`,
        detail: { consumeTypes: questAudit.consumeTypes, unknownConsumeTypes: questAudit.unknownConsumeTypes },
      });
    }

    const topBondQuests = this.topBondQuests(region, 5);
    checks.push({
      id: "top_bond_quests",
      ok: topBondQuests.length > 0,
      severity: "error",
      message: topBondQuests.length > 0 ? `常驻自由本羁绊榜可用，返回 ${topBondQuests.length} 条。` : "常驻自由本羁绊榜为空。",
      detail: topBondQuests.slice(0, 3),
    });

    if (region === "CN") {
      const moonlight = this.db.getQuestIndex("CN", "94137202", 1);
      checks.push({
        id: "golden_moonlight_mine",
        ok: moonlight?.bond === 3797 && moonlight.consumeType === "apAndItem",
        severity: "error",
        message:
          moonlight?.bond === 3797 && moonlight.consumeType === "apAndItem"
            ? "金样通过：月光矿区为 3797 羁绊，且 apAndItem 白纸本已进入索引。"
            : "金样失败：月光矿区没有按 3797 羁绊/apAndItem 被索引，常驻本羁绊榜可能漏白纸本。",
        detail: moonlight ?? null,
      });
    }

    return {
      version: VERSION,
      dbPath: this.db.dbPath,
      region,
      ok: checks.every((check) => check.ok || check.severity !== "error"),
      checks,
      questAudit,
      topBondQuests,
    };
  }

  ask(question: string, input: { region?: Region; limit?: number } = {}): AskResponse {
    const region = input.region ?? "CN";
    const limit = input.limit ?? 20;
    const trimmed = question.trim();
    if (/卡池|up|UP|召唤|召喚|未来|未來/.test(trimmed)) {
      const results = this.upcomingBanners(region, limit);
      const note = region === "CN" ? "国服未来卡池来自 Mooncell 未来视，属于非官方预测。" : "日服只返回已入库或已公开数据。";
      return {
        question: trimmed,
        region,
        intent: "banners",
        interpreted: { region, limit },
        answer: results.length
          ? `${note}\n${results.map((item, index) => `${index + 1}. ${item.title}${item.startAt ? `，${item.startAt}` : ""}${item.pickupServants.length ? `，UP：${item.pickupServants.slice(0, 8).join("、")}` : ""}`).join("\n")}`
          : `${note}\n没有查到符合条件的卡池。`,
        results,
      };
    }

    if (/(羁绊|牵绊|絆|bond)/i.test(trimmed) && /(常驻|常駐|free|自由|周回|本)/i.test(trimmed) && /(最高|最多|排行|前|top)/i.test(trimmed)) {
      const results = this.topBondQuests(region, limit);
      return {
        question: trimmed,
        region,
        intent: "quest_bond",
        interpreted: { region, limit, metric: "bond_per_clear", questType: "free" },
        answer: results.length
          ? `按单次通关羁绊值排序，查到最高的 ${results.length} 个常驻自由本：\n${results
              .map((item, index) => {
                const place = [item.warName, item.spotName].filter(Boolean).join(" / ");
                const cost =
                  item.consume == null
                    ? ""
                    : item.consumeType === "apAndItem"
                      ? `，${item.consume}AP+道具`
                      : item.consumeType === "ap" || item.consumeType == null
                        ? `，${item.consume}AP`
                        : `，消耗 ${item.consume}（${item.consumeType}）`;
                return `${index + 1}. ${item.name}${place ? `（${place}）` : ""}: ${item.bond} 羁绊${cost}`;
              })
              .join("\n")}`
          : "没有查到常驻自由本的羁绊索引。请先运行最新版 fgo sync 同步 quest phase 详情。",
        results,
      };
    }

    const traitTerms = extractTraitTerms(trimmed);
    const effectGroups = extractEffectTermGroups(trimmed);
    if (/从者|英灵|英靈|servant/i.test(trimmed) || traitTerms.length > 0 || effectGroups.length > 0) {
      return this.askServants(trimmed, region, traitTerms, effectGroups, limit);
    }

    const results = this.search(trimmed, { region, limit });
    return {
      question: trimmed,
      region,
      intent: "search",
      interpreted: { query: trimmed, region, limit },
      answer: results.length
        ? `找到 ${results.length} 条相关数据：${results.slice(0, 5).map((item) => `${item.entityType}:${item.name}`).join("、")}`
        : "没有查到相关数据。请先确认已运行 fgo sync，或换一个更具体的名称/术语。",
      results,
    };
  }

  private askServants(
    question: string,
    region: Region,
    traitTerms: string[],
    effectGroups: string[][],
    limit: number,
  ): AskResponse {
    const traitResults = traitTerms.length > 0 ? this.db.listServantsByTrait(region, traitTerms, 5000) : [];
    const effectLookupGroups = effectGroups.map((group) => (group[0] ? [group[0]] : group));
    const effectMatchesByGroup = effectLookupGroups.map((group) => this.db.listServantsByEffect(region, group, 5000));
    const candidates = new Map<string, AskServantResult>();

    if (traitTerms.length > 0) {
      for (const servant of traitResults) {
        candidates.set(servant.servantId, servantToAskResult(servant));
      }
    } else if (effectMatchesByGroup[0]) {
      for (const match of effectMatchesByGroup[0]) {
        candidates.set(match.servant.servantId, effectToAskResult(match));
      }
    }

    if (traitTerms.length === 0 && effectGroups.length === 0) {
      const results = this.search(question, { region, entityType: "servant", limit });
      return {
        question,
        region,
        intent: "servant_filter",
        interpreted: { region, fallbackSearch: true },
        answer: results.length ? `没有识别出明确过滤条件，先按从者全文搜索返回 ${results.length} 条。` : "没有识别出明确过滤条件，也没有搜到相关从者。",
        results,
      };
    }

    for (let groupIndex = 0; groupIndex < effectGroups.length; groupIndex += 1) {
      const group = effectGroups[groupIndex] ?? [];
      const matches = effectMatchesByGroup[groupIndex] ?? [];
      const grouped = new Map<string, EffectMatch[]>();
      for (const match of matches) {
        const existing = grouped.get(match.servant.servantId) ?? [];
        existing.push(match);
        grouped.set(match.servant.servantId, existing);
      }
      for (const id of [...candidates.keys()]) {
        const servantMatches = grouped.get(id);
        if (!servantMatches?.length) {
          candidates.delete(id);
          continue;
        }
        const candidate = candidates.get(id);
        if (!candidate) continue;
        candidate.matchedEffects.push(...effectSummaries(group, servantMatches));
      }
    }

    const results = [...candidates.values()]
      .sort((a, b) => (b.rarity ?? 0) - (a.rarity ?? 0) || (a.collectionNo ?? 99999) - (b.collectionNo ?? 99999))
      .slice(0, limit);
    const conditions = [
      ...traitTerms.map(describeTerm),
      ...effectGroups.map((group) => describeTerm(group[0] ?? "")),
    ].filter(Boolean);
    return {
      question,
      region,
      intent: "servant_filter",
      interpreted: {
        region,
        conditions,
        traitTerms,
        effectTermGroups: effectGroups,
      },
      answer: formatServantAnswer(results, conditions),
      results,
    };
  }
}

function servantToAskResult(servant: ServantResult): AskServantResult {
  return {
    region: servant.region,
    servantId: servant.servantId,
    collectionNo: servant.collectionNo,
    name: servant.name,
    className: servant.className,
    rarity: servant.rarity,
    matchedTraits: servant.matchedTerms,
    matchedEffects: [],
  };
}

function effectToAskResult(match: EffectMatch): AskServantResult {
  return {
    region: match.region,
    servantId: match.servant.servantId,
    collectionNo: match.servant.collectionNo,
    name: match.servant.name,
    className: match.servant.className,
    rarity: match.servant.rarity,
    matchedTraits: [],
    matchedEffects: [],
  };
}

function effectSummaries(group: string[], matches: EffectMatch[]): AskServantResult["matchedEffects"] {
  const condition = describeTerm(group[0] ?? "");
  const seen = new Set<string>();
  const result: AskServantResult["matchedEffects"] = [];
  for (const match of matches) {
    const key = `${condition}:${match.sourceType}:${match.sourceName}:${match.buffType}:${match.buffName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      condition,
      sourceType: match.sourceType,
      sourceName: match.sourceName,
      buffName: match.buffName,
      buffType: match.buffType,
      detail: match.detail,
    });
  }
  return result;
}

function formatServantAnswer(results: AskServantResult[], conditions: string[]): string {
  const conditionText = conditions.length ? conditions.join(" + ") : "指定条件";
  if (results.length === 0) {
    return `没有查到同时满足「${conditionText}」的从者。`;
  }
  const lines = results.map((item, index) => {
    const base = `${index + 1}. ${item.name}${item.collectionNo ? ` No.${item.collectionNo}` : ""}${item.className ? ` / ${item.className}` : ""}${item.rarity ? ` / ${item.rarity}★` : ""}`;
    const effectText = uniqueStrings(
      item.matchedEffects.map((effect) => `${effect.condition}:${effect.sourceName}`),
    ).join("；");
    return effectText ? `${base}（${effectText}）` : base;
  });
  return `查到 ${results.length} 个满足「${conditionText}」的从者：\n${lines.join("\n")}`;
}
