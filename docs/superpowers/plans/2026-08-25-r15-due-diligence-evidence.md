# R15 — Due-diligence evidence schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the appraisal an evidence-led due-diligence schedule (inputs v13, spec §23) — a fixed catalogue of RAG/unknown items with evidence, owner, dates and impacts; derived rows from the five existing evidence mechanisms; a captured listing record with source-conflict flags; QS provenance and price basis on the cost plan; and a seventh FINAL condition, `due_diligence_incomplete` — in both engines, the memo and the UI, with calc 2.14.0 → 2.15.0 and **no money figure moving on any existing document**.

**Architecture:** A non-nullable top-level `due_diligence` block (`source_record`, `items[]`) and two cost-plan additions (`cost_plan.qs`, `CostPackage.price_basis`) in both engines' schemas; a pure module `due_diligence.py` / `due-diligence.ts` computed once in `derive_metrics` / `deriveMetrics` (the `monitoring_statement` pattern) and published on `AppraisalResultV2`; four result-derived flags; validation rules keyed on the new fields; `DraftReason` gains `due_diligence_incomplete` after `vat_basis_unconfirmed` and before `not_approved`; memo §9 becomes "Due Diligence and Risk"; calculator page 13 becomes "Due Diligence"; the entry-point cutover to v13 is the last task.

**Tech Stack:** Python 3.12 / pydantic / pytest (repo root, `pytest`); TypeScript / React / vitest (`cd frontend && npx vitest run`), `npx tsc -b`, `npx eslint . --max-warnings 0`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-08-25-r15-due-diligence-evidence-design.md` (the design; its section numbers are cited below as "design §N"). The calculation specification section it produces is §23 of `docs/financial-model/calculation-specification.md` (written in Task 12).

## Global Constraints

- **Both engines mirror.** Every rule, message, literal and result field lands in `app/financial_model/` and `frontend/src/lib/model/` in the same task, byte-identical where the languages allow. No calculation logic in React components or report generators (spec §11.9).
- **No money figure moves.** calc 2.15.0 adds a result block and four flags; every pre-existing golden pin stays where it is; the v12 → v13 identity gate compares metrics, ledger and schedule with **no exclusions** for the new block.
- **Half-up rounding only:** Python `money_round` (`app/financial_model/engine.py`), never builtin `round()`; percentages through the shared `pct()` (`engine.py` / `frontend/src/lib/model/pct.ts`).
- **`null`/`None` means unknown; `0` means known zero** (spec §1.5). Never default an unknown to a value.
- **Unknown never defaults to green.** Every catalogue item seeds `unknown`; the migration writes it explicitly; the engine reads a pre-v13 document as the seed.
- **Messages:** ASCII hyphen `-` in every new validation message and flag message (never an em-dash) so the cross-engine drift guard can compare them; numbers are never interpolated into a flag message where the two languages would format them differently (a float prints `360.0` in Python and `360` in JS).
- **Dates** are ISO `yyyy-mm-dd` strings validated by the existing `is_calendar_date` / `isCalendarDate`; the engine has no clock (spec §1.4).
- **Locate by content, not by line number.** Line numbers cited below were true at plan time and drift as tasks land. Verify every field name against the source before using it.
- **Version bump** (`CALC_VERSION = "2.15.0"` in `app/financial_model/types.py` and `frontend/src/lib/model/finance-types.ts`) happens in Task 12 together with the spec edit, because `spec-versions.test.ts` requires the spec to contain the current calc version.
- Commit messages: `feat(r15): …`, `test(r15): …`, `docs(r15): …`, `fix(r15): …`, each ending with the two trailer lines the repo uses:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MWTe38x8shvmiMJgRonB8Y
  ```

---

## File structure

| File | Responsibility |
|---|---|
| `app/financial_model/types.py` | v13 input types: `DdCategory`, `DdStatus`, `DdEvidence`, `DdItem`, `SourceRecord`, `DueDiligenceInputs`, `QsProvenance`, `PriceBasis`, `CostPackage.price_basis`, `CostPlanInputs.qs`, `CalculatorInputsV13`, four new `FlagCode`s |
| `app/financial_model/due_diligence.py` (new) | The catalogue literal, the derivation (rollups, derived rows, conflicts, consent expiry, `months_between`), result dataclasses, `due_diligence_flags` |
| `app/financial_model/vat.py` | `vat_basis_confirmed(vat)` — Python twin of `vatBasisGate` |
| `app/financial_model/cost_plan.py` | `PriceBasisSummary`, `CostPlanResult.price_basis` / `.qs` |
| `app/financial_model/metrics.py` | `AppraisalResultV2.due_diligence`; compute + flags in `derive_metrics` |
| `app/financial_model/migrate.py` | `is_v13`, `migrate_v12_to_v13`, `migrate_inputs_to_v13`, `_v13_cost_plan`, `default_due_diligence` |
| `app/financial_model/validation.py` | §23.9 rules; §22.7 message alignment |
| `app/financial_model/provenance.py` | `DraftReason` + `draft_reason(due_diligence_complete=)` |
| `frontend/src/lib/model/due-diligence.ts` (new) | TS twin of `due_diligence.py` (types, catalogue, derivation, flags) |
| `frontend/src/lib/model/finance-types.ts` | `CalculatorInputsV13`, `AnyCalculatorInputs`, `FlagCode`, `AppraisalResultV2.due_diligence` |
| `frontend/src/lib/model/cost-plan.ts` | `QsProvenance`, `PriceBasis`, `CostPackage.price_basis`, `CostPlanInputs.qs`, `PriceBasisSummary`, `CostPlanResult.price_basis` / `.qs` |
| `frontend/src/lib/model/metrics.ts` | compute + flags in `deriveMetrics` |
| `frontend/src/lib/model/migrate.ts` | `isV13`, `migrateV12toV13`, `migrateInputsToV13` |
| `frontend/src/lib/model/validation.ts` | §23.9 rules |
| `frontend/src/lib/model/index.ts` | re-exports |
| `frontend/src/lib/conversion-defaults.ts` | `defaultCalculatorInputsV13(project)` with source-record capture |
| `frontend/src/lib/report-provenance.ts` | `DraftReason`, `DueDiligenceGate`, `dueDiligenceGateFor`, `buildProvenance` |
| `frontend/src/lib/export-investment-memo.ts` | banners; §3 sentences; §5 QS line; §9 "Due Diligence and Risk"; Appendix B; §13 limitation 5 |
| `frontend/src/lib/report-qa/memo-fixtures.ts` | `dueDiligenceInputs()`, `dueDiligenceFinalInputs()` |
| `frontend/src/components/calculator/DueDiligencePage.tsx` (new) | Page 13: schedule editor, derived rows, source-record card, then the risk register |
| `frontend/src/components/calculator/RiskRegisterPage.tsx` | heading becomes a sub-section |
| `frontend/src/components/calculator/ConversionCostsPage.tsx` | QS provenance card; `price_basis` select |
| `frontend/src/components/ConversionCalculator.tsx`, `ExportPage.tsx`, `app/api/app.py` | v13 cutover (Task 13) |
| `frontend/src/lib/deal-spider.ts` | HRB caveat |
| `fixtures/financial-model/y-due-diligence.json` (new) | Fixture Y |
| `tests/fixtures_due_diligence.py`, `frontend/src/lib/model/__fixtures__/due-diligence-docs.ts` (new) | Document builders from Y with named overrides |
| `tests/test_migrate_v13.py`, `tests/test_financial_model_due_diligence.py` (new); `frontend/src/lib/model/due-diligence.test.ts` (new); additions to `migrate.test.ts`, `golden-fixtures.test.ts`, `test_financial_model_fixtures.py`, `validation` tests, `provenance` tests, memo tests, page tests | Tests |
| `docs/financial-model/calculation-specification.md`, `migration-notes.md`, `test-cases.md`, `model-governance.md`, `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` | Documents (Task 12) |

---

## Hand-derived figures for fixture Y (used by Tasks 3, 4, 5, 7, 8)

Fixture Y is fixture X (`fixtures/financial-model/x-unit-sales-ledger.json`) with the evidence layer added and **no money field changed**. X's relevant facts: `acquisition.acquisition_date = "2026-09-01"`, jurisdiction `england_ni` / `user` / `confirmed`; detailed cost plan with packages `pkg-structure` (`structure`, 12,000,000), `pkg-envelope` (`envelope`, 8,000,000), `pkg-mande` (`mech_elec_public_health`, 6,000,000) → base build 26,000,000; network programme whose `construction` phase starts at month **4** (`programme_phase_start_months` `[0, 1, 1, 4, 8, 12, 12]`); one cash equity source `e1` (`confirmed`); `vat.registered: false`; `lender_valuation: null`; `finance.requires_confirmation: false`; `areas.basis: 'manual'` with every area 0; unit NIAs 80 + 95 + 55 + 75 = 305 m²; `risks: []`.

**Y's changes to X:**
- `inputs_version: 13`.
- `areas.existing_gia_sqm: 600` (manual basis → no cost change; Σ NIA 305 < 600 so §15.6 raises warnings only).
- `equity_sources[0].evidence_status: "unconfirmed"` (still committed under spec §2 → no money change).
- `cost_plan.qs: { source: "Gardiner & Theobald", stage: "riba_3", date: "2026-08-01", status: "issued", base_date: "2026-07-01" }`.
- `pkg-structure.price_basis: "fixed_price"`, `pkg-envelope.price_basis: "provisional_sum"`, `pkg-mande.price_basis: null`; `pkg-envelope.notes: "Excludes scaffolding"` (the memo prints a provisional package's notes as its exclusions, Task 8).
- `due_diligence.source_record: { captured_at: "2026-08-25T09:00:00Z", source_name: "rightmove", source_url: "https://example.test/listing/y", is_vacant: false, tenure: "freehold", lease_years_remaining: null, floor_area_sqm: 360, use_class: "office", epc_rating: "D" }`.
- `due_diligence.items`: the 23 entered catalogue items (ids `dd-<code>`) plus one custom item, exactly as this table (fields not listed are `evidence: null`, `expiry_date: null`, `owner: ""`, `due_date: null`, `cost_impact_pence: null`, `programme_impact_months: null`, `action: ""`, `notes: ""`):

| id | status | evidence {source, reference, date} | other fields |
|---|---|---|---|
| dd-planning_route | green | City of York Council / 26/01234/FUL / 2026-07-15 | expiry_date 2026-11-01, owner "Planning consultant" |
| dd-planning_conditions | amber | — | action "Discharge pre-commencement conditions 3 and 5 before start on site", cost_impact_pence 250000, programme_impact_months 1 |
| dd-article_4_direction | green | City of York Council / Article 4 register / 2026-07-10 | |
| dd-conservation_listed | green | Historic England list search / not listed / 2026-07-10 | |
| dd-cil_s106 | unknown | — | |
| dd-title_report | red | Lupton Fawcett / Report on title v1 / 2026-08-05 | action "Obtain deed of release of the 1962 restrictive covenant", cost_impact_pence 1500000, programme_impact_months 3 |
| dd-vacant_possession | green | Vendor's solicitor / VP undertaking / 2026-08-10 | |
| dd-leases_tenancies | unknown | — | |
| dd-rights_of_light | not_applicable | — | notes "No neighbouring windows within 5 m; confirmed by architect" |
| dd-party_wall | not_applicable | — | notes "Detached; no party structures" |
| dd-structural_survey | amber | — | action "Commission intrusive survey of the rear elevation" (both impacts null) |
| dd-asbestos_survey | green | Envirocheck Ltd / R&D survey 4471 / 2026-06-20 | |
| dd-measured_survey | green | Plowman Craven / MS-2026-118 / 2026-06-01 | |
| dd-higher_risk_building | green | Fire engineer / HRB screening memo / 2026-07-01 | |
| dd-fire_strategy | unknown | — | |
| dd-acoustic_thermal | green | Hoare Lea / Part L route note / 2026-07-20 | |
| dd-services_mande | green | Hoare Lea / Stage 3 M&E report / 2026-07-20 | |
| dd-procurement_contractor | amber | — | action "Two-stage tender; appoint by month 3", cost_impact_pence 0, programme_impact_months 2 |
| dd-warranties_building_control | green | Premier Guarantee / Quote PG-88213 / 2026-08-01 | |
| dd-insurance | green | Broker / CAR and PI indication / 2026-08-12 | |
| dd-sponsor_entity | green | Companies House / Stonegate Developments Ltd 12345678 / 2026-05-01 | |
| dd-sales_evidence | green | Savills / Agent's letter / 2026-08-14 | |
| dd-exit_route_evidence | green | Savills / Reservation schedule / 2026-08-14 | |
| dd-custom-basement (code `custom`, category `existing_building`, label "Basement water ingress") | amber | — | action "Tank the basement; price in package", cost_impact_pence 800000, programme_impact_months 1 |

**Derived rows on Y:** `cost_plan_qs` green (detailed, qs issued); `facility_terms` green (`requires_confirmation` false); `equity_sources` **unknown** (one unconfirmed, none rejected); `tax_basis` green (jurisdiction confirmed, `date_basis == 'transaction_date'` because an acquisition date is set, VAT gate passes because nothing bears VAT); `lender_valuation` **unknown** (null).

**Category counts (red, amber, green, unknown, not_applicable, total)**, rows in catalogue order then the custom row:

| category | red | amber | green | unknown | n/a | total |
|---|---|---|---|---|---|---|
| planning | 0 | 1 | 3 | 1 | 0 | 5 |
| title_occupation | 1 | 0 | 1 | 1 | 2 | 5 |
| existing_building | 0 | 2 | 5 | 1 | 0 | 8 |
| construction | 0 | 1 | 3 | 0 | 0 | 4 |
| finance | 0 | 0 | 3 | 1 | 0 | 4 |
| exit | 0 | 0 | 2 | 1 | 0 | 3 |
| **totals** | **1** | **4** | **17** | **5** | **2** | **29** |

- `entered_unknown_count = 3` (cil_s106, leases_tenancies, fire_strategy — the derived unknowns are excluded).
- `addressed_pct = pct(21, 24) = 87.5` (24 entered rows incl. custom; 21 not unknown; n/a counts as addressed).
- `cost_impact_total_pence = 250000 + 1500000 + 0 + 800000 = 2550000` (red/amber rows with a non-null impact; structural_survey excluded).
- `programme_impact_max_months = 3` (max over 1, 3, 2, 1).
- `unassessed_impact_count = 1` (structural_survey).
- `source_conflicts`: `occupation` (is_vacant false, VP green) and `existing_area` (|600 − 360| × 4 = 960 > 360) — two.
- `consent_expiry`: `expiry_month = months_between("2026-09-01", "2026-11-01") = 2`, `construction_start_month = 4`, `expires_before_start = true`.
- Cost plan `price_basis`: `fixed_price_pence 12000000`, `provisional_sums_pence 8000000`, `estimate_pence 0`, `unclassified_pence 6000000`, `fixed_price_coverage_pct = pct(12000000, 26000000) = 46.15`, `provisional_sums_pct = pct(8000000, 26000000) = 30.77`.
- Flags present (codes): `due_diligence_unknown` (amber), `source_conflict` ×2 (red), `consent_expires_before_start` (red), `provisional_sums_present` (amber, `amount_pence 8000000`).
- Money pins **copied from X**: `gdv_pence 94500000`, `gross_sales_pence 94500000`, `selling_costs_pence 2155000`, `funding_gap_pence 0`, `peak_debt_pence 25741975`, `peak_debt_month 11`, `finance_costs_pence 3130199`, `total_development_cost_pence 65135199`, `profit_pence 29364801`, `report_safe true`, `senior_breakeven_pence 36624486`, `developer_breakeven_pence 64659969`.
- Row statuses in row order (28 catalogue rows then the custom row): `["green","amber","green","green","unknown","red","green","unknown","not_applicable","not_applicable","amber","green","green","green","unknown","green","green","green","amber","green","green","green","unknown","green","green","green","unknown","green","amber"]`.

**The catalogue** (28 entries, this order; `derived` marks the five rows never present in `items[]`):

| # | code | category | label | derived |
|---|---|---|---|---|
| 1 | planning_route | planning | Planning consent or prior approval | |
| 2 | planning_conditions | planning | Planning conditions | |
| 3 | article_4_direction | planning | Article 4 direction | |
| 4 | conservation_listed | planning | Conservation area and listed status | |
| 5 | cil_s106 | planning | CIL and S106 liability | |
| 6 | title_report | title_occupation | Report on title | |
| 7 | vacant_possession | title_occupation | Vacant possession | |
| 8 | leases_tenancies | title_occupation | Occupational leases and tenancies | |
| 9 | rights_of_light | title_occupation | Rights of light | |
| 10 | party_wall | title_occupation | Party wall | |
| 11 | structural_survey | existing_building | Structural survey | |
| 12 | asbestos_survey | existing_building | Asbestos survey | |
| 13 | measured_survey | existing_building | Measured survey | |
| 14 | higher_risk_building | existing_building | Higher-risk building confirmation | |
| 15 | fire_strategy | existing_building | Fire strategy | |
| 16 | acoustic_thermal | existing_building | Acoustic and thermal compliance | |
| 17 | services_mande | existing_building | Services, drainage and utilities | |
| 18 | cost_plan_qs | construction | QS cost plan | ✓ |
| 19 | procurement_contractor | construction | Procurement and contractor | |
| 20 | warranties_building_control | construction | Warranty and building control | |
| 21 | insurance | construction | Insurance | |
| 22 | facility_terms | finance | Facility terms | ✓ |
| 23 | equity_sources | finance | Equity sources | ✓ |
| 24 | sponsor_entity | finance | Sponsor entity | |
| 25 | tax_basis | finance | Tax and VAT basis | ✓ |
| 26 | sales_evidence | exit | Sales evidence | |
| 27 | lender_valuation | exit | Lender valuation | ✓ |
| 28 | exit_route_evidence | exit | Exit route evidence | |

---

### Task 1: Schema and catalogue in both engines

**Files:**
- Modify: `app/financial_model/types.py` (after the `CalculatorInputsV12` class; the `CostPackage` / `CostPlanInputs` classes; the `FlagCode` literal; `AnyCalculatorInputs`; `parse_calculator_inputs`)
- Create: `app/financial_model/due_diligence.py` (catalogue only in this task)
- Modify: `frontend/src/lib/model/cost-plan.ts` (`CostPackage`, `CostPlanInputs`, `DEFAULT_COST_PLAN`, `costPlanFromLegacyCosts`)
- Modify: `frontend/src/lib/model/finance-types.ts` (`CalculatorInputsV13`, `AnyCalculatorInputs`, `FlagCode`)
- Create: `frontend/src/lib/model/due-diligence.ts` (types + catalogue only)
- Modify: `frontend/src/lib/model/index.ts` (re-export the new module's types and catalogue)
- Test: `tests/test_financial_model_due_diligence.py` (new), `frontend/src/lib/model/due-diligence.test.ts` (new)

**Interfaces:**
- Produces (Python): `DdCategory`, `DdStatus`, `DdItemCode`, `DdDerivedCode`, `DdEvidence`, `DdItem`, `SourceRecord`, `DueDiligenceInputs`, `QsStage`, `QsStatus`, `QsProvenance`, `PriceBasis`, `CostPackage.price_basis`, `CostPlanInputs.qs`, `CalculatorInputsV13`; in `due_diligence.py`: `DD_CATEGORIES`, `DdCatalogueEntry`, `DD_CATALOGUE`, `ENTERED_CODES`, `DERIVED_CODES`.
- Produces (TS): the same names camel-cased where the repo does (`DD_CATALOGUE`, `ENTERED_CODES`, `DERIVED_CODES`, `DD_CATEGORIES`, `DD_STATUSES`), and `CalculatorInputsV13`.

- [ ] **Step 1: Python types.** In `app/financial_model/types.py`, add after `class CalculatorInputsV12`:

```python
# --- Release 15 (calc 2.15.0): the due-diligence evidence schedule (spec Sec 23) ---

DdCategory = Literal[
    "planning", "title_occupation", "existing_building", "construction", "finance", "exit",
]
DdStatus = Literal["red", "amber", "green", "unknown", "not_applicable"]
# The 23 ENTERED catalogue codes plus 'custom'. The five derived codes
# (cost_plan_qs, facility_terms, equity_sources, tax_basis, lender_valuation)
# are deliberately NOT here: a stored status for a fact another field owns is
# spec Sec 23.2's forbidden state, and validation rejects one (Sec 23.9 rule 1).
DdItemCode = Literal[
    "planning_route", "planning_conditions", "article_4_direction", "conservation_listed",
    "cil_s106", "title_report", "vacant_possession", "leases_tenancies", "rights_of_light",
    "party_wall", "structural_survey", "asbestos_survey", "measured_survey",
    "higher_risk_building", "fire_strategy", "acoustic_thermal", "services_mande",
    "procurement_contractor", "warranties_building_control", "insurance", "sponsor_entity",
    "sales_evidence", "exit_route_evidence", "custom",
]
DdDerivedCode = Literal[
    "cost_plan_qs", "facility_terms", "equity_sources", "tax_basis", "lender_valuation",
]


class DdEvidence(Model):
    source: str = ""
    reference: str = ""
    date: str = ""  # ISO yyyy-mm-dd; the document's date, never today's


class DdItem(Model):
    """Spec Sec 23.1. Mirrors DdItem in due-diligence.ts field for field."""

    id: str
    code: str  # DdItemCode; validated by validation.py so a stray code is a spec-worded error, not a 422
    category: DdCategory
    label: str = ""
    status: DdStatus = "unknown"
    evidence: DdEvidence | None = None
    expiry_date: str | None = None
    owner: str = ""
    due_date: str | None = None
    cost_impact_pence: int | None = Field(default=None, ge=0)
    programme_impact_months: int | None = Field(default=None, ge=0)
    action: str = ""
    notes: str = ""


class SourceRecord(Model):
    """Spec Sec 23.5. The listing's STRUCTURED fields, copied; prose is never copied."""

    captured_at: str
    source_name: str | None = None
    source_url: str | None = None
    is_vacant: bool | None = None
    tenure: Literal["freehold", "leasehold", "unknown"] | None = None
    lease_years_remaining: int | None = Field(default=None, ge=0)
    floor_area_sqm: float | None = Field(default=None, ge=0)
    use_class: str | None = None
    epc_rating: str | None = None


class DueDiligenceInputs(Model):
    source_record: SourceRecord | None = None
    items: list[DdItem] = Field(default_factory=list, max_length=1200)


QsStage = Literal["order_of_cost", "riba_2", "riba_3", "riba_4", "tender", "contract_sum"]
QsStatus = Literal["draft", "issued", "reviewed"]


class QsProvenance(Model):
    """Spec Sec 23.6. Detailed mode only (validation rule 8)."""

    source: str = ""
    stage: QsStage = "order_of_cost"
    date: str = ""
    status: QsStatus = "draft"
    base_date: str = ""


PriceBasis = Literal["fixed_price", "provisional_sum", "estimate"]


class CalculatorInputsV13(CalculatorInputsV12):
    """Mirrors CalculatorInputsV12 with the Sec 23 due-diligence schedule.
    Subclasses V12 for the reason V12 subclasses V11: the engine dispatches on
    it, and a flat re-declaration would make those isinstance checks silently
    False for v13 documents."""

    inputs_version: Literal[13] = 13  # type: ignore[assignment]
    due_diligence: DueDiligenceInputs = Field(default_factory=DueDiligenceInputs)
```

Then:
- On `CostPackage` add, after `phase_id`: `price_basis: PriceBasis | None = None` with a comment "R15 spec Sec 23.6. None = not classified (the migration default). Read only by compute_cost_plan's price-basis summary." — because `PriceBasis` is defined *after* `CostPackage` in the file, move the `PriceBasis = Literal[...]` line (and only it) **above** `class CostPackage`.
- On `CostPlanInputs` add: `qs: QsProvenance | None = None` — move the `QsStage`/`QsStatus`/`QsProvenance` definitions above `class CostPlanInputs` too. Keep the `DdCategory`…`CalculatorInputsV13` block after `CalculatorInputsV12`.
- Add `CalculatorInputsV13` to `AnyCalculatorInputs` and a `version == 13` branch **first** in `parse_calculator_inputs` (copy the v12 branch's comment shape).
- Append to `FlagCode` (before the closing `]`), each with a one-line comment citing spec Sec 23.9: `"due_diligence_unknown"`, `"source_conflict"`, `"consent_expires_before_start"`, `"provisional_sums_present"`.

- [ ] **Step 2: Python catalogue.** Create `app/financial_model/due_diligence.py`:

```python
"""R15 spec Sec 23. The due-diligence evidence schedule.

Port of frontend/src/lib/model/due-diligence.ts. This task declares the
catalogue; Task 3 adds the derivation. It never imports schedule or metrics
(they import it)."""
from __future__ import annotations

from dataclasses import dataclass

DD_CATEGORIES: tuple[str, ...] = (
    "planning", "title_occupation", "existing_building", "construction", "finance", "exit",
)
DD_STATUSES: tuple[str, ...] = ("red", "amber", "green", "unknown", "not_applicable")


@dataclass(frozen=True)
class DdCatalogueEntry:
    code: str
    category: str
    label: str
    derived: bool


#: Spec Sec 23.2, normative and ORDERED. Pinned byte-identical against
#: due-diligence.ts by test_financial_model_due_diligence.py (Sec 21.2's
#: ALLOWED_TRANSITIONS precedent).
DD_CATALOGUE: tuple[DdCatalogueEntry, ...] = (
    DdCatalogueEntry("planning_route", "planning", "Planning consent or prior approval", False),
    DdCatalogueEntry("planning_conditions", "planning", "Planning conditions", False),
    DdCatalogueEntry("article_4_direction", "planning", "Article 4 direction", False),
    DdCatalogueEntry("conservation_listed", "planning", "Conservation area and listed status", False),
    DdCatalogueEntry("cil_s106", "planning", "CIL and S106 liability", False),
    DdCatalogueEntry("title_report", "title_occupation", "Report on title", False),
    DdCatalogueEntry("vacant_possession", "title_occupation", "Vacant possession", False),
    DdCatalogueEntry("leases_tenancies", "title_occupation", "Occupational leases and tenancies", False),
    DdCatalogueEntry("rights_of_light", "title_occupation", "Rights of light", False),
    DdCatalogueEntry("party_wall", "title_occupation", "Party wall", False),
    DdCatalogueEntry("structural_survey", "existing_building", "Structural survey", False),
    DdCatalogueEntry("asbestos_survey", "existing_building", "Asbestos survey", False),
    DdCatalogueEntry("measured_survey", "existing_building", "Measured survey", False),
    DdCatalogueEntry("higher_risk_building", "existing_building", "Higher-risk building confirmation", False),
    DdCatalogueEntry("fire_strategy", "existing_building", "Fire strategy", False),
    DdCatalogueEntry("acoustic_thermal", "existing_building", "Acoustic and thermal compliance", False),
    DdCatalogueEntry("services_mande", "existing_building", "Services, drainage and utilities", False),
    DdCatalogueEntry("cost_plan_qs", "construction", "QS cost plan", True),
    DdCatalogueEntry("procurement_contractor", "construction", "Procurement and contractor", False),
    DdCatalogueEntry("warranties_building_control", "construction", "Warranty and building control", False),
    DdCatalogueEntry("insurance", "construction", "Insurance", False),
    DdCatalogueEntry("facility_terms", "finance", "Facility terms", True),
    DdCatalogueEntry("equity_sources", "finance", "Equity sources", True),
    DdCatalogueEntry("sponsor_entity", "finance", "Sponsor entity", False),
    DdCatalogueEntry("tax_basis", "finance", "Tax and VAT basis", True),
    DdCatalogueEntry("sales_evidence", "exit", "Sales evidence", False),
    DdCatalogueEntry("lender_valuation", "exit", "Lender valuation", True),
    DdCatalogueEntry("exit_route_evidence", "exit", "Exit route evidence", False),
)

ENTERED_CODES: tuple[str, ...] = tuple(e.code for e in DD_CATALOGUE if not e.derived)
DERIVED_CODES: tuple[str, ...] = tuple(e.code for e in DD_CATALOGUE if e.derived)
```

- [ ] **Step 3: TS types + catalogue.** In `frontend/src/lib/model/cost-plan.ts` add (above `CostPackage`):

```ts
/** R15 spec §23.6. null = not classified (the migration default). */
export type PriceBasis = 'fixed_price' | 'provisional_sum' | 'estimate';
export const PRICE_BASIS_VALUES: readonly PriceBasis[] = ['fixed_price', 'provisional_sum', 'estimate'];
export type QsStage = 'order_of_cost' | 'riba_2' | 'riba_3' | 'riba_4' | 'tender' | 'contract_sum';
export const QS_STAGES: readonly QsStage[] = ['order_of_cost', 'riba_2', 'riba_3', 'riba_4', 'tender', 'contract_sum'];
export type QsStatus = 'draft' | 'issued' | 'reviewed';
export const QS_STATUSES: readonly QsStatus[] = ['draft', 'issued', 'reviewed'];
/** R15 spec §23.6. Detailed mode only (validation rule 8). */
export interface QsProvenance {
  source: string;
  stage: QsStage;
  date: string;       // ISO yyyy-mm-dd
  status: QsStatus;
  base_date: string;  // ISO; R15b's inflation origin
}
```

Add `price_basis: PriceBasis | null;` to `CostPackage` (after `phase_id`) and `qs: QsProvenance | null;` to `CostPlanInputs` (after `fee_lines`). Add `qs: null` to `DEFAULT_COST_PLAN` and to the object `costPlanFromLegacyCosts` returns; add `price_basis: null` wherever a `CostPackage` literal is constructed in non-test source (`ConversionCostsPage.tsx`'s `newPackage`, any migration helper that builds packages). Run `npx tsc -b` and add `price_basis: null` / `qs: null` to every **test** literal it reports too (in `__fixtures__/*.ts`, `memo-fixtures.ts`, `*.test.ts`) — mechanical; list the files touched in the commit body.

Create `frontend/src/lib/model/due-diligence.ts`:

```ts
/**
 * R15 spec §23. The due-diligence evidence schedule. Twin of
 * app/financial_model/due_diligence.py. Task 1 declares types and the
 * catalogue; Task 3 adds the derivation.
 */
export type DdCategory = 'planning' | 'title_occupation' | 'existing_building' | 'construction' | 'finance' | 'exit';
export const DD_CATEGORIES: readonly DdCategory[] =
  ['planning', 'title_occupation', 'existing_building', 'construction', 'finance', 'exit'];
export type DdStatus = 'red' | 'amber' | 'green' | 'unknown' | 'not_applicable';
export const DD_STATUSES: readonly DdStatus[] = ['red', 'amber', 'green', 'unknown', 'not_applicable'];
export type DdItemCode =
  | 'planning_route' | 'planning_conditions' | 'article_4_direction' | 'conservation_listed' | 'cil_s106'
  | 'title_report' | 'vacant_possession' | 'leases_tenancies' | 'rights_of_light' | 'party_wall'
  | 'structural_survey' | 'asbestos_survey' | 'measured_survey' | 'higher_risk_building'
  | 'fire_strategy' | 'acoustic_thermal' | 'services_mande'
  | 'procurement_contractor' | 'warranties_building_control' | 'insurance' | 'sponsor_entity'
  | 'sales_evidence' | 'exit_route_evidence' | 'custom';
export type DdDerivedCode = 'cost_plan_qs' | 'facility_terms' | 'equity_sources' | 'tax_basis' | 'lender_valuation';

export interface DdEvidence { source: string; reference: string; date: string; }

export interface DdItem {
  id: string;
  code: DdItemCode;
  category: DdCategory;
  label: string;
  status: DdStatus;
  evidence: DdEvidence | null;
  expiry_date: string | null;
  owner: string;
  due_date: string | null;
  cost_impact_pence: number | null;
  programme_impact_months: number | null;
  action: string;
  notes: string;
}

export interface SourceRecord {
  captured_at: string;
  source_name: string | null;
  source_url: string | null;
  is_vacant: boolean | null;
  tenure: 'freehold' | 'leasehold' | 'unknown' | null;
  lease_years_remaining: number | null;
  floor_area_sqm: number | null;
  use_class: string | null;
  epc_rating: string | null;
}

export interface DueDiligenceInputs {
  source_record: SourceRecord | null;
  items: DdItem[];
}

export interface DdCatalogueEntry {
  code: DdItemCode | DdDerivedCode;
  category: DdCategory;
  label: string;
  derived: boolean;
  /** Editor help text — UI only, NOT part of the cross-engine identity. */
  prompt: string;
}

/** Spec §23.2, normative and ORDERED. Pinned byte-identical (code, category,
 *  label, derived) against due_diligence.py. */
export const DD_CATALOGUE: readonly DdCatalogueEntry[] = [
  { code: 'planning_route', category: 'planning', label: 'Planning consent or prior approval', derived: false,
    prompt: 'Reference, decision date and lapse date of the consent or prior approval the scheme relies on.' },
  // ... one entry per row of the plan's catalogue table, in that order, with a one-sentence prompt each ...
  { code: 'exit_route_evidence', category: 'exit', label: 'Exit route evidence', derived: false,
    prompt: 'Pre-sales, a take-out term sheet or absorption evidence for the modelled exit.' },
];
export const ENTERED_CODES: readonly DdItemCode[] =
  DD_CATALOGUE.filter((e) => !e.derived).map((e) => e.code as DdItemCode);
export const DERIVED_CODES: readonly DdDerivedCode[] =
  DD_CATALOGUE.filter((e) => e.derived).map((e) => e.code as DdDerivedCode);
```

(Write all 28 entries — the `// ...` above is the plan's abbreviation, not the file's. Copy code/category/label exactly from the catalogue table; write a prompt for each.)

In `finance-types.ts` add after `CalculatorInputsV12`:

```ts
/**
 * R15 spec §23.1. `due_diligence` is the only addition, and — unlike
 * `unit_sales`/`monitoring` — it is NOT nullable: an unexamined document is one
 * whose every item is `unknown`, and the migration writes that explicitly.
 */
export interface CalculatorInputsV13 extends Omit<CalculatorInputsV12, 'inputs_version'> {
  inputs_version: 13;
  due_diligence: DueDiligenceInputs;
}
```

(import `DueDiligenceInputs` type from `./due-diligence`), extend `AnyCalculatorInputs` with `| CalculatorInputsV13`, and append the four `FlagCode` members with §23.9 doc comments. In `index.ts` add `export * from './due-diligence';` and re-export `PriceBasis, QsProvenance, QsStage, QsStatus, PRICE_BASIS_VALUES, QS_STAGES, QS_STATUSES` from `./cost-plan`.

- [ ] **Step 4: Catalogue identity tests.** `tests/test_financial_model_due_diligence.py`:

```python
"""R15 spec Sec 23. Twin of due-diligence.test.ts."""
from app.financial_model.due_diligence import DD_CATALOGUE, DERIVED_CODES, ENTERED_CODES

# The literal table BOTH test files carry (spec Sec 23.2). A relabelled or
# reordered entry fails here and in due-diligence.test.ts alike.
CATALOGUE_TRIPLES = [
    ("planning_route", "planning", "Planning consent or prior approval", False),
    ("planning_conditions", "planning", "Planning conditions", False),
    # ... all 28 rows of the plan's catalogue table ...
    ("exit_route_evidence", "exit", "Exit route evidence", False),
]


def test_catalogue_is_exactly_the_spec_sec_23_2_table():
    assert [(e.code, e.category, e.label, e.derived) for e in DD_CATALOGUE] == CATALOGUE_TRIPLES
    assert len(DD_CATALOGUE) == 28


def test_entered_and_derived_partition_the_catalogue():
    assert len(ENTERED_CODES) == 23
    assert set(DERIVED_CODES) == {"cost_plan_qs", "facility_terms", "equity_sources", "tax_basis", "lender_valuation"}
    assert set(ENTERED_CODES).isdisjoint(DERIVED_CODES)
```

`frontend/src/lib/model/due-diligence.test.ts` mirrors it with the same 28 tuples (`expect(DD_CATALOGUE.map((e) => [e.code, e.category, e.label, e.derived])).toEqual(CATALOGUE_TRIPLES)`), plus a compile-time exhaustiveness pin `const ALL_ENTERED: Record<Exclude<DdItemCode, 'custom'>, true> = { ... 23 keys ... }` and `expect(Object.keys(ALL_ENTERED).sort()).toEqual([...ENTERED_CODES].sort())`.

- [ ] **Step 5: Run.** `pytest tests/test_financial_model_due_diligence.py -v` and `cd frontend && npx vitest run src/lib/model/due-diligence.test.ts && npx tsc -b && npx eslint . --max-warnings 0`. Then the full suites (`pytest`, `npx vitest run`) — everything pre-existing must still pass (the new fields all default).

- [ ] **Step 6: Commit** — `feat(r15): v13 schema, QS provenance and price basis types, the 28-item catalogue in both engines (spec 23.1, 23.2, 23.6)`.

---

### Task 2: Migration v12 → v13, identity gate, default document

**Files:**
- Modify: `app/financial_model/migrate.py`, `frontend/src/lib/model/migrate.ts`, `frontend/src/lib/model/index.ts`, `frontend/src/lib/conversion-defaults.ts`
- Test: `tests/test_migrate_v13.py` (new, from `test_migrate_v12.py`), `frontend/src/lib/model/migrate.test.ts` (new `describe('v13 migration -- spec §23.10')`), `frontend/src/lib/conversion-defaults.test.ts`

**Interfaces:**
- Produces (Python): `default_due_diligence() -> dict`, `_v13_cost_plan(plan) -> dict`, `is_v13`, `migrate_v12_to_v13`, `migrate_inputs_to_v13(snapshot, project=None) -> CalculatorInputsV13`, `_RECOGNISED_VERSIONS_V13 = (1, …, 13)`.
- Produces (TS): `defaultDueDiligence(): DueDiligenceInputs`, `isV13`, `migrateV12toV13`, `migrateInputsToV13(snapshot, project?)`, `defaultCalculatorInputsV13(project?)`, `captureSourceRecord(project, capturedAt): SourceRecord`.

- [ ] **Step 1: Write the failing Python tests.** Copy `tests/test_migrate_v12.py` to `tests/test_migrate_v13.py`, substituting v11→v12, v12→v13 throughout, with these deliberate differences:
  - The corpus filter is `<= 12`; `test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink` asserts `len(FIXTURES) >= 19` and that the version-excluded stems are `["y-due-diligence"]` (Task 3 adds it; until then the list is `[]` — write the assertion as `== ["y-due-diligence"]` and expect this one test to stay red until Task 3, saying so in the commit body).
  - `_metrics_dict` pops **only** `calc_version` — `due_diligence` and `monitoring_statement` are both compared (design §7: the engine seeds the catalogue for a pre-v13 document, so both arms agree).
  - `test_migration_writes_the_seed`: migrate `j-blended-refinance` v12 → v13 and assert `inputs_version == 13`, `due_diligence.source_record is None`, `[i.code for i in due_diligence.items] == list(ENTERED_CODES)`, every item `status == "unknown"`, `evidence is None`, `id == f"dd-{code}"`, `label == ""`; `cost_plan.qs is None`; every package `price_basis is None`; and that `"qs"` and `"price_basis"` are present in `model_dump(mode="json")` (WRITTEN, not defaulted).
  - `test_migration_actively_overwrites_a_stray_due_diligence_block`: a v12 dump with `doc["due_diligence"] = {"poison": True}` migrates to the seed.
  - The refusal tests use version **14** as the unrecognised version.
  - Properties 2 and 3 are Task 6's; leave the two functions with `pytest.skip("Task 6")` bodies **removed** — instead write them now against field prefixes `due_diligence`, `cost_plan.qs`, `cost_plan.packages[` with the control for property 3 being a migrated document whose `items` list has its first item deleted (rule 1 fires with field `due_diligence`). They will fail until Task 6 lands; state that in the commit body.

- [ ] **Step 2: Python migration.** In `migrate.py`, after `migrate_inputs_to_v12`:

```python
def default_due_diligence() -> dict[str, Any]:
    """Spec Sec 23.10's seed: every entered catalogue item `unknown`, ids
    deterministic (`dd-<code>`) so the migration is reproducible. Port of
    defaultDueDiligence."""
    from .due_diligence import DD_CATALOGUE
    return {
        "source_record": None,
        "items": [
            {
                "id": f"dd-{e.code}", "code": e.code, "category": e.category, "label": "",
                "status": "unknown", "evidence": None, "expiry_date": None, "owner": "",
                "due_date": None, "cost_impact_pence": None, "programme_impact_months": None,
                "action": "", "notes": "",
            }
            for e in DD_CATALOGUE if not e.derived
        ],
    }


def _v13_cost_plan(plan: dict[str, Any] | None) -> dict[str, Any]:
    """Writes `qs: None` and `price_basis: None` on every package (spec Sec 23.10) --
    written, not defaulted, so the identity gate exercises the written value."""
    out = dict(plan or {})
    out["qs"] = None
    out["packages"] = [{**dict(p), "price_basis": None} for p in (out.get("packages") or [])]
    return out


def is_v13(snapshot: dict[str, Any]) -> bool:
    return snapshot.get("inputs_version") == 13 and "due_diligence" in snapshot


def migrate_v12_to_v13(v12: dict[str, Any] | CalculatorInputsV12) -> CalculatorInputsV13:
    if isinstance(v12, CalculatorInputsV13):
        raise ValueError("migrate_v12_to_v13: input is already a v13 document")
    if isinstance(v12, BaseModel):
        doc = v12.model_dump(mode="json")
    else:
        if is_v13(v12):
            raise ValueError("migrate_v12_to_v13: input is already a v13 document")
        doc = dict(v12)
    doc["due_diligence"] = default_due_diligence()
    doc["cost_plan"] = _v13_cost_plan(doc.get("cost_plan"))
    doc["inputs_version"] = 13
    return CalculatorInputsV13.model_validate(doc)


_RECOGNISED_VERSIONS_V13 = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13)


def migrate_inputs_to_v13(
    snapshot: dict[str, Any], project: dict[str, Any] | None = None,
) -> CalculatorInputsV13:
    """Port of migrateInputsToV13, structurally identical to migrate_inputs_to_v12."""
    # ... the same shape as migrate_inputs_to_v12: the two refusals (messages
    # "migrate_inputs_to_v13: unrecognised inputs_version ..." and
    # "... fails the v13 structural check (missing `due_diligence`) ..."), the
    # is_v13 merge branch whose `defaults` is migrate_v12_to_v13(<the v12 chain>).model_dump(mode="json"),
    # carrying "due_diligence": snapshot.get("due_diligence") through explicitly beside
    # the six existing carried keys, and the fall-through
    # `return migrate_v12_to_v13(migrate_inputs_to_v12(snapshot, project))`.
```

Write the body out in full by copying `migrate_inputs_to_v12` and substituting; the plan abbreviates only what is a verbatim copy. Add `or is_v13(snapshot)` to `is_v2_or_later` (with the R15 line in its comment chain). Import `CalculatorInputsV13` at the top with the other version imports.

- [ ] **Step 3: Run the Python tests** — `pytest tests/test_migrate_v13.py -v`: everything passes except the corpus-shrink assertion (`["y-due-diligence"]`, red until Task 3) and properties 2/3 (red until Task 6). `pytest` in full: only those three red.

- [ ] **Step 4: TS migration.** In `migrate.ts` add (after `migrateInputsToV12`), importing `DD_CATALOGUE` and types from `./due-diligence` and `CalculatorInputsV13` from `./finance-types`:

```ts
export function defaultDueDiligence(): DueDiligenceInputs {
  return {
    source_record: null,
    items: DD_CATALOGUE.filter((e) => !e.derived).map((e) => ({
      id: `dd-${e.code}`, code: e.code as DdItemCode, category: e.category, label: '',
      status: 'unknown', evidence: null, expiry_date: null, owner: '', due_date: null,
      cost_impact_pence: null, programme_impact_months: null, action: '', notes: '',
    })),
  };
}

export function isV13(snapshot: Record<string, unknown>): boolean {
  return snapshot.inputs_version === 13 && 'due_diligence' in snapshot;
}

export function migrateV12toV13(v12: CalculatorInputsV12): CalculatorInputsV13 {
  if (isV13(v12 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV12toV13: input is already a v13 document');
  }
  return {
    ...v12,
    inputs_version: 13,
    cost_plan: {
      ...v12.cost_plan,
      qs: null,
      packages: v12.cost_plan.packages.map((p) => ({ ...p, price_basis: null })),
    },
    due_diligence: defaultDueDiligence(),
  };
}

const RECOGNISED_INPUTS_VERSIONS_V13 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export function migrateInputsToV13(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV13 {
  // Same shape as migrateInputsToV12: the two throws (messages with V13/`due_diligence`),
  // the isV13 merge branch whose `defaults` is migrateV12toV13(<the v12 chain>) and whose
  // return carries `due_diligence: saved.due_diligence ?? defaults.due_diligence` and
  // `cost_plan: { ...defaults.cost_plan, ...(saved.cost_plan ?? {}) }`, and the fall-through
  // `return migrateV12toV13(migrateInputsToV12(snapshot, project));`
}
```

Write `migrateInputsToV13` in full by copying `migrateInputsToV12`. Export the three from `index.ts` beside the v12 exports.

- [ ] **Step 5: TS default document + capture.** In `conversion-defaults.ts`:

```ts
/** R15 spec §23.5. The listing's STRUCTURED fields, copied at capture time. */
export function captureSourceRecord(
  project: Pick<Project, 'source_name' | 'source_url' | 'is_vacant' | 'tenure' | 'lease_years_remaining' | 'floor_area_sqm' | 'use_class' | 'epc_rating'>,
  capturedAt: string,
): SourceRecord {
  return {
    captured_at: capturedAt,
    source_name: project.source_name, source_url: project.source_url,
    is_vacant: project.is_vacant, tenure: project.tenure,
    lease_years_remaining: project.lease_years_remaining, floor_area_sqm: project.floor_area_sqm,
    use_class: project.use_class, epc_rating: project.epc_rating,
  };
}

export type DefaultDocumentProject = {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
} & Partial<Pick<Project, 'source_name' | 'source_url' | 'is_vacant' | 'tenure' | 'lease_years_remaining' | 'use_class' | 'epc_rating'>>;

/** R15 Task 13's cutover target. `now` is injected so tests are reproducible. */
export function defaultCalculatorInputsV13(project?: DefaultDocumentProject, now?: Date): CalculatorInputsV13 {
  const v12 = defaultCalculatorInputsV12(project);
  const dd = defaultDueDiligence();
  const hasListing = project !== undefined && 'is_vacant' in project;
  return {
    ...v12,
    inputs_version: 13,
    cost_plan: { ...v12.cost_plan, qs: null, packages: v12.cost_plan.packages.map((p) => ({ ...p, price_basis: null })) },
    due_diligence: hasListing
      ? { ...dd, source_record: captureSourceRecord({
          source_name: project.source_name ?? null, source_url: project.source_url ?? null,
          is_vacant: project.is_vacant ?? null, tenure: project.tenure ?? 'unknown',
          lease_years_remaining: project.lease_years_remaining ?? null,
          floor_area_sqm: project.floor_area_sqm, use_class: project.use_class ?? 'other',
          epc_rating: project.epc_rating ?? null,
        }, (now ?? new Date()).toISOString()) }
      : dd,
  };
}
```

(Import `Project` type from `../types`, `SourceRecord`/`DueDiligenceInputs` from `./model/due-diligence`, `defaultDueDiligence` from `./model/migrate`. Check `UseClass` includes `'other'`; if not, use the first member of the union and say so in the commit body.)

- [ ] **Step 6: TS tests.** In `migrate.test.ts` add `describe('v13 migration -- spec §23.10')` as the v12 block with substitutions (filter `<= 12`; excluded `['y-due-diligence.json']`; **no** exclusion of `due_diligence` in `metricsSansExcluded` — pop only `calc_version`; the seed-writes test asserting 23 items all `unknown`, ids `dd-<code>`, `cost_plan.qs === null`, every `price_basis === null`, and `restV13` equal to `restV12` once `inputs_version`, `due_diligence`, `cost_plan` are stripped from both; refusal tests use 14; properties 2/3 written now against prefixes `due_diligence` / `cost_plan.qs` / `cost_plan.packages[` with the deleted-first-item control — red until Task 6). In `conversion-defaults.test.ts` add: `defaultCalculatorInputsV13()` (no project) equals `migrateV12toV13(defaultCalculatorInputsV12())` after stripping ids (copy the v12 test's `stripIds` shape); and `defaultCalculatorInputsV13({ id: 'p', price_pence: 1, floor_area_sqm: 360, is_vacant: false, tenure: 'freehold', lease_years_remaining: null, source_name: 'rightmove', source_url: null, use_class: 'office', epc_rating: 'D' }, new Date('2026-08-25T09:00:00Z'))` has `due_diligence.source_record` equal to the captured object with `captured_at: '2026-08-25T09:00:00.000Z'`.

- [ ] **Step 7: Run** — `npx vitest run src/lib/model/migrate.test.ts src/lib/conversion-defaults.test.ts`; expected red: the corpus-shrink assertion and properties 2/3 (as on the Python side). `npx tsc -b`, lint.

- [ ] **Step 8: Commit** — `feat(r15): v12 -> v13 migration, numeric identity gate, default document with source-record capture (spec 23.10, 23.5)`.

---

### Task 3: The derivation module, the fixture builders, and fixture Y's inputs

**Files:**
- Modify: `app/financial_model/due_diligence.py`, `app/financial_model/vat.py`
- Modify: `frontend/src/lib/model/due-diligence.ts`
- Create: `fixtures/financial-model/y-due-diligence.json`, `tests/fixtures_due_diligence.py`, `frontend/src/lib/model/__fixtures__/due-diligence-docs.ts`
- Modify: `tests/test_financial_model_fixtures.py` and `frontend/src/lib/model/golden-fixtures.test.ts` (add `'y-due-diligence'` to `EXPECTED_FIXTURE_STEMS`)
- Test: `tests/test_financial_model_due_diligence.py`, `frontend/src/lib/model/due-diligence.test.ts`

**Interfaces:**
- Produces (Python): `months_between(a: str, b: str) -> int`; `construction_start_month(inputs, schedule) -> int`; dataclasses `DdRow`, `DdCategorySummary`, `DdTotals`, `DdSourceConflict`, `DdConsentExpiry`, `DueDiligenceResult`; `compute_due_diligence(inputs, cost_plan: CostPlanResult, vat: VatResult, acquisition_tax: AcquisitionTaxResult, schedule: Schedule) -> DueDiligenceResult`; `due_diligence_flags(result: DueDiligenceResult, cost_plan: CostPlanResult) -> list[ModelFlag]` (Task 5 wires both); `vat.vat_basis_confirmed(vat: VatResult) -> bool`.
- Produces (TS): the same names (`monthsBetween`, `constructionStartMonth`, `computeDueDiligence`, `dueDiligenceFlags`, interfaces `DdRow`, `DdCategorySummary`, `DdTotals`, `DdSourceConflict`, `DdConsentExpiry`, `DueDiligenceResult`).
- Consumes: `derive_phases`/`is_programme_network` (`programme.py`), `pct` (`engine.py` / `pct.ts`), `vatBasisGate` (`vat.ts`), `ModelFlag`.

- [ ] **Step 1: Author fixture Y.** Copy `x-unit-sales-ledger.json` to `y-due-diligence.json`; set `name: "Fixture Y — due-diligence evidence schedule"`, `kind: "pipeline"`, a `note` stating it is X with the evidence layer and no money change; apply every change in "Hand-derived figures for fixture Y" above (inputs_version 13, `areas.existing_gia_sqm`, equity status, `cost_plan.qs`, `price_basis` per package, `due_diligence`). `expected_metrics` for now: the twelve money pins copied from X plus `report_safe: true` (the DD/cost-plan pins are Task 5's). Add `'y-due-diligence'` to both `EXPECTED_FIXTURE_STEMS` rosters.

- [ ] **Step 2: Fixture builders.** `tests/fixtures_due_diligence.py`, mirroring `fixtures_unit_sales.py`: `_raw_y()`, and `dd_doc(overrides: dict | None) -> CalculatorInputsV13` built via `migrate_inputs_to_v13(raw, None)`. Override keys, each a single named deviation from Y:
  - `status: {code: status}` — sets those items' statuses (a status change alone; the caller supplies evidence/action/notes via the next keys when a rule needs them);
  - `evidence: {code: {source, reference, date} | None}`;
  - `action: {code: str}`, `notes: {code: str}`, `expiry: {code: str | None}`, `impacts: {code: (cost | None, months | None)}`;
  - `source_record: None | dict` (replace);
  - `is_vacant: bool | None` (set on the record);
  - `listing_area: float | None`;
  - `existing_gia: float`;
  - `equity_status: str` (sets e1's status);
  - `lender_valuation: dict` (a `global_pct` block with reason/author/date);
  - `requires_confirmation: bool`;
  - `qs: None | dict`; `price_basis: {package_id: str | None}`; `mode: 'headline'` (sets headline mode AND clears packages, as the Costs page would);
  - `drop_item: code`, `dup_item: code`, `add_item: dict` (raw item appended), `items: list` (replace);
  - `acquisition_date: str | None`;
  - `programme: None` (drops the network, so the construction start falls to 0 under §6);
  - `seed: True` (replaces `items` with the migration seed and sets `source_record: None`, `qs: None`, every `price_basis: None` — the money-inertness twin).
  Also `raw_y_as_v12()` (Y's inputs with `due_diligence` deleted, `cost_plan.qs` and every `price_basis` deleted, `inputs_version: 12` — a genuine v12 document), `schedule_for(doc)` → `build_schedule(doc)`, and `compute(doc)` → runs `build_schedule`, `area_bridge`, `compute_cost_plan(doc, bridge.developed_area_sqm, len(units))`, `calculate_acquisition_tax` **via `run_appraisal(doc).metrics.acquisition_tax`** (do not re-derive the tax call's arguments), then `compute_due_diligence(doc, cost_plan, schedule.vat, acquisition_tax, schedule)`. The TS twin `due-diligence-docs.ts` mirrors every key in camelCase and exposes `ddDoc`, `computeFor`, and `memoText(doc)` (the `unit-sales-docs.ts` shape, using `FIXTURE_PROJECT`).

- [ ] **Step 3: Write the failing tests (Python).** Append to `tests/test_financial_model_due_diligence.py`:

```python
from app.financial_model.due_diligence import compute_due_diligence, months_between
from .fixtures_due_diligence import compute, dd_doc


def test_months_between_is_whole_months_floored():
    assert months_between("2026-09-01", "2026-11-01") == 2
    assert months_between("2024-01-31", "2024-02-29") == 0   # leap-day pair: day-of-month not reached
    assert months_between("2024-01-29", "2024-02-29") == 1
    assert months_between("2026-09-01", "2026-08-15") == -1  # a lapse before acquisition is negative


def test_category_counts_match_the_hand_table():
    r = compute(dd_doc())
    assert [(c.category, c.red, c.amber, c.green, c.unknown, c.not_applicable, c.total) for c in r.categories] == [
        ("planning", 0, 1, 3, 1, 0, 5),
        ("title_occupation", 1, 0, 1, 1, 2, 5),
        ("existing_building", 0, 2, 5, 1, 0, 8),
        ("construction", 0, 1, 3, 0, 0, 4),
        ("finance", 0, 0, 3, 1, 0, 4),
        ("exit", 0, 0, 2, 1, 0, 3),
    ]
    t = r.totals
    assert (t.red, t.amber, t.green, t.unknown, t.not_applicable, t.total) == (1, 4, 17, 5, 2, 29)
    assert t.entered_unknown_count == 3
    assert t.addressed_pct == 87.5
    assert t.cost_impact_total_pence == 2_550_000
    assert t.programme_impact_max_months == 3
    assert t.unassessed_impact_count == 1


def test_row_order_is_catalogue_then_custom_and_derived_rows_name_their_source():
    r = compute(dd_doc())
    assert [row.code for row in r.rows][:28] == [e.code for e in DD_CATALOGUE]
    assert r.rows[28].code == "custom" and r.rows[28].kind == "custom" and r.rows[28].label == "Basement water ingress"
    derived = {row.code: row for row in r.rows if row.kind == "derived"}
    assert derived["equity_sources"].status == "unknown" and derived["equity_sources"].source == "equity_sources[].evidence_status"
    assert derived["lender_valuation"].status == "unknown" and derived["lender_valuation"].source == "lender_valuation"
    assert derived["tax_basis"].status == "green" and derived["tax_basis"].source == "acquisition.jurisdiction_evidence_status + vat"
    assert derived["facility_terms"].status == "green" and derived["facility_terms"].source == "finance.requires_confirmation"
    assert derived["cost_plan_qs"].status == "green" and derived["cost_plan_qs"].source == "cost_plan.qs"


def test_not_applicable_counts_as_addressed_but_is_its_own_column():
    r = compute(dd_doc({"status": {"rights_of_light": "unknown"}, "notes": {"rights_of_light": ""}}))
    assert r.totals.entered_unknown_count == 4
    assert r.totals.addressed_pct == 83.33   # pct(20, 24)


def test_impact_totals_sum_assessed_red_amber_only_and_max_months():
    # A green with an impact contributes nothing.
    r = compute(dd_doc({"impacts": {"asbestos_survey": (9_999_999, 9)}}))
    assert r.totals.cost_impact_total_pence == 2_550_000 and r.totals.programme_impact_max_months == 3
    # Assessing structural_survey moves the total and clears the unassessed count.
    r2 = compute(dd_doc({"impacts": {"structural_survey": (100_000, 0)}}))
    assert r2.totals.cost_impact_total_pence == 2_650_000 and r2.totals.unassessed_impact_count == 0


def test_derived_row_mapping_each_status_by_one_field():
    assert next(x for x in compute(dd_doc({"equity_status": "confirmed"})).rows if x.code == "equity_sources").status == "green"
    assert next(x for x in compute(dd_doc({"equity_status": "rejected"})).rows if x.code == "equity_sources").status == "red"
    assert next(x for x in compute(dd_doc({"requires_confirmation": True})).rows if x.code == "facility_terms").status == "unknown"
    lv = {"basis": "global_pct", "global_value": -5, "per_key_values": None, "reason": "Valuer haircut", "author": "Knight Frank", "date": "2026-08-20"}
    assert next(x for x in compute(dd_doc({"lender_valuation": lv})).rows if x.code == "lender_valuation").status == "green"
    assert next(x for x in compute(dd_doc({"qs": {**QS, "status": "draft"}})).rows if x.code == "cost_plan_qs").status == "amber"
    assert next(x for x in compute(dd_doc({"qs": None})).rows if x.code == "cost_plan_qs").status == "unknown"
    assert next(x for x in compute(dd_doc({"mode": "headline"})).rows if x.code == "cost_plan_qs").status == "unknown"
    assert next(x for x in compute(dd_doc({"acquisition_date": None})).rows if x.code == "tax_basis").status == "unknown"


def test_source_conflicts_two_rules_and_their_negatives():
    r = compute(dd_doc())
    assert [c.rule for c in r.source_conflicts] == ["occupation", "existing_area"]
    assert compute(dd_doc({"is_vacant": None})).source_conflicts[0].rule == "existing_area"
    assert [c.rule for c in compute(dd_doc({"status": {"vacant_possession": "amber"}, "action": {"vacant_possession": "Agree surrender"}})).source_conflicts] == ["existing_area"]
    # exactly 25% does not fire (strict): listing 400 vs existing 500
    assert [c.rule for c in compute(dd_doc({"listing_area": 400, "existing_gia": 500})).source_conflicts] == ["occupation"]
    assert compute(dd_doc({"source_record": None})).source_conflicts == []


def test_consent_expiry_against_the_construction_start():
    r = compute(dd_doc())
    assert (r.consent_expiry.expiry_month, r.consent_expiry.construction_start_month, r.consent_expiry.expires_before_start) == (2, 4, True)
    assert compute(dd_doc({"expiry": {"planning_route": "2027-01-01"}})).consent_expiry.expires_before_start is False   # 4 < 4 is false
    assert compute(dd_doc({"acquisition_date": None})).consent_expiry is None
    assert compute(dd_doc({"expiry": {"planning_route": None}})).consent_expiry is None
    assert compute(dd_doc({"programme": None})).consent_expiry.construction_start_month == 0


def test_pre_v13_document_is_read_as_the_seed():
    from app.financial_model.migrate import migrate_inputs_to_v12
    v12 = migrate_inputs_to_v12(_raw_y_as_v12(), None)   # helper in fixtures_due_diligence: Y's inputs with the v13 keys stripped and version 12
    r = compute(v12)
    assert r.totals.entered_unknown_count == 23 and r.source_record is None and r.source_conflicts == []
```

(`QS` is Y's qs dict, exported from the fixtures module. Note the `expiry 2027-01-01` case: `months_between("2026-09-01", "2027-01-01") = 4`, and `4 < 4` is false.) Mirror every test in `due-diligence.test.ts`.

- [ ] **Step 4: Run — expect ImportError / "not a function".**

- [ ] **Step 5: Implement (Python).** Append to `due_diligence.py`:

```python
import datetime
from dataclasses import dataclass, field
from typing import Any

from .acquisition_tax import AcquisitionTaxResult
from .cost_plan import CostPlanResult
from .engine import ModelFlag, pct
from .programme import is_programme_network
from .schedule import Schedule
from .vat import VatResult, vat_basis_confirmed


def months_between(a: str, b: str) -> int:
    """Whole months from ISO date a to ISO date b, floored (spec Sec 23.9)."""
    ya, ma, da = (int(x) for x in a.split("-"))
    yb, mb, db = (int(x) for x in b.split("-"))
    return (yb - ya) * 12 + (mb - ma) - (1 if db < da else 0)


def construction_start_month(inputs: Any, schedule: Schedule) -> int:
    """Spec Sec 23.9: the resolved start of the phase carrying construction spend
    (network), else the legacy construction package's start_offset, else 0."""
    programme = getattr(inputs, "programme", None)
    if programme is None:
        return 0
    if is_programme_network(programme):
        if schedule.programme is None:
            return 0
        wanted = programme.category_phase_ids.construction
        for p in schedule.programme.phases:
            if p.id == wanted:
                return p.start_month
        return 0
    return programme.packages.construction.start_offset


@dataclass
class DdRow:
    id: str
    code: str
    category: str
    label: str
    kind: str                       # 'entered' | 'custom' | 'derived'
    status: str
    evidence: dict[str, str] | None
    expiry_date: str | None
    owner: str
    due_date: str | None
    cost_impact_pence: int | None
    programme_impact_months: int | None
    action: str
    notes: str
    source: str | None              # derived rows: the field read


@dataclass
class DdCategorySummary:
    category: str
    red: int = 0
    amber: int = 0
    green: int = 0
    unknown: int = 0
    not_applicable: int = 0
    total: int = 0


@dataclass
class DdTotals:
    red: int = 0
    amber: int = 0
    green: int = 0
    unknown: int = 0
    not_applicable: int = 0
    total: int = 0
    entered_unknown_count: int = 0
    addressed_pct: float | None = None
    cost_impact_total_pence: int = 0
    programme_impact_max_months: int | None = None
    unassessed_impact_count: int = 0


@dataclass
class DdSourceConflict:
    rule: str          # 'occupation' | 'existing_area'
    statement: str


@dataclass
class DdConsentExpiry:
    expiry_month: int
    construction_start_month: int
    expires_before_start: bool


@dataclass
class DueDiligenceResult:
    rows: list[DdRow] = field(default_factory=list)
    categories: list[DdCategorySummary] = field(default_factory=list)
    totals: DdTotals = field(default_factory=DdTotals)
    source_record: dict[str, Any] | None = None
    source_conflicts: list[DdSourceConflict] = field(default_factory=list)
    consent_expiry: DdConsentExpiry | None = None


OCCUPATION_CONFLICT = (
    "source conflict: the listing records the property as occupied; vacant possession is marked "
    "green - evidence the surrender or correct the status"
)
EXISTING_AREA_CONFLICT = (
    "source conflict: the listing floor area and the entered existing GIA differ by more than 25%"
)


def _seed_items() -> list[Any]:
    from .migrate import default_due_diligence
    from .types import DdItem
    return [DdItem.model_validate(i) for i in default_due_diligence()["items"]]


def _derived_status(code: str, inputs: Any, cost_plan: CostPlanResult, vat: VatResult,
                    acquisition_tax: AcquisitionTaxResult) -> tuple[str, str, dict[str, str] | None]:
    """(status, source, evidence) per spec Sec 23.3's table."""
    if code == "cost_plan_qs":
        qs = getattr(getattr(inputs, "cost_plan", None), "qs", None)
        if cost_plan.mode != "detailed" or qs is None:
            return "unknown", "cost_plan.qs", None
        ev = {"source": qs.source, "reference": f"{qs.stage} / {qs.status}", "date": qs.date}
        return ("amber" if qs.status == "draft" else "green"), "cost_plan.qs", ev
    if code == "facility_terms":
        return ("unknown" if inputs.finance.requires_confirmation else "green"), "finance.requires_confirmation", None
    if code == "equity_sources":
        statuses = [e.evidence_status for e in inputs.equity_sources]
        if any(s == "rejected" for s in statuses):
            status = "red"
        elif any(s == "unconfirmed" for s in statuses):
            status = "unknown"
        else:
            status = "green"
        counts = {s: statuses.count(s) for s in ("confirmed", "unconfirmed", "rejected")}
        ev = {"source": "equity_sources", "reference": ", ".join(f"{k}: {v}" for k, v in counts.items()), "date": ""}
        return status, "equity_sources[].evidence_status", ev
    if code == "tax_basis":
        acq = inputs.acquisition
        confirmed = (
            getattr(acq, "jurisdiction_evidence_status", None) == "confirmed"
            and acquisition_tax.date_basis == "transaction_date"
            and vat_basis_confirmed(vat)
        )
        ev = {"source": str(getattr(acq, "jurisdiction_source", "")), "reference": acquisition_tax.jurisdiction, "date": acquisition_tax.band_set_effective_from}
        return ("green" if confirmed else "unknown"), "acquisition.jurisdiction_evidence_status + vat", ev
    if code == "lender_valuation":
        lv = getattr(inputs, "lender_valuation", None)
        if lv is None:
            return "unknown", "lender_valuation", None
        return "green", "lender_valuation", {"source": lv.author, "reference": lv.reason, "date": lv.date}
    raise ValueError(code)


def compute_due_diligence(
    inputs: Any, cost_plan: CostPlanResult, vat: VatResult,
    acquisition_tax: AcquisitionTaxResult, schedule: Schedule,
) -> DueDiligenceResult:
    dd = getattr(inputs, "due_diligence", None)
    items = list(dd.items) if dd is not None else _seed_items()
    source_record = dd.source_record if dd is not None else None
    by_code = {i.code: i for i in items if i.code != "custom"}

    rows: list[DdRow] = []
    for entry in DD_CATALOGUE:
        if entry.derived:
            status, source, ev = _derived_status(entry.code, inputs, cost_plan, vat, acquisition_tax)
            rows.append(DdRow(id=f"dd-{entry.code}", code=entry.code, category=entry.category, label=entry.label,
                              kind="derived", status=status, evidence=ev, expiry_date=None, owner="", due_date=None,
                              cost_impact_pence=None, programme_impact_months=None, action="", notes="", source=source))
            continue
        item = by_code.get(entry.code)
        if item is None:
            continue   # validation rule 1 reports it; the dashboard cannot invent a row
        rows.append(_row_from_item(item, entry.label, "entered"))
    for item in items:
        if item.code == "custom":
            rows.append(_row_from_item(item, item.label, "custom"))

    categories = [DdCategorySummary(category=c) for c in DD_CATEGORIES]
    by_cat = {c.category: c for c in categories}
    totals = DdTotals()
    entered_rows = [r for r in rows if r.kind != "derived"]
    for r in rows:
        for target in (by_cat[r.category], totals):
            setattr(target, r.status, getattr(target, r.status) + 1)
            target.total += 1
    totals.entered_unknown_count = sum(1 for r in entered_rows if r.status == "unknown")
    totals.addressed_pct = pct(len(entered_rows) - totals.entered_unknown_count, len(entered_rows))
    assessed = [r for r in rows if r.status in ("red", "amber")]
    totals.cost_impact_total_pence = sum(r.cost_impact_pence for r in assessed if r.cost_impact_pence is not None)
    months = [r.programme_impact_months for r in assessed if r.programme_impact_months is not None]
    totals.programme_impact_max_months = max(months) if months else None
    totals.unassessed_impact_count = sum(
        1 for r in assessed if r.cost_impact_pence is None or r.programme_impact_months is None
    )

    conflicts: list[DdSourceConflict] = []
    if source_record is not None:
        vp = by_code.get("vacant_possession")
        if source_record.is_vacant is False and vp is not None and vp.status == "green":
            conflicts.append(DdSourceConflict("occupation", OCCUPATION_CONFLICT))
        listing = source_record.floor_area_sqm
        existing = getattr(getattr(inputs, "areas", None), "existing_gia_sqm", 0) or 0
        if listing is not None and listing > 0 and existing > 0 and abs(existing - listing) * 4 > listing:
            conflicts.append(DdSourceConflict("existing_area", EXISTING_AREA_CONFLICT))

    consent: DdConsentExpiry | None = None
    planning = by_code.get("planning_route")
    acq_date = getattr(inputs.acquisition, "acquisition_date", None)
    if planning is not None and planning.expiry_date and acq_date:
        expiry_month = months_between(acq_date, planning.expiry_date)
        start = construction_start_month(inputs, schedule)
        consent = DdConsentExpiry(expiry_month, start, expiry_month < start)

    return DueDiligenceResult(
        rows=rows, categories=categories, totals=totals,
        source_record=None if source_record is None else source_record.model_dump(mode="json"),
        source_conflicts=conflicts, consent_expiry=consent,
    )


def _row_from_item(item: Any, label: str, kind: str) -> DdRow:
    return DdRow(
        id=item.id, code=item.code, category=item.category, label=label, kind=kind, status=item.status,
        evidence=None if item.evidence is None else item.evidence.model_dump(mode="json"),
        expiry_date=item.expiry_date, owner=item.owner, due_date=item.due_date,
        cost_impact_pence=item.cost_impact_pence, programme_impact_months=item.programme_impact_months,
        action=item.action, notes=item.notes, source=None,
    )


def due_diligence_flags(result: DueDiligenceResult, cost_plan: CostPlanResult) -> list[ModelFlag]:
    """Spec Sec 23.9's flag table. Pure; mirrors dueDiligenceFlags."""
    out: list[ModelFlag] = []
    t = result.totals
    entered = sum(1 for r in result.rows if r.kind != "derived")
    if t.entered_unknown_count > 0:
        out.append(ModelFlag(code="due_diligence_unknown", severity="amber", month=None, amount_pence=None,
                             message=f"due diligence: {t.entered_unknown_count} of {entered} entered items unknown - unknown is never treated as green"))
    for c in result.source_conflicts:
        out.append(ModelFlag(code="source_conflict", severity="red", month=None, amount_pence=None, message=c.statement))
    ce = result.consent_expiry
    if ce is not None and ce.expires_before_start:
        out.append(ModelFlag(code="consent_expires_before_start", severity="red", month=ce.expiry_month, amount_pence=None,
                             message=f"planning consent lapses at month {ce.expiry_month}, before construction starts at month {ce.construction_start_month}"))
    pb = cost_plan.price_basis
    if pb is not None and pb.provisional_sums_pence > 0:
        out.append(ModelFlag(code="provisional_sums_present", severity="amber", month=None, amount_pence=pb.provisional_sums_pence,
                             message=f"provisional sums are present in the cost plan: {pb.provisional_sums_pence}p"))
    return out
```

`cost_plan.price_basis` is Task 4's; until then `due_diligence_flags` is only defined, not called (Task 5 wires it) — write it now with the attribute read so Task 4's shape is fixed here. Watch the import cycle: `due_diligence.py` imports `schedule`, `cost_plan`, `vat`, `acquisition_tax`, `engine`; none of those may import it (only `metrics.py` will). `_seed_items` imports `migrate` lazily inside the function (migrate imports types, not this module — confirm no cycle by importing `app.financial_model` in a fresh interpreter).

Add to `vat.py`:

```python
def vat_basis_confirmed(vat: VatResult) -> bool:
    """Spec Sec 17.10's gate predicate -- the Python twin of vatBasisGate (vat.ts):
    no charge line that actually bears VAT rests on an unconfirmed status, and the
    purchase leg is confirmed when purchase VAT is chargeable."""
    row_unconfirmed = any(c.evidence_status == "unconfirmed" and c.vat_pence != 0 for c in vat.charges)
    purchase_unconfirmed = vat.purchase_vat_chargeable and vat.purchase_evidence_status == "unconfirmed"
    return not row_unconfirmed and not purchase_unconfirmed
```

(Verify `VatChargeLine` has `vat_pence` — `vat.ts`'s `charges[].vat_pence` is the mirror; if the Python field is named differently, use the Python name and note it.)

- [ ] **Step 6: Implement (TS)** in `due-diligence.ts`: the same functions, with `pct` from `./pct`, `vatBasisGate` from `./vat`, `isProgrammeNetwork` from `./programme`, types `CostPlanResult`, `VatResult`, `AcquisitionTaxResult` (check its TS home: `../tax/acquisition-tax` or `finance-types`), `Schedule`, `ModelFlag` from `./finance-types`; `SEED` via `defaultDueDiligence()` imported from `./migrate` — **beware the cycle** `migrate.ts → due-diligence.ts (DD_CATALOGUE) → migrate.ts`: to avoid it, move `defaultDueDiligence` INTO `due-diligence.ts` and have `migrate.ts` import it from there (update Task 2's import accordingly; the exported name is unchanged). Result interfaces mirror the dataclasses exactly (`source_record: SourceRecord | null`, `evidence: DdEvidence | null`). Statuses are typed `DdStatus`; `kind: 'entered' | 'custom' | 'derived'`. Use `Math.abs(existing - listing) * 4 > listing` for rule 2.

- [ ] **Step 7: Run both test files, then the full suites.** The fixture roster tests now pass on both sides (Y present, money pins from X reproduce — if any of the twelve does not reproduce, the assumption "no money moves" is false: stop and report which). Task 2's corpus-shrink assertions go green.

- [ ] **Step 8: Commit** — `feat(r15): due-diligence derivation in both engines, fixture Y inputs, document builders (spec 23.3, 23.4, 23.5)`.

---

### Task 4: Price basis and QS provenance on the cost-plan result

**Files:**
- Modify: `app/financial_model/cost_plan.py`, `frontend/src/lib/model/cost-plan.ts`
- Test: `tests/test_cost_plan.py`, `frontend/src/lib/model/cost-plan.test.ts`

**Interfaces:**
- Produces: `PriceBasisSummary { fixed_price_pence, provisional_sums_pence, estimate_pence, unclassified_pence, fixed_price_coverage_pct: float | None, provisional_sums_pct: float | None }`; `CostPlanResult.price_basis: PriceBasisSummary | None` (None in headline mode); `CostPlanResult.qs: dict | None` (Python: `qs.model_dump(mode="json")`; TS: the `QsProvenance` object) — republished input, detailed mode only, else None.

- [ ] **Step 1: Failing tests.** Python (`tests/test_cost_plan.py`, using `dd_doc` from `fixtures_due_diligence` — or a local detailed plan built from `q-detailed-cost-plan` if that file prefers its own builders):

```python
def test_price_basis_summary_by_hand_on_fixture_y():
    r = run_appraisal(dd_doc()).metrics.cost_plan
    pb = r.price_basis
    assert (pb.fixed_price_pence, pb.provisional_sums_pence, pb.estimate_pence, pb.unclassified_pence) == (12_000_000, 8_000_000, 0, 6_000_000)
    assert (pb.fixed_price_coverage_pct, pb.provisional_sums_pct) == (46.15, 30.77)
    assert r.qs == {"source": "Gardiner & Theobald", "stage": "riba_3", "date": "2026-08-01", "status": "issued", "base_date": "2026-07-01"}

def test_classifying_the_null_package_moves_coverage_by_its_share():
    pb = run_appraisal(dd_doc({"price_basis": {"pkg-mande": "fixed_price"}})).metrics.cost_plan.price_basis
    assert (pb.fixed_price_pence, pb.unclassified_pence, pb.fixed_price_coverage_pct) == (18_000_000, 0, 69.23)
    pb2 = run_appraisal(dd_doc({"price_basis": {"pkg-mande": "estimate"}})).metrics.cost_plan.price_basis
    assert (pb2.estimate_pence, pb2.unclassified_pence) == (6_000_000, 0)

def test_headline_mode_publishes_no_price_basis_and_no_qs():
    r = run_appraisal(dd_doc({"mode": "headline", "qs": None})).metrics.cost_plan
    assert r.price_basis is None and r.qs is None
```

TS twin in `cost-plan.test.ts` via `ddDoc`.

- [ ] **Step 2: Implement.** Python: `@dataclass class PriceBasisSummary` (six fields, in the order above) placed before `CostPlanResult`; add `price_basis: PriceBasisSummary | None = None` and `qs: dict[str, Any] | None = None` as the LAST two `CostPlanResult` fields; in `compute_cost_plan`, in detailed mode, sum `amount_pence` by `getattr(pkg, "price_basis", None)` into the four buckets (`None` → unclassified), `fixed_price_coverage_pct=pct(fixed, base_build)`, `provisional_sums_pct=pct(provisional, base_build)` (`pct` from `.engine`); `qs = getattr(plan, "qs", None)`; pass `price_basis=None if not detailed else summary`, `qs=None if not detailed or qs is None else qs.model_dump(mode="json")`. TS: `export interface PriceBasisSummary {...}`; `price_basis: PriceBasisSummary | null; qs: QsProvenance | null;` on `CostPlanResult`; the same sums with `p.price_basis ?? null`, `pct` from `./pct`; `qs: detailed ? (plan.qs ?? null) : null`.

- [ ] **Step 3: Run** the two test files, then the full suites: existing `CostPlanResult` deep-equality expectations (if any) gain the two new fields — update them and list the tests touched in the commit body.

- [ ] **Step 4: Commit** — `feat(r15): price-basis summary and QS provenance on the cost-plan result (spec 23.6)`.

---

### Task 5: Wire the schedule into the result, the four flags, fixture Y's pins

**Files:**
- Modify: `app/financial_model/metrics.py`, `frontend/src/lib/model/metrics.ts`, `frontend/src/lib/model/finance-types.ts` (`AppraisalResultV2.due_diligence`)
- Modify: `fixtures/financial-model/y-due-diligence.json` (pins), `tests/test_financial_model_fixtures.py` and `frontend/src/lib/model/golden-fixtures.test.ts` (FLAT_KEYS mappers)
- Test: `tests/test_financial_model_due_diligence.py`, `frontend/src/lib/model/due-diligence.test.ts`

**Interfaces:**
- Produces: `AppraisalResultV2.due_diligence: DueDiligenceResult` (never None), placed immediately after `monitoring_statement` and before `flags` in both engines; `metrics.flags` gains the §23.9 flags after the monitoring flags.

- [ ] **Step 1: Add fixture Y's pins** to `expected_metrics` (all hand-derived above):

```
"due_diligence.totals.red": 1, ".amber": 4, ".green": 17, ".unknown": 5, ".not_applicable": 2, ".total": 29,
"due_diligence.totals.entered_unknown_count": 3, "due_diligence.totals.addressed_pct": 87.5,
"due_diligence.totals.cost_impact_total_pence": 2550000, "due_diligence.totals.programme_impact_max_months": 3,
"due_diligence.totals.unassessed_impact_count": 1,
"due_diligence_category_counts": [[0,1,3,1,0,5],[1,0,1,1,2,5],[0,2,5,1,0,8],[0,1,3,0,0,4],[0,0,3,1,0,4],[0,0,2,1,0,3]],
"due_diligence_row_codes": [<28 catalogue codes in order>, "custom"],
"due_diligence_row_statuses": [<the 29 statuses listed above>],
"due_diligence_source_conflict_rules": ["occupation", "existing_area"],
"due_diligence.consent_expiry.expiry_month": 2, "due_diligence.consent_expiry.construction_start_month": 4,
"due_diligence.consent_expiry.expires_before_start": true,
"cost_plan.price_basis.fixed_price_pence": 12000000, "cost_plan.price_basis.provisional_sums_pence": 8000000,
"cost_plan.price_basis.estimate_pence": 0, "cost_plan.price_basis.unclassified_pence": 6000000,
"cost_plan.price_basis.fixed_price_coverage_pct": 46.15, "cost_plan.price_basis.provisional_sums_pct": 30.77,
"flag_codes_r15": ["due_diligence_unknown", "source_conflict", "source_conflict", "consent_expires_before_start", "provisional_sums_present"]
```

(Write the dotted keys out in full.) Add FLAT_KEYS mappers on both sides: `due_diligence_category_counts` → `[[c.red, c.amber, c.green, c.unknown, c.not_applicable, c.total] for c in categories]`; `due_diligence_row_codes` → `[r.code ...]`; `due_diligence_row_statuses` → `[r.status ...]`; `due_diligence_source_conflict_rules` → `[c.rule ...]`; `flag_codes_r15` → the codes of `metrics.flags` filtered to the four R15 codes, in flag order.

- [ ] **Step 2: Failing tests.** In the due-diligence test files: `test_result_is_published_on_metrics_and_flags_fire`: `run_appraisal(dd_doc())` — `metrics.due_diligence.totals.entered_unknown_count == 3`; the five R15 flag codes as listed; the `provisional_sums_present` flag's `amount_pence == 8_000_000`; the `consent_expires_before_start` flag's `month == 2`. `test_money_is_inert`: `run_appraisal(dd_doc())` vs `run_appraisal(dd_doc({"seed": True}))` — equal `gdv_pence`, `total_development_cost_pence`, `profit_pence`, `peak_debt_pence`, `finance_costs_pence`, and `asdict(model)` equal. Run: FAIL (`metrics` has no `due_diligence`).

- [ ] **Step 3: Implement.** Python `metrics.py`: import `compute_due_diligence, due_diligence_flags, DueDiligenceResult` from `.due_diligence`; add the field to `AppraisalResultV2` after `monitoring_statement` with a comment ("R15 spec Sec 23.4. Computed ONCE here, from the cost_plan, the schedule's vat and the acquisition tax already derived; never recomputed by the UI or the memo; never None — a pre-v13 document is read as the seed"); in `derive_metrics`, after `flags.extend(monitoring_flags(...))`: `due_diligence = compute_due_diligence(inputs, cost_plan, schedule.vat, acquisition_tax, schedule)` then `flags.extend(due_diligence_flags(due_diligence, cost_plan))`; pass `due_diligence=due_diligence` to the constructor. TS `metrics.ts` / `finance-types.ts`: the same (`due_diligence: DueDiligenceResult;` after `monitoring_statement`; `computeDueDiligence(inputs, costPlan, schedule.vat, acquisitionTax, schedule)`; `flags.push(...dueDiligenceFlags(dueDiligence, costPlan))`).

- [ ] **Step 4: Run** the two test files, the golden-fixture suites (Y's new pins), `test_migrate_v13.py` / the v13 migrate block (identity gate now compares `due_diligence` on both arms — must be equal), then the full suites.

- [ ] **Step 5: Commit** — `feat(r15): due_diligence on AppraisalResultV2, the four flags, fixture Y pins in both harnesses (spec 23.8, 23.9)`.

---

### Task 6: Validation rules, the drift guard, the unit-sales identity

**Files:**
- Modify: `app/financial_model/validation.py`, `frontend/src/lib/model/validation.ts`
- Test: `tests/test_financial_model_validation.py`, `frontend/src/lib/model/validation.test.ts`, `tests/test_migrate_v13.py` (properties 2/3 go green), `tests/test_financial_model_unit_sales.py`, `frontend/src/lib/model/unit-sales.test.ts`

**Interfaces:**
- Produces: `validate_due_diligence(inputs, issues)` / `validateDueDiligence(inputs, issues)` called from `validate_inputs` / `validateInputs` **immediately before** the `if ('jurisdiction' in inputs.acquisition)` block (TS) and its Python mirror, so the drift guard's window covers it.

- [ ] **Step 1: Failing tests** (Python; mirror in TS). Field keys and messages are normative — copy them exactly:

| # | condition | field | message |
|---|---|---|---|
| 1a | an entered catalogue code absent from `items` | `due_diligence` | `Due diligence item "{code}" is missing - every catalogue item must be present.` |
| 1b | a code appears twice | `due_diligence.items[{i}].code` | `Due diligence item "{code}" appears more than once.` |
| 1c | a derived code in `items` | `due_diligence.items[{i}].code` | `Due diligence item "{code}" is derived from the model and cannot be entered.` |
| 1d | a code in neither list and not `custom` | `due_diligence.items[{i}].code` | `Due diligence item code "{code}" is not in the catalogue.` |
| 1e | `custom` with empty `label` | `due_diligence.items[{i}].label` | `A custom due diligence item needs a label.` |
| 1f | any item whose `category` is outside the enum | `due_diligence.items[{i}].category` | `Due diligence category must be one of planning, title_occupation, existing_building, construction, finance, exit.` |
| 1g | duplicate `id` | `due_diligence.items[{i}].id` | `Due diligence item id "{id}" is not unique.` |
| 2 | `green` with `evidence` null, or `source`/`date` empty after trim | `due_diligence.items[{i}].evidence` | `A green status needs evidence: record the source and the date.` |
| 3 | `red`/`amber` with `action` empty after trim | `due_diligence.items[{i}].action` | `A red or amber status needs an action.` |
| 4 | `not_applicable` with `notes` empty after trim | `due_diligence.items[{i}].notes` | `A not-applicable status needs a reason in notes.` |
| 5 | a present date failing `is_calendar_date` | the date's own field (`...evidence.date`, `...expiry_date`, `...due_date`, `cost_plan.qs.date`, `cost_plan.qs.base_date`) | `Evidence date must be a real calendar date in yyyy-mm-dd form.` / `Expiry date must be a real calendar date in yyyy-mm-dd form.` / `Due date must be a real calendar date in yyyy-mm-dd form.` / `QS date must be a real calendar date in yyyy-mm-dd form.` / `QS base date must be a real calendar date in yyyy-mm-dd form.` |
| 6 | impacts non-integer or negative | `...cost_impact_pence` / `...programme_impact_months` | `Cost impact must be a whole number of pence, zero or more.` / `Programme impact must be a whole number of months, zero or more.` |
| 7 | source record: empty `captured_at`; negative area; negative or non-integer lease years; tenure outside enum | `due_diligence.source_record.captured_at` / `.floor_area_sqm` / `.lease_years_remaining` / `.tenure` | `The captured listing record needs a captured_at timestamp.` / `Listing floor area must be zero or more.` / `Listing lease years remaining must be a whole number, zero or more.` / `Listing tenure must be freehold, leasehold or unknown.` |
| 8 | `qs` non-null in headline mode; `qs.source` empty; stage/status outside enums | `cost_plan.qs` / `cost_plan.qs.source` / `cost_plan.qs.stage` / `cost_plan.qs.status` | `QS provenance applies to a detailed cost plan only - switch to detailed mode or remove it.` / `QS provenance needs a source.` / `QS stage must be one of order_of_cost, riba_2, riba_3, riba_4, tender, contract_sum.` / `QS status must be one of draft, issued, reviewed.` |
| 9 | `price_basis` outside the enum and not null | `cost_plan.packages[{i}].price_basis` | `Package price basis must be fixed_price, provisional_sum, estimate or unset.` |
| 0 | any status outside the enum | `due_diligence.items[{i}].status` | `Due diligence status must be one of red, amber, green, unknown, not_applicable.` |

Every rule gets a negative and an accepting twin using `dd_doc(...)` overrides (rules 1a via `drop_item`, 1b via `dup_item`, 1c/1d/1e/1f/1g via `add_item`, 2–4 via `status`/`evidence`/`action`/`notes`, 5 via `evidence` dates and `expiry`, 6 via `impacts`, 7 via `source_record`, 8 via `mode`/`qs`, 9 via `price_basis`). Also: `test_a_migrated_document_raises_no_due_diligence_issue` (properties 2 and 3 in the migrate tests now go green — property 3's control: a migrated `j-blended-refinance` with its first item deleted raises rule 1a on `due_diligence`).

Python enum checks are on the raw `code`/`status` string fields where pydantic does not already reject them (`code` is `str`; `status`/`category` are `Literal`s and arrive as 422s — so for rules 0 and 1f, test the TS side only, and in Python assert that `DdItem.model_validate` raises `ValidationError`; say so in a comment).

- [ ] **Step 2: Implement** `validate_due_diligence` / `validateDueDiligence` reading `getattr(inputs, "due_diligence", None)` / `'due_diligence' in inputs ? … : null` (a pre-v13 document raises nothing), and the `cost_plan.qs` / `price_basis` rules reading `getattr(plan, "qs", None)` etc. Call each from the main validator at the position stated above.

- [ ] **Step 3: The drift guard.** In `tests/test_financial_model_validation.py::test_validation_messages_match_the_typescript_engine`, move `start = ts.index("const unitSales = 'unit_sales' in inputs ? inputs.unit_sales : null;")` (the §22.7 block; the §19.7 block and the new §23.9 block now sit inside the window). Raise the lower bound to `>= 45`. Run it: it will list the §22.7 messages that differ between the engines (the TS em-dash `—` vs the Python ` - ` in at least "Per-unit sales and phased sales cannot both be set — remove one." and "…a retain-all exit has none. Remove the block…"). **Edit the Python strings to the TS text verbatim** (message text only; no rule changes). Every existing §22.7 Python test that asserted the old ASCII text must be updated to the new text — list them in the commit body. Re-run the full Python suite.

- [ ] **Step 4: The unit-sales identity guard** (R13b backlog). `tests/test_financial_model_unit_sales.py`: `test_unit_sales_gross_equals_schedule_gross_sales_corpus_wide` — for every fixture in `APPRAISAL_FIXTURES` whose migrated-to-v13 run has `metrics.unit_sales` non-None, assert `metrics.unit_sales["totals"]["gross_pence"] == schedule.totals.gross_sales_pence`, and assert at least one fixture was checked (X and Y). TS twin in `unit-sales.test.ts`.

- [ ] **Step 5: Run** both full suites; `test_migrate_v13.py` and the v13 migrate block are now fully green.

- [ ] **Step 6: Commit** — `feat(r15): due-diligence and QS validation rules, drift guard widened to 22.7 with Python messages aligned, unit-sales gross identity (spec 23.9)`.

---

### Task 7: The seventh FINAL condition

**Files:**
- Modify: `app/financial_model/provenance.py`, `frontend/src/lib/report-provenance.ts`, `frontend/src/lib/export-investment-memo.ts` (the two `Record<DraftReason, string>` tables only)
- Test: `tests/test_provenance.py`, `frontend/src/lib/report-provenance.test.ts`

**Interfaces:**
- Produces (Python): `DraftReason` gains `"due_diligence_incomplete"`; `draft_reason(..., due_diligence_complete: bool = True)` and `document_status(...)` likewise, tested after `vat_basis_confirmed` and before the approval check.
- Produces (TS): `DraftReason` gains `'due_diligence_incomplete'`; `export interface DueDiligenceGate { dueDiligenceComplete: boolean }`; `draftReason(reconciliation, status, taxBasis, vatBasis, caseStale, dueDiligence: DueDiligenceGate = DD_ASSUMED_COMPLETE)` (sixth positional, defaulted); `documentStatus` likewise; `export function dueDiligenceGateFor(run: AppraisalRun): DueDiligenceGate` = `{ dueDiligenceComplete: !('due_diligence' in run.inputs) || run.metrics.due_diligence.totals.entered_unknown_count === 0 }`; `ReportProvenance.dueDiligenceComplete: boolean`; `buildProvenance` passes the gate.
- Banner: `DRAFT - DUE DILIGENCE INCOMPLETE - NOT FOR LENDER RELIANCE`; sentence: `one or more due-diligence items are still unknown - unknown is never treated as green`.

- [ ] **Step 1: Failing tests.** Python `TestDraftReasonOrdering` gains: `test_due_diligence_gate_sits_between_vat_and_approval` (report_safe, repaid, tax & VAT confirmed, `lender_case_status="credit_approved"`, `due_diligence_complete=False` → `"due_diligence_incomplete"`; with `lender_case_status=None` → still `"due_diligence_incomplete"`, not `not_approved`; with `vat_basis_confirmed=False` too → `"vat_basis_unconfirmed"`); `test_stale_never_outranks_the_basis_gates` gains the DD case. TS: `describe('R15 — due diligence in the draft gate (spec §23.7)')` with the same three orderings, `keeps five-argument callers behaving exactly as before`, `carries through documentStatus`; update the union pin test to **seven** members (`due_diligence_incomplete: true`, `toHaveLength(7)`, retitle "…seven R15 members"); `describe('buildProvenance derives the due-diligence gate')`: `runAppraisal(ddDoc())` + `credit_approved` → `draftReason === 'due_diligence_incomplete'` and `dueDiligenceComplete === false`; the twin with the three unknowns evidenced (`ddDoc({ status: {cil_s106:'green', leases_tenancies:'green', fire_strategy:'green'}, evidence: {…three evidences…} })`) → `'FINAL'` **with the `equity_sources` derived row still `unknown`** (assert it from `run.metrics.due_diligence.rows`); a raw v4 `sellAllInputs()`-shaped document (no `due_diligence` key) → `dueDiligenceComplete === true` (the R8 exemption).

- [ ] **Step 2: Implement** both sides; add the two strings to `DRAFT_REASON_SENTENCE` and `WATERMARK_TEXT` in `export-investment-memo.ts` (a compile error until you do — that is the point).

- [ ] **Step 3: Run** `pytest tests/test_provenance.py`, `npx vitest run src/lib/report-provenance.test.ts src/lib/report-qa src/lib/export-investment-memo.test.ts` — the existing FINAL tests must still pass (they use raw pre-v13 documents). `tsc -b`.

- [ ] **Step 4: Commit** — `feat(r15): due_diligence_incomplete - the seventh FINAL condition in both provenance modules (spec 23.7, 13.3)`.

---

### Task 8: The memo

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts`, `frontend/src/lib/report-qa/memo-fixtures.ts`, `frontend/src/lib/report-qa/memo-release-gate.test.ts`
- Test: `frontend/src/lib/export-investment-memo.test.ts`

**Interfaces:**
- Produces: `dueDiligenceInputs(): CalculatorInputsV13` (fixture Y via `migrateInputsToV13`) and `dueDiligenceFinalInputs(): CalculatorInputsV13` (Y with every entered item green-with-evidence or n/a-with-notes, `source_record.is_vacant: true`, `floor_area_sqm: 600`, `expiry_date: '2027-06-01'`, `equity_sources[0]` confirmed — the release-gate FINAL document) in `memo-fixtures.ts`.

- [ ] **Step 1: Failing tests** (`export-investment-memo.test.ts`, using `memoText` from `due-diligence-docs.ts`, and the release gate):
  1. §9 retitled: text contains `'Due Diligence and Risk'` and not `'9. Risk Register'`; contains the six category names humanised and the counts row for `planning` (`0 1 3 1 0` in sequence within its row's text) — assert via `documentProse` containing `'Planning'` followed by the totals sentence `'1 red, 4 amber, 17 green, 5 unknown, 2 not applicable'`.
  2. Impacts sentence: `'stated cost impact £25,500 across 4 items, at least 3 months, 1 item not yet assessed'` (`fmt` prints whole pounds).
  3. Both conflict lines as `[Information Required: …]` items: contains `'source conflict: the listing records the property as occupied'` and `'differ by more than 25%'`.
  4. Source-record line: text contains `'Listing record captured from rightmove on '` followed by the memo's `fmtDate` rendering of `captured_at`'s date part (assert with `toMatch(/Listing record captured from rightmove on \d{1,2} \w{3} \d{4}/)` — `fmtDate` is module-private, so the test matches the shape, not a literal); on `ddDoc({ sourceRecord: null })`: `'No listing record captured; source-conflict checks did not run.'`
  5. Derived rows marked: text contains `'Equity sources'` and `'(derived)'`.
  6. The nine-phrase text-match is gone: a document with `risks: [{… description: 'planning is fine' …}]` prints neither `'Risks not yet addressed'` nor `'Risk register gaps'`; the risk-register table still prints under the sub-heading `'Risk register (project log)'`.
  7. §3 sentences: `'Planning: green - City of York Council 26/01234/FUL, decided '` + `fmtDate('2026-07-15')` + `', lapses '` + `fmtDate('2026-11-01')` + `'.'` — assert the literal prefix and `toMatch(/decided \d{1,2} \w{3} \d{4}, lapses \d{1,2} \w{3} \d{4}\./)`; and `'Vacant possession: green.'`; on `ddDoc({ seed: true })`: `'Planning: unknown - no consent evidenced.'` and `'Vacant possession: unknown.'`
  8. §5 QS line in detailed mode with qs: heading `'Detailed Cost Plan'` (no longer "— QS Evidence Not Recorded"), line `'Priced by Gardiner & Theobald, RIBA Stage 3, dated '` + `fmtDate('2026-08-01')` + `', status issued. Fixed-price coverage 46.15% of base build; provisional sums £80,000 (30.77%); unclassified £60,000.'` (assert the prefix, the `/dated \d{1,2} \w{3} \d{4}, status issued\./` shape, and the coverage clause literally); with `qs: null` the heading keeps `'— QS Evidence Not Recorded'` and the line reads `'No QS source, date or status is recorded for this cost plan.'` Packages with `price_basis` `provisional_sum` or `estimate` print their `notes` in the package row's third column as exclusions — Y's envelope row carries `'Excludes scaffolding'` (authored in Task 3).
  9. Appendix B: `'Due diligence: 3 items unknown - cil_s106, leases_tenancies, fire_strategy'` (humanise the codes if the memo humanises elsewhere; assert the humanised form you choose).
  10. §13 limitation 5: `'3 of 24 due-diligence items remain unknown'` on Y; `'every due-diligence item is evidenced or marked not applicable'` on the FINAL twin; the old narrative sentence is absent. The detailed-mode cost sentence becomes `'Construction cost rests on a priced package schedule (a detailed cost plan) priced by Gardiner & Theobald (RIBA Stage 3, '` + `fmtDate('2026-08-01')` + `', issued); fixed-price coverage 46.15%.'` when qs is present (assert prefix and the coverage clause), and keeps the current wording when qs is null.
  11. Release gate: add `['due diligence (Y)', dueDiligenceInputs]` and `['due diligence, fully evidenced', dueDiligenceFinalInputs]` to `ROUTES`; a test `'reaches FINAL on a fully evidenced v13 document'`: `provenanceFor(runAppraisal(dueDiligenceFinalInputs()), { lenderCaseStatus: 'credit_approved' })` → `documentStatus 'FINAL'`, no watermark, `documentText` contains `'FINAL'`; and `'holds a v13 document with unknown items in DRAFT'`: Y + approved → watermark `'DRAFT - DUE DILIGENCE INCOMPLETE - NOT FOR LENDER RELIANCE'` and prose containing `'one or more due-diligence items are still unknown'`.

- [ ] **Step 2: Implement** in the memo — every figure read from `run.metrics.due_diligence` / `run.metrics.cost_plan.price_basis` / `.qs`; no arithmetic in the generator (counts, percentages and totals are all on the result block). The §9 schedule table columns: Category, Item, Status, Evidence (source · reference · date), Expiry, Owner, Due, Cost impact, Prog. impact, Action; derived rows append ` (derived)` to the item label; status cell colour: red/amber/green as the risk table does, unknown `[100, 116, 139]`, not_applicable `[148, 163, 184]`. Category summary table first (Category | Red | Amber | Green | Unknown | N/A | Total). Delete `missingRiskCategories`, the `bodyText` "The risk register should cover…" paragraph and both `infoRequired` uses of `missing`; keep the risk table under `subHeading('Risk register (project log)')`. Use `ensureSpace`-style measured breaks as the surrounding sections do; every table wider than the risk table uses `styles: { fontSize: 7 }`.

- [ ] **Step 3: Run** `npx vitest run src/lib/export-investment-memo.test.ts src/lib/report-qa` — the layout gates (page bounds, sparse pages, orphans) must pass on both new routes.

- [ ] **Step 4: Commit** — `feat(r15): memo prints the due-diligence schedule, source conflicts, QS line and the conditioned limitation; release gate asserts a FINAL v13 document (spec 23.8, 13.4)`.

---

### Task 9: The Due Diligence page

**Files:**
- Create: `frontend/src/components/calculator/DueDiligencePage.tsx`, `DueDiligencePage.test.tsx`
- Modify: `frontend/src/components/calculator/RiskRegisterPage.tsx` (heading `<h3>` → `<h4>Risk register (project log)</h4>`), `frontend/src/components/ConversionCalculator.tsx` (`PAGES` label `'Due Diligence'`; render `<DueDiligencePage inputs={inputs} onChange={updateInputs} run={run} project={project} />` for key `risk_register`)

**Interfaces:**
- Consumes: `DD_CATALOGUE`, `DD_STATUSES`, `captureSourceRecord`, `run.metrics.due_diligence`, `run.validation`.
- `Props { inputs: CalculatorInputsV12 | CalculatorInputsV13 (use the widest type the calculator holds — Task 13 narrows it to V13); onChange; run: AppraisalRun; project: Project | null }`. Until Task 13 the calculator's state type is still V12; type the page's `inputs` as `AnyCalculatorInputs & { due_diligence?: DueDiligenceInputs }` and render the editor only when `'due_diligence' in inputs`; Task 13 removes the guard.

- [ ] **Step 1: Failing tests** (`@testing-library/react`, the `ConversionCostsPage.test.tsx` shape, building inputs with `migrateInputsToV13(defaultCalculatorInputsV12())` and Y via `ddDoc()`):
  1. Renders six category headings and, for Y, the `Vacant possession` row with its status select at `green`, and the derived `Equity sources` row as read-only text `unknown` with `from equity_sources[].evidence_status`.
  2. Changing a status select to `green` on `cil_s106` calls `onChange` with `due_diligence.items` where that item's `status === 'green'` (evidence untouched — validation surfaces the rule).
  3. The validation issue for an item is shown beside its row: with `ddDoc({ status: { cil_s106: 'green' } })` the row shows `'A green status needs evidence: record the source and the date.'` (read from `run.validation` by field prefix `due_diligence.items[<i>]`).
  4. "Add custom item" under `existing_building` appends an item with `code: 'custom'`, that category, a `crypto.randomUUID()` id, `status 'unknown'`.
  5. Source-record card shows `'Listing: occupied'`, `'360 m²'`, and the two conflict statements from `run.metrics.due_diligence.source_conflicts`; "Re-capture from listing" (enabled only with a `project`) calls `onChange` with `source_record` equal to `captureSourceRecord(project, <now>)` — inject `now` via a prop `now?: () => Date` defaulting to `() => new Date()`.
  6. Under Title/Occupation the project's `description` and `current_use_description` render in a read-only "From the listing" panel when a project is present.
  7. The category counts and `addressed_pct` print from `run.metrics.due_diligence` (`'21 of 24 addressed (87.5%)'`).
  8. The risk register still renders below (`'Risk register (project log)'`).

- [ ] **Step 2: Implement** the page: per item — status `<select>` (options from `DD_STATUSES`, coloured green/amber/red, unknown grey, n/a muted), evidence source/reference/date inputs (creating `{source:'',reference:'',date:''}` on first edit; a "clear evidence" button sets `null`), expiry date, owner, due date, `PenceInput` (from `form-rows.tsx`) for cost impact with `nullable`, a number input for programme months (empty → null), action and notes inputs; catalogue `prompt` as helper text; derived rows read-only. All writes go through `onChange({ due_diligence: {...} })`. No arithmetic in the component.

- [ ] **Step 3: Run** the page tests, `tsc -b`, lint, the full vitest suite.

- [ ] **Step 4: Commit** — `feat(r15): Due Diligence page - schedule editor, derived rows, source-record card, register as the project log (spec 23.8)`.

---

### Task 10: Costs page — QS provenance and price basis

**Files:**
- Modify: `frontend/src/components/calculator/ConversionCostsPage.tsx`
- Test: `frontend/src/components/calculator/ConversionCostsPage.test.tsx`

- [ ] **Step 1: Failing tests:** in detailed mode a "QS provenance" card with a "No QS recorded" checkbox (checked ⇔ `qs === null`); unchecking writes `qs: { source: '', stage: 'order_of_cost', date: '', status: 'draft', base_date: '' }`; editing source writes through; the rule-8 issue text shows when `run.validation` carries it; each package row has a "Price basis" select with options Unset / Fixed price / Provisional sum / Estimate writing `price_basis` (`null` for Unset); the coverage line prints `'Fixed-price coverage 46.15% · provisional sums 30.77% · unclassified £60,000'` from `run.metrics.cost_plan.price_basis` on Y and is absent in headline mode; `newPackage()` seeds `price_basis: null`.

- [ ] **Step 2: Implement; Step 3: Run; Step 4: Commit** — `feat(r15): Costs page QS provenance card and per-package price basis (spec 23.6)`.

---

### Task 11: Deal spider HRB caveat

**Files:**
- Modify: `frontend/src/lib/deal-spider.ts`
- Test: `frontend/src/lib/deal-spider.test.ts`

- [ ] **Step 1: Failing tests:** on Y (`ddDoc()`, `higher_risk_building` green) the `building_safety` axis has `provisional false` and no HRB caveat; on `ddDoc({ status: { higher_risk_building: 'unknown' } })` it is `provisional true` with `caveats` containing `'Building safety: screening only - higher-risk-building status not competently confirmed'`; `not_applicable` (with notes) also clears it; a pre-v13 document (no `due_diligence` key) is caveated.

- [ ] **Step 2: Implement:** in `computeSpider`, `const hrbConfirmed = 'due_diligence' in inputs && inputs.due_diligence.items.some((i) => i.code === 'higher_risk_building' && (i.status === 'green' || i.status === 'not_applicable'));` and extend the `provisional`/`note` ternaries for `def.id === 'building_safety'` (note `'screening only - higher-risk-building status not competently confirmed'`); `buildingSafetyBand` is unchanged.

- [ ] **Step 3: Run; Step 4: Commit** — `feat(r15): spider caveats the building-safety axis until HRB status is competently confirmed (audit 7.1)`.

---

### Task 12: Documents and the version bump

**Files:**
- Modify: `docs/financial-model/calculation-specification.md`, `docs/financial-model/migration-notes.md`, `docs/financial-model/test-cases.md`, `docs/financial-model/model-governance.md`, `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`, `app/financial_model/types.py` (`CALC_VERSION = "2.15.0"`), `frontend/src/lib/model/finance-types.ts` (`CALC_VERSION = '2.15.0'`)
- Test: `frontend/src/lib/model/spec-versions.test.ts` (must pass after the bump), any test pinning `'2.14.0'` (update; list in the commit)

- [ ] **Step 1: Spec §23** — new section after §22, in §22's form, with sub-sections 23.1 schema … 23.11 stated limitations and a "Guards this release must watch fail" table, transcribing the design's §4–§16 into normative prose (the design is the source; the spec states rules, not reasoning). Then the amendments, each located by content:
  - §1.5: add one sentence — the due-diligence schedule seeds every item `unknown` and a `green` without evidence is a validation error (§23.9).
  - §1.6: `13` (**inputs v13**) = calc 2.15.0+ (adds the top-level `due_diligence` block, `cost_plan.qs` and `CostPackage.price_basis`, §23); a changelog paragraph `Calc 2.15.0 (R15) adds §23's evidence schedule, four flags and §13.3's seventh condition. **It changes no existing computed value** (the v13 identity gate, `tests/test_migrate_v13.py`, compares the new result block on both arms with no exclusion).`
  - §13.3: "all seven hold"; insert condition 5 (`due_diligence.totals.entered_unknown_count == 0`, §23.7 — a document with no `due_diligence` block is not re-graded, §14.6's rule) and renumber 5→6, 6→7; add the banner row `| due diligence incomplete | DRAFT - DUE DILIGENCE INCOMPLETE - NOT FOR LENDER RELIANCE |` after the VAT row; rewrite "Conditions 5 and 6 are mutually exclusive" as "Conditions 6 and 7 …" and "neither can outrank conditions 1–5".
  - §13.4: the cost-basis bullet — in detailed mode with `cost_plan.qs` recorded the report prints the QS source, stage, date and status and may drop the "not recorded" sentence; the "Limitations are printed" bullet — replace "narrative-only due diligence" with "the count of unknown due-diligence items (§23.8)".
  - §14.6 and §17.10: one sentence each — the dashboard's `tax_basis` derived row reads this gate's predicate (§23.3).
  - §15.9 limitation 4 → historical note: the `measured_survey` item (§23.2) is the bridge's evidence.
  - §16.9 limitation 3 → historical note (closed by §23.6); add a new limitation "No inflation — R15b (the cost plan in time: per-package programme, tender-price inflation from `qs.base_date`, per-package eligibility)"; fold limitation 1's "not currently owned" into that R15b line.
  - §22.10 item 7 → "Rows carry no per-row evidence status; the scheme-level evidence is §23.2's `exit_route_evidence` item."
- [ ] **Step 2:** `migration-notes.md` §16 (v12 → v13, the seed, the identity claim, the stale-case consequence on re-save, the York appraisal after R15: 23 unknowns, DRAFT for due diligence once tax/VAT confirmed); `test-cases.md` §23 with the fixture Y worksheet (every figure from this plan's hand-derivation section, presented as the derivation, not the answer); `model-governance.md` §3.1 row `| R15 | 2.15.0 | v13 | — | The due-diligence evidence schedule: 28-item catalogue, RAG/unknown, derived rows, source-conflict flags, QS provenance and price basis, the seventh FINAL condition | §23 |`; release plan: R15 row marked **DONE, shipped**, an **R15 status** paragraph in the established form, and a new **R15b** row: `| **R15b** | The cost plan in time: per-package programme (§16.9 limitation 1), tender-price inflation from `qs.base_date` to each package's spend midpoint (§7.5's inflation ask), per-package draw eligibility (§16.9 limitation 2, §20.5 limitation 3) | P1 | inputs v14, calc minor |` with a paragraph recording the deferral's reasoning (design decision 12).
- [ ] **Step 3:** bump `CALC_VERSION` on both sides; run `spec-versions.test.ts`, then both full suites (fix any `'2.14.0'` literal pins).
- [ ] **Step 4: Commit** — `docs(r15): spec 23 and amendments (1.5, 1.6, 13.3, 13.4, 14.6, 15.9, 16.9, 17.10, 22.10), migration notes 16, test-cases 23, governance row, release plan with R15b; calc 2.15.0`.

---

### Task 13: The entry-point cutover to v13

**Files:**
- Modify: `app/api/app.py` (import and call `migrate_inputs_to_v13`; comments), `frontend/src/components/ConversionCalculator.tsx` (`migrateInputsToV13`, `defaultCalculatorInputsV13(project)`, state type `CalculatorInputsV13`, `updateInputs` partial type), `frontend/src/components/ExportPage.tsx` (both `migrateInputsToV12` calls → V13), every calculator page whose `Props.inputs` is `CalculatorInputsV12` → `CalculatorInputsV13` (`tsc -b` lists them), `frontend/src/lib/report-qa/memo-fixtures.ts` (its own fixture loaders stay on the version they load — leave them; confirm the guard's exemption list still holds), `frontend/src/components/calculator/DueDiligencePage.tsx` (drop the `'due_diligence' in inputs` guard)
- Test: `tests/test_entry_point_guard.py`, `frontend/src/lib/model/entry-point-guard.test.ts` (both derive NEWEST from the migration module and go red the moment Task 2 lands; this task turns them green), `tests/test_api_endpoints.py` / `test_upsert_endpoints.py` (a saved v13 document round-trips; a v13 document with an invalid `due_diligence` is a 422), `ConversionCalculator.test.tsx`

- [ ] **Step 1:** run both entry-point guards — red, naming every stale call site.
- [ ] **Step 2:** move every named site to v13 in ONE commit; the server's `raw` handling, `is_v2_or_later` (already recognises v13 from Task 2) and `inputs.inputs_version` reads need no change beyond the call. `defaultCalculatorInputsV13(project)` receives the full `Project` (it satisfies `DefaultDocumentProject`), so a new appraisal captures the listing.
- [ ] **Step 3:** both guards green; both full suites green; `tsc -b`; lint; `npm run build`.
- [ ] **Step 4: Commit** — `feat(r15): move every entry point to inputs v13 (spec 23.10)`.

---

## Self-review

**Spec coverage.** Design §4 schema → Task 1; §5 catalogue → Task 1; §6 derived rows → Task 3; §7 derivation → Task 3/5; §8 source record + conflicts → Tasks 2 (capture), 3 (rules), 9 (re-capture UI); §9 QS/price basis → Tasks 1, 4, 8, 10; §10 gate → Task 7; §11 outputs/surfaces (page 13, page 4, strip, spider, memo §3/§5/§9/Appendix B/§13) → Tasks 9, 10, (strip needs no code: it renders every flag's message already), 11, 8; §12 validation + flags → Tasks 6, 5; §13 migration → Tasks 2, 13; §14 limitations → Task 12; §15 fixture Y → Tasks 3, 5; §16 guards: catalogue identity (T1), coverage/evidence/action/n-a (T6), unknown-gates-red-does-not + ordering + derived-rows-do-not-gate (T7), derived mapping + rollups + impacts + conflicts + consent + inertness (T3/T5), price basis + QS headline (T4/T6), migration identity + null-path identity (T2/T3), §1.6 (T12), memo (T8), spider (T11), message drift + unit-sales identity (T6), entry points (T13); §17 also-in-scope: R13b backlog pair (T6), spec/docs (T12).

**Placeholders.** The two `// ...`/`# ...` abbreviations in Task 1 and Task 2 stand for verbatim copies of adjacent, existing code (the 28-row table given in full in this plan; `migrate_inputs_to_v12`'s body) and say so; no step defers content to "later".

**Type consistency.** `compute_due_diligence(inputs, cost_plan, vat, acquisition_tax, schedule)` (T3) is what `derive_metrics` calls (T5); `due_diligence_flags(result, cost_plan)` reads `cost_plan.price_basis` (T4's `PriceBasisSummary`, field `provisional_sums_pence`); `DueDiligenceResult.totals.entered_unknown_count` is what `dueDiligenceGateFor` (T7) and the memo (T8) read; `defaultDueDiligence` lives in `due-diligence.ts` and is re-exported by `migrate.ts` (T2/T3 note); `captureSourceRecord` (T2) is what the page's re-capture calls (T9); the four flag codes named in T1's `FlagCode` are the ones T5 raises and Y's `flag_codes_r15` pins.
