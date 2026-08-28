import { buildClassicTurtlePythonStrategyCode } from "@/lib/strategyMarketplace";
import { toQuantaxisStrategyCode } from "@/lib/quantaxisStrategy";

describe("quantaxis strategy codegen", () => {
  it("accepts common OHLCV aliases in the classic turtle template", () => {
    const code = buildClassicTurtlePythonStrategyCode();
    expect(code).toContain("_pick_ohlcv_column");
    expect(code).toContain('"close_price"');
    expect(code).toContain('"Close"');
    expect(code).toContain('"price"');
  });

  it("coerces legacy generate_signals inputs into a dataframe", () => {
    const wrapped = toQuantaxisStrategyCode("def generate_signals(data):\n    return data", "Legacy");
    expect(wrapped).toContain("frame = _coerce_frame");
    expect(wrapped).toContain("generate_signals(frame)");
  });
});
