# Commercial-Resi-Analyser — Design Spec

**Date**: 2026-08-08
**Approach**: Clean Fork & Selective Rebuild (Approach A)
**Origin repo**: UK-Property-Analyser
**New repo**: Commercial-Resi-Analyser

---

## 1. Overview

A purpose-built tool for analysing UK commercial-to-residential property conversions under Permitted Development Rights (PDR). The app helps property developers and investors identify PDR-eligible commercial properties, assess eligibility through semi-automated checks, run detailed financial appraisals for the conversion, and manage deals through a 7-stage pipeline from discovery to completion.

### Target Users

- Property developers evaluating commercial-to-resi conversion opportunities for profit
- Property investors looking at PDR conversions to acquire below-market residential units
- JV partners and investor-facing reporting

---

## 2. Repository Setup

### Forking Strategy

Copy the existing UK-Property-Analyser repo as a new standalone GitHub repo (`Commercial-Resi-Analyser`). Not a GitHub fork — a clean copy with its own git history starting from a single initial commit.

### Kept (Infrastructure)

- Docker Compose setup (PostgreSQL 16, Redis 7, Temporal, API, Worker)
- Dockerfile (Python 3.12-slim + Playwright)
- FastAPI app skeleton (`main.py`, CORS config, health/metrics endpoints)
- SQLAlchemy async engine + Alembic migration framework (fresh migrations)
- React 19 / Vite 8 / TypeScript 5.9 / Tailwind 4 scaffold
- Export framework (jsPDF + xlsx) — adapted for new data shapes
- Pydantic v2 settings, structlog, prometheus-client, pytest setup

### Stripped

- All 12 residential auction house adapters (`app/adapters/`)
- Residential SDLT calculation engine (`frontend/src/lib/calculations.ts`)
- Residential property form (`PropertyForm.tsx`, `LeaseSection.tsx`)
- Residential metrics panel and `MetricCard.tsx`
- All 17 refurb calculator pages and engines (`frontend/src/components/refurb/`)
- Residential-specific types, models, and Pydantic schemas
- All existing Alembic migrations (start fresh)
- `.planning/` directory

### Renamed/Rebranded

- App title, README, `pyproject.toml` metadata → Commercial-Resi-Analyser
- API prefix stays `/api/v1`
- Frontend app shell restructured for new navigation

---

## 3. Data Sources & Scraping Layer

### Commercial Auction Houses (New Adapters)

| Source | Description |
|---|---|
| Allsop Commercial | Largest UK commercial auctioneer |
| Acuitus | Specialist commercial auction house |
| Savills Commercial Auctions | Premium commercial lots |
| SDL Commercial | Regional commercial lots |
| Barnett Ross Commercial | London commercial |

### Commercial Agent Portals

| Source | Description |
|---|---|
| Rightmove Commercial | Broadest commercial listing coverage |
| EIG (Estates Gazette) | Commercial property portal |
| LoopNet UK | CoStar's commercial listing site |

### Scraping Architecture

Same pattern as the existing app: user pastes a URL → backend identifies source from URL → routes to correct adapter → scrapes and normalises. The adapter registry pattern (`app/adapters/registry.py`) carries over.

### Normalised Commercial Listing Model

| Field | Description |
|---|---|
| Address / postcode | Full address with postcode |
| Price (pence) | Asking price or guide price |
| Use class | E(a) office, E(a) retail, B1, A1–A5, sui generis, etc. |
| Floor area (sq ft / sq m) | Total commercial floor area |
| Number of floors / storeys | For conversion unit count estimation |
| Tenure | Freehold / leasehold (with unexpired term) |
| Current use description | Free text from listing |
| EPC rating | If available from listing |
| Listing source & URL | Provenance tracking |
| Auction date / deadline | If auction lot |
| Vacant / occupied status | Critical for Class MA (must be vacant 3+ months) |

---

## 4. PDR Eligibility Engine

### Approach

Semi-automated eligibility assessment. Auto-populates what it can from external API lookups (flood zone, EPC, Article 4 from known dataset, LPA identification), prompts the user for criteria that require manual verification. Produces a clear verdict with per-criterion breakdown.

### Verdict Output

- **Green**: Eligible — all criteria pass
- **Amber**: Likely eligible — manual checks still outstanding
- **Red**: Not eligible — fails one or more hard criteria

Each criterion shows: pass/fail status, data source (auto-checked vs. user-confirmed), and risk flags where professional verification is recommended.

### Class MA (Office to Residential) — Primary PDR Class

| Criterion | Source | Auto/Manual |
|---|---|---|
| Property is in use class E(a) — office | Scraped from listing | Semi-auto (user confirms) |
| Floor area ≤ 1,500 sq m | Scraped floor area | Auto |
| Building vacant for ≥ 3 continuous months | User confirms dates | Manual |
| Not in conservation area | Planning authority lookup + user confirms | Semi-auto |
| Not in AONB / National Park / SSSI | Postcode-based lookup | Auto |
| Not in Article 4 direction area | Local dataset lookup | Semi-auto |
| Not in flood zone 2 or 3 | EA Flood API | Auto |
| Not a listed building | User confirms | Manual |
| Adequate natural light to habitable rooms | User assessment | Manual |
| Adequate transport access | User assessment | Manual |
| No contamination risk | User assessment | Manual |
| Prior approval not previously refused within 2 years | User confirms | Manual |

### Additional PDR Classes

| Class | Conversion | Floor Area Limit |
|---|---|---|
| Class G | Retail E(a) shop → residential | ≤ 150 sq m |
| Class M | Retail/takeaway → residential | ≤ 150 sq m |
| Class N | Amusement/launderette → residential | ≤ 150 sq m |
| Class Q | Agricultural buildings → residential | ≤ 465 sq m |

The engine selects the applicable class based on the property's use class and presents only relevant criteria.

### Suggested Next Steps

Output includes actionable next steps: "commission flood risk assessment", "check LPA for Article 4", "verify vacancy period with evidence", etc.

### Backend Location

- `app/eligibility/` — eligibility engine with per-class rule sets
- `app/integrations/` — API integration layer for EA/EPC/postcode lookups

---

## 5. Conversion Financial Calculator

Purpose-built 10-page calculator for commercial-to-residential PDR conversions.

### Page 1: Acquisition Inputs

- Purchase price / guide price (pre-filled from scrape)
- Commercial SDLT calculation (commercial/mixed-use rates: 0% up to £150k, 2% £150k–£250k, 5% above £250k)
- Legal fees, survey costs, broker fees
- Total acquisition cost

### Page 2: Unit Mix & Schedule

- Number of proposed residential units (estimated from floor area or user-defined)
- Per-unit breakdown: type (studio/1-bed/2-bed/3-bed), floor area, estimated GDV
- Total GDV (Gross Development Value)
- Comparable evidence notes per unit type

### Page 3: Conversion Costs

- Prior approval application fee (currently £96 per dwelling)
- CIL / S106 contributions (by LPA)
- Professional fees (architect, structural engineer, M&E, planning consultant, building control)
- Construction costs — per sq ft rates by conversion type (office fit-out vs. retail shell)
- Contingency % on construction
- Building regs compliance costs (fire safety, sound insulation, Part L)

### Page 4: Finance Structure

- Funding source: cash / bridging loan / development finance
- LTV, interest rate, arrangement fee, exit fee
- Loan term aligned to project timeline
- Equity contribution
- Interest roll-up vs. serviced

### Page 5: Cashflow Projection

- Monthly cashflow table: acquisition → conversion → sale/let
- Drawdown schedule against construction milestones
- Interest accrual
- Net cashflow position per month

### Page 6: Appraisal Summary

- Total costs vs. GDV
- Profit on cost %
- Profit on GDV %
- Return on equity
- Development margin
- IRR (monthly, annualised)
- Residual Land Value (what you should pay for the property)

### Page 7: Scenario Comparison

- Base / Upside / Downside scenarios
- User adjusts: GDV, construction costs, timeline, interest rate
- Side-by-side comparison of key metrics

### Page 8: Exit Strategy

- Sell all units vs. retain and let (BTL)
- Blended strategy (sell some, retain some)
- Rental yield analysis for retained units
- Capital gains consideration

### Page 9: Risk Register

- PDR-specific risks: prior approval refusal, Article 4 introduced mid-project, construction cost overrun, market movement, void periods
- Likelihood / impact scoring
- Mitigation notes

### Page 10: Investor Summary

- One-page deal summary for investors / JV partners
- Key metrics, timeline, unit mix, returns, risks
- Exportable as PDF

### Calculation Engine (Frontend)

| File | Purpose |
|---|---|
| `commercial-sdlt.ts` | Commercial/mixed-use SDLT bands |
| `conversion-calc-engine.ts` | Core engine: GDV, total costs, profit metrics, IRR, RLV |
| `conversion-cashflow.ts` | Monthly cashflow builder with drawdown and interest accrual |
| `conversion-types.ts` | All TypeScript types for the calculator |
| `conversion-defaults.ts` | Default values and cost rate assumptions |

---

## 6. PDR Pipeline & Deal Management

### Pipeline Stages

| Stage | Purpose |
|---|---|
| Opportunity Identified | Property scraped or manually entered. Basic details captured. |
| Eligibility Assessed | PDR eligibility engine run. Green/Amber/Red verdict attached. |
| Financial Appraisal | Conversion calculator completed. Key metrics attached. |
| Prior Approval Submitted | Application submitted to LPA. Target dates tracked. |
| Approved | Prior approval granted. Conditions noted. |
| In Conversion | Construction underway. Progress tracking against cashflow. |
| Complete | Units sold or retained. Actual vs. projected metrics recorded. |

### Dashboard

Kanban board with deal cards showing:
- Property address and thumbnail map
- Use class and PDR class
- Eligibility verdict (traffic light)
- Key financial metrics (GDV, profit on cost %, IRR) once appraised
- Stage timestamps

### Filtering & Sorting

- Filter by: pipeline stage, eligibility verdict, use class, LPA, profit on cost range
- Sort by: date added, GDV, profit on cost, IRR

### Data Model

Single `Project` entity that accumulates data through stages:

| Table | Purpose |
|---|---|
| `project` | Core property details, current pipeline stage, timestamps |
| `eligibility_assessment` | Linked to project — per-criterion results and verdict |
| `financial_appraisal` | Linked to project — full calculator inputs and computed outputs |
| `stage_transitions` | Audit log of stage changes with timestamps and notes |

---

## 7. Tech Stack

### Carried Over

| Component | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, Uvicorn |
| Database | PostgreSQL 16, SQLAlchemy 2.0+ async, Alembic |
| Validation | Pydantic v2 |
| Scraping | Playwright, httpx, BeautifulSoup4, lxml |
| Scheduling | Temporal.io |
| Events | Redis 7 Streams |
| Observability | structlog, prometheus-client |
| Testing | pytest, pytest-asyncio, respx, factory-boy, faker |
| Frontend | React 19, TypeScript 5.9, Vite 8, Tailwind 4 |
| Export | jsPDF, xlsx (SheetJS) |
| Infrastructure | Docker Compose |

### New Additions

| Package | Purpose |
|---|---|
| `leaflet` + `react-leaflet` | Map rendering with OpenStreetMap tiles (free) |
| `@types/leaflet` | TypeScript support |

### External API Integrations

| API | Auth | Cost | Data |
|---|---|---|---|
| EA Flood Risk API | None | Free | Flood zone by postcode/coordinates |
| EPC Open Data API | API key | Free | EPC certificates by address |
| Postcodes.io | None | Free | Postcode → coordinates, LPA, region |
| OS Places API (future) | API key | Freemium | Address lookup, UPRN resolution |

### Article 4 Direction Data

Curated JSON/CSV dataset of known Article 4 directions restricting PDR, keyed by local authority. Bundled with the app, updated manually. Eligibility engine flags "verify with LPA" since dataset may not be exhaustive.

### Environment Variables

- `EPC_API_KEY` — EPC Open Data access
- (Flood and Postcodes.io need no keys)

---

## 8. Navigation & Frontend Structure

### App Shell Tabs

| Tab | Content |
|---|---|
| Pipeline | 7-stage Kanban dashboard with deal cards, filters, sorting |
| New Project | URL input (scrape) or manual entry form for commercial property |
| Eligibility | PDR eligibility assessment — stepped form with auto-fill and verdict |
| Calculator | 10-page conversion financial calculator with sub-nav |
| Map | Property location with flood zone and Article 4 overlays |
| Export | PDF and Excel export for eligibility reports, appraisals, investor packs |

### Component Structure

**Top-level** (`frontend/src/components/`):

| Component | Purpose |
|---|---|
| `UrlBar.tsx` | Adapted for commercial property URLs |
| `ManualEntryForm.tsx` | Manual commercial property input |
| `Pipeline.tsx` | 7-stage Kanban dashboard |
| `ProjectCard.tsx` | Deal card for pipeline board |
| `EligibilityAssessment.tsx` | Stepped eligibility form with auto-fill and verdict |
| `EligibilityVerdict.tsx` | Traffic light result display |
| `ConversionCalculator.tsx` | Calculator shell with 10-page sub-nav |
| `PropertyMap.tsx` | Leaflet map with flood/Article 4 overlays |
| `ExportPage.tsx` | PDR report export |

**Calculator sub-pages** (`frontend/src/components/calculator/`):

| Component | Purpose |
|---|---|
| `AcquisitionPage.tsx` | Purchase price, SDLT, acquisition costs |
| `UnitMixPage.tsx` | Unit schedule and GDV |
| `ConversionCostsPage.tsx` | Construction and professional fees |
| `FinancePage.tsx` | Funding structure |
| `CashflowPage.tsx` | Monthly cashflow projection |
| `AppraisalSummaryPage.tsx` | Key metrics and RLV |
| `ScenariosPage.tsx` | Multi-scenario comparison |
| `ExitStrategyPage.tsx` | Sell vs. retain analysis |
| `RiskRegisterPage.tsx` | PDR-specific risk register |
| `InvestorSummaryPage.tsx` | Investor-facing summary |

**Library/logic** (`frontend/src/lib/`):

| File | Purpose |
|---|---|
| `commercial-sdlt.ts` | Commercial SDLT calculation engine |
| `conversion-calc-engine.ts` | Core financial calculation engine |
| `conversion-cashflow.ts` | Cashflow builder |
| `conversion-types.ts` | TypeScript types |
| `conversion-defaults.ts` | Default values |
| `conversion-formatting.ts` | Number formatting utilities |
| `api.ts` | HTTP client for all backend endpoints |

---

## 9. API Endpoints

### Projects Router (`/api/v1/projects`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/projects` | Create a new project (from scrape or manual entry) |
| `GET` | `/api/v1/projects` | List all projects with optional filters |
| `GET` | `/api/v1/projects/{id}` | Get full project detail including eligibility and appraisal |
| `PUT` | `/api/v1/projects/{id}` | Update project details |
| `DELETE` | `/api/v1/projects/{id}` | Delete a project |
| `POST` | `/api/v1/projects/{id}/stage` | Advance or change pipeline stage |

### Eligibility Router (`/api/v1/eligibility`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/eligibility/{project_id}` | Run eligibility assessment for a project |
| `GET` | `/api/v1/eligibility/{project_id}` | Get eligibility assessment results |
| `PUT` | `/api/v1/eligibility/{project_id}` | Update manual eligibility criteria |

### Appraisals Router (`/api/v1/appraisals`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/appraisals` | Save financial appraisal for a project |
| `GET` | `/api/v1/appraisals/{project_id}` | Get financial appraisal |
| `PUT` | `/api/v1/appraisals/{project_id}` | Update financial appraisal |

### Cascade Deletion

Deleting a project (`DELETE /api/v1/projects/{id}`) cascade-deletes its linked `eligibility_assessment`, `financial_appraisal`, and `stage_transitions` records via foreign key constraints.

### Scrape Router (`/api/v1`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/scrape-url` | Scrape a commercial property URL |

### Data Lookup Router (`/api/v1/lookup`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/lookup/flood/{postcode}` | Flood zone check via EA API |
| `GET` | `/api/v1/lookup/epc/{postcode}` | EPC data lookup |
| `GET` | `/api/v1/lookup/lpa/{postcode}` | Local planning authority lookup |
| `GET` | `/api/v1/lookup/article4/{lpa_code}` | Article 4 direction check |

### System

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus metrics |
