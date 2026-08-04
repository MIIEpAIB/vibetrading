"""Tests for crypto dashboard market data and K-line API contracts."""

from __future__ import annotations

import asyncio

import pytest

import api_server
from src import crypto_market


class _FailingExchange:
    def fetch_tickers(self, symbols):
        raise RuntimeError("network blocked")

    def fetch_ohlcv(self, symbol, timeframe="1h", limit=180):
        raise RuntimeError("network blocked")


class _WorkingExchange:
    def fetch_tickers(self, symbols):
        return {
            symbol: {
                "last": 1000.0 + index,
                "percentage": 1.5 - index * 0.1,
                "high": 1020.0 + index,
                "low": 980.0 + index,
                "baseVolume": 10000 + index,
                "quoteVolume": 10_000_000 + index,
            }
            for index, symbol in enumerate(symbols)
        }

    def fetch_ohlcv(self, symbol, timeframe="1h", limit=180):
        return [
            [1_700_000_000_000 + i * 3_600_000, 100 + i, 104 + i, 98 + i, 102 + i, 1000 + i]
            for i in range(limit)
        ]


def test_market_dashboard_fallback_returns_top_13(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(crypto_market, "_exchange", lambda: _FailingExchange())
    monkeypatch.setattr(
        crypto_market,
        "_coingecko_market_rows",
        lambda symbols: (_ for _ in ()).throw(RuntimeError("network blocked")),
    )

    payload = crypto_market.get_market_dashboard()

    assert payload["status"] == "ok"
    assert payload["source"].startswith("fallback")
    assert len(payload["rows"]) == 13
    assert payload["rows"][0]["symbol"] == "BTC/USDT"
    assert payload["rows"][1]["symbol"] == "ETH/USDT"
    assert payload["aggregate"]["market_cap"] > 0


def test_market_dashboard_uses_coingecko_before_static_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(crypto_market, "_exchange", lambda: _FailingExchange())

    def coingecko_rows(symbols):
        return [
            crypto_market._market_row(
                rank=index,
                symbol=symbol,
                price=42_000 + index,
                change_24h=0.5,
                high_24h=43_000 + index,
                low_24h=41_000 + index,
                volume_24h=1_000 + index,
                quote_volume_24h=42_000_000 + index,
                market_cap=840_000_000 + index,
            )
            for index, symbol in enumerate(symbols, start=1)
        ]

    monkeypatch.setattr(crypto_market, "_coingecko_market_rows", coingecko_rows)

    payload = crypto_market.get_market_dashboard()

    assert payload["source"].startswith("coingecko")
    assert payload["rows"][0]["price"] == 42001
    assert payload["rows"][0]["market_cap"] == 840000001


def test_klines_fallback_degrades_storage_without_failing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(crypto_market, "_exchange", lambda: _FailingExchange())
    monkeypatch.setattr(crypto_market, "_read_redis", lambda key: (None, "disabled"))
    monkeypatch.setattr(crypto_market, "_write_redis", lambda *args: "disabled")
    monkeypatch.setattr(crypto_market, "_write_timescale", lambda *args: "degraded: unavailable")

    payload = crypto_market.get_klines("BTC/USDT", "1h", 24)

    assert payload["status"] == "ok"
    assert payload["symbol"] == "BTC/USDT"
    assert payload["timeframe"] == "1h"
    assert payload["source"].startswith("fallback")
    assert payload["storage"]["redis"] == "disabled"
    assert payload["storage"]["timescale"] == "degraded: unavailable"
    assert len(payload["bars"]) == 24
    first = payload["bars"][0]
    assert {"time", "timestamp", "symbol", "open", "high", "low", "close", "volume"} <= set(first)

    for previous, current in zip(payload["bars"], payload["bars"][1:]):
        assert current["open"] == previous["close"]
    for bar in payload["bars"]:
        assert bar["high"] >= max(bar["open"], bar["close"])
        assert bar["low"] <= min(bar["open"], bar["close"])
        assert bar["volume"] > 0


def test_klines_fallback_last_price_is_consistent_across_timeframes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(crypto_market, "_exchange", lambda: _FailingExchange())
    monkeypatch.setattr(crypto_market, "_read_redis", lambda key: (None, "disabled"))
    monkeypatch.setattr(crypto_market, "_write_redis", lambda *args: "disabled")
    monkeypatch.setattr(crypto_market, "_write_timescale", lambda *args: "disabled")
    monkeypatch.setattr(crypto_market.time, "time", lambda: 1_800_000_000.0)

    closes = [
        crypto_market.get_klines("BTC/USDT", timeframe, 24)["bars"][-1]["close"]
        for timeframe in ("15m", "1h", "4h", "1d")
    ]

    assert len(set(closes)) == 1


def test_crypto_kline_redis_key_is_versioned(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CRYPTO_KLINE_CACHE_VERSION", raising=False)
    assert crypto_market._redis_key("BTC/USDT", "1h", 180) == "crypto:klines:v3:BTCUSDT:1h:180"

    monkeypatch.setenv("CRYPTO_KLINE_CACHE_VERSION", "v4")
    assert crypto_market._redis_key("ETH/USDT", "4h", 20) == "crypto:klines:v4:ETHUSDT:4h:20"


def test_crypto_api_returns_rows_and_hides_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(crypto_market, "_exchange", lambda: _WorkingExchange())

    payload = asyncio.run(api_server.get_crypto_markets(limit=13))

    body = api_server.CryptoMarketsResponse.model_validate(payload).model_dump_json()
    assert len(payload["rows"]) == 13
    assert payload["rows"][0]["symbol"] == "BTC/USDT"
    assert "KB3NAxWNxnr34dkr" not in body
    assert "CRYPTO_TIMESCALE_PASSWORD" not in body
    assert "CRYPTO_REDIS_PASSWORD" not in body


def test_crypto_api_accepts_oversized_limit_and_clamps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(crypto_market, "_exchange", lambda: _WorkingExchange())

    payload = asyncio.run(api_server.get_crypto_markets(limit=20))

    assert len(payload["rows"]) == 13
    assert payload["rows"][-1]["symbol"] == "DOT/USDT"


def test_crypto_klines_api_normalizes_bars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(crypto_market, "_exchange", lambda: _WorkingExchange())
    monkeypatch.setattr(crypto_market, "_read_redis", lambda key: (None, "miss"))
    monkeypatch.setattr(crypto_market, "_write_redis", lambda *args: "stored")
    monkeypatch.setattr(crypto_market, "_write_timescale", lambda *args: "stored")

    payload = asyncio.run(api_server.get_crypto_klines(symbol="BTC-USDT", timeframe="1h", limit=20))

    body = api_server.CryptoKlinesResponse.model_validate(payload)
    assert body.symbol == "BTC/USDT"
    assert body.storage.model_dump() == {"redis": "stored", "timescale": "stored", "detail": ""}
    assert len(body.bars) == 20
    assert body.bars[0].time.endswith("Z")
    assert body.bars[0].open == 100
