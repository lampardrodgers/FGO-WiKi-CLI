import { createHash } from "node:crypto";
import type { Region } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function normalizeRegion(value: string | undefined, fallback: Region = "CN"): Region {
  const region = (value ?? fallback).trim().toUpperCase();
  if (region === "CN" || region === "JP" || region === "NA" || region === "KR" || region === "TW") {
    return region;
  }
  throw new Error(`Unsupported region: ${value}`);
}

export function parseRegions(value: string | undefined): Region[] {
  if (!value || value.trim() === "") return ["CN", "JP"];
  return value
    .split(",")
    .map((part) => normalizeRegion(part.trim()))
    .filter((region, index, regions) => regions.indexOf(region) === index);
}

export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJson<T = unknown>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function getByPath(value: unknown, path: string | undefined): unknown {
  if (!path || path.trim() === "") return value;
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return current;
}

export function collectStrings(value: unknown, maxChars = 200_000): string {
  const out: string[] = [];
  let size = 0;
  const visit = (input: unknown): void => {
    if (size >= maxChars || input == null) return;
    if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
      const text = String(input);
      if (text.length > 0) {
        out.push(text);
        size += text.length + 1;
      }
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) visit(item);
      return;
    }
    if (typeof input === "object") {
      for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
        if (size >= maxChars) break;
        if (typeof item !== "object") out.push(key);
        visit(item);
      }
    }
  };
  visit(value);
  return out.join(" ").slice(0, maxChars);
}

export function extractUrls(value: unknown): Array<{ path: string; url: string }> {
  const urls: Array<{ path: string; url: string }> = [];
  const visit = (input: unknown, path: string): void => {
    if (typeof input === "string") {
      if (/^https?:\/\//i.test(input)) urls.push({ path, url: input });
      return;
    }
    if (Array.isArray(input)) {
      input.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (input && typeof input === "object") {
      for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
        visit(item, path ? `${path}.${key}` : key);
      }
    }
  };
  visit(value, "");
  return urls;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function toUnixIso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric * 1000).toISOString();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (isRecord(value) && typeof value.timestamp === "string") {
    return toUnixIso(value.timestamp);
  }
  return undefined;
}

