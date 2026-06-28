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
    TRIGGER = "TRIGGER"


class TimeInForce(str, Enum):
    GTC = "GTC"
    IOC = "IOC"
    FOK = "FOK"
    POST_ONLY = "POST_ONLY"


class TriggerCondition(str, Enum):
    GTE = "GTE"
    LTE = "LTE"


class OrderStatus(str, Enum):
    PENDING = "PENDING"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    CANCELED = "CANCELED"
    EXPIRED = "EXPIRED"
    REJECTED = "REJECTED"


MAKER_FEE_RATE = 0.0002
TAKER_FEE_RATE = 0.001
MARKET_SLIPPAGE_CAP = 0.003
DEFAULT_DEPTH_NOTIONAL = 250_000.0


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
        balance = 0.0 if abs(self.balance) < 1e-9 else self.balance
        frozen = 0.0 if abs(self.frozen) < 1e-9 else self.frozen
        return {
            "user_id": self.user_id,
            "account_type": self.account_type.value,
            "asset_name": self.asset_name,
            "balance": balance,
            "frozen": frozen,
            "equity": balance + frozen,
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
    time_in_force: TimeInForce = TimeInForce.GTC
    status: OrderStatus = OrderStatus.PENDING
    executed_price: float = 0.0
    filled_quantity: float = 0.0
    executed_value: float = 0.0
    reserved_asset: str = ""
    reserved_amount: float = 0.0
    fee_asset: str = ""
    fee_paid: float = 0.0
    trigger_price: float = 0.0
    trigger_condition: str = ""
    trigger_order_type: str = ""
    trigger_order_price: float = 0.0
    triggered_at: float = 0.0
    rejection_reason: str = ""
    timestamp: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @property
    def remaining_quantity(self) -> float:
        return max(_round_amount(self.quantity - self.filled_quantity), 0.0)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["account_type"] = self.account_type.value
        data["side"] = self.side.value
        data["type"] = self.type.value
        data["time_in_force"] = self.time_in_force.value
        data["status"] = self.status.value
        data["remaining_quantity"] = self.remaining_quantity
        data["average_price"] = self.executed_price
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


def _reservation(symbol: str, side: OrderSide, price: float, quantity: float) -> tuple[str, float]:
    base_asset, quote_asset = split_symbol(symbol)
    if side == OrderSide.BUY:
        return quote_asset, _round_amount(price * quantity * (1 + TAKER_FEE_RATE))
    return base_asset, _round_amount(quantity)


def _reservation_for_order(order: Order, price: float) -> tuple[str, float]:
    return _reservation(order.symbol, order.side, price, order.quantity)


def _fee(notional: float, *, taker: bool) -> float:
    return _round_amount(notional * (TAKER_FEE_RATE if taker else MAKER_FEE_RATE))


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
        *,
        fee_asset: str = "",
        fee_amount: float = 0.0,
    ) -> bool:
        if debit_amount <= 0 or credit_amount <= 0:
            raise ShadowTradingError("settlement amounts must be positive")
        deb_wallet = await self.get_or_create_wallet(user_id, account_type, debit_asset)
        cred_wallet = await self.get_or_create_wallet(user_id, account_type, credit_asset)
        fee_wallet = await self.get_or_create_wallet(user_id, account_type, fee_asset) if fee_asset and fee_amount > 0 else None

        wallets = sorted(
            {id(wallet): wallet for wallet in [deb_wallet, cred_wallet, fee_wallet] if wallet is not None}.values(),
            key=lambda wallet: (wallet.user_id, wallet.account_type.value, wallet.asset_name),
        )

        async def _apply(index: int = 0) -> bool:
            if index >= len(wallets):
                extra_fee_from_debit = fee_wallet is deb_wallet if fee_wallet is not None else False
                required_frozen = _round_amount(debit_amount + (fee_amount if extra_fee_from_debit else 0.0))
                if deb_wallet.frozen + 1e-9 < required_frozen:
                    return False
                if fee_wallet is not None and fee_wallet is not deb_wallet and fee_wallet.balance + 1e-9 < fee_amount:
                    return False
                deb_wallet.frozen = _round_amount(deb_wallet.frozen - debit_amount)
                cred_wallet.balance = _round_amount(cred_wallet.balance + credit_amount)
                if fee_wallet is not None:
                    if fee_wallet is deb_wallet:
                        fee_wallet.frozen = _round_amount(fee_wallet.frozen - fee_amount)
                    elif fee_wallet is cred_wallet:
                        fee_wallet.balance = _round_amount(fee_wallet.balance - fee_amount)
                    else:
                        fee_wallet.balance = _round_amount(fee_wallet.balance - fee_amount)
                return True
            async with wallets[index].lock:
                return await _apply(index + 1)

        return await _apply()

    async def reset_user(self, user_id: str, account_type: AccountType = AccountType.VIRTUAL) -> None:
        prefix = (str(user_id), account_type)
        async with self._global_lock:
            for key in [key for key in self._wallets if (key[0], key[1]) == prefix]:
                del self._wallets[key]


class VirtualMatchingEngine:
    """Last-traded-price virtual matching engine for shadow orders."""

    def __init__(
        self,
        wallet_manager: WalletManager,
        *,
        default_prices: dict[str, float] | None = None,
        default_depth_notional: float = DEFAULT_DEPTH_NOTIONAL,
        market_slippage_cap: float = MARKET_SLIPPAGE_CAP,
    ):
        self.wallet_manager = wallet_manager
        self.limit_order_pool: dict[str, list[Order]] = {}
        self.trigger_order_pool: dict[str, list[Order]] = {}
        self._pool_lock = asyncio.Lock()
        self.default_depth_notional = float(default_depth_notional)
        self.market_slippage_cap = float(market_slippage_cap)
        self._market_prices = {
            "BTC_USDT": 59_510.865,
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
            current_price = await self.get_market_price(order.symbol)
            await self._execute_taker(order, current_price)
        elif order.type == OrderType.LIMIT:
            current_price = await self.get_market_price(order.symbol)
            if order.time_in_force == TimeInForce.POST_ONLY and self._is_marketable_limit(order, current_price):
                order.status = OrderStatus.REJECTED
                order.rejection_reason = "post-only order would take liquidity"
                order.updated_at = time.time()
                await self._release_order_reservation(order)
                return order
            if self._is_marketable_limit(order, current_price):
                await self._execute_taker(order, self._execution_price(order, current_price))
            else:
                await self._register_limit_order(order)
        elif order.type == OrderType.TRIGGER:
            await self._register_trigger_order(order)
        else:
            raise ShadowTradingError("unsupported order type")
        return order

    @staticmethod
    def _is_marketable_limit(order: Order, market_price: float) -> bool:
        return (
            (order.side == OrderSide.BUY and order.price >= market_price)
            or (order.side == OrderSide.SELL and order.price <= market_price)
        )

    @staticmethod
    def _execution_price(order: Order, market_price: float) -> float:
        if order.side == OrderSide.BUY:
            return min(order.price, market_price)
        return max(order.price, market_price)

    async def _register_limit_order(self, order: Order) -> None:
        async with self._pool_lock:
            self.limit_order_pool.setdefault(order.symbol, []).append(order)
        order.updated_at = time.time()

    async def _register_trigger_order(self, order: Order) -> None:
        async with self._pool_lock:
            self.trigger_order_pool.setdefault(order.symbol, []).append(order)
        order.updated_at = time.time()

    async def cancel_limit_order(self, order: Order) -> bool:
        async with self._pool_lock:
            pool = self.trigger_order_pool if order.type == OrderType.TRIGGER else self.limit_order_pool
            orders = pool.get(order.symbol, [])
            remaining = [candidate for candidate in orders if candidate.order_id != order.order_id]
            if len(remaining) == len(orders):
                return False
            if remaining:
                pool[order.symbol] = remaining
            else:
                pool.pop(order.symbol, None)
            return True

    async def on_market_price_update(self, symbol: str, new_price: float, *, user_id: str | None = None) -> list[Order]:
        normalized = normalize_symbol(symbol)
        if new_price <= 0:
            raise ShadowTradingError("price must be positive")
        triggered_orders: list[Order] = []
        fired_trigger_orders: list[Order] = []
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

            active_triggers = list(self.trigger_order_pool.get(normalized, []))
            remaining_triggers: list[Order] = []
            for order in active_triggers:
                user_matches = user_id is None or order.user_id == str(user_id)
                condition = TriggerCondition(order.trigger_condition)
                fired = condition == TriggerCondition.GTE and new_price >= order.trigger_price
                fired = fired or (condition == TriggerCondition.LTE and new_price <= order.trigger_price)
                if user_matches and fired:
                    fired_trigger_orders.append(order)
                else:
                    remaining_triggers.append(order)
            if remaining_triggers:
                self.trigger_order_pool[normalized] = remaining_triggers
            else:
                self.trigger_order_pool.pop(normalized, None)

        for order in triggered_orders:
            await self._execute_maker(order, self._execution_price(order, new_price))
        for order in fired_trigger_orders:
            order.triggered_at = time.time()
            await self._activate_trigger_order(order, new_price)
        return [*triggered_orders, *fired_trigger_orders]

    async def _activate_trigger_order(self, order: Order, market_price: float) -> None:
        trigger_order_type = OrderType(order.trigger_order_type or OrderType.MARKET.value)
        execution_price = order.trigger_order_price if trigger_order_type == OrderType.LIMIT else market_price
        reservation_price = execution_price if trigger_order_type == OrderType.LIMIT else self._slipped_price(order, market_price)
        order.type = trigger_order_type
        order.price = reservation_price if trigger_order_type == OrderType.MARKET else execution_price
        order.time_in_force = TimeInForce.IOC if trigger_order_type == OrderType.MARKET else TimeInForce.GTC
        reserved_asset, reserved_amount = _reservation_for_order(order, reservation_price)
        order.reserved_asset = reserved_asset
        order.reserved_amount = reserved_amount
        frozen = await self.wallet_manager.freeze_funds(order.user_id, order.account_type, reserved_asset, reserved_amount)
        if not frozen:
            order.status = OrderStatus.REJECTED
            order.rejection_reason = f"insufficient available {reserved_asset}"
            order.updated_at = time.time()
            return
        await self.process_order(order)

    async def _execute_taker(self, order: Order, execution_price: float) -> bool:
        max_quantity = self._available_taker_quantity(order, execution_price)
        if order.time_in_force == TimeInForce.FOK and max_quantity + 1e-12 < order.remaining_quantity:
            order.status = OrderStatus.REJECTED
            order.rejection_reason = "not enough simulated liquidity for FOK"
            order.updated_at = time.time()
            await self._release_order_reservation(order)
            return False
        fill_quantity = min(order.remaining_quantity, max_quantity)
        if fill_quantity <= 0:
            order.status = OrderStatus.REJECTED if order.filled_quantity <= 0 else OrderStatus.EXPIRED
            order.rejection_reason = "not enough simulated liquidity"
            order.updated_at = time.time()
            await self._release_order_reservation(order)
            return False
        settled = await self._settle_fill(order, self._slipped_price(order, execution_price), fill_quantity, taker=True)
        if not settled:
            await self._release_order_reservation(order)
            return False
        if order.remaining_quantity <= 1e-12:
            order.status = OrderStatus.FILLED
            await self._release_order_reservation(order)
        elif order.time_in_force in {TimeInForce.IOC, TimeInForce.FOK} or order.type == OrderType.MARKET:
            order.status = OrderStatus.PARTIALLY_FILLED
            await self._release_order_reservation(order)
        else:
            order.status = OrderStatus.PARTIALLY_FILLED
            await self._register_limit_order(order)
        order.updated_at = time.time()
        return True

    async def _execute_maker(self, order: Order, execution_price: float) -> bool:
        settled = await self._settle_fill(order, execution_price, order.remaining_quantity, taker=False)
        if settled:
            order.status = OrderStatus.FILLED
            await self._release_order_reservation(order)
        return settled

    def _available_taker_quantity(self, order: Order, execution_price: float) -> float:
        if execution_price <= 0:
            return 0.0
        quantity = self.default_depth_notional / execution_price
        return _round_amount(max(quantity, 0.0))

    def _slipped_price(self, order: Order, execution_price: float) -> float:
        if execution_price <= 0:
            return execution_price
        fill_ratio = min(order.remaining_quantity / max(self._available_taker_quantity(order, execution_price), 1e-12), 1.0)
        slippage = self.market_slippage_cap * fill_ratio
        if order.side == OrderSide.BUY:
            price = execution_price * (1 + slippage)
            if order.type == OrderType.LIMIT and order.price > 0:
                price = min(price, order.price)
        else:
            price = execution_price * (1 - slippage)
            if order.type == OrderType.LIMIT and order.price > 0:
                price = max(price, order.price)
        return _round_amount(price)

    async def _settle_fill(self, order: Order, execution_price: float, quantity: float, *, taker: bool) -> bool:
        quantity = min(_round_amount(quantity), order.remaining_quantity)
        if quantity <= 0:
            return False
        base_asset, quote_asset = split_symbol(order.symbol)
        notional = _round_amount(quantity * execution_price)
        fee_amount = _fee(notional, taker=taker)
        if order.side == OrderSide.BUY:
            debit_asset = quote_asset
            debit_amount = notional
            credit_asset = base_asset
            credit_amount = quantity
            fee_asset = quote_asset
        else:
            debit_asset = base_asset
            debit_amount = quantity
            credit_asset = quote_asset
            credit_amount = notional
            fee_asset = quote_asset

        settled = await self.wallet_manager.execute_settlement(
            order.user_id,
            order.account_type,
            debit_asset,
            debit_amount,
            credit_asset,
            credit_amount,
            fee_asset=fee_asset,
            fee_amount=fee_amount,
        )
        if settled:
            order.filled_quantity = _round_amount(order.filled_quantity + quantity)
            order.executed_value = _round_amount(order.executed_value + notional)
            order.executed_price = _round_amount(order.executed_value / order.filled_quantity)
            order.fee_asset = fee_asset
            order.fee_paid = _round_amount(order.fee_paid + fee_amount)
        if not settled:
            order.rejection_reason = "reserved balance was insufficient at settlement"
            order.status = OrderStatus.REJECTED
        order.updated_at = time.time()
        return settled

    async def _release_order_reservation(self, order: Order) -> None:
        if order.reserved_amount <= 0 or not order.reserved_asset:
            return
        remaining_reservation = self._remaining_reservation(order)
        if remaining_reservation <= 0:
            return
        wallet = await self.wallet_manager.get_or_create_wallet(order.user_id, order.account_type, order.reserved_asset)
        release = min(wallet.frozen, remaining_reservation)
        if release > 1e-12:
            await self.wallet_manager.unfreeze_funds(order.user_id, order.account_type, order.reserved_asset, _round_amount(release))

    @staticmethod
    def _remaining_reservation(order: Order) -> float:
        if order.reserved_asset == split_symbol(order.symbol)[1]:
            spent = order.executed_value + (order.fee_paid if order.fee_asset == order.reserved_asset else 0.0)
            return max(_round_amount(order.reserved_amount - spent), 0.0)
        if order.reserved_asset == split_symbol(order.symbol)[0]:
            return max(_round_amount(order.reserved_amount - order.filled_quantity), 0.0)
        return order.reserved_amount


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
        time_in_force: TimeInForce = TimeInForce.GTC,
        trigger_price: float = 0.0,
        trigger_condition: TriggerCondition | None = None,
        trigger_order_type: OrderType = OrderType.MARKET,
        trigger_order_price: float = 0.0,
    ) -> Order:
        if account_type != AccountType.VIRTUAL:
            raise ShadowTradingError("REAL account routing must go through a live broker connector")
        symbol = normalize_symbol(symbol)
        quantity = float(quantity)
        price = float(price)
        trigger_price = float(trigger_price)
        trigger_order_price = float(trigger_order_price)
        if quantity <= 0:
            raise ShadowTradingError("quantity must be positive")
        if order_type == OrderType.LIMIT and price <= 0:
            raise ShadowTradingError("limit orders require a positive price")
        if order_type == OrderType.MARKET and time_in_force not in {TimeInForce.IOC, TimeInForce.FOK, TimeInForce.GTC}:
            raise ShadowTradingError("market orders support GTC, IOC, or FOK only")
        if order_type == OrderType.TRIGGER:
            if trigger_price <= 0:
                raise ShadowTradingError("trigger orders require a positive trigger price")
            if trigger_condition is None:
                raise ShadowTradingError("trigger orders require a trigger condition")
            if trigger_order_type not in {OrderType.MARKET, OrderType.LIMIT}:
                raise ShadowTradingError("trigger execution must be MARKET or LIMIT")
            if trigger_order_type == OrderType.LIMIT and trigger_order_price <= 0:
                raise ShadowTradingError("limit trigger execution requires a positive order price")

        reservation_price = price
        if order_type == OrderType.MARKET:
            market_price = await self.engine.get_market_price(symbol)
            reservation_price = market_price * (1 + MARKET_SLIPPAGE_CAP) if side == OrderSide.BUY else market_price
        elif order_type == OrderType.TRIGGER:
            reservation_price = 0.0
        reserved_asset, reserved_amount = ("", 0.0)
        if order_type != OrderType.TRIGGER:
            reserved_asset, reserved_amount = _reservation(symbol, side, reservation_price, quantity)
        frozen = True
        if reserved_amount > 0:
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
            time_in_force=time_in_force,
            reserved_asset=reserved_asset,
            reserved_amount=reserved_amount,
            trigger_price=trigger_price,
            trigger_condition=trigger_condition.value if trigger_condition else "",
            trigger_order_type=trigger_order_type.value if order_type == OrderType.TRIGGER else "",
            trigger_order_price=trigger_order_price,
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
        if order.status not in {OrderStatus.PENDING, OrderStatus.PARTIALLY_FILLED}:
            raise ShadowTradingError("only open orders can be canceled")
        removed = await self.engine.cancel_limit_order(order)
        if not removed:
            raise ShadowTradingError("open order was not found in the matching pool")
        await self.engine._release_order_reservation(order)
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
            for symbol, orders in list(self.engine.trigger_order_pool.items()):
                remaining = [order for order in orders if order.user_id != str(user_id)]
                if remaining:
                    self.engine.trigger_order_pool[symbol] = remaining
                else:
                    self.engine.trigger_order_pool.pop(symbol, None)

    async def _save_order(self, order: Order) -> None:
        async with self._order_lock:
            self._orders[order.order_id] = order



shadow_trading_service = ShadowTradingService()
