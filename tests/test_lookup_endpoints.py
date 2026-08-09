import pytest

from app.api.app import app


class TestLookupRoutesExist:
    def test_lookup_routes_registered(self):
        paths = {r.path for r in app.routes if hasattr(r, "path")}
        assert any("lookup" in p and "postcode" in p for p in paths)
        assert any("lookup" in p and "flood" in p for p in paths)
        assert any("lookup" in p and "epc" in p for p in paths)
        assert any("lookup" in p and "article4" in p for p in paths)

    def test_postcode_lookup_is_get(self):
        for route in app.routes:
            if hasattr(route, "path") and "lookup" in route.path and "postcode" in route.path:
                assert "GET" in route.methods
                break
        else:
            pytest.fail("Postcode lookup route not found")

    def test_flood_lookup_is_get(self):
        for route in app.routes:
            if hasattr(route, "path") and "lookup" in route.path and "flood" in route.path:
                assert "GET" in route.methods
                break
        else:
            pytest.fail("Flood lookup route not found")
