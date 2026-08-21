"""Compatibility shim for QUANTAXIS' optional ``motor`` dependency."""

from __future__ import annotations

from .motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorCursor


class MotorClient(AsyncIOMotorClient):
    """Alias kept for QUANTAXIS imports that expect ``from motor import MotorClient``."""


__all__ = ["AsyncIOMotorClient", "AsyncIOMotorCollection", "AsyncIOMotorCursor", "MotorClient"]
