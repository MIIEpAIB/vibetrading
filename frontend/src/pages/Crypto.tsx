import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandlestickChart, Loader2, RefreshCw } from "lucide-react";
import { KLineChartPanel } from "@/components/charts/KLineChartPanel";
import { authHeaders } from "@/lib/apiAuth";
import type { CryptoKlineBar } from "@/lib/api";
import { cn } from "@/lib/utils";

type LegacyCryptoBar = {
  time: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: string;
};

type LegacyCryptoResponse = {
  status: number;
  symbol: string;
  frequency: string;
  count: number;
  data: LegacyCryptoBar[];
  message?: string;
};

type NormalizedCryptoResponse = {
  status: string;
  symbol: string;
  timeframe: string;
  source: string;
  bars: Array<{
    time: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
};

type ApiErrorPayload = { detail?: string; message?: string; source?: string };

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "TRXUSDT"];
const FREQUENCIES = ["5m", "15m", "1h", "1d"] as const;
const REFRESH_MS = 3_500;

function normalizeSymbol(value: string): string {
  const clean = value.trim().toUpperCase().replace("-", "");
  if (!clean) return "BTCUSDT";
  if (clean.includes("/")) return clean.replace("/", "");
  return clean;
}

function toBars(items: LegacyCryptoBar[], symbol: string): CryptoKlineBar[] {
  return [...items]
    .sort((a, b) => a.time - b.time)
    .map((item) => ({
      time: new Date(item.time * 1000).toISOString(),
      timestamp: item.time * 1000,
      symbol,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
    }));
}

function isNormalizedCryptoResponse(value: NormalizedCryptoResponse | ApiErrorPayload): value is NormalizedCryptoResponse {
  return "status" in value && "bars" in value;
}

async function fetchKline(symbol: string, frequency: string): Promise<LegacyCryptoResponse> {
  const headers = authHeaders();
  const legacyUrl = `/api/crypto/kline?symbol=${encodeURIComponent(symbol)}&frequency=${encodeURIComponent(frequency)}&limit=240`;
  try {
    const legacyRes = await fetch(legacyUrl, { headers });
    if (legacyRes.ok) {
      const legacy = (await legacyRes.json()) as LegacyCryptoResponse;
      if (typeof legacy.status === "number") return legacy;
    }
  } catch {
    // Older running backends do not have the QUANTAXIS-compatible route yet.
  }

  const normalizedUrl = `/crypto/klines?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(frequency)}&limit=240`;
  const normalizedRes = await fetch(normalizedUrl, { headers });
  let normalized: NormalizedCryptoResponse | ApiErrorPayload;
  try {
    normalized = (await normalizedRes.json()) as NormalizedCryptoResponse;
  } catch {
    return {
      status: 502,
      symbol: `BINANCE.${symbol}`,
      frequency,
      count: 0,
      data: [],
      message: `crypto kline unavailable: expected JSON, got HTTP ${normalizedRes.status}`,
    };
  }
  if (!normalizedRes.ok || !isNormalizedCryptoResponse(normalized) || normalized.status !== "ok") {
    return {
      status: 502,
      symbol: `BINANCE.${symbol}`,
      frequency,
      count: 0,
      data: [],
      message: normalized.source || ("detail" in normalized ? normalized.detail : undefined) || ("message" in normalized ? normalized.message : undefined) || `crypto kline unavailable: HTTP ${normalizedRes.status}`,
    };
  }
  return {
    status: 200,
    symbol: `BINANCE.${normalized.symbol.replace("/", "")}`,
    frequency: normalized.timeframe,
    count: normalized.bars.length,
    data: normalized.bars.map((bar) => ({
      time: Math.floor(bar.timestamp / 1000),
      date: bar.time.replace("Z", "").replace("T", " "),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      source: normalized.source,
    })),
  };
}

export function Crypto() {
  const [symbolInput, setSymbolInput] = useState("BTCUSDT");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>("5m");
  const [bars, setBars] = useState<CryptoKlineBar[]>([]);
  const [loading, setLoading] = useState(false);
  const requestVersionRef = useRef(0);

  const load = useCallback(async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const nextSymbol = normalizeSymbol(symbolInput);
    setSymbol(nextSymbol);
    setLoading(true);
    try {
      const data = await fetchKline(nextSymbol, frequency);
      if (requestVersionRef.current !== requestVersion) return;
      if (data.status !== 200) {
        throw new Error(data.message || "request failed");
      }
      const nextBars = toBars(data.data || [], data.symbol || nextSymbol);
      setBars(nextBars);
    } catch {
      if (requestVersionRef.current !== requestVersion) return;
      setBars([]);
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setLoading(false);
      }
    }
  }, [frequency, symbolInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const lastClose = useMemo(() => bars[bars.length - 1]?.close, [bars]);

  return (
    <main className="flex h-full min-h-[640px] flex-col bg-[#101418] text-zinc-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <h1 className="mr-3 text-lg font-semibold text-white">Crypto Kline</h1>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <input
            list="crypto-symbols"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
            className="h-9 w-full max-w-[180px] rounded-md border border-zinc-700 bg-[#151b22] px-3 text-sm outline-none"
            aria-label="symbol"
          />
          <datalist id="crypto-symbols">
            {SYMBOLS.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <div className="flex rounded-md border border-zinc-700 bg-[#151b22] p-1">
            {FREQUENCIES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFrequency(item)}
                className={cn(
                  "h-7 rounded px-3 text-xs font-medium transition",
                  frequency === item ? "bg-[#1f6feb] text-white" : "text-zinc-400 hover:text-zinc-100",
                )}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm font-medium text-zinc-100 hover:bg-zinc-800"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Load
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(420px,1fr)_auto]">
        <div className="min-h-[420px]">
          <KLineChartPanel symbol={symbol} timeframe={frequency} bars={bars} className="h-full min-h-[420px]" />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <CandlestickChart className="h-4 w-4 text-orange-300" />
          </div>
          <div className="font-mono text-zinc-500">{lastClose ? `Last ${lastClose.toFixed(2)}` : "--"}</div>
        </div>
      </div>
    </main>
  );
}
