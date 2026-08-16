# Release 4 design — fixed-facility sensitivity suite

Date: 2026-08-16. Status: approved in brainstorming session. Extends
`docs/financial-model/calculation-specification.md` (calc 2.3.0 → 2.4.0) under the
governance rules in `docs/financial-model/model-governance.md`.

## 1. Scope and versioning

Release 4 delivers the **fixed-facility sensitivity suite** — the last item of the
audit's Phase 1, and the last financial surface in the product that is neither
specified nor engine-owned.

### 1.1 The problem being fixed

The two-way sensitivity matrices a lender actually reads exist in exactly one place:
`frontend/src/lib/export-investment-memo.ts` (§10, "Sensitivity & Downside"). That
code hardcodes the grid steps (`gdvSteps = [-15,-10,-5,0,5]`,
`costSteps = [-5,0,5,10,15]`), the amber/red colouring thresholds and the FE/FG/NR
flag policy. The calculation specification has **no section covering scenarios or
sensitivities at all** — §11.8 only *prohibits* re-sizing debt inside one. There is
no engine surface, no fixture, no Python mirror and no UI: `ScenariosPage` shows the
three named scenarios and no matrix.

Consequently the analysis is untestable against a contract, invisible outside the PDF,
and free to drift from the named-scenario code that shares its lever arithmetic.

### 1.2 Sub-releases

Two mergeable sub-releases, mirroring the R2 and R3 rhythm:

- **R4a — sensitivity engine (calc 2.4.0).** Spec §12, `sensitivity.ts` +
  `sensitivity.py`, Fixture K, new invariants. No UI or memo change; nothing
  user-visible moves.
- **R4b — UI + memo.** Sensitivity page (calculator page 9), memo §10 refactored to
  consume the engine result, live browser UAT.

Minor bump, not major: no existing output changes. The memo's printed numbers are
identical before and after, and that is asserted (§5.2).

### 1.3 Explicitly out of scope

Deferred to R5+, unchanged from the R3 backlog: pari-passu draw rule, VAT modelling,
developer/lender mode split, exit-fee band holdback refinement, equity `timing_month`
enforcement, parking/external-space valuation, unit-level sales tranches and lender
release pricing, residual-price fixed-point refinement.

Also out of scope, considered and rejected during brainstorming:

- **A threshold search / covenant solver** (the exact single-lever move at which senior
  non-repayment or facility exhaustion begins). Would need a bisection solver per
  covenant plus its fixture work. The matrix flag codes already show *where* covenants
  break within the grid; the exact crossing point is a legitimate R5 item.
- **Persisted per-appraisal sensitivity config** (an inputs v5). Rejected in favour of
  spec-fixed defaults plus ephemeral UI overrides (§2.3, §5.1) — this costs no inputs
  version, no v4→v5 migration, no migration fixtures, and keeps every appraisal's memo
  directly comparable.

## 2. Specification — new §12 "Sensitivity analysis [R4 — calc 2.4.0]"

§12 becomes the normative home for both sensitivities and the three named scenarios.

### 2.1 Shared lever application

Sensitivity cells and the named scenarios apply levers through **one rule** — today's
`applyScenario` (`frontend/src/lib/apply-scenario.ts`), promoted to a specified
operation:

| Lever | Unit | Effect |
|---|---|---|
| `gdv` | percent | scales every `unit_mix.units[].estimated_value_pence` |
| `construction_cost` | percent | scales `conversion_costs.construction_cost_per_sqm_pence` |
| `timeline` | months | adds to `finance.term_months` |
| `interest_rate` | percentage points | adds to `finance.annual_interest_rate_pct` |

Scaling uses the existing round-half-up convention (§1.1). The four levers touch
**disjoint input fields**, so composition is order-independent; §12 states this
explicitly so that a future lever cannot quietly break the property. Any lever added
later that shares a field with an existing one must define its composition order in
§12 at the same time.

### 2.2 The facility is invariant (§11.8 made constructive)

In every cell and every tornado endpoint, `committed_net_facility_pence`,
`committed_gross_facility_pence`, `day_one_advance_pence` and `equity_sources` are held
at their base values. §11.8 currently states this only as a prohibition; §12 states it
as a construction rule and it becomes an asserted invariant (§3.3).

A cell that would require more debt does not get more debt — it raises
`facility_exceeded` and/or `funding_gap`, **and that is the finding**. This is the
entire point of a *fixed-facility* suite: it measures the committed structure against
adverse assumptions rather than silently re-underwriting the deal at every grid point.

### 2.3 Normative defaults

- **Matrix.** Rows = `construction_cost` at `[-5, 0, +5, +10, +15]` %; columns = `gdv`
  at `[-15, -10, -5, 0, +5]` %. These are today's memo grid steps, promoted from a
  hardcoded exporter constant to a specified one, so the memo's output is unchanged.
- **Tornado.** Two-sided symmetric: `gdv` ±10 %, `construction_cost` ±10 %,
  `timeline` ±3 months, `interest_rate` ±1.0 percentage points. Each bar spans the two
  resulting profits.
- **Ordering.** Bars sort by span descending. Ties break by the fixed lever order
  `gdv, construction_cost, timeline, interest_rate`, so §1.4 determinism holds and the
  sort is total.

### 2.4 The base case is a cell

The `(row_step = 0, col_step = 0)` cell must equal the unadjusted appraisal exactly.
Stated in §12 as an identity and asserted in both engines (§3.3).

## 3. R4a — engine

### 3.1 Modules

New paired modules alongside `breakeven` and `cost-to-complete`, following the
file-for-file mirror rule in governance §1:

- `frontend/src/lib/model/sensitivity.ts`
- `app/financial_model/sensitivity.py`

Entry point:

```ts
runSensitivity(inputs: AnyCalculatorInputs, config?: SensitivityConfig): SensitivityResult
```

### 3.2 Types

```ts
type SensitivityLever = 'gdv' | 'construction_cost' | 'timeline' | 'interest_rate';

interface SensitivityAxis {
  lever: SensitivityLever;
  steps: number[];            // lever-native units: percent, percent, months, percentage points
}

interface TornadoRange { lever: SensitivityLever; low: number; high: number; }

interface SensitivityConfig {
  rows: SensitivityAxis;      // default { lever: 'construction_cost', steps: [-5,0,5,10,15] }
  cols: SensitivityAxis;      // default { lever: 'gdv',               steps: [-15,-10,-5,0,5] }
  tornado: TornadoRange[];    // default the four ranges of §2.3
}

interface SensitivityCell {
  row_step: number;
  col_step: number;
  profit_pence: number;
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  irr_annual_pct: number | null;
  ltgdv_developer_pct: number | null;
  peak_debt_pence: number;
  flags: FlagCode[];
}

interface TornadoBar {
  lever: SensitivityLever;
  low_step: number;
  high_step: number;
  low: SensitivityCell;
  high: SensitivityCell;
  span_pence: number;         // |high.profit_pence - low.profit_pence|
}

interface SensitivityResult {
  base: SensitivityCell;
  matrix: SensitivityCell[][];   // matrix[rowIndex][colIndex]
  tornado: TornadoBar[];         // sorted per §2.3
  config: SensitivityConfig;     // the *resolved* config, echoed back
}
```

Three deliberate shape decisions:

- **Percentage fields are `number | null`**, matching `AppraisalMetrics`. A zero-cost
  or unrealised-profit cell already yields null there; the suite must not invent a
  number the engine declined to produce.
- **`flags` carries the full `FlagCode[]`.** The memo's three-code shorthand
  (FE / FG / NR) is a *presentation* mapping that stays in the exporter, not an engine
  concept.
- **`config` is echoed back** so a report can print the ranges actually used rather
  than assuming the defaults — this is what makes the ephemeral UI overrides safe.

### 3.3 Behaviour, validation and invariants

Each cell is one full `runAppraisal` over `applyScenario(inputs, overrides)`, reduced to
the compact record. Tornado endpoints are computed the same way, one lever at a time.

Validation (input errors, not flags):

- every axis `steps` array non-empty, all entries finite;
- at most 9 steps per axis (bounds the work at 81 cells);
- `rows.lever !== cols.lever`;
- `tornado` levers unique; `low < high` for each range.

New invariants in `invariants.test.ts` and the Python mirror:

1. `result.base` equals `runAppraisal(inputs)` reduced — the §2.4 identity.
2. The facility and equity inputs are identical in every cell's derived inputs — the
   §2.2 constructive form of §11.8.
3. The tornado sort is total and deterministic under shuffled input order.
4. Config validation rejects duplicate axis levers and out-of-bounds step counts.

### 3.4 Cost

25 matrix + 8 tornado + 1 base = 34 appraisal runs per suite. The memo already
performs 28 (25 grid + 3 scenarios), so this is not a new order of magnitude. The UI
page memoises on the inputs object rather than recomputing per keystroke (§5.1).

## 4. R4a — Fixture K, and one deliberate departure from governance §2

### 4.1 The departure, stated plainly

Governance §2 requires fixture numbers be hand-derived and never "whatever the code
produces". Read literally, Fixture K would mean hand-deriving 34 complete appraisals on
worksheets. That is disproportionate, and it is not what the rule protects.

What §12 adds over the existing engine is **composition, not new arithmetic**: lever
application, grid enumeration and ordering, the reduction to the compact record, and
the tornado span-and-sort. Fixture K therefore splits its assertions by kind. **This
split was put to the user during brainstorming and approved**; it is recorded here so
it is a decision on the record, not an interpretation made in passing.

### 4.2 The split

Fixture K (`fixtures/financial-model/k-sensitivity.json`) is built over Fixture F
(`f-dev-finance-12mo`) — chosen because it carries real debt, so downside cells
genuinely trip `facility_exceeded` rather than exercising an all-cash path.

**Hand-derived (worksheet, recorded in `docs/financial-model/test-cases.md`):**

- every cell's *derived inputs* — the scaled unit values and scaled cost per sqm.
  These are multiplication plus round-half-up, cheap to verify by hand, and they are
  where a lever-composition bug would show up;
- the base cell's full outputs, reused verbatim from Fixture F's existing derivation;
- two corner cells' full outputs, derived on a worksheet the way Fixture F was;
- every tornado span and the resulting sort order, computed from the pinned cell
  profits.

**Identity-asserted (not snapshotted):**

- the remaining cells must equal `runAppraisal(applyScenario(base, overrides))`.

This is not a snapshot test in disguise. §12 *defines* a cell as exactly that
expression, so the assertion is the contract itself. A wrong cell can only arise from
wrong lever composition or wrong grid enumeration — and the hand-derived derived-inputs
and corner cells already pin both.

Both engines are held to Fixture K, per the golden-fixture parity gate
(governance §6.3).

## 5. R4b — UI and memo

### 5.1 Sensitivity page (calculator page 9)

Inserted into `PAGES` in `ConversionCalculator.tsx` directly after Scenarios,
renumbering Exit → 10, Risk → 11, Deal Spider → 12, Investor → 13. New `CalcPage` key
`sensitivity`; new `frontend/src/components/calculator/SensitivityPage.tsx`.

Three regions:

1. **Tornado** — horizontal bars, sorted per §2.3, with base profit as the centre line.
2. **Two-way matrix** — with a metric selector over the six compact-record fields.
   Cells show their flag codes and the existing red/amber conventions.
3. **Axis and step editor** — mutates **view state only**. It never writes `inputs`,
   never triggers autosave, and is not persisted. Reloading the page returns the spec
   defaults.

Computed via `useMemo` keyed on the inputs object. Inline styles throughout, matching
every other calculator page (the codebase has zero Tailwind classNames by convention).

The page renders under `CalculatorErrorBoundary` like its siblings. Note the known
open item from R3: `runAppraisal` is called in `ConversionCalculator`'s own render body,
which the boundary cannot catch — `runSensitivity` is called inside the page component,
i.e. *under* the boundary, so it does not widen that exposure.

### 5.2 Investment memo §10

`export-investment-memo.ts` drops its own grid loop and its `gdvSteps` / `costSteps`
constants and calls `runSensitivity(inputs)` with defaults. `flagShortCodes` stays,
as the FE/FG/NR presentation mapping. The tornado joins §10 as a third table, printed
above the two matrices.

**Hard regression invariant:** every number in the two existing matrices is unchanged
from calc 2.3.0 output. Identical by construction (same lever rule, same steps, same
metric fields), and asserted directly in `export-investment-memo.test.ts` against
values captured from the pre-refactor build, so the refactor cannot drift.

The Scenario Comparison table and the named-scenario behaviour are untouched.

### 5.3 UAT

Live browser UAT per the R3b pattern, screenshots recorded in
`docs/reviews/2026-08-16-release-4b-uat.md`. Run
`docker restart commercial-resi-analyser-frontend-1` first — the frontend container
serves a stale Vite module graph after a merge because Windows bind mounts do not
propagate inotify.

## 6. Gates

Per sub-release: vitest, pytest, `tsc -b`, eslint, build.

`tsc --noEmit` is inert in this repo — `tsconfig.json` has `"files": []` with project
references, so only `tsc -b` checks anything. Do not substitute it.

## 7. Documentation changes

- `docs/financial-model/calculation-specification.md` — new §12; bump calc version to
  2.4.0; §11.8 gains a cross-reference to §12.2.
- `docs/financial-model/model-governance.md` — calc version bump; record the Fixture K
  derivation split of §4 under §2 as a named, approved exception with its reasoning.
- `docs/financial-model/test-cases.md` — Fixture K hand derivations.
- `CALC_VERSION` in `app/financial_model/types.py` and its TS mirror in
  `frontend/src/lib/model/finance-types.ts`.
