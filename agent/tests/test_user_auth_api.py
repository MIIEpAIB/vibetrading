"""Application-user auth API helpers."""

from __future__ import annotations

from types import SimpleNamespace

import api_server


def test_operator_api_key_short_circuits_user_token_lookup(monkeypatch) -> None:
    """A valid operator key must not be treated as a user token first."""

    request = SimpleNamespace(client=SimpleNamespace(host="203.0.113.10"), headers={})
    cred = SimpleNamespace(credentials="operator-secret")

    monkeypatch.setattr(api_server, "_configured_api_key", lambda: "operator-secret")

    def fail_user_lookup(_token: str):
        raise AssertionError("operator key should not hit the user auth store")

    monkeypatch.setattr(api_server, "_resolve_user_from_token", fail_user_lookup)

    ctx = api_server._resolve_auth_context(request=request, cred=cred)

    assert ctx.operator is True
    assert ctx.user is None
