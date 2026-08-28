import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Loader2,
  Pause,
  Play,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type ExchangeApiKeyBinding,
  type QuantaxisAccountSnapshot,
  type QuantaxisDeployment,
  type QuantaxisDeploymentTarget,
  type QuantaxisRuntimeStatus,
  type StrategyLibraryItem,
} from "@/lib/api";
import { StrategyReturnChart } from "@/components/charts/StrategyReturnChart";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/translations";

const statusTone: Record<string, string> = {
  DRAFT: "border-zinc-300 bg-zinc-100 text-zinc-700",
  READY: "border-sky-300 bg-sky-50 text-sky-700",
  RUNNING: "border-emerald-300 bg-emerald-50 text-emerald-700",
  PAUSED: "border-amber-300 bg-amber-50 text-amber-700",
  STOPPED: "border-zinc-300 bg-zinc-100 text-zinc-700",
  RECOVERY_REQUIRED: "border-red-300 bg-red-50 text-red-700",
  ARCHIVED: "border-zinc-300 bg-zinc-100 text-zinc-500",
};

const testSignalLabelKeys = {
  BUY_OPEN: "deployments.testSignal.BUY_OPEN",
  SELL_CLOSE: "deployments.testSignal.SELL_CLOSE",
  SELL_OPEN: "deployments.testSignal.SELL_OPEN",
  BUY_CLOSE: "deployments.testSignal.BUY_CLOSE",
} as const satisfies Record<string, TranslationKey>;

const testSignalSizingPercents = [10, 20, 50, 100] as const;

function deploymentStatusLabel(t: (key: TranslationKey, params?: Record<string, string | number>) => string, status: string): string {
  switch (status) {
    case "DRAFT":
      return t("deployments.status.draft");
    case "READY":
      return t("deployments.status.ready");
    case "RUNNING":
      return t("deployments.status.running");
    case "PAUSED":
      return t("deployments.status.paused");
    case "STOPPED":
      return t("deployments.status.stopped");
    case "RECOVERY_REQUIRED":
      return t("deployments.status.recoveryRequired");
    case "ARCHIVED":
      return t("deployments.status.archived");
    default:
      return status;
  }
}

function deploymentTargetLabel(t: (key: TranslationKey, params?: Record<string, string | number>) => string, target: string): string {
  switch (target) {
    case "SHADOW":
      return t("deployments.target.shadow");
    case "LIVE":
      return t("deployments.target.live");
    default:
      return target;
  }
}

function streamStateLabel(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  state: "connecting" | "connected" | "reconnecting" | "closed",
): string {
  switch (state) {
    case "connecting":
      return t("deployments.stream.connecting");
    case "connected":
      return t("deployments.stream.connected");
    case "reconnecting":
      return t("deployments.stream.reconnecting");
    case "closed":
      return t("deployments.stream.closed");
  }
}

function formatDate(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCalculatedQuantity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "1";
  return String(Math.max(1, Math.floor(value)));
}

function normalizeCryptoSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[-_]/g, "/");
}

function deploymentStrategyToLibraryItem(
  deployment: QuantaxisDeployment,
  existing?: StrategyLibraryItem | null,
): StrategyLibraryItem {
  const snapshot = deployment.strategy_snapshot;
  return {
    id: snapshot.strategy_id,
    name: snapshot.name,
    description: snapshot.description,
    strategyDescription: snapshot.strategy_description,
    language: snapshot.language,
    category: snapshot.category,
    status: "draft",
    tags: [...snapshot.tags],
    code: snapshot.code,
    createdAt: existing?.createdAt || snapshot.created_at,
    updatedAt: new Date().toISOString(),
  };
}

function buildBacktestCurve(events: Record<string, unknown>[], snapshot: QuantaxisAccountSnapshot | null, fallbackTime = "") {
  const points = events
    .filter((event) => event.event_scope === "account" || event.event_type === "account.changed" || event.type === "account.changed")
    .map((event) => {
      const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? event.payload as Record<string, unknown>
        : {};
      const account = payload.snapshot && typeof payload.snapshot === "object" && !Array.isArray(payload.snapshot)
        ? payload.snapshot as Record<string, unknown>
        : payload;
      return {
        time: String(event.created_at ?? event.timestamp ?? event.time ?? event.datetime ?? ""),
        equity: numberValue(account.total_asset ?? account.total ?? account.market_value ?? account.cash),
      };
    })
    .filter((point) => point.time && Number.isFinite(point.equity));
  if (points.length > 0) return points;
  if (!snapshot) return [];
  const time = snapshot.updated_at || fallbackTime;
  if (!time) return [];
  return [{
    time,
    equity: numberValue(snapshot.total_asset ?? snapshot.market_value ?? snapshot.cash),
  }];
}

function calcMaxDrawdown(series: Array<{ equity: number }>): number {
  let peak = -Infinity;
  let minDrawdown = 0;
  for (const point of series) {
    if (!Number.isFinite(point.equity)) continue;
    peak = Math.max(peak, point.equity);
    if (!Number.isFinite(peak) || peak <= 0) continue;
    const drawdownPct = ((point.equity - peak) / peak) * 100;
    minDrawdown = Math.min(minDrawdown, drawdownPct);
  }
  return minDrawdown;
}

function calcSimpleMetrics(curve: Array<{ equity: number }>, initialCapital: number) {
  const last = curve[curve.length - 1]?.equity ?? initialCapital;
  const totalReturnPct = initialCapital > 0 ? ((last - initialCapital) / initialCapital) * 100 : 0;
  const maxDrawdownPct = calcMaxDrawdown(curve);
  return {
    totalReturnPct,
    annualizedReturnPct: totalReturnPct,
    maxDrawdownPct,
    sharpe: 0,
    winRatePct: 0,
    tradeCount: 0,
  };
}

function eventTimestamp(item: Record<string, unknown>): string {
  return compactValue(item.created_at ?? item.timestamp ?? item.time ?? item.datetime);
}

function deploymentMessage(
  value: unknown,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const text = compactValue(value);
  if (
    text.startsWith("QIFI order quantity must")
    || text === "quantity is below the QIFI minimum executable lot; execution skipped"
  ) {
    return t("deployments.execution.skippedMinLot");
  }
  if (
    text === "strategy order intent exceeds deployment max_order_notional"
    || text === "order notional exceeds deployment max_order_notional; execution skipped"
  ) {
    return t("deployments.testSignal.exceedsMaxNotional");
  }
  return text;
}

function eventPayload(item: Record<string, unknown>): Record<string, unknown> {
  return item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
    ? item.payload as Record<string, unknown>
    : item.payload_json && typeof item.payload_json === "object" && !Array.isArray(item.payload_json)
      ? item.payload_json as Record<string, unknown>
      : item;
}

function eventTypeLabel(
  item: Record<string, unknown>,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const type = compactValue(item.event_type ?? item.type ?? item.action ?? item.status ?? item.order_id ?? item.trade_id);
  switch (type) {
    case "order.skipped":
      return t("deployments.execution.skipped");
    case "order.changed":
      return t("deployments.execution.orderUpdated");
    case "trade.created":
      return t("deployments.execution.tradeCreated");
    case "strategy.signal":
      return t("deployments.execution.signalGenerated");
    case "market.event":
      return t("deployments.execution.marketReceived");
    case "--":
      return "";
    default:
      return type;
  }
}

function eventSummary(
  item: Record<string, unknown>,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const payload = eventPayload(item);
  const parts = [
    payload.message,
    payload.reason,
    payload.error,
    payload.symbol,
    payload.action,
    payload.status,
  ].filter((value) => value !== undefined && value !== null && value !== "").map((value) => deploymentMessage(value, t));
  return parts.length ? parts.join(" · ") : JSON.stringify(item, null, 2);
}

function parseRiskPolicy(
  value: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("deployments.promote.invalidRiskPolicy"));
  }
  return parsed as Record<string, unknown>;
}

function RuntimeBanner({ runtime, loading }: { runtime: QuantaxisRuntimeStatus | null; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("deployments.runtime.loading")}
      </div>
    );
  }
  if (!runtime) return null;
  const available = runtime.available;
  return (
    <div className={cn(
      "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
      available ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800",
    )}>
      <div className="flex items-center gap-2">
        {available ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        <span>
          {available
            ? t("deployments.runtime.available")
            : t("deployments.runtime.unavailable", { reason: runtime.error || t("deployments.runtime.notConfigured") })}
        </span>
      </div>
      <span className="font-mono text-xs">v{runtime.version || "--"}</span>
    </div>
  );
}

function LiveReadinessPanel({
  deployment,
  runtime,
  selectedBinding,
}: {
  deployment: QuantaxisDeployment;
  runtime: QuantaxisRuntimeStatus | null;
  selectedBinding: ExchangeApiKeyBinding | null;
}) {
  const { t } = useTranslation();
  const isLive = deployment.target === "LIVE";
  const states = [
    {
      label: t("deployments.readiness.brokerBinding"),
      ok: Boolean(selectedBinding),
      detail: selectedBinding
        ? `${selectedBinding.exchange} · ${selectedBinding.label || selectedBinding.binding_id}`
        : t("deployments.readiness.selectBinding"),
    },
    {
      label: t("deployments.readiness.mandate"),
      ok: isLive ? deployment.status !== "RECOVERY_REQUIRED" : true,
      detail: isLive ? t("deployments.readiness.mandateLive") : t("deployments.readiness.mandatePromo"),
    },
    {
      label: t("deployments.readiness.reconciliation"),
      ok: isLive ? runtime?.available !== false : true,
      detail: isLive
        ? (runtime?.available
          ? t("deployments.readiness.reconciliationLive")
          : t("deployments.readiness.reconciliationBlocked"))
        : t("deployments.readiness.reconciliationPromo"),
    },
  ];

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{isLive ? t("deployments.readiness.live") : t("deployments.readiness.promotion")}</h2>
      <div className="mt-3 space-y-2">
        {states.map((item) => (
          <div key={item.label} className="flex items-start gap-2 rounded-md border bg-background p-3 text-xs">
            {item.ok ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
            )}
            <div className="min-w-0">
              <div className="font-semibold">{item.label}</div>
              <div className="mt-0.5 text-muted-foreground">{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeploymentCard({
  deployment,
}: {
  deployment: QuantaxisDeployment;
}) {
  const { t } = useTranslation();
  const Icon = deployment.target === "LIVE" ? RadioTower : WalletCards;
  return (
    <Link
      to={`/deployments/${encodeURIComponent(deployment.deployment_id)}`}
      className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <h2 className="truncate text-sm font-semibold">{deployment.strategy_snapshot.name || deployment.strategy_snapshot.strategy_id}</h2>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{deployment.deployment_id}</span>
            <span>{deploymentTargetLabel(t, deployment.target)}</span>
            <span>{deployment.market}</span>
            <span>{deployment.timeframe}</span>
          </div>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", statusTone[deployment.status] ?? statusTone.DRAFT)}>
          {deploymentStatusLabel(t, deployment.status)}
        </span>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {deployment.symbols.join(", ") || "--"} · {t("deployments.updated")} {formatDate(deployment.updated_at)}
      </div>
    </Link>
  );
}

function qifiConfigMessage(
  runtime: QuantaxisRuntimeStatus | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (!runtime) return "";
  const requires = runtime.requires ?? {};
  if (runtime.durable_store_configured === false || !requires.mongo || !requires.qifi_password) {
    const missing = [
      !requires.mongo ? "QUANTAXIS_MONGOURI" : "",
      !requires.qifi_password ? "VIBE_QUANTAXIS_QIFI_PASSWORD" : "",
    ].filter(Boolean);
    return t("deployments.qifi.configuring", { missing: missing.join(", ") });
  }
  return "";
}

function AccountPanel({
  deployment,
  runtime,
  runtimeLoading,
  onLoaded,
}: {
  deployment: QuantaxisDeployment;
  runtime: QuantaxisRuntimeStatus | null;
  runtimeLoading: boolean;
  onLoaded?: (snapshot: QuantaxisAccountSnapshot | null, orders: Record<string, unknown>[], trades: Record<string, unknown>[]) => void;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<QuantaxisAccountSnapshot | null>(null);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [trades, setTrades] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const configMessage = qifiConfigMessage(runtime, t);

  const load = useCallback(async () => {
    if (runtimeLoading) {
      return;
    }
    if (configMessage) {
      setSnapshot(null);
      setOrders([]);
      setTrades([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [snapshotResult, orderResult, tradeResult] = await Promise.all([
        api.getQuantaxisAccountSnapshot(deployment.account_cookie),
        api.listQuantaxisAccountOrders(deployment.account_cookie),
        api.listQuantaxisAccountTrades(deployment.account_cookie),
      ]);
      setSnapshot(snapshotResult);
      setOrders(orderResult.orders as unknown as Record<string, unknown>[]);
      setTrades(tradeResult.trades as unknown as Record<string, unknown>[]);
      onLoaded?.(snapshotResult, orderResult.orders as unknown as Record<string, unknown>[], tradeResult.trades as unknown as Record<string, unknown>[]);
    } catch (err) {
      setSnapshot(null);
      setOrders([]);
      setTrades([]);
      onLoaded?.(null, [], []);
      setError(err instanceof Error ? err.message : t("deployments.qifi.snapshotUnavailable"));
    } finally {
      setLoading(false);
    }
  }, [configMessage, deployment.account_cookie, onLoaded, runtimeLoading, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("deployments.qifi.accountTitle")}</h2>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{deployment.account_cookie}</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          {t("deployments.refresh")}
        </button>
      </div>
      {runtimeLoading ? (
        <div className="mt-4 rounded-md border bg-background p-3 text-sm text-muted-foreground">
          {t("deployments.qifi.loading")}
        </div>
      ) : configMessage ? (
        <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          {configMessage}
        </div>
      ) : error ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
        </div>
      ) : snapshot ? (
      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
            {([
              ["cash", t("deployments.qifi.cash")],
              ["frozen", t("deployments.qifi.frozen")],
              ["market_value", t("deployments.qifi.marketValue")],
              ["total_asset", t("deployments.qifi.totalAsset")],
            ] as Array<[keyof Pick<QuantaxisAccountSnapshot, "cash" | "frozen" | "market_value" | "total_asset">, string]>).map(([key, label]) => (
              <div key={key} className="rounded-md border bg-background p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 font-mono text-sm">{String(snapshot[key] ?? "--")}</div>
              </div>
            ))}
          </div>
          <ProjectionList title={t("deployments.qifi.orders")} items={orders} emptyMessage={t("deployments.qifi.empty")} />
          <ProjectionList title={t("deployments.qifi.trades")} items={trades} emptyMessage={t("deployments.qifi.empty")} />
        </div>
      ) : null}
    </section>
  );
}

function ProjectionList({
  title,
  items,
  error,
  emptyMessage = "",
}: {
  title: string;
  items: Record<string, unknown>[];
  error?: string;
  emptyMessage?: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
      </div>
      {error ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{deploymentMessage(error, t)}</div>
      ) : items.length ? (
        <div className="mt-3 space-y-2">
          {items.slice(-8).reverse().map((item, index) => {
            const type = eventTypeLabel(item, t) || compactValue(`record-${index + 1}`);
            const sequence = item.sequence_no === undefined ? "" : `#${compactValue(item.sequence_no)}`;
            return (
              <div key={String(item.event_id ?? item.order_id ?? item.trade_id ?? item.signal_id ?? index)} className="rounded-md border bg-background p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{type}</div>
                    <div className="mt-1 line-clamp-2 break-words text-muted-foreground">{eventSummary(item, t)}</div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                    <div>{sequence}</div>
                    <div>{eventTimestamp(item)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-md border bg-background p-4 text-sm text-muted-foreground">{emptyMessage || t("deployments.qifi.empty")}</div>
      )}
    </section>
  );
}

function DeploymentRunSummary({
  deployment,
  streamState,
  signals,
  events,
}: {
  deployment: QuantaxisDeployment;
  streamState: "connecting" | "connected" | "reconnecting" | "closed";
  signals: Record<string, unknown>[];
  events: Record<string, unknown>[];
}) {
  const { t } = useTranslation();
  const latestEvent = events.length ? events[events.length - 1] : null;
  const latestSignal = signals.length ? signals[signals.length - 1] : null;
  const latestOrderEvent = [...events].reverse().find((event) => {
    const type = compactValue(event.event_type ?? event.type);
    return type.startsWith("order.");
  });
  const latestOrderPayload = latestOrderEvent ? eventPayload(latestOrderEvent) : {};
  const executionSkipped = compactValue(latestOrderEvent?.event_type ?? latestOrderEvent?.type) === "order.skipped";
  const summaryCards = [
    {
      label: t("deployments.summary.runningStrategy"),
      value: `${deployment.symbols.join(", ") || "--"} · ${deployment.timeframe}`,
      detail: `${deployment.strategy_snapshot.name || deployment.strategy_snapshot.strategy_id} · ${deployment.market}`,
      icon: Activity,
    },
    {
      label: t("deployments.summary.eventStream"),
      value: streamStateLabel(t, streamState),
      detail: events.length
        ? t("deployments.summary.eventsLoaded", { count: events.length })
        : t("deployments.summary.waitingFirstEvent"),
      icon: RadioTower,
    },
    {
      label: t("deployments.summary.latestEvent"),
      value: latestEvent ? eventTypeLabel(latestEvent, t) || compactValue(latestEvent.event_type ?? latestEvent.type) : t("deployments.summary.noEventYet"),
      detail: latestEvent ? eventSummary(latestEvent, t) : t("deployments.summary.latestEventDetail"),
      icon: Clock3,
    },
    {
      label: t("deployments.summary.latestSignal"),
      value: latestSignal ? compactValue(latestSignal.action ?? latestSignal.signal ?? latestSignal.status ?? t("deployments.summary.signal")) : t("deployments.summary.noSignalYet"),
      detail: latestSignal ? eventSummary(latestSignal, t) : t("deployments.summary.latestSignalDetail"),
      icon: ClipboardList,
    },
  ];

  return (
    <section className="space-y-3">
      {executionSkipped ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold">{t("deployments.execution.skipped")}</div>
              <div className="mt-1 text-amber-800">{deploymentMessage(latestOrderPayload.reason, t)}</div>
              <div className="mt-1 text-xs text-amber-800">{t("deployments.execution.skippedMinLotAction")}</div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {card.label}
              </div>
              <div className="mt-2 truncate text-sm font-semibold">{card.value}</div>
              <div className="mt-1 line-clamp-2 min-h-8 text-xs text-muted-foreground">{card.detail}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RuntimeProjectionPanel({
  deployment,
  runtime,
  runtimeLoading,
  onLoaded,
}: {
  deployment: QuantaxisDeployment;
  runtime: QuantaxisRuntimeStatus | null;
  runtimeLoading: boolean;
  onLoaded?: (signals: Record<string, unknown>[], events: Record<string, unknown>[]) => void;
}) {
  const [signals, setSignals] = useState<Record<string, unknown>[]>([]);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [signalsError, setSignalsError] = useState("");
  const [eventsError, setEventsError] = useState("");
  const [streamState, setStreamState] = useState<"connecting" | "connected" | "reconnecting" | "closed">("connecting");
  const { t } = useTranslation();
  const configMessage = qifiConfigMessage(runtime, t);

  const load = useCallback(async () => {
    if (runtimeLoading || configMessage) {
      setSignals([]);
      setEvents([]);
      setSignalsError("");
      setEventsError("");
      return;
    }
    setSignalsError("");
    setEventsError("");
    api.listDeploymentSignals(deployment.deployment_id)
        .then((result) => {
          setSignals(result.signals);
          onLoaded?.(result.signals, events);
        })
        .catch((error) => {
          setSignals([]);
        setSignalsError(error instanceof Error ? error.message : t("deployments.signalsUnavailable"));
        });
    api.listDeploymentEvents(deployment.deployment_id)
        .then((result) => {
          setEvents(result.events);
          onLoaded?.(signals, result.events);
        })
        .catch((error) => {
          setEvents([]);
        setEventsError(error instanceof Error ? error.message : t("deployments.eventsUnavailable"));
        });
  }, [configMessage, deployment.deployment_id, onLoaded, runtimeLoading, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (runtimeLoading || configMessage) {
      setStreamState("closed");
      return;
    }
    setStreamState("connecting");
    const maxSequence = events.reduce((max, event) => Math.max(max, Number(event.sequence_no) || 0), 0);
    const source = new EventSource(api.deploymentEventsSseUrl(deployment.deployment_id, maxSequence));
    source.addEventListener("open", () => {
      setStreamState("connected");
      setEventsError("");
    });
    source.addEventListener("deployment.event", (message) => {
      try {
        const event = JSON.parse((message as MessageEvent).data) as Record<string, unknown>;
        setEvents((current) => {
          const eventId = String(event.event_id || "");
          if (eventId && current.some((item) => String(item.event_id || "") === eventId)) return current;
          return [...current, event].slice(-200);
        });
      } catch {
        setEventsError(t("deployments.eventsParseFailed"));
      }
    });
    source.addEventListener("deployment.error", (message) => {
      try {
        const payload = JSON.parse((message as MessageEvent).data) as { error?: string };
        setEventsError(deploymentMessage(payload.error || t("deployments.stream.failed"), t));
      } catch {
        setEventsError(t("deployments.stream.failed"));
      }
    });
    source.onerror = () => {
      setStreamState("reconnecting");
      void load();
    };
    return () => {
      setStreamState("closed");
      source.close();
    };
  }, [configMessage, deployment.deployment_id, onLoaded, runtimeLoading]);

  return (
    <div className="space-y-3">
      <DeploymentRunSummary deployment={deployment} streamState={streamState} signals={signals} events={events} />
      <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
        {t("deployments.stream.label")}: <span className="font-semibold text-foreground">{streamStateLabel(t, streamState)}</span>
      </div>
      {runtimeLoading ? (
        <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
          {t("deployments.signalsLoading")}
        </div>
      ) : configMessage ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          {configMessage}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProjectionList
          title={t("deployments.signalsTitle")}
          items={signals}
          error={signalsError}
          emptyMessage={t("deployments.signalsEmpty")}
        />
        <ProjectionList
          title={t("deployments.eventsTitle")}
          items={events}
          error={eventsError}
          emptyMessage={t("deployments.eventsEmpty")}
        />
      </div>
    </div>
  );
}

export function Deployments() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const deploymentId = params.deploymentId ?? "";
  const filterTarget = (searchParams.get("target") || "").toUpperCase() as QuantaxisDeploymentTarget | "";
  const [runtime, setRuntime] = useState<QuantaxisRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [deployments, setDeployments] = useState<QuantaxisDeployment[]>([]);
  const [selected, setSelected] = useState<QuantaxisDeployment | null>(null);
  const [bindings, setBindings] = useState<ExchangeApiKeyBinding[]>([]);
  const [strategiesById, setStrategiesById] = useState<Record<string, StrategyLibraryItem>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [deleteDeploymentTarget, setDeleteDeploymentTarget] = useState("");
  const [promoteBindingId, setPromoteBindingId] = useState("");
  const [recoveryBindingId, setRecoveryBindingId] = useState("");
  const [promoteRisk, setPromoteRisk] = useState("{}");
  const [promoteConsent, setPromoteConsent] = useState(false);
  const [analysisSnapshot, setAnalysisSnapshot] = useState<QuantaxisAccountSnapshot | null>(null);
  const [analysisOrders, setAnalysisOrders] = useState<Record<string, unknown>[]>([]);
  const [analysisTrades, setAnalysisTrades] = useState<Record<string, unknown>[]>([]);
  const [analysisSignals, setAnalysisSignals] = useState<Record<string, unknown>[]>([]);
  const [analysisEvents, setAnalysisEvents] = useState<Record<string, unknown>[]>([]);
  const [testSignalSymbol, setTestSignalSymbol] = useState("");
  const [testSignalQuantity, setTestSignalQuantity] = useState("1");
  const [testSignalPrice, setTestSignalPrice] = useState("");
  const testSignalPriceRequestRef = useRef(0);

  const copy = useMemo(() => ({
    title: t("deployments.title"),
    subtitle: t("deployments.subtitle"),
    empty: t("deployments.empty"),
    back: t("deployments.back"),
  }), [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [deploymentResult, bindingResult, strategyResult] = await Promise.all([
        api.listDeployments(),
        api.listExchangeApiKeys().catch(() => ({ bindings: [] as ExchangeApiKeyBinding[] })),
        api.listStrategies().catch(() => ({ strategies: [] as StrategyLibraryItem[] })),
      ]);
      setDeployments(deploymentResult.deployments);
      setBindings(bindingResult.bindings);
      setStrategiesById(Object.fromEntries(strategyResult.strategies.map((strategy) => [strategy.id, strategy])));
      const current = deploymentId
        ? deploymentResult.deployments.find((item) => item.deployment_id === deploymentId) ?? null
        : null;
      setSelected(current);
      if (deploymentId && !current) {
        api.getDeployment(deploymentId).then((result) => setSelected(result.deployment)).catch(() => undefined);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("deployments.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [deploymentId, t]);

  const loadRuntime = useCallback(async () => {
    setRuntimeLoading(true);
    try {
      setRuntime(await api.getQuantaxisRuntime());
    } catch (error) {
      setRuntime({
        available: false,
        version: "",
        quantaxis_path: "",
        runtime_home: "",
        modules: {},
        requires: {},
        error: error instanceof Error ? error.message : t("deployments.runtime.statusUnavailable"),
      });
    } finally {
      setRuntimeLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    void loadRuntime();
  }, [load, loadRuntime]);

  const visibleDeployments = useMemo(() => {
    const list = filterTarget === "SHADOW" || filterTarget === "LIVE"
      ? deployments.filter((item) => item.target === filterTarget)
      : deployments;
    const filtered = loading
      ? list
      : list.filter((item) => {
        if (item.status === "ARCHIVED") return false;
        return item.target !== "SHADOW" || Boolean(strategiesById[item.strategy_snapshot.strategy_id]);
      });
    return [...filtered].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [deployments, filterTarget, loading, strategiesById]);

  const selectedBinding = useMemo(() => {
    if (!selected) return null;
    const wanted = promoteBindingId || (selected.broker_binding_id ? String(selected.broker_binding_id) : "");
    if (!wanted) return null;
    return bindings.find((binding) => String(binding.binding_id) === wanted) ?? null;
  }, [bindings, selected, promoteBindingId]);

  const selectedStrategy = useMemo(() => {
    if (!selected) return null;
    return strategiesById[selected.strategy_snapshot.strategy_id] ?? null;
  }, [selected, strategiesById]);

  useEffect(() => {
    if (loading || !selected || selected.target !== "SHADOW") return;
    if (!strategiesById[selected.strategy_snapshot.strategy_id]) {
      navigate("/deployments?target=SHADOW", { replace: true });
    }
  }, [loading, navigate, selected, strategiesById]);

  const handleRestoreStrategy = useCallback(async () => {
    if (!selected) return;
    const strategyId = selected.strategy_snapshot.strategy_id;
    const current = selectedStrategy ?? null;
    setBusy(`restore:${strategyId}`);
    try {
      await api.upsertStrategy(deploymentStrategyToLibraryItem(selected, current));
      toast.success(t("deployments.strategyActions.restoreSuccess"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("deployments.strategyActions.restoreFailed"));
    } finally {
      setBusy("");
    }
  }, [load, selected, selectedStrategy, t]);

  const handlePromptDeleteDeployment = useCallback(() => {
    if (!selected) return;
    setDeleteDeploymentTarget(selected.deployment_id);
  }, [selected]);

  const handleDeleteDeployment = useCallback(async () => {
    if (!selected) return;
    const deploymentId = selected.deployment_id;
    setBusy(`delete:${deploymentId}`);
    try {
      await api.archiveDeployment(deploymentId);
      toast.success(t("deployments.strategyActions.deleteSuccess"));
      navigate(`/deployments?target=${encodeURIComponent(selected.target)}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        toast.success(t("deployments.strategyActions.deleteSuccess"));
      } else {
        toast.error(error instanceof Error ? error.message : t("deployments.strategyActions.deleteFailed"));
      }
    } finally {
      setDeleteDeploymentTarget("");
      await load();
      setBusy("");
    }
  }, [load, navigate, selected, t]);

  const handleAccountLoaded = useCallback((snapshot: QuantaxisAccountSnapshot | null, orders: Record<string, unknown>[], trades: Record<string, unknown>[]) => {
    setAnalysisSnapshot(snapshot);
    setAnalysisOrders(orders);
    setAnalysisTrades(trades);
  }, []);

  const handleProjectionLoaded = useCallback((signals: Record<string, unknown>[], events: Record<string, unknown>[]) => {
    setAnalysisSignals(signals);
    setAnalysisEvents(events);
  }, []);

  const analysisCurve = useMemo(
    () => buildBacktestCurve(analysisEvents, analysisSnapshot, selected?.updated_at ?? ""),
    [analysisEvents, analysisSnapshot, selected?.updated_at],
  );
  const analysisMetrics = useMemo(() => calcSimpleMetrics(analysisCurve, analysisCurve[0]?.equity || 0), [analysisCurve]);
  const analysisSummary = useMemo(() => ({
    signals: analysisSignals.length,
    events: analysisEvents.length,
    orders: analysisOrders.length,
    trades: analysisTrades.length,
  }), [analysisSignals.length, analysisEvents.length, analysisOrders.length, analysisTrades.length]);

  const recoveryBinding = useMemo(() => {
    if (!selected) return null;
    const wanted = recoveryBindingId || promoteBindingId || (selected.broker_binding_id ? String(selected.broker_binding_id) : "");
    if (!wanted) return null;
    return bindings.find((binding) => String(binding.binding_id) === wanted) ?? null;
  }, [bindings, promoteBindingId, recoveryBindingId, selected]);

  const applyAction = async (action: "ready" | "start" | "pause" | "stop" | "archive") => {
    if (!selected) return;
    setBusy(action);
    try {
      const result = await ({
        ready: api.readyDeployment,
        start: api.startDeployment,
        pause: api.pauseDeployment,
        stop: api.stopDeployment,
        archive: api.archiveDeployment,
      }[action])(selected.deployment_id);
      setSelected(result.deployment);
      setDeployments((current) => current.map((item) => item.deployment_id === result.deployment.deployment_id ? result.deployment : item));
      toast.success(t(`deployments.action.${action}Accepted`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(`deployments.action.${action}Failed`));
    } finally {
      setBusy("");
    }
  };

  const promote = async () => {
    if (!selected || !promoteBindingId) return;
    setBusy("promote");
    try {
      const result = await api.promoteDeployment(selected.deployment_id, {
        broker_binding_id: Number(promoteBindingId),
        risk_policy: parseRiskPolicy(promoteRisk, t),
      });
      toast.success(t("deployments.promote.success"));
      navigate(`/deployments/${encodeURIComponent(result.deployment.deployment_id)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("deployments.promote.failed"));
    } finally {
      setBusy("");
    }
  };

  const recover = async () => {
    if (!selected) return;
    if (selected.target === "LIVE" && !recoveryBinding) return;
    setBusy("recover");
    try {
      const result = await api.recoverDeployment(
        selected.deployment_id,
        selected.target === "LIVE" && recoveryBinding ? { broker: recoveryBinding.exchange } : {},
      );
      setSelected(result.deployment);
      setDeployments((current) => current.map((item) => item.deployment_id === result.deployment.deployment_id ? result.deployment : item));
      toast.success(t("deployments.recovery.success"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("deployments.recovery.failed"));
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (!selected || testSignalSymbol) return;
    setTestSignalSymbol(selected.symbols[0] || "");
  }, [selected, testSignalSymbol]);

  const testSignalMaxNotional = Number(selected?.risk_policy?.max_order_notional);
  const testSignalPriceValue = Number(testSignalPrice);
  const testSignalQuantityValue = Number(testSignalQuantity);
  const testSignalExceedsMaxNotional = Boolean(
    selected?.target === "SHADOW"
    && Number.isFinite(testSignalMaxNotional)
    && testSignalMaxNotional > 0
    && Number.isFinite(testSignalPriceValue)
    && testSignalPriceValue > 0
    && Number.isFinite(testSignalQuantityValue)
    && testSignalQuantityValue > 0
    && testSignalQuantityValue * testSignalPriceValue > testSignalMaxNotional,
  );

  useEffect(() => {
    if (!selected || selected.target !== "SHADOW") return;
    setTestSignalQuantity("1");
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const marketSymbol = normalizeCryptoSymbol(testSignalSymbol || selected.symbols[0] || "");
    if (!marketSymbol) return;

    const requestVersion = testSignalPriceRequestRef.current + 1;
    testSignalPriceRequestRef.current = requestVersion;

    void api.getCryptoKlines(marketSymbol, "5m", 2)
      .then((payload) => {
        if (testSignalPriceRequestRef.current !== requestVersion) return;
        const latestClose = payload.bars[payload.bars.length - 1]?.close;
        if (Number.isFinite(latestClose) && Number(latestClose) > 0) {
          setTestSignalPrice(String(latestClose));
        }
      })
      .catch(() => {
        if (testSignalPriceRequestRef.current === requestVersion) {
          setTestSignalPrice("");
        }
      });
  }, [selected, testSignalSymbol]);

  const submitTestSignal = async (signalType: "BUY_OPEN" | "SELL_CLOSE" | "SELL_OPEN" | "BUY_CLOSE") => {
    if (!selected) return;
    const symbol = (testSignalSymbol || selected.symbols[0] || "").trim();
    const quantity = Number(testSignalQuantity);
    const price = Number(testSignalPrice);
    if (!symbol || !Number.isFinite(quantity) || quantity < 1 || !Number.isInteger(quantity) || !Number.isFinite(price) || price <= 0) {
      toast.error(t("deployments.testSignal.invalid"));
      return;
    }
    const maxNotional = Number(selected.risk_policy?.max_order_notional);
    if (Number.isFinite(maxNotional) && maxNotional > 0 && quantity * price > maxNotional) {
      toast.error(t("deployments.testSignal.exceedsMaxNotional"));
      return;
    }
    setBusy(`test-${signalType}`);
    try {
      await api.submitDeploymentTestSignal(selected.deployment_id, {
        signal_type: signalType,
        symbol,
        quantity,
        price,
      });
      toast.success(t("deployments.testSignal.success"));
      await load();
      setAnalysisSnapshot(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("deployments.testSignal.failed"));
    } finally {
      setBusy("");
    }
  };

  const applyTestSignalSizing = (percent: number) => {
    if (!selected) return;
    const maxNotional = Number(selected.risk_policy?.max_order_notional);
    const price = Number(testSignalPrice);
    if (!Number.isFinite(maxNotional) || maxNotional <= 0 || !Number.isFinite(price) || price <= 0) {
      toast.error(t("deployments.testSignal.sizingUnavailable"));
      return;
    }
    if (price > maxNotional) {
      toast.error(t("deployments.testSignal.minLotUnavailable"));
      return;
    }
    const targetNotional = (maxNotional * percent) / 100;
    setTestSignalQuantity(formatCalculatedQuantity(targetNotional / price));
  };

  if (!deploymentId) {
    return (
      <main className="min-h-full bg-background">
        <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
            <div>
              <h1 className="text-2xl font-semibold">{copy.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
            </div>
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              {t("deployments.refresh")}
            </button>
          </header>
          <RuntimeBanner runtime={runtime} loading={runtimeLoading} />
          {visibleDeployments.length ? (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleDeployments.map((deployment) => {
                return (
                  <DeploymentCard
                    key={deployment.deployment_id}
                    deployment={deployment}
                  />
                );
              })}
            </section>
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">{copy.empty}</div>
          )}
        </div>
      </main>
    );
  }

  const deployment = selected;
  return (
    <main className="min-h-full bg-background">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <Link to="/deployments" className="text-sm font-medium text-primary hover:underline">{copy.back}</Link>
        <RuntimeBanner runtime={runtime} loading={runtimeLoading} />
        {!deployment ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            {loading ? t("deployments.loadingDeployment") : t("deployments.notFound")}
          </div>
        ) : (
          <>
            <section className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {deployment.target === "LIVE" ? <RadioTower className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}
                    {deploymentTargetLabel(t, deployment.target)} · {deployment.market} · {deployment.timeframe}
                  </div>
                  <h1 className="mt-1 truncate text-2xl font-semibold">{deployment.strategy_snapshot.name || deployment.strategy_snapshot.strategy_id}</h1>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{deployment.deployment_id}</p>
                </div>
                <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone[deployment.status] ?? statusTone.DRAFT)}>
                  {deploymentStatusLabel(t, deployment.status)}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy === "ready" || deployment.status !== "DRAFT"} onClick={() => void applyAction("ready")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <ShieldCheck className="h-3.5 w-3.5" /> {t("deployments.action.ready")}
                </button>
                <button type="button" disabled={Boolean(busy) || !["READY", "PAUSED"].includes(deployment.status)} onClick={() => void applyAction("start")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <Play className="h-3.5 w-3.5" /> {t("deployments.action.start")}
                </button>
                <button type="button" disabled={Boolean(busy) || deployment.status !== "RUNNING"} onClick={() => void applyAction("pause")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <Pause className="h-3.5 w-3.5" /> {t("deployments.action.pause")}
                </button>
                <button type="button" disabled={Boolean(busy) || !["READY", "RUNNING", "PAUSED"].includes(deployment.status)} onClick={() => void applyAction("stop")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <Square className="h-3.5 w-3.5" /> {t("deployments.action.stop")}
                </button>
                <button type="button" disabled={Boolean(busy) || deployment.status === "RUNNING" || deployment.status === "ARCHIVED"} onClick={() => void applyAction("archive")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <Archive className="h-3.5 w-3.5" /> {t("deployments.action.archive")}
                </button>
                {deployment.target === "SHADOW" ? (
                  <div className="ml-auto flex flex-wrap gap-2">
                    {selectedStrategy?.status === "archived" ? (
                      <button
                        type="button"
                        disabled={busy === `restore:${deployment.strategy_snapshot.strategy_id}`}
                        onClick={() => void handleRestoreStrategy()}
                        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-xs font-semibold transition hover:bg-muted disabled:opacity-50"
                      >
                        {busy === `restore:${deployment.strategy_snapshot.strategy_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                        {t("deployments.strategyActions.restore")}
                      </button>
                    ) : null}
                    {!selectedStrategy ? (
                      <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                        {t("deployments.strategyActions.missing")}
                      </div>
                    ) : null}
                    {deleteDeploymentTarget === deployment.deployment_id ? (
                      <div className="inline-flex items-center overflow-hidden rounded-md border border-destructive/30 bg-destructive/5">
                        <button
                          type="button"
                          disabled={busy === `delete:${deployment.deployment_id}`}
                          onClick={() => void handleDeleteDeployment()}
                          className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-destructive disabled:opacity-50"
                        >
                          {busy === `delete:${deployment.deployment_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {t("deployments.strategyActions.confirm")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteDeploymentTarget("")}
                          className="border-l px-2 py-2 text-xs font-semibold text-muted-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(busy) || deployment.status === "RUNNING" || deployment.status === "ARCHIVED"}
                        onClick={() => void handlePromptDeleteDeployment()}
                        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("deployments.strategyActions.delete")}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <section className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{t("deployments.analysis.title")}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{t("deployments.analysis.subtitle")}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="rounded-md border bg-background px-2 py-1">{t("deployments.analysis.signals", { count: analysisSummary.signals })}</span>
                      <span className="rounded-md border bg-background px-2 py-1">{t("deployments.analysis.events", { count: analysisSummary.events })}</span>
                      <span className="rounded-md border bg-background px-2 py-1">{t("deployments.analysis.trades", { count: analysisSummary.trades })}</span>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">{t("deployments.analysis.startEquity")}</div>
                      <div className="mt-1 font-mono text-sm">{analysisCurve[0]?.equity?.toFixed(2) ?? "--"}</div>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">{t("deployments.analysis.endEquity")}</div>
                      <div className="mt-1 font-mono text-sm">{analysisCurve[analysisCurve.length - 1]?.equity?.toFixed(2) ?? "--"}</div>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">{t("deployments.analysis.totalReturn")}</div>
                      <div className="mt-1 font-mono text-sm">{analysisMetrics.totalReturnPct.toFixed(2)}%</div>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">{t("deployments.analysis.maxDrawdown")}</div>
                      <div className="mt-1 font-mono text-sm">{analysisMetrics.maxDrawdownPct.toFixed(2)}%</div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-md border bg-background p-2">
                    {analysisCurve.length > 0 ? (
                      <StrategyReturnChart data={analysisCurve.map((point) => ({ time: point.time, equity: point.equity, drawdown: 0 }))} initialCapital={analysisCurve[0]?.equity || 1} height={260} />
                    ) : (
                      <div className="p-4 text-sm text-muted-foreground">{t("deployments.analysis.noSeries")}</div>
                    )}
                  </div>
                </section>
                <AccountPanel
                  deployment={deployment}
                  runtime={runtime}
                  runtimeLoading={runtimeLoading}
                  onLoaded={handleAccountLoaded}
                />
                <RuntimeProjectionPanel
                  deployment={deployment}
                  runtime={runtime}
                  runtimeLoading={runtimeLoading}
                  onLoaded={handleProjectionLoaded}
                />
              </div>
              <aside className="space-y-4">
                {deployment.target === "SHADOW" ? (
                  <section className="rounded-lg border bg-card p-4">
                    <h2 className="text-sm font-semibold">{t("deployments.testSignal.title")}</h2>
                    <div className="mt-3 grid gap-3">
                      <label className="block text-xs font-semibold text-muted-foreground">
                        {t("deployments.testSignal.symbol")}
                        <input
                          value={testSignalSymbol}
                          onChange={(event) => setTestSignalSymbol(event.target.value)}
                          className="mt-1 h-10 w-full rounded-md border bg-background px-3 font-mono text-sm"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs font-semibold text-muted-foreground">
                          {t("deployments.testSignal.quantity")}
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={testSignalQuantity}
                            onChange={(event) => setTestSignalQuantity(event.target.value)}
                            className="mt-1 h-10 w-full rounded-md border bg-background px-3 font-mono text-sm"
                          />
                        </label>
                        <label className="block text-xs font-semibold text-muted-foreground">
                          {t("deployments.testSignal.price")}
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={testSignalPrice}
                            onChange={(event) => setTestSignalPrice(event.target.value)}
                            className="mt-1 h-10 w-full rounded-md border bg-background px-3 font-mono text-sm"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-4 gap-2" aria-label={t("deployments.testSignal.sizing")}>
                        {testSignalSizingPercents.map((percent) => (
                          <button
                            key={percent}
                            type="button"
                            onClick={() => applyTestSignalSizing(percent)}
                            className="inline-flex items-center justify-center rounded-md border px-2 py-2 text-xs font-semibold hover:bg-muted"
                          >
                            {percent}%
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {(["BUY_OPEN", "SELL_CLOSE", "SELL_OPEN", "BUY_CLOSE"] as const).map((signalType) => (
                          <button
                            key={signalType}
                            type="button"
                            disabled={Boolean(busy) || deployment.status !== "RUNNING" || testSignalExceedsMaxNotional}
                            onClick={() => void submitTestSignal(signalType)}
                            className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                          >
                            {busy === `test-${signalType}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                            {t(testSignalLabelKeys[signalType])}
                          </button>
                        ))}
                      </div>
                      <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                        {testSignalExceedsMaxNotional
                          ? t("deployments.testSignal.exceedsMaxNotional")
                          : deployment.status === "RUNNING" ? t("deployments.testSignal.note") : t("deployments.testSignal.requiresRunning")}
                      </div>
                    </div>
                  </section>
                ) : null}
                {deployment.status === "RECOVERY_REQUIRED" || (deployment.target === "SHADOW" && deployment.status === "STOPPED") ? (
                  <section className="rounded-lg border border-red-200 bg-card p-4">
                    <h2 className="text-sm font-semibold">{t("deployments.recovery.title")}</h2>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {deployment.target === "LIVE" ? t("deployments.recovery.info") : t("deployments.recovery.shadowInfo")}
                    </p>
                    <div className="mt-3 space-y-3">
                      {deployment.target === "LIVE" ? (
                        <label className="block text-xs font-semibold text-muted-foreground">
                          {t("deployments.recovery.bindingLabel")}
                          <select value={recoveryBindingId} onChange={(event) => setRecoveryBindingId(event.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                            <option value="">{t("deployments.recovery.selectBinding")}</option>
                            {bindings.map((binding) => (
                              <option key={binding.binding_id} value={binding.binding_id}>
                                {binding.exchange} · {binding.label || binding.binding_id}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                        {deployment.recovery_reason || (
                          deployment.target === "LIVE" ? t("deployments.recovery.note") : t("deployments.recovery.shadowNote")
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={(deployment.target === "LIVE" && !recoveryBinding) || busy === "recover"}
                        onClick={() => void recover()}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        {busy === "recover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {deployment.target === "LIVE" ? t("deployments.recovery.action") : t("deployments.recovery.shadowAction")}
                      </button>
                    </div>
                  </section>
                ) : deployment.target === "SHADOW" ? (
                  <section className="rounded-lg border bg-card p-4">
                    <h2 className="text-sm font-semibold">{t("deployments.promote.title")}</h2>
                    <div className="mt-3 space-y-3">
                      <label className="block text-xs font-semibold text-muted-foreground">
                        {t("deployments.promote.bindingLabel")}
                        <select value={promoteBindingId} onChange={(event) => setPromoteBindingId(event.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                          <option value="">{t("deployments.promote.selectBinding")}</option>
                          {bindings.map((binding) => (
                            <option key={binding.binding_id} value={binding.binding_id}>
                              {binding.exchange} · {binding.label || binding.binding_id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs font-semibold text-muted-foreground">
                        {t("deployments.promote.riskPolicy")}
                        <textarea value={promoteRisk} onChange={(event) => setPromoteRisk(event.target.value)} rows={5} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
                      </label>
                      <label className="flex items-start gap-2 rounded-md border bg-background p-3 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={promoteConsent}
                          onChange={(event) => setPromoteConsent(event.target.checked)}
                          className="mt-0.5"
                        />
                        <span>{t("deployments.promote.confirm")}</span>
                      </label>
                      <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                        {t("deployments.promote.info")}
                      </div>
                      <button type="button" disabled={!promoteBindingId || !promoteConsent || busy === "promote"} onClick={() => void promote()} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                        {busy === "promote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
                        {t("deployments.promote.action")}
                      </button>
                    </div>
                  </section>
                ) : (
                  <LiveReadinessPanel deployment={deployment} runtime={runtime} selectedBinding={selectedBinding} />
                )}
              </aside>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
