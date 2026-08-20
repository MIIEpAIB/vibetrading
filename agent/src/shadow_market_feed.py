"""Single live market-event feed for the virtual trading ledger.

The feed owns the exchange connection. Consumers never inject prices into the
matching engine directly; every exchange trade is normalized here and routed
through the shadow service's market-event method.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Iterable
from typing import Any

from src.crypto_market import OKX_WS_URL, okx_instrument_id, parse_okx_trade_message
from src.shadow_trading import ShadowTradingService

logger = logging.getLogger(__name__)

DEFAULT_SYMBOLS = (
    "BTC/USDT",
    "ETH/USDT",
    "BNB/USDT",
    "SOL/USDT",
    "XRP/USDT",
    "DOGE/USDT",
    "ADA/USDT",
    "TRX/USDT",
    "AVAX/USDT",
    "SHIB/USDT",
    "LINK/USDT",
    "TON/USDT",
    "DOT/USDT",
)

class ShadowMarketFeed:
    """Routes one exchange trade stream into the shadow matching engine."""

    def __init__(
        self,
        service: ShadowTradingService,
        symbols: Iterable[str] = DEFAULT_SYMBOLS,
        *,
        reconnect_delay: float = 3.0,
    ) -> None:
        self.service = service
        self.symbols = tuple(symbols)
        self.reconnect_delay = reconnect_delay
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._last_prices: dict[str, float] = {}

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def last_prices(self) -> dict[str, float]:
        return dict(self._last_prices)

    def start(self) -> None:
        if self.running:
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run(), name="shadow-market-feed")

    async def stop(self) -> None:
        self._stop_event.set()
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def handle_trade(self, symbol: str, price: float) -> list[Any]:
        """Process one normalized exchange trade and return triggered orders."""
        normalized = symbol.replace("/", "_").replace("-", "_").upper()
        if "_" not in normalized and normalized.endswith("USDT"):
            normalized = f"{normalized[:-4]}_USDT"
        value = float(price)
        if value <= 0:
            return []
        self._last_prices[normalized] = value
        return await self.service.update_market_price(normalized, value)

    async def _run(self) -> None:
        try:
            import websockets
        except ImportError:
            logger.error("websockets is required for the shadow market feed")
            return

        while not self._stop_event.is_set():
            try:
                async with websockets.connect(OKX_WS_URL, ping_interval=20, ping_timeout=20, close_timeout=5) as socket:
                    await socket.send(json.dumps({
                        "op": "subscribe",
                        "args": [{"channel": "trades", "instId": okx_instrument_id(symbol)} for symbol in self.symbols],
                    }))
                    async for raw in socket:
                        if self._stop_event.is_set():
                            return
                        event = self._parse_trade(raw)
                        if event is None:
                            continue
                        try:
                            await self.handle_trade(*event)
                        except Exception:
                            logger.exception("shadow trade event failed for %s", event[0])
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("shadow market feed disconnected; reconnecting", exc_info=True)
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=self.reconnect_delay)
                except asyncio.TimeoutError:
                    pass

    @staticmethod
    def _parse_trade(raw: str | bytes) -> tuple[str, float] | None:
        try:
            payload = json.loads(raw)
            return parse_okx_trade_message(payload)
        except (TypeError, ValueError, KeyError, json.JSONDecodeError):
            return None
