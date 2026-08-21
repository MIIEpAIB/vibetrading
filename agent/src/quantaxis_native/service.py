"""Service layer for QUANTAXIS-native deployments."""

from __future__ import annotations

import hashlib
from dataclasses import replace
from typing import Any, Protocol

from src.quantaxis_native.adapters import (
    BrokerLiveExecutionAdapter,
    LiveOrderAdapterLike,
    QifiProjectionAdapter,
    QuantaxisAdapterError,
    QuantaxisEngineAdapter,
    QuantaxisPubSubAdapter,
    QuantaxisShadowExecutionAdapter,
    durable_runtime_status,
)
from src.quantaxis_native.loader import load_quantaxis_modules, runtime_status
from src.quantaxis_native.models import (
    DeploymentStatus,
    DeploymentTarget,
    QuantaxisDeployment,
    StrategyVersionSnapshot,
    new_id,
    now_iso,
)
from src.quantaxis_native.strategy_runtime import (
    QuantaxisStrategyRuntimeError,
    RestrictedQAStrategyRuntime,
)
from src.quantaxis_native.store import MySQLQuantaxisDeploymentStore


class StrategyStoreLike(Protocol):
    def list_strategy_versions(self, strategy_id: str, user_id: int | None = None) -> list[dict[str, Any]]: ...


class LiveReconciliationGateLike(Protocol):
    def reconcile(self, deployment: QuantaxisDeployment, *, broker: str) -> dict[str, Any]: ...


class StrategyRuntimeLike(Protocol):
    def validate_package(self, code: str) -> None: ...

    def evaluate_tick(
        self,
        deployment: QuantaxisDeployment,
        *,
        market_event: dict[str, Any],
        account_snapshot: dict[str, Any],
    ) -> dict[str, Any]: ...


class QuantaxisTradingError(ValueError):
    """Raised for invalid or unavailable QUANTAXIS trading operations."""


class QuantaxisDeploymentService:
    """Create and manage deployment metadata and QUANTAXIS runtime checks."""

    def __init__(
        self,
        *,
        store: MySQLQuantaxisDeploymentStore,
        strategy_store: StrategyStoreLike,
        qifi_adapter: QifiProjectionAdapter | None = None,
        pubsub_adapter: QuantaxisPubSubAdapter | None = None,
        engine_adapter: QuantaxisEngineAdapter | None = None,
        shadow_execution_adapter: QuantaxisShadowExecutionAdapter | None = None,
        live_execution_adapter: LiveOrderAdapterLike | None = None,
        live_reconciliation_gate: LiveReconciliationGateLike | None = None,
        strategy_runtime: StrategyRuntimeLike | None = None,
    ) -> None:
        self.store = store
        self.strategy_store = strategy_store
        self.qifi_adapter = qifi_adapter or QifiProjectionAdapter()
        self.pubsub_adapter = pubsub_adapter or QuantaxisPubSubAdapter()
        self.engine_adapter = engine_adapter or QuantaxisEngineAdapter()
        self.shadow_execution_adapter = shadow_execution_adapter or QuantaxisShadowExecutionAdapter(qifi_adapter=self.qifi_adapter)
        self.live_execution_adapter = live_execution_adapter or BrokerLiveExecutionAdapter()
        self.live_reconciliation_gate = live_reconciliation_gate or DefaultLiveReconciliationGate()
        self.strategy_runtime = strategy_runtime or RestrictedQAStrategyRuntime()

    def runtime_status(self) -> dict[str, Any]:
        return durable_runtime_status()

    def create_deployment(
        self,
        *,
        user_id: int,
        strategy_id: str,
        target: str,
        version_no: int | None,
        market: str,
        symbols: list[str],
        timeframe: str,
        parameters: dict[str, Any] | None,
        risk_policy: dict[str, Any] | None,
        broker_binding_id: int | None = None,
    ) -> QuantaxisDeployment:
        target_value = self._target(target)
        if target_value == DeploymentTarget.LIVE and not broker_binding_id:
            raise QuantaxisTradingError("live deployment requires broker_binding_id")
        snapshot = self._strategy_version(strategy_id, user_id=user_id, version_no=version_no)
        normalized_symbols = tuple(self._normalize_symbol(item) for item in symbols if str(item).strip())
        if not normalized_symbols:
            raise QuantaxisTradingError("deployment requires at least one symbol")
        if not str(timeframe or "").strip():
            raise QuantaxisTradingError("timeframe is required")
        snapshot = self._deployable_strategy_snapshot(snapshot)
        self._validate_strategy_runtime(snapshot)
        deployment = QuantaxisDeployment.create(
            user_id=user_id,
            target=target_value,
            strategy_snapshot=snapshot,
            market=market,
            symbols=normalized_symbols,
            timeframe=timeframe,
            parameters=dict(parameters or {}),
            risk_policy=dict(risk_policy or {}),
            broker_binding_id=broker_binding_id,
        )
        return self.store.create(deployment)

    def list_deployments(self, *, user_id: int) -> list[QuantaxisDeployment]:
        return self.store.list(user_id=user_id)

    def get_deployment(self, deployment_id: str, *, user_id: int) -> QuantaxisDeployment:
        deployment = self.store.get(deployment_id, user_id=user_id)
        if deployment is None:
            raise QuantaxisTradingError("deployment not found")
        return deployment

    def set_status(self, deployment_id: str, *, user_id: int, action: str) -> QuantaxisDeployment:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        action = str(action or "").strip().lower()
        ts = now_iso()
        fields: dict[str, Any] = {"updated_at": ts}
        if action == "ready":
            if deployment.status != DeploymentStatus.DRAFT:
                raise QuantaxisTradingError("only draft deployments can be marked ready")
            status = DeploymentStatus.READY
        elif action == "start":
            if deployment.status not in {DeploymentStatus.READY, DeploymentStatus.PAUSED}:
                raise QuantaxisTradingError("only ready or paused deployments can be started")
            self._require_runtime()
            self._register_runtime_task(deployment)
            status = DeploymentStatus.RUNNING
            fields["started_at"] = deployment.started_at or ts
            fields["paused_at"] = None
        elif action == "pause":
            if deployment.status != DeploymentStatus.RUNNING:
                raise QuantaxisTradingError("only running deployments can be paused")
            self._cancel_runtime_tasks(deployment)
            status = DeploymentStatus.PAUSED
            fields["paused_at"] = ts
        elif action == "stop":
            if deployment.status not in {DeploymentStatus.RUNNING, DeploymentStatus.PAUSED, DeploymentStatus.READY}:
                raise QuantaxisTradingError("deployment cannot be stopped from current state")
            self._cancel_runtime_tasks(deployment)
            status = DeploymentStatus.STOPPED
            fields["stopped_at"] = ts
        elif action == "archive":
            if deployment.status == DeploymentStatus.RUNNING:
                raise QuantaxisTradingError("running deployments must be paused or stopped before archive")
            self._cancel_runtime_tasks(deployment)
            status = DeploymentStatus.ARCHIVED
            fields["archived_at"] = ts
        else:
            raise QuantaxisTradingError("unsupported deployment action")
        updated = self.store.update(replace(deployment, status=status, **fields))
        self._append_deployment_event(
            updated,
            event_type=f"deployment.{action}",
            idempotency_key=f"deployment:{deployment.deployment_id}:{action}:{ts}",
            payload={
                "action": action,
                "previous_status": deployment.status.value,
                "status": updated.status.value,
            },
        )
        return updated

    def promote_to_live(
        self,
        deployment_id: str,
        *,
        user_id: int,
        broker_binding_id: int,
        risk_policy: dict[str, Any] | None,
    ) -> QuantaxisDeployment:
        source = self.get_deployment(deployment_id, user_id=user_id)
        if source.target != DeploymentTarget.SHADOW:
            raise QuantaxisTradingError("only shadow deployments can be promoted")
        if source.status not in {DeploymentStatus.RUNNING, DeploymentStatus.PAUSED, DeploymentStatus.STOPPED}:
            raise QuantaxisTradingError("shadow deployment must have been run before promotion")
        live = QuantaxisDeployment.create(
            user_id=user_id,
            target=DeploymentTarget.LIVE,
            strategy_snapshot=source.strategy_snapshot,
            market=source.market,
            symbols=source.symbols,
            timeframe=source.timeframe,
            parameters=source.parameters,
            risk_policy=dict(risk_policy or source.risk_policy),
            broker_binding_id=broker_binding_id,
        )
        created = self.store.create(live)
        if hasattr(self.store, "record_promotion"):
            self.store.record_promotion(
                promotion_id=new_id("qapromo"),
                user_id=user_id,
                source_deployment_id=source.deployment_id,
                target_deployment_id=created.deployment_id,
                strategy_version_id=source.strategy_snapshot.version_id,
                risk_snapshot=dict(risk_policy or source.risk_policy),
                consent_ref=f"broker_binding:{broker_binding_id}",
                created_at=created.created_at,
            )
        return created

    def runtime_events(self, deployment_id: str, *, user_id: int, limit: int = 100) -> dict[str, Any]:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if not hasattr(self.store, "list_runtime_events"):
            return {"deployment_id": deployment.deployment_id, "events": []}
        return {
            "deployment_id": deployment.deployment_id,
            "events": self.store.list_runtime_events(deployment_id=deployment.deployment_id, limit=limit),
        }

    def runtime_events_after(
        self,
        deployment_id: str,
        *,
        user_id: int,
        after_sequence_no: int,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if not hasattr(self.store, "list_runtime_events"):
            return []
        return self.store.list_runtime_events(
            deployment_id=deployment.deployment_id,
            event_scope="deployment",
            after_sequence_no=after_sequence_no,
            limit=limit,
        )

    def ingest_pubsub_event(
        self,
        deployment_id: str,
        *,
        user_id: int,
        event: dict[str, Any],
    ) -> dict[str, Any]:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        event_deployment_id = str(event.get("deployment_id") or deployment.deployment_id)
        if event_deployment_id != deployment.deployment_id:
            raise QuantaxisTradingError("event deployment mismatch")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            payload = {key: value for key, value in event.items() if key not in _RUNTIME_EVENT_FIELDS}
        return self._append_runtime_event(
            deployment,
            event_scope=str(event.get("event_scope") or "deployment"),
            event_type=str(event.get("event_type") or "deployment.event"),
            idempotency_key=str(event.get("idempotency_key") or event.get("event_id") or new_id("qaidem")),
            payload=dict(payload),
            event_id=str(event.get("event_id") or new_id("qaevt")),
            publish=False,
        )

    def subscribe_pubsub_events(self, deployment_id: str, *, user_id: int, stop_event: Any):
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if not hasattr(self.pubsub_adapter, "subscribe_events"):
            return None
        try:
            return self.pubsub_adapter.subscribe_events(deployment_id=deployment.deployment_id, stop_event=stop_event)
        except QuantaxisAdapterError as exc:
            raise QuantaxisTradingError(str(exc)) from exc

    def save_event_offset(
        self,
        deployment_id: str,
        *,
        user_id: int,
        consumer_name: str,
        event_scope: str,
        last_event_id: str,
        last_sequence_no: int,
    ) -> None:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if not hasattr(self.store, "save_event_offset"):
            return
        self.store.save_event_offset(
            deployment_id=deployment.deployment_id,
            consumer_name=consumer_name,
            event_scope=event_scope,
            last_event_id=last_event_id,
            last_sequence_no=last_sequence_no,
            updated_at=now_iso(),
        )

    def event_offset(self, deployment_id: str, *, user_id: int, consumer_name: str, event_scope: str) -> dict[str, Any] | None:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if not hasattr(self.store, "get_event_offset"):
            return None
        return self.store.get_event_offset(
            deployment_id=deployment.deployment_id,
            consumer_name=consumer_name,
            event_scope=event_scope,
        )

    def acquire_worker_lease(
        self,
        deployment_id: str,
        *,
        user_id: int,
        worker_id: str,
        lease_until: str,
        now: str,
        last_event_id: str = "",
    ) -> bool:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if not hasattr(self.store, "acquire_runtime_lease"):
            raise QuantaxisTradingError("runtime lease store is not available")
        return bool(
            self.store.acquire_runtime_lease(
                deployment_id=deployment.deployment_id,
                worker_id=worker_id,
                lease_until=lease_until,
                now=now,
                last_event_id=last_event_id,
            )
        )

    def recover_startup(self, *, worker_id: str) -> dict[str, Any]:
        if not hasattr(self.store, "list_by_status"):
            return {"checked": 0, "recovery_required": 0, "resumed": 0}
        running = self.store.list_by_status([DeploymentStatus.RUNNING])
        checked = 0
        recovery_required = 0
        resumed = 0
        for deployment in running:
            checked += 1
            reason = self._startup_recovery_reason(deployment)
            recovery_payload: dict[str, Any] = {"worker_id": worker_id, "status": deployment.status.value}
            if not reason:
                try:
                    recovery_payload = self._recover_shadow_runtime(deployment, worker_id=worker_id)
                except QuantaxisTradingError as exc:
                    reason = str(exc)
                except Exception as exc:  # noqa: BLE001
                    reason = f"startup recovery failed: {exc}"
            if reason:
                recovered = replace(
                    deployment,
                    status=DeploymentStatus.RECOVERY_REQUIRED,
                    updated_at=now_iso(),
                    recovery_reason=reason,
                )
                self.store.update(recovered)
                self._append_deployment_event(
                    recovered,
                    event_type="deployment.recovery_required",
                    idempotency_key=f"deployment:{deployment.deployment_id}:startup_recovery:{worker_id}",
                    payload={"worker_id": worker_id, "reason": reason},
                )
                recovery_required += 1
            else:
                resumed += 1
                self._append_deployment_event(
                    deployment,
                    event_type="deployment.recovered",
                    idempotency_key=f"deployment:{deployment.deployment_id}:startup_recovered:{worker_id}",
                    payload=recovery_payload,
                )
                self.publish_recovery_event(
                    deployment.deployment_id,
                    user_id=deployment.user_id,
                    recovery_event_id=f"startup:{worker_id}",
                    payload=recovery_payload,
                )
        return {"checked": checked, "recovery_required": recovery_required, "resumed": resumed}

    def recover_live_deployment(
        self,
        deployment_id: str,
        *,
        user_id: int,
        broker: str,
    ) -> QuantaxisDeployment:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if deployment.target != DeploymentTarget.LIVE:
            raise QuantaxisTradingError("only live deployments require broker reconciliation")
        if deployment.status != DeploymentStatus.RECOVERY_REQUIRED:
            raise QuantaxisTradingError("only recovery-required live deployments can be reconciled")
        self._require_runtime()
        report = self.live_reconciliation_gate.reconcile(deployment, broker=broker)
        if not bool(report.get("is_safe")):
            reason = str(report.get("reason") or "live broker reconciliation is not safe")
            updated = replace(deployment, updated_at=now_iso(), recovery_reason=reason)
            self.store.update(updated)
            self.publish_recovery_event(
                deployment.deployment_id,
                user_id=deployment.user_id,
                recovery_event_id=f"live_reconcile_blocked:{broker}",
                payload={"broker": broker, "is_safe": False, "reason": reason, "report": report},
            )
            raise QuantaxisTradingError(reason)
        self._register_runtime_task(deployment)
        updated = replace(
            deployment,
            status=DeploymentStatus.RUNNING,
            updated_at=now_iso(),
            recovery_reason="",
            started_at=deployment.started_at or now_iso(),
            paused_at=None,
        )
        saved = self.store.update(updated)
        payload = {"broker": broker, "is_safe": True, "report": report}
        self._append_deployment_event(
            saved,
            event_type="deployment.live_reconciled",
            idempotency_key=f"deployment:{deployment.deployment_id}:live_reconciled:{broker}",
            payload=payload,
        )
        self.publish_recovery_event(
            saved.deployment_id,
            user_id=saved.user_id,
            recovery_event_id=f"live_reconciled:{broker}",
            payload=payload,
        )
        return saved

    def account_snapshot(self, account_cookie: str, *, user_id: int) -> dict[str, Any]:
        deployment = next((item for item in self.list_deployments(user_id=user_id) if item.account_cookie == account_cookie), None)
        if deployment is None:
            raise QuantaxisTradingError("account not found")
        try:
            self._require_runtime()
            return self.qifi_adapter.account_snapshot(deployment)
        except QuantaxisAdapterError as exc:
            raise QuantaxisTradingError(str(exc)) from exc

    def account_orders(self, account_cookie: str, *, user_id: int) -> dict[str, Any]:
        deployment = next((item for item in self.list_deployments(user_id=user_id) if item.account_cookie == account_cookie), None)
        if deployment is None:
            raise QuantaxisTradingError("account not found")
        try:
            self._require_runtime()
            return {"account_cookie": account_cookie, "orders": self.qifi_adapter.account_orders(deployment)}
        except QuantaxisAdapterError as exc:
            raise QuantaxisTradingError(str(exc)) from exc

    def account_trades(self, account_cookie: str, *, user_id: int) -> dict[str, Any]:
        deployment = next((item for item in self.list_deployments(user_id=user_id) if item.account_cookie == account_cookie), None)
        if deployment is None:
            raise QuantaxisTradingError("account not found")
        try:
            self._require_runtime()
            return {"account_cookie": account_cookie, "trades": self.qifi_adapter.account_trades(deployment)}
        except QuantaxisAdapterError as exc:
            raise QuantaxisTradingError(str(exc)) from exc

    def submit_qifi_order_intent(
        self,
        deployment_id: str,
        *,
        user_id: int,
        client_order_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        order_time: str = "",
        fill_immediately: bool = False,
    ) -> dict[str, Any]:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if deployment.status != DeploymentStatus.RUNNING:
            raise QuantaxisTradingError("QIFI order intents require a running deployment")
        try:
            self._require_runtime()
            result = self.qifi_adapter.submit_order_intent(
                deployment,
                client_order_id=client_order_id,
                symbol=symbol,
                side=side,
                quantity=quantity,
                price=price,
                order_time=order_time,
                fill_immediately=fill_immediately,
            )
        except QuantaxisAdapterError as exc:
            raise QuantaxisTradingError(str(exc)) from exc
        order = dict(result.get("order") or {})
        self.publish_order_event(
            deployment.deployment_id,
            user_id=deployment.user_id,
            order_id=str(order.get("order_id") or client_order_id),
            order_event_id=str(order.get("seqno") or client_order_id),
            payload={"source": "QIFI", "order": order},
        )
        return result

    def execute_shadow_order_intent(
        self,
        deployment_id: str,
        *,
        user_id: int,
        client_order_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        order_time: str = "",
    ) -> dict[str, Any]:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if deployment.target != DeploymentTarget.SHADOW:
            raise QuantaxisTradingError("shadow execution requires a SHADOW deployment")
        if deployment.status != DeploymentStatus.RUNNING:
            raise QuantaxisTradingError("shadow execution requires a running deployment")
        try:
            self._require_runtime()
            result = self.shadow_execution_adapter.execute_order_intent(
                deployment,
                client_order_id=client_order_id,
                symbol=symbol,
                side=side,
                quantity=quantity,
                price=price,
                order_time=order_time,
            )
        except QuantaxisAdapterError as exc:
            raise QuantaxisTradingError(str(exc)) from exc
        order = dict(result.get("order") or {})
        snapshot = dict(result.get("snapshot") or {})
        order_id = str(order.get("order_id") or client_order_id)
        self.publish_order_event(
            deployment.deployment_id,
            user_id=deployment.user_id,
            order_id=order_id,
            order_event_id=str(order.get("seqno") or client_order_id),
            payload={"source": "QAMarket/QIFI", "order": order, "market_rule": result.get("market_rule") or {}},
        )
        trades = list(snapshot.get("trades") or [])
        for trade in trades:
            trade_id = str(trade.get("trade_id") or trade.get("order_id") or order_id)
            self.publish_trade_event(
                deployment.deployment_id,
                user_id=deployment.user_id,
                trade_id=trade_id,
                payload={"source": "QIFI", "order_id": order_id, "trade": trade},
            )
        self.publish_account_event(
            deployment.deployment_id,
            user_id=deployment.user_id,
            account_event_id=f"shadow_execution:{client_order_id}",
            payload={"source": "QIFI", "snapshot": snapshot},
        )
        return result

    def execute_deployment_tick(
        self,
        deployment_id: str,
        *,
        user_id: int,
        market_event: dict[str, Any],
        worker_id: str = "",
    ) -> dict[str, Any]:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if deployment.status != DeploymentStatus.RUNNING:
            raise QuantaxisTradingError("deployment ticks require a running deployment")
        market_event_id = str(market_event.get("event_id") or market_event.get("market_event_id") or "").strip()
        if not market_event_id:
            raise QuantaxisTradingError("market_event requires event_id")
        try:
            self._require_runtime()
            self.publish_market_event(
                deployment.deployment_id,
                user_id=deployment.user_id,
                market_event_id=market_event_id,
                payload=dict(market_event),
            )
            snapshot = self.qifi_adapter.account_snapshot(deployment)
            signal_payload = self.strategy_runtime.evaluate_tick(
                deployment,
                market_event=dict(market_event),
                account_snapshot=snapshot,
            )
            signal_event = self.publish_signal_event(
                deployment.deployment_id,
                user_id=deployment.user_id,
                signal_id=market_event_id,
                payload=signal_payload,
            )
            intent = dict(signal_payload.get("intent") or {})
            execution = None
            if intent:
                self._validate_order_intent_policy(deployment, intent)
                client_order_id = str(intent.get("client_order_id") or self._client_order_id(deployment, market_event_id))
                adapter = self.shadow_execution_adapter if deployment.target == DeploymentTarget.SHADOW else self.live_execution_adapter
                execution = adapter.execute_order_intent(
                    deployment,
                    client_order_id=client_order_id,
                    symbol=str(intent["symbol"]),
                    side=str(intent["side"]),
                    quantity=float(intent["quantity"]),
                    price=float(intent["price"]),
                    order_time=str(intent.get("order_time") or market_event.get("datetime") or ""),
                )
                self._publish_execution_events(
                    deployment,
                    client_order_id=client_order_id,
                    execution=execution,
                    source="QAMarket/QIFI" if deployment.target == DeploymentTarget.SHADOW else "LIVE_GATE",
                )
            if hasattr(self.store, "save_event_offset"):
                self.store.save_event_offset(
                    deployment_id=deployment.deployment_id,
                    consumer_name=f"worker:tick:{worker_id or 'default'}",
                    event_scope="market",
                    last_event_id=market_event_id,
                    last_sequence_no=int(signal_event.get("sequence_no") or 0),
                    updated_at=now_iso(),
                )
            return {
                "deployment_id": deployment.deployment_id,
                "target": deployment.target.value,
                "market_event_id": market_event_id,
                "signal": signal_payload,
                "execution": execution,
            }
        except (QuantaxisAdapterError, QuantaxisStrategyRuntimeError) as exc:
            raise QuantaxisTradingError(str(exc)) from exc

    def deployment_signals(
        self,
        deployment_id: str,
        *,
        user_id: int,
        market_event: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        try:
            self._require_runtime()
            snapshot = self.qifi_adapter.account_snapshot(deployment)
            event_payload = self.strategy_runtime.evaluate_tick(
                deployment,
                market_event=dict(market_event or self._default_market_event(deployment)),
                account_snapshot=snapshot,
            )
        except (QuantaxisAdapterError, QuantaxisStrategyRuntimeError) as exc:
            raise QuantaxisTradingError(str(exc)) from exc
        signal_id = str(event_payload.get("market_event_id") or now_iso())
        stored = self.publish_signal_event(
            deployment.deployment_id,
            user_id=deployment.user_id,
            signal_id=signal_id,
            payload=event_payload,
        )
        return {
            "deployment_id": deployment.deployment_id,
            "signals": [event_payload],
            "event": stored,
        }

    def deployment_events(self, deployment_id: str, *, user_id: int) -> dict[str, Any]:
        return self.runtime_events(deployment_id, user_id=user_id)

    def publish_runtime_event(
        self,
        deployment_id: str,
        *,
        user_id: int,
        event_scope: str,
        event_type: str,
        idempotency_key: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        return self._append_runtime_event(
            deployment,
            event_scope=event_scope,
            event_type=event_type,
            idempotency_key=idempotency_key,
            payload=payload,
            publish=True,
        )

    def publish_market_event(
        self,
        deployment_id: str,
        *,
        user_id: int,
        market_event_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        return self.publish_runtime_event(
            deployment_id,
            user_id=user_id,
            event_scope="market",
            event_type="market.event",
            idempotency_key=f"market:{deployment_id}:{market_event_id}",
            payload=payload,
        )

    def publish_signal_event(
        self,
        deployment_id: str,
        *,
        user_id: int,
        signal_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        return self.publish_runtime_event(
            deployment_id,
            user_id=user_id,
            event_scope="signal",
            event_type="strategy.signal",
            idempotency_key=f"signal:{deployment_id}:{signal_id}",
            payload=payload,
        )

    def publish_account_event(
        self,
        deployment_id: str,
        *,
        user_id: int,
        account_event_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        return self.publish_runtime_event(
            deployment_id,
            user_id=user_id,
            event_scope="account",
            event_type="account.changed",
            idempotency_key=f"account:{deployment_id}:{account_event_id}",
            payload=payload,
        )

    def publish_order_event(
        self,
        deployment_id: str,
        *,
        user_id: int,
        order_id: str,
        order_event_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        event_payload = {"order_id": order_id, **payload}
        return self.publish_runtime_event(
            deployment_id,
            user_id=user_id,
            event_scope="order",
            event_type="order.changed",
            idempotency_key=f"order:{deployment_id}:{order_id}:{order_event_id}",
            payload=event_payload,
        )

    def publish_trade_event(
        self,
        deployment_id: str,
        *,
        user_id: int,
        trade_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        event_payload = {"trade_id": trade_id, **payload}
        return self.publish_runtime_event(
            deployment_id,
            user_id=user_id,
            event_scope="trade",
            event_type="trade.created",
            idempotency_key=f"trade:{deployment_id}:{trade_id}",
            payload=event_payload,
        )

    def publish_recovery_event(
        self,
        deployment_id: str,
        *,
        user_id: int,
        recovery_event_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        return self.publish_runtime_event(
            deployment_id,
            user_id=user_id,
            event_scope="recovery",
            event_type="deployment.recovery",
            idempotency_key=f"recovery:{deployment_id}:{recovery_event_id}",
            payload=payload,
        )

    def _strategy_version(self, strategy_id: str, *, user_id: int, version_no: int | None) -> StrategyVersionSnapshot:
        versions = self.strategy_store.list_strategy_versions(strategy_id, user_id=user_id)
        if not versions:
            raise QuantaxisTradingError("strategy requires an immutable version before deployment")
        selected = next((item for item in versions if int(item.get("version") or 0) == int(version_no)), None) if version_no else versions[0]
        if selected is None:
            raise QuantaxisTradingError("strategy version not found")
        return StrategyVersionSnapshot.from_version_row(selected)

    def _validate_strategy_runtime(self, snapshot: StrategyVersionSnapshot) -> None:
        try:
            self.strategy_runtime.validate_package(snapshot.code)
        except QuantaxisStrategyRuntimeError as exc:
            raise QuantaxisTradingError(str(exc)) from exc

    def _deployable_strategy_snapshot(self, snapshot: StrategyVersionSnapshot) -> StrategyVersionSnapshot:
        """Return a runtime-safe snapshot for script-style exchange strategies.

        Some catalog/imported strategies are full trading scripts that import
        exchange SDKs such as ccxt and place orders directly. Deployments must
        still run through QAStrategy/QIFI, so adapt only those scripts into a
        market-event-driven SignalEngine instead of opening the runtime import
        boundary.
        """
        if str(snapshot.language or "").lower() != "python":
            return snapshot
        try:
            self.strategy_runtime.validate_package(snapshot.code)
            return snapshot
        except QuantaxisStrategyRuntimeError as exc:
            if not _looks_like_external_exchange_script(snapshot.code, str(exc)):
                return snapshot
        adapted = _render_exchange_script_signal_engine(snapshot)
        return replace(snapshot, code=adapted, code_sha256=_sha256(adapted))

    @staticmethod
    def _target(value: str) -> DeploymentTarget:
        try:
            return DeploymentTarget(str(value or "").strip().upper())
        except ValueError as exc:
            raise QuantaxisTradingError("target must be SHADOW or LIVE") from exc

    @staticmethod
    def _normalize_symbol(value: Any) -> str:
        symbol = str(value or "").strip().upper().replace("/", "_").replace("-", "_")
        if not symbol:
            raise QuantaxisTradingError("symbol is required")
        return symbol

    @staticmethod
    def _require_runtime() -> None:
        status = runtime_status()
        if not status.get("available"):
            raise QuantaxisTradingError(f"QUANTAXIS runtime unavailable: {status.get('error') or 'unknown error'}")
        try:
            load_quantaxis_modules()
        except Exception as exc:  # noqa: BLE001
            raise QuantaxisTradingError(f"QUANTAXIS runtime unavailable: {exc}") from exc

    @staticmethod
    def _startup_recovery_reason(deployment: QuantaxisDeployment) -> str:
        status = runtime_status()
        if not status.get("available"):
            return f"QUANTAXIS runtime unavailable during startup recovery: {status.get('error') or 'unknown error'}"
        requires = dict(status.get("requires") or {})
        if not requires.get("mongo"):
            return "QUANTAXIS Mongo/QIFI durable store is not configured"
        if not requires.get("qifi_password"):
            return "QUANTAXIS QIFI password is not configured"
        if deployment.target == DeploymentTarget.LIVE:
            return "live broker reconciliation is required before resume"
        return ""

    def _recover_shadow_runtime(self, deployment: QuantaxisDeployment, *, worker_id: str) -> dict[str, Any]:
        try:
            snapshot = self.qifi_adapter.account_snapshot(deployment)
            orders = self.qifi_adapter.account_orders(deployment)
            trades = self.qifi_adapter.account_trades(deployment)
        except QuantaxisAdapterError as exc:
            raise QuantaxisTradingError(str(exc)) from exc
        self._register_runtime_task(deployment)
        market_offset = None
        if hasattr(self.store, "get_event_offset"):
            market_offset = self.store.get_event_offset(
                deployment_id=deployment.deployment_id,
                consumer_name="worker:tick",
                event_scope="market",
            )
        return {
            "worker_id": worker_id,
            "status": deployment.status.value,
            "account_cookie": deployment.account_cookie,
            "open_orders": len(orders),
            "trades": len(trades),
            "positions": len(snapshot.get("positions") or []),
            "market_offset": dict(market_offset) if market_offset else None,
            "task_restored": True,
        }

    def _append_deployment_event(
        self,
        deployment: QuantaxisDeployment,
        *,
        event_type: str,
        idempotency_key: str,
        payload: dict[str, Any],
    ) -> None:
        self._append_runtime_event(
            deployment,
            event_scope="deployment",
            event_type=event_type,
            idempotency_key=idempotency_key,
            payload=payload,
            publish=True,
        )

    def _register_runtime_task(self, deployment: QuantaxisDeployment) -> dict[str, Any] | None:
        if not hasattr(self.store, "register_runtime_task"):
            return None
        payload = {
            "deployment_id": deployment.deployment_id,
            "account_cookie": deployment.account_cookie,
            "target": deployment.target.value,
            "strategy_version_id": deployment.strategy_snapshot.version_id,
            "market": deployment.market,
            "symbols": list(deployment.symbols),
            "timeframe": deployment.timeframe,
        }
        task = self.engine_adapter.register_deployment_task(deployment, task_type="tick", payload=payload)
        task_record = self.store.register_runtime_task(
            task_id=f"qrtask:{deployment.deployment_id}:tick",
            deployment_id=deployment.deployment_id,
            task_type="tick",
            qa_task_id=str(getattr(task, "task_id", "")),
            engine_name="QAEngine",
            payload=payload,
            created_at=now_iso(),
        )
        self._append_runtime_event(
            deployment,
            event_scope="deployment",
            event_type="deployment.task_registered",
            idempotency_key=f"deployment:{deployment.deployment_id}:task_registered:tick:{task_record['qa_task_id']}",
            payload={
                "task_id": task_record["task_id"],
                "qa_task_id": task_record["qa_task_id"],
                "task_type": task_record["task_type"],
            },
            publish=True,
        )
        return task_record

    def _validate_order_intent_policy(self, deployment: QuantaxisDeployment, intent: dict[str, Any]) -> None:
        required = ("symbol", "side", "quantity", "price")
        missing = [field for field in required if intent.get(field) in (None, "")]
        if missing:
            raise QuantaxisTradingError(f"strategy order intent missing: {', '.join(missing)}")
        quantity = float(intent["quantity"])
        price = float(intent["price"])
        if quantity <= 0 or price <= 0:
            raise QuantaxisTradingError("strategy order intent requires positive quantity and price")
        max_notional = deployment.risk_policy.get("max_order_notional")
        if max_notional is not None and quantity * price > float(max_notional):
            raise QuantaxisTradingError("strategy order intent exceeds deployment max_order_notional")

    @staticmethod
    def _client_order_id(deployment: QuantaxisDeployment, market_event_id: str) -> str:
        return f"{deployment.deployment_id}:{deployment.strategy_snapshot.version_id}:{market_event_id}"

    def _publish_execution_events(
        self,
        deployment: QuantaxisDeployment,
        *,
        client_order_id: str,
        execution: dict[str, Any],
        source: str,
    ) -> None:
        order = dict(execution.get("order") or execution.get("broker_order") or {})
        snapshot = dict(execution.get("snapshot") or {})
        order_id = str(order.get("order_id") or order.get("id") or client_order_id)
        self.publish_order_event(
            deployment.deployment_id,
            user_id=deployment.user_id,
            order_id=order_id,
            order_event_id=str(order.get("seqno") or order.get("status") or client_order_id),
            payload={"source": source, "order": order, "raw": execution},
        )
        for trade in list(snapshot.get("trades") or execution.get("trades") or []):
            trade_id = str(trade.get("trade_id") or trade.get("order_id") or order_id)
            self.publish_trade_event(
                deployment.deployment_id,
                user_id=deployment.user_id,
                trade_id=trade_id,
                payload={"source": source, "order_id": order_id, "trade": dict(trade)},
            )
        if snapshot:
            self.publish_account_event(
                deployment.deployment_id,
                user_id=deployment.user_id,
                account_event_id=f"execution:{client_order_id}",
                payload={"source": source, "snapshot": snapshot},
            )

    @staticmethod
    def _default_market_event(deployment: QuantaxisDeployment) -> dict[str, Any]:
        return {
            "event_id": f"manual:{deployment.deployment_id}:{now_iso()}",
            "symbol": deployment.symbols[0] if deployment.symbols else "",
            "market": deployment.market,
            "timeframe": deployment.timeframe,
            "datetime": now_iso(),
        }

    def _cancel_runtime_tasks(self, deployment: QuantaxisDeployment) -> int:
        self.engine_adapter.cancel_deployment_tasks(deployment_id=deployment.deployment_id, task_type="tick")
        if not hasattr(self.store, "cancel_runtime_tasks"):
            return 0
        cancelled = int(
            self.store.cancel_runtime_tasks(
                deployment_id=deployment.deployment_id,
                task_type="tick",
                cancelled_at=now_iso(),
            )
        )
        if cancelled:
            self._append_runtime_event(
                deployment,
                event_scope="deployment",
                event_type="deployment.task_cancelled",
                idempotency_key=f"deployment:{deployment.deployment_id}:task_cancelled:tick:{now_iso()}",
                payload={"task_type": "tick", "cancelled": cancelled},
                publish=True,
            )
        return cancelled

    def _append_runtime_event(
        self,
        deployment: QuantaxisDeployment,
        *,
        event_scope: str,
        event_type: str,
        idempotency_key: str,
        payload: dict[str, Any],
        event_id: str | None = None,
        publish: bool,
    ) -> dict[str, Any]:
        if not hasattr(self.store, "append_runtime_event"):
            return {}
        ts = now_iso()
        generated_event_id = event_id or new_id("qaevt")
        event = self.store.append_runtime_event(
            event_id=generated_event_id,
            deployment_id=deployment.deployment_id,
            account_cookie=deployment.account_cookie,
            event_scope=event_scope,
            event_type=event_type,
            idempotency_key=idempotency_key,
            payload=payload,
            created_at=ts,
        )
        if publish and str(event.get("event_id") or "") == generated_event_id:
            try:
                self.pubsub_adapter.publish_event(event)
            except Exception:
                pass
        return event

    def build_engine_task(self, deployment_id: str, *, user_id: int, event_type: str, message: dict[str, Any]) -> Any:
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        payload = {"deployment_id": deployment.deployment_id, "account_cookie": deployment.account_cookie, **message}
        return QuantaxisEngineAdapter.build_task(event_type=event_type, message=payload, run=lambda event: event.message)


_RUNTIME_EVENT_FIELDS = {
    "event_id",
    "deployment_id",
    "account_cookie",
    "event_scope",
    "event_type",
    "sequence_no",
    "idempotency_key",
    "payload",
    "created_at",
}


def _looks_like_external_exchange_script(code: str, validation_error: str) -> bool:
    text = str(code or "")
    lowered_error = str(validation_error or "").lower()
    if "outside restricted runtime" not in lowered_error:
        # Keep this narrow: only adapt scripts that were rejected by the runtime
        # boundary, not arbitrary malformed Python.
        if "qastrategy" not in lowered_error and "signalengine" not in lowered_error:
            return False
    markers = (
        "import ccxt",
        "ccxt.",
        "fetch_ohlcv",
        "fetch_ticker",
        "create_limit_buy_order",
        "create_limit_sell_order",
    )
    return any(marker in text for marker in markers)


def _render_exchange_script_signal_engine(snapshot: StrategyVersionSnapshot) -> str:
    strategy_name = repr(snapshot.name or snapshot.strategy_id)
    strategy_id = repr(snapshot.strategy_id)
    return f'''# Auto-generated deployment adapter for {strategy_name}.
# Original source is a full exchange script; deployments use market_event input
# and route orders through QAStrategy/QIFI instead of importing exchange SDKs.

STRATEGY_ID = {strategy_id}
STRATEGY_NAME = {strategy_name}


class SignalEngine:
    def generate_signal(self, context):
        event = context.get("market_event") or {{}}
        params = context.get("parameters") or {{}}
        symbol = event.get("symbol") or params.get("symbol") or ""
        close = event.get("close") or event.get("price")
        if close is None:
            return {{"action": "HOLD", "reason": "missing market price"}}

        price = float(close)
        reference = params.get("reference_price") or params.get("base_price")
        if reference is None:
            return {{
                "action": "HOLD",
                "symbol": symbol,
                "price": price,
                "reason": "waiting for reference_price parameter",
            }}

        reference_price = float(reference)
        grid_step = float(params.get("grid_step_percent") or 0.01)
        order_notional = float(params.get("order_notional") or params.get("grid_notional") or 100.0)
        if price <= reference_price * (1.0 - grid_step):
            return {{
                "action": "BUY",
                "symbol": symbol,
                "quantity": order_notional / price,
                "price": price,
                "reason": "adapted grid lower band",
            }}
        if price >= reference_price * (1.0 + grid_step):
            return {{
                "action": "SELL",
                "symbol": symbol,
                "quantity": order_notional / price,
                "price": price,
                "reason": "adapted grid upper band",
            }}
        return {{"action": "HOLD", "symbol": symbol, "price": price, "reason": "inside grid band"}}
'''


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class DefaultLiveReconciliationGate:
    """Validate live recovery with the existing mandate, halt, and reconcile gates."""

    def reconcile(self, deployment: QuantaxisDeployment, *, broker: str) -> dict[str, Any]:
        broker_key = str(broker or "").strip().lower()
        if not broker_key:
            raise QuantaxisTradingError("live reconciliation requires broker")
        from src.live.halt import halt_flag_set
        from src.live.mandate.store import load_mandate
        from src.live.runtime.reconcile import reconcile

        mandate = load_mandate(broker_key)
        if mandate is None:
            raise QuantaxisTradingError(f"no committed mandate for {broker_key}")
        if _mandate_expired(mandate):
            raise QuantaxisTradingError(f"mandate for {broker_key} has expired; re-authorize first")
        if halt_flag_set(broker=broker_key) or halt_flag_set(broker=None):
            raise QuantaxisTradingError("kill switch is tripped; resume before live reconciliation")

        snapshot = self._qifi_snapshot_for_reconcile(deployment)
        report = reconcile(
            broker_key,
            read_positions=lambda: list(snapshot.get("positions") or []),
            read_balance=lambda: dict(snapshot.get("accounts") or {}),
            read_open_orders=lambda: list(snapshot.get("orders") or []),
        )
        deltas = [getattr(delta, "__dict__", dict(delta) if isinstance(delta, dict) else {"value": str(delta)}) for delta in getattr(report, "deltas", [])]
        return {
            "broker": broker_key,
            "is_safe": bool(getattr(report, "is_safe", False)),
            "requires_halt": bool(getattr(report, "requires_halt", False)),
            "state_persisted": bool(getattr(report, "state_persisted", False)),
            "had_prior_state": bool(getattr(report, "had_prior_state", False)),
            "recorded_client_order_ids": list(getattr(report, "recorded_client_order_ids", ()) or ()),
            "deltas": deltas,
        }

    @staticmethod
    def _qifi_snapshot_for_reconcile(deployment: QuantaxisDeployment) -> dict[str, Any]:
        adapter = QifiProjectionAdapter()
        return adapter.account_snapshot(deployment)


def _mandate_expired(mandate: Any) -> bool:
    raw = getattr(getattr(mandate, "consent", None), "expires_at", "")
    if not raw:
        return True
    try:
        from datetime import datetime, timezone

        expires_at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return expires_at <= datetime.now(timezone.utc)
    except ValueError:
        return True
