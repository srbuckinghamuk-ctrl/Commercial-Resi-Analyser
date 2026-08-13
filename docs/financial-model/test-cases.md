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

**Cross-language note (not a fixture divergence, but recorded for anyone extending the solver to a
very large deal):** `solveSeniorBreakeven`'s bisection midpoint (`(lo + hi) >> 1`, spec-mandated
shape) uses JavaScript's 32-bit-signed-integer bitwise `>>`. For a redemption balance at or above
`2**31` pence (~£21.47m), `hi` exceeds the safe 32-bit range and the bit-shift corrupts `mid`,
exhausting the 200-iteration cap and returning `null` — empirically confirmed at
`redemption_balance_pence = 5,000,000,000` (~£50m). Python's `(lo + hi) // 2` has no such limitation
and converges correctly at the same scale (`tests/test_financial_model_breakeven.py::
test_converges_correctly_for_realistic_large_deals_where_ts_cannot`). Both fixtures F/G's redemption
balances (~£586k) are far below this boundary, so neither pinned value is affected — this is a
documented behavioural limit for future large-deal fixtures, not a defect in the current pins. See
`task-4-report.md` for the full reproduction and reasoning.

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
