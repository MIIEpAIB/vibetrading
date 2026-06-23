import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  FileCode2,
  Filter,
  Gauge,
  Library,
  ListChecks,
  Pencil,
  Play,
  Plus,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, ApiError, type StrategyLibraryItem } from "@/lib/api";
import { useTranslation } from "@/i18n/I18nProvider";

type StrategyLanguage = "python" | "pine" | "javascript";
type StrategyStatus = "draft" | "testing" | "live" | "archived";
type StrategyCategory = "trend" | "mean_reversion" | "grid" | "risk" | "portfolio" | "arbitrage" | "utility";
type SortMode = "updated" | "name" | "status";

interface StrategyItem {
  id: string;
  name: string;
  description: string;
  language: StrategyLanguage;
  category: StrategyCategory;
  status: StrategyStatus;
  tags: string[];
  code: string;
  updatedAt: string;
  createdAt: string;
}

type StrategyPersistenceMode = "checking" | "remote" | "local";

interface AssistantPrompt {
  title: string;
  prompt: string;
  category: StrategyCategory;
}

interface StrategyTemplate {
  id: string;
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  language: StrategyLanguage;
  category: StrategyCategory;
  tags: string[];
  code: string;
}

const STORAGE_KEY = "vibe-personal-strategy-library";

const languageOptions: Array<{ value: StrategyLanguage; label: string }> = [
  { value: "python", label: "Python" },
  { value: "pine", label: "Pine Script" },
  { value: "javascript", label: "JavaScript" },
];

const statusOptions: Array<{ value: StrategyStatus }> = [
  { value: "draft" },
  { value: "testing" },
  { value: "live" },
  { value: "archived" },
];

const categoryOptions: Array<{ value: StrategyCategory }> = [
  { value: "trend" },
  { value: "mean_reversion" },
  { value: "grid" },
  { value: "risk" },
  { value: "portfolio" },
  { value: "arbitrage" },
  { value: "utility" },
];

const sortOptions: Array<{ value: SortMode; labelKey: "strategy.sortUpdated" | "strategy.sortName" | "strategy.sortStatus" }> = [
  { value: "updated", labelKey: "strategy.sortUpdated" },
  { value: "name", labelKey: "strategy.sortName" },
  { value: "status", labelKey: "strategy.sortStatus" },
];

const starterCode = `# Strategy idea
# Replace this draft with your entry, exit, sizing, and risk rules.

def generate_signals(data):
    close = data["close"]
    fast = close.rolling(20).mean()
    slow = close.rolling(60).mean()
    signal = (fast > slow).astype(int)
    return signal.diff().fillna(0)
`;

const seedStrategies: StrategyItem[] = [
  {
    id: "dual-ma-cross",
    name: "双均线交叉策略",
    description: "快慢均线交叉生成多空信号，适合作为趋势策略模板。",
    language: "python",
    category: "trend",
    status: "testing",
    tags: ["MA", "trend", "backtest"],
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    code: `def generate_signals(data, fast_window=20, slow_window=60):
    close = data["close"]
    fast_ma = close.rolling(fast_window).mean()
    slow_ma = close.rolling(slow_window).mean()
    position = (fast_ma > slow_ma).astype(int)
    signal = position.diff().fillna(0)
    signal.name = "dual_ma_signal"
    return signal
`,
  },
  {
    id: "bollinger-breakout",
    name: "布林带突破策略",
    description: "价格突破布林带上轨入场，回到中轨或触发风控时离场。",
    language: "python",
    category: "trend",
    status: "draft",
    tags: ["BOLL", "breakout", "volatility"],
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    code: `def bollinger_breakout(data, window=20, num_std=2, stop_loss=0.06):
    close = data["close"]
    mid = close.rolling(window).mean()
    band = close.rolling(window).std() * num_std
    upper = mid + band
    long_entry = close > upper
    long_exit = close < mid
    signal = long_entry.astype(int) - long_exit.astype(int)
    return signal.clip(-1, 1)
`,
  },
  {
    id: "rsi-reversal",
    name: "RSI 超买超卖策略",
    description: "RSI 低位反弹做多，高位回落离场，适合震荡行情验证。",
    language: "python",
    category: "mean_reversion",
    status: "draft",
    tags: ["RSI", "reversal", "oscillator"],
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    code: `def rsi_reversal(data, rsi, lower=30, upper=70, max_position=1.0):
    long_entry = rsi.shift(1) < lower
    long_exit = rsi.shift(1) > upper
    signal = long_entry.astype(int) - long_exit.astype(int)
    return signal.clip(-1, 1) * max_position
`,
  },
];

const strategyTemplates: StrategyTemplate[] = [
  {
    id: "template-dual-ma",
    titleZh: "双均线趋势模板",
    titleEn: "Dual MA Trend",
    descriptionZh: "入场、离场、仓位和交易成本占位完整，适合作为 Python 回测起点。",
    descriptionEn: "A complete Python starting point with entry, exit, sizing, and cost placeholders.",
    language: "python",
    category: "trend",
    tags: ["MA", "trend", "risk"],
    code: `def generate_signals(data, fast_window=20, slow_window=60, max_position=1.0):
    close = data["close"]
    fast_ma = close.rolling(fast_window).mean()
    slow_ma = close.rolling(slow_window).mean()

    trend_up = fast_ma > slow_ma
    position = trend_up.astype(float) * max_position
    signal = position.diff().fillna(0)
    return signal.clip(-max_position, max_position)


def risk_config():
    return {
        "stop_loss": 0.06,
        "take_profit": 0.18,
        "max_drawdown": 0.12,
        "commission": 0.0003,
        "slippage": 0.0005,
    }
`,
  },
  {
    id: "template-rsi-reversal",
    titleZh: "RSI 均值回归模板",
    titleEn: "RSI Mean Reversion",
    descriptionZh: "适合震荡行情验证，带冷却周期、仓位上限和风险参数。",
    descriptionEn: "Mean-reversion skeleton with cooldown, position cap, and risk parameters.",
    language: "python",
    category: "mean_reversion",
    tags: ["RSI", "reversal", "cooldown"],
    code: `def generate_signals(data, rsi, lower=30, upper=70, cooldown_bars=3):
    close = data["close"]
    entry = (rsi.shift(1) < lower) & (rsi >= lower)
    exit_signal = (rsi.shift(1) > upper) & (rsi <= upper)

    raw_signal = entry.astype(int) - exit_signal.astype(int)
    cooled = raw_signal.where(raw_signal.abs().rolling(cooldown_bars).sum() <= 1, 0)
    return cooled.reindex(close.index).fillna(0)


RISK = {
    "max_position": 0.35,
    "stop_loss": 0.04,
    "take_profit": 0.10,
    "commission": 0.0003,
}
`,
  },
  {
    id: "template-grid",
    titleZh: "网格策略骨架",
    titleEn: "Grid Strategy Skeleton",
    descriptionZh: "定义网格间距、最大层数、极端行情保护和止损止盈。",
    descriptionEn: "Defines grid spacing, max levels, extreme-market guardrails, and exits.",
    language: "python",
    category: "grid",
    tags: ["grid", "risk", "position"],
    code: `def grid_orders(mid_price, grid_pct=0.008, levels=5, base_qty=1):
    orders = []
    for level in range(1, levels + 1):
        buy_price = mid_price * (1 - grid_pct * level)
        sell_price = mid_price * (1 + grid_pct * level)
        orders.append({"side": "buy", "price": buy_price, "qty": base_qty})
        orders.append({"side": "sell", "price": sell_price, "qty": base_qty})
    return orders


def risk_guard(equity_curve, max_drawdown=0.10):
    peak = equity_curve.cummax()
    drawdown = equity_curve / peak - 1
    return drawdown.iloc[-1] > -max_drawdown
`,
  },
  {
    id: "template-pine-ma",
    titleZh: "TradingView 均线脚本",
    titleEn: "TradingView MA Script",
    descriptionZh: "Pine Script v5 策略模板，适合快速验证均线交叉逻辑。",
    descriptionEn: "Pine Script v5 strategy template for quick MA crossover validation.",
    language: "pine",
    category: "trend",
    tags: ["Pine", "TradingView", "MA"],
    code: `//@version=5
strategy("Dual MA Strategy", overlay=true, initial_capital=100000, commission_value=0.03)

fastLen = input.int(20, "Fast MA", minval=1)
slowLen = input.int(60, "Slow MA", minval=2)
riskPct = input.float(1.0, "Risk %", minval=0.1, maxval=5)

fast = ta.sma(close, fastLen)
slow = ta.sma(close, slowLen)

longEntry = ta.crossover(fast, slow)
longExit = ta.crossunder(fast, slow)

if longEntry
    strategy.entry("Long", strategy.long, qty_percent=riskPct)

if longExit
    strategy.close("Long")

plot(fast, color=color.orange)
plot(slow, color=color.blue)
`,
  },
  {
    id: "template-trailing-stop",
    titleZh: "追踪止损工具函数",
    titleEn: "Trailing Stop Utility",
    descriptionZh: "独立风控函数，可迁移到趋势、网格和组合策略。",
    descriptionEn: "Portable risk helper for trend, grid, and portfolio strategies.",
    language: "python",
    category: "risk",
    tags: ["stop", "risk", "utility"],
    code: `def trailing_stop(position_side, entry_price, high_watermark, low_watermark, trail_pct=0.05):
    if position_side == "long":
        stop_price = high_watermark * (1 - trail_pct)
        return max(stop_price, entry_price * (1 - trail_pct * 1.5))

    if position_side == "short":
        stop_price = low_watermark * (1 + trail_pct)
        return min(stop_price, entry_price * (1 + trail_pct * 1.5))

    raise ValueError("position_side must be long or short")
`,
  },
];

const assistantPrompts: AssistantPrompt[] = [
  { title: "写一个均线交易策略", category: "trend", prompt: "写一个均线交易策略，包含参数说明、入场/出场规则、仓位控制、回测示例和风险提示。" },
  { title: "写一个线性回归的函数", category: "utility", prompt: "写一个可复用的线性回归函数，用于量化策略中的趋势斜率判断，并给出示例调用。" },
  { title: "写一个带止损止盈的网格策略", category: "grid", prompt: "写一个带止损止盈的网格交易策略，包含网格间距、最大仓位、止损止盈、极端行情保护和回测思路。" },
  { title: "写一个布林带突破策略", category: "trend", prompt: "写一个布林带突破策略，包含信号生成、过滤条件、止损止盈、参数默认值和 Python 代码。" },
  { title: "写一个RSI超买超卖策略", category: "mean_reversion", prompt: "写一个 RSI 超买超卖策略，解释适用市场、参数、交易规则，并生成可回测的 Python 代码。" },
  { title: "写一个MACD金叉死叉策略", category: "trend", prompt: "写一个 MACD 金叉死叉策略，包含趋势过滤、仓位控制、回测指标和完整代码。" },
  { title: "写一个追踪止损函数", category: "risk", prompt: "写一个追踪止损函数，支持多头/空头、最高价/最低价更新、触发价计算和单元测试样例。" },
  { title: "写一个双均线交叉策略", category: "trend", prompt: "写一个双均线交叉策略，要求代码清晰、参数可配置，并说明如何避免震荡行情频繁交易。" },
  { title: "写一个定时定额定投策略", category: "portfolio", prompt: "写一个定时定额定投策略，支持固定周期、现金管理、再平衡和回测绩效分析。" },
  { title: "分析策略逻辑与风险", category: "risk", prompt: "分析下面策略的交易逻辑、潜在风险、过拟合点、参数敏感性和改进建议。策略代码如下：\n\n" },
  { title: "分析我的代码有什么问题", category: "utility", prompt: "分析我的策略代码有什么问题，重点检查 look-ahead bias、数据泄漏、交易成本、异常处理和代码可维护性。代码如下：\n\n" },
  { title: "给代码添加中文注释", category: "utility", prompt: "给下面策略代码添加清晰的中文注释，不改变逻辑，并指出关键参数含义。代码如下：\n\n" },
  { title: "写一个动量突破策略", category: "trend", prompt: "写一个动量突破策略，包含突破定义、成交量/波动率过滤、止损止盈和回测代码。" },
  { title: "写一个多品种轮动策略", category: "portfolio", prompt: "写一个多品种轮动策略，使用动量或风险调整收益排序，包含调仓频率、资产池、风控和回测实现。" },
  { title: "写一个资金费率套利策略", category: "arbitrage", prompt: "写一个资金费率套利策略，覆盖现货/永续对冲、资金费率筛选、基差风险、手续费、滑点和风控。" },
];

const qualityRules = [
  {
    id: "signals",
    labelKey: "strategy.checkSignals",
    hintKey: "strategy.checkSignalsHint",
    test: (strategy: StrategyItem) => /generate_signals|signal|entry|exit|long|short|buy|sell|入场|出场|买入|卖出/i.test(strategy.code),
  },
  {
    id: "risk",
    labelKey: "strategy.checkRisk",
    hintKey: "strategy.checkRiskHint",
    test: (strategy: StrategyItem) => /risk|stop|drawdown|position|sizing|take_profit|max_position|止损|止盈|风控|仓位|回撤/i.test(`${strategy.description}\n${strategy.code}`),
  },
  {
    id: "parameters",
    labelKey: "strategy.checkParams",
    hintKey: "strategy.checkParamsHint",
    test: (strategy: StrategyItem) => /def\s+\w+\([^)]*=|input\.|const\s+\w+\s*=|let\s+\w+\s*=|参数|window|period|threshold/i.test(strategy.code),
  },
  {
    id: "costs",
    labelKey: "strategy.checkCosts",
    hintKey: "strategy.checkCostsHint",
    test: (strategy: StrategyItem) => /backtest|commission|slippage|fee|cost|spread|回测|手续费|滑点|交易成本/i.test(`${strategy.description}\n${strategy.code}`),
  },
  {
    id: "lookahead",
    labelKey: "strategy.checkLookahead",
    hintKey: "strategy.checkLookaheadHint",
    test: (strategy: StrategyItem) => !/shift\s*\(\s*-\d+|future|tomorrow|未来函数|未来数据/i.test(strategy.code),
  },
] as const;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `strategy_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStrategyLanguage(value: unknown): value is StrategyLanguage {
  return languageOptions.some((option) => option.value === value);
}

function isStrategyStatus(value: unknown): value is StrategyStatus {
  return statusOptions.some((option) => option.value === value);
}

function isStrategyCategory(value: unknown): value is StrategyCategory {
  return categoryOptions.some((option) => option.value === value);
}

function toTags(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeStrategy(value: unknown, fallback: StrategyItem): StrategyItem {
  if (!isRecord(value)) return fallback;
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8)
    : fallback.tags;
  const now = new Date().toISOString();

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : fallback.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : fallback.name,
    description: typeof value.description === "string" ? value.description : fallback.description,
    language: isStrategyLanguage(value.language) ? value.language : fallback.language,
    category: isStrategyCategory(value.category) ? value.category : fallback.category,
    status: isStrategyStatus(value.status) ? value.status : fallback.status,
    tags,
    code: typeof value.code === "string" ? value.code : fallback.code,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : fallback.createdAt,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
  };
}

function loadStrategies(): StrategyItem[] {
  if (typeof window === "undefined") return seedStrategies;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedStrategies;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seedStrategies;
    return parsed.map((item, index) => normalizeStrategy(item, seedStrategies[index] ?? seedStrategies[0]));
  } catch {
    return seedStrategies;
  }
}

function saveStrategies(strategies: StrategyItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(strategies));
}

function toApiStrategy(strategy: StrategyItem): StrategyLibraryItem {
  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    language: strategy.language,
    category: strategy.category,
    status: strategy.status,
    tags: strategy.tags,
    code: strategy.code,
    createdAt: strategy.createdAt,
    updatedAt: strategy.updatedAt,
  };
}

function isRemotePersistenceUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
}

function buildAssistantPrompt(prompt: string, strategy?: StrategyItem | null) {
  const parts = [
    "你是量化策略助手，职责是协助策略编写、代码优化、Bug 修复、回测分析和风险审查。",
    "请输出可执行或易于迁移的策略代码，并包含：策略逻辑、参数说明、风险点、回测建议和下一步验证清单。",
    "",
    prompt,
  ];
  if (strategy) {
    parts.push("", `当前策略名称：${strategy.name}`, `当前策略描述：${strategy.description}`, "当前策略代码：", strategy.code);
  }
  return parts.join("\n");
}

function newStrategy(overrides: Partial<StrategyItem> = {}): StrategyItem {
  const now = new Date().toISOString();
  return {
    id: createId(),
    name: "Untitled Strategy",
    description: "Describe the signal, universe, timeframe, and risk rule.",
    language: "python",
    category: "trend",
    status: "draft",
    tags: ["draft"],
    code: starterCode,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function templateToStrategy(template: StrategyTemplate, language: string): StrategyItem {
  return newStrategy({
    name: language === "zh-CN" ? template.titleZh : template.titleEn,
    description: language === "zh-CN" ? template.descriptionZh : template.descriptionEn,
    language: template.language,
    category: template.category,
    status: "draft",
    tags: template.tags,
    code: template.code,
  });
}

function extractStrategies(payload: unknown): StrategyItem[] {
  const fallback = newStrategy();
  const rawItems = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.strategies)
      ? payload.strategies
      : isRecord(payload) && typeof payload.code === "string"
        ? [payload]
        : [];

  return rawItems
    .map((item) => normalizeStrategy(item, fallback))
    .filter((strategy) => strategy.name.trim() && strategy.code.trim());
}

function downloadJson(fileName: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function statusTone(status: StrategyStatus) {
  if (status === "live") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (status === "testing") return "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300";
  if (status === "archived") return "border-zinc-500/30 bg-zinc-500/10 text-muted-foreground";
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function MetricPill({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="inline-flex min-w-0 items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="truncate">{label}</span>
      <span className="font-mono font-semibold text-foreground">{value.toLocaleString()}</span>
    </div>
  );
}

function sortStrategies(items: StrategyItem[], mode: SortMode): StrategyItem[] {
  const statusRank: Record<StrategyStatus, number> = {
    live: 0,
    testing: 1,
    draft: 2,
    archived: 3,
  };
  return [...items].sort((a, b) => {
    if (mode === "name") return a.name.localeCompare(b.name);
    if (mode === "status") return statusRank[a.status] - statusRank[b.status] || b.updatedAt.localeCompare(a.updatedAt);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function StrategyLibrary() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const remoteReadyRef = useRef(false);
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set());
  const [strategies, setStrategies] = useState<StrategyItem[]>(() => loadStrategies());
  const [activeId, setActiveId] = useState(() => strategies[0]?.id ?? "");
  const [persistenceMode, setPersistenceMode] = useState<StrategyPersistenceMode>("checking");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<StrategyCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StrategyStatus | "all">("all");
  const [languageFilter, setLanguageFilter] = useState<StrategyLanguage | "all">("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [assistantQuery, setAssistantQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listStrategies()
      .then((payload) => {
        if (cancelled) return;
        remoteReadyRef.current = true;
        setPersistenceMode("remote");
        const remoteStrategies = payload.strategies
          .map((item, index) => normalizeStrategy(item, seedStrategies[index] ?? seedStrategies[0]))
          .filter((strategy) => strategy.name.trim() && strategy.code.trim());
        if (remoteStrategies.length > 0) {
          setStrategies(remoteStrategies);
          setActiveId(remoteStrategies[0].id);
          saveStrategies(remoteStrategies);
        } else {
          api.replaceStrategies(strategies.map(toApiStrategy)).catch(() => undefined);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        remoteReadyRef.current = false;
        setPersistenceMode("local");
        if (!isRemotePersistenceUnavailable(error)) {
          toast.error(error instanceof Error ? error.message : "Failed to load strategies");
        }
      });
    return () => {
      cancelled = true;
    };
    // Initial remote hydration only. Later edits sync through the debounced effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveStrategies(strategies);
    if (!remoteReadyRef.current) return;
    const timer = window.setTimeout(() => {
      const deleteIds = Array.from(pendingDeleteIdsRef.current);
      pendingDeleteIdsRef.current.clear();
      Promise.all(deleteIds.map((id) => api.deleteStrategy(id).catch(() => undefined)))
        .then(() => api.replaceStrategies(strategies.map(toApiStrategy)))
        .catch((error) => {
          if (isRemotePersistenceUnavailable(error)) {
            remoteReadyRef.current = false;
            setPersistenceMode("local");
            return;
          }
          toast.error(error instanceof Error ? error.message : "Failed to sync strategies");
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [strategies]);

  useEffect(() => {
    if (strategies.length === 0) {
      const draft = newStrategy({
        name: t("strategy.untitled"),
        description: t("strategy.defaultDescription"),
      });
      setStrategies([draft]);
      setActiveId(draft.id);
      return;
    }
    if (!strategies.some((strategy) => strategy.id === activeId)) {
      setActiveId(strategies[0].id);
    }
  }, [activeId, strategies, t]);

  const categoryLabels: Record<StrategyCategory, string> = language === "zh-CN"
    ? {
      trend: "趋势",
      mean_reversion: "均值回归",
      grid: "网格",
      risk: "风控",
      portfolio: "组合",
      arbitrage: "套利",
      utility: "工具",
    }
    : {
      trend: "Trend",
      mean_reversion: "Mean Reversion",
      grid: "Grid",
      risk: "Risk",
      portfolio: "Portfolio",
      arbitrage: "Arbitrage",
      utility: "Utility",
    };
  const statusLabels: Record<StrategyStatus, string> = language === "zh-CN"
    ? {
      draft: "草稿",
      testing: "测试中",
      live: "运行中",
      archived: "已归档",
    }
    : {
      draft: "Draft",
      testing: "Testing",
      live: "Live",
      archived: "Archived",
    };

  const filteredStrategies = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = strategies.filter((strategy) => {
      if (categoryFilter !== "all" && strategy.category !== categoryFilter) return false;
      if (statusFilter !== "all" && strategy.status !== statusFilter) return false;
      if (languageFilter !== "all" && strategy.language !== languageFilter) return false;
      if (!q) return true;
      return [
        strategy.name,
        strategy.description,
        strategy.language,
        strategy.category,
        strategy.status,
        strategy.tags.join(" "),
        strategy.code,
      ].some((value) => value.toLowerCase().includes(q));
    });
    return sortStrategies(filtered, sortMode);
  }, [categoryFilter, languageFilter, query, sortMode, statusFilter, strategies]);

  const activeStrategy = strategies.find((strategy) => strategy.id === activeId) ?? strategies[0];

  const filteredPrompts = useMemo(() => {
    const q = assistantQuery.trim().toLowerCase();
    if (!q) return assistantPrompts;
    return assistantPrompts.filter((item) => `${item.title} ${item.prompt}`.toLowerCase().includes(q));
  }, [assistantQuery]);

  const activeChecks = useMemo(
    () => (activeStrategy ? qualityRules.map((rule) => ({ ...rule, passed: rule.test(activeStrategy) })) : []),
    [activeStrategy],
  );
  const qualityScore = activeChecks.length
    ? Math.round((activeChecks.filter((check) => check.passed).length / activeChecks.length) * 100)
    : 0;
  const totalCodeLines = strategies.reduce((sum, strategy) => sum + strategy.code.split("\n").length, 0);
  const statusCounts = statusOptions.map((option) => ({
    ...option,
    count: strategies.filter((strategy) => strategy.status === option.value).length,
  }));
  const activeLineCount = activeStrategy?.code.split("\n").length ?? 0;
  const activeCharCount = activeStrategy?.code.length ?? 0;
  const activeIssueCount = activeChecks.filter((check) => !check.passed).length;
  const saveLabel = persistenceMode === "remote" ? "Saved to MySQL" : t("strategy.autosaved");

  const updateActive = (patch: Partial<StrategyItem>) => {
    if (!activeStrategy) return;
    setStrategies((current) =>
      current.map((strategy) =>
        strategy.id === activeStrategy.id
          ? { ...strategy, ...patch, updatedAt: new Date().toISOString() }
          : strategy,
      ),
    );
  };

  const handleNew = () => {
    const draft = newStrategy({
      name: t("strategy.untitled"),
      description: t("strategy.defaultDescription"),
    });
    setStrategies((current) => [draft, ...current]);
    setActiveId(draft.id);
    toast.success(t("strategy.created"));
  };

  const handleCreateFromTemplate = (template: StrategyTemplate) => {
    const draft = templateToStrategy(template, language);
    setStrategies((current) => [draft, ...current]);
    setActiveId(draft.id);
    toast.success(t("strategy.templateCreated"));
  };

  const handleDuplicate = () => {
    if (!activeStrategy) return;
    const now = new Date().toISOString();
    const copyItem: StrategyItem = {
      ...activeStrategy,
      id: createId(),
      name: `${activeStrategy.name} Copy`,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
    setStrategies((current) => [copyItem, ...current]);
    setActiveId(copyItem.id);
    toast.success(t("strategy.duplicated"));
  };

  const handleDelete = (id: string) => {
    pendingDeleteIdsRef.current.add(id);
    setStrategies((current) => {
      const next = current.filter((strategy) => strategy.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? "");
      return next;
    });
    setDeleteTarget(null);
    toast.success(t("strategy.deleted"));
  };

  const handleTagsChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateActive({ tags: toTags(event.target.value) });
  };

  const handleCopyCode = async () => {
    if (!activeStrategy) return;
    try {
      await navigator.clipboard.writeText(activeStrategy.code);
      toast.success(t("chat.copied"));
    } catch {
      toast.error(t("strategy.copyFailed"));
    }
  };

  const handleExport = (items: StrategyItem[], fileName: string) => {
    try {
      downloadJson(fileName, {
        version: 1,
        exportedAt: new Date().toISOString(),
        strategies: items,
      });
    } catch {
      toast.error(t("strategy.exportFailed"));
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const imported = extractStrategies(payload);
      if (imported.length === 0) {
        toast.error(t("strategy.importInvalid"));
        return;
      }

      const usedIds = new Set(strategies.map((strategy) => strategy.id));
      const now = new Date().toISOString();
      const deduped = imported.map((strategy) => {
        const id = usedIds.has(strategy.id) ? createId() : strategy.id;
        usedIds.add(id);
        return { ...strategy, id, updatedAt: now };
      });

      setStrategies((current) => [...deduped, ...current]);
      setActiveId(deduped[0].id);
      toast.success(t("strategy.importedCount", { count: deduped.length }));
    } catch {
      toast.error(t("strategy.importFailed"));
    }
  };

  const resetFilters = () => {
    setQuery("");
    setCategoryFilter("all");
    setStatusFilter("all");
    setLanguageFilter("all");
    setSortMode("updated");
  };

  const openAssistant = (prompt: string, withCurrent = true) => {
    const finalPrompt = buildAssistantPrompt(prompt, withCurrent ? activeStrategy : null);
    const promptKey = `strategy_prompt_${createId()}`;
    window.sessionStorage.setItem(promptKey, finalPrompt);
    navigate(`/agent?promptKey=${encodeURIComponent(promptKey)}&auto=1`);
  };

  const handleCustomAssistant = () => {
    const prompt = assistantQuery.trim();
    if (!prompt) return;
    openAssistant(prompt);
  };

  const quickActions = [
    { label: t("strategy.actionReview"), prompt: t("strategy.reviewPrompt"), icon: ShieldCheck },
    { label: t("strategy.actionOptimize"), prompt: t("strategy.optimizePrompt"), icon: WandSparkles },
    { label: t("strategy.actionBacktest"), prompt: t("strategy.backtestPrompt"), icon: Gauge },
    { label: t("strategy.actionRisk"), prompt: t("strategy.riskPrompt"), icon: AlertTriangle },
    { label: t("strategy.actionExplain"), prompt: t("strategy.explainPrompt"), icon: Sparkles },
  ] as const;

  return (
    <div className="min-h-full bg-background">
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFile}
      />

      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Library className="h-4 w-4 text-primary" />
                {t("strategy.kicker")}
              </div>
              <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
                {t("strategy.title")}
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                {t("strategy.subtitle")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted"
              >
                <Upload className="h-4 w-4 shrink-0" />
                <span className="truncate">{t("strategy.import")}</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport(strategies, "venus-strategy-library.json")}
                className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted"
              >
                <Download className="h-4 w-4 shrink-0" />
                <span className="truncate">{t("strategy.exportAll")}</span>
              </button>
              <button
                type="button"
                onClick={() => openAssistant(t("strategy.defaultPrompt"), false)}
                className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted"
              >
                <WandSparkles className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{t("strategy.aiCreate")}</span>
              </button>
              <button
                type="button"
                onClick={handleNew}
                className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="truncate">{t("strategy.new")}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <MetricPill icon={Library} label={t("strategy.count")} value={strategies.length} />
            <MetricPill icon={ListChecks} label={t("strategy.testing")} value={strategies.filter((strategy) => strategy.status === "testing").length} />
            <MetricPill icon={Filter} label={t("strategy.filtered")} value={filteredStrategies.length} />
            <MetricPill icon={Code2} label={t("strategy.lines")} value={totalCodeLines} />
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:px-8 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="min-h-0 space-y-4">
          <div className="rounded-lg border bg-card">
            <div className="border-b p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("strategy.searchPlaceholder")}
                  className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-primary/25"
                />
              </div>
              <div className="mt-3 grid gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCategoryFilter("all")}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                      categoryFilter === "all" ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t("strategy.all")}
                  </button>
                  {categoryOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setCategoryFilter(option.value)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                        categoryFilter === option.value ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {categoryLabels[option.value]}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <SlidersHorizontal className="h-3 w-3" />
                      {t("strategy.statusFilter")}
                    </span>
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value as StrategyStatus | "all")}
                      className="h-9 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      <option value="all">{t("strategy.all")}</option>
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>{statusLabels[option.value]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Code2 className="h-3 w-3" />
                      {t("strategy.language")}
                    </span>
                    <select
                      value={languageFilter}
                      onChange={(event) => setLanguageFilter(event.target.value as StrategyLanguage | "all")}
                      className="h-9 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      <option value="all">{t("strategy.all")}</option>
                      {languageOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <label className="block">
                    <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Filter className="h-3 w-3" />
                      {t("strategy.sort")}
                    </span>
                    <select
                      value={sortMode}
                      onChange={(event) => setSortMode(event.target.value as SortMode)}
                      className="h-9 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {sortOptions.map((option) => (
                        <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-5 h-9 rounded-lg border bg-background px-3 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    {t("strategy.reset")}
                  </button>
                </div>
              </div>
            </div>

            <div className="max-h-[calc(100vh-24rem)] min-h-[18rem] overflow-auto p-2">
              {filteredStrategies.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
                  <FileCode2 className="h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">{t("strategy.noMatches")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("strategy.noMatchesHint")}</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredStrategies.map((strategy) => {
                    const active = activeStrategy?.id === strategy.id;
                    return (
                      <button
                        key={strategy.id}
                        type="button"
                        onClick={() => setActiveId(strategy.id)}
                        className={cn(
                          "block w-full rounded-lg border p-3 text-left transition",
                          active ? "border-primary bg-primary/10" : "bg-background hover:bg-muted/60",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{strategy.name}</div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {strategy.description || t("strategy.emptyDescription")}
                            </div>
                          </div>
                          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", statusTone(strategy.status))}>
                            {statusLabels[strategy.status]}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="rounded border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {strategy.language}
                          </span>
                          <span className="rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {categoryLabels[strategy.category]}
                          </span>
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {formatDate(strategy.updatedAt)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Pencil className="h-4 w-4 text-primary" />
              {t("strategy.workflow")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {statusCounts.map((status) => (
                <button
                  key={status.value}
                  type="button"
                  onClick={() => setStatusFilter(status.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition hover:bg-muted",
                    statusFilter === status.value ? "border-primary bg-primary/10" : "bg-background",
                  )}
                >
                  <div className="text-xs text-muted-foreground">{statusLabels[status.value]}</div>
                  <div className="mt-1 font-mono text-lg font-semibold">{status.count}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          {activeStrategy && (
            <div className="rounded-lg border bg-card">
              <div className="border-b p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone(activeStrategy.status))}>
                        {statusLabels[activeStrategy.status]}
                      </span>
                      <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {categoryLabels[activeStrategy.category]}
                      </span>
                      <span className="rounded-full border bg-background px-2.5 py-1 font-mono text-xs font-medium text-muted-foreground">
                        {activeStrategy.language}
                      </span>
                    </div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("strategy.name")}
                    </label>
                    <input
                      value={activeStrategy.name}
                      onChange={(event) => updateActive({ name: event.target.value })}
                      className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-lg font-semibold outline-none transition focus:ring-2 focus:ring-primary/25"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end xl:max-w-md">
                    <button
                      type="button"
                      onClick={() => handleExport([activeStrategy], `${activeStrategy.name || "strategy"}.json`)}
                      className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted"
                    >
                      <Download className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t("strategy.exportCurrent")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted"
                    >
                      <Copy className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t("strategy.copyCode")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDuplicate}
                      className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted"
                    >
                      <Copy className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t("strategy.duplicate")}</span>
                    </button>
                    {deleteTarget === activeStrategy.id ? (
                      <div className="inline-flex items-center overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5">
                        <button
                          type="button"
                          onClick={() => handleDelete(activeStrategy.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-destructive"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t("layout.confirm")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(null)}
                          className="border-l px-2.5 py-2 text-xs font-semibold text-muted-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(activeStrategy.id)}
                        className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:border-destructive/40 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 shrink-0" />
                        <span className="truncate">{t("layout.delete")}</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_9rem_9rem_9rem]">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("strategy.description")}
                    </label>
                    <input
                      value={activeStrategy.description}
                      onChange={(event) => updateActive({ description: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-primary/25"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("strategy.language")}
                    </label>
                    <select
                      value={activeStrategy.language}
                      onChange={(event) => updateActive({ language: event.target.value as StrategyLanguage })}
                      className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {languageOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("strategy.category")}
                    </label>
                    <select
                      value={activeStrategy.category}
                      onChange={(event) => updateActive({ category: event.target.value as StrategyCategory })}
                      className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {categoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {categoryLabels[option.value]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("strategy.status")}
                    </label>
                    <select
                      value={activeStrategy.status}
                      onChange={(event) => updateActive({ status: event.target.value as StrategyStatus })}
                      className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {statusLabels[option.value]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("strategy.tags")}
                  </label>
                  <input
                    value={activeStrategy.tags.join(", ")}
                    onChange={handleTagsChange}
                    className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-primary/25"
                    placeholder="MA, BTC, risk"
                  />
                </div>
              </div>

              <div className="border-b bg-muted/30 px-4 py-2">
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Save className="h-3.5 w-3.5 text-primary" />
                    {saveLabel}
                    <span className="font-mono">{formatDate(activeStrategy.updatedAt)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    {activeLineCount} {t("strategy.linesLower")}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    {activeCharCount} {t("strategy.characters")}
                  </span>
                  <button
                    type="button"
                    onClick={() => openAssistant(t("strategy.reviewPrompt"))}
                    className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 font-semibold text-foreground transition hover:bg-muted sm:ml-auto"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    {t("strategy.runReview")}
                  </button>
                </div>
              </div>

              <textarea
                value={activeStrategy.code}
                onChange={(event) => updateActive({ code: event.target.value })}
                spellCheck={false}
                className="min-h-[36rem] w-full resize-y border-0 bg-[#080a0c] p-4 font-mono text-sm leading-6 text-zinc-100 outline-none lg:min-h-[calc(100vh-28rem)]"
              />
            </div>
          )}
        </main>

        <aside className="grid gap-4 lg:grid-cols-2 xl:col-start-2">
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">{t("strategy.quality")}</h2>
                  <p className="text-xs text-muted-foreground">{t("strategy.qualitySubtitle")}</p>
                </div>
              </div>
              <div className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border font-mono text-lg font-semibold",
                qualityScore >= 80 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}>
                {qualityScore}
              </div>
            </div>
            <div className="space-y-2">
              {activeChecks.map((check) => (
                <div key={check.id} className="flex gap-2 rounded-lg border bg-background p-2.5">
                  {check.passed ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">{t(check.labelKey)}</div>
                    <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{t(check.hintKey)}</div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => openAssistant(t("strategy.reviewPrompt"))}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              <ShieldCheck className="h-4 w-4" />
              {activeIssueCount > 0 ? t("strategy.fixIssues", { count: activeIssueCount }) : t("strategy.qualityReady")}
            </button>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileCode2 className="h-4 w-4 text-primary" />
              {t("strategy.templates")}
            </div>
            <div className="max-h-[18rem] space-y-2 overflow-auto pr-1">
              {strategyTemplates.map((template) => (
                <div key={template.id} className="rounded-lg border bg-background p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {language === "zh-CN" ? template.titleZh : template.titleEn}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {language === "zh-CN" ? template.descriptionZh : template.descriptionEn}
                      </div>
                    </div>
                    <span className="rounded border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {template.language}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCreateFromTemplate(template)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs font-semibold transition hover:bg-muted"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("strategy.createFromTemplate")}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-card lg:col-span-2">
            <div className="border-b p-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">{t("strategy.assistantTitle")}</h2>
                  <p className="text-xs text-muted-foreground">{t("strategy.assistantSubtitle")}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {quickActions.map(({ label, prompt, icon: Icon }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => openAssistant(prompt)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border bg-background px-2 py-2 text-xs font-semibold transition hover:bg-muted"
                  >
                    <Icon className="h-3.5 w-3.5 text-primary" />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={assistantQuery}
                  onChange={(event) => setAssistantQuery(event.target.value)}
                  placeholder={t("strategy.assistantPlaceholder")}
                  className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-primary/25"
                />
                <button
                  type="button"
                  onClick={handleCustomAssistant}
                  disabled={!assistantQuery.trim()}
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
                  title={t("strategy.askAssistant")}
                >
                  <Play className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-[16rem] overflow-auto p-2">
              <div className="space-y-1.5">
                {filteredPrompts.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => openAssistant(item.prompt)}
                    className="block w-full rounded-lg border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <WandSparkles className="h-3.5 w-3.5 text-primary" />
                      {item.title}
                    </span>
                    <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {item.prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Link
            to="/agent"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-semibold transition hover:bg-muted lg:col-span-2"
          >
            <Bot className="h-4 w-4" />
            {t("strategy.openAgent")}
          </Link>
        </aside>
      </div>
    </div>
  );
}
