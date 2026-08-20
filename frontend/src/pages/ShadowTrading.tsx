import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickChart, LineChart, RefreshCw, WalletCards } from "lucide-react";
import { KLineChartPanel } from "@/components/charts/KLineChartPanel";
import { api, type CryptoKlineBar, type QIFIOrder, type ShadowAccountResponse, type ShadowOrder } from "@/lib/api";
import { cn } from "@/lib/utils";

const REFRESH_MS = 10_000;
const KLINE_REFRESH_MS = 3_500;
const TIMEFRAMES = ["5m", "15m", "1h", "1d"] as const;
function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(4)}`;
}

function formatNumber(value: number, decimals = 6): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace("/", "_").replace("-", "_");
}

function splitSymbol(symbol: string): [string, string] {
  const [base = "", quote = "USDT"] = normalizeSymbol(symbol).split("_");
  return [base, quote];
}

function displaySymbol(symbol: string): string {
  return normalizeSymbol(symbol).replace("_", "/");
}

function availableAsset(account: ShadowAccountResponse | null, asset: string): number {
  return account?.accounts?.[asset]?.available ?? 0;
}

function marketPrice(account: ShadowAccountResponse | null, symbol: string): number {
  const normalized = normalizeSymbol(symbol);
  return account?.market_prices?.[normalized] ?? 0;
}

function symbolsFromAccount(account: ShadowAccountResponse | null): string[] {
  if (!account) return [];
  const symbols = new Set<string>([
    ...Object.keys(account.market_prices ?? {}),
    ...Object.keys(account.positions ?? {}),
    ...account.orders.map((order) => normalizeSymbol(order.symbol)),
  ]);
  return Array.from(symbols).filter(Boolean).sort();
}

function orderTime(order: ShadowOrder): string {
  return order.updated_at ? new Date(order.updated_at * 1000).toISOString() : new Date(order.timestamp * 1000).toISOString();
}

function qifiOrderTime(order: QIFIOrder): string {
  return order.datetime;
}

export function ShadowTrading() {
  const [account, setAccount] = useState<ShadowAccountResponse | null>(null);
  const [orders, setOrders] = useState<ShadowOrder[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderTypeValue, setOrderTypeValue] = useState<"MARKET" | "LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("5m");
  const [bars, setBars] = useState<CryptoKlineBar[]>([]);
  const [klineLoading, setKlineLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const klineRequestVersionRef = useRef(0);

  const loadAccount = useCallback(async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setRefreshing(true);
    try {
      const [accountPayload, orderPayload] = await Promise.all([
        api.getShadowAccount(),
        api.listShadowOrders(),
      ]);
      if (requestVersionRef.current !== requestVersion) return;
      setAccount(accountPayload);
      setOrders(orderPayload);
      const symbols = symbolsFromAccount(accountPayload);
      setSelectedSymbol((current) => current || symbols[0] || "BTC_USDT");
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) return;
      setAccount(null);
      setOrders([]);
      setMessage(error instanceof Error ? error.message : "加载模拟盘账户失败。");
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadAccount();
    const timer = window.setInterval(() => void loadAccount(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadAccount]);

  const symbols = useMemo(() => symbolsFromAccount(account), [account]);
  const normalizedSymbol = normalizeSymbol(selectedSymbol || symbols[0] || "BTC_USDT");
  const chartSymbol = displaySymbol(normalizedSymbol);
  const [baseAsset, quoteAsset] = splitSymbol(normalizedSymbol);
  const markPrice = marketPrice(account, normalizedSymbol);
  const effectivePrice = orderTypeValue === "LIMIT" ? Number(limitPrice) : markPrice;
  const orderQuantity = Number(quantity);
  const quoteAvailable = availableAsset(account, quoteAsset);
  const baseAvailable = availableAsset(account, baseAsset);
  const requiredQuote = effectivePrice > 0 && orderQuantity > 0 ? effectivePrice * orderQuantity : 0;
  const accountVirtual = account?.account_type === "VIRTUAL";

  const disabledReason = useMemo(() => {
    if (submitting) return "订单提交中";
    if (!account) return "模拟盘账户未加载";
    if (!accountVirtual) return "模拟盘只允许 VIRTUAL 账户下单";
    if (!normalizedSymbol) return "请选择标的";
    if (!orderQuantity || orderQuantity <= 0) return "请输入有效数量";
    if (orderTypeValue === "MARKET" && markPrice <= 0) return "缺少模拟盘行情价";
    if (orderTypeValue === "LIMIT" && effectivePrice <= 0) return "请输入有效限价";
    if (side === "BUY" && requiredQuote > quoteAvailable) return `${quoteAsset} 可用余额不足`;
    if (side === "SELL" && orderQuantity > baseAvailable) return `${baseAsset} 可用持仓不足`;
    return "";
  }, [
    account,
    accountVirtual,
    baseAsset,
    baseAvailable,
    effectivePrice,
    markPrice,
    normalizedSymbol,
    orderQuantity,
    orderTypeValue,
    quoteAsset,
    quoteAvailable,
    requiredQuote,
    side,
    submitting,
  ]);

  const canSubmit = !disabledReason;
  const recentShadowOrders = orders;
  const recentQifiOrders = account?.orders ?? [];

  const loadKlines = useCallback(async () => {
    const requestVersion = klineRequestVersionRef.current + 1;
    klineRequestVersionRef.current = requestVersion;
    setKlineLoading(true);
    try {
      const payload = await api.getCryptoKlines(chartSymbol, timeframe, 180);
      if (klineRequestVersionRef.current !== requestVersion) return;
      setBars(payload.status === "ok" ? payload.bars : []);
    } catch {
      if (klineRequestVersionRef.current !== requestVersion) return;
      setBars([]);
    } finally {
      if (klineRequestVersionRef.current === requestVersion) {
        setKlineLoading(false);
      }
    }
  }, [chartSymbol, timeframe]);

  useEffect(() => {
    void loadKlines();
    const timer = window.setInterval(() => {
      void loadKlines();
    }, KLINE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadKlines]);

  const submitOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      setMessage(disabledReason);
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const order = await api.placeShadowOrder({
        symbol: normalizedSymbol,
        side,
        order_type: orderTypeValue,
        quantity: orderQuantity,
        ...(orderTypeValue === "LIMIT" ? { price: effectivePrice } : {}),
      });
      await loadAccount();
      setMessage(`${order.status === "FILLED" ? "已成交" : "已提交"} · ${side === "BUY" ? "买入" : "卖出"} ${formatNumber(orderQuantity)} ${baseAsset}`);
      setQuantity("");
      setLimitPrice("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "模拟盘下单失败。");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !account) {
    return (
      <main className="flex min-h-full items-center justify-center bg-[#0b0d10] text-sm text-zinc-400">
        Loading shadow account...
      </main>
    );
  }

  return (
    <main className="min-h-full overflow-auto bg-[#0b0d10] text-zinc-100">
      <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-orange-300">QUANTAXIS Shadow Trading</div>
            <h1 className="mt-1 text-2xl font-semibold text-white">模拟盘交易</h1>
          </div>
          <button
            type="button"
            onClick={() => void loadAccount()}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            刷新
          </button>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <section className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <CandlestickChart className="h-4 w-4 text-orange-300" />
                    模拟盘 K 线
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">{chartSymbol} · {timeframe.toUpperCase()} · QUANTAXIS/OKX 行情</div>
                </div>
                <div className="flex items-center gap-2">
                  {klineLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-zinc-500" />
                  ) : (
                    <LineChart className="h-4 w-4 text-emerald-400" />
                  )}
                  <div className="flex rounded-md border border-zinc-800 bg-[#0d0f13] p-1">
                    {TIMEFRAMES.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setTimeframe(item)}
                        className={cn(
                          "h-7 rounded px-3 text-xs font-medium transition",
                          timeframe === item ? "bg-orange-500 text-white" : "text-zinc-400 hover:text-zinc-100",
                        )}
                      >
                        {item.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <KLineChartPanel symbol={chartSymbol} timeframe={timeframe} bars={bars} height={360} className="rounded-md bg-[#0d0f13]" />
              {!bars.length && !klineLoading ? (
                <div className="mt-2 text-xs text-amber-200">暂无 K 线数据。</div>
              ) : null}
            </section>

            <section className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <WalletCards className="h-4 w-4 text-sky-300" />
                  总资产
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">{formatMoney(account?.total_asset ?? 0)}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
                <div className="text-xs text-zinc-400">可用现金</div>
                <div className="mt-3 text-2xl font-semibold text-emerald-300">{formatMoney(quoteAvailable)}</div>
                <div className="mt-1 text-xs text-zinc-500">{quoteAsset}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
                <div className="text-xs text-zinc-400">冻结资金</div>
                <div className="mt-3 text-2xl font-semibold text-amber-200">{formatMoney(account?.frozen ?? 0)}</div>
              </div>
            </section>

            <section className="rounded-lg border border-zinc-800 bg-[#111318]">
              <div className="border-b border-zinc-800 px-4 py-3">
                <h2 className="text-sm font-semibold text-white">持仓与资金</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-[#171a20] text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Asset</th>
                      <th className="px-4 py-3 text-right font-medium">Balance</th>
                      <th className="px-4 py-3 text-right font-medium">Frozen</th>
                      <th className="px-4 py-3 text-right font-medium">Available</th>
                      <th className="px-4 py-3 text-right font-medium">Equity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {Object.values(account?.accounts ?? {}).map((item) => (
                      <tr key={item.asset}>
                        <td className="px-4 py-3 font-semibold text-zinc-100">{item.asset}</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatNumber(item.balance)}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-200">{formatNumber(item.frozen)}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-300">{formatNumber(item.available)}</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatNumber(item.equity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <form onSubmit={submitOrder} className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="mb-4">
                <div className="text-sm font-semibold text-white">模拟盘委托</div>
                <div className="mt-1 text-xs text-zinc-500">{account?.account_cookie ?? "shadow"} · {account?.account_type ?? "VIRTUAL"}</div>
              </div>

              <label className="block text-xs text-zinc-400">
                标的
                <select
                  value={normalizedSymbol}
                  onChange={(event) => setSelectedSymbol(event.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-zinc-800 bg-[#0d0f13] px-2 text-sm text-white"
                >
                  {(symbols.length ? symbols : [normalizedSymbol]).map((symbol) => (
                    <option key={symbol} value={symbol}>{symbol}</option>
                  ))}
                </select>
              </label>

              <div className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-[#0d0f13] p-1">
                {(["BUY", "SELL"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setSide(item)}
                    className={cn(
                      "h-8 rounded text-xs font-semibold",
                      side === item ? item === "BUY" ? "bg-emerald-500 text-white" : "bg-red-500 text-white" : "text-zinc-400 hover:text-white",
                    )}
                  >
                    {item === "BUY" ? "买入" : "卖出"}
                  </button>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-[#0d0f13] p-1">
                {(["MARKET", "LIMIT"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setOrderTypeValue(item)}
                    className={cn("h-8 rounded text-xs font-medium", orderTypeValue === item ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-200")}
                  >
                    {item === "MARKET" ? "市价" : "限价"}
                  </button>
                ))}
              </div>

              {orderTypeValue === "LIMIT" ? (
                <label className="mt-3 block text-xs text-zinc-400">
                  限价
                  <input
                    value={limitPrice}
                    onChange={(event) => setLimitPrice(event.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    placeholder={String(markPrice || "")}
                    className="mt-1 h-9 w-full rounded-md border border-zinc-800 bg-[#0d0f13] px-3 text-sm text-white outline-none focus:border-orange-500/60"
                  />
                </label>
              ) : null}

              <label className="mt-3 block text-xs text-zinc-400">
                数量 ({baseAsset})
                <input
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#0d0f13] px-3 text-sm text-white outline-none focus:border-orange-500/60"
                />
              </label>

              <div className="mt-4 space-y-2 rounded-md bg-[#181b21] p-3 text-xs">
                <div className="flex justify-between"><span className="text-zinc-500">行情价</span><span className="font-mono text-zinc-200">{markPrice > 0 ? formatMoney(markPrice) : "--"}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">{quoteAsset} 可用</span><span className="font-mono text-emerald-300">{formatMoney(quoteAvailable)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">{baseAsset} 可用</span><span className="font-mono text-zinc-200">{formatNumber(baseAvailable)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">预计占用</span><span className="font-mono text-amber-200">{formatMoney(requiredQuote)}</span></div>
              </div>

              <button
                disabled={!canSubmit}
                type="submit"
                title={disabledReason || undefined}
                className={cn(
                  "mt-4 h-10 w-full rounded-md text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50",
                  side === "BUY" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500",
                )}
              >
                {submitting ? "提交中..." : `${side === "BUY" ? "买入" : "卖出"} ${baseAsset}`}
              </button>
              {message ? <div className="mt-2 text-xs text-amber-200">{message}</div> : null}
              {disabledReason && !submitting ? <div className="mt-2 text-xs text-zinc-500">{disabledReason}</div> : null}
            </form>

            <section className="rounded-lg border border-zinc-800 bg-[#111318]">
              <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-white">最近委托</div>
              <div className="divide-y divide-zinc-800">
                {(recentShadowOrders.length
                  ? recentShadowOrders.slice(0, 6).map((order) => (
                      <div key={order.order_id} className="px-4 py-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-zinc-100">{normalizeSymbol(order.symbol)}</span>
                          <span className={cn("font-mono", order.side === "BUY" ? "text-emerald-300" : "text-red-300")}>{order.side}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-zinc-500">
                          <span>{order.type} · {order.status}</span>
                          <span>{formatNumber(order.quantity)} @ {formatMoney(order.price)}</span>
                        </div>
                        <div className="mt-1 text-zinc-600">{orderTime(order)}</div>
                      </div>
                    ))
                  : recentQifiOrders.slice(0, 6).map((order) => (
                      <div key={order.order_id} className="px-4 py-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-zinc-100">{normalizeSymbol(order.symbol)}</span>
                          <span className={cn("font-mono", order.side === "buy" ? "text-emerald-300" : "text-red-300")}>{order.side.toUpperCase()}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-zinc-500">
                          <span>{order.order_type} · {order.status}</span>
                          <span>{formatNumber(order.quantity)} @ {formatMoney(order.price)}</span>
                        </div>
                        <div className="mt-1 text-zinc-600">{qifiOrderTime(order)}</div>
                      </div>
                    )))}
                {!recentShadowOrders.length && !recentQifiOrders.length ? <div className="px-4 py-6 text-center text-xs text-zinc-500">暂无委托记录</div> : null}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
