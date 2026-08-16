# Release 5 — Sensitivity Cell Validity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a sensitivity position that fails validation report *that*, with null metrics, instead of reporting numbers the engine already knows are meaningless.

**Architecture:** `runSensitivity` currently reduces every position to a compact record built from `runAppraisal(...).metrics`, discarding `run.validation`. Spec §12.7 makes validity part of the record: the levered document is validated *first*, and a document with any error-severity issue is never handed to the ledger at all. The two non-nullable metric fields widen to `number | null`, which is the enforcement mechanism — every TypeScript consumer stops compiling until it handles the null.

**Tech Stack:** TypeScript + vitest (interactive engine + UI), Python 3.11 + pytest (authoritative engine), shared JSON golden fixtures in `fixtures/financial-model/`.

## Global Constraints

- **Spec source of truth:** `docs/financial-model/calculation-specification.md`. Governance: `docs/financial-model/model-governance.md`. Design: `docs/superpowers/specs/2026-08-16-release-5-design.md`.
- **Formula-change order (governance §2), non-negotiable:** the spec is edited first, fixtures carry a recorded hand derivation, and **both engines are updated within this one branch** — never merged with one language lagging.
- **Money is integer pence.** Percentages are floats where `70.0` means 70%. Rounding is round-half-up (spec §1.1).
- **Calc version target is `2.5.0`.** Bumped in the final task only, so no mid-branch commit mislabels itself.
- **No existing fixture *expected value* may change.** Fixture K's thirty-four appraisals all remain valid (12-month base, ±3 timeline → 9–15 months). If an expected value in a fixture JSON moves, stop and report — the rule is firing where it should not.
- **But two fixtures DO change behaviour, intentionally.** Verified against the current build: with the *default* config, fixtures **I (`i-phased-sales`)** and **J (`j-blended-refinance`)** each have one position that already carries an error-severity issue — the tornado's `timeline` **low** endpoint. Shortening a 12-month programme by 3 months leaves `sales_phasing.tranches[*]` (and J's `refinance`) pointing at months that no longer exist:
  ```
  i-phased-sales:      34 positions, 1 with errors -> torn timeline lo: sales_phasing.tranches[0,1,2]
  j-blended-refinance: 34 positions, 1 with errors -> torn timeline lo: sales_phasing.tranches[0,1], refinance
  ```
  Under §12.7 those bars become unmeasured, so their span goes null and they sort last — and the memo omits them with a note. **This is the rule working, not a regression:** today those endpoints report a profit computed from a document whose sale tranches fall outside the term. No existing test asserts on the tornado for either fixture, so the suite should stay green; if one fails, read it before touching it.
- **All four other golden fixtures (A, F, G, H) have zero positions with errors** under the default config, so the memo's §10 regression pin and Fixture K are untouched.
- **`reconciliation.report_safe` is never a validity signal.** A position raising `facility_exceeded` / `funding_gap` / `senior_outstanding_at_maturity` is a valid measurement and those flags are the finding (§12.2). At `term_months = 1` Fixture F already reports `report_safe = false` from a funding gap — keying off it would mark most of a healthy downside grid unmeasured.
- **Import-cycle rule:** `frontend/src/lib/model/index.ts` must **not** import or re-export `sensitivity`, and `app/financial_model/__init__.py` must **not** import `sensitivity`. Consumers import the module by its own path.
- **`sensitivity-format.ts` and `safe-sensitivity.ts` stay outside `lib/model/`** — that directory mirrors the Python engine file-for-file and must gain no counterpart for them.
- **No Tailwind classNames.** The codebase styles exclusively with inline `style={{...}}` objects.
- **`tsc --noEmit` is inert in this repo** — `tsconfig.json` has `"files": []` with project references. Only `npx tsc -b` checks anything. Never substitute it.
- **Gates:** from `frontend/`: `npx vitest run`, `npx tsc -b`, `npx eslint .`, `npm run build`. From the repo root: `python -m pytest -q`.
- **Baseline suite sizes:** frontend vitest **827**, backend pytest **750**. Both stay green throughout; new tests add to these.
- **Never use `git stash`** — the stash stack is shared (it currently holds exactly one entry; verify unchanged after your task).
- **Branch:** all work commits on `release-5-cell-validity`, cut from `main` at the `docs(spec): Release 5` commit.
- **Commit style:** conventional-commit subject, a body explaining *why*, and the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Historical docs** (`docs/superpowers/plans/*`, `docs/reviews/*`) are point-in-time records — never rewrite them.

---

## File Structure

**Modified:**

- `docs/financial-model/calculation-specification.md` — new §12.7; cross-reference from §12.3; calc version.
- `frontend/src/lib/model/sensitivity.ts` — the record widens, `measure` validates first, tornado spans go nullable, the base case throws.
- `frontend/src/lib/model/sensitivity.test.ts` — unit coverage for the rule.
- `app/financial_model/sensitivity.py` — the Python mirror, field for field.
- `tests/test_financial_model_sensitivity.py` — the Python unit coverage.
- `fixtures/financial-model/k-sensitivity.json` — gains `invalid_case`.
- `frontend/src/lib/model/golden-fixtures.test.ts` / `tests/test_financial_model_fixtures.py` — assert it.
- `frontend/src/lib/export-investment-memo.ts` — memo §10 renders unmeasured positions.
- `frontend/src/components/calculator/SensitivityPage.tsx` — page renders them; its term guard is deleted.
- `frontend/src/lib/sensitivity-format.ts` — `isUnsoundTornadoBar` deleted.
- `docs/financial-model/model-governance.md`, `docs/financial-model/test-cases.md`, `app/financial_model/types.py`, `frontend/src/lib/model/finance-types.ts` — version and derivation records.

**Why no sub-releases:** widening `profit_pence` to `number | null` breaks the memo and the page at compile time the moment it lands, so an engine-only sub-release would leave the tree not building. Task 2 therefore carries the minimum consumer changes needed to keep `tsc -b` green; Task 6 does the richer presentation work.

---

### Task 1: Spec §12.7 — cell validity

**Files:**
- Modify: `docs/financial-model/calculation-specification.md`

**Interfaces:**
- Produces: the normative rule every later task implements. No code.

- [ ] **Step 1: Add §12.7 after §12.6**

Append to the end of section 12:

```markdown
### 12.7 Cell validity [R5 — calc 2.5.0]

A **measurement** is produced only for a levered document that passes validation. Before
measuring, the levered document is validated (§10). If validation yields any
**error**-severity issue, the position is **not measured**: it reports those issues and
every metric field is null.

Warning-severity issues do not invalidate a position.

**Reconciliation status is not a validity signal.** A position raising `facility_exceeded`,
`funding_gap` or `senior_outstanding_at_maturity` is a valid measurement, and those flags
are the finding (§12.2).

This applies identically to matrix cells and tornado endpoints. A tornado bar with an
unmeasured endpoint has no span; §12.4's ordering places bars with no span after all bars
with a span, in the fixed lever order.

If the **base** document yields an error-severity issue, the suite raises an input error
(§12.6) rather than returning a grid: §12.5 makes the base case an identity with the
unadjusted appraisal, so no position in the suite is meaningful.

An unmeasured position is never appraised: the suite validates the levered document and
does not run the ledger for it at all.
```

- [ ] **Step 2: Cross-reference from §12.3**

At the end of §12.3's first paragraph (the one defining a cell as the appraisal resulting from applying the row and column levers), append:

```markdown
A cell whose levered document fails validation is not measured — see §12.7.
```

- [ ] **Step 3: Verify no other section contradicts the new rule**

```bash
grep -n "report_safe\|reconciliation" docs/financial-model/calculation-specification.md | sed -n '1,20p'
```

Expected: no existing sentence claims reconciliation status determines whether a sensitivity position is reported. If one does, stop and report it — the design assumes §12.7 is the first statement on this.

- [ ] **Step 4: Commit**

```bash
git add docs/financial-model/calculation-specification.md
git commit -m "$(cat <<'EOF'
docs(model): spec §12.7 makes cell validity normative

§12.3 defined a cell as an appraisal reduced to the compact record and never
said what a cell is when that appraisal fails validation. The suite has been
reporting metrics for documents the engine already flags as invalid.

Keying the rule off validation rather than reconciliation is load-bearing: a
legal one-month position already reports report_safe = false from a funding
gap, and stress positions raising FE/FG/NR are the entire point of the grid.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: TypeScript engine — the record carries validity

This task widens two fields, which breaks the memo and the page at compile time. It therefore also carries the **minimum** consumer change needed to keep `tsc -b` green. Richer presentation is Task 6 — do not build it here.

**Files:**
- Modify: `frontend/src/lib/model/sensitivity.ts`
- Modify: `frontend/src/lib/model/sensitivity.test.ts`
- Modify: `frontend/src/lib/export-investment-memo.ts` (tornado rows only)
- Modify: `frontend/src/components/calculator/SensitivityPage.tsx` (tornado geometry + cell text only)

**Interfaces:**
- Consumes: `validateInputs` from `./validation` (already exported there at line 41); `ValidationIssue` from `./validation` (already imported by this file).
- Produces:
  ```ts
  export interface SensitivityMetrics {
    profit_pence: number | null;
    profit_on_cost_pct: number | null;
    profit_on_gdv_pct: number | null;
    irr_annual_pct: number | null;
    ltgdv_developer_pct: number | null;
    peak_debt_pence: number | null;
    flags: FlagCode[];
    validation_errors: ValidationIssue[];   // empty ⇔ measured; errors only, never warnings
  }

  /** §12.7 guarantees the base case is measured (the suite throws otherwise), so
   *  consumers need no null check on `result.base`. */
  export type MeasuredMetrics = Omit<SensitivityMetrics, 'profit_pence' | 'peak_debt_pence'> & {
    profit_pence: number;
    peak_debt_pence: number;
  };

  export interface TornadoBar {
    lever: SensitivityLever;
    low_step: number;
    high_step: number;
    low: SensitivityMetrics;
    high: SensitivityMetrics;
    span_pence: number | null;   // null when either endpoint is unmeasured
  }

  export interface SensitivityResult {
    base: MeasuredMetrics;        // narrowed
    matrix: SensitivityCell[][];
    tornado: TornadoBar[];
    config: SensitivityConfig;
  }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/model/sensitivity.test.ts`. The file already loads Fixture F — reuse whatever helper it uses to build base inputs; if it builds them inline, mirror that.

```ts
// ── Release 5: §12.7 cell validity ──
describe('runSensitivity — §12.7 cell validity', () => {
  // A 12-month base: a −12 timeline step empties the term, which validation
  // rejects at error severity ("Term must be a whole number of months, at
  // least 1."). Before R5 the suite clamped to one month and reported numbers.
  it('does not measure a position whose levered document fails validation', () => {
    const config = defaultSensitivityConfig();
    config.rows = { lever: 'timeline', steps: [-12] };
    config.cols = { lever: 'gdv', steps: [0] };
    const cell = runSensitivity(baseInputs(), config).matrix[0][0];

    expect(cell.validation_errors.length).toBeGreaterThan(0);
    expect(cell.validation_errors.every((e) => e.severity === 'error')).toBe(true);
    expect(cell.validation_errors.some((e) => e.field === 'finance.term_months')).toBe(true);
    expect(cell.profit_pence).toBeNull();
    expect(cell.peak_debt_pence).toBeNull();
    expect(cell.profit_on_cost_pct).toBeNull();
    expect(cell.profit_on_gdv_pct).toBeNull();
    expect(cell.irr_annual_pct).toBeNull();
    expect(cell.ltgdv_developer_pct).toBeNull();
    expect(cell.flags).toEqual([]);
  });

  // The boundary, from the measured side. −11 leaves exactly one month, which
  // is legal, so it must still be a real measurement.
  it('measures a position that leaves exactly one month of term', () => {
    const config = defaultSensitivityConfig();
    config.rows = { lever: 'timeline', steps: [-11] };
    config.cols = { lever: 'gdv', steps: [0] };
    const cell = runSensitivity(baseInputs(), config).matrix[0][0];

    expect(cell.validation_errors).toEqual([]);
    expect(cell.profit_pence).not.toBeNull();
  });

  // Warnings must not invalidate: Fixture F carries one on
  // conversion_costs.total_construction_sqm, and every cell of the default
  // grid inherits it.
  it('treats a warning-carrying document as measured', () => {
    const result = runSensitivity(baseInputs());
    for (const cell of result.matrix.flat()) {
      expect(cell.validation_errors).toEqual([]);
      expect(cell.profit_pence).not.toBeNull();
    }
  });

  // §12.2: a stress cell raising a covenant flag is a valid measurement, and
  // the flag is the finding. Keying validity off reconciliation would break this.
  it('measures a flagged cell rather than treating the flag as invalidity', () => {
    const result = runSensitivity(baseInputs());
    const flagged = result.matrix.flat().filter((c) => c.flags.length > 0);
    expect(flagged.length).toBeGreaterThan(0);
    for (const cell of flagged) {
      expect(cell.validation_errors).toEqual([]);
      expect(cell.profit_pence).not.toBeNull();
    }
  });

  it('gives a tornado bar with an unmeasured endpoint a null span', () => {
    const config = defaultSensitivityConfig();
    config.tornado = [
      { lever: 'gdv', low: -10, high: 10 },
      { lever: 'timeline', low: -12, high: 3 },
    ];
    const bars = runSensitivity(baseInputs(), config).tornado;
    const timeline = bars.find((b) => b.lever === 'timeline')!;
    expect(timeline.span_pence).toBeNull();
    expect(timeline.low.validation_errors.length).toBeGreaterThan(0);
    expect(timeline.high.validation_errors).toEqual([]);
  });

  // §12.4: spanless bars sort after every bar with a span, in LEVER_ORDER.
  it('orders spanless bars last', () => {
    const config = defaultSensitivityConfig();
    config.tornado = [
      { lever: 'timeline', low: -12, high: 3 },
      { lever: 'interest_rate', low: -1, high: 1 },
      { lever: 'gdv', low: -10, high: 10 },
    ];
    const bars = runSensitivity(baseInputs(), config).tornado;
    expect(bars[bars.length - 1].lever).toBe('timeline');
    expect(bars[bars.length - 1].span_pence).toBeNull();
    expect(bars.slice(0, -1).every((b) => b.span_pence !== null)).toBe(true);
  });

  // §12.5 makes the base an identity with the unadjusted appraisal, so a suite
  // over an invalid base is meaningless in every position at once.
  it('throws when the base document itself fails validation', () => {
    const bad = fixtureFInputs() as AnyCalculatorInputs & { finance: { term_months: number } };
    bad.finance.term_months = 0;
    expect(() => runSensitivity(bad)).toThrow(/base document/i);
  });

  // The realistic instance, and the reason this rule is not merely about exotic inputs.
  // Fixture I is a phased-sales deal whose tranches sit in months 9–11 of a 12-month
  // programme. The DEFAULT tornado's −3 month endpoint leaves a 9-month term, so those
  // tranches point at months that no longer exist and validation rejects the document.
  // Before R5 that endpoint reported a profit computed from exactly that document.
  it('does not measure the default tornado low endpoint of a phased-sales deal', () => {
    const fixtureI = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../fixtures/financial-model/i-phased-sales.json'), 'utf-8'),
    ).inputs as AnyCalculatorInputs;

    const bars = runSensitivity(fixtureI).tornado;
    const timeline = bars.find((b) => b.lever === 'timeline')!;

    expect(timeline.low.validation_errors.length).toBeGreaterThan(0);
    expect(timeline.low.validation_errors.some((e) => e.field.startsWith('sales_phasing.tranches'))).toBe(true);
    expect(timeline.low.profit_pence).toBeNull();
    expect(timeline.span_pence).toBeNull();
    // §12.4 as extended by §12.7: no span means it sorts last.
    expect(bars[bars.length - 1].lever).toBe('timeline');
    // The high endpoint lengthens the programme, so it stays measured.
    expect(timeline.high.validation_errors).toEqual([]);
  });
});
```

Note the helper name: this file loads Fixture F through **`fixtureFInputs()`** (defined around line 129), not `baseInputs()`. It also has a local `config(overrides)` helper that deep-copies `DEFAULT_SENSITIVITY_CONFIG` — prefer it over calling `defaultSensitivityConfig()` directly, so a test that mutates an axis cannot leak into another. Where the tests above say `const config = defaultSensitivityConfig()`, use `const cfg = config({ rows: {...}, cols: {...} })` in the file's existing idiom instead, and check the file's import list before adding anything.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npx vitest run src/lib/model/sensitivity.test.ts
```

Expected: FAIL — `validation_errors` does not exist on the returned cells.

- [ ] **Step 3: Widen the record and validate first**

In `frontend/src/lib/model/sensitivity.ts`:

Add to the imports at the top:

```ts
import { validateInputs } from './validation';
```

Replace the `SensitivityMetrics` interface with:

```ts
/**
 * The metric reduction of one appraisal (§12.3), or the record of why no appraisal was
 * run (§12.7). `validation_errors` is empty exactly when the position was measured; it
 * carries error-severity issues only, so a measured document that merely raises warnings
 * still reports an empty array.
 *
 * Every metric field is nullable. The four percentages already were — a zero-cost or
 * unrealised-profit run yields null there — and R5 widened the two money fields so that
 * an unmeasured position cannot present a number at all. That widening is the point: a
 * consumer reading `profit_pence` must handle the null, which is what stops a clamped or
 * absent figure being printed as though it were a measurement.
 */
export interface SensitivityMetrics {
  profit_pence: number | null;
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  irr_annual_pct: number | null;
  ltgdv_developer_pct: number | null;
  peak_debt_pence: number | null;
  flags: FlagCode[];
  validation_errors: ValidationIssue[];
}

/**
 * The base case is always measured: `runSensitivity` throws when the base document fails
 * validation (§12.7), so `result.base` needs no null check at its use sites. Cells and
 * tornado endpoints carry the wider `SensitivityMetrics`.
 */
export type MeasuredMetrics = Omit<SensitivityMetrics, 'profit_pence' | 'peak_debt_pence'> & {
  profit_pence: number;
  peak_debt_pence: number;
};
```

Change `TornadoBar.span_pence` to `number | null`, updating its doc comment:

```ts
  /** |profit(high) − profit(low)| (§12.4), or null when either endpoint is unmeasured. */
  span_pence: number | null;
```

Change `SensitivityResult.base` to `MeasuredMetrics`.

Replace `measure` with:

```ts
/** The record of a position that was not measured (§12.7). */
function unmeasured(errors: ValidationIssue[]): SensitivityMetrics {
  return {
    profit_pence: null,
    profit_on_cost_pct: null,
    profit_on_gdv_pct: null,
    irr_annual_pct: null,
    ltgdv_developer_pct: null,
    peak_debt_pence: null,
    flags: [],
    validation_errors: errors,
  };
}

/**
 * One position: the levered document is validated first (§12.7), and only a document that
 * passes is appraised. An unmeasured position never reaches the ledger, so the suite does
 * not depend on `buildSchedule`'s defensive term clamp holding.
 */
function measure(inputs: AnyCalculatorInputs, levers: Partial<Record<SensitivityLever, number>>): SensitivityMetrics {
  const levered = applyScenario(inputs, overridesFor(levers));
  const errors = validateInputs(levered).filter((i) => i.severity === 'error');
  if (errors.length > 0) return unmeasured(errors);

  const m = runAppraisal(levered).metrics;
  return {
    profit_pence: m.profit_pence,
    profit_on_cost_pct: m.profit_on_cost_pct,
    profit_on_gdv_pct: m.profit_on_gdv_pct,
    irr_annual_pct: m.irr_annual_pct,
    ltgdv_developer_pct: m.ltgdv_developer_pct,
    peak_debt_pence: m.peak_debt_pence,
    flags: m.flags.map((f) => f.code),
    validation_errors: [],
  };
}
```

In `runSensitivity`, replace the base line and the tornado construction:

```ts
  const base = measure(inputs, {});
  // §12.5 makes the base case an identity with the unadjusted appraisal, so a suite over
  // an invalid base is meaningless in every position at once — this is an input error
  // (§12.6/§12.7), not twenty-five unmeasured cells.
  if (base.validation_errors.length > 0) {
    throw new Error(
      `Invalid base document: ${base.validation_errors.map((e) => e.message).join(' ')}`,
    );
  }
```

and

```ts
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
        // §12.7: an unmeasured endpoint leaves the bar with no span at all, rather than a
        // span computed against a number that was never a measurement.
        span_pence: low.profit_pence === null || high.profit_pence === null
          ? null
          : Math.abs(high.profit_pence - low.profit_pence),
      };
    })
    .sort((a, b) => {
      // §12.4, extended by §12.7: spanless bars sort after every bar with a span; within
      // each group the fixed lever order keeps the sort total and so deterministic (§1.4).
      if (a.span_pence === null || b.span_pence === null) {
        if (a.span_pence !== null) return -1;
        if (b.span_pence !== null) return 1;
        return LEVER_ORDER.indexOf(a.lever) - LEVER_ORDER.indexOf(b.lever);
      }
      return (
        b.span_pence - a.span_pence
        || LEVER_ORDER.indexOf(a.lever) - LEVER_ORDER.indexOf(b.lever)
      );
    });
```

Finally, cast the base into its narrowed type where the result is assembled:

```ts
  return { base: base as MeasuredMetrics, matrix, tornado, config };
```

The cast is sound and load-bearing only here: the throw immediately above is what proves the two money fields are non-null, and TypeScript cannot see that through the `validation_errors.length` check.

- [ ] **Step 4: Keep the two consumers compiling — minimum change only**

`npx tsc -b` now fails at the sites listed below. Make these changes and no others; the presentation work is Task 6.

In `frontend/src/lib/export-investment-memo.ts`, `sensitivityTables`'s tornado rows (around lines 203–212) currently call `fmt(bar.low.profit_pence)`. Replace those two cells with a null-tolerant local:

```ts
  const money = (p: number | null) => (p === null ? '—' : fmt(p));
```

and use `money(bar.low.profit_pence)`, `money(bar.high.profit_pence)`, `money(bar.span_pence)`.

**Leave every other `metrics.profit_pence` / `metrics.peak_debt_pence` in this file alone.** Those read `run.metrics` (the engine's `AppraisalMetrics`), which is a different type and did not change. Only the three reads off a `TornadoBar` or a `SensitivityCell` are affected.

In `frontend/src/components/calculator/SensitivityPage.tsx`:

- `metricText` and `metricColor` already take `number | null` for the percentage branch; widen the money branch the same way:

```ts
function metricText(cell: SensitivityMetrics, key: SensitivityMetricKey): string {
  const metric = SENSITIVITY_METRICS.find((m) => m.key === key)!;
  const value = cell[key];
  if (value === null) return '—';
  return metric.kind === 'money' ? penceToPounds(value) : formatPct(value);
}
```

- The tornado geometry (around lines 236–306) reads `bar.low.profit_pence` / `bar.high.profit_pence`. Skip bars that have no span, before the geometry runs:

```ts
  const measuredBars = tornado.filter(
    (b): b is TornadoBar & { span_pence: number } => b.span_pence !== null,
  );
```

Use `measuredBars` for the profits array, the scale, and the rendered rows. `base.profit_pence` needs no change — `result.base` is `MeasuredMetrics`.

- [ ] **Step 5: Run the tests and the gates**

```bash
cd frontend && npx vitest run && npx tsc -b && npx eslint . && npm run build
```

Expected: PASS, **835** tests (827 + 8). If a pre-existing test now fails, read it before changing it. The only intended behaviour change is fixtures I and J's `timeline` tornado bar becoming unmeasured (see Global Constraints) — and no existing test asserts on that. Anything else failing is a genuine regression.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/model/sensitivity.ts frontend/src/lib/model/sensitivity.test.ts frontend/src/lib/export-investment-memo.ts frontend/src/components/calculator/SensitivityPage.tsx
git commit -m "$(cat <<'EOF'
feat(model): sensitivity positions carry their validity (spec §12.7)

The compact record was built from runAppraisal(...).metrics and discarded
run.validation entirely, so the suite reported numbers for documents the engine
already flagged as invalid — three different timeline steps returning one
identical clamped answer, with nothing to say why.

The levered document is now validated first and an invalid position never
reaches the ledger, so the suite no longer depends on buildSchedule's defensive
term clamp holding. Widening profit_pence and peak_debt_pence to number | null
is the enforcement: a consumer cannot print an absent measurement, because
there is no number to print.

result.base is typed MeasuredMetrics because §12.7 makes the suite throw on an
invalid base, so its use sites need no null check.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Python mirror

**Files:**
- Modify: `app/financial_model/sensitivity.py`
- Modify: `tests/test_financial_model_sensitivity.py`

**Interfaces:**
- Consumes: `validate_inputs` from `.validation` (exported there at line 57); `ValidationIssue` from `.validation` (already imported by this file at line 21).
- Produces: `SensitivityMetrics` with `profit_pence: int | None`, `peak_debt_pence: int | None`, `validation_errors: list[ValidationIssue]`; `TornadoBar.span_pence: int | None`. Field order and names match the TypeScript record exactly.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_financial_model_sensitivity.py`, reusing whatever base-inputs helper the file already defines:

```python
# ---- Release 5: Sec 12.7 cell validity ----

def test_position_failing_validation_is_not_measured():
    """A -12 timeline step on a 12-month base empties the term, which validation
    rejects at error severity. Before R5 the suite clamped and reported numbers."""
    config = _default_config()
    config.rows = SensitivityAxis(lever="timeline", steps=[-12])
    config.cols = SensitivityAxis(lever="gdv", steps=[0])
    cell = run_sensitivity(base_inputs(), config).matrix[0][0]

    assert len(cell.validation_errors) > 0
    assert all(e.severity == "error" for e in cell.validation_errors)
    assert any(e.field == "finance.term_months" for e in cell.validation_errors)
    assert cell.profit_pence is None
    assert cell.peak_debt_pence is None
    assert cell.profit_on_cost_pct is None
    assert cell.profit_on_gdv_pct is None
    assert cell.irr_annual_pct is None
    assert cell.ltgdv_developer_pct is None
    assert cell.flags == []


def test_position_leaving_exactly_one_month_is_measured():
    config = _default_config()
    config.rows = SensitivityAxis(lever="timeline", steps=[-11])
    config.cols = SensitivityAxis(lever="gdv", steps=[0])
    cell = run_sensitivity(base_inputs(), config).matrix[0][0]

    assert cell.validation_errors == []
    assert cell.profit_pence is not None


def test_warnings_do_not_invalidate_a_position():
    """Fixture F carries a warning on conversion_costs.total_construction_sqm."""
    result = run_sensitivity(base_inputs())
    for row in result.matrix:
        for cell in row:
            assert cell.validation_errors == []
            assert cell.profit_pence is not None


def test_flagged_cell_is_still_a_measurement():
    """Sec 12.2: a covenant flag is the finding, not invalidity."""
    result = run_sensitivity(base_inputs())
    flagged = [c for row in result.matrix for c in row if c.flags]
    assert flagged
    for cell in flagged:
        assert cell.validation_errors == []
        assert cell.profit_pence is not None


def test_tornado_bar_with_unmeasured_endpoint_has_no_span():
    config = _default_config()
    config.tornado = [
        TornadoRange(lever="gdv", low=-10, high=10),
        TornadoRange(lever="timeline", low=-12, high=3),
    ]
    bars = run_sensitivity(base_inputs(), config).tornado
    timeline = next(b for b in bars if b.lever == "timeline")
    assert timeline.span_pence is None
    assert len(timeline.low.validation_errors) > 0
    assert timeline.high.validation_errors == []


def test_spanless_bars_sort_last():
    config = _default_config()
    config.tornado = [
        TornadoRange(lever="timeline", low=-12, high=3),
        TornadoRange(lever="interest_rate", low=-1, high=1),
        TornadoRange(lever="gdv", low=-10, high=10),
    ]
    bars = run_sensitivity(base_inputs(), config).tornado
    assert bars[-1].lever == "timeline"
    assert bars[-1].span_pence is None
    assert all(b.span_pence is not None for b in bars[:-1])


def test_invalid_base_document_raises():
    bad = base_inputs()
    bad.finance.term_months = 0
    with pytest.raises(ValueError, match="base document"):
        run_sensitivity(bad)
```

Import whatever of `SensitivityAxis` / `TornadoRange` / `_default_config` the file does not already import; check its existing imports first and add only what is missing.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
python -m pytest tests/test_financial_model_sensitivity.py -q
```

Expected: FAIL — `SensitivityMetrics` has no attribute `validation_errors`.

- [ ] **Step 3: Mirror the record**

In `app/financial_model/sensitivity.py`, add to the imports:

```python
from .validation import validate_inputs
```

Replace the `SensitivityMetrics` dataclass:

```python
@dataclass
class SensitivityMetrics:
    """The metric reduction of one appraisal (Sec 12.3), or the record of why no appraisal
    was run (Sec 12.7). `validation_errors` is empty exactly when the position was
    measured; it carries error-severity issues only, so a measured document that merely
    raises warnings still reports an empty list.

    Every metric field is nullable. The four percentages already were; R5 widened the two
    money fields so an unmeasured position cannot present a number at all.
    """

    profit_pence: int | None
    profit_on_cost_pct: float | None
    profit_on_gdv_pct: float | None
    irr_annual_pct: float | None
    ltgdv_developer_pct: float | None
    peak_debt_pence: int | None
    flags: list[str]
    validation_errors: list[ValidationIssue]
```

`SensitivityCell` inherits from it and adds `row_step` / `col_step` with defaults — that ordering stays legal because `validation_errors` has no default.

Change `TornadoBar.span_pence` to `int | None`.

Replace `_measure`:

```python
def _unmeasured(errors: list[ValidationIssue]) -> SensitivityMetrics:
    """The record of a position that was not measured (Sec 12.7)."""
    return SensitivityMetrics(
        profit_pence=None,
        profit_on_cost_pct=None,
        profit_on_gdv_pct=None,
        irr_annual_pct=None,
        ltgdv_developer_pct=None,
        peak_debt_pence=None,
        flags=[],
        validation_errors=errors,
    )


def _measure(inputs: AnyCalculatorInputs, levers: dict[str, float]) -> SensitivityMetrics:
    """One position: the levered document is validated first (Sec 12.7), and only a
    document that passes is appraised. An unmeasured position never reaches the ledger."""
    from app.financial_model import run_appraisal  # local import: see module docstring

    levered = apply_scenario(inputs, _overrides_for(levers))
    errors = [i for i in validate_inputs(levered) if i.severity == "error"]
    if errors:
        return _unmeasured(errors)

    m = run_appraisal(levered).metrics
    return SensitivityMetrics(
        profit_pence=m.profit_pence,
        profit_on_cost_pct=m.profit_on_cost_pct,
        profit_on_gdv_pct=m.profit_on_gdv_pct,
        irr_annual_pct=m.irr_annual_pct,
        ltgdv_developer_pct=m.ltgdv_developer_pct,
        peak_debt_pence=m.peak_debt_pence,
        flags=[f.code for f in m.flags],
        validation_errors=[],
    )
```

In `run_sensitivity`, after `base = _measure(inputs, {})`:

```python
    # Sec 12.5 makes the base case an identity with the unadjusted appraisal, so a suite
    # over an invalid base is meaningless in every position at once -- an input error
    # (Sec 12.6/12.7), not twenty-five unmeasured cells.
    if base.validation_errors:
        raise ValueError(
            "Invalid base document: "
            + " ".join(e.message for e in base.validation_errors)
        )
```

Add `validation_errors=m.validation_errors` to the `SensitivityCell(...)` construction in the matrix loop.

Replace the tornado span and sort:

```python
        low = _measure(inputs, {rng.lever: rng.low})
        high = _measure(inputs, {rng.lever: rng.high})
        # Sec 12.7: an unmeasured endpoint leaves the bar with no span at all.
        span = (
            None
            if low.profit_pence is None or high.profit_pence is None
            else abs(high.profit_pence - low.profit_pence)
        )
        bars.append(TornadoBar(
            lever=rng.lever,
            low_step=rng.low,
            high_step=rng.high,
            low=low,
            high=high,
            span_pence=span,
        ))
    # Sec 12.4 extended by Sec 12.7: spanless bars sort after every bar with a span; the
    # fixed lever order keeps the sort total within each group (Sec 1.4).
    bars.sort(key=lambda b: (
        b.span_pence is None,
        -b.span_pence if b.span_pence is not None else 0,
        LEVER_ORDER.index(b.lever),
    ))
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
python -m pytest tests/test_financial_model_sensitivity.py -q
python -m pytest -q
```

Expected: PASS, 757 total (750 + 7).

- [ ] **Step 5: Commit**

```bash
git add app/financial_model/sensitivity.py tests/test_financial_model_sensitivity.py
git commit -m "$(cat <<'EOF'
feat(model): Python mirror of the §12.7 cell-validity rule

Mirrors the TypeScript record field for field, including the sort key that
places spanless tornado bars after every bar with a span. Governance §1
requires the two engines move together; a golden-fixture parity failure is the
backstop, and Fixture K's new invalid_case is what will exercise it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Fixture K gains an unmeasured case

**Files:**
- Modify: `fixtures/financial-model/k-sensitivity.json`
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts`
- Modify: `tests/test_financial_model_fixtures.py`
- Modify: `docs/financial-model/test-cases.md`

**Interfaces:**
- Consumes: `runSensitivity` / `run_sensitivity` as changed by Tasks 2 and 3.
- Produces: `k.invalid_case`, asserted identically by both engines' fixture suites.

- [ ] **Step 1: Add the case to the fixture**

Add a top-level `invalid_case` key to `fixtures/financial-model/k-sensitivity.json`, after `expected_tornado_spans_pence`. Leave every existing key untouched.

```json
"invalid_case": {
  "note": "Spec §12.7. Base fixture F runs a 12-month term, so a -12 timeline step leaves 0 months and is not measured, while -11 leaves exactly 1 month and must still be measured. Hand derivation: 12 + (-12) = 0, and 0 < 1, therefore unmeasured; 12 + (-11) = 1, and 1 >= 1, therefore measured. No arithmetic beyond that.",
  "config": {
    "rows": { "lever": "timeline", "steps": [-12, -11, 0] },
    "cols": { "lever": "gdv", "steps": [0] },
    "tornado": [
      { "lever": "gdv", "low": -10, "high": 10 },
      { "lever": "construction_cost", "low": -10, "high": 10 },
      { "lever": "timeline", "low": -3, "high": 3 },
      { "lever": "interest_rate", "low": -1, "high": 1 }
    ]
  },
  "expected_unmeasured_rows": [-12],
  "expected_measured_rows": [-11, 0],
  "expected_unmeasured_error": {
    "severity": "error",
    "field": "finance.term_months",
    "message": "Term must be a whole number of months, at least 1."
  }
}
```

- [ ] **Step 2: Write the failing TypeScript assertion**

In `frontend/src/lib/model/golden-fixtures.test.ts`, extend the `SensitivityFixture` interface:

```ts
    invalid_case: {
      note: string;
      config: SensitivityConfig;
      expected_unmeasured_rows: number[];
      expected_measured_rows: number[];
      expected_unmeasured_error: { severity: string; field: string; message: string };
    };
```

and add this test inside the same `describe` block that holds the other Fixture K assertions:

```ts
  // Hand-derived (§12.7): 12 + (−12) = 0 < 1, so that row is unmeasured; 12 + (−11) = 1,
  // which is legal, so that row must still measure. The measured row is the half that
  // matters — a rule that marked everything unmeasured would satisfy the other half alone.
  it('does not measure the positions §12.7 excludes, and still measures the boundary', () => {
    const ic = k.invalid_case;
    const r = runSensitivity(baseInputs, ic.config);

    for (const step of ic.expected_unmeasured_rows) {
      const row = r.matrix.find((cells) => cells[0].row_step === step);
      expect(row, `row ${step}`).toBeDefined();
      for (const cell of row!) {
        expect(cell.profit_pence, `row ${step} profit`).toBeNull();
        expect(cell.peak_debt_pence, `row ${step} peak debt`).toBeNull();
        expect(cell.flags, `row ${step} flags`).toEqual([]);
        expect(cell.validation_errors, `row ${step} errors`).toContainEqual(
          ic.expected_unmeasured_error,
        );
      }
    }

    for (const step of ic.expected_measured_rows) {
      const row = r.matrix.find((cells) => cells[0].row_step === step);
      expect(row, `row ${step}`).toBeDefined();
      for (const cell of row!) {
        expect(cell.validation_errors, `row ${step} errors`).toEqual([]);
        expect(cell.profit_pence, `row ${step} profit`).not.toBeNull();
      }
    }
  });
```

- [ ] **Step 3: Write the matching Python assertion**

In `tests/test_financial_model_fixtures.py`, beside the other Fixture K assertions:

```python
def test_fixture_k_invalid_case_matches_spec_12_7():
    """Hand-derived: 12 + (-12) = 0 < 1 -> unmeasured; 12 + (-11) = 1 -> measured."""
    ic = K_DOC["invalid_case"]
    result = run_sensitivity(K_BASE_INPUTS, _config_from(ic["config"]))
    expected_error = ic["expected_unmeasured_error"]

    for step in ic["expected_unmeasured_rows"]:
        row = next(cells for cells in result.matrix if cells[0].row_step == step)
        for cell in row:
            assert cell.profit_pence is None
            assert cell.peak_debt_pence is None
            assert cell.flags == []
            assert any(
                e.severity == expected_error["severity"]
                and e.field == expected_error["field"]
                and e.message == expected_error["message"]
                for e in cell.validation_errors
            )

    for step in ic["expected_measured_rows"]:
        row = next(cells for cells in result.matrix if cells[0].row_step == step)
        for cell in row:
            assert cell.validation_errors == []
            assert cell.profit_pence is not None
```

The file already has `_k_config()` (around line 646), which builds a `SensitivityConfig` from `K_DOC["config"]`. Generalise it to take the dict rather than duplicating the conversion:

```python
def _config_from(c: dict) -> SensitivityConfig:
    return SensitivityConfig(
        rows=SensitivityAxis(lever=c["rows"]["lever"], steps=list(c["rows"]["steps"])),
        cols=SensitivityAxis(lever=c["cols"]["lever"], steps=list(c["cols"]["steps"])),
        tornado=[TornadoRange(lever=t["lever"], low=t["low"], high=t["high"]) for t in c["tornado"]],
    )


def _k_config() -> SensitivityConfig:
    return _config_from(K_DOC["config"])
```

`K_BASE_INPUTS` (line 641) is the parsed Fixture F document — use it directly as the base.

- [ ] **Step 4: Run both fixture suites**

```bash
cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts
cd .. && python -m pytest tests/test_financial_model_fixtures.py -q
```

Expected: PASS in both. **Every pre-existing Fixture K assertion must still pass unchanged** — if `expected_base` or a corner cell now fails, the validity rule is firing where it should not. Stop and report rather than editing the fixture.

- [ ] **Step 5: Record the derivation**

In `docs/financial-model/test-cases.md`, under the existing "Fixture K — sensitivity suite" heading, append:

```markdown
### Fixture K — `invalid_case` (spec §12.7, R5)

Base fixture F runs `finance.term_months = 12`.

| Timeline step | Resulting term | ≥ 1? | Outcome |
|---|---|---|---|
| −12 | 12 + (−12) = 0 | no | unmeasured — `finance.term_months` error |
| −11 | 12 + (−11) = 1 | yes | measured |
| 0 | 12 + 0 = 12 | yes | measured |

No arithmetic beyond the term addition and the comparison against 1: §12.7 keys off
validation, and `validation.ts:61` / `validation.py:83` reject a term below one month. The
−11 row is carried deliberately so the boundary is pinned from the measured side too — a
rule that marked every position unmeasured would satisfy the −12 row alone.
```

- [ ] **Step 6: Commit**

```bash
git add fixtures/financial-model/k-sensitivity.json frontend/src/lib/model/golden-fixtures.test.ts tests/test_financial_model_fixtures.py docs/financial-model/test-cases.md
git commit -m "$(cat <<'EOF'
test(model): Fixture K pins §12.7 from both sides of the boundary

The corpus had no position that fails validation, so nothing would have caught
the rule regressing. The -11 row is the half that matters: it leaves exactly one
month and must still measure, so a rule that simply marked everything unmeasured
cannot pass.

No existing expected value changes — Fixture K's 34 appraisals all run a
12-month term with a ±3 timeline range.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Retire the two R4b guards

`isUnsoundTornadoBar` and `SensitivityPage`'s axis term guard were presentation-layer containment for exactly the condition §12.7 now specifies. Keeping both would leave two answers to one question.

**Files:**
- Modify: `frontend/src/lib/sensitivity-format.ts`
- Modify: `frontend/src/lib/sensitivity-format.test.ts`
- Modify: `frontend/src/lib/export-investment-memo.ts`
- Modify: `frontend/src/components/calculator/SensitivityPage.tsx`
- Modify: `frontend/src/components/calculator/SensitivityPage.test.tsx`

**Interfaces:**
- Consumes: the §12.7 behaviour from Tasks 2 and 3.
- Produces: `isUnsoundTornadoBar` no longer exists. `SensitivityPage`'s validation gate covers only the §12.6 config errors returned by `validateSensitivityConfig`; it no longer computes anything about `term_months`.

- [ ] **Step 1: Update the page's tests to the new behaviour**

In `frontend/src/components/calculator/SensitivityPage.test.tsx`, **replace** the two tests named `refuses a timeline step that would empty the term` and `allows a timeline step that leaves a one-month term` with:

```tsx
  // R5: §12.7 replaced the page's own term guard. A mixed axis now renders — the
  // unmeasured row shows its reason and the measured rows show their numbers, which
  // tells the analyst where the deal stops being modellable instead of refusing the
  // whole grid.
  it('renders unmeasured and measured rows side by side for a mixed timeline axis', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12, -11' } });

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    expect(within(matrix).getByText('Timeline -12 months')).toBeInTheDocument();
    expect(within(matrix).getByText('Timeline -11 months')).toBeInTheDocument();
    expect(screen.queryByText(/at least one month of term/i)).not.toBeInTheDocument();
  });

  it('shows the validation reason on an unmeasured cell', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12' } });

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    expect(within(matrix).getByTitle(/whole number of months, at least 1/i)).toBeInTheDocument();
  });
```

Leave every other test in the file unchanged — in particular the §12.6 config-error tests (same lever on both axes, empty step list, fractional timeline step, more than nine steps) still apply and must still pass.

- [ ] **Step 2: Run to verify the two new tests fail**

```bash
cd frontend && npx vitest run src/components/calculator/SensitivityPage.test.tsx
```

Expected: FAIL — the term guard still refuses the axis, so the matrix never renders.

- [ ] **Step 3: Delete the page's term guard**

In `frontend/src/components/calculator/SensitivityPage.tsx`, replace the whole `issues` `useMemo` with:

```tsx
  // Spec §12.6 config errors only. A position whose *levered document* is invalid is no
  // longer this component's problem: §12.7 makes the engine report it per position, which
  // is strictly more informative than refusing the grid — the analyst sees which steps
  // work and which do not.
  const issues = useMemo(
    () => validateSensitivityConfig(config).map((issue) => issue.message),
    [config],
  );
```

Remove the now-unused `isUnsoundTornadoBar` import.

Render the reason on an unmeasured cell by giving the `<td>` a `title`:

```tsx
                  const unmeasured = cell.validation_errors.length > 0;
                  return (
                    <td
                      key={cell.col_step}
                      title={unmeasured ? cell.validation_errors.map((e) => e.message).join(' ') : undefined}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        color: unmeasured ? MUTED : metricColor(metric, cell[metric]),
                        fontStyle: unmeasured ? 'italic' : undefined,
                        fontWeight: cell.row_step === 0 && cell.col_step === 0 ? 700 : 400,
                      }}
                    >
```

- [ ] **Step 4: Delete `isUnsoundTornadoBar`**

Remove the function from `frontend/src/lib/sensitivity-format.ts` and its tests from `frontend/src/lib/sensitivity-format.test.ts`. Remove its import and use from `frontend/src/lib/export-investment-memo.ts`, replacing the filter in `sensitivityTables` with the engine's own answer:

```ts
  // §12.7: the engine reports a bar with an unmeasured endpoint as having no span. The
  // memo omits those rather than printing a partial bar, and says so beneath the table.
  const soundBars = result.tornado.filter((bar) => bar.span_pence !== null);
  const omittedTornadoLevers = result.tornado
    .filter((bar) => bar.span_pence === null)
    .map((bar) => LEVER_LABEL[bar.lever]);
```

Keep the memo's existing omission-note rendering and the `tornadoRows.length > 0` guard exactly as they are — only the source of the filter changes.

- [ ] **Step 5: Run everything**

```bash
cd frontend && npx vitest run && npx tsc -b && npx eslint . && npm run build
cd .. && python -m pytest -q
```

Expected: frontend green with the two replaced tests passing; pytest still 757. `grep -rn "isUnsoundTornadoBar" frontend/src` must return nothing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/sensitivity-format.ts frontend/src/lib/sensitivity-format.test.ts frontend/src/lib/export-investment-memo.ts frontend/src/components/calculator/SensitivityPage.tsx frontend/src/components/calculator/SensitivityPage.test.tsx
git commit -m "$(cat <<'EOF'
refactor(ui): retire the R4b guards now §12.7 specifies the rule

isUnsoundTornadoBar and the page's own term guard were presentation-layer
containment for exactly the condition §12.7 now covers in the engine. Two
answers to one question, and the ad-hoc ones were the worse answers: the page
refused an entire grid when one row was unmodellable.

A mixed timeline axis now renders the rows that work beside the ones that do
not, each unmeasured cell carrying its reason.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Calc version 2.5.0 and the governance record

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts`
- Modify: `app/financial_model/types.py`
- Modify: `docs/financial-model/calculation-specification.md`
- Modify: `docs/financial-model/model-governance.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `CALC_VERSION === '2.5.0'` in both engines.

- [ ] **Step 1: Bump both constants**

```bash
cd frontend && grep -n "2\.4\.0" src/lib/model/finance-types.ts
cd .. && grep -n "2\.4\.0" app/financial_model/types.py
```

Change each to `2.5.0`. There should be exactly one occurrence per file.

- [ ] **Step 2: Bump the version in the spec and governance headers**

```bash
grep -rn "2\.4\.0" docs/financial-model/calculation-specification.md docs/financial-model/model-governance.md
```

Update the calc-version statements to `2.5.0`. Do **not** rewrite historical entries that describe what a previous release did at 2.4.0 — only the current-version statements move.

- [ ] **Step 3: Run the full gates**

```bash
cd frontend && npx vitest run && npx tsc -b && npx eslint . && npm run build
cd .. && python -m pytest -q
```

Expected: frontend and backend both green. `calc_version` is not in any fixture's `expected_metrics`, so no golden test breaks from the bump alone — if one does, a fixture is pinning it and that is a finding.

- [ ] **Step 4: Verify the parity of the two engines by hand**

```bash
grep -n "validation_errors" frontend/src/lib/model/sensitivity.ts app/financial_model/sensitivity.py
grep -n "span_pence" frontend/src/lib/model/sensitivity.ts app/financial_model/sensitivity.py
```

Expected: the same field in the same positions in both files. Governance §1 requires the engines mirror file-for-file; this is the last chance to catch a drift the fixture happens not to exercise.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/finance-types.ts app/financial_model/types.py docs/financial-model/calculation-specification.md docs/financial-model/model-governance.md
git commit -m "$(cat <<'EOF'
chore(model): bump calc version to 2.5.0

Minor: §12.7 adds a capability and widens a type. Every existing fixture value
is unchanged — Fixture K's 34 appraisals all run a 12-month term with a ±3
timeline range, so no position in the corpus becomes unmeasured.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage against the design:**

| Design requirement | Task |
|---|---|
| §2 — spec §12.7 text, §12.3 cross-reference | 1 |
| §2.1 — rule is general, not term-specific (keys off validation) | 2, 3 |
| §2.1 — an unmeasured position never runs the ledger | 2, 3 |
| §2.2 — `report_safe` is not the signal | 2, 3 (tested: flagged cells stay measured) |
| §3 — record shape, both engines | 2, 3 |
| §3 — `validation_errors` carries error severity only | 2, 3 (tested: warnings do not invalidate) |
| §3.1 — nullable fields rather than a discriminated union | 2 |
| §4 — Fixture K `invalid_case`, both sides of the boundary | 4 |
| §4 — hand derivation recorded | 4 (`test-cases.md`) |
| §5 — `isUnsoundTornadoBar` and the page term guard deleted | 5 |
| §5 — memo prints `—`; unmeasured bars omitted with the omission stated | 2 (minimum), 5 (sourced from the engine) |
| §5 — page renders unmeasured cells with the reason | 5 |
| §6 — calc 2.5.0, one release | 6 |
| §7 — spec, governance, test-cases, both `CALC_VERSION` mirrors | 1, 4, 6 |
| §8 — import-cycle rule, module placement, no Tailwind | Global Constraints |

**Addition beyond the design, noted deliberately:** `MeasuredMetrics` (Task 2) narrows `result.base` so its use sites need no null check. The design says the base is always measured because the suite throws; this puts that guarantee in the type rather than leaving every consumer to rediscover it. It removes consumer churn rather than adding any.

**Type consistency:** `SensitivityMetrics` gains `validation_errors: ValidationIssue[]` in Tasks 2 and 3 under that exact name in both languages. `span_pence` is `number | null` / `int | None` from Task 2 onward and is read as such in Tasks 5. `MeasuredMetrics` is introduced in Task 2 and referenced only there and in Task 5's page code via `result.base`. The base-throw message contains the words `base document` in both engines, which is what Tasks 2 and 3 assert on.

**Placeholder scan:** clean — every step carries the actual text, code, or command.
