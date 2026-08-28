export const quantaxisStarterCode = `"""
QUANTAXIS-native strategy template.

Return order intents from QAStrategy.on_tick. The platform routes accepted
intents through risk policy, QAMarket/QIFI shadow execution, or the live gate.
SignalEngine is kept as a vectorized backtest adapter for existing research
pipelines.
"""

import pandas as pd


PARAMS = {
    "fast_window": 20,
    "slow_window": 60,
    "default_quantity": 1.0,
}


class QAStrategy(QAStrategyCtaBase):
    def on_tick(self, context):
        market = context["market_event"]
        params = {**PARAMS, **context.get("parameters", {})}
        account = context.get("account", {})
        price = float(market.get("close") or market.get("price") or 0)
        symbol = str(market.get("symbol") or "")

        if price <= 0 or not symbol:
            return {"action": "HOLD", "reason": "missing market price or symbol"}

        return {
            "action": "HOLD",
            "symbol": symbol,
            "quantity": float(params["default_quantity"]),
            "price": price,
            "reason": f"QAStrategy template waiting for signal; cash={account.get('cash')}",
        }


class SignalEngine:
    def generate(self, data_map):
        out = {}
        for code, df in data_map.items():
            close = df["close"].astype(float)
            fast = close.rolling(PARAMS["fast_window"]).mean()
            slow = close.rolling(PARAMS["slow_window"]).mean()
            out[code] = (fast > slow).astype(float).diff().fillna(0.0).clip(-1.0, 1.0)
        return out
`;

export function isQuantaxisStrategyCode(code: string): boolean {
  return /\bclass\s+(?:QAStrategy|Strategy)\b/.test(code)
    || /\bQAStrategyCtaBase\b/.test(code)
    || /\bdef\s+(?:on_tick|on_market_event|generate_intent)\s*\(/.test(code);
}

function pythonStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function legacyAdapterCode(originalCode: string): string {
  const frameAdapter = `        def _coerce_frame(payload):
            if isinstance(payload, pd.DataFrame):
                return payload
            if isinstance(payload, dict):
                for key in ("history", "bars", "data", "ohlcv"):
                    value = payload.get(key)
                    if isinstance(value, pd.DataFrame):
                        return value
                    if isinstance(value, list) and value and isinstance(value[0], dict):
                        return pd.DataFrame(value)
                market = payload.get("market_event") if isinstance(payload.get("market_event"), dict) else payload
                if isinstance(market, dict):
                    return pd.DataFrame([market])
            return pd.DataFrame()

        frame = _coerce_frame(context.get("history") or context.get("market_event") or context)
`;
  if (/\bclass\s+SignalEngine\b/.test(originalCode)) {
    return `        engine = SignalEngine()
        if hasattr(engine, "generate_intent"):
            return engine.generate_intent(context)
        if hasattr(engine, "generate_signal"):
            return engine.generate_signal(context)
        if hasattr(engine, "generate"):
${frameAdapter}        symbol = str((context.get("market_event") or {}).get("symbol") or context.get("symbol") or "default")
            return engine.generate({symbol: frame})
        return {"action": "HOLD", "reason": "legacy SignalEngine has no supported method"}`;
  }
  if (/\bdef\s+generate_signals\s*\(/.test(originalCode)) {
    return `        ${frameAdapter}        signal = generate_signals(frame)
        if isinstance(signal, dict):
            return signal
        return {"action": "HOLD", "signal": signal, "reason": "legacy generate_signals output is not an order intent"}`;
  }
  return `        return {"action": "HOLD", "reason": "legacy code is preserved but has no supported signal contract"}`;
}

export function toQuantaxisStrategyCode(code: string, strategyName = "Strategy"): string {
  const trimmed = String(code || "").trim();
  if (!trimmed) return quantaxisStarterCode;
  if (isQuantaxisStrategyCode(trimmed)) return trimmed;
  const adapter = legacyAdapterCode(trimmed);
  const hasPythonSignalContract = /\bclass\s+SignalEngine\b/.test(trimmed) || /\bdef\s+generate_signals\s*\(/.test(trimmed);
  const preservedSource = hasPythonSignalContract
    ? trimmed
    : `ORIGINAL_STRATEGY_SOURCE = ${pythonStringLiteral(trimmed)}`;
  return `"""
QUANTAXIS-native wrapper for ${strategyName}.

The original strategy code is preserved below. QAStrategy.on_tick is the
deployment entry point; SignalEngine/generate_signals remains available for
legacy backtests when present.
"""

${preservedSource}


class QAStrategy(QAStrategyCtaBase):
    def on_tick(self, context):
${adapter}


STRATEGY_FORMAT = ${pythonStringLiteral("quantaxis-native")}
`;
}
