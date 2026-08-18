import { act, render, waitFor } from "@testing-library/react";
import { KLineChartPanel } from "@/components/charts/KLineChartPanel";
import { api } from "@/lib/api";

const chartApi = vi.hoisted(() => ({
  applyNewData: vi.fn(),
  updateData: vi.fn(),
  createIndicator: vi.fn(),
  resize: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getCryptoKlineStreamUrl: vi.fn(() => "ws://test/crypto/stream"),
  },
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  close() {
    this.onclose?.();
  }
}

describe("KLineChartPanel live stream", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.clearAllMocks();
    vi.stubGlobal("WebSocket", MockWebSocket);
    window.klinecharts = {
      init: vi.fn(() => chartApi),
      dispose: vi.fn(),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.klinecharts;
  });

  it("updates the visible last bar when websocket kline pushes arrive", async () => {
    render(
      <KLineChartPanel
        symbol="BTC/USDT"
        timeframe="1h"
        bars={[{
          time: "2026-08-06T00:00:00Z",
          timestamp: 1_786_080_000_000,
          symbol: "BTC/USDT",
          open: 67000,
          high: 67300,
          low: 66900,
          close: 67200,
          volume: 1000,
        }]}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(api.getCryptoKlineStreamUrl).toHaveBeenCalledWith("BTC/USDT", "1h");

    const pushedBar = {
      timestamp: 1_786_080_000_000,
      open: 67000,
      high: 68100,
      low: 66900,
      close: 68050,
      volume: 1250,
    };

    await act(async () => {
      MockWebSocket.instances[0].emitMessage({ type: "kline", bar: pushedBar });
    });

    expect(chartApi.updateData).toHaveBeenCalledWith(pushedBar);
  });
});
