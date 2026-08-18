import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, FileCode2, Play } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type RunData,
  type StrategyLibraryItem,
  type StrategyMarketAdminItem,
  type StrategyMarketBacktestResponse,
} from "@/lib/api";
import { StrategyCodeEditor } from "@/components/strategy/StrategyCodeEditor";
import { StrategyReturnChart } from "@/components/charts/StrategyReturnChart";
import { useTranslation } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { normalizeOwnedStrategy } from "@/lib/strategyStorage";
import {
  getStrategyRouteId,
  resolveStrategyRouteId,
} from "@/lib/strategyMarketplace";

type StrategyLanguage = "javascript" | "python" | "cpp" | "rust" | "pine";
type StrategyStatus = "draft" | "testing" | "live" | "archived";
type StrategyCategory = "trend" | "mean_reversion" | "grid" | "risk" | "portfolio" | "arbitrage" | "utility";
type StrategyTab = "edit" | "backtest";
type EditorPane = "code" | "description";
type BacktestExchange = "okx_spot" | "okx_futures" | "binance_spot" | "binance_futures";
type BacktestInterval = "1D" | "1H" | "1m";
type BacktestMode = "simulation" | "live_grade";
type TradeDirection = "long" | "short" | "auto";

interface BacktestParameterState {
  direction: TradeDirection;
  leverage: string;
  orderValue: string;
  enableTrend: boolean;
  enableCallback: boolean;
  drawdownTakeProfitTriggerPct: string;
  profitDrawdownTakeProfitPct: string;
  addSpacing12Pct: string;
  addSpacing34Pct: string;
  addSpacing56Pct: string;
  addSpacing6PlusPct: string;
  callbackAddPct: string;
  breakevenCloseLine: string;
  longAddMultiplierPrimary: string;
  longAddMultiplierSecondary: string;
  shortAddMultiplier: string;
  autoRescue: boolean;
  longWearPosition: string;
  shortWearPosition: string;
  enableStopLoss: boolean;
  longFloatingLossStop: string;
  shortFloatingLossStop: string;
  transferClearThreshold: string;
  transferClearValue: string;
  pollingSeconds: string;
}

interface BacktestFormState {
  startDate: string;
  endDate: string;
  interval: BacktestInterval;
  mode: BacktestMode;
  exchange: BacktestExchange;
  symbol: string;
  quoteCurrency: "USDT";
  initialCapital: string;
  tradingCurrency: "USDT";
  parameters: BacktestParameterState;
}

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

const exchangeOptions: Array<{ value: BacktestExchange; source: string; labelZh: string; labelEn: string }> = [
  { value: "okx_spot", source: "okx", labelZh: "OKX 现货", labelEn: "OKX Spot" },
  { value: "okx_futures", source: "okx", labelZh: "OKX 期货", labelEn: "OKX Futures" },
  { value: "binance_spot", source: "binance", labelZh: "币安现货", labelEn: "Binance Spot" },
  { value: "binance_futures", source: "binance", labelZh: "币安期货", labelEn: "Binance Futures" },
];

const intervalOptions: Array<{ value: BacktestInterval; labelZh: string; labelEn: string }> = [
  { value: "1D", labelZh: "天", labelEn: "Day" },
  { value: "1H", labelZh: "小时", labelEn: "Hour" },
  { value: "1m", labelZh: "分钟", labelEn: "Minute" },
];

const modeOptions: Array<{ value: BacktestMode; labelZh: string; labelEn: string }> = [
  { value: "simulation", labelZh: "模拟级", labelEn: "Simulation" },
  { value: "live_grade", labelZh: "实盘级", labelEn: "Live Grade" },
];

const directionOptions: Array<{ value: TradeDirection; labelZh: string; labelEn: string }> = [
  { value: "long", labelZh: "做多", labelEn: "Long" },
  { value: "short", labelZh: "做空", labelEn: "Short" },
  { value: "auto", labelZh: "自动", labelEn: "Auto" },
];

const leverageOptions = ["1", "2", "3", "5", "10", "20", "30", "50", "75", "100", "125"];

const exchangeSymbols: Record<BacktestExchange, string[]> = {
  okx_spot: [
    "BTC-USDT",
    "ETH-USDT",
    "SOL-USDT",
    "BNB-USDT",
    "XRP-USDT",
    "DOGE-USDT",
    "ADA-USDT",
    "AVAX-USDT",
    "LINK-USDT",
    "TON-USDT",
    "TRX-USDT",
    "DOT-USDT",
    "SHIB-USDT",
  ],
  okx_futures: [
    "BTC-USDT-SWAP",
    "ETH-USDT-SWAP",
    "SOL-USDT-SWAP",
    "XRP-USDT-SWAP",
    "DOGE-USDT-SWAP",
    "ADA-USDT-SWAP",
    "AVAX-USDT-SWAP",
    "LINK-USDT-SWAP",
    "TON-USDT-SWAP",
    "TRX-USDT-SWAP",
    "DOT-USDT-SWAP",
  ],
  binance_spot: [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "ADAUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "TONUSDT",
    "TRXUSDT",
    "DOTUSDT",
    "SHIBUSDT",
  ],
  binance_futures: [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "ADAUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "TONUSDT",
    "TRXUSDT",
    "DOTUSDT",
  ],
};

const starterCode = `# Strategy idea
# Replace this draft with your entry, exit, sizing, and risk rules.

def generate_signals(data):
    close = data["close"]
    fast = close.rolling(20).mean()
    slow = close.rolling(60).mean()
    signal = (fast > slow).astype(int)
    return signal.diff().fillna(0)
`;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `strategy_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createDraftStrategy(): StrategyLibraryItem {
  const now = new Date().toISOString();
  return {
    id: createId(),
    name: "Untitled Strategy",
    description: "Describe the signal, universe, timeframe, and risk rule.",
    strategyDescription: "## 策略介绍\n\n补充策略逻辑、适用品种、参数说明和风控要点。支持 Markdown 文本与图片，例如：\n\n![策略图](https://example.com/chart.png)",
    language: "python",
    category: "trend",
    status: "draft",
    tags: ["draft"],
    code: starterCode,
    createdAt: now,
    updatedAt: now,
  };
}

function isRemotePersistenceUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
}

function isStrategyLanguage(value: string): value is StrategyLanguage {
  return languageOptions.some((option) => option.value === value);
}

function isStrategyStatus(value: string): value is StrategyStatus {
  return statusOptions.some((option) => option.value === value);
}

function isStrategyCategory(value: string): value is StrategyCategory {
  return categoryOptions.some((option) => option.value === value);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayInputValue() {
  return dateInputValue(new Date());
}

function oneYearAgoInputValue() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return dateInputValue(date);
}

function createBacktestFormState(): BacktestFormState {
  return {
    startDate: oneYearAgoInputValue(),
    endDate: todayInputValue(),
    interval: "1D",
    mode: "simulation",
    exchange: "okx_spot",
    symbol: "BTC-USDT",
    quoteCurrency: "USDT",
    initialCapital: "50000",
    tradingCurrency: "USDT",
    parameters: {
      direction: "long",
      leverage: "20",
      orderValue: "100",
      enableTrend: false,
      enableCallback: false,
      drawdownTakeProfitTriggerPct: "1",
      profitDrawdownTakeProfitPct: "8",
      addSpacing12Pct: "0.6",
      addSpacing34Pct: "1",
      addSpacing56Pct: "1.5",
      addSpacing6PlusPct: "2",
      callbackAddPct: "",
      breakevenCloseLine: "0.5",
      longAddMultiplierPrimary: "1",
      longAddMultiplierSecondary: "1",
      shortAddMultiplier: "1",
      autoRescue: false,
      longWearPosition: "10",
      shortWearPosition: "10",
      enableStopLoss: false,
      longFloatingLossStop: "0",
      shortFloatingLossStop: "0",
      transferClearThreshold: "600",
      transferClearValue: "100",
      pollingSeconds: "10",
    },
  };
}

function tabFromSearch(value: string | null): StrategyTab {
  return value === "backtest" ? "backtest" : "edit";
}

function formatDetailValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value ?? "");
}

function nonEmptyEntries(data?: Record<string, unknown>) {
  return Object.entries(data ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
}

function findStrategyByRouteId(strategies: StrategyLibraryItem[], routeId: string, resolvedId: string) {
  return strategies.find((item) => item.id === resolvedId || getStrategyRouteId(item.id) === routeId) ?? null;
}

function catalogItemToStrategy(item: StrategyMarketAdminItem): StrategyLibraryItem {
  const now = new Date().toISOString();
  return {
    id: item.id,
    name: item.name || item.id,
    description: item.description || item.summary || item.note || "",
    strategyDescription: item.strategy_description || item.description || "",
    language: item.language || "python",
    category: item.category || "utility",
    status: "draft",
    tags: item.tags ?? [],
    code: item.code_snapshot || "",
    createdAt: item.published_at || item.updated_at || now,
    updatedAt: item.updated_at || now,
  };
}

export function StrategyEdit() {
  const { language } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeStrategyId = params.strategyId ? decodeURIComponent(params.strategyId) : "";
  const strategyId = routeStrategyId;
  const resolvedStrategyId = routeStrategyId ? resolveStrategyRouteId(routeStrategyId) : "";
  const isNewStrategy = !strategyId;
  const activeTab = tabFromSearch(searchParams.get("tab"));
  const [strategy, setStrategy] = useState<StrategyLibraryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [remoteReady, setRemoteReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [backtestResult, setBacktestResult] = useState<StrategyMarketBacktestResponse | null>(null);
  const [backtestRun, setBacktestRun] = useState<RunData | null>(null);
  const [backtestRunLoading, setBacktestRunLoading] = useState(false);
  const [editorPane, setEditorPane] = useState<EditorPane>("code");
  const [backtestInitialCapital, setBacktestInitialCapital] = useState(() => Number(createBacktestFormState().initialCapital));
  const [backtestForm, setBacktestForm] = useState<BacktestFormState>(() => createBacktestFormState());

  const copy = useMemo(() => language === "zh-CN"
    ? {
      back: "返回策略库",
      kicker: "策略工作台",
      missing: "没有找到这个策略",
      missingHint: "它可能已被删除，或只存在于其他账号的策略库。",
      editTab: "策略编辑",
      backtestTab: "模拟回测",
      name: "策略名称",
      description: "策略说明",
      languageLabel: "语言",
      categoryLabel: "分类",
      statusLabel: "状态",
      tagsLabel: "标签",
      codeLabel: "策略代码",
      strategyDescriptionTab: "策略描述",
      strategyDescriptionPlaceholder: "写下会展示在策略分享页的详细介绍。支持 Markdown 文本和图片，例如 ![说明](https://example.com/image.png)。",
      createdAt: "创建时间",
      updatedAt: "最后修改",
      save: "保存",
      saving: "保存中",
      saved: "已保存",
      run: "开始回测",
      running: "回测中",
      result: "回测结果",
      detail: "详细结果",
      openRun: "打开运行详情",
      runId: "运行 ID",
      runStatus: "运行状态",
      elapsed: "耗时",
      assumptions: "假设",
      warnings: "警告",
      metrics: "指标",
      backtestSummary: "回测摘要",
      equityCurve: "收益曲线",
      tradeDetails: "交易明细",
      noDetail: "详细结果暂不可用，请打开运行详情查看。",
      loadingDetail: "正在加载详细结果...",
      noTrades: "没有交易记录。",
      totalReturn: "总收益",
      annualized: "年化收益",
      drawdown: "最大回撤",
      sharpe: "Sharpe",
      winRate: "胜率",
      trades: "交易次数",
      engine: "引擎",
      startTime: "开始时间",
      endTime: "结束时间",
      klinePeriod: "K线周期",
      mode: "模式",
      platform: "平台(交易所)",
      symbol: "交易对",
      quoteCurrency: "计价货币",
      initialCapital: "默认资金",
      tradingCurrency: "交易货币",
      parameters: "参数",
    }
    : {
      back: "Back to strategies",
      kicker: "Strategy Workspace",
      missing: "Strategy not found",
      missingHint: "It may have been deleted or belongs to another account.",
      editTab: "Strategy Editor",
      backtestTab: "Simulated Backtest",
      name: "Strategy Name",
      description: "Description",
      languageLabel: "Language",
      categoryLabel: "Category",
      statusLabel: "Status",
      tagsLabel: "Tags",
      codeLabel: "Strategy Code",
      strategyDescriptionTab: "Strategy Description",
      strategyDescriptionPlaceholder: "Write the long-form description shown on the shared strategy page. Markdown text and images are supported.",
      createdAt: "Created",
      updatedAt: "Last Modified",
      save: "Save",
      saving: "Saving",
      saved: "Saved",
      run: "Run Backtest",
      running: "Backtesting",
      result: "Backtest Result",
      detail: "Detailed Result",
      openRun: "Open run detail",
      runId: "Run ID",
      runStatus: "Run Status",
      elapsed: "Elapsed",
      assumptions: "Assumptions",
      warnings: "Warnings",
      metrics: "Metrics",
      backtestSummary: "Backtest Summary",
      equityCurve: "Return Curve",
      tradeDetails: "Trade Details",
      noDetail: "Detailed result is not available here. Open the run detail page to inspect it.",
      loadingDetail: "Loading detailed result...",
      noTrades: "No trades recorded.",
      totalReturn: "Total Return",
      annualized: "Annualized",
      drawdown: "Max Drawdown",
      sharpe: "Sharpe",
      winRate: "Win Rate",
      trades: "Trades",
      engine: "Engine",
      startTime: "Start Time",
      endTime: "End Time",
      klinePeriod: "K-line Period",
      mode: "Mode",
      platform: "Platform (Exchange)",
      symbol: "Trading Pair",
      quoteCurrency: "Quote Currency",
      initialCapital: "Default Capital",
      tradingCurrency: "Trading Currency",
      parameters: "Parameters",
    }, [language]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    if (isNewStrategy) {
      setStrategy(createDraftStrategy());
      setLoading(false);
      api.listStrategies()
        .then(() => {
          if (!cancelled) setRemoteReady(true);
        })
        .catch((error) => {
          if (cancelled) return;
          setRemoteReady(false);
          if (!isRemotePersistenceUnavailable(error)) {
            toast.error(error instanceof Error ? error.message : "Failed to load strategies");
          }
        });
      return () => {
        cancelled = true;
      };
    }

    Promise.all([api.listStrategies(), api.getStrategyMarketCatalogConfig()])
      .then(([payload, catalogPayload]) => {
        if (cancelled) return;
        setRemoteReady(true);
        const loaded = findStrategyByRouteId(payload.strategies, routeStrategyId, resolvedStrategyId);
        const catalogItem = catalogPayload.items.find((item) => item.id === resolvedStrategyId || item.id === routeStrategyId);
        setStrategy(loaded ? normalizeOwnedStrategy(loaded) : catalogItem ? catalogItemToStrategy(catalogItem) : null);
      })
      .catch((error) => {
        if (cancelled) return;
        setRemoteReady(false);
        if (!isRemotePersistenceUnavailable(error)) {
          toast.error(error instanceof Error ? error.message : "Failed to load strategies");
        }
        setStrategy(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isNewStrategy, strategyId]);

  const setTab = (tab: StrategyTab) => {
    setSearchParams(tab === "backtest" ? { tab } : {});
  };

  const updateStrategy = (patch: Partial<StrategyLibraryItem>) => {
    setStrategy((current) => current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : current);
  };

  const updateBacktestForm = (patch: Partial<BacktestFormState>) => {
    setBacktestForm((current) => ({ ...current, ...patch }));
  };

  const updateBacktestParameter = (patch: Partial<BacktestParameterState>) => {
    setBacktestForm((current) => ({
      ...current,
      parameters: { ...current.parameters, ...patch },
    }));
  };

  const persistStrategy = async (item: StrategyLibraryItem) => {
    if (!remoteReady) {
      throw new Error(language === "zh-CN" ? "数据库未连接，无法保存策略" : "Database is unavailable; strategy was not saved");
    }
    await api.upsertStrategy(item);
  };

  const handleSave = async () => {
    if (!strategy) return;
    setSaving(true);
    try {
      await persistStrategy(strategy);
      toast.success(copy.saved);
      if (isNewStrategy) {
        navigate(`/m/edit-strategy/${encodeURIComponent(getStrategyRouteId(strategy.id))}`, { replace: true });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "保存策略失败" : "Failed to save strategy");
    } finally {
      setSaving(false);
    }
  };

  const handleBacktest = async () => {
    if (!strategy) return;
    setRunning(true);
    setBacktestResult(null);
    setBacktestRun(null);
    setBacktestRunLoading(false);
    try {
      await persistStrategy(strategy);
      const initialCapital = Number(backtestForm.initialCapital) || 50000;
      setBacktestInitialCapital(initialCapital);
      const selectedExchange = exchangeOptions.find((option) => option.value === backtestForm.exchange) ?? exchangeOptions[0];
      const fullBacktestParameters = {
        start_date: backtestForm.startDate,
        end_date: backtestForm.endDate,
        interval: backtestForm.interval,
        mode: backtestForm.mode,
        exchange: backtestForm.exchange,
        source: selectedExchange.source,
        symbol: backtestForm.symbol,
        quote_currency: backtestForm.quoteCurrency,
        initial_capital: initialCapital,
        trading_currency: backtestForm.tradingCurrency,
        ...backtestForm.parameters,
      };
      const backtestPayload = {
        start_date: backtestForm.startDate,
        end_date: backtestForm.endDate,
        symbol: backtestForm.symbol,
        interval: backtestForm.interval,
        source: selectedExchange.source,
        exchange: backtestForm.exchange,
        mode: backtestForm.mode,
        quote_currency: backtestForm.quoteCurrency,
        initial_capital: initialCapital,
        trading_currency: backtestForm.tradingCurrency,
        parameters: fullBacktestParameters,
      };
      const result = await api.runStrategyBacktest(strategy.id, backtestPayload);
      setBacktestResult(result);
      setBacktestRunLoading(true);
      api.getRun(result.run_id)
        .then((run) => setBacktestRun(run))
        .catch(() => setBacktestRun(null))
        .finally(() => setBacktestRunLoading(false));
      toast.success(language === "zh-CN" ? "模拟回测完成" : "Simulated backtest completed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "模拟回测失败" : "Simulated backtest failed");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
        {language === "zh-CN" ? "正在加载策略..." : "Loading strategy..."}
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <Link to="/strategies" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {copy.back}
        </Link>
        <div className="mt-8 rounded-lg border bg-card p-8 text-center">
          <FileCode2 className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold">{copy.missing}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.missingHint}</p>
        </div>
      </div>
    );
  }

  const metricCards = backtestResult
    ? [
      [copy.totalReturn, `${backtestResult.totalReturnPct.toFixed(2)}%`],
      [copy.annualized, `${backtestResult.annualizedReturnPct.toFixed(2)}%`],
      [copy.drawdown, `${backtestResult.maxDrawdownPct.toFixed(2)}%`],
      [copy.sharpe, backtestResult.sharpe.toFixed(2)],
      [copy.winRate, `${backtestResult.winRatePct.toFixed(1)}%`],
      [copy.trades, String(backtestResult.tradeCount)],
    ]
    : [];
  const availableSymbols = exchangeSymbols[backtestForm.exchange];
  const selectedExchange = exchangeOptions.find((option) => option.value === backtestForm.exchange) ?? exchangeOptions[0];
  const selectedInterval = intervalOptions.find((option) => option.value === backtestForm.interval) ?? intervalOptions[0];
  const selectedMode = modeOptions.find((option) => option.value === backtestForm.mode) ?? modeOptions[0];
  const exchangeLabel = language === "zh-CN" ? selectedExchange.labelZh : selectedExchange.labelEn;
  const intervalLabel = language === "zh-CN" ? selectedInterval.labelZh : selectedInterval.labelEn;
  const modeLabel = language === "zh-CN" ? selectedMode.labelZh : selectedMode.labelEn;
  const detailMetrics = nonEmptyEntries(backtestRun?.metrics);
  const runCardBacktest = nonEmptyEntries(backtestRun?.run_card?.backtest);
  const runCardMetrics = nonEmptyEntries(backtestRun?.run_card?.metrics);
  const tradeRows = backtestRun?.trade_log ?? [];
  const tradeColumns = tradeRows.length > 0 ? [...new Set(tradeRows.slice(0, 25).flatMap(Object.keys))].slice(0, 8) : [];
  const detailWarnings = [
    ...(backtestResult?.warnings ?? []),
    ...((backtestRun?.run_card?.warnings as string[] | undefined) ?? []),
  ].filter(Boolean);

  return (
    <div className="min-h-full bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => navigate("/strategies")}
            className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {copy.back}
          </button>
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FileCode2 className="h-4 w-4 text-primary" />
                {copy.kicker}
              </div>
              <h1 className="truncate text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
                {strategy.name}
              </h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {strategy.id} · {copy.updatedAt} {formatDate(strategy.updatedAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {saving ? copy.saving : copy.save}
            </button>
          </div>

          <div className="mt-5 inline-flex rounded-md border bg-background p-1">
            <button
              type="button"
              onClick={() => setTab("edit")}
              className={cn(
                "rounded px-3 py-1.5 text-sm font-semibold transition",
                activeTab === "edit" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {copy.editTab}
            </button>
            <button
              type="button"
              onClick={() => setTab("backtest")}
              className={cn(
                "rounded px-3 py-1.5 text-sm font-semibold transition",
                activeTab === "backtest" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {copy.backtestTab}
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">
        {activeTab === "edit" ? (
          <div className="grid overflow-hidden rounded-lg border bg-card lg:grid-cols-[24rem_minmax(0,1fr)]">
            <div className="space-y-3 border-b p-4 lg:border-b-0 lg:border-r">
              <label className="block">
                <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.name}</span>
                <input
                  value={strategy.name}
                  onChange={(event) => updateStrategy({ name: event.target.value })}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.description}</span>
                <textarea
                  value={strategy.description}
                  onChange={(event) => updateStrategy({ description: event.target.value })}
                  className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.languageLabel}</span>
                <select
                  value={strategy.language}
                  onChange={(event) => updateStrategy({
                    language: isStrategyLanguage(event.target.value) ? event.target.value : "python",
                  })}
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
                  value={strategy.category}
                  onChange={(event) => updateStrategy({
                    category: isStrategyCategory(event.target.value) ? event.target.value : "utility",
                  })}
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
                  value={strategy.status}
                  onChange={(event) => updateStrategy({
                    status: isStrategyStatus(event.target.value) ? event.target.value : "draft",
                  })}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.value}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.tagsLabel}</span>
                <input
                  value={strategy.tags.join(", ")}
                  onChange={(event) => updateStrategy({
                    tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
                  })}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                />
              </label>
              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div>
                  <div className="font-semibold uppercase">{copy.createdAt}</div>
                  <div className="mt-1 font-mono">{formatDate(strategy.createdAt)}</div>
                </div>
                <div>
                  <div className="font-semibold uppercase">{copy.updatedAt}</div>
                  <div className="mt-1 font-mono">{formatDate(strategy.updatedAt)}</div>
                </div>
              </div>
            </div>

            <div className="flex min-h-[46rem] min-w-0 flex-col">
              <div className="flex items-center gap-1 border-b bg-background px-2 py-1">
                {[
                  ["code", copy.codeLabel],
                  ["description", copy.strategyDescriptionTab],
                ].map(([pane, label]) => (
                  <button
                    key={pane}
                    type="button"
                    onClick={() => setEditorPane(pane as EditorPane)}
                    className={cn(
                      "rounded px-3 py-1.5 text-xs font-semibold transition",
                      editorPane === pane ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {editorPane === "code" ? (
                <StrategyCodeEditor
                  value={strategy.code}
                  language={strategy.language}
                  onChange={(code) => updateStrategy({ code })}
                />
              ) : (
                <textarea
                  value={strategy.strategyDescription ?? ""}
                  onChange={(event) => updateStrategy({ strategyDescription: event.target.value })}
                  placeholder={copy.strategyDescriptionPlaceholder}
                  className="min-h-[46rem] flex-1 resize-none bg-background p-4 font-mono text-sm leading-6 outline-none"
                />
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{copy.backtestTab}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {backtestForm.symbol} · {intervalLabel} · {exchangeLabel} · {modeLabel}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4 border-t pt-5">
              <div className="grid gap-3 md:grid-cols-4">
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.startTime}</span>
                  <input
                    type="date"
                    value={backtestForm.startDate}
                    onChange={(event) => updateBacktestForm({ startDate: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.endTime}</span>
                  <input
                    type="date"
                    value={backtestForm.endDate}
                    onChange={(event) => updateBacktestForm({ endDate: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.klinePeriod}</span>
                  <select
                    value={backtestForm.interval}
                    onChange={(event) => updateBacktestForm({ interval: event.target.value as BacktestInterval })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    {intervalOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {language === "zh-CN" ? option.labelZh : option.labelEn}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.mode}</span>
                  <select
                    value={backtestForm.mode}
                    onChange={(event) => updateBacktestForm({ mode: event.target.value as BacktestMode })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    {modeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {language === "zh-CN" ? option.labelZh : option.labelEn}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-5">
                <label className="block md:col-span-1">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.platform}</span>
                  <select
                    value={backtestForm.exchange}
                    onChange={(event) => {
                      const exchange = event.target.value as BacktestExchange;
                      updateBacktestForm({ exchange, symbol: exchangeSymbols[exchange][0] });
                    }}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    {exchangeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {language === "zh-CN" ? option.labelZh : option.labelEn}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block md:col-span-1">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.symbol}</span>
                  <select
                    value={backtestForm.symbol}
                    onChange={(event) => updateBacktestForm({ symbol: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    {availableSymbols.map((symbol) => (
                      <option key={symbol} value={symbol}>{symbol}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.quoteCurrency}</span>
                  <select
                    value={backtestForm.quoteCurrency}
                    onChange={(event) => updateBacktestForm({ quoteCurrency: event.target.value as "USDT" })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    <option value="USDT">USDT</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.initialCapital}</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={backtestForm.initialCapital}
                    onChange={(event) => updateBacktestForm({ initialCapital: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{copy.tradingCurrency}</span>
                  <select
                    value={backtestForm.tradingCurrency}
                    onChange={(event) => updateBacktestForm({ tradingCurrency: event.target.value as "USDT" })}
                    className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    <option value="USDT">USDT</option>
                  </select>
                </label>
              </div>

              <div className="rounded-md border bg-background p-4">
                <div className="text-xs font-semibold uppercase text-muted-foreground">{copy.parameters}</div>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">操作方向</span>
                    <select
                      value={backtestForm.parameters.direction}
                      onChange={(event) => updateBacktestParameter({ direction: event.target.value as TradeDirection })}
                      className="mt-1 h-10 w-full rounded-md border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {directionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {language === "zh-CN" ? option.labelZh : option.labelEn}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">杠杆倍数</span>
                    <select
                      value={backtestForm.parameters.leverage}
                      onChange={(event) => updateBacktestParameter({ leverage: event.target.value })}
                      className="mt-1 h-10 w-full rounded-md border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {leverageOptions.map((value) => (
                        <option key={value} value={value}>{value}x</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">下单价值</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={backtestForm.parameters.orderValue}
                      onChange={(event) => updateBacktestParameter({ orderValue: event.target.value })}
                      className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    />
                  </label>
                  <label className="flex h-10 items-center justify-between gap-3 rounded-md border bg-card px-3 text-sm">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">启用趋势</span>
                    <input
                      type="checkbox"
                      checked={backtestForm.parameters.enableTrend}
                      onChange={(event) => updateBacktestParameter({ enableTrend: event.target.checked })}
                      className="h-4 w-4 rounded border"
                    />
                  </label>
                  <label className="flex h-10 items-center justify-between gap-3 rounded-md border bg-card px-3 text-sm">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">启用回调</span>
                    <input
                      type="checkbox"
                      checked={backtestForm.parameters.enableCallback}
                      onChange={(event) => updateBacktestParameter({ enableCallback: event.target.checked })}
                      className="h-4 w-4 rounded border"
                    />
                  </label>
                  {[
                    ["回撤止盈触发阈值(%)", "drawdownTakeProfitTriggerPct"],
                    ["利润回撤止盈百分比(%)", "profitDrawdownTakeProfitPct"],
                    ["1-2补仓间距", "addSpacing12Pct"],
                    ["3-4补仓间距", "addSpacing34Pct"],
                    ["5-6补仓间距", "addSpacing56Pct"],
                    ["6+补仓间距", "addSpacing6PlusPct"],
                    ["回调补仓百分比(%)", "callbackAddPct"],
                    ["保本平仓线", "breakevenCloseLine"],
                    ["多单加仓倍数", "longAddMultiplierPrimary"],
                    ["多单加仓倍数", "longAddMultiplierSecondary"],
                    ["空单加仓倍数", "shortAddMultiplier"],
                    ["多单磨损仓", "longWearPosition"],
                    ["空单磨损仓", "shortWearPosition"],
                    ["单币浮亏多单止损", "longFloatingLossStop"],
                    ["单币浮亏空单止损", "shortFloatingLossStop"],
                    ["转账/清仓阈值", "transferClearThreshold"],
                    ["转账/清仓值", "transferClearValue"],
                    ["轮询时间(s)", "pollingSeconds"],
                  ].map(([label, key]) => (
                    <label key={key} className="block">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">{label}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={String(backtestForm.parameters[key as keyof BacktestParameterState])}
                        onChange={(event) => updateBacktestParameter({ [key]: event.target.value } as Partial<BacktestParameterState>)}
                        className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                      />
                    </label>
                  ))}
                  <label className="flex h-10 items-center justify-between gap-3 rounded-md border bg-card px-3 text-sm">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">是否自动解套</span>
                    <input
                      type="checkbox"
                      checked={backtestForm.parameters.autoRescue}
                      onChange={(event) => updateBacktestParameter({ autoRescue: event.target.checked })}
                      className="h-4 w-4 rounded border"
                    />
                  </label>
                  <label className="flex h-10 items-center justify-between gap-3 rounded-md border bg-card px-3 text-sm">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">是否止损</span>
                    <input
                      type="checkbox"
                      checked={backtestForm.parameters.enableStopLoss}
                      onChange={(event) => updateBacktestParameter({ enableStopLoss: event.target.checked })}
                      className="h-4 w-4 rounded border"
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-start gap-3">
                <button
                  type="button"
                  onClick={handleBacktest}
                  disabled={running}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {running ? copy.running : copy.run}
                </button>
              </div>
            </div>

            {backtestResult && (
              <div className="mt-5 border-t pt-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold">{copy.result}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {backtestResult.symbol} · {backtestResult.timeframe} · {backtestResult.period}
                    </p>
                  </div>
                  <Link
                    to={`/runs/${encodeURIComponent(backtestResult.run_id)}`}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-semibold transition hover:bg-muted"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {copy.openRun}
                  </Link>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {metricCards.map(([label, value]) => (
                    <div key={label} className="rounded-md border bg-background p-3">
                      <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
                      <div className="mt-2 text-xl font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="font-semibold">{copy.engine}: </span>
                  <span className="font-mono">{backtestResult.engine}</span>
                </div>

                <div className="mt-5 rounded-md border bg-background p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">{copy.detail}</h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {copy.runId}: <span className="font-mono">{backtestResult.run_id}</span>
                      </p>
                    </div>
                    {backtestRun?.elapsed_seconds != null && (
                      <span className="text-xs text-muted-foreground">
                        {copy.elapsed}: {backtestRun.elapsed_seconds.toFixed(1)}s
                      </span>
                    )}
                  </div>

                  {backtestRunLoading ? (
                    <div className="mt-4 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                      {copy.loadingDetail}
                    </div>
                  ) : !backtestRun ? (
                    <div className="mt-4 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                      {copy.noDetail}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        {[
                          [copy.runStatus, backtestRun.status],
                          [copy.engine, backtestResult.engine],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-md border bg-card p-3">
                            <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
                            <div className="mt-1 break-all text-sm font-medium">{value}</div>
                          </div>
                        ))}
                      </div>

                      {(backtestResult.assumptions.length > 0 || detailWarnings.length > 0) && (
                        <div className="grid gap-3 lg:grid-cols-2">
                          {backtestResult.assumptions.length > 0 && (
                            <section className="rounded-md border bg-card p-3">
                              <div className="text-xs font-semibold uppercase text-muted-foreground">{copy.assumptions}</div>
                              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                                {backtestResult.assumptions.map((item) => <li key={item}>{item}</li>)}
                              </ul>
                            </section>
                          )}
                          {detailWarnings.length > 0 && (
                            <section className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3">
                              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-amber-700 dark:text-amber-300">
                                <AlertTriangle className="h-4 w-4" />
                                {copy.warnings}
                              </div>
                              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                                {[...new Set(detailWarnings)].map((item) => <li key={item}>{item}</li>)}
                              </ul>
                            </section>
                          )}
                        </div>
                      )}

                      {(detailMetrics.length > 0 || runCardMetrics.length > 0 || runCardBacktest.length > 0) && (
                        <div className="grid gap-4 xl:grid-cols-2">
                          <DetailKeyValue title={copy.metrics} entries={detailMetrics.length ? detailMetrics : runCardMetrics} />
                          <DetailKeyValue title={copy.backtestSummary} entries={runCardBacktest} />
                        </div>
                      )}

                      {backtestRun.equity_curve && backtestRun.equity_curve.length > 0 && (
                        <section className="rounded-md border bg-card p-4">
                          <h5 className="text-sm font-semibold">{copy.equityCurve}</h5>
                          <div className="mt-3">
                            <StrategyReturnChart
                              data={backtestRun.equity_curve}
                              initialCapital={backtestInitialCapital}
                              height={260}
                            />
                          </div>
                        </section>
                      )}

                      <section className="rounded-md border bg-card p-4">
                        <h5 className="text-sm font-semibold">{copy.tradeDetails}</h5>
                        {tradeRows.length === 0 ? (
                          <p className="mt-3 text-sm text-muted-foreground">{copy.noTrades}</p>
                        ) : (
                          <div className="mt-3 overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                  {tradeColumns.map((column) => (
                                    <th key={column} className="py-2 pr-4">{column}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {tradeRows.slice(0, 25).map((row, index) => (
                                  <tr key={index} className="border-b last:border-0">
                                    {tradeColumns.map((column) => (
                                      <td key={column} className="py-2 pr-4 align-top">
                                        {formatDetailValue(row[column])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function DetailKeyValue({ title, entries }: { title: string; entries: Array<[string, unknown]> }) {
  if (entries.length === 0) return null;
  return (
    <section className="rounded-md border bg-card p-4">
      <h5 className="text-sm font-semibold">{title}</h5>
      <dl className="mt-3 divide-y text-sm">
        {entries.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)] gap-3 py-2">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="break-words text-right tabular-nums">{formatDetailValue(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
