from __future__ import annotations

import asyncio
import json

from src.shadow_market_feed import ShadowMarketFeed
from src.shadow_trading import OrderStatus, OrderType, OrderSide, ShadowTradingService


def test_trade_payload_is_normalized() -> None:
    event = ShadowMarketFeed._parse_trade(json.dumps({
        "arg": {"channel": "trades", "instId": "BTC-USDT-SWAP"},
        "data": [{"instId": "BTC-USDT-SWAP", "px": "60000.5"}],
    }))
    assert event == ("BTC/USDT", 60000.5)


def test_exchange_trade_drives_shadow_limit_matching() -> None:
    async def scenario() -> None:
        service = ShadowTradingService()
        feed = ShadowMarketFeed(service)
        order = await service.place_order(
            user_id="user-1",
            symbol="BTC_USDT",
            side=OrderSide.BUY,
            order_type=OrderType.LIMIT,
            price=58_000,
            quantity=0.1,
        )
        assert order.status == OrderStatus.PENDING

        filled = await feed.handle_trade("BTCUSDT", 57_900)

        assert [item.order_id for item in filled] == [order.order_id]
        assert order.status == OrderStatus.FILLED
        assert feed.last_prices["BTC_USDT"] == 57_900
        assert await service.engine.get_market_price("BTC_USDT") == 57_900

    asyncio.run(scenario())
