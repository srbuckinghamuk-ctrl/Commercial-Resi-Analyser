# Release 2b — Lender Metrics + Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four `[R2]` spec metrics (lender GDV §3.2, senior repayment break-even §5.11, developer profit break-even §5.12, cost-to-complete §5.10) plus correctness hygiene, in both engines, with hand-derived fixtures and an inputs v2→v3 migration.

**Architecture:** New optional `lender_valuation` input block and `finance.enforcement_cost_assumption_pence` field drive valuation-layer metrics that never touch the monthly ledger; two bisection solvers and a cost-to-complete series read the existing ledger outputs. Every formula change lands as spec amendment + hand-derived fixture + TypeScript (`frontend/src/lib/model/`) + Python (`app/financial_model/`) in one task. `CALC_VERSION` bumps 2.0.0 → 2.1.0 (additive metrics, no change to existing pinned values).

**Tech Stack:** TypeScript (vitest), Python 3.12 (pytest), shared JSON fixtures in `fixtures/financial-model/`, FastAPI server recalculation, React UI.

## Global Constraints

- Governance (`docs/financial-model/model-governance.md`): never change a formula without amending `docs/financial-model/calculation-specification.md`, the hand-derived fixtures, and BOTH engines in the same task. Fixture values are hand-derived on a written worksheet BEFORE implementation (TDD RED uses the worksheet number).
- A metric that cannot be computed is `null` and renders "not available" — never a substitute formula (spec §11). Lender-basis metrics are `null` until `lender_valuation` is set; they never silently default to developer GDV (spec §3.2).
- Existing pinned values must not move: fixtures A/F `expected_metrics`, ledger fixtures B–F, and every currently green test stay green at every commit. New metrics are additive.
- Gates at every commit: `python -m pytest -q` (repo root); before release end: `cd frontend && npx vitest run`, `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint .`, `npm run build` (deps: `npm install --legacy-peer-deps`).
- Percent formatting uses the existing `pct()` helper (2 dp, null on zero denominator). Money rounding uses the engines' existing round-half-up helpers (`money_round` in Python; `Math.round` semantics in TS where already used).
- Never use bare `git stash`. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Design source: `docs/superpowers/specs/2026-08-13-release-2-design.md` §R2b. Two additions beyond that design, both from the R2a UAT record (`docs/reviews/2026-08-13-release-2a-uat.md`): Task 9 (fail-fast boot surfacing) and Task 10 (browser-visual UAT pass).

## File Structure

- `frontend/src/lib/model/finance-types.ts` — v3 types (Task 1); result-type additions (Tasks 3–6)
- `frontend/src/lib/model/migrate.ts` / `app/financial_model/migrate.py` — v2→v3 migration (Task 2)
- `frontend/src/lib/model/lender-valuation.ts` / `app/financial_model/lender_valuation.py` — NEW: lender GDV + variance (Task 3)
- `frontend/src/lib/model/breakeven.ts` / `app/financial_model/breakeven.py` — NEW: both break-even solvers (Tasks 4–5)
- `frontend/src/lib/model/cost-to-complete.ts` / `app/financial_model/cost_to_complete.py` — NEW: CTC series (Task 6)
- `frontend/src/lib/model/metrics.ts` / `app/financial_model/metrics.py` — wire new metrics into the result (Tasks 3–6)
- `fixtures/financial-model/g-lender-valuation.json` — NEW golden fixture (Task 3, extended 4–6)
- `docs/financial-model/calculation-specification.md`, `docs/financial-model/test-cases.md` — amended per task
- UI: `frontend/src/` appraisal pages (Task 8; follow existing inline-style patterns — the frontend has zero Tailwind classNames by project convention)

---

### Task 1: Spec amendments + v3 input types (both engines)

**Files:**
- Modify: `docs/financial-model/calculation-specification.md` (§2 inputs, §3.2, §5.10–§5.12 markers, §1.1 rounding rule, §6 note)
- Modify: `frontend/src/lib/model/finance-types.ts`
- Modify: `app/financial_model/types.py`
- Test: existing type-checking gates (tsc, pytest import) — no new test file in this task; validation tests come with Task 2's migration tests.

**Interfaces (produced — later tasks rely on these exact names):**

```ts
// finance-types.ts
export type LenderAdjustmentBasis =
  | 'global_pct' | 'global_per_sqft' | 'unit_type' | 'per_unit' | 'fixed_amount';

export interface LenderValuation {
  basis: LenderAdjustmentBasis;
  /** basis-dependent value:
   *  global_pct: percentage adjustment applied to every unit's developer value (e.g. -10)
   *  global_per_sqft: pence per sq ft applied to every unit's area (replaces unit value)
   *  fixed_amount: total lender GDV in pence (single figure, replaces the sum)
   */
  global_value: number | null;
  /** unit_type basis: map unit type -> pct adjustment; per_unit basis: map unit id -> lender value pence */
  per_key_values: Record<string, number> | null;
  /** Required provenance (spec §3.2: variance displayed with reason/author/date). */
  reason: string;
  author: string;
  date: string; // ISO yyyy-mm-dd
}

export interface CalculatorInputsV3 {
  inputs_version: 3;
  // ...all CalculatorInputsV2 fields unchanged, plus:
  lender_valuation: LenderValuation | null;
}
// FacilityTerms gains: enforcement_cost_assumption_pence: number;  // default 0, >= 0
export const CALC_VERSION = '2.1.0';
```

Python `types.py` mirrors this with a `LenderValuation` pydantic model (same field names; `basis: Literal[...]`; `ge=0` on `enforcement_cost_assumption_pence`; `reason`/`author`/`date` required non-empty when the block is present).

- [ ] **Step 1: Amend the spec** — in `calculation-specification.md`:
  - §2 (inputs): add the `lender_valuation` block (fields exactly as the interface above, with the basis semantics) and `finance.enforcement_cost_assumption_pence` (integer pence ≥ 0, default 0, "disclosed as an assumption wherever §5.11 is reported").
  - §3.2 marker `[R2]` → `[R2 — implemented in calc 2.1.0]`; same for §5.10, §5.11, §5.12.
  - §5.10: replace "Defined here; implemented with the dated programme" with "Implemented on the straight-line schedule (calc 2.1.0); re-derived when the dated programme lands (R3)".
  - §1.1: add the fractional-area rounding rule: "`base = round_half_up(construction_cost_per_sqm_pence × total_construction_sqm)` — the product is rounded to integer pence in one step, before contingency."
  - Header version note: calc `2.1.0`, with a one-line changelog entry (additive metrics; no existing formula changed).
- [ ] **Step 2: TS types** — apply the interface above to `finance-types.ts`: add `LenderAdjustmentBasis`, `LenderValuation`, `CalculatorInputsV3` (keep `CalculatorInputsV2` exported for the migration), add `enforcement_cost_assumption_pence: number` to `FacilityTerms`, bump `CALC_VERSION` to `'2.1.0'`. Add to `AppraisalResultV2` (keep the exported name; it is the result shape, not the input version): `lender_gdv_variance_pence: number | null; lender_gdv_variance_pct: number | null;` (next to the existing `lender_gdv_pence`), plus placeholders wired in Tasks 4–6: `senior_breakeven_pence: number | null; senior_breakeven_pct_of_lender_gdv: number | null; senior_breakeven_fall_from_lender_gdv_pct: number | null; developer_breakeven_pence: number | null; cost_to_complete: CostToCompleteSummary | null;` and
  ```ts
  export interface CostToCompleteSummary {
    first_shortfall_month: number | null;
    max_shortfall_pence: number;
    months: { month: number; remaining_cost_pence: number; remaining_funding_pence: number; surplus_pence: number }[];
  }
  ```
- [ ] **Step 3: Python types** — mirror exactly in `app/financial_model/types.py` (pydantic): `LenderValuation`, `inputs_version: Literal[3]` on the top model (rename/alias so the migration in Task 2 owns v2 acceptance), `enforcement_cost_assumption_pence: int = Field(0, ge=0)`, result-dataclass fields matching Step 2 (snake_case identical), `CALC_VERSION = "2.1.0"`.
- [ ] **Step 4: Make both engines compile/import with the new fields defaulted** — `deriveMetrics`/`derive_metrics` set every new result field to `null`/`None` for now (wired in Tasks 3–6). Run `npx tsc -p tsconfig.app.json --noEmit` and `python -m pytest -q` — the fixture suites will fail if any existing pinned value moved; they must all pass (new fields are additive).
- [ ] **Step 5: Commit** — `feat: calc 2.1.0 spec + v3 input types (lender valuation, enforcement assumption)`

---

### Task 2: v2→v3 migration + server acceptance (both engines, fixture JSONs to v3)

**Files:**
- Modify: `frontend/src/lib/model/migrate.ts`, `frontend/src/lib/model/migrate.test.ts`
- Modify: `app/financial_model/migrate.py`, `app/api/app.py` (version acceptance), `tests/test_appraisal_governance.py` (or new `tests/test_migrate_v3.py`)
- Modify: `fixtures/financial-model/a-all-cash.json`, `f-dev-finance-12mo.json` (inputs to v3 shape)
- Modify: `docs/financial-model/migration-notes.md` (new §5: v2→v3)

**Interfaces:**
- Consumes: Task 1's types.
- Produces: `migrateV2toV3(v2: CalculatorInputsV2): CalculatorInputsV3` (TS) / `migrate_v2_to_v3(doc: dict) -> dict` (Py); `isV3`/`is_v3` predicates; server chain `v1 → v2 → v3`.

- [ ] **Step 1: Write failing migration tests** — four hand-written unit cases per language, mirrored (this also closes the "no shared migration-mapping fixture" gap for v2→v3; v1→v2 porting is Task 7):
  1. minimal v2 doc → v3: `lender_valuation === null`, `finance.enforcement_cost_assumption_pence === 0`, every other field byte-identical, `inputs_version === 3`;
  2. idempotence: migrating an already-v3 doc is rejected by `migrateV2toV3` (precondition) and `isV3` returns true;
  3. v1 doc → full chain (existing v1 fixture case from `migrate.test.ts` reused): ends at v3 with both new fields defaulted AND the v1 flags (`requires_confirmation: true`, synthetic equity) intact;
  4. a v2 doc that already (illegally) carries a `lender_valuation` key is still stamped to a valid v3 (block passed through unchanged, then validated by the type layer).
- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/model/migrate.test.ts`, `python -m pytest tests/ -k migrate -q`.
- [ ] **Step 3: Implement both migrations** — pure functions; TS and Python line-for-line equivalents (follow the existing v1→v2 style in each file, including the `??`-vs-`or` guard noted in migration-notes §1).
- [ ] **Step 4: Server acceptance** — in `app/api/app.py` `calculate_authoritative`: `was_v1 = not migrate.is_v2_or_later(raw)`; chain migrations to v3 before validation; **status rule unchanged**: `legacy_unreconciled` only when the document was v1-shaped; a v2 document migrating to v3 keeps the normal `reconciled`/`draft` outcome (design §B1: outputs unchanged when the block is absent).
- [ ] **Step 5: Update the two golden fixture JSONs** — set `inputs.inputs_version: 3`, `inputs.lender_valuation: null`, `inputs.finance.enforcement_cost_assumption_pence: 0`. `expected_metrics` values DO NOT change (worksheet note in `test-cases.md`: additive-only proof = suites green with identical pinned numbers).
- [ ] **Step 6: migration-notes.md §5** — short section: what v3 adds, defaults, hash consequence (input_hash of every re-saved row changes because the payload gains two fields — expected, benign, status preserved; rows are re-hashed on next save exactly like any edit).
- [ ] **Step 7: Full gates** — `python -m pytest -q` and `npx vitest run` all green.
- [ ] **Step 8: Commit** — `feat: inputs v3 migration (lender_valuation, enforcement assumption) in both engines`

---

### Task 3: Lender-underwritten GDV §3.2 + variance bridge + fixture G (both engines)

**Files:**
- Create: `frontend/src/lib/model/lender-valuation.ts`, `app/financial_model/lender_valuation.py`
- Create: `fixtures/financial-model/g-lender-valuation.json`
- Modify: `metrics.ts` / `metrics.py` (wire `lender_gdv_pence`, `ltgdv_lender_pct`, variance fields)
- Modify: `validation.ts` / `validation.py` (hard errors)
- Test: `frontend/src/lib/model/lender-valuation.test.ts`, golden suites both languages, `tests/test_financial_model_fixtures.py`
- Modify: `docs/financial-model/test-cases.md` (§2: fixture G entry + worksheet)

**Interfaces:**
- Produces:
  ```ts
  export interface LenderGdvResult { lender_gdv_pence: number; unit_values_pence: number[]; }
  export function computeLenderGdv(inputs: CalculatorInputsV3): LenderGdvResult | null; // null when block absent
  ```
  Python: `compute_lender_gdv(inputs) -> LenderGdvResult | None`, same field names.

**Semantics (from spec §3.2 as amended in Task 1):**
- `global_pct`: each lender unit value = `round_half_up(dev_value × (1 + global_value/100))`.
- `global_per_sqft`: lender unit value = `round_half_up(global_value × unit.floor_area_sqm × 10.7639)` (sqm→sqft, the codebase's existing conversion constant — check `conversion-types`/`commercial-sdlt` area helpers and reuse the existing constant; if none exists, define `SQFT_PER_SQM = 10.7639` in one shared place per language).
- `unit_type`: pct adjustment per unit type from `per_key_values[unit.type]`; a unit whose type has no entry keeps its developer value (documented in spec).
- `per_unit`: absolute pence per unit id; a missing id is a hard validation error (partial per-unit valuation is ambiguous).
- `fixed_amount`: `lender_gdv_pence = global_value` directly; `unit_values_pence = []`.
- `lender_gdv_pence = Σ unit values` (except fixed_amount). Variance: `lender_gdv_variance_pence = lender_gdv − developer_gdv`; `lender_gdv_variance_pct = pct(variance, developer_gdv)`.
- Validation hard errors (mirror both languages, same messages): lender unit value ≤ 0; `fixed_amount`/`global_value` null when required by basis; empty `reason`/`author`/`date` when block present; per_unit id missing.
- `ltgdv_lender_pct = pct(peak_debt_pence, lender_gdv_pence)`, null when block absent.

- [ ] **Step 1: Worksheet + fixture G** — create `g-lender-valuation.json` as a copy of fixture F with `lender_valuation = { basis: "global_pct", global_value: -10, per_key_values: null, reason: "Fixture: lender haircut for valuation-basis testing", author: "governance", date: "2026-08-13" }`. Hand-derivation (record in `test-cases.md` §2):
  - dev unit values: 4 × 30,000,000p → dev GDV 120,000,000p (already pinned by F);
  - lender unit value: round(30,000,000 × 0.90) = 27,000,000p; lender GDV = **108,000,000p**;
  - variance = **−12,000,000p**, variance pct = **−10.00**;
  - ltgdv_lender = pct(58,604,953, 108,000,000) = **54.26** (peak debt is unchanged by valuation — assert equal to F's pinned 58,604,953);
  - every other `expected_metrics` key copied verbatim from F (the block must not move the ledger).
  Add all of these to fixture G's `expected_metrics` (including `lender_gdv_pence`, `lender_gdv_variance_pence`, `lender_gdv_variance_pct`, `ltgdv_lender_pct`).
- [ ] **Step 2: Write failing tests** — unit tests in `lender-valuation.test.ts` for each basis (small inline inputs, hand-computed expectations: e.g. per_unit map, unit_type partial map, fixed_amount, per-unit missing id → error) + fixture G wired into both golden suites (TS `golden-fixtures.test.ts` and Python `test_golden_fixture_parity` discover fixtures by directory glob — verify they auto-discover G; if the fixture list is explicit, add G to both).
- [ ] **Step 3: RED** — run both suites; fixture G fails on the new keys.
- [ ] **Step 4: Implement** — `lender-valuation.ts` then `lender_valuation.py` (transliterate; same function/field names, same rounding helper).
- [ ] **Step 5: GREEN + invariants** — both golden suites green; add invariant to both invariant suites: for every fixture, `lender_gdv_pence === null ⇔ inputs.lender_valuation === null`, and when present `ltgdv_lender_pct` uses lender GDV (recompute in the test).
- [ ] **Step 6: Full gates, commit** — `feat: lender-underwritten GDV with variance bridge (spec 3.2) in both engines`

---

### Task 4: Senior repayment break-even §5.11 (both engines)

**Files:**
- Create: `frontend/src/lib/model/breakeven.ts`, `app/financial_model/breakeven.py`
- Modify: `monthly-engine.ts` / `engine.py` — expose `redemption_balance_at_disposal_pence` (see Step 1)
- Modify: `metrics.ts` / `metrics.py`
- Modify: `fixtures/financial-model/g-lender-valuation.json` (add the three §5.11 keys), `docs/financial-model/test-cases.md`
- Test: `frontend/src/lib/model/breakeven.test.ts`, golden suites

**Interfaces:**
- Consumes: ledger outputs (`MonthlyModel`), exit-fee terms, `exit_strategy` selling-cost terms, `finance.enforcement_cost_assumption_pence`.
- Produces:
  ```ts
  export interface SeniorBreakevenTerms {
    redemption_balance_pence: number;   // senior balance at disposal, pre-receipt
    exit_fee_pence: number;             // fee due on redemption at disposal
    selling_agent_fee_pct: number;
    selling_legal_fee_pence: number;
    enforcement_cost_assumption_pence: number;
  }
  export function solveSeniorBreakeven(t: SeniorBreakevenTerms): number | null;
  ```
  Python identical (`solve_senior_breakeven`). Returns the minimum integer `P` (pence) satisfying `P ≥ redemption + exit_fee + disposal_costs(P) + enforcement`, where `disposal_costs(P) = round_half_up(P × selling_agent_fee_pct/100) + selling_legal_fee_pence`; `null` on non-convergence.
- MonthlyModel gains `redemption_balance_at_disposal_pence: number | null` — the disposal month's senior balance immediately before sale receipts are applied (null for cash deals / no disposal). **This is read from ledger state the engine already computes; adding the field must not change any existing pinned ledger value — assert by the untouched B–F suites.**

**Solver (write exactly this, both languages):** bisection on integer pence. `lo = redemption + exit_fee + enforcement + legal` (fee floor), `hi = ceil((redemption + exit_fee + enforcement + legal) / (1 − pct/100)) + 100` (closed-form guess + slack; guard `pct >= 100` → return null with a red validation flag "agent fee ≥ 100% — break-even unsolvable"). While `lo < hi`: `mid = (lo+hi)>>1` (Py: `//2`); feasible(mid) → `hi = mid` else `lo = mid+1`; cap 200 iterations (return null if exceeded — flag, never a substitute number). Result `lo`, re-checked feasible.

- [ ] **Step 1: Expose redemption balance** — locate where the disposal-month repayment is applied in `monthly-engine.ts`/`engine.py`; capture the pre-receipt balance + that month's exit fee into the model output. RED: extend one existing ledger-fixture test (fixture F's TS/Python engine test) with the hand-derived expectation — worksheet: for fixture F the rolled-up balance at month 12 pre-receipt equals its pinned `peak_debt_pence` = 58,604,953p and `exit_fee_pence` = round(1% × committed gross) = **660,000p** (fixture F sets `committed_gross_facility_pence` explicitly to 66,000,000 — verified against the fixture JSON and pinned `totals.exit_fee_pence` during Task 4's Step-1 verification, correcting this plan's original gross=net assumption).
- [ ] **Step 2: Solver worksheet** — for fixture G (same ledger as F): `P` must satisfy `P ≥ 58,604,953 + 660,000 + round(0.015·P) + 400,000 + 0`. Closed form `(59,664,953)/0.985 = 60,573,556.3…` → hand-check integers: at P = 60,573,556, round(0.015·P) = 908,603 and 58,604,953+660,000+908,603+400,000 = 60,573,556 → feasible; at 60,573,555 the fee-sum is unchanged (60,573,556) → infeasible; expected **60,573,556**. Record the worksheet in test-cases.md; also derive: `senior_breakeven_pct_of_lender_gdv = pct(P, 108,000,000) = 56.09`; `senior_breakeven_fall_from_lender_gdv_pct = pct(108,000,000 − P, 108,000,000) = 43.91` (assert the two sum to 100.00 within rounding in the invariant suite).
- [ ] **Step 3: RED** — unit tests (solver edge cases: zero agent pct → exact sum; pct ≥ 100 → null; iteration-cap guard) + fixture G's three new keys in both golden suites.
- [ ] **Step 4: Implement both engines; wire `metrics`** — absolute value computed whenever `redemption_balance_at_disposal_pence` is non-null (developer-GDV-independent); the two percentage forms null unless lender GDV present. Cash fixture A: all three null (assert in invariants).
- [ ] **Step 5: GREEN, invariant (`senior_breakeven_pence ≥ redemption + exit_fee` for every fixture where non-null), full gates, commit** — `feat: senior repayment break-even solver (spec 5.11) in both engines`

---

### Task 5: Developer profit break-even §5.12 (both engines)

**Files:** `breakeven.ts`/`breakeven.py` (add second solver), `metrics.*`, fixture G, `test-cases.md`, both golden suites.

**Interfaces:** `solveDeveloperBreakeven(t: { tdc_ex_selling_pence: number; selling_agent_fee_pct: number; selling_legal_fee_pence: number }): number | null` — minimum integer `P` with `P ≥ tdc_ex_selling + round_half_up(P × pct/100) + legal` (profit = P − selling costs − tdc_ex_selling ≥ 0, selling costs re-solved at P per §5.12). Same bisection skeleton as Task 4 (extract the shared feasibility-bisection into one private helper per language — DRY within the new module only).

- [ ] **Step 1: Worksheet** — fixture G/F: `tdc_ex_selling = total_development_cost_pence − selling_costs_pence` from F's pinned values (TDC 96,464,953; selling costs = pinned `selling_costs_pence` — read from fixture F, do not assume; derivation: `P = (tdc_ex_selling + 400,000)/0.985` rounded up to first feasible integer, hand-checked exactly as Task 4). Record in test-cases.md. Note the deliberate non-assertion: no ordering invariant between §5.11 and §5.12 (design §B5).
- [ ] **Step 2–5:** RED (unit + fixture G key `developer_breakeven_pence`) → implement both → GREEN → gates → commit `feat: developer profit break-even (spec 5.12) in both engines`.

---

### Task 6: Cost-to-complete §5.10 on the straight-line ledger (both engines)

**Files:**
- Create: `frontend/src/lib/model/cost-to-complete.ts`, `app/financial_model/cost_to_complete.py`
- Modify: `metrics.*` (attach `cost_to_complete` summary), fixture G (`expected_metrics.cost_to_complete_first_shortfall_month`, `cost_to_complete_max_shortfall_pence` — flat keys for fixture simplicity), `test-cases.md`
- Test: `cost-to-complete.test.ts` + both golden suites

**Interfaces:** `computeCostToComplete(schedule: Schedule, model: MonthlyModel, inputs: CalculatorInputsV3): CostToCompleteSummary` (type from Task 1).

**Semantics (spec §5.10 as amended):** for each month m in 1..term: remaining cost = Σ future `uses` (acquisition/construction/professional/statutory from `schedule.uses[m..]`) + Σ future lender ancillary fees + forecast finance to completion (Σ future `interest_accrued_pence` + future `capitalised_fees_pence` from the ledger months — the ledger already computed the whole horizon under current assumptions); remaining funding = that month's `undrawn_net_facility_pence` (null → 0 for cash deals) + committed cash-equity not yet contributed (Σ cash-classified `equity_sources.amount_pence` − cumulative `equity_contribution_pence` through m, floored at 0). `surplus = funding − cost`; `first_shortfall_month` = first m with surplus < 0 (else null); `max_shortfall_pence` = max(0, max deficit). Contingency is already inside the construction schedule (spec §3.4) — no separate term, state this in the spec amendment.

- [ ] **Step 1: Worksheet** — derive month-by-month for **fixture B or C (the simplest pinned ledger fixture)** by hand from its already-pinned ledger table in `monthly-engine.test.ts` (pick the fixture whose table is smallest; the worksheet is a literal column-sum exercise over pinned numbers). Also derive fixture G's two flat summary keys (for a fully-funded fixture expect `first_shortfall_month: null`, `max_shortfall_pence: 0` — verify from F's pinned `funding_gap_pence` totals = 0).
- [ ] **Step 2–5:** RED (unit test with the worksheet fixture's full month series + golden keys) → implement both engines → GREEN → invariant both languages: `remaining_cost(m) = remaining_cost(m+1) + month m+1 cost` (telescoping identity) and `remaining cost at month 0+1 horizon equals total cost minus month-0 spend` → gates → commit `feat: cost-to-complete series (spec 5.10) on straight-line ledger`.

---

### Task 7: Hygiene — fractional-sqm rounding + Python invariant matrix + v1→v2 fixture port

**Files:**
- Modify: `frontend/src/lib/schedule-source` for base cost (locate: the `rate × sqm` base-cost computation — `schedule.ts` or the conversion-cost module) + Python twin
- Modify: `tests/test_financial_model_fixtures.py` (invariant matrix port), `tests/` migration tests (v1→v2 four cases ported from `migrate.test.ts`)
- Test: one new fractional-sqm regression per language; `test-cases.md` §4/§7 updates

- [ ] **Step 1:** RED: per language, a regression asserting `base = round_half_up(50000 × 500.5) = 25,025,000` exactly (and an odd-half case `rate=333, sqm=100.5 → round_half_up(33,466.5) = 33,467`) at the point where the engine computes the construction base.
- [ ] **Step 2:** Implement the single-step rounding in both engines (per Task 1's §1.1 spec text). Existing integer-sqm fixtures cannot move (round of an integer product is identity).
- [ ] **Step 3:** Port the TS 4-way derived-variant invariant matrix (`base`/`retain_all`/`serviced`/`term=1` — read `invariants.test.ts` for the exact transformations) into Python `test_invariants`, and the 4 hand-derived v1→v2 migration unit cases from `migrate.test.ts` into pytest (same input dicts, same expected dicts — closes test-cases.md §7 both gaps).
- [ ] **Step 4:** Gates; commit `test: close cross-language gaps; fix: explicit fractional-sqm rounding rule (spec 1.1)`.

---

### Task 8: UI + reports (frontend only)

**Files:** appraisal input pages (lender-valuation section), results/metrics display components, report generation (locate: components rendering "not available" placeholders for lender GDV/break-evens — grep `"not available"` / `ltgdv_lender`), plus their tests.

- [ ] **Step 1:** Lender-valuation entry card: basis selector, value inputs per basis, required reason/author/date; client validation mirroring Task 3's rules (server remains authoritative). Follow existing inline-style + form patterns; the block is optional — an explicit "No lender valuation recorded" empty state.
- [ ] **Step 2:** Variance bridge display: developer GDV vs lender GDV, variance pence + pct, provenance line (reason — author, date).
- [ ] **Step 3:** Metric cards: senior break-even (absolute, % of lender GDV, % fall), developer break-even, cost-to-complete (first shortfall month, max shortfall + expandable month table). Each renders its existing "not available" state when null — never a substituted number.
- [ ] **Step 4:** Reports: include the new metrics under existing watermark/status rules; lender-basis metrics show the provenance line. Component tests: null-state rendering, populated rendering (fixture-G-shaped props), validation errors. Full frontend gates + backend suite; commit `feat: lender valuation UI, variance bridge, R2b metric cards and reports`.

---

### Task 9: Fail-fast boot surfacing (UAT recommendation, R2a defect D1's enabler)

**Files:** `docker-compose.yml` (api command), `app/api/app.py` (health), `tests/` (health flag test), `docs/financial-model/migration-notes.md` (§4 note).

- [ ] **Step 1:** RED: test that the system/health endpoint (`system_router`, `app.py:520`) reports `migrations_current: bool` — computed at startup by comparing the DB's `alembic_version` to the repo's head revision (read via `alembic.script.ScriptDirectory`; DB value read with a plain SQL SELECT; table absent → `False`).
- [ ] **Step 2:** Implement; boot still starts the app (availability preserved) but logs at ERROR (not the swallowed echo) when not current. Change the compose command's `|| echo 'WARNING: migrations failed, starting anyway'` to `|| echo 'ERROR: alembic upgrade failed — schema may be stale; /health reports migrations_current'` (semantics preserved: still boots; message accurate and now backed by the health flag).
- [ ] **Step 3:** Gates; commit `feat: surface migration staleness via health endpoint and boot log`.

---

### Task 10: Live verification — browser-visual pass + R2b UAT + release report

**Files:** `docs/reviews/2026-08-13-release-2b-uat.md` (or dated at execution), `docs/reviews/` release report, `docs/financial-model/test-cases.md` final register update.

- [ ] **Step 1:** Requires the user's Chrome with the Claude extension connected (it was unavailable in the R2a session — coordinate with the user before this task). Complete the carried-over R2a visual checks against the running app: York `legacy_unreconciled` banner, mismatch list, report watermark as rendered (screenshots to `docs/reviews/assets/`).
- [ ] **Step 2:** R2b live pass: enter a lender valuation on a test appraisal in the browser, verify variance bridge + break-even/CTC cards render, verify null states before entry, verify report output; exercise a save and confirm v3 migration + hashes on the real row via SQL (backup first per runbook §4).
- [ ] **Step 3:** Write the R2b UAT record + implementation report (map every design §B item to commits); run all five gates; commit `docs: Release 2b UAT record and implementation report`.

---

## Self-review notes

- Spec coverage vs design §R2b: B1 → Tasks 1–2; B2 → Tasks 3–6; B3 → Tasks 3 (validation), 7; B4 → Task 8; B5 → Tasks 4–6 (edge handling + invariants). Additions beyond design (flagged in Global Constraints): Tasks 9–10 from the R2a UAT record.
- Deferred R2a minors deliberately NOT in this plan (ledgered for later): `script_location = %(here)s/migrations` refactor, dropping `version_path_separator`, ORM-parity test generalisation — none block R2b.
- Worksheet discipline replaces plan-inlined derivations only where the derivation is a mechanical read of already-pinned fixture numbers (Tasks 4–6 worksheets); every derivation method, formula, and closed-form cross-check is specified exactly, and the hand-derived values I could compute from pinned data are stated (108,000,000 / −12,000,000 / 54.26 / 60,512,643 / 56.03 / 43.97). Implementers must show the worksheet in test-cases.md before GREEN; reviewers re-check the arithmetic.
- Type-name consistency check: `LenderValuation`, `CalculatorInputsV3`, `CostToCompleteSummary`, `redemption_balance_at_disposal_pence`, `solveSeniorBreakeven`/`solve_senior_breakeven`, result-field names — used identically across Tasks 1–6 and 8.
