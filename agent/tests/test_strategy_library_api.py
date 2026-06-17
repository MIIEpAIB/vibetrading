"""Strategy library API regressions."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

import api_server
from src.strategies.store import MySQLStrategyStore


def test_strategy_library_api_requires_mysql(monkeypatch) -> None:
    monkeypatch.delenv("VIBE_TRADING_MYSQL_URL", raising=False)
    monkeypatch.delenv("MYSQL_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(api_server, "_strategy_store", None)

    with pytest.raises(HTTPException) as excinfo:
        api_server._get_strategy_store()

    assert excinfo.value.status_code == 501
    assert "MySQL" in excinfo.value.detail


class _FakeSchemaCursor:
    def __init__(self) -> None:
        self.columns = {"strategy_id", "tags"}
        self.statements: list[str] = []
        self._last_result: dict[str, int] = {"count": 0}

    def execute(self, sql: str, params=None) -> None:
        compact = " ".join(sql.split())
        self.statements.append(compact)
        if "information_schema.COLUMNS" in sql:
            column = params[1]
            self._last_result = {"count": 1 if column in self.columns else 0}
            return
        if "CHANGE COLUMN strategy_id id" in compact:
            self.columns.remove("strategy_id")
            self.columns.add("id")
            return
        if "CHANGE COLUMN tags tags_json" in compact:
            self.columns.remove("tags")
            self.columns.add("tags_json")

    def fetchone(self):
        return self._last_result


def test_strategy_store_migrates_legacy_schema_column_names() -> None:
    cursor = _FakeSchemaCursor()

    MySQLStrategyStore._migrate_legacy_columns(cursor)

    assert "id" in cursor.columns
    assert "tags_json" in cursor.columns
    assert any("CHANGE COLUMN strategy_id id" in statement for statement in cursor.statements)
    assert any("CHANGE COLUMN tags tags_json" in statement for statement in cursor.statements)
