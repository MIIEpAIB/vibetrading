"""Strategy library API regressions."""

from __future__ import annotations

from datetime import datetime

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


class _FakePrimaryKeyCursor:
    def __init__(self, primary_columns: list[str], inbound_fk_count: int) -> None:
        self.primary_columns = primary_columns
        self.inbound_fk_count = inbound_fk_count
        self.statements: list[str] = []
        self._last_result = []

    def execute(self, sql: str, params=None) -> None:
        compact = " ".join(sql.split())
        self.statements.append(compact)
        if "CONSTRAINT_NAME = 'PRIMARY'" in sql:
            self._last_result = [{"column_name": column} for column in self.primary_columns]
            return
        if "REFERENCED_TABLE_NAME" in sql:
            self._last_result = {"count": self.inbound_fk_count}
            return
        if "DROP PRIMARY KEY" in compact:
            self.primary_columns = []
            return
        if "ADD PRIMARY KEY" in compact:
            self.primary_columns = ["user_id", "id"]

    def fetchall(self):
        return self._last_result

    def fetchone(self):
        return self._last_result


def test_strategy_store_keeps_legacy_id_primary_key_when_referenced() -> None:
    cursor = _FakePrimaryKeyCursor(primary_columns=["id"], inbound_fk_count=1)

    MySQLStrategyStore._ensure_composite_primary_key(cursor)

    assert cursor.primary_columns == ["id"]
    assert not any("DROP PRIMARY KEY" in statement for statement in cursor.statements)


def test_strategy_store_converts_datetime_rows_to_api_strings() -> None:
    record = MySQLStrategyStore._from_row(
        {
            "id": "dual-ma",
            "name": "Dual MA",
            "description": "",
            "language": "python",
            "category": "trend",
            "status": "draft",
            "tags_json": "[]",
            "code": "print('ok')",
            "created_at": datetime(2026, 6, 22, 10, 30, 0),
            "updated_at": datetime(2026, 6, 22, 10, 31, 0),
        }
    )

    assert record.createdAt == "2026-06-22T10:30:00"
    assert record.updatedAt == "2026-06-22T10:31:00"
