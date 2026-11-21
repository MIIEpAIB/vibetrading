import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  Check,
  Copy,
  BarChart3,
  Download,
  FileCode2,
  Database,
  LineChart,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RadioTower,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  WandSparkles,
  WalletCards,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, ApiError, type StrategyBacktestRequest, type StrategyLibraryItem, type StrategyMarketBacktestResponse, type StrategyVersionItem } from "@/lib/api";
import { adminUrl } from "@/lib/adminUrl";
import { StrategyCodeEditor } from "@/components/strategy/StrategyCodeEditor";
import { buildClassicTurtlePythonStrategyCode, getStrategyRouteId } from "@/lib/strategyMarketplace";
import { quantaxisStarterCode, toQuantaxisStrategyCode } from "@/lib/quantaxisStrategy";
import { useTranslation } from "@/i18n/I18nProvider";

type StrategyLanguage = "javascript" | "python" | "cpp" | "rust" | "pine";
type StrategyStatus = "draft" | "testing" | "live" | "archived";
type StrategyCategory = "trend" | "mean_reversion" | "grid" | "risk" | "portfolio" | "arbitrage" | "utility";
type StrategyShareStatus = "none" | "submitted" | "published" | "rejected" | "hidden" | "archived" | string;

interface StrategyItem {
  id: string;
  name: string;
  description: string;
  strategyDescription?: string;
  language: StrategyLanguage;
  category: StrategyCategory;
  status: StrategyStatus;
  tags: string[];
  code: string;
  updatedAt: string;
  createdAt: string;
  shareStatus?: StrategyShareStatus;
}

type StrategyPersistenceMode = "checking" | "remote" | "local";

type MoreMenuState = {
  strategy: StrategyItem;
  top: number;
  left: number;
};

type DeploymentWizardState = {
  strategy: StrategyItem;
  target: "SHADOW" | "LIVE";
  versionNo: string;
  market: string;
  symbols: string;
  timeframe: string;
  initialCash: string;
  parametersJson: string;
  riskPolicyJson: string;
  brokerBindingId: string;
};

type QuantaxisBacktestState = {
  strategy: StrategyItem;
  startDate: string;
  endDate: string;
  symbol: string;
  interval: string;
  source: string;
  initialCapital: string;
  benchmark: string;
  commission: string;
  slippage: string;
  leverage: string;
  riskFreeRate: string;
  analyzer: string;
  optimize: boolean;
  optimizationTarget: string;
  walkForwardWindows: string;
  parametersJson: string;
  result: StrategyMarketBacktestResponse | null;
};

const languageOptions: Array<{ value: StrategyLanguage; label: string }> = [
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "cpp", label: "C++" },
  { value: "rust", label: "Rust" },
  { value: "pine", label: "Pine" },
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

const starterCode = quantaxisStarterCode;

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

function normalizeStrategyLanguage(value: unknown, fallback: StrategyLanguage): StrategyLanguage {
  if (value === "json") return "javascript";
  return isStrategyLanguage(value) ? value : fallback;
}

function isLegacyClassicTurtleJsonSpec(id: string, code: string): boolean {
  if (id !== "classic-turtle-trading" || !code.trim().startsWith("{")) return false;
  try {
    const parsed = JSON.parse(code) as unknown;
    return (
      isRecord(parsed)
      && parsed.schema === "vibe.strategy_spec.v1"
      && parsed.strategy_id === "classic-turtle-trading"
    );
  } catch {
    return false;
  }
}

function isStrategyStatus(value: unknown): value is StrategyStatus {
  return statusOptions.some((option) => option.value === value);
}

function isStrategyCategory(value: unknown): value is StrategyCategory {
  return categoryOptions.some((option) => option.value === value);
}

function normalizeShareStatus(value: unknown): StrategyShareStatus {
  return typeof value === "string" && value.trim() ? value : "none";
}

function formatDate(value: string, withTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function normalizeStrategy(value: unknown, fallback: StrategyItem): StrategyItem {
  if (!isRecord(value)) return fallback;
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8)
    : fallback.tags;
  const now = new Date().toISOString();
  const id = typeof value.id === "string" && value.id.trim() ? value.id : fallback.id;
  const rawCode = typeof value.code === "string" ? value.code : fallback.code;
  const name = typeof value.name === "string" && value.name.trim() ? value.name : fallback.name;
  const shouldMigrateClassicTurtle = isLegacyClassicTurtleJsonSpec(id, rawCode);
  const quantaxisCode = shouldMigrateClassicTurtle
    ? toQuantaxisStrategyCode(buildClassicTurtlePythonStrategyCode(), name)
    : toQuantaxisStrategyCode(rawCode, name);

  return {
    id,
    name,
    description: typeof value.description === "string" ? value.description : fallback.description,
    strategyDescription: typeof value.strategyDescription === "string"
      ? value.strategyDescription
      : typeof value.strategy_description === "string"
        ? value.strategy_description
        : fallback.strategyDescription,
    language: shouldMigrateClassicTurtle ? "python" : normalizeStrategyLanguage(value.language, fallback.language),
    category: isStrategyCategory(value.category) ? value.category : fallback.category,
    status: isStrategyStatus(value.status) ? value.status : fallback.status,
    tags,
    code: quantaxisCode,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : fallback.createdAt,
    updatedAt: shouldMigrateClassicTurtle ? now : typeof value.updatedAt === "string" ? value.updatedAt : now,
    shareStatus: normalizeShareStatus(value.shareStatus ?? value.share_status),
  };
}

function newStrategy(overrides: Partial<StrategyItem> = {}): StrategyItem {
  const now = new Date().toISOString();
  return {
    id: createId(),
    name: "Untitled Strategy",
    description: "Describe the signal, universe, timeframe, and risk rule.",
    strategyDescription: "",
    language: "python",
    category: "trend",
    status: "draft",
    tags: ["draft"],
    code: starterCode,
    createdAt: now,
    updatedAt: now,
    shareStatus: "none",
    ...overrides,
  };
}

function loadStrategies(): StrategyItem[] {
  return [];
}

function toApiStrategy(strategy: StrategyItem): StrategyLibraryItem {
  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    strategyDescription: strategy.strategyDescription ?? "",
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
  return error instanceof ApiError && (error.status === 404 || error.status === 500 || error.status === 501);
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

function shadowRiskPolicyForStrategy(strategy: StrategyItem) {
  const fallbackRisk = {
    max_order_notional: 500,
    max_total_exposure: 5000,
    max_trades_per_day: 5,
    min_cash_buffer: 100,
  };
  let symbol = "BTC_USDT";
  let risk = fallbackRisk;
  try {
    const parsed = JSON.parse(strategy.code) as unknown;
    if (isRecord(parsed)) {
      const signal = isRecord(parsed.shadow_signal) ? parsed.shadow_signal : null;
      const rawSymbol = typeof signal?.symbol === "string" ? signal.symbol : "";
      if (rawSymbol.trim()) symbol = rawSymbol.replace("-", "_").replace("/", "_").toUpperCase();
      if (isRecord(parsed.risk)) {
        risk = {
          max_order_notional: Number(parsed.risk.max_order_notional) || fallbackRisk.max_order_notional,
          max_total_exposure: Number(parsed.risk.max_total_exposure) || fallbackRisk.max_total_exposure,
          max_trades_per_day: Number(parsed.risk.max_trades_per_day) || fallbackRisk.max_trades_per_day,
          min_cash_buffer: Number(parsed.risk.min_cash_buffer) || fallbackRisk.min_cash_buffer,
        };
      }
    }
  } catch {
    // Plain Python strategies use the conservative default shadow risk policy.
  }
  return {
    symbols: [symbol],
    allowed_sides: ["BUY", "SELL"],
    max_order_notional: risk.max_order_notional,
    max_total_exposure: risk.max_total_exposure,
    max_trades_per_day: risk.max_trades_per_day,
    min_cash_buffer: risk.min_cash_buffer,
    default_order_notional: Math.min(100, risk.max_order_notional),
    order_type: "MARKET",
  };
}

function deploymentWizardForStrategy(strategy: StrategyItem, target: "SHADOW" | "LIVE"): DeploymentWizardState {
  const inferred = shadowRiskPolicyForStrategy(strategy);
  return {
    strategy,
    target,
    versionNo: "",
    market: "CRYPTO",
    symbols: inferred.symbols.join(","),
    timeframe: "1h",
    initialCash: "100000",
    parametersJson: "{}",
    riskPolicyJson: JSON.stringify({
      initial_cash: 100000,
      allowed_sides: inferred.allowed_sides,
      max_order_notional: inferred.max_order_notional,
      max_total_exposure: inferred.max_total_exposure,
      max_trades_per_day: inferred.max_trades_per_day,
      min_cash_buffer: inferred.min_cash_buffer,
      default_order_notional: inferred.default_order_notional,
      order_type: inferred.order_type,
    }, null, 2),
    brokerBindingId: "",
  };
}

function quantaxisBacktestForStrategy(strategy: StrategyItem): QuantaxisBacktestState {
  return {
    strategy,
    startDate: "2024-01-01",
    endDate: "2026-06-27",
    symbol: "BTC-USDT",
    interval: "4H",
    source: "okx",
    initialCapital: "100000",
    benchmark: "auto",
    commission: "0.0005",
    slippage: "0.0005",
    leverage: "1",
    riskFreeRate: "0",
    analyzer: "QAAnalysis",
    optimize: false,
    optimizationTarget: "sharpe",
    walkForwardWindows: "4",
    parametersJson: JSON.stringify({
      quantaxis_backtest: true,
      analysis: ["performance", "basic_metrics", "detailed", "visual"],
      optimization_grid: {
        fast_window: [10, 20, 30],
        slow_window: [50, 100, 150],
      },
    }, null, 2),
    result: null,
  };
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function toFiniteNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

function buildQuantaxisBacktestRequest(state: QuantaxisBacktestState): StrategyBacktestRequest {
  return {
    start_date: state.startDate,
    end_date: state.endDate,
    symbol: state.symbol,
    interval: state.interval,
    source: state.source,
    initial_capital: toFiniteNumber(state.initialCapital, "Initial capital"),
    benchmark: state.benchmark,
    commission: toFiniteNumber(state.commission, "Commission"),
    slippage: toFiniteNumber(state.slippage, "Slippage"),
    leverage: toFiniteNumber(state.leverage, "Leverage"),
    risk_free_rate: toFiniteNumber(state.riskFreeRate, "Risk-free rate"),
    analyzer: state.analyzer,
    optimize: state.optimize,
    optimization_target: state.optimizationTarget,
    walk_forward_windows: Math.max(1, Math.round(toFiniteNumber(state.walkForwardWindows, "Walk-forward windows"))),
    parameters: parseJsonObject(state.parametersJson, "QUANTAXIS parameters"),
  };
}

function metricValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) >= 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value);
  }
  if (typeof value === "string") return value;
  return "--";
}

function compactDate(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, 10);
}

function linePoints(rows: Array<Record<string, unknown>>, key: string): string {
  const values = rows
    .map((row) => Number(row[key]))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 100 - ((value - min) / span) * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
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

function statusTone(status: StrategyStatus) {
  if (status === "live") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "testing") return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  if (status === "archived") return "border-zinc-500/30 bg-zinc-500/10 text-muted-foreground";
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

export function StrategyLibrary() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const remoteReadyRef = useRef(false);
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set());
  const [strategies, setStrategies] = useState<StrategyItem[]>(() => loadStrategies());
  const [activeId, setActiveId] = useState(() => strategies[0]?.id ?? "");
  const [persistenceMode, setPersistenceMode] = useState<StrategyPersistenceMode>("checking");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [quantaxisRunningId, setQuantaxisRunningId] = useState<string | null>(null);
  const [paperRunningId, setPaperRunningId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [moreMenu, setMoreMenu] = useState<MoreMenuState | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);
  const [deploymentWizard, setDeploymentWizard] = useState<DeploymentWizardState | null>(null);
  const [deploymentVersions, setDeploymentVersions] = useState<StrategyVersionItem[]>([]);
  const [submittingDeployment, setSubmittingDeployment] = useState(false);
  const [quantaxisBacktest, setQuantaxisBacktest] = useState<QuantaxisBacktestState | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listStrategies()
      .then((payload) => {
        if (cancelled) return;
        remoteReadyRef.current = true;
        setPersistenceMode("remote");
        const remoteStrategies = payload.strategies
          .map((item) => normalizeStrategy(item, newStrategy()))
          .filter((strategy) => strategy.name.trim() && strategy.code.trim());
        setStrategies(remoteStrategies);
        setActiveId(remoteStrategies[0]?.id ?? "");
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
  }, []);

  useEffect(() => {
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
      if (activeId) setActiveId("");
      return;
    }
    if (!strategies.some((strategy) => strategy.id === activeId)) {
      setActiveId(strategies[0].id);
    }
  }, [activeId, strategies]);

  useEffect(() => {
    if (!moreMenu) return;
    const close = () => setMoreMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && moreMenuRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [moreMenu]);

  const copy = language === "zh-CN"
    ? {
      newStrategy: "新建策略",
      debugTool: "调试工具",
      authorization: "授权管理",
      exportCurrent: "导出当前",
      import: "导入",
      name: "策略名称",
      description: "策略说明",
      languageLabel: "语言",
      categoryLabel: "分类",
      statusLabel: "状态",
      tagsLabel: "标签",
      codeLabel: "策略代码",
      details: "策略详情",
      close: "关闭",
      save: "保存",
      saving: "保存中",
      saved: "已保存",
      updatedAt: "最后修改时间",
      createdAt: "创建日期",
      actions: "操作项",
      edit: "编辑",
      duplicate: "复制",
      delete: "删除",
      more: "更多",
      share: "分享",
      publishing: "分享中",
      pendingReview: "审核中",
      rejectedShare: "分享失败",
      published: "已分享",
      submitted: "已提交审核",
      run: "运行",
      paperRun: "模拟盘运行",
      paperRunning: "启动中",
      paperExists: "该策略已在模拟盘运行",
      deployStrategy: "部署策略",
      deployTarget: "部署目标",
      deployVersion: "版本号",
      latestVersion: "最新版本",
      market: "市场",
      symbols: "标的",
      timeframe: "K线周期",
      initialCash: "初始资金",
      parameters: "参数 JSON",
      riskPolicy: "风控 JSON",
      brokerBinding: "Broker 绑定 ID",
      versionHash: "版本 Hash",
      parameterSchema: "参数 Schema",
      createDeployment: "创建部署",
      deploymentCreated: "部署已创建",
      liveRun: "实盘",
      liveTitle: "实盘配置",
      liveDescription: "填写你自己的交易所 API 配置。保存后会使用对应的 live profile；真实下单仍受 mandate 和 kill switch 保护。",
      exchange: "交易所",
      productType: "产品类型",
      spot: "现货",
      usdmFutures: "U本位合约",
      marginMode: "保证金模式",
      apiKey: "API Key",
      apiSecret: "API Secret",
      passphrase: "Passphrase",
      checkConnection: "保存后检查连接",
      liveConsent: "我确认这是我自己的真实 API 配置，并理解实盘会影响真实资金。",
      liveConfigured: "实盘配置已保存",
      liveMissing: "请填写必填配置并确认风险",
      backtest: "回测",
      backtesting: "回测中",
      quantaxisBacktest: "QUANTAXIS 回测",
      quantaxisBacktesting: "QUANTAXIS 回测中",
      backtestConfig: "回测参数配置",
      advancedParams: "高级参数",
      performanceAnalysis: "性能分析",
      basicMetrics: "基本指标",
      detailedAnalysis: "详细分析",
      visualAnalysis: "可视化分析",
      equityCurve: "权益曲线",
      drawdownAnalysis: "回撤分析",
      returnDistribution: "收益分布",
      backtestOptimization: "回测优化",
      walkForwardOptimization: "走势期优化",
      runQuantaxisBacktest: "运行 QAAnalysis",
      viewRun: "查看运行",
      confirm: "确认",
      cancel: "取消",
      search: "搜索策略名称",
      empty: "还没有策略",
      emptyHint: "先新建一个策略，或从策略商城保存策略到这里。",
      savedRemote: "已保存到 MySQL",
      savedLocal: "本地保存",
      checking: "正在检查存储",
    }
    : {
      newStrategy: "New Strategy",
      debugTool: "Debug Tools",
      authorization: "Authorization",
      exportCurrent: "Export Current",
      import: "Import",
      name: "Strategy Name",
      description: "Description",
      languageLabel: "Language",
      categoryLabel: "Category",
      statusLabel: "Status",
      tagsLabel: "Tags",
      codeLabel: "Strategy Code",
      details: "Strategy Details",
      close: "Close",
      save: "Save",
      saving: "Saving",
      saved: "Saved",
      updatedAt: "Last Modified",
      createdAt: "Created",
      actions: "Actions",
      edit: "Edit",
      duplicate: "Copy",
      delete: "Delete",
      more: "More",
      share: "Share",
      publishing: "Sharing",
      pendingReview: "In review",
      rejectedShare: "Share failed",
      published: "Shared",
      submitted: "Submitted for review",
      run: "Run",
      paperRun: "Run Paper",
      paperRunning: "Starting",
      paperExists: "This strategy is already running in paper trading",
      deployStrategy: "Deploy Strategy",
      deployTarget: "Target",
      deployVersion: "Version",
      latestVersion: "Latest version",
      market: "Market",
      symbols: "Symbols",
      timeframe: "Timeframe",
      initialCash: "Initial Cash",
      parameters: "Parameters JSON",
      riskPolicy: "Risk JSON",
      brokerBinding: "Broker Binding ID",
      versionHash: "Version Hash",
      parameterSchema: "Parameter Schema",
      createDeployment: "Create Deployment",
      deploymentCreated: "Deployment created",
      liveRun: "Live",
      liveTitle: "Live Trading Config",
      liveDescription: "Enter your own exchange API credentials. Saving uses the matching live profile; real orders remain guarded by mandate and kill switch.",
      exchange: "Exchange",
      productType: "Product",
      spot: "Spot",
      usdmFutures: "USD-M Futures",
      marginMode: "Margin Mode",
      apiKey: "API Key",
      apiSecret: "API Secret",
      passphrase: "Passphrase",
      checkConnection: "Check connection after save",
      liveConsent: "I confirm these are my own real API credentials and understand live trading affects real funds.",
      liveConfigured: "Live config saved",
      liveMissing: "Fill required fields and confirm the risk",
      backtest: "Backtest",
      backtesting: "Backtesting",
      quantaxisBacktest: "QUANTAXIS Backtest",
      quantaxisBacktesting: "Running QUANTAXIS",
      backtestConfig: "Backtest Parameters",
      advancedParams: "Advanced Parameters",
      performanceAnalysis: "Performance Analysis",
      basicMetrics: "Basic Metrics",
      detailedAnalysis: "Detailed Analysis",
      visualAnalysis: "Visual Analysis",
      equityCurve: "Equity Curve",
      drawdownAnalysis: "Drawdown Analysis",
      returnDistribution: "Return Distribution",
      backtestOptimization: "Backtest Optimization",
      walkForwardOptimization: "Walk-forward Optimization",
      runQuantaxisBacktest: "Run QAAnalysis",
      viewRun: "View Run",
      confirm: "Confirm",
      cancel: "Cancel",
      search: "Search strategy names",
      empty: "No owned strategies yet",
      emptyHint: "Create a strategy or save one from the strategy market.",
      savedRemote: "Saved to MySQL",
      savedLocal: "Saved locally",
      checking: "Checking storage",
    };

  const activeStrategy = strategies.find((strategy) => strategy.id === activeId) ?? strategies[0] ?? null;
  const editorStrategy = editorId ? strategies.find((strategy) => strategy.id === editorId) ?? null : null;
  const filteredStrategies = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = q ? strategies.filter((strategy) => strategy.name.toLowerCase().includes(q)) : strategies;
    return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [query, strategies]);
  const saveLabel = persistenceMode === "remote" ? copy.savedRemote : persistenceMode === "checking" ? copy.checking : copy.savedLocal;
  const shareButtonLabel = (strategy: StrategyItem) => {
    if (publishingId === strategy.id) return copy.publishing;
    if (strategy.shareStatus === "submitted") return copy.pendingReview;
    if (strategy.shareStatus === "rejected") return copy.rejectedShare;
    if (strategy.shareStatus === "published") return copy.published;
    return copy.share;
  };
  const shareButtonDisabled = (strategy: StrategyItem) => (
    publishingId === strategy.id || strategy.shareStatus === "submitted" || strategy.shareStatus === "published"
  );
  const selectedDeploymentVersion = deploymentWizard
    ? deploymentVersions.find((item) => String(item.version) === deploymentWizard.versionNo) ?? deploymentVersions[0] ?? null
    : null;
  const quantaxisResult = quantaxisBacktest?.result ?? null;
  const qaAnalysis = quantaxisResult?.qaAnalysis ?? {};
  const qaVisual = qaAnalysis.visualAnalysis ?? {};
  const equityRows = (qaVisual.equityCurve ?? []) as Array<Record<string, unknown>>;
  const drawdownRows = (qaVisual.drawdown ?? []) as Array<Record<string, unknown>>;
  const distributionRows = qaVisual.returnDistribution ?? [];
  const equityPolyline = linePoints(equityRows, "equity");
  const drawdownPolyline = linePoints(drawdownRows, "drawdown");

  const updateStrategy = (id: string, patch: Partial<StrategyItem>) => {
    const updatedAt = new Date().toISOString();
    setStrategies((current) => current.map((strategy) => (
      strategy.id === id ? { ...strategy, ...patch, updatedAt } : strategy
    )));
  };

  const handleNew = () => {
    navigate("/m/add-strategy");
  };

  const handleDuplicate = (strategy: StrategyItem) => {
    const now = new Date().toISOString();
    const copyItem: StrategyItem = {
      ...strategy,
      id: createId(),
      name: `${strategy.name} Copy`,
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

  const openAssistant = (prompt: string, strategy?: StrategyItem | null) => {
    const promptKey = `strategy_prompt_${createId()}`;
    window.sessionStorage.setItem(promptKey, buildAssistantPrompt(prompt, strategy));
    navigate(`/agent?promptKey=${encodeURIComponent(promptKey)}&auto=1`);
  };

  const handleDebugTool = () => {
    openAssistant(language === "zh-CN" ? "打开策略调试工具，帮我检查当前策略库中的策略代码、运行风险和回测准备度。" : "Open strategy debugging tools and inspect my current strategy library.");
  };

  const handleEdit = (strategy: StrategyItem) => {
    setActiveId(strategy.id);
    navigate(`/m/edit-strategy/${encodeURIComponent(getStrategyRouteId(strategy.id))}`);
  };

  const handleSaveEditor = async () => {
    if (!editorStrategy) return;
    setSavingEditor(true);
    try {
      if (!remoteReadyRef.current) {
        throw new Error(language === "zh-CN" ? "数据库未连接，无法保存策略" : "Database is unavailable; strategy was not saved");
      }
      await api.upsertStrategy(toApiStrategy(editorStrategy));
      toast.success(copy.saved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "保存策略失败" : "Failed to save strategy");
    } finally {
      setSavingEditor(false);
    }
  };

  const handleRun = async (strategy: StrategyItem) => {
    setMoreMenu(null);
    setRunningId(strategy.id);
    try {
      await api.upsertStrategy(toApiStrategy(strategy));
      const result = await api.runStrategyBacktest(strategy.id, {
        symbol: "BTC-USDT",
        interval: "4H",
        source: "okx",
      });
      toast.success(language === "zh-CN" ? "真实回测完成" : "Real backtest completed");
      navigate(`/runs/${encodeURIComponent(result.run_id)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "运行策略失败" : "Failed to run strategy");
    } finally {
      setRunningId(null);
    }
  };

  const handleQuantaxisBacktest = async (strategy: StrategyItem) => {
    setMoreMenu(null);
    setQuantaxisBacktest(quantaxisBacktestForStrategy(strategy));
  };

  const submitQuantaxisBacktest = async () => {
    if (!quantaxisBacktest) return;
    setQuantaxisRunningId(quantaxisBacktest.strategy.id);
    try {
      if (remoteReadyRef.current) {
        await api.upsertStrategy(toApiStrategy(quantaxisBacktest.strategy));
      }
      const result = await api.runStrategyBacktest(
        quantaxisBacktest.strategy.id,
        buildQuantaxisBacktestRequest(quantaxisBacktest),
      );
      setQuantaxisBacktest({ ...quantaxisBacktest, result });
      toast.success(language === "zh-CN" ? "QUANTAXIS QAAnalysis 回测完成" : "QUANTAXIS QAAnalysis completed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "QUANTAXIS 回测失败" : "QUANTAXIS backtest failed");
    } finally {
      setQuantaxisRunningId(null);
    }
  };

  const openDeploymentWizard = async (strategy: StrategyItem, target: "SHADOW" | "LIVE") => {
    setMoreMenu(null);
    setPaperRunningId(strategy.id);
    try {
      if (remoteReadyRef.current) {
        await api.upsertStrategy(toApiStrategy(strategy));
      }
      setDeploymentVersions([]);
      setDeploymentWizard(deploymentWizardForStrategy(strategy, target));
      setDeploymentVersions(await api.listStrategyVersions(strategy.id).catch(() => []));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "打开部署向导失败" : "Failed to open deployment wizard");
    } finally {
      setPaperRunningId(null);
    }
  };

  const submitDeploymentWizard = async () => {
    if (!deploymentWizard) return;
    setSubmittingDeployment(true);
    setPaperRunningId(deploymentWizard.strategy.id);
    try {
      const symbols = deploymentWizard.symbols
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const riskPolicy = parseJsonObject(deploymentWizard.riskPolicyJson, "Risk policy");
      if (deploymentWizard.target === "SHADOW") {
        riskPolicy.initial_cash = toFiniteNumber(deploymentWizard.initialCash, "Initial cash");
      }
      const result = await api.createDeployment({
        strategy_id: deploymentWizard.strategy.id,
        target: deploymentWizard.target,
        version_no: deploymentWizard.versionNo ? Number(deploymentWizard.versionNo) : undefined,
        market: deploymentWizard.market,
        symbols,
        timeframe: deploymentWizard.timeframe,
        parameters: parseJsonObject(deploymentWizard.parametersJson, "Parameters"),
        risk_policy: riskPolicy,
        broker_binding_id: deploymentWizard.target === "LIVE" ? Number(deploymentWizard.brokerBindingId) : undefined,
      });
      let readyFailed = false;
      try {
        await api.readyDeployment(result.deployment.deployment_id);
      } catch {
        readyFailed = true;
      }
      toast.success(copy.deploymentCreated);
      if (readyFailed) {
        toast.message(language === "zh-CN"
          ? "部署已创建，但未能自动设为就绪。请在部署详情中检查状态并重试。"
          : "Deployment was created but could not be marked ready. Check its status and retry from the detail page.");
      }
      setDeploymentWizard(null);
      navigate(`/deployments/${encodeURIComponent(result.deployment.deployment_id)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "创建部署失败" : "Failed to create deployment");
    } finally {
      setPaperRunningId(null);
      setSubmittingDeployment(false);
    }
  };

  const handleOpenLive = async (strategy: StrategyItem) => {
    setMoreMenu(null);
    try {
      if (remoteReadyRef.current) {
        await api.upsertStrategy(toApiStrategy(strategy));
      }
      const result = await api.listExchangeApiKeys();
      if (result.bindings.length === 0) {
        toast.message(language === "zh-CN" ? "请先绑定 OKX 或 Binance API key" : "Bind an OKX or Binance API key first");
        navigate("/personal-settings#exchange-api-bindings");
        return;
      }
      await openDeploymentWizard(strategy, "LIVE");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "打开实盘交易失败" : "Failed to open live trading");
    }
  };

  const handleShare = async (strategy: StrategyItem) => {
    setMoreMenu(null);
    setPublishingId(strategy.id);
    try {
      if (remoteReadyRef.current) {
        await api.upsertStrategy(toApiStrategy(strategy));
      }
      await api.publishStrategy(strategy.id);
      updateStrategy(strategy.id, { shareStatus: "submitted" });
      toast.success(copy.submitted);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "发布策略失败" : "Failed to publish strategy");
    } finally {
      setPublishingId(null);
    }
  };

  const openMoreMenu = (strategy: StrategyItem, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const width = 176;
    const height = 176;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : below;
    setMoreMenu({ strategy, top, left });
  };

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
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FileCode2 className="h-4 w-4 text-primary" />
                {t("strategy.kicker")}
              </div>
              <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
                {t("strategy.title")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{saveLabel} · {strategies.length} {language === "zh-CN" ? "个策略" : "strategies"}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleNew}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                {copy.newStrategy}
              </button>
              <button
                type="button"
                onClick={handleDebugTool}
                className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted"
              >
                <WandSparkles className="h-4 w-4 text-primary" />
                {copy.debugTool}
              </button>
              <button
                type="button"
                onClick={() => activeStrategy && handleRun(activeStrategy)}
                disabled={!activeStrategy || runningId === activeStrategy.id || quantaxisRunningId === activeStrategy.id}
                className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
              >
                <Play className="h-4 w-4 text-primary" />
                {activeStrategy && runningId === activeStrategy.id ? copy.backtesting : copy.backtest}
              </button>
              <button
                type="button"
                onClick={() => activeStrategy && void handleQuantaxisBacktest(activeStrategy)}
                disabled={!activeStrategy || quantaxisRunningId === activeStrategy.id || runningId === activeStrategy.id}
                className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
              >
                <Database className="h-4 w-4 text-primary" />
                {activeStrategy && quantaxisRunningId === activeStrategy.id ? copy.quantaxisBacktesting : copy.quantaxisBacktest}
              </button>
              <button
                type="button"
                onClick={() => window.location.assign(adminUrl("settings"))}
                className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted"
              >
                <ShieldCheck className="h-4 w-4 text-primary" />
                {copy.authorization}
              </button>
              <button
                type="button"
                onClick={() => activeStrategy && handleExport([activeStrategy], `${activeStrategy.name || "strategy"}.json`)}
                disabled={!activeStrategy}
                className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {copy.exportCurrent}
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background transition hover:bg-muted"
                title={copy.import}
              >
                <Upload className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.search}
              className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-primary/25"
            />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">{copy.name}</th>
                  <th className="w-44 px-4 py-3">{copy.updatedAt}</th>
                  <th className="w-36 px-4 py-3">{copy.createdAt}</th>
                  <th className="w-[30rem] px-4 py-3 text-right">{copy.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredStrategies.map((strategy) => (
                  <tr
                    key={strategy.id}
                    onClick={() => setActiveId(strategy.id)}
                    className={cn("transition hover:bg-muted/40", activeId === strategy.id && "bg-primary/5")}
                  >
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full border", statusTone(strategy.status))} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground">{strategy.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="rounded border bg-background px-1.5 py-0.5 font-mono">{strategy.language}</span>
                            {strategy.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="rounded border bg-background px-1.5 py-0.5">{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{formatDate(strategy.updatedAt)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{formatDate(strategy.createdAt, false)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleEdit(strategy)}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {copy.edit}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(strategy)}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copy.duplicate}
                        </button>
                        <button
                          type="button"
                          onClick={() => void openDeploymentWizard(strategy, "SHADOW")}
                          disabled={paperRunningId === strategy.id}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted disabled:opacity-50"
                        >
                          <WalletCards className="h-3.5 w-3.5" />
                          {paperRunningId === strategy.id ? copy.paperRunning : copy.paperRun}
                        </button>
                        {deleteTarget === strategy.id ? (
                          <div className="inline-flex items-center overflow-hidden rounded-md border border-destructive/30 bg-destructive/5">
                            <button
                              type="button"
                              onClick={() => handleDelete(strategy.id)}
                              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-destructive"
                            >
                              <Check className="h-3.5 w-3.5" />
                              {copy.confirm}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(null)}
                              className="border-l px-2 py-1.5 text-xs font-semibold text-muted-foreground"
                              title={copy.cancel}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(strategy.id)}
                            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-destructive/40 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {copy.delete}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(event) => openMoreMenu(strategy, event.currentTarget)}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted"
                        >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                            {copy.more}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredStrategies.length === 0 && (
            <div className="flex min-h-[18rem] flex-col items-center justify-center border-t px-6 py-12 text-center">
              <FileCode2 className="h-10 w-10 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-semibold">{copy.empty}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{copy.emptyHint}</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={handleNew}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                  {copy.newStrategy}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/market")}
                  className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <Bot className="h-4 w-4" />
                  {language === "zh-CN" ? "打开策略商城" : "Open market"}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {editorStrategy && createPortal(
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-card shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">{copy.details}</h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {editorStrategy.id} · {formatDate(editorStrategy.updatedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveEditor}
                  disabled={savingEditor}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  {savingEditor ? copy.saving : copy.save}
                </button>
                <button
                  type="button"
                  onClick={() => setEditorId(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background transition hover:bg-muted"
                  title={copy.close}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[22rem_minmax(0,1fr)]">
              <div className="space-y-3 overflow-auto border-b p-4 lg:border-b-0 lg:border-r">
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.name}</span>
                  <input
                    value={editorStrategy.name}
                    onChange={(event) => updateStrategy(editorStrategy.id, { name: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.description}</span>
                  <textarea
                    value={editorStrategy.description}
                    onChange={(event) => updateStrategy(editorStrategy.id, { description: event.target.value })}
                    className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.languageLabel}</span>
                    <select
                      value={editorStrategy.language}
                      onChange={(event) => updateStrategy(editorStrategy.id, { language: event.target.value as StrategyLanguage })}
                      className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {languageOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.categoryLabel}</span>
                    <select
                      value={editorStrategy.category}
                      onChange={(event) => updateStrategy(editorStrategy.id, { category: event.target.value as StrategyCategory })}
                      className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {categoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.value}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.statusLabel}</span>
                    <select
                      value={editorStrategy.status}
                      onChange={(event) => updateStrategy(editorStrategy.id, { status: event.target.value as StrategyStatus })}
                      className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.value}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.tagsLabel}</span>
                  <input
                    value={editorStrategy.tags.join(", ")}
                    onChange={(event) => updateStrategy(editorStrategy.id, {
                      tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
                    })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <div className="font-semibold uppercase">{copy.createdAt}</div>
                    <div className="mt-1 font-mono">{formatDate(editorStrategy.createdAt)}</div>
                  </div>
                  <div>
                    <div className="font-semibold uppercase">{copy.updatedAt}</div>
                    <div className="mt-1 font-mono">{formatDate(editorStrategy.updatedAt)}</div>
                  </div>
                </div>
              </div>

              <div className="flex min-h-[28rem] min-w-0 flex-col">
                <div className="border-b px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
                  {copy.codeLabel}
                </div>
                <StrategyCodeEditor
                  value={editorStrategy.code}
                  language={editorStrategy.language}
                  onChange={(code) => updateStrategy(editorStrategy.id, { code })}
                />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {moreMenu && createPortal(
        <div
          ref={moreMenuRef}
          className="fixed z-50 w-44 overflow-hidden rounded-md border bg-card p-1 text-foreground shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
          style={{ top: moreMenu.top, left: moreMenu.left }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => handleShare(moreMenu.strategy)}
            disabled={shareButtonDisabled(moreMenu.strategy)}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted"
          >
            <Share2 className="h-3.5 w-3.5" />
            {shareButtonLabel(moreMenu.strategy)}
          </button>
          <button
            type="button"
            onClick={() => handleOpenLive(moreMenu.strategy)}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted"
          >
            <RadioTower className="h-3.5 w-3.5" />
            {copy.liveRun}
          </button>
          <button
            type="button"
            onClick={() => handleRun(moreMenu.strategy)}
            disabled={runningId === moreMenu.strategy.id}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {runningId === moreMenu.strategy.id
              ? copy.backtesting
              : copy.run}
          </button>
        </div>,
        document.body,
      )}

      {quantaxisBacktest && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-auto rounded-lg border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Database className="h-5 w-5 text-primary" />
                  {copy.quantaxisBacktest}
                </h2>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {quantaxisBacktest.strategy.name} · {qaAnalysis.module ?? "QAAnalysis"}
                </p>
              </div>
              <button type="button" onClick={() => setQuantaxisBacktest(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-5 px-5 py-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
              <div className="space-y-4">
                <section className="rounded-md border bg-background p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <SlidersHorizontal className="h-4 w-4 text-primary" />
                    {copy.backtestConfig}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Symbol
                      <input value={quantaxisBacktest.symbol} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, symbol: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-muted-foreground">
                        Start
                        <input type="date" value={quantaxisBacktest.startDate} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, startDate: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        End
                        <input type="date" value={quantaxisBacktest.endDate} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, endDate: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-muted-foreground">
                        Interval
                        <select value={quantaxisBacktest.interval} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, interval: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground">
                          {["1H", "4H", "1D", "1W"].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        Source
                        <select value={quantaxisBacktest.source} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, source: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground">
                          {["okx", "ccxt", "yfinance", "akshare", "mootdx", "futu"].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="text-xs font-semibold text-muted-foreground">
                      Initial Capital
                      <input value={quantaxisBacktest.initialCapital} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, initialCapital: event.target.value })} inputMode="decimal" className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                    </label>
                  </div>
                </section>

                <section className="rounded-md border bg-background p-4">
                  <h3 className="mb-3 text-sm font-semibold">{copy.advancedParams}</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-muted-foreground">
                        Commission
                        <input value={quantaxisBacktest.commission} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, commission: event.target.value })} inputMode="decimal" className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        Slippage
                        <input value={quantaxisBacktest.slippage} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, slippage: event.target.value })} inputMode="decimal" className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-muted-foreground">
                        Leverage
                        <input value={quantaxisBacktest.leverage} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, leverage: event.target.value })} inputMode="decimal" className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        Risk-free
                        <input value={quantaxisBacktest.riskFreeRate} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, riskFreeRate: event.target.value })} inputMode="decimal" className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                      </label>
                    </div>
                    <label className="text-xs font-semibold text-muted-foreground">
                      Benchmark
                      <input value={quantaxisBacktest.benchmark} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, benchmark: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                    </label>
                    <label className="text-xs font-semibold text-muted-foreground">
                      Analyzer
                      <select value={quantaxisBacktest.analyzer} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, analyzer: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground">
                        <option value="QAAnalysis">QAAnalysis</option>
                        <option value="QAAnalysis_trade">QAAnalysis_trade</option>
                        <option value="QAAnalysis_stock">QAAnalysis_stock</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <input type="checkbox" checked={quantaxisBacktest.optimize} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, optimize: event.target.checked })} className="h-4 w-4 rounded border" />
                      {copy.backtestOptimization}
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-muted-foreground">
                        Target
                        <select value={quantaxisBacktest.optimizationTarget} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, optimizationTarget: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground">
                          {["sharpe", "total_return", "max_drawdown", "calmar"].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        Windows
                        <input value={quantaxisBacktest.walkForwardWindows} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, walkForwardWindows: event.target.value })} inputMode="numeric" className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground" />
                      </label>
                    </div>
                    <label className="text-xs font-semibold text-muted-foreground">
                      Parameters JSON
                      <textarea value={quantaxisBacktest.parametersJson} onChange={(event) => setQuantaxisBacktest({ ...quantaxisBacktest, parametersJson: event.target.value })} rows={8} className="mt-1 w-full rounded-md border bg-card px-3 py-2 font-mono text-xs text-foreground" />
                    </label>
                  </div>
                </section>
              </div>

              <div className="space-y-4">
                <section className="rounded-md border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      {copy.basicMetrics}
                    </h3>
                    <div className="flex gap-2">
                      {quantaxisResult ? (
                        <button type="button" onClick={() => navigate(`/runs/${encodeURIComponent(quantaxisResult.run_id)}`)} className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">
                          {copy.viewRun}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void submitQuantaxisBacktest()} disabled={quantaxisRunningId === quantaxisBacktest.strategy.id} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                        {quantaxisRunningId === quantaxisBacktest.strategy.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LineChart className="h-4 w-4" />}
                        {quantaxisRunningId === quantaxisBacktest.strategy.id ? copy.quantaxisBacktesting : copy.runQuantaxisBacktest}
                      </button>
                    </div>
                  </div>
                  {quantaxisResult ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {Object.entries(qaAnalysis.basicMetrics ?? {}).map(([key, value]) => (
                        <div key={key} className="rounded-md border bg-card p-3">
                          <div className="text-xs font-semibold uppercase text-muted-foreground">{key}</div>
                          <div className="mt-1 text-xl font-semibold">{metricValue(value)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed bg-card p-6 text-sm text-muted-foreground">
                      {language === "zh-CN" ? "配置参数后运行 QAAnalysis，可在这里查看基本指标、权益曲线、回撤和收益分布。" : "Run QAAnalysis after configuring parameters to inspect metrics, equity, drawdown, and return distribution here."}
                    </div>
                  )}
                </section>

                {quantaxisResult ? (
                  <>
                    <section className="rounded-md border bg-background p-4">
                      <h3 className="mb-3 text-sm font-semibold">{copy.performanceAnalysis}</h3>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {Object.entries(qaAnalysis.performanceAnalysis ?? {}).map(([key, value]) => (
                          <div key={key} className="rounded-md border bg-card p-3">
                            <div className="text-xs font-semibold uppercase text-muted-foreground">{key}</div>
                            <div className="mt-1 text-lg font-semibold">{metricValue(value)}</div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-md border bg-background p-4">
                      <h3 className="mb-3 text-sm font-semibold">{copy.visualAnalysis}</h3>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-md border bg-card p-3">
                          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{copy.equityCurve}</div>
                          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-44 w-full overflow-visible rounded border bg-background">
                            <polyline points={equityPolyline} fill="none" stroke="currentColor" strokeWidth="1.8" className="text-primary" vectorEffect="non-scaling-stroke" />
                          </svg>
                          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                            <span>{compactDate(equityRows[0]?.time)}</span>
                            <span>{compactDate(equityRows[equityRows.length - 1]?.time)}</span>
                          </div>
                        </div>
                        <div className="rounded-md border bg-card p-3">
                          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{copy.drawdownAnalysis}</div>
                          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-44 w-full overflow-visible rounded border bg-background">
                            <polyline points={drawdownPolyline} fill="none" stroke="currentColor" strokeWidth="1.8" className="text-destructive" vectorEffect="non-scaling-stroke" />
                          </svg>
                          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                            <span>{compactDate(drawdownRows[0]?.time)}</span>
                            <span>{compactDate(drawdownRows[drawdownRows.length - 1]?.time)}</span>
                          </div>
                        </div>
                        <div className="rounded-md border bg-card p-3 xl:col-span-2">
                          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{copy.returnDistribution}</div>
                          <div className="grid h-44 items-end gap-2 sm:grid-cols-6">
                            {distributionRows.map((row) => {
                              const maxCount = Math.max(1, ...distributionRows.map((item) => item.count));
                              return (
                                <div key={row.bucket} className="flex h-full flex-col justify-end gap-2">
                                  <div className="rounded-t bg-primary/70" style={{ height: `${Math.max(4, (row.count / maxCount) * 100)}%` }} />
                                  <div className="text-center text-[11px] text-muted-foreground">{row.bucket}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-2">
                      <div className="rounded-md border bg-background p-4">
                        <h3 className="mb-3 text-sm font-semibold">{copy.walkForwardOptimization}</h3>
                        <div className="space-y-2">
                          {(qaAnalysis.optimization?.walkForwardWindows ?? []).map((row) => (
                            <div key={row.window} className="grid grid-cols-[3rem_1fr_5rem] items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm">
                              <span className="font-mono text-xs text-muted-foreground">W{row.window}</span>
                              <span className="truncate text-xs text-muted-foreground">{compactDate(row.start)} - {compactDate(row.end)}</span>
                              <span className={cn("text-right font-semibold", row.returnPct >= 0 ? "text-emerald-600" : "text-destructive")}>{row.returnPct}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-md border bg-background p-4">
                        <h3 className="mb-3 text-sm font-semibold">{copy.detailedAnalysis}</h3>
                        <div className="space-y-3 text-sm">
                          <div>
                            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Assumptions</div>
                            <ul className="space-y-1 text-muted-foreground">
                              {(qaAnalysis.detailedAnalysis?.assumptions ?? []).map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Warnings</div>
                            <ul className="space-y-1 text-muted-foreground">
                              {(qaAnalysis.detailedAnalysis?.warnings ?? []).map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          </div>
                          <pre className="max-h-40 overflow-auto rounded-md border bg-card p-3 font-mono text-xs text-muted-foreground">
                            {JSON.stringify(qaAnalysis.optimization?.parameterGrid ?? {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </section>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {deploymentWizard && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{copy.deployStrategy}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{deploymentWizard.strategy.name}</p>
              </div>
              <button type="button" onClick={() => setDeploymentWizard(null)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-muted-foreground">
                {copy.deployTarget}
                <select
                  value={deploymentWizard.target}
                  onChange={(event) => setDeploymentWizard({ ...deploymentWizard, target: event.target.value as "SHADOW" | "LIVE" })}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                >
                  <option value="SHADOW">SHADOW</option>
                  <option value="LIVE">LIVE</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-muted-foreground">
                {copy.deployVersion}
                <select
                  value={deploymentWizard.versionNo}
                  onChange={(event) => setDeploymentWizard({ ...deploymentWizard, versionNo: event.target.value })}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                >
                  <option value="">{copy.latestVersion}</option>
                  {deploymentVersions.map((version) => (
                    <option key={version.version} value={version.version}>
                      v{version.version} · {version.code_sha256.slice(0, 12)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-md border bg-background p-3 text-xs sm:col-span-2">
                <div className="font-semibold text-muted-foreground">{copy.versionHash}</div>
                <div className="mt-1 break-all font-mono text-foreground">{selectedDeploymentVersion?.code_sha256 || "--"}</div>
              </div>
              <label className="text-xs font-semibold text-muted-foreground">
                {copy.market}
                <input
                  value={deploymentWizard.market}
                  onChange={(event) => setDeploymentWizard({ ...deploymentWizard, market: event.target.value })}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">
                {copy.timeframe}
                <input
                  value={deploymentWizard.timeframe}
                  onChange={(event) => setDeploymentWizard({ ...deploymentWizard, timeframe: event.target.value })}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                />
              </label>
              {deploymentWizard.target === "SHADOW" ? (
                <label className="text-xs font-semibold text-muted-foreground">
                  {copy.initialCash}
                  <input
                    value={deploymentWizard.initialCash}
                    onChange={(event) => setDeploymentWizard({ ...deploymentWizard, initialCash: event.target.value })}
                    inputMode="decimal"
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                  />
                </label>
              ) : null}
              <label className="text-xs font-semibold text-muted-foreground sm:col-span-2">
                {copy.symbols}
                <input
                  value={deploymentWizard.symbols}
                  onChange={(event) => setDeploymentWizard({ ...deploymentWizard, symbols: event.target.value })}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                />
              </label>
              {deploymentWizard.target === "LIVE" ? (
                <label className="text-xs font-semibold text-muted-foreground sm:col-span-2">
                  {copy.brokerBinding}
                  <input
                    value={deploymentWizard.brokerBindingId}
                    onChange={(event) => setDeploymentWizard({ ...deploymentWizard, brokerBindingId: event.target.value })}
                    inputMode="numeric"
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                  />
                </label>
              ) : null}
              <label className="text-xs font-semibold text-muted-foreground">
                {copy.parameters}
                <textarea
                  value={deploymentWizard.parametersJson}
                  onChange={(event) => setDeploymentWizard({ ...deploymentWizard, parametersJson: event.target.value })}
                  rows={8}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground"
                />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">
                {copy.riskPolicy}
                <textarea
                  value={deploymentWizard.riskPolicyJson}
                  onChange={(event) => setDeploymentWizard({ ...deploymentWizard, riskPolicyJson: event.target.value })}
                  rows={8}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground"
                />
              </label>
              <div className="rounded-md border bg-background p-3 text-xs sm:col-span-2">
                <div className="font-semibold text-muted-foreground">{copy.parameterSchema}</div>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-foreground">
                  {JSON.stringify(selectedDeploymentVersion?.parameter_schema ?? {}, null, 2)}
                </pre>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <button type="button" onClick={() => setDeploymentWizard(null)} className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">
                {copy.cancel}
              </button>
              <button
                type="button"
                onClick={() => void submitDeploymentWizard()}
                disabled={submittingDeployment}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {submittingDeployment ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
                {copy.createDeployment}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
