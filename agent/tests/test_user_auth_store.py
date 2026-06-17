"""User authentication store unit tests."""

from __future__ import annotations

from src.auth.store import _hash_password, _verify_password


def test_password_hash_roundtrip() -> None:
    stored = _hash_password("correct horse battery staple")

    assert stored.startswith("pbkdf2_sha256$")
    assert _verify_password("correct horse battery staple", stored)
    assert not _verify_password("wrong password", stored)
