import { useEffect, useMemo, useRef, useState } from "react";
import { api, type CryptoKlineBar } from "@/lib/api";
import { cn } from "@/lib/utils";

type KLineData = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type KLineChartApi = {
  applyNewData: (data: KLineData[]) => void;
  updateData?: (data: KLineData) => void;
  createIndicator: (name: string, isStack?: boolean, options?: Record<string, unknown>) => void;
  resize?: () => void;
};

type KLineChartsGlobal = {
  init: (target: HTMLElement | string, options?: Record<string, unknown>) => KLineChartApi;
  dispose?: (target: HTMLElement | string | KLineChartApi) => void;
};

declare global {
  interface Window {
    klinecharts?: KLineChartsGlobal;
  }
}

const KLINECHARTS_SRC = "/vendor/klinecharts.min.js";
let scriptPromise: Promise<void> | null = null;

function loadKLineCharts(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.klinecharts) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${KLINECHARTS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load KLineCharts")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = KLINECHARTS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load KLineCharts"));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function toKLineData(bars: CryptoKlineBar[]): KLineData[] {
  return [...bars]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((bar) => ({
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
}

function mergeLiveBar(base: KLineData[], liveBar: KLineData | null): KLineData[] {
  if (!liveBar || base.length === 0) return base;
  const next = [...base];
  const last = next[next.length - 1];
  if (liveBar.timestamp < last.timestamp) return next;
  if (liveBar.timestamp === last.timestamp) {
    next[next.length - 1] = liveBar;
    return next;
  }
  next.push(liveBar);
  return next;
}

export function KLineChartPanel({
  symbol,
  timeframe = "1h",
  bars,
  height,
  showMovingAverages = true,
  className,
}: {
  symbol: string;
  timeframe?: string;
  bars: CryptoKlineBar[];
  height?: number | string;
  showMovingAverages?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<KLineChartApi | null>(null);
  const chartDataRef = useRef<KLineData[]>([]);
  const liveBarRef = useRef<KLineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const chartData = useMemo(() => toKLineData(bars), [bars]);
  chartDataRef.current = chartData;

  useEffect(() => {
    let cancelled = false;

    loadKLineCharts()
      .then(() => {
        if (cancelled || !ref.current || !window.klinecharts) return;
        const chart = window.klinecharts.init(ref.current, {
          styles: {
            grid: {
              show: true,
              horizontal: { color: "rgba(63,63,70,0.28)" },
              vertical: { color: "rgba(63,63,70,0.18)" },
            },
            candle: {
              bar: {
                upColor: "#26a69a",
                downColor: "#ef5350",
                noChangeColor: "#8b949e",
                upBorderColor: "#26a69a",
                downBorderColor: "#ef5350",
                noChangeBorderColor: "#8b949e",
                upWickColor: "#26a69a",
                downWickColor: "#ef5350",
                noChangeWickColor: "#8b949e",
              },
              priceMark: {
                last: {
                  upColor: "#26a69a",
                  downColor: "#ef5350",
                  noChangeColor: "#8b949e",
                },
              },
            },
            xAxis: {
              axisLine: { color: "#30363d" },
              tickText: { color: "#8b949e" },
            },
            yAxis: {
              axisLine: { color: "#30363d" },
              tickText: { color: "#8b949e" },
            },
            crosshair: {
              horizontal: { line: { color: "#2f81f7" }, text: { backgroundColor: "#161b22" } },
              vertical: { line: { color: "#2f81f7" }, text: { backgroundColor: "#161b22" } },
            },
          },
        });
        ref.current.removeAttribute("k-line-chart-id");
        chartRef.current = chart;
        chart.createIndicator("VOL");
        if (showMovingAverages) {
          chart.createIndicator("MA", false, { id: "candle_pane" });
        }
        chart.applyNewData(mergeLiveBar(chartDataRef.current, liveBarRef.current));
        chart.resize?.();
        setChartReady(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load KLineCharts");
      });

    return () => {
      cancelled = true;
      if (chartRef.current && window.klinecharts?.dispose) {
        window.klinecharts.dispose(chartRef.current);
      }
      chartRef.current = null;
      setChartReady(false);
    };
  }, [showMovingAverages]);

  useEffect(() => {
    chartRef.current?.applyNewData(mergeLiveBar(chartData, liveBarRef.current));
    chartRef.current?.resize?.();
  }, [chartData]);

  useEffect(() => {
    if (!chartReady) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(api.getCryptoKlineStreamUrl(symbol, timeframe));
      socket = ws;

      ws.onopen = () => {
        attempt = 0;
        setError(null);
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse(event.data) as {
            type?: string;
            bar?: KLineData;
          };
          if (payload.type !== "kline" || !payload.bar) return;
          liveBarRef.current = payload.bar;
          chartRef.current?.updateData?.(payload.bar);
        } catch {
          // ignore malformed live payloads
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore close failures
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        attempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore close failures
        }
      }
    };
  }, [chartReady, symbol, timeframe]);

  useEffect(() => {
    chartRef.current?.resize?.();
  }, [height]);

  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      chartRef.current?.resize?.();
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("relative w-full overflow-hidden bg-[#0c1117]", className)} style={{ height: height ?? "100%" }} aria-label={`${symbol} candlestick chart`}>
      <div ref={ref} className="h-full w-full" />
      {error ? <div className="absolute inset-0 flex items-center justify-center text-xs text-red-300">{error}</div> : null}
    </div>
  );
}
