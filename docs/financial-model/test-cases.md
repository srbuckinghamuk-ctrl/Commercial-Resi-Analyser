# Financial Model — Test Cases

**Status:** Authoritative test-case register for calculation specification `2.6.0` (see
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
| **Invariant suite** (`invariants.test.ts` / `test_invariants` + `TestInvariantMatrix` in `test_financial_model_fixtures.py`) | Structural properties that must hold for *every* fixture and several derived variants, not tied to one hand-computed number | TS + Python (full variant-matrix parity — see §4) |
| **IRR regression vector** (`irr.test.ts`) | A specific pathological cash-flow vector that caught a real solver defect | TS only (the Python IRR solver shares the same algorithm and is exercised indirectly through the golden fixtures' `irr_annual_pct`) |

---

## 2. Golden fixtures (whole-pipeline, cross-language)

**Shared fixture directory:** `fixtures/financial-model/` (repo root, sibling to `frontend/` and
`tests/`). Each file is a self-contained document: `name`, `kind` (`"pipeline"`; `"programme"` for a
fixture carrying a non-null `programme` block, Release 3a; `"phased-sales"` for a non-null
`sales_phasing` block and `"refinance"` for a non-null `refinance` block, both Release 3b), `inputs`
(a full `CalculatorInputsV3` document, `inputs_version: 3` — since Release
2b Task 2, calc `2.1.0`; or a `CalculatorInputsV4` document, `inputs_version: 4` — since Release 3a,
calc `2.2.0`; see migration-notes.md §5) and `expected_metrics` (hand-computed key → expected
pence/percent value).
`kind` is a **label only** — every fixture, whatever its kind, runs through the same `runAppraisal`
assertion loop — and it names the *newest* feature the fixture carries, not an exclusive category: a
fixture may carry several of these blocks at once. Fixture J is labelled `"refinance"` but carries
**both** a non-null `sales_phasing` and a non-null `refinance` block (and a `blended` exit route).
This matches the `Fixture['kind']` comment in `golden-fixtures.test.ts`, which is the definition of
record.
The TS suite parses `inputs` with a plain type assertion (no runtime shape check) and runs it
straight through `runAppraisal`; the Python suite validates the full v3 shape with
`CalculatorInputsV3.model_validate` and runs it straight through `run_appraisal` too (Release 2b
Task 3: both engines now consume v3 — including `lender_valuation` — directly; the earlier
downcast-to-v2 adapter that both `app/api/app.py::calculate_authoritative` and this suite carried
since Task 2 is gone). Both assert every key in `expected_metrics`. The hand-computed numbers are
derived once, not independently transliterated per language — this is what makes the parity claim
in §6 meaningful rather than two separately maintained approximations.

**Closed (Release 3a Task 7 → Task 8):** the corpus carries `inputs_version: 4` documents since
Task 7 (fixture H; fixtures I and J followed in Release 3b). Task 7 briefly left a gap — v4
documents could not parse through `CalculatorInputsV3.model_validate`, so every fixture-driven
Python test skipped them explicitly (`tests/test_financial_model_fixtures.py`,
`tests/test_financial_model_cost_to_complete.py`, both carrying a `TEMPORARY (Release 3a Task 7)`
comment and showing as `SKIPPED` in the pytest run) and fixture H's worksheet was pinned by the TS
suite alone. Task 8 introduced `CalculatorInputsV4` (`parse_calculator_inputs` dispatching on
`inputs_version`) and removed those skips — v4 fixtures I, J and H now run through the same
Python assertion loop as every other fixture, with no skip markers anywhere in the corpus-driven
suites, and the cross-language parity claim above holds for the full corpus, not just v2/v3.

**Consumers:**
- TS: `frontend/src/lib/model/golden-fixtures.test.ts`, `frontend/src/lib/model/invariants.test.ts`
- Python: `tests/test_financial_model_fixtures.py` (`test_golden_fixture_parity`, `test_invariants`,
  `TestInvariantMatrix`)

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

### Fixture H — "H — dated programme, s-curve construction, shifted windows" (`fixtures/financial-model/h-programme-scurve.json`)

**Purpose:** the first golden fixture with a non-null `programme` block (spec §6.1, calc `2.2.0`,
Release 3a). It pins all three explicit spend curves at once — `s_curve` construction over months
1–6, `straight_line` professional over months 2–4, `back_loaded` statutory over months 4–5 — with
windows that are *shifted* relative to the calc-2.1.0 auto windows (which for a 12-month term would
put construction straight-line over months 1–10 and professional/statutory over months 1–5). Because
the ledger's interest is path-dependent on *when* cost lands, the finance figures below are new,
independently hand-derivable numbers that no earlier fixture pins; the cost totals are chosen as
round pence so every curve line can be checked with a calculator.

`inputs_version: 4`, `sales_phasing: null`, `refinance: null`, `lender_valuation: null` (so all
lender-basis metrics stay `null`, as in F).

**Inputs (deltas from Fixture F):**
- `conversion_costs`: construction £1,500/m² × 400 m², contingency **0%**, no compliance allowances
  → construction total exactly **60,000,000p**; architect £24,000 + structural £6,000 + M&E £0 +
  planning consultant £6,000 + other £0 → professional **3,600,000p**; CIL/S106 £27,000 + building
  control £3,000 → statutory *spread* **3,000,000p** (prior-approval fee unchanged at £96/dwelling).
- `programme`: `anchor_month "2026-10"`; construction `{start_offset 1, duration 6, s_curve}`;
  professional `{start_offset 2, duration 3, straight_line}`; statutory `{start_offset 4,
  duration 2, back_loaded}`.
- Everything else — acquisition, unit mix, GDV, facility terms, equity, exit strategy — is byte-for-byte
  fixture F.

**Window validity (spec §6.1):** term 12 → last permitted spend month is `term − 2 = 10`.
Construction ends at `1 + 6 − 1 = 6` ✓; professional at `2 + 3 − 1 = 4` ✓; statutory at
`4 + 2 − 1 = 5` ✓.

#### Step 1 — cost totals (spec §3.3–§3.8)

| Line | Derivation | Pence |
|---|---|---:|
| SDLT | commercial slice bands on the 40,000,000 price: 0% × 15,000,000 + 2% × 10,000,000 + 5% × 15,000,000 = 0 + 200,000 + 750,000 (price unchanged from A/F) | 950,000 |
| Acquisition cost | 40,000,000 + 950,000 + 500,000 + 300,000 + broker 1% × 40,000,000 = 400,000 | 42,150,000 |
| Construction | base = round(150,000 × 400) = 60,000,000; contingency 0% = 0; compliance = 0 | 60,000,000 |
| Professional (§3.5) | 2,400,000 + 600,000 + 0 + 600,000 + 0 | 3,600,000 |
| Statutory (§3.6) | prior approval 9,600 × 4 = 38,400 **+** CIL/S106 2,700,000 + building control 300,000 | 3,038,400 |
| GDV | 4 × 30,000,000 | 120,000,000 |
| Selling costs (§3.7) | agent 1.5% × 120,000,000 = 1,800,000 + legal 400,000 | 2,200,000 |
| Cost before finance **ex** selling (§5.4 denominator) | 42,150,000 + 60,000,000 + 3,600,000 + 3,038,400 | 108,788,400 |
| Cost before finance (§3.8) | 108,788,400 + 2,200,000 | 110,988,400 |

#### Step 2 — curve spreads (spec §6.1), each line derived from the closed form

**Construction — `s_curve`, D = 6, total 60,000,000p.** Cumulative `W(k) = (1 − cos(πk/D)) / 2`;
`w_k = W(k) − W(k−1)`; month `k` pence = `round_half_up(60,000,000 × w_k)`, final month absorbs the
residue.

| k | cos(πk/6) | W(k) | w_k = ΔW | 60,000,000 × w_k | pence |
|--:|---|---|---|---:|---:|
| 1 | +0.8660254038 | 0.0669872981 | 0.0669872981 | 4,019,237.89 | **4,019,238** |
| 2 | +0.5 | 0.25 | 0.1830127019 | 10,980,762.11 | **10,980,762** |
| 3 | 0 | 0.5 | 0.25 | 15,000,000.00 | **15,000,000** |
| 4 | −0.5 | 0.75 | 0.25 | 15,000,000.00 | **15,000,000** |
| 5 | −0.8660254038 | 0.9330127019 | 0.1830127019 | 10,980,762.11 | **10,980,762** |
| 6 | −1 | 1.0 | 0.0669872981 | (residue) | **4,019,238** |

Residue check: 60,000,000 − (4,019,238 + 10,980,762 + 15,000,000 + 15,000,000 + 10,980,762) =
60,000,000 − 55,980,762 = **4,019,238** — equal to the ideal `round(4,019,237.89)`, so the curve is
symmetric to the penny here. Σ = 60,000,000 ✓. Placed at ledger months **1–6** (`start_offset 1`).

**Professional — `straight_line`, D = 3, total 3,600,000p.** `per = round(3,600,000 / 3) =
1,200,000`; final month = `3,600,000 − 1,200,000 × 2 = 1,200,000`. Months **2, 3, 4** = 1,200,000
each. Σ = 3,600,000 ✓.

**Statutory spread — `back_loaded`, D = 2, total 3,000,000p.** `w_k = 2k / (D(D+1)) = 2k/6 = k/3`.
Month 1 of the window = `round(3,000,000 × 1/3) = 1,000,000`; month 2 = residue =
`3,000,000 − 1,000,000 = 2,000,000`. Placed at ledger months **4, 5**. Σ = 3,000,000 ✓.
The prior-approval fee (38,400) stays at month 0 (spec §6.1), and acquisition stays at month 0.

#### Step 3 — monthly uses ledger (spec §1.3, §4)

| m | Acquisition | Construction | Professional | Statutory | **Uses total** |
|--:|--:|--:|--:|--:|--:|
| 0 | 42,150,000 | 0 | 0 | 38,400 | **42,188,400** |
| 1 | 0 | 4,019,238 | 0 | 0 | **4,019,238** |
| 2 | 0 | 10,980,762 | 1,200,000 | 0 | **12,180,762** |
| 3 | 0 | 15,000,000 | 1,200,000 | 0 | **16,200,000** |
| 4 | 0 | 15,000,000 | 1,200,000 | 1,000,000 | **17,200,000** |
| 5 | 0 | 10,980,762 | 0 | 2,000,000 | **12,980,762** |
| 6 | 0 | 4,019,238 | 0 | 0 | **4,019,238** |
| 7–11 | 0 | 0 | 0 | 0 | **0** |
| **Σ** | 42,150,000 | 60,000,000 | 3,600,000 | 3,038,400 | **108,788,400** |

(The Σ row reconciles to the cost-before-finance-ex-selling figure in Step 1 ✓.)

#### Step 4 — facility terms and the senior ledger (spec §4)

Facility (unchanged from F): committed net **60,000,000**, committed gross **66,000,000**,
day-one advance **28,000,000**, 8.0% p.a. → `monthly_rate = 8/100/12 = 1/150`, rolled up,
arrangement fee `round(2% × 60,000,000) = 1,200,000` (capitalised month 0),
exit fee `round(1% × 66,000,000) = 660,000` (at redemption), ancillary lender fees 0,
`development_cost_advance_pct = 100`, `equity_first`, sweep 100%. Committed cash equity
**35,000,000**.

Gross-headroom cap (spec §4.2(c), rolled-up form):
`floor(66,000,000 / (1 + 1/150)) = floor(9,900,000,000 / 151) = floor(65,562,913.907…) =
65,562,913`, less opening balance and capitalised fees. It is computed for every month below but
**never binds** in this fixture (the undrawn-net cap always bites first) — the checks are shown so
a reviewer can confirm that.

| m | Opening | Uses | Equity | Draw | Cap fees | Interest = round((open+draw+fees)/150) | Funding gap | Closing |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 0 | 0 | 42,188,400 | 14,188,400 | 28,000,000 | 1,200,000 | 29,200,000/150 = 194,666.67 → **194,667** | 0 | 29,394,667 |
| 1 | 29,394,667 | 4,019,238 | 4,019,238 | 0 | 0 | 29,394,667/150 = 195,964.45 → **195,964** | 0 | 29,590,631 |
| 2 | 29,590,631 | 12,180,762 | 12,180,762 | 0 | 0 | 29,590,631/150 = 197,270.87 → **197,271** | 0 | 29,787,902 |
| 3 | 29,787,902 | 16,200,000 | 4,611,600 | 11,588,400 | 0 | 41,376,302/150 = 275,842.01 → **275,842** | 0 | 41,652,144 |
| 4 | 41,652,144 | 17,200,000 | 0 | 17,200,000 | 0 | 58,852,144/150 = 392,347.63 → **392,348** | 0 | 59,244,492 |
| 5 | 59,244,492 | 12,980,762 | 0 | 2,011,600 | 0 | 61,256,092/150 = 408,373.95 → **408,374** | 10,969,162 | 61,664,466 |
| 6 | 61,664,466 | 4,019,238 | 0 | 0 | 0 | 61,664,466/150 = 411,096.44 → **411,096** | 4,019,238 | 62,075,562 |
| 7 | 62,075,562 | 0 | 0 | 0 | 0 | 62,075,562/150 = 413,837.08 → **413,837** | 0 | 62,489,399 |
| 8 | 62,489,399 | 0 | 0 | 0 | 0 | 62,489,399/150 = 416,595.99 → **416,596** | 0 | 62,905,995 |
| 9 | 62,905,995 | 0 | 0 | 0 | 0 | 62,905,995/150 = 419,373.30 → **419,373** | 0 | 63,325,368 |
| 10 | 63,325,368 | 0 | 0 | 0 | 0 | 63,325,368/150 = 422,169.12 → **422,169** | 0 | 63,747,537 |
| 11 | 63,747,537 | 0 | 0 | 0 | 0 | 63,747,537/150 = 424,983.58 → **424,984** | 0 | 64,172,521 → **0** after sweep |

Month-by-month draw derivation (spec §4.2):

- **m0.** Arrangement fee 1,200,000 capitalised first (`cum_net_used = 1,200,000`). Day-one advance
  = `min(28,000,000, net 60,000,000 − 1,200,000 = 58,800,000, uses 42,188,400,
  headroom 65,562,913 − 0 − 1,200,000 = 64,362,913)` = **28,000,000** (`cum_net_used = 29,200,000`).
  Remaining month-0 uses `42,188,400 − 28,000,000 = 14,188,400` funded from equity (35,000,000
  available) → equity used 14,188,400.
- **m1.** Equity remaining 20,811,600 ≥ uses 4,019,238 → all equity, no draw. Equity used 18,207,638.
- **m2.** Equity remaining 16,792,362 ≥ uses 12,180,762 → all equity, no draw. Equity used 30,388,400.
- **m3.** Equity remaining **4,611,600** < uses 16,200,000 → equity 4,611,600, remainder 11,588,400.
  Caps: advance-% `round(100% × eligible 16,200,000) = 16,200,000`; undrawn net
  `60,000,000 − 29,200,000 = 30,800,000`; headroom `65,562,913 − 29,787,902 = 35,775,011`.
  Draw = `min(11,588,400, 16,200,000, 30,800,000, 35,775,011)` = **11,588,400**
  (`cum_net_used = 40,788,400`). Equity now exhausted at 35,000,000.
- **m4.** Equity 0. Caps: advance-% 17,200,000; undrawn net `60,000,000 − 40,788,400 = 19,211,600`;
  headroom `65,562,913 − 41,652,144 = 23,910,769`. Draw = **17,200,000**
  (`cum_net_used = 57,988,400`).
- **m5.** Equity 0. Caps: advance-% 12,980,762; undrawn net **2,011,600**; headroom
  `65,562,913 − 59,244,492 = 6,318,421`. Draw = `min(12,980,762, 12,980,762, 2,011,600, 6,318,421)`
  = **2,011,600** — the net facility is now fully drawn (`cum_net_used = 60,000,000`). The unfunded
  remainder `12,980,762 − 2,011,600 = **10,969,162**` is a **funding gap** (spec §4.2 step 3):
  it is recorded and flagged red, never plugged.
- **m6.** Equity 0, undrawn net 0 → draw 0; the whole month's uses `4,019,238` are a second
  funding gap. Total `funding_gap_pence = 10,969,162 + 4,019,238 = **14,988,400**`.
- **m7–m11.** No uses, no draws — interest alone compounds.

**The funding gap is a derived, deliberate property of this fixture, not an input error.** Total
cost ex-selling is 108,788,400; committed sources are equity 35,000,000 + net facility 60,000,000,
of which 1,200,000 is consumed by the capitalised arrangement fee, leaving 58,800,000 of principal
→ `108,788,400 − (35,000,000 + 58,800,000) = **14,988,400**`, exactly the accumulated gap ✓. H is
therefore also the first *golden* fixture (as opposed to the hand-built ledger fixture E) to
exercise spec §4.2's "cost overruns never create facility" path end to end.
Because this is the fixture's headline behaviour, `funding_gap_pence = 14,988,400` is **pinned** in
`expected_metrics`. It is a ledger total (`model.totals`), not an `AppraisalResultV2` property, so
the golden harness reaches it through the same flat-key indirection the two `cost_to_complete_*`
keys use (`FLAT_KEYS` in `golden-fixtures.test.ts`, whose mapper takes the whole `AppraisalRun`).

**Roll-forward check (spec §4 invariant), every month:** `closing = opening + draw + cap fees +
interest capitalised − repayment`. E.g. m3: `29,787,902 + 11,588,400 + 0 + 275,842 − 0 =
41,652,144` ✓; m11 pre-sweep: `63,747,537 + 0 + 0 + 424,984 = 64,172,521` ✓.

**Interest total.** Sum of the twelve rounded monthly figures:
194,667 + 195,964 + 197,271 + 275,842 + 392,348 + 408,374 + 411,096 + 413,837 + 416,596 + 419,373 +
422,169 + 424,984 = **4,172,521**.
Independent cross-check: the pre-sweep balance must equal draws + capitalised fees + rolled interest
= `(28,000,000 + 11,588,400 + 17,200,000 + 2,011,600) + 1,200,000 + 4,172,521 =
58,800,000 + 1,200,000 + 4,172,521 = 64,172,521` ✓ — the same figure the ledger column reaches.

#### Step 5 — disposal, month 11 (spec §4.4)

`sell_all`, single-month disposal at `term − 1 = 11`:
- Gross receipt **120,000,000**; agent fee `round(1.5% × 120,000,000) = 1,800,000`; selling legal
  400,000 → net receipt **117,800,000**.
- Sweep available = `round(117,800,000 × 100%) = 117,800,000`.
- Redemption balance (pre-receipt) = **64,172,521**; exit fee = `round(1% × 66,000,000)` =
  **660,000**; required to discharge = 64,832,521. Sweep ≥ that → full redemption: repayment
  64,172,521, exit fee 660,000, closing balance **0**, no `senior_outstanding_at_maturity` flag.
- Distribution to equity = `117,800,000 − 64,172,521 − 660,000` = **52,967,479**.

Peak debt (spec §5.7) = max intra-month pre-repayment balance = month 11's **64,172,521**
(the balance is monotonically increasing until the sweep), and it sits inside the committed gross
facility (`66,000,000 − 64,172,521 = 1,827,479` headroom), so no `facility_exceeded` flag.

#### Step 6 — summary metrics

| Metric | Derivation | Value |
|---|---|---:|
| `finance_costs_pence` (§3.9) | interest 4,172,521 + arrangement 1,200,000 + exit 660,000 + ancillary 0 | **6,032,521** |
| `total_development_cost_pence` (§3.10) | 110,988,400 + 6,032,521 | **117,020,921** |
| `profit_pence` (§3.12) | 120,000,000 − 117,020,921 | **2,979,079** |
| `profit_is_unrealised` | nothing retained | **false** |
| `profit_on_cost_pct` (§3.13) | 2,979,079 / 117,020,921 = 0.025457662 → 254.57662 → round 255 | **2.55** |
| `profit_on_gdv_pct` (§3.14) | 2,979,079 / 120,000,000 = 0.024825658 → 248.25658 → round 248 | **2.48** |
| `peak_debt_pence` / `peak_debt_month` (§5.7) | month 11 pre-sweep balance | **64,172,521 / 11** |
| `day_one_advance_pence` (§5.1) | actual month-0 draw | **28,000,000** |
| `gross_ltc_pct` (§5.5) | 64,172,521 / 117,020,921 = 0.548385027 → 5483.85027 → round 5484 | **54.84** |
| `net_ltc_pct` (§5.4) | net advances (draws 58,800,000 + cap fees 1,200,000 = 60,000,000) / 108,788,400 = 0.551529391 → 5515.29391 → round 5515 | **55.15** |
| `ltgdv_developer_pct` (§5.6) | 64,172,521 / 120,000,000 = 0.534771008 → 5347.71008 → round 5348 | **53.48** |
| `equity_contributed_pence` | 14,188,400 + 4,019,238 + 12,180,762 + 4,611,600, no additional equity | **35,000,000** |

**Identity note (spec §3.12).** Σ equity flows = `52,967,479 − 35,000,000 = 17,967,479`, which
exceeds `profit_pence` by exactly `17,967,479 − 2,979,079 = 14,988,400` — the funding gap. That is
the correct, expected arithmetic: TDC counts costs that were never actually funded, so the
"profit = Σ equity flows" identity is asserted by the invariant suite **only** when
`funding_gap_pence == 0`. H is the golden fixture that keeps that guard honest.

#### Step 7 — IRR (spec §3.17), hand-solved

Developer equity cash-flow vector (contributions negative, distributions positive), from the
equity/distribution columns above:

| t | 0 | 1 | 2 | 3 | 4–10 | 11 |
|---|--:|--:|--:|--:|--:|--:|
| flow | −14,188,400 | −4,019,238 | −12,180,762 | −4,611,600 | 0 | +52,967,479 |

Solve `NPV(r) = 0`, i.e.
`−14,188,400 − 4,019,238/d − 12,180,762/d² − 4,611,600/d³ + 52,967,479/d¹¹ = 0`, `d = 1 + r`.

*Starting estimate.* Contribution-weighted mean month =
`(0×14,188,400 + 1×4,019,238 + 2×12,180,762 + 3×4,611,600)/35,000,000 = 42,215,562/35,000,000 =
1.2062`; money multiple `52,967,479/35,000,000 = 1.513357`; effective hold `11 − 1.2062 = 9.7938`
months → `r ≈ 1.513357^(1/9.7938) − 1 ≈ 0.04321`.

*Evaluation at `r = 0.0431`.* Powers (exact decimal expansion of `1.0431^n`):
`d² = 1.08805761`, `d³ = 1.134952892961`, `d⁴ = 1.183869362647`, `d⁸ = (d⁴)² = 1.4015466678`,
`d¹¹ = d⁸ · d³ = 1.5906894452`, `d¹² = d¹¹ · d = 1.6592481600`.

| term | value |
|---|---:|
| −14,188,400 | −14,188,400.000 |
| −4,019,238 / 1.0431 | −3,853,166.522 |
| −12,180,762 / 1.08805761 | −11,194,960.527 |
| −4,611,600 / 1.134952892961 | −4,063,252.339 |
| +52,967,479 / 1.5906894452 | +33,298,441.198 |
| **NPV(0.0431)** | **−1,338.190** |

*Slope.* `NPV′(r) = 4,019,238/d² + 2×12,180,762/d³ + 3×4,611,600/d⁴ − 11×52,967,479/d¹²`
= `3,693,957 + 21,464,789 + 11,686,087 − 351,148,358` = **−314,303,525**.

*Newton step.* `r = 0.0431 − (−1,338.190)/(−314,303,525) = 0.0431 − 0.0000042577` =
**0.043095742** (≈ 4.31%/month; the next Newton correction is of order 1e−10 and cannot move any
reported digit).

*Annualisation.* `ln(1.043095742) = 0.0421929654`; `× 12 = 0.5063155848`;
`e^0.5063155848 = 1.65916686`. Cross-check without logs: `d¹²` at `d = 1.0431` is 1.65924816, and
`d(d¹²)/dd = 12 d¹¹ = 19.0882733`, so at `d = 1.0431 − 0.000004258` →
`1.65924816 − 19.0882733 × 0.000004258 = 1.65916688` — the two routes agree to 2×10⁻⁸.

`irr_annual_pct = round((1.65916688 − 1) × 10000)/100 = round(6591.6688)/100` = **65.92**
(the nearest rounding boundary, 6591.5, is 0.17 away — i.e. `r` would have to be wrong by more than
8.8×10⁻⁷ to move this figure; the derivation above is good to ~10⁻⁹).

#### Step 8 — cost-to-complete checkpoints (spec §5.10)

Label `m` reports the state as of completion of ledger month `m − 1`; remaining cost covers ledger
months `m … 11`. Per-month remaining-cost building block = uses + interest accrued (no capitalised
fees after month 0, no lender ancillary fees):

| k | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| uses + interest | 4,215,202 | 12,378,033 | 16,475,842 | 17,592,348 | 13,389,136 | 4,430,334 | 413,837 | 416,596 | 419,373 | 422,169 | 424,984 |

| m | Remaining cost (Σ from k = m) | Undrawn net at m−1 | Uncontributed cash equity at m−1 | Remaining funding | Surplus |
|--:|--:|--:|--:|--:|--:|
| 1 | 70,577,854 | 30,800,000 | 20,811,600 | 51,611,600 | **−18,966,254** |
| 2 | 66,362,652 | 30,800,000 | 16,792,362 | 47,592,362 | −18,770,290 |
| 3 | 53,984,619 | 30,800,000 | 4,611,600 | 35,411,600 | −18,573,019 |
| 4 | 37,508,777 | 19,211,600 | 0 | 19,211,600 | −18,297,177 |
| 5 | 19,916,429 | 2,011,600 | 0 | 2,011,600 | −17,904,829 |
| 6 | 6,527,293 | 0 | 0 | 0 | −6,527,293 |
| 7 | 2,096,959 | 0 | 0 | 0 | −2,096,959 |
| 8 | 1,683,122 | 0 | 0 | 0 | −1,683,122 |
| 9 | 1,266,526 | 0 | 0 | 0 | −1,266,526 |
| 10 | 847,153 | 0 | 0 | 0 | −847,153 |
| 11 | 424,984 | 0 | 0 | 0 | −424,984 |
| 12 | 0 | 0 | 0 | 0 | 0 |

Telescoping check (spec §5.10): `remaining_cost(1) = remaining_cost(2) + (uses+interest at k=1)` →
`66,362,652 + 4,215,202 = 70,577,854` ✓; and `remaining_cost(1) = ` total cost ex-selling +
total interest + capitalised fees − month-0 spend = `108,788,400 + 4,172,521 + 1,200,000 −
(42,188,400 + 194,667 + 1,200,000) = 114,160,921 − 43,583,067 = 70,577,854` ✓.

→ `cost_to_complete_first_shortfall_month = **1**`,
`cost_to_complete_max_shortfall_pence = **18,966,254**` (the largest deficit, at m = 1). Consistent
with the ledger's own `funding_gap_pence > 0`, i.e. the one implication the suite asserts
("shortfall ⇒ funding gap", §2 above) holds here as a genuine positive case, not vacuously.

#### Pinned `expected_metrics`

| Metric | Value | £ |
|---|---:|---:|
| `gdv_pence` | 120,000,000 | £1,200,000 |
| `acquisition_cost_pence` | 42,150,000 | £421,500 |
| `sdlt_pence` | 950,000 | £9,500 |
| `construction_cost_pence` | 60,000,000 | £600,000 |
| `professional_fees_pence` | 3,600,000 | £36,000 |
| `statutory_costs_pence` | 3,038,400 | £30,384 |
| `selling_costs_pence` | 2,200,000 | £22,000 |
| `cost_before_finance_pence` | 110,988,400 | £1,109,884 |
| `finance_costs_pence` | 6,032,521 | £60,325.21 |
| `total_development_cost_pence` | 117,020,921 | £1,170,209.21 |
| `profit_pence` | 2,979,079 | £29,790.79 |
| `profit_is_unrealised` | false | — |
| `profit_on_cost_pct` | — | 2.55% |
| `profit_on_gdv_pct` | — | 2.48% |
| `peak_debt_pence` | 64,172,521 | £641,725.21 |
| `peak_debt_month` | 11 | — |
| `day_one_advance_pence` | 28,000,000 | £280,000 |
| `gross_ltc_pct` | — | 54.84% |
| `equity_contributed_pence` | 35,000,000 | £350,000 |
| `net_ltc_pct` | — | 55.15% |
| `ltgdv_developer_pct` | — | 53.48% |
| `irr_annual_pct` | — | 65.92% |
| `funding_gap_pence` | 14,988,400 | £149,884 |
| `cost_to_complete_first_shortfall_month` | 1 | — |
| `cost_to_complete_max_shortfall_pence` | 18,966,254 | £189,662.54 |

**Governance note.** Every figure above was derived on this worksheet *before* the fixture was run
against either engine (`docs/financial-model/model-governance.md`): the spread tables come from the
§6.1 closed forms, the ledger from the §4 monthly loop, and the IRR from a hand Newton iteration
with an independent log/derivative cross-check on the annualisation. The engine was run only to
confirm agreement.

### Fixture I — "I — phased sell_all, three-tranche sweep" (`fixtures/financial-model/i-phased-sales.json`)

**Purpose:** the first golden fixture with a non-null `sales_phasing` block (spec §4.4.1, calc
`2.3.0`, Release 3b). It is fixture F with its single month-11 disposal replaced by three tranches —
40% at month 9, 35% at month 10, 25% at month 11 — and *nothing else changed*. That makes it F's
controlled twin for the phased regime: every cost line, every draw and every month-0-to-8 ledger row
is F's, so the only figures that move are the ones the phasing is supposed to move — the sweep, the
post-sweep interest, peak debt, the exit-fee month, and everything downstream. It is also the first
fixture to pin the declining `redemption_schedule`, the first where the facility is redeemed
**before** the final disposal month (so `redemption_balance_at_disposal_pence` is legitimately `0`),
and the first to exercise §5.11's *phased* break-even replay including its fee-reserve regime.

`inputs_version: 4`, `programme: null`, `refinance: null`, `lender_valuation: null` (so every
lender-basis metric stays `null`, as in F).

**Inputs (deltas from Fixture F):** exactly two —
- `inputs_version` 3 → 4, with the v4 additive blocks written explicitly (`programme: null`,
  `refinance: null`; `lender_valuation: null` was already present in F).
- `sales_phasing`: `{ tranches: [ {month_offset 9, pct 40.0}, {month_offset 10, pct 35.0},
  {month_offset 11, pct 25.0} ] }`.

Everything else — acquisition, unit mix, conversion costs, facility terms, equity, exit strategy,
scenarios, deal spider — is byte-for-byte fixture F.

**Phasing validity (spec §4.4.1):** three tranches (≥ 1 ✓); offsets 9 < 10 < 11, all whole months in
`[0, term − 1] = [0, 11]` ✓; percentages all finite and > 0 ✓; `40.0 + 35.0 + 25.0 = 100.0` exactly
✓; `route = 'sell_all'`, not `retain_all` ✓.

#### Step 1 — cost totals (spec §3.3–§3.8) — identical to fixtures A/F

Fixture I changes no cost input, so this table is fixture A/F's cost arithmetic reproduced, not
re-decided. It is restated in full here so this worksheet stands alone.

| Line | Derivation | Pence |
|---|---|---:|
| SDLT (§3.3) | commercial slice bands on 40,000,000: 0% × 15,000,000 + 2% × 10,000,000 + 5% × 15,000,000 = 0 + 200,000 + 750,000 | 950,000 |
| Acquisition cost (§3.3) | 40,000,000 + 950,000 + legal 500,000 + survey 300,000 + broker `round(1% × 40,000,000)` = 400,000 | 42,150,000 |
| Construction (§3.4) | base = `round(100,000 × 400)` = 40,000,000; contingency `round(10% × 40,000,000)` = 4,000,000; compliance 0 | 44,000,000 |
| Professional (§3.5) | 1,500,000 + 500,000 + 500,000 + 300,000 + 0 | 2,800,000 |
| Statutory (§3.6) | prior approval 9,600 × 4 = 38,400 **+** CIL/S106 0 + building control 200,000 | 238,400 |
| GDV (§3.1) | 4 × 30,000,000 | 120,000,000 |
| Selling costs (§3.7) | agent `round(1.5% × 120,000,000)` = 1,800,000 + legal 400,000 | 2,200,000 |
| Cost before finance **ex** selling (§5.4 denominator) | 42,150,000 + 44,000,000 + 2,800,000 + 238,400 | 89,188,400 |
| Cost before finance (§3.8) | 89,188,400 + 2,200,000 | **91,388,400** |

91,388,400 is fixture A's and fixture F's pinned `cost_before_finance_pence` — the parity that
fixture A/F was built to fix is preserved by I unchanged.

#### Step 2 — spend spread, auto windows (spec §6, `programme: null`)

Term 12 → construction window = `max(1, 12 − 2)` = **10 months (1–10)**; professional and statutory
window = `ceil(10 / 2)` = **5 months (1–5)**.

- Construction 44,000,000 over 10: `per = round(44,000,000 / 10) = 4,400,000`; final month =
  `44,000,000 − 4,400,000 × 9 = 4,400,000`. Months 1–10 = **4,400,000** each. Σ = 44,000,000 ✓
- Professional 2,800,000 over 5: `per = round(2,800,000 / 5) = 560,000`; final =
  `2,800,000 − 560,000 × 4 = 560,000`. Months 1–5 = **560,000** each. Σ = 2,800,000 ✓
- Statutory *spread* portion (CIL/S106 0 + building control 200,000) over 5:
  `per = round(200,000 / 5) = 40,000`; final = `200,000 − 40,000 × 4 = 40,000`. Months 1–5 =
  **40,000** each. Σ = 200,000 ✓. The prior-approval fee 38,400 stays at month 0 (§6/§3.6), as does
  acquisition (§3.3).

| m | Acquisition | Construction | Professional | Statutory | **Uses total** |
|--:|--:|--:|--:|--:|--:|
| 0 | 42,150,000 | 0 | 0 | 38,400 | **42,188,400** |
| 1–5 | 0 | 4,400,000 | 560,000 | 40,000 | **5,000,000** each |
| 6–10 | 0 | 4,400,000 | 0 | 0 | **4,400,000** each |
| 11 | 0 | 0 | 0 | 0 | **0** |
| **Σ** | 42,150,000 | 44,000,000 | 2,800,000 | 238,400 | **89,188,400** |

Residue check: `42,188,400 + 5 × 5,000,000 + 5 × 4,400,000 = 42,188,400 + 25,000,000 + 22,000,000 =
89,188,400` = the Step 1 ex-selling sub-total ✓.

#### Step 3 — tranche split (spec §4.4.1)

Sold portion's gross receipts `G = 120,000,000` (`sell_all`, nothing retained). For k < K the gross
is `round_half_up(G × pct_k / 100)`; the final tranche absorbs the residue. Selling costs are
apportioned pro-rata by tranche gross with the same final-tranche absorption, the agent-fee total
being `round_half_up(G × 1.5 / 100) = 1,800,000` and the legal fee the flat 400,000.

| k | month | pct | gross `g_k` | derivation | agent `a_k` | derivation | legal `l_k` | derivation | **net** |
|--:|--:|--:|--:|---|--:|---|--:|---|--:|
| 1 | 9 | 40.0 | 48,000,000 | `round(120,000,000 × 40/100)` | 720,000 | `round(1,800,000 × 48,000,000/120,000,000)` | 160,000 | `round(400,000 × 0.4)` | **47,120,000** |
| 2 | 10 | 35.0 | 42,000,000 | `round(120,000,000 × 35/100)` | 630,000 | `round(1,800,000 × 42,000,000/120,000,000)` | 140,000 | `round(400,000 × 0.35)` | **41,230,000** |
| 3 | 11 | 25.0 | 30,000,000 | residue | 450,000 | residue | 100,000 | residue | **29,450,000** |

Residue checks (all three, per §4.4.1's "Σ = total exactly" invariant):
- gross: `120,000,000 − 48,000,000 − 42,000,000 = 30,000,000`, equal to the ideal
  `round(120,000,000 × 25/100)` — exact here, so the residue absorbs nothing ✓ (Σ = 120,000,000)
- agent: `1,800,000 − 720,000 − 630,000 = 450,000`, equal to the ideal `round(1,800,000 × 0.25)` ✓
- legal: `400,000 − 160,000 − 140,000 = 100,000`, equal to the ideal `round(400,000 × 0.25)` ✓
- nets: `47,120,000 + 41,230,000 + 29,450,000 = 117,800,000 = 120,000,000 − 2,200,000` ✓ (the
  selling-cost total of Step 1, so no penny is created or lost by the phasing)

#### Step 4 — senior ledger, months 0–8 (spec §4) — identical to fixture F

Facility (unchanged from F): committed net **60,000,000**, committed gross **66,000,000**, day-one
advance **28,000,000**, 8.0% p.a. → `monthly_rate = 8/100/12 = 1/150`, rolled up, arrangement fee
`round(2% × 60,000,000) = 1,200,000` (capitalised month 0), exit fee
`round(1% × 66,000,000) = 660,000` (basis `committed_gross_facility` — a **static** 660,000
regardless of when or against what balance it is charged), ancillary lender fees 0,
`development_cost_advance_pct = 100`, `equity_first`, sweep 100%. Committed cash equity
**35,000,000**.

Gross-headroom cap (spec §4.2(c), rolled-up form):
`floor(66,000,000 / (1 + 1/150)) = floor(9,900,000,000 / 151) = floor(65,562,913.907…) =
**65,562,913**`, less opening balance and capitalised fees. It is checked below and **never binds**
in this fixture (the undrawn-net cap always bites first).

**Fixture I's uses, draws, equity and interest for months 0–8 are identical to fixture F's**, because
the two fixtures share every cost input and every facility term, and the first receipt of either
fixture lands no earlier than month 9 — receipts are an end-of-month event (§1.3), so nothing before
month 9 can differ. (Fixture F's published worksheet above pins F's headline outputs rather than
tabulating its ledger, so the table below is derived here from §4's monthly loop and then
**cross-checked against F's pinned numbers** — see the reconciliation at the end of this step, which
reproduces F's `peak_debt_pence = 58,604,953` and `finance_costs_pence = 5,076,553` exactly. That
cross-check is what licenses the "identical to F" claim rather than an assertion of it.)

| m | Opening | Uses | Equity | Draw | Cap fees | Interest = round((open+draw+fees)/150) | Gap | Closing |
|--:|--:|--:|--:|--:|--:|---|--:|--:|
| 0 | 0 | 42,188,400 | 14,188,400 | 28,000,000 | 1,200,000 | 29,200,000/150 = 194,666.67 → **194,667** | 0 | 29,394,667 |
| 1 | 29,394,667 | 5,000,000 | 5,000,000 | 0 | 0 | 29,394,667/150 = 195,964.45 → **195,964** | 0 | 29,590,631 |
| 2 | 29,590,631 | 5,000,000 | 5,000,000 | 0 | 0 | 29,590,631/150 = 197,270.87 → **197,271** | 0 | 29,787,902 |
| 3 | 29,787,902 | 5,000,000 | 5,000,000 | 0 | 0 | 29,787,902/150 = 198,586.01 → **198,586** | 0 | 29,986,488 |
| 4 | 29,986,488 | 5,000,000 | 5,000,000 | 0 | 0 | 29,986,488/150 = 199,909.92 → **199,910** | 0 | 30,186,398 |
| 5 | 30,186,398 | 5,000,000 | 811,600 | 4,188,400 | 0 | 34,374,798/150 = 229,165.32 → **229,165** | 0 | 34,603,963 |
| 6 | 34,603,963 | 4,400,000 | 0 | 4,400,000 | 0 | 39,003,963/150 = 260,026.42 → **260,026** | 0 | 39,263,989 |
| 7 | 39,263,989 | 4,400,000 | 0 | 4,400,000 | 0 | 43,663,989/150 = 291,093.26 → **291,093** | 0 | 43,955,082 |
| 8 | 43,955,082 | 4,400,000 | 0 | 4,400,000 | 0 | 48,355,082/150 = 322,367.21 → **322,367** | 0 | 48,677,449 |

Month-by-month draw derivation (spec §4.2):

- **m0.** Arrangement fee 1,200,000 capitalised first (`cum_net_used = 1,200,000`). Day-one advance =
  `min(28,000,000, net 60,000,000 − 1,200,000 = 58,800,000, uses 42,188,400, headroom
  65,562,913 − 0 − 1,200,000 = 64,362,913)` = **28,000,000** (`cum_net_used = 29,200,000`). Remaining
  month-0 uses `42,188,400 − 28,000,000 = 14,188,400` from equity (35,000,000 available) →
  equity used 14,188,400.
- **m1–m4.** Equity remaining at the start of each month is 20,811,600 / 15,811,600 / 10,811,600 /
  5,811,600 — each ≥ that month's 5,000,000 of uses, so equity funds them entirely and no draw is
  made. Equity used after m4 = `14,188,400 + 4 × 5,000,000 = 34,188,400`.
- **m5.** Equity remaining `35,000,000 − 34,188,400 = **811,600**` < uses 5,000,000 → equity 811,600,
  remainder 4,188,400. Caps: advance-% `round(100% × eligible 5,000,000) = 5,000,000`; undrawn net
  `60,000,000 − 29,200,000 = 30,800,000`; headroom `65,562,913 − 30,186,398 = 35,376,515`.
  Draw = `min(4,188,400, 5,000,000, 30,800,000, 35,376,515)` = **4,188,400**
  (`cum_net_used = 33,388,400`). Committed equity is now exhausted at exactly 35,000,000.
- **m6.** Equity 0. Caps: advance-% 4,400,000; undrawn net `60,000,000 − 33,388,400 = 26,611,600`;
  headroom `65,562,913 − 34,603,963 = 30,958,950`. Draw = **4,400,000** (`cum_net_used = 37,788,400`).
- **m7.** Caps: advance-% 4,400,000; undrawn net 22,211,600; headroom
  `65,562,913 − 39,263,989 = 26,298,924`. Draw = **4,400,000** (`cum_net_used = 42,188,400`).
- **m8.** Caps: advance-% 4,400,000; undrawn net 17,811,600; headroom
  `65,562,913 − 43,955,082 = 21,607,831`. Draw = **4,400,000** (`cum_net_used = 46,588,400`).

No month gaps: every month's uses are met in full → `funding_gap_pence = **0**` (contrast fixture H,
whose headline behaviour is the opposite).

**Cross-check against fixture F's pinned outputs (the licence for "identical to F").** Continue this
same table under F's receipts schedule — i.e. no receipts until month 11 — for m9, m10 and m11:
m9 draw 4,400,000, interest `round(53,077,449/150) = 353,850`, closing 53,431,299; m10 draw
4,400,000, interest `round(57,831,299/150) = 385,542`, closing 58,216,841; m11 no uses, interest
`round(58,216,841/150) = 388,112`, closing **58,604,953** — exactly fixture F's pinned
`peak_debt_pence`. Summing that trajectory's twelve interest lines:
`194,667 + 195,964 + 197,271 + 198,586 + 199,910 + 229,165 + 260,026 + 291,093 + 322,367 + 353,850 +
385,542 + 388,112 = 3,216,553`, and `3,216,553 + 1,200,000 + 660,000 = **5,076,553**` — exactly
fixture F's pinned `finance_costs_pence`. Both of F's pinned finance figures are therefore
reproduced by the table above, which is what establishes that months 0–8 are shared ground and not
merely assumed to be.

#### Step 5 — months 9–11: the phased sweep (spec §4.4, §4.4.1)

Ordering within each month is §1.3's: costs and draws first, then interest on
`opening + draw + capitalised_fees`, then receipts, selling costs, sweep, distribution.

**Month 9.** Uses 4,400,000; equity 0; caps: advance-% 4,400,000, undrawn net
`60,000,000 − 46,588,400 = 13,411,600`, headroom `65,562,913 − 48,677,449 = 16,885,464` → draw
**4,400,000** (`cum_net_used = 50,988,400`). Interest = `round((48,677,449 + 4,400,000)/150) =
round(53,077,449/150) = round(353,849.66)` = **353,850**.
Balance before receipts = `48,677,449 + 4,400,000 + 353,850` = **53,431,299** — this is
`redemption_schedule[0]`, captured immediately before the month's receipts (§4.4.1).
Tranche 1 net = 47,120,000 (Step 3); sweep available = `round(47,120,000 × 100/100)` = 47,120,000.
Exit fee if redeeming = 660,000, so full redemption needs `53,431,299 + 660,000 = 54,091,299`.
`47,120,000 < 54,091,299` → **partial arm** (§4.4: "receipts insufficient to cover principal plus
exit fee do not discharge the facility; the balance carries"). Repayment =
`min(47,120,000, 53,431,299)` = **47,120,000** — not equal to the balance, so §4.4's fee clamp does
not engage (that clamp only fires in the narrow band `balance ≤ sweep < balance + fee`, where a
naive `min` would clear principal in full while the fee silently vanished; here the sweep is far
below the balance and the ordinary partial repayment applies).
Exit fee charged this month = **0**. Closing balance = `53,431,299 − 47,120,000` = **6,311,299**.
Distribution = `47,120,000 − 47,120,000 − 0` = **0**.

**Month 10.** Uses 4,400,000; equity 0; caps: advance-% 4,400,000, undrawn net
`60,000,000 − 50,988,400 = 9,011,600`, headroom `65,562,913 − 6,311,299 = 59,251,614` → draw
**4,400,000** (`cum_net_used = 55,388,400`). The facility has not yet been redeemed at the moment of
this draw, so §4.4.1's `facility_redrawn_after_redemption` flag does **not** fire.
Interest = `round((6,311,299 + 4,400,000)/150) = round(10,711,299/150) = round(71,408.66)` =
**71,409** — roughly a fifth of month 9's 353,850, which is the whole point of the fixture: §4's
roll-forward accrues on the *post-sweep* balance automatically (§4.4.1), so the first tranche stops
four fifths of the interest that fixture F goes on paying.
Balance before receipts = `6,311,299 + 4,400,000 + 71,409` = **10,782,708** = `redemption_schedule[1]`.
Tranche 2 net = 41,230,000; sweep = 41,230,000. Full redemption needs
`10,782,708 + 660,000 = 11,442,708`; `41,230,000 ≥ 11,442,708` → **full redemption arm**.
Repayment = **10,782,708**, exit fee = **660,000** (charged once, here, at the FIRST full
redemption — §4.4.1), closing balance **0**.
Distribution = `41,230,000 − 10,782,708 − 660,000` = **29,787,292**.

**Month 11.** No uses, no draw (so no `facility_redrawn_after_redemption` flag), opening balance 0 →
interest = `round(0 × 1/150)` = **0**. Balance before receipts = **0** = `redemption_schedule[2]`
(month 11 *is* a disposal month, so it takes a schedule entry; §4.4.1 defines the entry as the
pre-receipt balance, which is legitimately zero here). Tranche 3 net = 29,450,000; the balance is 0,
so no sweep arm runs, no second exit fee is charged, and the whole net proceeds distribute:
Distribution = **29,450,000**.

Therefore, per §4.4.1's definition ("the balance immediately before receipts in the FINAL disposal
month"), `redemption_balance_at_disposal_pence = **0**`, and the declining schedule is

| entry | month | balance before receipts |
|--:|--:|--:|
| 0 | 9 | **53,431,299** |
| 1 | 10 | **10,782,708** |
| 2 | 11 | **0** |

strictly declining, as §4.4.1 requires of the phased regime.

**Roll-forward check (spec §4 invariant), the three phased months:**
m9 `48,677,449 + 4,400,000 + 0 + 353,850 − 47,120,000 = 6,311,299` ✓;
m10 `6,311,299 + 4,400,000 + 0 + 71,409 − 10,782,708 = 0` ✓ (the exit fee is its own line, not part
of the roll-forward, §4); m11 `0 + 0 + 0 + 0 − 0 = 0` ✓.

**Peak debt (spec §5.7)** = max over months of the intra-month pre-repayment balance. The balance
rises monotonically to month 9 and then falls, so peak = month 9's **53,431,299**, at
`peak_debt_month = 9`. It sits inside the committed gross facility
(`66,000,000 − 53,431,299 = 12,568,701` headroom) → no `facility_exceeded` flag. This is
**5,173,654 lower** than fixture F's 58,604,953: F's balance keeps compounding to month 11, while I's
first tranche cuts it at month 9. The brief's "unchanged from F if peak precedes month 9" test is
answered in the negative *by derivation* — the peak is at month 9 itself, and it is I's own number.

#### Step 6 — summary metrics (spec §3, §5)

Interest total = the nine months 0–8 (Step 4) plus month 9's 353,850, month 10's 71,409 and month
11's 0:
`194,667 + 195,964 + 197,271 + 198,586 + 199,910 + 229,165 + 260,026 + 291,093 + 322,367 = 2,089,049`;
`2,089,049 + 353,850 + 71,409 + 0 = **2,514,308**`.
Independent cross-check (§4's identity, applied at month 9 — the last month before any repayment):
the month-9 pre-receipt balance must equal cumulative draws + capitalised fees + rolled interest to
that point. Cumulative draws through m9 = `28,000,000 (m0) + 4,188,400 (m5) + 4 × 4,400,000
(m6–m9) = 49,788,400`; capitalised fees = 1,200,000; interest m0–m9 = `2,089,049 + 353,850 =
2,442,899`. Total `49,788,400 + 1,200,000 + 2,442,899 = **53,431,299**` ✓ — the same figure the
ledger column reaches in Step 5.

| Metric | Derivation | Value |
|---|---|---:|
| `finance_costs_pence` (§3.9) | interest 2,514,308 + arrangement 1,200,000 + exit 660,000 + ancillary 0 | **4,374,308** |
| `total_development_cost_pence` (§3.10) | 91,388,400 + 4,374,308 | **95,762,708** |
| `profit_pence` (§3.12) | Σ gross receipts 120,000,000 − TDC 95,762,708 | **24,237,292** |
| `profit_is_unrealised` (§3.12) | nothing retained | **false** |
| `profit_on_cost_pct` (§3.13) | 24,237,292 / 95,762,708 = 0.253097418 → 2530.97418 → round 2531 | **25.31** |
| `profit_on_gdv_pct` (§3.14) | 24,237,292 / 120,000,000 = 0.201977433 → 2019.77433 → round 2020 | **20.2** |
| `peak_debt_pence` / `peak_debt_month` (§5.7) | month 9 pre-receipt balance | **53,431,299 / 9** |
| `day_one_advance_pence` (§5.1) | actual month-0 draw | **28,000,000** |
| `gross_ltc_pct` (§5.5) | 53,431,299 / 95,762,708 = 0.557955179 → 5579.55179 → round 5580 | **55.8** |
| `net_ltc_pct` (§5.4) | net advances (draws 54,188,400 + cap fees 1,200,000 = 55,388,400) / 89,188,400 = 0.621026912 → 6210.26912 → round 6210 | **62.1** |
| `ltgdv_developer_pct` (§5.6) | 53,431,299 / 120,000,000 = 0.445260825 → 4452.60825 → round 4453 | **44.53** |
| `equity_contributed_pence` (§3.15) | 14,188,400 + 4 × 5,000,000 + 811,600, no additional equity | **35,000,000** |
| `equity_multiple` (§3.16) | distributions (0 + 29,787,292 + 29,450,000 = 59,237,292) / 35,000,000 = 1.692494057 → round(169.2494)/100 | **1.69** |
| `funding_gap_pence` (§4.2) | no month unfunded (Step 4) | **0** |

Draws total for `net_ltc`: `28,000,000 (m0) + 4,188,400 (m5) + 5 × 4,400,000 (m6–m10) =
54,188,400` — **identical to fixture F's**, since the phasing changes receipts, not the cost
schedule, and the sweeps never free up facility that gets redrawn. That is why `net_ltc_pct` comes
out at F's pinned **62.1** unchanged, while `gross_ltc_pct` (peak-debt-based) and
`ltgdv_developer_pct` both move — a deliberate, derived contrast, not a coincidence.

**Identity check (spec §3.12).** Σ developer equity flows =
`−35,000,000 + 59,237,292 = 24,237,292` = `profit_pence` ✓. Unlike fixture H, this identity holds
unconditionally here because `funding_gap_pence = 0` — I is the phased fixture that keeps the
identity's *positive* case honest.

#### Step 7 — IRR (spec §3.17), hand-solved

Developer equity cash-flow vector (contributions negative, distributions positive), read off Steps
4–5's equity and distribution columns:

| t | 0 | 1 | 2 | 3 | 4 | 5 | 6–9 | 10 | 11 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| flow | −14,188,400 | −5,000,000 | −5,000,000 | −5,000,000 | −5,000,000 | −811,600 | 0 | +29,787,292 | +29,450,000 |

(Month 9's distribution is 0 — the whole first tranche was swept — so the vector has a genuine
zero at t = 9 between the contributions and the distributions.)

Solve `NPV(r) = 0` with `d = 1 + r`.

*Starting estimate.* Contribution-weighted mean month =
`(0 × 14,188,400 + 1 × 5,000,000 + 2 × 5,000,000 + 3 × 5,000,000 + 4 × 5,000,000 + 5 × 811,600) /
35,000,000 = 54,058,000 / 35,000,000 = 1.5445`; distribution-weighted mean month =
`(10 × 29,787,292 + 11 × 29,450,000) / 59,237,292 = 621,822,920 / 59,237,292 = 10.4964`; money
multiple `59,237,292 / 35,000,000 = 1.692494`; effective hold `10.4964 − 1.5445 = 8.9519` months →
`r ≈ 1.692494^(1/8.9519) − 1 ≈ 0.0605`. Round the trial point to **r = 0.0601** (the estimate is
crude by design; one Newton step from anywhere nearby lands on the root).

*Evaluation at `r = 0.0601`.* Powers of `d = 1.0601` (decimal expansion, 12 dp):
`d² = 1.123812010000`, `d³ = 1.191353111801`, `d⁴ = 1.262953433820`, `d⁵ = 1.338856935193`,
`d⁶ = 1.419322236998`, `d¹⁰ = 1.792537892914`, `d¹¹ = 1.900269420278`, `d¹² = 2.014475612437`.

| term | value |
|---|---:|
| −14,188,400 | −14,188,400.000 |
| −5,000,000 / 1.060100000000 | −4,716,536.176 |
| −5,000,000 / 1.123812010000 | −4,449,142.700 |
| −5,000,000 / 1.191353111801 | −4,196,908.499 |
| −5,000,000 / 1.262953433820 | −3,958,974.152 |
| −811,600 / 1.338856935193 | −606,188.741 |
| +29,787,292 / 1.792537892914 | +16,617,384.836 |
| +29,450,000 / 1.900269420278 | +15,497,802.409 |
| **NPV(0.0601)** | **−963.022** |

*Slope.* `NPV′(r) = Σ −t·CF_t / d^(t+1)`
= `5,000,000/d² + 2×5,000,000/d³ + 3×5,000,000/d⁴ + 4×5,000,000/d⁵ + 5×811,600/d⁶
− 10×29,787,292/d¹¹ − 11×29,450,000/d¹²`
= `4,449,142.700 + 8,393,816.998 + 11,876,922.457 + 14,938,115.847 + 2,859,111.127
− 156,752,993.455 − 160,811,080.561` = **−275,046,964.889**.

*Newton step.* `r = 0.0601 − (−963.022)/(−275,046,964.889) = 0.0601 − 0.0000035013` =
**0.0600964987** (≈ 6.01%/month). The next Newton correction is of order 1e−10 and cannot move any
reported digit (the exactly-converged root is 0.060096498773).

*Annualisation (§3.17).* `ln(1.0600964987) = 0.058359940559`; `× 12 = 0.700319286703`;
`e^0.700319286703 = 2.0143957746` → annual rate `1.0143957746`.
Cross-check without logs: `d¹²` at `d = 1.0601` is 2.0144756124 and `d(d¹²)/dd = 12·d¹¹ =
22.803233043`, so at `d = 1.0601 − 0.0000035013` →
`2.0144756124 − 22.803233043 × 0.0000035013 = 2.0144756124 − 0.0000798411 = 2.0143957713` — the two
routes agree to 3.3×10⁻⁹.

`irr_annual_pct = round(1.0143957746 × 10000)/100 = round(10143.957746)/100` = **101.44**
(the nearest rounding boundary, 10143.5, is 0.458 away — `r` would have to be wrong by more than
2.7×10⁻⁷ per month to move this figure; the derivation above is good to ~10⁻⁹).
`irr_monthly_pct = round(0.0600964987 × 10000)/100 = round(600.964987)/100` = **6.01**.

Fixture F's IRR on the same costs is 91.2%; I's is higher because 40% of the receipts arrive two
months earlier, which both shortens the hold and cuts the interest bill.

#### Step 8 — senior repayment break-even, phased regime (spec §5.11)

`sales_phasing` is non-null, so §5.11's phased regime applies: the minimum **total** gross sales `G`
(integer pence) such that a REPLAY of the sweep fully redeems the facility by term end, under a
uniform price-fall assumption (every tranche scales by the same factor, shares stay 40/35/25).

**The replay's frozen inputs** (§5.11: "freezes the actual run's monthly draws and capitalised
fees"), read off Step 4/5's Draw and Cap-fees columns:

| m | 0 | 1–4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| draw + cap fees | 29,200,000 | 0 | 4,188,400 | 4,400,000 | 4,400,000 | 4,400,000 | 4,400,000 | 4,400,000 | 0 |

No facility draw occurs after the final tranche month (m11's entry is 0), and `sales_sweep_pct = 100
> 0`, so neither of §5.11's two structurally-unsolvable cases applies — the break-even is solvable
and no `senior_breakeven_unsolvable` flag is raised.

Because the frozen schedule is the ledger's own and no receipt lands before month 9, the replay's
balance trajectory through month 9 is Step 4/5's exactly: pre-receipt `B₉ = **53,431,299**`.
Enforcement cost assumption is 0, so it deducts nothing from the first tranche.

**The fee-reserve regime (§5.11, current text — this is what makes the condition closed-form).** The
replay, unlike the ledger, *reserves* the exit fee out of **every** tranche's sweep before repaying
principal: with fee `f` due on redemption (0 once charged), a tranche's principal repayment is
`max(0, sweep − f)`, and full redemption occurs when `sweep ≥ balance + f`. Fixture I's fee basis is
`committed_gross_facility`, so `f = round(1% × 66,000,000) = **660,000**` at every tranche, a
constant — which is exactly why the condition below is *linear* in `G`.

**Closed form.** Write `k = 151/150` for one month's rolled-up accrual (`x → x + round(x/150)`,
treated continuously here), and let `n₉, n₁₀, n₁₁` be the tranche net proceeds at total gross `G`.
With shares 40/35/25, agent 1.5% pro-rata and legal 400,000 pro-rata:
`n₉ = 0.394G − 160,000`, `n₁₀ = 0.34475G − 140,000`, `n₁₁ = 0.24625G − 100,000`
(e.g. `0.394 = 0.40 − 0.015 × 0.40`).

Redemption cannot happen at tranche 1 or 2 for a minimal `G` — the later the redemption, the more
sweeps have already cut the balance, so the cheapest feasible `G` is the one that just redeems at
tranche 3. Tracing the replay under the partial (fee-reserving) arm at months 9 and 10:

1. after m9: `b₉′ = B₉ − (n₉ − f) = 53,431,299 + 660,000 − n₉ = 54,091,299 − n₉`
2. m10 draw + interest: `b₁₀ = (b₉′ + 4,400,000)·k`, with `b₉′ + 4,400,000 = 58,491,299 − n₉ =
   58,651,299 − 0.394G`
3. after m10: `b₁₀′ = b₁₀ − (n₁₀ − f)`
4. m11 (no draw) interest: `b₁₁ = b₁₀′·k`
5. redemption at m11 iff `n₁₁ ≥ b₁₁ + f`

Substituting (2)–(4) into (5):
`n₁₁ − f ≥ (58,651,299 − 0.394G)·k² − (n₁₀ − f)·k`, with `k = 1.0066666667` and
`k² = 22801/22500 = 1.0133777778`:

```
0.24625G − 760,000  ≥  59,435,923.044 − 0.399270844G  −  0.347048333G + 805,333.333
(0.24625 + 0.399270844 + 0.347048333)G  ≥  59,435,923.044 + 805,333.333 + 760,000
0.992569177G  ≥  61,001,256.377
G  ≥  61,457,939.44
```

The continuous threshold is therefore **61,457,939.44**, so the integer answer is 61,457,940 if the
integer rounding is neutral and 61,457,939 if it happens to work in the sale's favour by the missing
fraction of a penny. The closed form cannot decide between them: it ignores the rounding in the
tranche split and in the two `round(x/150)` interest lines. Which integer is minimal is settled below
by evaluating the replay **exactly** at 61,457,939 (feasible) and at 61,457,938 (infeasible). Those
two evaluations are jointly sufficient, because §5.11's fee reserve makes the replay's residual
balance continuous and weakly decreasing in `G` — feasibility is monotone, so a feasible `G` whose
predecessor is infeasible is *the* minimum.

**Exact evaluation at `G = 61,457,939`.** Split per §4.4.1 (`agent total = round(1.5% × G) =
round(921,869.085) = 921,869`):

| k | gross | derivation | agent | derivation | legal | **net** |
|--:|--:|---|--:|---|--:|--:|
| 1 | 24,583,176 | `round(0.40 × 61,457,939) = round(24,583,175.6)` | 368,748 | `round(921,869 × 24,583,176/61,457,939) = round(368,747.61)` | 160,000 | **24,054,428** |
| 2 | 21,510,279 | `round(0.35 × 61,457,939) = round(21,510,278.65)` | 322,654 | `round(921,869 × 21,510,279/61,457,939) = round(322,654.15)` | 140,000 | **21,047,625** |
| 3 | 15,364,484 | residue `G − 24,583,176 − 21,510,279` | 230,467 | residue `921,869 − 368,748 − 322,654` | 100,000 | **15,034,017** |

(Residue checks: gross Σ = 61,457,939 ✓; agent Σ = 921,869 ✓; legal `400,000 − 160,000 − 140,000 =
100,000` ✓.)

| m | balance before sweep | sweep | fee `f` | arm | balance after |
|--:|--:|--:|--:|---|--:|
| 9 | 53,431,299 | 24,054,428 | 660,000 | `24,054,428 < 53,431,299 + 660,000` → partial; repay `24,054,428 − 660,000 = 23,394,428` | **30,036,871** |
| 10 | `(30,036,871 + 4,400,000) + round(34,436,871/150 = 229,579.14) = 34,436,871 + 229,579` = **34,666,450** | 21,047,625 | 660,000 | `21,047,625 < 34,666,450 + 660,000` → partial; repay `21,047,625 − 660,000 = 20,387,625` | **14,278,825** |
| 11 | `14,278,825 + round(14,278,825/150 = 95,192.17) = 14,278,825 + 95,192` = **14,374,017** | 15,034,017 | 660,000 | `15,034,017 ≥ 14,374,017 + 660,000 = 15,034,017` — **equality** → full redemption | **0** |

Redeemed, terminal balance 0 → **feasible**, at exact equality to the penny.

**Exact evaluation at `G − 1 = 61,457,938`.** `agent total = round(1.5% × 61,457,938) =
round(921,869.07) = 921,869` (unchanged):

| k | gross | derivation | agent | legal | **net** |
|--:|--:|---|--:|--:|--:|
| 1 | 24,583,175 | `round(24,583,175.2)` | 368,748 | 160,000 | **24,054,427** |
| 2 | 21,510,278 | `round(21,510,278.3)` | 322,654 | 140,000 | **21,047,624** |
| 3 | 15,364,485 | residue | 230,467 | 100,000 | **15,034,018** |

| m | balance before sweep | sweep | fee `f` | arm | balance after |
|--:|--:|--:|--:|---|--:|
| 9 | 53,431,299 | 24,054,427 | 660,000 | partial; repay `24,054,427 − 660,000 = 23,394,427` | **30,036,872** |
| 10 | `34,436,872 + round(34,436,872/150 = 229,579.15) = 34,436,872 + 229,579` = **34,666,451** | 21,047,624 | 660,000 | partial; repay `20,387,624` | **14,278,827** |
| 11 | `14,278,827 + round(14,278,827/150 = 95,192.18) = 14,278,827 + 95,192` = **14,374,019** | 15,034,018 | 660,000 | `15,034,018 < 14,374,019 + 660,000 = 15,034,019` → partial; repay `15,034,018 − 660,000 = 14,374,018` | **1** |

Not redeemed; terminal balance **1 penny** outstanding → **infeasible**. Note that tranche 3's gross
is one penny *larger* at `G − 1` (the residue absorbs the two downward roundings of tranches 1 and 2)
and yet the case still fails, because tranches 1 and 2 each swept a penny less and those pennies
compounded forward — a nice demonstration that the replay is genuinely path-dependent, not a
one-line inequality.

Minimum feasible integer, and the expected `senior_breakeven_pence`, is therefore **61,457,939**
(£614,579.39). Against the modelled GDV that is a tolerable price fall of
`(120,000,000 − 61,457,939)/120,000,000 = 48.79%` before the senior facility is exposed.

`senior_breakeven_pct_of_lender_gdv` and `senior_breakeven_fall_from_lender_gdv_pct` are **null** —
fixture I has `lender_valuation: null`, exactly as fixture F does (§3.2: never silently defaulted to
developer GDV) — so neither is pinned.

**Why `redemption_balance_at_disposal_pence = 0` does not make this metric degenerate.** In the
single-shot regime that field *is* the break-even's whole input, and a zero would be meaningless.
The phased regime does not read it at all: it replays the frozen draw schedule. The field remains 0
because §4.4.1 defines it as the final disposal month's pre-receipt balance and month 11's balance
genuinely is 0 — I is the fixture that pins that distinction.

#### Step 9 — developer profit break-even (spec §5.12)

Unchanged in form from fixture G's worksheet (§5.12 is debt- and phasing-independent — it asks only
what total gross sales cover TDC), but with I's own TDC:
```
tdc_ex_selling = 95,762,708 − 2,200,000 = 93,562,708
P ≥ 93,562,708 + 400,000 + round(0.015 × P) = 93,962,708 + round(0.015 × P)
```
Closed-form guess: `93,962,708 / 0.985 = 95,393,612.183…`. Hand-checked integers either side:
- `P = 95,393,611`: `round(0.015 × 95,393,611) = round(1,430,904.165) = 1,430,904`; RHS =
  `93,962,708 + 1,430,904 = 95,393,612`; `95,393,611 < 95,393,612` → **infeasible**.
- `P = 95,393,612`: `round(0.015 × 95,393,612) = round(1,430,904.18) = 1,430,904`; RHS =
  `95,393,612`; `95,393,612 ≥ 95,393,612` (equality) → **feasible**.

So `developer_breakeven_pence` = **95,393,612**. (It is *above* the senior break-even of 61,457,939
here — but see fixture G's "deliberate non-assertion": no ordering between the two is asserted
anywhere, and none is claimed by this observation.)

#### Pinned `expected_metrics`

| Metric | Value | £ |
|---|---:|---:|
| `gdv_pence` | 120,000,000 | £1,200,000 |
| `acquisition_cost_pence` | 42,150,000 | £421,500 |
| `sdlt_pence` | 950,000 | £9,500 |
| `construction_cost_pence` | 44,000,000 | £440,000 |
| `professional_fees_pence` | 2,800,000 | £28,000 |
| `statutory_costs_pence` | 238,400 | £2,384 |
| `selling_costs_pence` | 2,200,000 | £22,000 |
| `cost_before_finance_pence` | 91,388,400 | £913,884 |
| `finance_costs_pence` | 4,374,308 | £43,743.08 |
| `total_development_cost_pence` | 95,762,708 | £957,627.08 |
| `profit_pence` | 24,237,292 | £242,372.92 |
| `profit_is_unrealised` | false | — |
| `profit_on_cost_pct` | — | 25.31% |
| `profit_on_gdv_pct` | — | 20.20% |
| `peak_debt_pence` | 53,431,299 | £534,312.99 |
| `peak_debt_month` | 9 | — |
| `day_one_advance_pence` | 28,000,000 | £280,000 |
| `gross_ltc_pct` | — | 55.80% |
| `equity_contributed_pence` | 35,000,000 | £350,000 |
| `equity_multiple` | 1.69 | — |
| `net_ltc_pct` | — | 62.10% |
| `ltgdv_developer_pct` | — | 44.53% |
| `irr_annual_pct` | — | 101.44% |
| `senior_breakeven_pence` | 61,457,939 | £614,579.39 |
| `developer_breakeven_pence` | 95,393,612 | £953,936.12 |
| `redemption_balance_at_disposal_pence` | 0 | £0 |
| `redemption_schedule_months` | [9, 10, 11] | — |
| `redemption_schedule_balances_pence` | [53,431,299, 10,782,708, 0] | — |
| `funding_gap_pence` | 0 | £0 |

The last three redemption keys are `MonthlyModel` fields rather than `AppraisalResultV2` properties,
so — like `funding_gap_pence` (fixture H) and the two `cost_to_complete_*` keys (fixture G) — they
reach the golden harness through the `FLAT_KEYS` mapper in `golden-fixtures.test.ts`, whose mapper
takes the whole `AppraisalRun`. The declining schedule is pinned as two parallel flat arrays rather
than an array of objects so the fixture JSON stays language-neutral for the Python mirror.

**Negative control (fixture H's precedent).** A pinned key that no assertion actually reaches is a
copy-paste false pass, not coverage — and the mapper indirection is exactly where that can happen
silently (a mapper typo would compare `undefined` against `undefined` for any fixture that did not
pin the key). `golden-fixtures.test.ts`'s `'negative control: a deliberately-wrong value for each
mapped key fails'` therefore flips each of `redemption_balance_at_disposal_pence` (1 instead of 0),
`redemption_schedule_months` (`[9, 10]`), `redemption_schedule_balances_pence` (terminal 1 instead
of 0), `funding_gap_pence` (1 instead of 0) and — as a control on the control — the direct key
`peak_debt_pence` (53,431,300 instead of 53,431,299) on fixture I, and asserts the assertion loop
**throws** for every one of them.

**Governance note.** Every figure above was derived on this worksheet *before* the fixture was pinned
or run against either engine (`docs/financial-model/model-governance.md`): the spend spread from §6's
straight-line rule, the tranche split from §4.4.1's closed form with all four residue checks, the
ledger from §4's monthly loop (independently validated by reproducing fixture F's two pinned finance
figures from the same table), the IRR from a hand Newton iteration with a log/derivative cross-check
on the annualisation, and the §5.11 break-even from the closed form under the current fee-reserve
text plus exact integer evaluations at `G` and `G − 1`. The engine was run only to confirm
agreement, and it agreed on every pinned value at the first run — no adjudication was required and
no engine code was touched.

---

### Fixture J — "J — blended exit, phased sales + same-month refinance" (`fixtures/financial-model/j-blended-refinance.json`)

**Purpose:** the first golden fixture with a non-null `refinance` block (spec §4.5, calc `2.3.0`,
Release 3b), and the first with `route: "blended"` — a sold portion *and* a retained portion. It is
fixture F's cost base again, but with u4 retained (so the sold portion is u1–u3, gross
**90,000,000**, and the retained portion is valued at **30,000,000**), the sold portion phased 60/40
across months **9** and **11**, and a refinance of the retained portion landing in month **11 as
well**. That collision is the point of the fixture: month 11 carries both the final sales tranche and
the refinance event, so it pins §4.5's *fixed* intra-month order — **sweep first, then refinance** —
and pins which of the two events the once-only exit fee attaches to. It is also the first fixture
where `profit_is_unrealised` is `true` with a real (non-null) IRR, the first to pin
`unrealised_value_pence`, and the first to run §5.11's phased break-even on a *sold portion* smaller
than GDV with the refinance deliberately excluded from the replay.

`inputs_version: 4`, `programme: null`, `lender_valuation: null` (so every lender-basis metric stays
`null`, as in F and I).

**Inputs (deltas from Fixture F):** exactly four —
- `inputs_version` 3 → 4, with the v4 additive blocks written explicitly (`programme: null`).
- `exit_strategy.route` `sell_all` → `blended`, with
  `retained_units: [{ unit_id: "u4", monthly_rent_pence: 150000 }]`.
- `sales_phasing`: `{ tranches: [ {month_offset 9, pct 60.0}, {month_offset 11, pct 40.0} ] }`.
- `refinance`: `{ month_offset 11, investment_value_pence 30,000,000, ltv_pct 65.0,
  arrangement_fee_pence 300,000, legal_costs_pence 100,000 }`.

Everything else — acquisition, unit mix, conversion costs, facility terms, equity, selling-cost
percentages, scenarios, deal spider — is byte-for-byte fixture F. The retained unit's rent
(150,000/month) is recorded for the reporting layer; the calculation model does **not** consume it
(§4.4: retained units book no sale receipt, and §4.5 derives the refinance from an explicit
`investment_value_pence`, never from a yield on rent). It is pinned here precisely so that a future
change which starts capitalising rent into the model would have to come back through this worksheet.

**Block validity.** `sales_phasing` (§4.4.1): two tranches (≥ 1 ✓); offsets 9 < 11, both whole months
in `[0, term − 1] = [0, 11]` ✓; percentages finite and > 0 ✓; `60.0 + 40.0 = 100.0` exactly ✓;
`route = 'blended'`, not `retain_all` ✓. `refinance` (§4.5): `route` is not `sell_all` ✓ (something
*is* retained); month 11 is a whole month in `[0, 11]` ✓; investment value ≥ 0 ✓; `0 < ltv ≤ 100` ✓;
fees ≥ 0 ✓.

#### Step 0 — net refinance proceeds (spec §4.5), stated first

§4.5: `net proceeds = round_half_up(investment_value_pence × ltv_pct / 100) − arrangement_fee −
legal_costs`.

```
round(30,000,000 × 65 / 100) = round(19,500,000.0) = 19,500,000
19,500,000 − 300,000 − 100,000                     = 19,100,000
```

**Net refinance proceeds = 19,100,000**, positive (so §4.5's "negative net proceeds are funded by
uncommitted additional equity" branch does not engage). Note it is materially *less* than the
retained portion's 30,000,000 valuation — 65% LTV less 400,000 of fees — which is what makes the
realised/unrealised split in Step 6 non-trivial rather than a wash.

#### Step 1 — cost totals (spec §3.3–§3.8)

Every cost input is fixture F's, so the cost lines are F's arithmetic — **except the selling costs**,
which are charged on the *sold portion only* (§3.7/§4.4: retained units are never sold, so they
attract no agent fee). That is the one line where J and I diverge before finance.

| Line | Derivation | Pence |
|---|---|---:|
| SDLT (§3.3) | commercial slice bands on 40,000,000: 0% × 15,000,000 + 2% × 10,000,000 + 5% × 15,000,000 | 950,000 |
| Acquisition cost (§3.3) | 40,000,000 + 950,000 + legal 500,000 + survey 300,000 + broker `round(1% × 40,000,000)` = 400,000 | 42,150,000 |
| Construction (§3.4) | base `round(100,000 × 400)` = 40,000,000; contingency `round(10% × 40,000,000)` = 4,000,000 | 44,000,000 |
| Professional (§3.5) | 1,500,000 + 500,000 + 500,000 + 300,000 + 0 | 2,800,000 |
| Statutory (§3.6) | prior approval 9,600 × 4 = 38,400 + CIL/S106 0 + building control 200,000 | 238,400 |
| GDV (§3.1) | 4 × 30,000,000 — **all** units, sold or retained | 120,000,000 |
| Sold-portion gross `G` (§4.4) | u1 + u2 + u3 = 3 × 30,000,000 | **90,000,000** |
| Retained value (§3.11) | GDV − G = 120,000,000 − 90,000,000, i.e. u4 | **30,000,000** |
| Selling costs (§3.7) | agent `round(1.5% × 90,000,000)` = 1,350,000 + legal 400,000 (charged flat, because units *do* sell) | **1,750,000** |
| Cost before finance **ex** selling (§5.4 denominator) | 42,150,000 + 44,000,000 + 2,800,000 + 238,400 | 89,188,400 |
| Cost before finance (§3.8) | 89,188,400 + 1,750,000 | **90,938,400** |

The ex-selling sub-total **89,188,400** is identical to fixtures A/F/I — the anchor that lets Step 3
below cite fixture I's ledger instead of re-deriving it. `cost_before_finance_pence` is 450,000 lower
than I's 91,388,400, exactly the agent fee saved on the unsold quarter
(`round(1.5% × 30,000,000) = 450,000`); the flat 400,000 legal fee is charged in full either way
(§3.7 — it is a flat fee, not pro-rated to the sold share).

#### Step 2 — spend spread, auto windows (spec §6, `programme: null`)

Term 12, same cost totals as F/I, so this is fixture I's Step 2 verbatim: construction window
`max(1, 12 − 2)` = 10 months (1–10) at 4,400,000 each; professional and statutory window
`ceil(10/2)` = 5 months (1–5) at 560,000 and 40,000; prior approval 38,400 and acquisition 42,150,000
at month 0.

| m | Acquisition | Construction | Professional | Statutory | **Uses total** |
|--:|--:|--:|--:|--:|--:|
| 0 | 42,150,000 | 0 | 0 | 38,400 | **42,188,400** |
| 1–5 | 0 | 4,400,000 | 560,000 | 40,000 | **5,000,000** each |
| 6–10 | 0 | 4,400,000 | 0 | 0 | **4,400,000** each |
| 11 | 0 | 0 | 0 | 0 | **0** |
| **Σ** | 42,150,000 | 44,000,000 | 2,800,000 | 238,400 | **89,188,400** |

Residue check: `42,188,400 + 5 × 5,000,000 + 5 × 4,400,000 = 89,188,400` = the Step 1 ex-selling
sub-total ✓. Nothing about the exit route touches the *uses* side, which is why this table is
identical to I's.

#### Step 3 — tranche split (spec §4.4.1), on the SOLD portion

§4.4.1's `G` is "the sold portion's gross receipts", **not** GDV — for a blended exit those differ.
Here `G = 90,000,000`. For k < K the gross is `round_half_up(G × pct_k / 100)`; the final tranche
absorbs the residue. The agent-fee total is `round_half_up(G × 1.5 / 100) = round(1,350,000.0) =
1,350,000` and the legal fee is the flat 400,000; both are apportioned `round_half_up(total × g_k/G)`
with the same final-tranche absorption.

| k | month | pct | gross `g_k` | derivation | agent `a_k` | derivation | legal `l_k` | derivation | **net** |
|--:|--:|--:|--:|---|--:|---|--:|---|--:|
| 1 | 9 | 60.0 | 54,000,000 | `round(90,000,000 × 60/100)` | 810,000 | `round(1,350,000 × 54,000,000/90,000,000)` | 240,000 | `round(400,000 × 0.6)` | **52,950,000** |
| 2 | 11 | 40.0 | 36,000,000 | residue `90,000,000 − 54,000,000` | 540,000 | residue `1,350,000 − 810,000` | 160,000 | residue `400,000 − 240,000` | **35,300,000** |

Residue checks (§4.4.1's "Σ = total exactly" invariant, all four):
- gross: residue 36,000,000 equals the ideal `round(90,000,000 × 40/100)` — exact here, so the
  residue absorbs nothing ✓ (Σ = 90,000,000 = `G`)
- agent: residue 540,000 equals the ideal `round(1,350,000 × 0.4)` ✓ (Σ = 1,350,000)
- legal: residue 160,000 equals the ideal `round(400,000 × 0.4)` ✓ (Σ = 400,000)
- nets: `52,950,000 + 35,300,000 = 88,250,000 = 90,000,000 − 1,750,000` ✓ — the Step 1 selling-cost
  total, so the phasing creates and loses no penny

#### Step 4 — senior ledger, months 0–8 (spec §4) — cite fixture I's Step 4

Facility terms are fixture F's/I's unchanged: committed net **60,000,000**, committed gross
**66,000,000**, day-one advance **28,000,000**, 8.0% p.a. → `monthly_rate = 8/100/12 = 1/150`, rolled
up, arrangement fee `round(2% × 60,000,000) = 1,200,000` capitalised at month 0, exit fee
`round(1% × 66,000,000) = **660,000**` on the `committed_gross_facility` basis (a *static* 660,000
whenever and against whatever balance it is charged — the fact that pins Step 5's "charged once"
question cleanly), ancillary lender fees 0, `development_cost_advance_pct = 100`, `equity_first`,
sweep 100%. Committed cash equity **35,000,000**. Gross-headroom cap (§4.2(c), rolled-up form)
`floor(66,000,000 / (1 + 1/150)) = floor(9,900,000,000/151) = 65,562,913`, less opening and
capitalised fees — checked below at every month and never binding.

**Months 0–8 are AGAIN identical to fixture I's Step 4 table, and to fixture F's ledger.** The uses
schedule (Step 2) is the same, the facility terms are the same, the equity is the same — and
receipts are an end-of-month event (§1.3) whose earliest occurrence in any of the three fixtures is
month 9, so no month before 9 can differ. Rather than re-derive it, this worksheet **cites fixture
I's Step 4 in full**, including its month-by-month draw derivation (m0 arrangement fee + 28,000,000
day-one advance + 14,188,400 equity; m1–m4 equity-funded at 5,000,000 each; m5 equity 811,600 +
draw 4,188,400, exhausting committed equity at exactly 35,000,000; m6–m8 draws of 4,400,000 each) and
its cap checks. The figures carried forward here are:

| Carried from fixture I Step 4 | Value |
|---|---:|
| Closing balance, month 8 | **48,677,449** |
| `cum_net_used` after month 8 (draws + capitalised fees) | **46,588,400** |
| Interest, months 0–8 (`194,667 + 195,964 + 197,271 + 198,586 + 199,910 + 229,165 + 260,026 + 291,093 + 322,367`) | **2,089,049** |
| Committed equity used, months 0–5 (`14,188,400 + 4 × 5,000,000 + 811,600`) | **35,000,000** |
| Funding gap, months 0–8 | **0** |

The **same F-reconciliation anchors this citation**: fixture I's Step 4 continues that identical
month-0–8 table under F's receipts schedule (no receipts before month 11) and lands on
`peak_debt_pence = 58,604,953` and `finance_costs_pence = 5,076,553` — fixture F's two pinned finance
figures, reproduced from the table rather than assumed. Because fixture J shares that table
month-for-month, the same reconciliation licenses it here; nothing in J's exit route can reach back
before month 9.

#### Step 5 — months 9–11: phased sweep, then the same-month refinance (spec §4.4, §4.4.1, §4.5)

Ordering within each month is §1.3's — costs and draws first, then interest on
`opening + draw + capitalised_fees`, then receipts/selling costs/sweep/distribution — with §4.5's
extra, *fixed* rule for month 11: **the sales sweep runs first, then the refinance event**.

**Month 9.** Uses 4,400,000; committed equity 0 (exhausted at m5). Caps: advance-%
`round(100% × eligible 4,400,000) = 4,400,000`; undrawn net `60,000,000 − 46,588,400 = 13,411,600`;
headroom `65,562,913 − 48,677,449 = 16,885,464`. Draw = `min(4,400,000, 4,400,000, 13,411,600,
16,885,464)` = **4,400,000** (`cum_net_used = 50,988,400`).
Interest = `round((48,677,449 + 4,400,000)/150) = round(53,077,449/150) = round(353,849.66)` =
**353,850**.
Balance before receipts = `48,677,449 + 4,400,000 + 353,850` = **53,431,299** — this is
`redemption_schedule[0]`, captured immediately before the month's receipts (§4.4.1).
Tranche 1 net = 52,950,000 (Step 3); sweep available = `round(52,950,000 × 100/100)` = 52,950,000.
Full redemption would need `53,431,299 + 660,000 = 54,091,299`, and `52,950,000 < 54,091,299` →
**partial arm** (§4.4: "receipts insufficient to cover principal plus exit fee do not discharge the
facility; the balance carries"). This is a *near miss by 1,141,299* — deliberately so: the fixture
would say nothing about §4.5's ordering if the first tranche had already cleared the facility.
Repayment = `min(52,950,000, 53,431,299)` = **52,950,000**; that is not equal to the balance, so
§4.4's fee clamp does not engage (it fires only in the narrow band `balance ≤ sweep < balance + fee`).
Exit fee charged this month = **0**. Closing balance = `53,431,299 − 52,950,000` = **481,299**.
Distribution = `52,950,000 − 52,950,000 − 0` = **0**.

**Month 10.** No tranche, no refinance — a pure accrual month. Uses 4,400,000; equity 0; caps:
advance-% 4,400,000, undrawn net `60,000,000 − 50,988,400 = 9,011,600`, headroom
`65,562,913 − 481,299 = 65,081,614` → draw **4,400,000** (`cum_net_used = 55,388,400`). The facility
has not been redeemed at the moment of this draw, so §4.4.1's `facility_redrawn_after_redemption`
flag does **not** fire.
Interest = `round((481,299 + 4,400,000)/150) = round(4,881,299/150) = round(32,541.99)` = **32,542** —
against fixture F's 385,542 in the same month. The stub balance left by tranche 1 is what makes J's
interest bill the lowest of the three F-derived fixtures.
Closing balance = `481,299 + 4,400,000 + 32,542` = **4,913,841**. No receipts → no schedule entry
(§4.4.1: one entry per *disposal* month).

**Month 11 — the collision month.** No uses, no draw (so again no
`facility_redrawn_after_redemption`). Opening 4,913,841; interest =
`round(4,913,841/150) = round(32,758.94)` = **32,759**.
Pre-receipt balance = `4,913,841 + 32,759` = **4,946,600** = `redemption_schedule[1]`, and — because
month 11 is the FINAL disposal month — also `redemption_balance_at_disposal_pence` (§4.4.1).

*Sub-step 11a — the sales sweep (§4.4, runs FIRST per §4.5).* Tranche 2 net = 35,300,000 (Step 3);
sweep available = 35,300,000. Full redemption needs `4,946,600 + 660,000 = 5,606,600`;
`35,300,000 ≥ 5,606,600` → **full redemption arm**. Repayment = **4,946,600**; exit fee =
**660,000**, charged here — *the sweep is the event that completes redemption*, so under §4.4.1's
once-only rule (which §4.5 explicitly extends "across sweep and refinance alike") the fee attaches to
the sweep and **not** to the refinance. Balance → **0**.
Distribution from the sweep = `35,300,000 − 4,946,600 − 660,000` = **29,693,400**.

*Sub-step 11b — the refinance (§4.5, runs SECOND).* Net proceeds 19,100,000 (Step 0), positive.
The facility balance it meets is **0**, because sub-step 11a already redeemed it. §4.5's "if the
facility has no balance (already redeemed…), the whole net proceeds distribute to equity" branch
applies: repayment **0**, exit fee **0** (already charged — and it would be 0 here even on a fresh
reading, since `facilityRedeemed` is now true), surplus/shortfall arithmetic **not reached**.
Distribution from the refinance = **19,100,000**.

*Month 11 totals.* Repayment 4,946,600; exit fee 660,000; refinance proceeds 19,100,000;
distribution = `29,693,400 + 19,100,000` = **48,793,400**; closing balance **0**.

**Where the 660,000 exit fee lands, and why it matters.** Had the order been reversed — refinance
first — the refinance would have met a balance of 4,946,600, redeemed it, taken the 660,000 fee
against its own proceeds and distributed a surplus of `19,100,000 − 4,946,600 − 660,000 =
13,493,400`, and the sweep would then have distributed its full 35,300,000: same total distribution
of 48,793,400, same closing balance, same fee charged once. The *totals* are order-invariant here by
construction (both events happen in the same month and both are cash), which is exactly why §4.5's
order has to be spec-stated rather than inferred: the **attribution** differs (which event carries
the repayment and the fee), and that attribution is what a lender-facing month-11 breakdown shows.
This fixture pins the spec's order — fee on the sweep — so a future reordering of the two blocks in
`runLedger` would change `months[11].repayment_pence` / `exit_fee_pence` / `refinance_proceeds_pence`
and be caught by anything asserting on that row, even though the summary metrics would not move.

**Surplus-or-shortfall (§4.5), recorded for completeness.** The branch that *did* run is
"already redeemed → distribute whole", so there is neither a surplus over `B + fee` nor a shortfall
against it, and no `additional_equity_required` flag: `additional_equity_pence = 0`. The
counterfactual is worth stating because it is the branch a reviewer will look for: against the
pre-sweep balance of 4,946,600 the refinance's 19,100,000 would have been a **surplus of 13,493,400**;
against a hypothetical balance above `19,100,000 − 660,000 = 18,440,000` it would have been a
shortfall funded by uncommitted additional equity. Neither number is pinned — only the actual path is.

Declining redemption schedule (§4.4.1), one entry per disposal month, balance captured immediately
before that month's receipts:

| entry | month | balance before receipts |
|--:|--:|--:|
| 0 | 9 | **53,431,299** |
| 1 | 11 | **4,946,600** |

Strictly declining ✓. Month 10 has no entry (no receipts). Unlike fixture I, the final entry here is
**non-zero**, so `redemption_balance_at_disposal_pence = **4,946,600**` — J and I between them pin
both sides of §4.4.1's definition (a facility still outstanding at the last disposal, and one already
cleared before it).

**Roll-forward check (spec §4 invariant), the three closing months:**
m9 `48,677,449 + 4,400,000 + 0 + 353,850 − 52,950,000 = 481,299` ✓;
m10 `481,299 + 4,400,000 + 0 + 32,542 − 0 = 4,913,841` ✓;
m11 `4,913,841 + 0 + 0 + 32,759 − 4,946,600 = 0` ✓ (the exit fee is its own line, not part of the
roll-forward, §4).

**Peak debt (spec §5.7)** = max over months of the intra-month pre-repayment balance. The balance
rises monotonically to month 9 and never regains that level, so peak = **53,431,299** at
`peak_debt_month = 9` — the same figure as fixture I, and for the same reason: months 0–9 are shared
ground and the first tranche lands at month 9 in both. Headroom at peak
`66,000,000 − 53,431,299 = 12,568,701` → no `facility_exceeded` flag.

#### Step 6 — summary metrics (spec §3, §5)

Interest total = months 0–8 (Step 4's carried 2,089,049) + m9 353,850 + m10 32,542 + m11 32,759:
`2,089,049 + 353,850 = 2,442,899`; `+ 32,542 = 2,475,441`; `+ 32,759 = **2,508,200**`.
Independent cross-check (§4's identity at month 9, the last month before any repayment): cumulative
draws through m9 = `28,000,000 (m0) + 4,188,400 (m5) + 4 × 4,400,000 (m6–m9) = 49,788,400`;
capitalised fees 1,200,000; interest m0–m9 `2,089,049 + 353,850 = 2,442,899`. Total
`49,788,400 + 1,200,000 + 2,442,899 = **53,431,299**` ✓ — the same figure Step 5's ledger column
reaches.

| Metric | Derivation | Value |
|---|---|---:|
| `finance_costs_pence` (§3.9) | interest 2,508,200 + arrangement 1,200,000 + exit 660,000 + ancillary 0 | **4,368,200** |
| `total_development_cost_pence` (§3.10) | 90,938,400 + 4,368,200 | **95,306,600** |
| `profit_pence` (§3.12) | gross receipts 90,000,000 **+ retained value 30,000,000** − TDC 95,306,600 | **24,693,400** |
| `profit_is_unrealised` (§3.11/§3.12) | retained value 30,000,000 > 0 | **true** |
| `unrealised_value_pence` (§3.11) | the retained portion's valuation, u4 | **30,000,000** |
| `profit_on_cost_pct` (§3.13) | 24,693,400 / 95,306,600 = 0.259094344 → 2590.94344 → round 2591 | **25.91** |
| `profit_on_gdv_pct` (§3.14) | 24,693,400 / 120,000,000 = 0.205778333 → 2057.78333 → round 2058 | **20.58** |
| `peak_debt_pence` / `peak_debt_month` (§5.7) | month 9 pre-receipt balance | **53,431,299 / 9** |
| `day_one_advance_pence` (§5.1) | actual month-0 draw | **28,000,000** |
| `gross_ltc_pct` (§5.5) | 53,431,299 / 95,306,600 = 0.560625382 → 5606.25382 → round 5606 | **56.06** |
| `net_ltc_pct` (§5.4) | net advances (draws 54,188,400 + cap fees 1,200,000 = 55,388,400) / 89,188,400 = 0.621026912 → 6210.26912 → round 6210 | **62.1** |
| `ltgdv_developer_pct` (§5.6) | 53,431,299 / 120,000,000 = 0.445260825 → 4452.60825 → round 4453 | **44.53** |
| `equity_contributed_pence` (§3.15) | committed 35,000,000 + additional 0 | **35,000,000** |
| `equity_multiple` (§3.16) | distributions `0 (m9) + 48,793,400 (m11)` = 48,793,400 / 35,000,000 = 1.394097143 → `round(139.4097)/100` | **1.39** |
| `funding_gap_pence` (§4.2) | no month unfunded (Steps 4–5) | **0** |

Draws for `net_ltc`: `28,000,000 (m0) + 4,188,400 (m5) + 5 × 4,400,000 (m6–m10) = 54,188,400` —
identical to fixtures F and I, since the exit route changes receipts, not the cost schedule. Hence
`net_ltc_pct` is F's and I's pinned **62.1** again, and `ltgdv_developer_pct` is I's **44.53** (same
peak, same GDV denominator — GDV is the *whole* scheme, §3.1, not the sold portion). `gross_ltc_pct`
moves to 56.06 only because J's TDC is smaller.

**Realised/unrealised identity (spec §3.12).** The §3.12 invariant "profit = Σ developer equity cash
flows" is stated for the case where the scheme is fully realised; J deliberately is not. The two
figures are:

```
Σ equity flows   = −35,000,000 + 48,793,400                      = 13,793,400
profit_pence     = 90,000,000 + 30,000,000 − 95,306,600          = 24,693,400
difference       = 30,000,000 − 19,100,000                       = 10,900,000
```

and the difference is *exactly* the part of the retained portion's 30,000,000 valuation that the
refinance did not monetise (65% LTV less 400,000 of refinance fees). Restating the identity on a
realised basis makes it hold to the penny:

```
realised profit = gross receipts 90,000,000 + refinance proceeds 19,100,000 − TDC 95,306,600
                = 13,793,400  =  Σ equity flows ✓
```

That is the whole content of `profit_is_unrealised: true` (§3.11/§3.12): the headline 24,693,400
carries 10,900,000 of value that no cash event in the model has realised, and the label — not a
different number — is how the spec requires that to be disclosed. Fixture J is the fixture that pins
the labelled case together with a *real* IRR; fixtures A/F/G/H/I all pin `false`.

**Adjudication — does the refinance enter profit? (spec §3.12, resolved against this fixture).**
This worksheet was derived against a §3.12 that then read, in two places:

> **Formula:** total net receipts (sale receipts net of selling costs; *refinance proceeds when
> modelled*) − TDC excluding selling costs…
>
> **Retained exits:** … the headline "profit" … is always labelled "unrealised — subject to
> refinance/valuation" *unless a refinance event is modelled, in which case its realised proceeds
> enter profit directly (§4.5)*.

Taken literally that would make J's profit `90,000,000 + 19,100,000 − 95,306,600 = 13,793,400` with
`profit_is_unrealised: false`. This worksheet pins the **opposite** — 24,693,400 on the valuation
basis, labelled unrealised — and the valuation-basis reading governs, for three reasons:

1. **Double-counting.** The retained portion is already in the numerator at its §3.11 valuation of
   30,000,000. A refinance does not sell it; it **borrows against it**, converting senior development
   debt into investment debt secured on the same asset. Adding the 19,100,000 of borrowed cash *on
   top of* the 30,000,000 valuation would count the retained unit's value one and a half times over,
   and would make profit rise simply by increasing the LTV on an unchanged asset — which is not a
   profit at all. The literal reading also cannot be repaired by substitution: replacing the
   valuation with the proceeds would report the asset at 65% LTV less fees, understating a retained
   holding the developer still owns outright.
2. **Scope.** The clause predates the modelled event. It is R1-era text about *labelling* — written
   when no refinance was computed and "refinance proceeds" meant a hypothetical future exit — that a
   Task-1-era stale-reference repair carried forward and overshot into an arithmetic claim. §3.11
   (retained units enter "at their **valuation** clearly labelled unrealised") and §4.5's own closing
   sentence ("Valuation-based components keep their 'unrealised' labelling (§3.11)") were never
   changed and both already said what this fixture pins.
3. **The cash is not lost — it is reported where it belongs.** The 19,100,000 is fully disclosed
   through month 11's distribution row, and flows into §3.15's equity vector, hence into
   `equity_multiple` (1.39) and `irr_annual_pct` (52.16). It changes the **timing and composition of
   equity cash flows**, not the profit numerator. The realised-basis identity above is exactly where
   it shows up as a profit-like quantity, and it balances to the penny.

§3.12 has been amended accordingly (calc `2.3.0` changelog: a specification correction, no computed
value changed — the engine always computed
`profit = Σ gross receipts + retained value − TDC`). The pinned `profit_pence` of **24,693,400** and
`profit_is_unrealised: true` are therefore a *derivation from the corrected spec*, not an engine
read-back, and the amended §3.12 now cites this fixture as the case that pins it.

#### Step 7 — IRR (spec §3.17), hand-solved

Developer equity cash-flow vector (contributions negative, distributions positive), read off Steps
4–5's equity and distribution columns:

| t | 0 | 1 | 2 | 3 | 4 | 5 | 6–10 | 11 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| flow | −14,188,400 | −5,000,000 | −5,000,000 | −5,000,000 | −5,000,000 | −811,600 | 0 | +48,793,400 |

Month 9's distribution is 0 (the whole first tranche was swept), and month 11's single positive flow
bundles the sweep's 29,693,400 with the refinance's 19,100,000 — which is §3.17's point about
retained exits: **without** the §4.5 refinance this vector would end at +29,693,400 and still solve,
but for a `retain_all` variant it would have no positive flow at all and IRR would be `null` by
construction. J is the fixture where a modelled refinance contributes a real, realised terminal flow.

Solve `NPV(r) = 0` with `x = 1/(1 + r)`:
`NPV = −14,188,400 − 5,000,000(x + x² + x³ + x⁴) − 811,600 x⁵ + 48,793,400 x¹¹`.

*Starting estimate.* Contribution-weighted mean month =
`(0 × 14,188,400 + 1 × 5,000,000 + 2 × 5,000,000 + 3 × 5,000,000 + 4 × 5,000,000 + 5 × 811,600) /
35,000,000 = 54,058,000 / 35,000,000 = 1.5445`; the single distribution sits at month 11; money
multiple `48,793,400 / 35,000,000 = 1.394097`; effective hold `11 − 1.5445 = 9.4555` months →
`r ≈ 1.394097^(1/9.4555) − 1 ≈ 0.0358`. Take the trial point **r = 0.0356** (one Newton step from
anywhere nearby lands on the root; a first pass from 0.0358 gave 0.0355978, which is why the
evaluation below is done at 0.0356).

*Evaluation at `r = 0.0356`.* Powers of `x = 1/1.0356 = 0.96562379` (8 dp):

| power | value |
|---|---:|
| `x` | 0.96562379 |
| `x²` | 0.93242930 |
| `x³` | 0.90037592 |
| `x⁴` | 0.86942442 |
| `x⁵` | 0.83953691 |
| `x⁶` | 0.81067681 |
| `x¹¹` | 0.68059311 |
| `x¹²` | 0.65719691 |

| term | value |
|---|---:|
| −14,188,400 | −14,188,400.00 |
| −5,000,000 × (x + x² + x³ + x⁴) = −5,000,000 × 3.66785343 | −18,339,267.15 |
| −811,600 × 0.83953691 | −681,368.16 |
| +48,793,400 × 0.68059311 | +33,208,451.86 |
| **NPV(0.0356)** | **−583.45** |

*Slope.* `NPV′(r) = −Σ t·CF_t·x^(t+1) = 5,000,000(x² + 2x³ + 3x⁴ + 4x⁵) + 4,058,000 x⁶
− 536,727,400 x¹²`
= `5,000,000 × 8.69960204 + 3,289,726.49 − 352,735,588.79`
= `43,498,010.20 + 3,289,726.49 − 352,735,588.79` = **−305,947,852.10**.

*Newton step.* `r = 0.0356 − (−583.45)/(−305,947,852.10) = 0.0356 − 0.000001907` =
**0.035598093** (≈ 3.56%/month). The independent first pass from `r = 0.0358` landed on 0.0355978,
agreeing to 3×10⁻⁷; the next correction is below 10⁻⁹ and cannot move any reported digit.

*Annualisation (§3.17).* `d¹² = 1/x¹² = 1/0.65719691 = 1.52161395` at `d = 1.0356`; correcting for
`Δr = −0.000001907` with `d(d¹²)/dd = 12·d¹¹ = 12/0.68059311 = 17.63168`:
`1.52161395 − 17.63168 × 0.000001907 = 1.52161395 − 0.00003363 = **1.52158032**`.
So the annual rate is `0.52158032` and

`irr_annual_pct = round(0.52158032 × 10000)/100 = round(5215.8032)/100` = **52.16**
(the nearest rounding boundary, 5215.5, is 0.30 away — `r` would have to be wrong by more than
1.7×10⁻⁶ per month to move this figure; the derivation above is good to ~2×10⁻⁸).
`irr_monthly_pct = round(0.035598093 × 10000)/100 = round(355.98093)/100` = **3.56** (derived, not
pinned — fixture I pins the annual figure only and J follows that precedent).

J's IRR is far below I's 101.44% and F's 91.2%, and the reason is structural rather than a modelling
loss: only 90,000,000 of the 120,000,000 GDV is ever sold, the retained quarter returns cash only
through a 65%-LTV refinance net of 400,000 of fees, and 40% of the sale receipts wait until month 11.
A lower IRR on a *higher* profit-on-cost than F (25.91% vs 24.4%) is exactly the retained-exit
trade-off the metric is supposed to show.

#### Step 8 — senior repayment break-even, phased regime (spec §5.11)

`sales_phasing` is non-null, so §5.11's phased regime applies: the minimum **total** gross sales `G`
for the SOLD portion (integer pence) such that a REPLAY of the sweep fully redeems the facility by
term end, under a uniform price-fall assumption (both tranches scale by the same factor, shares stay
60/40). Two scope points matter here and are pinned by this fixture:

1. **The replay EXCLUDES the refinance** (§5.11 verbatim: "EXCLUDES any planned refinance event —
   §5.11 answers the enforcement question: can sales alone redeem the facility"). J is the first
   fixture where that exclusion is observable at all, since it is the first with a refinance. It is
   also why the break-even is materially *above* the balance the real ledger had to clear: the real
   month 11 had 19,100,000 of refinance cash standing behind the sweep, and the break-even refuses to
   count it.
2. **`G` is the sold portion, 90,000,000**, not GDV — so the break-even is naturally read against
   90,000,000, not against 120,000,000.

**The replay's frozen inputs** (§5.11: "freezes the actual run's monthly draws and capitalised
fees"), read off Step 4/5's Draw and Cap-fees columns:

| m | 0 | 1–4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| draw + cap fees | 29,200,000 | 0 | 4,188,400 | 4,400,000 | 4,400,000 | 4,400,000 | 4,400,000 | 4,400,000 | 0 |

No facility draw occurs after the final tranche month (m11's entry is 0), and `sales_sweep_pct =
100 > 0`, so neither of §5.11's structurally-unsolvable cases applies — the break-even is solvable and
no `senior_breakeven_unsolvable` flag is raised. Because the frozen schedule is the ledger's own and
no receipt lands before month 9, the replay's balance through month 9 is Step 4/5's exactly:
pre-receipt `B₉ = **53,431,299**`. The enforcement-cost assumption is 0, so it deducts nothing from
the first tranche.

**The fee-reserve regime (§5.11).** The replay, unlike the ledger, *reserves* the exit fee out of
**every** tranche's sweep before repaying principal: with fee `f` due on redemption (0 once charged),
a tranche's principal repayment is `max(0, sweep − f)`, and full redemption occurs when
`sweep ≥ balance + f`. J's fee basis is `committed_gross_facility`, so `f = 660,000` at every tranche
— a constant, which is what makes the condition below linear in `G`.

**Closed form.** Write `k = 151/150` for one month's rolled-up accrual (treated continuously here),
and let `n₉, n₁₁` be the tranche nets at total gross `G`. With shares 60/40, agent 1.5% pro-rata and
legal 400,000 pro-rata:
`n₉ = 0.591G − 240,000`, `n₁₁ = 0.394G − 160,000` (e.g. `0.591 = 0.60 − 0.015 × 0.60`); their sum
`0.985G − 400,000` ✓.

Could the minimal `G` redeem at tranche 1 instead? Only if `n₉ ≥ B₉ + f`, i.e.
`0.591G ≥ 54,331,299`, i.e. `G ≥ 54,331,299/0.591 = 91,931,131.98`, so `G ≥ **91,931,132**` — *above*
the fixture's actual 90,000,000, and far above
the tranche-3 answer below. (The same inequality re-derives Step 5's "partial arm at month 9" from
the other direction: at the modelled `G = 90,000,000`, `n₉ = 52,950,000 < 54,091,299` ✓.) So the
cheapest feasible `G` is the one that just redeems at tranche 2, in month 11. Tracing the replay
under the fee-reserving partial arm at month 9:

1. after m9: `b₉′ = B₉ − (n₉ − f) = 53,431,299 + 660,000 − n₉ = 54,091,299 − n₉`
2. m10 draw + interest: `b₁₀ = (b₉′ + 4,400,000)·k`, with
   `b₉′ + 4,400,000 = 58,491,299 − n₉ = 58,731,299 − 0.591G`
3. m11 (no draw) interest: `b₁₁ = b₁₀·k`, so `b₁₁ = (58,731,299 − 0.591G)·k²`
4. redemption at m11 iff `n₁₁ ≥ b₁₁ + f`

Substituting, with `k² = 22801/22500 = 1.0133777778`:

```
0.394G − 160,000  ≥  59,516,993.267 − 0.598906267G + 660,000
(0.394 + 0.598906267)G  ≥  59,516,993.267 + 660,000 + 160,000
0.992906267G  ≥  60,336,993.267
G  ≥  60,768,065.72
```

Solved exactly (clearing `k² = 22801/22500` rather than carrying its decimal expansion, so no
precision is lost in the final division):
`G ≥ (22801 × 58,731,299 + 22500 × 820,000) / (22500 × 0.394 + 22801 × 0.591)
= 1,357,582,348,499 / 22,340.391 = **60,768,065.72002**`.

The continuous threshold is **60,768,065.72**, so the integer answer is 60,768,066 unless the
rounding in the tranche split and the two `round(x/150)` interest lines happens to work in the sale's
favour. The closed form cannot decide that; it is settled by evaluating the replay **exactly** at
60,768,066 (feasible) and 60,768,065 (infeasible). Those two evaluations are jointly sufficient
because §5.11's fee reserve makes the residual balance continuous and weakly decreasing in `G`, so
feasibility is monotone and a feasible `G` whose predecessor is infeasible is *the* minimum.

**Exact evaluation at `G = 60,768,066`.** Split per §4.4.1
(`agent total = round(1.5% × G) = round(911,520.99) = 911,521`):

| k | gross | derivation | agent | derivation | legal | **net** |
|--:|--:|---|--:|---|--:|--:|
| 1 | 36,460,840 | `round(0.60 × 60,768,066) = round(36,460,839.6)` | 546,913 | `round(911,521 × 36,460,840/60,768,066) = round(546,912.61)` | 240,000 | **35,673,927** |
| 2 | 24,307,226 | residue `G − 36,460,840` | 364,608 | residue `911,521 − 546,913` | 160,000 | **23,782,618** |

(Residue checks: gross Σ = 60,768,066 ✓; agent Σ = 911,521 ✓; legal `400,000 − 240,000 = 160,000` ✓.)

| m | balance before sweep | sweep | fee `f` | arm | balance after |
|--:|--:|--:|--:|---|--:|
| 9 | 53,431,299 | 35,673,927 | 660,000 | `35,673,927 < 53,431,299 + 660,000` → partial; repay `35,673,927 − 660,000 = 35,013,927` | **18,417,372** |
| 10 | `(18,417,372 + 4,400,000) + round(22,817,372/150 = 152,115.81) = 22,817,372 + 152,116` = **22,969,488** | — | — | no tranche this month | 22,969,488 |
| 11 | `22,969,488 + round(22,969,488/150 = 153,129.92) = 22,969,488 + 153,130` = **23,122,618** | 23,782,618 | 660,000 | `23,782,618 ≥ 23,122,618 + 660,000 = 23,782,618` — **equality** → full redemption | **0** |

Redeemed, terminal balance 0 → **feasible**, at exact equality to the penny.

**Exact evaluation at `G − 1 = 60,768,065`.**
`agent total = round(1.5% × 60,768,065) = round(911,520.975) = 911,521` (unchanged):

| k | gross | derivation | agent | legal | **net** |
|--:|--:|---|--:|--:|--:|
| 1 | 36,460,839 | `round(0.60 × 60,768,065) = round(36,460,839.0)` — exact | 546,913 | 240,000 | **35,673,926** |
| 2 | 24,307,226 | residue | 364,608 | 160,000 | **23,782,618** |

| m | balance before sweep | sweep | fee `f` | arm | balance after |
|--:|--:|--:|--:|---|--:|
| 9 | 53,431,299 | 35,673,926 | 660,000 | partial; repay `35,673,926 − 660,000 = 35,013,926` | **18,417,373** |
| 10 | `22,817,373 + round(22,817,373/150 = 152,115.82) = 22,817,373 + 152,116` = **22,969,489** | — | — | — | 22,969,489 |
| 11 | `22,969,489 + round(22,969,489/150 = 153,129.93) = 22,969,489 + 153,130` = **23,122,619** | 23,782,618 | 660,000 | `23,782,618 < 23,122,619 + 660,000 = 23,782,619` → partial; repay `23,782,618 − 660,000 = 23,122,618` | **1** |

Not redeemed; terminal balance **1 penny** outstanding → **infeasible**. Note that tranche 2's net is
*identical* at `G` and `G − 1` (the whole penny came off tranche 1, whose gross rounds down at
`G − 1`), so the failure is caused purely by that penny compounding forward through two months of
interest — the same path-dependence fixture I's Step 8 demonstrates, seen from the opposite side.

Minimum feasible integer, and the expected `senior_breakeven_pence`, is therefore **60,768,066**
(£607,680.66). Against the *sold portion's* 90,000,000 that is a tolerable price fall of
`(90,000,000 − 60,768,066)/90,000,000 = 32.48%` before the senior facility is exposed — a thinner
cushion than fixture I's 48.79%, which is the correct reading: the same facility is being cleared out
of three units' receipts rather than four, with the refinance explicitly not counted.

`senior_breakeven_pct_of_lender_gdv` and `senior_breakeven_fall_from_lender_gdv_pct` are **null** —
J has `lender_valuation: null` (§3.2: never silently defaulted to developer GDV) — so neither is
pinned.

#### Step 9 — developer profit break-even (spec §5.12)

§5.12 is debt-, phasing- and refinance-independent — it asks only what total gross sales cover TDC —
so the form is fixture G's and I's with J's own TDC:
```
tdc_ex_selling = 95,306,600 − 1,750,000 = 93,556,600
P ≥ 93,556,600 + 400,000 + round(0.015 × P) = 93,956,600 + round(0.015 × P)
```
Closed-form guess: `93,956,600 / 0.985 = 95,387,411.169…`. Hand-checked integers either side:
- `P = 95,387,410`: `round(0.015 × 95,387,410) = round(1,430,811.15) = 1,430,811`; RHS =
  `93,956,600 + 1,430,811 = 95,387,411`; `95,387,410 < 95,387,411` → **infeasible**.
- `P = 95,387,411`: `round(0.015 × 95,387,411) = round(1,430,811.165) = 1,430,811`; RHS =
  `95,387,411`; `95,387,411 ≥ 95,387,411` (equality) → **feasible**.

So `developer_breakeven_pence` = **95,387,411**. Note this figure is a *whole-scheme* sale price
solved against the whole TDC — it does not know that only 90,000,000 of stock is actually for sale,
which is precisely why §5.12 is documented as a distinct question from §5.11 and no ordering between
the two is asserted anywhere (fixture G's "deliberate non-assertion").

#### Pinned `expected_metrics`

| Metric | Value | £ |
|---|---:|---:|
| `gdv_pence` | 120,000,000 | £1,200,000 |
| `acquisition_cost_pence` | 42,150,000 | £421,500 |
| `sdlt_pence` | 950,000 | £9,500 |
| `construction_cost_pence` | 44,000,000 | £440,000 |
| `professional_fees_pence` | 2,800,000 | £28,000 |
| `statutory_costs_pence` | 238,400 | £2,384 |
| `selling_costs_pence` | 1,750,000 | £17,500 |
| `cost_before_finance_pence` | 90,938,400 | £909,384 |
| `finance_costs_pence` | 4,368,200 | £43,682 |
| `total_development_cost_pence` | 95,306,600 | £953,066 |
| `profit_pence` | 24,693,400 | £246,934 |
| `profit_is_unrealised` | true | — |
| `unrealised_value_pence` | 30,000,000 | £300,000 |
| `profit_on_cost_pct` | — | 25.91% |
| `profit_on_gdv_pct` | — | 20.58% |
| `peak_debt_pence` | 53,431,299 | £534,312.99 |
| `peak_debt_month` | 9 | — |
| `day_one_advance_pence` | 28,000,000 | £280,000 |
| `gross_ltc_pct` | — | 56.06% |
| `equity_contributed_pence` | 35,000,000 | £350,000 |
| `equity_multiple` | 1.39 | — |
| `net_ltc_pct` | — | 62.10% |
| `ltgdv_developer_pct` | — | 44.53% |
| `irr_annual_pct` | — | 52.16% |
| `senior_breakeven_pence` | 60,768,066 | £607,680.66 |
| `developer_breakeven_pence` | 95,387,411 | £953,874.11 |
| `redemption_balance_at_disposal_pence` | 4,946,600 | £49,466 |
| `redemption_schedule_months` | [9, 11] | — |
| `redemption_schedule_balances_pence` | [53,431,299, 4,946,600] | — |
| `funding_gap_pence` | 0 | £0 |

The last three redemption keys are `MonthlyModel` fields rather than `AppraisalResultV2` properties,
so — like `funding_gap_pence` (fixture H) and the two `cost_to_complete_*` keys (fixture G) — they
reach the golden harness through the `FLAT_KEYS` mapper in `golden-fixtures.test.ts`.
`unrealised_value_pence` is a direct `AppraisalResultV2` property and needs no mapper; J is simply
the first fixture for which it is non-zero and therefore worth pinning.

**Negative control (extended to fixture J).** The negative control introduced with fixture I is
parameterised over both fixtures in `golden-fixtures.test.ts`, because I and J exercise *different
sides* of the same mappers: I's `redemption_balance_at_disposal_pence` is 0 and its schedule ends at
0, while J's are 4,946,600 and end non-zero, and J's schedule has two entries where I's has three. A
mapper that silently returned a constant, or dropped the last entry, could pass one fixture's control
and fail the other's. The wrong values asserted to make the loop **throw** for J are
`redemption_balance_at_disposal_pence` 4,946,601, `redemption_schedule_months` `[9, 10]`,
`redemption_schedule_balances_pence` `[53,431,299, 4,946,601]`, `funding_gap_pence` 1, and — as a
control on the control, via a direct (unmapped) key — `peak_debt_pence` 53,431,300.

**Governance note.** Every figure above was derived on this worksheet *before* the fixture was pinned
or run against either engine (`docs/financial-model/model-governance.md`): the refinance proceeds from
§4.5's formula; the cost totals from §3 with the sold-portion selling-cost correction; the spend
spread from §6's straight-line rule; the tranche split from §4.4.1's closed form with all four residue
checks; months 0–8 of the ledger by citation of fixture I's Step 4 (itself validated against fixture
F's two pinned finance figures, which is the reconciliation that licenses the citation); months 9–11
from §4's monthly loop with §4.5's fixed sweep-then-refinance order applied sub-step by sub-step; the
IRR from a hand Newton iteration with an independent second trial point and a derivative cross-check
on the annualisation; and the §5.11 break-even from the closed form under the fee-reserve text plus
exact integer evaluations at `G` and `G − 1`. The engine was run only to confirm agreement.

---

### Fixture K — sensitivity suite (spec §12, calc 2.4.0)

Base document: Fixture F (`f-dev-finance-12mo`). Config: the §12.3/§12.4 defaults. Fixture K
carries no `inputs` of its own — it names `base_fixture: "f-dev-finance-12mo"`, so Fixture F's
document cannot drift away from the sensitivity contract built on it.

**Derived inputs, by axis.** The four levers write to disjoint fields (§12.1), so the
grid's derived inputs are the cross product of two short lists, not twenty-five
separate derivations.

GDV lever on a unit value of 30,000,000 pence (round-half-up, §1.1):

| step | multiplier | unit value (pence) |
|---|---|---|
| −15% | 0.85 | 25,500,000 |
| −10% | 0.90 | 27,000,000 |
| −5%  | 0.95 | 28,500,000 |
| 0%   | 1.00 | 30,000,000 |
| +5%  | 1.05 | 31,500,000 |
| +10% | 1.10 | 33,000,000 |

(±10% appear for the tornado only.) Four units, so GDV = 4 × the unit value.

Construction-cost lever on 100,000 pence/sqm:

| step | multiplier | pence/sqm | construction cost = 400 × rate × 1.10 |
|---|---|---|---|
| −10% | 0.90 |  90,000 | 39,600,000 |
| −5%  | 0.95 |  95,000 | 41,800,000 |
| 0%   | 1.00 | 100,000 | 44,000,000 |
| +5%  | 1.05 | 105,000 | 46,200,000 |
| +10% | 1.10 | 110,000 | 48,400,000 |
| +15% | 1.15 | 115,000 | 50,600,000 |

The construction column is `base = round_half_up(rate × 400)`, `contingency =
round_half_up(base × 10/100)`, total = base + contingency (§3.4) — e.g. at 115,000:
base 46,000,000, contingency 4,600,000, total **50,600,000**; at 95,000: base 38,000,000,
contingency 3,800,000, total **41,800,000**. Both are exact at every step here, so the
"× 1.10" shorthand in the table's header is legitimate rather than a coincidence of rounding.

Timeline lever on `term_months` 12: −3 → 9, +3 → 15.
Interest-rate lever on 8.0%: −1.0 → 7.0, +1.0 → 9.0.

**Base cell.** Identical to Fixture F's `expected_metrics` (§12.5), reused verbatim
rather than re-derived: profit 23,535,047; profit on cost 24.4%; profit on GDV 19.61%;
IRR 91.2%; LTGDV (developer) 48.84%; peak debt 58,604,953.

#### Shared ground for every appraisal below

Unchanged from Fixture F in all thirty-four appraisals (§12.2 — the facility is invariant):
acquisition cost **42,150,000** (SDLT 950,000), professional fees **2,800,000**, statutory
costs **238,400** (prior approval 9,600 × 4 = 38,400 at month 0; building control 200,000
spread), committed net facility **60,000,000**, committed gross **66,000,000**, day-one
advance **28,000,000**, arrangement fee `round(2% × 60,000,000)` = **1,200,000** capitalised
in month 0, exit fee `round(1% × 66,000,000)` = **660,000** on the static
`committed_gross_facility` basis, `development_cost_advance_pct` 100, `equity_first`, sweep
100%, committed cash equity **35,000,000** at month 0, rolled-up interest.

Monthly rate (§1.2) `r = annual/100/12`: 8.0% → **1/150**; 7.0% → **7/1200**; 9.0% → **3/400**.
Gross-headroom draw cap (§4.2(c), rolled-up form, as pinned by fixture "F-grosscap" in §3
below): `floor(committed_gross / (1 + r)) − opening_balance − capitalised_fees`. Its base term
is `floor(66,000,000 × 150/151)` = **65,562,913** at 8%, `floor(66,000,000 × 1200/1207)` =
**65,617,232** at 7%, `floor(66,000,000 × 400/403)` = **65,508,684** at 9%. **It never binds in
any of the ten appraisals below** — the undrawn-net cap always bites first — and that is checked
at each month where a draw is capped.

Selling costs (§3.7) are `round(1.5% × GDV) + 400,000`, so they move with the GDV lever and
with nothing else. Receipts are a single end-of-month event in the final month of the term
(§4.4, `sales_phasing` null).

Spend spread (§6, `programme: null`): construction straight-line over months `1..term−2`;
professional and statutory (the spread portion only) over the first half of that window,
`ceil(D/2)` months — the same reading used by fixture I's Step 2 above, and the only place
the timeline endpoints below are sensitive to it.

**Method note.** Every ledger below was rolled from §4's monthly loop on this worksheet before
either engine was run, using the same columns fixture I's Step 4 uses. The worksheet's method was
first validated by re-rolling Fixture F itself from scratch and reproducing all eight of F's
pinned figures — `peak_debt_pence` 58,604,953, `finance_costs_pence` 5,076,553,
`total_development_cost_pence` 96,464,953, `profit_pence` 23,535,047, 24.4%, 19.61%, 48.84% and
IRR 91.2% — exactly. That reproduction is what licenses the derivations that follow.

#### Corner cells

**Worst corner — row `construction_cost` +15%, column `gdv` −15%.**
Derived inputs: unit value 25,500,000 → GDV **102,000,000**; cost/sqm 115,000 → construction
**50,600,000**. Everything else is F's.

| Line | Derivation | Pence |
|---|---|---:|
| GDV (§3.1) | 4 × 25,500,000 | 102,000,000 |
| Acquisition (§3.3) | unchanged | 42,150,000 |
| Construction (§3.4) | 46,000,000 + 4,600,000 | 50,600,000 |
| Professional (§3.5) | unchanged | 2,800,000 |
| Statutory (§3.6) | unchanged | 238,400 |
| Selling (§3.7) | `round(1.5% × 102,000,000)` = 1,530,000 + 400,000 | 1,930,000 |
| Cost before finance **ex** selling | 42,150,000 + 50,600,000 + 2,800,000 + 238,400 | 95,788,400 |
| Cost before finance (§3.8) | 95,788,400 + 1,930,000 | **97,718,400** |

Spend spread: construction 50,600,000 over months 1–10 → `round(50,600,000/10)` = **5,060,000**
each, final month absorbs `50,600,000 − 9 × 5,060,000 = 5,060,000`. Professional 560,000 and
statutory 40,000 in months 1–5, as F. So uses are 42,188,400 (m0), 5,660,000 (m1–5),
5,060,000 (m6–10), 0 (m11). Σ = 95,788,400 ✓

| m | Opening | Uses | Equity | Draw | Cap fees | Interest = round((open+draw+fees)/150) | Gap | Closing |
|--:|--:|--:|--:|--:|--:|---|--:|--:|
| 0 | 0 | 42,188,400 | 14,188,400 | 28,000,000 | 1,200,000 | 29,200,000/150 = 194,666.67 → **194,667** | 0 | 29,394,667 |
| 1 | 29,394,667 | 5,660,000 | 5,660,000 | 0 | 0 | → **195,964** | 0 | 29,590,631 |
| 2 | 29,590,631 | 5,660,000 | 5,660,000 | 0 | 0 | → **197,271** | 0 | 29,787,902 |
| 3 | 29,787,902 | 5,660,000 | 5,660,000 | 0 | 0 | → **198,586** | 0 | 29,986,488 |
| 4 | 29,986,488 | 5,660,000 | 3,831,600 | 1,828,400 | 0 | 31,814,888/150 = 212,099.25 → **212,099** | 0 | 32,026,987 |
| 5 | 32,026,987 | 5,660,000 | 0 | 5,660,000 | 0 | 37,686,987/150 = 251,246.58 → **251,247** | 0 | 37,938,234 |
| 6 | 37,938,234 | 5,060,000 | 0 | 5,060,000 | 0 | 42,998,234/150 = 286,654.89 → **286,655** | 0 | 43,284,889 |
| 7 | 43,284,889 | 5,060,000 | 0 | 5,060,000 | 0 | 48,344,889/150 = 322,299.26 → **322,299** | 0 | 48,667,188 |
| 8 | 48,667,188 | 5,060,000 | 0 | 5,060,000 | 0 | 53,727,188/150 = 358,181.25 → **358,181** | 0 | 54,085,369 |
| 9 | 54,085,369 | 5,060,000 | 0 | 5,060,000 | 0 | 59,145,369/150 = 394,302.46 → **394,302** | 0 | 59,539,671 |
| 10 | 59,539,671 | 5,060,000 | 0 | **3,071,600** | 0 | 62,611,271/150 = 417,408.47 → **417,408** | **1,988,400** | 63,028,679 |
| 11 | 63,028,679 | 0 | 0 | 0 | 0 | 63,028,679/150 = 420,191.19 → **420,191** | 0 | 0 (redeemed) |

Draw derivation (§4.2), only where it differs from F:

- **m0.** Identical to F: fee 1,200,000 capitalised (`cum_net_used = 1,200,000`), day-one advance
  `min(28,000,000, 58,800,000, 42,188,400, 65,562,913 − 0 − 1,200,000)` = 28,000,000
  (`cum_net_used = 29,200,000`), equity 14,188,400.
- **m1–m3.** Equity remaining 20,811,600 / 15,151,600 / 9,491,600 — each ≥ 5,660,000, so equity
  funds them entirely. Equity used after m3 = `14,188,400 + 3 × 5,660,000 = 31,168,400`.
- **m4.** Equity remaining `35,000,000 − 31,168,400 = 3,831,600` < 5,660,000 → equity 3,831,600,
  remainder 1,828,400. Caps: advance-% 5,660,000; undrawn net `60,000,000 − 29,200,000 =
  30,800,000`; headroom `65,562,913 − 29,986,488 = 35,576,425`. Draw = **1,828,400**
  (`cum_net_used = 31,028,400`). Equity is now exhausted at exactly 35,000,000 — one month
  earlier than F, which is the first visible consequence of the +15% cost lever.
- **m5–m9.** Equity 0; the undrawn-net cap is the only one anywhere near binding.
  `cum_net_used` runs 36,688,400 (m5) → 41,748,400 → 46,808,400 → 51,868,400 → **56,928,400** (m9).
  Headroom at m9 = `65,562,913 − 54,085,369 = 11,477,544`, far above the 5,060,000 drawn ✓
- **m10.** Need 5,060,000. Caps: advance-% 5,060,000; undrawn net `60,000,000 − 56,928,400 =
  **3,071,600**`; headroom `65,562,913 − 59,539,671 = 6,023,242`. Draw = min = **3,071,600**, and
  the residual `5,060,000 − 3,071,600 = **1,988,400`** is a **funding gap** (§4.2 step 3) — not
  funded, recorded, flagged red. The committed net facility is now used to exactly 60,000,000.
  This is the §12.2 finding the suite exists to surface: the adverse cell is *not* given more debt.

Sanity check on the gap, independent of the ledger: total funding capacity is equity 35,000,000
plus net facility 60,000,000 less the 1,200,000 arrangement fee that consumes it = 93,800,000,
against ex-selling costs of 95,788,400 → shortfall **1,988,400** ✓ (identical to the ledger's).

Redemption, month 11: net receipt = `102,000,000 − 1,530,000 − 400,000` = 100,070,000; balance
before receipts = **63,448,870**; full redemption needs `63,448,870 + 660,000 = 64,108,870` ≤
100,070,000 → full-redemption arm. Repayment 63,448,870, exit fee 660,000 charged once,
closing 0, distribution `100,070,000 − 63,448,870 − 660,000` = **35,961,130**.

Roll-forward spot check (§4 invariant): m10 `59,539,671 + 3,071,600 + 0 + 417,408 = 63,028,679` ✓;
m11 `63,028,679 + 0 + 0 + 420,191 − 63,448,870 = 0` ✓

- Interest total = `194,667 + 195,964 + 197,271 + 198,586 + 212,099 + 251,247 + 286,655 + 322,299 +
  358,181 + 394,302 + 417,408 + 420,191` = **3,448,870**
- Finance costs (§3.9) = `3,448,870 + 1,200,000 + 660,000` = **5,308,870**
- TDC (§3.10) = `97,718,400 + 5,308,870` = **103,027,270**
- Profit (§3.12) = `102,000,000 − 103,027,270` = **−1,027,270** — negative, never clamped (§3.12/§9)
- Profit on cost (§3.13) = `−1,027,270 / 103,027,270` = −0.9970855…% → **−1.0**
- Profit on GDV (§3.14) = `−1,027,270 / 102,000,000` = −1.0071275…% → **−1.01**
- Peak debt (§5.7) = max intra-month pre-repayment balance = month 11's **63,448,870**
- LTGDV developer (§5.6) = `63,448,870 / 102,000,000` = 62.2047745…% → **62.2**
- Equity cash flows (§3.15): m0 −14,188,400; m1–m3 −5,660,000 each; m4 −3,831,600; m5–m10 0;
  m11 +35,961,130. Σ = `−35,000,000 + 35,961,130` = +961,130 = profit + funding gap − 0… no:
  the §3.12 identity `profit = Σ equity flows` does **not** hold here, and correctly so — the
  1,988,400 of unfunded cost never left anybody's pocket, so `Σ equity flows − profit =
  961,130 − (−1,027,270) = 1,988,400` is exactly the funding gap. That reconciliation is itself
  a check on the gap.
- IRR (§3.17): monthly root of the flow vector above = 0.00282749/month → annual
  `(1.00282749)¹² − 1` = 3.4462506…% → **3.45**
- Facility position: peak 63,448,870 **exceeds the committed net facility** (60,000,000 −
  63,448,870 = −3,448,870, the rolled-up interest sitting on top of a fully drawn net facility)
  but sits **inside the committed gross facility** (66,000,000 − 63,448,870 = +2,551,130 headroom).
  §5.9/§4 define `facility_exceeded` against the **gross** facility, so it does **not** fire here;
  `funding_gap` is the flag that fires. Flags: **`["funding_gap"]`**.

**Best corner — row `construction_cost` −5%, column `gdv` +5%.**
Derived inputs: unit value 31,500,000 → GDV **126,000,000**; cost/sqm 95,000 → construction
**41,800,000**.

| Line | Derivation | Pence |
|---|---|---:|
| GDV | 4 × 31,500,000 | 126,000,000 |
| Construction | 38,000,000 + 3,800,000 | 41,800,000 |
| Selling | `round(1.5% × 126,000,000)` = 1,890,000 + 400,000 | 2,290,000 |
| Cost before finance ex selling | 42,150,000 + 41,800,000 + 2,800,000 + 238,400 | 86,988,400 |
| Cost before finance | 86,988,400 + 2,290,000 | **89,278,400** |

Spend spread: construction 41,800,000 over months 1–10 → **4,180,000** each (final absorbs
`41,800,000 − 9 × 4,180,000 = 4,180,000`). Uses: 42,188,400 (m0), 4,780,000 (m1–5),
4,180,000 (m6–10), 0 (m11). Σ = 86,988,400 ✓

| m | Opening | Uses | Equity | Draw | Cap fees | Interest (÷150) | Closing |
|--:|--:|--:|--:|--:|--:|---|--:|
| 0 | 0 | 42,188,400 | 14,188,400 | 28,000,000 | 1,200,000 | **194,667** | 29,394,667 |
| 1 | 29,394,667 | 4,780,000 | 4,780,000 | 0 | 0 | **195,964** | 29,590,631 |
| 2 | 29,590,631 | 4,780,000 | 4,780,000 | 0 | 0 | **197,271** | 29,787,902 |
| 3 | 29,787,902 | 4,780,000 | 4,780,000 | 0 | 0 | **198,586** | 29,986,488 |
| 4 | 29,986,488 | 4,780,000 | 4,780,000 | 0 | 0 | **199,910** | 30,186,398 |
| 5 | 30,186,398 | 4,780,000 | 1,691,600 | 3,088,400 | 0 | 33,274,798/150 = 221,831.99 → **221,832** | 33,496,630 |
| 6 | 33,496,630 | 4,180,000 | 0 | 4,180,000 | 0 | 37,676,630/150 = 251,177.53 → **251,178** | 37,927,808 |
| 7 | 37,927,808 | 4,180,000 | 0 | 4,180,000 | 0 | 42,107,808/150 = 280,718.72 → **280,719** | 42,388,527 |
| 8 | 42,388,527 | 4,180,000 | 0 | 4,180,000 | 0 | 46,568,527/150 = 310,456.85 → **310,457** | 46,878,984 |
| 9 | 46,878,984 | 4,180,000 | 0 | 4,180,000 | 0 | 51,058,984/150 = 340,393.23 → **340,393** | 51,399,377 |
| 10 | 51,399,377 | 4,180,000 | 0 | 4,180,000 | 0 | 55,579,377/150 = 370,529.18 → **370,529** | 55,949,906 |
| 11 | 55,949,906 | 0 | 0 | 0 | 0 | 55,949,906/150 = 372,999.37 → **372,999** | 0 (redeemed) |

Draws: equity remaining after m0 is 20,811,600 and covers m1–m4's 4,780,000 in full (leaving
`20,811,600 − 4 × 4,780,000 = 1,691,600`); m5 takes the last 1,691,600 of equity and draws
`4,780,000 − 1,691,600 = 3,088,400` (caps: advance-% 4,780,000, undrawn net 30,800,000, headroom
`65,562,913 − 30,186,398 = 35,376,515` — none binds). m6–m10 draw 4,180,000 each; `cum_net_used`
ends at `29,200,000 + 3,088,400 + 5 × 4,180,000 = 53,188,400`, leaving **6,811,600 of undrawn net
facility** — this corner never approaches either cap. No funding gap in any month.

Redemption, month 11: net receipt = `126,000,000 − 1,890,000 − 400,000` = 123,710,000; balance
before receipts = **56,322,905**; `56,322,905 + 660,000` ≤ 123,710,000 → full redemption.
Distribution = `123,710,000 − 56,322,905 − 660,000` = **66,727,095**.

- Interest total = `194,667 + 195,964 + 197,271 + 198,586 + 199,910 + 221,832 + 251,178 + 280,719 +
  310,457 + 340,393 + 370,529 + 372,999` = **3,134,505**
- Finance costs = `3,134,505 + 1,200,000 + 660,000` = **4,994,505**
- TDC = `89,278,400 + 4,994,505` = **94,272,905**
- Profit = `126,000,000 − 94,272,905` = **31,727,095**
- Profit on cost = `31,727,095 / 94,272,905` = 33.6545214…% → **33.65**
- Profit on GDV = `31,727,095 / 126,000,000` = 25.1802341…% → **25.18**
- Peak debt = month 11's **56,322,905**; LTGDV = `56,322,905 / 126,000,000` = 44.7007183…% → **44.7**
- Equity flows: m0 −14,188,400; m1–m4 −4,780,000 each; m5 −1,691,600; m11 +66,727,095.
  Σ = `−35,000,000 + 66,727,095` = **+31,727,095 = profit** ✓ (§3.12's identity, which holds here
  because the facility is fully repaid and nothing is retained — and its failure to hold at the
  worst corner is diagnosed above rather than ignored)
- IRR: monthly root 0.07041062 → `(1.07041062)¹² − 1` = 126.2584925…% → **126.26**
- Peak sits 9,677,095 inside the committed gross facility and 3,677,095 inside the committed net
  facility. No flags: **`[]`**.

#### Tornado spans

Each bar is two more single-lever appraisals (§12.4). Only the endpoint profits are needed, but
each is derived through the same chain, and each span carries a closed-form cross-check that does
not go through the ledger roll at all.

| lever | low document | low profit | high document | high profit | span |
|---|---|---:|---|---:|---:|
| `gdv` | unit 27,000,000 (GDV 108,000,000) | 11,715,047 | unit 33,000,000 (GDV 132,000,000) | 35,355,047 | **23,640,000** |
| `construction_cost` | 90,000/sqm (39,600,000) | 28,099,145 | 110,000/sqm (48,400,000) | 18,964,323 | **9,134,822** |
| `timeline` | `term_months` 9 | 24,322,508 | `term_months` 15 | 22,738,001 | **1,584,507** |
| `interest_rate` | 7.0% | 23,948,077 | 9.0% | 23,118,809 | **829,268** |

**`gdv` ±10%.** The GDV lever touches no ledger input, and both endpoints still redeem in full,
so the entire ledger — every draw, every interest line, peak debt 58,604,953, finance costs
5,076,553 — is *byte-identical to Fixture F's*. Only GDV and the 1.5% agent fee move:

- low: selling `round(1.5% × 108,000,000) + 400,000` = 2,020,000; CBF 91,208,400;
  TDC `91,208,400 + 5,076,553` = 96,284,953; profit `108,000,000 − 96,284,953` = **11,715,047**
- high: selling `round(1.5% × 132,000,000) + 400,000` = 2,380,000; CBF 91,568,400;
  TDC 96,644,953; profit `132,000,000 − 96,644,953` = **35,355,047**
- span = 35,355,047 − 11,715,047 = **23,640,000**.
  Cross-check without either appraisal: `ΔGDV − Δagent fee = 24,000,000 − 360,000 = 23,640,000` ✓

**`construction_cost` ±10%.** GDV and selling costs are unchanged at 120,000,000 / 2,200,000;
construction moves and drags the ledger with it.

- low (39,600,000; months 1–10 at 3,960,000; uses 4,560,000 in m1–5, 3,960,000 in m6–10): equity
  covers m1–m4 and 2,571,600 of m5, so m5 draws 1,988,400; interest lines 194,667 / 195,964 /
  197,271 / 198,586 / 199,910 / 214,499 / 242,329 / 270,344 / 298,546 / 326,937 / 355,516 /
  357,886 = **3,052,455**; finance 4,912,455; CBF 86,988,400; TDC 91,900,855;
  profit **28,099,145**; peak 54,040,855.
- high (48,400,000; months 1–10 at 4,840,000; uses 5,440,000 in m1–5, 4,840,000 in m6–10): equity
  covers m1–m3 and 4,491,600 of m4, so m4 draws 948,400; interest lines 194,667 / 195,964 /
  197,271 / 198,586 / 206,233 / 243,874 / 277,767 / 311,885 / 346,231 / 380,806 / 415,611 /
  418,382 = **3,387,277**; finance 5,247,277; CBF 95,788,400; TDC 101,035,677;
  profit **18,964,323**; peak 63,175,677 (still inside the 66,000,000 gross facility, and
  `cum_net_used` peaks at 58,388,400 — no funding gap: the +10% cost lever stops just short of
  the wall the +15% corner hits).
- span = 28,099,145 − 18,964,323 = **9,134,822**.
  Cross-check: `Δconstruction + Δinterest = 8,800,000 + (3,387,277 − 3,052,455) = 8,800,000 +
  334,822 = 9,134,822` ✓

**`timeline` ±3 months.** No cost total and no rate changes — only the number of months over
which the same money is spread and interest compounds, so the span is purely `Δ(total interest)`.

- low, `term_months` 9: construction window `max(1, 9 − 2)` = 7 months (1–7),
  `round(44,000,000/7) = 6,285,714` with the final month absorbing
  `44,000,000 − 6 × 6,285,714 = 6,285,716`; professional/statutory window `ceil(7/2)` = 4 months
  (1–4) at 700,000 + 50,000. Uses: 42,188,400 (m0), 7,035,714 (m1–3), 7,035,714 (m4),
  6,285,714 (m5–6), 6,285,716 (m7), 0 (m8). Equity covers m1–m2 in full and 6,740,172 of m3
  (leaving a 295,542 draw); interest lines 194,667 / 195,964 / 197,271 / 200,556 / 248,798 /
  292,362 / 336,215 / 380,362 / 382,897 = **2,429,092**; finance 4,289,092; TDC 95,677,492;
  profit **24,322,508**; peak 57,817,492 at m8. `cum_net_used` ends at 55,388,400 — inside the
  facility, no gap.
- high, `term_months` 15: construction window 13 months (1–13), `round(44,000,000/13) = 3,384,615`
  with the final month absorbing `44,000,000 − 12 × 3,384,615 = 3,384,620`;
  professional/statutory window `ceil(13/2)` = 7 months (1–7) at 400,000 + 28,571, the seventh
  absorbing `200,000 − 6 × 28,571 = 28,574`. Equity covers m1–m5 and 1,745,670 of m6; interest
  lines 194,667 / 195,964 / 197,271 / 198,586 / 199,910 / 201,243 / 216,368 / 243,231 / 267,417 /
  291,764 / 316,273 / 340,946 / 365,783 / 390,785 / 393,391 = **4,013,599**; finance 5,873,599;
  TDC 97,261,999; profit **22,738,001**; peak 59,401,999 at m14.
- span = 24,322,508 − 22,738,001 = **1,584,507**.
  Cross-check: `Δinterest = 4,013,599 − 2,429,092 = 1,584,507`, and every other line of the two
  appraisals is identical ✓ (CBF 91,388,400 both ends, as at the base)

**`interest_rate` ±1.0pp.** Nothing but the monthly rate changes; the draw schedule is unchanged
from F's because equity still runs out in month 5 in both endpoints.

- low, 7.0% (`r = 7/1200`): interest lines 170,333 / 171,327 / 172,326 / 173,332 / 174,343 /
  199,792 / 226,624 / 253,613 / 280,759 / 308,063 / 335,527 / 337,484 = **2,803,523**;
  finance 4,663,523; TDC 96,051,923; profit **23,948,077**; peak 58,191,923.
- high, 9.0% (`r = 3/400`): interest lines 219,000 / 220,643 / 222,297 / 223,965 / 225,644 /
  258,750 / 293,690 / 328,893 / 364,360 / 400,092 / 436,093 / 439,364 = **3,632,791**;
  finance 5,492,791; TDC 96,881,191; profit **23,118,809**; peak 59,021,191.
- span = 23,948,077 − 23,118,809 = **829,268**.
  Cross-check: `Δinterest = 3,632,791 − 2,803,523 = 829,268` ✓

**Ordering (§12.4)** — spans descending, ties broken by the fixed lever order
`gdv`, `construction_cost`, `timeline`, `interest_rate`. There are no ties here; the four spans
are separated by more than a factor of two at every adjacent pair:

`23,640,000 > 9,134,822 > 1,584,507 > 829,268` →
**`["gdv", "construction_cost", "timeline", "interest_rate"]`**

The order happens to coincide with the §12.4 tie-break order, so the *sequence* alone would also be
produced by an engine that never sorted at all. What this fixture pins against that is the four
span values themselves, which no unsorted implementation can fake. Pinning the sort's behaviour
under a non-trivial ordering is left to the §12 invariant suite, which is Release 4a's next task —
recorded here so the limitation is visible rather than assumed away.

**Governance note.** Every figure in this section was derived on this worksheet *before* either
engine was run, from §3, §4, §6 and §12 alone, and the worksheet's method was first validated by
re-deriving Fixture F end to end and reproducing all eight of F's pinned figures. The engine was
run only to confirm agreement, and it agreed on every value at the first attempt. The remaining
twenty-three grid cells are *identity-asserted* rather than hand-derived, under the recorded and
approved exception in `model-governance.md` §2.1.

### Fixture K — `invalid_case` (spec §12.7, R5)

Base fixture F runs `finance.term_months = 12`.

| Timeline step | Resulting term | ≥ 1? | Outcome |
|---|---|---|---|
| −12 | 12 + (−12) = 0 | no | unmeasured — `finance.term_months` error |
| −11 | 12 + (−11) = 1 | yes | measured |
| 0 | 12 + 0 = 12 | yes | measured |

No arithmetic beyond the term addition and the comparison against 1: §12.7 keys off
validation, and `validation.ts:61` / `validation.py:83` reject a term below one month. The
−11 row is carried deliberately so the boundary is pinned from the measured side too — a
rule that marked every position unmeasured would satisfy the −12 row alone.

### Sensitivity suite hardening — typed failures, notes, and page/memo wiring (spec §12.6/§12.7, R6)

R6 adds no formula and changes no computed value — calc stays `2.5.0` — so this section records
tests only, not new fixture arithmetic: the two documented §12.6/§12.7 failures become named error
types (spec §12.7's added sentence above), and the page/memo/format layer around them is tightened
to match.

**The two typed failures are distinguishable, both engines.** `runSensitivity`/`run_sensitivity`
raise `InvalidSensitivityConfigError` for a §12.6 config defect and `InvalidBaseDocumentError` for
a §12.7 base-document defect, and a consumer can tell them apart by type alone:
- TS `frontend/src/lib/model/sensitivity.test.ts`, describe block `'runSensitivity — the two
  documented failures are typed (§12.6, §12.7)'`: `'raises InvalidSensitivityConfigError for a
  config that is not a grid'`, `'raises InvalidBaseDocumentError when the base document fails
  validation'`, `'keeps the two failures distinguishable'`, `'keeps both errors instances of
  Error'`.
- Python `tests/test_financial_model_sensitivity.py`: `test_config_failure_is_typed`,
  `test_base_document_failure_is_typed`, `test_the_two_failures_are_distinguishable`,
  `test_both_failures_remain_value_errors`.

**The memo propagates a non-base-document failure instead of degrading §10.**
`frontend/src/lib/export-investment-memo.test.ts`, describe block `'generateInvestmentMemo — base
document fails validation (spec §12.7)'`: `'propagates a failure that is not an invalid base
document, rather than degrading §10'` pins that a mocked `runSensitivity` throw which is not
`InvalidBaseDocumentError` reaches the caller rather than being rendered as a §12.7 omission;
`'still degrades §10 for the documented invalid-base-document failure'` re-pins the one condition
§10 does handle against the same narrowed catch.

**`safeRunSensitivity` rethrows a failure that is not one of the two documented ones.**
`frontend/src/lib/safe-sensitivity.test.ts`: `'rethrows a failure that is neither of the suite\'s
documented ones'` (a mocked `TypeError` from inside `runSensitivity` propagates, rather than being
folded into the `{ ok: false }` result); the documented pair remain values, per `'returns the
invalid-base-document failure as a value (§12.7)'` and `'returns the invalid-config failure as a
value (§12.6)'`.

**`unmeasuredCellNotes` — dedup, first-appearance order, multi-error joining.**
`frontend/src/lib/sensitivity-format.test.ts`, describe block `'unmeasuredCellNotes'`:
`'returns no notes for a fully measured grid'`, `'gives a measured cell no note index'`,
`'deduplicates one reason shared across many cells into a single note'`, `'keeps distinct reasons
as separate notes, in first-appearance order'`, `'does not alphabetize the notes'`, `'joins a
cell\'s several validation errors into one note'`, `'resolves a note index by reason rather than by
object identity'`.

**Direct tests for `isMeasuredBar` and `omittedTornadoNotes`.** Same file:
- describe `'isMeasuredBar'`: `'accepts a bar with a span'`, `'rejects a bar whose low endpoint was
  not measured'`, `'rejects a bar whose high endpoint was not measured'`, `'rejects a bar with
  neither endpoint measured'`, `'accepts a genuine zero span'`.
- describe `'omittedTornadoNotes'`: `'returns nothing when every bar is measured'`, `'carries the
  engine\'s own message for the omitted bar'`, `'gives each omitted bar its own reason, in bar
  order'`, `'joins both endpoints\' reasons when neither was measured'`.

**A genuine 0-pence span sorts ahead of a null span, both engines.** Fixture `a-all-cash` has no
facility and no interest-rate exposure, so its `interest_rate` tornado bar produces a real 0 span
while its 12-month term makes the `timeline` bar at −12 unmeasurable — the two must not compare
equal under a null-as-zero sort:
- TS `sensitivity.test.ts`: `'sorts a genuine 0-pence span ahead of a null one'`.
- Python `tests/test_financial_model_sensitivity.py`: `test_genuine_zero_span_sorts_ahead_of_a_null_span`.

**The cost lever moves peak debt until the committed facility caps it, both engines (Fixture F,
spec §12.2).**
- TS `sensitivity.test.ts`: `'lets the cost lever move peak debt until the committed facility
  stops it (§12.2)'`.
- Python `tests/test_financial_model_sensitivity.py`: `test_cost_lever_moves_peak_debt_until_the_facility_stops_it`.

**Unmeasured-cell reasons reach the page as visible text with `aria-describedby`.**
`frontend/src/components/calculator/SensitivityPage.test.tsx`: `'names an unmeasured cell\'s
reason in visible text tied to the cell'` asserts the reason is rendered as a visible note and that
each unmeasured cell's `aria-describedby` resolves to that note's `id` (companion regression:
`'no longer carries the reason in a title attribute'`).

**The memo's §10 carries the notes instead of the old generic caption.**
`export-investment-memo.test.ts`, describe block `'sensitivityTables — unmeasured matrix cells name
their reason'`: `'carries no notes for a grid whose positions are all measured'`, `'carries the
engine\'s own reason, once, for a row invalidated by one cause'`, `'no longer carries the caption
that only described the ambiguity'` (asserts the PDF text no longer contains the string `'may mean
the metric is undefined'`).

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

**Files:** `frontend/src/lib/model/invariants.test.ts` (full); `tests/test_financial_model_fixtures.py::test_invariants` (a separate, stronger unconditional check over the base fixtures only — kept
alongside, not superseded, by the matrix below); `tests/test_financial_model_fixtures.py::TestInvariantMatrix` (full port, Release 2b Task 7 — closes the gap this section used to record; widened
to the full 6-fixture, 5-variant matrix by Release 3a Task 9); and
`tests/test_financial_model_fixtures.py::TestPhasedSaleRefinanceSweepInvariants` (Release 3b Task
10 — the phased-sale/refinance sweep matrix, §4.2 below).

### 4.1 The general ledger-invariant matrix

The TS suite runs every fixture in `fixtures/financial-model/*.json` (A, F, G, H, I and J — six as
of Release 3b) through five derived variants — `base`, `retain_all` (exit route forced to
`retain_all`), `serviced` (interest type forced to `serviced`), `term=1` (term forced to one
month), and `programme` (a generic dated programme fitted to the variant's term, Release 3a Task 9,
spec §6.1) — giving 6 fixtures × 5 variants = 30 independent runs of each invariant below, not just
the six literal fixtures.
`TestInvariantMatrix` in `test_financial_model_fixtures.py` builds the exact same 6×5 = 30-way
matrix (`_invariant_variants`, deep-copying each fixture's parsed inputs and mutating
`exit_strategy.route` / `finance.interest_type` / `finance.term_months` / the programme block,
mirroring TS's `variants()` function field-for-field) and asserts all eight invariants below, one
Python test method per TS `it()` (same order) so a single invariant's failure doesn't mask the
others — the same diagnostic granularity as the TS suite, parametrised
(`pytest.mark.parametrize`) rather than a hand-unrolled loop:

1. **Debt roll-forward invariant** — every month, `closing = opening + draw + capitalised_fees +
   interest_capitalised − repayment`, and `closing >= 0` always (spec §4, roll-forward invariant).
2. **Sources equal uses unconditionally** (spec §7) — `reconciliation.sources_equal_uses` is
   `true` on every run, not just fully-realised ones (Release 3a Task 9; closes the gap where only
   the fully-realised profit-identity check below, #7, exercised this identity).
3. **Peak debt correctness** — `peak_debt_pence` equals the maximum, across all months, of the
   pre-repayment balance (`opening + draw + capitalised_fees + interest_accrued` when rolled up),
   floored at 0 (spec §5.7).
4. **Zero-debt zero finance cost** — when `funding_source === 'cash'`, `finance_costs_pence` and
   `totals.draws_pence` are both exactly 0 (spec §3.9, §9).
5. **Retained exits receive no sale proceeds** — when `exit_strategy.route === 'retain_all'`,
   every month's gross receipts and `selling_costs_pence` are 0 (spec §4.4).
6. **Monthly schedule spreads sum to cost totals** — the sum of each month's construction /
   professional / statutory spread equals the schedule's cost totals (spec §6, rounding residue
   absorbed in the final month of each window).
7. **Profit = Σ equity flows, and sources = uses** — checked only when the deal is "fully
   realised" (`senior_outstanding_at_maturity_pence === 0`, no retained value, no funding gap):
   `profit_pence` equals the sum of `equity_cashflows_pence`, and
   `reconciliation.sources_equal_uses` is `true` (spec §3.12 identity, §7 invariant).
8. **TDC = sum of ledger uses plus interest, capitalised fees and exit fee** (spec §7) —
   `total_development_cost_pence` equals `Σ months.uses_total_pence + Σ interest_capitalised +
   Σ interest_serviced + selling_costs_pence + exit_fee_pence + capitalised_fees_pence`. A code
   comment records why this isn't a naive sum: month-0 `uses_total_pence` includes ancillary fees
   but not the capitalised arrangement fee, while TDC does include it, so the identity needs the
   explicit `+ capitalised_fees_pence` term (a Task 6 correction against the first draft of the
   spec's §7 reading).

The eight `TestInvariantMatrix` methods, in the same order as the numbered list above:
`test_debt_rollforward_reconciles_and_closing_balance_never_negative`,
`test_sources_equal_uses_unconditionally`,
`test_peak_debt_equals_the_maximum_monthly_pre_repayment_balance`,
`test_cash_funding_produces_zero_debt_cost`, `test_retained_exits_receive_no_sale_proceeds`,
`test_monthly_schedule_spreads_sum_exactly_to_cost_totals`,
`test_profit_equals_equity_flows_and_sources_equal_uses_when_fully_realised`,
`test_tdc_equals_the_sum_of_all_monthly_uses_plus_rolled_interest_capitalised_fees_and_exit_fee`.
This gives 30 × 8 = 240 independent checks, matching the TS suite's assertion-group count exactly
(6 fixtures × 5 variants × 8 `it()`s in `invariants.test.ts`'s top `describe` block).

**Closed (Release 2b Task 7).** This section used to record that the Python side checked only 2 of
the invariants (roll-forward, sources-equal-uses), over the base fixtures only, with no variant
generation. That gap is closed by `TestInvariantMatrix`. The original, narrower `test_invariants`
function is kept alongside (not deleted, not superseded): it is a strictly *unconditional* check of
roll-forward and `sources_equal_uses` over the six base fixtures — a stronger, if narrower-scoped,
guarantee than the matrix's conditional #7 for those specific runs, so removing it would have
been a net loss of coverage, not a cleanup. The whole-pipeline golden-fixture parity test (§2)
continues to pin the Python engine's numeric output for every fixture to the penny as a second,
independent line of defence.

### 4.2 The phased-sale / refinance sweep matrix (Release 3b Task 10, calc 2.3.0)

A second, narrower matrix targets the phased-disposal and refinance mechanics fixtures I and J
introduced (spec §4.4.1/§4.5) — properties that don't apply to the general fixture set (A/F/G/H
carry no `sales_phasing` or `refinance` block) so they are not folded into §4.1's matrix. TS:
`invariants.test.ts`'s `'phased-sale / refinance sweep invariants'` describe block; Python:
`TestPhasedSaleRefinanceSweepInvariants` in `test_financial_model_fixtures.py`. Both run fixtures I
and J through three derived variants — `base`, `odd-gross` (every unit's value nudged by a
distinct odd pence amount, so gross sale totals and tranche/agent-fee rounding land on awkward
pence) and `three-tranche` (`sales_phasing` replaced with a 3-tranche 33.4/33.3/33.3 split) — 2
fixtures × 3 variants = 6 runs, each asserting four invariants:

1. **Tranche conservation** — Σ receipts' `gross_sale_pence` = `schedule.totals.gross_sales_pence`;
   Σ `agent_fee_pence` = `round(gross_sales_pence × selling_agent_fee_pct / 100)`; Σ
   `selling_legal_pence` = the flat `selling_legal_fee_pence` (0 when nothing sold) — exact, by the
   final tranche's residue absorption (spec §4.4.1).
2. **Sweep conservation** — for every month, `distribution_pence + repayment_pence +
   exit_fee_pence == net_receipts_pence + refinance_proceeds_pence + additional_equity_pence`.
   This is an *exact* pinned identity (not a bound), derived directly from
   `monthly-engine.ts`/`engine.py`'s sweep block (`distribution = net_receipts − repayment −
   exit_fee`) composed with the refinance block's three arms — the identity's scope (rolled-up
   interest, non-negative refinance net proceeds — both true of every run in this matrix, so
   `additional_equity_pence` carries no serviced-interest component) is recorded in the TS test's
   comment.
3. **Interest never accrues on repaid principal** — for every consecutive month pair,
   `interest_accrued[m+1] == round((closing_balance[m] + draw[m+1] + capitalised_fees[m+1]) ×
   monthly_rate)`, since `opening[m+1] == closing_balance[m]` unconditionally in the ledger
   roll-forward.
4. **Redemption schedule declines** — `redemption_schedule` balances are non-increasing and months
   strictly increasing, and `redemption_balance_at_disposal_pence` equals the schedule's last entry
   (spec §4.4.1).

This gives 6 × 4 = 24 independent checks per language, symmetric with the TS suite
(`test_tranche_conservation_gross_agent_legal`, `test_sweep_conservation_every_month`,
`test_interest_never_accrues_on_repaid_principal`, `test_redemption_schedule_declines` — one
Python method per TS `it()`, same order).

### 4.3 Combined total

§4.1 + §4.2: **240 + 24 = 264** independent invariant checks per language — TS and Python parity
exact at every level (same fixtures, same variants, same invariants, same counts).

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
npm test                    # or: npx vitest run — runs the full suite (358 tests at Release 2b)
npx tsc -p tsconfig.app.json --noEmit   # type check
npx vitest run src/lib/model/golden-fixtures.test.ts src/lib/model/monthly-engine.test.ts \
  src/lib/model/invariants.test.ts src/lib/model/irr.test.ts src/lib/model/breakeven.test.ts \
  # model layer only
```

**Backend (Python / pytest), from the repo root:**
```bash
python -m pytest -q                              # full suite (333 tests at Release 2b)
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
- **Both cross-language gaps this section used to record are closed (Release 2b Task 7):**
  - The **invariant suite's variant matrix** (§4) — previously lighter in Python (TS checked 7
    invariants across 2 fixtures × 4 derived variants = 8 runs; Python checked 2 of those
    invariants across the 2 base fixtures only, with no `retain_all`/`serviced`/`term=1` variant
    generation) — is now fully ported: `TestInvariantMatrix` in `test_financial_model_fixtures.py`
    checks all 7 invariants across the same 3 fixtures × 4 derived variants (12 runs) as TS, one
    Python test method per TS `it()`. See §4 for the full method list.
  - **No shared migration-mapping fixture** — previously TS had a dedicated hand-derived unit-test
    file for the v1→v2 migration itself, `frontend/src/lib/model/migrate.test.ts` (4 tests), with
    no Python-side counterpart asserting `migrate_inputs()`'s output directly against the same
    hand-derived cases. Closed by `tests/test_migrate_v2.py`, which ports all 4 cases from
    `migrate.test.ts` verbatim (same `V1_SNAPSHOT` input dict, same expected values):
    `test_passes_a_v2_document_through_unchanged`,
    `test_migrates_v1_ltv_pct_to_an_unconfirmed_proposed_facility_never_an_approved_metric`,
    `test_creates_a_single_unconfirmed_cash_equity_source_for_v1_snapshots`, and
    `test_forces_zero_facility_for_v1_cash_funding`. `test_migrate_v3.py` remains the sibling
    v2→v3 port (Task 2); together the two files cover both migration steps case-for-case in both
    languages. The narrower `test_migration_preserves_floors_zero` regression and the end-to-end
    `test_appraisal_governance.py::test_v1_snapshot_migrates_to_legacy_unreconciled` check remain in
    place alongside these, unchanged.
- **Rounding parity (spec §1.1):** TypeScript rounds with `Math.round` (half-up toward +∞);
  Python must use `math.floor(x + 0.5)`, explicitly *not* `round()` (Python's banker's rounding
  would disagree with TS on `.5` boundaries). Both are required to agree to the penny on every
  golden fixture — this is what `test_golden_fixture_parity` actually enforces, not merely "close
  enough" numeric agreement. Fractional-area products round once, at source, before contingency:
  `base = round_half_up(construction_cost_per_sqm_pence × total_construction_sqm)` (Release 2b
  Task 7). This is registered by a matching regression in both languages —
  `calculateTotalConstructionCost` in `conversion-calc-engine.test.ts` and
  `calculate_total_construction_cost` in `TestCalculateTotalConstructionCostFractionalSqmRounding`
  (`test_financial_model_engine.py`) — both asserting `round_half_up(50,000 × 500.5) = 25,025,000`
  (an exact-integer product, proving the rounding site accepts a fractional sqm input without
  disturbing an already-whole result) and the odd-half case `round_half_up(333 × 100.5) =
  round_half_up(33,466.5) = 33,467` (which a banker's-rounding implementation would wrongly round
  down to 33,466). Existing integer-sqm golden and ledger fixtures are unaffected: rounding an
  already-integer product is the identity function, so no pinned value moves.
- **The governance procedure that keeps this true going forward** (formula-change procedure) is
  defined in `docs/financial-model/model-governance.md` §2: any calculation change edits the spec
  first, then the fixture (with a hand derivation recorded, as above), then both engines in the
  same change — never one language ahead of the other.

---

## 12. Report release gate [R7 — calc 2.6.0]

**Location:** `frontend/src/lib/report-qa/`. TypeScript only, and deliberately so:
the reports are generated in the browser, and there is no second implementation
to keep in parity. Nothing in the application imports this directory, so it is
absent from the production bundle.

| Module | Role |
|---|---|
| `pdf-inspect.ts` | Parses jsPDF's uncompressed content streams into positioned, measured text items — page, text, x, baseline, size, base font, rotation, advance width, bounding box. |
| `pdf-inspect.test.ts` | Calibrates the inspector against documents whose geometry is known by construction, never against the memo it measures. |
| `report-checks.ts` | The gate's predicates: `overflowingItems`, `sparsePages`, `pageExtentRatio`, `pageFillRatio`, `documentProse`, `watermarkTexts`, `describeLayout`. |
| `memo-fixtures.ts` | Sell-all, retain-all, refinance, blended and a legacy v1 snapshot, authored separately from `export-investment-memo.test.ts`'s fixtures. |
| `memo-release-gate.test.ts` | 52 assertions over those five documents (spec §13). |
| `quick-report-gate.test.ts` | The same page-bounds rule applied to the eligibility and appraisal quick reports. |

### 12.1 Why geometry rather than substring matching

The audit's release blocker was a line of text that was present, correct and
drawn at 40 pt, 400 mm off the right-hand edge of page 8. Every substring
assertion in the existing suite passed on that document. A gate that cannot see
the defect it exists to catch is not a gate, so every layout assertion is made
against measured position and width.

The corollary bit during this release: `documentText` joins items with newlines,
so a wrapped sentence straddles a break and `toContain('not a credit paper')`
fails on a document that says exactly that. Prose assertions use
`documentProse`, which reflows. (Compare R6's lesson that `toContain` cannot see
a repeat — the same class of test that is blind to what it claims to check.)

### 12.2 Sparse-page detection

Two measures, because either alone is wrong:

- **Extent** — distance from the first item's top to the last item's bottom, over
  the content box. The primary measure. A page holding one table is mostly white
  by construction (row padding, leading); judging it by ink would condemn an
  ordinary schedule page.
- **Ink** — covered 1 mm rows. Catches the page whose content technically reaches
  the bottom but consists of two lines.

Plus an item-count floor, which is what actually catches the orphan: a heading
and three lines.

Thresholds: extent ≥ 40 % (interior), ≥ 20 % (last page), ink ≥ 6 %, ≥ 5 body
items. Cover exempt.

### 12.3 New golden fixture

`fixtures/financial-model/l-retain-all.json` — all-cash, retain-all, no
realisation event. Pins §3.16.1: `has_realisation_event` false,
`equity_multiple` null, `return_on_equity_is_unrealised` true, alongside the full
independently derived cost stack. Every expected value was derived by hand from
the specification before the engine was run, and matched on the first execution.

Registered in both rosters (`EXPECTED_FIXTURE_STEMS` in
`tests/test_financial_model_fixtures.py` and `golden-fixtures.test.ts`).

### 12.4 Realisation-basis unit tests

`metrics.test.ts` › "distributed-return basis" and
`test_financial_model_metrics.py` › `TestDistributedReturnBasis`, mirrored
case-for-case. The boundary that matters is the pair:

- a sale whose receipts sweep entirely to senior debt → multiple `0.00` (a real answer);
- a retain-all case with no exit → multiple `null` (no answer exists).

A test suite that only covered "no distributions" would pass with either
behaviour and would not have caught the defect the audit reported.

### 12.5 Not covered

- **Raster visual regression.** Rendering each page to an image needs a PDF
  rasteriser (pdf.js plus a native canvas) that this project does not depend on.
  `describeLayout` provides a deterministic layout snapshot instead — the same
  regression control at the geometry level rather than the pixel level — and
  `memo-release-gate.test.ts` asserts that two runs of the same inputs produce
  an identical layout.
- **PDF/UA structure tagging.** Not expressible through jsPDF's public API. The
  documents carry title, subject, language and `DisplayDocTitle`; a structure
  tree, role map and artifact marking remain open.


---

## 13. Acquisition tax and jurisdiction [R8 — calc 2.7.0]

### 13.1 New golden fixture M

`fixtures/financial-model/m-wales-jurisdiction.json` — the corpus's first
**non-English** fixture: an all-cash Welsh acquisition on LTT, jurisdiction
`confirmed`, acquisition date 17 Aug 2026, consideration £753,482 (the audited
York case's price, so the three regimes' figures are directly comparable).

Every expected value was derived by hand from the specification *before* the
engine was run, and every one matched on the first execution. The tax figure is
the load-bearing pin:

```
LTT non-residential, bands in force from 22 Dec 2020, slice basis:
  0%  on the first £225,000                    =        0p
  1%  on £225,000..£250,000  (£25,000)          =   25,000p
  5%  on £250,000..£753,482  (£503,482)         =   2,517,410p
                                          total = 2,542,410p
```

Cross-checked against the same consideration under the other two regimes:

| Regime | Consideration £753,482 | Difference vs LTT |
|---|---|---|
| SDLT (England/NI) | 2,717,410p | +175,000p |
| LBTT (Scotland) | 2,617,410p | +75,000p |
| LTT (Wales) | **2,542,410p** | — |

Registered in both rosters (`EXPECTED_FIXTURE_STEMS` in
`tests/test_financial_model_fixtures.py` and `golden-fixtures.test.ts`).

### 13.2 Why fixture M is excluded from the pre-R8 migration loop

Both engines run every fixture through a "reduce to its pre-R8 (v3/v4) form and
re-migrate" loop, asserting the pins still reproduce. That property is **only
well-defined for an England/NI fixture**: the migration stamps `england_ni` by
definition, because that is what every legacy document implicitly was. Stripping
the R8 fields from a Welsh fixture does not recover an older document — it
produces a *different, English* appraisal.

So the loop is filtered to the England/NI fixtures, and the exclusion is made
explicit rather than silent, in three parts:

1. A roster guard asserts the split is exhaustive and that exactly one fixture is
   non-English. Deleting or mistyping a `jurisdiction` field fails here instead of
   quietly shrinking coverage.
2. The excluded fixture gets a **stronger** assertion: its pre-R8 form must produce
   precisely the England/NI figure (2,717,410p, SDLT) while the fixture itself
   produces the Welsh one (2,542,410p, LTT). A table edit, or a call site that
   quietly reverted to SDLT, fails here rather than passing because two regimes
   happened to agree.
3. The 175,000p difference is asserted to reach `acquisition_cost_pence` **and**
   `total_development_cost_pence`, not to stop at the metrics object — this pins
   the two-call-site defect found mid-release (see the R8 implementation report).

### 13.3 Rendered-output check

The gate and the rendered page catch different defects (R7's lesson), so all three
regimes plus an unconfirmed case were rendered and read, not merely asserted. See
§5 of `docs/reviews/2026-08-17-release-8-implementation-report.md` for what was
seen.
