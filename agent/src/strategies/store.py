"""MySQL persistence for the personal strategy library."""

from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterator

from src.persistence.mysql import mysql_connection

VALID_LANGUAGES = {"python", "pine", "javascript"}
VALID_STATUSES = {"draft", "testing", "live", "archived"}
VALID_CATEGORIES = {"trend", "mean_reversion", "grid", "risk", "portfolio", "arbitrage", "utility"}


def _now_iso() -> str:
    return datetime.now().isoformat()


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


@dataclass(frozen=True)
class StrategyRecord:
    """Persisted personal strategy record."""

    id: str
    name: str
    description: str
    language: str
    category: str
    status: str
    tags: list[str]
    code: str
    createdAt: str
    updatedAt: str

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "StrategyRecord":
        now = _now_iso()
        strategy_id = str(payload.get("id") or "").strip()
        if not strategy_id:
            raise ValueError("strategy id is required")
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValueError("strategy name is required")
        code = str(payload.get("code") or "")
        if not code.strip():
            raise ValueError("strategy code is required")
        language = str(payload.get("language") or "python").strip()
        status = str(payload.get("status") or "draft").strip()
        category = str(payload.get("category") or "trend").strip()
        if language not in VALID_LANGUAGES:
            raise ValueError(f"invalid strategy language: {language}")
        if status not in VALID_STATUSES:
            raise ValueError(f"invalid strategy status: {status}")
        if category not in VALID_CATEGORIES:
            raise ValueError(f"invalid strategy category: {category}")
        raw_tags = payload.get("tags")
        tags = raw_tags if isinstance(raw_tags, list) else []
        clean_tags = [str(tag).strip() for tag in tags if str(tag).strip()][:8]
        created_at = str(payload.get("createdAt") or payload.get("created_at") or now)
        updated_at = str(payload.get("updatedAt") or payload.get("updated_at") or now)
        return cls(
            id=strategy_id,
            name=name,
            description=str(payload.get("description") or ""),
            language=language,
            category=category,
            status=status,
            tags=clean_tags,
            code=code,
            createdAt=created_at,
            updatedAt=updated_at,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "language": self.language,
            "category": self.category,
            "status": self.status,
            "tags": list(self.tags),
            "code": self.code,
            "createdAt": self.createdAt,
            "updatedAt": self.updatedAt,
        }


class MySQLStrategyStore:
    """MySQL-backed personal strategy library."""

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
                    CREATE TABLE IF NOT EXISTS strategy_library (
                        id VARCHAR(128) PRIMARY KEY,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL,
                        language VARCHAR(32) NOT NULL,
                        category VARCHAR(64) NOT NULL,
                        status VARCHAR(32) NOT NULL,
                        tags_json JSON NOT NULL,
                        code MEDIUMTEXT NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        INDEX idx_strategy_updated_at (updated_at),
                        INDEX idx_strategy_status (status),
                        INDEX idx_strategy_category (category)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )

    def list_strategies(self) -> list[StrategyRecord]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM strategy_library
                    ORDER BY updated_at DESC, id
                    """
                )
                rows = cur.fetchall()
        return [self._from_row(row) for row in rows]

    def replace_all(self, strategies: list[StrategyRecord]) -> list[StrategyRecord]:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM strategy_library")
                for strategy in strategies:
                    self._upsert_with_cursor(cur, strategy)
        return strategies

    def upsert_strategy(self, strategy: StrategyRecord) -> StrategyRecord:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                self._upsert_with_cursor(cur, strategy)
        return strategy

    def delete_strategy(self, strategy_id: str) -> bool:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM strategy_library WHERE id = %s", (strategy_id,))
                return cur.rowcount > 0

    @staticmethod
    def _upsert_with_cursor(cur: Any, strategy: StrategyRecord) -> None:
        cur.execute(
            """
            INSERT INTO strategy_library (
                id, name, description, language, category, status, tags_json,
                code, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                description = VALUES(description),
                language = VALUES(language),
                category = VALUES(category),
                status = VALUES(status),
                tags_json = VALUES(tags_json),
                code = VALUES(code),
                created_at = VALUES(created_at),
                updated_at = VALUES(updated_at)
            """,
            (
                strategy.id,
                strategy.name,
                strategy.description,
                strategy.language,
                strategy.category,
                strategy.status,
                _json_dumps(strategy.tags),
                strategy.code,
                strategy.createdAt,
                strategy.updatedAt,
            ),
        )

    @staticmethod
    def _from_row(row: dict[str, Any]) -> StrategyRecord:
        return StrategyRecord(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            language=row["language"],
            category=row["category"],
            status=row["status"],
            tags=list(_json_loads(row["tags_json"], [])),
            code=row["code"],
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
        )
