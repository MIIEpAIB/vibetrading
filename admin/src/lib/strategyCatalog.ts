import type { StrategyMarketAdminItem } from "@/lib/api";

const publicRouteIds: Record<string, string> = {
  "professional-grid-trading": "359806",
};

export const strategyMarketBaseline: StrategyMarketAdminItem[] = [
  ["quantclaw-ai-assistant", "built-in", "QuantClaw AI交易助手", ""],
  ["cross-platform-copy-trading", "built-in", "跨平台跟单策略", ""],
  ["professional-grid-trading", "built-in", "专业网格交易策略", ""],
  ["classic-turtle-trading", "built-in", "经典海龟交易策略", ""],
  ["multi-symbol-supertrend", "built-in", "多品种超级趋势策略", ""],
  ["cross-exchange-market-making", "built-in", "跨交易所做市商策略", ""],
  ["smart-dca", "built-in", "智能定投策略", ""],
  ["liquidity-market-making", "built-in", "流动性做市策略", ""],
  ["auto-step-grid", "built-in", "自动步进网格", ""],
  ["iceberg-twap", "built-in", "冰山委托TWAP策略", ""],
  ["crypto-trend-momentum", "built-in", "加密趋势动量策略", ""],
  ["crypto-perp-funding-carry", "built-in", "永续资金费率套利", ""],
  ["crypto-cross-exchange-spread", "built-in", "跨交易所价差套利", ""],
  ["crypto-stat-arb-pairs", "built-in", "加密统计套利配对", ""],
  ["crypto-vol-target-rotation", "built-in", "波动率目标轮动策略", ""],
  ["crypto-event-driven-risk", "built-in", "加密事件驱动策略", ""],
  ["binance-perp-funding-arbitrage", "paid", "币安永续资金费率套利", "50 USD/30 天"],
  ["perp-multi-symbol-grid", "paid", "永续合约多币种网格策略", "50 USD/30 天"],
  ["universal-perp-single-symbol-grid", "paid", "通用永续单币种网格策略", "50 USD/30 天"],
  ["perp-multi-symbol-balance", "paid", "永续合约多币种平衡策略", "50 USD/30 天"],
].map(([id, kind, name, price]) => ({
  id,
  kind,
  enabled: true,
  featured: false,
  price,
  status: "published",
  note: "",
  updated_at: "",
  name,
  deleted: false,
} satisfies StrategyMarketAdminItem));

export function mergeStrategyMarketItems(items: StrategyMarketAdminItem[]): StrategyMarketAdminItem[] {
  const remoteById = new Map(items.map((item) => [item.id, item]));
  const baselineIds = new Set(strategyMarketBaseline.map((item) => item.id));
  const merged = strategyMarketBaseline.map((item) => ({
    ...item,
    ...remoteById.get(item.id),
    name: remoteById.get(item.id)?.name || item.name,
  })).filter((item) => !item.deleted && item.status !== "archived");
  return [...merged, ...items.filter((item) => !baselineIds.has(item.id) && !item.deleted && item.status !== "archived")];
}

export function getStrategyRouteId(strategyId: string): string {
  if (/^\d+$/.test(strategyId)) return strategyId;
  if (publicRouteIds[strategyId]) return publicRouteIds[strategyId];
  let hash = 0;
  for (let index = 0; index < strategyId.length; index += 1) {
    hash = (hash * 31 + strategyId.charCodeAt(index)) >>> 0;
  }
  return String(100000000 + (hash % 900000000));
}

export function strategyEditUrl(strategyId: string): string {
  const path = `/m/edit-strategy/${encodeURIComponent(getStrategyRouteId(strategyId))}`;
  if (typeof window === "undefined") return path;
  if (window.location.hostname.startsWith("op.")) {
    const mainHost = window.location.hostname.replace(/^op\./, "");
    return `${window.location.protocol}//${mainHost}${path}`;
  }
  return path;
}
