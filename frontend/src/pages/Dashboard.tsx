import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  CandlestickChart,
  RefreshCw,
  LineChart,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { StrategyReturnChart } from "@/components/charts/StrategyReturnChart";
import { KLineChartPanel } from "@/components/charts/KLineChartPanel";
import { api, type CryptoKlineBar, type EquityPoint, type QIFIOrder, type QuantaxisAccountSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";

const QUOTE_ASSETS = new Set(["USD", "USDT", "USDC", "BUSD", "DAI"]);
const REFRESH_MS = 10_000;
const INITIAL_VIRTUAL_CAPITAL = 100_000;
const KLINE_REFRESH_MS = 3_500;
const DASHBOARD_TIMEFRAMES = ["5m", "15m", "1h", "1d"] as const;
const DASHBOARD_SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT"] as const;

interface AccountAsset {
  asset: string;
  balance: number;
  frozen: number;
}

interface DashboardAccount {
  account_cookie: string;
  cash: number;
  frozen: number;
  market_value: number;
  total_asset: number;
  accounts: Record<string, AccountAsset>;
  orders: QIFIOrder[];
  market_prices: Record<string, number>;
  updated_at?: string;
}

interface KlineState {
  symbol: (typeof DASHBOARD_SYMBOLS)[number];
  timeframe: (typeof DASHBOARD_TIMEFRAMES)[number];
  bars: CryptoKlineBar[];
  loading: boolean;
}

function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(4)}`;
}

function formatPercent(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString();
}

function normalizeAsset(value: string): string {
  return value.trim().toUpperCase();
}

function assetPrice(asset: string, marketPrices: Record<string, number>): number {
  const normalized = normalizeAsset(asset);
  if (QUOTE_ASSETS.has(normalized)) return 1;
  return (
    marketPrices[normalized]
    ?? marketPrices[`${normalized}_USDT`]
    ?? marketPrices[`${normalized}_USD`]
    ?? marketPrices[`${normalized}_USDC`]
    ?? 0
  );
}

function accountValue(assetAccount: AccountAsset, marketPrices: Record<string, number>): number {
  const price = assetPrice(assetAccount.asset, marketPrices);
  return (assetAccount.balance + assetAccount.frozen) * price;
}

function orderFilledQuantity(order: QIFIOrder): number {
  return order.filled_quantity > 0 ? order.filled_quantity : order.status === "FILLED" ? order.quantity : 0;
}

function orderExecutedPrice(order: QIFIOrder): number {
  return order.avg_price > 0 ? order.avg_price : order.price;
}

function splitSymbol(symbol: string): [string, string] {
  const normalized = symbol.trim().toUpperCase().replace("-", "_").replace("/", "_");
  const [base = "", quote = ""] = normalized.split("_");
  return [base, quote];
}

function buildEquitySeries(account: DashboardAccount): EquityPoint[] {
  const filledOrders = [...account.orders]
    .filter((order) => order.status === "FILLED" || order.status === "PARTIALLY_FILLED")
    .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));

  const positions = new Map<string, number>();
  const prices = new Map<string, number>();
  let cash = INITIAL_VIRTUAL_CAPITAL;
  let peak = INITIAL_VIRTUAL_CAPITAL;

  const points: EquityPoint[] = [{
    time: new Date().toISOString(),
    equity: INITIAL_VIRTUAL_CAPITAL,
    drawdown: 0,
  }];

  for (const order of filledOrders) {
    const [base, quote] = splitSymbol(order.symbol);
    const qty = orderFilledQuantity(order);
    const price = orderExecutedPrice(order);
    if (!qty || !price) continue;
    const notional = qty * price;
    const fee = order.commission || 0;

    if (order.side === "BUY") {
      cash -= notional + fee;
      positions.set(base, (positions.get(base) ?? 0) + qty);
    } else {
      cash += notional - fee;
      positions.set(base, (positions.get(base) ?? 0) - qty);
    }

    if (base) prices.set(base, price);
    if (quote && !QUOTE_ASSETS.has(quote)) prices.set(quote, assetPrice(quote, account.market_prices));

    let equity = cash;
    for (const [asset, quantity] of positions) {
      const mark = assetPrice(asset, account.market_prices) || prices.get(asset) || 0;
      equity += quantity * mark;
    }
    peak = Math.max(peak, equity);
    points.push({
      time: formatDate(order.datetime),
      equity,
      drawdown: peak > 0 ? (equity - peak) / peak : 0,
    });
  }

  if (points.length === 1) {
    const currentEquity = account.total_asset;
    points.push({
      time: new Date().toISOString(),
      equity: currentEquity || INITIAL_VIRTUAL_CAPITAL,
      drawdown: 0,
    });
  }

  return points;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function accountAssets(snapshot: QuantaxisAccountSnapshot): Record<string, AccountAsset> {
  const raw = snapshot.accounts;
  if (raw && typeof raw === "object") {
    const values = Object.entries(raw as Record<string, Record<string, unknown>>);
    const mapped = values.reduce<Record<string, AccountAsset>>((acc, [key, value]) => {
      const asset = String(value.asset || value.currency || key || "CASH").toUpperCase();
      acc[asset] = {
        asset,
        balance: numberValue(value.balance ?? value.available ?? value.cash),
        frozen: numberValue(value.frozen ?? value.frozen_margin),
      };
      return acc;
    }, {});
    if (Object.keys(mapped).length) return mapped;
  }
  return {
    CASH: {
      asset: "CASH",
      balance: numberValue(snapshot.cash),
      frozen: numberValue(snapshot.frozen),
    },
  };
}

function dashboardAccount(snapshot: QuantaxisAccountSnapshot, orders: QIFIOrder[]): DashboardAccount {
  return {
    account_cookie: snapshot.account_cookie,
    cash: numberValue(snapshot.cash),
    frozen: numberValue(snapshot.frozen),
    market_value: numberValue(snapshot.market_value),
    total_asset: numberValue(snapshot.total_asset),
    accounts: accountAssets(snapshot),
    orders,
    market_prices: {},
    updated_at: String(snapshot.updated_at || ""),
  };
}

function KlineSection({ state, setState }: { state: KlineState; setState: Dispatch<SetStateAction<KlineState>> }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <CandlestickChart className="h-4 w-4 text-orange-300" />
            Market Candles
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {state.symbol} · {state.timeframe.toUpperCase()} · live crypto bars
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state.loading ? (
            <RefreshCw className="h-4 w-4 animate-spin text-zinc-500" />
          ) : (
            <LineChart className="h-4 w-4 text-emerald-400" />
          )}
          <div className="flex rounded-md border border-zinc-800 bg-[#0d0f13] p-1">
            {DASHBOARD_TIMEFRAMES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setState((current) => ({ ...current, timeframe: item }))}
                className={cn(
                  "h-7 rounded px-3 text-xs font-medium transition",
                  state.timeframe === item ? "bg-orange-500 text-white" : "text-zinc-400 hover:text-zinc-100",
                )}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border border-zinc-800 bg-[#0d0f13] p-1">
            {DASHBOARD_SYMBOLS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setState((current) => ({ ...current, symbol: item }))}
                className={cn(
                  "h-7 rounded px-3 text-xs font-medium transition",
                  state.symbol === item ? "bg-sky-500 text-white" : "text-zinc-400 hover:text-zinc-100",
                )}
              >
                {item.split("/")[0]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <KLineChartPanel symbol={state.symbol} timeframe={state.timeframe} bars={state.bars} height={420} className="rounded-md bg-[#0d0f13]" />
      {!state.bars.length && !state.loading ? (
        <div className="mt-2 text-xs text-amber-200">No live K-line data returned. Chart is intentionally empty.</div>
      ) : null}
    </section>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof BarChart3;
  tone?: "green" | "red" | "amber" | "neutral";
}) {
  const toneMap = {
    green: "text-emerald-300 bg-emerald-400/10 border-emerald-400/15",
    red: "text-red-300 bg-red-400/10 border-red-400/15",
    amber: "text-amber-300 bg-amber-400/10 border-amber-400/15",
    neutral: "text-sky-300 bg-sky-400/10 border-sky-400/15",
  };
  return (
    <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-md border", toneMap[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-4 text-2xl font-semibold text-zinc-50">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

export function Dashboard() {
  const [account, setAccount] = useState<DashboardAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kline, setKline] = useState<KlineState>({ symbol: "BTC/USDT", timeframe: "5m", bars: [], loading: false });
  const requestVersionRef = useRef(0);
  const klineRequestVersionRef = useRef(0);

  const loadAccount = useCallback(async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setRefreshing(true);
    try {
      const deployments = await api.listDeployments();
      const deployment = deployments.deployments.find((item) => item.target === "SHADOW" && item.status !== "ARCHIVED")
        ?? deployments.deployments.find((item) => item.target === "SHADOW")
        ?? deployments.deployments[0];
      if (!deployment) {
        if (requestVersionRef.current !== requestVersion) return;
        setAccount(null);
        return;
      }
      const [snapshot, orders] = await Promise.all([
        api.getQuantaxisAccountSnapshot(deployment.account_cookie),
        api.listQuantaxisAccountOrders(deployment.account_cookie),
      ]);
      if (requestVersionRef.current !== requestVersion) return;
      setAccount(dashboardAccount(snapshot, orders.orders));
    } catch {
      if (requestVersionRef.current !== requestVersion) return;
      setAccount(null);
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadKlines = useCallback(async (symbol = kline.symbol, timeframe = kline.timeframe) => {
    const requestVersion = klineRequestVersionRef.current + 1;
    klineRequestVersionRef.current = requestVersion;
    setKline((current) => ({ ...current, loading: true }));
    try {
      const payload = await api.getCryptoKlines(symbol, timeframe, 180);
      if (klineRequestVersionRef.current !== requestVersion) return;
      setKline((current) => ({ ...current, bars: payload.status === "ok" ? payload.bars : [], loading: false }));
    } catch {
      if (klineRequestVersionRef.current !== requestVersion) return;
      setKline((current) => ({ ...current, bars: [], loading: false }));
    }
  }, [kline.symbol, kline.timeframe]);

  useEffect(() => {
    void loadAccount();
    const timer = window.setInterval(() => {
      void loadAccount();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadAccount]);

  useEffect(() => {
    void loadKlines(kline.symbol, kline.timeframe);
    const timer = window.setInterval(() => {
      void loadKlines(kline.symbol, kline.timeframe);
    }, KLINE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadKlines, kline.symbol, kline.timeframe]);

  const accounts = account?.accounts ?? {};
  const orders = account?.orders ?? [];
  const marketPrices = account?.market_prices ?? {};
  const equitySeries = useMemo(() => (account ? buildEquitySeries(account) : []), [account]);

  const equityValue = useMemo(
    () => account?.total_asset ?? 0,
    [account],
  );
  const cashValue = useMemo(
    () => (account?.cash ?? 0) + (account?.frozen ?? 0),
    [account],
  );
  const investedValue = Math.max(account?.market_value ?? equityValue - cashValue, 0);
  const pnl = equityValue - INITIAL_VIRTUAL_CAPITAL;
  const pnlPct = INITIAL_VIRTUAL_CAPITAL > 0 ? (pnl / INITIAL_VIRTUAL_CAPITAL) * 100 : 0;
  const exposurePct = equityValue > 0 ? (investedValue / equityValue) * 100 : 0;

  const activeOrders = orders.filter((order) => order.status === "PENDING" || order.status === "PARTIALLY_FILLED");
  const filledOrders = orders.filter((order) => order.status === "FILLED");
  const closedOrders = orders.filter((order) => order.status === "CANCELED" || order.status === "EXPIRED" || order.status === "REJECTED");
  const topAccounts = Object.values(accounts).sort((a, b) => accountValue(b, marketPrices) - accountValue(a, marketPrices));

  if (loading && !account) {
    return (
      <main className="flex min-h-full items-center justify-center bg-[#0b0d10] text-sm text-zinc-400">
        Loading account...
      </main>
    );
  }

  return (
    <main className="min-h-full overflow-auto bg-[#0b0d10] text-zinc-100">
      <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-orange-300">Shadow Account Dashboard</div>
            <h1 className="mt-1 text-2xl font-semibold text-white">Portfolio Performance</h1>
          </div>
          <button
            type="button"
            onClick={() => void loadAccount()}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Account Value"
            value={formatMoney(equityValue || INITIAL_VIRTUAL_CAPITAL)}
            sub="Mark-to-market across cash and positions"
            icon={WalletCards}
          />
          <StatCard
            label="Net PnL"
            value={formatMoney(pnl)}
            sub={formatPercent(pnlPct)}
            icon={pnl >= 0 ? TrendingUp : TrendingDown}
            tone={pnl >= 0 ? "green" : "red"}
          />
          <StatCard
            label="Cash"
            value={formatMoney(cashValue)}
            sub="Quote currency balance"
            icon={BarChart3}
            tone="neutral"
          />
          <StatCard
            label="Exposure"
            value={formatPercent(exposurePct)}
            sub={`${activeOrders.length} open orders`}
            icon={Activity}
            tone={exposurePct >= 50 ? "amber" : "neutral"}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <KlineSection state={kline} setState={setKline} />
            <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <BarChart3 className="h-4 w-4 text-orange-300" />
                    Net Value Curve
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Since inception performance reconstructed from fills and current mark prices
                  </div>
                </div>
                <span className="flex items-center gap-1 text-xs text-zinc-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  {equitySeries.length} points
                </span>
              </div>
              <StrategyReturnChart data={equitySeries} initialCapital={INITIAL_VIRTUAL_CAPITAL} height={360} />
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#111318]">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Assets</h2>
                  <p className="mt-1 text-xs text-zinc-500">Cash and marked positions</p>
                </div>
                <Database className="h-4 w-4 text-sky-300" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead className="bg-[#171a20] text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Asset</th>
                      <th className="px-4 py-3 text-right font-medium">Balance</th>
                      <th className="px-4 py-3 text-right font-medium">Frozen</th>
                      <th className="px-4 py-3 text-right font-medium">Mark</th>
                      <th className="px-4 py-3 text-right font-medium">Value</th>
                      <th className="px-4 py-3 text-right font-medium">Weight</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {topAccounts.map((assetAccount) => {
                      const value = accountValue(assetAccount, marketPrices);
                      const weight = equityValue > 0 ? (value / equityValue) * 100 : 0;
                      const mark = assetPrice(assetAccount.asset, marketPrices);
                      return (
                        <tr key={assetAccount.asset}>
                          <td className="px-4 py-3 font-semibold text-zinc-100">{assetAccount.asset}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-100">{assetAccount.balance.toFixed(6).replace(/\.?0+$/, "")}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-400">{assetAccount.frozen.toFixed(6).replace(/\.?0+$/, "")}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-300">{mark ? formatMoney(mark) : "--"}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-100">{formatMoney(value)}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-500">{formatPercent(weight)}</td>
                        </tr>
                      );
                    })}
                    {!topAccounts.length ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-500">
                          No shadow account data yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-100">Order Summary</div>
                <WalletCards className="h-4 w-4 text-sky-300" />
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-md bg-[#181b21] px-3 py-2">
                  <span className="text-zinc-400">Filled</span>
                  <span className="font-mono text-emerald-300">{filledOrders.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-[#181b21] px-3 py-2">
                  <span className="text-zinc-400">Open</span>
                  <span className="font-mono text-amber-300">{activeOrders.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-[#181b21] px-3 py-2">
                  <span className="text-zinc-400">Closed</span>
                  <span className="font-mono text-zinc-200">{closedOrders.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-[#181b21] px-3 py-2">
                  <span className="text-zinc-400">Last update</span>
                  <span className="font-mono text-zinc-300">{account?.updated_at ? formatDate(account.updated_at) : "--"}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="text-sm font-semibold text-zinc-100">Recent Orders</div>
              <div className="mt-4 space-y-3">
                {orders.slice(0, 6).map((order) => (
                  <div key={order.order_id} className="rounded-md bg-[#181b21] px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-zinc-100">{order.symbol}</div>
                      <span className={cn("font-mono", order.side === "BUY" ? "text-emerald-300" : "text-red-300")}>{order.side}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-zinc-500">
                      <span>{order.order_type}</span>
                      <span>{order.status}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 font-mono text-zinc-300">
                      <span>{formatMoney(orderExecutedPrice(order))}</span>
                      <span>{orderFilledQuantity(order).toFixed(4).replace(/\.?0+$/, "")}</span>
                    </div>
                  </div>
                ))}
                {!orders.length ? (
                  <div className="rounded-md bg-[#181b21] px-3 py-4 text-sm text-zinc-500">No orders yet.</div>
                ) : null}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
