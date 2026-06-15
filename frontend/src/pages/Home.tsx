import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  CandlestickChart,
  Database,
  Gauge,
  LineChart,
  RefreshCw,
  Search,
  Server,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { api, type CryptoKlineBar, type CryptoMarketRow, type CryptoMarketsResponse } from "@/lib/api";
import { echarts } from "@/lib/echarts";
import { cn } from "@/lib/utils";

const FALLBACK_ROWS: CryptoMarketRow[] = [
  ["BTC/USDT", "Bitcoin", 104820, 2.84],
  ["ETH/USDT", "Ethereum", 3450, 1.96],
  ["BNB/USDT", "BNB", 655, -0.52],
  ["SOL/USDT", "Solana", 164, 4.2],
  ["XRP/USDT", "XRP", 2.18, -1.31],
  ["DOGE/USDT", "Dogecoin", 0.193, 3.12],
  ["ADA/USDT", "Cardano", 0.62, 0.74],
  ["TRX/USDT", "TRON", 0.286, 0.19],
  ["AVAX/USDT", "Avalanche", 28.4, -2.18],
  ["SHIB/USDT", "Shiba Inu", 0.0000142, 1.47],
  ["LINK/USDT", "Chainlink", 15.8, 2.24],
  ["TON/USDT", "Toncoin", 3.15, -0.68],
  ["DOT/USDT", "Polkadot", 4.72, 1.08],
].map(([symbol, name, price, change], index) => {
  const rank = index + 1;
  const quoteVolume = Number(price) * (1_800_000_000 / Number(price)) / rank ** 0.7;
  return {
    rank,
    symbol: String(symbol),
    base: String(symbol).split("/")[0],
    name: String(name),
    price: Number(price),
    change_24h: Number(change),
    high_24h: Number(price) * 1.035,
    low_24h: Number(price) * 0.965,
    volume_24h: quoteVolume / Number(price),
    quote_volume_24h: quoteVolume,
    market_cap: quoteVolume * (20 + rank),
    funding_rate: Math.sin(rank) * 0.02,
    open_interest: quoteVolume * 0.2,
    liquidation_24h: quoteVolume * 0.004,
  };
});

const FALLBACK_MARKETS: CryptoMarketsResponse = {
  status: "ok",
  source: "frontend fallback",
  updated_at: new Date().toISOString(),
  symbols: FALLBACK_ROWS.map((row) => row.symbol),
  rows: FALLBACK_ROWS,
  aggregate: {
    market_cap: FALLBACK_ROWS.reduce((sum, row) => sum + row.market_cap, 0),
    volume_24h: FALLBACK_ROWS.reduce((sum, row) => sum + row.quote_volume_24h, 0),
    open_interest: FALLBACK_ROWS.reduce((sum, row) => sum + row.open_interest, 0),
    liquidation_24h: FALLBACK_ROWS.reduce((sum, row) => sum + row.liquidation_24h, 0),
    avg_change_24h: FALLBACK_ROWS.reduce((sum, row) => sum + row.change_24h, 0) / FALLBACK_ROWS.length,
    btc_dominance: 48.6,
  },
};

const TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;

function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(4)}`;
}

function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercent(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

function toneClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-zinc-300";
}

function buildFallbackBars(symbol: string, limit = 180): CryptoKlineBar[] {
  const row = FALLBACK_ROWS.find((item) => item.symbol === symbol) ?? FALLBACK_ROWS[0];
  const now = Date.now();
  let previous = row.price;
  return Array.from({ length: limit }, (_, index) => {
    const timestamp = now - (limit - index - 1) * 60 * 60 * 1000;
    const wave = Math.sin(index / 7) * 0.012 + Math.cos(index / 13) * 0.008;
    const close = row.price * (1 + wave + (index - limit / 2) / limit * 0.04);
    const open = previous;
    const high = Math.max(open, close) * 1.007;
    const low = Math.min(open, close) * 0.993;
    previous = close;
    return {
      time: new Date(timestamp).toISOString(),
      timestamp,
      symbol,
      open,
      high,
      low,
      close,
      volume: row.volume_24h / 24,
    };
  });
}

function MetricBox({
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
    <div className="MuiBox-root cg-style-u54ou rounded-lg border border-zinc-800 bg-[#111318] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-md border", toneMap[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-4 text-2xl font-semibold tracking-normal text-zinc-50">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

function KlinePanel({
  symbol,
  timeframe,
  bars,
  loading,
}: {
  symbol: string;
  timeframe: string;
  bars: CryptoKlineBar[];
  loading: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(ref.current);
    return () => {
      resize.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const dates = bars.map((bar) => bar.time.slice(5, 16).replace("T", " "));
    const candles = bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]);
    const volumes = bars.map((bar) => ({
      value: bar.volume,
      itemStyle: { color: bar.close >= bar.open ? "rgba(16,185,129,0.45)" : "rgba(248,113,113,0.45)" },
    }));

    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(15,18,24,0.96)",
        borderColor: "#272a33",
        textStyle: { color: "#e5e7eb", fontSize: 11 },
      },
      grid: [
        { left: 8, right: 8, top: 12, height: "63%", containLabel: true },
        { left: 8, right: 8, top: "76%", height: "15%", containLabel: true },
      ],
      xAxis: [
        { type: "category", data: dates, boundaryGap: true, axisLine: { lineStyle: { color: "#2b2f3a" } }, axisLabel: { color: "#71717a", fontSize: 10 } },
        { type: "category", data: dates, gridIndex: 1, boundaryGap: true, axisLine: { lineStyle: { color: "#2b2f3a" } }, axisLabel: { show: false } },
      ],
      yAxis: [
        { scale: true, splitLine: { lineStyle: { color: "rgba(63,63,70,0.45)" } }, axisLabel: { color: "#71717a", fontSize: 10 } },
        { scale: true, gridIndex: 1, splitLine: { show: false }, axisLabel: { color: "#71717a", fontSize: 10, formatter: (value: number) => formatNumber(value) } },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: Math.max(0, 100 - (100 * 90) / Math.max(bars.length, 1)), end: 100 },
      ],
      series: [
        {
          name: symbol,
          type: "candlestick",
          data: candles,
          itemStyle: {
            color: "#10b981",
            color0: "#ef4444",
            borderColor: "#10b981",
            borderColor0: "#ef4444",
          },
        },
        { name: "Vol", type: "bar", data: volumes, xAxisIndex: 1, yAxisIndex: 1 },
      ],
    }, true);
  }, [bars, symbol]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <CandlestickChart className="h-4 w-4 text-orange-300" />
            {symbol} Perpetual Index
          </div>
          <div className="mt-1 text-xs text-zinc-500">{timeframe.toUpperCase()} K-line synced from backend cache</div>
        </div>
        {loading ? (
          <RefreshCw className="h-4 w-4 animate-spin text-zinc-500" />
        ) : (
          <LineChart className="h-4 w-4 text-emerald-400" />
        )}
      </div>
      <div ref={ref} className="h-[320px] w-full" />
    </div>
  );
}

export function Home() {
  const [markets, setMarkets] = useState<CryptoMarketsResponse>(FALLBACK_MARKETS);
  const [selectedSymbol, setSelectedSymbol] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("1h");
  const [bars, setBars] = useState<CryptoKlineBar[]>(() => buildFallbackBars("BTC/USDT"));
  const [marketLoading, setMarketLoading] = useState(false);
  const [klineLoading, setKlineLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selectedRow = markets.rows.find((row) => row.symbol === selectedSymbol) ?? markets.rows[0];

  const loadMarkets = async () => {
    setMarketLoading(true);
    setError(null);
    try {
      const payload = await api.getCryptoMarkets(13);
      setMarkets(payload);
      if (!payload.rows.some((row) => row.symbol === selectedSymbol)) {
        setSelectedSymbol(payload.rows[0]?.symbol ?? "BTC/USDT");
      }
    } catch (err) {
      setMarkets(FALLBACK_MARKETS);
      setError(err instanceof Error ? err.message : "Failed to load market data");
    } finally {
      setMarketLoading(false);
    }
  };

  useEffect(() => {
    void loadMarkets();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setKlineLoading(true);
    api.getCryptoKlines(selectedSymbol, timeframe, 180)
      .then((payload) => {
        if (!cancelled) setBars(payload.bars);
      })
      .catch(() => {
        if (!cancelled) setBars(buildFallbackBars(selectedSymbol));
      })
      .finally(() => {
        if (!cancelled) setKlineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, timeframe]);

  const filteredRows = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return markets.rows;
    return markets.rows.filter((row) => row.symbol.toLowerCase().includes(clean) || row.name.toLowerCase().includes(clean));
  }, [markets.rows, query]);

  const longShort = selectedRow.change_24h >= 0 ? "Long Bias" : "Short Pressure";

  return (
    <main className="min-h-full overflow-auto bg-[#0b0d10] text-zinc-100">
      <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-orange-300">Crypto Derivatives Dashboard</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-white">Cryptocurrency Data Analysis</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Server className="h-4 w-4 text-zinc-400" />
            <span>Source: {markets.source}</span>
            <button
              type="button"
              onClick={() => void loadMarkets()}
              className="ml-2 inline-flex h-8 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", marketLoading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricBox label="Total Market Cap" value={formatMoney(markets.aggregate.market_cap)} sub={`BTC dominance ${markets.aggregate.btc_dominance.toFixed(2)}%`} icon={BarChart3} />
          <MetricBox label="24h Volume" value={formatMoney(markets.aggregate.volume_24h)} sub="Spot volume across top assets" icon={Activity} tone="green" />
          <MetricBox label="Open Interest" value={formatMoney(markets.aggregate.open_interest)} sub={`${formatPercent(markets.aggregate.avg_change_24h)} average move`} icon={Gauge} tone={markets.aggregate.avg_change_24h >= 0 ? "green" : "red"} />
          <MetricBox label="Liquidation 24h" value={formatMoney(markets.aggregate.liquidation_24h)} sub="Estimated risk flush monitor" icon={TrendingDown} tone="amber" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <div className="hs2 MuiBox-root cg-style-bzykof rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md bg-[#181b21] p-3">
                  <div className="text-xs text-zinc-500">Selected</div>
                  <div className="mt-2 text-xl font-semibold text-white">{selectedSymbol}</div>
                </div>
                <div className="rounded-md bg-[#181b21] p-3">
                  <div className="text-xs text-zinc-500">Price</div>
                  <div className="mt-2 text-xl font-semibold text-white">{formatMoney(selectedRow.price)}</div>
                </div>
                <div className="rounded-md bg-[#181b21] p-3">
                  <div className="text-xs text-zinc-500">24h Change</div>
                  <div className={cn("mt-2 flex items-center gap-1 text-xl font-semibold", toneClass(selectedRow.change_24h))}>
                    {selectedRow.change_24h >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {formatPercent(selectedRow.change_24h)}
                  </div>
                </div>
                <div className="rounded-md bg-[#181b21] p-3">
                  <div className="text-xs text-zinc-500">Funding / Bias</div>
                  <div className="mt-2 text-xl font-semibold text-white">{formatPercent(selectedRow.funding_rate, 4)}</div>
                  <div className="mt-1 text-xs text-zinc-500">{longShort}</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">K-line Data</div>
                  <div className="mt-1 text-xs text-zinc-500">Redis cache + TimescaleDB persistence through backend API</div>
                </div>
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
              <KlinePanel symbol={selectedSymbol} timeframe={timeframe} bars={bars} loading={klineLoading} />
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-100">Market Heat</div>
                <Database className="h-4 w-4 text-sky-300" />
              </div>
              <div className="space-y-3">
                {markets.rows.slice(0, 6).map((row) => (
                  <button
                    key={row.symbol}
                    type="button"
                    onClick={() => setSelectedSymbol(row.symbol)}
                    className={cn(
                      "grid w-full grid-cols-[72px_1fr_auto] items-center gap-3 rounded-md border px-3 py-2 text-left transition",
                      selectedSymbol === row.symbol ? "border-orange-500/40 bg-orange-500/10" : "border-zinc-800 bg-[#181b21] hover:border-zinc-700",
                    )}
                  >
                    <span className="text-xs font-semibold text-zinc-100">{row.base}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <span
                        className={cn("block h-full rounded-full", row.change_24h >= 0 ? "bg-emerald-400" : "bg-red-400")}
                        style={{ width: `${Math.min(100, Math.max(8, Math.abs(row.change_24h) * 12))}%` }}
                      />
                    </span>
                    <span className={cn("font-mono text-xs", toneClass(row.change_24h))}>{formatPercent(row.change_24h)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="text-sm font-semibold text-zinc-100">Storage Status</div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-md bg-[#181b21] px-3 py-2">
                  <span className="text-zinc-400">Redis</span>
                  <span className="font-mono text-emerald-300">127.0.0.1</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-[#181b21] px-3 py-2">
                  <span className="text-zinc-400">TimescaleDB</span>
                  <span className="font-mono text-sky-300">venus</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-[#181b21] px-3 py-2">
                  <span className="text-zinc-400">Rows</span>
                  <span className="font-mono text-zinc-200">{markets.rows.length}</span>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-[#111318]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-white">Cryptocurrency Data Analysis</h2>
              <p className="mt-1 text-xs text-zinc-500">Mainstream coins, top 13 by dashboard watchlist</p>
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full rounded-md border border-zinc-800 bg-[#0d0f13] pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500/60"
                placeholder="Search symbol"
              />
            </div>
          </div>
          {error ? <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">{error}</div> : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-sm">
              <thead className="ant-table-thead bg-[#171a20] text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">#</th>
                  <th className="px-4 py-3 text-left font-medium">Symbol</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">24h</th>
                  <th className="px-4 py-3 text-right font-medium">Funding</th>
                  <th className="px-4 py-3 text-right font-medium">24h Volume</th>
                  <th className="px-4 py-3 text-right font-medium">Market Cap</th>
                  <th className="px-4 py-3 text-right font-medium">Open Interest</th>
                  <th className="px-4 py-3 text-right font-medium">Liquidation 24h</th>
                </tr>
              </thead>
              <tbody className="ant-table-tbody divide-y divide-zinc-800">
                {filteredRows.map((row) => (
                  <tr
                    key={row.symbol}
                    onClick={() => setSelectedSymbol(row.symbol)}
                    className={cn(
                      "cursor-pointer transition hover:bg-zinc-800/50",
                      selectedSymbol === row.symbol && "bg-orange-500/10",
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{row.rank}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-100">{row.base.slice(0, 3)}</span>
                        <div>
                          <div className="font-semibold text-zinc-100">{row.symbol}</div>
                          <div className="text-xs text-zinc-500">{row.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-100">{formatMoney(row.price)}</td>
                    <td className={cn("px-4 py-3 text-right font-mono font-semibold", toneClass(row.change_24h))}>{formatPercent(row.change_24h)}</td>
                    <td className={cn("px-4 py-3 text-right font-mono", toneClass(row.funding_rate))}>{formatPercent(row.funding_rate, 4)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatMoney(row.quote_volume_24h)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatMoney(row.market_cap)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatMoney(row.open_interest)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatMoney(row.liquidation_24h)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
