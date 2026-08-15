import pytest
import httpx
import respx

from app.adapters.rightmove_commercial import RightmoveCommercialAdapter, _parse_listing
from app.models import CommercialListing

SAMPLE_HTML = """
<html>
<head><title>Office for sale - Rightmove</title></head>
<body>
<h1 class="_2uQQ3SV0eMHL1P6t5ZDo2q">Suite 3, 45 High Street, Manchester, M1 4BT</h1>
<div class="_1gfnqJ3Vtd1z40MlC0MzXu">
  <span>£500,000</span>
</div>
<div class="VhFCX8rElYAmBGorzGaKk">
  <div class="_3OGW_s5TH6aUqi4uHum5Gy">
    <span>Office</span>
  </div>
  <div class="_3OGW_s5TH6aUqi4uHum5Gy">
    <span>2,150 sq ft</span>
  </div>
  <div class="_3OGW_s5TH6aUqi4uHum5Gy">
    <span>Freehold</span>
  </div>
</div>
<div class="STw8udCxUaBUMfOOZu0iL">
  <p>A well-presented office suite in a prime location.</p>
</div>
<div class="_2TqQt_daaay9fGe3IqXnKj">
  <img src="https://media.rightmove.co.uk/1k/1234/photo1.jpg" />
  <img src="https://media.rightmove.co.uk/1k/1234/photo2.jpg" />
</div>
</body>
</html>
"""


class TestParseRightmoveListing:
    def test_parse_address(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html")
        assert listing is not None
        assert listing.address.raw == "Suite 3, 45 High Street, Manchester, M1 4BT"
        assert listing.address.postcode == "M1 4BT"

    def test_parse_price(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html")
        assert listing is not None
        assert listing.price.amount == 50000000

    def test_parse_floor_area(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html")
        assert listing is not None
        assert listing.floor_area_sqft == pytest.approx(2150.0)

    def test_parse_tenure(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html")
        assert listing is not None
        assert listing.tenure == "freehold"

    def test_parse_use_class_from_type(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html")
        assert listing is not None
        assert listing.use_class == "office"

    def test_parse_description(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html")
        assert listing is not None
        assert "well-presented office" in listing.description

    def test_parse_images(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html")
        assert listing is not None
        assert len(listing.image_urls) == 2

    def test_parse_source_fields(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html")
        assert listing is not None
        assert listing.source_name == "Rightmove Commercial"
        assert listing.source_url == "https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html"

    def test_parse_empty_html_returns_none(self):
        listing = _parse_listing("<html><body></body></html>", "https://www.rightmove.co.uk/property/1")
        assert listing is None


class TestRightmoveCommercialAdapter:
    @respx.mock
    @pytest.mark.asyncio
    async def test_fetch_listing_success(self):
        respx.get("https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html").mock(
            return_value=httpx.Response(200, text=SAMPLE_HTML)
        )
        adapter = RightmoveCommercialAdapter()
        listing = await adapter.fetch_listing("https://www.rightmove.co.uk/commercial-property-for-sale/property-12345.html")
        assert listing is not None
        assert isinstance(listing, CommercialListing)
        assert listing.address.raw == "Suite 3, 45 High Street, Manchester, M1 4BT"

    @respx.mock
    @pytest.mark.asyncio
    async def test_fetch_listing_http_error_returns_none(self):
        respx.get("https://www.rightmove.co.uk/commercial-property-for-sale/property-99999.html").mock(
            return_value=httpx.Response(404, text="Not Found")
        )
        adapter = RightmoveCommercialAdapter()
        listing = await adapter.fetch_listing("https://www.rightmove.co.uk/commercial-property-for-sale/property-99999.html")
        assert listing is None
