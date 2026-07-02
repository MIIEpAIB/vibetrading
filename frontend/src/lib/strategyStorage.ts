import type { StrategyLibraryItem } from "@/lib/api";

export const OWNED_STRATEGY_STORAGE_KEY = "vibe-personal-strategy-library";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        .map((tag) => tag.trim())
        .slice(0, 8)
    : [];
}

function normalizeLanguage(value: unknown, fallback: string): string {
  if (value === "json") return "javascript";
  return typeof value === "string" && value.trim() ? value : fallback;
}

function fallbackStrategy(): StrategyLibraryItem {
  const now = new Date().toISOString();
  return {
    id: `strategy_${Date.now()}`,
    name: "Untitled Strategy",
    description: "",
    strategyDescription: "",
    language: "python",
    category: "utility",
    status: "draft",
    tags: [],
    code: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeOwnedStrategy(value: unknown, fallback = fallbackStrategy()): StrategyLibraryItem {
  if (!isRecord(value)) return fallback;
  const now = new Date().toISOString();
  const code = typeof value.code === "string" ? value.code : fallback.code;
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : fallback.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : fallback.name,
    description: typeof value.description === "string" ? value.description : fallback.description,
    strategyDescription: typeof value.strategyDescription === "string"
      ? value.strategyDescription
      : typeof value.strategy_description === "string"
        ? value.strategy_description
        : fallback.strategyDescription,
    language: normalizeLanguage(value.language, fallback.language),
    category: typeof value.category === "string" && value.category.trim() ? value.category : fallback.category,
    status: typeof value.status === "string" && value.status.trim() ? value.status : fallback.status,
    tags: toTags(value.tags),
    code,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : fallback.createdAt ?? now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : fallback.updatedAt ?? now,
  };
}

export function readOwnedStrategies(): StrategyLibraryItem[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(OWNED_STRATEGY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeOwnedStrategy(item))
      .filter((strategy) => strategy.name.trim() && strategy.code.trim());
  } catch {
    return [];
  }
}

export function saveOwnedStrategies(strategies: StrategyLibraryItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OWNED_STRATEGY_STORAGE_KEY, JSON.stringify(strategies));
}

export function upsertOwnedStrategy(strategies: StrategyLibraryItem[], next: StrategyLibraryItem): StrategyLibraryItem[] {
  const index = strategies.findIndex((item) => item.id === next.id);
  if (index < 0) return [next, ...strategies];

  const existing = strategies[index];
  const ownershipTags = new Set(["favorite", "purchased"]);
  const nextHasOwnership = (next.tags ?? []).some((tag) => ownershipTags.has(tag));
  const existingTags = nextHasOwnership
    ? (existing.tags ?? []).filter((tag) => !ownershipTags.has(tag))
    : (existing.tags ?? []);
  const merged: StrategyLibraryItem = {
    ...existing,
    ...next,
    tags: Array.from(new Set([...existingTags, ...(next.tags ?? [])])).slice(0, 8),
    createdAt: existing.createdAt || next.createdAt,
    updatedAt: next.updatedAt,
  };

  const copy = [...strategies];
  copy[index] = merged;
  return copy;
}

export function mergeOwnedStrategies(
  remoteStrategies: StrategyLibraryItem[],
  localStrategies: StrategyLibraryItem[],
): StrategyLibraryItem[] {
  let merged = [...remoteStrategies];
  for (const strategy of localStrategies) {
    merged = upsertOwnedStrategy(merged, strategy);
  }
  return merged;
}
