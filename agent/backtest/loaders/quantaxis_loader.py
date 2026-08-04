"""QUANTAXIS-backed OHLCV loader.

This adapter lets Vibe-Trading reuse a local QUANTAXIS installation as a
market-data source without coupling the rest of the backtest stack to
QUANTAXIS data structures. It prefers QUANTAXIS' Mongo collections directly so
Vibe-Trading does not need to import the full QUANTAXIS package just to read
locally collected bars. The package-level QUANTAXIS fetchers remain a fallback
for deployments that rely on QUANTAXIS' own query helpers.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from backtest.loaders.base import cached_loader_fetch, validate_date_range
from backtest.loaders.registry import register

logger = logging.getLogger(__name__)

_DEFAULT_QUANTAXIS_PATH = "/opt/QUANTAXIS"
_DEFAULT_MONGO_URI = "mongodb://root:root@127.0.0.1:27017/quantaxis?authSource=admin"
_INTRADAY_INTERVALS = {"1m", "5m", "15m", "30m", "1H"}
_DAILY_INTERVALS = {"1D"}
_MONGO_TIMEOUT_MS = 2000


def _ensure_quantaxis_path() -> None:
    """Put the configured local QUANTAXIS checkout on ``sys.path`` if present."""
    qa_path = os.getenv("QUANTAXIS_PATH", _DEFAULT_QUANTAXIS_PATH).strip()
    if not qa_path:
        return
    path = Path(qa_path)
    if path.exists():
        resolved = str(path.resolve())
        if resolved not in sys.path:
            sys.path.insert(0, resolved)


def _qa_symbol(code: str) -> str:
    """Normalize common Vibe symbols to QUANTAXIS' mostly bare code style."""
    token = str(code).strip().upper()
    for suffix in (".SH", ".SZ", ".BJ", ".SS"):
        if token.endswith(suffix):
            return token[: -len(suffix)]
    return token


def _is_crypto(code: str) -> bool:
    token = str(code).strip().upper()
    return "-" in token or "/" in token


def _is_probable_index(code: str) -> bool:
    token = _qa_symbol(code)
    return token.startswith(("000", "399", "880", "899")) and token.isdigit()


def _is_probable_future(code: str) -> bool:
    token = _qa_symbol(code)
    return any(ch.isalpha() for ch in token) and any(ch.isdigit() for ch in token) and not _is_crypto(token)


def _mongo_uri() -> str:
    """Return the QUANTAXIS Mongo URI used by the local deployment."""
    return (
        os.getenv("QUANTAXIS_MONGOURI")
        or os.getenv("MONGOURI")
        or os.getenv("MONGODB_URI")
        or os.getenv("MONGO_URI")
        or _DEFAULT_MONGO_URI
    )


def _mongo_database_name(uri: str) -> str:
    """Extract the database name from a Mongo URI, defaulting to quantaxis."""
    path = uri.split("?", 1)[0].rsplit("/", 1)[-1]
    return path or "quantaxis"


def _normalize_payload(payload: Any, requested_code: str) -> Optional[pd.DataFrame]:
    """Convert a QUANTAXIS DataStruct/DataFrame payload to OHLCV."""
    if payload is None:
        return None
    df = getattr(payload, "data", payload)
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return None

    frame = df.copy()
    if isinstance(frame.index, pd.MultiIndex):
        frame = frame.reset_index()
    elif frame.index.name in {"date", "datetime", "trade_date"}:
        frame = frame.reset_index()

    code_col = next((col for col in ("code", "symbol", "ts_code") if col in frame.columns), None)
    if code_col is not None:
        qa_code = _qa_symbol(requested_code)
        mask = frame[code_col].astype(str).str.upper().map(_qa_symbol) == qa_code
        if mask.any():
            frame = frame.loc[mask]

    date_col = next((col for col in ("datetime", "date", "trade_date") if col in frame.columns), None)
    if date_col is None:
        if isinstance(df.index, pd.DatetimeIndex):
            frame.index = pd.to_datetime(df.index)
        else:
            return None
    else:
        frame.index = pd.to_datetime(frame[date_col])

    frame = frame.rename(columns={"vol": "volume"})
    if "volume" not in frame.columns:
        frame["volume"] = 0.0

    required = ["open", "high", "low", "close", "volume"]
    missing = [col for col in required if col not in frame.columns]
    if missing:
        logger.debug("quantaxis: %s missing columns %s", requested_code, missing)
        return None

    out = frame[required].copy()
    for col in required:
        out[col] = pd.to_numeric(out[col], errors="coerce")
    out = out.dropna(subset=["open", "high", "low", "close"])
    if out.empty:
        return None
    out.index.name = "trade_date"
    return out.sort_index()


@register
class DataLoader:
    """Local QUANTAXIS OHLCV loader."""

    name = "quantaxis"
    markets = {"a_share", "futures", "crypto"}
    requires_auth = False

    def is_available(self) -> bool:
        """Available when the local QUANTAXIS Mongo store or package is usable."""
        try:
            client = self._mongo_client()
            client.admin.command("ping")
            return True
        except Exception:
            pass

        try:
            _ensure_quantaxis_path()
            import QUANTAXIS  # noqa: F401

            return True
        except Exception:
            return False

    def fetch(
        self,
        codes: List[str],
        start_date: str,
        end_date: str,
        *,
        interval: str = "1D",
        fields: Optional[List[str]] = None,
    ) -> Dict[str, pd.DataFrame]:
        """Fetch normalized OHLCV bars from local QUANTAXIS storage."""
        validate_date_range(start_date, end_date)
        if interval not in _DAILY_INTERVALS and interval not in _INTRADAY_INTERVALS:
            raise ValueError(
                f"Unsupported interval for quantaxis: {interval!r}. "
                f"Supported: {sorted(_DAILY_INTERVALS | _INTRADAY_INTERVALS)}"
            )

        result: Dict[str, pd.DataFrame] = {}
        for code in codes:
            try:
                df = cached_loader_fetch(
                    source=self.name,
                    symbol=code,
                    timeframe=interval,
                    start_date=start_date,
                    end_date=end_date,
                    fields=fields,
                    fetch=lambda code=code: self._fetch_one(code, start_date, end_date, interval),
                )
                if df is not None and not df.empty:
                    result[code] = df
            except Exception as exc:
                logger.warning("quantaxis failed for %s: %s", code, exc)
        return result

    def _fetch_one(
        self,
        code: str,
        start_date: str,
        end_date: str,
        interval: str,
    ) -> Optional[pd.DataFrame]:
        try:
            frame = self._fetch_one_from_mongo(code, start_date, end_date, interval)
            if frame is not None and not frame.empty:
                return frame
        except Exception as exc:
            logger.debug("quantaxis mongo path unavailable for %s: %s", code, exc)

        _ensure_quantaxis_path()
        from QUANTAXIS.QAFetch import QAQuery_Advance as qa

        qa_code = _qa_symbol(code)
        if interval in _INTRADAY_INTERVALS:
            return self._fetch_intraday(qa, qa_code, code, start_date, end_date, interval)
        return self._fetch_daily(qa, qa_code, code, start_date, end_date)

    @staticmethod
    def _mongo_client() -> Any:
        from pymongo import MongoClient

        return MongoClient(
            _mongo_uri(),
            serverSelectionTimeoutMS=_MONGO_TIMEOUT_MS,
            connectTimeoutMS=_MONGO_TIMEOUT_MS,
            socketTimeoutMS=_MONGO_TIMEOUT_MS,
        )

    def _fetch_one_from_mongo(
        self,
        code: str,
        start_date: str,
        end_date: str,
        interval: str,
    ) -> Optional[pd.DataFrame]:
        """Read OHLCV directly from QUANTAXIS Mongo collections."""
        qa_code = _qa_symbol(code)
        uri = _mongo_uri()
        client = self._mongo_client()
        db = client[_mongo_database_name(uri)]

        collections = self._mongo_collections(code, interval)
        if not collections:
            return None

        for collection_name in collections:
            coll = db[collection_name]
            query: dict[str, Any] = {"code": qa_code}
            time_field = "datetime" if interval in _INTRADAY_INTERVALS else "date"
            query[time_field] = {"$gte": start_date, "$lte": end_date}

            docs = list(coll.find(query, {"_id": 0}).sort(time_field, 1))
            frame = _normalize_payload(pd.DataFrame(docs), code)
            if frame is not None and not frame.empty:
                return frame
        return None

    @staticmethod
    def _mongo_collections(code: str, interval: str) -> list[str]:
        if _is_crypto(code):
            return ["cryptocurrency_min"] if interval in _INTRADAY_INTERVALS else ["cryptocurrency_day"]
        if _is_probable_future(code):
            return ["future_min"] if interval in _INTRADAY_INTERVALS else ["future_day"]
        if interval in _INTRADAY_INTERVALS:
            return ["stock_min", "index_min"]
        return ["stock_day", "index_day"]

    @staticmethod
    def _fetch_daily(
        qa: Any,
        qa_code: str,
        requested_code: str,
        start_date: str,
        end_date: str,
    ) -> Optional[pd.DataFrame]:
        if _is_crypto(requested_code):
            fetchers = [qa.QA_fetch_cryptocurrency_day_adv]
        elif _is_probable_future(requested_code):
            fetchers = [qa.QA_fetch_future_day_adv]
        elif _is_probable_index(requested_code):
            fetchers = [qa.QA_fetch_stock_day_adv, qa.QA_fetch_index_day_adv]
        else:
            fetchers = [qa.QA_fetch_stock_day_adv, qa.QA_fetch_index_day_adv]

        for fetcher in fetchers:
            frame = _normalize_payload(fetcher(qa_code, start_date, end_date), requested_code)
            if frame is not None and not frame.empty:
                return frame
        return None

    @staticmethod
    def _fetch_intraday(
        qa: Any,
        qa_code: str,
        requested_code: str,
        start_date: str,
        end_date: str,
        interval: str,
    ) -> Optional[pd.DataFrame]:
        frequency = "60min" if interval == "1H" else interval.replace("m", "min")
        if _is_crypto(requested_code):
            fetchers = [qa.QA_fetch_cryptocurrency_min_adv]
        elif _is_probable_future(requested_code):
            fetchers = [qa.QA_fetch_future_min_adv]
        elif _is_probable_index(requested_code):
            fetchers = [qa.QA_fetch_stock_min_adv, qa.QA_fetch_index_min_adv]
        else:
            fetchers = [qa.QA_fetch_stock_min_adv, qa.QA_fetch_index_min_adv]

        for fetcher in fetchers:
            frame = _normalize_payload(
                fetcher(qa_code, start_date, end_date, frequence=frequency),
                requested_code,
            )
            if frame is not None and not frame.empty:
                return frame
        return None
