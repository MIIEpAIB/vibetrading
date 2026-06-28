"""Crypto market dashboard data service.

The UI needs fast dashboard rows and K-line bars, but Redis/TimescaleDB are
operator-provided services. This module treats persistence as an optimization:
exchange/fallback data still works when storage is unavailable.
"""

from __future__ import annotations

import json
import hashlib
import math
import os
import random
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

TOP_SYMBOLS: tuple[str, ...] = (
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

_SYMBOL_NAMES: Mapping[str, str] = {
    "BTC/USDT": "Bitcoin",
    "ETH/USDT": "Ethereum",
    "BNB/USDT": "BNB",
    "SOL/USDT": "Solana",
    "XRP/USDT": "XRP",
    "DOGE/USDT": "Dogecoin",
    "ADA/USDT": "Cardano",
    "TRX/USDT": "TRON",
    "AVAX/USDT": "Avalanche",
    "SHIB/USDT": "Shiba Inu",
    "LINK/USDT": "Chainlink",
    "TON/USDT": "Toncoin",
    "DOT/USDT": "Polkadot",
}

_SYMBOL_ICON_COLORS: Mapping[str, tuple[str, str]] = {
    "BTC": ("#f7931a", "#111827"),
    "ETH": ("#627eea", "#ffffff"),
    "BNB": ("#f3ba2f", "#111827"),
    "SOL": ("#14f195", "#111827"),
    "XRP": ("#d1d5db", "#111827"),
    "DOGE": ("#c2a633", "#111827"),
    "ADA": ("#3468d1", "#ffffff"),
    "TRX": ("#ef0027", "#ffffff"),
    "AVAX": ("#e84142", "#ffffff"),
    "SHIB": ("#f00500", "#ffffff"),
    "LINK": ("#2a5ada", "#ffffff"),
    "TON": ("#0098ea", "#ffffff"),
    "DOT": ("#e6007a", "#ffffff"),
}

_FALLBACK_PRICES: Mapping[str, float] = {
    "BTC/USDT": 59510.865,
    "ETH/USDT": 3450.0,
    "BNB/USDT": 655.0,
    "SOL/USDT": 164.0,
    "XRP/USDT": 2.18,
    "DOGE/USDT": 0.193,
    "ADA/USDT": 0.62,
    "TRX/USDT": 0.286,
    "AVAX/USDT": 28.4,
    "SHIB/USDT": 0.0000142,
    "LINK/USDT": 15.8,
    "TON/USDT": 3.15,
    "DOT/USDT": 4.72,
}

_TIMEFRAME_SECONDS: Mapping[str, int] = {
    "1m": 60,
    "5m": 5 * 60,
    "15m": 15 * 60,
    "30m": 30 * 60,
    "1h": 60 * 60,
    "4h": 4 * 60 * 60,
    "1d": 24 * 60 * 60,
}

_DEFAULT_REDIS_PASSWORD = ""
_DEFAULT_TIMESCALE_PASSWORD = ""


@dataclass(frozen=True)
class CryptoMarketRow:
    rank: int
    symbol: str
    base: str
    name: str
    icon_url: str
    icon_bg: str
    icon_fg: str
    price: float
    change_24h: float
    high_24h: float
    low_24h: float
    volume_24h: float
    quote_volume_24h: float
    market_cap: float
    funding_rate: float
    open_interest: float
    liquidation_24h: float


@dataclass(frozen=True)
class CryptoKlineBar:
    time: str
    timestamp: int
    symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class StorageStatus:
    redis: str
    timescale: str
    detail: str = ""


def normalize_symbol(symbol: str) -> str:
    clean = (symbol or "").strip().upper().replace("-", "/")
    if "/" not in clean and clean.endswith("USDT") and len(clean) > 4:
        clean = f"{clean[:-4]}/USDT"
    if clean not in TOP_SYMBOLS:
        raise ValueError(f"unsupported crypto symbol: {symbol}")
    return clean


def normalize_timeframe(timeframe: str) -> str:
    clean = (timeframe or "1h").strip().lower()
    aliases = {"1H": "1h", "4H": "4h", "1D": "1d"}
    clean = aliases.get(timeframe, clean)
    if clean not in _TIMEFRAME_SECONDS:
        raise ValueError("timeframe must be one of 1m, 5m, 15m, 30m, 1h, 4h, 1d")
    return clean


def get_market_dashboard(limit: int = 13) -> dict[str, Any]:
    symbols = list(TOP_SYMBOLS[: max(1, min(int(limit), len(TOP_SYMBOLS)))])
    source = "ccxt"
    try:
        tickers = _exchange().fetch_tickers(symbols)
        rows = [_row_from_ticker(index, symbol, tickers.get(symbol) or {}) for index, symbol in enumerate(symbols, start=1)]
    except Exception as exc:  # noqa: BLE001 - route must degrade when network/provider unavailable
        source = f"fallback: {type(exc).__name__}"
        rows = [_fallback_row(index, symbol) for index, symbol in enumerate(symbols, start=1)]

    aggregate = _aggregate_rows(rows)
    return {
        "status": "ok",
        "source": source,
        "updated_at": _now_iso(),
        "symbols": symbols,
        "aggregate": aggregate,
        "rows": [asdict(row) for row in rows],
    }


def get_klines(symbol: str = "BTC/USDT", timeframe: str = "1h", limit: int = 180) -> dict[str, Any]:
    clean_symbol = normalize_symbol(symbol)
    clean_timeframe = normalize_timeframe(timeframe)
    clean_limit = max(20, min(int(limit), 1000))
    cache_key = _redis_key(clean_symbol, clean_timeframe, clean_limit)
    storage = StorageStatus(redis="disabled", timescale="disabled")

    cached, redis_status = _read_redis(cache_key)
    if cached:
        cached["storage"] = {
            **dict(cached.get("storage") or {}),
            "redis": redis_status,
        }
        return cached

    source = "ccxt"
    try:
        raw_bars = _exchange().fetch_ohlcv(clean_symbol, timeframe=clean_timeframe, limit=clean_limit)
        bars = [_bar_from_ohlcv(clean_symbol, row) for row in raw_bars if _valid_ohlcv(row)]
        if not bars:
            raise ValueError("exchange returned no bars")
    except Exception as exc:  # noqa: BLE001
        source = f"fallback: {type(exc).__name__}"
        bars = _fallback_bars(clean_symbol, clean_timeframe, clean_limit)

    redis_write = _write_redis(cache_key, bars, clean_symbol, clean_timeframe, source)
    timescale_write = _write_timescale(bars, clean_timeframe)
    storage = StorageStatus(redis=redis_write, timescale=timescale_write)
    return {
        "status": "ok",
        "symbol": clean_symbol,
        "timeframe": clean_timeframe,
        "source": source,
        "updated_at": _now_iso(),
        "storage": asdict(storage),
        "bars": [asdict(bar) for bar in bars],
    }


def _exchange():
    try:
        import ccxt  # type: ignore
    except ModuleNotFoundError as exc:
        raise RuntimeError("ccxt is not installed") from exc

    exchange_id = os.getenv("CRYPTO_DASHBOARD_EXCHANGE", os.getenv("CCXT_EXCHANGE", "binance")).strip().lower()
    exchange_cls = getattr(ccxt, exchange_id, None) or ccxt.binance
    return exchange_cls(
        {
            "enableRateLimit": True,
            "timeout": int(float(os.getenv("CRYPTO_DASHBOARD_TIMEOUT_S", "15")) * 1000),
            "options": {"defaultType": "spot"},
        }
    )


def _row_from_ticker(rank: int, symbol: str, ticker: Mapping[str, Any]) -> CryptoMarketRow:
    last = _float(ticker.get("last")) or _FALLBACK_PRICES[symbol]
    percentage = _float(ticker.get("percentage"))
    if percentage is None:
        open_price = _float(ticker.get("open"))
        percentage = ((last - open_price) / open_price * 100) if open_price else _fallback_change(rank)
    high = _float(ticker.get("high")) or last * (1 + abs(percentage) / 100 + 0.012)
    low = _float(ticker.get("low")) or last * max(0.000001, 1 - abs(percentage) / 100 - 0.012)
    base_volume = _float(ticker.get("baseVolume")) or _fallback_volume(rank, symbol)
    quote_volume = _float(ticker.get("quoteVolume")) or base_volume * last
    return _market_row(
        rank=rank,
        symbol=symbol,
        price=last,
        change_24h=percentage,
        high_24h=high,
        low_24h=low,
        volume_24h=base_volume,
        quote_volume_24h=quote_volume,
    )


def _fallback_row(rank: int, symbol: str) -> CryptoMarketRow:
    price, change = _fallback_realtime_price(rank, symbol)
    volume = _fallback_volume(rank, symbol)
    open_price = price / (1 + change / 100) if change > -99 else price
    upper_anchor = max(price, open_price)
    lower_anchor = min(price, open_price)
    high = upper_anchor * (1 + abs(change) / 700 + 0.012)
    low = lower_anchor * (1 - abs(change) / 800 - 0.010)
    return _market_row(
        rank=rank,
        symbol=symbol,
        price=price,
        change_24h=change,
        high_24h=high,
        low_24h=low,
        volume_24h=volume,
        quote_volume_24h=volume * price,
    )


def _market_row(
    *,
    rank: int,
    symbol: str,
    price: float,
    change_24h: float,
    high_24h: float,
    low_24h: float,
    volume_24h: float,
    quote_volume_24h: float,
) -> CryptoMarketRow:
    base = symbol.split("/", 1)[0]
    market_cap = quote_volume_24h * (18 + rank * 1.7)
    open_interest = quote_volume_24h * (0.18 + rank * 0.006)
    liquidation = quote_volume_24h * (0.003 + rank * 0.00015)
    funding = _fallback_funding(rank, symbol)
    return CryptoMarketRow(
        rank=rank,
        symbol=symbol,
        base=base,
        name=_SYMBOL_NAMES[symbol],
        icon_url=f"/coin-icons/{base.lower()}.svg",
        icon_bg=_SYMBOL_ICON_COLORS.get(base, ("#3f3f46", "#ffffff"))[0],
        icon_fg=_SYMBOL_ICON_COLORS.get(base, ("#3f3f46", "#ffffff"))[1],
        price=round(price, 10),
        change_24h=round(change_24h, 4),
        high_24h=round(high_24h, 10),
        low_24h=round(max(low_24h, 0.0), 10),
        volume_24h=round(volume_24h, 4),
        quote_volume_24h=round(quote_volume_24h, 4),
        market_cap=round(market_cap, 4),
        funding_rate=round(funding, 5),
        open_interest=round(open_interest, 4),
        liquidation_24h=round(liquidation, 4),
    )


def _aggregate_rows(rows: Iterable[CryptoMarketRow]) -> dict[str, float]:
    materialized = list(rows)
    total_volume = sum(row.quote_volume_24h for row in materialized)
    total_market_cap = sum(row.market_cap for row in materialized)
    total_open_interest = sum(row.open_interest for row in materialized)
    total_liquidation = sum(row.liquidation_24h for row in materialized)
    avg_change = sum(row.change_24h for row in materialized) / len(materialized)
    return {
        "market_cap": round(total_market_cap, 4),
        "volume_24h": round(total_volume, 4),
        "open_interest": round(total_open_interest, 4),
        "liquidation_24h": round(total_liquidation, 4),
        "avg_change_24h": round(avg_change, 4),
        "btc_dominance": round((materialized[0].market_cap / total_market_cap) * 100, 4) if total_market_cap else 0.0,
    }


def _bar_from_ohlcv(symbol: str, row: Any) -> CryptoKlineBar:
    ts, open_, high, low, close, volume = list(row)[:6]
    timestamp = int(ts)
    return CryptoKlineBar(
        time=_iso_from_ms(timestamp),
        timestamp=timestamp,
        symbol=symbol,
        open=float(open_),
        high=float(high),
        low=float(low),
        close=float(close),
        volume=float(volume),
    )


def _valid_ohlcv(row: Any) -> bool:
    if not isinstance(row, (list, tuple)) or len(row) < 6:
        return False
    try:
        return all(float(value) >= 0 for value in row[1:6])
    except (TypeError, ValueError):
        return False


def _fallback_bars(symbol: str, timeframe: str, limit: int) -> list[CryptoKlineBar]:
    step = _TIMEFRAME_SECONDS[timeframe] * 1000
    now = int(time.time() * 1000)
    aligned_now = now - (now % step)
    base_price = _FALLBACK_PRICES[symbol]
    rank = TOP_SYMBOLS.index(symbol) + 1
    rng = _deterministic_rng("klines", symbol, timeframe, limit, aligned_now)
    bars: list[CryptoKlineBar] = []
    prev_close = round(base_price * (1 + rng.uniform(-0.006, 0.006)), 10)
    timeframe_volatility = {
        "1m": 0.0012,
        "5m": 0.0020,
        "15m": 0.0032,
        "30m": 0.0042,
        "1h": 0.0055,
        "4h": 0.0100,
        "1d": 0.0240,
    }[timeframe]
    base_volume = _fallback_volume(rank, symbol) * (_TIMEFRAME_SECONDS[timeframe] / 86_400)
    min_price = max(base_price * 0.0001, 1e-12)

    for i in range(limit):
        ts = aligned_now - (limit - i - 1) * step
        open_ = prev_close
        mean_reversion = ((base_price - open_) / base_price) * 0.015
        raw_return = rng.gauss(mean_reversion, timeframe_volatility)
        bounded_return = max(-timeframe_volatility * 4.0, min(timeframe_volatility * 4.0, raw_return))
        close = round(max(min_price, open_ * (1 + bounded_return)), 10)
        body_top = max(open_, close)
        body_bottom = min(open_, close)
        upper_wick = rng.uniform(0.001, 0.006) + abs(bounded_return) * rng.uniform(0.15, 0.75)
        lower_wick = rng.uniform(0.001, 0.006) + abs(bounded_return) * rng.uniform(0.15, 0.75)
        high = max(body_top, body_top * (1 + upper_wick))
        low = max(min_price, body_bottom * (1 - lower_wick))
        volume_noise = rng.uniform(0.72, 1.36)
        volume_move_boost = 1 + abs(bounded_return) * rng.uniform(24, 90)
        volume = base_volume * volume_noise * volume_move_boost
        bars.append(
            CryptoKlineBar(
                time=_iso_from_ms(ts),
                timestamp=ts,
                symbol=symbol,
                open=round(open_, 10),
                high=round(high, 10),
                low=round(max(low, 0.0), 10),
                close=round(close, 10),
                volume=round(volume, 4),
            )
        )
        prev_close = close
    return bars


def _read_redis(key: str) -> tuple[dict[str, Any] | None, str]:
    client = _redis_client()
    if client is None:
        return None, "disabled"
    try:
        value = client.get(key)
        if not value:
            return None, "miss"
        if isinstance(value, bytes):
            value = value.decode("utf-8")
        return json.loads(value), "hit"
    except Exception as exc:  # noqa: BLE001
        return None, f"degraded: {type(exc).__name__}"


def _write_redis(key: str, bars: list[CryptoKlineBar], symbol: str, timeframe: str, source: str) -> str:
    client = _redis_client()
    if client is None:
        return "disabled"
    payload = {
        "status": "ok",
        "symbol": symbol,
        "timeframe": timeframe,
        "source": source,
        "updated_at": _now_iso(),
        "storage": {"redis": "stored", "timescale": "unknown"},
        "bars": [asdict(bar) for bar in bars],
    }
    try:
        client.setex(key, int(os.getenv("CRYPTO_REDIS_TTL_SECONDS", "86400")), json.dumps(payload, ensure_ascii=False))
        return "stored"
    except Exception as exc:  # noqa: BLE001
        return f"degraded: {type(exc).__name__}"


def _redis_client():
    if _env_flag("CRYPTO_REDIS_DISABLED"):
        return None
    try:
        import redis  # type: ignore
    except ModuleNotFoundError:
        return None
    password = os.getenv("CRYPTO_REDIS_PASSWORD", _DEFAULT_REDIS_PASSWORD)
    if password == "":
        password = None
    return redis.Redis(
        host=os.getenv("CRYPTO_REDIS_HOST", "127.0.0.1"),
        port=int(os.getenv("CRYPTO_REDIS_PORT", "6379")),
        db=int(os.getenv("CRYPTO_REDIS_DB", "0")),
        password=password,
        socket_connect_timeout=float(os.getenv("CRYPTO_REDIS_TIMEOUT_S", "0.5")),
        socket_timeout=float(os.getenv("CRYPTO_REDIS_TIMEOUT_S", "0.5")),
    )


def _write_timescale(bars: list[CryptoKlineBar], timeframe: str) -> str:
    if _env_flag("CRYPTO_TIMESCALE_DISABLED"):
        return "disabled"
    if not bars:
        return "skipped"
    try:
        import psycopg  # type: ignore
    except ModuleNotFoundError:
        return "disabled"
    try:
        with psycopg.connect(_timescale_dsn(), connect_timeout=float(os.getenv("CRYPTO_TIMESCALE_TIMEOUT_S", "1.5"))) as conn:
            _ensure_timescale_schema(conn)
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO crypto_klines (
                        symbol, timeframe, time, open, high, low, close, volume
                    )
                    VALUES (%s, %s, to_timestamp(%s / 1000.0), %s, %s, %s, %s, %s)
                    ON CONFLICT (symbol, timeframe, time)
                    DO UPDATE SET
                        open = EXCLUDED.open,
                        high = EXCLUDED.high,
                        low = EXCLUDED.low,
                        close = EXCLUDED.close,
                        volume = EXCLUDED.volume
                    """,
                    [
                        (
                            bar.symbol,
                            timeframe,
                            bar.timestamp,
                            bar.open,
                            bar.high,
                            bar.low,
                            bar.close,
                            bar.volume,
                        )
                        for bar in bars
                    ],
                )
            conn.commit()
        return "stored"
    except Exception as exc:  # noqa: BLE001
        return f"degraded: {type(exc).__name__}"


def _ensure_timescale_schema(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS crypto_klines (
                symbol TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                time TIMESTAMPTZ NOT NULL,
                open DOUBLE PRECISION NOT NULL,
                high DOUBLE PRECISION NOT NULL,
                low DOUBLE PRECISION NOT NULL,
                close DOUBLE PRECISION NOT NULL,
                volume DOUBLE PRECISION NOT NULL,
                PRIMARY KEY (symbol, timeframe, time)
            )
            """
        )
    conn.commit()
    with conn.cursor() as cur:
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
            cur.execute("SELECT create_hypertable('crypto_klines', 'time', if_not_exists => TRUE)")
        except Exception:
            conn.rollback()


def _timescale_dsn() -> str:
    dsn = os.getenv("CRYPTO_TIMESCALE_DSN", "").strip()
    if dsn:
        return dsn
    host = os.getenv("CRYPTO_TIMESCALE_HOST", "127.0.0.1")
    port = os.getenv("CRYPTO_TIMESCALE_PORT", "5432")
    database = os.getenv("CRYPTO_TIMESCALE_DATABASE", "venus")
    user = os.getenv("CRYPTO_TIMESCALE_USER", "venus")
    password = os.getenv("CRYPTO_TIMESCALE_PASSWORD", _DEFAULT_TIMESCALE_PASSWORD)
    return f"host={host} port={port} dbname={database} user={user} password={password}"


def _redis_key(symbol: str, timeframe: str, limit: int) -> str:
    compact = symbol.replace("/", "")
    version = os.getenv("CRYPTO_KLINE_CACHE_VERSION", "v2").strip() or "v2"
    return f"crypto:klines:{version}:{compact}:{timeframe}:{limit}"


def _deterministic_rng(*parts: object) -> random.Random:
    material = "|".join(str(part) for part in parts)
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


def _fallback_funding(rank: int, symbol: str) -> float:
    rng = _deterministic_rng("funding", symbol, rank)
    return round(rng.uniform(-0.028, 0.028), 5)


def _fallback_change(rank: int) -> float:
    rng = _deterministic_rng("change", rank)
    return round(rng.uniform(-4.8, 5.6), 4)


def _fallback_realtime_price(rank: int, symbol: str) -> tuple[float, float]:
    base_price = _FALLBACK_PRICES[symbol]
    window = int(time.time() // 15)
    previous_rng = _deterministic_rng("ticker", symbol, window - 1)
    current_rng = _deterministic_rng("ticker", symbol, window)
    progress = (time.time() % 15) / 15
    previous_tick = previous_rng.uniform(-0.009, 0.009)
    current_tick = current_rng.uniform(-0.009, 0.009)
    tick_move = previous_tick + (current_tick - previous_tick) * progress
    intraday_move = math.sin((window + rank * 17) / 211) * 0.018
    drift = math.sin((window + rank * 31) / 997) * 0.026
    total_move = max(-0.08, min(0.08, tick_move + intraday_move + drift))
    price = base_price * (1 + total_move)
    change = _fallback_change(rank) + total_move * 100
    return round(price, 10), round(change, 4)


def _fallback_volume(rank: int, symbol: str) -> float:
    price = _FALLBACK_PRICES[symbol]
    scale = 1_800_000_000 / max(price, 0.000001)
    return scale / (rank ** 0.72)


def _float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _iso_from_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}
