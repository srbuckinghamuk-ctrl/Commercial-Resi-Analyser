# Release 3a — Programme Engine (calc 2.2.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inputs v4 with a nullable dated-programme block, spend curves (s_curve / back_loaded / user_defined) in both engines, and the flags-on-result refactor — with migrated v3 inputs reproducing calc-2.1.0 outputs identically.

**Architecture:** The TS engine (`frontend/src/lib/model/`) is normative; the Python engine (`app/financial_model/`) mirrors it line-for-line. `programme = null` means "auto windows": the engine derives the exact calc-2.1.0 §6 straight-line windows from `term_months` at build time, so identity holds by construction. Explicit programmes freeze windows and pick curves. `sales_phasing`/`refinance` exist in the v4 schema but are hard validation errors when non-null (R3b implements them). Spec: `docs/superpowers/specs/2026-08-14-release-3-design.md`.

**Tech Stack:** TypeScript + vitest (frontend), Python 3 + pytest (backend). No new dependencies.

## Global Constraints

- Governance (`docs/financial-model/model-governance.md`): spec + hand-derived fixtures + BOTH engines updated within this release branch; every fixture number derived on a worksheet in `docs/financial-model/test-cases.md` BEFORE being pinned.
- Identity invariant: migrated v3 inputs → every numeric/boolean field of `expected_metrics` identical to calc 2.1.0. Only `calc_version` changes (`'2.1.0'` → `'2.2.0'`, Task 9).
- All money is integer pence; percentages are floats (`70.0` = 70%). Rounding: round half-up per month (`Math.round` / `money_round`), final month of a window absorbs the residue so spreads sum exactly.
- Do NOT reroute `spreadStraightLine`/`spread_straight_line` through the new weight functions — `Math.round(total / D)` and `Math.round(total * (1 / D))` can differ by 1p (double rounding). The existing functions stay byte-identical.
- Frontend commands (from `frontend/`): tests `npx vitest run`, typecheck `npx tsc -p tsconfig.app.json --noEmit` (bare `tsc` is a no-op), lint `npx eslint .`, deps `npm install --legacy-peer-deps`. Backend (repo root): `python -m pytest -q`.
- Never use `git stash` (shared stack). Commit directly on the release branch `release-3a-programme-engine`.
- Baseline suite sizes: backend pytest 333, frontend vitest 358 — all must stay green; new tests add to these counts.

---

### Task 1: Spec amendment (calc 2.2.0) + curve formulas

**Files:**
- Modify: `docs/financial-model/calculation-specification.md` (§6 spend profiles; inputs-version section; changelog/header)

**Interfaces:**
- Produces: the normative closed-form curve definitions every later task implements. No code.

- [ ] **Step 1: Amend §6 of the calculation spec**

Add a "calc 2.2.0" subsection to §6 (keep the existing §6 text as the `programme = null` auto behaviour). Content to add, verbatim in spirit:

```markdown
### 6.1 Dated programme [R3a — calc 2.2.0]

Inputs v4 adds a nullable `programme` block. `programme = null` (the migration
default) = auto windows: construction straight-line over months 1..N−2,
professional and statutory over the first half of that window (§6 above),
derived from `term_months` at build time — bit-identical to calc 2.1.0.

An explicit programme gives each package (construction, professional,
statutory) a window `[start_offset, start_offset + duration_months)` and a
curve. The statutory package spreads CIL/S106 + building control only; the
prior-approval fee stays at month 0. Acquisition stays at month 0.

Curves, for a window of D months, k = 1..D (1-indexed within the window),
ideal fraction w_k of the package total; month k pence = round_half_up(total ×
w_k); the final month absorbs the cumulative residue (invariant: Σ = total):

- straight_line: w_k = 1/D (computed as round(total / D) per month, final
  absorbs — the calc-2.0.0 function, unchanged).
- s_curve: cumulative W(k) = (1 − cos(π·k/D)) / 2; w_k = W(k) − W(k−1).
- back_loaded: w_k = 2k / (D(D+1)).
- user_defined: weights u_1..u_D (each ≥ 0, Σu > 0, length exactly D);
  w_k = u_k / Σu.

Validation (input errors, not flags), applying only when `programme` is
non-null: duration_months ≥ 1; start_offset ≥ 0; start_offset +
duration_months − 1 ≤ term − 2 (the ≥-2-month sale tail, §6); user_defined
weight rules above. While calc is 2.2.0, non-null `sales_phasing` or
`refinance` is a hard validation error ("not yet implemented — R3b").
```

Also: bump the spec's inputs-version narrative (v4 = v3 + `programme` + `sales_phasing` + `refinance`, chain v1→v2→v3→v4) and add a changelog entry "2.2.0 — dated programme + spend curves (R3a); flags moved onto the result object; no numeric change for migrated v3 inputs." Do NOT change the §6 [R2] marker text beyond pointing it at 6.1.

- [ ] **Step 2: Commit**

```bash
git add docs/financial-model/calculation-specification.md
git commit -m "docs(spec): calc 2.2.0 — dated programme, spend-curve closed forms, v4 inputs"
```

---

### Task 2: TS spend-curve spreads (`curves.ts`)

**Files:**
- Create: `frontend/src/lib/model/curves.ts`
- Test: `frontend/src/lib/model/curves.test.ts`

**Interfaces:**
- Consumes: `SpendCurve` type from Task 3 — but to keep this task self-contained, define the type here and re-export it from `finance-types.ts` in Task 3.
- Produces: `spreadSCurve(total: number, months: number): number[]`; `spreadBackLoaded(total: number, months: number): number[]`; `spreadUserDefined(total: number, weights: number[]): number[]`; `spreadByCurve(total: number, durationMonths: number, curve: SpendCurve): number[]`. All return integer-pence arrays of length `months`/`durationMonths` summing exactly to `total` (empty array when months ≤ 0).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/model/curves.test.ts
import { describe, expect, it } from 'vitest';
import { spreadBackLoaded, spreadByCurve, spreadSCurve, spreadUserDefined } from './curves';

describe('spreadSCurve', () => {
  it('matches the hand-derived raised-cosine table for 60,000,000p over 6 months', () => {
    // W(k) = (1 − cos(πk/6))/2 — worksheet in test-cases.md (fixture H)
    expect(spreadSCurve(60_000_000, 6)).toEqual([
      4_019_238, 10_980_762, 15_000_000, 15_000_000, 10_980_762, 4_019_238,
    ]);
  });
  it('sums exactly to the total for awkward amounts', () => {
    const out = spreadSCurve(999_999, 7);
    expect(out.reduce((a, b) => a + b, 0)).toBe(999_999);
    expect(out).toHaveLength(7);
  });
  it('degenerates to the whole total for a 1-month window', () => {
    expect(spreadSCurve(123_456, 1)).toEqual([123_456]);
  });
  it('returns [] for months <= 0', () => {
    expect(spreadSCurve(1000, 0)).toEqual([]);
  });
});

describe('spreadBackLoaded', () => {
  it('matches w_k = 2k/(D(D+1)): 3,000,000p over 2 months = [1,000,000, 2,000,000]', () => {
    expect(spreadBackLoaded(3_000_000, 2)).toEqual([1_000_000, 2_000_000]);
  });
  it('is non-decreasing and sums exactly', () => {
    const out = spreadBackLoaded(1_000_001, 5);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1_000_001);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });
});

describe('spreadUserDefined', () => {
  it('normalises weights: [1, 3] over 40,000 = [10,000, 30,000]', () => {
    expect(spreadUserDefined(40_000, [1, 3])).toEqual([10_000, 30_000]);
  });
  it('zero-weight months get zero pence; final month still absorbs residue', () => {
    expect(spreadUserDefined(100, [0, 1, 2])).toEqual([0, 33, 67]);
  });
});

describe('spreadByCurve', () => {
  it('dispatches straight_line to the existing spreadStraightLine (identity-critical)', () => {
    // 100p over 3 months: Math.round(100/3)=33 per month, final absorbs → [33, 33, 34]
    expect(spreadByCurve(100, 3, { kind: 'straight_line' })).toEqual([33, 33, 34]);
  });
  it('dispatches s_curve / back_loaded / user_defined', () => {
    expect(spreadByCurve(3_000_000, 2, { kind: 'back_loaded' })).toEqual([1_000_000, 2_000_000]);
    expect(spreadByCurve(40_000, 2, { kind: 'user_defined', weights: [1, 3] })).toEqual([10_000, 30_000]);
    expect(spreadByCurve(60_000_000, 6, { kind: 's_curve' })[2]).toBe(15_000_000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/model/curves.test.ts`
Expected: FAIL — `Cannot find module './curves'`.

- [ ] **Step 3: Implement `curves.ts`**

```ts
// frontend/src/lib/model/curves.ts
import { spreadStraightLine } from './schedule';

/** Spend-curve discriminated union (spec §6.1, calc 2.2.0). Re-exported via
 * finance-types.ts once inputs v4 lands (Task 3). */
export type SpendCurve =
  | { kind: 'straight_line' | 's_curve' | 'back_loaded' }
  | { kind: 'user_defined'; weights: number[] };

/** Spread by ideal per-month fractions: month k = round_half_up(total·w_k),
 * final month absorbs the residue (spec §6.1 invariant). */
function spreadByWeights(total: number, idealWeights: number[]): number[] {
  const D = idealWeights.length;
  if (D === 0) return [];
  const out: number[] = new Array(D);
  let allocated = 0;
  for (let i = 0; i < D - 1; i++) {
    out[i] = Math.round(total * idealWeights[i]);
    allocated += out[i];
  }
  out[D - 1] = total - allocated;
  return out;
}

/** Raised-cosine S-curve: cumulative W(k) = (1 − cos(πk/D)) / 2. */
export function spreadSCurve(total: number, months: number): number[] {
  if (months <= 0) return [];
  const weights: number[] = [];
  let prev = 0;
  for (let k = 1; k <= months; k++) {
    const cum = (1 - Math.cos((Math.PI * k) / months)) / 2;
    weights.push(cum - prev);
    prev = cum;
  }
  return spreadByWeights(total, weights);
}

/** Linear ramp: w_k = 2k / (D(D+1)). */
export function spreadBackLoaded(total: number, months: number): number[] {
  if (months <= 0) return [];
  const weights = Array.from({ length: months }, (_, i) => (2 * (i + 1)) / (months * (months + 1)));
  return spreadByWeights(total, weights);
}

/** Normalised explicit weights. Callers validate length/non-negativity/sum
 * (validation.ts, Task 5) — this function assumes valid input. */
export function spreadUserDefined(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return spreadByWeights(total, weights.map((w) => w / sum));
}

export function spreadByCurve(total: number, durationMonths: number, curve: SpendCurve): number[] {
  switch (curve.kind) {
    case 'straight_line': return spreadStraightLine(total, durationMonths);
    case 's_curve': return spreadSCurve(total, durationMonths);
    case 'back_loaded': return spreadBackLoaded(total, durationMonths);
    case 'user_defined': return spreadUserDefined(total, curve.weights);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/model/curves.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/curves.ts frontend/src/lib/model/curves.test.ts
git commit -m "feat(model): spend-curve spread functions (s_curve, back_loaded, user_defined)"
```

---

### Task 3: TS inputs v4 types + migration

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts` (after `CalculatorInputsV3`, ~line 114)
- Modify: `frontend/src/lib/model/migrate.ts`
- Modify: `frontend/src/lib/model/index.ts` (re-exports)
- Test: `frontend/src/lib/model/migrate.test.ts` (extend)

**Interfaces:**
- Consumes: `SpendCurve` from `./curves` (Task 2).
- Produces: types `ProgrammePackage { start_offset: number; duration_months: number; curve: SpendCurve }`, `ProgrammeInputs { anchor_month: string | null; packages: { construction: ProgrammePackage; professional: ProgrammePackage; statutory: ProgrammePackage } }`, `SalesPhasingInputs { tranches: Array<{ month_offset: number; pct_of_gross_receipts: number }> }`, `RefinanceInputs { month_offset: number; investment_value_pence: number; ltv_pct: number; arrangement_fee_pence: number; legal_costs_pence: number }`, `CalculatorInputsV4` (= V3 fields with `inputs_version: 4` + `programme: ProgrammeInputs | null` + `sales_phasing: SalesPhasingInputs | null` + `refinance: RefinanceInputs | null`), `AnyCalculatorInputs = CalculatorInputsV2 | CalculatorInputsV3 | CalculatorInputsV4`.
- Produces: `isV4(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV4`; `migrateV3toV4(v3: CalculatorInputsV3): CalculatorInputsV4` (throws if already v4, preserves illegally-present blocks like `migrateV2toV3` does); `migrateInputsToV4(snapshot, project?): CalculatorInputsV4`.

- [ ] **Step 1: Write the failing tests** (append to `migrate.test.ts`, following its existing style)

```ts
describe('migrateV3toV4 / migrateInputsToV4', () => {
  it('stamps version 4 and nulls the three new blocks', () => {
    const v3 = migrateInputsToV3({});
    const v4 = migrateV3toV4(v3);
    expect(v4.inputs_version).toBe(4);
    expect(v4.programme).toBeNull();
    expect(v4.sales_phasing).toBeNull();
    expect(v4.refinance).toBeNull();
    expect(v4.finance).toEqual(v3.finance);
    expect(v4.lender_valuation).toEqual(v3.lender_valuation);
  });
  it('throws on double-migration', () => {
    const v4 = migrateInputsToV4({});
    expect(() => migrateV3toV4(v4 as never)).toThrow(/already a v4/);
  });
  it('migrateInputsToV4 normalises v1, v2, v3 and v4 snapshots', () => {
    for (const snap of [{}, migrateInputs({}), migrateInputsToV3({}), migrateInputsToV4({})]) {
      const out = migrateInputsToV4(snap as Record<string, unknown>);
      expect(out.inputs_version).toBe(4);
      expect(out.programme).toBeNull();
    }
  });
  it('preserves a saved programme block on a v4 round-trip', () => {
    const v4 = migrateInputsToV4({});
    v4.programme = {
      anchor_month: '2026-09',
      packages: {
        construction: { start_offset: 1, duration_months: 6, curve: { kind: 's_curve' } },
        professional: { start_offset: 2, duration_months: 3, curve: { kind: 'straight_line' } },
        statutory: { start_offset: 4, duration_months: 2, curve: { kind: 'back_loaded' } },
      },
    };
    const again = migrateInputsToV4(v4 as unknown as Record<string, unknown>);
    expect(again.programme).toEqual(v4.programme);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/migrate.test.ts`
Expected: FAIL — `migrateV3toV4` not exported.

- [ ] **Step 3: Implement**

In `finance-types.ts`: add the types from the Interfaces block above (import `SpendCurve` from `./curves` and `export type { SpendCurve }`). In `migrate.ts`, mirror the existing v3 machinery exactly:

```ts
export function isV4(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV4 {
  return snapshot.inputs_version === 4 && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

/** v3 → v4 is purely additive: stamps the version and adds the three nullable
 * blocks (spec §6.1 / design §2.4). Outputs are unchanged while all three are
 * null. Same double-migration guard and illegal-key passthrough as migrateV2toV3. */
export function migrateV3toV4(v3: CalculatorInputsV3): CalculatorInputsV4 {
  if (isV4(v3 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV3toV4: input is already a v4 document');
  }
  const { inputs_version: _v3Version, ...rest } = v3;
  const extra = v3 as unknown as {
    programme?: ProgrammeInputs | null;
    sales_phasing?: SalesPhasingInputs | null;
    refinance?: RefinanceInputs | null;
  };
  return {
    ...rest,
    inputs_version: 4,
    programme: extra.programme ?? null,
    sales_phasing: extra.sales_phasing ?? null,
    refinance: extra.refinance ?? null,
  };
}

export function migrateInputsToV4(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV4 {
  if (isV4(snapshot)) {
    const defaults = migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2(project)));
    const saved = snapshot as unknown as Partial<CalculatorInputsV4>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 4,
      // field-by-field merges copied from migrateInputsToV3's v3 branch
      // (acquisition, unit_mix, conversion_costs, finance, equity_sources,
      // exit_strategy, risks, scenarios, deal_spider — identical spreads),
      lender_valuation: saved.lender_valuation ?? null,
      programme: saved.programme ?? null,
      sales_phasing: saved.sales_phasing ?? null,
      refinance: saved.refinance ?? null,
    };
  }
  return migrateV3toV4(migrateInputsToV3(snapshot, project));
}
```

(The "copied from" comment above is an instruction to you, the implementer: replicate the nine merge lines from `migrateInputsToV3`'s v3 branch — `migrate.ts:159-176` — verbatim; do not leave the comment in the code.)

Re-export `isV4, migrateV3toV4, migrateInputsToV4` from `index.ts` alongside the existing migrate exports.

- [ ] **Step 4: Run tests, typecheck**

Run: `cd frontend && npx vitest run src/lib/model/migrate.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS / no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/finance-types.ts frontend/src/lib/model/migrate.ts frontend/src/lib/model/index.ts frontend/src/lib/model/migrate.test.ts
git commit -m "feat(model): inputs v4 — programme/sales_phasing/refinance blocks, v3→v4 migration"
```

---

### Task 4: TS schedule consumes the programme

**Files:**
- Modify: `frontend/src/lib/model/schedule.ts` (`buildSchedule`, lines 26-102)
- Modify: `frontend/src/lib/model/index.ts` + `frontend/src/lib/model/metrics.ts` + `frontend/src/lib/model/validation.ts` + `frontend/src/lib/model/cost-to-complete.ts` — widen input signatures from `CalculatorInputsV2 | CalculatorInputsV3` to `AnyCalculatorInputs` (mechanical; `runAppraisal` and `AppraisalRun.inputs` included)
- Test: `frontend/src/lib/model/schedule.test.ts` (extend)

**Interfaces:**
- Consumes: `spreadByCurve` (Task 2), `CalculatorInputsV4`/`AnyCalculatorInputs`/`ProgrammePackage` (Task 3).
- Produces: `buildSchedule(inputs: AnyCalculatorInputs): Schedule` — behaviour identical for v2/v3 and for v4 with `programme: null`; explicit programmes drive per-package windows/curves.

- [ ] **Step 1: Write the failing tests** (append to `schedule.test.ts`)

```ts
describe('buildSchedule with a v4 programme', () => {
  const base = () => migrateInputsToV4({});          // import from './migrate'

  it('v4 with programme:null is bit-identical to the migrated v3 schedule', () => {
    const v3 = migrateInputsToV3({});
    const v4 = migrateV3toV4(v3);
    expect(buildSchedule(v4)).toEqual(buildSchedule(v3));
  });

  it('an explicit programme places each package window with its curve', () => {
    const v4 = base();
    v4.finance.term_months = 12;
    // construction total must be 60,000,000p for the table below:
    v4.conversion_costs.construction_cost_per_sqm_pence = 150_000;
    v4.conversion_costs.total_construction_sqm = 400;
    v4.conversion_costs.contingency_pct = 0;
    v4.conversion_costs.fire_safety_pence = 0;
    v4.conversion_costs.sound_insulation_pence = 0;
    v4.conversion_costs.part_l_compliance_pence = 0;
    v4.programme = {
      anchor_month: null,
      packages: {
        construction: { start_offset: 1, duration_months: 6, curve: { kind: 's_curve' } },
        professional: { start_offset: 2, duration_months: 3, curve: { kind: 'straight_line' } },
        statutory: { start_offset: 4, duration_months: 2, curve: { kind: 'back_loaded' } },
      },
    };
    const s = buildSchedule(v4);
    expect(s.uses.map((u) => u.construction_pence)).toEqual([
      0, 4_019_238, 10_980_762, 15_000_000, 15_000_000, 10_980_762, 4_019_238, 0, 0, 0, 0, 0,
    ]);
    // professional window shifted to months 2..4; statutory back-loaded months 4..5
    expect(s.uses[1].professional_pence).toBe(0);
    expect(s.uses[2].professional_pence).toBeGreaterThan(0);
    const statTotal = v4.conversion_costs.cil_s106_pence + v4.conversion_costs.building_control_pence;
    expect(s.uses[4].statutory_pence + s.uses[5].statutory_pence
      - Math.round(statTotal / 3) - (statTotal - Math.round(statTotal / 3))).toBe(0);
    // prior-approval fee still at month 0 regardless of the statutory package
    expect(s.uses[0].statutory_pence).toBe(
      v4.conversion_costs.prior_approval_fee_per_dwelling_pence * Math.max(1, v4.unit_mix.units.length));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/schedule.test.ts`
Expected: FAIL (programme ignored / type error).

- [ ] **Step 3: Implement**

In `buildSchedule`, replace the `if (term === 1) { … } else { … }` block (lines 47-60) with window resolution + curve dispatch. Keep the auto path executing the **existing straight-line code verbatim** — do not express it through `spreadByCurve` (identity):

```ts
const programme = 'programme' in inputs ? inputs.programme : null;

if (programme == null) {
  // auto windows — calc 2.1.0 behaviour, byte-identical (spec §6)
  if (term === 1) {
    uses[0].construction_pence = constructionTotal;
    uses[0].professional_pence = professionalTotal;
    uses[0].statutory_pence += statutorySpreadTotal;
  } else {
    const constructionWindow = Math.max(1, term - 2);
    const professionalWindow = Math.max(1, Math.ceil(constructionWindow / 2));
    const constructionSpread = spreadStraightLine(constructionTotal, constructionWindow);
    const professionalSpread = spreadStraightLine(professionalTotal, professionalWindow);
    const statutorySpread = spreadStraightLine(statutorySpreadTotal, professionalWindow);
    constructionSpread.forEach((v, i) => { uses[Math.min(i + 1, term - 1)].construction_pence += v; });
    professionalSpread.forEach((v, i) => { uses[Math.min(i + 1, term - 1)].professional_pence += v; });
    statutorySpread.forEach((v, i) => { uses[Math.min(i + 1, term - 1)].statutory_pence += v; });
  }
} else {
  // explicit programme (spec §6.1); windows validated in validation.ts —
  // the Math.min clamp is belt-and-braces, mirroring the auto path.
  const place = (pkg: ProgrammePackage, total: number, add: (m: number, v: number) => void) => {
    spreadByCurve(total, pkg.duration_months, pkg.curve)
      .forEach((v, i) => add(Math.min(pkg.start_offset + i, term - 1), v));
  };
  place(programme.packages.construction, constructionTotal, (m, v) => { uses[m].construction_pence += v; });
  place(programme.packages.professional, professionalTotal, (m, v) => { uses[m].professional_pence += v; });
  place(programme.packages.statutory, statutorySpreadTotal, (m, v) => { uses[m].statutory_pence += v; });
}
```

Widen the signature to `AnyCalculatorInputs` here and in `runAppraisal`, `deriveMetrics`, `validateInputs`, `reconcile`, `computeCostToComplete`, and `AppraisalRun.inputs` (purely a type change — `'lender_valuation' in inputs` / `'programme' in inputs` guards keep runtime behaviour version-safe).

- [ ] **Step 4: Run the full model suite + typecheck**

Run: `cd frontend && npx vitest run src/lib/model && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS — including every pre-existing schedule/golden test (identity).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model
git commit -m "feat(model): buildSchedule consumes the v4 programme; null = auto §6 windows"
```

---

### Task 5: TS programme validation + inert-block rejection

**Files:**
- Modify: `frontend/src/lib/model/validation.ts` (`validateInputs`)
- Test: `frontend/src/lib/model/validation.test.ts` (extend)

**Interfaces:**
- Consumes: `CalculatorInputsV4` (Task 3). `ValidationIssue` shape is `{ severity: 'error' | 'warning'; field: string; message: string }` (existing).
- Produces: validation rules later UI (R3b) will surface; no new exports.

- [ ] **Step 1: Write the failing tests** (append to `validation.test.ts`; build a valid v4 via `migrateInputsToV4({})`, set `finance.term_months = 12`, then break one thing per test)

```ts
describe('v4 programme validation', () => {
  const withProgramme = (pkg: Partial<ProgrammePackage>) => {
    const v4 = migrateInputsToV4({});
    v4.finance.term_months = 12;
    const ok: ProgrammePackage = { start_offset: 1, duration_months: 6, curve: { kind: 'straight_line' } };
    v4.programme = { anchor_month: null, packages: {
      construction: { ...ok, ...pkg }, professional: ok, statutory: ok,
    } };
    return v4;
  };
  const errorsOn = (field: string, v4: CalculatorInputsV4) =>
    validateInputs(v4).some((i) => i.severity === 'error' && i.field.startsWith(field));

  it('accepts a well-formed programme', () => {
    expect(validateInputs(withProgramme({})).filter((i) => i.field.startsWith('programme'))).toEqual([]);
  });
  it('rejects duration < 1', () => {
    expect(errorsOn('programme.packages.construction', withProgramme({ duration_months: 0 }))).toBe(true);
  });
  it('rejects negative start_offset', () => {
    expect(errorsOn('programme.packages.construction', withProgramme({ start_offset: -1 }))).toBe(true);
  });
  it('rejects a window breaching the 2-month sale tail (start+duration−1 > term−2)', () => {
    expect(errorsOn('programme.packages.construction', withProgramme({ start_offset: 5, duration_months: 6 }))).toBe(true);
  });
  it('rejects user_defined weights of the wrong length, negative, or all-zero', () => {
    for (const weights of [[1, 2], [1, -1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0]]) {
      expect(errorsOn('programme.packages.construction',
        withProgramme({ curve: { kind: 'user_defined', weights } }))).toBe(true);
    }
  });
  it('hard-rejects non-null sales_phasing and refinance while calc is 2.2.0', () => {
    const v4 = migrateInputsToV4({});
    v4.sales_phasing = { tranches: [{ month_offset: 11, pct_of_gross_receipts: 100 }] };
    expect(errorsOn('sales_phasing', v4)).toBe(true);
    const v4b = migrateInputsToV4({});
    v4b.refinance = { month_offset: 6, investment_value_pence: 1, ltv_pct: 60, arrangement_fee_pence: 0, legal_costs_pence: 0 };
    expect(errorsOn('refinance', v4b)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts`
Expected: FAIL (no programme rules yet).

- [ ] **Step 3: Implement** — inside `validateInputs`, after the existing finance checks:

```ts
if ('programme' in inputs && inputs.programme != null) {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  for (const [name, pkg] of Object.entries(inputs.programme.packages)) {
    const field = `programme.packages.${name}`;
    if (pkg.duration_months < 1) err(field, 'Package duration must be at least 1 month.');
    if (pkg.start_offset < 0) err(field, 'Package start month cannot be negative.');
    if (pkg.start_offset + pkg.duration_months - 1 > term - 2) {
      err(field, `Package must finish by month ${term - 2} — the final two months are the sale tail (spec §6).`);
    }
    if (pkg.curve.kind === 'user_defined') {
      const w = pkg.curve.weights;
      if (w.length !== pkg.duration_months) err(field, 'user_defined weights must have one entry per window month.');
      if (w.some((x) => x < 0)) err(field, 'user_defined weights cannot be negative.');
      if (w.reduce((a, b) => a + b, 0) <= 0) err(field, 'user_defined weights must sum to more than zero.');
    }
  }
}
if ('sales_phasing' in inputs && inputs.sales_phasing != null) {
  err('sales_phasing', 'Phased sales are not yet implemented (Release 3b) — remove the block.');
}
if ('refinance' in inputs && inputs.refinance != null) {
  err('refinance', 'Refinance modelling is not yet implemented (Release 3b) — remove the block.');
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/validation.ts frontend/src/lib/model/validation.test.ts
git commit -m "feat(model): validate v4 programme windows/curves; hard-reject R3b blocks"
```

---

### Task 6: TS flags-on-result refactor + cap-exhaustion flag

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts` (`FlagCode` union ~line 116; `AppraisalResultV2` ~line 218)
- Modify: `frontend/src/lib/model/metrics.ts` (lines 92-96, 122-126, return object)
- Modify: `frontend/src/components/calculator/ReconciliationStrip.tsx:72`, `frontend/src/components/calculator/ScenariosPage.tsx:105`, `frontend/src/lib/export-investment-memo.ts:1083,1113` — read `metrics.flags` instead of `model.flags`
- Test: `frontend/src/lib/model/metrics.test.ts` (extend)

**Interfaces:**
- Consumes: existing `ModelFlag`, `solveSeniorBreakeven`/`solveDeveloperBreakeven` (return `number | null`).
- Produces: `AppraisalResultV2.flags: ModelFlag[]` = ledger flags (`model.flags`, unmutated) followed by metric flags. `FlagCode` gains `'breakeven_cap_exhausted'`. `deriveMetrics` no longer mutates any argument. `validation.ts:201` (`facility_exceeded` check on `model.flags`) is a ledger flag — leave it reading `model.flags`.

- [ ] **Step 1: Write the failing tests** (append to `metrics.test.ts`; reuse its existing fixture-building helpers)

```ts
describe('flags on result (R3a refactor)', () => {
  it('deriveMetrics does not mutate model.flags and returns ledger+metric flags', () => {
    const run = runAppraisal(migrateInputsToV4({}));          // any valid inputs
    const before = run.model.flags.length;
    const metrics = deriveMetrics(run.inputs, run.schedule, run.model);
    expect(run.model.flags.length).toBe(before);              // purity
    expect(metrics.flags.slice(0, before)).toEqual(run.model.flags);
  });
  it('agent fee >= 100% raises the unsolvable flags on the result, not the model', () => {
    const v4 = migrateInputsToV4({});
    v4.exit_strategy.selling_agent_fee_pct = 100;
    const run = runAppraisal(v4);
    expect(run.model.flags.some((f) => f.code === 'developer_breakeven_unsolvable')).toBe(false);
    expect(run.metrics.flags.some((f) => f.code === 'developer_breakeven_unsolvable')).toBe(true);
  });
});
```

(The cap-exhaustion path is untestable through real inputs — the >2²⁰⁰ range is unreachable — so unit-test the branch directly: call `deriveMetrics` with a stub where the solver returns `null` and fee < 100 is impossible to arrange via `runAppraisal`. Instead, export nothing new: test via `solveSeniorBreakeven` monkeypatching is NOT possible with ES modules — so assert the branch by constructing `SeniorBreakevenTerms` that return null from the real solver if any exist; if none exist (they don't, by design), cover the branch with a direct unit test of the new helper `breakevenFlags(seniorNull: boolean, developerNull: boolean, agentFeePct: number): ModelFlag[]` — extract the flag-construction logic into that pure exported helper in `metrics.ts` and test it for all four combinations.)

```ts
describe('breakevenFlags', () => {
  it('fee >= 100 → unsolvable flags; fee < 100 with a null solve → cap_exhausted', () => {
    expect(breakevenFlags(true, false, 100).map((f) => f.code)).toEqual(['senior_breakeven_unsolvable']);
    expect(breakevenFlags(true, false, 2).map((f) => f.code)).toEqual(['breakeven_cap_exhausted']);
    expect(breakevenFlags(false, true, 2).map((f) => f.code)).toEqual(['breakeven_cap_exhausted']);
    expect(breakevenFlags(false, false, 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/metrics.test.ts`
Expected: FAIL (`flags` not on result; `breakevenFlags` not exported).

- [ ] **Step 3: Implement**

In `metrics.ts`: `const flags: ModelFlag[] = [...model.flags];` at the top of `deriveMetrics`; replace both `model.flags.push({...})` sites with `flags.push(...breakevenFlags(...))` calls at the two decision points; add `flags` to the returned object. The helper:

```ts
/** Pure flag construction for the two break-even solvers (spec §5.11/§5.12).
 * A null solve with fee < 100% means the integer bisection exhausted its
 * 2^200-pence range — unreachable with real inputs, flagged defensively. */
export function breakevenFlags(seniorNull: boolean, developerNull: boolean, agentFeePct: number): ModelFlag[] {
  const out: ModelFlag[] = [];
  const unsolvable = agentFeePct >= 100;
  if (seniorNull && unsolvable) out.push({
    code: 'senior_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
    message: 'agent fee ≥ 100% — break-even unsolvable',
  });
  if (developerNull && unsolvable) out.push({
    code: 'developer_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
    message: 'agent fee ≥ 100% — break-even unsolvable',
  });
  if ((seniorNull || developerNull) && !unsolvable) out.push({
    code: 'breakeven_cap_exhausted', severity: 'red', month: null, amount_pence: null,
    message: 'break-even solver range exhausted — inputs are implausible; treat all break-even figures as unavailable',
  });
  return out;
}
```

Call sites: senior block passes `(seniorBreakeven == null, false, fee)` only when `redemptionBalance != null`; developer block passes `(false, developerBreakeven == null, fee)` only when `t.gross_sales_pence > 0` — preserving today's flag conditions exactly, with `breakeven_cap_exhausted` deduplicated (push it once: compute both nulls first, make ONE `breakevenFlags` call after both solvers have run, passing which solves were attempted-and-null). Update the three UI/export consumers to `run.metrics.flags` / `s.run.metrics.flags` (the memo's scenario table and short-code grid, the strip, the scenarios page).

- [ ] **Step 4: Run full frontend suite + typecheck**

Run: `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (component tests exercise the strip/scenarios/memo paths).

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "refactor(model): flags move onto the appraisal result; add breakeven_cap_exhausted"
```

---

### Task 7: Fixture H — worksheet, JSON, TS golden test

**Files:**
- Modify: `docs/financial-model/test-cases.md` (new "Fixture H" worksheet section)
- Create: `fixtures/financial-model/h-programme-scurve.json`
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts` (add H to the fixture list)
- Modify: `frontend/src/components/ConversionCalculator.tsx`, `frontend/src/components/ExportPage.tsx` — switch `migrateInputsToV3` → `migrateInputsToV4` (the UI now feeds v4 to `runAppraisal`; no other component change in R3a)

**Interfaces:**
- Consumes: everything from Tasks 2-6.
- Produces: `fixtures/financial-model/h-programme-scurve.json` with the same shape as `g-lender-valuation.json` (`{ name, kind, inputs, expected_metrics }`), `inputs.inputs_version: 4`, consumed by both engines' golden tests.

- [ ] **Step 1: Define fixture H inputs**

Copy `fixtures/financial-model/f-dev-finance-12mo.json` and change ONLY:
- `name`: `"H — dated programme, s-curve construction, shifted windows"`; `kind`: `"programme"`.
- `inputs.inputs_version`: `4`; add `"sales_phasing": null, "refinance": null, "programme": { "anchor_month": "2026-10", "packages": { "construction": { "start_offset": 1, "duration_months": 6, "curve": { "kind": "s_curve" } }, "professional": { "start_offset": 2, "duration_months": 3, "curve": { "kind": "straight_line" } }, "statutory": { "start_offset": 4, "duration_months": 2, "curve": { "kind": "back_loaded" } } } }` (keep F's `lender_valuation` value as-is).
- `inputs.conversion_costs`: set `construction_cost_per_sqm_pence: 150000`, `total_construction_sqm: 400`, `contingency_pct: 0`, `fire_safety_pence: 0`, `sound_insulation_pence: 0`, `part_l_compliance_pence: 0` (construction total = exactly 60,000,000p); set `architect_pence: 2400000`, `structural_engineer_pence: 600000`, `mande_pence: 0`, `planning_consultant_pence: 600000`, `other_professional_fees_pence: 0` (professional = 3,600,000p); set `cil_s106_pence: 2700000`, `building_control_pence: 300000` (statutory spread = 3,000,000p). Leave `prior_approval_fee_per_dwelling_pence` as F has it.
- `inputs.finance.term_months` must be 12 (it is in F).

- [ ] **Step 2: Hand-derive the worksheet in test-cases.md**

Add a "Fixture H" section following the format of the existing fixture worksheets. Normative spread tables (verify each line by hand — W(k) = (1 − cos(πk/6))/2 for construction):

| k | W(k) | Δ×60,000,000 | rounded |
|---|------|--------------|---------|
| 1 | 0.0669873 | 4,019,237.89 | 4,019,238 |
| 2 | 0.25 | 10,980,762.11 | 10,980,762 |
| 3 | 0.5 | 15,000,000.00 | 15,000,000 |
| 4 | 0.75 | 15,000,000.00 | 15,000,000 |
| 5 | 0.9330127 | 10,980,762.11 | 10,980,762 |
| 6 | 1.0 | (residue) | 4,019,238 |

Construction months 1-6: `[4019238, 10980762, 15000000, 15000000, 10980762, 4019238]`. Professional months 2-4: `[1200000, 1200000, 1200000]`. Statutory months 4-5 (back_loaded, w=k/3): `[1000000, 2000000]`; prior-approval fee at month 0. Then run the monthly ledger by hand exactly as the fixture F worksheet does (same facility terms, same §4 loop: opening balance, draws per the §4.2 rules against these new monthly uses, rolled-up interest, fees, disposal in month 11 (0-based 11 = 12th month), redemption, exit fee, equity flows) and derive every `expected_metrics` field that fixture F pins, plus `cost_to_complete` series checkpoints if F pins them. Record all intermediate columns in the worksheet — the derivation must be reproducible by a reviewer without running either engine.

- [ ] **Step 3: Pin the fixture and write the failing golden test**

Write `expected_metrics` from the worksheet into `h-programme-scurve.json`. Add `'h-programme-scurve'` to the fixture list in `golden-fixtures.test.ts` (same loading pattern as A/F/G). Run: `cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts`.
Expected: FAIL only if the worksheet and engine disagree — investigate any mismatch to root cause (worksheet arithmetic vs engine bug) before touching either; a worksheet correction is a normal outcome, an engine "adjustment to make it pass" is not (systematic-debugging applies).

- [ ] **Step 4: Switch the two UI call sites to v4**

In `ConversionCalculator.tsx` and `ExportPage.tsx`, replace each `migrateInputsToV3(` call with `migrateInputsToV4(` (imports too). Run the full suite: `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit`.
Expected: PASS — component tests confirm nothing else needed the narrower type.

- [ ] **Step 5: Commit**

```bash
git add docs/financial-model/test-cases.md fixtures/financial-model/h-programme-scurve.json frontend/src
git commit -m "feat(model): fixture H — dated programme golden fixture, hand-derived; UI feeds v4"
```

---

### Task 8: Python mirror — curves, v4, schedule, flags, fixture H

**Files:**
- Create: `app/financial_model/curves.py`
- Modify: `app/financial_model/types.py` (v4 dataclasses + parse; `CALC_VERSION` stays `"2.1.0"` until Task 9)
- Modify: `app/financial_model/migrate.py` (`is_v4`, `migrate_v3_to_v4`, and the merge path mirroring TS `migrateInputsToV4`)
- Modify: `app/financial_model/schedule.py` (`build_schedule` programme branch — mirror Task 4 exactly)
- Modify: `app/financial_model/validation.py` (mirror Task 5 rules) and `app/financial_model/metrics.py` (mirror Task 6: `flags` on the result dataclass, `breakeven_flags` helper, no model mutation)
- Modify: `app/api/app.py` (lines ~302-349: extend the normalisation chain to stamp `inputs_version: 4` via `migrate_v3_to_v4`, exactly as it chains v1→v2→v3 today)
- Test: mirror every new TS test in the corresponding `tests/` modules (find them with `grep -rl "fixture" tests/` — follow the existing port pattern used for fixtures B-G), including the golden fixture H test and the migration/identity tests

**Interfaces:**
- Consumes: fixture `h-programme-scurve.json` (Task 7), TS implementations as the normative reference.
- Produces: `spread_s_curve(total: int, months: int) -> list[int]`, `spread_back_loaded`, `spread_user_defined(total: int, weights: list[float]) -> list[int]`, `spread_by_curve(total: int, duration_months: int, curve: SpendCurve) -> list[int]`; `migrate_v3_to_v4(doc: dict) -> dict`; `is_v4(snapshot: dict) -> bool`.

- [ ] **Step 1: Port curves with tests first**

Python weight spreading must match TS float-for-float: use `math.cos`, plain float arithmetic in the same operation order as `curves.ts`, and `money_round` where TS uses `Math.round`:

```python
"""Port of frontend/src/lib/model/curves.ts (spec §6.1, calc 2.2.0)."""
import math
from .engine import money_round

def _spread_by_weights(total: int, ideal_weights: list[float]) -> list[int]:
    d = len(ideal_weights)
    if d == 0:
        return []
    out = [0] * d
    allocated = 0
    for i in range(d - 1):
        out[i] = money_round(total * ideal_weights[i])
        allocated += out[i]
    out[d - 1] = total - allocated
    return out

def spread_s_curve(total: int, months: int) -> list[int]:
    if months <= 0:
        return []
    weights, prev = [], 0.0
    for k in range(1, months + 1):
        cum = (1 - math.cos((math.pi * k) / months)) / 2
        weights.append(cum - prev)
        prev = cum
    return _spread_by_weights(total, weights)

def spread_back_loaded(total: int, months: int) -> list[int]:
    if months <= 0:
        return []
    weights = [(2 * (i + 1)) / (months * (months + 1)) for i in range(months)]
    return _spread_by_weights(total, weights)

def spread_user_defined(total: int, weights: list[float]) -> list[int]:
    s = sum(weights)
    return _spread_by_weights(total, [w / s for w in weights])
```

Port the Task 2 test table verbatim (same expected arrays). Run `python -m pytest -q tests -k curve` → PASS.

- [ ] **Step 2: Port types, migrate, schedule, validation, metrics**

Follow each TS diff from Tasks 3-6 line-for-line in the Python counterparts (the files declare themselves ports — keep that true). `build_schedule`'s programme branch mirrors Task 4's `place()` including the `min(start + i, term - 1)` clamp. In `app/api/app.py` extend the chain: after the existing v3 normalisation, `v4_dict = migrate_v3_to_v4(v3_dict)` and stamp `"inputs_version": 4` in the response block at ~line 349. Port the Task 3/5/6 tests.

- [ ] **Step 3: Golden fixture H + identity in Python**

Add H to the backend golden-fixture test list. Add an identity test: migrate each pre-v4 fixture's inputs through the full chain to v4 and assert the engine reproduces the fixture's `expected_metrics` unchanged.

- [ ] **Step 4: Run the full backend suite**

Run: `python -m pytest -q`
Expected: PASS, count > 333.

- [ ] **Step 5: Commit**

```bash
git add app tests
git commit -m "feat(backend): mirror R3a — curves, inputs v4, programme schedule, flags-on-result"
```

---

### Task 9: Version bump, invariant matrix, gates

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts:266` (`CALC_VERSION = '2.2.0'`), `app/financial_model/types.py:242` (`CALC_VERSION = "2.2.0"`)
- Modify: `frontend/src/lib/model/invariants.test.ts` + its backend counterpart (extend the invariant matrix)
- Modify: any test or doc asserting `2.1.0` (find with `grep -rn "2\.1\.0" frontend/src app tests docs/financial-model` — update only genuine current-version references, not historical changelog lines)

**Interfaces:**
- Consumes: everything prior.
- Produces: the released calc 2.2.0.

- [ ] **Step 1: Extend the invariant matrix (both engines)**

Add programme cases to the existing invariant matrix pattern: for each curve kind × several (total, D) pairs including awkward primes, assert (a) spread sums exactly to total, (b) length = D, (c) s_curve/back_loaded cumulative sums are non-decreasing, (d) a full `runAppraisal`/engine run on a programme variant of the base inputs still satisfies every existing ledger invariant (sources = uses, debt rollforward, closing never negative). Mirror the same cases in the Python matrix so the parity count grows symmetrically.

- [ ] **Step 2: Bump CALC_VERSION in both engines; sweep references**

Run the grep above; update stale assertions (the R2b memory notes a "version-reference updates" sweep was needed then too).

- [ ] **Step 3: Run every gate**

Run: `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit && npx eslint . && npm run build`, then from root `python -m pytest -q`.
Expected: all green. Record the final test counts.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(model): calc 2.2.0 — invariant matrix for curves, version bump"
```

---

### Task 10: R3a implementation report

**Files:**
- Create: `docs/reviews/2026-08-XX-release-3a-implementation-report.md` (use the actual date)

- [ ] **Step 1: Write the report** following `docs/reviews/2026-08-14-release-2b-implementation-report.md`'s structure: what shipped per spec section, commit map, gate results with test counts, the identity-invariant evidence (which fixtures prove it), deferred items (unchanged R3b/R4 lists), any deviations from this plan with rationale.

- [ ] **Step 2: Commit**

```bash
git add docs/reviews
git commit -m "docs: Release 3a implementation report"
```

---

## Self-Review Notes

- Spec coverage: design §2.1/§2.4 → Tasks 1, 3; §3.1 → Tasks 2, 4, 5; §3.2 → Task 6; §3.3 proof obligations → Tasks 7 (fixture H), 8 (Python identity), 9 (parity matrix); §5.2 governance → Tasks 1, 7. R3b sections intentionally out of scope; the inert-block rejection (design §2.4) is Task 5.
- Cross-engine float risk: s_curve cosines are IEEE doubles in both engines with identical operation order; a divergence would need an ideal monthly value within ~1e-9 of a .5p boundary. Fixture H and the parity matrix are the tripwire — if one ever fires, resolve by spec amendment (tabulated weights), not ad-hoc rounding.
- `calc_version` is NOT in fixture `expected_metrics` (verified against fixture G), so the Task 9 bump cannot break golden tests; identity tests compare metrics fields, not the version string.
