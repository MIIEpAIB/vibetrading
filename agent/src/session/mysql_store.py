"""MySQL-backed persistence for Session, Message, and Attempt records."""

from __future__ import annotations

import json
import logging
import threading
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator, List, Optional

from src.persistence.mysql import mysql_connection
from src.session.models import Attempt, Message, Session

logger = logging.getLogger(__name__)


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


def _row_text(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


class MySQLSessionStore:
    """MySQL-backed persistent storage matching the filesystem SessionStore API."""

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
                    CREATE TABLE IF NOT EXISTS sessions (
                        session_id VARCHAR(64) PRIMARY KEY,
                        title TEXT NOT NULL,
                        status VARCHAR(32) NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        last_attempt_id VARCHAR(64),
                        user_id BIGINT UNSIGNED NULL,
                        config_json JSON NOT NULL,
                        INDEX idx_sessions_updated_at (updated_at),
                        INDEX idx_sessions_user_updated (user_id, updated_at)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                self._ensure_column(cur, "sessions", "config_json", "JSON NULL")
                self._ensure_column(cur, "sessions", "user_id", "BIGINT UNSIGNED NULL")
                self._copy_column_if_present(cur, "sessions", "config", "config_json")
                self._ensure_index(cur, "sessions", "idx_sessions_user_updated", "user_id, updated_at")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS session_messages (
                        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        message_id VARCHAR(64) NOT NULL UNIQUE,
                        session_id VARCHAR(64) NOT NULL,
                        role VARCHAR(32) NOT NULL,
                        content MEDIUMTEXT NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        linked_attempt_id VARCHAR(64),
                        metadata_json JSON NOT NULL,
                        INDEX idx_messages_session_created (session_id, id),
                        CONSTRAINT fk_messages_session
                            FOREIGN KEY (session_id) REFERENCES sessions(session_id)
                            ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                self._ensure_message_order_column(cur)
                self._ensure_column(cur, "session_messages", "metadata_json", "JSON NULL")
                self._copy_column_if_present(cur, "session_messages", "metadata", "metadata_json")
                self._ensure_index(cur, "session_messages", "idx_messages_session_created", "session_id, id")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS session_attempts (
                        attempt_id VARCHAR(64) PRIMARY KEY,
                        session_id VARCHAR(64) NOT NULL,
                        parent_attempt_id VARCHAR(64),
                        status VARCHAR(32) NOT NULL,
                        prompt MEDIUMTEXT NOT NULL,
                        run_dir TEXT,
                        summary MEDIUMTEXT,
                        react_trace_json JSON NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        completed_at VARCHAR(64),
                        error MEDIUMTEXT,
                        metrics_json JSON,
                        INDEX idx_attempts_session_created (session_id, created_at),
                        CONSTRAINT fk_attempts_session
                            FOREIGN KEY (session_id) REFERENCES sessions(session_id)
                            ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                self._ensure_column(cur, "session_attempts", "react_trace_json", "JSON NULL")
                self._ensure_column(cur, "session_attempts", "metrics_json", "JSON NULL")
                self._copy_column_if_present(cur, "session_attempts", "react_trace", "react_trace_json")
                self._copy_column_if_present(cur, "session_attempts", "metrics", "metrics_json")

    # ---- Session CRUD ----

    def create_session(self, session: Session) -> Session:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO sessions (
                        session_id, title, status, created_at, updated_at,
                        last_attempt_id, user_id, config_json
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        session.session_id,
                        session.title,
                        session.status.value,
                        session.created_at,
                        session.updated_at,
                        session.last_attempt_id,
                        session.owner_user_id,
                        _json_dumps(session.config),
                    ),
                )
        return session

    def get_session(self, session_id: str) -> Optional[Session]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM sessions WHERE session_id = %s", (session_id,))
                row = cur.fetchone()
        return self._session_from_row(row) if row else None

    def update_session(self, session: Session) -> None:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE sessions
                    SET title = %s, status = %s, created_at = %s, updated_at = %s,
                        last_attempt_id = %s, config_json = %s, user_id = %s
                    WHERE session_id = %s
                    """,
                    (
                        session.title,
                        session.status.value,
                        session.created_at,
                        session.updated_at,
                        session.last_attempt_id,
                        _json_dumps(session.config),
                        session.owner_user_id,
                        session.session_id,
                    ),
                )

    def delete_session(self, session_id: str) -> bool:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM sessions WHERE session_id = %s", (session_id,))
                return cur.rowcount > 0

    def list_sessions(self, limit: int = 50) -> List[Session]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM sessions
                    ORDER BY updated_at DESC
                    LIMIT %s
                    """,
                    (int(limit),),
                )
                rows = cur.fetchall()
        return [self._session_from_row(row) for row in rows]

    def list_sessions_for_user(self, user_id: int, limit: int = 50) -> List[Session]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM sessions
                    WHERE user_id = %s
                    ORDER BY updated_at DESC
                    LIMIT %s
                    """,
                    (int(user_id), int(limit)),
                )
                rows = cur.fetchall()
        return [self._session_from_row(row) for row in rows]

    def session_belongs_to_user(self, session_id: str, user_id: int) -> bool:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM sessions WHERE session_id = %s AND user_id = %s LIMIT 1",
                    (session_id, int(user_id)),
                )
                return cur.fetchone() is not None

    # ---- Message Append-Only Log ----

    def append_message(self, message: Message) -> None:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO session_messages (
                        message_id, session_id, role, content, created_at,
                        linked_attempt_id, metadata_json
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        message.message_id,
                        message.session_id,
                        message.role,
                        message.content,
                        message.created_at,
                        message.linked_attempt_id,
                        _json_dumps(message.metadata),
                    ),
                )

    def get_messages(self, session_id: str, limit: int = 100) -> List[Message]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM (
                        SELECT * FROM session_messages
                        WHERE session_id = %s
                        ORDER BY id DESC
                        LIMIT %s
                    ) AS recent
                    ORDER BY id ASC
                    """,
                    (session_id, int(limit)),
                )
                rows = cur.fetchall()
        messages: list[Message] = []
        for row in rows:
            try:
                messages.append(self._message_from_row(row))
            except (TypeError, json.JSONDecodeError):
                logger.warning("Skipping corrupted MySQL message row in session %s", session_id)
        return messages

    # ---- Attempt CRUD ----

    def create_attempt(self, attempt: Attempt) -> Attempt:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO session_attempts (
                        attempt_id, session_id, parent_attempt_id, status, prompt,
                        run_dir, summary, react_trace_json, created_at,
                        completed_at, error, metrics_json
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        attempt.attempt_id,
                        attempt.session_id,
                        attempt.parent_attempt_id,
                        attempt.status.value,
                        attempt.prompt,
                        attempt.run_dir,
                        attempt.summary,
                        _json_dumps(attempt.react_trace),
                        attempt.created_at,
                        attempt.completed_at,
                        attempt.error,
                        _json_dumps(attempt.metrics) if attempt.metrics is not None else None,
                    ),
                )
        return attempt

    def get_attempt(self, session_id: str, attempt_id: str) -> Optional[Attempt]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM session_attempts WHERE session_id = %s AND attempt_id = %s",
                    (session_id, attempt_id),
                )
                row = cur.fetchone()
        return self._attempt_from_row(row) if row else None

    def update_attempt(self, attempt: Attempt) -> None:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE session_attempts
                    SET parent_attempt_id = %s, status = %s, prompt = %s,
                        run_dir = %s, summary = %s, react_trace_json = %s,
                        created_at = %s, completed_at = %s, error = %s,
                        metrics_json = %s
                    WHERE session_id = %s AND attempt_id = %s
                    """,
                    (
                        attempt.parent_attempt_id,
                        attempt.status.value,
                        attempt.prompt,
                        attempt.run_dir,
                        attempt.summary,
                        _json_dumps(attempt.react_trace),
                        attempt.created_at,
                        attempt.completed_at,
                        attempt.error,
                        _json_dumps(attempt.metrics) if attempt.metrics is not None else None,
                        attempt.session_id,
                        attempt.attempt_id,
                    ),
                )

    @staticmethod
    def _ensure_column(cur: Any, table: str, column: str, definition: str) -> None:
        if MySQLSessionStore._column_exists(cur, table, column):
            return
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    @staticmethod
    def _column_exists(cur: Any, table: str, column: str) -> bool:
        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = %s
              AND COLUMN_NAME = %s
            """,
            (table, column),
        )
        row = cur.fetchone() or {}
        return int(row.get("count") or 0) > 0

    @staticmethod
    def _copy_column_if_present(cur: Any, table: str, source: str, target: str) -> None:
        if not MySQLSessionStore._column_exists(cur, table, source):
            return
        if not MySQLSessionStore._column_exists(cur, table, target):
            return
        cur.execute(
            f"""
            UPDATE {table}
            SET {target} = {source}
            WHERE {target} IS NULL
              AND {source} IS NOT NULL
            """
        )

    @staticmethod
    def _ensure_message_order_column(cur: Any) -> None:
        if MySQLSessionStore._column_exists(cur, "session_messages", "id"):
            return
        cur.execute(
            """
            ALTER TABLE session_messages
            ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST
            """
        )

    @staticmethod
    def _ensure_index(cur: Any, table: str, index_name: str, columns: str) -> None:
        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = %s
              AND INDEX_NAME = %s
            """,
            (table, index_name),
        )
        row = cur.fetchone() or {}
        if int(row.get("count") or 0) == 0:
            cur.execute(f"CREATE INDEX {index_name} ON {table} ({columns})")

    @staticmethod
    def _session_from_row(row: dict[str, Any]) -> Session:
        config = dict(_json_loads(row.get("config_json"), {}))
        if row.get("user_id") is not None and config.get("user_id") is None:
            config["user_id"] = int(row["user_id"])
        return Session.from_dict(
            {
                "session_id": row["session_id"],
                "title": row["title"],
                "status": row["status"],
                "created_at": _row_text(row["created_at"]),
                "updated_at": _row_text(row["updated_at"]),
                "last_attempt_id": row["last_attempt_id"],
                "config": config,
            }
        )

    @staticmethod
    def _message_from_row(row: dict[str, Any]) -> Message:
        return Message.from_dict(
            {
                "message_id": row["message_id"],
                "session_id": row["session_id"],
                "role": row["role"],
                "content": row["content"],
                "created_at": _row_text(row["created_at"]),
                "linked_attempt_id": row["linked_attempt_id"],
                "metadata": dict(_json_loads(row.get("metadata_json"), {})),
            }
        )

    @staticmethod
    def _attempt_from_row(row: dict[str, Any]) -> Attempt:
        return Attempt.from_dict(
            {
                "attempt_id": row["attempt_id"],
                "session_id": row["session_id"],
                "parent_attempt_id": row["parent_attempt_id"],
                "status": row["status"],
                "prompt": row["prompt"],
                "run_dir": row["run_dir"],
                "summary": row["summary"],
                "react_trace": list(_json_loads(row.get("react_trace_json"), [])),
                "created_at": _row_text(row["created_at"]) or datetime.now().isoformat(),
                "completed_at": _row_text(row["completed_at"]) if row["completed_at"] else None,
                "error": row["error"],
                "metrics": (
                    dict(_json_loads(row.get("metrics_json"), {}))
                    if row.get("metrics_json") is not None
                    else None
                ),
            }
        )
