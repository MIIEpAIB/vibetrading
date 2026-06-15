"""Optional MySQL connection helpers.

The project keeps filesystem/SQLite storage as the default. MySQL is selected
only when the operator provides a connection URL through the environment.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator
from urllib.parse import parse_qs, unquote, urlparse

_URL_ENV_NAMES = (
    "VIBE_TRADING_MYSQL_URL",
    "MYSQL_URL",
    "DATABASE_URL",
)
_MYSQL_SCHEMES = {"mysql", "mysql+pymysql", "mariadb", "mariadb+pymysql"}


def mysql_url() -> str:
    """Return the configured MySQL URL, or an empty string when disabled."""
    for name in _URL_ENV_NAMES:
        value = os.getenv(name, "").strip()
        if not value:
            continue
        if name == "DATABASE_URL" and urlparse(value).scheme.lower() not in _MYSQL_SCHEMES:
            continue
        if value:
            return value
    return ""


def mysql_configured() -> bool:
    """Return whether the runtime should use MySQL-backed stores."""
    return bool(mysql_url())


def _parse_url(url: str) -> dict[str, Any]:
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme not in _MYSQL_SCHEMES:
        raise ValueError("MySQL URL must use mysql://, mysql+pymysql://, mariadb://, or mariadb+pymysql://")
    database = parsed.path.lstrip("/")
    if not database:
        raise ValueError("MySQL URL must include a database name")
    query = parse_qs(parsed.query)
    charset = query.get("charset", ["utf8mb4"])[0]
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": unquote(database),
        "charset": charset,
        "autocommit": False,
    }


def connect():
    """Open a PyMySQL connection from the configured URL."""
    url = mysql_url()
    if not url:
        raise RuntimeError("MySQL persistence is not configured")
    try:
        import pymysql
        from pymysql.cursors import DictCursor
    except ImportError as exc:
        raise RuntimeError(
            "MySQL persistence requires the 'pymysql' package. Install project dependencies again."
        ) from exc
    return pymysql.connect(cursorclass=DictCursor, **_parse_url(url))


@contextmanager
def mysql_connection() -> Iterator[Any]:
    """Yield a MySQL connection and always close it."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
