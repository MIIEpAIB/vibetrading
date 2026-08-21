"""MySQL metadata store for QUANTAXIS-native deployments."""

from __future__ import annotations

import json
import threading
from typing import Any

from src.persistence.mysql import mysql_connection
from src.quantaxis_native.models import (
    DeploymentStatus,
    QuantaxisDeployment,
    StrategyVersionSnapshot,
    dumps,
)


class MySQLQuantaxisDeploymentStore:
    """Store product metadata; QUANTAXIS remains the account/order source."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._init_db()

    def _init_db(self) -> None:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS strategy_deployments (
                        deployment_id VARCHAR(128) NOT NULL,
                        user_id BIGINT UNSIGNED NOT NULL,
                        target VARCHAR(16) NOT NULL,
                        status VARCHAR(32) NOT NULL,
                        strategy_id VARCHAR(128) NOT NULL,
                        strategy_version_no INT UNSIGNED NOT NULL,
                        strategy_snapshot_json JSON NOT NULL,
                        account_cookie VARCHAR(191) NOT NULL,
                        market VARCHAR(64) NOT NULL,
                        symbols_json JSON NOT NULL,
                        timeframe VARCHAR(32) NOT NULL,
                        parameters_json JSON NOT NULL,
                        risk_policy_json JSON NOT NULL,
                        broker_binding_id BIGINT UNSIGNED NULL,
                        created_at VARCHAR(64) NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        started_at VARCHAR(64) NULL,
                        paused_at VARCHAR(64) NULL,
                        stopped_at VARCHAR(64) NULL,
                        archived_at VARCHAR(64) NULL,
                        recovery_reason TEXT NOT NULL,
                        PRIMARY KEY (deployment_id),
                        UNIQUE KEY uq_strategy_deployment_account (account_cookie),
                        KEY idx_strategy_deployments_user_updated (user_id, updated_at),
                        KEY idx_strategy_deployments_strategy (user_id, strategy_id, strategy_version_no),
                        KEY idx_strategy_deployments_status (target, status)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS strategy_deployment_promotions (
                        promotion_id VARCHAR(128) NOT NULL,
                        user_id BIGINT UNSIGNED NOT NULL,
                        source_deployment_id VARCHAR(128) NOT NULL,
                        target_deployment_id VARCHAR(128) NOT NULL,
                        strategy_version_id VARCHAR(191) NOT NULL,
                        risk_snapshot_json JSON NOT NULL,
                        consent_ref VARCHAR(191) NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        PRIMARY KEY (promotion_id),
                        UNIQUE KEY uq_strategy_deployment_promotion_target (target_deployment_id),
                        KEY idx_strategy_deployment_promotion_source (user_id, source_deployment_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS strategy_deployment_permissions (
                        permission_id VARCHAR(128) NOT NULL,
                        deployment_id VARCHAR(128) NOT NULL,
                        user_id BIGINT UNSIGNED NOT NULL,
                        role VARCHAR(32) NOT NULL,
                        granted_by BIGINT UNSIGNED NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        revoked_at VARCHAR(64) NULL,
                        PRIMARY KEY (permission_id),
                        UNIQUE KEY uq_strategy_deployment_permission_user (deployment_id, user_id, role),
                        KEY idx_strategy_deployment_permission_user (user_id, revoked_at)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS strategy_runtime_leases (
                        lease_id VARCHAR(128) NOT NULL,
                        deployment_id VARCHAR(128) NOT NULL,
                        worker_id VARCHAR(128) NOT NULL,
                        lease_until VARCHAR(64) NOT NULL,
                        last_event_id VARCHAR(191) NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        PRIMARY KEY (lease_id),
                        UNIQUE KEY uq_strategy_runtime_lease_deployment (deployment_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS strategy_runtime_tasks (
                        task_id VARCHAR(128) NOT NULL,
                        deployment_id VARCHAR(128) NOT NULL,
                        task_type VARCHAR(64) NOT NULL,
                        status VARCHAR(32) NOT NULL,
                        active TINYINT(1) NOT NULL DEFAULT 1,
                        qa_task_id VARCHAR(191) NOT NULL,
                        engine_name VARCHAR(128) NOT NULL,
                        payload_json JSON NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        cancelled_at VARCHAR(64) NULL,
                        PRIMARY KEY (task_id),
                        UNIQUE KEY uq_strategy_runtime_task_active (deployment_id, task_type, active),
                        KEY idx_strategy_runtime_tasks_deployment (deployment_id, status)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS strategy_runtime_events (
                        event_id VARCHAR(128) NOT NULL,
                        deployment_id VARCHAR(128) NOT NULL,
                        account_cookie VARCHAR(191) NULL,
                        event_scope VARCHAR(64) NOT NULL,
                        event_type VARCHAR(128) NOT NULL,
                        sequence_no BIGINT UNSIGNED NOT NULL,
                        idempotency_key VARCHAR(191) NOT NULL,
                        payload_json JSON NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        PRIMARY KEY (event_id),
                        UNIQUE KEY uq_strategy_runtime_event_idempotency (deployment_id, event_scope, idempotency_key),
                        UNIQUE KEY uq_strategy_runtime_event_sequence (deployment_id, event_scope, sequence_no),
                        KEY idx_strategy_runtime_events_deployment (deployment_id, event_scope, sequence_no)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS strategy_event_offsets (
                        deployment_id VARCHAR(128) NOT NULL,
                        consumer_name VARCHAR(128) NOT NULL,
                        event_scope VARCHAR(64) NOT NULL,
                        last_event_id VARCHAR(128) NOT NULL,
                        last_sequence_no BIGINT UNSIGNED NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        PRIMARY KEY (deployment_id, consumer_name, event_scope)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
            conn.commit()

    def create(self, deployment: QuantaxisDeployment) -> QuantaxisDeployment:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO strategy_deployments (
                        deployment_id, user_id, target, status, strategy_id,
                        strategy_version_no, strategy_snapshot_json, account_cookie,
                        market, symbols_json, timeframe, parameters_json,
                        risk_policy_json, broker_binding_id, created_at, updated_at,
                        started_at, paused_at, stopped_at, archived_at, recovery_reason
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    self._params(deployment),
                )
            conn.commit()
        return deployment

    def record_promotion(
        self,
        *,
        promotion_id: str,
        user_id: int,
        source_deployment_id: str,
        target_deployment_id: str,
        strategy_version_id: str,
        risk_snapshot: dict[str, Any],
        consent_ref: str,
        created_at: str,
    ) -> None:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO strategy_deployment_promotions (
                        promotion_id, user_id, source_deployment_id,
                        target_deployment_id, strategy_version_id,
                        risk_snapshot_json, consent_ref, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        promotion_id,
                        int(user_id),
                        source_deployment_id,
                        target_deployment_id,
                        strategy_version_id,
                        dumps(risk_snapshot),
                        consent_ref,
                        created_at,
                    ),
                )
            conn.commit()

    def append_runtime_event(
        self,
        *,
        event_id: str,
        deployment_id: str,
        account_cookie: str | None,
        event_scope: str,
        event_type: str,
        idempotency_key: str,
        payload: dict[str, Any],
        created_at: str,
    ) -> dict[str, Any]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT *
                    FROM strategy_runtime_events
                    WHERE deployment_id=%s AND event_scope=%s AND idempotency_key=%s
                    LIMIT 1
                    """,
                    (deployment_id, event_scope, idempotency_key),
                )
                existing = cur.fetchone()
                if existing:
                    return self._runtime_event_from_row(existing)
                cur.execute(
                    """
                    SELECT COALESCE(MAX(sequence_no), 0) AS last_sequence
                    FROM strategy_runtime_events
                    WHERE deployment_id=%s AND event_scope=%s
                    FOR UPDATE
                    """,
                    (deployment_id, event_scope),
                )
                row = cur.fetchone() or {}
                sequence_no = int(row.get("last_sequence") or 0) + 1
                cur.execute(
                    """
                    INSERT INTO strategy_runtime_events (
                        event_id, deployment_id, account_cookie, event_scope,
                        event_type, sequence_no, idempotency_key,
                        payload_json, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        event_id,
                        deployment_id,
                        account_cookie,
                        event_scope,
                        event_type,
                        sequence_no,
                        idempotency_key,
                        dumps(payload),
                        created_at,
                    ),
                )
            conn.commit()
        return {
            "event_id": event_id,
            "deployment_id": deployment_id,
            "account_cookie": account_cookie,
            "event_scope": event_scope,
            "event_type": event_type,
            "sequence_no": sequence_no,
            "idempotency_key": idempotency_key,
            "payload": payload,
            "created_at": created_at,
        }

    def list_runtime_events(
        self,
        *,
        deployment_id: str,
        event_scope: str | None = None,
        after_sequence_no: int = 0,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 500))
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                if event_scope:
                    cur.execute(
                        """
                        SELECT *
                        FROM strategy_runtime_events
                        WHERE deployment_id=%s AND event_scope=%s AND sequence_no>%s
                        ORDER BY sequence_no ASC
                        LIMIT %s
                        """,
                        (deployment_id, event_scope, int(after_sequence_no), limit),
                    )
                else:
                    cur.execute(
                        """
                        SELECT *
                        FROM strategy_runtime_events
                        WHERE deployment_id=%s
                        ORDER BY created_at ASC, sequence_no ASC
                        LIMIT %s
                        """,
                        (deployment_id, limit),
                    )
                rows = cur.fetchall()
        return [self._runtime_event_from_row(row) for row in rows]

    def save_event_offset(
        self,
        *,
        deployment_id: str,
        consumer_name: str,
        event_scope: str,
        last_event_id: str,
        last_sequence_no: int,
        updated_at: str,
    ) -> None:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO strategy_event_offsets (
                        deployment_id, consumer_name, event_scope,
                        last_event_id, last_sequence_no, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        last_event_id=VALUES(last_event_id),
                        last_sequence_no=VALUES(last_sequence_no),
                        updated_at=VALUES(updated_at)
                    """,
                    (deployment_id, consumer_name, event_scope, last_event_id, int(last_sequence_no), updated_at),
                )
            conn.commit()

    def get_event_offset(self, *, deployment_id: str, consumer_name: str, event_scope: str) -> dict[str, Any] | None:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT *
                    FROM strategy_event_offsets
                    WHERE deployment_id=%s AND consumer_name=%s AND event_scope=%s
                    """,
                    (deployment_id, consumer_name, event_scope),
                )
                row = cur.fetchone()
        return dict(row) if row else None

    def register_runtime_task(
        self,
        *,
        task_id: str,
        deployment_id: str,
        task_type: str,
        qa_task_id: str,
        engine_name: str,
        payload: dict[str, Any],
        created_at: str,
    ) -> dict[str, Any]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO strategy_runtime_tasks (
                        task_id, deployment_id, task_type, status, active, qa_task_id,
                        engine_name, payload_json, created_at, updated_at, cancelled_at
                    )
                    VALUES (%s, %s, %s, 'registered', 1, %s, %s, %s, %s, %s, NULL)
                    ON DUPLICATE KEY UPDATE
                        status='registered',
                        active=1,
                        qa_task_id=VALUES(qa_task_id),
                        engine_name=VALUES(engine_name),
                        payload_json=VALUES(payload_json),
                        updated_at=VALUES(updated_at),
                        cancelled_at=NULL
                    """,
                    (
                        task_id,
                        deployment_id,
                        task_type,
                        qa_task_id,
                        engine_name,
                        dumps(payload),
                        created_at,
                        created_at,
                    ),
                )
            conn.commit()
        return {
            "task_id": task_id,
            "deployment_id": deployment_id,
            "task_type": task_type,
            "status": "registered",
            "active": 1,
            "qa_task_id": qa_task_id,
            "engine_name": engine_name,
            "payload": payload,
            "created_at": created_at,
            "updated_at": created_at,
            "cancelled_at": None,
        }

    def cancel_runtime_tasks(self, *, deployment_id: str, task_type: str | None, cancelled_at: str) -> int:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                if task_type:
                    cur.execute(
                        """
                        UPDATE strategy_runtime_tasks
                        SET status='cancelled', active=0, updated_at=%s, cancelled_at=%s
                        WHERE deployment_id=%s AND task_type=%s AND status='registered'
                        """,
                        (cancelled_at, cancelled_at, deployment_id, task_type),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE strategy_runtime_tasks
                        SET status='cancelled', active=0, updated_at=%s, cancelled_at=%s
                        WHERE deployment_id=%s AND status='registered'
                        """,
                        (cancelled_at, cancelled_at, deployment_id),
                    )
                count = int(cur.rowcount or 0)
            conn.commit()
        return count

    def acquire_runtime_lease(
        self,
        *,
        deployment_id: str,
        worker_id: str,
        lease_until: str,
        now: str,
        last_event_id: str = "",
    ) -> bool:
        lease_id = f"lease:{deployment_id}"
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO strategy_runtime_leases (
                        lease_id, deployment_id, worker_id, lease_until,
                        last_event_id, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        worker_id = IF(lease_until < VALUES(updated_at) OR worker_id = VALUES(worker_id), VALUES(worker_id), worker_id),
                        lease_until = IF(lease_until < VALUES(updated_at) OR worker_id = VALUES(worker_id), VALUES(lease_until), lease_until),
                        last_event_id = IF(lease_until < VALUES(updated_at) OR worker_id = VALUES(worker_id), VALUES(last_event_id), last_event_id),
                        updated_at = IF(lease_until < VALUES(updated_at) OR worker_id = VALUES(worker_id), VALUES(updated_at), updated_at)
                    """,
                    (lease_id, deployment_id, worker_id, lease_until, last_event_id, now),
                )
                cur.execute("SELECT worker_id FROM strategy_runtime_leases WHERE deployment_id=%s", (deployment_id,))
                row = cur.fetchone() or {}
            conn.commit()
        return str(row.get("worker_id") or "") == worker_id

    def update(self, deployment: QuantaxisDeployment) -> QuantaxisDeployment:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE strategy_deployments
                    SET user_id=%s, target=%s, status=%s, strategy_id=%s,
                        strategy_version_no=%s, strategy_snapshot_json=%s,
                        account_cookie=%s, market=%s, symbols_json=%s,
                        timeframe=%s, parameters_json=%s, risk_policy_json=%s,
                        broker_binding_id=%s, created_at=%s, updated_at=%s,
                        started_at=%s, paused_at=%s, stopped_at=%s,
                        archived_at=%s, recovery_reason=%s
                    WHERE deployment_id=%s
                    """,
                    (*self._params(deployment)[1:], deployment.deployment_id),
                )
                if cur.rowcount == 0:
                    raise KeyError(f"deployment not found: {deployment.deployment_id}")
            conn.commit()
        return deployment

    def get(self, deployment_id: str, *, user_id: int | None = None) -> QuantaxisDeployment | None:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                if user_id is None:
                    cur.execute("SELECT * FROM strategy_deployments WHERE deployment_id=%s", (deployment_id,))
                else:
                    cur.execute(
                        "SELECT * FROM strategy_deployments WHERE deployment_id=%s AND user_id=%s",
                        (deployment_id, int(user_id)),
                    )
                row = cur.fetchone()
        return self._from_row(row) if row else None

    def list(self, *, user_id: int) -> list[QuantaxisDeployment]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM strategy_deployments
                    WHERE user_id=%s
                    ORDER BY updated_at DESC, deployment_id
                    """,
                    (int(user_id),),
                )
                rows = cur.fetchall()
        return [self._from_row(row) for row in rows]

    def list_by_status(self, statuses: list[DeploymentStatus]) -> list[QuantaxisDeployment]:
        if not statuses:
            return []
        placeholders = ", ".join(["%s"] * len(statuses))
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT *
                    FROM strategy_deployments
                    WHERE status IN ({placeholders})
                    ORDER BY updated_at ASC, deployment_id
                    """,
                    tuple(status.value for status in statuses),
                )
                rows = cur.fetchall()
        return [self._from_row(row) for row in rows]

    @staticmethod
    def _params(deployment: QuantaxisDeployment) -> tuple[Any, ...]:
        return (
            deployment.deployment_id,
            deployment.user_id,
            deployment.target.value,
            deployment.status.value,
            deployment.strategy_snapshot.strategy_id,
            deployment.strategy_snapshot.version_no,
            dumps(deployment.strategy_snapshot.to_dict()),
            deployment.account_cookie,
            deployment.market,
            dumps(list(deployment.symbols)),
            deployment.timeframe,
            dumps(deployment.parameters),
            dumps(deployment.risk_policy),
            deployment.broker_binding_id,
            deployment.created_at,
            deployment.updated_at,
            deployment.started_at,
            deployment.paused_at,
            deployment.stopped_at,
            deployment.archived_at,
            deployment.recovery_reason,
        )

    @staticmethod
    def _from_row(row: dict[str, Any]) -> QuantaxisDeployment:
        data = {
            "deployment_id": row["deployment_id"],
            "user_id": row["user_id"],
            "target": row["target"],
            "status": row["status"],
            "strategy_snapshot": _json(row["strategy_snapshot_json"], {}),
            "account_cookie": row["account_cookie"],
            "market": row["market"],
            "symbols": _json(row["symbols_json"], []),
            "timeframe": row["timeframe"],
            "parameters": _json(row["parameters_json"], {}),
            "risk_policy": _json(row["risk_policy_json"], {}),
            "broker_binding_id": row.get("broker_binding_id"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "started_at": row.get("started_at"),
            "paused_at": row.get("paused_at"),
            "stopped_at": row.get("stopped_at"),
            "archived_at": row.get("archived_at"),
            "recovery_reason": row.get("recovery_reason") or "",
        }
        return QuantaxisDeployment.from_dict(data)

    @staticmethod
    def _runtime_event_from_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "event_id": row["event_id"],
            "deployment_id": row["deployment_id"],
            "account_cookie": row.get("account_cookie"),
            "event_scope": row["event_scope"],
            "event_type": row["event_type"],
            "sequence_no": int(row["sequence_no"]),
            "idempotency_key": row["idempotency_key"],
            "payload": _json(row["payload_json"], {}),
            "created_at": row["created_at"],
        }


def _json(value: Any, default: Any) -> Any:
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
