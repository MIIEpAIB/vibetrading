import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Gauge,
  type LucideIcon,
  Play,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { api, type ShadowAccountResponse, type ShadowOrder, type ShadowWallet } from "@/lib/api";
import { loadShadowImportDraft, SHADOW_SYMBOLS, type ShadowImportDraft } from "@/lib/shadowImport";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/I18nProvider";

const SYMBOLS = SHADOW_SYMBOLS;
const TAKER_FEE_RATE = 0.001;
const SLIPPAGE_RATE = 0.0005;

const COPY = {
  en: {
    virtualPortfolio: "Virtual Portfolio",
    title: "Shadow Trading",
    subtitle: "Route virtual orders through the same order state machine while keeping funds isolated from live broker connectors.",
    refresh: "Refresh",
    reset: "Reset",
    availableUsdt: "Available USDT",
    frozenUsdt: "Frozen USDT",
    orders: "Orders",
    filled: "filled",
    pending: "pending",
    readinessTitle: "Shadow Readiness",
    readinessSubtitle: "Training score before any crypto live pilot.",
    pilotReady: "Pilot ready",
    keepTraining: "Keep training",
    needsEvidence: "Needs evidence",
    costTitle: "Crypto Cost Model",
    costSubtitle: "A spot-first estimate so beginners do not ignore exchange friction.",
    takerFee: "Taker fee",
    slippage: "Slippage",
    estCost: "Est. cost",
    costNote: "Later live promotion should verify real exchange precision, minimum notional, spread, funding exposure for perps, and API error handling.",
    gateTitle: "Live Promotion Gate",
    gateSubtitle: "No direct upgrade from shadow to live orders.",
    gateFill: "At least one shadow fill",
    gateReject: "No rejected order evidence",
    gateReview: "Ready for mandate review",
    askReview: "Ask live-readiness review",
    strategyCockpit: "Strategy cockpit",
    warning: "Shadow orders are virtual. Live crypto trading must still go through a user-committed mandate, exchange connector checks, confirm-mode first, automatic expiry, and the kill switch.",
    ticketTitle: "Order Ticket",
    ticketSubtitle: "Market orders fill immediately; limit orders wait for price triggers.",
    symbol: "Symbol",
    buy: "Buy",
    sell: "Sell",
    market: "Market",
    limit: "Limit",
    quantity: "Quantity",
    limitPrice: "Limit price",
    latest: "Latest",
    placeOrder: "Place Virtual Order",
    triggerTitle: "Market Trigger",
    triggerSubtitle: "Push a latest price to fill eligible virtual limit orders.",
    update: "Update",
    importedDraftTitle: "Imported agent result",
    importedDraftDesc: "The order ticket is prefilled from the agent result. Run it as a virtual order to collect shadow evidence.",
    importedSourceRun: "Run",
    importedSourceShadow: "Shadow profile",
    runImportedTest: "Run imported test",
    dismissImport: "Dismiss",
    wallets: "Wallets",
    asset: "Asset",
    available: "Available",
    frozen: "Frozen",
    loading: "Loading...",
    noWalletRows: "No wallet rows.",
    orderFlow: "Order Flow",
    time: "Time",
    side: "Side",
    type: "Type",
    qty: "Qty",
    price: "Price",
    status: "Status",
    action: "Action",
    noOrders: "No orders yet.",
    cancel: "Cancel",
    ready: "ready",
    missing: "missing",
    validationQuantity: "Quantity must be positive.",
    validationLimitPrice: "Limit price must be positive.",
    validationMarketPrice: "Market price must be positive.",
    loadFailed: "Failed to load shadow account",
    placeFailed: "Failed to place order",
    updateFailed: "Failed to update market price",
    cancelFailed: "Failed to cancel order",
    resetFailed: "Failed to reset account",
    orderRejected: "Order rejected",
    orderCanceled: "Order canceled",
    accountReset: "Virtual account reset",
    marketUpdated: "Market price updated",
    importLoaded: "Agent result imported into the shadow ticket.",
    importFailed: "Could not import that agent result.",
    limitFilled: (count: number) => `${count} limit order${count > 1 ? "s" : ""} filled`,
    orderDone: (status: ShadowOrder["status"]) => `Order ${status.toLowerCase()}`,
    statusLabels: { PENDING: "Pending", FILLED: "Filled", CANCELED: "Canceled", REJECTED: "Rejected" },
  },
  zh: {
    virtualPortfolio: "虚拟组合",
    title: "影子模拟盘",
    subtitle: "用与实盘相同的订单状态机演练虚拟订单，资金始终与真实交易连接器隔离。",
    refresh: "刷新",
    reset: "重置",
    availableUsdt: "可用 USDT",
    frozenUsdt: "冻结 USDT",
    orders: "订单",
    filled: "已成交",
    pending: "挂单",
    readinessTitle: "影子成熟度",
    readinessSubtitle: "进入加密实盘试点前的训练评分。",
    pilotReady: "可进入试点评审",
    keepTraining: "继续训练",
    needsEvidence: "证据不足",
    costTitle: "加密成本模型",
    costSubtitle: "以现货为主的成本估算，避免新手忽略交易摩擦。",
    takerFee: "Taker 手续费",
    slippage: "滑点",
    estCost: "估算成本",
    costNote: "后续从影子盘进入实盘前，需要校验交易所精度、最小名义金额、价差、永续资金费率暴露和 API 异常处理。",
    gateTitle: "实盘晋级门槛",
    gateSubtitle: "影子盘不能直接升级为实盘下单。",
    gateFill: "至少有一笔影子成交",
    gateReject: "没有订单被拒证据",
    gateReview: "达到授权评审条件",
    askReview: "请求实盘就绪审查",
    strategyCockpit: "策略驾驶舱",
    warning: "影子订单均为虚拟订单。加密实盘必须经过用户确认的授权、交易所连接器检查、先确认模式、自动过期和一键熔断规则。",
    ticketTitle: "下单面板",
    ticketSubtitle: "市价单立即成交；限价单等待价格触发。",
    symbol: "交易对",
    buy: "买入",
    sell: "卖出",
    market: "市价",
    limit: "限价",
    quantity: "数量",
    limitPrice: "限价价格",
    latest: "最新价",
    placeOrder: "提交虚拟订单",
    triggerTitle: "行情触发",
    triggerSubtitle: "推送最新价格，用于触发符合条件的虚拟限价单。",
    update: "更新",
    importedDraftTitle: "已导入 agent 结果",
    importedDraftDesc: "下单面板已按 agent 结果预填。点击运行会提交虚拟订单，用于积累影子盘测试证据。",
    importedSourceRun: "运行",
    importedSourceShadow: "影子档案",
    runImportedTest: "运行导入测试",
    dismissImport: "关闭",
    wallets: "钱包",
    asset: "资产",
    available: "可用",
    frozen: "冻结",
    loading: "加载中...",
    noWalletRows: "暂无钱包记录。",
    orderFlow: "订单流",
    time: "时间",
    side: "方向",
    type: "类型",
    qty: "数量",
    price: "价格",
    status: "状态",
    action: "操作",
    noOrders: "暂无订单。",
    cancel: "撤单",
    ready: "已满足",
    missing: "缺失",
    validationQuantity: "数量必须大于 0。",
    validationLimitPrice: "限价价格必须大于 0。",
    validationMarketPrice: "行情价格必须大于 0。",
    loadFailed: "加载影子账户失败",
    placeFailed: "提交订单失败",
    updateFailed: "更新行情失败",
    cancelFailed: "撤单失败",
    resetFailed: "重置账户失败",
    orderRejected: "订单被拒绝",
    orderCanceled: "订单已取消",
    accountReset: "虚拟账户已重置",
    marketUpdated: "行情价格已更新",
    importLoaded: "已将 agent 结果导入影子下单面板。",
    importFailed: "无法导入该 agent 结果。",
    limitFilled: (count: number) => `${count} 笔限价单已成交`,
    orderDone: (status: ShadowOrder["status"]) => `订单${COPY.zh.statusLabels[status]}`,
    statusLabels: { PENDING: "挂单", FILLED: "已成交", CANCELED: "已取消", REJECTED: "已拒绝" },
  },
} as const;

type ShadowCopy = (typeof COPY)[keyof typeof COPY];

function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(4)}`;
}

function formatQty(value: number): string {
  if (Math.abs(value) >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return value.toPrecision(6);
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ShadowTrading() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { language } = useTranslation();
  const c = language === "zh-CN" ? COPY.zh : COPY.en;
  const [account, setAccount] = useState<ShadowAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [importDraft, setImportDraft] = useState<ShadowImportDraft | null>(null);
  const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>("BTC_USDT");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("0.1");
  const [limitPrice, setLimitPrice] = useState("60000");
  const [priceUpdate, setPriceUpdate] = useState("59900");

  const wallets = useMemo(() => account?.wallets ?? [], [account]);
  const orders = useMemo(() => account?.orders ?? [], [account]);
  const pendingOrders = useMemo(() => orders.filter((order) => order.status === "PENDING"), [orders]);
  const filledOrders = useMemo(() => orders.filter((order) => order.status === "FILLED"), [orders]);
  const rejectedOrders = useMemo(() => orders.filter((order) => order.status === "REJECTED"), [orders]);
  const availableUsdt = wallets.find((wallet) => wallet.asset_name === "USDT")?.balance ?? 0;
  const frozenUsdt = wallets.find((wallet) => wallet.asset_name === "USDT")?.frozen ?? 0;
  const selectedPrice = account?.market_prices[symbol] ?? 0;
  const filledNotional = filledOrders.reduce((sum, order) => {
    const fillPrice = order.executed_price || order.price;
    return sum + Math.abs(order.quantity * fillPrice);
  }, 0);
  const estimatedCosts = filledNotional * (TAKER_FEE_RATE + SLIPPAGE_RATE);
  const readinessScore = Math.min(
    100,
    26
      + Math.min(filledOrders.length, 6) * 9
      + Math.min(pendingOrders.length, 3) * 4
      + (orders.length > 0 ? 12 : 0)
      + (rejectedOrders.length === 0 ? 8 : -10),
  );
  const readinessLabel = readinessScore >= 80 ? c.pilotReady : readinessScore >= 55 ? c.keepTraining : c.needsEvidence;

  const loadAccount = async () => {
    setLoading(true);
    try {
      setAccount(await api.getShadowAccount());
    } catch (error) {
      const message = error instanceof Error ? error.message : c.loadFailed;
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccount();
  }, []);

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
    setSymbol(draft.symbol);
    setSide(draft.side);
    setOrderType(draft.orderType);
    setQuantity(String(draft.quantity));
    if (draft.price) {
      setLimitPrice(String(Math.round(draft.price)));
      setPriceUpdate(String(Math.round(draft.price)));
    }
    toast.success(c.importLoaded);
  }, [c.importFailed, c.importLoaded, searchParams, setSearchParams]);

  useEffect(() => {
    if (!account) return;
    const marketPrice = account.market_prices[symbol];
    if (marketPrice) {
      setLimitPrice(String(Math.round(marketPrice * 0.92)));
      setPriceUpdate(String(Math.round(marketPrice * 0.9)));
    }
  }, [account, symbol]);

  const placeOrder = async (): Promise<boolean> => {
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(limitPrice);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      toast.error(c.validationQuantity);
      return false;
    }
    if (orderType === "LIMIT" && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      toast.error(c.validationLimitPrice);
      return false;
    }
    setSubmitting(true);
    try {
      const order = await api.placeShadowOrder({
        symbol,
        side,
        order_type: orderType,
        quantity: parsedQuantity,
        price: orderType === "LIMIT" ? parsedPrice : 0,
      });
      const refreshed = await api.getShadowAccount();
      setAccount(refreshed);
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

  const runImportedTest = async () => {
    const accepted = await placeOrder();
    if (accepted) setImportDraft(null);
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

  const resetAccount = async () => {
    setSubmitting(true);
    try {
      setAccount(await api.resetShadowAccount());
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
    <div className="min-h-full bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 md:p-6">
        <header className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Shield className="h-3.5 w-3.5 text-primary" />
              {c.virtualPortfolio}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">{c.title}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {c.subtitle}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={loadAccount}
              disabled={loading || submitting}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              {c.refresh}
            </button>
            <button
              onClick={resetAccount}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-md border border-danger/30 px-3 py-2 text-sm text-danger transition hover:bg-danger/10 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              {c.reset}
            </button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          <Metric icon={CircleDollarSign} label={c.availableUsdt} value={formatMoney(availableUsdt)} />
          <Metric icon={Wallet} label={c.frozenUsdt} value={formatMoney(frozenUsdt)} />
          <Metric icon={ClipboardList} label={c.orders} value={`${filledOrders.length} ${c.filled} / ${pendingOrders.length} ${c.pending}`} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)_minmax(0,0.95fr)]">
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{c.readinessTitle}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{c.readinessSubtitle}</p>
              </div>
              <Gauge className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-4 flex items-end justify-between">
              <span className={cn(
                "text-4xl font-semibold",
                readinessScore >= 80 ? "text-success" : readinessScore >= 55 ? "text-warning" : "text-muted-foreground",
              )}>
                {readinessScore}
              </span>
              <span className="text-sm text-muted-foreground">/100</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted">
              <div
                className={cn("h-2 rounded-full", readinessScore >= 80 ? "bg-success" : readinessScore >= 55 ? "bg-warning" : "bg-primary")}
                style={{ width: `${readinessScore}%` }}
              />
            </div>
            <div className="mt-3 text-xs font-medium text-muted-foreground">{readinessLabel}</div>
          </div>

          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{c.costTitle}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{c.costSubtitle}</p>
              </div>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <CostPill label={c.takerFee} value={`${(TAKER_FEE_RATE * 100).toFixed(2)}%`} />
              <CostPill label={c.slippage} value={`${(SLIPPAGE_RATE * 100).toFixed(2)}%`} />
              <CostPill label={c.estCost} value={formatMoney(estimatedCosts)} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {c.costNote}
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{c.gateTitle}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{c.gateSubtitle}</p>
              </div>
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              <GateRow ok={filledOrders.length > 0} label={c.gateFill} readyLabel={c.ready} missingLabel={c.missing} />
              <GateRow ok={rejectedOrders.length === 0} label={c.gateReject} readyLabel={c.ready} missingLabel={c.missing} />
              <GateRow ok={readinessScore >= 80} label={c.gateReview} readyLabel={c.ready} missingLabel={c.missing} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={askLiveReadiness}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {c.askReview}
              </button>
              <Link
                to="/cockpit"
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Shield className="h-3.5 w-3.5" />
                {c.strategyCockpit}
              </Link>
            </div>
          </div>
        </section>

        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-5 text-muted-foreground">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              {c.warning}
            </span>
          </div>
        </div>

        {importDraft && (
          <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    {c.importedDraftTitle}
                  </span>
                  {importDraft.runId && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {c.importedSourceRun}: {importDraft.runId}
                    </span>
                  )}
                  {importDraft.shadowId && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {c.importedSourceShadow}: {importDraft.shadowId}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{c.importedDraftDesc}</p>
                <p className="mt-1 font-mono text-xs text-foreground">
                  {importDraft.side} {formatQty(importDraft.quantity)} {importDraft.symbol} @ {importDraft.orderType}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={runImportedTest}
                  disabled={loading || submitting}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {c.runImportedTest}
                </button>
                <button
                  type="button"
                  onClick={() => setImportDraft(null)}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  {c.dismissImport}
                </button>
              </div>
            </div>
          </section>
        )}

        <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">{c.ticketTitle}</h2>
                <p className="text-xs text-muted-foreground">{c.ticketSubtitle}</p>
              </div>
              <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="space-y-4">
              <Field label={c.symbol}>
                <select value={symbol} onChange={(event) => setSymbol(event.target.value as (typeof SYMBOLS)[number])} className="input-like">
                  {SYMBOLS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSide("BUY")}
                  className={cn("seg-button", side === "BUY" && "bg-success/15 text-success ring-1 ring-success/30")}
                >
                  {c.buy}
                </button>
                <button
                  type="button"
                  onClick={() => setSide("SELL")}
                  className={cn("seg-button", side === "SELL" && "bg-danger/15 text-danger ring-1 ring-danger/30")}
                >
                  {c.sell}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOrderType("MARKET")}
                  className={cn("seg-button", orderType === "MARKET" && "bg-primary/10 text-primary ring-1 ring-primary/30")}
                >
                  {c.market}
                </button>
                <button
                  type="button"
                  onClick={() => setOrderType("LIMIT")}
                  className={cn("seg-button", orderType === "LIMIT" && "bg-primary/10 text-primary ring-1 ring-primary/30")}
                >
                  {c.limit}
                </button>
              </div>

              <Field label={c.quantity}>
                <input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" className="input-like" />
              </Field>

              <Field label={c.limitPrice}>
                <input
                  value={limitPrice}
                  onChange={(event) => setLimitPrice(event.target.value)}
                  inputMode="decimal"
                  disabled={orderType === "MARKET"}
                  className="input-like disabled:cursor-not-allowed disabled:opacity-50"
                />
              </Field>

              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                {c.latest} {symbol}: <span className="font-medium text-foreground">{selectedPrice ? formatMoney(selectedPrice) : "n/a"}</span>
              </div>

              <button
                onClick={placeOrder}
                disabled={loading || submitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                {c.placeOrder}
              </button>
            </div>
          </section>

          <div className="grid gap-5">
            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold">{c.triggerTitle}</h2>
                  <p className="text-xs text-muted-foreground">{c.triggerSubtitle}</p>
                </div>
                <div className="flex w-full gap-2 lg:w-auto">
                  <input
                    value={priceUpdate}
                    onChange={(event) => setPriceUpdate(event.target.value)}
                    inputMode="decimal"
                    className="input-like min-w-0 flex-1 lg:w-44"
                  />
                  <button
                    onClick={pushPrice}
                    disabled={submitting}
                    className="inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm transition hover:bg-muted disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {c.update}
                  </button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(account?.market_prices ?? {}).slice(0, 8).map(([key, value]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setSymbol(key as (typeof SYMBOLS)[number]);
                      setPriceUpdate(String(value));
                    }}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left text-sm transition hover:bg-muted",
                      key === symbol && "border-primary bg-primary/5 text-primary",
                    )}
                  >
                    <div className="font-medium">{key}</div>
                    <div className="text-xs text-muted-foreground">{formatMoney(value)}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
              <WalletTable wallets={wallets} loading={loading} copy={c} />
              <OrderTable orders={orders} onCancel={cancelOrder} busy={submitting} copy={c} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold">{value}</p>
        </div>
        <span className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function CostPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function GateRow({ ok, label, readyLabel, missingLabel }: { ok: boolean; label: string; readyLabel: string; missingLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
        ok ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
      )}>
        {ok ? <CheckCircle2 className="h-3 w-3" /> : null}
        {ok ? readyLabel : missingLabel}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function WalletTable({ wallets, loading, copy }: { wallets: ShadowWallet[]; loading: boolean; copy: ShadowCopy }) {
  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">{copy.wallets}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">{copy.asset}</th>
              <th className="px-4 py-2 text-right">{copy.available}</th>
              <th className="px-4 py-2 text-right">{copy.frozen}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">{copy.loading}</td></tr>
            ) : wallets.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">{copy.noWalletRows}</td></tr>
            ) : wallets.map((wallet) => (
              <tr key={wallet.asset_name} className="border-t">
                <td className="px-4 py-3 font-medium">{wallet.asset_name}</td>
                <td className="px-4 py-3 text-right">{wallet.asset_name === "USDT" ? formatMoney(wallet.balance) : formatQty(wallet.balance)}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{wallet.asset_name === "USDT" ? formatMoney(wallet.frozen) : formatQty(wallet.frozen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderTable({ orders, onCancel, busy, copy }: { orders: ShadowOrder[]; onCancel: (order: ShadowOrder) => void; busy: boolean; copy: ShadowCopy }) {
  const sideLabel = (side: ShadowOrder["side"]) => side === "BUY" ? copy.buy : copy.sell;
  const typeLabel = (type: ShadowOrder["type"]) => type === "MARKET" ? copy.market : copy.limit;

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">{copy.orderFlow}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">{copy.time}</th>
              <th className="px-4 py-2 text-left">{copy.symbol}</th>
              <th className="px-4 py-2 text-left">{copy.side}</th>
              <th className="px-4 py-2 text-left">{copy.type}</th>
              <th className="px-4 py-2 text-right">{copy.qty}</th>
              <th className="px-4 py-2 text-right">{copy.price}</th>
              <th className="px-4 py-2 text-left">{copy.status}</th>
              <th className="px-4 py-2 text-right">{copy.action}</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">{copy.noOrders}</td></tr>
            ) : orders.map((order) => (
              <tr key={order.order_id} className="border-t">
                <td className="px-4 py-3 text-muted-foreground">{formatTime(order.timestamp)}</td>
                <td className="px-4 py-3 font-medium">{order.symbol}</td>
                <td className={cn("px-4 py-3 font-medium", order.side === "BUY" ? "text-success" : "text-danger")}>{sideLabel(order.side)}</td>
                <td className="px-4 py-3">{typeLabel(order.type)}</td>
                <td className="px-4 py-3 text-right">{formatQty(order.quantity)}</td>
                <td className="px-4 py-3 text-right">{formatMoney(order.executed_price || order.price)}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "inline-flex rounded-md px-2 py-1 text-xs font-medium",
                    order.status === "FILLED" && "bg-success/10 text-success",
                    order.status === "PENDING" && "bg-warning/10 text-warning",
                    order.status === "CANCELED" && "bg-muted text-muted-foreground",
                    order.status === "REJECTED" && "bg-danger/10 text-danger",
                  )}>
                    {copy.statusLabels[order.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {order.status === "PENDING" ? (
                    <button
                      onClick={() => onCancel(order)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-danger disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      {copy.cancel}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
