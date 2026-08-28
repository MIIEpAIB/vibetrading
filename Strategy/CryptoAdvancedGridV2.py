"""QUANTAXIS-native professional grid trading strategy v2."""

import pandas as pd

try:
    QAStrategyCtaBase
except NameError:
    class QAStrategyCtaBase:
        pass


STRATEGY_VERSION = "2.0.0"

PARAMS = {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "history_window": 240,
    "grid_capital": 1600.0,
    "grid_count": 16,
    "base_order_notional": 120.0,
    "max_inventory_notional": 2400.0,
    "atr_window": 14,
    "anchor_window": 72,
    "trend_fast_window": 34,
    "trend_slow_window": 144,
    "atr_grid_factor": 0.65,
    "min_grid_step": 0.004,
    "max_grid_step": 0.028,
    "volatility_pause_pct": 5.5,
    "stop_loss_pct": 8.0,
    "take_profit_pct": 1.2,
    "trend_filter": True,
    "rebalance_inventory": True,
}


def _merge_params(params):
    merged = dict(PARAMS)
    if isinstance(params, dict):
        merged.update(params)
    return merged


def _true_range(frame):
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


def _clean_frame(df):
    frame = df.copy()
    frame["open"] = frame["open"].astype(float)
    frame["high"] = frame["high"].astype(float)
    frame["low"] = frame["low"].astype(float)
    frame["close"] = frame["close"].astype(float)
    return frame


def _grid_levels(anchor, step, count):
    buy_levels = []
    sell_levels = []
    idx = 1
    while idx <= count:
        buy_levels.append(round(float(anchor * ((1.0 - step) ** idx)), 8))
        sell_levels.append(round(float(anchor * ((1.0 + step) ** idx)), 8))
        idx += 1
    return buy_levels, sell_levels


def _nearest_cross(price, previous_price, levels, side):
    selected = 0.0
    index = -1
    idx = 0
    for level in levels:
        touched = previous_price > level and price <= level if side == "BUY" else previous_price < level and price >= level
        if touched:
            selected = float(level)
            index = idx
            break
        idx += 1
    return selected, index


def _position_notional(account, symbol, price):
    positions = account.get("positions") if isinstance(account, dict) else []
    if not positions:
        return 0.0
    normalized_symbol = str(symbol).replace("/", "").replace("_", "").replace("-", "").upper()
    for item in positions:
        if not isinstance(item, dict):
            continue
        raw_symbol = str(item.get("symbol") or item.get("code") or "").replace("/", "").replace("_", "").replace("-", "").upper()
        if raw_symbol and raw_symbol != normalized_symbol:
            continue
        volume = float(item.get("volume") or item.get("amount") or item.get("quantity") or 0.0)
        entry_price = float(item.get("price") or item.get("cost_price") or price or 0.0)
        return abs(volume * max(entry_price, price))
    return 0.0


class SignalEngine:
    """Generate adaptive grid signals from OHLCV data."""

    def __init__(self, params=None):
        self.params = _merge_params(params)

    def analyze_symbol(self, symbol, df, account=None):
        frame = _clean_frame(df)
        if len(frame) < max(int(self.params["atr_window"]) + 2, 20):
            return {
                "action": "HOLD",
                "symbol": symbol,
                "quantity": 0.0,
                "price": float(frame["close"].iloc[-1]) if len(frame) else 0.0,
                "reason": "not enough bars for professional grid v2",
            }

        close = frame["close"]
        frame["ema_fast"] = close.ewm(span=int(self.params["trend_fast_window"]), adjust=False).mean()
        frame["ema_slow"] = close.ewm(span=int(self.params["trend_slow_window"]), adjust=False).mean()
        frame["atr"] = _true_range(frame).rolling(int(self.params["atr_window"]), min_periods=5).mean()
        frame["anchor"] = close.rolling(int(self.params["anchor_window"]), min_periods=20).median()
        frame["realized_vol_pct"] = close.pct_change().rolling(24, min_periods=8).std() * 100.0

        latest = frame.iloc[-1]
        previous = frame.iloc[-2]
        price = float(latest["close"])
        previous_price = float(previous["close"])
        atr = float(latest["atr"]) if not pd.isna(latest["atr"]) else 0.0
        anchor = float(latest["anchor"]) if not pd.isna(latest["anchor"]) else price
        ema_fast = float(latest["ema_fast"])
        ema_slow = float(latest["ema_slow"])
        realized_vol_pct = float(latest["realized_vol_pct"]) if not pd.isna(latest["realized_vol_pct"]) else 0.0

        if price <= 0 or anchor <= 0 or atr <= 0:
            return {"action": "HOLD", "symbol": symbol, "quantity": 0.0, "price": price, "reason": "invalid market inputs"}

        raw_step = (atr / price) * float(self.params["atr_grid_factor"])
        step = max(float(self.params["min_grid_step"]), min(float(self.params["max_grid_step"]), raw_step))
        grid_count = int(self.params["grid_count"])
        buy_levels, sell_levels = _grid_levels(anchor, step, grid_count)
        lower_guard = anchor * (1.0 - step * grid_count) * (1.0 - float(self.params["stop_loss_pct"]) / 100.0)
        upper_guard = anchor * (1.0 + step * grid_count) * (1.0 + float(self.params["take_profit_pct"]) / 100.0)

        meta = {
            "strategy_version": STRATEGY_VERSION,
            "anchor": anchor,
            "atr": atr,
            "grid_step": step,
            "ema_fast": ema_fast,
            "ema_slow": ema_slow,
            "realized_vol_pct": realized_vol_pct,
            "buy_levels": buy_levels,
            "sell_levels": sell_levels,
            "lower_guard": round(float(lower_guard), 8),
            "upper_guard": round(float(upper_guard), 8),
        }

        if realized_vol_pct > float(self.params["volatility_pause_pct"]):
            return {"action": "HOLD", "symbol": symbol, "quantity": 0.0, "price": price, "reason": "volatility pause", "meta": meta}
        if price < lower_guard or price > upper_guard:
            return {"action": "HOLD", "symbol": symbol, "quantity": 0.0, "price": price, "reason": "price outside grid guardrail", "meta": meta}

        buy_price, buy_index = _nearest_cross(price, previous_price, buy_levels, "BUY")
        sell_price, sell_index = _nearest_cross(price, previous_price, sell_levels, "SELL")
        inventory_notional = _position_notional(account or {}, symbol, price)
        max_inventory = float(self.params["max_inventory_notional"])
        base_notional = float(self.params["base_order_notional"])

        if buy_price > 0:
            if bool(self.params["trend_filter"]) and price < ema_slow and ema_fast < ema_slow:
                return {"action": "HOLD", "symbol": symbol, "quantity": 0.0, "price": price, "reason": "trend filter blocked buy grid", "meta": meta}
            if inventory_notional >= max_inventory:
                return {"action": "HOLD", "symbol": symbol, "quantity": 0.0, "price": price, "reason": "inventory limit reached", "meta": meta}
            notional = min(base_notional * (1.0 + buy_index * 0.08), max(0.0, max_inventory - inventory_notional))
            return {
                "action": "BUY",
                "symbol": symbol,
                "quantity": notional / max(buy_price, 1e-12),
                "price": buy_price,
                "reason": "professional grid v2 buy level crossed",
                "meta": meta,
            }

        if sell_price > 0:
            if bool(self.params["rebalance_inventory"]) and inventory_notional <= base_notional * 0.25:
                return {"action": "HOLD", "symbol": symbol, "quantity": 0.0, "price": price, "reason": "no inventory to rebalance on sell grid", "meta": meta}
            return {
                "action": "SELL",
                "symbol": symbol,
                "quantity": base_notional / max(sell_price, 1e-12),
                "price": sell_price,
                "reason": "professional grid v2 sell level crossed",
                "meta": meta,
            }

        return {"action": "HOLD", "symbol": symbol, "quantity": 0.0, "price": price, "reason": "price remains inside adaptive grid", "meta": meta}

    def generate_intent(self, context):
        market = context.get("market_event", {})
        history = context.get("history") or market.get("bars") or market.get("data")
        symbol = str(market.get("symbol") or self.params["symbol"] or "")
        if isinstance(history, pd.DataFrame) and not history.empty:
            return self.analyze_symbol(symbol, history, context.get("account") or {})
        price = float(market.get("close") or market.get("price") or 0.0)
        return {"action": "HOLD", "symbol": symbol, "quantity": 0.0, "price": price, "reason": "waiting for OHLCV history"}

    def generate(self, data_map):
        out = {}
        for code, df in data_map.items():
            frame = _clean_frame(df)
            close = frame["close"]
            atr = _true_range(frame).rolling(int(self.params["atr_window"]), min_periods=5).mean()
            anchor = close.rolling(int(self.params["anchor_window"]), min_periods=20).median()
            step = ((atr / close) * float(self.params["atr_grid_factor"])).clip(
                lower=float(self.params["min_grid_step"]),
                upper=float(self.params["max_grid_step"]),
            )
            vol_ok = close.pct_change().rolling(24, min_periods=8).std() * 100.0 <= float(self.params["volatility_pause_pct"])
            lower_band = anchor * (1.0 - step)
            upper_band = anchor * (1.0 + step)
            signal = pd.Series(0.0, index=frame.index)
            signal.loc[vol_ok & (close <= lower_band)] = 0.35
            signal.loc[vol_ok & (close >= upper_band)] = 0.05
            out[code] = signal.replace(0.0, pd.NA).ffill().fillna(0.0).clip(0.0, 0.35)
        return out


class QAStrategy(QAStrategyCtaBase):
    """Runtime entry point used by the restricted QUANTAXIS deployment service."""

    def __init__(self, parameters=None, **kwargs):
        self.parameters = _merge_params(parameters)
        self.parameters.update(kwargs.get("parameters") or {})
        self.engine = SignalEngine(self.parameters)

    def on_tick(self, context):
        params = _merge_params(self.parameters)
        params.update(context.get("parameters") or {})
        self.engine = SignalEngine(params)
        return self.engine.generate_intent(context)


Strategy = QAStrategy
