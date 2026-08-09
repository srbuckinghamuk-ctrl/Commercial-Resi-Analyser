import pytest
from unittest.mock import AsyncMock

from app.adapters.base import BaseAdapter
from app.adapters.registry import register_adapter, get_adapter, source_id_from_url, _REGISTRY, _URL_TO_SOURCE
from app.models import CommercialListing, Address, PriceInfo


class FakeAdapter(BaseAdapter):
    async def fetch_listing(self, url: str) -> CommercialListing | None:
        return CommercialListing(
            address=Address(raw="1 Test St, London"),
            price=PriceInfo(amount=50000000),
            use_class="office",
            source_url=url,
            source_name="fake",
        )


class TestRegisterAdapter:
    def setup_method(self):
        _REGISTRY.clear()
        _URL_TO_SOURCE.clear()

    def test_register_adapter_adds_to_registry(self):
        register_adapter("fake", FakeAdapter, ["fake.co.uk"])
        assert get_adapter("fake") is FakeAdapter

    def test_register_adapter_maps_hostnames(self):
        register_adapter("fake", FakeAdapter, ["fake.co.uk", "listings.fake.co.uk"])
        assert source_id_from_url("https://www.fake.co.uk/property/123") == "fake"
        assert source_id_from_url("https://listings.fake.co.uk/lot/456") == "fake"

    def test_source_id_from_url_strips_www(self):
        register_adapter("fake", FakeAdapter, ["fake.co.uk"])
        assert source_id_from_url("https://www.fake.co.uk/listing") == "fake"
        assert source_id_from_url("https://fake.co.uk/listing") == "fake"

    def test_unknown_url_returns_none(self):
        assert source_id_from_url("https://unknown.com/listing") is None

    def test_get_unknown_adapter_returns_none(self):
        assert get_adapter("nonexistent") is None


class TestScrapeEndpointDispatch:
    @pytest.mark.asyncio
    async def test_scrape_with_known_source(self):
        from app.api.app import app
        from httpx import AsyncClient, ASGITransport

        _REGISTRY.clear()
        _URL_TO_SOURCE.clear()
        register_adapter("fake", FakeAdapter, ["fake.co.uk"])

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scrape-url",
                json={"url": "https://www.fake.co.uk/property/123"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is None
        assert data["listing"]["source_url"] == "https://www.fake.co.uk/property/123"

    @pytest.mark.asyncio
    async def test_scrape_with_unknown_source_returns_error(self):
        from app.api.app import app
        from httpx import AsyncClient, ASGITransport

        _REGISTRY.clear()
        _URL_TO_SOURCE.clear()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/scrape-url",
                json={"url": "https://unknown-site.com/property/123"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["listing"] is None
        assert "not supported" in data["error"].lower() or "no adapter" in data["error"].lower()
