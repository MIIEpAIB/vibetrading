"""Internal QIFI-style account implementation."""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any

from src.qifi.models import QIFIAccountSnapshot, QIFIOrder, QIFITrade, qifi_now


class QIFIAccount:
    """Small QIFI-compatible account used across backtest and paper execution."""

    def __init__(
        self,
        *,
        account_cookie: str,
        portfolio_cookie: str = "default",
        account_type: str = "BACKTEST",
        init_cash: float = 1_000_000.0,
    ) -> None:
        self.account_cookie = account_cookie
        self.portfolio_cookie = portfolio_cookie
        self.account_type = account_type
        self.cash = float(init_cash)
        self.frozen = 0.0
        self.positions: dict[str, dict[str, Any]] = {}
        self.orders: list[QIFIOrder] = []
        self.trades: list[QIFITrade] = []
        self.accounts: dict[str, dict[str, Any]] = {}
        self._market_prices: dict[str, float] = {}

    @classmethod
    def from_shadow_snapshot(
        cls,
        snapshot: dict[str, Any],
        *,
        account_cookie: str,
        portfolio_cookie: str = "paper",
    ) -> "QIFIAccount":
        account = cls(
            account_cookie=account_cookie,
            portfolio_cookie=portfolio_cookie,
            account_type=str(snapshot.get("account_type") or "PAPER"),
            init_cash=0.0,
        )
        prices = snapshot.get("market_prices") or {}
        wallets = snapshot.get("wallets") or []
        account.accounts = {}
        quote_cash = 0.0
        for wallet in wallets:
            asset = str(wallet.get("asset_name") or "").upper()
            balance = float(wallet.get("balance") or 0.0)
            frozen = float(wallet.get("frozen") or 0.0)
            account.accounts[asset] = {
                "account_cookie": account_cookie,
                "asset": asset,
                "balance": balance,
                "frozen": frozen,
                "available": balance,
                "equity": balance + frozen,
            }
            if asset in {"USDT", "USD", "CNY", "CNH"}:
                quote_cash += balance
                account.frozen += frozen
                continue
            for symbol, price in prices.items():
                if str(symbol).upper().startswith(f"{asset}_") and float(price or 0.0) > 0:
                    account.positions[str(symbol).upper()] = {
                        "symbol": str(symbol).upper(),
                        "volume_long": balance + frozen,
                        "volume_short": 0.0,
                        "avg_price": float(price),
                        "market_price": float(price),
                        "market_value": (balance + frozen) * float(price),
                    }
                    break
        account.cash = quote_cash
        account.orders = []
        account.trades = []
        for raw_order in snapshot.get("orders") or []:
            order_id = str(raw_order.get("order_id") or "")
            if not order_id:
                continue
            order = QIFIOrder(
                order_id=order_id,
                account_cookie=account_cookie,
                symbol=str(raw_order.get("symbol") or "").upper(),
                side=str(raw_order.get("side") or "").upper(),
                price=float(raw_order.get("price") or raw_order.get("executed_price") or 0.0),
                quantity=float(raw_order.get("quantity") or 0.0),
                order_type=str(raw_order.get("type") or raw_order.get("order_type") or "MARKET").upper(),
                status=str(raw_order.get("status") or "NEW").upper(),
                datetime=_timestamp_to_iso(raw_order.get("timestamp")),
                filled_quantity=float(raw_order.get("filled_quantity") or 0.0),
                avg_price=float(raw_order.get("average_price") or raw_order.get("executed_price") or 0.0),
                commission=float(raw_order.get("fee_paid") or raw_order.get("commission") or 0.0),
                metadata={"source_order_id": order_id},
            )
            account.orders.append(order)
            if order.status == "FILLED" and order.filled_quantity > 0:
                account.trades.append(
                    QIFITrade(
                        trade_id=f"{order_id}:trade",
                        order_id=order_id,
                        account_cookie=account_cookie,
                        symbol=order.symbol,
                        side=order.side,
                        price=order.avg_price or order.price,
                        quantity=order.filled_quantity,
                        datetime=order.datetime,
                        commission=order.commission,
                        metadata={"source_order_id": order_id},
                    )
                )
        account._market_prices = {str(symbol): float(price) for symbol, price in prices.items()}
        return account

    @classmethod
    def from_snapshot(
        cls,
        snapshot: dict[str, Any],
        *,
        account_cookie: str | None = None,
        portfolio_cookie: str | None = None,
    ) -> "QIFIAccount":
        """Rehydrate an account from a canonical QIFI snapshot."""
        account = cls(
            account_cookie=str(account_cookie or snapshot.get("account_cookie") or "default"),
            portfolio_cookie=str(portfolio_cookie or snapshot.get("portfolio_cookie") or "default"),
            account_type=str(snapshot.get("account_type") or "PAPER"),
            init_cash=float(snapshot.get("cash") or 0.0),
        )
        account.frozen = float(snapshot.get("frozen") or 0.0)
        account.accounts = {
            str(asset): dict(value)
            for asset, value in (snapshot.get("accounts") or {}).items()
            if isinstance(value, dict)
        }
        account.positions = {
            str(symbol): dict(value)
            for symbol, value in (snapshot.get("positions") or {}).items()
            if isinstance(value, dict)
        }
        account.orders = []
        for raw in snapshot.get("orders") or []:
            if not isinstance(raw, dict):
                continue
            data = {
                key: value
                for key, value in raw.items()
                if key in {
                    "order_id", "account_cookie", "symbol", "side", "price", "quantity",
                    "order_type", "status", "datetime", "filled_quantity", "avg_price",
                    "commission", "metadata",
                }
            }
            data["account_cookie"] = account.account_cookie
            account.orders.append(QIFIOrder(**data))
        account.trades = []
        for raw in snapshot.get("trades") or []:
            if not isinstance(raw, dict):
                continue
            data = {
                key: value
                for key, value in raw.items()
                if key in {
                    "trade_id", "order_id", "account_cookie", "symbol", "side", "price",
                    "quantity", "datetime", "commission", "pnl", "metadata",
                }
            }
            data["account_cookie"] = account.account_cookie
            account.trades.append(QIFITrade(**data))
        account._market_prices = {
            str(symbol): float(price)
            for symbol, price in (snapshot.get("market_prices") or {}).items()
        }
        return account

    def insert_order(
        self,
        *,
        symbol: str,
        side: str,
        price: float,
        quantity: float,
        order_type: str = "MARKET",
        status: str = "NEW",
        metadata: dict[str, Any] | None = None,
    ) -> QIFIOrder:
        order = QIFIOrder(
            order_id=f"qifi_order_{uuid.uuid4().hex[:12]}",
            account_cookie=self.account_cookie,
            symbol=str(symbol).upper(),
            side=str(side).upper(),
            price=float(price),
            quantity=float(quantity),
            order_type=str(order_type).upper(),
            status=str(status).upper(),
            metadata=metadata or {},
        )
        self.orders.append(order)
        return order

    def fill_order(
        self,
        order: QIFIOrder,
        *,
        fill_price: float | None = None,
        fill_quantity: float | None = None,
        commission: float = 0.0,
        pnl: float = 0.0,
        metadata: dict[str, Any] | None = None,
    ) -> QIFITrade:
        price = float(fill_price if fill_price is not None else order.price)
        quantity = float(fill_quantity if fill_quantity is not None else order.quantity)
        signed_cash = price * quantity
        if order.side in {"BUY", "BUY_TO_OPEN"}:
            self.cash -= signed_cash + float(commission)
            pos = self.positions.setdefault(order.symbol, {
                "symbol": order.symbol,
                "volume_long": 0.0,
                "volume_short": 0.0,
                "avg_price": price,
                "market_price": price,
                "market_value": 0.0,
            })
            old_qty = float(pos.get("volume_long") or 0.0)
            new_qty = old_qty + quantity
            pos["avg_price"] = ((old_qty * float(pos.get("avg_price") or price)) + signed_cash) / new_qty if new_qty else price
            pos["volume_long"] = new_qty
        elif order.side in {"SELL_SHORT", "SELL_TO_OPEN"}:
            self.cash += signed_cash - float(commission)
            pos = self.positions.setdefault(order.symbol, {
                "symbol": order.symbol,
                "volume_long": 0.0,
                "volume_short": 0.0,
                "avg_price": price,
                "market_price": price,
                "market_value": 0.0,
            })
            old_qty = float(pos.get("volume_short") or 0.0)
            new_qty = old_qty + quantity
            pos["avg_price"] = ((old_qty * float(pos.get("avg_price") or price)) + signed_cash) / new_qty if new_qty else price
            pos["volume_short"] = new_qty
        elif order.side in {"BUY_TO_CLOSE", "COVER"}:
            self.cash -= signed_cash + float(commission)
            pos = self.positions.setdefault(order.symbol, {
                "symbol": order.symbol,
                "volume_long": 0.0,
                "volume_short": 0.0,
                "avg_price": price,
                "market_price": price,
                "market_value": 0.0,
            })
            pos["volume_short"] = max(0.0, float(pos.get("volume_short") or 0.0) - quantity)
        else:
            self.cash += signed_cash - float(commission)
            pos = self.positions.setdefault(order.symbol, {
                "symbol": order.symbol,
                "volume_long": 0.0,
                "volume_short": 0.0,
                "avg_price": price,
                "market_price": price,
                "market_value": 0.0,
            })
            pos["volume_long"] = max(0.0, float(pos.get("volume_long") or 0.0) - quantity)
        self.mark_price(order.symbol, price)

        filled = replace(order, status="FILLED", filled_quantity=quantity, avg_price=price, commission=float(commission))
        self.orders[-1] = filled
        trade = QIFITrade(
            trade_id=f"qifi_trade_{uuid.uuid4().hex[:12]}",
            order_id=order.order_id,
            account_cookie=self.account_cookie,
            symbol=order.symbol,
            side=order.side,
            price=price,
            quantity=quantity,
            commission=float(commission),
            pnl=float(pnl),
            metadata=metadata or {},
        )
        self.trades.append(trade)
        return trade

    def reject_order(self, order: QIFIOrder, reason: str) -> QIFIOrder:
        rejected = replace(order, status="REJECTED", metadata={**order.metadata, "rejection_reason": reason})
        self.orders[-1] = rejected
        return rejected

    def mark_price(self, symbol: str, price: float) -> None:
        pos = self.positions.get(str(symbol).upper())
        if not pos:
            return
        pos["market_price"] = float(price)
        net_qty = float(pos.get("volume_long") or 0.0) - float(pos.get("volume_short") or 0.0)
        pos["market_value"] = net_qty * float(price)

    def total_market_value(self) -> float:
        return sum(float(pos.get("market_value") or 0.0) for pos in self.positions.values())

    def total_asset(self) -> float:
        return self.cash + self.frozen + self.total_market_value()

    def snapshot(self) -> QIFIAccountSnapshot:
        return QIFIAccountSnapshot(
            account_cookie=self.account_cookie,
            portfolio_cookie=self.portfolio_cookie,
            account_type=self.account_type,
            cash=self.cash,
            frozen=self.frozen,
            market_value=self.total_market_value(),
            total_asset=self.total_asset(),
            positions={symbol: dict(pos) for symbol, pos in self.positions.items()},
            orders=[order.to_dict() for order in self.orders],
            trades=[trade.to_dict() for trade in self.trades],
            accounts={asset: dict(account) for asset, account in self.accounts.items()},
            market_prices=dict(self._market_prices),
            updated_at=qifi_now(),
        )


def _timestamp_to_iso(value: Any) -> str:
    """Normalize legacy epoch timestamps into the QIFI datetime field."""
    if value in (None, ""):
        return qifi_now()
    try:
        return datetime.fromtimestamp(float(value), timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        return str(value)
