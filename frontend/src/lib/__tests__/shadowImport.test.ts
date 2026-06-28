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
        prompt: "Run a BTC breakout check",
        elapsed_seconds: 12.4,
        run_stage: "completed",
        run_directory: "/tmp/run-1",
        trade_log: [
          { symbol: "ETH/USDT", side: "BUY", quantity: "10", price: "3500", pnl: "120.5", pnl_pct: "3.1%", entry_time: "2026-06-26T01:00:00Z" },
          { ticker: "BTC-USDT", action: "SELL", qty: "1", entry_price: "65000", notional: "65000", profit_loss: "-80", return_pct: "-0.5%", exit_time: "2026-06-26T02:00:00Z" },
        ],
      },
    });

    expect(draft.runId).toBe("run-1");
    expect(draft.symbol).toBe("BTC_USDT");
    expect(draft.side).toBe("BUY");
    expect(draft.orderType).toBe("MARKET");
    expect(draft.quantity).toBeCloseTo(0.0769231, 6);
    expect(draft.metrics?.max_drawdown).toBe(-0.08);
    expect(draft.run).toMatchObject({
      prompt: "Run a BTC breakout check",
      status: "success",
      elapsed_seconds: 12.4,
      run_stage: "completed",
      run_directory: "/tmp/run-1",
      trade_count: 2,
    });
    expect(draft.run?.trades).toHaveLength(2);
    expect(draft.run?.trades?.[1]).toMatchObject({
      source: "run_log",
      symbol: "BTC_USDT",
      side: "SELL",
      quantity: 1,
      price: 65000,
      notional: 65000,
      pnl: -80,
      pnl_percent: -0.5,
      closed_at: "2026-06-26T02:00:00Z",
    });
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
    expect(draft.quantity).toBeCloseTo(0.0336073, 6);
  });

  it("round-trips drafts through session storage", () => {
    const draft = buildShadowImportDraft({
      runId: "run-3",
      shadowId: "shadow_1234abcd",
      runData: {
        status: "success",
        run_id: "run-3",
        prompt: "Try SOL/USDT",
        elapsed_seconds: 0,
        run_stage: "saved",
      },
    });

    const key = saveShadowImportDraft(draft);
    const loaded = loadShadowImportDraft(key);

    expect(loaded?.runId).toBe("run-3");
    expect(loaded?.shadowId).toBe("shadow_1234abcd");
    expect(loaded?.symbol).toBe("SOL_USDT");
    expect(loaded?.run).toMatchObject({
      prompt: "Try SOL/USDT",
      status: "success",
      elapsed_seconds: 0,
      run_stage: "saved",
    });
    expect(loadShadowImportDraft(key)).toBeNull();
  });
});
