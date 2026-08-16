from app.api.app import app

# Route inspection goes through the OpenAPI schema: FastAPI 0.141+ defers
# router flattening, so app.routes contains _IncludedRouter placeholders
# without .path until the app is finalised. The schema always reflects the
# real, resolved routing table.
PATHS: dict = app.openapi()["paths"]


class TestAppCreation:
    def test_app_exists(self):
        assert app is not None
        assert app.title == "Commercial-Resi-Analyser"

    def test_routes_registered(self):
        assert "/api/v1/projects" in PATHS or "/api/v1/projects/" in PATHS
        assert "/health" in PATHS

    def test_project_routes_exist(self):
        methods = PATHS.get("/api/v1/projects", PATHS.get("/api/v1/projects/", {}))
        assert "post" in methods

    def test_eligibility_routes_exist(self):
        assert any("eligibility" in p for p in PATHS)

    def test_appraisals_routes_exist(self):
        assert any("appraisals" in p for p in PATHS)

    def test_scrape_url_route_exists(self):
        assert any("scrape-url" in p for p in PATHS)
