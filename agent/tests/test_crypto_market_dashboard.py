"""Tests for crypto dashboard market data and K-line API contracts."""

from __future__ import annotations

import asyncio

import pytest

import api_server
from src import crypto_market


def _binance_tickers(symbols):
    return {
        symbol: {
            "lastPrice": 1000.0 + index,
            "priceChangePercent": 1.5 - index * 0.1,
            "highPrice": 1020.0 + index,
            "lowPrice": 980.0 + index,
            "volume": 10000 + index,
            "quoteVolume": 10_000_000 + index,
        }
        for index, symbol in enumerate(symbols)
    }


def test_market_dashboard_does_not_return_fake_prices_when_live_data_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(crypto_market, "_binance_tickers", lambda symbols: (_ for _ in ()).throw(RuntimeError("network blocked")))

    payload = crypto_market.get_market_dashboard()

    assert payload["status"] == "error"
    assert payload["source"].startswith("unavailable")
    assert payload["rows"] == []
    assert payload["aggregate"]["market_cap"] == 0


def test_market_dashboard_uses_binance_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(crypto_market, "_binance_tickers", _binance_tickers)

    payload = crypto_market.get_market_dashboard()

    assert payload["source"] == "binance"
    assert payload["rows"][0]["price"] == 1000
    assert payload["rows"][0]["quote_volume_24h"] == 10000000


def test_klines_do_not_return_fake_bars_when_live_data_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(crypto_market, "_fetch_from_binance", lambda *args: (_ for _ in ()).throw(RuntimeError("network blocked")))
    monkeypatch.setattr(crypto_market, "_fetch_from_coinbase", lambda *args: (_ for _ in ()).throw(RuntimeError("network blocked")))

    payload = crypto_market.get_klines("BTC/USDT", "1h", 24)

    assert payload["status"] == "error"
    assert payload["symbol"] == "BTC/USDT"
    assert payload["timeframe"] == "1h"
    assert payload["source"].startswith("unavailable")
    assert payload["storage"]["redis"] == "disabled"
    assert payload["storage"]["timescale"] == "disabled"
    assert payload["bars"] == []


def test_crypto_api_returns_rows_and_hides_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(crypto_market, "_binance_tickers", _binance_tickers)

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
    monkeypatch.setattr(crypto_market, "_binance_tickers", _binance_tickers)

    payload = asyncio.run(api_server.get_crypto_markets(limit=20))

    assert len(payload["rows"]) == 13
    assert payload["rows"][-1]["symbol"] == "DOT/USDT"


def test_crypto_klines_api_normalizes_bars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def binance_bars(symbol: str, timeframe: str, limit: int):
        return [
            crypto_market.CryptoKlineBar(
                time=crypto_market._iso_from_ms(1_700_000_000_000 + i * 3_600_000),
                timestamp=1_700_000_000_000 + i * 3_600_000,
                symbol=symbol,
                open=100 + i,
                high=104 + i,
                low=98 + i,
                close=102 + i,
                volume=1000 + i,
            )
            for i in range(limit)
        ]

    monkeypatch.setattr(crypto_market, "_fetch_from_binance", binance_bars)

    payload = asyncio.run(api_server.get_crypto_klines(symbol="BTC-USDT", timeframe="1h", limit=20))

    body = api_server.CryptoKlinesResponse.model_validate(payload)
    assert body.symbol == "BTC/USDT"
    assert body.storage.model_dump() == {"redis": "disabled", "timescale": "disabled", "detail": ""}
    assert len(body.bars) == 20
    assert body.bars[0].time.endswith("Z")
    assert body.bars[0].open == 100


def test_binance_kline_stream_payload_is_normalized() -> None:
    payload = {
        "e": "kline",
        "E": 1_700_000_003_000,
        "s": "BTCUSDT",
        "k": {
            "t": 1_700_000_000_000,
            "s": "BTCUSDT",
            "i": "1h",
            "o": "67000.00",
            "h": "68100.50",
            "l": "66950.25",
            "c": "68050.75",
            "v": "123.45",
            "x": False,
        },
    }

    message = crypto_market.parse_binance_kline_stream_message(payload)

    assert message is not None
    assert message["type"] == "kline"
    assert message["symbol"] == "BTC/USDT"
    assert message["timeframe"] == "1h"
    assert message["is_final"] is False
    assert message["bar"] == {
        "time": "2023-11-14T22:13:20Z",
        "timestamp": 1_700_000_000_000,
        "symbol": "BTC/USDT",
        "open": 67000.0,
        "high": 68100.5,
        "low": 66950.25,
        "close": 68050.75,
        "volume": 123.45,
    }


def test_binance_kline_stream_url_uses_normalized_symbol_and_timeframe() -> None:
    assert crypto_market.binance_kline_ws_url("BTC-USDT", "60min").endswith("/btcusdt@kline_1h")
