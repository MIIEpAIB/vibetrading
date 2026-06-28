"""Paper trading API route regressions."""

from __future__ import annotations

from dataclasses import dataclass

import anyio
import pytest

import api_server
from src.paper_trading import InMemoryPaperTradingStore


@dataclass(frozen=True)
class _Strategy:
    id: str
    name: str
    description: str
    language: str
    category: str
    status: str
    tags: list[str]
    code: str
    createdAt: str
    updatedAt: str


class _StrategyStore:
    def __init__(self) -> None:
        self.strategy = _Strategy(
            id="json-buy",
            name="JSON Buy",
            description="",
            language="python",
            category="trend",
            status="testing",
            tags=["paper"],
            code='{"paper_signal": {"symbol": "BTC_USDT", "action": "BUY", "notional": 100, "reason": "api buy"}}',
            createdAt="2026-06-26T00:00:00Z",
            updatedAt="2026-06-26T00:00:00Z",
        )

    def list_strategies(self, user_id: int | None = None) -> list[_Strategy]:
        return [self.strategy]


def _setup(monkeypatch) -> None:
    monkeypatch.setattr(api_server, "_paper_store", InMemoryPaperTradingStore())
    monkeypatch.setattr(api_server, "_paper_service", None)
    monkeypatch.setattr(api_server, "_get_strategy_store", lambda: _StrategyStore())


def _operator_ctx() -> api_server.AuthContext:
    return api_server.AuthContext(user=None, operator=True)


def _user_ctx(user_id: int) -> api_server.AuthContext:
    return api_server.AuthContext(user=type("User", (), {"user_id": user_id})(), operator=False)


def test_paper_deployment_api_lifecycle_tick_status(monkeypatch) -> None:
    _setup(monkeypatch)
    ctx = _operator_ctx()

    async def _run() -> None:
        create = await api_server.create_paper_deployment(
            api_server.PaperDeploymentCreateRequest(
                strategy_id="json-buy",
                limits={"symbols": ["BTC_USDT"], "max_order_notional": 500, "default_order_notional": 100},
            ),
            ctx=ctx,
        )
        deployment_id = create["deployment"]["deployment_id"]

        listed = await api_server.list_paper_deployments(ctx=ctx)
        assert [item["deployment_id"] for item in listed["deployments"]] == [deployment_id]

        started = await api_server.start_paper_deployment(deployment_id, ctx=ctx)
        assert started["deployment"]["status"] == "running"

        tick = await api_server.run_paper_deployment_tick(deployment_id, ctx=ctx)
        assert tick["tick"]["outcome"] == "order_placed"

        status = await api_server.get_paper_deployment_status(deployment_id, ctx=ctx)
        assert status["deployment"]["deployment_id"] == deployment_id
        assert status["recent_signals"][0]["symbol"] == "BTC_USDT"
        assert status["recent_decisions"][0]["decision"] == "allowed"
        assert status["recent_orders"][0]["shadow_status"] == "FILLED"

        paused = await api_server.pause_paper_deployment(deployment_id, ctx=ctx)
        assert paused["deployment"]["status"] == "paused"

        archived = await api_server.archive_paper_deployment(deployment_id, ctx=ctx)
        assert archived["deployment"]["status"] == "archived"

    anyio.run(_run)


def test_paper_deployment_api_rejects_missing_strategy(monkeypatch) -> None:
    _setup(monkeypatch)

    async def _run() -> None:
        with pytest.raises(api_server.HTTPException) as excinfo:
            await api_server.create_paper_deployment(
                api_server.PaperDeploymentCreateRequest(
                    strategy_id="missing",
                    limits={"symbols": ["BTC_USDT"]},
                ),
                ctx=_operator_ctx(),
            )
        assert excinfo.value.status_code == 404

    anyio.run(_run)


def test_paper_deployment_api_denies_cross_user_access(monkeypatch) -> None:
    _setup(monkeypatch)

    async def _run() -> None:
        create = await api_server.create_paper_deployment(
            api_server.PaperDeploymentCreateRequest(strategy_id="json-buy", limits={"symbols": ["BTC_USDT"]}),
            ctx=_operator_ctx(),
        )
        deployment_id = create["deployment"]["deployment_id"]

        with pytest.raises(api_server.HTTPException) as excinfo:
            await api_server.get_paper_deployment_status(deployment_id, ctx=_user_ctx(42))
        assert excinfo.value.status_code == 404

    anyio.run(_run)
