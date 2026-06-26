import type { RunData } from "@/lib/api";

export const SHADOW_SYMBOLS = ["BTC_USDT", "ETH_USDT", "SOL_USDT", "BNB_USDT", "XRP_USDT"] as const;

export type ShadowSymbol = (typeof SHADOW_SYMBOLS)[number];
export type ShadowImportSide = "BUY" | "SELL";
export type ShadowImportOrderType = "MARKET" | "LIMIT";

export interface ShadowImportDraft {
  version: 1;
  source: "agent_result";
  createdAt: number;
  runId?: string;
  shadowId?: string;
  symbol: ShadowSymbol;
  side: ShadowImportSide;
  orderType: ShadowImportOrderType;
  quantity: number;
  price?: number;
  metrics?: {
    total_return?: number;
    sharpe?: number;
    max_drawdown?: number;
    trade_count?: number;
  };
}

const STORAGE_PREFIX = "vibe-shadow-import:";
const DEFAULT_TEST_NOTIONAL_USD = 2_000;
const MAX_IMPORTED_NOTIONAL_USD = 5_000;

const DEFAULT_MARKET_PRICES: Record<ShadowSymbol, number> = {
  BTC_USDT: 65_000,
  ETH_USDT: 3_500,
  SOL_USDT: 164,
  BNB_USDT: 655,
  XRP_USDT: 2.18,
};

const TRADE_SYMBOL_KEYS = ["symbol", "ticker", "instrument", "asset", "pair", "code"];
const TRADE_QUANTITY_KEYS = ["quantity", "qty", "shares", "amount", "size", "base_qty", "base quantity"];
const TRADE_PRICE_KEYS = ["price", "entry_price", "fill_price", "executed_price", "avg_price", "average_price", "close"];

interface BuildDraftInput {
  runId?: string;
  shadowId?: string;
  metrics?: Record<string, number>;
  runData?: RunData | null;
}

interface TradeHint {
  symbol: ShadowSymbol;
  quantity?: number;
  price?: number;
}

export function buildShadowImportDraft(input: BuildDraftInput): ShadowImportDraft {
  const trade = findSupportedTrade(input.runData);
  const symbol = trade?.symbol ?? findSymbolInText(input.runData?.prompt) ?? "BTC_USDT";
  const price = positiveNumber(trade?.price) ?? DEFAULT_MARKET_PRICES[symbol];
  const quantity = conservativeQuantity(symbol, trade?.quantity, price);

  return {
    version: 1,
    source: "agent_result",
    createdAt: Date.now(),
    runId: input.runId,
    shadowId: input.shadowId,
    symbol,
    side: "BUY",
    orderType: "MARKET",
    quantity,
    price,
    metrics: pickMetrics(input.metrics ?? input.runData?.metrics),
  };
}

export function saveShadowImportDraft(draft: ShadowImportDraft): string {
  const key = `draft_${draft.createdAt}_${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(draft));
  return key;
}

export function loadShadowImportDraft(key: string): ShadowImportDraft | null {
  const storageKey = `${STORAGE_PREFIX}${key}`;
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) return null;
  window.sessionStorage.removeItem(storageKey);
  try {
    const parsed = JSON.parse(raw) as Partial<ShadowImportDraft>;
    if (parsed.version !== 1 || parsed.source !== "agent_result") return null;
    if (!isShadowSymbol(parsed.symbol) || !positiveNumber(parsed.quantity)) return null;
    const orderType = parsed.orderType === "LIMIT" ? "LIMIT" : "MARKET";
    const side = parsed.side === "SELL" ? "SELL" : "BUY";
    return {
      version: 1,
      source: "agent_result",
      createdAt: Number(parsed.createdAt) || Date.now(),
      runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
      shadowId: typeof parsed.shadowId === "string" ? parsed.shadowId : undefined,
      symbol: parsed.symbol,
      side,
      orderType,
      quantity: positiveNumber(parsed.quantity) ?? conservativeQuantity(parsed.symbol),
      price: positiveNumber(parsed.price),
      metrics: sanitizeMetrics(parsed.metrics),
    };
  } catch {
    return null;
  }
}

export function normalizeShadowSymbol(value: unknown): ShadowSymbol | null {
  if (value == null) return null;
  const raw = String(value).trim().toUpperCase();
  if (!raw) return null;
  const separated = raw.replace(/[/-]/g, "_").replace(/\s+/g, "");
  const normalized = separated.includes("_")
    ? separated
    : separated.endsWith("USDT")
      ? `${separated.slice(0, -4)}_USDT`
      : separated;
  return isShadowSymbol(normalized) ? normalized : null;
}

function findSupportedTrade(runData?: RunData | null): TradeHint | null {
  const rows = Array.isArray(runData?.trade_log) ? runData.trade_log : [];
  for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
    const row = rows[idx];
    const symbol = normalizeShadowSymbol(firstRowValue(row, TRADE_SYMBOL_KEYS));
    if (!symbol) continue;
    return {
      symbol,
      quantity: positiveNumber(firstRowValue(row, TRADE_QUANTITY_KEYS)),
      price: positiveNumber(firstRowValue(row, TRADE_PRICE_KEYS)),
    };
  }
  return null;
}

function findSymbolInText(text?: string): ShadowSymbol | null {
  if (!text) return null;
  const upper = text.toUpperCase();
  for (const symbol of SHADOW_SYMBOLS) {
    const [base] = symbol.split("_");
    const pattern = new RegExp(`\\b${base}(?:[_/ -]?USDT)?\\b`);
    if (pattern.test(upper)) return symbol;
  }
  return null;
}

function firstRowValue(row: Record<string, unknown>, keys: string[]): unknown {
  const lowered = new Map(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const key of keys) {
    const exact = lowered.get(key);
    if (exact != null && String(exact).trim() !== "") return exact;
  }
  for (const [rowKey, value] of lowered) {
    if (keys.some((key) => rowKey.replace(/[_-]/g, " ") === key)) {
      if (value != null && String(value).trim() !== "") return value;
    }
  }
  return undefined;
}

function conservativeQuantity(symbol: ShadowSymbol, rawQuantity?: unknown, rawPrice?: unknown): number {
  const price = positiveNumber(rawPrice) ?? DEFAULT_MARKET_PRICES[symbol];
  const candidate = positiveNumber(rawQuantity) ?? DEFAULT_TEST_NOTIONAL_USD / price;
  const capped = Math.min(candidate, MAX_IMPORTED_NOTIONAL_USD / price);
  return roundQuantity(capped);
}

function roundQuantity(value: number): number {
  if (value >= 1) return Number(value.toFixed(6));
  return Number(value.toPrecision(6));
}

function pickMetrics(metrics?: Record<string, unknown>): ShadowImportDraft["metrics"] {
  if (!metrics) return undefined;
  return sanitizeMetrics({
    total_return: metrics.total_return,
    sharpe: metrics.sharpe,
    max_drawdown: metrics.max_drawdown,
    trade_count: metrics.trade_count,
  });
}

function sanitizeMetrics(metrics?: Record<string, unknown>): ShadowImportDraft["metrics"] {
  if (!metrics) return undefined;
  const cleaned: NonNullable<ShadowImportDraft["metrics"]> = {};
  for (const key of ["total_return", "sharpe", "max_drawdown", "trade_count"] as const) {
    const value = parseFiniteNumber(metrics[key]);
    if (value != null) cleaned[key] = value;
  }
  return Object.keys(cleaned).length ? cleaned : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = parseFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : undefined;
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[$,%\s,]/g, "");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isShadowSymbol(value: unknown): value is ShadowSymbol {
  return typeof value === "string" && SHADOW_SYMBOLS.includes(value as ShadowSymbol);
}
