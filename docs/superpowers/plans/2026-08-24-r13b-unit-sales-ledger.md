# R13b — Unit-Level Sales Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-unit sales ledger (exchange/completion timing, deposits held or released, per-unit selling-cost overrides, pre-sales coverage) as inputs v12 / calc 2.14.0, mirrored in both engines, with a `sales_slip` lever, and correct §5.11's phased break-even to replay anchored tranches at their resolved months.

**Architecture:** A pure module (`app/financial_model/unit_sales.py` / `frontend/src/lib/model/unit-sales.ts`) computes per-unit figures and a result block from the inputs plus the schedule's single anchor resolver; `build_schedule`/`buildSchedule` write its receipts into the existing `MonthReceipts` fields (no new receipt class) and republish the block on `Schedule` → `AppraisalResultV2`. §5.11's phased solver gains a `receipt_lines` arm; the tranche arm is handed resolved months. The v12 migration writes `unit_sales: null` and `scenarios.*.sales_slip_months: 0`.

**Tech Stack:** Python 3 + Pydantic v2 + pytest (`python -m pytest -q` from repo root); TypeScript + Vitest + React (`npm test`, `npx tsc -b`, `npm run lint -- --max-warnings 0` from `frontend/`); jsPDF/autoTable memo.

**Spec:** `docs/superpowers/specs/2026-08-24-r13b-unit-sales-ledger-design.md` (the design; it names spec §22 and the amendments). Read it before any task.

## Global Constraints

- **Both engines mirror.** Every arithmetic change lands in Python and TypeScript with identical results to the penny. Python rounding is `money_round` (`app/financial_model/engine.py:18`); TS is bare `Math.round`. Percentages are `pct()` (`engine.py:23`, `frontend/src/lib/model/pct.ts`) — 2 dp, `None`/`null` on a zero denominator. **Never use Python builtin `round()`.**
- **No calculation logic in React components or the memo.** Surfaces read result blocks; they never recompute (`run.metrics.unit_sales`, `run.schedule.unit_sales`).
- **Versions:** calc `2.13.0` → `2.14.0` (`app/financial_model/types.py:1039`, `frontend/src/lib/model/finance-types.ts:779`); inputs `v11` → `v12`. The entry-point cutover is the LAST task.
- **Standing instruction for every implementer:** if a number in this plan does not reconcile with what the code prints, SAY SO in your report — never adjust the number to match the code. Locate code by content (line numbers drift as tasks land) and verify every field name against source before use.
- **Naming:** input block `unit_sales`; result block `unit_sales`; module `unit_sales.py` / `unit-sales.ts`; lever `sales_slip`; override field `sales_slip_months`; fixture stem `x-unit-sales-ledger`.
- **Spec references** in code comments use the form `R13b spec Sec 22.N` (Python) / `R13b spec §22.N` (TS), matching the file conventions.
- **Commits:** one per task, conventional style `feat(r13b): …` / `fix(r13b): …` / `test(r13b): …` / `docs(r13b): …`, on branch `release-13b-unit-sales-ledger`.

## Plan-time design corrections (recorded, applied in this plan)

1. **No Excel sheet.** `frontend/src/lib/export-excel.ts` exports only the projects list; an appraisal workbook was deliberately dropped under spec §11.9 and none exists to extend. The design's "Excel — the per-unit table as its own sheet" is withdrawn; the design doc §9/§16 are corrected in Task 14.
2. **Release-plan collision.** R15's row already claims inputs v12. R13b takes v12; R15's row moves to v13 (Task 14).
3. **Spec §12.6 still says "the five §12.1 levers"** (stale since R13) — corrected to nine in Task 14; and the changelog lacks R14's 2.13.0 bullet (R14 debt) — added in Task 14.

## Hand-derived figures (authoritative for every test below)

The four-unit document (fixture X and every builder variant unless a variant says otherwise). Pence throughout.

| unit | type | value | ancillary | **gross** | deposit % | agent % | legal (input) |
|---|---|---|---|---|---|---|---|
| u1 | 2bed 80 sqm | 25,000,000 | parking 1 space 1,000,000 | **26,000,000** | 10 | null (→1.5) | null |
| u2 | 3bed 95 sqm | 30,000,000 | 0 | **30,000,000** | 10 | null (→1.5) | 150,000 |
| u3 | 1bed 55 sqm | 17,500,000 | 0 | **17,500,000** | 0 | 2.0 | null |
| u4 | 2bed 75 sqm | 21,000,000 | 0 | **21,000,000** | 5 | null (→1.5) | null |

Scheme: `selling_agent_fee_pct 1.5`, `selling_legal_fee_pence 500,000`. G = **94,500,000**.

| unit | deposit | agent | legal | net |
|---|---|---|---|---|
| u1 | 2,600,000 | 390,000 | 201,550 (= round(500,000 × 26,000,000 / 64,500,000) = round(201,550.39)) | 25,408,450 |
| u2 | 3,000,000 | 450,000 | 150,000 (override) | 29,400,000 |
| u3 | 0 | 350,000 | 135,659 (= round(500,000 × 17,500,000 / 64,500,000) = round(135,658.91)) | 17,014,341 |
| u4 | 1,050,000 | 315,000 | **162,791 (residue: 500,000 − 201,550 − 135,659)** | 20,522,209 |
| Σ | 6,650,000 | 1,505,000 | 650,000 | 92,345,000 |

Null-legal base = 26,000,000 + 17,500,000 + 21,000,000 = 64,500,000. `selling_costs_pence` = 1,505,000 + 650,000 = **2,155,000**. Check: 94,500,000 − 2,155,000 = 92,345,000 ✓.

**Fixture X timing** (programme in Task 2; resolved months): u1 exchange **8** (`marketing+0`), completion **12** (`practical_completion+0`); u2 exchange **10** (fixed), completion **13** (`practical_completion+1`); u3 exchange null → effective **13**, completion **13** (`unit_completions+1`); u4 exchange **11** (fixed), completion **20** (fixed). `deposit_release: released_on_exchange`.

Receipts by month (X): m8 gross 2,600,000; m10 gross 3,000,000; m11 gross 1,050,000; m12 gross 23,400,000 / agent 390,000 / legal 201,550; m13 gross 44,500,000 (27,000,000 + 17,500,000) / agent 800,000 / legal 285,659; m20 gross 19,950,000 / agent 315,000 / legal 162,791. Σ gross = 94,500,000 ✓. Disposal months = [8, 10, 11, 12, 13, 20].

Cumulative series (X): exchanged m8 26,000,000 → m10 56,000,000 → m11 77,000,000 → m13 94,500,000; completed m12 26,000,000 → m13 73,500,000 → m20 94,500,000; deposits_received m8 2,600,000, m10 3,000,000, m11 1,050,000, else 0.

Pre-sold (X): reference month **12** (earliest `practical_completion` start), basis `practical_completion`, exchanged ≤ 12 = u1 + u2 + u4 = **77,000,000**, pct = `pct(77,000,000, 94,500,000)` = **81.48**.

Variants: **held twin** — same rows, `held_to_completion`: no deposit months, m12 gross 26,000,000, m13 gross 47,500,000, m20 gross 21,000,000; deposits_pence total still 6,650,000, deposits_released_pence 0. **pc-early** — construction duration 5: PC at 9, `unit_completions` 9–11, marketing 8–11; u1 completion 9, u2 completion 10, u3 completion 10, u4 20; exchanged ≤ 9 = u1 only = 26,000,000 → pct **27.51**, reference 9, basis `practical_completion`. **no-programme** — `programme: null`, anchored events rewritten to fixed months 8/12/13/13; basis `first_completion`, reference 12, pct 81.48. **residue** — three units of 10,000,000 each, scheme legal 100, agent 0, all overrides null → legal [33, 33, 34].

**Fixture S (break-even correction):** current `senior_breakeven_pence` in BOTH engines = **90,971,520** (replayed at raw months 20/21). Post-fix, replayed at the resolved months 16/19 = **88,720,089** (computed with the shipped solver handed resolved months). S's draws run months 0–13.

---

## File Structure

**Created**
- `app/financial_model/unit_sales.py` — pure per-unit derivation + result block (Task 3)
- `frontend/src/lib/model/unit-sales.ts` — input types (Task 1) + the TS twin of the derivation (Task 4)
- `tests/fixtures_unit_sales.py`, `frontend/src/lib/model/__fixtures__/unit-sales-docs.ts` — document builders from fixture X (Task 2)
- `fixtures/financial-model/x-unit-sales-ledger.json` — golden fixture (Task 2 inputs, Task 7 pins)
- `tests/test_migrate_v12.py` (Task 1), `tests/test_financial_model_unit_sales.py` (Task 3), `frontend/src/lib/model/unit-sales.test.ts` (Task 4)
- `frontend/src/components/calculator/UnitSalesEditor.tsx` + `.test.tsx` (Task 11)

**Modified (by task)**
- T1 schema/migration: `app/financial_model/types.py`, `migrate.py`, `frontend/src/lib/model/finance-types.ts`, `migrate.ts`, `index.ts`, `frontend/src/lib/conversion-types.ts`, `conversion-defaults.ts`, tests listed in the task, spec lines 3 and 59
- T2 fixture X + builders + rosters: `tests/test_financial_model_fixtures.py`, `frontend/src/lib/model/golden-fixtures.test.ts`, `tests/test_migrate_v10.py`, `tests/test_migrate_v11.py`, `tests/test_migrate_v12.py`, `frontend/src/lib/model/migrate.test.ts`
- T5 validation: `app/financial_model/validation.py`, `frontend/src/lib/model/validation.ts`
- T6 ledger: `app/financial_model/schedule.py`, `metrics.py`, `frontend/src/lib/model/schedule.ts`, `metrics.ts`, `finance-types.ts`
- T8/T9 break-even: `app/financial_model/breakeven.py`, `metrics.py`, `frontend/src/lib/model/breakeven.ts`, `metrics.ts`, `fixtures/financial-model/s-dated-programme.json`
- T10 lever: `app/financial_model/apply_scenario.py`, `sensitivity.py`, `frontend/src/lib/model/apply-scenario.ts`, `sensitivity.ts`, `frontend/src/lib/sensitivity-format.ts`, `frontend/src/components/calculator/SensitivityPage.tsx`, `ScenariosPage.tsx`
- T11–T13 surfaces: `ExitStrategyPage.tsx`, `CashflowPage.tsx`, `frontend/src/lib/export-investment-memo.ts`, `frontend/src/lib/report-qa/memo-fixtures.ts`, `memo-release-gate.test.ts`
- T14 docs: `docs/financial-model/calculation-specification.md`, `migration-notes.md`, `model-governance.md`, `test-cases.md`, `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`, the design doc
- T15 cutover: `app/api/app.py`, `app/models.py`, `frontend/src/components/ConversionCalculator.tsx`, `ExportPage.tsx`, `conversion-defaults.ts`, both entry-point guards

---

### Task 1: Inputs v12 schema and migration, both engines

**Files:**
- Modify: `app/financial_model/types.py` (after `PhaseAnchor`/`SalesPhasingInputsV9` ~L436; `ScenarioOverrides` L148–165; `CalculatorInputsV11` L946–953; `AnyCalculatorInputs` L956; `parse_calculator_inputs` L963; `CALC_VERSION` L1039)
- Modify: `app/financial_model/migrate.py` (imports L24–37; `is_v2_or_later` L318–346; append after `migrate_inputs_to_v11` L1762)
- Create: `frontend/src/lib/model/unit-sales.ts` (input types only in this task)
- Modify: `frontend/src/lib/model/finance-types.ts` (`CalculatorInputsV11` L392–395, `AnyCalculatorInputs` L397–400, re-export block ~L173–185, `CALC_VERSION` L779)
- Modify: `frontend/src/lib/conversion-types.ts` (`ScenarioOverrides` L78–103)
- Modify: `frontend/src/lib/conversion-defaults.ts` (`DEFAULT_SCENARIOS` L107–161: add `sales_slip_months: 0` to all four)
- Modify: `frontend/src/lib/model/migrate.ts` (append after `migrateInputsToV11` L1276), `frontend/src/lib/model/index.ts` (L52)
- Modify: `docs/financial-model/calculation-specification.md` line 3 (`2.13.0` → `2.14.0`) and line 59 (§1.6 list)
- Modify: the nine `2.13.0` literals: `tests/test_financial_model_types.py:139` (rename test to `test_calc_version_is_2_14_0`), `tests/test_appraisal_governance.py:165,197,473`, `tests/test_lender_case_governance.py:29`, `frontend/src/lib/safe-run.test.ts:12`, `frontend/src/components/calculator/LenderCasePage.test.tsx:66`, `frontend/src/components/ExportPage.test.tsx:195`, `frontend/src/lib/report-provenance.test.ts:432`
- Create: `tests/test_migrate_v12.py`; Modify: `frontend/src/lib/model/migrate.test.ts` (append a v12 block), `tests/test_financial_model_types.py` (v12 parse tests)

**Interfaces:**
- Produces (Python): `DepositRelease`, `SaleEvent`, `UnitSale`, `UnitSalesInputs`, `CalculatorInputsV12` (subclass of V11 with `unit_sales: UnitSalesInputs | None = None`), `ScenarioOverrides.sales_slip_months: int = 0`, `is_v12`, `migrate_v11_to_v12`, `migrate_inputs_to_v12(snapshot, project=None)`, `_RECOGNISED_VERSIONS_V12`, `CALC_VERSION == "2.14.0"`.
- Produces (TS): in `unit-sales.ts`: `DepositRelease`, `DEPOSIT_RELEASE_VALUES`, `SaleEvent`, `UnitSale`, `UnitSalesInputs`; in `finance-types.ts`: `CalculatorInputsV12 extends Omit<CalculatorInputsV11,'inputs_version'> { inputs_version: 12; unit_sales: UnitSalesInputs | null }`, `AnyCalculatorInputs` gains V12; `ScenarioOverrides.sales_slip_months: number`; `migrateV11toV12`, `migrateInputsToV12`; `CALC_VERSION = '2.14.0'`.

- [ ] **Step 1: Python types.** In `app/financial_model/types.py`, after `SalesPhasingInputsV9`/`RefinanceInputsV9` (search `class RefinanceInputsV9`), add:

```python
DepositRelease = Literal["held_to_completion", "released_on_exchange"]


class SaleEvent(Model):
    """R13b spec Sec 22.1. Sec 18.6's `{month_offset, anchor}` pair, reused
    verbatim: resolved by schedule.py's single resolver, `anchor=None` means
    "use month_offset". `month_offset` carries only the resource-exhaustion
    ceiling, for the reason SalesPhasingTranche gives; the [0, term-1] window
    is validation.py's (Sec 22.7 rule 4)."""

    month_offset: int = Field(le=1200)
    anchor: PhaseAnchor | None = None


class UnitSale(Model):
    """R13b spec Sec 22.1. One row per SOLD unit (Sec 22.7 rule 3). Nullable
    overrides fall back to the scheme figures on exit_strategy; `exchange`
    None means exchange and completion are simultaneous and requires
    deposit_pct == 0 (rule 6)."""

    unit_id: str
    exchange: SaleEvent | None = None
    completion: SaleEvent
    deposit_pct: float
    agent_fee_pct: float | None = None
    legal_fee_pence: int | None = None


class UnitSalesInputs(Model):
    deposit_release: DepositRelease
    units: list[UnitSale] = Field(default_factory=list, max_length=1200)
```

In `ScenarioOverrides` (after `vacancy_adjustment_pct: float = 0.0`) add:

```python
    # R13b spec Sec 22.8. Defaulted so every existing construction site and
    # fixture keeps parsing; the v12 MIGRATION writes it explicitly anyway
    # (Sec 22.9), which is what the identity gate actually asserts.
    sales_slip_months: int = 0
```

After `CalculatorInputsV11` add:

```python
class CalculatorInputsV12(CalculatorInputsV11):
    """Mirrors CalculatorInputsV11 with the Sec 22 unit-level sales ledger.
    Subclasses V11 for the same reason V11 subclasses V10: the engine
    dispatches on it, and a flat re-declaration would make those isinstance
    checks silently False for v12 documents."""

    inputs_version: Literal[12] = 12  # type: ignore[assignment]
    unit_sales: UnitSalesInputs | None = None
```

Add `| CalculatorInputsV12` to `AnyCalculatorInputs`; in `parse_calculator_inputs` add, FIRST:

```python
    # R11 ruling R10, applied one version on: without this branch a v12 document
    # falls through to the CalculatorInputsV2 default, silently dropping the
    # unit-sales block and every other post-v2 field.
    if version == 12:
        return CalculatorInputsV12.model_validate(doc)
```

Set `CALC_VERSION = "2.14.0"`.

- [ ] **Step 2: Python migration.** In `app/financial_model/migrate.py` add `CalculatorInputsV12` to the `.types` import. In `is_v2_or_later`, extend the return to `... or is_v11(snapshot) or is_v12(snapshot)`. Append at end of file:

```python
def _v12_scenarios(scenarios: dict[str, Any] | None) -> dict[str, Any]:
    """The scenarios half of the v11 -> v12 write: ``sales_slip_months: 0`` on
    all four scenarios (spec Sec 22.8). Mirrors ``_v10_scenarios`` two
    migrations back -- ``ScenarioOverrides`` already defaults the field, so
    only a WRITTEN value is what the numeric identity gate exercises."""
    out = dict(scenarios or {})
    for key in ("base", "upside", "downside", "severe"):
        s = dict(out.get(key) or {})
        s["sales_slip_months"] = 0
        out[key] = s
    return out


def is_v12(snapshot: dict[str, Any]) -> bool:
    """A v12 document is discriminated by ``inputs_version == 12`` AND the
    presence of the (possibly null) ``unit_sales`` key. Port of isV12."""
    return snapshot.get("inputs_version") == 12 and "unit_sales" in snapshot


def migrate_v11_to_v12(v11: dict[str, Any] | CalculatorInputsV11) -> CalculatorInputsV12:
    """Upgrades a v11 document to v12 by stamping ``inputs_version: 12`` and
    writing two inert additions: ``unit_sales: None`` and
    ``scenarios.<each>.sales_slip_months: 0`` (spec Sec 22.9). Port of
    migrateV11toV12. Purely additive by construction: every existing document
    is bit-identical in every output -- test_migrate_v12.py proves it.

    Precondition: `v11` must not already be a v12 document (idempotence guard),
    same as migrate_v10_to_v11.
    """
    if isinstance(v11, CalculatorInputsV12):
        raise ValueError("migrate_v11_to_v12: input is already a v12 document")
    if isinstance(v11, BaseModel):
        doc = v11.model_dump(mode="json")
    else:
        if is_v12(v11):
            raise ValueError("migrate_v11_to_v12: input is already a v12 document")
        doc = dict(v11)

    doc["unit_sales"] = None
    doc["scenarios"] = _v12_scenarios(doc.get("scenarios"))
    doc["inputs_version"] = 12
    return CalculatorInputsV12.model_validate(doc)


_RECOGNISED_VERSIONS_V12 = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)


def migrate_inputs_to_v12(
    snapshot: dict[str, Any], project: dict[str, Any] | None = None,
) -> CalculatorInputsV12:
    """Normalises any stored snapshot (v1-v12) to v12. Port of
    migrateInputsToV12, structurally identical to migrate_inputs_to_v11."""
    version = snapshot.get("inputs_version")
    if version is not None and version not in _RECOGNISED_VERSIONS_V12:
        raise ValueError(
            f"migrate_inputs_to_v12: unrecognised inputs_version {version!r} "
            f"(expected one of {_RECOGNISED_VERSIONS_V12}, or absent for a v1 document)"
        )
    if version == 12 and not is_v12(snapshot):
        raise ValueError(
            "migrate_inputs_to_v12: inputs_version is 12 but the document fails "
            "the v12 structural check (missing `unit_sales`) -- refusing to "
            "silently reinterpret it via the v1 fallback path"
        )
    if is_v12(snapshot):
        defaults = migrate_v11_to_v12(
            migrate_v10_to_v11(
                migrate_v9_to_v10(
                    migrate_v8_to_v9(
                        migrate_v7_to_v8(
                            migrate_v6_to_v7(
                                migrate_v5_to_v6(
                                    migrate_v4_to_v5(
                                        migrate_v3_to_v4(migrate_v2_to_v3(default_calculator_inputs_v2(project))),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        ).model_dump(mode="json")
        return CalculatorInputsV12.model_validate({
            **_merge_saved_onto_defaults(defaults, snapshot),
            "inputs_version": 12,
            "areas": {**defaults["areas"], **(snapshot.get("areas") or {})},
            "cost_plan": {**defaults["cost_plan"], **(snapshot.get("cost_plan") or {})},
            "vat": {**defaults["vat"], **(snapshot.get("vat") or {})},
            "programme": snapshot.get("programme"),
            "sales_phasing": snapshot.get("sales_phasing"),
            "refinance": snapshot.get("refinance"),
            "investment_case": snapshot.get("investment_case"),
            "monitoring": snapshot.get("monitoring"),
            "unit_sales": snapshot.get("unit_sales"),
        })
    return migrate_v11_to_v12(migrate_inputs_to_v11(snapshot, project))
```

Copy the defensive-quartet comment from `migrate_inputs_to_v11` (its L1743–1752) above the `"programme":` line, adding `unit_sales` to its list.

- [ ] **Step 3: TS input types.** Create `frontend/src/lib/model/unit-sales.ts`:

```ts
/**
 * R13b spec §22. The unit-level sales ledger: per-unit exchange/completion
 * timing, deposits held or released, per-unit selling-cost overrides.
 * Twin of app/financial_model/unit_sales.py. Task 1 declares the input
 * types; Task 4 adds the derivation. This module runs STRICTLY BEFORE the
 * ledger and reads nothing from it.
 */
import type { PhaseAnchor } from './finance-types';

export type DepositRelease = 'held_to_completion' | 'released_on_exchange';
export const DEPOSIT_RELEASE_VALUES: readonly DepositRelease[] =
  ['held_to_completion', 'released_on_exchange'];

/** §18.6's pair, reused verbatim. `anchor: null` = use `month_offset`. */
export interface SaleEvent {
  month_offset: number;
  anchor: PhaseAnchor | null;
}

export interface UnitSale {
  unit_id: string;
  /** null = exchange and completion are simultaneous; requires deposit_pct 0. */
  exchange: SaleEvent | null;
  completion: SaleEvent;
  /** 0..100, of the unit's gross (value + ancillary). */
  deposit_pct: number;
  /** null = scheme selling_agent_fee_pct. */
  agent_fee_pct: number | null;
  /** null = share of the scheme selling_legal_fee_pence (§22.2). */
  legal_fee_pence: number | null;
}

export interface UnitSalesInputs {
  deposit_release: DepositRelease;
  units: UnitSale[];
}
```

In `finance-types.ts`, beside the investment-case re-export block (~L173–181), add:

```ts
// R13b Task 1: the unit-sales input types live in unit-sales.ts (the
// investment-case pattern); Task 4 adds `UnitSalesResult` to this list.
export type { DepositRelease, SaleEvent, UnitSale, UnitSalesInputs } from './unit-sales';
export { DEPOSIT_RELEASE_VALUES } from './unit-sales';
```

and add `import type { UnitSalesInputs } from './unit-sales';` near the other type imports. After `CalculatorInputsV11` add:

```ts
/**
 * R13b spec §22.1. `unit_sales` is the only addition: a two-state field,
 * top level beside `investment_case` and `monitoring`, `null` = the document
 * does not use the per-unit path (every existing document, bit-identical per
 * the v12 identity gate); non-null = one row per sold unit.
 */
export interface CalculatorInputsV12 extends Omit<CalculatorInputsV11, 'inputs_version'> {
  inputs_version: 12;
  unit_sales: UnitSalesInputs | null;
}
```

Add `| CalculatorInputsV12` to `AnyCalculatorInputs`. Set `export const CALC_VERSION = '2.14.0';`.

In `conversion-types.ts` `ScenarioOverrides` add after `vacancy_adjustment_pct`:

```ts
  /** R13b spec §22.8. SIGNED months added to every unit_sales row's
   *  completion (anchor.offset_months when anchored, else month_offset),
   *  ADDITIVELY. No-op by construction when unit_sales is null. */
  sales_slip_months: number;
```

In `conversion-defaults.ts` `DEFAULT_SCENARIOS`, add `sales_slip_months: 0,` to each of base/upside/downside/severe.

- [ ] **Step 4: TS migration.** Append to `migrate.ts` (import `CalculatorInputsV12` from `./finance-types`):

```ts
/** Mirror of isV11: `inputs_version === 12` AND the (possibly null) `unit_sales` key. */
function isV12(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV12 {
  return snapshot.inputs_version === 12 && 'unit_sales' in snapshot;
}

/**
 * R13b spec §22.9. Two additions, both inert: `unit_sales: null` and
 * `scenarios.<each>.sales_slip_months: 0`. Every existing document is
 * bit-identical in every output — the numeric identity gate proves it.
 */
export function migrateV11toV12(v11: CalculatorInputsV11): CalculatorInputsV12 {
  if (isV12(v11 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV11toV12: input is already a v12 document');
  }
  const withSalesSlip = (s: ScenarioOverrides): ScenarioOverrides => ({ ...s, sales_slip_months: 0 });
  return {
    ...v11,
    inputs_version: 12,
    unit_sales: null,
    scenarios: {
      base: withSalesSlip(v11.scenarios.base),
      upside: withSalesSlip(v11.scenarios.upside),
      downside: withSalesSlip(v11.scenarios.downside),
      severe: withSalesSlip(v11.scenarios.severe),
    },
  };
}

const RECOGNISED_INPUTS_VERSIONS_V12: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function migrateInputsToV12(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV12 {
  const version = snapshot.inputs_version;
  if (
    version !== undefined && version !== null
    && !RECOGNISED_INPUTS_VERSIONS_V12.includes(version as number)
  ) {
    throw new Error(
      `migrateInputsToV12: unrecognised inputs_version ${JSON.stringify(version)} `
      + `(expected one of ${RECOGNISED_INPUTS_VERSIONS_V12.join(', ')}, or absent for a v1 document)`,
    );
  }
  if (version === 12 && !isV12(snapshot)) {
    throw new Error(
      'migrateInputsToV12: inputs_version is 12 but the document fails the v12 structural check '
      + '(missing `unit_sales`) -- refusing to silently reinterpret it via the v1 fallback path',
    );
  }
  if (isV12(snapshot)) {
    const defaults = migrateV11toV12(migrateV10toV11(migrateV9toV10(migrateV8toV9(migrateV7toV8(migrateV6toV7(
      migrateV5toV6(migrateV4toV5(migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2(project))))),
    ))))));
    const saved = snapshot as unknown as Partial<CalculatorInputsV12>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 12,
      areas: { ...defaults.areas, ...(saved.areas ?? {}) },
      acquisition: { ...defaults.acquisition, ...(saved.acquisition ?? {}) },
      unit_mix: unitsWithAncillary(saved.unit_mix ?? defaults.unit_mix),
      conversion_costs: { ...defaults.conversion_costs, ...(saved.conversion_costs ?? {}) },
      cost_plan: { ...defaults.cost_plan, ...(saved.cost_plan ?? {}) },
      vat: { ...defaults.vat, ...(saved.vat ?? {}) },
      finance: { ...defaults.finance, ...(saved.finance ?? {}) },
      equity_sources: saved.equity_sources ?? defaults.equity_sources,
      exit_strategy: { ...defaults.exit_strategy, ...(saved.exit_strategy ?? {}) },
      risks: saved.risks ?? defaults.risks,
      programme: saved.programme ?? null,
      sales_phasing: saved.sales_phasing ?? null,
      refinance: saved.refinance ?? null,
      investment_case: saved.investment_case ?? null,
      monitoring: saved.monitoring ?? null,
      unit_sales: saved.unit_sales ?? null,
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
    };
  }
  return migrateV11toV12(migrateInputsToV11(snapshot, project));
}
```

In `index.ts` L52 add `migrateV11toV12, migrateInputsToV12,` after `migrateV10toV11, migrateInputsToV11,`.

- [ ] **Step 5: Spec lines the version guard reads.** `docs/financial-model/calculation-specification.md` line 3: `Calculation version 2.13.0` → `2.14.0`. Line 59 (§1.6): after `…(adds the top-level nullable \`monitoring\` block, §20)` insert `; \`12\` (**inputs v12**) = calc 2.14.0+ (adds the top-level nullable \`unit_sales\` block and the \`sales_slip_months\` scenario field, §22)` before `. Outputs are only comparable`.

- [ ] **Step 6: Bump the nine `2.13.0` literals** listed in Files (each is an equality/`toContain` assertion on `CALC_VERSION`; rename `test_calc_version_is_2_13_0` → `test_calc_version_is_2_14_0`).

- [ ] **Step 7: Write the Python gate `tests/test_migrate_v12.py`.** Port `tests/test_migrate_v11.py` wholesale with these substitutions: imports `migrate_inputs_to_v11, migrate_inputs_to_v12, migrate_v11_to_v12`, `CalculatorInputsV12`; corpus filter `inputs_version <= 11`; bound test:

```python
def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    assert len(FIXTURES) >= 18
    version_excluded = [
        p for p in ALL_FIXTURES
        if _FIXTURE_DOCS[p].get("kind") != "sensitivity"
        and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) > 11
    ]
    # Task 2 adds the v12-native fixture X and changes this to
    # ["x-unit-sales-ledger"]; until then no document is v12-native.
    assert sorted(p.stem for p in version_excluded) == []
```

`_metrics_dict` pops `calc_version` and `monitoring_statement` exactly as v11's does. Numeric identity compares `migrate_inputs_to_v11(raw, None)` vs `migrate_inputs_to_v12(raw, None)` on `_metrics_dict`, `asdict(run.model)`, `asdict(run.schedule)`. Property 1 (alias map `{}`). Write:

```python
def test_migration_writes_only_null_and_zero():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v11 = migrate_inputs_to_v11(raw, None)
    v12 = migrate_v11_to_v12(v11)
    assert v12.inputs_version == 12
    assert v12.unit_sales is None
    for name in ("base", "upside", "downside", "severe"):
        assert getattr(v12.scenarios, name).sales_slip_months == 0
    dumped = v12.model_dump(mode="json")
    assert "sales_slip_months" in dumped["scenarios"]["base"]  # WRITTEN, not defaulted


def test_migration_actively_overwrites_a_stray_unit_sales_block():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    doc = migrate_inputs_to_v11(raw, None).model_dump(mode="json")
    doc["unit_sales"] = {"poison": True}
    assert migrate_v11_to_v12(doc).unit_sales is None


def test_is_v2_or_later_recognises_v12():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v12 = migrate_inputs_to_v12(raw, None).model_dump(mode="json")
    assert is_v2_or_later(v12) is True


def test_migrate_inputs_to_v12_refuses_an_unrecognised_version():
    with pytest.raises(ValueError, match="unrecognised inputs_version 13"):
        migrate_inputs_to_v12({"inputs_version": 13})


def test_migrate_inputs_to_v12_refuses_a_document_tagged_v12_that_fails_the_structural_check():
    with pytest.raises(ValueError, match="fails the v12 structural check"):
        migrate_inputs_to_v12({"inputs_version": 12})


def test_migrate_v11_to_v12_refuses_double_migration():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v12 = migrate_inputs_to_v12(raw, None)
    with pytest.raises(ValueError, match="already a v12 document"):
        migrate_v11_to_v12(v12)
```

Properties 2 and 3 are Task 5's (they need §22.7's rules to exist). Leave a comment saying so.

- [ ] **Step 8: Python parse tests.** In `tests/test_financial_model_types.py` add beside the v11 block:

```python
def _minimal_v12_doc(unit_sales=None):
    doc = _minimal_v11_doc()
    doc["inputs_version"] = 12
    doc["unit_sales"] = unit_sales
    return doc


def test_parse_dispatch_routes_v12_to_v12_with_unit_sales():
    parsed = parse_calculator_inputs(_minimal_v12_doc({
        "deposit_release": "released_on_exchange",
        "units": [{
            "unit_id": "u1", "exchange": {"month_offset": 3, "anchor": None},
            "completion": {"month_offset": 6, "anchor": None},
            "deposit_pct": 10, "agent_fee_pct": None, "legal_fee_pence": None,
        }],
    }))
    assert isinstance(parsed, CalculatorInputsV12)
    assert parsed.inputs_version == 12
    assert parsed.unit_sales.units[0].completion.month_offset == 6
    assert parsed.scenarios.base.sales_slip_months == 0


def test_v12_unit_sales_null_parses():
    assert parse_calculator_inputs(_minimal_v12_doc(None)).unit_sales is None


def test_v12_rejects_an_unknown_deposit_release():
    with pytest.raises(ValidationError):
        parse_calculator_inputs(_minimal_v12_doc({"deposit_release": "maybe", "units": []}))
```

(`ValidationError` is pydantic's; import as the file already does for its other rejection tests.)

- [ ] **Step 9: TS migration tests.** Append to `migrate.test.ts` a `describe('v12 migration -- spec §22.9')` block ported from the v11 block (L1209–1414): corpus filter `versionOf(doc) <= 11`, `expect(fixtures.length).toBeGreaterThanOrEqual(18)`, `versionExcluded` `toEqual([])` (Task 2 changes it to `['x-unit-sales-ledger.json']`), numeric identity between `migrateInputsToV11` and `migrateInputsToV12` with `metricsSansExcluded`, plus:

```ts
  it('writes unit_sales: null and sales_slip_months: 0 on all four scenarios, nothing else', () => {
    const v11 = migrateInputsToV11(fixtureDocs.find(({ file }) => file === 'j-blended-refinance.json')!.doc.inputs as Record<string, unknown>);
    const v12 = migrateV11toV12(v11);
    expect(v12.inputs_version).toBe(12);
    expect(v12.unit_sales).toBeNull();
    for (const k of ['base', 'upside', 'downside', 'severe'] as const) {
      expect(v12.scenarios[k].sales_slip_months).toBe(0);
    }
    const { inputs_version: _a, unit_sales: _b, scenarios: _c, ...restV12 } = v12;
    const { inputs_version: _d, scenarios: _e, ...restV11 } = v11;
    expect(restV12).toEqual(restV11);
  });
  it('refuses double migration and unrecognised versions', () => {
    expect(() => migrateInputsToV12({ inputs_version: 13 })).toThrow(/unrecognised inputs_version 13/);
    expect(() => migrateInputsToV12({ inputs_version: 12 })).toThrow(/fails the v12 structural check/);
  });
```

and a merge-onto-defaults test mirroring the v11 one: a v12 snapshot carrying a saved `unit_sales` block survives `migrateInputsToV12` (use the one-row block from Step 8 shaped in TS).

- [ ] **Step 10: Run the gates.** `python -m pytest -q tests/test_migrate_v12.py tests/test_financial_model_types.py tests/test_migrate_v11.py tests/test_appraisal_governance.py tests/test_lender_case_governance.py` → all pass. From `frontend/`: `npx tsc -b && npx vitest run src/lib/model/migrate.test.ts src/lib/model/spec-versions.test.ts src/lib/safe-run.test.ts src/lib/report-provenance.test.ts src/components` → pass. Then the full `python -m pytest -q` and `npm test` — expected all green (the entry-point guards still pass because nothing production-side calls v12 yet).

- [ ] **Step 11: Commit.** `git add -A && git commit -m "feat(r13b): inputs v12 schema and migration, calc 2.14.0 (spec 22.1, 22.9)"`

---

### Task 2: Fixture X inputs, rosters, and the document builders

**Files:**
- Create: `fixtures/financial-model/x-unit-sales-ledger.json`
- Create: `tests/fixtures_unit_sales.py`, `tests/test_fixtures_unit_sales.py`
- Create: `frontend/src/lib/model/__fixtures__/unit-sales-docs.ts`, `unit-sales-docs.test.ts`
- Modify: `tests/test_financial_model_fixtures.py` (`EXPECTED_FIXTURE_STEMS` L61–81; version groups L301–345: add `_V12_FIXTURES` and its pin `["x-unit-sales-ledger"]`; `_PRE_V7_FIXTURES`/`_PRE_V8_FIXTURES` tuples gain `12`), `frontend/src/lib/model/golden-fixtures.test.ts` (`EXPECTED_FIXTURE_STEMS` L76–96; version groups L268–324: add `v12Fixtures` pinned to X's name)
- Modify: `tests/test_migrate_v10.py:130-142` (excluded 4 → 5, add `"x-unit-sales-ledger"`), `tests/test_migrate_v11.py:84-94` (1 → 2, `["w-monitoring-on-site", "x-unit-sales-ledger"]`), `tests/test_migrate_v12.py` (`== ["x-unit-sales-ledger"]`), `frontend/src/lib/model/migrate.test.ts` v10/v11/v12 blocks likewise (`.json` names)

**Interfaces:**
- Produces (Python `tests/fixtures_unit_sales.py`): `unit_sales_doc(overrides: dict | None = None) -> CalculatorInputsV12` with keys `deposit_release: str`, `programme: None`, `pc_early: True`, `residue_case: True`, `unit_sales: None`, `sales_phasing_too: True`, `route: str`, `drop_row: str`, `extra_row: str`, `rows: list[dict]`; `held_twin_doc()`, `no_programme_doc()`, `pc_early_doc()`, `residue_doc()`, `sold_gross(doc) -> list[tuple[str, int]]`, `anchor_resolver(doc)`.
- Produces (TS `unit-sales-docs.ts`): `unitSalesDoc(overrides: UnitSalesDocOverrides = {})`, `heldTwinDoc()`, `noProgrammeDoc()`, `pcEarlyDoc()`, `residueDoc()`, `soldGross(doc)`, `anchorResolver(doc)`, `memoText(doc)` (re-export from investment-case-docs' helper, widened to V12).

- [ ] **Step 1: Author the fixture.** Create `fixtures/financial-model/x-unit-sales-ledger.json` with EXACTLY these inputs (copy `areas`, `vat`, `deal_spider` verbatim from `s-dated-programme.json`; everything else as written). `expected_metrics` carries only the two engine-invariant pins now; Task 7 completes it.

```json
{
  "name": "X — unit sales ledger, released deposits, per-unit costs, anchored completions",
  "kind": "pipeline",
  "note": "R13b spec §22. Four units of unequal value (u1 carries 1,000,000p parking), sell_all, a seven-phase network with a practical_completion milestone, released deposits, one agent override (u3 2.0%), one legal override (u2 150,000p). Hand figures: gross 94,500,000; deposits 2,600,000/3,000,000/0/1,050,000; agent 390,000/450,000/350,000/315,000; legal 201,550/150,000/135,659/162,791 (u4 absorbs the null-legal residue); net 92,345,000; selling costs 2,155,000; resolved exchange 8/10/—/11, completion 12/13/13/20; pre-sold 77,000,000 of 94,500,000 = 81.48% at month 12 (practical_completion basis). See test-cases.md §22.",
  "inputs": {
    "inputs_version": 12,
    "project_id": null,
    "acquisition": {"purchase_price_pence": 30000000, "legal_fees_pence": 300000, "survey_cost_pence": 100000, "broker_fee_pct": 0, "other_acquisition_costs_pence": 0, "jurisdiction": "england_ni", "jurisdiction_source": "user", "jurisdiction_evidence_status": "confirmed", "acquisition_date": "2026-09-01", "acquisition_tax_override_pence": null, "acquisition_tax_override_reason": ""},
    "areas": { "…copy from s-dated-programme.json…": 0 },
    "unit_mix": {"units": [
      {"id": "u1", "type": "2bed", "floor_area_sqm": 80, "estimated_value_pence": 25000000, "comparable_notes": "", "ancillary": {"balcony_terrace_sqm": 0, "balcony_terrace_value_pence": 0, "parking_spaces": 1, "parking_value_pence": 1000000}},
      {"id": "u2", "type": "3bed", "floor_area_sqm": 95, "estimated_value_pence": 30000000, "comparable_notes": "", "ancillary": {"balcony_terrace_sqm": 0, "balcony_terrace_value_pence": 0, "parking_spaces": 0, "parking_value_pence": 0}},
      {"id": "u3", "type": "1bed", "floor_area_sqm": 55, "estimated_value_pence": 17500000, "comparable_notes": "", "ancillary": {"balcony_terrace_sqm": 0, "balcony_terrace_value_pence": 0, "parking_spaces": 0, "parking_value_pence": 0}},
      {"id": "u4", "type": "2bed", "floor_area_sqm": 75, "estimated_value_pence": 21000000, "comparable_notes": "", "ancillary": {"balcony_terrace_sqm": 0, "balcony_terrace_value_pence": 0, "parking_spaces": 0, "parking_value_pence": 0}}
    ]},
    "conversion_costs": {"prior_approval_fee_per_dwelling_pence": 0, "cil_s106_pence": 0, "architect_pence": 0, "structural_engineer_pence": 0, "mande_pence": 0, "planning_consultant_pence": 0, "building_control_pence": 0, "other_professional_fees_pence": 0, "construction_cost_per_sqm_pence": 0, "total_construction_sqm": 300, "contingency_pct": 0, "fire_safety_pence": 0, "sound_insulation_pence": 0, "part_l_compliance_pence": 0},
    "cost_plan": {"mode": "detailed",
      "packages": [
        {"id": "pkg-structure", "code": "structure", "label": "Structural repairs and new floors", "amount_pence": 12000000, "contingency_class": "general", "lender_eligible": true, "notes": "", "vat_override": null, "phase_id": null},
        {"id": "pkg-envelope", "code": "envelope", "label": "Envelope", "amount_pence": 8000000, "contingency_class": "general", "lender_eligible": true, "notes": "", "vat_override": null, "phase_id": null},
        {"id": "pkg-mande", "code": "mech_elec_public_health", "label": "M&E and public health", "amount_pence": 6000000, "contingency_class": "general", "lender_eligible": true, "notes": "", "vat_override": null, "phase_id": null}
      ],
      "contingency": [{"name": "general", "pct": 5}, {"name": "existing_building", "pct": 0}, {"name": "abnormal", "pct": 0}],
      "fee_lines": [
        {"id": "fee-architect", "code": "architect", "category": "professional", "label": "Architect", "basis": "fixed", "amount_pence": 1500000, "pct": 0, "per_dwelling": false, "vat_override": null, "phase_id": null},
        {"id": "fee-building-control", "code": "building_control", "category": "statutory", "label": "Building control", "basis": "fixed", "amount_pence": 200000, "pct": 0, "per_dwelling": false, "vat_override": null, "phase_id": null}
      ]},
    "programme": {"anchor_month": "2026-09", "phases": [
      {"id": "acquisition", "code": "acquisition", "label": "Acquisition", "duration_months": 1, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": []},
      {"id": "conditions", "code": "conditions", "label": "Conditions", "duration_months": 2, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "acquisition", "type": "FS", "lag_months": 0}]},
      {"id": "design", "code": "design", "label": "Design", "duration_months": 3, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "acquisition", "type": "FS", "lag_months": 0}]},
      {"id": "construction", "code": "construction", "label": "Construction", "duration_months": 8, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "design", "type": "FS", "lag_months": 0}]},
      {"id": "marketing", "code": "marketing", "label": "Marketing", "duration_months": 4, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "construction", "type": "SS", "lag_months": 4}]},
      {"id": "practical_completion", "code": "practical_completion", "label": "Practical completion", "duration_months": 0, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "construction", "type": "FS", "lag_months": 0}]},
      {"id": "unit_completions", "code": "unit_completions", "label": "Unit completions", "duration_months": 3, "slip_months": 0, "start_offset": 0, "curve": {"kind": "straight_line"}, "predecessors": [{"phase_id": "practical_completion", "type": "FS", "lag_months": 0}]}
    ], "category_phase_ids": {"construction": "construction", "professional": "design", "statutory": "conditions"}},
    "vat": { "…copy from s-dated-programme.json…": 0 },
    "finance": {"funding_source": "development_finance", "day_one_advance_pence": 0, "day_one_market_value_pence": null, "development_cost_advance_pct": 100, "committed_net_facility_pence": 45000000, "committed_gross_facility_pence": 52000000, "annual_interest_rate_pct": 12.0, "interest_type": "rolled_up", "arrangement_fee_pct": 2.0, "arrangement_fee_basis": "committed_net_facility", "exit_fee_pct": 1.0, "exit_fee_basis": "committed_gross_facility", "broker_fee_pence": 0, "lender_legal_fee_pence": 0, "valuation_fee_pence": 0, "monitoring_surveyor_fee_pence": 0, "interest_reserve_pence": null, "term_months": 24, "equity_draw_rule": "equity_first", "sales_sweep_pct": 100, "legacy_leverage_pct": null, "requires_confirmation": false, "enforcement_cost_assumption_pence": 0},
    "equity_sources": [{"id": "e1", "classification": "cash", "amount_pence": 20000000, "timing_month": 0, "repayment_priority": 1, "evidence_status": "confirmed", "notes": ""}],
    "exit_strategy": {"route": "sell_all", "selling_agent_fee_pct": 1.5, "selling_legal_fee_pence": 500000, "retained_units": []},
    "risks": [],
    "scenarios": {
      "base": {"label": "Base Case", "gdv_adjustment_pct": 0, "construction_cost_adjustment_pct": 0, "timeline_adjustment_months": 0, "interest_rate_adjustment_pct": 0, "phase_slip_phase_id": null, "phase_slip_months": 0, "exit_yield_adjustment_pct": 0, "operating_cost_adjustment_pct": 0, "vacancy_adjustment_pct": 0, "sales_slip_months": 0},
      "upside": {"label": "Upside", "gdv_adjustment_pct": 10, "construction_cost_adjustment_pct": -5, "timeline_adjustment_months": -2, "interest_rate_adjustment_pct": 0, "phase_slip_phase_id": null, "phase_slip_months": 0, "exit_yield_adjustment_pct": 0, "operating_cost_adjustment_pct": 0, "vacancy_adjustment_pct": 0, "sales_slip_months": 0},
      "downside": {"label": "Downside", "gdv_adjustment_pct": -10, "construction_cost_adjustment_pct": 15, "timeline_adjustment_months": 3, "interest_rate_adjustment_pct": 1, "phase_slip_phase_id": null, "phase_slip_months": 0, "exit_yield_adjustment_pct": 0, "operating_cost_adjustment_pct": 0, "vacancy_adjustment_pct": 0, "sales_slip_months": 0},
      "severe": {"label": "Severe", "gdv_adjustment_pct": -15, "construction_cost_adjustment_pct": 20, "timeline_adjustment_months": 6, "interest_rate_adjustment_pct": 2, "phase_slip_phase_id": null, "phase_slip_months": 0, "exit_yield_adjustment_pct": 0, "operating_cost_adjustment_pct": 0, "vacancy_adjustment_pct": 0, "sales_slip_months": 0}
    },
    "sales_phasing": null,
    "refinance": null,
    "investment_case": null,
    "monitoring": null,
    "unit_sales": {"deposit_release": "released_on_exchange", "units": [
      {"unit_id": "u1", "exchange": {"month_offset": 0, "anchor": {"phase_id": "marketing", "offset_months": 0}}, "completion": {"month_offset": 0, "anchor": {"phase_id": "practical_completion", "offset_months": 0}}, "deposit_pct": 10, "agent_fee_pct": null, "legal_fee_pence": null},
      {"unit_id": "u2", "exchange": {"month_offset": 10, "anchor": null}, "completion": {"month_offset": 0, "anchor": {"phase_id": "practical_completion", "offset_months": 1}}, "deposit_pct": 10, "agent_fee_pct": null, "legal_fee_pence": 150000},
      {"unit_id": "u3", "exchange": null, "completion": {"month_offset": 0, "anchor": {"phase_id": "unit_completions", "offset_months": 1}}, "deposit_pct": 0, "agent_fee_pct": 2.0, "legal_fee_pence": null},
      {"unit_id": "u4", "exchange": {"month_offset": 11, "anchor": null}, "completion": {"month_offset": 20, "anchor": null}, "deposit_pct": 5, "agent_fee_pct": null, "legal_fee_pence": null}
    ]},
    "deal_spider": { "…copy from s-dated-programme.json…": 0 },
    "lender_valuation": null
  },
  "expected_metrics": {
    "gdv_pence": 94500000,
    "gross_sales_pence": 94500000
  }
}
```

The three `"…copy…"` placeholders are instructions: paste S's block verbatim. Confirm the derived programme with a one-off script (`derive_phases` on the parsed programme): starts acquisition 0, conditions 1, design 1, construction 4, marketing 8, practical_completion 12, unit_completions 12; finish 15. If any start differs, STOP and report — every hand figure above depends on them.

- [ ] **Step 2: Rosters and bounds.** Add `"x-unit-sales-ledger"` at the end of both `EXPECTED_FIXTURE_STEMS` lists. In `test_financial_model_fixtures.py` add `_V12_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 12]` and extend the group test: rename to `test_every_fixture_is_v5_to_v12_and_each_group_is_non_empty`, assert `[p.stem for p in _V12_FIXTURES] == ["x-unit-sales-ledger"]`, and add `12` to the `_PRE_V7_FIXTURES`/`_PRE_V8_FIXTURES` exclusion tuples. In `golden-fixtures.test.ts` add `v12Fixtures` pinned to `['X — unit sales ledger, released deposits, per-unit costs, anchored completions']`. Update the four migrate-suite bounds (v10: excluded 5 incl. `x-unit-sales-ledger`; v11: 2; v12: `["x-unit-sales-ledger"]` / `['x-unit-sales-ledger.json']`).

- [ ] **Step 3: Run the corpus tests — expect X to PASS parity** (the engine ignores `unit_sales` until Task 6; both pins are unit-set totals it already computes): `python -m pytest -q tests/test_financial_model_fixtures.py tests/test_migrate_v10.py tests/test_migrate_v11.py tests/test_migrate_v12.py` and `npx vitest run src/lib/model/golden-fixtures.test.ts src/lib/model/migrate.test.ts src/lib/model/invariants.test.ts`. If the invariant suites reject X (e.g. a funding gap or a §7 identity), report the exact assertion — do not alter the fixture's economics without the controller.

- [ ] **Step 4: Python builders.** Create `tests/fixtures_unit_sales.py`:

```python
"""R13b document builders. Every builder starts from fixture X
(fixtures/financial-model/x-unit-sales-ledger.json) via migrate_inputs_to_v12,
never a hand-authored dict, so the tests and the golden corpus share one
document. Overrides are a snake_case dict, the fixtures_investment_case idiom.
Twin of frontend/src/lib/model/__fixtures__/unit-sales-docs.ts."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Callable

from app.financial_model.migrate import migrate_inputs_to_v12
from app.financial_model.programme import derive_phases
from app.financial_model.schedule import unit_ancillary_value_pence
from app.financial_model.types import CalculatorInputsV12, PhaseAnchor

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _raw_x() -> dict[str, Any]:
    return json.loads((FIXTURE_DIR / "x-unit-sales-ledger.json").read_text(encoding="utf-8"))["inputs"]


def _fixed(month: int) -> dict[str, Any]:
    return {"month_offset": month, "anchor": None}


def unit_sales_doc(overrides: dict[str, Any] | None = None) -> CalculatorInputsV12:
    """Fixture X, optionally altered. Keys:
    deposit_release: 'held_to_completion' | 'released_on_exchange'
    programme: None  -- drops the network; anchored events become the fixed
                        months they resolve to on X (u1 8/12, u2 13, u3 13)
    pc_early: True   -- construction duration 5 (PC at 9, unit_completions 9-11)
    residue_case: True -- three 10,000,000 units, scheme legal 100, agent 0,
                        rows all-null overrides, fixed completions 12/13/14
    unit_sales: None -- drop the block (the null path)
    sales_phasing_too: True -- ALSO set a single final-month tranche (rule 1 control)
    route: str       -- exit route
    drop_row: str    -- remove the row for that unit id
    extra_row: str   -- add a second row copying u4's for that unit id
    rows: list[dict] -- replace unit_sales.units wholesale (raw dicts)
    """
    o = dict(overrides or {})
    raw = _raw_x()
    if o.get("residue_case"):
        raw["unit_mix"]["units"] = [
            {**raw["unit_mix"]["units"][1], "id": f"r{i}", "estimated_value_pence": 10_000_000}
            for i in (1, 2, 3)
        ]
        raw["exit_strategy"]["selling_agent_fee_pct"] = 0
        raw["exit_strategy"]["selling_legal_fee_pence"] = 100
        raw["unit_sales"]["units"] = [
            {"unit_id": f"r{i}", "exchange": None, "completion": _fixed(11 + i),
             "deposit_pct": 0, "agent_fee_pct": None, "legal_fee_pence": None}
            for i in (1, 2, 3)
        ]
    if "deposit_release" in o:
        raw["unit_sales"]["deposit_release"] = o["deposit_release"]
    if o.get("pc_early"):
        for p in raw["programme"]["phases"]:
            if p["id"] == "construction":
                p["duration_months"] = 5
    if "programme" in o and o["programme"] is None:
        raw["programme"] = None
        rows = raw["unit_sales"]["units"]
        rows[0]["exchange"] = _fixed(8)
        rows[0]["completion"] = _fixed(12)
        rows[1]["completion"] = _fixed(13)
        rows[2]["completion"] = _fixed(13)
    if "route" in o:
        raw["exit_strategy"]["route"] = o["route"]
    if "rows" in o:
        raw["unit_sales"]["units"] = copy.deepcopy(o["rows"])
    if "drop_row" in o:
        raw["unit_sales"]["units"] = [r for r in raw["unit_sales"]["units"] if r["unit_id"] != o["drop_row"]]
    if "extra_row" in o:
        raw["unit_sales"]["units"].append({**copy.deepcopy(raw["unit_sales"]["units"][-1]), "unit_id": o["extra_row"]})
    if o.get("sales_phasing_too"):
        raw["sales_phasing"] = {"tranches": [{"month_offset": 23, "pct_of_gross_receipts": 100, "anchor": None}]}
    if "unit_sales" in o and o["unit_sales"] is None:
        raw["unit_sales"] = None
    return migrate_inputs_to_v12(raw, None)


def held_twin_doc() -> CalculatorInputsV12:
    return unit_sales_doc({"deposit_release": "held_to_completion"})


def no_programme_doc() -> CalculatorInputsV12:
    return unit_sales_doc({"programme": None})


def pc_early_doc() -> CalculatorInputsV12:
    return unit_sales_doc({"pc_early": True})


def residue_doc() -> CalculatorInputsV12:
    return unit_sales_doc({"residue_case": True})


def sold_gross(doc: CalculatorInputsV12) -> list[tuple[str, int]]:
    """The (unit_id, gross) pairs schedule.py hands compute_unit_sales, in
    unit_mix order, for a sell_all document."""
    return [(u.id, u.estimated_value_pence + unit_ancillary_value_pence(u)) for u in doc.unit_mix.units]


def anchor_resolver(doc: CalculatorInputsV12) -> Callable[[PhaseAnchor | None, int], int]:
    """Test-only stand-in for schedule.py's closure (same rule: derived start +
    offset; None or unresolvable -> month_offset)."""
    derivation = derive_phases(doc.programme) if doc.programme is not None and hasattr(doc.programme, "phases") else None

    def resolve(anchor: PhaseAnchor | None, month_offset: int) -> int:
        if anchor is None or derivation is None or derivation.cycle is not None:
            return month_offset
        dp = derivation.by_id.get(anchor.phase_id)
        return dp.start_month + anchor.offset_months if dp is not None else month_offset

    return resolve
```

Verify `derive_phases`' return shape (`cycle`, `by_id`, `.start_month`) against `app/financial_model/programme.py` before relying on it — copy the attribute names the schedule's `resolve_anchor_month` uses.

- [ ] **Step 5: Builder self-tests** `tests/test_fixtures_unit_sales.py`:

```python
from app.financial_model.validation import validate_inputs
from .fixtures_unit_sales import (
    anchor_resolver, held_twin_doc, no_programme_doc, pc_early_doc, residue_doc, sold_gross, unit_sales_doc,
)


def _errs(doc):
    return [i for i in validate_inputs(doc) if i.severity == "error"]


def test_x_is_v12_and_carries_the_ledger():
    d = unit_sales_doc()
    assert d.inputs_version == 12
    assert d.unit_sales is not None and len(d.unit_sales.units) == 4
    assert sold_gross(d) == [("u1", 26_000_000), ("u2", 30_000_000), ("u3", 17_500_000), ("u4", 21_000_000)]


def test_x_resolves_the_hand_derived_months():
    d = unit_sales_doc()
    r = anchor_resolver(d)
    rows = d.unit_sales.units
    assert r(rows[0].exchange.anchor, rows[0].exchange.month_offset) == 8
    assert r(rows[0].completion.anchor, rows[0].completion.month_offset) == 12
    assert r(rows[1].completion.anchor, rows[1].completion.month_offset) == 13
    assert r(rows[2].completion.anchor, rows[2].completion.month_offset) == 13
    assert r(rows[3].completion.anchor, rows[3].completion.month_offset) == 20


def test_pc_early_moves_practical_completion_to_month_9():
    d = pc_early_doc()
    r = anchor_resolver(d)
    rows = d.unit_sales.units
    assert r(rows[0].completion.anchor, 0) == 9
    assert r(rows[1].completion.anchor, 0) == 10
    assert r(rows[2].completion.anchor, 0) == 10


def test_variants_differ_from_x_by_exactly_their_one_change():
    assert held_twin_doc().unit_sales.deposit_release == "held_to_completion"
    assert no_programme_doc().programme is None
    assert [r.completion.month_offset for r in no_programme_doc().unit_sales.units] == [12, 13, 13, 20]
    rd = residue_doc()
    assert [u.estimated_value_pence for u in rd.unit_mix.units] == [10_000_000] * 3
    assert rd.exit_strategy.selling_legal_fee_pence == 100


def test_every_builder_validates_clean_before_task_5_adds_rules():
    # Task 5 keeps this true for the four valid variants; the controls
    # (sales_phasing_too, drop_row, extra_row) are meant to FAIL there.
    for d in (unit_sales_doc(), held_twin_doc(), no_programme_doc(), pc_early_doc(), residue_doc()):
        assert _errs(d) == []
```

- [ ] **Step 6: TS builders** `frontend/src/lib/model/__fixtures__/unit-sales-docs.ts` — the same five builders and helpers, camelCase overrides (`depositRelease`, `programme: null`, `pcEarly`, `residueCase`, `unitSales: null`, `salesPhasingToo`, `route`, `dropRow`, `extraRow`, `rows`), reading the fixture with `readFileSync`/`resolve(__dirname, '../../../../fixtures/financial-model/x-unit-sales-ledger.json')` and `migrateInputsToV12(raw)`; `soldGross(doc)` uses `unitAncillaryValuePence` from `../../conversion-calc-engine`; `anchorResolver(doc)` uses `derivePhases` with the `'cycle' in derivation` check `schedule.ts` uses; plus `export async function memoText(doc: CalculatorInputsV12): Promise<string>` copied from investment-case-docs' `memoText` with the widened type. Add `unit-sales-docs.test.ts` mirroring Step 5. Add `'lib/model/__fixtures__/unit-sales-docs.ts'` to the `EXEMPT` set in `frontend/src/lib/model/entry-point-guard.test.ts` (it calls `migrateInputsToV12` as test support, exactly like investment-case-docs).

- [ ] **Step 7: Run** `python -m pytest -q tests/test_fixtures_unit_sales.py tests/test_financial_model_fixtures.py tests/test_migrate_v1*.py` and `npx vitest run src/lib/model/__fixtures__ src/lib/model/golden-fixtures.test.ts src/lib/model/migrate.test.ts src/lib/model/entry-point-guard.test.ts` → green.

- [ ] **Step 8: Commit.** `git commit -m "test(r13b): fixture X inputs, corpus rosters, unit-sales document builders (spec 22)"`

---

### Task 3: `unit_sales.py` — the pure per-unit derivation (Python)

**Files:**
- Create: `app/financial_model/unit_sales.py`
- Create: `tests/test_financial_model_unit_sales.py`

**Interfaces:**
- Consumes: `money_round`, `pct` from `app/financial_model/engine.py`; `derive_phases`, `is_programme_network` from `programme.py`; the builders of Task 2.
- Produces: `compute_unit_sales(inputs, term_months, resolve_anchor_month, sold_gross) -> UnitSalesResult | None`; TypedDicts `UnitSaleRow`, `UnitSalesMonth`, `UnitSalesResult`. `sold_gross` is the schedule's `list[tuple[unit_id, gross_pence]]` over the SOLD set in `unit_mix` order (Task 6 supplies it; Task 2's `sold_gross(doc)` is the test stand-in). Rows are returned in `unit_sales.units[]` input order.

- [ ] **Step 1: Write the failing tests** `tests/test_financial_model_unit_sales.py`:

```python
"""R13b spec Sec 22.2-22.4. Twin of unit-sales.test.ts. Every literal is from
the plan's hand-derivation table; if one does not reconcile, report it."""
import pytest

from app.financial_model.unit_sales import compute_unit_sales
from .fixtures_unit_sales import (
    anchor_resolver, held_twin_doc, no_programme_doc, pc_early_doc, residue_doc, sold_gross, unit_sales_doc,
)


def _run(doc):
    return compute_unit_sales(doc, 24, anchor_resolver(doc), sold_gross(doc))


def _row(result, unit_id):
    return next(r for r in result["units"] if r["unit_id"] == unit_id)


def test_returns_none_exactly_when_the_input_block_is_none():
    doc = unit_sales_doc({"unit_sales": None})
    assert compute_unit_sales(doc, 24, anchor_resolver(doc), sold_gross(doc)) is None
    assert _run(unit_sales_doc()) is not None


def test_per_unit_figures_match_the_hand_derivation():
    r = _run(unit_sales_doc())
    assert [(x["unit_id"], x["gross_pence"], x["deposit_pence"], x["agent_fee_pence"], x["legal_fee_pence"], x["net_pence"])
            for x in r["units"]] == [
        ("u1", 26_000_000, 2_600_000, 390_000, 201_550, 25_408_450),
        ("u2", 30_000_000, 3_000_000, 450_000, 150_000, 29_400_000),
        ("u3", 17_500_000, 0, 350_000, 135_659, 17_014_341),
        ("u4", 21_000_000, 1_050_000, 315_000, 162_791, 20_522_209),
    ]
    assert r["totals"] == {
        "gross_pence": 94_500_000, "deposits_pence": 6_650_000, "deposits_released_pence": 6_650_000,
        "agent_fees_pence": 1_505_000, "legal_fees_pence": 650_000, "net_pence": 92_345_000,
    }


def test_resolved_months_and_released_deposits():
    r = _run(unit_sales_doc())
    assert [(x["exchange_month"], x["completion_month"], x["deposit_released_pence"]) for x in r["units"]] == [
        (8, 12, 2_600_000), (10, 13, 3_000_000), (None, 13, 0), (11, 20, 1_050_000),
    ]


def test_held_twin_releases_nothing_but_still_reports_the_deposits():
    r = _run(held_twin_doc())
    assert [x["deposit_released_pence"] for x in r["units"]] == [0, 0, 0, 0]
    assert [x["deposit_pence"] for x in r["units"]] == [2_600_000, 3_000_000, 0, 1_050_000]
    assert r["totals"]["deposits_pence"] == 6_650_000
    assert r["totals"]["deposits_released_pence"] == 0
    assert all(m["deposits_received_pence"] == 0 for m in r["months"])


def test_monthly_series_are_cumulative_and_deposits_land_in_exchange_months():
    r = _run(unit_sales_doc())
    m = {x["month"]: x for x in r["months"]}
    assert len(r["months"]) == 24
    assert (m[7]["exchanged_value_pence"], m[8]["exchanged_value_pence"], m[10]["exchanged_value_pence"],
            m[11]["exchanged_value_pence"], m[12]["exchanged_value_pence"], m[13]["exchanged_value_pence"]) == (
        0, 26_000_000, 56_000_000, 77_000_000, 77_000_000, 94_500_000)
    assert (m[11]["completed_value_pence"], m[12]["completed_value_pence"], m[13]["completed_value_pence"],
            m[19]["completed_value_pence"], m[20]["completed_value_pence"], m[23]["completed_value_pence"]) == (
        0, 26_000_000, 73_500_000, 73_500_000, 94_500_000, 94_500_000)
    assert {k: v["deposits_received_pence"] for k, v in m.items() if v["deposits_received_pence"]} == {
        8: 2_600_000, 10: 3_000_000, 11: 1_050_000}


def test_pre_sold_uses_the_earliest_practical_completion_start():
    r = _run(unit_sales_doc())
    assert r["pre_sold"] == {
        "reference_month": 12, "basis": "practical_completion",
        "exchanged_value_pence": 77_000_000, "pct": 81.48,
    }


def test_pre_sold_basis_switches_and_the_reference_month_moves():
    # Same rows, no network: basis changes, reference month is the first completion.
    assert _run(no_programme_doc())["pre_sold"] == {
        "reference_month": 12, "basis": "first_completion",
        "exchanged_value_pence": 77_000_000, "pct": 81.48,
    }
    # Same rows, PC at month 9: only u1 has exchanged by then.
    assert _run(pc_early_doc())["pre_sold"] == {
        "reference_month": 9, "basis": "practical_completion",
        "exchanged_value_pence": 26_000_000, "pct": 27.51,
    }


def test_null_legal_residue_is_absorbed_by_the_last_null_legal_row():
    r = _run(residue_doc())
    assert [x["legal_fee_pence"] for x in r["units"]] == [33, 33, 34]
    assert r["totals"]["legal_fees_pence"] == 100


def test_all_legal_overrides_set_leaves_the_scheme_fee_unused():
    rows = [
        {"unit_id": u, "exchange": None, "completion": {"month_offset": 12, "anchor": None},
         "deposit_pct": 0, "agent_fee_pct": None, "legal_fee_pence": 1_000}
        for u in ("u1", "u2", "u3", "u4")
    ]
    r = _run(unit_sales_doc({"rows": rows}))
    assert r["totals"]["legal_fees_pence"] == 4_000  # not 500,000


def test_deposit_and_agent_scale_with_the_unit_gross():
    # u3's 2.0% override on 17,500,000 = 350,000; u1's scheme 1.5% on 26,000,000
    # (parking included) = 390,000 -- the ancillary is inside the base.
    r = _run(unit_sales_doc())
    assert _row(r, "u3")["agent_fee_pence"] == 350_000
    assert _row(r, "u1")["agent_fee_pence"] == 390_000


def test_completion_month_is_clamped_into_the_term():
    rows = [{"unit_id": "u1", "exchange": None, "completion": {"month_offset": 40, "anchor": None},
             "deposit_pct": 0, "agent_fee_pct": None, "legal_fee_pence": None}]
    doc = unit_sales_doc({"rows": rows})
    r = compute_unit_sales(doc, 24, anchor_resolver(doc), [("u1", 26_000_000)])
    assert r["units"][0]["completion_month"] == 23  # validation owns the real rule
```

- [ ] **Step 2: Run** `python -m pytest -q tests/test_financial_model_unit_sales.py` → FAIL (`ModuleNotFoundError: app.financial_model.unit_sales`).

- [ ] **Step 3: Implement** `app/financial_model/unit_sales.py`:

```python
"""R13b spec Sec 22. The unit-level sales ledger: per-unit exchange and
completion timing, deposits held or released, per-unit selling-cost overrides,
and the pre-sales coverage figure.

Port of frontend/src/lib/model/unit-sales.ts. This module runs STRICTLY
BEFORE the ledger and reads nothing from it (Sec 17.5's one-direction rule).
It must never import `schedule` or `metrics` -- `schedule.py` imports this
module and hands it the sold set, so the dependency runs one way.
"""
from __future__ import annotations

import math
from typing import Any, Literal, TypedDict

from .engine import money_round, pct
from .programme import derive_phases, is_programme_network

PreSoldBasis = Literal["practical_completion", "first_completion"]


class UnitSaleRow(TypedDict):
    unit_id: str
    gross_pence: int
    exchange_month: int | None
    completion_month: int
    deposit_pence: int
    deposit_released_pence: int
    agent_fee_pence: int
    legal_fee_pence: int
    net_pence: int


class UnitSalesMonth(TypedDict):
    month: int
    exchanged_value_pence: int   # cumulative
    completed_value_pence: int   # cumulative
    deposits_received_pence: int  # released deposits landing this month


class UnitSalesResult(TypedDict):
    deposit_release: str
    units: list[UnitSaleRow]
    months: list[UnitSalesMonth]
    totals: dict[str, int]
    pre_sold: dict[str, Any]


def _clamp_month(m: float, term_months: int) -> int:
    # Belt-and-braces, mirroring schedule.py's tranche placement: validation.py
    # owns the real [0, term-1] rule (Sec 22.7 rule 4).
    return min(max(0, math.floor(m)), term_months - 1)


def _practical_completion_starts(inputs: Any) -> list[int]:
    programme = getattr(inputs, "programme", None)
    if programme is None or not is_programme_network(programme):
        return []
    derivation = derive_phases(programme)
    if derivation.cycle is not None:
        return []
    return [
        derivation.by_id[p.id].start_month
        for p in programme.phases
        if p.code == "practical_completion" and p.id in derivation.by_id
    ]


def compute_unit_sales(
    inputs: Any,
    term_months: int,
    resolve_anchor_month: Any,
    sold_gross: list[tuple[str, int]],
) -> UnitSalesResult | None:
    """Sec 22.2-22.4. `sold_gross` is the schedule's (unit_id, gross) list over
    the SOLD set -- value plus ancillary, the same figure gross_sales sums --
    so `gdv_pence` and `gross_sales_pence` stay equal by construction.
    `resolve_anchor_month` is schedule.py's single resolver. Returns None
    exactly when the input block is None."""
    us = getattr(inputs, "unit_sales", None)
    if us is None:
        return None

    gross_by_id = dict(sold_gross)
    rows = [r for r in us.units if r.unit_id in gross_by_id]  # coverage is validation's (rule 3)
    total_gross = sum(gross_by_id[r.unit_id] for r in rows)
    scheme_agent = inputs.exit_strategy.selling_agent_fee_pct
    scheme_legal = inputs.exit_strategy.selling_legal_fee_pence
    released = us.deposit_release == "released_on_exchange"

    null_legal_ids = [r.unit_id for r in rows if r.legal_fee_pence is None]
    null_legal_base = sum(gross_by_id[u] for u in null_legal_ids)
    legal_allocated = 0

    out_rows: list[UnitSaleRow] = []
    for r in rows:
        g = gross_by_id[r.unit_id]
        deposit = money_round((g * r.deposit_pct) / 100)
        agent_pct = scheme_agent if r.agent_fee_pct is None else r.agent_fee_pct
        agent = money_round((g * agent_pct) / 100)
        if r.legal_fee_pence is not None:
            legal = r.legal_fee_pence
        elif r.unit_id == null_legal_ids[-1]:
            legal = scheme_legal - legal_allocated  # the LAST null-legal row absorbs the residue
        else:
            legal = money_round((scheme_legal * g) / null_legal_base) if null_legal_base > 0 else 0
            legal_allocated += legal
        completion_m = _clamp_month(
            resolve_anchor_month(r.completion.anchor, r.completion.month_offset), term_months,
        )
        exchange_m = (
            None if r.exchange is None
            else _clamp_month(resolve_anchor_month(r.exchange.anchor, r.exchange.month_offset), term_months)
        )
        out_rows.append(UnitSaleRow(
            unit_id=r.unit_id, gross_pence=g, exchange_month=exchange_m, completion_month=completion_m,
            deposit_pence=deposit,
            deposit_released_pence=deposit if (released and exchange_m is not None) else 0,
            agent_fee_pence=agent, legal_fee_pence=legal, net_pence=g - agent - legal,
        ))

    def effective_exchange(row: UnitSaleRow) -> int:
        return row["completion_month"] if row["exchange_month"] is None else row["exchange_month"]

    months: list[UnitSalesMonth] = []
    for m in range(term_months):
        months.append(UnitSalesMonth(
            month=m,
            exchanged_value_pence=sum(x["gross_pence"] for x in out_rows if effective_exchange(x) <= m),
            completed_value_pence=sum(x["gross_pence"] for x in out_rows if x["completion_month"] <= m),
            deposits_received_pence=sum(
                x["deposit_released_pence"] for x in out_rows if x["exchange_month"] == m
            ),
        ))

    pc_starts = _practical_completion_starts(inputs)
    if pc_starts:
        reference_month = min(pc_starts)
        basis: PreSoldBasis = "practical_completion"
    else:
        reference_month = min((x["completion_month"] for x in out_rows), default=0)
        basis = "first_completion"
    exchanged_at_ref = sum(x["gross_pence"] for x in out_rows if effective_exchange(x) <= reference_month)

    return UnitSalesResult(
        deposit_release=us.deposit_release,
        units=out_rows,
        months=months,
        totals={
            "gross_pence": total_gross,
            "deposits_pence": sum(x["deposit_pence"] for x in out_rows),
            "deposits_released_pence": sum(x["deposit_released_pence"] for x in out_rows),
            "agent_fees_pence": sum(x["agent_fee_pence"] for x in out_rows),
            "legal_fees_pence": sum(x["legal_fee_pence"] for x in out_rows),
            "net_pence": sum(x["net_pence"] for x in out_rows),
        },
        pre_sold={
            "reference_month": reference_month,
            "basis": basis,
            "exchanged_value_pence": exchanged_at_ref,
            "pct": pct(exchanged_at_ref, total_gross),
        },
    )
```

Verify `derive_phases(...).cycle` / `.by_id[...].start_month` and `Phase.code` names against `programme.py` and `types.py` before committing — copy what `schedule.py`'s `resolve_anchor_month` reads.

- [ ] **Step 4: Run** the file → all PASS. Then `python -m pytest -q tests/test_accessor_guard.py` (the new module reads no guarded field) → PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(r13b): unit_sales.py - per-unit derivation, monthly series, pre-sold coverage (spec 22.2-22.4)"`

---

### Task 4: `unit-sales.ts` — the TypeScript twin

**Files:**
- Modify: `frontend/src/lib/model/unit-sales.ts` (append the derivation to Task 1's types)
- Modify: `frontend/src/lib/model/finance-types.ts` (re-export `UnitSalesResult`, `UnitSaleRow`, `UnitSalesMonth`, `PreSoldBasis`)
- Create: `frontend/src/lib/model/unit-sales.test.ts`

**Interfaces:**
- Produces: `computeUnitSales(inputs: AnyCalculatorInputs, termMonths: number, resolveAnchorMonth: (anchor: PhaseAnchor | null, monthOffset: number) => number, soldGross: Array<{ unit_id: string; gross_pence: number }>): UnitSalesResult | null`; interfaces `UnitSaleRow`, `UnitSalesMonth`, `UnitSalesResult` with the field names of Task 3 (`pre_sold.pct: number | null`).

- [ ] **Step 1: Write the failing tests** `unit-sales.test.ts` — a one-to-one port of Task 3's eleven tests using `unitSalesDoc`, `heldTwinDoc`, `noProgrammeDoc`, `pcEarlyDoc`, `residueDoc`, `soldGross`, `anchorResolver` from `./__fixtures__/unit-sales-docs`, e.g.:

```ts
const run = (doc: CalculatorInputsV12) => computeUnitSales(doc, 24, anchorResolver(doc), soldGross(doc))!;

it('per-unit figures match the hand derivation', () => {
  const r = run(unitSalesDoc());
  expect(r.units.map((x) => [x.unit_id, x.gross_pence, x.deposit_pence, x.agent_fee_pence, x.legal_fee_pence, x.net_pence])).toEqual([
    ['u1', 26_000_000, 2_600_000, 390_000, 201_550, 25_408_450],
    ['u2', 30_000_000, 3_000_000, 450_000, 150_000, 29_400_000],
    ['u3', 17_500_000, 0, 350_000, 135_659, 17_014_341],
    ['u4', 21_000_000, 1_050_000, 315_000, 162_791, 20_522_209],
  ]);
  expect(r.totals).toEqual({
    gross_pence: 94_500_000, deposits_pence: 6_650_000, deposits_released_pence: 6_650_000,
    agent_fees_pence: 1_505_000, legal_fees_pence: 650_000, net_pence: 92_345_000,
  });
});
it('pre-sold uses the earliest practical_completion start', () => {
  expect(run(unitSalesDoc()).pre_sold).toEqual({
    reference_month: 12, basis: 'practical_completion', exchanged_value_pence: 77_000_000, pct: 81.48,
  });
});
```

(the other nine follow Task 3 verbatim: null path, resolved months + released deposits, held twin, cumulative series, basis switch 12/`first_completion`/81.48 and 9/`practical_completion`/27.51, residue [33, 33, 34], all-legal-set 4,000, agent scaling, clamp to 23).

- [ ] **Step 2: Run** `npx vitest run src/lib/model/unit-sales.test.ts` → FAIL (`computeUnitSales` not exported).

- [ ] **Step 3: Implement** — append to `unit-sales.ts`:

```ts
import type { AnyCalculatorInputs } from './finance-types';
import { derivePhases, isProgrammeNetwork } from './programme';
import { pct } from './pct';

export type PreSoldBasis = 'practical_completion' | 'first_completion';

export interface UnitSaleRow {
  unit_id: string;
  gross_pence: number;
  exchange_month: number | null;
  completion_month: number;
  deposit_pence: number;
  deposit_released_pence: number;
  agent_fee_pence: number;
  legal_fee_pence: number;
  net_pence: number;
}

export interface UnitSalesMonth {
  month: number;
  exchanged_value_pence: number;   // cumulative
  completed_value_pence: number;   // cumulative
  deposits_received_pence: number; // released deposits landing this month
}

export interface UnitSalesResult {
  deposit_release: DepositRelease;
  units: UnitSaleRow[];
  months: UnitSalesMonth[];
  totals: {
    gross_pence: number; deposits_pence: number; deposits_released_pence: number;
    agent_fees_pence: number; legal_fees_pence: number; net_pence: number;
  };
  pre_sold: {
    reference_month: number; basis: PreSoldBasis;
    exchanged_value_pence: number; pct: number | null;
  };
}

const clampMonth = (m: number, termMonths: number): number =>
  Math.min(Math.max(0, Math.floor(m)), termMonths - 1);

function practicalCompletionStarts(inputs: AnyCalculatorInputs): number[] {
  const programme = 'programme' in inputs ? inputs.programme : null;
  if (programme == null || !isProgrammeNetwork(programme)) return [];
  const derivation = derivePhases(programme);
  if ('cycle' in derivation) return [];
  return programme.phases
    .filter((p) => p.code === 'practical_completion' && derivation.byId[p.id] != null)
    .map((p) => derivation.byId[p.id].start_month);
}

/** R13b spec §22.2–§22.4. Twin of unit_sales.py's compute_unit_sales. */
export function computeUnitSales(
  inputs: AnyCalculatorInputs,
  termMonths: number,
  resolveAnchorMonth: (anchor: PhaseAnchor | null, monthOffset: number) => number,
  soldGross: Array<{ unit_id: string; gross_pence: number }>,
): UnitSalesResult | null {
  const us = 'unit_sales' in inputs ? inputs.unit_sales : null;
  if (us == null) return null;

  const grossById = new Map(soldGross.map((s) => [s.unit_id, s.gross_pence]));
  const rows = us.units.filter((r) => grossById.has(r.unit_id));
  const totalGross = rows.reduce((s, r) => s + grossById.get(r.unit_id)!, 0);
  const schemeAgent = inputs.exit_strategy.selling_agent_fee_pct;
  const schemeLegal = inputs.exit_strategy.selling_legal_fee_pence;
  const released = us.deposit_release === 'released_on_exchange';

  const nullLegalIds = rows.filter((r) => r.legal_fee_pence == null).map((r) => r.unit_id);
  const nullLegalBase = nullLegalIds.reduce((s, id) => s + grossById.get(id)!, 0);
  let legalAllocated = 0;

  const outRows: UnitSaleRow[] = rows.map((r) => {
    const g = grossById.get(r.unit_id)!;
    const deposit = Math.round((g * r.deposit_pct) / 100);
    const agentPct = r.agent_fee_pct ?? schemeAgent;
    const agent = Math.round((g * agentPct) / 100);
    let legal: number;
    if (r.legal_fee_pence != null) {
      legal = r.legal_fee_pence;
    } else if (r.unit_id === nullLegalIds[nullLegalIds.length - 1]) {
      legal = schemeLegal - legalAllocated; // the LAST null-legal row absorbs the residue
    } else {
      legal = nullLegalBase > 0 ? Math.round((schemeLegal * g) / nullLegalBase) : 0;
      legalAllocated += legal;
    }
    const completionMonth = clampMonth(resolveAnchorMonth(r.completion.anchor, r.completion.month_offset), termMonths);
    const exchangeMonth = r.exchange == null
      ? null : clampMonth(resolveAnchorMonth(r.exchange.anchor, r.exchange.month_offset), termMonths);
    return {
      unit_id: r.unit_id, gross_pence: g, exchange_month: exchangeMonth, completion_month: completionMonth,
      deposit_pence: deposit,
      deposit_released_pence: released && exchangeMonth != null ? deposit : 0,
      agent_fee_pence: agent, legal_fee_pence: legal, net_pence: g - agent - legal,
    };
  });

  const effectiveExchange = (x: UnitSaleRow) => x.exchange_month ?? x.completion_month;
  const months: UnitSalesMonth[] = Array.from({ length: termMonths }, (_, m) => ({
    month: m,
    exchanged_value_pence: outRows.filter((x) => effectiveExchange(x) <= m).reduce((s, x) => s + x.gross_pence, 0),
    completed_value_pence: outRows.filter((x) => x.completion_month <= m).reduce((s, x) => s + x.gross_pence, 0),
    deposits_received_pence: outRows.filter((x) => x.exchange_month === m).reduce((s, x) => s + x.deposit_released_pence, 0),
  }));

  const pcStarts = practicalCompletionStarts(inputs);
  const basis: PreSoldBasis = pcStarts.length > 0 ? 'practical_completion' : 'first_completion';
  const referenceMonth = pcStarts.length > 0
    ? Math.min(...pcStarts)
    : outRows.length > 0 ? Math.min(...outRows.map((x) => x.completion_month)) : 0;
  const exchangedAtRef = outRows.filter((x) => effectiveExchange(x) <= referenceMonth).reduce((s, x) => s + x.gross_pence, 0);

  const sum = (f: (x: UnitSaleRow) => number) => outRows.reduce((s, x) => s + f(x), 0);
  return {
    deposit_release: us.deposit_release,
    units: outRows,
    months,
    totals: {
      gross_pence: totalGross,
      deposits_pence: sum((x) => x.deposit_pence),
      deposits_released_pence: sum((x) => x.deposit_released_pence),
      agent_fees_pence: sum((x) => x.agent_fee_pence),
      legal_fees_pence: sum((x) => x.legal_fee_pence),
      net_pence: sum((x) => x.net_pence),
    },
    pre_sold: { reference_month: referenceMonth, basis, exchanged_value_pence: exchangedAtRef, pct: pct(exchangedAtRef, totalGross) },
  };
}
```

Verify `derivePhases`' discriminated shape (`'cycle' in …`, `.byId`, `.start_month`) and `Phase.code` against `programme.ts` — copy what `schedule.ts`'s `resolveAnchorMonth` reads. Re-export the four new types through `finance-types.ts`'s unit-sales `export type { … }` line.

- [ ] **Step 4: Run** the file → PASS; `npx tsc -b` clean; `npm run lint -- --max-warnings 0` clean (the accessor-guard rule must NOT be satisfied by adding this file to its allowlist — it reads no guarded field).

- [ ] **Step 5: Commit.** `git commit -m "feat(r13b): unit-sales.ts - the TypeScript twin of the per-unit derivation (spec 22.2-22.4)"`

---

### Task 5: Validation §22.7, both engines, and migration-gate properties 2 & 3

**Files:**
- Modify: `app/financial_model/validation.py` (insert a `unit_sales` block immediately AFTER the `refinance` block, ~L1111, before the investment-case block; and a `sales_slip_months` check inside the scenarios loop ~L1352–1378)
- Modify: `frontend/src/lib/model/validation.ts` (same positions: after the refinance block ~L976; scenarios loop)
- Modify: `tests/test_financial_model_validation.py`, `frontend/src/lib/model/validation.test.ts` (new describe/class)
- Modify: `tests/test_migrate_v12.py`, `frontend/src/lib/model/migrate.test.ts` (properties 2 and 3)

**Interfaces:**
- Consumes: `network_phase_ids`, `programme_derivation` (validation.py L275–286 / validation.ts L260–261), `err`, `inputs.exit_strategy.route`/`retained_units`, `inputs.unit_mix.units`.
- Produces: error fields exactly as listed below (tests and the sensitivity cell-validity tests key on them).

Field/message contract (Python strings use ASCII hyphens; TS uses the same words with an em-dash where the neighbouring blocks do):

| rule | field | message |
|---|---|---|
| 1 | `unit_sales` AND `sales_phasing` | `Per-unit sales and phased sales cannot both be set - remove one.` |
| 2 | `unit_sales` | `Per-unit sales apply to the sold portion - a retain-all exit has none. Remove the block or change the exit route.` |
| 3 missing | `unit_sales` | `Sold unit "u9" has no sale row.` |
| 3 retained | `unit_sales.units[i]` | `Unit "u9" is retained and cannot carry a sale row.` |
| 3 absent | `unit_sales.units[i]` | `Sale row unit "u9" does not exist in the unit mix.` |
| 3 duplicate | `unit_sales.units[i]` | `Unit "u9" has more than one sale row.` |
| 4 window | `unit_sales.units[i].exchange` / `.completion` | `Exchange month must be a whole month between 0 and 23.` (or `Completion …`) |
| 4 no network | same | `Exchange anchor needs a programme network.` |
| 4 absent phase | `unit_sales.units[i].exchange.anchor` / `.completion.anchor` | `Exchange anchor references phase "ghost", but there is no phase with id "ghost".` |
| 4 resolved | `unit_sales.units[i].exchange` / `.completion` | `Completion resolves to month 24, outside 0 to 23.` |
| 5 | `unit_sales.units[i].exchange` | `Exchange must not fall after completion (resolved months 13 > 12).` |
| 6 range | `unit_sales.units[i].deposit_pct` | `Deposit percentage must be a finite number between 0 and 100.` |
| 6 no exchange | `unit_sales.units[i].deposit_pct` | `A deposit needs an exchange event - set exchange or set deposit_pct to 0.` |
| 7 agent | `unit_sales.units[i].agent_fee_pct` | `Agent fee override must be a finite percentage from 0 to below 100.` |
| 7 legal | `unit_sales.units[i].legal_fee_pence` | `Legal fee override must be a whole number of pence, zero or more.` |
| 8 | `unit_sales.deposit_release` | `deposit_release must be held_to_completion or released_on_exchange.` |
| 9 | `unit_sales` | `Per-unit sales need a sold portion with value above zero.` |
| slip | `scenarios.<name>.sales_slip_months` | `Sales slip must be a whole number of months.` |

- [ ] **Step 1: Failing tests (Python).** Add to `tests/test_financial_model_validation.py`:

```python
from .fixtures_unit_sales import unit_sales_doc, no_programme_doc


class TestUnitSalesValidation:
    """Sec 22.7. Twin of validation.test.ts's '§22.7 unit sales validation'."""

    @staticmethod
    def _errs(doc):
        return [i for i in validate_inputs(doc) if i.severity == "error"]

    def _fields(self, doc):
        return [i.field for i in self._errs(doc)]

    def _row(self, **changes):
        base = {"unit_id": "u1", "exchange": {"month_offset": 8, "anchor": None},
                "completion": {"month_offset": 12, "anchor": None},
                "deposit_pct": 10, "agent_fee_pct": None, "legal_fee_pence": None}
        return {**base, **changes}

    def _rows_with(self, **changes):
        rows = [self._row(), self._row(unit_id="u2", exchange={"month_offset": 10, "anchor": None}, completion={"month_offset": 13, "anchor": None}),
                self._row(unit_id="u3", exchange=None, deposit_pct=0, completion={"month_offset": 13, "anchor": None}),
                self._row(unit_id="u4", exchange={"month_offset": 11, "anchor": None}, completion={"month_offset": 20, "anchor": None}, deposit_pct=5)]
        rows[0] = {**rows[0], **changes}
        return rows

    def test_the_four_valid_builders_are_clean(self):
        assert self._fields(unit_sales_doc()) == []
        assert self._fields(no_programme_doc()) == []

    def test_rule_1_both_blocks_set_errors_on_both_fields(self):
        f = self._fields(unit_sales_doc({"sales_phasing_too": True}))
        assert "unit_sales" in f and "sales_phasing" in f

    def test_rule_2_retain_all_rejects_the_block(self):
        assert "unit_sales" in self._fields(unit_sales_doc({"route": "retain_all"}))

    @staticmethod
    def _reparse(doc, mutate):
        """Dump, mutate the raw dict in place, re-parse through the migration
        -- the only way to build a shape the builder does not offer."""
        raw = doc.model_dump(mode="json")
        mutate(raw)
        return migrate_inputs_to_v12(raw, None)

    def test_rule_3_four_distinct_messages(self):
        e = self._errs(unit_sales_doc({"drop_row": "u3"}))
        assert any(i.field == "unit_sales" and 'Sold unit "u3" has no sale row.' == i.message for i in e)
        e = self._errs(unit_sales_doc({"extra_row": "u9"}))
        assert any(i.field == "unit_sales.units[4]" and 'does not exist in the unit mix' in i.message for i in e)
        e = self._errs(unit_sales_doc({"extra_row": "u4"}))
        assert any(i.field == "unit_sales.units[4]" and 'has more than one sale row' in i.message for i in e)
        # Retained under blended: u2 retained, so its row names a retained unit.
        def retain_u2(raw):
            raw["exit_strategy"]["retained_units"] = [{"unit_id": "u2", "monthly_rent_pence": 100_000}]
        e = self._errs(self._reparse(unit_sales_doc({"route": "blended"}), retain_u2))
        assert any(i.field == "unit_sales.units[1]" and 'is retained and cannot carry a sale row' in i.message for i in e)

    def test_rule_4_window_anchor_and_resolved_month(self):
        assert "unit_sales.units[0].completion" in self._fields(
            unit_sales_doc({"rows": self._rows_with(completion={"month_offset": 24, "anchor": None})}))
        assert "unit_sales.units[0].exchange" in self._fields(
            unit_sales_doc({"rows": self._rows_with(exchange={"month_offset": -1, "anchor": None})}))
        # anchor on a document with no network
        def anchor_without_network(raw):
            raw["unit_sales"]["units"][0]["completion"] = {"month_offset": 0, "anchor": {"phase_id": "construction", "offset_months": 0}}
        assert "unit_sales.units[0].completion" in self._fields(self._reparse(no_programme_doc(), anchor_without_network))
        # anchor naming an absent phase
        assert "unit_sales.units[0].completion.anchor" in self._fields(
            unit_sales_doc({"rows": self._rows_with(completion={"month_offset": 0, "anchor": {"phase_id": "ghost", "offset_months": 0}})}))
        # resolved past the term: practical_completion (12) + 12 = 24
        e = self._errs(unit_sales_doc({"rows": self._rows_with(completion={"month_offset": 0, "anchor": {"phase_id": "practical_completion", "offset_months": 12}})}))
        assert any(i.field == "unit_sales.units[0].completion" and "resolves to month 24" in i.message for i in e)
        # its twin one month earlier is clean
        assert self._fields(unit_sales_doc({"rows": self._rows_with(completion={"month_offset": 0, "anchor": {"phase_id": "practical_completion", "offset_months": 11}})})) == []

    def test_rule_5_exchange_after_completion(self):
        e = self._errs(unit_sales_doc({"rows": self._rows_with(exchange={"month_offset": 13, "anchor": None})}))
        assert any(i.field == "unit_sales.units[0].exchange" and "(resolved months 13 > 12)" in i.message for i in e)
        assert self._fields(unit_sales_doc({"rows": self._rows_with(exchange={"month_offset": 12, "anchor": None})})) == []

    def test_rule_6_deposit_range_and_exchange_requirement(self):
        assert "unit_sales.units[0].deposit_pct" in self._fields(unit_sales_doc({"rows": self._rows_with(deposit_pct=101)}))
        assert "unit_sales.units[0].deposit_pct" in self._fields(unit_sales_doc({"rows": self._rows_with(exchange=None, deposit_pct=10)}))
        assert self._fields(unit_sales_doc({"rows": self._rows_with(exchange=None, deposit_pct=0)})) == []

    def test_rule_7_overrides(self):
        assert "unit_sales.units[0].agent_fee_pct" in self._fields(unit_sales_doc({"rows": self._rows_with(agent_fee_pct=100)}))
        assert "unit_sales.units[0].legal_fee_pence" in self._fields(unit_sales_doc({"rows": self._rows_with(legal_fee_pence=-1)}))

    def test_rule_9_zero_sold_value(self):
        def zero_values(raw):
            for u in raw["unit_mix"]["units"]:
                u["estimated_value_pence"] = 0
                u["ancillary"]["parking_value_pence"] = 0
        assert "unit_sales" in self._fields(self._reparse(unit_sales_doc(), zero_values))

    def test_sales_slip_must_be_whole_months(self):
        # Pydantic's int field already refuses 1.5 at parse time in Python; the
        # spec rule is enforced structurally here and by validateInputs in TS.
        def fractional_slip(raw):
            raw["scenarios"]["downside"]["sales_slip_months"] = 1.5
        with pytest.raises(ValidationError):
            self._reparse(unit_sales_doc(), fractional_slip)
```

Module imports for the class: `import pytest`, `from pydantic import ValidationError`, `from app.financial_model.migrate import migrate_inputs_to_v12`, plus the builders.

- [ ] **Step 2: Run** → FAIL (no `unit_sales` rules yet: every "in fields" assertion fails).

- [ ] **Step 3: Implement (Python).** After the refinance block in `validate_inputs` add:

```python
    # R13b spec Sec 22.7. The per-unit sales ledger. Structurally read, like
    # every post-v2 block: a v2-v11 document has no attribute and stays inert.
    unit_sales = getattr(inputs, "unit_sales", None)
    sales_phasing_block = getattr(inputs, "sales_phasing", None)
    if unit_sales is not None and sales_phasing_block is not None:
        # Rule 1 -- on BOTH fields (Sec 16.1's exclusion shape).
        msg = "Per-unit sales and phased sales cannot both be set - remove one."
        err("unit_sales", msg)
        err("sales_phasing", msg)
    if unit_sales is not None:
        term = max(1, math.floor(inputs.finance.term_months))
        route = inputs.exit_strategy.route
        if route == "retain_all":
            err(
                "unit_sales",
                "Per-unit sales apply to the sold portion - a retain-all exit has none. "
                "Remove the block or change the exit route.",
            )
        if unit_sales.deposit_release not in ("held_to_completion", "released_on_exchange"):
            err("unit_sales.deposit_release", "deposit_release must be held_to_completion or released_on_exchange.")

        all_ids = [u.id for u in inputs.unit_mix.units]
        retained_ids = {r.unit_id for r in inputs.exit_strategy.retained_units}
        sold_ids = [] if route == "retain_all" else [
            u.id for u in inputs.unit_mix.units if route == "sell_all" or u.id not in retained_ids
        ]
        # Rule 3, both directions, four messages.
        seen: set[str] = set()
        for i, row in enumerate(unit_sales.units):
            field_ = f"unit_sales.units[{i}]"
            if row.unit_id in seen:
                err(field_, f"Unit \"{row.unit_id}\" has more than one sale row.")
            seen.add(row.unit_id)
            if row.unit_id not in all_ids:
                err(field_, f"Sale row unit \"{row.unit_id}\" does not exist in the unit mix.")
            elif row.unit_id not in sold_ids and route != "retain_all":
                err(field_, f"Unit \"{row.unit_id}\" is retained and cannot carry a sale row.")
        for uid in sold_ids:
            if uid not in seen:
                err("unit_sales", f"Sold unit \"{uid}\" has no sale row.")

        # Rule 9.
        sold_gross_total = sum(
            u.estimated_value_pence + unit_ancillary_value_pence(u)
            for u in inputs.unit_mix.units if u.id in sold_ids
        )
        if route != "retain_all" and sold_gross_total <= 0:
            err("unit_sales", "Per-unit sales need a sold portion with value above zero.")

        def resolved_event_month(ev: object) -> int | None:
            anchor = getattr(ev, "anchor", None)
            if anchor is None:
                return ev.month_offset  # type: ignore[attr-defined]
            if programme_derivation is None:
                return None
            dp = programme_derivation.by_id.get(anchor.phase_id)
            return dp.start_month + anchor.offset_months if dp is not None else None

        def check_event(ev: object, field_: str, label: str) -> int | None:
            # Rule 4: the entered month, the anchor, and the RESOLVED month.
            if not isinstance(ev.month_offset, int) or ev.month_offset < 0 or ev.month_offset > term - 1:  # type: ignore[attr-defined]
                err(field_, f"{label} month must be a whole month between 0 and {term - 1}.")
            anchor = getattr(ev, "anchor", None)
            if anchor is not None:
                if not network_phase_ids:
                    err(field_, f"{label} anchor needs a programme network.")
                elif anchor.phase_id not in network_phase_ids:
                    err(
                        f"{field_}.anchor",
                        f"{label} anchor references phase \"{anchor.phase_id}\", but there is no "
                        f"phase with id \"{anchor.phase_id}\".",
                    )
            m = resolved_event_month(ev)
            if m is not None and anchor is not None and (m < 0 or m > term - 1):
                err(field_, f"{label} resolves to month {m}, outside 0 to {term - 1}.")
            return m

        for i, row in enumerate(unit_sales.units):
            field_ = f"unit_sales.units[{i}]"
            completion_m = check_event(row.completion, f"{field_}.completion", "Completion")
            exchange_m = None if row.exchange is None else check_event(row.exchange, f"{field_}.exchange", "Exchange")
            # Rule 5.
            if exchange_m is not None and completion_m is not None and exchange_m > completion_m:
                err(f"{field_}.exchange",
                    f"Exchange must not fall after completion (resolved months {exchange_m} > {completion_m}).")
            # Rule 6.
            if not math.isfinite(row.deposit_pct) or row.deposit_pct < 0 or row.deposit_pct > 100:
                err(f"{field_}.deposit_pct", "Deposit percentage must be a finite number between 0 and 100.")
            elif row.exchange is None and row.deposit_pct != 0:
                err(f"{field_}.deposit_pct", "A deposit needs an exchange event - set exchange or set deposit_pct to 0.")
            # Rule 7.
            if row.agent_fee_pct is not None and (
                not math.isfinite(row.agent_fee_pct) or row.agent_fee_pct < 0 or row.agent_fee_pct >= 100
            ):
                err(f"{field_}.agent_fee_pct", "Agent fee override must be a finite percentage from 0 to below 100.")
            if row.legal_fee_pence is not None and (not isinstance(row.legal_fee_pence, int) or row.legal_fee_pence < 0):
                err(f"{field_}.legal_fee_pence", "Legal fee override must be a whole number of pence, zero or more.")
```

`unit_ancillary_value_pence` is imported from `.schedule` (validation.py already imports from schedule? — check; if it does not, import it: `from .schedule import unit_ancillary_value_pence`, and confirm no cycle: schedule.py must not import validation.py). In the scenarios loop add, per scenario name: `if not isinstance(s.sales_slip_months, int): err(f"scenarios.{name}.sales_slip_months", "Sales slip must be a whole number of months.")` (structurally unreachable in Python — Pydantic's `int` refuses 1.5 — kept so the two engines' rule lists match line for line; say so in a comment).

- [ ] **Step 4: Implement (TS)** — the same block after the refinance block in `validateInputs`, gated `const unitSales = 'unit_sales' in inputs ? inputs.unit_sales : null;`, `const salesPhasingBlock = 'sales_phasing' in inputs ? inputs.sales_phasing : null;`, messages with the neighbouring blocks' em-dash convention (`'… cannot both be set — remove one.'`, `'… sold portion — a retain-all exit has none. …'`, `'… exchange event — set exchange …'`), `Number.isInteger`/`Number.isFinite` for the numeric checks, `networkPhaseIds.size === 0` for the no-network arm, `programmeDerivation?.byId[anchor.phase_id]` for the resolved month, `unitAncillaryValuePence` from `../conversion-calc-engine` for rule 9, and in the scenarios loop `if (!Number.isInteger(s.sales_slip_months)) err(\`scenarios.${name}.sales_slip_months\`, 'Sales slip must be a whole number of months.')`. Port the Python tests to `validation.test.ts` as `describe('§22.7 unit sales validation')` with `unitSalesDoc`/`noProgrammeDoc` and camelCase overrides; for the TS-only live slip rule add `it('rejects a fractional sales_slip_months', …)` building `{ ...unitSalesDoc(), scenarios: { ...d.scenarios, downside: { ...d.scenarios.downside, sales_slip_months: 1.5 } } }` and asserting the field.

- [ ] **Step 5: Migration-gate properties 2 and 3.** In `tests/test_migrate_v12.py` add:

```python
def test_property_2_v12_only_rules_are_silent_on_a_migrated_document():
    for p in FIXTURES:
        issues = validate_inputs(migrate_inputs_to_v12(_FIXTURE_DOCS[p]["inputs"], None))
        assert not [i for i in issues if i.field.startswith("unit_sales") or i.field.endswith("sales_slip_months")], p.stem


def test_property_3_the_v12_only_rules_can_actually_fire():
    # Control: fixture I carries sales_phasing; giving it a unit_sales block trips rule 1.
    raw = migrate_inputs_to_v12(_load_fixture(FIXTURE_DIR / "i-phased-sales.json")["inputs"], None).model_dump(mode="json")
    raw["unit_sales"] = {"deposit_release": "held_to_completion", "units": []}
    fields = {i.field for i in validate_inputs(migrate_inputs_to_v12(raw, None))}
    assert "unit_sales" in fields and "sales_phasing" in fields
```

and the TS twins in the v12 block of `migrate.test.ts`.

- [ ] **Step 6: Run** `python -m pytest -q tests/test_financial_model_validation.py tests/test_migrate_v12.py tests/test_fixtures_unit_sales.py` and `npx vitest run src/lib/model/validation.test.ts src/lib/model/migrate.test.ts src/lib/model/__fixtures__` → PASS. Then the full suites.

- [ ] **Step 7: Commit.** `git commit -m "feat(r13b): unit_sales validation rules 1-9 and the sales_slip whole-month rule, both engines (spec 22.7)"`

---

### Task 6: Wire the ledger — receipts, `Schedule.unit_sales`, `AppraisalResultV2.unit_sales`

**Files:**
- Modify: `app/financial_model/schedule.py` (import; `Schedule` dataclass ~L226–261; the exit/sales section L517–574; `selling_costs` L622; `return Schedule(...)` L651–690)
- Modify: `app/financial_model/metrics.py` (`AppraisalResultV2` ~L231; construction ~L815)
- Modify: `frontend/src/lib/model/schedule.ts` (sales section L240–289; return L346–399), `finance-types.ts` (`Schedule` ~L517, `AppraisalResultV2` ~L766), `metrics.ts` (return ~L565)
- Modify: `tests/test_financial_model_schedule.py`, `tests/test_financial_model_engine.py` (or a new class in the schedule file), `frontend/src/lib/model/schedule.test.ts`, `monthly-engine.test.ts`

**Interfaces:**
- Produces: `Schedule.unit_sales: UnitSalesResult | None = None` (py) / `unit_sales: UnitSalesResult | null` (ts); `AppraisalResultV2.unit_sales` republished from the schedule; `ScheduleTotals.selling_costs_pence` = sum-of-units on the per-unit path.

- [ ] **Step 1: Failing tests (Python)** in `tests/test_financial_model_schedule.py`:

```python
from app.financial_model import run_appraisal
from .fixtures_unit_sales import held_twin_doc, unit_sales_doc


class TestUnitSalesInSchedule:
    """Sec 22.3. Twin of schedule.test.ts's '§22.3 unit sales in the schedule'."""

    def test_writes_released_deposits_and_completions_into_gross_sale_pence(self):
        s = build_schedule(unit_sales_doc())
        by_month = {m: (r.gross_sale_pence, r.agent_fee_pence, r.selling_legal_pence)
                    for m, r in enumerate(s.receipts) if r.gross_sale_pence > 0}
        assert by_month == {
            8: (2_600_000, 0, 0), 10: (3_000_000, 0, 0), 11: (1_050_000, 0, 0),
            12: (23_400_000, 390_000, 201_550), 13: (44_500_000, 800_000, 285_659),
            20: (19_950_000, 315_000, 162_791),
        }
        assert sum(r.gross_sale_pence for r in s.receipts) == 94_500_000
        assert s.totals.gross_sales_pence == 94_500_000 and s.totals.gdv_pence == 94_500_000
        assert s.totals.selling_costs_pence == 2_155_000  # sum of units, not round(G x 1.5%) + 500,000
        assert s.resolved_exit_months.tranches == []
        assert s.unit_sales is not None and s.unit_sales["pre_sold"]["pct"] == 81.48

    def test_held_twin_books_everything_at_completion(self):
        s = build_schedule(held_twin_doc())
        by_month = {m: r.gross_sale_pence for m, r in enumerate(s.receipts) if r.gross_sale_pence > 0}
        assert by_month == {12: 26_000_000, 13: 47_500_000, 20: 21_000_000}
        assert s.totals.selling_costs_pence == 2_155_000

    def test_null_path_is_untouched(self):
        s = build_schedule(unit_sales_doc({"unit_sales": None}))
        assert s.unit_sales is None
        assert s.receipts[23].gross_sale_pence == 94_500_000  # single final-month disposal

    def test_deposit_liveness_on_absolute_ledger_figures(self):
        released = run_appraisal(unit_sales_doc())
        held = run_appraisal(held_twin_doc())
        # Identical on every unit-set and cost total ...
        for name in ("gdv_pence", "gross_sales_pence", "selling_costs_pence"):
            assert getattr(released.metrics, name) == getattr(held.metrics, name)
        # ... and DIFFERENT where cash timing bites: the deposit sweeps early.
        assert released.model.months[8].repayment_pence == 2_600_000
        assert held.model.months[8].repayment_pence == 0
        assert released.metrics.finance_costs_pence < held.metrics.finance_costs_pence
        assert [e.month for e in released.model.redemption_schedule] == [8, 10, 11, 12, 13, 20]
        assert [e.month for e in held.model.redemption_schedule] == [12, 13, 20]
        # The result block is republished, never recomputed.
        assert released.metrics.unit_sales is released.schedule.unit_sales
        assert held.metrics.unit_sales["totals"]["deposits_released_pence"] == 0
```

Verify `LedgerMonth.repayment_pence` is the sweep's field name (`engine.py:49–89`) — if the deposit month's repayment includes any same-month reclaim, adjust the assertion to the sale-sweep component and say so.

- [ ] **Step 2: Run** → FAIL (`Schedule` has no `unit_sales`; receipts land at month 23).

- [ ] **Step 3: Implement (Python).** In `schedule.py`: `from .unit_sales import UnitSalesResult, compute_unit_sales`. Add to `Schedule` after `investment_case`:

```python
    # R13b spec Sec 22.6. compute_unit_sales's full result, computed once here
    # and republished (never recomputed) onto AppraisalResultV2. None exactly
    # when the INPUT unit_sales is None.
    unit_sales: UnitSalesResult | None = None
```

Replace the sales write-back so the structure reads:

```python
    sales_phasing = getattr(inputs, "sales_phasing", None)
    # R13b spec Sec 22.2/22.3. The sold set's (id, gross) pairs -- value plus
    # ancillary, the same figure gross_sales summed above -- handed to the pure
    # module so gdv and receipts stay equal by construction.
    unit_sales = compute_unit_sales(
        inputs, term, resolve_anchor_month,
        [(u.id, u.estimated_value_pence + unit_ancillary_value_pence(u)) for u in sold_units],
    )
    if gross_sales > 0:
        if unit_sales is not None:
            # Sec 22.3: accumulate (+=), never the single-disposal arm's full
            # replace. A released deposit is gross_sale_pence in the exchange
            # month; the balance and both costs land at completion.
            for row in unit_sales["units"]:
                if row["deposit_released_pence"] > 0 and row["exchange_month"] is not None:
                    receipts[row["exchange_month"]].gross_sale_pence += row["deposit_released_pence"]
                c = row["completion_month"]
                receipts[c].gross_sale_pence += row["gross_pence"] - row["deposit_released_pence"]
                receipts[c].agent_fee_pence += row["agent_fee_pence"]
                receipts[c].selling_legal_pence += row["legal_fee_pence"]
        elif sales_phasing is None:
            ...existing single-disposal arm, unchanged...
        else:
            ...existing tranche arm, unchanged...
```

and

```python
    # Sec 22.2: totals are sum-of-units on the per-unit path.
    selling_costs = (
        unit_sales["totals"]["agent_fees_pence"] + unit_sales["totals"]["legal_fees_pence"]
        if unit_sales is not None
        else (agent_fee + selling_legal if gross_sales > 0 else 0)
    )
```

Pass `unit_sales=unit_sales` in `return Schedule(...)`. In `metrics.py` add `unit_sales: UnitSalesResult | None` to `AppraisalResultV2` beside `investment_case` (import the TypedDict from `.unit_sales`) and set `unit_sales=schedule.unit_sales,` in the constructor. Grep `AppraisalResultV2(` across `app/` and `tests/` for any other construction site and add the field.

- [ ] **Step 4: Implement (TS).** `schedule.ts`: import `computeUnitSales`; after `salesPhasing` compute `const unitSales = computeUnitSales(inputs, term, resolveAnchorMonth, soldUnits.map((u) => ({ unit_id: u.id, gross_pence: u.estimated_value_pence + unitAncillaryValuePence(u) })));` and add the `if (unitSales != null) { … += … } else if (salesPhasing == null) { … } else { … }` branch, the `sellingCosts` ternary, and `unit_sales: unitSales` in the return. `finance-types.ts`: `Schedule.unit_sales: UnitSalesResult | null;` and `AppraisalResultV2.unit_sales: UnitSalesResult | null;` (doc comments mirroring `investment_case`'s). `metrics.ts`: `unit_sales: schedule.unit_sales,`. Port Step 1's tests to `schedule.test.ts` (`describe('§22.3 unit sales in the schedule')`) using `unitSalesDoc`/`heldTwinDoc`, `runAppraisal`, `toBe` for the republish identity.

- [ ] **Step 5: Run** both files, then `npx tsc -b`, then both FULL suites — the golden corpus must be green with X still on its two pins (its receipts now land per unit; gdv and gross_sales are unchanged).

- [ ] **Step 6: Commit.** `git commit -m "feat(r13b): per-unit receipts enter the ledger; Schedule/AppraisalResultV2 republish unit_sales (spec 22.3, 22.6)"`

---

### Task 7: Fixture X — the full pin set and the worksheet

**Files:**
- Modify: `fixtures/financial-model/x-unit-sales-ledger.json` (`expected_metrics`)
- Modify: `tests/test_financial_model_fixtures.py` (`_FLAT_KEYS` L101–244), `frontend/src/lib/model/golden-fixtures.test.ts` (`FLAT_KEYS` L111–205)
- Modify: `docs/financial-model/test-cases.md` (append `## 22. Unit sales ledger [R13b — calc 2.14.0]` with `### 22.1 Fixture X — …` in the `### 20.4 Fixture W` style)

**Interfaces:**
- Produces FLAT_KEYS (both sides, identical names): `unit_sales_unit_ids`, `unit_sales_unit_gross_pence`, `unit_sales_unit_deposit_pence`, `unit_sales_unit_deposit_released_pence`, `unit_sales_unit_agent_fee_pence`, `unit_sales_unit_legal_fee_pence`, `unit_sales_unit_net_pence`, `unit_sales_unit_exchange_months`, `unit_sales_unit_completion_months`, `unit_sales_deposits_received_pence` (per-month array), `receipts_gross_sale_pence` (per-month array). Dotted keys resolve through the TypedDict/object: `unit_sales.pre_sold.pct`, `unit_sales.pre_sold.reference_month`, `unit_sales.pre_sold.basis`, `unit_sales.totals.net_pence`, `unit_sales.deposit_release`.

- [ ] **Step 1: Mappers.** Python:

```python
    # R13b spec Sec 22.6, fixture X: unit_sales.units/months are LISTS, so a
    # dotted path cannot reach them (the cost_plan.contingency reasoning above).
    "unit_sales_unit_ids": lambda r: [u["unit_id"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_gross_pence": lambda r: [u["gross_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_deposit_pence": lambda r: [u["deposit_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_deposit_released_pence": lambda r: [u["deposit_released_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_agent_fee_pence": lambda r: [u["agent_fee_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_legal_fee_pence": lambda r: [u["legal_fee_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_net_pence": lambda r: [u["net_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_exchange_months": lambda r: [u["exchange_month"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_completion_months": lambda r: [u["completion_month"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_deposits_received_pence": lambda r: [m["deposits_received_pence"] for m in r.metrics.unit_sales["months"]],
    "receipts_gross_sale_pence": lambda r: [x.gross_sale_pence for x in r.schedule.receipts],
```

TS twins with `r.metrics.unit_sales!.units.map((u) => u.unit_id)` etc.

- [ ] **Step 2: Pins.** Set `expected_metrics` to:

```json
"gdv_pence": 94500000, "gross_sales_pence": 94500000, "selling_costs_pence": 2155000,
"unit_sales.deposit_release": "released_on_exchange",
"unit_sales_unit_ids": ["u1", "u2", "u3", "u4"],
"unit_sales_unit_gross_pence": [26000000, 30000000, 17500000, 21000000],
"unit_sales_unit_deposit_pence": [2600000, 3000000, 0, 1050000],
"unit_sales_unit_deposit_released_pence": [2600000, 3000000, 0, 1050000],
"unit_sales_unit_agent_fee_pence": [390000, 450000, 350000, 315000],
"unit_sales_unit_legal_fee_pence": [201550, 150000, 135659, 162791],
"unit_sales_unit_net_pence": [25408450, 29400000, 17014341, 20522209],
"unit_sales_unit_exchange_months": [8, 10, null, 11],
"unit_sales_unit_completion_months": [12, 13, 13, 20],
"unit_sales.totals.net_pence": 92345000,
"unit_sales.pre_sold.reference_month": 12,
"unit_sales.pre_sold.basis": "practical_completion",
"unit_sales.pre_sold.exchanged_value_pence": 77000000,
"unit_sales.pre_sold.pct": 81.48,
"unit_sales_deposits_received_pence": [0,0,0,0,0,0,0,0,2600000,0,3000000,1050000,0,0,0,0,0,0,0,0,0,0,0,0],
"receipts_gross_sale_pence": [0,0,0,0,0,0,0,0,2600000,0,3000000,1050000,23400000,44500000,0,0,0,0,0,0,19950000,0,0,0],
"redemption_schedule_months": [8, 10, 11, 12, 13, 20],
"programme_phase_start_months": [0, 1, 1, 4, 8, 12, 12],
"funding_gap_pence": 0
```

then the ledger-dependent pins, **derived by worksheet before pinning**: `peak_debt_pence`, `peak_debt_month`, `finance_costs_pence`, `total_development_cost_pence`, `profit_pence`, `redemption_balance_at_disposal_pence`, `redemption_schedule_balances_pence`, `senior_breakeven_pence` (this last one is Task 8's — leave it out here and let Task 8 add it), `report_safe` via the reconciliation (`profit_is_unrealised: false`). Worksheet: month-by-month uses (acquisition at 0 with SDLT; the statutory 200,000 over conditions 1–2; the architect 1,500,000 over design 1–3; construction 27,300,000 straight-line over 4–11 = 3,412,500/month), equity 20,000,000 first, then draws; arrangement fee 900,000 capitalised at 0; 1%/month rolled-up interest on `(balance + draw)`; receipts per the pinned array with the sweep at 100%; exit fee 520,000 at the first full redemption. Write it in `test-cases.md` §22.1 in W's style. **If the worksheet and either engine disagree by more than a rounding penny on any month, report it — do not pin the engine's figure.** Both engines must agree to the penny on every pin.

- [ ] **Step 3: Run** the two golden suites and both invariant suites → PASS.

- [ ] **Step 4: Commit.** `git commit -m "test(r13b): fixture X pinned in both engines with the hand worksheet (spec 22, test-cases 22.1)"`

---

### Task 8: §5.11's receipt-lines arm and the §5.12 basis on the per-unit path

**Files:**
- Modify: `app/financial_model/breakeven.py` (`PhasedSeniorBreakevenTerms` L108–136; `_phased_net_by_month` L139–169; `solve_senior_breakeven_phased` L243–253 guards)
- Modify: `frontend/src/lib/model/breakeven.ts` (L93–115; L119–137; L207–214)
- Modify: `app/financial_model/metrics.py` (phased dispatch L604–692; developer break-even L702–712), `frontend/src/lib/model/metrics.ts` (L383–452; L462–477)
- Modify: `tests/test_financial_model_breakeven.py`, `frontend/src/lib/model/breakeven.test.ts`, `tests/test_financial_model_metrics.py`, `frontend/src/lib/model/metrics.test.ts`, `fixtures/financial-model/x-unit-sales-ledger.json` (+ `senior_breakeven_pence`, `developer_breakeven_pence`)

**Interfaces:**
- Produces (py): `@dataclass class ReceiptLine: month: int; base_gross_pence: int; agent_fee_pct: float; legal_fee_pence: int`; `PhasedSeniorBreakevenTerms.receipt_lines: list[ReceiptLine] | None = None` (last field, defaulted); `receipt_lines_from_unit_sales(us: UnitSalesResult) -> list[ReceiptLine]` in `metrics.py`.
- Produces (ts): `interface ReceiptLine { month; base_gross_pence; agent_fee_pct; legal_fee_pence }`; `PhasedSeniorBreakevenTerms.receipt_lines?: ReceiptLine[]`; `receiptLinesFromUnitSales(us)` in `metrics.ts`.

- [ ] **Step 1: Failing solver tests (Python).** In `tests/test_financial_model_breakeven.py` add:

```python
from app.financial_model.breakeven import ReceiptLine, _phased_net_by_month


class TestReceiptLinesArm:
    """Sec 22.5. Twin of breakeven.test.ts's 'receipt-lines arm' describe."""

    def _terms(self, lines, enforcement=0):
        return dc_replace(_phased_base(), tranches=[], receipt_lines=lines,
                          enforcement_cost_assumption_pence=enforcement, selling_agent_fee_pct=0)

    def test_scales_lines_uniformly_with_last_line_residue_and_fixed_legal(self):
        lines = [ReceiptLine(6, 2_600_000, 0, 0), ReceiptLine(12, 23_400_000, 1.5, 201_550)]
        # G = 13,000,000 = exactly half of the 26,000,000 base.
        assert _phased_net_by_month(self._terms(lines, enforcement=100_000), 13_000_000) == {
            6: 1_300_000 - 100_000,                       # deposit line, enforcement off the FIRST line
            12: 11_700_000 - 175_500 - 201_550,           # agent scales (round(11,700,000 x 1.5%)), legal does not
        }
        # One penny more: the first line rounds down, the LAST line absorbs the residue.
        assert _phased_net_by_month(self._terms(lines), 13_000_001) == {6: 1_300_000, 12: 11_700_001 - 175_500 - 201_550}

    def test_zero_or_negative_total_gross_yields_no_receipts(self):
        assert _phased_net_by_month(self._terms([ReceiptLine(6, 1, 0, 0)]), 0) == {}

    def test_structural_guards_read_the_lines_not_the_tranches(self):
        base = self._terms([ReceiptLine(2, 5_000_000, 0, 0), ReceiptLine(3, 5_000_000, 0, 0)])
        assert solve_senior_breakeven_phased(base) is not None
        assert solve_senior_breakeven_phased(dc_replace(base, receipt_lines=[])) is None
        # draws after the last line month -> structurally unsolvable (a draw at
        # month 2 after a single line at month 1; the base draws only at month 0)
        assert solve_senior_breakeven_phased(dc_replace(
            base, draws_and_fees_pence=[10_000_000, 0, 5_000_000, 0], receipt_lines=[ReceiptLine(1, 10_000_000, 0, 0)],
        )) is None
        assert solve_senior_breakeven_phased(dc_replace(base, receipt_lines=[ReceiptLine(3, 10_000_000, 100, 0)])) is None

    def test_two_equal_lines_reproduce_the_two_tranche_hand_figure(self):
        # The tranche fixture's 50/50 split at months 2 and 3 is the same
        # receipt profile as two equal lines: the arms must agree.
        lines = [ReceiptLine(2, 5_000_000, 0, 0), ReceiptLine(3, 5_000_000, 0, 0)]
        assert solve_senior_breakeven_phased(self._terms(lines)) == solve_senior_breakeven_phased(_phased_base())
```

(Check the last test's premise: the tranche arm splits `round(G × 50/100)` then residue; the lines arm splits `round(5,000,000 × G/10,000,000)` then residue — identical for every integer G, so the solved minimum is identical. If the two differ, report the G at which they diverge; do not loosen the assertion.)

- [ ] **Step 2: Run** → FAIL (`ReceiptLine` missing).

- [ ] **Step 3: Implement the arm (Python).** In `breakeven.py`:

```python
@dataclass
class ReceiptLine:
    """R13b spec Sec 22.5. One dated receipt at its BASE (unstressed) gross; the
    replay scales every line by G / G_base. A released deposit is a line with
    no costs; a completion carries the unit's agent rate and its fixed legal."""
    month: int
    base_gross_pence: int
    agent_fee_pct: float
    legal_fee_pence: int
```

Add `receipt_lines: list[ReceiptLine] | None = None` as the LAST field of `PhasedSeniorBreakevenTerms` with a comment: *"Sec 22.5's second arm. When non-None the tranche arm is not consulted; the list is already sorted by (month, units[] order) by its builder."* In `_phased_net_by_month`, at the top:

```python
    if t.receipt_lines is not None:
        out: dict[int, int] = {}
        base_total = sum(line.base_gross_pence for line in t.receipt_lines)
        if total_gross <= 0 or base_total <= 0:
            return out
        allocated = 0
        for i, line in enumerate(t.receipt_lines):
            last = i == len(t.receipt_lines) - 1
            gross = (
                total_gross - allocated if last
                else money_round((line.base_gross_pence * total_gross) / base_total)
            )
            allocated += gross
            agent = money_round((gross * line.agent_fee_pct) / 100)
            enforcement = t.enforcement_cost_assumption_pence if i == 0 else 0
            out[line.month] = out.get(line.month, 0) + gross - agent - line.legal_fee_pence - enforcement
        return out
    ...existing tranche arithmetic, byte-identical...
```

In `solve_senior_breakeven_phased` generalise the guards:

```python
    if t.receipt_lines is not None:
        if len(t.receipt_lines) == 0 or any(line.agent_fee_pct >= 100 for line in t.receipt_lines):
            return None
        last_month = max(line.month for line in t.receipt_lines)
    else:
        if t.selling_agent_fee_pct >= 100 or len(t.tranches) == 0:
            return None
        last_month = max(x.month_offset for x in t.tranches)
    if t.sales_sweep_pct <= 0:
        return None
    for m in range(last_month + 1, len(t.draws_and_fees_pence)):
        if t.draws_and_fees_pence[m] > 0:
            return None
```

(preserving the existing order of checks for the tranche arm so its `None` cases are unchanged). TS: `receipt_lines?: ReceiptLine[]`, `phasedNetByMonth` gains the same first branch (`Math.round`), guards likewise.

- [ ] **Step 4: Metrics dispatch (Python).** In `metrics.py` add:

```python
def receipt_lines_from_unit_sales(us: UnitSalesResult) -> list[ReceiptLine]:
    """Sec 22.5. One line per released deposit (exchange month, no costs) and
    one per completion (gross less the released deposit, the unit's agent
    rate, its fixed legal). Sorted by month, then units[] order, deposit
    before completion for the same unit -- enforcement comes off the first."""
    lines: list[tuple[int, int, int, ReceiptLine]] = []
    for i, row in enumerate(us["units"]):
        agent_pct = (row["agent_fee_pence"] / row["gross_pence"] * 100) if row["gross_pence"] > 0 else 0.0
        if row["deposit_released_pence"] > 0 and row["exchange_month"] is not None:
            lines.append((row["exchange_month"], i, 0, ReceiptLine(row["exchange_month"], row["deposit_released_pence"], 0.0, 0)))
        lines.append((row["completion_month"], i, 1, ReceiptLine(
            row["completion_month"], row["gross_pence"] - row["deposit_released_pence"], agent_pct, row["legal_fee_pence"],
        )))
    return [line for _, _, _, line in sorted(lines, key=lambda x: (x[0], x[1], x[2]))]
```

`agent_pct` is the row's EFFECTIVE rate (`agent_fee_pence / gross × 100`), which reproduces the row's own fee at scale 1 (`round(gross × pct/100) == agent_fee_pence`) and scales with price — note the override may be null, so the rate is recovered from the pence, never re-read from the input. In the senior break-even block change the dispatch to:

```python
    unit_sales_result = schedule.unit_sales
    if redemption_balance is not None:
        if unit_sales_result is None and phasing is None:
            ...static arm, unchanged...
        else:
            if unit_sales_result is not None:
                lines = receipt_lines_from_unit_sales(unit_sales_result)
                last_month = max((line.month for line in lines), default=-1)
                tranche_arg: list = []
                lines_arg: list[ReceiptLine] | None = lines
            else:
                ...Task 9 rewrites this arm to use resolved months...
                last_month = max(tr.month_offset for tr in phasing.tranches)
                tranche_arg = phasing.tranches
                lines_arg = None
            if any(mm.month > last_month and mm.draw_pence + mm.capitalised_fees_pence > 0 for mm in model.months):
                senior_unsolvable_reason = (... existing "draws continue after the final sales tranche" text ...)
            elif inputs.finance.sales_sweep_pct <= 0:
                senior_unsolvable_reason = (... existing text ...)
            else:
                phased_terms = PhasedSeniorBreakevenTerms(..., tranches=tranche_arg, ..., receipt_lines=lines_arg)
                ...
```

Developer break-even: on the per-unit path pass the effective blended rate and summed legal:

```python
        if unit_sales_result is not None and unit_sales_result["totals"]["gross_pence"] > 0:
            dev_agent_pct = unit_sales_result["totals"]["agent_fees_pence"] / unit_sales_result["totals"]["gross_pence"] * 100
            dev_legal = unit_sales_result["totals"]["legal_fees_pence"]
        else:
            dev_agent_pct = inputs.exit_strategy.selling_agent_fee_pct
            dev_legal = inputs.exit_strategy.selling_legal_fee_pence
        developer_breakeven_terms = DeveloperBreakevenTerms(tdc_ex_selling_pence=tdc_ex_selling, selling_agent_fee_pct=dev_agent_pct, selling_legal_fee_pence=dev_legal)
```

TS mirrors all of it (`receiptLinesFromUnitSales`, `receipt_lines: linesArg`, the developer terms).

- [ ] **Step 5: Metrics tests.** Python (`tests/test_financial_model_metrics.py`):

```python
from .fixtures_unit_sales import held_twin_doc, unit_sales_doc


def test_unit_sales_path_solves_the_phased_breakeven_and_released_is_lower_than_held():
    released = run_appraisal(unit_sales_doc()).metrics
    held = run_appraisal(held_twin_doc()).metrics
    assert released.senior_breakeven_pence is not None and held.senior_breakeven_pence is not None
    assert released.senior_breakeven_pence < held.senior_breakeven_pence
    assert not any(f.code == "senior_breakeven_unsolvable" for f in released.flags)


def test_developer_breakeven_uses_the_per_unit_cost_basis():
    # Same document with u3's 2.0% override removed: the blended rate falls
    # (350,000 -> 262,500 on u3), so the developer break-even falls with it.
    with_override = run_appraisal(unit_sales_doc()).metrics.developer_breakeven_pence
    rows = unit_sales_doc().model_dump(mode="json")["unit_sales"]["units"]
    rows[2]["agent_fee_pct"] = None
    without = run_appraisal(unit_sales_doc({"rows": rows})).metrics.developer_breakeven_pence
    assert with_override is not None and without is not None
    assert with_override > without
```

TS twins in `metrics.test.ts`. Then add `senior_breakeven_pence` and `developer_breakeven_pence` to fixture X's pins — **cross-engine agreement is the pin's authority**: run Python, run TS, they must print the same integers; record both in the worksheet with the note that these are bisection results reproduced by both engines, not hand-derived.

- [ ] **Step 6: Run** all four test files + both golden suites → PASS. The tranche-arm identity guard is the existing corpus: fixtures G, I, J, L pin `senior_breakeven_pence` and must not move.

- [ ] **Step 7: Commit.** `git commit -m "feat(r13b): phased break-even gains the receipt-lines arm; developer break-even on the per-unit basis (spec 22.5, 5.12)"`

---

### Task 9: The §5.11 correction — anchored tranches replay at their resolved months

**Files:**
- Modify: `app/financial_model/breakeven.py` (add `ResolvedTranche`), `metrics.py` (the tranche arm of Task 8's dispatch), `frontend/src/lib/model/metrics.ts`
- Modify: `fixtures/financial-model/s-dated-programme.json` (`expected_metrics` + `senior_breakeven_pence: 88720089`)
- Modify: `tests/test_financial_model_metrics.py`, `frontend/src/lib/model/metrics.test.ts`
- Modify: `docs/financial-model/test-cases.md` (S's section: record 90,971,520 as the pre-fix negative control — find the section by searching `Fixture S`)

- [ ] **Step 1: Failing tests FIRST, watched failing on the pre-fix code.** Python:

```python
import copy, json
from pathlib import Path
from app.financial_model.types import parse_calculator_inputs

_S = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "s-dated-programme.json"


def _s_with_first_anchor(phase_id: str):
    doc = copy.deepcopy(json.loads(_S.read_text(encoding="utf-8"))["inputs"])
    doc["sales_phasing"]["tranches"][0]["anchor"] = {"phase_id": phase_id, "offset_months": 0}
    return parse_calculator_inputs(doc)


def test_s_break_even_replays_at_the_resolved_months_not_the_raw_offsets():
    run = run_appraisal(parse_calculator_inputs(json.loads(_S.read_text(encoding="utf-8"))["inputs"]))
    assert run.schedule.resolved_exit_months.tranches == [16, 19]
    # Pre-fix (raw months 20/21) both engines printed 90,971,520 -- the negative control.
    assert run.metrics.senior_breakeven_pence != 90_971_520
    assert run.metrics.senior_breakeven_pence == 88_720_089


def test_unsolvable_guard_reads_the_resolved_month():
    # Both documents keep month_offset 20 on the first tranche. Anchored to
    # strip_out it resolves to month 6 while draws run to 13 -> structurally
    # unsolvable; anchored to building_control (15) it is solvable. On the
    # pre-fix code BOTH were "solvable" at 90,971,520.
    early = run_appraisal(_s_with_first_anchor("strip_out")).metrics
    late = run_appraisal(_s_with_first_anchor("building_control")).metrics
    assert early.senior_breakeven_pence is None
    assert any(f.code == "senior_breakeven_unsolvable" for f in early.flags)
    assert late.senior_breakeven_pence is not None
    assert not any(f.code == "senior_breakeven_unsolvable" for f in late.flags)
```

TS twins (`readFileSync` the fixture, `runAppraisal`, same literals). Run both → FAIL on the current code (S prints 90,971,520; `early` is solvable). **Record the failure output in the task report.**

- [ ] **Step 2: Implement.** `breakeven.py`:

```python
@dataclass
class ResolvedTranche:
    """A tranche as the replay must see it: at the month the LEDGER used
    (Sec 18.6's resolved month), not the entered month_offset. Sec 5.11
    correction (R13b)."""
    month_offset: int
    pct_of_gross_receipts: float
```

`metrics.py` tranche arm: `resolved = schedule.resolved_exit_months.tranches` (read, never recomputed); `tranche_arg = [ResolvedTranche(m, tr.pct_of_gross_receipts) for m, tr in zip(resolved, phasing.tranches)]`; `last_month = max(resolved)`. TS: `tranchesArg = phasing.tranches.map((tr, i) => ({ month_offset: schedule.resolved_exit_months.tranches[i], pct_of_gross_receipts: tr.pct_of_gross_receipts }))`, `lastMonth = Math.max(...schedule.resolved_exit_months.tranches)`. Add a comment at both sites: *"R13b Sec 5.11 correction: before this the replay read tr.month_offset, so an anchored tranche on a slipped programme replayed receipts at a month the ledger never used (fixture S: 20/21 vs 16/19)."*

- [ ] **Step 3: Pin S.** Add `"senior_breakeven_pence": 88720089` to S's `expected_metrics`; in `test-cases.md`'s fixture S section append a paragraph: the raw-month replay printed **90,971,520** in both engines through calc 2.13.0; at the resolved months 16/19 the replay redeems earlier with less rolled-up interest and the minimum falls to **88,720,089**; this is the one pre-existing computed value R13b moves, recorded as a corrected reported metric (spec §5.11, changelog 2.14.0).

- [ ] **Step 4: Run** both metrics test files, both golden suites (G, I, J, L unchanged — unanchored tranches resolve to their own offsets), then both full suites → PASS.

- [ ] **Step 5: Commit.** `git commit -m "fix(r13b): phased break-even replays anchored tranches at the resolved month; S pinned at 88,720,089 (spec 5.11)"`

---

### Task 10: The `sales_slip` lever, both engines and the two pages

**Files:**
- Modify: `app/financial_model/apply_scenario.py` (append before `return out`), `frontend/src/lib/model/apply-scenario.ts` (after the investment_case spread, before `} as T;`)
- Modify: `app/financial_model/sensitivity.py` (Literal L23–35, `LEVER_ORDER`, whole-month sites L195–202 and L260–267, `_zero_scenario` L301–321, `_overrides_for` L324–340), `frontend/src/lib/model/sensitivity.ts` (L20–32, L214–222, L295–305, `ZERO_SCENARIO` L357–368, `overridesFor` L374–387)
- Modify: `frontend/src/lib/sensitivity-format.ts` (`LEVER_LABEL`, `LEVER_SHORT`, `selectableLevers`, `formatStepLabel` L84, `formatRangeLabel` L95), `frontend/src/components/calculator/SensitivityPage.tsx:101`, `ScenariosPage.tsx` (add one input after the interest-rate one)
- Modify: `tests/fixtures_investment_case.py` (`SensitivityLever` Literal L60–63; `_LEVER_FIELD` L503–512), `frontend/src/lib/model/__fixtures__/investment-case-docs.ts` (`LEVER_STEPS`)
- Modify tests: `tests/test_financial_model_apply_scenario.py`, `apply-scenario.test.ts`, `tests/test_financial_model_sensitivity.py`, `sensitivity.test.ts` (incl. the `Record<SensitivityLever, number>` literal at L811–816 gaining `sales_slip: 0`), `frontend/src/lib/sensitivity-format.test.ts`, `SensitivityPage.test.tsx`

- [ ] **Step 1: Failing tests.** Python `test_financial_model_apply_scenario.py`:

```python
from .fixtures_unit_sales import unit_sales_doc


def _slip(months: int) -> ScenarioOverrides:
    return ScenarioOverrides(label="s", gdv_adjustment_pct=0, construction_cost_adjustment_pct=0,
                             timeline_adjustment_months=0, interest_rate_adjustment_pct=0, sales_slip_months=months)


def test_sales_slip_adds_to_completion_only_fixed_or_anchored_additively():
    out = apply_scenario(unit_sales_doc(), _slip(3))
    rows = out.unit_sales.units
    assert rows[3].completion.month_offset == 23          # fixed 20 + 3
    assert rows[0].completion.anchor.offset_months == 3   # practical_completion + 0 -> + 3
    assert rows[1].completion.anchor.offset_months == 4   # + 1 -> + 4, stressed FROM its recorded position
    assert rows[3].exchange.month_offset == 11            # exchange untouched
    assert rows[0].exchange.anchor.offset_months == 0


def test_sales_slip_is_a_no_op_on_the_null_path():
    doc = unit_sales_doc({"unit_sales": None})
    assert apply_scenario(doc, _slip(3)).model_dump() == apply_scenario(doc, _slip(0)).model_dump()


def test_keeps_all_nine_levers_order_independent_on_a_unit_sales_document():
    levers = {"gdv": 5, "construction_cost": 5, "timeline": 2, "interest_rate": 1,
              "exit_yield": 0, "operating_cost": 0, "vacancy": 0, "sales_slip": 2}
    orders = [list(levers), list(reversed(levers)), ["sales_slip", "timeline", "gdv", "interest_rate", "construction_cost", "vacancy", "exit_yield", "operating_cost"]]
    def apply_in(order):
        doc = unit_sales_doc()
        for lever in order:
            doc = apply_scenario(doc, _overrides_for_lever(lever, levers[lever]))
        return run_appraisal(doc).metrics
    results = [apply_in(o) for o in orders]
    assert results[1] == results[0] and results[2] == results[0]
    assert apply_in(orders[0]).unit_sales["units"][3]["completion_month"] == 22  # 20 + 2, inside term 26
```

with this local helper above the test:

```python
_FIELD_OF = {
    "gdv": "gdv_adjustment_pct", "construction_cost": "construction_cost_adjustment_pct",
    "timeline": "timeline_adjustment_months", "interest_rate": "interest_rate_adjustment_pct",
    "exit_yield": "exit_yield_adjustment_pct", "operating_cost": "operating_cost_adjustment_pct",
    "vacancy": "vacancy_adjustment_pct", "sales_slip": "sales_slip_months",
}


def _overrides_for_lever(lever: str, value: float) -> ScenarioOverrides:
    return _slip(0).model_copy(update={_FIELD_OF[lever]: value})
```

(`phase_slip` is omitted deliberately — X's network would need a target and the lever is exercised by its own R12 tests; the nine-lever `ic_doc` test covers its order slot.) Also extend the existing eight-lever order test to nine (`_LEVER_FIELD["sales_slip"] = "sales_slip_months"` in `fixtures_investment_case.py`; it runs on `ic_doc()` where the lever is inert, which is fine — the test above is the live one).

Python `test_financial_model_sensitivity.py`:

```python
def test_sales_slip_gives_a_zero_width_tornado_bar_on_a_null_unit_sales_document():
    doc = explicit_refinance_doc()
    result = run_sensitivity(doc, SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0]), cols=SensitivityAxis(lever="construction_cost", steps=[0]),
        tornado=[TornadoRange(lever="sales_slip", low=-1, high=1)]))
    bar = result.tornado[0]
    assert bar.low.profit_pence is not None and bar.low.profit_pence == bar.high.profit_pence


def test_sales_slip_cells_go_invalid_not_clamped_at_both_ends():
    result = run_sensitivity(unit_sales_doc(), SensitivityConfig(
        rows=SensitivityAxis(lever="sales_slip", steps=[-5, 0, 4]),
        cols=SensitivityAxis(lever="gdv", steps=[0]), tornado=[]))
    cells = [result.matrix[i][0] for i in range(3)]
    assert cells[0].profit_pence is None and any(e.field == "unit_sales.units[0].exchange" for e in cells[0].validation_errors)
    assert cells[1].profit_pence is not None and cells[1].validation_errors == []
    assert cells[2].profit_pence is None and any(e.field == "unit_sales.units[3].completion" for e in cells[2].validation_errors)


def test_sales_slip_steps_must_be_whole_months():
    issues = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="sales_slip", steps=[0.5]), cols=SensitivityAxis(lever="gdv", steps=[0]), tornado=[]))
    assert any("sales_slip steps must be whole months." == i.message for i in issues)
```

(Confirm the matrix indexing shape `result.matrix[row][col]` and the cell field `validation_errors` against the existing invalid-cell test at L1005–1024 and copy its access pattern.) TS twins for all of the above; in `sensitivity-format.test.ts` assert `LEVER_LABEL.sales_slip === 'Sales slip'`, `formatStepLabel('sales_slip', 3)` ends with `'months'`, and `selectableLevers(true, false)` excludes `sales_slip` while `selectableLevers(false, true)` includes it and excludes `phase_slip`.

- [ ] **Step 2: Run** → FAIL (unknown lever / missing field).

- [ ] **Step 3: Implement.** Python `apply_scenario.py`, before `return out`:

```python
    # R13b spec Sec 22.8. ADDITIVE, completion only: the anchor offset when
    # anchored, else month_offset. Exchange dates are marketing facts and do
    # not move. Gated on presence, so a v2-v11 document and a v12 document
    # whose unit_sales is None are both no-ops by construction.
    unit_sales = getattr(out, "unit_sales", None)
    if unit_sales is not None and overrides.sales_slip_months != 0:
        for row in unit_sales.units:
            if row.completion.anchor is not None:
                row.completion.anchor.offset_months += overrides.sales_slip_months
            else:
                row.completion.month_offset += overrides.sales_slip_months
```

TS `apply-scenario.ts`, a fourth conditional spread:

```ts
    ...('unit_sales' in inputs && inputs.unit_sales != null && overrides.sales_slip_months !== 0
      ? {
        unit_sales: {
          ...inputs.unit_sales,
          units: inputs.unit_sales.units.map((row) => ({
            ...row,
            completion: row.completion.anchor != null
              ? { ...row.completion, anchor: { ...row.completion.anchor, offset_months: row.completion.anchor.offset_months + overrides.sales_slip_months } }
              : { ...row.completion, month_offset: row.completion.month_offset + overrides.sales_slip_months },
          })),
        },
      }
      : {}),
```

`sensitivity.py`/`.ts`: append `"sales_slip"` to the Literal/type and `LEVER_ORDER` (last); make the four whole-month sites three-way (`in ("timeline", "phase_slip", "sales_slip")`, label `"Timeline steps" if timeline else f"{axis.lever} steps"` — i.e. `"phase_slip steps"` / `"sales_slip steps"`, same for `bounds`); `_zero_scenario()`/`ZERO_SCENARIO` gain `sales_slip_months=0`; `_overrides_for`/`overridesFor` gain `sales_slip_months=int(setting.value) if setting.lever == "sales_slip" else 0` (TS without the cast). `sensitivity-format.ts`: `LEVER_LABEL.sales_slip = 'Sales slip'`, `LEVER_SHORT.sales_slip = 'Sales'`, `selectableLevers(hasPhaseNetwork: boolean, hasUnitSales: boolean)` filtering `sales_slip` when `!hasUnitSales`, and `sales_slip` joined to both months disjunctions. `SensitivityPage.tsx:101`: `selectableLevers(network != null, 'unit_sales' in inputs && inputs.unit_sales != null)`. `ScenariosPage.tsx`: one more `<label>` block, `Sales slip (months)`, `type="number" step="1"`, bound to `sales_slip_months`, in the same style as the four above it.

- [ ] **Step 4: Run** all touched test files, `npx tsc -b`, lint, then both full suites → PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(r13b): sales_slip lever - applyScenario, sensitivity config, tornado, page wiring (spec 22.8, 12.1, 12.6)"`

---

### Task 11: `UnitSalesEditor` on the Exit page

**Files:**
- Create: `frontend/src/components/calculator/UnitSalesEditor.tsx`, `UnitSalesEditor.test.tsx`
- Modify: `frontend/src/components/calculator/ExitStrategyPage.tsx` (`ExitCarrier` L26–32; the phasing handlers L114–143; `selectRoute` L160–168; the retained-units handler — locate by searching `retained_units:`; render site beside L506–566), `ExitStrategyPage.test.tsx`

**Interfaces:**
- Produces: `UnitSalesEditor` props `{ unitSales: UnitSalesInputs; result: UnitSalesResult | null; phases: Phase[]; term: number; units: Array<{ id: string; type: string }>; schemeAgentPct: number; schemeLegalPence: number; onChange: (next: UnitSalesInputs) => void }`; exported pure helpers `seedUnitSales(soldIds: string[], term: number): UnitSalesInputs` (rows at `completion { month_offset: term - 1, anchor: null }`, `exchange: null`, `deposit_pct: 0`, overrides null, `deposit_release: 'held_to_completion'`) and `reconcileUnitSalesRows(unitSales: UnitSalesInputs, soldIds: string[], term: number): UnitSalesInputs` (drops rows not in `soldIds`, appends seeded rows for missing ids, preserves order of survivors). `ExitStrategyPage` gains `hasUnitSales<T>(x): x is T & CalculatorInputsV12`.

- [ ] **Step 1: Failing tests** `UnitSalesEditor.test.tsx` (render with `unitSalesDoc()`'s block and a `runAppraisal(doc).metrics.unit_sales` result):

```ts
function renderEditor(doc = unitSalesDoc(), onChange = vi.fn()) {
  const run = runAppraisal(doc);
  render(<UnitSalesEditor unitSales={doc.unit_sales!} result={run.metrics.unit_sales} phases={doc.programme?.phases ?? []} term={24}
    units={doc.unit_mix.units.map((u) => ({ id: u.id, type: u.type }))} schemeAgentPct={1.5} schemeLegalPence={500000} onChange={onChange} />);
  return { doc, onChange, run };
}

it('renders one row per unit with the resolved months read off the result block', () => {
  renderEditor();
  expect(screen.getAllByRole('row')).toHaveLength(1 + 4 + 1); // header + 4 units + totals
  expect(screen.getAllByText(/resolves to month 12/).length).toBeGreaterThan(0); // u1 completion
  expect(screen.getByText(/Pre-sold 81.48%/)).toBeInTheDocument();             // read, not computed
});
it('emits the whole block with the one changed field', () => {
  const { doc, onChange } = renderEditor();
  fireEvent.change(screen.getByLabelText('u4 deposit %'), { target: { value: '7.5' } });
  const next = onChange.mock.calls[0][0] as UnitSalesInputs;
  expect(next.units[3].deposit_pct).toBe(7.5);
  expect(next.units[0]).toEqual(doc.unit_sales!.units[0]);
});
it('a blank legal override emits null, an explicit 0 emits 0', () => {
  const { onChange } = renderEditor();
  fireEvent.change(screen.getByLabelText('u2 legal £'), { target: { value: '' } });
  expect((onChange.mock.calls[0][0] as UnitSalesInputs).units[1].legal_fee_pence).toBeNull();
  fireEvent.change(screen.getByLabelText('u2 legal £'), { target: { value: '0' } });
  expect((onChange.mock.calls[1][0] as UnitSalesInputs).units[1].legal_fee_pence).toBe(0);
});
it('switching an exchange to simultaneous also zeroes the deposit in the same emit', () => {
  const { onChange } = renderEditor();
  fireEvent.click(screen.getByLabelText('u1 exchange simultaneous'));
  const next = onChange.mock.calls[0][0] as UnitSalesInputs;
  expect(next.units[0].exchange).toBeNull();
  expect(next.units[0].deposit_pct).toBe(0);
});
it('seedUnitSales and reconcileUnitSalesRows keep exactly one row per sold unit', () => {
  const seeded = seedUnitSales(['u1', 'u2'], 24);
  expect(seeded).toEqual({ deposit_release: 'held_to_completion', units: [
    { unit_id: 'u1', exchange: null, completion: { month_offset: 23, anchor: null }, deposit_pct: 0, agent_fee_pct: null, legal_fee_pence: null },
    { unit_id: 'u2', exchange: null, completion: { month_offset: 23, anchor: null }, deposit_pct: 0, agent_fee_pct: null, legal_fee_pence: null },
  ] });
  const r = reconcileUnitSalesRows(unitSalesDoc().unit_sales!, ['u2', 'u3', 'u9'], 24);
  expect(r.units.map((x) => x.unit_id)).toEqual(['u2', 'u3', 'u9']);
  expect(r.units[0]).toEqual(unitSalesDoc().unit_sales!.units[1]); // survivor untouched
});
```

`ExitStrategyPage.test.tsx` additions (using `unitSalesDoc()` / `unitSalesDoc({ unitSales: null })`):

```ts
it('enabling the per-unit ledger seeds one row per sold unit and nulls sales_phasing in the same payload', () => {
  const inputs = { ...unitSalesDoc({ unitSales: null }), sales_phasing: { tranches: [{ month_offset: 23, pct_of_gross_receipts: 100, anchor: null }] } };
  const { onChange } = setup(inputs);
  fireEvent.click(screen.getByRole('button', { name: /use per-unit ledger/i }));
  expect(onChange).toHaveBeenCalledWith({ unit_sales: seedUnitSales(['u1', 'u2', 'u3', 'u4'], 24), sales_phasing: null });
});
it('phasing the sales nulls unit_sales in the same payload', () => {
  const { onChange } = setup(unitSalesDoc());
  fireEvent.click(screen.getByRole('button', { name: /phase the sales/i }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ unit_sales: null, sales_phasing: expect.anything() }));
});
it('switching to retain_all nulls unit_sales', () => {
  const { onChange } = setup(unitSalesDoc());
  fireEvent.click(screen.getByRole('radio', { name: /retain all/i })); // locate the route control the existing route tests use
  expect(onChange.mock.calls[0][0]).toEqual(expect.objectContaining({ unit_sales: null, sales_phasing: null }));
});
it('retaining a unit under blended drops its sale row', () => {
  const { onChange } = setup(unitSalesDoc({ route: 'blended' }));
  fireEvent.click(screen.getByLabelText(/retain u2/i)); // the existing per-unit retain control; locate by content
  const partial = onChange.mock.calls[0][0] as { unit_sales: UnitSalesInputs };
  expect(partial.unit_sales.units.map((u) => u.unit_id)).toEqual(['u1', 'u3', 'u4']);
});
```

(The route and retain controls' accessible names must be read off the existing `ExitStrategyPage.test.tsx` cases that already click them — copy those queries.)

(`setup` currently types `inputs: CalculatorInputsV9` — widen it to `ExitCarrier`.)

- [ ] **Step 2: Run** → FAIL (module missing / buttons absent).

- [ ] **Step 3: Implement `UnitSalesEditor.tsx`.** Follow `OperatingScheduleEditor`'s constants and table markup. Columns: `Unit`, `Gross`, `Exchange`, `Completion`, `Deposit %`, `Agent %`, `Legal £`, `Net`. Per row: unit label `${UNIT_TYPE_LABEL[type] ?? type} ${id}`; gross/net read from `result?.units.find(u => u.unit_id === id)` (print `—` when absent); Exchange cell = a `Fixed | Simultaneous` toggle (simultaneous ⇒ `exchange: null`, and the editor also writes `deposit_pct: 0` in the same emit so rule 6 cannot trip) plus `NumRow`-style month input and an `ExitAnchorControl` when fixed; Completion cell = month input + `ExitAnchorControl`; under each event a muted `resolves to month N` read from the result row (`exchange_month`/`completion_month`); `Deposit %` a number input (`aria-label={\`${id} deposit %\`}`); `Agent %` a nullable number input with placeholder `schemeAgentPct` (`aria-label={\`${id} agent %\`}`); `Legal £` a `PenceInput` `nullable` with placeholder `schemeLegalPence` (`aria-label={\`${id} legal £\`}`); a totals row (gross/deposits released/agent/legal/net from `result.totals`); above the table a `deposit_release` select (`aria-label="Deposit release"`, options `Held to completion` / `Released on exchange`) and a caption `Pre-sold {pct}% at month {reference_month} ({basis === 'practical_completion' ? 'practical completion' : 'first completion'})` from `result.pre_sold` (print `n/a` when `pct` is null). All `onChange` calls emit the full `UnitSalesInputs`. Export `seedUnitSales`, `reconcileUnitSalesRows` from the same file.

- [ ] **Step 4: Wire `ExitStrategyPage.tsx`.** `type ExitCarrier = CalculatorInputsV9 | CalculatorInputsV10 | CalculatorInputsV11 | CalculatorInputsV12;` + `hasUnitSales`. Compute `const usCarrier = hasUnitSales(inputs); const unitSales = usCarrier ? inputs.unit_sales : null; const soldIds = exit.route === 'retain_all' ? [] : inputs.unit_mix.units.filter((u) => exit.route === 'sell_all' || !retainedIds.has(u.id)).map((u) => u.id);`. Handlers: `toggleUnitSales = () => onChange((unitSales ? { unit_sales: null } : { unit_sales: seedUnitSales(soldIds, term), sales_phasing: null }) as Partial<T>)`; `togglePhasing` additionally writes `unit_sales: null` when enabling phasing on a carrier; `selectRoute('retain_all')` adds `partial.unit_sales = null` when `usCarrier`; the retained-units handler, when `unitSales != null`, includes `unit_sales: reconcileUnitSalesRows(unitSales, <new sold ids>, term)` in its payload. Render, inside the sales section when `usCarrier && exit.route !== 'retain_all'`: a `Use per-unit ledger` / `Disable per-unit ledger` button beside `Phase the sales` (the phasing button is disabled while `unitSales != null` and vice versa — but the click handlers still write the exclusive null, belt and braces), and `<UnitSalesEditor … result={run.schedule.unit_sales} …/>` when `unitSales != null`.

- [ ] **Step 5: Run** both test files, `npx tsc -b`, lint (`--max-warnings 0`), then `npm test` → PASS.

- [ ] **Step 6: Commit.** `git commit -m "feat(r13b): UnitSalesEditor on the Exit page, exclusive with phasing, rows reconciled to the sold set (spec 22.6)"`

---

### Task 12: Cashflow page — the "Deposits released" column

**Files:**
- Modify: `frontend/src/components/calculator/CashflowPage.tsx` (header L133–136, body L156–160, footer L183), `CashflowPage.test.tsx`

- [ ] **Step 1: Failing test:**

```ts
it('shows a deposits-released column only when a released deposit lands, read off metrics.unit_sales', () => {
  const doc = unitSalesDoc();
  render(<CashflowPage inputs={doc} onChange={vi.fn()} run={runAppraisal(doc)} />);
  expect(screen.getByRole('columnheader', { name: 'Deposits released' })).toBeInTheDocument();
  expect(screen.getAllByText('£26,000.00').length).toBeGreaterThan(0); // month 8's 2,600,000p
});
it('hides the column on the held twin and on the null path', () => {
  for (const doc of [heldTwinDoc(), unitSalesDoc({ unitSales: null })]) {
    const { unmount } = render(<CashflowPage inputs={doc} onChange={vi.fn()} run={runAppraisal(doc)} />);
    expect(screen.queryByRole('columnheader', { name: 'Deposits released' })).toBeNull();
    unmount();
  }
});
```

(check `penceToPounds`'s exact format against an existing assertion in the file before fixing the string).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** `const unitSales = run.metrics.unit_sales; const hasDeposits = unitSales != null && unitSales.months.some((m) => m.deposits_received_pence !== 0); const depositsTotal = unitSales?.totals.deposits_released_pence ?? 0;` Add `...(hasDeposits ? ['Deposits released'] : [])` after `'Receipts (net)'` in the header array, the matching `<td>` (`penceToPounds(unitSales!.months[m.month].deposits_received_pence)`) in the body, and `penceToPounds(depositsTotal)` in the footer. Also extend the assumptions note (L69 area) with a third arm: when `unitSales != null` → `; per-unit sales: ${n} units completing in ${months…}` using `unitSales.units.map((u) => label(u.completion_month))` — resolved months, never `month_offset`.

- [ ] **Step 4: Run** the file + `npm test` → PASS. **Step 5: Commit.** `git commit -m "feat(r13b): cashflow page prints released deposits and the per-unit disposal months (spec 22.6)"`

---

### Task 13: The memo — exit paragraph arm, the "Unit Sales Ledger" section, the release gate

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts` (locals L428–439; exit paragraph L1373–1391; insert the section between L2677 and L2679, i.e. after the investment-case `if` closes and before `subHeading(y, 'Contingent Exit')`)
- Modify: `frontend/src/lib/export-investment-memo.test.ts`, `frontend/src/lib/report-qa/memo-fixtures.ts` (add `unitSalesLedgerInputs()`), `memo-release-gate.test.ts`

- [ ] **Step 1: Failing tests.** `export-investment-memo.test.ts`, a `describe('§22.6 unit sales ledger')`:

```ts
it('prints the ledger table, the coverage sentence and the §13.4 released-deposit sentence', async () => {
  const t = await memoText(unitSalesDoc());
  expect(t).toContain('Unit Sales Ledger');
  expect(t).toContain('Pre-sold 81.48%');
  expect(t).toContain('modelling assumption about the sale contract');
  expect(t).toContain('Per-unit sales: 4 units');
});
it('omits the section and the released-deposit sentence entirely on the null path and on the held twin', async () => {
  expect(await memoText(unitSalesDoc({ unitSales: null }))).not.toContain('Unit Sales Ledger');
  const held = await memoText(heldTwinDoc());
  expect(held).toContain('Unit Sales Ledger');
  expect(held).not.toContain('modelling assumption about the sale contract');
});
it('prints every figure verbatim off metrics.unit_sales, never recomputing', async () => {
  // Tamper the result block after the run and assert the tampered figure is printed
  // (the §19.6 pattern at L2130-2166 of this file): set units[0].net_pence to 12345678
  // and pre_sold.pct to 55.55, render, expect '£123,456.78' and 'Pre-sold 55.55%'.
});
```

`memo-release-gate.test.ts`: inside the `describe.each(ROUTES)` loop add the negative control `it('never prints the unit sales ledger section', …)` asserting `run.metrics.unit_sales` is null and `documentText(info)` lacks `'Unit Sales Ledger'`; and a positive `describe('R13b unit sales ledger section (spec §22.6/§13.4)')` using `unitSalesLedgerInputs()` (fixture-file-backed, NOT added to `ROUTES`, the `monitoringOnSiteInputs` precedent) asserting the heading, `fmtGBP(run.metrics.unit_sales!.totals.net_pence)` (`£923,450.00`), `overflowingItems`/`sparsePages`/`orphanHeadings` all empty.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Locals: `const unitSales = metrics.unit_sales;`. Exit paragraph: a three-arm ternary — `unitSales != null ? \`Per-unit sales: ${unitSales.units.length} units completing ${…resolved completion months via monthLabel, deduplicated and sorted…}; pre-sold ${fmtPctSafe(unitSales.pre_sold.pct)} at ${monthLabel(unitSales.pre_sold.reference_month)} (${basis label}).\` : salesPhasing != null ? …existing… : …existing…`. The section (template: the R14 monitoring block L1892–1989):

```ts
  if (unitSales != null) {
    y = subHeading(y, 'Unit Sales Ledger');
    const basisLabel = unitSales.pre_sold.basis === 'practical_completion' ? 'practical completion' : 'first completion';
    y = bodyText(y, `Pre-sold ${fmtPctSafe(unitSales.pre_sold.pct)} of the sold portion (${fmt(unitSales.pre_sold.exchanged_value_pence)} of ${fmt(unitSales.totals.gross_pence)}) exchanged by ${monthLabel(unitSales.pre_sold.reference_month)}, measured at ${basisLabel} (spec §22.4). Deposits are ${unitSales.deposit_release === 'released_on_exchange' ? 'released to the developer at exchange' : 'held to completion'}.`);
    if (unitSales.deposit_release === 'released_on_exchange') {
      y = bodyText(y, 'A deposit shown as released is a modelling assumption about the sale contract that this model does not evidence (spec §13.4).');
    }
    const rows = unitSales.units.map((u) => [
      u.unit_id, fmt(u.gross_pence),
      u.exchange_month == null ? 'at completion' : monthLabel(u.exchange_month),
      monthLabel(u.completion_month),
      fmt(u.deposit_pence), fmt(u.agent_fee_pence), fmt(u.legal_fee_pence), fmt(u.net_pence),
    ]);
    rows.push(['Total', fmt(unitSales.totals.gross_pence), '', '', fmt(unitSales.totals.deposits_pence),
      fmt(unitSales.totals.agent_fees_pence), fmt(unitSales.totals.legal_fees_pence), fmt(unitSales.totals.net_pence)]);
    table({
      startY: y, margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['Unit', 'Gross', 'Exchange', 'Completion', 'Deposit', 'Agent', 'Legal', 'Net']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      bodyStyles: { textColor: [51, 65, 85] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: { 1: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
      didParseCell(data) { if (data.column.index === 0 && data.cell.raw === 'Total') data.cell.styles.fontStyle = 'bold'; },
    });
    y = lastAutoTableFinalY(doc) + 6;
  }
```

`memo-fixtures.ts`: `export function unitSalesLedgerInputs(): CalculatorInputsV12 { … 'x-unit-sales-ledger.json' … migrateInputsToV12(raw.inputs) }` with the "NOT added to ROUTES" note. (`memo-fixtures.ts` is already exempt from the entry-point guard.)

- [ ] **Step 4: Run** the three test files (the release gate is slow — allow it) → PASS. Then `npm test`.

- [ ] **Step 5: Commit.** `git commit -m "feat(r13b): memo prints the unit sales ledger, coverage and the 13.4 deposit sentence; release gate (spec 22.6, 13.4)"`

---

### Task 14: Specification §22, the amendments, and the governance documents

**Files:**
- Modify: `docs/financial-model/calculation-specification.md` — changelog (L8, insert two bullets), §3.7 (L141–148), §4.4 (after the R1 timing bullet L310), §5.11 (L466–500), §5.12 (L501–503), §12.1 table + composition paragraph (L621–670), §12.6 (L735–753), §13.4 (L1076–1104), §19.10 limitation 1 (L2703), append §22 after L3356
- Modify: `docs/financial-model/migration-notes.md` (append §15 after §14.2, template L968–1060), `model-governance.md` §3.1 (after the R14b row L217), `test-cases.md` (§22 exists from Task 7; add S's note if Task 9 did not), `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` (R13b row L20 → DONE wording; R15 row `inputs v12` → `inputs v13`; add the R16 note), the design doc (§9 and §16: withdraw the Excel sheet, citing correction 1)

- [ ] **Step 1: Changelog.** At the top of the `**Changelog:**` list insert:

```
- **2.14.0** — the unit-level sales ledger (§22, R13b): per-unit exchange/completion timing, deposits held or released, per-unit selling-cost overrides, pre-sales coverage, the `sales_slip` lever (§12.1's ninth). **One pre-existing computed value moves: §5.11's phased break-even now replays anchored tranches at their resolved months** (fixture S: 90,971,520 → 88,720,089); every unanchored document is unchanged. §5.12 gains the per-unit cost basis. Inputs v12.
- **2.13.0** — cost-to-complete corrected (§5.10, C1), `lender_eligible` wired into §4.2(b), the monitoring statement (§20, R14). Inputs v11. [Bullet added by R13b; R14 recorded this release in §1.6 and §20 but omitted the changelog line.]
```

- [ ] **Step 2: §3.7** — append a bullet: `- **Per-unit regime [R13b — calc 2.14.0]:** when \`unit_sales\` is non-null each sold unit's agent fee is \`round(gross_u × (agent_fee_pct ?? selling_agent_fee_pct)/100)\` and its legal fee is its own \`legal_fee_pence\` or its pro-rata share of \`selling_legal_fee_pence\` (§22.2); \`selling_costs_pence\` is the **sum of the units**, which can differ from the formula above by rounding. The two regimes are distinct, not one formula with a special case.`

- [ ] **Step 3: §4.4** — after the `sales_phasing` timing bullet add: `- Per-unit regime [R13b — calc 2.14.0]: when \`unit_sales\` is non-null (mutually exclusive with \`sales_phasing\`, §22.7 rule 1) each unit's receipt lands in its own resolved completion month, and a released deposit lands in its exchange month — §22.3.`

- [ ] **Step 4: §5.11** — replace the sentence `Phased regime [R3b — calc 2.3.0]: when \`sales_phasing\` is non-null, the break-even is …` so it opens `Phased regime [R3b — calc 2.3.0; corrected R13b — calc 2.14.0]: when \`sales_phasing\` or \`unit_sales\` is non-null, …`, and append two paragraphs:

```
**Resolved months [R13b correction].** The replay places each tranche at the month the ledger used — §18.6's resolved month, read off the schedule's `resolved_exit_months` — not the entered `month_offset`. From calc 2.3.0 to 2.13.0 the replay read the raw offset, so an anchored tranche on a slipped programme replayed receipts at a month the ledger never used (fixture S, whose tranches resolve to 16/19 while their offsets read 20/21: 90,971,520 → 88,720,089). The structural-unsolvable test ("draws continue after the final tranche") reads the same resolved months, so it can now fire — correctly — for a document whose anchored disposal precedes its last draw.

**The receipt-lines arm [R13b — calc 2.14.0].** Under `unit_sales` the replay's receipts are a list of dated lines `{ month, base_gross, agent_fee_pct, legal_fee_pence }` — one per released deposit (no costs) and one per completion (gross less the released deposit, the unit's effective agent rate, its fixed legal) — sorted by month then unit order. At trial total G every line's gross is `round(base_gross × G / G_base)` with the last line absorbing the residue; agent fees scale with the line's gross; legal fees are fixed; the enforcement-cost assumption comes off the first line. The uniform price-fall assumption is unchanged — deposits scale with price because they are a percentage of it. The fee reservation, the VAT-reclaim ordering and the bisection are untouched.
```

- [ ] **Step 5: §5.12** — append: `Per-unit regime [R13b — calc 2.14.0]: the re-solved selling costs use the ledger's **effective blended agent rate** \`Σ agent_u / G × 100\` and the **summed** legal \`Σ legal_u\`, so the cost reproduces the ledger's own at \`P = G\` and scales the agent component with price as the ledger would.`

- [ ] **Step 6: §12.1** — table gains `| \`sales_slip\` [R13b — calc 2.14.0] | months (signed) | adds to every \`unit_sales.units[].completion\` — \`anchor.offset_months\` when anchored, else \`month_offset\` (§22.8) |`; "There are eight" → "There are nine"; "The eight levers write to disjoint" → "nine"; add the composition paragraph: `**\`sales_slip\`'s composition order, stated at the time it is added.** It writes \`unit_sales.units[].completion\` and nothing else; no other lever touches it, so all nine remain disjoint and application remains order-independent — asserted by the several-orders test gaining an entry, and by a second such test on a document that actually carries a ledger. It carries no target, so its duplicate checks key on \`lever\` alone. On \`unit_sales = null\` it is a no-op by construction: a zero-width tornado bar.` §12.6: "one of the five §12.1 levers" → "one of the nine §12.1 levers"; add `- **[R13b — calc 2.14.0]** a step, or a tornado bound, for the \`sales_slip\` lever that is not a whole number of months.` and extend the closing sentence to `the \`timeline\`, \`phase_slip\` and \`sales_slip\` levers`.

- [ ] **Step 7: §13.4** — add the bullet: `- **Released deposits [R13b — calc 2.14.0].** A deposit the ledger shows as released at exchange is a modelling assumption about the sale contract that the model does not evidence; the memo prints that sentence beside the coverage figure whenever \`deposit_release\` is \`released_on_exchange\` (§22.6).`

- [ ] **Step 8: §19.10 limitation 1** → `1. ~~No unit-level sale timing or per-unit selling costs, and no deposits~~ — **closed by R13b (§22)**; kept as history.`

- [ ] **Step 9: §22.** Append after the file's last line:

```
## 22. The unit-level sales ledger [R13b — calc 2.14.0]

The other half of audit §7.8, deferred by R13 (§19.10 limitation 1). Until this release the sold portion was one total split by tranche percentages under one scheme-level agent rate and one flat legal fee (§4.4.1); nothing recorded which unit completed when, an exchange as distinct from a completion, or a deposit. §22 adds a per-unit path, mutually exclusive with the tranche path, that writes into the same receipt fields.

### 22.1 The schema

`inputs_version: 12`. `unit_sales` is a two-state top-level field beside `investment_case` and `monitoring`:

```
unit_sales: null | {
  deposit_release: 'held_to_completion' | 'released_on_exchange'
  units: UnitSale[]
}

UnitSale:
  unit_id:         string            -- names a unit_mix.units[].id
  exchange:        SaleEvent | null  -- null = exchange and completion are simultaneous
  completion:      SaleEvent
  deposit_pct:     number            -- 0..100, of the unit's gross (value + ancillary, §15.5)
  agent_fee_pct:   number | null     -- null = scheme selling_agent_fee_pct
  legal_fee_pence: integer | null    -- null = share of scheme selling_legal_fee_pence

SaleEvent:
  month_offset: integer
  anchor:       PhaseAnchor | null   -- §18.6's rule, §18.6's resolver
```

`null` is the migration default and means the document does not use this path. A unit's gross is `estimated_value_pence` plus its ancillary value — the figure `gross_sales` already sums — so `gdv_pence` and `gross_sales_pence` stay equal by construction and the `gdv` lever reaches every row. `ScenarioOverrides` gains `sales_slip_months: integer` (§22.8).

### 22.2 The per-unit derivation

For each row *u* over the sold set (by route and `retained_units`), in `units[]` order:

```
gross_u      = estimated_value_pence + ancillary value
deposit_u    = round_half_up(gross_u × deposit_pct / 100)
agent_u      = round_half_up(gross_u × (agent_fee_pct ?? selling_agent_fee_pct) / 100)
legal_u      = legal_fee_pence                                        if non-null
             = round_half_up(selling_legal_fee_pence × gross_u / Σ gross over null-legal rows);
               the LAST null-legal row in units[] order absorbs the residue
net_u        = gross_u − agent_u − legal_u
completion_m = resolve(completion); exchange_m = resolve(exchange), or completion_m when exchange is null
```

`resolve` is §18.6's single resolver. Totals are the sums of the rows: `selling_costs_pence = Σ (agent_u + legal_u)` (§3.7's per-unit bullet). When every row's `legal_fee_pence` is non-null the scheme flat fee is unused — by this rule, not silently. The resolved months are published on the result block (§22.6); no surface prints an entered offset.

### 22.3 The ledger

No new receipt class. Each row accumulates into the existing `MonthReceipts` fields:

| `deposit_release` | exchange month | completion month |
|---|---|---|
| `held_to_completion` | nothing | `gross += gross_u`; `agent += agent_u`; `legal += legal_u` |
| `released_on_exchange` | `gross += deposit_u` | `gross += gross_u − deposit_u`; costs as above |

Σ gross over months = G exactly on both settings, so §3.1, §4.4's sweep arms, the declining redemption schedule (a released-deposit month is a disposal month in it), §5.10 and §7 are unchanged. A released deposit sweeps under §4.4 like any receipt. Selling costs book in the completion month (§3.7). §19.5's within-month order is unchanged: VAT reclaim → NOI → sales sweep → refinance. `redemption_balance_at_disposal_pence` remains the balance before receipts in the final disposal month — the last completion.

### 22.4 Pre-sales coverage

```
reference_month = earliest start among programme phases with code 'practical_completion',
                  when programme is a network with at least one    (basis 'practical_completion')
                = min over rows of completion_m                    (basis 'first_completion')
exchanged_value_at_ref = Σ gross_u over rows with exchange_m <= reference_month
pre_sold_pct = pct(exchanged_value_at_ref, G)
```

plus a per-month cumulative series of exchanged value, completed value and released deposits received. Earliest PC is the conservative choice. It is a figure, not a covenant test; no flag.

### 22.5 The break-even seam

§5.11's replay gains the receipt-lines arm and the tranche arm is handed resolved months; §5.12 uses the effective blended rate and summed legal. All three are stated in those sections.

### 22.6 Outputs and reporting

`Schedule` gains `unit_sales`, republished (never recomputed) onto `AppraisalResultV2`; `null` exactly when the input is null:

```
UnitSalesResult:
  deposit_release
  units:  Array<{ unit_id, gross_pence, exchange_month: integer | null, completion_month,
                  deposit_pence, deposit_released_pence, agent_fee_pence, legal_fee_pence, net_pence }>
  months: Array<{ month, exchanged_value_pence, completed_value_pence, deposits_received_pence }>   -- first two cumulative
  totals: { gross_pence, deposits_pence, deposits_released_pence, agent_fees_pence, legal_fees_pence, net_pence }
  pre_sold: { reference_month, basis, exchanged_value_pence, pct }
```

`resolved_exit_months.tranches` is `[]` on this path. Surfaces: the Exit page's per-unit editor (exclusive with phasing in the same payload; rows reconciled to the sold set), the cashflow page's released-deposits column and disposal-month note, the memo's exit paragraph arm and "Unit Sales Ledger" section with the §13.4 sentence. The section is omitted entirely when null (§13.5).

### 22.7 Validation

Input errors, not flags; applying only when `unit_sales` is non-null unless stated:

1. `unit_sales` and `sales_phasing` both non-null — an error on **both** fields. *Applies regardless.*
2. `route = 'retain_all'` with a non-null block — nothing is sold.
3. Every sold unit has exactly one row and every row names a sold unit: a missing sold unit, a row for a retained unit, a row for an absent unit, and a duplicate `unit_id` are four distinct messages.
4. Each event: `month_offset` a whole month in `[0, term − 1]`; an anchor names an existing phase and requires a network `programme`; the **resolved** month lies in `[0, term − 1]`.
5. Resolved `exchange_m <= completion_m` where `exchange` is non-null.
6. `deposit_pct` finite in `[0, 100]`, and `0` when `exchange` is null.
7. `agent_fee_pct` null or finite in `[0, 100)`; `legal_fee_pence` null or an integer `>= 0`.
8. `deposit_release` in the enum.
9. Sold gross `> 0`.

`scenarios.*.sales_slip_months` must be a whole number. No new flags.

### 22.8 Sensitivity: the `sales_slip` lever

§12.1's ninth lever adds signed months to every row's completion — `anchor.offset_months` when anchored, else `month_offset` — **completion only**, additively, through `applyScenario`. A slip that drives a completion before its exchange, or outside the term, makes the position an invalid cell (§12.7), never a clamp. On `unit_sales = null` it is a zero-width bar. The lever is offered only when the document carries a ledger, as `phase_slip` is only offered with a network.

### 22.9 Migration and the persistence boundary

```
v11 unit_sales: (absent)                         →  v12 null
v11 scenarios.<each>.sales_slip_months: (absent) →  v12 0
```

Both inert by construction. The numeric identity gate runs the same code over each v11 document and its migrated twin, corpus-wide in both engines, and requires equality; the validation gate is §19.9's three separately falsifiable properties (property 3's control: both blocks non-null trips rule 1). The separate claim — calc 2.14.0 reproduces 2.13.0 on every `unit_sales = null` document — carries one named exception, fixture S's `senior_breakeven_pence` (§5.11's correction), evidenced by every pre-existing golden pin standing while S gains a pin whose pre-fix value is recorded beside it.

### 22.10 Stated limitations

1. Uniform price fall in the break-even; no per-unit price stress.
2. A unit's price is its `unit_mix` value — no incentives, discounts, part-exchange or bulk pricing.
3. One deposit per unit, at exchange; no staged deposits, deposit interest or stakeholder-release conditions; the release switch is scheme-level.
4. Coverage is a figure, not a test.
5. The coverage reference month is the earliest PC; a phased block release is measured at its first PC.
6. Exchange dates are stressed by no lever.
7. Rows carry no evidence status (R15, on §14.6/§15.9/§16.9/§19.10's reasoning).
8. The two sales paths remain two; there is no conversion between them.
9. No appraisal workbook exists (spec §11.9); the ledger is printed in the memo and on the pages only.

### Guards this release must watch fail

| Guard | Watched by |
|---|---|
| Deposit liveness | released vs held twin: the exchange month's receipt, absolute finance costs and the redemption months differ; `gdv_pence`, `gross_sales_pence`, `selling_costs_pence` identical |
| Sum-of-units costs, residue absorption | the hand table (201,550 / 135,659 / 162,791; 33/33/34) |
| Exclusion, coverage both ways, resolved window, exchange <= completion | §22.7's rule tests, each with an accepting twin |
| Pre-sold basis switch | the same rows with and without a PC milestone: 12/`practical_completion`/81.48 vs 12/`first_completion`/81.48 vs 9/`practical_completion`/27.51 |
| Receipt-lines arm | two-line hand figures at half price; released < held; two equal lines reproduce the two-tranche minimum |
| §5.11 correction | S off 90,971,520 to 88,720,089; the strip_out/building_control unsolvable pair — both failed on the pre-fix code |
| Tranche-arm identity | G, I, J, L pins unchanged |
| Lever | nine levers order-independent on a ledger document; zero-width bar on null; −5 and +4 invalid cells |
| Memo | present with the pinned rows, absent when null; figures follow a tampered result block |
| Entry points | both guards require v12 |
```

- [ ] **Step 10: The governance documents.** `migration-notes.md` §15 — copy §14's structure with the v12 substitutions: the two written additions; implementation names; §15.1 the identity claim (gate `tests/test_migrate_v12.py` and the vitest twin; `x-unit-sales-ledger` the one deliberately excluded document; the three properties); the paragraph "The §5.11 correction is the one computed value that moves, and it is not a migration effect"; §15.2 The York appraisal after R13b (unchanged: no ledger). `model-governance.md` §3.1 add `| R13b | 2.14.0 | v12 | — | The unit-level sales ledger: per-unit timing, deposits, cost overrides, pre-sales coverage, \`sales_slip\`; §5.11 replays anchored tranches at resolved months | §22 |`. Release plan: R13b row → `| **R13b** — **DONE, shipped** | … | P1 | inputs v12, calc 2.14.0 |`; R15 row `inputs v12 (v11 is R14's)` → `inputs v13 (v12 is R13b's)`; under the table add: `**R16 UX debt recorded by R13b:** the R12/R13 override fields (\`phase_slip_*\`, \`exit_yield_adjustment_pct\`, \`operating_cost_adjustment_pct\`, \`vacancy_adjustment_pct\`) have no ScenariosPage input; \`sales_slip_months\` got one in R13b.` (The design doc's Excel withdrawal and ninth limitation were applied when this plan was written — verify they are present; do not re-edit.)

- [ ] **Step 11: Run** `npx vitest run src/lib/model/spec-versions.test.ts` (spec contains `2.14.0` and §1.6 names `v12`) → PASS. Read the diff of every touched doc once for a stale "eight levers" / "five levers" / "2.13.0 is current" claim.

- [ ] **Step 12: Commit.** `git commit -m "docs(r13b): spec 22 and amendments (3.7, 4.4, 5.11, 5.12, 12.1, 12.6, 13.4, 19.10), migration notes 15, governance row, release plan"`

---

### Task 15: The entry-point cutover to v12

**Files:**
- Modify: `app/api/app.py:24,486`, `app/models.py:350-380` (comment)
- Modify: `frontend/src/lib/conversion-defaults.ts` (append `defaultCalculatorInputsV12`), `frontend/src/lib/conversion-defaults.test.ts` (a `defaultCalculatorInputsV12` describe pinning default-vs-migration equality, copying the V11 block at L361)
- Modify: `frontend/src/components/ConversionCalculator.tsx:3,6,104-106,115,176,273` (`CalculatorInputsV11` state type → `CalculatorInputsV12`, both helpers → V12), `frontend/src/components/ExportPage.tsx:9,104,136`
- Modify: `tests/test_entry_point_guard.py` (`assert NEWEST == 12`, `assert 11 in VERSIONS`; the two live-server tests: v11 → v12 with `unit_sales is None`, and a native-v12 round trip posting `x-unit-sales-ledger.json` asserting `unit_sales is not None` and `inputs_version == 12`), `frontend/src/lib/model/entry-point-guard.test.ts` (`toBe(12)`, `toContain(11)`)

- [ ] **Step 1: Failing guards first.** Edit both guard tests to require 12 and run them → FAIL (production still names v11). Record the failure.

- [ ] **Step 2: Implement.** `conversion-defaults.ts`:

```ts
/**
 * R13b Task 15 (spec §22.1, the entry-point cutover): the client's persistence
 * boundary moves on again. `unit_sales: null` and `sales_slip_months: 0` (already
 * in DEFAULT_SCENARIOS since Task 1) are the only additions. Spelled out rather
 * than calling `migrateV11toV12` for the cycle reason `defaultCalculatorInputsV11` gives;
 * `conversion-defaults.test.ts` pins the two against each other field for field.
 */
export function defaultCalculatorInputsV12(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV12 {
  return { ...defaultCalculatorInputsV11(project), inputs_version: 12, unit_sales: null };
}
```

Move every production call site listed in Files to `migrateInputsToV12` / `defaultCalculatorInputsV12` / `migrate_inputs_to_v12` in ONE commit. `app.py`'s `"inputs_version": inputs.inputs_version` is derived — confirm it now prints 12 without edit. Update the `app/models.py` comment to name v12, `unit_sales`, `UnitSalesInputs` / `CalculatorInputsV12`.

- [ ] **Step 3: Full gates, both engines**, run BY YOU and reported with counts: `python -m pytest -q` (all green), and from `frontend/`: `npx tsc -b`, `npm run lint -- --max-warnings 0`, `npm test`, `npm run build`. Then the live-server probe: save fixture X through the API and read it back — `inputs_version 12`, `unit_sales` present, status not `legacy_unreconciled`.

- [ ] **Step 4: Commit.** `git commit -m "feat(r13b): move every entry point to inputs v12 (spec 22.9)"`

---

## Whole-branch review brief (for the controller, after Task 15)

Beyond per-task review, check the seams: (1) every surface that prints a sale month reads a resolved month off a result block — grep `month_offset` in `frontend/src/components` and the memo; (2) `selling_costs_pence` on the per-unit path is the sum of units in BOTH engines and in the fixture pin; (3) the tranche arm's `None` cases are unchanged (G, I, J, L); (4) `AppraisalResultV2` has no construction site missing `unit_sales`; (5) the memo prints nothing for a `held_to_completion` document that claims a release; (6) the design's §14 fixture-X table (u4 "the last month") matches the shipped fixture (month 20 — chosen so `sales_slip +3` stays valid and `+4` does not); fix the design if it drifted. Then re-run both full suites on the merged result before pushing.

