"""Strategy library API regressions."""

from __future__ import annotations

import json
from types import SimpleNamespace
from datetime import datetime

import pytest
from fastapi import HTTPException

import api_server
from src.strategies.store import MySQLStrategyStore, StrategyRecord


def test_strategy_library_api_requires_mysql(monkeypatch) -> None:
    monkeypatch.delenv("VIBE_TRADING_MYSQL_URL", raising=False)
    monkeypatch.delenv("MYSQL_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(api_server, "_strategy_store", None)

    with pytest.raises(HTTPException) as excinfo:
        api_server._get_strategy_store()

    assert excinfo.value.status_code == 501
    assert "MySQL" in excinfo.value.detail


@pytest.mark.asyncio
async def test_strategy_library_api_logs_unexpected_failures(monkeypatch, caplog) -> None:
    def _boom():
        raise RuntimeError("boom")

    monkeypatch.setattr(api_server, "_get_strategy_store", _boom)
    caplog.set_level("ERROR")

    with pytest.raises(RuntimeError):
        await api_server.list_strategy_library(SimpleNamespace(user_id=123))

    assert any("Strategy library request failed" in record.message for record in caplog.records)


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


def test_strategy_store_does_not_rebuild_any_referenced_primary_key() -> None:
    cursor = _FakePrimaryKeyCursor(primary_columns=["id", "user_id"], inbound_fk_count=1)

    MySQLStrategyStore._ensure_composite_primary_key(cursor)

    assert cursor.primary_columns == ["id", "user_id"]
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


def test_strategy_store_tolerates_invalid_tags_json() -> None:
    record = MySQLStrategyStore._from_row(
        {
            "id": "broken-tags",
            "name": "Broken Tags",
            "description": "",
            "language": "python",
            "category": "trend",
            "status": "draft",
            "tags_json": "{not json",
            "code": "print('ok')",
            "created_at": datetime(2026, 6, 22, 10, 30, 0),
            "updated_at": datetime(2026, 6, 22, 10, 31, 0),
        }
    )

    assert record.tags == []


def test_strategy_record_supports_unified_language_set() -> None:
    base = {
        "id": "multi-lang",
        "name": "Multi Lang",
        "description": "",
        "category": "utility",
        "status": "draft",
        "tags": [],
        "code": "// strategy",
        "createdAt": "2026-06-22T10:30:00",
        "updatedAt": "2026-06-22T10:31:00",
    }

    for language in ["javascript", "python", "cpp", "rust", "pine"]:
        assert StrategyRecord.from_payload({**base, "language": language}).language == language


def test_strategy_record_maps_legacy_json_language_to_javascript() -> None:
    record = StrategyRecord.from_payload(
        {
            "id": "legacy-json",
            "name": "Legacy Json",
            "description": "",
            "language": "json",
            "category": "utility",
            "status": "draft",
            "tags": [],
            "code": "{}",
            "createdAt": "2026-06-22T10:30:00",
            "updatedAt": "2026-06-22T10:31:00",
        }
    )

    assert record.language == "javascript"


@pytest.mark.asyncio
async def test_publish_strategy_submits_public_snapshot_for_review(monkeypatch) -> None:
    record = StrategyRecord.from_payload(
        {
            "id": "breakout",
            "name": "Breakout",
            "description": "Breakout strategy",
            "strategyDescription": "Detailed rules",
            "language": "python",
            "category": "trend",
            "status": "draft",
            "tags": ["trend"],
            "code": "class SignalEngine:\n    def generate(self, data_map):\n        return {}\n",
            "createdAt": "2026-06-22T10:30:00",
            "updatedAt": "2026-06-22T10:31:00",
        }
    )
    captured: dict[str, object] = {}

    class FakeStore:
        def publish_strategy(self, strategy, *, user_id, backtest_summary=None, risk_warnings=None):
            captured.update(
                strategy=strategy,
                user_id=user_id,
                backtest_summary=backtest_summary,
                risk_warnings=risk_warnings,
            )
            return SimpleNamespace(
                to_dict=lambda: {
                    "publicId": "pub_test",
                    "sourceStrategyId": strategy.id,
                    "name": strategy.name,
                    "summary": strategy.description,
                    "description": strategy.description,
                    "strategyDescription": strategy.strategyDescription,
                    "language": strategy.language,
                    "category": strategy.category,
                    "tags": strategy.tags,
                    "codeSnapshot": strategy.code,
                    "reviewStatus": "submitted",
                    "publishedAt": "2026-06-22T10:32:00",
                    "updatedAt": "2026-06-22T10:32:00",
                    "backtestSummary": {},
                    "riskWarnings": risk_warnings or [],
                }
            )

    monkeypatch.setattr(api_server, "_strategy_or_404", lambda strategy_id, *, user_id: record)
    monkeypatch.setattr(api_server, "_get_strategy_store", lambda: FakeStore())

    result = await api_server.publish_strategy("breakout", SimpleNamespace(user_id=123))

    assert result["publicId"] == "pub_test"
    assert result["reviewStatus"] == "submitted"
    assert result["codeSnapshot"] == record.code
    assert captured["user_id"] == 123
    assert captured["strategy"] is record


def test_user_python_strategy_backtest_disabled_by_default(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("VIBE_TRADING_ALLOW_UNSANDBOXED_PYTHON_STRATEGIES", raising=False)
    env_path = tmp_path / ".env"
    env_path.write_text("", encoding="utf-8")
    monkeypatch.setattr(api_server, "ENV_PATH", env_path)
    record = SimpleNamespace(
        code=(
            "class SignalEngine:\n"
            "    def generate(self, data_map):\n"
            "        return {}\n"
        ),
        language="python",
    )

    with pytest.raises(HTTPException) as excinfo:
        api_server._strategy_signal_engine_code(record, "BTC-USDT")

    assert excinfo.value.status_code == 403
    assert "disabled until sandboxed execution is configured" in excinfo.value.detail


def test_user_python_strategy_backtest_enabled_from_agent_env(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("VIBE_TRADING_ALLOW_UNSANDBOXED_PYTHON_STRATEGIES", raising=False)
    env_path = tmp_path / ".env"
    env_path.write_text("VIBE_TRADING_ALLOW_UNSANDBOXED_PYTHON_STRATEGIES=1\n", encoding="utf-8")
    monkeypatch.setattr(api_server, "ENV_PATH", env_path)
    record = SimpleNamespace(
        code=(
            "class SignalEngine:\n"
            "    def generate(self, data_map):\n"
            "        return {}\n"
        ),
        language="python",
    )

    source = api_server._strategy_signal_engine_code(record, "BTC-USDT")

    assert "class SignalEngine" in source


def test_json_strategy_spec_still_builds_safe_signal_engine(monkeypatch) -> None:
    monkeypatch.delenv("VIBE_TRADING_ALLOW_UNSANDBOXED_PYTHON_STRATEGIES", raising=False)
    record = SimpleNamespace(
        code=json.dumps(
            {
                "schema": "vibe.strategy_spec.v1",
                "paper_signal": {"symbol": "BTC_USDT", "action": "BUY", "target_weight": 0.4},
            }
        ),
        language="json",
    )

    source = api_server._strategy_signal_engine_code(record, "BTC-USDT")

    assert "class SignalEngine" in source
    assert "target_weight = 0.4" in source


def test_python_strategy_syntax_error_stops_before_backtest(monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOW_UNSANDBOXED_PYTHON_STRATEGIES", "1")
    record = SimpleNamespace(
        code=(
            "class SignalEngine:\n"
            "    def generate(self, data_map)\n"
            "        return {}\n"
        ),
        language="python",
    )

    with pytest.raises(HTTPException) as excinfo:
        api_server._strategy_signal_engine_code(record, "BTC-USDT")

    assert excinfo.value.status_code == 400
    assert "Strategy code syntax error" in excinfo.value.detail
    assert "line 2" in excinfo.value.detail


@pytest.mark.asyncio
async def test_classic_turtle_personal_backtest_uses_saved_code(monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOW_UNSANDBOXED_PYTHON_STRATEGIES", "1")
    record = SimpleNamespace(
        id="classic-turtle-trading",
        code=(
            "class SignalEngine:\n"
            "    def generate(self, data_map):\n"
            "        return {}\n"
        ),
        language="python",
    )
    captured: dict[str, object] = {}

    monkeypatch.setattr(api_server, "_strategy_or_404", lambda strategy_id, *, user_id: record)

    async def fake_market_backtest(*args, **kwargs):
        raise AssertionError("personal strategy backtest must not call marketplace backtest")

    async def fake_execute_backtest_run(**kwargs):
        captured.update(kwargs)
        return api_server.StrategyMarketBacktestResponse(
            strategy_id="classic-turtle-trading",
            status="passed",
            run_id="strategy_test",
            run_directory="/tmp/strategy_test",
            symbol="BTC-USDT",
            timeframe="4H",
            period="2024-01-01 - 2024-02-01",
            totalReturnPct=1.0,
            annualizedReturnPct=12.0,
            maxDrawdownPct=2.0,
            sharpe=1.5,
            winRatePct=55.0,
            tradeCount=3,
            engine="user_strategy_backtest_v1",
            assumptions=[],
            warnings=[],
        )

    monkeypatch.setattr(api_server, "_run_marketplace_backtest", fake_market_backtest)
    monkeypatch.setattr(api_server, "_execute_backtest_run", fake_execute_backtest_run)

    result = await api_server.run_strategy_backtest(
        "classic-turtle-trading",
        api_server.StrategyBacktestRequest(
            start_date="2024-01-01",
            end_date="2024-02-01",
            symbol="BTC-USDT",
            interval="4H",
            source="okx",
            initial_capital=50000,
        ),
        SimpleNamespace(user_id=123),
    )

    assert result.run_id == "strategy_test"
    assert captured["context"] == {"user_id": 123, "strategy_id": "classic-turtle-trading"}
    assert captured["config"]["initial_cash"] == 50000.0
    assert "class SignalEngine" in str(captured["signal_code"])
