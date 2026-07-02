"""MySQL persistence for the personal strategy library."""

from __future__ import annotations

import json
import logging
import hashlib
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterator

from src.persistence.mysql import mysql_connection

VALID_LANGUAGES = {"javascript", "python", "cpp", "rust", "pine"}
VALID_STATUSES = {"draft", "testing", "live", "archived"}
VALID_CATEGORIES = {"trend", "mean_reversion", "grid", "risk", "portfolio", "arbitrage", "utility"}
logger = logging.getLogger(__name__)


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


def _row_text(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


def _normalize_language(value: Any) -> str:
    language = str(value or "python").strip()
    if language == "json":
        return "javascript"
    return language


@dataclass(frozen=True)
class StrategyRecord:
    """Persisted personal strategy record."""

    id: str
    name: str
    description: str
    strategyDescription: str
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
        language = _normalize_language(payload.get("language"))
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
            strategyDescription=str(payload.get("strategyDescription") or payload.get("strategy_description") or ""),
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
            "strategyDescription": self.strategyDescription,
            "language": self.language,
            "category": self.category,
            "status": self.status,
            "tags": list(self.tags),
            "code": self.code,
            "createdAt": self.createdAt,
            "updatedAt": self.updatedAt,
        }


@dataclass(frozen=True)
class PublicStrategyRecord:
    """Published immutable snapshot shown in the public strategy market."""

    publicId: str
    ownerUserId: int
    sourceStrategyId: str
    name: str
    summary: str
    description: str
    strategyDescription: str
    language: str
    category: str
    tags: list[str]
    codeSnapshot: str
    reviewStatus: str
    publishedAt: str
    updatedAt: str
    backtestSummary: dict[str, Any]
    riskWarnings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "publicId": self.publicId,
            "ownerUserId": self.ownerUserId,
            "sourceStrategyId": self.sourceStrategyId,
            "name": self.name,
            "summary": self.summary,
            "description": self.description,
            "strategyDescription": self.strategyDescription,
            "language": self.language,
            "category": self.category,
            "tags": list(self.tags),
            "codeSnapshot": self.codeSnapshot,
            "reviewStatus": self.reviewStatus,
            "publishedAt": self.publishedAt,
            "updatedAt": self.updatedAt,
            "backtestSummary": dict(self.backtestSummary),
            "riskWarnings": list(self.riskWarnings),
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
                        id VARCHAR(128) NOT NULL,
                        user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL,
                        strategy_description MEDIUMTEXT NOT NULL,
                        language VARCHAR(32) NOT NULL,
                        category VARCHAR(64) NOT NULL,
                        status VARCHAR(32) NOT NULL,
                        tags_json JSON NOT NULL,
                        code MEDIUMTEXT NOT NULL,
                        created_at VARCHAR(64) NOT NULL,
                        updated_at VARCHAR(64) NOT NULL,
                        PRIMARY KEY (user_id, id),
                        INDEX idx_strategy_user_updated (user_id, updated_at),
                        INDEX idx_strategy_updated_at (updated_at),
                        INDEX idx_strategy_status (status),
                        INDEX idx_strategy_category (category)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                self._migrate_legacy_columns(cur)
                self._ensure_column(cur, "strategy_library", "user_id", "BIGINT UNSIGNED NOT NULL DEFAULT 0")
                self._ensure_column(cur, "strategy_library", "strategy_description", "MEDIUMTEXT NULL")
                self._ensure_timestamp_text_columns(cur)
                cur.execute("UPDATE strategy_library SET strategy_description = '' WHERE strategy_description IS NULL")
                cur.execute("UPDATE strategy_library SET user_id = 0 WHERE user_id IS NULL")
                cur.execute("ALTER TABLE strategy_library MODIFY COLUMN user_id BIGINT UNSIGNED NOT NULL DEFAULT 0")
                self._ensure_index(cur, "strategy_library", "idx_strategy_user_updated", "user_id, updated_at")
                self._ensure_composite_primary_key(cur)
                self._init_public_strategy_marketplace(cur)

    def list_strategies(self, user_id: int | None = None) -> list[StrategyRecord]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                if user_id is None:
                    cur.execute(
                        """
                        SELECT * FROM strategy_library
                        ORDER BY updated_at DESC, id
                        """
                    )
                else:
                    cur.execute(
                        """
                        SELECT * FROM strategy_library
                        WHERE user_id = %s
                        ORDER BY updated_at DESC, id
                        """,
                        (self._scope_user_id(user_id),),
                    )
                rows = cur.fetchall()
        return [self._from_row(row) for row in rows]

    def replace_all(self, strategies: list[StrategyRecord], user_id: int | None = None) -> list[StrategyRecord]:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                if user_id is None:
                    cur.execute("DELETE FROM strategy_library")
                else:
                    cur.execute("DELETE FROM strategy_library WHERE user_id = %s", (self._scope_user_id(user_id),))
                for strategy in strategies:
                    self._upsert_with_cursor(cur, strategy, user_id=user_id)
        return strategies

    def upsert_strategy(self, strategy: StrategyRecord, user_id: int | None = None) -> StrategyRecord:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                self._upsert_with_cursor(cur, strategy, user_id=user_id)
        return strategy

    def delete_strategy(self, strategy_id: str, user_id: int | None = None) -> bool:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                if user_id is None:
                    cur.execute("DELETE FROM strategy_library WHERE id = %s", (strategy_id,))
                else:
                    cur.execute(
                        "DELETE FROM strategy_library WHERE id = %s AND user_id = %s",
                        (strategy_id, self._scope_user_id(user_id)),
                    )
                return cur.rowcount > 0

    def list_public_strategies(self, *, review_status: str = "published") -> list[PublicStrategyRecord]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM public_strategy_marketplace
                    WHERE review_status = %s
                    ORDER BY published_at DESC, public_id
                    """,
                    (review_status,),
                )
                rows = cur.fetchall()
        return [self._public_from_row(row) for row in rows]

    def list_all_public_strategies(self) -> list[PublicStrategyRecord]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM public_strategy_marketplace
                    ORDER BY updated_at DESC, public_id
                    """
                )
                rows = cur.fetchall()
        return [self._public_from_row(row) for row in rows]

    def list_share_statuses(self, *, user_id: int) -> dict[str, str]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT source_strategy_id, review_status
                    FROM public_strategy_marketplace
                    WHERE owner_user_id = %s
                    """,
                    (self._scope_user_id(user_id),),
                )
                rows = cur.fetchall()
        return {str(row["source_strategy_id"]): str(row["review_status"]) for row in rows}

    def update_public_strategy_review_status(self, public_id: str, review_status: str) -> PublicStrategyRecord | None:
        now = _now_iso()
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public_strategy_marketplace
                    SET review_status = %s,
                        published_at = CASE WHEN %s = 'published' THEN %s ELSE published_at END,
                        updated_at = %s
                    WHERE public_id = %s
                    """,
                    (review_status, review_status, now, now, public_id),
                )
                if cur.rowcount == 0:
                    return None
                cur.execute("SELECT * FROM public_strategy_marketplace WHERE public_id = %s", (public_id,))
                row = cur.fetchone()
        return self._public_from_row(row) if row else None

    def publish_strategy(
        self,
        strategy: StrategyRecord,
        *,
        user_id: int,
        backtest_summary: dict[str, Any] | None = None,
        risk_warnings: list[str] | None = None,
    ) -> PublicStrategyRecord:
        now = _now_iso()
        record = PublicStrategyRecord(
            publicId=self._public_id(user_id, strategy.id),
            ownerUserId=self._scope_user_id(user_id),
            sourceStrategyId=strategy.id,
            name=strategy.name,
            summary=strategy.description or strategy.name,
            description=strategy.description,
            strategyDescription=strategy.strategyDescription,
            language=strategy.language,
            category=strategy.category,
            tags=list(dict.fromkeys([*strategy.tags, "community"]))[:8],
            codeSnapshot=strategy.code,
            reviewStatus="submitted",
            publishedAt=now,
            updatedAt=now,
            backtestSummary=backtest_summary or {},
            riskWarnings=risk_warnings or [],
        )
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public_strategy_marketplace (
                        public_id, owner_user_id, source_strategy_id, name, summary,
                        description, strategy_description, language, category, tags_json,
                        code_snapshot, review_status, published_at, updated_at,
                        backtest_summary_json, risk_warnings_json
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        name = VALUES(name),
                        summary = VALUES(summary),
                        description = VALUES(description),
                        strategy_description = VALUES(strategy_description),
                        language = VALUES(language),
                        category = VALUES(category),
                        tags_json = VALUES(tags_json),
                        code_snapshot = VALUES(code_snapshot),
                        review_status = VALUES(review_status),
                        updated_at = VALUES(updated_at),
                        backtest_summary_json = VALUES(backtest_summary_json),
                        risk_warnings_json = VALUES(risk_warnings_json)
                    """,
                    (
                        record.publicId,
                        record.ownerUserId,
                        record.sourceStrategyId,
                        record.name,
                        record.summary,
                        record.description,
                        record.strategyDescription,
                        record.language,
                        record.category,
                        _json_dumps(record.tags),
                        record.codeSnapshot,
                        record.reviewStatus,
                        record.publishedAt,
                        record.updatedAt,
                        _json_dumps(record.backtestSummary),
                        _json_dumps(record.riskWarnings),
                    ),
                )
        return record

    @staticmethod
    def _upsert_with_cursor(cur: Any, strategy: StrategyRecord, user_id: int | None = None) -> None:
        cur.execute(
            """
            INSERT INTO strategy_library (
                id, user_id, name, description, language, category, status, tags_json,
                code, created_at, updated_at, strategy_description
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                name = VALUES(name),
                description = VALUES(description),
                strategy_description = VALUES(strategy_description),
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
                MySQLStrategyStore._scope_user_id(user_id),
                strategy.name,
                strategy.description,
                strategy.language,
                strategy.category,
                strategy.status,
                _json_dumps(strategy.tags),
                strategy.code,
                strategy.createdAt,
                strategy.updatedAt,
                strategy.strategyDescription,
            ),
        )

    @staticmethod
    def _ensure_column(cur: Any, table: str, column: str, definition: str) -> None:
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
        if int(row.get("count") or 0) == 0:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

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
    def _migrate_legacy_columns(cur: Any) -> None:
        """Bring deploy/mysql_schema-era table names in line with this store."""
        has_id = MySQLStrategyStore._column_exists(cur, "strategy_library", "id")
        has_strategy_id = MySQLStrategyStore._column_exists(cur, "strategy_library", "strategy_id")
        if not has_id and has_strategy_id:
            cur.execute("ALTER TABLE strategy_library CHANGE COLUMN strategy_id id VARCHAR(128) NOT NULL")

        has_tags_json = MySQLStrategyStore._column_exists(cur, "strategy_library", "tags_json")
        has_tags = MySQLStrategyStore._column_exists(cur, "strategy_library", "tags")
        if not has_tags_json and has_tags:
            cur.execute("ALTER TABLE strategy_library CHANGE COLUMN tags tags_json JSON NOT NULL")

    @staticmethod
    def _column_type(cur: Any, table: str, column: str) -> str:
        cur.execute(
            """
            SELECT DATA_TYPE AS data_type
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = %s
              AND COLUMN_NAME = %s
            """,
            (table, column),
        )
        row = cur.fetchone() or {}
        return str(row.get("data_type") or row.get("DATA_TYPE") or "").lower()

    @staticmethod
    def _ensure_timestamp_text_columns(cur: Any) -> None:
        """Normalize legacy DATETIME timestamps to API string fields."""
        for column in ("created_at", "updated_at"):
            data_type = MySQLStrategyStore._column_type(cur, "strategy_library", column)
            if data_type and data_type != "varchar":
                cur.execute(f"ALTER TABLE strategy_library MODIFY COLUMN {column} VARCHAR(64) NOT NULL")

    @staticmethod
    def _has_inbound_foreign_keys(cur: Any, table: str) -> bool:
        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND REFERENCED_TABLE_NAME = %s
            """,
            (table,),
        )
        row = cur.fetchone() or {}
        return int(row.get("count") or 0) > 0

    @staticmethod
    def _ensure_composite_primary_key(cur: Any) -> None:
        cur.execute(
            """
            SELECT COLUMN_NAME AS column_name
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'strategy_library'
              AND CONSTRAINT_NAME = 'PRIMARY'
            ORDER BY ORDINAL_POSITION
            """
        )
        rows = cur.fetchall() or []
        columns = [str(row.get("column_name") or row.get("COLUMN_NAME")) for row in rows]
        if columns == ["user_id", "id"] or set(columns) == {"user_id", "id"}:
            return
        if columns == ["id"] and MySQLStrategyStore._has_inbound_foreign_keys(cur, "strategy_library"):
            logger.warning(
                "Leaving legacy strategy_library primary key on id because inbound foreign keys reference it"
            )
            return
        if columns:
            cur.execute("ALTER TABLE strategy_library DROP PRIMARY KEY")
        cur.execute("ALTER TABLE strategy_library ADD PRIMARY KEY (user_id, id)")

    @staticmethod
    def _init_public_strategy_marketplace(cur: Any) -> None:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS public_strategy_marketplace (
                public_id VARCHAR(128) NOT NULL,
                owner_user_id BIGINT UNSIGNED NOT NULL,
                source_strategy_id VARCHAR(128) NOT NULL,
                name TEXT NOT NULL,
                summary TEXT NOT NULL,
                description TEXT NOT NULL,
                strategy_description MEDIUMTEXT NOT NULL,
                language VARCHAR(32) NOT NULL,
                category VARCHAR(64) NOT NULL,
                tags_json JSON NOT NULL,
                code_snapshot MEDIUMTEXT NOT NULL,
                review_status VARCHAR(32) NOT NULL,
                published_at VARCHAR(64) NOT NULL,
                updated_at VARCHAR(64) NOT NULL,
                backtest_summary_json JSON NOT NULL,
                risk_warnings_json JSON NOT NULL,
                PRIMARY KEY (public_id),
                INDEX idx_public_strategy_published (review_status, published_at),
                INDEX idx_public_strategy_owner (owner_user_id, updated_at),
                INDEX idx_public_strategy_source (owner_user_id, source_strategy_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """
        )

    @staticmethod
    def _scope_user_id(user_id: int | None) -> int:
        return int(user_id) if user_id is not None else 0

    @staticmethod
    def _public_id(user_id: int, strategy_id: str) -> str:
        digest = hashlib.sha1(f"{user_id}:{strategy_id}".encode("utf-8")).hexdigest()[:16]
        return f"pub_{digest}"

    @staticmethod
    def _from_row(row: dict[str, Any]) -> StrategyRecord:
        return StrategyRecord(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            strategyDescription=row.get("strategy_description") or "",
            language=_normalize_language(row["language"]),
            category=row["category"],
            status=row["status"],
            tags=list(_json_loads(row["tags_json"], [])),
            code=row["code"],
            createdAt=_row_text(row["created_at"]),
            updatedAt=_row_text(row["updated_at"]),
        )

    @staticmethod
    def _public_from_row(row: dict[str, Any]) -> PublicStrategyRecord:
        return PublicStrategyRecord(
            publicId=row["public_id"],
            ownerUserId=int(row["owner_user_id"]),
            sourceStrategyId=row["source_strategy_id"],
            name=row["name"],
            summary=row.get("summary") or row.get("description") or row["name"],
            description=row.get("description") or "",
            strategyDescription=row.get("strategy_description") or "",
            language=_normalize_language(row["language"]),
            category=row["category"],
            tags=list(_json_loads(row["tags_json"], [])),
            codeSnapshot=row["code_snapshot"],
            reviewStatus=row["review_status"],
            publishedAt=_row_text(row["published_at"]),
            updatedAt=_row_text(row["updated_at"]),
            backtestSummary=dict(_json_loads(row.get("backtest_summary_json"), {})),
            riskWarnings=list(_json_loads(row.get("risk_warnings_json"), [])),
        )
