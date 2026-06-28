import type { RunData } from "@/lib/api";

export const SHADOW_SYMBOLS = ["BTC_USDT", "ETH_USDT", "SOL_USDT", "BNB_USDT", "XRP_USDT"] as const;

export type ShadowSymbol = (typeof SHADOW_SYMBOLS)[number];
export type ShadowImportSide = "BUY" | "SELL";
export type ShadowImportOrderType = "MARKET" | "LIMIT";
export type ShadowImportTradeSource = "run_log" | "shadow_order";

export interface ShadowImportRunTrade {
  source?: ShadowImportTradeSource;
  symbol?: ShadowSymbol;
  side?: ShadowImportSide;
  quantity?: number;
  price?: number;
  notional?: number;
  pnl?: number;
  pnl_percent?: number;
  opened_at?: string;
  closed_at?: string;
  note?: string;
}

export interface ShadowImportDraft {
  version: 1;
  source: "agent_result";
  createdAt: number;
  runId?: string;
  shadowId?: string;
  run?: {
    prompt?: string;
    status?: string;
    elapsed_seconds?: number;
    run_stage?: string;
    run_directory?: string;
    trade_count?: number;
    trades?: ShadowImportRunTrade[];
  };
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
  BTC_USDT: 59_510.865,
  ETH_USDT: 3_500,
  SOL_USDT: 164,
  BNB_USDT: 655,
  XRP_USDT: 2.18,
};

const TRADE_SYMBOL_KEYS = ["symbol", "ticker", "instrument", "asset", "pair", "code"];
const TRADE_QUANTITY_KEYS = ["quantity", "qty", "shares", "amount", "size", "base_qty", "base quantity"];
const TRADE_PRICE_KEYS = ["price", "entry_price", "fill_price", "executed_price", "avg_price", "average_price", "close"];
const TRADE_SIDE_KEYS = ["side", "action", "direction", "signal", "order_side", "position_side"];
const TRADE_NOTIONAL_KEYS = ["notional", "amount_usd", "usd_amount", "quote_amount", "value", "trade_value", "cost", "proceeds"];
const TRADE_PNL_KEYS = ["pnl", "p&l", "profit", "profit_loss", "realized_pnl", "net_pnl", "pl"];
const TRADE_PNL_PERCENT_KEYS = ["pnl_pct", "pnl_percent", "pnl_%", "return", "return_pct", "profit_pct", "profit_percent"];
const TRADE_OPEN_TIME_KEYS = ["entry_time", "open_time", "opened_at", "timestamp", "time", "date", "datetime"];
const TRADE_CLOSE_TIME_KEYS = ["exit_time", "close_time", "closed_at"];
const TRADE_NOTE_KEYS = ["reason", "comment", "note", "memo"];

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
    run: summarizeRun(input.runData),
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
      run: sanitizeRunSummary(parsed.run),
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

function summarizeRun(runData?: RunData | null): ShadowImportDraft["run"] {
  if (!runData) return undefined;
  return sanitizeRunSummary({
    prompt: runData.prompt,
    status: runData.status,
    elapsed_seconds: runData.elapsed_seconds,
    run_stage: runData.run_stage,
    run_directory: runData.run_directory,
    trade_count: Array.isArray(runData.trade_log) ? runData.trade_log.length : undefined,
    trades: summarizeRunTrades(runData.trade_log),
  });
}

function sanitizeRunSummary(run?: Partial<NonNullable<ShadowImportDraft["run"]>>): ShadowImportDraft["run"] {
  if (!run || typeof run !== "object" || Array.isArray(run)) return undefined;
  const cleaned: NonNullable<ShadowImportDraft["run"]> = {};
  if (typeof run.prompt === "string" && run.prompt.trim()) cleaned.prompt = run.prompt.trim();
  if (typeof run.status === "string" && run.status.trim()) cleaned.status = run.status.trim();
  if (typeof run.run_stage === "string" && run.run_stage.trim()) cleaned.run_stage = run.run_stage.trim();
  if (typeof run.run_directory === "string" && run.run_directory.trim()) cleaned.run_directory = run.run_directory.trim();
  const elapsed = parseFiniteNumber(run.elapsed_seconds);
  if (elapsed !== undefined && elapsed >= 0) cleaned.elapsed_seconds = elapsed;
  const tradeCount = parseFiniteNumber(run.trade_count);
  if (tradeCount !== undefined && tradeCount >= 0) cleaned.trade_count = tradeCount;
  const trades = sanitizeRunTrades(run.trades);
  if (trades.length) {
    cleaned.trades = trades;
    if (cleaned.trade_count === undefined) cleaned.trade_count = trades.length;
  }
  return Object.keys(cleaned).length ? cleaned : undefined;
}

function summarizeRunTrades(rows?: Array<Record<string, string>>): ShadowImportRunTrade[] | undefined {
  if (!Array.isArray(rows)) return undefined;
  const trades = rows
    .map((row) => sanitizeRunTrade(row))
    .filter((trade): trade is ShadowImportRunTrade => Boolean(trade));
  return trades.length ? trades.slice(-30) : undefined;
}

function sanitizeRunTrades(value: unknown): ShadowImportRunTrade[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeRunTrade(item))
    .filter((trade): trade is ShadowImportRunTrade => Boolean(trade))
    .slice(-30);
}

function sanitizeRunTrade(value: unknown): ShadowImportRunTrade | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const symbol = normalizeShadowSymbol(firstRowValue(row, TRADE_SYMBOL_KEYS));
  const quantity = positiveNumber(firstRowValue(row, TRADE_QUANTITY_KEYS));
  const price = positiveNumber(firstRowValue(row, TRADE_PRICE_KEYS));
  const explicitNotional = positiveNumber(firstRowValue(row, TRADE_NOTIONAL_KEYS));
  const notional = explicitNotional ?? (quantity && price ? quantity * price : undefined);
  const pnl = parseFiniteNumber(firstRowValue(row, TRADE_PNL_KEYS));
  const pnlPercent = parseFiniteNumber(firstRowValue(row, TRADE_PNL_PERCENT_KEYS));
  const side = normalizeTradeSide(firstRowValue(row, TRADE_SIDE_KEYS));
  const openedAt = nonEmptyString(firstRowValue(row, TRADE_OPEN_TIME_KEYS));
  const closedAt = nonEmptyString(firstRowValue(row, TRADE_CLOSE_TIME_KEYS));
  const note = nonEmptyString(firstRowValue(row, TRADE_NOTE_KEYS));
  const source = row.source === "shadow_order" ? "shadow_order" : "run_log";

  if (!symbol && !quantity && !price && !notional && pnl === undefined) return null;
  return {
    source,
    symbol: symbol ?? undefined,
    side,
    quantity,
    price,
    notional,
    pnl,
    pnl_percent: pnlPercent,
    opened_at: openedAt,
    closed_at: closedAt,
    note,
  };
}

function normalizeTradeSide(value: unknown): ShadowImportSide | undefined {
  if (value == null) return undefined;
  const raw = String(value).trim().toUpperCase();
  if (!raw) return undefined;
  if (/\b(SELL|SHORT|EXIT|CLOSE)\b/.test(raw)) return "SELL";
  if (/\b(BUY|LONG|ENTRY|OPEN)\b/.test(raw)) return "BUY";
  return undefined;
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

function nonEmptyString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function isShadowSymbol(value: unknown): value is ShadowSymbol {
  return typeof value === "string" && SHADOW_SYMBOLS.includes(value as ShadowSymbol);
}
