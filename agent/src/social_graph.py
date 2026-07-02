"""Lightweight JSON-backed social follow graph."""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class FollowEdge:
    follower_user_id: int
    following_user_id: int
    created_at: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FollowEdge":
        return cls(
            follower_user_id=int(data.get("follower_user_id") or 0),
            following_user_id=int(data.get("following_user_id") or 0),
            created_at=str(data.get("created_at") or ""),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "follower_user_id": self.follower_user_id,
            "following_user_id": self.following_user_id,
            "created_at": self.created_at,
        }


class SocialGraphStore:
    """Small follow graph store backed by one JSON file."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()

    def follow(self, follower_user_id: int, following_user_id: int) -> FollowEdge:
        if int(follower_user_id) == int(following_user_id):
            raise ValueError("Cannot follow yourself")
        with self._lock:
            edges = self._read()
            for edge in edges:
                if edge.follower_user_id == int(follower_user_id) and edge.following_user_id == int(following_user_id):
                    return edge
            edge = FollowEdge(int(follower_user_id), int(following_user_id), _utc_now())
            edges.append(edge)
            self._write(edges)
            return edge

    def unfollow(self, follower_user_id: int, following_user_id: int) -> bool:
        with self._lock:
            edges = self._read()
            kept = [
                edge for edge in edges
                if not (edge.follower_user_id == int(follower_user_id) and edge.following_user_id == int(following_user_id))
            ]
            changed = len(kept) != len(edges)
            if changed:
                self._write(kept)
            return changed

    def is_following(self, follower_user_id: int, following_user_id: int) -> bool:
        return any(
            edge.follower_user_id == int(follower_user_id) and edge.following_user_id == int(following_user_id)
            for edge in self._read()
        )

    def follower_ids(self, user_id: int) -> list[int]:
        return sorted({edge.follower_user_id for edge in self._read() if edge.following_user_id == int(user_id)})

    def following_ids(self, user_id: int) -> list[int]:
        return sorted({edge.following_user_id for edge in self._read() if edge.follower_user_id == int(user_id)})

    def follower_count(self, user_id: int) -> int:
        return len(self.follower_ids(user_id))

    def following_count(self, user_id: int) -> int:
        return len(self.following_ids(user_id))

    def _read(self) -> list[FollowEdge]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []
        raw_edges = data.get("follows", []) if isinstance(data, dict) else []
        if not isinstance(raw_edges, list):
            return []
        return [FollowEdge.from_dict(item) for item in raw_edges if isinstance(item, dict)]

    def _write(self, edges: list[FollowEdge]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(f"{self.path.suffix}.{os.getpid()}.tmp")
        payload = {"follows": [edge.to_dict() for edge in edges]}
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)
