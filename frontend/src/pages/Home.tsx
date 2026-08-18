import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { KLineChartPanel } from "@/components/charts/KLineChartPanel";
import { api, type CryptoKlineBar, type CryptoMarketRow, type CryptoMarketsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

type CoinSeed = {
  symbol: string;
  name: string;
  iconBg: string;
  iconFg: string;
};

const COIN_SEEDS: CoinSeed[] = [
  { symbol: "BTC/USDT", name: "Bitcoin", iconBg: "#f7931a", iconFg: "#111827" },
  { symbol: "ETH/USDT", name: "Ethereum", iconBg: "#627eea", iconFg: "#ffffff" },
  { symbol: "BNB/USDT", name: "BNB", iconBg: "#f3ba2f", iconFg: "#111827" },
  { symbol: "SOL/USDT", name: "Solana", iconBg: "#14f195", iconFg: "#111827" },
  { symbol: "XRP/USDT", name: "XRP", iconBg: "#d1d5db", iconFg: "#111827" },
  { symbol: "DOGE/USDT", name: "Dogecoin", iconBg: "#c2a633", iconFg: "#111827" },
  { symbol: "ADA/USDT", name: "Cardano", iconBg: "#3468d1", iconFg: "#ffffff" },
  { symbol: "TRX/USDT", name: "TRON", iconBg: "#ef0027", iconFg: "#ffffff" },
  { symbol: "AVAX/USDT", name: "Avalanche", iconBg: "#e84142", iconFg: "#ffffff" },
  { symbol: "SHIB/USDT", name: "Shiba Inu", iconBg: "#f00500", iconFg: "#ffffff" },
  { symbol: "LINK/USDT", name: "Chainlink", iconBg: "#2a5ada", iconFg: "#ffffff" },
  { symbol: "TON/USDT", name: "Toncoin", iconBg: "#0098ea", iconFg: "#ffffff" },
  { symbol: "DOT/USDT", name: "Polkadot", iconBg: "#e6007a", iconFg: "#ffffff" },
];

const COIN_ICON_META = new Map(
  COIN_SEEDS.map((coin) => [
    coin.symbol,
    {
      base: coin.symbol.split("/")[0],
      icon_url: `/coin-icons/${coin.symbol.split("/")[0].toLowerCase()}.svg`,
      icon_bg: coin.iconBg,
      icon_fg: coin.iconFg,
    },
  ]),
);

const EMPTY_MARKETS: CryptoMarketsResponse = {
  status: "idle",
  source: "not loaded",
  updated_at: new Date().toISOString(),
  symbols: [],
  rows: [],
  aggregate: {
    market_cap: 0,
    volume_24h: 0,
    open_interest: 0,
    liquidation_24h: 0,
    avg_change_24h: 0,
    btc_dominance: 0,
  },
};

const TIMEFRAMES = ["5m", "15m", "1h", "1d"] as const;
const MARKET_REFRESH_MS = 15_000;
const KLINE_REFRESH_MS = 3_500;

function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(4)}`;
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

function withCoinMeta(row: CryptoMarketRow): CryptoMarketRow {
  const meta = COIN_ICON_META.get(row.symbol);
  if (!meta) return row;
  return {
    ...row,
    icon_url: row.icon_url || meta.icon_url,
    icon_bg: row.icon_bg || meta.icon_bg,
    icon_fg: row.icon_fg || meta.icon_fg,
  };
}

function enrichMarkets(payload: CryptoMarketsResponse): CryptoMarketsResponse {
  return {
    ...payload,
    rows: payload.rows.map(withCoinMeta),
  };
}

function CoinIcon({ row, size = "md" }: { row: CryptoMarketRow; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-7 w-7 text-[10px]" : "h-8 w-8 text-xs";
  const label = row.base.slice(0, row.base === "SHIB" ? 4 : 3);
  return (
    <span
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold shadow-inner", sizeClass)}
      style={{ backgroundColor: row.icon_bg, color: row.icon_fg }}
      title={`${row.name} icon`}
    >
      <span className="absolute inset-0 flex items-center justify-center">{label}</span>
      <img src={row.icon_url} alt="" className="relative h-full w-full rounded-full object-cover" loading="lazy" />
    </span>
  );
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
}: {
  symbol: string;
  timeframe: string;
  bars: CryptoKlineBar[];
}) {
  return <KLineChartPanel symbol={symbol} timeframe={timeframe} bars={bars} height={420} className="rounded-md bg-[#0d0f13]" />;
}

export function Home() {
  const [markets, setMarkets] = useState<CryptoMarketsResponse>(EMPTY_MARKETS);
  const [selectedSymbol, setSelectedSymbol] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("5m");
  const [bars, setBars] = useState<CryptoKlineBar[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [klineLoading, setKlineLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const marketRequestVersionRef = useRef(0);
  const klineRequestVersionRef = useRef(0);
  const selectedSymbolRef = useRef(selectedSymbol);
  const selectedRow = markets.rows.find((row) => row.symbol === selectedSymbol) ?? markets.rows[0];
  const hasMarketRows = markets.rows.length > 0;

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  const loadMarkets = useCallback(async () => {
    const requestVersion = marketRequestVersionRef.current + 1;
    marketRequestVersionRef.current = requestVersion;
    setMarketLoading(true);
    setError(null);
    try {
      const payload = await api.getCryptoMarkets(13);
      if (marketRequestVersionRef.current !== requestVersion) return;
      const enrichedPayload = enrichMarkets(payload);
      setMarkets(enrichedPayload);
      if (payload.status !== "ok" || !payload.rows.length) {
        setError("Failed to load live market prices");
        return;
      }
      if (!payload.rows.some((row) => row.symbol === selectedSymbolRef.current)) {
        setSelectedSymbol(payload.rows[0]?.symbol ?? "BTC/USDT");
      }
    } catch (err) {
      if (marketRequestVersionRef.current !== requestVersion) return;
      setMarkets(EMPTY_MARKETS);
      setError(err instanceof Error ? err.message : "Failed to load market data");
    } finally {
      if (marketRequestVersionRef.current === requestVersion) {
        setMarketLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadMarkets();
    const timer = window.setInterval(() => {
      void loadMarkets();
    }, MARKET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadMarkets]);

  const loadKlines = useCallback(async () => {
    const requestVersion = klineRequestVersionRef.current + 1;
    klineRequestVersionRef.current = requestVersion;
    setKlineLoading(true);
    try {
      const payload = await api.getCryptoKlines(selectedSymbol, timeframe, 180);
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
  }, [selectedSymbol, timeframe]);

  useEffect(() => {
    void loadKlines();
    const timer = window.setInterval(() => {
      void loadKlines();
    }, KLINE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadKlines]);

  const filteredRows = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return markets.rows;
    return markets.rows.filter((row) => row.symbol.toLowerCase().includes(clean) || row.name.toLowerCase().includes(clean));
  }, [markets.rows, query]);

  const longShort = selectedRow ? (selectedRow.change_24h >= 0 ? "Long Bias" : "Short Pressure") : "--";

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
          <MetricBox label="Total Market Cap" value="--" sub="Not provided by current source" icon={BarChart3} />
          <MetricBox label="24h Volume" value={hasMarketRows ? formatMoney(markets.aggregate.volume_24h) : "--"} sub="Spot volume across top assets" icon={Activity} tone="green" />
          <MetricBox label="Open Interest" value="--" sub={hasMarketRows ? `${formatPercent(markets.aggregate.avg_change_24h)} average move` : "No live data"} icon={Gauge} tone={markets.aggregate.avg_change_24h >= 0 ? "green" : "red"} />
          <MetricBox label="Liquidation 24h" value="--" sub="Not provided by current source" icon={TrendingDown} tone="amber" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <div className="hs2 MuiBox-root cg-style-bzykof rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md bg-[#181b21] p-3">
                  <div className="text-xs text-zinc-500">Selected</div>
                  <div className="mt-2 flex items-center gap-2 text-xl font-semibold text-white">
                    {selectedRow ? <CoinIcon row={selectedRow} size="sm" /> : null}
                    {selectedSymbol}
                  </div>
                </div>
                <div className="rounded-md bg-[#181b21] p-3">
                  <div className="text-xs text-zinc-500">Price</div>
                  <div className="mt-2 text-xl font-semibold text-white">{selectedRow ? formatMoney(selectedRow.price) : "--"}</div>
                </div>
                <div className="rounded-md bg-[#181b21] p-3">
                  <div className="text-xs text-zinc-500">24h Change</div>
                  <div className={cn("mt-2 flex items-center gap-1 text-xl font-semibold", selectedRow ? toneClass(selectedRow.change_24h) : "text-zinc-300")}>
                    {selectedRow ? selectedRow.change_24h >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" /> : null}
                    {selectedRow ? formatPercent(selectedRow.change_24h) : "--"}
                  </div>
                </div>
                <div className="rounded-md bg-[#181b21] p-3">
                  <div className="text-xs text-zinc-500">Funding / Bias</div>
                  <div className="mt-2 text-xl font-semibold text-white">--</div>
                  <div className="mt-1 text-xs text-zinc-500">{longShort}</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#111318] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <CandlestickChart className="h-4 w-4 text-orange-300" />
                    K-line Data
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {selectedSymbol} · {timeframe.toUpperCase()} · Binance REST with Coinbase secondary source
                  </div>
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
              <KlinePanel symbol={selectedSymbol} timeframe={timeframe} bars={bars} />
              {!bars.length && !klineLoading ? (
                <div className="mt-2 text-xs text-amber-200">No live K-line data returned. Chart is intentionally empty.</div>
              ) : null}
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
                    <span className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
                      <CoinIcon row={row} size="sm" />
                      {row.base}
                    </span>
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
              <div className="text-sm font-semibold text-zinc-100">Data Status</div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-md bg-[#181b21] px-3 py-2">
                  <span className="text-zinc-400">Market source</span>
                  <span className="font-mono text-emerald-300">{markets.source}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-[#181b21] px-3 py-2">
                  <span className="text-zinc-400">K-line bars</span>
                  <span className="font-mono text-sky-300">{bars.length}</span>
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
                        <CoinIcon row={row} />
                        <div>
                          <div className="font-semibold text-zinc-100">{row.symbol}</div>
                          <div className="text-xs text-zinc-500">{row.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-100">{formatMoney(row.price)}</td>
                    <td className={cn("px-4 py-3 text-right font-mono font-semibold", toneClass(row.change_24h))}>{formatPercent(row.change_24h)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">--</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatMoney(row.quote_volume_24h)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">--</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">--</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">--</td>
                  </tr>
                ))}
                {!filteredRows.length ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-zinc-500">
                      No live market prices returned.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
