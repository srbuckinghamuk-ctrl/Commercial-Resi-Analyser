import pytest

from app.api.app import app

# See test_api_endpoints.py — route inspection uses the OpenAPI schema for
# FastAPI 0.141+ compatibility.
PATHS: dict = app.openapi()["paths"]


class TestLookupRoutesExist:
    def test_lookup_routes_registered(self):
        assert any("lookup" in p and "postcode" in p for p in PATHS)
        assert any("lookup" in p and "flood" in p for p in PATHS)
        assert any("lookup" in p and "epc" in p for p in PATHS)
        assert any("lookup" in p and "article4" in p for p in PATHS)

    def _methods_for(self, *fragments: str) -> dict:
        for path, methods in PATHS.items():
            if all(f in path for f in fragments):
                return methods
        pytest.fail(f"No route matching fragments {fragments}")

    def test_postcode_lookup_is_get(self):
        assert "get" in self._methods_for("lookup", "postcode")

    def test_flood_lookup_is_get(self):
        assert "get" in self._methods_for("lookup", "flood")


class TestEligibilityRunRouteExists:
    def test_eligibility_run_route_registered(self):
        assert any("eligibility" in p and "run" in p for p in PATHS)

    def test_eligibility_run_is_post(self):
        for path, methods in PATHS.items():
            if "eligibility" in path and "run" in path:
                assert "post" in methods
                break
        else:
            pytest.fail("Eligibility run route not found")
