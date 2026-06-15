"""Strategy library API regressions."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

import api_server


def test_strategy_library_api_requires_mysql(monkeypatch) -> None:
    monkeypatch.delenv("VIBE_TRADING_MYSQL_URL", raising=False)
    monkeypatch.delenv("MYSQL_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(api_server, "_strategy_store", None)

    with pytest.raises(HTTPException) as excinfo:
        api_server._get_strategy_store()

    assert excinfo.value.status_code == 501
    assert "MySQL" in excinfo.value.detail
