import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShadowTrading } from "@/pages/ShadowTrading";
import { api } from "@/lib/api";

vi.mock("@/components/charts/KLineChartPanel", () => ({
  KLineChartPanel: ({ symbol, bars }: { symbol: string; bars: Array<{ close: number }> }) => (
    <div data-testid="kline-panel">{`${symbol}:${bars[bars.length - 1]?.close ?? "empty"}`}</div>
  ),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getShadowAccount: vi.fn(),
    listShadowOrders: vi.fn(),
    placeShadowOrder: vi.fn(),
    getCryptoKlines: vi.fn(),
  },
}));

describe("ShadowTrading paper order controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getShadowAccount).mockResolvedValue({
      account_cookie: "shadow:operator",
      portfolio_cookie: "virtual",
      account_type: "VIRTUAL",
      cash: 90000,
      frozen: 0,
      market_value: 11000,
      total_asset: 101000,
      accounts: {
        USDT: { account_cookie: "shadow:operator", asset: "USDT", balance: 90000, frozen: 0, available: 90000, equity: 90000 },
        BTC: { account_cookie: "shadow:operator", asset: "BTC", balance: 0.2, frozen: 0, available: 0.2, equity: 0.2 },
      },
      positions: {
        BTC_USDT: { symbol: "BTC_USDT", volume_long: 0.2, volume_short: 0, market_value: 11000 },
      },
      orders: [
        {
          order_id: "order_1",
          account_cookie: "shadow:operator",
          symbol: "BTC_USDT",
          side: "buy",
          price: 50000,
          quantity: 0.2,
          order_type: "MARKET",
          status: "FILLED",
          datetime: "2026-08-19T00:00:00Z",
          filled_quantity: 0.2,
          avg_price: 50000,
          commission: 0,
          metadata: {},
        },
      ],
      trades: [],
      market_prices: { BTC_USDT: 55000 },
      updated_at: "2026-08-19T00:00:00Z",
    });
    vi.mocked(api.listShadowOrders).mockResolvedValue([]);
    vi.mocked(api.getCryptoKlines).mockResolvedValue({
      status: "ok",
      symbol: "BTC/USDT",
      timeframe: "5m",
      source: "okx",
      updated_at: "2026-08-19T00:00:00Z",
      storage: { redis: "disabled", timescale: "disabled" },
      bars: [
        { time: "2026-08-19T00:00:00Z", timestamp: 1, symbol: "BTC/USDT", open: 67000, high: 67300, low: 66900, close: 67200, volume: 1000 },
      ],
    });
    vi.mocked(api.placeShadowOrder).mockResolvedValue({
      order_id: "order_2",
      user_id: "shadow:operator",
      account_type: "VIRTUAL",
      symbol: "BTC_USDT",
      side: "BUY",
      type: "MARKET",
      price: 55000,
      quantity: 0.1,
      status: "FILLED",
      executed_price: 55000,
      average_price: 55000,
      filled_quantity: 0.1,
      remaining_quantity: 0,
      executed_value: 5500,
      reserved_asset: "USDT",
      reserved_amount: 5500,
      timestamp: 1,
      updated_at: 1,
    });
  });

  it("enables buy when virtual cash and market price are available", async () => {
    const user = userEvent.setup();
    render(<ShadowTrading />);

    await waitFor(() => expect(api.getShadowAccount).toHaveBeenCalledTimes(1));
    expect(screen.getByText("总资产")).toBeInTheDocument();
    await user.type(screen.getByLabelText("数量 (BTC)"), "0.1");
    expect(screen.getByRole("button", { name: "买入 BTC" })).toBeEnabled();
  });

  it("submits a shadow order", async () => {
    const user = userEvent.setup();
    render(<ShadowTrading />);

    await waitFor(() => expect(api.getShadowAccount).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText("数量 (BTC)"), "0.1");
    await user.click(screen.getByRole("button", { name: "买入 BTC" }));

    await waitFor(() => expect(api.placeShadowOrder).toHaveBeenCalledWith({
      symbol: "BTC_USDT",
      side: "BUY",
      order_type: "MARKET",
      quantity: 0.1,
    }));
  });
});
