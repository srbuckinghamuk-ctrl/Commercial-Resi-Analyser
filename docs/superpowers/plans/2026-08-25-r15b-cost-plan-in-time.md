# R15b — The cost plan in time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the cost plan in time (inputs v14, spec §24): every package gets a resolved window, curve weights and a spend midpoint from its phase; a detailed plan may carry a tender-price inflation allowance from `qs.base_date` to each package's midpoint; and the ledger's §4.2(b) cap reads lender-eligible construction spend **month by month** instead of one uniform ratio — in both engines, the memo and the Costs page, calc 2.15.0 → 2.16.0, with every existing document identical except fixture S, whose pins are re-derived by hand.

**Architecture:** A new pure module `package-timing.ts` / `package_timing.py` (`computePackageTiming(inputs)`) resolves each package's window on all three spend paths and is called by both `computeCostPlan` (for the midpoint → inflation) and `buildSchedule` (for the per-month eligible share) — the `derivePhases`-called-twice precedent in `schedule.ts`. The uses stay bucket-spread and byte-identical; the share is a ratio over a per-package spread computed beside them, published as `uses[m].lender_eligible_construction_pence`, which `monthly-engine.ts` / `engine.py` read. Inflation is a separate line inside `construction_total_pence`; contingency bases are uninflated. One flag, three validation rules, a v13 → v14 migration that writes only `qs.inflation: null`.

**Tech Stack:** Python 3.12 / pydantic / pytest (repo root, `pytest`); TypeScript / React / vitest (`cd frontend && npx vitest run`), `npx tsc -b`, `npx eslint . --max-warnings 0`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-08-25-r15b-cost-plan-in-time-design.md` (cited below as "design §N"). The calculation-specification section it produces is §24 (Task 11). **Two deliberate refinements to the design, both recorded in Task 11's spec text:** (a) `CostPackageLine.phase_id` keeps its existing meaning (the raw input tag) and the resolved phase is a new field `resolved_phase_id`, so no existing reader changes meaning; (b) `months_from_base` is published whenever a base date and a calendar exist, not only when an allowance is recorded, because the `no_inflation_allowance` flag and the memo print it in exactly the no-allowance case.

## Global Constraints

- **Both engines mirror.** Every rule, message, literal and result field lands in `app/financial_model/` and `frontend/src/lib/model/` in the same task, byte-identical where the languages allow. No calculation logic in React components or report generators (spec §11.9): a component or generator prints a published field, never a quotient, a power or a sum.
- **Only fixture S moves.** calc 2.16.0 changes (a) a detailed plan carrying an allowance and (b) the cap base per month. Every stored document migrates with `inflation: null`, so (a) touches nothing existing; (b) touches only a document with an ineligible package whose window differs from another package's — corpus scan at design time: **S only** (Q and W are auto-path; X and Y are all-eligible). Every other golden pin is asserted unchanged.
- **Half-up rounding only:** Python `money_round` (`app/financial_model/engine.py`), never builtin `round()`; percentages through the shared `pct()`. The one rounding in inflation is on the pence per package; the factor and the months are never rounded. The one rounding in the share is on the product `construction × share`.
- **`null`/`None` means unknown; `0` means known zero** (spec §1.5). `inflation: null` is "no allowance modelled".
- **Messages:** ASCII hyphen `-` only; never interpolate a float — floor to a whole number first (`Math.floor` / `math.floor`) so both engines print the same text.
- **Dates** are ISO `yyyy-mm-dd`; the engine has no clock (§1.4). `monthsBetween` / `months_between` (`due-diligence.ts` / `due_diligence.py`) is the one date-difference helper — reuse it, do not re-implement.
- **Locate by content, not by line number.** Line numbers cited were true at plan time and drift as tasks land. Verify every field name against the source before using it.
- **Version bump** (`CALC_VERSION = "2.16.0"` in `app/financial_model/types.py` and `frontend/src/lib/model/finance-types.ts`) happens in Task 11 with the spec edit, because `spec-versions.test.ts` requires the spec to contain the current calc version. The §1.6 inputs-version list gains `v14` in Task 6 (one line), because `spec-versions.test.ts` derives the newest version from `migrate.ts` and fails the moment `migrateInputsToV14` exists.
- **Foreground only.** Run every command in the foreground; no background monitors.
- Commit messages: `feat(r15b): …`, `test(r15b): …`, `docs(r15b): …`, `fix(r15b): …`, each ending with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MWTe38x8shvmiMJgRonB8Y
  ```

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/model/curves.ts`, `app/financial_model/curves.py` | `curveWeights` / `curve_weights` — the fraction vector every curve already computes internally, exported |
| `frontend/src/lib/model/package-timing.ts` (new), `app/financial_model/package_timing.py` (new) | `PackageTiming`, `computePackageTiming` / `compute_package_timing`: window, curve, weights, midpoint per package on the network, auto and legacy arms |
| `frontend/src/lib/model/cost-plan.ts`, `app/financial_model/cost_plan.py`, `app/financial_model/types.py` | `InflationAllowance`, `QsProvenance.inflation`; `CostPackageLine` timing + inflation fields; `CostPlanResult.inflation_total_pence`, `latest_midpoint_month`, `latest_midpoint_months_from_base`; the new `construction_total_pence` |
| `frontend/src/lib/model/finance-types.ts`, `app/financial_model/schedule.py` | `MonthUses.lender_eligible_construction_pence`; `Schedule.package_timing`; `FlagCode` `no_inflation_allowance`; `CalculatorInputsV14` |
| `frontend/src/lib/model/schedule.ts`, `app/financial_model/schedule.py` | per-month eligible share; `package_timing` republished |
| `frontend/src/lib/model/monthly-engine.ts`, `app/financial_model/engine.py` | §4.2(b) reads the per-month figure |
| `frontend/src/lib/model/vat.ts`, `app/financial_model/vat.py` | overridden package line on `amount + inflation` |
| `frontend/src/lib/model/monitoring.ts`, `app/financial_model/monitoring.py` | `original(construction)` gains `inflation_total_pence` |
| `frontend/src/lib/model/validation.ts`, `app/financial_model/validation.py` | §24.7 rules, bracketed by `// --- R15b §24.7 begin/end ---` markers for the drift guard |
| `frontend/src/lib/model/due-diligence.ts`, `app/financial_model/due_diligence.py` | `no_inflation_allowance` raised beside R15's four flags in `dueDiligenceFlags` / `due_diligence_flags` |
| `frontend/src/lib/model/migrate.ts`, `app/financial_model/migrate.py`, `frontend/src/lib/conversion-defaults.ts` | `isV14`, `migrateV13toV14`, `migrateInputsToV14`, `defaultCalculatorInputsV14`; entry-point cutover in `ConversionCalculator.tsx`, `ExportPage.tsx`, `report-qa/memo-fixtures.ts`, `__fixtures__/*.ts`, `app/api/app.py`, `types.py` `parse_calculator_inputs` |
| `frontend/src/lib/model/__fixtures__/cost-plan-in-time-docs.ts` (new), `tests/fixtures_cost_plan_in_time.py` (new) | Document builders: `docZ()` and named twins |
| `fixtures/financial-model/z-cost-plan-in-time.json` (new) | Fixture Z |
| `frontend/src/components/calculator/ConversionCostsPage.tsx` | phase picker (packages + fee lines), timing cells, inflation control, coverage line |
| `frontend/src/lib/export-investment-memo.ts`, `frontend/src/lib/report-qa/*` | cost section lines, package columns, §13.4 sentence, finance sentence, limitations |
| `docs/financial-model/*.md`, `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` | Task 11 (spec §24 + amendments, migration notes §17, governance row, release plan); Task 7 (test-cases §24) |

---

## Hand-derived figures for fixture Z (Tasks 2, 3, 4, 7, 8)

Z is fixture S (`fixtures/financial-model/s-dated-programme.json`, migrated to the current version) with these changes and **no other**:

| Change | Value |
|---|---|
| `cost_plan.qs` | `{ source: 'Gleeds', stage: 'riba_3', date: '2026-02-15', status: 'issued', base_date: '2026-02-01', inflation: { annual_pct: 6 } }` |
| a new phase `mande_fitout` | `code: 'mech_elec_public_health'` is not a `PhaseCode` — use `code: 'other'`, `label: 'M&E fit-out'`, `duration_months: 3`, `slip_months: 0`, `start_offset: 0`, `curve: { kind: 'back_loaded' }`, `predecessors: [{ phase_id: 'construction', type: 'SS', lag_months: 3 }]`, appended after `construction` in `phases[]` |
| `pkg-mande.phase_id` | `'mande_fitout'` |
| `price_basis` | `pkg-enabling` `fixed_price`, `pkg-structure` `fixed_price`, `pkg-envelope` `fixed_price`, `pkg-mande` `estimate`, `pkg-externals` `provisional_sum` |
| `pkg-externals.vat_override` | `{ rate_pct: 20, recoverable_pct: 0, recovery_basis: 'blocked' }` |
| `vat.registered` | `true` (S has `false`, which makes every treatment inert — `resolveVatTreatment` returns `INERT` when unregistered — so the override would pin nothing). S's six treatments stay at rate 0 / `unconfirmed`, so nothing else moves |
| a new fee line | `{ id: 'fee-pm', code: 'other_professional', category: 'professional', label: 'Project manager', basis: 'pct_of_construction_total', amount_pence: 0, pct: 1, per_dwelling: false, vat_override: null, phase_id: null }` |
| `inputs_version` | 14 (Task 7; Tasks 2–5 build the same document on v13 through the builder) |

S's facts the derivation relies on: `acquisition.acquisition_date` `2026-08-01`; `finance.term_months` 24; detailed plan — `pkg-enabling` 6,000,000 (`lender_eligible: true`, `phase_id: 'strip_out'`), `pkg-structure` 24,000,000, `pkg-envelope` 18,000,000, `pkg-mande` 12,000,000, `pkg-externals` 6,000,000 (`lender_eligible: false`); base build **66,000,000**; `general` contingency 5% (the other two classes 0%); `category_phase_ids.construction = 'construction'`; every fee line `fixed`; equity 105,750,000 = the acquisition cost exactly, so from month 1 every use is met from the facility (`development_cost_advance_pct` 100, net 100,000,000, gross 110,000,000, 12% rolled up).

**Step 1 — S's derived windows (§18.2, by hand).** acquisition 0–1; planning FS acquisition → start 1, dur 3, finish 4; conditions FS planning → 4–6; design SS planning → 1–5; procurement FS design → 5–7; strip_out FS conditions → **6–8** (months 6, 7); construction FS procurement (7) and FS strip_out (8) → **8–14** (months 8–13); testing 14–15; building_control 15–16; practical_completion milestone at 16; marketing SS construction + 3 → 11–15; unit_completions 16–18; sales 18–21; maturity_tail milestone at 21. Z's **mande_fitout** SS construction + 3 → **11–14** (months 11, 12, 13) — inside construction's window, so `programme_finish` (21) and every other window are S's.

**Step 2 — package windows, weights, midpoints.**

| Package | Resolved phase | Window | Curve | Weights | `midpoint_month` |
|---|---|---|---|---|---|
| enabling | `strip_out` | 6–8 | straight | 1/2, 1/2 | **6.5** |
| structure, envelope, externals | `construction` | 8–14 | straight | 1/6 × 6 | **10.5** |
| mande | `mande_fitout` | 11–14 | back_loaded | 1/6, 2/6, 3/6 | 11·1/6 + 12·2/6 + 13·3/6 = 74/6 = **12.333…** (window centre is 12 — the curve-aware guard) |

**Step 3 — months from base and factors.** `monthsBetween('2026-02-01', '2026-08-01') = 6`.

| Package | `months_from_base` | `inflation_factor` = 1.06^(months/12) | `inflation_pence` = money_round(amount × (factor − 1)) |
|---|---|---|---|
| enabling | 12.5 | 1.0625766701… | **375,460** |
| structure | 16.5 | 1.0834167976… | **2,002,003** |
| envelope | 16.5 | 1.0834167976… | **1,501,502** |
| mande | 18.333… | 1.0931046420… | **1,117,256** |
| externals | 16.5 | 1.0834167976… | **500,501** |

`inflation_total_pence` = **5,496,722**. `latest_midpoint_month` = 12.333…; `latest_midpoint_months_from_base` = 18.333….

**Step 4 — the stack.** base build 66,000,000 (unchanged); `general` contingency = money_round(66,000,000 × 5 / 100) = **3,300,000**, base **66,000,000** (uninflated — the guard); `construction_total_pence` = 66,000,000 + 5,496,722 + 3,300,000 + 0 = **74,796,722**; `fee-pm` = money_round(74,796,722 × 1 / 100) = **747,967** (base `74,796,722`, printed); `professional_total_pence` = S's 8,000,000 + 747,967 = **8,747,967**; `lender_eligible_base_pence` **60,000,000**, `lender_eligible_ratio` 60/66 = 0.909090… (unchanged); `price_basis`: fixed 48,000,000 (72.73%), provisional 6,000,000 (9.09%), estimate 12,000,000, unclassified 0.

**Step 5 — buckets and the per-month share.** Construction uses: strip_out bucket = 6,000,000 + 375,460 = 6,375,460 over 2 months → **3,187,730** in months 6 and 7. Construction bucket = (24,000,000 + 2,002,003) + (18,000,000 + 1,501,502) + (6,000,000 + 500,501) + 3,300,000 (contingency remainder) = 55,304,006 over 6 months → 9,217,334 in months 8–12 and the residue 9,217,336 in month 13. mande_fitout bucket = 13,117,256 back-loaded over 3 → money_round(13,117,256 × 1/6) = 2,186,209, money_round(× 2/6) = 4,372,419, residue 6,558,628 in months 11, 12, 13.

Per-package spreads for the share (`amount + inflation`, own curve): enabling 3,187,730 × 2; structure 26,002,003/6 → 4,333,667 × 5, residue 4,333,668; envelope 19,501,502/6 → 3,250,250 × 5, residue 3,250,252; externals 6,500,501/6 → 1,083,417 × 5, residue 1,083,416; mande as the bucket above.

| m | `uses.construction` | eligible Σ | all Σ | `share(m)` | `lender_eligible_construction_pence` | R14 uniform (60/66) for contrast |
|---|---|---|---|---|---|---|
| 6, 7 | 3,187,730 | 3,187,730 | 3,187,730 | **1** | **3,187,730** | 2,897,936 |
| 8, 9, 10 | 9,217,334 | 7,583,917 | 8,667,334 | 0.8749999712… | **8,065,167** | 8,379,395 |
| 11 | 11,403,543 | 9,770,126 | 10,853,543 | 0.9001784947… | **10,265,224** | 10,366,857 |
| 12 | 13,589,753 | 11,956,336 | 13,039,753 | 0.9169143004… | **12,460,639** | 12,354,321 |
| 13 | 15,775,964 | 14,142,548 | 15,225,964 | 0.9288441770… | **14,653,412** | 14,341,785 |

(Month 13 sums use the residue months: 4,333,668 + 3,250,252 + 6,558,628 eligible; + 1,083,416 externals.) Every other month has 0 construction and 0 eligible. The share at months 8–10 is not exactly 7/8 because the three per-line spreads each round — design §24.9 limitation 3, and the reason the tests pin the *pence*, not the ratio.

**Step 6 — VAT.** `pkg-externals` line: net base 6,000,000 + 500,501 = 6,500,501; VAT = money_round(6,500,501 × 20 / 100) = **1,300,100**, recoverable 0; the construction category base = 74,796,722 − 6,500,501 = **68,296,221** at rate 0. `total_irrecoverable_pence` = 1,300,100 (S's is 0).

**Step 7 — S under calc 2.16.0 (Task 3's re-pin).** S has no allowance and every package straight-line. Construction bucket months 8–13 = (60,000,000 + 3,300,000)/6 = 10,550,000; eligible packages there 24 + 18 + 12 = 54,000,000 of 60,000,000 → share exactly **0.9** (4,000,000 + 3,000,000 + 2,000,000 over 4,000,000 + 3,000,000 + 2,000,000 + 1,000,000 per month, no rounding); `lender_eligible_construction_pence` = 9,495,000, leaving 1,055,000 per month unfundable → **6 × 1,055,000 = 6,330,000**. Strip-out months (6, 7): 3,000,000 at share 1, fully advanced (R14 funded 2,727,273 of each). Professional and statutory are unchanged and fully eligible. Under R14's uniform ratio the gap was Σ construction × 6/66 = 69,300,000 × 6/66 = 6,300,000 — the old pin, recovered. **New `funding_gap_pence` = 6,330,000.** Peak debt and the debt-denominated metrics move by the re-timed draws and are pinned from the two engines agreeing, with this figure as the hand anchor.

---

### Task 1: Curve weights and package timing (both engines)

**Files:**
- Modify: `frontend/src/lib/model/curves.ts`; `app/financial_model/curves.py`
- Create: `frontend/src/lib/model/package-timing.ts`; `app/financial_model/package_timing.py`
- Modify: `frontend/src/lib/model/index.ts` (re-export `computePackageTiming`, `PackageTiming`, `curveWeights`)
- Test: `frontend/src/lib/model/curves.test.ts`, `frontend/src/lib/model/package-timing.test.ts` (new); `tests/test_financial_model_curves.py`, `tests/test_financial_model_package_timing.py` (new)

**Interfaces:**
- Consumes: `spreadByCurve`, `SpendCurve` (`curves.ts`); `derivePhases`, `isProgrammeNetwork`, `isLegacyProgramme` (`programme.ts`); `resolvedPhaseId` (`schedule.ts`; `curves.ts` already imports from `schedule.ts`, so the cycle is the existing tolerated one); `AnyCalculatorInputs`.
- Produces: `curveWeights(durationMonths: number, curve: SpendCurve): number[]` / `curve_weights(duration_months, curve) -> list[float]`; `PackageTiming`; `computePackageTiming(inputs: AnyCalculatorInputs): PackageTiming[]` / `compute_package_timing(inputs) -> list[PackageTiming]` — one entry per `cost_plan.packages[]` in order, `[]` when the document has no `cost_plan` or no packages.

- [ ] **Step 1: Failing tests for `curveWeights`** — in `curves.test.ts` (TS) and `test_financial_model_curves.py` (PY):

```ts
import { curveWeights, spreadByCurve } from './curves';
describe('curveWeights (R15b spec §24.2)', () => {
  it('back_loaded over 3 is 1/6, 2/6, 3/6', () => {
    expect(curveWeights(3, { kind: 'back_loaded' })).toEqual([1 / 6, 2 / 6, 3 / 6]);
  });
  it('straight_line over 4 is four quarters; user_defined normalises', () => {
    expect(curveWeights(4, { kind: 'straight_line' })).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(curveWeights(2, { kind: 'user_defined', weights: [1, 3] })).toEqual([0.25, 0.75]);
  });
  it('agrees with spreadByCurve on every non-final month (the spread is round(total × w_k))', () => {
    const w = curveWeights(5, { kind: 's_curve' });
    const s = spreadByCurve(1_000_003, 5, { kind: 's_curve' });
    for (let k = 0; k < 4; k++) expect(s[k]).toBe(Math.round(1_000_003 * w[k]));
    expect(s.reduce((a, b) => a + b, 0)).toBe(1_000_003);
  });
  it('a non-positive duration gives []', () => { expect(curveWeights(0, { kind: 'back_loaded' })).toEqual([]); });
});
```

Python twin with `curve_weights(3, SimpleSpendCurve(kind="back_loaded")) == [1/6, 2/6, 3/6]` (compare with `pytest.approx` only on the user_defined case; the others are exact by the same arithmetic) and the agreement check via `money_round`.

- [ ] **Step 2: Run, expect FAIL** (`curveWeights` not exported). `cd frontend && npx vitest run src/lib/model/curves.test.ts`; `pytest tests/test_financial_model_curves.py -q`.

- [ ] **Step 3: Implement `curveWeights`** — `curves.ts`: refactor so each curve's weight vector is a named function, and export

```ts
/** R15b spec §24.2. The ideal per-month fractions w_k of §6.1 for a window of
 *  `durationMonths`, Σ = 1. `spreadByCurve` is `round(total × w_k)` with the
 *  final month absorbing the residue; a midpoint computed from these weights is
 *  independent of the amount. `[]` for a non-positive duration. */
export function curveWeights(durationMonths: number, curve: SpendCurve): number[] {
  const months = Math.floor(durationMonths);
  if (months <= 0) return [];
  switch (curve.kind) {
    case 'straight_line': return Array.from({ length: months }, () => 1 / months);
    case 's_curve': return sCurveWeights(months);
    case 'back_loaded': return Array.from({ length: months }, (_, i) => (2 * (i + 1)) / (months * (months + 1)));
    case 'user_defined': { const sum = curve.weights.reduce((a, b) => a + b, 0); return curve.weights.map((w) => w / sum); }
  }
}
```

where `sCurveWeights` is the loop already inside `spreadSCurve` (extract it; `spreadSCurve` calls it). Note `spreadStraightLine` is **not** `spreadByWeights(1/D)` (it is `round(total / D)` with residue), so the straight-line spread must keep calling `spreadStraightLine` — only the *weights* are new. Python: `curve_weights(duration_months, curve)` mirroring the same structure with `_s_curve_weights`.

- [ ] **Step 4: Failing tests for `computePackageTiming`** — `package-timing.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computePackageTiming } from './package-timing';
import { migrateInputsToV13 } from './migrate';
const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
const load = (stem: string) => migrateInputsToV13(JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${stem}.json`), 'utf-8')).inputs);

describe('computePackageTiming (R15b spec §24.2)', () => {
  it('network: a tagged package takes its phase window; an untagged one the category default (fixture S)', () => {
    const t = computePackageTiming(load('s-dated-programme'));
    const byId = Object.fromEntries(t.map((x) => [x.id, x]));
    expect(byId['pkg-enabling']).toMatchObject({ phase_id: 'strip_out', start_month: 6, finish_month: 8, duration_months: 2, midpoint_month: 6.5 });
    expect(byId['pkg-structure']).toMatchObject({ phase_id: 'construction', start_month: 8, finish_month: 14, midpoint_month: 10.5 });
    expect(byId['pkg-structure'].weights).toEqual([1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6]);
  });
  it('the midpoint is curve-aware: a back_loaded 3-month phase from month 11 gives 74/6, not 12', () => {
    const doc = load('s-dated-programme');
    doc.programme!.phases.push({ id: 'mande_fitout', code: 'other', label: 'M&E fit-out', duration_months: 3, slip_months: 0, start_offset: 0,
      curve: { kind: 'back_loaded' }, predecessors: [{ phase_id: 'construction', type: 'SS', lag_months: 3 }] });
    doc.cost_plan.packages.find((p) => p.id === 'pkg-mande')!.phase_id = 'mande_fitout';
    const m = computePackageTiming(doc).find((x) => x.id === 'pkg-mande')!;
    expect(m).toMatchObject({ phase_id: 'mande_fitout', start_month: 11, finish_month: 14 });
    expect(m.midpoint_month).toBeCloseTo(74 / 6, 10);
    expect(m.midpoint_month).not.toBe(12);
  });
  it('auto path: every package shares §6\'s construction window, months 1..term-2 (fixture Q, term from the document)', () => {
    const doc = load('q-detailed-cost-plan');
    const term = Math.max(1, Math.floor(doc.finance.term_months));
    const t = computePackageTiming(doc);
    expect(t).toHaveLength(doc.cost_plan.packages.length);
    for (const x of t) expect(x).toMatchObject({ phase_id: null, start_month: 1, finish_month: 1 + Math.max(1, term - 2) });
    expect(new Set(t.map((x) => x.midpoint_month)).size).toBe(1);
  });
  it('auto path, term 1: month 0, one month', () => {
    const doc = load('q-detailed-cost-plan'); doc.finance.term_months = 1;
    expect(computePackageTiming(doc)[0]).toMatchObject({ start_month: 0, finish_month: 1, midpoint_month: 0 });
  });
  it('legacy three-package arm (raw v8 shape, unreachable from a stored document): the construction package window', () => {
    // Build by hand: a raw pre-v9 document with programme.packages.construction { start_offset: 2, duration_months: 4, curve: s_curve }
    // and a cost_plan with one package. Assert start 2, finish 6, curve s_curve, midpoint = Σ w_k (2 + k).
  });
  it('no cost_plan → []; headline mode with no packages → []', () => { /* a-all-cash (no cost_plan) and t-investment-case (headline) */ });
});
```

Write the legacy-arm and empty cases out in full (they are the two arms the fixtures cannot reach). Python twin `tests/test_financial_model_package_timing.py` with the same six cases over `parse_calculator_inputs(migrate_inputs_to_v13(doc))`.

- [ ] **Step 5: Run, expect FAIL** (module missing).

- [ ] **Step 6: Implement `package-timing.ts`:**

```ts
import type { AnyCalculatorInputs, ProgrammeNetwork } from './finance-types';
import type { SpendCurve } from './curves';
import { curveWeights } from './curves';
import { derivePhases, isProgrammeNetwork, isLegacyProgramme } from './programme';
import { resolvedPhaseId } from './schedule';

/** R15b spec §24.2. A package's place in time, resolved once and read by both
 *  computeCostPlan (midpoint → inflation) and buildSchedule (per-month share). */
export interface PackageTiming {
  id: string;
  /** The resolved phase in a network; null on the auto and legacy arms. */
  phase_id: string | null;
  start_month: number;
  finish_month: number;      // half-open, §18.2
  duration_months: number;   // >= 1
  curve: SpendCurve;
  weights: number[];         // curveWeights(duration_months, curve)
  midpoint_month: number;    // Σ_k weights[k] × (start_month + k)
}

export function computePackageTiming(inputs: AnyCalculatorInputs): PackageTiming[] {
  const packages = 'cost_plan' in inputs && inputs.cost_plan != null ? inputs.cost_plan.packages : [];
  if (packages.length === 0) return [];
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const rawProgramme = 'programme' in inputs ? inputs.programme : null;
  const network: ProgrammeNetwork | null = rawProgramme != null && isProgrammeNetwork(rawProgramme) ? rawProgramme : null;
  const legacy = rawProgramme != null && isLegacyProgramme(rawProgramme) ? rawProgramme : null;
  const derivation = network != null ? derivePhases(network) : null;
  const phaseById = network != null ? new Map(network.phases.map((p) => [p.id, p])) : null;

  return packages.map((pkg) => {
    let phaseId: string | null = null;
    let start: number; let duration: number; let curve: SpendCurve;
    if (network != null) {
      phaseId = resolvedPhaseId(pkg.phase_id ?? null, 'construction', network);
      // Mirrors schedule.ts's placeInPhase degrade: unreachable post-validation.
      const derived = derivation != null && !('cycle' in derivation) ? derivation.byId[phaseId] : undefined;
      start = derived?.start_month ?? 0;
      duration = Math.max(1, derived?.duration_months ?? 1);
      curve = phaseById?.get(phaseId)?.curve ?? { kind: 'straight_line' };
    } else if (legacy != null) {
      start = legacy.packages.construction.start_offset;
      duration = Math.max(1, Math.floor(legacy.packages.construction.duration_months));
      curve = legacy.packages.construction.curve;
    } else if (term === 1) {
      start = 0; duration = 1; curve = { kind: 'straight_line' };
    } else {
      start = 1; duration = Math.max(1, term - 2); curve = { kind: 'straight_line' };
    }
    const weights = curveWeights(duration, curve);
    const midpoint = weights.reduce((s, w, k) => s + w * (start + k), 0);
    return { id: pkg.id, phase_id: phaseId, start_month: start, finish_month: start + duration, duration_months: duration, curve, weights, midpoint_month: midpoint };
  });
}
```

Python `package_timing.py` mirrors it as a `@dataclass PackageTiming` and `compute_package_timing(inputs)`; read the programme with `getattr(inputs, "programme", None)`, the plan with `getattr(inputs, "cost_plan", None)`, the derivation's `by_id` / `cycle`, and the legacy arm's `programme.packages.construction`. The midpoint sum keeps the same operation order (`s + w * (start + k)`, k ascending) so both engines produce the same double.

- [ ] **Step 7: Run both suites, expect PASS.** Also `npx tsc -b` and `npx eslint . --max-warnings 0`.

- [ ] **Step 8: Commit** — `feat(r15b): curve weights and package timing on all three spend paths (spec 24.2)`.

---

### Task 2: Inflation in the cost plan (both engines)

**Files:**
- Modify: `frontend/src/lib/model/cost-plan.ts` (types + `computeCostPlan`); `app/financial_model/types.py` (`InflationAllowance`, `QsProvenance.inflation`); `app/financial_model/cost_plan.py`
- Create: `frontend/src/lib/model/__fixtures__/cost-plan-in-time-docs.ts`; `tests/fixtures_cost_plan_in_time.py`
- Modify: `frontend/src/lib/model/entry-point-guard.test.ts` (`EXEMPT` gains `'lib/model/__fixtures__/cost-plan-in-time-docs.ts'`)
- Test: `frontend/src/lib/model/cost-plan.test.ts`; `tests/test_cost_plan.py`

**Interfaces:**
- Consumes: `computePackageTiming` (Task 1); `monthsBetween` / `months_between` (`due-diligence.ts` / `due_diligence.py` — import it; `cost-plan.ts` importing `due-diligence.ts` is fine: `due-diligence.ts` imports the *type* `CostPlanResult` only. **Verify**: if `due-diligence.ts` has a value import from `cost-plan.ts`, move `monthsBetween` to a new `dates.ts` / `dates.py` and re-export it from `due-diligence.ts` so the R15 tests keep passing).
- Produces:

```ts
export interface InflationAllowance { annual_pct: number }
export interface QsProvenance { source; stage; date; status; base_date; inflation: InflationAllowance | null }  // field added LAST
export interface CostPackageLine {  // fields appended, in this order
  ...existing; resolved_phase_id: string | null; start_month: number; finish_month: number; midpoint_month: number;
  months_from_base: number | null; inflation_factor: number | null; inflation_pence: number;
}
export interface CostPlanResult {  // inserted after implied_rate_pence_per_sqm, before price_basis
  ...; inflation_total_pence: number;
  /** pct(inflation_total_pence, base_build_pence) — the Costs page and memo print it; null when base build is 0. */
  inflation_pct_of_base_build: number | null;
  latest_midpoint_month: number | null;
  latest_midpoint_months_from_base: number | null;
  /** Math.floor of the line above; the flag message and the memo sentence print this integer, never the float. */
  latest_midpoint_whole_months_from_base: number | null;
  price_basis; qs;
}
```

Python: `class InflationAllowance(Model): annual_pct: float = Field(default=0.0, ge=0)`; `QsProvenance.inflation: InflationAllowance | None = None`; the dataclasses gain the same fields with defaults (`resolved_phase_id=None, start_month=0, finish_month=0, midpoint_month=0.0, months_from_base=None, inflation_factor=None, inflation_pence=0`; `inflation_total_pence=0, inflation_pct_of_base_build=None, latest_midpoint_month=None, latest_midpoint_months_from_base=None, latest_midpoint_whole_months_from_base=None`). The two integers/percentages exist because a generator may print only a published field (the R15 lesson): Z pins `inflation_pct_of_base_build` **8.33** and `latest_midpoint_whole_months_from_base` **18**; the no-allowance twin pins the same two.

- [ ] **Step 1: The document builders.** `__fixtures__/cost-plan-in-time-docs.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateInputsToV13 } from '../migrate';   // Task 7 moves this to V14 and loads Z directly
import type { CalculatorInputsV13 } from '../finance-types';
const FIXTURE_DIR = resolve(__dirname, '../../../../../fixtures/financial-model');
export function docS(): CalculatorInputsV13 { return migrateInputsToV13(JSON.parse(readFileSync(resolve(FIXTURE_DIR, 's-dated-programme.json'), 'utf-8')).inputs); }
/** Design §13: S plus Z's changes, and no other. */
export function docZ(): CalculatorInputsV13 {
  const d = docS();
  d.cost_plan.qs = { source: 'Gleeds', stage: 'riba_3', date: '2026-02-15', status: 'issued', base_date: '2026-02-01', inflation: { annual_pct: 6 } };
  d.programme!.phases.push({ id: 'mande_fitout', code: 'other', label: 'M&E fit-out', duration_months: 3, slip_months: 0, start_offset: 0, curve: { kind: 'back_loaded' }, predecessors: [{ phase_id: 'construction', type: 'SS', lag_months: 3 }] });
  const basis = { 'pkg-enabling': 'fixed_price', 'pkg-structure': 'fixed_price', 'pkg-envelope': 'fixed_price', 'pkg-mande': 'estimate', 'pkg-externals': 'provisional_sum' } as const;
  d.cost_plan.packages = d.cost_plan.packages.map((p) => ({ ...p, price_basis: basis[p.id as keyof typeof basis], phase_id: p.id === 'pkg-mande' ? 'mande_fitout' : p.phase_id,
    vat_override: p.id === 'pkg-externals' ? { rate_pct: 20, recoverable_pct: 0, recovery_basis: 'blocked' } : p.vat_override }));
  d.cost_plan.fee_lines = [...d.cost_plan.fee_lines, { id: 'fee-pm', code: 'other_professional', category: 'professional', label: 'Project manager', basis: 'pct_of_construction_total', amount_pence: 0, pct: 1, per_dwelling: false, vat_override: null, phase_id: null }];
  d.vat = { ...d.vat, registered: true };
  return d;
}
export function docZNoAllowance(): CalculatorInputsV13 { const d = docZ(); d.cost_plan.qs = { ...d.cost_plan.qs!, inflation: null }; return d; }
```

Python `tests/fixtures_cost_plan_in_time.py` with `doc_s()`, `doc_z()`, `doc_z_no_allowance()` returning **dicts** (mutate the migrated `model_dump(mode="json")`), plus `parse(doc)` → `parse_calculator_inputs`. Tests use the same names.

- [ ] **Step 2: Failing tests** in `cost-plan.test.ts` (a new `describe('R15b spec §24.3 inflation')`):

```ts
it('Z: every package\'s months, factor and pence by hand; the total is the sum of rounded lines', () => {
  const cp = computeCostPlan(docZ(), 600, 4);   // developedAreaSqm(docZ()) is 600 (S's manual area); unit count 4
  const by = Object.fromEntries(cp.packages.map((p) => [p.id, p]));
  expect(by['pkg-enabling']).toMatchObject({ resolved_phase_id: 'strip_out', start_month: 6, finish_month: 8, midpoint_month: 6.5, months_from_base: 12.5, inflation_pence: 375_460 });
  expect(by['pkg-structure']).toMatchObject({ months_from_base: 16.5, inflation_pence: 2_002_003 });
  expect(by['pkg-envelope'].inflation_pence).toBe(1_501_502);
  expect(by['pkg-externals'].inflation_pence).toBe(500_501);
  expect(by['pkg-mande'].months_from_base).toBeCloseTo(18 + 1 / 3, 10);
  expect(by['pkg-mande'].inflation_pence).toBe(1_117_256);
  expect(by['pkg-structure'].inflation_factor).toBeCloseTo(1.0834167976, 9);
  expect(cp.inflation_total_pence).toBe(5_496_722);
  expect(cp.latest_midpoint_month).toBeCloseTo(74 / 6, 10);
  expect(cp.latest_midpoint_months_from_base).toBeCloseTo(18 + 1 / 3, 10);
});
it('Z: the stack — base build uninflated, contingency on the uninflated base, construction total carries the line, the pct fee follows it', () => {
  const cp = computeCostPlan(docZ(), 600, 4);
  expect(cp.base_build_pence).toBe(66_000_000);
  expect(cp.contingency.find((c) => c.name === 'general')).toMatchObject({ base_pence: 66_000_000, amount_pence: 3_300_000 });
  expect(cp.construction_total_pence).toBe(74_796_722);
  expect(cp.fees.find((f) => f.id === 'fee-pm')).toMatchObject({ base_pence: 74_796_722, amount_pence: 747_967 });
  expect(cp.professional_total_pence).toBe(8_747_967);
  expect(cp.lender_eligible_base_pence).toBe(60_000_000);
  expect(cp.price_basis!.fixed_price_coverage_pct).toBe(72.73);
});
it('no allowance: pence 0, factor null, but months_from_base and the latest-midpoint fields are still published', () => {
  const cp = computeCostPlan(docZNoAllowance(), 600, 4);
  expect(cp.inflation_total_pence).toBe(0);
  expect(cp.construction_total_pence).toBe(69_300_000);
  expect(cp.packages.every((p) => p.inflation_pence === 0 && p.inflation_factor === null)).toBe(true);
  expect(cp.packages.find((p) => p.id === 'pkg-enabling')!.months_from_base).toBe(12.5);
  expect(cp.latest_midpoint_months_from_base).toBeCloseTo(18 + 1 / 3, 10);
});
it('the midpoint is amount-independent: doubling a package moves its inflation, never its midpoint', () => {
  const d = docZ(); d.cost_plan.packages[1].amount_pence *= 2;
  const a = computeCostPlan(docZ(), 600, 4).packages[1]; const b = computeCostPlan(d, 600, 4).packages[1];
  expect(b.midpoint_month).toBe(a.midpoint_month); expect(b.inflation_factor).toBe(a.inflation_factor);
  expect(b.inflation_pence).not.toBe(a.inflation_pence);
});
it('floor at zero: a base date after every midpoint gives months 0, factor 1, pence 0 — and the unfloored value is negative', () => {
  const d = docZ(); d.cost_plan.qs!.base_date = '2028-06-01';   // 22 months after acquisition; every midpoint < 13
  const cp = computeCostPlan(d, 600, 4);
  expect(cp.packages.every((p) => p.months_from_base === 0 && p.inflation_factor === 1 && p.inflation_pence === 0)).toBe(true);
  expect(monthsBetween('2028-06-01', '2026-08-01') + 12.5).toBeLessThan(0);
});
it('rounded lines, not a rounded sum', () => {
  // Three packages of 1,000,001 / 1,000,001 / 1,000,001 on one window whose factor gives x.5 pence each: Σ round ≠ round Σ.
  // Construct with annual_pct chosen so that amount × (factor − 1) ends in .5 — derive the rate in the test from the factor
  // needed, assert inflation_total_pence === Σ p.inflation_pence and !== Math.round(Σ amount × (factor − 1)).
});
it('acquisition_date null: no months, no inflation — computeCostPlan does not throw (validation owns the error)', () => {
  const d = docZ(); d.acquisition.acquisition_date = null;
  const cp = computeCostPlan(d, 600, 4);
  expect(cp.inflation_total_pence).toBe(0); expect(cp.packages[0].months_from_base).toBeNull(); expect(cp.latest_midpoint_months_from_base).toBeNull();
});
it('headline mode: no timing, no inflation fields beyond their zero/null seeds', () => { /* fixture T: packages [] → inflation_total 0, latest_* null */ });
```

Write the "rounded lines" case out concretely: pick a rate such that for `amount = 1_000_000` on the auto window the product ends near `.5` — compute the exact rate in the test from `factor = 1 + 0.5000005 / 1e6` … simpler: three packages of **333,333** with months such that `(factor − 1) × 333,333 = k + 0.5` exactly is not reachable from a 6% rate; instead assert the weaker but still falsifiable property on Z itself: `cp.inflation_total_pence === Σ cp.packages[].inflation_pence` **and** that value differs from `money_round(Σ amount × (factor − 1))` computed in the test — on Z the unrounded per-package products are 375,460.02…, 2,002,003.15…, 1,501,502.36…, 1,117,255.71…, 500,500.79… whose sum 5,496,722.03… rounds to 5,496,722 — equal, so that assertion would NOT discriminate on Z. Use `docZ()` with `annual_pct: 7` instead and derive both figures in the test with `Math.pow`; assert the two differ (check by computing before writing the literal; if they still agree, use 8 — record which rate in the test's comment).

Python twin in `tests/test_cost_plan.py` with the same pins via `compute_cost_plan(parse(doc_z()), 600.0, 4)`.

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement.** In `computeCostPlan`, after `packages` is built:

```ts
const timing = computePackageTiming(inputs);
const timingById = new Map(timing.map((t) => [t.id, t]));
const acqDate = ('acquisition_date' in inputs.acquisition ? inputs.acquisition.acquisition_date : null) ?? null;
const qsInput = detailed ? (plan.qs ?? null) : null;
const baseDate = qsInput != null && qsInput.base_date.trim() !== '' ? qsInput.base_date : null;
const inflation = qsInput != null ? (qsInput.inflation ?? null) : null;   // `?? null`: a raw pre-v14 document has no key
const baseToMonth0 = baseDate != null && acqDate != null ? monthsBetween(baseDate, acqDate) : null;
const packages: CostPackageLine[] = plan.packages.map((p) => {
  const t = timingById.get(p.id);
  const start = t?.start_month ?? 0, finish = t?.finish_month ?? 0, midpoint = t?.midpoint_month ?? 0;
  const monthsFromBase = baseToMonth0 == null ? null : Math.max(0, baseToMonth0 + midpoint);
  const factor = inflation != null && monthsFromBase != null ? Math.pow(1 + inflation.annual_pct / 100, monthsFromBase / 12) : null;
  const inflationPence = factor == null ? 0 : Math.round(p.amount_pence * (factor - 1));
  return { ...existing fields..., resolved_phase_id: t?.phase_id ?? null, start_month: start, finish_month: finish, midpoint_month: midpoint,
           months_from_base: monthsFromBase, inflation_factor: factor, inflation_pence: inflationPence };
});
const inflationTotal = detailed ? packages.reduce((s, p) => s + p.inflation_pence, 0) : 0;
const constructionTotal = baseBuild + inflationTotal + contingencyTotal + compliance;
const latestMidpoint = packages.length === 0 ? null : Math.max(...packages.map((p) => p.midpoint_month));
const latestFromBase = latestMidpoint == null || baseToMonth0 == null ? null : Math.max(0, baseToMonth0 + latestMidpoint);
const latestWhole = latestFromBase == null ? null : Math.floor(latestFromBase);
const inflationPctOfBase = pct(inflationTotal, baseBuild);   // the shared helper: 2 dp, null on a zero base
```

Guard: inflation and the months apply **only in detailed mode** (headline has no packages by validation; a stray package in headline mode gets `inflation_pence: 0`). Python: `(1 + annual_pct / 100) ** (months / 12)` and `money_round(p.amount_pence * (factor - 1))`; `acq_date = getattr(inputs.acquisition, "acquisition_date", None)`; `plan_qs = getattr(plan, "qs", None)`; `inflation = getattr(plan_qs, "inflation", None)`. `qs` republished via `model_dump(mode="json")` now carries `inflation` automatically.

- [ ] **Step 5: Run everything** — the whole vitest and pytest suites, because `construction_total_pence`'s definition and two type shapes changed. Every existing pin must be green (inflation is 0 everywhere). Fix any test literal that constructs `QsProvenance` without `inflation` (add `inflation: null`).

- [ ] **Step 6: Commit** — `feat(r15b): tender-price inflation to each package's spend midpoint; timing fields on the cost-plan result (spec 24.3)`.

---

### Task 3: The per-month eligible share, the ledger cap, and fixture S re-pinned

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts` (`MonthUses.lender_eligible_construction_pence: number`; `Schedule.package_timing: PackageTiming[]`); `app/financial_model/schedule.py` (`MonthUses` field, required; `_empty_uses`; `Schedule.package_timing: list[PackageTiming] = field(default_factory=list)` last)
- Modify: `frontend/src/lib/model/schedule.ts`, `app/financial_model/schedule.py` (the share); `frontend/src/lib/model/monthly-engine.ts`, `app/financial_model/engine.py` (the cap)
- Modify: `fixtures/financial-model/s-dated-programme.json` (`expected_metrics` re-pinned; `note` amended)
- Test: `frontend/src/lib/model/schedule.test.ts`, `monthly-engine.test.ts`, `golden-fixtures.test.ts`; `tests/test_financial_model_schedule.py`, `test_financial_model_engine.py`, `test_financial_model_fixtures.py`

**Interfaces:**
- Consumes: `computePackageTiming`; `costPlan.packages[].inflation_pence` (Task 2); `spreadByCurve`.
- Produces: `uses[m].lender_eligible_construction_pence` (both engines); `schedule.package_timing`.

- [ ] **Step 1: Failing tests** — `schedule.test.ts`:

```ts
describe('R15b spec §24.4 per-month eligible share', () => {
  it('Z: strip-out months at share 1, the main window below the uniform ratio, the M&E months above it — pence by hand', () => {
    const s = buildSchedule(docZ());
    const e = s.uses.map((u) => u.lender_eligible_construction_pence);
    expect([s.uses[6].construction_pence, e[6]]).toEqual([3_187_730, 3_187_730]);
    expect([s.uses[8].construction_pence, e[8]]).toEqual([9_217_334, 8_065_167]);
    expect(e[10]).toBe(8_065_167);
    expect([s.uses[11].construction_pence, e[11]]).toEqual([11_403_543, 10_265_224]);
    expect([s.uses[12].construction_pence, e[12]]).toEqual([13_589_753, 12_460_639]);
    expect([s.uses[13].construction_pence, e[13]]).toEqual([15_775_964, 14_653_412]);
    expect(e[5]).toBe(0); expect(e[14]).toBe(0);
  });
  it('S: share exactly 0.9 in the main window and 1 in strip-out', () => {
    const s = buildSchedule(docS());
    expect(s.uses[8].lender_eligible_construction_pence).toBe(9_495_000);
    expect(s.uses[6].lender_eligible_construction_pence).toBe(3_000_000);
  });
  it('R14 recovery: on every auto-path detailed fixture, every month equals round(construction × lender_eligible_ratio)', () => {
    // load q-detailed-cost-plan and w-monitoring-on-site (migrateInputsToV13); assert for all m; assert the list is non-empty.
  });
  it('all-eligible network (X): share 1 everywhere → eligible === construction', () => { /* x-unit-sales-ledger */ });
  it('denominator-zero arm: a default construction phase carrying only contingency takes the uniform ratio', () => {
    // docS() with EVERY package tagged 'strip_out' (so the construction phase bucket is the 3,300,000 contingency alone):
    // months 8–13 have construction 550,000 and eligible round(550,000 × 60/66) = 500,000; months 6,7 carry all
    // five packages (66,000,000 over 2 months = 33,000,000, eligible 30,000,000) at share 60/66 → 30,000,000.
  });
  it('headline mode: eligible === construction every month (fixture T)', () => {});
  it('package_timing is republished on the schedule, one per package, in order', () => {});
});
```

`monthly-engine.test.ts`: the R14 "ineligible-package pair" test still holds (strictly smaller cumulative draw, strictly larger gap) — leave it; add: "the cap reads the per-month figure: two schedules identical except `uses[8].lender_eligible_construction_pence` produce different month-8 draws" (build the second by copying the first schedule and overwriting the field — the ledger must not recompute from the ratio). Python twins in `test_financial_model_schedule.py` / `test_financial_model_engine.py`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement the share** in `buildSchedule`, after the three placement branches and **before** `computeVat`:

```ts
// R15b spec §24.4. The uses above are bucket-spread and byte-identical to
// calc 2.15.0. Beside them, a per-package spread with the same weights gives
// each month's lender-eligible SHARE; the share is applied to the bucketed
// figure, never added to it. Denominator 0 (a remainder-only month) → the
// uniform ratio, so contingency in a phase no package resolves to is neither
// un-advanceable (0) nor advanced in full (1).
const packageTiming = computePackageTiming(inputs);
const eligibleByMonth = new Array<number>(term).fill(0);
const allByMonth = new Array<number>(term).fill(0);
if (costPlan.mode === 'detailed') {
  const timingById = new Map(packageTiming.map((t) => [t.id, t]));
  for (const p of costPlan.packages) {
    const t = timingById.get(p.id); if (t == null) continue;
    spreadByCurve(p.amount_pence + p.inflation_pence, t.duration_months, t.curve).forEach((v, i) => {
      const m = Math.min(Math.max(0, Math.floor(t.start_month + i)), term - 1);
      allByMonth[m] += v; if (p.lender_eligible) eligibleByMonth[m] += v;
    });
  }
}
for (let m = 0; m < term; m++) {
  const share = allByMonth[m] === 0 ? costPlan.lender_eligible_ratio : eligibleByMonth[m] / allByMonth[m];
  uses[m].lender_eligible_construction_pence = Math.round(uses[m].construction_pence * share);
}
```

`emptyUses()` seeds the field 0. Return `package_timing: packageTiming` on the schedule. Python mirrors with `money_round` and the same clamp. **The ledger:** `monthly-engine.ts` — replace `Math.round(u.construction_pence * schedule.lender_eligible_ratio)` with `u.lender_eligible_construction_pence`; `engine.py` likewise; update the two R14 comments to say the per-month figure is read and the ratio is the disclosure and the fallback. Fix every hand-built `MonthUses` literal / constructor (`cost-to-complete.test.ts`, `metrics.test.ts`, `monthly-engine.test.ts`; `tests/test_financial_model_cost_to_complete.py`, `test_financial_model_engine.py`, `test_financial_model_metrics.py`) by adding the field equal to `construction_pence` (the all-eligible value), so those tests keep their meaning.

- [ ] **Step 4: Re-pin S.** Run both golden suites; S fails on `funding_gap_pence` (expect **6,330,000**, the hand figure) and on `peak_debt_pence` / month and the debt-denominated pins. Run `runAppraisal(docS())` in TS and `run_appraisal` in Python; both must agree to the penny on every S pin; write the agreed figures into `s-dated-programme.json`'s `expected_metrics` and append to its `note`: "R15b (calc 2.16.0): re-pinned — §4.2(b) reads lender-eligible construction month by month; strip-out months (share 1) fully advanced, main window at 54/60; funding gap 6,300,000 → 6,330,000 by hand (test-cases §24)". If `funding_gap_pence` is not 6,330,000, stop and find out why before pinning anything — the hand figure is the anchor, not the engine.

- [ ] **Step 5: Run everything** (both suites, tsc, lint). Every non-S pin unchanged.

- [ ] **Step 6: Commit** — `feat(r15b): per-month lender-eligible construction; the 4.2(b) cap reads it; fixture S re-pinned by hand (spec 24.4)`.

---

### Task 4: VAT and monitoring follow-through

**Files:**
- Modify: `frontend/src/lib/model/vat.ts`, `app/financial_model/vat.py`; `frontend/src/lib/model/monitoring.ts`, `app/financial_model/monitoring.py`
- Test: `vat.test.ts`, `monitoring.test.ts`; `tests/test_vat.py`, `tests/test_financial_model_monitoring.py`

- [ ] **Step 1: Failing tests.** VAT: "Z's overridden externals line is charged on amount + inflation, and the category base is net of the same":

```ts
const run = runAppraisal(docZ());
const line = run.schedule.vat.charges.find((c) => c.id === 'package:pkg-externals')!;   // verify the charges field name on VatResult
expect(line.net_base_pence ?? line.base_pence).toBe(6_500_501);   // verify the field name; use the one VatChargeLine carries
expect(line.vat_pence).toBe(1_300_100);
const cat = run.schedule.vat.charges.find((c) => c.id === 'category:construction')!;
expect(cat base).toBe(68_296_221);
expect(run.schedule.totals.irrecoverable_vat_pence).toBe(1_300_100);
```

Monitoring: "the split identity holds with inflation inside original(construction), corpus-wide and on Z" — for Z attach a `monitoring` block at `reporting_month: 9` with five lines (any valid figures) and assert `original(construction) + original(contingency) === Σ uses.construction_pence` and `original(construction) === 66_000_000 + 5_496_722 + 0`. Python twins.

- [ ] **Step 2: Run, expect FAIL.** (VAT line charged on 6,000,000 → 1,200,000; original(construction) 66,000,000.)

- [ ] **Step 3: Implement.** `vat.ts`: in the overridden-package loop, `const net = p.amount_pence + p.inflation_pence; overriddenPackages += net; ... chargeLine(..., net)`; `vat.py` the same. `monitoring.ts` `originalBudgets`: `construction: costPlan.base_build_pence + costPlan.inflation_total_pence + costPlan.compliance_pence`; `monitoring.py` line ~135 likewise; update both docstrings' identity sentence.

- [ ] **Step 4: Run everything, PASS. Commit** — `feat(r15b): inflation follows the package's VAT override; monitoring original construction budget carries the allowance (spec 24.5)`.

---

### Task 5: Validation, the flag, the drift window

**Files:**
- Modify: `frontend/src/lib/model/validation.ts`, `app/financial_model/validation.py`; `frontend/src/lib/model/finance-types.ts` (`FlagCode`), `app/financial_model/types.py` (`FlagCode` Literal); `frontend/src/lib/model/due-diligence.ts`, `app/financial_model/due_diligence.py` (the flag); `tests/test_financial_model_validation.py` (`test_validation_messages_match_the_typescript_engine` gains a third window)
- Test: `validation.test.ts`, `due-diligence.test.ts` (or `metrics.test.ts`); `tests/test_financial_model_validation.py`, `tests/test_financial_model_due_diligence.py`

**The three messages, verbatim in both engines** (field → message):

| field | severity | message |
|---|---|---|
| `cost_plan.qs.inflation.annual_pct` | error | `Tender-price inflation rate must be a finite number of at least 0.` |
| `cost_plan.qs.inflation` | error | `Tender-price inflation needs a calendar: set the acquisition date, or record no allowance.` |
| `cost_plan.qs.inflation` | error | `Tender-price inflation needs the QS base date.` (only when `base_date` is blank after trim — beside R15's own "QS base date must be recorded.") |
| `cost_plan.qs.inflation.annual_pct` | warning | `Tender-price inflation above 15% p.a. is unusual - check the rate.` |

All four apply only when `cost_plan.mode === 'detailed'`, `qs` non-null and `inflation` non-null. Place them immediately after R15's `cost_plan.qs.base_date` rules, bracketed:

```ts
// --- R15b §24.7 begin ---
...
// --- R15b §24.7 end ---
```

and extend the Python drift test with a third window `ts.index('// --- R15b §24.7 begin ---')` … `ts.index('// --- R15b §24.7 end ---')`, asserting it contains **exactly four** `err(`/`warn(` calls (bounded, per the R15 rule that a window can go empty).

**The flag** (`no_inflation_allowance`, amber), in `dueDiligenceFlags(result, costPlan)` / `due_diligence_flags` after `provisional_sums_present`:

```ts
if (costPlan.mode === 'detailed' && costPlan.qs != null && (costPlan.qs.inflation ?? null) == null
    && costPlan.latest_midpoint_months_from_base != null && costPlan.latest_midpoint_months_from_base > 0) {
  const months = costPlan.latest_midpoint_whole_months_from_base!;   // published in Task 2; no arithmetic here
  out.push({ code: 'no_inflation_allowance', severity: 'amber', month: Math.floor(costPlan.latest_midpoint_month!), amount_pence: null,
    message: `no tender-price inflation allowance recorded: priced at ${costPlan.qs.base_date}; package spend midpoints fall up to ${months} whole months later` });
}
```

Python: `math.floor` for the month, `cost_plan.qs["inflation"]` (the republished dict), `cost_plan.latest_midpoint_whole_months_from_base` for the text, same message. Note `latest_midpoint_months_from_base` is null when `acquisition_date` is null (Task 2), which is the "skipped" arm.

- [ ] **Step 1: Failing tests** — validation: each rule, positive and negative (Z accepted; Z with `annual_pct: -1`; Z with `acquisition_date: null`; Z with `base_date: '  '` → both the R15 error and this one, and `computeCostPlan` never calls `monthsBetween` — assert via `vi.spyOn` on the due-diligence module export or by asserting `months_from_base` is null on the result; Z with `annual_pct: 16` → warning, 15 → none). Flag: `docZNoAllowance()` fires with `month: 12` and message ending `up to 18 whole months later`; Z fires nothing; Y (migrated) fires (base 2026-07-01, month 0 = 2026-09-01); a twin of Y with `base_date` moved after every midpoint does not; `acquisition_date: null` twin does not. Python twins. Add `'no_inflation_allowance'` to the FlagCode exhaustiveness test if one exists (grep `Record<FlagCode` in tests).

- [ ] **Step 2: FAIL → implement → PASS** both suites including the drift test. **Commit** — `feat(r15b): inflation validation rules, the no_inflation_allowance flag, drift window widened (spec 24.7)`.

---

### Task 6: Migration v13 → v14, the identity gate, the entry-point cutover

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts` (`CalculatorInputsV14 extends Omit<CalculatorInputsV13, 'inputs_version'> { inputs_version: 14 }`; union); `app/financial_model/types.py` (`class CalculatorInputsV14(CalculatorInputsV13)`, `inputs_version: Literal[14] = 14`; union; `parse_calculator_inputs` `if version == 14`)
- Modify: `frontend/src/lib/model/migrate.ts` (`isV14`, `migrateV13toV14`, `migrateInputsToV14`, `RECOGNISED_INPUTS_VERSIONS_V14`); `app/financial_model/migrate.py` (`is_v14`, `migrate_v13_to_v14`, `migrate_inputs_to_v14`, `_RECOGNISED_VERSIONS_V14`, `_v14_cost_plan`)
- Modify: `frontend/src/lib/conversion-defaults.ts` (`defaultCalculatorInputsV14`); `frontend/src/lib/model/index.ts`
- Cutover: `frontend/src/components/ConversionCalculator.tsx`, `ExportPage.tsx`, `frontend/src/lib/report-qa/memo-fixtures.ts`, `frontend/src/lib/model/__fixtures__/*.ts` (all to V14), `app/api/app.py`; page `Props` narrowed to `CalculatorInputsV14` where they name V13; `ConversionCostsPage`'s `DEFAULT_QS` gains `inflation: null`
- Docs (one line): `docs/financial-model/calculation-specification.md` §1.6 list gains `v14`
- Test: `migrate.test.ts` (v13 → v14 block mirroring the v12 → v13 one); `tests/test_migrate_v14.py` (ported from `test_migrate_v13.py`: `FIXTURES` filter `<= 13`, corpus ≥ 20, `version_excluded == []` until Task 7); `entry-point-guard.test.ts`, `tests/test_entry_point_guard.py`; `spec-versions.test.ts`; `tests/test_financial_model_types.py` (v14 parse dispatch)

**The migration:**

```ts
export function isV14(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV14 {
  return snapshot.inputs_version === 14 && 'due_diligence' in snapshot
    && typeof snapshot.cost_plan === 'object' && snapshot.cost_plan != null
    && (((snapshot.cost_plan as { qs?: unknown }).qs ?? null) === null || 'inflation' in ((snapshot.cost_plan as { qs: object }).qs));
}
export function migrateV13toV14(v13: CalculatorInputsV13): CalculatorInputsV14 {
  if (isV14(v13 as unknown as Record<string, unknown>)) throw new Error('migrateV13toV14: input is already a v14 document');
  return { ...v13, inputs_version: 14, cost_plan: { ...v13.cost_plan, qs: v13.cost_plan.qs == null ? null : { ...v13.cost_plan.qs, inflation: null } } };
}
```

`migrateInputsToV14` mirrors `migrateInputsToV13` exactly (recognised list 1..14; the version-14-but-fails-structural-check refusal names "missing `due_diligence` or `qs.inflation`"; the already-v14 merge branch spreads `saved` over `defaults` from `migrateV13toV14(migrateV12toV13(v12Chain))`). Python `_v14_cost_plan(plan)` writes `inflation: None` inside a non-None `qs`.

**Identity gate** (`migrate.test.ts` + `test_migrate_v14.py`): for every fixture with stored version ≤ 13 (K excluded by kind), `runAppraisal(migrateInputsToV13(doc))` vs `runAppraisal(migrateInputsToV14(doc))`: `model` (ledger) and `schedule` deep-equal with no exclusion, and `metrics` deep-equal with no exclusion **other than the flag list**, which is compared separately exactly as the v12 → v13 gate compares `due_diligence_unknown` (locate that block by content in `migrate.test.ts` / `test_migrate_v13.py` and mirror it): the v14 flags minus the v13 flags is `⊆ {'no_inflation_allowance'}`, the v13 flags minus the v14 flags is empty, **and** the difference is non-empty on Y (the named exclusion proven live). Validation identity: the three properties of §18.7, with an empty v14-only-rule list (the §24.7 rules cannot fire on a migrated document because `inflation` is null — assert that too). Boundary: a v14 document with a `qs` block round-trips through the Python model with `inflation: None` **present**; one without `qs` has no `inflation` anywhere.

- [ ] **Step 1: Write the tests (FAIL) → implement → cutover.** For the cutover follow the R15 Task 13 shape: every production call site to `migrateInputsToV14` / `migrate_inputs_to_v14` in one commit; both entry-point guards pass; `spec-versions.test.ts` passes once §1.6 lists v14; `test_entry_point_guard.py`'s server round-trip tests gain a v14 native case.

- [ ] **Step 2: Run everything** (both suites, tsc, lint, `npm run build`). **Commit** — `feat(r15b): inputs v14 - qs.inflation seeded null; identity gate with no exclusion; every entry point on v14 (spec 24.8)`.

---

### Task 7: Fixture Z and test-cases §24

**Files:**
- Create: `fixtures/financial-model/z-cost-plan-in-time.json`
- Modify: `frontend/src/lib/model/__fixtures__/cost-plan-in-time-docs.ts`, `tests/fixtures_cost_plan_in_time.py` (`docZ()` now loads Z through `migrateInputsToV14` and `docS()` through V14; `docZNoAllowance()` unchanged in shape)
- Modify: `golden-fixtures.test.ts` (`EXPECTED_FIXTURE_STEMS` + `'z-cost-plan-in-time'`), `tests/test_financial_model_fixtures.py` (same), `tests/test_migrate_v14.py` (`version_excluded == ['z-cost-plan-in-time']`)
- Modify: `docs/financial-model/test-cases.md` — new `## 24. The cost plan in time [R15b — calc 2.16.0]` with `### 24.1 Fixture Z`, presenting this plan's hand-derivation section **as the derivation** (Steps 1–7 above, with the S re-pin working as §24.2)

**Fixture Z** = `migrateInputsToV14(docS())` with the design-§13 changes applied, `inputs_version: 14`, `name: 'z-cost-plan-in-time'`, `kind: 'programme'`, a `note` in the corpus's style, and `expected_metrics` carrying: every S key it inherits (re-derived — Z's money differs from S's by the inflation line, the fee, the VAT), plus `cost_plan.inflation_total_pence: 5496722`, `cost_plan.construction_total_pence: 74796722`, `cost_plan.professional_total_pence: 8747967`, `cost_plan.lender_eligible_ratio: 0.9090909090909091`, `irrecoverable_vat_pence: 1300100`, `funding_gap_pence`, `peak_debt_pence`, `peak_debt_month`. Add dotted keys `cost_plan.inflation_total_pence` and `cost_plan.lender_eligible_ratio` to both harnesses' resolvable paths if they are not already generic (they are — `_resolve_path` / the `split('.')` reducer).

- [ ] **Step 1:** Write `test-cases.md` §24.1 first (the worksheet), then the fixture JSON with the cost-stack pins from the worksheet and the ledger pins left as `null` placeholders; run both golden suites; both engines must report identical figures for the ledger pins; write those in. Any cost-stack pin the engines disagree with the worksheet on is a defect to resolve, not a number to copy.

- [ ] **Step 2:** Run everything. **Commit** — `test(r15b): fixture Z, test-cases 24 worksheet, S re-pin working (spec 24)`.

---

### Task 8: Sensitivity assertions

**Files:**
- Test: `frontend/src/lib/model/apply-scenario.test.ts`, `sensitivity.test.ts`; `tests/test_financial_model_apply_scenario.py`, `tests/test_financial_model_sensitivity.py`

No engine change is expected; these are guards that must be seen passing for the stated reason.

- [ ] **Step 1:** Add: (a) "the five levers are order-independent on Z, inflation fields included" (the existing full-document equality test, run on `docZ()`); (b) "the cost lever scales inflation through the amounts: under `construction_cost_adjustment_pct: 10` every `inflation_pence` is within 1 pence of `Math.round(1.1 × base)` and every `midpoint_month` and `inflation_factor` is identical"; (c) "`phase_slip` on `construction` by +2 moves `pkg-structure.midpoint_month` by exactly 2 and its `months_from_base` by exactly 2; `pkg-enabling` (on `strip_out`, a predecessor) is unchanged"; (d) "the `timeline` lever on an auto-path document (Q) moves every midpoint by exactly half the term change" — derive: window `1..term−2` straight-line has midpoint `(term − 1) / 2`… verify: months 1..term−2 → mean = (1 + term − 2)/2 = (term − 1)/2; +2 months of term → +1 midpoint. Pin the absolute value, not the direction. Python twins. If any fails, the engine is wrong, not the test — investigate before touching the assertion.

- [ ] **Step 2:** PASS. **Commit** — `test(r15b): levers and the cost plan in time - order independence, cost scaling, slip and timeline move midpoints`.

---

### Task 9: Costs page — phase picker, timing cells, inflation control

**Files:**
- Modify: `frontend/src/components/calculator/ConversionCostsPage.tsx`
- Test: `frontend/src/components/calculator/ConversionCostsPage.test.tsx`

- [ ] **Step 1: Failing component tests** (React Testing Library, the file's existing pattern): (a) with a network document (S/Z via the builders) each package row has a `select` `aria-label="Package phase"` whose options are "Category default — Main construction" (value `''`) plus every phase whose `duration_months >= 1` (label + id), and choosing `mande_fitout` calls `onChange` with that package's `phase_id: 'mande_fitout'`; choosing the default writes `null`; (b) fee-line rows have the same control (`aria-label="Fee line phase"`); (c) on an auto-path document (Q) both selects are `disabled` and a hint "Tag lines to phases once the programme is a phase network" is shown; (d) each package row prints the window `6–8`, midpoint `6.50` and inflation `£3,754.60` read from `run.metrics.cost_plan.packages` (Z) — assert the literal strings; (e) the QS card shows a checkbox "No inflation allowance" (checked ⇔ `qs.inflation === null`), unchecking seeds `{ annual_pct: 0 }`, and a number input `aria-label="Tender-price inflation % p.a."`; (f) the coverage line gains `· inflation to spend midpoints £54,967.22 (8.33% of base build)` — `8.33` read off `result.inflation_pct_of_base_build` (Task 2), no division in JSX.

- [ ] **Step 2:** FAIL → implement. The phase options come from `inputs.programme` when `isProgrammeNetwork` (filter `duration_months >= 1`); the timing cells read `result.packages.find((p) => p.id === pkg.id)`; format with the page's existing `penceToPoundsExact` / `formatPct`. No arithmetic in JSX. `DEFAULT_QS` carries `inflation: null` (Task 6).

- [ ] **Step 3:** vitest, tsc, lint, build PASS. **Commit** — `feat(r15b): Costs page - phase picker on packages and fee lines, timing cells, inflation control (spec 24.6)`.

---

### Task 10: Memo

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts`; `frontend/src/lib/report-qa/memo-fixtures.ts` (a Z-based fixture, `costPlanInTimeInputs()`); `frontend/src/lib/report-qa/memo-release-gate.test.ts`
- Test: `frontend/src/lib/export-investment-memo.test.ts`

- [ ] **Step 1: Failing tests** (text-extraction assertions in the file's existing style): (a) Z's memo cost table has a row `  Tender-price inflation to spend midpoints — 6% p.a. from 2026-02-01` with `£54,967.22`, between the package schedule and the contingency rows; (b) the package schedule rows carry a phase / midpoint / inflation column set — assert `M&E fit-out` and `12.33` and `£11,172.56` appear on the M&E row; (c) the no-allowance twin prints `No tender-price inflation allowance recorded: priced at 1 February 2026; package spend midpoints fall up to 18 whole months later` — the date through the memo's `fmtPlainDate`, the integer read straight off `cp.latest_midpoint_whole_months_from_base` (Task 2), never floored in the generator; (d) the §13.4 sentence for a detailed plan with a QS record ends `; tender-price inflation 6% p.a. to each package's spend midpoint from 2026-02-01.` or `; no tender-price inflation allowance is recorded.`; (e) the finance section's cap sentence reads `Development advances are capped at 100% of lender-eligible construction spend month by month, plus professional and statutory costs in full` (verify the existing sentence's location by content — grep `development-cost advance` — and replace it); (f) the limitations list no longer contains the strings `per-package programme`, `uniform ratio` or `No inflation` (assert absent); (g) the release gate's FINAL fixture still renders FINAL.

- [ ] **Step 2:** FAIL → implement → PASS. **Commit** — `feat(r15b): memo - inflation line, package timing columns, 13.4 sentence, per-month cap sentence (spec 24.6)`.

---

### Task 11: Spec §24, amendments, migration notes, governance, release plan, version bump

**Files:**
- Modify: `docs/financial-model/calculation-specification.md`, `migration-notes.md`, `model-governance.md`; `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`; `docs/superpowers/specs/2026-08-25-r15b-cost-plan-in-time-design.md` (the two refinements recorded in §9); `frontend/src/lib/model/finance-types.ts` + `app/financial_model/types.py` (`CALC_VERSION = '2.16.0'`); `tests/test_financial_model_types.py` (the pin)

- [ ] **Step 1:** Write **§24 "The cost plan in time [R15b — calc 2.16.0]"** from design §§4–14 in the spec's voice, subsections 24.1–24.9 and the guards table, with the field-name refinements (`resolved_phase_id`; `months_from_base` published whenever base date and calendar exist; `inflation_pct_of_base_build`; `latest_midpoint_whole_months_from_base`). Amendments: §1.6 changelog entry for 2.16.0 and the version list (v14 already added in Task 6); §4.2(b) reads `uses[m].lender_eligible_construction_pence`, the R14 uniform-ratio sentence → historical note; §6 the auto-path package window sentence; §16.8 the new fields and `construction_total_pence`; §16.9 limitations 1, 2 and the inflation line → historical notes naming §24; §18.5 the share beside the bucket rule; §20.1 `original(construction)`; §20.5 limitation 3 → historical note; §23.6 names `qs.inflation`; §23.11 limitation 6 → historical note. `migration-notes.md` §17 (v13 → v14: the one write, the identity claim with no exclusion, the flag as the sole addition proven on Y, S's re-pin as the one behaviour change and why it is not a migration effect). `model-governance.md` §3.1 row `| R15b | 2.16.0 | v14 | — | The cost plan in time: per-package timing from the phase, tender-price inflation to the spend midpoint, per-month lender-eligible construction | §24 |`. Release plan: R15b row → **DONE, shipped**, and an **R15b status** paragraph in the established form (what it gave the appraisal; what moved and why — S only; what is deferred: dated index, per-package rates, a cash-flow column). `test-cases.md` §24.2 gets the S re-pin working if Task 7 did not already write it. Design doc §9 gains a short "Refinements at implementation" note.

- [ ] **Step 2:** `CALC_VERSION` 2.16.0 both engines; `spec-versions.test.ts` and `test_financial_model_types.py` pass; the whole gate: pytest, vitest, `tsc -b`, lint, build.

- [ ] **Step 3: Commit** — `docs(r15b): spec 24 and amendments (1.6, 4.2, 6, 16.8, 16.9, 18.5, 20.1, 20.5, 23.6, 23.11), migration notes 17, governance row, release plan; calc 2.16.0`.

---

## Self-review (done at authoring time)

- **Spec coverage.** §24.2 → Task 1; §24.3 → Task 2; §24.4 → Task 3; §24.5 (VAT, monitoring) → Task 4, (sensitivity) → Task 8; §24.6 (result) → Tasks 2/3/5/9, (surfaces) → Tasks 9/10; §24.7 → Task 5; §24.8 → Task 6; §24.9 and the guards → Tasks 1–8 and 11; fixture Z → Task 7; the 14 guards: midpoint curve-aware (T1/T2), amount-independence (T2), floor (T2), rounded lines (T2), share on S absolute (T3), R14 recovery (T3), denominator-zero (T3), override (T4), monitoring identity (T4), contingency uninflated + fee bases (T2), migration identity + flag on Y (T6), S re-pin (T3), calendar rule (T5), flag boundary (T5), lever order (T8), cost lever (T8), phase picker live (T9), drift (T5), versions (T6/T11).
- **Additions to the design found while planning** (recorded in the header and Task 11): `resolved_phase_id` as a new field; `months_from_base` published without an allowance; two published figures the generators need, `inflation_pct_of_base_build` and `latest_midpoint_whole_months_from_base`, both defined in Task 2 so Tasks 5, 9 and 10 read them — the R15 lesson that a result block must carry every figure a generator prints.
- **Type consistency.** `PackageTiming` fields are named identically in Tasks 1, 3 and 7; `lender_eligible_construction_pence` in Tasks 3, 4, 10; `inflation_total_pence` in Tasks 2, 4, 7, 9, 10; `latest_midpoint_months_from_base` in Tasks 2, 5, 10.
- **Reachable literals.** Every Z figure was computed by a script of the spec's formulas against S's actual document before being written here; the S re-pin figure is derived in closed form. The one test whose literal was *not* pre-verified is Task 2's "rounded lines" case, and the plan says so and tells the implementer to verify the rate before pinning.
