import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Region } from "./types.js";

export interface AgentMemoryRef {
  label: string;
  kind: string;
  id?: string;
  collectionNo?: number | null;
  name?: string;
  title?: string;
  detail?: string;
  sourceUrl?: string;
}

export interface AgentSessionMemory {
  version: 1;
  sessionId: string;
  updatedAt: string;
  turns: AgentMemoryTurn[];
  lastTurn: AgentMemoryTurn;
}

export interface AgentMemoryTurn {
  question: string;
  finalAnswer: string;
  region: Region;
  intent?: string;
  visibleRefs: AgentMemoryRef[];
}

export interface SaveAgentSessionTurnInput {
  sessionId: string;
  dataDir: string;
  question: string;
  finalAnswer: string;
  region: Region;
  intent?: string;
  reset?: boolean;
  results?: unknown[];
}

const MEMORY_VERSION = 1;
const MAX_QUESTION_CHARS = 400;
const MAX_ANSWER_CHARS = 1200;
const MAX_REFS = 8;
const MAX_TURNS = 4;

export function loadAgentSessionMemory(dataDir: string, sessionId: string): AgentSessionMemory | undefined {
  const filePath = agentSessionMemoryPath(dataDir, sessionId);
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as AgentSessionMemory;
    if (parsed.version !== MEMORY_VERSION || parsed.sessionId !== sessionId || !parsed.lastTurn) {
      return undefined;
    }
    return {
      ...parsed,
      turns: normalizeTurns(parsed),
    };
  } catch {
    return undefined;
  }
}

export function saveAgentSessionTurn(input: SaveAgentSessionTurnInput): AgentSessionMemory {
  const existing = input.reset ? undefined : loadAgentSessionMemory(input.dataDir, input.sessionId);
  const turn: AgentMemoryTurn = {
    question: compactText(input.question, MAX_QUESTION_CHARS),
    finalAnswer: compactText(input.finalAnswer, MAX_ANSWER_CHARS),
    region: input.region,
    intent: input.intent,
    visibleRefs: summarizeVisibleRefs(input.results ?? [], MAX_REFS),
  };
  const turns = [...(existing?.turns ?? []), turn].slice(-MAX_TURNS);
  const memory: AgentSessionMemory = {
    version: MEMORY_VERSION,
    sessionId: input.sessionId,
    updatedAt: new Date().toISOString(),
    turns,
    lastTurn: turn,
  };
  const filePath = agentSessionMemoryPath(input.dataDir, input.sessionId);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  return memory;
}

export function clearAgentSessionMemory(dataDir: string, sessionId: string): void {
  rmSync(agentSessionMemoryPath(dataDir, sessionId), { force: true });
}

export function formatAgentSessionContext(memory: AgentSessionMemory | undefined): string {
  if (!memory) return "";
  const turns = normalizeTurns(memory);
  const lines = [
    "最近轻量上下文：",
    "说明：这里只保留最近几轮用户问题、最终回答和少量可引用对象；不包含查询过程、工具输出或 raw JSON。",
  ];
  turns.forEach((turn, index) => {
    const refs = turn.visibleRefs.map(formatMemoryRef);
    lines.push(`第 ${index + 1} 轮问题：${turn.question}`);
    lines.push("最终回答：");
    lines.push(turn.finalAnswer);
    lines.push(refs.length ? "可引用对象：" : "可引用对象：无");
    lines.push(...refs);
  });
  lines.push("使用规则：可以用这段上下文理解“刚才那个”“第 2 个”等指代；涉及 FGO 事实时仍必须重新调用本地数据工具确认。");
  return lines.join("\n");
}

export function agentSessionMemoryPath(dataDir: string, sessionId: string): string {
  const hash = createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
  const slug = sessionId
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return path.join(dataDir, "sessions", `${slug || "session"}-${hash}.json`);
}

function summarizeVisibleRefs(results: unknown[], limit: number): AgentMemoryRef[] {
  return results
    .slice(0, limit)
    .map((item, index) => summarizeVisibleRef(item, index + 1))
    .filter((item): item is AgentMemoryRef => item != null);
}

function summarizeVisibleRef(item: unknown, label: number): AgentMemoryRef | undefined {
  if (!isRecord(item)) return undefined;
  if (typeof item.servantId === "string" && typeof item.name === "string") {
    return {
      label: String(label),
      kind: "servant",
      id: item.servantId,
      collectionNo: numberOrNull(item.collectionNo),
      name: item.name,
      detail: compactText([stringValue(item.className), rarityText(item.rarity)].filter(Boolean).join(" / "), 120),
    };
  }
  if (isRecord(item.servant)) {
    const servant = item.servant;
    if (typeof servant.servantId === "string" && typeof servant.name === "string") {
      return {
        label: String(label),
        kind: "servant",
        id: servant.servantId,
        collectionNo: numberOrNull(servant.collectionNo),
        name: servant.name,
        detail: compactText(
          [stringValue(servant.className), rarityText(servant.rarity), stringValue(item.sourceName)].filter(Boolean).join(" / "),
          120,
        ),
      };
    }
  }
  if (typeof item.entityType === "string" && typeof item.entityId === "string") {
    return {
      label: String(label),
      kind: item.entityType,
      id: item.entityId,
      collectionNo: numberOrNull(item.collectionNo),
      name: stringValue(item.name),
    };
  }
  if (typeof item.questId === "string" && typeof item.name === "string") {
    return {
      label: String(label),
      kind: "quest",
      id: item.questId,
      name: item.name,
      detail: compactText(
        [stringValue(item.warName), stringValue(item.spotName), numberValue(item.bond) == null ? undefined : `${numberValue(item.bond)} 羁绊`]
          .filter(Boolean)
          .join(" / "),
        160,
      ),
    };
  }
  if (typeof item.title === "string") {
    return {
      label: String(label),
      kind: "banner",
      title: item.title,
      detail: compactText([stringValue(item.startAt), pickupText(item.pickupServants)].filter(Boolean).join(" / "), 180),
      sourceUrl: stringValue(item.sourceUrl),
    };
  }
  const name = stringValue(item.name);
  if (name) {
    return {
      label: String(label),
      kind: "result",
      name,
    };
  }
  return undefined;
}

function formatMemoryRef(ref: AgentMemoryRef, index: number): string {
  const parts = [`${index + 1}. ${ref.kind}`];
  if (ref.id) parts.push(ref.id);
  if (ref.collectionNo != null) parts.push(`No.${ref.collectionNo}`);
  if (ref.name) parts.push(ref.name);
  if (ref.title) parts.push(ref.title);
  if (ref.detail) parts.push(ref.detail);
  return parts.join(" / ");
}

function normalizeTurns(memory: Pick<AgentSessionMemory, "lastTurn"> & { turns?: AgentMemoryTurn[] }): AgentMemoryTurn[] {
  const turns = Array.isArray(memory.turns) && memory.turns.length ? memory.turns : [memory.lastTurn];
  return turns.slice(-MAX_TURNS);
}

function compactText(value: string, maxChars: number): string {
  const compacted = value.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (compacted.length <= maxChars) return compacted;
  return `${compacted.slice(0, maxChars - 12).trimEnd()}\n...（已截断）`;
}

function pickupText(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return `UP：${value.slice(0, 6).map(String).join("、")}`;
}

function rarityText(value: unknown): string | undefined {
  const rarity = numberValue(value);
  return rarity == null ? undefined : `${rarity}★`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOrNull(value: unknown): number | null | undefined {
  if (value == null) return null;
  return numberValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
