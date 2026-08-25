# Release 15 — The due-diligence evidence schedule design

**Date:** 25 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§7.1 (*"structured fields for … planning or prior-approval reference, decision
and expiry dates, conditions, conservation/listed status, CIL/S106,
title/rights/restrictions, vacant possession, leases/tenancies, rights of
light, party wall and evidence source/date"*; *"require competent
confirmation"* of higher-risk-building status), §7.10 (*"evidence-led
categories for Planning, Title/Occupation, Existing Building, Construction,
Finance and Exit. Every issue should have red/amber/green/**unknown**,
evidence, owner, due date, cost/programme impact and action. Unknown must
never default to green"*), §7.5's leftovers (*"QS source/date/status,
fixed-price coverage, provisional sums, inflation and package exclusions"*),
§11's P1 row *"No complete conversion evidence/risk schedule"*, and the R7
report's §6a (*"The audit called for this to raise a hard
information-required flag rather than sit in narrative text. It still does
not. That is R15"*). Release-plan row: **R15 — Scheme/title/technical DD
schedule, evidence RAG+unknown, source-conflict flags + the §7.5 items R10
deliberately left unaddressed — P1 — inputs v13.**

**Versions:** calc `2.14.0` → `2.15.0`; inputs `v12` → `v13`.
**Specification:** the calculation specification gains **§23**; **§1.5** gains
the schedule as the rule's second application; **§1.6**'s inputs-version list
gains v13; **§13.3** goes from six FINAL conditions to seven; **§13.4**'s cost
basis bullet becomes conditional on recorded QS evidence and its "narrative-only
due diligence" limitation becomes a historical note; **§14.6**, **§17.10** and
**§3.2**'s evidence fields are named as the sources of the dashboard's derived
rows; **§15.9** limitation 4 and **§16.9** limitation 3 become historical notes
and §16.9 gains the inflation deferral; **§22.10** limitation 7 is narrowed to
its per-row residue.

---

## 1. The problem this release exists to solve

### 1.1 Due diligence is prose

The appraisal records its planning position, title, occupation, building
condition and professional evidence nowhere. The risk register (`risks[]`) is
five free-text rows seeded by the migration — *"Prior approval refusal /
medium / high / Pre-application consultation with LPA"* — with no category, no
evidence, no owner, no date and no way to say **unknown**. The memo's §9 then
text-matches those descriptions against nine hard-coded phrases (`'planning'`,
`'MEES/EPC'`, …) to print "Risks not yet addressed", so a row reading *"planning
is fine"* satisfies the planning check. The memo's own limitation 5 says it
plainly: *"Technical, title, occupation and planning due diligence is recorded
as narrative and as a free-form risk register, not as an evidenced schedule
with status, owner and date."*

### 1.2 Unknown defaults to green by omission

The audit's sharpest rule — *unknown must never default to green* — is
violated not by any field but by the absence of one. A document that has never
asked whether vacant possession is obtainable does not say so; it models a
vacant building. That is the York case: the listing describes upper parts
*"sold off on long lease (999 years from 01.01.2007) and operated as Airbnb"*
and the appraisal converts a vacant office to five flats. Nothing in the
document is wrong; the assumption nobody recorded is. The R7 report said this
release would make it a hard information-required flag rather than prose.

### 1.3 The evidence the model does carry is scattered

Five mechanisms already record evidence, each in its own vocabulary: equity
sources (`evidence_status`, R1), the acquisition jurisdiction (§14.6, R8),
VAT treatments (§17.10, R11), the lender valuation's `reason`/`author`/`date`
(§3.2, R2) and the facility's `requires_confirmation` (§10). Two gate FINAL;
three do not; none is visible beside the others. A lender asking "what is
evidenced?" reads five pages.

### 1.4 The cost plan has no provenance

§16.9 limitation 3: a package carries no source, date or status — *"no 'priced
by [firm], RIBA Stage 4, dated [x]' distinction in the record"* — and §13.4
makes every detailed-mode report say so in the same breath as "detailed cost
plan". Fixed-price coverage and provisional sums, the two figures a QS review
starts with, cannot be stated because no package says which it is.

---

## 2. Scope

| Audit ask | Owned by | Notes |
|---|---|---|
| §7.10 evidence-led categories, RAG + unknown, evidence, owner, due date, impacts, action | **R15** | §23.1–§23.4 |
| §7.1 structured planning/title/occupation/technical facts with evidence source/date | **R15** | as catalogue items, §23.2 — one mechanism, not a typed facts block (decision 2) |
| §7.1 competent confirmation of higher-risk-building status | **R15** | catalogue item `higher_risk_building`; the spider's screening band is caveated until it is green |
| R7 §6a: the source-data contradiction as a hard flag | **R15** | the captured source record and `source_conflict`, §23.5 — structured facts only (decision 6) |
| §7.5 QS source / date / status | **R15** | `cost_plan.qs`, §23.6 |
| §7.5 fixed-price coverage, provisional sums | **R15** | `CostPackage.price_basis` and the derived coverage block, §23.6 |
| §7.5 package exclusions | **R15** | already carried by `CostPackage.notes`; the memo prints it under the QS line — no new field |
| §7.5 inflation | **R15b** | deferred, decision 12 — it is a *timing* question that needs the per-package programme §16.9 limitation 1 still lacks |
| R13b backlog: message-drift guard window to cover §22.7; `unit_sales.totals.gross_pence == totals.gross_sales_pence` | **R15** | §16 |

**No arithmetic changes.** Every money figure on every existing document is
identical under calc 2.15.0; the release adds a result block, four flags and a
seventh FINAL condition.

---

## 3. Decisions taken at design time

| # | Decision | Chosen | Rejected, and why |
|---|---|---|---|
| 1 | Where the schedule lives | A new top-level **`due_diligence`** block in the inputs document, so both engines derive the same dashboard from the same snapshot and a locked lender case (§21.1) carries the evidence position it was approved on | A separate table + API (R14b's shape) — the dashboard would then be invisible to the Python engine and absent from the locked snapshot; extending `risks[]` — see 3 |
| 2 | §7.1's "structured fields" | **Catalogue items**, not a typed scheme-facts block: the planning reference is the planning item's `evidence.reference`, its decision date the `evidence.date`, its lapse the item's `expiry_date`; conditions, tenancy terms and covenants are the item's `notes`/`action` | A typed block (`planning_reference`, `tenure`, `vacant_possession: bool`, …) *beside* the items — every fact would then live twice, once as a value and once as an evidenced status, which is R10's seam defect by construction |
| 3 | Relationship to `risks[]` | **Kept, untouched.** The audit calls it "useful as a project log"; it stays the log. The memo's nine-phrase text-match is deleted and replaced by the schedule's own unknown count | Extending `risks[]` with category/status/evidence — a list the user populates cannot enforce "unknown never defaults to green" for the items nobody added |
| 4 | Item identity | A **fixed catalogue** of 28 codes across the six audit categories, every code present exactly once (§22.7 rule 3's both-directions shape), plus `custom` items with a label | Free-form items only — nothing forces the untouched areas to exist as `unknown`; a per-route catalogue — applicability is a fact the appraiser evidences (decision 5), not one the engine infers |
| 5 | The status set | `red` / `amber` / `green` / `unknown` / **`not_applicable`**; `unknown` is every item's seed; `green` requires evidence; `red`/`amber` require an action; `not_applicable` requires a reason in `notes` | RAG + unknown only — party-wall and rights-of-light items on a detached freehold would sit `unknown` forever or be marked `green` dishonestly; deriving applicability from the route — see 4 |
| 6 | Source-conflict flags | The document carries a **captured `source_record`** — the listing's *structured* fields copied from the project at creation or on demand — and the engine compares it to the appraisal under two stated rules | Text-mining `description` for "lease"/"Airbnb"/"tenant" — not evidence, not deterministic across engines (§1.4), and a rule that fires on a word is a rule that misses a synonym; reading the project record at run time — the engine is a pure function of the inputs document, and a locked case must be recomputable from its snapshot |
| 7 | Existing evidence mechanisms | **Derived rows** on the dashboard, read from the five existing fields, labelled by source and read-only; each keeps its own gate semantics | Duplicating them as catalogue items — two mechanisms for one fact (an `equity_evidence` item green while a source is `unconfirmed`); folding their gates into the new one — a behaviour change to R8's and R11's tested gates for no audit ask |
| 8 | The FINAL gate | A **seventh condition**: no *entered* item is `unknown`. Reason `due_diligence_incomplete`, ordered after `vat_basis_unconfirmed` and before `not_approved`, on §14.6's reasoning (the figures are not wrong; the evidence is missing; a reader must know before reading an approval) | Gating on `red` too — a red with an action is a known, priced risk, and `approved_with_conditions` exists for exactly that; gating derived rows — see 7; no gate — "unknown never defaults to green" with no consequence is a colour |
| 9 | Green without evidence | A **hard validation error** — the claim is unrepresentable, the same class as a row naming an absent unit | Downgrading it to `unknown` silently — a silently reinterpreted input (§2's rule); a flag — a flag lets the memo print a green nobody evidenced |
| 10 | QS provenance placement | On the cost plan: a nullable **`cost_plan.qs`** block (source, stage, date, status, pricing base date) and a nullable per-package **`price_basis`**; surfaced on the dashboard as a derived row | On the DD schedule as a `cost_plan_qs` item — the QS's evidence is a fact about the cost plan and must travel with it (a lender case locks both anyway); two booleans `fixed_price`/`provisional` — a package can be neither and cannot be both, so it is one enum |
| 11 | Fee lines | **No provenance fields.** A fee line is an appointment, not priced works; the cost plan's `qs` block covers the packages only | Per-fee-line basis — fixed/percentage is already its `basis`; a "priced by" on a fee is the appointment letter, which is the `procurement_contractor`/`sponsor_entity` evidence, not QS evidence |
| 12 | Inflation | **Deferred to R15b**, scheduled: "the cost plan in time" — per-package programme (§16.9 limitation 1, unowned since R12), tender-price inflation from `qs.base_date` to each package's spend midpoint, and per-package draw eligibility (§16.9 limitation 2). R15 records `qs.base_date` so R15b has its origin | A flat `inflation_pct` on base build now — indistinguishable from the general contingency class until packages have their own timing, and a second flat percentage on the same base is R10's double-count seam reopened; taking the full timing model here — an arithmetic axis in an evidence release, R13/R13b's and R14/R14b's rule |
| 13 | Consent expiry | One flag, `consent_expires_before_start`, on the `planning_route` item only: its `expiry_date`, in whole months from `acquisition.acquisition_date`, earlier than the construction spend's first month | A generic "expires within term" over every item — a lease *expiring* is good news, a survey has no expiry; comparing to the wall clock — §1.4 |
| 14 | Impacts | `cost_impact_pence` and `programme_impact_months` are **nullable** (`null` = not assessed, `0` = assessed as none, §1.5); totals sum the assessed red/amber items and count the unassessed | Required zeros — a zero nobody entered would print as an assessed nil impact |
| 15 | Sensitivity | **No lever.** The schedule is §12.2-invariant; a "risks crystallise" stress (Σ cost impact onto construction, Σ programme impact onto the timeline) is recorded for R16's presets, not built here | Building it — a tenth lever whose composition with `cost` and `timeline` needs its own design |
| 16 | Version | calc **2.15.0**: the result gains a block and four flags, so outputs are not shape-comparable with 2.14.0 (§1.6), and inputs move to v13 | No bump (R14b's precedent) — R14b moved neither inputs nor outputs; this moves both |

---

## 4. §23.1 — The schema (inputs v13)

`due_diligence` is a **non-nullable** top-level block — unlike `unit_sales` or
`monitoring`, there is no document for which "no due diligence" is a
meaningful state; an unexamined document is one whose every item is `unknown`,
and the migration says so explicitly rather than by absence.

```
due_diligence: {
  source_record: SourceRecord | null       -- null = never captured
  items:         DdItem[]                  -- every catalogue code once, plus custom items
}

DdItem:
  id:                      string          -- 'dd-<code>' for catalogue items (migration-deterministic); uuid for custom
  code:                    DdItemCode      -- §23.2's 28 codes, or 'custom'
  category:                DdCategory      -- fixed by the catalogue for a catalogue code; entered for 'custom'
  label:                   string          -- '' for a catalogue item (the catalogue supplies it); required for 'custom'
  status:                  'red' | 'amber' | 'green' | 'unknown' | 'not_applicable'
  evidence:                DdEvidence | null
  expiry_date:             string | null   -- ISO yyyy-mm-dd; the consent's lapse, a lease's end
  owner:                   string
  due_date:                string | null   -- ISO
  cost_impact_pence:       integer | null  -- null = not assessed
  programme_impact_months: integer | null  -- null = not assessed
  action:                  string
  notes:                   string

DdEvidence:
  source:    string        -- who produced it: firm, LPA, Land Registry, valuer
  reference: string        -- the document: planning ref, title number, report ref
  date:      string        -- ISO; the document's date, not today's

SourceRecord:                              -- the listing's structured fields, copied
  captured_at:          string             -- ISO datetime; an INPUT (when the copy was taken), never computed
  source_name:          string | null
  source_url:           string | null
  is_vacant:            boolean | null
  tenure:               'freehold' | 'leasehold' | 'unknown' | null
  lease_years_remaining: integer | null
  floor_area_sqm:       number | null
  use_class:            string | null
  epc_rating:           string | null
```

- The five `SourceRecord` facts are exactly the `Project` fields the scrapers
  structure (`app/models.py`): `is_vacant`, `tenure`, `lease_years_remaining`,
  `floor_area_sqm`, `use_class`, `epc_rating`. `description` and
  `current_use_description` are **not** copied: prose is not a fact the engine
  can compare (decision 6). The UI shows them beside the Title/Occupation
  category as a prompt, which is where the York contradiction becomes visible
  to the appraiser evidencing `vacant_possession`.
- Pydantic bounds follow port rule #7: `cost_impact_pence`,
  `programme_impact_months`, `lease_years_remaining` and `floor_area_sqm`
  carry `ge=0`; every enum is a `Literal`; the date-format rules and the
  status/evidence rules are validation errors owned by `validation.py`.

The cost plan gains:

```
cost_plan.qs: null | {
  source:    string                        -- the firm or person who priced it
  stage:     'order_of_cost' | 'riba_2' | 'riba_3' | 'riba_4' | 'tender' | 'contract_sum'
  date:      string                        -- ISO; the cost plan's issue date
  status:    'draft' | 'issued' | 'reviewed'
  base_date: string                        -- ISO; the pricing base date (R15b's inflation origin)
}

CostPackage.price_basis: 'fixed_price' | 'provisional_sum' | 'estimate' | null   -- null = not classified
```

`qs` is detailed-mode only, hard-rejected in headline mode exactly as
`vat_override` is (§17.1): a rate × area estimate has no QS. `price_basis` is
carried on every package and read only in detailed mode.

---

## 5. §23.2 — The catalogue

Twenty-eight codes in six categories, in this order. The catalogue — code,
category, label, and the one-line prompt the editor shows — is a literal in
both engines (`due-diligence.ts` / `due_diligence.py`), pinned byte-identical
by mirrored tests exactly as `ALLOWED_TRANSITIONS` is (§21.2).

| Category | Code | What green means |
|---|---|---|
| `planning` | `planning_route` | The consent or prior approval the scheme relies on is granted; `evidence.reference` is its reference, `evidence.date` its decision date, `expiry_date` its lapse |
| | `planning_conditions` | Pre-commencement conditions identified and their discharge programmed |
| | `article_4_direction` | The Article 4 position is confirmed with the LPA |
| | `conservation_listed` | Conservation-area and listed status confirmed |
| | `cil_s106` | CIL/S106 liability confirmed and carried in the cost plan's `cil_s106` fee line |
| `title_occupation` | `title_report` | Report on title: tenure, rights, restrictive covenants, easements |
| | `vacant_possession` | Vacant possession obtainable on the modelled date; `red` = not obtainable, `amber` = subject to surrender/notice |
| | `leases_tenancies` | Every occupational lease and tenancy scheduled, with its surrender or expiry terms |
| | `rights_of_light` | Rights-of-light position surveyed or confirmed not to arise |
| | `party_wall` | Party-wall matters identified and awards programmed, or confirmed not to arise |
| `existing_building` | `structural_survey` | Structural survey of the existing frame and envelope |
| | `asbestos_survey` | Refurbishment-and-demolition asbestos survey |
| | `measured_survey` | Measured survey underlying `areas` — the evidence §15.9 limitation 4 said the bridge did not carry |
| | `higher_risk_building` | Competent confirmation of higher-risk-building status against the statutory criteria (audit §7.1) |
| | `fire_strategy` | Fire strategy for the converted building |
| | `acoustic_thermal` | Acoustic and Part L / EPC route confirmed for the conversion |
| | `services_mande` | M&E, drainage and utilities capacity confirmed |
| `construction` | `cost_plan_qs` | **Derived** (§23.3) — never entered; listed here so the category is complete |
| | `procurement_contractor` | Procurement route and contractor identified; contract form and price basis agreed |
| | `warranties_building_control` | Building control body and warranty provider appointed |
| | `insurance` | CAR and PI cover evidenced |
| `finance` | `facility_terms` | **Derived** (§23.3) |
| | `equity_sources` | **Derived** (§23.3) |
| | `sponsor_entity` | Developer / SPV, KYC and track record evidenced |
| | `tax_basis` | **Derived** (§23.3) — jurisdiction and VAT together |
| `exit` | `sales_evidence` | Comparable evidence or an agent's letter supporting the unit values |
| | `lender_valuation` | **Derived** (§23.3) |
| | `exit_route_evidence` | Evidence for the modelled exit: pre-sales, a take-out term sheet, absorption evidence |

- **Entered items: 23. Derived rows: 5.** `items[]` carries the 23 entered
  codes (each exactly once) plus any `custom` items; the five derived codes
  are **not** in `items[]` — they exist only on the result block, so no
  document can carry a stored status for a fact another field owns.
- The catalogue is route-agnostic (decision 4). A `sell_all` scheme marks
  nothing `not_applicable` under `exit` — `exit_route_evidence` is its
  pre-sales evidence; a `retain_all` scheme's is its take-out evidence.

---

## 6. §23.3 — Derived rows

Read-only rows on the result block, each computed from a field that already
carries evidence, with `source` naming the field. The mapping is normative:

| Row | Reads | `green` | `amber` | `unknown` | `red` | evidence printed |
|---|---|---|---|---|---|---|
| `tax_basis` | §14.6 + §17.10 | jurisdiction confirmed **and** §17.10's gate passes | — | otherwise | — | `jurisdiction_source`; the confirmed VAT categories |
| `facility_terms` | `finance.requires_confirmation` | `false` | — | `true` (migrated, unconfirmed) | — | — |
| `equity_sources` | `equity_sources[].evidence_status` | every source `confirmed` | — | any `unconfirmed` and none `rejected` | any `rejected` | count by status |
| `lender_valuation` | `lender_valuation` | present | — | `null` | — | `author`, `date`, `reason` |
| `cost_plan_qs` | `cost_plan.mode`, `cost_plan.qs` | detailed, `qs` present, status `issued` or `reviewed` | detailed, `qs` present, status `draft` | headline mode, or detailed with `qs` null | — | `qs.source`, `stage`, `date`, `status` |

- `tax_basis` reads **§17.10's own predicate** for the VAT half (material
  unconfirmed), not a new one — the dashboard must never disagree with the
  banner. When it shows `unknown`, §13.3's conditions 3 or 4 have already
  fired; the row is the same fact in the same colour.
- **Derived rows do not feed the seventh condition** (decision 7). The
  `tax_basis` row is gated by conditions 3–4 as today; `facility_terms`,
  `equity_sources` and `lender_valuation` gate nothing today and continue not
  to — this is stated as §23.11 limitation 3, and the memo prints their
  `unknown` beside the entered items in the same table so the reader sees it.
  Widening those gates is a behaviour change to R1's, R2's and §10's evidence
  semantics that no audit finding asks for; if the product owner wants it, it
  is one predicate in one place.

---

## 7. §23.4 — The derivation

A pure module, `due-diligence.ts` / `due_diligence.py`, shaped like
`monitoring`: it takes the inputs, the cost plan result, the VAT result, the
acquisition-tax result and the schedule (for the construction start month),
and returns the result block of §23.8. It is computed **once, in
`derive_metrics` / `deriveMetrics`**, exactly where `monitoring_statement` is,
and published on `AppraisalResultV2` — not on `Schedule`, because nothing in
the ledger reads it. No ledger balance enters it; nothing downstream reads it
except the provenance layer (§23.7) and the flags (§23.9).

**A pre-v13 document is computed through the same engine** (R10's
`cost_plan_from_legacy_costs` rule): a document with no `due_diligence`
attribute is read as the migration seed — the 23 catalogue items `unknown`,
no source record — so the v12 → v13 identity gate compares the result block
and the `due_diligence_unknown` flag on both arms and needs no exclusion.

For every item (23 entered, plus custom, plus 5 derived), in catalogue order
then custom items in `items[]` order:

```
rows = catalogue items (entered) ∪ custom items ∪ derived rows
category c:  red_c, amber_c, green_c, unknown_c, not_applicable_c   -- counts over rows in c
             total_c
totals:      the same sums over every row
entered_unknown_count   = unknown over ENTERED rows (catalogue + custom), derived excluded   -- the gate reads this
addressed_pct           = pct(entered rows not unknown, entered rows)                        -- the shared pct(), §1.2
cost_impact_total_pence = Σ cost_impact_pence over red and amber rows with a non-null impact
programme_impact_max_months = max programme_impact_months over red and amber rows with a non-null impact, else null
unassessed_impact_count = red and amber rows with either impact null
```

- **Programme impact is a max, not a sum.** Two three-month delays on the
  critical path may be sequential or concurrent; the schedule does not know,
  so it reports the largest single stated impact and prints "at least".
- **Cost impact is a sum**, over the items whose owner has stated one; the
  unassessed count is printed beside it so a total over three items is never
  read as a total over twelve.
- `not_applicable` is neither addressed nor unaddressed in the counts — it is
  its own column — but it **is** addressed for `addressed_pct` and for the
  gate: someone evidenced that it does not arise.

---

## 8. §23.5 — The source record and source-conflict flags

`source_record` is written by the document's **default builder** from the
project it is given — `default_calculator_inputs_v2(project)` and
`defaultCalculatorInputsV13(project)` both already take the project — and
by a "Re-capture from listing" action on the DD page that copies the same
five fields and stamps `captured_at` client-side. The migration writes
`null`: a stored document has no project record in hand and inventing one
would be inventing evidence.

Two conflict rules, evaluated only when `source_record` is non-null, each
raising the flag `source_conflict` (red) with a sentence naming both sides:

1. **Occupation.** `source_record.is_vacant === false` and the
   `vacant_possession` item's status is `green` — *"The listing records the
   property as occupied; vacant possession is marked green. Evidence the
   surrender or correct the status."*
2. **Existing area.** `source_record.floor_area_sqm > 0`,
   `areas.existing_gia_sqm > 0`, and `|existing_gia − listing| / listing >
   0.25` — *"The listing's floor area differs from the entered existing GIA by
   more than 25%."* The 25% threshold is the one §15.6 retired from the
   unit-NIA check; reusing it keeps the product to one materiality figure for
   area disagreement.

**What this does and does not catch.** Rule 1 fires when the scraper
structured the occupation fact. For York the listing's `is_vacant` was never
structured — the fact is in prose — so no conflict rule can see it, and the
design says so rather than pretending a regex is evidence. What catches York
is decision 8: `vacant_possession` is seeded `unknown`, the document is DRAFT
under *"DUE DILIGENCE INCOMPLETE"* until someone evidences it, and the DD page
shows the listing's description beside the item they are evidencing. The
contradiction stops being silent the moment the model refuses to assume
vacancy.

A `source_record` that is `null` prints in the memo as a limitation ("no
listing record captured; source-conflict checks did not run") — the absence is
disclosed, not hidden.

---

## 9. §23.6 — QS provenance and the price basis

Detailed mode only. The result's `cost_plan` block gains:

```
price_basis: null | {                          -- null in headline mode
  fixed_price_pence, provisional_sums_pence, estimate_pence, unclassified_pence   -- Σ amount_pence by package price_basis
  fixed_price_coverage_pct  = pct(fixed_price_pence, base_build_pence)
  provisional_sums_pct      = pct(provisional_sums_pence, base_build_pence)
}
qs: the input block republished, or null
```

- **Coverage is a share of base build**, the same base §16.3's `general`
  class takes, so the two percentages a QS reviewer reads sit on the figure
  the contingency sits on.
- **Unclassified packages count against coverage.** A migrated detailed plan
  has every package at `price_basis: null`, so its coverage is 0% and its
  `unclassified_pence` is the whole base build — the honest statement of what
  was recorded, and the figure that moves as packages are classified.
- **No threshold flag on provisional sums.** `provisional_sums_present`
  (amber) fires on any non-zero total and prints the figure and share; the
  audit names no materiality and this release invents none.
- **§13.4's cost-basis bullet becomes conditional.** In detailed mode with
  `qs` present the report prints *"priced by {source}, {stage}, dated {date},
  status {status}"* and may drop the "QS evidence is not recorded" sentence;
  with `qs` null it keeps it. Headline mode is unchanged. The memo's
  construction section prints the QS line, coverage, provisional sums and each
  provisional or estimated package's `notes` as its exclusions.

---

## 10. §23.7 — The draft gate

`DraftReason` gains `'due_diligence_incomplete'`, ordered immediately after
`'vat_basis_unconfirmed'` and before `'not_approved'` — §13.3's list becomes
seven, with conditions 5 and 6 renumbered 6 and 7. Banner:

```
DRAFT - DUE DILIGENCE INCOMPLETE - NOT FOR LENDER RELIANCE
```

Predicate: `due_diligence.totals.entered_unknown_count === 0`. `buildProvenance`
takes it as a fourth gate input beside the tax and VAT bases, computed by
`dueDiligenceGateFor(run)`. **A document with no `due_diligence` key at all
is not re-graded** — `taxBasisConfirmedFor`'s R8 rule, for R8's reason: a
raw v4 document handed straight to `runAppraisal` in a test offered its
author no field to fill, so its silence cannot be graded; every production
entry point migrates to v13 before running, so every stored document *is*
graded. The engine still seeds and reports the 23 unknowns for such a
document (§23.4) and the amber flag still fires; only the FINAL condition
exempts it, and the existing release-gate FINAL routes (v4 `sellAllInputs`)
stay FINAL on exactly that basis;
`provenance.py`'s `draft_reason` mirrors the ORDERING and takes
`due_diligence_complete` as a keyword — the predicate and the no-key exemption
live in `report-provenance.ts` alone, with no Python helper;
`DRAFT_REASON_SENTENCE` and
`WATERMARK_TEXT` are `Record<DraftReason, string>`, so the compiler requires
both texts (§17.10's precedent).

- **Why this position.** An `unknown` does not make a figure wrong, so it must
  not outrank the two reasons that say figures may be. It must outrank
  `not_approved` because an approval read over an unevidenced title is the
  R14b stale case's cousin: the reader would draw the wrong conclusion from
  the approval alone.
- **The diagonal test gains a row.** A document that is report-safe,
  repaying, tax- and VAT-confirmed, with an approved current case and one
  `unknown` item, reports `due_diligence_incomplete`; evidencing that item
  makes it FINAL. Pinned in both languages.
- **The consequence for every existing document is accepted, not worked
  around** (§14.6's precedent): a migrated document carries 23 `unknown`
  items and shows this banner as soon as its tax and VAT bases are confirmed,
  until every entered item is evidenced or marked not applicable with a
  reason. The release-gate FINAL fixture (§13.3's last bullet) must therefore
  carry a fully addressed schedule, and does — the first FINAL document with an
  evidenced due-diligence position.

---

## 11. §23.8 — Outputs and reporting

### The result block

`AppraisalResultV2` gains `due_diligence`, computed once in
`derive_metrics` / `deriveMetrics` exactly as `monitoring_statement` is; never
null (§23.4's pre-v13 seed).

```
DueDiligenceResult:
  rows: Array<{ id, code, category, label, kind: 'entered' | 'custom' | 'derived',
                status, evidence: DdEvidence | null, expiry_date, owner, due_date,
                cost_impact_pence, programme_impact_months, action, notes,
                source: string | null }>                 -- derived rows: the field read; else null
  categories: Array<{ category, red, amber, green, unknown, not_applicable, total }>   -- six, in order
  totals: { red, amber, green, unknown, not_applicable, total,
            entered_unknown_count, addressed_pct,
            cost_impact_total_pence, programme_impact_max_months, unassessed_impact_count }
  source_record: SourceRecord | null                     -- republished
  source_conflicts: Array<{ rule: 'occupation' | 'existing_area', statement: string }>
  consent_expiry: { expiry_month, construction_start_month, expires_before_start } | null
                                                         -- null unless planning_route has an expiry AND acquisition_date is set
```

### Surfaces

- **Page 13** is renamed **Due Diligence** and gains the schedule editor above
  the existing risk register: six category groups, each row with the status
  select (seeded `unknown`, coloured; `not_applicable` grey), evidence
  source / reference / date, expiry date, owner, due date, cost impact (£),
  programme impact (months), action, notes; derived rows rendered read-only
  with their source field named; an "Add item" per category for `custom`
  rows; the category counts and `addressed_pct` read from the run; the
  source-record card with "Re-capture from listing" and, under
  Title/Occupation, the project's `description` and `current_use_description`
  as read-only context. Validation messages surface per row through the
  existing field-keyed issue map.
- **Page 4 (Costs)**, detailed mode: a QS provenance card (source, stage,
  date, status, base date, with a "No QS recorded" toggle for `null`) and a
  `price_basis` select on every package row; coverage and provisional-sum
  figures read from the run.
- **Reconciliation strip**: the new banner text; the four flags.
- **Deal spider**: `buildingSafetyBand` is unchanged; the axis is marked
  provisional with the note *"screening only — higher-risk-building status
  not competently confirmed"* unless the `higher_risk_building` item is
  `green` or `not_applicable` (audit §7.1's "retain the prompt, require
  confirmation").
- **Memo §9** is retitled **Due Diligence and Risk**: a category summary table
  (six rows × five counts), the schedule table (category, item, status,
  evidence source · reference · date, expiry, owner, due, cost impact,
  programme impact, action — derived rows marked), the impacts sentence
  (*"stated cost impact £X across N items, at least M months, K items not yet
  assessed"*), each `source_conflict` as an `infoRequired` line, the
  source-record line (captured from … on …, or the not-captured limitation),
  then the existing risk-register table as the project log. The nine-phrase
  text-match and its "Risks not yet addressed" line are deleted. **Memo §3**
  gains two sentences read from the schedule — the planning position with
  reference, decision and expiry, and the vacant-possession status.
  **Appendix B** replaces "Risk register gaps" with *"Due diligence: N items
  unknown — …"* listing the codes. **§13 limitation 5** is rewritten as the
  conditioned sentence: *"N of 23 due-diligence items remain unknown"* or
  *"every due-diligence item is evidenced or marked not applicable"*.
- **Memo §5's construction sub-section** prints the QS line (§9 above).
- **No workbook** (§22.10 limitation 9 stands).

---

## 12. §23.9 — Validation and flags

Input errors, keyed `due_diligence.items[i].<field>` and `cost_plan.<field>`:

1. Every entered catalogue code appears **exactly once**; a derived code in
   `items[]`, a missing code, a duplicate, and an unknown code are four
   messages. `custom` items require a non-empty `label` and a category in the
   enum. Ids unique.
2. `status = green` requires `evidence` non-null with `source` and `date`
   non-empty.
3. `status = red` or `amber` requires `action` non-empty.
4. `status = not_applicable` requires `notes` non-empty.
5. Every date present (`evidence.date`, `expiry_date`, `due_date`, `qs.date`,
   `qs.base_date`) is ISO `yyyy-mm-dd` and a real calendar date — the same rule
   `acquisition_date` is held to (§14), reused rather than re-stated.
6. `cost_impact_pence` null or an integer `>= 0`; `programme_impact_months`
   null or an integer `>= 0`.
7. `source_record`, when present: `captured_at` non-empty;
   `floor_area_sqm` null or `>= 0`; `lease_years_remaining` null or an
   integer `>= 0`; `tenure` in the enum or null.
8. `cost_plan.qs` non-null in headline mode is an error (§17.1's shape);
   when present, `source` non-empty and `stage`/`status` in their enums.
9. `price_basis` in the enum or null.

Flags (result-derived; none is an error):

| Code | Severity | Fires when |
|---|---|---|
| `due_diligence_unknown` | amber | `entered_unknown_count > 0`; names the count |
| `source_conflict` | red | any §23.5 rule; one flag per rule, carrying its statement |
| `consent_expires_before_start` | red | `planning_route.expiry_date` non-null, `acquisition_date` non-null, and `months_between(acquisition_date, expiry_date) < construction_start_month` |
| `provisional_sums_present` | amber | detailed mode and `provisional_sums_pence > 0`; names the figure and share |

`months_between(a, b)` is whole months, floored: `(y_b − y_a) × 12 + (m_b −
m_a) − (1 if d_b < d_a else 0)`; a negative result is a lapse before
acquisition and always fires. `construction_start_month` is the resolved
start of the earliest `construction`-coded phase when `programme` is a network
(§18.2), else `programme.packages.construction.start_offset` when a curve
programme is present (§6.1), else `0` (§6's default profile starts the
construction spend at month 0). The Python and TS helpers are mirrored and
pinned on a leap-day pair.

---

## 13. §23.10 — Migration and the persistence boundary

```
v12 due_diligence: (absent)          →  v13 { source_record: null,
                                              items: [23 catalogue items: id 'dd-<code>', status 'unknown',
                                                      evidence null, expiry_date null, owner '', due_date null,
                                                      cost_impact_pence null, programme_impact_months null,
                                                      action '', notes ''] }
v12 cost_plan.qs: (absent)           →  v13 null
v12 cost_plan.packages[].price_basis →  v13 null      (every package)
```

Every addition is inert to every money figure. `is_v13` discriminates on
`inputs_version == 13 && 'due_diligence' in doc`; `migrate_v12_to_v13`
refuses a v13 document; `migrate_inputs_to_v13` is the structural copy of
v12's; `parse_calculator_inputs` gains the v13 branch first.

**The migration moves no computed value.** The numeric identity gate runs the
same code over a v12 document and its migrated v13 twin, corpus-wide in both
engines, and requires equality of every money figure and every pre-existing
flag; the v13 flags cannot fire on a migrated document (no source record, no
expiry, no provisional sums, and `due_diligence_unknown` is the one flag every
migrated document *does* raise — the gate asserts that code is **present by
name** on every migrated document, per fixture, in both engines, so an emptied
or narrowed seed fails it rather than passing vacuously). The validation side is §19.9's three properties: every v12
issue has a v13 counterpart; §23.9's rules raise nothing on a migrated
document; a control document (a catalogue code missing) trips a v13-only rule.

**What moves for a stored document:** its `input_hash` on the next save (every
inputs bump; §13.2's disclosure), and therefore any approved lender case goes
**stale** on that save (§21.3) — the correct answer, because the snapshot the
case locked had no evidence position and the re-saved one has 23 unknowns.
Recorded in `migration-notes.md` §16 so nobody reads a stale case after this
release as a defect.

**The entry-point cutover to v13** — `app.py`, `defaultCalculatorInputsV13`,
the client's `migrateInputsToV13`, the default builders' source-record capture
— is its own task, **last**, guarded by both entry-point tests.

---

## 14. §23.11 — Stated limitations

1. **Prose is not compared.** Source-conflict rules read the listing's
   structured fields only; a contradiction that lives in `description` is
   caught by the `unknown` gate and the appraiser, not by the engine.
2. **Two conflict rules.** Occupation and existing area. Tenure, lease term
   and use class are captured and printed but compared to nothing, because the
   appraisal carries no typed counterpart to compare them with (decision 2).
3. **Derived rows do not gate.** `facility_terms`, `equity_sources` and
   `lender_valuation` show `unknown` without making the document DRAFT; each
   keeps the semantics its own release gave it.
4. **No due-date or overdue logic.** `due_date` is recorded and printed;
   nothing compares it to a date, because the engine has no clock (§1.4).
5. **Impacts are stated, not modelled.** `cost_impact_pence` and
   `programme_impact_months` enter no ledger and no lever (decision 15).
6. **No inflation** — R15b, decision 12. `qs.base_date` is recorded for it.
7. **No per-package provenance.** One QS block covers the whole detailed
   plan; a plan priced by two firms records one.
8. **Per-row sales evidence remains unmodelled.** §22.10 limitation 7 narrows
   to: reservation and exchange evidence is scheme-level (`exit_route_evidence`),
   not per `unit_sales` row.
9. **Fee lines carry no provenance** (decision 11).
10. **The catalogue is fixed by release.** Adding a code is a schema change
    with a migration seeding it `unknown`; there is no user-defined catalogue,
    only `custom` rows.

---

## 15. Fixture Y — `y-due-diligence`

**Fixture X's document, unchanged in every money field**, plus the evidence
layer: X is already a detailed-mode cost plan with a network programme whose
`construction` phase starts at month 4 and an `acquisition_date` of
2026-09-01. Y adds a captured source record with `is_vacant: false` and a
listing area of 360 m² against an entered existing GIA of 600 m² (manual
basis, so no cost moves), turns X's one equity source `unconfirmed` (still
committed under §2 — no money moves), and carries a schedule exercising every
status. Because no arithmetic changes, **Y's money pins are X's, copied**,
and the inertness guard asserts the equality directly:

| Feature | Setting | What it pins |
|---|---|---|
| `vacant_possession` | `green`, evidenced | conflict rule 1 fires |
| `areas.existing_gia_sqm` vs listing | 40% apart | conflict rule 2 fires |
| `planning_route` | `green`, `expiry_date` 2 months after acquisition | `consent_expires_before_start` fires (2 < 4) |
| `title_report` | `red`, cost impact set, programme impact set, action | totals |
| `structural_survey` | `amber`, cost impact null | `unassessed_impact_count` |
| `party_wall`, `rights_of_light` | `not_applicable` with notes | the column, and that they count as addressed |
| three items | `unknown` | `entered_unknown_count 3`, `addressed_pct` by hand, `due_diligence_unknown` |
| one `custom` item under `existing_building` | `amber` with action | custom rows in the counts |
| packages | X's three: `structure` `fixed_price`, `envelope` `provisional_sum`, `mech_elec_public_health` `null` | coverage 46.15%, provisional 30.77%, unclassified 6,000,000 by hand; `provisional_sums_present`; the `estimate` basis is exercised in the unit tests |
| `qs` | `riba_3`, `issued` | derived `cost_plan_qs` green |
| equity | one `unconfirmed` | derived `equity_sources` unknown, and the document still not gated by it |

Pins, hand-derived in the plan against the constructed document (R10's
reachable-literals rule): every category's five counts, the totals block,
`addressed_pct`, `cost_impact_total_pence`, `programme_impact_max_months`,
`unassessed_impact_count`, the coverage block to the penny and the percentages
through the shared `pct()`, the three flags with their statements, the two
source-conflict statements, `report_safe` true, and — because nothing here is
arithmetic — `gdv_pence`, `total_development_cost_pence` and `profit_pence`
**equal to the same document with `due_diligence` reset to the migration seed
and `price_basis` all null**, proving the block is inert to money.

Its FINAL twin lives in `memo-fixtures.ts`, not as a second golden fixture:
every entered item `green` with evidence or `not_applicable` with a reason,
no source record conflicts, an approved current case — the release-gate
document.

Registered in every fixture roster: `EXPECTED_FIXTURE_STEMS` on both sides,
`test-cases.md`, `migration-notes.md`, `memo-fixtures.ts`.

---

## 16. Guards this release must watch fail

| Guard | What must fail first |
|---|---|
| **Catalogue identity** | the 28 (code, category, label) triples byte-identical across engines; a reordered or relabelled entry fails |
| **Both-directions coverage** | a missing code, a duplicate, a derived code in `items[]`, an unknown code — four distinct messages |
| **Green needs evidence** | `green` with `evidence: null`, and with `source: ''` — rejected; with source and date — accepted |
| **Red/amber need an action; n/a needs a reason** | one negative and one positive each |
| **Unknown gates, red does not** | the diagonal row: one `unknown` → `due_diligence_incomplete`; the same document with that item `red` + action → FINAL |
| **Gate ordering** | tax-unconfirmed + one unknown → `tax_basis_unconfirmed`; VAT-unconfirmed + one unknown → `vat_basis_unconfirmed`; all confirmed + one unknown + no case → `due_diligence_incomplete`, not `not_approved` |
| **Derived rows do not gate** | fixture Y's `unconfirmed` equity source: dashboard row `unknown`, `entered_unknown_count` excludes it; a twin with the three entered unknowns evidenced reaches FINAL with the equity row still `unknown` |
| **Derived-row mapping** | each of the five rows through each of its statuses by a one-field change |
| **Rollups by hand** | fixture Y's category counts, totals, `addressed_pct`; `not_applicable` counted addressed |
| **Impact totals** | sum over assessed red/amber only; a `green` with an impact contributes nothing; max not sum for months; `unassessed_impact_count` |
| **Conflict rule 1** | Y fires; the twin with `is_vacant: null` does not; the twin with `vacant_possession: amber` does not |
| **Conflict rule 2** | Y fires; a twin at exactly 25% does not (strict) |
| **No source record, no conflicts** | Y with `source_record: null` raises neither, and prints the not-captured limitation |
| **Consent expiry** | Y fires at 2 < 4; a twin with expiry 4 months out does not; `acquisition_date: null` never fires; the leap-day pair for `months_between` |
| **Price basis** | Y's coverage block by hand; a twin with the `null` package classified `fixed_price` moves coverage by that package's share; headline mode → `price_basis: null` |
| **QS in headline mode** | rejected; detailed accepted |
| **Money inertness** | Y vs its schedule-reset twin: `gdv`, TDC, profit, peak debt identical on absolute figures |
| **Migration identity** | same code, v12 document vs its migrated v13 twin, every money figure and every pre-existing flag equal corpus-wide; `due_diligence_unknown` the named sole addition |
| **Null-path identity to 2.14.0** | every pre-existing golden pin unchanged |
| **§1.6 version list** | requires v13 |
| **Memo** | §9 carries fixture Y's counts and both conflict lines; the nine-phrase text-match is gone (a `risks[]` row reading "planning is fine" no longer satisfies anything); §3 prints the planning reference and expiry; §13 limitation 5 is the conditioned sentence; the FINAL twin renders FINAL |
| **Spider caveat** | provisional with the HRB note unless the item is green/n-a |
| **Message drift** | `test_validation_messages_match_the_typescript_engine`'s window start moves from the `investment_case` block to the `unit_sales` block, so §22.7, §19.7 and §23.9 (placed immediately before the jurisdiction block) are all inside it; the §22.7 messages the widened window shows to differ (TS em-dash, Python hyphen) are aligned by editing the **Python** strings to the TS text verbatim — a wording change with no behaviour change, so the identity gate is untouched |
| **Unit-sales identity** | `unit_sales.totals.gross_pence == totals.gross_sales_pence` on fixture X and corpus-wide where non-null |
| **Entry points** | both engines' entry-point guards pass only once every production call site names v13; the default builders capture the source record from a project |

**Deliberately not written**, because they would be vacuous: `total = red +
amber + green + unknown + n/a` (true by construction); every enum value is in
the enum (the type guarantees it); a derived row's `source` string (a label).

---

## 17. Also in scope

- The R13b backlog pair (§16's last two guards).
- Spec edits: §23; §1.5; §1.6; §13.3 (seven conditions, the table row, the
  renumbered mutual-exclusion bullet); §13.4 (conditional QS sentence;
  limitation list); §14.6 and §17.10 (a sentence each naming the derived
  row); §15.9 limitation 4 and §16.9 limitation 3 as history; §16.9's new
  inflation line naming R15b; §22.10 limitation 7 narrowed; the changelog
  line for 2.15.0.
- `migration-notes.md` §16 (v12 → v13, the identity claim, the stale-case
  consequence, the York appraisal after R15: 23 unknowns, DRAFT for due
  diligence); `test-cases.md` fixture Y worksheet; `model-governance.md` §3.1
  version row; the release plan's R15 status paragraph and the new **R15b**
  row.

## 18. Out of scope

Inflation and the per-package programme (R15b); a risks-crystallise lever
(R16 presets); due-date/overdue logic; gating on derived rows; text comparison
of listing prose; per-fee-line or per-package QS provenance; per-row sales
evidence; a user-defined catalogue; the ScenariosPage inputs for the R12/R13
override fields (R16).

---

## 19. Shape of the work

Roughly seventeen tasks, in five bands, then the cutover:

1. **Schema and migration** — v13 types in both engines (`due_diligence`,
   `cost_plan.qs`, `price_basis`), the catalogue literal with its identity
   test, `is_v13`/`migrate_v12_to_v13`/`migrate_inputs_to_v13`, the numeric
   gate, property 1.
2. **The engine** — `due-diligence.ts` / `due_diligence.py` (rollups,
   derived rows, conflicts, `months_between`), the cost plan's price-basis
   block, `Schedule`/`AppraisalResultV2` wiring, validation with properties 2
   and 3, the four flags, fixture Y.
3. **The gate** — `DraftReason`, both provenance modules, the diagonal rows,
   the release-gate FINAL twin.
4. **Surfaces** — the DD page (editor, derived rows, source-record card,
   re-capture), the Costs page QS card and `price_basis` select, the strip,
   the spider caveat.
5. **Documents** — memo §3/§5/§9/Appendix B/§13, the spec edits, the
   governance documents, the release plan with R15b.

The entry-point cutover to v13 is its own task, at the end.
