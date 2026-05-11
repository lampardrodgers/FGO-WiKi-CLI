#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearAgentSessionMemory,
  formatAgentSessionContext,
  loadAgentSessionMemory,
  saveAgentSessionTurn,
} from "./agent-memory.js";
import { resolveDbPath } from "./config.js";
import { FgoService } from "./service.js";
import { normalizeRegion } from "./utils.js";
import { installSqliteWarningFilter } from "./warnings.js";

installSqliteWarningFilter();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const miniModel = process.env.FGO_AGENT_MINI_MODEL ?? "gpt-5.4-mini";
const miniReasoning = process.env.FGO_AGENT_MINI_REASONING ?? "low";
const defaultSessionId = "default";

const args = process.argv.slice(2);
const options = parseArgs(args);
if (options.help || args.length === 0) {
  printHelp();
  process.exit(0);
}

const question = options.questionParts.join(" ").trim();
const namedSessionId = normalizeSessionId(options.sessionId ?? process.env.FGO_AGENT_SESSION);
const activeSessionId = namedSessionId ?? defaultSessionId;
const shouldLoadSession = options.continueConversation || namedSessionId != null;
if (!question && !options.showConfig && !options.clearSession) {
  printHelp();
  process.exit(1);
}

const model = options.model ?? process.env.FGO_AGENT_MODEL ?? (options.mini ? miniModel : undefined);
const reasoning =
  options.reasoning ?? process.env.FGO_AGENT_REASONING ?? (options.mini ? miniReasoning : undefined);
const serviceTier = options.serviceTier ?? process.env.FGO_AGENT_SERVICE_TIER ?? (options.fast ? "fast" : undefined);
const lean = options.lean ?? parseEnvFlag("FGO_AGENT_LEAN") ?? false;
const verbose = options.verbose || !options.quiet;
const ephemeral = !options.persistSession;
const region = normalizeRegion(options.region ?? process.env.FGO_AGENT_REGION, "CN");
const limit = options.limit ?? 20;
const fastSupported = model ? modelSupportsFast(model) : undefined;

if (serviceTier === "fast" && fastSupported === false) {
  process.stderr.write(`Warning: ${model} does not advertise Codex native Fast support in the local model catalog.\n`);
}

if (options.showConfig) {
  process.stdout.write(
    JSON.stringify(
      {
        model: model ?? "Codex config default",
        reasoning: reasoning ?? "Codex config default",
        serviceTier: serviceTier ?? "Codex config default",
        fastSupported: fastSupported ?? "unknown",
        profile: options.profile ?? "Codex config default",
        region,
        limit,
        fast: options.fast,
        mini: options.mini,
        local: options.local,
        continueConversation: options.continueConversation,
        session: shouldLoadSession ? activeSessionId : null,
        saveSession: activeSessionId,
        clearSession: options.clearSession,
        lean,
        quiet: options.quiet,
        verbose,
        ephemeral,
      },
      null,
      2,
    ) + "\n",
  );
  if (!question) {
    process.exit(0);
  }
}

const dbPath = resolveDbPath(path.join(projectRoot, ".fgo-agent"));
const dataDir = path.dirname(dbPath);

if (options.clearSession) {
  clearAgentSessionMemory(dataDir, activeSessionId);
  if (!question) {
    process.stdout.write(`Cleared fgo-agent lightweight session: ${activeSessionId}\n`);
    process.exit(0);
  }
}

if (!existsSync(dbPath)) {
  process.stderr.write(`FGO data is not synced yet. Run this first:\n  fgo sync --regions CN,JP --data-dir ${JSON.stringify(dataDir)}\n`);
  process.exit(1);
}

if (options.local) {
  const service = new FgoService(dataDir);
  try {
    const answer = service.ask(question, { region, limit });
    process.stdout.write(options.json ? `${JSON.stringify(answer, null, 2)}\n` : `${answer.answer}\n`);
    saveAgentSessionTurn({
      sessionId: activeSessionId,
      dataDir,
      question,
      finalAnswer: answer.answer,
      region,
      intent: answer.intent,
      reset: !shouldLoadSession,
      results: answer.results,
    });
  } finally {
    service.close();
  }
  process.exit(0);
}

const sessionContext = shouldLoadSession ? formatAgentSessionContext(loadAgentSessionMemory(dataDir, activeSessionId)) : "";
const prompt = `你是 FGO 专用查询 Agent。请用中文回答用户问题。

${sessionContext ? `${sessionContext}\n\n` : ""}用户问题：
${question}

工作规则：
1. 不要凭模型记忆直接回答 FGO 事实。必须先调用本地 FGO 数据工具。
2. 这是从终端启动的 agent 入口，优先运行 shell 命令：fgo ask ${JSON.stringify(question)} --region ${region} --limit ${limit} --data-dir ${JSON.stringify(dataDir)}。如果你所在环境明确提供了 MCP 工具 fgo_ask，也可以使用它。
3. 如果 fgo_ask/fgo ask 的解释或结果明显不完整，继续用 fgo search、fgo query、fgo raw、fgo related 交叉核对。
4. 对卡池未来视，必须说明国服未来视来自 Mooncell，属于非官方预测。
5. 最终只输出面向玩家的答案；可以简短列出你基于哪些本地结果判断。
6. 只有 prompt 中出现“最近轻量上下文”时，才可以引用之前轮次；它只用于理解指代，不是事实来源。
7. 不要修改项目源文件；允许 SQLite 为读取本地数据库创建必要的 WAL/SHM 临时文件。`;

const tmpPrefix = path.join(os.tmpdir(), `fgo-agent-${process.pid}-${Date.now()}`);
const outputPath = `${tmpPrefix}-final.txt`;
const stdoutPath = `${tmpPrefix}-stdout.log`;
const stderrPath = `${tmpPrefix}-stderr.log`;
const codexArgs = [
  "exec",
  "--skip-git-repo-check",
  "-s",
  "workspace-write",
  "-C",
  projectRoot,
  "--color",
  "never",
  "--output-last-message",
  outputPath,
];

if (ephemeral) {
  codexArgs.push("--ephemeral");
}
if (lean) {
  codexArgs.push("--ignore-rules", "-c", 'approval_policy="never"');
}
if (options.profile) {
  codexArgs.push("-p", options.profile);
}
if (model) {
  codexArgs.push("-m", model);
}
if (reasoning) {
  codexArgs.push("-c", `model_reasoning_effort="${reasoning}"`);
}
if (serviceTier) {
  codexArgs.push("-c", `service_tier="${serviceTier}"`);
}
codexArgs.push(prompt);

const codexEnv = {
  ...process.env,
  FGO_AGENT_DATA_DIR: dataDir,
};
const result = verbose
  ? spawnSync("codex", codexArgs, {
      stdio: ["ignore", "inherit", "inherit"],
      env: codexEnv,
    })
  : runCodexQuietly(codexArgs, stdoutPath, stderrPath, codexEnv);

if (result.error) {
  process.stderr.write(`Failed to run codex: ${result.error.message}\n`);
  if (!verbose) {
    printLogTail(stderrPath);
    printLogTail(stdoutPath);
  }
  rmSync(outputPath, { force: true });
  rmSync(stdoutPath, { force: true });
  rmSync(stderrPath, { force: true });
  process.exit(1);
}
const finalMessage = result.status === 0 && existsSync(outputPath) ? readFileSync(outputPath, "utf8").trim() : "";
if (!verbose) {
  if (finalMessage) {
    process.stdout.write(finalMessage + "\n");
  } else {
    printLogTail(stdoutPath, process.stdout);
    printLogTail(stderrPath);
  }
}
if (result.status === 0 && finalMessage) {
  saveSessionFromFinalMessage(activeSessionId, dataDir, question, finalMessage, region, limit, !shouldLoadSession);
}
rmSync(outputPath, { force: true });
rmSync(stdoutPath, { force: true });
rmSync(stderrPath, { force: true });
process.exit(result.status ?? 0);

function printHelp(): void {
  process.stdout.write(`FGO Codex Agent

Usage:
  fgo-agent "中立善并且狂阶的，蓝卡宝具的带有神性特攻的从者"
  fgo-agent --model gpt-5.5 --fast "国服接下来预计有哪些卡池？"
  fgo-agent --mini "国服接下来预计有哪些卡池？"
  fgo-agent --continue "继续查刚才那个从者的宝具"
  fgo-agent --local "中立善，术阶女性从者"
  fgo-agent --model gpt-5.4-mini --reasoning low "中立善，术阶女性从者"

Options:
  --fast                  Enable Codex native Fast service tier: service_tier="fast".
  --mini                  Use ${miniModel} with ${miniReasoning} reasoning. This is separate from native Fast.
  --local, --direct       Do not start Codex; answer with the local structured query layer.
  --json                  With --local, print the full structured result.
  --continue              Continue from the recent lightweight conversation memory.
  --session <id>          Advanced: use a named lightweight memory instead of the default recent one.
  --clear-session         Clear the default or named lightweight memory, optionally before the next question.
  --region <code>         CN, JP, NA, KR, TW. Default: CN.
  --limit <n>             Result limit for local data queries. Default: 20.
  --model, -m <model>     Override the Codex model.
  --reasoning <effort>    Override model_reasoning_effort, e.g. low, medium, high, xhigh.
  --service-tier <tier>   Override Codex service_tier, e.g. fast.
  --profile, -p <name>    Use a Codex config profile.
  --lean                  Skip project rules and session persistence for faster startup.
  --no-lean               Keep the normal Codex startup path.
  --show-config           Print the effective fgo-agent Codex settings.
  --quiet, --silent       Hide Codex progress and print only the final answer.
  --verbose               Show raw Codex progress. This is the default.
  --persist-session       Let Codex persist this run as a resumable session.

This command delegates natural-language understanding to Codex, while Codex must verify facts with
the local FGO database through fgo CLI commands or fgo_ask when available. A normal run starts a
new lightweight follow-up chain; use --continue to extend the previous chain.
`);
}

type AgentOptions = {
  clearSession: boolean;
  continueConversation: boolean;
  fast: boolean;
  help: boolean;
  json: boolean;
  lean?: boolean;
  limit?: number;
  local: boolean;
  mini: boolean;
  model?: string;
  persistSession: boolean;
  profile?: string;
  quiet: boolean;
  questionParts: string[];
  region?: string;
  reasoning?: string;
  sessionId?: string;
  serviceTier?: string;
  showConfig: boolean;
  verbose: boolean;
};

function parseArgs(argv: string[]): AgentOptions {
  const parsed: AgentOptions = {
    clearSession: false,
    continueConversation: false,
    fast: false,
    help: false,
    json: false,
    local: false,
    mini: false,
    persistSession: false,
    questionParts: [],
    quiet: false,
    showConfig: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--") {
      parsed.questionParts.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--fast") {
      parsed.fast = true;
    } else if (arg === "--mini") {
      parsed.mini = true;
    } else if (arg === "--local" || arg === "--direct") {
      parsed.local = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--lean") {
      parsed.lean = true;
    } else if (arg === "--no-lean") {
      parsed.lean = false;
    } else if (arg === "--show-config") {
      parsed.showConfig = true;
    } else if (arg === "--quiet" || arg === "--silent") {
      parsed.quiet = true;
    } else if (arg === "--verbose") {
      parsed.verbose = true;
    } else if (arg === "--persist-session") {
      parsed.persistSession = true;
    } else if (arg === "--clear-session") {
      parsed.clearSession = true;
    } else if (arg === "--continue" || arg === "--context") {
      parsed.continueConversation = true;
    } else if (arg === "--model" || arg === "-m") {
      parsed.model = readOptionValue(argv, ++i, arg);
    } else if (arg === "--reasoning" || arg === "--effort") {
      parsed.reasoning = readOptionValue(argv, ++i, arg);
    } else if (arg === "--profile" || arg === "-p") {
      parsed.profile = readOptionValue(argv, ++i, arg);
    } else if (arg === "--service-tier") {
      parsed.serviceTier = readOptionValue(argv, ++i, arg);
    } else if (arg === "--session") {
      parsed.sessionId = readOptionValue(argv, ++i, arg);
    } else if (arg === "--region") {
      parsed.region = readOptionValue(argv, ++i, arg);
    } else if (arg === "--limit") {
      parsed.limit = readNumberOptionValue(argv, ++i, arg);
    } else if (arg.startsWith("--model=")) {
      parsed.model = arg.slice("--model=".length);
    } else if (arg.startsWith("--reasoning=")) {
      parsed.reasoning = arg.slice("--reasoning=".length);
    } else if (arg.startsWith("--effort=")) {
      parsed.reasoning = arg.slice("--effort=".length);
    } else if (arg.startsWith("--profile=")) {
      parsed.profile = arg.slice("--profile=".length);
    } else if (arg.startsWith("--service-tier=")) {
      parsed.serviceTier = arg.slice("--service-tier=".length);
    } else if (arg.startsWith("--session=")) {
      parsed.sessionId = arg.slice("--session=".length);
    } else if (arg.startsWith("--region=")) {
      parsed.region = arg.slice("--region=".length);
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = parseNumberOption(arg.slice("--limit=".length), "--limit");
    } else {
      parsed.questionParts.push(arg);
    }
  }
  return parsed;
}

function readOptionValue(argv: string[], index: number, optionName: string): string {
  const value = argv[index];
  if (!value) {
    process.stderr.write(`Missing value for ${optionName}\n`);
    process.exit(1);
  }
  return value;
}

function readNumberOptionValue(argv: string[], index: number, optionName: string): number {
  return parseNumberOption(readOptionValue(argv, index, optionName), optionName);
}

function parseNumberOption(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    process.stderr.write(`Invalid value for ${optionName}: ${value}\n`);
    process.exit(1);
  }
  return parsed;
}

function runCodexQuietly(
  codexArgs: string[],
  stdoutPath: string,
  stderrPath: string,
  env: NodeJS.ProcessEnv,
): SpawnSyncReturns<Buffer> {
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  try {
    return spawnSync("codex", codexArgs, {
      stdio: ["ignore", stdoutFd, stderrFd],
      env,
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
}

function printLogTail(filePath: string, stream: NodeJS.WritableStream = process.stderr): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8").trim();
  if (!content) return;
  const maxChars = 12_000;
  const tail = content.length > maxChars ? `... truncated ...\n${content.slice(-maxChars)}` : content;
  stream.write(`${tail}\n`);
}

function normalizeSessionId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function saveSessionFromFinalMessage(
  sessionId: string,
  dataDir: string,
  question: string,
  finalMessage: string,
  region: ReturnType<typeof normalizeRegion>,
  limit: number,
  reset: boolean,
): void {
  const service = new FgoService(dataDir);
  try {
    const structured = service.ask(question, { region, limit });
    saveAgentSessionTurn({
      sessionId,
      dataDir,
      question,
      finalAnswer: finalMessage,
      region,
      intent: structured.intent,
      reset,
      results: structured.results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Warning: failed to save lightweight session memory: ${message}\n`);
  } finally {
    service.close();
  }
}

function parseEnvFlag(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function modelSupportsFast(modelSlug: string): boolean | undefined {
  for (const file of [
    path.join(os.homedir(), ".codex", "models_cache.json"),
    path.join(os.homedir(), ".codex", "all-models-catalog.json"),
  ]) {
    try {
      if (!existsSync(file)) continue;
      const parsed = JSON.parse(readFileSync(file, "utf8")) as {
        models?: Array<{
          slug?: string;
          additional_speed_tiers?: string[];
          service_tiers?: Array<{ id?: string; name?: string }>;
        }>;
      };
      const model = parsed.models?.find((item) => item.slug === modelSlug);
      if (!model) continue;
      return Boolean(
        model.additional_speed_tiers?.includes("fast") ||
          model.service_tiers?.some((tier) => tier.id === "priority" || tier.name?.toLowerCase() === "fast"),
      );
    } catch {
      continue;
    }
  }
  return undefined;
}
