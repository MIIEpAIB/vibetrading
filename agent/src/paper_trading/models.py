"""Data contracts for paper strategy deployments."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


DEPLOYMENT_STATUSES = {"draft", "running", "paused", "archived"}
EXECUTION_MODES = {"shadow", "broker_paper"}
SIGNAL_ACTIONS = {"BUY", "SELL", "HOLD", "CLOSE"}
RISK_DECISIONS = {"allowed", "rejected"}
TICK_OUTCOMES = {"no_action", "failed", "rejected", "order_placed"}


def now_iso() -> str:
    """Return a UTC ISO-8601 timestamp."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class PaperLimits:
    """User-configured paper risk limits."""

    symbols: tuple[str, ...]
    allowed_sides: tuple[str, ...] = ("BUY", "SELL")
    max_order_notional: float = 1_000.0
    max_total_exposure: float = 10_000.0
    max_trades_per_day: int = 10
    min_cash_buffer: float = 0.0
    default_order_notional: float = 100.0
    order_type: str = "MARKET"

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "PaperLimits":
        data = payload or {}
        raw_symbols = data.get("symbols") or data.get("allowed_symbols") or ("BTC_USDT",)
        if isinstance(raw_symbols, str):
            raw_symbols = (raw_symbols,)
        symbols = tuple(_normalize_symbol_text(item) for item in raw_symbols if str(item).strip())
        raw_sides = data.get("allowed_sides") or ("BUY", "SELL")
        if isinstance(raw_sides, str):
            raw_sides = (raw_sides,)
        sides = tuple(str(item).strip().upper() for item in raw_sides if str(item).strip())
        return cls(
            symbols=symbols,
            allowed_sides=sides,
            max_order_notional=float(data.get("max_order_notional", 1_000.0)),
            max_total_exposure=float(data.get("max_total_exposure", 10_000.0)),
            max_trades_per_day=int(data.get("max_trades_per_day", 10)),
            min_cash_buffer=float(data.get("min_cash_buffer", 0.0)),
            default_order_notional=float(data.get("default_order_notional", 100.0)),
            order_type=str(data.get("order_type") or "MARKET").strip().upper(),
        )

    def validate(self) -> None:
        """Validate limit fields and raise ValueError with a user-facing reason."""
        if not self.symbols:
            raise ValueError("paper limits require at least one symbol")
        if not self.allowed_sides:
            raise ValueError("paper limits require at least one allowed side")
        invalid_sides = [side for side in self.allowed_sides if side not in {"BUY", "SELL"}]
        if invalid_sides:
            raise ValueError(f"invalid allowed side: {invalid_sides[0]}")
        if self.max_order_notional <= 0:
            raise ValueError("max_order_notional must be positive")
        if self.max_total_exposure <= 0:
            raise ValueError("max_total_exposure must be positive")
        if self.max_trades_per_day <= 0:
            raise ValueError("max_trades_per_day must be positive")
        if self.min_cash_buffer < 0:
            raise ValueError("min_cash_buffer cannot be negative")
        if self.default_order_notional <= 0:
            raise ValueError("default_order_notional must be positive")
        if self.default_order_notional > self.max_order_notional:
            raise ValueError("default_order_notional cannot exceed max_order_notional")
        if self.order_type not in {"MARKET", "LIMIT"}:
            raise ValueError("order_type must be MARKET or LIMIT")

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["symbols"] = list(self.symbols)
        data["allowed_sides"] = list(self.allowed_sides)
        return data


@dataclass(frozen=True)
class StrategySnapshot:
    """Immutable strategy package captured at deployment creation."""

    strategy_id: str
    name: str
    description: str
    language: str
    category: str
    tags: tuple[str, ...]
    code: str
    source_updated_at: str
    version: str

    @classmethod
    def from_strategy_record(cls, record: Any) -> "StrategySnapshot":
        """Create a snapshot from the strategy store record shape."""
        return cls(
            strategy_id=str(record.id),
            name=str(record.name),
            description=str(record.description),
            language=str(record.language),
            category=str(record.category),
            tags=tuple(str(tag) for tag in getattr(record, "tags", [])),
            code=str(record.code),
            source_updated_at=str(getattr(record, "updatedAt", "")),
            version=f"{record.id}:{getattr(record, 'updatedAt', '')}",
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StrategySnapshot":
        return cls(
            strategy_id=str(data["strategy_id"]),
            name=str(data["name"]),
            description=str(data.get("description") or ""),
            language=str(data.get("language") or "python"),
            category=str(data.get("category") or "trend"),
            tags=tuple(str(tag) for tag in data.get("tags", [])),
            code=str(data.get("code") or ""),
            source_updated_at=str(data.get("source_updated_at") or ""),
            version=str(data.get("version") or data["strategy_id"]),
        )

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["tags"] = list(self.tags)
        return data


@dataclass(frozen=True)
class PaperDeployment:
    """Persisted paper deployment state."""

    deployment_id: str
    user_id: int
    status: str
    strategy_id: str
    strategy_snapshot: StrategySnapshot
    limits: PaperLimits
    created_at: str
    updated_at: str
    execution_mode: str = "shadow"
    connector_profile_id: str = ""
    started_at: str | None = None
    paused_at: str | None = None
    archived_at: str | None = None
    last_tick_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["strategy_snapshot"] = self.strategy_snapshot.to_dict()
        data["limits"] = self.limits.to_dict()
        return data


@dataclass(frozen=True)
class PaperSignal:
    """Normalized signal emitted before risk checks and order placement."""

    signal_id: str
    deployment_id: str
    user_id: int
    strategy_version: str
    symbol: str
    action: str
    reason: str
    data_timestamp: str
    created_at: str
    confidence: float | None = None
    target_weight: float | None = None
    quantity: float | None = None
    notional: float | None = None
    limit_price: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PaperRiskDecision:
    """Risk gate output for a signal."""

    decision_id: str
    deployment_id: str
    signal_id: str
    user_id: int
    decision: str
    reason: str
    created_at: str
    breached_limit: str = ""
    order_notional: float = 0.0
    price: float = 0.0
    quantity: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PaperOrderLink:
    """Link between a paper signal/risk decision and shadow order outcome."""

    link_id: str
    deployment_id: str
    signal_id: str
    decision_id: str
    user_id: int
    shadow_order_id: str
    shadow_status: str
    created_at: str
    rejection_reason: str = ""
    execution_mode: str = "shadow"
    connector_profile_id: str = ""
    broker_order_id: str = ""
    broker_payload: dict[str, Any] = field(default_factory=dict)
    qifi_order_id: str = ""
    qifi_trade_id: str = ""
    qifi_account_json: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PaperTickResult:
    """One paper deployment tick outcome."""

    tick_id: str
    deployment_id: str
    user_id: int
    outcome: str
    created_at: str
    reason: str = ""
    signal_id: str | None = None
    decision_id: str | None = None
    shadow_order_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _normalize_symbol_text(value: Any) -> str:
    return str(value).strip().upper().replace("/", "_").replace("-", "_")
