"""Paper trading API route regressions."""

from __future__ import annotations

import anyio
import pytest

import api_server


def _user_ctx(user_id: int) -> api_server.AuthContext:
    return api_server.AuthContext(user=type("User", (), {"user_id": user_id})(), operator=False)


def test_legacy_paper_deployment_api_is_removed() -> None:
    assert not hasattr(api_server, "create_paper_deployment")
    assert not hasattr(api_server, "list_paper_deployments")
    assert not hasattr(api_server, "start_paper_deployment")
    assert not hasattr(api_server, "run_paper_deployment_tick")
    assert not hasattr(api_server, "get_paper_deployment_status")


def test_legacy_shadow_trading_routes_are_gone() -> None:
    ctx = _user_ctx(7)

    async def _run() -> None:
        calls = [
            api_server.get_shadow_account(ctx=ctx),
            api_server.list_shadow_orders(ctx=ctx),
            api_server.place_shadow_order(
                api_server.ShadowPlaceOrderRequest(symbol="BTC_USDT", side="BUY", quantity=1),
                ctx=ctx,
            ),
            api_server.cancel_shadow_order("legacy-order", ctx=ctx),
            api_server.reset_shadow_account(ctx=ctx),
        ]
        for call in calls:
            with pytest.raises(api_server.HTTPException) as exc_info:
                await call
            assert exc_info.value.status_code == 410
            assert "use /api/deployments" in str(exc_info.value.detail)

    anyio.run(_run)
