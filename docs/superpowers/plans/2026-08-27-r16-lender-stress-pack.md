# R16 — The standard lender stress pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every appraisal a closed, spec-numbered pack of nine standard lender stresses (spec §25) run as §12.5 cells in both engines, printed in memo §10 and on the Sensitivity page; add the four levers the pack needs (`saleable_area`, `abnormal_cost`, `programme_slip`, `refi_ltv`); complete the Scenarios page's inputs; close the R15/R15b review minors — calc 2.16.0 → 2.17.0, inputs v14 → v15, with **no existing computed value moving on any document**.

**Architecture:** Four new arms in `apply_scenario` / `applyScenario` (the one shared field, `estimated_value_pence`, has a stated order: `saleable_area` then `gdv`). `_measure` / `measure` apply a cell's settings sorted by `LEVER_ORDER` so the shared pair composes identically whichever axis is the row. A new sibling module `stress_pack.py` / `stress-pack.ts` holds the closed `STRESS_PACK`, resolves each entry's settings and applicability from the base document (two entries derive their magnitude from it), and measures each as one cell through the exported `_measure` / `measure`. The v14 → v15 migration writes four zeros onto every scenario card; its identity gate compares metrics (flags strictly), ledger, schedule and — on four named fixtures — the default-config `SensitivityResult`.

**Tech Stack:** Python 3.11 / pydantic / pytest (repo root, `python -m pytest tests/ -q`); TypeScript / React / vitest (`cd frontend && npx vitest run`), `npx tsc -b`, `npx eslint . --max-warnings 0`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-08-27-r16-lender-stress-pack-design.md` (cited below as "design §N"). The calculation-specification section it produces is §25 (Task 11). **Three deliberate refinements to the design, all recorded in Task 11's spec text:** (a) fixture AA carries `kind: "sensitivity"` with a `suite: "stress_pack"` discriminator rather than a new `kind` — ~30 corpus loops in both engines skip `kind == "sensitivity"` because it already means "a suite over a base fixture, no `inputs` of its own", and a new kind would have had to be added to every one of them; (b) the four new levers' derived-input pins live in fixture AA's `expected_derived_inputs` (per stress, on bases that actually carry the blocks) rather than in fixture K, whose base F has no cost plan, network or investment case for three of them to move; (c) `scenarios.<each>.programme_slip_months` gets the same whole-months document rule §22.7 gave `sales_slip_months` — the TS engine can receive `6.5` from a number input, and a fractional slip on the network's sources is meaningless (§1.3).

## Global Constraints

- **Both engines mirror.** Every rule, message, literal, result field and lever arm lands in `app/financial_model/` and `frontend/src/lib/model/` in the same task, byte-identical where the languages allow. No calculation logic in React components or report generators (spec §11.9): a component or generator prints a published field, never a quotient, a sum or a percentage it computed itself.
- **No existing computed value moves.** Every new scenario field migrates as `0`; every new lever is the identity at `0` (`x * 1.0 === x`, `money_round(v * 1.0) === v`, `pct + 0 === pct`); sorted application in `_measure` changes nothing for nine levers that write disjoint fields. Every golden pin is asserted unchanged; the v14 → v15 gate compares with no exclusion and no tolerance (design §2, §10).
- **Half-up rounding only:** Python `money_round` (`app/financial_model/engine.py:18`), never builtin `round()`; TS `Math.round`. The 12-dp rounding of a derived setting is `money_round(x * 1e12) / 1e12` / `Math.round(x * 1e12) / 1e12` — the same expression `package_timing.py:105` / `package-timing.ts:64` already use for the midpoint.
- **`null`/`None` means unknown; `0` means known zero** (spec §1.5). An inapplicable stress is *measured* and *marked*, never omitted (design decision 10).
- **Messages and notes:** ASCII only — hyphen `-`, never `—` or `§` — and never interpolate a float; floor to a whole number first so both engines print identical text.
- **Locate by content, not by line number.** Line numbers cited were true at plan time and drift as tasks land. Verify every field name against the source before using it.
- **Version bump** (`CALC_VERSION = "2.17.0"` in `app/financial_model/types.py` and `frontend/src/lib/model/finance-types.ts`) happens in Task 11 with the spec edit, because `spec-versions.test.ts` requires the spec to contain the current calc version. The §1.6 inputs-version list gains `v15` in Task 4 (one line), because `spec-versions.test.ts` derives the newest version from `migrate.ts` and fails the moment `migrateInputsToV15` exists.
- **Foreground only.** Run every command in the foreground; no background monitors, no `&`, no `run_in_background`.
- Commit messages: `feat(r16): …`, `test(r16): …`, `docs(r16): …`, `fix(r16): …`, each ending with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## File structure

| File | Responsibility |
|---|---|
| `app/financial_model/types.py`, `frontend/src/lib/conversion-types.ts`, `frontend/src/lib/model/finance-types.ts` | `ScenarioOverrides` gains four fields; `CalculatorInputsV15`; `AnyCalculatorInputs`; `parse_calculator_inputs` dispatch |
| `app/financial_model/sensitivity.py`, `frontend/src/lib/model/sensitivity.ts` | thirteen-lever `SensitivityLever` / `LEVER_ORDER`; zero scenario and single-lever builders; sorted application in `_measure` / `measure` (exported, with `_LeverSetting` / `LeverSetting`); §12.6's `programme_slip` whole-months rule |
| `app/financial_model/apply_scenario.py`, `frontend/src/lib/model/apply-scenario.ts` | four new lever arms; `saleable_area` before `gdv` |
| `app/financial_model/stress_pack.py` (new), `frontend/src/lib/model/stress-pack.ts` (new) | `STRESS_PACK`, `resolve_stress` / `resolveStress`, `run_stress_pack` / `runStressPack`, result dataclasses/interfaces |
| `app/financial_model/validation.py`, `frontend/src/lib/model/validation.ts` | the `programme_slip_months` whole-months rule beside `sales_slip_months`'s |
| `app/financial_model/migrate.py`, `frontend/src/lib/model/migrate.ts`, `frontend/src/lib/conversion-defaults.ts` | `is_v15`/`isV15`, `_v15_scenarios`, `migrate_v14_to_v15`/`migrateV14toV15`, `migrate_inputs_to_v15`/`migrateInputsToV15`, `defaultCalculatorInputsV15`, `DEFAULT_SCENARIOS`; entry-point cutover in `ConversionCalculator.tsx`, `ExportPage.tsx`, `report-qa/memo-fixtures.ts`, `__fixtures__/cost-plan-in-time-docs.ts`, `__fixtures__/due-diligence-docs.ts`, `app/api/app.py` |
| `tests/test_migrate_v15.py` (new), `frontend/src/lib/model/migrate.test.ts` | the identity gate |
| `fixtures/financial-model/aa-stress-pack.json` (new) | Fixture AA: the pack over bases Y and U |
| `tests/test_financial_model_fixtures.py`, `frontend/src/lib/model/golden-fixtures.test.ts` | roster entry; the AA loaders |
| `tests/test_accessor_guard.py` | the lever-order parity gate beside the `FlagCode` gate |
| `frontend/src/lib/sensitivity-format.ts`, `frontend/src/lib/safe-sensitivity.ts` | labels/units for the four levers; `SCENARIO_FIELD`; `safeRunStressPack` |
| `frontend/src/components/calculator/SensitivityPage.tsx`, `ScenariosPage.tsx` (+ new `ScenariosPage.test.tsx`) | the stress panel; nine inputs, the phase picker, §12.7 on the card |
| `frontend/src/lib/export-investment-memo.ts`, `frontend/src/lib/report-qa/memo-release-gate.test.ts` | §10 stress table; comparison settings rows + §12.7; minor 1 (`fmt`); minor 6 (labels) |
| `frontend/src/lib/model/curves.ts`, `app/financial_model/curves.py`, `frontend/src/lib/model/cost-plan.ts` | minor 4 |
| `fixtures/financial-model/s-dated-programme.json` | minor 5 (the `note` only) |
| `docs/financial-model/*.md`, `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` | Task 11 (spec §25 + amendments, migration notes §18, governance §3.1 + §12, release plan); Task 6 (test-cases §25) |

---

## Hand-derived figures (Tasks 2, 5, 6)

All derived **before** any engine runs, from the fixture JSON and the spec's arithmetic. Every figure below is an input-side or closed-form figure; the pack's full appraisal metrics are **identity-asserted** (design §12, fixture K's rule), never pasted from engine output.

### Base Y — `y-due-diligence.json` (migrated to the current version)

| Fact | Value | Source |
|---|---|---|
| Proposed units | 4: `u1` 80 sqm / 25,000,000p; `u2` 95 / 30,000,000; `u3` 55 / 17,500,000; `u4` 75 / 21,000,000 | `inputs.unit_mix.units` |
| Cost plan | `detailed`; packages `pkg-structure` 12,000,000, `pkg-envelope` 8,000,000, `pkg-mande` 6,000,000, all `contingency_class: general`, all eligible; classes general 5 / existing_building 0 / abnormal 0; two fixed fee lines | `inputs.cost_plan` |
| `base_build_pence` | 26,000,000 (Σ packages) | §16.3 |
| Programme | network of 7 phases; the only phase with `predecessors: []` is `acquisition` | `inputs.programme.phases` |
| Unit-sales ledger | 4 rows | `inputs.unit_sales.units` |
| Investment case | `null` | |
| Assessed DD items (red/amber) | `dd-planning_conditions` amber 250,000p / 1 mo; `dd-title_report` red 1,500,000p / 3 mo; `dd-structural_survey` amber null / null; `dd-procurement_contractor` amber 0p / 2 mo; `dd-custom-basement` amber 800,000p / 1 mo | `inputs.due_diligence.items` |
| `Σcost` | 250,000 + 1,500,000 + 0 + 800,000 = **2,550,000** over 4 items with a non-null cost (`stated_item_count` 4) | §25.3 |
| `Σmonths` / max | 1 + 3 + 2 + 1 = **7**; max **3** | §25.3 |
| `cost_pct` | 2,550,000 / 26,000,000 × 100 = 9.80769230769230… → **9.807692307692** (12 dp) | §25.3 |
| Entry 1 setting | −100/4 = **−25** | §25.3 |
| Entry 1 derived inputs | areas 60 / 71.25 / 41.25 / 56.25; values 18,750,000 / 22,500,000 / 13,125,000 / 15,750,000 (all exact) | §25.1 |
| Entry 2 derived inputs (−5%) | areas 76 / 90.25 / 52.25 / 71.25; values 23,750,000 / 28,500,000 / 16,625,000 / 19,950,000 | §25.1 |
| Entry 5 derived input | `acquisition.slip_months` 0 → **6**; every other phase's `slip_months` unchanged | §25.1 |
| Entry 9 derived inputs | packages × 1.09807692307692: 12,000,000 → 13,176,923.08 → **13,176,923**; 8,000,000 → 8,784,615.38 → **8,784,615**; 6,000,000 → 6,588,461.54 → **6,588,462**; Σ = **28,550,000** = 26,000,000 + 2,550,000 exactly (residues cancel; the §25.3 bound is ≤ 3p and is met with 0); `acquisition.slip_months` 0 → **7** | §25.3 |
| Applicability | 1, 2, 4, 5, 9 applicable; **3** inapplicable (detailed, no abnormal-tagged package); **6, 7, 8** inapplicable (no investment case) | §25.4 |

### Base U — `u-investment-case-ltv-binds.json` (migrated)

| Fact | Value | Source |
|---|---|---|
| Cost plan | `headline`; classes general 10 / existing_building 0 / abnormal 0; no fee lines; `base_build_pence` **35,000,000** | `inputs.cost_plan`, fixture note |
| Finance | `funding_source: cash`, committed facilities 0 — **unlevered**; `peak_debt_pence` 0 | `inputs.finance` |
| Programme | network; sole source `acquisition` | |
| Unit sales | `null`; 5 units, `retain_all` | |
| Investment case | `takeout.ltv_cap_pct` 55, `dscr_floor` 1.3, `icr_floor` 1.3; `valuation.cap_yield_pct` 7.5, `purchasers_costs_pct` 6.75; `stabilised_occupancy_pct` 96; four operating lines | `inputs.investment_case` |
| U's pinned take-out | `investment_value_pence` 32,407,082; `ltv_cap_pence` 17,823,895; `dscr_cap_pence` 25,814,005; `icr_cap_pence` 33,264,000; `quantum_pence` 17,823,895; `binding_constraint: ltv` | `expected_metrics` |
| DD | migrates with every item `unknown` → `Σcost` 0, `Σmonths` 0 | §23.10 |
| Entry 3 derived input | abnormal class `pct` 0 → **10**; base = the whole build in headline mode (§16.3), so the class's `amount_pence` is 35,000,000 × 10% = **3,500,000** and `contingency_total_pence` rises by exactly that; `cost_before_finance_pence` and `total_development_cost_pence` rise by 3,500,000 (no fee line, no facility, no VAT registration — the implementer confirms each from the fixture before pinning) and `profit_pence` falls by 3,500,000 from U's pinned profit | §16.3, §3.2 |
| Entry 7 derived input | `ltv_cap_pct` 55 → **45**; `ltv_cap_pence` = floor(32,407,082 × 45 / 100) = floor(14,583,186.9) = **14,583,186** (§19.4's floor); DSCR and ICR caps unchanged, so `quantum_pence` **14,583,186**, still `ltv`-bound | §19.4 |
| Applicability | 3, 6, 7, 8 applicable; **1, 2** applicable (5 units; entry 1 runs −20); **4** inapplicable (no ledger); **5** applicable (network); **9** inapplicable on both halves (Σcost 0, Σmonths 0) | §25.4 |

### The shared-field pair (Task 2)

On a unit value of **1,000,005p** with `saleable_area = −10` and `gdv = +10`: area first gives `round(1,000,005 × 0.9) = round(900,004.5) = 900,005`, then `round(900,005 × 1.1) = round(990,005.5) = 990,006`; gdv first gives `round(1,100,005.5) = 1,100,006`, then `round(1,100,006 × 0.9) = round(990,005.4) = 990,005`. The stated order (design decision 4) is area first: **990,006**. Both engines' rounding was checked on this value at design time (`floor(x + 0.5)` and `Math.round` agree; the products are `990005.5000000001` and `990005.4` in IEEE double in both runtimes).

---

### Task 1: Types, defaults, the thirteen-lever order, presentation labels, the parity gate

**Files:**
- Modify: `app/financial_model/types.py` (`ScenarioOverrides`), `frontend/src/lib/conversion-types.ts` (`ScenarioOverrides`), `frontend/src/lib/conversion-defaults.ts` (`DEFAULT_SCENARIOS`)
- Modify: `app/financial_model/sensitivity.py` (`SensitivityLever`, `LEVER_ORDER`), `frontend/src/lib/model/sensitivity.ts` (same)
- Modify: `frontend/src/lib/sensitivity-format.ts` (`LEVER_LABEL`, `LEVER_SHORT`, `decimalsFor`, `formatStepLabel`, `formatRangeLabel`)
- Modify: every TS literal of `ScenarioOverrides` that `tsc -b` reports (test files, `__fixtures__/investment-case-docs.ts`, `sensitivity.ts`'s `ZERO_SCENARIO`/`overridesFor` — Task 3 fills those two properly; here just add the four zeros so the build is green)
- Test: `tests/test_accessor_guard.py` (new lever-parity gate), `tests/test_financial_model_sensitivity.py::test_lever_order_matches_the_spec`, `frontend/src/lib/sensitivity-format.test.ts`

**Interfaces:**
- Produces (Python): `ScenarioOverrides.saleable_area_adjustment_pct: float = 0.0`, `.abnormal_cost_adjustment_pct: float = 0.0`, `.programme_slip_months: int = 0`, `.refi_ltv_adjustment_pct: float = 0.0`; `SensitivityLever` and `LEVER_ORDER` = the nine existing followed by `"saleable_area", "abnormal_cost", "programme_slip", "refi_ltv"`.
- Produces (TS): the same four **required** fields on `ScenarioOverrides` (`sales_slip_months` is required; these follow it); `SensitivityLever` / `LEVER_ORDER` extended identically; `LEVER_LABEL` = `'Saleable area'`, `'Abnormal cost'`, `'Programme slip'`, `'Refinance LTV'`; `LEVER_SHORT` = `'Area'`, `'Abnormal'`, `'Prog. slip'`, `'Refi LTV'`.
- Units for formatting: `saleable_area` percent (like `gdv`); `abnormal_cost` and `refi_ltv` percentage points to 1 dp (like `interest_rate`); `programme_slip` months (like `timeline`).

- [ ] **Step 1: Write the failing parity test (Python)**

In `tests/test_accessor_guard.py`, after `test_the_flag_code_parity_guard_names_the_side_that_is_short`, add:

```python
SENSITIVITY_TS = (
    Path(__file__).resolve().parents[1]
    / "frontend" / "src" / "lib" / "model" / "sensitivity.ts"
)


def _ts_lever_order() -> list[str]:
    """The members of `LEVER_ORDER` in sensitivity.ts, in source order."""
    source = SENSITIVITY_TS.read_text(encoding="utf-8")
    start = source.index("export const LEVER_ORDER")
    end = source.index("];", start)
    body = re.sub(r"//[^\n]*", "", source[start:end])
    return re.findall(r"'([a-z_]+)'", body)


def test_the_lever_order_is_identical_in_both_engines():
    """R16 spec Sec 25.1. LEVER_ORDER is the Sec 12.4 tie-break AND, from
    R16, the order `_measure`/`measure` apply a cell's settings in -- so the
    two engines must agree on it member for member and position for
    position, not merely as sets."""
    from app.financial_model.sensitivity import LEVER_ORDER
    ts = _ts_lever_order()
    assert ts, "parsed no members out of the TypeScript LEVER_ORDER"
    assert list(LEVER_ORDER) == ts, (
        "LEVER_ORDER has drifted between the engines:\n"
        f"  Python: {list(LEVER_ORDER)}\n  TypeScript: {ts}"
    )
    assert len(LEVER_ORDER) == 13
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_accessor_guard.py::test_the_lever_order_is_identical_in_both_engines -q`
Expected: FAIL on `len(LEVER_ORDER) == 13` (both engines still carry nine).

- [ ] **Step 3: Add the four fields and the four levers in both engines**

`app/financial_model/types.py`, `class ScenarioOverrides`, after `sales_slip_months: int = 0`:

```python
    # R16 spec Sec 25.1. Four levers for the standard lender stress pack.
    # Defaulted so every existing construction site and fixture keeps
    # parsing; the v15 MIGRATION writes them explicitly anyway (Sec 25.7),
    # which is what the identity gate actually asserts.
    saleable_area_adjustment_pct: float = 0.0
    abnormal_cost_adjustment_pct: float = 0.0
    programme_slip_months: int = 0
    refi_ltv_adjustment_pct: float = 0.0
```

`frontend/src/lib/conversion-types.ts`, `interface ScenarioOverrides`, after `sales_slip_months: number;`:

```ts
  /** R16 spec §25.1. Percent, scaling every unit's `floor_area_sqm` AND
   *  `estimated_value_pence` (value at constant £/sqm). Composes with `gdv` on
   *  the value: applied FIRST, then `gdv`, each rounding once. */
  saleable_area_adjustment_pct: number;
  /** Percentage POINTS added to the `abnormal` contingency class's `pct`. */
  abnormal_cost_adjustment_pct: number;
  /** Whole months added to `slip_months` of every phase with no predecessors
   *  (the network's sources), so the delay cascades once. */
  programme_slip_months: number;
  /** Percentage POINTS SUBTRACTED from `investment_case.takeout.ltv_cap_pct`,
   *  so a POSITIVE value is the adverse move (vacancy's convention). */
  refi_ltv_adjustment_pct: number;
```

`frontend/src/lib/conversion-defaults.ts`, each of the four `DEFAULT_SCENARIOS` entries, after `sales_slip_months: 0,`:

```ts
    saleable_area_adjustment_pct: 0,
    abnormal_cost_adjustment_pct: 0,
    programme_slip_months: 0,
    refi_ltv_adjustment_pct: 0,
```

`app/financial_model/sensitivity.py`:

```python
SensitivityLever = Literal[
    "gdv", "construction_cost", "timeline", "interest_rate", "phase_slip",
    "exit_yield", "operating_cost", "vacancy", "sales_slip",
    "saleable_area", "abnormal_cost", "programme_slip", "refi_ltv",
]

# ... existing comment; add:
# R16 spec Sec 25.1 appends the four stress-pack levers, last again -- and
# from R16 this order is ALSO the order _measure applies a cell's settings in
# (Sec 12.1's composition rule for saleable_area -> gdv).
LEVER_ORDER: tuple[SensitivityLever, ...] = (
    "gdv", "construction_cost", "timeline", "interest_rate", "phase_slip",
    "exit_yield", "operating_cost", "vacancy", "sales_slip",
    "saleable_area", "abnormal_cost", "programme_slip", "refi_ltv",
)
```

`frontend/src/lib/model/sensitivity.ts`: the same four members appended to the `SensitivityLever` union and to `LEVER_ORDER`, with the same comment in TS form.

- [ ] **Step 4: Labels and units in `sensitivity-format.ts`**

`LEVER_LABEL` gains `saleable_area: 'Saleable area'`, `abnormal_cost: 'Abnormal cost'`, `programme_slip: 'Programme slip'`, `refi_ltv: 'Refinance LTV'`. `LEVER_SHORT` gains `saleable_area: 'Area'`, `abnormal_cost: 'Abnormal'`, `programme_slip: 'Prog. slip'`, `refi_ltv: 'Refi LTV'`. Then:

```ts
function decimalsFor(lever: SensitivityLever): number {
  return lever === 'interest_rate' || lever === 'exit_yield' || lever === 'vacancy'
    || lever === 'abnormal_cost' || lever === 'refi_ltv' ? 1 : 0;
}

const PERCENT_LEVERS: readonly SensitivityLever[] = ['gdv', 'construction_cost', 'operating_cost', 'saleable_area'];
const MONTH_LEVERS: readonly SensitivityLever[] = ['timeline', 'phase_slip', 'sales_slip', 'programme_slip'];

export function formatStepLabel(lever: SensitivityLever, step: number): string {
  const text = signed(step, decimalsFor(lever));
  if (PERCENT_LEVERS.includes(lever)) return `${text}%`;
  if (MONTH_LEVERS.includes(lever)) return `${text} months`;
  return `${text} pp`;
}

export function formatRangeLabel(lever: SensitivityLever, low: number, high: number): string {
  const d = decimalsFor(lever);
  if (PERCENT_LEVERS.includes(lever)) return `${signed(low, d)}% to ${signed(high, d)}%`;
  const unit = MONTH_LEVERS.includes(lever) ? 'months' : 'pp';
  return `${signed(low, d)} to ${signed(high, d)} ${unit}`;
}
```

(The existing `if` chains are replaced by the two lists; the existing outputs for the nine levers are unchanged — `sensitivity-format.test.ts` pins them.) Add to `sensitivity-format.test.ts`:

```ts
it('R16: formats the four stress-pack levers in their own units (spec §25.1)', () => {
  expect(formatStepLabel('saleable_area', -25)).toBe('-25%');
  expect(formatStepLabel('abnormal_cost', 10)).toBe('+10.0 pp');
  expect(formatStepLabel('programme_slip', 6)).toBe('+6 months');
  expect(formatStepLabel('refi_ltv', 10)).toBe('+10.0 pp');
  expect(formatRangeLabel('programme_slip', -3, 3)).toBe('-3 to +3 months');
  expect(formatRangeLabel('saleable_area', -10, 0)).toBe('-10% to +0%');
});
```

- [ ] **Step 5: Make `tsc -b` green**

Run `cd frontend && npx tsc -b`. Every `ScenarioOverrides` literal it reports (expect: `sensitivity.ts` `ZERO_SCENARIO` and `overridesFor`; `__fixtures__/investment-case-docs.ts` `ZERO`; `apply-scenario.test.ts`, `golden-fixtures.test.ts`, `sensitivity.test.ts`, `migrate.test.ts` literals; `report-qa/memo-fixtures.ts` if it builds cards) gains the four zero fields. In `overridesFor` add the four as `: 0` for now — Task 3 wires them. Do **not** change any behaviour in this task.

- [ ] **Step 6: Update the Python lever-order test, run everything**

`tests/test_financial_model_sensitivity.py::test_lever_order_matches_the_spec` pins the tuple — extend its expected list with the four names in order.

Run: `python -m pytest tests/test_accessor_guard.py tests/test_financial_model_sensitivity.py -q` → PASS.
Run: `cd frontend && npx tsc -b && npx vitest run src/lib/sensitivity-format.test.ts src/lib/model/sensitivity.test.ts` → PASS.
Run the full gates: `python -m pytest tests/ -q`; `cd frontend && npx vitest run && npx eslint . --max-warnings 0` → all green (no pin moved: the fields default to their identities).

- [ ] **Step 7: Commit**

```bash
git add app/financial_model/types.py app/financial_model/sensitivity.py frontend/src/lib/conversion-types.ts frontend/src/lib/conversion-defaults.ts frontend/src/lib/model/sensitivity.ts frontend/src/lib/sensitivity-format.ts frontend/src/lib/sensitivity-format.test.ts tests/test_accessor_guard.py tests/test_financial_model_sensitivity.py frontend/src/lib/model/__fixtures__/investment-case-docs.ts frontend/src/lib/model/*.test.ts frontend/src/lib/report-qa/memo-fixtures.ts
git commit -m "feat(r16): four stress-pack lever fields and the thirteen-lever order, both engines; lever-order parity gate"
```

---

### Task 2: The four lever arms in `apply_scenario` / `applyScenario`

**Files:**
- Modify: `app/financial_model/apply_scenario.py`, `frontend/src/lib/model/apply-scenario.ts`
- Modify: `tests/fixtures_investment_case.py` (`_ZERO_OVERRIDES`, `_LEVER_FIELD`), `frontend/src/lib/model/__fixtures__/investment-case-docs.ts` (`LEVER_STEPS`)
- Test: `tests/test_financial_model_apply_scenario.py`, `frontend/src/lib/model/apply-scenario.test.ts`

**Interfaces:**
- Consumes: the four `ScenarioOverrides` fields (Task 1); `money_round` (`app/financial_model/engine.py`); `ProgrammeNetwork.phases[].predecessors` (`types.py`); `ContingencyClass.name`; `TakeoutInputs.ltv_cap_pct`.
- Produces: `apply_scenario` / `applyScenario` honouring all thirteen levers with `saleable_area` applied to `estimated_value_pence` **before** `gdv` inside one call.

- [ ] **Step 1: Write the failing tests (Python)**

Append to `tests/test_financial_model_apply_scenario.py` (imports at the top already provide `apply_scenario`, `run_appraisal`, `ScenarioOverrides`, `ic_doc`, `unit_sales_doc`, `doc_z`; add `from .fixtures_due_diligence import dd_doc` — `dd_doc()` is fixture Y as a parsed document):

```python
def _r16(**fields) -> ScenarioOverrides:
    return ScenarioOverrides(label="r16", gdv_adjustment_pct=0, construction_cost_adjustment_pct=0,
                             timeline_adjustment_months=0, interest_rate_adjustment_pct=0, **fields)


def test_saleable_area_scales_area_and_value_and_leaves_ancillary_alone():
    doc = dd_doc()  # fixture Y: u1 80 sqm / 25,000,000p ... (plan table "Base Y")
    out = apply_scenario(doc, _r16(saleable_area_adjustment_pct=-25))
    areas = [u.floor_area_sqm for u in out.unit_mix.units]
    values = [u.estimated_value_pence for u in out.unit_mix.units]
    assert areas == [60.0, 71.25, 41.25, 56.25]
    assert values == [18_750_000, 22_500_000, 13_125_000, 15_750_000]
    for before, after in zip(doc.unit_mix.units, out.unit_mix.units):
        assert after.ancillary == before.ancillary


def test_saleable_area_then_gdv_is_the_stated_composition_order():
    """Spec Sec 12.1 / design decision 4. On 1,000,005p the two orders differ
    by a penny: area-first gives 990,006, gdv-first 990,005. The stated order
    is area first."""
    doc = ic_doc()
    doc.unit_mix.units[0].estimated_value_pence = 1_000_005
    out = apply_scenario(doc, _r16(saleable_area_adjustment_pct=-10, gdv_adjustment_pct=10))
    assert out.unit_mix.units[0].estimated_value_pence == 990_006


def test_abnormal_cost_adds_points_to_the_abnormal_class_only():
    doc = dd_doc()
    out = apply_scenario(doc, _r16(abnormal_cost_adjustment_pct=10))
    by_name = {c.name: c.pct for c in out.cost_plan.contingency}
    assert by_name == {"general": 5.0, "existing_building": 0.0, "abnormal": 10.0}


def test_programme_slip_slips_only_the_network_sources():
    doc = dd_doc()  # sole source: acquisition
    out = apply_scenario(doc, _r16(programme_slip_months=6))
    slips = {p.id: p.slip_months for p in out.programme.phases}
    assert slips["acquisition"] == 6
    assert all(v == 0 for k, v in slips.items() if k != "acquisition")


def test_programme_slip_is_additive_with_phase_slip_on_a_source():
    doc = dd_doc()
    out = apply_scenario(doc, _r16(programme_slip_months=6, phase_slip_phase_id="acquisition", phase_slip_months=2))
    assert {p.id: p.slip_months for p in out.programme.phases}["acquisition"] == 8


def test_refi_ltv_subtracts_from_the_take_out_cap():
    doc = ic_doc()  # the investment-case builder (tests/fixtures_investment_case.py)
    out = apply_scenario(doc, _r16(refi_ltv_adjustment_pct=10))
    assert out.investment_case.takeout.ltv_cap_pct == doc.investment_case.takeout.ltv_cap_pct - 10


def test_the_four_new_levers_are_no_ops_at_zero_and_on_absent_blocks():
    for doc in (ic_doc(), unit_sales_doc(), dd_doc(), doc_z()):
        assert apply_scenario(doc, _r16()).model_dump() == doc.model_dump()
    # A document with no investment case, no network and a headline cost plan
    # with no packages: the arms write nothing.
    doc = ic_doc({"investment_case": None})
    out = apply_scenario(doc, _r16(refi_ltv_adjustment_pct=10))
    assert out.model_dump() == doc.model_dump()
```

Then extend the order-independence test. In `tests/fixtures_investment_case.py`, `_LEVER_FIELD` gains:

```python
    # R16 spec Sec 25.1. The four stress-pack levers.
    "saleable_area": "saleable_area_adjustment_pct",
    "abnormal_cost": "abnormal_cost_adjustment_pct",
    "programme_slip": "programme_slip_months",
    "refi_ltv": "refi_ltv_adjustment_pct",
```

and `test_keeps_all_nine_levers_order_independent` becomes `test_keeps_all_thirteen_levers_order_independent` with the four appended to each of its three orders **but `saleable_area` and `gdv` in the same relative order (area before gdv) in every list** — the pair is order-*dependent* by design; the test's docstring says so and names the composition test above as the pair's own pin. Add a fourth order that swaps the pair and asserts the result **differs** on `ic_doc()` after setting `doc.unit_mix.units[0].estimated_value_pence = 1_000_005` (the R11 rule: a test must be able to fail).

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/test_financial_model_apply_scenario.py -q -k "saleable or abnormal or programme_slip or refi or thirteen or four_new"`
Expected: FAIL — the arms do not exist, so areas/values/pct/slips are unchanged.

- [ ] **Step 3: Implement the Python arms**

In `apply_scenario.py`, replace the unit loop and add three arms:

```python
    gdv_multiplier = 1 + overrides.gdv_adjustment_pct / 100
    cost_multiplier = 1 + overrides.construction_cost_adjustment_pct / 100
    # R16 spec Sec 25.1. saleable_area scales AREA (exact, a float) and VALUE
    # (rounded once); it composes with gdv on the value, and the stated order
    # (Sec 12.1) is saleable_area FIRST, then gdv, each rounding once.
    area_multiplier = 1 + overrides.saleable_area_adjustment_pct / 100

    out = inputs.model_copy(deep=True)

    for unit in out.unit_mix.units:
        unit.floor_area_sqm = unit.floor_area_sqm * area_multiplier
        after_area = money_round(unit.estimated_value_pence * area_multiplier)
        unit.estimated_value_pence = money_round(after_area * gdv_multiplier)
        # ... existing ancillary block unchanged (a GDV stress moves ancillary
        # VALUE; an area stress moves neither ancillary area nor value, Sec 15.5).
```

After the package loop inside `if cost_plan is not None:` add:

```python
        # R16 spec Sec 25.1. abnormal_cost adds percentage POINTS to the
        # abnormal class only. Headline mode gives every class the whole
        # base build (Sec 16.3); detailed mode scopes it to the abnormal-
        # tagged packages, so on a plan with none tagged this is a no-op by
        # construction -- the stress pack marks that (Sec 25.4).
        for c in cost_plan.contingency:
            if c.name == "abnormal":
                c.pct += overrides.abnormal_cost_adjustment_pct
```

In the programme loop:

```python
        for phase in programme.phases:
            if phase.id == overrides.phase_slip_phase_id:
                phase.slip_months += overrides.phase_slip_months
            # R16 spec Sec 25.1. programme_slip slips every phase with no
            # predecessors -- the network's sources -- so the delay cascades
            # through the dependencies once rather than once per edge.
            # Additive with phase_slip on the same field (Sec 12.1).
            if not phase.predecessors:
                phase.slip_months += overrides.programme_slip_months
```

In the investment-case block, after `cap_yield_pct += ...`:

```python
        # R16 spec Sec 25.1. refi_ltv SUBTRACTS percentage points from the
        # take-out's LTV cap (Sec 19.4 sizes on it), so a positive value is
        # the adverse move -- vacancy's convention.
        investment_case.takeout.ltv_cap_pct -= overrides.refi_ltv_adjustment_pct
```

- [ ] **Step 4: Run the Python tests**

Run: `python -m pytest tests/test_financial_model_apply_scenario.py tests/test_financial_model_fixtures.py -q` → PASS (every golden pin unchanged).

- [ ] **Step 5: Mirror in TS with its tests**

`frontend/src/lib/model/apply-scenario.ts`:

```ts
  const gdvMultiplier = 1 + overrides.gdv_adjustment_pct / 100;
  const costMultiplier = 1 + overrides.construction_cost_adjustment_pct / 100;
  // R16 spec §25.1 — see the Python twin's comment. Area first, then gdv.
  const areaMultiplier = 1 + overrides.saleable_area_adjustment_pct / 100;
  return {
    ...inputs,
    unit_mix: {
      units: inputs.unit_mix.units.map((u) => {
        const afterArea = Math.round(u.estimated_value_pence * areaMultiplier);
        return {
          ...u,
          floor_area_sqm: u.floor_area_sqm * areaMultiplier,
          estimated_value_pence: Math.round(afterArea * gdvMultiplier),
          ...('ancillary' in u && u.ancillary != null ? { /* unchanged block */ } : {}),
        };
      }),
    },
```

Inside the existing `cost_plan` spread add `contingency: inputs.cost_plan.contingency.map((c) => (c.name === 'abnormal' ? { ...c, pct: c.pct + overrides.abnormal_cost_adjustment_pct } : c)),`. In the `phases.map`:

```ts
        phases: inputs.programme.phases.map((p) => ({
          ...p,
          slip_months: p.slip_months
            + (p.id === overrides.phase_slip_phase_id ? overrides.phase_slip_months : 0)
            + (p.predecessors.length === 0 ? overrides.programme_slip_months : 0),
        })),
```

In the `investment_case` spread add `takeout: { ...inputs.investment_case.takeout, ltv_cap_pct: inputs.investment_case.takeout.ltv_cap_pct - overrides.refi_ltv_adjustment_pct },`.

`__fixtures__/investment-case-docs.ts` `LEVER_STEPS` gains the four entries (same keys/fields as Python). Port the six Python tests into `apply-scenario.test.ts` under `describe('R16 — the four stress-pack levers (spec §25.1)')` using `ddDoc()` from `./__fixtures__/due-diligence-docs` and `icDoc()`; the composition test builds `{ ...icDoc(), unit_mix: { units: icDoc().unit_mix.units.map((u, i) => (i === 0 ? { ...u, estimated_value_pence: 1_000_005 } : u)) } }`. Extend `'keeps all NINE levers order-independent'` to thirteen with the same pair rule, plus the swapped-pair "differs" assertion.

Run: `cd frontend && npx vitest run src/lib/model/apply-scenario.test.ts src/lib/model/golden-fixtures.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/apply_scenario.py frontend/src/lib/model/apply-scenario.ts tests/test_financial_model_apply_scenario.py tests/fixtures_investment_case.py frontend/src/lib/model/apply-scenario.test.ts frontend/src/lib/model/__fixtures__/investment-case-docs.ts
git commit -m "feat(r16): saleable_area, abnormal_cost, programme_slip and refi_ltv lever arms, both engines; area-then-gdv composition pinned"
```

---

### Task 3: Sensitivity — builders, sorted application, §12.6, exports

**Files:**
- Modify: `app/financial_model/sensitivity.py`, `frontend/src/lib/model/sensitivity.ts`
- Test: `tests/test_financial_model_sensitivity.py`, `frontend/src/lib/model/sensitivity.test.ts`

**Interfaces:**
- Produces (Python): `_zero_scenario()` and `_overrides_for()` carry the four fields; `_measure(inputs, settings)` applies `sorted(settings, key=lambda s: LEVER_ORDER.index(s.lever))`; `validate_sensitivity_config` treats `programme_slip` as a whole-months lever. `_measure` and `_LeverSetting` are importable by `stress_pack.py` (they are module-level already; no rename).
- Produces (TS): `export interface LeverSetting`, `export function measure` (both currently module-private); `ZERO_SCENARIO` / `overridesFor` carry the four; `measure` sorts by `LEVER_ORDER`; the whole-months rule includes `programme_slip`.

- [ ] **Step 1: Failing tests (both engines)**

Python, append to `tests/test_financial_model_sensitivity.py`:

```python
def test_a_cell_composes_saleable_area_before_gdv_whichever_axis_is_the_row():
    """Design decision 4 / guard 2. rows=gdv, cols=saleable_area and its
    transpose must report the same cell figures: _measure sorts settings by
    LEVER_ORDER, so the shared field is written in the stated order."""
    doc = ic_doc()
    doc.unit_mix.units[0].estimated_value_pence = 1_000_005
    a = run_sensitivity(doc, SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[10]),
        cols=SensitivityAxis(lever="saleable_area", steps=[-10]), tornado=[]))
    b = run_sensitivity(doc, SensitivityConfig(
        rows=SensitivityAxis(lever="saleable_area", steps=[-10]),
        cols=SensitivityAxis(lever="gdv", steps=[10]), tornado=[]))
    assert a.matrix[0][0].profit_pence == b.matrix[0][0].profit_pence
    # And the figure is the AREA-FIRST one: the levered document the cell
    # measured carries 990,006 on unit 0, not 990,005.
    expected = run_appraisal(apply_scenario(doc, ScenarioOverrides(
        label="", gdv_adjustment_pct=10, construction_cost_adjustment_pct=0,
        timeline_adjustment_months=0, interest_rate_adjustment_pct=0,
        saleable_area_adjustment_pct=-10))).metrics
    assert a.matrix[0][0].profit_pence == expected.profit_pence


def test_programme_slip_steps_must_be_whole_months():
    issues = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="programme_slip", steps=[1.5]),
        cols=SensitivityAxis(lever="gdv", steps=[0]),
        tornado=[TornadoRange(lever="programme_slip", low=-1.5, high=1)]))
    assert [i.message for i in issues] == [
        "programme_slip steps must be whole months.",
        "programme_slip bounds must be whole months.",
    ]


def test_the_four_new_levers_measure_as_tornado_bars_on_fixture_y():
    doc = dd_doc()
    result = run_sensitivity(doc, SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0]), cols=SensitivityAxis(lever="construction_cost", steps=[0]),
        tornado=[TornadoRange(lever="saleable_area", low=-10, high=0),
                 TornadoRange(lever="abnormal_cost", low=0, high=10),
                 TornadoRange(lever="programme_slip", low=0, high=6),
                 TornadoRange(lever="refi_ltv", low=0, high=10)]))
    spans = {b.lever: b.span_pence for b in result.tornado}
    assert spans["saleable_area"] > 0
    assert spans["programme_slip"] > 0
    assert spans["abnormal_cost"] == 0   # Y: detailed, no abnormal package -- honest zero-width bar
    assert spans["refi_ltv"] == 0        # Y: no investment case
```

(Import `dd_doc` from `.fixtures_due_diligence` and `validate_sensitivity_config`, `SensitivityAxis`, `TornadoRange`, `SensitivityConfig`, `run_sensitivity` from `app.financial_model.sensitivity` — check the file's existing import block; most are already there.)

TS: the same three tests in `sensitivity.test.ts` under `describe('R16 — thirteen levers, sorted application (spec §25.1)')`, using `ddDoc()` and `icDoc()`.

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/test_financial_model_sensitivity.py -q -k "whichever or whole_months or four_new"` → FAIL (transposed cells differ by a penny's worth of profit; no whole-months message; `overridesFor` drops the new levers so the bars are zero-width).

- [ ] **Step 3: Implement (Python)**

`_zero_scenario()` and `_overrides_for()` gain:

```python
        saleable_area_adjustment_pct=setting.value if setting.lever == "saleable_area" else 0,
        abnormal_cost_adjustment_pct=setting.value if setting.lever == "abnormal_cost" else 0,
        programme_slip_months=int(setting.value) if setting.lever == "programme_slip" else 0,
        refi_ltv_adjustment_pct=setting.value if setting.lever == "refi_ltv" else 0,
```

(the zero scenario: the same four at `0`). In `_measure`:

```python
    levered = apply_scenario(inputs, _zero_scenario())
    # R16 spec Sec 12.1: settings are applied in LEVER_ORDER, not caller
    # order. saleable_area and gdv share estimated_value_pence and the stated
    # composition is area first; sorting (stable) makes a cell identical
    # whichever axis is the row. For the nine disjoint levers this changes
    # nothing -- the v15 identity gate asserts exactly that.
    for setting in sorted(settings, key=lambda s: LEVER_ORDER.index(s.lever)):
        levered = apply_scenario(levered, _overrides_for(setting))
```

Both whole-months checks: `("timeline", "phase_slip", "sales_slip", "programme_slip")`.

- [ ] **Step 4: Implement (TS)**

`export interface LeverSetting`, `export function measure`. `ZERO_SCENARIO` / `overridesFor` gain the four (`programme_slip_months: setting.lever === 'programme_slip' ? setting.value : 0`, etc.). In `measure`:

```ts
  const ordered = [...settings].sort((a, b) => LEVER_ORDER.indexOf(a.lever) - LEVER_ORDER.indexOf(b.lever));
  const levered = ordered.reduce((doc, s) => applyScenario(doc, overridesFor(s)), applyScenario(inputs, ZERO_SCENARIO));
```

Both whole-months conditions gain `|| axis.lever === 'programme_slip'` / `range.lever === 'programme_slip'`.

- [ ] **Step 5: Run and commit**

Run: `python -m pytest tests/test_financial_model_sensitivity.py tests/test_financial_model_fixtures.py -q`; `cd frontend && npx vitest run src/lib/model/sensitivity.test.ts src/lib/model/golden-fixtures.test.ts src/lib/safe-sensitivity.test.ts` → PASS (fixture K unchanged).

```bash
git add app/financial_model/sensitivity.py frontend/src/lib/model/sensitivity.ts tests/test_financial_model_sensitivity.py frontend/src/lib/model/sensitivity.test.ts
git commit -m "feat(r16): sensitivity builders carry the four levers; cells apply settings in LEVER_ORDER; programme_slip whole-months rule"
```

---

### Task 4: Migration v14 → v15, the identity gate, the entry-point cutover, the API test

**Files:**
- Modify: `app/financial_model/types.py` (`CalculatorInputsV15`, union, dispatch), `frontend/src/lib/model/finance-types.ts` (`CalculatorInputsV15`, union)
- Modify: `app/financial_model/migrate.py`, `frontend/src/lib/model/migrate.ts`, `frontend/src/lib/conversion-defaults.ts` (`defaultCalculatorInputsV15`)
- Modify: `app/financial_model/validation.py`, `frontend/src/lib/model/validation.ts` (refinement (c))
- Modify (cutover, one commit): `frontend/src/components/ConversionCalculator.tsx`, `frontend/src/components/ExportPage.tsx`, `frontend/src/lib/report-qa/memo-fixtures.ts`, `frontend/src/lib/model/__fixtures__/cost-plan-in-time-docs.ts`, `frontend/src/lib/model/__fixtures__/due-diligence-docs.ts`, `app/api/app.py`, `docs/financial-model/calculation-specification.md` §1.6 (one line: `15` (**inputs v15**) = calc 2.17.0+ (adds the four stress-pack scenario fields, §25))
- Test: `tests/test_migrate_v15.py` (new; port of `tests/test_migrate_v14.py`), `frontend/src/lib/model/migrate.test.ts` (new `describe('v15 migration -- spec §25.7')`), `tests/test_financial_model_types.py`, `tests/test_entry_point_guard.py`, `frontend/src/lib/model/entry-point-guard.test.ts`, `frontend/src/components/ConversionCalculator.test.tsx` (`sent.inputs_version` → 15 and the four fields on `sent.scenarios.base`), `tests/test_financial_model_validation.py` (the drift guard)

**Interfaces:**
- Produces (Python): `CalculatorInputsV15(CalculatorInputsV14)` with `inputs_version: Literal[15] = 15`; `is_v15(snapshot)`; `_v15_scenarios(scenarios)`; `migrate_v14_to_v15(v14)`; `_RECOGNISED_VERSIONS_V15 = (1, …, 15)`; `migrate_inputs_to_v15(snapshot, project=None)`; `parse_calculator_inputs` branch for 15.
- Produces (TS): `CalculatorInputsV15 extends Omit<CalculatorInputsV14, 'inputs_version'> { inputs_version: 15 }`; `isV15`, `migrateV14toV15`, `migrateInputsToV15`, `RECOGNISED_INPUTS_VERSIONS_V15`; `defaultCalculatorInputsV15(project?, now?)`.
- `is_v15` / `isV15` structural check: `inputs_version === 15` AND `due_diligence` key present AND `scenarios.base` is an object carrying **all four** keys `saleable_area_adjustment_pct`, `abnormal_cost_adjustment_pct`, `programme_slip_months`, `refi_ltv_adjustment_pct`.

- [ ] **Step 1: Write `tests/test_migrate_v15.py`**

Port `tests/test_migrate_v14.py` wholesale with these substitutions: v13→v14 becomes v14→v15; the corpus filter is `"inputs" in _FIXTURE_DOCS[p]` (replacing `kind != "sensitivity"` — fixture AA arrives in Task 6 with `kind: sensitivity` and no `inputs`, and the older gates' filters still skip it by kind) and `<= 14`; `version_excluded` asserts `[]` (no v15-native golden fixture exists — AA has no inputs); the non-vacuity test becomes:

```python
def test_migration_writes_the_four_zeros_on_every_scenario():
    """Sec 25.7's one write, at the layer where it is observable: the raw
    dict. Pydantic's own defaults make it invisible again after
    model_validate -- which is exactly why the identity gate holds."""
    out = _v15_scenarios({"base": {"label": "b"}, "upside": None, "downside": {}, "severe": {"sales_slip_months": 1}})
    for key in ("base", "upside", "downside", "severe"):
        for f in ("saleable_area_adjustment_pct", "abnormal_cost_adjustment_pct", "refi_ltv_adjustment_pct"):
            assert out[key][f] == 0.0
        assert out[key]["programme_slip_months"] == 0
    assert out["severe"]["sales_slip_months"] == 1
    raw = _load_fixture(FIXTURE_DIR / "z-cost-plan-in-time.json")["inputs"]
    v15 = migrate_v14_to_v15(migrate_inputs_to_v14(raw, None))
    dumped = v15.model_dump(mode="json")
    assert dumped["inputs_version"] == 15
    assert dumped["scenarios"]["base"]["programme_slip_months"] == 0  # WRITTEN, not defaulted
    d14 = migrate_inputs_to_v14(raw, None).model_dump(mode="json")
    d14.pop("inputs_version"), d14.pop("scenarios"); dumped.pop("inputs_version"), dumped.pop("scenarios")
    assert d14 == dumped
```

Properties 2 and 3 become: property 2 — no issue whose field ends with `.programme_slip_months` on any migrated fixture; property 3 — a v15 document with `scenarios.downside.programme_slip_months = 1.5` written by hand on the raw dict yields an issue with field `scenarios.downside.programme_slip_months` and message `"Programme slip must be a whole number of months."` (in Python this is structurally unreachable through pydantic — `int` coerces or rejects — so the Python property 3 asserts the pydantic `ValidationError` instead, and the TS property 3 asserts the message; write that asymmetry in the test's docstring exactly as `validation.py`'s `sales_slip_months` comment does). Add the sensitivity comparison:

```python
SENSITIVITY_FIXTURES = ["f-dev-finance-12mo", "u-investment-case-ltv-binds", "y-due-diligence", "z-cost-plan-in-time"]


@pytest.mark.parametrize("stem", SENSITIVITY_FIXTURES)
def test_the_default_sensitivity_suite_is_identical_on_both_arms(stem):
    """Guard 5. Sorted application in _measure (Task 3) must move nothing on
    the nine disjoint levers: the default-config suite -- 34 appraisals --
    compared with strict equality on four documents spanning the corpus's
    blocks (no blocks; investment case; ledger + DD; cost plan in time)."""
    from app.financial_model.sensitivity import run_sensitivity
    raw = _load_fixture(FIXTURE_DIR / f"{stem}.json")["inputs"]
    v14 = asdict(run_sensitivity(migrate_inputs_to_v14(raw, None)))
    v15 = asdict(run_sensitivity(migrate_inputs_to_v15(raw, None)))
    assert v14 == v15
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_migrate_v15.py -q` → FAIL at import (`migrate_inputs_to_v15` does not exist).

- [ ] **Step 3: Implement the Python migration and types**

`types.py`, after `CalculatorInputsV14`:

```python
# --- Release 16 (calc 2.16.0 -> 2.17.0): the standard lender stress pack
# (spec Sec 25.7) ----------------------------------------------------------


class CalculatorInputsV15(CalculatorInputsV14):
    """Mirrors CalculatorInputsV14 with Sec 25.7's four additions, all on
    `ScenarioOverrides` (Task 1) with `0` defaults -- so nothing new is
    declared HERE. Subclasses V14 for the reason V14 subclasses V13. Twin of
    CalculatorInputsV15 in finance-types.ts."""

    inputs_version: Literal[15] = 15  # type: ignore[assignment]
```

Add `| CalculatorInputsV15` to `AnyCalculatorInputs`; in `parse_calculator_inputs`, before the `version == 14` branch: `if version == 15: return CalculatorInputsV15.model_validate(doc)`.

`migrate.py`, after `migrate_inputs_to_v14`:

```python
# --- Release 16 (calc 2.16.0 -> 2.17.0): the standard lender stress pack
# (spec Sec 25.7) ----------------------------------------------------------

_V15_SCENARIO_FIELDS: dict[str, float | int] = {
    "saleable_area_adjustment_pct": 0.0,
    "abnormal_cost_adjustment_pct": 0.0,
    "programme_slip_months": 0,
    "refi_ltv_adjustment_pct": 0.0,
}


def _v15_scenarios(scenarios: dict[str, Any] | None) -> dict[str, Any]:
    """The v14 -> v15 write: the four Sec 25.1 lever fields at their identity
    on all four scenarios. Mirrors `_v12_scenarios`: `ScenarioOverrides`
    already defaults every one of them, so only a WRITTEN value is what the
    numeric identity gate exercises."""
    out = dict(scenarios or {})
    for key in ("base", "upside", "downside", "severe"):
        s = dict(out.get(key) or {})
        for field_name, zero in _V15_SCENARIO_FIELDS.items():
            s[field_name] = zero
        out[key] = s
    return out


def is_v15(snapshot: dict[str, Any]) -> bool:
    """`inputs_version == 15` AND `due_diligence` present AND `scenarios.base`
    is a dict carrying all four Sec 25.1 keys. Port of isV15."""
    if snapshot.get("inputs_version") != 15 or "due_diligence" not in snapshot:
        return False
    scenarios = snapshot.get("scenarios")
    base = scenarios.get("base") if isinstance(scenarios, dict) else None
    return isinstance(base, dict) and all(k in base for k in _V15_SCENARIO_FIELDS)


def migrate_v14_to_v15(v14: dict[str, Any] | CalculatorInputsV14) -> CalculatorInputsV15:
    if isinstance(v14, CalculatorInputsV15):
        raise ValueError("migrate_v14_to_v15: input is already a v15 document")
    if isinstance(v14, BaseModel):
        doc = v14.model_dump(mode="json")
    else:
        if is_v15(v14):
            raise ValueError("migrate_v14_to_v15: input is already a v15 document")
        doc = dict(v14)
    doc["scenarios"] = _v15_scenarios(doc.get("scenarios"))
    doc["inputs_version"] = 15
    return CalculatorInputsV15.model_validate(doc)


_RECOGNISED_VERSIONS_V15 = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)


def migrate_inputs_to_v15(
    snapshot: dict[str, Any], project: dict[str, Any] | None = None,
) -> CalculatorInputsV15:
    """Normalises any stored snapshot (v1-v15) to v15. Port of
    migrateInputsToV15, structurally identical to migrate_inputs_to_v14."""
    version = snapshot.get("inputs_version")
    if version is not None and version not in _RECOGNISED_VERSIONS_V15:
        raise ValueError(
            f"migrate_inputs_to_v15: unrecognised inputs_version {version!r} "
            f"(expected one of {_RECOGNISED_VERSIONS_V15}, or absent for a v1 document)"
        )
    if version == 15 and not is_v15(snapshot):
        raise ValueError(
            "migrate_inputs_to_v15: inputs_version is 15 but the document fails "
            "the v15 structural check (missing `due_diligence` or the four "
            "scenario lever fields) -- refusing to silently reinterpret it via the v1 fallback path"
        )
    if is_v15(snapshot):
        defaults = migrate_v14_to_v15(migrate_inputs_to_v14({}, project)).model_dump(mode="json")
        return CalculatorInputsV15.model_validate({
            **_merge_saved_onto_defaults(defaults, snapshot),
            "inputs_version": 15,
            "areas": {**defaults["areas"], **(snapshot.get("areas") or {})},
            "cost_plan": {**defaults["cost_plan"], **(snapshot.get("cost_plan") or {})},
            "vat": {**defaults["vat"], **(snapshot.get("vat") or {})},
            "programme": snapshot.get("programme"),
            "sales_phasing": snapshot.get("sales_phasing"),
            "refinance": snapshot.get("refinance"),
            "investment_case": snapshot.get("investment_case"),
            "monitoring": snapshot.get("monitoring"),
            "unit_sales": snapshot.get("unit_sales"),
            "due_diligence": snapshot.get("due_diligence"),
        })
    return migrate_v14_to_v15(migrate_inputs_to_v14(snapshot, project))
```

**Verify before using:** `migrate_inputs_to_v14({}, project)` must produce the full default v14 document (the v14 function's `is_v14({})` is false, so it falls through the chain from `default_calculator_inputs_v2`). If `_merge_saved_onto_defaults` or the v14 chain rejects an empty dict, build `defaults` the way `migrate_inputs_to_v14` does (the nested chain) and call `migrate_v14_to_v15` on it. Also add the `validation.py` rule, immediately after the `sales_slip_months` rule inside the `for name in (...)` loop:

```python
        if scenario.programme_slip_months is not None and not isinstance(scenario.programme_slip_months, int):
            err(
                f"scenarios.{name}.programme_slip_months",
                "Programme slip must be a whole number of months.",
            )
```

and its TS twin after the `sales_slip_months` rule in `validation.ts`:

```ts
    if (scenario.programme_slip_months != null && !Number.isInteger(scenario.programme_slip_months)) {
      err(`scenarios.${name}.programme_slip_months`, 'Programme slip must be a whole number of months.');
    }
```

Run `python -m pytest tests/test_financial_model_validation.py::test_validation_messages_match_the_typescript_engine -q` after both land — the message must appear verbatim in Python.

- [ ] **Step 4: TS migration, types, defaults**

`finance-types.ts`: `CalculatorInputsV15` after `CalculatorInputsV14` (doc comment: "R16 spec §25.7. Four fields on every `ScenarioOverrides`, no new top-level field; `isV15`/`migrateV14toV15` enforce the written shape"), add to `AnyCalculatorInputs`. `migrate.ts`, after `migrateInputsToV14`:

```ts
// --- Release 16 (calc 2.16.0 -> 2.17.0): the standard lender stress pack
// (spec §25.7) -----------------------------------------------------------

const V15_SCENARIO_FIELDS = [
  'saleable_area_adjustment_pct', 'abnormal_cost_adjustment_pct', 'programme_slip_months', 'refi_ltv_adjustment_pct',
] as const;

export function isV15(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV15 {
  if (snapshot.inputs_version !== 15 || !('due_diligence' in snapshot)) return false;
  const scenarios = snapshot.scenarios as { base?: unknown } | undefined;
  const base = scenarios != null && typeof scenarios === 'object' ? scenarios.base : undefined;
  return base != null && typeof base === 'object' && V15_SCENARIO_FIELDS.every((k) => k in (base as object));
}

export function migrateV14toV15(v14: CalculatorInputsV14): CalculatorInputsV15 {
  if (isV15(v14 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV14toV15: input is already a v15 document');
  }
  const withLevers = (s: ScenarioOverrides): ScenarioOverrides => ({
    ...s,
    saleable_area_adjustment_pct: 0, abnormal_cost_adjustment_pct: 0,
    programme_slip_months: 0, refi_ltv_adjustment_pct: 0,
  });
  return {
    ...v14,
    inputs_version: 15,
    scenarios: {
      base: withLevers(v14.scenarios.base), upside: withLevers(v14.scenarios.upside),
      downside: withLevers(v14.scenarios.downside), severe: withLevers(v14.scenarios.severe),
    },
  };
}

const RECOGNISED_INPUTS_VERSIONS_V15: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function migrateInputsToV15(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV15 {
  // refusals: copy migrateInputsToV14's two, with V15 names and the message
  // '(missing `due_diligence` or the four scenario lever fields)'
  if (isV15(snapshot)) {
    const defaults = migrateV14toV15(migrateInputsToV14({}, project));
    const saved = snapshot as unknown as Partial<CalculatorInputsV15>;
    return { /* the same merge block migrateInputsToV14 uses, with inputs_version: 15 */ };
  }
  return migrateV14toV15(migrateInputsToV14(snapshot, project));
}
```

Copy the merge block from `migrateInputsToV14` verbatim (it merges every top-level block and the four scenario cards onto defaults) — the only differences are `inputs_version: 15` and `defaults` being the v15 default. `conversion-defaults.ts`:

```ts
export function defaultCalculatorInputsV15(project?: DefaultDocumentProject, now?: Date): CalculatorInputsV15 {
  return migrateV14toV15(defaultCalculatorInputsV14(project, now));
}
```

(`DEFAULT_SCENARIOS` already carries the four zeros from Task 1, so `migrateV14toV15` on the default is a rewrite of the same values — that is fine; check `conversion-defaults.ts` imports from `./model/migrate` without a cycle; if it does not already, import `migrateV14toV15` the way `defaultCalculatorInputsV14` obtains what it needs, or build the object by spreading the four zeros directly.)

- [ ] **Step 5: The TS gate**

Add `describe('v15 migration -- spec §25.7')` to `migrate.test.ts`, ported from the v14 block: filter `'inputs' in doc && versionOf(doc) <= 14`; `versionExcluded` `[]`; metrics/model/schedule strict on every fixture; the four-zeros write test; properties 1–3 (property 3 in TS: `scenarios.downside.programme_slip_months = 1.5` → the message); `isV15` spoof test (a v14 document relabelled 15 without the keys is `false`); refusals; **and** the sensitivity comparison on the four named fixtures:

```ts
  for (const stem of ['f-dev-finance-12mo', 'u-investment-case-ltv-binds', 'y-due-diligence', 'z-cost-plan-in-time']) {
    it(`${stem}: the default sensitivity suite is identical on both arms (guard 5)`, () => {
      const raw = fixtureDocs.find(({ file }) => file === `${stem}.json`)!.doc.inputs!;
      expect(runSensitivity(migrateInputsToV15(raw))).toEqual(runSensitivity(migrateInputsToV14(raw)));
    });
  }
```

- [ ] **Step 6: The cutover, in this same commit**

Move every production reader to v15: `ConversionCalculator.tsx` (`migrateInputsToV14` → `migrateInputsToV15`, `CalculatorInputsV14` → `CalculatorInputsV15`, `defaultCalculatorInputsV14` → `defaultCalculatorInputsV15`), `ExportPage.tsx`, `memo-fixtures.ts` (`dueDiligenceInputs`, `dueDiligenceFinalInputs`, `costPlanInTimeInputs`, `costPlanInTimeNoAllowanceInputs` return `CalculatorInputsV15` via `migrateInputsToV15`; the deliberately version-pinned builders stay), `__fixtures__/cost-plan-in-time-docs.ts` and `__fixtures__/due-diligence-docs.ts` (`ddDoc` returns `CalculatorInputsV15`), `app/api/app.py` (`migrate_inputs_to_v15(raw)`; update the comment that names the version chain). Every page that types `inputs: CalculatorInputsV14` (`ScenariosPage.tsx` and any other `tsc` reports) moves to `CalculatorInputsV15`. `ConversionCalculator.test.tsx`: `sent.inputs_version` → `15`; add `expect(sent.scenarios.base.programme_slip_months).toBe(0)` with the type widened. `tests/test_financial_model_types.py`: add `_minimal_v15_doc` and `test_parse_dispatch_routes_v15_to_v15` mirroring the v14 pair. Spec §1.6: the one line.

The entry-point guards (`tests/test_entry_point_guard.py`, `entry-point-guard.test.ts`) discover the newest version from `migrate.py`/`migrate.ts` and fail until every non-exempt production file calls only it — run them and fix what they name. Update `test_the_server_round_trips_a_native_v14_document_as_reconciled` to v15 (`migrate_inputs_to_v15`, `inputs_version == 15`, assert `posted_inputs["scenarios"]["base"]["programme_slip_months"] == 0` survives).

- [ ] **Step 7: Guard 9 — fixture Z through the API**

Append to `tests/test_entry_point_guard.py`:

```python
@pytest.mark.asyncio
async def test_fixture_z_posts_with_a_live_inflation_allowance_and_a_negative_one_is_422(_guard_client):
    """R16 minor 2 (design §14). Fixture Z carries `qs.inflation.annual_pct: 6`
    -- the first golden document with a LIVE allowance -- and has never been
    posted through the API. Two arms: the allowance survives the round trip
    (201), and a negative rate is refused at the pydantic boundary
    (InflationAllowance.annual_pct is Field(ge=0)) with a 422, not a 500."""
    fixture = json.loads((REPO_ROOT / "fixtures" / "financial-model" / "z-cost-plan-in-time.json").read_text(encoding="utf-8"))
    posted = migrate_inputs_to_v15(fixture["inputs"], None).model_dump(mode="json")
    assert posted["cost_plan"]["qs"]["inflation"] == {"annual_pct": 6.0}
    project_resp = await _guard_client.post("/api/v1/projects", json={
        "address_raw": "6 Base Date Row, York, YO1 8AN", "price_pence": 100_000_000, "use_class": "office"})
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]
    ok = await _guard_client.post("/api/v1/appraisals", json={
        "project_id": project_id, "name": "Z -- live allowance", "inputs_snapshot": posted})
    assert ok.status_code == 201, ok.text
    assert ok.json()["inputs_snapshot"]["cost_plan"]["qs"]["inflation"] == {"annual_pct": 6.0}
    bad = json.loads(json.dumps(posted))
    bad["cost_plan"]["qs"]["inflation"] = {"annual_pct": -1}
    refused = await _guard_client.post("/api/v1/appraisals", json={
        "project_id": project_id, "name": "Z -- negative allowance", "inputs_snapshot": bad})
    assert refused.status_code == 422, refused.text
```

(Confirm `fixture["inputs"]["cost_plan"]["qs"]["inflation"]["annual_pct"]` is `6` in `z-cost-plan-in-time.json` before writing the literal; test-cases §24.1 says so.)

- [ ] **Step 8: Run the full gates, commit**

`python -m pytest tests/ -q`; `cd frontend && npx tsc -b && npx vitest run && npx eslint . --max-warnings 0 && npm run build` → all green.

```bash
git add -A app/financial_model frontend/src tests docs/financial-model/calculation-specification.md
git commit -m "feat(r16): inputs v15 - four scenario lever fields written by migration; identity gate incl. the sensitivity suite; entry-point cutover; fixture Z through the API"
```

---

### Task 5: The stress pack, both engines

**Files:**
- Create: `app/financial_model/stress_pack.py`, `frontend/src/lib/model/stress-pack.ts`
- Test: `tests/test_financial_model_stress_pack.py` (new), `frontend/src/lib/model/stress-pack.test.ts` (new)

**Interfaces:**
- Consumes: `_measure`, `_LeverSetting`, `LEVER_ORDER`, `InvalidBaseDocumentError`, `SensitivityMetrics` (`sensitivity.py`); `measure`, `LeverSetting`, `InvalidBaseDocumentError`, `SensitivityMetrics`, `MeasuredMetrics` (`sensitivity.ts`); `compute_cost_plan`, `developed_area_sqm` (`app.financial_model`, imported lazily); `computeCostPlan`, `developedAreaSqm` (`./index`); `ProgrammeNetwork` (Python `isinstance`), `isProgrammeNetwork` (`./programme`); `money_round`.
- Produces (both): `STRESS_PACK` (nine `StressDefinition`s in normative order), `resolve_stress(inputs, definition)` / `resolveStress`, `run_stress_pack(inputs)` / `runStressPack`, types `StressKey`, `StressDefinition`, `StressSetting`, `StressDerivation`, `ResolvedStress`, `StressResult`, `StressPackResult`.

Python module:

```python
"""Port of frontend/src/lib/model/stress-pack.ts.

The standard lender stress pack of spec Sec 25: nine named stresses, each
one Sec 12.5 cell of the base document, run through sensitivity._measure.
Like sensitivity.py this module imports run_appraisal-adjacent helpers
lazily; app/financial_model/__init__.py must never import it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .engine import money_round
from .sensitivity import (
    InvalidBaseDocumentError, SensitivityLever, SensitivityMetrics, _LeverSetting, _measure,
)
from .types import AnyCalculatorInputs, ProgrammeNetwork

StressKey = Literal[
    "unit_loss", "area_reduction", "abnormal_cost", "slower_absorption", "delayed_start",
    "yield_expansion", "lower_refi_ltv", "opex_vacancy", "risks_crystallise",
]


@dataclass(frozen=True)
class StressDefinition:
    key: StressKey
    label: str
    # (lever, value); a None value is DERIVED from the document (Sec 25.3).
    settings: tuple[tuple[SensitivityLever, float | None], ...]


# Sec 25.2. Closed, normative order, normative magnitudes.
STRESS_PACK: tuple[StressDefinition, ...] = (
    StressDefinition("unit_loss", "One unit lost", (("saleable_area", None),)),
    StressDefinition("area_reduction", "Saleable area -5%", (("saleable_area", -5.0),)),
    StressDefinition("abnormal_cost", "Abnormal cost +10%", (("abnormal_cost", 10.0),)),
    StressDefinition("slower_absorption", "Sales six months slower", (("sales_slip", 6.0),)),
    StressDefinition("delayed_start", "Start / PC six months late", (("programme_slip", 6.0),)),
    StressDefinition("yield_expansion", "Exit yield +100 bp", (("exit_yield", 1.0),)),
    StressDefinition("lower_refi_ltv", "Refinance LTV -10 pp", (("refi_ltv", 10.0),)),
    StressDefinition("opex_vacancy", "Opex +10%, vacancy +5 pp", (("operating_cost", 10.0), ("vacancy", 5.0))),
    StressDefinition("risks_crystallise", "Recorded risks crystallise",
                     (("construction_cost", None), ("programme_slip", None))),
)


def _round12(x: float) -> float:
    """Sec 25.3: the same 12-dp rule package_timing.py uses for the midpoint."""
    return money_round(x * 1e12) / 1e12


@dataclass
class StressSetting:
    lever: SensitivityLever
    value: float
    phase_id: str | None = None  # always None: no pack lever carries a target


@dataclass
class StressDerivation:
    cost_impact_pence: int
    base_build_pence: int
    cost_pct: float | None          # Sec 25.3 p, or None when the cost half is inapplicable
    programme_impact_months: int     # the SUM
    programme_impact_max_months: int | None
    stated_item_count: int           # assessed items with a non-null cost impact


@dataclass
class ResolvedStress:
    key: StressKey
    label: str
    settings: list[StressSetting]
    derivation: StressDerivation | None
    applicable: bool
    note: str | None


@dataclass
class StressResult(ResolvedStress):
    metrics: SensitivityMetrics = field(default=None)  # type: ignore[assignment]
    delta_profit_pence: int | None = None


@dataclass
class StressPackResult:
    base: SensitivityMetrics
    stresses: list[StressResult]


# The notes, ASCII only, byte-identical in stress-pack.ts.
NOTE_NO_UNITS = "The unit mix is empty, so there is no saleable area to reduce."
NOTE_NO_COST_PLAN = "This document has no cost plan, so there is no abnormal contingency class to stress."
NOTE_NO_ABNORMAL_PACKAGE = "No package carries the abnormal contingency class, so the stress has nothing to attach to."
NOTE_NO_LEDGER = "No unit-sales ledger is modelled, so there is no completion date to slip."
NOTE_NO_NETWORK = "The programme is not a precedence network, so there is no phase to slip."
NOTE_NO_INVESTMENT_CASE = "No investment case is modelled, so there is no take-out to stress."
NOTE_NO_COST_IMPACT = "No assessed due-diligence item states a cost impact."
NOTE_NO_BASE_BUILD = "The base build is zero, so a cost impact has no base to scale."
NOTE_NO_PROGRAMME_IMPACT = "No assessed due-diligence item states a programme impact."
NOTE_NO_NETWORK_FOR_IMPACT = "The programme is not a precedence network, so the programme impact has no phase to slip."


def _facts(inputs: AnyCalculatorInputs) -> dict:
    from app.financial_model import compute_cost_plan, developed_area_sqm  # lazy: see module docstring
    cost_plan = getattr(inputs, "cost_plan", None)
    programme = getattr(inputs, "programme", None)
    network = programme if isinstance(programme, ProgrammeNetwork) and programme.phases else None
    unit_sales = getattr(inputs, "unit_sales", None)
    dd = getattr(inputs, "due_diligence", None)
    assessed = [i for i in (dd.items if dd is not None else []) if i.status in ("red", "amber")]
    costed = [i for i in assessed if i.cost_impact_pence is not None]
    months = [i.programme_impact_months for i in assessed if i.programme_impact_months is not None]
    result = compute_cost_plan(inputs, developed_area_sqm(inputs), len(inputs.unit_mix.units))
    return {
        "n_units": len(inputs.unit_mix.units),
        "cost_plan": cost_plan,
        "has_abnormal_base": cost_plan is not None and any(c.name == "abnormal" for c in cost_plan.contingency) and (
            cost_plan.mode == "headline" or any(p.contingency_class == "abnormal" for p in cost_plan.packages)
        ),
        "has_ledger": unit_sales is not None and len(unit_sales.units) > 0,
        "network": network,
        "has_investment_case": getattr(inputs, "investment_case", None) is not None,
        "sum_cost": sum(i.cost_impact_pence for i in costed),
        "stated_item_count": len(costed),
        "sum_months": sum(months),
        "max_months": max(months) if months else None,
        "base_build": result.base_build_pence,
    }


def resolve_stress(inputs: AnyCalculatorInputs, definition: StressDefinition) -> ResolvedStress:
    """Sec 25.3 derivations and Sec 25.4 applicability, from the base document
    alone. An inapplicable stress keeps its fixed settings (no-ops by
    construction on this document) and resolves its derived ones to 0, so it
    is still measured and equals the base -- design decision 10/11."""
    f = _facts(inputs)
    key = definition.key
    settings: list[StressSetting] = []
    derivation: StressDerivation | None = None
    notes: list[str] = []
    applicable = True

    if key in ("unit_loss", "area_reduction"):
        if f["n_units"] == 0:
            applicable, notes = False, [NOTE_NO_UNITS]
        value = definition.settings[0][1]
        if value is None:
            value = _round12(-100 / f["n_units"]) if f["n_units"] > 0 else 0.0
        settings = [StressSetting("saleable_area", value)]
    elif key == "abnormal_cost":
        if f["cost_plan"] is None:
            applicable, notes = False, [NOTE_NO_COST_PLAN]
        elif not f["has_abnormal_base"]:
            applicable, notes = False, [NOTE_NO_ABNORMAL_PACKAGE]
        settings = [StressSetting("abnormal_cost", 10.0)]
    elif key == "slower_absorption":
        if not f["has_ledger"]:
            applicable, notes = False, [NOTE_NO_LEDGER]
        settings = [StressSetting("sales_slip", 6.0)]
    elif key == "delayed_start":
        if f["network"] is None:
            applicable, notes = False, [NOTE_NO_NETWORK]
        settings = [StressSetting("programme_slip", 6.0)]
    elif key in ("yield_expansion", "lower_refi_ltv", "opex_vacancy"):
        if not f["has_investment_case"]:
            applicable, notes = False, [NOTE_NO_INVESTMENT_CASE]
        settings = [StressSetting(lever, value) for lever, value in definition.settings]  # type: ignore[arg-type]
    else:  # risks_crystallise
        cost_ok = f["sum_cost"] > 0 and f["base_build"] > 0
        if f["sum_cost"] <= 0:
            notes.append(NOTE_NO_COST_IMPACT)
        elif f["base_build"] <= 0:
            notes.append(NOTE_NO_BASE_BUILD)
        months_ok = f["sum_months"] > 0 and f["network"] is not None
        if f["sum_months"] <= 0:
            notes.append(NOTE_NO_PROGRAMME_IMPACT)
        elif f["network"] is None:
            notes.append(NOTE_NO_NETWORK_FOR_IMPACT)
        cost_pct = _round12(f["sum_cost"] / f["base_build"] * 100) if cost_ok else None
        applicable = cost_ok or months_ok
        derivation = StressDerivation(
            cost_impact_pence=f["sum_cost"], base_build_pence=f["base_build"], cost_pct=cost_pct,
            programme_impact_months=f["sum_months"], programme_impact_max_months=f["max_months"],
            stated_item_count=f["stated_item_count"],
        )
        settings = [
            StressSetting("construction_cost", cost_pct if cost_ok else 0.0),
            StressSetting("programme_slip", float(f["sum_months"]) if months_ok else 0.0),
        ]

    return ResolvedStress(
        key=key, label=definition.label, settings=settings, derivation=derivation,
        applicable=applicable, note=" ".join(notes) if notes else None,
    )


def run_stress_pack(inputs: AnyCalculatorInputs) -> StressPackResult:
    """Sec 25.2: nine cells plus the base. Raises InvalidBaseDocumentError on a
    base that fails validation, exactly as run_sensitivity does."""
    base = _measure(inputs, [])
    if base.validation_errors:
        messages = dict.fromkeys(e.message for e in base.validation_errors)
        raise InvalidBaseDocumentError("Invalid base document: " + " ".join(messages))
    stresses: list[StressResult] = []
    for definition in STRESS_PACK:
        resolved = resolve_stress(inputs, definition)
        m = _measure(inputs, [
            _LeverSetting(lever=s.lever, phase_id=None, value=s.value) for s in resolved.settings
        ])
        delta = None if m.profit_pence is None or base.profit_pence is None else m.profit_pence - base.profit_pence
        stresses.append(StressResult(
            **resolved.__dict__, metrics=m, delta_profit_pence=delta,
        ))
    return StressPackResult(base=base, stresses=stresses)
```

**Points to verify against source before transcribing:** `DdItem.status` values; `CostPlanInputs.mode` / `.contingency` / `.packages` attribute names on the *input* model (`_cost_plan_of` in `cost_plan.py` shows what the engine reads); `compute_cost_plan`'s result field `base_build_pence`; that `_facts` on a pre-v7 document (no `cost_plan` attribute) still runs — `compute_cost_plan` handles that via `_cost_plan_of`. If `StressResult(ResolvedStress)` dataclass inheritance with defaults misbehaves, declare `StressResult` flat with all eight fields.

TS module `stress-pack.ts`: the same shapes as interfaces (`StressDefinition { key; label; settings: ReadonlyArray<readonly [SensitivityLever, number | null]> }`, `StressSetting { lever; value; phase_id: null }`, `StressDerivation`, `ResolvedStress`, `StressResult extends ResolvedStress { metrics: SensitivityMetrics; delta_profit_pence: number | null }`, `StressPackResult { base: MeasuredMetrics; stresses: StressResult[] }`), the same nine definitions, the same note constants, `round12 = (x: number) => Math.round(x * 1e12) / 1e12`, `facts(inputs)` using `'cost_plan' in inputs ? inputs.cost_plan : null`, `isProgrammeNetwork`, `'unit_sales' in inputs && inputs.unit_sales != null`, `'due_diligence' in inputs ? inputs.due_diligence.items : []`, `computeCostPlan(inputs, developedAreaSqm(inputs), inputs.unit_mix.units.length).base_build_pence`; `sum_cost / base_build * 100` written in that order. `runStressPack` mirrors `runSensitivity`'s base check and message.

- [ ] **Step 1: Failing tests (Python)** — `tests/test_financial_model_stress_pack.py`:

```python
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.migrate import migrate_inputs_to_v15
from app.financial_model.sensitivity import InvalidBaseDocumentError
from app.financial_model.stress_pack import STRESS_PACK, resolve_stress, run_stress_pack
from app.financial_model.types import ScenarioOverrides

from .fixtures_due_diligence import dd_doc
from .fixtures_investment_case import ic_doc

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load(stem):
    return migrate_inputs_to_v15(json.loads((FIXTURE_DIR / f"{stem}.json").read_text(encoding="utf-8"))["inputs"], None)


def test_the_pack_is_nine_entries_in_the_normative_order():
    assert [d.key for d in STRESS_PACK] == [
        "unit_loss", "area_reduction", "abnormal_cost", "slower_absorption", "delayed_start",
        "yield_expansion", "lower_refi_ltv", "opex_vacancy", "risks_crystallise",
    ]


def test_fixture_y_derivations_and_applicability():
    """Plan table 'Base Y', hand-derived."""
    y = _load("y-due-diligence")
    by_key = {d.key: resolve_stress(y, d) for d in STRESS_PACK}
    assert by_key["unit_loss"].settings[0].value == -25
    assert by_key["unit_loss"].applicable is True
    rc = by_key["risks_crystallise"]
    assert rc.applicable is True and rc.note is None
    assert rc.derivation.cost_impact_pence == 2_550_000
    assert rc.derivation.base_build_pence == 26_000_000
    assert rc.derivation.cost_pct == 9.807692307692
    assert rc.derivation.programme_impact_months == 7
    assert rc.derivation.programme_impact_max_months == 3
    assert rc.derivation.stated_item_count == 4
    assert [(s.lever, s.value) for s in rc.settings] == [("construction_cost", 9.807692307692), ("programme_slip", 7.0)]
    assert by_key["abnormal_cost"].applicable is False
    assert by_key["abnormal_cost"].note == "No package carries the abnormal contingency class, so the stress has nothing to attach to."
    for k in ("yield_expansion", "lower_refi_ltv", "opex_vacancy"):
        assert by_key[k].applicable is False
        assert by_key[k].note == "No investment case is modelled, so there is no take-out to stress."
    for k in ("area_reduction", "slower_absorption", "delayed_start"):
        assert by_key[k].applicable is True


def test_fixture_u_derivations_and_applicability():
    u = _load("u-investment-case-ltv-binds")
    by_key = {d.key: resolve_stress(u, d) for d in STRESS_PACK}
    assert by_key["unit_loss"].settings[0].value == -20
    assert by_key["abnormal_cost"].applicable is True
    assert by_key["slower_absorption"].applicable is False
    rc = by_key["risks_crystallise"]
    assert rc.applicable is False
    assert rc.note == ("No assessed due-diligence item states a cost impact. "
                       "No assessed due-diligence item states a programme impact.")
    assert [(s.lever, s.value) for s in rc.settings] == [("construction_cost", 0.0), ("programme_slip", 0.0)]


def test_risks_crystallise_levered_build_on_y_is_within_the_stated_bound():
    """Sec 25.3: detailed mode, per-package rounding -> |levered - (base + sum)| <= packages."""
    y = _load("y-due-diligence")
    rc = resolve_stress(y, STRESS_PACK[-1])
    levered = apply_scenario(y, ScenarioOverrides(
        label="", gdv_adjustment_pct=0, construction_cost_adjustment_pct=rc.derivation.cost_pct,
        timeline_adjustment_months=0, interest_rate_adjustment_pct=0))
    amounts = [p.amount_pence for p in levered.cost_plan.packages]
    assert amounts == [13_176_923, 8_784_615, 6_588_462]        # hand-derived
    assert abs(sum(amounts) - (26_000_000 + 2_550_000)) <= len(amounts)


def test_risks_crystallise_headline_bound():
    """Sec 25.3 headline arm: the lever rounds the RATE, so the bound is
    ceil(area/2) + 1 pence. Built from ic_doc (headline) with two DD items
    given impacts by hand."""
    import math
    doc = ic_doc()
    items = doc.due_diligence.items
    items[0].status, items[0].cost_impact_pence = "amber", 1_234_567
    items[1].status, items[1].cost_impact_pence = "red", 765_433
    rc = resolve_stress(doc, STRESS_PACK[-1])
    assert rc.derivation.cost_impact_pence == 2_000_000
    levered = apply_scenario(doc, ScenarioOverrides(
        label="", gdv_adjustment_pct=0, construction_cost_adjustment_pct=rc.derivation.cost_pct,
        timeline_adjustment_months=0, interest_rate_adjustment_pct=0))
    from app.financial_model import compute_cost_plan, developed_area_sqm
    area = developed_area_sqm(doc)
    before = compute_cost_plan(doc, area, len(doc.unit_mix.units)).base_build_pence
    after = compute_cost_plan(levered, area, len(doc.unit_mix.units)).base_build_pence
    assert abs(after - (before + 2_000_000)) <= math.ceil(area / 2) + 1
```

(`ic_doc()` is a v11 builder: confirm it carries `due_diligence` after Task 4's cutover — `ic_doc` builds through `migrate_inputs_to_v11`; if its document has no `due_diligence`, migrate it: `doc = migrate_inputs_to_v15(ic_doc().model_dump(mode="json"), None)`. Confirm `DdItem` is mutable in place; if the model is frozen, rebuild with `model_copy(update=...)`.)

```python
@pytest.mark.parametrize("stem", sorted(p.stem for p in FIXTURE_DIR.glob("*.json")))
def test_inapplicable_implies_equal_to_base_corpus_wide(stem):
    """Design decision 11 / guard 3, and the identity every measured stress
    is defined by (Sec 25.2): a stress cell IS run_appraisal(apply_scenario(base, its settings))."""
    doc = json.loads((FIXTURE_DIR / f"{stem}.json").read_text(encoding="utf-8"))
    if "inputs" not in doc:
        pytest.skip("suite fixture, no inputs of its own")
    inputs = migrate_inputs_to_v15(doc["inputs"], None)
    try:
        result = run_stress_pack(inputs)
    except InvalidBaseDocumentError:
        pytest.skip("base document fails validation")
    for s in result.stresses:
        if not s.applicable:
            assert asdict(s.metrics) == asdict(result.base), (stem, s.key)


def test_every_stress_is_the_levered_appraisal_on_y_and_u():
    for stem in ("y-due-diligence", "u-investment-case-ltv-binds"):
        inputs = _load(stem)
        result = run_stress_pack(inputs)
        for s in result.stresses:
            levered = inputs
            for setting in s.settings:
                levered = apply_scenario(levered, _single(setting.lever, setting.value))
            expected = run_appraisal(levered).metrics
            assert s.metrics.profit_pence == expected.profit_pence, (stem, s.key)
            assert s.metrics.peak_debt_pence == expected.peak_debt_pence, (stem, s.key)
            assert s.delta_profit_pence == expected.profit_pence - result.base.profit_pence


def _single(lever, value):
    field = {"saleable_area": "saleable_area_adjustment_pct", "abnormal_cost": "abnormal_cost_adjustment_pct",
             "programme_slip": "programme_slip_months", "refi_ltv": "refi_ltv_adjustment_pct",
             "sales_slip": "sales_slip_months", "exit_yield": "exit_yield_adjustment_pct",
             "operating_cost": "operating_cost_adjustment_pct", "vacancy": "vacancy_adjustment_pct",
             "construction_cost": "construction_cost_adjustment_pct"}[lever]
    return ScenarioOverrides(label="", gdv_adjustment_pct=0, construction_cost_adjustment_pct=0,
                             timeline_adjustment_months=0, interest_rate_adjustment_pct=0,
                             **{field: int(value) if field.endswith("_months") else value})


def test_u_abnormal_cost_and_refi_ltv_by_hand():
    """Plan table 'Base U': +3,500,000 contingency on an unlevered headline
    document moves profit by exactly -3,500,000; the LTV cap at 45% is
    floor(32,407,082 x 45 / 100) = 14,583,186 and still binds."""
    u = _load("u-investment-case-ltv-binds")
    result = run_stress_pack(u)
    by_key = {s.key: s for s in result.stresses}
    assert by_key["abnormal_cost"].delta_profit_pence == -3_500_000
    levered = apply_scenario(u, _single("refi_ltv", 10))
    ic = run_appraisal(levered).metrics.investment_case
    assert ic["takeout"]["ltv_cap_pence"] == 14_583_186      # verify the result's shape (dict vs dataclass) before asserting
    assert ic["takeout"]["quantum_pence"] == 14_583_186
    assert ic["takeout"]["binding_constraint"] == "ltv"


def test_an_invalid_base_document_is_refused():
    doc = dd_doc()
    doc.finance.term_months = 0
    with pytest.raises(InvalidBaseDocumentError):
        run_stress_pack(doc)
```

For the `abnormal_cost` delta, confirm by reading fixture U that nothing else in TDC depends on `construction_total_pence` (no `pct_of_construction_total` fee line — U has no fee lines; VAT `registered: false`; no facility) — the assertion is then exact.

- [ ] **Step 2: Run to verify fail** — `python -m pytest tests/test_financial_model_stress_pack.py -q` → FAIL at import.

- [ ] **Step 3: Implement both modules; port the tests to `stress-pack.test.ts`** (same names; `ddDoc()`/`icDoc()`; `expect(...).toEqual` on plain objects; the corpus test iterates `readdirSync(FIXTURE_DIR)` and `continue`s on files without `inputs`).

- [ ] **Step 4: Run and commit**

`python -m pytest tests/test_financial_model_stress_pack.py -q`; `cd frontend && npx vitest run src/lib/model/stress-pack.test.ts` → PASS.

```bash
git add app/financial_model/stress_pack.py frontend/src/lib/model/stress-pack.ts tests/test_financial_model_stress_pack.py frontend/src/lib/model/stress-pack.test.ts
git commit -m "feat(r16): the standard lender stress pack - nine cells, derived settings, applicability, both engines"
```

---

### Task 6: Fixture AA and test-cases §25

**Files:**
- Create: `fixtures/financial-model/aa-stress-pack.json`
- Modify: `tests/test_financial_model_fixtures.py` (`EXPECTED_FIXTURE_STEMS`, new `TestFixtureAAStressPack`), `frontend/src/lib/model/golden-fixtures.test.ts` (`EXPECTED_FIXTURE_STEMS`, `Fixture.kind` union unchanged, new `describe('Fixture AA — stress pack')`)
- Modify: `docs/financial-model/test-cases.md` (new §25)

**Interfaces:**
- Consumes: Task 5's `run_stress_pack` / `runStressPack`, `resolve_stress` / `resolveStress`.
- Fixture shape:

```json
{
  "name": "AA - the standard lender stress pack over fixtures Y and U",
  "kind": "sensitivity",
  "suite": "stress_pack",
  "note": "...(why kind is sensitivity; what is hand-derived; what is identity-asserted)...",
  "bases": {
    "y-due-diligence": {
      "expected_order": ["unit_loss", "...", "risks_crystallise"],
      "expected_applicable": {"unit_loss": true, "area_reduction": true, "abnormal_cost": false, "slower_absorption": true, "delayed_start": true, "yield_expansion": false, "lower_refi_ltv": false, "opex_vacancy": false, "risks_crystallise": true},
      "expected_notes": {"abnormal_cost": "No package carries the abnormal contingency class, so the stress has nothing to attach to.", "yield_expansion": "No investment case is modelled, so there is no take-out to stress."},
      "expected_settings": {"unit_loss": [["saleable_area", -25]], "risks_crystallise": [["construction_cost", 9.807692307692], ["programme_slip", 7]]},
      "expected_derivation": {"cost_impact_pence": 2550000, "base_build_pence": 26000000, "cost_pct": 9.807692307692, "programme_impact_months": 7, "programme_impact_max_months": 3, "stated_item_count": 4},
      "expected_derived_inputs": {
        "unit_loss": {"floor_area_sqm": [60, 71.25, 41.25, 56.25], "estimated_value_pence": [18750000, 22500000, 13125000, 15750000]},
        "area_reduction": {"floor_area_sqm": [76, 90.25, 52.25, 71.25], "estimated_value_pence": [23750000, 28500000, 16625000, 19950000]},
        "delayed_start": {"slip_months": {"acquisition": 6}},
        "risks_crystallise": {"package_amount_pence": [13176923, 8784615, 6588462], "slip_months": {"acquisition": 7}}
      }
    },
    "u-investment-case-ltv-binds": {
      "expected_applicable": {"unit_loss": true, "area_reduction": true, "abnormal_cost": true, "slower_absorption": false, "delayed_start": true, "yield_expansion": true, "lower_refi_ltv": true, "opex_vacancy": true, "risks_crystallise": false},
      "expected_settings": {"unit_loss": [["saleable_area", -20]], "risks_crystallise": [["construction_cost", 0], ["programme_slip", 0]]},
      "expected_derived_inputs": {
        "abnormal_cost": {"contingency_pct": {"general": 10, "existing_building": 0, "abnormal": 10}},
        "lower_refi_ltv": {"ltv_cap_pct": 45}
      },
      "expected_hand_metrics": {
        "abnormal_cost": {"delta_profit_pence": -3500000},
        "lower_refi_ltv": {"takeout_quantum_pence": 14583186, "binding_constraint": "ltv"}
      }
    }
  }
}
```

- [ ] **Step 1: Write test-cases §25 first** — `docs/financial-model/test-cases.md` gains `## 25. The standard lender stress pack [R16 — calc 2.17.0]` with `### 25.1 Fixture AA` reproducing the plan's two hand-derivation tables (Base Y, Base U) and the composition-pair arithmetic, stating which figures are hand-derived (settings, derivations, derived inputs, U's two closed-form metrics) and which are identity-asserted (every stress's full metrics, per fixture K's rule), and why `kind` is `sensitivity` (refinement (a)). Also note there that `expected_derived_inputs` for the four new levers live here, not in K (refinement (b)).

- [ ] **Step 2: Write the fixture JSON from the table above**, then the loaders. Python, appended to `tests/test_financial_model_fixtures.py`:

```python
AA_DOC = _load_fixture(FIXTURE_DIR / "aa-stress-pack.json")


class TestFixtureAAStressPack:
    @pytest.mark.parametrize("stem", sorted(AA_DOC["bases"]))
    def test_hand_derived_settings_applicability_and_derivation(self, stem):
        from app.financial_model.stress_pack import STRESS_PACK, resolve_stress
        base = migrate_inputs_to_v15(_load_fixture(FIXTURE_DIR / f"{stem}.json")["inputs"], None)
        pins = AA_DOC["bases"][stem]
        resolved = {d.key: resolve_stress(base, d) for d in STRESS_PACK}
        assert [d.key for d in STRESS_PACK] == AA_DOC["bases"]["y-due-diligence"]["expected_order"]
        assert {k: r.applicable for k, r in resolved.items()} == pins["expected_applicable"]
        for key, note in pins.get("expected_notes", {}).items():
            assert resolved[key].note == note, key
        for key, settings in pins["expected_settings"].items():
            assert [[s.lever, s.value] for s in resolved[key].settings] == settings, key
        if "expected_derivation" in pins:
            assert asdict(resolved["risks_crystallise"].derivation) == pins["expected_derivation"]

    @pytest.mark.parametrize("stem", sorted(AA_DOC["bases"]))
    def test_hand_derived_levered_inputs(self, stem):
        # For each key in expected_derived_inputs, lever the base with the
        # resolved settings and compare the named input fields.
        ...  # floor_area_sqm / estimated_value_pence lists over unit_mix.units;
             # slip_months per phase id; package_amount_pence over cost_plan.packages;
             # contingency_pct by class name; ltv_cap_pct on investment_case.takeout

    @pytest.mark.parametrize("stem", sorted(AA_DOC["bases"]))
    def test_every_stress_is_the_levered_appraisal(self, stem):
        ...  # identity: run_stress_pack(base).stresses[i].metrics == the six fields of
             # run_appraisal(apply_scenario chain).metrics, and delta_profit_pence

    def test_u_hand_metrics(self):
        ...  # expected_hand_metrics: delta -3,500,000; quantum 14,583,186 and 'ltv'
```

Write the three `...` bodies out in full (the plan shows their shape; the implementer writes the loops — no `...` may remain). TS: the same four tests under `describe('Fixture AA — the standard lender stress pack (spec §25)')` in `golden-fixtures.test.ts`, reading `aa-stress-pack.json` the way the K block reads its file. Add `'aa-stress-pack'` to both `EXPECTED_FIXTURE_STEMS` rosters (after `'a-all-cash'`, the sorted position). Run `python -m pytest tests/ -q -k "fixtures or migrate or monitoring or cost_to_complete or unit_sales"` and `npx vitest run` to confirm every corpus loop skips AA cleanly (they filter on `kind`).

- [ ] **Step 3: Run, commit**

```bash
git add fixtures/financial-model/aa-stress-pack.json tests/test_financial_model_fixtures.py frontend/src/lib/model/golden-fixtures.test.ts docs/financial-model/test-cases.md
git commit -m "test(r16): fixture AA - the stress pack over Y and U, hand-derived settings and inputs, identity-asserted cells; test-cases 25"
```

---

### Task 7: `safeRunStressPack`, `SCENARIO_FIELD`, and the Sensitivity page panel

**Files:**
- Modify: `frontend/src/lib/safe-sensitivity.ts`, `frontend/src/lib/sensitivity-format.ts`, `frontend/src/components/calculator/SensitivityPage.tsx`
- Test: `frontend/src/lib/safe-sensitivity.test.ts`, `frontend/src/components/calculator/SensitivityPage.test.tsx`

**Interfaces:**
- Produces: `safeRunStressPack(inputs): { ok: true; result: StressPackResult } | { ok: false; error: Error }` (catches `InvalidBaseDocumentError` only; rethrows anything else — `safeRunSensitivity`'s rule); `export const SCENARIO_FIELD: Record<Exclude<SensitivityLever, 'phase_slip'>, keyof ScenarioOverrides>` (the lever → scenario-field map, shared by the Scenarios page and the memo; `phase_slip` is excluded because it carries a target); `export function formatStressSetting(s: { lever: SensitivityLever; value: number }): string` = `${LEVER_LABEL[s.lever]} ${formatStepLabel(s.lever, s.value)}`; `selectableLevers(hasPhaseNetwork, hasUnitSales)` unchanged in signature — the four new levers are always offered (each is a no-op on a document lacking its block, like `exit_yield`).

- [ ] **Step 1: Failing tests** — `safe-sensitivity.test.ts`: `safeRunStressPack(ddDoc())` is `ok` with nine stresses; on `{ ...ddDoc(), finance: { ...ddDoc().finance, term_months: 0 } }` it is `{ ok: false }` with an `InvalidBaseDocumentError`. `SensitivityPage.test.tsx`: rendering with `ddDoc()` shows a table with `aria-label="Standard lender stresses"` whose rows are the nine labels in order, with `"One unit lost"` first and the note text `No package carries the abnormal contingency class` present in the `Abnormal cost +10%` row; `LEVER_LABEL` for the four new levers appears in the row-lever `<select>` options.

- [ ] **Step 2: Implement.** In `SensitivityPage.tsx`, after the heading/editor and before Region 1, a **Region 0**: `const pack = useMemo(() => safeRunStressPack(inputs), [inputs]);` — rendered only when `pack.ok` (when not, one line: "Standard lender stresses could not be calculated: {message}"). Table columns `Stress | Setting | Profit | Δ vs base | Peak debt | Flags`; Setting cell = `s.settings.map(formatStressSetting).join(', ')` and, when `s.note != null`, the note in italics beneath; an unmeasured row prints `—` for the money cells and `unmeasuredCellNote(first message)`; `Δ vs base` prints `penceToPounds(s.delta_profit_pence)` signed. No arithmetic in the component: `delta_profit_pence` and every figure are the engine's.

- [ ] **Step 3: Run, commit** — `npx vitest run src/lib/safe-sensitivity.test.ts src/components/calculator/SensitivityPage.test.tsx && npx tsc -b && npx eslint . --max-warnings 0`.

```bash
git add frontend/src/lib/safe-sensitivity.ts frontend/src/lib/safe-sensitivity.test.ts frontend/src/lib/sensitivity-format.ts frontend/src/components/calculator/SensitivityPage.tsx frontend/src/components/calculator/SensitivityPage.test.tsx
git commit -m "feat(r16): Sensitivity page prints the standard lender stresses; safeRunStressPack; SCENARIO_FIELD"
```

---

### Task 8: Scenarios page — nine inputs, the phase picker, §12.7 on the card

**Files:**
- Modify: `frontend/src/components/calculator/ScenariosPage.tsx`
- Create: `frontend/src/components/calculator/ScenariosPage.test.tsx`
- Modify: `frontend/src/components/ConversionCalculator.test.tsx` (if it pins the Scenarios page's input count)

**Interfaces:**
- Consumes: `SCENARIO_FIELD`, `LEVER_LABEL` (Task 7); `validateInputs` (`../../lib/model`); `isProgrammeNetwork`; `CalculatorInputsV15`.
- Produces: a declarative `SCENARIO_INPUTS: ReadonlyArray<{ field: Exclude<keyof ScenarioOverrides, 'label' | 'phase_slip_phase_id'>; label: string; step: string }>` covering **every** numeric field: the existing five plus `exit_yield_adjustment_pct` "Exit yield adjustment (pp)" step 0.1, `operating_cost_adjustment_pct` "Operating cost adjustment (%)", `vacancy_adjustment_pct` "Vacancy adjustment (pp)" step 0.1, `phase_slip_months` "Phase slip (months)" step 1, `saleable_area_adjustment_pct` "Saleable area adjustment (%)", `abnormal_cost_adjustment_pct` "Abnormal cost (pp)" step 0.1, `programme_slip_months` "Programme slip (months)" step 1, `refi_ltv_adjustment_pct` "Refinance LTV reduction (pp)" step 0.1; plus a `<select>` labelled "Phase to slip" for `phase_slip_phase_id` (options: `— none —` = `null`, then each network phase's `label || id`), shown only when the document is a network (the `SensitivityPage` picker pattern).
- The card's run: `const levered = applyScenario(inputs, inputs.scenarios[key]); const errors = validateInputs(levered).filter((i) => i.severity === 'error'); errors.length > 0 ? { ok: false, errors } : { ok: true, run: runAppraisal(levered) }`. The metrics table prints `not measured` in every metric cell of a failed card and, beneath the grid, one line per failed card: `${label}: ${unmeasuredCellNote(errors[0].message)}`. The Flags panel prints the same sentence for a failed card.

- [ ] **Step 1: Failing test** — `ScenariosPage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScenariosPage from './ScenariosPage';
import { ddDoc } from '../../lib/model/__fixtures__/due-diligence-docs';
import { icDoc } from '../../lib/model/__fixtures__/investment-case-docs';
import { migrateInputsToV15 } from '../../lib/model';
import type { ScenarioOverrides } from '../../lib/conversion-types';

// Exhaustiveness (R9's lesson): this Record fails to COMPILE the moment a field
// is added to ScenarioOverrides without a label here, and the test below fails
// at runtime if a labelled field has no rendered input.
const RENDERED_LABEL: Record<Exclude<keyof ScenarioOverrides, 'label' | 'phase_slip_phase_id'>, string> = {
  gdv_adjustment_pct: 'GDV adjustment (%)',
  construction_cost_adjustment_pct: 'Construction cost adjustment (%)',
  timeline_adjustment_months: 'Timeline adjustment (months)',
  interest_rate_adjustment_pct: 'Interest rate adjustment (%)',
  phase_slip_months: 'Phase slip (months)',
  exit_yield_adjustment_pct: 'Exit yield adjustment (pp)',
  operating_cost_adjustment_pct: 'Operating cost adjustment (%)',
  vacancy_adjustment_pct: 'Vacancy adjustment (pp)',
  sales_slip_months: 'Sales slip (months)',
  saleable_area_adjustment_pct: 'Saleable area adjustment (%)',
  abnormal_cost_adjustment_pct: 'Abnormal cost (pp)',
  programme_slip_months: 'Programme slip (months)',
  refi_ltv_adjustment_pct: 'Refinance LTV reduction (pp)',
};

describe('ScenariosPage (R16 spec §25)', () => {
  it('renders one input per ScenarioOverrides field on each of the four cards, and the phase picker on a network document', () => {
    render(<ScenariosPage inputs={ddDoc()} onChange={() => {}} />);
    for (const label of Object.values(RENDERED_LABEL)) {
      expect(screen.getAllByLabelText(label), label).toHaveLength(4);
    }
    expect(screen.getAllByLabelText('Phase to slip')).toHaveLength(4);
  });

  it('writes a new lever through onChange', () => {
    const calls: unknown[] = [];
    render(<ScenariosPage inputs={ddDoc()} onChange={(p) => calls.push(p)} />);
    fireEvent.change(screen.getAllByLabelText('Programme slip (months)')[2], { target: { value: '6' } });
    const sent = calls.at(-1) as { scenarios: { downside: ScenarioOverrides } };
    expect(sent.scenarios.downside.programme_slip_months).toBe(6);
  });

  it('a card whose levered document fails validation is "not measured", not appraised (spec §12.7)', () => {
    const base = migrateInputsToV15(icDoc() as unknown as Record<string, unknown>);
    const doc = { ...base, scenarios: { ...base.scenarios, downside: { ...base.scenarios.downside, refi_ltv_adjustment_pct: 100 } } };
    render(<ScenariosPage inputs={doc} onChange={() => {}} />);
    expect(screen.getAllByText('not measured').length).toBeGreaterThan(0);
    expect(screen.getByText(/Not measured — the levered document fails validation/)).toBeTruthy();
  });
});
```

(Confirm §19.7 rule 8's message wording by reading `validation.ts` for `ltv_cap_pct`; the third test asserts the shared `unmeasuredCellNote` prefix, not the rule's text.)

- [ ] **Step 2: Implement; run; commit**

`npx vitest run src/components/calculator/ScenariosPage.test.tsx src/components/ConversionCalculator.test.tsx && npx tsc -b && npx eslint . --max-warnings 0`.

```bash
git add frontend/src/components/calculator/ScenariosPage.tsx frontend/src/components/calculator/ScenariosPage.test.tsx frontend/src/components/ConversionCalculator.test.tsx
git commit -m "feat(r16): Scenarios page - every override field has an input, phase picker, cards validate before appraising (12.7)"
```

---

### Task 9: Memo — §10 stress table, comparison settings rows, §12.7, minors 1 and 6

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts`
- Test: `frontend/src/lib/export-investment-memo.test.ts`, `frontend/src/lib/report-qa/memo-release-gate.test.ts`

**Interfaces:**
- Consumes: `runStressPack`, `InvalidBaseDocumentError` (`./model/stress-pack`, `./model/sensitivity`); `formatStressSetting`, `SCENARIO_FIELD`, `LEVER_LABEL`, `formatStepLabel`, `unmeasuredCellNote` (`./sensitivity-format`); `validateInputs`; `QS_STAGE_LABEL`, `humanise`, `fmt`, `fmtPctSafe`, `penceToPoundsExact` (existing in the file / `./format`).
- Produces: `MemoSensitivityTables` gains `stressRows: string[][]` (`[label, setting-with-note, profit, delta, peak debt, flags]`) and `stressFailureMessage: string | null`; a new sub-heading **"Standard Lender Stresses (spec §25)"** printed before "Single-Lever Sensitivity (Tornado)"; the comparison table's settings rows.

- [ ] **Step 1: Failing tests.** In `export-investment-memo.test.ts` (it already extracts memo text via `inspectPdf`): with `dueDiligenceInputs()` the prose contains `Standard Lender Stresses`, all nine labels in order, `No package carries the abnormal contingency class`, and for entry 9 the setting text `Construction cost +9.81%` and `Programme slip +7 months` (from `formatStepLabel` — `construction_cost` prints 0 dp; state the exact expected string after checking `signed()`'s output for `9.807692307692` at 0 dp = `+10%`; if so, print the derived percent to 2 dp in this one cell by passing a preformatted setting: `Construction cost +9.81% (£25,500 recorded; 3 items, largest 3 months)` — the plan chooses the 2-dp form, so `formatStressSetting` takes an optional `decimals` override). In `memo-release-gate.test.ts`: `documentProse((await report(dueDiligenceInputs())).info)` contains `Standard Lender Stresses` and `Recorded risks crystallise`; the comparison table on `dueDiligenceInputs()` with `scenarios.downside.programme_slip_months = 6` prints a `Programme slip` row; the cost-stack Amount column on `costPlanInTimeInputs()` no longer contains a `.00` figure on the inflation row (assert the row's Amount matches `fmt(inflation_total_pence)`); the DD table on `dueDiligenceInputs()` prints `derived from the cost plan's QS record` and not `derived from cost_plan.qs`, and the QS row's evidence shows the stage label (`QS_STAGE_LABEL`) rather than `riba_3 / issued`-style keys.

- [ ] **Step 2: Implement.**
  - `sensitivityTables()`: after the tornado rows, `let stressRows: string[][] = []; let stressFailureMessage: string | null = null; try { const pack = runStressPack(inputs); stressRows = pack.stresses.map((s) => [ s.label, settingCell(s), s.metrics.profit_pence === null ? 'not measured' : fmt(s.metrics.profit_pence), s.delta_profit_pence === null ? '-' : fmtSigned(s.delta_profit_pence), s.metrics.peak_debt_pence === null ? '-' : fmt(s.metrics.peak_debt_pence), s.metrics.validation_errors.length > 0 ? unmeasuredCellNote(s.metrics.validation_errors[0].message) : flagShortCodes(s.metrics.flags) || '-' ]); } catch (err) { if (!(err instanceof InvalidBaseDocumentError)) throw err; stressFailureMessage = err.message; }` where `settingCell(s)` joins `formatStressSetting` over `s.settings` (entry 9's cost setting at 2 dp with the recorded Σ and item counts from `s.derivation`), appends `s.note` when non-null. `fmtSigned` = `fmt` with a leading `+` for positive values (add beside `fmt`).
  - §10: `y = subHeading(y, 'Standard Lender Stresses (spec §25)'); y = bodyText(y, 'Nine standard stresses, each a full re-run of the appraisal with the committed facility held fixed. An inapplicable stress is printed with the reason it cannot move this scheme rather than omitted (spec §25.4).'); table({... head: [['Stress', 'Setting', 'Profit', 'Δ vs base', 'Peak debt', 'Flags']], body: sens.stressRows, styles: { fontSize: 8, cellPadding: 1.5 }, columnStyles: { 0: { fontStyle: 'bold' }, 1: { cellWidth: 70 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } })`, or `bodyText(y, stressFailureMessage)` when the pack failed.
  - Scenario Comparison: for each `key` compute `levered`, `errors`, `run | null` as the Scenarios page does; the body's settings rows become `LEVER_ORDER.filter((l) => l !== 'phase_slip').filter((l) => scenarioRuns.some((s) => s.overrides[SCENARIO_FIELD[l]] !== 0)).map((l) => [LEVER_LABEL[l], ...scenarioRuns.map((s) => formatStepLabel(l, s.overrides[SCENARIO_FIELD[l]] as number))])` plus a `Phase slip` row when any `phase_slip_phase_id` is non-null (`${phase_slip_months} months on ${phase_slip_phase_id}`); metric cells print `not measured` for a failed card; one `bodyText` line per failed card beneath the table using `unmeasuredCellNote`.
  - Minor 1: the inflation row's Amount → `fmt(cp.inflation_total_pence)`.
  - Minor 6: `const DD_DERIVED_SOURCE_LABEL: Record<string, string> = { 'cost_plan.qs': "the cost plan's QS record", 'finance.requires_confirmation': "the facility's confirmation state", 'equity_sources[].evidence_status': "the equity sources' evidence status", 'acquisition.jurisdiction_evidence_status + vat': 'the jurisdiction and VAT evidence', lender_valuation: 'the lender valuation' };` used as `derived from ${DD_DERIVED_SOURCE_LABEL[r.source] ?? r.source}`; and for `r.kind === 'derived' && r.code === 'cost_plan_qs' && r.evidence !== null`, the evidence cell prints `[r.evidence.source, `${QS_STAGE_LABEL[cp.qs.stage]} / ${humanise(cp.qs.status)}`, date]` (`cp.qs` non-null whenever that row has evidence — check `computeDerivedRow`'s `cost_plan_qs` arm).

- [ ] **Step 3: Run the memo tests and the release gate; commit.** `npx vitest run src/lib/export-investment-memo.test.ts src/lib/report-qa/` (the gate takes ~30 s).

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-investment-memo.test.ts frontend/src/lib/report-qa/memo-release-gate.test.ts
git commit -m "feat(r16): memo 10 prints the standard lender stresses; comparison prints every lever and validates cards; Amount column whole pounds; DD derived-row labels"
```

---

### Task 10: Minors 4 and 5, governance §12 entry (minor 3)

**Files:**
- Modify: `frontend/src/lib/model/curves.ts` (`spreadUserDefined`, `curveWeights`), `app/financial_model/curves.py` (`spread_user_defined` if present, `curve_weights`), `frontend/src/lib/model/cost-plan.ts` (`baseDate` read)
- Modify: `fixtures/financial-model/s-dated-programme.json` (`note` only)
- Modify: `docs/financial-model/model-governance.md` §12
- Test: `frontend/src/lib/model/curves.test.ts`, `tests/test_financial_model_curves.py`, `frontend/src/lib/model/cost-plan.test.ts`

- [ ] **Step 1: Failing tests.** TS: `curveWeights(3, { kind: 'user_defined', weights: [0, 0, 0] })` → `[1/3, 1/3, 1/3]`; `weights: [1, NaN]` → `[0.5, 0.5]`; Python the same via `curve_weights(3, SpendCurve(kind="user_defined", weights=[0, 0, 0]))` (check the `SpendCurve`/`UserDefinedSpendCurve` constructor in `types.py`) → `[1/3, 1/3, 1/3]` and no `ZeroDivisionError`. `cost-plan.test.ts`: `computeCostPlan` on a detailed document whose `cost_plan.qs` object lacks the `base_date` key entirely (`delete (doc.cost_plan.qs as Record<string, unknown>).base_date`) does not throw and treats the base date as absent (`packages[0].months_from_base === null`).

- [ ] **Step 2: Implement.** TS: `const sum = curve.weights.reduce((a, b) => a + b, 0); const n = curve.weights.length; return Number.isFinite(sum) && sum > 0 ? curve.weights.map((w) => w / sum) : Array.from({ length: n }, () => 1 / n);` in both `curveWeights` and `spreadUserDefined` (the latter via `spreadByWeights(total, uniform)`). Python twin with `math.isfinite(s) and s > 0`. `cost-plan.ts`: `const baseDate = qsInput != null && typeof qsInput.base_date === 'string' && qsInput.base_date.trim() !== '' ? qsInput.base_date : null;`. Fixture S's `note`: rewrite "THE LEDGER" and "PROFIT" paragraphs to narrate the R15b (2.16.0) figures from test-cases §24.2 (funding gap 6,330,000; peak debt 82,924,400; the redemption balances 82,924,400 / 9,478,151; profit_on_gdv 19.75; the other figures from the same worksheet), and move the R14 figures into one paragraph headed "BEFORE R15b, FOR CONTRAST (calc 2.13.0):"; delete the trailing one-line R15b tail. No `expected_metrics` change — run `pytest tests/test_financial_model_fixtures.py -q -k s_dated` to prove nothing but prose moved. Governance §12: add `[R15b. \`MOVE_WHOLE_MAX_MM\` (export-investment-memo.ts) rose from 110 to 130 …]` after the R15 bracket, naming the reason (fixture Z's Basis-of-Preparation table at 110.6 mm stranded rows on a near-blank final page), that the cutoff is global to every memo table, and that a per-table override for the Limitations table alone was the alternative not taken.

- [ ] **Step 3: Run, commit.** `python -m pytest tests/test_financial_model_curves.py tests/test_financial_model_fixtures.py -q`; `npx vitest run src/lib/model/curves.test.ts src/lib/model/cost-plan.test.ts src/lib/model/golden-fixtures.test.ts`.

```bash
git add frontend/src/lib/model/curves.ts app/financial_model/curves.py frontend/src/lib/model/cost-plan.ts frontend/src/lib/model/curves.test.ts tests/test_financial_model_curves.py frontend/src/lib/model/cost-plan.test.ts fixtures/financial-model/s-dated-programme.json docs/financial-model/model-governance.md
git commit -m "fix(r16): user-defined curve weights degrade to uniform on a zero sum, both engines; TS base_date read hardened; fixture S note narrates R15b; governance 12 records MOVE_WHOLE_MAX_MM"
```

---

### Task 11: Spec §25, amendments, migration notes §18, governance §3.1, release plan, CALC_VERSION

**Files:**
- Modify: `docs/financial-model/calculation-specification.md` (status line → `2.17.0`, date; changelog entry; §1.6 paragraph; §12.1 four rows + composition + sorted-application sentence; §12.6 rule; §12.7 sentence; §16.3 lever-target note; §18.9 `programme_slip`; §19.8 `refi_ltv`; §23.9 note → historical; §24.7 the `base_date` sentence; new **§25** with 25.1–25.8 as the design's §4–§11)
- Modify: `docs/financial-model/migration-notes.md` (§18 v14 → v15, in §17's shape; fix the title's stale "→ v10"), `docs/financial-model/model-governance.md` (§3.1 row R16), `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` (R16 row → the split; new R16b row; R16 status paragraph), `docs/financial-model/test-cases.md` (status line calc version)
- Modify: `app/financial_model/types.py` `CALC_VERSION = "2.17.0"`, `frontend/src/lib/model/finance-types.ts` `CALC_VERSION = '2.17.0'`
- Test: `frontend/src/lib/model/spec-versions.test.ts`, `tests/test_financial_model_types.py` (any CALC_VERSION pin), the memo release gate (prints the version)

- [ ] **Step 1:** Bump `CALC_VERSION` in both engines; run `npx vitest run src/lib/model/spec-versions.test.ts` → FAIL (spec lacks `2.17.0`).
- [ ] **Step 2:** Write the spec text. §25 is the design's §4–§11 rewritten in the spec's voice (normative, present tense, with the R16 bracket tags), carrying the three plan refinements verbatim. The changelog entry states: *"Calc 2.17.0 (R16) adds §25's stress pack and four levers. **It changes no existing computed value** — the v15 identity gate compares metrics (flags strictly), ledger, schedule and, on four named fixtures, the default sensitivity suite, with no exclusion."*
- [ ] **Step 3:** Run every gate: `python -m pytest tests/ -q`; `cd frontend && npx tsc -b && npx vitest run && npx eslint . --max-warnings 0 && npm run build`. Record the counts.
- [ ] **Step 4: Commit**

```bash
git add docs app/financial_model/types.py frontend/src/lib/model/finance-types.ts
git commit -m "docs(r16): spec 25 and amendments (1.6, 12.1, 12.6, 12.7, 16.3, 18.9, 19.8, 23.9, 24.7), migration notes 18, governance row, release plan split; calc 2.17.0"
```

---

### Task 12: Whole-branch review (controller)

Not an implementer task. Before merging, review the branch as a whole for the seams the per-task reviews cannot see (the R10 lesson):

1. Sorted application (Task 3) against fixture K and the v15 sensitivity comparison (Task 4) — both green, and the K pins byte-identical.
2. The Scenarios page's levered-document validation (Task 8) against the four new fields — a `refi_ltv` of 100 on U renders "not measured" on the page and in the memo comparison (guard 10).
3. The memo table against a memo fixture whose base document *fails* validation — §10 prints the failure message once, for the suite and the pack alike, not twice.
4. `_facts` on every corpus fixture including pre-v7 documents (a v5 document has no `cost_plan` attribute) — the corpus-wide implication test covers it; confirm it did not `skip` more than the known invalid bases.
5. The entry-point guards list no stragglers; `grep -rn "migrateInputsToV14\|migrate_inputs_to_v14" app frontend/src --include=*.ts --include=*.tsx --include=*.py` shows only `migrate.*`, `__init__.py`, the exempt fixtures and the identity gates.
6. `git diff main --stat` — no file outside this plan's File structure moved except test literals `tsc` demanded.

Then `git checkout main && git merge --no-ff r16-lender-stress-pack`, re-run all gates on the merged result, push.

---

## Self-review (done at authoring time)

**Spec coverage.** Design §4 (levers) → Tasks 1–3; §5–§7 (pack, derivations, applicability) → Task 5; §8 result/surfaces → Tasks 5, 7, 8, 9; §9 validation (refinement (c)) → Task 4; §10 migration → Task 4; §11 limitations → Task 11; §12 fixture AA → Task 6; §13 guards 1–10 → Tasks 2 (1), 3 (2), 5 (3, 4), 4 (5, 9), 1 (6), 8 (7, 10), 9 (8); §14 minors 1, 6 → Task 9; 2 → Task 4; 3, 4, 5 → Task 10; 6b, 6c, 7 → Task 11 text; §15 amendments → Task 11.

**Placeholders.** Task 6's three `...` bodies are the one place the plan shows shape rather than code; the surrounding text says exactly which fields each loop compares, and the implementer must write them out — a review that finds `...` in the committed test is a rejection. Everything else is code or a named source edit.

**Type consistency.** `StressSetting.value: float` / `number`; `_LeverSetting(lever, phase_id, value)` keyword order as in `sensitivity.py`; `LeverSetting { lever; phaseId; value }` in TS (note `phaseId`, camel-case, in the engine's own interface — `runStressPack` builds `{ lever: s.lever, phaseId: null, value: s.value }`); `StressResult.metrics: SensitivityMetrics`; `delta_profit_pence: int | None` / `number | null`; `SCENARIO_FIELD` excludes `phase_slip`; `formatStressSetting` takes `{ lever, value }`. `ddDoc()` returns `CalculatorInputsV15` after Task 4 — Task 2's TS tests, written before the cutover, use it as `AnyCalculatorInputs` and need no change.

**Reachable literals.** Every numeric pin in Tasks 2, 5 and 6 appears in the hand-derived tables above with its arithmetic; the two U metrics (−3,500,000; 14,583,186) carry the dependency the implementer must confirm before pinning.
