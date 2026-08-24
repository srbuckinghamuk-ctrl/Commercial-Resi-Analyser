# Financial Model — Test Cases

**Status:** Authoritative test-case register for calculation specification `2.10.0` (see
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

**R14 update (C1, spec §5.10 rewritten).** Fixture B's facility rolls up interest with a
real reserve — `committed_gross_facility_pence` 55,000,000 against
`committed_net_facility_pence` 50,000,000, a 5,000,000p reserve. R14 credits the reserve's
unconsumed part (5,000,000 − cumulative `interest_capitalised_pence` through `m − 1`, which
equals cumulative `interest_accrued_pence` since every month here is rolled-up: 310,000 /
623,100 / 989,331 / 1,359,224) to remaining funding. Remaining cost is untouched.

| label `m` | remaining cost | undrawn net at m−1 | reserve headroom at m−1 | uncontributed cash equity at m−1 | remaining funding | surplus |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 26,049,224 | 19,000,000 | 4,690,000 | 20,000,000 | 43,690,000 | 17,640,776 |
| 2 | 10,736,124 | 19,000,000 | 4,376,900 | 5,000,000 | 28,376,900 | 17,640,776 |
| 3 | 369,893 | 14,000,000 | 4,010,669 | 0 | 18,010,669 | 17,640,776 |
| 4 | 0 | 14,000,000 | 3,640,776 | 0 | 17,640,776 | 17,640,776 |

Worked example (`m = 1`): remaining cost = uses[1..3] (15,000,000 + 10,000,000 + 0) +
interest[1..3] (313,100 + 366,231 + 369,893) + capFees[1..3] (0) = 26,049,224. Reserve headroom
= 5,000,000 − 310,000 (interest capitalised at ledger month 0) = 4,690,000. Remaining funding =
undrawn at ledger month 0 (19,000,000) + reserve headroom (4,690,000) + (30,000,000 committed
equity − 10,000,000 contributed through month 0) = 43,690,000. Surplus = 17,640,776 > 0. Fully
funded throughout: `first_shortfall_month = null`, `max_shortfall_pence = 0` — unchanged by the
reserve credit, since this fixture was never in shortfall (unlike Fixture P, spec §1.1's phantom
case, and Fixture H, whose real shortfall shrinks but does not close).

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

  **R14 note (C1).** `cost-to-complete.test.ts`/`test_financial_model_cost_to_complete.py`'s own
  copy of Fixture E (this file's "shortfall direction" describe block, not
  `monthly-engine.test.ts`'s original) additionally sets `committed_gross_facility_pence =
  40,000,000` — TERMS' own 5,000,000 reserve preserved at the lower net facility — where it had
  previously left gross at TERMS' 55,000,000. Left unchanged, the gap between that unmodified
  55,000,000 gross and the lowered 35,000,000 net is 20,000,000 — four times TERMS' real reserve
  and far more than this schedule's total interest — so crediting it (this task) would swallow the
  whole shortfall and the fixture would stop demonstrating "gap ⇒ shortfall" at all. With the
  reserve kept proportionate, the real shortfall survives (`funding_gap_pence = 5,700,000`
  unaffected, since gross only throttles draws below what net already throttles here):
  `first_shortfall_month = 1`, `max_shortfall_pence = 2,032,973`.

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

**R14 update (C1, spec §5.10 rewritten).** This facility rolls up interest with a real
interest reserve — `committed_gross_facility_pence` 66,000,000 against
`committed_net_facility_pence` 60,000,000, a 6,000,000p reserve. R14 credits the
reserve's unconsumed part (6,000,000 − cumulative `interest_capitalised_pence` through
`m − 1`) to remaining funding, so every row below moves versus the pre-R14 table: the
"Reserve headroom at m−1" column is new, "Remaining funding" and "Surplus" both shift by
exactly that amount, and "Remaining cost" is untouched (§4 corrects only the funding
side).

| m | Remaining cost (Σ from k = m) | Undrawn net at m−1 | Reserve headroom at m−1 | Uncontributed cash equity at m−1 | Remaining funding | Surplus |
|--:|--:|--:|--:|--:|--:|--:|
| 1 | 70,577,854 | 30,800,000 | 5,805,333 | 20,811,600 | 57,416,933 | **−13,160,921** |
| 2 | 66,362,652 | 30,800,000 | 5,609,369 | 16,792,362 | 53,201,731 | −13,160,921 |
| 3 | 53,984,619 | 30,800,000 | 5,412,098 | 4,611,600 | 40,823,698 | −13,160,921 |
| 4 | 37,508,777 | 19,211,600 | 5,136,256 | 0 | 24,347,856 | −13,160,921 |
| 5 | 19,916,429 | 2,011,600 | 4,743,908 | 0 | 6,755,508 | −13,160,921 |
| 6 | 6,527,293 | 0 | 4,335,534 | 0 | 4,335,534 | −2,191,759 |
| 7 | 2,096,959 | 0 | 3,924,438 | 0 | 3,924,438 | 1,827,479 |
| 8 | 1,683,122 | 0 | 3,510,601 | 0 | 3,510,601 | 1,827,479 |
| 9 | 1,266,526 | 0 | 3,094,005 | 0 | 3,094,005 | 1,827,479 |
| 10 | 847,153 | 0 | 2,674,632 | 0 | 2,674,632 | 1,827,479 |
| 11 | 424,984 | 0 | 2,252,463 | 0 | 2,252,463 | 1,827,479 |
| 12 | 0 | 0 | 1,827,479 | 0 | 1,827,479 | 1,827,479 |

Reserve headroom at `m`: `6,000,000 − Σ interest_capitalised_pence` through ledger month
`m − 1` inclusive (the cumulative total up to and including label `m`'s own ledger month
`m − 1`, but not yet ledger month `m` itself — e.g. at `m = 1` only ledger month 0's
194,667 has capitalised, giving `6,000,000 − 194,667 = 5,805,333`; the cumulative total
across all 12 ledger months is 4,172,521, matching the fixture's total finance cost).

Telescoping check (spec §5.10): `remaining_cost(1) = remaining_cost(2) + (uses+interest at k=1)` →
`66,362,652 + 4,215,202 = 70,577,854` ✓; and `remaining_cost(1) = ` total cost ex-selling +
total interest + capitalised fees − month-0 spend = `108,788,400 + 4,172,521 + 1,200,000 −
(42,188,400 + 194,667 + 1,200,000) = 114,160,921 − 43,583,067 = 70,577,854` ✓.

→ `cost_to_complete_first_shortfall_month = **1**`,
`cost_to_complete_max_shortfall_pence = **13,160,921**` (the largest deficit, tied across
m = 1..5, all short by the same amount since the undrawn-facility-plus-reserve total and
remaining cost fall together in lockstep until the facility is exhausted). Consistent
with the ledger's own `funding_gap_pence > 0`, i.e. the one implication the suite asserts
("shortfall ⇒ funding gap", §2 above) holds here as a genuine positive case, not vacuously —
and it is still a genuine shortfall, not C1's phantom, because H's `funding_gap_pence` of
14,988,400 is a real, independently-computed ledger shortfall the reserve credit does not
touch.

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
| `cost_to_complete_max_shortfall_pence` | 13,160,921 | £131,609.21 |

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

---

## 14. Area bridge and ancillary [R9 — calc 2.8.0]

Three new golden fixtures, taking the shared corpus from 9 files to 12 (11 of
which carry their own `inputs`; fixture K names a `base_fixture` instead). All
three are `inputs_version: 6`. As with fixture M, **every expected value was
derived by hand from the specification before either engine was run**, and — as
recorded in the R9 Task 12 report — every one matched in both engines on the
first execution.

### 14.1 Fixture N — the full bridge on the derived basis

`fixtures/financial-model/n-area-bridge.json`. England/NI, all-cash, six units,
`areas.basis: 'bridge_derived'`. The geometry is Task 1's `FULL_BRIDGE`, so the
reconciliation is independently asserted in `areas.test.ts` / `test_areas.py` as
well as here.

```
proposed_gia        = 600 - 20 + 40                    = 620 m2
developed_gia       = 620 - 100 - 0                    = 520 m2
available_for_units = 520 - 62 - 18 - 14 - 6           = 420 m2
unit_nia            = 4x60 + 2x70                      = 380 m2
unallocated         = 420 - 380                        =  40 m2

nia_to_gia_pct          = 380/520 = 0.7307692... -> 73.08%
nia_to_proposed_gia_pct = 380/620 = 0.6129032... -> 61.29%
saleable_to_developed   = 380/520 (sell_all)     -> 73.08%
```

The load-bearing pin is the construction cost, because it is what makes the
basis switch (spec §15.3) observable:

```
base        = round(105,000p/m2 x 520 m2)  = 54,600,000p
contingency = round(54,600,000 x 10%)      =  5,460,000p
compliance  =                                        0p
                            construction   = 60,060,000p
```

`conversion_costs.total_construction_sqm` is deliberately **380**, not 520. A
regression that read the manual field would produce 43,890,000p — a
16,170,000p miss — rather than pass silently. The fixture pins
`area_bridge.manual_area_sqm: 380` alongside `area_bridge.developed_area_sqm: 520`
so both halves of the switch are visible in the same file.

The `unallocated_sqm: 40` is inside §15.6's 10%-of-developed-area warning
threshold (52 m2) and `nia_to_gia_pct: 73.08` is inside the 65–90% band, so the
fixture is a clean document, not one that ships with warnings.

**Why the fractional-area rounding is *not* pinned by this fixture.** §3.4 rounds
the construction base half-up, and that is pinned in both engines at the
`calculateTotalConstructionCost` / `calculate_total_construction_cost` level
including the odd-half case (`333 × 100.5 = 33,466.5 → 33,467`). What no fixture
could cheaply add is the *derived* area reaching that rounding site fractionally:
fixture N's rate is 105,000p/m2, and 105,000 × any plausible area fraction is an
integer, so exercising the rounding through the fixture would mean changing the
rate as well and re-deriving its entire cost stack. The property is instead
asserted at the seam where it lives —
`conversion-calc-engine.test.ts`'s "carries a FRACTIONAL bridge-derived area into
the half-up rounding site" and
`test_financial_model_schedule.py::test_carries_a_fractional_bridge_derived_area_into_the_half_up_rounding_site`,
which build a bridge whose `developed_gia_sqm` is 100.5 (entered nowhere as
100.5) and pin the resulting 33,467p.

### 14.2 Fixture O — ancillary value across a blended exit

`fixtures/financial-model/o-ancillary-value.json`. England/NI, all-cash, two
units, `route: 'blended'` with `u2` retained. Both units carry a balcony and a
parking space, so the ancillary split is exercised on **both** sides of the exit
— which is the whole point: a fixture where only the sold unit had ancillary
would pass against an engine that folded all ancillary into receipts.

```
gdv_internal  = 30,000,000 + 40,000,000                        = 70,000,000p
gdv_ancillary = (500,000 + 1,500,000) + (800,000 + 1,700,000)  =  4,500,000p
gdv           = 70,000,000 + 4,500,000                         = 74,500,000p

gross_sales (u1 only)   = 30,000,000 + 2,000,000               = 32,000,000p
unrealised (u2 only)    = 40,000,000 + 2,500,000               = 42,500,000p
```

`gross_sales_pence` reaches the harness through a new `FLAT_KEYS` mapper in both
engines (it is a schedule total, not a summary metric). Pinning it matters
because neither GDV nor receipts alone can prove the split: the two must differ
by exactly the retained unit's internal **plus** ancillary value.

The fixture also carries an `expected_scenarios` block — a new fixture facility
in both harnesses — pinning the appraisal produced by applying the document's own
`downside` scenario. That scenario is a **pure −10% GDV stress** (every other
lever is 0) so the stressed figures are hand-derivable in one step, each value
rounded half-up independently (spec §12.1 / §15.5):

```
u1: 30,000,000 -> 27,000,000   balcony 500,000 -> 450,000   parking 1,500,000 -> 1,350,000
u2: 40,000,000 -> 36,000,000   balcony 800,000 -> 720,000   parking 1,700,000 -> 1,530,000

stressed gdv_internal  = 63,000,000p
stressed gdv_ancillary =  4,050,000p
stressed gdv           = 67,050,000p
stressed gross_sales   = 27,000,000 + 1,800,000 = 28,800,000p
stressed unrealised    = 67,050,000 - 28,800,000 = 38,250,000p
```

`area_bridge.ancillary_balcony_terrace_sqm` (20 m2) and `ancillary_parking_spaces`
(2) are pinned identically in the base and the stressed run, which is the tested
form of "a price stress is not an area stress".

### 14.3 Fixture P — Scotland, levered

`fixtures/financial-model/p-scotland-levered.json`. This closes R8's own open
item: every non-English fixture was all-cash, so the jurisdiction-aware
tax → TDC → `peak_debt` interaction was unpinned.

The tax was read from `fixtures/tax/acquisition-tax-tables.json` — the normative
record — not recalled:

```
LBTT non-residential, bands in force from 25 Jan 2019, slice basis,
consideration 60,000,000p (GBP 600,000):
  0%  on the first GBP 150,000                    =         0p
  1%  on GBP 150,000..250,000  (GBP 100,000)      =   100,000p
  5%  on GBP 250,000..600,000  (GBP 350,000)      = 1,750,000p
                                          total   = 1,850,000p

SDLT on the same consideration:
  2%  on GBP 150,000..250,000                     =   200,000p
  5%  on GBP 250,000..600,000                     = 1,750,000p
                                          total   = 1,950,000p     (+100,000p)
```

The facility is a committed net of 70,000,000p inside a gross of 78,000,000p,
rolled-up at 8% (monthly rate 1/150 exactly), day-one advance 30,000,000p,
`equity_first` against 45,000,000p of committed cash equity, 12-month term. The
ledger was worked month by month by hand; the closing balance identity is the
cross-check that ties it:

```
draws          = 30,000,000 (m0) + 3,288,400 (m3) + 5,000,000 (m4)
               + 5,000,000 (m5) + 4,400,000 x 5 (m6..m10)   = 65,288,400p
arrangement fee (capitalised, m0)                           =  1,400,000p
rolled-up interest, m0..m11                                 =  3,913,416p
                                     peak debt (month 11)   = 70,601,816p
```

and `65,288,400 + 1,400,000 + 3,913,416 = 70,601,816` exactly, which is what
makes the interest total independently verifiable rather than merely asserted.
Finance costs are `3,913,416 + 1,400,000 + 780,000 (exit fee on the gross
facility) = 6,093,416p`; TDC is `112,848,400 + 6,093,416 = 118,941,816p`.

**Why peak debt is the point.** With `equity_first`, the extra 100,000p of SDLT
exhausts committed equity one month earlier, so month 3 draws 100,000p more and
that difference then compounds for nine months. The England/NI counterfactual
was worked through by hand in full:

| | Scotland (LBTT) | England/NI (SDLT) | Difference |
|---|---|---|---|
| Acquisition tax | 1,850,000p | 1,950,000p | +100,000p |
| Acquisition cost | 63,250,000p | 63,350,000p | +100,000p |
| Rolled-up interest | 3,913,416p | 3,919,577p | +6,161p |
| **Peak debt** | 70,601,816p | 70,707,977p | **+106,161p** |
| **TDC** | 118,941,816p | 119,047,977p | **+106,161p** |

That the TDC difference is 106,161p and **not** 100,000p is exactly the
interaction R8 left unpinned, and it is why the three deltas are pinned
separately in `jurisdiction_contrast` rather than asserted equal to one another.
An engine that computed the right tax but funded it wrongly would satisfy the
acquisition-cost assertion and fail the other two.

### 14.4 The jurisdiction-contrast harness, rewritten

R8's non-English assertion hard-coded fixture M's figures inside a loop over
every non-English fixture, with a `MAINTENANCE` note saying that adding a second
one meant rewriting it. Fixture P is that second one, so it was rewritten rather
than patched: each non-English fixture now carries its own hand-derived
`jurisdiction_contrast` block (the England/NI regime and tax figure, and the
acquisition-cost, TDC and peak-debt deltas), and the test reads it.

Two assertions now cover the property, in both engines:

1. **The England/NI twin** — the same document with `jurisdiction` switched,
   run over every non-English fixture at any inputs version. Pins the regime
   names, the English tax figure, and all three deltas.
2. **The pre-R8 form** — R8's original route, kept for the **v5** non-English
   fixtures because it additionally proves the migration stamps `england_ni` on a
   document that never said otherwise. Now driven off the same contrast block.

### 14.5 Version partitioning of the migration loops

The corpus now mixes v5 and v6 documents, and `migrate_inputs_to_v5` refuses a v6
one by design — producing a v5 document would mean dropping `areas` and every
unit's `ancillary` block, the exact silent downgrade that guard exists to
prevent. The loops were partitioned accordingly, and the partition is asserted,
not assumed:

- **migrated-to-v5** runs over the v5 fixtures only.
- **migrated-to-v6** is new and runs over the **whole** corpus — it covers both
  the upgrade path (v5 → v6) and the merge branch (v6 → v6). The merge branch is
  the one that matters for the new fixtures: it must carry `areas` and every
  unit's `ancillary` through untouched, and a merge that reset either to the
  zeroed default would move fixture N's construction cost by 16,170,000p and
  fixture O's GDV by 4,500,000p rather than pass.
- **pre-R8 form** runs over the England/NI **v5** fixtures. A v6 fixture has no
  pre-R8 form either: stamping it v3/v4 and migrating back up would leave the R9
  blocks zeroed — a different document, not an older one. A roster guard asserts
  the excluded set is exactly `{M, N, O, P}` and that each exclusion is justified
  by one of the two stated reasons.

### 14.6 The v6 numerical-identity gate

`test_v6_migration_moves_no_existing_figure` (and its `it.each` twin) is what
makes "purely additive" a tested claim rather than an assertion: every fixture is
run before and after migration to v6 and the whole `metrics`, `model` and
`schedule` objects must be identical, not merely close.

It carries two structural halves, because the numeric comparison alone cannot see
either:

- For a **pre-v6** document, the migration must write the manual basis with a
  zeroed bridge and zeroed ancillary — asserted **by value**, not against
  `DEFAULT_AREA_BRIDGE`, since comparing the migration's output to the constant it
  was built from could not catch that constant becoming non-zero.
- For an **already-v6** document, the mirror image: the blocks it carries must
  survive the merge untouched. Zeroing them there would be equally wrong and the
  numeric gate would not see it for fixture P, whose zeroed bridge on the manual
  basis computes the same figures either way.

A non-vacuity guard pins the corpus size at 11 in both languages.

### 14.7 The single-accessor guard tests

Spec §15.4, governance §9. Both guards are asserted to fire, not merely to be
present:

- **TypeScript** — two `no-restricted-syntax` selectors in
  `frontend/eslint.config.js`, run by `npm run lint --max-warnings 0`, so a
  violation fails the build.
- **Python** — `tests/test_accessor_guard.py`, an `ast` walk over every module
  under `app/`. Two of its tests assert the scan stays **silent** on the three
  shapes a substring search would wrongly flag (a doc comment naming the field,
  the module docstrings, and a field-name string literal passed to `err()`), and
  two more plant a real violation in a probe module, assert it is caught, and
  delete it in a `finally`.

### 14.8 Calendar-date validation (an R8 carry-forward)

R8 recorded, and did not fix, that acquisition-date validation was a shape-only
regex, so `2026-02-31` validated and was then reported as
`date_basis: 'transaction_date'`. Both engines now perform a real calendar check
(`datetime.date(y, m, d)` in Python; a UTC `Date` round-trip preserving all three
components in TypeScript, with the year-0–99 and `MINYEAR` edges handled so the
two accept exactly the same set of strings).

Both halves are asserted, in both engines: `2026-02-31`, `2026-13-01`,
`2026-00-15`, `2026-01-00`, `2026-04-31` and `2027-02-29` are rejected, and
`2028-02-29` — a real leap day — is accepted with no issue on the field at all.
The second half is what stops a check that rejected every February date from
passing.

Band selection remains lexicographic, so a calendar-invalid date still resolves
to a band set; what has changed is that the document no longer validates, so the
report is gated.

### 14.9 A new cost-to-complete counter-example, recorded not tuned away

Fixture P made the corpus-wide cost-to-complete assertion ("a shortfall implies
the ledger recorded a funding gap somewhere") fail, and the failure is a genuine
finding about §5.10 rather than a defect in the fixture.

§5.10's remaining-funding term counts the undrawn **net** facility, while its
remaining-cost term counts future rolled-up interest — but rolled-up interest
never consumes the net facility; it capitalises against the **gross** facility's
headroom. Fixture P is the first fixture in the corpus to structure its facility
the way a real one is structured (net sized to the costs, interest reserve carved
out of the gross), so it reports a 392,483p shortfall at `m = 1` against a ledger
whose `funding_gap_pence` is 0. Fixture F did not surface this only because its
net facility carries roughly 16,000,000p of slack.

The fixture was **not** widened until the metric agreed. Instead both engines'
corpus tests now name `p-scotland-levered` as a counter-example and **assert**
its shape (a shortfall present, a funding gap of zero), so it cannot drift off
the list in silence, and both tests assert they still saw a positive case as well
— the implication is not allowed to become vacuous. Spec §5.10 records the
counter-example and defers the correction to its own release, tracked as **C1** in
`docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` and owned by R14.

The defect's figures are **pinned, not merely documented**: fixture P carries
`cost_to_complete_first_shortfall_month: 1` and
`cost_to_complete_max_shortfall_pence: 392483`, both reached through `FLAT_KEYS`
mappers and both negative-controlled in each engine. A documented number with no
assertion behind it drifts silently; whoever picks up C1 needs a figure that fails
the moment the behaviour changes, which is what makes the deferral
self-policing rather than something someone has to remember to re-check.

**Closed in R14 (calc 2.13.0).** The paragraphs above are kept as the record of
how the defect was found and held; they describe the position from R9 to R14 and
no longer describe the engine. Spec §5.10 now credits a rolled-up facility's
unconsumed interest reserve to remaining funding, fixture P pins `null` / `0`
with `1` / `392483` as its negative controls, and the exclusion list this section
put `p-scotland-levered` on is empty. See §20 below, and §20.5 for what replaced
the exclusion-list machinery.

---

## 16. Cost plan modes [R10 — calc 2.9.0]

Spec §16. `frontend/src/lib/model/cost-plan.test.ts` / `tests/test_cost_plan.py`
(the engine, Tasks 3/4), `schedule.test.ts` / `tests/test_financial_model_schedule.py`
(wiring, Task 7), `apply-scenario.test.ts` / `tests/test_financial_model_apply_scenario.py`
(the cost lever, Task 8), `validation.test.ts` / `tests/test_financial_model_validation.py`
(Task 10), and golden fixture Q (`fixtures/financial-model/q-detailed-cost-plan.json`, Task
11) — all pinned in both engines unless stated otherwise.

### 16.1 Contingency sums three rounded figures, never rounds the sum (Task 3)

Base build chosen so each 5% class lands on an exact half-penny: `1,000,010 ×
5% = 50,000.5`, half-up `50,001`. Three classes at 5% each therefore pin
`contingency.map(amount_pence) == [50_001, 50_001, 50_001]` and
`contingency_total_pence == 150_003` — **not** `150_002`, which is what one
class at the blended 15% would give (`1,000,010 × 15% = 150,001.5`, half-up
`150,002`). The 1p gap between the two is real and exactly representable, so
this test fails outright — not by a rounding tolerance — the moment the three
classes are ever collapsed into one rounding.

A second case pins `selected_packages` resolving against only its named
subset: two packages of 1,000,000 and 2,000,000; `existing_building` at 20% of
the second package alone gives `base_pence 2,000,000`, `amount_pence 400,000`;
`general` at 10% of the whole 3,000,000 base build gives `300,000`;
`contingency_total_pence 700,000`. A regression that resolved
`existing_building` against the whole base build instead of its named subset
would move its amount from 400,000 to 600,000 — a discriminator large enough
that no rounding could mask it.

### 16.2 Fee base isolation — a base cannot include another fee (Task 3)

Base build 2,000,000; 10% general contingency 200,000; detailed mode
(compliance 0) gives `construction_total_pence 2,200,000`. An architect fee at
6% of `pct_of_construction_total` resolves to `base_pence 2,200,000`,
`amount_pence 132,000` — pinned **alongside** a large fixed fee of 9,000,000,
so that a defect which folded fees into a percentage fee's base would produce
672,000 instead of 132,000 (`professional_total_pence` pinned at 9,132,000, not
9,672,000). A companion case pins the other basis on the same document:
`pct_of_base_build` resolves against 2,000,000 (excluding the 200,000
contingency), giving `amount_pence 120,000` against the other basis's 132,000
on the identical inputs — the two bases are proven to differ by construction,
not merely asserted to.

A third case pins the per-dwelling multiplication and the professional/
statutory split together: a `prior_approval` fee at 9,600 fixed/`per_dwelling`
over 4 units gives `statutory_total_pence 38,400`, alongside a fixed architect
fee of 1,500,000 giving `professional_total_pence 1,500,000` on the same
document — proving the per-dwelling multiplication and the category split are
independent, not coupled.

### 16.3 The pre-v7 fallback derives from legacy fields, never `DEFAULT_COST_PLAN` (Task 3)

A v6 document with `contingency_pct: 15` (not the 10% default),
`architect_pence: 1,500,000` and `building_control_pence: 200,000` (every
other fee field zeroed so the totals below mention only what the test sets)
run through `computeCostPlan` directly (no `cost_plan` block present) pins
`base_build_pence 4,000,000`, `contingency[0].pct 15`,
`contingency_total_pence 600,000`, `professional_total_pence 1,500,000`,
`statutory_total_pence 200,000`. `DEFAULT_COST_PLAN` has no fee lines and a
hardcoded 10% contingency, so the wrong fallback would report
`contingency_total_pence 400,000` (10% not 15%) and zero professional/statutory
totals — both visibly wrong against these literals, which is why the 15%/
1,500,000/200,000 figures were chosen rather than values that could coincide
with the wrong fallback's output.

### 16.4 Statutory month-0 timing survives the move to fee lines (Task 7)

Four dwellings, `prior_approval_fee_per_dwelling_pence 9,600`, `cil_s106_pence
700,000`, `building_control_pence 200,000`, cost plan rebuilt via
`costPlanFromLegacyCosts` so the schedule reads fee lines rather than the flat
fields. Pins `uses[0].statutory_pence 38,400` (4 × 9,600, month 0 only),
`totals.statutory_pence 938,400`, and — so that "month 0 only" cannot pass
vacuously on a document whose spread half happens to be zero —
`uses.slice(1)` summing to `900,000` (the CIL/S106 and building-control total,
confirmed non-zero after month 0). The rule is keyed on `code:
'prior_approval'`, not a hard-coded field name, so it survives the move from
three flat fields to fee lines unchanged.

### 16.5 The schedule follows `cost_plan`, not legacy fields, when they disagree (Task 7 fix round 1, I1)

Every other schedule-level test either uses a v6 document (where the fallback
derives `cost_plan` from the same fields the schedule would otherwise read, so
the two paths necessarily agree) or rebuilds `cost_plan` from
`conversion_costs` directly (same again) — none of those could catch a revert
to reading `conversion_costs` in the schedule. This case sets the legacy
fields to values that would give `construction_pence` ≈ 750,174,250,
`professional_pence` ≈ 45,000,000, `statutory_pence` ≈ 21,999,996 if the
schedule ever read them, on a document whose `cost_plan` is deliberately
different: one detailed-mode package of 10,000,000 with 10% general
contingency, an architect fee of 2,000,000, a per-dwelling prior-approval fee
of 5,000 over 4 units, and a CIL/S106 fee of 300,000. Pins
`totals.construction_pence 11,000,000`, `totals.professional_pence 2,000,000`,
`totals.statutory_pence 320,000` — each of the three totals has its own
assertion, so a construction-only, professional-only or statutory-only revert
is each independently caught, not only a combined figure a partial regression
could dodge. The guard was watched failing before being trusted: with the
pre-fix code reading `conversion_costs` directly, the construction assertion
reported `750174250` where `11000000` was expected.

### 16.6 The cost lever: headline and detailed modes respond identically to a stress (Task 8)

**At rest**, a headline document (rate × area) and a detailed document (two
packages summing to the same base build) both report
`construction_cost_pence 4,400,000` — the release's principal hazard closed:
without the package-scaling wiring, a detailed-mode document is immune to
every scenario, tornado bar and sensitivity cell while still rendering them.
**Under a ±10% cost stress**, both modes move to `3,960,000` (−10%) and
`4,840,000` (+10%) — pinned as absolute literals, both of which differ from
the 4,400,000 at-rest figure, so the pair is genuinely falsifiable rather than
merely self-consistent. The detailed-mode pair uses **two** packages (not
one), so a regression that scaled only the first package (leaving the second
at 3,700,000 unscaled) fails distinguishably at `4,070,000 ≠ 3,960,000`.

**Compliance and fixed fees must not double-apply the stress**, and this is
pinned separately because the cross-mode pair above deliberately carries zero
compliance and no fee lines (they would diverge by mode, which is not what
that pair tests). At rest: base build 4,000,000 + 10% contingency 400,000 +
500,000 compliance = `construction_total_pence 4,900,000`, and a 5%
percentage fee on that base gives `amount_pence 245,000`. Under a −10% cost
stress: base build scales to 3,600,000, contingency to 360,000, **compliance
stays 500,000 (unscaled)** — `construction_total_pence 4,460,000`, and the
percentage fee, moving only because its base moved, resolves to `223,000`. A
regression that applied the stress to the fee a second time would give `245,000
× 0.9 = 220,500` — a deterministic 2,500p gap the test asserts against
explicitly (`amount_pence 223,000` **and** `!= 220,500`), not merely a
different-looking number.

### 16.7 Validation — 15 hard errors and 2 warnings, each present-and-absent (Task 10)

Every rule in spec §16.5 carries a document that trips it and a document that
does not, differing in exactly the field under test, asserted in both engines:
the mode/package mutual exclusion (3 forms — headline-with-packages,
detailed-empty, detailed-summing-to-zero), negative amounts/percentages,
duplicate package or fee-line ids, a `selected_packages` class naming an
unknown or empty `package_ids` set, not-exactly-three or a repeated
contingency class name, a detailed-mode document carrying any of the three
non-zero compliance fields (fire safety, sound insulation, Part L — each with
its own dedicated test after a fix round found only one of the three was
originally covered, the exact "guard nobody has watched fail" pattern), a
fixed fee line with non-zero `pct` or a percentage fee line with non-zero
`amount_pence`, `per_dwelling` on a percentage basis, and a fee `code`/
`category` mismatch against the §16.4 table. The two warnings (contingency
over 50% of base build; a percentage fee resolving against a zero base) reuse
`computeCostPlan` rather than re-deriving the base-build arithmetic, so
validation and the engine cannot disagree about what a document's base
actually is.

### 16.8 Golden fixture Q — detailed cost plan, three contingency classes, levered facility (Task 11)

`fixtures/financial-model/q-detailed-cost-plan.json` — the corpus's first
v7-tagged fixture, and the first to exercise a genuine multi-package detailed
cost plan through the full monthly ledger. Five packages across five codes
(base build 47,000,000p); all three contingency classes non-zero and on
**different** bases — `general` 5% of `all_packages` (2,350,000p),
`existing_building` 15% of a named two-package subset (base 23,000,000p,
amount 3,450,000p), `abnormal` 8% of a named one-package subset (base
3,000,000p, amount 240,000p) — contingency total 6,040,000p,
`construction_total_pence 53,040,000`. Two fee lines are percentage-based on
different bases (architect 6% of `pct_of_base_build`, planning consultant
1.5% of `pct_of_construction_total`) alongside six fixed lines —
`professional_total_pence 5,015,600`, `statutory_total_pence 448,000`. Task
13 adds `cost_plan.conversion_total_pence 58,503,600` (construction +
professional + statutory, CARRIED-2).

Every cost-stack figure is **hand-derived independently of both engines**
before either ran (worksheet in `task-11-report.md`), and matched both
engines to the penny on the first run — no fixture tuning was needed. The
finance-dependent figures downstream of the cost stack (finance costs, peak
debt, TDC and its ratios) are not hand-replayed against the rolled-up monthly
ledger; they are instead constrained by cross-engine agreement to the penny,
`sources_equal_uses`, and the corpus-wide TDC-identity invariant, and the
fixture's own note states explicitly which figures belong to which list, so a
reader cannot mistake an invariant-checked figure for a hand-derived one.
Fixture Q deliberately exercises no rounding boundary (every product in it is
an exact whole-pence figure) — that discriminator is pinned separately by
§16.1's `cost-plan.test.ts` case, not duplicated here.

## 17. VAT and TOGC [R11 — calc 2.10.0]

### 17.1 Golden fixture R — the pinned return cycle, plus a levered facility and chargeable purchase VAT

`fixtures/financial-model/r-vat-quarterly.json` — the first v8-tagged
fixture, and the one that pins §17.4's worked return cycle against a real
document rather than the isolated illustrative table. `programme.packages.
construction` is explicit (`start_offset 1, duration_months 4, straight_line`,
Ruling R16), so `uses[].construction_pence` spreads evenly across months 1–4
at 25,000,000p/month — asserted first, before trusting any VAT figure built
on top of it (`golden-fixtures.test.ts`'s `uses_construction_pence` mapper).

Quarterly returns, `first_period_end_month 2`, `repayment_lag_months 1`; only
`acquisition` and `construction` carry a non-zero rate (20%, 100%
recoverable, `zero_rated_sale`), so the fixture's month-by-month carry is
hand-derivable as two additive streams (`vat_months_incurred_pence`,
`vat_months_reclaimed_pence`, `vat_months_carry_pence`, each a flat
month-indexed array rather than a dotted path into `metrics.vat.months`).
Purchase VAT (vendor opted to tax, TOGC does not apply) lands in month 0,
inside period 1's window alongside construction's first two months, giving
peak carry £200,000 at month 2 — not the isolated table's £100,000, the
difference being exactly the acquisition VAT (§17.4). `total_irrecoverable_
pence` is `0` by construction (both configured categories are 100%
recoverable), which is what lets fixture R also serve as one of the two
documents the §17.5 invariant is proven against. The acquisition-tax uplift
(§17.7) is pinned alongside it: SDLT on the VAT-exclusive £500,000 would be
£14,500 against £19,500 on the VAT-inclusive £600,000, an uplift of exactly
£5,000 (5% of the £100,000 acquisition VAT, both considerations sitting in
the same top band).

A quarterly-return, 7-month-term document with a non-zero rate necessarily
produces a final return period (month 6 alone) whose reclaim falls outside
the modelled term, so validation reports the expected `vat.repayment_lag_
months` warning (§17.9) for this document — present by design, not a defect,
and does not affect `report_safe`.

Every cost-stack and VAT figure is hand-derived independently of both engines
before either ran (worksheet in `task-11-report.md`); finance-dependent
figures downstream of it (finance costs, `vat_carry_interest_pence`, peak
debt, TDC and its two profit ratios) are invariant-cross-checked rather than
hand-replayed, per fixture Q's precedent, and the fixture's own note states
explicitly which list each figure belongs to.

### 17.2 The profit-neutral invariant (spec §17.5)

`metrics.test.ts`, `'fully recoverable VAT moves no cost line, and moves
profit only by carry interest'` — the release's primary guard, proven in
both directions: a document with every category at 20% and 100% recoverable
produces `construction_cost_pence`/`professional_fees_pence`/`statutory_
costs_pence`/`selling_costs_pence`/`cost_plan` byte-identical to its
`registered: false` twin, `irrecoverable_vat_pence` exactly `0`, and
`profit_pence` differing only by the change in `finance_costs_pence`. The
Python twin runs the same comparison over the same fixtures.

### 17.3 The ledger — advance ineligibility, the funding gap, and reclaim redemption (`monthly-engine.test.ts`)

- `'funds the build but never advances against the VAT'` and `'raises vat_
  funding_gap when neither equity nor headroom can fund the VAT'` — the
  eligible base for the development-cost advance stays `construction +
  professional + statutory` (§17.6); the guard is **watched fail** by adding
  `vat_pence` to that base and confirming the assertion breaks (§16 "Guards
  this release must watch fail").
- `'funds the VAT from equity where equity is available'`, `'discloses the
  gross VAT cycle on the ledger totals'`.
- `'applies a reclaim wholly to senior debt, ignoring sales_sweep_pct'`,
  `'applies the reclaim before the sale, reducing the balance the sale must
  clear'`.
- `'charges the exit fee exactly once when a reclaim clears the balance'` and
  `'captures the redemption balance AFTER the reclaim when both land in one
  month'` — a full reclaim redeems on exactly the same terms as any other
  redemption; the fee total is asserted equal to the same document's fee when
  the sale redeems instead.
- `'does not redeem on a partial reclaim'`, `'withholds discharge when a
  reclaim lands in the [balance, balance + fee) band'`, `'distributes the
  whole reclaim and repays nothing when the fee exceeds the balance'`.
- `'distributes a reclaim to equity on a cash deal'`.
- `'keeps sources equal to uses to the penny with VAT live'` — §7's identity,
  with the VAT reclaim as the third excluded flow.

### 17.4 Validation (spec §17.9) — 22 hard-error cases and 10 warning cases (`validation.test.ts`, `describe('R11 — VAT validation ...')` / `describe('R11 — VAT warnings ...')`)

Each hard-error rule is tested per field it governs rather than once per
rule — R10 twice specified a rule for three fields and shipped a test named
for one (§17.9's own note). Included: `vat_override` on a package or fee
line under headline mode; out-of-range `rate_pct`/`recoverable_pct` on a
treatment row and on an override, checked at both bounds; a `treatments`
array that is not exactly the six categories once each in order; the
return-cycle bounds (`first_period_end_month`, `repayment_lag_months`)
gated on `registered: true` (R38) and absent on a pre-v8 document with no
`vat` block at all; `togc_treatment: 'applies'` with a non-zero acquisition
rate; and the unregistered-buyer collision of §17.7 (`registered: false`
while purchase VAT is chargeable), asserted to name the correct modelling
in its message. Warnings cover the zero-rated-sale-with-retained-unit case,
`togc_treatment: 'applies'` with `vendor_opted_to_tax: false`, `registered:
false` with non-zero construction cost, and `'warns when the final VAT
return period reclaim falls outside the modelled term'`.

### 17.5 The migration regression gate (R38, R39) — `golden-fixtures.test.ts` and `test_migrate_v8.py`

`'migrating %s to v8 adds and removes no validation issue'` runs the whole
corpus plus synthetic `term_months: 1` and `term_months: 2` documents through
`validateInputs` before and after migration: the error set compared with no
exemption, nothing removed at either severity, and the only permitted
addition a warning on `vat.registered` cross-checked per fixture against its
own firing condition with a non-vacuity assertion. Both term cases are
required — the ungated rule this gate replaced bit at both, so a term-1-only
case would have left half the regression unguarded. The Python mirror is
`test_v8_migration_adds_and_removes_no_validation_issue` and
`test_v8_migration_adds_no_validation_issue_to_a_short_term_document`
(parametrised over `term_months in (1, 2)`). Numeric identity is the separate
gate `'migrating %s to v8 moves no computed figure, and writes the specified
block'` / `test_v8_migration_moves_no_existing_figure`, asserting the
structural write (`registered: false`, six rows, every override `null`) as
well as the figures.

### 17.6 The spider's counterfactual counts only evidenced rates (R43) — `deal-spider.test.ts`, `describe('tax advantage axis')`

`"takes its VAT component from the model, not from a 15% assumption"` and
`'moves when only the VAT treatment changes, holding construction cost and
SDLT fixed'` replace the pre-R11 hard-coded `construction_cost_pence × 0.15`.
`describe("the UNCONFIRMED VAT caveat fires on any unconfirmed line, not
vatBasisGate's materiality test")` is the absolute assertion §17.10 requires:
a document with only `construction` configured produces exactly the
construction-derived figure, with no contribution from the five untouched
categories — a direction-only test cannot see a constant baked into both
sides of a comparison. `'marks the VAT component "not modelled" rather than
a silent zero when the document is not VAT-registered'` and `'captures SDLT
saving + CIL offset as % of GDV when VAT is not registered (inert, so its
component is a true zero...)'` cover the `registered: false` case.

### 17.7 The LTC caveat on the summary page, not only the memo (Ruling R45) — `AppraisalSummaryPage.test.tsx`

`'does NOT carry the VAT caveat on Net/Gross LTC when there is no
irrecoverable VAT'` and `'puts the VAT caveat, reading the irrecoverable
figure from run.metrics, on BOTH the Net LTC and Gross LTC tooltips'` — the
Net LTC/Gross LTC tooltips read `metrics.vat.total_irrecoverable_pence`
directly (never recompute it) and carry the caveat only when it is non-zero,
mirroring `export-investment-memo.ts`'s existing memo section but on the
page a user actually looks at.

### 17.8 The single-accessor guard (spec §17.2) — `accessor-guard.test.ts`, `test_accessor_guard.py`

`resolveVatTreatment`'s inputs (`vat.treatments`, every `vat_override`) and
`chargeableConsiderationPence`'s six former call sites are covered by the
same real-linter mechanism §15.4 and §16.3 established: the guard test runs
ESLint's Node API and asserts `severity === 2`, not merely that a message
appears, and pins the allowlist's exact contents. Every real-linter test in
this file spawns a fresh ESLint instance and is therefore load-sensitive
under the full suite — see the file's own `REAL_LINTER_TIMEOUT_MS` comment.

## 20. Cost-to-complete corrected [R14 — calc 2.13.0]

Spec §4 rewrites §5.10's funding side to credit a rolled-up facility's
unconsumed interest reserve (`reserve_headroom`, §4's new
`remaining_interest_reserve_headroom_pence` column) rather than leaving
forecast interest an uncredited addition to remaining cost. Fixture P's old
phantom pins (`cost_to_complete_first_shortfall_month: 1`,
`cost_to_complete_max_shortfall_pence: 392483`) move to `null` / `0` (Task 1);
this section hand-derives the release's companion **positive** case — a
facility whose reserve is genuinely too small for the interest it must carry,
so the correction still reports a real, non-zero shortfall once the reserve
itself is exhausted.

### 20.1 Fixture V — exhausted interest reserve (`fixtures/financial-model/v-exhausted-reserve.json`)

**Purpose:** a hand-derivable rolled-up facility whose 200,000p interest
reserve is consumed within a few months of a 1%-per-month accrual, while the
gross facility (net 12,000,000p + reserve 200,000p = 12,200,000p, since
`committed_gross_facility_pence` is `null`) is also tight enough against the
net facility that the §4.2(c) gross-headroom draw cap binds before
construction finishes. The result is a **genuine** shortfall with a
**genuine**, non-zero `funding_gap_pence` — the corpus's positive case for
"shortfall ⇒ funding gap" (§2 above), not a counter-example: fixture V's gap
and its cost-to-complete shortfall are both real, unlike fixture P's now-closed
phantom.

**Inputs, verbatim from the task brief.** Headline cost mode, England/NI,
single-tranche sale at term (`route: 'sell_all'`, no `sales_phasing`), no
programme network (auto windows). Purchase price 10,000,000p; term 12 months;
construction 6,000,000p (100,000p/sqm × 60 sqm, `contingency_pct: 0`, no
compliance allowances); every professional/statutory fee field 0.
`funding_source: 'development_finance'`, `interest_type: 'rolled_up'`,
`annual_interest_rate_pct: 12` (1%/month), `committed_net_facility_pence:
12,000,000`, `interest_reserve_pence: 200,000`,
`committed_gross_facility_pence: null` (gross = 12,200,000),
`development_cost_advance_pct: 100`, `day_one_advance_pence: 6,000,000`, every
finance fee field 0. One confirmed cash equity source, 4,000,000p. GDV
30,000,000p from two units (15,000,000p each).

**Acquisition tax is 0p, by construction.** `calculateTotalAcquisitionCost`
prices every acquisition on the **non-residential** SDLT band set regardless
of the eventual use (`frontend/src/lib/conversion-calc-engine.ts`,
`basis: 'non_residential'`), and that band set's nil-rate threshold is
15,000,000p (`fixtures/tax/acquisition-tax-tables.json`, `SDLT`/`england_ni`/
`non_residential`, `up_to_pence: 15000000, rate_pct: 0`). The 10,000,000p
consideration falls entirely inside that band, so `sdlt = 0` and
`acquisition_cost_pence = 10,000,000 + 0 + 0 + 0 + 0 + 0 = 10,000,000` (every
other acquisition cost field is 0). This is deliberate — it keeps the
worksheet below to two cost lines (acquisition, construction) instead of
three.

**Auto-window construction spread (spec §6, calc 2.1.0 behaviour).** Term 12
→ `constructionWindow = max(1, 12 − 2) = 10` (ledger months 1..10),
`professionalWindow = ceil(10 / 2) = 5` (unused here — professional and
statutory totals are both 0). `spreadStraightLine(6,000,000, 10)`:
`per = round(6,000,000 / 10) = 600,000` exactly, and `6,000,000 =
600,000 × 10` leaves no residue for the final month to absorb — every one of
ledger months 1..10 carries exactly 600,000p of construction spend.

#### Step 1 — the ledger, hand-derived month by month

`grossFacility = 12,200,000`, `monthlyRate = 0.01`, and the gross-headroom
draw cap (spec §4.2(c)) is `floor(grossFacility / 1.01) − opening − capFees
= 12,079,207 − opening` throughout (no arrangement fee, so `capFees = 0`
every month; `12,200,000 / 1.01 = 12,079,207.920792…`, floor `12,079,207`).
`interest_capitalised_pence == interest_accrued_pence` at every month —
the whole facility is rolled up, so nothing is serviced.

Month 0: `draw = min(day_one_advance 6,000,000; undrawn net 12,000,000;
cashUses 10,000,000; headroomCap 12,079,207) = 6,000,000`. The remaining
4,000,000p of the 10,000,000p acquisition cost is funded whole from the
4,000,000p confirmed equity source — **exhausting it completely**: every
later month's `equity_contribution_pence` is 0, and `remainingCashEquity`
in the §5.10 series below is 0 for every `m ≥ 1`. `interest = round(6,000,000
× 0.01) = 60,000`. Closing balance `6,060,000`.

Months 1–8: construction due each month is 600,000p, equity is exhausted so
the whole 600,000p falls to the facility, and neither the net facility
(`undrawn` stays ≥ 1,200,000p throughout this stretch) nor the gross-headroom
cap binds yet (the smallest headroom in this stretch, month 8's, is
`12,079,207 − 10,868,543 = 1,210,664`, still comfortably above 600,000p) — so
every draw succeeds in full and `interest = round((opening + 600,000) ×
0.01)` compounds the balance forward exactly as a plain rolled-up facility
would.

| ledger month `k` | uses (acq./constr.) | draw | interest accrued = capitalised | closing balance | undrawn net (post-draw) | funding gap |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 10,000,000 | 6,000,000 | 60,000 | 6,060,000 | 6,000,000 | 0 |
| 1 | 600,000 | 600,000 | 66,600 | 6,726,600 | 5,400,000 | 0 |
| 2 | 600,000 | 600,000 | 73,266 | 7,399,866 | 4,800,000 | 0 |
| 3 | 600,000 | 600,000 | 79,999 | 8,079,865 | 4,200,000 | 0 |
| 4 | 600,000 | 600,000 | 86,799 | 8,766,664 | 3,600,000 | 0 |
| 5 | 600,000 | 600,000 | 93,667 | 9,460,331 | 3,000,000 | 0 |
| 6 | 600,000 | 600,000 | 100,603 | 10,160,934 | 2,400,000 | 0 |
| 7 | 600,000 | 600,000 | 107,609 | 10,868,543 | 1,800,000 | 0 |
| 8 | 600,000 | 600,000 | 114,685 | 11,583,228 | 1,200,000 | 0 |
| **9** | 600,000 | **495,979** | 120,792 | 12,199,999 | 704,021 | **104,021** |
| **10** | 600,000 | **0** | 122,000 | 12,321,999 | 704,021 | **600,000** |
| 11 | 0 | 0 | 123,220 | 12,445,219 | 704,021 | 0 |

Worked example, month 9 (the first month the gross-headroom cap binds):
`headroomCap = 12,079,207 − opening(11,583,228) = 495,979`, strictly less
than the 600,000p of construction due and less than the 1,200,000p of
undrawn net facility — so the cap, not the net facility, is what binds.
`draw = 495,979`; the un-financed remainder, 600,000 − 495,979 = **104,021**,
falls straight to `funding_gap_pence` (spec §4.2 step 3: cost overruns —
here, a draw the facility itself cannot advance — never create facility).
`interest = round((11,583,228 + 495,979) × 0.01) = round(12,079,207 × 0.01) =
120,792` — note `opening + draw` lands exactly on the cap's own
`floor(grossFacility / 1.01)`, by construction of the cap formula. Closing
balance `12,079,207 + 120,792 = 12,199,999` (1p under the 12,200,000p gross
facility, as the `floor` is designed to guarantee).

Month 10: `headroomCap = max(0, 12,079,207 − 12,199,999) = 0` — the facility
already sits above the point the cap would allow a fresh draw from, so
`draw = 0` and the **whole** 600,000p of construction due this month falls to
`funding_gap_pence`. Interest still accrues on the standing balance alone:
`interest = round(12,199,999 × 0.01) = 122,000`, closing balance
`12,321,999` — already 121,999p **above** the 12,200,000p gross facility,
because the cap constrains new draws only; it does not — and cannot — stop
interest already on the balance from compounting past the ceiling once no
further draw is available to keep the pre-interest balance under it. (This
also fires the ledger's own `facility_exceeded` flag at month 10 — expected,
not a defect: the flag and the cost-to-complete shortfall below are two
independent readings of the same exhausted facility.)

Month 11 (final month, no cost due, single-tranche sale of both units):
`interest = round(12,321,999 × 0.01) = 123,220`, closing balance (pre-sale)
`12,445,219` — the series' peak, since every earlier month's balance is
strictly smaller and the sale itself only reduces the balance, never raises
it.

**`funding_gap_pence = 104,021 + 600,000 = 704,021`** (months 9 and 10 only;
every other month's draw covers its cost in full). **`peak_debt_pence =
12,445,219`, `peak_debt_month = 11`** — the pre-sale balance calculated
above, since `runLedger` records `peakDebt` before that month's receipts are
applied and no earlier month's balance exceeds it.

#### Step 2 — the §5.10 series, `m = 1..12`

`reserve_headroom(m) = max(0, 200,000 − C(m−1))`, where `C(j)` is the
cumulative `interest_capitalised_pence` through ledger month `j` inclusive
(§4's `cum_interest_capitalised(L)`, `L = model.months[m−1]`) —
`C(0..11) = 60,000; 126,600; 199,866; 279,865; 366,664; 460,331; 560,934;
668,543; 783,228; 904,020; 1,026,020; 1,149,240`. The reserve is consumed
partway through ledger month 3: `C(2) = 199,866` is still under the
200,000p reserve, but `C(3) = 279,865` is over it, so `reserve_headroom(4)`
and every later month's is floored at 0. `remainingCashEquity(m) = 0` for
every `m ≥ 1` (the whole 4,000,000p equity source is contributed in ledger
month 0, per Step 1).

| `m` | Remaining cost (Σ from `k = m`) | Undrawn net at `m−1` | Reserve headroom at `m−1`→`m` | Remaining funding | Surplus |
|--:|--:|--:|--:|--:|--:|
| 1 | 7,089,240 | 6,000,000 | 140,000 | 6,140,000 | **−949,240** |
| 2 | 6,422,640 | 5,400,000 | 73,400 | 5,473,400 | **−949,240** |
| 3 | 5,749,374 | 4,800,000 | 134 | 4,800,134 | **−949,240** |
| 4 | 5,069,375 | 4,200,000 | 0 | 4,200,000 | −869,375 |
| 5 | 4,382,576 | 3,600,000 | 0 | 3,600,000 | −782,576 |
| 6 | 3,688,909 | 3,000,000 | 0 | 3,000,000 | −688,909 |
| 7 | 2,988,306 | 2,400,000 | 0 | 2,400,000 | −588,306 |
| 8 | 2,280,697 | 1,800,000 | 0 | 1,800,000 | −480,697 |
| 9 | 1,566,012 | 1,200,000 | 0 | 1,200,000 | −366,012 |
| 10 | 845,220 | 704,021 | 0 | 704,021 | −141,199 |
| 11 | 123,220 | 704,021 | 0 | 704,021 | 580,801 |
| 12 | 0 | 704,021 | 0 | 704,021 | 704,021 |

Worked example (`m = 1`, matching the brief's own formula exactly):
`remaining_cost(1)` = uses[1..11] (600,000 × 10) + interest[1..11]
(66,600+73,266+79,999+86,799+93,667+100,603+107,609+114,685+120,792+122,000+
123,220 = 1,089,240) = 6,000,000 + 1,089,240 = 7,089,240. Cross-checked via
the boundary identity: total cost ex-selling (10,000,000 + 6,000,000) + total
interest (1,149,240) − month-0 spend (10,000,000 + 60,000) = 17,149,240 −
10,060,000 = 7,089,240 ✓. `remaining_funding(1) = undrawn_net(0) +
(12,200,000 − 12,000,000 − interest_capitalised(0)) + (4,000,000 −
equity_contribution(0)) = 6,000,000 + (200,000 − 60,000) + (4,000,000 −
4,000,000) = 6,000,000 + 140,000 + 0 = 6,140,000`. Surplus `6,140,000 −
7,089,240 = −949,240`. Telescoping: `remaining_cost(1) = remaining_cost(2) +
(uses+interest at k=1) → 6,422,640 + 666,600 = 7,089,240` ✓.

→ **`cost_to_complete_first_shortfall_month = 1`**, **`cost_to_complete_
max_shortfall_pence = 949,240`** (tied across `m = 1..3` — while the reserve
still has headroom, the credited amount falls by exactly the same 600,000p
of construction draw plus interest that remaining cost picks up each month,
so the surplus does not move; once the reserve floors at 0 in month 4, the
gap between remaining cost and remaining funding starts closing as
construction spend tapers off, and it turns positive at `m = 11` once the
final month's near-zero remaining cost is reached). Consistent with the
ledger's own `funding_gap_pence = 704,021 > 0`: this is a genuine positive
case for "shortfall ⇒ funding gap", not vacuous, and not C1's phantom —
fixture V's gap comes from the gross-headroom cap actually binding, exactly
as pinned in Step 1.

#### Step 3 — the rejected correction (spec §11 guard 2, NOT committed)

Spec §4's decision was to credit `reserve_headroom` on the funding side,
leaving remaining cost untouched. The **rejected** alternative — drop
`interest_accrued_pence` from remaining cost instead, leaving the funding
side as `undrawn_net_facility(m−1) + remainingCashEquity(m−1)` only, with NO
reserve term — must report **no shortfall at any `m`** on this fixture, or
this fixture would not be evidence that decision 2 (not the rejected
alternative) is the one that keeps a genuine shortfall visible while closing
C1's phantom.

`remaining_cost'(m) = Σ_{k=m}^{11} uses_sum[k]` (no interest term).
`remaining_funding'(m) = undrawn_net(m−1) + 0` (no reserve credit, equity
still 0 throughout).

| `m` | Remaining cost′ | Remaining funding′ | Surplus′ |
|--:|--:|--:|--:|
| 1 | 6,000,000 | 6,000,000 | 0 |
| 2 | 5,400,000 | 5,400,000 | 0 |
| 3 | 4,800,000 | 4,800,000 | 0 |
| 4 | 4,200,000 | 4,200,000 | 0 |
| 5 | 3,600,000 | 3,600,000 | 0 |
| 6 | 3,000,000 | 3,000,000 | 0 |
| 7 | 2,400,000 | 2,400,000 | 0 |
| 8 | 1,800,000 | 1,800,000 | 0 |
| 9 | 1,200,000 | 1,200,000 | 0 |
| 10 | 600,000 | 704,021 | 104,021 |
| 11 | 0 | 704,021 | 704,021 |
| 12 | 0 | 704,021 | 704,021 |

Every surplus′ is `≥ 0` (exactly 0 for `m = 1..9`, since — absent interest on
either side — remaining cost′ is just the construction spend still to come
and remaining funding′ is exactly the undrawn net facility that was sized to
carry it before the gross-headroom cap started binding; strictly positive
from `m = 10` once the cap-constrained months fall out of the remaining-cost
window). **The rejected correction reports `first_shortfall_month = null`,
`max_shortfall_pence = 0` at every month on this fixture** — it would hide
the very shortfall decision 2 exists to show, which is why decision 2 (crediting
the reserve, not dropping interest) is the one spec §4 adopts. This table is
the worksheet-level record of why; `docs/superpowers/sdd/2026-08-23-r14-cost-
to-complete/task-2-report.md` records the one live-engine run that confirmed
it (temporarily edited, then reverted — not committed).

#### Pinned `expected_metrics`

| Metric | Value | £ |
|---|---:|---:|
| `gdv_pence` | 30,000,000 | £300,000 |
| `peak_debt_pence` | 12,445,219 | £124,452.19 |
| `funding_gap_pence` | 704,021 | £7,040.21 |
| `cost_to_complete_first_shortfall_month` | 1 | — |
| `cost_to_complete_max_shortfall_pence` | 949,240 | £9,492.40 |

**Governance note.** Every figure above was derived on this worksheet
*before* the fixture was run against either engine
(`docs/financial-model/model-governance.md`): the ledger from the §4 monthly
loop (Step 1), the §5.10 series from §4's own formula (Step 2), and the
rejected-correction comparison from the same formula with decision 2's credit
removed (Step 3). The engine was run only to confirm agreement, and did.

### 20.2 Fixtures Q and S under the wired cap

R14 spec §5 amends §4.2(b): the monthly development-cost advance cap's base
becomes `round(construction_pence × lender_eligible_ratio) + professional +
statutory`, where the ratio is the cost plan's
`lender_eligible_base_pence / base_build_pence` (1 in headline mode, and 1 when
`base_build_pence` is 0). Two fixtures in the corpus are not all-eligible —
**Q** (`q-detailed-cost-plan.json`, externals 3,000,000p of a 47,000,000p base
build, ratio `44/47`) and **S** (`s-dated-programme.json`, externals 6,000,000p
of 66,000,000p, ratio `10/11`) — and the spec requires that whether the smaller
cap binds be **shown**, not assumed.

**It binds in both.** Both fixtures set `development_cost_advance_pct: 100`,
which is exactly the condition under which the pre-R14 cap could *never* bite:
at 100% the cap equalled the month's whole development spend, so `min(remainder,
advance_cap, …)` was a tie between the first two terms and `remainder` (or, once
equity ran out and the facility ran low, `undrawn_net`) decided every draw.
Scaling the construction line by a ratio strictly below 1 drops the cap below
the spend in every month whose construction is met from the facility, and the
cap becomes the sole binding term. Ten of Q's pins and twelve of S's therefore
move; every headline-mode fixture and every all-eligible fixture is
bit-identical, which is confirmed by the corpus running green with only these
two fixtures edited.

Both worksheets below were derived from the spec's own arithmetic (§4.2
waterfall, §4.2(c) gross-headroom cap, §4.4 sweep clamp, §5 finance costs,
§5.10 cost-to-complete, §7 identity) and re-checked against a replay that
imports nothing from either engine. The replay's validation gate is that, run
with `ratio = 1`, it reproduces **every** pre-R14 pin of Q and of S to the
penny — it does — so its figures under `ratio < 1` are trustworthy for the same
reason. No figure below was obtained by running the engine and pasting its
output; the engines were run afterwards and agreed.

#### Fixture Q — the cap base derived by hand for the first time

Q's own note recorded its ledger pins as *invariant-cross-checked, not
hand-replayed* (R10 ruling). This is the first hand derivation of its cap base,
so the whole ledger is replayed, not just the changed months.

**Cost stack and spend profile** (unchanged by R14 — the cap governs what the
facility *advances*, never what the scheme *spends*). Term 12, no programme, so
spec §6's auto windows apply: `constructionWindow = max(1, 12 − 2) = 10` (ledger
months 1–10), `professionalWindow = ceil(10 / 2) = 5` (months 1–5).
`spreadStraightLine(53,040,000, 10)` = 5,304,000 per month exactly;
`spreadStraightLine(5,015,600, 5)` = 1,003,120 per month exactly; the
prior-approval fee (48,000) pins to month 0 and the remaining
`448,000 − 48,000 = 400,000` of statutory spreads at 80,000 per month over
months 1–5. VAT is inert (`registered: false`), so `uses[m].vat_pence` is 0
throughout. Month 0 carries acquisition 52,750,000 + statutory 48,000 =
52,798,000.

**Facility.** Net 80,000,000, gross 89,000,000, 8.0% p.a. rolled up
(`monthlyRate = 0.08 / 12`), arrangement fee 2% of net = 1,600,000 capitalised
at month 0, exit fee 1% of gross = 890,000, day-one advance 35,000,000,
committed cash equity 40,000,000 at month 0, `equity_first`. The §4.2(c)
gross-headroom cap is `floor(89,000,000 / (1 + 0.08/12)) − opening − capFees
= 88,410,596 − opening − capFees`; it never binds (the largest opening balance
is 74,503,882).

**The ratio.** `lender_eligible_base_pence / base_build_pence =
44,000,000 / 47,000,000 = 44/47 = 0.936170212765957…`, carried unrounded. The
one rounding is on the product: `round(5,304,000 × 44/47)`. Exactly,
`5,304,000 × 44 = 233,376,000` and `233,376,000 / 47 = 4,965,446.808…`, so the
rounded eligible construction line is **4,965,447** and the withheld slice is
`5,304,000 − 4,965,447 = 338,553` per full construction month.

| ledger month | uses | equity | remainder | advance cap (R14) | draw | binding term | interest | closing balance | funding gap |
|---:|---:|---:|---:|---:|---:|:--|---:|---:|---:|
| 0 | 52,798,000 | 17,798,000 | — | — | 35,000,000 | `day_one_advance` | 244,000 | 36,844,000 | 0 |
| 1 | 6,387,120 | 6,387,120 | 0 | 6,048,567 | 0 | equity covers it | 245,627 | 37,089,627 | 0 |
| 2 | 6,387,120 | 6,387,120 | 0 | 6,048,567 | 0 | equity covers it | 247,264 | 37,336,891 | 0 |
| 3 | 6,387,120 | 6,387,120 | 0 | 6,048,567 | 0 | equity covers it | 248,913 | 37,585,804 | 0 |
| 4 | 6,387,120 | 3,040,640 | 3,346,480 | 6,048,567 | 3,346,480 | **`remainder`** | 272,882 | 41,205,166 | 0 |
| **5** | 6,387,120 | 0 | 6,387,120 | **6,048,567** | 6,048,567 | **`advance_cap`** | 315,025 | 47,568,758 | **338,553** |
| **6** | 5,304,000 | 0 | 5,304,000 | **4,965,447** | 4,965,447 | **`advance_cap`** | 350,228 | 52,884,433 | **338,553** |
| **7** | 5,304,000 | 0 | 5,304,000 | **4,965,447** | 4,965,447 | **`advance_cap`** | 385,666 | 58,235,546 | **338,553** |
| **8** | 5,304,000 | 0 | 5,304,000 | **4,965,447** | 4,965,447 | **`advance_cap`** | 421,340 | 63,622,333 | **338,553** |
| **9** | 5,304,000 | 0 | 5,304,000 | **4,965,447** | 4,965,447 | **`advance_cap`** | 457,252 | 69,045,032 | **338,553** |
| **10** | 5,304,000 | 0 | 5,304,000 | **4,965,447** | 4,965,447 | **`advance_cap`** | 493,403 | 74,503,882 | **338,553** |
| 11 | 0 | 0 | 0 | 0 | 0 | — | 496,693 | 75,000,575 → 0 | 0 |

The month-5 cap is `round(5,304,000 × 44/47) + 1,003,120 + 80,000 =
4,965,447 + 1,083,120 = 6,048,567`; months 6–10 carry construction alone, so
their cap is the 4,965,447 by itself.

Equity of 40,000,000 pays 17,798,000 at month 0 and 6,387,120 in each of months
1–3, leaving 3,040,640 — which month 4 exhausts. Month 4 is therefore the last
month `remainder` binds (3,346,480 < 6,048,567); from month 5 the cap binds and
does so alone: `undrawn_net` never falls below 9,177,718 and the headroom cap
never below 13,906,714.

**Funding gap** = 6 × 338,553 = **2,031,318**. Cross-check: the six capped
months spend 6 × 5,304,000 = 31,824,000 of construction, and
`31,824,000 × 3/47 = 2,031,319.1`; the 1.1p difference is the six roundings,
each `…808 → …447` giving 338,553 rather than 338,553.19. The gap is the
ineligible externals share of exactly the construction the facility was asked to
fund, which is what an ineligible package means.

**Total interest** = 244,000 + 245,627 + 247,264 + 248,913 + 272,882 + 315,025 +
350,228 + 385,666 + 421,340 + 457,252 + 493,403 + 496,693 = **4,178,293**
(was 4,240,081). Peak debt is month 11's pre-receipt balance, **75,000,575**
(was 77,093,681) — 13,999,425 inside the 89,000,000 gross facility. Total draws
35,000,000 + 3,346,480 + 6,048,567 + 5 × 4,965,447 = **69,222,282**.

**Cost-to-complete is unchanged at `null` / `0`.** §5.10 counts the *undrawn
facility* as remaining funding, gross of the §4.2(b) cap, so it cannot see a
cap-driven gap. The tightest month is label 1: remaining cost 62,389,893 against
remaining funding 74,358,000, a surplus of 11,968,107. Fixture Q is therefore
the corpus's standing case of "a funding gap the cost-to-complete series does
not see" — the allowed direction; fixture V's "shortfall ⇒ funding gap" is
untouched by it, and `TestShortfallDirectionAgainstFundingGap` still holds.

#### Pinned `expected_metrics` moved on fixture Q

| Metric | Was | Now | Derivation |
|---|---:|---:|:--|
| `finance_costs_pence` | 6,730,081 | **6,668,293** | 4,178,293 interest + 1,600,000 arrangement + 890,000 exit |
| `total_development_cost_pence` | 121,083,681 | **121,021,893** | 114,353,600 cost-before-finance (unchanged) + 6,668,293 |
| `profit_pence` | 58,916,319 | **58,978,107** | 180,000,000 gross receipts − 121,021,893 |
| `profit_on_cost_pct` | 48.66 | **48.73** | round(58,978,107 / 121,021,893 × 10000)/100 |
| `profit_on_gdv_pct` | 32.73 | **32.77** | round(58,978,107 / 180,000,000 × 10000)/100 |
| `peak_debt_pence` | 77,093,681 | **75,000,575** | month 11 closing balance, pre-receipt (month unchanged at 11) |
| `gross_ltc_pct` | 63.67 | **61.97** | 75,000,575 / 121,021,893 |
| `net_ltc_pct` | 65.48 | **63.66** | net advances 70,822,282 (69,222,282 draws + 1,600,000 capitalised) / 111,253,600 cost-before-finance-ex-selling |
| `ltgdv_developer_pct` | 42.83 | **41.67** | 75,000,575 / 180,000,000 |
| `funding_gap_pence` | 0 | **2,031,318** | 6 × 338,553, above |

`equity_contributed_pence` (40,000,000), `peak_debt_month` (11),
`day_one_advance_pence` (35,000,000), both `cost_to_complete_*` figures and the
whole cost stack are **unchanged**.

#### The starved pair — the §5 guard fixture Q also serves

Spec §5's guard is a detailed-mode pair differing only in one package's
`lender_eligible` flag; Q is the ineligible twin and a flipped copy is the base.
The pair is run with equity starved to 1p on **both** sides, so the cap — not
the equity waterfall — decides every draw, and with
`development_cost_advance_pct: 50` on **both** sides.

The 50% is load-bearing, and this is why: at the fixture's own 100%, starving
the equity pushes the whole 58,455,600p of months 1–10 onto the facility, whose
undrawn net after month 0 is only 43,400,000. Both twins then exhaust the net
facility — the all-eligible twin at month 8, the ineligible twin at month 8 as
well — so both draw exactly **78,400,000** and both carry exactly
**32,853,599** of gap. The pair does not separate, and the guard would be
vacuous. Halving the advance rate keeps `advance_cap` strictly below both
`remainder` and `undrawn_net` in every one of months 1–10 for both twins.

At 50%, per month: the all-eligible twin's cap is
`round(6,387,120 × 50/100) = 3,193,560` (months 1–5) and
`round(5,304,000 × 50/100) = 2,652,000` (months 6–10); the ineligible twin's is
`round(6,048,567 × 50/100) = 3,024,284` and `round(4,965,447 × 50/100) =
2,482,724` — note both of the ineligible twin's halvings land on a half-penny
and round **up**, which is `money_round`/`Math.round`'s half-up rule.

| | all-eligible | ineligible (44/47) | difference |
|---|---:|---:|---:|
| draws | 35,000,000 + 5 × 3,193,560 + 5 × 2,652,000 = **64,227,800** | 35,000,000 + 5 × 3,024,284 + 5 × 2,482,724 = **62,535,040** | 1,692,760 |
| funding gap | 17,797,999 + 5 × 3,193,560 + 5 × 2,652,000 = **47,025,799** | 17,797,999 + 5 × 3,362,836 + 5 × 2,821,276 = **48,718,559** | 1,692,760 |

Both twins spend the same 58,455,600 over months 1–10 and both take the same
35,000,000 day-one advance against a 52,798,000 month-0 use (leaving
17,797,999 of month-0 gap once the 1p of equity is spent), so every pence the
cap withholds falls straight to the gap and the two differences are necessarily
equal. Pinned in `monthly-engine.test.ts` and `test_financial_model_engine.py`.

### 20.3 Fixture S under the wired cap

S's R12 note already carried a hand-replayed month-by-month ledger, so only the
changed arm is re-derived here; the unchanged months are quoted from it and the
replay reproduces them exactly.

**Spend profile** (from S's own §18.5 bucketing, unchanged): month 0 carries
acquisition 105,750,000 and nothing else; months 1–4 carry professional
2,000,000 each; months 1–3 carry statutory 200,000 each and months 4–5 carry
1,400,000 each; construction is 3,000,000 in each of months 6–7 (the
`strip_out`-tagged enabling package) and 10,550,000 in each of months 8–13.
VAT is inert.

**Facility.** Net 100,000,000, gross 110,000,000, 12.0% p.a. rolled up
(`monthlyRate` exactly 0.01), arrangement 2% of net = 2,000,000, exit 1% of
gross = 1,100,000, `day_one_advance_pence: 0`, committed cash equity
105,750,000 — exactly month 0's cash use, so equity buys the land and is gone.
The §4.2(c) cap is `floor(110,000,000 / 1.01) − opening = 108,910,891 −
opening`, never approached; `undrawn_net` never falls below 23,600,000.

**The ratio** is `60,000,000 / 66,000,000 = 10/11 = 0.90909…`.
`round(3,000,000 × 10/11) = round(2,727,272.72…) = 2,727,273` (272,727 withheld);
`round(10,550,000 × 10/11) = round(9,590,909.09…) = 9,590,909` (959,091
withheld).

Months 1–5 carry no construction, so their cap base — professional + statutory
in full — is identical before and after R14, and their draws and balances are
unchanged (2,020,000 → 4,262,200 → 6,526,822 → 8,814,090 → 12,336,231 →
13,873,593). From month 6 the scaled cap binds, alone, in every month:

| ledger month | construction | remainder | advance cap (R14) | draw | binding term | interest | closing balance | funding gap |
|---:|---:|---:|---:|---:|:--|---:|---:|---:|
| **6** | 3,000,000 | 3,000,000 | **2,727,273** | 2,727,273 | **`advance_cap`** | 166,009 | 16,766,875 | **272,727** |
| **7** | 3,000,000 | 3,000,000 | **2,727,273** | 2,727,273 | **`advance_cap`** | 194,941 | 19,689,089 | **272,727** |
| **8** | 10,550,000 | 10,550,000 | **9,590,909** | 9,590,909 | **`advance_cap`** | 292,800 | 29,572,798 | **959,091** |
| **9** | 10,550,000 | 10,550,000 | **9,590,909** | 9,590,909 | **`advance_cap`** | 391,637 | 39,555,344 | **959,091** |
| **10** | 10,550,000 | 10,550,000 | **9,590,909** | 9,590,909 | **`advance_cap`** | 491,463 | 49,637,716 | **959,091** |
| **11** | 10,550,000 | 10,550,000 | **9,590,909** | 9,590,909 | **`advance_cap`** | 592,286 | 59,820,911 | **959,091** |
| **12** | 10,550,000 | 10,550,000 | **9,590,909** | 9,590,909 | **`advance_cap`** | 694,118 | 70,105,938 | **959,091** |
| **13** | 10,550,000 | 10,550,000 | **9,590,909** | 9,590,909 | **`advance_cap`** | 796,968 | 80,493,815 | **959,091** |
| 14 | 0 | 0 | 0 | 0 | — | 804,938 | 81,298,753 | 0 |
| 15 | 0 | 0 | 0 | 0 | — | 812,988 | 82,111,741 | 0 |
| 16 | 0 | 0 | 0 | 0 | — | 821,117 | **82,932,858** → 9,207,858 | 0 |
| 17 | 0 | 0 | 0 | 0 | — | 92,079 | 9,299,937 | 0 |
| 18 | 0 | 0 | 0 | 0 | — | 92,999 | 9,392,936 | 0 |
| 19 | 0 | 0 | 0 | 0 | — | 93,929 | **9,486,865** → 0 | 0 |

Months 20–23 are empty: no spend, no balance, no interest.

**Funding gap** = 2 × 272,727 + 6 × 959,091 = **6,300,000**, which is exactly
`69,300,000 / 11` — the ineligible externals share of the *whole* construction
total, to the penny, because every construction month is capped and the two
rounding residues (−0.27 per strip-out month, +0.09 per construction month)
cancel across the eight months.

**Sweep (§4.4/§4.4.1), unchanged in shape.** Tranche 1 (month 16, anchored) nets
73,725,000 against a balance of 82,932,858 plus a 1,100,000 exit fee =
84,032,858 — less than required, so §4.4's clamp applies: it repays 73,725,000,
the facility does **not** redeem, and 9,207,858 carries. Tranche 2 (month 19)
nets 172,025,000, clears 9,486,865 + 1,100,000 and redeems, distributing
161,438,135.

**Total interest** = 6,811,865 (was 7,461,714). Peak debt is month 16's
pre-receipt balance, **82,932,858** (was 89,678,313), month unchanged.
Total draws 74,400,000 (was 80,700,000) — 80,700,000 less the 6,300,000 gap.

**Cost-to-complete is unchanged at `null` / `0`,** for the same §5.10 reason as
Q: the tightest month is label 1, remaining cost 87,491,865 against remaining
funding 107,980,000, a surplus of 20,488,135.

#### Pinned `expected_metrics` moved on fixture S

| Metric | Was | Now | Derivation |
|---|---:|---:|:--|
| `finance_costs_pence` | 10,561,714 | **9,911,865** | 6,811,865 interest + 2,000,000 arrangement + 1,100,000 exit |
| `total_development_cost_pence` | 201,261,714 | **200,611,865** | 190,700,000 cost-before-finance (unchanged) + 9,911,865 |
| `profit_pence` | 48,738,286 | **49,388,135** | 250,000,000 − 200,611,865 |
| `profit_on_cost_pct` | 24.22 | **24.62** | 49,388,135 / 200,611,865 |
| `profit_on_gdv_pct` | 19.5 | **19.76** | 49,388,135 / 250,000,000 |
| `peak_debt_pence` | 89,678,313 | **82,932,858** | month 16 closing balance, pre-receipt (month unchanged at 16) |
| `gross_ltc_pct` | 44.56 | **41.34** | 82,932,858 / 200,611,865 |
| `net_ltc_pct` | 44.36 | **40.98** | net advances 76,400,000 (74,400,000 + 2,000,000) / 186,450,000 |
| `ltgdv_developer_pct` | 35.87 | **33.17** | 82,932,858 / 250,000,000 |
| `funding_gap_pence` | 0 | **6,300,000** | 69,300,000 / 11, above |
| `redemption_balance_at_disposal_pence` | 16,436,714 | **9,486,865** | month 19 pre-sweep balance |
| `redemption_schedule_balances_pence` | [89,678,313, 16,436,714] | **[82,932,858, 9,486,865]** | the two disposal months' pre-sweep balances |

`uses_construction_pence`, every programme array, `equity_contributed_pence`
(105,750,000), `peak_debt_month` (16), `redemption_schedule_months` ([16, 19])
and both `cost_to_complete_*` figures are **unchanged**.

#### Consequences recorded here, not discovered later

1. **`report_safe` is now false on both fixtures.** A funding gap makes
   `funding_complete` false, and `funding_complete` is a term of `report_safe`
   (validation.ts / validation.py). Fixture S's memo tests are updated to say
   so; the one that used `report_safe === true` to prove "a slip inside a
   phase's own float changes nothing" now asserts the programme state and the
   absence of input errors directly, and the overrun test that inferred its
   failure from `report_safe` now asserts the overrun issue itself.
2. **The corpus's profit-identity check now skips Q and S.**
   `test_profit_equals_equity_flows_and_sources_equal_uses_when_fully_realised`
   (and its `invariants.test.ts` twin) gate on `funding_gap_pence == 0`, so both
   fixtures fall out of that matrix. `sources_equal_uses` itself is unaffected —
   `funding_gap_pence` appears explicitly on the sources side of §7 — and is
   still asserted for both fixtures through the corpus's reconciliation checks.
3. **§5.10 counts undrawn facility gross of the §4.2(b) cap.** Both fixtures now
   show a real funding gap with no cost-to-complete shortfall. That is a stated
   limitation of §5.10, not a defect introduced here, and it is what makes Q and
   S the corpus's standing examples of the allowed direction.

### 20.4 Fixture W — monitoring on site (`fixtures/financial-model/w-monitoring-on-site.json`)

**Purpose:** the release's golden case for §20.2's statement and its
cross-engine penny-agreement carrier — the first **inputs v11**-native fixture,
detailed cost mode, one lender-ineligible package, and a `monitoring` block at
reporting month 6. It is also, deliberately, the corpus's only **detailed-mode**
document that reaches §7's fully-realised profit identity: wiring the §4.2(b)
cap (§20.2/§20.3 above) opened real funding gaps on Q and S, the only other
detailed-mode fixtures, and `funding_gap_pence == 0` is a term of that
predicate, so the identity's detailed-mode arm had no witness left. W is that
witness, and both invariant suites now assert per **cost mode**, not merely
corpus-wide.

Every figure below was derived before either engine ran on this document.

**Inputs.** England/NI, term 18, no programme network (auto windows), VAT not
registered, `investment_case: null`, single-tranche sale at term
(`route: 'sell_all'`, no `sales_phasing`). Purchase price 20,000,000p with
200,000p legal and 100,000p survey fees (`broker_fee_pct: 0`). Detailed cost
plan: `enabling_strip_out_asbestos` 1,500,000p (eligible, class
`existing_building`), `finishes` 4,000,000p (eligible, class `general`),
`externals` 500,000p (**`lender_eligible: false`**, class `abnormal`); general
contingency 10%, the other two classes 0%; one fixed `architect` fee 300,000p
(professional) and one fixed `prior_approval` fee 20,000p (statutory).
`funding_source: 'development_finance'`, `interest_type: 'rolled_up'`,
`annual_interest_rate_pct: 10`, `committed_net_facility_pence: 22,000,000`,
`interest_reserve_pence: 1,500,000`, `committed_gross_facility_pence: null`
(gross = 23,500,000), `development_cost_advance_pct: 70`,
`day_one_advance_pence: 12,000,000`, `arrangement_fee_pct: 1.0` on the
committed **net** facility, every other finance fee 0,
`equity_draw_rule: 'equity_first'`. One confirmed cash equity source,
16,000,000p (sized below). GDV 45,000,000p from three units (15,000,000p each,
80 sqm each), `selling_agent_fee_pct: 1.5`, `selling_legal_fee_pence: 500,000`.

#### Step 1 — the cost plan and the eligible ratio

Detailed mode, so `base_build` is the package sum and `compliance` is 0 (§3.2.1
prices compliance inside the packages):

| Quantity | Derivation | Pence |
|---|---|---|
| `base_build_pence` | 1,500,000 + 4,000,000 + 500,000 | **6,000,000** |
| `lender_eligible_base_pence` | 1,500,000 + 4,000,000 (externals excluded) | **5,500,000** |
| `lender_eligible_ratio` | 5,500,000 / 6,000,000 = 11/12 | **0.9166666666666666** |
| contingency `general` | base `all_packages` = 6,000,000, 10% | **600,000** |
| contingency `existing_building` | base `selected_packages` = 1,500,000, 0% | 0 |
| contingency `abnormal` | base `selected_packages` = 500,000, 0% | 0 |
| `contingency_total_pence` | sum of the three ROUNDED amounts | **600,000** |
| `compliance_pence` | detailed mode | **0** |
| `construction_total_pence` | 6,000,000 + 600,000 + 0 | **6,600,000** |
| `professional_total_pence` | one fixed fee | **300,000** |
| `statutory_total_pence` | one fixed `prior_approval` fee | **20,000** |
| `conversion_total_pence` | 6,600,000 + 300,000 + 20,000 | **6,920,000** |
| `implied_rate_pence_per_sqm` | round(6,000,000 / 300) | **20,000** |

`0.9166666666666666` is the exact IEEE-754 double nearest 11/12 — the fixture
pins that literal, and both engines must print it character for character. The
neighbouring double `0.9166666666666667` is the negative control.

#### Step 2 — acquisition and SDLT

VAT is not registered, so the chargeable consideration is the raw price
(§17.7). England/NI, `basis: 'non_residential'`, read from
`fixtures/tax/acquisition-tax-tables.json` (bands 0% to 15,000,000p, 2% to
25,000,000p, 5% above), slice basis:

```
SDLT = 0% x 15,000,000  +  2% x (20,000,000 - 15,000,000)
     = 0                +  100,000                            = 100,000p
```

```
acquisition_cost = 20,000,000 + 100,000 + 200,000 + 100,000 + 0 + 0 = 20,400,000p
```

That is the acquisition line's **original budget**, and the monitoring block's
acquisition current budget is set equal to it so the acquisition variance is 0
and the construction line carries the statement's only material variance.

#### Step 3 — the uses schedule (auto windows, term 18)

`construction_window = max(1, 18 - 2) = 16` (ledger months 1..16);
`professional_window = ceil(16 / 2) = 8` (ledger months 1..8); the
`prior_approval` fee lands in month 0 and `statutory_spread_total` is therefore
0 (§3.4).

- construction: 6,600,000 / 16 = **412,500** in each of months 1..16 (exact, no residue)
- professional: 300,000 / 8 = **37,500** in each of months 1..8 (exact)
- month 0: acquisition 20,400,000 + statutory 20,000 = **20,420,000**

Sale receipts land in month `term - 1` = 17: gross 45,000,000, agent fee
round(45,000,000 x 1.5%) = 675,000, selling legal 500,000, so
`selling_costs_pence` = **1,175,000** and net receipts = **43,825,000**.

#### Step 4 — the §4.2(b) scaled cap base, month by month

The cap is never actually reached in this document (equity meets every month's
cost first), but it is what forces the equity to be sized as it is, so it is
derived here explicitly. Monthly rate `r` = 10 / 100 / 12.

```
eligible(m)    = round(construction(m) x 11/12) + professional(m) + statutory(m)
advance_cap(m) = round(eligible(m) x 70 / 100)
```

| Ledger months | construction | x 11/12 | professional | eligible | advance cap (70%) | month's cash use |
|---|---|---|---|---|---|---|
| 1..8 | 412,500 | 378,125 | 37,500 | 415,625 | round(290,937.5) = **290,938** | 450,000 |
| 9..16 | 412,500 | 378,125 | 0 | 378,125 | round(264,687.5) = **264,688** | 412,500 |
| 17 | 0 | 0 | 0 | 0 | 0 | 0 |

412,500 x 11/12 is exact (412,500 / 12 = 34,375; x 11 = 378,125), so the
scaling introduces no residue of its own; the one rounding is the 70% product.

**The cap is below the month's cost in every single month.** With
`equity_first`, the facility is only reached once committed equity is
exhausted, and from that month on the shortfall (450,000 − 290,938 = 159,062,
or 412,500 − 264,688 = 147,812) would fall straight into `funding_gap_pence`.
There is therefore no equity figure that funds *part* of the programme without
opening a gap: the equity must cover the whole of it.

**Sizing the equity (the design choice this fixture rests on).**

```
month 0 residual after the 12,000,000 day-one advance : 20,420,000 - 12,000,000 =  8,420,000
months 1..16 construction + professional              : 6,600,000 + 300,000     =  6,900,000
minimum committed cash equity for a zero funding gap                            = 15,320,000
```

The fixture commits **16,000,000p** — the round figure above that minimum,
leaving 680,000p of committed-but-uncalled equity so the statement's
`remaining_cash_equity` term is genuinely non-zero at the end as well as at
month 6.

#### Step 5 — the ledger, hand-derived month by month

Month 0: the arrangement fee capitalises first —
round(22,000,000 x 1.0%) = **220,000** — so `cum_net_used` is 220,000 before
any draw. The gross-headroom cap (§4.2(c)) is
`floor(23,500,000 / (1 + r)) - 0 - 220,000 = 23,305,785 - 220,000 = 23,085,785`,
and the net-facility headroom is 21,780,000, so the day-one draw is the
requested 12,000,000 (the binding term is the request itself). Equity meets the
remaining 8,420,000. Interest accrues on `opening + draw + cap_fees`:
round(12,220,000 x r) = **101,833**.

From month 1 on there is no draw at all: equity covers every month's cost in
full, so `remainder` is 0 and the cap block never runs. Interest is
`round(opening x r)` and capitalises.

| m | cash uses | draw | cap fees | interest | equity | closing balance | cum. capitalised interest |
|---|---|---|---|---|---|---|---|
| 0 | 20,420,000 | 12,000,000 | 220,000 | 101,833 | 8,420,000 | 12,321,833 | 101,833 |
| 1 | 450,000 | 0 | 0 | 102,682 | 450,000 | 12,424,515 | 204,515 |
| 2 | 450,000 | 0 | 0 | 103,538 | 450,000 | 12,528,053 | 308,053 |
| 3 | 450,000 | 0 | 0 | 104,400 | 450,000 | 12,632,453 | 412,453 |
| 4 | 450,000 | 0 | 0 | 105,270 | 450,000 | 12,737,723 | 517,723 |
| 5 | 450,000 | 0 | 0 | 106,148 | 450,000 | 12,843,871 | 623,871 |
| 6 | 450,000 | 0 | 0 | 107,032 | 450,000 | 12,950,903 | 730,903 |
| 7 | 450,000 | 0 | 0 | 107,924 | 450,000 | 13,058,827 | 838,827 |
| 8 | 450,000 | 0 | 0 | 108,824 | 450,000 | 13,167,651 | 947,651 |
| 9 | 412,500 | 0 | 0 | 109,730 | 412,500 | 13,277,381 | 1,057,381 |
| 10 | 412,500 | 0 | 0 | 110,645 | 412,500 | 13,388,026 | 1,168,026 |
| 11 | 412,500 | 0 | 0 | 111,567 | 412,500 | 13,499,593 | 1,279,593 |
| 12 | 412,500 | 0 | 0 | 112,497 | 412,500 | 13,612,090 | 1,392,090 |
| 13 | 412,500 | 0 | 0 | 113,434 | 412,500 | 13,725,524 | 1,505,524 |
| 14 | 412,500 | 0 | 0 | 114,379 | 412,500 | 13,839,903 | 1,619,903 |
| 15 | 412,500 | 0 | 0 | 115,333 | 412,500 | 13,955,236 | 1,735,236 |
| 16 | 412,500 | 0 | 0 | 116,294 | 412,500 | 14,071,530 | 1,851,530 |
| 17 | 0 | 0 | 0 | 117,263 | 0 | **0** (14,188,793 before the sweep) | 1,968,793 |

Month 17: the balance reaches 14,071,530 + 117,263 = **14,188,793** — the peak,
and `peak_debt_month` is 17 — and the 43,825,000 net sale receipt clears it
whole at `sales_sweep_pct: 100` with `exit_fee_pct: 0`, so
`senior_outstanding_at_maturity_pence` is 0 and `funding_gap_pence` is 0 across
the whole term. Total equity contributed is 8,420,000 + 8 x 450,000 +
8 x 412,500 = **15,320,000**; total interest is **1,968,793**.

The interest reserve (1,500,000) is exhausted during ledger month 13
(cumulative capitalised interest crosses it between 1,392,090 and 1,505,524),
so the fixture also raises `interest_reserve_exhausted` — an amber flag that
does not touch `report_safe`.

**Cost stack and profit:**

```
cost_before_finance = 20,400,000 + 6,600,000 + 300,000 + 20,000 + 1,175,000 = 28,495,000
finance_costs       = interest 1,968,793 + arrangement 220,000 + exit 0 + ancillary 0 = 2,188,793
total_development_cost                                                     = 30,683,793
profit              = 45,000,000 + 0 (nothing retained) - 30,683,793       = 14,316,207
profit_on_cost_pct  = round(14,316,207 / 30,683,793 x 10,000) / 100        = 46.66
profit_on_gdv_pct   = round(14,316,207 / 45,000,000 x 10,000) / 100        = 31.81
```

#### Step 6 — the §5.10 series, `m = 1..18`

`remaining_cost(m)` sums ledger months `m..17`'s uses plus their interest and
capitalised fees; `remaining_funding(m)` is
`undrawn_net(m-1) + reserve_headroom(m) + remaining_cash_equity(m)`, with
`undrawn_net` a constant 9,780,000 (22,000,000 − 12,220,000 drawn in month 0
and never touched again) and
`reserve_headroom(m) = max(0, 23,500,000 - 22,000,000 - cum_capitalised_interest(m-1))`.

| m | remaining cost | reserve headroom | remaining funding | surplus |
|---|---|---|---|---|
| 1 | 8,766,960 | 1,398,167 | 18,758,167 | 9,991,207 |
| 2 | 8,214,278 | 1,295,485 | 18,205,485 | 9,991,207 |
| 3 | 7,660,740 | 1,191,947 | 17,651,947 | 9,991,207 |
| 4 | 7,106,340 | 1,087,547 | 17,097,547 | 9,991,207 |
| 5 | 6,551,070 | 982,277 | 16,542,277 | 9,991,207 |
| 6 | 5,994,922 | 876,129 | 15,986,129 | 9,991,207 |
| 7 | 5,437,890 | 769,097 | 15,429,097 | 9,991,207 |
| 8 | 4,879,966 | 661,173 | 14,871,173 | 9,991,207 |
| 9 | 4,321,142 | 552,349 | 14,312,349 | 9,991,207 |
| 10 | 3,798,912 | 442,619 | 13,790,119 | 9,991,207 |
| 11 | 3,275,767 | 331,974 | 13,266,974 | 9,991,207 |
| 12 | 2,751,700 | 220,407 | 12,742,907 | 9,991,207 |
| 13 | 2,226,703 | 107,910 | 12,217,910 | 9,991,207 |
| 14 | 1,700,769 | 0 | 11,697,500 | 9,996,731 |
| 15 | 1,173,890 | 0 | 11,285,000 | 10,111,110 |
| 16 | 646,057 | 0 | 10,872,500 | 10,226,443 |
| 17 | 117,263 | 0 | 10,460,000 | 10,342,737 |
| 18 | 0 | 0 | 10,460,000 | 10,460,000 |

The surplus is positive at every label, so
`cost_to_complete_first_shortfall_month` is **null** and
`cost_to_complete_max_shortfall_pence` is **0**. (The constant 9,991,207 for
`m = 1..13` is not a coincidence worth pinning: while the reserve headroom is
still positive, each month's fall in remaining cost is matched pence for pence
by the fall in remaining equity plus reserve headroom. From `m = 14` the
headroom is floored at 0 and the two stop tracking.)

#### Step 7 — the §20.2 statement at `m = 6`

Entered block: `reporting_month: 6`, `reporting_date: '2027-03-31'`,
`debt_drawn_to_date_pence: 14,500,000`,
`cash_equity_injected_to_date_pence: 8,000,000`. Original budgets come from
§20.1's table (spec §6): acquisition 20,400,000 (Step 2), construction
`base_build + compliance` = 6,000,000, professional 300,000, statutory 20,000,
contingency 600,000 — and 6,000,000 + 600,000 is exactly the 6,600,000 the
schedule spreads as construction, the split identity §6 requires.

| Category | original | current | certified | paid | committed | committed − certified | forecast | est. final | vs original | vs current | remaining |
|---|---|---|---|---|---|---|---|---|---|---|---|
| acquisition | 20,400,000 | 20,400,000 | 20,400,000 | 20,400,000 | 20,400,000 | 0 | 0 | 20,400,000 | 0 | 0 | 0 |
| construction | 6,000,000 | 6,100,000 | 2,000,000 | 1,800,000 | 5,900,000 | 3,900,000 | 400,000 | 6,300,000 | **+300,000** | +200,000 | 4,300,000 |
| professional | 300,000 | 300,000 | 120,000 | 120,000 | 300,000 | 180,000 | 0 | 300,000 | 0 | 0 | 180,000 |
| statutory | 20,000 | 20,000 | 20,000 | 20,000 | 20,000 | 0 | 0 | 20,000 | 0 | 0 | 0 |
| contingency | 600,000 | 600,000 | 50,000 | 50,000 | 50,000 | 0 | 450,000 | 500,000 | −100,000 | −100,000 | 450,000 |
| **totals** | **27,320,000** | **27,420,000** | **22,590,000** | **22,390,000** | **26,670,000** | **4,080,000** | **850,000** | **27,520,000** | **+200,000** | **+100,000** | **4,930,000** |

`contingency_remaining_pence` = 600,000 − 50,000 = **550,000**.

**Funding side at m = 6** (elapsed = ledger months 0..5):

```
cum_capitalised_interest(0..5) = 101,833 + 102,682 + 103,538 + 104,400 + 105,270 + 106,148 = 623,871
undrawn_net_facility  = max(0, 22,000,000 - 14,500,000)                 =  7,500,000
reserve_headroom      = max(0, 23,500,000 - 22,000,000 - 623,871)       =    876,129
remaining_cash_equity = max(0, 16,000,000 -  8,000,000)                 =  8,000,000
remaining_funding                                                       = 16,376,129
```

**Uses side at m = 6** (forecast = ledger months 6..17):

```
forecast_finance = 107,032 + 107,924 + 108,824 + 109,730 + 110,645 + 111,567
                 + 112,497 + 113,434 + 114,379 + 115,333 + 116,294 + 117,263  = 1,344,922
remaining_uses   = 4,930,000 + 1,344,922                                      = 6,274,922
surplus          = 16,376,129 - 6,274,922                                     = 10,101,207
monitoring_shortfall = max(0, -10,101,207)                                    =          0
```

A positive surplus is the honest answer for this document, and §20.2's own
worksheet instruction says so: the shortfall pins 0 and the surplus carries the
number. Every other column of the statement is still exercised, including all
three funding terms.

**Variances against the inception plan** (elapsed = ledger months 0..5):

```
cum(draw + capitalised fees)(0..5) = 12,000,000 + 220,000                     = 12,220,000
debt_drawn_variance   = 14,500,000 - 12,220,000                               =  +2,280,000
cum equity contributed(0..5) = 8,420,000 + 5 x 450,000                        = 10,670,000
equity_injected_variance = 8,000,000 - 10,670,000                             =  -2,670,000
cum planned cost(0..5) = 20,420,000 + 5 x 450,000                             = 22,670,000
cost_to_date_variance = 22,590,000 - 22,670,000                               =     -80,000
```

Positive means ahead of plan in all three: the sponsor has drawn 2,280,000p
more senior debt than the inception ledger forecast by month 6, injected
2,670,000p less equity than planned, and certified 80,000p less cost than the
plan spent.

#### Pinned `expected_metrics`

Hand-derived above, all of them:

| Key | Value | From |
|---|---|---|
| `gdv_pence` | 45,000,000 | three units at 15,000,000 |
| `acquisition_tax_pence` / `sdlt_pence` | 100,000 | Step 2 |
| `acquisition_cost_pence` | 20,400,000 | Step 2 |
| `construction_cost_pence` | 6,600,000 | Step 1 |
| `professional_fees_pence` / `statutory_costs_pence` | 300,000 / 20,000 | Step 1 |
| `selling_costs_pence` | 1,175,000 | Step 3 |
| `cost_before_finance_pence` | 28,495,000 | Step 5 |
| `finance_costs_pence` | 2,188,793 | Step 5 |
| `total_development_cost_pence` | 30,683,793 | Step 5 |
| `profit_pence` | 14,316,207 | Step 5 |
| `profit_on_cost_pct` / `profit_on_gdv_pct` | 46.66 / 31.81 | Step 5 |
| `peak_debt_pence` / `peak_debt_month` | 14,188,793 / 17 | Step 5 |
| `day_one_advance_pence` | 12,000,000 | Step 5 |
| `equity_contributed_pence` | 15,320,000 | Step 5 |
| `funding_gap_pence` | 0 | Step 5 |
| `cost_to_complete_first_shortfall_month` | null | Step 6 |
| `cost_to_complete_max_shortfall_pence` | 0 | Step 6 |
| `cost_plan.*` (ten keys, ratio included) | Step 1 | Step 1 |
| `cost_plan_contingency_*` (six keys) | Step 1 | Step 1 |
| `uses_construction_pence` | 0, then 412,500 x 16, then 0 | Step 3 |

**Four keys are held back for Task 9.** Spec §20.4 asks this fixture to pin
`monitoring_shortfall_pence` (**0**), `monitoring_estimated_final_cost_pence`
(**27,520,000**), `monitoring_surplus_pence` (**10,101,207**) and the flat
`lender_eligible_ratio` (**0.9166666666666666**) — all four derived in Step 7
and Step 1 above. None of the four has a `FLAT_KEYS` mapper until Task 9 wires
the statement into metrics, and the golden harness resolves an unmapped
`expected_metrics` key as a **direct attribute of `metrics`**
(`_resolve_path` / `resolvePath`), so pinning them today raises an attribute
error rather than being ignored. Task 9 adds the mappers and these four pins
together. The ratio is already pinned through the dotted
`cost_plan.lender_eligible_ratio` path, which needs no mapper.

### 20.5 The corpus implication after C1

Numbered 20.5 rather than the 20.3 the release plan named, because §20.2, §20.3
and §20.4 above were written first and hold the Q, S and W worksheets. The
content is the plan's.

Spec §5.10's one asserted direction — *"the series reports a shortfall ⇒ the
ledger recorded a `funding_gap` somewhere"* — is unchanged by R14. What changed
is the exclusion list beside it.

**The exclusion list is now empty, and it is empty on purpose.**
`_SHORTFALL_WITHOUT_GAP_STEMS` (`tests/test_financial_model_cost_to_complete.py`)
and `SHORTFALL_WITHOUT_GAP_STEMS` (`cost-to-complete.test.ts`) both held
`p-scotland-levered` from R9 to R14. C1's correction makes fixture P's series
clear at every month, so the entry came off — but the constant itself stays,
with a comment saying why. A future fixture that genuinely reproduces
"shortfall with no funding gap" then has a declared home and must be **listed
deliberately**, rather than sliding through as an ordinary case nobody looked
at. Deleting the constant would have made the next such finding invisible.

**The `saw_counter_example` guard is gone; `saw_positive_case` stays.** The
counter-example guard asserted the exclusion list was non-vacuous — that at
least one fixture on it really did show the excluded shape. With the list empty
by design, that guard would fail forever and correctly, which is not a guard but
a permanent red build. The positive-case guard is the one that still earns its
place: it asserts the corpus contains at least one fixture where a shortfall and
a funding gap are both present, so the implication cannot pass vacuously across a
corpus in which nothing ever reports a shortfall at all.

**Three fixtures now carry the load the exclusion list used to.**

| Fixture | What it holds down |
|---|---|
| P (`p-scotland-levered`) | The phantom cannot come back: `null` / `0` pinned, with the old `1` / `392483` as negative controls in both engines |
| V (`v-exhausted-reserve`) | The correction is not one-sided — a real shortfall, `funding_gap_pence` 704,021, and the positive case for the implication (§20.1 above) |
| Q, S (`q-detailed-cost-plan`, `s-dated-programme`) | The opposite shape, and the one §5.10's "Known limitation" already covers: a **real** funding gap of 2,031,318 / 6,300,000 that the cost-to-complete series does **not** see, because §5.10 counts the undrawn facility gross of §4.2(b)'s advance cap. Neither is a counter-example to the asserted direction — the implication runs the other way — and neither belongs on the exclusion list |

---

## 21. Lender case governance [R14b — no calculation-version change]

Numbered to match spec §21, the convention §20 above follows. **There is no
worksheet in this section and no hand derivation, because there is no
arithmetic**: R14b adds a persistence-and-workflow subsystem, and the golden
corpus is untouched by it. That the whole corpus walk passes *unmodified* is
itself the release's no-arithmetic guard, and it is listed as such in spec §21's
guard table. What follows records where the release's contracts are actually
pinned.

### 21.1 The mirrored governance suites

`tests/test_provenance.py` ↔ `frontend/src/lib/report-provenance.test.ts`, the
parity pair for the new dual-implemented module (`model-governance.md` §1).
Written case-for-case, not merely covering the same ground:

- **Ordering diagonals.** Spec §13.3's six conditions in their load-bearing
  order. The R8/R11 diagonals (an unconfirmed tax or VAT basis must not be
  displaced by `not_approved`, and must not displace `unreconciled` or
  `senior_not_repaid`) gain their Python mirror here for the first time — until
  R14b the whole gate lived in TypeScript, so the diagonal was pinned once.
- **The R14b diagonal**, both languages: an approved-but-stale case yields
  `lender_case_stale`; an *unapproved* stale case still yields `not_approved`,
  which is the assertion that pins the two reasons as mutually exclusive rather
  than merely ordered; and neither ever displaces conditions 1–4.
- **Default-argument compatibility.** `draftReason`'s staleness gate is a fifth
  defaulted parameter, so a four-argument caller must behave exactly as before —
  the same assertion R8 and R11 each wrote for their own added gate.
- **`DraftReason` membership.** A test asserts the union has exactly its six
  R14b members, so a seventh reason cannot be added without a banner, a
  sentence and an ordering decision.

### 21.2 The state machine, walked and complemented

`tests/test_lender_case_governance.py`, modelled on
`test_appraisal_governance.py`'s local-fixture pattern.

- **The legal walk**, through the API, with the side effects asserted at every
  step:
  `draft → submitted → under_review → information_required → under_review →
  approved_with_conditions`. It is chosen to exercise the awkward edge
  deliberately — the second `→ under_review` is a *resubmission*, and the test
  pins that it **overwrites** `reviewer` rather than preserving the first one
  (spec §21.2), with the change log keeping both.
- **The illegal complement.** Every `(from, to)` pair *not* in §21.2's table is
  driven through the real endpoint and must 409 — a fresh case is walked to each
  `from` status along its shortest legal path first, so the refusal is the
  machine's and not a fixture's. The one row excluded is `from = superseded`:
  a superseded case is not live, so those requests are 404s rather than 409s and
  are covered by the no-live-case test instead. A test that only walks the legal
  path proves the machine permits what it should; only the complement proves it
  refuses what it should, and the complement is what catches a table edited by
  hand in one language.
- **The transition table itself** is restated *literally* in both languages'
  suites rather than derived from the module under test, so a drive-by edit
  fails a test that names the whole machine. A second test pins the structural
  property: `superseded` is reachable from every state and is terminal.
- **The conditions rule**, both halves: absent on `approved_with_conditions` is
  a 422, and present on any other transition is a 422. One field, one meaning.
- **Creation preconditions**, one test each: no project (404), no saved
  appraisal (404), a pre-provenance appraisal stripped of its hashes (422), and
  a second live case (409).
- **Supersede-and-recreate**, the only refresh path (spec §21.6 limitation 3):
  the superseded case keeps the columns it died with, and the history returns
  both cases.
- **History ordering.** Two cases created inside the same second must come back
  in creation order — the case that fails under `created_at` alone, and under
  the case's own random UUID, and passes on the greatest-event-id tie-break the
  repository's `ORDER BY` uses.
- **Cascade.** Deleting the project removes its cases and their events.

### 21.3 The case hash, re-derived independently in both languages' conventions

Spec §13.2.1. Python re-derives the hash **by hand** in the test —
`hashlib.sha256` over the eight-part joined string — rather than calling the
helper's own internals, the same discipline
`test_audit_hash_binds_inputs_outputs_and_status` established for the audit
hash. A test that computed the expected value the way the code does would pass
against any formula.

Three properties beyond the value itself:

- **Absent parts encode as empty strings**, with the separator count preserved
  (`c1|p1|draft|||||<audit hash>`), so two different absences cannot collide
  with one present value.
- **A naive and an aware UTC datetime hash identically.** This is the whole
  point of §13.2.1's canonical form: SQLite returns naive datetimes for values
  written aware, so without the naive-as-UTC rule a write-time hash and a
  re-read recomputation would disagree on the same case.
- **It moves with the status alone**, which is what makes it a record of
  governance state rather than of the locked snapshot.

The API suite adds the end-to-end half: after a case is walked to
`credit_approved`, the stored `case_hash` is re-derived by hand from the case's
*own returned fields* — including `decided_at`, re-canonicalised from the
response rather than taken from the server's clock — and asserted to have moved
off the value stored at creation.

### 21.4 The database-level invariant

Spec §21.1's one-live-case rule is asserted **at the database**, not only
through the endpoint's 409: a second non-superseded row for the same project is
inserted directly against the ORM and must be refused by the partial unique
index. Pinned on SQLite, which is why the index declares `sqlite_where`
alongside `postgresql_where` — an index declared for one dialect only would
pass every Postgres test and silently permit two live cases on the boot-time
`create_all` path. `test_orm_tables.py` pins both dialect options are present,
and `test_alembic_migrations.py`'s hard-coded revision walk gains `"006"`.
`test_api_endpoints.py` pins all five `/lender-cases` paths.

### 21.5 The release gate's first FINAL document

`frontend/src/lib/report-qa/memo-release-gate.test.ts`. §12's gate has asserted
DRAFT documents since R7 because no other kind could exist. R14b adds three:

1. **An approved, current case renders FINAL** — no DRAFT watermark on any
   page, the narrative's "It is a final lender report." sentence printed, and
   the case id, case hash, reviewer, decider and **locked audit hash** all
   present in the extracted PDF text (spec §13.1's case rows). The layout gate
   still applies to it: no overflowing item, no sparse page. This document was
   **watched failing** — still DRAFT — before the provenance wiring landed,
   which is what proves the wiring rather than the enum is what flips it.

   The locked-audit-hash assertion needs its fixture read carefully. The
   approved case's `locked_audit_hash` is `'e'.repeat(64)` and the stored
   record's `audit_hash` is `'c'.repeat(64)`, deliberately **not** the same
   value: they were equal in the first draft, which would have let
   `toContain(locked_audit_hash)` pass off the panel's own live "Audit hash" row
   whether or not the case row was ever drawn. The test asserts the two differ
   before asserting the value appears, so the guard cannot go vacuous if a later
   edit re-aligns the fixtures. Distinct values also make the fixture the very
   shape the row exists for — a case whose locked audit hash has diverged from
   the live record's while the case is still current (spec §13.1, second case
   bullet).
2. **An approved-but-stale case** renders `DRAFT - LENDER CASE STALE - NOT FOR
   LENDER RELIANCE` and prints the disclosure naming the moved snapshot.
3. **Approval conditions are printed** when the case carries them.

The stale and FINAL assertions read the wrapped prose rather than the raw
extracted text where a sentence crosses a line break, following the same
convention as the tax-disclosure checks in this file.
