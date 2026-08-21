"""One-time migration helpers for QUANTAXIS-native deployment metadata."""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from src.quantaxis_native.models import (
    DeploymentStatus,
    DeploymentTarget,
    QuantaxisDeployment,
    StrategyVersionSnapshot,
)


class StrategyVersionStoreLike(Protocol):
    def list_strategy_versions(self, strategy_id: str, user_id: int | None = None) -> list[dict[str, Any]]: ...


class DeploymentStoreLike(Protocol):
    def create(self, deployment: QuantaxisDeployment) -> QuantaxisDeployment: ...

    def get(self, deployment_id: str, *, user_id: int | None = None) -> QuantaxisDeployment | None: ...


@dataclass
class MigrationReport:
    strategies_versioned: int = 0
    paper_seen: int = 0
    paper_migrated: int = 0
    live_seen: int = 0
    live_migrated: int = 0
    skipped: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategies_versioned": self.strategies_versioned,
            "paper_seen": self.paper_seen,
            "paper_migrated": self.paper_migrated,
            "live_seen": self.live_seen,
            "live_migrated": self.live_migrated,
            "skipped": list(self.skipped),
        }


def migrate_quantaxis_native_metadata(
    *,
    strategy_store: StrategyVersionStoreLike,
    deployment_store: DeploymentStoreLike,
    paper_deployments: list[Any] | None = None,
    live_deployments: list[dict[str, Any]] | None = None,
    dry_run: bool = False,
) -> MigrationReport:
    """Migrate eligible legacy deployment metadata into QUANTAXIS deployments.

    This intentionally migrates metadata only. Legacy paper balances, shadow
    ledgers, JSON live jobs, orders, and trades are not copied into QIFI.
    """
    report = MigrationReport()
    ensure_versions = getattr(strategy_store, "ensure_current_strategy_versions", None)
    if callable(ensure_versions) and not dry_run:
        report.strategies_versioned = int(ensure_versions() or 0)
    for paper in paper_deployments or []:
        report.paper_seen += 1
        deployment, reason = quantaxis_deployment_from_paper(paper, strategy_store=strategy_store)
        if deployment is None:
            report.skipped.append({"source": "paper", "id": _legacy_id(paper), "reason": reason})
            continue
        if _already_migrated(deployment_store, deployment):
            report.skipped.append({"source": "paper", "id": _legacy_id(paper), "reason": "already migrated"})
            continue
        if not dry_run:
            deployment_store.create(deployment)
        report.paper_migrated += 1

    for live in live_deployments or []:
        report.live_seen += 1
        deployment, reason = quantaxis_deployment_from_live(live, strategy_store=strategy_store)
        if deployment is None:
            report.skipped.append({"source": "live", "id": _legacy_id(live), "reason": reason})
            continue
        if _already_migrated(deployment_store, deployment):
            report.skipped.append({"source": "live", "id": _legacy_id(live), "reason": "already migrated"})
            continue
        if not dry_run:
            deployment_store.create(deployment)
        report.live_migrated += 1
    return report


def quantaxis_deployment_from_paper(
    paper: Any,
    *,
    strategy_store: StrategyVersionStoreLike,
) -> tuple[QuantaxisDeployment | None, str]:
    status = str(_get(paper, "status") or "").strip().lower()
    if status == "archived":
        return None, "archived legacy deployment"
    strategy_id = str(_get(paper, "strategy_id") or "").strip()
    user_id = int(_get(paper, "user_id") or 0)
    snapshot, reason = _strategy_snapshot(strategy_store, strategy_id=strategy_id, user_id=user_id)
    if snapshot is None:
        return None, reason
    limits = _as_dict(_get(paper, "limits"))
    symbols = tuple(_normalize_symbol(item) for item in limits.get("symbols", []) if str(item).strip())
    if not symbols:
        return None, "legacy paper deployment has no symbols"
    deployment_id = _migrated_id("paper", _legacy_id(paper))
    created_at = str(_get(paper, "created_at") or _get(paper, "updated_at") or snapshot.created_at)
    updated_at = str(_get(paper, "updated_at") or created_at)
    mapped_status, recovery_reason = _paper_status(status)
    return (
        QuantaxisDeployment(
            deployment_id=deployment_id,
            user_id=user_id,
            target=DeploymentTarget.SHADOW,
            status=mapped_status,
            strategy_snapshot=snapshot,
            account_cookie=f"qa:shadow:{user_id}:{deployment_id}",
            market=str(limits.get("market") or "CRYPTO").strip().upper(),
            symbols=symbols,
            timeframe=str(limits.get("timeframe") or limits.get("interval") or "1h").strip(),
            parameters={"migration_source": "paper", "legacy_deployment_id": _legacy_id(paper)},
            risk_policy=limits,
            broker_binding_id=None,
            created_at=created_at,
            updated_at=updated_at,
            started_at=_get(paper, "started_at"),
            paused_at=_get(paper, "paused_at"),
            stopped_at=None,
            archived_at=_get(paper, "archived_at"),
            recovery_reason=recovery_reason,
        ),
        "",
    )


def quantaxis_deployment_from_live(
    live: dict[str, Any],
    *,
    strategy_store: StrategyVersionStoreLike,
) -> tuple[QuantaxisDeployment | None, str]:
    status = str(live.get("status") or "").strip().lower()
    if status == "archived":
        return None, "archived legacy deployment"
    strategy_id = str(live.get("strategy_id") or "").strip()
    user_id = int(live.get("user_id") or 0)
    snapshot, reason = _strategy_snapshot(strategy_store, strategy_id=strategy_id, user_id=user_id)
    if snapshot is None:
        return None, reason
    limits = _as_dict(live.get("limits"))
    symbols = tuple(_normalize_symbol(item) for item in limits.get("symbols", []) if str(item).strip())
    if not symbols:
        return None, "legacy live deployment has no symbols"
    deployment_id = _migrated_id("live", _legacy_id(live))
    created_at = str(live.get("created_at") or live.get("updated_at") or snapshot.created_at)
    updated_at = str(live.get("updated_at") or created_at)
    mapped_status, recovery_reason = _live_status(status)
    broker_binding_id = live.get("broker_binding_id")
    if broker_binding_id is not None:
        broker_binding_id = int(broker_binding_id)
    return (
        QuantaxisDeployment(
            deployment_id=deployment_id,
            user_id=user_id,
            target=DeploymentTarget.LIVE,
            status=mapped_status,
            strategy_snapshot=snapshot,
            account_cookie=f"qa:live:{user_id}:{deployment_id}",
            market=str(limits.get("market") or "CRYPTO").strip().upper(),
            symbols=symbols,
            timeframe=str(limits.get("timeframe") or f"{int(live.get('interval_seconds') or 3600)}s").strip(),
            parameters={"migration_source": "live", "legacy_deployment_id": _legacy_id(live)},
            risk_policy={**limits, "legacy_broker": str(live.get("broker") or "")},
            broker_binding_id=broker_binding_id,
            created_at=created_at,
            updated_at=updated_at,
            started_at=live.get("started_at"),
            paused_at=live.get("paused_at"),
            stopped_at=None,
            archived_at=live.get("archived_at"),
            recovery_reason=recovery_reason,
        ),
        "",
    )


def load_paper_deployments_from_sqlite(db_path: Path) -> list[dict[str, Any]]:
    if not db_path.exists():
        return []
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT * FROM paper_deployments ORDER BY updated_at DESC, deployment_id").fetchall()
    finally:
        conn.close()
    return [_paper_row_to_dict(row) for row in rows]


def load_live_deployments_from_json(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    items = raw.get("deployments") if isinstance(raw, dict) else raw
    return [dict(item) for item in items or [] if isinstance(item, dict)]


def _paper_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "deployment_id": row["deployment_id"],
        "user_id": int(row["user_id"]),
        "status": row["status"],
        "strategy_id": row["strategy_id"],
        "strategy_snapshot": _loads(row["strategy_snapshot_json"], {}),
        "limits": _loads(row["limits_json"], {}),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "paused_at": row["paused_at"],
        "archived_at": row["archived_at"],
        "last_tick_at": row["last_tick_at"],
    }


def _strategy_snapshot(
    strategy_store: StrategyVersionStoreLike,
    *,
    strategy_id: str,
    user_id: int,
) -> tuple[StrategyVersionSnapshot | None, str]:
    if not strategy_id:
        return None, "legacy deployment has no strategy_id"
    versions = strategy_store.list_strategy_versions(strategy_id, user_id=user_id)
    if not versions:
        return None, "strategy has no immutable version"
    return StrategyVersionSnapshot.from_version_row(versions[0]), ""


def _already_migrated(store: DeploymentStoreLike, deployment: QuantaxisDeployment) -> bool:
    try:
        return store.get(deployment.deployment_id, user_id=deployment.user_id) is not None
    except TypeError:
        return store.get(deployment.deployment_id) is not None


def _paper_status(status: str) -> tuple[DeploymentStatus, str]:
    if status == "draft":
        return DeploymentStatus.DRAFT, ""
    if status == "paused":
        return DeploymentStatus.PAUSED, ""
    if status == "running":
        return DeploymentStatus.RECOVERY_REQUIRED, "migrated running paper deployment requires QUANTAXIS startup recovery before resume"
    return DeploymentStatus.STOPPED, ""


def _live_status(status: str) -> tuple[DeploymentStatus, str]:
    if status == "draft":
        return DeploymentStatus.DRAFT, ""
    if status == "paused":
        return DeploymentStatus.PAUSED, ""
    if status == "running":
        return DeploymentStatus.RECOVERY_REQUIRED, "migrated live deployment requires broker reconciliation before resume"
    return DeploymentStatus.STOPPED, ""


def _get(item: Any, key: str) -> Any:
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def _as_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if hasattr(value, "to_dict"):
        return dict(value.to_dict())
    return dict(value)


def _loads(value: Any, default: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if not value:
        return default
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        return default


def _legacy_id(item: Any) -> str:
    return str(_get(item, "deployment_id") or _get(item, "id") or "").strip()


def _migrated_id(source: str, legacy_id: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9_.:-]+", "_", legacy_id).strip("_")
    return f"qadep:migrated:{source}:{clean[:96]}"


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper().replace("/", "_").replace("-", "_")
