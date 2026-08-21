"""Paper strategy deployment service tests."""

from __future__ import annotations

from dataclasses import dataclass

import anyio
import pytest

from src.paper_trading import InMemoryPaperTradingStore, PaperTradingError, PaperTradingService
from src.shadow_trading import ShadowTradingService, WalletManager, VirtualMatchingEngine


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
    def __init__(self, strategies: list[_Strategy]) -> None:
        self.strategies = strategies

    def list_strategies(self, user_id: int | None = None) -> list[_Strategy]:
        return list(self.strategies)


def _service(code: str) -> PaperTradingService:
    shadow = ShadowTradingService(
        wallet_manager=WalletManager(),
        engine=VirtualMatchingEngine(WalletManager()),
    )
    # Keep wallet manager and engine aligned for settlement.
    wallet = WalletManager()
    shadow = ShadowTradingService(wallet_manager=wallet, engine=VirtualMatchingEngine(wallet))
    strategy = _Strategy(
        id="json-buy",
        name="JSON Buy",
        description="",
        language="python",
        category="trend",
        status="testing",
        tags=["paper"],
        code=code,
        createdAt="2026-06-26T00:00:00Z",
        updatedAt="2026-06-26T00:00:00Z",
    )
    return PaperTradingService(
        store=InMemoryPaperTradingStore(),
        strategy_store=_StrategyStore([strategy]),
        shadow_service=shadow,
    )


def _buy_spec(symbol: str = "BTC_USDT", notional: float = 250.0) -> str:
    return (
        "{"
        f'"shadow_signal": {{"symbol": "{symbol}", "action": "BUY", '
        f'"notional": {notional}, "reason": "test buy"}}'
        "}"
    )


def _run_tick(svc: PaperTradingService, deployment_id: str, *, user_id: int) -> dict:
    async def _inner() -> dict:
        return await svc.run_tick(deployment_id, user_id=user_id)

    return anyio.run(_inner)


def test_create_deployment_validates_limits() -> None:
    svc = _service(_buy_spec())

    with pytest.raises(ValueError, match="max_order_notional"):
        svc.create_deployment(
            user_id=7,
            strategy_id="json-buy",
            limits_payload={"symbols": ["BTC_USDT"], "max_order_notional": 0},
        )


def test_lifecycle_transitions_and_user_isolation() -> None:
    svc = _service(_buy_spec())
    deployment = svc.create_deployment(
        user_id=7,
        strategy_id="json-buy",
        limits_payload={"symbols": ["BTC_USDT"]},
    )

    assert deployment.status == "draft"
    assert svc.set_status(deployment.deployment_id, user_id=7, action="start").status == "running"
    assert svc.set_status(deployment.deployment_id, user_id=7, action="pause").status == "paused"

    with pytest.raises(PaperTradingError, match="not found"):
        svc.get_deployment(deployment.deployment_id, user_id=8)


def test_tick_records_signal_decision_order_link() -> None:
    svc = _service(_buy_spec(notional=250.0))
    deployment = svc.create_deployment(
        user_id=7,
        strategy_id="json-buy",
        limits_payload={"symbols": ["BTC_USDT"], "max_order_notional": 500, "default_order_notional": 100},
    )
    svc.set_status(deployment.deployment_id, user_id=7, action="start")

    result = _run_tick(svc, deployment.deployment_id, user_id=7)

    assert result["tick"]["outcome"] == "order_placed"
    assert result["signal"]["action"] == "BUY"
    assert result["decision"]["decision"] == "allowed"
    assert result["order_link"]["shadow_status"] == "FILLED"


def test_broker_paper_execution_mode_is_removed() -> None:
    svc = _service(_buy_spec())

    with pytest.raises(PaperTradingError, match="execution_mode must be shadow"):
        svc.create_deployment(
            user_id=7,
            strategy_id="json-buy",
            limits_payload={"symbols": ["BTC_USDT"]},
            execution_mode="broker_paper",
            connector_profile_id="binance-live-trade",
        )


def test_tick_rejects_risk_breach_before_order() -> None:
    svc = _service(_buy_spec(notional=750.0))
    deployment = svc.create_deployment(
        user_id=7,
        strategy_id="json-buy",
        limits_payload={"symbols": ["BTC_USDT"], "max_order_notional": 500, "default_order_notional": 100},
    )
    svc.set_status(deployment.deployment_id, user_id=7, action="start")

    result = _run_tick(svc, deployment.deployment_id, user_id=7)

    assert result["tick"]["outcome"] == "rejected"
    assert result["decision"]["breached_limit"] == "max_order_notional"
    assert result["order_link"] is None


def test_tick_rejects_missing_price_without_order() -> None:
    svc = _service(_buy_spec(symbol="ABC_USDT", notional=100.0))
    deployment = svc.create_deployment(
        user_id=7,
        strategy_id="json-buy",
        limits_payload={"symbols": ["ABC_USDT"], "max_order_notional": 500, "default_order_notional": 100},
    )
    svc.set_status(deployment.deployment_id, user_id=7, action="start")

    result = _run_tick(svc, deployment.deployment_id, user_id=7)

    assert result["tick"]["outcome"] == "rejected"
    assert result["decision"]["breached_limit"] == "price"
    assert result["order_link"] is None


def test_unsupported_strategy_package_fails_without_order() -> None:
    svc = _service("def generate_signals(data): return 1")
    deployment = svc.create_deployment(
        user_id=7,
        strategy_id="json-buy",
        limits_payload={"symbols": ["BTC_USDT"]},
    )
    svc.set_status(deployment.deployment_id, user_id=7, action="start")

    result = _run_tick(svc, deployment.deployment_id, user_id=7)

    assert result["tick"]["outcome"] == "failed"
    assert "unsupported strategy package" in result["tick"]["reason"]
