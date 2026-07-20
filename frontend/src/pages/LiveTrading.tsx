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
  type CryptoSymbolOption,
  type ExchangeApiKeyBinding,
  type LiveBrokerStatus,
  type LiveDeployment,
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
    hostedDeployment: "托管策略运行",
    createAndStart: "创建并启动托管",
    creatingDeployment: "启动中",
    pauseDeployment: "暂停托管",
    deploymentStatus: "托管状态",
    noDeployments: "还没有实盘托管部署",
    interval: "运行周期（秒）",
    timeframe: "K线周期",
    symbols: "交易标的",
    allowedSides: "允许方向",
    orderMode: "订单模式",
    deploymentStarted: "托管策略已启动",
    deploymentPaused: "托管策略已暂停",
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
    symbolsUnavailable: "交易对暂不可用",
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
    hostedDeployment: "Hosted Strategy Runtime",
    createAndStart: "Create and start",
    creatingDeployment: "Starting",
    pauseDeployment: "Pause hosting",
    deploymentStatus: "Hosting status",
    noDeployments: "No hosted live deployments yet",
    interval: "Run interval (sec)",
    timeframe: "Bar timeframe",
    symbols: "Symbols",
    allowedSides: "Allowed sides",
    orderMode: "Order mode",
    deploymentStarted: "Hosted strategy started",
    deploymentPaused: "Hosted strategy paused",
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
    symbolsUnavailable: "Symbols unavailable",
    connection: "Connection",
    market: "Market",
    updated: "Updated",
    created: "Created",
    secretSaved: "Secret saved",
    passphraseSaved: "Passphrase saved",
  }, [language]);

  const [bindings, setBindings] = useState<ExchangeApiKeyBinding[]>([]);
  const [strategies, setStrategies] = useState<StrategyLibraryItem[]>([]);
  const [deployments, setDeployments] = useState<LiveDeployment[]>([]);
  const [symbolOptions, setSymbolOptions] = useState<CryptoSymbolOption[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [selectedBindingId, setSelectedBindingId] = useState<number | null>(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState(strategyId);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [checkConnection, setCheckConnection] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deploymentBusy, setDeploymentBusy] = useState(false);
  const [liveForm, setLiveForm] = useState({
    intervalSeconds: "60",
    timeframe: "1h",
    symbols: "",
    allowedSides: "BUY,SELL",
    orderMode: "MARKET",
    maxOrder: "100",
    maxExposure: "1000",
    maxLeverage: "1",
    maxTradesPerDay: "5",
  });
  const selectedBinding = bindings.find((binding) => binding.binding_id === selectedBindingId) ?? bindings[0] ?? null;
  const selectedStrategy = strategies.find((strategy) => strategy.id === selectedStrategyId) ?? strategies[0] ?? null;
  const brokerStatus = status?.brokers.find((item) => item.auth.broker === selectedBinding?.exchange) ?? null;
  const mandate = brokerStatus?.mandate ?? null;
  const limits = mandate?.limits ?? {};
  const activeDeployment = deployments.find((deployment) => (
    deployment.status === "running"
    && deployment.broker === selectedBinding?.exchange
    && deployment.strategy_id === selectedStrategy?.id
  )) ?? deployments.find((deployment) => deployment.status === "running" && deployment.broker === selectedBinding?.exchange) ?? null;
  const matchingDeployments = deployments.filter((deployment) => deployment.broker === selectedBinding?.exchange);

  const load = async () => {
    setLoading(true);
    try {
      const [bindingResult, strategyResult, deploymentResult] = await Promise.all([
        api.listExchangeApiKeys(),
        api.listStrategies().catch(() => ({ strategies: [] as StrategyLibraryItem[] })),
        api.listLiveDeployments().catch(() => ({ deployments: [] as LiveDeployment[] })),
      ]);
      setBindings(bindingResult.bindings);
      setStrategies(strategyResult.strategies);
      setDeployments(deploymentResult.deployments);
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

  useEffect(() => {
    if (!selectedBinding) {
      setSymbolOptions([]);
      setLiveForm((current) => ({ ...current, symbols: "" }));
      return;
    }
    let cancelled = false;
    setSymbolsLoading(true);
    api.getCryptoSymbols(selectedBinding.exchange, selectedBinding.product_type)
      .then((result) => {
        if (cancelled) return;
        setSymbolOptions(result.symbols);
        setLiveForm((current) => {
          const currentSymbols = current.symbols
            .split(",")
            .map((symbol) => symbol.trim())
            .filter(Boolean);
          const available = new Set(result.symbols.map((item) => item.symbol));
          const retained = currentSymbols.filter((symbol) => available.has(symbol));
          return {
            ...current,
            symbols: retained[0] ?? result.symbols[0]?.symbol ?? "",
          };
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSymbolOptions([]);
          setLiveForm((current) => ({ ...current, symbols: "" }));
        }
      })
      .finally(() => {
        if (!cancelled) setSymbolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBinding?.exchange, selectedBinding?.product_type]);

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

  const refreshDeployments = async () => {
    try {
      const result = await api.listLiveDeployments();
      setDeployments(result.deployments);
    } catch {
      setDeployments([]);
    }
  };

  const createAndStartDeployment = async () => {
    if (!selectedBinding || !selectedStrategy) return;
    setDeploymentBusy(true);
    try {
      const symbols = liveForm.symbols
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      if (symbols.length === 0) {
        toast.error(copy.symbolsUnavailable);
        return;
      }
      const allowedSides = liveForm.allowedSides
        .split(",")
        .map((side) => side.trim().toUpperCase())
        .filter(Boolean);
      const created = await api.createLiveDeployment({
        strategy_id: selectedStrategy.id,
        broker: selectedBinding.exchange,
        interval_seconds: Number(liveForm.intervalSeconds) || 60,
        limits: {
          symbols,
          allowed_symbols: symbols,
          timeframe: liveForm.timeframe,
          allowed_sides: allowedSides,
          order_type: liveForm.orderMode,
          max_order_notional: Number(liveForm.maxOrder) || 0,
          max_total_exposure: Number(liveForm.maxExposure) || 0,
          max_leverage: Number(liveForm.maxLeverage) || 1,
          max_trades_per_day: Number(liveForm.maxTradesPerDay) || 1,
        },
      });
      await api.startLiveDeployment(created.deployment.deployment_id);
      toast.success(copy.deploymentStarted);
      await Promise.all([refreshDeployments(), refreshStatus()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start hosted live deployment");
    } finally {
      setDeploymentBusy(false);
    }
  };

  const pauseDeployment = async (deploymentId: string) => {
    setDeploymentBusy(true);
    try {
      await api.pauseLiveDeployment(deploymentId);
      toast.success(copy.deploymentPaused);
      await Promise.all([refreshDeployments(), refreshStatus()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to pause hosted live deployment");
    } finally {
      setDeploymentBusy(false);
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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-lg border bg-card p-5 shadow-sm">
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

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatusTile label={copy.auth} value={selectedBinding ? copy.configured : copy.unavailable} icon={KeyRound} active={Boolean(selectedBinding)} />
              <StatusTile label={copy.mandate} value={mandate ? (mandate.expired ? copy.expired : copy.active) : copy.noMandate} icon={ShieldCheck} active={Boolean(mandate && !mandate.expired)} />
              <StatusTile label={copy.runtime} value={brokerStatus?.runner?.alive ? copy.runnerAlive : copy.runnerStopped} icon={Activity} active={Boolean(brokerStatus?.runner?.alive)} />
              <StatusTile label={copy.market} value={brokerStatus?.halted ? copy.halted : selectedBinding?.exchange.toUpperCase() ?? "--"} icon={RadioTower} active={!brokerStatus?.halted} warning={Boolean(brokerStatus?.halted)} />
            </div>

            <div className="mt-5 border-t pt-5">
              <div className="grid gap-4 md:grid-cols-[1fr_140px_140px]">
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.symbols}</span>
                  <select
                    value={liveForm.symbols}
                    onChange={(event) => setLiveForm({ ...liveForm, symbols: event.target.value })}
                    className={fieldClass}
                    disabled={symbolsLoading || symbolOptions.length === 0}
                  >
                    {symbolsLoading && <option value="">{copy.refresh}</option>}
                    {!symbolsLoading && symbolOptions.length === 0 && <option value="">{copy.symbolsUnavailable}</option>}
                    {symbolOptions.map((symbol) => (
                      <option key={symbol.symbol} value={symbol.symbol}>
                        {symbol.display}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.interval}</span>
                  <input
                    type="number"
                    min="5"
                    max="86400"
                    value={liveForm.intervalSeconds}
                    onChange={(event) => setLiveForm({ ...liveForm, intervalSeconds: event.target.value })}
                    className={fieldClass}
                  />
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.timeframe}</span>
                  <select value={liveForm.timeframe} onChange={(event) => setLiveForm({ ...liveForm, timeframe: event.target.value })} className={fieldClass}>
                    <option value="1m">1m</option>
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                    <option value="1d">1d</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.allowedSides}</span>
                  <input value={liveForm.allowedSides} onChange={(event) => setLiveForm({ ...liveForm, allowedSides: event.target.value })} className={fieldClass} />
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.orderMode}</span>
                  <select value={liveForm.orderMode} onChange={(event) => setLiveForm({ ...liveForm, orderMode: event.target.value })} className={fieldClass}>
                    <option value="MARKET">MARKET</option>
                    <option value="LIMIT">LIMIT</option>
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.maxOrder}</span>
                  <input type="number" min="0" value={liveForm.maxOrder} onChange={(event) => setLiveForm({ ...liveForm, maxOrder: event.target.value })} className={fieldClass} />
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.exposure}</span>
                  <input type="number" min="0" value={liveForm.maxExposure} onChange={(event) => setLiveForm({ ...liveForm, maxExposure: event.target.value })} className={fieldClass} />
                </label>
                <label className="grid gap-2">
                  <span className={labelClass}>{copy.dailyCap}</span>
                  <input type="number" min="1" value={liveForm.maxTradesPerDay} onChange={(event) => setLiveForm({ ...liveForm, maxTradesPerDay: event.target.value })} className={fieldClass} />
                </label>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={checkConnection} onChange={(event) => setCheckConnection(event.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                  {copy.checkConnection}
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={activateBinding}
                    disabled={activating || !selectedBinding}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {activating ? copy.activating : copy.activate}
                  </button>
                  <button
                    type="button"
                    onClick={createAndStartDeployment}
                    disabled={deploymentBusy || !selectedBinding || !selectedStrategy}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deploymentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {deploymentBusy ? copy.creatingDeployment : copy.createAndStart}
                  </button>
                </div>
              </div>

              {statusError && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{statusError}</span>
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <section className={cn("rounded-lg border p-5 shadow-sm", brokerTone(brokerStatus))}>
              <div className="flex items-center gap-2">
                <WalletCards className="h-4 w-4" />
                <h2 className="text-base font-semibold">{copy.deploymentStatus}</h2>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <RuntimeRow label={copy.strategy} value={activeDeployment?.strategy_snapshot?.name ?? selectedStrategy?.name ?? "--"} />
                <RuntimeRow label={copy.runtime} value={activeDeployment?.status ?? copy.noDeployments} />
                <RuntimeRow label={copy.interval} value={activeDeployment?.interval_seconds ? `${activeDeployment.interval_seconds}s` : "--"} />
                <RuntimeRow label={copy.updated} value={formatDate(activeDeployment?.updated_at)} />
              </div>
            </section>

            <section className="rounded-lg border bg-card p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">{copy.risk}</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <RiskMetric label={copy.maxOrder} value={limits.max_order_notional_usd} />
                <RiskMetric label={copy.exposure} value={limits.max_total_exposure_usd} />
                <RiskMetric label={copy.leverage} value={limits.max_leverage} />
                <RiskMetric label={copy.dailyCap} value={limits.max_trades_per_day} />
              </div>
            </section>

            <section className="rounded-lg border bg-card p-5 shadow-sm">
              <h2 className="text-base font-semibold">{copy.hostedDeployment}</h2>
              <div className="mt-3 space-y-2">
                {matchingDeployments.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{copy.noDeployments}</div>
                ) : matchingDeployments.map((deployment) => (
                  <div key={deployment.deployment_id} className="rounded-md border bg-background p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{deployment.strategy_snapshot?.name ?? deployment.strategy_id}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {deployment.status} · {deployment.interval_seconds ?? "--"}s
                        </div>
                      </div>
                      {deployment.status === "running" && (
                        <button
                          type="button"
                          onClick={() => pauseDeployment(deployment.deployment_id)}
                          disabled={deploymentBusy}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deploymentBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                          {copy.pauseDeployment}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
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
