import { render, screen, waitFor } from "@testing-library/react";
import { Dashboard } from "@/pages/Dashboard";
import { api } from "@/lib/api";

vi.mock("@/components/charts/StrategyReturnChart", () => ({
  StrategyReturnChart: ({ data }: { data: Array<{ equity: number | string }> }) => (
    <div data-testid="equity-chart">{`${data[0]?.equity ?? "empty"}:${data[data.length - 1]?.equity ?? "empty"}`}</div>
  ),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getShadowAccount: vi.fn(),
  },
}));

describe("Dashboard shadow account performance", () => {
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
          side: "BUY",
          order_type: "MARKET",
          price: 50000,
          quantity: 0.2,
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
  });

  it("shows account value, pnl, and recent orders", async () => {
    render(<Dashboard />);

    await waitFor(() => expect(api.getShadowAccount).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Account Value")).toBeInTheDocument();
    expect(screen.getByText("$101,000")).toBeInTheDocument();
    expect(screen.getByText("+1.00%")).toBeInTheDocument();
    expect(screen.getByText("BTC_USDT")).toBeInTheDocument();
    expect(screen.getByText("FILLED")).toBeInTheDocument();
    expect(screen.getByTestId("equity-chart")).toHaveTextContent("100000:101000");
  });
});
