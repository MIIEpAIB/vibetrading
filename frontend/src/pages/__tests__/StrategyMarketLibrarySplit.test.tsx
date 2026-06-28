import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/i18n/I18nProvider";
import { StrategyMarket } from "@/pages/StrategyMarket";
import { StrategyLibrary } from "@/pages/StrategyLibrary";
import { api } from "@/lib/api";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      listStrategies: vi.fn().mockResolvedValue({ strategies: [] }),
      replaceStrategies: vi.fn().mockResolvedValue({ strategies: [] }),
      upsertStrategy: vi.fn().mockResolvedValue({}),
      deleteStrategy: vi.fn().mockResolvedValue({ status: "deleted", id: "x" }),
      runStrategyBacktest: vi.fn().mockResolvedValue({
        strategy_id: "owned-1",
        status: "passed",
        run_id: "strategy_owned_1",
        run_directory: "/tmp/strategy_owned_1",
        symbol: "BTC-USDT",
        timeframe: "4H",
        period: "2024-01-01 - 2026-06-27",
        totalReturnPct: 8.2,
        annualizedReturnPct: 3.5,
        maxDrawdownPct: 4.1,
        sharpe: 1.1,
        winRatePct: 52,
        tradeCount: 12,
        engine: "user_strategy_backtest_v1",
        assumptions: [],
        warnings: [],
      }),
      runStrategyMarketBacktest: vi.fn().mockImplementation((body: { strategy_id: string }) => Promise.resolve({
        strategy_id: body.strategy_id,
        status: "passed",
        run_id: `market_${body.strategy_id}`,
        run_directory: `/tmp/${body.strategy_id}`,
        symbol: body.strategy_id === "crypto-stat-arb-pairs" ? "ETH-USDT,SOL-USDT" : "BTC-USDT",
        timeframe: body.strategy_id === "professional-grid-trading" ? "1H" : "4H",
        period: "2024-01-01 - 2026-06-27",
        totalReturnPct: 12.5,
        annualizedReturnPct: 5.2,
        maxDrawdownPct: 7.1,
        sharpe: 1.3,
        winRatePct: 54.2,
        tradeCount: 24,
        engine: body.strategy_id === "professional-grid-trading" ? "real_professional_grid_v1" : "real_crypto_trend_momentum_v1",
        assumptions: ["OKX public OHLCV candles"],
        warnings: body.strategy_id === "crypto-trend-momentum" ? [] : ["proxy warning"],
      })),
      listPaperDeployments: vi.fn().mockResolvedValue({ deployments: [] }),
      createPaperDeployment: vi.fn().mockResolvedValue({ deployment: { deployment_id: "paper_1" } }),
      startPaperDeployment: vi.fn().mockResolvedValue({ deployment: { deployment_id: "paper_1", status: "running" } }),
      runPaperDeploymentTick: vi.fn().mockResolvedValue({ tick: { tick_id: "tick_1", outcome: "order_placed" } }),
    },
  };
});

describe("strategy market / library split", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("vibe-language", "zh-CN");
    vi.clearAllMocks();
  });

  it("shows marketplace items on /market and saves a favorite into the owned library", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/market"]}>
        <I18nProvider>
          <StrategyMarket />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("内置策略")).toBeInTheDocument();
    expect(screen.getByText("付费策略")).toBeInTheDocument();
    expect(screen.getByText("专业网格交易策略")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "收藏" })[0]);

    await waitFor(() => expect(api.upsertStrategy).toHaveBeenCalledTimes(1));
    const saved = JSON.parse(window.localStorage.getItem("vibe-personal-strategy-library") || "[]") as Array<{ id: string; tags: string[] }>;
    expect(saved.some((item) => item.id === "quantclaw-ai-assistant" || item.tags.includes("favorite"))).toBe(true);
  });

  it("runs a market backtest and starts paper trading from the result", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/market"]}>
        <I18nProvider>
          <StrategyMarket />
        </I18nProvider>
      </MemoryRouter>,
    );

    await user.click((await screen.findAllByRole("button", { name: "回测" }))[0]);

    expect(await screen.findByText("回测结果")).toBeInTheDocument();
    expect(screen.getByText("总收益")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "跑模拟盘" }));

    await waitFor(() => expect(api.createPaperDeployment).toHaveBeenCalledWith(expect.objectContaining({
      strategy_id: "quantclaw-ai-assistant",
      limits: expect.objectContaining({ symbols: ["BTC_USDT"], order_type: "MARKET" }),
    })));
    expect(api.startPaperDeployment).toHaveBeenCalledWith("paper_1");
  });

  it("backtests the professional grid strategy before deploying it to paper trading", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/market"]}>
        <I18nProvider>
          <StrategyMarket />
        </I18nProvider>
      </MemoryRouter>,
    );

    const gridCard = (await screen.findByText("专业网格交易策略")).closest("article");
    expect(gridCard).not.toBeNull();
    await user.click(within(gridCard as HTMLElement).getByRole("button", { name: "回测" }));

    expect(await screen.findByText("回测通过")).toBeInTheDocument();
    expect(screen.getByText(/real_professional_grid_v1/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "跑模拟盘" }));

    await waitFor(() => expect(api.upsertStrategy).toHaveBeenCalledWith(expect.objectContaining({
      id: "professional-grid-trading",
      code: expect.stringContaining("\"engine\": \"professional_grid\""),
    })));
    expect(api.createPaperDeployment).toHaveBeenCalledWith(expect.objectContaining({
      strategy_id: "professional-grid-trading",
      limits: expect.objectContaining({
        symbols: ["BTC_USDT"],
        max_order_notional: 300,
        max_total_exposure: 2400,
        default_order_notional: 120,
      }),
    }));
  });

  it("shows crypto quant strategy instructions and saves them into the strategy spec", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/market"]}>
        <I18nProvider>
          <StrategyMarket />
        </I18nProvider>
      </MemoryRouter>,
    );

    const trendCard = (await screen.findByText("加密趋势动量策略")).closest("article");
    expect(trendCard).not.toBeNull();
    expect(within(trendCard as HTMLElement).getByText("使用方式")).toBeInTheDocument();
    expect(within(trendCard as HTMLElement).getByText("风控要点")).toBeInTheDocument();
    expect(within(trendCard as HTMLElement).getByText(/BTC_USDT、ETH_USDT/)).toBeInTheDocument();

    await user.click(within(trendCard as HTMLElement).getByRole("button", { name: "回测" }));

    expect(await screen.findByText("回测结果")).toBeInTheDocument();
    expect(screen.getByText(/real_crypto_trend_momentum_v1/)).toBeInTheDocument();
    expect(screen.getByText(/market_crypto-trend-momentum/)).toBeInTheDocument();
    expect(api.upsertStrategy).toHaveBeenCalledWith(expect.objectContaining({
      id: "crypto-trend-momentum",
      code: expect.stringContaining("\"usage\""),
    }));
    expect(api.upsertStrategy).toHaveBeenCalledWith(expect.objectContaining({
      id: "crypto-trend-momentum",
      code: expect.stringContaining("\"risk_notes\""),
    }));
  });

  it("keeps the owned strategy library free of marketplace cards", async () => {
    render(
      <MemoryRouter initialEntries={["/strategies"]}>
        <I18nProvider>
          <StrategyLibrary />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("我的策略库")).toBeInTheDocument();
    expect(screen.queryByText("内置策略")).not.toBeInTheDocument();
    expect(screen.queryByText("付费策略")).not.toBeInTheDocument();
    expect(screen.getByText(/还没有策略|No owned strategies yet/)).toBeInTheDocument();
  });

  it("runs a real backtest from the owned strategy more menu", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listStrategies).mockResolvedValueOnce({
      strategies: [{
        id: "owned-1",
        name: "自有趋势策略",
        description: "MA crossover",
        language: "python",
        category: "trend",
        status: "draft",
        tags: ["draft"],
        code: "def generate_signals(data):\n    return (data['close'].rolling(5).mean() > data['close'].rolling(20).mean()).astype(float)",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
      }],
    });

    render(
      <MemoryRouter initialEntries={["/strategies"]}>
        <I18nProvider>
          <StrategyLibrary />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("自有趋势策略")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByRole("button", { name: "运行" }));

    await waitFor(() => expect(api.runStrategyBacktest).toHaveBeenCalledWith("owned-1", expect.objectContaining({
      symbol: "BTC-USDT",
      interval: "4H",
      source: "okx",
    })));
    expect(api.createPaperDeployment).not.toHaveBeenCalled();
  });

  it("opens owned strategy details and code from edit", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listStrategies).mockResolvedValueOnce({
      strategies: [{
        id: "owned-edit-1",
        name: "详情策略",
        description: "show details",
        language: "python",
        category: "trend",
        status: "draft",
        tags: ["detail"],
        code: "def generate_signals(data):\n    return 0",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
      }],
    });

    render(
      <MemoryRouter initialEntries={["/strategies"]}>
        <I18nProvider>
          <StrategyLibrary />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("详情策略")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑" }));

    expect(await screen.findByText("策略详情")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/def generate_signals/)).toBeInTheDocument();
  });

  it("starts paper trading from the owned strategy row", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listStrategies).mockResolvedValueOnce({
      strategies: [{
        id: "owned-paper-1",
        name: "模拟盘策略",
        description: "paper",
        language: "python",
        category: "trend",
        status: "draft",
        tags: ["paper"],
        code: "def generate_signals(data):\n    return 0",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
      }],
    });

    render(
      <MemoryRouter initialEntries={["/strategies"]}>
        <I18nProvider>
          <StrategyLibrary />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("模拟盘策略")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "模拟盘运行" }));

    await waitFor(() => expect(api.createPaperDeployment).toHaveBeenCalledWith(expect.objectContaining({
      strategy_id: "owned-paper-1",
      limits: expect.objectContaining({ symbols: ["BTC_USDT"], order_type: "MARKET" }),
    })));
    expect(api.startPaperDeployment).toHaveBeenCalledWith("paper_1");
    expect(api.runPaperDeploymentTick).toHaveBeenCalledWith("paper_1");
  });
});
