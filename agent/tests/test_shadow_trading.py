from __future__ import annotations

import asyncio
import pytest

from src.shadow_trading import (
    AccountType,
    DEFAULT_DEPTH_NOTIONAL,
    MAKER_FEE_RATE,
    MARKET_SLIPPAGE_CAP,
    OrderSide,
    OrderStatus,
    OrderType,
    ShadowTradingService,
    TAKER_FEE_RATE,
    TimeInForce,
    TriggerCondition,
    VirtualMatchingEngine,
    WalletManager,
)


def _expected_taker_price(market_price: float, quantity: float, depth: float = DEFAULT_DEPTH_NOTIONAL) -> float:
    available_quantity = round(depth / market_price, 12)
    fill_ratio = min(quantity / max(available_quantity, 1e-12), 1.0)
    return round(market_price * (1 + MARKET_SLIPPAGE_CAP * fill_ratio), 12)


def _expected_taker_quantity(market_price: float, depth: float) -> float:
    return round(depth / market_price, 12)

def _accounts(snapshot: dict) -> dict:
    return snapshot["accounts"]


def test_virtual_wallet_initializes_with_usdt_cash() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        snapshot = await service.account_snapshot("user-1")
        usdt = _accounts(snapshot)["USDT"]
        assert usdt["balance"] == 100_000.0
        assert usdt["frozen"] == 0.0
        assert snapshot["account_cookie"] == "shadow:user-1"
        assert snapshot["portfolio_cookie"] == "virtual"
        assert snapshot["cash"] == 100_000.0

    asyncio.run(scenario())


def test_market_buy_freezes_and_settles_at_latest_price() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        market_price = await service.engine.get_market_price("BTC_USDT")
        expected_price = _expected_taker_price(market_price, 0.5)
        expected_notional = expected_price * 0.5
        expected_fee = expected_notional * TAKER_FEE_RATE
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC-USDT",
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=0.5,
        )

        assert order.status == OrderStatus.FILLED
        assert order.executed_price == pytest.approx(expected_price)
        assert order.fee_asset == "USDT"
        assert order.fee_paid == pytest.approx(expected_fee)

        snapshot = await service.account_snapshot("user-1")
        accounts = _accounts(snapshot)
        assert accounts["USDT"]["balance"] == pytest.approx(100_000.0 - expected_notional - expected_fee)
        assert accounts["USDT"]["frozen"] == 0.0
        assert accounts["BTC"]["balance"] == 0.5
        assert snapshot["positions"]["BTC_USDT"]["volume_long"] == pytest.approx(0.5)
        assert snapshot["orders"][0]["status"] == "FILLED"
        assert snapshot["trades"][0]["order_id"] == snapshot["orders"][0]["order_id"]

    asyncio.run(scenario())


def test_marketable_limit_buy_fills_immediately_at_current_price() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        market_price = await service.engine.get_market_price("BTC_USDT")
        limit_price = market_price + 5_000.0
        expected_price = _expected_taker_price(market_price, 1.0)
        expected_notional = expected_price
        expected_fee = expected_notional * TAKER_FEE_RATE
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            price=limit_price,
            quantity=1.0,
        )

        assert order.status == OrderStatus.FILLED
        assert order.executed_price == pytest.approx(expected_price)

        snapshot = await service.account_snapshot("user-1")
        accounts = _accounts(snapshot)
        assert accounts["USDT"]["balance"] == pytest.approx(100_000.0 - expected_notional - expected_fee)
        assert accounts["USDT"]["frozen"] == 0.0
        assert accounts["BTC"]["balance"] == 1.0

    asyncio.run(scenario())


def test_limit_order_triggers_on_market_price_update() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        market_price = await service.engine.get_market_price("BTC_USDT")
        limit_price = market_price - 1_000.0
        update_price = limit_price - 100.0
        expected_fee = update_price * MAKER_FEE_RATE
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            price=limit_price,
            quantity=1.0,
        )

        assert order.status == OrderStatus.PENDING
        assert order.reserved_amount == pytest.approx(limit_price * (1 + TAKER_FEE_RATE))

        filled = await service.update_market_price("BTC/USDT", update_price)
        assert [item.order_id for item in filled] == [order.order_id]
        assert order.status == OrderStatus.FILLED
        assert order.executed_price == pytest.approx(update_price)
        assert order.fee_paid == pytest.approx(expected_fee)

        snapshot = await service.account_snapshot("user-1")
        accounts = _accounts(snapshot)
        assert accounts["USDT"]["balance"] == pytest.approx(100_000.0 - update_price - expected_fee)
        assert accounts["USDT"]["frozen"] == 0.0
        assert accounts["BTC"]["balance"] == 1.0

    asyncio.run(scenario())


def test_post_only_rejects_when_order_would_take_liquidity() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            time_in_force=TimeInForce.POST_ONLY,
            price=66_000.0,
            quantity=1.0,
        )

        assert order.status == OrderStatus.REJECTED
        assert order.rejection_reason == "post-only order would take liquidity"

        snapshot = await service.account_snapshot("user-1")
        usdt = _accounts(snapshot)["USDT"]
        assert usdt["balance"] == 100_000.0
        assert usdt["frozen"] == 0.0

    asyncio.run(scenario())


def test_ioc_partially_fills_and_expires_remainder() -> None:
    async def scenario() -> None:
        wallet_manager = WalletManager(initial_virtual_balance=1_000_000.0)
        depth = 130_000.0
        engine = VirtualMatchingEngine(wallet_manager, default_depth_notional=depth)
        service = ShadowTradingService(wallet_manager=wallet_manager, engine=engine)
        market_price = await service.engine.get_market_price("BTC_USDT")
        expected_quantity = _expected_taker_quantity(market_price, depth)
        expected_price = _expected_taker_price(market_price, 3.0, depth)
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            time_in_force=TimeInForce.IOC,
            quantity=3.0,
        )

        assert order.status == OrderStatus.PARTIALLY_FILLED
        assert order.filled_quantity == pytest.approx(expected_quantity)
        assert order.remaining_quantity == pytest.approx(3.0 - expected_quantity)
        assert order.executed_price == pytest.approx(expected_price)

        snapshot = await service.account_snapshot("user-1")
        accounts = _accounts(snapshot)
        assert accounts["BTC"]["balance"] == pytest.approx(expected_quantity)
        assert accounts["USDT"]["frozen"] == 0.0

    asyncio.run(scenario())


def test_fok_rejects_when_depth_cannot_fill_entire_order() -> None:
    async def scenario() -> None:
        wallet_manager = WalletManager(initial_virtual_balance=1_000_000.0)
        engine = VirtualMatchingEngine(wallet_manager, default_depth_notional=130_000.0)
        service = ShadowTradingService(wallet_manager=wallet_manager, engine=engine)
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            time_in_force=TimeInForce.FOK,
            quantity=3.0,
        )

        assert order.status == OrderStatus.REJECTED
        assert order.rejection_reason == "not enough simulated liquidity for FOK"

        snapshot = await service.account_snapshot("user-1")
        accounts = _accounts(snapshot)
        assert "BTC" not in accounts
        assert accounts["USDT"]["balance"] == 1_000_000.0
        assert accounts["USDT"]["frozen"] == 0.0

    asyncio.run(scenario())


def test_trigger_order_fires_on_market_price_update() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.TRIGGER,
            quantity=0.5,
            trigger_price=64_000.0,
            trigger_condition=TriggerCondition.LTE,
            trigger_order_type=OrderType.MARKET,
        )

        assert order.status == OrderStatus.PENDING
        assert order.reserved_amount == 0.0

        fired = await service.update_market_price("BTC_USDT", 63_900.0)

        assert [item.order_id for item in fired] == [order.order_id]
        assert order.status == OrderStatus.FILLED
        assert order.type == OrderType.MARKET
        assert order.triggered_at > 0
        assert order.filled_quantity == 0.5

    asyncio.run(scenario())


def test_cancel_limit_order_unfreezes_reserved_funds() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        order = await service.place_order(
            user_id="user-1",
            symbol="ETH_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            price=3_000.0,
            quantity=2.0,
        )
        canceled = await service.cancel_order("user-1", order.order_id)
        assert canceled.status == OrderStatus.CANCELED

        snapshot = await service.account_snapshot("user-1")
        usdt = _accounts(snapshot)["USDT"]
        assert usdt["balance"] == 100_000.0
        assert usdt["frozen"] == 0.0

    asyncio.run(scenario())


def test_concurrent_freeze_cannot_overdraw_wallet() -> None:
    async def scenario() -> None:
        wallet_manager = WalletManager()
        wallet = await wallet_manager.get_or_create_wallet("user-1", AccountType.VIRTUAL, "USDT")
        wallet.balance = 100.0

        attempts = await asyncio.gather(
            *[
                wallet_manager.freeze_funds("user-1", AccountType.VIRTUAL, "USDT", 15.0)
                for _ in range(20)
            ]
        )

        assert attempts.count(True) == 6
        assert attempts.count(False) == 14
        assert wallet.balance == 10.0
        assert wallet.frozen == 90.0

    asyncio.run(scenario())


def test_user_scoped_market_update_does_not_fill_other_users_orders() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        market_price = await service.engine.get_market_price("BTC_USDT")
        limit_price = market_price - 1_000.0
        update_price = limit_price - 100.0
        user_a = await service.place_order(
            user_id="user-a",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            price=limit_price,
            quantity=1.0,
        )
        user_b = await service.place_order(
            user_id="user-b",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            price=limit_price,
            quantity=1.0,
        )

        filled = await service.update_market_price("BTC_USDT", update_price, user_id="user-a")

        assert [order.order_id for order in filled] == [user_a.order_id]
        assert user_a.status == OrderStatus.FILLED
        assert user_b.status == OrderStatus.PENDING

    asyncio.run(scenario())
