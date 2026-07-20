"""Regression tests for the SPA deep-link middleware in ``api_server``.

The middleware intercepts browser navigation (``Accept: text/html``) to
SPA pages that share a path with an API endpoint, serving the SPA shell
instead. It must NOT intercept API-only paths even when called with a
text/html accept header — the matcher is intentionally narrow so things
like ``/runs/{id}/code`` and ``/runs/{id}/pine`` keep returning the
correct API response.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI


class TestSpaHtmlRouteMatcher:
    """Pin the matcher used by ``_spa_html_deep_link_fallback`` middleware."""

    @pytest.mark.parametrize(
        "path",
        [
            "/correlation",        # Correlation page
            "/runs/abc",           # RunDetail (no trailing slash)
            "/runs/abc-123",       # RunDetail with dashes
            "/runs/abc/",          # RunDetail (trailing slash)
        ],
    )
    def test_spa_pages_match(self, path: str) -> None:
        from api_server import _is_spa_html_route

        assert _is_spa_html_route(path) is True, path

    @pytest.mark.parametrize(
        "path",
        [
            "/runs",                # collection endpoint (API only)
            "/runs/abc/code",       # API-only — must NOT be hijacked
            "/runs/abc/pine",       # API-only — must NOT be hijacked
            "/runs/abc/code/",
            "/runs/abc/foo/bar",    # deeper nested — defensive
            "/sessions/xyz",        # different namespace
            "/api",
            "/skills",
            "/correlation/extra",   # only the bare /correlation page exists
        ],
    )
    def test_api_only_paths_do_not_match(self, path: str) -> None:
        from api_server import _is_spa_html_route

        assert _is_spa_html_route(path) is False, path


def test_frontend_static_mount_serves_root_for_direct_app_import(tmp_path) -> None:
    from api_server import _mount_frontend_static

    frontend_dist = tmp_path / "dist"
    frontend_dist.mkdir()
    (frontend_dist / "index.html").write_text("<!doctype html><title>SPA</title>", encoding="utf-8")

    app = FastAPI()

    @app.get("/health")
    def health():
        return {"status": "healthy"}

    assert _mount_frontend_static(app, frontend_dist) is True
    route_names = [getattr(route, "name", None) for route in app.routes]
    assert "frontend" in route_names
    assert route_names.index("health") < route_names.index("frontend")
