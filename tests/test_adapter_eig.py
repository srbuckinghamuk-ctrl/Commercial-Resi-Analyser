import pytest
import httpx
import respx

from app.adapters.eig import EigAdapter, _parse_listing
from app.models import CommercialListing

SAMPLE_HTML = """
<html>
<head><title>Office to Let - EG PropertyLink</title></head>
<body>
<h1 class="property-title">First Floor Office, 88 Queen Street, Cardiff, CF10 2GR</h1>
<div class="property-price">
  <span class="price-amount">£185,000</span>
</div>
<div class="property-features">
  <ul>
    <li><strong>Type:</strong> Office</li>
    <li><strong>Size:</strong> 1,800 sq ft</li>
    <li><strong>Tenure:</strong> Leasehold</li>
    <li><strong>EPC:</strong> D</li>
  </ul>
</div>
<div class="property-description">
  <p>First floor office accommodation in a well-connected city centre location.</p>
</div>
<div class="property-gallery">
  <img src="https://images.estatesgazette.com/prop/88queen/1.jpg" />
  <img src="https://images.estatesgazette.com/prop/88queen/2.jpg" />
  <img src="https://images.estatesgazette.com/prop/88queen/3.jpg" />
</div>
</body>
</html>
"""


class TestParseEigListing:
    def test_parse_address(self):
        listing = _parse_listing(SAMPLE_HTML, "https://propertylink.estatesgazette.com/property/details/123")
        assert listing is not None
        assert listing.address.raw == "First Floor Office, 88 Queen Street, Cardiff, CF10 2GR"
        assert listing.address.postcode == "CF10 2GR"

    def test_parse_price(self):
        listing = _parse_listing(SAMPLE_HTML, "https://propertylink.estatesgazette.com/property/details/123")
        assert listing is not None
        assert listing.price.amount == 18500000

    def test_parse_use_class(self):
        listing = _parse_listing(SAMPLE_HTML, "https://propertylink.estatesgazette.com/property/details/123")
        assert listing is not None
        assert listing.use_class == "office"

    def test_parse_floor_area(self):
        listing = _parse_listing(SAMPLE_HTML, "https://propertylink.estatesgazette.com/property/details/123")
        assert listing is not None
        assert listing.floor_area_sqft == pytest.approx(1800.0)

    def test_parse_tenure(self):
        listing = _parse_listing(SAMPLE_HTML, "https://propertylink.estatesgazette.com/property/details/123")
        assert listing is not None
        assert listing.tenure == "leasehold"

    def test_parse_epc(self):
        listing = _parse_listing(SAMPLE_HTML, "https://propertylink.estatesgazette.com/property/details/123")
        assert listing is not None
        assert listing.epc_rating == "D"

    def test_parse_images(self):
        listing = _parse_listing(SAMPLE_HTML, "https://propertylink.estatesgazette.com/property/details/123")
        assert listing is not None
        assert len(listing.image_urls) == 3

    def test_parse_source_fields(self):
        listing = _parse_listing(SAMPLE_HTML, "https://propertylink.estatesgazette.com/property/details/123")
        assert listing is not None
        assert listing.source_name == "Estates Gazette"

    def test_parse_empty_html_returns_none(self):
        listing = _parse_listing("<html><body></body></html>", "https://egi.co.uk/prop/1")
        assert listing is None


class TestEigAdapter:
    @respx.mock
    @pytest.mark.asyncio
    async def test_fetch_listing_success(self):
        respx.get("https://propertylink.estatesgazette.com/property/details/123").mock(
            return_value=httpx.Response(200, text=SAMPLE_HTML)
        )
        adapter = EigAdapter()
        listing = await adapter.fetch_listing("https://propertylink.estatesgazette.com/property/details/123")
        assert listing is not None
        assert isinstance(listing, CommercialListing)

    @respx.mock
    @pytest.mark.asyncio
    async def test_fetch_listing_http_error_returns_none(self):
        respx.get("https://propertylink.estatesgazette.com/property/details/999").mock(
            return_value=httpx.Response(403, text="Forbidden")
        )
        adapter = EigAdapter()
        listing = await adapter.fetch_listing("https://propertylink.estatesgazette.com/property/details/999")
        assert listing is None
