import { mkdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const DEFAULT_REGIONS = ["CN", "JP"] as const;

export function resolveDataDir(dataDir?: string): string {
  return path.resolve(
    dataDir ??
      process.env.FGO_AGENT_DATA_DIR ??
      path.join(process.cwd(), ".fgo-agent"),
  );
}

export function resolveDbPath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), "fgo.sqlite");
}

export function resolveCacheDir(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), "cache");
}

export async function ensureDataDirs(dataDir?: string): Promise<void> {
  await mkdir(resolveCacheDir(dataDir), { recursive: true });
}

export function ensureDataDirsSync(dataDir?: string): void {
  const cacheDir = resolveCacheDir(dataDir);
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
}

