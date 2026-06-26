import {
  buildShadowImportDraft,
  loadShadowImportDraft,
  saveShadowImportDraft,
} from "@/lib/shadowImport";

describe("shadowImport", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("builds a conservative shadow draft from a supported crypto trade log", () => {
    const draft = buildShadowImportDraft({
      runId: "run-1",
      metrics: {
        total_return: 0.12,
        sharpe: 1.4,
        max_drawdown: -0.08,
        trade_count: 7,
      },
      runData: {
        status: "success",
        run_id: "run-1",
        trade_log: [
          { symbol: "ETH/USDT", quantity: "10", price: "3500" },
          { ticker: "BTC-USDT", qty: "1", entry_price: "65000" },
        ],
      },
    });

    expect(draft.runId).toBe("run-1");
    expect(draft.symbol).toBe("BTC_USDT");
    expect(draft.side).toBe("BUY");
    expect(draft.orderType).toBe("MARKET");
    expect(draft.quantity).toBeCloseTo(0.0769231, 6);
    expect(draft.metrics?.max_drawdown).toBe(-0.08);
  });

  it("falls back to a BTC market test when no supported symbol is present", () => {
    const draft = buildShadowImportDraft({
      runData: {
        status: "success",
        run_id: "run-2",
        prompt: "Backtest my NVDA strategy",
      },
    });

    expect(draft.symbol).toBe("BTC_USDT");
    expect(draft.quantity).toBeCloseTo(0.0307692, 6);
  });

  it("round-trips drafts through session storage", () => {
    const draft = buildShadowImportDraft({
      runId: "run-3",
      shadowId: "shadow_1234abcd",
      runData: {
        status: "success",
        run_id: "run-3",
        prompt: "Try SOL/USDT",
      },
    });

    const key = saveShadowImportDraft(draft);
    const loaded = loadShadowImportDraft(key);

    expect(loaded?.runId).toBe("run-3");
    expect(loaded?.shadowId).toBe("shadow_1234abcd");
    expect(loaded?.symbol).toBe("SOL_USDT");
    expect(loadShadowImportDraft(key)).toBeNull();
  });
});
