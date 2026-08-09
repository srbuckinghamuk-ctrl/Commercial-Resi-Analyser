import pytest
import httpx
import respx

from app.adapters.allsop import AllsopAdapter, _parse_listing
from app.models import CommercialListing

SAMPLE_HTML = """
<html>
<head><title>Lot 42 - Allsop Commercial Auctions</title></head>
<body>
<h1 class="lot-title">Ground Floor Retail Unit, 12 Bridge Street, Bristol, BS1 2AA</h1>
<div class="lot-guide-price">
  <span class="price-value">£275,000</span>
  <span class="price-label">Guide Price*</span>
</div>
<div class="lot-details">
  <div class="detail-item">
    <span class="detail-label">Lot Number</span>
    <span class="detail-value">42</span>
  </div>
  <div class="detail-item">
    <span class="detail-label">Property Type</span>
    <span class="detail-value">Retail</span>
  </div>
  <div class="detail-item">
    <span class="detail-label">Tenure</span>
    <span class="detail-value">Freehold</span>
  </div>
  <div class="detail-item">
    <span class="detail-label">Floor Area</span>
    <span class="detail-value">950 sq ft (88.3 sq m)</span>
  </div>
</div>
<div class="lot-description">
  <p>A well-located ground floor retail unit with Class E use.</p>
</div>
<div class="auction-date">Auction Date: 15th September 2026</div>
<div class="lot-images">
  <img src="https://images.allsop.co.uk/lot42/photo1.jpg" />
</div>
</body>
</html>
"""


class TestParseAllsopListing:
    def test_parse_address(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.allsop.co.uk/lot/commercial/42")
        assert listing is not None
        assert listing.address.raw == "Ground Floor Retail Unit, 12 Bridge Street, Bristol, BS1 2AA"
        assert listing.address.postcode == "BS1 2AA"

    def test_parse_price_guide(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.allsop.co.uk/lot/commercial/42")
        assert listing is not None
        assert listing.price.amount == 27500000
        assert listing.price.qualifier == "Guide Price"

    def test_parse_auction_info(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.allsop.co.uk/lot/commercial/42")
        assert listing is not None
        assert listing.auction is not None
        assert listing.auction.house == "Allsop"
        assert listing.auction.lot_number == "42"

    def test_parse_retail_use_class(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.allsop.co.uk/lot/commercial/42")
        assert listing is not None
        assert listing.use_class == "retail"

    def test_parse_floor_area(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.allsop.co.uk/lot/commercial/42")
        assert listing is not None
        assert listing.floor_area_sqft == pytest.approx(950.0)

    def test_parse_source_fields(self):
        listing = _parse_listing(SAMPLE_HTML, "https://www.allsop.co.uk/lot/commercial/42")
        assert listing is not None
        assert listing.source_name == "Allsop"

    def test_parse_empty_html_returns_none(self):
        listing = _parse_listing("<html><body></body></html>", "https://www.allsop.co.uk/lot/1")
        assert listing is None


class TestAllsopAdapter:
    @respx.mock
    @pytest.mark.asyncio
    async def test_fetch_listing_success(self):
        respx.get("https://www.allsop.co.uk/lot/commercial/42").mock(
            return_value=httpx.Response(200, text=SAMPLE_HTML)
        )
        adapter = AllsopAdapter()
        listing = await adapter.fetch_listing("https://www.allsop.co.uk/lot/commercial/42")
        assert listing is not None
        assert isinstance(listing, CommercialListing)

    @respx.mock
    @pytest.mark.asyncio
    async def test_fetch_listing_http_error_returns_none(self):
        respx.get("https://www.allsop.co.uk/lot/commercial/999").mock(
            return_value=httpx.Response(404, text="Not Found")
        )
        adapter = AllsopAdapter()
        listing = await adapter.fetch_listing("https://www.allsop.co.uk/lot/commercial/999")
        assert listing is None
