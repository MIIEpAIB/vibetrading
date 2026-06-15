"""Goal-store selection helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.persistence.mysql import mysql_configured


def create_goal_store(db_path: Path | None = None) -> Any:
    """Return the configured goal store.

    Passing ``db_path`` explicitly keeps the SQLite store for tests and local
    callers that need a concrete database file. Without a path, MySQL is used
    only when a MySQL URL is present in the process environment.
    """
    if db_path is None and mysql_configured():
        from src.goal.mysql_store import MySQLGoalStore

        return MySQLGoalStore()

    from src.goal.store import GoalStore

    return GoalStore(db_path)
