import { api } from "@/lib/api";

describe("paper deployment api", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown) {
    return {
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
      headers: new Headers({ "content-type": "application/json" }),
    } as Response;
  }

  it("creates a paper deployment with limits", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ deployment: { deployment_id: "paper_1" } }));

    await api.createPaperDeployment({
      strategy_id: "dual-ma",
      limits: {
        symbols: ["BTC_USDT"],
        max_order_notional: 500,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith("/paper/deployments", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        strategy_id: "dual-ma",
        limits: {
          symbols: ["BTC_USDT"],
          max_order_notional: 500,
        },
      }),
    }));
  });

  it("runs a paper deployment tick", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ tick: { outcome: "no_action" } }));

    await api.runPaperDeploymentTick("paper_1");

    expect(fetchMock).toHaveBeenCalledWith("/paper/deployments/paper_1/tick", expect.objectContaining({
      method: "POST",
    }));
  });
});
