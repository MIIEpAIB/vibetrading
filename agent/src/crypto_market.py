"""OKX perpetual market data for the crypto dashboard and shadow trading."""

from __future__ import annotations

import json
import math
import os
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

TOP_SYMBOLS = (
    "BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT",
    "DOGE/USDT", "ADA/USDT", "TRX/USDT", "AVAX/USDT", "SHIB/USDT",
    "LINK/USDT", "TON/USDT", "DOT/USDT",
)
OKX_BASE_URL = "https://www.okx.com"
OKX_WS_URL = "wss://ws.okx.com:8443/ws/v5/public"

_NAMES = {
    "BTC": "Bitcoin", "ETH": "Ethereum", "BNB": "BNB", "SOL": "Solana",
    "XRP": "XRP", "DOGE": "Dogecoin", "ADA": "Cardano", "TRX": "TRON",
    "AVAX": "Avalanche", "SHIB": "Shiba Inu", "LINK": "Chainlink",
    "TON": "Toncoin", "DOT": "Polkadot",
}
_COLORS = {
    "BTC": ("#f7931a", "#111827"), "ETH": ("#627eea", "#ffffff"),
    "BNB": ("#f3ba2f", "#111827"), "SOL": ("#14f195", "#111827"),
    "XRP": ("#d1d5db", "#111827"), "DOGE": ("#c2a633", "#111827"),
    "ADA": ("#3468d1", "#ffffff"), "TRX": ("#ef0027", "#ffffff"),
    "AVAX": ("#e84142", "#ffffff"), "SHIB": ("#f00500", "#ffffff"),
    "LINK": ("#2a5ada", "#ffffff"), "TON": ("#0098ea", "#ffffff"),
    "DOT": ("#e6007a", "#ffffff"),
}
_BARS = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "1d": "1D"}
_ALIASES = {"1min": "1m", "5min": "5m", "15min": "15m", "60m": "1h", "60min": "1h", "day": "1d"}


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
    clean = (symbol or "").strip().upper().replace("-", "/").replace("_", "/")
    if "/" not in clean and clean.endswith("USDT"):
        clean = f"{clean[:-4]}/USDT"
    if clean not in TOP_SYMBOLS:
        raise ValueError(f"unsupported crypto symbol: {symbol}")
    return clean


def okx_instrument_id(symbol: str) -> str:
    base, quote = normalize_symbol(symbol).split("/", 1)
    return f"{base}-{quote}-SWAP"


def normalize_timeframe(timeframe: str) -> str:
    clean = _ALIASES.get((timeframe or "1h").strip().lower(), (timeframe or "1h").strip().lower())
    if clean not in _BARS:
        raise ValueError("timeframe must be one of 1m, 5m, 15m, 1h, 1d")
    return clean


def get_market_dashboard(limit: int = 13) -> dict[str, Any]:
    symbols = list(TOP_SYMBOLS[:max(1, min(int(limit), len(TOP_SYMBOLS)))])
    try:
        tickers = _okx_tickers(symbols)
        funding = _okx_funding_rates(symbols)
        rows = [_row_from_ticker(i, symbol, tickers[symbol], funding.get(symbol, 0.0)) for i, symbol in enumerate(symbols, 1)]
        source = "okx"
    except Exception as exc:  # noqa: BLE001
        rows = []
        source = f"unavailable: okx {type(exc).__name__}"
    return {
        "status": "ok" if rows else "error",
        "source": source,
        "updated_at": _now_iso(),
        "symbols": symbols,
        "aggregate": _aggregate_rows(rows),
        "rows": [asdict(row) for row in rows],
    }


def get_exchange_symbols(exchange: str = "okx", product_type: str = "usdm_futures", limit: int = 200) -> dict[str, Any]:
    if (exchange or "okx").strip().lower() != "okx":
        raise ValueError("crypto dashboard exchange must be okx")
    clean_product = (product_type or "usdm_futures").strip().lower()
    symbols = []
    for symbol in TOP_SYMBOLS[:max(1, min(int(limit), len(TOP_SYMBOLS)))]:
        base, quote = symbol.split("/")
        symbols.append({
            "symbol": okx_instrument_id(symbol),
            "display": symbol,
            "base": base,
            "quote": quote,
            "market_type": clean_product,
        })
    return {"status": "ok", "source": "okx", "exchange": "okx", "product_type": clean_product, "symbols": symbols}


def get_klines(symbol: str = "BTC/USDT", timeframe: str = "1h", limit: int = 180) -> dict[str, Any]:
    clean_symbol = normalize_symbol(symbol)
    clean_timeframe = normalize_timeframe(timeframe)
    storage = StorageStatus(redis="disabled", timescale="disabled")
    try:
        rows = _json_get(f"{OKX_BASE_URL}/api/v5/market/candles", {
            "instId": okx_instrument_id(clean_symbol), "bar": _BARS[clean_timeframe],
            "limit": max(1, min(int(limit), 1000)),
        })
        bars = [_bar_from_okx_row(clean_symbol, row) for row in reversed(rows) if _valid_row(row)]
        source = "okx"
    except Exception as exc:  # noqa: BLE001
        bars = []
        source = f"unavailable: okx {type(exc).__name__}"
    return {
        "status": "ok" if bars else "error", "symbol": clean_symbol, "timeframe": clean_timeframe,
        "source": source, "updated_at": _now_iso(), "storage": asdict(storage),
        "bars": [asdict(bar) for bar in bars],
    }


def okx_kline_subscription(symbol: str, timeframe: str) -> dict[str, str]:
    clean_timeframe = normalize_timeframe(timeframe)
    return {"channel": f"candle{_BARS[clean_timeframe]}", "instId": okx_instrument_id(symbol)}


def parse_okx_trade_message(payload: Mapping[str, Any]) -> tuple[str, float] | None:
    if not isinstance(payload, Mapping) or payload.get("event") or payload.get("arg", {}).get("channel") != "trades":
        return None
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        return None
    try:
        return normalize_symbol(str(data[0]["instId"]).removesuffix("-SWAP")), float(data[0]["px"])
    except (KeyError, TypeError, ValueError):
        return None


def parse_okx_kline_message(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    if not isinstance(payload, Mapping) or payload.get("event"):
        return None
    arg = payload.get("arg") or {}
    channel = str(arg.get("channel") or "")
    if not channel.startswith("candle") or not isinstance(payload.get("data"), list) or not payload["data"]:
        return None
    try:
        timeframe = next(key for key, value in _BARS.items() if f"candle{value}" == channel)
        symbol = normalize_symbol(str(arg["instId"]).removesuffix("-SWAP"))
        row = payload["data"][0]
        bar = _bar_from_okx_row(symbol, row)
    except (KeyError, TypeError, ValueError, StopIteration):
        return None
    return {
        "type": "kline", "symbol": symbol, "timeframe": timeframe,
        "event_time": bar.timestamp, "is_final": len(row) > 8 and str(row[8]) == "1",
        "bar": asdict(bar),
    }


def _json_get(url: str, params: Mapping[str, Any] | None = None) -> Any:
    query = urllib.parse.urlencode({key: value for key, value in (params or {}).items() if value is not None})
    request = urllib.request.Request(
        f"{url}?{query}" if query else url,
        headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0 (Vibe-Trading OKX market data)"},
    )
    with urllib.request.urlopen(request, timeout=float(os.getenv("CRYPTO_DASHBOARD_TIMEOUT_S", "15"))) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("code") != "0":
        raise ValueError(f"okx returned code {payload.get('code')}: {payload.get('msg', '')}")
    return payload.get("data", [])


def _okx_tickers(symbols: list[str]) -> dict[str, Mapping[str, Any]]:
    payload = _json_get(f"{OKX_BASE_URL}/api/v5/market/tickers", {"instType": "SWAP"})
    wanted = {okx_instrument_id(symbol): symbol for symbol in symbols}
    rows = {wanted[item["instId"]]: item for item in payload if isinstance(item, Mapping) and item.get("instId") in wanted}
    if len(rows) != len(symbols):
        raise ValueError("okx returned incomplete swap tickers")
    return rows


def _okx_funding_rates(symbols: list[str]) -> dict[str, float]:
    result = {}
    for symbol in symbols:
        payload = _json_get(f"{OKX_BASE_URL}/api/v5/public/funding-rate", {"instId": okx_instrument_id(symbol)})
        if payload:
            result[symbol] = _number(payload[0].get("fundingRate"), 0.0)
    return result


def _row_from_ticker(rank: int, symbol: str, ticker: Mapping[str, Any], funding_rate: float) -> CryptoMarketRow:
    last = _positive(ticker.get("last"))
    if last is None:
        raise ValueError(f"okx returned invalid price for {symbol}")
    open_24h = _positive(ticker.get("sodUtc8")) or last
    return _market_row(
        rank=rank, symbol=symbol, price=last,
        change_24h=(last / open_24h - 1) * 100 if open_24h else 0,
        high_24h=_positive(ticker.get("high24h")) or last,
        low_24h=_positive(ticker.get("low24h")) or last,
        volume_24h=_number(ticker.get("vol24h"), 0),
        quote_volume_24h=_number(ticker.get("volCcy24h"), 0),
        funding_rate=funding_rate,
    )


def _market_row(*, rank: int, symbol: str, price: float, change_24h: float, high_24h: float, low_24h: float,
                volume_24h: float, quote_volume_24h: float, funding_rate: float) -> CryptoMarketRow:
    base = symbol.split("/", 1)[0]
    bg, fg = _COLORS.get(base, ("#3f3f46", "#ffffff"))
    return CryptoMarketRow(
        rank=rank, symbol=symbol, base=base, name=_NAMES[base],
        icon_url=f"/coin-icons/{base.lower()}.svg", icon_bg=bg, icon_fg=fg,
        price=round(price, 10), change_24h=round(change_24h, 4),
        high_24h=round(high_24h, 10), low_24h=round(low_24h, 10),
        volume_24h=round(volume_24h, 4), quote_volume_24h=round(quote_volume_24h, 4),
        market_cap=0.0, funding_rate=round(funding_rate, 8), open_interest=0.0, liquidation_24h=0.0,
    )


def _bar_from_okx_row(symbol: str, row: Any) -> CryptoKlineBar:
    timestamp = int(row[0])
    return CryptoKlineBar(
        time=_iso_from_ms(timestamp), timestamp=timestamp, symbol=symbol,
        open=float(row[1]), high=float(row[2]), low=float(row[3]), close=float(row[4]), volume=float(row[5]),
    )


def _valid_row(row: Any) -> bool:
    if not isinstance(row, (list, tuple)) or len(row) < 6:
        return False
    try:
        return int(row[0]) > 0 and all(float(value) >= 0 for value in row[1:6])
    except (TypeError, ValueError):
        return False


def _aggregate_rows(rows: Iterable[CryptoMarketRow]) -> dict[str, float]:
    values = list(rows)
    return {
        "market_cap": 0.0, "volume_24h": round(sum(row.quote_volume_24h for row in values), 4),
        "open_interest": 0.0, "liquidation_24h": 0.0,
        "avg_change_24h": round(sum(row.change_24h for row in values) / len(values), 4) if values else 0.0,
        "btc_dominance": 0.0,
    }


def _positive(value: Any) -> float | None:
    result = _number(value, 0.0)
    return result if result > 0 and math.isfinite(result) else None


def _number(value: Any, default: float) -> float:
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def _iso_from_ms(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
