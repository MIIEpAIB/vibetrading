"""Paper strategy deployment service."""

from __future__ import annotations

import json
import math
import uuid
from dataclasses import replace
from typing import Any, Iterable, Protocol

from src.paper_trading.models import (
    DEPLOYMENT_STATUSES,
    PaperDeployment,
    PaperLimits,
    PaperOrderLink,
    PaperRiskDecision,
    PaperSignal,
    PaperTickResult,
    StrategySnapshot,
    now_iso,
)
from src.paper_trading.store import PaperTradingStore
from src.shadow_trading import AccountType, OrderSide, OrderType, ShadowTradingError, normalize_symbol


class StrategyStoreLike(Protocol):
    """Minimal strategy store view needed by the service."""

    def list_strategies(self, user_id: int | None = None) -> list[Any]: ...


class ShadowTradingServiceLike(Protocol):
    """Minimal shadow trading service view needed by the service."""

    async def account_snapshot(self, user_id: str) -> dict[str, Any]: ...

    engine: Any

    async def place_order(
        self,
        *,
        user_id: str,
        account_type: AccountType,
        symbol: str,
        side: OrderSide,
        order_type: OrderType,
        quantity: float,
        price: float = 0.0,
    ) -> Any: ...


class PaperTradingError(ValueError):
    """Raised for invalid paper deployment operations."""


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _finite_positive(value: float | None) -> bool:
    return value is not None and math.isfinite(float(value)) and float(value) > 0


class PaperTradingService:
    """Create, manage, and tick paper deployments."""

    def __init__(
        self,
        *,
        store: PaperTradingStore,
        strategy_store: StrategyStoreLike,
        shadow_service: ShadowTradingServiceLike,
        shadow_user_resolver: Any | None = None,
    ) -> None:
        self.store = store
        self.strategy_store = strategy_store
        self.shadow_service = shadow_service
        self.shadow_user_resolver = shadow_user_resolver or (lambda user_id: f"user:{user_id}")

    def create_deployment(
        self,
        *,
        user_id: int,
        strategy_id: str,
        limits_payload: dict[str, Any] | None = None,
    ) -> PaperDeployment:
        """Create a draft deployment from a user-owned strategy."""
        record = self._strategy_or_error(strategy_id, user_id=user_id)
        snapshot = StrategySnapshot.from_strategy_record(record)
        limits = PaperLimits.from_payload(limits_payload)
        limits.validate()
        created = now_iso()
        deployment = PaperDeployment(
            deployment_id=_id("paper"),
            user_id=int(user_id),
            status="draft",
            strategy_id=snapshot.strategy_id,
            strategy_snapshot=snapshot,
            limits=limits,
            created_at=created,
            updated_at=created,
        )
        return self.store.create_deployment(deployment)

    def list_deployments(self, *, user_id: int) -> list[PaperDeployment]:
        return self.store.list_deployments(user_id=int(user_id))

    def get_deployment(self, deployment_id: str, *, user_id: int) -> PaperDeployment:
        deployment = self.store.get_deployment(deployment_id, user_id=int(user_id))
        if deployment is None:
            raise PaperTradingError("paper deployment not found")
        return deployment

    def set_status(self, deployment_id: str, *, user_id: int, action: str) -> PaperDeployment:
        """Apply a lifecycle action to a deployment."""
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        action = (action or "").strip().lower()
        ts = now_iso()
        next_status = deployment.status
        fields: dict[str, Any] = {"updated_at": ts}

        if action in {"start", "resume"}:
            if deployment.status not in {"draft", "paused"}:
                raise PaperTradingError("only draft or paused deployments can be started")
            next_status = "running"
            fields["started_at"] = deployment.started_at or ts
            fields["paused_at"] = None
        elif action == "pause":
            if deployment.status != "running":
                raise PaperTradingError("only running deployments can be paused")
            next_status = "paused"
            fields["paused_at"] = ts
        elif action == "archive":
            if deployment.status == "archived":
                raise PaperTradingError("deployment is already archived")
            next_status = "archived"
            fields["archived_at"] = ts
        else:
            raise PaperTradingError("unsupported deployment action")

        if next_status not in DEPLOYMENT_STATUSES:
            raise PaperTradingError("invalid deployment status")
        return self.store.update_deployment(replace(deployment, status=next_status, **fields))

    async def run_tick(self, deployment_id: str, *, user_id: int) -> dict[str, Any]:
        """Run one manual paper tick for a running deployment."""
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        if deployment.status != "running":
            tick = self._record_tick(
                deployment,
                outcome="failed",
                reason="deployment is not running",
            )
            return self._tick_payload(tick)

        try:
            signal = self._generate_signal(deployment)
        except PaperTradingError as exc:
            tick = self._record_tick(deployment, outcome="failed", reason=str(exc))
            self._stamp_last_tick(deployment)
            return self._tick_payload(tick)

        if signal.action == "HOLD":
            tick = self._record_tick(
                deployment,
                outcome="no_action",
                reason=signal.reason or "strategy emitted HOLD",
                signal_id=signal.signal_id,
            )
            self._stamp_last_tick(deployment)
            return self._tick_payload(tick, signal=signal)

        decision = await self._check_risk(deployment, signal)
        if decision.decision == "rejected":
            tick = self._record_tick(
                deployment,
                outcome="rejected",
                reason=decision.reason,
                signal_id=signal.signal_id,
                decision_id=decision.decision_id,
            )
            self._stamp_last_tick(deployment)
            return self._tick_payload(tick, signal=signal, decision=decision)

        order = await self._place_shadow_order(deployment, signal, decision)
        link = self._link_order(deployment, signal, decision, order)
        tick = self._record_tick(
            deployment,
            outcome="order_placed",
            reason=f"shadow order {order.status.value if hasattr(order.status, 'value') else order.status}",
            signal_id=signal.signal_id,
            decision_id=decision.decision_id,
            shadow_order_id=order.order_id,
        )
        self._stamp_last_tick(deployment)
        return self._tick_payload(tick, signal=signal, decision=decision, order_link=link)

    def status(self, deployment_id: str, *, user_id: int, limit: int = 20) -> dict[str, Any]:
        """Return deployment status and recent activity."""
        deployment = self.get_deployment(deployment_id, user_id=user_id)
        return {
            "deployment": deployment.to_dict(),
            "latest_tick": _first_or_none(self.store.list_ticks(deployment_id, user_id=user_id, limit=1)),
            "recent_ticks": [item.to_dict() for item in self.store.list_ticks(deployment_id, user_id=user_id, limit=limit)],
            "recent_signals": [
                item.to_dict() for item in self.store.list_signals(deployment_id, user_id=user_id, limit=limit)
            ],
            "recent_decisions": [
                item.to_dict() for item in self.store.list_decisions(deployment_id, user_id=user_id, limit=limit)
            ],
            "recent_orders": [
                item.to_dict() for item in self.store.list_order_links(deployment_id, user_id=user_id, limit=limit)
            ],
            "summary": self._summary(deployment, user_id=user_id),
        }

    def _strategy_or_error(self, strategy_id: str, *, user_id: int) -> Any:
        strategy_id = str(strategy_id or "").strip()
        if not strategy_id:
            raise PaperTradingError("strategy_id is required")
        for record in self.strategy_store.list_strategies(user_id=int(user_id)):
            if str(record.id) == strategy_id:
                return record
        raise PaperTradingError(f"Strategy {strategy_id} not found")

    def _generate_signal(self, deployment: PaperDeployment) -> PaperSignal:
        package = self._load_strategy_package(deployment.strategy_snapshot)
        raw = package.get("paper_signal") or package.get("signal") or package
        if isinstance(raw, list):
            raw = raw[0] if raw else {"action": "HOLD", "reason": "empty signal list"}
        if not isinstance(raw, dict):
            raise PaperTradingError("strategy package did not produce a signal object")

        action = str(raw.get("action") or raw.get("side") or "HOLD").strip().upper()
        if action == "BUY_TO_OPEN":
            action = "BUY"
        if action in {"SELL_TO_CLOSE", "CLOSE_LONG"}:
            action = "SELL"
        if action not in {"BUY", "SELL", "HOLD", "CLOSE"}:
            raise PaperTradingError(f"unsupported signal action: {action}")

        symbol = raw.get("symbol") or (deployment.limits.symbols[0] if deployment.limits.symbols else "")
        try:
            normalized_symbol = normalize_symbol(str(symbol))
        except ShadowTradingError as exc:
            raise PaperTradingError(str(exc)) from exc

        if action == "CLOSE":
            action = "SELL"

        signal = PaperSignal(
            signal_id=_id("sig"),
            deployment_id=deployment.deployment_id,
            user_id=deployment.user_id,
            strategy_version=deployment.strategy_snapshot.version,
            symbol=normalized_symbol,
            action=action,
            reason=str(raw.get("reason") or raw.get("human_text") or "strategy signal"),
            data_timestamp=str(raw.get("data_timestamp") or raw.get("as_of") or now_iso()),
            created_at=now_iso(),
            confidence=_optional_float(raw.get("confidence")),
            target_weight=_optional_float(raw.get("target_weight")),
            quantity=_optional_float(raw.get("quantity") or raw.get("qty")),
            notional=_optional_float(raw.get("notional") or raw.get("notional_usd")),
            limit_price=_optional_float(raw.get("limit_price") or raw.get("price")),
            metadata={k: v for k, v in raw.items() if k not in {"code"}},
        )
        self.store.add_signal(signal)
        return signal

    def _load_strategy_package(self, snapshot: StrategySnapshot) -> dict[str, Any]:
        text = snapshot.code.strip()
        if not text:
            raise PaperTradingError("strategy snapshot is empty")
        try:
            package = json.loads(text)
        except json.JSONDecodeError as exc:
            raise PaperTradingError("unsupported strategy package format; expected JSON StrategySpec") from exc
        if not isinstance(package, dict):
            raise PaperTradingError("unsupported strategy package format; expected JSON object")
        return package

    async def _check_risk(self, deployment: PaperDeployment, signal: PaperSignal) -> PaperRiskDecision:
        limits = deployment.limits
        if signal.symbol not in limits.symbols:
            return self._decision(
                deployment,
                signal,
                decision="rejected",
                reason=f"symbol {signal.symbol} is outside paper universe",
                breached_limit="symbols",
            )
        if signal.action not in limits.allowed_sides:
            return self._decision(
                deployment,
                signal,
                decision="rejected",
                reason=f"side {signal.action} is not allowed",
                breached_limit="allowed_sides",
            )

        price = await self._resolve_price(signal)
        if not _finite_positive(price):
            return self._decision(
                deployment,
                signal,
                decision="rejected",
                reason="market price unavailable for signal",
                breached_limit="price",
            )

        order_notional = signal.notional if _finite_positive(signal.notional) else limits.default_order_notional
        quantity = signal.quantity if _finite_positive(signal.quantity) else None
        if quantity is not None:
            order_notional = max(float(order_notional), quantity * float(price))
        else:
            quantity = float(order_notional) / float(price)

        if order_notional > limits.max_order_notional:
            return self._decision(
                deployment,
                signal,
                decision="rejected",
                reason="signal exceeds max single-order notional",
                breached_limit="max_order_notional",
                order_notional=order_notional,
                price=float(price),
                quantity=float(quantity),
            )

        day_prefix = now_iso()[:10]
        daily_count = self.store.count_order_links_for_day(
            deployment.deployment_id,
            user_id=deployment.user_id,
            day_prefix=day_prefix,
        )
        if daily_count >= limits.max_trades_per_day:
            return self._decision(
                deployment,
                signal,
                decision="rejected",
                reason="daily paper trade limit reached",
                breached_limit="max_trades_per_day",
                order_notional=order_notional,
                price=float(price),
                quantity=float(quantity),
            )

        account = await self.shadow_service.account_snapshot(self._shadow_user_id(deployment.user_id))
        exposure = self._current_exposure(account, limits.symbols)
        if exposure + float(order_notional) > limits.max_total_exposure:
            return self._decision(
                deployment,
                signal,
                decision="rejected",
                reason="signal exceeds max total exposure",
                breached_limit="max_total_exposure",
                order_notional=order_notional,
                price=float(price),
                quantity=float(quantity),
            )

        if signal.action == "BUY":
            quote_asset = signal.symbol.split("_", 1)[1]
            cash = _wallet_balance(account, quote_asset)
            if cash - float(order_notional) < limits.min_cash_buffer:
                return self._decision(
                    deployment,
                    signal,
                    decision="rejected",
                    reason="paper cash buffer would be breached",
                    breached_limit="min_cash_buffer",
                    order_notional=order_notional,
                    price=float(price),
                    quantity=float(quantity),
                )

        return self._decision(
            deployment,
            signal,
            decision="allowed",
            reason="paper risk checks passed",
            order_notional=float(order_notional),
            price=float(price),
            quantity=float(quantity),
        )

    async def _resolve_price(self, signal: PaperSignal) -> float | None:
        if _finite_positive(signal.limit_price):
            return float(signal.limit_price)
        try:
            return float(await self.shadow_service.engine.get_market_price(signal.symbol))
        except Exception:
            return None

    def _decision(
        self,
        deployment: PaperDeployment,
        signal: PaperSignal,
        *,
        decision: str,
        reason: str,
        breached_limit: str = "",
        order_notional: float = 0.0,
        price: float = 0.0,
        quantity: float = 0.0,
    ) -> PaperRiskDecision:
        item = PaperRiskDecision(
            decision_id=_id("risk"),
            deployment_id=deployment.deployment_id,
            signal_id=signal.signal_id,
            user_id=deployment.user_id,
            decision=decision,
            reason=reason,
            breached_limit=breached_limit,
            order_notional=float(order_notional or 0.0),
            price=float(price or 0.0),
            quantity=float(quantity or 0.0),
            created_at=now_iso(),
        )
        return self.store.add_decision(item)

    async def _place_shadow_order(
        self,
        deployment: PaperDeployment,
        signal: PaperSignal,
        decision: PaperRiskDecision,
    ) -> Any:
        order_type = OrderType(deployment.limits.order_type)
        price = decision.price if order_type == OrderType.LIMIT else 0.0
        return await self.shadow_service.place_order(
            user_id=self._shadow_user_id(deployment.user_id),
            account_type=AccountType.VIRTUAL,
            symbol=signal.symbol,
            side=OrderSide(signal.action),
            order_type=order_type,
            quantity=decision.quantity,
            price=price,
        )

    def _link_order(
        self,
        deployment: PaperDeployment,
        signal: PaperSignal,
        decision: PaperRiskDecision,
        order: Any,
    ) -> PaperOrderLink:
        status = order.status.value if hasattr(order.status, "value") else str(order.status)
        link = PaperOrderLink(
            link_id=_id("plink"),
            deployment_id=deployment.deployment_id,
            signal_id=signal.signal_id,
            decision_id=decision.decision_id,
            user_id=deployment.user_id,
            shadow_order_id=str(order.order_id),
            shadow_status=status,
            rejection_reason=str(getattr(order, "rejection_reason", "") or ""),
            created_at=now_iso(),
        )
        return self.store.add_order_link(link)

    def _record_tick(
        self,
        deployment: PaperDeployment,
        *,
        outcome: str,
        reason: str = "",
        signal_id: str | None = None,
        decision_id: str | None = None,
        shadow_order_id: str | None = None,
    ) -> PaperTickResult:
        tick = PaperTickResult(
            tick_id=_id("tick"),
            deployment_id=deployment.deployment_id,
            user_id=deployment.user_id,
            outcome=outcome,
            reason=reason,
            signal_id=signal_id,
            decision_id=decision_id,
            shadow_order_id=shadow_order_id,
            created_at=now_iso(),
        )
        return self.store.add_tick(tick)

    def _stamp_last_tick(self, deployment: PaperDeployment) -> None:
        current = self.store.get_deployment(deployment.deployment_id, user_id=deployment.user_id)
        if current is None or current.status == "archived":
            return
        ts = now_iso()
        self.store.update_deployment(replace(current, last_tick_at=ts, updated_at=ts))

    def _tick_payload(
        self,
        tick: PaperTickResult,
        *,
        signal: PaperSignal | None = None,
        decision: PaperRiskDecision | None = None,
        order_link: PaperOrderLink | None = None,
    ) -> dict[str, Any]:
        return {
            "tick": tick.to_dict(),
            "signal": signal.to_dict() if signal else None,
            "decision": decision.to_dict() if decision else None,
            "order_link": order_link.to_dict() if order_link else None,
        }

    def _summary(self, deployment: PaperDeployment, *, user_id: int) -> dict[str, Any]:
        links = self.store.list_order_links(deployment.deployment_id, user_id=user_id, limit=500)
        decisions = self.store.list_decisions(deployment.deployment_id, user_id=user_id, limit=500)
        ticks = self.store.list_ticks(deployment.deployment_id, user_id=user_id, limit=500)
        return {
            "tick_count": len(ticks),
            "order_count": len(links),
            "rejected_decision_count": len([item for item in decisions if item.decision == "rejected"]),
            "filled_order_count": len([item for item in links if item.shadow_status == "FILLED"]),
        }

    def _current_exposure(self, account: dict[str, Any], symbols: Iterable[str]) -> float:
        prices = account.get("market_prices") or {}
        wallets = account.get("wallets") or []
        exposure = 0.0
        for symbol in symbols:
            base, _quote = symbol.split("_", 1)
            price = prices.get(symbol)
            if not _finite_positive(price):
                continue
            qty = 0.0
            for wallet in wallets:
                if str(wallet.get("asset_name") or "").upper() == base:
                    qty += float(wallet.get("balance") or 0.0) + float(wallet.get("frozen") or 0.0)
            exposure += abs(qty * float(price))
        return exposure

    def _shadow_user_id(self, user_id: int) -> str:
        return str(self.shadow_user_resolver(int(user_id)))


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _wallet_balance(account: dict[str, Any], asset: str) -> float:
    asset = asset.upper()
    for wallet in account.get("wallets") or []:
        if str(wallet.get("asset_name") or "").upper() == asset:
            return float(wallet.get("balance") or 0.0)
    return 0.0


def _first_or_none(items: list[Any]) -> dict[str, Any] | None:
    if not items:
        return None
    item = items[0]
    return item.to_dict() if hasattr(item, "to_dict") else item
