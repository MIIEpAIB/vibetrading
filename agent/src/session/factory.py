"""Session-store selection helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.persistence.mysql import mysql_configured


def create_session_store(base_dir: Path) -> Any:
    """Return the configured session store."""
    if mysql_configured():
        from src.session.mysql_store import MySQLSessionStore

        return MySQLSessionStore()

    from src.session.store import SessionStore

    return SessionStore(base_dir=base_dir)
