"""QUANTAXIS runtime adapters.

This module keeps direct QUANTAXIS calls out of the product API/service layer.
It does not calculate trading state; it only configures QUANTAXIS objects and
normalizes their message projections for API transport.
"""

from __future__ import annotations

import json
import os
import queue
import threading
from dataclasses import dataclass
from typing import Any, Protocol

from src.quantaxis_native.loader import load_quantaxis_modules, runtime_status
from src.quantaxis_native.models import DeploymentTarget, QuantaxisDeployment


class QuantaxisAdapterError(RuntimeError):
    """Raised when a QUANTAXIS adapter cannot operate safely."""


class QuantaxisEngineRegistry(Protocol):
    def register_task(self, task: Any, *, deployment: QuantaxisDeployment, task_type: str, payload: dict[str, Any]) -> None: ...

    def cancel_tasks(self, *, deployment_id: str, task_type: str | None = None) -> None: ...


class QifiOrderAdapterLike(Protocol):
    def submit_order_intent(
        self,
        deployment: QuantaxisDeployment,
        *,
        client_order_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        order_time: str = "",
        fill_immediately: bool = False,
    ) -> dict[str, Any]: ...


class LiveOrderAdapterLike(Protocol):
    def execute_order_intent(
        self,
        deployment: QuantaxisDeployment,
        *,
        client_order_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        order_time: str = "",
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class QuantaxisDurableStoreConfig:
    mongo_uri: str
    qifi_password: str
    qifi_dbname: str
    qapubsub_host: str
    qapubsub_port: int
    qapubsub_user: str
    qapubsub_password: str
    qapubsub_exchange: str

    @classmethod
    def from_env(cls) -> "QuantaxisDurableStoreConfig":
        mongo_uri = _first_env("QUANTAXIS_MONGOURI", "MONGOURI", "MONGODB")
        qifi_password = _first_env("VIBE_QUANTAXIS_QIFI_PASSWORD", "QUANTAXIS_QIFI_PASSWORD")
        qapubsub_host = _first_env("QAPUBSUB_HOST", "EVENTMQ_IP")
        return cls(
            mongo_uri=mongo_uri,
            qifi_password=qifi_password,
            qifi_dbname=os.getenv("VIBE_QUANTAXIS_QIFI_DBNAME", "mongodb").strip() or "mongodb",
            qapubsub_host=qapubsub_host,
            qapubsub_port=_int_env("QAPUBSUB_PORT", 5672),
            qapubsub_user=os.getenv("QAPUBSUB_USER", "guest").strip() or "guest",
            qapubsub_password=os.getenv("QAPUBSUB_PASSWORD", "guest").strip() or "guest",
            qapubsub_exchange=os.getenv("VIBE_QUANTAXIS_QAPUBSUB_EXCHANGE", "vibe.quantaxis").strip()
            or "vibe.quantaxis",
        )

    def require_qifi(self) -> None:
        if not self.mongo_uri:
            raise QuantaxisAdapterError("QUANTAXIS Mongo/QIFI durable store is not configured")
        if not self.qifi_password:
            raise QuantaxisAdapterError("QUANTAXIS QIFI password is not configured")

    def require_qapubsub(self) -> None:
        if not self.qapubsub_host:
            raise QuantaxisAdapterError("QUANTAXIS QAPubSub host is not configured")

    def to_status(self) -> dict[str, Any]:
        return {
            "mongo": self.mongo_uri,
            "qifi_password": "configured" if self.qifi_password else "",
            "qifi_dbname": self.qifi_dbname,
            "rabbitmq": self.qapubsub_host,
            "qapubsub_port": str(self.qapubsub_port) if self.qapubsub_host else "",
            "qapubsub_exchange": self.qapubsub_exchange if self.qapubsub_host else "",
        }


class QifiProjectionAdapter:
    """Read QIFI account/order/trade projections from QUANTAXIS storage."""

    def __init__(self, *, config: QuantaxisDurableStoreConfig | None = None) -> None:
        self.config = config or QuantaxisDurableStoreConfig.from_env()

    def account_snapshot(self, deployment: QuantaxisDeployment) -> dict[str, Any]:
        account = self._load_account(deployment)
        return self._snapshot_from_account(account, deployment)

    def _snapshot_from_account(self, account: Any, deployment: QuantaxisDeployment) -> dict[str, Any]:
        message = dict(account.message)
        accounts = dict(message.get("accounts") or {})
        positions = _dict_values(message.get("positions"))
        orders = _dict_values(message.get("orders"))
        trades = _dict_values(message.get("trades"))
        return {
            "account_cookie": str(message.get("account_cookie") or deployment.account_cookie),
            "target": deployment.target.value,
            "model": str(message.get("model") or self._model(deployment)),
            "broker_name": str(message.get("broker_name") or ""),
            "trading_day": str(message.get("trading_day") or ""),
            "updated_at": str(message.get("updatetime") or ""),
            "cash": accounts.get("available"),
            "frozen": accounts.get("frozen_margin"),
            "market_value": accounts.get("margin"),
            "total_asset": accounts.get("balance"),
            "risk_ratio": accounts.get("risk_ratio"),
            "accounts": accounts,
            "positions": positions,
            "orders": orders,
            "trades": trades,
            "raw": message,
        }

    def account_orders(self, deployment: QuantaxisDeployment) -> list[dict[str, Any]]:
        return list(self.account_snapshot(deployment).get("orders") or [])

    def account_trades(self, deployment: QuantaxisDeployment) -> list[dict[str, Any]]:
        return list(self.account_snapshot(deployment).get("trades") or [])

    def submit_order_intent(
        self,
        deployment: QuantaxisDeployment,
        *,
        client_order_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        order_time: str = "",
        fill_immediately: bool = False,
    ) -> dict[str, Any]:
        account = self._load_account(deployment)
        amount = float(quantity)
        if amount <= 0:
            raise QuantaxisAdapterError("QIFI order quantity must be positive")
        order = account.send_order(
            code=_normalize_qifi_symbol(symbol),
            amount=amount,
            price=float(price),
            towards=_qifi_towards(side),
            order_id=str(client_order_id),
            datetime=str(order_time or ""),
        )
        if not order:
            raise QuantaxisAdapterError("QIFI rejected order intent")
        if fill_immediately and hasattr(account, "make_deal"):
            account.make_deal(order)
        sync = getattr(account, "sync", None)
        if callable(sync):
            sync()
        return {"order": dict(order), "snapshot": self._snapshot_from_account(account, deployment)}

    def _load_account(self, deployment: QuantaxisDeployment) -> Any:
        self.config.require_qifi()
        modules = load_quantaxis_modules()
        kwargs: dict[str, Any] = {
            "username": deployment.account_cookie,
            "password": self.config.qifi_password,
            "model": self._model(deployment),
            "trade_host": self.config.mongo_uri,
            "dbname": self.config.qifi_dbname,
            "broker_name": self._broker_name(deployment),
            "portfolioname": f"vibe:{deployment.user_id}",
        }
        if deployment.target == DeploymentTarget.SHADOW:
            kwargs["init_cash"] = self._shadow_initial_cash(deployment)
        account = modules.qifi_account(**kwargs)
        account.initial()
        return account

    @staticmethod
    def _model(deployment: QuantaxisDeployment) -> str:
        return "REAL" if deployment.target == DeploymentTarget.LIVE else "SIM"

    @staticmethod
    def _broker_name(deployment: QuantaxisDeployment) -> str:
        if deployment.target == DeploymentTarget.LIVE:
            return f"VibeLive:{deployment.broker_binding_id or 'unbound'}"
        return "VibeQuantaxisShadow"

    @staticmethod
    def _shadow_initial_cash(deployment: QuantaxisDeployment) -> float:
        value = deployment.risk_policy.get("initial_cash", deployment.parameters.get("initial_cash"))
        if value is None:
            raise QuantaxisAdapterError("shadow QIFI account requires explicit initial_cash")
        try:
            amount = float(value)
        except (TypeError, ValueError) as exc:
            raise QuantaxisAdapterError("shadow initial_cash must be numeric") from exc
        if amount <= 0:
            raise QuantaxisAdapterError("shadow initial_cash must be positive")
        return amount


class QuantaxisShadowExecutionAdapter:
    """Execute shadow intents through QAMarket normalization and QIFI state."""

    def __init__(self, *, qifi_adapter: QifiOrderAdapterLike | None = None) -> None:
        self.qifi_adapter = qifi_adapter or QifiProjectionAdapter()

    def execute_order_intent(
        self,
        deployment: QuantaxisDeployment,
        *,
        client_order_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        order_time: str = "",
    ) -> dict[str, Any]:
        if deployment.target != DeploymentTarget.SHADOW:
            raise QuantaxisAdapterError("shadow execution adapter only accepts SHADOW deployments")
        normalized_symbol = _normalize_qifi_symbol(symbol)
        market_rule = self._market_rule(normalized_symbol)
        result = self.qifi_adapter.submit_order_intent(
            deployment,
            client_order_id=client_order_id,
            symbol=normalized_symbol,
            side=side,
            quantity=self._normalize_quantity(quantity, market_rule),
            price=self._normalize_price(price, market_rule),
            order_time=order_time,
            fill_immediately=True,
        )
        return {
            **result,
            "market_rule": market_rule,
            "execution_target": "QAMarket/QIFI",
            "shadow_matching": "QIFI.make_deal",
        }

    @staticmethod
    def _market_rule(symbol: str) -> dict[str, Any]:
        modules = load_quantaxis_modules()
        preset_factory = getattr(modules, "market_preset", None)
        if preset_factory is None:
            return {"symbol": symbol}
        try:
            preset = preset_factory()
            raw = preset.get_code(symbol)
        except Exception:
            raw = None
        rule = dict(raw or {})
        rule["symbol"] = symbol
        if "exchange" not in rule and hasattr(preset if "preset" in locals() else None, "get_exchange"):
            try:
                rule["exchange"] = preset.get_exchange(symbol)
            except Exception:
                pass
        return rule

    @staticmethod
    def _normalize_quantity(quantity: float, market_rule: dict[str, Any]) -> float:
        amount = float(quantity)
        if amount <= 0:
            raise QuantaxisAdapterError("shadow order quantity must be positive")
        min_amount = float(market_rule.get("min_amount") or 0)
        if min_amount and amount < min_amount:
            raise QuantaxisAdapterError("shadow order quantity is below QAMarket minimum")
        return amount

    @staticmethod
    def _normalize_price(price: float, market_rule: dict[str, Any]) -> float:
        value = float(price)
        if value <= 0:
            raise QuantaxisAdapterError("shadow order price must be positive")
        tick = float(market_rule.get("price_tick") or 0)
        if tick > 0:
            return round(round(value / tick) * tick, 10)
        return value


class BrokerLiveExecutionAdapter:
    """Route live intents through the existing mandate-gated connector service."""

    def execute_order_intent(
        self,
        deployment: QuantaxisDeployment,
        *,
        client_order_id: str,
        symbol: str,
        side: str,
        quantity: float,
        price: float,
        order_time: str = "",
    ) -> dict[str, Any]:
        if deployment.target != DeploymentTarget.LIVE:
            raise QuantaxisAdapterError("live execution adapter only accepts LIVE deployments")
        profile_id = str(
            deployment.risk_policy.get("connector_profile_id")
            or deployment.risk_policy.get("live_connector_profile_id")
            or ""
        ).strip()
        broker = str(deployment.risk_policy.get("broker") or "").strip().lower()
        if not profile_id and broker:
            try:
                from src.trading.service import connector_profile_id_for_broker

                profile_id = connector_profile_id_for_broker(broker)
            except Exception as exc:  # noqa: BLE001
                raise QuantaxisAdapterError(str(exc)) from exc
        if not profile_id:
            raise QuantaxisAdapterError("live execution requires connector_profile_id or broker in deployment risk_policy")
        try:
            from src.trading.service import place_order

            result = place_order(
                symbol=symbol,
                profile_id=profile_id,
                side=side,
                quantity=float(quantity),
                order_type="limit",
                limit_price=float(price),
                time_in_force=str(deployment.risk_policy.get("time_in_force") or "day"),
                session_id=str(deployment.risk_policy.get("session_id") or deployment.deployment_id),
                client_order_id=str(client_order_id),
                order_time=str(order_time or ""),
            )
        except Exception as exc:  # noqa: BLE001
            raise QuantaxisAdapterError(str(exc)) from exc
        if not isinstance(result, dict):
            raise QuantaxisAdapterError("live broker connector returned a non-dict result")
        if str(result.get("status") or "").lower() == "blocked":
            raise QuantaxisAdapterError(str(result.get("reason") or "live order blocked by mandate gate"))
        return {
            "order": dict(result),
            "broker_order": dict(result),
            "connector_profile_id": profile_id,
            "broker": broker,
            "execution_target": "LIVE_GATE",
            "client_order_id": client_order_id,
        }


class QuantaxisPubSubAdapter:
    """Best-effort QAPubSub publisher for runtime events."""

    def __init__(self, *, config: QuantaxisDurableStoreConfig | None = None) -> None:
        self.config = config or QuantaxisDurableStoreConfig.from_env()

    def publish_event(self, event: dict[str, Any]) -> bool:
        self.config.require_qapubsub()
        modules = load_quantaxis_modules()
        publisher = modules.publisher_topic(
            host=self.config.qapubsub_host,
            port=self.config.qapubsub_port,
            user=self.config.qapubsub_user,
            password=self.config.qapubsub_password,
            exchange=self.config.qapubsub_exchange,
            routing_key=self.routing_key(event),
            durable=True,
        )
        try:
            publisher.pub(json.dumps(event, ensure_ascii=False, sort_keys=True), self.routing_key(event))
        finally:
            close = getattr(publisher, "exit", None)
            if callable(close):
                close()
        return True

    def subscribe_events(self, *, deployment_id: str, stop_event: threading.Event) -> "queue.Queue[dict[str, Any]]":
        """Subscribe to deployment-scoped QAPubSub events on a background thread."""
        self.config.require_qapubsub()
        events: queue.Queue[dict[str, Any]] = queue.Queue()
        routing_key = f"vibe.quantaxis.*.*.{deployment_id}"
        thread = threading.Thread(
            target=self._consume_events,
            kwargs={"routing_key": routing_key, "events": events, "stop_event": stop_event},
            name=f"qa-pubsub-sse-{deployment_id}",
            daemon=True,
        )
        thread.start()
        return events

    def _consume_events(
        self,
        *,
        routing_key: str,
        events: "queue.Queue[dict[str, Any]]",
        stop_event: threading.Event,
    ) -> None:
        modules = load_quantaxis_modules()
        subscriber = modules.subscriber_topic(
            host=self.config.qapubsub_host,
            port=self.config.qapubsub_port,
            user=self.config.qapubsub_user,
            password=self.config.qapubsub_password,
            exchange=self.config.qapubsub_exchange,
            routing_key=routing_key,
            durable=True,
        )

        def callback(_chan, method_frame, _header_frame, body, _userdata=None):
            event = self._decode_event(body)
            if event:
                events.put(event)
            delivery_tag = getattr(method_frame, "delivery_tag", None)
            channel = getattr(subscriber, "channel", None)
            if delivery_tag is not None and hasattr(channel, "basic_ack"):
                channel.basic_ack(delivery_tag=delivery_tag)

        try:
            subscriber.callback = callback
            channel = getattr(subscriber, "channel", None)
            while not stop_event.is_set():
                if channel is not None and hasattr(channel, "basic_consume"):
                    channel.basic_consume(subscriber.queue, callback, auto_ack=False)
                    channel.start_consuming()
                    break
                subscriber.subscribe()
                break
        except Exception as exc:  # noqa: BLE001
            events.put({"event_type": "deployment.gateway_error", "payload": {"error": str(exc)}})
        finally:
            close = getattr(subscriber, "close", None) or getattr(subscriber, "exit", None)
            if callable(close):
                close()

    @staticmethod
    def _decode_event(body: Any) -> dict[str, Any] | None:
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        if isinstance(body, str):
            try:
                value = json.loads(body)
            except json.JSONDecodeError:
                return {"event_type": "deployment.raw", "payload": {"body": body}}
        elif isinstance(body, dict):
            value = body
        else:
            return None
        return dict(value) if isinstance(value, dict) else None

    @staticmethod
    def routing_key(event: dict[str, Any]) -> str:
        scope = str(event.get("event_scope") or "deployment").replace("/", ".")
        event_type = str(event.get("event_type") or "event").replace("/", ".")
        deployment_id = str(event.get("deployment_id") or "unknown")
        return f"vibe.quantaxis.{scope}.{event_type}.{deployment_id}"


class QuantaxisEngineAdapter:
    """Create QAEngine tasks for deployment lifecycle events."""

    def __init__(self, *, registry: QuantaxisEngineRegistry | None = None) -> None:
        self.registry = registry

    @staticmethod
    def build_task(*, event_type: str, message: dict[str, Any], run) -> Any:
        modules = load_quantaxis_modules()

        class DeploymentWorker(modules.qa_worker):
            def run(self, event):
                return run(event)

        event = modules.qa_event(event_type=event_type, message=message)
        return modules.qa_task(DeploymentWorker(), event)

    def register_deployment_task(self, deployment: QuantaxisDeployment, *, task_type: str, payload: dict[str, Any]) -> Any:
        task = self.build_task(event_type=f"deployment.{task_type}", message=payload, run=lambda event: event.message)
        if self.registry is not None:
            self.registry.register_task(task, deployment=deployment, task_type=task_type, payload=payload)
        return task

    def cancel_deployment_tasks(self, *, deployment_id: str, task_type: str | None = None) -> None:
        if self.registry is not None:
            self.registry.cancel_tasks(deployment_id=deployment_id, task_type=task_type)


def durable_runtime_status() -> dict[str, Any]:
    status = runtime_status()
    requires = dict(status.get("requires") or {})
    requires.update(QuantaxisDurableStoreConfig.from_env().to_status())
    status["requires"] = requires
    status["durable_store_configured"] = bool(requires.get("mongo") and requires.get("qifi_password"))
    status["qapubsub_configured"] = bool(requires.get("rabbitmq"))
    return status


def _first_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _dict_values(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [dict(item) if isinstance(item, dict) else {"value": item} for item in value.values()]
    if isinstance(value, list):
        return [dict(item) if isinstance(item, dict) else {"value": item} for item in value]
    return []


def _normalize_qifi_symbol(value: Any) -> str:
    symbol = str(value or "").strip().upper().replace("/", "_").replace("-", "_")
    if not symbol:
        raise QuantaxisAdapterError("QIFI order symbol is required")
    return symbol


def _qifi_towards(side: str) -> int:
    normalized = str(side or "").strip().upper()
    mapping = {
        "BUY": 1,
        "LONG": 1,
        "SELL": -1,
        "CLOSE": -1,
        "BUY_OPEN": 2,
        "SELL_OPEN": -2,
        "BUY_CLOSE": 3,
        "SELL_CLOSE": -3,
        "BUY_CLOSETODAY": 4,
        "SELL_CLOSETODAY": -4,
    }
    if normalized not in mapping:
        raise QuantaxisAdapterError(f"unsupported QIFI order side: {side}")
    return mapping[normalized]
