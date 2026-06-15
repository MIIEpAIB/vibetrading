"""MySQL-backed store for finance research goals."""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Iterator

from src.goal.models import (
    AuditRow,
    EvidenceInput,
    EvidenceRecord,
    GoalClaim,
    GoalCriterion,
    GoalRecord,
    GoalStatus,
    RiskTier,
    StaleGoalError,
)
from src.goal.policy import normalize_required_text, reject_live_execution_objective
from src.persistence.mysql import mysql_connection
from src.tools.path_utils import safe_document_path, safe_run_id

_CURRENT_STATUSES = {
    GoalStatus.ACTIVE,
    GoalStatus.PAUSED,
    GoalStatus.WAITING_USER,
    GoalStatus.NEEDS_REFRESH,
    GoalStatus.INSUFFICIENT_EVIDENCE,
    GoalStatus.COMPLIANCE_BLOCKED,
    GoalStatus.BUDGET_LIMITED,
}

_COMPLETION_RESULTS = {
    "satisfied",
    "satisfied_with_caveat",
    "not_applicable_user_accepted",
}


def _now_iso() -> str:
    return datetime.now().isoformat()


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


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


def _to_json_dict(value: object) -> dict:
    data = asdict(value)
    for key, item in list(data.items()):
        if isinstance(item, Enum):
            data[key] = item.value
    return data


class MySQLGoalStore:
    """MySQL-backed store for finance research goals."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._init_db()

    @contextmanager
    def _transaction(self) -> Iterator[Any]:
        with mysql_connection() as conn:
            try:
                yield conn
            except Exception:
                conn.rollback()
                raise
            else:
                conn.commit()

    def _init_db(self) -> None:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS goals (
                        goal_id VARCHAR(64) PRIMARY KEY,
                        session_id VARCHAR(64) NOT NULL,
                        status VARCHAR(64) NOT NULL,
                        objective TEXT NOT NULL,
                        ui_summary TEXT NOT NULL,
                        source VARCHAR(64) NOT NULL,
                        protocol VARCHAR(128) NOT NULL,
                        risk_tier VARCHAR(128) NOT NULL,
                        token_budget BIGINT,
                        tokens_used BIGINT NOT NULL DEFAULT 0,
                        turn_budget BIGINT,
                        turns_used BIGINT NOT NULL DEFAULT 0,
                        time_budget_seconds BIGINT,
                        time_used_seconds BIGINT NOT NULL DEFAULT 0,
                        budget_wrapup_sent TINYINT(1) NOT NULL DEFAULT 0,
                        created_at VARCHAR(64) NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        completed_at VARCHAR(64),
                        recap TEXT,
                        is_current TINYINT(1) NOT NULL DEFAULT 0,
                        INDEX idx_goals_session_current (session_id, is_current),
                        INDEX idx_goals_updated_at (updated_at)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                self._ensure_column(cur, "goals", "is_current", "TINYINT(1) NOT NULL DEFAULT 0")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS goal_claims (
                        claim_id VARCHAR(64) PRIMARY KEY,
                        goal_id VARCHAR(64) NOT NULL,
                        session_id VARCHAR(64) NOT NULL,
                        claim_type VARCHAR(64) NOT NULL,
                        text TEXT NOT NULL,
                        status VARCHAR(64) NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        INDEX idx_goal_claims_goal (goal_id, status),
                        INDEX idx_goal_claims_session (session_id),
                        CONSTRAINT fk_goal_claims_goal
                            FOREIGN KEY (goal_id) REFERENCES goals(goal_id)
                            ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS goal_criteria (
                        criterion_id VARCHAR(64) PRIMARY KEY,
                        goal_id VARCHAR(64) NOT NULL,
                        session_id VARCHAR(64) NOT NULL,
                        text TEXT NOT NULL,
                        required TINYINT(1) NOT NULL DEFAULT 1,
                        status VARCHAR(64) NOT NULL DEFAULT 'pending',
                        freshness_requirement TEXT,
                        protocol_step VARCHAR(64),
                        created_at VARCHAR(64) NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        INDEX idx_goal_criteria_goal (goal_id, status),
                        INDEX idx_goal_criteria_session (session_id),
                        CONSTRAINT fk_goal_criteria_goal
                            FOREIGN KEY (goal_id) REFERENCES goals(goal_id)
                            ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS goal_evidence (
                        evidence_id VARCHAR(64) PRIMARY KEY,
                        goal_id VARCHAR(64) NOT NULL,
                        session_id VARCHAR(64) NOT NULL,
                        criterion_id VARCHAR(64),
                        claim_id VARCHAR(64),
                        evidence_type VARCHAR(64) NOT NULL,
                        text MEDIUMTEXT NOT NULL,
                        tool_call_id VARCHAR(128),
                        run_id VARCHAR(128),
                        source_provider VARCHAR(128),
                        source_type VARCHAR(128),
                        source_uri TEXT,
                        symbol_universe_json JSON NOT NULL,
                        benchmark_json JSON NOT NULL,
                        timeframe TEXT,
                        method TEXT,
                        assumptions_json JSON NOT NULL,
                        artifact_path TEXT,
                        artifact_hash VARCHAR(128),
                        retrieved_at VARCHAR(64) NOT NULL,
                        data_as_of VARCHAR(128),
                        freshness_status VARCHAR(64) NOT NULL DEFAULT 'unknown',
                        verification_status VARCHAR(64) NOT NULL DEFAULT 'unverified',
                        confidence VARCHAR(64),
                        caveat TEXT,
                        contradicts_claim_ids_json JSON NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        INDEX idx_goal_evidence_goal_created (goal_id, created_at),
                        INDEX idx_goal_evidence_session (session_id),
                        CONSTRAINT fk_goal_evidence_goal
                            FOREIGN KEY (goal_id) REFERENCES goals(goal_id)
                            ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS goal_audits (
                        audit_id VARCHAR(64) PRIMARY KEY,
                        goal_id VARCHAR(64) NOT NULL,
                        session_id VARCHAR(64) NOT NULL,
                        audit_type VARCHAR(64) NOT NULL,
                        result VARCHAR(64) NOT NULL,
                        rows_json JSON NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        INDEX idx_goal_audits_session (session_id),
                        CONSTRAINT fk_goal_audits_goal
                            FOREIGN KEY (goal_id) REFERENCES goals(goal_id)
                            ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )

    @staticmethod
    def _ensure_column(cur: Any, table: str, column: str, definition: str) -> None:
        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = %s
              AND column_name = %s
            """,
            (table, column),
        )
        row = cur.fetchone()
        if int(row["count"] if row else 0) == 0:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def replace_goal(
        self,
        *,
        session_id: str,
        objective: str,
        criteria: list[str],
        ui_summary: str = "",
        source: str = "api",
        protocol: str = "thesis_review",
        risk_tier: RiskTier = RiskTier.RESEARCH_GENERAL,
        token_budget: int | None = None,
        turn_budget: int | None = None,
        time_budget_seconds: int | None = None,
    ) -> GoalRecord:
        session_id = normalize_required_text(session_id, "session_id")
        objective = normalize_required_text(objective, "goal objective")
        reject_live_execution_objective(objective)
        if risk_tier is RiskTier.LIVE_TRADING_OR_EXECUTION:
            raise ValueError("live trading or execution goals are not supported")
        cleaned_criteria = [item.strip() for item in criteria if item.strip()]
        if not cleaned_criteria:
            raise ValueError("at least one goal criterion is required")
        for criterion in cleaned_criteria:
            reject_live_execution_objective(criterion)
        for name, value in {
            "token_budget": token_budget,
            "turn_budget": turn_budget,
            "time_budget_seconds": time_budget_seconds,
        }.items():
            if value is not None and value <= 0:
                raise ValueError(f"{name} must be positive")

        now = _now_iso()
        goal_id = _id("goal")
        summary = ui_summary.strip() or objective[:80]

        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT GET_LOCK(%s, 10) AS acquired", (f"goal:{session_id}",))
                acquired = int((cur.fetchone() or {}).get("acquired") or 0)
                if not acquired:
                    raise TimeoutError("could not acquire session goal lock")
                try:
                    cur.execute(
                        """
                        UPDATE goals
                        SET status = %s, updated_at = %s,
                            completed_at = COALESCE(completed_at, %s),
                            is_current = 0
                        WHERE session_id = %s AND is_current = 1
                        """,
                        (GoalStatus.SUPERSEDED.value, now, now, session_id),
                    )
                    cur.execute(
                        """
                        INSERT INTO goals (
                            goal_id, session_id, status, objective, ui_summary, source,
                            protocol, risk_tier, token_budget, turn_budget,
                            time_budget_seconds, created_at, updated_at, is_current
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
                        """,
                        (
                            goal_id,
                            session_id,
                            GoalStatus.ACTIVE.value,
                            objective,
                            summary,
                            source,
                            protocol,
                            risk_tier.value,
                            token_budget,
                            turn_budget,
                            time_budget_seconds,
                            now,
                            now,
                        ),
                    )
                    cur.execute(
                        """
                        INSERT INTO goal_claims (
                            claim_id, goal_id, session_id, claim_type, text,
                            status, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, 'thesis', %s, 'active', %s, %s)
                        """,
                        (_id("claim"), goal_id, session_id, objective, now, now),
                    )
                    for index, text in enumerate(cleaned_criteria):
                        cur.execute(
                            """
                            INSERT INTO goal_criteria (
                                criterion_id, goal_id, session_id, text, required,
                                status, protocol_step, created_at, updated_at
                            )
                            VALUES (%s, %s, %s, %s, 1, 'pending', %s, %s, %s)
                            """,
                            (_id("crit"), goal_id, session_id, text, f"step_{index + 1}", now, now),
                        )
                finally:
                    cur.execute("DO RELEASE_LOCK(%s)", (f"goal:{session_id}",))

        goal = self.get_goal(goal_id)
        if goal is None:
            raise RuntimeError("created goal could not be reloaded")
        return goal

    def update_goal(
        self,
        *,
        session_id: str,
        goal_id: str,
        expected_goal_id: str,
        objective: str | None = None,
        ui_summary: str | None = None,
    ) -> GoalRecord:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                goal = self._require_mutable_goal(cur, session_id, goal_id, expected_goal_id)
                session_id = goal.session_id
                goal_id = goal.goal_id
                next_objective = goal.objective
                if objective is not None:
                    next_objective = normalize_required_text(objective, "goal objective")
                    reject_live_execution_objective(next_objective)
                next_summary = goal.ui_summary
                if ui_summary is not None:
                    next_summary = ui_summary.strip() or next_objective[:80]
                elif objective is not None and goal.ui_summary == goal.objective[:80]:
                    next_summary = next_objective[:80]
                now = _now_iso()
                cur.execute(
                    """
                    UPDATE goals
                    SET objective = %s, ui_summary = %s, updated_at = %s
                    WHERE goal_id = %s AND session_id = %s
                    """,
                    (next_objective, next_summary, now, goal_id, session_id),
                )
                if objective is not None:
                    cur.execute(
                        """
                        UPDATE goal_claims
                        SET text = %s, updated_at = %s
                        WHERE goal_id = %s AND session_id = %s
                            AND claim_type = 'thesis'
                            AND status = 'active'
                        """,
                        (next_objective, now, goal_id, session_id),
                    )

        updated = self.get_goal(goal_id)
        if updated is None:
            raise RuntimeError("updated goal could not be reloaded")
        return updated

    def get_goal(self, goal_id: str) -> GoalRecord | None:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM goals WHERE goal_id = %s",
                    (normalize_required_text(goal_id, "goal_id"),),
                )
                row = cur.fetchone()
        return self._goal_from_row(row) if row else None

    def get_current_goal(self, session_id: str) -> GoalRecord | None:
        session_id = normalize_required_text(session_id, "session_id")
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM goals
                    WHERE session_id = %s AND is_current = 1
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    (session_id,),
                )
                row = cur.fetchone()
        if not row or row["status"] not in {status.value for status in _CURRENT_STATUSES}:
            return None
        return self._goal_from_row(row)

    def list_criteria(self, goal_id: str) -> list[GoalCriterion]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM goal_criteria
                    WHERE goal_id = %s
                    ORDER BY
                        CASE
                            WHEN protocol_step REGEXP '^step_[0-9]+$'
                                THEN CAST(SUBSTRING(protocol_step, 6) AS UNSIGNED)
                            ELSE 2147483647
                        END,
                        created_at,
                        criterion_id
                    """,
                    (normalize_required_text(goal_id, "goal_id"),),
                )
                rows = cur.fetchall()
        return [self._criterion_from_row(row) for row in rows]

    def list_claims(self, goal_id: str) -> list[GoalClaim]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM goal_claims
                    WHERE goal_id = %s
                    ORDER BY created_at, claim_id
                    """,
                    (normalize_required_text(goal_id, "goal_id"),),
                )
                rows = cur.fetchall()
        return [self._claim_from_row(row) for row in rows]

    def list_evidence(self, goal_id: str, limit: int | None = None) -> list[EvidenceRecord]:
        goal_id = normalize_required_text(goal_id, "goal_id")
        if limit is not None and limit <= 0:
            raise ValueError("evidence limit must be positive")
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                if limit is not None:
                    cur.execute(
                        """
                        SELECT * FROM (
                            SELECT * FROM goal_evidence
                            WHERE goal_id = %s
                            ORDER BY created_at DESC, evidence_id DESC
                            LIMIT %s
                        ) AS recent
                        ORDER BY created_at, evidence_id
                        """,
                        (goal_id, int(limit)),
                    )
                else:
                    cur.execute(
                        """
                        SELECT * FROM goal_evidence
                        WHERE goal_id = %s
                        ORDER BY created_at, evidence_id
                        """,
                        (goal_id,),
                    )
                rows = cur.fetchall()
        return [self._evidence_from_row(row) for row in rows]

    def count_evidence(self, goal_id: str) -> int:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS count FROM goal_evidence WHERE goal_id = %s",
                    (normalize_required_text(goal_id, "goal_id"),),
                )
                row = cur.fetchone()
        return int(row["count"]) if row else 0

    def delete_session_goals(self, session_id: str) -> int:
        session_id = normalize_required_text(session_id, "session_id")
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS count FROM goals WHERE session_id = %s", (session_id,))
                row = cur.fetchone()
                count = int(row["count"]) if row else 0
                cur.execute("DELETE FROM goals WHERE session_id = %s", (session_id,))
        return count

    def get_current_snapshot(self, session_id: str) -> dict | None:
        goal = self.get_current_goal(session_id)
        if goal is None:
            return None
        return self.get_goal_snapshot(goal.goal_id)

    def get_goal_snapshot(self, goal_id: str, evidence_limit: int | None = 50) -> dict | None:
        goal = self.get_goal(goal_id)
        if goal is None:
            return None
        evidence = self.list_evidence(goal.goal_id, limit=evidence_limit)
        return {
            "goal": _to_json_dict(goal),
            "claims": [_to_json_dict(item) for item in self.list_claims(goal.goal_id)],
            "criteria": [_to_json_dict(item) for item in self.list_criteria(goal.goal_id)],
            "evidence": [_to_json_dict(item) for item in evidence],
            "evidence_count": self.count_evidence(goal.goal_id),
        }

    def append_evidence(
        self,
        *,
        session_id: str,
        goal_id: str,
        expected_goal_id: str,
        evidence: EvidenceInput,
    ) -> EvidenceRecord:
        evidence_id = _id("ev")
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                goal = self._require_mutable_goal(cur, session_id, goal_id, expected_goal_id)
                session_id = goal.session_id
                goal_id = goal.goal_id
                text = evidence.text.strip()
                if not text:
                    raise ValueError("evidence text cannot be empty")
                if evidence.criterion_id is not None:
                    self._require_criterion(cur, goal.goal_id, evidence.criterion_id)
                if evidence.claim_id is not None:
                    self._require_claim(cur, goal.goal_id, evidence.claim_id)

                now = _now_iso()
                freshness_status = "fresh" if evidence.data_as_of else "unknown"
                verification_status = self._verification_status(evidence)
                cur.execute(
                    """
                    INSERT INTO goal_evidence (
                        evidence_id, goal_id, session_id, criterion_id, claim_id,
                        evidence_type, text, tool_call_id, run_id, source_provider,
                        source_type, source_uri, symbol_universe_json, benchmark_json,
                        timeframe, method, assumptions_json, artifact_path,
                        artifact_hash, retrieved_at, data_as_of, freshness_status,
                        verification_status, confidence, caveat,
                        contradicts_claim_ids_json, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        evidence_id,
                        goal_id,
                        session_id,
                        evidence.criterion_id,
                        evidence.claim_id,
                        evidence.evidence_type,
                        text,
                        evidence.tool_call_id,
                        evidence.run_id,
                        evidence.source_provider,
                        evidence.source_type,
                        evidence.source_uri,
                        _json_dumps(evidence.symbol_universe),
                        _json_dumps(evidence.benchmark),
                        evidence.timeframe,
                        evidence.method,
                        _json_dumps(evidence.assumptions),
                        evidence.artifact_path,
                        evidence.artifact_hash,
                        now,
                        evidence.data_as_of,
                        freshness_status,
                        verification_status,
                        evidence.confidence,
                        evidence.caveat,
                        _json_dumps(evidence.contradicts_claim_ids),
                        now,
                    ),
                )
                if evidence.criterion_id is not None:
                    cur.execute(
                        """
                        UPDATE goal_criteria
                        SET status = 'covered', updated_at = %s
                        WHERE goal_id = %s AND session_id = %s AND criterion_id = %s
                            AND status IN ('pending', 'open', 'unsatisfied')
                        """,
                        (now, goal_id, session_id, evidence.criterion_id),
                    )

        record = self._get_evidence(evidence_id)
        if record is None:
            raise RuntimeError("created evidence could not be reloaded")
        return record

    def update_status(
        self,
        *,
        session_id: str,
        goal_id: str,
        expected_goal_id: str,
        status: GoalStatus,
        audit: list[AuditRow] | None = None,
        recap: str | None = None,
    ) -> GoalRecord:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                goal = self._require_mutable_goal(cur, session_id, goal_id, expected_goal_id)
                session_id = goal.session_id
                goal_id = goal.goal_id
                if status is GoalStatus.COMPLETE:
                    self._validate_completion_audit(cur, goal, audit or [])

                now = _now_iso()
                completed_at = now if status in {
                    GoalStatus.COMPLETE,
                    GoalStatus.BLOCKED,
                    GoalStatus.CANCELLED,
                    GoalStatus.SUPERSEDED,
                    GoalStatus.USAGE_LIMITED,
                } else None
                is_current = 1 if status in _CURRENT_STATUSES else 0
                cur.execute(
                    """
                    UPDATE goals
                    SET status = %s, updated_at = %s,
                        completed_at = COALESCE(%s, completed_at),
                        recap = COALESCE(%s, recap),
                        is_current = %s
                    WHERE goal_id = %s AND session_id = %s
                    """,
                    (status.value, now, completed_at, recap, is_current, goal_id, session_id),
                )
                if audit:
                    cur.execute(
                        """
                        INSERT INTO goal_audits (
                            audit_id, goal_id, session_id, audit_type, result,
                            rows_json, created_at
                        )
                        VALUES (%s, %s, %s, 'completion', %s, %s, %s)
                        """,
                        (_id("audit"), goal_id, session_id, status.value, _json_dumps([row.__dict__ for row in audit]), now),
                    )
                if audit and status is GoalStatus.COMPLETE:
                    for row in audit:
                        cur.execute(
                            """
                            UPDATE goal_criteria
                            SET status = %s, updated_at = %s
                            WHERE goal_id = %s AND session_id = %s AND criterion_id = %s
                            """,
                            (row.result, now, goal_id, session_id, row.criterion_id),
                        )

        updated = self.get_goal(goal_id)
        if updated is None:
            raise RuntimeError("updated goal could not be reloaded")
        return updated

    def account_usage(
        self,
        *,
        session_id: str,
        goal_id: str,
        expected_goal_id: str,
        token_delta: int = 0,
        time_delta_seconds: int = 0,
        turn_delta: int = 0,
    ) -> GoalRecord:
        if min(token_delta, time_delta_seconds, turn_delta) < 0:
            raise ValueError("usage deltas must be non-negative")

        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                goal = self._require_mutable_goal(cur, session_id, goal_id, expected_goal_id)
                session_id = goal.session_id
                goal_id = goal.goal_id
                tokens_used = goal.tokens_used + token_delta
                time_used_seconds = goal.time_used_seconds + time_delta_seconds
                turns_used = goal.turns_used + turn_delta
                crosses_budget = (
                    (goal.token_budget is not None and tokens_used >= goal.token_budget)
                    or (goal.time_budget_seconds is not None and time_used_seconds >= goal.time_budget_seconds)
                    or (goal.turn_budget is not None and turns_used >= goal.turn_budget)
                )
                next_status = GoalStatus.BUDGET_LIMITED if crosses_budget else goal.status
                now = _now_iso()
                cur.execute(
                    """
                    UPDATE goals
                    SET tokens_used = %s, time_used_seconds = %s, turns_used = %s,
                        status = %s, updated_at = %s, is_current = 1
                    WHERE goal_id = %s AND session_id = %s
                    """,
                    (tokens_used, time_used_seconds, turns_used, next_status.value, now, goal_id, session_id),
                )

        updated = self.get_goal(goal_id)
        if updated is None:
            raise RuntimeError("usage-updated goal could not be reloaded")
        return updated

    def _require_mutable_goal(
        self,
        cur: Any,
        session_id: str,
        goal_id: str,
        expected_goal_id: str,
    ) -> GoalRecord:
        if expected_goal_id != goal_id:
            raise StaleGoalError("expected_goal_id does not match target goal")
        session_id = normalize_required_text(session_id, "session_id")
        goal_id = normalize_required_text(goal_id, "goal_id")
        cur.execute("SELECT * FROM goals WHERE goal_id = %s FOR UPDATE", (goal_id,))
        row = cur.fetchone()
        goal = self._goal_from_row(row) if row else None
        if goal is None or goal.session_id != session_id:
            raise StaleGoalError("goal is not available for this session")
        if goal.status not in _CURRENT_STATUSES:
            raise StaleGoalError(f"goal status {goal.status.value!r} is not mutable")
        cur.execute(
            "SELECT * FROM goals WHERE session_id = %s AND is_current = 1 FOR UPDATE",
            (session_id,),
        )
        current_row = cur.fetchone()
        current = self._goal_from_row(current_row) if current_row else None
        if current is None or current.goal_id != goal_id:
            raise StaleGoalError("goal is not current for this session")
        return goal

    @staticmethod
    def _verification_status(evidence: EvidenceInput) -> str:
        if evidence.artifact_path:
            try:
                artifact = safe_document_path(evidence.artifact_path)
            except ValueError:
                artifact = None
            if artifact and artifact.is_file() and MySQLGoalStore._artifact_hash_matches(artifact, evidence.artifact_hash):
                return "verified"
        if evidence.run_id:
            try:
                run_dir = safe_run_id(evidence.run_id)
            except ValueError:
                run_dir = None
            if run_dir and run_dir.is_dir():
                return "verified"
        return "unverified"

    @staticmethod
    def _artifact_hash_matches(path: Path, expected_hash: str | None) -> bool:
        if not expected_hash:
            return False
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            return False
        return digest == expected_hash.lower().removeprefix("sha256:")

    def _require_criterion(self, cur: Any, goal_id: str, criterion_id: str) -> GoalCriterion:
        cur.execute(
            """
            SELECT * FROM goal_criteria
            WHERE goal_id = %s AND criterion_id = %s
            """,
            (goal_id, criterion_id),
        )
        row = cur.fetchone()
        if row is None:
            raise ValueError(f"unknown criterion_id: {criterion_id}")
        return self._criterion_from_row(row)

    def _require_claim(self, cur: Any, goal_id: str, claim_id: str) -> GoalClaim:
        cur.execute(
            """
            SELECT * FROM goal_claims
            WHERE goal_id = %s AND claim_id = %s
            """,
            (goal_id, claim_id),
        )
        row = cur.fetchone()
        if row is None:
            raise ValueError(f"unknown claim_id: {claim_id}")
        return self._claim_from_row(row)

    def _validate_completion_audit(self, cur: Any, goal: GoalRecord, audit: list[AuditRow]) -> None:
        cur.execute(
            """
            SELECT * FROM goal_criteria
            WHERE goal_id = %s
            ORDER BY created_at, criterion_id
            """,
            (goal.goal_id,),
        )
        criteria = [self._criterion_from_row(row) for row in cur.fetchall()]
        rows_by_criterion = {row.criterion_id: row for row in audit}
        for criterion in criteria:
            if not criterion.required:
                continue
            row = rows_by_criterion.get(criterion.criterion_id)
            if row is None:
                raise ValueError(f"missing audit row for criterion {criterion.criterion_id}")
            if row.result not in _COMPLETION_RESULTS:
                raise ValueError(f"criterion {criterion.criterion_id} is not satisfied")
            if row.result in {"satisfied", "satisfied_with_caveat"} and not row.evidence_ids:
                raise ValueError("complete goals require verified evidence")
            if row.result == "not_applicable_user_accepted" and not row.notes.strip():
                raise ValueError("not-applicable criteria require acceptance notes")
            has_verified_evidence = False
            for evidence_id in row.evidence_ids:
                evidence = self._get_evidence_with_cursor(cur, evidence_id)
                if evidence is None or evidence.goal_id != goal.goal_id:
                    raise ValueError(f"unknown evidence_id: {evidence_id}")
                if evidence.criterion_id != criterion.criterion_id:
                    raise ValueError(f"evidence {evidence_id} does not match criterion {criterion.criterion_id}")
                if evidence.verification_status == "verified":
                    has_verified_evidence = True
            if row.result in {"satisfied", "satisfied_with_caveat"} and not has_verified_evidence:
                raise ValueError("complete goals require verified evidence")

    def _get_evidence(self, evidence_id: str) -> EvidenceRecord | None:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                return self._get_evidence_with_cursor(cur, evidence_id)

    def _get_evidence_with_cursor(self, cur: Any, evidence_id: str) -> EvidenceRecord | None:
        cur.execute("SELECT * FROM goal_evidence WHERE evidence_id = %s", (evidence_id,))
        row = cur.fetchone()
        return self._evidence_from_row(row) if row else None

    @staticmethod
    def _goal_from_row(row: dict[str, Any]) -> GoalRecord:
        return GoalRecord(
            goal_id=row["goal_id"],
            session_id=row["session_id"],
            status=GoalStatus(row["status"]),
            objective=row["objective"],
            ui_summary=row["ui_summary"],
            source=row["source"],
            protocol=row["protocol"],
            risk_tier=RiskTier(row["risk_tier"]),
            token_budget=row["token_budget"],
            tokens_used=row["tokens_used"],
            turn_budget=row["turn_budget"],
            turns_used=row["turns_used"],
            time_budget_seconds=row["time_budget_seconds"],
            time_used_seconds=row["time_used_seconds"],
            budget_wrapup_sent=bool(row["budget_wrapup_sent"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            completed_at=row["completed_at"],
            recap=row["recap"],
        )

    @staticmethod
    def _criterion_from_row(row: dict[str, Any]) -> GoalCriterion:
        return GoalCriterion(
            criterion_id=row["criterion_id"],
            goal_id=row["goal_id"],
            session_id=row["session_id"],
            text=row["text"],
            required=bool(row["required"]),
            status=row["status"],
            freshness_requirement=row["freshness_requirement"],
            protocol_step=row["protocol_step"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _claim_from_row(row: dict[str, Any]) -> GoalClaim:
        return GoalClaim(
            claim_id=row["claim_id"],
            goal_id=row["goal_id"],
            session_id=row["session_id"],
            claim_type=row["claim_type"],
            text=row["text"],
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _evidence_from_row(row: dict[str, Any]) -> EvidenceRecord:
        return EvidenceRecord(
            evidence_id=row["evidence_id"],
            goal_id=row["goal_id"],
            session_id=row["session_id"],
            criterion_id=row["criterion_id"],
            claim_id=row["claim_id"],
            evidence_type=row["evidence_type"],
            text=row["text"],
            tool_call_id=row["tool_call_id"],
            run_id=row["run_id"],
            source_provider=row["source_provider"],
            source_type=row["source_type"],
            source_uri=row["source_uri"],
            symbol_universe=list(_json_loads(row["symbol_universe_json"], [])),
            benchmark=list(_json_loads(row["benchmark_json"], [])),
            timeframe=row["timeframe"],
            method=row["method"],
            assumptions=dict(_json_loads(row["assumptions_json"], {})),
            artifact_path=row["artifact_path"],
            artifact_hash=row["artifact_hash"],
            retrieved_at=row["retrieved_at"],
            data_as_of=row["data_as_of"],
            freshness_status=row["freshness_status"],
            verification_status=row["verification_status"],
            confidence=row["confidence"],
            caveat=row["caveat"],
            contradicts_claim_ids=list(_json_loads(row["contradicts_claim_ids_json"], [])),
            created_at=row["created_at"],
        )
