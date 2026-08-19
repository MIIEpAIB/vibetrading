"""Persistence for paper strategy deployments."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any, Protocol

from src.paper_trading.models import (
    EXECUTION_MODES,
    PaperDeployment,
    PaperLimits,
    PaperOrderLink,
    PaperRiskDecision,
    PaperSignal,
    PaperTickResult,
    StrategySnapshot,
)

_DEFAULT_DB_PATH = Path.home() / ".vibe-trading" / "paper_trading.db"
_DB_PATH_ENV = "VIBE_TRADING_PAPER_DB_PATH"


class PaperTradingStore(Protocol):
    """Store contract used by the paper trading service."""

    def create_deployment(self, deployment: PaperDeployment) -> PaperDeployment: ...

    def update_deployment(self, deployment: PaperDeployment) -> PaperDeployment: ...

    def get_deployment(self, deployment_id: str, *, user_id: int | None = None) -> PaperDeployment | None: ...

    def list_deployments(self, *, user_id: int) -> list[PaperDeployment]: ...

    def add_signal(self, signal: PaperSignal) -> PaperSignal: ...

    def list_signals(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperSignal]: ...

    def add_decision(self, decision: PaperRiskDecision) -> PaperRiskDecision: ...

    def list_decisions(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperRiskDecision]: ...

    def add_order_link(self, link: PaperOrderLink) -> PaperOrderLink: ...

    def list_order_links(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperOrderLink]: ...

    def add_tick(self, tick: PaperTickResult) -> PaperTickResult: ...

    def list_ticks(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperTickResult]: ...

    def count_order_links_for_day(self, deployment_id: str, *, user_id: int, day_prefix: str) -> int: ...


def _json_dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _json_loads(value: str | bytes | None, default: object) -> object:
    if value is None:
        return default
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if not value:
        return default
    return json.loads(value)


def _default_db_path() -> Path:
    raw = os.getenv(_DB_PATH_ENV, "").strip()
    if raw:
        return Path(raw).expanduser()
    return _DEFAULT_DB_PATH


def _row_text(row: sqlite3.Row, key: str, default: str = "") -> str:
    if key not in row.keys():
        return default
    value = row[key]
    if value is None:
        return default
    text = str(value)
    if key == "execution_mode" and text not in EXECUTION_MODES:
        return default
    return text


class InMemoryPaperTradingStore:
    """Thread-safe in-memory store for tests and injected local use."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.deployments: dict[str, PaperDeployment] = {}
        self.signals: list[PaperSignal] = []
        self.decisions: list[PaperRiskDecision] = []
        self.order_links: list[PaperOrderLink] = []
        self.ticks: list[PaperTickResult] = []

    def create_deployment(self, deployment: PaperDeployment) -> PaperDeployment:
        with self._lock:
            if deployment.deployment_id in self.deployments:
                raise ValueError(f"deployment already exists: {deployment.deployment_id}")
            self.deployments[deployment.deployment_id] = deployment
        return deployment

    def update_deployment(self, deployment: PaperDeployment) -> PaperDeployment:
        with self._lock:
            if deployment.deployment_id not in self.deployments:
                raise KeyError(f"deployment not found: {deployment.deployment_id}")
            self.deployments[deployment.deployment_id] = deployment
        return deployment

    def get_deployment(self, deployment_id: str, *, user_id: int | None = None) -> PaperDeployment | None:
        with self._lock:
            deployment = self.deployments.get(deployment_id)
        if deployment is None:
            return None
        if user_id is not None and deployment.user_id != int(user_id):
            return None
        return deployment

    def list_deployments(self, *, user_id: int) -> list[PaperDeployment]:
        with self._lock:
            rows = [item for item in self.deployments.values() if item.user_id == int(user_id)]
        return sorted(rows, key=lambda item: item.updated_at, reverse=True)

    def add_signal(self, signal: PaperSignal) -> PaperSignal:
        with self._lock:
            self.signals.append(signal)
        return signal

    def list_signals(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperSignal]:
        with self._lock:
            rows = [s for s in self.signals if s.deployment_id == deployment_id and s.user_id == int(user_id)]
        return sorted(rows, key=lambda item: item.created_at, reverse=True)[:limit]

    def add_decision(self, decision: PaperRiskDecision) -> PaperRiskDecision:
        with self._lock:
            self.decisions.append(decision)
        return decision

    def list_decisions(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperRiskDecision]:
        with self._lock:
            rows = [d for d in self.decisions if d.deployment_id == deployment_id and d.user_id == int(user_id)]
        return sorted(rows, key=lambda item: item.created_at, reverse=True)[:limit]

    def add_order_link(self, link: PaperOrderLink) -> PaperOrderLink:
        with self._lock:
            self.order_links.append(link)
        return link

    def list_order_links(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperOrderLink]:
        with self._lock:
            rows = [l for l in self.order_links if l.deployment_id == deployment_id and l.user_id == int(user_id)]
        return sorted(rows, key=lambda item: item.created_at, reverse=True)[:limit]

    def add_tick(self, tick: PaperTickResult) -> PaperTickResult:
        with self._lock:
            self.ticks.append(tick)
        return tick

    def list_ticks(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperTickResult]:
        with self._lock:
            rows = [t for t in self.ticks if t.deployment_id == deployment_id and t.user_id == int(user_id)]
        return sorted(rows, key=lambda item: item.created_at, reverse=True)[:limit]

    def count_order_links_for_day(self, deployment_id: str, *, user_id: int, day_prefix: str) -> int:
        with self._lock:
            return sum(
                1
                for link in self.order_links
                if link.deployment_id == deployment_id
                and link.user_id == int(user_id)
                and link.created_at.startswith(day_prefix)
            )


class SQLitePaperTradingStore:
    """SQLite-backed paper trading store."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = Path(db_path) if db_path is not None else _default_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._lock = threading.RLock()
        self._init_db()

    def _init_db(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS paper_deployments (
                    deployment_id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    strategy_id TEXT NOT NULL,
                    strategy_snapshot_json TEXT NOT NULL,
                    limits_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    execution_mode TEXT NOT NULL DEFAULT 'shadow',
                    connector_profile_id TEXT NOT NULL DEFAULT '',
                    started_at TEXT,
                    paused_at TEXT,
                    archived_at TEXT,
                    last_tick_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_paper_deployments_user_updated
                    ON paper_deployments(user_id, updated_at);

                CREATE TABLE IF NOT EXISTS paper_signals (
                    signal_id TEXT PRIMARY KEY,
                    deployment_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    strategy_version TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    action TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    data_timestamp TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    confidence REAL,
                    target_weight REAL,
                    quantity REAL,
                    notional REAL,
                    limit_price REAL,
                    metadata_json TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_paper_signals_deployment_created
                    ON paper_signals(deployment_id, user_id, created_at);

                CREATE TABLE IF NOT EXISTS paper_risk_decisions (
                    decision_id TEXT PRIMARY KEY,
                    deployment_id TEXT NOT NULL,
                    signal_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    decision TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    breached_limit TEXT NOT NULL,
                    order_notional REAL NOT NULL,
                    price REAL NOT NULL,
                    quantity REAL NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_paper_decisions_deployment_created
                    ON paper_risk_decisions(deployment_id, user_id, created_at);

                CREATE TABLE IF NOT EXISTS paper_order_links (
                    link_id TEXT PRIMARY KEY,
                    deployment_id TEXT NOT NULL,
                    signal_id TEXT NOT NULL,
                    decision_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    shadow_order_id TEXT NOT NULL,
                    shadow_status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    rejection_reason TEXT NOT NULL,
                    execution_mode TEXT NOT NULL DEFAULT 'shadow',
                    connector_profile_id TEXT NOT NULL DEFAULT '',
                    broker_order_id TEXT NOT NULL DEFAULT '',
                    broker_payload_json TEXT NOT NULL DEFAULT '{}',
                    qifi_order_id TEXT NOT NULL DEFAULT '',
                    qifi_trade_id TEXT NOT NULL DEFAULT '',
                    qifi_account_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE INDEX IF NOT EXISTS idx_paper_order_links_deployment_created
                    ON paper_order_links(deployment_id, user_id, created_at);

                CREATE TABLE IF NOT EXISTS paper_ticks (
                    tick_id TEXT PRIMARY KEY,
                    deployment_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    outcome TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    signal_id TEXT,
                    decision_id TEXT,
                    shadow_order_id TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_paper_ticks_deployment_created
                    ON paper_ticks(deployment_id, user_id, created_at);
                """
            )
            self._ensure_column("paper_deployments", "execution_mode", "TEXT NOT NULL DEFAULT 'shadow'")
            self._ensure_column("paper_deployments", "connector_profile_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column("paper_order_links", "execution_mode", "TEXT NOT NULL DEFAULT 'shadow'")
            self._ensure_column("paper_order_links", "connector_profile_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column("paper_order_links", "broker_order_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column("paper_order_links", "broker_payload_json", "TEXT NOT NULL DEFAULT '{}'")
            self._ensure_column("paper_order_links", "qifi_order_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column("paper_order_links", "qifi_trade_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column("paper_order_links", "qifi_account_json", "TEXT NOT NULL DEFAULT '{}'")
            self._conn.commit()

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        rows = self._conn.execute(f"PRAGMA table_info({table})").fetchall()
        if any(str(row["name"]) == column for row in rows):
            return
        self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def create_deployment(self, deployment: PaperDeployment) -> PaperDeployment:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO paper_deployments (
                    deployment_id, user_id, status, strategy_id, strategy_snapshot_json,
                    limits_json, created_at, updated_at, execution_mode, connector_profile_id,
                    started_at, paused_at, archived_at, last_tick_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                self._deployment_params(deployment),
            )
            self._conn.commit()
        return deployment

    def update_deployment(self, deployment: PaperDeployment) -> PaperDeployment:
        with self._lock:
            cur = self._conn.execute(
                """
                UPDATE paper_deployments
                SET user_id = ?, status = ?, strategy_id = ?, strategy_snapshot_json = ?,
                    limits_json = ?, created_at = ?, updated_at = ?, execution_mode = ?,
                    connector_profile_id = ?, started_at = ?, paused_at = ?, archived_at = ?,
                    last_tick_at = ?
                WHERE deployment_id = ?
                """,
                (
                    deployment.user_id,
                    deployment.status,
                    deployment.strategy_id,
                    _json_dumps(deployment.strategy_snapshot.to_dict()),
                    _json_dumps(deployment.limits.to_dict()),
                    deployment.created_at,
                    deployment.updated_at,
                    deployment.execution_mode,
                    deployment.connector_profile_id,
                    deployment.started_at,
                    deployment.paused_at,
                    deployment.archived_at,
                    deployment.last_tick_at,
                    deployment.deployment_id,
                ),
            )
            self._conn.commit()
        if cur.rowcount == 0:
            raise KeyError(f"deployment not found: {deployment.deployment_id}")
        return deployment

    def get_deployment(self, deployment_id: str, *, user_id: int | None = None) -> PaperDeployment | None:
        with self._lock:
            if user_id is None:
                row = self._conn.execute(
                    "SELECT * FROM paper_deployments WHERE deployment_id = ?",
                    (deployment_id,),
                ).fetchone()
            else:
                row = self._conn.execute(
                    "SELECT * FROM paper_deployments WHERE deployment_id = ? AND user_id = ?",
                    (deployment_id, int(user_id)),
                ).fetchone()
        return self._deployment_from_row(row) if row else None

    def list_deployments(self, *, user_id: int) -> list[PaperDeployment]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT * FROM paper_deployments
                WHERE user_id = ?
                ORDER BY updated_at DESC, deployment_id
                """,
                (int(user_id),),
            ).fetchall()
        return [self._deployment_from_row(row) for row in rows]

    def add_signal(self, signal: PaperSignal) -> PaperSignal:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO paper_signals (
                    signal_id, deployment_id, user_id, strategy_version, symbol, action,
                    reason, data_timestamp, created_at, confidence, target_weight,
                    quantity, notional, limit_price, metadata_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    signal.signal_id,
                    signal.deployment_id,
                    signal.user_id,
                    signal.strategy_version,
                    signal.symbol,
                    signal.action,
                    signal.reason,
                    signal.data_timestamp,
                    signal.created_at,
                    signal.confidence,
                    signal.target_weight,
                    signal.quantity,
                    signal.notional,
                    signal.limit_price,
                    _json_dumps(signal.metadata),
                ),
            )
            self._conn.commit()
        return signal

    def list_signals(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperSignal]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT * FROM paper_signals
                WHERE deployment_id = ? AND user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (deployment_id, int(user_id), int(limit)),
            ).fetchall()
        return [self._signal_from_row(row) for row in rows]

    def add_decision(self, decision: PaperRiskDecision) -> PaperRiskDecision:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO paper_risk_decisions (
                    decision_id, deployment_id, signal_id, user_id, decision, reason,
                    created_at, breached_limit, order_notional, price, quantity
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    decision.decision_id,
                    decision.deployment_id,
                    decision.signal_id,
                    decision.user_id,
                    decision.decision,
                    decision.reason,
                    decision.created_at,
                    decision.breached_limit,
                    decision.order_notional,
                    decision.price,
                    decision.quantity,
                ),
            )
            self._conn.commit()
        return decision

    def list_decisions(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperRiskDecision]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT * FROM paper_risk_decisions
                WHERE deployment_id = ? AND user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (deployment_id, int(user_id), int(limit)),
            ).fetchall()
        return [self._decision_from_row(row) for row in rows]

    def add_order_link(self, link: PaperOrderLink) -> PaperOrderLink:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO paper_order_links (
                    link_id, deployment_id, signal_id, decision_id, user_id,
                    shadow_order_id, shadow_status, created_at, rejection_reason,
                    execution_mode, connector_profile_id, broker_order_id, broker_payload_json,
                    qifi_order_id, qifi_trade_id, qifi_account_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    link.link_id,
                    link.deployment_id,
                    link.signal_id,
                    link.decision_id,
                    link.user_id,
                    link.shadow_order_id,
                    link.shadow_status,
                    link.created_at,
                    link.rejection_reason,
                    link.execution_mode,
                    link.connector_profile_id,
                    link.broker_order_id,
                    _json_dumps(link.broker_payload),
                    link.qifi_order_id,
                    link.qifi_trade_id,
                    _json_dumps(link.qifi_account_json),
                ),
            )
            self._conn.commit()
        return link

    def list_order_links(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperOrderLink]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT * FROM paper_order_links
                WHERE deployment_id = ? AND user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (deployment_id, int(user_id), int(limit)),
            ).fetchall()
        return [self._order_link_from_row(row) for row in rows]

    def add_tick(self, tick: PaperTickResult) -> PaperTickResult:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO paper_ticks (
                    tick_id, deployment_id, user_id, outcome, created_at, reason,
                    signal_id, decision_id, shadow_order_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tick.tick_id,
                    tick.deployment_id,
                    tick.user_id,
                    tick.outcome,
                    tick.created_at,
                    tick.reason,
                    tick.signal_id,
                    tick.decision_id,
                    tick.shadow_order_id,
                ),
            )
            self._conn.commit()
        return tick

    def list_ticks(self, deployment_id: str, *, user_id: int, limit: int = 20) -> list[PaperTickResult]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT * FROM paper_ticks
                WHERE deployment_id = ? AND user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (deployment_id, int(user_id), int(limit)),
            ).fetchall()
        return [self._tick_from_row(row) for row in rows]

    def count_order_links_for_day(self, deployment_id: str, *, user_id: int, day_prefix: str) -> int:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT COUNT(*) AS count
                FROM paper_order_links
                WHERE deployment_id = ? AND user_id = ? AND created_at LIKE ?
                """,
                (deployment_id, int(user_id), f"{day_prefix}%"),
            ).fetchone()
        return int(row["count"] if row else 0)

    @staticmethod
    def _deployment_params(deployment: PaperDeployment) -> tuple[Any, ...]:
        return (
            deployment.deployment_id,
            deployment.user_id,
            deployment.status,
            deployment.strategy_id,
            _json_dumps(deployment.strategy_snapshot.to_dict()),
            _json_dumps(deployment.limits.to_dict()),
            deployment.created_at,
            deployment.updated_at,
            deployment.execution_mode,
            deployment.connector_profile_id,
            deployment.started_at,
            deployment.paused_at,
            deployment.archived_at,
            deployment.last_tick_at,
        )

    @staticmethod
    def _deployment_from_row(row: sqlite3.Row) -> PaperDeployment:
        snapshot = StrategySnapshot.from_dict(dict(_json_loads(row["strategy_snapshot_json"], {})))
        limits = PaperLimits.from_payload(dict(_json_loads(row["limits_json"], {})))
        return PaperDeployment(
            deployment_id=row["deployment_id"],
            user_id=int(row["user_id"]),
            status=row["status"],
            strategy_id=row["strategy_id"],
            strategy_snapshot=snapshot,
            limits=limits,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            execution_mode=_row_text(row, "execution_mode", "shadow"),
            connector_profile_id=_row_text(row, "connector_profile_id"),
            started_at=row["started_at"],
            paused_at=row["paused_at"],
            archived_at=row["archived_at"],
            last_tick_at=row["last_tick_at"],
        )

    @staticmethod
    def _signal_from_row(row: sqlite3.Row) -> PaperSignal:
        return PaperSignal(
            signal_id=row["signal_id"],
            deployment_id=row["deployment_id"],
            user_id=int(row["user_id"]),
            strategy_version=row["strategy_version"],
            symbol=row["symbol"],
            action=row["action"],
            reason=row["reason"],
            data_timestamp=row["data_timestamp"],
            created_at=row["created_at"],
            confidence=row["confidence"],
            target_weight=row["target_weight"],
            quantity=row["quantity"],
            notional=row["notional"],
            limit_price=row["limit_price"],
            metadata=dict(_json_loads(row["metadata_json"], {})),
        )

    @staticmethod
    def _decision_from_row(row: sqlite3.Row) -> PaperRiskDecision:
        return PaperRiskDecision(
            decision_id=row["decision_id"],
            deployment_id=row["deployment_id"],
            signal_id=row["signal_id"],
            user_id=int(row["user_id"]),
            decision=row["decision"],
            reason=row["reason"],
            created_at=row["created_at"],
            breached_limit=row["breached_limit"],
            order_notional=float(row["order_notional"]),
            price=float(row["price"]),
            quantity=float(row["quantity"]),
        )

    @staticmethod
    def _order_link_from_row(row: sqlite3.Row) -> PaperOrderLink:
        return PaperOrderLink(
            link_id=row["link_id"],
            deployment_id=row["deployment_id"],
            signal_id=row["signal_id"],
            decision_id=row["decision_id"],
            user_id=int(row["user_id"]),
            shadow_order_id=row["shadow_order_id"],
            shadow_status=row["shadow_status"],
            created_at=row["created_at"],
            rejection_reason=row["rejection_reason"],
            execution_mode=_row_text(row, "execution_mode", "shadow"),
            connector_profile_id=_row_text(row, "connector_profile_id"),
            broker_order_id=_row_text(row, "broker_order_id"),
            broker_payload=dict(_json_loads(_row_text(row, "broker_payload_json", "{}"), {})),
            qifi_order_id=_row_text(row, "qifi_order_id"),
            qifi_trade_id=_row_text(row, "qifi_trade_id"),
            qifi_account_json=dict(_json_loads(_row_text(row, "qifi_account_json", "{}"), {})),
        )

    @staticmethod
    def _tick_from_row(row: sqlite3.Row) -> PaperTickResult:
        return PaperTickResult(
            tick_id=row["tick_id"],
            deployment_id=row["deployment_id"],
            user_id=int(row["user_id"]),
            outcome=row["outcome"],
            created_at=row["created_at"],
            reason=row["reason"],
            signal_id=row["signal_id"],
            decision_id=row["decision_id"],
            shadow_order_id=row["shadow_order_id"],
        )
