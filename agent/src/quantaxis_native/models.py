"""Models for QUANTAXIS-native deployments."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class DeploymentTarget(str, Enum):
    SHADOW = "SHADOW"
    LIVE = "LIVE"


class DeploymentStatus(str, Enum):
    DRAFT = "DRAFT"
    READY = "READY"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    STOPPED = "STOPPED"
    RECOVERY_REQUIRED = "RECOVERY_REQUIRED"
    ARCHIVED = "ARCHIVED"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@dataclass(frozen=True)
class StrategyVersionSnapshot:
    strategy_id: str
    version_no: int
    owner_user_id: int
    name: str
    description: str
    strategy_description: str
    language: str
    category: str
    tags: tuple[str, ...]
    code: str
    code_sha256: str
    created_at: str
    parameter_schema: dict[str, Any] = field(default_factory=dict)

    @property
    def version_id(self) -> str:
        return f"{self.owner_user_id}:{self.strategy_id}:{self.version_no}"

    @classmethod
    def from_version_row(cls, row: dict[str, Any]) -> "StrategyVersionSnapshot":
        return cls(
            strategy_id=str(row["strategy_id"]),
            version_no=int(row.get("version") or row.get("version_no") or 1),
            owner_user_id=int(row.get("owner_user_id") or 0),
            name=str(row.get("name") or ""),
            description=str(row.get("description") or ""),
            strategy_description=str(row.get("strategy_description") or row.get("strategyDescription") or ""),
            language=str(row.get("language") or "python"),
            category=str(row.get("category") or "trend"),
            tags=tuple(str(tag) for tag in row.get("tags", []) or []),
            code=str(row.get("code") or ""),
            code_sha256=str(row.get("code_sha256") or ""),
            created_at=str(row.get("created_at") or ""),
            parameter_schema=_loads_dict(row.get("parameter_schema_json") or row.get("parameter_schema"), {}),
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StrategyVersionSnapshot":
        return cls(
            strategy_id=str(data["strategy_id"]),
            version_no=int(data["version_no"]),
            owner_user_id=int(data.get("owner_user_id") or 0),
            name=str(data.get("name") or ""),
            description=str(data.get("description") or ""),
            strategy_description=str(data.get("strategy_description") or ""),
            language=str(data.get("language") or "python"),
            category=str(data.get("category") or "trend"),
            tags=tuple(str(tag) for tag in data.get("tags", []) or []),
            code=str(data.get("code") or ""),
            code_sha256=str(data.get("code_sha256") or ""),
            created_at=str(data.get("created_at") or ""),
            parameter_schema=dict(data.get("parameter_schema") or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["tags"] = list(self.tags)
        return data


@dataclass(frozen=True)
class QuantaxisDeployment:
    deployment_id: str
    user_id: int
    target: DeploymentTarget
    status: DeploymentStatus
    strategy_snapshot: StrategyVersionSnapshot
    account_cookie: str
    market: str
    symbols: tuple[str, ...]
    timeframe: str
    parameters: dict[str, Any]
    risk_policy: dict[str, Any]
    broker_binding_id: int | None
    created_at: str
    updated_at: str
    started_at: str | None = None
    paused_at: str | None = None
    stopped_at: str | None = None
    archived_at: str | None = None
    recovery_reason: str = ""

    @classmethod
    def create(
        cls,
        *,
        user_id: int,
        target: DeploymentTarget,
        strategy_snapshot: StrategyVersionSnapshot,
        market: str,
        symbols: tuple[str, ...],
        timeframe: str,
        parameters: dict[str, Any],
        risk_policy: dict[str, Any],
        broker_binding_id: int | None = None,
    ) -> "QuantaxisDeployment":
        created = now_iso()
        deployment_id = new_id("qadep")
        account_cookie = f"qa:{target.value.lower()}:{user_id}:{deployment_id}"
        return cls(
            deployment_id=deployment_id,
            user_id=int(user_id),
            target=target,
            status=DeploymentStatus.DRAFT,
            strategy_snapshot=strategy_snapshot,
            account_cookie=account_cookie,
            market=str(market or "").strip().upper(),
            symbols=symbols,
            timeframe=str(timeframe or "").strip(),
            parameters=parameters,
            risk_policy=risk_policy,
            broker_binding_id=broker_binding_id,
            created_at=created,
            updated_at=created,
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "QuantaxisDeployment":
        return cls(
            deployment_id=str(data["deployment_id"]),
            user_id=int(data["user_id"]),
            target=DeploymentTarget(str(data["target"])),
            status=DeploymentStatus(str(data["status"])),
            strategy_snapshot=StrategyVersionSnapshot.from_dict(dict(data["strategy_snapshot"])),
            account_cookie=str(data["account_cookie"]),
            market=str(data.get("market") or ""),
            symbols=tuple(str(item) for item in data.get("symbols", []) or []),
            timeframe=str(data.get("timeframe") or ""),
            parameters=dict(data.get("parameters") or {}),
            risk_policy=dict(data.get("risk_policy") or {}),
            broker_binding_id=int(data["broker_binding_id"]) if data.get("broker_binding_id") is not None else None,
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
            started_at=data.get("started_at"),
            paused_at=data.get("paused_at"),
            stopped_at=data.get("stopped_at"),
            archived_at=data.get("archived_at"),
            recovery_reason=str(data.get("recovery_reason") or ""),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "deployment_id": self.deployment_id,
            "user_id": self.user_id,
            "target": self.target.value,
            "status": self.status.value,
            "strategy_snapshot": self.strategy_snapshot.to_dict(),
            "account_cookie": self.account_cookie,
            "market": self.market,
            "symbols": list(self.symbols),
            "timeframe": self.timeframe,
            "parameters": dict(self.parameters),
            "risk_policy": dict(self.risk_policy),
            "broker_binding_id": self.broker_binding_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "paused_at": self.paused_at,
            "stopped_at": self.stopped_at,
            "archived_at": self.archived_at,
            "recovery_reason": self.recovery_reason,
        }


@dataclass(frozen=True)
class QuantaxisRuntimeStatus:
    available: bool
    version: str
    quantaxis_path: str
    runtime_home: str
    modules: dict[str, bool]
    requires: dict[str, str]
    error: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "QuantaxisRuntimeStatus":
        return cls(
            available=bool(data.get("available")),
            version=str(data.get("version") or ""),
            quantaxis_path=str(data.get("quantaxis_path") or ""),
            runtime_home=str(data.get("runtime_home") or ""),
            modules={str(k): bool(v) for k, v in dict(data.get("modules") or {}).items()},
            requires={str(k): str(v) for k, v in dict(data.get("requires") or {}).items()},
            error=str(data.get("error") or ""),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _loads_dict(value: Any, default: dict[str, Any]) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, (str, bytes)) and value:
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else default
        except json.JSONDecodeError:
            return default
    return default
