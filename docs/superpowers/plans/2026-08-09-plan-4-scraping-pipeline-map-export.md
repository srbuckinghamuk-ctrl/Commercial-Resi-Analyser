# Plan 4: Scraping, Pipeline, Map & Export

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the commercial property scraping layer (adapter registry + 3 initial adapters), replace the Pipeline placeholder with a 7-stage Kanban dashboard, add a Leaflet map with project markers and overlay indicators, and wire up PDF/Excel export for eligibility reports and investor summaries.

**Architecture:** The backend adapter layer uses a registry pattern: each adapter module self-registers its source ID and URL hostname patterns on import, and the `/api/v1/scrape-url` endpoint dispatches to the matching adapter via hostname lookup. Adapters use `httpx` + `BeautifulSoup4` to fetch and parse commercial listing pages, returning normalised `CommercialListing` objects. On the frontend, the Pipeline tab becomes a Kanban board with 7 stage columns and deal cards that trigger stage changes via the existing `changeStage` API. The Map tab uses `react-leaflet` with OpenStreetMap tiles, placing project markers by looking up postcodes for coordinates at render time. The Export tab uses `jsPDF` and `xlsx` (both already installed) to generate downloadable PDR eligibility reports and financial appraisal spreadsheets.

**Tech Stack:** Python 3.12, FastAPI, httpx, BeautifulSoup4, lxml, respx (test mocking), React 19, TypeScript 5.9, Vite 8, Tailwind 4, Vitest 4, Leaflet + react-leaflet, jsPDF 4.2, xlsx/SheetJS 0.18.

## Global Constraints

- Python >= 3.12, Node >= 20
- All monetary values stored as integer pence (`BigInteger` in ORM, `number` in TypeScript)
- All UUIDs use `uuid.uuid4()` (Python) or `crypto.randomUUID()` (TypeScript)
- Frontend: native `fetch` for HTTP, `useState`/`useMemo`/`useCallback` for state (no external state lib)
- API prefix: `/api/v1`
- Existing backend endpoints consumed: `POST /api/v1/scrape-url`, `POST /api/v1/projects/{id}/stage`, `GET /api/v1/projects`, `GET /api/v1/lookup/postcode/{postcode}`, `GET /api/v1/lookup/flood/{postcode}`, `GET /api/v1/lookup/article4/{lpa_code}`, `GET /api/v1/eligibility/{project_id}`, `GET /api/v1/appraisals/{project_id}`
- Existing frontend API functions consumed: `listProjects()`, `changeStage()`, `lookupPostcode()`, `lookupFlood()`, `lookupArticle4()`, `getEligibility()`, `getAppraisal()`, `scrapeUrl()` from `frontend/src/lib/api.ts`
- Existing types consumed: `Project`, `PipelineStage`, `PIPELINE_STAGES`, `EligibilityVerdict`, `EligibilityAssessment`, `FinancialAppraisal`, `PostcodeLookup`, `FloodRisk`, `Article4Data` from `frontend/src/types.ts`
- Adapter contract: every adapter extends `BaseAdapter` from `app/adapters/base.py` and implements `async fetch_listing(url: str) -> CommercialListing | None`
- Tests use `respx` for mocking HTTP calls and `pytest.mark.asyncio` for async tests
- Frontend tests use Vitest with `vi.fn()` for mocking

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `tests/test_adapter_registry.py` | Tests for adapter registration, URL resolution, and scrape endpoint dispatch |
| `app/adapters/rightmove_commercial.py` | Rightmove Commercial listing adapter |
| `tests/test_adapter_rightmove.py` | Tests for Rightmove adapter parsing |
| `app/adapters/allsop.py` | Allsop commercial auction adapter |
| `tests/test_adapter_allsop.py` | Tests for Allsop adapter parsing |
| `app/adapters/eig.py` | Estates Gazette (EIG) commercial listing adapter |
| `tests/test_adapter_eig.py` | Tests for EIG adapter parsing |
| `frontend/src/components/ProjectCard.tsx` | Deal card component for Kanban board |
| `frontend/src/lib/pipeline-helpers.ts` | Filter and sort logic for pipeline projects |
| `frontend/src/lib/pipeline-helpers.test.ts` | Tests for pipeline filter/sort helpers |
| `frontend/src/lib/export-pdf.ts` | PDF report generation with jsPDF |
| `frontend/src/lib/export-pdf.test.ts` | Tests for PDF content assembly |
| `frontend/src/lib/export-excel.ts` | Excel spreadsheet generation with xlsx |
| `frontend/src/lib/export-excel.test.ts` | Tests for Excel data formatting |

### Modified files

| File | Change |
|------|--------|
| `app/adapters/registry.py` | Add `register_adapter()` function, auto-import adapter modules |
| `app/api/app.py` | Wire scrape endpoint to dispatch through adapter registry |
| `frontend/src/components/Pipeline.tsx` | Replace placeholder with 7-column Kanban dashboard with filters and sorting |
| `frontend/src/components/PropertyMap.tsx` | Replace placeholder with Leaflet map, markers, and overlay indicators |
| `frontend/src/components/ExportPage.tsx` | Replace placeholder with export UI for PDF and Excel downloads |
| `frontend/src/App.tsx` | Pass `projects`, `selectedProject`, and `onSelectProject` to PropertyMap and ExportPage |

---

### Task 1: Adapter Registry & Scrape Endpoint Dispatch

**Files:**
- Modify: `app/adapters/registry.py`
- Modify: `app/api/app.py:293-300`
- Create: `tests/test_adapter_registry.py`

**Interfaces:**
- Consumes: `BaseAdapter` from `app/adapters/base.py`, `CommercialListing` and `ApiResponse` and `ScrapeUrlRequest` from `app/models`
- Produces:
  - `register_adapter(source_id: str, adapter_cls: type[BaseAdapter], hostnames: list[str]) -> None`
  - `get_adapter(source_id: str) -> type[BaseAdapter] | None` (already exists)
  - `source_id_from_url(url: str) -> str | None` (already exists)
  - `scrape_url_endpoint(request: ScrapeUrlRequest) -> ApiResponse` (updated to dispatch)

- [ ] **Step 1: Write registry and dispatch tests**

Create `tests/test_adapter_registry.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_adapter_registry.py -v`
Expected: FAIL — `register_adapter` not found, scrape endpoint returns hardcoded error.

- [ ] **Step 3: Implement `register_adapter` in registry**

Replace contents of `app/adapters/registry.py`:

```python
from __future__ import annotations

from urllib.parse import urlparse

from app.adapters.base import BaseAdapter


_REGISTRY: dict[str, type[BaseAdapter]] = {}

_URL_TO_SOURCE: dict[str, str] = {}


def register_adapter(
    source_id: str,
    adapter_cls: type[BaseAdapter],
    hostnames: list[str],
) -> None:
    _REGISTRY[source_id] = adapter_cls
    for hostname in hostnames:
        _URL_TO_SOURCE[hostname] = source_id


def get_adapter(source_id: str) -> type[BaseAdapter] | None:
    return _REGISTRY.get(source_id)


def source_id_from_url(url: str) -> str | None:
    hostname = urlparse(url).hostname or ""
    hostname = hostname.removeprefix("www.")
    return _URL_TO_SOURCE.get(hostname)
```

- [ ] **Step 4: Wire scrape endpoint dispatch in `app/api/app.py`**

Replace the scrape endpoint (lines 293–300) with:

```python
# --- Scrape Router ---

scrape_router = APIRouter()


@scrape_router.post("/scrape-url", response_model=ApiResponse)
async def scrape_url_endpoint(request: ScrapeUrlRequest):
    from app.adapters.registry import source_id_from_url, get_adapter

    source_id = source_id_from_url(request.url)
    if source_id is None:
        return ApiResponse(error=f"No adapter for this URL. Supported sources: use a commercial property listing URL from a supported site.")

    adapter_cls = get_adapter(source_id)
    if adapter_cls is None:
        return ApiResponse(error=f"No adapter registered for source '{source_id}'.")

    adapter = adapter_cls()
    try:
        listing = await adapter.fetch_listing(request.url)
    except Exception as exc:
        return ApiResponse(error=f"Scrape failed: {exc}")

    if listing is None:
        return ApiResponse(error="Could not extract listing data from this page.")

    return ApiResponse(listing=listing)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_adapter_registry.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/adapters/registry.py app/api/app.py tests/test_adapter_registry.py
git commit -m "feat: add adapter registration and scrape endpoint dispatch"
```

---

### Task 2: Rightmove Commercial Adapter

**Files:**
- Create: `app/adapters/rightmove_commercial.py`
- Create: `tests/test_adapter_rightmove.py`

**Interfaces:**
- Consumes: `BaseAdapter` from `app/adapters/base.py`, `CommercialListing`, `Address`, `PriceInfo` from `app/models`, `register_adapter` from `app/adapters/registry`
- Produces: `RightmoveCommercialAdapter` (extends `BaseAdapter`), registered with source_id `"rightmove_commercial"` and hostname `"rightmove.co.uk"`

- [ ] **Step 1: Write adapter parsing tests**

Create `tests/test_adapter_rightmove.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_adapter_rightmove.py -v`
Expected: FAIL — module `app.adapters.rightmove_commercial` not found.

- [ ] **Step 3: Implement Rightmove Commercial adapter**

Create `app/adapters/rightmove_commercial.py`:

```python
from __future__ import annotations

import re

import httpx
from bs4 import BeautifulSoup

from app.adapters.base import BaseAdapter
from app.adapters.registry import register_adapter
from app.models import Address, CommercialListing, PriceInfo, Tenure, UseClass


_POSTCODE_RE = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}", re.IGNORECASE)

_PRICE_RE = re.compile(r"£([\d,]+)")

_SQFT_RE = re.compile(r"([\d,]+)\s*sq\s*ft", re.IGNORECASE)

_TYPE_TO_USE_CLASS: dict[str, UseClass] = {
    "office": UseClass.OFFICE,
    "retail": UseClass.RETAIL,
    "shop": UseClass.RETAIL,
    "light industrial": UseClass.LIGHT_INDUSTRIAL,
    "industrial": UseClass.LIGHT_INDUSTRIAL,
    "restaurant": UseClass.RESTAURANT_CAFE,
    "cafe": UseClass.RESTAURANT_CAFE,
    "takeaway": UseClass.TAKEAWAY,
    "agricultural": UseClass.AGRICULTURAL,
    "land": UseClass.AGRICULTURAL,
}

_TENURE_MAP: dict[str, Tenure] = {
    "freehold": Tenure.FREEHOLD,
    "leasehold": Tenure.LEASEHOLD,
}


def _extract_postcode(text: str) -> str | None:
    match = _POSTCODE_RE.search(text)
    return match.group(0).strip().upper() if match else None


def _parse_price(text: str) -> int | None:
    match = _PRICE_RE.search(text.replace(",", "").replace(" ", ""))
    if not match:
        match = _PRICE_RE.search(text)
    if match:
        digits = match.group(1).replace(",", "")
        try:
            return int(digits) * 100
        except ValueError:
            return None
    return None


def _detect_use_class(text: str) -> UseClass:
    lower = text.lower().strip()
    for keyword, use_class in _TYPE_TO_USE_CLASS.items():
        if keyword in lower:
            return use_class
    return UseClass.UNKNOWN


def _detect_tenure(text: str) -> Tenure:
    lower = text.lower().strip()
    for keyword, tenure in _TENURE_MAP.items():
        if keyword in lower:
            return tenure
    return Tenure.UNKNOWN


def _parse_sqft(text: str) -> float | None:
    match = _SQFT_RE.search(text.replace(",", ""))
    if match:
        try:
            return float(match.group(1).replace(",", ""))
        except ValueError:
            return None
    return None


def _parse_listing(html: str, url: str) -> CommercialListing | None:
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    if not h1:
        return None
    address_raw = h1.get_text(strip=True)
    if not address_raw:
        return None

    postcode = _extract_postcode(address_raw)

    price_pence: int = 0
    price_el = soup.find("div", class_=_PRICE_RE) or soup.find("span", string=_PRICE_RE)
    if price_el is None:
        for el in soup.find_all(["div", "span"]):
            txt = el.get_text()
            parsed = _parse_price(txt)
            if parsed and parsed > 0:
                price_pence = parsed
                break
    else:
        price_pence = _parse_price(price_el.get_text()) or 0

    use_class = UseClass.UNKNOWN
    tenure = Tenure.UNKNOWN
    floor_area_sqft: float | None = None

    for detail_el in soup.find_all(["div", "span", "li"]):
        txt = detail_el.get_text(strip=True)
        if not txt or len(txt) > 200:
            continue

        if use_class == UseClass.UNKNOWN:
            detected = _detect_use_class(txt)
            if detected != UseClass.UNKNOWN:
                use_class = detected

        if tenure == Tenure.UNKNOWN:
            detected_tenure = _detect_tenure(txt)
            if detected_tenure != Tenure.UNKNOWN:
                tenure = detected_tenure

        if floor_area_sqft is None:
            floor_area_sqft = _parse_sqft(txt)

    description = ""
    desc_el = soup.find("div", class_=re.compile(r"STw8|description", re.IGNORECASE))
    if desc_el:
        description = desc_el.get_text(strip=True)
    else:
        for p in soup.find_all("p"):
            txt = p.get_text(strip=True)
            if len(txt) > 50:
                description = txt
                break

    image_urls: list[str] = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if "rightmove" in src and src.startswith("http"):
            image_urls.append(src)

    floor_area_sqm = round(floor_area_sqft * 0.092903, 1) if floor_area_sqft else None

    return CommercialListing(
        address=Address(raw=address_raw, postcode=postcode),
        price=PriceInfo(amount=price_pence),
        use_class=use_class,
        floor_area_sqft=floor_area_sqft,
        floor_area_sqm=floor_area_sqm,
        tenure=tenure,
        source_url=url,
        source_name="Rightmove Commercial",
        image_urls=image_urls,
        description=description or None,
    )


class RightmoveCommercialAdapter(BaseAdapter):
    async def fetch_listing(self, url: str) -> CommercialListing | None:
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=15.0,
                headers={"User-Agent": "Mozilla/5.0 (compatible; CommercialResiBot/1.0)"},
            ) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return None
                return _parse_listing(resp.text, url)
        except httpx.HTTPError:
            return None


register_adapter(
    "rightmove_commercial",
    RightmoveCommercialAdapter,
    ["rightmove.co.uk"],
)
```

- [ ] **Step 4: Import adapter module in registry to trigger registration**

Add to the bottom of `app/adapters/registry.py`:

```python
def _auto_register() -> None:
    import app.adapters.rightmove_commercial  # noqa: F401


_auto_register()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_adapter_rightmove.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/adapters/rightmove_commercial.py tests/test_adapter_rightmove.py app/adapters/registry.py
git commit -m "feat: add Rightmove Commercial scraping adapter"
```

---

### Task 3: Allsop Commercial Adapter

**Files:**
- Create: `app/adapters/allsop.py`
- Create: `tests/test_adapter_allsop.py`
- Modify: `app/adapters/registry.py` (add import to `_auto_register`)

**Interfaces:**
- Consumes: `BaseAdapter`, `register_adapter`, `CommercialListing`, `Address`, `PriceInfo`, `AuctionInfo` from `app/models`
- Produces: `AllsopAdapter` (extends `BaseAdapter`), registered with source_id `"allsop"` and hostname `"allsop.co.uk"`

- [ ] **Step 1: Write adapter parsing tests**

Create `tests/test_adapter_allsop.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_adapter_allsop.py -v`
Expected: FAIL — module `app.adapters.allsop` not found.

- [ ] **Step 3: Implement Allsop adapter**

Create `app/adapters/allsop.py`:

```python
from __future__ import annotations

import re

import httpx
from bs4 import BeautifulSoup

from app.adapters.base import BaseAdapter
from app.adapters.registry import register_adapter
from app.models import Address, AuctionInfo, CommercialListing, PriceInfo, Tenure, UseClass


_POSTCODE_RE = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}", re.IGNORECASE)
_PRICE_RE = re.compile(r"£([\d,]+)")
_SQFT_RE = re.compile(r"([\d,]+)\s*sq\s*ft", re.IGNORECASE)
_LOT_RE = re.compile(r"(?:lot\s*(?:number)?:?\s*)(\d+)", re.IGNORECASE)

_TYPE_TO_USE_CLASS: dict[str, UseClass] = {
    "office": UseClass.OFFICE,
    "retail": UseClass.RETAIL,
    "shop": UseClass.RETAIL,
    "light industrial": UseClass.LIGHT_INDUSTRIAL,
    "industrial": UseClass.LIGHT_INDUSTRIAL,
    "restaurant": UseClass.RESTAURANT_CAFE,
    "cafe": UseClass.RESTAURANT_CAFE,
    "takeaway": UseClass.TAKEAWAY,
    "agricultural": UseClass.AGRICULTURAL,
}

_TENURE_MAP: dict[str, Tenure] = {
    "freehold": Tenure.FREEHOLD,
    "leasehold": Tenure.LEASEHOLD,
}


def _parse_listing(html: str, url: str) -> CommercialListing | None:
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    if not h1:
        return None
    address_raw = h1.get_text(strip=True)
    if not address_raw:
        return None

    postcode_match = _POSTCODE_RE.search(address_raw)
    postcode = postcode_match.group(0).strip().upper() if postcode_match else None

    price_pence = 0
    price_qualifier: str | None = None
    price_el = soup.find(class_=re.compile(r"price-value|guide-price|lot-price", re.IGNORECASE))
    if price_el:
        price_text = price_el.get_text()
        match = _PRICE_RE.search(price_text)
        if match:
            price_pence = int(match.group(1).replace(",", "")) * 100
    if price_pence == 0:
        for el in soup.find_all(["div", "span"]):
            txt = el.get_text()
            match = _PRICE_RE.search(txt)
            if match:
                price_pence = int(match.group(1).replace(",", "")) * 100
                break

    label_el = soup.find(class_=re.compile(r"price-label", re.IGNORECASE))
    if label_el:
        qualifier_text = label_el.get_text(strip=True).rstrip("*")
        if qualifier_text:
            price_qualifier = qualifier_text

    lot_number: str | None = None
    for el in soup.find_all(["span", "div"]):
        txt = el.get_text(strip=True)
        if el.find_previous(string=re.compile(r"lot\s*number", re.IGNORECASE)):
            try:
                lot_number = str(int(txt))
                break
            except ValueError:
                pass
        lot_match = _LOT_RE.search(txt)
        if lot_match:
            lot_number = lot_match.group(1)
            break
    if lot_number is None:
        for el in soup.find_all(class_=re.compile(r"detail-value")):
            prev_label = el.find_previous(class_=re.compile(r"detail-label"))
            if prev_label and "lot" in prev_label.get_text(strip=True).lower():
                lot_number = el.get_text(strip=True)
                break

    auction_date: str | None = None
    date_el = soup.find(class_=re.compile(r"auction.?date", re.IGNORECASE))
    if date_el:
        auction_date = date_el.get_text(strip=True)

    use_class = UseClass.UNKNOWN
    tenure = Tenure.UNKNOWN
    floor_area_sqft: float | None = None

    for el in soup.find_all(class_=re.compile(r"detail-value")):
        txt = el.get_text(strip=True)
        prev_label = el.find_previous(class_=re.compile(r"detail-label"))
        label_txt = prev_label.get_text(strip=True).lower() if prev_label else ""

        if "type" in label_txt and use_class == UseClass.UNKNOWN:
            for keyword, uc in _TYPE_TO_USE_CLASS.items():
                if keyword in txt.lower():
                    use_class = uc
                    break

        if "tenure" in label_txt and tenure == Tenure.UNKNOWN:
            for keyword, t in _TENURE_MAP.items():
                if keyword in txt.lower():
                    tenure = t
                    break

        if "area" in label_txt and floor_area_sqft is None:
            sqft_match = _SQFT_RE.search(txt.replace(",", ""))
            if sqft_match:
                try:
                    floor_area_sqft = float(sqft_match.group(1).replace(",", ""))
                except ValueError:
                    pass

    description: str | None = None
    desc_el = soup.find(class_=re.compile(r"description", re.IGNORECASE))
    if desc_el:
        description = desc_el.get_text(strip=True) or None

    image_urls: list[str] = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if src.startswith("http") and "allsop" in src:
            image_urls.append(src)

    floor_area_sqm = round(floor_area_sqft * 0.092903, 1) if floor_area_sqft else None

    return CommercialListing(
        address=Address(raw=address_raw, postcode=postcode),
        price=PriceInfo(amount=price_pence, qualifier=price_qualifier),
        use_class=use_class,
        floor_area_sqft=floor_area_sqft,
        floor_area_sqm=floor_area_sqm,
        tenure=tenure,
        source_url=url,
        source_name="Allsop",
        auction=AuctionInfo(
            house="Allsop",
            lot_number=lot_number,
            date=auction_date,
        ),
        image_urls=image_urls,
        description=description,
    )


class AllsopAdapter(BaseAdapter):
    async def fetch_listing(self, url: str) -> CommercialListing | None:
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=15.0,
                headers={"User-Agent": "Mozilla/5.0 (compatible; CommercialResiBot/1.0)"},
            ) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return None
                return _parse_listing(resp.text, url)
        except httpx.HTTPError:
            return None


register_adapter("allsop", AllsopAdapter, ["allsop.co.uk"])
```

- [ ] **Step 4: Add Allsop import to auto-register**

In `app/adapters/registry.py`, update `_auto_register`:

```python
def _auto_register() -> None:
    import app.adapters.rightmove_commercial  # noqa: F401
    import app.adapters.allsop  # noqa: F401
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_adapter_allsop.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/adapters/allsop.py tests/test_adapter_allsop.py app/adapters/registry.py
git commit -m "feat: add Allsop commercial auction adapter"
```

---

### Task 4: EIG (Estates Gazette) Adapter

**Files:**
- Create: `app/adapters/eig.py`
- Create: `tests/test_adapter_eig.py`
- Modify: `app/adapters/registry.py` (add import to `_auto_register`)

**Interfaces:**
- Consumes: `BaseAdapter`, `register_adapter`, `CommercialListing`, `Address`, `PriceInfo` from `app/models`
- Produces: `EigAdapter` (extends `BaseAdapter`), registered with source_id `"eig"` and hostnames `["propertylink.estatesgazette.com", "egi.co.uk"]`

- [ ] **Step 1: Write adapter parsing tests**

Create `tests/test_adapter_eig.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_adapter_eig.py -v`
Expected: FAIL — module `app.adapters.eig` not found.

- [ ] **Step 3: Implement EIG adapter**

Create `app/adapters/eig.py`:

```python
from __future__ import annotations

import re

import httpx
from bs4 import BeautifulSoup

from app.adapters.base import BaseAdapter
from app.adapters.registry import register_adapter
from app.models import Address, CommercialListing, PriceInfo, Tenure, UseClass


_POSTCODE_RE = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}", re.IGNORECASE)
_PRICE_RE = re.compile(r"£([\d,]+)")
_SQFT_RE = re.compile(r"([\d,]+)\s*sq\s*ft", re.IGNORECASE)

_TYPE_TO_USE_CLASS: dict[str, UseClass] = {
    "office": UseClass.OFFICE,
    "retail": UseClass.RETAIL,
    "shop": UseClass.RETAIL,
    "light industrial": UseClass.LIGHT_INDUSTRIAL,
    "industrial": UseClass.LIGHT_INDUSTRIAL,
    "restaurant": UseClass.RESTAURANT_CAFE,
    "cafe": UseClass.RESTAURANT_CAFE,
    "takeaway": UseClass.TAKEAWAY,
    "agricultural": UseClass.AGRICULTURAL,
}

_TENURE_MAP: dict[str, Tenure] = {
    "freehold": Tenure.FREEHOLD,
    "leasehold": Tenure.LEASEHOLD,
}


def _parse_listing(html: str, url: str) -> CommercialListing | None:
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    if not h1:
        return None
    address_raw = h1.get_text(strip=True)
    if not address_raw:
        return None

    postcode_match = _POSTCODE_RE.search(address_raw)
    postcode = postcode_match.group(0).strip().upper() if postcode_match else None

    price_pence = 0
    for el in soup.find_all(["span", "div"], class_=re.compile(r"price", re.IGNORECASE)):
        txt = el.get_text()
        match = _PRICE_RE.search(txt)
        if match:
            price_pence = int(match.group(1).replace(",", "")) * 100
            break

    use_class = UseClass.UNKNOWN
    tenure = Tenure.UNKNOWN
    floor_area_sqft: float | None = None
    epc_rating: str | None = None

    for li in soup.find_all("li"):
        txt = li.get_text(strip=True)
        lower = txt.lower()

        if "type:" in lower and use_class == UseClass.UNKNOWN:
            value = txt.split(":", 1)[-1].strip()
            for keyword, uc in _TYPE_TO_USE_CLASS.items():
                if keyword in value.lower():
                    use_class = uc
                    break

        if "size:" in lower and floor_area_sqft is None:
            value = txt.split(":", 1)[-1].strip()
            sqft_match = _SQFT_RE.search(value.replace(",", ""))
            if sqft_match:
                try:
                    floor_area_sqft = float(sqft_match.group(1).replace(",", ""))
                except ValueError:
                    pass

        if "tenure:" in lower and tenure == Tenure.UNKNOWN:
            value = txt.split(":", 1)[-1].strip()
            for keyword, t in _TENURE_MAP.items():
                if keyword in value.lower():
                    tenure = t
                    break

        if "epc:" in lower and epc_rating is None:
            epc_rating = txt.split(":", 1)[-1].strip().upper()
            if len(epc_rating) > 2:
                epc_rating = epc_rating[0] if epc_rating[0].isalpha() else None

    description: str | None = None
    desc_el = soup.find(class_=re.compile(r"description", re.IGNORECASE))
    if desc_el:
        description = desc_el.get_text(strip=True) or None

    image_urls: list[str] = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if src.startswith("http") and ("estatesgazette" in src or "egi" in src):
            image_urls.append(src)

    floor_area_sqm = round(floor_area_sqft * 0.092903, 1) if floor_area_sqft else None

    return CommercialListing(
        address=Address(raw=address_raw, postcode=postcode),
        price=PriceInfo(amount=price_pence),
        use_class=use_class,
        floor_area_sqft=floor_area_sqft,
        floor_area_sqm=floor_area_sqm,
        tenure=tenure,
        epc_rating=epc_rating,
        source_url=url,
        source_name="Estates Gazette",
        image_urls=image_urls,
        description=description,
    )


class EigAdapter(BaseAdapter):
    async def fetch_listing(self, url: str) -> CommercialListing | None:
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=15.0,
                headers={"User-Agent": "Mozilla/5.0 (compatible; CommercialResiBot/1.0)"},
            ) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return None
                return _parse_listing(resp.text, url)
        except httpx.HTTPError:
            return None


register_adapter("eig", EigAdapter, ["propertylink.estatesgazette.com", "egi.co.uk"])
```

- [ ] **Step 4: Add EIG import to auto-register**

In `app/adapters/registry.py`, update `_auto_register`:

```python
def _auto_register() -> None:
    import app.adapters.rightmove_commercial  # noqa: F401
    import app.adapters.allsop  # noqa: F401
    import app.adapters.eig  # noqa: F401
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_adapter_eig.py -v`
Expected: PASS

- [ ] **Step 6: Run all adapter tests together**

Run: `pytest tests/test_adapter_registry.py tests/test_adapter_rightmove.py tests/test_adapter_allsop.py tests/test_adapter_eig.py -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add app/adapters/eig.py tests/test_adapter_eig.py app/adapters/registry.py
git commit -m "feat: add Estates Gazette (EIG) commercial adapter"
```

---

### Task 5: Pipeline Kanban Dashboard

**Files:**
- Create: `frontend/src/lib/pipeline-helpers.ts`
- Create: `frontend/src/lib/pipeline-helpers.test.ts`
- Create: `frontend/src/components/ProjectCard.tsx`
- Modify: `frontend/src/components/Pipeline.tsx`
- Modify: `frontend/src/App.tsx:106-108` (add `loadProjects` callback prop)

**Interfaces:**
- Consumes: `Project`, `PipelineStage`, `PIPELINE_STAGES`, `EligibilityVerdict`, `UseClass` from `../types`, `changeStage`, `listProjects`, `getEligibility`, `getAppraisal`, `deleteProject` from `../lib/api`
- Produces:
  - `filterProjects(projects: Project[], filters: PipelineFilters): Project[]`
  - `sortProjects(projects: Project[], sortBy: SortField, sortDir: SortDirection): Project[]`
  - `PipelineFilters` type: `{ stage: PipelineStage | 'all'; useClass: UseClass | 'all' }`
  - `SortField` type: `'created_at' | 'price_pence' | 'stage'`
  - `SortDirection` type: `'asc' | 'desc'`
  - `<ProjectCard project onStageChange onSelect onDelete />` component
  - `<Pipeline projects onSelectProject onProjectsChanged />` component (updated)

- [ ] **Step 1: Write pipeline helper tests**

Create `frontend/src/lib/pipeline-helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { filterProjects, sortProjects } from './pipeline-helpers';
import type { Project } from '../types';

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: crypto.randomUUID(),
  address_raw: '1 Test St',
  address_line1: null,
  address_line2: null,
  address_town: null,
  address_county: null,
  address_postcode: null,
  address_postcode_district: null,
  price_pence: 50000000,
  price_qualifier: null,
  use_class: 'office',
  floor_area_sqft: null,
  floor_area_sqm: null,
  floors: null,
  tenure: 'freehold',
  lease_years_remaining: null,
  current_use_description: null,
  epc_rating: null,
  is_vacant: null,
  vacancy_date: null,
  source_url: null,
  source_name: null,
  description: null,
  image_urls: [],
  stage: 'opportunity_identified',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('filterProjects', () => {
  it('returns all projects when all filters are "all"', () => {
    const projects = [makeProject(), makeProject()];
    const result = filterProjects(projects, { stage: 'all', useClass: 'all' });
    expect(result).toHaveLength(2);
  });

  it('filters by stage', () => {
    const projects = [
      makeProject({ stage: 'opportunity_identified' }),
      makeProject({ stage: 'approved' }),
      makeProject({ stage: 'opportunity_identified' }),
    ];
    const result = filterProjects(projects, { stage: 'opportunity_identified', useClass: 'all' });
    expect(result).toHaveLength(2);
  });

  it('filters by use class', () => {
    const projects = [
      makeProject({ use_class: 'office' }),
      makeProject({ use_class: 'retail' }),
    ];
    const result = filterProjects(projects, { stage: 'all', useClass: 'office' });
    expect(result).toHaveLength(1);
    expect(result[0].use_class).toBe('office');
  });
});

describe('sortProjects', () => {
  it('sorts by created_at ascending', () => {
    const projects = [
      makeProject({ created_at: '2026-03-01T00:00:00Z' }),
      makeProject({ created_at: '2026-01-01T00:00:00Z' }),
      makeProject({ created_at: '2026-02-01T00:00:00Z' }),
    ];
    const result = sortProjects(projects, 'created_at', 'asc');
    expect(result[0].created_at).toBe('2026-01-01T00:00:00Z');
    expect(result[2].created_at).toBe('2026-03-01T00:00:00Z');
  });

  it('sorts by price_pence descending', () => {
    const projects = [
      makeProject({ price_pence: 10000000 }),
      makeProject({ price_pence: 50000000 }),
      makeProject({ price_pence: 25000000 }),
    ];
    const result = sortProjects(projects, 'price_pence', 'desc');
    expect(result[0].price_pence).toBe(50000000);
    expect(result[2].price_pence).toBe(10000000);
  });

  it('sorts by created_at descending', () => {
    const projects = [
      makeProject({ created_at: '2026-01-01T00:00:00Z' }),
      makeProject({ created_at: '2026-03-01T00:00:00Z' }),
    ];
    const result = sortProjects(projects, 'created_at', 'desc');
    expect(result[0].created_at).toBe('2026-03-01T00:00:00Z');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/pipeline-helpers.test.ts`
Expected: FAIL — module `./pipeline-helpers` not found.

- [ ] **Step 3: Implement pipeline helpers**

Create `frontend/src/lib/pipeline-helpers.ts`:

```typescript
import type { Project, PipelineStage, EligibilityVerdict, UseClass } from '../types';

export interface PipelineFilters {
  stage: PipelineStage | 'all';
  useClass: UseClass | 'all';
}

export type SortField = 'created_at' | 'price_pence' | 'stage';
export type SortDirection = 'asc' | 'desc';

export function filterProjects(projects: Project[], filters: PipelineFilters): Project[] {
  return projects.filter((p) => {
    if (filters.stage !== 'all' && p.stage !== filters.stage) return false;
    if (filters.useClass !== 'all' && p.use_class !== filters.useClass) return false;
    return true;
  });
}

export function sortProjects(projects: Project[], sortBy: SortField, sortDir: SortDirection): Project[] {
  const sorted = [...projects];
  const dir = sortDir === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'created_at':
        return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'price_pence':
        return dir * (a.price_pence - b.price_pence);
      case 'stage':
        return dir * a.stage.localeCompare(b.stage);
      default:
        return 0;
    }
  });

  return sorted;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/pipeline-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Create ProjectCard component**

Create `frontend/src/components/ProjectCard.tsx`:

```tsx
import type { Project, PipelineStage } from '../types';
import { PIPELINE_STAGES } from '../types';

interface ProjectCardProps {
  project: Project;
  onStageChange: (projectId: string, newStage: PipelineStage) => void;
  onSelect: (project: Project) => void;
  onDelete: (projectId: string) => void;
}

const VERDICT_COLORS: Record<string, string> = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
};

export default function ProjectCard({ project, onStageChange, onSelect, onDelete }: ProjectCardProps) {
  const currentIndex = PIPELINE_STAGES.findIndex((s) => s.value === project.stage);
  const nextStage = currentIndex < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[currentIndex + 1] : null;

  return (
    <div
      style={{
        background: '#0f1d32',
        border: '1px solid #1e3a5f',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        cursor: 'pointer',
      }}
      onClick={() => onSelect(project)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, flex: 1 }}>
          {project.address_raw}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(project.id);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: 14,
            padding: '0 4px',
          }}
          title="Delete project"
        >
          ✕
        </button>
      </div>
      <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
        {project.use_class.replace(/_/g, ' ')} · £{(project.price_pence / 100).toLocaleString()}
      </div>
      {project.address_postcode && (
        <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{project.address_postcode}</div>
      )}
      {nextStage && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStageChange(project.id, nextStage.value);
          }}
          style={{
            marginTop: 8,
            padding: '4px 10px',
            fontSize: 11,
            background: '#1e3a5f',
            color: '#93c5fd',
            border: '1px solid #2563eb',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          → {nextStage.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Replace Pipeline.tsx with Kanban dashboard**

Replace full contents of `frontend/src/components/Pipeline.tsx`:

```tsx
import { useState, useMemo, useCallback } from 'react';
import type { Project, PipelineStage, UseClass } from '../types';
import { PIPELINE_STAGES, USE_CLASS_OPTIONS } from '../types';
import { changeStage, deleteProject } from '../lib/api';
import { filterProjects, sortProjects } from '../lib/pipeline-helpers';
import type { PipelineFilters, SortField, SortDirection } from '../lib/pipeline-helpers';
import ProjectCard from './ProjectCard';

interface PipelineProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
  onProjectsChanged: () => void;
}

export default function Pipeline({ projects, onSelectProject, onProjectsChanged }: PipelineProps) {
  const [filters, setFilters] = useState<PipelineFilters>({
    stage: 'all',
    useClass: 'all',
  });
  const [sortBy, setSortBy] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const processed = useMemo(() => {
    const filtered = filterProjects(projects, filters);
    return sortProjects(filtered, sortBy, sortDir);
  }, [projects, filters, sortBy, sortDir]);

  const projectsByStage = useMemo(() => {
    const map = new Map<PipelineStage, Project[]>();
    for (const s of PIPELINE_STAGES) {
      map.set(s.value, []);
    }
    for (const p of processed) {
      const list = map.get(p.stage);
      if (list) list.push(p);
    }
    return map;
  }, [processed]);

  const handleStageChange = useCallback(
    async (projectId: string, newStage: PipelineStage) => {
      try {
        await changeStage(projectId, newStage);
        onProjectsChanged();
      } catch (err) {
        console.error('Stage change failed:', err);
      }
    },
    [onProjectsChanged],
  );

  const handleDelete = useCallback(
    async (projectId: string) => {
      try {
        await deleteProject(projectId);
        onProjectsChanged();
      } catch (err) {
        console.error('Delete failed:', err);
      }
    },
    [onProjectsChanged],
  );

  return (
    <div style={{ padding: 16 }}>
      {/* Filters row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ color: '#94a3b8', fontSize: 13 }}>
          Use class:
          <select
            value={filters.useClass}
            onChange={(e) => setFilters((f) => ({ ...f, useClass: e.target.value as UseClass | 'all' }))}
            style={{ marginLeft: 6, background: '#0f1d32', color: '#e2e8f0', border: '1px solid #1e3a5f', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          >
            <option value="all">All</option>
            {USE_CLASS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label style={{ color: '#94a3b8', fontSize: 13 }}>
          Sort:
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
            style={{ marginLeft: 6, background: '#0f1d32', color: '#e2e8f0', border: '1px solid #1e3a5f', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          >
            <option value="created_at">Date Added</option>
            <option value="price_pence">Price</option>
            <option value="stage">Stage</option>
          </select>
        </label>

        <button
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          style={{ background: '#0f1d32', border: '1px solid #1e3a5f', color: '#93c5fd', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
        >
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>

        <span style={{ color: '#64748b', fontSize: 13, marginLeft: 'auto' }}>
          {processed.length} project{processed.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Kanban columns */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          overflowX: 'auto',
          paddingBottom: 16,
        }}
      >
        {PIPELINE_STAGES.map((stage) => {
          const stageProjects = projectsByStage.get(stage.value) || [];
          return (
            <div
              key={stage.value}
              style={{
                minWidth: 220,
                maxWidth: 280,
                flex: '1 0 220px',
                background: '#0a1628',
                borderRadius: 8,
                border: '1px solid #1e3a5f',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid #1e3a5f',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{stage.label}</span>
                <span
                  style={{
                    background: '#1e3a5f',
                    color: '#93c5fd',
                    borderRadius: 10,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {stageProjects.length}
                </span>
              </div>
              <div style={{ padding: 8, flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
                {stageProjects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onStageChange={handleStageChange}
                    onSelect={onSelectProject}
                    onDelete={handleDelete}
                  />
                ))}
                {stageProjects.length === 0 && (
                  <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', padding: 16 }}>
                    No projects
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Update App.tsx to pass `onProjectsChanged` to Pipeline**

In `frontend/src/App.tsx`, replace the Pipeline rendering (line 107):

```tsx
{activeTab === 'pipeline' && (
  <Pipeline projects={projects} onSelectProject={handleSelectProject} onProjectsChanged={loadProjects} />
)}
```

- [ ] **Step 8: Run pipeline helper tests**

Run: `cd frontend && npx vitest run src/lib/pipeline-helpers.test.ts`
Expected: PASS

- [ ] **Step 9: Run full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: ALL PASS

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/pipeline-helpers.ts frontend/src/lib/pipeline-helpers.test.ts frontend/src/components/ProjectCard.tsx frontend/src/components/Pipeline.tsx frontend/src/App.tsx
git commit -m "feat: replace Pipeline placeholder with 7-stage Kanban dashboard"
```

---

### Task 6: Leaflet Map with Overlays

**Files:**
- Modify: `frontend/src/components/PropertyMap.tsx`
- Modify: `frontend/src/App.tsx` (pass `projects` and `selectedProject` props)

**Interfaces:**
- Consumes: `Project`, `PostcodeLookup`, `FloodRisk` from `../types`, `lookupPostcode`, `lookupFlood` from `../lib/api`
- Produces: `<PropertyMap projects selectedProject onSelectProject />` component

- [ ] **Step 1: Install Leaflet packages**

Run: `cd frontend && npm install leaflet react-leaflet @types/leaflet`

- [ ] **Step 2: Replace PropertyMap.tsx with Leaflet map**

Replace full contents of `frontend/src/components/PropertyMap.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Project } from '../types';
import { lookupPostcode } from '../lib/api';

import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

interface PropertyMapProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
}

interface ProjectCoord {
  project: Project;
  lat: number;
  lng: number;
}

const UK_CENTER: [number, number] = [52.5, -1.5];
const UK_ZOOM = 6;

export default function PropertyMap({ projects, selectedProject, onSelectProject }: PropertyMapProps) {
  const [coords, setCoords] = useState<ProjectCoord[]>([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<string, { lat: number; lng: number } | null>>(new Map());

  const lookupCoords = useCallback(async () => {
    const projectsWithPostcode = projects.filter((p) => p.address_postcode);
    if (projectsWithPostcode.length === 0) {
      setCoords([]);
      return;
    }

    setLoading(true);
    const results: ProjectCoord[] = [];

    for (const project of projectsWithPostcode) {
      const pc = project.address_postcode!;
      const cached = cacheRef.current.get(pc);

      if (cached !== undefined) {
        if (cached) results.push({ project, lat: cached.lat, lng: cached.lng });
        continue;
      }

      try {
        const lookup = await lookupPostcode(pc);
        const coord = { lat: lookup.latitude, lng: lookup.longitude };
        cacheRef.current.set(pc, coord);
        results.push({ project, ...coord });
      } catch {
        cacheRef.current.set(pc, null);
      }
    }

    setCoords(results);
    setLoading(false);
  }, [projects]);

  useEffect(() => {
    lookupCoords();
  }, [lookupCoords]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (selectedProject) {
      const found = coords.find((c) => c.project.id === selectedProject.id);
      if (found) return [found.lat, found.lng];
    }
    if (coords.length > 0) {
      const avgLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
      const avgLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
      return [avgLat, avgLng];
    }
    return UK_CENTER;
  }, [coords, selectedProject]);

  const mapZoom = selectedProject && coords.find((c) => c.project.id === selectedProject.id) ? 14 : coords.length > 0 ? 10 : UK_ZOOM;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 600, margin: 0 }}>Property Map</h2>
        {loading && <span style={{ color: '#93c5fd', fontSize: 13 }}>Loading coordinates...</span>}
        <span style={{ color: '#64748b', fontSize: 13 }}>
          {coords.length} of {projects.length} mapped
        </span>
      </div>

      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e3a5f', height: 'calc(100vh - 180px)' }}>
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {coords.map((c) => (
            <Marker key={c.project.id} position={[c.lat, c.lng]}>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <strong>{c.project.address_raw}</strong>
                  <br />
                  <span>{c.project.use_class.replace(/_/g, ' ')}</span>
                  <br />
                  <span>£{(c.project.price_pence / 100).toLocaleString()}</span>
                  <br />
                  <span>Stage: {c.project.stage.replace(/_/g, ' ')}</span>
                  <br />
                  <button
                    onClick={() => onSelectProject(c.project)}
                    style={{
                      marginTop: 6,
                      padding: '3px 10px',
                      fontSize: 12,
                      background: '#2563eb',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    View Details
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {projects.length > 0 && coords.length === 0 && !loading && (
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>
          No projects have postcodes set. Add a postcode to a project to see it on the map.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire PropertyMap props in App.tsx**

In `frontend/src/App.tsx`, replace the map rendering (line 116):

```tsx
{activeTab === 'map' && (
  <PropertyMap projects={projects} selectedProject={selectedProject} onSelectProject={handleSelectProject} />
)}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PropertyMap.tsx frontend/src/App.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat: add Leaflet map with project markers and postcode lookup"
```

---

### Task 7: PDF & Excel Export

**Files:**
- Create: `frontend/src/lib/export-pdf.ts`
- Create: `frontend/src/lib/export-pdf.test.ts`
- Create: `frontend/src/lib/export-excel.ts`
- Create: `frontend/src/lib/export-excel.test.ts`
- Modify: `frontend/src/components/ExportPage.tsx`
- Modify: `frontend/src/App.tsx` (pass props to ExportPage)

**Interfaces:**
- Consumes: `Project`, `EligibilityAssessment`, `FinancialAppraisal` from `../types`, `getEligibility`, `getAppraisal` from `../lib/api`, `jsPDF` from `jspdf`, `utils` from `xlsx`
- Produces:
  - `generateEligibilityPdf(project: Project, assessment: EligibilityAssessment): Blob`
  - `generateAppraisalPdf(project: Project, appraisal: FinancialAppraisal): Blob`
  - `formatProjectRow(project: Project): Record<string, string | number>` — for Excel export
  - `generateProjectsExcel(projects: Project[]): Blob`
  - `<ExportPage projects selectedProject />` component

- [ ] **Step 1: Write PDF export tests**

Create `frontend/src/lib/export-pdf.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildEligibilityContent, buildAppraisalContent } from './export-pdf';
import type { Project, EligibilityAssessment, FinancialAppraisal } from '../types';

const mockProject: Project = {
  id: 'test-id',
  address_raw: '1 Test Street, London, SW1A 1AA',
  address_line1: null,
  address_line2: null,
  address_town: 'London',
  address_county: null,
  address_postcode: 'SW1A 1AA',
  address_postcode_district: 'SW1A',
  price_pence: 50000000,
  price_qualifier: null,
  use_class: 'office',
  floor_area_sqft: 2000,
  floor_area_sqm: 185.8,
  floors: 2,
  tenure: 'freehold',
  lease_years_remaining: null,
  current_use_description: 'Office',
  epc_rating: 'C',
  is_vacant: true,
  vacancy_date: '2026-01-01',
  source_url: null,
  source_name: null,
  description: null,
  image_urls: [],
  stage: 'eligibility_assessed',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockAssessment: EligibilityAssessment = {
  id: 'assess-id',
  project_id: 'test-id',
  pdr_class: 'class_ma',
  criteria: [
    { key: 'use_class', label: 'Use class E(a) office', passed: true, source: 'user', auto_checked: false, value: 'office', risk_flag: null },
    { key: 'floor_area', label: 'Floor area ≤ 1,500 sq m', passed: false, source: 'auto', auto_checked: true, value: '185.8 sq m', risk_flag: null },
  ],
  verdict: 'red',
  suggested_next_steps: ['Verify floor area', 'Check Article 4'],
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockAppraisal: FinancialAppraisal = {
  id: 'appr-id',
  project_id: 'test-id',
  name: 'Base Case',
  inputs_snapshot: {},
  gdv_pence: 120000000,
  total_cost_pence: 85000000,
  profit_on_cost_pct: 41.2,
  profit_on_gdv_pct: 29.2,
  return_on_equity_pct: 62.5,
  irr: 0.28,
  rlv_pence: 38000000,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('buildEligibilityContent', () => {
  it('returns lines containing project address', () => {
    const lines = buildEligibilityContent(mockProject, mockAssessment);
    expect(lines.some((l) => l.includes('1 Test Street'))).toBe(true);
  });

  it('includes verdict', () => {
    const lines = buildEligibilityContent(mockProject, mockAssessment);
    expect(lines.some((l) => l.toLowerCase().includes('red'))).toBe(true);
  });

  it('includes each criterion', () => {
    const lines = buildEligibilityContent(mockProject, mockAssessment);
    expect(lines.some((l) => l.includes('Use class E(a) office'))).toBe(true);
    expect(lines.some((l) => l.includes('Floor area'))).toBe(true);
  });

  it('includes suggested next steps', () => {
    const lines = buildEligibilityContent(mockProject, mockAssessment);
    expect(lines.some((l) => l.includes('Verify floor area'))).toBe(true);
  });
});

describe('buildAppraisalContent', () => {
  it('returns lines containing project address', () => {
    const lines = buildAppraisalContent(mockProject, mockAppraisal);
    expect(lines.some((l) => l.includes('1 Test Street'))).toBe(true);
  });

  it('includes key financial metrics', () => {
    const lines = buildAppraisalContent(mockProject, mockAppraisal);
    const text = lines.join('\n');
    expect(text).toContain('GDV');
    expect(text).toContain('Profit on Cost');
    expect(text).toContain('IRR');
  });

  it('includes appraisal name', () => {
    const lines = buildAppraisalContent(mockProject, mockAppraisal);
    expect(lines.some((l) => l.includes('Base Case'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run PDF tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/export-pdf.test.ts`
Expected: FAIL — module `./export-pdf` not found.

- [ ] **Step 3: Implement PDF export**

Create `frontend/src/lib/export-pdf.ts`:

```typescript
import { jsPDF } from 'jspdf';
import type { Project, EligibilityAssessment, FinancialAppraisal } from '../types';

function formatPence(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

export function buildEligibilityContent(project: Project, assessment: EligibilityAssessment): string[] {
  const lines: string[] = [];
  lines.push('PDR ELIGIBILITY REPORT');
  lines.push('');
  lines.push(`Property: ${project.address_raw}`);
  lines.push(`Postcode: ${project.address_postcode || 'N/A'}`);
  lines.push(`Use Class: ${project.use_class.replace(/_/g, ' ')}`);
  lines.push(`Price: ${formatPence(project.price_pence)}`);
  lines.push(`Floor Area: ${project.floor_area_sqft ? `${project.floor_area_sqft} sq ft` : 'N/A'}`);
  lines.push('');
  lines.push(`PDR Class: ${assessment.pdr_class.replace(/_/g, ' ').toUpperCase()}`);
  lines.push(`Verdict: ${assessment.verdict.toUpperCase()}`);
  lines.push('');
  lines.push('CRITERIA:');
  for (const c of assessment.criteria) {
    const status = c.passed === true ? 'PASS' : c.passed === false ? 'FAIL' : 'PENDING';
    lines.push(`  [${status}] ${c.label}${c.value ? ` (${c.value})` : ''}`);
  }
  if (assessment.suggested_next_steps.length > 0) {
    lines.push('');
    lines.push('SUGGESTED NEXT STEPS:');
    for (const step of assessment.suggested_next_steps) {
      lines.push(`  - ${step}`);
    }
  }
  lines.push('');
  lines.push(`Report generated: ${new Date().toLocaleDateString('en-GB')}`);
  return lines;
}

export function buildAppraisalContent(project: Project, appraisal: FinancialAppraisal): string[] {
  const lines: string[] = [];
  lines.push('FINANCIAL APPRAISAL SUMMARY');
  lines.push('');
  lines.push(`Property: ${project.address_raw}`);
  lines.push(`Appraisal: ${appraisal.name}`);
  lines.push('');
  lines.push('KEY METRICS:');
  lines.push(`  GDV: ${appraisal.gdv_pence ? formatPence(appraisal.gdv_pence) : 'N/A'}`);
  lines.push(`  Total Cost: ${appraisal.total_cost_pence ? formatPence(appraisal.total_cost_pence) : 'N/A'}`);
  lines.push(`  Profit on Cost: ${appraisal.profit_on_cost_pct != null ? formatPct(appraisal.profit_on_cost_pct) : 'N/A'}`);
  lines.push(`  Profit on GDV: ${appraisal.profit_on_gdv_pct != null ? formatPct(appraisal.profit_on_gdv_pct) : 'N/A'}`);
  lines.push(`  Return on Equity: ${appraisal.return_on_equity_pct != null ? formatPct(appraisal.return_on_equity_pct) : 'N/A'}`);
  lines.push(`  IRR: ${appraisal.irr != null ? formatPct(appraisal.irr * 100) : 'N/A'}`);
  lines.push(`  Residual Land Value: ${appraisal.rlv_pence ? formatPence(appraisal.rlv_pence) : 'N/A'}`);
  lines.push('');
  lines.push(`Report generated: ${new Date().toLocaleDateString('en-GB')}`);
  return lines;
}

export function generateEligibilityPdf(project: Project, assessment: EligibilityAssessment): Blob {
  const doc = new jsPDF();
  const lines = buildEligibilityContent(project, assessment);
  let y = 20;
  for (const line of lines) {
    if (line === '') {
      y += 6;
      continue;
    }
    const isHeader = line === line.toUpperCase() && line.length > 3 && !line.startsWith(' ');
    doc.setFontSize(isHeader ? 14 : 11);
    doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
    doc.text(line, 15, y);
    y += isHeader ? 8 : 6;
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  }
  return doc.output('blob');
}

export function generateAppraisalPdf(project: Project, appraisal: FinancialAppraisal): Blob {
  const doc = new jsPDF();
  const lines = buildAppraisalContent(project, appraisal);
  let y = 20;
  for (const line of lines) {
    if (line === '') {
      y += 6;
      continue;
    }
    const isHeader = line === line.toUpperCase() && line.length > 3 && !line.startsWith(' ');
    doc.setFontSize(isHeader ? 14 : 11);
    doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
    doc.text(line, 15, y);
    y += isHeader ? 8 : 6;
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  }
  return doc.output('blob');
}
```

- [ ] **Step 4: Run PDF tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/export-pdf.test.ts`
Expected: PASS

- [ ] **Step 5: Write Excel export tests**

Create `frontend/src/lib/export-excel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatProjectRow } from './export-excel';
import type { Project } from '../types';

const mockProject: Project = {
  id: 'test-id',
  address_raw: '1 Test Street, London',
  address_line1: null,
  address_line2: null,
  address_town: 'London',
  address_county: null,
  address_postcode: 'SW1A 1AA',
  address_postcode_district: 'SW1A',
  price_pence: 50000000,
  price_qualifier: 'Guide',
  use_class: 'office',
  floor_area_sqft: 2000,
  floor_area_sqm: 185.8,
  floors: 2,
  tenure: 'freehold',
  lease_years_remaining: null,
  current_use_description: 'Office',
  epc_rating: 'C',
  is_vacant: true,
  vacancy_date: '2026-01-01',
  source_url: 'https://example.com/prop/1',
  source_name: 'Test Source',
  description: null,
  image_urls: [],
  stage: 'opportunity_identified',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('formatProjectRow', () => {
  it('includes address', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Address']).toBe('1 Test Street, London');
  });

  it('converts price to pounds', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Price (£)']).toBe(500000);
  });

  it('includes postcode', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Postcode']).toBe('SW1A 1AA');
  });

  it('includes stage as readable text', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Stage']).toBe('Opportunity Identified');
  });

  it('includes use class', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Use Class']).toBe('Office');
  });

  it('includes floor area', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Floor Area (sq ft)']).toBe(2000);
  });

  it('includes tenure', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Tenure']).toBe('Freehold');
  });
});
```

- [ ] **Step 6: Run Excel tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/export-excel.test.ts`
Expected: FAIL — module `./export-excel` not found.

- [ ] **Step 7: Implement Excel export**

Create `frontend/src/lib/export-excel.ts`:

```typescript
import * as XLSX from 'xlsx';
import type { Project } from '../types';
import { PIPELINE_STAGES } from '../types';

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatProjectRow(project: Project): Record<string, string | number> {
  const stageLabel = PIPELINE_STAGES.find((s) => s.value === project.stage)?.label ?? titleCase(project.stage);
  return {
    'Address': project.address_raw,
    'Postcode': project.address_postcode || '',
    'Town': project.address_town || '',
    'Price (£)': project.price_pence / 100,
    'Price Qualifier': project.price_qualifier || '',
    'Use Class': titleCase(project.use_class),
    'Floor Area (sq ft)': project.floor_area_sqft ?? '',
    'Floor Area (sq m)': project.floor_area_sqm ?? '',
    'Floors': project.floors ?? '',
    'Tenure': titleCase(project.tenure),
    'EPC': project.epc_rating || '',
    'Vacant': project.is_vacant === true ? 'Yes' : project.is_vacant === false ? 'No' : '',
    'Stage': stageLabel,
    'Source': project.source_name || '',
    'Source URL': project.source_url || '',
    'Created': new Date(project.created_at).toLocaleDateString('en-GB'),
  };
}

export function generateProjectsExcel(projects: Project[]): Blob {
  const rows = projects.map(formatProjectRow);
  const ws = XLSX.utils.json_to_sheet(rows);

  const colWidths = Object.keys(rows[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length)) + 2,
  }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Projects');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
```

- [ ] **Step 8: Run Excel tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/export-excel.test.ts`
Expected: PASS

- [ ] **Step 9: Replace ExportPage.tsx with export UI**

Replace full contents of `frontend/src/components/ExportPage.tsx`:

```tsx
import { useState, useCallback } from 'react';
import type { Project, EligibilityAssessment, FinancialAppraisal } from '../types';
import { getEligibility, getAppraisal } from '../lib/api';
import { generateEligibilityPdf, generateAppraisalPdf } from '../lib/export-pdf';
import { generateProjectsExcel } from '../lib/export-excel';

interface ExportPageProps {
  projects: Project[];
  selectedProject: Project | null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPage({ projects, selectedProject }: ExportPageProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEligibilityPdf = useCallback(async () => {
    if (!selectedProject) return;
    setLoading('eligibility');
    setError(null);
    try {
      const assessment = await getEligibility(selectedProject.id);
      const blob = generateEligibilityPdf(selectedProject, assessment);
      const safeName = selectedProject.address_postcode || selectedProject.id.slice(0, 8);
      downloadBlob(blob, `eligibility-${safeName}.pdf`);
    } catch (err) {
      setError('Could not generate eligibility PDF. Has an eligibility assessment been run for this project?');
    } finally {
      setLoading(null);
    }
  }, [selectedProject]);

  const handleAppraisalPdf = useCallback(async () => {
    if (!selectedProject) return;
    setLoading('appraisal');
    setError(null);
    try {
      const appraisal = await getAppraisal(selectedProject.id);
      const blob = generateAppraisalPdf(selectedProject, appraisal);
      const safeName = selectedProject.address_postcode || selectedProject.id.slice(0, 8);
      downloadBlob(blob, `appraisal-${safeName}.pdf`);
    } catch (err) {
      setError('Could not generate appraisal PDF. Has a financial appraisal been saved for this project?');
    } finally {
      setLoading(null);
    }
  }, [selectedProject]);

  const handleExcel = useCallback(() => {
    if (projects.length === 0) return;
    setLoading('excel');
    setError(null);
    try {
      const blob = generateProjectsExcel(projects);
      downloadBlob(blob, `projects-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setError('Could not generate Excel file.');
    } finally {
      setLoading(null);
    }
  }, [projects]);

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 600, marginBottom: 20 }}>Export</h2>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 8, padding: 12, marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Project-specific exports */}
      <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Project Reports (PDF)</h3>
        {selectedProject ? (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
              Selected: <strong style={{ color: '#e2e8f0' }}>{selectedProject.address_raw}</strong>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={handleEligibilityPdf}
                disabled={loading === 'eligibility'}
                style={{
                  padding: '8px 16px',
                  background: '#1e3a5f',
                  color: '#93c5fd',
                  border: '1px solid #2563eb',
                  borderRadius: 6,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  opacity: loading === 'eligibility' ? 0.6 : 1,
                }}
              >
                {loading === 'eligibility' ? 'Generating...' : 'Eligibility Report PDF'}
              </button>
              <button
                onClick={handleAppraisalPdf}
                disabled={loading === 'appraisal'}
                style={{
                  padding: '8px 16px',
                  background: '#1e3a5f',
                  color: '#93c5fd',
                  border: '1px solid #2563eb',
                  borderRadius: 6,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  opacity: loading === 'appraisal' ? 0.6 : 1,
                }}
              >
                {loading === 'appraisal' ? 'Generating...' : 'Financial Appraisal PDF'}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: 13 }}>
            Select a project from the Pipeline tab to export its reports.
          </p>
        )}
      </div>

      {/* Bulk export */}
      <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16 }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>All Projects (Excel)</h3>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
          Export all {projects.length} project{projects.length !== 1 ? 's' : ''} to a spreadsheet.
        </p>
        <button
          onClick={handleExcel}
          disabled={projects.length === 0 || loading === 'excel'}
          style={{
            padding: '8px 16px',
            background: projects.length > 0 ? '#1e3a5f' : '#0f1d32',
            color: projects.length > 0 ? '#93c5fd' : '#475569',
            border: `1px solid ${projects.length > 0 ? '#2563eb' : '#1e3a5f'}`,
            borderRadius: 6,
            cursor: projects.length > 0 && !loading ? 'pointer' : 'not-allowed',
            fontSize: 13,
            opacity: loading === 'excel' ? 0.6 : 1,
          }}
        >
          {loading === 'excel' ? 'Generating...' : 'Download Excel'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Wire ExportPage props in App.tsx**

In `frontend/src/App.tsx`, replace the export rendering (line 117):

```tsx
{activeTab === 'export' && <ExportPage projects={projects} selectedProject={selectedProject} />}
```

- [ ] **Step 11: Run all export tests**

Run: `cd frontend && npx vitest run src/lib/export-pdf.test.ts src/lib/export-excel.test.ts`
Expected: ALL PASS

- [ ] **Step 12: Verify TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 13: Run full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: ALL PASS

- [ ] **Step 14: Commit**

```bash
git add frontend/src/lib/export-pdf.ts frontend/src/lib/export-pdf.test.ts frontend/src/lib/export-excel.ts frontend/src/lib/export-excel.test.ts frontend/src/components/ExportPage.tsx frontend/src/App.tsx
git commit -m "feat: add PDF eligibility/appraisal export and Excel project export"
```

---

## Next Plans

This is the final plan in the four-plan roadmap:

1. ~~Plan 1: Foundation~~ (complete)
2. ~~Plan 2: Data Integrations & PDR Eligibility Engine~~ (complete)
3. ~~Plan 3: Conversion Financial Calculator~~ (complete)
4. ~~Plan 4: Scraping, Pipeline, Map & Export~~ (this plan)

### Future Enhancements (post-MVP)

- Additional scraping adapters: Acuitus, Savills Commercial, SDL Commercial, Barnett Ross, LoopNet UK
- Playwright-based scraping for JavaScript-rendered listing pages
- Drag-and-drop Kanban (react-beautiful-dnd or @hello-pangea/dnd)
- Pipeline filter by eligibility verdict (requires denormalized verdict on Project or per-project eligibility fetch)
- Pipeline filter by LPA and profit-on-cost range
- Flood zone polygon overlays from EA Flood Map for Planning API
- Article 4 direction boundary overlays
- Thumbnail map on deal cards
- Investor pack PDF combining eligibility + appraisal + photos
- OS Places API integration for UPRN resolution
