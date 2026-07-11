"""Optional vn.py bridge helpers.

The bridge keeps vn.py as an optional execution backend. Vibe-Trading remains
the default data/research layer, while vn.py can run exported CTA strategies in
an environment where vn.py and the desired gateway/app packages are installed.
"""

from __future__ import annotations

import importlib.util
import re
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class VnpyAvailability:
    """Dependency probe result for the optional vn.py backend."""

    available: bool
    missing: list[str]
    present: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class VnpyBacktestPlan:
    """Normalized settings for a generated vn.py CTA backtest script."""

    vt_symbol: str
    interval_name: str
    interval_window: int
    start: str
    end: str
    rate: float
    slippage: float
    size: float
    pricetick: float
    capital: float
    setting: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_REQUIRED_VNPY_MODULES = [
    "vnpy",
    "vnpy.app.cta_strategy",
    "vnpy.app.cta_backtester",
    "vnpy.trader.constant",
]

_A_SHARE_EXCHANGE_MAP = {
    "SH": "SSE",
    "SSE": "SSE",
    "SZ": "SZSE",
    "SZSE": "SZSE",
    "BJ": "BSE",
    "BSE": "BSE",
}

_CHINA_FUTURES_EXCHANGES = {"CFFEX", "SHFE", "DCE", "CZCE", "INE", "GFEX"}


def check_vnpy_availability() -> VnpyAvailability:
    """Return whether the optional vn.py CTA backend is importable."""

    present: list[str] = []
    missing: list[str] = []
    for module in _REQUIRED_VNPY_MODULES:
        try:
            found = importlib.util.find_spec(module) is not None
        except (ImportError, ModuleNotFoundError, AttributeError, ValueError):
            found = False
        if found:
            present.append(module)
        else:
            missing.append(module)
    return VnpyAvailability(available=not missing, missing=missing, present=present)


def normalize_vt_symbol(symbol: str, *, source: str | None = None, exchange: str | None = None) -> str:
    """Convert a Vibe-Trading symbol into a vn.py ``vt_symbol``.

    Args:
        symbol: Input symbol from config, e.g. ``BTC-USDT`` or ``000001.SZ``.
        source: Optional data source hint such as ``okx`` or ``ccxt``.
        exchange: Optional explicit vn.py exchange suffix.

    Returns:
        vn.py-style ``SYMBOL.EXCHANGE`` string.
    """

    raw = symbol.strip()
    if not raw:
        raise ValueError("symbol must not be empty")

    if "." in raw:
        base, suffix = raw.rsplit(".", 1)
        normalized_suffix = _normalize_exchange_suffix(suffix)
        return f"{base.upper()}.{normalized_suffix}" if normalized_suffix else raw.upper()

    if "/" in raw or "-" in raw:
        sep = "/" if "/" in raw else "-"
        left, right = [part.strip().upper() for part in raw.split(sep, 1)]
        if not left or not right:
            raise ValueError(f"invalid crypto symbol: {symbol!r}")
        venue = (exchange or _crypto_exchange_from_source(source)).upper()
        return f"{left}/{right}.{venue}"

    if re.fullmatch(r"\d{6}", raw):
        suffix = "SSE" if raw.startswith(("5", "6", "9")) else "SZSE"
        return f"{raw}.{suffix}"

    if exchange:
        return f"{raw.upper()}.{_normalize_exchange_suffix(exchange) or exchange.upper()}"

    return raw.upper()


def interval_to_vnpy(interval: str) -> tuple[str, int]:
    """Map Vibe-Trading interval strings to vn.py interval enum names.

    Returns:
        Tuple of ``(Interval.<name>, window)``. ``window`` is >1 for source
        bars such as 5m/15m; generated scripts still use the closest vn.py base
        interval and expose the window in metadata for strategy aggregation.
    """

    value = interval.strip()
    mapping = {
        "1m": ("MINUTE", 1),
        "5m": ("MINUTE", 5),
        "15m": ("MINUTE", 15),
        "30m": ("MINUTE", 30),
        "1H": ("HOUR", 1),
        "4H": ("HOUR", 4),
        "1D": ("DAILY", 1),
    }
    if value not in mapping:
        raise ValueError(f"unsupported interval for vn.py: {interval!r}")
    return mapping[value]


def build_backtest_plan(config: dict[str, Any]) -> VnpyBacktestPlan:
    """Build normalized vn.py CTA backtest parameters from ``config.json``."""

    codes = config.get("codes") or []
    if not codes:
        raise ValueError("config.codes must contain at least one symbol")

    interval_name, interval_window = interval_to_vnpy(str(config.get("interval", "1D")))
    vt_symbol = normalize_vt_symbol(
        str(codes[0]),
        source=str(config.get("source", "")),
        exchange=config.get("vnpy_exchange"),
    )
    return VnpyBacktestPlan(
        vt_symbol=vt_symbol,
        interval_name=interval_name,
        interval_window=interval_window,
        start=_date_literal(config.get("start_date"), "start_date"),
        end=_date_literal(config.get("end_date"), "end_date"),
        rate=float(config.get("rate", config.get("commission_rate", 0.0003))),
        slippage=float(config.get("slippage", 0.0)),
        size=float(config.get("contract_size", config.get("size", 1))),
        pricetick=float(config.get("pricetick", config.get("price_tick", 0.01))),
        capital=float(config.get("initial_capital", config.get("capital", 1_000_000))),
        setting=dict(config.get("vnpy_setting") or config.get("parameters") or {}),
    )


def render_cta_backtest_script(
    *,
    plan: VnpyBacktestPlan,
    strategy_file: Path,
    strategy_class: str,
) -> str:
    """Render a standalone vn.py CTA backtest runner script."""

    module_name = strategy_file.stem
    start_dt = _datetime_expr(plan.start)
    end_dt = _datetime_expr(plan.end)
    setting_repr = repr(plan.setting)
    return f'''"""Run an exported Vibe-Trading strategy with vn.py CTA Backtester.

Generated by Vibe-Trading. Run this script in an environment with vn.py and
the desired vn.py data/gateway packages installed.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys

from vnpy.app.cta_backtester import BacktestingEngine
from vnpy.trader.constant import Interval

THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from {module_name} import {strategy_class}


def main() -> None:
    engine = BacktestingEngine()
    engine.set_parameters(
        vt_symbol={plan.vt_symbol!r},
        interval=Interval.{plan.interval_name},
        start={start_dt},
        end={end_dt},
        rate={plan.rate!r},
        slippage={plan.slippage!r},
        size={plan.size!r},
        pricetick={plan.pricetick!r},
        capital={plan.capital!r},
    )
    engine.add_strategy({strategy_class}, {setting_repr})
    engine.load_data()
    engine.run_backtesting()
    engine.calculate_result()
    engine.calculate_statistics()
    engine.show_chart()


if __name__ == "__main__":
    main()
'''


def _crypto_exchange_from_source(source: str | None) -> str:
    lowered = (source or "").strip().lower()
    if lowered == "okx":
        return "OKX"
    if lowered == "binance":
        return "BINANCE"
    return "BINANCE" if lowered == "ccxt" else "OKX"


def _normalize_exchange_suffix(suffix: str) -> str | None:
    upper = suffix.strip().upper()
    if upper in _A_SHARE_EXCHANGE_MAP:
        return _A_SHARE_EXCHANGE_MAP[upper]
    if upper in _CHINA_FUTURES_EXCHANGES:
        return upper
    if upper in {"OKX", "BINANCE", "BYBIT", "DERIBIT", "HUOBI", "GATEIO"}:
        return upper
    return upper or None


def _date_literal(value: Any, field: str) -> str:
    if not value:
        raise ValueError(f"config.{field} is required for vn.py backtesting")
    try:
        return datetime.fromisoformat(str(value)).date().isoformat()
    except ValueError as exc:
        raise ValueError(f"config.{field} must be ISO date-like, got {value!r}") from exc


def _datetime_expr(date_text: str) -> str:
    year, month, day = [int(part) for part in date_text.split("-")]
    return f"datetime({year}, {month}, {day})"

