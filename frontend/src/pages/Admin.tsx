import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useDataProvider } from "@refinedev/core";
import { Activity, BarChart3, Database, LayoutDashboard, Loader2, LogOut, RefreshCw, Save, Settings as SettingsIcon, ShieldCheck, ShoppingBag, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  type AdminDashboardResponse,
  type AdminUserUsageRow,
  type StrategyMarketAdminItem,
} from "@/lib/api";
import { useTranslation } from "@/i18n/I18nProvider";
import { getApiAuthKey, setApiAuthKey } from "@/lib/apiAuth";
import { builtInStrategyCatalog, paidStrategyCatalog, type StrategyCatalogItem } from "@/lib/strategyMarketplace";
import { Settings as RuntimeSettings } from "@/pages/Settings";

const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

const copy = {
  "en-US": {
    title: "Admin Console",
    subtitle: "Manage users, strategy market publishing, and user agent activity.",
    refresh: "Refresh",
    logout: "Exit admin",
    saveMarket: "Save market",
    overview: "Overview",
    operations: "Operations",
    serviceHealth: "Service health",
    publishing: "Publishing",
    users: "Users",
    market: "Strategy Market",
    settings: "Settings",
    usage: "Agent Usage",
    displayName: "Display name",
    password: "New password",
    revoke: "Revoke tokens",
    update: "Update",
    delete: "Delete",
    enabled: "Enabled",
    featured: "Featured",
    status: "Status",
    price: "Price",
    note: "Note",
    sessions: "Sessions",
    messages: "Messages",
    attempts: "Attempts",
    strategies: "Strategies",
    lastActive: "Last active",
    totalUsers: "Users",
    totalSessions: "Sessions",
    totalMessages: "Messages",
    totalAttempts: "Agent calls",
    totalStrategies: "Strategies",
    runningAttempts: "Running",
    failedAttempts: "Failed",
    completedAttempts: "Completed",
    completionRate: "Completion rate",
    enabledItems: "Enabled items",
    featuredItems: "Featured items",
    builtInItems: "Built-in",
    paidItems: "Paid",
    operator: "Operator",
    loadFailed: "Failed to load admin data",
    saved: "Saved",
    updated: "User updated",
    deleted: "User deleted",
  },
  "zh-CN": {
    title: "大后台",
    subtitle: "管理用户、策略商城发布状态，以及用户调用 agent 的情况。",
    refresh: "刷新",
    logout: "退出管理端",
    saveMarket: "保存商城",
    overview: "运营看板",
    operations: "运营状态",
    serviceHealth: "服务健康",
    publishing: "发布管理",
    users: "用户管理",
    market: "策略商城",
    settings: "系统设置",
    usage: "Agent 调用情况",
    displayName: "显示名",
    password: "新密码",
    revoke: "踢下线",
    update: "更新",
    delete: "删除",
    enabled: "启用",
    featured: "推荐",
    status: "状态",
    price: "价格",
    note: "备注",
    sessions: "会话",
    messages: "消息",
    attempts: "调用",
    strategies: "策略",
    lastActive: "最近活跃",
    totalUsers: "用户",
    totalSessions: "会话",
    totalMessages: "消息",
    totalAttempts: "Agent 调用",
    totalStrategies: "策略",
    runningAttempts: "运行中",
    failedAttempts: "失败",
    completedAttempts: "完成",
    completionRate: "完成率",
    enabledItems: "启用条目",
    featuredItems: "推荐条目",
    builtInItems: "内置",
    paidItems: "付费",
    operator: "运营端",
    loadFailed: "加载后台数据失败",
    saved: "已保存",
    updated: "用户已更新",
    deleted: "用户已删除",
  },
} as const;

function defaultMarketItems(): StrategyMarketAdminItem[] {
  const toItem = (item: StrategyCatalogItem): StrategyMarketAdminItem => ({
    id: item.id,
    kind: item.kind,
    enabled: true,
    featured: false,
    price: item.price || "",
    status: "published",
    note: "",
    updated_at: "",
  });
  return [...builtInStrategyCatalog.map(toItem), ...paidStrategyCatalog.map(toItem)];
}

function mergeMarketItems(remote: StrategyMarketAdminItem[]): StrategyMarketAdminItem[] {
  const byId = new Map(defaultMarketItems().map((item) => [item.id, item]));
  for (const item of remote) byId.set(item.id, { ...byId.get(item.id), ...item });
  return [...byId.values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

function catalogName(id: string) {
  return [...builtInStrategyCatalog, ...paidStrategyCatalog].find((item) => item.id === id)?.name || id;
}

type AdminCopy = (typeof copy)[keyof typeof copy];

function formatPercent(part: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number | string;
  detail?: string;
  tone: "sky" | "emerald" | "amber" | "rose" | "zinc";
}) {
  const tones = {
    sky: "border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300",
    emerald: "border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
    amber: "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
    rose: "border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
    zinc: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  } as const;
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</div>
          <div className="mt-2 font-mono text-2xl font-semibold tracking-normal">{value}</div>
        </div>
        <span className={`h-2.5 w-2.5 rounded-full border ${tones[tone]}`} />
      </div>
      {detail && <div className="mt-3 text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, action }: { icon: typeof LayoutDashboard; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-card text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function UsageTable({ rows, labels }: { rows: AdminUserUsageRow[]; labels: AdminCopy }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-normal text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">{labels.users}</th>
              <th className="px-4 py-3 font-semibold">{labels.sessions}</th>
              <th className="px-4 py-3 font-semibold">{labels.messages}</th>
              <th className="px-4 py-3 font-semibold">{labels.attempts}</th>
              <th className="px-4 py-3 font-semibold">{labels.strategies}</th>
              <th className="px-4 py-3 font-semibold">{labels.lastActive}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.user_id ?? "operator"}-${row.username}`} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="font-medium">{row.display_name || row.username}</div>
                  <div className="text-xs text-muted-foreground">{row.username}</div>
                </td>
                <td className="px-4 py-3 font-mono">{row.session_count}</td>
                <td className="px-4 py-3 font-mono">{row.message_count}</td>
                <td className="px-4 py-3 font-mono">{row.attempt_count}</td>
                <td className="px-4 py-3 font-mono">{row.strategy_count}</td>
                <td className="max-w-[220px] truncate px-4 py-3 text-xs text-muted-foreground">{row.last_message_at || row.last_session_at || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Admin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useTranslation();
  const getDataProvider = useDataProvider();
  const dataProvider = getDataProvider();
  const labels = copy[language];
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [marketItems, setMarketItems] = useState<StrategyMarketAdminItem[]>(() => defaultMarketItems());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userDrafts, setUserDrafts] = useState<Record<number, { display_name: string; password: string; revoke_tokens: boolean }>>({});
  const hasOperatorKey = Boolean(getApiAuthKey());

  const load = async () => {
    setLoading(true);
    try {
      if (!dataProvider.custom) throw new Error("Admin data provider does not support custom requests.");
      const [dashboardResponse, marketResponse] = await Promise.all([
        dataProvider.custom<AdminDashboardResponse>({ url: "admin/dashboard", method: "get" }),
        dataProvider.custom<{ items: StrategyMarketAdminItem[] }>({ url: "admin/strategy-market", method: "get" }),
      ]);
      const nextDashboard = dashboardResponse.data;
      const market = marketResponse.data;
      setDashboard(nextDashboard);
      setMarketItems(mergeMarketItems(market.items));
      const drafts: Record<number, { display_name: string; password: string; revoke_tokens: boolean }> = {};
      for (const user of nextDashboard.users) {
        drafts[user.user_id] = { display_name: user.display_name, password: "", revoke_tokens: false };
      }
      setUserDrafts(drafts);
    } catch (error) {
      toast.error(`${labels.loadFailed}: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasOperatorKey) return;
    void load();
  }, [hasOperatorKey]);

  const usageRows = useMemo(() => dashboard?.usage ?? [], [dashboard]);

  if (!hasOperatorKey) {
    return <Navigate to="/operator/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  }

  const saveMarket = async () => {
    setSaving(true);
    try {
      if (!dataProvider.custom) throw new Error("Admin data provider does not support custom requests.");
      const response = await dataProvider.custom<{ items: StrategyMarketAdminItem[] }, unknown, { items: StrategyMarketAdminItem[] }>({
        url: "admin/strategy-market",
        method: "put",
        payload: { items: marketItems },
      });
      const saved = response.data;
      setMarketItems(mergeMarketItems(saved.items));
      toast.success(labels.saved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const updateUser = async (userId: number) => {
    const draft = userDrafts[userId];
    if (!draft) return;
    try {
      await dataProvider.update({
        resource: "admin-users",
        id: userId,
        variables: {
          display_name: draft.display_name,
          password: draft.password || undefined,
          revoke_tokens: draft.revoke_tokens,
        },
      });
      toast.success(labels.updated);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unknown error");
    }
  };

  const deleteUser = async (userId: number) => {
    try {
      await dataProvider.deleteOne({ resource: "admin-users", id: userId });
      toast.success(labels.deleted);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unknown error");
    }
  };

  const logout = () => {
    setApiAuthKey("");
    navigate("/operator/login", { replace: true });
  };

  const summary = dashboard?.summary;
  const enabledItems = marketItems.filter((item) => item.enabled).length;
  const featuredItems = marketItems.filter((item) => item.featured).length;
  const builtInItems = marketItems.filter((item) => item.kind === "built-in").length;
  const paidItems = marketItems.filter((item) => item.kind === "paid").length;
  const completionRate = summary ? formatPercent(summary.completed_attempts, summary.total_attempts) : "0%";
  const navItems = [
    { href: "#overview", icon: LayoutDashboard, label: labels.overview },
    { href: "#settings", icon: SettingsIcon, label: labels.settings },
    { href: "#users", icon: Users, label: labels.users },
    { href: "#market", icon: ShoppingBag, label: labels.market },
    { href: "#usage", icon: Activity, label: labels.usage },
  ];

  if (loading && !dashboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {labels.title}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r bg-card lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-3 border-b px-5">
          <img src="/favicon.svg" alt="" className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Venus Console</div>
            <div className="text-xs text-muted-foreground">{labels.operator}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ href, icon: Icon, label }) => (
            <a key={href} href={href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Icon className="h-4 w-4" />
              {label}
            </a>
          ))}
        </nav>
        <div className="border-t p-3">
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <LogOut className="h-4 w-4" />
            {labels.logout}
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                {labels.serviceHealth}
              </div>
              <h1 className="mt-1 truncate text-xl font-semibold tracking-normal">{labels.title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted">
                <RefreshCw className="h-4 w-4" />
                {labels.refresh}
              </button>
              <button onClick={logout} className="inline-flex items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted lg:hidden">
                <LogOut className="h-4 w-4" />
                {labels.logout}
              </button>
            </div>
          </div>
        </header>

        <main className="space-y-8 p-4 sm:p-6">
          <section id="overview" className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{labels.subtitle}</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal">{labels.overview}</h2>
              </div>
              <div className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm">
                <Database className="h-4 w-4 text-primary" />
                {labels.publishing}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label={labels.totalUsers} value={summary?.total_users ?? 0} detail={`${labels.totalSessions}: ${summary?.total_sessions ?? 0}`} tone="sky" />
              <Metric label={labels.totalAttempts} value={summary?.total_attempts ?? 0} detail={`${labels.completionRate}: ${completionRate}`} tone="emerald" />
              <Metric label={labels.failedAttempts} value={summary?.failed_attempts ?? 0} detail={`${labels.runningAttempts}: ${summary?.running_attempts ?? 0}`} tone={(summary?.failed_attempts ?? 0) > 0 ? "rose" : "zinc"} />
              <Metric label={labels.totalStrategies} value={summary?.total_strategies ?? 0} detail={`${labels.enabledItems}: ${enabledItems}`} tone="amber" />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
              <div className="rounded-lg border bg-card p-5 shadow-sm">
                <SectionHeader icon={BarChart3} title={labels.operations} />
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <Metric label={labels.completedAttempts} value={summary?.completed_attempts ?? 0} detail={labels.completionRate} tone="emerald" />
                  <Metric label={labels.totalMessages} value={summary?.total_messages ?? 0} detail={labels.messages} tone="sky" />
                  <Metric label={labels.runningAttempts} value={summary?.running_attempts ?? 0} detail={labels.serviceHealth} tone="zinc" />
                </div>
              </div>
              <div className="rounded-lg border bg-card p-5 shadow-sm">
                <SectionHeader icon={ShoppingBag} title={labels.publishing} />
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Metric label={labels.enabledItems} value={enabledItems} detail={`${featuredItems} ${labels.featuredItems}`} tone="emerald" />
                  <Metric label={labels.builtInItems} value={builtInItems} detail={`${paidItems} ${labels.paidItems}`} tone="amber" />
                </div>
              </div>
            </div>
          </section>

          <section id="settings" className="scroll-mt-20">
            <RuntimeSettings embedded />
          </section>

          <section id="users" className="space-y-4">
            <SectionHeader icon={Users} title={labels.users} />
            <div className="grid gap-4 xl:grid-cols-2">
              {(dashboard?.users ?? []).map((user) => {
                const draft = userDrafts[user.user_id] ?? { display_name: user.display_name, password: "", revoke_tokens: false };
                return (
                  <div key={user.user_id} className="rounded-lg border bg-card p-5 shadow-sm">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold">{user.username}</div>
                        <div className="truncate text-xs text-muted-foreground">ID {user.user_id} · {user.created_at}</div>
                      </div>
                      <button onClick={() => deleteUser(user.user_id)} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" title={labels.delete}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-sm font-medium">
                        {labels.displayName}
                        <input
                          className={inputClass}
                          value={draft.display_name}
                          onChange={(event) => setUserDrafts((prev) => ({ ...prev, [user.user_id]: { ...draft, display_name: event.target.value } }))}
                        />
                      </label>
                      <label className="grid gap-1.5 text-sm font-medium">
                        {labels.password}
                        <input
                          className={inputClass}
                          type="password"
                          value={draft.password}
                          onChange={(event) => setUserDrafts((prev) => ({ ...prev, [user.user_id]: { ...draft, password: event.target.value } }))}
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={draft.revoke_tokens}
                          onChange={(event) => setUserDrafts((prev) => ({ ...prev, [user.user_id]: { ...draft, revoke_tokens: event.target.checked } }))}
                          className="h-4 w-4 accent-primary"
                        />
                        {labels.revoke}
                      </label>
                      <button onClick={() => updateUser(user.user_id)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90">
                        <Save className="h-4 w-4" />
                        {labels.update}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section id="market" className="space-y-4">
            <SectionHeader
              icon={ShoppingBag}
              title={labels.market}
              action={
                <button onClick={saveMarket} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {labels.saveMarket}
                </button>
              }
            />
            <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <div className="min-w-[980px]">
                  <div className="grid grid-cols-[1.4fr_0.55fr_0.55fr_0.8fr_0.9fr_1.2fr] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                    <span>{labels.market}</span>
                    <span>{labels.enabled}</span>
                    <span>{labels.featured}</span>
                    <span>{labels.status}</span>
                    <span>{labels.price}</span>
                    <span>{labels.note}</span>
                  </div>
                  {marketItems.map((item, index) => (
                    <div key={item.id} className="grid grid-cols-[1.4fr_0.55fr_0.55fr_0.8fr_0.9fr_1.2fr] gap-3 border-b px-4 py-3 last:border-b-0">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{catalogName(item.id)}</div>
                        <div className="truncate text-xs text-muted-foreground">{item.kind} · {item.id}</div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(event) => setMarketItems((prev) => prev.map((row, i) => i === index ? { ...row, enabled: event.target.checked } : row))}
                          className="h-4 w-4 accent-primary"
                        />
                        {labels.enabled}
                      </label>
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={item.featured}
                          onChange={(event) => setMarketItems((prev) => prev.map((row, i) => i === index ? { ...row, featured: event.target.checked } : row))}
                          className="h-4 w-4 accent-primary"
                        />
                        {labels.featured}
                      </label>
                      <select
                        value={item.status}
                        onChange={(event) => setMarketItems((prev) => prev.map((row, i) => i === index ? { ...row, status: event.target.value as StrategyMarketAdminItem["status"] } : row))}
                        className={inputClass}
                      >
                        <option value="draft">draft</option>
                        <option value="published">published</option>
                        <option value="hidden">hidden</option>
                        <option value="archived">archived</option>
                      </select>
                      <input
                        className={inputClass}
                        value={item.price}
                        onChange={(event) => setMarketItems((prev) => prev.map((row, i) => i === index ? { ...row, price: event.target.value } : row))}
                      />
                      <input
                        className={inputClass}
                        value={item.note}
                        onChange={(event) => setMarketItems((prev) => prev.map((row, i) => i === index ? { ...row, note: event.target.value } : row))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="usage" className="space-y-4">
            <SectionHeader icon={Activity} title={labels.usage} />
            <UsageTable rows={usageRows} labels={labels} />
          </section>
        </main>
      </div>
    </div>
  );
}
