from __future__ import annotations

import os
import threading

from dataclasses import replace

import pytest

from src.quantaxis_native.adapters import (
    QifiProjectionAdapter,
    QuantaxisDurableStoreConfig,
    QuantaxisEngineAdapter,
    QuantaxisPubSubAdapter,
    QuantaxisShadowExecutionAdapter,
    BrokerLiveExecutionAdapter,
)
from src.quantaxis_native.loader import load_quantaxis_modules, runtime_status
from src.quantaxis_native.migration import migrate_quantaxis_native_metadata
from src.quantaxis_native.models import DeploymentStatus, DeploymentTarget, QuantaxisDeployment, StrategyVersionSnapshot
from src.quantaxis_native.service import QuantaxisDeploymentService, QuantaxisTradingError
from src.quantaxis_native.strategy_runtime import QuantaxisStrategyRuntimeError, RestrictedQAStrategyRuntime


def test_quantaxis_native_modules_load_without_top_level_side_effects(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("QUANTAXIS_PATH", "/opt/QUANTAXIS")
    monkeypatch.setenv("VIBE_QUANTAXIS_HOME", str(tmp_path))

    modules = load_quantaxis_modules()

    assert modules.version.startswith("2.1.0")
    assert modules.market_preset
    assert modules.strategy_cta_base is not None
    assert callable(modules.publisher_topic)
    assert callable(modules.subscriber_topic)
    market_order = modules.order(
        price=100,
        amount=1,
        code="BTCUSDT",
        account_cookie="qa-test",
        user_cookie="qa-test",
        towards=1,
        order_id="qa-order-1",
    )
    assert market_order.code == "BTCUSDT"
    assert market_order.account_cookie == "qa-test"
    account = modules.qifi_account(
        username="qa-test",
        password="qa-test",
        init_cash=100_000,
        nodatabase=True,
    )
    account.initial()
    assert account.balance == 100_000
    assert account.message["account_cookie"] == "qa-test"
    order_msg = account.send_order(
        code="BTCUSDT",
        amount=1,
        price=100,
        towards=1,
        order_id="qa-qifi-order-1",
        datetime="2026-08-20 00:00:00",
    )
    assert order_msg["order_id"] == "qa-qifi-order-1"
    assert account.available < 100_000
    assert account.open_orders

    class Worker(modules.qa_worker):
        def run(self, event):
            return {"event_type": event.event_type, "message": event.message}

    task = modules.qa_task(Worker(), modules.qa_event(event_type="qa.test", message={"ok": True}))
    task.do()
    assert task.result["result"] == {"event_type": "qa.test", "message": {"ok": True}}
    assert modules.publisher_topic.__name__ == "publisher_topic"
    assert modules.subscriber_topic.__name__ == "subscriber_topic"


def test_quantaxis_runtime_imports_zenlog_compatibility_shim(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("QUANTAXIS_PATH", "/opt/QUANTAXIS")
    monkeypatch.setenv("VIBE_QUANTAXIS_HOME", str(tmp_path))

    modules = load_quantaxis_modules()

    assert modules.qa_event is not None


def test_zenlog_shim_exports_log_object() -> None:
    from zenlog import log

    assert hasattr(log, "info")
    assert hasattr(log, "warning")
    assert hasattr(log, "level")


def test_motor_shim_exports_motor_asyncio_client() -> None:
    from motor import MotorClient
    from motor.motor_asyncio import AsyncIOMotorClient

    assert MotorClient is not None
    assert AsyncIOMotorClient is not None


def test_qaenv_shim_exports_connection_defaults() -> None:
    from qaenv import clickhouse_ip, eventmq_amqp, mongo_ip, mongo_uri

    assert mongo_ip
    assert mongo_uri.startswith("mongodb://")
    assert eventmq_amqp.startswith("pyamqp://")
    assert clickhouse_ip


def test_clickhouse_driver_shim_exports_client_and_helpers() -> None:
    from clickhouse_driver import Client
    from clickhouse_driver.util.helpers import column_chunks

    assert Client is not None
    assert list(column_chunks([1, 2, 3], 2)) == [[1, 2], [3]]


def test_empyrical_imports() -> None:
    import empyrical

    assert empyrical is not None


def test_empyrical_shim_exports_common_metrics() -> None:
    import empyrical

    assert hasattr(empyrical, "sharpe_ratio")
    assert hasattr(empyrical, "max_drawdown")
    assert hasattr(empyrical, "cum_returns")


def test_empyrical_utils_shim_exports_default_returns_func() -> None:
    from empyrical import utils

    assert hasattr(utils, "default_returns_func")


def test_empyrical_shim_exports_pyfolio_surface() -> None:
    import empyrical

    assert hasattr(empyrical, "calmar_ratio")
    assert hasattr(empyrical, "downside_risk")
    assert hasattr(empyrical, "aggregate_returns")


def test_pyfolio_shim_exports_perf_helpers() -> None:
    import pyfolio

    assert hasattr(pyfolio, "show_perf_stats")
    assert hasattr(pyfolio, "create_returns_tear_sheet")


def test_janus_imports() -> None:
    import janus

    assert hasattr(janus, "Queue")


def test_janus_shim_queue_has_async_side() -> None:
    from janus import Queue

    q = Queue()
    assert hasattr(q, "async_q")


def test_async_timeout_shim_imports() -> None:
    import async_timeout

    assert hasattr(async_timeout, "timeout")


def test_pika_shim_exports_connection_bits() -> None:
    import pika

    assert hasattr(pika, "BlockingConnection")
    assert hasattr(pika, "PlainCredentials")


def test_quantaxis_loader_redirects_home_to_runtime_dir(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("QUANTAXIS_PATH", "/opt/QUANTAXIS")
    monkeypatch.setenv("VIBE_QUANTAXIS_HOME", str(tmp_path))
    monkeypatch.setenv("HOME", "/root")

    from src.quantaxis_native.loader import ensure_quantaxis_namespace

    ensure_quantaxis_namespace()

    assert str(tmp_path) == os.environ["HOME"]


def test_runtime_status_reports_available(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("QUANTAXIS_PATH", "/opt/QUANTAXIS")
    monkeypatch.setenv("VIBE_QUANTAXIS_HOME", str(tmp_path))

    status = runtime_status()

    assert status["available"] is True
    assert status["modules"]["QIFI"] is True
    assert status["modules"]["QAEngine"] is True


def test_deployment_service_creates_immutable_snapshot_and_promotes() -> None:
    store = _MemoryDeploymentStore()
    service = QuantaxisDeploymentService(store=store, strategy_store=_StrategyStore())

    shadow = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=None,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={"fast": 20},
        risk_policy={"max_order_notional": 100},
    )
    assert shadow.target == DeploymentTarget.SHADOW
    assert shadow.status == DeploymentStatus.DRAFT
    assert shadow.strategy_snapshot.version_no == 2
    assert shadow.strategy_snapshot.parameter_schema == {"fast": {"type": "integer"}}
    assert shadow.account_cookie.startswith("qa:shadow:7:")

    ready = service.set_status(shadow.deployment_id, user_id=7, action="ready")
    assert ready.status == DeploymentStatus.READY
    assert store.events[-1]["event_type"] == "deployment.ready"
    assert store.events[-1]["sequence_no"] == 1
    store.update(replace(ready, status=DeploymentStatus.STOPPED))

    live = service.promote_to_live(
        shadow.deployment_id,
        user_id=7,
        broker_binding_id=99,
        risk_policy={"max_order_notional": 50},
    )
    assert live.target == DeploymentTarget.LIVE
    assert live.strategy_snapshot.version_id == shadow.strategy_snapshot.version_id
    assert live.account_cookie.startswith("qa:live:7:")
    assert store.promotions[0]["source_deployment_id"] == shadow.deployment_id
    assert store.promotions[0]["target_deployment_id"] == live.deployment_id

    duplicate = store.append_runtime_event(
        event_id="qaevt_duplicate",
        deployment_id=shadow.deployment_id,
        account_cookie=shadow.account_cookie,
        event_scope="deployment",
        event_type="deployment.ready",
        idempotency_key=store.events[-1]["idempotency_key"],
        payload={"ignored": True},
        created_at="2026-08-20T00:00:00Z",
    )
    assert duplicate["event_id"] == store.events[-1]["event_id"]


def test_deployment_rejects_strategy_that_mutates_account_boundary() -> None:
    service = QuantaxisDeploymentService(store=_MemoryDeploymentStore(), strategy_store=_UnsafeStrategyStore())

    with pytest.raises(QuantaxisTradingError, match="account mutation API"):
        service.create_deployment(
            user_id=7,
            strategy_id="s1",
            target="SHADOW",
            version_no=2,
            market="crypto",
            symbols=["BTC-USDT"],
            timeframe="1h",
            parameters={},
            risk_policy={"initial_cash": 100000},
        )


def test_deployment_adapts_ccxt_script_to_signal_engine_snapshot() -> None:
    service = QuantaxisDeploymentService(store=_MemoryDeploymentStore(), strategy_store=_CcxtScriptStrategyStore())

    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={"reference_price": 100, "grid_step_percent": 0.01},
        risk_policy={"initial_cash": 100000},
    )

    assert "class SignalEngine" in deployment.strategy_snapshot.code
    assert "import ccxt" not in deployment.strategy_snapshot.code
    assert deployment.strategy_snapshot.code_sha256


def test_restricted_runtime_still_blocks_direct_ccxt_import() -> None:
    runtime = RestrictedQAStrategyRuntime()

    with pytest.raises(QuantaxisStrategyRuntimeError, match="outside restricted runtime: ccxt"):
        runtime.validate_package("import ccxt\nclass SignalEngine:\n    def generate_signal(self, context):\n        return {'action': 'HOLD'}\n")


def test_deployment_signals_run_through_restricted_qastrategy_runtime(monkeypatch) -> None:
    monkeypatch.setattr("src.quantaxis_native.service.runtime_status", lambda: {"available": True})
    monkeypatch.setattr("src.quantaxis_native.service.load_quantaxis_modules", lambda: object())

    class FakeQAStrategyBase:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

    class FakeModules:
        strategy_cta_base = FakeQAStrategyBase

    monkeypatch.setattr("src.quantaxis_native.strategy_runtime.load_quantaxis_modules", lambda: FakeModules)
    store = _MemoryDeploymentStore()
    service = QuantaxisDeploymentService(
        store=store,
        strategy_store=_QAStrategyStore(),
        qifi_adapter=_FakeQifiAdapter(),
        pubsub_adapter=_NoopPubSub(),
        strategy_runtime=RestrictedQAStrategyRuntime(),
    )
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )

    result = service.deployment_signals(
        deployment.deployment_id,
        user_id=7,
        market_event={"event_id": "bar-1", "symbol": "BTC_USDT", "close": 101, "datetime": "2026-08-20 09:30:00"},
    )

    signal = result["signals"][0]
    assert signal["strategy_contract"] == "QAStrategy"
    assert signal["intent"]["symbol"] == "BTC_USDT"
    assert signal["intent"]["side"] == "BUY"
    assert signal["intent"]["price"] == 101.0
    assert any(event["event_scope"] == "signal" and event["event_type"] == "strategy.signal" for event in store.events)


def test_live_deployment_requires_broker_binding() -> None:
    service = QuantaxisDeploymentService(store=_MemoryDeploymentStore(), strategy_store=_StrategyStore())
    with pytest.raises(QuantaxisTradingError, match="broker_binding_id"):
        service.create_deployment(
            user_id=7,
            strategy_id="s1",
            target="LIVE",
            version_no=2,
            market="crypto",
            symbols=["BTC-USDT"],
            timeframe="1h",
            parameters={},
            risk_policy={},
        )


def test_migration_imports_eligible_paper_and_live_metadata_once() -> None:
    store = _MemoryDeploymentStore()
    paper = {
        "deployment_id": "paper-1",
        "user_id": 7,
        "status": "running",
        "strategy_id": "s1",
        "limits": {"symbols": ["BTC-USDT"], "max_order_notional": 500, "timeframe": "5m"},
        "created_at": "2026-08-19T00:00:00Z",
        "updated_at": "2026-08-19T00:05:00Z",
        "started_at": "2026-08-19T00:01:00Z",
    }
    live = {
        "deployment_id": "live-1",
        "user_id": 7,
        "status": "paused",
        "strategy_id": "s1",
        "broker": "robinhood",
        "broker_binding_id": 99,
        "limits": {"symbols": ["ETH/USDT"], "max_order_notional": 100},
        "interval_seconds": 60,
        "created_at": "2026-08-19T01:00:00Z",
        "updated_at": "2026-08-19T01:05:00Z",
    }
    archived = {**paper, "deployment_id": "paper-archived", "status": "archived"}

    report = migrate_quantaxis_native_metadata(
        strategy_store=_StrategyStore(),
        deployment_store=store,
        paper_deployments=[paper, archived],
        live_deployments=[live],
    )
    duplicate = migrate_quantaxis_native_metadata(
        strategy_store=_StrategyStore(),
        deployment_store=store,
        paper_deployments=[paper],
        live_deployments=[live],
    )

    migrated_paper = store.items["qadep:migrated:paper:paper-1"]
    migrated_live = store.items["qadep:migrated:live:live-1"]
    assert report.to_dict()["paper_migrated"] == 1
    assert report.to_dict()["live_migrated"] == 1
    assert report.skipped == [{"source": "paper", "id": "paper-archived", "reason": "archived legacy deployment"}]
    assert duplicate.paper_migrated == 0
    assert duplicate.live_migrated == 0
    assert len(store.items) == 2
    assert migrated_paper.target == DeploymentTarget.SHADOW
    assert migrated_paper.status == DeploymentStatus.RECOVERY_REQUIRED
    assert migrated_paper.recovery_reason.startswith("migrated running paper")
    assert migrated_paper.symbols == ("BTC_USDT",)
    assert migrated_paper.timeframe == "5m"
    assert migrated_paper.risk_policy["max_order_notional"] == 500
    assert migrated_live.target == DeploymentTarget.LIVE
    assert migrated_live.status == DeploymentStatus.PAUSED
    assert migrated_live.broker_binding_id == 99
    assert migrated_live.symbols == ("ETH_USDT",)
    assert migrated_live.risk_policy["legacy_broker"] == "robinhood"


def test_migration_skips_legacy_deployment_without_immutable_strategy_version() -> None:
    class EmptyStrategyStore:
        def list_strategy_versions(self, strategy_id: str, user_id: int | None = None):
            return []

    store = _MemoryDeploymentStore()

    report = migrate_quantaxis_native_metadata(
        strategy_store=EmptyStrategyStore(),
        deployment_store=store,
        paper_deployments=[
            {
                "deployment_id": "paper-1",
                "user_id": 7,
                "status": "draft",
                "strategy_id": "missing",
                "limits": {"symbols": ["BTC-USDT"]},
            }
        ],
    )

    assert report.paper_seen == 1
    assert report.paper_migrated == 0
    assert report.skipped == [{"source": "paper", "id": "paper-1", "reason": "strategy has no immutable version"}]
    assert store.items == {}


def test_migration_backfills_strategy_versions_before_deployments() -> None:
    class BackfillingStrategyStore(_StrategyStore):
        def __init__(self) -> None:
            self.backfilled = 0

        def ensure_current_strategy_versions(self) -> int:
            self.backfilled += 1
            return 3

    strategy_store = BackfillingStrategyStore()

    report = migrate_quantaxis_native_metadata(
        strategy_store=strategy_store,
        deployment_store=_MemoryDeploymentStore(),
        paper_deployments=[
            {
                "deployment_id": "paper-1",
                "user_id": 7,
                "status": "draft",
                "strategy_id": "s1",
                "limits": {"symbols": ["BTC-USDT"]},
            }
        ],
    )

    assert strategy_store.backfilled == 1
    assert report.strategies_versioned == 3
    assert report.paper_migrated == 1


def test_startup_recovery_marks_ambiguous_running_deployment(monkeypatch) -> None:
    monkeypatch.delenv("QUANTAXIS_MONGOURI", raising=False)
    monkeypatch.delenv("MONGOURI", raising=False)
    monkeypatch.delenv("MONGODB", raising=False)
    service = QuantaxisDeploymentService(store=_MemoryDeploymentStore(), strategy_store=_StrategyStore())
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={},
    )
    service.store.update(replace(deployment, status=DeploymentStatus.RUNNING))

    result = service.recover_startup(worker_id="worker-1")

    recovered = service.get_deployment(deployment.deployment_id, user_id=7)
    assert result == {"checked": 1, "recovery_required": 1, "resumed": 0}
    assert recovered.status == DeploymentStatus.RECOVERY_REQUIRED
    assert "durable store" in recovered.recovery_reason
    assert service.store.events[-1]["event_type"] == "deployment.recovery_required"


def test_startup_recovery_rehydrates_shadow_and_restores_task(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.quantaxis_native.service.runtime_status",
        lambda: {
            "available": True,
            "requires": {"mongo": "mongodb://mongo:27017", "qifi_password": "configured"},
        },
    )
    store = _MemoryDeploymentStore()
    engine = _FakeEngineAdapter()
    qifi = _FakeQifiAdapter()
    service = QuantaxisDeploymentService(
        store=store,
        strategy_store=_StrategyStore(),
        qifi_adapter=qifi,
        pubsub_adapter=_NoopPubSub(),
        engine_adapter=engine,
    )
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )
    store.update(replace(deployment, status=DeploymentStatus.RUNNING))
    store.save_event_offset(
        deployment_id=deployment.deployment_id,
        consumer_name="worker:tick",
        event_scope="market",
        last_event_id="bar-9",
        last_sequence_no=9,
        updated_at="2026-08-20T00:00:00Z",
    )

    result = service.recover_startup(worker_id="worker-1")

    recovered = service.get_deployment(deployment.deployment_id, user_id=7)
    recovery_events = [event for event in store.events if event["event_scope"] == "recovery"]
    assert result == {"checked": 1, "recovery_required": 0, "resumed": 1}
    assert recovered.status == DeploymentStatus.RUNNING
    assert engine.registered[0]["deployment_id"] == deployment.deployment_id
    assert store.tasks["qrtask:" + deployment.deployment_id + ":tick"]["status"] == "registered"
    assert recovery_events[-1]["payload"]["open_orders"] == 1
    assert recovery_events[-1]["payload"]["market_offset"]["last_event_id"] == "bar-9"
    assert any(event["event_type"] == "deployment.recovered" for event in store.events)


def test_startup_recovery_requires_action_when_qifi_rehydrate_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.quantaxis_native.service.runtime_status",
        lambda: {
            "available": True,
            "requires": {"mongo": "mongodb://mongo:27017", "qifi_password": "configured"},
        },
    )
    service = QuantaxisDeploymentService(
        store=_MemoryDeploymentStore(),
        strategy_store=_StrategyStore(),
        qifi_adapter=_FailingQifiAdapter(),
        pubsub_adapter=_NoopPubSub(),
    )
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )
    service.store.update(replace(deployment, status=DeploymentStatus.RUNNING))

    result = service.recover_startup(worker_id="worker-1")

    recovered = service.get_deployment(deployment.deployment_id, user_id=7)
    assert result == {"checked": 1, "recovery_required": 1, "resumed": 0}
    assert recovered.status == DeploymentStatus.RECOVERY_REQUIRED
    assert "qifi unavailable" in recovered.recovery_reason


def test_live_recovery_reconciles_broker_before_resume(monkeypatch) -> None:
    monkeypatch.setattr("src.quantaxis_native.service.runtime_status", lambda: {"available": True})
    monkeypatch.setattr("src.quantaxis_native.service.load_quantaxis_modules", lambda: object())
    store = _MemoryDeploymentStore()
    engine = _FakeEngineAdapter()
    service = QuantaxisDeploymentService(
        store=store,
        strategy_store=_StrategyStore(),
        pubsub_adapter=_NoopPubSub(),
        engine_adapter=engine,
        live_reconciliation_gate=_SafeLiveReconciliationGate(),
    )
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="LIVE",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
        broker_binding_id=99,
    )
    store.update(
        replace(
            deployment,
            status=DeploymentStatus.RECOVERY_REQUIRED,
            recovery_reason="live broker reconciliation is required before resume",
        )
    )

    recovered = service.recover_live_deployment(deployment.deployment_id, user_id=7, broker="robinhood")

    assert recovered.status == DeploymentStatus.RUNNING
    assert recovered.recovery_reason == ""
    assert engine.registered == [
        {
            "deployment_id": deployment.deployment_id,
            "task_type": "tick",
            "payload": {
                "deployment_id": deployment.deployment_id,
                "account_cookie": deployment.account_cookie,
                "target": "LIVE",
                "strategy_version_id": deployment.strategy_snapshot.version_id,
                "market": "CRYPTO",
                "symbols": ["BTC_USDT"],
                "timeframe": "1h",
            },
        }
    ]
    assert store.tasks["qrtask:" + deployment.deployment_id + ":tick"]["status"] == "registered"
    assert any(event["event_type"] == "deployment.live_reconciled" for event in store.events)
    recovery_events = [event for event in store.events if event["event_scope"] == "recovery"]
    assert recovery_events[-1]["payload"]["broker"] == "robinhood"
    assert recovery_events[-1]["payload"]["report"]["recorded_client_order_ids"] == ["coid-1"]


def test_live_recovery_blocks_when_reconciliation_is_unsafe(monkeypatch) -> None:
    monkeypatch.setattr("src.quantaxis_native.service.runtime_status", lambda: {"available": True})
    monkeypatch.setattr("src.quantaxis_native.service.load_quantaxis_modules", lambda: object())
    store = _MemoryDeploymentStore()
    engine = _FakeEngineAdapter()
    service = QuantaxisDeploymentService(
        store=store,
        strategy_store=_StrategyStore(),
        pubsub_adapter=_NoopPubSub(),
        engine_adapter=engine,
        live_reconciliation_gate=_UnsafeLiveReconciliationGate(),
    )
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="LIVE",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
        broker_binding_id=99,
    )
    store.update(replace(deployment, status=DeploymentStatus.RECOVERY_REQUIRED))

    with pytest.raises(QuantaxisTradingError, match="ambiguous broker state"):
        service.recover_live_deployment(deployment.deployment_id, user_id=7, broker="robinhood")

    blocked = service.get_deployment(deployment.deployment_id, user_id=7)
    assert blocked.status == DeploymentStatus.RECOVERY_REQUIRED
    assert blocked.recovery_reason == "ambiguous broker state"
    assert engine.registered == []
    assert "qrtask:" + deployment.deployment_id + ":tick" not in store.tasks
    assert not any(event["event_type"] == "deployment.live_reconciled" for event in store.events)
    recovery_events = [event for event in store.events if event["event_scope"] == "recovery"]
    assert recovery_events[-1]["payload"]["is_safe"] is False
    assert recovery_events[-1]["payload"]["reason"] == "ambiguous broker state"


def test_start_registers_qaengine_task_and_pause_cancels(monkeypatch) -> None:
    monkeypatch.setattr("src.quantaxis_native.service.runtime_status", lambda: {"available": True})
    monkeypatch.setattr("src.quantaxis_native.service.load_quantaxis_modules", lambda: object())
    store = _MemoryDeploymentStore()
    engine = _FakeEngineAdapter()
    service = QuantaxisDeploymentService(
        store=store,
        strategy_store=_StrategyStore(),
        pubsub_adapter=_NoopPubSub(),
        engine_adapter=engine,
    )
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )
    ready = service.set_status(deployment.deployment_id, user_id=7, action="ready")

    running = service.set_status(ready.deployment_id, user_id=7, action="start")

    assert running.status == DeploymentStatus.RUNNING
    assert engine.registered[0]["deployment_id"] == deployment.deployment_id
    assert engine.registered[0]["task_type"] == "tick"
    assert store.tasks[("qrtask:" + deployment.deployment_id + ":tick")]["status"] == "registered"
    assert any(event["event_type"] == "deployment.task_registered" for event in store.events)

    paused = service.set_status(running.deployment_id, user_id=7, action="pause")

    assert paused.status == DeploymentStatus.PAUSED
    assert engine.cancelled == [{"deployment_id": deployment.deployment_id, "task_type": "tick"}]
    assert store.tasks[("qrtask:" + deployment.deployment_id + ":tick")]["status"] == "cancelled"
    assert any(event["event_type"] == "deployment.task_cancelled" for event in store.events)


def test_service_exposes_lease_and_event_offset() -> None:
    store = _MemoryDeploymentStore()
    service = QuantaxisDeploymentService(store=store, strategy_store=_StrategyStore(), pubsub_adapter=_NoopPubSub())
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )

    assert service.acquire_worker_lease(
        deployment.deployment_id,
        user_id=7,
        worker_id="worker-1",
        lease_until="2026-08-20T00:10:00Z",
        now="2026-08-20T00:00:00Z",
        last_event_id="event-1",
    )
    assert not service.acquire_worker_lease(
        deployment.deployment_id,
        user_id=7,
        worker_id="worker-2",
        lease_until="2026-08-20T00:11:00Z",
        now="2026-08-20T00:01:00Z",
    )

    service.save_event_offset(
        deployment.deployment_id,
        user_id=7,
        consumer_name="worker:tick",
        event_scope="market",
        last_event_id="event-1",
        last_sequence_no=42,
    )
    offset = service.event_offset(
        deployment.deployment_id,
        user_id=7,
        consumer_name="worker:tick",
        event_scope="market",
    )

    assert offset is not None
    assert offset["last_event_id"] == "event-1"
    assert offset["last_sequence_no"] == 42


class _StrategyStore:
    def list_strategy_versions(self, strategy_id: str, user_id: int | None = None):
        assert strategy_id == "s1"
        assert user_id == 7
        return [
            {
                "strategy_id": "s1",
                "version": 2,
                "owner_user_id": 7,
                "name": "Momentum",
                "description": "desc",
                "strategy_description": "rules",
                "language": "python",
                "category": "trend",
                "tags": ["qa"],
                "code": "class SignalEngine:\n    def generate_signal(self, context):\n        return {'action': 'HOLD'}\n",
                "code_sha256": "abc",
                "parameter_schema": {"fast": {"type": "integer"}},
                "created_at": "2026-08-20T00:00:00Z",
            }
        ]


class _UnsafeStrategyStore(_StrategyStore):
    def list_strategy_versions(self, strategy_id: str, user_id: int | None = None):
        rows = super().list_strategy_versions(strategy_id, user_id=user_id)
        return [
            {
                **rows[0],
                "code": (
                    "class Strategy:\n"
                    "    def generate_signal(self, context):\n"
                    "        context['account'].send_order(code='BTC_USDT', amount=1, price=100)\n"
                    "        return {'action': 'HOLD'}\n"
                ),
            }
        ]


class _CcxtScriptStrategyStore(_StrategyStore):
    def list_strategy_versions(self, strategy_id: str, user_id: int | None = None):
        rows = super().list_strategy_versions(strategy_id, user_id=user_id)
        return [
            {
                **rows[0],
                "code": (
                    "import ccxt\n"
                    "class CryptoAdvancedGrid:\n"
                    "    def __init__(self, config):\n"
                    "        self.exchange = ccxt.binance(config)\n"
                    "    def run_loop(self):\n"
                    "        ticker = self.exchange.fetch_ticker('BTC/USDT')\n"
                    "        return ticker\n"
                ),
            }
        ]


class _QAStrategyStore(_StrategyStore):
    def list_strategy_versions(self, strategy_id: str, user_id: int | None = None):
        rows = super().list_strategy_versions(strategy_id, user_id=user_id)
        return [
            {
                **rows[0],
                "code": (
                    "class Strategy(QAStrategyCtaBase):\n"
                    "    def on_tick(self, context):\n"
                    "        event = context['market_event']\n"
                    "        return {\n"
                    "            'action': 'BUY',\n"
                    "            'symbol': event['symbol'],\n"
                    "            'quantity': 2,\n"
                    "            'price': event['close'],\n"
                    "            'reason': 'unit-test',\n"
                    "        }\n"
                ),
            }
        ]


class _MemoryDeploymentStore:
    def __init__(self) -> None:
        self.items: dict[str, QuantaxisDeployment] = {}
        self.promotions: list[dict[str, object]] = []
        self.events: list[dict[str, object]] = []
        self.offsets: dict[tuple[str, str, str], dict[str, object]] = {}
        self.leases: dict[str, dict[str, object]] = {}
        self.tasks: dict[str, dict[str, object]] = {}

    def create(self, deployment: QuantaxisDeployment) -> QuantaxisDeployment:
        self.items[deployment.deployment_id] = deployment
        return deployment

    def update(self, deployment: QuantaxisDeployment) -> QuantaxisDeployment:
        self.items[deployment.deployment_id] = deployment
        return deployment

    def get(self, deployment_id: str, *, user_id: int | None = None) -> QuantaxisDeployment | None:
        item = self.items.get(deployment_id)
        if item is None:
            return None
        if user_id is not None and item.user_id != user_id:
            return None
        return item

    def list(self, *, user_id: int) -> list[QuantaxisDeployment]:
        return [item for item in self.items.values() if item.user_id == user_id]

    def list_by_status(self, statuses: list[DeploymentStatus]) -> list[QuantaxisDeployment]:
        wanted = {status for status in statuses}
        return [item for item in self.items.values() if item.status in wanted]

    def record_promotion(self, **kwargs) -> None:
        self.promotions.append(kwargs)

    def append_runtime_event(self, **kwargs):
        for event in self.events:
            if (
                event["deployment_id"] == kwargs["deployment_id"]
                and event["event_scope"] == kwargs["event_scope"]
                and event["idempotency_key"] == kwargs["idempotency_key"]
            ):
                return event
        sequence_no = 1 + max(
            (
                int(event["sequence_no"])
                for event in self.events
                if event["deployment_id"] == kwargs["deployment_id"] and event["event_scope"] == kwargs["event_scope"]
            ),
            default=0,
        )
        event = {**kwargs, "sequence_no": sequence_no}
        self.events.append(event)
        return event

    def list_runtime_events(self, *, deployment_id: str, event_scope: str | None = None, after_sequence_no: int = 0, limit: int = 100):
        return [
            event for event in self.events
            if event["deployment_id"] == deployment_id
            and (event_scope is None or event["event_scope"] == event_scope)
            and int(event["sequence_no"]) > after_sequence_no
        ][:limit]

    def save_event_offset(self, **kwargs) -> None:
        self.offsets[(kwargs["deployment_id"], kwargs["consumer_name"], kwargs["event_scope"])] = kwargs

    def get_event_offset(self, *, deployment_id: str, consumer_name: str, event_scope: str):
        return self.offsets.get((deployment_id, consumer_name, event_scope))

    def register_runtime_task(self, **kwargs):
        task = {
            **kwargs,
            "status": "registered",
            "active": 1,
            "updated_at": kwargs["created_at"],
            "cancelled_at": None,
        }
        self.tasks[kwargs["task_id"]] = task
        return task

    def cancel_runtime_tasks(self, *, deployment_id: str, task_type: str | None, cancelled_at: str):
        count = 0
        for task in self.tasks.values():
            if task["deployment_id"] != deployment_id:
                continue
            if task_type is not None and task["task_type"] != task_type:
                continue
            if task["status"] != "registered":
                continue
            task["status"] = "cancelled"
            task["active"] = 0
            task["updated_at"] = cancelled_at
            task["cancelled_at"] = cancelled_at
            count += 1
        return count

    def acquire_runtime_lease(self, *, deployment_id: str, worker_id: str, lease_until: str, now: str, last_event_id: str = ""):
        current = self.leases.get(deployment_id)
        if current is None or str(current["lease_until"]) < now or current["worker_id"] == worker_id:
            self.leases[deployment_id] = {
                "worker_id": worker_id,
                "lease_until": lease_until,
                "last_event_id": last_event_id,
                "updated_at": now,
            }
            return True
        return False


def test_runtime_lease_blocks_concurrent_workers() -> None:
    store = _MemoryDeploymentStore()
    assert store.acquire_runtime_lease(
        deployment_id="d1",
        worker_id="w1",
        lease_until="2026-08-20T00:10:00Z",
        now="2026-08-20T00:00:00Z",
    )
    assert not store.acquire_runtime_lease(
        deployment_id="d1",
        worker_id="w2",
        lease_until="2026-08-20T00:11:00Z",
        now="2026-08-20T00:01:00Z",
    )
    assert store.acquire_runtime_lease(
        deployment_id="d1",
        worker_id="w2",
        lease_until="2026-08-20T00:21:00Z",
        now="2026-08-20T00:20:00Z",
    )


def test_qifi_projection_adapter_reads_quantaxis_account(monkeypatch) -> None:
    deployment = _deployment(risk_policy={"initial_cash": 100000})

    class FakeQifiAccount:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        def initial(self) -> None:
            self.initialized = True

        @property
        def message(self):
            return {
                "account_cookie": self.kwargs["username"],
                "model": self.kwargs["model"],
                "broker_name": self.kwargs["broker_name"],
                "trading_day": "2026-08-20",
                "updatetime": "2026-08-20 09:30:00",
                "accounts": {
                    "available": 99000,
                    "frozen_margin": 1000,
                    "margin": 1200,
                    "balance": 100200,
                    "risk_ratio": 0.0119,
                },
                "positions": {"X.BTCUSDT": {"instrument_id": "BTCUSDT", "volume_long": 1}},
                "orders": {"o1": {"order_id": "o1", "volume_left": 1}},
                "trades": {"t1": {"trade_id": "t1", "order_id": "o1"}},
            }

    class FakeModules:
        qifi_account = FakeQifiAccount

    monkeypatch.setattr("src.quantaxis_native.adapters.load_quantaxis_modules", lambda: FakeModules)
    adapter = QifiProjectionAdapter(
        config=QuantaxisDurableStoreConfig(
            mongo_uri="mongodb://mongo:27017/?serverSelectionTimeoutMS=1000",
            qifi_password="secret",
            qifi_dbname="mongodb",
            qapubsub_host="",
            qapubsub_port=5672,
            qapubsub_user="guest",
            qapubsub_password="guest",
            qapubsub_exchange="vibe.quantaxis",
        )
    )

    snapshot = adapter.account_snapshot(deployment)

    assert snapshot["account_cookie"] == deployment.account_cookie
    assert snapshot["model"] == "SIM"
    assert snapshot["cash"] == 99000
    assert snapshot["total_asset"] == 100200
    assert snapshot["orders"] == [{"order_id": "o1", "volume_left": 1}]
    assert snapshot["trades"] == [{"trade_id": "t1", "order_id": "o1"}]


def test_qifi_adapter_submits_order_through_quantaxis_account(monkeypatch) -> None:
    deployment = _deployment(risk_policy={"initial_cash": 100000})
    captured: dict[str, object] = {}

    class FakeQifiAccount:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs
            self.orders = {}

        def initial(self) -> None:
            captured["initial"] = True

        def send_order(self, **kwargs):
            captured["send_order"] = kwargs
            order = {
                "order_id": kwargs["order_id"],
                "instrument_id": kwargs["code"],
                "volume": int(kwargs["amount"]),
                "limit_price": kwargs["price"],
                "towards": kwargs["towards"],
                "seqno": 7,
            }
            self.orders[kwargs["order_id"]] = order
            return order

        def make_deal(self, order):
            captured["make_deal"] = order["order_id"]

        def sync(self):
            captured["sync"] = True

        @property
        def message(self):
            return {
                "account_cookie": self.kwargs["username"],
                "model": self.kwargs["model"],
                "accounts": {"available": 99000, "balance": 100000},
                "orders": self.orders,
                "trades": {},
                "positions": {},
            }

    class FakeModules:
        qifi_account = FakeQifiAccount

    monkeypatch.setattr("src.quantaxis_native.adapters.load_quantaxis_modules", lambda: FakeModules)
    adapter = QifiProjectionAdapter(config=_durable_config())

    result = adapter.submit_order_intent(
        deployment,
        client_order_id="coid-1",
        symbol="btc-usdt",
        side="BUY",
        quantity=2,
        price=100,
        order_time="2026-08-20 09:30:00",
        fill_immediately=True,
    )

    assert captured["send_order"] == {
        "code": "BTC_USDT",
        "amount": 2.0,
        "price": 100.0,
        "towards": 1,
        "order_id": "coid-1",
        "datetime": "2026-08-20 09:30:00",
    }
    assert captured["make_deal"] == "coid-1"
    assert captured["sync"] is True
    assert result["order"]["order_id"] == "coid-1"
    assert result["snapshot"]["orders"] == [{"order_id": "coid-1", "instrument_id": "BTC_USDT", "volume": 2, "limit_price": 100.0, "towards": 1, "seqno": 7}]


def test_shadow_execution_adapter_uses_qamarket_rules_and_qifi() -> None:
    deployment = _deployment(risk_policy={"initial_cash": 100000})
    qifi = _FakeQifiAdapter()
    adapter = QuantaxisShadowExecutionAdapter(qifi_adapter=qifi)

    result = adapter.execute_order_intent(
        deployment,
        client_order_id="coid-1",
        symbol="btc-usdt",
        side="BUY",
        quantity=1,
        price=100.03,
        order_time="2026-08-20 09:30:00",
    )

    assert qifi.submitted == [
        {
            "client_order_id": "coid-1",
            "symbol": "BTC_USDT",
            "side": "BUY",
            "quantity": 1.0,
            "price": 100.0,
            "order_time": "2026-08-20 09:30:00",
            "fill_immediately": True,
        }
    ]
    assert result["execution_target"] == "QAMarket/QIFI"
    assert result["shadow_matching"] == "QIFI.make_deal"
    assert result["market_rule"]["symbol"] == "BTC_USDT"


def test_qifi_projection_requires_durable_config() -> None:
    adapter = QifiProjectionAdapter(
        config=QuantaxisDurableStoreConfig(
            mongo_uri="",
            qifi_password="",
            qifi_dbname="mongodb",
            qapubsub_host="",
            qapubsub_port=5672,
            qapubsub_user="guest",
            qapubsub_password="guest",
            qapubsub_exchange="vibe.quantaxis",
        )
    )

    with pytest.raises(RuntimeError, match="durable store"):
        adapter.account_snapshot(_deployment(risk_policy={"initial_cash": 100000}))


def test_broker_live_execution_adapter_routes_through_trading_service(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_place_order(**kwargs):
        captured.update(kwargs)
        return {"status": "ok", "order_id": "live-1", "symbol": kwargs["symbol"]}

    monkeypatch.setattr("src.trading.service.place_order", fake_place_order)
    adapter = BrokerLiveExecutionAdapter()
    deployment = _deployment(
        target=DeploymentTarget.LIVE,
        risk_policy={"connector_profile_id": "binance-live", "time_in_force": "gtc"},
    )

    result = adapter.execute_order_intent(
        deployment,
        client_order_id="coid-live-1",
        symbol="BTC_USDT",
        side="BUY",
        quantity=2,
        price=101,
        order_time="2026-08-20 09:30:00",
    )

    assert captured["profile_id"] == "binance-live"
    assert captured["order_type"] == "limit"
    assert captured["limit_price"] == 101.0
    assert captured["session_id"] == deployment.deployment_id
    assert captured["client_order_id"] == "coid-live-1"
    assert result["execution_target"] == "LIVE_GATE"
    assert result["order"]["order_id"] == "live-1"


def test_broker_live_execution_adapter_fails_closed_when_gate_blocks(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.trading.service.place_order",
        lambda **_kwargs: {"status": "blocked", "reason": "live trading halted"},
    )
    adapter = BrokerLiveExecutionAdapter()
    deployment = _deployment(target=DeploymentTarget.LIVE, risk_policy={"connector_profile_id": "binance-live"})

    with pytest.raises(RuntimeError, match="live trading halted"):
        adapter.execute_order_intent(
            deployment,
            client_order_id="coid-live-1",
            symbol="BTC_USDT",
            side="BUY",
            quantity=2,
            price=101,
        )


def test_service_exposes_qifi_projection(monkeypatch) -> None:
    monkeypatch.setattr("src.quantaxis_native.service.runtime_status", lambda: {"available": True})
    monkeypatch.setattr("src.quantaxis_native.service.load_quantaxis_modules", lambda: object())
    store = _MemoryDeploymentStore()
    qifi = _FakeQifiAdapter()
    service = QuantaxisDeploymentService(store=store, strategy_store=_StrategyStore(), qifi_adapter=qifi, pubsub_adapter=_NoopPubSub())
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )

    snapshot = service.account_snapshot(deployment.account_cookie, user_id=7)
    orders = service.account_orders(deployment.account_cookie, user_id=7)
    trades = service.account_trades(deployment.account_cookie, user_id=7)

    assert snapshot["account_cookie"] == deployment.account_cookie
    assert orders == {"account_cookie": deployment.account_cookie, "orders": [{"order_id": "o1"}]}
    assert trades == {"account_cookie": deployment.account_cookie, "trades": [{"trade_id": "t1"}]}


def test_service_submits_qifi_order_intent_and_publishes_order(monkeypatch) -> None:
    monkeypatch.setattr("src.quantaxis_native.service.runtime_status", lambda: {"available": True})
    monkeypatch.setattr("src.quantaxis_native.service.load_quantaxis_modules", lambda: object())
    store = _MemoryDeploymentStore()
    qifi = _FakeQifiAdapter()
    service = QuantaxisDeploymentService(store=store, strategy_store=_StrategyStore(), qifi_adapter=qifi, pubsub_adapter=_NoopPubSub())
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )

    with pytest.raises(QuantaxisTradingError, match="running deployment"):
        service.submit_qifi_order_intent(
            deployment.deployment_id,
            user_id=7,
            client_order_id="coid-1",
            symbol="BTC_USDT",
            side="BUY",
            quantity=1,
            price=100,
        )

    store.update(replace(deployment, status=DeploymentStatus.RUNNING))
    result = service.submit_qifi_order_intent(
        deployment.deployment_id,
        user_id=7,
        client_order_id="coid-1",
        symbol="BTC_USDT",
        side="BUY",
        quantity=1,
        price=100,
    )

    assert result["order"]["order_id"] == "coid-1"
    assert qifi.submitted[0]["side"] == "BUY"
    assert any(event["event_scope"] == "order" and event["event_type"] == "order.changed" for event in store.events)


def test_service_executes_shadow_order_through_qamarket_qifi(monkeypatch) -> None:
    monkeypatch.setattr("src.quantaxis_native.service.runtime_status", lambda: {"available": True})
    monkeypatch.setattr("src.quantaxis_native.service.load_quantaxis_modules", lambda: object())
    store = _MemoryDeploymentStore()
    qifi = _FakeQifiAdapter()
    service = QuantaxisDeploymentService(
        store=store,
        strategy_store=_StrategyStore(),
        qifi_adapter=qifi,
        pubsub_adapter=_NoopPubSub(),
    )
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )
    store.update(replace(deployment, status=DeploymentStatus.RUNNING))

    result = service.execute_shadow_order_intent(
        deployment.deployment_id,
        user_id=7,
        client_order_id="coid-1",
        symbol="BTC_USDT",
        side="BUY",
        quantity=1,
        price=100,
    )

    assert result["execution_target"] == "QAMarket/QIFI"
    assert qifi.submitted[0]["fill_immediately"] is True
    assert {event["event_scope"] for event in store.events} >= {"order", "trade", "account"}
    order_event = next(event for event in store.events if event["event_scope"] == "order")
    assert order_event["payload"]["source"] == "QAMarket/QIFI"
    trade_event = next(event for event in store.events if event["event_scope"] == "trade")
    assert trade_event["payload"]["order_id"] == "coid-1"


def test_service_executes_shadow_tick_through_shared_strategy_pipeline(monkeypatch) -> None:
    monkeypatch.setattr("src.quantaxis_native.service.runtime_status", lambda: {"available": True})
    monkeypatch.setattr("src.quantaxis_native.service.load_quantaxis_modules", lambda: object())

    class FakeQAStrategyBase:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

    class FakeModules:
        strategy_cta_base = FakeQAStrategyBase

    monkeypatch.setattr("src.quantaxis_native.strategy_runtime.load_quantaxis_modules", lambda: FakeModules)
    store = _MemoryDeploymentStore()
    qifi = _FakeQifiAdapter()
    service = QuantaxisDeploymentService(
        store=store,
        strategy_store=_QAStrategyStore(),
        qifi_adapter=qifi,
        pubsub_adapter=_NoopPubSub(),
    )
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000, "max_order_notional": 1000},
    )
    store.update(replace(deployment, status=DeploymentStatus.RUNNING))

    result = service.execute_deployment_tick(
        deployment.deployment_id,
        user_id=7,
        market_event={"event_id": "bar-1", "symbol": "BTC_USDT", "close": 101, "datetime": "2026-08-20 09:30:00"},
        worker_id="worker-1",
    )

    assert result["target"] == "SHADOW"
    assert result["signal"]["intent"]["side"] == "BUY"
    assert qifi.submitted[0]["symbol"] == "BTC_USDT"
    assert qifi.submitted[0]["fill_immediately"] is True
    assert {event["event_scope"] for event in store.events} >= {"market", "signal", "order", "trade", "account"}
    offset = store.get_event_offset(
        deployment_id=deployment.deployment_id,
        consumer_name="worker:tick:worker-1",
        event_scope="market",
    )
    assert offset["last_event_id"] == "bar-1"


def test_service_executes_live_tick_through_target_adapter(monkeypatch) -> None:
    monkeypatch.setattr("src.quantaxis_native.service.runtime_status", lambda: {"available": True})
    monkeypatch.setattr("src.quantaxis_native.service.load_quantaxis_modules", lambda: object())

    class FakeQAStrategyBase:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

    class FakeModules:
        strategy_cta_base = FakeQAStrategyBase

    monkeypatch.setattr("src.quantaxis_native.strategy_runtime.load_quantaxis_modules", lambda: FakeModules)
    store = _MemoryDeploymentStore()
    live_adapter = _FakeLiveExecutionAdapter()
    service = QuantaxisDeploymentService(
        store=store,
        strategy_store=_QAStrategyStore(),
        qifi_adapter=_FakeQifiAdapter(),
        pubsub_adapter=_NoopPubSub(),
        live_execution_adapter=live_adapter,
    )
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="LIVE",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000, "max_order_notional": 1000},
        broker_binding_id=99,
    )
    store.update(replace(deployment, status=DeploymentStatus.RUNNING))

    result = service.execute_deployment_tick(
        deployment.deployment_id,
        user_id=7,
        market_event={"event_id": "bar-1", "symbol": "BTC_USDT", "close": 101, "datetime": "2026-08-20 09:30:00"},
    )

    assert result["target"] == "LIVE"
    assert live_adapter.executed[0]["symbol"] == "BTC_USDT"
    assert live_adapter.executed[0]["side"] == "BUY"
    order_event = next(event for event in store.events if event["event_scope"] == "order")
    assert order_event["payload"]["source"] == "LIVE_GATE"


def test_qapubsub_adapter_publishes_with_quantaxis_topic(monkeypatch) -> None:
    published: list[tuple[str, str]] = []

    class FakePublisher:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        def pub(self, body, routing_key):
            published.append((body, routing_key))

        def exit(self):
            published.append(("closed", self.kwargs["exchange"]))

    class FakeModules:
        publisher_topic = FakePublisher

    monkeypatch.setattr("src.quantaxis_native.adapters.load_quantaxis_modules", lambda: FakeModules)
    adapter = QuantaxisPubSubAdapter(
        config=QuantaxisDurableStoreConfig(
            mongo_uri="mongodb://mongo:27017",
            qifi_password="secret",
            qifi_dbname="mongodb",
            qapubsub_host="rabbitmq",
            qapubsub_port=5672,
            qapubsub_user="guest",
            qapubsub_password="guest",
            qapubsub_exchange="vibe.quantaxis",
        )
    )

    assert adapter.publish_event({"deployment_id": "d1", "event_scope": "order", "event_type": "order.created"})
    assert published[0][1] == "vibe.quantaxis.order.order.created.d1"
    assert published[1] == ("closed", "vibe.quantaxis")


def test_service_ingests_pubsub_event_once() -> None:
    store = _MemoryDeploymentStore()
    service = QuantaxisDeploymentService(store=store, strategy_store=_StrategyStore(), pubsub_adapter=_NoopPubSub())
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )

    event = {
        "event_id": "external-order-1",
        "deployment_id": deployment.deployment_id,
        "event_scope": "order",
        "event_type": "order.accepted",
        "idempotency_key": "broker-order-1",
        "payload": {"order_id": "o1"},
    }

    stored = service.ingest_pubsub_event(deployment.deployment_id, user_id=7, event=event)
    duplicate = service.ingest_pubsub_event(deployment.deployment_id, user_id=7, event=event)

    assert stored["event_id"] == "external-order-1"
    assert stored["event_scope"] == "order"
    assert stored["sequence_no"] == 1
    assert duplicate == stored
    assert len(store.events) == 1


def test_service_publishes_scoped_runtime_events_through_qapubsub() -> None:
    store = _MemoryDeploymentStore()
    pubsub = _RecordingPubSub()
    service = QuantaxisDeploymentService(store=store, strategy_store=_StrategyStore(), pubsub_adapter=pubsub)
    deployment = service.create_deployment(
        user_id=7,
        strategy_id="s1",
        target="SHADOW",
        version_no=2,
        market="crypto",
        symbols=["BTC-USDT"],
        timeframe="1h",
        parameters={},
        risk_policy={"initial_cash": 100000},
    )

    market = service.publish_market_event(
        deployment.deployment_id,
        user_id=7,
        market_event_id="bar-1",
        payload={"symbol": "BTC_USDT", "close": 100},
    )
    signal = service.publish_signal_event(
        deployment.deployment_id,
        user_id=7,
        signal_id="sig-1",
        payload={"action": "BUY"},
    )
    account = service.publish_account_event(
        deployment.deployment_id,
        user_id=7,
        account_event_id="acct-1",
        payload={"available": 99000},
    )
    order = service.publish_order_event(
        deployment.deployment_id,
        user_id=7,
        order_id="order-1",
        order_event_id="accepted",
        payload={"status": "ACCEPTED"},
    )
    trade = service.publish_trade_event(
        deployment.deployment_id,
        user_id=7,
        trade_id="trade-1",
        payload={"order_id": "order-1", "price": 100},
    )
    recovery = service.publish_recovery_event(
        deployment.deployment_id,
        user_id=7,
        recovery_event_id="startup-1",
        payload={"status": "checked"},
    )
    duplicate_order = service.publish_order_event(
        deployment.deployment_id,
        user_id=7,
        order_id="order-1",
        order_event_id="accepted",
        payload={"status": "IGNORED"},
    )

    assert [market["event_scope"], signal["event_scope"], account["event_scope"]] == ["market", "signal", "account"]
    assert order["event_scope"] == "order"
    assert trade["event_scope"] == "trade"
    assert recovery["event_scope"] == "recovery"
    assert duplicate_order["event_id"] == order["event_id"]
    assert len(store.events) == 6
    assert len(pubsub.events) == 6
    assert pubsub.events[-1]["event_id"] == recovery["event_id"]
    assert [event["sequence_no"] for event in store.events if event["event_scope"] == "order"] == [1]


def test_qapubsub_adapter_subscribe_decodes_topic_events(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeChannel:
        def basic_consume(self, queue, callback, auto_ack=False):
            captured["queue"] = queue
            captured["auto_ack"] = auto_ack
            method = type("Method", (), {"delivery_tag": "tag-1"})()
            callback(None, method, None, b'{"event_id":"e1","deployment_id":"d1","event_type":"order.filled"}')

        def start_consuming(self):
            return None

        def basic_ack(self, delivery_tag):
            captured["ack"] = delivery_tag

    class FakeSubscriber:
        def __init__(self, **kwargs) -> None:
            captured["kwargs"] = kwargs
            self.queue = "q-events"
            self.channel = FakeChannel()

        def close(self):
            captured["closed"] = True

    class FakeModules:
        subscriber_topic = FakeSubscriber

    monkeypatch.setattr("src.quantaxis_native.adapters.load_quantaxis_modules", lambda: FakeModules)
    adapter = QuantaxisPubSubAdapter(
        config=QuantaxisDurableStoreConfig(
            mongo_uri="mongodb://mongo:27017",
            qifi_password="secret",
            qifi_dbname="mongodb",
            qapubsub_host="rabbitmq",
            qapubsub_port=5672,
            qapubsub_user="guest",
            qapubsub_password="guest",
            qapubsub_exchange="vibe.quantaxis",
        )
    )

    events = adapter.subscribe_events(deployment_id="d1", stop_event=threading.Event())
    message = events.get(timeout=1)

    assert captured["kwargs"]["routing_key"] == "vibe.quantaxis.*.*.d1"
    assert captured["auto_ack"] is False
    assert captured["ack"] == "tag-1"
    assert captured["closed"] is True
    assert message["event_id"] == "e1"
    assert message["event_type"] == "order.filled"


def test_qaengine_adapter_builds_quantaxis_task() -> None:
    task = QuantaxisEngineAdapter.build_task(
        event_type="deployment.tick",
        message={"deployment_id": "d1"},
        run=lambda event: {"type": event.event_type, "message": event.message},
    )
    task.do()
    assert task.result["result"] == {"type": "deployment.tick", "message": {"deployment_id": "d1"}}


class _FakeQifiAdapter:
    def __init__(self) -> None:
        self.submitted: list[dict[str, object]] = []

    def account_snapshot(self, deployment: QuantaxisDeployment):
        return {
            "account_cookie": deployment.account_cookie,
            "positions": [{"instrument_id": "BTC_USDT"}],
            "orders": [{"order_id": "o1"}],
            "trades": [{"trade_id": "t1"}],
        }

    def account_orders(self, deployment: QuantaxisDeployment):
        return [{"order_id": "o1"}]

    def account_trades(self, deployment: QuantaxisDeployment):
        return [{"trade_id": "t1"}]

    def submit_order_intent(self, deployment: QuantaxisDeployment, **kwargs):
        self.submitted.append(kwargs)
        return {
            "order": {
                "order_id": kwargs["client_order_id"],
                "instrument_id": kwargs["symbol"],
                "seqno": 1,
            },
            "snapshot": {
                **self.account_snapshot(deployment),
                "orders": [{"order_id": kwargs["client_order_id"], "instrument_id": kwargs["symbol"]}],
                "trades": [{"trade_id": f"{kwargs['client_order_id']}:trade", "order_id": kwargs["client_order_id"]}],
            },
        }


class _FakeLiveExecutionAdapter:
    def __init__(self) -> None:
        self.executed: list[dict[str, object]] = []

    def execute_order_intent(self, deployment: QuantaxisDeployment, **kwargs):
        self.executed.append(kwargs)
        return {
            "order": {
                "order_id": kwargs["client_order_id"],
                "instrument_id": kwargs["symbol"],
                "status": "accepted",
            },
            "snapshot": {},
        }


class _FailingQifiAdapter:
    def account_snapshot(self, deployment: QuantaxisDeployment):
        raise RuntimeError("qifi unavailable")


class _NoopPubSub:
    def publish_event(self, event):
        return False


class _RecordingPubSub:
    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []

    def publish_event(self, event):
        self.events.append(event)
        return True


class _FakeTask:
    def __init__(self, task_id: str) -> None:
        self.task_id = task_id


class _FakeEngineAdapter:
    def __init__(self) -> None:
        self.registered: list[dict[str, object]] = []
        self.cancelled: list[dict[str, object]] = []

    def register_deployment_task(self, deployment: QuantaxisDeployment, *, task_type: str, payload: dict[str, object]):
        self.registered.append({"deployment_id": deployment.deployment_id, "task_type": task_type, "payload": payload})
        return _FakeTask(f"qa-task-{len(self.registered)}")

    def cancel_deployment_tasks(self, *, deployment_id: str, task_type: str | None = None):
        self.cancelled.append({"deployment_id": deployment_id, "task_type": task_type})


class _SafeLiveReconciliationGate:
    def reconcile(self, deployment: QuantaxisDeployment, *, broker: str):
        return {
            "broker": broker,
            "is_safe": True,
            "requires_halt": False,
            "state_persisted": True,
            "had_prior_state": True,
            "recorded_client_order_ids": ["coid-1"],
            "deltas": [],
        }


class _UnsafeLiveReconciliationGate:
    def reconcile(self, deployment: QuantaxisDeployment, *, broker: str):
        return {
            "broker": broker,
            "is_safe": False,
            "requires_halt": True,
            "reason": "ambiguous broker state",
            "deltas": [{"kind": "open_order_mismatch"}],
        }


def _deployment(
    *,
    target: DeploymentTarget = DeploymentTarget.SHADOW,
    parameters: dict[str, object] | None = None,
    risk_policy: dict[str, object] | None = None,
) -> QuantaxisDeployment:
    return QuantaxisDeployment.create(
        user_id=7,
        target=target,
        strategy_snapshot=StrategyVersionSnapshot.from_version_row(_StrategyStore().list_strategy_versions("s1", user_id=7)[0]),
        market="CRYPTO",
        symbols=("BTCUSDT",),
        timeframe="1h",
        parameters=dict(parameters or {}),
        risk_policy=dict(risk_policy or {}),
        broker_binding_id=99 if target == DeploymentTarget.LIVE else None,
    )


def _durable_config() -> QuantaxisDurableStoreConfig:
    return QuantaxisDurableStoreConfig(
        mongo_uri="mongodb://mongo:27017",
        qifi_password="secret",
        qifi_dbname="mongodb",
        qapubsub_host="",
        qapubsub_port=5672,
        qapubsub_user="guest",
        qapubsub_password="guest",
        qapubsub_exchange="vibe.quantaxis",
    )
