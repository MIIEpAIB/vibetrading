"""Compatibility shim for the optional ``async_timeout`` dependency."""

from __future__ import annotations

from contextlib import contextmanager


@contextmanager
def timeout(timeout=None, loop=None):  # noqa: ANN001
    """Minimal no-op timeout context manager for QUANTAXIS imports."""
    yield


__all__ = ["timeout"]
