import { act, render, screen } from "@testing-library/react";
import { ShadowTrading } from "@/pages/ShadowTrading";
import { api } from "@/lib/api";

vi.mock("@/components/charts/KLineChartPanel", () => ({
  KLineChartPanel: ({ symbol, bars }: { symbol: string; bars: Array<{ close: number }> }) => (
    <div data-testid="kline-panel">{`${symbol}:${bars[bars.length - 1]?.close ?? "empty"}`}</div>
  ),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getCryptoMarkets: vi.fn(),
    getCryptoKlines: vi.fn(),
  },
}));

const mockData = vi.hoisted(() => {
  const markets1 = {
    status: "ok",
    source: "binance",
    updated_at: "2026-08-06T00:00:00Z",
    symbols: ["BTC/USDT"],
    aggregate: {
      market_cap: 1_000_000_000,
      volume_24h: 20_000_000,
      open_interest: 2_000_000,
      liquidation_24h: 50_000,
      avg_change_24h: 1.23,
      btc_dominance: 48,
    },
    rows: [{
      rank: 1,
      symbol: "BTC/USDT",
      base: "BTC",
      name: "Bitcoin",
      icon_url: "/coin-icons/btc.svg",
      icon_bg: "#f7931a",
      icon_fg: "#111827",
      price: 67200,
      change_24h: 1.23,
      high_24h: 68100,
      low_24h: 64900,
      volume_24h: 300,
      quote_volume_24h: 20_000_000,
      market_cap: 1_000_000_000,
      funding_rate: 0.01,
      open_interest: 2_000_000,
      liquidation_24h: 50_000,
    }],
  };
  const markets2 = {
    ...markets1,
    updated_at: "2026-08-06T00:00:15Z",
    rows: [{ ...markets1.rows[0], price: 68150, change_24h: 1.8 }],
  };
  const klines1 = {
    status: "ok",
    symbol: "BTC/USDT",
    timeframe: "1h",
    source: "binance",
    updated_at: "2026-08-06T00:00:00Z",
    storage: { redis: "disabled", timescale: "disabled" },
    bars: [
      { time: "2026-08-06T00:00:00Z", timestamp: 1, symbol: "BTC/USDT", open: 67000, high: 67300, low: 66900, close: 67200, volume: 1000 },
    ],
  };
  const klines2 = {
    ...klines1,
    updated_at: "2026-08-06T00:00:10Z",
    bars: [
      { time: "2026-08-06T00:00:00Z", timestamp: 1, symbol: "BTC/USDT", open: 67000, high: 68180, low: 66900, close: 68150, volume: 1500 },
    ],
  };
  return { markets1, markets2, klines1, klines2 };
});

describe("ShadowTrading crypto dashboard live K-line refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(api.getCryptoMarkets)
      .mockResolvedValueOnce(mockData.markets1)
      .mockResolvedValueOnce(mockData.markets2);
    vi.mocked(api.getCryptoKlines)
      .mockResolvedValueOnce(mockData.klines1)
      .mockResolvedValueOnce(mockData.klines2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes K-line data automatically between market table refreshes", async () => {
    render(<ShadowTrading />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.getCryptoMarkets).toHaveBeenCalledTimes(1);
    expect(api.getCryptoKlines).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("kline-panel")).toHaveTextContent("BTC/USDT:67200");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
      await Promise.resolve();
    });

    expect(api.getCryptoMarkets).toHaveBeenCalledTimes(1);
    expect(api.getCryptoKlines).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("kline-panel")).toHaveTextContent("BTC/USDT:68150");
  });
});
