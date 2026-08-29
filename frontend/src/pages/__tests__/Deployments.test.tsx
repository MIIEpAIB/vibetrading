import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "@/i18n/I18nProvider";
import { Deployments } from "@/pages/Deployments";
import { api } from "@/lib/api";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

vi.mock("@/components/charts/StrategyReturnChart", () => ({
  StrategyReturnChart: () => <div data-testid="strategy-return-chart" />,
}));

vi.mock("@/components/charts/KLineChartPanel", () => ({
  KLineChartPanel: ({ symbol, timeframe, bars }: { symbol: string; timeframe: string; bars: Array<{ close: number }> }) => (
    <div data-testid="kline-panel">{`${symbol}:${timeframe}:${bars.length}`}</div>
  ),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getQuantaxisRuntime: vi.fn(),
      listDeployments: vi.fn(),
      getDeployment: vi.fn(),
      listExchangeApiKeys: vi.fn(),
      listStrategies: vi.fn(),
      getQuantaxisAccountSnapshot: vi.fn(),
      listQuantaxisAccountOrders: vi.fn(),
      listQuantaxisAccountTrades: vi.fn(),
      listDeploymentSignals: vi.fn(),
      listDeploymentEvents: vi.fn(),
      getCryptoKlines: vi.fn(),
      upsertStrategy: vi.fn(),
      deleteStrategy: vi.fn(),
      archiveDeployment: vi.fn(),
      promoteDeployment: vi.fn(),
      recoverDeployment: vi.fn(),
      submitDeploymentTestSignal: vi.fn(),
    },
  };
});

const shadowDeployment = {
  deployment_id: "qadep_shadow",
  user_id: 7,
  target: "SHADOW",
  status: "RECOVERY_REQUIRED",
  strategy_snapshot: {
    strategy_id: "s1",
    version_no: 2,
    owner_user_id: 7,
    name: "Momentum",
    description: "",
    strategy_description: "",
    language: "python",
    category: "trend",
    tags: [],
    code: "",
    code_sha256: "hash-1",
    created_at: "2026-08-20T00:00:00Z",
    parameter_schema: {},
  },
  account_cookie: "qa:shadow:7:qadep_shadow",
  market: "CRYPTO",
  symbols: ["BTC_USDT"],
  timeframe: "1h",
  parameters: {},
  risk_policy: { initial_cash: 100000 },
  broker_binding_id: null,
  created_at: "2026-08-20T00:00:00Z",
  updated_at: "2026-08-20T00:01:00Z",
  recovery_reason: "qifi unavailable",
};

const liveRecoveryDeployment = {
  ...shadowDeployment,
  deployment_id: "qadep_f297c7abfcf7",
  target: "LIVE",
  status: "RECOVERY_REQUIRED",
};

function renderDeployments() {
  return render(
    <MemoryRouter initialEntries={["/deployments/qadep_shadow"]}>
      <I18nProvider>
        <Routes>
          <Route path="/deployments/:deploymentId" element={<Deployments />} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("Deployments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getQuantaxisRuntime).mockResolvedValue({
      available: true,
      version: "2.1.0",
      quantaxis_path: "/opt/QUANTAXIS",
      runtime_home: ".runtime/quantaxis",
      modules: { QIFI: true },
      requires: { mongo: "mongodb://localhost:27017", qifi_password: "configured" },
      durable_store_configured: true,
      qapubsub_configured: true,
      error: "",
    });
    vi.mocked(api.listDeployments).mockResolvedValue({ deployments: [shadowDeployment] } as never);
    vi.mocked(api.getDeployment).mockResolvedValue({ deployment: shadowDeployment } as never);
    vi.mocked(api.listExchangeApiKeys).mockResolvedValue({
      bindings: [{ binding_id: 99, exchange: "binance", label: "Live Binance", status: "active" }],
    } as never);
    vi.mocked(api.listStrategies).mockResolvedValue({
      strategies: [{
        id: "s1",
        name: "Momentum",
        description: "",
        strategyDescription: "",
        language: "python",
        category: "trend",
        status: "archived",
        tags: [],
        code: "",
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:01:00Z",
      }],
    } as never);
    vi.mocked(api.getQuantaxisAccountSnapshot).mockResolvedValue({
      account_cookie: shadowDeployment.account_cookie,
      cash: 1000,
      frozen: 5,
      market_value: 250,
      total_asset: 1250,
    });
    vi.mocked(api.listQuantaxisAccountOrders).mockResolvedValue({
      account_cookie: shadowDeployment.account_cookie,
      orders: [{ order_id: "o1", symbol: "BTC_USDT", status: "FILLED", side: "BUY", price: 100, quantity: 1 }],
    } as never);
    vi.mocked(api.listQuantaxisAccountTrades).mockResolvedValue({
      account_cookie: shadowDeployment.account_cookie,
      trades: [{ trade_id: "t1", order_id: "o1", symbol: "BTC_USDT", price: 100, quantity: 1 }],
    } as never);
    vi.mocked(api.listDeploymentSignals).mockResolvedValue({
      deployment_id: shadowDeployment.deployment_id,
      signals: [{ action: "BUY", symbol: "BTC_USDT" }],
    });
    vi.mocked(api.listDeploymentEvents).mockResolvedValue({
      deployment_id: shadowDeployment.deployment_id,
      events: [{ event_id: "e1", sequence_no: 4, event_type: "deployment.recovery_required" }],
    } as never);
    vi.mocked(api.getCryptoKlines).mockResolvedValue({
      status: "ok",
      symbol: "BTC/USDT",
      timeframe: "5m",
      source: "okx",
      updated_at: "2026-08-20T00:00:00Z",
      storage: { redis: "disabled", timescale: "disabled" },
      bars: [
        {
          time: "2026-08-20T00:00:00Z",
          timestamp: 1,
          symbol: "BTC/USDT",
          open: 66900,
          high: 67100,
          low: 66850,
          close: 67000,
          volume: 10,
        },
      ],
    } as never);
    vi.mocked(api.promoteDeployment).mockResolvedValue({
      deployment: { ...shadowDeployment, deployment_id: "qadep_live", target: "LIVE", status: "DRAFT", broker_binding_id: 99 },
    } as never);
    vi.mocked(api.recoverDeployment).mockResolvedValue({
      deployment: { ...liveRecoveryDeployment, status: "RUNNING", broker_binding_id: 99, recovery_reason: "" },
    } as never);
    vi.mocked(api.submitDeploymentTestSignal).mockResolvedValue({
      deployment_id: shadowDeployment.deployment_id,
      signal_type: "BUY_OPEN",
      signal: {},
      signal_event: {},
      execution: {},
    });
    vi.mocked(api.upsertStrategy).mockResolvedValue({
      id: "s1",
      name: "Momentum",
      description: "",
      strategyDescription: "",
      language: "python",
      category: "trend",
      status: "draft",
      tags: [],
      code: "",
      createdAt: "2026-08-20T00:00:00Z",
      updatedAt: "2026-08-20T00:02:00Z",
    } as never);
    vi.mocked(api.deleteStrategy).mockResolvedValue({ status: "deleted", id: "s1" } as never);
    vi.mocked(api.archiveDeployment).mockResolvedValue({
      deployment: { ...shadowDeployment, status: "ARCHIVED" },
    } as never);
  });

  it("renders shared deployment detail with QIFI projections and recovery state", async () => {
    renderDeployments();

    expect(await screen.findByText("Momentum")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recover Deployment" })).toBeInTheDocument();
    expect(screen.getByText("Main Ledger")).toBeInTheDocument();
    expect(screen.getByText("Strategy Signals")).toBeInTheDocument();
    expect(screen.getByText("Runtime Events")).toBeInTheDocument();
    expect(await screen.findByTestId("kline-panel")).toBeInTheDocument();
    expect((await screen.findAllByText(/deployment.recovery_required/)).length).toBeGreaterThan(0);
    expect(api.getQuantaxisAccountSnapshot).toHaveBeenCalledWith(shadowDeployment.account_cookie);
  });

  it("submits shadow recovery without requiring a broker binding", async () => {
    const user = userEvent.setup();
    vi.mocked(api.recoverDeployment).mockResolvedValue({
      deployment: { ...shadowDeployment, status: "RUNNING", recovery_reason: "" },
    } as never);

    renderDeployments();

    await screen.findByRole("button", { name: "Recover Deployment" });
    await user.click(screen.getByRole("button", { name: "Recover Deployment" }));

    await waitFor(() => expect(api.recoverDeployment).toHaveBeenCalledWith("qadep_shadow", {}));
  });

  it("shows recovery action for stopped shadow deployments", async () => {
    const user = userEvent.setup();
    const stoppedDeployment = { ...shadowDeployment, status: "STOPPED", stopped_at: "2026-08-20T00:00:00Z", recovery_reason: "" };
    vi.mocked(api.listDeployments).mockResolvedValue({ deployments: [stoppedDeployment] } as never);
    vi.mocked(api.getDeployment).mockResolvedValue({ deployment: stoppedDeployment } as never);
    vi.mocked(api.recoverDeployment).mockResolvedValue({
      deployment: { ...stoppedDeployment, status: "RUNNING", stopped_at: null },
    } as never);

    renderDeployments();

    await screen.findByText("Stopped");
    await user.click(screen.getByRole("button", { name: "Recover Deployment" }));

    await waitFor(() => expect(api.recoverDeployment).toHaveBeenCalledWith("qadep_shadow", {}));
  });

  it("restores an archived shadow strategy from the detail page", async () => {
    const user = userEvent.setup();

    renderDeployments();

    await screen.findByText("Main Ledger");
    await user.click(screen.getByRole("button", { name: "Restore from archive" }));

    await waitFor(() => expect(api.upsertStrategy).toHaveBeenCalledWith(expect.objectContaining({
      id: "s1",
      status: "draft",
    })));
  });

  it("deletes a shadow deployment from the detail page without deleting the library strategy", async () => {
    const user = userEvent.setup();

    renderDeployments();

    await screen.findByText("Main Ledger");
    await user.click(screen.getByRole("button", { name: "Delete deployment" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(api.archiveDeployment).toHaveBeenCalledWith("qadep_shadow"));
    expect(api.deleteStrategy).not.toHaveBeenCalled();
  });

  it("hides archived shadow deployments without deleting the library strategy", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listDeployments)
      .mockResolvedValueOnce({
        deployments: [shadowDeployment],
      } as never)
      .mockResolvedValue({ deployments: [{ ...shadowDeployment, status: "ARCHIVED" }] } as never);

    render(
      <MemoryRouter initialEntries={["/deployments/qadep_shadow"]}>
        <I18nProvider>
          <Routes>
            <Route path="/deployments" element={<Deployments />} />
            <Route path="/deployments/:deploymentId" element={<Deployments />} />
          </Routes>
        </I18nProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Main Ledger");
    await user.click(screen.getByRole("button", { name: "Delete deployment" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(api.archiveDeployment).toHaveBeenCalledWith("qadep_shadow"));
    await waitFor(() => expect(screen.queryByText("Momentum")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete deployment" })).not.toBeInTheDocument());
    expect(api.deleteStrategy).not.toHaveBeenCalled();
  });

  it("prefills the shadow test signal price from BTC kline data and submits it", async () => {
    const user = userEvent.setup();
    const runningDeployment = {
      ...shadowDeployment,
      status: "RUNNING",
      recovery_reason: "",
      risk_policy: { ...shadowDeployment.risk_policy, max_order_notional: 67000 },
    };
    vi.mocked(api.listDeployments).mockResolvedValue({ deployments: [runningDeployment] } as never);
    vi.mocked(api.getDeployment).mockResolvedValue({ deployment: runningDeployment } as never);

    renderDeployments();

    await screen.findByText("Main Ledger");
    const orderPanel = screen.getByText("下单面板").closest("section");
    expect(orderPanel).not.toBeNull();
    expect(within(orderPanel as HTMLElement).getByText("下单面板")).toBeInTheDocument();
    expect(await screen.findByLabelText("Quantity")).toHaveValue(1);
    await screen.findByDisplayValue("67000");
    await user.click(screen.getByRole("button", { name: "10%" }));
    expect(screen.getByLabelText("Quantity")).toHaveValue(1);
    expect(toast.error).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Buy Open/ }));

    await waitFor(() => expect(api.submitDeploymentTestSignal).toHaveBeenCalledWith("qadep_shadow", {
      signal_type: "BUY_OPEN",
      symbol: "BTC_USDT",
      quantity: 1,
      price: 67000,
    }));
  });

  it("blocks shadow test signals when one lot exceeds max_order_notional", async () => {
    const user = userEvent.setup();
    const runningDeployment = {
      ...shadowDeployment,
      status: "RUNNING",
      recovery_reason: "",
      risk_policy: { ...shadowDeployment.risk_policy, max_order_notional: 1000 },
    };
    vi.mocked(api.listDeployments).mockResolvedValue({ deployments: [runningDeployment] } as never);
    vi.mocked(api.getDeployment).mockResolvedValue({ deployment: runningDeployment } as never);

    renderDeployments();

    await screen.findByText("Main Ledger");
    await screen.findByDisplayValue("67000");
    expect(screen.getByRole("button", { name: /Buy Open/ })).toBeDisabled();
    const orderPanel = screen.getByText("下单面板").closest("section");
    expect(orderPanel).not.toBeNull();
    expect(within(orderPanel as HTMLElement).getByText("The minimum executable quantity exceeds max_order_notional. Increase the deployment risk limit or lower the test price.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "10%" }));
    expect(toast.error).toHaveBeenCalledWith("This sizing is below the simulated account minimum lot. Increase max_order_notional or use a higher percentage.");
    expect(api.submitDeploymentTestSignal).not.toHaveBeenCalled();
  });

  it("presents skipped shadow execution as a business status with guidance", async () => {
    vi.mocked(api.listDeploymentEvents).mockResolvedValue({
      deployment_id: shadowDeployment.deployment_id,
      events: [{
        event_id: "e-skip",
        sequence_no: 8,
        event_scope: "order",
        event_type: "order.skipped",
        payload: {
          reason: "QIFI order quantity must be at least 1",
          intent: { symbol: "BTC_USDT", quantity: 0.5, price: 67000 },
        },
      }],
    } as never);

    renderDeployments();

    expect(await screen.findAllByText("Signal not executed")).not.toHaveLength(0);
    expect(screen.getAllByText("Order quantity is below the simulated account minimum lot, so execution was skipped.").length).toBeGreaterThan(0);
    expect(screen.queryByText("QIFI order quantity must be at least 1")).not.toBeInTheDocument();
  });

  it("shows QIFI configuration guidance instead of loading account projections when durable store is missing", async () => {
    vi.mocked(api.getQuantaxisRuntime).mockResolvedValue({
      available: true,
      version: "2.1.0",
      quantaxis_path: "/opt/QUANTAXIS",
      runtime_home: ".runtime/quantaxis",
      modules: { QIFI: true },
      requires: { mongo: "", qifi_password: "" },
      durable_store_configured: false,
      qapubsub_configured: true,
      error: "",
    });

    renderDeployments();

    expect(await screen.findAllByText(/QIFI account projection is waiting for durable store configuration/)).toHaveLength(1);
    expect(screen.getAllByText(/QUANTAXIS_MONGOURI/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/VIBE_QUANTAXIS_QIFI_PASSWORD/).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(api.getQuantaxisAccountSnapshot).toHaveBeenCalledTimes(0));
    expect(api.listDeploymentSignals).not.toHaveBeenCalled();
  });

  it("explains what a deployment is waiting for when no runtime records exist", async () => {
    vi.mocked(api.listDeploymentSignals).mockResolvedValue({
      deployment_id: shadowDeployment.deployment_id,
      signals: [],
    });
    vi.mocked(api.listDeploymentEvents).mockResolvedValue({
      deployment_id: shadowDeployment.deployment_id,
      events: [],
    } as never);

    renderDeployments();

    expect(await screen.findByText("Strategy Signals")).toBeInTheDocument();
    expect(await screen.findByText("Runtime Events")).toBeInTheDocument();
    expect(screen.getByText(/No strategy signal has been emitted yet/)).toBeInTheDocument();
    expect(screen.getByText(/No runtime events have been recorded yet/)).toBeInTheDocument();
  });

  it("submits shadow promotion with consent and selected broker binding", async () => {
    const user = userEvent.setup();
    const promotableDeployment = { ...shadowDeployment, status: "PAUSED", recovery_reason: "" };
    vi.mocked(api.listDeployments).mockResolvedValue({ deployments: [promotableDeployment] } as never);
    vi.mocked(api.getDeployment).mockResolvedValue({ deployment: promotableDeployment } as never);
    renderDeployments();

    await screen.findByText("Promote To Live");
    await user.selectOptions(screen.getByLabelText("Broker Binding"), "99");
    await user.click(screen.getByLabelText(/I confirm this creates/));
    await user.click(screen.getByRole("button", { name: /Promote/ }));

    await waitFor(() => expect(api.promoteDeployment).toHaveBeenCalledWith("qadep_shadow", {
      broker_binding_id: 99,
      risk_policy: {},
    }));
  });

  it("submits live recovery with the selected broker exchange", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listDeployments).mockResolvedValue({ deployments: [liveRecoveryDeployment] } as never);
    vi.mocked(api.getDeployment).mockResolvedValue({ deployment: liveRecoveryDeployment } as never);

    render(
      <MemoryRouter initialEntries={["/deployments/qadep_f297c7abfcf7"]}>
        <I18nProvider>
          <Routes>
            <Route path="/deployments/:deploymentId" element={<Deployments />} />
          </Routes>
        </I18nProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Recover Live Deployment" });
    await user.selectOptions(screen.getByLabelText("Broker Binding"), "99");
    await user.click(screen.getByRole("button", { name: /Recover Live Deployment/ }));

    await waitFor(() => expect(api.recoverDeployment).toHaveBeenCalledWith("qadep_f297c7abfcf7", {
      broker: "binance",
    }));
  });

  it("renders deployment copy in Chinese when the language is zh-CN", async () => {
    window.localStorage.setItem("vibe-language", "zh-CN");

    render(
      <MemoryRouter initialEntries={["/deployments"]}>
        <I18nProvider>
          <Routes>
            <Route path="/deployments" element={<Deployments />} />
          </Routes>
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("策略部署")).toBeInTheDocument();
    expect(screen.getByText("刷新")).toBeInTheDocument();
    expect(screen.getByText("需要恢复")).toBeInTheDocument();
    window.localStorage.removeItem("vibe-language");
  });
});
