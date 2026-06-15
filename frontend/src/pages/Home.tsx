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
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { api, type CryptoKlineBar, type CryptoMarketRow, type CryptoMarketsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

type CoinSeed = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  iconBg: string;
  iconFg: string;
};

const COIN_SEEDS: CoinSeed[] = [
  { symbol: "BTC/USDT", name: "Bitcoin", price: 104820, change: 2.84, iconBg: "#f7931a", iconFg: "#111827" },
  { symbol: "ETH/USDT", name: "Ethereum", price: 3450, change: 1.96, iconBg: "#627eea", iconFg: "#ffffff" },
  { symbol: "BNB/USDT", name: "BNB", price: 655, change: -0.52, iconBg: "#f3ba2f", iconFg: "#111827" },
  { symbol: "SOL/USDT", name: "Solana", price: 164, change: 4.2, iconBg: "#14f195", iconFg: "#111827" },
  { symbol: "XRP/USDT", name: "XRP", price: 2.18, change: -1.31, iconBg: "#d1d5db", iconFg: "#111827" },
  { symbol: "DOGE/USDT", name: "Dogecoin", price: 0.193, change: 3.12, iconBg: "#c2a633", iconFg: "#111827" },
  { symbol: "ADA/USDT", name: "Cardano", price: 0.62, change: 0.74, iconBg: "#3468d1", iconFg: "#ffffff" },
  { symbol: "TRX/USDT", name: "TRON", price: 0.286, change: 0.19, iconBg: "#ef0027", iconFg: "#ffffff" },
  { symbol: "AVAX/USDT", name: "Avalanche", price: 28.4, change: -2.18, iconBg: "#e84142", iconFg: "#ffffff" },
  { symbol: "SHIB/USDT", name: "Shiba Inu", price: 0.0000142, change: 1.47, iconBg: "#f00500", iconFg: "#ffffff" },
  { symbol: "LINK/USDT", name: "Chainlink", price: 15.8, change: 2.24, iconBg: "#2a5ada", iconFg: "#ffffff" },
  { symbol: "TON/USDT", name: "Toncoin", price: 3.15, change: -0.68, iconBg: "#0098ea", iconFg: "#ffffff" },
  { symbol: "DOT/USDT", name: "Polkadot", price: 4.72, change: 1.08, iconBg: "#e6007a", iconFg: "#ffffff" },
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

const FALLBACK_ROWS: CryptoMarketRow[] = COIN_SEEDS.map(({ symbol, name, price, change, iconBg, iconFg }, index) => {
  const rank = index + 1;
  const quoteVolume = price * (1_800_000_000 / price) / rank ** 0.7;
  const base = symbol.split("/")[0];
  return {
    rank,
    symbol,
    base,
    name,
    icon_url: `/coin-icons/${base.toLowerCase()}.svg`,
    icon_bg: iconBg,
    icon_fg: iconFg,
    price,
    change_24h: change,
    high_24h: price * 1.035,
    low_24h: price * 0.965,
    volume_24h: quoteVolume / price,
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

function toChartTime(timestamp: number): UTCTimestamp {
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

function buildFallbackBars(symbol: string, limit = 180): CryptoKlineBar[] {
  const row = FALLBACK_ROWS.find((item) => item.symbol === symbol) ?? FALLBACK_ROWS[0];
  const now = Date.now();
  
  // 1. 设定初始价格，加入一些随机偏移，防止切换周期时每条线都一模一样
  let currentClose = row.price * (1 + (Math.random() - 0.5) * 0.02);
  
  // 2. 根据所选的 K 线数量反推历史时间轴，按时间正序从老到新生成
  const bars: CryptoKlineBar[] = [];
  
  for (let index = 0; index < limit; index++) {
    // 假设每根 K 线时间间隔为 1 小时
    const timestamp = now - (limit - index - 1) * 60 * 60 * 1000;
    
    // 3. 开盘价等于上一根 K 线的收盘价
    const open = currentClose;
    
    // 4. 使用随机数模拟市场涨跌（限制在正负 0.6% 以内）
    const changePercent = (Math.random() - 0.5) * 0.012; 
    currentClose = open * (1 + changePercent);
    
    // 5. 制造影线：最高价与最低价在开盘和收盘的基础上向外随机延伸
    const highestOfOpenClose = Math.max(open, currentClose);
    const lowestOfOpenClose = Math.min(open, currentClose);
    
    const high = highestOfOpenClose * (1 + Math.random() * 0.004);
    const low = lowestOfOpenClose * (1 - Math.random() * 0.004);
    
    // 6. 同样为成交量注入随机性
    const volumeNoise = 0.7 + Math.random() * 0.6; // 0.7 到 1.3 的随机系数
    const volume = (row.volume_24h / 24) * volumeNoise;

    bars.push({
      time: new Date(timestamp).toISOString(),
      timestamp,
      symbol,
      open,
      high,
      low,
      close: currentClose,
      volume,
    });
  }
  
  return bars;
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
  bars,
}: {
  symbol: string;
  bars: CryptoKlineBar[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const chart = createChart(ref.current, {
      autoSize: true,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(63,63,70,0.22)" },
        horzLines: { color: "rgba(63,63,70,0.35)" },
      },
      rightPriceScale: {
        borderColor: "#27272a",
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: "#27272a",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "rgba(251,146,60,0.55)", width: 1, style: 3, labelBackgroundColor: "#f97316" },
        horzLine: { color: "rgba(251,146,60,0.55)", width: 1, style: 3, labelBackgroundColor: "#f97316" },
      },
      localization: {
        priceFormatter: (price: number) => formatMoney(price),
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#34d399",
      wickDownColor: "#f87171",
      priceLineColor: "#f97316",
      lastValueVisible: true,
      priceLineVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
      borderVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;

    const orderedBars = [...bars].sort((a, b) => a.timestamp - b.timestamp);
    const candles: CandlestickData[] = orderedBars.map((bar) => ({
      time: toChartTime(bar.timestamp),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));
    const volumes: HistogramData[] = orderedBars.map((bar) => ({
      time: toChartTime(bar.timestamp),
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(16,185,129,0.42)" : "rgba(239,68,68,0.42)",
    }));

    candleSeries.setData(candles);
    volumeSeries.setData(volumes);
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  return (
    <div
      ref={ref}
      className="h-[420px] w-full overflow-hidden rounded-md bg-[#0d0f13]"
      aria-label={`${symbol} candlestick chart`}
    />
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
      const enrichedPayload = enrichMarkets(payload);
      setMarkets(enrichedPayload);
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
                  <div className="mt-2 flex items-center gap-2 text-xl font-semibold text-white">
                    <CoinIcon row={selectedRow} size="sm" />
                    {selectedSymbol}
                  </div>
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
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <CandlestickChart className="h-4 w-4 text-orange-300" />
                    K-line Data
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {selectedSymbol} Perpetual Index · {timeframe.toUpperCase()} · Redis cache + TimescaleDB persistence
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
              <KlinePanel symbol={selectedSymbol} bars={bars} />
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
                        <CoinIcon row={row} />
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
