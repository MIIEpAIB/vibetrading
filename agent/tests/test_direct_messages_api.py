"""Direct message and social graph API helper tests."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

import api_server


class FakeAuthStore:
    def __init__(self) -> None:
        self.users = [
            SimpleNamespace(user_id=1, username="alice", display_name="Alice", created_at="2026-01-01"),
            SimpleNamespace(user_id=2, username="bob", display_name="Bob", created_at="2026-01-02"),
        ]

    def list_users(self, limit: int = 200):
        return self.users[:limit]


@pytest.fixture
def dm_context(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(api_server, "DIRECT_MESSAGES_PATH", tmp_path / "direct_messages.json")
    monkeypatch.setattr(api_server, "SOCIAL_GRAPH_PATH", tmp_path / "social_graph.json")
    monkeypatch.setattr(api_server, "_direct_message_store", None)
    monkeypatch.setattr(api_server, "_social_graph_store", None)
    monkeypatch.setattr(api_server, "_get_auth_store", lambda: FakeAuthStore())
    return {
        "alice": api_server.AuthContext(user=SimpleNamespace(user_id=1, username="alice", display_name="Alice"), operator=False),
        "bob": api_server.AuthContext(user=SimpleNamespace(user_id=2, username="bob", display_name="Bob"), operator=False),
        "operator": api_server.AuthContext(user=None, operator=True),
    }


def run(coro):
    return asyncio.run(coro)


def test_direct_message_thread_send_and_mark_read(dm_context) -> None:
    created = run(api_server.create_direct_message_thread(
        api_server.CreateDirectMessageThreadRequest(recipient_username="bob", initial_message="hello bob"),
        dm_context["alice"],
    ))

    assert created.peer.username == "bob"
    assert created.last_message is not None
    assert created.last_message.content == "hello bob"

    bob_threads = run(api_server.list_direct_message_threads(dm_context["bob"]))
    assert bob_threads["threads"][0].unread_count == 1

    messages = run(api_server.list_direct_messages(created.thread_id, 100, dm_context["bob"]))
    assert messages["messages"][0].sender.username == "alice"

    sent = run(api_server.send_direct_message(
        created.thread_id,
        api_server.SendDirectMessageRequest(content="hi alice"),
        dm_context["bob"],
    ))
    assert sent.sender.username == "bob"

    read = run(api_server.mark_direct_message_thread_read(created.thread_id, dm_context["bob"]))
    assert read["updated"] == 1

    bob_threads_after_read = run(api_server.list_direct_message_threads(dm_context["bob"]))
    assert bob_threads_after_read["threads"][0].unread_count == 0


def test_direct_messages_reject_self_and_operator_context(dm_context) -> None:
    with pytest.raises(api_server.HTTPException) as self_error:
        run(api_server.create_direct_message_thread(
            api_server.CreateDirectMessageThreadRequest(recipient_username="alice"),
            dm_context["alice"],
        ))
    assert self_error.value.status_code == 400

    with pytest.raises(api_server.HTTPException) as operator_error:
        run(api_server.list_direct_message_threads(dm_context["operator"]))
    assert operator_error.value.status_code == 401


def test_social_follow_unfollow_and_lists(dm_context) -> None:
    search_before = run(api_server.search_social_users("bob", dm_context["alice"]))
    assert search_before["users"][0].is_following is False

    followed = run(api_server.follow_user(2, dm_context["alice"]))
    assert followed.username == "bob"
    assert followed.is_following is True
    assert followed.follower_count == 1

    following = run(api_server.list_following(None, dm_context["alice"]))
    assert [user.username for user in following["users"]] == ["bob"]

    followers = run(api_server.list_followers(2, dm_context["bob"]))
    assert [user.username for user in followers["users"]] == ["alice"]

    unfollowed = run(api_server.unfollow_user(2, dm_context["alice"]))
    assert unfollowed.is_following is False

    with pytest.raises(api_server.HTTPException) as self_follow:
        run(api_server.follow_user(1, dm_context["alice"]))
    assert self_follow.value.status_code == 400
