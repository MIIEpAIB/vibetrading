"""Compatibility shim for QUANTAXIS' optional ``clickhouse_driver`` dependency."""

from __future__ import annotations

from .client import Client

__all__ = ["Client"]
