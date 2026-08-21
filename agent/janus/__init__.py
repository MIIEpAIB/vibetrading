"""Compatibility shim for the optional ``janus`` dependency."""

from __future__ import annotations

import asyncio
import queue as _queue
from dataclasses import dataclass


@dataclass
class Queue:
    """Minimal janus-compatible queue with sync and async sides."""

    maxsize: int = 0

    def __post_init__(self) -> None:
        self.sync_q: _queue.Queue = _queue.Queue(self.maxsize)
        self.async_q: asyncio.Queue = asyncio.Queue(self.maxsize)

    def close(self) -> None:
        return None

    async def wait_closed(self) -> None:
        return None


__all__ = ["Queue"]
