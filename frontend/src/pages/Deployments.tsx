import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Archive,
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
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type ExchangeApiKeyBinding,
  type QuantaxisAccountSnapshot,
  type QuantaxisDeployment,
  type QuantaxisDeploymentTarget,
  type QuantaxisRuntimeStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/I18nProvider";

const statusTone: Record<string, string> = {
  DRAFT: "border-zinc-300 bg-zinc-100 text-zinc-700",
  READY: "border-sky-300 bg-sky-50 text-sky-700",
  RUNNING: "border-emerald-300 bg-emerald-50 text-emerald-700",
  PAUSED: "border-amber-300 bg-amber-50 text-amber-700",
  STOPPED: "border-zinc-300 bg-zinc-100 text-zinc-700",
  RECOVERY_REQUIRED: "border-red-300 bg-red-50 text-red-700",
  ARCHIVED: "border-zinc-300 bg-zinc-100 text-zinc-500",
};

function formatDate(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatJson(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) return "{}";
  return JSON.stringify(value, null, 2);
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

function eventTimestamp(item: Record<string, unknown>): string {
  return compactValue(item.created_at ?? item.timestamp ?? item.time ?? item.datetime);
}

function eventSummary(item: Record<string, unknown>): string {
  const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
    ? item.payload as Record<string, unknown>
    : item.payload_json && typeof item.payload_json === "object" && !Array.isArray(item.payload_json)
      ? item.payload_json as Record<string, unknown>
      : item;
  const parts = [
    payload.message,
    payload.reason,
    payload.error,
    payload.symbol,
    payload.action,
    payload.status,
  ].filter((value) => value !== undefined && value !== null && value !== "").map(compactValue);
  return parts.length ? parts.join(" · ") : JSON.stringify(item, null, 2);
}

function parseRiskPolicy(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Risk policy must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function RuntimeBanner({ runtime, loading }: { runtime: QuantaxisRuntimeStatus | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading QUANTAXIS runtime...
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
        <span>{available ? "QUANTAXIS runtime available" : `QUANTAXIS runtime unavailable: ${runtime.error || "not configured"}`}</span>
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
  const isLive = deployment.target === "LIVE";
  const states = [
    {
      label: "Broker binding",
      ok: Boolean(selectedBinding),
      detail: selectedBinding ? `${selectedBinding.exchange} · ${selectedBinding.label || selectedBinding.binding_id}` : "Select a live broker binding",
    },
    {
      label: "Mandate",
      ok: isLive ? deployment.status !== "RECOVERY_REQUIRED" : true,
      detail: isLive ? "Live deployment must pass mandate controls before resume" : "Will be checked during promotion",
    },
    {
      label: "Reconciliation",
      ok: isLive ? runtime?.available !== false : true,
      detail: isLive ? (runtime?.available ? "Runtime available for broker reconciliation" : "Reconciliation blocked until QUANTAXIS runtime is available") : "Only required after promotion",
    },
  ];

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{isLive ? "Live Readiness" : "Promotion Readiness"}</h2>
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

function DeploymentCard({ deployment }: { deployment: QuantaxisDeployment }) {
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
            <span>{deployment.target}</span>
            <span>{deployment.market}</span>
            <span>{deployment.timeframe}</span>
          </div>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", statusTone[deployment.status] ?? statusTone.DRAFT)}>
          {deployment.status}
        </span>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {deployment.symbols.join(", ") || "--"} · updated {formatDate(deployment.updated_at)}
      </div>
    </Link>
  );
}

function qifiConfigMessage(runtime: QuantaxisRuntimeStatus | null): string {
  if (!runtime) return "";
  const requires = runtime.requires ?? {};
  if (runtime.durable_store_configured === false || !requires.mongo || !requires.qifi_password) {
    const missing = [
      !requires.mongo ? "QUANTAXIS_MONGOURI" : "",
      !requires.qifi_password ? "VIBE_QUANTAXIS_QIFI_PASSWORD" : "",
    ].filter(Boolean);
    return `QIFI account projection is waiting for durable store configuration: ${missing.join(", ")}.`;
  }
  return "";
}

function AccountPanel({
  deployment,
  runtime,
  runtimeLoading,
}: {
  deployment: QuantaxisDeployment;
  runtime: QuantaxisRuntimeStatus | null;
  runtimeLoading: boolean;
}) {
  const [snapshot, setSnapshot] = useState<QuantaxisAccountSnapshot | null>(null);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [trades, setTrades] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const configMessage = qifiConfigMessage(runtime);

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
    } catch (err) {
      setSnapshot(null);
      setOrders([]);
      setTrades([]);
      setError(err instanceof Error ? err.message : "QIFI account snapshot unavailable");
    } finally {
      setLoading(false);
    }
  }, [configMessage, deployment.account_cookie, runtimeLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">QIFI Account</h2>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{deployment.account_cookie}</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>
      {runtimeLoading ? (
        <div className="mt-4 rounded-md border bg-background p-3 text-sm text-muted-foreground">
          Loading QIFI account projection...
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
            {["cash", "frozen", "market_value", "total_asset"].map((key) => (
              <div key={key} className="rounded-md border bg-background p-3">
                <div className="text-xs text-muted-foreground">{key}</div>
                <div className="mt-1 font-mono text-sm">{String(snapshot[key] ?? "--")}</div>
              </div>
            ))}
          </div>
          <ProjectionList title="Orders" items={orders} />
          <ProjectionList title="Trades" items={trades} />
        </div>
      ) : null}
    </section>
  );
}

function ProjectionList({
  title,
  items,
  error,
  emptyMessage = "No records yet.",
}: {
  title: string;
  items: Record<string, unknown>[];
  error?: string;
  emptyMessage?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
      </div>
      {error ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>
      ) : items.length ? (
        <div className="mt-3 space-y-2">
          {items.slice(-12).reverse().map((item, index) => {
            const type = compactValue(item.event_type ?? item.type ?? item.action ?? item.status ?? item.order_id ?? item.trade_id ?? `record-${index + 1}`);
            const sequence = item.sequence_no === undefined ? "" : `#${compactValue(item.sequence_no)}`;
            return (
              <details key={String(item.event_id ?? item.order_id ?? item.trade_id ?? item.signal_id ?? index)} className="rounded-md border bg-background p-3 text-xs">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{type}</div>
                      <div className="mt-1 line-clamp-2 break-words text-muted-foreground">{eventSummary(item)}</div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                      <div>{sequence}</div>
                      <div>{eventTimestamp(item)}</div>
                    </div>
                  </div>
                </summary>
                <pre className="mt-3 max-h-48 overflow-auto rounded-md border bg-muted/30 p-3 text-[11px]">{JSON.stringify(item, null, 2)}</pre>
              </details>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-md border bg-background p-4 text-sm text-muted-foreground">{emptyMessage}</div>
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
  const latestEvent = events.length ? events[events.length - 1] : null;
  const latestSignal = signals.length ? signals[signals.length - 1] : null;
  const summaryCards = [
    {
      label: "Running Strategy",
      value: `${deployment.symbols.join(", ") || "--"} · ${deployment.timeframe}`,
      detail: `${deployment.strategy_snapshot.name || deployment.strategy_snapshot.strategy_id} · ${deployment.market}`,
      icon: Activity,
    },
    {
      label: "Event Stream",
      value: streamState,
      detail: events.length ? `${events.length} runtime events loaded` : "Waiting for the first runtime event",
      icon: RadioTower,
    },
    {
      label: "Latest Event",
      value: latestEvent ? compactValue(latestEvent.event_type ?? latestEvent.type) : "No event yet",
      detail: latestEvent ? eventSummary(latestEvent) : "Start the deployment or wait for the next market tick.",
      icon: Clock3,
    },
    {
      label: "Latest Signal",
      value: latestSignal ? compactValue(latestSignal.action ?? latestSignal.signal ?? latestSignal.status ?? "Signal") : "No signal yet",
      detail: latestSignal ? eventSummary(latestSignal) : "No strategy signal has been emitted for this deployment.",
      icon: ClipboardList,
    },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
    </section>
  );
}

function RuntimeProjectionPanel({
  deployment,
  runtime,
  runtimeLoading,
}: {
  deployment: QuantaxisDeployment;
  runtime: QuantaxisRuntimeStatus | null;
  runtimeLoading: boolean;
}) {
  const [signals, setSignals] = useState<Record<string, unknown>[]>([]);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [signalsError, setSignalsError] = useState("");
  const [eventsError, setEventsError] = useState("");
  const [streamState, setStreamState] = useState<"connecting" | "connected" | "reconnecting" | "closed">("connecting");
  const configMessage = qifiConfigMessage(runtime);

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
      .then((result) => setSignals(result.signals))
      .catch((error) => {
        setSignals([]);
        setSignalsError(error instanceof Error ? error.message : "Signals unavailable");
      });
    api.listDeploymentEvents(deployment.deployment_id)
      .then((result) => setEvents(result.events))
      .catch((error) => {
        setEvents([]);
        setEventsError(error instanceof Error ? error.message : "Events unavailable");
      });
  }, [configMessage, deployment.deployment_id, runtimeLoading]);

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
        setEventsError("Failed to parse deployment event");
      }
    });
    source.addEventListener("deployment.error", (message) => {
      try {
        const payload = JSON.parse((message as MessageEvent).data) as { error?: string };
        setEventsError(payload.error || "Deployment event stream failed");
      } catch {
        setEventsError("Deployment event stream failed");
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
  }, [configMessage, deployment.deployment_id, runtimeLoading]);

  return (
    <div className="space-y-3">
      <DeploymentRunSummary deployment={deployment} streamState={streamState} signals={signals} events={events} />
      <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
        Event stream: <span className="font-semibold text-foreground">{streamState}</span>
      </div>
      {runtimeLoading ? (
        <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
          Loading strategy signals...
        </div>
      ) : configMessage ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          {configMessage}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProjectionList
          title="Strategy Signals"
          items={signals}
          error={signalsError}
          emptyMessage="No strategy signal has been emitted yet. A running deployment usually emits signals only after a scheduled tick or market event is processed."
        />
        <ProjectionList
          title="Runtime Events"
          items={events}
          error={eventsError}
          emptyMessage="No runtime events have been recorded yet. Check that the deployment has been started and that the event stream is connected."
        />
      </div>
    </div>
  );
}

export function Deployments() {
  const { language } = useTranslation();
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [promoteBindingId, setPromoteBindingId] = useState("");
  const [recoveryBindingId, setRecoveryBindingId] = useState("");
  const [promoteRisk, setPromoteRisk] = useState("{}");
  const [promoteConsent, setPromoteConsent] = useState(false);

  const copy = language === "zh-CN" ? {
    title: "策略部署",
    subtitle: "统一管理 QUANTAXIS SHADOW/LIVE 部署、QIFI 账户和运行状态。",
    empty: "还没有部署，从策略库创建一个 shadow 或 live 部署。",
    back: "返回部署列表",
  } : {
    title: "Strategy Deployments",
    subtitle: "Manage QUANTAXIS SHADOW/LIVE deployments, QIFI accounts, and runtime state.",
    empty: "No deployments yet. Create a shadow or live deployment from Strategies.",
    back: "Back to deployments",
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [deploymentResult, bindingResult] = await Promise.all([
        api.listDeployments(),
        api.listExchangeApiKeys().catch(() => ({ bindings: [] as ExchangeApiKeyBinding[] })),
      ]);
      setDeployments(deploymentResult.deployments);
      setBindings(bindingResult.bindings);
      const current = deploymentId
        ? deploymentResult.deployments.find((item) => item.deployment_id === deploymentId) ?? null
        : null;
      setSelected(current);
      if (deploymentId && !current) {
        api.getDeployment(deploymentId).then((result) => setSelected(result.deployment)).catch(() => undefined);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load deployments");
    } finally {
      setLoading(false);
    }
  }, [deploymentId]);

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
        error: error instanceof Error ? error.message : "runtime status unavailable",
      });
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadRuntime();
  }, [load, loadRuntime]);

  const visibleDeployments = useMemo(() => {
    const list = filterTarget === "SHADOW" || filterTarget === "LIVE"
      ? deployments.filter((item) => item.target === filterTarget)
      : deployments;
    return [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [deployments, filterTarget]);

  const selectedBinding = useMemo(() => {
    if (!selected) return null;
    const wanted = promoteBindingId || (selected.broker_binding_id ? String(selected.broker_binding_id) : "");
    if (!wanted) return null;
    return bindings.find((binding) => String(binding.binding_id) === wanted) ?? null;
  }, [bindings, selected, promoteBindingId]);

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
      toast.success(`${action} accepted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${action} failed`);
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
        risk_policy: parseRiskPolicy(promoteRisk),
      });
      toast.success("Live deployment created");
      navigate(`/deployments/${encodeURIComponent(result.deployment.deployment_id)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Promotion failed");
    } finally {
      setBusy("");
    }
  };

  const recover = async () => {
    if (!selected || !recoveryBinding) return;
    setBusy("recover");
    try {
      const result = await api.recoverDeployment(selected.deployment_id, {
        broker: recoveryBinding.exchange,
      });
      setSelected(result.deployment);
      setDeployments((current) => current.map((item) => item.deployment_id === result.deployment.deployment_id ? result.deployment : item));
      toast.success("Recovery accepted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recovery failed");
    } finally {
      setBusy("");
    }
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
              Refresh
            </button>
          </header>
          <RuntimeBanner runtime={runtime} loading={runtimeLoading} />
          {visibleDeployments.length ? (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleDeployments.map((deployment) => <DeploymentCard key={deployment.deployment_id} deployment={deployment} />)}
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
            {loading ? "Loading deployment..." : "Deployment not found"}
          </div>
        ) : (
          <>
            <section className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {deployment.target === "LIVE" ? <RadioTower className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}
                    {deployment.target} · {deployment.market} · {deployment.timeframe}
                  </div>
                  <h1 className="mt-1 truncate text-2xl font-semibold">{deployment.strategy_snapshot.name || deployment.strategy_snapshot.strategy_id}</h1>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{deployment.deployment_id}</p>
                </div>
                <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone[deployment.status] ?? statusTone.DRAFT)}>
                  {deployment.status}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy === "ready" || deployment.status !== "DRAFT"} onClick={() => void applyAction("ready")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <ShieldCheck className="h-3.5 w-3.5" /> Ready
                </button>
                <button type="button" disabled={Boolean(busy) || !["READY", "PAUSED"].includes(deployment.status)} onClick={() => void applyAction("start")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <Play className="h-3.5 w-3.5" /> Start
                </button>
                <button type="button" disabled={Boolean(busy) || deployment.status !== "RUNNING"} onClick={() => void applyAction("pause")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <Pause className="h-3.5 w-3.5" /> Pause
                </button>
                <button type="button" disabled={Boolean(busy) || !["READY", "RUNNING", "PAUSED"].includes(deployment.status)} onClick={() => void applyAction("stop")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
                <button type="button" disabled={Boolean(busy) || deployment.status === "RUNNING" || deployment.status === "ARCHIVED"} onClick={() => void applyAction("archive")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <Archive className="h-3.5 w-3.5" /> Archive
                </button>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <AccountPanel deployment={deployment} runtime={runtime} runtimeLoading={runtimeLoading} />
                <RuntimeProjectionPanel deployment={deployment} runtime={runtime} runtimeLoading={runtimeLoading} />
                <section className="rounded-lg border bg-card p-4">
                  <h2 className="text-sm font-semibold">Strategy Snapshot</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border bg-background p-3 text-xs">
                      <div className="text-muted-foreground">Version</div>
                      <div className="mt-1 font-mono">{deployment.strategy_snapshot.version_no}</div>
                    </div>
                    <div className="rounded-md border bg-background p-3 text-xs">
                      <div className="text-muted-foreground">Hash</div>
                      <div className="mt-1 truncate font-mono">{deployment.strategy_snapshot.code_sha256 || "--"}</div>
                    </div>
                    <div className="rounded-md border bg-background p-3 text-xs">
                      <div className="text-muted-foreground">Symbols</div>
                      <div className="mt-1">{deployment.symbols.join(", ")}</div>
                    </div>
                  </div>
                </section>
              </div>
              <aside className="space-y-4">
                {deployment.target === "SHADOW" ? (
                  <section className="rounded-lg border bg-card p-4">
                    <h2 className="text-sm font-semibold">Promote To Live</h2>
                    <div className="mt-3 space-y-3">
                      <label className="block text-xs font-semibold text-muted-foreground">
                        Broker Binding
                        <select value={promoteBindingId} onChange={(event) => setPromoteBindingId(event.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                          <option value="">Select binding</option>
                          {bindings.map((binding) => (
                            <option key={binding.binding_id} value={binding.binding_id}>
                              {binding.exchange} · {binding.label || binding.binding_id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs font-semibold text-muted-foreground">
                        Live Risk Policy
                        <textarea value={promoteRisk} onChange={(event) => setPromoteRisk(event.target.value)} rows={5} className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
                      </label>
                      <label className="flex items-start gap-2 rounded-md border bg-background p-3 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={promoteConsent}
                          onChange={(event) => setPromoteConsent(event.target.checked)}
                          className="mt-0.5"
                        />
                        <span>I confirm this creates a separate LIVE deployment, does not copy shadow positions, and must pass mandate, kill-switch, and reconciliation gates before execution.</span>
                      </label>
                      <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                        Promotion creates a separate LIVE deployment. It uses the selected broker binding, then waits for mandate and reconciliation gates before execution.
                      </div>
                      <button type="button" disabled={!promoteBindingId || !promoteConsent || busy === "promote"} onClick={() => void promote()} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                        {busy === "promote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
                        Promote
                      </button>
                    </div>
                  </section>
                ) : deployment.status === "RECOVERY_REQUIRED" ? (
                  <section className="rounded-lg border border-red-200 bg-card p-4">
                    <h2 className="text-sm font-semibold">Recovery Required</h2>
                    <p className="mt-2 text-xs text-muted-foreground">
                      This live deployment is blocked until broker reconciliation is safe. Select the live broker binding and retry recovery.
                    </p>
                    <div className="mt-3 space-y-3">
                      <label className="block text-xs font-semibold text-muted-foreground">
                        Broker Binding
                        <select value={recoveryBindingId} onChange={(event) => setRecoveryBindingId(event.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                          <option value="">Select binding</option>
                          {bindings.map((binding) => (
                            <option key={binding.binding_id} value={binding.binding_id}>
                              {binding.exchange} · {binding.label || binding.binding_id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                        Recovery will send the selected broker name to the live reconciliation gate.
                      </div>
                      <button type="button" disabled={!recoveryBinding || busy === "recover"} onClick={() => void recover()} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                        {busy === "recover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
                        Recover Live Deployment
                      </button>
                    </div>
                  </section>
                ) : (
                  <LiveReadinessPanel deployment={deployment} runtime={runtime} selectedBinding={selectedBinding} />
                )}
                <section className="rounded-lg border bg-card p-4">
                  <h2 className="text-sm font-semibold">Runtime Metadata</h2>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Created</dt><dd>{formatDate(deployment.created_at)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Updated</dt><dd>{formatDate(deployment.updated_at)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Started</dt><dd>{formatDate(deployment.started_at)}</dd></div>
                  </dl>
                  <pre className="mt-4 max-h-64 overflow-auto rounded-md border bg-background p-3 text-xs">{formatJson(deployment.risk_policy)}</pre>
                </section>
              </aside>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
