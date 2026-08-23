# R13 — The investment case: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the retained portion of a scheme earn income and support a *derived* take-out — an NOI build-up from the rent roll that has been inert since R1, a yield-derived investment value, and a take-out sized as `min(LTV cap, DSCR cap, ICR cap)` with the binding constraint named.

**Architecture:** A new `investment-case` module in each engine runs **strictly before** the ledger and reads nothing from it (§17.5's one-direction rule). It produces a monthly NOI series, a stabilised annual NOI, an investment value and three closed-form debt caps. `buildSchedule` consumes the series as a new receipt class and the quantum as the refinance advance; the ledger applies NOI in full to the senior facility in a fixed within-month order. Nothing feeds back. Three new sensitivity levers write disjoint fields through `applyScenario`, which stays the single point at which an inputs document is adjusted.

**Tech Stack:** TypeScript (Vitest) in `frontend/src/lib/model/`; Python 3.12 + Pydantic v2 (pytest) in `app/financial_model/`. The two engines mirror each other function-for-function; no calculation logic lives in React components or report generators.

**Spec:** `docs/superpowers/specs/2026-08-23-r13-investment-case-design.md` — read it before Task 1 and keep it open. Every task below cites the §19.x it implements. Where this plan and the spec disagree, **the spec wins and the plan is the defect** — say so rather than implementing the plan's version.

## Global Constraints

- **Versions:** `CALC_VERSION` `'2.11.0'` → `'2.12.0'` in **both** `frontend/src/lib/model/finance-types.ts` (last line) and `app/financial_model/types.py:888`. Inputs `v9` → `v10`.
- **Money is integer pence.** `Math.round` in TS, `money_round` (from `app/financial_model/engine.py:18`) in Python. Both round half-up, and every value they are handed in this release is non-negative, so the negative-half rounding difference between the two never arises. **Never introduce a float pence value.**
- **Caps floor, they do not round.** `Math.floor` / `math.floor` on all three debt caps (§19.4). This is a deliberate departure from §1.1's half-up default; a cap rounded up is a cap breached.
- **Both engines mirror.** Every rule added to `validation.ts` is added to `validation.py` with the **same field string and the same message text**. Every function added to `investment-case.ts` is added to `investment_case.py` with the same name in snake_case.
- **One direction only.** `computeInvestmentCase` must not read `MonthlyModel`, a ledger balance, or anything derived from the facility. If a task seems to need one, stop — that is the cyclic shape §19 exists to prevent.
- **No silent clamping.** A document that does not fit is a hard `ValidationIssue` with `severity: 'error'`, never a value quietly moved into range. Existing defensive clamps in `schedule.ts`/`schedule.py` stay, and stay unreachable for any document that passes validation.
- **No calculation logic in React or in `export-investment-memo.ts`.** Those read the result block only.
- **Migration adds only written `null`/`0`.** Three additions (§19.9): `investment_case: null`, and on a non-null `refinance`, `arrangement_fee_basis: 'fixed_pence'` and `arrangement_fee_pct: 0`.
- **EOL discipline.** Before every commit that rewrites a file wholesale, run `git ls-files --eol <path>` and confirm `i/lf`. R11 shipped a test file as a binary blob that no suite could see.
- **Ledger constants marked `⟨hand-derive⟩` are NOT authoritative.** Where a test in this plan pins a whole-ledger figure — a peak debt, a total interest, a closing balance — the number shown is an ILLUSTRATIVE placeholder of the right order of magnitude, not a derived one. Derive it by hand from the fixture before pinning it, and replace the literal. Engine-level constants (Tasks 1–3) carry no such marker: those are exact integer or single-expression arithmetic and were derived when this plan was written. **Never** obtain a pinned figure by running the code and pasting what it printed — that asserts the implementation agrees with itself.
- **Gate set, run before any merge:** `npx vitest run`, `pytest`, `npx tsc -b`, `npm run lint -- --max-warnings 0`, `npm run build`. Baselines to beat: **pytest 1963**, **vitest 2315**.
- **Watch every guard fail first.** Each task's failing-test step is not ceremony. A guard that has never been seen red is a guard nobody has tested. This release carries four guards that must fail against current `main` specifically: Task 12's resolved-month assertion, and Task 1's three liveness assertions.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `frontend/src/lib/model/investment-case.ts` | Input types, `OpexCode`, occupancy, the monthly NOI series, stabilised NOI, valuation, the three caps and the binding constraint. Pure — knows nothing about the ledger. |
| `frontend/src/lib/model/investment-case.test.ts` | Derivation, valuation and sizing unit tests. |
| `app/financial_model/investment_case.py` | Python mirror of the above. |
| `tests/test_financial_model_investment_case.py` | Python mirror of the tests. |
| `tests/test_migrate_v10.py` | v9 → v10 migration, the numeric gate and the three validation properties. |
| `fixtures/financial-model/t-investment-case.json` | Retain-all, twelve-phase network, anchored stabilisation with a three-month ramp, four operating lines across both bases, amortising take-out where **DSCR binds**. |
| `fixtures/financial-model/u-investment-case-ltv-binds.json` | Same scheme, higher yield and lower LTV cap so **LTV binds**. |
| `frontend/src/components/calculator/OperatingScheduleEditor.tsx` | Operating-line list: add/remove, code, basis, value, live stabilised-monthly readout. |
| `frontend/src/components/calculator/InvestmentCaseCard.tsx` | Stabilisation, valuation and take-out editors plus the three-cap readout with the binding one marked. |
| `frontend/src/components/calculator/ExitAnchorControl.tsx` | The R12-carried anchor control, shared by the tranche rows and the refinance row. |

**Modified:**

| File | Change |
|---|---|
| `frontend/src/lib/model/finance-types.ts` | **Task 4:** `CalculatorInputsV10`, `RefinanceInputsV10`, `RefinanceArrangementFeeBasis`, `CALC_VERSION`. **Task 8:** `Schedule.investment_case`, `Schedule.resolved_exit_months`, `Schedule.totals.net_operating_income_pence`, `MonthReceipts.net_operating_income_pence`, and the `InvestmentCaseResult` import (the type is born in Task 8, so Task 4 cannot reference it). **Task 9:** `LedgerMonth.net_operating_income_pence`, `MonthlyModel.totals.operating_shortfall_equity_pence`. **Task 11:** three `FlagCode`s, `AppraisalResultV2.investment_case`. |
| `frontend/src/lib/model/schedule.ts:219-320` | Investment case computed; NOI written onto receipts; `resolved_exit_months` published; refinance proceeds taken from the sized quantum when `investment_case` is non-null. |
| `frontend/src/lib/model/monthly-engine.ts:224-250` | The NOI block, between the VAT reclaim block and the sale-receipt block. |
| `frontend/src/lib/model/metrics.ts:380-400` | `investment_case` republished; §7 exclusions; the three new flags. |
| `frontend/src/lib/model/validation.ts` | §19.7's rules. |
| `frontend/src/lib/model/migrate.ts:860+` | `isV10`, `migrateV9toV10`, `migrateInputsToV10`. |
| `frontend/src/lib/model/sensitivity.ts:20-30` | Three levers appended to `SensitivityLever` and `LEVER_ORDER`; cell validity. |
| `frontend/src/lib/model/apply-scenario.ts:80-100` | Three lever arms. |
| `frontend/src/lib/conversion-types.ts:78-92` | `ScenarioOverrides` gains three fields. |
| `app/financial_model/types.py:365-435,810-890` | Mirrors; `CalculatorInputsV10`; `parse_calculator_inputs` dispatch; `FlagCode`; `CALC_VERSION`. |
| `app/financial_model/{schedule,engine,metrics,validation,migrate,sensitivity,apply_scenario}.py` | Mirrors. |
| `app/api/app.py:24,402` | v10 entry point (Task 18). |
| `frontend/src/components/calculator/ExitStrategyPage.tsx` | Anchor controls, the two new child components, `retain_all` rent-row population. |
| `frontend/src/components/calculator/CashflowPage.tsx` | NOI row; reads `resolved_exit_months`. |
| `frontend/src/lib/export-investment-memo.ts:2290-2320` | Investment-case section; reads `resolved_exit_months`. |
| `docs/financial-model/calculation-specification.md` | §19; §4.5, §12.1, §12.2, §1.6 edits; §18.10 limitation 9 closed. |
| `docs/financial-model/migration-notes.md` | v9 → v10 entry. |
| `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` | R13 row edited; unit-level sales ledger row added. |

---

## Task 1: The NOI derivation (TypeScript)

Implements **§19.1, §19.2**.

**Files:**
- Create: `frontend/src/lib/model/investment-case.ts`
- Create: `frontend/src/lib/model/investment-case.test.ts`

**Interfaces:**
- Consumes: `PhaseAnchor` from `./finance-types`; nothing else. This module must not import `monthly-engine`, `metrics` or `schedule`.
- Produces: `OpexCode`, `OPEX_CODES`, `OperatingLine`, `StabilisationInputs`, `TakeoutInputs`, `InvestmentCaseInputs`, `InvestmentCaseMonth`, `occupancyPctAt(month, stabilisationMonth, rampMonths, stabilisedPct): number`, `grossPotentialMonthlyPence(retainedUnits): number`, `operatingCostAt(lines, egrPence): number`, `noiSeries(args): InvestmentCaseMonth[]`, `stabilisedAnnualNoiPence(args): number`.

- [ ] **Step 1: Write the failing tests for occupancy and the monthly series**

```ts
// frontend/src/lib/model/investment-case.test.ts
import { describe, it, expect } from 'vitest';
import {
  occupancyPctAt, grossPotentialMonthlyPence, operatingCostAt,
  noiSeries, stabilisedAnnualNoiPence, OPEX_CODES,
} from './investment-case';
import type { OperatingLine } from './investment-case';

const LINES: OperatingLine[] = [
  { id: 'l1', code: 'management', label: 'Management', basis: 'pct_of_gross_rent', value: 10 },
  { id: 'l2', code: 'insurance', label: 'Insurance', basis: 'fixed_pence_per_month', value: 25_000 },
];

describe('occupancyPctAt (§19.2)', () => {
  it('is zero before the stabilisation month', () => {
    expect(occupancyPctAt(2, 3, 3, 96)).toBe(0);
  });

  it('ramps to the stabilised figure in the FINAL ramp month, not the month after', () => {
    // R = 3, U = 96: months 3,4,5 -> 32, 64, 96. Month 5 is s + R - 1.
    expect(occupancyPctAt(3, 3, 3, 96)).toBeCloseTo(32, 9);
    expect(occupancyPctAt(4, 3, 3, 96)).toBeCloseTo(64, 9);
    expect(occupancyPctAt(5, 3, 3, 96)).toBeCloseTo(96, 9);
    expect(occupancyPctAt(6, 3, 3, 96)).toBeCloseTo(96, 9);
  });

  it('with ramp_months = 0 is stabilised from the stabilisation month itself', () => {
    expect(occupancyPctAt(3, 3, 0, 96)).toBeCloseTo(96, 9);
    expect(occupancyPctAt(2, 3, 0, 96)).toBe(0);
  });
});

describe('operatingCostAt (§19.2)', () => {
  it('charges a percentage line on the EFFECTIVE gross rent, not potential rent', () => {
    // 10% of 500_000 = 50_000, plus the 25_000 fixed line.
    expect(operatingCostAt(LINES, 500_000)).toBe(75_000);
    // Half-occupied: the percentage line halves, the fixed line does not.
    expect(operatingCostAt(LINES, 250_000)).toBe(50_000);
  });

  it('is zero for an empty line schedule', () => {
    expect(operatingCostAt([], 500_000)).toBe(0);
  });
});

describe('noiSeries (§19.2)', () => {
  const args = {
    termMonths: 8,
    stabilisationMonth: 3,
    rampMonths: 2,
    stabilisedOccupancyPct: 100,
    grossPotentialMonthlyPence: 400_000,
    lines: LINES,
  };

  it('books nothing before stabilisation and the full figure after the ramp', () => {
    const s = noiSeries(args);
    expect(s).toHaveLength(8);
    expect(s[2]).toEqual({
      month: 2, occupancy_pct: 0, gross_potential_rent_pence: 400_000,
      effective_gross_rent_pence: 0, operating_cost_pence: 0, noi_pence: 0,
    });
    // month 3: 50% of 400_000 = 200_000 egr; opex = 20_000 + 25_000
    expect(s[3].effective_gross_rent_pence).toBe(200_000);
    expect(s[3].operating_cost_pence).toBe(45_000);
    expect(s[3].noi_pence).toBe(155_000);
    // month 4 onward: full 400_000; opex = 40_000 + 25_000
    expect(s[4].noi_pence).toBe(335_000);
    expect(s[7].noi_pence).toBe(335_000);
  });

  it('produces a SIGNED negative NOI when operating costs exceed rent', () => {
    const s = noiSeries({
      ...args, rampMonths: 0, grossPotentialMonthlyPence: 20_000,
    });
    // egr 20_000, opex = 2_000 + 25_000 = 27_000
    expect(s[3].noi_pence).toBe(-7_000);
  });
});

describe('stabilisedAnnualNoiPence (§19.2)', () => {
  it('is twelve times the STABILISED month, never the sum of the first twelve actual months', () => {
    const args = {
      termMonths: 24, stabilisationMonth: 3, rampMonths: 6,
      stabilisedOccupancyPct: 100, grossPotentialMonthlyPence: 400_000, lines: LINES,
    };
    const stabilised = stabilisedAnnualNoiPence(args);
    expect(stabilised).toBe(12 * 335_000);

    // The ramp makes the first twelve months materially lower. If the
    // implementation ever averages the series instead, this diverges — which is
    // the whole point of asserting both.
    const firstTwelve = noiSeries(args).slice(0, 12)
      .reduce((sum, m) => sum + m.noi_pence, 0);
    expect(firstTwelve).toBeLessThan(stabilised);
  });
});

describe('OPEX_CODES', () => {
  it('holds the ten §19.1 codes', () => {
    expect(OPEX_CODES).toEqual([
      'management', 'letting_and_re_letting', 'insurance',
      'repairs_and_maintenance', 'service_charge_shortfall', 'ground_rent',
      'utilities_on_voids', 'compliance_and_safety', 'bad_debt', 'other',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/model/investment-case.test.ts`
Expected: FAIL — `Failed to resolve import "./investment-case"`.

- [ ] **Step 3: Write the module**

```ts
// frontend/src/lib/model/investment-case.ts
/** R13 spec §19. The investment case: the retained portion's income, its value
 *  and the take-out that income supports.
 *
 *  This module runs STRICTLY BEFORE the ledger and reads nothing from it
 *  (§17.5's one-direction rule, applied to the second engine that could have
 *  been made cyclic). It must never import `monthly-engine`, `metrics` or
 *  `schedule` — a debt figure entering an NOI base is the one thing that would
 *  make this cyclic, exactly as a VAT figure entering a cost base would. */
import type { PhaseAnchor } from './finance-types';

export type OpexCode =
  | 'management' | 'letting_and_re_letting' | 'insurance'
  | 'repairs_and_maintenance' | 'service_charge_shortfall' | 'ground_rent'
  | 'utilities_on_voids' | 'compliance_and_safety' | 'bad_debt' | 'other';

/** Fixed order, as `VAT_CHARGE_CATEGORIES` and `PHASE_CODES` are. Unlike those,
 *  `operating_lines` is a USER-MANAGED list — this array is the enum's domain
 *  for validation and the editor's dropdown, not a required shape. */
export const OPEX_CODES: readonly OpexCode[] = [
  'management', 'letting_and_re_letting', 'insurance',
  'repairs_and_maintenance', 'service_charge_shortfall', 'ground_rent',
  'utilities_on_voids', 'compliance_and_safety', 'bad_debt', 'other',
];

export type OperatingLineBasis = 'fixed_pence_per_month' | 'pct_of_gross_rent';

export interface OperatingLine {
  id: string;
  code: OpexCode;
  label: string;
  basis: OperatingLineBasis;
  /** Pence per month on the fixed basis; a percentage on the other. */
  value: number;
}

export interface StabilisationInputs {
  /** §18.6 resolution, reused verbatim. null = use `month_offset`. */
  anchor: PhaseAnchor | null;
  month_offset: number;
  ramp_months: number;
  stabilised_occupancy_pct: number;
}

export interface TakeoutInputs {
  ltv_cap_pct: number;
  dscr_floor: number;
  icr_floor: number;
  annual_rate_pct: number;
  /** null = interest-only, which makes the DSCR and ICR caps equal at equal
   *  floors (§19.4). That equality is a feature and is asserted, not worked
   *  around. */
  amortisation_years: number | null;
  term_years: number;
}

export interface InvestmentCaseInputs {
  stabilisation: StabilisationInputs;
  operating_lines: OperatingLine[];
  valuation: { cap_yield_pct: number; purchasers_costs_pct: number };
  takeout: TakeoutInputs;
}

export interface InvestmentCaseMonth {
  month: number;
  occupancy_pct: number;
  gross_potential_rent_pence: number;
  effective_gross_rent_pence: number;
  operating_cost_pence: number;
  noi_pence: number;
}

/**
 * §19.2. Zero before `s`; a linear ramp reaching `stabilisedPct` in the FINAL
 * ramp month `s + R - 1`; `stabilisedPct` thereafter. `R = 0` collapses the
 * middle arm, so occupancy is stabilised from `s` itself.
 */
export function occupancyPctAt(
  month: number, stabilisationMonth: number, rampMonths: number, stabilisedPct: number,
): number {
  if (month < stabilisationMonth) return 0;
  if (rampMonths > 0 && month < stabilisationMonth + rampMonths) {
    return (stabilisedPct * (month - stabilisationMonth + 1)) / rampMonths;
  }
  return stabilisedPct;
}

/**
 * §19.2. The sum is over `exit_strategy.retained_units[]`, NOT over
 * `unit_mix.units`. For `blended` that list *is* the retained set; for
 * `retain_all` §19.7 rule 2 makes it complete. Those two facts together are the
 * only reason one expression serves both routes — summing `unit_mix` instead
 * would double-count nothing but would silently read zero rent for every unit
 * the user has not priced.
 */
export function grossPotentialMonthlyPence(
  retainedUnits: readonly { monthly_rent_pence: number }[],
): number {
  return retainedUnits.reduce((sum, r) => sum + r.monthly_rent_pence, 0);
}

/** §19.2. A percentage line is a percent of the month's EFFECTIVE gross rent —
 *  a management fee is charged on rent collected, not on rent hoped for. */
export function operatingCostAt(lines: readonly OperatingLine[], egrPence: number): number {
  return lines.reduce((sum, l) => sum + (
    l.basis === 'fixed_pence_per_month' ? l.value : Math.round((egrPence * l.value) / 100)
  ), 0);
}

export interface NoiSeriesArgs {
  termMonths: number;
  stabilisationMonth: number;
  rampMonths: number;
  stabilisedOccupancyPct: number;
  grossPotentialMonthlyPence: number;
  lines: readonly OperatingLine[];
}

export function noiSeries(args: NoiSeriesArgs): InvestmentCaseMonth[] {
  const out: InvestmentCaseMonth[] = [];
  for (let m = 0; m < args.termMonths; m += 1) {
    const occ = occupancyPctAt(
      m, args.stabilisationMonth, args.rampMonths, args.stabilisedOccupancyPct,
    );
    const egr = Math.round((args.grossPotentialMonthlyPence * occ) / 100);
    // Operating costs start with the income, not with the term: a scheme incurs
    // management and letting cost against a let asset, and charging them from
    // month 0 would book an operating loss through the whole build.
    const opex = m < args.stabilisationMonth ? 0 : operatingCostAt(args.lines, egr);
    out.push({
      month: m,
      occupancy_pct: occ,
      gross_potential_rent_pence: args.grossPotentialMonthlyPence,
      effective_gross_rent_pence: egr,
      operating_cost_pence: opex,
      noi_pence: egr - opex,
    });
  }
  return out;
}

/**
 * §19.2. TWELVE TIMES THE STABILISED MONTH. Never the sum of the first twelve
 * actual months, never an average over the term. Valuation (§19.3) and both
 * coverage caps (§19.4) read this figure and only this figure — capitalising
 * ramp-period NOI is the classic error in this calculation.
 */
export function stabilisedAnnualNoiPence(args: NoiSeriesArgs): number {
  const egr = Math.round(
    (args.grossPotentialMonthlyPence * args.stabilisedOccupancyPct) / 100,
  );
  return 12 * (egr - operatingCostAt(args.lines, egr));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/model/investment-case.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/investment-case.ts frontend/src/lib/model/investment-case.test.ts
git commit -m "feat(r13): NOI derivation -- occupancy ramp, operating lines, stabilised NOI (spec 19.2)"
```

---

## Task 2: Valuation and take-out sizing (TypeScript)

Implements **§19.3, §19.4**.

**Files:**
- Modify: `frontend/src/lib/model/investment-case.ts`
- Modify: `frontend/src/lib/model/investment-case.test.ts`

**Interfaces:**
- Consumes: `TakeoutInputs`, `stabilisedAnnualNoiPence` from Task 1.
- Produces: `annualDebtServiceFactor(takeout): number`, `investmentValuePence(annualNoiPence, capYieldPct, purchasersCostsPct): number`, `BindingConstraint = 'ltv' | 'dscr' | 'icr' | null`, `TakeoutSizing`, `sizeTakeout(annualNoiPence, valuePence, takeout): TakeoutSizing`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to frontend/src/lib/model/investment-case.test.ts
import {
  annualDebtServiceFactor, investmentValuePence, sizeTakeout,
} from './investment-case';
import type { TakeoutInputs } from './investment-case';

const IO: TakeoutInputs = {
  ltv_cap_pct: 65, dscr_floor: 1.3, icr_floor: 1.3,
  annual_rate_pct: 6, amortisation_years: null, term_years: 5,
};

describe('annualDebtServiceFactor (§19.4)', () => {
  it('is the bare rate on an interest-only take-out', () => {
    expect(annualDebtServiceFactor(IO)).toBeCloseTo(0.06, 12);
  });

  it('exceeds the rate once there is amortisation', () => {
    const a = annualDebtServiceFactor({ ...IO, amortisation_years: 25 });
    expect(a).toBeGreaterThan(0.06);
    // 6% over 25 years: monthly i = 0.005, N = 300 -> annual constant ~0.077322
    expect(a).toBeCloseTo(0.0773, 4);
  });

  it('handles a zero rate with amortisation as straight-line repayment', () => {
    // No interest: the whole principal amortises over N months, so the annual
    // constant is 12/N. Without this arm the annuity formula divides by zero.
    expect(annualDebtServiceFactor({ ...IO, annual_rate_pct: 0, amortisation_years: 10 }))
      .toBeCloseTo(12 / 120, 12);
  });
});

describe('investmentValuePence (§19.3)', () => {
  it('capitalises at the yield and deducts purchaser\'s costs in ONE rounding', () => {
    // 402_000_000 / 5.5 = 73_090_909.0909; / 1.0675 = 68_469_235.68 -> 68_469_236.
    // Hand-derived as one exact fraction, 321_600_000_000 / 4_697, to avoid
    // compounding the intermediate rounding.
    expect(investmentValuePence(4_020_000, 5.5, 6.75)).toBe(68_469_236);
  });

  it('is zero for a non-positive NOI', () => {
    expect(investmentValuePence(0, 5.5, 6.75)).toBe(0);
    expect(investmentValuePence(-1_000, 5.5, 6.75)).toBe(0);
  });
});

describe('sizeTakeout (§19.4)', () => {
  it('names LTV when the value cap is the tightest, and publishes all three', () => {
    // NOI 500_000/yr, value 20_000_000. LTV 65% -> 13_000_000.
    // DSCR: 500_000 / (1.3 × 0.06) = 6_410_256 -> DSCR binds, so raise NOI
    // instead: NOI 2_000_000 -> DSCR cap 25_641_025, ICR the same (interest-only).
    const s = sizeTakeout(2_000_000, 20_000_000, IO);
    expect(s.ltv_cap_pence).toBe(13_000_000);
    expect(s.dscr_cap_pence).toBe(25_641_025);
    expect(s.icr_cap_pence).toBe(25_641_025);
    expect(s.quantum_pence).toBe(13_000_000);
    expect(s.binding_constraint).toBe('ltv');
  });

  it('names DSCR when coverage is the tightest', () => {
    const s = sizeTakeout(500_000, 20_000_000, IO);
    expect(s.quantum_pence).toBe(6_410_256);
    expect(s.binding_constraint).toBe('dscr');
    expect(s.quantum_pence).toBeLessThan(s.ltv_cap_pence);
  });

  it('separates DSCR from ICR exactly when there is amortisation', () => {
    const amortising = { ...IO, amortisation_years: 25 };
    const io = sizeTakeout(500_000, 20_000_000, IO);
    expect(io.dscr_cap_pence).toBe(io.icr_cap_pence);

    const am = sizeTakeout(500_000, 20_000_000, amortising);
    expect(am.dscr_cap_pence).toBeLessThan(am.icr_cap_pence!);
    expect(am.binding_constraint).toBe('dscr');
  });

  it('floors every cap — a cap rounded up is a cap breached', () => {
    // The numerator is chosen so the fractional part EXCEEDS 0.5, which is the
    // only way this test can tell flooring from rounding:
    //   1_000_006 / (1 × 0.06) = 16_666_766.67
    //   floor -> 16_666_766      round-half-up -> 16_666_767
    // An earlier draft used 1_000_001, whose .333 fraction rounds DOWN anyway,
    // so the test named for this property proved nothing about it.
    const s = sizeTakeout(1_000_006, 999_999_999_999, {
      ...IO, dscr_floor: 1, icr_floor: 1, ltv_cap_pct: 100,
    });
    expect(s.dscr_cap_pence).toBe(16_666_766);
  });

  it('drops the coverage caps out of the minimum at a zero rate', () => {
    const s = sizeTakeout(500_000, 20_000_000, { ...IO, annual_rate_pct: 0 });
    expect(s.dscr_cap_pence).toBeNull();
    expect(s.icr_cap_pence).toBeNull();
    expect(s.binding_constraint).toBe('ltv');
    expect(s.quantum_pence).toBe(13_000_000);
  });

  it('reports the binding ratio as AT LEAST its floor, never below it', () => {
    const s = sizeTakeout(500_000, 20_000_000, IO);
    expect(s.achieved_dscr).toBeGreaterThanOrEqual(IO.dscr_floor);
    // Better than the floor by less than one pence of debt — the floor rounding
    // is the only reason it is not exact.
    expect(s.achieved_dscr!).toBeLessThan(
      500_000 / ((s.quantum_pence) * 0.06) + 1e-6,
    );
  });

  it('sizes to nothing on a non-positive NOI and names no constraint', () => {
    const s = sizeTakeout(0, 0, IO);
    expect(s.quantum_pence).toBe(0);
    expect(s.binding_constraint).toBeNull();
    expect(s.achieved_ltv_pct).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/investment-case.test.ts`
Expected: FAIL — `annualDebtServiceFactor is not a function`.

- [ ] **Step 3: Implement**

```ts
// append to frontend/src/lib/model/investment-case.ts

/**
 * §19.4. Annual debt service per £1 of debt — the constant that makes the DSCR
 * cap solve in closed form and lets this whole module stay one-directional.
 *
 * Interest-only: the bare rate. Amortising: twelve times the standard monthly
 * annuity constant, with a zero-rate arm because the annuity formula divides by
 * zero there (a 0% loan simply repays 1/N of principal a month).
 */
export function annualDebtServiceFactor(takeout: TakeoutInputs): number {
  const r = takeout.annual_rate_pct / 100;
  if (takeout.amortisation_years == null) return r;
  const i = r / 12;
  const n = takeout.amortisation_years * 12;
  if (n <= 0) return r;
  return 12 * (i === 0 ? 1 / n : i / (1 - (1 + i) ** -n));
}

/**
 * §19.3. The net-initial-yield convention: capitalise at the yield, then deduct
 * purchaser's costs. ONE expression and ONE rounding — a two-step derivation
 * would let a report's own arithmetic drift a penny from the published figure.
 */
export function investmentValuePence(
  annualNoiPence: number, capYieldPct: number, purchasersCostsPct: number,
): number {
  if (annualNoiPence <= 0 || capYieldPct <= 0) return 0;
  return Math.round(
    (annualNoiPence * 100) / capYieldPct / (1 + purchasersCostsPct / 100),
  );
}

export type BindingConstraint = 'ltv' | 'dscr' | 'icr' | null;

export interface TakeoutSizing {
  ltv_cap_pence: number;
  /** null when the cap cannot bind: `a === 0` for DSCR, `r === 0` for ICR. */
  dscr_cap_pence: number | null;
  icr_cap_pence: number | null;
  quantum_pence: number;
  binding_constraint: BindingConstraint;
  annual_debt_service_factor: number;
  achieved_ltv_pct: number | null;
  achieved_dscr: number | null;
  achieved_icr: number | null;
}

/**
 * §19.4. `quantum = min(applicable caps)`; the binding constraint is the argmin
 * with a stated precedence — LTV, then DSCR, then ICR — so an exact tie
 * resolves the same way every run (§1.4 determinism).
 *
 * ALL THREE caps are published, not only the binding one. A reader who sees
 * "LTV 4,200,000 / DSCR 3,610,000 / ICR 4,050,000 — DSCR binds" learns the shape
 * of the constraint; a reader given only 3,610,000 learns a number.
 *
 * Every cap FLOORS (§19.4), a deliberate departure from §1.1's half-up default.
 */
export function sizeTakeout(
  annualNoiPence: number, valuePence: number, takeout: TakeoutInputs,
): TakeoutSizing {
  const r = takeout.annual_rate_pct / 100;
  const a = annualDebtServiceFactor(takeout);
  const noi = Math.max(0, annualNoiPence);

  const ltvCap = Math.floor((valuePence * takeout.ltv_cap_pct) / 100);
  const dscrCap = a > 0 ? Math.floor(noi / (takeout.dscr_floor * a)) : null;
  const icrCap = r > 0 ? Math.floor(noi / (takeout.icr_floor * r)) : null;

  // Precedence order IS the tie-break: `<` (not `<=`) keeps the earlier entry.
  const candidates: { key: Exclude<BindingConstraint, null>; cap: number }[] = [
    { key: 'ltv', cap: ltvCap },
    ...(dscrCap == null ? [] : [{ key: 'dscr' as const, cap: dscrCap }]),
    ...(icrCap == null ? [] : [{ key: 'icr' as const, cap: icrCap }]),
  ];
  let binding = candidates[0];
  for (const c of candidates) if (c.cap < binding.cap) binding = c;

  const quantum = Math.max(0, binding.cap);
  const sized = quantum > 0;
  return {
    ltv_cap_pence: ltvCap,
    dscr_cap_pence: dscrCap,
    icr_cap_pence: icrCap,
    quantum_pence: quantum,
    binding_constraint: sized ? binding.key : null,
    annual_debt_service_factor: a,
    achieved_ltv_pct: sized && valuePence > 0 ? (quantum / valuePence) * 100 : null,
    achieved_dscr: sized && a > 0 ? noi / (quantum * a) : null,
    achieved_icr: sized && r > 0 ? noi / (quantum * r) : null,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/model/investment-case.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/investment-case.ts frontend/src/lib/model/investment-case.test.ts
git commit -m "feat(r13): investment value and closed-form take-out sizing (spec 19.3, 19.4)"
```

---

## Task 3: The Python mirror

Implements **§19.2, §19.3, §19.4** in the authoritative engine.

**Files:**
- Create: `app/financial_model/investment_case.py`
- Create: `tests/test_financial_model_investment_case.py`

**Interfaces:**
- Consumes: `money_round` from `app.financial_model.engine`.
- Produces: `OPEX_CODES`, `OperatingLine`, `StabilisationInputs`, `TakeoutInputs`, `InvestmentCaseInputs`, `InvestmentCaseMonth` (Pydantic models mirroring Task 1's interfaces), `occupancy_pct_at`, `gross_potential_monthly_pence`, `operating_cost_at`, `noi_series`, `stabilised_annual_noi_pence`, `annual_debt_service_factor`, `investment_value_pence`, `size_takeout`.

**Note on Pydantic placement:** the *input* models (`OperatingLine`, `StabilisationInputs`, `TakeoutInputs`, `InvestmentCaseInputs`) go in `app/financial_model/types.py` in Task 4, beside `RefinanceInputs`, because `CalculatorInputsV10` needs them. This task defines the **functions** and the **result** dataclasses only, and imports the input models from `types.py` once Task 4 lands. To keep Task 3 independently testable, define the functions to take **plain scalars and lists**, exactly as the TS versions do — none of them takes a whole `InvestmentCaseInputs`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_financial_model_investment_case.py
"""R13 spec Sec 19.2-19.4. Mirrors frontend/src/lib/model/investment-case.test.ts
test-for-test; a divergence between the two files is a port defect."""
import math

import pytest

from app.financial_model.investment_case import (
    OPEX_CODES,
    annual_debt_service_factor,
    gross_potential_monthly_pence,
    investment_value_pence,
    noi_series,
    occupancy_pct_at,
    operating_cost_at,
    size_takeout,
    stabilised_annual_noi_pence,
)

LINES = [
    {"id": "l1", "code": "management", "label": "Management",
     "basis": "pct_of_gross_rent", "value": 10.0},
    {"id": "l2", "code": "insurance", "label": "Insurance",
     "basis": "fixed_pence_per_month", "value": 25_000},
]

IO = {
    "ltv_cap_pct": 65.0, "dscr_floor": 1.3, "icr_floor": 1.3,
    "annual_rate_pct": 6.0, "amortisation_years": None, "term_years": 5.0,
}


def test_occupancy_zero_before_stabilisation():
    assert occupancy_pct_at(2, 3, 3, 96.0) == 0


def test_occupancy_reaches_stabilised_in_the_final_ramp_month():
    assert occupancy_pct_at(3, 3, 3, 96.0) == pytest.approx(32.0)
    assert occupancy_pct_at(4, 3, 3, 96.0) == pytest.approx(64.0)
    assert occupancy_pct_at(5, 3, 3, 96.0) == pytest.approx(96.0)
    assert occupancy_pct_at(6, 3, 3, 96.0) == pytest.approx(96.0)


def test_occupancy_zero_ramp_is_stabilised_immediately():
    assert occupancy_pct_at(3, 3, 0, 96.0) == pytest.approx(96.0)
    assert occupancy_pct_at(2, 3, 0, 96.0) == 0


def test_percentage_line_charges_on_effective_gross_rent():
    assert operating_cost_at(LINES, 500_000) == 75_000
    assert operating_cost_at(LINES, 250_000) == 50_000
    assert operating_cost_at([], 500_000) == 0


def test_gross_potential_sums_the_retained_rent_roll():
    assert gross_potential_monthly_pence(
        [{"monthly_rent_pence": 140_000}, {"monthly_rent_pence": 155_000}],
    ) == 295_000


def test_noi_series_books_nothing_before_stabilisation():
    s = noi_series(8, 3, 2, 100.0, 400_000, LINES)
    assert len(s) == 8
    assert s[2]["noi_pence"] == 0
    assert s[2]["operating_cost_pence"] == 0
    assert s[3]["effective_gross_rent_pence"] == 200_000
    assert s[3]["operating_cost_pence"] == 45_000
    assert s[3]["noi_pence"] == 155_000
    assert s[4]["noi_pence"] == 335_000
    assert s[7]["noi_pence"] == 335_000


def test_noi_is_signed_when_opex_exceeds_rent():
    s = noi_series(8, 3, 0, 100.0, 20_000, LINES)
    assert s[3]["noi_pence"] == -7_000


def test_stabilised_is_twelve_times_the_stabilised_month_not_the_ramp():
    stabilised = stabilised_annual_noi_pence(100.0, 400_000, LINES)
    assert stabilised == 12 * 335_000
    first_twelve = sum(m["noi_pence"] for m in noi_series(24, 3, 6, 100.0, 400_000, LINES)[:12])
    assert first_twelve < stabilised


def test_opex_codes_are_the_ten_spec_codes():
    assert OPEX_CODES == (
        "management", "letting_and_re_letting", "insurance",
        "repairs_and_maintenance", "service_charge_shortfall", "ground_rent",
        "utilities_on_voids", "compliance_and_safety", "bad_debt", "other",
    )


def test_debt_service_factor_is_the_bare_rate_interest_only():
    assert annual_debt_service_factor(IO) == pytest.approx(0.06)


def test_debt_service_factor_exceeds_the_rate_when_amortising():
    a = annual_debt_service_factor({**IO, "amortisation_years": 25.0})
    assert a > 0.06
    assert a == pytest.approx(0.0773, abs=1e-4)


def test_debt_service_factor_zero_rate_amortising_is_straight_line():
    a = annual_debt_service_factor({**IO, "annual_rate_pct": 0.0, "amortisation_years": 10.0})
    assert a == pytest.approx(12 / 120)


def test_investment_value_one_rounding():
    # 402_000_000 / 5.5 = 73_090_909.0909; / 1.0675 = 68_469_235.68 -> 68_469_236.
    assert investment_value_pence(4_020_000, 5.5, 6.75) == 68_469_236
    assert investment_value_pence(0, 5.5, 6.75) == 0
    assert investment_value_pence(-1_000, 5.5, 6.75) == 0


def test_ltv_binds_and_all_three_caps_are_published():
    s = size_takeout(2_000_000, 20_000_000, IO)
    assert s["ltv_cap_pence"] == 13_000_000
    assert s["dscr_cap_pence"] == 25_641_025
    assert s["icr_cap_pence"] == 25_641_025
    assert s["quantum_pence"] == 13_000_000
    assert s["binding_constraint"] == "ltv"


def test_dscr_binds_when_coverage_is_tightest():
    s = size_takeout(500_000, 20_000_000, IO)
    assert s["quantum_pence"] == 6_410_256
    assert s["binding_constraint"] == "dscr"
    assert s["quantum_pence"] < s["ltv_cap_pence"]


def test_dscr_and_icr_separate_exactly_when_amortising():
    io = size_takeout(500_000, 20_000_000, IO)
    assert io["dscr_cap_pence"] == io["icr_cap_pence"]
    am = size_takeout(500_000, 20_000_000, {**IO, "amortisation_years": 25.0})
    assert am["dscr_cap_pence"] < am["icr_cap_pence"]
    assert am["binding_constraint"] == "dscr"


def test_caps_floor_never_round_up():
    # The numerator is chosen so the fractional part EXCEEDS 0.5 -- the only way
    # this test can tell flooring from rounding:
    #   1_000_006 / (1 x 0.06) = 16_666_766.67
    #   floor -> 16_666_766      round-half-up -> 16_666_767
    s = size_takeout(1_000_006, 999_999_999_999,
                     {**IO, "dscr_floor": 1.0, "icr_floor": 1.0, "ltv_cap_pct": 100.0})
    assert s["dscr_cap_pence"] == 16_666_766


def test_zero_rate_drops_the_coverage_caps_out_of_the_minimum():
    s = size_takeout(500_000, 20_000_000, {**IO, "annual_rate_pct": 0.0})
    assert s["dscr_cap_pence"] is None
    assert s["icr_cap_pence"] is None
    assert s["binding_constraint"] == "ltv"
    assert s["quantum_pence"] == 13_000_000


def test_achieved_ratio_is_at_least_its_floor():
    s = size_takeout(500_000, 20_000_000, IO)
    assert s["achieved_dscr"] >= IO["dscr_floor"]
    assert s["achieved_dscr"] < 500_000 / (s["quantum_pence"] * 0.06) + 1e-6


def test_non_positive_noi_sizes_to_nothing_and_names_no_constraint():
    s = size_takeout(0, 0, IO)
    assert s["quantum_pence"] == 0
    assert s["binding_constraint"] is None
    assert s["achieved_ltv_pct"] is None
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_financial_model_investment_case.py -q`
Expected: FAIL — `ModuleNotFoundError: app.financial_model.investment_case`.

- [ ] **Step 3: Implement the Python mirror**

Port Task 1's and Task 2's functions verbatim. The only permitted deviations, and they are the standard ones for this codebase:

- `Math.round` → `money_round` (imported from `.engine`).
- **Argument shape.** The TS versions take a `NoiSeriesArgs` object; the Python
  versions take positional scalars, which is what the rest of `financial_model`
  does. Same names, same order of meaning, deliberately different call shape —
  recorded here so a reviewer does not read it as a port defect. Every other
  aspect of the mirror is exact.
- `Math.floor` → `math.floor`.
- `(1 + i) ** -n` → `(1 + i) ** -n` (identical).
- Return `dict`s with the same keys the TS interfaces declare (the tests above read them as dicts), typed with `TypedDict` so `mypy` keeps the key names honest.

```python
# app/financial_model/investment_case.py
"""R13 spec Sec 19. The investment case: the retained portion's income, its
value and the take-out that income supports.

Port of frontend/src/lib/model/investment-case.ts. This module runs STRICTLY
BEFORE the ledger and reads nothing from it (Sec 17.5's one-direction rule). It
must never import `engine` for anything but `money_round`, and never `schedule`
or `metrics` -- a debt figure entering an NOI base is the one thing that would
make this cyclic.
"""
from __future__ import annotations

import math
from typing import Any, Literal, TypedDict

from .engine import money_round

OpexCode = Literal[
    "management", "letting_and_re_letting", "insurance",
    "repairs_and_maintenance", "service_charge_shortfall", "ground_rent",
    "utilities_on_voids", "compliance_and_safety", "bad_debt", "other",
]

OPEX_CODES: tuple[OpexCode, ...] = (
    "management", "letting_and_re_letting", "insurance",
    "repairs_and_maintenance", "service_charge_shortfall", "ground_rent",
    "utilities_on_voids", "compliance_and_safety", "bad_debt", "other",
)


class InvestmentCaseMonth(TypedDict):
    month: int
    occupancy_pct: float
    gross_potential_rent_pence: int
    effective_gross_rent_pence: int
    operating_cost_pence: int
    noi_pence: int


class TakeoutSizing(TypedDict):
    ltv_cap_pence: int
    dscr_cap_pence: int | None
    icr_cap_pence: int | None
    quantum_pence: int
    binding_constraint: str | None
    annual_debt_service_factor: float
    achieved_ltv_pct: float | None
    achieved_dscr: float | None
    achieved_icr: float | None


def occupancy_pct_at(
    month: int, stabilisation_month: int, ramp_months: int, stabilised_pct: float,
) -> float:
    """Sec 19.2. Zero before `s`; a linear ramp reaching `stabilised_pct` in the
    FINAL ramp month `s + R - 1`; stabilised thereafter. `R = 0` collapses the
    middle arm."""
    if month < stabilisation_month:
        return 0.0
    if ramp_months > 0 and month < stabilisation_month + ramp_months:
        return (stabilised_pct * (month - stabilisation_month + 1)) / ramp_months
    return stabilised_pct


def gross_potential_monthly_pence(retained_units: list[Any]) -> int:
    """Sec 19.2. Sums `exit_strategy.retained_units[]`, NOT `unit_mix.units`.
    For `blended` that list IS the retained set; for `retain_all` Sec 19.7 rule 2
    makes it complete. Accepts dicts or Pydantic models."""
    total = 0
    for r in retained_units:
        total += r["monthly_rent_pence"] if isinstance(r, dict) else r.monthly_rent_pence
    return total


def _line_field(line: Any, name: str) -> Any:
    return line[name] if isinstance(line, dict) else getattr(line, name)


def operating_cost_at(lines: list[Any], egr_pence: int) -> int:
    """Sec 19.2. A percentage line is a percent of the month's EFFECTIVE gross
    rent -- a management fee is charged on rent collected."""
    total = 0
    for line in lines:
        if _line_field(line, "basis") == "fixed_pence_per_month":
            total += int(_line_field(line, "value"))
        else:
            total += money_round((egr_pence * _line_field(line, "value")) / 100)
    return total


def noi_series(
    term_months: int, stabilisation_month: int, ramp_months: int,
    stabilised_occupancy_pct: float, gross_potential: int, lines: list[Any],
) -> list[InvestmentCaseMonth]:
    out: list[InvestmentCaseMonth] = []
    for m in range(term_months):
        occ = occupancy_pct_at(m, stabilisation_month, ramp_months, stabilised_occupancy_pct)
        egr = money_round((gross_potential * occ) / 100)
        # Operating costs start with the income, not with the term.
        opex = 0 if m < stabilisation_month else operating_cost_at(lines, egr)
        out.append({
            "month": m,
            "occupancy_pct": occ,
            "gross_potential_rent_pence": gross_potential,
            "effective_gross_rent_pence": egr,
            "operating_cost_pence": opex,
            "noi_pence": egr - opex,
        })
    return out


def stabilised_annual_noi_pence(
    stabilised_occupancy_pct: float, gross_potential: int, lines: list[Any],
) -> int:
    """Sec 19.2. TWELVE TIMES THE STABILISED MONTH. Never the sum of the first
    twelve actual months, never an average over the term."""
    egr = money_round((gross_potential * stabilised_occupancy_pct) / 100)
    return 12 * (egr - operating_cost_at(lines, egr))


def _takeout_field(takeout: Any, name: str) -> Any:
    return takeout[name] if isinstance(takeout, dict) else getattr(takeout, name)


def annual_debt_service_factor(takeout: Any) -> float:
    """Sec 19.4. The constant that makes the DSCR cap solve in closed form."""
    r = _takeout_field(takeout, "annual_rate_pct") / 100
    amort = _takeout_field(takeout, "amortisation_years")
    if amort is None:
        return r
    i = r / 12
    n = amort * 12
    if n <= 0:
        return r
    return 12 * ((1 / n) if i == 0 else (i / (1 - (1 + i) ** -n)))


def investment_value_pence(
    annual_noi_pence: int, cap_yield_pct: float, purchasers_costs_pct: float,
) -> int:
    """Sec 19.3. ONE expression, ONE rounding."""
    if annual_noi_pence <= 0 or cap_yield_pct <= 0:
        return 0
    return money_round(
        (annual_noi_pence * 100) / cap_yield_pct / (1 + purchasers_costs_pct / 100),
    )


def size_takeout(annual_noi_pence: int, value_pence: int, takeout: Any) -> TakeoutSizing:
    """Sec 19.4. quantum = min(applicable caps); the binding constraint is the
    argmin with precedence LTV -> DSCR -> ICR on an exact tie. Every cap FLOORS."""
    r = _takeout_field(takeout, "annual_rate_pct") / 100
    a = annual_debt_service_factor(takeout)
    noi = max(0, annual_noi_pence)

    ltv_cap = math.floor((value_pence * _takeout_field(takeout, "ltv_cap_pct")) / 100)
    dscr_cap = (math.floor(noi / (_takeout_field(takeout, "dscr_floor") * a))
                if a > 0 else None)
    icr_cap = (math.floor(noi / (_takeout_field(takeout, "icr_floor") * r))
               if r > 0 else None)

    candidates: list[tuple[str, int]] = [("ltv", ltv_cap)]
    if dscr_cap is not None:
        candidates.append(("dscr", dscr_cap))
    if icr_cap is not None:
        candidates.append(("icr", icr_cap))
    # `<` (not `<=`) keeps the earlier entry, so precedence IS the tie-break.
    binding = candidates[0]
    for c in candidates:
        if c[1] < binding[1]:
            binding = c

    quantum = max(0, binding[1])
    sized = quantum > 0
    return {
        "ltv_cap_pence": ltv_cap,
        "dscr_cap_pence": dscr_cap,
        "icr_cap_pence": icr_cap,
        "quantum_pence": quantum,
        "binding_constraint": binding[0] if sized else None,
        "annual_debt_service_factor": a,
        "achieved_ltv_pct": (quantum / value_pence) * 100 if sized and value_pence > 0 else None,
        "achieved_dscr": noi / (quantum * a) if sized and a > 0 else None,
        "achieved_icr": noi / (quantum * r) if sized and r > 0 else None,
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_financial_model_investment_case.py -q`
Expected: PASS, 20 tests.

- [ ] **Step 5: Cross-engine agreement check**

Add one test to each side asserting the SAME hand-derived triple, so a future edit to one engine cannot drift silently:

```python
# tests/test_financial_model_investment_case.py
def test_cross_engine_pinned_triple():
    """The identical assertion lives in investment-case.test.ts. If you change
    one of these numbers, change both files or the engines have diverged."""
    # egr = 295_000 x 96% = 283_200; opex = 28_320 (10%) + 25_000 = 53_320;
    # monthly NOI 229_880; x12 = 2_758_560. Exact integer arithmetic.
    noi = stabilised_annual_noi_pence(96.0, 295_000, LINES)
    assert noi == 2_758_560
    # 2_758_560 x 100 / 5.5 = 50_155_636.36; / 1.0675 = 46_984_202.68 -> 46_984_203.
    value = investment_value_pence(noi, 5.5, 6.75)
    assert value == 46_984_203
    s = size_takeout(noi, value, {**IO, "amortisation_years": 25.0})
    # LTV cap 30_540_036; ICR cap 35_366_153; DSCR cap ~27_445_000 -- DSCR binds.
    assert s["binding_constraint"] == "dscr"
    # <hand-derive> the DSCR cap to the pence from a = 12 x i/(1-(1+i)^-300),
    # i = 0.005, then floor(noi / (1.3 x a)). It sits near 27_445_000; a result
    # outside 27_400_000..27_500_000 means the annuity factor is wrong, not that
    # this bound needs widening.
    assert s["quantum_pence"] == s["dscr_cap_pence"]
```

```ts
// frontend/src/lib/model/investment-case.test.ts
it('agrees with the Python engine on the pinned triple', () => {
  // The identical assertion lives in tests/test_financial_model_investment_case.py.
  // If you change one of these numbers, change both files or the engines have diverged.
  const noi = stabilisedAnnualNoiPence({
    termMonths: 24, stabilisationMonth: 0, rampMonths: 0,
    stabilisedOccupancyPct: 96, grossPotentialMonthlyPence: 295_000, lines: LINES,
  });
  expect(noi).toBe(2_758_560);
  const value = investmentValuePence(noi, 5.5, 6.75);
  expect(value).toBe(46_984_203);
  const s = sizeTakeout(noi, value, { ...IO, amortisation_years: 25 });
  expect(s.binding_constraint).toBe('dscr');
  expect(s.ltv_cap_pence).toBe(30_540_036);
  expect(s.quantum_pence).toBe(s.dscr_cap_pence);
});
```

Run both. **If the two engines disagree, do not adjust a number to make them
match** — find which one is wrong by hand-deriving the triple on paper and fix
that engine. A pinned constant edited to silence a cross-engine failure is the
defect this pair of tests exists to catch.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/investment_case.py tests/test_financial_model_investment_case.py frontend/src/lib/model/investment-case.test.ts
git commit -m "feat(r13): Python investment-case engine mirroring the TS module (spec 19.2-19.4)"
```

---

## Task 4: Inputs v10

Implements **§19.1**.

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts`
- Modify: `app/financial_model/types.py:365-435,810-890`
- Test: `frontend/src/lib/model/migrate.test.ts` (type-level only here), `tests/test_financial_model_types.py`

**Interfaces:**
- Consumes: `InvestmentCaseInputs` from `./investment-case` (TS), the same models newly declared in `types.py` (Python).
- Produces: `CalculatorInputsV10`, `RefinanceInputsV10`, `RefinanceArrangementFeeBasis = 'fixed_pence' | 'pct_of_quantum'`, `CALC_VERSION = '2.12.0'`.

- [ ] **Step 1: Write the failing test**

`tests/test_financial_model_types.py` **does not exist** — this task creates it,
along with its own `_minimal_v10_doc()` helper. An earlier draft of this brief
said the helper already existed "in this file for v9"; it does not, and neither
does the file. Build the helper from the fixture corpus through the migration
chain rather than hand-authoring a document dict, so it cannot drift from what a
real stored document looks like:

```python
# tests/test_financial_model_types.py
"""R13 spec Sec 19.1. The v10 input shape: the investment case and the two
refinance narrowings."""
import json
from pathlib import Path

from app.financial_model.migrate import migrate_inputs_to_v9


def _minimal_v10_doc() -> dict:
    """A valid v10 document, built by taking a real fixture up to v9 through the
    existing migration chain and then applying v10's own additions by hand.

    Built from a fixture rather than hand-authored so it cannot drift from the
    shape a stored document actually has. It does NOT use `migrate_inputs_to_v10`
    -- that function does not exist until Task 5, and a types test that depended
    on the migration would be testing two things at once."""
    raw = json.loads(
        Path("fixtures/financial-model/l-retain-all.json").read_text(encoding="utf-8"),
    )
    doc = migrate_inputs_to_v9(raw, None).model_dump()
    doc["inputs_version"] = 10
    doc["investment_case"] = None
    if doc.get("refinance") is not None:
        doc["refinance"]["arrangement_fee_basis"] = "fixed_pence"
        doc["refinance"]["arrangement_fee_pct"] = 0.0
    return doc


def test_v10_narrows_refinance_value_and_ltv_to_nullable():
    """Sec 19.1: `investment_case` SUPERSEDES the explicit pair, so the pair must
    be expressible as null. A v10 model that still required them would make the
    supersession unrepresentable and force validation to accept a contradiction."""
    from app.financial_model.types import CalculatorInputsV10, parse_calculator_inputs

    doc = _minimal_v10_doc()
    doc["refinance"] = {
        "month_offset": 12, "investment_value_pence": None, "ltv_pct": None,
        "arrangement_fee_pence": 0, "legal_costs_pence": 0, "anchor": None,
        "arrangement_fee_basis": "pct_of_quantum", "arrangement_fee_pct": 1.5,
    }
    parsed = parse_calculator_inputs(doc)
    assert isinstance(parsed, CalculatorInputsV10)
    assert parsed.refinance.investment_value_pence is None
    assert parsed.refinance.arrangement_fee_basis == "pct_of_quantum"


def test_parse_dispatch_routes_v10_to_v10():
    """R11 ruling R10, applied one version on: without a v10 branch the document
    falls through to the CalculatorInputsV2 default, silently dropping the
    investment case and every other post-v2 field."""
    from app.financial_model.types import CalculatorInputsV10, parse_calculator_inputs

    parsed = parse_calculator_inputs(_minimal_v10_doc())
    assert isinstance(parsed, CalculatorInputsV10)
    assert parsed.inputs_version == 10


def test_calc_version_is_2_12_0():
    from app.financial_model.types import CALC_VERSION
    assert CALC_VERSION == "2.12.0"
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_financial_model_types.py -q -k v10`
Expected: FAIL — `ImportError: cannot import name 'CalculatorInputsV10'`.

- [ ] **Step 3: Add the TypeScript types**

```ts
// frontend/src/lib/model/finance-types.ts — after CalculatorInputsV9

// NOT plain `ArrangementFeeBasis` — that name is already taken in this file by
// `FacilityTerms`'s own arrangement-fee basis, whose values are entirely
// different ('committed_net_facility' | 'committed_gross_facility'). The two
// live on different objects and the FIELD name `arrangement_fee_basis` is
// deliberately shared; only the type name has to differ.
export type RefinanceArrangementFeeBasis = 'fixed_pence' | 'pct_of_quantum';

/**
 * R13 spec §19.1. `investment_value_pence` and `ltv_pct` NARROW to nullable:
 * a non-null `investment_case` supersedes them, and both must then be null.
 * Not "ignored" — §2's never-silently-ignored rule makes reading one and
 * dropping the other the prohibited shape, so it is a validation error (§19.7
 * rule 5) rather than a silent override.
 *
 * All refinance EVENT costs stay here, where they are today. Only the
 * arrangement fee's basis is new, because a fixed-pence arrangement fee on a
 * derived quantum is an odd thing to ask a user for. `takeout` is sizing
 * policy; `refinance` is the event.
 */
export interface RefinanceInputsV10 extends Omit<RefinanceInputsV9,
  'investment_value_pence' | 'ltv_pct'> {
  investment_value_pence: number | null;
  ltv_pct: number | null;
  arrangement_fee_basis: RefinanceArrangementFeeBasis;
  arrangement_fee_pct: number;
}

/**
 * R13 spec §19.1. `investment_case` is a two-state field, top-level beside
 * `programme`, `vat` and `cost_plan`: `null` = calc 2.11.0's explicit
 * `investment_value_pence × ltv_pct` path, bit-identical; non-null = the
 * derived case.
 *
 * Top-level rather than nested under `refinance` (design decision 3): a
 * retained scheme earns rent whether or not it refinances, and nesting would
 * make operating cash flow conditional on a financing event it has nothing to
 * do with.
 */
export interface CalculatorInputsV10 extends Omit<CalculatorInputsV9,
  'inputs_version' | 'refinance'> {
  inputs_version: 10;
  refinance: RefinanceInputsV10 | null;
  investment_case: InvestmentCaseInputs | null;
}

export type AnyCalculatorInputs =
  CalculatorInputsV2 | CalculatorInputsV3 | CalculatorInputsV4
  | CalculatorInputsV5 | CalculatorInputsV6 | CalculatorInputsV7 | CalculatorInputsV8
  | CalculatorInputsV9 | CalculatorInputsV10;
```

Add to the imports at the top of the file:

```ts
// Only what THIS file's own declarations reference — `npm run lint --max-warnings 0`
// rejects an unused type import, and the re-exports below do not count as uses.
// `InvestmentCaseResult` is deliberately ABSENT: it does not exist until Task 8
// writes `computeInvestmentCase`, and importing it here would not compile.
// Task 8 adds both the import and the `Schedule.investment_case` field.
import type { InvestmentCaseInputs } from './investment-case';
export type {
  OpexCode, OperatingLineBasis, OperatingLine, StabilisationInputs, TakeoutInputs,
  InvestmentCaseInputs, InvestmentCaseMonth, TakeoutSizing, BindingConstraint,
} from './investment-case';
export { OPEX_CODES } from './investment-case';
```

Bump the last line: `export const CALC_VERSION = '2.12.0';`

- [ ] **Step 4: Add the Python types**

In `app/financial_model/types.py`, beside `RefinanceInputs` (line ~390):

```python
class OperatingLine(Model):
    """R13 spec Sec 19.1. `value` carries no upper Pydantic bound on the
    percentage basis -- the <= 100 rule is a spec rule owned by validation.py,
    which reports a spec-worded ValidationIssue rather than a generic 422.
    Same reasoning as SalesPhasingTranche.month_offset's."""

    id: str
    code: Literal[
        "management", "letting_and_re_letting", "insurance",
        "repairs_and_maintenance", "service_charge_shortfall", "ground_rent",
        "utilities_on_voids", "compliance_and_safety", "bad_debt", "other",
    ]
    label: str = ""
    basis: Literal["fixed_pence_per_month", "pct_of_gross_rent"]
    value: float


class StabilisationInputs(Model):
    anchor: PhaseAnchor | None = None
    month_offset: int = Field(le=1200)
    ramp_months: int = Field(le=1200)
    stabilised_occupancy_pct: float


class ValuationInputs(Model):
    cap_yield_pct: float
    purchasers_costs_pct: float


class TakeoutInputs(Model):
    ltv_cap_pct: float
    dscr_floor: float
    icr_floor: float
    annual_rate_pct: float
    amortisation_years: float | None = None
    term_years: float


class InvestmentCaseInputs(Model):
    stabilisation: StabilisationInputs
    # `max_length` is the same resource-exhaustion backstop as
    # SalesPhasingInputs.tranches' -- the real rules live in validation.py.
    operating_lines: list[OperatingLine] = Field(default_factory=list, max_length=200)
    valuation: ValuationInputs
    takeout: TakeoutInputs


class RefinanceInputsV10(RefinanceInputsV9):
    """Sec 19.1. The two narrowings. Overriding a parent field's type is the
    same pattern CalculatorInputsV9 uses to narrow `programme`."""

    investment_value_pence: int | None = None  # type: ignore[assignment]
    ltv_pct: float | None = None  # type: ignore[assignment]
    arrangement_fee_basis: Literal["fixed_pence", "pct_of_quantum"] = "fixed_pence"
    arrangement_fee_pct: float = 0.0
```

Beside `CalculatorInputsV9` (line ~817):

```python
class CalculatorInputsV10(CalculatorInputsV9):
    """Mirrors CalculatorInputsV9 with the Sec 19 investment case. Subclasses V9
    for the same reason V9 subclasses V8: the engine dispatches on it, and a flat
    re-declaration would make those isinstance checks silently False for v10
    documents."""

    inputs_version: Literal[10] = 10  # type: ignore[assignment]
    refinance: RefinanceInputsV10 | None = None  # type: ignore[assignment]
    investment_case: InvestmentCaseInputs | None = None
```

Extend `AnyCalculatorInputs` with `| CalculatorInputsV10`, and add the dispatch
branch **above** the v9 branch in `parse_calculator_inputs`:

```python
    # R11 ruling R10, applied one version on: without this branch a v10 document
    # falls through to the CalculatorInputsV2 default, silently dropping the
    # investment case and every other post-v2 field.
    if version == 10:
        return CalculatorInputsV10.model_validate(doc)
```

Bump `CALC_VERSION = "2.12.0"`.

- [ ] **Step 5: Run both suites**

Run: `pytest tests/test_financial_model_types.py -q && cd frontend && npx tsc -b`
Expected: PASS; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/model/finance-types.ts app/financial_model/types.py tests/test_financial_model_types.py
git commit -m "feat(r13): inputs v10 -- investment case, refinance narrowings, calc 2.12.0 (spec 19.1)"
```

---

## Task 5: Migration v9 → v10 and both identity gates

Implements **§19.9**.

**Files:**
- Modify: `frontend/src/lib/model/migrate.ts` (after `migrateInputsToV9`, line ~1017)
- Modify: `app/financial_model/migrate.py` (after `migrate_inputs_to_v9`, and `is_v2_or_later` at line 316)
- Create: `tests/test_migrate_v10.py`
- Modify: `frontend/src/lib/model/migrate.test.ts`

**Interfaces:**
- Consumes: `migrateInputsToV9` / `migrate_inputs_to_v9`.
- Produces: `isV10` (module-private in TS, `is_v10` in Python — same visibility rule R12 used for `isV9`), `migrateV9toV10(v9): CalculatorInputsV10`, `migrateInputsToV10(snapshot, project): CalculatorInputsV10`, and the same three in Python.

- [ ] **Step 1: Write the failing migration tests**

```python
# tests/test_migrate_v10.py
"""R13 spec Sec 19.9. The migration gate is numeric AND validation-side, and the
validation side is THREE separately falsifiable properties, not one set equality
-- R12's Sec 18.7 correction, applied from the start this time.

A single `set(v9_issues) == set(v10_issues)` assertion passes vacuously when the
new rules cannot fire at all, which is exactly how R12 shipped a gate that
proved nothing until it was rewritten mid-release.
"""
import json
from pathlib import Path

import pytest

from app.financial_model.metrics import derive_metrics
from app.financial_model.migrate import migrate_inputs_to_v9, migrate_inputs_to_v10
from app.financial_model.validation import validate_inputs

def _stored_version(path: Path) -> int:
    return json.loads(path.read_text(encoding="utf-8")).get("inputs_version", 1)


# Sec 19.9's gates compare the v9 arm against the v10 arm, so they can only run on
# a document BOTH arms accept. `migrate_inputs_to_v9` refuses a v10 document by
# design (Sec 3.5's each-migration-refuses-the-next rule), so the two v10-NATIVE
# fixtures Task 5b authors are excluded here and are covered by the golden-fixture
# suite instead.
#
# The exclusion is derived from the stored version, never hard-coded to two
# filenames: a hand-written skip list goes stale the moment a fixture is added,
# and a gate that silently stops covering a fixture is the failure mode this
# whole file exists to prevent.
ALL_FIXTURES = sorted(Path("fixtures/financial-model").glob("*.json"))
FIXTURES = [p for p in ALL_FIXTURES if _stored_version(p) <= 9]


def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    """Guards the filter above. If every fixture became v10-native this file
    would pass with zero parametrised cases and prove nothing.

    The EXCLUSION BOUND (how many fixtures sit outside the gate) is added by
    Task 5b, not here: Task 5b authors the two v10-native fixtures, so at this
    point the exclusion count is legitimately zero and asserting 2 would fail."""
    assert len(FIXTURES) >= 15


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_numeric_identity_corpus_wide(path):
    """Sec 19.9: no existing appraisal's computed values move. Every figure the
    v9 arm produces, the v10 arm produces identically."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    v9 = derive_metrics(migrate_inputs_to_v9(raw, None))
    v10 = derive_metrics(migrate_inputs_to_v10(raw, None))
    assert v10.model_dump(exclude={"calc_version", "investment_case"}) == \
        v9.model_dump(exclude={"calc_version"})


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_1_every_v9_issue_has_a_v10_counterpart(path):
    """Property 1 of three. Field strings may be renamed under a stated alias
    map; the SET of issues raised must not grow or shrink."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    v9_issues = {(i.severity, ALIAS.get(i.field, i.field), i.message)
                 for i in validate_inputs(migrate_inputs_to_v9(raw, None))}
    v10_issues = {(i.severity, i.field, i.message)
                  for i in validate_inputs(migrate_inputs_to_v10(raw, None))}
    assert v10_issues == v9_issues


ALIAS: dict[str, str] = {}   # no field renames this release; kept so a future
                             # rename has a declared home rather than a loosened
                             # assertion.


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_2_v10_only_rules_are_silent_on_a_migrated_document(path):
    """Property 2 of three. Migration writes `investment_case: null`, so every
    Sec 19.7 rule is inert on a migrated document."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    issues = validate_inputs(migrate_inputs_to_v10(raw, None))
    assert not [i for i in issues if i.field.startswith("investment_case")]


def test_property_3_the_v10_only_rules_can_actually_fire():
    """Property 3 of three, and the one that stops property 2 being vacuous.

    Without this, a release that wired the new rules to nothing would pass
    property 2 perfectly. R12 shipped exactly that shape and had to rewrite the
    gate mid-release."""
    raw = json.loads(Path("fixtures/financial-model/l-retain-all.json").read_text(encoding="utf-8"))
    doc = migrate_inputs_to_v10(raw, None).model_dump()
    doc["investment_case"] = {
        "stabilisation": {"anchor": None, "month_offset": 3, "ramp_months": 3,
                          "stabilised_occupancy_pct": 0.0},   # <- rule 8 violation
        "operating_lines": [],
        "valuation": {"cap_yield_pct": 5.5, "purchasers_costs_pct": 6.75},
        "takeout": {"ltv_cap_pct": 65.0, "dscr_floor": 1.3, "icr_floor": 1.3,
                    "annual_rate_pct": 6.0, "amortisation_years": 25.0, "term_years": 5.0},
    }
    from app.financial_model.types import CalculatorInputsV10
    issues = validate_inputs(CalculatorInputsV10.model_validate(doc))
    fields = {i.field for i in issues}
    assert "investment_case.stabilisation.stabilised_occupancy_pct" in fields


def test_migration_writes_only_nulls_and_zeroes():
    """Sec 19.9: three additions, all inert."""
    raw = json.loads(Path("fixtures/financial-model/j-blended-refinance.json").read_text(encoding="utf-8"))
    v10 = migrate_inputs_to_v10(raw, None)
    assert v10.investment_case is None
    assert v10.refinance is not None
    assert v10.refinance.arrangement_fee_basis == "fixed_pence"
    assert v10.refinance.arrangement_fee_pct == 0.0
    # The explicit pair survives untouched — this is the path that stays live.
    assert v10.refinance.investment_value_pence is not None
    assert v10.refinance.ltv_pct is not None


def test_is_v2_or_later_recognises_v10():
    """R12's Task 18b defect, third consecutive release. A v10 raw payload that
    fell through this check would be tagged `legacy_unreconciled` by app.py's
    `was_v1`, so every appraisal saved after release would carry the red
    'Legacy -- recalculation required' banner on its very first save."""
    from app.financial_model.migrate import is_v2_or_later
    raw = json.loads(Path("fixtures/financial-model/l-retain-all.json").read_text(encoding="utf-8"))
    v10 = migrate_inputs_to_v10(raw, None).model_dump()
    assert is_v2_or_later(v10) is True
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_migrate_v10.py -q`
Expected: FAIL — `cannot import name 'migrate_inputs_to_v10'`.

- [ ] **Step 3: Implement both migrations**

TypeScript, following `migrateV8toV9`'s shape exactly:

```ts
// frontend/src/lib/model/migrate.ts

function isV10(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV10 {
  return snapshot.inputs_version === 10 && 'investment_case' in snapshot;
}

/**
 * R13 spec §19.9. Three additions, all inert: `investment_case: null`, and on a
 * non-null `refinance`, `arrangement_fee_basis: 'fixed_pence'` and
 * `arrangement_fee_pct: 0` — which reproduce today's arithmetic exactly, since
 * the fixed basis reads `arrangement_fee_pence` and nothing else.
 *
 * `investment_value_pence` and `ltv_pct` are carried through NON-NULL. That is
 * the point: a migrated document stays on the explicit path, which stays live.
 */
export function migrateV9toV10(v9: CalculatorInputsV9): CalculatorInputsV10 {
  if (isV10(v9 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV9toV10: input is already a v10 document');
  }
  return {
    ...v9,
    inputs_version: 10,
    investment_case: null,
    refinance: v9.refinance == null ? null : {
      ...v9.refinance,
      arrangement_fee_basis: 'fixed_pence',
      arrangement_fee_pct: 0,
    },
  };
}

export function migrateInputsToV10(
  snapshot: Record<string, unknown>,
  project: { id: string } | null,
): CalculatorInputsV10 {
  const version = snapshot.inputs_version;
  if (typeof version === 'number' && (version < 1 || version > 10)) {
    throw new Error(
      `migrateInputsToV10: unrecognised inputs_version ${JSON.stringify(version)} `
      + '— this document was written by a newer build than this one.',
    );
  }
  if (version === 10 && !isV10(snapshot)) {
    throw new Error(
      'migrateInputsToV10: inputs_version is 10 but the document fails the v10 structural check '
      + '— it is missing `investment_case`.',
    );
  }
  if (isV10(snapshot)) {
    // Merge branch, mirroring migrateInputsToV9's: a document already at this
    // version still gains any field a later patch adds to the defaults.
    const defaults = migrateV9toV10(migrateV8toV9(migrateV7toV8(migrateV6toV7(migrateV5toV6(
      migrateV4toV5(migrateV3toV4(migrateInputsToV3(snapshot, project))),
    )))));
    return { ...defaults, ...snapshot } as CalculatorInputsV10;
  }
  return migrateV9toV10(migrateInputsToV9(snapshot, project));
}
```

Python: port the above into `app/financial_model/migrate.py` as `is_v10`,
`migrate_v9_to_v10`, `migrate_inputs_to_v10`, and **add `is_v10(snapshot)` to
`is_v2_or_later`'s disjunction** (line 316) with a comment recording that this is
the fourth consecutive release to need it.

- [ ] **Step 4: Mirror the TS migration tests**

Add to `frontend/src/lib/model/migrate.test.ts` the TS twins of the seven Python
tests above, using `migrateInputsToV9` / `migrateInputsToV10` and `deriveMetrics`.
Read the fixture corpus with `readdirSync` exactly as `golden-fixtures.test.ts`
already does.

- [ ] **Step 5: Run both**

Run: `pytest tests/test_migrate_v10.py -q && cd frontend && npx vitest run src/lib/model/migrate.test.ts`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/model/migrate.ts frontend/src/lib/model/migrate.test.ts app/financial_model/migrate.py tests/test_migrate_v10.py
git commit -m "feat(r13): v9->v10 migration, numeric gate and three validation properties (spec 19.9)"
```

---

## Task 5b: Fixtures and the shared v10 test-document builder

No feature. This task exists because **every task from 6 onward calls a document
builder**, and a plan that leaves each task to invent its own produces fourteen
subtly different "valid investment case" documents whose disagreements surface as
mysterious test failures three tasks later.

**Files:**
- Create: `fixtures/financial-model/t-investment-case.json`
- Create: `fixtures/financial-model/u-investment-case-ltv-binds.json`
- Create: `frontend/src/lib/model/__fixtures__/investment-case-docs.ts`
- Create: `tests/fixtures_investment_case.py`

**Interfaces:**
- Consumes: `CalculatorInputsV10`, `migrateInputsToV10`.
- Produces, in **both** engines with the same names:
  - `icDoc(overrides?): CalculatorInputsV10` — a valid retain-all v10 document with an investment case. Every override is a **single** named deviation, so a test that breaks one rule cannot accidentally break two.
  - `investmentCaseDoc(overrides?)` — alias of `icDoc`, used by the schedule/metrics tasks.
  - `explicitRefinanceDoc()` — `investment_case: null`, explicit `investment_value_pence` 5,000,000.00 and `ltv_pct` 60. The path that must stay bit-identical.
  - `anchoredSlippedDoc()` — a programme network with a slipped phase, one sale tranche at `month_offset` 12 anchored to resolve to **14**, refinance anchored to **18**. This is Task 12's document and the reason it can fail against `main`.
  - `noiDoc(overrides?)`, `retainAllNoiDoc()`, `blendedDoc({ rents })`, `mixedNoiDoc()`, `allFourInOneMonthDoc()`, `noiRedeemsDoc()`, `retainAllDocMissingRents()`.
  - `runLedger(doc)`, `applyLeversInOrder(doc, leverNames)`, `memoText(doc)` — thin wrappers over `buildMonthlyModel`, `applyScenario` and the memo generator, so no task re-derives the plumbing.

The **override keys** every later task uses, each changing exactly one thing:
`route`, `refinance`, `investmentCase`, `explicitValue`, `arrangementFeePct`,
`dropRetainedUnit`, `addRetainedUnitId`, `allRentsZero`, `anchorPhaseId`,
`stabilisationMonth`, `rampMonths`, `termMonths`, `occupancyPct`, `capYieldPct`,
`ltvCapPct`, `dscrFloor`, `icrFloor`, `amortisationYears`, `lines`,
`duplicateLineIds`, `pctLineValue`, `opexHeavy`, `opexExceedsRent`, `ltvBinds`,
`takeoutShortfall`, `salesSweepPct`.

- [ ] **Step 1: Write the failing test for the builder itself**

A builder nobody tests is a builder that quietly produces an invalid document and
turns every downstream failure into a hunt.

```ts
// frontend/src/lib/model/__fixtures__/investment-case-docs.test.ts
import { describe, it, expect } from 'vitest';
import { icDoc, explicitRefinanceDoc, anchoredSlippedDoc } from './investment-case-docs';
import { validateInputs } from '../validation';
import { buildSchedule } from '../schedule';

describe('the shared v10 builders', () => {
  it('produces a document with NO validation errors by default', () => {
    expect(validateInputs(icDoc()).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateInputs(explicitRefinanceDoc()).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateInputs(anchoredSlippedDoc()).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('makes the DEFAULT case one where DSCR binds', () => {
    // Every task from 8 onward assumes this. Asserted once, here, rather than
    // re-assumed silently in six files.
    expect(buildSchedule(icDoc()).investment_case!.takeout.binding_constraint).toBe('dscr');
  });

  it('makes the ltvBinds override actually change which constraint binds', () => {
    // The override that would be easiest to get wrong, and whose wrongness would
    // make Task 11's negative flag assertion pass for the wrong reason.
    expect(buildSchedule(icDoc({ ltvBinds: true })).investment_case!.takeout.binding_constraint)
      .toBe('ltv');
  });

  it('resolves the anchored tranche to month 14, NOT its month_offset of 12', () => {
    // Task 12's whole premise. If this is 12, that task cannot fail against
    // `main` and the carried defect goes unproven.
    const doc = anchoredSlippedDoc();
    expect(doc.sales_phasing!.tranches[0].month_offset).toBe(12);
    expect(buildSchedule(doc).resolved_exit_months.tranches[0]).toBe(14);
  });

  it('applies exactly ONE deviation per override key', () => {
    const base = icDoc();
    const one = icDoc({ occupancyPct: 80 });
    expect({ ...one, investment_case: null }).toEqual({ ...base, investment_case: null });
    expect(one.investment_case!.stabilisation.stabilised_occupancy_pct).toBe(80);
    expect(one.investment_case!.valuation).toEqual(base.investment_case!.valuation);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/__fixtures__/`
Expected: FAIL — module not found.

- [ ] **Step 3: Author the two JSON fixtures**

`t-investment-case.json` — `inputs_version: 10`, `route: 'retain_all'`, a twelve-phase
programme network, stabilisation anchored to `practical_completion + 1` with
`ramp_months: 3` and `stabilised_occupancy_pct: 96`, a rent row for **every**
unit summing to 295,000 pence a month, four operating lines spanning both bases
(`management` 10% and `letting_and_re_letting` 2% on the percentage basis;
`insurance` 25,000 and `compliance_and_safety` 8,000 on the fixed basis),
`cap_yield_pct: 5.5`, `purchasers_costs_pct: 6.75`, and an amortising take-out
(`ltv_cap_pct: 65`, `dscr_floor: 1.3`, `icr_floor: 1.3`, `annual_rate_pct: 6`,
`amortisation_years: 25`, `term_years: 5`) — the parameters of Task 3's pinned
triple, so the fixture and the unit test pin the same arithmetic.

`u-investment-case-ltv-binds.json` — the same scheme with `cap_yield_pct: 7.5`
and `ltv_cap_pct: 55`, so the LTV cap falls below both coverage caps.

- [ ] **Step 3b: Admit the two fixtures into the shared corpus**

Adding a fixture is not just writing a file — several existing suites enumerate
the corpus and will go red until they know about v10. This was missed when the
plan was written; it is real work, not boilerplate.

In `tests/test_financial_model_fixtures.py` and its mirror
`frontend/src/lib/model/golden-fixtures.test.ts`:

1. Add a `_V10_FIXTURES` group beside `_V5_FIXTURES`…`_V9_FIXTURES`.
2. `test_every_fixture_is_v5_v6_v7_v8_or_v9_and_each_group_is_non_empty` pins an
   exact stem list per version **and** asserts the groups sum to
   `len(APPRAISAL_FIXTURES)`. Rename it for v10, add the group to the sum, and pin
   the two new stems. Do NOT relax the sum to an inequality — that assertion is
   what catches a fixture whose `inputs_version` was mistyped dropping silently
   out of every parametrisation.
3. The lower-version migration-parity runs filter with expressions like
   `_version_of(...) not in (7, 8, 9)`. A v10 fixture cannot migrate *down*, so
   add `10` to each such exclusion. Check every one; there is a chain of them.

**`expected_metrics` may be partial.** `_assert_pins` iterates only the keys the
fixture supplies, so pin the figures you can derive by hand and leave the rest
out. Do NOT pin a figure by running the appraisal and pasting the output — that
asserts only that the code agrees with itself, and this release has already
caught three wrong constants that a harvested value would have concealed. Pin at
minimum: `gdv_pence`, `investment_case.stabilised.annual_noi_pence`,
`investment_case.valuation.investment_value_pence`, and
`investment_case.takeout.binding_constraint`. The first three are hand-derivable
from the rent roll and the yield; the fourth is the fixture's whole reason to
exist. **Note that the `investment_case` result block does not exist until Task
8** — if `run_appraisal` cannot yet produce it, pin only what exists now and say
so in your report; Task 8 or 11 adds the rest.

- [ ] **Step 4: Write both builders**

Build from the JSON fixtures via `migrateInputsToV10`, so a fixture and a builder
can never disagree about what a valid v10 document looks like.

- [ ] **Step 5: Run**

Run: `cd frontend && npx vitest run src/lib/model/__fixtures__/ && cd .. && pytest tests/ -q -k fixtures_investment_case`
Expected: PASS.

- [ ] **Step 6: Re-run Task 5's gates**

Adding two fixtures changes the corpus every gate iterates.

First, tighten Task 5's corpus guard now that the exclusion is real — append to
`test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink`:

```python
    assert len(ALL_FIXTURES) - len(FIXTURES) == 2, (
        "the v10-native fixture count changed -- confirm the new fixture is meant "
        "to be outside the migration gate, then update this bound deliberately"
    )
```

Run: `pytest tests/test_migrate_v10.py tests/test_golden_fixtures.py -q && cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts`
Expected: PASS, with the bound above confirming exactly two fixtures sit outside the migration gate.

- [ ] **Step 7: Commit**

```bash
git add fixtures/financial-model/t-investment-case.json fixtures/financial-model/u-investment-case-ltv-binds.json frontend/src/lib/model/__fixtures__/ tests/fixtures_investment_case.py
git commit -m "test(r13): v10 fixtures and the shared document builders every later task consumes"
```

---

## Task 6: Validation rules (TypeScript)

Implements **§19.7**.

**Files:**
- Modify: `frontend/src/lib/model/validation.ts`
- Modify: `frontend/src/lib/model/validation.test.ts`

**Interfaces:**
- Consumes: `OPEX_CODES` from `./investment-case`; `derivePhases` from `./programme` (already imported).
- Produces: no new exports — twelve rules inside `validateInputs`.

- [ ] **Step 1: Write the failing tests — one per rule, each with its accepting twin**

```ts
// frontend/src/lib/model/validation.test.ts
describe('§19.7 investment case validation', () => {
  // `icDoc` builds a valid v10 retain-all document with an investment case;
  // each test breaks exactly ONE thing, so a rule that fires for the wrong
  // reason is visible.
  const errFields = (d: CalculatorInputsV10) =>
    validateInputs(d).filter((i) => i.severity === 'error').map((i) => i.field);

  it('rule 1: rejects an investment case on a sell_all route', () => {
    expect(errFields(icDoc({ route: 'sell_all' }))).toContain('investment_case');
    expect(errFields(icDoc({}))).not.toContain('investment_case');
  });

  it('rule 2: rejects retain_all with a rent row missing for any unit', () => {
    // The silent-understatement trap: every unit is retained, but only listed
    // units carry a rent, so a short list understates NOI, value and quantum
    // with no error anywhere.
    const short = icDoc({ dropRetainedUnit: 'u2' });
    expect(errFields(short)).toContain('exit_strategy.retained_units');
    expect(errFields(icDoc({}))).not.toContain('exit_strategy.retained_units');
  });

  it('rule 3: rejects a rent row naming a unit that does not exist', () => {
    expect(errFields(icDoc({ addRetainedUnitId: 'ghost' })))
      .toContain('exit_strategy.retained_units');
  });

  it('rule 4: rejects a zero rent roll', () => {
    expect(errFields(icDoc({ allRentsZero: true })))
      .toContain('exit_strategy.retained_units');
  });

  it('rule 5: rejects a non-null explicit value alongside an investment case', () => {
    expect(errFields(icDoc({ explicitValue: 5_000_000_00 })))
      .toContain('refinance.investment_value_pence');
  });

  it('rule 5 (other arm): rejects a null explicit value with NO investment case', () => {
    expect(errFields(icDoc({ investmentCase: null, explicitValue: null })))
      .toContain('refinance.investment_value_pence');
  });

  it('rule 5 (third arm): a null refinance alongside an investment case is LEGAL', () => {
    // The indicative case of §19.1 — sizing computed and reported, nothing booked.
    expect(errFields(icDoc({ refinance: null }))).toEqual([]);
  });

  it('rule 6: rejects a stabilisation anchor naming an absent phase', () => {
    expect(errFields(icDoc({ anchorPhaseId: 'no_such_phase' })))
      .toContain('investment_case.stabilisation.anchor');
  });

  it('rule 7: rejects a stabilisation month past maturity, accepts its in-term twin', () => {
    expect(errFields(icDoc({ stabilisationMonth: 24, termMonths: 24 })))
      .toContain('investment_case.stabilisation.month_offset');
    expect(errFields(icDoc({ stabilisationMonth: 23, termMonths: 24 })))
      .not.toContain('investment_case.stabilisation.month_offset');
  });

  it('rule 8: rejects an occupancy outside (0, 100] and a fractional ramp', () => {
    expect(errFields(icDoc({ occupancyPct: 0 })))
      .toContain('investment_case.stabilisation.stabilised_occupancy_pct');
    expect(errFields(icDoc({ occupancyPct: 100.1 })))
      .toContain('investment_case.stabilisation.stabilised_occupancy_pct');
    expect(errFields(icDoc({ occupancyPct: 100 })))
      .not.toContain('investment_case.stabilisation.stabilised_occupancy_pct');
    expect(errFields(icDoc({ rampMonths: 2.5 })))
      .toContain('investment_case.stabilisation.ramp_months');
  });

  it('rule 9: rejects a non-positive yield', () => {
    expect(errFields(icDoc({ capYieldPct: 0 })))
      .toContain('investment_case.valuation.cap_yield_pct');
  });

  it('rule 10: rejects each out-of-range take-out term', () => {
    expect(errFields(icDoc({ ltvCapPct: 0 }))).toContain('investment_case.takeout.ltv_cap_pct');
    expect(errFields(icDoc({ dscrFloor: 0 }))).toContain('investment_case.takeout.dscr_floor');
    expect(errFields(icDoc({ icrFloor: -1 }))).toContain('investment_case.takeout.icr_floor');
    expect(errFields(icDoc({ amortisationYears: 0 })))
      .toContain('investment_case.takeout.amortisation_years');
    expect(errFields(icDoc({ amortisationYears: null })))
      .not.toContain('investment_case.takeout.amortisation_years');
  });

  it('rule 11: rejects duplicate line ids and an over-100 percentage line, allows an empty schedule', () => {
    expect(errFields(icDoc({ duplicateLineIds: true })))
      .toContain('investment_case.operating_lines');
    expect(errFields(icDoc({ pctLineValue: 101 })))
      .toContain('investment_case.operating_lines.l1.value');
    expect(errFields(icDoc({ lines: [] }))).toEqual([]);
  });

  it('rule 12: rejects an out-of-range arrangement fee percentage even with NO investment case', () => {
    expect(errFields(icDoc({ investmentCase: null, arrangementFeePct: 101 })))
      .toContain('refinance.arrangement_fee_pct');
  });
});
```

- [ ] **Step 2: Run to verify every one fails**

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts -t "19.7"`
Expected: FAIL, 14 tests. **Read the failures.** A test that fails with
"`icDoc` is not defined" has not yet proved anything about the rule — write the
builder first, re-run, and confirm each test fails on a *missing error* before
implementing.

- [ ] **Step 3: Implement the twelve rules**

Add to `validateInputs`, after the programme block. Every message is written
once and copied verbatim into `validation.py` in Task 7.

```ts
  // R13 spec §19.7. Gated on presence, not on `inputs_version >= 10`, matching
  // every other block here: a v9 document has no `investment_case` key, so the
  // whole block is skipped without a version test.
  const ic = 'investment_case' in inputs ? inputs.investment_case : null;
  const refi = 'refinance' in inputs ? inputs.refinance : null;

  // Rule 12 first: it applies whenever `refinance` is non-null, whether or not
  // there is an investment case, so it must not sit inside the `ic != null` arm.
  if (refi != null && 'arrangement_fee_pct' in refi) {
    const p = (refi as RefinanceInputsV10).arrangement_fee_pct;
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      err('refinance.arrangement_fee_pct', 'Refinance arrangement fee percentage must be between 0 and 100.');
    }
  }

  if (ic == null) {
    // Rule 5, the other arm — today's rule, restated. A refinance with no
    // investment case must carry the explicit pair, or it has no quantum at all.
    if (refi != null && ('investment_value_pence' in refi)) {
      if (refi.investment_value_pence == null) {
        err('refinance.investment_value_pence', 'Refinance investment value is required when there is no investment case.');
      }
      if (refi.ltv_pct == null) {
        err('refinance.ltv_pct', 'Refinance LTV is required when there is no investment case.');
      }
    }
  } else {
    const st = ic.stabilisation;
    const term = Math.max(1, Math.floor(inputs.finance.term_months));
    const route = inputs.exit_strategy.route;
    const rents = inputs.exit_strategy.retained_units;
    const unitIds = new Set(inputs.unit_mix.units.map((u) => u.id));

    // Rule 1
    if (route === 'sell_all') {
      err('investment_case', 'An investment case requires retained units — a sell-all exit retains none.');
    }

    // Rule 2 — the silent-understatement trap of §19.2. For `retain_all` EVERY
    // unit is retained but only listed units carry a rent, so a short list
    // understates NOI, the value and the take-out with no error anywhere.
    if (route === 'retain_all') {
      const rented = new Set(rents.map((r) => r.unit_id));
      const missing = inputs.unit_mix.units.filter((u) => !rented.has(u.id));
      if (missing.length > 0) {
        err('exit_strategy.retained_units', `A retain-all investment case needs a rent for every unit; ${missing.length} unit(s) have none.`);
      }
    }

    // Rule 3
    for (const r of rents) {
      if (!unitIds.has(r.unit_id)) {
        err('exit_strategy.retained_units', `Retained unit "${r.unit_id}" does not exist in the unit mix.`);
      }
    }

    // Rule 4
    if (rents.reduce((s, r) => s + r.monthly_rent_pence, 0) <= 0) {
      err('exit_strategy.retained_units', 'An investment case needs a rent roll greater than zero.');
    }

    // Rule 5 — supersession is an ERROR, never a silent override (§2).
    if (refi != null && 'investment_value_pence' in refi) {
      if (refi.investment_value_pence != null) {
        err('refinance.investment_value_pence', 'Remove the explicit refinance investment value — the investment case derives it.');
      }
      if (refi.ltv_pct != null) {
        err('refinance.ltv_pct', 'Remove the explicit refinance LTV — the investment case take-out supplies the cap.');
      }
    }

    // Rule 6 — reuses §18.8's anchor rule rather than restating it.
    if (st.anchor != null) {
      const net = 'programme' in inputs && inputs.programme != null
        && isProgrammeNetwork(inputs.programme) ? inputs.programme : null;
      if (net == null) {
        err('investment_case.stabilisation.anchor', 'A stabilisation anchor needs a programme network to anchor to.');
      } else if (!net.phases.some((p) => p.id === st.anchor!.phase_id)) {
        err('investment_case.stabilisation.anchor', `Stabilisation is anchored to phase "${st.anchor.phase_id}", which does not exist.`);
      }
    }

    // Rule 7 — a hard error on §18.8's reasoning: income that never starts
    // inside the term books zero NOI silently.
    const resolved = resolveStabilisationMonth(inputs, st);
    if (!Number.isInteger(resolved) || resolved < 0 || resolved > term - 1) {
      err('investment_case.stabilisation.month_offset', `Stabilisation must start within the facility term (month 0 to ${term - 1}); it resolves to month ${resolved}.`);
    }

    // Rule 8
    if (!Number.isFinite(st.stabilised_occupancy_pct)
      || st.stabilised_occupancy_pct <= 0 || st.stabilised_occupancy_pct > 100) {
      err('investment_case.stabilisation.stabilised_occupancy_pct', 'Stabilised occupancy must be greater than 0% and at most 100%.');
    }
    if (!Number.isInteger(st.ramp_months) || st.ramp_months < 0) {
      err('investment_case.stabilisation.ramp_months', 'The stabilisation ramp must be a whole number of months, zero or more.');
    }

    // Rule 9
    if (!Number.isFinite(ic.valuation.cap_yield_pct) || ic.valuation.cap_yield_pct <= 0) {
      err('investment_case.valuation.cap_yield_pct', 'The capitalisation yield must be greater than zero.');
    }
    if (!Number.isFinite(ic.valuation.purchasers_costs_pct) || ic.valuation.purchasers_costs_pct < 0) {
      err('investment_case.valuation.purchasers_costs_pct', "Purchaser's costs cannot be negative.");
    }

    // Rule 10
    const t = ic.takeout;
    if (!Number.isFinite(t.ltv_cap_pct) || t.ltv_cap_pct <= 0 || t.ltv_cap_pct > 100) {
      err('investment_case.takeout.ltv_cap_pct', 'The take-out LTV cap must be greater than 0% and at most 100%.');
    }
    if (!Number.isFinite(t.dscr_floor) || t.dscr_floor <= 0) {
      err('investment_case.takeout.dscr_floor', 'The DSCR floor must be greater than zero.');
    }
    if (!Number.isFinite(t.icr_floor) || t.icr_floor <= 0) {
      err('investment_case.takeout.icr_floor', 'The ICR floor must be greater than zero.');
    }
    if (!Number.isFinite(t.annual_rate_pct) || t.annual_rate_pct < 0) {
      err('investment_case.takeout.annual_rate_pct', 'The take-out interest rate cannot be negative.');
    }
    if (t.amortisation_years != null
      && (!Number.isFinite(t.amortisation_years) || t.amortisation_years <= 0)) {
      err('investment_case.takeout.amortisation_years', 'The amortisation period must be greater than zero, or empty for an interest-only take-out.');
    }
    if (!Number.isFinite(t.term_years) || t.term_years <= 0) {
      err('investment_case.takeout.term_years', 'The take-out term must be greater than zero.');
    }

    // Rule 11 — an EMPTY schedule is legal: NOI is then gross rent.
    const seen = new Set<string>();
    for (const l of ic.operating_lines) {
      if (l.id.trim() === '') {
        err('investment_case.operating_lines', 'Every operating line needs an id.');
      } else if (seen.has(l.id)) {
        err('investment_case.operating_lines', `Duplicate operating line id "${l.id}".`);
      }
      seen.add(l.id);
      if (!OPEX_CODES.includes(l.code)) {
        err(`investment_case.operating_lines.${l.id}.code`, `"${l.code}" is not a recognised operating cost code.`);
      }
      if (!Number.isFinite(l.value) || l.value < 0) {
        err(`investment_case.operating_lines.${l.id}.value`, 'An operating line value cannot be negative.');
      } else if (l.basis === 'pct_of_gross_rent' && l.value > 100) {
        err(`investment_case.operating_lines.${l.id}.value`, 'A percentage operating line cannot exceed 100% of gross rent.');
      }
    }
  }
```

**`resolveStabilisationMonth` must be written in this task, in
`investment-case.ts`, and exported** — both `validation.ts` (here) and
`computeInvestmentCase` (Task 8) call it, and a second copy is a second rule:

```ts
/** §19.7/§19.6. The stabilisation month under §18.6's resolution rule. Lives
 *  here, not in validation.ts and not inlined in computeInvestmentCase, because
 *  a rule written twice is a rule that drifts. */
export function resolveStabilisationMonth(
  inputs: AnyCalculatorInputs, stabilisation: StabilisationInputs,
): number {
  if (stabilisation.anchor == null) return stabilisation.month_offset;
  const prog = 'programme' in inputs ? inputs.programme : null;
  if (prog == null || !isProgrammeNetwork(prog)) return stabilisation.month_offset;
  const d = derivePhases(prog);
  if ('cycle' in d) return stabilisation.month_offset;
  const ph = d.byId[stabilisation.anchor.phase_id];
  return ph ? ph.start_month + stabilisation.anchor.offset_months : stabilisation.month_offset;
}
```

Task 8's `computeInvestmentCase` calls this, not its own inline resolution.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/validation.ts frontend/src/lib/model/validation.test.ts frontend/src/lib/model/investment-case.ts
git commit -m "feat(r13): investment case validation, twelve rules with accepting twins (spec 19.7)"
```

---

## Task 7: Validation rules (Python mirror)

Implements **§19.7** in the authoritative engine.

**Files:**
- Modify: `app/financial_model/validation.py`
- Modify: `tests/test_financial_model_validation.py`

**Interfaces:**
- Consumes: `OPEX_CODES`, `resolve_stabilisation_month` from `app.financial_model.investment_case`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Port Task 6's fourteen tests verbatim into `tests/test_financial_model_validation.py`,
using the same fixture-builder pattern the file already uses for the programme
rules. Every `field` string and every `message` string must be **character-identical**
to the TypeScript one.

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_financial_model_validation.py -q -k investment_case`
Expected: FAIL, 14 tests.

- [ ] **Step 3: Port the rules**

Port Task 6's block into `validate_inputs`, in the same position relative to the
programme block. The only permitted deviations: `Number.isFinite` → `math.isfinite`,
`Number.isInteger(x)` → `float(x).is_integer()`, `Set` → `set`.

- [ ] **Step 3b: Adopt the two orphaned migration-gate properties**

Task 5 built the v9→v10 migration gate but could implement only **Property 1**
of §19.9's three. Properties 2 and 3 need a **v10-only validation rule that
actually fires**, and no such rule existed until Task 6 (TypeScript) and this
task (Python) wrote them. Task 5's implementer correctly refused to fabricate a
rule to make the gate green — doing so would have reproduced R12's vacuous-gate
defect exactly. No task owned them; this one now does.

Add to `tests/test_migrate_v10.py`, and mirror in
`frontend/src/lib/model/migrate.test.ts`:

```python
@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_2_v10_only_rules_are_silent_on_a_migrated_document(path):
    """Property 2 of three. Migration writes `investment_case: null`, so every
    Sec 19.7 rule is inert on a migrated document."""
    doc = _load_fixture(path)["inputs"]
    issues = validate_inputs(migrate_inputs_to_v10(doc, None))
    assert not [i for i in issues if i.field.startswith("investment_case")]


def test_property_3_the_v10_only_rules_can_actually_fire():
    """Property 3 of three, and the one that stops Property 2 being vacuous.

    Without this, a release that wired the new rules to nothing would pass
    Property 2 perfectly. R12 shipped exactly that shape and had to rewrite the
    gate mid-release."""
    doc = _load_fixture(FIXTURE_DIR / "l-retain-all.json")["inputs"]
    v10 = migrate_inputs_to_v10(doc, None).model_dump()
    v10["investment_case"] = {
        "stabilisation": {"anchor": None, "month_offset": 3, "ramp_months": 3,
                          "stabilised_occupancy_pct": 0.0},   # <- rule 8 violation
        "operating_lines": [],
        "valuation": {"cap_yield_pct": 5.5, "purchasers_costs_pct": 6.75},
        "takeout": {"ltv_cap_pct": 65.0, "dscr_floor": 1.3, "icr_floor": 1.3,
                    "annual_rate_pct": 6.0, "amortisation_years": 25.0,
                    "term_years": 5.0},
    }
    issues = validate_inputs(CalculatorInputsV10.model_validate(v10))
    assert "investment_case.stabilisation.stabilised_occupancy_pct" in {i.field for i in issues}
```

**Watch Property 3 fail first** by temporarily commenting out rule 8 in
`validation.py`; it must go red, then green when restored. A gate nobody has
seen fail is a gate nobody has tested — and this is the specific gate R12
shipped in a vacuous state.

- [ ] **Step 3c: Close the Python/TypeScript test-parity gap Task 3 left**

`frontend/src/lib/model/investment-case.test.ts` asserts
`grossPotentialMonthlyPence([]) === 0`; `tests/test_financial_model_investment_case.py`
has no counterpart. Add `assert gross_potential_monthly_pence([]) == 0` to
`test_gross_potential_sums_the_retained_rent_roll`. One line, and "both engines
mirror" is a Global Constraint of this release rather than a nicety.

- [ ] **Step 4: Add the message-parity guard**

This is the guard that keeps the two engines honest without anyone re-reading
both files:

```python
def test_validation_messages_match_the_typescript_engine():
    """Governance Sec 1: every rule added to validation.ts is added to
    validation.py with the SAME field string and the SAME message text. This
    test reads the TS source and requires each Sec 19.7 message to appear in the
    Python source verbatim -- the two files drift silently otherwise, and a
    lender reading two different wordings for one rule is the visible symptom."""
    import re
    from pathlib import Path

    ts = Path("frontend/src/lib/model/validation.ts").read_text(encoding="utf-8")
    py = Path("app/financial_model/validation.py").read_text(encoding="utf-8")
    # Messages this release adds, keyed off the field prefix they are raised on.
    ts_msgs = re.findall(r"err\('(?:investment_case|refinance|exit_strategy)[^']*',\s*[`']([^`']+)[`']", ts)
    assert len(ts_msgs) >= 20, "the extractor stopped matching — fix it, do not lower the bound"
    for m in ts_msgs:
        # Template literals are compared on their fixed prefix, which is what
        # makes a reworded message fail while an interpolated id does not.
        prefix = m.split("${")[0].strip()
        if len(prefix) > 20:
            assert prefix in py, f"message missing from the Python engine: {prefix!r}"
```

- [ ] **Step 5: Run both suites**

Run: `pytest tests/test_financial_model_validation.py -q && cd frontend && npx vitest run src/lib/model/validation.test.ts`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/validation.py tests/test_financial_model_validation.py
git commit -m "feat(r13): Python validation mirror plus a cross-engine message-parity guard (spec 19.7)"
```

---

## Task 8: The schedule wiring

Implements **§19.5 (receipts), §19.6 (the result block and `resolved_exit_months`)**.

**Files:**
- Modify: `frontend/src/lib/model/schedule.ts:219-342`
- Modify: `app/financial_model/schedule.py` (mirror)
- Modify: `frontend/src/lib/model/schedule.test.ts`
- Modify: `tests/test_financial_model_schedule.py`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `Schedule.investment_case: InvestmentCaseResult | null`, `Schedule.resolved_exit_months: { tranches: number[]; refinance: number | null }`, `MonthReceipts.net_operating_income_pence`, `Schedule.totals.net_operating_income_pence`, and `computeInvestmentCase(inputs, termMonths, resolveAnchorMonth): InvestmentCaseResult | null` exported from `investment-case.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/model/schedule.test.ts
describe('§19.5/§19.6 investment case in the schedule', () => {
  it('publishes resolved_exit_months for BOTH tranches and refinance', () => {
    // The R12-carried gap: `Schedule` published no resolved tranche month, so
    // the memo and CashflowPage had nothing to read and printed the raw offset.
    const s = buildSchedule(anchoredSlippedDoc());
    expect(s.resolved_exit_months.tranches).toEqual([14, 18]);
    expect(s.resolved_exit_months.refinance).toBe(18);
    // And the resolved month is where the receipts ACTUALLY landed.
    expect(s.receipts[14].gross_sale_pence).toBeGreaterThan(0);
    expect(s.receipts[12].gross_sale_pence).toBe(0);
  });

  it('writes the NOI series onto receipts as its own class', () => {
    const s = buildSchedule(investmentCaseDoc());
    expect(s.receipts[2].net_operating_income_pence).toBe(0);
    expect(s.receipts[8].net_operating_income_pence).toBeGreaterThan(0);
    // Isolation: NOI is NOT a sale receipt.
    expect(s.receipts[8].gross_sale_pence).toBe(0);
    expect(s.totals.gross_sales_pence).toBe(0);   // retain_all
  });

  it('takes the refinance advance from the SIZED quantum when the case is non-null', () => {
    const s = buildSchedule(investmentCaseDoc());
    const ic = s.investment_case!;
    expect(ic.takeout.binding_constraint).toBe('dscr');
    expect(s.refinance!.net_proceeds_pence).toBe(
      ic.takeout.quantum_pence
      - Math.round((ic.takeout.quantum_pence * 1.5) / 100)   // pct_of_quantum basis
      - 45_000_00,                                            // legal costs
    );
  });

  it('leaves investment_case null — and the explicit path live — when the input is null', () => {
    const s = buildSchedule(explicitRefinanceDoc());
    expect(s.investment_case).toBeNull();
    expect(s.refinance!.net_proceeds_pence).toBe(
      Math.round((5_000_000_00 * 60) / 100) - 30_000_00 - 20_000_00,
    );
  });

  it('marks the case indicative when there is no refinance to book', () => {
    const s = buildSchedule(investmentCaseDoc({ refinance: null }));
    expect(s.investment_case!.takeout.is_booked).toBe(false);
    expect(s.investment_case!.takeout.quantum_pence).toBeGreaterThan(0);
    expect(s.refinance).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/schedule.test.ts -t "19.5"`
Expected: FAIL — `resolved_exit_months` undefined.

- [ ] **Step 3: Add `computeInvestmentCase` to `investment-case.ts`**

```ts
export interface InvestmentCaseResult {
  stabilisation_month: number;
  months: InvestmentCaseMonth[];
  stabilised: {
    effective_gross_rent_pence: number; operating_cost_pence: number;
    monthly_noi_pence: number; annual_noi_pence: number;
  };
  operating_lines: (OperatingLine & { stabilised_monthly_pence: number })[];
  valuation: {
    cap_yield_pct: number; purchasers_costs_pct: number;
    gross_value_pence: number; investment_value_pence: number;
  };
  takeout: TakeoutSizing & { is_booked: boolean };
  totals: {
    effective_gross_rent_pence: number; operating_cost_pence: number; noi_pence: number;
  };
}

/**
 * §19.6. Runs strictly before the ledger. `resolveAnchorMonth` is passed in
 * rather than recomputed here so the module keeps knowing nothing about the
 * programme — the SAME resolver `schedule.ts` uses for tranches and refinance
 * (§18.6), so there is one month-resolution rule in the model and not two.
 */
export function computeInvestmentCase(
  inputs: AnyCalculatorInputs,
  termMonths: number,
  resolveAnchorMonth: (anchor: PhaseAnchor | null, monthOffset: number) => number,
): InvestmentCaseResult | null {
  const ic = 'investment_case' in inputs ? inputs.investment_case : null;
  if (ic == null) return null;

  // Task 6's exported helper, NOT a second inline resolution. `resolveAnchorMonth`
  // is passed in for the tranche/refinance path; stabilisation goes through the
  // same §18.6 rule via the shared helper.
  const s = Math.min(Math.max(0, Math.floor(
    resolveStabilisationMonth(inputs, ic.stabilisation),
  )), termMonths - 1);
  const gross = grossPotentialMonthlyPence(inputs.exit_strategy.retained_units);
  const args: NoiSeriesArgs = {
    termMonths, stabilisationMonth: s, rampMonths: ic.stabilisation.ramp_months,
    stabilisedOccupancyPct: ic.stabilisation.stabilised_occupancy_pct,
    grossPotentialMonthlyPence: gross, lines: ic.operating_lines,
  };
  const months = noiSeries(args);
  const annualNoi = stabilisedAnnualNoiPence(args);
  const stabEgr = Math.round((gross * ic.stabilisation.stabilised_occupancy_pct) / 100);
  const stabOpex = operatingCostAt(ic.operating_lines, stabEgr);
  const value = investmentValuePence(
    annualNoi, ic.valuation.cap_yield_pct, ic.valuation.purchasers_costs_pct,
  );
  const sizing = sizeTakeout(annualNoi, value, ic.takeout);
  const refi = 'refinance' in inputs ? inputs.refinance : null;

  return {
    stabilisation_month: s,
    months,
    stabilised: {
      effective_gross_rent_pence: stabEgr,
      operating_cost_pence: stabOpex,
      monthly_noi_pence: stabEgr - stabOpex,
      annual_noi_pence: annualNoi,
    },
    operating_lines: ic.operating_lines.map((l) => ({
      ...l,
      stabilised_monthly_pence: l.basis === 'fixed_pence_per_month'
        ? l.value : Math.round((stabEgr * l.value) / 100),
    })),
    valuation: {
      cap_yield_pct: ic.valuation.cap_yield_pct,
      purchasers_costs_pct: ic.valuation.purchasers_costs_pct,
      // Published for the report's bridge, NOT an intermediate the value is
      // computed from — §19.3 keeps the value a single expression with a single
      // rounding so a two-step derivation cannot drift a penny from it.
      gross_value_pence: annualNoi > 0 && ic.valuation.cap_yield_pct > 0
        ? Math.round((annualNoi * 100) / ic.valuation.cap_yield_pct) : 0,
      investment_value_pence: value,
    },
    takeout: { ...sizing, is_booked: refi != null },
    totals: {
      effective_gross_rent_pence: months.reduce((t, m) => t + m.effective_gross_rent_pence, 0),
      operating_cost_pence: months.reduce((t, m) => t + m.operating_cost_pence, 0),
      noi_pence: months.reduce((t, m) => t + m.noi_pence, 0),
    },
  };
}
```

- [ ] **Step 4: Wire it into `buildSchedule`**

In `schedule.ts`, after `resolveAnchorMonth` is defined (line ~236) and after the
receipts array is built:

```ts
  // R13 spec §19.6. Computed here — after `resolveAnchorMonth` exists and
  // before anything reads receipts — because §19's whole point is that it runs
  // in ONE direction: it must not see a ledger balance, and nothing downstream
  // may feed a figure back into it.
  const investmentCase = computeInvestmentCase(inputs, term, resolveAnchorMonth);
  if (investmentCase != null) {
    investmentCase.months.forEach((mo, m) => {
      receipts[m].net_operating_income_pence = mo.noi_pence;
    });
  }
```

Change the refinance block to take the sized quantum:

```ts
  const refinanceInput = 'refinance' in inputs ? inputs.refinance : null;
  const refinance = refinanceInput == null ? null : {
    month: Math.min(Math.max(0, Math.floor(resolveAnchorMonth(
      'anchor' in refinanceInput ? (refinanceInput as RefinanceInputsV9).anchor : null,
      refinanceInput.month_offset,
    ))), term - 1),
    // R13 spec §19.4/§19.5. A non-null investment case SUPERSEDES the explicit
    // pair: the advance is the sized quantum, and the arrangement fee may be a
    // percentage of it. `investment_value_pence`/`ltv_pct` are null on that path
    // (§19.7 rule 5), which is why this branches rather than multiplying.
    net_proceeds_pence: (() => {
      const legal = refinanceInput.legal_costs_pence;
      if (investmentCase != null) {
        const q = investmentCase.takeout.quantum_pence;
        const basis = (refinanceInput as RefinanceInputsV10).arrangement_fee_basis ?? 'fixed_pence';
        const fee = basis === 'pct_of_quantum'
          ? Math.round((q * (refinanceInput as RefinanceInputsV10).arrangement_fee_pct) / 100)
          : refinanceInput.arrangement_fee_pence;
        return q - fee - legal;
      }
      return Math.round(
        ((refinanceInput.investment_value_pence ?? 0) * (refinanceInput.ltv_pct ?? 0)) / 100,
      ) - refinanceInput.arrangement_fee_pence - legal;
    })(),
  };
```

Publish both new fields on the returned object:

```ts
    investment_case: investmentCase,
    // R13 spec §19.6, closing §18.10 limitation 9. The memo and CashflowPage
    // print a tranche's month; before this field existed they printed the RAW
    // `month_offset` while the ledger used the resolved one, so an anchored
    // tranche on a slipped programme was reported at a month the ledger never
    // used. They read this instead.
    resolved_exit_months: {
      tranches: salesPhasing == null ? [] : salesPhasing.tranches.map((tr) => Math.min(
        Math.max(0, Math.floor(resolveAnchorMonth(
          'anchor' in tr ? (tr as SalesPhasingTrancheV9).anchor : null, tr.month_offset,
        ))), term - 1,
      )),
      refinance: refinance == null ? null : refinance.month,
    },
```

Add `net_operating_income_pence: 0` to the `MonthReceipts` initialiser and
`net_operating_income_pence` to `Schedule.totals`.

- [ ] **Step 5: Mirror in `schedule.py`**

Same insertions, same order, same comments. `compute_investment_case` goes in
`investment_case.py`.

- [ ] **Step 6: Run both suites**

Run: `cd frontend && npx vitest run src/lib/model/schedule.test.ts && cd .. && pytest tests/test_financial_model_schedule.py -q`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/model/schedule.ts frontend/src/lib/model/schedule.test.ts frontend/src/lib/model/investment-case.ts frontend/src/lib/model/finance-types.ts app/financial_model/schedule.py app/financial_model/investment_case.py tests/test_financial_model_schedule.py
git commit -m "feat(r13): schedule publishes the investment case, NOI receipts and resolved exit months (spec 19.5, 19.6)"
```

---

## Task 9: The ledger

Implements **§19.5**.

**Files:**
- Modify: `frontend/src/lib/model/monthly-engine.ts:224-250`
- Modify: `app/financial_model/engine.py:388-418`
- Modify: `frontend/src/lib/model/monthly-engine.test.ts`
- Modify: `tests/test_financial_model_engine.py`

**Interfaces:**
- Consumes: `Schedule.receipts[].net_operating_income_pence` from Task 8.
- Produces: `LedgerMonth.net_operating_income_pence`, `MonthlyModel.totals.operating_shortfall_equity_pence`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/model/monthly-engine.test.ts
describe('§19.5 NOI in the ledger', () => {
  it('applies NOI in full to the facility, ignoring sales_sweep_pct', () => {
    // sales_sweep_pct governs SALE receipts. NOI is income from an asset the
    // lender has security over; it is applied whole, like the VAT reclaim.
    const m = runLedger(noiDoc({ salesSweepPct: 50 }));
    const month = m.months[8];
    expect(month.net_operating_income_pence).toBe(335_000);
    expect(month.repayment_pence).toBe(335_000);
    expect(month.distribution_pence).toBe(0);
  });

  it('reduces peak debt, terminal balance and total interest — on ABSOLUTE figures', () => {
    const withNoi = runLedger(noiDoc({}));
    const without = runLedger(noiDoc({ allRentsZero: true }));
    // ⟨hand-derive⟩ all four from the fixture's ledger before pinning them.
    // ABSOLUTE figures, not directions: `toBeLessThan` would pass on a ledger
    // that applied NOI at a hundredth of its size, which is precisely the class
    // of defect a sweep guard exists to catch.
    expect(withNoi.peak_debt_pence).toBe(4_182_600_00);
    expect(without.peak_debt_pence).toBe(4_215_000_00);
    expect(withNoi.totals.interest_pence).toBe(287_411_00);
    expect(without.totals.interest_pence).toBe(301_884_00);
  });

  it('runs in the stated within-month order: VAT reclaim, NOI, sale, refinance', () => {
    // All four in month 18. Hand-derived closing balance; if the order changes,
    // this number changes, which is the point of pinning it.
    const m = runLedger(allFourInOneMonthDoc());
    // ⟨hand-derive⟩ the repayment and fee by walking the four flows in the
    // stated order. If the order changes these numbers change -- which is the
    // entire point of pinning them rather than asserting the balance alone.
    expect(m.months[18].closing_balance_pence).toBe(0);
    expect(m.months[18].repayment_pence).toBe(2_940_118_00);
    expect(m.months[18].exit_fee_pence).toBe(29_401_00);
  });

  it('funds a negative NOI month from additional equity, never a facility draw', () => {
    const m = runLedger(noiDoc({ opexHeavy: true }));
    const month = m.months[8];
    expect(month.net_operating_income_pence).toBeLessThan(0);
    expect(month.draw_pence).toBe(0);
    expect(month.additional_equity_pence).toBe(7_000);
    expect(m.totals.operating_shortfall_equity_pence).toBe(7_000 * 4);
  });

  it('charges the exit fee once when NOI achieves the first full redemption', () => {
    const m = runLedger(noiRedeemsDoc());
    const feeMonths = m.months.filter((x) => x.exit_fee_pence > 0);
    expect(feeMonths).toHaveLength(1);
    expect(feeMonths[0].month).toBe(9);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/monthly-engine.test.ts -t "19.5"`
Expected: FAIL, 5 tests.

- [ ] **Step 3: Implement the NOI block**

Insert in `monthly-engine.ts` **between** the VAT-reclaim block (ends line ~249)
and the `if (!isCash && r.gross_sale_pence > 0)` redemption-balance capture:

```ts
    // R13 spec §19.5. Order within the month is FIXED and stated: VAT reclaim,
    // then NOI, then the sales sweep, then the refinance event. All four can
    // fall in one month; any order could be defended, so the chosen one is
    // written down here and pinned by a test rather than left to whatever order
    // the code happens to run in.
    //
    // NOI is applied IN FULL, ignoring `sales_sweep_pct` — that percentage
    // governs SALE receipts, and NOI is income from an asset, not realisation of
    // one. Where it achieves the first full redemption the exit fee is charged
    // then, under §4.4.1's existing once-only rule, exactly as a VAT reclaim
    // that redeems does.
    const noi = r.net_operating_income_pence;
    if (noi > 0) {
      if (balance > 0 && !isCash) {
        const fee = facilityRedeemed ? 0 : exitFeeAmount(finance, grossFacility, peakDebt, balance);
        if (noi >= balance + fee) {
          repayment += balance;
          exitFee += fee;
          totalExitFee += fee;
          facilityRedeemed = true;
          distribution += noi - balance - fee;
          balance = 0;
        } else {
          // The §4.4 clamp, for the same reason the reclaim and the sweep carry
          // it: a payment landing in [balance, balance + fee) must not zero the
          // balance, or the fee is never charged and never carried.
          let applied = Math.min(noi, balance);
          if (applied === balance) applied = Math.max(0, noi - fee);
          repayment += applied;
          balance -= applied;
          distribution += noi - applied;
        }
      } else {
        distribution += noi;
      }
    } else if (noi < 0) {
      // §19.5: the DEVELOPMENT facility does not fund operating losses. The
      // shortfall draws uncommitted additional equity through §4.3's existing
      // mechanics, raising the existing `additional_equity_required` red flag.
      additionalEquity += -noi;
      totalOperatingShortfallEquity += -noi;
    }
```

Declare `let totalOperatingShortfallEquity = 0;` beside
`totalRefinanceShortfallEquity`, record `net_operating_income_pence: noi` on the
`LedgerMonth`, and publish `operating_shortfall_equity_pence:
totalOperatingShortfallEquity` in `totals`.

- [ ] **Step 4: Mirror in `engine.py`**

Same block, same position, same comments.

- [ ] **Step 5: Run both suites**

Run: `cd frontend && npx vitest run src/lib/model/monthly-engine.test.ts && cd .. && pytest tests/test_financial_model_engine.py -q`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/model/monthly-engine.ts frontend/src/lib/model/monthly-engine.test.ts frontend/src/lib/model/finance-types.ts app/financial_model/engine.py app/financial_model/types.py tests/test_financial_model_engine.py
git commit -m "feat(r13): NOI in the ledger -- fixed within-month order, full sweep, equity-funded shortfall (spec 19.5)"
```

---

## Task 10: Isolation — what NOI must NOT move

Implements **§19.5**'s isolation rules. This task adds no feature; it adds the guards that stop the next release quietly folding NOI into the wrong denominator.

**Files:**
- Modify: `frontend/src/lib/model/invariants.test.ts`
- Modify: `tests/test_financial_model_invariants.py`
- Modify: `frontend/src/lib/model/metrics.ts` (§7 exclusions only)
- Modify: `app/financial_model/metrics.py`

**Interfaces:**
- Consumes: Tasks 8 and 9.
- Produces: nothing new — `reconcile()` gains two exclusions.

- [ ] **Step 1: Write the failing guards**

```ts
// frontend/src/lib/model/invariants.test.ts
describe('§19.5 NOI isolation', () => {
  // Two documents with IDENTICAL sale receipts, one earning NOI and one not.
  // Every sale-denominated metric must be bit-identical between them.
  const withNoi = deriveMetrics(blendedDoc({ rents: 'market' }));
  const without = deriveMetrics(blendedDoc({ rents: 'zero' }));

  it('leaves every GDV-, LTGDV- and break-even-denominated metric untouched', () => {
    expect(withNoi.gdv_pence).toBe(without.gdv_pence);
    expect(withNoi.ltgdv_developer_pct).toBe(without.ltgdv_developer_pct);
    expect(withNoi.ltgdv_lender_pct).toBe(without.ltgdv_lender_pct);
    expect(withNoi.senior_breakeven_pence).toBe(without.senior_breakeven_pence);
    expect(withNoi.profit_on_gdv_pct).toBe(without.profit_on_gdv_pct);
  });

  it('does NOT enter profit', () => {
    // Profit is the development residual, GDV − TDC. NOI reaches returns the
    // honest way: through lower interest and through the equity cash-flow
    // vector. An implementer reading "operating income" will be tempted to add
    // it to profit; this is the assertion that stops them.
    expect(withNoi.profit_pence + withNoi.finance_costs_pence)
      .toBe(without.profit_pence + without.finance_costs_pence);
  });

  it('keeps has_realisation_event false on a retain-all case that earns NOI', () => {
    // Income is not realisation. But NOI distributions DO enter the equity
    // cash-flow vector, so an IRR can now exist where `irr_unavailable` used to
    // fire — an IRR that measures the income stream and ignores the retained
    // asset entirely. The unrealised labelling is what keeps that honest.
    const r = deriveMetrics(retainAllNoiDoc());
    expect(r.has_realisation_event).toBe(false);
    expect(r.return_on_equity_is_unrealised).toBe(true);
    expect(r.irr_annual_pct).not.toBeNull();
  });

  it('keeps §7 reconciling with NOI and an operating shortfall in the same document', () => {
    // NOI in and operating-shortfall equity out are BOTH outside §7's identity,
    // for the reason vat_reclaim_pence is: §7 balances project funding against
    // project costs, and hold-period operating flows are neither.
    const rec = reconcile(mixedNoiDoc());
    expect(rec.sources_pence).toBe(rec.uses_pence);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/invariants.test.ts -t "19.5"`
Expected: FAIL — §7 will not reconcile until the exclusions land.

- [ ] **Step 3: Add the two §7 exclusions**

In `reconcile()` in `metrics.ts`, exclude `operating_shortfall_equity_pence` from
the sources side on the same line and for the same reason as
`refinance_shortfall_equity_pence`, and confirm `net_operating_income_pence`
appears on neither side. Mirror in `metrics.py`.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/model/invariants.test.ts && cd .. && pytest tests/test_financial_model_invariants.py -q`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/invariants.test.ts frontend/src/lib/model/metrics.ts app/financial_model/metrics.py tests/test_financial_model_invariants.py
git commit -m "test(r13): NOI isolation guards -- not in GDV, not in profit, outside the sources-and-uses identity (spec 19.5)"
```

---

## Task 11: The result block and the three flags

Implements **§19.6, §19.7**'s flag table.

**Files:**
- Modify: `frontend/src/lib/model/metrics.ts:380-400`
- Modify: `frontend/src/lib/model/finance-types.ts` (`FlagCode`)
- Modify: `app/financial_model/metrics.py`, `app/financial_model/types.py` (`FlagCode`)
- Modify: `frontend/src/lib/model/metrics.test.ts`, `tests/test_financial_model_metrics.py`

**Interfaces:**
- Consumes: `Schedule.investment_case`.
- Produces: `AppraisalResultV2.investment_case: InvestmentCaseResult | null`; `FlagCode` gains `'investment_case_noi_non_positive' | 'stabilisation_incomplete_at_maturity' | 'takeout_constrained_by_coverage'`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/model/metrics.test.ts
describe('§19.6 result block and flags', () => {
  it('republishes the schedule\'s investment case rather than recomputing it', () => {
    const s = buildSchedule(investmentCaseDoc());
    const r = deriveMetrics(investmentCaseDoc());
    // §17.12's treatment of `vat`, applied here: ONE computation, republished.
    expect(r.investment_case).toEqual(s.investment_case);
  });

  it('is null on the explicit path, exactly as the input is', () => {
    expect(deriveMetrics(explicitRefinanceDoc()).investment_case).toBeNull();
  });

  it('raises a red flag on a non-positive stabilised NOI, and sizes to nothing', () => {
    const r = deriveMetrics(investmentCaseDoc({ opexExceedsRent: true }));
    const f = r.flags.find((x) => x.code === 'investment_case_noi_non_positive')!;
    expect(f.severity).toBe('red');
    expect(r.investment_case!.takeout.quantum_pence).toBe(0);
    expect(r.investment_case!.takeout.binding_constraint).toBeNull();
  });

  it('raises an amber flag when the ramp has not finished by maturity', () => {
    // NOT an error: refinancing mid-lease-up is a real structure. Flagged
    // because the valuation reads the STABILISED figure regardless, and that
    // gap should be visible rather than inferred.
    const r = deriveMetrics(investmentCaseDoc({ stabilisationMonth: 20, rampMonths: 8, termMonths: 24 }));
    expect(r.flags.find((x) => x.code === 'stabilisation_incomplete_at_maturity')!.severity)
      .toBe('amber');
  });

  it('raises an amber flag when coverage — not value — limits the take-out', () => {
    const dscrBinds = deriveMetrics(investmentCaseDoc());
    expect(dscrBinds.investment_case!.takeout.binding_constraint).toBe('dscr');
    expect(dscrBinds.flags.map((f) => f.code)).toContain('takeout_constrained_by_coverage');

    // Its LTV-binding twin must NOT raise it — a flag that fires on every
    // document tells a reader nothing.
    const ltvBinds = deriveMetrics(investmentCaseDoc({ ltvBinds: true }));
    expect(ltvBinds.investment_case!.takeout.binding_constraint).toBe('ltv');
    expect(ltvBinds.flags.map((f) => f.code)).not.toContain('takeout_constrained_by_coverage');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/metrics.test.ts -t "19.6"`
Expected: FAIL, 5 tests.

- [ ] **Step 3: Implement**

Add `investment_case: schedule.investment_case,` to the returned
`AppraisalResultV2` beside `vat: schedule.vat,` (line ~397). Add the three flag
codes to both `FlagCode` unions. Raise the flags in `deriveMetrics`, reading
`schedule.investment_case` — **never recomputing anything**.

- [ ] **Step 4: Run both**

Run: `cd frontend && npx vitest run src/lib/model/metrics.test.ts && cd .. && pytest tests/test_financial_model_metrics.py -q`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/metrics.ts frontend/src/lib/model/metrics.test.ts frontend/src/lib/model/finance-types.ts app/financial_model/metrics.py app/financial_model/types.py tests/test_financial_model_metrics.py
git commit -m "feat(r13): investment case republished on the result block, three new flags (spec 19.6)"
```

---

## Task 12: The R12-carried reporting defect

Implements **§19.6**'s carried fix; closes **§18.10 limitation 9**.

**This task's failing test must fail against current `main`.** That is not a
formality: a carried defect fixed without a failing assertion behind it is a
claim, and R12 recorded this exact gap precisely so R13 would prove it rather
than assert it.

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts:2290-2320`
- Modify: `frontend/src/components/calculator/CashflowPage.tsx`
- Modify: `frontend/src/lib/export-investment-memo.test.ts`
- Modify: `frontend/src/components/calculator/CashflowPage.test.tsx`

**Interfaces:**
- Consumes: `Schedule.resolved_exit_months` from Task 8.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test, and run it against `main` BEFORE writing any fix**

```ts
// frontend/src/lib/export-investment-memo.test.ts
describe('§18.10 limitation 9 — the resolved exit month (R12 carry)', () => {
  it('prints the month the LEDGER used, not the raw month_offset', () => {
    // An anchored tranche on a slipped programme: `month_offset` says 12,
    // the anchor resolves to 14, and the receipt lands at 14. Before this fix
    // the memo printed 12 — a month the ledger never used — on the one document
    // shape §18.10 limitation 9 flagged as reachable only outside the UI.
    const doc = anchoredSlippedDoc();          // tranche month_offset 12, anchor -> 14
    const schedule = buildSchedule(doc);
    expect(schedule.resolved_exit_months.tranches[0]).toBe(14);
    expect(schedule.receipts[14].gross_sale_pence).toBeGreaterThan(0);

    const text = memoText(doc);
    expect(text).toContain('Month 14');
    expect(text).not.toContain('Month 12');
  });
});
```

Run: `cd frontend && npx vitest run src/lib/export-investment-memo.test.ts -t "limitation 9"`

Expected: **FAIL, at the branch head, before you touch either printer** — the
memo prints `Month 12`. Record the failure output in the commit message.

**Do not try to run this against `main`.** By this point the branch carries
eleven committed tasks and `git stash` reverts working-tree changes, not commits,
so stashing would prove nothing. The branch-head failure is exactly as strong a
proof: Task 8 published `resolved_exit_months` but changed no printer, so the
memo and `CashflowPage` still print the raw `month_offset` here — the failure you
are watching IS the R12 carried defect, in the last run before it is fixed.

If it PASSES, stop: either `anchoredSlippedDoc()` is not actually anchored (Task
5b asserts it is — check that test first), or the defect is not what §18.10
described, and the plan needs correcting before any code changes.

- [ ] **Step 2: Fix both surfaces**

In `export-investment-memo.ts`, replace every `tranche.month_offset` read in the
sales-phasing table with `schedule.resolved_exit_months.tranches[i]`, and the
refinance row's `refinance.month_offset` with
`schedule.resolved_exit_months.refinance`. Do the same in the assumptions note in
`CashflowPage.tsx`.

Neither file may compute the resolution itself — that would be calculation logic
in a report generator, and the single resolver lives in `schedule.ts`.

- [ ] **Step 3: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/export-investment-memo.test.ts src/components/calculator/CashflowPage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-investment-memo.test.ts frontend/src/components/calculator/CashflowPage.tsx frontend/src/components/calculator/CashflowPage.test.tsx
git commit -m "fix(r13): memo and cashflow print the RESOLVED exit month (closes spec 18.10 limitation 9)"
```

---

## Task 13: Three sensitivity levers

Implements **§19.8**.

**Files:**
- Modify: `frontend/src/lib/conversion-types.ts:78-92`
- Modify: `frontend/src/lib/model/apply-scenario.ts`
- Modify: `frontend/src/lib/model/sensitivity.ts:20-30`
- Modify: `app/financial_model/{apply_scenario,sensitivity,types}.py`
- Modify: `frontend/src/lib/model/apply-scenario.test.ts`, `frontend/src/lib/model/sensitivity.test.ts`, and the Python twins

**Interfaces:**
- Consumes: `CalculatorInputsV10`.
- Produces: `SensitivityLever` gains `'exit_yield' | 'operating_cost' | 'vacancy'`; `LEVER_ORDER` gains the same three, appended; `ScenarioOverrides` gains `exit_yield_adjustment_pct`, `operating_cost_adjustment_pct`, `vacancy_adjustment_pct` (all `number`, migration-default `0`).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/model/apply-scenario.test.ts
describe('§19.8 the three exit levers', () => {
  it('exit_yield ADDS percentage points to the capitalisation yield', () => {
    const out = applyScenario(icDoc(), { ...ZERO, exit_yield_adjustment_pct: 1.5 });
    expect(out.investment_case!.valuation.cap_yield_pct).toBeCloseTo(7.0, 9);
  });

  it('operating_cost SCALES every line value, on both bases', () => {
    const out = applyScenario(icDoc(), { ...ZERO, operating_cost_adjustment_pct: 10 });
    expect(out.investment_case!.operating_lines[0].value).toBeCloseTo(11, 9);   // 10% pct line
    expect(out.investment_case!.operating_lines[1].value).toBe(27_500);          // 25_000 fixed
  });

  it('vacancy SUBTRACTS percentage points from stabilised occupancy', () => {
    const out = applyScenario(icDoc(), { ...ZERO, vacancy_adjustment_pct: 6 });
    expect(out.investment_case!.stabilisation.stabilised_occupancy_pct).toBeCloseTo(90, 9);
  });

  it('is a no-op by construction on an investment_case = null document', () => {
    // Exactly as phase_slip is on a null programme. A lever with nothing to
    // write writes nothing; it does not crash and it does not synthesise a block.
    const doc = explicitRefinanceDoc();
    const out = applyScenario(doc, {
      ...ZERO, exit_yield_adjustment_pct: 2,
      operating_cost_adjustment_pct: 50, vacancy_adjustment_pct: 10,
    });
    expect(out).toEqual({ ...doc, finance: out.finance });
    expect(out.investment_case).toBeNull();
  });

  it('keeps all EIGHT levers order-independent', () => {
    const orders = [
      ['gdv', 'construction_cost', 'timeline', 'interest_rate', 'phase_slip', 'exit_yield', 'operating_cost', 'vacancy'],
      ['vacancy', 'exit_yield', 'phase_slip', 'gdv', 'operating_cost', 'interest_rate', 'timeline', 'construction_cost'],
      ['operating_cost', 'timeline', 'vacancy', 'interest_rate', 'gdv', 'exit_yield', 'construction_cost', 'phase_slip'],
    ];
    const results = orders.map((o) => deriveMetrics(applyLeversInOrder(icDoc(), o)));
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});
```

```ts
// frontend/src/lib/model/sensitivity.test.ts
describe('§19.8 cell validity', () => {
  it('marks a cell invalid — never clamped — where the yield reaches zero', () => {
    const grid = runSensitivity(icDoc(), {
      rows: { lever: 'exit_yield', steps: [-6, -5.5, -5] },
      cols: { lever: 'gdv', steps: [0] },
      tornado: [],
    });
    expect(grid.cells[1][0].valid).toBe(false);   // 5.5 − 5.5 = 0
    expect(grid.cells[2][0].valid).toBe(true);
  });

  it('marks a cell invalid where vacancy drives occupancy to zero', () => {
    const grid = runSensitivity(icDoc(), {
      rows: { lever: 'vacancy', steps: [90, 96, 100] },
      cols: { lever: 'gdv', steps: [0] },
      tornado: [],
    });
    expect(grid.cells[0][0].valid).toBe(true);
    expect(grid.cells[1][0].valid).toBe(false);   // 96 − 96 = 0
  });

  it('gives a zero-width tornado bar, not an error, on a null investment case', () => {
    const t = runSensitivity(explicitRefinanceDoc(), {
      rows: { lever: 'gdv', steps: [0] }, cols: { lever: 'gdv', steps: [0] },
      tornado: [{ lever: 'exit_yield', low: -1, high: 1 }],
    }).tornado[0];
    expect(t.low.profit_pence).toBe(t.high.profit_pence);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/apply-scenario.test.ts src/lib/model/sensitivity.test.ts -t "19.8"`
Expected: FAIL, 8 tests.

- [ ] **Step 3: Implement**

Three fields on `ScenarioOverrides`:

```ts
  /** R13 spec §19.8. Percentage POINTS added to the capitalisation yield —
   *  a yield expansion is the take-out's headline stress. */
  exit_yield_adjustment_pct: number;
  /** Percent, scaling every operating line's `value` on BOTH bases: scaling a
   *  percentage line's percentage is the right stress for a management fee
   *  whose rate is renegotiated, and scaling a fixed line's pence is the right
   *  one for an insurance premium. */
  operating_cost_adjustment_pct: number;
  /** Percentage POINTS SUBTRACTED from stabilised occupancy. Subtracted, not
   *  added, so a POSITIVE lever value is an ADVERSE move — matching every other
   *  lever's sign convention in the tornado. */
  vacancy_adjustment_pct: number;
```

Three arms in `applyScenario`, gated on presence exactly as the `phase_slip` arm
is (`'investment_case' in inputs && inputs.investment_case != null`), so a v2–v9
document is left untouched rather than crashing on a field its shape does not
have.

Append the three levers to `SensitivityLever` and to the END of `LEVER_ORDER` —
newest and lowest-priority tie-breaks, not a reordering of the existing five.

In `sensitivity.ts`'s cell-validity check (§12.7), add: a cell is invalid where
the adjusted `cap_yield_pct <= 0`, where the adjusted
`stabilised_occupancy_pct <= 0`, or where any adjusted operating line `value < 0`.

Mirror all of it in Python. Migration writes `0` for all three fields (fold into
Task 5's `migrateV9toV10` if that task has already landed — otherwise add it here
and re-run Task 5's gates).

- [ ] **Step 4: Run both**

Run: `cd frontend && npx vitest run src/lib/model/ && cd .. && pytest tests/ -q -k "scenario or sensitivity"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/conversion-types.ts frontend/src/lib/model/apply-scenario.ts frontend/src/lib/model/sensitivity.ts frontend/src/lib/model/apply-scenario.test.ts frontend/src/lib/model/sensitivity.test.ts app/financial_model/apply_scenario.py app/financial_model/sensitivity.py app/financial_model/types.py tests/
git commit -m "feat(r13): exit_yield, operating_cost and vacancy levers; eight levers stay order-independent (spec 19.8)"
```

---

## Task 14: The exit anchor control (R12 carry)

Implements the missing UI half of **§18.10 limitation 9**.

**Files:**
- Create: `frontend/src/components/calculator/ExitAnchorControl.tsx`
- Create: `frontend/src/components/calculator/ExitAnchorControl.test.tsx`
- Modify: `frontend/src/components/calculator/ExitStrategyPage.tsx`

**Interfaces:**
- Consumes: `PhaseAnchor`, `ProgrammeNetwork` from `../../lib/model/finance-types`.
- Produces: `<ExitAnchorControl value={anchor} phases={net?.phases ?? []} monthOffset={n} onChange={(a: PhaseAnchor | null) => void} />`.

- [ ] **Step 1: Write the failing component tests**

```tsx
// frontend/src/components/calculator/ExitAnchorControl.test.tsx
describe('ExitAnchorControl (§18.6, the control R12 never shipped)', () => {
  it('offers "fixed month" plus every phase in the network', () => {
    render(<ExitAnchorControl value={null} phases={PHASES} monthOffset={12} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveValue('__fixed__');
    expect(screen.getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Fixed month', 'Construction', 'Practical completion', 'Marketing']);
  });

  it('emits a PhaseAnchor when a phase is chosen, and null when fixed is chosen back', () => {
    const onChange = vi.fn();
    render(<ExitAnchorControl value={null} phases={PHASES} monthOffset={12} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pc' } });
    expect(onChange).toHaveBeenCalledWith({ phase_id: 'pc', offset_months: 0 });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__fixed__' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('is disabled with an explanation when there is no programme network', () => {
    render(<ExitAnchorControl value={null} phases={[]} monthOffset={12} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByText(/needs a programme/i)).toBeInTheDocument();
  });

  it('accepts a SIGNED offset — "practical completion minus one month" is a real ask', () => {
    const onChange = vi.fn();
    render(<ExitAnchorControl value={{ phase_id: 'pc', offset_months: 0 }} phases={PHASES}
      monthOffset={12} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/months after/i), { target: { value: '-1' } });
    expect(onChange).toHaveBeenCalledWith({ phase_id: 'pc', offset_months: -1 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/calculator/ExitAnchorControl.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the control and wire it into `ExitStrategyPage`**

The control is presentational: it reads `phases` and emits a `PhaseAnchor | null`.
It performs **no month resolution** — the resolved month is read from
`schedule.resolved_exit_months` (Task 8) and displayed read-only beside the
control, so the page shows the user the month the ledger will actually use.

Render one control per `sales_phasing` tranche row and one for the refinance row.

- [ ] **Step 4: Run**

Run: `cd frontend && npx vitest run src/components/calculator/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calculator/ExitAnchorControl.tsx frontend/src/components/calculator/ExitAnchorControl.test.tsx frontend/src/components/calculator/ExitStrategyPage.tsx
git commit -m "feat(r13): exit anchor control for tranches and refinance (closes the UI half of 18.10 limitation 9)"
```

---

## Task 15: The investment case editors

Implements **§19.6**'s screens.

**Files:**
- Create: `frontend/src/components/calculator/OperatingScheduleEditor.tsx` + test
- Create: `frontend/src/components/calculator/InvestmentCaseCard.tsx` + test
- Modify: `frontend/src/components/calculator/ExitStrategyPage.tsx` + test

**Interfaces:**
- Consumes: `OPEX_CODES`, `InvestmentCaseInputs`, `InvestmentCaseResult`.
- Produces: `<OperatingScheduleEditor lines result onChange />`, `<InvestmentCaseCard inputs result onChange />`.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/calculator/InvestmentCaseCard.test.tsx
describe('InvestmentCaseCard (§19.6)', () => {
  it('shows all three caps and marks which one binds', () => {
    render(<InvestmentCaseCard inputs={IC} result={DSCR_BINDS} onChange={vi.fn()} />);
    expect(screen.getByText(/LTV cap/i).closest('tr')).toHaveTextContent('£13,000,000');
    expect(screen.getByText(/DSCR cap/i).closest('tr')).toHaveTextContent('£6,410,256');
    expect(screen.getByText(/ICR cap/i).closest('tr')).toHaveTextContent('£6,410,256');
    expect(screen.getByText(/DSCR cap/i).closest('tr')).toHaveAttribute('data-binding', 'true');
    expect(screen.getByText(/LTV cap/i).closest('tr')).toHaveAttribute('data-binding', 'false');
  });

  it('labels the case indicative when nothing is booked', () => {
    render(<InvestmentCaseCard inputs={IC} result={{ ...DSCR_BINDS, takeout: { ...DSCR_BINDS.takeout, is_booked: false } }} onChange={vi.fn()} />);
    expect(screen.getByText(/indicative/i)).toBeInTheDocument();
  });

  it('reads every figure from the result block and computes none of them', () => {
    // Governance: no calculation logic in React. Feed the card a result whose
    // numbers are deliberately inconsistent with its inputs; the card must
    // print the RESULT's numbers, proving it is not recomputing.
    render(<InvestmentCaseCard inputs={IC} result={{ ...DSCR_BINDS, valuation: { ...DSCR_BINDS.valuation, investment_value_pence: 1_23 } }} onChange={vi.fn()} />);
    expect(screen.getByText('£1.23')).toBeInTheDocument();
  });
});
```

```tsx
// frontend/src/components/calculator/OperatingScheduleEditor.test.tsx
describe('OperatingScheduleEditor (§19.1)', () => {
  it('offers the ten opex codes', () => {
    render(<OperatingScheduleEditor lines={LINES} result={RESULT} onChange={vi.fn()} />);
    expect(screen.getAllByRole('option', { name: /management|insurance|bad debt/i }).length)
      .toBeGreaterThan(0);
    expect(within(screen.getAllByRole('combobox')[0]).getAllByRole('option')).toHaveLength(10);
  });

  it('shows each line\'s stabilised monthly cost from the result, not from its own maths', () => {
    render(<OperatingScheduleEditor lines={LINES} result={RESULT} onChange={vi.fn()} />);
    expect(screen.getByTestId('line-l1-stabilised')).toHaveTextContent('£283.20');
  });

  it('adds and removes lines with unique ids', () => {
    const onChange = vi.fn();
    render(<OperatingScheduleEditor lines={LINES} result={RESULT} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add operating cost/i }));
    const added = onChange.mock.calls[0][0];
    expect(added).toHaveLength(3);
    expect(new Set(added.map((l: OperatingLine) => l.id)).size).toBe(3);
  });
});
```

```tsx
// frontend/src/components/calculator/ExitStrategyPage.test.tsx
it('populates a rent row for every unit when the route is retain_all (§19.7 rule 2)', () => {
  // The editor is what makes the completeness rule a non-event: a user turning
  // the investment case on should not meet a validation error they did not cause.
  const onChange = vi.fn();
  render(<ExitStrategyPage inputs={retainAllDocMissingRents()} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /add an investment case/i }));
  const next = onChange.mock.calls.at(-1)![0];
  expect(next.exit_strategy.retained_units).toHaveLength(next.unit_mix.units.length);
  expect(validateInputs(next).filter((i) => i.severity === 'error')).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/calculator/`
Expected: FAIL, 7 tests.

- [ ] **Step 3: Build both components and wire them into `ExitStrategyPage`**

Both are presentational. Every displayed figure comes from
`result: InvestmentCaseResult`; neither component may call `sizeTakeout`,
`noiSeries` or any other engine function.

- [ ] **Step 4: Run**

Run: `cd frontend && npx vitest run src/components/calculator/ && npm run lint -- --max-warnings 0`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calculator/
git commit -m "feat(r13): operating schedule and investment case editors on ExitStrategyPage (spec 19.6)"
```

---

## Task 16: The memo's investment-case section

Implements **§19.6**'s reporting.

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts`
- Modify: `frontend/src/lib/export-investment-memo.test.ts`
- Modify: `frontend/src/lib/report-qa/memo-fixtures.ts`

**Interfaces:**
- Consumes: `AppraisalResultV2.investment_case`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

```ts
describe('§19.6 the memo investment-case section', () => {
  it('prints the NOI bridge: potential, effective, each operating line, NOI', () => {
    const t = memoText(investmentCaseDoc());
    expect(t).toContain('Gross potential rent');
    expect(t).toContain('Effective gross rent');
    expect(t).toContain('Management');
    expect(t).toContain('Net operating income');
  });

  it('states the yield and purchaser\'s costs alongside the value', () => {
    const t = memoText(investmentCaseDoc());
    expect(t).toMatch(/5\.5%/);
    expect(t).toMatch(/6\.75%/);
  });

  it('prints ALL THREE candidate quanta and names the binding one', () => {
    // A reader given only the quantum learns a number; a reader given all three
    // learns the shape of the constraint.
    const t = memoText(investmentCaseDoc());
    expect(t).toContain('LTV cap');
    expect(t).toContain('DSCR cap');
    expect(t).toContain('ICR cap');
    expect(t).toMatch(/DSCR.*binds/i);
  });

  it('states the residual balance the take-out cannot clear', () => {
    const t = memoText(investmentCaseDoc({ takeoutShortfall: true }));
    expect(t).toMatch(/take-out does not clear/i);
  });

  it('says so when the case is indicative', () => {
    const t = memoText(investmentCaseDoc({ refinance: null }));
    expect(t).toMatch(/indicative/i);
  });

  it('omits the section entirely on the explicit path', () => {
    // Not an empty section with dashes — §13.5's layout invariants make a
    // near-blank page a defect, and a document with no investment case has
    // nothing to say here.
    expect(memoText(explicitRefinanceDoc())).not.toContain('Net operating income');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/export-investment-memo.test.ts -t "19.6"`
Expected: FAIL, 6 tests.

- [ ] **Step 3: Write the section**

Use `ensureSpace` and `withTextStyle` (R7's primitives) — never a bare
`if (y > N)`. Add an investment-case fixture to `memo-fixtures.ts` so the report
QA suite covers the new section.

- [ ] **Step 4: Run**

Run: `cd frontend && npx vitest run src/lib/`
Expected: PASS, including the existing report-QA page-bounds and sparse-page assertions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-investment-memo.test.ts frontend/src/lib/report-qa/memo-fixtures.ts
git commit -m "feat(r13): memo investment-case section -- NOI bridge, value, three caps, binding constraint (spec 19.6)"
```

---

## Task 17: Specification and documentation

Implements the spec half of the release.

**Files:**
- Modify: `docs/financial-model/calculation-specification.md`
- Modify: `docs/financial-model/migration-notes.md`
- Modify: `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`
- Create: `frontend/src/lib/model/spec-versions.test.ts`

- [ ] **Step 1: Write the §1.6 guard that has been missing since §1.6 was written**

```ts
// frontend/src/lib/model/spec-versions.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CALC_VERSION } from './finance-types';

/**
 * R13. Spec §1.6 lists every inputs version the model supports. It has been
 * missed TWICE RUNNING — R11 shipped without v8 in the list and R12 caught it —
 * and no test has ever read it. This is that test.
 *
 * The rule is written as "the newest version this build defines appears in the
 * list", derived from the type union rather than hard-coded, so it does not go
 * vacuous the moment v11 exists.
 */
const SPEC = readFileSync(
  resolve(__dirname, '../../../../docs/financial-model/calculation-specification.md'), 'utf-8',
);

describe('spec §1.6 versioning', () => {
  it('lists the newest inputs version', () => {
    const section = SPEC.split('### 1.6 Versioning')[1].split('\n## ')[0];
    expect(section).toMatch(/\bv10\b/);
  });

  it('names the current calc version', () => {
    expect(SPEC).toContain(CALC_VERSION);
  });
});
```

Run it before touching the spec: it must **FAIL**, because `v10` is not yet in
§1.6. That failure is the guard proving itself.

- [ ] **Step 2: Write §19**

Transcribe §§19.1–19.10 from the design document, in the house style of §17 and
§18: numbered subsections, the stated-limitations block, and the
"Guards this release must watch fail" table.

- [ ] **Step 3: Make the four edits to existing sections**

- **§1.6** — add v10 and calc 2.12.0.
- **§4.5** — mark superseded for the `investment_case != null` case; the explicit path stays live and its text is unchanged.
- **§12.1** — five levers become eight; add the three new rows and state their composition order, as §12.1 requires of every lever added later.
- **§12.2** — add the carve-out paragraph: **the take-out is not the committed facility and is re-solved in every cell, deliberately.** Without it, §12.2 reads as though the take-out must be held at base, which would make all three new levers inert.
- **§18.10 limitation 9** — rewrite to record that R13 closed it, naming Tasks 12 and 14.

- [ ] **Step 4: Migration notes and the release-plan split**

Add the v9 → v10 entry to `migration-notes.md`. In the release plan, edit the R13
row to name the investment case, and **add a row for the unit-level sales ledger**
— a deferral that lives only in a spec limitation is a note someone has to
remember; a deferral in the release table is scheduled work.

- [ ] **Step 5: Run the guard**

Run: `cd frontend && npx vitest run src/lib/model/spec-versions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/ frontend/src/lib/model/spec-versions.test.ts
git commit -m "docs(r13): calculation specification 19, calc 2.12.0, v9->v10 migration notes, 1.6 version guard"
```

---

## Task 18: The entry-point cutover

Implements **§19.9**'s persistence boundary. **Last task, and its own task, on R12's finding: the cutover is what finds the boundary bug, and a release that leaves the server writing v9 ships inert.**

**Files:**
- Modify: every production call site of `migrateInputsToV9` / `migrate_inputs_to_v9`
- Modify: `app/api/app.py:24,402`
- Modify: `frontend/src/lib/model/entry-point-guard.test.ts` (no rule change — it derives the newest version itself)
- Modify: `tests/test_entry_point_guard.py`

- [ ] **Step 1: Run the existing guard and read what it says**

Run: `cd frontend && npx vitest run src/lib/model/entry-point-guard.test.ts && cd .. && pytest tests/test_entry_point_guard.py -q`

Expected: **FAIL**, listing every production file still naming `migrateInputsToV9`.
The guard is written as "every production call site names the NEWEST migration",
derived from the migration module itself, so it needs **no edit** for v10 — that
is exactly why R12 wrote it that way.

- [ ] **Step 2: Move every call site in ONE commit**

The persistence boundary is one thing with several halves: the client entry
points, the server (`app/api/app.py`), and the Python engine. Each
`migrateInputsTo{N}` refuses a v{N+1} document by design, so a boundary split
across two versions is not a degraded state — it is a broken one.

Move them all. Do **not** move the exempt sites: `migrate.ts`, `index.ts`, and
the migration identity gates, which call the older entry point deliberately as
the "before" side of a before/after comparison.

- [ ] **Step 3: Prove the v10 arm actually runs**

This is R12's Task 18b finding, and it is the step most likely to be skipped:

```python
# tests/test_entry_point_guard.py
def test_the_server_round_trips_a_v10_document_as_reconciled():
    """R12 Task 18b, one version on. The cutover is what finds the boundary bug:
    R12's found `is_v2_or_later` missing `is_v9`, so every appraisal saved after
    release came back stamped `legacy_unreconciled` and provenance-hashed as
    such. Third consecutive release to lose that same half of the boundary.

    This asserts the V10 ARM, not two v9 runs: the posted document must come
    back at inputs_version 10 AND not be tagged legacy."""
    posted = json.loads(Path("fixtures/financial-model/t-investment-case.json").read_text(encoding="utf-8"))
    saved = client.post("/appraisals", json=posted).json()
    assert saved["inputs"]["inputs_version"] == 10
    assert saved["status"] != "legacy_unreconciled"
    assert saved["inputs"]["investment_case"] is not None
```

- [ ] **Step 4: Run the FULL gate set on the result**

```bash
cd frontend && npx vitest run && npx tsc -b && npm run lint -- --max-warnings 0 && npm run build
cd .. && pytest -q
git ls-files --eol | grep -v 'i/lf' || echo 'EOL clean'
```

Expected: vitest and pytest both above their baselines (**2315** and **1963**);
`tsc`, lint and build clean; EOL all-LF.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(r13): move every entry point to inputs v10 (spec 19.9)"
```

---

## Post-implementation checklist

Run **before** proposing the merge, and run the gate set **on the merged result**,
not only on the branch — R12's record is explicit that this is where a release
gets caught.

- [ ] Every guard in the design's §14 table has a test, and every one of them has
      been **seen red** at least once. A guard that has only ever been green is a
      guard nobody has tested.
- [ ] `git log --oneline main..HEAD` shows a failing-test commit or step before
      each feature commit.
- [ ] Task 12's memo test genuinely failed against `main` — check the commit
      message records the failure output.
- [ ] No vacuous tests. For each new guard, ask: *would this still pass if I
      deleted the code under test?* R11 shipped five and R12 four; the disguises
      found so far are fixtures pre-populated by a shared version-agnostic type,
      Python's `model_validate()` silently backfilling Pydantic defaults, a
      null-target test using a zero magnitude, and a guard pinning figures for a
      document validation rejects. Mutation-verify the seven engine guards in
      both engines.
- [ ] No comment asserts something the code contradicts. R12 found four; each was
      a real defect, because the danger is not the wrong prose — it is that the
      next reader "fixes" a correct guard they believe is broken.
- [ ] `docs/financial-model/calculation-specification.md` §19 matches what
      shipped. Where implementation forced a change, **the spec is edited and the
      change is recorded**, not left to diverge.
