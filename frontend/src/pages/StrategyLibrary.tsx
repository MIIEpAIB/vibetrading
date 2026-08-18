import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  Check,
  Copy,
  Download,
  FileCode2,
  FolderTree,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RadioTower,
  Search,
  Share2,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
  WandSparkles,
  WalletCards,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, ApiError, type StrategyLibraryItem } from "@/lib/api";
import { adminUrl } from "@/lib/adminUrl";
import { StrategyCodeEditor } from "@/components/strategy/StrategyCodeEditor";
import { PAPER_EXECUTION_OPTIONS, executionOptionValue, paperExecutionPayload } from "@/lib/paperExecution";
import { buildClassicTurtlePythonStrategyCode, getStrategyRouteId } from "@/lib/strategyMarketplace";
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
  const shouldMigrateClassicTurtle = isLegacyClassicTurtleJsonSpec(id, rawCode);

  return {
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : fallback.name,
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
    code: shouldMigrateClassicTurtle ? buildClassicTurtlePythonStrategyCode() : rawCode,
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
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
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

function paperLimitsForStrategy(strategy: StrategyItem) {
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
      const signal = isRecord(parsed.paper_signal) ? parsed.paper_signal : null;
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
    // Plain Python strategies use the conservative default paper limits.
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
  const [paperRunningId, setPaperRunningId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [paperExecution, setPaperExecution] = useState("shadow");
  const [moreMenu, setMoreMenu] = useState<MoreMenuState | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);

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
      groups: "分组管理",
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
      rent: "出租",
      run: "运行",
      paperRun: "模拟盘运行",
      paperRunning: "启动中",
      paperExists: "该策略已在模拟盘运行",
      paperExecution: "模拟盘执行",
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
      groups: "Groups",
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
      rent: "Rent",
      run: "Run",
      paperRun: "Run Paper",
      paperRunning: "Starting",
      paperExists: "This strategy is already running in paper trading",
      paperExecution: "Paper execution",
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

  const handleRunPaper = async (strategy: StrategyItem) => {
    setPaperRunningId(strategy.id);
    try {
      await api.upsertStrategy(toApiStrategy(strategy));
      const existing = await api.listPaperDeployments();
      const existingDeployment = existing.deployments.find((deployment) => (
        deployment.strategy_id === strategy.id && deployment.status !== "archived"
      ));
      if (existingDeployment) {
        toast.message(copy.paperExists);
        navigate(`/shadow-trading?paper=${encodeURIComponent(existingDeployment.deployment_id)}`);
        return;
      }
      const result = await api.createPaperDeployment({
        strategy_id: strategy.id,
        limits: paperLimitsForStrategy(strategy),
        ...paperExecutionPayload(paperExecution),
      });
      await api.startPaperDeployment(result.deployment.deployment_id);
      await api.runPaperDeploymentTick(result.deployment.deployment_id).catch(() => undefined);
      toast.success(language === "zh-CN" ? "已启动模拟盘运行" : "Paper trading started");
      navigate(`/shadow-trading?paper=${encodeURIComponent(result.deployment.deployment_id)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "启动模拟盘失败" : "Failed to start paper trading");
    } finally {
      setPaperRunningId(null);
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
      navigate(`/live-trading?strategy=${encodeURIComponent(strategy.id)}`);
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

  const handlePendingAction = (label: string) => {
    setMoreMenu(null);
    toast.message(language === "zh-CN" ? `${label}功能待接入` : `${label} will be connected later`);
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
                disabled={!activeStrategy || runningId === activeStrategy.id}
                className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
              >
                <Play className="h-4 w-4 text-primary" />
                {activeStrategy && runningId === activeStrategy.id ? copy.backtesting : copy.backtest}
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
                onClick={() => handlePendingAction(copy.groups)}
                className="inline-flex items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted"
              >
                <FolderTree className="h-4 w-4 text-primary" />
                {copy.groups}
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
          <label className="mt-3 flex max-w-md flex-col gap-1 text-xs font-semibold text-muted-foreground sm:mt-0">
            {copy.paperExecution}
            <select
              value={paperExecution}
              onChange={(event) => setPaperExecution(event.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm font-medium text-foreground outline-none transition focus:ring-2 focus:ring-primary/25"
            >
              {PAPER_EXECUTION_OPTIONS.map((option) => (
                <option key={executionOptionValue(option)} value={executionOptionValue(option)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
                          onClick={() => handleRunPaper(strategy)}
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
            onClick={() => handlePendingAction(copy.rent)}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted"
          >
            <Store className="h-3.5 w-3.5" />
            {copy.rent}
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
    </div>
  );
}
