import { act, render, screen } from "@testing-library/react";
import { Crypto } from "@/pages/Crypto";

vi.mock("@/components/charts/KLineChartPanel", () => ({
  KLineChartPanel: ({ symbol, timeframe, bars }: { symbol: string; timeframe: string; bars: Array<{ close: number }> }) => (
    <div data-testid="kline-panel">{`${symbol}:${timeframe}:${bars[bars.length - 1]?.close ?? "empty"}`}</div>
  ),
}));

vi.mock("@/lib/apiAuth", () => ({
  authHeaders: vi.fn(() => ({})),
}));

const legacyPayload = {
  status: 200,
  symbol: "BINANCE.BTCUSDT",
  frequency: "5m",
  count: 1,
  data: [
    {
      time: 1,
      date: "1970-01-01 00:00:01",
      open: 67000,
      high: 67250,
      low: 66950,
      close: 67200,
      volume: 100,
      source: "binance",
    },
  ],
};

describe("Crypto K-line auto refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(legacyPayload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("defaults to 5M, shows reversed periods, and refreshes without clicking Load", async () => {
    render(<Crypto />);

    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons.slice(0, 4)).toEqual(["5M", "15M", "1H", "1D"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/crypto/kline?symbol=BTCUSDT&frequency=5m&limit=240");
    expect(screen.getByTestId("kline-panel")).toHaveTextContent("BTCUSDT:5m:67200");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
