"""Restricted QAStrategy runtime boundary for deployment snapshots."""

from __future__ import annotations

import ast
from dataclasses import dataclass
import builtins
from typing import Any

from src.quantaxis_native.loader import load_quantaxis_modules
from src.quantaxis_native.models import QuantaxisDeployment, now_iso


class QuantaxisStrategyRuntimeError(ValueError):
    """Raised when a strategy package is unsafe or violates QAStrategy contract."""


_ALLOWED_IMPORT_ROOTS = {
    "collections",
    "datetime",
    "decimal",
    "math",
    "numpy",
    "pandas",
    "statistics",
    "typing",
}
_BLOCKED_IMPORT_ROOTS = {
    "asyncio",
    "builtins",
    "importlib",
    "os",
    "pathlib",
    "requests",
    "shutil",
    "socket",
    "sqlite3",
    "src.live",
    "src.qifi",
    "src.shadow_trading",
    "src.trading",
    "subprocess",
    "sys",
    "urllib",
}
_BLOCKED_CALL_NAMES = {
    "__import__",
    "compile",
    "eval",
    "exec",
    "open",
}
_BLOCKED_ATTR_NAMES = {
    "cancel_order",
    "make_deal",
    "place_order",
    "send_order",
    "submit_order",
}
_BLOCKED_NAME_PARTS = {
    "broker",
    "connector",
    "mandate",
    "shadow_trading",
    "qifi",
}


@dataclass(frozen=True)
class StrategyOrderIntent:
    symbol: str
    side: str
    quantity: float
    price: float
    client_order_id: str = ""
    order_time: str = ""
    reason: str = ""
    raw: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "side": self.side,
            "quantity": self.quantity,
            "price": self.price,
            "client_order_id": self.client_order_id,
            "order_time": self.order_time,
            "reason": self.reason,
            "raw": dict(self.raw or {}),
        }


class RestrictedQAStrategyRuntime:
    """Validate and run deployable snapshots as QAStrategy-compatible code."""

    def validate_package(self, code: str) -> None:
        tree = self._parse(code)
        self._validate_ast(tree)
        if not self._has_qastrategy_contract(tree):
            raise QuantaxisStrategyRuntimeError(
                "strategy must define a QAStrategy class or SignalEngine/generate_signals for wrapping"
            )

    def evaluate_tick(
        self,
        deployment: QuantaxisDeployment,
        *,
        market_event: dict[str, Any],
        account_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        self.validate_package(deployment.strategy_snapshot.code)
        strategy = self._instantiate_strategy(deployment)
        context = {
            "deployment_id": deployment.deployment_id,
            "account_cookie": deployment.account_cookie,
            "market_event": dict(market_event),
            "account": self._read_only_account_context(account_snapshot),
            "parameters": dict(deployment.parameters),
            "risk_policy": dict(deployment.risk_policy),
        }
        raw_signal = self._call_strategy(strategy, context)
        intent = self._intent_from_signal(deployment, raw_signal, market_event)
        return {
            "deployment_id": deployment.deployment_id,
            "strategy_contract": "QAStrategy",
            "strategy_version_id": deployment.strategy_snapshot.version_id,
            "market_event_id": str(market_event.get("event_id") or market_event.get("market_event_id") or ""),
            "signal": raw_signal if isinstance(raw_signal, dict) else {"value": raw_signal},
            "intent": intent.to_dict() if intent else None,
        }

    def _instantiate_strategy(self, deployment: QuantaxisDeployment) -> Any:
        modules = load_quantaxis_modules()
        namespace = self._restricted_globals(modules)
        compiled = compile(deployment.strategy_snapshot.code, f"<strategy:{deployment.strategy_snapshot.version_id}>", "exec")
        exec(compiled, namespace, namespace)
        strategy_cls = self._find_strategy_class(namespace, modules.strategy_cta_base)
        if strategy_cls is not None:
            try:
                return strategy_cls(
                    code=deployment.symbols[0] if deployment.symbols else "",
                    frequence=deployment.timeframe,
                    strategy_id=deployment.deployment_id,
                    account_cookie=deployment.account_cookie,
                )
            except TypeError:
                return strategy_cls()
        if "SignalEngine" in namespace:
            engine = namespace["SignalEngine"]()
            return _SignalEngineQAStrategyAdapter(engine)
        if "generate_signals" in namespace:
            return _GenerateSignalsQAStrategyAdapter(namespace["generate_signals"])
        raise QuantaxisStrategyRuntimeError("strategy contract is unavailable")

    @staticmethod
    def _call_strategy(strategy: Any, context: dict[str, Any]) -> Any:
        for method_name in ("on_tick", "on_market_event", "generate_intent", "generate_signal"):
            method = getattr(strategy, method_name, None)
            if callable(method):
                return method(context)
        raise QuantaxisStrategyRuntimeError("QAStrategy package has no supported tick handler")

    @staticmethod
    def _parse(code: str) -> ast.Module:
        if not str(code or "").strip():
            raise QuantaxisStrategyRuntimeError("strategy code is empty")
        try:
            return ast.parse(code)
        except SyntaxError as exc:
            raise QuantaxisStrategyRuntimeError(f"strategy syntax error: {exc.msg}") from exc

    @staticmethod
    def _validate_ast(tree: ast.Module) -> None:
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [alias.name for alias in node.names] if isinstance(node, ast.Import) else [node.module or ""]
                for name in names:
                    root = _import_root(name)
                    if name in _BLOCKED_IMPORT_ROOTS or root in _BLOCKED_IMPORT_ROOTS:
                        raise QuantaxisStrategyRuntimeError(f"strategy import is not allowed: {name}")
                    if root not in _ALLOWED_IMPORT_ROOTS and root not in {"QUANTAXIS"}:
                        raise QuantaxisStrategyRuntimeError(f"strategy import is outside restricted runtime: {name}")
            if isinstance(node, ast.Call):
                call_name = _call_name(node.func)
                if call_name in _BLOCKED_CALL_NAMES:
                    raise QuantaxisStrategyRuntimeError(f"strategy call is not allowed: {call_name}")
                if any(part in call_name.lower() for part in _BLOCKED_NAME_PARTS):
                    raise QuantaxisStrategyRuntimeError(f"strategy cannot call account or broker boundary: {call_name}")
            if isinstance(node, ast.Attribute) and node.attr in _BLOCKED_ATTR_NAMES:
                raise QuantaxisStrategyRuntimeError(f"strategy cannot access account mutation API: {node.attr}")

    @staticmethod
    def _has_qastrategy_contract(tree: ast.Module) -> bool:
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                method_names = {item.name for item in node.body if isinstance(item, ast.FunctionDef)}
                if node.name in {"QAStrategy", "Strategy"} and method_names & {
                    "on_tick",
                    "on_market_event",
                    "generate_intent",
                    "generate_signal",
                }:
                    return True
                if node.name == "SignalEngine" and method_names & {"generate", "generate_intent", "generate_signal"}:
                    return True
                if any(_base_name(base).endswith("QAStrategyCtaBase") for base in node.bases):
                    return True
            if isinstance(node, ast.FunctionDef) and node.name == "generate_signals":
                return True
        return False

    @staticmethod
    def _find_strategy_class(namespace: dict[str, Any], base_class: type[Any]) -> type[Any] | None:
        for name in ("QAStrategy", "Strategy"):
            candidate = namespace.get(name)
            if isinstance(candidate, type) and issubclass(candidate, base_class):
                return candidate
        for value in namespace.values():
            if isinstance(value, type) and value is not base_class and issubclass(value, base_class):
                return value
        return None

    @staticmethod
    def _restricted_globals(modules: Any) -> dict[str, Any]:
        return {
            "__builtins__": {
                "abs": abs,
                "bool": bool,
                "__build_class__": builtins.__build_class__,
                "dict": dict,
                "float": float,
                "int": int,
                "__import__": _restricted_import,
                "len": len,
                "list": list,
                "max": max,
                "min": min,
                "object": object,
                "range": range,
                "round": round,
                "str": str,
                "sum": sum,
                "tuple": tuple,
            },
            "__name__": "__quantaxis_strategy__",
            "QAStrategyCtaBase": modules.strategy_cta_base,
        }

    @staticmethod
    def _read_only_account_context(snapshot: dict[str, Any]) -> dict[str, Any]:
        return {
            "account_cookie": snapshot.get("account_cookie"),
            "cash": snapshot.get("cash"),
            "total_asset": snapshot.get("total_asset"),
            "positions": tuple(dict(item) for item in snapshot.get("positions") or []),
            "orders": tuple(dict(item) for item in snapshot.get("orders") or []),
            "trades": tuple(dict(item) for item in snapshot.get("trades") or []),
        }

    @staticmethod
    def _intent_from_signal(
        deployment: QuantaxisDeployment,
        signal: Any,
        market_event: dict[str, Any],
    ) -> StrategyOrderIntent | None:
        if not isinstance(signal, dict):
            return None
        action = str(signal.get("action") or signal.get("side") or "HOLD").strip().upper()
        if action in {"", "HOLD", "NONE"}:
            return None
        symbol = str(signal.get("symbol") or market_event.get("symbol") or (deployment.symbols[0] if deployment.symbols else "")).strip()
        price = signal.get("price", market_event.get("price", market_event.get("close")))
        quantity = signal.get("quantity", signal.get("amount", signal.get("volume")))
        if price is None or quantity is None:
            raise QuantaxisStrategyRuntimeError("strategy order intent requires price and quantity")
        return StrategyOrderIntent(
            symbol=symbol,
            side=action,
            quantity=float(quantity),
            price=float(price),
            client_order_id=str(signal.get("client_order_id") or ""),
            order_time=str(signal.get("order_time") or market_event.get("datetime") or now_iso()),
            reason=str(signal.get("reason") or ""),
            raw=dict(signal),
        )


class _SignalEngineQAStrategyAdapter:
    def __init__(self, engine: Any) -> None:
        self.engine = engine

    def generate_signal(self, context: dict[str, Any]) -> Any:
        if hasattr(self.engine, "generate_intent"):
            return self.engine.generate_intent(context)
        if hasattr(self.engine, "generate_signal"):
            return self.engine.generate_signal(context)
        if hasattr(self.engine, "generate"):
            return self.engine.generate({"market_event": context["market_event"], "account": context["account"]})
        raise QuantaxisStrategyRuntimeError("SignalEngine has no supported generate method")


class _GenerateSignalsQAStrategyAdapter:
    def __init__(self, fn: Any) -> None:
        self.fn = fn

    def generate_signal(self, context: dict[str, Any]) -> Any:
        return self.fn({"market_event": context["market_event"], "account": context["account"]})


def _import_root(name: str) -> str:
    parts = str(name or "").split(".")
    if len(parts) >= 2 and parts[0] == "src":
        return ".".join(parts[:2])
    return parts[0] if parts else ""


def _base_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_base_name(node.value)}.{node.attr}"
    return ""


def _call_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = _call_name(node.value)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    return ""


def _restricted_import(name: str, globals=None, locals=None, fromlist=(), level: int = 0):  # noqa: ANN001
    root = _import_root(name)
    if root in _ALLOWED_IMPORT_ROOTS:
        return builtins.__import__(name, globals, locals, fromlist, level)
    raise QuantaxisStrategyRuntimeError(f"strategy import is outside restricted runtime: {name}")
