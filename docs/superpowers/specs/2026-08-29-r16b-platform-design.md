# Release 16b — The platform half design

**Date:** 29 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§6.4 (*"stale legacy columns should be removed, clearly deprecated or
backfilled so that downstream API consumers cannot select the wrong
figure"*), §11's three P2 rows *"Thirteen-tab workflow is long — Reorder and
group stages; add completion/evidence status"*, *"Main bundle is large —
Lazy-load PDF/maps/charts and split vendor chunks"* and *"Legacy stored
columns can mislead API consumers — Deprecate/backfill/remove or expose one
canonical output contract"*, and §10 item 2 (*"Group thirteen equal tabs into
Input, Funding, Exit, Underwriting and Output stages"*); spec §16.3's
deprecation note (*"`conversion_costs.contingency_pct` is deprecated exactly
as `sdlt_pence` was in R8: retained so pre-R10 readers keep working, removed
in R16b"*); both engines' result comments on `sdlt_pence` (*"Removed in
R16"*); the R15b design's out-of-scope line (*"a per-month lender-eligible
column on the Cash-flow page (it has no per-category columns today)"*); and
the R16 design's §2 split, which named this release and did not design it.

**Release-plan row, restated by this design.** The plan's R16b row reads
*"Platform: UX stage grouping and URL-routed calculator pages, the bundle
split, legacy stored columns / `sdlt_pence` / `conversion_costs.contingency_pct`
/ the eight legacy fee fields, the cash-flow page's eligibility column — P2 —
inputs v16, Alembic 007, **no calc bump expected**"*. The last clause is
wrong, for the same reason the original R16 row's *"no schema move"* was
wrong: removing `sdlt_pence` from the **result** changes every document's
`outputs` shape, so `outputs_hash` and therefore `audit_hash` move for
identical inputs, and §1.6 says outputs are only comparable within a
`calc_version`. **calc `2.17.0` → `2.18.0`, inputs `v15` → `v16`, Alembic
`007`, spec §26.** No computed figure moves; the identity gate asserts that
on every fixture. Only the field list shrinks.

**Specification:** the calculation specification gains **§26**; **§1.6**
gains v16 and 2.18.0; the `sdlt_pence` notes in **§3** and both engines'
result types close; **§16.3** and **§16.7**'s "removed in R16b" becomes a
statement of fact; **§24.9** records the column as delivered; **§25.5**'s
parenthetical rule becomes per-half. `migration-notes.md` gains **§19** (v15
→ v16).

---

## 1. The problem this release exists to solve

### 1.1 Two places for every headline figure

`financial_appraisals` carries seven summary columns — `gdv_pence`,
`total_cost_pence`, `profit_on_cost_pct`, `profit_on_gdv_pct`,
`return_on_equity_pct`, `irr`, `rlv_pence` — beside the `outputs` JSON that
holds the same seven figures under their authoritative names. Since R1 both
are written by the same server run, so they never disagree at the moment of
writing; but they are two places for one fact, the column names are not the
result's names (`total_cost_pence` is `total_development_cost_pence`; `irr`
is `irr_annual_pct`), and a consumer who selects a column has no way to know
it is reading a figure whose calc version is the row's, not the current one.
The audit's §6.4 York record showed exactly that. Two readers still exist in
the client: `ProjectDetail.tsx`'s null-`outputs` fallback and
`export-pdf.ts`'s appraisal PDF.

### 1.2 Nine input fields nothing reads, and one result field one thing reads

R10 copied `conversion_costs.contingency_pct` into `cost_plan.contingency`
and the eight legacy fee fields into `cost_plan.fee_lines[]`, and routed every
document through the cost-plan engine. From v7 on, the nine source fields
are dead on every document: the only readers are the v6 → v7 seed
(`costPlanFromLegacyCosts` / `cost_plan_from_legacy_costs`), the engine's
fallback for a document with no `cost_plan` block, and the v1 facility
bootstrap (`conversion-calc-engine.ts` / `legacy_costs.py`). All three read
the **pre-v7** shape, which is the shape they should be typed against. The
fields still validate (nine non-negativity rows in each engine's
`NON_NEGATIVE_MONEY`) — an error on a field the computation ignores.

R8 left `sdlt_pence` on the result as a jurisdiction-neutral figure under an
England/NI-only name, equal to `acquisition_tax_pence`, with a comment
promising removal. One live reader remains: `deal-spider.ts`'s cost-ex-land
figure. Fifteen golden fixtures pin the key.

### 1.3 Sixteen equal tabs, no address, one bundle

`ConversionCalculator.tsx` holds `activePage` in component state. There is no
URL for a page: a reviewer cannot be sent to the Sensitivity page, a reload
lands on Acquisition, and the browser's back button leaves the calculator.
The sixteen tabs are flat and equal, so the workflow's shape — enter, fund,
exit, underwrite, output — is invisible, and the audit's ask for a
completion signal has nowhere to sit. The production entry chunk is 1,646 kB
(491 kB gzip) because `jspdf`, `xlsx` and `leaflet` are static imports of
pages the user may never open.

### 1.4 The one ledger column R15b built and did not show

§24.4's per-month `lender_eligible_construction_pence` sits on every
`Schedule.uses[]` entry in both engines, drives §4.2(b), and is printed
nowhere on the cash-flow page. R15b deferred it as page work.

---

## 2. Scope

| | In | Out |
|---|---|---|
| **Persistence** | Alembic 007 drops the seven columns; ORM, repository, response model, `calculate_authoritative`, `types.ts` and the two client readers lose them | Backfilling on downgrade; any change to `validation.client_mismatches` or to the Create payload's optional client-computed fields |
| **Inputs v16** | Nine keys deleted from `conversion_costs`; `ConversionCostInputsV16`; both migrations; identity gate; entry-point cutover | Touching `construction_cost_per_sqm_pence`, `total_construction_sqm` or the three compliance fields (headline mode reads them live); the v1 `ConversionCostInputs` type (the bootstrap's shape) |
| **Result** | `sdlt_pence` removed from `AppraisalResultV2` both engines; calc 2.18.0; fifteen fixtures re-pinned for shape | Any other result field |
| **Calculator** | `/projects/:id/calculator/:page?`; five stages; Exit moves to 9; validation-derived badges with a pinned ownership table | One route element per page with a lifted store; warning-count badges; renaming `CalcPage` keys |
| **Bundle** | Three dynamic seams; `build.manifest`; a post-build gate script with a stated ceiling | A `manualChunks` vendor policy; touching the report-QA harness |
| **Cash-flow page** | The conditional *Eligible build* column and its disclosure line | A per-package ledger (§24.9 limitation 3 stands) |
| **Carried** | The five R16 follow-ups (§14) | The R16 design's other named deferrals (named-unit lever, configurable pack, DSCR floor, API endpoint) |

---

## 3. Decisions taken at design time

1. **The result-shape change is a calc bump.** A removed output field is a
   contract change under §1.6's comparability rule, and an `audit_hash` that
   moves under an unchanged `calc_version` would falsify §13.2. 2.18.0.
2. **Drop the columns; keep the mismatch check.** The Create payload's
   optional client-computed figures are never persisted — they are diffed
   into `validation.client_mismatches`, the production cross-engine parity
   detector — so they stay, unchanged, under their existing names.
3. **One route element, not one per page.** `/projects/:id/calculator/:page?`
   is a single `<Route>`; a `:page` change re-renders the calculator rather
   than remounting it, so unsaved inputs survive navigation by construction.
   This is asserted, not assumed (§9).
4. **Exit moves ahead of Appraisal.** Its inputs (route, retained units,
   phasing, refinance, investment case, unit-sales ledger) feed the
   appraisal; contiguous stages require it; the numbers 9–13 move.
5. **Badges count errors, from validation, filtered by ownership.** Nothing
   new is computed. The ownership table is normative and exhaustively pinned
   at both ends.
6. **Ownership follows the editor, not the block's name.** `deal_spider.*` is
   edited on the Appraisal page, so Appraisal owns it; `lender_valuation.*`
   and `monitoring.*` are edited on Finance, so Finance owns them.
7. **The gate walks the manifest's static closure.** A byte ceiling alone
   would pass a build that moved jspdf into a second statically-imported
   chunk; a banner scan alone would pass a bloated entry. Both are asserted.
8. **The removed validation rules are a named exception, not a relaxation.**
   The v15 → v16 validation gate keeps R12's three-property form and lists
   the nine v15-only rules as exactly nine, the inverse of R12's one v9-only
   rule.
9. **The single-accessor guards on `contingency_pct` stay.** Their subject
   still exists on the v1 shape and their allowlisted readers still run; R11
   showed a guard can die by having its subject refactored away, and this
   subject is only narrowed, not gone.
10. **`isV16` is a structural check, not a tag.** A document tagged 16 that
    still carries `contingency_pct` is refused, as every `isV{N}` since R8
    has refused a spoofed relabel.
11. **The Python round trip checks the stored JSON.** `Model` ignores extras,
    so a parsed `ConversionCostInputsV16` would hide a legacy key that the
    stored snapshot still carried.
12. **The eligibility column is conditional, like NOI and refinance.** It
    appears only when a month's eligible figure differs from its construction
    figure — the document carries an ineligible package — and its absence on
    a fully-eligible document is asserted.

---

## 4. §26.1 — Inputs v16

```
conversion_costs (v16):
  construction_cost_per_sqm_pence  int   -- headline mode's rate; the construction_cost lever's target
  total_construction_sqm           float -- the manual-basis area, behind §15.4's accessor
  fire_safety_pence                int   -- headline mode's compliance line (§16.4)
  sound_insulation_pence           int
  part_l_compliance_pence          int
```

Removed: `contingency_pct`, `prior_approval_fee_per_dwelling_pence`,
`cil_s106_pence`, `architect_pence`, `structural_engineer_pence`,
`mande_pence`, `planning_consultant_pence`, `building_control_pence`,
`other_professional_fees_pence`. `cost_plan.contingency` and
`cost_plan.fee_lines[]` have been the only readers' source since v7 (§16.3).

**Types.** `ConversionCostInputsV16` is a new interface / pydantic model
carrying the five fields; it is not a subclass of the v1 `ConversionCostInputs`
(a subclass cannot remove fields). `CalculatorInputsV16` extends V15 and
narrows `conversion_costs` to it — in TypeScript via
`Omit<CalculatorInputsV15, 'inputs_version' | 'conversion_costs'>`, in Python
by field override on the subclass so the engine's `isinstance` dispatch keeps
working (the reason every `CalculatorInputsV{N}` subclasses its predecessor).
`AnyCalculatorInputs` gains V16 in both engines.

**The three legitimate readers keep the v1 shape.** `costPlanFromLegacyCosts`
/ `cost_plan_from_legacy_costs` take `ConversionCostInputs` (v1) and are
called from the v6 → v7 migration and from the engine's no-`cost_plan`
fallback; `costPlanOf` narrows to the pre-v7 members of the union before the
fallback, so a v16 document cannot reach it and `tsc` says so. The v1
facility bootstrap (`conversion-calc-engine.ts`, `legacy_costs.py`) is
unchanged.

**Defaults.** `defaultCalculatorInputsV16` = `migrateV15toV16(defaultCalculatorInputsV15(...))`,
the construction every default since v7 has used, pinned field-for-field in
`conversion-defaults.test.ts` against the migration of the v15 default.

**Validation.** The nine `NON_NEGATIVE_MONEY` rows on the removed fields and
the standalone `conversion_costs.contingency_pct` "cannot be negative" rule
are deleted from both engines. The detailed-mode rule that `fire_safety_pence`
must be zero stays — its field stays.

**Guards.** The eslint and Python single-accessor selectors on
`contingency_pct` and their allowlists are unchanged (decision 9).

---

## 5. §26.2 — The result shape (calc 2.18.0)

`AppraisalResultV2` loses `sdlt_pence` in both engines. `acquisition_tax_pence`
has carried the identical value since R8; `deal-spider.ts`'s cost-ex-land
figure reads it. Fifteen golden fixtures under `fixtures/financial-model/`
pin the key and are re-pinned by deleting it — a shape re-pin, with the
identity gate (§10) proving no value moved. `CALC_VERSION` is `2.18.0` in
both engines; `spec-versions.test.ts` and `test_financial_model_types.py` follow it.

---

## 6. §26.3 — One canonical persistence contract

`financial_appraisals` loses the seven summary columns. `outputs.metrics` is
the only place a headline figure is stored, under the result's own names.

**Alembic 007** drops the seven columns inside `op.batch_alter_table`, so the
SQLite smoke tests and Postgres both run it; `downgrade` re-adds them as
nullable columns and leaves them null — the figures are derivable from
`outputs` and were never entered. `test_alembic_migrations` pins the chain as
`["007", "006", …, "001"]`; the health endpoint's head comparison follows.

**Server.** `FinancialAppraisalORM`, `repositories.py`'s row → model mapping,
the `FinancialAppraisal` response model and `calculate_authoritative`'s
returned dict lose the seven keys. `FinancialAppraisalCreate`'s optional
client-computed fields, `CLIENT_METRIC_MAP`, and the `client_mismatches`
recording are unchanged (decision 2).

**Client.** `types.ts`'s `FinancialAppraisal` loses the seven fields.
`ProjectDetail`'s key-metrics block reads `outputs.metrics` or, when
`outputs` is null, shows *"Not yet recalculated — open and save the appraisal"*
in place of figures; it no longer has a second source to fall back to.
`export-pdf.ts`'s appraisal PDF reads `appraisal.outputs.metrics` and prints
"N/A" per line when `outputs` is null, exactly as it did for a null column.

---

## 7. §26.4 — The cash-flow page's eligibility column

The page gains an **Eligible build** column after *Costs (VAT-incl.)*, reading
`run.schedule.uses[i].lender_eligible_construction_pence` for the ledger row
`model.months[i]`. The two arrays are the same length and in the same order —
`Schedule.uses` is built over `term` and the ledger over the same term — and
the page asserts `uses.length === months.length` in a test rather than
assuming it, because a misaligned column would print a real figure against
the wrong month.

The column is shown only when some month has
`lender_eligible_construction_pence !== construction_pence` — the document
carries an ineligible package (§24.4). Beside the totals, when shown, a
disclosure line prints *"Lender-eligible build: £X of £Y"* where X = Σ
`lender_eligible_construction_pence` and Y = Σ `construction_pence` over
`uses[]`, sums of engine figures with no derivation of its own. Fixture S is
the document that shows it. Exactly four corpus fixtures carry an ineligible
package — `q-detailed-cost-plan`, `s-dated-programme`, `w-monitoring-on-site`,
`z-cost-plan-in-time` — asserted by name; **Q is one of the four**, not the
fully-eligible witness, so the column's absence is asserted on fixture A
(`a-all-cash`, no ineligible package) instead. [Corrected in
Task 12: this section originally named Q as the absence witness, which
contradicts Q's own measured membership in the ineligible-package set — Q's
own detailed cost plan is not, in fact, every package eligible.]

---

## 8. §26.5 — The calculator's stages, addresses and status

### The address

Route: `/projects/:id/calculator/:page?`, one `<Route>` element. `page` is a
slug from the table below; absent or unrecognised → `<Navigate replace>` to
`acquisition`. Prev/Next and the tab bar navigate; the calculator's state is
not remounted by a `:page` change (decision 3). `ProjectDetail`'s existing
link to `/projects/:id/calculator` keeps working through the redirect.

| # | Stage | `CalcPage` key | Slug | Label |
|---|---|---|---|---|
| 1 | Inputs | `acquisition` | `acquisition` | Acquisition |
| 2 | Inputs | `areas` | `areas` | Areas |
| 3 | Inputs | `unit_mix` | `unit-mix` | Unit Mix |
| 4 | Inputs | `conversion_costs` | `costs` | Costs |
| 5 | Inputs | `vat` | `vat` | VAT |
| 6 | Funding | `finance` | `finance` | Finance |
| 7 | Funding | `programme` | `programme` | Programme |
| 8 | Funding | `cashflow` | `cashflow` | Cashflow |
| 9 | Exit | `exit_strategy` | `exit` | Exit |
| 10 | Underwriting | `appraisal` | `appraisal` | Appraisal |
| 11 | Underwriting | `scenarios` | `scenarios` | Scenarios |
| 12 | Underwriting | `sensitivity` | `sensitivity` | Sensitivity |
| 13 | Underwriting | `risk_register` | `due-diligence` | Due Diligence |
| 14 | Output | `deal_spider` | `deal-spider` | Deal Spider |
| 15 | Output | `investor_summary` | `investor` | Investor |
| 16 | Output | `lender_case` | `lender-case` | Lender Case |

`PAGE_SLUG` is pinned `satisfies Record<CalcPage, string>`; slugs are
asserted unique. `CalcPage` keys are unchanged; only `PAGES`' order and
numbers move (Exit 12 → 9; Appraisal, Scenarios, Sensitivity, Due Diligence
9–11, 13 → 10–13). Labels keep their numbers. Page-number comments in
`DueDiligencePage.tsx` and `LenderCasePage.tsx` follow.

### The stages

The sub-nav renders five labelled groups in the order above; each page's
tab reads "N. Label" and carries its badge. A stage label is presentation
only — no stage has behaviour.

### The badges

`pageStatus(run): Record<CalcPage, PageStatus>` in
`components/calculator/page-status.ts` (beside the page table it keys on —
`lib/` must not import from `components/`),
where `PageStatus = { errors: number; evidence: { assessed: number; total: number } | null }`.

`errors` = the count of `run.validation.issues` with `severity === 'error'`
whose `field`'s **root** — the segment before the first `.` or `[` — is in
the page's owned set. `evidence` is non-null on Due Diligence only:
`run.metrics.due_diligence.totals.assessed_count` of the entered total
(23 catalogue items today; read from the totals, never a literal). A tab
with `errors > 0` shows a red pill with the count; Due Diligence shows
*n/23 assessed* beside it.

**Ownership, normative and pinned `satisfies Record<CalcPage, readonly string[]>`:**

| Page | Owned roots |
|---|---|
| Acquisition | `acquisition` |
| Areas | `areas` |
| Unit Mix | `unit_mix` |
| Costs | `conversion_costs`, `cost_plan` |
| VAT | `vat` |
| Finance | `finance`, `equity_sources`, `lender_valuation`, `monitoring` |
| Programme | `programme` |
| Cashflow | — |
| Exit | `exit_strategy`, `sales_phasing`, `refinance`, `investment_case`, `unit_sales` |
| Appraisal | `deal_spider` |
| Scenarios | `scenarios` |
| Sensitivity | — |
| Due Diligence | `due_diligence` |
| Deal Spider | — |
| Investor | — |
| Lender Case | — |

**Exhaustiveness, at both ends.** A source-scan test reads `validation.ts`,
extracts the first argument of every `err('…` / `warn('…` call (template
literals included — the root precedes any `${`), takes its root, and asserts
each root is owned by **exactly one** page. A new validation rule on an
unowned block fails the suite; a root owned twice fails it too. The
`scenarios` root carries two rules today (the whole-months rules) and is
owned by Scenarios; `equity_sources` is owned by Finance, whose editor writes
it.

---

## 9. §26.6 — The bundle

**Seams.** `ExportPage`'s four handlers `await import()` their generator
module at the call (`export-pdf`, `export-excel`, `export-investment-memo`),
so `jspdf`, `jspdf-autotable` and `xlsx` leave the entry. `PropertyMap`
(`leaflet`, `react-leaflet`) and `ConversionCalculator` are `React.lazy`
route elements under one `Suspense` fallback in `App.tsx`. `report-layout.ts`'s
`import type { jsPDF }` is a type and costs nothing.

**Gate.** `vite.config.ts` sets `build.manifest: true`. `package.json`'s
`build` becomes `tsc -b && vite build && node scripts/assert-bundle.mjs`. The
script reads `dist/.vite/manifest.json`, takes the entry (`isEntry`), walks
its **static** `imports` transitively (not `dynamicImports`), and fails the
build if:

1. the sum of the closure's file sizes on disk exceeds **the ceiling**, or
2. any file in the closure contains one of the banners `jsPDF`, `SheetJS`,
   `Leaflet`.

The ceiling is a number in the script and in §26.6: the measured post-split
closure size rounded up to the next 50 kB, plus 50 kB. The pre-split
measurement is recorded beside it (1,646 kB entry, 491 kB gzip, 29 August
2026). A test cannot run the build, so the gate is the build; `npm run
build` is already a release gate.

---

## 10. §26.7 — Migration and the persistence boundary

**`migrateV15toV16` / `migrate_v15_to_v16`.** Refuses a document that is
already v16 (idempotence, as every predecessor). Returns the document with
`inputs_version: 16` and `conversion_costs` rebuilt from the five kept fields
— a rebuild, not a delete of nine keys from a copy, so an unexpected tenth
legacy key cannot ride through. `migrateInputsToV16` / `migrate_inputs_to_v16`
chain from `…ToV15` with `RECOGNISED_INPUTS_VERSIONS_V16 = [1..16]`, refuse
an unrecognised version and a version-16 document that fails `isV16`.

**`isV16`**: `inputs_version === 16` **and** `conversion_costs` is an object
**and** `'contingency_pct' in conversion_costs` is false. Python's
`is_v2_or_later` gains `is_v16` — the trap R12's cutover found; the TS chain
has no such helper, and the plan verifies `migrateInputsToV16`'s recognition
of a v16 document by reading the source rather than assuming the arm exists.

**The one-arm proof.** On fixture `q-detailed-cost-plan` (a v15 document
whose raw JSON carries all nine keys): before migration
`'contingency_pct' in raw.conversion_costs` is true and every fee key is
present; after, none of the nine is present and the five kept fields are
byte-equal. In Python the assertion is on `model_dump(mode="json")` of the
migrated document **and** on the stored snapshot after a live POST
(decision 11).

**The numeric identity gate.** Corpus-wide over `fixtures/financial-model/*`
(the same ≥ 20 corpus, same not-silently-shrunk assertion), raw v15 through
the 2.18.0 engine versus migrated v16 through the same engine: `metrics`
identical with **no exclusion** (`sdlt_pence` is absent on both arms), the
ledger and the schedule identical, and on F/U/Y/Z the default
`SensitivityResult` identical.

**The validation gate.** R12's three properties:

1. *Every v15 issue has a v16 counterpart* — except the nine listed. The
   v15-only-rule list is exactly the nine non-negativity rules on the removed
   fields, asserted as exactly nine entries; a tenth, or an eighth, fails.
   They guarded fields the v7+ engine never read, so their issues were
   vacuous on every document this release migrates; a v15 document with a
   negative `architect_pence` computed the same figures as one with zero.
2. *No invalid document becomes valid* — for every rule not in the list,
   unconditional.
3. *No v16-only rule exists* — the v16 list is empty, asserted as empty,
   because this release adds no rule.

**The entry-point cutover.** `ConversionCalculator.tsx` and
`app/api/app.py` move to `…ToV16`; `entry-point-guard.test.ts` and
`test_entry_point_guard.py` pin `NEWEST == 16`. The R13 live-server proof
extends: the v10 fixture posted through the real boundary comes back at
`inputs_version: 16`, not legacy, its `investment_case` intact, `monitoring`
absent, `unit_sales` null, `due_diligence` seeded, **and** its stored
`conversion_costs` carrying exactly the five v16 keys. `FinancialAppraisalCreate`'s
docstring gains the v16 sentence. The governance `inputs_version` column is
already `inputs.inputs_version` (R13's fix), so it moves with the cutover
and the test still asserts it.

---

## 11. §26.8 — Stated limitations

1. **Stage labels are presentation.** A stage has no completion state of its
   own; the badge is per page, and "complete" means "no owned error", which
   a page with no owned roots satisfies vacuously.
2. **Badges count errors only.** Warnings and `requires_confirmation` fields
   are visible on their pages, not in the nav.
3. **Ownership is by root.** A rule whose `field` is a nested path is owned by
   its root's page; a block edited on two pages would need a deeper rule and
   none exists today.
4. **The downgrade of 007 is lossy by construction.** Re-added columns are
   null; a consumer that needs them after a downgrade re-saves the appraisal.
5. **The bundle ceiling is a number, not a policy.** It bounds the static
   closure of the entry; dynamic chunks are unbounded, and a seam that stops
   being dynamic is caught by the banner scan only for the three named
   libraries.
6. **The eligibility column is a per-month share, not a per-package ledger**
   (§24.9 limitation 3), and it is hidden on a fully-eligible document by
   design — a reader wanting the figure on such a document reads the memo's
   §24.6 line.
7. **`total_construction_sqm` stays behind §15.4's accessor.** It is a live
   manual-basis input, not a legacy field, and this release does not touch
   it.

---

## 12. Guards this release must watch fail

| Guard | What would make it fail, and why that matters |
|---|---|
| Slug table `satisfies Record<CalcPage, string>` + uniqueness test | A page with no address, or two pages sharing one |
| Unsaved-inputs-survive-navigation test | A refactor to per-page route elements that remounts the calculator — a data-loss path, the class the audit's first P0s were |
| Ownership `satisfies Record<CalcPage, readonly string[]>` | A page with no ownership row |
| Source-scan root test (exactly-one-owner) | A validation rule on an unowned block, or a root owned twice |
| `uses.length === months.length` | A column printed against the wrong month |
| Column-absent-on-A test | The column becoming unconditional, silently widening a wide table on every document |
| `assert-bundle.mjs` closure + banner | A static `import { jsPDF }` reappearing anywhere reachable from the entry |
| One-arm key-presence proof on Q, stored JSON | A migration that relabels without removing (extras ignored would hide it) |
| Exactly-nine v15-only list | The list becoming a tolerance that swallows a real regression |
| Empty v16-only list | A rule added without a spec sentence |
| Corpus-wide numeric identity, no exclusion | Any figure moving under the removal — the whole claim of this release |
| Chain `["007", …, "001"]` | A migration file that Alembic does not discover |
| Cutover: stored `conversion_costs` has exactly five keys | The server migrating the tag but storing the old shape |
| `NEWEST == 16` both guards | An entry point left at 15 |
| `CALC_VERSION` in spec §1.6 status line | A bump the spec does not record |

---

## 13. Fixtures

No new golden fixture. Fixture **Q** (`q-detailed-cost-plan`) is the one-arm
migration witness; fixture **S** (`s-dated-programme`) shows the eligibility
column. The corpus documents carrying an ineligible package are pinned by
name as exactly four: **Q** (`q-detailed-cost-plan`), **S**
(`s-dated-programme`), **W** (`w-monitoring-on-site`) and **Z**
(`z-cost-plan-in-time`) — so the column-absent witness is fixture **A**
(`a-all-cash`), not Q, since Q is itself one of the four. [Corrected in
Task 12: this section originally named Q as the column-absent witness too,
which double-books it against its own membership in the ineligible-package
pin list.] **F/U/Y/Z** carry the sensitivity arm as in R16. Fifteen fixtures
lose the `sdlt_pence` key from their pinned metrics; no pinned value
changes.

---

## 14. The carried minors, decided

| # | R16 finding | Ruling |
|---|---|---|
| 1 | `stressSettingText` suppresses the whole entry-9 parenthetical when `!applicable`, dropping stated figures when `base_build == 0` or `network == null` | **Per-half, on what is stated.** The cost clause (*"£X recorded; n items"*) prints whenever `derivation.stated_item_count > 0`; the months clause (*"largest m months"*) prints whenever `programme_impact_max_months !== null`; the parenthetical is omitted only when neither is stated. Applicability stays the `note`'s job. §25.5's wording follows. Both surfaces (page and memo) share the one function, so one test covers both. |
| 2 | `sensitivity.ts` / `.py` comments say "twelve of thirteen levers disjoint" | **Nine of thirteen**; the two sharing pairs named: `saleable_area`/`gdv` (unit value) and `programme_slip`/`phase_slip` (`slip_months`). |
| 3 | `test_entry_point_guard.py` test named for v14 asserts v15 | **Won't fix, by the file's own standing instruction.** Each round-trip test's docstring says it is *"kept at its R15b name rather than renamed each cutover — the function name is not the proof; the assertions below are"*. The R16 finding contradicted that ruling without engaging it; the ruling stands, and the cutover (Task 6) moves the assertions to 16 without renaming. |
| 4 | `spec-versions.test.ts` asserts `CALC_VERSION` as a whole-file substring | Asserts the **§1.6 status line** — the sentence that names the current calc version — so a stale line beside a fresh changelog entry fails. |
| 5 | Memo stress table can split across a page | `rowPageBreak: 'avoid'` on that `autoTable`; the release-gate layout test already asserts no orphan headings. |

---

## 15. Amendments to other sections

- **§1.6** — `16` (**inputs v16**) = calc 2.18.0+ (removes `contingency_pct` and the eight legacy fee fields from `conversion_costs`, §26.1); calc 2.18.0 removes `sdlt_pence` from the result (§26.2) and changes no computed value.
- **§3** (acquisition tax) — the R8 `sdlt_pence` alias note becomes historical: removed in R16b.
- **§13.2** — a sentence that a stored row's `audit_hash` is recomputable only within its own `calc_version`, and that 2.18.0's shape change is the first version whose hash moves with no figure moving.
- **§16.3, §16.7** — "removed in R16b" → removed; the seed's "eight legacy fee fields" text is retained as a description of the v6 shape it reads.
- **§24.9** — the R15b out-of-scope column is delivered (§26.4); limitation 3 stands.
- **§25.5** — the parenthetical rule becomes per-half (§14 row 1).
- **Migration notes §19** — v15 → v16, the identity claim and where it is tested, the boundary round trip and the entry-point cutover, following §18's shape.
- **Release plan** — R16b row → DONE, shipped; the "no calc bump expected" clause corrected in place with a pointer here.

---

## 16. Out of scope

Per-page route elements with a lifted input store; a `manualChunks` vendor
policy; backfilling 007's downgrade; warning or confirmation badges; a
per-package cash-flow ledger; touching `total_construction_sqm` or the
compliance fields; the R16 design's other deferrals (named-unit lever,
configurable pack, DSCR floor stress, API endpoint); the audit's PDF tagging
row.

---

## 17. Shape of the work

Branch `r16b-platform` off `main` (`258c871`). Twelve tasks, subagent-driven,
review after each; gates at every task: pytest, vitest, `tsc -b`, eslint,
`npm run build` (which from Task 10 includes the bundle gate).

1. `sdlt_pence` off the result, both engines; `deal-spider.ts`; fifteen
   fixtures re-pinned; `CALC_VERSION` 2.18.0; spec §1.6 and §3 notes.
2. `ConversionCostInputsV16` / `CalculatorInputsV16` both engines;
   `costPlanOf`'s narrowing; validation rows deleted; defaults; `isV16`;
   `migrateV15toV16` / `migrate_v15_to_v16` and the `…ToV16` chain.
3. The v15 → v16 gate both engines: corpus identity, sensitivity arm, the
   three validation properties with the exactly-nine list, the one-arm proof
   on Q.
4. Alembic 007; ORM; repository; response model; `calculate_authoritative`;
   chain and health tests.
5. Client readers: `types.ts`, `ProjectDetail`, `export-pdf.ts`, their tests.
6. Entry-point cutover both ends; `NEWEST == 16`; the extended live-server
   proof; `FinancialAppraisalCreate` docstring; migration notes §19.
7. Routing: the `:page?` route, `PAGE_SLUG`, redirects, `NavLink`s,
   `renderCalculator` test helper, the unsaved-inputs test.
8. Stages and reorder: `stage` on `PAGES`, the grouped nav, numbers 9–13,
   page-comment renumbers, the "offers sixteen numbered pages" test rewritten
   to the new order.
9. Badges: `components/calculator/page-status.ts`, ownership table, source-scan pin, the DD
   evidence count, nav rendering.
10. Bundle: the three seams, `build.manifest`, `scripts/assert-bundle.mjs`,
    the ceiling measured and written into the script and §26.6.
11. Cash-flow column: the conditional column, disclosure line, alignment
    test, absent-on-Q test, §24.9 and §26.4.
12. The five carried minors; spec §26 assembled; §13.2, §16.3, §16.7, §25.5;
    release plan row; final whole-branch review.
