"""The built SPA must be served with a history-API fallback: deep links like
/projects/<id> return index.html, while unmatched API paths return JSON 404s
instead of leaking index.html with a 200."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.app import SpaStaticFiles, register_api_fallback


def _make_app(tmp_path) -> FastAPI:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>spa</title>", encoding="utf-8")
    assets = dist / "assets"
    assets.mkdir()
    (assets / "main.js").write_text("console.log('hi')", encoding="utf-8")

    app = FastAPI()

    @app.get("/api/v1/ping")
    def ping():
        return {"pong": True}

    register_api_fallback(app)
    app.mount("/", SpaStaticFiles(directory=str(dist), html=True), name="spa")
    return app


class TestSpaServing:
    def test_real_static_asset_served(self, tmp_path):
        client = TestClient(_make_app(tmp_path))
        resp = client.get("/assets/main.js")
        assert resp.status_code == 200
        assert "console.log" in resp.text

    def test_deep_link_falls_back_to_index(self, tmp_path):
        client = TestClient(_make_app(tmp_path))
        resp = client.get("/projects/some-uuid-here")
        assert resp.status_code == 200
        assert "<title>spa</title>" in resp.text

    def test_nested_deep_link_falls_back_to_index(self, tmp_path):
        client = TestClient(_make_app(tmp_path))
        resp = client.get("/projects/some-uuid/eligibility")
        assert resp.status_code == 200
        assert "<title>spa</title>" in resp.text

    def test_real_api_route_still_works(self, tmp_path):
        client = TestClient(_make_app(tmp_path))
        resp = client.get("/api/v1/ping")
        assert resp.status_code == 200
        assert resp.json() == {"pong": True}

    def test_unmatched_api_path_is_json_404_not_index(self, tmp_path):
        client = TestClient(_make_app(tmp_path))
        resp = client.get("/api/v1/does-not-exist")
        assert resp.status_code == 404
        assert resp.headers["content-type"].startswith("application/json")
        assert resp.json()["detail"] == "Not found"

    def test_unmatched_api_post_is_json_404(self, tmp_path):
        client = TestClient(_make_app(tmp_path))
        resp = client.post("/api/v1/does-not-exist", json={})
        assert resp.status_code == 404
        assert resp.headers["content-type"].startswith("application/json")
