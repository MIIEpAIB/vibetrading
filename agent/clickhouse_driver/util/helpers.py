"""Helper functions required by QUANTAXIS imports."""

from __future__ import annotations

from typing import Iterable


def column_chunks(columns: Iterable[object], chunk_size: int):
    """Yield ``columns`` in chunks, matching the upstream helper's basic shape."""
    items = list(columns)
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    for index in range(0, len(items), chunk_size):
        yield items[index : index + chunk_size]


__all__ = ["column_chunks"]
