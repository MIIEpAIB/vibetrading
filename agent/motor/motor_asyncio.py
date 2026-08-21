"""Small compatibility layer for QUANTAXIS' async Mongo imports."""

from __future__ import annotations

from typing import Any


class AsyncIOMotorCursor:
    """Minimal awaitable cursor wrapper used for import compatibility."""

    def __init__(self, cursor: Any | None = None) -> None:
        self._cursor = cursor

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cursor, name)


class AsyncIOMotorCollection:
    """Minimal collection wrapper used for import compatibility."""

    def __init__(self, collection: Any | None = None) -> None:
        self._collection = collection

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)


class AsyncIOMotorClient:
    """Fallback client that defers to :mod:`pymongo` when async motor is absent."""

    def __init__(self, uri: str, *args: Any, io_loop: Any | None = None, **kwargs: Any) -> None:
        import pymongo

        self._uri = uri
        self._io_loop = io_loop
        self._client = pymongo.MongoClient(uri, *args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    def close(self) -> None:
        self._client.close()


__all__ = ["AsyncIOMotorClient", "AsyncIOMotorCollection", "AsyncIOMotorCursor"]
