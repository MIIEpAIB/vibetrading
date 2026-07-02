"""Lightweight JSON-backed direct message storage."""

from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class DirectMessage:
    message_id: str
    thread_id: str
    sender_user_id: int
    content: str
    created_at: str
    read_by: list[int]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DirectMessage":
        return cls(
            message_id=str(data.get("message_id") or ""),
            thread_id=str(data.get("thread_id") or ""),
            sender_user_id=int(data.get("sender_user_id") or 0),
            content=str(data.get("content") or ""),
            created_at=str(data.get("created_at") or ""),
            read_by=[int(item) for item in data.get("read_by", []) if item is not None],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "message_id": self.message_id,
            "thread_id": self.thread_id,
            "sender_user_id": self.sender_user_id,
            "content": self.content,
            "created_at": self.created_at,
            "read_by": self.read_by,
        }


@dataclass(frozen=True)
class DirectMessageThread:
    thread_id: str
    participant_user_ids: list[int]
    created_at: str
    updated_at: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DirectMessageThread":
        return cls(
            thread_id=str(data.get("thread_id") or ""),
            participant_user_ids=sorted({int(item) for item in data.get("participant_user_ids", []) if item is not None}),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "thread_id": self.thread_id,
            "participant_user_ids": self.participant_user_ids,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class DirectMessageStore:
    """Small one-to-one DM store backed by one JSON file."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()

    def list_threads(self, user_id: int) -> list[DirectMessageThread]:
        with self._lock:
            data = self._read()
            threads = [DirectMessageThread.from_dict(item) for item in data["threads"]]
        return sorted(
            [thread for thread in threads if int(user_id) in thread.participant_user_ids],
            key=lambda thread: thread.updated_at,
            reverse=True,
        )

    def get_thread(self, thread_id: str) -> DirectMessageThread | None:
        with self._lock:
            data = self._read()
            for item in data["threads"]:
                thread = DirectMessageThread.from_dict(item)
                if thread.thread_id == thread_id:
                    return thread
        return None

    def get_or_create_thread(self, user_a: int, user_b: int) -> DirectMessageThread:
        if int(user_a) == int(user_b):
            raise ValueError("Cannot create a direct message thread with yourself")
        participants = sorted([int(user_a), int(user_b)])
        with self._lock:
            data = self._read()
            for item in data["threads"]:
                thread = DirectMessageThread.from_dict(item)
                if thread.participant_user_ids == participants:
                    return thread
            now = _utc_now()
            thread = DirectMessageThread(
                thread_id=uuid.uuid4().hex,
                participant_user_ids=participants,
                created_at=now,
                updated_at=now,
            )
            data["threads"].append(thread.to_dict())
            self._write(data)
            return thread

    def list_messages(self, thread_id: str, *, limit: int = 100) -> list[DirectMessage]:
        with self._lock:
            data = self._read()
            messages = [
                DirectMessage.from_dict(item)
                for item in data["messages"]
                if str(item.get("thread_id") or "") == thread_id
            ]
        return sorted(messages, key=lambda message: message.created_at)[-max(1, int(limit)):]

    def send_message(self, thread_id: str, sender_user_id: int, content: str) -> DirectMessage:
        clean = content.strip()
        if not clean:
            raise ValueError("Message content is required")
        with self._lock:
            data = self._read()
            thread = None
            for index, item in enumerate(data["threads"]):
                candidate = DirectMessageThread.from_dict(item)
                if candidate.thread_id == thread_id:
                    thread = candidate
                    thread_index = index
                    break
            if thread is None:
                raise KeyError(thread_id)
            if int(sender_user_id) not in thread.participant_user_ids:
                raise PermissionError(thread_id)

            now = _utc_now()
            message = DirectMessage(
                message_id=uuid.uuid4().hex,
                thread_id=thread_id,
                sender_user_id=int(sender_user_id),
                content=clean,
                created_at=now,
                read_by=[int(sender_user_id)],
            )
            data["messages"].append(message.to_dict())
            data["threads"][thread_index] = DirectMessageThread(
                thread_id=thread.thread_id,
                participant_user_ids=thread.participant_user_ids,
                created_at=thread.created_at,
                updated_at=now,
            ).to_dict()
            self._write(data)
            return message

    def mark_read(self, thread_id: str, user_id: int) -> int:
        changed = 0
        with self._lock:
            data = self._read()
            for item in data["messages"]:
                if str(item.get("thread_id") or "") != thread_id:
                    continue
                read_by = {int(value) for value in item.get("read_by", []) if value is not None}
                if int(user_id) not in read_by:
                    read_by.add(int(user_id))
                    item["read_by"] = sorted(read_by)
                    changed += 1
            if changed:
                self._write(data)
        return changed

    def unread_count(self, thread_id: str, user_id: int) -> int:
        with self._lock:
            data = self._read()
            return sum(
                1
                for item in data["messages"]
                if str(item.get("thread_id") or "") == thread_id
                and int(item.get("sender_user_id") or 0) != int(user_id)
                and int(user_id) not in {int(value) for value in item.get("read_by", []) if value is not None}
            )

    def last_message(self, thread_id: str) -> DirectMessage | None:
        messages = self.list_messages(thread_id, limit=1)
        return messages[-1] if messages else None

    def _read(self) -> dict[str, list[dict[str, Any]]]:
        if not self.path.exists():
            return {"threads": [], "messages": []}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"threads": [], "messages": []}
        if not isinstance(data, dict):
            return {"threads": [], "messages": []}
        threads = data.get("threads") if isinstance(data.get("threads"), list) else []
        messages = data.get("messages") if isinstance(data.get("messages"), list) else []
        return {"threads": threads, "messages": messages}

    def _write(self, data: dict[str, list[dict[str, Any]]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(f"{self.path.suffix}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)
