"""Application-user auth API helpers."""

from __future__ import annotations

from types import SimpleNamespace

import api_server


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
