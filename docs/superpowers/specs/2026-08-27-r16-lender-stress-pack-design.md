# Release 16 — The standard lender stress pack design

**Date:** 27 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§7.9 (*"Standard lender buttons should include unit loss, saleable-area
reduction, abnormal cost, slower sales absorption, delayed planning/PC,
refinance yield expansion, lower refinance LTV and operating-cost/vacancy
stress. At present the principal configurable levers are GDV, cost, timeline
and rate."*), finding table row *"P1 — Standard sensitivities omit
conversion/exit risks — Add area/unit/abnormal/sales/refi stress presets"*,
deferred from R7 (`2026-08-17-release-7-implementation-report.md` §"Deferred →
R16"); spec §23.9's note *"There is no due-diligence lever: a 'risks
crystallise' stress (Σ cost impact onto construction, Σ programme impact onto
the timeline) is recorded for R16's presets, not built here"*;
`apply_scenario.py`'s own comment *"area reduction is its own R16 lever"*; and
the release plan's recorded UX debt *"the R12/R13 override fields
(`phase_slip_*`, `exit_yield_adjustment_pct`, `operating_cost_adjustment_pct`,
`vacancy_adjustment_pct`) have no ScenariosPage input"*.

**Release-plan row, restated by this design.** The plan's R16 row read
*"Sensitivity presets, UX stage grouping, bundle split, legacy column
deprecation — P1/P2 — none"*. Scoping found that row to be two releases and
its "no schema move" to be wrong on both halves (a new lever needs a scenario
field; removing `contingency_pct` is an inputs bump). It is split:

- **R16 — this design.** The stress pack, its four new levers, the Scenarios
  page completed, and the R15/R15b review minors. **calc `2.16.0` → `2.17.0`,
  inputs `v14` → `v15`, spec §25.**
- **R16b — platform.** Stage grouping and URL-routed calculator pages, the
  bundle split, legacy stored columns / `sdlt_pence` / `contingency_pct` and
  the eight legacy fee fields (inputs v16, Alembic 007), and the cash-flow
  page's eligibility column. Not designed here.

**Specification:** the calculation specification gains **§25**; **§12.1**'s
lever table goes from nine rows to thirteen and gains two composition
statements; **§12.6** gains one whole-months rule; **§16.4** notes the
`abnormal` class as a lever target; **§18.9** gains `programme_slip` beside
`phase_slip`; **§19.8** gains `refi_ltv`; **§23.9**'s "recorded for R16" note
becomes a historical note; **§1.6**'s inputs-version list gains v15.

---

## 1. The problem this release exists to solve

### 1.1 The levers exist; the lender's questions do not

R4 built the fixed-facility suite and R12/R13/R13b brought the lever count to
nine, but the suite still answers only the questions a user configures. The
audit's §7.9 list is what a credit committee asks of every scheme regardless
of who entered it: *what if a unit is lost, the saleable area shrinks, the
existing building throws up an abnormal, sales run six months slow, planning
or practical completion slips, the exit yield moves out, the refinance lender
lends less, or opex and voids run over?* Five of those eight already have a
lever (`sales_slip`, `exit_yield`, `operating_cost`, `vacancy`, and the
`phase_slip`/`timeline` pair); none has a *standard* position, and the memo's
§10 prints only what the default grid and tornado happen to cover — GDV,
cost, term and rate. A lender reading the memo cannot see the area, unit,
abnormal or refinance-LTV downside at all.

### 1.2 The evidence schedule states impacts nobody stresses

R15 gave every assessed due-diligence item a `cost_impact_pence` and a
`programme_impact_months`, and the memo's §9 prints their totals as facts.
Nothing runs the appraisal with those impacts *applied*. §23.9 recorded the
gap and named this release as its owner.

### 1.3 Five scenario fields have no writer

R12 and R13 added `phase_slip_phase_id`/`phase_slip_months`,
`exit_yield_adjustment_pct`, `operating_cost_adjustment_pct` and
`vacancy_adjustment_pct` to `ScenarioOverrides`; R13b added
`sales_slip_months` *and* its input. The other five are engine-complete and
UI-less on the Scenarios page — the §18.10-limitation-9 shape (an input the
engine honours but nothing can write) three releases on.

---

## 2. Scope

| Ask | Owned by | Notes |
|---|---|---|
| §7.9 standard lender stresses | **R16** | a closed, spec-numbered pack of nine, run as §12.5 cells, §25.2 |
| §23.9 "risks crystallise" | **R16** | pack entry 9, derived from the document's assessed DD items, §25.3 |
| The audit's "area / unit / abnormal / refi" levers | **R16** | four new levers, §25.1; `apply_scenario`'s promised area lever among them |
| R13b's Scenarios-page debt | **R16** | every `ScenarioOverrides` field gets an input, including the four new ones |
| R15/R15b review minors (eight) | **R16** | §14, each with its decision |
| Stage grouping, routed pages, bundle split | **R16b** | UI/platform, not calculation |
| `sdlt_pence`, `contingency_pct`, legacy fee fields, seven stored columns | **R16b** | inputs v16 + Alembic 007 |
| Cash-flow page eligibility column | **R16b** | §24.9 deferred it as page work |

**Arithmetic changes, stated.** Calc 2.17.0 changes what `apply_scenario` /
`applyScenario` *can* do (four new arms) and adds one library result
(`run_stress_pack` / `runStressPack`). It changes **no existing computed
value on any document**: every new scenario field migrates as `0`, every new
lever is the identity at `0`, and the fixed-facility suite's cell
measurement applies settings in `LEVER_ORDER` rather than caller order — a
change with no effect on the nine existing levers, which write disjoint
fields. The v14 → v15 identity gate compares metrics (flags strictly),
ledger, schedule and the sensitivity result on both arms with **no
exclusion and no tolerance** — nothing fires on one arm only, so the gate
needs none (R15b's rule).

---

## 3. Decisions taken at design time

| # | Decision | Chosen | Rejected, and why |
|---|---|---|---|
| 1 | What a "preset" is | **A closed pack of nine stresses run engine-side as §12.5 cells**, in both engines, published as a result and printed in memo §10 and on the Sensitivity page whether or not anyone pressed anything | One-click fills of the scenario cards — the memo would show a stress only if the user had loaded it, and nothing would be spec-pinned; a configurable pack — YAGNI, the audit asked for *standard* positions |
| 2 | Unit loss | **`saleable_area` at −(100/N)%** — one average unit's share of NIA and GDV, N = proposed unit count | A `unit_loss` lever that removes N units — cascades through `unit_sales.units[]`, `retained_units[]` and two validation rules, and must choose *which* unit; the underwriting effect (area and value fall together) is what `saleable_area` delivers |
| 3 | The area lever | **`saleable_area` scales each unit's `floor_area_sqm` and `estimated_value_pence`** — value at constant £/sqm. Ancillary areas/values untouched (outside NIA and outside internal GDV, §15.5) | Area only — unit value is per-unit here, not rate × area, so an area-only cut leaves GDV unchanged and the stress is inert; scaling ancillary too — a parking space does not shrink with the flat |
| 4 | Sharing `estimated_value_pence` with `gdv` | **Composition order stated (§12.1): `saleable_area` first, then `gdv`**, each rounding once; cells apply settings in `LEVER_ORDER`, so the several-orders property is kept by construction rather than by luck | A single combined multiplier — sequential single-lever application in `measure()` would still round twice; forbidding the pair on one grid — a matrix of area × price is a legitimate lender question |
| 5 | Abnormal cost | **`abnormal_cost` adds percentage points to `cost_plan.contingency[abnormal].pct`.** Headline mode: base is the whole build (§16.4 already gives every class the whole base there). Detailed mode: base is the abnormal-tagged packages | Scaling the build (`construction_cost` under another name) — the audit distinguishes an abnormal from a general overrun, and R10 built the class for exactly this; a pence-additive lever — no pence-additive construction input exists (decision 8) |
| 6 | Delayed planning / PC | **`programme_slip` adds months to `slip_months` of every phase with no predecessors** (the network's sources), so the delay cascades through dependencies once | Slipping every phase — successors already move with their predecessors, so each dependency edge would count the slip twice; `timeline` — moves the facility term, not the works; `phase_slip` — needs a phase id a standard pack cannot know |
| 7 | Lower refinance LTV | **`refi_ltv` subtracts percentage points from `investment_case.takeout.ltv_cap_pct`** (the field §19.4 sizes on); positive = adverse, `vacancy`'s convention | Touching `refinance.ltv_pct` — narrowed to nullable and inert since R13 |
| 8 | How Σ DD cost reaches construction | **Percent-equivalent of base build:** `p = round12(Σ ÷ base_build × 100)` run as `construction_cost`. No schema change; the rounding bound is stated (§25.3) and asserted | A new `cost_plan.stress_cost_pence` input — a v15 field only a lever ever writes, with a migration and 22 fixture edits for exactness a stress does not need; dropping the cost half — leaves §23.9's note half-honoured |
| 9 | Σ or max for programme months | **Σ over assessed rows** — a stress in which the recorded risks crystallise in series. `DdTotals.programme_impact_max_months` stays the schedule's critical-exposure figure; §25.3 names both and why they differ | Max — the assessment's figure, not a stress; the memo already prints it |
| 10 | Inapplicable stresses | **Run anyway, measured, marked `applicable: false` with a note**, and printed — §12.4's zero-width-bar precedent | Omitting them — a lender reading nine standard rows must see which ones this scheme cannot answer, not count to eight |
| 11 | Applicability is a document fact | Decided from the base document (unit count, cost-plan mode and tags, ledger, network, investment case, Σ), **not** from "metrics equal base" — a coincidental equality is not inapplicability. A corpus-wide test asserts the implication `inapplicable ⇒ metrics == base` | Deriving it from the measurement — the R11 lesson: an identity is true of whatever it is true by construction of |
| 12 | Where the result lives | **A library result beside `SensitivityResult`**, not in `AppraisalResultV2`; no API endpoint (sensitivity has none) | Nesting it in the appraisal result — every appraisal would run ten more appraisals |
| 13 | Versions | calc **2.17.0** (new lever arms, a new result), inputs **v15** (four `ScenarioOverrides` fields, written as `0` by the migration as v12 wrote `sales_slip_months`) | Pack-only settings off the document — the Scenarios cards could not use the new levers and the R13b debt would be half-paid; no inputs bump — every document-shape change here has bumped, and the entry-point guard needs the cutover |
| 14 | The pack's magnitudes | **Normative, like §12.3/§12.4's defaults**, chosen as the lender-standard round figures (§25.2) | User-editable pack — a second config object, and "standard" would stop meaning standard |
| 15 | Scenario cards and the memo's comparison appraise unvalidated levered documents today | **Both adopt §12.7**: validate the levered document, show "not measured" with the first error rather than appraising it; the memo's comparison prints every non-zero lever, not only GDV and cost | Leaving it — four more levers make an invalid card easy to write, and an appraisal of an invalid document is the clamp §12.7 exists to forbid |

---

## 4. §25.1 — Four new levers (inputs v15)

§12.1's table gains four rows, in this order after `sales_slip`:

| Lever | Unit | Effect on the inputs document | No-op when |
|---|---|---|---|
| `saleable_area` | percent | scales every `unit_mix.units[].floor_area_sqm` **and** `estimated_value_pence` by `(1 + p/100)`; area exact, value rounded half-up once; ancillary untouched | `unit_mix.units` is empty |
| `abnormal_cost` | percentage points | adds to `cost_plan.contingency[name = 'abnormal'].pct` | the class's base is 0 — detailed mode with no package tagged `abnormal` |
| `programme_slip` | months | adds to `programme.phases[i].slip_months` for every phase with `predecessors = []` | `programme` is not a network, or has no phases |
| `refi_ltv` | percentage points | **subtracts** from `investment_case.takeout.ltv_cap_pct` | `investment_case = null` |

Sign convention, restated per lever: `saleable_area` follows `gdv` (negative
is the reduction; the pack runs it negative) because it composes with `gdv`
on the same field; `abnormal_cost` and `programme_slip` follow
`construction_cost` and `timeline` (positive adverse); `refi_ltv` follows
`vacancy` (subtracts, so positive is adverse).

`ScenarioOverrides` gains, in this order after `sales_slip_months`:
`saleable_area_adjustment_pct: float = 0`, `abnormal_cost_adjustment_pct:
float = 0`, `programme_slip_months: int = 0`, `refi_ltv_adjustment_pct: float
= 0`. `SensitivityLever` and `LEVER_ORDER` grow to thirteen in both engines;
the cross-engine lever-parity gate (beside the `FlagCode` gate in
`tests/test_accessor_guard.py`) asserts the two orders are identical.

**Composition, stated as §12.1 requires.**

- `saleable_area` and `gdv` share `estimated_value_pence`. **Order:
  `saleable_area` first, then `gdv`**, each rounding half-up to pence once:
  `v₂ = round(round(v × (1 + a/100)) × (1 + g/100))`. `apply_scenario`
  applies the two arms in that order within one call; `_measure`/`measure`
  apply a cell's settings **sorted by `LEVER_ORDER`** (stable) rather than in
  caller order, so a `(gdv, saleable_area)` row/column pair measures the same
  cell whichever axis is the row. The all-levers-in-several-orders test gains
  the four levers and — because the pair is the first shared field — gains a
  second assertion: a document levered by `(saleable_area = −10, gdv = +10)`
  reports the stated `v₂` on a unit whose value makes the two orders differ
  by a penny (a value chosen so that `round(round(v × 0.9) × 1.1) ≠
  round(round(v × 1.1) × 0.9)`; the plan derives one).
- `programme_slip` and `phase_slip` share `slip_months`. Both are additive
  integers, so the order is immaterial; stated, and the several-orders test
  covers the pair on fixture S.
- `abnormal_cost` and `refi_ltv` share nothing.

§12.2 is untouched: none of the four writes a facility field. §19.8's
carve-out (the take-out is re-solved in every cell) is what makes `refi_ltv`
measure anything, and §19.8 gains the sentence.

**§12.6 gains:** *"a step, or a tornado bound, for the `programme_slip` lever
that is not a whole number of months"* is an input error, the `timeline` /
`phase_slip` / `sales_slip` rule extended. No other new rule: a
`saleable_area` step of −100 or below, a `refi_ltv` that takes the cap to
zero or below, or an `abnormal_cost` that takes a class negative all reach
§12.7's existing mechanism — the levered document fails validation
(§16.5's non-negative class pct, §19.7 rule 8's `0 < ltv_cap_pct ≤ 100`,
§15.6's area rules) and the position is unmeasured, never clamped.

---

## 5. §25.2 — The pack

`STRESS_PACK` is a closed list of nine, in this normative order. Each entry
is a key, a label and a list of lever settings; two entries carry a setting
**derived** from the base document (§25.3).

| # | Key | Label | Settings |
|---|---|---|---|
| 1 | `unit_loss` | One unit lost | `saleable_area` = −(100 / N), N = `unit_mix.units.length` |
| 2 | `area_reduction` | Saleable area −5% | `saleable_area` = −5 |
| 3 | `abnormal_cost` | Abnormal cost +10% | `abnormal_cost` = +10 |
| 4 | `slower_absorption` | Sales six months slower | `sales_slip` = +6 |
| 5 | `delayed_start` | Start / PC six months late | `programme_slip` = +6 |
| 6 | `yield_expansion` | Exit yield +100 bp | `exit_yield` = +1.0 |
| 7 | `lower_refi_ltv` | Refinance LTV −10 pp | `refi_ltv` = +10 |
| 8 | `opex_vacancy` | Opex +10%, vacancy +5 pp | `operating_cost` = +10 **and** `vacancy` = +5 |
| 9 | `risks_crystallise` | Recorded risks crystallise | `construction_cost` = p (derived), `programme_slip` = M (derived) |

Every stress is one §12.5 cell: the settings are applied to the base
document on top of the zero scenario, the levered document is validated
(§12.7), and only a passing document is appraised. Entry 8 is the one cell
with two settings; entry 9 has two when both halves are applicable.
`run_stress_pack` / `runStressPack` runs ten appraisals (nine plus the base)
and raises `InvalidBaseDocumentError` on a base document that fails
validation, exactly as `run_sensitivity` does.

**Why these magnitudes.** They are the round figures a UK development-finance
credit paper habitually tables — 5% area, 10% abnormal, six months on sales
and on programme, 100 bp on yield, 10 points on LTV, 10%/5 pp on
opex/voids. They are normative (decision 14) and appear in the memo beside
each row, so a reader never has to guess what was moved.

---

## 6. §25.3 — Derived settings

**Entry 1 — one unit lost.** `N` is the proposed unit count. The setting is
`−100/N` as a float (−25 on four units, −16.666666666667 on six, to 12 dp —
the R15b `round12` rule, so both engines print and apply the same figure).
`N = 0` → inapplicable.

**Entry 9 — recorded risks crystallise.** From `inputs.due_diligence.items`
directly (the document; not `DueDiligenceResult`, which is a derivation of
the same rows and would make the pack depend on running §23 first):

- `assessed` = items with `status ∈ {red, amber}` (§23.4's rule).
- `Σcost` = Σ `cost_impact_pence` over assessed items with a non-null value.
- `Σmonths` = Σ `programme_impact_months` over assessed items with a non-null
  value.
- `base_build` = the base document's `cost_plan.base_build_pence` (§16.3;
  detailed: Σ packages; headline: `round(rate × area)`).
- **Cost half:** `p = round12(Σcost ÷ base_build × 100)`, run as
  `construction_cost = p`. Applicable when `Σcost > 0` and `base_build > 0`.
- **Programme half:** `M = Σmonths`, run as `programme_slip = M`. Applicable
  when `Σmonths > 0` and the programme is a network with at least one phase.
- The entry is applicable when either half is; the note names the half that
  is not.

**The rounding bound, stated.** `construction_cost` is a percent lever
rounding per costed line, so the levered build is not `base_build + Σcost`
to the penny. In detailed mode each package rounds once, so
`|levered_base_build − (base_build + Σcost)| ≤ number of packages` pence. In
headline mode the lever rounds the **rate**, and `base_build = round(rate' ×
area)` — the bound is `⌈area_sqm / 2⌉ + 1` pence, which on a 1,000 sqm scheme
is £5. The detailed-mode bound is asserted on fixture Y (a golden pin); the
headline bound in a unit test, both engines, on a headline `__fixtures__`
document whose DD items are given impacts for the purpose. The memo prints
the applied percent and the Σ it stands for, so a reader sees both.

**Σ, not max.** `DdTotals.programme_impact_max_months` is the schedule's
statement of the single largest recorded delay — the critical exposure. The
stress asks what happens if the recorded delays land **in series**; that is
Σ, and §23.9's note said Σ. The memo row states "Σ 7 months across 3 items
(largest 3)" so neither figure is mistaken for the other.

**Worked example — fixture Y.** Five assessed items; `Σcost = 2,550,000p`;
`base_build = 26,000,000p`; `p = 9.807692307692`; `Σmonths = 7` (max 3);
one source phase, `acquisition`, so `programme_slip = 7` slips it and the
six dependants follow. N = 4, so entry 1 runs `saleable_area = −25`.

---

## 7. §25.4 — Applicability

Decided from the base document (decision 11), per entry:

| # | Applicable when |
|---|---|
| 1, 2 | `unit_mix.units.length > 0` |
| 3 | `cost_plan.mode = headline`, or detailed with ≥ 1 package whose `contingency_class = abnormal` |
| 4 | `unit_sales` non-null with ≥ 1 row |
| 5 | `programme` is a network with ≥ 1 phase |
| 6, 7, 8 | `investment_case` non-null |
| 9 | either half per §25.3 |

An inapplicable entry is still measured (it equals the base by construction)
and carries `applicable: false` and a one-sentence `note` naming the missing
fact ("no package carries the abnormal contingency class"; "no investment
case is modelled"; "no unit-sales ledger"; "the programme is not a network";
"no assessed due-diligence item states a cost impact"). A corpus-wide test
asserts, on every golden fixture, `applicable = false ⇒ metrics = base` in
every field — and the converse is **not** asserted, because an applicable
lever can legitimately move nothing (a `refi_ltv` cut on a take-out the DSCR
floor already binds below the new cap).

---

## 8. §25.5 — Outputs and reporting

### The result

```
StressPackResult {
  base: MeasuredMetrics                       // §12.5, always measured
  stresses: StressResult[9]                   // normative order
}
StressResult {
  key, label
  settings: { lever, value, phase_id: null }[] // RESOLVED values as applied
  derivation: null | {                        // entry 9 only
    cost_impact_pence, base_build_pence, cost_pct,   // cost_pct = p or null
    programme_impact_months, programme_impact_max_months, stated_item_count
  }
  applicable: boolean
  note: string | null                         // non-null iff !applicable, or one half of 9 is not
  metrics: SensitivityMetrics                 // nullable fields, flags, validation_errors (§12.7)
  delta_profit_pence: number | null           // metrics.profit − base.profit; null when unmeasured
}
```

Python `stress_pack.py` / TS `stress-pack.ts`, siblings of the sensitivity
modules, importing `_measure` / `measure` (exported for the purpose, not
duplicated). Not in `AppraisalResultV2`; no endpoint.

### Surfaces

- **Memo §10** gains a sub-heading before the tornado: **"Standard Lender
  Stresses (spec §25)"**, one sentence of method, then a table `Stress |
  Setting | Profit | Δ vs base | Peak debt | Flags`, nine rows in order. An
  inapplicable row prints its base-equal figures with the note in the
  Setting cell in italics; an unmeasured row prints "not measured" and its
  first validation message, §12.7's wording. Entry 1's Setting cell prints
  "−25.0% area and value (1 of 4 units)"; entry 9's prints "+9.81% build
  (£25,500 recorded) · +7 months (Σ of 3 items; largest 3)". Built inside
  `sensitivityTables()` beside the tornado so the memo runs the pack once;
  `InvalidBaseDocumentError` is caught to the same message the tornado
  uses. §13.1's provenance disclosure is unchanged (the pack is derived at
  print time, as the suite is).
- **Memo §10 Scenario Comparison:** its settings rows go from two (GDV,
  cost) to one row per **non-zero** lever across the three scenarios, so a
  card stressed on `refi_ltv` or `programme_slip` says so; and it adopts
  §12.7 (decision 15) — a scenario whose levered document fails validation
  prints "not measured" and the first error, never an appraisal of an
  invalid document.
- **Sensitivity page** gains a read-only "Standard lender stresses" panel
  above the tornado, the same nine rows, via `safeRunStressPack` in
  `safe-sensitivity.ts`'s pattern. `LEVER_LABEL`, `LEVER_SHORT` and
  `selectableLevers` gain the four levers, so each is also pickable as a
  tornado bar or axis; `programme_slip` needs no phase picker.
- **Scenarios page:** every card gains the nine missing inputs — a phase
  picker plus months for `phase_slip` (the Sensitivity page's picker,
  lifted), and number inputs for `exit_yield`, `operating_cost`, `vacancy`,
  `saleable_area`, `abnormal_cost`, `programme_slip`, `refi_ltv` — through
  the existing `updateScenario`. A test pins exhaustiveness with a
  `Record<keyof ScenarioOverrides, true>` of rendered labels, so a fourteenth
  lever cannot ship UI-less (the R9 lesson: an array length pins nothing).
- **Costs, Programme, Exit pages:** no change.

---

## 9. §25.6 — Validation

No new document rule. The four levers are reached only through
`ScenarioOverrides` and the suite; a value that produces an invalid levered
document is caught by §12.7. **Today the Scenarios page and the memo's
Scenario Comparison appraise a levered card without validating it**
(`runAppraisal(applyScenario(...))`, both). With four more levers on the
card — `refi_ltv = 100`, `saleable_area = −100` — an invalid levered
document becomes easy to write, so both surfaces adopt §12.7 (decision 15):
validate the levered document; on an error-severity issue show "not
measured" and the first message; appraise only a passing document. The base
card is the base document and is never unmeasured on a document the
calculator itself accepts. §12.6's whole-months rule for `programme_slip` is
the one config rule. Pydantic bounds: none on the four fields (sign and range
are spec rules owned by validation, as every scenario field already is).

---

## 10. §25.7 — Migration and the persistence boundary

`v14 → v15` writes `saleable_area_adjustment_pct: 0`,
`abnormal_cost_adjustment_pct: 0`, `programme_slip_months: 0`,
`refi_ltv_adjustment_pct: 0` on each of `scenarios.{base, upside, downside,
severe}` — **written, not defaulted**, as v12 wrote `sales_slip_months` — and
stamps `inputs_version: 15`. `is_v15` / `isV15` is structural (the four keys
present on `scenarios.base`). The entry-point cutover (`ConversionCalculator`,
`ExportPage`, `memo-fixtures`, `__fixtures__`, `app/api/app.py`) lands in
one commit; the entry-point guards' `EXEMPT` sets and `spec-versions.test.ts`
move with it.

**The identity gate.** `tests/test_migrate_v15.py` and `migrate.test.ts`
compare, on every golden fixture, the raw-v14 arm and the migrated-v15 arm:
metrics **including flags, strictly**; the ledger; the schedule; **and the
default-config `SensitivityResult`** — the last is new to this gate and is
what proves the sorted-application change moved nothing. No exclusion, no
tolerance: no flag, field or figure differs on one arm only.

---

## 11. §25.8 — Stated limitations

1. **Unit loss is an average unit.** −100/N of every unit's area and value,
   not the removal of a named unit; a scheme whose value is concentrated in
   one penthouse understates the loss of *that* unit. A named-unit removal
   lever (with its ledger and retained-unit cascade) is recorded, unowned.
2. **Abnormal cost has nothing to attach to in a detailed plan with no
   abnormal-tagged package.** The row says so. Tagging is the user's
   statement that a package carries abnormal risk; the pack does not invent
   one.
3. **`refi_ltv` moves the cap only.** The DSCR and ICR floors are not
   stressed by the pack; a scheme bound by DSCR shows no movement under
   entry 7, which the flags and the binding-constraint name in §19.4's
   output already make visible.
4. **Entry 9's cost half is a percent of base build**, exact to the bounds
   in §25.3, not a pence-additive line; contingency is therefore taken on
   the crystallised cost too (it scales the base), which is conservative and
   stated.
5. **The pack is not configurable.** A lender with a house stress set edits
   the tornado/matrix, which remains configurable; R16b or later may add a
   per-lender pack if one is asked for.
6. **No API endpoint** publishes the pack (nor the suite). A consumer wanting
   it re-runs the library.

---

## 12. Fixture AA — `aa-stress-pack`

`kind: stress_pack`, two bases, no `inputs` of its own (fixture K's shape):

- **Base Y** (`y-due-diligence`, v13 → migrated): entries 1, 2, 4, 5 and 9
  applicable; 3 (detailed, no abnormal package), 6, 7, 8 (no investment
  case) **inapplicable** — the marking arm is exercised on four rows. Pins:
  `expected_derived` (`unit_loss.saleable_area = −25`,
  `risks_crystallise.cost_pct = 9.807692307692`, `programme_slip = 7`,
  `stated_item_count`, max 3); per entry `applicable`, `profit_pence`,
  `peak_debt_pence`, `flags`, `delta_profit_pence`; the §25.3 detailed-mode
  bound on entry 9.
- **Base U** (`u-investment-case-ltv-binds`, v10 → migrated, headline,
  investment case with the LTV cap binding): entries 6, 7, 8 applicable and
  moving; 7 changes the binding constraint or the take-out quantum (the plan
  derives which by hand); 4, 5, 9 inapplicable (no ledger — U's sales are
  tranche-phased; no DD impacts — U predates §23 and migrates with every
  item `unknown`, so entry 9 is inapplicable on both halves and its note
  names both); 3 applicable (headline: the whole build is the class's base).
  Pins as for Y.

Every expected figure is derived by hand in `test-cases.md` §25 **before**
the fixture's pins are written (R10's reachable-literals rule), from the
migrated document actually constructed. Four new-lever tornado pins are added
to fixture K's shape as `expected_derived_inputs` entries on a v15 copy of
K's config (the plan states the exact steps).

---

## 13. Guards this release must watch fail

1. **The shared-field pair.** The several-orders test with `saleable_area`
   and `gdv` both non-zero, on a unit value where the two orders differ by a
   penny — asserts the stated order's figure. Such values exist and are
   common: at `(−10, +10)`, `1,000,005p` is the smallest above £10,000 —
   `round(round(1,000,005 × 0.9) × 1.1) = round(900,005 × 1.1) = 990,006`,
   while the other order gives `round(1,100,006 × 0.9) = 990,005` (both
   engines agree on both, checked). Watch it fail with the arms swapped in
   `apply_scenario`.
2. **Sorted application in `measure`.** A matrix with rows `gdv` and cols
   `saleable_area` and the same matrix transposed report the same cell
   figures. Watch it fail with caller-order application restored.
3. **`inapplicable ⇒ metrics = base`**, corpus-wide. Watch it fail by making
   entry 3's applicability rule ignore the mode (a headline document would
   then be marked inapplicable while its metrics move).
4. **Entry 9's bound**, both modes. Watch it fail by using `round(p, 2)`
   instead of `round12`.
5. **The v15 identity gate including `SensitivityResult`.** Watch it fail by
   planting a `+1` in the `saleable_area` arm's identity value.
6. **Lever-order parity** across engines. Watch it fail by reordering the
   TS `LEVER_ORDER` tail.
7. **Scenarios exhaustiveness.** Watch it fail by deleting one input.
8. **Memo prints nine rows** on the Y-based memo fixture, with the
   inapplicable notes present. Watch it fail by filtering `applicable`.
9. **Entry-point guard**: fixture Z posted through `POST /appraisals` with
   `inflation.annual_pct = 3` (200; the allowance survives in
   `inputs_snapshot`) and `= −1` (422). Watch the 422 fail by removing
   `ge=0`.
10. **An unmeasured scenario card.** A `downside` card with `refi_ltv = 100`
    on fixture U renders "not measured" on the Scenarios page and in the
    memo's comparison, with §19.7 rule 8's message. Watch it fail by
    restoring the unvalidated `runAppraisal(applyScenario(...))`.

---

## 14. The carried minors, decided

| # | Item | Decision |
|---|---|---|
| 1 | Memo cost-stack Amount column mixes `fmt` (whole £) and `penceToPoundsExact` (2 dp) on the inflation row | The inflation row's Amount uses **`fmt`** like every other row of the table (the pct-derived contingency row already does); the inline package suffix keeps `penceToPoundsExact` |
| 2 | Fixture Z never posted through the API | Guard 9 above |
| 3 | `MOVE_WHOLE_MAX_MM` 110 → 130 unrecorded | Governance §12 gains the entry with R15b's reason (fixture Z's Basis-of-Preparation table at 110.6 mm stranded rows); the global cutoff stays; the per-table alternative is recorded as not taken |
| 4 | `curveWeights` / `spreadUserDefined` user-defined arm divides by a possibly-zero or non-finite sum (TS yields NaN, Python raises) | Both engines: a non-positive or non-finite sum yields the **uniform** vector (`1/n` each) and validation stays the owner of the error (§6.1's weights rules, applied per phase by §18.8, already reject it). TS `base_date` read becomes `typeof qs.base_date === 'string' && qs.base_date.trim() !== ''` |
| 5 | Fixture S's `note` narrates R14 figures as live | Rewritten: body narrates the R15b (2.16.0) figures; the R14 figures move to one paragraph headed "Before R15b, for contrast" |
| 6 | Memo §9 prints raw enum keys and field paths for derived rows | Derived-row evidence prints labels: QS stage/status through the existing label maps; `source` paths through a `DD_DERIVED_SOURCE_LABEL` map ("the cost plan's QS record", "the facility's confirmation state", "the equity sources' evidence status", "the jurisdiction and VAT evidence", "the lender valuation") |
| 6b | Appendix B lists six unknowns then counts | **Left as is**, recorded: catalogue order is category order, which is the order a reader scans the schedule in |
| 6c | §24.7's `base_date` row duplicates rule 8 | **Kept**; §24.7 gains one sentence: reachable only by a caller that skips rule 8, and kept for the two engines' parity on such a caller |
| 7 | A FINAL gate on derived rows | **Declined**, recorded in §25.8: a derived row's `unknown` is a fact about the document, not an omission by its author (`report-provenance.ts`'s reasoning stands) |
| 8 | Cash-flow page eligibility column | **R16b** |

---

## 15. Amendments to other sections

- **§1.6** — v15 in the roster; the calc 2.17.0 paragraph ("changes no
  existing computed value; the v15 gate compares the sensitivity result too").
- **§12.1** — four rows; the two composition statements; the sorted
  application sentence.
- **§12.6** — the `programme_slip` whole-months rule.
- **§12.7** — one sentence: pack cells are cells.
- **§16.4** — the `abnormal` class is a lever target (`abnormal_cost`).
- **§18.9** — `programme_slip` beside `phase_slip`, the sources rule.
- **§19.8** — `refi_ltv`; the carve-out sentence.
- **§23.9** — the "recorded for R16" note becomes *"[R16 — calc 2.17.0]
  built as §25 entry 9"*.
- **§24.7** — the base_date-duplicate sentence (minor 6c).
- **test-cases.md** §25; **migration-notes.md** §18 (v14 → v15);
  **model-governance.md** §3.1 row, §12 entry (minor 3); release plan R16 row
  split, R16b row added.

---

## 16. Out of scope

Everything in R16b (§2); a named-unit removal lever; a configurable pack; a
DSCR/ICR floor stress; a due-diligence lever on the tornado (the pack's
entry 9 is the audit's ask; a lever would need a magnitude nobody has
defined); an API endpoint for the suite or the pack.

---

## 17. Shape of the work

Roughly thirteen tasks, subagent-driven as R9–R15b were, each with its
review; foreground test runs only:

1. Types and defaults, both engines: four `ScenarioOverrides` fields; the
   thirteen-lever `SensitivityLever` / `LEVER_ORDER`; the lever-parity gate.
2. `apply_scenario` / `applyScenario`: four arms, the stated `saleable_area`
   → `gdv` order; the several-orders test extended; the penny-difference
   assertion (guard 1).
3. Sensitivity: `_overrides_for` / `overridesFor` and the zero scenario gain
   four fields; sorted application in `_measure` / `measure` (guard 2);
   §12.6's rule; `_measure`/`measure` exported.
4. Migration v14 → v15 both engines; the identity gate with
   `SensitivityResult` (guard 5); entry-point cutover in one commit; guard 9.
5. `stress_pack.py` / `stress-pack.ts`: `STRESS_PACK`, derivations, the
   applicability rules, `run_stress_pack` / `runStressPack`; the
   corpus-wide implication test (guard 3); the §25.3 bounds (guard 4).
6. Fixture AA and `test-cases.md` §25 (hand derivations first); K's new
   tornado pins.
7. `sensitivity-format.ts`: labels and `selectableLevers`; `safeRunStressPack`.
8. Sensitivity page panel.
9. Scenarios page: nine inputs and the phase picker; §12.7 on the card
   (guard 10); the exhaustiveness test (guard 7).
10. Memo §10 stress table and the comparison's settings rows + §12.7
    (guard 10); memo release gate (guard 8); minor 1; minor 6.
11. Minors 4 and 5 (curves and `base_date`; fixture S's note).
12. Spec §25 and amendments; migration notes §18; governance §3.1 and §12
    (minor 3); release plan.
13. Whole-branch review, the seams (task boundaries) in particular: the
    sorted-application change against fixture K; the Scenarios page's
    levered-document validation against the four new fields; the memo table
    against a memo fixture with an unmeasured stress.
