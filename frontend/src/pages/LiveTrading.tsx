import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Play,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Square,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type ExchangeApiKeyBinding,
  type LiveBrokerStatus,
  type LiveStatus,
  type StrategyLibraryItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/I18nProvider";

const fieldClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-xs font-semibold uppercase text-muted-foreground";

function formatDate(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function brokerTone(status?: LiveBrokerStatus | null) {
  if (!status) return "border-muted bg-muted/20 text-muted-foreground";
  if (status.halted) return "border-danger/30 bg-danger/10 text-danger";
  if (status.runner?.alive) return "border-success/30 bg-success/10 text-success";
  if (status.mandate && !status.mandate.expired) return "border-primary/30 bg-primary/10 text-primary";
  return "border-warning/30 bg-warning/10 text-warning";
}

export function LiveTrading() {
  const { language } = useTranslation();
  const [searchParams] = useSearchParams();
  const strategyId = searchParams.get("strategy") || "";
  const copy = useMemo(() => language === "zh-CN" ? {
    title: "实盘交易",
    subtitle: "选择已绑定账户，激活 live profile，并在 mandate 风控内启动实盘运行。",
    strategy: "策略",
    account: "账户",
    runtime: "运行状态",
    bindings: "API 绑定",
    noBindings: "还没有绑定交易所 API key",
    bindNow: "去绑定",
    activate: "设为 live profile",
    activating: "激活中",
    checkConnection: "激活后检查连接",
    activated: "live profile 已激活",
    startRunner: "启动实盘运行",
    stopRunner: "停止运行",
    refresh: "刷新",
    orderTicket: "交易面板",
    symbol: "标的",
    side: "方向",
    orderType: "订单类型",
    quantity: "数量",
    notional: "名义金额",
    limitPrice: "限价",
    risk: "风控约束",
    maxOrder: "单笔上限",
    exposure: "总敞口上限",
    leverage: "杠杆上限",
    dailyCap: "每日笔数",
    mandate: "Mandate",
    noMandate: "未提交",
    active: "已生效",
    expired: "已过期",
    halted: "已熔断",
    runnerAlive: "运行中",
    runnerStopped: "未运行",
    auth: "授权",
    configured: "已配置",
    unavailable: "暂不可用",
    connection: "连接检查",
    market: "市场",
    updated: "更新时间",
    created: "创建时间",
    secretSaved: "Secret 已保存",
    passphraseSaved: "Passphrase 已保存",
  } : {
    title: "Live Trading",
    subtitle: "Select a bound account, activate the live profile, and run inside mandate risk controls.",
    strategy: "Strategy",
    account: "Account",
    runtime: "Runtime",
    bindings: "API Bindings",
    noBindings: "No exchange API keys are bound yet",
    bindNow: "Bind now",
    activate: "Set as live profile",
    activating: "Activating",
    checkConnection: "Check connection after activation",
    activated: "Live profile activated",
    startRunner: "Start live runner",
    stopRunner: "Stop runner",
    refresh: "Refresh",
    orderTicket: "Trading Panel",
    symbol: "Symbol",
    side: "Side",
    orderType: "Order type",
    quantity: "Quantity",
    notional: "Notional",
    limitPrice: "Limit price",
    risk: "Risk Controls",
    maxOrder: "Max order",
    exposure: "Exposure cap",
    leverage: "Leverage cap",
    dailyCap: "Daily trades",
    mandate: "Mandate",
    noMandate: "Not committed",
    active: "Active",
    expired: "Expired",
    halted: "Halted",
    runnerAlive: "Running",
    runnerStopped: "Stopped",
    auth: "Auth",
    configured: "Configured",
    unavailable: "Unavailable",
    connection: "Connection",
    market: "Market",
    updated: "Updated",
    created: "Created",
    secretSaved: "Secret saved",
    passphraseSaved: "Passphrase saved",
  }, [language]);

  const [bindings, setBindings] = useState<ExchangeApiKeyBinding[]>([]);
  const [strategies, setStrategies] = useState<StrategyLibraryItem[]>([]);
  const [selectedBindingId, setSelectedBindingId] = useState<number | null>(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState(strategyId);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [checkConnection, setCheckConnection] = useState(false);
  const [activating, setActivating] = useState(false);
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [ticket, setTicket] = useState({
    symbol: "BTC-USDT",
    side: "buy",
    orderType: "market",
    quantity: "",
    notional: "100",
    limitPrice: "",
  });

  const selectedBinding = bindings.find((binding) => binding.binding_id === selectedBindingId) ?? bindings[0] ?? null;
  const selectedStrategy = strategies.find((strategy) => strategy.id === selectedStrategyId) ?? strategies[0] ?? null;
  const brokerStatus = status?.brokers.find((item) => item.auth.broker === selectedBinding?.exchange) ?? null;
  const mandate = brokerStatus?.mandate ?? null;
  const limits = mandate?.limits ?? {};

  const load = async () => {
    setLoading(true);
    try {
      const [bindingResult, strategyResult] = await Promise.all([
        api.listExchangeApiKeys(),
        api.listStrategies().catch(() => ({ strategies: [] as StrategyLibraryItem[] })),
      ]);
      setBindings(bindingResult.bindings);
      setStrategies(strategyResult.strategies);
      setSelectedBindingId((current) => current ?? bindingResult.bindings[0]?.binding_id ?? null);
      if (!selectedStrategyId && strategyResult.strategies[0]) {
        setSelectedStrategyId(strategyResult.strategies[0].id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load live trading data");
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = async () => {
    setStatusError("");
    try {
      setStatus(await api.getLiveStatus());
    } catch (error) {
      setStatus(null);
      setStatusError(error instanceof Error ? error.message : copy.unavailable);
    }
  };

  useEffect(() => {
    void load();
    void refreshStatus();
  }, []);

  const activateBinding = async () => {
    if (!selectedBinding) return;
    setActivating(true);
    try {
      const result = await api.activateExchangeApiKeyLive(selectedBinding.binding_id, checkConnection);
      toast.success(`${copy.activated}: ${result.profile_id}`);
      await refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to activate live profile");
    } finally {
      setActivating(false);
    }
  };

  const toggleRunner = async () => {
    if (!selectedBinding) return;
    setRunnerBusy(true);
    try {
      if (brokerStatus?.runner?.alive) {
        await api.stopLiveRunner(selectedBinding.exchange);
      } else {
        await api.startLiveRunner(selectedBinding.exchange);
      }
      await refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Runner control failed");
    } finally {
      setRunnerBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {copy.title}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void load();
            void refreshStatus();
          }}
          className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" />
          {copy.refresh}
        </button>
      </div>

      {bindings.length === 0 ? (
        <section className="rounded-lg border bg-card p-8 text-center shadow-sm">
          <KeyRound className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-base font-semibold">{copy.noBindings}</h2>
          <Link
            to="/personal-settings#exchange-api-bindings"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <KeyRound className="h-4 w-4" />
            {copy.bindNow}
          </Link>
        </section>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
            <div className="rounded-lg border bg-card p-5 shadow-sm">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.strategy}</span>
                  <select
                    value={selectedStrategy?.id ?? ""}
                    onChange={(event) => setSelectedStrategyId(event.target.value)}
                    className={fieldClass}
                  >
                    {strategies.map((strategy) => (
                      <option key={strategy.id} value={strategy.id}>{strategy.name}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.account}</span>
                  <select
                    value={selectedBinding?.binding_id ?? ""}
                    onChange={(event) => setSelectedBindingId(Number(event.target.value))}
                    className={fieldClass}
                  >
                    {bindings.map((binding) => (
                      <option key={binding.binding_id} value={binding.binding_id}>
                        {binding.label} · {binding.exchange.toUpperCase()} · {binding.api_key_hint}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <StatusTile
                  label={copy.auth}
                  value={selectedBinding ? copy.configured : copy.unavailable}
                  icon={KeyRound}
                  active={Boolean(selectedBinding)}
                />
                <StatusTile
                  label={copy.mandate}
                  value={mandate ? (mandate.expired ? copy.expired : copy.active) : copy.noMandate}
                  icon={ShieldCheck}
                  active={Boolean(mandate && !mandate.expired)}
                />
                <StatusTile
                  label={copy.runtime}
                  value={brokerStatus?.runner?.alive ? copy.runnerAlive : copy.runnerStopped}
                  icon={Activity}
                  active={Boolean(brokerStatus?.runner?.alive)}
                />
                <StatusTile
                  label={copy.market}
                  value={brokerStatus?.halted ? copy.halted : selectedBinding?.exchange.toUpperCase() ?? "--"}
                  icon={RadioTower}
                  active={!brokerStatus?.halted}
                  warning={Boolean(brokerStatus?.halted)}
                />
              </div>

              <div className="mt-5 rounded-md border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{selectedBinding?.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {selectedBinding?.exchange.toUpperCase()} · {selectedBinding?.product_type} · {selectedBinding?.api_key_hint}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={checkConnection}
                        onChange={(event) => setCheckConnection(event.target.checked)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {copy.checkConnection}
                    </label>
                    <button
                      type="button"
                      onClick={activateBinding}
                      disabled={activating || !selectedBinding}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      {activating ? copy.activating : copy.activate}
                    </button>
                  </div>
                </div>
                {statusError && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{statusError}</span>
                  </div>
                )}
              </div>
            </div>

            <div className={cn("rounded-lg border p-5 shadow-sm", brokerTone(brokerStatus))}>
              <div className="flex items-center gap-2">
                <WalletCards className="h-4 w-4" />
                <h2 className="text-base font-semibold">{copy.runtime}</h2>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <RuntimeRow label={copy.mandate} value={mandate ? (mandate.expired ? copy.expired : copy.active) : copy.noMandate} />
                <RuntimeRow label={copy.updated} value={formatDate(mandate?.created_at)} />
                <RuntimeRow label={copy.runnerAlive} value={brokerStatus?.runner?.alive ? copy.runnerAlive : copy.runnerStopped} />
              </div>
              <button
                type="button"
                onClick={toggleRunner}
                disabled={runnerBusy || !selectedBinding}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runnerBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : brokerStatus?.runner?.alive ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {brokerStatus?.runner?.alive ? copy.stopRunner : copy.startRunner}
              </button>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="rounded-lg border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <RadioTower className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">{copy.orderTicket}</h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.symbol}</span>
                  <input value={ticket.symbol} onChange={(event) => setTicket({ ...ticket, symbol: event.target.value })} className={fieldClass} />
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.side}</span>
                  <select value={ticket.side} onChange={(event) => setTicket({ ...ticket, side: event.target.value })} className={fieldClass}>
                    <option value="buy">buy</option>
                    <option value="sell">sell</option>
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.orderType}</span>
                  <select value={ticket.orderType} onChange={(event) => setTicket({ ...ticket, orderType: event.target.value })} className={fieldClass}>
                    <option value="market">market</option>
                    <option value="limit">limit</option>
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.quantity}</span>
                  <input value={ticket.quantity} onChange={(event) => setTicket({ ...ticket, quantity: event.target.value })} className={fieldClass} />
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.notional}</span>
                  <input value={ticket.notional} onChange={(event) => setTicket({ ...ticket, notional: event.target.value })} className={fieldClass} />
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.limitPrice}</span>
                  <input value={ticket.limitPrice} onChange={(event) => setTicket({ ...ticket, limitPrice: event.target.value })} className={fieldClass} disabled={ticket.orderType !== "limit"} />
                </label>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">{copy.risk}</h2>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <RiskMetric label={copy.maxOrder} value={limits.max_order_notional_usd} />
                <RiskMetric label={copy.exposure} value={limits.max_total_exposure_usd} />
                <RiskMetric label={copy.leverage} value={limits.max_leverage} />
                <RiskMetric label={copy.dailyCap} value={limits.max_trades_per_day} />
              </div>
              <div className="mt-4 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                {selectedStrategy?.name ?? copy.strategy}
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-card shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="text-base font-semibold">{copy.bindings}</h2>
            </div>
            <div className="divide-y">
              {bindings.map((binding) => (
                <button
                  key={binding.binding_id}
                  type="button"
                  onClick={() => setSelectedBindingId(binding.binding_id)}
                  className={cn(
                    "grid w-full gap-2 px-5 py-4 text-left transition hover:bg-muted/50 md:grid-cols-[1fr_auto]",
                    selectedBindingId === binding.binding_id && "bg-primary/5",
                  )}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{binding.label}</span>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase text-muted-foreground">{binding.exchange}</span>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{binding.product_type}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-mono">{binding.api_key_hint}</span>
                      {binding.api_secret_configured && <span>{copy.secretSaved}</span>}
                      {binding.passphrase_configured && <span>{copy.passphraseSaved}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {copy.created}: {formatDate(binding.created_at)}
                  </div>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatusTile({
  label,
  value,
  icon: Icon,
  active,
  warning = false,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  active: boolean;
  warning?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-md border bg-background p-3",
      active && "border-success/30 bg-success/5",
      warning && "border-danger/30 bg-danger/5",
    )}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function RuntimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function RiskMetric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border bg-muted/15 p-4">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-lg font-semibold">{value === undefined || value === null ? "--" : String(value)}</div>
    </div>
  );
}
