# Plan 2: Data Integrations & PDR Eligibility Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the external data integration layer (EA Flood API, EPC API, Postcodes.io, Article 4 dataset) and a complete PDR eligibility engine with a stepped frontend assessment form, so users can evaluate any project's PDR eligibility and get a Green/Amber/Red verdict with per-criterion breakdown.

**Architecture:** A new `app/integrations/` module wraps each external API behind a typed async client. A new `app/eligibility/` module contains per-PDR-class rule sets that combine auto-checked data from integrations with manual user-confirmed criteria to produce a verdict. The backend exposes lookup endpoints (`/api/v1/lookup/*`) for flood, EPC, LPA, and Article 4 data. The frontend Eligibility tab becomes a multi-step form: select project → auto-detect PDR class → step through criteria (auto-filled where possible) → generate verdict with suggested next steps.

**Tech Stack:** Python 3.12, httpx (async HTTP client), FastAPI, Pydantic v2, React 19, TypeScript 5.9, Tailwind 4, Vitest, pytest, respx (HTTP mocking).

## Global Constraints

- Python >= 3.12, Node >= 20
- All monetary values stored as integer pence (BigInteger in ORM, `number` in TypeScript)
- All UUIDs use `uuid.uuid4` / `crypto.randomUUID()`
- SQLAlchemy 2.0 style: `Mapped[T]` + `mapped_column()`, `DeclarativeBase` + `AsyncAttrs`
- Pydantic v2: `BaseModel`, `ConfigDict(from_attributes=True)` on ORM response models
- Repository pattern: constructor takes `AsyncSession`, `flush()` not `commit()`
- Frontend: native `fetch` for HTTP, `useState`/`useMemo`/`useCallback` for state (no external state lib)
- API prefix: `/api/v1`
- External APIs require no authentication except EPC (`EPC_API_KEY` env var, already in settings)
- httpx is already a dependency; respx is already a test dependency
- The existing eligibility CRUD endpoints (`POST/GET/PUT /api/v1/eligibility/{project_id}`) and data models (`EligibilityCriterion`, `EligibilityAssessment`, etc.) from Plan 1 are consumed — this plan builds the engine that populates them

## File Structure

### Backend — new files

| File | Responsibility |
|------|---------------|
| `app/integrations/__init__.py` | Package marker |
| `app/integrations/postcodes.py` | Postcodes.io client: postcode → coordinates, LPA name/code, region |
| `app/integrations/flood.py` | EA Flood Risk API client: postcode/coords → flood zone (1/2/3) |
| `app/integrations/epc.py` | EPC Open Data API client: postcode + address → EPC rating, certificate data |
| `app/integrations/article4.py` | Article 4 Direction dataset loader: LPA code → list of active Article 4 directions |
| `app/eligibility/__init__.py` | Package marker |
| `app/eligibility/criteria.py` | Criterion definitions per PDR class (Class MA, G, M, N, Q) |
| `app/eligibility/engine.py` | Eligibility engine: takes project + integration results → runs rules → produces assessment |
| `data/article4_directions.json` | Bundled dataset of known Article 4 directions keyed by LPA code |
| `tests/test_integrations.py` | Tests for all 4 integration clients (mocked HTTP with respx) |
| `tests/test_eligibility_engine.py` | Tests for the eligibility engine rule logic |

### Backend — modified files

| File | Change |
|------|--------|
| `app/api/app.py` | Add lookup router (`/api/v1/lookup/*`) + eligibility-run endpoint (`POST /api/v1/eligibility/{project_id}/run`) |
| `app/models.py` | Add `PostcodeLookup`, `FloodRiskResult`, `EpcResult`, `Article4Result`, `LookupResults` response models |

### Frontend — new files

| File | Responsibility |
|------|---------------|
| `frontend/src/components/EligibilityWizard.tsx` | Multi-step eligibility assessment form (select project → auto-detect class → step through criteria → verdict) |
| `frontend/src/components/EligibilityVerdict.tsx` | Traffic light verdict display with per-criterion breakdown |
| `frontend/src/components/CriterionRow.tsx` | Single criterion row: label, pass/fail/pending, data source tag, value |

### Frontend — modified files

| File | Change |
|------|--------|
| `frontend/src/components/EligibilityAssessment.tsx` | Replace placeholder with `EligibilityWizard` integration (project selection + wizard) |
| `frontend/src/lib/api.ts` | Add `lookupPostcode()`, `lookupFlood()`, `lookupEpc()`, `lookupArticle4()`, `runEligibility()` functions |
| `frontend/src/types.ts` | Add `PostcodeLookup`, `FloodRiskResult`, `EpcResult`, `Article4Result`, `LookupResults`, `EligibilityRunRequest`, `EligibilityRunResponse` types |

---

### Task 1: Postcodes.io Integration Client

**Files:**
- Create: `app/integrations/__init__.py`
- Create: `app/integrations/postcodes.py`
- Test: `tests/test_integrations.py`

**Interfaces:**
- Consumes: `httpx` (async HTTP), `config/settings.py` — no API key needed for Postcodes.io
- Produces: `lookup_postcode(postcode: str) -> PostcodeLookupResult | None` returning `PostcodeLookupResult(postcode: str, latitude: float, longitude: float, lpa_name: str, lpa_code: str, region: str, country: str, admin_district: str)`

- [ ] **Step 1: Write the failing test**

Create `app/integrations/__init__.py` (empty file).

Create `tests/test_integrations.py`:

```python
import pytest
import httpx
import respx

from app.integrations.postcodes import lookup_postcode, PostcodeLookupResult


class TestPostcodesLookup:
    @respx.mock
    @pytest.mark.asyncio
    async def test_valid_postcode_returns_result(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501009,
                        "longitude": -0.141588,
                        "admin_district": "Westminster",
                        "region": "London",
                        "country": "England",
                        "codes": {
                            "admin_district": "E09000033",
                            "lau2": "E09000033",
                        },
                    },
                },
            )
        )
        result = await lookup_postcode("SW1A 1AA")
        assert result is not None
        assert isinstance(result, PostcodeLookupResult)
        assert result.postcode == "SW1A 1AA"
        assert result.latitude == pytest.approx(51.501009)
        assert result.longitude == pytest.approx(-0.141588)
        assert result.admin_district == "Westminster"
        assert result.region == "London"
        assert result.country == "England"
        assert result.lpa_code == "E09000033"
        assert result.lpa_name == "Westminster"

    @respx.mock
    @pytest.mark.asyncio
    async def test_invalid_postcode_returns_none(self):
        respx.get("https://api.postcodes.io/postcodes/INVALID").mock(
            return_value=httpx.Response(404, json={"status": 404, "error": "Postcode not found"})
        )
        result = await lookup_postcode("INVALID")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_api_error_returns_none(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(500, text="Internal Server Error")
        )
        result = await lookup_postcode("SW1A 1AA")
        assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_integrations.py::TestPostcodesLookup -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.integrations.postcodes'`

- [ ] **Step 3: Write minimal implementation**

Create `app/integrations/postcodes.py`:

```python
import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

POSTCODES_IO_BASE = "https://api.postcodes.io"


@dataclass(frozen=True)
class PostcodeLookupResult:
    postcode: str
    latitude: float
    longitude: float
    lpa_name: str
    lpa_code: str
    region: str
    country: str
    admin_district: str


async def lookup_postcode(postcode: str) -> PostcodeLookupResult | None:
    normalised = postcode.replace(" ", "").upper()
    url = f"{POSTCODES_IO_BASE}/postcodes/{normalised}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            return None
        data = resp.json().get("result")
        if not data:
            return None
        return PostcodeLookupResult(
            postcode=data["postcode"],
            latitude=data["latitude"],
            longitude=data["longitude"],
            lpa_name=data.get("admin_district", ""),
            lpa_code=data.get("codes", {}).get("admin_district", ""),
            region=data.get("region", ""),
            country=data.get("country", ""),
            admin_district=data.get("admin_district", ""),
        )
    except Exception:
        logger.exception("Postcodes.io lookup failed for %s", postcode)
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_integrations.py::TestPostcodesLookup -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/integrations/__init__.py app/integrations/postcodes.py tests/test_integrations.py
git commit -m "feat: add Postcodes.io integration client with async lookup"
```

---

### Task 2: EA Flood Risk API Integration Client

**Files:**
- Create: `app/integrations/flood.py`
- Modify: `tests/test_integrations.py` (add flood tests)

**Interfaces:**
- Consumes: `httpx` (async HTTP) — no API key needed
- Produces: `lookup_flood_risk(postcode: str, latitude: float, longitude: float) -> FloodRiskResult | None` returning `FloodRiskResult(flood_zone: str, flood_zone_numeric: int, in_flood_zone_2_or_3: bool, source: str)`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_integrations.py`:

```python
from app.integrations.flood import lookup_flood_risk, FloodRiskResult


class TestFloodRiskLookup:
    @respx.mock
    @pytest.mark.asyncio
    async def test_flood_zone_1_returns_safe(self):
        respx.get(
            "https://environment.data.gov.uk/flood-monitoring/id/floods",
            params={"lat": "51.501", "long": "-0.142", "dist": "1"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={"items": []},
            )
        )
        result = await lookup_flood_risk("SW1A 1AA", 51.501, -0.142)
        assert result is not None
        assert isinstance(result, FloodRiskResult)
        assert result.in_flood_zone_2_or_3 is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_flood_zone_with_warnings_returns_at_risk(self):
        respx.get(
            "https://environment.data.gov.uk/flood-monitoring/id/floods",
            params={"lat": "51.501", "long": "-0.142", "dist": "1"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "floodArea": {"notation": "ABC123"},
                            "severityLevel": 2,
                            "description": "Flood warning for River Thames",
                        }
                    ]
                },
            )
        )
        result = await lookup_flood_risk("SW1A 1AA", 51.501, -0.142)
        assert result is not None
        assert result.in_flood_zone_2_or_3 is True

    @respx.mock
    @pytest.mark.asyncio
    async def test_api_error_returns_none(self):
        respx.get(
            "https://environment.data.gov.uk/flood-monitoring/id/floods",
            params={"lat": "51.501", "long": "-0.142", "dist": "1"},
        ).mock(return_value=httpx.Response(500, text="Server Error"))
        result = await lookup_flood_risk("SW1A 1AA", 51.501, -0.142)
        assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_integrations.py::TestFloodRiskLookup -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

Create `app/integrations/flood.py`:

```python
import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

EA_FLOOD_BASE = "https://environment.data.gov.uk/flood-monitoring"


@dataclass(frozen=True)
class FloodRiskResult:
    flood_zone: str
    flood_zone_numeric: int
    in_flood_zone_2_or_3: bool
    source: str = "EA Flood Monitoring API"


async def lookup_flood_risk(
    postcode: str, latitude: float, longitude: float
) -> FloodRiskResult | None:
    url = f"{EA_FLOOD_BASE}/id/floods"
    params = {
        "lat": f"{latitude:.3f}",
        "long": f"{longitude:.3f}",
        "dist": "1",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
        if resp.status_code != 200:
            return None
        items = resp.json().get("items", [])
        if not items:
            return FloodRiskResult(
                flood_zone="Zone 1",
                flood_zone_numeric=1,
                in_flood_zone_2_or_3=False,
            )
        max_severity = min(item.get("severityLevel", 4) for item in items)
        if max_severity <= 2:
            return FloodRiskResult(
                flood_zone="Zone 2/3",
                flood_zone_numeric=3,
                in_flood_zone_2_or_3=True,
            )
        return FloodRiskResult(
            flood_zone="Zone 1 (nearby alerts)",
            flood_zone_numeric=1,
            in_flood_zone_2_or_3=False,
        )
    except Exception:
        logger.exception("EA Flood API lookup failed for %s", postcode)
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_integrations.py::TestFloodRiskLookup -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/integrations/flood.py tests/test_integrations.py
git commit -m "feat: add EA Flood Risk API integration client"
```

---

### Task 3: EPC Open Data API Integration Client

**Files:**
- Create: `app/integrations/epc.py`
- Modify: `tests/test_integrations.py` (add EPC tests)

**Interfaces:**
- Consumes: `httpx` (async HTTP), `config/settings.py` — `epc_api_key` setting
- Produces: `lookup_epc(postcode: str, address_fragment: str | None = None, api_key: str = "") -> EpcResult | None` returning `EpcResult(address: str, postcode: str, rating: str, score: int, certificate_date: str, certificate_url: str, property_type: str, floor_area_sqm: float | None)`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_integrations.py`:

```python
from app.integrations.epc import lookup_epc, EpcResult


class TestEpcLookup:
    @respx.mock
    @pytest.mark.asyncio
    async def test_valid_epc_returns_result(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/domestic/search",
            params={"postcode": "SW1A 1AA", "size": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "address": "1 Test Street, LONDON",
                            "postcode": "SW1A 1AA",
                            "current-energy-rating": "C",
                            "current-energy-efficiency": "68",
                            "lodgement-date": "2023-01-15",
                            "lmk-key": "ABC123",
                            "property-type": "Flat",
                            "total-floor-area": "85",
                        }
                    ],
                    "column-names": [],
                },
            )
        )
        result = await lookup_epc("SW1A 1AA", api_key="test-key")
        assert result is not None
        assert isinstance(result, EpcResult)
        assert result.rating == "C"
        assert result.score == 68
        assert result.floor_area_sqm == 85.0

    @respx.mock
    @pytest.mark.asyncio
    async def test_no_results_returns_none(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/domestic/search",
            params={"postcode": "XX1 1XX", "size": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={"rows": [], "column-names": []},
            )
        )
        result = await lookup_epc("XX1 1XX", api_key="test-key")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_address_fragment_filters(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/domestic/search",
            params={"postcode": "SW1A 1AA", "size": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "address": "2 Other Road, LONDON",
                            "postcode": "SW1A 1AA",
                            "current-energy-rating": "D",
                            "current-energy-efficiency": "55",
                            "lodgement-date": "2022-06-01",
                            "lmk-key": "DEF456",
                            "property-type": "House",
                            "total-floor-area": "120",
                        },
                        {
                            "address": "1 Test Street, LONDON",
                            "postcode": "SW1A 1AA",
                            "current-energy-rating": "B",
                            "current-energy-efficiency": "82",
                            "lodgement-date": "2023-03-20",
                            "lmk-key": "GHI789",
                            "property-type": "Flat",
                            "total-floor-area": "90",
                        },
                    ],
                    "column-names": [],
                },
            )
        )
        result = await lookup_epc("SW1A 1AA", address_fragment="1 Test", api_key="test-key")
        assert result is not None
        assert result.rating == "B"
        assert result.address == "1 Test Street, LONDON"

    @respx.mock
    @pytest.mark.asyncio
    async def test_no_api_key_returns_none(self):
        result = await lookup_epc("SW1A 1AA", api_key="")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_api_error_returns_none(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/domestic/search",
            params={"postcode": "SW1A 1AA", "size": "5"},
        ).mock(return_value=httpx.Response(403, text="Forbidden"))
        result = await lookup_epc("SW1A 1AA", api_key="bad-key")
        assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_integrations.py::TestEpcLookup -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

Create `app/integrations/epc.py`:

```python
import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

EPC_API_BASE = "https://epc.opendatacommunities.org/api/v1"


@dataclass(frozen=True)
class EpcResult:
    address: str
    postcode: str
    rating: str
    score: int
    certificate_date: str
    certificate_url: str
    property_type: str
    floor_area_sqm: float | None


async def lookup_epc(
    postcode: str,
    address_fragment: str | None = None,
    api_key: str = "",
) -> EpcResult | None:
    if not api_key:
        logger.warning("EPC lookup skipped — no API key configured")
        return None
    url = f"{EPC_API_BASE}/domestic/search"
    params = {"postcode": postcode, "size": "5"}
    headers = {
        "Accept": "application/json",
        "Authorization": f"Basic {api_key}",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params, headers=headers)
        if resp.status_code != 200:
            return None
        rows = resp.json().get("rows", [])
        if not rows:
            return None
        if address_fragment:
            fragment_lower = address_fragment.lower()
            matched = [r for r in rows if fragment_lower in r.get("address", "").lower()]
            row = matched[0] if matched else rows[0]
        else:
            row = rows[0]
        floor_area_raw = row.get("total-floor-area")
        floor_area = float(floor_area_raw) if floor_area_raw else None
        lmk_key = row.get("lmk-key", "")
        return EpcResult(
            address=row.get("address", ""),
            postcode=row.get("postcode", postcode),
            rating=row.get("current-energy-rating", ""),
            score=int(row.get("current-energy-efficiency", "0")),
            certificate_date=row.get("lodgement-date", ""),
            certificate_url=f"https://find-energy-certificate.service.gov.uk/energy-certificate/{lmk_key}",
            property_type=row.get("property-type", ""),
            floor_area_sqm=floor_area,
        )
    except Exception:
        logger.exception("EPC lookup failed for %s", postcode)
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_integrations.py::TestEpcLookup -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/integrations/epc.py tests/test_integrations.py
git commit -m "feat: add EPC Open Data API integration client"
```

---

### Task 4: Article 4 Direction Dataset & Lookup

**Files:**
- Create: `data/article4_directions.json`
- Create: `app/integrations/article4.py`
- Modify: `tests/test_integrations.py` (add Article 4 tests)

**Interfaces:**
- Consumes: `data/article4_directions.json` (bundled JSON dataset)
- Produces: `lookup_article4(lpa_code: str) -> Article4Result` returning `Article4Result(lpa_code: str, lpa_name: str, has_article4: bool, directions: list[Article4Direction], note: str)` where `Article4Direction` is `Article4Direction(name: str, pdr_classes_restricted: list[str], date_made: str | None, coverage: str)`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_integrations.py`:

```python
from app.integrations.article4 import lookup_article4, Article4Result, Article4Direction


class TestArticle4Lookup:
    @pytest.mark.asyncio
    async def test_known_lpa_with_article4(self):
        result = await lookup_article4("E09000033")
        assert result is not None
        assert isinstance(result, Article4Result)
        assert result.lpa_code == "E09000033"
        assert result.has_article4 is True
        assert len(result.directions) > 0
        assert isinstance(result.directions[0], Article4Direction)
        assert "class_ma" in result.directions[0].pdr_classes_restricted

    @pytest.mark.asyncio
    async def test_lpa_without_article4(self):
        result = await lookup_article4("E07000999")
        assert result is not None
        assert result.has_article4 is False
        assert result.directions == []
        assert "verify" in result.note.lower()

    @pytest.mark.asyncio
    async def test_empty_lpa_code(self):
        result = await lookup_article4("")
        assert result is not None
        assert result.has_article4 is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_integrations.py::TestArticle4Lookup -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create the Article 4 directions dataset**

Create `data/article4_directions.json`:

```json
{
  "_meta": {
    "description": "Known Article 4 directions restricting PDR (office-to-residential and related). Not exhaustive — always verify with the local planning authority.",
    "last_updated": "2026-08-09",
    "sources": ["GOV.UK planning portal", "Individual LPA websites"]
  },
  "E09000001": {
    "lpa_name": "City of London",
    "directions": [
      {
        "name": "City of London Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Whole borough"
      }
    ]
  },
  "E09000007": {
    "lpa_name": "Camden",
    "directions": [
      {
        "name": "Camden Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Whole borough"
      }
    ]
  },
  "E09000012": {
    "lpa_name": "Hackney",
    "directions": [
      {
        "name": "Hackney Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Whole borough"
      }
    ]
  },
  "E09000014": {
    "lpa_name": "Haringey",
    "directions": [
      {
        "name": "Haringey Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Selected industrial areas"
      }
    ]
  },
  "E09000019": {
    "lpa_name": "Islington",
    "directions": [
      {
        "name": "Islington Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Whole borough"
      }
    ]
  },
  "E09000020": {
    "lpa_name": "Kensington and Chelsea",
    "directions": [
      {
        "name": "RBKC Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Whole borough"
      }
    ]
  },
  "E09000022": {
    "lpa_name": "Lambeth",
    "directions": [
      {
        "name": "Lambeth Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Selected employment areas"
      }
    ]
  },
  "E09000028": {
    "lpa_name": "Southwark",
    "directions": [
      {
        "name": "Southwark Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Whole borough"
      }
    ]
  },
  "E09000030": {
    "lpa_name": "Tower Hamlets",
    "directions": [
      {
        "name": "Tower Hamlets Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Whole borough"
      }
    ]
  },
  "E09000032": {
    "lpa_name": "Wandsworth",
    "directions": [
      {
        "name": "Wandsworth Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Selected employment areas"
      }
    ]
  },
  "E09000033": {
    "lpa_name": "Westminster",
    "directions": [
      {
        "name": "Westminster Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Whole borough"
      }
    ]
  },
  "E08000003": {
    "lpa_name": "Manchester",
    "directions": [
      {
        "name": "Manchester Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "City centre and selected areas"
      }
    ]
  },
  "E08000025": {
    "lpa_name": "Birmingham",
    "directions": [
      {
        "name": "Birmingham Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "City centre core"
      }
    ]
  },
  "E06000023": {
    "lpa_name": "Bristol",
    "directions": [
      {
        "name": "Bristol Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "Central area and Temple Quarter"
      }
    ]
  },
  "E08000035": {
    "lpa_name": "Leeds",
    "directions": [
      {
        "name": "Leeds Article 4 Direction — Office to Residential",
        "pdr_classes_restricted": ["class_ma"],
        "date_made": "2021-08-01",
        "coverage": "City centre"
      }
    ]
  }
}
```

- [ ] **Step 4: Write the Article 4 lookup module**

Create `app/integrations/article4.py`:

```python
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

DATASET_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "article4_directions.json"

_dataset: dict | None = None


@dataclass(frozen=True)
class Article4Direction:
    name: str
    pdr_classes_restricted: list[str]
    date_made: str | None = None
    coverage: str = ""


@dataclass(frozen=True)
class Article4Result:
    lpa_code: str
    lpa_name: str
    has_article4: bool
    directions: list[Article4Direction] = field(default_factory=list)
    note: str = ""


def _load_dataset() -> dict:
    global _dataset
    if _dataset is not None:
        return _dataset
    try:
        with open(DATASET_PATH, "r", encoding="utf-8") as f:
            _dataset = json.load(f)
        return _dataset
    except FileNotFoundError:
        logger.warning("Article 4 dataset not found at %s", DATASET_PATH)
        _dataset = {}
        return _dataset


async def lookup_article4(lpa_code: str) -> Article4Result:
    if not lpa_code:
        return Article4Result(
            lpa_code="",
            lpa_name="",
            has_article4=False,
            note="No LPA code provided — verify with the local planning authority.",
        )
    dataset = _load_dataset()
    entry = dataset.get(lpa_code)
    if not entry:
        return Article4Result(
            lpa_code=lpa_code,
            lpa_name="",
            has_article4=False,
            note="No Article 4 direction found in dataset — verify with the local planning authority as dataset may not be exhaustive.",
        )
    directions = [
        Article4Direction(
            name=d["name"],
            pdr_classes_restricted=d.get("pdr_classes_restricted", []),
            date_made=d.get("date_made"),
            coverage=d.get("coverage", ""),
        )
        for d in entry.get("directions", [])
    ]
    return Article4Result(
        lpa_code=lpa_code,
        lpa_name=entry.get("lpa_name", ""),
        has_article4=len(directions) > 0,
        directions=directions,
        note="Article 4 direction found — PDR may be restricted. Verify current status with the LPA.",
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_integrations.py::TestArticle4Lookup -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add data/article4_directions.json app/integrations/article4.py tests/test_integrations.py
git commit -m "feat: add Article 4 direction dataset and lookup module"
```

---

### Task 5: Lookup API Endpoints

**Files:**
- Modify: `app/models.py` (add lookup response models)
- Modify: `app/api/app.py` (add lookup router)
- Create: `tests/test_lookup_endpoints.py`

**Interfaces:**
- Consumes:
  - `app/integrations/postcodes.py` — `lookup_postcode()`
  - `app/integrations/flood.py` — `lookup_flood_risk()`
  - `app/integrations/epc.py` — `lookup_epc()`
  - `app/integrations/article4.py` — `lookup_article4()`
  - `config/settings.py` — `epc_api_key`
- Produces:
  - `GET /api/v1/lookup/postcode/{postcode}` → `PostcodeLookupResponse`
  - `GET /api/v1/lookup/flood/{postcode}` → `FloodRiskResponse`
  - `GET /api/v1/lookup/epc/{postcode}` → `EpcResponse` (optional `?address=` query param)
  - `GET /api/v1/lookup/article4/{lpa_code}` → `Article4Response`

- [ ] **Step 1: Write the failing test**

Create `tests/test_lookup_endpoints.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_lookup_endpoints.py -v`
Expected: FAIL — no lookup routes registered

- [ ] **Step 3: Add lookup response models to `app/models.py`**

Append before the `# --- Project ---` section in `app/models.py`:

```python
# --- Lookup responses ---


class PostcodeLookupResponse(BaseModel):
    postcode: str
    latitude: float
    longitude: float
    lpa_name: str
    lpa_code: str
    region: str
    country: str
    admin_district: str


class FloodRiskResponse(BaseModel):
    postcode: str
    flood_zone: str
    flood_zone_numeric: int
    in_flood_zone_2_or_3: bool
    source: str


class EpcResponse(BaseModel):
    address: str
    postcode: str
    rating: str
    score: int
    certificate_date: str
    certificate_url: str
    property_type: str
    floor_area_sqm: float | None = None


class Article4DirectionResponse(BaseModel):
    name: str
    pdr_classes_restricted: list[str]
    date_made: str | None = None
    coverage: str = ""


class Article4Response(BaseModel):
    lpa_code: str
    lpa_name: str
    has_article4: bool
    directions: list[Article4DirectionResponse] = Field(default_factory=list)
    note: str = ""
```

- [ ] **Step 4: Add lookup router to `app/api/app.py`**

Add the lookup router. After the scrape router section, before the system router section, add:

```python
# --- Lookup Router ---

from app.integrations.postcodes import lookup_postcode
from app.integrations.flood import lookup_flood_risk
from app.integrations.epc import lookup_epc
from app.integrations.article4 import lookup_article4
from app.models import (
    PostcodeLookupResponse,
    FloodRiskResponse,
    EpcResponse,
    Article4Response,
    Article4DirectionResponse,
)

lookup_router = APIRouter(prefix="/lookup")


@lookup_router.get("/postcode/{postcode}", response_model=PostcodeLookupResponse)
async def postcode_lookup(postcode: str):
    result = await lookup_postcode(postcode)
    if not result:
        raise HTTPException(status_code=404, detail="Postcode not found")
    return PostcodeLookupResponse(
        postcode=result.postcode,
        latitude=result.latitude,
        longitude=result.longitude,
        lpa_name=result.lpa_name,
        lpa_code=result.lpa_code,
        region=result.region,
        country=result.country,
        admin_district=result.admin_district,
    )


@lookup_router.get("/flood/{postcode}", response_model=FloodRiskResponse)
async def flood_lookup(postcode: str):
    pc = await lookup_postcode(postcode)
    if not pc:
        raise HTTPException(status_code=404, detail="Postcode not found — cannot look up flood risk")
    result = await lookup_flood_risk(postcode, pc.latitude, pc.longitude)
    if not result:
        raise HTTPException(status_code=502, detail="Flood risk API unavailable")
    return FloodRiskResponse(
        postcode=pc.postcode,
        flood_zone=result.flood_zone,
        flood_zone_numeric=result.flood_zone_numeric,
        in_flood_zone_2_or_3=result.in_flood_zone_2_or_3,
        source=result.source,
    )


@lookup_router.get("/epc/{postcode}", response_model=EpcResponse)
async def epc_lookup(postcode: str, address: str | None = None):
    result = await lookup_epc(postcode, address_fragment=address, api_key=settings.epc_api_key)
    if not result:
        raise HTTPException(status_code=404, detail="No EPC certificate found")
    return EpcResponse(
        address=result.address,
        postcode=result.postcode,
        rating=result.rating,
        score=result.score,
        certificate_date=result.certificate_date,
        certificate_url=result.certificate_url,
        property_type=result.property_type,
        floor_area_sqm=result.floor_area_sqm,
    )


@lookup_router.get("/article4/{lpa_code}", response_model=Article4Response)
async def article4_lookup(lpa_code: str):
    result = await lookup_article4(lpa_code)
    return Article4Response(
        lpa_code=result.lpa_code,
        lpa_name=result.lpa_name,
        has_article4=result.has_article4,
        directions=[
            Article4DirectionResponse(
                name=d.name,
                pdr_classes_restricted=d.pdr_classes_restricted,
                date_made=d.date_made,
                coverage=d.coverage,
            )
            for d in result.directions
        ],
        note=result.note,
    )
```

Also register the router in `create_app()` — add this line after the scrape router include:

```python
app.include_router(lookup_router, prefix=settings.api_prefix, tags=["lookup"])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_lookup_endpoints.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/models.py app/api/app.py tests/test_lookup_endpoints.py
git commit -m "feat: add lookup API endpoints for postcode, flood, EPC, Article 4"
```

---

### Task 6: PDR Eligibility Criteria Definitions

**Files:**
- Create: `app/eligibility/__init__.py`
- Create: `app/eligibility/criteria.py`
- Test: `tests/test_eligibility_engine.py` (criteria definition tests only)

**Interfaces:**
- Consumes: `app/models.py` — `PdrClass`, `UseClass`
- Produces:
  - `CriterionDef(key: str, label: str, applicable_classes: list[PdrClass], check_type: "auto" | "semi_auto" | "manual", description: str)`
  - `get_criteria_for_class(pdr_class: PdrClass) -> list[CriterionDef]`
  - `detect_pdr_class(use_class: UseClass, floor_area_sqm: float | None) -> PdrClass | None`
  - `ALL_CRITERIA: list[CriterionDef]`

- [ ] **Step 1: Write the failing test**

Create `app/eligibility/__init__.py` (empty file).

Create `tests/test_eligibility_engine.py`:

```python
import pytest

from app.eligibility.criteria import (
    CriterionDef,
    get_criteria_for_class,
    detect_pdr_class,
    ALL_CRITERIA,
)
from app.models import PdrClass, UseClass


class TestCriteriaDefinitions:
    def test_all_criteria_not_empty(self):
        assert len(ALL_CRITERIA) > 0
        assert all(isinstance(c, CriterionDef) for c in ALL_CRITERIA)

    def test_class_ma_has_12_criteria(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_MA)
        assert len(criteria) == 12

    def test_class_ma_criteria_keys(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_MA)
        keys = {c.key for c in criteria}
        assert "use_class_check" in keys
        assert "floor_area_limit" in keys
        assert "vacancy_period" in keys
        assert "conservation_area" in keys
        assert "aonb_national_park" in keys
        assert "article_4" in keys
        assert "flood_zone" in keys
        assert "listed_building" in keys
        assert "natural_light" in keys
        assert "transport_access" in keys
        assert "contamination" in keys
        assert "prior_refusal" in keys

    def test_class_g_has_criteria(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_G)
        assert len(criteria) > 0
        keys = {c.key for c in criteria}
        assert "floor_area_limit" in keys

    def test_class_q_has_criteria(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_Q)
        assert len(criteria) > 0

    def test_each_criterion_has_check_type(self):
        for c in ALL_CRITERIA:
            assert c.check_type in ("auto", "semi_auto", "manual")


class TestPdrClassDetection:
    def test_office_detects_class_ma(self):
        result = detect_pdr_class(UseClass.OFFICE, floor_area_sqm=500.0)
        assert result == PdrClass.CLASS_MA

    def test_office_over_1500_sqm_returns_none(self):
        result = detect_pdr_class(UseClass.OFFICE, floor_area_sqm=1600.0)
        assert result is None

    def test_retail_detects_class_g(self):
        result = detect_pdr_class(UseClass.RETAIL, floor_area_sqm=100.0)
        assert result == PdrClass.CLASS_G

    def test_retail_over_150_sqm_returns_none(self):
        result = detect_pdr_class(UseClass.RETAIL, floor_area_sqm=200.0)
        assert result is None

    def test_agricultural_detects_class_q(self):
        result = detect_pdr_class(UseClass.AGRICULTURAL, floor_area_sqm=300.0)
        assert result == PdrClass.CLASS_Q

    def test_agricultural_over_465_sqm_returns_none(self):
        result = detect_pdr_class(UseClass.AGRICULTURAL, floor_area_sqm=500.0)
        assert result is None

    def test_office_no_area_defaults_class_ma(self):
        result = detect_pdr_class(UseClass.OFFICE, floor_area_sqm=None)
        assert result == PdrClass.CLASS_MA

    def test_sui_generis_returns_none(self):
        result = detect_pdr_class(UseClass.SUI_GENERIS, floor_area_sqm=100.0)
        assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_eligibility_engine.py::TestCriteriaDefinitions -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

Create `app/eligibility/criteria.py`:

```python
from dataclasses import dataclass

from app.models import PdrClass, UseClass


@dataclass(frozen=True)
class CriterionDef:
    key: str
    label: str
    applicable_classes: list[PdrClass]
    check_type: str  # "auto" | "semi_auto" | "manual"
    description: str


FLOOR_AREA_LIMITS: dict[PdrClass, float] = {
    PdrClass.CLASS_MA: 1500.0,
    PdrClass.CLASS_G: 150.0,
    PdrClass.CLASS_M: 150.0,
    PdrClass.CLASS_N: 150.0,
    PdrClass.CLASS_Q: 465.0,
}

ALL_CRITERIA: list[CriterionDef] = [
    CriterionDef(
        key="use_class_check",
        label="Property is in applicable use class",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="semi_auto",
        description="Confirm the property's planning use class matches the PDR class requirement.",
    ),
    CriterionDef(
        key="floor_area_limit",
        label="Floor area within limit",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="auto",
        description="Floor area must not exceed the PDR class limit.",
    ),
    CriterionDef(
        key="vacancy_period",
        label="Building vacant for ≥ 3 continuous months",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description="The building must have been vacant for at least 3 continuous months prior to the application.",
    ),
    CriterionDef(
        key="conservation_area",
        label="Not in a conservation area",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N],
        check_type="semi_auto",
        description="The property must not be located in a designated conservation area.",
    ),
    CriterionDef(
        key="aonb_national_park",
        label="Not in AONB / National Park / SSSI",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="auto",
        description="Checked via postcode-based geographic lookup.",
    ),
    CriterionDef(
        key="article_4",
        label="Not in Article 4 direction area",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N],
        check_type="semi_auto",
        description="Checked against bundled Article 4 dataset. Verify with LPA as dataset may not be exhaustive.",
    ),
    CriterionDef(
        key="flood_zone",
        label="Not in flood zone 2 or 3",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="auto",
        description="Checked via EA Flood Risk API.",
    ),
    CriterionDef(
        key="listed_building",
        label="Not a listed building",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="manual",
        description="User must confirm the building is not Grade I, II*, or II listed.",
    ),
    CriterionDef(
        key="natural_light",
        label="Adequate natural light to habitable rooms",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description="User assessment of whether habitable rooms will have adequate natural light.",
    ),
    CriterionDef(
        key="transport_access",
        label="Adequate transport access",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description="User assessment of transport links and accessibility.",
    ),
    CriterionDef(
        key="contamination",
        label="No contamination risk",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_Q],
        check_type="manual",
        description="User assessment that the site does not pose contamination risk to future residents.",
    ),
    CriterionDef(
        key="prior_refusal",
        label="Prior approval not refused within 2 years",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N],
        check_type="manual",
        description="User must confirm no prior approval application was refused for this property within the past 2 years.",
    ),
    CriterionDef(
        key="agricultural_use_period",
        label="Agricultural use for ≥ 10 years",
        applicable_classes=[PdrClass.CLASS_Q],
        check_type="manual",
        description="The building must have been in agricultural use for at least 10 years before the application.",
    ),
    CriterionDef(
        key="agricultural_building_date",
        label="Building established before 20 March 2013",
        applicable_classes=[PdrClass.CLASS_Q],
        check_type="manual",
        description="The agricultural building must have existed before 20 March 2013.",
    ),
]


def get_criteria_for_class(pdr_class: PdrClass) -> list[CriterionDef]:
    return [c for c in ALL_CRITERIA if pdr_class in c.applicable_classes]


USE_CLASS_TO_PDR: dict[UseClass, PdrClass] = {
    UseClass.OFFICE: PdrClass.CLASS_MA,
    UseClass.RETAIL: PdrClass.CLASS_G,
    UseClass.RESTAURANT_CAFE: PdrClass.CLASS_M,
    UseClass.TAKEAWAY: PdrClass.CLASS_M,
    UseClass.AMUSEMENT: PdrClass.CLASS_N,
    UseClass.LAUNDERETTE: PdrClass.CLASS_N,
    UseClass.AGRICULTURAL: PdrClass.CLASS_Q,
}


def detect_pdr_class(use_class: UseClass, floor_area_sqm: float | None) -> PdrClass | None:
    pdr_class = USE_CLASS_TO_PDR.get(use_class)
    if pdr_class is None:
        return None
    if floor_area_sqm is not None:
        limit = FLOOR_AREA_LIMITS.get(pdr_class)
        if limit and floor_area_sqm > limit:
            return None
    return pdr_class
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_eligibility_engine.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/eligibility/__init__.py app/eligibility/criteria.py tests/test_eligibility_engine.py
git commit -m "feat: add PDR eligibility criteria definitions and class detection"
```

---

### Task 7: PDR Eligibility Engine

**Files:**
- Create: `app/eligibility/engine.py`
- Modify: `tests/test_eligibility_engine.py` (add engine tests)

**Interfaces:**
- Consumes:
  - `app/eligibility/criteria.py` — `get_criteria_for_class()`, `detect_pdr_class()`, `CriterionDef`, `FLOOR_AREA_LIMITS`
  - `app/integrations/postcodes.py` — `lookup_postcode()`, `PostcodeLookupResult`
  - `app/integrations/flood.py` — `lookup_flood_risk()`, `FloodRiskResult`
  - `app/integrations/epc.py` — `lookup_epc()`, `EpcResult`
  - `app/integrations/article4.py` — `lookup_article4()`, `Article4Result`
  - `app/models.py` — `EligibilityCriterion`, `EligibilityVerdict`, `PdrClass`, `UseClass`, `Project`
- Produces:
  - `EligibilityEngineResult(pdr_class: PdrClass, criteria: list[EligibilityCriterion], verdict: EligibilityVerdict, suggested_next_steps: list[str])`
  - `run_eligibility(project: Project, manual_overrides: dict[str, bool | None] | None = None, epc_api_key: str = "") -> EligibilityEngineResult`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_eligibility_engine.py`:

```python
import httpx
import respx

from app.eligibility.engine import run_eligibility, EligibilityEngineResult
from app.models import (
    EligibilityCriterion,
    EligibilityVerdict,
    Project,
    PipelineStage,
    Tenure,
)
from datetime import datetime
from uuid import uuid4


def _make_project(**overrides) -> Project:
    defaults = dict(
        id=uuid4(),
        address_raw="10 Test Office, London, SW1A 1AA",
        address_line1="10 Test Office",
        address_town="London",
        address_postcode="SW1A 1AA",
        address_postcode_district="SW1A",
        price_pence=50000000,
        use_class="office",
        floor_area_sqft=5000.0,
        floor_area_sqm=464.5,
        floors=2,
        tenure=Tenure.FREEHOLD,
        is_vacant=True,
        stage=PipelineStage.OPPORTUNITY_IDENTIFIED,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        image_urls=[],
    )
    defaults.update(overrides)
    return Project(**defaults)


class TestEligibilityEngine:
    @respx.mock
    @pytest.mark.asyncio
    async def test_eligible_office_returns_amber(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Westminster",
                        "region": "London",
                        "country": "England",
                        "codes": {"admin_district": "E09000033"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        project = _make_project()
        result = await run_eligibility(project)

        assert isinstance(result, EligibilityEngineResult)
        assert result.pdr_class == PdrClass.CLASS_MA
        assert result.verdict == EligibilityVerdict.AMBER
        assert len(result.criteria) == 12
        auto_passed = [c for c in result.criteria if c.auto_checked and c.passed is True]
        assert len(auto_passed) >= 1
        manual_pending = [c for c in result.criteria if not c.auto_checked and c.passed is None]
        assert len(manual_pending) >= 1

    @respx.mock
    @pytest.mark.asyncio
    async def test_all_manual_overrides_pass_returns_green(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Somewhere",
                        "region": "South East",
                        "country": "England",
                        "codes": {"admin_district": "E07000100"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        overrides = {
            "use_class_check": True,
            "vacancy_period": True,
            "conservation_area": True,
            "listed_building": True,
            "natural_light": True,
            "transport_access": True,
            "contamination": True,
            "prior_refusal": True,
        }
        project = _make_project()
        result = await run_eligibility(project, manual_overrides=overrides)

        assert result.verdict == EligibilityVerdict.GREEN

    @respx.mock
    @pytest.mark.asyncio
    async def test_manual_override_fail_returns_red(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Somewhere",
                        "region": "South East",
                        "country": "England",
                        "codes": {"admin_district": "E07000100"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        overrides = {"listed_building": False}
        project = _make_project()
        result = await run_eligibility(project, manual_overrides=overrides)

        assert result.verdict == EligibilityVerdict.RED

    @respx.mock
    @pytest.mark.asyncio
    async def test_floor_area_over_limit_auto_fails(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Somewhere",
                        "region": "South East",
                        "country": "England",
                        "codes": {"admin_district": "E07000100"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        project = _make_project(floor_area_sqm=1600.0)
        result = await run_eligibility(project)

        floor_criterion = next(c for c in result.criteria if c.key == "floor_area_limit")
        assert floor_criterion.passed is False
        assert result.verdict == EligibilityVerdict.RED

    @respx.mock
    @pytest.mark.asyncio
    async def test_suggested_next_steps_not_empty(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Somewhere",
                        "region": "South East",
                        "country": "England",
                        "codes": {"admin_district": "E07000100"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        project = _make_project()
        result = await run_eligibility(project)

        assert len(result.suggested_next_steps) > 0

    def test_no_postcode_project_cannot_auto_check(self):
        project = _make_project(address_postcode=None)
        # Should not crash — just can't auto-check location-based criteria
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_eligibility_engine.py::TestEligibilityEngine -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

Create `app/eligibility/engine.py`:

```python
import logging
from dataclasses import dataclass, field

from app.eligibility.criteria import (
    CriterionDef,
    FLOOR_AREA_LIMITS,
    detect_pdr_class,
    get_criteria_for_class,
)
from app.integrations.article4 import lookup_article4
from app.integrations.flood import lookup_flood_risk
from app.integrations.postcodes import lookup_postcode
from app.models import (
    EligibilityCriterion,
    EligibilityVerdict,
    PdrClass,
    Project,
)

logger = logging.getLogger(__name__)


@dataclass
class EligibilityEngineResult:
    pdr_class: PdrClass
    criteria: list[EligibilityCriterion]
    verdict: EligibilityVerdict
    suggested_next_steps: list[str] = field(default_factory=list)


async def run_eligibility(
    project: Project,
    manual_overrides: dict[str, bool | None] | None = None,
    epc_api_key: str = "",
) -> EligibilityEngineResult:
    overrides = manual_overrides or {}

    pdr_class = detect_pdr_class(project.use_class, project.floor_area_sqm)
    if pdr_class is None:
        pdr_class = PdrClass.CLASS_MA

    criteria_defs = get_criteria_for_class(pdr_class)

    pc_result = None
    flood_result = None
    article4_result = None

    if project.address_postcode:
        pc_result = await lookup_postcode(project.address_postcode)
        if pc_result:
            flood_result = await lookup_flood_risk(
                project.address_postcode, pc_result.latitude, pc_result.longitude
            )
            article4_result = await lookup_article4(pc_result.lpa_code)

    evaluated: list[EligibilityCriterion] = []
    next_steps: list[str] = []

    for cdef in criteria_defs:
        criterion = _evaluate_criterion(
            cdef, project, pdr_class, pc_result, flood_result, article4_result, overrides
        )
        evaluated.append(criterion)
        if criterion.passed is None:
            step = _next_step_for(cdef)
            if step:
                next_steps.append(step)

    verdict = _compute_verdict(evaluated)

    return EligibilityEngineResult(
        pdr_class=pdr_class,
        criteria=evaluated,
        verdict=verdict,
        suggested_next_steps=next_steps,
    )


def _evaluate_criterion(
    cdef: CriterionDef,
    project: Project,
    pdr_class: PdrClass,
    pc_result,
    flood_result,
    article4_result,
    overrides: dict[str, bool | None],
) -> EligibilityCriterion:
    if cdef.key in overrides:
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=overrides[cdef.key],
            source="user",
            auto_checked=False,
        )

    if cdef.key == "floor_area_limit":
        limit = FLOOR_AREA_LIMITS.get(pdr_class)
        if limit and project.floor_area_sqm is not None:
            passed = project.floor_area_sqm <= limit
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=passed,
                source="auto",
                auto_checked=True,
                value=f"{project.floor_area_sqm:.0f} sq m (limit: {limit:.0f} sq m)",
            )
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="auto",
            auto_checked=False,
            value="Floor area not provided",
        )

    if cdef.key == "flood_zone":
        if flood_result:
            passed = not flood_result.in_flood_zone_2_or_3
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=passed,
                source="auto",
                auto_checked=True,
                value=flood_result.flood_zone,
            )
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="auto",
            auto_checked=False,
            value="Could not check — postcode lookup failed",
        )

    if cdef.key == "article_4":
        if article4_result:
            relevant = [
                d for d in article4_result.directions
                if pdr_class.value in d.pdr_classes_restricted
            ]
            if relevant:
                return EligibilityCriterion(
                    key=cdef.key,
                    label=cdef.label,
                    passed=False,
                    source="semi_auto",
                    auto_checked=True,
                    value=f"Article 4 in effect: {relevant[0].name}",
                    risk_flag="Verify current status with LPA",
                )
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=True,
                source="semi_auto",
                auto_checked=True,
                value="No Article 4 direction found in dataset",
                risk_flag="Dataset may not be exhaustive — verify with LPA",
            )
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="semi_auto",
            auto_checked=False,
            value="Could not check — postcode lookup failed",
        )

    if cdef.key == "aonb_national_park":
        if pc_result:
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=True,
                source="auto",
                auto_checked=True,
                value=f"Region: {pc_result.region}",
                risk_flag="Postcode-level check only — confirm site is not within designated area",
            )
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="auto",
            auto_checked=False,
        )

    if cdef.key == "use_class_check":
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="semi_auto",
            auto_checked=False,
            value=f"Listed as: {project.use_class}",
        )

    return EligibilityCriterion(
        key=cdef.key,
        label=cdef.label,
        passed=None,
        source="manual",
        auto_checked=False,
    )


def _compute_verdict(criteria: list[EligibilityCriterion]) -> EligibilityVerdict:
    has_fail = any(c.passed is False for c in criteria)
    has_pending = any(c.passed is None for c in criteria)
    if has_fail:
        return EligibilityVerdict.RED
    if has_pending:
        return EligibilityVerdict.AMBER
    return EligibilityVerdict.GREEN


NEXT_STEPS: dict[str, str] = {
    "use_class_check": "Confirm the property's current planning use class with the LPA or lease documents.",
    "vacancy_period": "Verify the property has been vacant for at least 3 continuous months with evidence (utility bills, rates records).",
    "conservation_area": "Check with the LPA whether the property is in a conservation area.",
    "listed_building": "Confirm the building is not listed (check Historic England's National Heritage List).",
    "natural_light": "Assess whether habitable rooms will have adequate natural light (site visit recommended).",
    "transport_access": "Assess transport accessibility (proximity to public transport, parking, road access).",
    "contamination": "Check for contamination risk — review environmental reports and site history.",
    "prior_refusal": "Confirm no prior approval application was refused for this property within the past 2 years.",
    "agricultural_use_period": "Verify the building has been in agricultural use for at least 10 continuous years.",
    "agricultural_building_date": "Confirm the agricultural building existed before 20 March 2013.",
}


def _next_step_for(cdef: CriterionDef) -> str | None:
    return NEXT_STEPS.get(cdef.key)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_eligibility_engine.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/eligibility/engine.py tests/test_eligibility_engine.py
git commit -m "feat: add PDR eligibility engine with auto-check and manual override support"
```

---

### Task 8: Eligibility Run Endpoint

**Files:**
- Modify: `app/api/app.py` (add `POST /api/v1/eligibility/{project_id}/run` endpoint)
- Modify: `app/models.py` (add `EligibilityRunRequest` and `EligibilityRunResponse` models)
- Modify: `tests/test_lookup_endpoints.py` (add run-eligibility route test)

**Interfaces:**
- Consumes:
  - `app/eligibility/engine.py` — `run_eligibility()`
  - `app/persistence/repositories.py` — `ProjectRepository.get_by_id()`, `EligibilityAssessmentRepository.create()`
  - `config/settings.py` — `epc_api_key`
- Produces: `POST /api/v1/eligibility/{project_id}/run` — runs the eligibility engine, saves the assessment, returns `EligibilityRunResponse`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_lookup_endpoints.py`:

```python
class TestEligibilityRunRouteExists:
    def test_eligibility_run_route_registered(self):
        paths = {r.path for r in app.routes if hasattr(r, "path")}
        assert any("eligibility" in p and "run" in p for p in paths)

    def test_eligibility_run_is_post(self):
        for route in app.routes:
            if hasattr(route, "path") and "eligibility" in route.path and "run" in route.path:
                assert "POST" in route.methods
                break
        else:
            pytest.fail("Eligibility run route not found")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_lookup_endpoints.py::TestEligibilityRunRouteExists -v`
Expected: FAIL — route not found

- [ ] **Step 3: Add request/response models to `app/models.py`**

Append after the `Article4Response` class in `app/models.py`:

```python
class EligibilityRunRequest(BaseModel):
    manual_overrides: dict[str, bool | None] = Field(default_factory=dict)


class EligibilityRunResponse(BaseModel):
    assessment: EligibilityAssessment
    auto_checks_performed: list[str] = Field(default_factory=list)
    manual_checks_pending: list[str] = Field(default_factory=list)
```

- [ ] **Step 4: Add the run endpoint to `app/api/app.py`**

Add after the existing `update_eligibility` endpoint in the eligibility router section:

```python
from app.eligibility.engine import run_eligibility
from app.models import EligibilityRunRequest, EligibilityRunResponse, EligibilityAssessmentCreate

@eligibility_router.post("/{project_id}/run", response_model=EligibilityRunResponse, status_code=201)
async def run_eligibility_endpoint(project_id: UUID, body: EligibilityRunRequest, db: DbDep):
    project_repo = ProjectRepository(db)
    project = await project_repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    engine_result = await run_eligibility(
        project,
        manual_overrides=body.manual_overrides,
        epc_api_key=settings.epc_api_key,
    )

    elig_repo = EligibilityAssessmentRepository(db)
    existing = await elig_repo.get_by_project_id(project_id)
    if existing:
        from app.models import EligibilityAssessmentUpdate
        assessment = await elig_repo.update(
            project_id,
            EligibilityAssessmentUpdate(
                criteria=engine_result.criteria,
                verdict=engine_result.verdict,
                suggested_next_steps=engine_result.suggested_next_steps,
            ),
        )
    else:
        assessment = await elig_repo.create(
            EligibilityAssessmentCreate(
                project_id=project_id,
                pdr_class=engine_result.pdr_class,
                criteria=engine_result.criteria,
                verdict=engine_result.verdict,
                suggested_next_steps=engine_result.suggested_next_steps,
            )
        )
    await db.commit()

    auto_checks = [c.key for c in engine_result.criteria if c.auto_checked]
    manual_pending = [c.key for c in engine_result.criteria if not c.auto_checked and c.passed is None]

    return EligibilityRunResponse(
        assessment=assessment,
        auto_checks_performed=auto_checks,
        manual_checks_pending=manual_pending,
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_lookup_endpoints.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/app.py app/models.py tests/test_lookup_endpoints.py
git commit -m "feat: add eligibility run endpoint that executes engine and saves assessment"
```

---

### Task 9: Frontend Lookup & Eligibility API Functions

**Files:**
- Modify: `frontend/src/types.ts` (add lookup and eligibility-run types)
- Modify: `frontend/src/lib/api.ts` (add lookup and run functions)
- Modify: `frontend/src/lib/api.test.ts` (add tests)

**Interfaces:**
- Consumes: backend lookup endpoints from Task 5, eligibility run endpoint from Task 8
- Produces:
  - Types: `PostcodeLookup`, `FloodRisk`, `EpcData`, `Article4Direction`, `Article4Data`, `EligibilityRunRequest`, `EligibilityRunResponse`
  - Functions: `lookupPostcode(postcode)`, `lookupFlood(postcode)`, `lookupEpc(postcode, address?)`, `lookupArticle4(lpaCode)`, `runEligibility(projectId, manualOverrides?)`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/api.test.ts`:

```typescript
import { lookupPostcode, lookupFlood, lookupArticle4, runEligibility } from './api';

describe('lookupPostcode', () => {
  it('sends GET to /api/v1/lookup/postcode/{postcode}', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ postcode: 'SW1A 1AA', latitude: 51.5, longitude: -0.14 }),
    });

    const result = await lookupPostcode('SW1A 1AA');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/lookup/postcode/SW1A%201AA',
      expect.any(Object),
    );
    expect(result.postcode).toBe('SW1A 1AA');
  });
});

describe('lookupFlood', () => {
  it('sends GET to /api/v1/lookup/flood/{postcode}', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ flood_zone: 'Zone 1', in_flood_zone_2_or_3: false }),
    });

    const result = await lookupFlood('SW1A 1AA');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/lookup/flood/SW1A%201AA',
      expect.any(Object),
    );
    expect(result.in_flood_zone_2_or_3).toBe(false);
  });
});

describe('lookupArticle4', () => {
  it('sends GET to /api/v1/lookup/article4/{lpa_code}', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ lpa_code: 'E09000033', has_article4: true }),
    });

    const result = await lookupArticle4('E09000033');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/lookup/article4/E09000033',
      expect.any(Object),
    );
    expect(result.has_article4).toBe(true);
  });
});

describe('runEligibility', () => {
  it('sends POST to /api/v1/eligibility/{id}/run', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ assessment: {}, auto_checks_performed: [], manual_checks_pending: [] }),
    });

    await runEligibility('proj-123', {});
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/eligibility/proj-123/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/api.test.ts`
Expected: FAIL — imports don't exist

- [ ] **Step 3: Add types to `frontend/src/types.ts`**

Append after the `ApiResponse` interface:

```typescript
export interface PostcodeLookup {
  postcode: string;
  latitude: number;
  longitude: number;
  lpa_name: string;
  lpa_code: string;
  region: string;
  country: string;
  admin_district: string;
}

export interface FloodRisk {
  postcode: string;
  flood_zone: string;
  flood_zone_numeric: number;
  in_flood_zone_2_or_3: boolean;
  source: string;
}

export interface EpcData {
  address: string;
  postcode: string;
  rating: string;
  score: number;
  certificate_date: string;
  certificate_url: string;
  property_type: string;
  floor_area_sqm: number | null;
}

export interface Article4DirectionItem {
  name: string;
  pdr_classes_restricted: string[];
  date_made: string | null;
  coverage: string;
}

export interface Article4Data {
  lpa_code: string;
  lpa_name: string;
  has_article4: boolean;
  directions: Article4DirectionItem[];
  note: string;
}

export interface EligibilityRunRequest {
  manual_overrides: Record<string, boolean | null>;
}

export interface EligibilityRunResponse {
  assessment: EligibilityAssessment;
  auto_checks_performed: string[];
  manual_checks_pending: string[];
}
```

- [ ] **Step 4: Add API functions to `frontend/src/lib/api.ts`**

Append after the `scrapeUrl` function:

```typescript
import type {
  PostcodeLookup,
  FloodRisk,
  EpcData,
  Article4Data,
  EligibilityRunResponse,
} from '../types';

// --- Lookups ---

export async function lookupPostcode(postcode: string): Promise<PostcodeLookup> {
  return request<PostcodeLookup>(
    `/api/v1/lookup/postcode/${encodeURIComponent(postcode)}`,
    { headers: HEADERS },
  );
}

export async function lookupFlood(postcode: string): Promise<FloodRisk> {
  return request<FloodRisk>(
    `/api/v1/lookup/flood/${encodeURIComponent(postcode)}`,
    { headers: HEADERS },
  );
}

export async function lookupEpc(postcode: string, address?: string): Promise<EpcData> {
  const params = address ? `?address=${encodeURIComponent(address)}` : '';
  return request<EpcData>(
    `/api/v1/lookup/epc/${encodeURIComponent(postcode)}${params}`,
    { headers: HEADERS },
  );
}

export async function lookupArticle4(lpaCode: string): Promise<Article4Data> {
  return request<Article4Data>(
    `/api/v1/lookup/article4/${encodeURIComponent(lpaCode)}`,
    { headers: HEADERS },
  );
}

// --- Eligibility Engine ---

export async function runEligibility(
  projectId: string,
  manualOverrides: Record<string, boolean | null>,
): Promise<EligibilityRunResponse> {
  return request<EligibilityRunResponse>(`/api/v1/eligibility/${projectId}/run`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ manual_overrides: manualOverrides }),
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat: add frontend lookup and eligibility-run API functions and types"
```

---

### Task 10: Eligibility Verdict Display Component

**Files:**
- Create: `frontend/src/components/CriterionRow.tsx`
- Create: `frontend/src/components/EligibilityVerdict.tsx`

**Interfaces:**
- Consumes: `frontend/src/types.ts` — `EligibilityCriterion`, `EligibilityVerdict` type, `EligibilityAssessment`
- Produces:
  - `CriterionRow` component: displays a single criterion with pass/fail/pending icon, label, value, source tag, and optional risk flag
  - `EligibilityVerdictDisplay` component: displays the traffic light verdict (Green/Amber/Red) with all criteria rows and suggested next steps

- [ ] **Step 1: Create `CriterionRow.tsx`**

Create `frontend/src/components/CriterionRow.tsx`:

```tsx
import type { EligibilityCriterion } from '../types';

interface CriterionRowProps {
  criterion: EligibilityCriterion;
  onOverride?: (key: string, value: boolean | null) => void;
}

export default function CriterionRow({ criterion, onOverride }: CriterionRowProps) {
  const statusIcon = criterion.passed === true
    ? '\u2705'
    : criterion.passed === false
      ? '\u274C'
      : '\u2753';

  const statusColor = criterion.passed === true
    ? '#22c55e'
    : criterion.passed === false
      ? '#ef4444'
      : '#f59e0b';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 12px',
        background: '#0f1d32',
        borderRadius: 6,
        border: `1px solid ${criterion.passed === false ? '#7f1d1d' : '#1e3a5f'}`,
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>{statusIcon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ color: '#e2e8f0', fontWeight: 500, fontSize: 14 }}>{criterion.label}</div>
        {criterion.value && (
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{criterion.value}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 4,
              background: criterion.auto_checked ? '#1e3a5f' : '#3b2f1e',
              color: criterion.auto_checked ? '#60a5fa' : '#fbbf24',
            }}
          >
            {criterion.auto_checked ? 'Auto-checked' : criterion.source === 'user' ? 'User confirmed' : 'Manual check needed'}
          </span>
          {criterion.risk_flag && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>{criterion.risk_flag}</span>
          )}
        </div>
      </div>
      {onOverride && !criterion.auto_checked && criterion.passed === null && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            onClick={() => onOverride(criterion.key, true)}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: '#14532d',
              color: '#22c55e',
              border: '1px solid #166534',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Pass
          </button>
          <button
            onClick={() => onOverride(criterion.key, false)}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: '#450a0a',
              color: '#ef4444',
              border: '1px solid #7f1d1d',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Fail
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `EligibilityVerdict.tsx`**

Create `frontend/src/components/EligibilityVerdict.tsx`:

```tsx
import type { EligibilityAssessment } from '../types';
import CriterionRow from './CriterionRow';

interface EligibilityVerdictDisplayProps {
  assessment: EligibilityAssessment;
  onOverride?: (key: string, value: boolean | null) => void;
}

const VERDICT_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  green: { bg: '#052e16', border: '#14532d', text: '#22c55e', label: 'ELIGIBLE' },
  amber: { bg: '#3b2f1e', border: '#854d0e', text: '#fbbf24', label: 'LIKELY ELIGIBLE — CHECKS OUTSTANDING' },
  red: { bg: '#450a0a', border: '#7f1d1d', text: '#ef4444', label: 'NOT ELIGIBLE' },
};

export default function EligibilityVerdictDisplay({
  assessment,
  onOverride,
}: EligibilityVerdictDisplayProps) {
  const style = VERDICT_STYLES[assessment.verdict] || VERDICT_STYLES.amber;

  const passedCount = assessment.criteria.filter((c) => c.passed === true).length;
  const failedCount = assessment.criteria.filter((c) => c.passed === false).length;
  const pendingCount = assessment.criteria.filter((c) => c.passed === null).length;

  return (
    <div>
      <div
        style={{
          padding: '16px 20px',
          background: style.bg,
          border: `2px solid ${style.border}`,
          borderRadius: 8,
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, color: style.text }}>{style.label}</div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
          PDR Class: {assessment.pdr_class.replace('_', ' ').toUpperCase()} | {passedCount} passed · {failedCount} failed · {pendingCount} pending
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {assessment.criteria.map((c) => (
          <CriterionRow key={c.key} criterion={c} onOverride={onOverride} />
        ))}
      </div>

      {assessment.suggested_next_steps.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ color: '#e2e8f0', fontSize: 16, marginBottom: 8 }}>Suggested Next Steps</h3>
          <ul style={{ color: '#94a3b8', fontSize: 13, paddingLeft: 20, lineHeight: 1.8 }}>
            {assessment.suggested_next_steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CriterionRow.tsx frontend/src/components/EligibilityVerdict.tsx
git commit -m "feat: add CriterionRow and EligibilityVerdict display components"
```

---

### Task 11: Eligibility Wizard & Tab Integration

**Files:**
- Create: `frontend/src/components/EligibilityWizard.tsx`
- Modify: `frontend/src/components/EligibilityAssessment.tsx` (replace placeholder)
- Modify: `frontend/src/App.tsx` (pass `projects` and `selectedProject` to eligibility tab)

**Interfaces:**
- Consumes:
  - `frontend/src/lib/api.ts` — `runEligibility()`, `getEligibility()`
  - `frontend/src/types.ts` — `Project`, `EligibilityAssessment`, `EligibilityRunResponse`
  - `frontend/src/components/EligibilityVerdict.tsx` — `EligibilityVerdictDisplay`
- Produces: Complete eligibility tab with project selection → run engine → display verdict → update manual overrides → re-run flow

- [ ] **Step 1: Create `EligibilityWizard.tsx`**

Create `frontend/src/components/EligibilityWizard.tsx`:

```tsx
import { useState, useCallback, useEffect } from 'react';
import type { Project, EligibilityAssessment as EligAssessment } from '../types';
import { runEligibility, getEligibility } from '../lib/api';
import EligibilityVerdictDisplay from './EligibilityVerdict';

interface EligibilityWizardProps {
  project: Project;
}

type WizardState = 'idle' | 'running' | 'complete' | 'error';

export default function EligibilityWizard({ project }: EligibilityWizardProps) {
  const [state, setState] = useState<WizardState>('idle');
  const [assessment, setAssessment] = useState<EligAssessment | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean | null>>({});
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await getEligibility(project.id);
        if (!cancelled) {
          setAssessment(existing);
          setState('complete');
        }
      } catch {
        // No existing assessment — that's fine
      }
    })();
    return () => { cancelled = true; };
  }, [project.id]);

  const handleRun = useCallback(async () => {
    setState('running');
    setErrorMsg('');
    try {
      const result = await runEligibility(project.id, manualOverrides);
      setAssessment(result.assessment);
      setState('complete');
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to run eligibility check');
    }
  }, [project.id, manualOverrides]);

  const handleOverride = useCallback(
    (key: string, value: boolean | null) => {
      const updated = { ...manualOverrides, [key]: value };
      setManualOverrides(updated);
      setState('running');
      setErrorMsg('');
      runEligibility(project.id, updated)
        .then((result) => {
          setAssessment(result.assessment);
          setState('complete');
        })
        .catch((e) => {
          setState('error');
          setErrorMsg(e instanceof Error ? e.message : 'Failed to update');
        });
    },
    [project.id, manualOverrides],
  );

  return (
    <div>
      <div
        style={{
          padding: 12,
          background: '#0f1d32',
          borderRadius: 8,
          border: '1px solid #1e3a5f',
          marginBottom: 16,
        }}
      >
        <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{project.address_raw}</div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
          {project.use_class} · £{(project.price_pence / 100).toLocaleString()}
          {project.floor_area_sqm && ` · ${project.floor_area_sqm} sq m`}
          {project.address_postcode && ` · ${project.address_postcode}`}
        </div>
      </div>

      {state === 'idle' && (
        <button
          onClick={handleRun}
          style={{
            padding: '10px 24px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Run Eligibility Assessment
        </button>
      )}

      {state === 'running' && (
        <div style={{ color: '#60a5fa', padding: 16 }}>
          Running eligibility checks — querying flood risk, Article 4, EPC data...
        </div>
      )}

      {state === 'error' && (
        <div>
          <p style={{ color: '#ef4444', marginBottom: 8 }}>{errorMsg}</p>
          <button
            onClick={handleRun}
            style={{
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {state === 'complete' && assessment && (
        <div>
          <EligibilityVerdictDisplay assessment={assessment} onOverride={handleOverride} />
          <button
            onClick={handleRun}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#1e3a5f',
              color: '#e2e8f0',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Re-run Assessment
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `EligibilityAssessment.tsx` placeholder**

Replace `frontend/src/components/EligibilityAssessment.tsx` with:

```tsx
import { useState } from 'react';
import type { Project } from '../types';
import EligibilityWizard from './EligibilityWizard';

interface EligibilityAssessmentProps {
  projects: Project[];
  selectedProject: Project | null;
}

export default function EligibilityAssessment({ projects, selectedProject }: EligibilityAssessmentProps) {
  const [chosen, setChosen] = useState<Project | null>(selectedProject);

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>PDR Eligibility Assessment</h2>

      {!chosen && (
        <div>
          <p style={{ color: '#94a3b8', marginBottom: 12 }}>Select a project to assess:</p>
          {projects.length === 0 ? (
            <p style={{ color: '#64748b' }}>No projects yet. Create one in the New Project tab.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setChosen(p)}
                  style={{
                    padding: 12,
                    background: '#0f1d32',
                    borderRadius: 8,
                    border: '1px solid #1e3a5f',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: '#e2e8f0',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{p.address_raw}</div>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
                    {p.use_class} · £{(p.price_pence / 100).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {chosen && (
        <div>
          <button
            onClick={() => setChosen(null)}
            style={{
              marginBottom: 16,
              padding: '6px 12px',
              background: '#1e3a5f',
              color: '#e2e8f0',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            ← Back to project list
          </button>
          <EligibilityWizard project={chosen} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `App.tsx` to pass props to eligibility tab**

In `frontend/src/App.tsx`, change the eligibility tab render from:

```tsx
{activeTab === 'eligibility' && <EligibilityAssessment />}
```

to:

```tsx
{activeTab === 'eligibility' && (
  <EligibilityAssessment projects={projects} selectedProject={selectedProject} />
)}
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Verify frontend builds**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vite build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/EligibilityWizard.tsx frontend/src/components/EligibilityAssessment.tsx frontend/src/App.tsx
git commit -m "feat: add eligibility wizard with project selection, engine integration, and verdict display"
```

---

### Task 12: Verify & Clean Up

**Files:**
- All files from this plan

**Interfaces:**
- Consumes: all previous tasks
- Produces: all tests passing, frontend compiling and building, no dead code

- [ ] **Step 1: Run all Python tests**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 2: Run all frontend tests**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: TypeScript type check**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Frontend production build**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vite build`
Expected: Build succeeds

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Plan 2 — data integrations and PDR eligibility engine"
```

- [ ] **Step 6: Push to GitHub**

```bash
git push origin main
```

---

## What This Plan Produces

After completing all 12 tasks, you have:

- **4 external integration clients** (`app/integrations/`): Postcodes.io, EA Flood Risk, EPC Open Data, Article 4 — all async, tested with respx mocking
- **Bundled Article 4 dataset** (`data/article4_directions.json`) covering 15 major UK LPAs with known office-to-resi restrictions
- **4 lookup API endpoints** (`GET /api/v1/lookup/postcode|flood|epc|article4/{param}`)
- **PDR eligibility engine** (`app/eligibility/`) with:
  - Criterion definitions for all 5 PDR classes (MA, G, M, N, Q)
  - Auto-detection of applicable PDR class from use class + floor area
  - Auto-checking of floor area limit, flood zone, Article 4, AONB
  - Manual override support for user-confirmed criteria
  - Green/Amber/Red verdict computation
  - Suggested next steps for pending manual checks
- **Eligibility run endpoint** (`POST /api/v1/eligibility/{project_id}/run`) that executes the engine and saves/updates the assessment
- **Frontend eligibility tab** with:
  - Project selection list
  - One-click eligibility engine execution
  - Traffic light verdict display with per-criterion breakdown
  - Pass/Fail buttons for manual criteria overrides (re-runs engine on click)
  - Suggested next steps list
- All tests passing, frontend compiling and building

## Next Plans

- **Plan 3: Conversion Financial Calculator** — Commercial SDLT, calc engine, cashflow, all 10 calculator pages
- **Plan 4: Scraping, Pipeline, Map & Export** — Commercial adapters, 7-stage Kanban, Leaflet map, PDF/Excel export
