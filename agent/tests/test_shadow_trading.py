from __future__ import annotations

import asyncio

from src.shadow_trading import AccountType, OrderSide, OrderStatus, OrderType, ShadowTradingService, WalletManager


def test_virtual_wallet_initializes_with_usdt_cash() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        snapshot = await service.account_snapshot("user-1")
        usdt = next(wallet for wallet in snapshot["wallets"] if wallet["asset_name"] == "USDT")
        assert usdt["balance"] == 100_000.0
        assert usdt["frozen"] == 0.0

    asyncio.run(scenario())


def test_market_buy_freezes_and_settles_at_latest_price() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC-USDT",
            side=OrderSide.BUY,
            order_type=OrderType.MARKET,
            quantity=0.5,
        )

        assert order.status == OrderStatus.FILLED
        assert order.executed_price == 65_000.0

        snapshot = await service.account_snapshot("user-1")
        wallets = {wallet["asset_name"]: wallet for wallet in snapshot["wallets"]}
        assert wallets["USDT"]["balance"] == 67_500.0
        assert wallets["USDT"]["frozen"] == 0.0
        assert wallets["BTC"]["balance"] == 0.5

    asyncio.run(scenario())


def test_limit_order_triggers_on_market_price_update() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            price=60_000.0,
            quantity=1.0,
        )

        assert order.status == OrderStatus.PENDING
        assert order.reserved_amount == 60_000.0

        filled = await service.update_market_price("BTC/USDT", 59_900.0)
        assert [item.order_id for item in filled] == [order.order_id]
        assert order.status == OrderStatus.FILLED
        assert order.executed_price == 60_000.0

        snapshot = await service.account_snapshot("user-1")
        wallets = {wallet["asset_name"]: wallet for wallet in snapshot["wallets"]}
        assert wallets["USDT"]["balance"] == 40_000.0
        assert wallets["USDT"]["frozen"] == 0.0
        assert wallets["BTC"]["balance"] == 1.0

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
        usdt = next(wallet for wallet in snapshot["wallets"] if wallet["asset_name"] == "USDT")
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
        user_a = await service.place_order(
            user_id="user-a",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            price=60_000.0,
            quantity=1.0,
        )
        user_b = await service.place_order(
            user_id="user-b",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            price=60_000.0,
            quantity=1.0,
        )

        filled = await service.update_market_price("BTC_USDT", 59_500.0, user_id="user-a")

        assert [order.order_id for order in filled] == [user_a.order_id]
        assert user_a.status == OrderStatus.FILLED
        assert user_b.status == OrderStatus.PENDING

    asyncio.run(scenario())
