"""Minimal ClickHouse client fallback for import compatibility."""

from __future__ import annotations

from typing import Any


class Client:
    """Fallback client that raises only when an actual ClickHouse call is made."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.args = args
        self.kwargs = kwargs

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("clickhouse_driver is unavailable in this environment")

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)


__all__ = ["Client"]
