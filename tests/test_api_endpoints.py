import pytest

from app.api.app import app


class TestAppCreation:
    def test_app_exists(self):
        assert app is not None
        assert app.title == "Commercial-Resi-Analyser"

    def test_routes_registered(self):
        routes = {r.path for r in app.routes if hasattr(r, "path")}
        assert "/api/v1/projects" in routes or "/api/v1/projects/" in routes
        assert "/health" in routes

    def test_project_routes_exist(self):
        route_methods = {}
        for route in app.routes:
            if hasattr(route, "path") and hasattr(route, "methods"):
                route_methods[route.path] = route.methods
        assert "POST" in route_methods.get("/api/v1/projects", set()) or \
               "POST" in route_methods.get("/api/v1/projects/", set())

    def test_eligibility_routes_exist(self):
        paths = {r.path for r in app.routes if hasattr(r, "path")}
        assert any("eligibility" in p for p in paths)

    def test_appraisals_routes_exist(self):
        paths = {r.path for r in app.routes if hasattr(r, "path")}
        assert any("appraisals" in p for p in paths)

    def test_scrape_url_route_exists(self):
        paths = {r.path for r in app.routes if hasattr(r, "path")}
        assert any("scrape-url" in p for p in paths)
