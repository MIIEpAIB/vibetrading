import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "@/i18n/I18nProvider";
import { Deployments } from "@/pages/Deployments";
import { api } from "@/lib/api";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

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
      getQuantaxisAccountSnapshot: vi.fn(),
      listQuantaxisAccountOrders: vi.fn(),
      listQuantaxisAccountTrades: vi.fn(),
      listDeploymentSignals: vi.fn(),
      listDeploymentEvents: vi.fn(),
      deploymentEventsSseUrl: vi.fn(),
      promoteDeployment: vi.fn(),
      recoverDeployment: vi.fn(),
    },
  };
});

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  onerror: (() => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  emit(type: string, payload: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) });
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  close() {}
}

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
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
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
    vi.mocked(api.deploymentEventsSseUrl).mockReturnValue("/api/deployments/qadep_shadow/events/stream?after_sequence_no=4");
    vi.mocked(api.promoteDeployment).mockResolvedValue({
      deployment: { ...shadowDeployment, deployment_id: "qadep_live", target: "LIVE", status: "DRAFT", broker_binding_id: 99 },
    } as never);
    vi.mocked(api.recoverDeployment).mockResolvedValue({
      deployment: { ...liveRecoveryDeployment, status: "RUNNING", broker_binding_id: 99, recovery_reason: "" },
    } as never);
  });

  it("renders shared deployment detail with QIFI projections and recovery state", async () => {
    renderDeployments();

    expect(await screen.findByText("Momentum")).toBeInTheDocument();
    expect(screen.getByText("RECOVERY_REQUIRED")).toBeInTheDocument();
    expect(screen.getByText("QIFI Account")).toBeInTheDocument();
    expect(await screen.findByText("1000")).toBeInTheDocument();
    expect((await screen.findAllByText(/deployment.recovery_required/)).length).toBeGreaterThan(0);
    expect(api.getQuantaxisAccountSnapshot).toHaveBeenCalledWith(shadowDeployment.account_cookie);
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    expect(MockEventSource.instances[0].url).toContain("after_sequence_no=4");
  });

  it("reloads durable events when the event stream reconnects and surfaces stream failures", async () => {
    renderDeployments();
    await screen.findByText("Event stream:");
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));

    act(() => {
      MockEventSource.instances[0].onerror?.();
    });

    expect((await screen.findAllByText("reconnecting")).length).toBeGreaterThan(0);
    await waitFor(() => expect(vi.mocked(api.listDeploymentEvents).mock.calls.length).toBeGreaterThanOrEqual(2));

    act(() => {
      MockEventSource.instances[0].emit("deployment.error", { error: "gateway unavailable" });
    });

    expect(await screen.findByText("gateway unavailable")).toBeInTheDocument();
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

    expect(await screen.findAllByText(/QIFI account projection is waiting for durable store configuration/)).toHaveLength(2);
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

    expect(await screen.findByText("Running Strategy")).toBeInTheDocument();
    expect(await screen.findByText("No event yet")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the first runtime event/)).toBeInTheDocument();
    expect(screen.getByText(/No runtime events have been recorded yet/)).toBeInTheDocument();
    expect(screen.getByText(/No strategy signal has been emitted yet/)).toBeInTheDocument();
  });

  it("submits shadow promotion with consent and selected broker binding", async () => {
    const user = userEvent.setup();
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

    await screen.findByText("Recovery Required");
    await user.selectOptions(screen.getByLabelText("Broker Binding"), "99");
    await user.click(screen.getByRole("button", { name: /Recover Live Deployment/ }));

    await waitFor(() => expect(api.recoverDeployment).toHaveBeenCalledWith("qadep_f297c7abfcf7", {
      broker: "binance",
    }));
  });
});
