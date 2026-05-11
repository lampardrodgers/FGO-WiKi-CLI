import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  agentSessionMemoryPath,
  clearAgentSessionMemory,
  formatAgentSessionContext,
  loadAgentSessionMemory,
  saveAgentSessionTurn,
} from "../src/agent-memory.js";

async function withTempDir(fn: (dataDir: string) => Promise<void> | void): Promise<void> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "fgo-agent-memory-"));
  try {
    await fn(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("agent session memory stores only compact final-turn context", async () => {
  await withTempDir(async (dataDir) => {
    const memory = saveAgentSessionTurn({
      dataDir,
      sessionId: "test session",
      question: "中立善狂阶蓝卡宝具神性特攻从者",
      finalAnswer: "查到 1 个结果：测试用狂阶从者。",
      region: "CN",
      intent: "servant_filter",
      results: [
        {
          servantId: "700100",
          collectionNo: 999,
          name: "测试用狂阶从者",
          className: "berserker",
          rarity: 4,
          rawJson: { shouldNotPersist: true },
          matchedEffects: [{ detail: "large payload should not persist" }],
        },
      ],
    });

    assert.equal(memory.turns.length, 1);
    assert.equal(memory.lastTurn.visibleRefs.length, 1);
    assert.deepEqual(memory.lastTurn.visibleRefs[0], {
      label: "1",
      kind: "servant",
      id: "700100",
      collectionNo: 999,
      name: "测试用狂阶从者",
      detail: "berserker / 4★",
    });

    const fileContent = await readFile(agentSessionMemoryPath(dataDir, "test session"), "utf8");
    assert.doesNotMatch(fileContent, /rawJson|shouldNotPersist|matchedEffects|large payload/);

    const loaded = loadAgentSessionMemory(dataDir, "test session");
    const context = formatAgentSessionContext(loaded);
    assert.match(context, /最近轻量上下文/);
    assert.match(context, /测试用狂阶从者/);
    assert.doesNotMatch(context, /rawJson|shouldNotPersist|matchedEffects|large payload/);
  });
});

test("agent session memory keeps recent compact turns for multi-turn follow-ups", async () => {
  await withTempDir((dataDir) => {
    for (let index = 1; index <= 5; index += 1) {
      saveAgentSessionTurn({
        dataDir,
        sessionId: "default",
        question: `第 ${index} 个问题`,
        finalAnswer: `第 ${index} 个答案`,
        region: "CN",
        results: [],
      });
    }

    const loaded = loadAgentSessionMemory(dataDir, "default");
    assert.equal(loaded?.turns.length, 4);
    assert.equal(loaded?.turns[0]?.question, "第 2 个问题");
    assert.equal(loaded?.lastTurn.question, "第 5 个问题");

    const context = formatAgentSessionContext(loaded);
    assert.doesNotMatch(context, /第 1 个问题/);
    assert.match(context, /第 2 个问题/);
    assert.match(context, /第 5 个答案/);
  });
});

test("agent session memory reset starts a new follow-up chain", async () => {
  await withTempDir((dataDir) => {
    saveAgentSessionTurn({
      dataDir,
      sessionId: "default",
      question: "旧链条问题 A",
      finalAnswer: "旧链条答案 A",
      region: "CN",
      results: [],
    });
    saveAgentSessionTurn({
      dataDir,
      sessionId: "default",
      question: "旧链条问题 B",
      finalAnswer: "旧链条答案 B",
      region: "CN",
      results: [],
    });
    saveAgentSessionTurn({
      dataDir,
      sessionId: "default",
      question: "普通查询重置",
      finalAnswer: "新的起点",
      region: "CN",
      reset: true,
      results: [],
    });
    saveAgentSessionTurn({
      dataDir,
      sessionId: "default",
      question: "继续新链条",
      finalAnswer: "新链条第 2 轮",
      region: "CN",
      results: [],
    });

    const loaded = loadAgentSessionMemory(dataDir, "default");
    assert.equal(loaded?.turns.length, 2);
    assert.equal(loaded?.turns[0]?.question, "普通查询重置");
    assert.equal(loaded?.turns[1]?.question, "继续新链条");

    const context = formatAgentSessionContext(loaded);
    assert.doesNotMatch(context, /旧链条问题|旧链条答案/);
    assert.match(context, /普通查询重置/);
    assert.match(context, /继续新链条/);
  });
});

test("agent session memory can be cleared by session id", async () => {
  await withTempDir((dataDir) => {
    saveAgentSessionTurn({
      dataDir,
      sessionId: "clear-me",
      question: "问题",
      finalAnswer: "答案",
      region: "CN",
      results: [],
    });

    assert.ok(loadAgentSessionMemory(dataDir, "clear-me"));
    clearAgentSessionMemory(dataDir, "clear-me");
    assert.equal(loadAgentSessionMemory(dataDir, "clear-me"), undefined);
  });
});
