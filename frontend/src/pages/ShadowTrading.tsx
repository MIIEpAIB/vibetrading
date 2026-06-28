import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ClipboardList,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Square,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type HistogramData,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  api,
  type CryptoKlineBar,
  type CryptoMarketRow,
  type PaperDeployment,
  type PaperDeploymentStatusResponse,
  type ShadowAccountResponse,
  type ShadowOrder,
  type ShadowWallet,
} from "@/lib/api";
import { loadShadowImportDraft, SHADOW_SYMBOLS, type ShadowImportDraft, type ShadowImportRunTrade } from "@/lib/shadowImport";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/I18nProvider";

const SYMBOLS = SHADOW_SYMBOLS;
const TAKER_FEE_RATE = 0.001;
const SLIPPAGE_RATE = 0.0005;
const ORDER_SOURCE_STORAGE_KEY = "vibe-shadow-order-sources";
const AGENT_STRATEGY_STORAGE_KEY = "vibe-shadow-agent-strategies";

const TIMEFRAMES = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1H" },
  { id: "4h", label: "4H" },
  { id: "1d", label: "1D" },
] as const;

const DEFAULT_MARKET_PRICES: Record<ShadowSymbol, number> = {
  BTC_USDT: 59_510.865,
  ETH_USDT: 3_500,
  SOL_USDT: 164,
  BNB_USDT: 655,
  XRP_USDT: 2.18,
};

const SHADOW_MARKET_LIMIT = SYMBOLS.length;
const MARKET_REFRESH_MS = 15_000;

const MARKET_META: Record<ShadowSymbol, { base: string; name: string; change: number; volume: number }> = {
  BTC_USDT: { base: "BTC", name: "Bitcoin", change: 2.84, volume: 1_720_000_000 },
  ETH_USDT: { base: "ETH", name: "Ethereum", change: 1.96, volume: 980_000_000 },
  SOL_USDT: { base: "SOL", name: "Solana", change: 4.2, volume: 420_000_000 },
  BNB_USDT: { base: "BNB", name: "BNB", change: -0.52, volume: 380_000_000 },
  XRP_USDT: { base: "XRP", name: "XRP", change: -1.31, volume: 280_000_000 },
};

const COPY = {
  en: {
    virtualPortfolio: "Demo trading",
    okxStyle: "Exchange-style spot desk",
    title: "Shadow Trading",
    subtitle: "K-line, order book, market/limit orders, and simulated TP/SL. All orders are virtual.",
    refresh: "Refresh",
    reset: "Reset",
    accountBalance: "Account balance",
    availableUsdt: "Available USDT",
    frozenUsdt: "Frozen USDT",
    orders: "Orders",
    filled: "filled",
    pending: "pending",
    feeModel: "Fee model",
    agentStrategies: "Agent imported strategies",
    agentStrategySubtitle: "Agent runtime, draft order, fills, and per-trade P/L.",
    noAgentStrategies: "No agent-imported strategies yet.",
    paperDeployments: "Paper strategy deployments",
    paperDeploymentSubtitle: "Strategies launched from the strategy library and running in the paper runtime.",
    noPaperDeployments: "No paper strategy deployments yet.",
    strategyTags: "Strategy tags",
    strategyTagLabels: {
      all: "All",
      grid: "Grid",
      dca: "DCA",
      arbitrage: "Arbitrage",
      signal: "Signal",
      risk: "Risk",
    },
    deploymentId: "Deployment",
    strategyName: "Strategy",
    paperLimits: "Limits",
    startedAt: "Started",
    latestSignal: "Latest signal",
    riskDecision: "Risk decision",
    latestTick: "Latest tick",
    paperOrder: "Paper order",
    funds: "Funds",
    cashBuffer: "Cash buffer",
    defaultNotional: "Default notional",
    runStrategy: "Run",
    stopStrategy: "Stop strategy",
    viewDetails: "Details",
    hideDetails: "Hide details",
    deleteStrategy: "Delete",
    strategyRunDone: "Strategy tick completed",
    strategyStarted: "Strategy started",
    strategyStopped: "Strategy stopped",
    strategyDeleted: "Strategy removed",
    activitySummary: "Activity summary",
    linkedOrder: "Linked order",
    importedAt: "Imported",
    orderStatus: "Order status",
    runPrompt: "Run prompt",
    runStatus: "Run status",
    runDirectory: "Run directory",
    runElapsed: "Elapsed",
    draftOrder: "Draft order",
    strategyRuntime: "Strategy runtime",
    tradeDetails: "Trade details",
    noTradeDetails: "No trade details yet.",
    tradeAmount: "Trade amount",
    filledValue: "Filled value",
    avgPrice: "Avg price",
    perTradePnl: "Per-trade P/L",
    pnlPercent: "P/L %",
    runLog: "Run log",
    shadowOrder: "Shadow order",
    warning: "Virtual orders only. Live crypto trading still requires a committed mandate, connector checks, confirm-mode, expiry, and kill switch.",
    markets: "Markets",
    search: "Search",
    chart: "Chart",
    orderBook: "Order book",
    price: "Price",
    amount: "Amount",
    total: "Total",
    ticketTitle: "Trade",
    symbol: "Symbol",
    buy: "Buy",
    sell: "Sell",
    limit: "Limit",
    market: "Market",
    tpsl: "TP/SL",
    orderMode: "Order type",
    tif: "Execution",
    gtc: "GTC",
    ioc: "IOC",
    fok: "FOK",
    postOnly: "Post-only",
    limitPrice: "Limit price",
    marketPrice: "Market price",
    triggerPrice: "Trigger price",
    triggerCondition: "Trigger condition",
    execution: "Execution",
    quantity: "Amount",
    notional: "Notional",
    estimatedQty: "Est. coin quantity",
    latest: "Latest",
    baseBalance: "Base balance",
    placeBuy: "Place Buy",
    placeSell: "Place Sell",
    placeTrigger: "Place TP/SL",
    marketTrigger: "Manual market price",
    update: "Update",
    importedDraftTitle: "Agent saved draft",
    importedDraftDesc: "Prefilled by an agent result.",
    importedSourceRun: "Run",
    importedSourceShadow: "Shadow profile",
    runImportedTest: "Run Agent Draft",
    dismissImport: "Dismiss",
    agentSaved: "Agent saved",
    manualSource: "Manual",
    wallets: "Assets",
    holdings: "Holdings",
    equity: "Coin equity",
    costPrice: "Cost",
    pnl: "P/L",
    trade: "Trade",
    positionValue: "Value",
    markPrice: "Mark",
    asset: "Asset",
    available: "Available",
    frozen: "Frozen",
    loading: "Loading...",
    noWalletRows: "No wallet rows.",
    openOrders: "Open orders",
    historyOrders: "Order history",
    paper: "Strategies",
    time: "Time",
    side: "Side",
    type: "Type",
    qty: "Qty",
    status: "Status",
    action: "Action",
    source: "Source",
    noOrders: "No orders yet.",
    cancel: "Cancel",
    liveReview: "Live readiness review",
    strategyCockpit: "Strategy cockpit",
    validationQuantity: "Amount must be positive.",
    validationLimitPrice: "Limit price must be positive.",
    validationMarketPrice: "Market price must be positive.",
    validationTriggerPrice: "Trigger price must be positive.",
    loadFailed: "Failed to load shadow account",
    placeFailed: "Failed to place order",
    updateFailed: "Failed to update market price",
    cancelFailed: "Failed to cancel order",
    resetFailed: "Failed to reset account",
    orderRejected: "Order rejected",
    orderCanceled: "Order canceled",
    triggerCanceled: "Trigger order canceled",
    accountReset: "Virtual account reset",
    marketUpdated: "Market price updated",
    triggerPlaced: "TP/SL trigger created",
    triggerFilled: "TP/SL trigger fired",
    importLoaded: "Agent result imported into the shadow ticket.",
    importFailed: "Could not import that agent result.",
    limitFilled: (count: number) => `${count} limit order${count > 1 ? "s" : ""} filled`,
    orderDone: (status: ShadowOrder["status"]) => `Order ${status.toLowerCase()}`,
    statusLabels: { PENDING: "Pending", PARTIALLY_FILLED: "Part filled", FILLED: "Filled", CANCELED: "Canceled", EXPIRED: "Expired", REJECTED: "Rejected" },
  },
  zh: {
    virtualPortfolio: "模拟交易",
    okxStyle: "交易所风格现货台",
    title: "影子模拟盘",
    subtitle: "K 线、盘口、市价/限价委托和模拟止盈止损。所有订单都是虚拟订单。",
    refresh: "刷新",
    reset: "重置",
    accountBalance: "账户余额",
    availableUsdt: "可用 USDT",
    frozenUsdt: "冻结 USDT",
    orders: "订单",
    filled: "已成交",
    pending: "挂单",
    feeModel: "费用模型",
    agentStrategies: "Agent 导入策略",
    agentStrategySubtitle: "展示 agent 运行、草稿委托、成交和每笔盈亏。",
    noAgentStrategies: "暂无 agent 导入策略。",
    paperDeployments: "模拟盘策略部署",
    paperDeploymentSubtitle: "从策略库启动并运行在模拟盘 runtime 中的策略。",
    noPaperDeployments: "暂无模拟盘策略部署。",
    strategyTags: "策略标签",
    strategyTagLabels: {
      all: "全部",
      grid: "网格",
      dca: "定投",
      arbitrage: "套利",
      signal: "信号",
      risk: "风控",
    },
    deploymentId: "部署",
    strategyName: "策略",
    paperLimits: "风控",
    startedAt: "启动时间",
    latestSignal: "最新信号",
    riskDecision: "风控决策",
    latestTick: "最新运行",
    paperOrder: "模拟订单",
    funds: "资金",
    cashBuffer: "现金缓冲",
    defaultNotional: "默认下单额",
    runStrategy: "运行",
    stopStrategy: "停止策略",
    viewDetails: "详情",
    hideDetails: "收起详情",
    deleteStrategy: "删除",
    strategyRunDone: "策略运行完成",
    strategyStarted: "策略已运行",
    strategyStopped: "策略已停止",
    strategyDeleted: "策略已删除",
    activitySummary: "运行详情",
    linkedOrder: "关联订单",
    importedAt: "导入时间",
    orderStatus: "订单状态",
    runPrompt: "运行指令",
    runStatus: "运行状态",
    runDirectory: "运行目录",
    runElapsed: "耗时",
    draftOrder: "草稿委托",
    strategyRuntime: "策略运行",
    tradeDetails: "交易明细",
    noTradeDetails: "暂无交易明细。",
    tradeAmount: "交易金额",
    filledValue: "成交金额",
    avgPrice: "均价",
    perTradePnl: "每笔盈亏",
    pnlPercent: "盈亏率",
    runLog: "运行日志",
    shadowOrder: "影子订单",
    warning: "这里仅产生虚拟订单。加密实盘仍必须经过授权、连接器检查、先确认模式、自动过期和熔断规则。",
    markets: "币种",
    search: "搜索",
    chart: "K线",
    orderBook: "盘口",
    price: "价格",
    amount: "数量",
    total: "累计",
    ticketTitle: "下单",
    symbol: "交易对",
    buy: "买入",
    sell: "卖出",
    limit: "限价",
    market: "市价",
    tpsl: "止盈止损",
    orderMode: "委托类型",
    tif: "执行策略",
    gtc: "普通限价",
    ioc: "IOC",
    fok: "FOK",
    postOnly: "只做 Maker",
    limitPrice: "委托价格",
    marketPrice: "市价成交",
    triggerPrice: "触发价格",
    triggerCondition: "触发条件",
    execution: "执行方式",
    quantity: "数量/金额",
    notional: "交易额",
    estimatedQty: "预计币种数量",
    latest: "最新价",
    baseBalance: "币种余额",
    placeBuy: "买入",
    placeSell: "卖出",
    placeTrigger: "提交止盈止损",
    marketTrigger: "手动行情价",
    update: "更新",
    importedDraftTitle: "Agent 保存草稿",
    importedDraftDesc: "该下单草稿来自 agent 结果。",
    importedSourceRun: "运行",
    importedSourceShadow: "影子档案",
    runImportedTest: "运行 Agent 草稿",
    dismissImport: "关闭",
    agentSaved: "Agent 保存",
    manualSource: "手动",
    wallets: "资产",
    holdings: "持仓",
    equity: "币种权益",
    costPrice: "成本价",
    pnl: "涨跌",
    trade: "买卖",
    positionValue: "估值",
    markPrice: "标记价",
    asset: "资产",
    available: "可用",
    frozen: "冻结",
    loading: "加载中...",
    noWalletRows: "暂无钱包记录。",
    openOrders: "当前委托",
    historyOrders: "历史委托",
    paper: "策略",
    time: "时间",
    side: "方向",
    type: "类型",
    qty: "数量",
    status: "状态",
    action: "操作",
    source: "来源",
    noOrders: "暂无订单。",
    cancel: "撤单",
    liveReview: "实盘就绪审查",
    strategyCockpit: "策略驾驶舱",
    validationQuantity: "数量/金额必须大于 0。",
    validationLimitPrice: "委托价格必须大于 0。",
    validationMarketPrice: "行情价格必须大于 0。",
    validationTriggerPrice: "触发价格必须大于 0。",
    loadFailed: "加载影子账户失败",
    placeFailed: "提交订单失败",
    updateFailed: "更新行情失败",
    cancelFailed: "撤单失败",
    resetFailed: "重置账户失败",
    orderRejected: "订单被拒绝",
    orderCanceled: "订单已取消",
    triggerCanceled: "止盈止损已撤销",
    accountReset: "虚拟账户已重置",
    marketUpdated: "行情价格已更新",
    triggerPlaced: "止盈止损触发单已创建",
    triggerFilled: "止盈止损已触发",
    importLoaded: "已将 agent 结果导入影子下单面板。",
    importFailed: "无法导入该 agent 结果。",
    limitFilled: (count: number) => `${count} 笔限价单已成交`,
    orderDone: (status: ShadowOrder["status"]) => `订单${COPY.zh.statusLabels[status]}`,
    statusLabels: { PENDING: "挂单", PARTIALLY_FILLED: "部分成交", FILLED: "已成交", CANCELED: "已取消", EXPIRED: "已过期", REJECTED: "已拒绝" },
  },
} as const;

type ShadowSymbol = (typeof SYMBOLS)[number];
type ShadowCopy = (typeof COPY)[keyof typeof COPY];
type Timeframe = (typeof TIMEFRAMES)[number]["id"];
type OrderMode = "LIMIT" | "MARKET" | "TPSL";
type BottomTab = "open" | "history" | "assets" | "paper";
type QuantityUnit = "BASE" | "QUOTE";
type TimeInForce = "GTC" | "IOC" | "FOK" | "POST_ONLY";
type StrategyTagId = "all" | "grid" | "dca" | "arbitrage" | "signal" | "risk";

const STRATEGY_TAGS: StrategyTagId[] = ["all", "grid", "dca", "arbitrage", "signal", "risk"];

const SHADOW_ORDER_STATUS_VALUES: ShadowOrder["status"][] = [
  "PENDING",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "EXPIRED",
  "REJECTED",
];

interface AgentOrderSource {
  source: "agent_result";
  createdAt: number;
  runId?: string;
  shadowId?: string;
}

interface AgentStrategyRecord {
  id: string;
  source: "agent_result";
  createdAt: number;
  updatedAt: number;
  runId?: string;
  shadowId?: string;
  symbol: ShadowSymbol;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  prompt?: string;
  runStatus?: string;
  runStage?: string;
  runDirectory?: string;
  elapsedSeconds?: number;
  tradeCount?: number;
  metrics?: ShadowImportDraft["metrics"];
  trades?: ShadowImportRunTrade[];
  orderId?: string;
  orderStatus?: ShadowOrder["status"];
  executedPrice?: number;
  filledQuantity?: number;
  rejectionReason?: string;
}

interface MarketRow {
  symbol: ShadowSymbol;
  base: string;
  name: string;
  price: number;
  change: number;
  volume: number;
}

interface BookLevel {
  price: number;
  amount: number;
  total: number;
}

interface PositionRow {
  asset: string;
  symbol: ShadowSymbol;
  equity: number;
  available: number;
  frozen: number;
  costPrice: number;
  markPrice: number;
  value: number;
  pnl: number;
  pnlPercent: number;
}

interface LiveMarketSnapshot {
  prices: Partial<Record<ShadowSymbol, number>>;
  changes: Partial<Record<ShadowSymbol, number>>;
  rows: Partial<Record<ShadowSymbol, CryptoMarketRow>>;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(4)}`;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (Math.abs(value) >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return value.toPrecision(5);
}

function formatQty(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (Math.abs(value) >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return value.toPrecision(6);
}

function formatInputPrice(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 100) return String(Math.round(value * 100) / 100);
  return String(Number(value.toFixed(5)));
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toChartTime(timestamp: number): UTCTimestamp {
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

function toApiSymbol(symbol: ShadowSymbol): string {
  return symbol.replace("_", "/");
}

function toShadowSymbol(symbol: string): ShadowSymbol | null {
  let normalized = symbol.replace("/", "_").toUpperCase();
  if (!normalized.includes("_") && normalized.endsWith("USDT")) {
    normalized = `${normalized.slice(0, -4)}_USDT`;
  } else if (!normalized.includes("_")) {
    normalized = `${normalized}_USDT`;
  }
  return SYMBOLS.includes(normalized as ShadowSymbol) ? normalized as ShadowSymbol : null;
}

function baseAsset(symbol: string): string {
  return symbol.split("_")[0] || symbol;
}

function normalizeStrategyText(...values: Array<unknown>): string {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string | number | boolean => ["string", "number", "boolean"].includes(typeof value))
    .join(" ")
    .toLowerCase();
}

function strategyTextTag(text: string): Exclude<StrategyTagId, "all"> {
  if (/(grid|网格|step)/.test(text)) return "grid";
  if (/(dca|定投|portfolio|rotation|组合|轮动)/.test(text)) return "dca";
  if (/(arb|arbitrage|spread|pairs|funding|carry|market-neutral|套利|价差|配对|资金费率)/.test(text)) return "arbitrage";
  if (/(risk|hedge|stop|tpsl|drawdown|风控|对冲|止损|止盈|回撤)/.test(text)) return "risk";
  return "signal";
}

function paperDeploymentStrategyTag(deployment: PaperDeployment): Exclude<StrategyTagId, "all"> {
  const snapshot = deployment.strategy_snapshot;
  return strategyTextTag(normalizeStrategyText(
    snapshot.category,
    snapshot.tags,
    snapshot.name,
    snapshot.description,
    deployment.strategy_id,
    deployment.limits.order_type,
  ));
}

function agentStrategyTag(record: AgentStrategyRecord): Exclude<StrategyTagId, "all"> {
  return strategyTextTag(normalizeStrategyText(
    record.prompt,
    record.runStage,
    record.runStatus,
    record.orderType,
    record.trades?.map((trade) => trade.note),
  ));
}

function normalizeOrderStatus(value: unknown): ShadowOrder["status"] | undefined {
  return SHADOW_ORDER_STATUS_VALUES.includes(value as ShadowOrder["status"])
    ? value as ShadowOrder["status"]
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveFiniteNumber(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function optionalText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function readAgentOrderSources(): Record<string, AgentOrderSource> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ORDER_SOURCE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const sources: Record<string, AgentOrderSource> = {};
    for (const [orderId, rawSource] of Object.entries(parsed as Record<string, unknown>)) {
      if (!rawSource || typeof rawSource !== "object" || Array.isArray(rawSource)) continue;
      const source = rawSource as Record<string, unknown>;
      if (source.source !== "agent_result") continue;
      sources[orderId] = {
        source: "agent_result",
        createdAt: Number(source.createdAt) || Date.now(),
        runId: typeof source.runId === "string" ? source.runId : undefined,
        shadowId: typeof source.shadowId === "string" ? source.shadowId : undefined,
      };
    }
    return sources;
  } catch {
    return {};
  }
}

function writeAgentOrderSources(sources: Record<string, AgentOrderSource>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORDER_SOURCE_STORAGE_KEY, JSON.stringify(sources));
  } catch { /* ignore storage failures */ }
}

function strategyRecordId(draft: ShadowImportDraft): string {
  return draft.runId || draft.shadowId || `agent_${draft.createdAt}`;
}

function recordFromDraft(draft: ShadowImportDraft): AgentStrategyRecord {
  return {
    id: strategyRecordId(draft),
    source: "agent_result",
    createdAt: draft.createdAt,
    updatedAt: Date.now(),
    runId: draft.runId,
    shadowId: draft.shadowId,
    symbol: draft.symbol,
    side: draft.side,
    orderType: draft.orderType,
    quantity: draft.quantity,
    price: draft.price,
    prompt: draft.run?.prompt,
    runStatus: draft.run?.status,
    runStage: draft.run?.run_stage,
    runDirectory: draft.run?.run_directory,
    elapsedSeconds: draft.run?.elapsed_seconds,
    tradeCount: draft.run?.trade_count,
    metrics: draft.metrics,
    trades: draft.run?.trades,
  };
}

function sanitizeAgentRunTrade(value: unknown, fallbackSymbol: ShadowSymbol): ShadowImportRunTrade | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const symbol = toShadowSymbol(String(raw.symbol || "")) ?? fallbackSymbol;
  const quantity = positiveFiniteNumber(raw.quantity);
  const price = positiveFiniteNumber(raw.price);
  const notional = positiveFiniteNumber(raw.notional) ?? (quantity && price ? quantity * price : undefined);
  const pnl = finiteNumber(raw.pnl);
  const pnlPercent = finiteNumber(raw.pnl_percent);
  if (!quantity && !price && !notional && pnl === undefined) return null;
  return {
    source: raw.source === "shadow_order" ? "shadow_order" : "run_log",
    symbol,
    side: raw.side === "SELL" ? "SELL" : raw.side === "BUY" ? "BUY" : undefined,
    quantity,
    price,
    notional,
    pnl,
    pnl_percent: pnlPercent,
    opened_at: optionalText(raw.opened_at),
    closed_at: optionalText(raw.closed_at),
    note: optionalText(raw.note),
  };
}

function sanitizeAgentRunTrades(value: unknown, fallbackSymbol: ShadowSymbol): ShadowImportRunTrade[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const trades = value
    .map((item) => sanitizeAgentRunTrade(item, fallbackSymbol))
    .filter((trade): trade is ShadowImportRunTrade => Boolean(trade))
    .slice(-30);
  return trades.length ? trades : undefined;
}

function tradeFromShadowOrder(order: ShadowOrder, draft: ShadowImportDraft): ShadowImportRunTrade | null {
  const symbol = toShadowSymbol(order.symbol) ?? draft.symbol;
  const quantity = positiveFiniteNumber(order.filled_quantity ?? order.quantity) ?? draft.quantity;
  const price = positiveFiniteNumber(order.executed_price || order.average_price || order.price || draft.price);
  const notional = positiveFiniteNumber(order.executed_value) ?? (quantity && price ? quantity * price : undefined);
  if (!quantity && !price && !notional) return null;
  return {
    source: "shadow_order",
    symbol,
    side: order.side,
    quantity,
    price,
    notional,
    opened_at: new Date((order.updated_at || order.timestamp) * 1000).toISOString(),
    note: order.rejection_reason || order.status,
  };
}

function sanitizeAgentStrategyRecord(value: unknown): AgentStrategyRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const symbol = toShadowSymbol(String(raw.symbol || ""));
  if (!symbol) return null;
  const quantity = Number(raw.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `agent_${Number(raw.createdAt) || Date.now()}`;
  const side = raw.side === "SELL" ? "SELL" : "BUY";
  const orderType = raw.orderType === "LIMIT" ? "LIMIT" : "MARKET";
  const status = normalizeOrderStatus(raw.orderStatus);
  return {
    id,
    source: "agent_result",
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
    runId: typeof raw.runId === "string" ? raw.runId : undefined,
    shadowId: typeof raw.shadowId === "string" ? raw.shadowId : undefined,
    symbol,
    side,
    orderType,
    quantity,
    price: Number.isFinite(Number(raw.price)) && Number(raw.price) > 0 ? Number(raw.price) : undefined,
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    runStatus: typeof raw.runStatus === "string" ? raw.runStatus : undefined,
    runStage: typeof raw.runStage === "string" ? raw.runStage : undefined,
    runDirectory: typeof raw.runDirectory === "string" ? raw.runDirectory : undefined,
    elapsedSeconds: Number.isFinite(Number(raw.elapsedSeconds)) ? Number(raw.elapsedSeconds) : undefined,
    tradeCount: Number.isFinite(Number(raw.tradeCount)) ? Number(raw.tradeCount) : undefined,
    metrics: raw.metrics && typeof raw.metrics === "object" && !Array.isArray(raw.metrics)
      ? raw.metrics as ShadowImportDraft["metrics"]
      : undefined,
    trades: sanitizeAgentRunTrades(raw.trades, symbol),
    orderId: typeof raw.orderId === "string" ? raw.orderId : undefined,
    orderStatus: status,
    executedPrice: Number.isFinite(Number(raw.executedPrice)) ? Number(raw.executedPrice) : undefined,
    filledQuantity: Number.isFinite(Number(raw.filledQuantity)) ? Number(raw.filledQuantity) : undefined,
    rejectionReason: typeof raw.rejectionReason === "string" ? raw.rejectionReason : undefined,
  };
}

function readAgentStrategies(): AgentStrategyRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(AGENT_STRATEGY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeAgentStrategyRecord)
      .filter((item): item is AgentStrategyRecord => Boolean(item))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
  } catch {
    return [];
  }
}

function writeAgentStrategies(records: AgentStrategyRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AGENT_STRATEGY_STORAGE_KEY, JSON.stringify(records.slice(0, 20)));
  } catch { /* ignore storage failures */ }
}

function intervalMs(timeframe: Timeframe): number {
  if (timeframe === "1m") return 60_000;
  if (timeframe === "5m") return 5 * 60_000;
  if (timeframe === "15m") return 15 * 60_000;
  if (timeframe === "4h") return 4 * 60 * 60_000;
  if (timeframe === "1d") return 24 * 60 * 60_000;
  return 60 * 60_000;
}

function buildFallbackBars(symbol: ShadowSymbol, timeframe: Timeframe, limit = 180): CryptoKlineBar[] {
  const start = DEFAULT_MARKET_PRICES[symbol];
  const meta = MARKET_META[symbol];
  const step = intervalMs(timeframe);
  const now = Date.now();
  const seed = meta.base.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  let close = start * (1 - meta.change / 100);
  const bars: CryptoKlineBar[] = [];

  for (let index = 0; index < limit; index += 1) {
    const timestamp = now - (limit - index - 1) * step;
    const open = close;
    const move = Math.sin((index + seed) * 0.23) * 0.004 + Math.cos((index + seed) * 0.07) * 0.002;
    close = Math.max(open * (1 + move), 0.000001);
    const high = Math.max(open, close) * (1 + 0.002 + Math.abs(Math.sin(index + seed)) * 0.002);
    const low = Math.min(open, close) * (1 - 0.002 - Math.abs(Math.cos(index + seed)) * 0.002);
    const volume = (meta.volume / 24) * (0.7 + Math.abs(Math.sin(index * 0.31 + seed)) * 0.7);
    bars.push({ time: new Date(timestamp).toISOString(), timestamp, symbol: toApiSymbol(symbol), open, high, low, close, volume });
  }
  return bars;
}

function marketStats(bars: CryptoKlineBar[], fallbackPrice: number, fallbackChange: number) {
  const recent = bars.slice(-24);
  const last = bars.length ? bars[bars.length - 1].close : fallbackPrice;
  const open = recent[0]?.open || last / (1 + fallbackChange / 100);
  const high = recent.reduce((max, bar) => Math.max(max, bar.high), last);
  const low = recent.reduce((min, bar) => Math.min(min, bar.low), last);
  const volume = recent.reduce((sum, bar) => sum + bar.volume, 0);
  const change = open ? ((last - open) / open) * 100 : fallbackChange;
  return { last, open, high, low, volume, change };
}

function buildLiveMarketSnapshot(rows: Array<{ symbol: string; price: number; change_24h: number }>): LiveMarketSnapshot {
  const prices: Partial<Record<ShadowSymbol, number>> = {};
  const changes: Partial<Record<ShadowSymbol, number>> = {};
  const marketRows: Partial<Record<ShadowSymbol, CryptoMarketRow>> = {};

  for (const row of rows) {
    const symbol = toShadowSymbol(row.symbol);
    if (!symbol) continue;
    if (Number.isFinite(row.price) && row.price > 0) prices[symbol] = row.price;
    if (Number.isFinite(row.change_24h)) changes[symbol] = row.change_24h;
    marketRows[symbol] = row as CryptoMarketRow;
  }

  return { prices, changes, rows: marketRows };
}

function canSyncMarketSourceToShadow(source: string): boolean {
  return !source.trim().toLowerCase().startsWith("fallback");
}

function alignBarsToReferencePrice(bars: CryptoKlineBar[], referencePrice: number): CryptoKlineBar[] {
  if (!bars.length || !Number.isFinite(referencePrice) || referencePrice <= 0) return bars;
  const last = bars[bars.length - 1]?.close;
  if (!Number.isFinite(last) || last <= 0) return bars;
  const factor = referencePrice / last;
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 0.000001) return bars;
  return bars.map((bar) => ({
    ...bar,
    open: bar.open * factor,
    high: bar.high * factor,
    low: bar.low * factor,
    close: bar.close * factor,
  }));
}

function resolveTicketAmount(input: string, unit: QuantityUnit, price: number) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { input: parsed, quantity: NaN, notional: NaN };
  }
  if (unit === "QUOTE") {
    if (!Number.isFinite(price) || price <= 0) {
      return { input: parsed, quantity: NaN, notional: parsed };
    }
    return { input: parsed, quantity: parsed / price, notional: parsed };
  }
  return {
    input: parsed,
    quantity: parsed,
    notional: Number.isFinite(price) && price > 0 ? parsed * price : NaN,
  };
}

function buildPositions(wallets: ShadowWallet[], orders: ShadowOrder[], marketPrices: Record<string, number>): PositionRow[] {
  const costState = new Map<string, { quantity: number; cost: number }>();
  const chronological = [...orders]
    .filter((order) => order.status === "FILLED" || order.status === "PARTIALLY_FILLED")
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const order of chronological) {
    const asset = baseAsset(order.symbol);
    if (!SYMBOLS.includes(order.symbol as ShadowSymbol)) continue;
    const filledQty = order.filled_quantity ?? order.quantity;
    const avgPrice = order.executed_price || order.average_price || order.price;
    if (!Number.isFinite(filledQty) || filledQty <= 0 || !Number.isFinite(avgPrice) || avgPrice <= 0) continue;
    const current = costState.get(asset) ?? { quantity: 0, cost: 0 };
    if (order.side === "BUY") {
      const fee = order.fee_asset === "USDT" ? order.fee_paid ?? 0 : 0;
      current.quantity += filledQty;
      current.cost += filledQty * avgPrice + fee;
    } else {
      const reduction = Math.min(filledQty, current.quantity);
      const avgCost = current.quantity > 0 ? current.cost / current.quantity : avgPrice;
      current.quantity = Math.max(current.quantity - reduction, 0);
      current.cost = Math.max(current.cost - reduction * avgCost, 0);
    }
    costState.set(asset, current);
  }

  return wallets
    .filter((wallet) => wallet.asset_name !== "USDT" && wallet.asset_name !== "USD" && wallet.equity > 0)
    .map((wallet) => {
      const symbol = `${wallet.asset_name}_USDT` as ShadowSymbol;
      const state = costState.get(wallet.asset_name);
      const costPrice = state && state.quantity > 0 ? state.cost / state.quantity : 0;
      const markPrice = marketPrices[symbol] ?? DEFAULT_MARKET_PRICES[symbol] ?? 0;
      const value = wallet.equity * markPrice;
      const costValue = wallet.equity * costPrice;
      const pnl = costPrice > 0 ? value - costValue : 0;
      const pnlPercent = costValue > 0 ? (pnl / costValue) * 100 : 0;
      return {
        asset: wallet.asset_name,
        symbol,
        equity: wallet.equity,
        available: wallet.balance,
        frozen: wallet.frozen,
        costPrice,
        markPrice,
        value,
        pnl,
        pnlPercent,
      };
    })
    .sort((a, b) => b.value - a.value);
}

function buildOrderBook(price: number, symbol: ShadowSymbol): { asks: BookLevel[]; bids: BookLevel[] } {
  const base = Math.max(price, DEFAULT_MARKET_PRICES[symbol]);
  const priceStep = Math.max(base * 0.00035, base >= 100 ? 1 : 0.001);
  const seed = MARKET_META[symbol].base.charCodeAt(0);
  const asks: BookLevel[] = [];
  const bids: BookLevel[] = [];
  let askTotal = 0;
  let bidTotal = 0;

  for (let index = 1; index <= 12; index += 1) {
    const askAmount = Number((0.02 + Math.abs(Math.sin(seed + index)) * 1.6).toFixed(5));
    const bidAmount = Number((0.02 + Math.abs(Math.cos(seed + index)) * 1.6).toFixed(5));
    askTotal += askAmount;
    bidTotal += bidAmount;
    asks.push({ price: price + priceStep * index, amount: askAmount, total: askTotal });
    bids.push({ price: Math.max(price - priceStep * index, 0.000001), amount: bidAmount, total: bidTotal });
  }

  return { asks: asks.reverse(), bids };
}

export function ShadowTrading() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { language } = useTranslation();
  const c = language === "zh-CN" ? COPY.zh : COPY.en;
  const [account, setAccount] = useState<ShadowAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [klineLoading, setKlineLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [importDraft, setImportDraft] = useState<ShadowImportDraft | null>(null);
  const [agentOrderSources, setAgentOrderSources] = useState<Record<string, AgentOrderSource>>(() => readAgentOrderSources());
  const [agentStrategies, setAgentStrategies] = useState<AgentStrategyRecord[]>(() => readAgentStrategies());
  const [paperDeployments, setPaperDeployments] = useState<PaperDeployment[]>([]);
  const [paperStatuses, setPaperStatuses] = useState<Record<string, PaperDeploymentStatusResponse>>({});
  const [paperLoading, setPaperLoading] = useState(false);
  const [paperActionId, setPaperActionId] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Partial<Record<ShadowSymbol, number>>>({});
  const [liveChanges, setLiveChanges] = useState<Partial<Record<ShadowSymbol, number>>>({});
  const [liveMarketRows, setLiveMarketRows] = useState<Partial<Record<ShadowSymbol, CryptoMarketRow>>>({});
  const [symbol, setSymbol] = useState<ShadowSymbol>("BTC_USDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [bars, setBars] = useState<CryptoKlineBar[]>(() => buildFallbackBars("BTC_USDT", "1h"));
  const [marketQuery, setMarketQuery] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderMode, setOrderMode] = useState<OrderMode>("LIMIT");
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("GTC");
  const [quantity, setQuantity] = useState("0.1");
  const [quantityUnit, setQuantityUnit] = useState<QuantityUnit>("BASE");
  const [limitPrice, setLimitPrice] = useState(() => formatInputPrice(DEFAULT_MARKET_PRICES.BTC_USDT));
  const [priceUpdate, setPriceUpdate] = useState(() => formatInputPrice(DEFAULT_MARKET_PRICES.BTC_USDT));
  const [triggerPrice, setTriggerPrice] = useState(() => formatInputPrice(DEFAULT_MARKET_PRICES.BTC_USDT * 1.01));
  const [triggerCondition, setTriggerCondition] = useState<"GTE" | "LTE">("GTE");
  const [triggerExecutionType, setTriggerExecutionType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [triggerOrderPrice, setTriggerOrderPrice] = useState("62000");
  const [bottomTab, setBottomTab] = useState<BottomTab>("open");
  const [strategyTag, setStrategyTag] = useState<StrategyTagId>("all");
  const activePaperDeploymentId = searchParams.get("paper") || "";

  const wallets = useMemo(() => account?.wallets ?? [], [account]);
  const orders = useMemo(() => account?.orders ?? [], [account]);
  const pendingOrders = useMemo(() => orders.filter((order) => order.status === "PENDING" || order.status === "PARTIALLY_FILLED"), [orders]);
  const filledOrders = useMemo(() => orders.filter((order) => order.status === "FILLED"), [orders]);
  const rejectedOrders = useMemo(() => orders.filter((order) => order.status === "REJECTED"), [orders]);
  const availableUsdt = wallets.find((wallet) => wallet.asset_name === "USDT")?.balance ?? 0;
  const frozenUsdt = wallets.find((wallet) => wallet.asset_name === "USDT")?.frozen ?? 0;
  const selectedBaseAsset = baseAsset(symbol);
  const selectedBaseBalance = wallets.find((wallet) => wallet.asset_name === selectedBaseAsset)?.balance ?? 0;
  const selectedLiveRow = liveMarketRows[symbol];
  const rawMarketPrice = livePrices[symbol] ?? account?.market_prices[symbol] ?? DEFAULT_MARKET_PRICES[symbol];
  const alignedBars = useMemo(
    () => alignBarsToReferencePrice(bars, rawMarketPrice),
    [bars, rawMarketPrice],
  );
  const chartStats = useMemo(
    () => marketStats(alignedBars, rawMarketPrice, MARKET_META[symbol].change),
    [alignedBars, rawMarketPrice, symbol],
  );

  useEffect(() => {
    if (activePaperDeploymentId) {
      setBottomTab("paper");
    }
  }, [activePaperDeploymentId]);

  const refreshPaperDeployments = useCallback(async (cancelled: () => boolean = () => false) => {
    setPaperLoading(true);
    try {
      const payload = await api.listPaperDeployments();
      if (cancelled()) return;
      const visibleDeployments = payload.deployments.filter((deployment) => deployment.status !== "archived");
      setPaperDeployments(visibleDeployments);
      const statusPairs = await Promise.all(visibleDeployments.map(async (deployment) => {
        try {
          const status = await api.getPaperDeploymentStatus(deployment.deployment_id);
          return [deployment.deployment_id, status] as const;
        } catch {
          return null;
        }
      }));
      if (!cancelled()) {
        setPaperStatuses(Object.fromEntries(statusPairs.filter((item): item is [string, PaperDeploymentStatusResponse] => Boolean(item))));
      }
    } catch {
      if (!cancelled()) {
        setPaperDeployments([]);
        setPaperStatuses({});
      }
    } finally {
      if (!cancelled()) setPaperLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshPaperDeployments(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refreshPaperDeployments]);

  const togglePaperStrategyStatus = async (deployment: PaperDeployment) => {
    const deploymentId = deployment.deployment_id;
    setPaperActionId(deploymentId);
    try {
      if (deployment.status === "running") {
        await api.pausePaperDeployment(deploymentId);
        toast.success(c.strategyStopped);
      } else if (deployment.status === "paused") {
        await api.resumePaperDeployment(deploymentId);
        await api.runPaperDeploymentTick(deploymentId).catch(() => undefined);
        toast.success(c.strategyStarted);
      } else {
        await api.startPaperDeployment(deploymentId);
        await api.runPaperDeploymentTick(deploymentId).catch(() => undefined);
        toast.success(c.strategyStarted);
      }
      await refreshPaperDeployments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : c.resetFailed);
    } finally {
      setPaperActionId(null);
    }
  };

  const togglePaperDetails = (deploymentId: string) => {
    const next = new URLSearchParams(searchParams);
    if (activePaperDeploymentId === deploymentId) {
      next.delete("paper");
    } else {
      next.set("paper", deploymentId);
    }
    setSearchParams(next, { replace: true });
  };

  const deletePaperStrategy = async (deploymentId: string) => {
    setPaperActionId(deploymentId);
    try {
      await api.archivePaperDeployment(deploymentId);
      setPaperDeployments((current) => current.filter((deployment) => deployment.deployment_id !== deploymentId));
      setPaperStatuses((current) => {
        const next = { ...current };
        delete next[deploymentId];
        return next;
      });
      await refreshPaperDeployments();
      toast.success(c.strategyDeleted);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : c.resetFailed);
    } finally {
      setPaperActionId(null);
    }
  };

  const deleteAgentStrategy = (strategyId: string) => {
    setAgentStrategies((current) => {
      const next = current.filter((record) => record.id !== strategyId);
      writeAgentStrategies(next);
      return next;
    });
    toast.success(c.strategyDeleted);
  };
  const stats = useMemo(() => {
    if (!selectedLiveRow) return chartStats;
    const last = Number.isFinite(selectedLiveRow.price) && selectedLiveRow.price > 0
      ? selectedLiveRow.price
      : chartStats.last;
    const change = Number.isFinite(selectedLiveRow.change_24h)
      ? selectedLiveRow.change_24h
      : chartStats.change;
    const high = Number.isFinite(selectedLiveRow.high_24h) && selectedLiveRow.high_24h > 0
      ? selectedLiveRow.high_24h
      : Math.max(chartStats.high, last);
    const low = Number.isFinite(selectedLiveRow.low_24h) && selectedLiveRow.low_24h > 0
      ? selectedLiveRow.low_24h
      : Math.min(chartStats.low, last);
    const quoteVolume = Number.isFinite(selectedLiveRow.quote_volume_24h) && selectedLiveRow.quote_volume_24h > 0
      ? selectedLiveRow.quote_volume_24h
      : Number.isFinite(selectedLiveRow.volume_24h) && selectedLiveRow.volume_24h > 0
        ? selectedLiveRow.volume_24h * last
        : chartStats.volume;
    return {
      ...chartStats,
      last,
      high,
      low,
      volume: quoteVolume,
      change,
    };
  }, [chartStats, selectedLiveRow]);
  const displayPrice = stats.last || rawMarketPrice;
  const orderPrice = orderMode === "LIMIT" ? Number(limitPrice) : displayPrice;
  const ticketAmount = resolveTicketAmount(quantity, quantityUnit, orderPrice);
  const estimatedQuantity = ticketAmount.quantity;
  const estimatedNotional = ticketAmount.notional;
  const markets = useMemo<MarketRow[]>(() => {
    return SYMBOLS.map((item) => {
      const meta = MARKET_META[item];
      return {
        symbol: item,
        base: meta.base,
        name: meta.name,
        price: livePrices[item] ?? account?.market_prices[item] ?? DEFAULT_MARKET_PRICES[item],
        change: liveChanges[item] ?? meta.change,
        volume: liveMarketRows[item]?.quote_volume_24h ?? meta.volume,
      };
    });
  }, [account, liveChanges, liveMarketRows, livePrices]);
  const filteredMarkets = useMemo(() => {
    const query = marketQuery.trim().toLowerCase();
    if (!query) return markets;
    return markets.filter((row) => row.symbol.toLowerCase().includes(query) || row.name.toLowerCase().includes(query));
  }, [marketQuery, markets]);
  const orderBook = useMemo(() => buildOrderBook(displayPrice, symbol), [displayPrice, symbol]);
  const openBackendOrders = useMemo(
    () => orders.filter((order) => order.status === "PENDING" || order.status === "PARTIALLY_FILLED"),
    [orders],
  );
  const historyBackendOrders = useMemo(
    () => orders.filter((order) => order.status !== "PENDING" && order.status !== "PARTIALLY_FILLED"),
    [orders],
  );
  const positionMarketPrices = useMemo(
    () => ({ ...(account?.market_prices ?? {}), ...livePrices }),
    [account, livePrices],
  );
  const positions = useMemo(
    () => buildPositions(wallets, orders, positionMarketPrices),
    [wallets, orders, positionMarketPrices],
  );
  const strategyTagCounts = useMemo(() => {
    const counts = Object.fromEntries(STRATEGY_TAGS.map((tag) => [tag, 0])) as Record<StrategyTagId, number>;
    for (const deployment of paperDeployments) {
      counts.all += 1;
      counts[paperDeploymentStrategyTag(deployment)] += 1;
    }
    for (const record of agentStrategies) {
      counts.all += 1;
      counts[agentStrategyTag(record)] += 1;
    }
    return counts;
  }, [agentStrategies, paperDeployments]);
  const filteredPaperDeployments = useMemo(
    () => strategyTag === "all"
      ? paperDeployments
      : paperDeployments.filter((deployment) => paperDeploymentStrategyTag(deployment) === strategyTag),
    [paperDeployments, strategyTag],
  );
  const filteredAgentStrategies = useMemo(
    () => strategyTag === "all"
      ? agentStrategies
      : agentStrategies.filter((record) => agentStrategyTag(record) === strategyTag),
    [agentStrategies, strategyTag],
  );

  const loadAccount = async () => {
    setLoading(true);
    try {
      setAccount(await api.getShadowAccount());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : c.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccount();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshLiveMarkets = async () => {
      try {
        const payload = await api.getCryptoMarkets(SHADOW_MARKET_LIMIT);
        if (cancelled) return;
        const snapshot = buildLiveMarketSnapshot(payload.rows);
        setLivePrices((current) => ({ ...current, ...snapshot.prices }));
        setLiveChanges((current) => ({ ...current, ...snapshot.changes }));
        setLiveMarketRows((current) => ({ ...current, ...snapshot.rows }));
        let refreshedAccount: ShadowAccountResponse | null = null;
        if (canSyncMarketSourceToShadow(payload.source)) {
          for (const marketSymbol of SYMBOLS) {
            if (cancelled) return;
            const marketPrice = snapshot.prices[marketSymbol];
            if (typeof marketPrice !== "number" || !Number.isFinite(marketPrice) || marketPrice <= 0) continue;
            const result = await api.updateShadowMarketPrice({ symbol: marketSymbol, price: marketPrice });
            refreshedAccount = result.account;
          }
        }
        if (refreshedAccount) {
          if (!cancelled) setAccount(refreshedAccount);
          return;
        }
        const accountSnapshot = await api.getShadowAccount();
        if (!cancelled) setAccount(accountSnapshot);
      } catch {
        // Keep the last successful snapshot; the simulated account still provides a fallback price.
      }
    };

    void refreshLiveMarkets();
    const timer = window.setInterval(() => void refreshLiveMarkets(), MARKET_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setKlineLoading(true);
    api.getCryptoKlines(toApiSymbol(symbol), timeframe, 180)
      .then((payload) => {
        if (!cancelled) setBars(payload.bars.length ? payload.bars : buildFallbackBars(symbol, timeframe));
      })
      .catch(() => {
        if (!cancelled) setBars(buildFallbackBars(symbol, timeframe));
      })
      .finally(() => {
        if (!cancelled) setKlineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!displayPrice) return;
    setLimitPrice(formatInputPrice(displayPrice));
    setTriggerOrderPrice(formatInputPrice(displayPrice));
    setPriceUpdate(formatInputPrice(displayPrice));
    setTriggerPrice(formatInputPrice(side === "BUY" ? displayPrice * 1.01 : displayPrice * 0.99));
  }, [displayPrice, side, symbol]);

  useEffect(() => {
    const key = searchParams.get("import");
    if (!key) return;

    const draft = loadShadowImportDraft(key);
    const next = new URLSearchParams(searchParams);
    next.delete("import");
    setSearchParams(next, { replace: true });

    if (!draft) {
      toast.error(c.importFailed);
      return;
    }

    setImportDraft(draft);
    rememberAgentStrategyDraft(draft);
    setSymbol(draft.symbol);
    setSide(draft.side);
    setOrderMode(draft.orderType);
    setTimeInForce(draft.orderType === "MARKET" ? "IOC" : "GTC");
    setQuantity(String(draft.quantity));
    if (draft.price) {
      setLimitPrice(formatInputPrice(draft.price));
      setTriggerOrderPrice(formatInputPrice(draft.price));
      setPriceUpdate(formatInputPrice(draft.price));
    }
    toast.success(c.importLoaded);
  }, [c.importFailed, c.importLoaded, searchParams, setSearchParams]);

  const rememberAgentOrder = (order: ShadowOrder, draft: ShadowImportDraft) => {
    const source: AgentOrderSource = {
      source: "agent_result",
      createdAt: draft.createdAt,
      runId: draft.runId,
      shadowId: draft.shadowId,
    };
    setAgentOrderSources((current) => {
      const next = { ...current, [order.order_id]: source };
      writeAgentOrderSources(next);
      return next;
    });
  };

  const upsertAgentStrategy = (record: AgentStrategyRecord) => {
    setAgentStrategies((current) => {
      const next = [
        record,
        ...current.filter((item) => item.id !== record.id),
      ].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
      writeAgentStrategies(next);
      return next;
    });
  };

  const rememberAgentStrategyDraft = (draft: ShadowImportDraft) => {
    upsertAgentStrategy(recordFromDraft(draft));
  };

  const rememberAgentStrategyOrder = (order: ShadowOrder, draft: ShadowImportDraft) => {
    const base = recordFromDraft(draft);
    const orderTrade = tradeFromShadowOrder(order, draft);
    const trades = orderTrade ? [orderTrade, ...(base.trades ?? [])].slice(0, 30) : base.trades;
    upsertAgentStrategy({
      ...base,
      updatedAt: Date.now(),
      trades,
      tradeCount: Math.max(base.tradeCount ?? 0, trades?.length ?? 0),
      orderId: order.order_id,
      orderStatus: order.status,
      executedPrice: order.executed_price || order.average_price || order.price,
      filledQuantity: order.filled_quantity ?? order.quantity,
      rejectionReason: order.rejection_reason,
    });
  };

  const placeShadowOrder = async (mode: Exclude<OrderMode, "TPSL">, sourceDraft?: ShadowImportDraft | null): Promise<boolean> => {
    const parsedPrice = Number(limitPrice);
    const executionPrice = mode === "LIMIT" ? parsedPrice : displayPrice;
    const amount = resolveTicketAmount(quantity, quantityUnit, executionPrice);
    if (!Number.isFinite(amount.quantity) || amount.quantity <= 0) {
      toast.error(c.validationQuantity);
      return false;
    }
    if (mode === "LIMIT" && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      toast.error(c.validationLimitPrice);
      return false;
    }
    setSubmitting(true);
    try {
      if (Number.isFinite(displayPrice) && displayPrice > 0) {
        const synced = await api.updateShadowMarketPrice({ symbol, price: displayPrice });
        setAccount(synced.account);
      }
      const order = await api.placeShadowOrder({
        symbol,
        side,
        order_type: mode,
        quantity: amount.quantity,
        price: mode === "LIMIT" ? parsedPrice : 0,
        time_in_force: mode === "MARKET" ? "IOC" : timeInForce,
      });
      if (sourceDraft) {
        rememberAgentOrder(order, sourceDraft);
        rememberAgentStrategyOrder(order, sourceDraft);
      }
      setAccount(await api.getShadowAccount());
      toast[order.status === "REJECTED" ? "error" : "success"](
        order.status === "REJECTED" ? order.rejection_reason || c.orderRejected : c.orderDone(order.status),
      );
      return order.status !== "REJECTED";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : c.placeFailed);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const placeTriggerOrder = async (): Promise<boolean> => {
    const parsedTrigger = Number(triggerPrice);
    const parsedExecutionPrice = Number(triggerOrderPrice);
    if (!Number.isFinite(parsedTrigger) || parsedTrigger <= 0) {
      toast.error(c.validationTriggerPrice);
      return false;
    }
    if (triggerExecutionType === "LIMIT" && (!Number.isFinite(parsedExecutionPrice) || parsedExecutionPrice <= 0)) {
      toast.error(c.validationLimitPrice);
      return false;
    }
    const executionPrice = triggerExecutionType === "LIMIT" ? parsedExecutionPrice : parsedTrigger;
    const amount = resolveTicketAmount(quantity, quantityUnit, executionPrice);
    if (!Number.isFinite(amount.quantity) || amount.quantity <= 0) {
      toast.error(c.validationQuantity);
      return false;
    }
    setSubmitting(true);
    try {
      const order = await api.placeShadowOrder({
        symbol,
        side,
        order_type: "TRIGGER",
        quantity: amount.quantity,
        trigger_price: parsedTrigger,
        trigger_condition: triggerCondition,
        trigger_order_type: triggerExecutionType,
        trigger_order_price: triggerExecutionType === "LIMIT" ? parsedExecutionPrice : 0,
      });
      setAccount(await api.getShadowAccount());
      toast[order.status === "REJECTED" ? "error" : "success"](
        order.status === "REJECTED" ? order.rejection_reason || c.orderRejected : c.triggerPlaced,
      );
      return order.status !== "REJECTED";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : c.placeFailed);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const submitTicket = async () => {
    const accepted = orderMode === "TPSL"
      ? await placeTriggerOrder()
      : await placeShadowOrder(orderMode, importDraft);
    if (accepted && importDraft) setImportDraft(null);
  };

  const pushPrice = async () => {
    const parsedPrice = Number(priceUpdate);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast.error(c.validationMarketPrice);
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.updateShadowMarketPrice({ symbol, price: parsedPrice });
      setAccount(result.account);
      toast.success(
        result.filled_orders.length
          ? c.limitFilled(result.filled_orders.length)
          : c.marketUpdated,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : c.updateFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const cancelOrder = async (order: ShadowOrder) => {
    setSubmitting(true);
    try {
      await api.cancelShadowOrder(order.order_id);
      setAccount(await api.getShadowAccount());
      toast.success(c.orderCanceled);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : c.cancelFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const preparePositionTrade = (position: PositionRow, nextSide: "BUY" | "SELL", mode: OrderMode = "LIMIT") => {
    setSymbol(position.symbol);
    setSide(nextSide);
    setOrderMode(mode);
    setQuantityUnit("BASE");
    setQuantity(formatQty(nextSide === "SELL" ? position.available : Math.max(position.available, 0.01)));
    if (position.markPrice > 0) {
      setLimitPrice(formatInputPrice(position.markPrice));
      setTriggerPrice(formatInputPrice(nextSide === "SELL" ? position.markPrice * 1.02 : position.markPrice * 0.98));
      setTriggerOrderPrice(formatInputPrice(position.markPrice));
      setPriceUpdate(formatInputPrice(position.markPrice));
    }
    setBottomTab("open");
  };

  const preparePositionTpsl = (position: PositionRow) => {
    preparePositionTrade(position, "SELL", "TPSL");
    setTriggerCondition("GTE");
    setTriggerExecutionType("MARKET");
  };

  const resetAccount = async () => {
    setSubmitting(true);
    try {
      setAccount(await api.resetShadowAccount());
      setAgentOrderSources({});
      writeAgentOrderSources({});
      toast.success(c.accountReset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : c.resetFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const askLiveReadiness = () => {
    const prompt = language === "zh-CN"
      ? [
        "请审查我的影子模拟盘是否已具备加密实盘试点条件。",
        `当前虚拟交易对：${symbol}。`,
        `已成交订单：${filledOrders.length}；挂单：${pendingOrders.length}；被拒订单：${rejectedOrders.length}。`,
        `影子成本模型：taker 手续费 ${(TAKER_FEE_RATE * 100).toFixed(2)}%，滑点 ${(SLIPPAGE_RATE * 100).toFixed(2)}%。`,
        "判断是否适合进入 OKX/Binance 现货保守试点。若适合，请给出授权草案：先确认模式、交易对数量、单笔上限、每日亏损上限、过期时间和熔断规则。若不适合，请列出缺失的影子证据。不要下单。",
      ].join("\n")
      : [
        "Review my shadow-trading account for crypto live-readiness.",
        `Current virtual symbol focus: ${symbol}.`,
        `Filled orders: ${filledOrders.length}; pending orders: ${pendingOrders.length}; rejected orders: ${rejectedOrders.length}.`,
        `Estimated shadow cost model: taker fee ${(TAKER_FEE_RATE * 100).toFixed(2)}%, slippage ${(SLIPPAGE_RATE * 100).toFixed(2)}%.`,
        "Decide whether this is ready for an OKX/Binance spot pilot. If yes, propose a conservative mandate with confirm-mode first, max symbols, max order size, max daily loss, expiry, and kill-switch rules. If not, list the missing shadow evidence. Do not place orders.",
      ].join("\n");
    const promptKey = `shadow_live_review_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(promptKey, prompt);
    navigate(`/agent?promptKey=${encodeURIComponent(promptKey)}&auto=1`);
  };

  return (
    <main className="min-h-full bg-[#07090c] text-zinc-100">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-3 p-3">
        <header className="flex flex-col gap-3 border-b border-zinc-800 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded border border-zinc-700 bg-[#11151b] px-2 py-1 text-xs font-medium text-zinc-300">
                <Shield className="h-3.5 w-3.5 text-orange-400" />
                {c.virtualPortfolio}
              </span>
              <span className="inline-flex items-center gap-2 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-300">
                <Activity className="h-3.5 w-3.5" />
                {c.okxStyle}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2">
              <div>
                <h1 className="text-xl font-semibold tracking-normal text-white">{symbol.replace("_", "/")}</h1>
                <p className="mt-1 text-xs text-zinc-500">{c.subtitle}</p>
              </div>
              <TickerStat label={c.latest} value={formatMoney(displayPrice)} tone={stats.change >= 0 ? "green" : "red"} />
              <TickerStat label="24h" value={formatPercent(stats.change)} tone={stats.change >= 0 ? "green" : "red"} />
              <TickerStat label="24h High" value={formatMoney(stats.high)} />
              <TickerStat label="24h Low" value={formatMoney(stats.low)} />
              <TickerStat label="24h Vol" value={formatMoney(stats.volume)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadAccount}
              disabled={loading || submitting}
              className="inline-flex h-9 items-center gap-2 rounded border border-zinc-700 bg-[#11151b] px-3 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              {c.refresh}
            </button>
            <button
              type="button"
              onClick={resetAccount}
              disabled={submitting}
              className="inline-flex h-9 items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 text-xs text-red-300 transition hover:bg-red-500/15 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              {c.reset}
            </button>
          </div>
        </header>

        <section className="grid gap-2 md:grid-cols-4">
          <Metric icon={Wallet} label={c.availableUsdt} value={formatMoney(availableUsdt)} />
          <Metric icon={Wallet} label={c.frozenUsdt} value={formatMoney(frozenUsdt)} />
          <Metric icon={ClipboardList} label={c.orders} value={`${filledOrders.length} ${c.filled} / ${pendingOrders.length} ${c.pending}`} />
          <Metric icon={Activity} label={c.feeModel} value={`${((TAKER_FEE_RATE + SLIPPAGE_RATE) * 100).toFixed(2)}%`} />
        </section>

        <SafetyBar copy={c} onReview={askLiveReadiness} />

        <section className="grid gap-3 xl:grid-cols-[250px_minmax(0,1fr)_280px_360px] xl:items-start">
          <MarketList
            copy={c}
            rows={filteredMarkets}
            query={marketQuery}
            selected={symbol}
            onQuery={setMarketQuery}
            onSelect={setSymbol}
          />

          <section className="min-w-0 rounded border border-zinc-800 bg-[#0d1015]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                {c.chart}
                {klineLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-500" /> : null}
              </div>
              <div className="flex rounded border border-zinc-800 bg-[#07090c] p-1">
                {TIMEFRAMES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTimeframe(item.id)}
                    className={cn(
                      "h-7 rounded px-2.5 text-xs font-medium transition",
                      timeframe === item.id ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-100",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <KlinePanel symbol={symbol} bars={alignedBars} height={560} />
          </section>

          <aside className="xl:-mt-2">
            <OrderBookPanel
              copy={c}
              asks={orderBook.asks}
              bids={orderBook.bids}
              latest={displayPrice}
              onPickPrice={(value) => {
                setOrderMode("LIMIT");
                setLimitPrice(formatInputPrice(value));
                setTriggerOrderPrice(formatInputPrice(value));
              }}
            />
          </aside>

          <TradeTicket
            copy={c}
            symbol={symbol}
            side={side}
            orderMode={orderMode}
            timeInForce={timeInForce}
            quantity={quantity}
            quantityUnit={quantityUnit}
            limitPrice={limitPrice}
            triggerPrice={triggerPrice}
            triggerCondition={triggerCondition}
            triggerExecutionType={triggerExecutionType}
            triggerOrderPrice={triggerOrderPrice}
            displayPrice={displayPrice}
            estimatedQuantity={estimatedQuantity}
            estimatedNotional={estimatedNotional}
            availableUsdt={availableUsdt}
            baseAsset={selectedBaseAsset}
            baseBalance={selectedBaseBalance}
            importDraft={importDraft}
            loading={loading}
            submitting={submitting}
            onSide={setSide}
            onOrderMode={setOrderMode}
            onTimeInForce={setTimeInForce}
            onQuantity={setQuantity}
            onQuantityUnit={setQuantityUnit}
            onLimitPrice={setLimitPrice}
            onTriggerPrice={setTriggerPrice}
            onTriggerCondition={setTriggerCondition}
            onTriggerExecutionType={setTriggerExecutionType}
            onTriggerOrderPrice={setTriggerOrderPrice}
            onSubmit={submitTicket}
            onDismissImport={() => setImportDraft(null)}
          />
        </section>

        <section className="rounded border border-zinc-800 bg-[#0d1015]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
            <div className="flex gap-1">
              {([
                ["open", c.openOrders],
                ["history", c.historyOrders],
                ["assets", c.wallets],
                ["paper", c.paper],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBottomTab(id)}
                  className={cn(
                    "h-8 rounded px-3 text-xs font-medium transition",
                    bottomTab === id ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-100",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={priceUpdate}
                onChange={(event) => setPriceUpdate(event.target.value)}
                inputMode="decimal"
                className="h-8 w-32 rounded border border-zinc-700 bg-[#07090c] px-2 text-xs text-zinc-100 outline-none focus:border-orange-500/60"
                aria-label={c.marketTrigger}
              />
              <button
                type="button"
                onClick={pushPrice}
                disabled={submitting}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {c.update}
              </button>
            </div>
          </div>

          {bottomTab === "open" && (
            <OpenOrdersTable
              copy={c}
              orders={openBackendOrders}
              busy={submitting}
              onCancelOrder={cancelOrder}
              agentSources={agentOrderSources}
            />
          )}
          {bottomTab === "history" && (
            <HistoryOrdersTable
              copy={c}
              orders={historyBackendOrders}
              agentSources={agentOrderSources}
            />
          )}
          {bottomTab === "assets" && (
            <WalletTable
              positions={positions}
              accountBalance={availableUsdt + frozenUsdt}
              loading={loading}
              copy={c}
              onTrade={(position) => preparePositionTrade(position, "SELL", "LIMIT")}
              onTpsl={preparePositionTpsl}
            />
          )}
          {bottomTab === "paper" && (
            <div className="space-y-3 p-3">
              <StrategyTagBar
                copy={c}
                selected={strategyTag}
                counts={strategyTagCounts}
                onSelect={setStrategyTag}
              />
              <PaperDeploymentsPanel
                copy={c}
                deployments={filteredPaperDeployments}
                statuses={paperStatuses}
                activeDeploymentId={activePaperDeploymentId}
                loading={paperLoading}
                availableUsdt={availableUsdt}
                frozenUsdt={frozenUsdt}
                actionDeploymentId={paperActionId}
                onRun={togglePaperStrategyStatus}
                onDelete={deletePaperStrategy}
                onToggleDetails={togglePaperDetails}
              />
              <AgentStrategiesPanel copy={c} records={filteredAgentStrategies} onDelete={deleteAgentStrategy} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function TickerStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "green" | "red" | "neutral" }) {
  return (
    <div className="min-w-[90px]">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={cn(
        "mt-0.5 text-sm font-semibold",
        tone === "green" && "text-emerald-400",
        tone === "red" && "text-red-400",
        tone === "neutral" && "text-zinc-200",
      )}>
        {value}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-[#0d1015] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] text-zinc-500">{label}</p>
          <p className="mt-1 truncate text-base font-semibold text-zinc-100">{value}</p>
        </div>
        <span className="shrink-0 rounded bg-zinc-800 p-2 text-orange-300">
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function SafetyBar({ copy, onReview }: { copy: ShadowCopy; onReview: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100/80 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-2 leading-5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <span>{copy.warning}</span>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          onClick={onReview}
          className="inline-flex h-8 items-center gap-2 rounded bg-orange-500 px-3 text-xs font-medium text-white transition hover:bg-orange-400"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {copy.liveReview}
        </button>
        <Link
          to="/cockpit"
          className="inline-flex h-8 items-center gap-2 rounded border border-zinc-700 bg-[#0d1015] px-3 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
        >
          <Shield className="h-3.5 w-3.5" />
          {copy.strategyCockpit}
        </Link>
      </div>
    </div>
  );
}

function MarketList({
  copy,
  rows,
  query,
  selected,
  onQuery,
  onSelect,
}: {
  copy: ShadowCopy;
  rows: MarketRow[];
  query: string;
  selected: ShadowSymbol;
  onQuery: (value: string) => void;
  onSelect: (value: ShadowSymbol) => void;
}) {
  return (
    <aside className="rounded border border-zinc-800 bg-[#0d1015]">
      <div className="border-b border-zinc-800 p-3">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-100">
          {copy.markets}
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-zinc-600" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={copy.search}
            className="h-8 w-full rounded border border-zinc-700 bg-[#07090c] pl-8 pr-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500/60"
          />
        </label>
      </div>
      <div className="max-h-[706px] overflow-auto">
        {rows.map((row) => (
          <button
            key={row.symbol}
            type="button"
            onClick={() => onSelect(row.symbol)}
            className={cn(
              "grid w-full grid-cols-[1fr_auto] gap-2 border-b border-zinc-900 px-3 py-3 text-left transition hover:bg-zinc-900",
              selected === row.symbol && "bg-orange-500/10",
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-zinc-100">{row.symbol.replace("_", "/")}</span>
              <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{row.name}</span>
            </span>
            <span className="text-right">
              <span className="block font-mono text-sm text-zinc-100">{formatPrice(row.price)}</span>
              <span className={cn("mt-0.5 block font-mono text-[11px]", row.change >= 0 ? "text-emerald-400" : "text-red-400")}>
                {formatPercent(row.change)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function KlinePanel({ symbol, bars, height }: { symbol: ShadowSymbol; bars: CryptoKlineBar[]; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      const chart = createChart(ref.current, {
        autoSize: true,
        height,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#a1a1aa",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "rgba(63,63,70,0.18)" },
          horzLines: { color: "rgba(63,63,70,0.28)" },
        },
        rightPriceScale: {
          borderColor: "#27272a",
          scaleMargins: { top: 0.06, bottom: 0.28 },
        },
        timeScale: {
          borderColor: "#27272a",
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 8,
          barSpacing: 7,
        },
        crosshair: {
          mode: 0,
          vertLine: { color: "rgba(251,146,60,0.5)", width: 1, style: 3, labelBackgroundColor: "#f97316" },
          horzLine: { color: "rgba(251,146,60,0.5)", width: 1, style: 3, labelBackgroundColor: "#f97316" },
        },
        localization: {
          priceFormatter: (price: number) => formatMoney(price),
        },
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#10b981",
        downColor: "#ef4444",
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
        wickUpColor: "#34d399",
        wickDownColor: "#f87171",
        priceLineColor: "#f97316",
        lastValueVisible: true,
        priceLineVisible: true,
      });

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        lastValueVisible: false,
        priceLineVisible: false,
      });

      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
        borderVisible: false,
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;

      return () => {
        chart.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
      };
    } catch {
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    }
  }, [height]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;

    const orderedBars = [...bars].sort((a, b) => a.timestamp - b.timestamp);
    const candles: CandlestickData[] = orderedBars.map((bar) => ({
      time: toChartTime(bar.timestamp),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));
    const volumes: HistogramData[] = orderedBars.map((bar) => ({
      time: toChartTime(bar.timestamp),
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(16,185,129,0.42)" : "rgba(239,68,68,0.42)",
    }));

    candleSeries.setData(candles);
    volumeSeries.setData(volumes);
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  return (
    <div
      ref={ref}
      className="w-full overflow-hidden bg-[#0d1015]"
      style={{ height }}
      aria-label={`${symbol.replace("_", "/")} candlestick chart`}
    />
  );
}

function OrderBookPanel({
  copy,
  asks,
  bids,
  latest,
  onPickPrice,
}: {
  copy: ShadowCopy;
  asks: BookLevel[];
  bids: BookLevel[];
  latest: number;
  onPickPrice: (value: number) => void;
}) {
  const maxTotal = Math.max(...asks.map((item) => item.total), ...bids.map((item) => item.total), 1);
  return (
    <section className="rounded border border-zinc-800 bg-[#0d1015]">
      <div className="border-b border-zinc-800 px-3 py-2 text-sm font-semibold text-zinc-100">{copy.orderBook}</div>
      <div className="grid grid-cols-3 px-3 py-2 text-[11px] text-zinc-500">
        <span>{copy.price}</span>
        <span className="text-right">{copy.amount}</span>
        <span className="text-right">{copy.total}</span>
      </div>
      <div className="px-3">
        {asks.map((level) => (
          <BookRow key={`ask-${level.price}`} level={level} maxTotal={maxTotal} side="ask" onPickPrice={onPickPrice} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onPickPrice(latest)}
        className="my-1 flex w-full items-center justify-center border-y border-zinc-800 py-2 font-mono text-lg font-semibold text-emerald-400 hover:bg-zinc-900"
      >
        {formatPrice(latest)}
      </button>
      <div className="px-3 pb-3">
        {bids.map((level) => (
          <BookRow key={`bid-${level.price}`} level={level} maxTotal={maxTotal} side="bid" onPickPrice={onPickPrice} />
        ))}
      </div>
    </section>
  );
}

function BookRow({ level, maxTotal, side, onPickPrice }: { level: BookLevel; maxTotal: number; side: "ask" | "bid"; onPickPrice: (value: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPickPrice(level.price)}
      className="relative grid h-6 w-full grid-cols-3 overflow-hidden rounded px-0 text-[11px] hover:bg-zinc-900"
    >
      <span
        className={cn("absolute bottom-0 right-0 top-0 opacity-10", side === "ask" ? "bg-red-400" : "bg-emerald-400")}
        style={{ width: `${Math.min(100, (level.total / maxTotal) * 100)}%` }}
      />
      <span className={cn("relative font-mono", side === "ask" ? "text-red-400" : "text-emerald-400")}>{formatPrice(level.price)}</span>
      <span className="relative text-right font-mono text-zinc-300">{formatQty(level.amount)}</span>
      <span className="relative text-right font-mono text-zinc-500">{formatQty(level.total)}</span>
    </button>
  );
}

function TradeTicket({
  copy,
  symbol,
  side,
  orderMode,
  timeInForce,
  quantity,
  quantityUnit,
  limitPrice,
  triggerPrice,
  triggerCondition,
  triggerExecutionType,
  triggerOrderPrice,
  displayPrice,
  estimatedQuantity,
  estimatedNotional,
  availableUsdt,
  baseAsset,
  baseBalance,
  importDraft,
  loading,
  submitting,
  onSide,
  onOrderMode,
  onTimeInForce,
  onQuantity,
  onQuantityUnit,
  onLimitPrice,
  onTriggerPrice,
  onTriggerCondition,
  onTriggerExecutionType,
  onTriggerOrderPrice,
  onSubmit,
  onDismissImport,
}: {
  copy: ShadowCopy;
  symbol: ShadowSymbol;
  side: "BUY" | "SELL";
  orderMode: OrderMode;
  timeInForce: TimeInForce;
  quantity: string;
  quantityUnit: QuantityUnit;
  limitPrice: string;
  triggerPrice: string;
  triggerCondition: "GTE" | "LTE";
  triggerExecutionType: "MARKET" | "LIMIT";
  triggerOrderPrice: string;
  displayPrice: number;
  estimatedQuantity: number;
  estimatedNotional: number;
  availableUsdt: number;
  baseAsset: string;
  baseBalance: number;
  importDraft: ShadowImportDraft | null;
  loading: boolean;
  submitting: boolean;
  onSide: (value: "BUY" | "SELL") => void;
  onOrderMode: (value: OrderMode) => void;
  onTimeInForce: (value: TimeInForce) => void;
  onQuantity: (value: string) => void;
  onQuantityUnit: (value: QuantityUnit) => void;
  onLimitPrice: (value: string) => void;
  onTriggerPrice: (value: string) => void;
  onTriggerCondition: (value: "GTE" | "LTE") => void;
  onTriggerExecutionType: (value: "MARKET" | "LIMIT") => void;
  onTriggerOrderPrice: (value: string) => void;
  onSubmit: () => void;
  onDismissImport: () => void;
}) {
  return (
    <section className="rounded border border-zinc-800 bg-[#0d1015]">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-base font-semibold text-zinc-100">{copy.ticketTitle}</h2>
        <p className="mt-1 text-xs text-zinc-500">{symbol.replace("_", "/")}</p>
      </div>

      <div className="space-y-4 p-4">
        {importDraft && (
          <div className="rounded border border-sky-500/30 bg-sky-500/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-300">
                  <Bot className="h-3.5 w-3.5" />
                  {copy.importedDraftTitle}
                </div>
                <p className="mt-1 text-xs text-zinc-400">{copy.importedDraftDesc}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
                  {importDraft.runId && <span className="font-mono">{copy.importedSourceRun}: {importDraft.runId}</span>}
                  {importDraft.shadowId && <span className="font-mono">{copy.importedSourceShadow}: {importDraft.shadowId}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={onDismissImport}
                className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"
                aria-label={copy.dismissImport}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onSide("BUY")}
            className={cn(
              "h-10 rounded text-sm font-semibold transition",
              side === "BUY" ? "bg-emerald-500 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100",
            )}
          >
            {copy.buy}
          </button>
          <button
            type="button"
            onClick={() => onSide("SELL")}
            className={cn(
              "h-10 rounded text-sm font-semibold transition",
              side === "SELL" ? "bg-red-500 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100",
            )}
          >
            {copy.sell}
          </button>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-zinc-500">{copy.orderMode}</div>
          <div className="grid grid-cols-3 gap-1 rounded border border-zinc-800 bg-[#07090c] p-1">
            {([
              ["LIMIT", copy.limit],
              ["MARKET", copy.market],
              ["TPSL", copy.tpsl],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onOrderMode(id)}
                className={cn(
                  "h-8 rounded text-xs font-medium transition",
                  orderMode === id ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-100",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {orderMode === "LIMIT" && (
          <div className="space-y-3">
            <Field label={copy.limitPrice}>
              <TradeInput value={limitPrice} onChange={onLimitPrice} suffix="USDT" />
            </Field>
            <TimeInForceControl copy={copy} value={timeInForce} onChange={onTimeInForce} includePostOnly />
          </div>
        )}

        {orderMode === "MARKET" && (
          <div className="space-y-3">
            <div className="rounded border border-zinc-800 bg-[#07090c] px-3 py-2 text-sm text-zinc-400">
              {copy.marketPrice}: <span className="font-mono text-zinc-100">{formatMoney(displayPrice)}</span>
            </div>
            <TimeInForceControl copy={copy} value={timeInForce === "POST_ONLY" ? "IOC" : timeInForce} onChange={onTimeInForce} />
          </div>
        )}

        {orderMode === "TPSL" && (
          <div className="space-y-3">
            <Field label={copy.triggerPrice}>
              <TradeInput value={triggerPrice} onChange={onTriggerPrice} suffix="USDT" />
            </Field>
            <Field label={copy.triggerCondition}>
              <select
                value={triggerCondition}
                onChange={(event) => onTriggerCondition(event.target.value as "GTE" | "LTE")}
                className="h-10 w-full rounded border border-zinc-700 bg-[#07090c] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/60"
              >
                <option value="GTE">&gt;=</option>
                <option value="LTE">&lt;=</option>
              </select>
            </Field>
            <Field label={copy.execution}>
              <select
                value={triggerExecutionType}
                onChange={(event) => onTriggerExecutionType(event.target.value as "MARKET" | "LIMIT")}
                className="h-10 w-full rounded border border-zinc-700 bg-[#07090c] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/60"
              >
                <option value="MARKET">{copy.market}</option>
                <option value="LIMIT">{copy.limit}</option>
              </select>
            </Field>
            {triggerExecutionType === "LIMIT" && (
              <Field label={copy.limitPrice}>
                <TradeInput value={triggerOrderPrice} onChange={onTriggerOrderPrice} suffix="USDT" />
              </Field>
            )}
          </div>
        )}

        <Field label={copy.quantity}>
          <TradeInput
            value={quantity}
            onChange={onQuantity}
            suffix={quantityUnit === "BASE" ? baseAsset : "USDT"}
            suffixControl={(
              <UnitToggle
                value={quantityUnit}
                baseAsset={baseAsset}
                onChange={onQuantityUnit}
              />
            )}
          />
        </Field>

        <div className="space-y-2 border-y border-zinc-800 py-3 text-xs">
          <SummaryRow label={`${copy.latest} ${symbol.replace("_", "/")}`} value={formatMoney(displayPrice)} />
          <SummaryRow label={copy.notional} value={Number.isFinite(estimatedNotional) ? formatMoney(estimatedNotional) : "-"} />
          <SummaryRow label={`${copy.estimatedQty} ${baseAsset}`} value={Number.isFinite(estimatedQuantity) ? formatQty(estimatedQuantity) : "-"} />
          <SummaryRow label={copy.availableUsdt} value={formatMoney(availableUsdt)} />
          <SummaryRow label={`${copy.baseBalance} ${baseAsset}`} value={formatQty(baseBalance)} />
        </div>

        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || submitting}
          className={cn(
            "inline-flex h-11 w-full items-center justify-center gap-2 rounded text-sm font-semibold text-white transition disabled:opacity-50",
            side === "BUY" ? "bg-emerald-500 hover:bg-emerald-400" : "bg-red-500 hover:bg-red-400",
          )}
        >
          <Play className="h-4 w-4" />
          {importDraft ? copy.runImportedTest : orderMode === "TPSL" ? copy.placeTrigger : side === "BUY" ? copy.placeBuy : copy.placeSell}
        </button>
      </div>
    </section>
  );
}

function TimeInForceControl({
  copy,
  value,
  onChange,
  includePostOnly,
}: {
  copy: ShadowCopy;
  value: TimeInForce;
  onChange: (value: TimeInForce) => void;
  includePostOnly?: boolean;
}) {
  const options: Array<[TimeInForce, string]> = [
    ["GTC", copy.gtc],
    ["IOC", copy.ioc],
    ["FOK", copy.fok],
  ];
  if (includePostOnly) options.push(["POST_ONLY", copy.postOnly]);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-zinc-500">{copy.tif}</div>
      <div className={cn("grid gap-1 rounded border border-zinc-800 bg-[#07090c] p-1", includePostOnly ? "grid-cols-4" : "grid-cols-3")}>
        {options.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={cn(
              "h-8 rounded text-xs font-medium transition",
              value === id ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-100",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TradeInput({
  value,
  onChange,
  suffix,
  suffixControl,
}: {
  value: string;
  onChange: (value: string) => void;
  suffix: string;
  suffixControl?: ReactNode;
}) {
  return (
    <div className="flex h-10 items-center rounded border border-zinc-700 bg-[#07090c] focus-within:border-orange-500/60">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        className="min-w-0 flex-1 bg-transparent px-3 text-sm text-zinc-100 outline-none"
      />
      {suffixControl ?? <span className="shrink-0 px-3 text-xs font-medium text-zinc-500">{suffix}</span>}
    </div>
  );
}

function UnitToggle({
  value,
  baseAsset,
  onChange,
}: {
  value: QuantityUnit;
  baseAsset: string;
  onChange: (value: QuantityUnit) => void;
}) {
  return (
    <div className="mr-1 flex shrink-0 rounded border border-zinc-800 bg-zinc-900 p-0.5">
      {([
        ["BASE", baseAsset],
        ["QUOTE", "USDT"],
      ] as const).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "h-7 rounded px-2 text-[11px] font-medium transition",
            value === id ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-200",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono font-medium text-zinc-200">{value}</span>
    </div>
  );
}

function OpenOrdersTable({
  copy,
  orders,
  busy,
  onCancelOrder,
  agentSources,
}: {
  copy: ShadowCopy;
  orders: ShadowOrder[];
  busy: boolean;
  onCancelOrder: (order: ShadowOrder) => void;
  agentSources: Record<string, AgentOrderSource>;
}) {
  const rows = orders.length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="bg-[#11151b] text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-2 text-left">{copy.time}</th>
            <th className="px-4 py-2 text-left">{copy.symbol}</th>
            <th className="px-4 py-2 text-left">{copy.side}</th>
            <th className="px-4 py-2 text-left">{copy.type}</th>
            <th className="px-4 py-2 text-right">{copy.qty}</th>
            <th className="px-4 py-2 text-right">{copy.price}</th>
            <th className="px-4 py-2 text-left">{copy.status}</th>
            <th className="px-4 py-2 text-left">{copy.source}</th>
            <th className="px-4 py-2 text-right">{copy.action}</th>
          </tr>
        </thead>
        <tbody>
          {rows === 0 ? (
            <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">{copy.noOrders}</td></tr>
          ) : (
            <>
              {orders.map((order) => (
                <ShadowOrderRow
                  key={order.order_id}
                  copy={copy}
                  order={order}
                  source={agentSources[order.order_id] ? copy.agentSaved : copy.manualSource}
                  action={(
                    <button
                      type="button"
                      onClick={() => onCancelOrder(order)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-red-300 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      {copy.cancel}
                    </button>
                  )}
                />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HistoryOrdersTable({
  copy,
  orders,
  agentSources,
}: {
  copy: ShadowCopy;
  orders: ShadowOrder[];
  agentSources: Record<string, AgentOrderSource>;
}) {
  const rows = orders.length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="bg-[#11151b] text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-2 text-left">{copy.time}</th>
            <th className="px-4 py-2 text-left">{copy.symbol}</th>
            <th className="px-4 py-2 text-left">{copy.side}</th>
            <th className="px-4 py-2 text-left">{copy.type}</th>
            <th className="px-4 py-2 text-right">{copy.qty}</th>
            <th className="px-4 py-2 text-right">{copy.price}</th>
            <th className="px-4 py-2 text-left">{copy.status}</th>
            <th className="px-4 py-2 text-left">{copy.source}</th>
            <th className="px-4 py-2 text-right">{copy.action}</th>
          </tr>
        </thead>
        <tbody>
          {rows === 0 ? (
            <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">{copy.noOrders}</td></tr>
          ) : (
            <>
              {orders.map((order) => (
                <ShadowOrderRow
                  key={order.order_id}
                  copy={copy}
                  order={order}
                  source={agentSources[order.order_id] ? copy.agentSaved : copy.manualSource}
                />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ShadowOrderRow({ copy, order, source, action }: { copy: ShadowCopy; order: ShadowOrder; source: string; action?: ReactNode }) {
  return (
    <tr className="border-t border-zinc-900 align-top">
      <td className="px-4 py-3 text-zinc-500">{formatTime(order.timestamp)}</td>
      <td className="px-4 py-3 font-medium text-zinc-100">{order.symbol.replace("_", "/")}</td>
      <td className={cn("px-4 py-3 font-medium", order.side === "BUY" ? "text-emerald-400" : "text-red-400")}>{order.side === "BUY" ? copy.buy : copy.sell}</td>
      <td className="px-4 py-3 text-zinc-300">{order.type === "TRIGGER" ? copy.tpsl : order.type === "MARKET" ? copy.market : copy.limit}</td>
      <td className="px-4 py-3 text-right font-mono text-zinc-300">
        {formatQty(order.filled_quantity || 0)} / {formatQty(order.quantity)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-zinc-300">
        {order.type === "TRIGGER"
          ? `${order.trigger_condition === "GTE" ? ">=" : "<="} ${formatMoney(order.trigger_price || 0)}`
          : formatMoney(order.executed_price || order.price)}
        {order.fee_paid ? <div className="mt-1 text-[11px] text-zinc-500">Fee {formatQty(order.fee_paid)} {order.fee_asset}</div> : null}
      </td>
      <td className="px-4 py-3">
        <StatusPill label={copy.statusLabels[order.status]} status={order.status} />
        {order.rejection_reason ? <div className="mt-1 max-w-[220px] text-[11px] leading-4 text-zinc-500">{order.rejection_reason}</div> : null}
      </td>
      <td className="px-4 py-3 text-xs text-zinc-500">{source}</td>
      <td className="px-4 py-3 text-right">{action ?? <span className="text-xs text-zinc-600">-</span>}</td>
    </tr>
  );
}

function StatusPill({ label, status }: { label: string; status: ShadowOrder["status"] | string }) {
  return (
    <span className={cn(
      "inline-flex rounded px-2 py-1 text-xs font-medium",
      status === "FILLED" && "bg-emerald-500/10 text-emerald-400",
      (status === "PENDING" || status === "PARTIALLY_FILLED") && "bg-amber-500/10 text-amber-300",
      (status === "CANCELED" || status === "EXPIRED") && "bg-zinc-800 text-zinc-400",
      status === "REJECTED" && "bg-red-500/10 text-red-400",
    )}>
      {label}
    </span>
  );
}

function WalletTable({
  positions,
  accountBalance,
  loading,
  copy,
  onTrade,
  onTpsl,
}: {
  positions: PositionRow[];
  accountBalance: number;
  loading: boolean;
  copy: ShadowCopy;
  onTrade: (position: PositionRow) => void;
  onTpsl: (position: PositionRow) => void;
}) {
  return (
    <div>
      <div className="border-b border-zinc-900 p-3">
        <Metric icon={Wallet} label={copy.accountBalance} value={formatMoney(accountBalance)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[#11151b] text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left">{copy.asset}</th>
              <th className="px-4 py-2 text-right">{copy.equity}</th>
              <th className="px-4 py-2 text-right">{copy.costPrice}</th>
              <th className="px-4 py-2 text-right">{copy.latest}</th>
              <th className="px-4 py-2 text-right">{copy.pnl}</th>
              <th className="px-4 py-2 text-right">{copy.action}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">{copy.loading}</td></tr>
            ) : positions.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">{copy.noWalletRows}</td></tr>
            ) : positions.map((position) => (
              <tr key={position.asset} className="border-t border-zinc-900">
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-100">{position.asset}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{position.symbol.replace("_", "/")}</div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-100">{formatQty(position.equity)}</td>
                <td className="px-4 py-3 text-right font-mono text-zinc-300">{position.costPrice ? formatMoney(position.costPrice) : "-"}</td>
                <td className="px-4 py-3 text-right font-mono text-zinc-300">{position.markPrice ? formatMoney(position.markPrice) : "-"}</td>
                <td className={cn("px-4 py-3 text-right font-mono font-semibold", position.pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {formatMoney(position.pnl)}
                  <div className="mt-0.5 text-[11px]">{formatPercent(position.pnlPercent)}</div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onTpsl(position)}
                      className="h-8 rounded border border-zinc-700 px-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                    >
                      {copy.tpsl}
                    </button>
                    <button
                      type="button"
                      onClick={() => onTrade(position)}
                      className="h-8 rounded bg-orange-500 px-2.5 text-xs font-semibold text-white hover:bg-orange-400"
                    >
                      {copy.trade}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StrategyTagBar({
  copy,
  selected,
  counts,
  onSelect,
}: {
  copy: ShadowCopy;
  selected: StrategyTagId;
  counts: Record<StrategyTagId, number>;
  onSelect: (tag: StrategyTagId) => void;
}) {
  return (
    <section className="rounded border border-zinc-800 bg-[#0d1015] p-3">
      <div className="mb-2 text-xs font-semibold text-zinc-400">{copy.strategyTags}</div>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {STRATEGY_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onSelect(tag)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-2 rounded border px-3 text-xs font-semibold transition",
              selected === tag
                ? "border-orange-400/70 bg-orange-500/15 text-orange-200"
                : "border-zinc-700 bg-[#07090c] text-zinc-400 hover:border-zinc-600 hover:text-zinc-100",
            )}
          >
            <span>{copy.strategyTagLabels[tag]}</span>
            <span className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px]",
              selected === tag ? "bg-orange-400/20 text-orange-100" : "bg-zinc-800 text-zinc-500",
            )}>
              {counts[tag]}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function StrategyTagPill({ copy, tag }: { copy: ShadowCopy; tag: Exclude<StrategyTagId, "all"> }) {
  return (
    <span className={cn(
      "rounded px-2 py-1 text-[11px] font-semibold",
      tag === "grid" && "bg-orange-500/10 text-orange-300",
      tag === "dca" && "bg-sky-500/10 text-sky-300",
      tag === "arbitrage" && "bg-violet-500/10 text-violet-300",
      tag === "signal" && "bg-cyan-500/10 text-cyan-300",
      tag === "risk" && "bg-amber-500/10 text-amber-300",
    )}>
      {copy.strategyTagLabels[tag]}
    </span>
  );
}

function PaperDeploymentsPanel({
  copy,
  deployments,
  statuses,
  activeDeploymentId,
  loading,
  availableUsdt,
  frozenUsdt,
  actionDeploymentId,
  onRun,
  onDelete,
  onToggleDetails,
}: {
  copy: ShadowCopy;
  deployments: PaperDeployment[];
  statuses: Record<string, PaperDeploymentStatusResponse>;
  activeDeploymentId: string;
  loading: boolean;
  availableUsdt: number;
  frozenUsdt: number;
  actionDeploymentId: string | null;
  onRun: (deployment: PaperDeployment) => void;
  onDelete: (deploymentId: string) => void;
  onToggleDetails: (deploymentId: string) => void;
}) {
  return (
    <section className="rounded border border-zinc-800 bg-[#0d1015] p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-zinc-100">{copy.paperDeployments}</h2>
        <p className="text-xs text-zinc-500">{copy.paperDeploymentSubtitle}</p>
      </div>

      {loading ? (
        <div className="mt-4 rounded border border-dashed border-zinc-700 p-4 text-sm text-zinc-500">
          {copy.loading}
        </div>
      ) : deployments.length === 0 ? (
        <div className="mt-4 rounded border border-dashed border-zinc-700 p-4 text-sm text-zinc-500">
          {copy.noPaperDeployments}
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {deployments.map((deployment) => (
            <PaperDeploymentCard
              key={deployment.deployment_id}
              copy={copy}
              deployment={deployment}
              status={statuses[deployment.deployment_id]}
              active={deployment.deployment_id === activeDeploymentId}
              availableUsdt={availableUsdt}
              frozenUsdt={frozenUsdt}
              busy={actionDeploymentId === deployment.deployment_id}
              onRun={onRun}
              onDelete={onDelete}
              onToggleDetails={onToggleDetails}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PaperDeploymentCard({
  copy,
  deployment,
  status,
  active,
  availableUsdt,
  frozenUsdt,
  busy,
  onRun,
  onDelete,
  onToggleDetails,
}: {
  copy: ShadowCopy;
  deployment: PaperDeployment;
  status?: PaperDeploymentStatusResponse;
  active: boolean;
  availableUsdt: number;
  frozenUsdt: number;
  busy: boolean;
  onRun: (deployment: PaperDeployment) => void;
  onDelete: (deploymentId: string) => void;
  onToggleDetails: (deploymentId: string) => void;
}) {
  const startedAt = deployment.started_at || deployment.updated_at || deployment.created_at;
  const startedTs = Date.parse(startedAt);
  const symbols = deployment.limits.symbols.join(", ");
  const latestSignal = status?.recent_signals?.[0] ?? null;
  const latestDecision = status?.recent_decisions?.[0] ?? null;
  const latestTick = status?.latest_tick ?? status?.recent_ticks?.[0] ?? null;
  const latestOrder = latestTick
    ? status?.recent_orders?.find((order) => (
      (latestTick.shadow_order_id && order.shadow_order_id === latestTick.shadow_order_id)
      || (latestTick.decision_id && order.decision_id === latestTick.decision_id)
      || (latestTick.signal_id && order.signal_id === latestTick.signal_id)
    )) ?? null
    : status?.recent_orders?.[0] ?? null;
  const strategyTag = paperDeploymentStrategyTag(deployment);
  const isRunning = deployment.status === "running";
  const isArchived = deployment.status === "archived";
  const runButtonLabel = isRunning ? copy.stopStrategy : copy.runStrategy;
  const limits = [
    `${copy.defaultNotional}: ${formatMoney(deployment.limits.default_order_notional)}`,
    `Max: ${formatMoney(deployment.limits.max_order_notional)}`,
    `Exposure: ${formatMoney(deployment.limits.max_total_exposure)}`,
    `Trades/day: ${deployment.limits.max_trades_per_day}`,
    `${copy.cashBuffer}: ${formatMoney(deployment.limits.min_cash_buffer)}`,
  ].join(" · ");

  return (
    <article className={cn(
      "rounded border bg-[#07090c] p-3",
      active ? "border-orange-400/70 shadow-[0_0_0_1px_rgba(251,146,60,0.35)]" : "border-zinc-800",
    )}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StrategyTagPill copy={copy} tag={strategyTag} />
            <span className="truncate text-sm font-semibold text-zinc-100">
              {deployment.strategy_snapshot.name || deployment.strategy_id}
            </span>
            <span className={cn(
              "inline-flex rounded px-2 py-1 text-xs font-semibold",
              deployment.status === "running" ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-800 text-zinc-300",
            )}>
              {deployment.status}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
            <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">
              {copy.deploymentId}: {deployment.deployment_id}
            </span>
            <span className="rounded border border-zinc-700 px-1.5 py-0.5">
              {copy.symbol}: {symbols}
            </span>
            <span className="rounded border border-zinc-700 px-1.5 py-0.5">
              {copy.startedAt}: {Number.isFinite(startedTs) ? formatTime(startedTs / 1000) : "-"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onRun(deployment)}
            disabled={busy || isArchived}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white transition disabled:opacity-50",
              isRunning ? "bg-red-500 hover:bg-red-400" : "bg-orange-500 hover:bg-orange-400",
            )}
          >
            {isRunning ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {runButtonLabel}
          </button>
          <button
            type="button"
            onClick={() => onToggleDetails(deployment.deployment_id)}
            className="inline-flex h-8 items-center rounded border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800"
          >
            {active ? copy.hideDetails : copy.viewDetails}
          </button>
          <button
            type="button"
            onClick={() => onDelete(deployment.deployment_id)}
            disabled={busy || isArchived}
            className="inline-flex h-8 items-center rounded border border-red-500/40 px-3 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
          >
            {copy.deleteStrategy}
          </button>
        </div>
        <div className="min-w-0 rounded border border-zinc-800 bg-[#0d1015] px-3 py-2 text-xs text-zinc-400 lg:max-w-[28rem]">
          <div className="font-semibold text-zinc-300">{copy.paperLimits}</div>
          <div className="mt-1 leading-5">{limits}</div>
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <span className="font-semibold text-zinc-300">{copy.funds}: </span>
            <span>{copy.availableUsdt} {formatMoney(availableUsdt)} · {copy.frozenUsdt} {formatMoney(frozenUsdt)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
        <PaperInfo
          label={copy.latestSignal}
          value={latestSignal ? `${latestSignal.action} ${latestSignal.symbol}` : "-"}
          detail={latestSignal?.reason || (latestSignal?.notional ? formatMoney(latestSignal.notional) : "")}
        />
        <PaperInfo
          label={copy.riskDecision}
          value={latestDecision?.decision || "-"}
          detail={latestDecision?.reason || latestDecision?.breached_limit || ""}
        />
        <PaperInfo
          label={copy.paperOrder}
          value={latestOrder?.shadow_status || "-"}
          detail={latestOrder?.shadow_order_id || latestOrder?.rejection_reason || ""}
        />
        <PaperInfo
          label={copy.latestTick}
          value={latestTick?.outcome || "-"}
          detail={latestTick?.reason || ""}
        />
      </div>

      {active ? (
        <div className="mt-3 rounded border border-zinc-800 bg-[#0d1015] p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-zinc-100">{copy.activitySummary}</div>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
              <span className="rounded border border-zinc-700 px-1.5 py-0.5">Ticks: {status?.summary.tick_count ?? status?.recent_ticks.length ?? 0}</span>
              <span className="rounded border border-zinc-700 px-1.5 py-0.5">Orders: {status?.summary.order_count ?? status?.recent_orders.length ?? 0}</span>
              <span className="rounded border border-zinc-700 px-1.5 py-0.5">Rejected: {status?.summary.rejected_decision_count ?? 0}</span>
            </div>
          </div>
          <div className="grid gap-3 text-xs lg:grid-cols-4">
            <PaperActivityList
              title={copy.latestSignal}
              rows={(status?.recent_signals ?? []).map((signal) => ({
                key: signal.signal_id,
                main: `${signal.action} ${signal.symbol}`,
                detail: signal.reason || (signal.notional ? formatMoney(signal.notional) : ""),
              }))}
            />
            <PaperActivityList
              title={copy.riskDecision}
              rows={(status?.recent_decisions ?? []).map((decision) => ({
                key: decision.decision_id,
                main: decision.decision,
                detail: decision.reason || decision.breached_limit || "",
              }))}
            />
            <PaperActivityList
              title={copy.paperOrder}
              rows={(status?.recent_orders ?? []).map((order) => ({
                key: order.link_id,
                main: order.shadow_status || "-",
                detail: order.shadow_order_id || order.rejection_reason || "",
              }))}
            />
            <PaperActivityList
              title={copy.latestTick}
              rows={(status?.recent_ticks ?? []).map((tick) => ({
                key: tick.tick_id,
                main: tick.outcome || "-",
                detail: tick.reason || tick.shadow_order_id || "",
              }))}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}

function PaperActivityList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; main: string; detail?: string }>;
}) {
  return (
    <div className="min-w-0 rounded border border-zinc-800 bg-[#07090c] p-3">
      <div className="font-semibold text-zinc-300">{title}</div>
      {rows.length ? (
        <div className="mt-2 space-y-2">
          {rows.slice(0, 5).map((row) => (
            <div key={row.key} className="min-w-0 border-t border-zinc-900 pt-2 first:border-t-0 first:pt-0">
              <div className="truncate font-semibold text-zinc-100">{row.main}</div>
              {row.detail ? <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{row.detail}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-zinc-600">-</div>
      )}
    </div>
  );
}

function AgentStrategiesPanel({
  copy,
  records,
  onDelete,
}: {
  copy: ShadowCopy;
  records: AgentStrategyRecord[];
  onDelete: (strategyId: string) => void;
}) {
  return (
    <section className="rounded border border-zinc-800 bg-[#0d1015] p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-zinc-100">{copy.agentStrategies}</h2>
        <p className="text-xs text-zinc-500">{copy.agentStrategySubtitle}</p>
      </div>

      {records.length === 0 ? (
        <div className="mt-4 rounded border border-dashed border-zinc-700 p-4 text-sm text-zinc-500">
          {copy.noAgentStrategies}
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {records.map((record) => (
            <AgentStrategyCard key={record.id} copy={copy} record={record} onDelete={onDelete} />
          ))}
        </div>
      )}
    </section>
  );
}

function AgentStrategyCard({
  copy,
  record,
  onDelete,
}: {
  copy: ShadowCopy;
  record: AgentStrategyRecord;
  onDelete: (strategyId: string) => void;
}) {
  const trades = record.trades ?? [];
  const orderStatus = record.orderStatus ? copy.statusLabels[record.orderStatus] : "-";
  const runStatus = [record.runStatus, record.runStage].filter(Boolean).join(" / ") || "-";
  const draftNotional = record.price ? record.quantity * record.price : undefined;
  const filledValue = record.filledQuantity && record.executedPrice
    ? record.filledQuantity * record.executedPrice
    : trades.find((trade) => trade.source === "shadow_order")?.notional;
  const totalPnl = trades.reduce((sum, trade) => (
    typeof trade.pnl === "number" && Number.isFinite(trade.pnl) ? sum + trade.pnl : sum
  ), 0);
  const hasPnl = trades.some((trade) => typeof trade.pnl === "number" && Number.isFinite(trade.pnl));
  const pnlPercent = typeof record.metrics?.total_return === "number" ? record.metrics.total_return : undefined;
  const strategyTag = agentStrategyTag(record);

  return (
    <article className="rounded border border-zinc-800 bg-[#07090c] p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-300">Agent</span>
            <StrategyTagPill copy={copy} tag={strategyTag} />
            <span className="font-mono text-sm font-semibold text-zinc-100">{record.symbol.replace("_", "/")}</span>
            {record.orderStatus ? <StatusPill label={orderStatus} status={record.orderStatus} /> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
            {record.runId ? <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">Run: {record.runId}</span> : null}
            {record.shadowId ? <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono">Shadow: {record.shadowId}</span> : null}
            <span className="rounded border border-zinc-700 px-1.5 py-0.5">{copy.importedAt}: {formatTime(record.createdAt / 1000)}</span>
            {record.runDirectory ? (
              <span className="max-w-[260px] truncate rounded border border-zinc-700 px-1.5 py-0.5 font-mono" title={record.runDirectory}>
                {copy.runDirectory}: {record.runDirectory}
              </span>
            ) : null}
          </div>
          {record.prompt ? (
            <p className="mt-3 line-clamp-2 text-xs leading-5 text-zinc-400">
              <span className="text-zinc-500">{copy.runPrompt}: </span>{record.prompt}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-3">
          <button
            type="button"
            onClick={() => onDelete(record.id)}
            className="self-start rounded border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/10"
          >
            {copy.deleteStrategy}
          </button>
        </div>

        <div className="grid min-w-[280px] gap-2 text-xs sm:grid-cols-2">
          <PaperInfo label={copy.runStatus} value={runStatus} detail={record.elapsedSeconds != null ? `${copy.runElapsed}: ${record.elapsedSeconds.toFixed(1)}s` : ""} />
          <PaperInfo
            label={copy.draftOrder}
            value={`${record.side} ${record.orderType}`}
            detail={`${formatQty(record.quantity)} ${baseAsset(record.symbol)}${record.price ? ` @ ${formatMoney(record.price)}` : ""}`}
          />
          <PaperInfo
            label={copy.tradeAmount}
            value={draftNotional ? formatMoney(draftNotional) : "-"}
            detail={record.tradeCount != null ? `${copy.trade}: ${record.tradeCount}` : ""}
          />
          <PaperInfo
            label={copy.orderStatus}
            value={orderStatus}
            detail={record.orderId || record.rejectionReason || ""}
          />
          <PaperInfo
            label={copy.filledValue}
            value={filledValue ? formatMoney(filledValue) : "-"}
            detail={record.executedPrice ? `${copy.avgPrice}: ${formatMoney(record.executedPrice)}` : ""}
          />
          <PaperInfo
            label={copy.perTradePnl}
            value={hasPnl ? formatSignedMoney(totalPnl) : "-"}
            detail={pnlPercent !== undefined ? `${copy.pnlPercent}: ${formatReturnPercent(pnlPercent)}` : ""}
          />
        </div>
      </div>

    </article>
  );
}

function formatSignedMoney(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "$0";
  return `${value > 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`;
}

function formatReturnPercent(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return formatPercent(normalized);
}

function PaperInfo({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 text-xs">
      <div className="text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-zinc-100">{value}</div>
      {detail ? <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">{detail}</div> : null}
    </div>
  );
}
