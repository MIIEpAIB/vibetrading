import { render, screen, waitFor } from "@testing-library/react";
import { Dashboard } from "@/pages/Dashboard";
import { Home } from "@/pages/Home";
import { api } from "@/lib/api";

vi.mock("@/components/charts/KLineChartPanel", () => ({
  KLineChartPanel: ({ symbol, timeframe, bars }: { symbol: string; timeframe: string; bars: Array<{ close: number }> }) => (
    <div data-testid="kline-panel">{`${symbol}:${timeframe}:${bars.length}`}</div>
  ),
}));

vi.mock("@/components/charts/StrategyReturnChart", () => ({
  StrategyReturnChart: () => <div data-testid="equity-chart" />,
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      listDeployments: vi.fn(),
      getQuantaxisAccountSnapshot: vi.fn(),
      listQuantaxisAccountOrders: vi.fn(),
      getCryptoKlines: vi.fn(),
      getCryptoMarkets: vi.fn(),
    },
  };
});

describe("Dashboard K-line placement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listDeployments).mockResolvedValue({
      deployments: [
        {
          deployment_id: "qadep_shadow",
          user_id: 7,
          target: "SHADOW",
          status: "RUNNING",
          strategy_snapshot: {
            strategy_id: "s1",
            version_no: 1,
            owner_user_id: 7,
            name: "Momentum",
            description: "",
            strategy_description: "",
            language: "python",
            category: "trend",
            tags: [],
            code: "",
            code_sha256: "hash",
            created_at: "2026-08-20T00:00:00Z",
            parameter_schema: {},
          },
          account_cookie: "qa:shadow:7:qadep_shadow",
          market: "CRYPTO",
          symbols: ["BTC_USDT"],
          timeframe: "1h",
          parameters: {},
          risk_policy: {},
          broker_binding_id: null,
          created_at: "2026-08-20T00:00:00Z",
          updated_at: "2026-08-20T00:01:00Z",
        },
      ],
    } as never);
    vi.mocked(api.getQuantaxisAccountSnapshot).mockResolvedValue({
      account_cookie: "qa:shadow:7:qadep_shadow",
      cash: 1000,
      frozen: 0,
      market_value: 0,
      total_asset: 1000,
      accounts: {},
      updated_at: "2026-08-20T00:01:00Z",
    } as never);
    vi.mocked(api.listQuantaxisAccountOrders).mockResolvedValue({
      account_cookie: "qa:shadow:7:qadep_shadow",
      orders: [],
    } as never);
    vi.mocked(api.getCryptoKlines).mockResolvedValue({
      status: "ok",
      source: "okx",
      symbol: "BTC/USDT",
      timeframe: "5m",
      updated_at: "2026-08-20T00:01:00Z",
      bars: [{
        time: "2026-08-20T00:00:00Z",
        timestamp: 1_786_080_000_000,
        symbol: "BTC/USDT",
        open: 67000,
        high: 67200,
        low: 66900,
        close: 67150,
        volume: 1000,
      }],
    } as never);
    vi.mocked(api.getCryptoMarkets).mockResolvedValue({
      status: "ok",
      source: "okx",
      updated_at: "2026-08-20T00:01:00Z",
      symbols: [],
      rows: [],
      aggregate: { market_cap: 0, volume_24h: 0, open_interest: 0, liquidation_24h: 0, avg_change_24h: 0, btc_dominance: 0 },
    } as never);
  });

  it("renders the k-line chart on the dashboard", async () => {
    render(<Dashboard />);

    expect(await screen.findByText("Market Candles")).toBeInTheDocument();
    expect(await screen.findByTestId("kline-panel")).toHaveTextContent("BTC/USDT:5m:1");
    expect(api.getCryptoKlines).toHaveBeenCalledWith("BTC/USDT", "5m", 180);
  });

  it("does not request k-line data on the home page", async () => {
    render(<Home />);

    await waitFor(() => expect(api.getCryptoMarkets).toHaveBeenCalled());
    expect(api.getCryptoKlines).not.toHaveBeenCalled();
  });
});
