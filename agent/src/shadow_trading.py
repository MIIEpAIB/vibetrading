"""In-memory virtual trading account with shadow-route matching.

The module implements the paper side of the "one core, two ledgers" design:
orders share one state machine, while virtual balances and fills are isolated
from live broker connectors. It intentionally keeps persistence out of scope so
the core logic remains deterministic and easy to exercise in tests.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class AccountType(str, Enum):
    REAL = "REAL"
    VIRTUAL = "VIRTUAL"


class OrderSide(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"


class OrderStatus(str, Enum):
    PENDING = "PENDING"
    FILLED = "FILLED"
    CANCELED = "CANCELED"
    REJECTED = "REJECTED"


@dataclass
class Wallet:
    user_id: str
    account_type: AccountType
    asset_name: str
    balance: float = 0.0
    frozen: float = 0.0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False, compare=False)

    @property
    def equity(self) -> float:
        return self.balance + self.frozen

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "account_type": self.account_type.value,
            "asset_name": self.asset_name,
            "balance": self.balance,
            "frozen": self.frozen,
            "equity": self.equity,
        }


@dataclass
class Order:
    order_id: str
    user_id: str
    account_type: AccountType
    symbol: str
    side: OrderSide
    type: OrderType
    price: float
    quantity: float
    status: OrderStatus = OrderStatus.PENDING
    executed_price: float = 0.0
    reserved_asset: str = ""
    reserved_amount: float = 0.0
    rejection_reason: str = ""
    timestamp: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["account_type"] = self.account_type.value
        data["side"] = self.side.value
        data["type"] = self.type.value
        data["status"] = self.status.value
        return data


class ShadowTradingError(ValueError):
    """Raised for invalid or rejected virtual trading operations."""


def normalize_symbol(symbol: str) -> str:
    """Normalize external symbol spellings to BASE_QUOTE."""
    clean = (symbol or "").strip().upper().replace("-", "_").replace("/", "_")
    parts = [part for part in clean.split("_") if part]
    if len(parts) != 2:
        raise ShadowTradingError("symbol must use BASE_QUOTE, BASE/QUOTE, or BASE-QUOTE format")
    base, quote = parts
    if base == quote:
        raise ShadowTradingError("base and quote assets must differ")
    return f"{base}_{quote}"


def split_symbol(symbol: str) -> tuple[str, str]:
    normalized = normalize_symbol(symbol)
    base, quote = normalized.split("_", 1)
    return base, quote


def _round_amount(value: float) -> float:
    return round(float(value), 12)


class WalletManager:
    """High-concurrency safe wallet manager for isolated virtual ledgers."""

    def __init__(self, *, initial_virtual_balance: float = 100_000.0):
        self._wallets: dict[tuple[str, AccountType, str], Wallet] = {}
        self._global_lock = asyncio.Lock()
        self.initial_virtual_balance = float(initial_virtual_balance)

    def _key(self, user_id: str, account_type: AccountType, asset_name: str) -> tuple[str, AccountType, str]:
        return (str(user_id), account_type, asset_name.strip().upper())

    async def get_or_create_wallet(self, user_id: str, account_type: AccountType, asset_name: str) -> Wallet:
        asset = asset_name.strip().upper()
        if not asset:
            raise ShadowTradingError("asset_name is required")
        key = self._key(user_id, account_type, asset)
        async with self._global_lock:
            wallet = self._wallets.get(key)
            if wallet is None:
                initial_balance = (
                    self.initial_virtual_balance
                    if account_type == AccountType.VIRTUAL and asset in {"USD", "USDT"}
                    else 0.0
                )
                wallet = Wallet(str(user_id), account_type, asset, balance=initial_balance)
                self._wallets[key] = wallet
            return wallet

    async def list_wallets(self, user_id: str, account_type: AccountType) -> list[Wallet]:
        prefix = (str(user_id), account_type)
        wallets = [
            wallet
            for (wallet_user_id, wallet_account_type, _asset), wallet in self._wallets.items()
            if (wallet_user_id, wallet_account_type) == prefix
        ]
        return sorted(wallets, key=lambda wallet: wallet.asset_name)

    async def freeze_funds(self, user_id: str, account_type: AccountType, asset_name: str, amount: float) -> bool:
        if amount <= 0:
            raise ShadowTradingError("amount must be positive")
        wallet = await self.get_or_create_wallet(user_id, account_type, asset_name)
        async with wallet.lock:
            if wallet.balance + 1e-12 >= amount:
                wallet.balance = _round_amount(wallet.balance - amount)
                wallet.frozen = _round_amount(wallet.frozen + amount)
                return True
            return False

    async def unfreeze_funds(self, user_id: str, account_type: AccountType, asset_name: str, amount: float) -> bool:
        if amount <= 0:
            raise ShadowTradingError("amount must be positive")
        wallet = await self.get_or_create_wallet(user_id, account_type, asset_name)
        async with wallet.lock:
            if wallet.frozen + 1e-12 >= amount:
                wallet.frozen = _round_amount(wallet.frozen - amount)
                wallet.balance = _round_amount(wallet.balance + amount)
                return True
            return False

    async def execute_settlement(
        self,
        user_id: str,
        account_type: AccountType,
        debit_asset: str,
        debit_amount: float,
        credit_asset: str,
        credit_amount: float,
    ) -> bool:
        if debit_amount <= 0 or credit_amount <= 0:
            raise ShadowTradingError("settlement amounts must be positive")
        deb_wallet = await self.get_or_create_wallet(user_id, account_type, debit_asset)
        cred_wallet = await self.get_or_create_wallet(user_id, account_type, credit_asset)

        wallets = [deb_wallet, cred_wallet]
        if deb_wallet is cred_wallet:
            async with deb_wallet.lock:
                if deb_wallet.frozen + 1e-12 < debit_amount:
                    return False
                deb_wallet.frozen = _round_amount(deb_wallet.frozen - debit_amount)
                deb_wallet.balance = _round_amount(deb_wallet.balance + credit_amount)
                return True

        first, second = sorted(wallets, key=lambda wallet: (wallet.user_id, wallet.account_type.value, wallet.asset_name))
        async with first.lock:
            async with second.lock:
                if deb_wallet.frozen + 1e-12 < debit_amount:
                    return False
                deb_wallet.frozen = _round_amount(deb_wallet.frozen - debit_amount)
                cred_wallet.balance = _round_amount(cred_wallet.balance + credit_amount)
                return True

    async def reset_user(self, user_id: str, account_type: AccountType = AccountType.VIRTUAL) -> None:
        prefix = (str(user_id), account_type)
        async with self._global_lock:
            for key in [key for key in self._wallets if (key[0], key[1]) == prefix]:
                del self._wallets[key]


class VirtualMatchingEngine:
    """Last-traded-price virtual matching engine for shadow orders."""

    def __init__(self, wallet_manager: WalletManager, *, default_prices: dict[str, float] | None = None):
        self.wallet_manager = wallet_manager
        self.limit_order_pool: dict[str, list[Order]] = {}
        self._pool_lock = asyncio.Lock()
        self._market_prices = {
            "BTC_USDT": 65_000.0,
            "ETH_USDT": 3_500.0,
            "BNB_USDT": 655.0,
            "SOL_USDT": 164.0,
            "XRP_USDT": 2.18,
            "DOGE_USDT": 0.193,
            "ADA_USDT": 0.62,
            "TRX_USDT": 0.286,
            "AVAX_USDT": 28.4,
            "LINK_USDT": 15.8,
            "TON_USDT": 3.15,
            "DOT_USDT": 4.72,
        }
        if default_prices:
            self._market_prices.update({normalize_symbol(symbol): float(price) for symbol, price in default_prices.items()})

    async def get_market_price(self, symbol: str) -> float:
        normalized = normalize_symbol(symbol)
        price = self._market_prices.get(normalized)
        if price is None or price <= 0:
            raise ShadowTradingError(f"no market price available for {normalized}")
        return price

    async def set_market_price(self, symbol: str, price: float, *, user_id: str | None = None) -> list[Order]:
        normalized = normalize_symbol(symbol)
        if price <= 0:
            raise ShadowTradingError("price must be positive")
        self._market_prices[normalized] = float(price)
        return await self.on_market_price_update(normalized, float(price), user_id=user_id)

    def market_prices(self) -> dict[str, float]:
        return dict(sorted(self._market_prices.items()))

    async def process_order(self, order: Order) -> Order:
        if order.account_type != AccountType.VIRTUAL:
            raise ShadowTradingError("virtual matching engine only handles VIRTUAL orders")
        if order.type == OrderType.MARKET:
            current_price = order.price if order.price > 0 else await self.get_market_price(order.symbol)
            await self._match_order(order, current_price)
        elif order.type == OrderType.LIMIT:
            await self._register_limit_order(order)
        else:
            raise ShadowTradingError("unsupported order type")
        return order

    async def _register_limit_order(self, order: Order) -> None:
        async with self._pool_lock:
            self.limit_order_pool.setdefault(order.symbol, []).append(order)
        order.updated_at = time.time()

    async def cancel_limit_order(self, order: Order) -> bool:
        async with self._pool_lock:
            orders = self.limit_order_pool.get(order.symbol, [])
            remaining = [candidate for candidate in orders if candidate.order_id != order.order_id]
            if len(remaining) == len(orders):
                return False
            if remaining:
                self.limit_order_pool[order.symbol] = remaining
            else:
                self.limit_order_pool.pop(order.symbol, None)
            return True

    async def on_market_price_update(self, symbol: str, new_price: float, *, user_id: str | None = None) -> list[Order]:
        normalized = normalize_symbol(symbol)
        if new_price <= 0:
            raise ShadowTradingError("price must be positive")
        triggered_orders: list[Order] = []
        async with self._pool_lock:
            active_orders = list(self.limit_order_pool.get(normalized, []))
            remaining_orders: list[Order] = []
            for order in active_orders:
                user_matches = user_id is None or order.user_id == str(user_id)
                price_crossed = (
                    (order.side == OrderSide.BUY and new_price <= order.price)
                    or (order.side == OrderSide.SELL and new_price >= order.price)
                )
                triggered = user_matches and price_crossed
                if triggered:
                    triggered_orders.append(order)
                else:
                    remaining_orders.append(order)
            if remaining_orders:
                self.limit_order_pool[normalized] = remaining_orders
            else:
                self.limit_order_pool.pop(normalized, None)

        for order in triggered_orders:
            await self._match_order(order, order.price)
        return triggered_orders

    async def _match_order(self, order: Order, execution_price: float) -> bool:
        base_asset, quote_asset = split_symbol(order.symbol)
        if order.side == OrderSide.BUY:
            debit_asset = quote_asset
            debit_amount = order.quantity * execution_price
            credit_asset = base_asset
            credit_amount = order.quantity
        else:
            debit_asset = base_asset
            debit_amount = order.quantity
            credit_asset = quote_asset
            credit_amount = order.quantity * execution_price

        settled = await self.wallet_manager.execute_settlement(
            order.user_id,
            order.account_type,
            debit_asset,
            debit_amount,
            credit_asset,
            credit_amount,
        )
        order.executed_price = execution_price if settled else 0.0
        order.status = OrderStatus.FILLED if settled else OrderStatus.REJECTED
        if not settled:
            order.rejection_reason = "reserved balance was insufficient at settlement"
        order.updated_at = time.time()
        return settled


class ShadowTradingService:
    """High-level order router for the virtual shadow account."""

    def __init__(self, wallet_manager: WalletManager | None = None, engine: VirtualMatchingEngine | None = None):
        self.wallet_manager = wallet_manager or WalletManager()
        self.engine = engine or VirtualMatchingEngine(self.wallet_manager)
        self._orders: dict[str, Order] = {}
        self._order_lock = asyncio.Lock()

    async def ensure_default_wallets(self, user_id: str) -> None:
        await self.wallet_manager.get_or_create_wallet(user_id, AccountType.VIRTUAL, "USDT")

    async def place_order(
        self,
        *,
        user_id: str,
        account_type: AccountType = AccountType.VIRTUAL,
        symbol: str,
        side: OrderSide,
        order_type: OrderType,
        quantity: float,
        price: float = 0.0,
    ) -> Order:
        if account_type != AccountType.VIRTUAL:
            raise ShadowTradingError("REAL account routing must go through a live broker connector")
        symbol = normalize_symbol(symbol)
        quantity = float(quantity)
        price = float(price)
        if quantity <= 0:
            raise ShadowTradingError("quantity must be positive")
        if order_type == OrderType.LIMIT and price <= 0:
            raise ShadowTradingError("limit orders require a positive price")

        reservation_price = price if order_type == OrderType.LIMIT else await self.engine.get_market_price(symbol)
        reserved_asset, reserved_amount = self._reservation(symbol, side, reservation_price, quantity)
        frozen = await self.wallet_manager.freeze_funds(user_id, account_type, reserved_asset, reserved_amount)
        order = Order(
            order_id=f"SHD-{uuid.uuid4().hex[:12].upper()}",
            user_id=str(user_id),
            account_type=account_type,
            symbol=symbol,
            side=side,
            type=order_type,
            price=price if order_type == OrderType.LIMIT else reservation_price,
            quantity=quantity,
            reserved_asset=reserved_asset,
            reserved_amount=reserved_amount,
        )
        if not frozen:
            order.status = OrderStatus.REJECTED
            order.rejection_reason = f"insufficient available {reserved_asset}"
            order.updated_at = time.time()
            await self._save_order(order)
            return order

        await self._save_order(order)
        await self.engine.process_order(order)
        return order

    async def cancel_order(self, user_id: str, order_id: str) -> Order:
        order = await self.get_order(user_id, order_id)
        if order.status != OrderStatus.PENDING:
            raise ShadowTradingError("only pending limit orders can be canceled")
        removed = await self.engine.cancel_limit_order(order)
        if not removed:
            raise ShadowTradingError("pending order was not found in the limit pool")
        released = await self.wallet_manager.unfreeze_funds(
            order.user_id,
            order.account_type,
            order.reserved_asset,
            order.reserved_amount,
        )
        if not released:
            raise ShadowTradingError("reserved funds could not be released")
        order.status = OrderStatus.CANCELED
        order.updated_at = time.time()
        return order

    async def update_market_price(self, symbol: str, price: float, *, user_id: str | None = None) -> list[Order]:
        filled = await self.engine.set_market_price(symbol, price, user_id=user_id)
        return filled

    async def account_snapshot(self, user_id: str) -> dict[str, Any]:
        await self.ensure_default_wallets(user_id)
        wallets = await self.wallet_manager.list_wallets(user_id, AccountType.VIRTUAL)
        orders = await self.list_orders(user_id)
        return {
            "user_id": str(user_id),
            "account_type": AccountType.VIRTUAL.value,
            "wallets": [wallet.to_dict() for wallet in wallets if wallet.balance or wallet.frozen or wallet.asset_name in {"USD", "USDT"}],
            "orders": [order.to_dict() for order in orders],
            "market_prices": self.engine.market_prices(),
        }

    async def list_orders(self, user_id: str) -> list[Order]:
        async with self._order_lock:
            orders = [order for order in self._orders.values() if order.user_id == str(user_id)]
        return sorted(orders, key=lambda order: order.timestamp, reverse=True)

    async def get_order(self, user_id: str, order_id: str) -> Order:
        async with self._order_lock:
            order = self._orders.get(order_id)
        if order is None or order.user_id != str(user_id):
            raise ShadowTradingError("order not found")
        return order

    async def reset_user(self, user_id: str) -> None:
        await self.wallet_manager.reset_user(user_id, AccountType.VIRTUAL)
        async with self._order_lock:
            for order_id in [order_id for order_id, order in self._orders.items() if order.user_id == str(user_id)]:
                del self._orders[order_id]
        async with self.engine._pool_lock:
            for symbol, orders in list(self.engine.limit_order_pool.items()):
                remaining = [order for order in orders if order.user_id != str(user_id)]
                if remaining:
                    self.engine.limit_order_pool[symbol] = remaining
                else:
                    self.engine.limit_order_pool.pop(symbol, None)

    async def _save_order(self, order: Order) -> None:
        async with self._order_lock:
            self._orders[order.order_id] = order

    @staticmethod
    def _reservation(symbol: str, side: OrderSide, price: float, quantity: float) -> tuple[str, float]:
        base_asset, quote_asset = split_symbol(symbol)
        if side == OrderSide.BUY:
            return quote_asset, _round_amount(price * quantity)
        return base_asset, _round_amount(quantity)


shadow_trading_service = ShadowTradingService()
