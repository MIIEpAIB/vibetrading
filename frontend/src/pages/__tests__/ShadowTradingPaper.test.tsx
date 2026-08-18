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
      user_id: "operator",
      account_type: "VIRTUAL",
      wallets: [
        { user_id: "operator", account_type: "VIRTUAL", asset_name: "USDT", balance: 90000, frozen: 0, equity: 90000 },
        { user_id: "operator", account_type: "VIRTUAL", asset_name: "BTC", balance: 0.2, frozen: 0, equity: 0.2 },
      ],
      orders: [
        {
          order_id: "order_1",
          user_id: "operator",
          account_type: "VIRTUAL",
          symbol: "BTC_USDT",
          side: "BUY",
          type: "MARKET",
          price: 50000,
          quantity: 0.2,
          status: "FILLED",
          executed_price: 50000,
          average_price: 50000,
          filled_quantity: 0.2,
          remaining_quantity: 0,
          executed_value: 10000,
          reserved_asset: "USDT",
          reserved_amount: 10000,
          fee_asset: "USDT",
          fee_paid: 0,
          timestamp: 1_782_475_200,
          updated_at: 1_782_475_200,
        },
      ],
      market_prices: { BTC_USDT: 55000 },
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
