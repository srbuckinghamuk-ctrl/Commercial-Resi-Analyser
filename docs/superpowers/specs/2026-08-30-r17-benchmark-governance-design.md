# Release 17 — Elemental benchmark, area units, authenticated governance — design

**Date:** 30 August 2026
**Audit provenance:** `docs/reviews/2026-08-30-lender-readiness-third-audit.md`
(86/100). §12's two P0 rows — *"Lender approvals use self-declared actor
names — Authentication, tenant isolation, RBAC, maker-checker rules and
immutable user identity"* and *"Actual saved appraisals can remain on old
versions indefinitely — Add governed migration/resave workflow"*; §12's P1
rows *"BCIS lookup not implemented — Licensed provider/import abstraction,
elemental £/m² benchmarks, location/date factors and variance analysis"* and
*"Flat annual tender inflation — Add versioned dated index series"*; §7.2
(*"The structured project use remains `office`, while the description says
retail at ground/basement and long-leased Airbnb above … no structured source
record has been captured"*); §8.4 (*"peak debt is reached in 'month 12' while
its monthly table peaks on the row labelled 'Month 11'"*); §8.8 (*"the row
headed 'Refinance LTV -10 pp' displays 'Refinance LTV +10.0 pp'"*); §10 (*"the
Investor page still labels 'Return on Equity' without 'unrealised' … Project
Detail also shows unqualified ROE"*); §11 (*"the PDF is not tagged for PDF/UA
accessibility"*); and §9's ten-item production-control list.

**Release-plan row, written by this design.** The second-audit release plan
ends at R16b; this is the first release from the third audit and gets a new
row: *"R17 — the elemental cost benchmark layer (three provider tiers, none
bundling BCIS data), a global m²/ft² display toggle on one canonical basis,
index-ratio currentisation kept separate from the package inflation engine,
authenticated lender-case governance with maker-checker separation, the
governed resave of the York appraisal, structured source reconciliation, and
the four presentation corrections — P0/P1 — inputs v17, Alembic 008,
calc 2.19.0."*

**Why a calc bump.** `AppraisalResultV2` gains one field,
`elemental_benchmark` (null on every migrated document), and every stored
`outputs` shape therefore changes: `outputs_hash` and `audit_hash` move for
identical inputs, which under §1.6's comparability rule is a `calc_version`
change — exactly R16b's reasoning for 2.18.0. **No computed figure moves.**
The benchmark layer is advisory: it never enters `construction_total_pence`,
TDC, peak debt or profit unless a user explicitly applies rows to the cost
plan, and an application is an ordinary cost-plan edit the existing engine
prices. The v16 → v17 identity gate asserts this corpus-wide with no
exclusion.

**Specification:** the calculation specification gains **§27** (the benchmark
layer, area units, currentisation) and **§21 is amended in place** for
authenticated governance (§21.1, §21.2, §21.5, §21.6 limitation 1 closes);
**§13.1** gains the report unit and the benchmark provenance rows; **§1.6**
gains v17 and 2.19.0; **§5.7 / §13.5** state the month-label convention;
**§23.5** gains the structured source-record reconciliation.
`migration-notes.md` gains **§20**. Alembic **008**.

---

## 1. The problems this release exists to solve

### 1.1 No independent cost benchmark

The detailed cost plan (§16, §23.6, §24) is credible for QS-led entry, but
nothing in the product can say whether a QS or developer figure is
*reasonable*. The audit asked for a BCIS-style elemental benchmark with
location and date adjustment. There is no BCIS API or subscription available
to this implementation, and BCIS identifies its elemental analyses, average
prices, location factors and indices as licensed subscription products
(`https://www.bcis.co.uk/products/`, `/packages-and-services/`,
`/bcis-capx-indices/`, read 30 August 2026: every product is a subscription;
no open data is offered). The layer must therefore be a **provider
abstraction with an empty licensed shelf**, never a bundled dataset.

### 1.2 One unit, hard-coded

Every area on every page is `m²` in a literal string (106 occurrences across
28 files; `export-investment-memo.ts` alone carries eleven) and the memo
converts to sq ft with three different literals (`10.7639`, `0.092903`, a
module-private `sqmToSqft`). UK lenders and agents read £/ft²; there is no
way to see one.

### 1.3 Two inflations that must not meet

§24.3 already inflates each package from `qs.base_date` to its spend
midpoint. A benchmark rate carries its own, earlier, base date. Moving it to
the valuation date and *then* letting §24 carry it forward is correct; letting
§24 carry it from the benchmark's base date, or embedding a forward factor
into a copied package amount, double counts.

### 1.4 Actors are claims

§21.6 limitation 1, verbatim: *"No authentication, so actor names are claims
rather than identities."* `LenderCaseCreate.created_by` and
`LenderCaseTransition.actor` are free text; one person can submit, review and
approve their own case under three names. The audit calls this the principal
production blocker.

### 1.5 The York row is still v3 / 2.1.0

The live appraisal row has never been re-saved under the governed model, its
`audit_hash` is null, its description still begins `DescriptionThe`, and its
structured use (`office`) contradicts its own narrative (retail below,
long-leased Airbnb above). No mechanism exists to re-save a stored row
server-side, to keep the superseded snapshot, or to record a source conflict
between narrative and structured fields.

### 1.6 Four presentation defects

Unqualified "Return on Equity" on two pages and the quick PDF; the stress
Setting cell `Refinance LTV +10.0 pp` under an entry named `-10 pp`; peak-debt
prose one-based beside a zero-based ledger table; no accessibility tagging in
the PDF.

---

## 2. Scope

In: everything in §§4–14 below. Out: §16.

---

## 3. Decisions taken at design time

1. **The benchmark set travels inside the document.** `inputs.elemental_benchmark`
   embeds the full set header *and* its rate rows, plus a reference to the
   library row it came from (`library_set_id`, `content_hash`). Both engines
   compute the benchmark result from the document alone — parity by
   construction, and a historic appraisal is reproducible without the library.
   A library-only reference was rejected: the Python engine could not run a
   fixture, and a later library import could silently change a stored
   appraisal's comparison.
2. **Canonical basis is square metres and pence per square metre.** The unit
   toggle is a presentation preference held outside the document
   (React context + `localStorage`, key `cra.area_unit`), passed to the memo
   as an explicit option and printed there. It is *not* an input: a preference
   that moved `input_hash` would make a lender case stale for a display choice.
3. **Currentisation and forward inflation are two named steps with one seam.**
   Currentisation (index ratio × location multiplier) moves a rate from the
   set's `base_date` to `currentisation_date`. When rows are applied, the cost
   plan's `qs.base_date` **must equal** `currentisation_date`; the §24 engine
   is then the sole forward mechanism. Apply is refused (not warned) when a
   recorded `qs.base_date` differs — a warning would let the double count
   through.
4. **Apply creates draft packages; it never overwrites.** Default and only
   mode: one new `benchmark_origin`-tagged package per applied element,
   `price_basis: 'estimate'`. Re-applying an element replaces its own earlier
   benchmark-derived package (same `element_code`, same origin) rather than
   adding a second — that is the duplicate guard. A package without
   `benchmark_origin`, a `fixed_price` package, or any package on a plan whose
   QS stage is `contract_sum`, is never touched; the confirmation lists exactly
   the packages that will be created or replaced and their amounts. The
   pre-change `cost_plan` is retained in `elemental_benchmark.applications[]`.
5. **Authentication is stdlib-only.** Password hashing is PBKDF2-HMAC-SHA256
   (390,000 iterations, 16-byte salt) and the bearer token is an HMAC-SHA256
   signed, expiring, opaque token over `api_secret_key` — no new dependency,
   and `api_secret_key` has been reserved for this since the foundation
   release. A default secret refuses to issue tokens outside development
   (`ENVIRONMENT=production` with the default key is a startup error).
6. **Maker-checker is a user-id rule, not a role rule.** A decision transition
   is refused when the actor's user id equals the case's `created_by_user_id`
   or `submitted_by_user_id`, whatever their role. Legacy cases (created
   before 008, no user ids) cannot be decided at all: supersede and recreate.
7. **The display-name columns stay, the id columns are added beside them.**
   `created_by`, `submitted_by`, `reviewer`, `decided_by` keep printing on the
   provenance panel (they are `case_hash` components, §13.2.1, and the hash
   formula gains no parts); the server now writes them from the authenticated
   user's `display_name` and refuses a client-supplied value. `case_hash` is
   unchanged.
8. **Month labels are the ledger index.** Every month offset a user enters
   (`timing_month`, `month_offset`, `reporting_month`) is zero-based with the
   acquisition month at 0, and the UI already prints `Month n` from that index
   (pinned by `peak-debt-label.test.tsx`). The memo's no-anchor prose drops
   its `+ 1`; the cost-to-complete table prints the ledger month it refers to;
   the memo states the convention once. One-based display was rejected because
   an entered `reporting_month: 11` would then print as "Month 12".
9. **ONS OPI is a public currentisation proxy and is shipped as data, not
   code.** The extracted series live in `data/index-datasets/` as a versioned
   JSON with source URL, retrieval date, source-file SHA-256 and licence, and
   are loaded into the library by an explicit seed command. The engine never
   reads the file; the document embeds the two index observations it uses.
10. **The benchmark library ships empty of elemental rates.** No lawful,
    reusable elemental-rate source with quartiles and sample counts was found;
    the only elemental rates in the repository are the fixture's, named
    `TEST FIXTURE — NOT MARKET DATA`, under `fixtures/`, never seeded.
11. **PDF/UA is documented as not achievable with jsPDF 4.2.1**, which exposes
    no structure tree, `MarkInfo` or role map (verified against the shipped
    dist). What *is* set — title, subject, language, `DisplayDocTitle` — stays;
    the limitation is stated in the memo's basis-of-preparation and in
    governance, accurately, rather than by adding an `/Marked true` flag that
    would assert tagging the file does not have.
12. **Source reconciliation is in the document, not the project row.** Claims
    from listing narrative, listing structured fields, measured survey,
    valuation, title and the appraisal's own inputs are records inside
    `due_diligence.source_records[]`; conflicts are derived by the engine;
    resolutions are recorded with evidence, author and date. An unresolved
    conflict is a red flag and defeats FINAL through the existing due-diligence
    gate. The project's structured use is *not* rewritten by anything here.

---

## 4. §27.1 — Inputs v17

```
CalculatorInputsV17 = CalculatorInputsV16 +
  elemental_benchmark: null | SchemeElementalBenchmark
  cost_plan.packages[].benchmark_origin: null | BenchmarkOrigin       -- new field, null by migration
  due_diligence.source_records: SourceEvidenceRecord[]               -- new, [] by migration
  due_diligence.source_resolutions: SourceConflictResolution[]       -- new, [] by migration
```

### 4.1 The benchmark block

```
SchemeElementalBenchmark:
  set:            ElementalBenchmarkSet          -- header + rates, embedded
  selections:     SchemeElementalCostSelection[]
  thresholds:     { material_variance_pct: number   -- default 15
                    stale_after_months: integer     -- default 12
                    min_coverage_pct: number }      -- default 60
  applications:   BenchmarkApplication[]          -- audit trail of every apply
  library_set_id: string | null                   -- the library row, if any
```

```
ElementalBenchmarkSet:
  id, name
  provider_type:         'bcis_licensed' | 'public_benchmark' | 'user_qs'
  provider_name, source_title, source_url (string|null), source_publication_date (ISO|null)
  retrieved_at (ISO datetime|null), licence_or_permission (string)
  dataset_version (string), building_function (string)
  project_type:          'new_build' | 'refurbishment' | 'conversion'
  specification_level (string), region (string)
  location_factor (number|null)            -- index, 100 = national base
  location_factor_source (string|null)
  base_date (ISO)                          -- the pricing date of the rates
  base_index_name (string|null), base_index_value (number|null)
  current_index_name (string|null), current_index_value (number|null)
  index_dataset_version (string|null)      -- which library index version supplied the two observations
  currentisation_date (ISO|null)
  currency: 'GBP'
  notes, imported_by (string), created_at (ISO datetime)
  source_file_sha256 (string|null)         -- hash of the imported file, when there was one
  content_hash (string)                    -- canonical hash of the normalised set (§27.6)
  rates: ElementalBenchmarkRate[]
```

```
ElementalBenchmarkRate:
  id, element_code (ElementCode), element_label, description
  measurement_basis: 'area' | 'per_unit' | 'per_item' | 'percentage' | 'lump_sum'
  original_unit:     'gbp_per_sqm' | 'gbp_per_sqft' | 'gbp_per_unit' | 'gbp_per_item' | 'pct' | 'gbp'
  original_rate_pence: integer             -- 0 on a percentage row
  rate_pct: number | null                  -- percentage rows only; null otherwise
  lower_quartile_rate_pence, median_rate_pence, upper_quartile_rate_pence: integer | null
  sample_count: integer | null
  location_factor: number | null           -- per-rate override of the set's factor; null = inherit
  evidence_status: 'verified' | 'unverified' | 'draft' | 'estimated'
  source_reference: string
  notes: string
```

`original_unit` must agree with `measurement_basis` (validation rule 3).
Unknown quartiles and sample counts stay `null`; nothing derives them.

```
SchemeElementalCostSelection:
  element_code
  benchmark_rate_id: string | null         -- null = the element is selected but unpriced
  quantity: number                         -- CANONICAL: m² for 'area', count for per_unit/per_item, 1 for lump_sum, unused (0) for percentage
  quantity_unit: 'sqm' | 'unit' | 'item' | 'each' | 'pct_base'
  adjustment_pct: number                   -- user adjustment on the currentised rate; 0 = none
  adjustment_reason: string                -- required when adjustment_pct != 0 (validation rule 5)
  include_in_cost_plan: boolean            -- the apply checkbox
  target_cost_package_id: string | null    -- the QS package this element is compared against
  selected_by: string, selected_at: ISO datetime
```

`selected_rate_pence`, `rate_unit`, `adjusted_rate_pence`,
`benchmark_amount_pence`, `qs_amount_pence`, `variance_pence`,
`variance_pct` from the brief's record are **derived** and live on the result
row (§27.4), not on the input — a stored derived figure is one that can go
stale, the R9/R10 lesson.

```
BenchmarkOrigin:
  kind: 'benchmark'
  set_id, set_content_hash, benchmark_rate_id (string|null), element_code
  applied_at: ISO datetime, applied_by: string
```

```
BenchmarkApplication:
  id, applied_at, applied_by, set_id, set_content_hash
  element_codes: ElementCode[]
  created_package_ids: string[], replaced_package_ids: string[]
  previous_cost_plan: CostPlanInputs       -- the plan as it was immediately before this apply
```

### 4.2 The element catalogue

Thirty-nine `ElementCode`s, fixed in both engines (`ELEMENT_CATALOGUE`), each
with a label, a default `measurement_basis` and a default `CostPackageCode`
used when a draft package is created:

| Code | Label | Default basis | Default package |
|---|---|---|---|
| `facilitating_works` | Facilitating works | lump_sum | enabling_strip_out_asbestos |
| `surveys_investigations` | Surveys and investigations | lump_sum | enabling_strip_out_asbestos |
| `strip_out` | Strip-out | area | enabling_strip_out_asbestos |
| `demolition` | Demolition | area | enabling_strip_out_asbestos |
| `asbestos_removal` | Asbestos removal | lump_sum | enabling_strip_out_asbestos |
| `substructure_alterations` | Substructure alterations | area | structure |
| `frame_alterations` | Structural frame alterations | area | structure |
| `upper_floors_strengthening` | Upper floors and structural strengthening | area | structure |
| `roof_works` | Roof works | area | roof_windows |
| `stairs_ramps` | Stairs and ramps | per_item | structure |
| `external_walls_facade` | External walls and façade | area | envelope |
| `windows_external_doors` | Windows and external doors | area | roof_windows |
| `internal_walls_partitions` | Internal walls and partitions | area | partitions |
| `internal_doors` | Internal doors | per_item | partitions |
| `wall_finishes` | Wall finishes | area | finishes |
| `floor_finishes` | Floor finishes | area | finishes |
| `ceiling_finishes` | Ceiling finishes | area | finishes |
| `ffe` | Fittings, furnishings and equipment | per_unit | finishes |
| `kitchens` | Kitchens | per_unit | finishes |
| `bathrooms` | Bathrooms | per_unit | finishes |
| `sanitary_installations` | Sanitary installations | per_unit | mech_elec_public_health |
| `mechanical_services` | Mechanical services | area | mech_elec_public_health |
| `electrical_services` | Electrical services | area | mech_elec_public_health |
| `fire_alarm_life_safety` | Fire alarm and life-safety systems | area | fire_acoustic_thermal |
| `sprinklers` | Sprinklers | area | fire_acoustic_thermal |
| `smoke_ventilation` | Smoke ventilation | lump_sum | fire_acoustic_thermal |
| `acoustic_upgrades` | Acoustic upgrades | area | fire_acoustic_thermal |
| `thermal_part_l_upgrades` | Thermal and Part L upgrades | area | fire_acoustic_thermal |
| `drainage_alterations` | Drainage alterations | lump_sum | drainage_utilities |
| `incoming_utility_upgrades` | Incoming utility upgrades | lump_sum | drainage_utilities |
| `lifts` | Lifts | per_item | lift |
| `builders_work_in_connection` | Builders' work in connection | percentage | other |
| `preliminaries` | Preliminaries | percentage | other |
| `main_contractor_ohp` | Main contractor overhead and profit | percentage | other |
| `design_development_allowance` | Design-development allowance | percentage | other |
| `external_works` | External works | area | externals |
| `landscaping` | Landscaping | area | externals |
| `risk_allowances` | Risk allowances | percentage | other |
| `other_conversion_works` | Other conversion works | lump_sum | other |

The default basis is a *suggestion for the template*; a rate row's own
`measurement_basis` governs. The "core" coverage set for the coverage warning
is every non-percentage element.

### 4.3 The source-record block (§23.5 amended)

```
SourceEvidenceRecord:
  id
  kind: 'listing_narrative' | 'listing_structured' | 'measured_survey' | 'valuation'
      | 'title' | 'planning' | 'appraisal_inputs' | 'other'
  captured_at: ISO date, reference: string, captured_by: string
  narrative_excerpt: string | null
  claims: {
    existing_use: string | null
    proposed_use: string | null
    floor_area_sqm: number | null
    tenure: 'freehold' | 'leasehold' | 'unknown' | null
    upper_parts_included: boolean | null
    vacant_possession: boolean | null
  }
SourceConflictResolution:
  id, field (a claims key), resolved_value: string | number | boolean | null
  chosen_record_id: string | null, evidence_reference: string
  resolved_by: string, resolved_at: ISO date, reason: string
```

A conflict on a field exists when two or more records carry non-null claims
for it that differ (strings compared case-insensitively and trimmed; areas
differ when they disagree by more than 5%). A conflict is resolved when a
resolution names that field with a non-empty `evidence_reference` and
`resolved_by`. The engine never picks a winner.

---

## 5. §27.2 — Area units: the exact conversion

```
SQFT_PER_SQM = 10.7639104167097          -- exact to the digits given; both engines carry this literal

area_ft2          = area_m2 × SQFT_PER_SQM
rate_per_ft2      = rate_per_m2 ÷ SQFT_PER_SQM
rate_per_m2       = rate_per_ft2 × SQFT_PER_SQM
```

Rules:

- The document stores m² and pence per m² only. A rate imported or typed in
  £/ft² is converted **once**, on entry, to a float pence-per-m² figure
  (`canonical_rate_pence_per_sqm`, unrounded); rounding happens only at the
  money boundary of an *amount* (`round_half_up(rate × quantity …)`).
- Toggling changes no stored value: display conversion is applied to the
  canonical figure each render, so N toggles produce the same canonical
  value as zero toggles (round-trip test).
- Entry in imperial converts the typed figure with `sqftToSqm` and stores the
  result to 4 dp of m² for areas (an entry precision, stated in the UI), and
  unrounded for rates.
- Money is never rounded twice: `benchmark_amount_pence` is the one rounding
  in the chain (§27.3).
- Percentage, per-unit, per-item and lump-sum rows carry no area and are
  unaffected by the toggle (pinned).
- Displays print the primary unit and the other unit in secondary text.

The worked invariant: `620 m² × 125,000 p/m² = 77,500,000 p`; in imperial,
`6,673.62445835 ft² × 11,612.8125… p/ft²` is the same product before the one
rounding, and the ft² rate is only ever printed, never stored.

Module: `frontend/src/lib/area-units.ts` and `app/financial_model/area_units.py`
(exact twins; `SQFT_PER_SQM` pinned equal in a parity test). The memo's three
private literals are retired in favour of the module. The lender-valuation
module's `SQFT_PER_SQM = 10.7639` is the `global_per_sqft` basis' *stored
convention* and is a **calculation input** — changing it would move
`lender_gdv_pence` on fixture G; it is left as it is and its comment now says
so (§27.9 limitation 6).

---

## 6. §27.3 — Currentisation, location, the amount

Per set:

```
currentisation_factor = current_index_value ÷ base_index_value     -- null unless both non-null and > 0
location_multiplier   = location_factor ÷ 100                     -- 1.0 when location_factor is null
                                                                  -- a per-rate location_factor overrides the set's
```

Per rate (area basis; the other bases substitute their own canonical rate):

```
canonical_rate_pence_per_sqm = original_rate_pence                       -- gbp_per_sqm
                             = original_rate_pence × SQFT_PER_SQM         -- gbp_per_sqft  (float, unrounded)
currentised_rate             = canonical_rate × (currentisation_factor ?? 1) × location_multiplier
adjusted_rate                = currentised_rate × (1 + adjustment_pct / 100)
benchmark_amount_pence       = round_half_up(adjusted_rate × quantity)   -- THE one rounding
```

Percentage rows: `benchmark_amount_pence = round_half_up(elemental_subtotal_pence × rate_pct / 100)`,
where `elemental_subtotal_pence` is the sum of every **non-percentage** row's
rounded amount. Percentage rows are never currentised or location-adjusted (a
percentage of a currentised base is already current).

Rules:

- **Index ratio whenever two dated observations exist.** `base_index_value`
  and `current_index_value` come from one named index (`base_index_name ==
  current_index_name`, validation rule 6) at two periods.
- **Zero or negative index values are a hard validation error** (rule 7),
  never a factor.
- **Missing either index value → `currentisation_factor: null`, method
  `'none'`, warning `rates_not_currentised`.** The rates are then compared
  at their base date and the report says so. Annual-percentage compounding
  is offered as a fallback method only in the UI's currentisation helper,
  which then *writes* the derived `current_index_value` as
  `base × (1 + r)^(months/12)` with `current_index_name = 'assumed: <r>% p.a.'`,
  so the assumption is visible in the stored document and on the panel —
  the engine itself has one method.
- **Location.** `location_factor` null → multiplier 1.0 and the warning
  `no_location_evidence`, printed as *"No evidenced location adjustment
  applied."*
- **Forward inflation is not here.** `forward_inflated_benchmark_amount_pence`
  on a result row is `round_half_up(benchmark_amount_pence × inflation_factor)`
  of the *mapped* cost-plan package (`target_cost_package_id`'s §24.3 factor)
  — a disclosure of what the package engine would carry, `null` when the row
  is unmapped or the plan carries no allowance. It enters nothing.
- **The seam.** An applied package's `amount_pence` is `benchmark_amount_pence`
  — the currentised, adjusted, base-date-`currentisation_date` figure. The
  §24.3 engine inflates it from `qs.base_date`, which apply has ensured
  equals `currentisation_date`. There is one forward step in the product and
  it is §24.3's.

---

## 7. §27.4 — The result block

`AppraisalResultV2.elemental_benchmark: ElementalBenchmarkResult | null`,
computed once in `deriveMetrics` / `derive_metrics` from the input block,
the already-derived `cost_plan` result and `developed_area_sqm`; null exactly
when the input block is null.

```
ElementalBenchmarkResult:
  provider_type, provider_label            -- 'User-supplied BCIS licensed benchmark' | 'Public benchmark' | 'User/QS benchmark'
  set_id, set_name, dataset_version, content_hash, library_set_id
  building_function, project_type, specification_level, region
  base_date, currentisation_date
  base_index_name, base_index_value, current_index_name, current_index_value, index_dataset_version
  currentisation_factor: number | null
  currentisation_method: 'index_ratio' | 'none'
  location_factor: number | null, location_multiplier: number, location_evidenced: boolean
  area_sqm: number                         -- developed_area_sqm, the area basis every area row defaults to
  rows: ElementalBenchmarkRow[]            -- one per selection, catalogue order
  totals: {
    benchmark_base_construction_pence      -- Σ rows.benchmark_amount_pence (percentage rows included)
    elemental_subtotal_pence               -- Σ non-percentage rows
    qs_base_construction_pence             -- detailed: cost_plan.base_build_pence; headline: the same figure (rate × area)
    difference_pence                       -- benchmark − qs
    difference_pct: number | null          -- pct(difference, qs)
    benchmark_rate_pence_per_sqm: number | null    -- round(benchmark ÷ area_sqm), null when area 0
    qs_rate_pence_per_sqm: number | null           -- cost_plan.implied_rate_pence_per_sqm
    mapped_qs_amount_pence                 -- Σ amount of packages some row targets (each counted once)
    unmapped_qs_amount_pence               -- qs_base − mapped
    unpriced_elements: integer             -- selections with no rate or a zero quantity on a priced basis
    elements_without_evidence: integer     -- rows whose rate is draft/unverified/estimated
    elements_outside_range: integer        -- rows with quartiles where currentised rate < LQ or > UQ
    coverage_pct: number | null            -- priced non-percentage elements ÷ catalogue non-percentage count
  }
  warnings: BenchmarkWarning[]             -- §27.5
  enters_tdc: false                        -- a literal, pinned by test
```

```
ElementalBenchmarkRow:
  element_code, element_label, measurement_basis, original_unit
  benchmark_rate_id: string | null
  quantity, quantity_unit
  original_rate_pence, rate_pct
  canonical_rate_pence_per_sqm: number | null
  currentised_rate_pence_per_sqm: number | null     -- floats, unrounded; the UI formats
  adjustment_pct, adjustment_reason
  adjusted_rate_pence_per_sqm: number | null
  benchmark_amount_pence: integer
  target_cost_package_id: string | null, target_package_label: string | null
  qs_amount_pence: integer | null                   -- the target package's amount_pence (base-date, uninflated)
  variance_pence: integer | null                    -- benchmark − qs
  variance_pct: number | null
  forward_inflation_factor: number | null           -- the target package's §24.3 factor
  forward_inflated_benchmark_amount_pence: integer | null
  lower_quartile_currentised_pence, median_currentised_pence, upper_quartile_currentised_pence: number | null
  sample_count: integer | null
  evidence_status
  outside_range: boolean | null                     -- null when no quartiles
  source_reference
```

**Headline mode:** `qs_base_construction_pence` is the headline
`base_build_pence`; every row's `qs_amount_pence` is null (no elemental
allocation is invented); the totals compare. **Detailed mode:** rows compare
against their targeted package. A package targeted by two rows is counted
once in `mapped_qs_amount_pence` and each row's `qs_amount_pence` is the whole
package (stated in the row's `notes`-free design: the UI shows the share).

---

## 8. §27.5 — Warnings and validation

Warnings are result data (`BenchmarkWarning { code, severity, message }`),
computed by the engine from the document, deterministic (§1.4 — no wall
clock; staleness is measured against `currentisation_date`, else
`acquisition_date`, else reported as `benchmark_age_unknown`):

| Code | Fires when |
|---|---|
| `benchmark_stale` | `base_date` is more than `thresholds.stale_after_months` before the reference date |
| `benchmark_age_unknown` | no reference date exists to measure staleness |
| `missing_source` | `source_title` blank, or `public_benchmark` with no `source_url`, or `bcis_licensed` with blank `licence_or_permission` |
| `no_location_evidence` | `location_factor` null |
| `project_type_mismatch` | `set.project_type !== 'conversion'` |
| `new_build_benchmark_on_conversion` | `set.project_type === 'new_build'` (in addition to the above) |
| `incomplete_coverage` | `coverage_pct < thresholds.min_coverage_pct` |
| `material_variance` | `|difference_pct| > thresholds.material_variance_pct` |
| `rates_not_currentised` | `currentisation_method === 'none'` and `base_date !== currentisation_date` |
| `source_unverified` | any selected row's rate is `draft` or `unverified` |
| `unpriced_elements` | `totals.unpriced_elements > 0` |
| `applied_without_currentisation` | any package carries `benchmark_origin` whose set had `currentisation_method 'none'` at apply time (recorded on the application) |

Every warning also surfaces as an `amber` `ModelFlag` with code
`benchmark_warning` and the message; `material_variance` is `red`. The
thresholds are inputs, so a lender can see what "material" meant.

Validation (hard errors, both engines, same message text, §9.6's drift guard):

1. `elemental_benchmark.set.rates[].id` unique; every `selections[].benchmark_rate_id` resolves to a rate whose `element_code` matches the selection's.
2. `selections[].element_code` unique and a catalogue member.
3. `original_unit` agrees with `measurement_basis` (`area` ↔ `gbp_per_sqm|gbp_per_sqft`, `per_unit` ↔ `gbp_per_unit`, `per_item` ↔ `gbp_per_item`, `percentage` ↔ `pct`, `lump_sum` ↔ `gbp`).
4. `original_rate_pence >= 0`; `rate_pct` non-null iff `percentage`, `0 <= rate_pct`.
5. `adjustment_pct != 0` requires a non-blank `adjustment_reason`; `-100 < adjustment_pct`.
6. `base_index_name` and `current_index_name` both null or both non-null and equal.
7. `base_index_value` / `current_index_value` non-null → finite and `> 0`.
8. `location_factor` non-null → finite and `> 0`.
9. `quantity >= 0`, finite; `quantity_unit` agrees with the rate's basis.
10. `provider_type === 'bcis_licensed'` requires non-blank `source_title` (the BCIS dataset/product), `licence_or_permission`, `imported_by`, `building_function`, and non-null `source_publication_date`, `location_factor`, `base_index_name`, `base_index_value`.
11. `provider_type === 'public_benchmark'` requires non-blank `provider_name`, `source_title`, `source_url`, `licence_or_permission`, and non-null `source_publication_date`, `retrieved_at`.
12. `provider_type === 'user_qs'` requires non-blank `source_title`, `imported_by`, and a non-blank `base_date`.
13. `cost_plan.packages[].benchmark_origin` non-null requires `elemental_benchmark` non-null with `set.id === origin.set_id` — an orphaned origin is an error, not a silent tag.
14. `target_cost_package_id` non-null must name a package on the plan (detailed mode only; headline mode forbids it).
15. `due_diligence.source_records[].id` unique; `source_resolutions[].field` a claims key; `chosen_record_id` non-null must resolve.

---

## 9. §27.6 — The library, index datasets, hashing, immutability

Alembic **008** adds:

- `benchmark_sets`, `benchmark_rates` — the library. A set is immutable: no
  PUT; `content_hash` is unique per `(provider_type, dataset_version,
  content_hash)`; a re-import of identical content is a 409 naming the
  existing id. `source_file_sha256` is stored when a file was uploaded.
- `index_datasets`, `index_observations` — an index series version. Unique
  on `(publisher, series_code, dataset_version)`; observations unique on
  `(dataset_id, period)`; periods `YYYY-MM` validated strictly increasing on
  import; values finite and `> 0`. No PUT, no DELETE.
- `users`, and the governance columns of §10.
- `appraisal_versions` — §11.

`content_hash` = `canonical_hash` (the §13.2 encoding) over the normalised
set with `content_hash`, `id`, `created_at`, `imported_by` and
`library_set_id` removed and rates sorted by `element_code, id`. Computed by
the server on import and by both engines for the document's embedded set;
the result republishes it; the provenance panel prints it beside the dataset
version.

API (all under `/api/v1`, all authenticated; import routes require
`administrator` or `underwriter`):

| Route | Behaviour |
|---|---|
| `GET /benchmark-sets` | library listing (headers only) |
| `GET /benchmark-sets/{id}` | one set with rates and derived currentised rates for a `?currentisation_date=&current_index_value=` query — derived server-side by the Python engine's own helper, never stored |
| `POST /benchmark-sets` | JSON import (`ElementalBenchmarkSet` sans hashes); validates §27.5 rules 1–12; 409 on duplicate content; 201 with the stored row |
| `POST /benchmark-sets/import-csv` | multipart CSV in the template's columns; same validation; records `source_file_sha256` |
| `GET /benchmark-sets/template.csv` | the element catalogue as an import template with the column header row and a comment row per element |
| `GET /index-datasets`, `GET /index-datasets/{id}` | listing, one series with observations |
| `POST /index-datasets` | JSON `{publisher, series_code, series_name, dataset_version, source_url, licence, publication_date, retrieved_at, base_period, observations:[{period,value}]}`; period/monotonic/value validation; 409 on duplicate version |
| `POST /index-datasets/import-csv` | multipart CSV `period,value` plus the header fields as form fields |

No route fetches anything from the internet. Automatic download is **not
implemented** (§27.9 limitation 3); the seed command reads the repository's
`data/index-datasets/*.json`.

**The shipped public dataset.** `data/index-datasets/ons-construction-opi-2026q2.json`:
publisher *Office for National Statistics*, title *Construction Output Price
Indices (OPIs), Quarter 2 (April to June) 2026*, source URL
`https://www.ons.gov.uk/file?uri=/businessindustryandtrade/constructionindustry/datasets/interimconstructionoutputpriceindices/current/bulletindataset9.xlsx`,
released 13 August 2026, retrieved 30 August 2026, source-file SHA-256
`ea0cbfe6573be52210ea0469f182ac5f03c68af39b193ab0f328feb24626edde`, base
2015 = 100, monthly January 2014 – June 2026, ten series (`all_new_work`,
`all_repair_maintenance`, `all_construction`, `new_housing`,
`new_public_other`, `new_private_industrial`, `new_private_commercial`,
`new_infrastructure`, `rm_housing`, `rm_non_housing`), licence *Open
Government Licence v3.0*, Crown copyright. It is labelled everywhere as
*"ONS Construction Output Price Index — a public currentisation proxy; not
BCIS TPI and not an elemental-cost dataset."*

---

## 10. §21 amended — authenticated governance

### 10.1 Users, roles, tokens

```
users: id (uuid), email (unique, lower-cased), display_name, role, password_hash, password_salt,
       is_active, created_at, updated_at
role: 'developer' | 'broker' | 'underwriter' | 'credit_approver' | 'administrator'
```

`POST /auth/login {email, password}` → `{token, user}`; `GET /auth/me`;
`POST /auth/logout` (204; tokens are stateless and expire after
`AUTH_TOKEN_TTL_SECONDS`, default 12 h). `GET/POST /users`,
`PATCH /users/{id}` — administrator only; an administrator cannot demote the
last active administrator. Bootstrap: `ADMIN_BOOTSTRAP_EMAIL` +
`ADMIN_BOOTSTRAP_PASSWORD` create the first administrator at startup when
the table is empty; `python -m app.auth.cli create-user` does the same from
a shell. Display names are subject to the §13.2.1 field-boundary rule (no
`|`, no control characters, ≤ 256) because they are `case_hash` components.

### 10.2 Lender-case identity

`lender_cases` gains `version` (integer, starts at 1, +1 per write),
`created_by_user_id`, `submitted_by_user_id`, `reviewer_user_id`,
`decided_by_user_id` (nullable FKs to `users`); `lender_case_events` gains
`actor_user_id` (nullable FK), `idempotency_key`, `reason`,
`input_snapshot_hash`, `outputs_hash`, `case_hash_after`, `case_version_after`,
and a unique index on `(case_id, idempotency_key)`.

`LenderCaseCreate` becomes `{project_id}` — `created_by` is **rejected** with
422 if sent. `LenderCaseTransition` becomes
`{to_status, note?, conditions?, reason?, expected_version, expected_case_hash,
idempotency_key}` — `actor` is rejected with 422 if sent.

### 10.3 The role matrix (server-enforced, `ROLE_TRANSITIONS` in `provenance.py`, mirrored in `report-provenance.ts` for the UI's buttons only)

| Action | Roles |
|---|---|
| create (→ `draft`) | developer, broker, administrator |
| `→ submitted` | developer, broker, administrator |
| `→ under_review`, `→ information_required` | underwriter, credit_approver |
| `→ credit_approved`, `→ approved_with_conditions`, `→ declined` | credit_approver |
| `→ superseded` | any authenticated role |

**Maker-checker.** A decision (`credit_approved`, `approved_with_conditions`,
`declined`) is refused with 403 when `actor.id ∈ {created_by_user_id,
submitted_by_user_id}`; `→ under_review` is refused when `actor.id ==
submitted_by_user_id`. A case with a null `submitted_by_user_id` at decision
time (a legacy case) is refused with 409 *"this case was submitted without an
authenticated user — supersede it and recreate"*.

### 10.4 Concurrency, idempotency, integrity

- `expected_version != case.version` → 409 stale; the compare-and-swap adds
  `version == expected_version` to the R14b `status == expected_status`
  predicate and writes `version + 1`.
- `expected_case_hash != case.case_hash` → 409 *"case hash mismatch"*.
- Before any transition the server recomputes `input_hash(locked_inputs_snapshot)`
  and refuses with 409 *"locked snapshot integrity failure"* when it differs
  from `locked_input_hash` — a tampered row cannot be advanced.
- `idempotency_key` seen before on this case: if its stored event's
  `to_status` equals the request's, return 200 with the current case and
  write nothing; otherwise 409.
- Every event records `actor_user_id`, the display name (`actor`), the UTC
  timestamp, `from_status`/`to_status`, `reason`, `input_snapshot_hash`
  (= `locked_input_hash`), `outputs_hash` (= `locked_outputs_hash`),
  `case_hash_after`, `case_version_after`. Events remain append-only.

### 10.5 What stays

`case_hash`'s eight parts and `audit_hash`'s six are unchanged. The display
name columns are written from `user.display_name`. Unauthenticated `GET`s on
projects, appraisals and lender cases remain open in this release (the
product is single-tenant; §27.9 limitation 4 records tenant isolation as
unbuilt); every write to `/lender-cases`, `/benchmark-sets`, `/index-datasets`
and `/users` requires a bearer token.

### 10.6 The UI

A login panel (`/login`), `AuthProvider` context, token in `sessionStorage`,
`api.ts` sends `Authorization: Bearer …` on every request. `LenderCasePage`
loses its "Your name" fields; it shows the signed-in user and role, offers
only the transitions the role matrix allows, sends `expected_version`,
`expected_case_hash` and a fresh `idempotency_key` per confirmation, and
prints the server's refusal verbatim. With no users configured the page says
*"Lender governance unavailable — no authenticated users are configured on
this server"* and offers nothing. There is no role selector.

---

## 11. The governed resave and the York case

`POST /api/v1/appraisals/{project_id}/resave` (authenticated; any role):
reads the stored row, writes its current state to `appraisal_versions`
(`reason: 'governed_resave'`, the original snapshot, versions, outputs and
hashes, `superseded_at`), migrates the snapshot through
`migrate_inputs_to_v17`, runs `calculate_authoritative`, and persists the
result with the current versions and hashes. The response carries the new
row and `previous_version_id`. `GET /api/v1/appraisals/{project_id}/versions`
lists them. `GET /api/v1/appraisals/stale` lists every stored row whose
`inputs_version` or `calc_version` is behind the server's. Every ordinary
save (`PUT /appraisals/{project_id}`) also writes the pre-save state to
`appraisal_versions` (`reason: 'save'`) — the audit trail the audit asked for.

The York case is resaved through this route by `scripts/york_reconcile.py`,
which also: repairs the stored description with the same narrow rule the
client's `repairGluedDescription` applies (the label `Description` glued to a
capital letter), recording the original text in the script's output; and
writes two `source_records` into the document — `listing_structured`
(`existing_use: 'office'`, from the project row) and `listing_narrative`
(`existing_use: 'retail (ground and basement); upper parts sold off on long
lease and operated as Airbnb accommodation'`, `upper_parts_included: false`,
with the excerpt) — with no resolution. The case therefore stays DRAFT with
`source_conflict_unresolved` raised, and the script prints the unresolved
jurisdiction, VAT, equity, valuation, exit and due-diligence items from the
run's validation and flags. It does not change any financial assumption; the
identity of every metric before and after the resave is asserted in
`tests/test_york_audit_case.py`.

---

## 12. Reporting

The memo gains **§12C — Elemental Cost Benchmark** (after the assumption
schedule) when `metrics.elemental_benchmark` is non-null: provider label and
classification, building function and project type, base and currentisation
dates, region and location adjustment (or *"No evidenced location adjustment
applied."*), the report unit, benchmark base build, QS/developer base build,
variance amount and %, the elemental comparison table (Element / Basis /
Quantity / Original rate / Currentised rate / Adjustment / Benchmark amount /
QS amount / Variance / Evidence), unmatched elements, the currentisation
calculation printed as its factors, the forward-inflation treatment sentence
(*"Benchmark amounts are stated at <currentisation date>. Where applied to
the cost plan they are inflated to each package's spend midpoint by the
cost-plan inflation line (§24.3) and by nothing else."*), source and
retrieval, evidence status, and the limitations statement — including,
verbatim, *"Benchmark rates are an initial reasonableness check, not a
substitute for project-specific QS advice, surveys, design development,
contractor pricing or lender monitoring."* The heading never contains "BCIS"
unless `provider_type === 'bcis_licensed'`, in which case it reads
*"User-supplied BCIS licensed benchmark"* and states that the application has
not independently verified the user's licence or the underlying BCIS data.

The provenance panel (§13.1) gains *Report area unit* (`m²` or `ft², 1 m² =
10.7639104167097 ft²`), *Benchmark dataset* (`<version> (<content_hash>)`)
and *Index dataset* rows when a benchmark exists. The methodology sentence
for the unit prints once, in the basis of preparation.

`export-investment-memo.ts` performs no benchmark arithmetic: every printed
figure is a result-row field.

---

## 13. The four corrections

1. **Unrealised ROE.** `ProjectDetail`, `InvestorSummaryPage`, `ScenariosPage`,
   `AppraisalSummaryPage` and `export-pdf.ts` print *"Unrealised Return on
   Equity"* when `return_on_equity_is_unrealised` is true and *"Return on
   Equity"* otherwise; the memo's `roeLabel` adopts the same words.
   `ProjectDetail` reads the flag from stored `outputs.metrics`; a row without
   it prints *"Return on Equity (realisation basis not recorded)"*.
2. **The stress Setting cell.** `formatStressSetting` special-cases `refi_ltv`
   to *"Maximum refinance LTV reduced by 10.0 percentage points."*; the entry
   label stays `Refinance LTV -10 pp`; the sign-convention sentence is
   retained for the other levers. Both consumers read the one function.
3. **Month labels.** `formatProgrammeMonth` is the single labeller; the memo's
   peak-debt prose reads `Month n` from it (no `+ 1`); the cost-to-complete
   table labels rows by the ledger month they refer to through the same
   function; the memo's Programme section states once: *"Months are ledger
   months: Month 0 is the acquisition month; where a programme anchor exists,
   calendar months are printed instead."*
4. **PDF/UA.** Not achievable with jsPDF 4.2.1 (no structure tree, `MarkInfo`
   or role map in the shipped API or dist). The memo keeps title, subject,
   language and `DisplayDocTitle`, and its basis-of-preparation states: *"This
   PDF is not tagged to PDF/UA; the generator library exposes no structure
   tree."* Governance §12 records the limitation.

---

## 14. §27.7 — Migration and the persistence boundary

`migrateV16toV17` / `migrate_v16_to_v17` write `elemental_benchmark: null`,
`benchmark_origin: null` on every package, and `source_records: []`,
`source_resolutions: []` on `due_diligence`; `isV17` / `is_v17` require
`inputs_version == 17`, the `elemental_benchmark` key present, every package
carrying the `benchmark_origin` key, and `due_diligence.source_records`
present. The entry points (`ConversionCalculator.tsx`, `ExportPage.tsx`,
`app/api/app.py`) move to v17 in one commit; both guards pin `NEWEST == 17`.

**Identity gate:** corpus-wide, raw ≤ v16 through the 2.19.0 engine on both
arms, comparing `metrics` **with `elemental_benchmark` present and null on
both**, `model` and `schedule`, with no exclusion; sensitivity arms on F/U/Y/Z;
R12's three validation properties with both exception lists empty and
asserted empty.

**The consequence a reader must not mistake for a defect.** Every stored
row's `input_hash`, `outputs_hash` and `audit_hash` move on its next save
(three keys join the document; one joins the result). Every live lender case
goes stale at that save (§21.3). `spec-versions.test.ts` follows the new
constants.

---

## 15. §27.8 — Fixtures

- **Fixture AB — `ab-elemental-benchmark.json`**, `kind: "pipeline"`,
  authored at v17, named `AB — elemental benchmark, TEST FIXTURE — NOT MARKET
  DATA`. Base: fixture Z's document (detailed plan, network, 6% allowance,
  known midpoints) with an embedded `user_qs` set of seven rates (five area
  rows — one in `gbp_per_sqft` — one per-unit row and one percentage row),
  base index 120.0 at `2025-06`, current index 126.0 at `2026-06`
  (factor 1.05 exactly), location factor 95 (multiplier 0.95), one row
  adjusted −10% with a reason, seven selections mapped to Z's packages, and
  one application already performed so that two packages carry
  `benchmark_origin`. Pins, hand-derived in `test-cases.md` §27: every row's
  canonical, currentised and adjusted rates, every amount, the subtotal and
  percentage row, the totals, each warning, the forward-inflated amounts from
  Z's factors, `construction_total_pence`, TDC, peak debt, profit, LTC/LTGDV,
  and the identity of the metrics with and without the benchmark block
  (advisory proof).
- **`fixtures/benchmarks/test-elemental-benchmark-set.json`** — the same set
  as a library import document, used by the API tests, named
  `TEST FIXTURE — NOT MARKET DATA`. Never seeded.
- **`fixtures/benchmarks/index-import-*.csv`** — a valid file, a
  non-monotonic file, a duplicate-period file, a zero-value file, a malformed
  header file — for the import tests.
- **`fixtures/benchmarks/ons-opi-2026q2-sample.csv`** — twelve rows of the
  real ONS `all_new_work` series with its provenance header, so the import
  round trip is exercised on genuine data.

---

## 16. Out of scope

Tenant/organisation isolation; approval limits and delegation; evidence-file
attachments; a BCIS API integration (none exists to integrate); automatic
online index refresh; a computed partial-exemption VAT method; a portfolio
stale-version dashboard beyond the `stale` listing; raster memo regression;
per-package index selection (the flat allowance stays the forward mechanism).

---

## 17. §27.9 — Stated limitations

1. **No elemental rates ship.** The library is empty until a user imports a
   licensed BCIS export or a set they are entitled to redistribute, or enters
   their own. The product cannot benchmark a scheme out of the box, and says so.
2. **ONS OPI is an output-price proxy.** It is not a tender-price index and not
   elemental; using it to currentise elemental rates is an approximation the
   report labels as such.
3. **No automatic download.** Refreshing an index means running the seed or
   the import with a file a person retrieved.
4. **Single tenant.** Users share one library, one project list; there is no
   organisation boundary.
5. **Tokens are stateless.** Logout is client-side discard; a compromised
   token is valid until expiry. Rotating `API_SECRET_KEY` invalidates all.
6. **`global_per_sqft` keeps `10.7639`.** The lender-valuation basis is a
   stored calculation convention pinned by fixture G; the display module's
   exact constant is not applied to it.
7. **Headline comparison is a total.** Headline mode compares one figure; no
   elemental allocation is inferred.
8. **A percentage element's base is the benchmark subtotal**, not the QS
   subtotal, so its QS comparison is the target package's whole amount.
9. **PDF/UA is not achievable with the current library.**
10. **Source-conflict detection is per field on structured claims.** The
    narrative excerpt is stored and printed; it is not parsed.

---

## 18. Guards this release must watch fail

| Guard | Watched by |
|---|---|
| Advisory-only | Fixture AB's metrics with the benchmark block removed equal its metrics with it present, on `construction_total_pence`, TDC, peak debt, profit — written before the result block exists and watched red when a first draft added the benchmark total to construction |
| Unit invariance | `benchmark_amount_pence` for an area row equals the amount from the same rate expressed in `gbp_per_sqft`, in both engines, on the 620 m² × £1,250 case and on every AB row |
| Round trip | 1,000 alternating toggles on the AB document leave every canonical value bit-identical |
| Single forward step | An applied package's `inflation_pence` equals §24.3's figure from `qs.base_date = currentisation_date`; a test that seeds `qs.base_date = set.base_date` instead must produce a *larger* figure and the apply must be refused |
| Zero/negative index | Rule 7 fires on `0`, `-1`, `NaN`, `Infinity` in both engines with identical text |
| Labelling | A `public_benchmark` memo contains neither `BCIS cost plan`, `BCIS verified` nor `BCIS valuation`; a `bcis_licensed` memo contains `User-supplied BCIS licensed benchmark` and the not-verified sentence |
| Duplicate import | The same set posted twice is 409 the second time, naming the first id; a one-rate change is 201 with a different `content_hash` |
| Non-monotonic import | The five CSV fixtures produce exactly the five documented 422 messages |
| Unauthenticated | Every write route in §10.5 returns 401 with no token and 403 with the wrong role; the R14b test file's positive paths are rewritten to log in |
| Maker-checker | The submitter's token approving the case is 403; a different credit approver's is 200 |
| Stale version | `expected_version - 1` is 409; a replayed identical `idempotency_key` is 200 and writes no second event; a tampered `expected_case_hash` is 409; a row whose `locked_inputs_snapshot` was edited in the DB is 409 |
| York | The resave keeps every metric identical, stores the original snapshot, leaves the row DRAFT, and raises `source_conflict_unresolved` |
| Month labels | The memo's peak-debt prose and its cashflow table name the same month on the R14b release-gate documents |
| ROE | `ProjectDetail` with `return_on_equity_is_unrealised: true` prints `Unrealised Return on Equity`; with `false` prints `Return on Equity` |
| Stress cell | Neither the page nor the memo contains `Refinance LTV +10.0 pp` |
| Spec-versions pin | `spec-versions.test.ts` red until §1.6 carries `17 (**inputs v17**) = calc 2.19.0+` |
| Corpus untouched | No fixture pin's value moves; AB is the only new file under `fixtures/financial-model/` |
