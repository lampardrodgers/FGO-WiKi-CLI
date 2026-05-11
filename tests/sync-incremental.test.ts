import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { resolveCacheDir, resolveDbPath } from "../src/config.js";
import { FgoDatabase } from "../src/db.js";
import { syncAll } from "../src/sync.js";
import { hashText, stringifyJson } from "../src/utils.js";

async function withDataDir(fn: (dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "fgo-agent-sync-"));
  try {
    await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(stringifyJson(payload), {
    headers: { "content-type": "application/json" },
  });
}

test("incremental sync refreshes quest index when war export is unchanged", async () => {
  await withDataDir(async (dataDir) => {
    const warPayload = [
      {
        id: 303,
        name: "死想显现界域 Traum",
        eventId: 0,
        spots: [
          {
            name: "克桑滕之塔",
            quests: [
              {
                id: 93031207,
                name: "月光大炮增幅装置",
                spotName: "克桑滕之塔",
                warLongName: "死想显现界域 Traum",
                type: "free",
                afterClear: "repeatLast",
                consumeType: "ap",
                consume: 21,
                phases: [1],
              },
            ],
          },
        ],
      },
    ];
    const warText = stringifyJson(warPayload);
    const cacheDir = path.join(resolveCacheDir(dataDir), "CN");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path.join(cacheDir, "nice_war.json"), warText);

    const db = new FgoDatabase(resolveDbPath(dataDir));
    db.upsertSource({
      id: "atlas:CN:nice_war.json",
      region: "CN",
      source: "atlas",
      kind: "nice",
      url: "https://api.atlasacademy.io/export/CN/nice_war.json",
      hash: hashText(warText),
      etag: '"war-v1"',
      fetchedAt: "2026-05-11T00:00:00.000Z",
      status: "ok",
    });
    db.upsertSource({
      id: "atlas:CN:nice_servant.json",
      region: "CN",
      source: "atlas",
      kind: "nice",
      url: "https://api.atlasacademy.io/export/CN/nice_servant.json",
      hash: "servant-hash",
      etag: '"servant-v1"',
      lastModified: "Mon, 11 May 2026 00:00:00 GMT",
      fetchedAt: "2026-05-11T00:00:00.000Z",
      status: "ok",
    });
    db.close();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/info")) return jsonResponse({ ok: true });
      if (url.endsWith("/export/CN/nice_war.json")) {
        assert.equal(new Headers(init?.headers).get("if-none-match"), '"war-v1"');
        return new Response(null, { status: 304, headers: { etag: '"war-v1"' } });
      }
      if (url.endsWith("/export/CN/nice_servant.json")) {
        return new Response("temporary failure", { status: 500, statusText: "Server Error" });
      }
      if (url.endsWith("/nice/CN/quest/93031207/1")) {
        return jsonResponse({ bond: 777, exp: 12345 });
      }
      if (url.includes("/export/CN/")) {
        return new Response("missing", { status: 404, statusText: "Not Found" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const summary = await syncAll({
        regions: ["CN"],
        dataDir,
        includeBasic: false,
        includeAssets: false,
        includeMooncell: false,
      });
      assert.equal(summary.status, "partial");
      assert.equal(summary.unchanged, 1);
      assert.equal(summary.failed, 1);
      assert.equal(summary.questAudits[0]?.indexedQuests, 1);
      assert.equal(summary.databases.find((item) => item.name === "quest_index")?.status, "ok");
      assert.equal(summary.counts?.regions.find((item) => item.region === "CN")?.questIndex, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const synced = new FgoDatabase(resolveDbPath(dataDir));
    const quest = synced.getQuestIndex("CN", "93031207", 1);
    const failedSource = synced.getSource("atlas:CN:nice_servant.json");
    synced.close();

    assert.equal(quest?.bond, 777);
    assert.equal(failedSource?.status, "failed");
    assert.equal(failedSource?.hash, "servant-hash");
    assert.equal(failedSource?.etag, '"servant-v1"');
    assert.equal(failedSource?.last_modified, "Mon, 11 May 2026 00:00:00 GMT");
  });
});

test("mooncell fetch failures are recorded without aborting atlas sync", async () => {
  await withDataDir(async (dataDir) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/info")) return jsonResponse({ ok: true });
      if (url.startsWith("https://fgo.wiki/api.php")) {
        throw new TypeError("fetch failed", {
          cause: new Error("Connect Timeout Error"),
        });
      }
      if (url.endsWith("/export/CN/nice_trait.json") || url.endsWith("/export/CN/nice_enums.json")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const summary = await syncAll({
        regions: ["CN"],
        dataDir,
        includeBasic: false,
        includeNice: false,
        includeAssets: false,
      });
      assert.equal(summary.status, "partial");
      assert.equal(summary.failed, 1);
      assert.equal(summary.banners, 0);
      assert.equal(summary.databases.find((item) => item.name === "mooncell")?.status, "failed");
      assert.match(summary.message, /1 个数据源失败/);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const db = new FgoDatabase(resolveDbPath(dataDir));
    const source = db.getSource("mooncell:CN:banners");
    db.close();

    assert.equal(source?.status, "failed");
    assert.match(String(source?.error), /Fetch failed for https:\/\/fgo\.wiki\/api\.php/);
    assert.match(String(source?.error), /Connect Timeout Error/);
  });
});
