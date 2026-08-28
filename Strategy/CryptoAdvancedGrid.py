"""QUANTAXIS-native wrapper for 专业网格交易策略.

The legacy ccxt runner is kept only as reference material. QUANTAXIS uses the
`QAStrategy` entry point below, while `SignalEngine` provides backtest and
signal generation support.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

try:  # pragma: no cover - QUANTAXIS provides this in runtime environments.
    QAStrategyCtaBase
except NameError:  # pragma: no cover - keeps the template importable in tests.
    class QAStrategyCtaBase:  # type: ignore[no-redef]
        pass


ORIGINAL_STRATEGY_SOURCE = """# Legacy ccxt-based grid runner was replaced by the QUANTAXIS wrapper below.
class CryptoAdvancedGrid:
    pass
"""


PARAMS: dict[str, Any] = {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "ohlcv_limit": 250,
    "grid_capital": 1000.0,
    "grid_count": 10,
    "use_trend_filter": True,
    "leverage_step": 0.05,
    "atr_grid_factor": 0.5,
    "min_grid_step": 0.005,
    "max_grid_step": 0.03,
}


def _true_range(frame: pd.DataFrame) -> pd.Series:
    prev_close = frame["close"].shift(1)
    ranges = pd.concat(
        [
            frame["high"] - frame["low"],
            (frame["high"] - prev_close).abs(),
            (frame["low"] - prev_close).abs(),
        ],
        axis=1,
    )
    return ranges.max(axis=1)


def _precision_levels(levels: list[float]) -> list[float]:
    return [round(float(level), 8) for level in levels]


@dataclass(slots=True)
class GridSnapshot:
    symbol: str
    action: str
    price: float
    quantity: float
    reason: str
    current_price: float
    ema_200: float
    atr: float
    grid_step: float
    buy_levels: list[float] = field(default_factory=list)
    sell_levels: list[float] = field(default_factory=list)

    def to_order_intent(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "symbol": self.symbol,
            "quantity": self.quantity,
            "price": self.price,
            "reason": self.reason,
            "meta": {
                "current_price": self.current_price,
                "ema_200": self.ema_200,
                "atr": self.atr,
                "grid_step": self.grid_step,
                "buy_levels": self.buy_levels,
                "sell_levels": self.sell_levels,
            },
        }


class SignalEngine:
    """Generate grid intents from OHLCV data."""

    def __init__(self, params: dict[str, Any] | None = None):
        self.params = {**PARAMS, **(params or {})}

    def _build_grid(self, current_price: float, current_atr: float) -> tuple[float, list[float], list[float]]:
        step = (current_atr / current_price) * float(self.params["atr_grid_factor"])
        step = max(min(step, float(self.params["max_grid_step"])), float(self.params["min_grid_step"]))

        grid_count = int(self.params["grid_count"])
        buy_levels = _precision_levels([current_price * ((1 - step) ** idx) for idx in range(1, grid_count + 1)])
        sell_levels = _precision_levels([current_price * ((1 + step) ** idx) for idx in range(1, grid_count + 1)])
        return step, buy_levels, sell_levels

    def _grid_quantity(self, price: float, grid_index: int, side: str) -> float:
        base_notional = float(self.params["grid_capital"]) / max(int(self.params["grid_count"]), 1)
        if side == "BUY":
            base_notional *= 1.0 + (grid_index * float(self.params["leverage_step"]))
        return base_notional / max(price, 1e-12)

    def analyze_symbol(self, symbol: str, df: pd.DataFrame) -> GridSnapshot:
        frame = df.copy()
        frame["open"] = frame["open"].astype(float)
        frame["high"] = frame["high"].astype(float)
        frame["low"] = frame["low"].astype(float)
        frame["close"] = frame["close"].astype(float)

        frame["ema_200"] = frame["close"].ewm(span=200, adjust=False).mean()
        frame["atr"] = _true_range(frame).rolling(14, min_periods=5).mean()

        latest = frame.iloc[-1]
        current_price = float(latest["close"])
        current_ema = float(latest["ema_200"])
        current_atr = float(latest["atr"])

        if pd.isna(current_atr) or current_atr <= 0 or current_price <= 0:
            return GridSnapshot(
                symbol=symbol,
                action="HOLD",
                price=current_price,
                quantity=0.0,
                reason="not enough data to build a grid",
                current_price=current_price,
                ema_200=current_ema,
                atr=current_atr if not pd.isna(current_atr) else 0.0,
                grid_step=0.0,
            )

        step, buy_levels, sell_levels = self._build_grid(current_price, current_atr)
        use_trend_filter = bool(self.params["use_trend_filter"])
        is_uptrend = current_price >= current_ema

        action = "HOLD"
        order_price = current_price
        quantity = 0.0
        reason = "price remains inside the active grid"

        lower_trigger = buy_levels[0]
        upper_trigger = sell_levels[0]

        if current_price <= lower_trigger:
            if use_trend_filter and not is_uptrend:
                reason = f"trend filter blocked long entry below EMA200 ({current_ema:.2f})"
            else:
                action = "BUY"
                order_price = lower_trigger
                quantity = self._grid_quantity(order_price, 0, "BUY")
                reason = f"price touched the first buy grid at {lower_trigger:.8f}"
        elif current_price >= upper_trigger:
            action = "SELL"
            order_price = upper_trigger
            quantity = self._grid_quantity(order_price, 0, "SELL")
            reason = f"price touched the first sell grid at {upper_trigger:.8f}"
        elif use_trend_filter and not is_uptrend:
            reason = f"bearish regime detected below EMA200 ({current_ema:.2f})"

        return GridSnapshot(
            symbol=symbol,
            action=action,
            price=order_price,
            quantity=quantity,
            reason=reason,
            current_price=current_price,
            ema_200=current_ema,
            atr=current_atr,
            grid_step=step,
            buy_levels=buy_levels,
            sell_levels=sell_levels,
        )

    def generate_signals(self, data_map: dict[str, pd.DataFrame]) -> dict[str, dict[str, Any]]:
        return {symbol: self.analyze_symbol(symbol, frame).to_order_intent() for symbol, frame in data_map.items()}

    def generate(self, data_map: dict[str, pd.DataFrame]) -> dict[str, dict[str, Any]]:
        return self.generate_signals(data_map)


class QAStrategy(QAStrategyCtaBase):
    """Runtime QUANTAXIS entry point for the professional grid strategy."""

    def __init__(self, parameters: dict[str, Any] | None = None):
        self.parameters = {**PARAMS, **(parameters or {})}
        self.engine = SignalEngine(self.parameters)
        self.last_snapshot: dict[str, GridSnapshot] = {}

    def on_tick(self, context: dict[str, Any]) -> dict[str, Any]:
        market = context.get("market_event", {})
        params = {**self.parameters, **context.get("parameters", {})}
        self.engine = SignalEngine(params)

        symbol = str(market.get("symbol") or params["symbol"] or "")
        price = float(market.get("close") or market.get("price") or 0)
        if not symbol or price <= 0:
            return {"action": "HOLD", "reason": "missing market price or symbol"}

        history = context.get("history") or market.get("bars") or market.get("data")
        if isinstance(history, pd.DataFrame) and not history.empty:
            snapshot = self.engine.analyze_symbol(symbol, history)
            self.last_snapshot[symbol] = snapshot
            return snapshot.to_order_intent()

        snapshot = self.last_snapshot.get(symbol)
        if snapshot is not None and snapshot.grid_step > 0:
            distance = abs(price - snapshot.current_price) / max(snapshot.current_price, 1e-12)
            if distance < snapshot.grid_step:
                return {
                    "action": "HOLD",
                    "symbol": symbol,
                    "price": price,
                    "quantity": 0.0,
                    "reason": "waiting for grid confirmation from historical bars",
                }

        return {
            "action": "HOLD",
            "symbol": symbol,
            "price": price,
            "quantity": 0.0,
            "reason": "QUANTAXIS runtime awaits a full OHLCV frame before opening the grid",
        }


Strategy = QAStrategy
