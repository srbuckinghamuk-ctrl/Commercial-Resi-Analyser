import pytest
import httpx
import respx

from app.adapters.savills import SavillsAdapter, _parse_listing
from app.models import CommercialListing

SAMPLE_HTML = """
<html>
<head><title>Lot 76 - Savills Auctions</title></head>
<body>
<nav><ol><li>Home</li><li>Auctions</li><li>18 August 2026 - 9:00am</li><li>Lot 76</li></ol></nav>
<h1>Unit 3, Enterprise Park, 14 Mill Lane, Birmingham B11 2AG</h1>
<div class="auction-info">
  <span>Tuesday 18 August 2026 - 9:00am</span>
</div>
<div class="guide-price">Guide Price £185,000</div>
<ul class="key-features">
  <li>Ground floor commercial unit with Class E use</li>
  <li>Total GIA 1,250 sq ft (approx.)</li>
  <li>Well located for transport links and local amenities</li>
  <li>Vacant</li>
</ul>
<dl>
  <dt>Tenure:</dt><dd>Freehold</dd>
  <dt>Tenancy:</dt><dd>Vacant</dd>
  <dt>Property Type:</dt><dd>Retail</dd>
</dl>
<div class="lot-description">
  <p>A ground floor commercial unit suitable for a variety of uses under Class E,
  located on a busy road with good footfall and nearby public transport.</p>
</div>
<div class="gallery">
  <img src="https://images.savills.com/lots/76/photo1.jpg" />
  <img src="https://images.savills.com/lots/76/photo2.jpg" />
</div>
</body>
</html>
"""

SAMPLE_URL = "https://auctions.savills.co.uk/auctions/18-august-2026-240/unit-3-enterprise-park-14-mill-lane-birmingham-b11-2ag-24500"


class TestParseSavillsListing:
    def test_parse_address(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert listing.address.raw == "Unit 3, Enterprise Park, 14 Mill Lane, Birmingham B11 2AG"
        assert listing.address.postcode == "B11 2AG"

    def test_parse_guide_price(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert listing.price.amount == 18500000
        assert listing.price.qualifier == "Guide Price"

    def test_parse_auction_info(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert listing.auction is not None
        assert listing.auction.house == "Savills"
        assert listing.auction.lot_number == "76"
        assert listing.auction.date == "18 August 2026"

    def test_parse_tenure(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert listing.tenure == "freehold"

    def test_parse_use_class(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert listing.use_class == "retail"

    def test_parse_floor_area(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert listing.floor_area_sqft == pytest.approx(1250.0)
        assert listing.floor_area_sqm is not None

    def test_parse_vacant(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert listing.is_vacant is True

    def test_parse_description(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert listing.description is not None
        assert "Class E" in listing.description

    def test_parse_source_fields(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert listing.source_name == "Savills Auctions"
        assert listing.source_url == SAMPLE_URL

    def test_parse_images(self):
        listing = _parse_listing(SAMPLE_HTML, SAMPLE_URL)
        assert listing is not None
        assert len(listing.image_urls) == 2

    def test_parse_empty_html_returns_none(self):
        listing = _parse_listing("<html><body></body></html>", SAMPLE_URL)
        assert listing is None

    def test_parse_tba_price(self):
        html = """
        <html><body>
        <h1>10 High Street, London SW1A 1AA</h1>
        <div>Guide Price TBA</div>
        <nav><ol><li>Lot 5</li></ol></nav>
        </body></html>
        """
        listing = _parse_listing(html, SAMPLE_URL)
        assert listing is not None
        assert listing.price.amount == 0


class TestSavillsAdapter:
    @respx.mock
    @pytest.mark.asyncio
    async def test_fetch_listing_success(self):
        respx.get(SAMPLE_URL).mock(
            return_value=httpx.Response(200, text=SAMPLE_HTML)
        )
        adapter = SavillsAdapter()
        listing = await adapter.fetch_listing(SAMPLE_URL)
        assert listing is not None
        assert isinstance(listing, CommercialListing)

    @respx.mock
    @pytest.mark.asyncio
    async def test_fetch_listing_http_error_returns_none(self):
        respx.get(SAMPLE_URL).mock(
            return_value=httpx.Response(404, text="Not Found")
        )
        adapter = SavillsAdapter()
        listing = await adapter.fetch_listing(SAMPLE_URL)
        assert listing is None
