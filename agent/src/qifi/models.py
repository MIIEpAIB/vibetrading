"""QIFI-compatible account, order, and trade contracts.

The project keeps these contracts internal so deployments do not require an
external QUANTAXIS/QIFI installation. Field names intentionally mirror the
QIFI account shape: account_cookie, cash, frozen, positions, orders, trades.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def qifi_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class QIFIOrder:
    order_id: str
    account_cookie: str
    symbol: str
    side: str
    price: float
    quantity: float
    order_type: str = "MARKET"
    status: str = "NEW"
    datetime: str = field(default_factory=qifi_now)
    filled_quantity: float = 0.0
    avg_price: float = 0.0
    commission: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class QIFITrade:
    trade_id: str
    order_id: str
    account_cookie: str
    symbol: str
    side: str
    price: float
    quantity: float
    datetime: str = field(default_factory=qifi_now)
    commission: float = 0.0
    pnl: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class QIFIAccountSnapshot:
    account_cookie: str
    portfolio_cookie: str
    account_type: str
    cash: float
    frozen: float
    market_value: float
    total_asset: float
    positions: dict[str, dict[str, Any]]
    orders: list[dict[str, Any]]
    trades: list[dict[str, Any]]
    accounts: dict[str, dict[str, Any]] = field(default_factory=dict)
    market_prices: dict[str, float] = field(default_factory=dict)
    updated_at: str = field(default_factory=qifi_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
