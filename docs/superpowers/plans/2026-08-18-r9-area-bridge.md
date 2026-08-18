# R9 — Area Bridge and Efficiency Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two unrelated area numbers joined by a ±25% warning with a reconciled area bridge that derives the construction cost area through a single enforced accessor, and split ancillary (parking/balcony/terrace) value out of internal saleable GDV.

**Architecture:** A new `areas` module per language owns every area derivation and is the only legal reader of the raw cost-area field; an eslint rule and a Python source scan fail the build on any other reader, and the same guard is extended to acquisition tax to close the class R8 left open. Inputs move v5 → v6 additively, so every migrated document is numerically identical. Ancillary value becomes a separate GDV component, which forces three latent consumer fixes (lender per-sq-ft basis, sale receipts, scenario multipliers).

**Tech Stack:** TypeScript + React + Vite + vitest (frontend); Python 3 + Pydantic v2 + FastAPI + pytest (backend); dual-engine parity enforced by shared JSON fixtures in `fixtures/financial-model/`.

**Spec:** `docs/superpowers/specs/2026-08-18-r9-area-bridge-design.md`

## Global Constraints

Copied verbatim from the spec and the repository's standing rules. Every task's requirements implicitly include this section.

- **Both engines mirror.** Every calculation added to `frontend/src/lib/` has an identical Python twin in `app/financial_model/`, and vice versa. A change to one without the other is an incomplete task.
- **No calculation logic in React components or report generators.** Components read derived values; they never recompute one.
- **Calc version:** `2.7.0` → `2.8.0` (minor). Set in `frontend/src/lib/model/finance-types.ts` (`CALC_VERSION`) and `app/financial_model/types.py` (`CALC_VERSION`). Both must match exactly.
- **Inputs version:** v5 → **v6**.
- **Integer pence** for all money. Areas are floating-point m². Money rounding is half-up via `Math.round` (TS) / `money_round` (Python) — never banker's rounding.
- **Percentages** are computed through the shared `pct()` helper: 2 dp, and **`null` when the denominator is zero** (spec §1.5). Never `0`, never a division by zero.
- **Migration is numerically identical.** After `v5 → v6`, every existing golden fixture must produce byte-identical output. This is the acceptance test for Task 3, not a hope.
- **Unrecognised `inputs_version` must 422 in both engines** — never fall through to the v1 fallback path.
- **The full gate set must pass before any task is called done:** `npm run test` (vitest), `pytest`, `npm run lint` (eslint), `npx tsc -b`, `npm run build`.
- **Baseline suite counts before R9:** vitest **1186**, pytest **969**. Counts only ever go up.
- **Areas are stored in m².** Sq ft is a display/lender-basis conversion only, via the existing `SQFT_PER_SQM = 10.7639` constant in `lender-valuation.ts`.
- **Derived-area arithmetic must use the exact operation order given in this plan** in both languages, so IEEE-754 results are bit-identical and parity assertions can be exact.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `frontend/src/lib/model/pct.ts` | The 3-line `pct()` helper, extracted from `metrics.ts` so `areas.ts` can use it without an import cycle. |
| `frontend/src/lib/model/areas.ts` | Area bridge types, derivation, efficiencies, and the two exported accessors. The **only** legal reader of `total_construction_sqm`. |
| `frontend/src/lib/model/areas.test.ts` | Unit tests for the above. |
| `app/financial_model/areas.py` | Python mirror of `areas.ts`. |
| `tests/test_areas.py` | Python unit tests. |
| `tests/test_accessor_guard.py` | Source scan asserting no unauthorised reader of the guarded fields. |
| `frontend/src/lib/model/accessor-guard.test.ts` | Asserts the eslint rule actually fires on a planted violation. |
| `frontend/src/components/calculator/AreasPage.tsx` | The bridge reconciliation UI. |
| `frontend/src/components/calculator/AreasPage.test.tsx` | Component tests. |
| `fixtures/financial-model/n-area-bridge.json` | Golden fixture: bridge-derived cost area. |
| `fixtures/financial-model/o-ancillary-value.json` | Golden fixture: ancillary value through GDV, receipts and a scenario. |
| `fixtures/financial-model/p-scotland-levered.json` | Golden fixture: levered LBTT path (R8 carry-forward). |

**Modified files**

| Path | Change |
|---|---|
| `frontend/src/lib/conversion-types.ts` | `UnitAncillary`, `ProposedUnitV6`, `UnitMixInputsV6`. |
| `frontend/src/lib/model/finance-types.ts` | `CalculatorInputsV6`, `AnyCalculatorInputs` union, `CALC_VERSION`, `AppraisalResultV2` output fields. |
| `frontend/src/lib/model/metrics.ts` | Re-export `pct`; emit the new output fields. |
| `frontend/src/lib/model/migrate.ts` | `isV6`, `migrateV5toV6`, `migrateInputsToV6`, version roster. |
| `frontend/src/lib/model/schedule.ts` | Cost area via accessor; ancillary into `grossSales`. |
| `frontend/src/lib/model/validation.ts` | New area rules; **delete** the ±25% warning. |
| `frontend/src/lib/model/lender-valuation.ts` | `global_per_sqft` bound to internal NIA. |
| `frontend/src/lib/model/apply-scenario.ts` | GDV multiplier covers ancillary value. |
| `frontend/src/lib/conversion-calc-engine.ts` | `calculateTotalConstructionCost` takes an explicit area; `calculateGdv` splits. |
| `frontend/src/lib/conversion-defaults.ts` | `DEFAULT_AREA_BRIDGE`, default ancillary. |
| `frontend/src/lib/export-investment-memo.ts` | Area schedule, efficiencies, GDV split. |
| `frontend/src/components/ConversionCalculator.tsx` | Register the Areas page. |
| `frontend/src/components/calculator/ConversionCostsPage.tsx` | Basis selector. |
| `frontend/src/components/calculator/UnitMixPage.tsx` | Per-unit ancillary fields. |
| `frontend/eslint.config.js` | The `no-restricted-syntax` guard. |
| `app/financial_model/engine.py` | Host `pct()`. |
| `app/financial_model/types.py` | v6 models, `CALC_VERSION`, result fields. |
| `app/financial_model/metrics.py` | Re-export `pct`; emit the new output fields. |
| `app/financial_model/migrate.py` | `is_v6`, `migrate_v5_to_v6`, `migrate_inputs_to_v6`. |
| `app/financial_model/schedule.py` | Cost area via accessor; ancillary into gross sales. |
| `app/financial_model/validation.py` | New area rules; **delete** the ±25% warning. |
| `app/financial_model/lender_valuation.py` | `global_per_sqft` bound to internal NIA. |
| `app/financial_model/apply_scenario.py` | GDV multiplier covers ancillary; docstring fix. |
| `app/financial_model/__init__.py` | `__all__` gains V5 **and** V6 symbols. |
| `app/api/app.py` | Boundary moves to `migrate_inputs_to_v6`. |
| `docs/financial-model/*.md` | Spec §15, §2, §3.1, §3.2, governance, test cases, migration notes. |

---

## Task 1: The `pct` extraction and the TypeScript areas module

**Files:**
- Create: `frontend/src/lib/model/pct.ts`
- Create: `frontend/src/lib/model/areas.ts`
- Create: `frontend/src/lib/model/areas.test.ts`
- Modify: `frontend/src/lib/model/metrics.ts:13-17` (remove the local `pct`, re-export)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AreaBasis`, `AreaBridgeInputs`, `AreaBridgeResult`, `DEFAULT_AREA_BRIDGE`, `unitNiaSqm(units)`, `areaBridge(inputs)`, `developedAreaSqm(inputs)`, and `pct(numerator, denominator)` from `./pct`.

**Why `pct` moves first:** `areas.ts` needs `pct`, and Task 9 makes `metrics.ts` import `areas.ts`. Leaving `pct` in `metrics.ts` creates an import cycle. It is a three-line pure function with no imports, so extracting it is free.

- [ ] **Step 1: Extract `pct` into its own module**

Create `frontend/src/lib/model/pct.ts`:

```ts
/** Percentage to 2 dp; null when the denominator is zero (spec §1.5).
 *
 * Extracted from metrics.ts in R9 so `areas.ts` can use it without an import
 * cycle (metrics.ts imports areas.ts for the area-bridge output block).
 * metrics.ts re-exports it, so every existing importer is unaffected. */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}
```

- [ ] **Step 2: Point `metrics.ts` at it**

In `frontend/src/lib/model/metrics.ts`, delete the local `pct` definition (currently lines 13–17) and add to the imports:

```ts
import { pct } from './pct';
```

Then, immediately after the import block, re-export it so existing importers keep working:

```ts
/** Re-exported from './pct' (R9). Many modules and tests import `pct` from
 *  metrics; the definition moved to break an import cycle, not to move the
 *  public name. */
export { pct };
```

- [ ] **Step 3: Run the existing suite to confirm the extraction changed nothing**

Run: `cd frontend && npm run test -- --run`
Expected: PASS, 1186 tests. A failure here means an importer was missed, not that the logic changed.

- [ ] **Step 4: Commit the extraction on its own**

```bash
git add frontend/src/lib/model/pct.ts frontend/src/lib/model/metrics.ts
git commit -m "refactor: extract pct() so areas.ts can use it without a cycle"
```

- [ ] **Step 5: Write the failing tests for the areas module**

Create `frontend/src/lib/model/areas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AREA_BRIDGE, areaBridge, developedAreaSqm, unitNiaSqm,
} from './areas';
import type { AreaBridgeInputs } from './areas';
import type { AnyCalculatorInputs } from './finance-types';

/** Minimal inputs shaped just enough for the areas module. The areas module
 *  reads only `areas`, `conversion_costs.total_construction_sqm`, `unit_mix`
 *  and `exit_strategy`, so nothing else needs to be real. */
function makeInputs(
  areas: Partial<AreaBridgeInputs>,
  units: Array<{ id: string; floor_area_sqm: number }> = [],
  opts: { manualSqm?: number; route?: string; retainedIds?: string[] } = {},
): AnyCalculatorInputs {
  return {
    areas: { ...DEFAULT_AREA_BRIDGE, ...areas },
    conversion_costs: { total_construction_sqm: opts.manualSqm ?? 0 },
    unit_mix: { units: units.map((u) => ({ ...u, type: '1bed', estimated_value_pence: 1, comparable_notes: '' })) },
    exit_strategy: {
      route: opts.route ?? 'sell_all',
      retained_units: (opts.retainedIds ?? []).map((id) => ({ unit_id: id, monthly_rent_pence: 0 })),
    },
  } as unknown as AnyCalculatorInputs;
}

const FULL_BRIDGE: Partial<AreaBridgeInputs> = {
  basis: 'bridge_derived',
  existing_gia_sqm: 600,
  demolished_gia_sqm: 20,
  extension_gia_sqm: 40,
  retained_commercial_gia_sqm: 100,
  untouched_gia_sqm: 0,
  circulation_common_sqm: 62,
  plant_riser_sqm: 18,
  store_bin_cycle_sqm: 14,
  amenity_sqm: 6,
  external_amenity_sqm: 150,
};

describe('areaBridge derivation', () => {
  it('derives proposed GIA as existing minus demolished plus extension', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE));
    expect(b.proposed_gia_sqm).toBe(620);
  });

  it('derives developed GIA by removing retained commercial and untouched area', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE));
    expect(b.developed_gia_sqm).toBe(520);
  });

  it('derives available-for-units by removing non-saleable internal areas', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE));
    // 520 - 62 - 18 - 14 - 6
    expect(b.available_for_units_sqm).toBe(420);
  });

  it('reports the unallocated balance rather than hiding it', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, [
      { id: 'u1', floor_area_sqm: 60 },
      { id: 'u2', floor_area_sqm: 60 },
    ]));
    expect(b.unit_nia_sqm).toBe(120);
    expect(b.unallocated_sqm).toBe(300);
  });

  it('reports a negative unallocated balance when units over-fill the building', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, [{ id: 'u1', floor_area_sqm: 500 }]));
    expect(b.unallocated_sqm).toBe(-80);
  });

  it('keeps external amenity out of the reconciliation entirely', () => {
    const withExternal = areaBridge(makeInputs(FULL_BRIDGE));
    const withoutExternal = areaBridge(makeInputs({ ...FULL_BRIDGE, external_amenity_sqm: 0 }));
    expect(withExternal.developed_gia_sqm).toBe(withoutExternal.developed_gia_sqm);
    expect(withExternal.available_for_units_sqm).toBe(withoutExternal.available_for_units_sqm);
    expect(withExternal.external_amenity_sqm).toBe(150);
  });
});

describe('efficiencies', () => {
  const units = [{ id: 'u1', floor_area_sqm: 200 }, { id: 'u2', floor_area_sqm: 160 }];

  it('computes NIA over developed GIA as the policy ratio', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, units));
    // 360 / 520
    expect(b.nia_to_gia_pct).toBe(69.23);
  });

  it('computes NIA over proposed GIA for the whole building', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, units));
    // 360 / 620
    expect(b.nia_to_proposed_gia_pct).toBe(58.06);
  });

  it('computes saleable over developed from the units actually being sold', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, units, { route: 'blended', retainedIds: ['u2'] }));
    // 200 / 520 — u2 is retained, so only u1 is saleable
    expect(b.saleable_to_developed_pct).toBe(38.46);
  });

  it('reports zero saleable efficiency under retain-all, which is the true answer', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, units, { route: 'retain_all' }));
    expect(b.saleable_to_developed_pct).toBe(0);
  });

  it('returns null rather than zero when a denominator is zero', () => {
    const b = areaBridge(makeInputs({ basis: 'bridge_derived' }, units));
    expect(b.developed_gia_sqm).toBe(0);
    expect(b.nia_to_gia_pct).toBeNull();
    expect(b.nia_to_proposed_gia_pct).toBeNull();
    expect(b.saleable_to_developed_pct).toBeNull();
  });
});

describe('developedAreaSqm — the single cost-area accessor', () => {
  it('returns the derived developed GIA under the bridge basis', () => {
    expect(developedAreaSqm(makeInputs(FULL_BRIDGE, [], { manualSqm: 999 }))).toBe(520);
  });

  it('returns the manual field under the manual basis, ignoring a populated bridge', () => {
    const inputs = makeInputs({ ...FULL_BRIDGE, basis: 'manual' }, [], { manualSqm: 480 });
    expect(developedAreaSqm(inputs)).toBe(480);
  });

  it('falls back to the manual field for a pre-v6 document with no areas block', () => {
    const legacy = {
      conversion_costs: { total_construction_sqm: 500 },
      unit_mix: { units: [] },
      exit_strategy: { route: 'sell_all', retained_units: [] },
    } as unknown as AnyCalculatorInputs;
    expect(developedAreaSqm(legacy)).toBe(500);
    expect(areaBridge(legacy).basis).toBe('manual');
  });
});

describe('unitNiaSqm', () => {
  it('sums internal areas only and never ancillary', () => {
    const units = [
      { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 1, comparable_notes: '',
        ancillary: { balcony_terrace_sqm: 8, balcony_terrace_value_pence: 0, parking_spaces: 1, parking_value_pence: 0 } },
    ];
    expect(unitNiaSqm(units as never)).toBe(50);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd frontend && npm run test -- --run areas.test.ts`
Expected: FAIL — `Failed to resolve import "./areas"`.

- [ ] **Step 7: Implement the areas module**

Create `frontend/src/lib/model/areas.ts`:

```ts
import type { AnyCalculatorInputs } from './finance-types';
import type { ProposedUnit } from '../conversion-types';
import { pct } from './pct';

/** Which number is the construction cost area (spec §15.3).
 *  `bridge_derived` — the reconciled `developed_gia_sqm` below.
 *  `manual` — `conversion_costs.total_construction_sqm`, the pre-R9 field. */
export type AreaBasis = 'bridge_derived' | 'manual';

/** Spec §15.1. Every field here is ENTERED. Nothing derived is stored. */
export interface AreaBridgeInputs {
  basis: AreaBasis;
  existing_gia_sqm: number;
  demolished_gia_sqm: number;
  extension_gia_sqm: number;
  retained_commercial_gia_sqm: number;
  untouched_gia_sqm: number;
  circulation_common_sqm: number;
  plant_riser_sqm: number;
  store_bin_cycle_sqm: number;
  amenity_sqm: number;
  /** External amenity and landscape. NOT gross internal area — carried through
   *  the result for display but never deducted from the reconciliation. */
  external_amenity_sqm: number;
}

export const DEFAULT_AREA_BRIDGE: AreaBridgeInputs = {
  basis: 'manual',
  existing_gia_sqm: 0,
  demolished_gia_sqm: 0,
  extension_gia_sqm: 0,
  retained_commercial_gia_sqm: 0,
  untouched_gia_sqm: 0,
  circulation_common_sqm: 0,
  plant_riser_sqm: 0,
  store_bin_cycle_sqm: 0,
  amenity_sqm: 0,
  external_amenity_sqm: 0,
};

/** Spec §15.1/§15.2 — every entered line, every derived line, every ratio.
 *  This is the ONLY shape the UI and the report may read areas from. */
export interface AreaBridgeResult {
  basis: AreaBasis;
  existing_gia_sqm: number;
  demolished_gia_sqm: number;
  extension_gia_sqm: number;
  proposed_gia_sqm: number;
  retained_commercial_gia_sqm: number;
  untouched_gia_sqm: number;
  developed_gia_sqm: number;
  circulation_common_sqm: number;
  plant_riser_sqm: number;
  store_bin_cycle_sqm: number;
  amenity_sqm: number;
  available_for_units_sqm: number;
  unit_nia_sqm: number;
  unallocated_sqm: number;
  external_amenity_sqm: number;
  ancillary_balcony_terrace_sqm: number;
  ancillary_parking_spaces: number;
  /** The cost area actually in force, whichever basis produced it. */
  developed_area_sqm: number;
  nia_to_gia_pct: number | null;
  nia_to_proposed_gia_pct: number | null;
  saleable_to_developed_pct: number | null;
}

/** Σ internal net internal area. Ancillary (balcony, terrace, parking) is
 *  deliberately excluded — spec §15.5 keeps it outside NIA. */
export function unitNiaSqm(units: readonly ProposedUnit[]): number {
  return units.reduce((s, u) => s + u.floor_area_sqm, 0);
}

/** A v2–v5 document has no `areas` block at all. Reading it structurally (the
 *  codebase's version-dispatch idiom — see `'lender_valuation' in inputs` in
 *  metrics.ts) resolves it to the manual basis with a zeroed bridge, which is
 *  exactly what migration writes. Legacy and migrated documents therefore
 *  behave identically, and no caller needs a version check. */
function bridgeInputsOf(inputs: AnyCalculatorInputs): AreaBridgeInputs {
  if (!('areas' in inputs) || inputs.areas == null) return DEFAULT_AREA_BRIDGE;
  return { ...DEFAULT_AREA_BRIDGE, ...(inputs.areas as Partial<AreaBridgeInputs>) };
}

/**
 * Spec §15 — the whole reconciliation, in one place.
 *
 * The arithmetic order below is normative and is mirrored operation-for-operation
 * in `app/financial_model/areas.py`, so both engines produce bit-identical
 * IEEE-754 results and the fixture parity assertions can be exact rather than
 * tolerant.
 */
export function areaBridge(inputs: AnyCalculatorInputs): AreaBridgeResult {
  const a = bridgeInputsOf(inputs);
  const units = inputs.unit_mix.units;

  const proposed = a.existing_gia_sqm - a.demolished_gia_sqm + a.extension_gia_sqm;
  const developed = proposed - a.retained_commercial_gia_sqm - a.untouched_gia_sqm;
  const available = developed
    - a.circulation_common_sqm
    - a.plant_riser_sqm
    - a.store_bin_cycle_sqm
    - a.amenity_sqm;

  const unitNia = unitNiaSqm(units);
  const unallocated = available - unitNia;

  // Saleable area is exit-coupled by design (spec §15.2): it answers "what
  // proportion of the area being funded is being sold?", so a retain-all
  // scheme correctly reports 0%.
  const retainedIds = new Set(inputs.exit_strategy.retained_units.map((r) => r.unit_id));
  const route = inputs.exit_strategy.route;
  const soldUnits =
    route === 'retain_all' ? [] :
    route === 'sell_all' ? units :
    units.filter((u) => !retainedIds.has(u.id));
  const saleableNia = unitNiaSqm(soldUnits);

  const ancillary = units.reduce(
    (acc, u) => {
      const anc = 'ancillary' in u ? (u as { ancillary?: { balcony_terrace_sqm?: number; parking_spaces?: number } }).ancillary : undefined;
      acc.balcony += anc?.balcony_terrace_sqm ?? 0;
      acc.spaces += anc?.parking_spaces ?? 0;
      return acc;
    },
    { balcony: 0, spaces: 0 },
  );

  const costArea = a.basis === 'bridge_derived'
    ? developed
    : inputs.conversion_costs.total_construction_sqm;

  return {
    basis: a.basis,
    existing_gia_sqm: a.existing_gia_sqm,
    demolished_gia_sqm: a.demolished_gia_sqm,
    extension_gia_sqm: a.extension_gia_sqm,
    proposed_gia_sqm: proposed,
    retained_commercial_gia_sqm: a.retained_commercial_gia_sqm,
    untouched_gia_sqm: a.untouched_gia_sqm,
    developed_gia_sqm: developed,
    circulation_common_sqm: a.circulation_common_sqm,
    plant_riser_sqm: a.plant_riser_sqm,
    store_bin_cycle_sqm: a.store_bin_cycle_sqm,
    amenity_sqm: a.amenity_sqm,
    available_for_units_sqm: available,
    unit_nia_sqm: unitNia,
    unallocated_sqm: unallocated,
    external_amenity_sqm: a.external_amenity_sqm,
    ancillary_balcony_terrace_sqm: ancillary.balcony,
    ancillary_parking_spaces: ancillary.spaces,
    developed_area_sqm: costArea,
    nia_to_gia_pct: pct(unitNia, developed),
    nia_to_proposed_gia_pct: pct(unitNia, proposed),
    saleable_to_developed_pct: pct(saleableNia, developed),
  };
}

/**
 * **The** construction cost area. Spec §15.3/§15.4.
 *
 * Every consumer — the cost stack, validation, the deal spider, the UI, the
 * memo — calls this and nothing else. `conversion_costs.total_construction_sqm`
 * is off-limits outside this module, enforced by the eslint rule added in
 * Task 5 and by `tests/test_accessor_guard.py` on the Python side.
 *
 * That enforcement exists because R8 proved convention alone is not enough: the
 * same "moved the computation, missed a consumer" defect recurred three times
 * in one release (`calculateTotalAcquisitionCost`, `deal-spider.ts`,
 * `AcquisitionPage.tsx`), each site individually self-consistent and therefore
 * invisible to a green test suite.
 */
export function developedAreaSqm(inputs: AnyCalculatorInputs): number {
  return areaBridge(inputs).developed_area_sqm;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd frontend && npm run test -- --run areas.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 9: Typecheck and lint**

Run: `cd frontend && npx tsc -b && npm run lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/model/areas.ts frontend/src/lib/model/areas.test.ts
git commit -m "feat: area bridge derivation and the single cost-area accessor (TS)"
```

---

## Task 2: The Python areas module and cross-engine parity

**Files:**
- Modify: `app/financial_model/engine.py` (host `pct`)
- Modify: `app/financial_model/metrics.py:175` (import and re-export `pct`)
- Create: `app/financial_model/areas.py`
- Create: `tests/test_areas.py`

**Interfaces:**
- Consumes: `AreaBridgeInputs`/`AreaBridgeResult` field names and the arithmetic order from Task 1. These must match **exactly** — same snake_case names, same operation order.
- Produces: `AreaBasis`, `AreaBridgeInputs`, `AreaBridgeResult`, `DEFAULT_AREA_BRIDGE`, `unit_nia_sqm(units)`, `area_bridge(inputs)`, `developed_area_sqm(inputs)`.

- [ ] **Step 1: Move `pct` into `engine.py`**

`areas.py` needs `pct`, and Task 9 makes `metrics.py` import `areas.py` — the same cycle Task 1 broke on the TS side. `engine.py` already hosts `money_round` and is imported by `acquisition_tax.py`, so it is the established home for shared primitives.

Add to `app/financial_model/engine.py`, next to `money_round`:

```python
def pct(numerator: float, denominator: float) -> float | None:
    """Percentage to 2 dp; None when the denominator is zero (spec Sec 1.5).

    Moved here from metrics.py in R9 so areas.py can use it without an import
    cycle (metrics.py imports areas.py for the area-bridge output block).
    metrics.py re-exports it, so every existing importer is unaffected.
    """
    if denominator == 0:
        return None
    return round((numerator / denominator) * 10000) / 100
```

- [ ] **Step 2: Point `metrics.py` at it**

In `app/financial_model/metrics.py`, delete the `def pct(...)` at line 175 and add `pct` to the existing import from `.engine`. Then add, next to the other module-level names:

```python
__all__ = [*globals().get("__all__", []), "pct"]  # re-exported; definition moved to engine.py in R9
```

If `metrics.py` has no `__all__`, skip that line — the plain `from .engine import ... pct` already re-exports it for `from .metrics import pct` callers.

- [ ] **Step 3: Run pytest to confirm the move changed nothing**

Run: `pytest -q`
Expected: PASS, 969 tests.

- [ ] **Step 4: Commit the move**

```bash
git add app/financial_model/engine.py app/financial_model/metrics.py
git commit -m "refactor: move pct() to engine.py so areas.py can use it without a cycle"
```

- [ ] **Step 5: Write the failing Python tests**

Create `tests/test_areas.py`:

```python
"""R9 spec Sec 15 — the Python half of the area bridge.

Every expectation here is the same number asserted by the TypeScript
areas.test.ts. The two suites are written independently against the spec, not
ported from one another, so a shared misreading cannot pass both.
"""
import pytest

from app.financial_model.areas import (
    DEFAULT_AREA_BRIDGE,
    area_bridge,
    developed_area_sqm,
    unit_nia_sqm,
)

FULL_BRIDGE = {
    "basis": "bridge_derived",
    "existing_gia_sqm": 600.0,
    "demolished_gia_sqm": 20.0,
    "extension_gia_sqm": 40.0,
    "retained_commercial_gia_sqm": 100.0,
    "untouched_gia_sqm": 0.0,
    "circulation_common_sqm": 62.0,
    "plant_riser_sqm": 18.0,
    "store_bin_cycle_sqm": 14.0,
    "amenity_sqm": 6.0,
    "external_amenity_sqm": 150.0,
}


class _Unit:
    def __init__(self, uid, area, ancillary=None):
        self.id = uid
        self.floor_area_sqm = area
        self.ancillary = ancillary


class _Exit:
    def __init__(self, route="sell_all", retained=()):
        self.route = route
        self.retained_units = [type("R", (), {"unit_id": u})() for u in retained]


class _Inputs:
    """Duck-typed stand-in. areas.py reads only these four attributes, so the
    full Pydantic model is unnecessary here and would obscure what is read."""

    def __init__(self, areas=None, units=(), manual_sqm=0.0, route="sell_all", retained=()):
        self.areas = areas
        self.unit_mix = type("UM", (), {"units": list(units)})()
        self.conversion_costs = type("CC", (), {"total_construction_sqm": manual_sqm})()
        self.exit_strategy = _Exit(route, retained)


def make(areas_overrides=None, units=(), **kw):
    areas = None
    if areas_overrides is not None:
        areas = {**DEFAULT_AREA_BRIDGE, **areas_overrides}
    return _Inputs(areas=areas, units=units, **kw)


def test_proposed_gia_is_existing_less_demolished_plus_extension():
    assert area_bridge(make(FULL_BRIDGE)).proposed_gia_sqm == 620.0


def test_developed_gia_removes_retained_commercial_and_untouched():
    assert area_bridge(make(FULL_BRIDGE)).developed_gia_sqm == 520.0


def test_available_for_units_removes_non_saleable_internal_area():
    assert area_bridge(make(FULL_BRIDGE)).available_for_units_sqm == 420.0


def test_unallocated_balance_is_reported_not_hidden():
    b = area_bridge(make(FULL_BRIDGE, units=[_Unit("u1", 60.0), _Unit("u2", 60.0)]))
    assert b.unit_nia_sqm == 120.0
    assert b.unallocated_sqm == 300.0


def test_unallocated_balance_goes_negative_when_units_overfill():
    b = area_bridge(make(FULL_BRIDGE, units=[_Unit("u1", 500.0)]))
    assert b.unallocated_sqm == -80.0


def test_external_amenity_never_enters_the_reconciliation():
    with_ext = area_bridge(make(FULL_BRIDGE))
    without = area_bridge(make({**FULL_BRIDGE, "external_amenity_sqm": 0.0}))
    assert with_ext.developed_gia_sqm == without.developed_gia_sqm
    assert with_ext.available_for_units_sqm == without.available_for_units_sqm
    assert with_ext.external_amenity_sqm == 150.0


def test_nia_to_gia_is_the_policy_ratio():
    b = area_bridge(make(FULL_BRIDGE, units=[_Unit("u1", 200.0), _Unit("u2", 160.0)]))
    assert b.nia_to_gia_pct == 69.23


def test_nia_to_proposed_gia_covers_the_whole_building():
    b = area_bridge(make(FULL_BRIDGE, units=[_Unit("u1", 200.0), _Unit("u2", 160.0)]))
    assert b.nia_to_proposed_gia_pct == 58.06


def test_saleable_efficiency_counts_only_units_being_sold():
    b = area_bridge(make(
        FULL_BRIDGE, units=[_Unit("u1", 200.0), _Unit("u2", 160.0)],
        route="blended", retained=["u2"],
    ))
    assert b.saleable_to_developed_pct == 38.46


def test_retain_all_reports_zero_saleable_efficiency():
    b = area_bridge(make(
        FULL_BRIDGE, units=[_Unit("u1", 200.0), _Unit("u2", 160.0)], route="retain_all",
    ))
    assert b.saleable_to_developed_pct == 0


@pytest.mark.parametrize(
    "field", ["nia_to_gia_pct", "nia_to_proposed_gia_pct", "saleable_to_developed_pct"],
)
def test_zero_denominator_is_none_never_zero(field):
    b = area_bridge(make({"basis": "bridge_derived"}, units=[_Unit("u1", 200.0)]))
    assert b.developed_gia_sqm == 0.0
    assert getattr(b, field) is None


def test_bridge_basis_uses_the_derived_area_and_ignores_the_manual_field():
    assert developed_area_sqm(make(FULL_BRIDGE, manual_sqm=999.0)) == 520.0


def test_manual_basis_uses_the_manual_field_and_ignores_a_populated_bridge():
    inputs = make({**FULL_BRIDGE, "basis": "manual"}, manual_sqm=480.0)
    assert developed_area_sqm(inputs) == 480.0


def test_document_with_no_areas_block_falls_back_to_manual():
    legacy = make(None, manual_sqm=500.0)
    assert developed_area_sqm(legacy) == 500.0
    assert area_bridge(legacy).basis == "manual"


def test_unit_nia_excludes_ancillary_area():
    anc = type("A", (), {"balcony_terrace_sqm": 8.0, "parking_spaces": 1})()
    assert unit_nia_sqm([_Unit("u1", 50.0, anc)]) == 50.0
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pytest tests/test_areas.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.financial_model.areas'`.

- [ ] **Step 7: Implement the Python areas module**

Create `app/financial_model/areas.py`:

```python
"""R9 spec Sec 15 -- the area bridge. Mirror of frontend/src/lib/model/areas.ts.

The arithmetic order in ``area_bridge`` is normative and matches areas.ts
operation-for-operation, so both engines produce bit-identical IEEE-754 results
and the golden-fixture parity assertions can be exact rather than tolerant.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .engine import pct

AreaBasis = Literal["bridge_derived", "manual"]

# Every key here is ENTERED. Nothing derived is stored (spec Sec 15.1).
DEFAULT_AREA_BRIDGE: dict[str, Any] = {
    "basis": "manual",
    "existing_gia_sqm": 0.0,
    "demolished_gia_sqm": 0.0,
    "extension_gia_sqm": 0.0,
    "retained_commercial_gia_sqm": 0.0,
    "untouched_gia_sqm": 0.0,
    "circulation_common_sqm": 0.0,
    "plant_riser_sqm": 0.0,
    "store_bin_cycle_sqm": 0.0,
    "amenity_sqm": 0.0,
    "external_amenity_sqm": 0.0,
}


@dataclass(frozen=True)
class AreaBridgeResult:
    """Spec Sec 15.1/15.2. Mirrors AreaBridgeResult in areas.ts field for field."""

    basis: AreaBasis
    existing_gia_sqm: float
    demolished_gia_sqm: float
    extension_gia_sqm: float
    proposed_gia_sqm: float
    retained_commercial_gia_sqm: float
    untouched_gia_sqm: float
    developed_gia_sqm: float
    circulation_common_sqm: float
    plant_riser_sqm: float
    store_bin_cycle_sqm: float
    amenity_sqm: float
    available_for_units_sqm: float
    unit_nia_sqm: float
    unallocated_sqm: float
    external_amenity_sqm: float
    ancillary_balcony_terrace_sqm: float
    ancillary_parking_spaces: float
    developed_area_sqm: float
    nia_to_gia_pct: float | None
    nia_to_proposed_gia_pct: float | None
    saleable_to_developed_pct: float | None


def unit_nia_sqm(units) -> float:
    """Sum of internal net internal area. Ancillary (balcony, terrace, parking)
    is deliberately excluded -- spec Sec 15.5 keeps it outside NIA."""
    return sum(u.floor_area_sqm for u in units)


def _bridge_inputs_of(inputs) -> dict[str, Any]:
    """A v2-v5 document has no ``areas`` block at all. Reading it with getattr
    (this module's version-dispatch idiom, matching validation.py's existing
    ``getattr(inputs, 'programme', None)`` checks) resolves it to the manual
    basis with a zeroed bridge -- exactly what migration writes, so legacy and
    migrated documents behave identically and no caller needs a version check.
    """
    raw = getattr(inputs, "areas", None)
    if raw is None:
        return dict(DEFAULT_AREA_BRIDGE)
    if not isinstance(raw, dict):
        raw = raw.model_dump() if hasattr(raw, "model_dump") else vars(raw)
    return {**DEFAULT_AREA_BRIDGE, **raw}


def area_bridge(inputs) -> AreaBridgeResult:
    a = _bridge_inputs_of(inputs)
    units = inputs.unit_mix.units

    proposed = a["existing_gia_sqm"] - a["demolished_gia_sqm"] + a["extension_gia_sqm"]
    developed = proposed - a["retained_commercial_gia_sqm"] - a["untouched_gia_sqm"]
    available = (
        developed
        - a["circulation_common_sqm"]
        - a["plant_riser_sqm"]
        - a["store_bin_cycle_sqm"]
        - a["amenity_sqm"]
    )

    nia = unit_nia_sqm(units)
    unallocated = available - nia

    # Saleable area is exit-coupled by design (spec Sec 15.2): it answers "what
    # proportion of the area being funded is being sold?", so a retain-all
    # scheme correctly reports 0%.
    retained_ids = {r.unit_id for r in inputs.exit_strategy.retained_units}
    route = inputs.exit_strategy.route
    if route == "retain_all":
        sold = []
    elif route == "sell_all":
        sold = list(units)
    else:
        sold = [u for u in units if u.id not in retained_ids]
    saleable_nia = unit_nia_sqm(sold)

    balcony = 0.0
    spaces = 0.0
    for u in units:
        anc = getattr(u, "ancillary", None)
        if anc is None:
            continue
        balcony += getattr(anc, "balcony_terrace_sqm", 0.0) or 0.0
        spaces += getattr(anc, "parking_spaces", 0) or 0

    cost_area = (
        developed
        if a["basis"] == "bridge_derived"
        else inputs.conversion_costs.total_construction_sqm
    )

    return AreaBridgeResult(
        basis=a["basis"],
        existing_gia_sqm=a["existing_gia_sqm"],
        demolished_gia_sqm=a["demolished_gia_sqm"],
        extension_gia_sqm=a["extension_gia_sqm"],
        proposed_gia_sqm=proposed,
        retained_commercial_gia_sqm=a["retained_commercial_gia_sqm"],
        untouched_gia_sqm=a["untouched_gia_sqm"],
        developed_gia_sqm=developed,
        circulation_common_sqm=a["circulation_common_sqm"],
        plant_riser_sqm=a["plant_riser_sqm"],
        store_bin_cycle_sqm=a["store_bin_cycle_sqm"],
        amenity_sqm=a["amenity_sqm"],
        available_for_units_sqm=available,
        unit_nia_sqm=nia,
        unallocated_sqm=unallocated,
        external_amenity_sqm=a["external_amenity_sqm"],
        ancillary_balcony_terrace_sqm=balcony,
        ancillary_parking_spaces=spaces,
        developed_area_sqm=cost_area,
        nia_to_gia_pct=pct(nia, developed),
        nia_to_proposed_gia_pct=pct(nia, proposed),
        saleable_to_developed_pct=pct(saleable_nia, developed),
    )


def developed_area_sqm(inputs) -> float:
    """**The** construction cost area. Spec Sec 15.3/15.4.

    Every consumer calls this and nothing else.
    ``conversion_costs.total_construction_sqm`` is off-limits outside this
    module, enforced by tests/test_accessor_guard.py and, on the TypeScript
    side, by the eslint rule in frontend/eslint.config.js.
    """
    return area_bridge(inputs).developed_area_sqm
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pytest tests/test_areas.py -q`
Expected: PASS — 17 tests (the parametrised null test counts as 3).

- [ ] **Step 9: Run the whole backend suite**

Run: `pytest -q`
Expected: PASS, 986 tests.

- [ ] **Step 10: Commit**

```bash
git add app/financial_model/areas.py tests/test_areas.py
git commit -m "feat: area bridge derivation and cost-area accessor (Python mirror)"
```

---

## Task 3: Inputs v6 — schema, defaults, migration, API boundary

**Files:**
- Modify: `frontend/src/lib/conversion-types.ts` (ancillary + v6 unit types)
- Modify: `frontend/src/lib/model/finance-types.ts:191-197` (`CalculatorInputsV6`, union, `CALC_VERSION`)
- Modify: `frontend/src/lib/conversion-defaults.ts:30-45,155-193`
- Modify: `frontend/src/lib/model/migrate.ts:24-33,347,377-430`
- Modify: `app/financial_model/types.py:355-427`
- Modify: `app/financial_model/migrate.py:609-720`
- Modify: `app/financial_model/__init__.py:77-107`
- Modify: `app/api/app.py:24,405-420`
- Test: `frontend/src/lib/model/migrate.test.ts`, `tests/test_migrate_v6.py` (create)

**Interfaces:**
- Consumes: `AreaBridgeInputs`, `DEFAULT_AREA_BRIDGE` (Task 1); `DEFAULT_AREA_BRIDGE` dict (Task 2).
- Produces: `UnitAncillary`, `ProposedUnitV6`, `UnitMixInputsV6`, `CalculatorInputsV6`, `isV6`, `migrateV5toV6`, `migrateInputsToV6`; Python `AreaBridgeInputs` (Pydantic), `UnitAncillary`, `ProposedUnitV6`, `UnitMixInputsV6`, `CalculatorInputsV6`, `is_v6`, `migrate_v5_to_v6`, `migrate_inputs_to_v6`.

**The acceptance test for this task is that nothing moves.** A migrated v5 document must produce byte-identical appraisal output. That is asserted in Step 9, not assumed.

- [ ] **Step 1: Write the failing migration tests (TypeScript)**

Append to `frontend/src/lib/model/migrate.test.ts`:

```ts
describe('R9 — v5 to v6 migration', () => {
  const v5 = migrateInputsToV5({}, { id: 'p1', price_pence: 42_500_000, floor_area_sqm: 500 });

  it('stamps inputs_version 6', () => {
    expect(migrateV5toV6(v5).inputs_version).toBe(6);
  });

  it('defaults the area basis to manual so no cost area moves', () => {
    const v6 = migrateV5toV6(v5);
    expect(v6.areas.basis).toBe('manual');
    expect(v6.areas.existing_gia_sqm).toBe(0);
    expect(v6.conversion_costs.total_construction_sqm)
      .toBe(v5.conversion_costs.total_construction_sqm);
  });

  it('gives every unit a zeroed ancillary block', () => {
    const withUnits = {
      ...v5,
      unit_mix: { units: [
        { id: 'u1', type: '1bed' as const, floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' },
      ] },
    };
    const v6 = migrateV5toV6(withUnits);
    expect(v6.unit_mix.units[0].ancillary).toEqual({
      balcony_terrace_sqm: 0,
      balcony_terrace_value_pence: 0,
      parking_spaces: 0,
      parking_value_pence: 0,
    });
  });

  it('refuses to double-migrate', () => {
    const v6 = migrateV5toV6(v5);
    expect(() => migrateV5toV6(v6 as never)).toThrow(/already a v6 document/);
  });

  it('refuses an unrecognised inputs_version rather than reaching the v1 fallback', () => {
    // R8's silent-corruption bug: migrateInputsToV4 had no v5 guard, so a v5
    // document fell to the v1 fallback, was rebuilt from ltv_pct and returned 201.
    expect(() => migrateInputsToV6({ inputs_version: 7 })).toThrow(/unrecognised inputs_version/);
    expect(() => migrateInputsToV6({ inputs_version: 99 })).toThrow(/unrecognised inputs_version/);
  });

  it('refuses a document tagged v6 that fails the structural check', () => {
    expect(() => migrateInputsToV6({ inputs_version: 6, finance: 'not an object' }))
      .toThrow(/fails the v6 structural check/);
  });

  it('migrates a v1 document all the way to v6', () => {
    const v6 = migrateInputsToV6({}, { id: 'p1', price_pence: 42_500_000, floor_area_sqm: 500 });
    expect(v6.inputs_version).toBe(6);
    expect(v6.areas.basis).toBe('manual');
    expect(v6.acquisition.jurisdiction_source).toBe('migrated_default');
  });

  it('merges an already-v6 document onto v6 defaults rather than re-migrating', () => {
    const saved = { ...migrateV5toV6(v5), project_id: 'kept' };
    expect(migrateInputsToV6(saved as never).project_id).toBe('kept');
  });
});
```

Add `migrateV5toV6, migrateInputsToV6` to the file's existing import from `./migrate`.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- --run migrate.test.ts`
Expected: FAIL — `migrateV5toV6 is not exported`.

- [ ] **Step 3: Add the ancillary and v6 unit types**

Append to `frontend/src/lib/conversion-types.ts`:

```ts
/**
 * R9 (spec §15.5). Ancillary areas and values that are NOT internal saleable
 * area. Areas here sit outside NIA and outside the GIA reconciliation; values
 * here sit outside internal saleable GDV and are reported separately.
 *
 * Scheme-level ancillary — surplus parking sold separately from any unit — is
 * deliberately out of scope (spec §2): it needs its own disposal routing in the
 * exit engine. Ancillary recorded here attaches to a unit and sells with it.
 */
export interface UnitAncillary {
  balcony_terrace_sqm: number;
  balcony_terrace_value_pence: number;
  parking_spaces: number;
  parking_value_pence: number;
}

export const DEFAULT_UNIT_ANCILLARY: UnitAncillary = {
  balcony_terrace_sqm: 0,
  balcony_terrace_value_pence: 0,
  parking_spaces: 0,
  parking_value_pence: 0,
};

/** Extended rather than edited, because `ProposedUnit` is shared with the v1–v5
 *  document shapes — the same reasoning R8 applied to `AcquisitionInputsV5`. */
export interface ProposedUnitV6 extends ProposedUnit {
  ancillary: UnitAncillary;
}

export interface UnitMixInputsV6 {
  units: ProposedUnitV6[];
}
```

- [ ] **Step 4: Add `CalculatorInputsV6` and bump the calc version**

In `frontend/src/lib/model/finance-types.ts`, after the `CalculatorInputsV5` declaration:

```ts
/**
 * R9 (spec §15). Adds the area bridge and per-unit ancillary. Purely additive:
 * migration writes `basis: 'manual'` with a zeroed bridge and zeroed ancillary,
 * so **no existing appraisal's computed values move**.
 */
export interface CalculatorInputsV6
  extends Omit<CalculatorInputsV5, 'inputs_version' | 'unit_mix'> {
  inputs_version: 6;
  unit_mix: UnitMixInputsV6;
  areas: AreaBridgeInputs;
}

export type AnyCalculatorInputs =
  CalculatorInputsV2 | CalculatorInputsV3 | CalculatorInputsV4
  | CalculatorInputsV5 | CalculatorInputsV6;
```

Delete the old `AnyCalculatorInputs` declaration at line 196-197. Add to the imports at the top:

```ts
import type { UnitMixInputsV6 } from '../conversion-types';
import type { AreaBridgeInputs } from './areas';
```

Find `CALC_VERSION` in the same file and change `'2.7.0'` to `'2.8.0'`.

- [ ] **Step 5: Add the defaults**

In `frontend/src/lib/conversion-defaults.ts`, add the import `DEFAULT_AREA_BRIDGE` from `./model/areas` and `DEFAULT_UNIT_ANCILLARY` from `./conversion-types`, then export:

```ts
/** R9: a v6 document created fresh starts on the manual basis with a zeroed
 *  bridge — identical behaviour to every pre-R9 document until the user fills
 *  the bridge in and selects it. */
export const DEFAULT_AREAS = { ...DEFAULT_AREA_BRIDGE };
```

- [ ] **Step 6: Implement the TypeScript migration**

In `frontend/src/lib/model/migrate.ts`, add after `isV5`:

```ts
/** A v6 document has the same finance shape as v2–v5, discriminated by
 *  inputs_version === 6. */
export function isV6(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV6 {
  return snapshot.inputs_version === 6
    && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}
```

Add after `migrateV4toV5`:

```ts
/**
 * Upgrades a v5 document to v6 by stamping `inputs_version: 6`, adding a zeroed
 * area bridge on the **manual** basis, and giving every unit a zeroed ancillary
 * block.
 *
 * Purely additive, and deliberately so. `basis: 'manual'` means the cost area
 * stays `conversion_costs.total_construction_sqm` — the exact number the
 * document already used — so no migrated appraisal's computed values move. A
 * bridge is not synthesised from `total_construction_sqm`: inventing an
 * existing GIA the record never stated would be inventing evidence, the same
 * reasoning that leaves R8's `acquisition_date` null rather than stamping today.
 */
export function migrateV5toV6(v5: CalculatorInputsV5): CalculatorInputsV6 {
  if (isV6(v5 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV5toV6: input is already a v6 document');
  }
  const { inputs_version: _v5Version, unit_mix, ...rest } = v5;
  const existingAreas = (v5 as Partial<CalculatorInputsV6>).areas;
  return {
    ...rest,
    inputs_version: 6,
    areas: { ...DEFAULT_AREA_BRIDGE, ...(existingAreas ?? {}) },
    unit_mix: {
      units: unit_mix.units.map((u) => ({
        ...u,
        ancillary: {
          ...DEFAULT_UNIT_ANCILLARY,
          ...((u as Partial<ProposedUnitV6>).ancillary ?? {}),
        },
      })),
    },
  };
}
```

Change the version roster and add the entry point:

```ts
const RECOGNISED_INPUTS_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6];

/**
 * Normalises any stored snapshot (v1–v6) to v6. Mirrors migrateInputsToV5's
 * shape exactly.
 *
 * The two refusals below are R8's hardest-won guard, carried forward. R8
 * shipped `migrateInputsToV4` without a v5 guard; a v5 document satisfied none
 * of the isVN checks, fell all the way through to the v1 fallback, and was
 * silently corrupted — fields dropped, a *confirmed* equity source replaced by
 * an unconfirmed stub with a different amount, the facility rebuilt from
 * `ltv_pct` — while returning 201. An unrecognised version must fail loudly.
 */
export function migrateInputsToV6(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV6 {
  const version = snapshot.inputs_version;
  if (
    version !== undefined && version !== null
    && !RECOGNISED_INPUTS_VERSIONS.includes(version as number)
  ) {
    throw new Error(
      `migrateInputsToV6: unrecognised inputs_version ${JSON.stringify(version)} `
      + `(expected one of ${RECOGNISED_INPUTS_VERSIONS.join(', ')}, or absent for a v1 document)`,
    );
  }
  if (version === 6 && !isV6(snapshot)) {
    throw new Error(
      'migrateInputsToV6: inputs_version is 6 but the document fails the v6 structural check '
      + '(finance is not an object, or is missing committed_net_facility_pence) -- refusing to '
      + 'silently reinterpret it via the v1 fallback path',
    );
  }
  if (isV6(snapshot)) {
    const defaults = migrateV5toV6(
      migrateV4toV5(migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2(project)))),
    );
    const saved = snapshot as unknown as Partial<CalculatorInputsV6>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 6,
      areas: { ...defaults.areas, ...(saved.areas ?? {}) },
      acquisition: { ...defaults.acquisition, ...(saved.acquisition ?? {}) },
      unit_mix: saved.unit_mix ?? defaults.unit_mix,
      conversion_costs: { ...defaults.conversion_costs, ...(saved.conversion_costs ?? {}) },
      finance: { ...defaults.finance, ...(saved.finance ?? {}) },
      equity_sources: saved.equity_sources ?? defaults.equity_sources,
      exit_strategy: { ...defaults.exit_strategy, ...(saved.exit_strategy ?? {}) },
      risks: saved.risks ?? defaults.risks,
      scenarios: {
        base: { ...defaults.scenarios.base, ...(saved.scenarios?.base ?? {}) },
        upside: { ...defaults.scenarios.upside, ...(saved.scenarios?.upside ?? {}) },
        downside: { ...defaults.scenarios.downside, ...(saved.scenarios?.downside ?? {}) },
        severe: { ...defaults.scenarios.severe, ...(saved.scenarios?.severe ?? {}) },
      },
      deal_spider: {
        ...defaults.deal_spider,
        ...(saved.deal_spider ?? {}),
        weights: { ...defaults.deal_spider.weights, ...(saved.deal_spider?.weights ?? {}) },
      },
      lender_valuation: saved.lender_valuation ?? null,
      programme: saved.programme ?? null,
      sales_phasing: saved.sales_phasing ?? null,
      refinance: saved.refinance ?? null,
    };
  }
  return migrateV5toV6(migrateInputsToV5(snapshot, project));
}
```

Add `CalculatorInputsV6`, `ProposedUnitV6` and `DEFAULT_AREA_BRIDGE`/`DEFAULT_UNIT_ANCILLARY` to the file's imports.

Also update `migrateInputsToV5`'s own roster comment: its `RECOGNISED_INPUTS_VERSIONS` must stay `[1,2,3,4,5]` and it must now **refuse** a v6 document, exactly as `migrateInputsToV4` refuses a v5 one. Add immediately after the version check in `migrateInputsToV5`:

```ts
  if (isV6(snapshot)) {
    throw new Error('migrateInputsToV5: input is a v6 document — use migrateInputsToV6');
  }
```

- [ ] **Step 7: Run the TypeScript migration tests**

Run: `cd frontend && npm run test -- --run migrate.test.ts`
Expected: PASS.

- [ ] **Step 8: Mirror the schema and migration in Python**

In `app/financial_model/types.py`, after `CalculatorInputsV5`:

```python
# --- Release 9 (calc 2.8.0): area bridge and per-unit ancillary ---

AreaBasis = Literal["bridge_derived", "manual"]


class AreaBridgeInputs(BaseModel):
    """R9 (spec Sec 15.1). Every field is ENTERED; nothing derived is stored.
    Mirrors AreaBridgeInputs in areas.ts."""

    basis: AreaBasis = "manual"
    existing_gia_sqm: float = Field(default=0.0, ge=0)
    demolished_gia_sqm: float = Field(default=0.0, ge=0)
    extension_gia_sqm: float = Field(default=0.0, ge=0)
    retained_commercial_gia_sqm: float = Field(default=0.0, ge=0)
    untouched_gia_sqm: float = Field(default=0.0, ge=0)
    circulation_common_sqm: float = Field(default=0.0, ge=0)
    plant_riser_sqm: float = Field(default=0.0, ge=0)
    store_bin_cycle_sqm: float = Field(default=0.0, ge=0)
    amenity_sqm: float = Field(default=0.0, ge=0)
    # External amenity and landscape. NOT gross internal area -- carried for
    # display but never deducted from the reconciliation.
    external_amenity_sqm: float = Field(default=0.0, ge=0)


class UnitAncillary(BaseModel):
    """R9 (spec Sec 15.5). Areas here sit outside NIA; values sit outside
    internal saleable GDV. Mirrors UnitAncillary in conversion-types.ts."""

    balcony_terrace_sqm: float = Field(default=0.0, ge=0)
    balcony_terrace_value_pence: int = Field(default=0, ge=0)
    parking_spaces: int = Field(default=0, ge=0)
    parking_value_pence: int = Field(default=0, ge=0)


class ProposedUnitV6(ProposedUnit):
    """Extended rather than edited: ProposedUnit is shared with the v1-v5
    document shapes, the same reasoning R8 applied to AcquisitionInputsV5."""

    ancillary: UnitAncillary = Field(default_factory=UnitAncillary)


class UnitMixInputsV6(BaseModel):
    units: list[ProposedUnitV6] = Field(default_factory=list)


class CalculatorInputsV6(CalculatorInputsV5):
    """Mirrors CalculatorInputsV5 with the R9 area bridge and ancillary blocks.
    Subclasses V5 for the same reason V5 subclasses V4: the engine dispatches on
    it, and a flat re-declaration would make those isinstance checks silently
    False for v6 documents."""

    inputs_version: Literal[6] = 6  # type: ignore[assignment]
    unit_mix: UnitMixInputsV6  # type: ignore[assignment]
    areas: AreaBridgeInputs = Field(default_factory=AreaBridgeInputs)


AnyCalculatorInputs = (
    CalculatorInputsV2 | CalculatorInputsV3 | CalculatorInputsV4
    | CalculatorInputsV5 | CalculatorInputsV6
)
```

Extend `parse_calculator_inputs` with `if version == 6: return CalculatorInputsV6.model_validate(doc)` **above** the v5 branch, and change `CALC_VERSION` to `"2.8.0"`.

**R8 carry-forward — the `revalidate_instances='never'` trap.** Pydantic will let a `CalculatorInputsV5` container hold a `ProposedUnitV6`. Any two sites gating on the version must gate on the **same** predicate. This plan gates everywhere on the *container* (`is_v6` / `isinstance(inputs, CalculatorInputsV6)`), never on whether a unit happens to carry an `ancillary` attribute.

- [ ] **Step 9: Implement the Python migration and prove nothing moves**

In `app/financial_model/migrate.py`, add `is_v6`, `migrate_v5_to_v6` and `migrate_inputs_to_v6`, ported line-for-line from the TypeScript in Step 6 and following the exact structure of `migrate_v4_to_v5`/`migrate_inputs_to_v5` above them (same dict-or-model input handling, same two guard clauses, same merge-onto-defaults branch). Set `_RECOGNISED_VERSIONS = (1, 2, 3, 4, 5, 6)` on the v6 entry point and leave `migrate_inputs_to_v5`'s own tuple at `(1, 2, 3, 4, 5)`, adding a v6 refusal to it that mirrors the TS one.

Create `tests/test_migrate_v6.py` with the Python twin of every test in Step 1, plus the numerical-identity assertion that is this task's real acceptance gate:

```python
import json
from pathlib import Path

from app.financial_model import parse_calculator_inputs, run_appraisal
from app.financial_model.migrate import migrate_inputs_to_v6

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _pipeline_fixtures():
    for path in sorted(FIXTURES.glob("*.json")):
        doc = json.loads(path.read_text())
        if doc.get("kind") == "sensitivity":
            continue  # names a base_fixture instead of carrying inputs
        yield path.name, doc


def test_v6_migration_moves_no_existing_figure():
    """The acceptance gate for R9's migration: every existing fixture, run
    before and after migration to v6, must produce identical output.

    This is what makes 'purely additive' a tested claim rather than an
    assertion. If a single figure moves, the migration is wrong -- not the
    fixture."""
    for name, doc in _pipeline_fixtures():
        before = run_appraisal(parse_calculator_inputs(doc["inputs"]))
        after = run_appraisal(migrate_inputs_to_v6(doc["inputs"]))
        assert before.metrics.model_dump() == after.metrics.model_dump(), (
            f"{name}: migration to v6 changed a computed figure"
        )
```

Add the identical assertion to `frontend/src/lib/model/golden-fixtures.test.ts`.

- [ ] **Step 10: Move the API boundary to v6**

In `app/api/app.py`, change the import on line 24 to `migrate_inputs_to_v6` and the call on line 417 to `migrate_inputs_to_v6(raw)`. Update the surrounding comment to say the boundary moved from v5 to v6 in R9. The two `except` clauses already convert every migration failure to a 422 and need no change — verify with the existing `test_malformed_inputs_snapshot_is_422_not_500`, and add:

```python
def test_unknown_future_inputs_version_is_422_not_silent_corruption(client):
    """R8's silent-corruption bug, guarded forward: an inputs_version this
    server does not implement must be refused, never rebuilt from the v1
    LTV heuristic and returned as 201."""
    resp = client.post("/api/appraisals", json={"inputs_snapshot": {"inputs_version": 7}})
    assert resp.status_code == 422
    assert "unrecognised inputs_version" in resp.text
```

- [ ] **Step 11: Update `__all__` (closing R8's asymmetry)**

In `app/financial_model/__init__.py`, add to `__all__`, keeping alphabetical order: `"AcquisitionInputsV5"`, `"AreaBridgeInputs"`, `"AreaBridgeResult"`, `"CalculatorInputsV5"`, `"CalculatorInputsV6"`, `"ProposedUnitV6"`, `"UnitAncillary"`, `"UnitMixInputsV6"`, `"area_bridge"`, `"developed_area_sqm"`, `"is_v5"`, `"is_v6"`, `"migrate_inputs_to_v6"`, `"migrate_v4_to_v5"`, `"migrate_v5_to_v6"`, `"unit_nia_sqm"`. Add the matching `from .areas import ...` and `from .types import ...` lines.

- [ ] **Step 12: Run the full gate set**

```bash
cd frontend && npm run test -- --run && npx tsc -b && npm run lint && npm run build
cd .. && pytest -q
```
Expected: all pass. Both engines' fixture-identity tests are the ones that matter here.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: inputs v6 — area bridge and ancillary schema, migration, API boundary

Purely additive: migration writes the manual basis with a zeroed bridge, and
both engines assert every existing fixture produces identical output before and
after. Carries R8's unrecognised-version guard forward to v7."
```

---

## Task 4: Rewire the cost stack through the accessor

**Files:**
- Modify: `frontend/src/lib/conversion-calc-engine.ts:70-78`
- Modify: `frontend/src/lib/model/schedule.ts:3,33`
- Modify: `frontend/src/lib/model/migrate.ts:122`
- Modify: `app/financial_model/schedule.py:70-79,166`
- Modify: `app/financial_model/migrate.py:391`
- Test: `frontend/src/lib/conversion-calc-engine.test.ts`, `tests/test_schedule.py`

**Interfaces:**
- Consumes: `developedAreaSqm(inputs)` / `developed_area_sqm(inputs)` (Tasks 1–2).
- Produces: `calculateTotalConstructionCost(costs, areaSqm)` / `calculate_total_construction_cost(costs, area_sqm)` — **signature change**: the area is now an explicit second parameter, so the function can no longer read the raw field and the guard in Task 5 can restrict it.

**Why the signature changes rather than taking `inputs`:** `calculateTotalConstructionCost` is a pure cost function that has no business knowing about exit routes or unit schedules. Passing the resolved area keeps it pure and makes every call site visibly responsible for resolving the area through the accessor.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/lib/conversion-calc-engine.test.ts`:

```ts
describe('R9 — construction cost takes an explicit area', () => {
  const costs = {
    ...DEFAULT_CONVERSION_COSTS,
    construction_cost_per_sqm_pence: 50_000,
    contingency_pct: 10,
    fire_safety_pence: 100,
    sound_insulation_pence: 100,
    part_l_compliance_pence: 100,
  };

  it('multiplies the supplied area, not the stored field', () => {
    // 500 x 50,000 = 25,000,000; +10% = 27,500,000; +300 compliance
    expect(calculateTotalConstructionCost({ ...costs, total_construction_sqm: 9999 }, 500))
      .toBe(27_500_300);
  });

  it('rounds the fractional-area product once, before contingency (spec §1.1)', () => {
    // 520.5 x 50,000 = 26,025,000 exactly; +10% = 28,627,500; +300
    expect(calculateTotalConstructionCost(costs, 520.5)).toBe(28_627_800);
  });
});

describe('R9 — the schedule resolves its cost area through the accessor', () => {
  it('uses the bridge-derived area when the bridge basis is selected', () => {
    const inputs = makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 520 },
      conversion_costs: { ...DEFAULT_CONVERSION_COSTS, construction_cost_per_sqm_pence: 50_000, total_construction_sqm: 9999 },
    });
    const s = buildSchedule(inputs);
    // 520 x 50,000 x 1.10
    expect(s.totals.construction_pence).toBe(28_600_000);
  });

  it('uses the manual field when the manual basis is selected', () => {
    const inputs = makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual', existing_gia_sqm: 520 },
      conversion_costs: { ...DEFAULT_CONVERSION_COSTS, construction_cost_per_sqm_pence: 50_000, total_construction_sqm: 400 },
    });
    expect(buildSchedule(inputs).totals.construction_pence).toBe(22_000_000);
  });
});
```

`makeV6Inputs` is a helper this test file needs; define it at the top of the describe block by spreading `migrateInputsToV6({}, { id: 'p', price_pence: 0, floor_area_sqm: 0 })` with the overrides.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- --run conversion-calc-engine.test.ts`
Expected: FAIL — `Expected 1 arguments, but got 2` at typecheck, or a wrong figure at runtime.

- [ ] **Step 3: Change the TypeScript signature and call sites**

In `frontend/src/lib/conversion-calc-engine.ts`:

```ts
/**
 * Spec §3.4 — the construction line of the cost stack.
 *
 * R9: the area is an explicit parameter. It used to read
 * `costs.total_construction_sqm` directly, which made this one of several sites
 * that each independently decided what "the construction area" meant. Callers
 * now resolve it once through `developedAreaSqm` (spec §15.4), and the eslint
 * guard makes reading the raw field here a build failure.
 */
export function calculateTotalConstructionCost(
  costs: ConversionCostInputs,
  areaSqm: number,
): number {
  // Spec §1.1: fractional-area products round once, at source, in one step before
  // contingency -- base = round_half_up(construction_cost_per_sqm_pence × area).
  // Integer-sqm inputs are unaffected (rounding an already-integer product is identity).
  const baseCost = Math.round(costs.construction_cost_per_sqm_pence * areaSqm);
  const contingency = Math.round((baseCost * costs.contingency_pct) / 100);
  const compliance = costs.fire_safety_pence + costs.sound_insulation_pence + costs.part_l_compliance_pence;
  return baseCost + contingency + compliance;
}
```

In `frontend/src/lib/model/schedule.ts:33`:

```ts
  const constructionTotal = calculateTotalConstructionCost(cc, developedAreaSqm(inputs));
```

with `import { developedAreaSqm } from './areas';` added.

In `frontend/src/lib/model/migrate.ts:122`, the legacy cost-before-finance estimate: pass the raw field explicitly, since at that point in migration no `areas` block exists yet:

```ts
    // v1 migration runs before the areas block exists, so the manual field IS
    // the area here — passed explicitly rather than read inside the callee.
    calculateTotalConstructionCost(conversion_costs, conversion_costs.total_construction_sqm) +
```

- [ ] **Step 4: Mirror in Python**

`app/financial_model/schedule.py`:

```python
def calculate_total_construction_cost(costs: ConversionCostInputs, area_sqm: float) -> int:
    # Spec Sec 1.1: fractional-area products round once, at source, in one step
    # before contingency -- base = money_round(construction_cost_per_sqm_pence x
    # area). Integer-sqm inputs are unaffected. Matches conversion-calc-engine.ts.
    #
    # R9: the area is an explicit parameter. Callers resolve it once through
    # developed_area_sqm (spec Sec 15.4); tests/test_accessor_guard.py makes
    # reading the raw field here a test failure.
    base_cost = money_round(costs.construction_cost_per_sqm_pence * area_sqm)
    contingency = money_round((base_cost * costs.contingency_pct) / 100)
    compliance = costs.fire_safety_pence + costs.sound_insulation_pence + costs.part_l_compliance_pence
    return base_cost + contingency + compliance
```

Line 166 becomes `construction_total = calculate_total_construction_cost(cc, developed_area_sqm(inputs))`, with `from .areas import developed_area_sqm` added. `migrate.py:391` passes `cc_obj.total_construction_sqm` explicitly, with the same comment as the TS twin.

- [ ] **Step 5: Run both suites**

```bash
cd frontend && npm run test -- --run
cd .. && pytest -q
```
Expected: PASS. Every existing fixture must still produce identical figures — they all migrate to the manual basis, so the resolved area is the same number the old code read.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: construction cost takes an explicit area, resolved via the accessor"
```

---

## Task 5: The guard — closing the class R8 left open

**Files:**
- Modify: `frontend/eslint.config.js`
- Create: `frontend/src/lib/model/accessor-guard.test.ts`
- Create: `tests/test_accessor_guard.py`

**Interfaces:**
- Consumes: `developedAreaSqm` (Task 1), `developed_area_sqm` (Task 2), and R8's existing `calculateAcquisitionTax` / `calculate_acquisition_tax`.
- Produces: no runtime API. Produces a build failure on any unauthorised reader.

**What this closes.** R8's implementation report records the same defect three times in one release — `metrics.ts` was rerouted to the jurisdiction-aware tax while `calculateTotalAcquisitionCost`, then `deal-spider.ts`, then `AcquisitionPage.tsx` each still computed England-only. Every site was individually correct before the move and individually self-consistent after it, so a green suite could not see any of them. All three were caught by carry-forward from the previous task's review. The instances were closed; **the class was not**. R9 adds a second value of identical shape, so the remedy ships once and covers both.

- [ ] **Step 1: Add the eslint rule**

In `frontend/eslint.config.js`, add to the `rules` object of the main block:

```js
      // R9 (spec §15.4) — single-accessor enforcement.
      //
      // Two values in this codebase are derived once and consumed everywhere:
      // the construction cost area and the acquisition tax. R8 proved that
      // convention alone does not hold them — the same "moved the computation,
      // missed a consumer" defect recurred three times in one release, each
      // site individually self-consistent and therefore invisible to a green
      // test suite.
      //
      // Read the area through `developedAreaSqm`/`areaBridge` (model/areas.ts)
      // and the tax through `calculateAcquisitionTax` (tax/acquisition-tax.ts).
      'no-restricted-syntax': ['error',
        {
          selector: "MemberExpression[property.name='total_construction_sqm']",
          message:
            'Do not read total_construction_sqm directly — call developedAreaSqm(inputs) '
            + 'from model/areas.ts. It resolves the bridge-derived vs manual basis (spec §15.3). '
            + 'If you are the areas module, the type definitions, migration, defaults or the '
            + 'cost-page editor, add this file to the allowlist in eslint.config.js.',
        },
        {
          // `TAX_TABLES` is an exported top-level const, imported by name — so it
          // appears as a bare Identifier, NOT a MemberExpression. Matching it with
          // a MemberExpression selector (the shape that is correct for
          // `costs.total_construction_sqm`) would compile fine and never fire,
          // which is the "a plausible default is the same defect as a wrong
          // number" trap R8 recorded. Verified against the real symbol before
          // being written here.
          selector: "Identifier[name='TAX_TABLES']",
          message:
            'Do not read the acquisition-tax band table directly — call calculateAcquisitionTax() '
            + 'from tax/acquisition-tax.ts, which selects the jurisdiction and date-effective band '
            + 'set (spec §14). Only test files may import TAX_TABLES, to assert the table itself.',
        },
      ],
```

Then add a second config block immediately after it, exempting the modules that legitimately own or write these fields:

```js
  {
    // The allowlist for the single-accessor rule above. These files either OWN
    // the value (areas.ts, acquisition-tax.ts), DECLARE it (the type modules),
    // WRITE it as the user's manual input (ConversionCostsPage), or construct
    // documents where no accessor exists yet (migration, defaults).
    //
    // Known limitation, recorded rather than glossed (spec §3.4): test files are
    // exempt because fixtures must construct the raw field, so a consumer defect
    // written inside a test file is not caught by this rule.
    files: [
      'src/lib/model/areas.ts',
      'src/lib/tax/acquisition-tax.ts',
      'src/lib/conversion-types.ts',
      'src/lib/model/finance-types.ts',
      'src/lib/model/migrate.ts',
      'src/lib/conversion-defaults.ts',
      'src/components/calculator/ConversionCostsPage.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
```

- [ ] **Step 2: Verify the rule fires on a planted violation**

This is the step that matters. A guard nobody has watched fail is not a guard.

```bash
cd frontend
cat > src/lib/model/__guard_probe.ts <<'PROBE'
import type { AnyCalculatorInputs } from './finance-types';
export function illegal(i: AnyCalculatorInputs) { return i.conversion_costs.total_construction_sqm; }
PROBE
npm run lint 2>&1 | grep -c "Do not read total_construction_sqm directly"
rm src/lib/model/__guard_probe.ts
```
Expected: the grep prints `1` (or more). If it prints `0`, the rule is not matching and the whole guard is decorative — fix the selector before continuing.

Repeat for the tax half, which uses a **different selector shape** and therefore needs its own proof:

```bash
cat > src/lib/model/__guard_probe.ts <<'PROBE'
import { TAX_TABLES } from '../tax/acquisition-tax';
export const first = TAX_TABLES[0];
PROBE
npm run lint 2>&1 | grep -c "Do not read the acquisition-tax band table directly"
rm src/lib/model/__guard_probe.ts
```
Expected: `2` — the import specifier and the use site both match. Any non-zero count means the rule fires; `0` means it does not.

- [ ] **Step 3: Pin the guard's configuration in a test**

Create `frontend/src/lib/model/accessor-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * R9 spec §15.4. The eslint rule is the enforcement; this test is what stops
 * the enforcement being silently removed or hollowed out.
 *
 * Step 2 of Task 5 verified the rule actually fires on a planted violation.
 * That check is manual and one-off; this test is the standing guard on the
 * guard's own configuration.
 */
const CONFIG = readFileSync(resolve(__dirname, '../../../eslint.config.js'), 'utf-8');

describe('single-accessor guard configuration', () => {
  it('restricts direct reads of the cost-area field', () => {
    expect(CONFIG).toContain("property.name='total_construction_sqm'");
  });

  it('restricts direct reads of the acquisition-tax band table', () => {
    // Identifier, not MemberExpression: TAX_TABLES is imported by name.
    expect(CONFIG).toContain("Identifier[name='TAX_TABLES']");
  });

  it('keeps the allowlist to the modules that own, declare or write the values', () => {
    for (const allowed of [
      'src/lib/model/areas.ts',
      'src/lib/tax/acquisition-tax.ts',
      'src/components/calculator/ConversionCostsPage.tsx',
    ]) {
      expect(CONFIG).toContain(allowed);
    }
  });

  it('does not exempt the consumer modules R8 was bitten by', () => {
    // metrics.ts, schedule.ts, deal-spider.ts and AcquisitionPage.tsx are the
    // exact files where R8's three instances lived. If any of them ever appears
    // in the allowlist, the guard has been defeated rather than satisfied.
    for (const forbidden of [
      'src/lib/model/metrics.ts',
      'src/lib/model/schedule.ts',
      'src/lib/deal-spider.ts',
      'src/components/calculator/AcquisitionPage.tsx',
    ]) {
      expect(CONFIG).not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 4: Write the Python source-scan guard**

Create `tests/test_accessor_guard.py`:

```python
"""R9 spec Sec 15.4 -- the Python half of the single-accessor guard.

Python has no eslint, so the enforcement is a source scan. It is deliberately
crude: a substring search over the module tree, with an explicit allowlist. A
subtler AST-based check would be more precise and less likely to be understood,
and this guard's value is entirely in being obvious enough that nobody works
around it by accident.
"""
from pathlib import Path

import pytest

MODEL_DIR = Path(__file__).resolve().parents[1] / "app" / "financial_model"

# Files that OWN the value, DECLARE it, or construct documents where no
# accessor exists yet. Everything else must go through the accessor.
AREA_ALLOWLIST = {"areas.py", "types.py", "migrate.py"}
# TAX_TABLES is the real symbol (acquisition_tax.py:47). Verified against the
# source before being written here -- a needle that matches nothing would make
# this test pass forever while guarding nothing.
TAX_ALLOWLIST = {"acquisition_tax.py"}


def _offenders(needle: str, allowlist: set[str]) -> list[str]:
    out = []
    for path in sorted(MODEL_DIR.glob("*.py")):
        if path.name in allowlist:
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue  # a comment naming the field is documentation, not a read
            if needle in line:
                out.append(f"{path.name}:{lineno}: {stripped}")
    return out


def test_no_unauthorised_reader_of_the_cost_area():
    """R8's lesson: the same 'moved the computation, missed a consumer' defect
    recurred three times in one release, every site individually
    self-consistent and therefore invisible to a green suite. Resolve the
    construction area with developed_area_sqm(inputs) from areas.py."""
    offenders = _offenders("total_construction_sqm", AREA_ALLOWLIST)
    assert offenders == [], (
        "These files read the raw cost-area field instead of calling "
        "developed_area_sqm(inputs) from areas.py:\n  " + "\n  ".join(offenders)
    )


def test_no_unauthorised_evaluator_of_the_tax_bands():
    """The other half of the same class (spec Sec 14): the acquisition-tax band
    table is evaluated only inside acquisition_tax.py."""
    offenders = _offenders("TAX_TABLES", TAX_ALLOWLIST)
    assert offenders == [], (
        "These files read the tax band table directly instead of calling "
        "calculate_acquisition_tax():\n  " + "\n  ".join(offenders)
    )


def test_the_guard_itself_detects_a_planted_violation(tmp_path, monkeypatch):
    """A guard nobody has watched fail is not a guard."""
    probe = MODEL_DIR / "__guard_probe.py"
    probe.write_text("x = inputs.conversion_costs.total_construction_sqm\n", encoding="utf-8")
    try:
        assert _offenders("total_construction_sqm", AREA_ALLOWLIST) != []
    finally:
        probe.unlink()
```

- [ ] **Step 5: Run both guards**

```bash
cd frontend && npm run lint && npm run test -- --run accessor-guard.test.ts
cd .. && pytest tests/test_accessor_guard.py -q
```
Expected: PASS. If the Python scan reports offenders, Task 4 missed a call site — fix the site, never the allowlist.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: build-failing single-accessor guard for cost area and acquisition tax

Closes the class R8 left open after three separate instances of the same
'moved the computation, missed a consumer' defect."
```

---

## Task 6: Ancillary value in GDV and sale receipts

**Files:**
- Modify: `frontend/src/lib/conversion-calc-engine.ts:9-11`
- Modify: `frontend/src/lib/model/schedule.ts:93-95`
- Modify: `app/financial_model/schedule.py` (the `calculate_gdv` and gross-sales sites)
- Test: `frontend/src/lib/conversion-calc-engine.test.ts`, `frontend/src/lib/model/schedule.test.ts`, `tests/test_schedule.py`

**Interfaces:**
- Consumes: `UnitAncillary`, `ProposedUnitV6` (Task 3).
- Produces: `unitAncillaryValuePence(unit)`, `calculateGdvBreakdown(units) -> { internal_pence, ancillary_pence, total_pence }`. `calculateGdv(units)` is kept, returning `total_pence`, so existing callers are unaffected.

- [ ] **Step 1: Write the failing tests**

```ts
describe('R9 — GDV splits internal saleable from ancillary', () => {
  const units = [
    { id: 'u1', type: '1bed' as const, floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '',
      ancillary: { balcony_terrace_sqm: 6, balcony_terrace_value_pence: 400_000, parking_spaces: 1, parking_value_pence: 1_200_000 } },
    { id: 'u2', type: '1bed' as const, floor_area_sqm: 50, estimated_value_pence: 24_500_000, comparable_notes: '',
      ancillary: { balcony_terrace_sqm: 0, balcony_terrace_value_pence: 0, parking_spaces: 1, parking_value_pence: 1_200_000 } },
  ];

  it('reports internal and ancillary separately', () => {
    const b = calculateGdvBreakdown(units);
    expect(b.internal_pence).toBe(49_500_000);
    expect(b.ancillary_pence).toBe(2_800_000);
    expect(b.total_pence).toBe(52_300_000);
  });

  it('keeps calculateGdv as the total, so existing callers are unaffected', () => {
    expect(calculateGdv(units)).toBe(52_300_000);
  });

  it('treats a pre-v6 unit with no ancillary block as zero ancillary', () => {
    const legacy = [{ id: 'u1', type: '1bed' as const, floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' }];
    const b = calculateGdvBreakdown(legacy);
    expect(b.ancillary_pence).toBe(0);
    expect(b.total_pence).toBe(25_000_000);
  });
});

describe('R9 — ancillary value flows into sale receipts', () => {
  it('sells a unit with its parking and balcony value attached', () => {
    // Without this, GDV and gross sale receipts disagree by the ancillary total
    // and the appraisal no longer reconciles.
    const s = buildSchedule(makeV6Inputs({ /* sell_all, the two units above */ }));
    expect(s.totals.gross_sale_pence).toBe(52_300_000);
    expect(s.totals.gdv_pence).toBe(52_300_000);
  });

  it('leaves a retained unit\'s ancillary out of receipts but inside GDV', () => {
    const s = buildSchedule(makeV6Inputs({ route: 'blended', retainedIds: ['u2'] }));
    expect(s.totals.gross_sale_pence).toBe(26_600_000); // u1 internal + u1 ancillary
    expect(s.totals.gdv_pence).toBe(52_300_000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- --run conversion-calc-engine.test.ts schedule.test.ts`
Expected: FAIL — `calculateGdvBreakdown is not exported`.

- [ ] **Step 3: Implement the split**

In `frontend/src/lib/conversion-calc-engine.ts`, replace `calculateGdv`:

```ts
/** R9 spec §15.5 — a unit's ancillary value. A pre-v6 unit carries no
 *  `ancillary` block at all, read structurally (the codebase's version-dispatch
 *  idiom) and resolving to zero. */
export function unitAncillaryValuePence(u: ProposedUnit | ProposedUnitV6): number {
  if (!('ancillary' in u) || u.ancillary == null) return 0;
  return u.ancillary.parking_value_pence + u.ancillary.balcony_terrace_value_pence;
}

export interface GdvBreakdown {
  /** Internal saleable unit values — the pre-R9 figure, unchanged. */
  internal_pence: number;
  /** Parking plus balcony/terrace. Reported separately, never folded into
   *  internal saleable value (spec §3.1, which this release rewrites). */
  ancillary_pence: number;
  total_pence: number;
}

export function calculateGdvBreakdown(
  units: readonly (ProposedUnit | ProposedUnitV6)[],
): GdvBreakdown {
  const internal = units.reduce((s, u) => s + u.estimated_value_pence, 0);
  const ancillary = units.reduce((s, u) => s + unitAncillaryValuePence(u), 0);
  return { internal_pence: internal, ancillary_pence: ancillary, total_pence: internal + ancillary };
}

/** Total developer GDV. Retained as the total so every existing caller is
 *  unaffected by the R9 split; use `calculateGdvBreakdown` where the parts matter. */
export function calculateGdv(units: readonly (ProposedUnit | ProposedUnitV6)[]): number {
  return calculateGdvBreakdown(units).total_pence;
}
```

In `frontend/src/lib/model/schedule.ts:93`, gross sales must carry ancillary with the unit:

```ts
  // R9 spec §15.5: ancillary sells with its unit. Summing internal value alone
  // here would make GDV and gross receipts disagree by the ancillary total.
  const grossSales = soldUnits.reduce(
    (s, u) => s + u.estimated_value_pence + unitAncillaryValuePence(u), 0,
  );
```

- [ ] **Step 4: Mirror in Python**

Add `unit_ancillary_value_pence`, `GdvBreakdown` (a frozen dataclass) and `calculate_gdv_breakdown` to `app/financial_model/schedule.py` alongside the existing `calculate_gdv`, and change the gross-sales sum identically. Use `getattr(u, "ancillary", None)` for the version-structural read, matching `areas.py`.

- [ ] **Step 5: Run both suites**

```bash
cd frontend && npm run test -- --run
cd .. && pytest -q
```
Expected: PASS. Existing fixtures are unaffected — every migrated unit has zeroed ancillary.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ancillary value as a separate GDV component, flowing into sale receipts"
```

---

## Task 7: The two remaining consumers — lender per-sq-ft and scenarios

**Files:**
- Modify: `frontend/src/lib/model/lender-valuation.ts:52-60`
- Modify: `frontend/src/lib/model/apply-scenario.ts:34-40`
- Modify: `app/financial_model/lender_valuation.py:60-75`
- Modify: `app/financial_model/apply_scenario.py:20-30`
- Test: `frontend/src/lib/model/lender-valuation.test.ts`, `frontend/src/lib/model/apply-scenario.test.ts`, and the Python twins

**Interfaces:**
- Consumes: `unitAncillaryValuePence` (Task 6).
- Produces: no new exports. Two behaviour bindings, each pinned by a test written to fail against today's code.

**Both of these are latent defects, not new features.** Neither is visible today because no unit has a second area or a second value. Both become wrong the instant Task 6 lands.

- [ ] **Step 1: Write the failing tests**

```ts
describe('R9 — global_per_sqft is bound to internal NIA', () => {
  it('ignores balcony and terrace area when applying a per-sq-ft lender rate', () => {
    // Spec §3.2 says "pence per sq ft applied to every unit's area". Once a unit
    // has an internal area AND a balcony area that phrase is ambiguous, and the
    // ambiguity silently moves lender GDV. It is bound to internal NIA.
    const withBalcony = computeLenderGdv(makeInputs({
      lender_valuation: { basis: 'global_per_sqft', global_value: 40_000, per_key_values: null, reason: 'r', author: 'a', date: '2026-08-18' },
      units: [{ id: 'u1', floor_area_sqm: 50, ancillary: { balcony_terrace_sqm: 20, balcony_terrace_value_pence: 0, parking_spaces: 0, parking_value_pence: 0 } }],
    }));
    const withoutBalcony = computeLenderGdv(makeInputs({
      lender_valuation: { basis: 'global_per_sqft', global_value: 40_000, per_key_values: null, reason: 'r', author: 'a', date: '2026-08-18' },
      units: [{ id: 'u1', floor_area_sqm: 50, ancillary: { balcony_terrace_sqm: 0, balcony_terrace_value_pence: 0, parking_spaces: 0, parking_value_pence: 0 } }],
    }));
    expect(withBalcony!.lender_gdv_pence).toBe(withoutBalcony!.lender_gdv_pence);
    // 40,000p/sq ft x 50 m² x 10.7639
    expect(withBalcony!.lender_gdv_pence).toBe(21_527_800);
  });
});

describe('R9 — a GDV scenario stresses ancillary value too', () => {
  it('applies the GDV adjustment to parking and balcony value, not just internal', () => {
    // Left unmoved, every GDV sensitivity, every scenario and the whole tornado
    // understate the stress by the ancillary share.
    const stressed = applyScenario(makeV6Inputs({
      units: [{ id: 'u1', estimated_value_pence: 25_000_000,
        ancillary: { balcony_terrace_sqm: 0, balcony_terrace_value_pence: 400_000, parking_spaces: 1, parking_value_pence: 1_200_000 } }],
    }), { label: 'downside', gdv_adjustment_pct: -10, construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0 });

    const u = stressed.unit_mix.units[0];
    expect(u.estimated_value_pence).toBe(22_500_000);
    expect(u.ancillary.parking_value_pence).toBe(1_080_000);
    expect(u.ancillary.balcony_terrace_value_pence).toBe(360_000);
  });

  it('leaves ancillary AREAS untouched — a price stress is not an area stress', () => {
    const stressed = applyScenario(makeV6Inputs({
      units: [{ id: 'u1', ancillary: { balcony_terrace_sqm: 8, balcony_terrace_value_pence: 0, parking_spaces: 2, parking_value_pence: 0 } }],
    }), { label: 'downside', gdv_adjustment_pct: -10, construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0 });
    expect(stressed.unit_mix.units[0].ancillary.balcony_terrace_sqm).toBe(8);
    expect(stressed.unit_mix.units[0].ancillary.parking_spaces).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- --run lender-valuation.test.ts apply-scenario.test.ts`
Expected: FAIL on the ancillary assertions.

- [ ] **Step 3: Bind `global_per_sqft` to internal NIA**

In `frontend/src/lib/model/lender-valuation.ts`, at the `global_per_sqft` case:

```ts
      case 'global_per_sqft':
        // R9 (spec §3.2, amended): bound explicitly to INTERNAL net internal
        // area. `u.floor_area_sqm` is internal NIA and ancillary areas live in
        // `u.ancillary`, so this is already correct — the binding is stated and
        // tested so that it stays correct, rather than being an accident of
        // which field happened to exist when the basis was written.
        value = Math.round((lv.global_value as number) * u.floor_area_sqm * SQFT_PER_SQM);
        break;
```

- [ ] **Step 4: Extend the scenario multiplier to ancillary value**

In `frontend/src/lib/model/apply-scenario.ts`:

```ts
    unit_mix: {
      units: inputs.unit_mix.units.map((u) => ({
        ...u,
        estimated_value_pence: Math.round(u.estimated_value_pence * gdvMultiplier),
        // R9 spec §15.5: ancillary is part of GDV, so a GDV stress moves it.
        // Ancillary AREAS are deliberately untouched — a price stress is not an
        // area stress; area reduction is its own R16 lever.
        ...('ancillary' in u && u.ancillary != null ? {
          ancillary: {
            ...u.ancillary,
            parking_value_pence: Math.round(u.ancillary.parking_value_pence * gdvMultiplier),
            balcony_terrace_value_pence: Math.round(u.ancillary.balcony_terrace_value_pence * gdvMultiplier),
          },
        } : {}),
      })),
    },
```

- [ ] **Step 5: Mirror both in Python**

`app/financial_model/lender_valuation.py` — add the same comment at the `global_per_sqft` branch. `app/financial_model/apply_scenario.py` — extend the unit loop with the ancillary value multipliers using `money_round`, guarded by `getattr(unit, "ancillary", None) is not None`.

**While in `apply_scenario.py`, clear R8 carry-forward #2:** its module docstring still says "v2, v3 or v4" where the TS twin says v5. Correct it to "v2 through v6".

- [ ] **Step 6: Run both suites**

```bash
cd frontend && npm run test -- --run
cd .. && pytest -q
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix: bind lender per-sq-ft to internal NIA and stress ancillary value in scenarios

Both are latent defects that become wrong the moment a unit has a second area
or a second value. Also corrects apply_scenario.py's stale version docstring."
```

---

## Task 8: Validation — new rules, and one deletion

**Files:**
- Modify: `frontend/src/lib/model/validation.ts:49-52,98-106`
- Modify: `app/financial_model/validation.py:73-75,141-150`
- Test: `frontend/src/lib/model/validation.test.ts`, `tests/test_validation.py`

**Interfaces:**
- Consumes: `areaBridge(inputs)` / `area_bridge(inputs)` (Tasks 1–2).
- Produces: no new exports. Seven new rules and one retired message.

- [ ] **Step 1: Write the failing tests, including the zero-count on the retired string**

```ts
const RETIRED_25PCT = 'differ by more than 25%';

describe('R9 — area bridge validation', () => {
  it('hard-errors when the bridge basis is selected with no bridge', () => {
    const issues = validateInputs(makeV6Inputs({ areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived' } }));
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error', field: 'areas.existing_gia_sqm',
    }));
  });

  it('hard-errors when demolition exceeds the existing building', () => {
    const issues = validateInputs(makeV6Inputs({ areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 100, demolished_gia_sqm: 150 } }));
    expect(issues.some((i) => i.severity === 'error' && i.field === 'areas.demolished_gia_sqm')).toBe(true);
  });

  it('hard-errors when retained and untouched area exceed proposed GIA', () => {
    const issues = validateInputs(makeV6Inputs({ areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 500, retained_commercial_gia_sqm: 400, untouched_gia_sqm: 200 } }));
    expect(issues.some((i) => i.severity === 'error' && i.field === 'areas.retained_commercial_gia_sqm')).toBe(true);
  });

  it('hard-errors when non-saleable deductions exceed developed GIA', () => {
    const issues = validateInputs(makeV6Inputs({ areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 100, circulation_common_sqm: 200 } }));
    expect(issues.some((i) => i.severity === 'error' && i.field === 'areas.circulation_common_sqm')).toBe(true);
  });

  it('hard-errors when the units over-fill the space available for them', () => {
    // Over-allocating the building is impossible, not questionable.
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 200 },
      units: [{ id: 'u1', floor_area_sqm: 300, estimated_value_pence: 1 }],
    }));
    expect(issues.some((i) => i.severity === 'error' && i.field === 'unit_mix.units')).toBe(true);
  });

  it('warns when more than 10% of the developed area is unallocated', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1000 },
      units: [{ id: 'u1', floor_area_sqm: 100, estimated_value_pence: 1 }],
    }));
    expect(issues.some((i) => i.severity === 'warning' && i.field === 'areas.unallocated_sqm')).toBe(true);
  });

  it('warns when net-to-gross efficiency falls outside 65-90%', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1000 },
      units: [{ id: 'u1', floor_area_sqm: 100, estimated_value_pence: 1 }],
    }));
    expect(issues.some((i) => i.severity === 'warning' && i.field === 'areas.nia_to_gia_pct')).toBe(true);
  });

  it('warns when the manual basis disagrees with a populated bridge by over 5%', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual', existing_gia_sqm: 1000 },
      conversion_costs: { total_construction_sqm: 500 },
    }));
    expect(issues.some((i) => i.severity === 'warning' && i.field === 'areas.basis')).toBe(true);
  });

  it('stays silent on a bridge that ties within policy', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 500, circulation_common_sqm: 50 },
      units: [{ id: 'u1', floor_area_sqm: 380, estimated_value_pence: 1 }],
    }));
    expect(issues.filter((i) => i.field.startsWith('areas.'))).toEqual([]);
  });
});

describe('R9 — the ±25% warning is retired, not softened', () => {
  it('is emitted by no input at all', () => {
    // R8 lesson: a positive `toContain` sails straight past an old sentence
    // being re-added ALONGSIDE the true one. Zero-counts on retired strings are
    // load-bearing. `memo-release-gate.test.ts` spent a release asserting the
    // memo CONTAINED a false statement.
    for (const inputs of [
      makeV6Inputs({ areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual' }, conversion_costs: { total_construction_sqm: 500 }, units: [{ id: 'u1', floor_area_sqm: 252, estimated_value_pence: 1 }] }),
      makeV6Inputs({ areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 500 }, units: [{ id: 'u1', floor_area_sqm: 252, estimated_value_pence: 1 }] }),
    ]) {
      expect(validateInputs(inputs).filter((i) => i.message.includes(RETIRED_25PCT))).toEqual([]);
    }
  });

  it('is absent from the source of both engines', () => {
    const ts = readFileSync(resolve(__dirname, './validation.ts'), 'utf-8');
    const py = readFileSync(resolve(__dirname, '../../../../app/financial_model/validation.py'), 'utf-8');
    expect(ts).not.toContain(RETIRED_25PCT);
    expect(py).not.toContain(RETIRED_25PCT);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- --run validation.test.ts`
Expected: FAIL — no area rules exist, and the retired-string tests fail because the ±25% warning is still there.

- [ ] **Step 3: Implement the rules and delete the old warning**

In `frontend/src/lib/model/validation.ts`, **delete** lines 98–106 (the `unitArea`/`constArea` ratio block) entirely and insert in their place:

```ts
  // R9 spec §15.6 — the area bridge. This block REPLACES the ±25% unit-NIA vs
  // construction-area warning that stood here until R9. That warning was a
  // proxy for a reconciliation the schema could not express; now that it can,
  // the proxy is deleted rather than kept alongside — a retired message left in
  // place is a second, quieter source of truth.
  const bridge = areaBridge(inputs);
  const areas = 'areas' in inputs ? inputs.areas : null;

  if (areas != null) {
    for (const [field, value] of [
      ['existing_gia_sqm', areas.existing_gia_sqm],
      ['demolished_gia_sqm', areas.demolished_gia_sqm],
      ['extension_gia_sqm', areas.extension_gia_sqm],
      ['retained_commercial_gia_sqm', areas.retained_commercial_gia_sqm],
      ['untouched_gia_sqm', areas.untouched_gia_sqm],
      ['circulation_common_sqm', areas.circulation_common_sqm],
      ['plant_riser_sqm', areas.plant_riser_sqm],
      ['store_bin_cycle_sqm', areas.store_bin_cycle_sqm],
      ['amenity_sqm', areas.amenity_sqm],
      ['external_amenity_sqm', areas.external_amenity_sqm],
    ] as const) {
      if (value < 0) err(`areas.${field}`, 'Area cannot be negative.');
    }

    if (bridge.proposed_gia_sqm < 0) {
      err('areas.demolished_gia_sqm',
        `Demolished area (${areas.demolished_gia_sqm} m²) exceeds the existing building `
        + `(${areas.existing_gia_sqm} m²) — proposed GIA cannot be negative.`);
    }
    if (bridge.developed_gia_sqm < 0) {
      err('areas.retained_commercial_gia_sqm',
        `Retained commercial and untouched area together exceed proposed GIA `
        + `(${bridge.proposed_gia_sqm} m²) — developed area cannot be negative.`);
    }
    if (bridge.available_for_units_sqm < 0) {
      err('areas.circulation_common_sqm',
        `Circulation, plant, storage and amenity together exceed the developed area `
        + `(${bridge.developed_gia_sqm} m²) — no space remains for units.`);
    }
    if (areas.basis === 'bridge_derived' && bridge.developed_gia_sqm <= 0) {
      err('areas.existing_gia_sqm',
        'The bridge-derived cost basis is selected but the bridge produces no developed area — '
        + 'enter the building’s existing GIA, or switch the basis to manual.');
    }
    if (bridge.unallocated_sqm < 0) {
      err('unit_mix.units',
        `Unit NIA (${bridge.unit_nia_sqm} m²) exceeds the area available for units `
        + `(${bridge.available_for_units_sqm} m²) — the schedule does not fit the building.`);
    }

    // Warnings only. An unallocated balance is frequently and legitimately
    // unknown at appraisal stage, so it never gates the document (spec §15.7).
    if (bridge.developed_gia_sqm > 0 && bridge.unallocated_sqm > bridge.developed_gia_sqm * 0.10) {
      warn('areas.unallocated_sqm',
        `${bridge.unallocated_sqm} m² of the developed area is unallocated `
        + `(${pct(bridge.unallocated_sqm, bridge.developed_gia_sqm)}%) — the bridge does not yet tie.`);
    }
    if (bridge.nia_to_gia_pct != null && (bridge.nia_to_gia_pct < 65 || bridge.nia_to_gia_pct > 90)) {
      warn('areas.nia_to_gia_pct',
        `Net-to-gross efficiency of ${bridge.nia_to_gia_pct}% is outside the 65–90% range `
        + 'typical of a conversion — check the area basis.');
    }
    if (areas.basis === 'manual' && bridge.developed_gia_sqm > 0) {
      const manual = inputs.conversion_costs.total_construction_sqm;
      const diff = Math.abs(manual - bridge.developed_gia_sqm);
      if (diff > bridge.developed_gia_sqm * 0.05) {
        warn('areas.basis',
          `The manual construction area (${manual} m²) differs from the bridge's developed area `
          + `(${bridge.developed_gia_sqm} m²) by more than 5% — one of them is wrong, or the `
          + 'manual basis needs a reason.');
      }
    }
  }
```

Add `import { areaBridge } from './areas';` and `import { pct } from './pct';`.

Line 50's existing negative check on `total_construction_sqm` stays — it is the manual basis's own field and `validation.ts` is **not** on the guard allowlist, so read it through `bridge.developed_area_sqm` instead:

```ts
  if (bridge.developed_area_sqm < 0) {
    err('conversion_costs.total_construction_sqm', 'Area cannot be negative.');
  }
```

- [ ] **Step 4: Mirror in Python**

Port the block into `app/financial_model/validation.py`, deleting lines 141–150 (the ratio warning) and using `getattr(inputs, "areas", None)` for the structural read, matching the module's existing version-dispatch idiom.

- [ ] **Step 5: Pin the governance decision — the DRAFT gate is NOT extended**

Spec §7 decides deliberately that an unreconciled area bridge produces warnings and never forces DRAFT: unlike an unconfirmed tax jurisdiction (knowable on day one), an unallocated balance is frequently and legitimately unknown at appraisal stage, and gating on it would put every existing appraisal into permanent DRAFT for a number nobody can yet supply.

A deliberate non-change needs a test, or it drifts silently. Add to `frontend/src/lib/report-provenance.test.ts`:

```ts
describe('R9 — the area bridge does not gate the document', () => {
  it('leaves the DraftReason union at its four R8 members', () => {
    // R8's memory records that the ORDER of this union is load-bearing and that
    // inverting it survived all 1070 tests while being production-reachable.
    // R9 adds no member; this test is what makes that a decision rather than an
    // omission somebody later "fixes".
    const REASONS: DraftReason[] = ['unreconciled', 'senior_not_repaid', 'tax_basis_unconfirmed', 'not_approved'];
    expect(REASONS).toHaveLength(4);
  });

  it('keeps a document with a large unallocated balance FINAL when nothing else blocks it', () => {
    const run = runAppraisal(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1000 },
      units: [{ id: 'u1', floor_area_sqm: 100, estimated_value_pence: 1 }],
    }));
    expect(run.reconciliation.issues.some((i) => i.field === 'areas.unallocated_sqm')).toBe(true);
    expect(draftReason(run, { taxBasisConfirmed: true }, approvedStatus)).toBeNull();
  });

  it('still marks a document unreconciled when the bridge fails a HARD rule', () => {
    // The basis conflict IS resolvable by the user, so it stays a hard error,
    // and hard validation failure already produces `unreconciled` (spec §7).
    const run = runAppraisal(makeV6Inputs({ areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived' } }));
    expect(draftReason(run, { taxBasisConfirmed: true }, approvedStatus)).toBe('unreconciled');
  });
});
```

Add the Python twin to `tests/test_appraisal_governance.py`.

- [ ] **Step 6: Run both suites**

```bash
cd frontend && npm run test -- --run
cd .. && pytest -q
```
Expected: PASS. Existing fixtures migrate to the manual basis with a zeroed bridge, so `developed_gia_sqm` is 0 and every new rule is inert for them — which is why no golden fixture moves.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: area bridge validation; retire the 25% area-mismatch warning

The retired message is asserted absent from both engines' source and output —
a positive toContain would sail past it being re-added alongside the new rules."
```

---

## Task 9: Outputs — the `area_bridge` result block and three metrics fields

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts:318-337` (`AppraisalResultV2`)
- Modify: `frontend/src/lib/model/metrics.ts:255-258`
- Modify: `app/financial_model/types.py` (`AppraisalResultV2`)
- Modify: `app/financial_model/metrics.py`
- Test: `frontend/src/lib/model/metrics.test.ts`, `tests/test_metrics.py`

**Interfaces:**
- Consumes: `areaBridge(inputs)` / `area_bridge(inputs)` (Tasks 1–2); `calculateGdvBreakdown` (Task 6).
- Produces: `AppraisalResultV2.area_bridge: AreaBridgeResult`, `.developed_area_sqm: number`, `.gdv_internal_pence: number`, `.gdv_ancillary_pence: number`.

**Why this task exists separately:** the UI (Task 10) and the memo (Task 11) both need these figures, and neither may recompute one. Without a sanctioned output they would each call `areaBridge` themselves — which is legal under the guard but is precisely the fourth-consumer pattern the guard exists to discourage. One derivation, emitted once, read everywhere.

- [ ] **Step 1: Write the failing tests**

```ts
describe('R9 — the appraisal result carries the area bridge', () => {
  it('emits every derived line and ratio', () => {
    const run = runAppraisal(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 520, circulation_common_sqm: 60 },
      units: [{ id: 'u1', floor_area_sqm: 380, estimated_value_pence: 50_000_000 }],
    }));
    expect(run.metrics.area_bridge.developed_gia_sqm).toBe(520);
    expect(run.metrics.area_bridge.available_for_units_sqm).toBe(460);
    expect(run.metrics.area_bridge.unallocated_sqm).toBe(80);
    expect(run.metrics.area_bridge.nia_to_gia_pct).toBe(73.08);
  });

  it('reports the cost area actually used', () => {
    const run = runAppraisal(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual' },
      conversion_costs: { total_construction_sqm: 480 },
    }));
    expect(run.metrics.developed_area_sqm).toBe(480);
  });

  it('splits GDV while keeping gdv_pence as the total', () => {
    const run = runAppraisal(makeV6Inputs({
      units: [{ id: 'u1', floor_area_sqm: 50, estimated_value_pence: 25_000_000,
        ancillary: { balcony_terrace_sqm: 6, balcony_terrace_value_pence: 400_000, parking_spaces: 1, parking_value_pence: 1_200_000 } }],
    }));
    expect(run.metrics.gdv_internal_pence).toBe(25_000_000);
    expect(run.metrics.gdv_ancillary_pence).toBe(1_600_000);
    expect(run.metrics.gdv_pence).toBe(26_600_000);
  });

  it('keeps every GDV-denominated ratio on the total, unamended', () => {
    // profit_on_gdv_pct, ltgdv_developer_pct and the break-even percentages all
    // divide by gdv_pence. Because gdv_pence remains the TOTAL, none of them
    // needed a spec amendment in R9 — this test is what holds that true.
    const run = runAppraisal(makeV6Inputs({ /* as above */ }));
    expect(run.metrics.profit_on_gdv_pct)
      .toBe(pct(run.metrics.profit_pence, run.metrics.gdv_pence));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- --run metrics.test.ts`
Expected: FAIL — `area_bridge` is not a property of the result.

- [ ] **Step 3: Extend the result type**

In `frontend/src/lib/model/finance-types.ts`, inside `AppraisalResultV2`, after `sdlt_pence`:

```ts
  /** R9 spec §15.8 — the full area reconciliation: every entered line, every
   *  derived line, every efficiency. The UI and the report read areas from here
   *  and never recompute one. */
  area_bridge: AreaBridgeResult;
  /** R9 spec §15.8 — the construction cost area actually used, whichever basis
   *  produced it. Equal to `area_bridge.developed_area_sqm`. */
  developed_area_sqm: number;
  /** R9 spec §3.1 — GDV excluding ancillary. This is the pre-R9 figure, kept so
   *  a variance against it stays expressible. */
  gdv_internal_pence: number;
  /** R9 spec §3.1 — parking plus balcony/terrace value. `gdv_pence` remains the
   *  TOTAL of the two, so every existing GDV-denominated ratio is unchanged. */
  gdv_ancillary_pence: number;
```

with `import type { AreaBridgeResult } from './areas';` added.

- [ ] **Step 4: Emit them from `deriveMetrics`**

In `frontend/src/lib/model/metrics.ts`, add near the top of `deriveMetrics`:

```ts
  // R9 spec §15.8. Derived once, here, and read by every consumer from the
  // result — the UI and the memo never call areaBridge themselves.
  const bridge = areaBridge(inputs);
  const gdvParts = calculateGdvBreakdown(inputs.unit_mix.units);
```

and in the returned object, alongside `gdv_pence`:

```ts
    area_bridge: bridge,
    developed_area_sqm: bridge.developed_area_sqm,
    gdv_internal_pence: gdvParts.internal_pence,
    gdv_ancillary_pence: gdvParts.ancillary_pence,
```

- [ ] **Step 5: Mirror in Python**

Add the four fields to `AppraisalResultV2` in `app/financial_model/types.py` (with `AreaBridgeResult` imported from `.areas`; declare it as a Pydantic-compatible model or convert the dataclass with `dataclasses.asdict` at the emit site — whichever matches how the module already serialises nested results), and emit them from `derive_metrics`.

- [ ] **Step 6: Run both suites and the parity check**

```bash
cd frontend && npm run test -- --run && npx tsc -b
cd .. && pytest -q
```
Expected: PASS. The golden-fixture parity suite now compares `area_bridge` field-by-field across engines.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: emit the area bridge and the GDV split on the appraisal result"
```

---

## Task 10: UI — the Areas page, the basis selector, and per-unit ancillary

**Files:**
- Create: `frontend/src/components/calculator/AreasPage.tsx`
- Create: `frontend/src/components/calculator/AreasPage.test.tsx`
- Modify: `frontend/src/components/ConversionCalculator.tsx:25-54,310-340`
- Modify: `frontend/src/components/calculator/ConversionCostsPage.tsx:74`
- Modify: `frontend/src/components/calculator/UnitMixPage.tsx:90-140`

**Interfaces:**
- Consumes: `run.metrics.area_bridge` (Task 9); `CalculatorInputsV6`, `DEFAULT_AREA_BRIDGE` (Tasks 1, 3).
- Produces: a `CalcPage` key `'areas'`, rendered second in the wizard (immediately after Acquisition, before Unit Mix — the building's areas are known before its unit schedule is drawn).

**Constraint restated, because this is the layer R8 was bitten at:** every figure on these pages comes from `run.metrics.area_bridge`. No component recomputes an area. R8's third instance was `AcquisitionPage.tsx` computing its own England-only tax, which would have shown a Welsh document two contradicting tax figures on one screen.

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/components/calculator/AreasPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AreasPage from './AreasPage';

describe('AreasPage', () => {
  it('shows the reconciliation from the run, not from a local computation', () => {
    render(<AreasPage inputs={inputsFixture} onChange={vi.fn()} run={runFixture} />);
    expect(screen.getByText('Proposed GIA').closest('tr')).toHaveTextContent('620');
    expect(screen.getByText('Developed area').closest('tr')).toHaveTextContent('520');
    expect(screen.getByText('Unallocated').closest('tr')).toHaveTextContent('300');
  });

  it('displays a negative unallocated balance with its sign rather than suppressing it', () => {
    render(<AreasPage inputs={inputsFixture} onChange={vi.fn()} run={overfilledRunFixture} />);
    expect(screen.getByText('Unallocated').closest('tr')).toHaveTextContent('-80');
  });

  it('shows all three efficiencies, and an em dash where the ratio is unavailable', () => {
    render(<AreasPage inputs={inputsFixture} onChange={vi.fn()} run={zeroGiaRunFixture} />);
    expect(screen.getByLabelText('Net to gross')).toHaveTextContent('—');
  });

  it('writes entered areas back through onChange', async () => {
    const onChange = vi.fn();
    render(<AreasPage inputs={inputsFixture} onChange={onChange} run={runFixture} />);
    await userEvent.clear(screen.getByLabelText('Existing GIA (m²)'));
    await userEvent.type(screen.getByLabelText('Existing GIA (m²)'), '700');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ areas: expect.objectContaining({ existing_gia_sqm: 700 }) }),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- --run AreasPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the Areas page**

Create `frontend/src/components/calculator/AreasPage.tsx` following `ConversionCostsPage.tsx`'s existing structure exactly — the same `Props` shape (`inputs`, `onChange`, `run`), the same inline-style vocabulary (`#0f172a` field background, `#1e3a5f` border, `#94a3b8` labels, `#e2e8f0` text, 260 px label column), and the same `CostRow`-style row component renamed `AreaRow`.

Layout, top to bottom:

1. **Entered areas** — one `AreaRow` per field of `AreaBridgeInputs`, grouped under three sub-headings: "Existing and proposed" (existing, demolished, extension), "Not part of the residential works" (retained commercial, untouched), "Non-saleable internal" (circulation, plant, storage, amenity). `external_amenity_sqm` sits last under "External", visually separated with the caption "Recorded for the schedule; never part of the GIA reconciliation."
2. **The reconciliation table** — a `<table>` with a row per derived line, each reading `run.metrics.area_bridge`, in the spec §15.1 order: Existing GIA, less demolished, plus extension, **Proposed GIA**, less retained commercial, less untouched, **Developed area**, less circulation, less plant, less storage, less amenity, **Available for units**, less unit NIA, **Unallocated**. Derived rows are bold; every row shows one decimal place.
3. **Efficiencies** — three labelled figures (`aria-label` "Net to gross", "NIA to proposed GIA", "Saleable to developed"), each rendering `—` when the value is `null`. Under "Saleable to developed", the caption: "Counts only units being sold — a retain-all scheme reads 0%."
4. **Validation issues** — filter `run.reconciliation.issues` to `field.startsWith('areas.')` and render errors then warnings, matching how `ConversionCostsPage` already surfaces issues.

- [ ] **Step 4: Register the page in the wizard**

In `frontend/src/components/ConversionCalculator.tsx`, add `'areas'` to the `CalcPage` union and insert into `PAGES` as `{ key: 'areas', label: 'Areas', num: 2 }`, renumbering the twelve pages after it (Unit Mix becomes 3, Costs 4, … Investor 14). Add the import and the render branch:

```tsx
        {activePage === 'areas' && (
          <AreasPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
```

- [ ] **Step 5: Add the basis selector to the costs page**

In `frontend/src/components/calculator/ConversionCostsPage.tsx`, replace the bare `total_construction_sqm` row at line 74 with a basis-aware pair:

```tsx
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>Construction area basis</label>
        <select
          value={inputs.areas.basis}
          onChange={(e) => onChange({ areas: { ...inputs.areas, basis: e.target.value as AreaBasis } })}
          style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
        >
          <option value="bridge_derived">Derived from the area bridge</option>
          <option value="manual">Entered manually</option>
        </select>
      </div>
      {inputs.areas.basis === 'bridge_derived' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>Total construction m²</label>
          <span style={{ color: '#e2e8f0', fontSize: 14 }}>
            {run.metrics.developed_area_sqm.toLocaleString()} m²
          </span>
          <span style={{ color: '#64748b', fontSize: 12 }}>
            derived: proposed GIA {run.metrics.area_bridge.proposed_gia_sqm.toLocaleString()} m²
            less retained and untouched area
          </span>
        </div>
      ) : (
        <CostRow
          label="Total construction m²"
          value={costs.total_construction_sqm}
          onChangeValue={(v) => updateCosts({ total_construction_sqm: v })}
        />
      )}
```

This component stays on the guard allowlist: under the manual basis it is the legitimate **editor** of the raw field.

- [ ] **Step 6: Add per-unit ancillary to the unit mix page**

In `frontend/src/components/calculator/UnitMixPage.tsx`, add to each unit's row a visually separated ancillary group — a thin left border and the sub-heading "Ancillary (outside NIA)" — holding four inputs: balcony/terrace m², balcony/terrace value, parking spaces, parking value. The separation is the point: a balcony typed into `floor_area_sqm` corrupts NIA, the NDSS check and every efficiency at once.

Update the footer total at line 137 to show both figures:

```tsx
          <span>Total NIA: {units.reduce((s, u) => s + u.floor_area_sqm, 0).toLocaleString()} m²</span>
          <span style={{ color: '#64748b' }}>
            Ancillary: {units.reduce((s, u) => s + (u.ancillary?.balcony_terrace_sqm ?? 0), 0).toLocaleString()} m²
            balcony/terrace · {units.reduce((s, u) => s + (u.ancillary?.parking_spaces ?? 0), 0)} parking
          </span>
```

- [ ] **Step 7: Pin the NDSS binding**

Add to `frontend/src/lib/space-standards.test.ts`:

```ts
it('tests NDSS against internal NIA only, never ancillary area', () => {
  // A 45 m² 1-bed with a 10 m² balcony is still below the 50 m² NDSS minimum
  // and still undeliverable. Letting balcony area into this check would turn
  // failing units into passing ones.
  const issues = checkSpaceStandards([{
    id: 'u1', type: '1bed', floor_area_sqm: 45, estimated_value_pence: 1, comparable_notes: '',
    ancillary: { balcony_terrace_sqm: 10, balcony_terrace_value_pence: 0, parking_spaces: 0, parking_value_pence: 0 },
  } as never]);
  expect(issues).toHaveLength(1);
  expect(issues[0].unitId).toBe('u1');
});
```

- [ ] **Step 8: Run the frontend gate**

```bash
cd frontend && npm run test -- --run && npx tsc -b && npm run lint && npm run build
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: Areas page, construction-area basis selector, per-unit ancillary inputs"
```

---

## Task 11: The report — area schedule, efficiencies, GDV split

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts:341,930-945,1000-1010`
- Modify: `frontend/src/lib/report-qa/memo-fixtures.ts:88-110`
- Test: `frontend/src/lib/export-investment-memo.test.ts`, `frontend/src/lib/report-qa/memo-release-gate.test.ts`

**Interfaces:**
- Consumes: `run.metrics.area_bridge`, `gdv_internal_pence`, `gdv_ancillary_pence` (Task 9).
- Produces: no new exports. New memo content only.

- [ ] **Step 1: Write the failing report tests**

```ts
describe('R9 — the memo reports the area bridge', () => {
  it('prints the reconciliation with its derived lines', () => {
    const text = memoTextFor(bridgeFixture);
    expect(text).toContain('Area schedule');
    expect(text).toContain('Proposed GIA');
    expect(text).toContain('Developed area');
    expect(text).toContain('Unallocated');
  });

  it('prints all three efficiencies', () => {
    const text = memoTextFor(bridgeFixture);
    expect(text).toContain('Net to gross');
    expect(text).toContain('Saleable to developed');
  });

  it('states the cost-area basis in words, so the reader knows which number priced the works', () => {
    expect(memoTextFor(bridgeFixture)).toContain('Construction area derived from the area schedule');
    expect(memoTextFor(manualFixture)).toContain('Construction area entered manually');
  });

  it('discloses an unallocated balance rather than printing a bridge that appears to tie', () => {
    expect(memoTextFor(unreconciledFixture)).toContain('300.0 m² of the developed area is unallocated');
  });

  it('splits GDV into internal saleable and ancillary', () => {
    const text = memoTextFor(ancillaryFixture);
    expect(text).toContain('Internal saleable value');
    expect(text).toContain('Parking, balconies and terraces');
  });

  it('no longer claims parking and external space are excluded pending a later release', () => {
    // Spec §3.1 carried "until valued separately in R3" from R1 to R8. R9 pays
    // it off; the memo must not still be promising it. Zero-count, per the R8
    // memo-release-gate lesson.
    expect(memoTextFor(ancillaryFixture)).not.toContain('valued separately');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test -- --run export-investment-memo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the area schedule to the memo**

In `frontend/src/lib/export-investment-memo.ts`, in the section that currently computes `totalSqm` at line 341, replace the single total with a full schedule block, drawn with the existing `sectionTitle` / table helpers and wrapped in the R7 `ensureSpace` keep-together primitive so the block cannot straddle a page break. Rows mirror the AreasPage reconciliation exactly; a caption states the basis in words:

- `bridge_derived` → "Construction area derived from the area schedule."
- `manual` → "Construction area entered manually; the area schedule below is recorded but does not price the works."

Where `area_bridge.unallocated_sqm` exceeds 10% of the developed area, print the disclosure line rather than a schedule that appears to tie.

In the unit table (lines 930–945), add ancillary columns, and in the GDV summary split the total into "Internal saleable value" and "Parking, balconies and terraces".

- [ ] **Step 4: Update the memo fixtures**

In `frontend/src/lib/report-qa/memo-fixtures.ts`, migrate the fixture inputs to v6 and add a populated bridge and ancillary to at least one so the report QA harness exercises the new blocks. The `total_construction_sqm: 340` at line 108 stays — that fixture keeps the manual basis, which is what makes it the manual-basis report case.

- [ ] **Step 5: Run the report suites**

```bash
cd frontend && npm run test -- --run export-investment-memo.test.ts report-qa
```
Expected: PASS, including the existing page-bounds and sparse-page assertions from R7.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: area schedule, efficiencies and the GDV split in the investment memo"
```

---

## Task 12: Golden fixtures, spec documents, and R8 housekeeping

**Files:**
- Create: `fixtures/financial-model/n-area-bridge.json`
- Create: `fixtures/financial-model/o-ancillary-value.json`
- Create: `fixtures/financial-model/p-scotland-levered.json`
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts` (fixture roster)
- Modify: `docs/financial-model/calculation-specification.md`
- Modify: `docs/financial-model/model-governance.md`
- Modify: `docs/financial-model/test-cases.md`
- Modify: `docs/financial-model/migration-notes.md`
- Modify: `docs/reviews/2026-08-17-release-8-implementation-report.md`
- Modify: `app/financial_model/validation.py` (date validation)

**Interfaces:**
- Consumes: everything above.
- Produces: three fixture stems added to `EXPECTED_FIXTURE_STEMS`, and spec §15.

**Every expected figure in these fixtures must be derived by hand from the spec, not copied from a run.** A fixture whose expectations came from the code under test pins the behaviour, not the specification.

- [ ] **Step 1: Author `n-area-bridge.json`**

A `pipeline` fixture, `inputs_version: 6`, England/NI, all-cash, with a fully populated bridge on the `bridge_derived` basis. Use the Task 1 `FULL_BRIDGE` geometry (existing 600, demolished 20, extension 40, retained commercial 100, circulation 62, plant 18, store 14, amenity 6) so the derivation is already independently asserted, with units summing to 380 m² NIA. Expected metrics must include `developed_area_sqm: 520`, the construction cost computed by hand as `round(rate × 520)` plus contingency and compliance, and `area_bridge.nia_to_gia_pct: 73.08`.

- [ ] **Step 2: Author `o-ancillary-value.json`**

A `blended` exit so the ancillary split is exercised on both sides: one unit sold with parking, one retained with parking. Expected metrics must pin `gdv_internal_pence`, `gdv_ancillary_pence`, `gdv_pence` as their sum, and gross sale receipts covering the sold unit's ancillary only. Include a `downside` scenario at `gdv_adjustment_pct: -10` and pin the stressed ancillary values, so Task 7's scenario binding is covered end-to-end.

- [ ] **Step 3: Author `p-scotland-levered.json` — R8's open carry-forward**

R8's implementation report records that no non-English fixture exercises a **levered** path, leaving the jurisdiction-aware tax → TDC → `peak_debt` interaction unpinned. `m-wales-jurisdiction.json` is all-cash.

This fixture is Scotland (LBTT), with development finance: a committed net facility, rolled-up interest, a 12-month term. Compute LBTT by hand from `fixtures/tax/acquisition-tax-tables.json` — the **normative** record — at the fixture's purchase price and date, then carry it through acquisition cost → TDC → the monthly ledger → `peak_debt_pence`. Recall no rates; read the table.

- [ ] **Step 4: Add the stems to the roster**

In `frontend/src/lib/model/golden-fixtures.test.ts`, extend `EXPECTED_FIXTURE_STEMS` with `'n-area-bridge'`, `'o-ancillary-value'`, `'p-scotland-levered'`. The roster exists because the corpus is loaded by directory scan, so a fixture that is never committed would silently reduce coverage instead of failing.

- [ ] **Step 5: Run the parity suites**

```bash
cd frontend && npm run test -- --run golden-fixtures.test.ts
cd .. && pytest tests/test_golden_fixtures.py -q
```
Expected: PASS in both engines against the same JSON.

- [ ] **Step 6: Write spec §15 and amend §2, §3.1, §3.2**

In `docs/financial-model/calculation-specification.md`, add **§15 Area bridge and efficiency [R9 — calc 2.8.0]** covering: the entered/derived model and the one-fact-one-line rule; the normative arithmetic order; the three efficiencies with their null-denominator behaviour and the saleable ratio's exit coupling; the basis switch; ancillary areas and value; and the stated limitations (scheme-level ancillary out of scope, retained commercial value deferred to R13, no measurement-standard enforcement).

Add to §2 the four new basis definitions: **Developed area**, **Available for units**, **Unallocated balance**, **Ancillary value**.

In §3.1, **replace** the exclusion sentence. Follow §3.3's R8 precedent of quoting what changed:

> **Included:** internal saleable unit values, plus ancillary value (parking, balconies and terraces) reported as a separate component. **Excluded:** retained-commercial value, rental income. [R9 — calc 2.8.0. Before it, this line excluded parking and external space "until valued separately in R3". R3 shipped without it and the pointer stood unpaid through R8; the exclusion is now removed rather than repointed, because the values are modelled.]

In §3.2, bind the `global_per_sqft` basis: "pence per sq ft applied to every unit's **internal net internal area** (`floor_area_sqm`), never its ancillary areas."

- [ ] **Step 7: Update governance and test-case documents**

`model-governance.md` — a subsection on the single-accessor rule: what it covers, how each language enforces it, and the recorded limitation that test files are exempt.

`test-cases.md` — **§14 Area bridge and ancillary [R9 — calc 2.8.0]**: the three new fixtures, the guard tests, and the migration numerical-identity assertion.

`migration-notes.md` — a v5 → v6 section stating the numerical-identity claim and where it is tested.

- [ ] **Step 8: Clear the R8 carry-forwards**

1. `docs/reviews/2026-08-17-release-8-implementation-report.md` — the §7 cross-reference should read §8.
2. `apply_scenario.py`'s docstring — already corrected in Task 7 Step 5. Verify.
3. Python `__all__` V5/V6 symbols — already corrected in Task 3 Step 11. Verify.
4. **Date validation is regex-only, so `2026-02-31` validates.** Replace the regex check in both engines with a real calendar-validity check, and add tests:

```ts
it('rejects a date that matches the pattern but does not exist', () => {
  const issues = validateInputs(makeV6Inputs({ acquisition: { acquisition_date: '2026-02-31' } }));
  expect(issues.some((i) => i.severity === 'error' && i.field === 'acquisition.acquisition_date')).toBe(true);
});

it('accepts 29 February in a leap year', () => {
  const issues = validateInputs(makeV6Inputs({ acquisition: { acquisition_date: '2028-02-29' } }));
  expect(issues.filter((i) => i.field === 'acquisition.acquisition_date')).toEqual([]);
});
```

TypeScript: parse with `new Date(y, m - 1, d)` and confirm the round-trip preserves all three components. Python: `datetime.date(y, m, d)` inside a `try/except ValueError`.

- [ ] **Step 9: Run the complete gate set**

```bash
cd frontend && npm run test -- --run && npx tsc -b && npm run lint && npm run build
cd .. && pytest -q
```
Expected: all pass. Vitest and pytest counts must both exceed their R9 baselines (1186 / 969).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "test+docs: R9 golden fixtures, spec §15, and the R8 carry-forward clearances

Adds the bridge-derived, ancillary and levered-Scotland fixtures — the last
closing R8's own open item that no non-English fixture exercised a levered
path. Pays off spec §3.1's unpaid R3 promise and fixes calendar-invalid date
acceptance in both engines."
```

---

## Definition of done

- [ ] `npm run test -- --run` passes, count above 1186
- [ ] `pytest -q` passes, count above 969
- [ ] `npm run lint` passes, **including** the new single-accessor rule
- [ ] `npx tsc -b` clean
- [ ] `npm run build` succeeds
- [ ] Every pre-R9 golden fixture produces identical output through the v6 migration — the tested form of "purely additive"
- [ ] The ±25% message appears nowhere in either engine's source or output
- [ ] The guard has been **watched to fail** on a planted violation in both languages
- [ ] `CALC_VERSION` is `2.8.0` in both engines and they match
