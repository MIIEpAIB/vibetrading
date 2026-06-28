import { render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ShadowTrading } from "@/pages/ShadowTrading";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { PaperDeployment, ShadowAccountResponse, ShadowOrder } from "@/lib/api";

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "CandlestickSeries",
  ColorType: { Solid: "Solid" },
  HistogramSeries: "HistogramSeries",
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({ setData: vi.fn() })),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    remove: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  })),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

const mockData = vi.hoisted(() => {
  const account = {
    user_id: "operator",
    account_type: "VIRTUAL",
    wallets: [{ user_id: "operator", account_type: "VIRTUAL", asset_name: "USDT", balance: 100000, frozen: 0, equity: 100000 }],
    orders: [],
    market_prices: { BTC_USDT: 65000 },
  } satisfies ShadowAccountResponse;
  const agentOrder = {
    order_id: "order_agent_1",
    user_id: "operator",
    account_type: "VIRTUAL",
    symbol: "BTC_USDT",
    side: "BUY",
    type: "MARKET",
    price: 0,
    quantity: 0.01,
    status: "FILLED",
    executed_price: 65000,
    reserved_asset: "USDT",
    reserved_amount: 0,
    timestamp: 1782475200,
    updated_at: 1782475200,
  } satisfies ShadowOrder;
  const accountWithAgentOrder = { ...account, orders: [agentOrder] } satisfies ShadowAccountResponse;
  const klines = {
    status: "ok",
    symbol: "BTC/USDT",
    timeframe: "1h",
    source: "test",
    updated_at: "2026-06-26T00:00:00Z",
    storage: { redis: "mock", timescale: "mock" },
    bars: Array.from({ length: 8 }, (_, index) => {
      const open = 65000 + index * 100;
      const close = open + (index % 2 === 0 ? 80 : -60);
      return {
        time: `2026-06-26T0${index}:00:00Z`,
        timestamp: Date.parse(`2026-06-26T0${index}:00:00Z`),
        symbol: "BTC/USDT",
        open,
        high: Math.max(open, close) + 120,
        low: Math.min(open, close) - 120,
        close,
        volume: 1000 + index * 10,
      };
    }),
  };
  const markets = {
    status: "ok",
    source: "test",
    updated_at: "2026-06-26T00:00:00Z",
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
  return { account, agentOrder, accountWithAgentOrder, klines, markets };
});

vi.mock("@/lib/api", () => ({
  api: {
    getShadowAccount: vi.fn().mockResolvedValue(mockData.account),
    placeShadowOrder: vi.fn().mockResolvedValue(mockData.agentOrder),
    updateShadowMarketPrice: vi.fn().mockResolvedValue({ symbol: "BTC_USDT", price: 67200, filled_orders: [], account: mockData.account }),
    getCryptoMarkets: vi.fn().mockResolvedValue(mockData.markets),
    getCryptoKlines: vi.fn().mockResolvedValue(mockData.klines),
    listPaperDeployments: vi.fn().mockResolvedValue({ deployments: [] }),
    getPaperDeploymentStatus: vi.fn().mockResolvedValue({ recent_ticks: [], recent_signals: [], recent_decisions: [], recent_orders: [], summary: {} }),
    startPaperDeployment: vi.fn().mockResolvedValue({ deployment: { deployment_id: "paper_1", status: "running" } }),
    pausePaperDeployment: vi.fn().mockResolvedValue({ deployment: { deployment_id: "paper_1", status: "paused" } }),
    resumePaperDeployment: vi.fn().mockResolvedValue({ deployment: { deployment_id: "paper_1", status: "running" } }),
    runPaperDeploymentTick: vi.fn().mockResolvedValue({ tick: { tick_id: "tick_1", outcome: "no_action" } }),
    archivePaperDeployment: vi.fn().mockResolvedValue({ deployment: { deployment_id: "paper_1", status: "archived" } }),
  },
}));

describe("ShadowTrading agent strategies", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("shows only agent strategy tracking in the strategies tab", async () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <ShadowTrading />
        </I18nProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Strategies")).toBeInTheDocument());
    expect(screen.queryByText("JSON Buy")).not.toBeInTheDocument();
    expect(screen.queryByText("Paper Deployments")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Strategies" }));
    expect(await screen.findByText("Agent imported strategies")).toBeInTheDocument();
    expect(screen.getByText("No agent-imported strategies yet.")).toBeInTheDocument();
    expect(screen.queryByText("paper cash buffer would be breached")).not.toBeInTheDocument();
  });

  it("labels imported agent orders after running the saved draft", async () => {
    const { api } = await import("@/lib/api");
    vi.mocked(api.getShadowAccount)
      .mockResolvedValueOnce(mockData.account)
      .mockResolvedValueOnce(mockData.accountWithAgentOrder);

    window.sessionStorage.setItem("vibe-shadow-import:draft_agent", JSON.stringify({
      version: 1,
      source: "agent_result",
      createdAt: 1782475200000,
      runId: "run_agent_1",
      shadowId: "shadow_agent_1",
      run: {
        prompt: "Agent BTC breakout",
        status: "success",
        elapsed_seconds: 12.3,
        run_stage: "completed",
        run_directory: "/runs/run_agent_1",
        trade_count: 2,
        trades: [
          {
            source: "run_log",
            symbol: "BTC_USDT",
            side: "BUY",
            quantity: 0.01,
            price: 64000,
            notional: 640,
            pnl: 120,
            pnl_percent: 0.03,
            opened_at: "2026-06-26T01:00:00Z",
            note: "breakout entry",
          },
          {
            source: "run_log",
            symbol: "BTC_USDT",
            side: "SELL",
            quantity: 0.01,
            price: 65500,
            notional: 655,
            pnl: -35,
            pnl_percent: -0.01,
            closed_at: "2026-06-26T02:00:00Z",
            note: "risk exit",
          },
        ],
      },
      symbol: "BTC_USDT",
      side: "BUY",
      orderType: "MARKET",
      quantity: 0.01,
      price: 65000,
      metrics: {
        total_return: 0.12,
        sharpe: 1.4,
        max_drawdown: -0.03,
        trade_count: 2,
      },
    }));

    render(
      <MemoryRouter initialEntries={["/shadow-trading?import=draft_agent"]}>
        <I18nProvider>
          <ShadowTrading />
        </I18nProvider>
      </MemoryRouter>,
    );

    const runDraft = await screen.findByRole("button", { name: "Run Agent Draft" });
    vi.mocked(api.updateShadowMarketPrice).mockClear();
    await userEvent.click(runDraft);

    await waitFor(() => expect(api.placeShadowOrder).toHaveBeenCalled());
    expect(api.updateShadowMarketPrice).toHaveBeenCalledWith({ symbol: "BTC_USDT", price: 67200 });

    await userEvent.click(screen.getByRole("button", { name: "Order history" }));
    await waitFor(() => expect(screen.getByText("Agent saved")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Strategies" }));
    await waitFor(() => expect(screen.getByText("Agent imported strategies")).toBeInTheDocument());
    expect(screen.getByText(/Agent BTC breakout/)).toBeInTheDocument();
    expect(screen.getByText("Run: run_agent_1")).toBeInTheDocument();
    expect(screen.getByText("Shadow: shadow_agent_1")).toBeInTheDocument();
    expect(screen.getByText(/Run directory: \/runs\/run_agent_1/)).toBeInTheDocument();
    expect(screen.getByText("success / completed")).toBeInTheDocument();
    expect(screen.getByText("Elapsed: 12.3s")).toBeInTheDocument();
    expect(screen.getByText("order_agent_1")).toBeInTheDocument();
    expect(screen.getAllByText("$650").length).toBeGreaterThan(0);
    expect(screen.queryByText("Trade details")).not.toBeInTheDocument();
    expect(screen.queryByText("total_return")).not.toBeInTheDocument();
  });

  it("removes archived paper deployments from the strategies tab", async () => {
    const { api } = await import("@/lib/api");
    const deployment: PaperDeployment = {
      deployment_id: "paper_1",
      user_id: 1,
      status: "running",
      strategy_id: "strategy_1",
      strategy_snapshot: {
        strategy_id: "strategy_1",
        name: "Momentum Paper Strategy",
        description: "test",
        language: "python",
        category: "momentum",
        tags: [],
        code: "pass",
        source_updated_at: "2026-06-26T00:00:00Z",
        version: "v1",
      },
      limits: {
        symbols: ["BTC_USDT"],
        allowed_sides: ["BUY", "SELL"],
        max_order_notional: 1000,
        max_total_exposure: 5000,
        max_trades_per_day: 3,
        min_cash_buffer: 100,
        default_order_notional: 500,
        order_type: "MARKET",
      },
      created_at: "2026-06-26T00:00:00Z",
      updated_at: "2026-06-26T00:00:00Z",
      started_at: "2026-06-26T00:00:00Z",
    };
    vi.mocked(api.listPaperDeployments)
      .mockResolvedValueOnce({ deployments: [deployment] })
      .mockResolvedValueOnce({ deployments: [{ ...deployment, status: "archived" }] });

    render(
      <MemoryRouter>
        <I18nProvider>
          <ShadowTrading />
        </I18nProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Strategies" }));
    expect(await screen.findByText("Momentum Paper Strategy")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.archivePaperDeployment).toHaveBeenCalledWith("paper_1"));
    await waitFor(() => expect(screen.queryByText("Momentum Paper Strategy")).not.toBeInTheDocument());
    expect(await screen.findByText("No paper strategy deployments yet.")).toBeInTheDocument();
  });

  it("shows a stop action and expandable details for running paper deployments", async () => {
    const { api } = await import("@/lib/api");
    const deployment: PaperDeployment = {
      deployment_id: "paper_running_1",
      user_id: 1,
      status: "running",
      strategy_id: "strategy_running",
      strategy_snapshot: {
        strategy_id: "strategy_running",
        name: "Running Grid Strategy",
        description: "test",
        language: "python",
        category: "grid",
        tags: ["grid"],
        code: "pass",
        source_updated_at: "2026-06-26T00:00:00Z",
        version: "v1",
      },
      limits: {
        symbols: ["BTC_USDT"],
        allowed_sides: ["BUY", "SELL"],
        max_order_notional: 1000,
        max_total_exposure: 5000,
        max_trades_per_day: 3,
        min_cash_buffer: 100,
        default_order_notional: 500,
        order_type: "MARKET",
      },
      created_at: "2026-06-26T00:00:00Z",
      updated_at: "2026-06-26T00:00:00Z",
      started_at: "2026-06-26T00:00:00Z",
    };
    vi.mocked(api.listPaperDeployments)
      .mockResolvedValueOnce({ deployments: [deployment] })
      .mockResolvedValueOnce({ deployments: [deployment] });
    vi.mocked(api.getPaperDeploymentStatus).mockResolvedValueOnce({
      deployment,
      latest_tick: { tick_id: "tick_1", deployment_id: "paper_running_1", user_id: 1, outcome: "order_placed", created_at: "2026-06-26T00:01:00Z", reason: "signal accepted", shadow_order_id: "order_1" },
      recent_ticks: [{ tick_id: "tick_1", deployment_id: "paper_running_1", user_id: 1, outcome: "order_placed", created_at: "2026-06-26T00:01:00Z", reason: "signal accepted", shadow_order_id: "order_1" }],
      recent_signals: [{
        signal_id: "signal_1",
        deployment_id: "paper_running_1",
        user_id: 1,
        strategy_version: "v1",
        symbol: "BTC_USDT",
        action: "BUY",
        reason: "grid lower band",
        data_timestamp: "2026-06-26T00:00:00Z",
        created_at: "2026-06-26T00:01:00Z",
        metadata: {},
      }],
      recent_decisions: [],
      recent_orders: [],
      summary: { tick_count: 1, order_count: 1, rejected_decision_count: 0 },
    });

    render(
      <MemoryRouter>
        <I18nProvider>
          <ShadowTrading />
        </I18nProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Strategies" }));
    const card = (await screen.findByText("Running Grid Strategy")).closest("article");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByRole("button", { name: "Stop strategy" })).toBeInTheDocument();

    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: "Details" }));
    expect(await within(card as HTMLElement).findByText("Activity summary")).toBeInTheDocument();
    expect(within(card as HTMLElement).getAllByText("BUY BTC_USDT").length).toBeGreaterThan(0);
    expect(within(card as HTMLElement).getAllByText("grid lower band").length).toBeGreaterThan(0);

    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: "Stop strategy" }));
    await waitFor(() => expect(api.pausePaperDeployment).toHaveBeenCalledWith("paper_running_1"));
    await waitFor(() => expect(api.listPaperDeployments).toHaveBeenCalledTimes(2));
  });

  it("deletes agent imported strategies from the local strategy list", async () => {
    window.localStorage.setItem("vibe-shadow-agent-strategies", JSON.stringify([{
      id: "run_agent_1",
      source: "agent_result",
      createdAt: 1782475200000,
      updatedAt: 1782475200000,
      runId: "run_agent_1",
      symbol: "BTC_USDT",
      side: "BUY",
      orderType: "MARKET",
      quantity: 0.01,
      prompt: "Agent BTC breakout",
    }]));

    render(
      <MemoryRouter>
        <I18nProvider>
          <ShadowTrading />
        </I18nProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Strategies" }));
    const agentCard = (await screen.findByText(/Agent BTC breakout/)).closest("article");
    expect(agentCard).not.toBeNull();

    await userEvent.click(within(agentCard as HTMLElement).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText(/Agent BTC breakout/)).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem("vibe-shadow-agent-strategies") || "[]")).toEqual([]);
    expect(screen.getByText("No agent-imported strategies yet.")).toBeInTheDocument();
  });
});
