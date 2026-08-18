"""Crypto market dashboard data service backed by live public exchange APIs."""

from __future__ import annotations

import json
import math
import os
import time
import urllib.parse
import urllib.request
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

BINANCE_BASE_URL = "https://api.binance.com"
COINBASE_BASE_URL = "https://api.exchange.coinbase.com"
BINANCE_WS_BASE_URL = "wss://stream.binance.com:9443/ws"

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

_TIMEFRAME_SECONDS: Mapping[str, int] = {
    "1m": 60,
    "5m": 5 * 60,
    "15m": 15 * 60,
    "1h": 60 * 60,
    "1d": 24 * 60 * 60,
}

_FREQUENCY_ALIASES: Mapping[str, tuple[str, str]] = {
    "1m": ("1m", "1min"),
    "1min": ("1m", "1min"),
    "5m": ("5m", "5min"),
    "5min": ("5m", "5min"),
    "15m": ("15m", "15min"),
    "15min": ("15m", "15min"),
    "1h": ("1h", "60min"),
    "60m": ("1h", "60min"),
    "60min": ("1h", "60min"),
    "1d": ("1d", "day"),
    "day": ("1d", "day"),
}

_COINBASE_GRANULARITY: Mapping[str, int] = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "1d": 86400,
}

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
    clean = _FREQUENCY_ALIASES.get(clean, _FREQUENCY_ALIASES["1d"])[0]
    if clean not in _TIMEFRAME_SECONDS:
        raise ValueError("timeframe must be one of 1m, 5m, 15m, 1h, 1d")
    return clean


def get_market_dashboard(limit: int = 13) -> dict[str, Any]:
    symbols = list(TOP_SYMBOLS[: max(1, min(int(limit), len(TOP_SYMBOLS)))])
    try:
        ticker_map = _binance_tickers(symbols)
        rows = [_row_from_binance_ticker(index, symbol, ticker_map[symbol]) for index, symbol in enumerate(symbols, start=1)]
        source = "binance"
    except Exception as exc:  # noqa: BLE001 - route must degrade when network/provider unavailable
        source = f"unavailable: binance {type(exc).__name__}"
        rows = []

    aggregate = _aggregate_rows(rows)
    return {
        "status": "ok" if rows else "error",
        "source": source,
        "updated_at": _now_iso(),
        "symbols": symbols,
        "aggregate": aggregate,
        "rows": [asdict(row) for row in rows],
    }


def get_exchange_symbols(exchange: str = "binance", product_type: str = "spot", limit: int = 200) -> dict[str, Any]:
    clean_exchange = (exchange or "binance").strip().lower()
    clean_product = (product_type or "spot").strip().lower()
    clean_limit = max(1, min(int(limit), 1000))
    source = "quantaxis-crypto"
    symbols = [
        _symbol_option(symbol, clean_product, {"base": symbol.split("/", 1)[0], "quote": symbol.split("/", 1)[1]})
        for symbol in TOP_SYMBOLS[:clean_limit]
    ]
    return {
        "status": "ok",
        "source": source,
        "exchange": clean_exchange,
        "product_type": clean_product,
        "symbols": symbols,
    }


def get_klines(symbol: str = "BTC/USDT", timeframe: str = "1h", limit: int = 180) -> dict[str, Any]:
    clean_symbol = normalize_symbol(symbol)
    clean_timeframe = normalize_timeframe(timeframe)
    binance_frequency, qa_frequency = _FREQUENCY_ALIASES[clean_timeframe]
    clean_limit = max(1, min(int(limit), 1000))
    storage = StorageStatus(redis="disabled", timescale="disabled")

    try:
        bars = _fetch_from_binance(clean_symbol, binance_frequency, clean_limit)
        source = "binance"
    except Exception as exc:  # noqa: BLE001
        try:
            coinbase_frequency = "1d" if qa_frequency == "day" else "1h" if qa_frequency == "60min" else clean_timeframe
            bars = _fetch_from_coinbase(clean_symbol, coinbase_frequency, clean_limit)
            source = f"coinbase: binance {type(exc).__name__}"
        except Exception as coinbase_exc:  # noqa: BLE001
            source = f"unavailable: binance {type(exc).__name__}; coinbase {type(coinbase_exc).__name__}"
            bars = []

    return {
        "status": "ok" if bars else "error",
        "symbol": clean_symbol,
        "timeframe": clean_timeframe,
        "source": source,
        "updated_at": _now_iso(),
        "storage": asdict(storage),
        "bars": [asdict(bar) for bar in bars],
    }


def binance_kline_ws_url(symbol: str, timeframe: str) -> str:
    clean_symbol = normalize_symbol(symbol)
    clean_timeframe = normalize_timeframe(timeframe)
    return f"{BINANCE_WS_BASE_URL}/{_binance_symbol(clean_symbol).lower()}@kline_{clean_timeframe}"


def parse_binance_kline_stream_message(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    if not isinstance(payload, Mapping) or payload.get("e") != "kline":
        return None
    raw_kline = payload.get("k")
    if not isinstance(raw_kline, Mapping):
        return None

    symbol = raw_kline.get("s") or payload.get("s") or ""
    timeframe = raw_kline.get("i") or ""
    try:
        clean_symbol = normalize_symbol(str(symbol))
        clean_timeframe = normalize_timeframe(str(timeframe))
    except ValueError:
        return None

    try:
        timestamp = int(raw_kline["t"])
        open_price = float(raw_kline["o"])
        high_price = float(raw_kline["h"])
        low_price = float(raw_kline["l"])
        close_price = float(raw_kline["c"])
        volume = float(raw_kline["v"])
    except (KeyError, TypeError, ValueError):
        return None

    return {
        "type": "kline",
        "symbol": clean_symbol,
        "timeframe": clean_timeframe,
        "event_time": int(payload.get("E") or timestamp),
        "is_final": bool(raw_kline.get("x")),
        "bar": {
            "time": _iso_from_ms(timestamp),
            "timestamp": timestamp,
            "symbol": clean_symbol,
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "volume": volume,
        },
    }


def _symbol_option(symbol: str, product_type: str, market: Mapping[str, Any] | None = None) -> dict[str, str]:
    display = symbol.strip().upper()
    base = str((market or {}).get("base") or display.split("/", 1)[0]).upper()
    quote_raw = str((market or {}).get("quote") or (display.split("/", 1)[1].split(":", 1)[0] if "/" in display else "USDT"))
    quote = quote_raw.upper()
    return {
        "symbol": display.replace("/", "-").split(":", 1)[0],
        "display": display,
        "base": base,
        "quote": quote,
        "market_type": product_type,
    }


def _binance_symbol(symbol: str) -> str:
    return symbol.replace("/", "").replace("-", "").upper()


def _coinbase_product_id(symbol: str) -> str:
    base, quote = symbol.split("/", 1)
    if quote != "USDT":
        raise ValueError(f"coinbase secondary source only supports USDT symbols via USD products: {symbol}")
    return f"{base}-USD"


def _json_get(url: str, params: Mapping[str, Any] | None = None) -> Any:
    encoded = urllib.parse.urlencode({key: value for key, value in (params or {}).items() if value is not None})
    full_url = f"{url}?{encoded}" if encoded else url
    timeout = float(os.getenv("CRYPTO_DASHBOARD_TIMEOUT_S", "15"))
    request = urllib.request.Request(full_url, headers={"Accept": "application/json", "User-Agent": "Vibe-Trading/crypto-market"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed public HTTPS endpoints
        return json.loads(response.read().decode("utf-8"))


def _binance_tickers(symbols: list[str]) -> dict[str, Mapping[str, Any]]:
    payload = _json_get(f"{BINANCE_BASE_URL}/api/v3/ticker/24hr")
    if not isinstance(payload, list):
        raise ValueError("binance returned invalid ticker payload")
    wanted = {_binance_symbol(symbol): symbol for symbol in symbols}
    rows: dict[str, Mapping[str, Any]] = {}
    for item in payload:
        if not isinstance(item, Mapping):
            continue
        symbol = wanted.get(str(item.get("symbol") or ""))
        if symbol:
            rows[symbol] = item
    missing = [symbol for symbol in symbols if symbol not in rows]
    if missing:
        raise ValueError(f"binance missing tickers: {', '.join(missing)}")
    return rows


def _row_from_binance_ticker(rank: int, symbol: str, ticker: Mapping[str, Any]) -> CryptoMarketRow:
    last = _positive_float(ticker.get("lastPrice"))
    if last is None:
        raise ValueError(f"binance returned invalid last price for {symbol}")
    change = _float(ticker.get("priceChangePercent")) or 0.0
    high = _positive_float(ticker.get("highPrice")) or last * (1 + abs(change) / 100 + 0.012)
    low = _positive_float(ticker.get("lowPrice")) or last * max(0.000001, 1 - abs(change) / 100 - 0.012)
    base_volume = _positive_float(ticker.get("volume")) or 0.0
    quote_volume = _positive_float(ticker.get("quoteVolume")) or base_volume * last
    return _market_row(
        rank=rank,
        symbol=symbol,
        price=last,
        change_24h=change,
        high_24h=high,
        low_24h=low,
        volume_24h=base_volume,
        quote_volume_24h=quote_volume,
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
    market_cap: float | None = None,
) -> CryptoMarketRow:
    base = symbol.split("/", 1)[0]
    row_market_cap = market_cap if market_cap is not None and math.isfinite(market_cap) and market_cap > 0 else 0.0
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
        market_cap=round(row_market_cap, 4),
        funding_rate=0.0,
        open_interest=0.0,
        liquidation_24h=0.0,
    )


def _aggregate_rows(rows: Iterable[CryptoMarketRow]) -> dict[str, float]:
    materialized = list(rows)
    if not materialized:
        return {
            "market_cap": 0.0,
            "volume_24h": 0.0,
            "open_interest": 0.0,
            "liquidation_24h": 0.0,
            "avg_change_24h": 0.0,
            "btc_dominance": 0.0,
        }
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


def _fetch_from_binance(symbol: str, binance_frequency: str, limit: int) -> list[CryptoKlineBar]:
    step = _TIMEFRAME_SECONDS[binance_frequency]
    end_ts = int(time.time())
    start_ts = end_ts - step * limit
    payload = _json_get(
        f"{BINANCE_BASE_URL}/api/v3/klines",
        {
            "symbol": _binance_symbol(symbol),
            "interval": binance_frequency,
            "startTime": start_ts * 1000,
            "endTime": end_ts * 1000,
            "limit": min(limit, 1000),
        },
    )
    if not isinstance(payload, list) or not payload:
        raise ValueError("binance returned no kline bars")
    bars = [_bar_from_binance_row(symbol, row) for row in payload if _valid_binance_row(row)]
    if not bars:
        raise ValueError("binance returned no valid kline bars")
    return bars


def _bar_from_binance_row(symbol: str, row: Any) -> CryptoKlineBar:
    timestamp = int(row[0])
    return CryptoKlineBar(
        time=_iso_from_ms(timestamp),
        timestamp=timestamp,
        symbol=symbol,
        open=float(row[1]),
        high=float(row[2]),
        low=float(row[3]),
        close=float(row[4]),
        volume=float(row[5]),
    )


def _valid_binance_row(row: Any) -> bool:
    if not isinstance(row, (list, tuple)) or len(row) < 6:
        return False
    try:
        timestamp = int(row[0])
        values = [float(value) for value in row[1:6]]
    except (TypeError, ValueError):
        return False
    return timestamp > 0 and all(value >= 0 for value in values)


def _fetch_from_coinbase(symbol: str, frequency: str, limit: int) -> list[CryptoKlineBar]:
    granularity = _COINBASE_GRANULARITY.get(frequency)
    if granularity is None:
        return []
    end_ts = int(time.time())
    start_ts = end_ts - granularity * limit
    payload = _json_get(
        f"{COINBASE_BASE_URL}/products/{_coinbase_product_id(symbol)}/candles",
        {
            "granularity": granularity,
            "start": datetime.fromtimestamp(start_ts, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "end": datetime.fromtimestamp(end_ts, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        },
    )
    if not isinstance(payload, list) or not payload:
        raise ValueError("coinbase returned no kline bars")
    bars = [_bar_from_coinbase_row(symbol, row) for row in sorted(payload, key=lambda item: item[0]) if _valid_coinbase_row(row)]
    if not bars:
        raise ValueError("coinbase returned no valid kline bars")
    return bars[-limit:]


def _bar_from_coinbase_row(symbol: str, row: Any) -> CryptoKlineBar:
    timestamp = int(row[0]) * 1000
    return CryptoKlineBar(
        time=_iso_from_ms(timestamp),
        timestamp=timestamp,
        symbol=symbol,
        open=float(row[3]),
        high=float(row[2]),
        low=float(row[1]),
        close=float(row[4]),
        volume=float(row[5]),
    )


def _valid_coinbase_row(row: Any) -> bool:
    if not isinstance(row, (list, tuple)) or len(row) < 6:
        return False
    try:
        timestamp = int(row[0])
        values = [float(value) for value in row[1:6]]
    except (TypeError, ValueError):
        return False
    return timestamp > 0 and all(value >= 0 for value in values)


def _float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _positive_float(value: Any) -> float | None:
    result = _float(value)
    return result if result is not None and result > 0 else None


def _iso_from_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
