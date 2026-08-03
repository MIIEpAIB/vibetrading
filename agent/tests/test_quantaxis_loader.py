"""Tests for the local QUANTAXIS OHLCV loader."""

from __future__ import annotations

import sys
from types import SimpleNamespace

import pandas as pd
import pytest

from backtest.loaders.quantaxis_loader import DataLoader, _normalize_payload, _qa_symbol


def test_qa_symbol_strips_common_a_share_suffixes() -> None:
    assert _qa_symbol("000001.SZ") == "000001"
    assert _qa_symbol("600519.SH") == "600519"
    assert _qa_symbol("835174.BJ") == "835174"
    assert _qa_symbol("rb2510") == "RB2510"


def test_normalize_payload_accepts_datastruct_like_object() -> None:
    raw = pd.DataFrame(
        {
            "date": ["2025-01-02", "2025-01-03"],
            "code": ["000001", "000001"],
            "open": [10.0, 10.2],
            "high": [10.5, 10.4],
            "low": [9.9, 10.0],
            "close": [10.3, 10.1],
            "vol": [1000, 1200],
        }
    )
    payload = SimpleNamespace(data=raw)

    out = _normalize_payload(payload, "000001.SZ")

    assert out is not None
    assert list(out.columns) == ["open", "high", "low", "close", "volume"]
    assert out.index.name == "trade_date"
    assert out.iloc[0]["volume"] == pytest.approx(1000)


def test_fetch_daily_uses_quantaxis_stock_fetcher(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple] = []

    def stock_day(code: str, start: str, end: str):
        calls.append(("stock_day", code, start, end))
        return SimpleNamespace(
            data=pd.DataFrame(
                {
                    "date": ["2025-01-02"],
                    "code": [code],
                    "open": [10.0],
                    "high": [10.5],
                    "low": [9.8],
                    "close": [10.2],
                    "volume": [1000],
                }
            )
        )

    qa_module = SimpleNamespace(
        QA_fetch_stock_day_adv=stock_day,
        QA_fetch_index_day_adv=lambda *args, **kwargs: None,
        QA_fetch_future_day_adv=lambda *args, **kwargs: None,
        QA_fetch_cryptocurrency_day_adv=lambda *args, **kwargs: None,
        QA_fetch_stock_min_adv=lambda *args, **kwargs: None,
        QA_fetch_index_min_adv=lambda *args, **kwargs: None,
        QA_fetch_future_min_adv=lambda *args, **kwargs: None,
        QA_fetch_cryptocurrency_min_adv=lambda *args, **kwargs: None,
    )
    monkeypatch.setitem(sys.modules, "QUANTAXIS", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "QUANTAXIS.QAFetch", SimpleNamespace(QAQuery_Advance=qa_module))
    monkeypatch.setitem(sys.modules, "QUANTAXIS.QAFetch.QAQuery_Advance", qa_module)

    out = DataLoader().fetch(["000001.SZ"], "2025-01-01", "2025-01-10")

    assert "000001.SZ" in out
    assert calls == [("stock_day", "000001", "2025-01-01", "2025-01-10")]
    assert out["000001.SZ"].iloc[0]["close"] == pytest.approx(10.2)


def test_fetch_intraday_maps_interval_to_quantaxis_frequency(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple] = []

    def stock_min(code: str, start: str, end: str, frequence: str):
        calls.append(("stock_min", code, frequence))
        return SimpleNamespace(
            data=pd.DataFrame(
                {
                    "datetime": ["2025-01-02 10:00:00"],
                    "code": [code],
                    "open": [10.0],
                    "high": [10.5],
                    "low": [9.8],
                    "close": [10.2],
                    "volume": [1000],
                }
            )
        )

    qa_module = SimpleNamespace(
        QA_fetch_stock_day_adv=lambda *args, **kwargs: None,
        QA_fetch_index_day_adv=lambda *args, **kwargs: None,
        QA_fetch_future_day_adv=lambda *args, **kwargs: None,
        QA_fetch_cryptocurrency_day_adv=lambda *args, **kwargs: None,
        QA_fetch_stock_min_adv=stock_min,
        QA_fetch_index_min_adv=lambda *args, **kwargs: None,
        QA_fetch_future_min_adv=lambda *args, **kwargs: None,
        QA_fetch_cryptocurrency_min_adv=lambda *args, **kwargs: None,
    )
    monkeypatch.setitem(sys.modules, "QUANTAXIS", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "QUANTAXIS.QAFetch", SimpleNamespace(QAQuery_Advance=qa_module))
    monkeypatch.setitem(sys.modules, "QUANTAXIS.QAFetch.QAQuery_Advance", qa_module)

    out = DataLoader().fetch(["000001.SZ"], "2025-01-01", "2025-01-10", interval="1H")

    assert "000001.SZ" in out
    assert calls == [("stock_min", "000001", "60min")]


def test_registry_lists_quantaxis_as_a_share_first_choice() -> None:
    from backtest.loaders.registry import FALLBACK_CHAINS, LOADER_REGISTRY, VALID_SOURCES, _ensure_registered

    _ensure_registered()
    assert "quantaxis" in VALID_SOURCES
    assert "quantaxis" in LOADER_REGISTRY
    assert FALLBACK_CHAINS["a_share"][0] == "quantaxis"
