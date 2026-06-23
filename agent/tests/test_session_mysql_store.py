"""MySQL session store compatibility regressions."""

from __future__ import annotations

from datetime import datetime

from src.session.mysql_store import MySQLSessionStore


def test_mysql_session_store_converts_datetime_rows_to_strings() -> None:
    session = MySQLSessionStore._session_from_row(
        {
            "session_id": "s1",
            "title": "Session",
            "status": "active",
            "created_at": datetime(2026, 6, 22, 10, 30, 0),
            "updated_at": datetime(2026, 6, 22, 10, 31, 0),
            "last_attempt_id": None,
            "user_id": 7,
            "config_json": "{}",
        }
    )

    assert session.created_at == "2026-06-22T10:30:00"
    assert session.updated_at == "2026-06-22T10:31:00"
    assert session.owner_user_id == 7
