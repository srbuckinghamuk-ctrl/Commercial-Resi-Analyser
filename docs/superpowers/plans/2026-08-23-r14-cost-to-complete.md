# R14 — Cost-to-complete: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct §5.10's phantom shortfall (C1), give the appraisal a single-date **monitoring cost-to-complete statement** from entered actuals, and make `lender_eligible` live in the §4.2(b) draw cap.

**Architecture:** `cost_to_complete` keeps its shape and gains one funding term — the unconsumed interest reserve of a rolled-up facility — and one column. A new `monitoring` module in each engine runs strictly after the ledger and *reads* it (forecast finance, cumulative draws, cumulative interest capitalised) but never changes it: no re-simulation. `lender_eligible` reaches the ledger as a single ratio computed once on the cost plan and published on `Schedule`. Inputs v11 adds one nullable top-level block; every existing document is bit-identical.

**Tech Stack:** TypeScript (Vitest) in `frontend/src/lib/model/`; Python 3.12 + Pydantic v2 (pytest) in `app/financial_model/`. The two engines mirror function-for-function; no calculation logic in React components or `export-investment-memo.ts`.

**Spec:** `docs/superpowers/specs/2026-08-23-r14-cost-to-complete-design.md` — read it before Task 1 and keep it open. Where this plan and the spec disagree, **the spec wins and the plan is the defect** — say so rather than implementing the plan's version. **If a number in a brief does not reconcile with your own derivation, say so; never adjust it to match what the code prints.**

## Global Constraints

- **Versions:** `CALC_VERSION` `'2.12.0'` → `'2.13.0'` in **both** `frontend/src/lib/model/finance-types.ts` (last line) and `app/financial_model/types.py` (`CALC_VERSION = "2.12.0"`, near the end). Inputs `v10` → `v11`. Bumped in Task 4.
- **Money is integer pence.** `Math.round` in TS, `money_round` (`app/financial_model/engine.py`) in Python. The only new rounding this release is the cap base in Task 3 (`round(construction_pence × ratio)`); the statement (Task 7/8) is sums and differences of integers and **rounds nothing**.
- **Both engines mirror.** Every validation rule added to `validation.ts` is added to `validation.py` with the **same field string and message text**. Every function in `monitoring.ts` exists in `monitoring.py` in snake_case. Every `FlagCode` string is identical.
- **The statement never writes to the ledger.** `computeMonitoringStatement` reads `Schedule`, `MonthlyModel`, inputs and the cost-plan result. If a task seems to need to change a ledger month from an actual, stop — that is the re-simulation path the spec rejects (decision 3).
- **No silent clamping.** Out-of-range input is a hard `ValidationIssue` with `severity: 'error'`.
- **No calculation logic in React or in `export-investment-memo.ts`.** They read result fields only.
- **Migration adds only a written `null`:** `monitoring: null` (spec §6).
- **EOL discipline.** Before every commit that rewrites a file wholesale, `git ls-files --eol <path>` must show `i/lf`.
- **Figures marked `⟨hand-derive⟩` are NOT authoritative.** Derive them by hand from the fixture (worksheet in `docs/financial-model/test-cases.md`) before pinning. **Never** obtain a pinned figure by running the code and pasting what it printed.
- **Expected-red window.** From Task 6 (migration lands) until Task 14 (cutover), `frontend/src/lib/model/entry-point-guard.test.ts` and `tests/test_entry_point_guard.py` are **expected to fail** — they assert every production call site names the newest migration. Do not edit those guards to make them pass; do not do the cutover early. Each task's gate is its own named suites plus `tsc -b`; the full gate runs at Task 14.
- **Gate set, run before merge:** `npx vitest run`, `pytest`, `npx tsc -b`, `npm run lint -- --max-warnings 0`, `npm run build` (all `npm`/`npx` from `frontend/`). Baselines to beat: **pytest 2195**, **vitest 2588**.
- **Watch every guard fail first.** The guards that must be seen red against current `main`: Task 1's fixture-P pins, Task 2's exhausted-reserve shortfall, Task 3's ineligible-package inequality (and Q/S's hand-derived pins if Step 1b moves them), Task 7's `reporting_date` inertness (fails on a deliberately broken implementation — see the step).
- **Briefs go stale.** Line numbers below were true when written. Locate by content; verify field names against source.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `frontend/src/lib/model/monitoring.ts` | `MonitoringInputs` types, `MonitoringStatement` result types, `computeMonitoringStatement`. Pure; reads the ledger, never writes it. |
| `frontend/src/lib/model/monitoring.test.ts` | Statement unit tests, inertness guard, construction-split identity. |
| `app/financial_model/monitoring.py` | Python mirror. |
| `tests/test_financial_model_monitoring.py` | Python mirror of the tests. |
| `tests/test_migrate_v11.py` | v10 → v11 migration, numeric identity gate, three validation properties. |
| `fixtures/financial-model/v-exhausted-reserve.json` | Rolled-up, reserve smaller than forecast interest: the C1 correction's *real* shortfall. |
| `fixtures/financial-model/w-monitoring-on-site.json` | Detailed mode, one ineligible package, `monitoring` set at month 6. The release's golden case. |
| `frontend/src/components/calculator/MonitoringEditor.tsx` (+ `.test.tsx`) | Finance-page editor for the `monitoring` block. |
| `frontend/src/components/calculator/MonitoringStatementCard.tsx` (+ `.test.tsx`) | Summary-page statement: category table, funding reconciliation, variances. |

**Modified:**

| File | Change |
|---|---|
| `frontend/src/lib/model/cost-to-complete.ts`, `app/financial_model/cost_to_complete.py` | **Task 1:** reserve-headroom funding term and column. |
| `frontend/src/lib/model/finance-types.ts` | **Task 1:** `CostToCompleteSummary.months[].remaining_interest_reserve_headroom_pence`. **Task 3:** `CostPlanResult.lender_eligible_ratio`, `Schedule.lender_eligible_ratio`. **Task 4:** `MonitoringCategory`, `MonitoringLineInputs`, `MonitoringInputs`, `CalculatorInputsV11`, `AnyCalculatorInputs`, `CALC_VERSION`. **Task 9:** three `FlagCode`s, `AppraisalResultV2.monitoring_statement`. |
| `app/financial_model/types.py` | Mirrors of the above; `parse_calculator_inputs` v11 arm. |
| `frontend/src/lib/model/cost-plan.ts`, `app/financial_model/cost_plan.py` | **Task 3:** `lender_eligible_ratio`. |
| `frontend/src/lib/model/schedule.ts`, `app/financial_model/schedule.py` | **Task 3:** publish `lender_eligible_ratio` on `Schedule`. |
| `frontend/src/lib/model/monthly-engine.ts`, `app/financial_model/engine.py` | **Task 3:** cap base reads the ratio. |
| `frontend/src/lib/model/validation.ts`, `app/financial_model/validation.py` | **Task 5:** §20.3 input rules. |
| `frontend/src/lib/model/migrate.ts`, `app/financial_model/migrate.py` | **Task 6:** `isV11`, `migrateV10toV11`, `migrateInputsToV11`; `is_v2_or_later`. |
| `frontend/src/lib/model/metrics.ts`, `app/financial_model/metrics.py` | **Task 9:** statement computed and published; three flags. |
| `frontend/src/lib/model/golden-fixtures.test.ts`, `tests/test_financial_model_fixtures.py` | **Task 1:** fixture-P controls. **Task 9:** four new `FLAT_KEYS` mappers and their controls. |
| `frontend/src/lib/model/cost-to-complete.test.ts`, `tests/test_financial_model_cost_to_complete.py` | **Task 1:** exclusion list emptied, counter-example guard removed. |
| `fixtures/financial-model/p-scotland-levered.json` | **Task 1:** the two pins. |
| `frontend/src/components/calculator/FinancePage.tsx` | **Task 10:** mounts `MonitoringEditor`. |
| `frontend/src/components/calculator/CostToCompleteCard.tsx` | **Task 11:** reserve-headroom column. |
| `frontend/src/components/calculator/AppraisalSummaryPage.tsx` | **Task 11:** mounts `MonitoringStatementCard`. |
| `frontend/src/lib/export-investment-memo.ts` | **Task 12:** monitoring section. |
| `frontend/src/lib/report-qa/*` | **Task 12:** section-absent assertion on every existing fixture. |
| `docs/financial-model/calculation-specification.md` | **Task 13:** §5.10 rewrite, §4.2(b), §16.2/§16.8/§16.9, §13.3 VAT row, §1.6 (Task 4), §20. |
| `docs/financial-model/test-cases.md`, `docs/financial-model/migration-notes.md` | **Tasks 2, 8, 13.** |
| `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` | **Task 13:** R14 row narrowed, R14b added. |
| `app/models.py` | **Task 4:** the v1–v11 comment. |
| `frontend/src/components/ExportPage.tsx`, `frontend/src/components/ConversionCalculator.tsx`, `frontend/src/lib/model/index.ts`, `app/api/app.py`, `tests/test_entry_point_guard.py` | **Task 14:** cutover. |

---

## Task 1: C1 — credit the interest reserve (both engines)

Implements spec **§4**. One task for both engines because the six fixture-P
values (2 pins + 2 controls × 2 engines) must move in one commit.

**Files:**
- Modify: `frontend/src/lib/model/cost-to-complete.ts`
- Modify: `app/financial_model/cost_to_complete.py`
- Modify: `frontend/src/lib/model/finance-types.ts` (`CostToCompleteSummary`, ~line 562)
- Modify: `fixtures/financial-model/p-scotland-levered.json` (lines ~113–114)
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts` (P's `wrongValues`, ~line 655)
- Modify: `tests/test_financial_model_fixtures.py` (P's control tuple, ~line 1244)
- Modify: `frontend/src/lib/model/cost-to-complete.test.ts` (~lines 187–262)
- Modify: `tests/test_financial_model_cost_to_complete.py` (`TestShortfallDirectionAgainstFundingGap`, ~line 239)

**Interfaces:**
- Consumes: `MonthlyModel.committed_net_facility_pence`, `.committed_gross_facility_pence`, `LedgerMonth.interest_capitalised_pence`, `inputs.finance.interest_type`.
- Produces: `CostToCompleteSummary.months[].remaining_interest_reserve_headroom_pence: number` (Python `CostToCompleteMonth.remaining_interest_reserve_headroom_pence: int`). Signatures of `computeCostToComplete` / `compute_cost_to_complete` unchanged.

- [ ] **Step 1: Move fixture P's pins and watch the golden suites fail**

Edit `fixtures/financial-model/p-scotland-levered.json`:
```json
"cost_to_complete_first_shortfall_month": null,
"cost_to_complete_max_shortfall_pence": 0,
```
In `golden-fixtures.test.ts` P's `wrongValues`, replace the two lines with:
```ts
cost_to_complete_first_shortfall_month: 1,     // truly null — R14 closed C1; 1 was calc ≤2.12.0's phantom
cost_to_complete_max_shortfall_pence: 392483,  // truly 0 — the old phantom figure is the control
```
In `tests/test_financial_model_fixtures.py` P's tuple, the same two keys become `1` and `392_483`, with the same comment. Rewrite the comment above the tuple: it no longer holds a "deferred-defect figure"; it holds the **closed** C1's correction, and the old wrong answers are the controls.

Run: `cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts` and `pytest tests/test_financial_model_fixtures.py -q -k scotland`
Expected: FAIL — engine still reports `1` / `392483`.

**Reconciliation check before you proceed (do not skip):** spec §1.1 says P's forecast rolled-up interest is 3,913,416p against a reserve of 8,000,000p and the phantom shortfall is 392,483p. Under §4 the funding side gains at least `8,000,000 − 3,913,416 = 4,086,584p` at every `m`, which exceeds 392,483p, so the series clears at every month. If your own reading of the fixture disagrees with any of those three numbers, stop and say so.

- [ ] **Step 2: Implement the TS correction**

In `cost-to-complete.ts`, inside the `for (let m = 1 …)` loop, replace the funding block:
```ts
    const prevLedgerMonth = model.months[m - 1];
    cumEquityContributed += prevLedgerMonth.equity_contribution_pence;
    cumInterestCapitalised += prevLedgerMonth.interest_capitalised_pence;
    const undrawnFacility = prevLedgerMonth.undrawn_net_facility_pence ?? 0;
    // R14 spec §5.10 (C1). Rolled-up interest never consumes the net facility; it
    // capitalises against the gross facility's headroom, i.e. the interest reserve.
    // Remaining cost counts future interest, so remaining funding must count the
    // reserve that exists to pay it — the unconsumed part. Serviced interest is an
    // equity use (§4.3) and gets no reserve credit; cash deals have gross = net = 0.
    const reserveHeadroom = rolledUp
      ? Math.max(0, model.committed_gross_facility_pence - model.committed_net_facility_pence - cumInterestCapitalised)
      : 0;
    const remainingCashEquity = Math.max(0, cashEquityTotal - cumEquityContributed);
    const remainingFunding = undrawnFacility + reserveHeadroom + remainingCashEquity;
```
with, above the loop:
```ts
  const rolledUp = inputs.finance.interest_type === 'rolled_up';
  let cumInterestCapitalised = 0;
```
and push `remaining_interest_reserve_headroom_pence: reserveHeadroom` onto each month. Add the field to `CostToCompleteSummary['months'][number]` in `finance-types.ts` with a one-line doc comment citing §5.10.

- [ ] **Step 3: Mirror in Python**

`cost_to_complete.py`: add `remaining_interest_reserve_headroom_pence: int` to `CostToCompleteMonth`; `rolled_up = inputs.finance.interest_type == "rolled_up"`; `cum_interest_capitalised += prev_ledger_month.interest_capitalised_pence`; `reserve_headroom = max(0, model.committed_gross_facility_pence - model.committed_net_facility_pence - cum_interest_capitalised) if rolled_up else 0`; `remaining_funding = undrawn_facility + reserve_headroom + remaining_cash_equity`. Same comment.

- [ ] **Step 4: Empty the exclusion list and remove the counter-example guard**

In both corpus tests: `_SHORTFALL_WITHOUT_GAP_STEMS = set()` / `SHORTFALL_WITHOUT_GAP_STEMS: string[] = []`, delete the `saw_counter_example` / `sawCounterExample` variable and its final assertion, keep `saw_positive_case` and its assertion. Rewrite the long comment above the list: it now records that C1 was closed in R14 (calc 2.13.0) and the list is kept **empty on purpose** so that a future fixture that reproduces "shortfall with no gap" has a declared home and must be listed deliberately.

- [ ] **Step 5: Add the serviced-interest identity test (both engines)**

In `cost-to-complete.test.ts`, new `it`: for every non-sensitivity fixture whose `inputs.finance.interest_type === 'serviced'` (assert at least one was seen), every month has `remaining_interest_reserve_headroom_pence === 0` and `remaining_funding_pence === (model.months[m-1].undrawn_net_facility_pence ?? 0) + max(0, cashEquityTotal − Σ equity_contribution through m−1)` — recompute the right-hand side from the ledger in the test, not from the summary. Mirror in Python. **What this misses:** a constant added to both sides — the golden pins of every serviced fixture (unchanged this task) catch that.

- [ ] **Step 6: Run**

Run: `cd frontend && npx vitest run src/lib/model/cost-to-complete.test.ts src/lib/model/golden-fixtures.test.ts && npx tsc -b` and `pytest tests/test_financial_model_cost_to_complete.py tests/test_financial_model_fixtures.py -q`
Expected: PASS. Every fixture other than P has unchanged pins — if any other golden pin moved, a serviced or cash path was touched; stop.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/model/cost-to-complete.ts frontend/src/lib/model/cost-to-complete.test.ts frontend/src/lib/model/finance-types.ts frontend/src/lib/model/golden-fixtures.test.ts app/financial_model/cost_to_complete.py tests/test_financial_model_cost_to_complete.py tests/test_financial_model_fixtures.py fixtures/financial-model/p-scotland-levered.json
git commit -m "fix(r14): C1 — cost-to-complete credits the unconsumed interest reserve of a rolled-up facility (spec 5.10)"
```

---

## Task 2: Fixture V — the exhausted reserve

Implements spec **§4**'s second guard: the correction must *show* a shortfall the rejected correction would hide.

**Files:**
- Create: `fixtures/financial-model/v-exhausted-reserve.json`
- Modify: `docs/financial-model/test-cases.md` (new section `## 20. Cost-to-complete corrected [R14 — calc 2.13.0]`, `### 20.1 Fixture V — exhausted interest reserve`)
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts`, `tests/test_financial_model_fixtures.py` (controls for V)

**Interfaces:** none new. Fixture layout `{name, kind: "pipeline", inputs, expected_metrics}` as every fixture; store at **inputs v10** (`inputs_version: 10`, `investment_case: null`) — v11 does not exist yet; Task 6's gate migrates it.

- [ ] **Step 1: Design the fixture so the arithmetic is hand-derivable**

Headline cost mode, England, single-tranche sale at term, `retain_all: false`, no programme network (auto windows), no VAT registration. Inputs (design values — these are inputs, not pins):
- purchase price 10,000,000p; term 12 months; construction 6,000,000p; no professional/statutory fees beyond the fixed fields set to 0; `contingency_pct: 0`.
- `funding_source: 'development_finance'`, `interest_type: 'rolled_up'`, `annual_interest_rate_pct: 12` (1%/month), `committed_net_facility_pence: 12,000,000`, `interest_reserve_pence: 200,000`, `committed_gross_facility_pence: null` (gross = 12,200,000), `development_cost_advance_pct: 100`, `day_one_advance_pence: 6,000,000`, all fees 0.
- one cash equity source 4,000,000p, `evidence_status: 'confirmed'`.
- GDV 30,000,000p from two units.

Month 0 draws 6,000,000p; at 1%/month the reserve of 200,000p is consumed within roughly three months of accrual while the facility keeps drawing, so forecast interest to completion far exceeds the reserve. The shortfall at `m = 1` equals `remaining_cost(1) − remaining_funding(1)`, where the funding side is `undrawn_net(0) + (12,200,000 − 12,000,000 − interest_capitalised(0)) + (4,000,000 − equity_contribution(0))`.

- [ ] **Step 2: Hand-derive the worksheet**

Write `### 20.1` in `test-cases.md`: the month-by-month ledger (opening, draw, interest accrued, capitalised, closing, undrawn net) for all 12 months, then the §5.10 series for `m = 1..12` with the three funding terms shown separately, then `first_shortfall_month` and `max_shortfall_pence`. Also state the figure the **rejected** correction would give (drop interest from remaining cost) — it must be 0 at every `m` — so the worksheet itself records why decision 2 was taken.

- [ ] **Step 3: Author the fixture with the derived pins**

`expected_metrics` pins `cost_to_complete_first_shortfall_month` ⟨hand-derive⟩, `cost_to_complete_max_shortfall_pence` ⟨hand-derive⟩, `funding_gap_pence` ⟨hand-derive⟩ (expected `> 0`: the ledger itself hits the gross cap — that is what makes this a *positive* case for the corpus implication, not a counter-example), `peak_debt_pence` ⟨hand-derive⟩, `gdv_pence: 30000000`. Add V's negative controls in both golden suites (each control = pin ± 1, the convention every other fixture uses).

- [ ] **Step 4: Record the rejected-correction comparison (not committed)**

Temporarily change the TS engine to drop `lm.interest_accrued_pence` from `remainingCost` instead of crediting the reserve, run the V golden test, confirm it reports **no** shortfall, revert. Put the observed figures in your task report. This is spec §11 guard 2.

- [ ] **Step 5: Run**

Run: `cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts src/lib/model/cost-to-complete.test.ts` and `pytest tests/test_financial_model_fixtures.py tests/test_financial_model_cost_to_complete.py -q`
Expected: PASS, with V's shortfall pinned identically in both engines.

- [ ] **Step 6: Commit**

```bash
git add fixtures/financial-model/v-exhausted-reserve.json docs/financial-model/test-cases.md frontend/src/lib/model/golden-fixtures.test.ts tests/test_financial_model_fixtures.py
git commit -m "test(r14): fixture V — an exhausted interest reserve is a real cost-to-complete shortfall"
```

---

## Task 3: `lender_eligible` reaches the draw cap

Implements spec **§5**.

**Files:**
- Modify: `frontend/src/lib/model/cost-plan.ts` (`CostPlanResult` ~line 228; `computeCostPlan` return ~line 356)
- Modify: `app/financial_model/cost_plan.py` (`CostPlanResult` ~line 54; return ~line 180)
- Modify: `frontend/src/lib/model/finance-types.ts` (`Schedule` ~line 404)
- Modify: `frontend/src/lib/model/schedule.ts` (~line 55 and the returned object), `app/financial_model/schedule.py` (`Schedule` dataclass ~line 227; `build_schedule` ~line 313 and return)
- Modify: `frontend/src/lib/model/monthly-engine.ts` (~line 171), `app/financial_model/engine.py` (~line 349)
- Modify: `app/financial_model/types.py` (`lender_eligible` comment ~line 697), `app/financial_model/apply_scenario.py` (~line 51 note)
- Test: `frontend/src/lib/model/cost-plan.test.ts`, `frontend/src/lib/model/monthly-engine.test.ts`, `tests/test_financial_model_cost_plan.py`, `tests/test_financial_model_engine.py` (locate the existing files by name; if a name differs, use the file that tests that module)

**Interfaces:**
- Produces: `CostPlanResult.lender_eligible_ratio: number` (float in Python) — `1` in headline mode or when `base_build_pence === 0`, else `lender_eligible_base_pence / base_build_pence`, **unrounded**. `Schedule.lender_eligible_ratio: number` (Python dataclass field `lender_eligible_ratio: float = 1.0`, defaulted so direct-construction test sites keep working; TS: required field — fix any test literal `tsc` reports).
- Consumed by: `runLedger` / `run_ledger` via `schedule.lender_eligible_ratio`.

- [ ] **Step 1: Failing tests — the ineligible-package pair**

Fixture Q already carries one ineligible package (`pkg-externals`, 3,000,000p of a
47,000,000p base build) — so Q **is** the ineligible twin and its flipped copy is
the all-eligible base. TS, in `monthly-engine.test.ts`:
```ts
it('R14 §4.2(b): an ineligible package shrinks the advance cap and widens the gap', () => {
  const fixtureDir = resolve(__dirname, '../../../../fixtures/financial-model');
  const q = JSON.parse(readFileSync(join(fixtureDir, 'q-detailed-cost-plan.json'), 'utf-8')).inputs;
  expect(q.cost_plan.mode).toBe('detailed');
  const ineligible = q.cost_plan.packages.filter((p: { lender_eligible: boolean }) => !p.lender_eligible);
  expect(ineligible).toHaveLength(1);                     // pkg-externals, 3,000,000p
  const allEligible = structuredClone(q);
  for (const p of allEligible.cost_plan.packages) p.lender_eligible = true;

  // Q's facility is "comfortably sized" (its own note), so the smaller cap may never
  // bind there. Starve both twins of equity identically so the cap is what decides
  // the draw — the pair still differs ONLY in the flag.
  const starve = (doc: typeof q) => ({
    ...doc, equity_sources: [{ ...doc.equity_sources[0], amount_pence: 1 }],
  });
  const run = (doc: typeof q) => {
    const s = buildSchedule(doc);
    return { s, m: runLedger(s, doc.finance, doc.equity_sources) };
  };
  const base = run(starve(allEligible));
  const less = run(starve(q));
  expect(base.s.lender_eligible_ratio).toBe(1);
  expect(less.s.lender_eligible_ratio).toBeCloseTo(44 / 47, 12);
  expect(less.m.totals.draws_pence).toBeLessThan(base.m.totals.draws_pence);
  expect(less.m.totals.funding_gap_pence).toBeGreaterThan(base.m.totals.funding_gap_pence);
});
```
Python mirror in the engine test file. If the starved pair still shows no
difference (the advance cap at 100% of a scaled base can exceed `undrawn_net` or
`headroom_cap` so that those bind instead), lower `development_cost_advance_pct`
on **both** twins to 50 and say so in the report — never change only one side.

Run: `cd frontend && npx vitest run src/lib/model/monthly-engine.test.ts -t "ineligible"` — Expected: FAIL (`lender_eligible_ratio` undefined).

- [ ] **Step 1b: Decide what happens to Q and S before touching the engine**

Both Q and S carry `pkg-externals` with `lender_eligible: false`. Derive by hand,
for each, the month(s) where `round(construction_pence × ratio) + professional +
statutory` × `development_cost_advance_pct / 100` falls below the draw the
current engine makes (compare against `undrawn_net` and the gross headroom cap —
the draw is `min` of all three and the remainder). If the scaled cap never binds,
record that in the report with the binding term named per month, and expect every
Q and S pin unchanged. If it binds, hand-derive the moved pins (`draws`-dependent:
`peak_debt_pence`, `finance_costs_pence`, `total_development_cost_pence`,
`profit_pence` and ratios, `funding_gap_pence`, `cost_to_complete_*`,
`equity_contributed_pence`) from the scaled cap base and write them into the
fixture and its controls **before** Step 2 — never by running the code and
pasting. Q's note says its ledger pins were invariant-cross-checked, not
hand-replayed, in R10; this step is the first hand derivation of its cap base,
so budget for it.

- [ ] **Step 2: Compute and publish the ratio**

`cost-plan.ts` return object:
```ts
    lender_eligible_ratio: !detailed || baseBuild === 0 ? 1 : lenderEligibleBase / baseBuild,
```
(compute `lenderEligibleBase` once; `lender_eligible_base_pence` uses the same value). Python: `lender_eligible_ratio=1.0 if not detailed or base_build == 0 else lender_eligible_base / base_build`.

`schedule.ts`/`schedule.py`: `build_schedule` already holds `costPlan`/`cost_plan`; publish `lender_eligible_ratio: costPlan.lender_eligible_ratio` on the returned `Schedule`. Add the field to the `Schedule` interface/dataclass with a doc comment: "R14 spec §4.2(b). Computed once on the cost plan, republished here so the ledger reads one figure and never re-derives it."

- [ ] **Step 3: The cap base**

`monthly-engine.ts` (~line 171):
```ts
        // R14 spec §4.2(b): only lender-eligible construction cost is advanceable.
        // The ratio is the cost plan's eligible share of base build (1 in headline
        // mode); contingency and compliance follow it proportionally (§16.9).
        const eligible = Math.round(u.construction_pence * schedule.lender_eligible_ratio)
          + u.professional_pence + u.statutory_pence;
```
Keep the R11 VAT comment above it intact. Python: `eligible = money_round(u.construction_pence * schedule.lender_eligible_ratio) + u.professional_pence + u.statutory_pence`.

- [ ] **Step 4: Rewrite the two lying comments**

`types.py` `lender_eligible` comment → "R10 records this; R14 (calc 2.13.0) wires it: the ledger's §4.2(b) cap base scales the construction line by the cost plan's `lender_eligible_ratio`." Same for `apply_scenario.py:51` and the `CostPackage` doc comment in `finance-types.ts` (~line 42) and `cost-plan.ts` (~line 36).

- [ ] **Step 5: Run**

Run: `cd frontend && npx vitest run src/lib/model && npx tsc -b` and `pytest tests -q -k "cost_plan or engine or fixtures"`
Expected: PASS; every golden pin unchanged **except** any Q/S pin Step 1b hand-derived — if any other fixture's pin moved, a headline-mode or all-eligible path was touched; stop.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/model/cost-plan.ts frontend/src/lib/model/schedule.ts frontend/src/lib/model/monthly-engine.ts frontend/src/lib/model/finance-types.ts frontend/src/lib/model/*.test.ts app/financial_model/cost_plan.py app/financial_model/schedule.py app/financial_model/engine.py app/financial_model/types.py app/financial_model/apply_scenario.py tests/
git commit -m "feat(r14): lender_eligible wired to the development-cost advance cap as a ratio (spec 4.2b)"
```

---

## Task 4: Inputs v11 — types, calc version, §1.6

Implements spec **§6**'s schema.

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts` (after `CalculatorInputsV10`, ~line 331; `CALC_VERSION` last line)
- Modify: `app/financial_model/types.py` (after `CalculatorInputsV10`; `AnyCalculatorInputs`; `parse_calculator_inputs`; `CALC_VERSION`)
- Modify: `docs/financial-model/calculation-specification.md` §1.6 (~line 58)
- Modify: `app/models.py` (`FinancialAppraisalCreate` comment ~line 353)
- Test: `tests/test_financial_model_types.py`, `frontend/src/lib/model/spec-versions.test.ts`

**Interfaces (produced, used by every later task):**

```ts
export type MonitoringCategory = 'acquisition' | 'construction' | 'professional' | 'statutory' | 'contingency';
export const MONITORING_CATEGORIES: readonly MonitoringCategory[] =
  ['acquisition', 'construction', 'professional', 'statutory', 'contingency'];

export interface MonitoringLineInputs {
  category: MonitoringCategory;
  current_budget_pence: number;
  certified_to_date_pence: number;
  paid_to_date_pence: number;
  committed_to_date_pence: number;
  forecast_to_complete_pence: number;
}

export interface MonitoringInputs {
  reporting_month: number;
  reporting_date: string;          // ISO yyyy-mm-dd; printed only, never read by arithmetic
  lines: MonitoringLineInputs[];
  debt_drawn_to_date_pence: number;
  cash_equity_injected_to_date_pence: number;
  author: string;
  date: string;
  note: string | null;
}

export interface CalculatorInputsV11 extends Omit<CalculatorInputsV10, 'inputs_version'> {
  inputs_version: 11;
  monitoring: MonitoringInputs | null;
}
```
Python: `MonitoringCategory = Literal[...]`, `MONITORING_CATEGORIES` tuple, `class MonitoringLineInputs(Model)` with `Field(ge=0)` on the five pence fields, `class MonitoringInputs(Model)` with `reporting_month: int = Field(ge=1)`, `reporting_date: str = Field(min_length=1)`, `author: str = Field(min_length=1)`, `date: str = Field(min_length=1)`, `note: str | None = None`, `debt_drawn_to_date_pence: int = Field(ge=0)`, `cash_equity_injected_to_date_pence: int = Field(ge=0)`; `class CalculatorInputsV11(CalculatorInputsV10)` with `inputs_version: Literal[11] = 11  # type: ignore[assignment]` and `monitoring: MonitoringInputs | None = None`. Add `CalculatorInputsV11` to `AnyCalculatorInputs` (both engines) and a `version == 11` arm **first** in `parse_calculator_inputs` (R11 ruling R10 — without it a v11 document falls to the V2 default and silently drops `monitoring`).

- [ ] **Step 1: Failing tests**

`tests/test_financial_model_types.py`: `parse_calculator_inputs({..., "inputs_version": 11, "monitoring": {...}})` returns a `CalculatorInputsV11` whose `monitoring.lines[0].category == "acquisition"`; a v11 doc with `monitoring: None` parses; `reporting_month: 0` raises `ValidationError`. `spec-versions.test.ts` will fail on its own once `CALC_VERSION` moves until §1.6 is edited.

Run: `pytest tests/test_financial_model_types.py -q -k v11` — Expected: FAIL (`CalculatorInputsV11` undefined).

- [ ] **Step 2: Implement, bump `CALC_VERSION` to `'2.13.0'` / `"2.13.0"` in both engines**

- [ ] **Step 3: §1.6**

Append to the version list in §1.6: `` `11` (**inputs v11**) = calc 2.13.0+ (adds the top-level nullable `monitoring` block, §20) ``, and a paragraph: "Calc 2.13.0 (R14) corrects §5.10's remaining-funding term for rolled-up facilities (C1), wires `lender_eligible` into §4.2(b), and adds §20's monitoring statement. **It changes `cost_to_complete` on every rolled-up facility with an interest reserve** — the corrected figure; every other computed value on every existing document is identical (the v11 identity gate, `tests/test_migrate_v11.py`)." Edit `app/models.py`'s comment: "… a v11 document (R14, spec Sec 20) adds the top-level nullable `monitoring` block, defined on `MonitoringInputs` / `CalculatorInputsV11`."

- [ ] **Step 4: Run**

Run: `pytest tests/test_financial_model_types.py -q && cd frontend && npx vitest run src/lib/model/spec-versions.test.ts && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/finance-types.ts app/financial_model/types.py docs/financial-model/calculation-specification.md app/models.py tests/test_financial_model_types.py
git commit -m "feat(r14): inputs v11 types, calc 2.13.0, spec 1.6 (spec 20.1)"
```

---

## Task 5: Validation — §20.3's input rules (both engines)

Implements spec **§8**'s input-only rules. Before the migration (Task 6) so Task 6's property 3 has a rule that can fire.

**Files:**
- Modify: `frontend/src/lib/model/validation.ts`, `app/financial_model/validation.py`
- Test: `frontend/src/lib/model/validation.test.ts`, `tests/test_financial_model_validation.py` (locate by name)

**Interfaces:** consumes `CalculatorInputsV11.monitoring` (read structurally: `'monitoring' in inputs && inputs.monitoring != null`, the codebase's version-dispatch idiom). Produces issues with these exact field strings and messages:

| field | severity | message |
|---|---|---|
| `monitoring.reporting_month` | error | `reporting_month must be between 1 and the term (${term})` |
| `monitoring.lines` | error | `monitoring must carry exactly one line per category (acquisition, construction, professional, statutory, contingency)` |
| `monitoring.lines[${i}].paid_to_date_pence` | error | `paid to date cannot exceed certified to date` |
| `monitoring.lines[${i}].certified_to_date_pence` | error | `certified to date cannot exceed committed to date` |
| `monitoring.debt_drawn_to_date_pence` | error | `debt drawn to date cannot exceed the committed net facility` |
| `monitoring.cash_equity_injected_to_date_pence` | warning | `equity injected beyond committed cash sources` |

`term = max(1, Math.floor(inputs.finance.term_months))` — the same expression `buildSchedule` uses. Committed net for the debt rule: `0` when `funding_source === 'cash'`, else `committed_net_facility_pence ?? 0`. `cash_equity_total` = the §5.10 filter (cash, not rejected).

- [ ] **Step 1: Failing tests** — one per row above plus "a null `monitoring` adds no issue with a `monitoring` prefix" and "a valid block adds none". Build documents with `migrateInputsToV10(...)` on `fixtures/financial-model/l-retain-all.json` then spread `{ inputs_version: 11, monitoring: {...} }` (the v11 migration does not exist yet; a spread literal is fine for a validation test).

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts -t monitoring` — Expected: FAIL.

- [ ] **Step 2: Implement** a `validateMonitoring(inputs, issues)` helper in each engine, called from the main validator; it returns immediately when the block is absent or null.

- [ ] **Step 3: Run** both validation suites. Expected: PASS, and **no existing validation test changed**.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/model/validation.ts frontend/src/lib/model/validation.test.ts app/financial_model/validation.py tests/
git commit -m "feat(r14): monitoring input validation (spec 20.3)"
```

---

## Task 6: Migration v10 → v11 and the identity gates

Implements spec **§6**'s migration. **From this task until Task 14 the two entry-point guards are expected red** (Global Constraints).

**Files:**
- Modify: `frontend/src/lib/model/migrate.ts` (after `migrateInputsToV10`, ~line 1165), `app/financial_model/migrate.py` (after `migrate_inputs_to_v10`; `is_v2_or_later` ~line 317)
- Create: `tests/test_migrate_v11.py`
- Modify: `frontend/src/lib/model/migrate.test.ts`

**Interfaces:**
- Produces: `isV11` (module-private) / `is_v11`; `migrateV10toV11(v10: CalculatorInputsV10): CalculatorInputsV11`; `migrateInputsToV11(snapshot, project?)`; Python `migrate_v10_to_v11`, `migrate_inputs_to_v11(snapshot, project=None)`, `_RECOGNISED_VERSIONS_V11 = (1, …, 11)`.
- `isV11`: `snapshot.inputs_version === 11 && 'monitoring' in snapshot` — `monitoring` is a key on no earlier document, the same discriminator shape `isV10` uses.

- [ ] **Step 1: Failing tests** — port `tests/test_migrate_v10.py` to v11 wholesale, with these substitutions: the corpus filter reads `doc["inputs"]["inputs_version"] <= 10` (**`doc["inputs"]`, not the top level** — R13's vacuous-filter defect); the numeric identity excludes `calc_version` **and `monitoring_statement`** on the v11 side and compares v10 vs v11 metrics; property 2 asserts no issue field starts with `monitoring`; property 3 builds a v11 document with `reporting_month: 0` and asserts `monitoring.reporting_month` is among the issue fields; `test_migration_writes_only_null` asserts `v11.monitoring is None`; `is_v2_or_later` recognises v11; and the recognised-versions refusal uses a document tagged **12**. Numeric identity must also hold on **V** (stored v10, Task 2) — it is in the corpus, so the parametrisation covers it. TS twins in `migrate.test.ts`.

Run: `pytest tests/test_migrate_v11.py -q` — Expected: FAIL on import.

- [ ] **Step 2: Implement**, following `migrateV9toV10` / `migrate_v9_to_v10` and `migrateInputsToV10` / `migrate_inputs_to_v10` **line for line** (copy, then edit): the v11 pure step writes `monitoring: null` and stamps 11; the entry point's merge branch chains `migrateV10toV11(migrateV9toV10(…))` for defaults and carries `monitoring: saved.monitoring ?? null` (Python: `"monitoring": snapshot.get("monitoring")`) beside the `investment_case` line; the fallback is `migrateV10toV11(migrateInputsToV10(snapshot, project))`. Add `is_v11(snapshot)` to `is_v2_or_later`'s disjunction with the "fifth consecutive release" comment.

- [ ] **Step 3: Run** `pytest tests/test_migrate_v11.py tests/test_migrate_v10.py -q && cd frontend && npx vitest run src/lib/model/migrate.test.ts && npx tsc -b`. Expected: PASS. Then run the two entry-point guards and **confirm they are red** for the expected reason (production sites still name v10) — record that in the report.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/model/migrate.ts frontend/src/lib/model/migrate.test.ts app/financial_model/migrate.py tests/test_migrate_v11.py
git commit -m "feat(r14): v10->v11 migration, numeric identity gate and three validation properties (spec 20.1)"
```

---

## Task 7: The monitoring statement (TypeScript)

Implements spec **§7**.

**Files:**
- Create: `frontend/src/lib/model/monitoring.ts`, `frontend/src/lib/model/monitoring.test.ts`

**Interfaces:**
- Consumes: `Schedule` (`uses[]`, `term_months`), `MonthlyModel` (`months[]`, `committed_net_facility_pence`, `committed_gross_facility_pence`), `AnyCalculatorInputs` (`finance.interest_type`, `finance.funding_source`, `equity_sources`, `monitoring`), `CostPlanResult` (`base_build_pence`, `compliance_pence`, `contingency_total_pence`, `professional_total_pence`, `statutory_total_pence`).
- Produces:

```ts
export interface MonitoringStatementLine {
  category: MonitoringCategory;
  original_budget_pence: number;
  current_budget_pence: number;
  certified_to_date_pence: number;
  paid_to_date_pence: number;
  committed_to_date_pence: number;
  committed_not_certified_pence: number;
  forecast_to_complete_pence: number;
  estimated_final_cost_pence: number;
  variance_vs_original_pence: number;
  variance_vs_current_pence: number;
  remaining_to_spend_pence: number;
}
export interface MonitoringStatement {
  reporting_month: number;
  reporting_date: string;
  lines: MonitoringStatementLine[];           // always 5, in MONITORING_CATEGORIES order
  totals: Omit<MonitoringStatementLine, 'category'>;
  contingency_remaining_pence: number;
  undrawn_net_facility_pence: number;
  reserve_headroom_pence: number;
  remaining_cash_equity_pence: number;
  remaining_funding_pence: number;
  forecast_finance_pence: number;
  remaining_uses_pence: number;
  surplus_pence: number;
  shortfall_pence: number;
  debt_drawn_variance_pence: number;
  equity_injected_variance_pence: number;
  cost_to_date_variance_pence: number;
}
export function originalBudgets(schedule: Schedule, costPlan: CostPlanResult): Record<MonitoringCategory, number>;
export function computeMonitoringStatement(
  schedule: Schedule, model: MonthlyModel, inputs: AnyCalculatorInputs, costPlan: CostPlanResult,
): MonitoringStatement | null;   // null exactly when inputs has no non-null `monitoring`
```

Arithmetic (from the spec, restated so the implementer has it in one place; `m = reporting_month`):
- `originalBudgets`: `acquisition = Σ_k uses[k].acquisition_pence`; `construction = costPlan.base_build_pence + costPlan.compliance_pence`; `professional = costPlan.professional_total_pence`; `statutory = costPlan.statutory_total_pence`; `contingency = costPlan.contingency_total_pence`.
- line: `committed_not_certified = committed − certified`; `estimated_final = committed + forecast_to_complete`; `variance_vs_original = estimated_final − original`; `variance_vs_current = estimated_final − current_budget`; `remaining_to_spend = estimated_final − certified`.
- `contingency_remaining = max(0, current_budget(contingency) − certified(contingency))`.
- `undrawn_net_facility = max(0, model.committed_net_facility_pence − debt_drawn_to_date)` (committed net is already 0 for cash deals on the model).
- `reserve_headroom = rolled_up ? max(0, gross − net − Σ_{k≤m−1} months[k].interest_capitalised_pence) : 0`.
- `remaining_cash_equity = max(0, cash_equity_total − cash_equity_injected_to_date)`.
- `forecast_finance = Σ_{k=m}^{term−1} months[k].interest_accrued_pence + months[k].capitalised_fees_pence`.
- `remaining_uses = totals.remaining_to_spend + forecast_finance`; `surplus = remaining_funding − remaining_uses`; `shortfall = max(0, −surplus)`.
- `debt_drawn_variance = debt_drawn_to_date − Σ_{k≤m−1} (draw_pence + capitalised_fees_pence)`; `equity_injected_variance = cash_equity_injected_to_date − Σ_{k≤m−1} equity_contribution_pence`; `cost_to_date_variance = totals.certified − Σ_{k≤m−1} (acquisition + construction + professional + statutory)`.
- Lines are emitted in `MONITORING_CATEGORIES` order regardless of input order (validation guarantees one per category; the engine sorts, it does not validate).

- [ ] **Step 1: Failing tests** in `monitoring.test.ts`, built on fixture `l-retain-all.json` migrated with `migrateInputsToV11` then spread with a hand-written `monitoring` block at `reporting_month: 3`:
  1. returns `null` when `monitoring` is null;
  2. `lines` has length 5 in category order even when the input lists them reversed;
  3. every line's `estimated_final_cost_pence === committed + forecast` and `remaining_to_spend_pence === committed_not_certified + forecast_to_complete` (pure input arithmetic — exact integers you choose);
  4. **construction split identity** across every non-sensitivity fixture in the corpus: `originalBudgets(s, cp).construction + .contingency === Σ uses.construction_pence` (compute `costPlan` via `computeCostPlan(inputs, developedAreaSqm(inputs), units.length)` exactly as `schedule.ts` does — import `developedAreaSqm` from wherever `schedule.ts` imports it);
  5. **`reporting_date` is inert**: two statements differing only in `reporting_date` are deep-equal except for that field. *Watch it fail first*: temporarily make the engine add `reporting_date.length` to `surplus_pence`, see red, revert;
  6. funding reconciliation on a **serviced** document: `reserve_headroom_pence === 0` and `remaining_funding_pence === undrawn + remaining_cash_equity`;
  7. `shortfall_pence === Math.max(0, -surplus_pence)` on a block whose forecasts are set large enough to force a negative surplus (choose `forecast_to_complete_pence` of 10× the scheme's GDV on the construction line — state the reasoning in the test).

Run: `cd frontend && npx vitest run src/lib/model/monitoring.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement** `monitoring.ts` per the interfaces. No rounding anywhere. Export the input types from Task 4 via `finance-types.ts` (they already live there); `monitoring.ts` holds only result types and the two functions.

- [ ] **Step 3: Run** the suite + `npx tsc -b`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/model/monitoring.ts frontend/src/lib/model/monitoring.test.ts
git commit -m "feat(r14): monitoring cost-to-complete statement engine (spec 20.2)"
```

---

## Task 8: The Python mirror and fixture W

Implements spec **§7** in Python and authors the release's golden case (spec **§9**).

**Files:**
- Create: `app/financial_model/monitoring.py`, `tests/test_financial_model_monitoring.py`
- Create: `fixtures/financial-model/w-monitoring-on-site.json` (stored at **inputs v11**)
- Modify: `docs/financial-model/test-cases.md` (`### 20.2 Fixture W — monitoring on site`)

**Interfaces:** `compute_monitoring_statement(schedule, model, inputs, cost_plan) -> MonitoringStatement | None`, `original_budgets(schedule, cost_plan) -> dict[str, int]`, dataclasses `MonitoringStatementLine`, `MonitoringStatementTotals` (the line minus `category`), `MonitoringStatement` — field names identical to Task 7's.

- [ ] **Step 1: Port the seven tests** from Task 7 to pytest (same fixture, same block, same assertions).

Run: `pytest tests/test_financial_model_monitoring.py -q` — Expected: FAIL on import.

- [ ] **Step 2: Implement `monitoring.py`** as a line-for-line port.

- [ ] **Step 3: Design fixture W** (inputs; pins come from Step 4):
  - `inputs_version: 11`; detailed cost mode with three packages: `strip_out` 1,500,000p (eligible), `fit_out` 4,000,000p (eligible), `external_works` 500,000p (**`lender_eligible: false`**) → `lender_eligible_ratio = 5,500,000 / 6,000,000 = 0.91666…` (the fixture pins this as `0.9166666666666666`, the IEEE double of `11/12` — both engines must print exactly that); general contingency 10% on base build; one fixed professional fee 300,000p; one `prior_approval` statutory fee 20,000p.
  - purchase 20,000,000p, England, term 18, rolled-up 10% p.a., net facility 22,000,000p, reserve 1,500,000p, gross null, `development_cost_advance_pct: 70`, day-one 12,000,000p, arrangement fee 200,000p; cash equity 9,000,000p confirmed; single-tranche sale at term; GDV 45,000,000p from three units; `investment_case: null`; no programme network; VAT not registered.
  - `monitoring`: `reporting_month: 6`, `reporting_date: "2027-03-31"`, lines — acquisition current 20,400,000 / certified 20,400,000 / paid 20,400,000 / committed 20,400,000 / forecast 0; construction current 6,100,000 / certified 2,000,000 / paid 1,800,000 / committed 5,900,000 / forecast 400,000; professional 300,000 / 120,000 / 120,000 / 300,000 / 0; statutory 20,000 / 20,000 / 20,000 / 20,000 / 0; contingency 600,000 / 50,000 / 50,000 / 50,000 / 450,000; `debt_drawn_to_date_pence: 14,500,000`; `cash_equity_injected_to_date_pence: 8,000,000`; author "Monitoring surveyor", date "2027-04-02", note null.
  - The acquisition line's *original* budget is the model's acquisition cost — purchase price **plus** SDLT on 20,000,000p (read `fixtures/tax/acquisition-tax-tables.json`, never recall it) plus any acquisition fees you set; pick the current budget to equal it so the acquisition variance is 0 and the worksheet can show one category with a non-zero variance (construction: `5,900,000 + 400,000 − original`).

- [ ] **Step 4: Hand-derive the worksheet** in `test-cases.md` §20.2: the cost plan (`base_build`, contingency, ratio), the 18-month ledger with the **scaled cap base** shown per month, the statement's five lines and totals, the funding side's three terms at `m = 6`, `forecast_finance` from the ledger, surplus/shortfall, the three variances. Pins ⟨hand-derive⟩: `monitoring_shortfall_pence`, `monitoring_estimated_final_cost_pence`, `monitoring_surplus_pence`, `lender_eligible_ratio` (exact: `0.9166666666666666`), plus `gdv_pence`, `peak_debt_pence`, `funding_gap_pence`, `cost_to_complete_first_shortfall_month`, `cost_to_complete_max_shortfall_pence`. If the derivation shows the monitoring surplus is positive, that is fine — `shortfall` pins `0` and `surplus` carries the number; a statement with no shortfall is still the golden case for every other column.

- [ ] **Step 5: Run** `pytest tests/test_financial_model_monitoring.py -q`. The golden pins cannot be asserted until Task 9 adds the mappers; leave W in the corpus now so Task 6's identity gate (filter `<= 10`) **excludes** it and the corpus-count guard in `test_migrate_v11.py` must be raised by one for the exclusion bound — do that here, with the comment R13 used ("the v11-native fixture is covered by the golden suite instead").

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/monitoring.py tests/test_financial_model_monitoring.py fixtures/financial-model/w-monitoring-on-site.json docs/financial-model/test-cases.md tests/test_migrate_v11.py
git commit -m "feat(r14): monitoring statement Python mirror; fixture W authored and hand-derived (spec 20.2)"
```

---

## Task 9: Publish the statement, the three flags and the golden mappers

Implements spec **§8** (flags) and **§9** (outputs).

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts` (`FlagCode`; `AppraisalResultV2` after `investment_case`, ~line 686), `app/financial_model/types.py` (`FlagCode`), `app/financial_model/metrics.py` (`AppraisalResultV2` ~line 225; `derive_metrics` ~line 645)
- Modify: `frontend/src/lib/model/metrics.ts` (~lines 191, 410, 487)
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts` (`FLAT_KEYS`, controls), `tests/test_financial_model_fixtures.py` (`_FLAT_KEYS`, controls)
- Test: `frontend/src/lib/model/metrics.test.ts`, `tests/test_financial_model_metrics.py` (locate by name)

**Interfaces:**
- `AppraisalResultV2.monitoring_statement: MonitoringStatement | null` — computed **once** in `deriveMetrics` / `derive_metrics` from the `costPlan` it already holds (~`metrics.ts:191`, `metrics.py:405`) and the `model`; never recomputed by UI or memo.
- `FlagCode` gains `'monitoring_shortfall' | 'monitoring_cost_variance' | 'monitoring_dated_after_redemption'`.
- `FLAT_KEYS`: `monitoring_shortfall_pence: (r) => r.metrics.monitoring_statement?.shortfall_pence ?? null`, `monitoring_estimated_final_cost_pence: … totals.estimated_final_cost_pence`, `monitoring_surplus_pence: … surplus_pence`, `lender_eligible_ratio: (r) => r.metrics.cost_plan.lender_eligible_ratio` (verify `metrics.cost_plan` is the published `CostPlanResult`'s name on `AppraisalResultV2`; if it differs, use the real name and say so).

Flags (a `monitoringFlags(statement, model)` helper beside the R13 `investmentCaseFlags` helper in each engine; `[]` when the statement is null):
- `monitoring_shortfall`, red, `amount_pence: shortfall`, `month: reporting_month`, message `` `monitoring statement at month ${m}: remaining uses exceed remaining funding by ${shortfall}p` `` (Python f-string, same words).
- `monitoring_cost_variance`, amber, raised once if any line has `original_budget_pence > 0 && Math.abs(variance_vs_original_pence) * 20 > original_budget_pence` (i.e. > 5%, integer arithmetic — no float comparison), `amount_pence`: the largest such variance, message `` `${category} estimated final cost varies from the original budget by more than 5%` `` naming the category with the largest absolute variance.
- `monitoring_dated_after_redemption`, amber, when `reporting_month > lastRepaymentMonth` where `lastRepaymentMonth` = the largest `k` with `model.months[k].repayment_pence > 0` (**skip the flag when no month repays**), `amount_pence: null`, message `the monitoring statement is dated after the forecast redemption month`.

- [ ] **Step 1: Failing tests**: (a) W's golden pins in both suites with controls (pin ± 1 for pence; for the ratio, control `0.9166666666666667`); (b) a metrics test that a null-monitoring document publishes `monitoring_statement === null` and none of the three flags; (c) the shortfall flag fires on the Task 7 test-7 document with `amount_pence === statement.shortfall_pence`; (d) the variance flag fires on a block whose construction forecast doubles the original and names `construction`; (e) the dated-after-redemption flag fires when `reporting_month` exceeds the last repaying month and **not** when it equals it.

Run both golden suites — Expected: FAIL (mapper keys unknown / flags absent).

- [ ] **Step 2: Implement** in both engines. Python `AppraisalResultV2` gains `monitoring_statement: MonitoringStatement | None`; `derive_metrics` calls `compute_monitoring_statement(schedule, model, inputs, cost_plan)` and appends `monitoring_flags(...)` after the R13 flags.

- [ ] **Step 3: Run** `cd frontend && npx vitest run src/lib/model && npx tsc -b` and `pytest tests -q --ignore=tests/test_entry_point_guard.py`. Expected: PASS; W's four pins agree across engines to the penny.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/model app/financial_model tests fixtures/financial-model/w-monitoring-on-site.json
git commit -m "feat(r14): monitoring_statement published, three flags, fixture W pinned in both engines (spec 20.4)"
```

---

## Task 10: The monitoring editor

Implements spec **§9**'s Finance-page editor.

**Files:**
- Create: `frontend/src/components/calculator/MonitoringEditor.tsx`, `MonitoringEditor.test.tsx`
- Modify: `frontend/src/components/calculator/FinancePage.tsx` (below `LenderValuationCard`, ~line 368; `Props.onChange` type moves to `Partial<CalculatorInputsV11>`)

**Interfaces:**
```ts
interface Props {
  monitoring: MonitoringInputs | null;
  termMonths: number;
  issues: ValidationIssue[];      // filtered by the parent to field.startsWith('monitoring') — same idiom as LenderValuationCard
  onChange: (m: MonitoringInputs | null) => void;
}
export default function MonitoringEditor(props: Props): JSX.Element;
```
Behaviour: when `monitoring` is null, a single button "Add monitoring statement" creates a block with `reporting_month: 1`, `reporting_date: ''`, five zeroed lines in `MONITORING_CATEGORIES` order, both cumulative figures 0, `author: ''`, `date: ''`, `note: null`. When non-null: `reporting_month` (number input, `min=1 max=termMonths`), `reporting_date` (date input), a five-row table with five pence inputs per row (reuse `FinancePage`'s `PenceRow` pattern — extract it to a shared module if it is not already exported, rather than copying it), the two cumulative pence inputs, author/date/note, a "Remove monitoring statement" button that calls `onChange(null)`. Issues render inline under the field they name. **No arithmetic** — the editor never sums or compares.

- [ ] **Step 1: Failing tests** (`@testing-library/react`, as the sibling `*.test.tsx` files do): renders the add button when null; clicking it calls `onChange` with five lines in category order; editing the construction row's certified input calls `onChange` with that pence value and nothing else changed; remove calls `onChange(null)`; an issue with field `monitoring.lines[1].paid_to_date_pence` renders beside the construction row.

- [ ] **Step 2: Implement; mount in `FinancePage`** with `issues={run.validation.issues.filter(i => i.field.startsWith('monitoring'))}` — locate how `LenderValuationCard` receives its issues and mirror it exactly; `termMonths = Math.max(1, Math.floor(inputs.finance.term_months))`. Widening `Props.onChange` to `Partial<CalculatorInputsV11>` will ripple to `ConversionCalculator.tsx`'s state type — widen the **type** there, but **do not** change its migration call (Task 14).

- [ ] **Step 3: Run** `cd frontend && npx vitest run src/components/calculator/MonitoringEditor.test.tsx src/components/calculator/FinancePage.test.tsx && npx tsc -b && npm run lint -- --max-warnings 0`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components
git commit -m "feat(r14): monitoring statement editor on the Finance page (spec 20.4)"
```

---

## Task 11: The statement card and the headroom column

**Files:**
- Create: `frontend/src/components/calculator/MonitoringStatementCard.tsx`, `MonitoringStatementCard.test.tsx`
- Modify: `frontend/src/components/calculator/CostToCompleteCard.tsx`, `CostToCompleteCard.test.tsx`
- Modify: `frontend/src/components/calculator/AppraisalSummaryPage.tsx` (after `<CostToCompleteCard …/>`, ~line 285)

**Interfaces:** `MonitoringStatementCard({ statement }: { statement: MonitoringStatement | null })` — renders nothing (returns `null`) when the statement is null; otherwise a heading "Monitoring cost-to-complete — month {m} ({reporting_date})", the five-line table with the twelve columns (`penceToPounds` for money; sign shown on variances), a totals row, then a "Funding reconciliation" list: undrawn net facility, reserve headroom, remaining cash equity, remaining funding, forecast finance, remaining uses, surplus — and a red line "Shortfall £…" only when `shortfall_pence > 0`; then the three variances with the legend "positive = more than the inception plan". `CostToCompleteCard`'s month table gains a "Reserve headroom" column reading `remaining_interest_reserve_headroom_pence`.

- [ ] **Step 1: Failing tests**: card returns null on null; renders five category rows in order and the totals row from a hand-built `MonitoringStatement` literal; shows the shortfall line iff `shortfall_pence > 0`; `CostToCompleteCard` renders the headroom column value.

- [ ] **Step 2: Implement; mount** `<MonitoringStatementCard statement={metrics.monitoring_statement} />` in `AppraisalSummaryPage`.

- [ ] **Step 3: Run** the two component suites + `tsc -b` + lint. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/calculator
git commit -m "feat(r14): monitoring statement card; reserve-headroom column on cost-to-complete (spec 20.4)"
```

---

## Task 12: The memo section and the report-QA assertion

Implements spec **§9**'s memo and §13.4 claim.

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts` (after the `'Cost to Complete'` sub-heading block, ~line 1812)
- Modify: `frontend/src/lib/export-investment-memo.test.ts`
- Modify: `frontend/src/lib/report-qa/` — the suite that walks every fixture (locate `memo-release-gate.test.ts` / the fixture-walking describe) and `report-qa/memo-fixtures.ts` if a monitoring fixture document is needed there

**Interfaces:** reads `metrics.monitoring_statement` only.

- [ ] **Step 1: Failing tests**: (a) on every existing report-QA fixture the text "Monitoring cost-to-complete" is **absent**; (b) on a run built from fixture W (`migrateInputsToV11` on its `inputs`, via `memo-fixtures.ts`'s existing builder pattern) the section is present, prints "month 6", "2027-03-31", the author, the estimated-final-cost total, and the sentence "Interest and capitalised fees from the reporting month onward are the inception forecast; certified and committed figures are as entered by the sponsor and have not been verified by a monitoring surveyor." (exact text — §13.4).

- [ ] **Step 2: Implement**: `subHeading(y, 'Monitoring cost-to-complete')`, an `autoTable` of the five lines + totals (columns: Category, Original, Current, Certified, Committed, Forecast, Est. final, Var. vs original), a `bodyText` funding reconciliation (one sentence per term), the shortfall sentence only when `> 0`, the provenance line (`reporting_date`, author, date), the §13.4 sentence. Use `ensureSpace` before the table exactly as the neighbouring sections do (R7's keep-together rule).

- [ ] **Step 3: Run** `cd frontend && npx vitest run src/lib/export-investment-memo.test.ts src/lib/report-qa && npx tsc -b`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-investment-memo.test.ts frontend/src/lib/report-qa
git commit -m "feat(r14): memo prints the monitoring statement only when present (spec 20.4, 13.4)"
```

---

## Task 13: Specification and documentation

**Files:**
- Modify: `docs/financial-model/calculation-specification.md`
- Modify: `docs/financial-model/migration-notes.md`, `docs/financial-model/test-cases.md`
- Modify: `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`

- [ ] **Step 1: §5.10 rewrite.** Replace the definition paragraph's remaining-funding sentence with the three-term formula from spec §4 (net undrawn + reserve headroom for rolled-up + uncontributed cash equity), mark the heading `[R2 — calc 2.1.0; corrected R14 — calc 2.13.0]`. Keep "Known limitation (calc 2.1.0)" with its first two counter-examples. **Replace** the "Third counter-example" paragraph with a closed record: the defect in one line, "closed in R14 (calc 2.13.0) by crediting the unconsumed interest reserve", fixture P now pins `null` / `0` with the old figures as negative controls, fixture V pins the real exhausted-reserve shortfall, and the rejected correction and why (spec decision 2).

- [ ] **Step 2: §4.2(b)** gains: "`development_cost_advance_pct` × (`lender_eligible_ratio` × construction + professional + statutory) [R14 — calc 2.13.0; before it the construction line was taken whole]." **§16.2, §16.8, §16.9**: rewrite each "recorded, not wired" sentence to say wired in calc 2.13.0, and §16.8's output list gains `lender_eligible_ratio`.

- [ ] **Step 3: §13.3** — the banner table gains `| VAT basis unconfirmed | DRAFT - VAT BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE |` between the tax row and the approval row; the "all four hold" sentence becomes five, with the VAT condition inserted as 4 and approval as 5, annotated `[R11 — calc 2.10.0; the table row was missing until R14]`. Verify the banner string against `report-provenance.ts`'s actual text before writing it.

- [ ] **Step 4: §20** — `## 20. Monitoring cost-to-complete [R14 — calc 2.13.0]` with `### 20.1 The schema`, `### 20.2 The statement`, `### 20.3 Validation and flags`, `### 20.4 Outputs and reporting`, `### 20.5 Stated limitations`, `### Guards this release must watch fail` — transcribed from spec §6–§11, in the spec's register (normative, present tense), with the construction-split identity stated and the six limitations listed.

- [ ] **Step 5: `migration-notes.md`** gains `## 14. v10 → v11 (Release 14, calc 2.13.0)` with `### 14.1 The identity claim, and where it is tested` (one written null; `tests/test_migrate_v11.py`; the C1 correction is the **one** computed value that moves, on rolled-up reserved facilities only, and is not a migration effect) and `### 14.2 The York appraisal after R14`. `test-cases.md` §20 gains `### 20.3 The corpus implication after C1` (exclusion list empty on purpose).

- [ ] **Step 6: The release plan** — R14's row becomes "§5.10 corrected (C1), monitoring cost-to-complete statement, `lender_eligible` wired — inputs v11, calc 2.13.0 — **DONE, shipped**"; a new **R14b** row: "Lender case governance: locked lender snapshot, reviewer, approval state, stale detection, change log (audit §7.3, §7.10) — P1 — new table + API, Python governance twin, `audit_hash` input set extended"; C1's entry is annotated "**closed in R14**" with a pointer to §5.10. Add an "R14 status" paragraph below the table in the pattern of R10's and R13's.

- [ ] **Step 7: Run** `cd frontend && npx vitest run src/lib/model/spec-versions.test.ts` and grep the spec for "recorded but not wired", "not wired to the draw cap", "Third counter-example" — none may remain.

- [ ] **Step 8: Commit**

```bash
git add docs
git commit -m "docs(r14): spec 5.10 rewritten, 4.2b/16 wired, 13.3 VAT row, spec 20, migration notes, release plan R14/R14b"
```

---

## Task 14: The entry-point cutover

**Files:**
- Modify: `frontend/src/lib/model/index.ts` (barrel: export `migrateV10toV11`, `migrateInputsToV11`)
- Modify: `frontend/src/components/ExportPage.tsx` (lines ~9, 103, 135), `frontend/src/components/ConversionCalculator.tsx` (~3, 163, 260)
- Modify: `app/api/app.py` (import ~line 24; call ~line 477; the comment block ~546–556)
- Modify: `tests/test_entry_point_guard.py` (`assert NEWEST == 10` → `11`)
- Modify: `tests/test_upsert_endpoints.py`, `tests/test_appraisal_governance.py`, `frontend/src/lib/model/entry-point-guard.test.ts` wherever a v10 expectation is pinned
- Modify: `frontend/src/lib/model/__fixtures__/investment-case-docs.ts`, `frontend/src/lib/report-qa/memo-fixtures.ts`, `tests/fixtures_investment_case.py` — move to v11 too (they are exempt from the guard but must produce current-version documents)

- [ ] **Step 1: Run both guards and read the failure** — every production site still names v10. That is the red you have been carrying since Task 6.

- [ ] **Step 2: Move every call site in one commit.** `app.py`: `from app.financial_model.migrate import is_v2_or_later, migrate_inputs_to_v11`; `inputs = migrate_inputs_to_v11(raw)`; update the comment to say v11. **Do not touch** the `"inputs_version": inputs.inputs_version` line — it derives; confirm by reading it.

- [ ] **Step 3: The governance proof.** `tests/test_appraisal_governance.py` (and `test_upsert_endpoints.py`): the POST-through-the-server test asserts the stored row's `inputs_version == 11` and that `audit_hash` recomputed with `11` matches — extend the R13 v10-arm test to v11 rather than replacing it. TS: `entry-point-guard.test.ts`'s enumerated-file list and any `migrateInputsToV10` mention in its comments.

- [ ] **Step 4: The full gate.**

```bash
cd frontend && npx vitest run && npx tsc -b && npm run lint -- --max-warnings 0 && npm run build && cd .. && pytest -q
```
Expected: all green; vitest > 2588, pytest > 2195. Record the counts.

- [ ] **Step 5: Commit**

```bash
git add frontend/src app tests
git commit -m "feat(r14): move every entry point to inputs v11 (spec 20.1)"
```

---

## Post-implementation checklist

- [ ] Fixture P: `null` / `0` pinned; controls are the old phantom figures.
- [ ] Fixture V: positive shortfall, `funding_gap_pence > 0`; the rejected-correction comparison is in the task report.
- [ ] Fixture W: four R14 pins agree in both engines to the penny; `lender_eligible_ratio` prints `0.9166666666666666` in both.
- [ ] Every pre-existing golden pin unchanged except P's two and any Q/S pin Task 3 Step 1b hand-derived (with the worksheet in the task report).
- [ ] `grep -rn "R14 wires it\|not wired to the draw cap\|Third counter-example" app frontend/src docs` returns nothing.
- [ ] Both entry-point guards green; `NEWEST == 11`.
- [ ] `git ls-files --eol` shows `i/lf` on every new file.
- [ ] Memory file for R14 written; release plan shows R14 done and R14b scheduled.
