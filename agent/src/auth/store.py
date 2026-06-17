"""MySQL-backed user authentication store."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from src.persistence.mysql import mysql_connection

PBKDF2_ITERATIONS = 260_000
TOKEN_TTL_DAYS = 30


@dataclass(frozen=True)
class AuthUser:
    """Authenticated application user."""

    user_id: int
    username: str
    display_name: str
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "username": self.username,
            "display_name": self.display_name,
            "created_at": self.created_at,
        }


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _dt_to_mysql(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(tzinfo=None).isoformat(sep=" ", timespec="microseconds")


def _row_datetime(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, raw_iterations, raw_salt, raw_digest = stored_hash.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(raw_iterations)
        salt = base64.b64decode(raw_salt.encode("ascii"))
        expected = base64.b64decode(raw_digest.encode("ascii"))
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class MySQLAuthStore:
    """Authentication and bearer-token persistence."""

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
                    CREATE TABLE IF NOT EXISTS users (
                        user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                        username VARCHAR(191) NOT NULL,
                        display_name VARCHAR(191) NOT NULL,
                        password_hash VARCHAR(512) NOT NULL,
                        created_at DATETIME(6) NOT NULL,
                        updated_at DATETIME(6) NOT NULL,
                        PRIMARY KEY (user_id),
                        UNIQUE KEY uq_users_username (username)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS auth_tokens (
                        token_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                        user_id BIGINT UNSIGNED NOT NULL,
                        token_hash CHAR(64) NOT NULL,
                        created_at DATETIME(6) NOT NULL,
                        expires_at DATETIME(6) NOT NULL,
                        last_used_at DATETIME(6) NULL,
                        revoked_at DATETIME(6) NULL,
                        PRIMARY KEY (token_id),
                        UNIQUE KEY uq_auth_tokens_hash (token_hash),
                        KEY idx_auth_tokens_user (user_id),
                        KEY idx_auth_tokens_expires (expires_at),
                        CONSTRAINT fk_auth_tokens_user
                            FOREIGN KEY (user_id) REFERENCES users(user_id)
                            ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )

    def create_user(self, username: str, password: str, display_name: str | None = None) -> AuthUser:
        normalized = username.strip().lower()
        now = _dt_to_mysql(_utc_now())
        display = (display_name or username).strip() or username
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (username, display_name, password_hash, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (normalized, display, _hash_password(password), now, now),
                )
                user_id = int(cur.lastrowid)
        return AuthUser(user_id=user_id, username=normalized, display_name=display, created_at=now)

    def get_user_by_username(self, username: str) -> AuthUser | None:
        normalized = username.strip().lower()
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE username = %s", (normalized,))
                row = cur.fetchone()
        return self._user_from_row(row) if row else None

    def authenticate(self, username: str, password: str) -> AuthUser | None:
        normalized = username.strip().lower()
        with self._lock, mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users WHERE username = %s", (normalized,))
                row = cur.fetchone()
        if not row or not _verify_password(password, str(row.get("password_hash") or "")):
            return None
        return self._user_from_row(row)

    def issue_token(self, user_id: int) -> tuple[str, str]:
        token = secrets.token_urlsafe(32)
        expires = _utc_now() + timedelta(days=TOKEN_TTL_DAYS)
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO auth_tokens (user_id, token_hash, created_at, expires_at)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (int(user_id), _token_hash(token), _dt_to_mysql(_utc_now()), _dt_to_mysql(expires)),
                )
        return token, expires.isoformat()

    def user_for_token(self, token: str) -> AuthUser | None:
        hashed = _token_hash(token)
        now = _dt_to_mysql(_utc_now())
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT u.*
                    FROM auth_tokens t
                    JOIN users u ON u.user_id = t.user_id
                    WHERE t.token_hash = %s
                      AND t.revoked_at IS NULL
                      AND t.expires_at > %s
                    """,
                    (hashed, now),
                )
                row = cur.fetchone()
                if row:
                    cur.execute(
                        "UPDATE auth_tokens SET last_used_at = %s WHERE token_hash = %s",
                        (now, hashed),
                    )
        return self._user_from_row(row) if row else None

    def revoke_token(self, token: str) -> bool:
        with self._lock, self._transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE auth_tokens
                    SET revoked_at = %s
                    WHERE token_hash = %s AND revoked_at IS NULL
                    """,
                    (_dt_to_mysql(_utc_now()), _token_hash(token)),
                )
                return cur.rowcount > 0

    @staticmethod
    def _user_from_row(row: dict[str, Any]) -> AuthUser:
        return AuthUser(
            user_id=int(row["user_id"]),
            username=str(row["username"]),
            display_name=str(row.get("display_name") or row["username"]),
            created_at=_row_datetime(row.get("created_at")),
        )
