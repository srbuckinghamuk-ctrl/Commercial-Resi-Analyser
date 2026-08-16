# Release 4a — Sensitivity Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the fixed-facility sensitivity suite a specified, dual-implemented, fixture-pinned engine surface, so the two-way matrices and a new tornado stop living as hardcoded logic inside the PDF exporter.

**Architecture:** A new pair of mirrored modules (`frontend/src/lib/model/sensitivity.ts` ↔ `app/financial_model/sensitivity.py`) composes the existing `runAppraisal` over a grid of lever adjustments. Nothing about the appraisal engine itself changes — each cell is one ordinary appraisal run against adjusted inputs, with the committed facility and equity held at base. The lever-application rule (`applyScenario`) is promoted into the model directory and mirrored into Python so both engines share one specified definition of what "GDV −10%" means.

**Tech Stack:** TypeScript + vitest (frontend engine), Python 3.11 + pytest (authoritative engine), shared JSON golden fixtures in `fixtures/financial-model/`.

## Global Constraints

- **Spec source of truth:** `docs/financial-model/calculation-specification.md`. Governance: `docs/financial-model/model-governance.md`. Design: `docs/superpowers/specs/2026-08-16-release-4-design.md`.
- **Formula-change order (governance §2), non-negotiable:** edit the spec first, then the fixture with a recorded hand derivation, then both engines in the same change. Never one language ahead of the other.
- **Money is integer pence.** Percentages are floats where `70.0` means 70%. Rounding is round-half-up (spec §1.1).
- **`tsc --noEmit` is inert in this repo** — `tsconfig.json` has `"files": []` with project references. Only `tsc -b` checks anything. Never substitute `--noEmit`.
- **Gates for the branch:** `npm test` (vitest), `pytest`, `npx tsc -b`, `npx eslint .`, `npm run build`. Frontend commands run from `frontend/`; pytest runs from the repo root.
- **No Tailwind classNames.** The codebase styles exclusively with inline styles. (R4a touches no UI, but the rule holds if you touch a component.)
- **Calc version target is `2.4.0`.** It is bumped in the final task only, so no mid-branch commit mislabels itself.
- **Import-cycle rule:** `sensitivity.ts` imports `runAppraisal` from `./index`, and `index.ts` must **not** import or re-export `sensitivity`. Likewise `sensitivity.py` imports `run_appraisal` from `app.financial_model`, and `app/financial_model/__init__.py` must **not** import `sensitivity`. Consumers import the sensitivity module by its own path. Breaking this creates a module cycle in both languages.
- **Commit style:** conventional-commit subject, body explaining *why*, and the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Created:**
- `frontend/src/lib/model/sensitivity.ts` — the TS suite: config types, config validation, `runSensitivity`.
- `frontend/src/lib/model/sensitivity.test.ts` — unit tests for the above.
- `app/financial_model/sensitivity.py` — the Python mirror, file-for-file.
- `tests/test_financial_model_sensitivity.py` — the Python mirror's tests.
- `app/financial_model/apply_scenario.py` — Python mirror of the lever rule.
- `tests/test_financial_model_apply_scenario.py` — its tests.
- `fixtures/financial-model/k-sensitivity.json` — Fixture K.

**Moved:**
- `frontend/src/lib/apply-scenario.ts` → `frontend/src/lib/model/apply-scenario.ts` (and its test alongside). It becomes a specified operation in §12, and governance §1 requires the Python mirror to sit file-for-file against a module inside `model/`.

**Modified:**
- `docs/financial-model/calculation-specification.md` — new §12, §11.8 cross-reference, version header.
- `docs/financial-model/model-governance.md` — record the Fixture K derivation exception.
- `docs/financial-model/test-cases.md` — Fixture K hand derivations.
- `frontend/src/lib/model/invariants.test.ts` + `tests/test_financial_model_fixtures.py` — new §12 invariants and the Fixture K harness.
- `frontend/src/lib/model/golden-fixtures.test.ts` — teach the corpus scan about the `sensitivity` fixture kind.
- `frontend/src/lib/model/finance-types.ts` + `app/financial_model/types.py` — `CALC_VERSION`.
- Five `applyScenario` import sites (Task 2).

---

## Task 1: Specification §12

**Files:**
- Modify: `docs/financial-model/calculation-specification.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the normative text every later task implements. Later tasks cite §12.1–§12.5 by number.

- [ ] **Step 1: Read the surrounding spec so §12 matches its register**

Read `docs/financial-model/calculation-specification.md` §6.1 (dated programme) and §11 (prohibited calculations). §6.1 is the closest model for how a new numbered section is written here: normative closed forms, explicit rounding, explicit validation. Match that voice. Do not write in the first person and do not describe implementation.

- [ ] **Step 2: Append §12 to the specification**

Insert after §11 (§11 is currently the last section). Write exactly this content, adapting only the surrounding markdown heading style to match the file:

```markdown
## 12. Sensitivity analysis [R4 — calc 2.4.0]

This section is the normative home for both the fixed-facility sensitivity suite and
the three named scenarios (`base`, `upside`, `downside`), which share its lever rule.

### 12.1 Levers

A **lever** is one named adjustment applied to an inputs document. There are four:

| Lever | Unit | Effect on the inputs document |
|---|---|---|
| `gdv` | percent | scales every `unit_mix.units[].estimated_value_pence` |
| `construction_cost` | percent | scales `conversion_costs.construction_cost_per_sqm_pence` |
| `timeline` | months | adds to `finance.term_months` |
| `interest_rate` | percentage points | adds to `finance.annual_interest_rate_pct` |

A percent lever of `p` multiplies its target by `(1 + p/100)` and rounds half-up to
integer pence (§1.1). A months or percentage-point lever adds its value directly.

The four levers write to **disjoint input fields**, so applying several to one document
is order-independent. Any lever added in a later release that shares a field with an
existing lever must define its composition order in this section at the same time.

### 12.2 The facility is invariant

In every sensitivity cell and every tornado endpoint,
`finance.committed_net_facility_pence`, `finance.committed_gross_facility_pence`,
`finance.day_one_advance_pence` and `equity_sources` are held at their base-document
values. No lever may write to them, directly or indirectly.

This is §11.8 ("debt re-sized inside scenario/downside calculations" — prohibited)
stated as a construction rule rather than only as a prohibition. A cell whose adjusted
assumptions would require more debt than the committed facility does not receive more
debt: it raises `facility_exceeded` and/or `funding_gap`, and that flag is the finding.
The suite measures a committed structure against adverse assumptions; it does not
re-underwrite the deal at every grid point.

### 12.3 The two-way matrix

The matrix has a row axis and a column axis. Each axis names one lever and a list of
steps in that lever's unit. The two axes must name different levers. Each cell is the
appraisal that results from applying the row lever at its step and the column lever at
its step to the base document, per §12.1.

The **normative default grid** is:

- rows: `construction_cost` at `[-5, 0, +5, +10, +15]` percent
- columns: `gdv` at `[-15, -10, -5, 0, +5]` percent

### 12.4 The tornado

Each tornado bar names one lever and a low and a high value in that lever's unit. The
bar's endpoints are the appraisals resulting from applying that lever alone at its low
and at its high. A bar's **span** is `|profit(high) − profit(low)|` in pence.

The **normative default ranges** are: `gdv` ±10 percent, `construction_cost` ±10
percent, `timeline` ±3 months, `interest_rate` ±1.0 percentage points.

Bars are ordered by span descending. Ties are broken by the fixed lever order
`gdv`, `construction_cost`, `timeline`, `interest_rate`. This makes the ordering total
and therefore deterministic (§1.4).

### 12.5 The base case is a cell

The measurement taken with every lever at zero must equal the unadjusted appraisal of
the base document exactly, in every reported quantity. Where the default grid is used,
this is the `(construction_cost = 0, gdv = 0)` cell.

### 12.6 Validation

The following are input errors, not flags:

- an axis with an empty step list, or any non-finite step;
- an axis with more than nine steps (the suite is bounded at 81 cells);
- a row axis and a column axis naming the same lever;
- a lever appearing more than once among the tornado bars;
- a tornado bar whose low is not strictly less than its high, or either non-finite.
```

- [ ] **Step 3: Add the §11.8 cross-reference**

In §11, change item 8 from:

```
8. Debt re-sized inside scenario/downside calculations.
```

to:

```
8. Debt re-sized inside scenario/downside calculations (see §12.2, which states the
   same rule constructively for the sensitivity suite).
```

- [ ] **Step 4: Update the specification's version header**

At the top of the file the header records the calc version the spec describes. Change the recorded version from `2.3.0` to `2.4.0`. Find it with:

Run: `grep -n "2\.3\.0" docs/financial-model/calculation-specification.md`

Change only the header/status line that states which version the document *describes*. Leave untouched any line that records when an existing feature was introduced (e.g. "[R3b — calc 2.3.0]" section markers) — those are history, not the current version.

- [ ] **Step 5: Verify no code changed and the docs still read cleanly**

Run: `git diff --stat`
Expected: exactly one file changed, `docs/financial-model/calculation-specification.md`.

- [ ] **Step 6: Commit**

```bash
git add docs/financial-model/calculation-specification.md
git commit -m "$(cat <<'EOF'
docs(spec): add §12 sensitivity analysis

Scenarios and sensitivities had no spec section at all — §11.8 only
prohibited re-sizing debt inside one. §12 gives both a normative home:
the shared four-lever rule, the facility-invariant construction rule,
the default grid and tornado ranges, the total ordering, the base-case
identity, and the validation rules.

§12.2 is the substantive change: it restates §11.8 constructively, which
is what makes "fixed-facility" testable rather than merely forbidden.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Promote `applyScenario` into the model directory (TypeScript)

**Files:**
- Move: `frontend/src/lib/apply-scenario.ts` → `frontend/src/lib/model/apply-scenario.ts`
- Move: `frontend/src/lib/apply-scenario.test.ts` → `frontend/src/lib/model/apply-scenario.test.ts`
- Modify: `frontend/src/lib/deal-spider.ts:6`, `frontend/src/lib/deal-spider.test.ts:12`, `frontend/src/lib/export-investment-memo.ts:6`, `frontend/src/components/calculator/DealSpiderPage.tsx:12`, `frontend/src/components/calculator/ScenariosPage.tsx:5`

**Interfaces:**
- Consumes: spec §12.1 from Task 1.
- Produces: `applyScenario<T extends AnyCalculatorInputs>(inputs: T, overrides: ScenarioOverrides): T`, now importable as `./apply-scenario` from inside `frontend/src/lib/model/`.

This is a pure move. **No behaviour changes.** The reason for the move is that §12.1 makes the lever rule normative, and governance §1 requires the Python authority to mirror TS modules file-for-file — which it can only do for modules inside `model/`.

- [ ] **Step 1: Move both files with git so history follows**

```bash
cd frontend/src/lib
git mv apply-scenario.ts model/apply-scenario.ts
git mv apply-scenario.test.ts model/apply-scenario.test.ts
```

- [ ] **Step 2: Fix the moved files' own relative imports**

`model/apply-scenario.ts` previously imported:

```ts
import type { ScenarioOverrides } from './conversion-types';
import type { AnyCalculatorInputs } from './model/finance-types';
```

From inside `model/` these become:

```ts
import type { ScenarioOverrides } from '../conversion-types';
import type { AnyCalculatorInputs } from './finance-types';
```

Apply the same one-level-up correction to every relative import in `model/apply-scenario.test.ts` — anything that referred to a sibling in `lib/` now needs `../`, and anything that referred to `./model/x` now needs `./x`.

- [ ] **Step 3: Update the five import sites**

In `frontend/src/lib/deal-spider.ts`, `frontend/src/lib/deal-spider.test.ts` and `frontend/src/lib/export-investment-memo.ts`, change:

```ts
import { applyScenario } from './apply-scenario';
```

to:

```ts
import { applyScenario } from './model/apply-scenario';
```

In `frontend/src/components/calculator/DealSpiderPage.tsx` and `frontend/src/components/calculator/ScenariosPage.tsx`, change:

```ts
import { applyScenario } from '../../lib/apply-scenario';
```

to:

```ts
import { applyScenario } from '../../lib/model/apply-scenario';
```

- [ ] **Step 4: Add the docstring note explaining why it lives here**

At the top of `frontend/src/lib/model/apply-scenario.ts`, above the existing block comment, add:

```ts
/**
 * The lever-application rule of spec §12.1, shared by the named scenarios and the
 * sensitivity suite. It lives inside `model/` — rather than beside the other `lib/`
 * helpers, where it started — because §12.1 makes it normative, and governance §1
 * requires the authoritative Python engine to mirror model modules file-for-file
 * (`app/financial_model/apply_scenario.py`).
 */
```

- [ ] **Step 5: Verify nothing still points at the old path**

Run: `grep -rn "lib/apply-scenario\|from './apply-scenario'" frontend/src`
Expected: no output at all.

- [ ] **Step 6: Run the gates**

Run, from `frontend/`: `npm test -- apply-scenario deal-spider export-investment-memo`
Expected: PASS, with the same test count as before the move.

Run, from `frontend/`: `npx tsc -b`
Expected: clean, no output.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "$(cat <<'EOF'
refactor(model): move applyScenario into the model directory

Spec §12.1 makes the lever-application rule normative, and governance §1
requires the authoritative Python engine to mirror model modules
file-for-file. A rule sitting in lib/ alongside UI helpers cannot be
mirrored that way, so it moves to lib/model/ ahead of its Python twin.

Pure move: no behaviour change, same tests, five import sites updated.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Python mirror of the lever rule

**Files:**
- Create: `app/financial_model/apply_scenario.py`
- Create: `tests/test_financial_model_apply_scenario.py`

**Interfaces:**
- Consumes: spec §12.1; the TS module from Task 2 as the transliteration source.
- Produces: `apply_scenario(inputs: AnyCalculatorInputs, overrides: ScenarioOverrides) -> AnyCalculatorInputs`. `ScenarioOverrides` is **not** new — it already exists at `app/financial_model/types.py:145` as a Pydantic model with exactly the five TS fields (`timeline_adjustment_months` is typed `float` there, not `int`).

- [ ] **Step 1: Confirm the two facts this task depends on**

Run: `sed -n '36,41p;145,151p' app/financial_model/types.py`

Expected: `class Model(BaseModel)` — the inputs are **Pydantic v2 models, not dataclasses**, so `dataclasses.replace` will not work on them. And `class ScenarioOverrides(Model)` already exists with the five fields; import it, do not redefine it.

Run: `grep -n "def money_round" -A 4 app/financial_model/engine.py`

Expected: `math.floor(x + 0.5)` — this codebase's round-half-up. The lever scaling must use it, never Python's banker's-rounding built-in `round()`.

- [ ] **Step 2: Write the failing test**

Create `tests/test_financial_model_apply_scenario.py`. The numbers below are hand-derived from Fixture F (`fixtures/financial-model/f-dev-finance-12mo.json`): four units at 30,000,000 pence each, `construction_cost_per_sqm_pence` 100,000, `term_months` 12, `annual_interest_rate_pct` 8.

```python
"""Mirror of frontend/src/lib/model/apply-scenario.test.ts (spec Sec 12.1).

Hand-derived from Fixture F: units 30,000,000 pence each, cost/sqm 100,000 pence,
term 12 months, rate 8.0%.
  -15% GDV -> 30,000,000 * 0.85 = 25,500,000
  +15% cost -> 100,000 * 1.15   =    115,000
  -3 months -> 12 - 3           =          9
  +1.0 pp   -> 8.0 + 1.0        =        9.0
"""
import json
from pathlib import Path

from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.types import ScenarioOverrides, parse_calculator_inputs

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "f-dev-finance-12mo.json"


def _base():
    return parse_calculator_inputs(json.loads(FIXTURE.read_text(encoding="utf-8"))["inputs"])


def _overrides(**kwargs):
    return ScenarioOverrides(
        label=kwargs.get("label", ""),
        gdv_adjustment_pct=kwargs.get("gdv_adjustment_pct", 0.0),
        construction_cost_adjustment_pct=kwargs.get("construction_cost_adjustment_pct", 0.0),
        timeline_adjustment_months=kwargs.get("timeline_adjustment_months", 0),
        interest_rate_adjustment_pct=kwargs.get("interest_rate_adjustment_pct", 0.0),
    )


def test_gdv_lever_scales_every_unit_value():
    out = apply_scenario(_base(), _overrides(gdv_adjustment_pct=-15.0))
    assert [u.estimated_value_pence for u in out.unit_mix.units] == [25500000] * 4


def test_cost_lever_scales_cost_per_sqm():
    out = apply_scenario(_base(), _overrides(construction_cost_adjustment_pct=15.0))
    assert out.conversion_costs.construction_cost_per_sqm_pence == 115000


def test_timeline_and_rate_levers_add():
    out = apply_scenario(_base(), _overrides(timeline_adjustment_months=-3, interest_rate_adjustment_pct=1.0))
    assert out.finance.term_months == 9
    assert out.finance.annual_interest_rate_pct == 9.0


def test_levers_are_order_independent_because_fields_are_disjoint():
    """Spec Sec 12.1: the four levers write to disjoint fields."""
    both = _overrides(gdv_adjustment_pct=-15.0, construction_cost_adjustment_pct=15.0)
    combined = apply_scenario(_base(), both)
    staged = apply_scenario(
        apply_scenario(_base(), _overrides(gdv_adjustment_pct=-15.0)),
        _overrides(construction_cost_adjustment_pct=15.0),
    )
    assert [u.estimated_value_pence for u in combined.unit_mix.units] == [
        u.estimated_value_pence for u in staged.unit_mix.units
    ]
    assert (
        combined.conversion_costs.construction_cost_per_sqm_pence
        == staged.conversion_costs.construction_cost_per_sqm_pence
    )


def test_facility_and_equity_are_never_touched():
    """Spec Sec 12.2: no lever may write to the committed facility or equity."""
    base = _base()
    out = apply_scenario(base, _overrides(gdv_adjustment_pct=-15.0, construction_cost_adjustment_pct=15.0,
                                          timeline_adjustment_months=3, interest_rate_adjustment_pct=1.0))
    assert out.finance.committed_net_facility_pence == base.finance.committed_net_facility_pence
    assert out.finance.committed_gross_facility_pence == base.finance.committed_gross_facility_pence
    assert out.finance.day_one_advance_pence == base.finance.day_one_advance_pence
    assert [e.amount_pence for e in out.equity_sources] == [e.amount_pence for e in base.equity_sources]


def test_base_document_is_not_mutated():
    base = _base()
    apply_scenario(base, _overrides(gdv_adjustment_pct=-15.0))
    assert base.unit_mix.units[0].estimated_value_pence == 30000000
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pytest tests/test_financial_model_apply_scenario.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.financial_model.apply_scenario'`.

- [ ] **Step 4: Write the implementation**

Create `app/financial_model/apply_scenario.py`. Transliterate `frontend/src/lib/model/apply-scenario.ts` — read it and follow its structure and comments, as every other module in this package does.

The TS version returns a new object via spreads. The Pydantic equivalent is `model_copy(deep=True)` followed by mutation of the copy: the deep copy is what guarantees the base document is untouched (`test_base_document_is_not_mutated`), and it preserves the document's concrete version class (v2, v3 or v4) without a version switch, exactly as the TS generic does.

Do **not** reach for `model_copy(update=...)` — it is shallow, so the nested `unit_mix` / `conversion_costs` / `finance` blocks would still be shared with the caller's document.

```python
"""Port of frontend/src/lib/model/apply-scenario.ts.

The lever-application rule of spec Sec 12.1, shared by the named scenarios and the
sensitivity suite (sensitivity.py). Applies a scenario's GDV / cost / timeline / rate
adjustments to a v2, v3 or v4 inputs document and returns a new document of the same
version -- every field the levers do not name is carried through untouched, including
the committed facility and equity sources, which spec Sec 12.2 holds invariant.

The TS twin builds its result from spreads; here a deep model_copy plays that role.
It keeps the caller's document unmutated and preserves the concrete version class
without a version switch, mirroring the TS function's generic return.
"""
from __future__ import annotations

from .engine import money_round
from .types import AnyCalculatorInputs, ScenarioOverrides


def apply_scenario(inputs: AnyCalculatorInputs, overrides: ScenarioOverrides) -> AnyCalculatorInputs:
    gdv_multiplier = 1 + overrides.gdv_adjustment_pct / 100
    cost_multiplier = 1 + overrides.construction_cost_adjustment_pct / 100

    out = inputs.model_copy(deep=True)

    for unit in out.unit_mix.units:
        unit.estimated_value_pence = money_round(unit.estimated_value_pence * gdv_multiplier)

    out.conversion_costs.construction_cost_per_sqm_pence = money_round(
        out.conversion_costs.construction_cost_per_sqm_pence * cost_multiplier
    )

    out.finance.term_months = inputs.finance.term_months + int(overrides.timeline_adjustment_months)
    out.finance.annual_interest_rate_pct = (
        inputs.finance.annual_interest_rate_pct + overrides.interest_rate_adjustment_pct
    )

    return out
```

`timeline_adjustment_months` is typed `float` on `ScenarioOverrides` but `term_months` is an integer month count, hence the explicit `int(...)`. The TS side adds them directly because JS has one number type; the cast is the transliteration's only deliberate divergence and is worth the inline note above.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pytest tests/test_financial_model_apply_scenario.py -v`
Expected: PASS, 6 tests.

- [ ] **Step 6: Check the TS twin asserts the same things**

Read `frontend/src/lib/model/apply-scenario.test.ts`. If it has no equivalent of `test_facility_and_equity_are_never_touched` or `test_levers_are_order_independent_because_fields_are_disjoint`, add them there too — §12.1 and §12.2 must be pinned in both languages. Use the same Fixture F numbers.

Run, from `frontend/`: `npm test -- apply-scenario`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/financial_model/apply_scenario.py tests/test_financial_model_apply_scenario.py frontend/src/lib/model/apply-scenario.test.ts
git commit -m "$(cat <<'EOF'
feat(model): mirror the lever-application rule into the Python engine

Spec §12.1's lever rule existed only in TypeScript, so the authoritative
engine had no way to reproduce a scenario or a sensitivity cell. This is
the file-for-file mirror governance §1 requires.

Both languages now pin §12.1 order-independence and §12.2 facility
invariance directly, with numbers hand-derived from Fixture F.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: TypeScript sensitivity types and config validation

**Files:**
- Create: `frontend/src/lib/model/sensitivity.ts`
- Create: `frontend/src/lib/model/sensitivity.test.ts`

**Interfaces:**
- Consumes: `applyScenario` (Task 2); spec §12.1–§12.6 (Task 1).
- Produces, for Tasks 5–8 and for R4b:
  - `type SensitivityLever = 'gdv' | 'construction_cost' | 'timeline' | 'interest_rate'`
  - `const LEVER_ORDER: readonly SensitivityLever[]`
  - `const MAX_AXIS_STEPS = 9`
  - `const DEFAULT_SENSITIVITY_CONFIG: SensitivityConfig`
  - `interface SensitivityAxis { lever: SensitivityLever; steps: number[] }`
  - `interface TornadoRange { lever: SensitivityLever; low: number; high: number }`
  - `interface SensitivityConfig { rows: SensitivityAxis; cols: SensitivityAxis; tornado: TornadoRange[] }`
  - `interface SensitivityMetrics { profit_pence: number; profit_on_cost_pct: number | null; profit_on_gdv_pct: number | null; irr_annual_pct: number | null; ltgdv_developer_pct: number | null; peak_debt_pence: number; flags: FlagCode[] }`
  - `interface SensitivityCell extends SensitivityMetrics { row_step: number; col_step: number }`
  - `interface TornadoBar { lever: SensitivityLever; low_step: number; high_step: number; low: SensitivityMetrics; high: SensitivityMetrics; span_pence: number }`
  - `interface SensitivityResult { base: SensitivityMetrics; matrix: SensitivityCell[][]; tornado: TornadoBar[]; config: SensitivityConfig }`
  - `function validateSensitivityConfig(config: SensitivityConfig): ValidationIssue[]`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/model/sensitivity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SENSITIVITY_CONFIG, LEVER_ORDER, MAX_AXIS_STEPS, validateSensitivityConfig,
} from './sensitivity';
import type { SensitivityConfig } from './sensitivity';

/** A deep copy of the defaults, so a test that mutates one field cannot leak into another. */
function config(overrides: Partial<SensitivityConfig> = {}): SensitivityConfig {
  return {
    rows: { ...DEFAULT_SENSITIVITY_CONFIG.rows, steps: [...DEFAULT_SENSITIVITY_CONFIG.rows.steps] },
    cols: { ...DEFAULT_SENSITIVITY_CONFIG.cols, steps: [...DEFAULT_SENSITIVITY_CONFIG.cols.steps] },
    tornado: DEFAULT_SENSITIVITY_CONFIG.tornado.map((r) => ({ ...r })),
    ...overrides,
  };
}

describe('sensitivity defaults (spec §12.3, §12.4)', () => {
  it('pins the normative default grid', () => {
    expect(DEFAULT_SENSITIVITY_CONFIG.rows).toEqual({
      lever: 'construction_cost', steps: [-5, 0, 5, 10, 15],
    });
    expect(DEFAULT_SENSITIVITY_CONFIG.cols).toEqual({
      lever: 'gdv', steps: [-15, -10, -5, 0, 5],
    });
  });

  it('pins the normative default tornado ranges', () => {
    expect(DEFAULT_SENSITIVITY_CONFIG.tornado).toEqual([
      { lever: 'gdv', low: -10, high: 10 },
      { lever: 'construction_cost', low: -10, high: 10 },
      { lever: 'timeline', low: -3, high: 3 },
      { lever: 'interest_rate', low: -1, high: 1 },
    ]);
  });

  it('pins the tie-break lever order', () => {
    expect(LEVER_ORDER).toEqual(['gdv', 'construction_cost', 'timeline', 'interest_rate']);
  });

  it('accepts the defaults without complaint', () => {
    expect(validateSensitivityConfig(DEFAULT_SENSITIVITY_CONFIG)).toEqual([]);
  });
});

describe('validateSensitivityConfig (spec §12.6)', () => {
  it('rejects an empty axis', () => {
    const issues = validateSensitivityConfig(config({ rows: { lever: 'construction_cost', steps: [] } }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.rows.steps');
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('rejects a non-finite step', () => {
    const issues = validateSensitivityConfig(config({ rows: { lever: 'construction_cost', steps: [0, NaN] } }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.rows.steps');
  });

  it(`rejects more than ${MAX_AXIS_STEPS} steps on an axis`, () => {
    const steps = Array.from({ length: MAX_AXIS_STEPS + 1 }, (_, k) => k);
    const issues = validateSensitivityConfig(config({ cols: { lever: 'gdv', steps } }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.cols.steps');
  });

  it('rejects both axes naming the same lever', () => {
    const issues = validateSensitivityConfig(config({ rows: { lever: 'gdv', steps: [0] } }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.cols.lever');
  });

  it('rejects a lever appearing twice in the tornado', () => {
    const issues = validateSensitivityConfig(config({
      tornado: [{ lever: 'gdv', low: -10, high: 10 }, { lever: 'gdv', low: -5, high: 5 }],
    }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.tornado');
  });

  it('rejects a tornado range whose low is not below its high', () => {
    const issues = validateSensitivityConfig(config({
      tornado: [{ lever: 'gdv', low: 10, high: 10 }],
    }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.tornado');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `frontend/`: `npm test -- sensitivity`
Expected: FAIL — cannot resolve `./sensitivity`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/model/sensitivity.ts` with only what these tests need. `runSensitivity` arrives in Task 5.

```ts
import type { FlagCode } from './finance-types';
import type { ValidationIssue } from './validation';

/**
 * The fixed-facility sensitivity suite of spec §12. Every cell and every tornado
 * endpoint is one ordinary appraisal of the base document with levers applied per
 * §12.1; the committed facility and equity sources are never adjusted (§12.2), so a
 * cell that would need more debt raises `facility_exceeded`/`funding_gap` rather than
 * receiving it.
 *
 * This module imports `runAppraisal` from `./index`. `index.ts` must therefore never
 * import or re-export this module — consumers import `./model/sensitivity` directly.
 */

export type SensitivityLever = 'gdv' | 'construction_cost' | 'timeline' | 'interest_rate';

/** Spec §12.4 tie-break order, making the tornado sort total and so deterministic (§1.4). */
export const LEVER_ORDER: readonly SensitivityLever[] = [
  'gdv', 'construction_cost', 'timeline', 'interest_rate',
];

/** Spec §12.6: an axis is capped at nine steps, bounding the suite at 81 cells. */
export const MAX_AXIS_STEPS = 9;

export interface SensitivityAxis {
  lever: SensitivityLever;
  /** In the lever's own unit: percent for gdv/construction_cost, months for timeline,
   *  percentage points for interest_rate. */
  steps: number[];
}

export interface TornadoRange {
  lever: SensitivityLever;
  low: number;
  high: number;
}

export interface SensitivityConfig {
  rows: SensitivityAxis;
  cols: SensitivityAxis;
  tornado: TornadoRange[];
}

/** Spec §12.3 and §12.4. These are the steps the investment memo has always used;
 *  R4 promoted them from a constant inside the exporter to a specified default. */
export const DEFAULT_SENSITIVITY_CONFIG: SensitivityConfig = {
  rows: { lever: 'construction_cost', steps: [-5, 0, 5, 10, 15] },
  cols: { lever: 'gdv', steps: [-15, -10, -5, 0, 5] },
  tornado: [
    { lever: 'gdv', low: -10, high: 10 },
    { lever: 'construction_cost', low: -10, high: 10 },
    { lever: 'timeline', low: -3, high: 3 },
    { lever: 'interest_rate', low: -1, high: 1 },
  ],
};

/**
 * The metric reduction of one appraisal. Percentage fields stay nullable to match
 * `AppraisalResultV2` — a zero-cost or unrealised-profit run already yields null
 * there, and the suite must not invent a number the engine declined to produce.
 * `flags` carries raw codes; the memo's FE/FG/NR shorthand is presentation, not model.
 */
export interface SensitivityMetrics {
  profit_pence: number;
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  irr_annual_pct: number | null;
  ltgdv_developer_pct: number | null;
  peak_debt_pence: number;
  flags: FlagCode[];
}

/** A measurement at a grid position. Tornado endpoints are single-lever measurements
 *  with no grid position, so they carry `SensitivityMetrics` instead. */
export interface SensitivityCell extends SensitivityMetrics {
  row_step: number;
  col_step: number;
}

export interface TornadoBar {
  lever: SensitivityLever;
  low_step: number;
  high_step: number;
  low: SensitivityMetrics;
  high: SensitivityMetrics;
  /** |profit(high) − profit(low)|, spec §12.4. */
  span_pence: number;
}

export interface SensitivityResult {
  base: SensitivityMetrics;
  /** matrix[rowIndex][colIndex], indexed by `config.rows.steps` / `config.cols.steps`. */
  matrix: SensitivityCell[][];
  tornado: TornadoBar[];
  /** The resolved config, echoed back so a report prints the ranges actually used
   *  rather than assuming the defaults. */
  config: SensitivityConfig;
}

/** Spec §12.6. Returns error-severity issues; an empty array means the config is usable. */
export function validateSensitivityConfig(config: SensitivityConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const axes: Array<['rows' | 'cols', SensitivityAxis]> = [['rows', config.rows], ['cols', config.cols]];

  for (const [name, axis] of axes) {
    const field = `sensitivity.${name}.steps`;
    if (axis.steps.length === 0) {
      issues.push({ severity: 'error', field, message: 'An axis needs at least one step.' });
    }
    if (axis.steps.length > MAX_AXIS_STEPS) {
      issues.push({ severity: 'error', field, message: `An axis takes at most ${MAX_AXIS_STEPS} steps.` });
    }
    if (axis.steps.some((s) => !Number.isFinite(s))) {
      issues.push({ severity: 'error', field, message: 'Every step must be a finite number.' });
    }
  }

  if (config.rows.lever === config.cols.lever) {
    issues.push({
      severity: 'error', field: 'sensitivity.cols.lever',
      message: 'The row and column axes must use different levers.',
    });
  }

  const seen = new Set<SensitivityLever>();
  for (const range of config.tornado) {
    if (seen.has(range.lever)) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `Lever ${range.lever} appears more than once in the tornado.`,
      });
    }
    seen.add(range.lever);
    if (!Number.isFinite(range.low) || !Number.isFinite(range.high) || range.low >= range.high) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `Tornado range for ${range.lever} needs finite low < high.`,
      });
    }
  }

  return issues;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run, from `frontend/`: `npm test -- sensitivity`
Expected: PASS, 11 tests.

Run, from `frontend/`: `npx tsc -b && npx eslint src/lib/model/sensitivity.ts src/lib/model/sensitivity.test.ts`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/sensitivity.ts frontend/src/lib/model/sensitivity.test.ts
git commit -m "$(cat <<'EOF'
feat(model): sensitivity config types and validation (spec §12.6)

The default grid and tornado ranges move out of export-investment-memo.ts,
where they were bare constants, into a specified default this module owns
and tests pin against §12.3/§12.4.

Config validation returns ValidationIssue[] rather than throwing so the
R4b axis editor can render the reason a user's grid was rejected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: TypeScript `runSensitivity`

**Files:**
- Modify: `frontend/src/lib/model/sensitivity.ts`
- Modify: `frontend/src/lib/model/sensitivity.test.ts`

**Interfaces:**
- Consumes: everything Task 4 produced; `runAppraisal` from `./index`; `applyScenario` from `./apply-scenario`.
- Produces: `function runSensitivity(inputs: AnyCalculatorInputs, config?: SensitivityConfig): SensitivityResult`. R4b's `SensitivityPage` and the memo call exactly this.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/model/sensitivity.test.ts`. Add these imports at the top of the file:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAppraisal } from './index';
import { runSensitivity } from './sensitivity';
import type { AnyCalculatorInputs } from './finance-types';
```

and this helper plus describe block:

```ts
const FIXTURE_F = resolve(__dirname, '../../../../fixtures/financial-model/f-dev-finance-12mo.json');

function fixtureFInputs(): AnyCalculatorInputs {
  return JSON.parse(readFileSync(FIXTURE_F, 'utf-8')).inputs as AnyCalculatorInputs;
}

describe('runSensitivity (spec §12.3, §12.4, §12.5)', () => {
  it('produces a matrix shaped by the config axes', () => {
    const result = runSensitivity(fixtureFInputs());
    expect(result.matrix).toHaveLength(5);
    expect(result.matrix.every((row) => row.length === 5)).toBe(true);
    expect(result.matrix[0][0].row_step).toBe(-5);
    expect(result.matrix[0][0].col_step).toBe(-15);
    expect(result.matrix[4][4].row_step).toBe(15);
    expect(result.matrix[4][4].col_step).toBe(5);
  });

  it('echoes the resolved config back', () => {
    expect(runSensitivity(fixtureFInputs()).config).toEqual(DEFAULT_SENSITIVITY_CONFIG);
  });

  // Spec §12.5: the all-levers-zero measurement is the unadjusted appraisal.
  it('reports a base case identical to the unadjusted appraisal', () => {
    const inputs = fixtureFInputs();
    const plain = runAppraisal(inputs).metrics;
    const { base } = runSensitivity(inputs);
    expect(base.profit_pence).toBe(plain.profit_pence);
    expect(base.profit_on_cost_pct).toBe(plain.profit_on_cost_pct);
    expect(base.profit_on_gdv_pct).toBe(plain.profit_on_gdv_pct);
    expect(base.irr_annual_pct).toBe(plain.irr_annual_pct);
    expect(base.ltgdv_developer_pct).toBe(plain.ltgdv_developer_pct);
    expect(base.peak_debt_pence).toBe(plain.peak_debt_pence);
    expect(base.flags).toEqual(plain.flags.map((f) => f.code));
  });

  it('places the base case at the zero/zero grid position too', () => {
    const { base, matrix, config } = runSensitivity(fixtureFInputs());
    const ri = config.rows.steps.indexOf(0);
    const ci = config.cols.steps.indexOf(0);
    expect(matrix[ri][ci].profit_pence).toBe(base.profit_pence);
  });

  it('gives one tornado bar per configured range, sorted by span descending', () => {
    const { tornado } = runSensitivity(fixtureFInputs());
    expect(tornado).toHaveLength(4);
    const spans = tornado.map((b) => b.span_pence);
    expect([...spans].sort((a, b) => b - a)).toEqual(spans);
    expect(spans.every((s) => s >= 0)).toBe(true);
  });

  it('orders bars independently of the order the ranges were configured in', () => {
    // §12.4's ordering must be a property of the spans and the lever tie-break, never
    // of the caller's array order — otherwise the two engines could disagree simply
    // because one built its config differently.
    const inputs = fixtureFInputs();
    const forward = runSensitivity(inputs, {
      ...DEFAULT_SENSITIVITY_CONFIG,
      tornado: [
        { lever: 'gdv', low: -10, high: 10 },
        { lever: 'construction_cost', low: -10, high: 10 },
      ],
    });
    const reversed = runSensitivity(inputs, {
      ...DEFAULT_SENSITIVITY_CONFIG,
      tornado: [
        { lever: 'construction_cost', low: -10, high: 10 },
        { lever: 'gdv', low: -10, high: 10 },
      ],
    });
    expect(forward.tornado.map((b) => b.lever)).toEqual(reversed.tornado.map((b) => b.lever));
  });

  // Spec §12.2 made constructive: the committed facility is identical in every cell,
  // so a stressed cell reports facility_exceeded rather than quietly borrowing more.
  it('never re-sizes the facility, whatever the cell', () => {
    const inputs = fixtureFInputs();
    const { matrix } = runSensitivity(inputs);
    const basePeak = runAppraisal(inputs).metrics.peak_debt_pence;
    const worst = matrix[4][0]; // cost +15%, GDV −15%
    expect(worst.peak_debt_pence).toBeGreaterThanOrEqual(basePeak);
    // The committed facility is an input, so the only way a cell can exceed it is a flag.
    const committed = inputs.finance.committed_net_facility_pence;
    if (worst.peak_debt_pence > committed) {
      expect(worst.flags).toContain('facility_exceeded');
    }
  });

  it('throws on an invalid config rather than computing a misleading grid', () => {
    expect(() => runSensitivity(fixtureFInputs(), {
      ...DEFAULT_SENSITIVITY_CONFIG,
      rows: { lever: 'gdv', steps: [0] },
    })).toThrow(/different levers/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `frontend/`: `npm test -- sensitivity`
Expected: FAIL — `runSensitivity` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `frontend/src/lib/model/sensitivity.ts`. Extend the import block at the top:

```ts
import type { AnyCalculatorInputs, FlagCode } from './finance-types';
import type { ScenarioOverrides } from '../conversion-types';
import type { ValidationIssue } from './validation';
import { applyScenario } from './apply-scenario';
import { runAppraisal } from './index';
```

and append:

```ts
/** Builds the `ScenarioOverrides` for a set of lever positions. Levers not named sit at
 *  zero, which §12.1 guarantees is a no-op because the four levers are disjoint. */
function overridesFor(levers: Partial<Record<SensitivityLever, number>>): ScenarioOverrides {
  return {
    label: '',
    gdv_adjustment_pct: levers.gdv ?? 0,
    construction_cost_adjustment_pct: levers.construction_cost ?? 0,
    timeline_adjustment_months: levers.timeline ?? 0,
    interest_rate_adjustment_pct: levers.interest_rate ?? 0,
  };
}

/** One measurement: an ordinary appraisal of the levered document, reduced to the
 *  compact record. This is the only place the suite calls the engine. */
function measure(inputs: AnyCalculatorInputs, levers: Partial<Record<SensitivityLever, number>>): SensitivityMetrics {
  const m = runAppraisal(applyScenario(inputs, overridesFor(levers))).metrics;
  return {
    profit_pence: m.profit_pence,
    profit_on_cost_pct: m.profit_on_cost_pct,
    profit_on_gdv_pct: m.profit_on_gdv_pct,
    irr_annual_pct: m.irr_annual_pct,
    ltgdv_developer_pct: m.ltgdv_developer_pct,
    peak_debt_pence: m.peak_debt_pence,
    flags: m.flags.map((f) => f.code),
  };
}

/**
 * The fixed-facility sensitivity suite (spec §12). Runs `config.rows.steps.length ×
 * config.cols.steps.length` matrix appraisals, two per tornado range, and one base —
 * 34 with the default config, against the 28 the investment memo already ran before
 * R4, so this is not a new order of magnitude. Callers that re-render on every
 * keystroke should memoise on the inputs object.
 *
 * Throws on an invalid config (§12.6). It throws rather than returning issues because
 * a partially-valid grid is a misleading grid; callers wanting to *display* the reason
 * call `validateSensitivityConfig` first.
 */
export function runSensitivity(
  inputs: AnyCalculatorInputs,
  config: SensitivityConfig = DEFAULT_SENSITIVITY_CONFIG,
): SensitivityResult {
  const issues = validateSensitivityConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid sensitivity config: ${issues.map((i) => i.message).join(' ')}`);
  }

  const base = measure(inputs, {});

  const matrix: SensitivityCell[][] = config.rows.steps.map((rowStep) =>
    config.cols.steps.map((colStep) => ({
      row_step: rowStep,
      col_step: colStep,
      ...measure(inputs, { [config.rows.lever]: rowStep, [config.cols.lever]: colStep }),
    })),
  );

  const tornado: TornadoBar[] = config.tornado
    .map((range) => {
      const low = measure(inputs, { [range.lever]: range.low });
      const high = measure(inputs, { [range.lever]: range.high });
      return {
        lever: range.lever,
        low_step: range.low,
        high_step: range.high,
        low,
        high,
        span_pence: Math.abs(high.profit_pence - low.profit_pence),
      };
    })
    .sort((a, b) => (
      b.span_pence - a.span_pence
      || LEVER_ORDER.indexOf(a.lever) - LEVER_ORDER.indexOf(b.lever)
    ));

  return { base, matrix, tornado, config };
}
```

Note the spread order in the matrix: `row_step`/`col_step` are written *before* the spread so that a future field collision would fail loudly at the type level rather than silently overwriting a coordinate.

- [ ] **Step 4: Run the test to verify it passes**

Run, from `frontend/`: `npm test -- sensitivity`
Expected: PASS, 19 tests.

- [ ] **Step 5: Verify no import cycle was introduced**

Run, from `frontend/`: `grep -n "sensitivity" src/lib/model/index.ts`
Expected: no output. `index.ts` must not reference this module.

Run, from `frontend/`: `npx tsc -b && npx eslint src/lib/model/`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/model/sensitivity.ts frontend/src/lib/model/sensitivity.test.ts
git commit -m "$(cat <<'EOF'
feat(model): runSensitivity — matrix and tornado (spec §12.3–§12.5)

Each cell is one ordinary runAppraisal over levered inputs, reduced to a
compact record; the facility is never adjusted, so a stressed cell reports
facility_exceeded instead of quietly borrowing more (§12.2).

Tornado bars sort by span descending with the §12.4 lever tie-break, which
makes the order total and therefore reproducible across both engines.

Imports runAppraisal from ./index and is deliberately not re-exported by
index.ts — that would close a module cycle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Python mirror of the suite

**Files:**
- Create: `app/financial_model/sensitivity.py`
- Create: `tests/test_financial_model_sensitivity.py`

**Interfaces:**
- Consumes: `apply_scenario` (Task 3); `run_appraisal` from `app.financial_model`; the TS module (Task 5) as the transliteration source.
- Produces: `run_sensitivity(inputs, config=DEFAULT_SENSITIVITY_CONFIG) -> SensitivityResult`, plus `SensitivityLever`, `LEVER_ORDER`, `MAX_AXIS_STEPS`, `DEFAULT_SENSITIVITY_CONFIG`, `SensitivityAxis`, `TornadoRange`, `SensitivityConfig`, `SensitivityMetrics`, `SensitivityCell`, `TornadoBar`, `SensitivityResult`, `validate_sensitivity_config`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_financial_model_sensitivity.py`. This mirrors `frontend/src/lib/model/sensitivity.test.ts` — same cases, same Fixture F basis.

```python
"""Mirror of frontend/src/lib/model/sensitivity.test.ts (spec Sec 12).

Same scenarios and same assertions as the TS suite; both are pinned to the shared
golden fixtures rather than to each other (governance Sec 1).
"""
import json
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.sensitivity import (
    DEFAULT_SENSITIVITY_CONFIG,
    LEVER_ORDER,
    MAX_AXIS_STEPS,
    SensitivityAxis,
    SensitivityConfig,
    TornadoRange,
    run_sensitivity,
    validate_sensitivity_config,
)
from app.financial_model.types import parse_calculator_inputs

FIXTURE_F = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "f-dev-finance-12mo.json"


def _inputs():
    return parse_calculator_inputs(json.loads(FIXTURE_F.read_text(encoding="utf-8"))["inputs"])


def _config(**overrides) -> SensitivityConfig:
    base = SensitivityConfig(
        rows=SensitivityAxis(lever=DEFAULT_SENSITIVITY_CONFIG.rows.lever,
                             steps=list(DEFAULT_SENSITIVITY_CONFIG.rows.steps)),
        cols=SensitivityAxis(lever=DEFAULT_SENSITIVITY_CONFIG.cols.lever,
                             steps=list(DEFAULT_SENSITIVITY_CONFIG.cols.steps)),
        tornado=[TornadoRange(lever=r.lever, low=r.low, high=r.high)
                 for r in DEFAULT_SENSITIVITY_CONFIG.tornado],
    )
    for key, value in overrides.items():
        setattr(base, key, value)
    return base


def test_default_grid_matches_the_spec():
    """Spec Sec 12.3."""
    assert DEFAULT_SENSITIVITY_CONFIG.rows.lever == "construction_cost"
    assert list(DEFAULT_SENSITIVITY_CONFIG.rows.steps) == [-5, 0, 5, 10, 15]
    assert DEFAULT_SENSITIVITY_CONFIG.cols.lever == "gdv"
    assert list(DEFAULT_SENSITIVITY_CONFIG.cols.steps) == [-15, -10, -5, 0, 5]


def test_default_tornado_matches_the_spec():
    """Spec Sec 12.4."""
    assert [(r.lever, r.low, r.high) for r in DEFAULT_SENSITIVITY_CONFIG.tornado] == [
        ("gdv", -10, 10),
        ("construction_cost", -10, 10),
        ("timeline", -3, 3),
        ("interest_rate", -1, 1),
    ]


def test_lever_order_matches_the_spec():
    assert list(LEVER_ORDER) == ["gdv", "construction_cost", "timeline", "interest_rate"]


def test_defaults_validate_clean():
    assert validate_sensitivity_config(DEFAULT_SENSITIVITY_CONFIG) == []


@pytest.mark.parametrize(
    "overrides,expected_field",
    [
        ({"rows": SensitivityAxis(lever="construction_cost", steps=[])}, "sensitivity.rows.steps"),
        ({"rows": SensitivityAxis(lever="construction_cost", steps=[0, float("nan")])}, "sensitivity.rows.steps"),
        ({"cols": SensitivityAxis(lever="gdv", steps=list(range(MAX_AXIS_STEPS + 1)))}, "sensitivity.cols.steps"),
        ({"rows": SensitivityAxis(lever="gdv", steps=[0])}, "sensitivity.cols.lever"),
        ({"tornado": [TornadoRange(lever="gdv", low=-10, high=10),
                      TornadoRange(lever="gdv", low=-5, high=5)]}, "sensitivity.tornado"),
        ({"tornado": [TornadoRange(lever="gdv", low=10, high=10)]}, "sensitivity.tornado"),
    ],
)
def test_validation_rejects_bad_configs(overrides, expected_field):
    """Spec Sec 12.6."""
    issues = validate_sensitivity_config(_config(**overrides))
    assert expected_field in [i.field for i in issues]
    assert all(i.severity == "error" for i in issues)


def test_matrix_is_shaped_by_the_axes():
    result = run_sensitivity(_inputs())
    assert len(result.matrix) == 5
    assert all(len(row) == 5 for row in result.matrix)
    assert (result.matrix[0][0].row_step, result.matrix[0][0].col_step) == (-5, -15)
    assert (result.matrix[4][4].row_step, result.matrix[4][4].col_step) == (15, 5)


def test_base_case_is_the_unadjusted_appraisal():
    """Spec Sec 12.5."""
    inputs = _inputs()
    plain = run_appraisal(inputs).metrics
    base = run_sensitivity(inputs).base
    assert base.profit_pence == plain.profit_pence
    assert base.profit_on_cost_pct == plain.profit_on_cost_pct
    assert base.profit_on_gdv_pct == plain.profit_on_gdv_pct
    assert base.irr_annual_pct == plain.irr_annual_pct
    assert base.ltgdv_developer_pct == plain.ltgdv_developer_pct
    assert base.peak_debt_pence == plain.peak_debt_pence
    assert base.flags == [f.code for f in plain.flags]


def test_base_case_also_sits_at_the_zero_zero_grid_position():
    result = run_sensitivity(_inputs())
    ri = list(result.config.rows.steps).index(0)
    ci = list(result.config.cols.steps).index(0)
    assert result.matrix[ri][ci].profit_pence == result.base.profit_pence


def test_tornado_is_sorted_by_span_descending():
    """Spec Sec 12.4."""
    bars = run_sensitivity(_inputs()).tornado
    assert len(bars) == 4
    spans = [b.span_pence for b in bars]
    assert spans == sorted(spans, reverse=True)
    assert all(s >= 0 for s in spans)


def test_tornado_order_is_independent_of_input_order():
    inputs = _inputs()
    forward = run_sensitivity(inputs, _config(tornado=[
        TornadoRange(lever="gdv", low=-10, high=10),
        TornadoRange(lever="construction_cost", low=-10, high=10),
    ]))
    reversed_ = run_sensitivity(inputs, _config(tornado=[
        TornadoRange(lever="construction_cost", low=-10, high=10),
        TornadoRange(lever="gdv", low=-10, high=10),
    ]))
    assert [b.lever for b in forward.tornado] == [b.lever for b in reversed_.tornado]


def test_invalid_config_raises():
    with pytest.raises(ValueError, match="different levers"):
        run_sensitivity(_inputs(), _config(rows=SensitivityAxis(lever="gdv", steps=[0])))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_financial_model_sensitivity.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.financial_model.sensitivity'`.

- [ ] **Step 3: Write the implementation**

Create `app/financial_model/sensitivity.py`. Read `frontend/src/lib/model/sensitivity.ts` and transliterate it — same order of definitions, same comments adapted to the `Sec` convention this package uses in docstrings.

```python
"""Port of frontend/src/lib/model/sensitivity.ts.

The fixed-facility sensitivity suite of spec Sec 12. Every cell and every tornado
endpoint is one ordinary appraisal of the base document with levers applied per
Sec 12.1; the committed facility and equity sources are never adjusted (Sec 12.2), so
a cell that would need more debt raises facility_exceeded/funding_gap rather than
receiving it.

This module imports run_appraisal from the package root. app/financial_model/__init__.py
must therefore never import this module -- consumers import
app.financial_model.sensitivity directly.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Literal

from .apply_scenario import apply_scenario
from .types import AnyCalculatorInputs, ScenarioOverrides
from .validation import ValidationIssue

SensitivityLever = Literal["gdv", "construction_cost", "timeline", "interest_rate"]

# Spec Sec 12.4 tie-break order, making the tornado sort total and so deterministic (Sec 1.4).
LEVER_ORDER: tuple[SensitivityLever, ...] = ("gdv", "construction_cost", "timeline", "interest_rate")

# Spec Sec 12.6: an axis is capped at nine steps, bounding the suite at 81 cells.
MAX_AXIS_STEPS = 9


@dataclass
class SensitivityAxis:
    lever: SensitivityLever
    # In the lever's own unit: percent for gdv/construction_cost, months for timeline,
    # percentage points for interest_rate.
    steps: list[float]


@dataclass
class TornadoRange:
    lever: SensitivityLever
    low: float
    high: float


@dataclass
class SensitivityConfig:
    rows: SensitivityAxis
    cols: SensitivityAxis
    tornado: list[TornadoRange]


@dataclass
class SensitivityMetrics:
    profit_pence: int
    profit_on_cost_pct: float | None
    profit_on_gdv_pct: float | None
    irr_annual_pct: float | None
    ltgdv_developer_pct: float | None
    peak_debt_pence: int
    flags: list[str]


@dataclass
class SensitivityCell(SensitivityMetrics):
    row_step: float = 0
    col_step: float = 0


@dataclass
class TornadoBar:
    lever: SensitivityLever
    low_step: float
    high_step: float
    low: SensitivityMetrics
    high: SensitivityMetrics
    span_pence: int  # |profit(high) - profit(low)|, spec Sec 12.4


@dataclass
class SensitivityResult:
    base: SensitivityMetrics
    matrix: list[list[SensitivityCell]]
    tornado: list[TornadoBar]
    config: SensitivityConfig


def _default_config() -> SensitivityConfig:
    """Spec Sec 12.3 and Sec 12.4. Built by a factory rather than held as a module-level
    mutable so a caller cannot adjust the defaults for the whole process."""
    return SensitivityConfig(
        rows=SensitivityAxis(lever="construction_cost", steps=[-5, 0, 5, 10, 15]),
        cols=SensitivityAxis(lever="gdv", steps=[-15, -10, -5, 0, 5]),
        tornado=[
            TornadoRange(lever="gdv", low=-10, high=10),
            TornadoRange(lever="construction_cost", low=-10, high=10),
            TornadoRange(lever="timeline", low=-3, high=3),
            TornadoRange(lever="interest_rate", low=-1, high=1),
        ],
    )


DEFAULT_SENSITIVITY_CONFIG = _default_config()


def validate_sensitivity_config(config: SensitivityConfig) -> list[ValidationIssue]:
    """Spec Sec 12.6. Returns error-severity issues; an empty list means usable."""
    issues: list[ValidationIssue] = []

    for name, axis in (("rows", config.rows), ("cols", config.cols)):
        field_name = f"sensitivity.{name}.steps"
        if len(axis.steps) == 0:
            issues.append(ValidationIssue(severity="error", field=field_name,
                                          message="An axis needs at least one step."))
        if len(axis.steps) > MAX_AXIS_STEPS:
            issues.append(ValidationIssue(severity="error", field=field_name,
                                          message=f"An axis takes at most {MAX_AXIS_STEPS} steps."))
        if any(not isfinite(s) for s in axis.steps):
            issues.append(ValidationIssue(severity="error", field=field_name,
                                          message="Every step must be a finite number."))

    if config.rows.lever == config.cols.lever:
        issues.append(ValidationIssue(severity="error", field="sensitivity.cols.lever",
                                      message="The row and column axes must use different levers."))

    seen: set[str] = set()
    for rng in config.tornado:
        if rng.lever in seen:
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message=f"Lever {rng.lever} appears more than once in the tornado."))
        seen.add(rng.lever)
        if not isfinite(rng.low) or not isfinite(rng.high) or rng.low >= rng.high:
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message=f"Tornado range for {rng.lever} needs finite low < high."))

    return issues


def _overrides_for(levers: dict[str, float]) -> ScenarioOverrides:
    """Levers not named sit at zero, which Sec 12.1 guarantees is a no-op because the
    four levers write to disjoint fields."""
    return ScenarioOverrides(
        label="",
        gdv_adjustment_pct=levers.get("gdv", 0),
        construction_cost_adjustment_pct=levers.get("construction_cost", 0),
        timeline_adjustment_months=levers.get("timeline", 0),
        interest_rate_adjustment_pct=levers.get("interest_rate", 0),
    )


def _measure(inputs: AnyCalculatorInputs, levers: dict[str, float]) -> SensitivityMetrics:
    """One measurement: an ordinary appraisal of the levered document, reduced to the
    compact record. The only place the suite calls the engine."""
    from app.financial_model import run_appraisal  # local import: see module docstring

    m = run_appraisal(apply_scenario(inputs, _overrides_for(levers))).metrics
    return SensitivityMetrics(
        profit_pence=m.profit_pence,
        profit_on_cost_pct=m.profit_on_cost_pct,
        profit_on_gdv_pct=m.profit_on_gdv_pct,
        irr_annual_pct=m.irr_annual_pct,
        ltgdv_developer_pct=m.ltgdv_developer_pct,
        peak_debt_pence=m.peak_debt_pence,
        flags=[f.code for f in m.flags],
    )


def run_sensitivity(
    inputs: AnyCalculatorInputs,
    config: SensitivityConfig | None = None,
) -> SensitivityResult:
    """The fixed-facility sensitivity suite (spec Sec 12). Runs rows x cols matrix
    appraisals, two per tornado range, and one base -- 34 with the default config.

    Raises ValueError on an invalid config (Sec 12.6): a partially-valid grid is a
    misleading grid. Callers wanting to display the reason call
    validate_sensitivity_config first.
    """
    if config is None:
        config = _default_config()

    issues = validate_sensitivity_config(config)
    if issues:
        raise ValueError("Invalid sensitivity config: " + " ".join(i.message for i in issues))

    base = _measure(inputs, {})

    matrix: list[list[SensitivityCell]] = []
    for row_step in config.rows.steps:
        row: list[SensitivityCell] = []
        for col_step in config.cols.steps:
            m = _measure(inputs, {config.rows.lever: row_step, config.cols.lever: col_step})
            row.append(SensitivityCell(
                profit_pence=m.profit_pence,
                profit_on_cost_pct=m.profit_on_cost_pct,
                profit_on_gdv_pct=m.profit_on_gdv_pct,
                irr_annual_pct=m.irr_annual_pct,
                ltgdv_developer_pct=m.ltgdv_developer_pct,
                peak_debt_pence=m.peak_debt_pence,
                flags=m.flags,
                row_step=row_step,
                col_step=col_step,
            ))
        matrix.append(row)

    bars = []
    for rng in config.tornado:
        low = _measure(inputs, {rng.lever: rng.low})
        high = _measure(inputs, {rng.lever: rng.high})
        bars.append(TornadoBar(
            lever=rng.lever,
            low_step=rng.low,
            high_step=rng.high,
            low=low,
            high=high,
            span_pence=abs(high.profit_pence - low.profit_pence),
        ))
    bars.sort(key=lambda b: (-b.span_pence, LEVER_ORDER.index(b.lever)))

    return SensitivityResult(base=base, matrix=matrix, tornado=bars, config=config)
```

Check whether the repo runs a Python linter and honour it: `grep -n "ruff\|flake8\|black" pyproject.toml setup.cfg 2>/dev/null`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_financial_model_sensitivity.py -v`
Expected: PASS.

- [ ] **Step 5: Verify no import cycle was introduced**

Run: `grep -n "sensitivity" app/financial_model/__init__.py`
Expected: no output.

Run: `python -c "import app.financial_model.sensitivity; print('ok')"`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/sensitivity.py tests/test_financial_model_sensitivity.py
git commit -m "$(cat <<'EOF'
feat(model): Python mirror of the sensitivity suite (spec §12)

File-for-file transliteration of sensitivity.ts, per governance §1, so the
authoritative engine can reproduce every cell and bar the client shows.

run_appraisal is imported inside _measure rather than at module scope, and
__init__.py deliberately does not import this module — either alone would
close a package-initialisation cycle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Fixture K

**Files:**
- Create: `fixtures/financial-model/k-sensitivity.json`
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts`
- Modify: `tests/test_financial_model_fixtures.py`
- Modify: `docs/financial-model/test-cases.md`
- Modify: `docs/financial-model/model-governance.md`

**Interfaces:**
- Consumes: `runSensitivity` / `run_sensitivity` (Tasks 5, 6).
- Produces: the golden contract both engines are held to. Nothing later consumes its shape in code beyond the two harnesses modified here.

**Read first:** design doc §4 (`docs/superpowers/specs/2026-08-16-release-4-design.md`). The derivation split below was approved during brainstorming and is not yours to re-decide.

**Why this task leaves numbers for you to produce.** Every other task in this plan hands you the exact code and the exact expected values. This one deliberately does not, in two places: the two corner cells and the four tornado spans. Those require rolling a 12-month interest ledger by hand, and a golden fixture whose numbers came from anywhere other than an independent derivation is not a contract — it is a snapshot, which governance §2 exists to prevent. A number invented here and copied into the fixture would defeat the entire mechanism. The steps below therefore give you the exact derived inputs, the exact derivation chain and the exact place to record the worksheet, and Step 9 fails the task if a marker survives.

- [ ] **Step 1: Write the hand derivations into `test-cases.md`**

Fixture K is built over Fixture F. From `fixtures/financial-model/f-dev-finance-12mo.json`: four units at `estimated_value_pence` 30,000,000 each; `construction_cost_per_sqm_pence` 100,000; `total_construction_sqm` 400; `contingency_pct` 10; `term_months` 12; `annual_interest_rate_pct` 8.0; `committed_net_facility_pence` 60,000,000; `selling_agent_fee_pct` 1.5; `selling_legal_fee_pence` 400,000.

Because the four levers write to disjoint fields (§12.1), the derived inputs are **per axis, not per cell** — five GDV-scaled unit values and five cost-scaled rates cover all twenty-five cells. Add this section to `docs/financial-model/test-cases.md`:

```markdown
### Fixture K — sensitivity suite (spec §12, calc 2.4.0)

Base document: Fixture F (`f-dev-finance-12mo`). Config: the §12.3/§12.4 defaults.

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

Timeline lever on `term_months` 12: −3 → 9, +3 → 15.
Interest-rate lever on 8.0%: −1.0 → 7.0, +1.0 → 9.0.

**Base cell.** Identical to Fixture F's `expected_metrics` (§12.5), reused verbatim
rather than re-derived: profit 23,535,047; profit on cost 24.4%; profit on GDV 19.61%;
IRR 91.2%; LTGDV (developer) 48.84%; peak debt 58,604,953.

**Corner cells.** [DERIVE THESE — see Step 2. Record the full worksheet here, in the
same style as Fixture F's derivation earlier in this document: GDV, each cost line,
cost before finance, the monthly interest roll-up, finance costs, TDC, profit, and each
reported percentage.]

**Tornado spans.** [DERIVE THESE — see Step 3.]
```

- [ ] **Step 2: Derive the two corner cells by hand**

The two corners are the ends of the grid's diagonal:

- **Worst corner** — row `construction_cost +15%`, column `gdv −15%`. Derived inputs: unit value 25,500,000 (GDV 102,000,000), cost/sqm 115,000 (construction cost 50,600,000). Everything else is Fixture F's.
- **Best corner** — row `construction_cost −5%`, column `gdv +5%`. Derived inputs: unit value 31,500,000 (GDV 126,000,000), cost/sqm 95,000 (construction cost 41,800,000).

Work each one through on the same worksheet Fixture F used: acquisition cost and SDLT (unchanged), construction cost (above), professional fees and statutory costs (unchanged), selling costs (`1.5% × GDV + 400,000`), cost before finance, the rolled-up monthly interest ledger over the 12-month term against the committed facility, finance costs, TDC, profit, profit on cost, profit on GDV, LTGDV (developer), IRR and peak debt. Note whether the worst corner's peak debt exceeds `committed_net_facility_pence` (60,000,000) — if it does, `facility_exceeded` belongs in its flag list, and that is the finding §12.2 exists to surface.

**Do not read these numbers off the engine.** If your hand figure and the engine disagree, the disagreement is the point of the fixture: work out which is wrong before changing either. Record the completed worksheet in `test-cases.md` where Step 1 left the placeholder.

- [ ] **Step 3: Derive the four tornado spans by hand**

Each bar needs two more appraisals, single-lever:

| lever | low document | high document |
|---|---|---|
| `gdv` | unit value 27,000,000 (GDV 108,000,000) | unit value 33,000,000 (GDV 132,000,000) |
| `construction_cost` | cost/sqm 90,000 (construction 39,600,000) | cost/sqm 110,000 (construction 48,400,000) |
| `timeline` | `term_months` 9 | `term_months` 15 |
| `interest_rate` | rate 7.0% | rate 9.0% |

Derive each endpoint's profit on the worksheet, then `span = |profit(high) − profit(low)|`. Sort the four spans descending, breaking ties with the §12.4 lever order, and record both the spans and the resulting lever sequence. Replace the Step 1 placeholder.

- [ ] **Step 4: Write the fixture file**

Create `fixtures/financial-model/k-sensitivity.json`. It carries no `inputs` of its own — it names its base fixture instead, so Fixture F's document cannot drift away from the sensitivity contract built on it.

```json
{
  "name": "K — sensitivity suite over Fixture F",
  "kind": "sensitivity",
  "base_fixture": "f-dev-finance-12mo",
  "config": {
    "rows": { "lever": "construction_cost", "steps": [-5, 0, 5, 10, 15] },
    "cols": { "lever": "gdv", "steps": [-15, -10, -5, 0, 5] },
    "tornado": [
      { "lever": "gdv", "low": -10, "high": 10 },
      { "lever": "construction_cost", "low": -10, "high": 10 },
      { "lever": "timeline", "low": -3, "high": 3 },
      { "lever": "interest_rate", "low": -1, "high": 1 }
    ]
  },
  "expected_derived_inputs": {
    "gdv": {
      "-15": 25500000, "-10": 27000000, "-5": 28500000,
      "0": 30000000, "5": 31500000, "10": 33000000
    },
    "construction_cost": {
      "-10": 90000, "-5": 95000, "0": 100000,
      "5": 105000, "10": 110000, "15": 115000
    },
    "timeline": { "-3": 9, "3": 15 },
    "interest_rate": { "-1": 7.0, "1": 9.0 }
  },
  "expected_base": {
    "profit_pence": 23535047,
    "profit_on_cost_pct": 24.4,
    "profit_on_gdv_pct": 19.61,
    "irr_annual_pct": 91.2,
    "ltgdv_developer_pct": 48.84,
    "peak_debt_pence": 58604953
  },
  "expected_corner_cells": [
    { "row_step": 15, "col_step": -15, "__derive__": "worst corner — fill from test-cases.md Step 2" },
    { "row_step": -5, "col_step": 5, "__derive__": "best corner — fill from test-cases.md Step 2" }
  ],
  "expected_tornado_order": ["__derive__ — fill from test-cases.md Step 3"],
  "expected_tornado_spans_pence": { "__derive__": "fill from test-cases.md Step 3" }
}
```

Replace every `__derive__` marker with the hand-derived values from Steps 2 and 3. The corner cells take the same six keys as `expected_base` plus a `flags` array. `expected_tornado_order` is a list of lever names; `expected_tornado_spans_pence` maps lever name to integer pence. **A `__derive__` marker left in the committed file is a failed task.**

- [ ] **Step 5: Teach the TS golden-fixture harness about the new kind**

In `frontend/src/lib/model/golden-fixtures.test.ts`:

1. Add `'sensitivity'` to the `kind` union on the `Fixture` interface, with a comment matching the existing ones: `// 'sensitivity' marks the R4 suite fixture (spec §12, calc 2.4.0) — k-sensitivity.json. Unlike every other kind it carries no `inputs` of its own, naming a `base_fixture` instead, so it is excluded from the runAppraisal loop below and asserted by its own describe block.`
2. Add `'k-sensitivity'` to `EXPECTED_FIXTURE_STEMS`.
3. Filter it out of the main assertion loop. Where the loop iterates `fixtures`, change the source to `fixtures.filter((f) => f.kind !== 'sensitivity')`.

Then add a dedicated describe block at the end of the file:

```ts
describe('Fixture K — sensitivity suite (spec §12)', () => {
  interface SensitivityFixture {
    name: string;
    kind: 'sensitivity';
    base_fixture: string;
    config: SensitivityConfig;
    expected_derived_inputs: Record<string, Record<string, number>>;
    expected_base: Record<string, number>;
    expected_corner_cells: Array<Record<string, number | string[]>>;
    expected_tornado_order: string[];
    expected_tornado_spans_pence: Record<string, number>;
  }

  const k = JSON.parse(
    readFileSync(join(FIXTURE_DIR, 'k-sensitivity.json'), 'utf-8'),
  ) as SensitivityFixture;

  const baseInputs = JSON.parse(
    readFileSync(join(FIXTURE_DIR, `${k.base_fixture}.json`), 'utf-8'),
  ).inputs as AnyCalculatorInputs;

  const result = runSensitivity(baseInputs, k.config);

  // Hand-derived: the per-axis derived inputs (§12.1 disjointness makes these per axis,
  // not per cell). A lever-composition bug shows up here first.
  it('applies each lever to the hand-derived value', () => {
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.gdv)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: Number(step),
        construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      });
      expect(levered.unit_mix.units.every((u) => u.estimated_value_pence === expected)).toBe(true);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.construction_cost)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: Number(step), timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      });
      expect(levered.conversion_costs.construction_cost_per_sqm_pence).toBe(expected);
    }
  });

  // Hand-derived: reused verbatim from Fixture F (§12.5).
  it('reports the hand-derived base case', () => {
    for (const [key, expected] of Object.entries(k.expected_base)) {
      expect(result.base[key as keyof typeof result.base]).toBe(expected);
    }
  });

  // Hand-derived: two corners worked through on a worksheet.
  it('reports the hand-derived corner cells', () => {
    for (const corner of k.expected_corner_cells) {
      const cell = result.matrix
        .flat()
        .find((c) => c.row_step === corner.row_step && c.col_step === corner.col_step);
      expect(cell, `corner ${corner.row_step}/${corner.col_step}`).toBeDefined();
      const found = cell as unknown as Record<string, unknown>;
      for (const [key, expected] of Object.entries(corner)) {
        if (key === 'row_step' || key === 'col_step') continue;
        expect(found[key], `corner ${corner.row_step}/${corner.col_step} → ${key}`).toEqual(expected);
      }
    }
  });

  // Hand-derived: spans and the resulting order.
  it('reports the hand-derived tornado spans and order', () => {
    expect(result.tornado.map((b) => b.lever)).toEqual(k.expected_tornado_order);
    for (const bar of result.tornado) {
      expect(bar.span_pence).toBe(k.expected_tornado_spans_pence[bar.lever]);
    }
  });

  // Identity-asserted, not snapshotted: §12.3 *defines* a cell as this expression, so
  // the assertion is the contract. Wrong composition or enumeration is already caught
  // by the hand-derived derived-inputs and corners above.
  it('defines every remaining cell as the levered appraisal (spec §12.3)', () => {
    result.config.rows.steps.forEach((rowStep, ri) => {
      result.config.cols.steps.forEach((colStep, ci) => {
        const expected = runAppraisal(applyScenario(baseInputs, {
          label: '',
          gdv_adjustment_pct: colStep,
          construction_cost_adjustment_pct: rowStep,
          timeline_adjustment_months: 0,
          interest_rate_adjustment_pct: 0,
        })).metrics;
        const cell = result.matrix[ri][ci];
        expect(cell.profit_pence).toBe(expected.profit_pence);
        expect(cell.profit_on_cost_pct).toBe(expected.profit_on_cost_pct);
        expect(cell.ltgdv_developer_pct).toBe(expected.ltgdv_developer_pct);
        expect(cell.peak_debt_pence).toBe(expected.peak_debt_pence);
        expect(cell.flags).toEqual(expected.flags.map((f) => f.code));
      });
    });
  });
});
```

Add the imports this block needs to the top of the file: `runSensitivity` and `SensitivityConfig` from `./sensitivity`, and `applyScenario` from `./apply-scenario`.

- [ ] **Step 6: Mirror the harness change into Python**

In `tests/test_financial_model_fixtures.py`:

1. Add `"k-sensitivity"` to `EXPECTED_FIXTURE_STEMS`.
2. Exclude it from the main `run_appraisal` parametrisation — it has no `inputs` key. Find where `FIXTURES` feeds the parametrised test and filter on the loaded JSON's `kind != "sensitivity"`.
3. Add a test module section mirroring the TS describe block above, with the same five tests, the same hand-derived expectations read from the same JSON, and the same identity assertion using `apply_scenario` + `run_appraisal`.

Keep the comments explaining *which* assertions are hand-derived and which are identity-asserted — the distinction is the point, and a future reader must not mistake the identity assertions for snapshots.

- [ ] **Step 7: Record the exception in the governance document**

Add to `docs/financial-model/model-governance.md`, inside §2 after the existing three numbered steps:

```markdown
### 2.1 Recorded exception — Fixture K's derivation split (R4, 2026-08-16)

Fixture K (`k-sensitivity.json`, spec §12) does not hand-derive all thirty-four of its
appraisals. Read literally, §2 step 2 would require that; it is disproportionate, and it
is not what the rule protects.

What §12 adds over the existing engine is **composition, not new arithmetic** — lever
application, grid enumeration and ordering, the reduction to the compact record, and the
tornado span-and-sort. Fixture K therefore hand-derives:

- every derived input, per axis (§12.1's disjointness makes these per axis, not per cell);
- the base cell, reused verbatim from Fixture F;
- two corner cells, worked through on a worksheet the way Fixture F was;
- every tornado span and the resulting order.

and *identity-asserts* the remaining cells against
`runAppraisal(applyScenario(base, overrides))` — the expression §12.3 defines a cell as.
That assertion is the contract itself, not a snapshot: a wrong cell can only come from
wrong lever composition or wrong enumeration, and the hand-derived items above pin both.

This exception was put to the product owner and approved during the Release 4
brainstorming session; see `docs/superpowers/specs/2026-08-16-release-4-design.md` §4.
It licenses no other fixture: a change to appraisal *arithmetic* still hand-derives in
full.
```

- [ ] **Step 8: Run both harnesses**

Run, from `frontend/`: `npm test -- golden-fixtures`
Expected: PASS, including the five new Fixture K tests.

Run: `pytest tests/test_financial_model_fixtures.py -v`
Expected: PASS, including the mirrored Fixture K tests.

- [ ] **Step 9: Verify no placeholder survived**

Run: `grep -rn "__derive__\|DERIVE THESE" fixtures/ docs/financial-model/`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add fixtures/financial-model/k-sensitivity.json frontend/src/lib/model/golden-fixtures.test.ts tests/test_financial_model_fixtures.py docs/financial-model/test-cases.md docs/financial-model/model-governance.md
git commit -m "$(cat <<'EOF'
test(model): Fixture K pins the sensitivity suite in both engines

Hand-derives the per-axis derived inputs, the base cell (reused from
Fixture F), two worksheet corners and every tornado span; identity-asserts
the remaining cells against the expression §12.3 defines a cell as.

That split is recorded in governance §2.1 as a named, approved exception
with its reasoning, so the departure sits next to the rule it bends rather
than being discovered later in a fixture file.

Fixture K names a base_fixture instead of carrying its own inputs, so
Fixture F's document cannot drift away from the contract built on it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Suite invariants in both engines

**Files:**
- Modify: `frontend/src/lib/model/invariants.test.ts`
- Modify: `tests/test_financial_model_fixtures.py`

**Interfaces:**
- Consumes: `runSensitivity` / `run_sensitivity`; `applyScenario` / `apply_scenario`.
- Produces: nothing new. These are properties, asserted across the fixture corpus rather than against pinned numbers.

Fixture K pins specific values for one document. These invariants assert §12's *properties* hold for every document in the corpus, which is what catches a regression on a deal shaped unlike Fixture F.

- [ ] **Step 1: Write the failing invariants (TypeScript)**

Read the existing `describe('phased-sale / refinance sweep invariants (spec §4.4.1/§4.5, calc 2.3.0)')` block at `frontend/src/lib/model/invariants.test.ts:189` and follow its structure — it already loads the fixture corpus and iterates it. Append:

```ts
describe('sensitivity suite invariants (spec §12, calc 2.4.0)', () => {
  // Every pipeline-shaped fixture in the corpus, not just Fixture F.
  const documents = fixtureInputsCorpus();

  it('reports a base case identical to the unadjusted appraisal (§12.5)', () => {
    for (const inputs of documents) {
      const plain = runAppraisal(inputs).metrics;
      const { base } = runSensitivity(inputs);
      expect(base.profit_pence).toBe(plain.profit_pence);
      expect(base.peak_debt_pence).toBe(plain.peak_debt_pence);
      expect(base.flags).toEqual(plain.flags.map((f) => f.code));
    }
  });

  it('holds the committed facility and equity invariant in every cell (§12.2)', () => {
    for (const inputs of documents) {
      const config = DEFAULT_SENSITIVITY_CONFIG;
      for (const rowStep of config.rows.steps) {
        for (const colStep of config.cols.steps) {
          const levered = applyScenario(inputs, {
            label: '',
            gdv_adjustment_pct: colStep,
            construction_cost_adjustment_pct: rowStep,
            timeline_adjustment_months: 0,
            interest_rate_adjustment_pct: 0,
          });
          expect(levered.finance.committed_net_facility_pence)
            .toBe(inputs.finance.committed_net_facility_pence);
          expect(levered.finance.committed_gross_facility_pence)
            .toBe(inputs.finance.committed_gross_facility_pence);
          expect(levered.finance.day_one_advance_pence)
            .toBe(inputs.finance.day_one_advance_pence);
          expect(levered.equity_sources.map((e) => e.amount_pence))
            .toEqual(inputs.equity_sources.map((e) => e.amount_pence));
        }
      }
    }
  });

  it('sorts the tornado totally and deterministically (§12.4)', () => {
    for (const inputs of documents) {
      const forward = runSensitivity(inputs);
      const shuffled = runSensitivity(inputs, {
        ...DEFAULT_SENSITIVITY_CONFIG,
        tornado: [...DEFAULT_SENSITIVITY_CONFIG.tornado].reverse(),
      });
      expect(shuffled.tornado.map((b) => b.lever)).toEqual(forward.tornado.map((b) => b.lever));
      const spans = forward.tornado.map((b) => b.span_pence);
      expect([...spans].sort((a, b) => b - a)).toEqual(spans);
    }
  });

  it('is reproducible — two runs of one document agree exactly (§1.4)', () => {
    for (const inputs of documents) {
      expect(runSensitivity(inputs)).toEqual(runSensitivity(inputs));
    }
  });
});
```

If `invariants.test.ts` has no existing corpus-loading helper, write `fixtureInputsCorpus()` in that file: read every `fixtures/financial-model/*.json`, skip any whose `kind` is `'sensitivity'` (Fixture K has no `inputs`), and return the `inputs` documents.

- [ ] **Step 2: Run to verify they fail for the right reason, then pass**

Run, from `frontend/`: `npm test -- invariants`
Expected: FAIL first on the missing import (`runSensitivity` is not imported in this file). Add the imports, then re-run.
Expected after imports: PASS. If any invariant genuinely fails, that is a real defect in Task 5 — fix `sensitivity.ts`, not the invariant.

- [ ] **Step 3: Mirror the invariants into Python**

Read the corresponding block in `tests/test_financial_model_fixtures.py` (the Release 3b invariants around line 297) and follow its structure. Add the same four invariants, over the same corpus, with the same section comment naming spec §12 and calc 2.4.0.

Run: `pytest tests/test_financial_model_fixtures.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/model/invariants.test.ts tests/test_financial_model_fixtures.py
git commit -m "$(cat <<'EOF'
test(model): §12 suite invariants across the whole fixture corpus

Fixture K pins numbers for one document; these assert the properties hold
for every document in the corpus — the base-case identity (§12.5), the
facility-and-equity invariance that makes §12.2 constructive rather than
merely prohibited, the total tornado ordering (§12.4), and reproducibility
(§1.4).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Calc version bump to 2.4.0 and full gate run

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts:341`
- Modify: `app/financial_model/types.py:383`
- Modify: `frontend/src/lib/safe-run.test.ts:12`
- Modify: `tests/test_appraisal_governance.py:159,168,299`
- Modify: `docs/financial-model/model-governance.md` (the version stated in its status header)

**Interfaces:**
- Consumes: everything above.
- Produces: `CALC_VERSION === '2.4.0'` in both engines — the value R4b and every stored appraisal will carry.

- [ ] **Step 1: Find every live reference**

Run: `grep -rn "2\.3\.0" --include=*.ts --include=*.tsx --include=*.py frontend/src app tests`

The output separates into two kinds, and only the first kind changes:

- **Live values and assertions** — `finance-types.ts:341`, `types.py:383`, `safe-run.test.ts:12`, `test_appraisal_governance.py:159/168/299`.
- **Historical comments** — everything else. Lines like `// spec §4.4.1 (calc 2.3.0), Release 3b` record *when a feature was introduced*. Changing them would falsify the history. Leave every one of them alone.

- [ ] **Step 2: Bump the two constants**

In `frontend/src/lib/model/finance-types.ts`:

```ts
export const CALC_VERSION = '2.4.0';
```

In `app/financial_model/types.py`:

```python
CALC_VERSION = "2.4.0"
```

- [ ] **Step 3: Update the four assertions**

In `frontend/src/lib/safe-run.test.ts:12`, change `expect(result.run.metrics.calc_version).toBe('2.3.0');` to `'2.4.0'`.

In `tests/test_appraisal_governance.py`, change all three `== "2.3.0"` assertions (lines 159, 168, 299) to `== "2.4.0"`. Also update the docstring at line 132 that says "calc_version 2.3.0" — that one describes what the test asserts *now*, not history, so it must track the bump.

- [ ] **Step 4: Update the governance document's status header**

`docs/financial-model/model-governance.md` opens with a status line naming the calc version it governs. Change `2.3.0` to `2.4.0` there, and in §3's "Currently `"2.3.0"`" statement. Leave §2.1 (added in Task 7) and any historical mention untouched.

Run: `grep -n "2\.3\.0\|2\.4\.0" docs/financial-model/model-governance.md`
Expected: no `2.3.0` remains except where it names a past release's feature.

- [ ] **Step 5: Run every gate**

Run, from `frontend/`: `npm test`
Expected: PASS. Record the total count — it should exceed R3b's 740 by the tests added in Tasks 3–8.

Run, from the repo root: `pytest`
Expected: PASS. R3b's baseline was 688.

Run, from `frontend/`: `npx tsc -b`
Expected: clean, no output.

Run, from `frontend/`: `npx eslint .`
Expected: clean.

Run, from `frontend/`: `npm run build`
Expected: succeeds.

If any gate fails, fix the cause. Do not proceed with a failing gate and do not describe the work as complete.

- [ ] **Step 6: Confirm the memo is untouched**

R4a changes no user-visible output. Verify:

Run: `git diff --stat main -- frontend/src/lib/export-investment-memo.ts frontend/src/components/`
Expected: only the `applyScenario` import-path line from Task 2. Any other change belongs in R4b, not here.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/model/finance-types.ts app/financial_model/types.py frontend/src/lib/safe-run.test.ts tests/test_appraisal_governance.py docs/financial-model/model-governance.md
git commit -m "$(cat <<'EOF'
chore(model): bump calc version to 2.4.0

Spec §12 adds a derived analysis surface; no existing output changes, so
this is a minor bump. Bumped last, so no mid-branch commit claimed a
version whose feature did not yet exist.

Only live values and assertions move. Comments recording which release
introduced an existing feature keep their original version — those are
history, not the current version.

Gates: vitest, pytest, tsc -b, eslint, build.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Definition of done for R4a

- [ ] Spec §12 exists and §11.8 cross-references §12.2.
- [ ] `applyScenario` lives in `frontend/src/lib/model/` with a Python twin at `app/financial_model/apply_scenario.py`.
- [ ] `runSensitivity` / `run_sensitivity` exist, mirrored file-for-file, with no import cycle in either language.
- [ ] Fixture K is committed with zero `__derive__` markers, and its derivations are recorded in `test-cases.md`.
- [ ] Governance §2.1 records the derivation exception.
- [ ] The §12 invariants run over the whole fixture corpus in both languages.
- [ ] `CALC_VERSION` is `2.4.0` in both engines.
- [ ] All five gates pass.
- [ ] `export-investment-memo.ts` and every component are unchanged apart from one import path — the memo refactor is R4b's work.
