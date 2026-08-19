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
VALID_CATALOG_KINDS = {"built-in", "paid", "community", "personal"}
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
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        logger.warning("Invalid strategy JSON payload; falling back to default")
        return default


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
                self._init_strategy_catalog(cur)
                self._init_strategy_versions(cur)

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
                    cur.execute("DELETE FROM strategy_catalog WHERE kind = 'personal'")
                    cur.execute("DELETE FROM strategy_versions WHERE owner_user_id = 0")
                else:
                    scoped_user_id = self._scope_user_id(user_id)
                    cur.execute("DELETE FROM strategy_library WHERE user_id = %s", (scoped_user_id,))
                    cur.execute(
                        "DELETE FROM strategy_catalog WHERE kind = 'personal' AND owner_user_id = %s",
                        (scoped_user_id,),
                    )
                    cur.execute("DELETE FROM strategy_versions WHERE owner_user_id = %s", (scoped_user_id,))
                for strategy in strategies:
                    self._upsert_with_cursor(cur, strategy, user_id=user_id)
        return strategies

    def upsert_strategy(self, strategy: StrategyRecord, user_id: int | None = None) -> StrategyRecord:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                self._upsert_with_cursor(cur, strategy, user_id=user_id)
        return strategy

    def list_strategy_versions(self, strategy_id: str, user_id: int | None = None) -> list[dict[str, Any]]:
        owner_user_id = self._scope_user_id(user_id)
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT version_no, strategy_id, owner_user_id, name, description,
                           strategy_description, language, category, tags_json, code,
                           code_sha256, created_at
                    FROM strategy_versions
                    WHERE strategy_id = %s AND owner_user_id = %s
                    ORDER BY version_no DESC
                    """,
                    (strategy_id, owner_user_id),
                )
                rows = cur.fetchall()
        return [
            {
                "version": int(row["version_no"]),
                "strategy_id": row["strategy_id"],
                "owner_user_id": int(row["owner_user_id"]),
                "name": row["name"],
                "description": row["description"],
                "strategyDescription": row["strategy_description"],
                "language": row["language"],
                "category": row["category"],
                "tags": list(_json_loads(row["tags_json"], [])),
                "code": row["code"],
                "code_sha256": row["code_sha256"],
                "createdAt": _row_text(row["created_at"]),
            }
            for row in rows
        ]

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
                deleted = cur.rowcount > 0
                if user_id is None:
                    catalog_id = f"personal:0:{strategy_id}"
                    cur.execute("DELETE FROM strategy_catalog WHERE strategy_id = %s", (catalog_id,))
                    cur.execute(
                        "DELETE FROM strategy_versions WHERE strategy_id = %s AND owner_user_id = 0",
                        (strategy_id,),
                    )
                else:
                    catalog_id = f"personal:{self._scope_user_id(user_id)}:{strategy_id}"
                    cur.execute(
                        """
                        DELETE FROM strategy_catalog
                        WHERE strategy_id = %s AND owner_user_id = %s AND kind = 'personal'
                        """,
                        (catalog_id, self._scope_user_id(user_id)),
                    )
                    cur.execute(
                        "DELETE FROM strategy_versions WHERE strategy_id = %s AND owner_user_id = %s",
                        (strategy_id, self._scope_user_id(user_id)),
                    )
                return deleted

    def list_strategy_catalog(self, *, kinds: set[str] | None = None) -> list[dict[str, Any]]:
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                if kinds:
                    placeholders = ", ".join(["%s"] * len(kinds))
                    cur.execute(
                        f"""
                        SELECT * FROM strategy_catalog
                        WHERE kind IN ({placeholders}) AND deleted = 0
                        ORDER BY kind, updated_at DESC, strategy_id
                        """,
                        tuple(sorted(kinds)),
                    )
                else:
                    cur.execute(
                        """
                        SELECT * FROM strategy_catalog
                        WHERE deleted = 0
                        ORDER BY kind, updated_at DESC, strategy_id
                        """
                    )
                rows = cur.fetchall()
        return [self._catalog_from_row(row) for row in rows]

    def replace_strategy_catalog(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Replace non-personal catalog records while preserving user strategies."""
        allowed_kinds = {"built-in", "paid", "community"}
        normalized = [self._normalize_catalog_item(item) for item in items]
        normalized = [item for item in normalized if item["kind"] in allowed_kinds]
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM strategy_catalog WHERE kind IN ('built-in', 'paid', 'community')"
                )
                for item in normalized:
                    self._upsert_catalog_with_cursor(cur, item)
        return self.list_strategy_catalog(kinds=allowed_kinds)

    def upsert_strategy_catalog(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized = [self._normalize_catalog_item(item) for item in items]
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                for item in normalized:
                    self._upsert_catalog_with_cursor(cur, item)
        return self.list_strategy_catalog(kinds={"built-in", "paid", "community"})

    def ensure_strategy_catalog(self, items: list[dict[str, Any]]) -> None:
        """Seed platform records without overwriting operator edits."""
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                for item in items:
                    normalized = self._normalize_catalog_item(item)
                    cur.execute(
                        """
                        SELECT strategy_id FROM strategy_catalog WHERE strategy_id = %s
                        """,
                        (normalized["strategy_id"],),
                    )
                    if cur.fetchone():
                        # Existing platform rows may have been created before the
                        # source code and detail fields were added. Backfill only
                        # empty fields so operator edits remain authoritative.
                        cur.execute(
                            """
                            UPDATE strategy_catalog
                            SET description = CASE
                                    WHEN TRIM(description) = '' THEN %s ELSE description
                                END,
                                strategy_description = CASE
                                    WHEN TRIM(strategy_description) = '' THEN %s ELSE strategy_description
                                END,
                                language = CASE
                                    WHEN TRIM(language) = '' THEN %s ELSE language
                                END,
                                category = CASE
                                    WHEN TRIM(category) = '' OR category = 'utility' THEN %s ELSE category
                                END,
                                code_snapshot = CASE
                                    WHEN TRIM(code_snapshot) = '' THEN %s ELSE code_snapshot
                                END,
                                tags_json = CASE
                                    WHEN JSON_LENGTH(tags_json) = 0 THEN %s ELSE tags_json
                                END,
                                risk_warnings_json = CASE
                                    WHEN JSON_LENGTH(risk_warnings_json) = 0 THEN %s ELSE risk_warnings_json
                                END
                            WHERE strategy_id = %s
                              AND kind IN ('built-in', 'paid')
                            """,
                            (
                                normalized["description"],
                                normalized["strategy_description"],
                                normalized["language"],
                                normalized["category"],
                                normalized["code_snapshot"],
                                _json_dumps(normalized["tags"]),
                                _json_dumps(normalized["risk_warnings"]),
                                normalized["strategy_id"],
                            ),
                        )
                        MySQLStrategyStore._record_strategy_version_with_cursor(cur, normalized)
                        continue
                    self._upsert_catalog_with_cursor(cur, normalized)

    def delete_catalog_strategy(self, strategy_id: str) -> bool:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT kind FROM strategy_catalog WHERE strategy_id = %s",
                    (strategy_id,),
                )
                row = cur.fetchone()
                if not row:
                    return False
                if row.get("kind") in {"built-in", "paid"}:
                    cur.execute(
                        """
                        UPDATE strategy_catalog
                        SET enabled = 0, status = 'archived', deleted = 1, updated_at = %s
                        WHERE strategy_id = %s
                        """,
                        (_now_iso(), strategy_id),
                    )
                else:
                    cur.execute("DELETE FROM strategy_catalog WHERE strategy_id = %s", (strategy_id,))
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

    def delete_public_strategy(self, public_id: str) -> bool:
        """Permanently remove a published community strategy snapshot."""
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM public_strategy_marketplace WHERE public_id = %s",
                    (public_id,),
                )
                return cur.rowcount > 0

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
                self._upsert_catalog_with_cursor(
                    cur,
                    self._normalize_catalog_item(
                        {
                            "strategy_id": record.publicId,
                            "kind": "community",
                            "owner_user_id": record.ownerUserId,
                            "source_strategy_id": record.sourceStrategyId,
                            "name": record.name,
                            "summary": record.summary,
                            "description": record.description,
                            "strategy_description": record.strategyDescription,
                            "language": record.language,
                            "category": record.category,
                            "tags": record.tags,
                            "code_snapshot": record.codeSnapshot,
                            "status": record.reviewStatus,
                            "published_at": record.publishedAt,
                            "updated_at": record.updatedAt,
                            "backtest_summary": record.backtestSummary,
                            "risk_warnings": record.riskWarnings,
                        }
                    ),
                )
        return record

    @staticmethod
    def _upsert_with_cursor(cur: Any, strategy: StrategyRecord, user_id: int | None = None) -> None:
        owner_user_id = MySQLStrategyStore._scope_user_id(user_id)
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
        MySQLStrategyStore._record_strategy_version_with_cursor(
            cur,
            {
                "strategy_id": strategy.id,
                "owner_user_id": owner_user_id,
                "name": strategy.name,
                "description": strategy.description,
                "strategy_description": strategy.strategyDescription,
                "language": strategy.language,
                "category": strategy.category,
                "tags": strategy.tags,
                "code": strategy.code,
            },
        )
        MySQLStrategyStore._upsert_catalog_with_cursor(
            cur,
            MySQLStrategyStore._normalize_catalog_item(
                {
                    "strategy_id": f"personal:{MySQLStrategyStore._scope_user_id(user_id)}:{strategy.id}",
                    "kind": "personal",
                    "owner_user_id": MySQLStrategyStore._scope_user_id(user_id),
                    "source_strategy_id": strategy.id,
                    "name": strategy.name,
                    "summary": strategy.description or strategy.name,
                    "description": strategy.description,
                    "strategy_description": strategy.strategyDescription,
                    "language": strategy.language,
                    "category": strategy.category,
                    "tags": strategy.tags,
                    "code_snapshot": strategy.code,
                    "status": strategy.status,
                    "updated_at": strategy.updatedAt,
                }
            ),
        )

    @staticmethod
    def _normalize_catalog_item(item: dict[str, Any]) -> dict[str, Any]:
        kind = str(item.get("kind") or "built-in")
        if kind not in VALID_CATALOG_KINDS:
            raise ValueError(f"invalid strategy catalog kind: {kind}")
        strategy_id = str(item.get("strategy_id") or item.get("id") or "").strip()
        if not strategy_id:
            raise ValueError("strategy catalog id is required")
        return {
            "strategy_id": strategy_id,
            "kind": kind,
            "owner_user_id": item.get("owner_user_id"),
            "source_strategy_id": str(item.get("source_strategy_id") or ""),
            "name": str(item.get("name") or strategy_id),
            "summary": str(item.get("summary") or item.get("description") or ""),
            "description": str(item.get("description") or ""),
            "strategy_description": str(item.get("strategy_description") or item.get("strategyDescription") or ""),
            "language": _normalize_language(item.get("language") or "python"),
            "category": str(item.get("category") or "utility"),
            "tags": list(item.get("tags") or []),
            "code_snapshot": str(item.get("code_snapshot") or item.get("code") or ""),
            "status": str(item.get("status") or "published"),
            "enabled": bool(item.get("enabled", True)),
            "featured": bool(item.get("featured", False)),
            "price": str(item.get("price") or ""),
            "note": str(item.get("note") or ""),
            "deleted": bool(item.get("deleted", False)),
            "published_at": str(item.get("published_at") or item.get("publishedAt") or ""),
            "updated_at": str(item.get("updated_at") or item.get("updatedAt") or _now_iso()),
            "backtest_summary": dict(item.get("backtest_summary") or item.get("backtestSummary") or {}),
            "risk_warnings": list(item.get("risk_warnings") or item.get("riskWarnings") or []),
        }

    @staticmethod
    def _upsert_catalog_with_cursor(cur: Any, item: dict[str, Any]) -> None:
        cur.execute(
            """
            INSERT INTO strategy_catalog (
                strategy_id, kind, owner_user_id, source_strategy_id, name, summary,
                description, strategy_description, language, category, tags_json,
                code_snapshot, status, enabled, featured, price, note, deleted,
                published_at, updated_at, backtest_summary_json, risk_warnings_json
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                kind = VALUES(kind),
                owner_user_id = VALUES(owner_user_id),
                source_strategy_id = VALUES(source_strategy_id),
                name = VALUES(name),
                summary = VALUES(summary),
                description = VALUES(description),
                strategy_description = VALUES(strategy_description),
                language = VALUES(language),
                category = VALUES(category),
                tags_json = VALUES(tags_json),
                code_snapshot = VALUES(code_snapshot),
                status = VALUES(status),
                enabled = VALUES(enabled),
                featured = VALUES(featured),
                price = VALUES(price),
                note = VALUES(note),
                deleted = VALUES(deleted),
                published_at = VALUES(published_at),
                updated_at = VALUES(updated_at),
                backtest_summary_json = VALUES(backtest_summary_json),
                risk_warnings_json = VALUES(risk_warnings_json)
            """,
            (
                item["strategy_id"],
                item["kind"],
                item["owner_user_id"],
                item["source_strategy_id"],
                item["name"],
                item["summary"],
                item["description"],
                item["strategy_description"],
                item["language"],
                item["category"],
                _json_dumps(item["tags"]),
                item["code_snapshot"],
                item["status"],
                int(item["enabled"]),
                int(item["featured"]),
                item["price"],
                item["note"],
                int(item["deleted"]),
                item["published_at"],
                item["updated_at"],
                _json_dumps(item["backtest_summary"]),
                _json_dumps(item["risk_warnings"]),
            ),
        )
        MySQLStrategyStore._record_strategy_version_with_cursor(cur, item)

    @staticmethod
    def _catalog_from_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["strategy_id"],
            "kind": row["kind"],
            "owner_user_id": row.get("owner_user_id"),
            "source_strategy_id": row.get("source_strategy_id") or "",
            "name": row["name"],
            "summary": row.get("summary") or "",
            "description": row.get("description") or "",
            "strategy_description": row.get("strategy_description") or "",
            "language": _normalize_language(row.get("language")),
            "category": row.get("category") or "utility",
            "tags": list(_json_loads(row.get("tags_json"), [])),
            "code_snapshot": row.get("code_snapshot") or "",
            "status": row.get("status") or "published",
            "enabled": bool(row.get("enabled", 1)),
            "featured": bool(row.get("featured", 0)),
            "price": row.get("price") or "",
            "note": row.get("note") or "",
            "deleted": bool(row.get("deleted", 0)),
            "published_at": _row_text(row.get("published_at")),
            "updated_at": _row_text(row.get("updated_at")),
            "backtest_summary": dict(_json_loads(row.get("backtest_summary_json"), {})),
            "risk_warnings": list(_json_loads(row.get("risk_warnings_json"), [])),
        }

    @staticmethod
    def _record_strategy_version_with_cursor(cur: Any, item: dict[str, Any]) -> None:
        strategy_id = str(item["strategy_id"])
        owner_user_id = int(item.get("owner_user_id") or 0)
        code = str(item.get("code") or item.get("code_snapshot") or "")
        code_sha256 = hashlib.sha256(code.encode("utf-8")).hexdigest()
        cur.execute(
            """
            SELECT version_no, code_sha256, description, strategy_description,
                   name, language, category, tags_json
            FROM strategy_versions
            WHERE strategy_id = %s AND owner_user_id = %s
            ORDER BY version_no DESC
            LIMIT 1
            """,
            (strategy_id, owner_user_id),
        )
        latest = cur.fetchone()
        if latest and (
            latest["code_sha256"] == code_sha256
            and latest["name"] == str(item.get("name") or "")
            and latest["description"] == str(item.get("description") or "")
            and latest["strategy_description"] == str(item.get("strategy_description") or "")
            and latest["language"] == str(item.get("language") or "")
            and latest["category"] == str(item.get("category") or "")
            and list(_json_loads(latest["tags_json"], [])) == list(item.get("tags") or [])
        ):
            return
        version_no = int(latest["version_no"]) + 1 if latest else 1
        cur.execute(
            """
            INSERT INTO strategy_versions (
                strategy_id, owner_user_id, version_no, name, description,
                strategy_description, language, category, tags_json, code,
                code_sha256, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                strategy_id,
                owner_user_id,
                version_no,
                str(item.get("name") or strategy_id),
                str(item.get("description") or ""),
                str(item.get("strategy_description") or item.get("strategyDescription") or ""),
                str(item.get("language") or "python"),
                str(item.get("category") or "utility"),
                _json_dumps(list(item.get("tags") or [])),
                code,
                code_sha256,
                _now_iso(),
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
    def _init_strategy_versions(cur: Any) -> None:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS strategy_versions (
                version_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                strategy_id VARCHAR(128) NOT NULL,
                owner_user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
                version_no INT UNSIGNED NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                strategy_description MEDIUMTEXT NOT NULL,
                language VARCHAR(32) NOT NULL,
                category VARCHAR(64) NOT NULL,
                tags_json JSON NOT NULL,
                code MEDIUMTEXT NOT NULL,
                code_sha256 CHAR(64) NOT NULL,
                created_at VARCHAR(64) NOT NULL,
                PRIMARY KEY (version_id),
                UNIQUE KEY uq_strategy_version (owner_user_id, strategy_id, version_no),
                KEY idx_strategy_versions_lookup (owner_user_id, strategy_id, version_no)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
        # Changing a referenced primary key makes MySQL rebuild the table. Even
        # when the final composite key is valid, the intermediate DROP PRIMARY
        # KEY can fail with errno 150 while inbound foreign keys are attached.
        # Keep the legacy key in that case; availability is more important than
        # completing this optional schema upgrade during a request.
        if MySQLStrategyStore._has_inbound_foreign_keys(cur, "strategy_library"):
            logger.warning(
                "Leaving legacy strategy_library primary key %s because inbound foreign keys reference it",
                columns,
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
    def _init_strategy_catalog(cur: Any) -> None:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS strategy_catalog (
                strategy_id VARCHAR(128) NOT NULL,
                kind VARCHAR(32) NOT NULL,
                owner_user_id BIGINT UNSIGNED NULL,
                source_strategy_id VARCHAR(128) NOT NULL,
                name TEXT NOT NULL,
                summary TEXT NOT NULL,
                description TEXT NOT NULL,
                strategy_description MEDIUMTEXT NOT NULL,
                language VARCHAR(32) NOT NULL,
                category VARCHAR(64) NOT NULL,
                tags_json JSON NOT NULL,
                code_snapshot MEDIUMTEXT NOT NULL,
                status VARCHAR(32) NOT NULL,
                enabled TINYINT(1) NOT NULL DEFAULT 1,
                featured TINYINT(1) NOT NULL DEFAULT 0,
                price VARCHAR(64) NOT NULL,
                note VARCHAR(500) NOT NULL,
                deleted TINYINT(1) NOT NULL DEFAULT 0,
                published_at VARCHAR(64) NOT NULL,
                updated_at VARCHAR(64) NOT NULL,
                backtest_summary_json JSON NOT NULL,
                risk_warnings_json JSON NOT NULL,
                PRIMARY KEY (strategy_id),
                INDEX idx_strategy_catalog_kind_status (kind, status, enabled, deleted),
                INDEX idx_strategy_catalog_owner (owner_user_id, updated_at)
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
