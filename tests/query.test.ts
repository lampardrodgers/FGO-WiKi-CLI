import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { resolveDbPath } from "../src/config.js";
import { FgoDatabase } from "../src/db.js";
import { FgoService } from "../src/service.js";
import { ingestAtlasPayload } from "../src/sync.js";
import { VERSION } from "../src/version.js";

async function withFixture(fn: (dataDir: string) => Promise<void> | void): Promise<void> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "fgo-agent-"));
  try {
    const db = new FgoDatabase(resolveDbPath(dataDir));
    ingestAtlasPayload(db, {
      region: "CN",
      entityType: "servant",
      sourceUrl: "https://api.atlasacademy.io/export/CN/nice_servant.json",
      updatedAt: "2026-05-08T00:00:00.000Z",
      payload: [
        {
          id: 100100,
          collectionNo: 2,
          name: "阿尔托莉雅·潘德拉贡",
          originalName: "阿尔托莉雅·潘德拉贡",
          className: "saber",
          rarity: 5,
          attribute: "earth",
          gender: "female",
          traits: ["alignmentLawful", "alignmentGood", "king"],
          extraAssets: {
            faces: {
              ascension: {
                "1": "https://static.atlasacademy.io/CN/Faces/f_1001000.png",
              },
            },
          },
          skills: [
            {
              id: 1,
              name: "魔力放出 A",
              functions: [
                {
                  funcType: "addState",
                  funcTargetType: "self",
                  buffs: [{ type: "upCommandbuster", name: "红卡性能提升", detail: "红卡性能提升" }],
                },
              ],
            },
          ],
          noblePhantasms: [
            {
              id: 10,
              name: "誓约胜利之剑",
              functions: [
                {
                  funcType: "addStateShort",
                  funcTargetType: "self",
                  buffs: [{ type: "pierceInvincible", name: "无敌贯通", detail: "无视回避与无敌状态以造成伤害" }],
                },
              ],
            },
          ],
        },
        {
          id: 2501500,
          collectionNo: 0,
          name: "苍崎青子",
          className: "foreigner",
          rarity: 5,
          traits: ["alignmentLawful", "alignmentGood"],
          noblePhantasms: [
            {
              id: 20,
              name: "Earthlight Starbow",
              functions: [
                {
                  funcType: "addStateShort",
                  buffs: [{ type: "pierceInvincible", name: "无敌贯通", detail: "无视回避与无敌状态以造成伤害" }],
                },
              ],
            },
          ],
        },
        {
          id: 700100,
          collectionNo: 999,
          name: "测试用狂阶从者",
          className: "berserker",
          rarity: 4,
          attribute: "earth",
          traits: ["alignmentNeutral", "alignmentGood"],
          noblePhantasms: [
            {
              id: 30,
              name: "测试蓝卡神性特攻宝具",
              card: "1",
              functions: [
                {
                  funcType: "addStateShort",
                  funcPopupText: "威力提升·对神性",
                  funcTargetType: "self",
                  buffs: [
                    {
                      type: "upDamage",
                      name: "威力提升〔神性〕",
                      detail: "对〔神性〕特性对象造成的伤害提升",
                    },
                  ],
                  svals: [
                    {
                      Rate: 1000,
                      Turn: 1,
                      Count: -1,
                      Value: 500,
                    },
                  ],
                },
                {
                  funcType: "damageNpIndividual",
                  funcTargetType: "enemyAll",
                  svals: [
                    {
                      Rate: 1000,
                      Value: 6000,
                      Target: 2000,
                      Correction: 1500,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    db.upsertBanner({
      id: "banner-1",
      region: "CN",
      title: "测试推荐召唤",
      startAt: "2026-06-01T00:00:00.000Z",
      endAt: "2026-06-10T00:00:00.000Z",
      pickupServants: ["阿尔托莉雅·潘德拉贡"],
      pickupCEs: [],
      confidence: "prediction",
      source: "mooncell",
      sourceUrl: "https://fgo.wiki/w/test",
      rawJson: { test: true },
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
    db.upsertQuestIndex({
      region: "CN",
      questId: "93031207",
      phase: 1,
      name: "月光大炮增幅装置",
      spotName: "克桑滕之塔",
      warId: "303",
      warName: "死想显现界域 Traum",
      questType: "free",
      consumeType: "ap",
      consume: 21,
      bond: 795,
      exp: 22488,
      openedAt: "2024-01-01T00:00:00.000Z",
      closedAt: "2037-12-31T16:00:00.000Z",
      sourceUrl: "https://api.atlasacademy.io/nice/CN/quest/93031207/1",
      rawJson: { test: true },
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
    db.upsertQuestIndex({
      region: "CN",
      questId: "94137202",
      phase: 1,
      name: "月光矿区",
      spotName: "阿拉伯区域",
      warId: "401",
      warName: "Ordeal Call",
      questType: "free",
      consumeType: "apAndItem",
      consume: 40,
      bond: 3797,
      exp: 158384,
      openedAt: "2025-09-12T06:00:00.000Z",
      closedAt: "2037-12-31T16:00:00.000Z",
      sourceUrl: "https://api.atlasacademy.io/nice/CN/quest/94137202/1",
      rawJson: { test: true },
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
    db.setMetadata(
      "quest_index.audit.CN",
      {
        region: "CN",
        totalWars: 1,
        totalQuests: 2,
        skippedEventWars: 0,
        candidateQuests: 2,
        indexedQuests: 2,
        failedQuestDetails: 0,
        skippedReasons: {},
        consumeTypes: { ap: 1, apAndItem: 1 },
        unknownConsumeTypes: [],
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
      "2026-05-08T00:00:00.000Z",
    );
    db.close();
    await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("trait query resolves Chinese alignment aliases", async () => {
  await withFixture((dataDir) => {
    const service = new FgoService(dataDir);
    const results = service.listServantsByTrait("CN", "秩序善");
    service.close();
    assert.equal(results.length, 1);
    assert.equal(results[0]?.name, "阿尔托莉雅·潘德拉贡");
    assert.deepEqual(results[0]?.matchedTerms.sort(), ["alignmentGood", "alignmentLawful"].sort());
  });
});

test("effect query finds buff sources", async () => {
  await withFixture((dataDir) => {
    const service = new FgoService(dataDir);
    const results = service.listServantsByEffect("CN", "无敌贯通");
    service.close();
    assert.equal(results.length, 1);
    assert.equal(results[0]?.sourceType, "noblePhantasm");
    assert.equal(results[0]?.buffType, "pierceInvincible");
  });
});

test("raw path query and resources work", async () => {
  await withFixture((dataDir) => {
    const service = new FgoService(dataDir);
    const raw = service.queryJson({ region: "CN", entityType: "servant", id: "100100", path: "skills[0].name" });
    const resources = service.resources("CN", "servant", "2");
    service.close();
    assert.equal(raw?.value, "魔力放出 A");
    assert.equal(resources.length, 1);
    assert.match(resources[0]?.url ?? "", /static\.atlasacademy\.io/);
  });
});

test("future banner query returns Mooncell-style prediction metadata", async () => {
  await withFixture((dataDir) => {
    const service = new FgoService(dataDir);
    const banners = service.upcomingBanners("CN", 5);
    service.close();
    assert.equal(banners.length, 1);
    assert.equal(banners[0]?.confidence, "prediction");
    assert.equal(banners[0]?.pickupServants[0], "阿尔托莉雅·潘德拉贡");
  });
});

test("natural language ask intersects traits, class, NP card, and special attack", async () => {
  await withFixture((dataDir) => {
    const service = new FgoService(dataDir);
    const answer = service.ask("中立善并且狂阶的，蓝卡宝具的带有神性特攻的从者", { region: "CN", limit: 10 });
    service.close();
    assert.equal(answer.intent, "servant_filter");
    assert.match(answer.answer, /测试用狂阶从者/);
    const results = answer.results as Array<{ name: string; matchedEffects: Array<{ condition: string }> }>;
    assert.equal(results.length, 1);
    assert.equal(results[0]?.name, "测试用狂阶从者");
    assert.deepEqual(
      results[0]?.matchedEffects.map((item) => item.condition).sort(),
      ["神性特攻", "蓝卡宝具"].sort(),
    );
  });
});

test("top bond quest query includes permanent apAndItem Ordeal Call quests", async () => {
  await withFixture((dataDir) => {
    const service = new FgoService(dataDir);
    const quests = service.topBondQuests("CN", 2);
    const answer = service.ask("列出单次通关羁绊总值最高的5个常驻本", { region: "CN", limit: 2 });
    service.close();

    assert.equal(quests[0]?.name, "月光矿区");
    assert.equal(quests[0]?.bond, 3797);
    assert.equal(quests[0]?.consumeType, "apAndItem");
    assert.equal(answer.intent, "quest_bond");
    assert.match(answer.answer, /月光矿区/);
    assert.match(answer.answer, /3797 羁绊/);
    assert.match(answer.answer, /40AP\+道具/);
  });
});

test("top bond quest query does not hard-code known consume types", async () => {
  await withFixture((dataDir) => {
    const db = new FgoDatabase(resolveDbPath(dataDir));
    db.upsertQuestIndex({
      region: "CN",
      questId: "99999901",
      phase: 1,
      name: "未来消耗类型测试本",
      spotName: "测试区域",
      warId: "999",
      warName: "测试",
      questType: "free",
      consumeType: "futureConsumeType",
      consume: 40,
      bond: 5000,
      exp: 1,
      openedAt: "2026-01-01T00:00:00.000Z",
      closedAt: "2037-12-31T16:00:00.000Z",
      sourceUrl: "https://api.atlasacademy.io/nice/CN/quest/99999901/1",
      rawJson: { test: true },
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
    db.close();

    const service = new FgoService(dataDir);
    const quests = service.topBondQuests("CN", 1);
    const answer = service.ask("列出单次通关羁绊总值最高的5个常驻本", { region: "CN", limit: 1 });
    service.close();

    assert.equal(quests[0]?.name, "未来消耗类型测试本");
    assert.equal(quests[0]?.consumeType, "futureConsumeType");
    assert.match(answer.answer, /futureConsumeType/);
  });
});

test("doctor reports version, quest audit, and golden sample status", async () => {
  await withFixture((dataDir) => {
    const service = new FgoService(dataDir);
    const report = service.doctor("CN");
    service.close();

    assert.equal(report.version, VERSION);
    assert.equal(report.ok, true);
    assert.equal(report.questAudit?.indexedQuests, 2);
    assert.equal(report.checks.find((check) => check.id === "golden_moonlight_mine")?.ok, true);
  });
});
