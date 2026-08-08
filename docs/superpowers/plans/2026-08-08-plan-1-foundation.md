# Commercial-Resi-Analyser — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the Commercial-Resi-Analyser repository by forking the UK-Property-Analyser, stripping residential-specific code, rebranding, building the new data model, and wiring up the app shell with new tab navigation — producing a running app with project CRUD and the correct database schema.

**Architecture:** Clean copy of the existing repo with a fresh git history. The infrastructure layer (FastAPI, SQLAlchemy, Docker, Vite/React) is kept. All residential domain code is stripped. New domain models, ORM tables, repositories, and API endpoints are built for the commercial-to-resi use case. The frontend app shell is restructured with 6-tab navigation (Pipeline, New Project, Eligibility, Calculator, Map, Export).

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic v2, React 19, TypeScript 5.9, Vite 8, Tailwind 4, PostgreSQL 16, Docker Compose.

## Global Constraints

- Python >= 3.12, Node >= 20
- All monetary values stored as integer pence (BigInteger in ORM, `number` in TypeScript)
- All UUIDs use `uuid.uuid4` / `crypto.randomUUID()`
- SQLAlchemy 2.0 style: `Mapped[T]` + `mapped_column()`, `DeclarativeBase` + `AsyncAttrs`
- Pydantic v2: `BaseModel`, `ConfigDict(from_attributes=True)` on ORM response models
- Repository pattern: constructor takes `AsyncSession`, `flush()` not `commit()`
- Frontend: native `fetch` for HTTP, `useState`/`useMemo`/`useCallback` for state (no external state lib)
- API prefix: `/api/v1`
- Origin repo: `C:\Users\srbuc\Documents\Github\UK-Property-Analyser\UK-Property-Analyser`
- New repo location: `C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser`

---

### Task 1: Create New Repository

**Files:**
- Create: `C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\` (entire repo copy)
- Delete: all files listed in "Strip" below
- Modify: `pyproject.toml`, `README.md`, `docker-compose.yml`, `.env.example`, `main.py`, `frontend/package.json`, `frontend/index.html`

**Interfaces:**
- Consumes: existing UK-Property-Analyser repo at `C:\Users\srbuc\Documents\Github\UK-Property-Analyser\UK-Property-Analyser`
- Produces: clean repo at `C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser` with infrastructure intact and residential code removed

- [ ] **Step 1: Copy the repo (without git history)**

```bash
cd C:\Users\srbuc\Documents\Github
mkdir Commercial-Resi-Analyser
cd UK-Property-Analyser/UK-Property-Analyser
# Copy all files except .git
robocopy . ../../Commercial-Resi-Analyser /E /XD .git __pycache__ node_modules .venv .planning
```

- [ ] **Step 2: Initialise fresh git repo**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git init
```

- [ ] **Step 3: Strip residential adapters**

Delete the entire contents of `app/adapters/` except `base.py` and `registry.py`:

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
rm app/adapters/allsop_auction.py
rm app/adapters/sdl_auctions.py
rm app/adapters/savills_auctions.py
rm app/adapters/bidx1.py
rm app/adapters/iamsold.py
rm app/adapters/auction_house_uk.py
rm app/adapters/clive_emson.py
rm app/adapters/barnard_marcus.py
rm app/adapters/strettons.py
rm app/adapters/bond_wolfe.py
rm app/adapters/barnett_ross.py
rm app/adapters/mchugh_and_co.py
```

- [ ] **Step 4: Strip residential frontend components**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
rm frontend/src/components/PropertyForm.tsx
rm frontend/src/components/LeaseSection.tsx
rm frontend/src/components/MetricsPanel.tsx
rm frontend/src/components/MetricCard.tsx
rm -rf frontend/src/components/refurb/
rm frontend/src/lib/calculations.ts
rm frontend/src/lib/calculations.test.ts
rm frontend/src/lib/refurb-types.ts
rm frontend/src/lib/refurb-calc-engine.ts
rm frontend/src/lib/refurb-defaults.ts
rm frontend/src/lib/refurb-formatting.ts
rm frontend/src/lib/refurb-calc.test.ts
```

- [ ] **Step 5: Strip residential migrations**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
rm migrations/001_initial.py
rm migrations/002_add_deal_reviews.py
rm migrations/003_add_refurb_appraisals.py
```

- [ ] **Step 6: Strip residential tests**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
rm tests/test_normalizers.py
rm tests/test_change_detection.py
rm tests/test_address_normalization.py
rm tests/test_parsers.py
rm tests/test_scrape_url.py
rm tests/test_scrape_url_endpoint.py
rm tests/test_calculations.py
rm tests/test_deal_reviews.py
rm tests/test_appraisals.py
rm tests/test_repositories.py
```

- [ ] **Step 7: Strip planning directory**

```bash
rm -rf .planning/
```

- [ ] **Step 8: Update `pyproject.toml` metadata**

Change the project metadata at the top of `pyproject.toml`:

```toml
[project]
name = "commercial-resi-analyser"
version = "0.1.0"
description = "UK commercial-to-residential PDR conversion analyser"
```

Keep all dependencies unchanged.

- [ ] **Step 9: Update `frontend/package.json` name**

Change the `name` field:

```json
{
  "name": "commercial-resi-analyser",
  ...
}
```

- [ ] **Step 10: Update `frontend/index.html` title**

Change the `<title>` tag:

```html
<title>Commercial-Resi-Analyser</title>
```

- [ ] **Step 11: Update `.env.example`**

Replace contents with:

```env
DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5432/commercial_resi
EPC_API_KEY=your-epc-api-key-here
```

- [ ] **Step 12: Update `docker-compose.yml` database name**

In the `postgres` service environment, change `POSTGRES_DB` to `commercial_resi`. In the `api` and `worker` service environment, update `DATABASE_URL` to use `commercial_resi` as the database name.

- [ ] **Step 13: Write a placeholder `README.md`**

Replace the existing README with:

```markdown
# Commercial-Resi-Analyser

UK commercial-to-residential property conversion analyser for Permitted Development Rights (PDR) opportunities.

## Quick Start

```bash
docker compose up
```

API: http://localhost:8000
Frontend: http://localhost:5173 (dev mode)
```

- [ ] **Step 14: Create new GitHub repo and push**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git add -A
git commit -m "feat: initial fork from UK-Property-Analyser — infrastructure only"
gh repo create Commercial-Resi-Analyser --public --source=. --push
```

- [ ] **Step 15: Verify the repo is accessible on GitHub**

```bash
gh repo view Commercial-Resi-Analyser --web
```

---

### Task 2: New Domain Models & Enums

**Files:**
- Create: `app/models.py` (overwrite existing with new commercial-resi models)
- Test: `tests/test_models.py`

**Interfaces:**
- Consumes: nothing (foundational)
- Produces:
  - Enums: `UseClass`, `PdrClass`, `PipelineStage`, `EligibilityVerdict`, `Tenure`, `ScrapeStatus`, `SourceHealth`
  - Domain models: `CommercialListing`, `Address`, `PriceInfo`, `AuctionInfo`
  - Project models: `Project`, `ProjectCreate`, `ProjectUpdate`
  - Eligibility models: `EligibilityCriterion`, `EligibilityAssessment`, `EligibilityAssessmentCreate`, `EligibilityAssessmentUpdate`
  - Financial models: `FinancialAppraisal`, `FinancialAppraisalCreate`, `FinancialAppraisalUpdate`
  - Stage model: `StageTransition`, `StageTransitionCreate`
  - API models: `ScrapeUrlRequest`, `ApiResponse`

- [ ] **Step 1: Write tests for enums and core models**

Create `tests/test_models.py`:

```python
import uuid
from datetime import datetime

import pytest

from app.models import (
    UseClass,
    PdrClass,
    PipelineStage,
    EligibilityVerdict,
    Tenure,
    Address,
    PriceInfo,
    CommercialListing,
    Project,
    ProjectCreate,
    EligibilityCriterion,
    EligibilityAssessment,
    EligibilityAssessmentCreate,
    FinancialAppraisal,
    FinancialAppraisalCreate,
    StageTransition,
    StageTransitionCreate,
)


class TestEnums:
    def test_use_class_values(self):
        assert UseClass.OFFICE == "office"
        assert UseClass.RETAIL == "retail"
        assert UseClass.LIGHT_INDUSTRIAL == "light_industrial"
        assert UseClass.AGRICULTURAL == "agricultural"
        assert UseClass.SUI_GENERIS == "sui_generis"

    def test_pdr_class_values(self):
        assert PdrClass.CLASS_MA == "class_ma"
        assert PdrClass.CLASS_G == "class_g"
        assert PdrClass.CLASS_M == "class_m"
        assert PdrClass.CLASS_N == "class_n"
        assert PdrClass.CLASS_Q == "class_q"

    def test_pipeline_stage_order(self):
        stages = list(PipelineStage)
        assert stages[0] == PipelineStage.OPPORTUNITY_IDENTIFIED
        assert stages[-1] == PipelineStage.COMPLETE

    def test_eligibility_verdict_values(self):
        assert EligibilityVerdict.GREEN == "green"
        assert EligibilityVerdict.AMBER == "amber"
        assert EligibilityVerdict.RED == "red"


class TestAddress:
    def test_address_creation(self):
        addr = Address(
            raw="123 High Street, London, SW1A 1AA",
            line1="123 High Street",
            town="London",
            postcode="SW1A 1AA",
            postcode_district="SW1A",
        )
        assert addr.postcode == "SW1A 1AA"
        assert addr.line2 is None


class TestPriceInfo:
    def test_price_in_pence(self):
        price = PriceInfo(amount=50000000, currency="GBP", qualifier="guide_price")
        assert price.amount == 50000000  # £500,000 in pence


class TestCommercialListing:
    def test_listing_defaults(self):
        listing = CommercialListing(
            address=Address(raw="1 Test St", postcode="E1 1AA", postcode_district="E1"),
            price=PriceInfo(amount=30000000),
            use_class=UseClass.OFFICE,
            source_url="https://example.com/listing/1",
            source_name="allsop_commercial",
        )
        assert listing.id is not None
        assert listing.tenure == Tenure.UNKNOWN
        assert listing.floor_area_sqft is None
        assert listing.floors is None
        assert listing.is_vacant is None


class TestProject:
    def test_project_create(self):
        create = ProjectCreate(
            address_raw="1 Test St, London, E1 1AA",
            address_line1="1 Test St",
            address_town="London",
            address_postcode="E1 1AA",
            address_postcode_district="E1",
            price_pence=30000000,
            use_class=UseClass.OFFICE,
        )
        assert create.price_pence == 30000000
        assert create.stage == PipelineStage.OPPORTUNITY_IDENTIFIED


class TestEligibilityAssessment:
    def test_criterion_creation(self):
        criterion = EligibilityCriterion(
            key="floor_area_limit",
            label="Floor area ≤ 1,500 sq m",
            passed=True,
            source="auto",
            auto_checked=True,
            value="1200 sq m",
        )
        assert criterion.passed is True
        assert criterion.auto_checked is True

    def test_assessment_create(self):
        create = EligibilityAssessmentCreate(
            project_id=uuid.uuid4(),
            pdr_class=PdrClass.CLASS_MA,
            criteria=[
                EligibilityCriterion(
                    key="floor_area_limit",
                    label="Floor area ≤ 1,500 sq m",
                    passed=True,
                    source="auto",
                    auto_checked=True,
                ),
            ],
            verdict=EligibilityVerdict.AMBER,
        )
        assert create.verdict == EligibilityVerdict.AMBER


class TestFinancialAppraisal:
    def test_appraisal_create(self):
        create = FinancialAppraisalCreate(
            project_id=uuid.uuid4(),
            name="Office Conversion - 1 Test St",
            inputs_snapshot={"purchase_price_pence": 30000000},
            gdv_pence=60000000,
            total_cost_pence=45000000,
            profit_on_cost_pct=33.33,
            profit_on_gdv_pct=25.0,
            irr=18.5,
        )
        assert create.gdv_pence == 60000000


class TestStageTransition:
    def test_stage_transition_create(self):
        create = StageTransitionCreate(
            project_id=uuid.uuid4(),
            from_stage=PipelineStage.OPPORTUNITY_IDENTIFIED,
            to_stage=PipelineStage.ELIGIBILITY_ASSESSED,
            notes="Eligibility assessment completed",
        )
        assert create.to_stage == PipelineStage.ELIGIBILITY_ASSESSED
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models'` or `ImportError`

- [ ] **Step 3: Implement `app/models.py`**

Replace `app/models.py` with:

```python
import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class UseClass(StrEnum):
    OFFICE = "office"
    RETAIL = "retail"
    LIGHT_INDUSTRIAL = "light_industrial"
    RESTAURANT_CAFE = "restaurant_cafe"
    TAKEAWAY = "takeaway"
    AMUSEMENT = "amusement"
    LAUNDERETTE = "launderette"
    AGRICULTURAL = "agricultural"
    SUI_GENERIS = "sui_generis"
    OTHER = "other"
    UNKNOWN = "unknown"


class PdrClass(StrEnum):
    CLASS_MA = "class_ma"
    CLASS_G = "class_g"
    CLASS_M = "class_m"
    CLASS_N = "class_n"
    CLASS_Q = "class_q"


class PipelineStage(StrEnum):
    OPPORTUNITY_IDENTIFIED = "opportunity_identified"
    ELIGIBILITY_ASSESSED = "eligibility_assessed"
    FINANCIAL_APPRAISAL = "financial_appraisal"
    PRIOR_APPROVAL_SUBMITTED = "prior_approval_submitted"
    APPROVED = "approved"
    IN_CONVERSION = "in_conversion"
    COMPLETE = "complete"


class EligibilityVerdict(StrEnum):
    GREEN = "green"
    AMBER = "amber"
    RED = "red"


class Tenure(StrEnum):
    FREEHOLD = "freehold"
    LEASEHOLD = "leasehold"
    UNKNOWN = "unknown"


class ScrapeStatus(StrEnum):
    IDLE = "idle"
    LOADING = "loading"
    SUCCESS = "success"
    ERROR = "error"


class SourceHealth(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    PAUSED = "paused"


# --- Sub-models ---


class Address(BaseModel):
    raw: str
    line1: str | None = None
    line2: str | None = None
    town: str | None = None
    county: str | None = None
    postcode: str | None = None
    postcode_district: str | None = None


class PriceInfo(BaseModel):
    amount: int  # pence
    currency: str = "GBP"
    qualifier: str | None = None


class AuctionInfo(BaseModel):
    house: str | None = None
    lot_number: str | None = None
    date: str | None = None
    venue: str | None = None
    online_bidding: bool | None = None


# --- Commercial Listing ---


class CommercialListing(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    address: Address
    price: PriceInfo
    use_class: UseClass
    floor_area_sqft: float | None = None
    floor_area_sqm: float | None = None
    floors: int | None = None
    tenure: Tenure = Tenure.UNKNOWN
    lease_years_remaining: int | None = None
    current_use_description: str | None = None
    epc_rating: str | None = None
    is_vacant: bool | None = None
    vacancy_date: str | None = None
    source_url: str
    source_name: str
    auction: AuctionInfo | None = None
    image_urls: list[str] = Field(default_factory=list)
    description: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# --- API models ---


class ScrapeUrlRequest(BaseModel):
    url: str


class ApiResponse(BaseModel):
    listing: CommercialListing | None = None
    error: str | None = None


# --- Project ---


class ProjectCreate(BaseModel):
    address_raw: str
    address_line1: str | None = None
    address_line2: str | None = None
    address_town: str | None = None
    address_county: str | None = None
    address_postcode: str | None = None
    address_postcode_district: str | None = None
    price_pence: int
    price_qualifier: str | None = None
    use_class: UseClass
    floor_area_sqft: float | None = None
    floor_area_sqm: float | None = None
    floors: int | None = None
    tenure: Tenure = Tenure.UNKNOWN
    lease_years_remaining: int | None = None
    current_use_description: str | None = None
    epc_rating: str | None = None
    is_vacant: bool | None = None
    vacancy_date: str | None = None
    source_url: str | None = None
    source_name: str | None = None
    description: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    stage: PipelineStage = PipelineStage.OPPORTUNITY_IDENTIFIED


class ProjectUpdate(BaseModel):
    address_raw: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_town: str | None = None
    address_county: str | None = None
    address_postcode: str | None = None
    address_postcode_district: str | None = None
    price_pence: int | None = None
    price_qualifier: str | None = None
    use_class: UseClass | None = None
    floor_area_sqft: float | None = None
    floor_area_sqm: float | None = None
    floors: int | None = None
    tenure: Tenure | None = None
    lease_years_remaining: int | None = None
    current_use_description: str | None = None
    epc_rating: str | None = None
    is_vacant: bool | None = None
    vacancy_date: str | None = None
    source_url: str | None = None
    source_name: str | None = None
    description: str | None = None
    image_urls: list[str] | None = None
    stage: PipelineStage | None = None


class Project(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    address_raw: str
    address_line1: str | None = None
    address_line2: str | None = None
    address_town: str | None = None
    address_county: str | None = None
    address_postcode: str | None = None
    address_postcode_district: str | None = None
    price_pence: int
    price_qualifier: str | None = None
    use_class: UseClass
    floor_area_sqft: float | None = None
    floor_area_sqm: float | None = None
    floors: int | None = None
    tenure: Tenure = Tenure.UNKNOWN
    lease_years_remaining: int | None = None
    current_use_description: str | None = None
    epc_rating: str | None = None
    is_vacant: bool | None = None
    vacancy_date: str | None = None
    source_url: str | None = None
    source_name: str | None = None
    description: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    stage: PipelineStage
    created_at: datetime
    updated_at: datetime


# --- Eligibility ---


class EligibilityCriterion(BaseModel):
    key: str
    label: str
    passed: bool | None = None
    source: str | None = None
    auto_checked: bool = False
    value: str | None = None
    risk_flag: str | None = None


class EligibilityAssessmentCreate(BaseModel):
    project_id: uuid.UUID
    pdr_class: PdrClass
    criteria: list[EligibilityCriterion]
    verdict: EligibilityVerdict
    suggested_next_steps: list[str] = Field(default_factory=list)
    notes: str | None = None


class EligibilityAssessmentUpdate(BaseModel):
    criteria: list[EligibilityCriterion] | None = None
    verdict: EligibilityVerdict | None = None
    suggested_next_steps: list[str] | None = None
    notes: str | None = None


class EligibilityAssessment(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    pdr_class: PdrClass
    criteria: list[EligibilityCriterion]
    verdict: EligibilityVerdict
    suggested_next_steps: list[str] = Field(default_factory=list)
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


# --- Financial Appraisal ---


class FinancialAppraisalCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    inputs_snapshot: dict
    gdv_pence: int | None = None
    total_cost_pence: int | None = None
    profit_on_cost_pct: float | None = None
    profit_on_gdv_pct: float | None = None
    return_on_equity_pct: float | None = None
    irr: float | None = None
    rlv_pence: int | None = None


class FinancialAppraisalUpdate(BaseModel):
    name: str | None = None
    inputs_snapshot: dict | None = None
    gdv_pence: int | None = None
    total_cost_pence: int | None = None
    profit_on_cost_pct: float | None = None
    profit_on_gdv_pct: float | None = None
    return_on_equity_pct: float | None = None
    irr: float | None = None
    rlv_pence: int | None = None


class FinancialAppraisal(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    inputs_snapshot: dict
    gdv_pence: int | None = None
    total_cost_pence: int | None = None
    profit_on_cost_pct: float | None = None
    profit_on_gdv_pct: float | None = None
    return_on_equity_pct: float | None = None
    irr: float | None = None
    rlv_pence: int | None = None
    created_at: datetime
    updated_at: datetime


# --- Stage Transition ---


class StageTransitionCreate(BaseModel):
    project_id: uuid.UUID
    from_stage: PipelineStage | None = None
    to_stage: PipelineStage
    notes: str | None = None


class StageTransition(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    from_stage: PipelineStage | None = None
    to_stage: PipelineStage
    notes: str | None = None
    transitioned_at: datetime
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_models.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git add app/models.py tests/test_models.py
git commit -m "feat: add commercial-resi domain models, enums, and CRUD schemas"
```

---

### Task 3: ORM Tables & Initial Migration

**Files:**
- Modify: `app/persistence/database.py` (replace ORM table definitions)
- Create: `migrations/001_initial.py`
- Test: `tests/test_orm_tables.py`

**Interfaces:**
- Consumes: `app/models.py` — `UseClass`, `PdrClass`, `PipelineStage`, `EligibilityVerdict`, `Tenure`
- Produces:
  - ORM classes: `ProjectORM`, `EligibilityAssessmentORM`, `FinancialAppraisalORM`, `StageTransitionORM`
  - `Base` declarative base (for `create_all`)
  - `get_db()` async session dependency

- [ ] **Step 1: Write ORM table tests**

Create `tests/test_orm_tables.py`:

```python
from uuid import uuid4

import pytest

from app.persistence.database import (
    ProjectORM,
    EligibilityAssessmentORM,
    FinancialAppraisalORM,
    StageTransitionORM,
    Base,
)


class TestProjectORM:
    def test_table_name(self):
        assert ProjectORM.__tablename__ == "projects"

    def test_has_required_columns(self):
        col_names = {c.name for c in ProjectORM.__table__.columns}
        required = {
            "id", "address_raw", "price_pence", "use_class", "stage",
            "created_at", "updated_at",
        }
        assert required.issubset(col_names)

    def test_has_property_columns(self):
        col_names = {c.name for c in ProjectORM.__table__.columns}
        property_cols = {
            "address_line1", "address_line2", "address_town", "address_county",
            "address_postcode", "address_postcode_district",
            "price_qualifier", "floor_area_sqft", "floor_area_sqm", "floors",
            "tenure", "lease_years_remaining", "current_use_description",
            "epc_rating", "is_vacant", "vacancy_date",
            "source_url", "source_name", "description", "image_urls",
        }
        assert property_cols.issubset(col_names)


class TestEligibilityAssessmentORM:
    def test_table_name(self):
        assert EligibilityAssessmentORM.__tablename__ == "eligibility_assessments"

    def test_has_required_columns(self):
        col_names = {c.name for c in EligibilityAssessmentORM.__table__.columns}
        required = {
            "id", "project_id", "pdr_class", "criteria", "verdict",
            "created_at", "updated_at",
        }
        assert required.issubset(col_names)


class TestFinancialAppraisalORM:
    def test_table_name(self):
        assert FinancialAppraisalORM.__tablename__ == "financial_appraisals"

    def test_has_required_columns(self):
        col_names = {c.name for c in FinancialAppraisalORM.__table__.columns}
        required = {
            "id", "project_id", "name", "inputs_snapshot",
            "created_at", "updated_at",
        }
        assert required.issubset(col_names)

    def test_has_metric_columns(self):
        col_names = {c.name for c in FinancialAppraisalORM.__table__.columns}
        metrics = {
            "gdv_pence", "total_cost_pence", "profit_on_cost_pct",
            "profit_on_gdv_pct", "return_on_equity_pct", "irr", "rlv_pence",
        }
        assert metrics.issubset(col_names)


class TestStageTransitionORM:
    def test_table_name(self):
        assert StageTransitionORM.__tablename__ == "stage_transitions"

    def test_has_required_columns(self):
        col_names = {c.name for c in StageTransitionORM.__table__.columns}
        required = {"id", "project_id", "from_stage", "to_stage", "transitioned_at"}
        assert required.issubset(col_names)


class TestCascadeRelationships:
    def test_project_has_relationships(self):
        rel_names = {r.key for r in ProjectORM.__mapper__.relationships}
        assert "eligibility_assessments" in rel_names
        assert "financial_appraisals" in rel_names
        assert "stage_transitions" in rel_names


class TestBaseMetadata:
    def test_all_tables_registered(self):
        table_names = set(Base.metadata.tables.keys())
        expected = {"projects", "eligibility_assessments", "financial_appraisals", "stage_transitions"}
        assert expected.issubset(table_names)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_orm_tables.py -v`
Expected: FAIL — `ImportError: cannot import name 'ProjectORM'`

- [ ] **Step 3: Implement ORM tables in `app/persistence/database.py`**

Replace the ORM table definitions in `app/persistence/database.py`. Keep the engine, session factory, `get_db()`, and `Base` class. Remove all existing ORM classes (`SourceConfigORM`, `ListingORM`, `ListingChangeORM`, `ScrapeSessionORM`, `ScrapeErrorLogORM`, `DealReviewORM`, `RefurbAppraisalORM`) and replace with:

```python
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

# ... (keep existing engine, AsyncSessionLocal, get_db, Base) ...


class ProjectORM(Base):
    __tablename__ = "projects"

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    address_raw: Mapped[str] = mapped_column(Text, nullable=False)
    address_line1: Mapped[str | None] = mapped_column(String(256))
    address_line2: Mapped[str | None] = mapped_column(String(256))
    address_town: Mapped[str | None] = mapped_column(String(128))
    address_county: Mapped[str | None] = mapped_column(String(128))
    address_postcode: Mapped[str | None] = mapped_column(String(16))
    address_postcode_district: Mapped[str | None] = mapped_column(String(8))
    price_pence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    price_qualifier: Mapped[str | None] = mapped_column(String(64))
    use_class: Mapped[str] = mapped_column(String(32), nullable=False)
    floor_area_sqft: Mapped[float | None] = mapped_column(Float)
    floor_area_sqm: Mapped[float | None] = mapped_column(Float)
    floors: Mapped[int | None] = mapped_column()
    tenure: Mapped[str] = mapped_column(String(32), default="unknown")
    lease_years_remaining: Mapped[int | None] = mapped_column()
    current_use_description: Mapped[str | None] = mapped_column(Text)
    epc_rating: Mapped[str | None] = mapped_column(String(8))
    is_vacant: Mapped[bool | None] = mapped_column(Boolean)
    vacancy_date: Mapped[str | None] = mapped_column(String(32))
    source_url: Mapped[str | None] = mapped_column(Text)
    source_name: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)
    image_urls: Mapped[list | None] = mapped_column(JSON, default=list)
    stage: Mapped[str] = mapped_column(String(48), nullable=False, default="opportunity_identified")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    eligibility_assessments: Mapped[list["EligibilityAssessmentORM"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    financial_appraisals: Mapped[list["FinancialAppraisalORM"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    stage_transitions: Mapped[list["StageTransitionORM"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class EligibilityAssessmentORM(Base):
    __tablename__ = "eligibility_assessments"

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    pdr_class: Mapped[str] = mapped_column(String(32), nullable=False)
    criteria: Mapped[list] = mapped_column(JSON, nullable=False)
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)
    suggested_next_steps: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["ProjectORM"] = relationship(back_populates="eligibility_assessments")


class FinancialAppraisalORM(Base):
    __tablename__ = "financial_appraisals"

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    inputs_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    gdv_pence: Mapped[int | None] = mapped_column(BigInteger)
    total_cost_pence: Mapped[int | None] = mapped_column(BigInteger)
    profit_on_cost_pct: Mapped[float | None] = mapped_column(Float)
    profit_on_gdv_pct: Mapped[float | None] = mapped_column(Float)
    return_on_equity_pct: Mapped[float | None] = mapped_column(Float)
    irr: Mapped[float | None] = mapped_column(Float)
    rlv_pence: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["ProjectORM"] = relationship(back_populates="financial_appraisals")


class StageTransitionORM(Base):
    __tablename__ = "stage_transitions"

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    from_stage: Mapped[str | None] = mapped_column(String(48))
    to_stage: Mapped[str] = mapped_column(String(48), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    transitioned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    project: Mapped["ProjectORM"] = relationship(back_populates="stage_transitions")
```

Add `from datetime import datetime` to imports if not already present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_orm_tables.py -v`
Expected: All tests PASS

- [ ] **Step 5: Create Alembic initial migration**

Create `migrations/001_initial.py`:

```python
"""Initial schema for Commercial-Resi-Analyser.

Tables: projects, eligibility_assessments, financial_appraisals, stage_transitions
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("address_raw", sa.Text, nullable=False),
        sa.Column("address_line1", sa.String(256)),
        sa.Column("address_line2", sa.String(256)),
        sa.Column("address_town", sa.String(128)),
        sa.Column("address_county", sa.String(128)),
        sa.Column("address_postcode", sa.String(16)),
        sa.Column("address_postcode_district", sa.String(8)),
        sa.Column("price_pence", sa.BigInteger, nullable=False),
        sa.Column("price_qualifier", sa.String(64)),
        sa.Column("use_class", sa.String(32), nullable=False),
        sa.Column("floor_area_sqft", sa.Float),
        sa.Column("floor_area_sqm", sa.Float),
        sa.Column("floors", sa.Integer),
        sa.Column("tenure", sa.String(32), server_default="unknown"),
        sa.Column("lease_years_remaining", sa.Integer),
        sa.Column("current_use_description", sa.Text),
        sa.Column("epc_rating", sa.String(8)),
        sa.Column("is_vacant", sa.Boolean),
        sa.Column("vacancy_date", sa.String(32)),
        sa.Column("source_url", sa.Text),
        sa.Column("source_name", sa.String(64)),
        sa.Column("description", sa.Text),
        sa.Column("image_urls", sa.JSON, server_default="[]"),
        sa.Column("stage", sa.String(48), nullable=False, server_default="opportunity_identified"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_projects_postcode", "projects", ["address_postcode"])
    op.create_index("ix_projects_stage", "projects", ["stage"])
    op.create_index("ix_projects_use_class", "projects", ["use_class"])

    op.create_table(
        "eligibility_assessments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pdr_class", sa.String(32), nullable=False),
        sa.Column("criteria", sa.JSON, nullable=False),
        sa.Column("verdict", sa.String(16), nullable=False),
        sa.Column("suggested_next_steps", sa.JSON, server_default="[]"),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_eligibility_project_id", "eligibility_assessments", ["project_id"])

    op.create_table(
        "financial_appraisals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("inputs_snapshot", sa.JSON, nullable=False),
        sa.Column("gdv_pence", sa.BigInteger),
        sa.Column("total_cost_pence", sa.BigInteger),
        sa.Column("profit_on_cost_pct", sa.Float),
        sa.Column("profit_on_gdv_pct", sa.Float),
        sa.Column("return_on_equity_pct", sa.Float),
        sa.Column("irr", sa.Float),
        sa.Column("rlv_pence", sa.BigInteger),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_appraisal_project_id", "financial_appraisals", ["project_id"])

    op.create_table(
        "stage_transitions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_stage", sa.String(48)),
        sa.Column("to_stage", sa.String(48), nullable=False),
        sa.Column("notes", sa.Text),
        sa.Column("transitioned_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_transition_project_id", "stage_transitions", ["project_id"])


def downgrade() -> None:
    op.drop_table("stage_transitions")
    op.drop_table("financial_appraisals")
    op.drop_table("eligibility_assessments")
    op.drop_table("projects")
```

- [ ] **Step 6: Commit**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git add app/persistence/database.py migrations/001_initial.py tests/test_orm_tables.py
git commit -m "feat: add ORM tables and initial migration for projects, eligibility, appraisals, transitions"
```

---

### Task 4: Repositories

**Files:**
- Modify: `app/persistence/repositories.py` (replace with new repositories)
- Test: `tests/test_repositories.py`

**Interfaces:**
- Consumes:
  - `app/persistence/database.py` — `ProjectORM`, `EligibilityAssessmentORM`, `FinancialAppraisalORM`, `StageTransitionORM`, `get_db()`
  - `app/models.py` — `Project`, `ProjectCreate`, `ProjectUpdate`, `EligibilityAssessment`, `EligibilityAssessmentCreate`, `EligibilityAssessmentUpdate`, `FinancialAppraisal`, `FinancialAppraisalCreate`, `FinancialAppraisalUpdate`, `StageTransition`, `StageTransitionCreate`, `EligibilityCriterion`, `PipelineStage`
- Produces:
  - `ProjectRepository(db: AsyncSession)` with methods: `create(data: ProjectCreate) -> Project`, `list_all(stage?: PipelineStage, use_class?: UseClass) -> list[Project]`, `get_by_id(id: UUID) -> Project | None`, `update(id: UUID, updates: ProjectUpdate) -> Project | None`, `delete(id: UUID) -> bool`
  - `EligibilityAssessmentRepository(db: AsyncSession)` with methods: `create(data: EligibilityAssessmentCreate) -> EligibilityAssessment`, `get_by_project_id(project_id: UUID) -> EligibilityAssessment | None`, `update(project_id: UUID, updates: EligibilityAssessmentUpdate) -> EligibilityAssessment | None`
  - `FinancialAppraisalRepository(db: AsyncSession)` with methods: `create(data: FinancialAppraisalCreate) -> FinancialAppraisal`, `get_by_project_id(project_id: UUID) -> FinancialAppraisal | None`, `update(project_id: UUID, updates: FinancialAppraisalUpdate) -> FinancialAppraisal | None`
  - `StageTransitionRepository(db: AsyncSession)` with methods: `create(data: StageTransitionCreate) -> StageTransition`, `list_by_project_id(project_id: UUID) -> list[StageTransition]`

- [ ] **Step 1: Write repository tests**

Create `tests/test_repositories.py`. These are unit tests using mock sessions — integration tests with a real DB will come when Docker is running.

```python
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.models import (
    ProjectCreate,
    ProjectUpdate,
    UseClass,
    PipelineStage,
    EligibilityAssessmentCreate,
    EligibilityCriterion,
    EligibilityVerdict,
    PdrClass,
    FinancialAppraisalCreate,
    StageTransitionCreate,
)
from app.persistence.repositories import (
    ProjectRepository,
    EligibilityAssessmentRepository,
    FinancialAppraisalRepository,
    StageTransitionRepository,
)


class TestProjectRepositoryInit:
    def test_constructor_accepts_session(self):
        mock_db = AsyncMock()
        repo = ProjectRepository(mock_db)
        assert repo.db is mock_db


class TestEligibilityAssessmentRepositoryInit:
    def test_constructor_accepts_session(self):
        mock_db = AsyncMock()
        repo = EligibilityAssessmentRepository(mock_db)
        assert repo.db is mock_db


class TestFinancialAppraisalRepositoryInit:
    def test_constructor_accepts_session(self):
        mock_db = AsyncMock()
        repo = FinancialAppraisalRepository(mock_db)
        assert repo.db is mock_db


class TestStageTransitionRepositoryInit:
    def test_constructor_accepts_session(self):
        mock_db = AsyncMock()
        repo = StageTransitionRepository(mock_db)
        assert repo.db is mock_db
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_repositories.py -v`
Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement repositories in `app/persistence/repositories.py`**

Replace `app/persistence/repositories.py` with:

```python
from uuid import UUID

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    EligibilityAssessment,
    EligibilityAssessmentCreate,
    EligibilityAssessmentUpdate,
    EligibilityCriterion,
    FinancialAppraisal,
    FinancialAppraisalCreate,
    FinancialAppraisalUpdate,
    PipelineStage,
    Project,
    ProjectCreate,
    ProjectUpdate,
    StageTransition,
    StageTransitionCreate,
    UseClass,
)
from app.persistence.database import (
    EligibilityAssessmentORM,
    FinancialAppraisalORM,
    ProjectORM,
    StageTransitionORM,
)


class ProjectRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: ProjectORM) -> Project:
        return Project(
            id=row.id,
            address_raw=row.address_raw,
            address_line1=row.address_line1,
            address_line2=row.address_line2,
            address_town=row.address_town,
            address_county=row.address_county,
            address_postcode=row.address_postcode,
            address_postcode_district=row.address_postcode_district,
            price_pence=row.price_pence,
            price_qualifier=row.price_qualifier,
            use_class=row.use_class,
            floor_area_sqft=row.floor_area_sqft,
            floor_area_sqm=row.floor_area_sqm,
            floors=row.floors,
            tenure=row.tenure,
            lease_years_remaining=row.lease_years_remaining,
            current_use_description=row.current_use_description,
            epc_rating=row.epc_rating,
            is_vacant=row.is_vacant,
            vacancy_date=row.vacancy_date,
            source_url=row.source_url,
            source_name=row.source_name,
            description=row.description,
            image_urls=row.image_urls or [],
            stage=row.stage,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def create(self, data: ProjectCreate) -> Project:
        orm = ProjectORM(**data.model_dump())
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def list_all(
        self,
        stage: PipelineStage | None = None,
        use_class: UseClass | None = None,
    ) -> list[Project]:
        stmt = select(ProjectORM).order_by(ProjectORM.created_at.desc())
        if stage:
            stmt = stmt.where(ProjectORM.stage == stage)
        if use_class:
            stmt = stmt.where(ProjectORM.use_class == use_class)
        result = await self.db.execute(stmt)
        return [self._to_domain(row) for row in result.scalars().all()]

    async def get_by_id(self, project_id: UUID) -> Project | None:
        stmt = select(ProjectORM).where(ProjectORM.id == project_id)
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

    async def update(self, project_id: UUID, updates: ProjectUpdate) -> Project | None:
        values = updates.model_dump(exclude_unset=True)
        if not values:
            return await self.get_by_id(project_id)
        stmt = (
            update(ProjectORM)
            .where(ProjectORM.id == project_id)
            .values(**values)
            .returning(ProjectORM)
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if not row:
            return None
        await self.db.flush()
        return self._to_domain(row)

    async def delete(self, project_id: UUID) -> bool:
        stmt = delete(ProjectORM).where(ProjectORM.id == project_id)
        result = await self.db.execute(stmt)
        await self.db.flush()
        return result.rowcount > 0


class EligibilityAssessmentRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: EligibilityAssessmentORM) -> EligibilityAssessment:
        return EligibilityAssessment(
            id=row.id,
            project_id=row.project_id,
            pdr_class=row.pdr_class,
            criteria=[EligibilityCriterion(**c) for c in row.criteria],
            verdict=row.verdict,
            suggested_next_steps=row.suggested_next_steps or [],
            notes=row.notes,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def create(self, data: EligibilityAssessmentCreate) -> EligibilityAssessment:
        dump = data.model_dump()
        dump["criteria"] = [c.model_dump() for c in data.criteria]
        orm = EligibilityAssessmentORM(**dump)
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def get_by_project_id(self, project_id: UUID) -> EligibilityAssessment | None:
        stmt = select(EligibilityAssessmentORM).where(
            EligibilityAssessmentORM.project_id == project_id
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

    async def update(
        self, project_id: UUID, updates: EligibilityAssessmentUpdate
    ) -> EligibilityAssessment | None:
        values = updates.model_dump(exclude_unset=True)
        if "criteria" in values and values["criteria"] is not None:
            values["criteria"] = [c.model_dump() for c in updates.criteria]
        if not values:
            return await self.get_by_project_id(project_id)
        stmt = (
            update(EligibilityAssessmentORM)
            .where(EligibilityAssessmentORM.project_id == project_id)
            .values(**values)
            .returning(EligibilityAssessmentORM)
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if not row:
            return None
        await self.db.flush()
        return self._to_domain(row)


class FinancialAppraisalRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: FinancialAppraisalORM) -> FinancialAppraisal:
        return FinancialAppraisal(
            id=row.id,
            project_id=row.project_id,
            name=row.name,
            inputs_snapshot=row.inputs_snapshot,
            gdv_pence=row.gdv_pence,
            total_cost_pence=row.total_cost_pence,
            profit_on_cost_pct=row.profit_on_cost_pct,
            profit_on_gdv_pct=row.profit_on_gdv_pct,
            return_on_equity_pct=row.return_on_equity_pct,
            irr=row.irr,
            rlv_pence=row.rlv_pence,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def create(self, data: FinancialAppraisalCreate) -> FinancialAppraisal:
        orm = FinancialAppraisalORM(**data.model_dump())
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def get_by_project_id(self, project_id: UUID) -> FinancialAppraisal | None:
        stmt = select(FinancialAppraisalORM).where(
            FinancialAppraisalORM.project_id == project_id
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

    async def update(
        self, project_id: UUID, updates: FinancialAppraisalUpdate
    ) -> FinancialAppraisal | None:
        values = updates.model_dump(exclude_unset=True)
        if not values:
            return await self.get_by_project_id(project_id)
        stmt = (
            update(FinancialAppraisalORM)
            .where(FinancialAppraisalORM.project_id == project_id)
            .values(**values)
            .returning(FinancialAppraisalORM)
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if not row:
            return None
        await self.db.flush()
        return self._to_domain(row)


class StageTransitionRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: StageTransitionORM) -> StageTransition:
        return StageTransition(
            id=row.id,
            project_id=row.project_id,
            from_stage=row.from_stage,
            to_stage=row.to_stage,
            notes=row.notes,
            transitioned_at=row.transitioned_at,
        )

    async def create(self, data: StageTransitionCreate) -> StageTransition:
        orm = StageTransitionORM(**data.model_dump())
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def list_by_project_id(self, project_id: UUID) -> list[StageTransition]:
        stmt = (
            select(StageTransitionORM)
            .where(StageTransitionORM.project_id == project_id)
            .order_by(StageTransitionORM.transitioned_at.asc())
        )
        result = await self.db.execute(stmt)
        return [self._to_domain(row) for row in result.scalars().all()]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_repositories.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git add app/persistence/repositories.py tests/test_repositories.py
git commit -m "feat: add repositories for projects, eligibility, appraisals, transitions"
```

---

### Task 5: API Endpoints

**Files:**
- Modify: `app/api/app.py` (replace routers with new project/eligibility/appraisal/lookup/scrape routers)
- Modify: `config/settings.py` (add `epc_api_key` setting)
- Test: `tests/test_api_endpoints.py`

**Interfaces:**
- Consumes:
  - `app/persistence/repositories.py` — `ProjectRepository`, `EligibilityAssessmentRepository`, `FinancialAppraisalRepository`, `StageTransitionRepository`
  - `app/persistence/database.py` — `get_db()`, `Base`, `engine`
  - `app/models.py` — all Create/Update/Response models, `PipelineStage`, `UseClass`, `StageTransitionCreate`, `ScrapeUrlRequest`, `ApiResponse`
- Produces:
  - `POST /api/v1/projects` — create project
  - `GET /api/v1/projects` — list projects (optional `stage`, `use_class` query params)
  - `GET /api/v1/projects/{id}` — get project with eligibility + appraisal
  - `PUT /api/v1/projects/{id}` — update project
  - `DELETE /api/v1/projects/{id}` — delete project (cascades)
  - `POST /api/v1/projects/{id}/stage` — change pipeline stage
  - `POST /api/v1/eligibility/{project_id}` — create eligibility assessment
  - `GET /api/v1/eligibility/{project_id}` — get eligibility assessment
  - `PUT /api/v1/eligibility/{project_id}` — update eligibility assessment
  - `POST /api/v1/appraisals` — create financial appraisal
  - `GET /api/v1/appraisals/{project_id}` — get financial appraisal
  - `PUT /api/v1/appraisals/{project_id}` — update financial appraisal
  - `POST /api/v1/scrape-url` — placeholder (returns not-implemented for now)
  - `GET /health` — health check
  - `GET /metrics` — prometheus metrics
  - FastAPI `app` object exported as `app`

- [ ] **Step 1: Write API endpoint tests**

Create `tests/test_api_endpoints.py`:

```python
import pytest

from app.api.app import app


class TestAppCreation:
    def test_app_exists(self):
        assert app is not None
        assert app.title == "Commercial-Resi-Analyser"

    def test_routes_registered(self):
        routes = {r.path for r in app.routes if hasattr(r, "path")}
        assert "/api/v1/projects" in routes or "/api/v1/projects/" in routes
        assert "/health" in routes

    def test_project_routes_exist(self):
        route_methods = {}
        for route in app.routes:
            if hasattr(route, "path") and hasattr(route, "methods"):
                route_methods[route.path] = route.methods
        assert "POST" in route_methods.get("/api/v1/projects", set()) or \
               "POST" in route_methods.get("/api/v1/projects/", set())

    def test_eligibility_routes_exist(self):
        paths = {r.path for r in app.routes if hasattr(r, "path")}
        assert any("eligibility" in p for p in paths)

    def test_appraisals_routes_exist(self):
        paths = {r.path for r in app.routes if hasattr(r, "path")}
        assert any("appraisals" in p for p in paths)

    def test_scrape_url_route_exists(self):
        paths = {r.path for r in app.routes if hasattr(r, "path")}
        assert any("scrape-url" in p for p in paths)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_api_endpoints.py -v`
Expected: FAIL — the old routers reference deleted models/adapters

- [ ] **Step 3: Update `config/settings.py`**

Add the `epc_api_key` field to the `Settings` class:

```python
epc_api_key: str = ""
```

Also update `temporal_namespace` and `temporal_task_queue` defaults to `"commercial-resi"` and `"commercial-resi-tasks"`.

- [ ] **Step 4: Rewrite `app/api/app.py`**

Replace the entire file with the new routers:

```python
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ApiResponse,
    EligibilityAssessment,
    EligibilityAssessmentCreate,
    EligibilityAssessmentUpdate,
    FinancialAppraisal,
    FinancialAppraisalCreate,
    FinancialAppraisalUpdate,
    PipelineStage,
    Project,
    ProjectCreate,
    ProjectUpdate,
    ScrapeUrlRequest,
    StageTransitionCreate,
    UseClass,
)
from app.persistence.database import Base, engine, get_db
from app.persistence.repositories import (
    EligibilityAssessmentRepository,
    FinancialAppraisalRepository,
    ProjectRepository,
    StageTransitionRepository,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

DbDep = Annotated[AsyncSession, Depends(get_db)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("commercial-resi-analyser started")
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Commercial-Resi-Analyser",
        description="UK commercial-to-residential PDR conversion analyser",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(projects_router, prefix=settings.api_prefix, tags=["projects"])
    app.include_router(eligibility_router, prefix=settings.api_prefix, tags=["eligibility"])
    app.include_router(appraisals_router, prefix=settings.api_prefix, tags=["appraisals"])
    app.include_router(scrape_router, prefix=settings.api_prefix, tags=["scrape"])
    app.include_router(system_router, tags=["system"])

    dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="spa")

    return app


# --- Projects Router ---

from fastapi import APIRouter

projects_router = APIRouter(prefix="/projects")


@projects_router.post("", response_model=Project, status_code=201)
async def create_project(body: ProjectCreate, db: DbDep):
    repo = ProjectRepository(db)
    project = await repo.create(body)
    transition_repo = StageTransitionRepository(db)
    await transition_repo.create(
        StageTransitionCreate(
            project_id=project.id,
            to_stage=project.stage,
            notes="Project created",
        )
    )
    await db.commit()
    return project


@projects_router.get("", response_model=list[Project])
async def list_projects(
    db: DbDep,
    stage: PipelineStage | None = None,
    use_class: UseClass | None = None,
):
    repo = ProjectRepository(db)
    return await repo.list_all(stage=stage, use_class=use_class)


@projects_router.get("/{project_id}", response_model=Project)
async def get_project(project_id: UUID, db: DbDep):
    repo = ProjectRepository(db)
    project = await repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@projects_router.put("/{project_id}", response_model=Project)
async def update_project(project_id: UUID, body: ProjectUpdate, db: DbDep):
    repo = ProjectRepository(db)
    project = await repo.update(project_id, body)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.commit()
    return project


@projects_router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: UUID, db: DbDep):
    repo = ProjectRepository(db)
    deleted = await repo.delete(project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.commit()


class StageChangeRequest(BaseModel):
    to_stage: PipelineStage
    notes: str | None = None


@projects_router.post("/{project_id}/stage", response_model=Project)
async def change_stage(project_id: UUID, body: StageChangeRequest, db: DbDep):
    repo = ProjectRepository(db)
    project = await repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    old_stage = project.stage
    updated = await repo.update(project_id, ProjectUpdate(stage=body.to_stage))
    transition_repo = StageTransitionRepository(db)
    await transition_repo.create(
        StageTransitionCreate(
            project_id=project_id,
            from_stage=old_stage,
            to_stage=body.to_stage,
            notes=body.notes,
        )
    )
    await db.commit()
    return updated


# --- Eligibility Router ---

eligibility_router = APIRouter(prefix="/eligibility")


@eligibility_router.post("/{project_id}", response_model=EligibilityAssessment, status_code=201)
async def create_eligibility(project_id: UUID, body: EligibilityAssessmentCreate, db: DbDep):
    project_repo = ProjectRepository(db)
    project = await project_repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    body.project_id = project_id
    repo = EligibilityAssessmentRepository(db)
    assessment = await repo.create(body)
    await db.commit()
    return assessment


@eligibility_router.get("/{project_id}", response_model=EligibilityAssessment)
async def get_eligibility(project_id: UUID, db: DbDep):
    repo = EligibilityAssessmentRepository(db)
    assessment = await repo.get_by_project_id(project_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Eligibility assessment not found")
    return assessment


@eligibility_router.put("/{project_id}", response_model=EligibilityAssessment)
async def update_eligibility(project_id: UUID, body: EligibilityAssessmentUpdate, db: DbDep):
    repo = EligibilityAssessmentRepository(db)
    assessment = await repo.update(project_id, body)
    if not assessment:
        raise HTTPException(status_code=404, detail="Eligibility assessment not found")
    await db.commit()
    return assessment


# --- Appraisals Router ---

appraisals_router = APIRouter(prefix="/appraisals")


@appraisals_router.post("", response_model=FinancialAppraisal, status_code=201)
async def create_appraisal(body: FinancialAppraisalCreate, db: DbDep):
    project_repo = ProjectRepository(db)
    project = await project_repo.get_by_id(body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    repo = FinancialAppraisalRepository(db)
    appraisal = await repo.create(body)
    await db.commit()
    return appraisal


@appraisals_router.get("/{project_id}", response_model=FinancialAppraisal)
async def get_appraisal(project_id: UUID, db: DbDep):
    repo = FinancialAppraisalRepository(db)
    appraisal = await repo.get_by_project_id(project_id)
    if not appraisal:
        raise HTTPException(status_code=404, detail="Financial appraisal not found")
    return appraisal


@appraisals_router.put("/{project_id}", response_model=FinancialAppraisal)
async def update_appraisal(project_id: UUID, body: FinancialAppraisalUpdate, db: DbDep):
    repo = FinancialAppraisalRepository(db)
    appraisal = await repo.update(project_id, body)
    if not appraisal:
        raise HTTPException(status_code=404, detail="Financial appraisal not found")
    await db.commit()
    return appraisal


# --- Scrape Router ---

scrape_router = APIRouter()


@scrape_router.post("/scrape-url", response_model=ApiResponse)
async def scrape_url_endpoint(request: ScrapeUrlRequest):
    return ApiResponse(error="Scraping not yet implemented — commercial adapters coming in Plan 4")


# --- System Router ---

system_router = APIRouter()


@system_router.get("/health")
async def system_health():
    from datetime import datetime, timezone

    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@system_router.get("/metrics")
async def metrics():
    try:
        from prometheus_client import generate_latest
        from starlette.responses import Response

        return Response(content=generate_latest(), media_type="text/plain")
    except ImportError:
        return {"error": "prometheus_client not installed"}


app = create_app()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/test_api_endpoints.py -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git add app/api/app.py config/settings.py tests/test_api_endpoints.py
git commit -m "feat: add API endpoints for projects, eligibility, appraisals, stage changes"
```

---

### Task 6: Frontend Types & API Client

**Files:**
- Modify: `frontend/src/types.ts` (replace with commercial-resi types)
- Modify: `frontend/src/lib/api.ts` (replace with new API client)
- Test: `frontend/src/lib/api.test.ts`

**Interfaces:**
- Consumes: backend API endpoints from Task 5
- Produces:
  - TypeScript types: `UseClass`, `PdrClass`, `PipelineStage`, `EligibilityVerdict`, `Tenure`, `Project`, `ProjectCreate`, `ProjectUpdate`, `EligibilityCriterion`, `EligibilityAssessment`, `EligibilityAssessmentCreate`, `FinancialAppraisal`, `FinancialAppraisalCreate`, `StageTransition`, `ScrapeStatus`, `CommercialListing`, `ApiResponse`
  - API functions: `createProject()`, `listProjects()`, `getProject()`, `updateProject()`, `deleteProject()`, `changeStage()`, `createEligibility()`, `getEligibility()`, `updateEligibility()`, `createAppraisal()`, `getAppraisal()`, `updateAppraisal()`, `scrapeUrl()`

- [ ] **Step 1: Write API client tests**

Create `frontend/src/lib/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  changeStage,
  scrapeUrl,
} from './api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('createProject', () => {
  it('sends POST to /api/v1/projects', async () => {
    const project = { id: '123', address_raw: '1 Test St' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(project),
    });

    const result = await createProject({
      address_raw: '1 Test St',
      price_pence: 30000000,
      use_class: 'office',
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/projects', expect.objectContaining({
      method: 'POST',
    }));
    expect(result).toEqual(project);
  });
});

describe('listProjects', () => {
  it('sends GET to /api/v1/projects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const result = await listProjects();
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/projects', expect.any(Object));
    expect(result).toEqual([]);
  });
});

describe('deleteProject', () => {
  it('sends DELETE to /api/v1/projects/{id}', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await deleteProject('abc-123');
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/projects/abc-123', expect.objectContaining({
      method: 'DELETE',
    }));
  });
});

describe('scrapeUrl', () => {
  it('sends POST to /api/v1/scrape-url', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ listing: null, error: 'not implemented' }),
    });

    const result = await scrapeUrl('https://example.com');
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/scrape-url', expect.objectContaining({
      method: 'POST',
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/api.test.ts`
Expected: FAIL — imports don't exist

- [ ] **Step 3: Replace `frontend/src/types.ts`**

```typescript
export type UseClass =
  | 'office'
  | 'retail'
  | 'light_industrial'
  | 'restaurant_cafe'
  | 'takeaway'
  | 'amusement'
  | 'launderette'
  | 'agricultural'
  | 'sui_generis'
  | 'other'
  | 'unknown';

export type PdrClass = 'class_ma' | 'class_g' | 'class_m' | 'class_n' | 'class_q';

export type PipelineStage =
  | 'opportunity_identified'
  | 'eligibility_assessed'
  | 'financial_appraisal'
  | 'prior_approval_submitted'
  | 'approved'
  | 'in_conversion'
  | 'complete';

export type EligibilityVerdict = 'green' | 'amber' | 'red';

export type Tenure = 'freehold' | 'leasehold' | 'unknown';

export type ScrapeStatus = 'idle' | 'loading' | 'success' | 'error';

export const PIPELINE_STAGES: { value: PipelineStage; label: string }[] = [
  { value: 'opportunity_identified', label: 'Opportunity Identified' },
  { value: 'eligibility_assessed', label: 'Eligibility Assessed' },
  { value: 'financial_appraisal', label: 'Financial Appraisal' },
  { value: 'prior_approval_submitted', label: 'Prior Approval Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_conversion', label: 'In Conversion' },
  { value: 'complete', label: 'Complete' },
] as const;

export const USE_CLASS_OPTIONS: { value: UseClass; label: string }[] = [
  { value: 'office', label: 'Office (E(a))' },
  { value: 'retail', label: 'Retail (E(a))' },
  { value: 'light_industrial', label: 'Light Industrial (E(g))' },
  { value: 'restaurant_cafe', label: 'Restaurant/Café (E(b))' },
  { value: 'takeaway', label: 'Takeaway (sui generis)' },
  { value: 'amusement', label: 'Amusement (sui generis)' },
  { value: 'launderette', label: 'Launderette (sui generis)' },
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'sui_generis', label: 'Sui Generis (other)' },
  { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Unknown' },
] as const;

export const TENURE_OPTIONS: { value: Tenure; label: string }[] = [
  { value: 'freehold', label: 'Freehold' },
  { value: 'leasehold', label: 'Leasehold' },
  { value: 'unknown', label: 'Unknown' },
] as const;

export interface Project {
  id: string;
  address_raw: string;
  address_line1: string | null;
  address_line2: string | null;
  address_town: string | null;
  address_county: string | null;
  address_postcode: string | null;
  address_postcode_district: string | null;
  price_pence: number;
  price_qualifier: string | null;
  use_class: UseClass;
  floor_area_sqft: number | null;
  floor_area_sqm: number | null;
  floors: number | null;
  tenure: Tenure;
  lease_years_remaining: number | null;
  current_use_description: string | null;
  epc_rating: string | null;
  is_vacant: boolean | null;
  vacancy_date: string | null;
  source_url: string | null;
  source_name: string | null;
  description: string | null;
  image_urls: string[];
  stage: PipelineStage;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  address_raw: string;
  address_line1?: string;
  address_line2?: string;
  address_town?: string;
  address_county?: string;
  address_postcode?: string;
  address_postcode_district?: string;
  price_pence: number;
  price_qualifier?: string;
  use_class: UseClass;
  floor_area_sqft?: number;
  floor_area_sqm?: number;
  floors?: number;
  tenure?: Tenure;
  lease_years_remaining?: number;
  current_use_description?: string;
  epc_rating?: string;
  is_vacant?: boolean;
  vacancy_date?: string;
  source_url?: string;
  source_name?: string;
  description?: string;
  image_urls?: string[];
}

export interface ProjectUpdate {
  [key: string]: unknown;
}

export interface EligibilityCriterion {
  key: string;
  label: string;
  passed: boolean | null;
  source: string | null;
  auto_checked: boolean;
  value: string | null;
  risk_flag: string | null;
}

export interface EligibilityAssessment {
  id: string;
  project_id: string;
  pdr_class: PdrClass;
  criteria: EligibilityCriterion[];
  verdict: EligibilityVerdict;
  suggested_next_steps: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EligibilityAssessmentCreate {
  project_id: string;
  pdr_class: PdrClass;
  criteria: EligibilityCriterion[];
  verdict: EligibilityVerdict;
  suggested_next_steps?: string[];
  notes?: string;
}

export interface FinancialAppraisal {
  id: string;
  project_id: string;
  name: string;
  inputs_snapshot: Record<string, unknown>;
  gdv_pence: number | null;
  total_cost_pence: number | null;
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  return_on_equity_pct: number | null;
  irr: number | null;
  rlv_pence: number | null;
  created_at: string;
  updated_at: string;
}

export interface FinancialAppraisalCreate {
  project_id: string;
  name: string;
  inputs_snapshot: Record<string, unknown>;
  gdv_pence?: number;
  total_cost_pence?: number;
  profit_on_cost_pct?: number;
  profit_on_gdv_pct?: number;
  return_on_equity_pct?: number;
  irr?: number;
  rlv_pence?: number;
}

export interface StageTransition {
  id: string;
  project_id: string;
  from_stage: PipelineStage | null;
  to_stage: PipelineStage;
  notes: string | null;
  transitioned_at: string;
}

export interface CommercialListing {
  id: string;
  address: {
    raw: string;
    line1: string | null;
    line2: string | null;
    town: string | null;
    county: string | null;
    postcode: string | null;
    postcode_district: string | null;
  };
  price: {
    amount: number;
    currency: string;
    qualifier: string | null;
  };
  use_class: UseClass;
  floor_area_sqft: number | null;
  floor_area_sqm: number | null;
  floors: number | null;
  tenure: Tenure;
  lease_years_remaining: number | null;
  current_use_description: string | null;
  epc_rating: string | null;
  is_vacant: boolean | null;
  vacancy_date: string | null;
  source_url: string;
  source_name: string;
  auction: {
    house: string | null;
    lot_number: string | null;
    date: string | null;
    venue: string | null;
    online_bidding: boolean | null;
  } | null;
  image_urls: string[];
  description: string | null;
  created_at: string;
}

export interface ApiResponse {
  listing: CommercialListing | null;
  error: string | null;
}
```

- [ ] **Step 4: Replace `frontend/src/lib/api.ts`**

```typescript
import type {
  Project,
  ProjectCreate,
  ProjectUpdate,
  EligibilityAssessment,
  EligibilityAssessmentCreate,
  FinancialAppraisal,
  FinancialAppraisalCreate,
  ApiResponse,
  PipelineStage,
} from '../types';

const HEADERS = { 'Content-Type': 'application/json' };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// --- Projects ---

export async function createProject(data: ProjectCreate): Promise<Project> {
  return request<Project>('/api/v1/projects', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

export async function listProjects(): Promise<Project[]> {
  return request<Project[]>('/api/v1/projects', { headers: HEADERS });
}

export async function getProject(id: string): Promise<Project> {
  return request<Project>(`/api/v1/projects/${id}`, { headers: HEADERS });
}

export async function updateProject(id: string, data: ProjectUpdate): Promise<Project> {
  return request<Project>(`/api/v1/projects/${id}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string): Promise<void> {
  return request<void>(`/api/v1/projects/${id}`, { method: 'DELETE', headers: HEADERS });
}

export async function changeStage(
  id: string,
  toStage: PipelineStage,
  notes?: string,
): Promise<Project> {
  return request<Project>(`/api/v1/projects/${id}/stage`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ to_stage: toStage, notes }),
  });
}

// --- Eligibility ---

export async function createEligibility(
  projectId: string,
  data: EligibilityAssessmentCreate,
): Promise<EligibilityAssessment> {
  return request<EligibilityAssessment>(`/api/v1/eligibility/${projectId}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

export async function getEligibility(projectId: string): Promise<EligibilityAssessment> {
  return request<EligibilityAssessment>(`/api/v1/eligibility/${projectId}`, {
    headers: HEADERS,
  });
}

export async function updateEligibility(
  projectId: string,
  data: Partial<EligibilityAssessmentCreate>,
): Promise<EligibilityAssessment> {
  return request<EligibilityAssessment>(`/api/v1/eligibility/${projectId}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

// --- Appraisals ---

export async function createAppraisal(data: FinancialAppraisalCreate): Promise<FinancialAppraisal> {
  return request<FinancialAppraisal>('/api/v1/appraisals', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

export async function getAppraisal(projectId: string): Promise<FinancialAppraisal> {
  return request<FinancialAppraisal>(`/api/v1/appraisals/${projectId}`, {
    headers: HEADERS,
  });
}

export async function updateAppraisal(
  projectId: string,
  data: Partial<FinancialAppraisalCreate>,
): Promise<FinancialAppraisal> {
  return request<FinancialAppraisal>(`/api/v1/appraisals/${projectId}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

// --- Scrape ---

export async function scrapeUrl(url: string): Promise<ApiResponse> {
  return request<ApiResponse>('/api/v1/scrape-url', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ url }),
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/api.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git add frontend/src/types.ts frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat: add commercial-resi TypeScript types and API client"
```

---

### Task 7: Frontend App Shell with Tab Navigation

**Files:**
- Modify: `frontend/src/App.tsx` (replace with new 6-tab navigation)
- Create: `frontend/src/components/Pipeline.tsx` (placeholder)
- Create: `frontend/src/components/NewProject.tsx` (placeholder with URL bar + manual entry)
- Create: `frontend/src/components/EligibilityAssessment.tsx` (placeholder)
- Create: `frontend/src/components/ConversionCalculator.tsx` (placeholder)
- Create: `frontend/src/components/PropertyMap.tsx` (placeholder)
- Create: `frontend/src/components/ExportPage.tsx` (placeholder)
- Delete: `frontend/src/components/Dashboard.tsx`, `frontend/src/components/RefurbCalculator.tsx`

**Interfaces:**
- Consumes: `frontend/src/types.ts` — `Project`, `PipelineStage`, `ScrapeStatus`; `frontend/src/lib/api.ts` — `listProjects()`
- Produces: `App` root component with 6-tab navigation, project state management, and placeholder tab content ready for implementation in Plans 2–4

- [ ] **Step 1: Delete old residential components**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
rm frontend/src/components/Dashboard.tsx
rm frontend/src/components/RefurbCalculator.tsx
rm frontend/src/components/ExportPage.tsx
```

- [ ] **Step 2: Create placeholder `Pipeline.tsx`**

Create `frontend/src/components/Pipeline.tsx`:

```tsx
import type { Project } from '../types';

interface PipelineProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
}

export default function Pipeline({ projects, onSelectProject }: PipelineProps) {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Project Pipeline</h2>
      <p style={{ color: '#94a3b8' }}>
        {projects.length} project{projects.length !== 1 ? 's' : ''} in pipeline.
        Full Kanban dashboard coming in Plan 4.
      </p>
      {projects.map((p) => (
        <div
          key={p.id}
          onClick={() => onSelectProject(p)}
          style={{
            padding: 12,
            marginTop: 8,
            background: '#0f1d32',
            borderRadius: 8,
            cursor: 'pointer',
            border: '1px solid #1e3a5f',
          }}
        >
          <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.address_raw}</div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            {p.use_class} · £{(p.price_pence / 100).toLocaleString()} · {p.stage.replace(/_/g, ' ')}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `NewProject.tsx` with URL bar and manual entry form**

Create `frontend/src/components/NewProject.tsx`:

```tsx
import { useState, useCallback } from 'react';
import type { ProjectCreate, UseClass, Tenure, ScrapeStatus } from '../types';
import { USE_CLASS_OPTIONS, TENURE_OPTIONS } from '../types';
import { scrapeUrl, createProject } from '../lib/api';

interface NewProjectProps {
  onProjectCreated: () => void;
}

export default function NewProject({ onProjectCreated }: NewProjectProps) {
  const [mode, setMode] = useState<'url' | 'manual'>('url');
  const [url, setUrl] = useState('');
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const [addressRaw, setAddressRaw] = useState('');
  const [addressPostcode, setAddressPostcode] = useState('');
  const [pricePounds, setPricePounds] = useState('');
  const [useClass, setUseClass] = useState<UseClass>('office');
  const [floorAreaSqft, setFloorAreaSqft] = useState('');
  const [floors, setFloors] = useState('');
  const [tenure, setTenure] = useState<Tenure>('unknown');
  const [description, setDescription] = useState('');
  const [isVacant, setIsVacant] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleScrape = useCallback(async () => {
    if (!url.trim()) return;
    setScrapeStatus('loading');
    setErrorMsg('');
    try {
      const response = await scrapeUrl(url.trim());
      if (response.error) {
        setScrapeStatus('error');
        setErrorMsg(response.error);
      } else {
        setScrapeStatus('success');
      }
    } catch (e) {
      setScrapeStatus('error');
      setErrorMsg(e instanceof Error ? e.message : 'Scrape failed');
    }
  }, [url]);

  const handleManualSave = useCallback(async () => {
    if (!addressRaw.trim() || !pricePounds.trim()) return;
    setSaveStatus('saving');
    try {
      const data: ProjectCreate = {
        address_raw: addressRaw,
        address_postcode: addressPostcode || undefined,
        price_pence: Math.round(parseFloat(pricePounds) * 100),
        use_class: useClass,
        floor_area_sqft: floorAreaSqft ? parseFloat(floorAreaSqft) : undefined,
        floors: floors ? parseInt(floors, 10) : undefined,
        tenure,
        description: description || undefined,
        is_vacant: isVacant,
      };
      await createProject(data);
      setSaveStatus('saved');
      onProjectCreated();
    } catch {
      setSaveStatus('error');
    }
  }, [addressRaw, addressPostcode, pricePounds, useClass, floorAreaSqft, floors, tenure, description, isVacant, onProjectCreated]);

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    background: '#0f1d32',
    border: '1px solid #1e3a5f',
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 14,
  };

  const labelStyle = { color: '#94a3b8', fontSize: 13, marginBottom: 4, display: 'block' as const };

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>New Project</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setMode('url')}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            background: mode === 'url' ? '#2563eb' : '#1e3a5f',
            color: '#e2e8f0',
          }}
        >
          Scrape URL
        </button>
        <button
          onClick={() => setMode('manual')}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            background: mode === 'manual' ? '#2563eb' : '#1e3a5f',
            color: '#e2e8f0',
          }}
        >
          Manual Entry
        </button>
      </div>

      {mode === 'url' && (
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste commercial property URL..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleScrape}
              disabled={scrapeStatus === 'loading'}
              style={{
                padding: '8px 20px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {scrapeStatus === 'loading' ? 'Scraping...' : 'Scrape'}
            </button>
          </div>
          {scrapeStatus === 'error' && (
            <p style={{ color: '#ef4444', marginTop: 8, fontSize: 13 }}>{errorMsg}</p>
          )}
          {scrapeStatus === 'success' && (
            <p style={{ color: '#22c55e', marginTop: 8, fontSize: 13 }}>
              Scrape successful — commercial adapters coming in Plan 4
            </p>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Address *</label>
            <input style={inputStyle} value={addressRaw} onChange={(e) => setAddressRaw(e.target.value)} placeholder="Full address" />
          </div>
          <div>
            <label style={labelStyle}>Postcode</label>
            <input style={inputStyle} value={addressPostcode} onChange={(e) => setAddressPostcode(e.target.value)} placeholder="E.g. SW1A 1AA" />
          </div>
          <div>
            <label style={labelStyle}>Price (£) *</label>
            <input style={inputStyle} type="number" value={pricePounds} onChange={(e) => setPricePounds(e.target.value)} placeholder="Guide / asking price" />
          </div>
          <div>
            <label style={labelStyle}>Use Class</label>
            <select style={inputStyle} value={useClass} onChange={(e) => setUseClass(e.target.value as UseClass)}>
              {USE_CLASS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Floor Area (sq ft)</label>
            <input style={inputStyle} type="number" value={floorAreaSqft} onChange={(e) => setFloorAreaSqft(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Number of Floors</label>
            <input style={inputStyle} type="number" value={floors} onChange={(e) => setFloors(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Tenure</label>
            <select style={inputStyle} value={tenure} onChange={(e) => setTenure(e.target.value as Tenure)}>
              {TENURE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isVacant} onChange={(e) => setIsVacant(e.target.checked)} />
            <label style={{ color: '#e2e8f0', fontSize: 14 }}>Property is currently vacant</label>
          </div>
          <button
            onClick={handleManualSave}
            disabled={saveStatus === 'saving' || !addressRaw.trim() || !pricePounds.trim()}
            style={{
              padding: '10px 24px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              marginTop: 8,
              alignSelf: 'flex-start',
            }}
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Create Project'}
          </button>
          {saveStatus === 'saved' && (
            <p style={{ color: '#22c55e', fontSize: 13 }}>Project created successfully</p>
          )}
          {saveStatus === 'error' && (
            <p style={{ color: '#ef4444', fontSize: 13 }}>Failed to create project</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create placeholder components**

Create `frontend/src/components/EligibilityAssessment.tsx`:

```tsx
export default function EligibilityAssessment() {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>PDR Eligibility Assessment</h2>
      <p style={{ color: '#94a3b8' }}>Eligibility engine coming in Plan 2.</p>
    </div>
  );
}
```

Create `frontend/src/components/ConversionCalculator.tsx`:

```tsx
export default function ConversionCalculator() {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Conversion Calculator</h2>
      <p style={{ color: '#94a3b8' }}>Financial calculator coming in Plan 3.</p>
    </div>
  );
}
```

Create `frontend/src/components/PropertyMap.tsx`:

```tsx
export default function PropertyMap() {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Property Map</h2>
      <p style={{ color: '#94a3b8' }}>Leaflet map with flood zone and Article 4 overlays coming in Plan 4.</p>
    </div>
  );
}
```

Create `frontend/src/components/ExportPage.tsx`:

```tsx
export default function ExportPage() {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Export</h2>
      <p style={{ color: '#94a3b8' }}>PDF and Excel export coming in Plan 4.</p>
    </div>
  );
}
```

- [ ] **Step 5: Replace `frontend/src/App.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react';
import type { Project } from './types';
import { listProjects } from './lib/api';

import Pipeline from './components/Pipeline';
import NewProject from './components/NewProject';
import EligibilityAssessment from './components/EligibilityAssessment';
import ConversionCalculator from './components/ConversionCalculator';
import PropertyMap from './components/PropertyMap';
import ExportPage from './components/ExportPage';

type Tab = 'pipeline' | 'new_project' | 'eligibility' | 'calculator' | 'map' | 'export';

const TABS: { key: Tab; label: string }[] = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'new_project', label: 'New Project' },
  { key: 'eligibility', label: 'Eligibility' },
  { key: 'calculator', label: 'Calculator' },
  { key: 'map', label: 'Map' },
  { key: 'export', label: 'Export' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('pipeline');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
      setBackendOffline(false);
    } catch {
      setBackendOffline(true);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleProjectCreated = useCallback(() => {
    loadProjects();
    setActiveTab('pipeline');
  }, [loadProjects]);

  const handleSelectProject = useCallback((project: Project) => {
    setSelectedProject(project);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#050d18', color: '#e2e8f0' }}>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: '1px solid #1e3a5f',
          background: '#0a1628',
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Commercial-Resi-Analyser
        </h1>
        {backendOffline && (
          <span style={{ color: '#ef4444', fontSize: 13 }}>Backend offline</span>
        )}
      </header>

      {/* Tab Navigation */}
      <nav
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid #1e3a5f',
          background: '#0a1628',
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.key ? '#e2e8f0' : '#64748b',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: activeTab === tab.key ? 600 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <main>
        {activeTab === 'pipeline' && (
          <Pipeline projects={projects} onSelectProject={handleSelectProject} />
        )}
        {activeTab === 'new_project' && (
          <NewProject onProjectCreated={handleProjectCreated} />
        )}
        {activeTab === 'eligibility' && <EligibilityAssessment />}
        {activeTab === 'calculator' && <ConversionCalculator />}
        {activeTab === 'map' && <PropertyMap />}
        {activeTab === 'export' && <ExportPage />}
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Verify the frontend compiles**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git add frontend/src/App.tsx frontend/src/components/
git commit -m "feat: add 6-tab app shell with pipeline, new project, and placeholder tabs"
```

---

### Task 8: Clean Up & Verify

**Files:**
- Modify: `app/adapters/registry.py` (clear the residential registries)
- Modify: `main.py` (verify it still works)
- Delete: any remaining residential-only files (parsers, normalizers if not reusable)

**Interfaces:**
- Consumes: all previous tasks
- Produces: a clean, compiling, runnable app with no dead residential code

- [ ] **Step 1: Clear the adapter registry**

Replace `app/adapters/registry.py` contents with an empty registry that keeps the interface:

```python
from app.adapters.base import BaseAdapter
from app.models import CommercialListing

_REGISTRY: dict[str, type[BaseAdapter]] = {}

_URL_TO_SOURCE: dict[str, str] = {}


def get_adapter(source_id: str) -> type[BaseAdapter] | None:
    return _REGISTRY.get(source_id)


def source_id_from_url(url: str) -> str | None:
    from urllib.parse import urlparse
    hostname = urlparse(url).hostname or ""
    hostname = hostname.removeprefix("www.")
    return _URL_TO_SOURCE.get(hostname)
```

- [ ] **Step 2: Verify Python tests pass**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 3: Verify frontend compiles**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit && npx vite build`
Expected: No errors, build succeeds

- [ ] **Step 4: Final commit**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git add -A
git commit -m "feat: clean up residual residential code, verify full build"
```

- [ ] **Step 5: Push to GitHub**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
git push origin main
```

---

## What This Plan Produces

After completing all 8 tasks, you have:

- A new `Commercial-Resi-Analyser` GitHub repo with clean git history
- PostgreSQL schema with 4 tables: `projects`, `eligibility_assessments`, `financial_appraisals`, `stage_transitions`
- Full CRUD API for projects, eligibility, and appraisals (12 endpoints + health/metrics)
- TypeScript types and API client mirroring the backend
- 6-tab frontend shell (Pipeline, New Project, Eligibility, Calculator, Map, Export) with a working New Project form (manual entry) and project list
- Docker Compose ready to run
- All tests passing

## Next Plans

- **Plan 2: Data Integrations & Eligibility Engine** — EA Flood API, EPC API, Postcodes.io, Article 4 dataset, eligibility engine backend + frontend
- **Plan 3: Conversion Financial Calculator** — Commercial SDLT, calc engine, cashflow, all 10 calculator pages
- **Plan 4: Scraping, Pipeline, Map & Export** — Commercial adapters, 7-stage Kanban, Leaflet map, PDF/Excel export
