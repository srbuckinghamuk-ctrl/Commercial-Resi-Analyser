# Financial Model — Test Cases

**Status:** Authoritative test-case register for calculation specification `2.0.0` (see
`docs/financial-model/calculation-specification.md`). This document enumerates every
golden fixture, ledger fixture, invariant and regression vector that pins the engine's
behaviour, in both the TypeScript (frontend) and Python (backend) implementations, and
explains how the two are kept in parity.

---

## 1. How the test suites are organised

| Layer | Purpose | Language(s) |
|---|---|---|
| **Golden fixtures** (`fixtures/financial-model/*.json`) | Whole-pipeline (`runAppraisal`/`run_appraisal`) hand-derived expectations, shared verbatim between TS and Python | TS + Python (shared JSON) |
| **Ledger fixtures** (fixtures B–F, `monthly-engine.test.ts` / `test_financial_model_engine.py`) | Hand-derived expectations for the monthly senior-debt ledger in isolation (`runLedger`/`run_ledger`) | TS + Python (independently transliterated, same pence values — see §3) |
| **Invariant suite** (`invariants.test.ts` / `test_invariants` in `test_financial_model_fixtures.py`) | Structural properties that must hold for *every* fixture and several derived variants, not tied to one hand-computed number | TS + Python (Python subset — see §4) |
| **IRR regression vector** (`irr.test.ts`) | A specific pathological cash-flow vector that caught a real solver defect | TS only (the Python IRR solver shares the same algorithm and is exercised indirectly through the golden fixtures' `irr_annual_pct`) |

---

## 2. Golden fixtures (whole-pipeline, cross-language)

**Shared fixture directory:** `fixtures/financial-model/` (repo root, sibling to `frontend/` and
`tests/`). Each file is a self-contained document: `name`, `kind: "pipeline"`, `inputs` (a full
`CalculatorInputsV3` document, `inputs_version: 3` — since Release 2b Task 2, calc `2.1.0`; see
migration-notes.md §5) and `expected_metrics` (hand-computed key → expected pence/percent value).
The TS suite parses `inputs` with a plain type assertion (no runtime shape check) and runs it
straight through `runAppraisal`; the Python suite validates the full v3 shape with
`CalculatorInputsV3.model_validate` and runs it straight through `run_appraisal` too (Release 2b
Task 3: both engines now consume v3 — including `lender_valuation` — directly; the earlier
downcast-to-v2 adapter that both `app/api/app.py::calculate_authoritative` and this suite carried
since Task 2 is gone). Both assert every key in `expected_metrics`. The hand-computed numbers are
derived once, not independently transliterated per language — this is what makes the parity claim
in §6 meaningful rather than two separately maintained approximations.

**Consumers:**
- TS: `frontend/src/lib/model/golden-fixtures.test.ts`, `frontend/src/lib/model/invariants.test.ts`
- Python: `tests/test_financial_model_fixtures.py` (`test_golden_fixture_parity`, `test_invariants`)

### Fixture A — "A — all-cash conversion, sell all" (`fixtures/financial-model/a-all-cash.json`)

**Purpose:** isolates cost/GDV/profit arithmetic from the finance ledger entirely. 100%
cash-funded (`finance.funding_source: "cash"`), so `finance_costs_pence` must be exactly zero by
engine invariant (spec §3.9, §4.1) and the whole pipeline reduces to acquisition → conversion
cost → sale → profit.

**Inputs (hand-derivable):**
- Acquisition: purchase price £400,000; legal fees £5,000; survey £3,000; broker fee 1.0%
- Unit mix: 4 × one-bed, 50 m² each, £300,000 estimated value each → developer GDV £1,200,000
- Conversion costs: prior approval £96/dwelling; architect £15,000; structural £5,000; M&E
  £5,000; planning consultant £3,000; building control £2,000; construction £1,000/m² × 400 m²;
  contingency 10%
- Finance: `cash` (rate/fee fields present but inert); term 12 months
- Equity: single `cash` source, £900,000, month 0
- Exit: `sell_all`; agent fee 1.5%; selling legal £4,000

**Hand-derivation (spec §3.3–§3.10):**
- SDLT (commercial bands, spec §3.3): 0% to £150,000 + 2% × £100,000 (to £250,000) + 5% ×
  £150,000 (above £250,000) = £0 + £2,000 + £7,500 = **£9,500** → `sdlt_pence = 950,000`
- Acquisition cost = 400,000 + 9,500 + 5,000 + 3,000 + (1% × 400,000 = 4,000) = **£421,500** →
  `acquisition_cost_pence = 42,150,000`
- Construction: base = £1,000 × 400 = £400,000; contingency = 10% × £400,000 = £40,000; total =
  **£440,000** → `construction_cost_pence = 44,000,000`
- Professional fees (spec §3.5: architect + structural + M&E + planning consultant + other —
  **excludes** building control, which is a statutory cost) = 15,000 + 5,000 + 5,000 + 3,000 =
  **£28,000** → `professional_fees_pence = 2,800,000`
- Statutory costs (spec §3.6: prior-approval fee × unit count + CIL/S106 + building control) =
  (£96 × 4 dwellings = £384) + £0 + £2,000 building control = **£2,384** →
  `statutory_costs_pence = 238,400`
- Cost before finance = 421,500 + 440,000 + 28,000 + 2,384 + selling costs (22,000, see below) =
  **£913,884** → `cost_before_finance_pence = 91,388,400`
- Selling costs = agent fee 1.5% × £1,200,000 = £18,000 + selling legal £4,000 = **£22,000** →
  `selling_costs_pence = 2,200,000`
- Finance costs = **£0** (cash — engine invariant)
- TDC = cost before finance (already includes selling costs, spec §3.8) = **£913,884** →
  `total_development_cost_pence = 91,388,400`
- Profit = GDV − TDC = 1,200,000 − 913,884 = **£286,116** → `profit_pence = 28,611,600`
- Profit on cost = 286,116 / 913,884 = **31.31%**; profit on GDV = 286,116 / 1,200,000 = **23.84%**
- `peak_debt_pence = 0`, `day_one_advance_pence = 0`, `gross_ltc_pct = 0` (zero-debt table, spec §9)
- Equity contributed = cost before finance − loan = 913,884 − 22,000 (selling costs funded from
  proceeds, not equity) ≈ **£891,884** → `equity_contributed_pence = 89,188,400`

### Fixture F — "F — development finance 12 months, sell all" (`fixtures/financial-model/f-dev-finance-12mo.json`)

**Purpose:** the deliberate parity companion to Fixture A. Identical acquisition, unit mix,
conversion costs and GDV — `cost_before_finance_pence` is **exactly** £913,884 in both fixtures —
but funded with development finance instead of cash, so the only number that should differ is
everything downstream of `finance_costs_pence`. This is what proves the monthly debt ledger, not
just the headline cost arithmetic, is correct: cost arithmetic parity is fixed by construction
(same inputs), and the finance-driven metrics (peak debt, LTC, LTGDV, IRR) are new, independently
hand-derivable numbers.

**Inputs (deltas from A):**
- Finance: `development_finance`; day-one advance £280,000; development cost advance 100%;
  committed net facility £600,000; committed gross facility £660,000; 8.0% p.a.; `rolled_up`;
  arrangement fee 2.0% (basis: net facility); exit fee 1.0% (basis: gross facility); term 12
  months; `equity_first`; sweep 100%
- Equity: single `cash` source, £350,000, month 0

**Expected outputs (pence unless noted):**

| Metric | Value | £ |
|---|---:|---:|
| `cost_before_finance_pence` | 91,388,400 | £913,884 (identical to A) |
| `finance_costs_pence` | 5,076,553 | £50,765.53 |
| `total_development_cost_pence` | 96,464,953 | £964,649.53 |
| `profit_pence` | 23,535,047 | £235,350.47 |
| `profit_on_cost_pct` | — | 24.40% |
| `profit_on_gdv_pct` | — | 19.61% |
| `peak_debt_pence` | 58,604,953 | £586,049.53 |
| `day_one_advance_pence` | 28,000,000 | £280,000 |
| `gross_ltc_pct` | — | 60.75% |
| `net_ltc_pct` | — | 62.10% |
| `ltgdv_developer_pct` | — | 48.84% |
| `irr_annual_pct` | — | 91.2% |
| `equity_contributed_pence` | 35,000,000 | £350,000 |

### Fixture A/F worksheet note — v2 → v3 additive-only proof (Release 2b Task 2)

Both fixtures' `inputs` blocks were updated to `inputs_version: 3` (from `2`), with
`lender_valuation: null` and `finance.enforcement_cost_assumption_pence: 0` added (calc `2.1.0`,
see `docs/financial-model/migration-notes.md` §5). **No value in either fixture's `expected_metrics`
block changed** — every pence/percent figure hand-derived above is still exactly what both engines
produce. The full TS and Python suites passing green (`npx vitest run`: 220 passed; `python -m
pytest -q`: 160 passed) against these unchanged pinned numbers, with only the input shape widened,
*is* the additive-only proof for the v2→v3 migration: if the migration had silently altered any
existing field or its downstream arithmetic, one of these two fixtures' hand-derived values would
have moved and the suite would fail.

### Fixture G — "G — lender-underwritten GDV, global_pct haircut (spec §3.2)" (`fixtures/financial-model/g-lender-valuation.json`)

**Purpose:** pins the lender-underwritten GDV variance bridge (spec §3.2, Release 2b Task 3) —
the first fixture that exercises a non-null `lender_valuation` block. G is byte-for-byte fixture F
(identical acquisition, unit mix, conversion costs, finance, equity, exit strategy) with one
addition: a `global_pct` lender haircut of `-10`. Every `expected_metrics` key already pinned by F
is copied verbatim into G's `expected_metrics` — this is what proves the lender block is *additive*:
if wiring the block had disturbed any existing developer-side figure, G's copy of F's numbers would
fail alongside the four new lender-basis keys.

**Inputs (delta from F):**
- `lender_valuation`: `{ basis: "global_pct", global_value: -10, per_key_values: null, reason: "Fixture: lender haircut for valuation-basis testing", author: "governance", date: "2026-08-13" }`

**Hand-derivation (spec §3.2):**
- Developer unit values (pinned by F): 4 × £300,000 = **£1,200,000** → `gdv_pence = 120,000,000`
  (unchanged in G — the lender block never touches the developer-side GDV).
- Lender unit value per unit (`global_pct` basis: `round_half_up(dev_value × (1 + global_value/100))`):
  round(£300,000 × 0.90) = **£270,000** → 27,000,000p, for each of the 4 identical units.
- Lender GDV = Σ lender unit values = 4 × £270,000 = **£1,080,000** → `lender_gdv_pence = 108,000,000`.
- Variance = lender GDV − developer GDV = 1,080,000 − 1,200,000 = **−£120,000** →
  `lender_gdv_variance_pence = -12,000,000`; variance % = pct(−12,000,000, 120,000,000) =
  **−10.00** → `lender_gdv_variance_pct = -10.0`.
- Peak debt is **unchanged** by the valuation block (58,604,953p, F's pinned value — the senior
  ledger only ever draws against actual costs, never against GDV of any kind) →
  `ltgdv_lender_pct = pct(58,604,953, 108,000,000)` = 58,604,953 / 108,000,000 = 0.5426384537... ×
  100 = 54.263845...%, rounded to 2dp = **54.26** → `ltgdv_lender_pct = 54.26`.
- Every other `expected_metrics` key (developer GDV, cost arithmetic, `ltgdv_developer_pct`, IRR,
  etc.) is copied verbatim from F — the lender block must not move the pre-existing ledger.

**Expected outputs added on top of F's pinned block (pence unless noted):**

| Metric | Value | £ |
|---|---:|---:|
| `lender_gdv_pence` | 108,000,000 | £1,080,000 |
| `lender_gdv_variance_pence` | -12,000,000 | −£120,000 |
| `lender_gdv_variance_pct` | — | −10.00% |
| `ltgdv_lender_pct` | — | 54.26% |

**TDD evidence (Task 3):** with `metrics.ts`/`metrics.py` reverted to their pre-Task-3 null-wiring
(`lender_gdv_pence: null`, etc. — the rest of the implementation, including `lender-valuation.ts`/`.py`
and the `validation.ts`/`.py` hard-error checks, left in place), both `test_golden_fixture_parity[g-lender-valuation]`
(Python) and the TS golden-fixtures/`invariants.test.ts` runs for fixture G fail exactly on the four
new keys above (RED). Restoring the wiring turns both green (GREEN) — see `task-3-report.md` for the
full transcript.

### Fixture G worksheet, part 2 — senior repayment break-even (spec §5.11, Release 2b Task 4)

**Purpose:** pins `solveSeniorBreakeven`/`solve_senior_breakeven` — the minimum gross sale price `P`
(pence) that fully redeems the senior facility, given the disposal-month redemption balance, the exit
fee due on redeeming it, and the exit strategy's selling-cost terms. G is F's ledger, so the
redemption balance and exit fee are F's pinned figures; G's `lender_gdv_pence` (108,000,000, §3.2
above) supplies the two percentage forms.

**Step 1 — verified (not assumed) inputs, from the pinned ledger, not the brief's original
assumption:** fixture F/G's `finance.committed_gross_facility_pence` is **explicitly `66,000,000`**
in the fixture JSON — it is not `null` and is therefore never derived as `net + reserve
(60,000,000 + 0)`. Running the live engine on fixture F (`totals.exit_fee_pence`, the pinned ledger
total) confirms:
- `redemption_balance_at_disposal_pence` (month 11, pre-receipt) = **58,604,953p** — equal to F's
  pinned `peak_debt_pence`, since month 11 (the disposal month, `term_months − 1 = 11`) is also the
  peak-debt month here.
- `exit_fee_basis = "committed_gross_facility"`, so the exit fee is `round(1% × 66,000,000) =`
  **660,000p** — not 600,000p as an earlier draft of this worksheet assumed before the fixture's own
  gross-facility figure was checked. (This correction is recorded in
  `.superpowers/sdd/2026-08-13-release-2b-lender-metrics/task-4-report.md`: the coordinator confirmed
  the fixture is authoritative and amended the plan's worksheet to match, rather than the other way
  round.)

**Step 2 — solver worksheet.** Fixture G's exit terms: `selling_agent_fee_pct = 1.5`,
`selling_legal_fee_pence = 400,000`, `enforcement_cost_assumption_pence = 0`. `P` must satisfy:
```
P ≥ 58,604,953 + 660,000 + round(0.015 × P) + 400,000 + 0
  = 59,664,953 + round(0.015 × P)
```
Closed-form guess: `59,664,953 / 0.985 = 60,573,556.345…`. Hand-checked integers either side of the
guess:
- `P = 60,573,555`: `round(0.015 × 60,573,555) = round(908,603.325) = 908,603`; RHS =
  `59,664,953 + 908,603 = 60,573,556`; `60,573,555 < 60,573,556` → **infeasible**.
- `P = 60,573,556`: `round(0.015 × 60,573,556) = round(908,603.34) = 908,603`; RHS = `60,573,556`;
  `60,573,556 ≥ 60,573,556` (equality) → **feasible**.

So the minimum feasible integer, and the expected `senior_breakeven_pence`, is **60,573,556**.

Percentages (`pct()`, round-half-up to 2dp, against `lender_gdv_pence = 108,000,000`):
- `senior_breakeven_pct_of_lender_gdv = pct(60,573,556, 108,000,000)` = 60,573,556 / 108,000,000 =
  0.56086625… × 100 = 56.086625…%, rounded = **56.09**.
- `senior_breakeven_fall_from_lender_gdv_pct = pct(108,000,000 − 60,573,556, 108,000,000) =
  pct(47,426,444, 108,000,000)` = 0.43913… × 100 = 43.913…%, rounded = **43.91**.
- `56.09 + 43.91 = 100.00` ✓ (asserted directly in both invariant suites, for every fixture where the
  percentages are non-null).

**Expected outputs added on top of F/G's pinned block (pence unless noted):**

| Metric | Value | £ |
|---|---:|---:|
| `senior_breakeven_pence` | 60,573,556 | £605,735.56 |
| `senior_breakeven_pct_of_lender_gdv` | — | 56.09% |
| `senior_breakeven_fall_from_lender_gdv_pct` | — | 43.91% |

**TDD evidence (Task 4):** with `metrics.ts`/`metrics.py`'s three `senior_breakeven_*` fields still
null-wired (pre-Task-4), both `test_golden_fixture_parity[g-lender-valuation]` (Python) and the TS
`golden-fixtures.test.ts` run for fixture G fail exactly on `senior_breakeven_pence: None/null !=
60573556` (RED). Wiring `deriveMetrics`/`derive_metrics` to call `solveSeniorBreakeven`/
`solve_senior_breakeven` turns both green — see `task-4-report.md` for the full transcript, including
the ledger-field (`redemption_balance_at_disposal_pence`) and solver-unit RED/GREEN cycles.

**Invariants added (both languages, every fixture, not just G):**
1. `senior_breakeven_pence` is null **iff** `redemption_balance_at_disposal_pence` is null (cash
   deals and no-disposal schedules both null; every disposal — even an under-swept one — non-null).
2. When non-null, `senior_breakeven_pence ≥ redemption_balance_at_disposal_pence + exit_fee_amount(...)`
   (the exit fee recomputed independently from the facility's basis terms, not read off
   `totals.exit_fee_pence`, since that total is the fee actually *charged* and is zero whenever the
   real disposal under-swept the balance — spec §4.4 — while break-even asks what fee *would* be due
   on full redemption).
3. `senior_breakeven_pct_of_lender_gdv`/`senior_breakeven_fall_from_lender_gdv_pct` are null unless a
   lender GDV is present, and sum to 100.00 (within rounding) when both are present.
4. Cash fixture A: all three fields are null (asserted directly, not just via the iff invariant).

**Bisection midpoint: floor-divide, never a 32-bit bit-shift.** `solveSeniorBreakeven`'s midpoint is
`Math.floor((lo + hi) / 2)` (TS) / `(lo + hi) // 2` (Python) — **never** `(lo + hi) >> 1`. An earlier
draft of this task used `>>1` in TS, which coerces its operands to a 32-bit signed integer. For a
redemption balance at or above `2**31` pence (~£21.47m — a realistic scale for a large commercial
deal), the closed-form `hi` exceeded the safe 32-bit range and the bit-shift corrupted `mid`,
exhausting the 200-iteration cap and returning `null` for a genuinely solvable deal — empirically
confirmed, at the time, at `redemption_balance_pence = 5,000,000,000` (~£50m), where the correct
answer is **5,076,649,746** (worksheet: `fee_floor = 5,000,000,000 + 100,000 + 400,000 =
5,000,500,000`; closed-form guess `5,000,500,000 / 0.985 = 5,076,649,746.19…`; hand-checked boundary
— `P = 5,076,649,745` is infeasible (`round(1.5% × P) = 76,149,746`, RHS `= 5,076,649,746`, `P < RHS`);
`P = 5,076,649,746` is feasible at equality). This is now fixed to `Math.floor((lo+hi)/2)`, which has
no such ceiling, and both languages converge to the identical integer — a permanent regression test
at this exact scale in both `breakeven.test.ts` and `tests/test_financial_model_breakeven.py` pins
`5,076,649,746` in both languages, so a future re-introduction of `>>1` (or any other language-specific
divergence at scale) fails immediately. Both fixtures F/G's redemption balances (~£586k) are far below
this scale, so neither pinned value was ever affected. See `task-4-report.md` for the full history
(the bug was caught, then confirmed genuine by direct reproduction, before the fix landed).

### Fixture G worksheet, part 3 — developer profit break-even (spec §5.12, Release 2b Task 5)

**Purpose:** pins `solveDeveloperBreakeven`/`solve_developer_breakeven` — the minimum gross sale
price `P` (pence) that covers the *entire* total development cost (TDC) excluding selling costs
(selling costs are re-solved at `P` itself, per §5.12), independent of any lender/debt figures.
`solveSeniorBreakeven` and `solveDeveloperBreakeven` now share one private bisection helper per
language (`bisectMinimalFeasible` (TS) / `_bisect_minimal_feasible` (Python)) — extracted from
Task 4's solver with no behavioural change (Task 4's full suite, including the 32-bit-midpoint
regression pin at `5,076,649,746` and the `10**80` iteration-cap pin, is re-run unmodified against
the refactored code and stays green).

**Step 1 — worksheet, fixture F/G.** `tdc_ex_selling_pence = total_development_cost_pence −
selling_costs_pence`. F/G's pinned `total_development_cost_pence = 96,464,953` and
`selling_costs_pence = 2,200,000` (read from the fixture JSON's `expected_metrics`, not assumed —
`acquisition_pence`/`construction_pence`/etc. sum differently and selling costs are agent fee +
legal fee on the *realised* GDV, a separate figure from the break-even solve itself):
```
tdc_ex_selling = 96,464,953 − 2,200,000 = 94,264,953
```
Exit terms (fixture F/G): `selling_agent_fee_pct = 1.5`, `selling_legal_fee_pence = 400,000`. `P`
must satisfy:
```
P ≥ 94,264,953 + 400,000 + round(0.015 × P)
  = 94,664,953 + round(0.015 × P)
```
Closed-form guess: `94,664,953 / 0.985 = 96,106,551.269…`. Hand-checked integers either side:
- `P = 96,106,550`: `round(0.015 × 96,106,550) = round(1,441,598.25) = 1,441,598`; RHS =
  `94,664,953 + 1,441,598 = 96,106,551`; `96,106,550 < 96,106,551` → **infeasible**.
- `P = 96,106,551`: `round(0.015 × 96,106,551) = round(1,441,598.265) = 1,441,598`; RHS =
  `96,106,551`; `96,106,551 ≥ 96,106,551` (equality) → **feasible**.

So the minimum feasible integer, and the expected `developer_breakeven_pence` for fixture G, is
**96,106,551**. (Added to fixture G's `expected_metrics` only, per the Task 5 brief — fixture F is
not touched, since F already carries no `senior_breakeven_*` keys either and this worksheet reuses
F's pinned ledger figures purely to derive G's number.)

**Step 2 — worksheet, fixture A (cash, sell-all).** Fixture A's own pinned figures (from its own
`expected_metrics`, not F/G's): `total_development_cost_pence = 91,388,400`,
`selling_costs_pence = 2,200,000`, and its `exit_strategy` (read from `a-all-cash.json`) is the
same `selling_agent_fee_pct = 1.5`, `selling_legal_fee_pence = 400,000` as F/G:
```
tdc_ex_selling = 91,388,400 − 2,200,000 = 89,188,400
P ≥ 89,188,400 + 400,000 + round(0.015 × P) = 89,588,400 + round(0.015 × P)
```
Closed-form guess: `89,588,400 / 0.985 = 90,952,690.355…`. Hand-checked integers either side:
- `P = 90,952,689`: `round(0.015 × 90,952,689) = round(1,364,290.335) = 1,364,290`; RHS =
  `89,588,400 + 1,364,290 = 90,952,690`; `90,952,689 < 90,952,690` → **infeasible**.
- `P = 90,952,690`: `round(0.015 × 90,952,690) = round(1,364,290.35) = 1,364,290`; RHS =
  `90,952,690`; `90,952,690 ≥ 90,952,690` (equality) → **feasible**.

So fixture A's expected `developer_breakeven_pence` is **90,952,690** — non-null, unlike
`senior_breakeven_pence` (null for A, since it is a cash deal with no facility to redeem).
`developer_breakeven_pence` is lender-independent *and* debt-independent: it is computed whenever
the schedule totals show any disposal at all (`gross_sales_pence > 0`), not gated on a redemption
balance existing. A retain-only appraisal (`gross_sales_pence == 0`, e.g. `retain_all`) gets `null`
— there is no sale price to solve for.

**Deliberate non-assertion (design §B5):** no test anywhere asserts an ordering relationship
between `senior_breakeven_pence` (§5.11) and `developer_breakeven_pence` (§5.12) — e.g. that one
must be ≥/≤ the other. They answer different questions (redeem the facility vs. cover the whole
TDC) over different cost bases (redemption balance + exit fee + enforcement vs. TDC-ex-selling),
so no general inequality holds between them across all inputs; asserting one would be asserting an
accidental property of these two fixtures, not a real invariant.

**TDD evidence (Task 5):** with `metrics.ts`/`metrics.py`'s `developer_breakeven_pence` still
null-wired (pre-Task-5), both `test_golden_fixture_parity[g-lender-valuation]` (Python) and the TS
`golden-fixtures.test.ts` run for fixture G fail exactly on `developer_breakeven_pence: None/null !=
96106551` (RED). Wiring `deriveMetrics`/`derive_metrics` to call `solveDeveloperBreakeven`/
`solve_developer_breakeven` turns both green — see `task-5-report.md` for the full transcript.

**Invariants added (both languages):**
1. `developer_breakeven_pence` is null **iff** the schedule's `gross_sales_pence` is `0` (checked
   across every fixture, not just G/A) — a strictly wider condition than the senior break-even's
   `redemption_balance_at_disposal_pence`-null guard, since it does not depend on any facility
   existing at all.
2. `pct ≥ 100` nulls the result and raises a red `developer_breakeven_unsolvable` flag on the model
   (metrics-level, `code`/`severity`/`month`/`amount_pence`/`message` identical in shape to Task 4's
   `senior_breakeven_unsolvable`, asserted exactly-once), tested through `deriveMetrics`/
   `derive_metrics` in both languages.

### Fixture G worksheet, part 4 — cost-to-complete (spec §5.10, Release 2b Task 6)

**Purpose:** pins `computeCostToComplete`/`compute_cost_to_complete` — a per-month series of
remaining cost vs. remaining committed funding on the straight-line schedule, reporting the first
month (if any) that goes into deficit and the largest deficit across the series.

**Indexing convention (resolved from the brief's telescoping/boundary invariants, not assumed):**
the series is labelled `m = 1..term` (`term = schedule.term_months`). Label `m` reports the state
as of the **completion** of ledger month `m − 1` (ledger months are 0-based —
`LedgerMonth.month === m − 1`): `remaining_cost(m)` sums `schedule.uses[m..term−1]` plus
`model.months[m..term−1]`'s interest/capitalised-fees — i.e. everything **strictly after** ledger
month `m − 1`, excluding whatever that month itself spent. `remaining_funding(m)` reads ledger
month `m − 1`'s own `undrawn_net_facility_pence` (the undrawn amount immediately after that
month's draw) plus committed cash equity not yet contributed through ledger month `m − 1`
inclusive. `m = term` is a valid final label — `remaining_cost(term)` is the empty sum (0), a
terminal "nothing left to spend" checkpoint; `remaining_funding(term)` still reads a real,
in-bounds ledger month (`term − 1`, the last one). This is not a free choice: it is the *only*
reading consistent with both of the brief's own invariants —
`remaining_cost(m) = remaining_cost(m+1) + cost(month m+1)` (telescoping) and
`remaining_cost(1) = total cost − month-0 spend` (boundary) — checked algebraically before any
code was written, then confirmed against a scratch reproduction of the formula for Fixture B and
Fixture G before being written here.

**Step 1 — worksheet, Fixture B** (§3's rolled-up-interest ledger — the smallest fully pinned
table among B–F, per the brief). From B's pinned columns (`monthly-engine.test.ts`/
`test_financial_model_engine.py`): `interest_accrued_pence` = 310,000 / 313,100 / 366,231 /
369,893; `capitalised_fees_pence` = 1,000,000 / 0 / 0 / 0; `equity_contribution_pence` =
10,000,000 / 15,000,000 / 5,000,000 / 0; `undrawn_net_facility_pence` (net facility 50,000,000
minus cumulative net used) = 19,000,000 / 19,000,000 / 14,000,000 / 14,000,000. Uses:
`[40,000,000; 15,000,000; 10,000,000; 0]` (acquisition month 0, construction months 1–2, no
lender-ancillary-fees line populated by `buildSchedule` in the current engine — always 0, summed
defensively per the spec formula regardless). Committed cash equity = 30,000,000 (single
confirmed source).

| label `m` | remaining cost | remaining funding | surplus |
|---:|---:|---:|---:|
| 1 | 26,049,224 | 39,000,000 | 12,950,776 |
| 2 | 10,736,124 | 24,000,000 | 13,263,876 |
| 3 | 369,893 | 14,000,000 | 13,630,107 |
| 4 | 0 | 14,000,000 | 14,000,000 |

Worked example (`m = 1`): remaining cost = uses[1..3] (15,000,000 + 10,000,000 + 0) +
interest[1..3] (313,100 + 366,231 + 369,893) + capFees[1..3] (0) = 26,049,224. Remaining funding =
undrawn at ledger month 0 (19,000,000) + (30,000,000 committed equity − 10,000,000 contributed
through month 0) = 39,000,000. Surplus = 12,950,776 > 0. Fully funded throughout:
`first_shortfall_month = null`, `max_shortfall_pence = 0`.

**Step 2 — worksheet, cash-deal path** (self-review requirement: the cash path must be tested,
not just typed as `| 0`). Same USES/SALE as Fixture B, `funding_source: 'cash'`, equity
**exactly** 65,000,000 = total cost (40M + 15M + 10M + 0), matching the existing zero-debt sanity
check at the bottom of `monthly-engine.test.ts`/`test_financial_model_engine.py`. Cash deals have
`undrawn_net_facility_pence = null` throughout (no facility, not merely undrawn) — this pins the
brief's "null → 0" instruction, distinctly from the low-headroom case where the field is a real
number:

| label `m` | remaining cost | remaining funding | surplus |
|---:|---:|---:|---:|
| 1 | 25,000,000 | 25,000,000 | 0 |
| 2 | 10,000,000 | 10,000,000 | 0 |
| 3 | 0 | 0 | 0 |
| 4 | 0 | 0 | 0 |

Every surplus is **exactly** 0 (equity funds the whole cost, not a penny more) — a deliberate edge
case pinning `surplus < 0` (strict), not `<= 0`: a fully-funded-to-the-penny deal must not be
misreported as a shortfall.

**Step 3 — Fixture G's flat golden-fixture keys.** Fixture G shares Fixture F's ledger inputs
exactly (only `lender_valuation` differs — verified by diffing the two fixtures' `inputs` blocks
with `lender_valuation` stripped, not assumed). Running the live engine on Fixture G:
`model.totals.funding_gap_pence == 0` (no month ever gaps — confirmed live, not inferred from the
absence of a pinned figure) — so both `first_shortfall_month: null` and `max_shortfall_pence: 0`
are correct, added to `g-lender-valuation.json`'s `expected_metrics` as flat keys (per the brief,
for fixture-authoring simplicity) and mapped onto the nested `cost_to_complete` summary by a small
lookup table in both `golden-fixtures.test.ts` and `test_financial_model_fixtures.py`'s
`test_golden_fixture_parity` — every other key in that test still goes through the direct
attribute path unchanged.

**Invariants added (both languages), `cost-to-complete.test.ts` / `test_financial_model_cost_to_complete.py`:**
1. **Telescoping:** `remaining_cost(m) == remaining_cost(m+1) + cost(month m+1)`, checked across
   Fixture B's whole series.
2. **Boundary:** `remaining_cost(1) == total cost − month-0 spend`, checked for Fixture B.
3. **Fully-funded ⇒ no shortfall** and **exact-zero-surplus ⇒ no shortfall**, both on Fixture B
   and the cash-deal path respectively.

**The shortfall/`funding_gap_pence` relationship — neither direction of the brief's proposed `⇔`
is a general property of the engine (both directions independently disproved, both proofs kept as
permanent regression tests):**

- **`funding_gap` ⇏ shortfall.** `test_financial_model_engine.py`'s `TestFixtureFGrossHeadroomCap`
  (gross-facility-headroom cap, spec §4.2(c)) has a real, pinned `funding_gap_pence = 484,487` at
  month 2 — yet `computeCostToComplete` on the same schedule reports `first_shortfall_month: null`,
  `max_shortfall_pence: 0`. Reason: the series is a **static snapshot** of already-realised
  `undrawn_net_facility_pence` at each past month boundary, not a re-simulation of the ledger's own
  future month-by-month throttling — it has no way to know that a *later* month's draw will be
  capped below what's needed. This is now a dedicated, permanently pinned test
  (`'Fixture F-grosscap: a real funding_gap can exist with NO cost-to-complete shortfall'` in both
  languages), not just a one-off observation.
- **Shortfall ⇏ `funding_gap`, in general (not exercised by any pinned fixture, but real).**
  Constructed during verification (not committed as a fixture): serviced interest at a very high
  rate (200% p.a., deliberately extreme) with generous facility headroom but thin committed equity
  produces `model.totals.funding_gap_pence == 0` (the interest shortfall is absorbed by
  uncommitted "additional equity", spec §4.3 — which never routes through the `funding_gap`-tracked
  cash-uses waterfall at all) while `computeCostToComplete` shows a genuine, large shortfall
  (interest forecast exceeds committed sources). This is recorded here as a known scope boundary,
  not asserted anywhere, since no existing fixture reaches it either way.
- **What *is* asserted, and holds across every fixture currently in the suite** (both golden A/F/G
  and the hand-built ledger fixtures B–F, cash-variant): `first_shortfall_month != null ⇒
  model.totals.funding_gap_pence > 0`. Fixture E (`committed_net_facility_pence` lowered to
  35,000,000, equity to 25,000,000 — a real, pinned `funding_gap_pence = 5,700,000`) is the one
  fixture in the corpus with a genuine positive case for this implication (shortfall **and** gap
  both present, `first_shortfall_month = 1`); every other fixture satisfies it vacuously (no
  shortfall). A parametrised test over every file in `fixtures/financial-model/*.json` checks this
  too, alongside the two hand-built positive/negative cases above.

Spec §5.10 has been amended with a "Known limitation" paragraph recording this scope precisely
(`docs/financial-model/calculation-specification.md`), so a future reader of the spec — not just
this test-cases file — sees the boundary.

---

## 3. Ledger fixtures B–F — pinned in BOTH languages

**Files:** `frontend/src/lib/model/monthly-engine.test.ts` (TS, the original) and
`tests/test_financial_model_engine.py` (Python, an explicit transliteration — its module docstring
says so verbatim: *"Transliteration of frontend/src/lib/model/monthly-engine.test.ts fixtures B-F.
Both implementations must agree with the hand-computed ledger (spec Sec 8), not merely with each
other. If Python disagrees with a fixture, the Python port is wrong — never adjust these numbers to
make peace."*).

These are hand-built four-month ledgers that call `runLedger`/`run_ledger` directly (not the full
pipeline), sharing a common `TERMS` base (spec §8 rolled-up base case: day-one advance £300,000;
committed net £500,000; committed gross £550,000; 12% p.a. → 1%/month; arrangement 2% of net; exit
fee 1% of gross; rolled-up interest; `equity_first`; 100% sweep) and a common uses/sale schedule
(month 0 acquisition £400,000; month 1 construction £150,000; month 2 construction £100,000; month
3 sale £800,000 gross, agent fee £16,000) — reproduced independently in each language's test file
(`TERMS`/`USES`/`SALE`/`NO_SALE` in TS; the same names in `test_financial_model_engine.py`), not
loaded from a shared JSON file the way the whole-pipeline golden fixtures (§2) are. Every pence
value asserted below is asserted identically, by hand-transliterated test code, in both
`TestFixtureBRolledUpInterest`/`TestFixtureCServicedInterest`/`TestFixtureDRetainAll`/
`TestFixtureEFundingGap`/`TestFixtureFGrossHeadroomCap`/`TestCashFunding` (Python) and the
corresponding `describe` blocks (TS). This was ported and reviewed as part of Task 11
(`.superpowers/sdd/2026-08-12-release-1-p0-financial-correction/progress.md`: *"Task 11: complete
... port fidelity line-by-line verified; 139/139 backend"*).

### Fixture B — rolled-up interest (spec §8 worked example, reproduced in code)

Equity £300,000. Hand-computed: month 0 draw £300,000, arrangement fee £10,000 (2% × £500,000),
interest £3,100 (1% × £310,000), closing £313,100, equity contribution £100,000. Month 1: interest
£3,131, closing £316,231. Month 2: draw £50,000, interest £3,662.31, closing £369,893.31. Month 3:
interest £3,698.93, exit fee £5,500 (1% × £550,000), repayment £373,592.24, closing £0,
distribution £404,907.76. Peak debt £373,592.24 (month 3). Total interest £13,592.24; finance
costs £29,092.24. Equity cash flows `[-100,000, -150,000, -50,000, +404,907.76]`. Roll-forward
invariant (`closing = opening + draw + capitalised_fees + interest_capitalised − repayment`) and
non-negativity are checked every month. **Python:** `TestFixtureBRolledUpInterest` in
`test_financial_model_engine.py` (three test methods) asserts the identical pence values, e.g.
`assert m.months[3].repayment_pence == 37_359_224`, `assert m.equity_cashflows_pence ==
[-10_000_000, -15_000_000, -5_000_000, 40_490_776]`.

### Fixture C — serviced interest differs from rolled-up

Same schedule, `interest_type: 'serviced'`, equity £320,000. Month 0: interest serviced £3,100
(paid from equity, not capitalised), closing balance £310,000 (flat — no compounding), equity
contribution £103,100. Month 2: committed equity is exhausted (£63,800 of costs funded from a
draw of £36,200) and serviced interest of £3,462 becomes `additional_equity_pence` — the engine's
explicit "additional equity required to service interest" flag (spec §4.3), not a silent gap.
Peak debt £346,200. Total interest £13,124; total additional equity £6,924. Distribution £432,300.
This fixture is the one that demonstrates `interest_type` is an effective model switch (audit P0:
"the selected...serviced/rolled-up interest choice do[es] not change the calculation" — corrected).
**Python:** `TestFixtureCServicedInterest` — same pence values, e.g.
`assert m.peak_debt_pence == 34_620_000`, `assert sum(m.equity_cashflows_pence) == 10_537_600`.

### Fixture D — `retain_all` books no receipts and flags outstanding debt

Same schedule and TERMS as B, but zero sale receipts in every month (`NO_SALE`). Debt builds up
identically to Fixture B through month 3 (closing £373,592.24) but is **never repaid** —
`senior_outstanding_at_maturity_pence = 37,359,224`, `totals.exit_fee_pence = 0`,
`totals.distributions_pence = 0`, and a red `senior_outstanding_at_maturity` flag is raised.
Equity cash flows `[-100,000, -150,000, -50,000, 0]` — no terminal distribution, which is what
forces IRR to `null` by construction (spec §3.17). Directly corrects audit P0: "`retain_all` still
books the entire GDV as sale income in the final month." **Python:** `TestFixtureDRetainAll` —
`assert m.senior_outstanding_at_maturity_pence == 37_359_224`,
`assert m.equity_cashflows_pence == [-10_000_000, -15_000_000, -5_000_000, 0]`.

### Fixture E — funding gap: overruns never create facility

`committed_net_facility_pence` shrunk to £350,000; equity £250,000. **Arrangement fee recomputes
from its basis** (spec §3.9): 2% × £350,000 = **£7,000** (`700,000`p) — this is the corrected
value after the Task 4 brief error was caught and re-derived mid-implementation (see
`.superpowers/sdd/2026-08-12-release-1-p0-financial-correction/progress.md`, Task 4 entry). Month
2's required draw of £50,000 is capped at the undrawn net facility, giving a draw of £43,000 and a
`funding_gap_pence` of £57,000, flagged red at month 2. The gap is never absorbed by an automatic
facility increase — it accumulates and is reported (spec §4.2 step 3, and audit P0 "downside costs
automatically produce a larger loan" — corrected). Month 2: closing £359,732.41
(`months[2].closing_balance_pence == 35_973_241`). Month 3: repayment £363,329.73 + the £5,500
exit fee (1% of the unchanged £550,000 committed gross facility — TERMS.exit_fee_basis/
committed_gross_facility_pence are not overridden in this fixture, only committed_net_facility_pence
is), distribution £415,170.27. **Python:** `TestFixtureEFundingGap` —
`assert m.months[0].capitalised_fees_pence == 700_000` (the corrected 2%×£350,000 arrangement fee),
`assert m.months[3].repayment_pence == 36_332_973`, `assert m.months[3].distribution_pence ==
41_517_027` (`test_financial_model_engine.py:200-209`) — the same corrected values as the TS
fixture, not the brief's original (uncorrected) numbers.

### Fixture "F-grosscap" — gross-headroom draw cap (spec §4.2(c))

Fixture-B TERMS with `committed_gross_facility_pence` shrunk to £365,000 (net facility unchanged
at £500,000, so the gross ceiling — not the net one — is the binding constraint here). This is a
**correction made during implementation** (progress ledger, Task 4 fix round 1): the spec requires
a monthly senior draw to be capped not only by undrawn net facility and the development-cost
advance percentage, but also by "gross facility headroom after projected interest" — i.e. a draw
must not push the closing balance, once that month's own interest is added, past the committed
gross facility. Hand-derived expectations, confirmed verbatim in the test:

```
Months 0-1 identical to Fixture B (headroom does not bind while balances are low).
m2: needed draw 5,000,000; grossHeadroomCap = floor(36,500,000 / 1.01) − 31,623,100
                                            = 36,138,613 − 31,623,100 = 4,515,513
```

- `months[2].draw_pence = 4,515,513` (£45,155.13)
- `months[2].funding_gap_pence = 484,487` (£4,844.87 — the £50,000 need minus the capped draw)
- `months[2].interest_accrued_pence = 361,386`
- `months[2].closing_balance_pence = 36,499,999` — one penny under the £36,500,000 gross cap by
  deliberate floor-rounding of the headroom formula
- Every month's closing balance is asserted `<= 36,500,000`, and a red `funding_gap` flag is
  raised.

This is the fixture that proves the audit P0 "no facility-exceeded warning despite peak funding
exceeding the nominal loan" cannot recur: the ledger physically cannot draw past the committed
gross facility, and any shortfall is a visible, flagged funding gap rather than a silent breach.

**Python:** `TestFixtureFGrossHeadroomCap` (`test_financial_model_engine.py:212-235`) asserts the
identical values — `assert m.months[2].draw_pence == 4_515_513`, `assert
m.months[2].funding_gap_pence == 484_487`, `assert m.months[2].closing_balance_pence ==
36_499_999`, and the same `<= 36_500_000` ceiling check on every month — with the same inline
derivation comment reproduced in the Python test.

A further zero-debt sanity check sits at the bottom of both files (`funding_source: 'cash'`, equity
£650,000): all draws, finance costs and peak debt are exactly zero, and every closing balance is
zero — the same zero-debt invariant as Fixture A, exercised directly at the ledger level. TS:
the trailing block in `monthly-engine.test.ts`. Python: `TestCashFunding` in
`test_financial_model_engine.py`.

---

## 4. Invariant suite

**Files:** `frontend/src/lib/model/invariants.test.ts` (full); `tests/test_financial_model_fixtures.py::test_invariants` (subset: #1 roll-forward and #6's sources-equal-uses check only).

The TS suite runs every fixture in `fixtures/financial-model/*.json` (currently A and F) through
four derived variants — `base`, `retain_all` (exit route forced to `retain_all`), `serviced`
(interest type forced to `serviced`), `term=1` (term forced to one month) — giving 2 fixtures × 4
variants = 8 independent checks of each invariant below, not just the two literal fixtures:

1. **Debt roll-forward invariant** — every month, `closing = opening + draw + capitalised_fees +
   interest_capitalised − repayment`, and `closing >= 0` always (spec §4, roll-forward invariant).
2. **Peak debt correctness** — `peak_debt_pence` equals the maximum, across all months, of the
   pre-repayment balance (`opening + draw + capitalised_fees + interest_accrued` when rolled up),
   floored at 0 (spec §5.7).
3. **Zero-debt zero finance cost** — when `funding_source === 'cash'`, `finance_costs_pence` and
   `totals.draws_pence` are both exactly 0 (spec §3.9, §9).
4. **Retained exits receive no sale proceeds** — when `exit_strategy.route === 'retain_all'`,
   every month's gross receipts and `selling_costs_pence` are 0 (spec §4.4).
5. **Monthly schedule spreads sum to cost totals** — the sum of each month's construction /
   professional / statutory spread equals the schedule's cost totals (spec §6, rounding residue
   absorbed in the final month of each window).
6. **Profit = Σ equity flows, and sources = uses** — checked only when the deal is "fully
   realised" (`senior_outstanding_at_maturity_pence === 0`, no retained value, no funding gap):
   `profit_pence` equals the sum of `equity_cashflows_pence`, and
   `reconciliation.sources_equal_uses` is `true` (spec §3.12 identity, §7 invariant).
7. **TDC = sum of ledger uses plus interest, capitalised fees and exit fee** (spec §7) —
   `total_development_cost_pence` equals `Σ months.uses_total_pence + Σ interest_capitalised +
   Σ interest_serviced + selling_costs_pence + exit_fee_pence + capitalised_fees_pence`. A code
   comment records why this isn't a naive sum: month-0 `uses_total_pence` includes ancillary fees
   but not the capitalised arrangement fee, while TDC does include it, so the identity needs the
   explicit `+ capitalised_fees_pence` term (a Task 6 correction against the first draft of the
   spec's §7 reading).

The Python-side `test_invariants` (`tests/test_financial_model_fixtures.py:25-34`) is a **lighter**
counterpart, not a full port: it is parametrised only over the two raw fixture files (A, F)
directly — it does not generate or run the four derived variants (`base`/`retain_all`/`serviced`/
`term=1`) that give the TS suite its 8-way coverage — and per fixture it checks only #1
(roll-forward, verbatim) and #6's `sources_equal_uses` half (via
`run.reconciliation.sources_equal_uses`); it does not port #2 (peak debt correctness), #3
(zero-debt zero finance cost as a standalone check — though this is separately covered by
`TestCashFunding` in `test_financial_model_engine.py`, §3), #4 (retained exits receive no
proceeds), #5 (schedule spreads sum to totals) or #7 (the TDC identity) as invariant checks, nor
the profit-equals-equity-flows half of #6. This is a real, recorded coverage gap — it is **not**
the same gap as the ledger fixtures (§3), which *are* fully pinned in both languages. The
whole-pipeline golden-fixture parity test (§2) still pins the Python engine's numeric output for
every fixture to the penny, so a regression in most of #2–#5/#7-shaped behaviour would generally
also move a golden-fixture number and be caught there; but a genuine gap exists for any future
fixture whose invariant violation would not move a currently-asserted `expected_metrics` value, and
for the variant-matrix breadth (retain_all/serviced/term=1 shapes) that TS exercises but Python
does not.

---

## 5. IRR regression vector (Newton-failed-acceptance → bisection)

**File:** `frontend/src/lib/model/irr.test.ts`, test
`'falls through to bisection when Newton converges but fails NPV acceptance: regression'`.

**The story:** the spec (§3.17) requires Newton–Raphson from 1%/month with a bisection fallback
over [-99%, 1000%]/month on non-convergence. The first implementation of this (Task 3) had a bug:
when Newton's *step size* converged (the guess stopped moving, `|next − guess| < 1e-9`) but the
resulting NPV still failed the acceptance tolerance (`|npv| >= 1e-3` — i.e. Newton had stalled at
a point that wasn't actually a root, typically on a steep curve near a bound), the pre-fix code
treated "step converged" as "solution found" and returned that inaccurate value — or, in an
earlier revision of the fix, returned `null` (no solution) instead of correctly falling through to
bisection. Either failure mode is a lender-facing defect: a wrong or missing IRR on a real deal.

The regression vector that exposed this and pins the fix:

```
[-1992399, -264982, 222404, 230870, -124126, 283789, 201626, 159610, -168999, -138187, 16731]
```

For this vector, Newton converges (step size below threshold) after 17 iterations at
`guess ≈ −0.8915944581764597`, where `|npv| ≈ 0.015625` — still over the `1e-3` acceptance bound,
because the NPV curve is steep near the lower bracket bound (−0.99) so a tiny rate error produces
a large-looking NPV residual even though the rate itself is accurate. The fix detects this
converged-but-not-accepted state and breaks into bisection, which returns
`≈ −0.8915944581766244`. **Pre-fix, this exact vector returned `null`.**

The test asserts `irr` is not null, `toBeCloseTo(-0.8916, 3)`, and — because the raw NPV residual
is not itself a good precision signal here — additionally asserts a sign change of NPV within
±1e-6 of the returned root, bracketing the true root far more tightly than the raw residual
suggests.

The Python IRR solver mirrors the same Newton-then-bisection algorithm and is exercised
indirectly: Fixture F's `irr_annual_pct = 91.2` and every other golden fixture's IRR value are
cross-language pinned via §2, so a divergence in the Python solver's bisection fallback would
surface as a golden-fixture mismatch even without a Python-native copy of this specific vector.

---

## 6. Running the suites

**Frontend (TypeScript / Vitest), from `frontend/`:**
```bash
npm test                    # or: npx vitest run — runs the full suite (202 tests)
npx tsc -p tsconfig.app.json --noEmit   # type check
npx vitest run src/lib/model/golden-fixtures.test.ts src/lib/model/monthly-engine.test.ts \
  src/lib/model/invariants.test.ts src/lib/model/irr.test.ts src/lib/model/breakeven.test.ts \
  # model layer only
```

**Backend (Python / pytest), from the repo root:**
```bash
python -m pytest -q                              # full suite (145 tests)
python -m pytest tests/test_financial_model_fixtures.py   # golden-fixture parity + invariants only
python -m pytest tests/test_financial_model_engine.py     # Python-native ledger/engine unit tests
python -m pytest tests/test_financial_model_breakeven.py  # senior break-even solver unit tests (spec §5.11)
python -m pytest tests/test_appraisal_governance.py       # server-authoritative persistence, incl. the York path
```
`pyproject.toml` sets `testpaths = ["tests"]`, so a bare `pytest` from the repo root is equivalent
to the explicit `tests/` form.

---

## 7. The cross-language parity contract

- **What is shared as literal JSON:** the golden-fixture documents in `fixtures/financial-model/`
  — one physical file per fixture, read byte-identical by both languages. This is the tightest form
  of the contract: a change to a fixture's `inputs` or `expected_metrics` is a single edit that
  both suites pick up automatically.
- **What is pinned in both languages, but as independently-written (not shared-file) test code:**
  the ledger fixtures B–F (§3) — `test_financial_model_engine.py` is an explicit, reviewed
  transliteration of `monthly-engine.test.ts` (Task 11; "port fidelity line-by-line verified" per
  the progress ledger), asserting the same pence values including the two mid-implementation
  corrections (Fixture E's £7,000 arrangement fee, Fixture F's gross-headroom-cap numbers). A
  divergence here would require someone to edit both files inconsistently and have neither review
  catch it — a materially different (and lower) risk than "no Python coverage exists at all".
- **Genuine, narrower cross-language gaps that remain (corrected from an earlier, wrong statement
  in this section — see the Task 14 correction record for how this was caught):**
  - The **invariant suite's variant matrix** (§4) is lighter in Python: TS checks 7 invariants
    across 2 fixtures × 4 derived variants (8 runs); Python checks 2 of those invariants
    (roll-forward, sources-equal-uses) across the 2 base fixtures only, with no `retain_all`/
    `serviced`/`term=1` variant generation on the Python side.
  - **No shared migration-mapping fixture.** TS has a dedicated hand-derived unit-test file for
    the v1→v2 migration itself, `frontend/src/lib/model/migrate.test.ts` (4 tests). Python's only
    migration-specific tests are a narrow regression
    (`test_financial_model_fixtures.py::test_migration_preserves_floors_zero`) and the end-to-end
    `test_appraisal_governance.py::test_v1_snapshot_migrates_to_legacy_unreconciled`, which
    exercises migration indirectly through the API rather than asserting `migrate_inputs()`'s
    output directly against a set of hand-derived cases the way `migrate.test.ts` does. There is
    no shared JSON fixture for the migration mapping (unlike golden fixtures A/F) and no
    dedicated Python unit-test file mirroring `migrate.test.ts` case-for-case. Closing this is
    Release 2 scope: either add a shared migration-fixture JSON or a Python-side
    `test_migrate.py` with the same hand-derived v1→v2 cases as `migrate.test.ts`.
- **Rounding parity (spec §1.1):** TypeScript rounds with `Math.round` (half-up toward +∞);
  Python must use `math.floor(x + 0.5)`, explicitly *not* `round()` (Python's banker's rounding
  would disagree with TS on `.5` boundaries). Both are required to agree to the penny on every
  golden fixture — this is what `test_golden_fixture_parity` actually enforces, not merely "close
  enough" numeric agreement.
- **The governance procedure that keeps this true going forward** (formula-change procedure) is
  defined in `docs/financial-model/model-governance.md` §2: any calculation change edits the spec
  first, then the fixture (with a hand derivation recorded, as above), then both engines in the
  same change — never one language ahead of the other.
