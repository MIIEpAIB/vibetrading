"""Application-user auth API helpers."""

from __future__ import annotations

from types import SimpleNamespace

import api_server
import pytest


def test_operator_api_key_short_circuits_user_token_lookup(monkeypatch) -> None:
    """A valid operator key must not be treated as a user token first."""

    request = SimpleNamespace(client=SimpleNamespace(host="203.0.113.10"), headers={})
    cred = SimpleNamespace(credentials="operator-secret")

    monkeypatch.setattr(api_server, "_configured_api_key", lambda: "operator-secret")

    def fail_user_lookup(_token: str):
        raise AssertionError("operator key should not hit the user auth store")

    monkeypatch.setattr(api_server, "_resolve_user_from_token", fail_user_lookup)

    ctx = api_server._resolve_auth_context(request=request, cred=cred)

    assert ctx.operator is True
    assert ctx.user is None


def test_admin_summary_counts_usage_rows() -> None:
    users = [
        SimpleNamespace(user_id=1, username="alice", display_name="Alice", created_at="2026-01-01"),
        SimpleNamespace(user_id=2, username="bob", display_name="Bob", created_at="2026-01-02"),
    ]
    rows = [
        api_server.AdminUserUsageRow(
            user_id=1,
            session_count=2,
            message_count=5,
            attempt_count=3,
            running_attempt_count=1,
            failed_attempt_count=1,
            completed_attempt_count=1,
            strategy_count=4,
        ),
        api_server.AdminUserUsageRow(user_id=2, session_count=1, message_count=2, attempt_count=1, completed_attempt_count=1),
    ]

    summary = api_server._admin_summary(users, rows)

    assert summary.total_users == 2
    assert summary.total_sessions == 3
    assert summary.total_messages == 7
    assert summary.total_attempts == 4
    assert summary.running_attempts == 1
    assert summary.failed_attempts == 1
    assert summary.completed_attempts == 2
    assert summary.total_strategies == 4


def test_strategy_market_admin_config_roundtrip(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(api_server, "STRATEGY_MARKET_ADMIN_PATH", tmp_path / "market.json")
    items = [
        api_server.StrategyMarketAdminItem(
            id="crypto-trend-momentum",
            kind="built-in",
            enabled=False,
            featured=True,
            status="hidden",
            price="",
            note="temporarily hidden",
        ),
        api_server.StrategyMarketAdminItem(
            id="binance-perp-funding-arbitrage",
            kind="paid",
            enabled=True,
            featured=False,
            status="published",
            price="80 USD/30 days",
            note="",
        ),
    ]

    saved = api_server._save_strategy_market_admin_items(items)
    loaded = api_server._load_strategy_market_admin_items()

    assert [item.id for item in saved] == [item.id for item in loaded]
    assert loaded[0].enabled is False
    assert loaded[0].status == "hidden"
    assert loaded[1].price == "80 USD/30 days"


def test_strategy_market_admin_response_includes_full_builtin_catalog(monkeypatch) -> None:
    monkeypatch.setattr(api_server, "_load_strategy_market_admin_items", lambda: [])
    monkeypatch.setattr(
        api_server,
        "_get_strategy_store",
        lambda: (_ for _ in ()).throw(RuntimeError("store unavailable")),
    )

    items = api_server._load_strategy_market_admin_response_items()

    assert len(items) == 20
    assert items[0].id == "quantclaw-ai-assistant"
    assert items[3].id == "classic-turtle-trading"
    assert items[-1].id == "perp-multi-symbol-balance"
    assert all(item.enabled and item.status == "published" for item in items)


def test_professional_grid_builtin_details_are_available_to_admin(monkeypatch) -> None:
    monkeypatch.setattr(api_server, "_load_strategy_market_admin_items", lambda: [])
    monkeypatch.setattr(
        api_server,
        "_get_strategy_store",
        lambda: (_ for _ in ()).throw(RuntimeError("store unavailable")),
    )

    item = next(
        item
        for item in api_server._load_strategy_market_admin_response_items()
        if item.id == "professional-grid-trading"
    )

    assert item.language == "python"
    assert item.category == "grid"
    assert item.strategy_description
    assert item.code_snapshot
    assert "CryptoAdvancedGrid" in item.code_snapshot or "SignalEngine" in item.code_snapshot


@pytest.mark.asyncio
async def test_admin_delete_strategy_market_item_removes_public_record(monkeypatch) -> None:
    class FakeStore:
        def __init__(self) -> None:
            self.deleted_ids: list[str] = []

        def delete_public_strategy(self, public_id: str) -> bool:
            self.deleted_ids.append(public_id)
            return public_id == "pub_123"

    store = FakeStore()
    monkeypatch.setattr(api_server, "_get_strategy_store", lambda: store)
    monkeypatch.setattr(api_server, "_load_strategy_market_admin_response_items", lambda: [])

    response = await api_server.delete_admin_strategy_market("pub_123")

    assert store.deleted_ids == ["pub_123"]
    assert response == {"items": []}


@pytest.mark.asyncio
async def test_admin_delete_strategy_market_item_persists_builtin_delete(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(api_server, "STRATEGY_MARKET_ADMIN_PATH", tmp_path / "market.json")
    monkeypatch.setattr(
        api_server,
        "_get_strategy_store",
        lambda: (_ for _ in ()).throw(api_server.HTTPException(status_code=501)),
    )

    response = await api_server.delete_admin_strategy_market("classic-turtle-trading")

    assert response["items"]
    assert all(item.id != "classic-turtle-trading" for item in response["items"])
    saved = api_server._load_strategy_market_admin_items()
    deleted = next(item for item in saved if item.id == "classic-turtle-trading")
    assert deleted.deleted is True
    assert deleted.status == "archived"
