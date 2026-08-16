# Release 6 — Trusting the §12.7 Signal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sensitivity suite's §12.7 validity signal trustworthy at every surface that consumes it — give its two documented failures real types so consumers stop swallowing genuine defects, carry an unmeasured cell's reason in a form assistive tech and print can reach, and pin the three behaviours currently recorded only in comments.

**Architecture:** Two exported error classes per engine turn `runSensitivity`'s documented failures into a contract; the memo and the page each narrow their catch to those types and rethrow anything else. One new shared function in `sensitivity-format.ts` builds the deduplicated list of unmeasured-cell reasons, and both surfaces render it rather than writing their own sentence. The remaining work is test-only.

**Tech Stack:** TypeScript (Vite, Vitest, React Testing Library), Python 3.11 (pytest, pydantic), jsPDF + jspdf-autotable.

## Global Constraints

- **Calculation version stays `2.5.0`.** No formula and no computed value changes in this release. Do not bump `calc_version` anywhere.
- **Both engines mirror file-for-file** (governance §1). Anything added to `frontend/src/lib/model/sensitivity.ts` gets its counterpart in `app/financial_model/sensitivity.py`, and vice versa.
- **Neither `frontend/src/lib/model/index.ts` nor `app/financial_model/__init__.py` may import or re-export `sensitivity`.** Consumers import the module directly.
- **`frontend/src/lib/sensitivity-format.ts` has no Python counterpart** and must not gain one — it is presentation, deliberately outside `lib/model/`.
- **Error message text is not a contract; error type is.** No consumer may branch on `err.message` content.
- **Existing thrown message strings must not change.** `Invalid sensitivity config: …` and `Invalid base document: …` are pinned by tests and printed into the memo.

  **Recorded exception, granted at the final whole-branch review.** The prefixes and every distinct sentence are unchanged, and no pinned test asserts the joined body — every pin matches a prefix or a substring. But the join itself now deduplicates, in both engines, because `validateInputs` emits one issue *per offending element* with an identical message: fixture I's three sale tranches made the memo's §10 degradation paragraph print *"Tranche month must be a whole month between 0 and 11."* three times in one sentence, to a lender. Collapsing a verbatim triplicate is not the drift this constraint exists to prevent — no sentence moved away from the condition it explains, which is the constraint's actual purpose (spec §2.1) — and the release's own rule that no consumer may match on message text is what makes the producer free to correct it. Both engines dedupe first-appearance-order-preserving (`[...new Set()]` / `dict.fromkeys`), verified byte-identical on the multi-message case.
- Gates before merge: `npx vitest run`, `pytest`, `npx tsc -b`, `npx eslint .`, `npm run build`, plus browser UAT of the Sensitivity page.
- Ops for UAT: `docker restart commercial-resi-analyser-frontend-1` first.

**Working directory:** all `npx`/`npm` commands run from `frontend/`; all `pytest` commands run from the repository root.

---

### Task 1: Named errors for the suite's two documented failures

**Files:**
- Modify: `frontend/src/lib/model/sensitivity.ts:276-291`
- Modify: `app/financial_model/sensitivity.py:244-258`
- Test: `frontend/src/lib/model/sensitivity.test.ts`
- Test: `tests/test_financial_model_sensitivity.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - TS, exported from `./model/sensitivity`: `class InvalidSensitivityConfigError extends Error`, `class InvalidBaseDocumentError extends Error`.
  - Python, exported from `app.financial_model.sensitivity`: `class InvalidSensitivityConfigError(ValueError)`, `class InvalidBaseDocumentError(ValueError)`.
  - Both raised at the existing throw sites with byte-identical messages to today.

- [ ] **Step 1: Write the failing TS test**

Add to `frontend/src/lib/model/sensitivity.test.ts`. Put it directly after the existing `describe` block that covers config validation. Add `InvalidSensitivityConfigError` and `InvalidBaseDocumentError` to the existing `import { … } from './sensitivity'` statement at the top of the file.

```ts
// R6: the suite has exactly two documented failures (§12.6 config, §12.7 base
// document). Consumers must be able to tell them apart — and tell both apart from a
// genuine defect — without matching on message text, which is the coupling that let
// an explanation drift away from its condition three times in R4b/R5.
describe('runSensitivity — the two documented failures are typed (§12.6, §12.7)', () => {
  it('raises InvalidSensitivityConfigError for a config that is not a grid', () => {
    const cfg = { ...DEFAULT_SENSITIVITY_CONFIG, rows: { lever: 'gdv' as const, steps: [] } };
    expect(() => runSensitivity(fixtureFInputs(), cfg)).toThrow(InvalidSensitivityConfigError);
    // The message is unchanged — the memo prints it and safe-sensitivity's tests pin it.
    expect(() => runSensitivity(fixtureFInputs(), cfg)).toThrow(/^Invalid sensitivity config: /);
  });

  it('raises InvalidBaseDocumentError when the base document fails validation', () => {
    const inputs = fixtureFInputs();
    inputs.finance.equity_draw_rule = 'pari_passu';
    expect(() => runSensitivity(inputs)).toThrow(InvalidBaseDocumentError);
    expect(() => runSensitivity(inputs)).toThrow(/^Invalid base document: /);
  });

  // The two must not be mistakable for each other: a consumer catching one and
  // rethrowing the rest depends on this.
  it('keeps the two failures distinguishable', () => {
    const inputs = fixtureFInputs();
    inputs.finance.equity_draw_rule = 'pari_passu';
    expect(() => runSensitivity(inputs)).not.toThrow(InvalidSensitivityConfigError);

    const cfg = { ...DEFAULT_SENSITIVITY_CONFIG, rows: { lever: 'gdv' as const, steps: [] } };
    expect(() => runSensitivity(fixtureFInputs(), cfg)).not.toThrow(InvalidBaseDocumentError);
  });

  // Both remain plain Errors, so existing `catch (err)` sites and
  // `err instanceof Error` narrowing keep working.
  it('keeps both errors instances of Error', () => {
    const cfg = { ...DEFAULT_SENSITIVITY_CONFIG, rows: { lever: 'gdv' as const, steps: [] } };
    expect(() => runSensitivity(fixtureFInputs(), cfg)).toThrow(Error);
  });
});
```

- [ ] **Step 2: Run the TS test to verify it fails**

Run: `npx vitest run src/lib/model/sensitivity.test.ts -t "typed"`
Expected: FAIL — `InvalidSensitivityConfigError is not exported by './sensitivity'` (a transform/import error, not an assertion failure).

- [ ] **Step 3: Add the TS error classes and raise them**

In `frontend/src/lib/model/sensitivity.ts`, add the classes immediately above `export function runSensitivity`:

```ts
/**
 * The suite's two documented failures, given types so a consumer can catch exactly the
 * condition it knows how to handle and let anything else through as the defect it is.
 *
 * Before R6 both were bare `Error`s separated only by a message prefix, and both
 * consumers (`export-investment-memo.ts`, `safe-sensitivity.ts`) caught everything —
 * so an engine defect reached a lender-facing PDF describing itself as an orderly
 * validation outcome. The type is the contract; the message text is not, and no
 * consumer may branch on it.
 */
export class InvalidSensitivityConfigError extends Error {}   // §12.6
export class InvalidBaseDocumentError extends Error {}        // §12.7
```

Then change the two throw sites, leaving both message expressions exactly as they are:

```ts
  if (issues.length > 0) {
    throw new InvalidSensitivityConfigError(
      `Invalid sensitivity config: ${issues.map((i) => i.message).join(' ')}`,
    );
  }
```

```ts
  if (base.validation_errors.length > 0) {
    throw new InvalidBaseDocumentError(
      `Invalid base document: ${base.validation_errors.map((e) => e.message).join(' ')}`,
    );
  }
```

- [ ] **Step 4: Run the TS test to verify it passes**

Run: `npx vitest run src/lib/model/sensitivity.test.ts`
Expected: PASS — the four new cases plus every pre-existing case in the file.

- [ ] **Step 5: Write the failing Python test**

Add to `tests/test_financial_model_sensitivity.py`, and add `InvalidBaseDocumentError` and `InvalidSensitivityConfigError` to the existing `from app.financial_model.sensitivity import (...)` block.

```python
def test_config_failure_is_typed():
    """Spec Sec 12.6 — mirror of the TS suite."""
    cfg = SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0]),
        tornado=[],
    )
    with pytest.raises(InvalidSensitivityConfigError) as exc:
        run_sensitivity(_inputs(), cfg)
    assert str(exc.value).startswith("Invalid sensitivity config: ")


def test_base_document_failure_is_typed():
    """Spec Sec 12.7 — mirror of the TS suite."""
    inputs = _inputs()
    inputs.finance.equity_draw_rule = "pari_passu"
    with pytest.raises(InvalidBaseDocumentError) as exc:
        run_sensitivity(inputs)
    assert str(exc.value).startswith("Invalid base document: ")


def test_the_two_failures_are_distinguishable():
    """A consumer catching one and re-raising the rest depends on this."""
    inputs = _inputs()
    inputs.finance.equity_draw_rule = "pari_passu"
    with pytest.raises(InvalidBaseDocumentError):
        run_sensitivity(inputs)
    assert not issubclass(InvalidBaseDocumentError, InvalidSensitivityConfigError)
    assert not issubclass(InvalidSensitivityConfigError, InvalidBaseDocumentError)


def test_both_failures_remain_value_errors():
    """Existing `except ValueError` sites and pytest.raises(ValueError) keep working."""
    assert issubclass(InvalidSensitivityConfigError, ValueError)
    assert issubclass(InvalidBaseDocumentError, ValueError)
```

- [ ] **Step 6: Run the Python test to verify it fails**

Run: `pytest tests/test_financial_model_sensitivity.py -k "typed or distinguishable or value_errors" -v`
Expected: FAIL at collection — `ImportError: cannot import name 'InvalidBaseDocumentError'`.

- [ ] **Step 7: Add the Python error classes and raise them**

In `app/financial_model/sensitivity.py`, add immediately above `def run_sensitivity`:

```python
class InvalidSensitivityConfigError(ValueError):
    """Sec 12.6: the axes/tornado config does not describe a runnable grid.

    Mirrors InvalidSensitivityConfigError in frontend/src/lib/model/sensitivity.ts.
    Subclasses ValueError so existing `except ValueError` sites keep working; the
    type is the contract, the message text is not.
    """


class InvalidBaseDocumentError(ValueError):
    """Sec 12.7: the base document itself fails validation, so no position in the
    suite is meaningful (Sec 12.5 makes the base case an identity with the
    unadjusted appraisal).

    Mirrors InvalidBaseDocumentError in frontend/src/lib/model/sensitivity.ts.
    """
```

Then change the two raise sites, leaving both message expressions exactly as they are:

```python
    issues = validate_sensitivity_config(config)
    if issues:
        raise InvalidSensitivityConfigError(
            "Invalid sensitivity config: " + " ".join(i.message for i in issues)
        )
```

```python
    if base.validation_errors:
        raise InvalidBaseDocumentError(
            "Invalid base document: "
            + " ".join(e.message for e in base.validation_errors)
        )
```

- [ ] **Step 8: Run the full Python suite to verify nothing regressed**

Run: `pytest tests/test_financial_model_sensitivity.py -v`
Expected: PASS — the four new cases plus every pre-existing case, including any `pytest.raises(ValueError)` already in the file (they pass because both classes subclass `ValueError`).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/model/sensitivity.ts frontend/src/lib/model/sensitivity.test.ts app/financial_model/sensitivity.py tests/test_financial_model_sensitivity.py
git commit -m "feat(model): the suite's two documented failures become types"
```

---

### Task 2: The memo catches only the failure it handles

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts:1276-1282` and its import block at lines 7-8
- Test: `frontend/src/lib/export-investment-memo.test.ts`

**Interfaces:**
- Consumes: `InvalidBaseDocumentError` from `./model/sensitivity` (Task 1).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/export-investment-memo.test.ts`, inside the existing `describe('generateInvestmentMemo — base document fails validation (spec §12.7)', ...)` block, after the test already there.

You will need `vi` from vitest — add it to the existing `import { describe, it, expect } from 'vitest'` line if not already present.

```ts
  // R6: §10's degradation is the documented response to ONE documented condition. Any
  // other throw is a defect, and a defect that renders as an orderly §12.7 omission in
  // a lender-facing PDF is a defect nobody will ever be told about. The export must
  // fail loudly instead.
  it('propagates a failure that is not an invalid base document, rather than degrading §10', async () => {
    const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
    const fixtureI = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'i-phased-sales.json'), 'utf-8'),
    ) as { inputs: CalculatorInputsV4 };
    const inputs = structuredClone(fixtureI.inputs);
    const run = runAppraisal(inputs);

    // A stand-in for any engine defect: something thrown from inside the suite that is
    // not one of its two documented failures.
    const boom = new TypeError('cannot read properties of undefined (reading "flags")');
    const spy = vi.spyOn(sensitivityModule, 'runSensitivity').mockImplementation(() => {
      throw boom;
    });
    try {
      expect(() => generateInvestmentMemo(mockProject, run, mockEligibility)).toThrow(boom);
    } finally {
      spy.mockRestore();
    }
  });

  // The counterpart: the one condition §10 does handle still degrades, and the other
  // nine sections still print. This is R5's behaviour, re-pinned against the narrowed
  // catch so a too-tight catch cannot pass Task 2 either.
  it('still degrades §10 for the documented invalid-base-document failure', async () => {
    const inputs = fixtureIWithInvalidBase();
    const run = runAppraisal(inputs);
    expect(() => runSensitivity(inputs)).toThrow(InvalidBaseDocumentError);

    const text = await pdfText(generateInvestmentMemo(mockProject, run, mockEligibility));
    expect(text).toContain('sensitivity analysis was not produced');
    expect(text).toContain('Senior Debt Position');
  });
```

For the spy to intercept the call, the memo must reach `runSensitivity` through the module object. Add this import alongside the existing ones at the top of the **test** file:

```ts
import * as sensitivityModule from './model/sensitivity';
import { InvalidBaseDocumentError } from './model/sensitivity';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/export-investment-memo.test.ts -t "propagates a failure"`
Expected: FAIL — the memo swallows the `TypeError` and returns a Blob, so `.toThrow(boom)` fails with "expected function to throw".

- [ ] **Step 3: Narrow the catch**

In `frontend/src/lib/export-investment-memo.ts`, extend the existing sensitivity import to bring in the error type:

```ts
import { runSensitivity, InvalidBaseDocumentError } from './model/sensitivity';
```

Replace the catch block at lines 1276-1282 with:

```ts
  // §12.7/§12.5: runSensitivity throws when the *base* document itself fails validation
  // — a saved appraisal can reach this function in that state (e.g.
  // `finance.equity_draw_rule: 'pari_passu'`, a migration state some historical
  // documents still carry). A ten-section memo should not vanish for one section's
  // sake: the DRAFT watermark already flags a document in this state
  // (`run.reconciliation.report_safe`), so §10 degrades rather than the whole export
  // failing.
  //
  // R6: that degradation answers exactly one condition, so it catches exactly one type.
  // Anything else thrown from the suite is a defect, and rendering a defect as an
  // orderly §12.7 omission in a lender-facing PDF is how a defect stays unfound —
  // it propagates instead. `InvalidSensitivityConfigError` (§12.6) is deliberately not
  // caught either: this memo only ever passes the fixed default config, so reaching it
  // would itself be a defect.
  let sens: MemoSensitivityTables | null = null;
  let sensitivityFailureMessage: string | null = null;
  try {
    sens = sensitivityTables(inputs);
  } catch (err) {
    if (!(err instanceof InvalidBaseDocumentError)) throw err;
    sensitivityFailureMessage = err.message;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/export-investment-memo.test.ts`
Expected: PASS — including the pre-existing R5 degradation test at line 916, whose behaviour is unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-investment-memo.test.ts
git commit -m "fix(model): the memo catches only the failure §10 knows how to degrade"
```

---

### Task 3: `safeRunSensitivity` stops absorbing defects

**Files:**
- Modify: `frontend/src/lib/safe-sensitivity.ts`
- Test: `frontend/src/lib/safe-sensitivity.test.ts`

**Interfaces:**
- Consumes: `InvalidSensitivityConfigError`, `InvalidBaseDocumentError` from `./model/sensitivity` (Task 1).
- Produces: `safeRunSensitivity` keeps its existing signature and `SafeSensitivityResult` type unchanged. Its behaviour narrows: it returns `{ ok: false, error }` for the two named errors and rethrows anything else.

**Behaviour change, deliberate:** today an unexpected throw keeps the page's axis editor and shows the message in `CalculatorFailurePanel`; afterwards it reaches `CalculatorErrorBoundary`, which is the surface every other calculator page uses for a genuine fault. The panel's copy asserts a cause it has not established.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/safe-sensitivity.test.ts`. Add `vi` to the vitest import and add the two error imports.

```ts
import * as sensitivityModule from './model/sensitivity';
import { InvalidBaseDocumentError, InvalidSensitivityConfigError } from './model/sensitivity';
```

```ts
  // R6: the wrapper exists to turn the suite's *documented* failures into values so the
  // page can keep its editor and state the reason. A defect is not one of those, and
  // routing it into a panel that says "the suite could not be calculated" asserts a
  // cause the panel has not established — CalculatorErrorBoundary is where a genuine
  // fault belongs.
  it('rethrows a failure that is neither of the suite\'s documented ones', () => {
    const boom = new TypeError('cannot read properties of undefined (reading "flags")');
    const spy = vi.spyOn(sensitivityModule, 'runSensitivity').mockImplementation(() => {
      throw boom;
    });
    try {
      expect(() => safeRunSensitivity(buildInputs())).toThrow(boom);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns the invalid-base-document failure as a value (§12.7)', () => {
    const inputs = buildInputs();
    inputs.finance.equity_draw_rule = 'pari_passu';
    const result = safeRunSensitivity(inputs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(InvalidBaseDocumentError);
  });

  it('returns the invalid-config failure as a value (§12.6)', () => {
    const result = safeRunSensitivity(buildInputs(), {
      ...DEFAULT_SENSITIVITY_CONFIG,
      rows: { lever: 'gdv', steps: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(InvalidSensitivityConfigError);
  });
```

If `buildInputs` and `DEFAULT_SENSITIVITY_CONFIG` are not already in scope in this file, reuse whatever helper the existing tests at lines 18-58 use to build a document and a config — do not introduce a second fixture loader.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/safe-sensitivity.test.ts -t "rethrows"`
Expected: FAIL — the wrapper returns `{ ok: false }` for the `TypeError`, so `.toThrow` fails.

- [ ] **Step 3: Narrow the wrapper**

In `frontend/src/lib/safe-sensitivity.ts`, add to the existing import:

```ts
import {
  runSensitivity, InvalidBaseDocumentError, InvalidSensitivityConfigError,
} from './model/sensitivity';
```

Replace the function body:

```ts
export function safeRunSensitivity(
  inputs: AnyCalculatorInputs,
  config?: SensitivityConfig,
): SafeSensitivityResult {
  try {
    return { ok: true, result: config ? runSensitivity(inputs, config) : runSensitivity(inputs) };
  } catch (error) {
    // R6: only the suite's two documented failures (§12.6 config, §12.7 base document)
    // become values. Anything else is a defect: absorbing it here would render it in a
    // panel that says the inputs did not describe a runnable suite — a cause this
    // wrapper has not established — and would keep it away from
    // CalculatorErrorBoundary, where every other calculator page sends a genuine fault.
    if (
      error instanceof InvalidSensitivityConfigError ||
      error instanceof InvalidBaseDocumentError
    ) {
      return { ok: false, error };
    }
    throw error;
  }
}
```

Also update this file's doc comment: the paragraph beginning "`runSensitivity` throws on an invalid config (spec §12.6)" should now read that the wrapper handles both documented failures and rethrows anything else, and that the page's `CalculatorErrorBoundary` is the intended destination for a defect. Keep the existing paragraph about §12.7 unmeasured positions not throwing — it is still true and still worth saying.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/safe-sensitivity.test.ts src/components/calculator/SensitivityPage.test.tsx`
Expected: PASS — both files. The page tests are included because they exercise the wrapper's happy and invalid-config paths.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/safe-sensitivity.ts frontend/src/lib/safe-sensitivity.test.ts
git commit -m "fix(ui): safeRunSensitivity absorbs the documented failures, not defects"
```

---

### Task 4: One shared builder for unmeasured-cell notes

**Files:**
- Modify: `frontend/src/lib/sensitivity-format.ts` (append after `omittedTornadoNotes`)
- Test: `frontend/src/lib/sensitivity-format.test.ts`

**Interfaces:**
- Consumes: `SensitivityCell` type from `./model/sensitivity` — add it to this file's existing `import type` line.
- Produces, and Tasks 5 and 6 both depend on this exact shape:

```ts
export interface UnmeasuredCellNotes {
  notes: readonly string[];
  noteIndexFor(cell: SensitivityCell): number | null;
}
export function unmeasuredCellNotes(
  matrix: readonly (readonly SensitivityCell[])[],
): UnmeasuredCellNotes;
```

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/sensitivity-format.test.ts`. Add `unmeasuredCellNotes` to the existing import from `./sensitivity-format`, and add:

```ts
import type { SensitivityCell } from './model/sensitivity';
```

Then add this helper and describe block:

```ts
// A cell built by hand rather than by running the suite: this tests the note builder,
// not the engine, and a literal keeps the failure modes visible.
function cell(row: number, col: number, ...messages: string[]): SensitivityCell {
  return {
    row_step: row,
    col_step: col,
    profit_pence: messages.length ? null : 1_000_000,
    profit_on_cost_pct: messages.length ? null : 20,
    profit_on_gdv_pct: messages.length ? null : 15,
    irr_annual_pct: messages.length ? null : 25,
    ltgdv_developer_pct: messages.length ? null : 60,
    peak_debt_pence: messages.length ? null : 5_000_000,
    flags: [],
    validation_errors: messages.map((message) => ({
      severity: 'error' as const,
      field: 'finance.term_months',
      message,
    })),
  };
}

describe('unmeasuredCellNotes', () => {
  const TERM = 'Term must be a whole number of months, at least 1.';
  const TRANCHE = 'A sale tranche falls outside the programme term.';

  it('returns no notes for a fully measured grid', () => {
    const { notes } = unmeasuredCellNotes([[cell(0, 0), cell(0, 5)]]);
    expect(notes).toEqual([]);
  });

  it('gives a measured cell no note index', () => {
    const measured = cell(0, 0);
    const { noteIndexFor } = unmeasuredCellNotes([[measured, cell(0, 5)]]);
    expect(noteIndexFor(measured)).toBeNull();
  });

  // The common case: one lever position invalidates a whole row for one reason. A
  // per-cell note list would print the same sentence five times.
  it('deduplicates one reason shared across many cells into a single note', () => {
    const { notes, noteIndexFor } = unmeasuredCellNotes([
      [cell(-12, 0, TERM), cell(-12, 5, TERM), cell(-12, 10, TERM)],
    ]);
    expect(notes).toEqual([TERM]);
    expect(noteIndexFor(cell(-12, 5, TERM))).toBe(0);
  });

  it('keeps distinct reasons as separate notes, in first-appearance order', () => {
    const { notes, noteIndexFor } = unmeasuredCellNotes([
      [cell(0, 0), cell(0, 5, TRANCHE)],
      [cell(-12, 0, TERM), cell(-12, 5, TERM)],
    ]);
    // Row-major scan reaches TRANCHE first even though TERM's row is "worse".
    expect(notes).toEqual([TRANCHE, TERM]);
    expect(noteIndexFor(cell(0, 5, TRANCHE))).toBe(0);
    expect(noteIndexFor(cell(-12, 0, TERM))).toBe(1);
  });

  // A cell can carry more than one error-severity issue; the note is the whole reason,
  // joined the same way the tornado's omission sentences join theirs.
  it('joins a cell\'s several validation errors into one note', () => {
    const { notes } = unmeasuredCellNotes([[cell(-12, 0, TERM, TRANCHE)]]);
    expect(notes).toEqual([`${TERM} ${TRANCHE}`]);
  });

  // noteIndexFor is keyed on the reason, not on object identity — the memo and the page
  // hold different cell objects for the same position across re-renders.
  it('resolves a note index by reason rather than by object identity', () => {
    const { noteIndexFor } = unmeasuredCellNotes([[cell(-12, 0, TERM)]]);
    expect(noteIndexFor(cell(-99, 99, TERM))).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/sensitivity-format.test.ts -t "unmeasuredCellNotes"`
Expected: FAIL — `unmeasuredCellNotes is not a function` / not exported.

- [ ] **Step 3: Implement the builder**

Append to `frontend/src/lib/sensitivity-format.ts`. Add `SensitivityCell` to the existing `import type { MeasuredMetrics, SensitivityLever, TornadoBar } from './model/sensitivity';` line.

```ts
/** The result of scanning a matrix for positions the engine could not measure. */
export interface UnmeasuredCellNotes {
  /** Distinct reasons, in first-appearance order scanning the matrix row-major. */
  notes: readonly string[];
  /** Zero-based index into `notes`, or null when the cell is measured. */
  noteIndexFor(cell: SensitivityCell): number | null;
}

/**
 * The reasons a grid's unmeasured positions exist (spec §12.7), deduplicated, for a
 * caller to print beneath the matrix.
 *
 * Single source shared by the memo (export-investment-memo.ts) and the calculator's
 * Sensitivity page (SensitivityPage.tsx). Sharing it is the point: before R6 the page
 * put each cell's reason in a `<td title>` — invisible to assistive tech, print and
 * touch — while the memo printed a caption saying only that the ambiguity existed,
 * without ever naming which reason applied. Two surfaces, two different failures to
 * carry information the engine had already handed over.
 *
 * A cell's reason is its `validation_errors` messages joined, exactly as
 * `omittedTornadoNotes` joins a bar's. Deduplicating matters because the ordinary case
 * is one lever position invalidating an entire row for one reason.
 *
 * Keyed on the reason string rather than on cell identity: the page rebuilds its cell
 * objects on every render and the memo holds different objects again, so identity is
 * not stable across the callers that need this.
 */
export function unmeasuredCellNotes(
  matrix: readonly (readonly SensitivityCell[])[],
): UnmeasuredCellNotes {
  const reasonOf = (cell: SensitivityCell): string | null =>
    cell.validation_errors.length === 0
      ? null
      : cell.validation_errors.map((e) => e.message).join(' ');

  const index = new Map<string, number>();
  for (const row of matrix) {
    for (const cell of row) {
      const reason = reasonOf(cell);
      if (reason !== null && !index.has(reason)) index.set(reason, index.size);
    }
  }

  return {
    notes: [...index.keys()],
    noteIndexFor(cell) {
      const reason = reasonOf(cell);
      return reason === null ? null : index.get(reason) ?? null;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/sensitivity-format.test.ts`
Expected: PASS — all six new cases plus the pre-existing label/flag-code cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/sensitivity-format.ts frontend/src/lib/sensitivity-format.test.ts
git commit -m "feat(ui): one shared builder for a grid's unmeasured-cell reasons"
```

---

### Task 5: The page carries the reason visibly and programmatically

**Files:**
- Modify: `frontend/src/components/calculator/SensitivityPage.tsx:316-385`
- Test: `frontend/src/components/calculator/SensitivityPage.test.tsx:193-212` (replace that test)

**Interfaces:**
- Consumes: `unmeasuredCellNotes` from `../../lib/sensitivity-format` (Task 4).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Replace the title-based test with a failing accessibility test**

In `frontend/src/components/calculator/SensitivityPage.test.tsx`, **delete** the whole test `it('shows the validation reason on an unmeasured cell, and leaves measured cells untitled', …)` at lines 193-212 and put this in its place:

```ts
  // R6: `title` was the only carrier of an unmeasured cell's reason — invisible to a
  // screen reader, to print, and to touch, while the cell's "—" is indistinguishable
  // from a genuinely null metric. The reason now appears as visible text beneath the
  // matrix and is associated with each cell via aria-describedby.
  it('names an unmeasured cell\'s reason in visible text tied to the cell', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12' } });

    // One reason invalidates the whole row, so it is stated once, not five times.
    const notes = screen.getAllByRole('listitem');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(/whole number of months, at least 1/i);

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const cells = within(matrix).getAllByRole('cell');
    expect(cells).toHaveLength(5); // the default GDV column axis has 5 steps

    for (const cell of cells) {
      expect(cell).toHaveTextContent('—');
      expect(cell).toHaveStyle({ color: 'rgb(148, 163, 184)', fontStyle: 'italic' });
      // The association is programmatic, not just visual proximity.
      const describedBy = cell.getAttribute('aria-describedby');
      expect(describedBy).toBe(notes[0].id);
    }
  });

  // The retired carrier must actually be gone: leaving it would put the same sentence
  // in two places, which is the drift shape R4b and R5 each shipped once.
  it('no longer carries the reason in a title attribute', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12' } });

    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const titled = within(matrix).getAllByRole('cell').filter((c) => c.hasAttribute('title'));
    expect(titled).toEqual([]);
  });

  // A measured grid gets no notes and no markers at all.
  it('prints no notes when every position in the grid is measured', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  // Distinct reasons must not collapse into one note. A timeline row of -12 empties the
  // term; a GDV column of -100% zeroes every unit's estimated value (validation's
  // positive-value rule). The 2x2 grid of those two against a measured step gives
  // *three* distinct reasons, not two — the corner cell fails for both causes at once
  // and its note carries both sentences joined. That third note is the case worth
  // pinning: an implementation keyed on the first validation error alone would produce
  // two notes here and look correct.
  it('states each distinct reason as its own note, including a cell failing for two', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-12, 0' } });
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '-100, 0' } });

    const notes = screen.getAllByRole('listitem');
    expect(notes).toHaveLength(3);
    expect(new Set(notes.map((n) => n.textContent)).size).toBe(3);
    // Row-major order: the corner (-12, -100%) is reached first and carries both causes.
    expect(notes[0]).toHaveTextContent(/whole number of months, at least 1/i);
    expect(notes[0].textContent).toMatch(/value/i);
  });
```

If `/column steps/i` is not the accessible name the column step input actually carries, use whatever label the pre-existing test `it('re-runs the suite on an edited column step list', …)` at line 110 uses — do not add a new label.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/calculator/SensitivityPage.test.tsx -t "reason"`
Expected: FAIL — `getAllByRole('listitem')` finds no list, because the page renders no notes.

- [ ] **Step 3: Build the notes and render them**

In `frontend/src/components/calculator/SensitivityPage.tsx`, add `unmeasuredCellNotes` to the existing import from `'../../lib/sensitivity-format'`.

Inside the component, next to where `matrix` is derived, add:

```ts
  // §12.7: the reasons this grid's unmeasured positions exist, deduplicated. Built by
  // the shared module so the memo prints the same sentences from the same source —
  // neither surface writes its own explanation of what an unmeasured cell means.
  const cellNotes = useMemo(() => unmeasuredCellNotes(matrix), [matrix]);
```

Place it after `matrix` is in scope and before the `return`. If `matrix` is derived inside an existing `useMemo`, add this immediately after that hook.

Replace the `<td>` render (lines 358-380) with:

```tsx
                {row.map((cell: SensitivityCell) => {
                  const codes = flagShortCodes(cell.flags);
                  const noteIndex = cellNotes.noteIndexFor(cell);
                  const unmeasured = noteIndex !== null;
                  return (
                    <td
                      key={cell.col_step}
                      aria-describedby={unmeasured ? `sens-note-${noteIndex}` : undefined}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        color: unmeasured ? MUTED : metricColor(metric, cell[metric]),
                        fontStyle: unmeasured ? 'italic' : undefined,
                        fontWeight: cell.row_step === 0 && cell.col_step === 0 ? 700 : 400,
                      }}
                    >
                      {metricText(cell, metric)}
                      {unmeasured && (
                        // A text marker, not a colour or a style: it has to survive
                        // print, high-contrast mode and a screenshot.
                        <sup style={{ color: MUTED, fontSize: 11, marginLeft: 3 }}>
                          {noteIndex + 1}
                        </sup>
                      )}
                      {codes && (
                        <span style={{ color: RED, fontSize: 11, marginLeft: 6 }}>[{codes}]</span>
                      )}
                    </td>
                  );
                })}
```

Then, immediately after the closing `</table>` of the matrix and inside its scrolling `<div>`'s parent (so the notes are not clipped by `overflowX: auto`), add:

```tsx
      {/* §12.7: an unmeasured position prints the same "—" as a genuinely null metric
          (a zero-denominator ratio), so without the reason a reader cannot tell the two
          apart. Before R6 this lived only in a `<td title>` — unreachable by screen
          reader, print and touch — for information that is load-bearing. Each cell
          points here by aria-describedby; the marker is what a sighted reader follows.
          The sentences are the engine's own validation messages, built by the shared
          module the memo reads too. */}
      {cellNotes.notes.length > 0 && (
        <ol style={{ color: MUTED, fontSize: 13, marginBottom: 24, paddingLeft: 20 }}>
          {cellNotes.notes.map((note, i) => (
            <li key={note} id={`sens-note-${i}`}>
              Not measured — the levered document fails validation: {note} (spec §12.7).
            </li>
          ))}
        </ol>
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/calculator/SensitivityPage.test.tsx`
Expected: PASS — the four new cases plus every pre-existing case, including the mixed-axis test at line 166 (unchanged: its cells still contain `—`).

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc -b && npx eslint src/components/calculator/SensitivityPage.tsx src/lib/sensitivity-format.ts`
Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/calculator/SensitivityPage.tsx frontend/src/components/calculator/SensitivityPage.test.tsx
git commit -m "fix(ui): an unmeasured cell's reason reaches assistive tech, print and touch"
```

---

### Task 6: The memo prints the reasons instead of describing the ambiguity

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts:174-179` (the interface field), `:230-239` (the build), `:1372-1382` (the render)
- Test: `frontend/src/lib/export-investment-memo.test.ts`

**Interfaces:**
- Consumes: `unmeasuredCellNotes` from `./sensitivity-format` (Task 4).
- Produces: `MemoSensitivityTables` loses `hasUnmeasuredMatrixCells: boolean` and gains `unmeasuredCellNotes: readonly string[]`.

**Read this before writing the test — the §10 render path is not reachable from `generateInvestmentMemo`.** Running the default grid over every fixture in `fixtures/financial-model/` before this plan was written gives:

```
a-all-cash          unmeasured_cells=0  null_bars=0
f-dev-finance-12mo  unmeasured_cells=0  null_bars=0
g-lender-valuation  unmeasured_cells=0  null_bars=0
h-programme-scurve  unmeasured_cells=0  null_bars=0
i-phased-sales      unmeasured_cells=0  null_bars=1
j-blended-refinance unmeasured_cells=0  null_bars=1
```

The default grid moves GDV and construction cost by at most ±15%, and neither can drive a document into an error-severity validation issue — a unit's estimated value stays positive at −15%. So no matrix cell is ever unmeasured under the grid the memo uses, and the caption being replaced here (`hasUnmeasuredMatrixCells`) has never fired for any real document either. It is not dead code — a future grid, an edited default, or a document with a genuinely marginal unit value all reach it — but it cannot be exercised end-to-end through `generateInvestmentMemo`, which takes no config.

Therefore: **test this at the `sensitivityTables` level with an explicit config, and do not attempt a PDF-level assertion.** Record the reachability finding in the Task 11 report for the R7 backlog — the open question is whether §10 should print notes for a grid that cannot produce them, or whether the memo's grid should become configurable.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/export-investment-memo.test.ts`, inside the existing `describe('sensitivityTables — unmeasured tornado endpoint omission', …)` block or directly after it.

```ts
describe('sensitivityTables — unmeasured matrix cells name their reason', () => {
  // Fixture I is a 12-month phased-sales deal, so a timeline row of -12 empties the
  // term and every cell in that row comes back unmeasured (spec §12.7).
  function fixtureIInputs(): CalculatorInputsV4 {
    const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
    const parsed = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'i-phased-sales.json'), 'utf-8'),
    ) as { inputs: CalculatorInputsV4 };
    return structuredClone(parsed.inputs);
  }

  it('carries no notes for a grid whose positions are all measured', () => {
    expect(sensitivityTables(fixtureIInputs()).unmeasuredCellNotes).toEqual([]);
  });

  it('carries the engine\'s own reason, once, for a row invalidated by one cause', () => {
    const tables = sensitivityTables(fixtureIInputs(), {
      ...DEFAULT_SENSITIVITY_CONFIG,
      rows: { lever: 'timeline', steps: [-12, 0] },
      cols: { lever: 'gdv', steps: [-10, 0, 10] },
    });
    expect(tables.unmeasuredCellNotes).toHaveLength(1);
    expect(tables.unmeasuredCellNotes[0]).toMatch(/whole number of months, at least 1/i);
  });
});
```

`sensitivityTables` currently takes only `inputs`. If it does not accept a second `config` argument, give it one — `export function sensitivityTables(inputs: AnyCalculatorInputs, config?: SensitivityConfig)` — passing it straight through to `runSensitivity` exactly as `safeRunSensitivity` does, and import `SensitivityConfig` as a type. `generateInvestmentMemo` keeps calling it with one argument, so the memo's default grid is unchanged and the §10 regression pin still passes.

Add one more case, pinning the replaced caption as gone. This is the assertion that would catch a half-done edit that adds the notes but leaves the old sentence printing beside them:

```ts
  it('no longer carries the caption that only described the ambiguity', async () => {
    const text = await pdfText(
      generateInvestmentMemo(mockProject, runAppraisal(fixtureIInputs()), mockEligibility),
    );
    expect(text).not.toContain('may mean the metric is undefined');
  });
```

`DEFAULT_SENSITIVITY_CONFIG` needs adding to this test file's import from `./model/sensitivity`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/export-investment-memo.test.ts -t "unmeasured matrix cells"`
Expected: FAIL — `unmeasuredCellNotes` is undefined on the returned object.

- [ ] **Step 3: Replace the boolean with the notes**

In `frontend/src/lib/export-investment-memo.ts`:

Add `unmeasuredCellNotes` to the existing import from `./sensitivity-format`.

Replace the interface field at lines 174-179:

```ts
  /** The reasons this grid's unmeasured positions exist (spec §12.7), deduplicated and
   *  in first-appearance order, empty when every position was measured. A cell the
   *  engine could not measure prints the same "n/a" as a metric that is merely null
   *  (e.g. a zero-denominator ratio), so §10 prints these beneath the matrices to say
   *  which positions are which — and why, in the engine's own words rather than a
   *  rationale reconstructed here. Built by the shared module the Sensitivity page
   *  reads too. */
  unmeasuredCellNotes: readonly string[];
```

Replace the build at line 230:

```ts
  const cellNotes = unmeasuredCellNotes(result.matrix);
```

and the returned property:

```ts
    unmeasuredCellNotes: cellNotes.notes,
```

Replace the render at lines 1372-1382:

```ts
    // A matrix cell reads "n/a" for two different reasons that print identically: a
    // metric that is genuinely undefined (e.g. a zero-denominator ratio), or a position
    // the engine could not measure at all because its levered document failed
    // validation (spec §12.7). Printed only when the latter actually occurs in this
    // grid, so an ordinary deal's matrices carry no extra caption.
    //
    // R6: this used to say only that the ambiguity existed. The engine had already
    // handed over the exact reason for every unmeasured cell, so it now says which.
    for (const [i, note] of sens.unmeasuredCellNotes.entries()) {
      y = bodyText(
        y,
        `${i + 1}. Not measured — the levered document fails validation: ${note} (spec §12.7).`,
      );
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/export-investment-memo.test.ts`
Expected: PASS — including the §10 regression pin at line 635, which is unaffected because the matrix bodies themselves are untouched.

- [ ] **Step 5: Confirm no consumer of the removed field remains**

Run: `npx tsc -b`
Expected: no output. A stale `hasUnmeasuredMatrixCells` reference anywhere would fail the build here — that is the point of removing the field rather than deprecating it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-investment-memo.test.ts
git commit -m "fix(model): §10 names why a position was not measured"
```

---

### Task 7: Direct tests for the two predicates R5 moved

**Files:**
- Test: `frontend/src/lib/sensitivity-format.test.ts`

**Interfaces:**
- Consumes: `isMeasuredBar`, `omittedTornadoNotes` from `./sensitivity-format` (both already exist).
- Produces: nothing.

Both functions moved into `sensitivity-format.ts` in R5 and are currently reached only through page and memo tests, which pin rendered output rather than the predicate.

- [ ] **Step 1: Write the tests**

Add to `frontend/src/lib/sensitivity-format.test.ts`. Add `isMeasuredBar, omittedTornadoNotes` to the existing import, and add `import type { TornadoBar } from './model/sensitivity';`.

```ts
// Bars built by hand, not by running the suite: this tests the predicates, not the
// engine, and a literal keeps every branch reachable without hunting for a fixture.
function endpoint(profit: number | null, ...messages: string[]) {
  return {
    profit_pence: profit,
    profit_on_cost_pct: profit === null ? null : 20,
    profit_on_gdv_pct: profit === null ? null : 15,
    irr_annual_pct: profit === null ? null : 25,
    ltgdv_developer_pct: profit === null ? null : 60,
    peak_debt_pence: profit === null ? null : 5_000_000,
    flags: [],
    validation_errors: messages.map((message) => ({
      severity: 'error' as const,
      field: 'finance.term_months',
      message,
    })),
  };
}

function bar(
  lever: 'gdv' | 'construction_cost' | 'timeline' | 'interest_rate',
  low: ReturnType<typeof endpoint>,
  high: ReturnType<typeof endpoint>,
  span: number | null,
): TornadoBar {
  return { lever, low_step: -10, high_step: 10, low, high, span_pence: span };
}

describe('isMeasuredBar', () => {
  it('accepts a bar with a span', () => {
    expect(isMeasuredBar(bar('gdv', endpoint(1000), endpoint(2000), 1000))).toBe(true);
  });

  it('rejects a bar whose low endpoint was not measured', () => {
    expect(isMeasuredBar(bar('timeline', endpoint(null, 'x'), endpoint(2000), null))).toBe(false);
  });

  it('rejects a bar whose high endpoint was not measured', () => {
    expect(isMeasuredBar(bar('timeline', endpoint(1000), endpoint(null, 'x'), null))).toBe(false);
  });

  it('rejects a bar with neither endpoint measured', () => {
    expect(isMeasuredBar(bar('timeline', endpoint(null, 'x'), endpoint(null, 'x'), null))).toBe(false);
  });

  // The distinction the whole predicate exists to make: a genuine zero span is a
  // measurement, not an omission. Getting this wrong drops a real bar from the memo.
  it('accepts a genuine zero span', () => {
    expect(isMeasuredBar(bar('interest_rate', endpoint(1000), endpoint(1000), 0))).toBe(true);
  });
});

describe('omittedTornadoNotes', () => {
  const TERM = 'Term must be a whole number of months, at least 1.';
  const RATE = 'Interest rate must not be negative.';

  it('returns nothing when every bar is measured', () => {
    expect(omittedTornadoNotes([bar('gdv', endpoint(1000), endpoint(2000), 1000)])).toEqual([]);
  });

  it('carries the engine\'s own message for the omitted bar', () => {
    const notes = omittedTornadoNotes([bar('timeline', endpoint(null, TERM), endpoint(2000), null)]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Timeline omitted');
    expect(notes[0]).toContain(TERM);
    expect(notes[0]).toContain('(spec §12.7)');
  });

  // Different levers fail for entirely different reasons — an emptied term versus a
  // negative rate — which is exactly why the sentence must not be reconstructed by the
  // caller from the lever alone.
  it('gives each omitted bar its own reason, in bar order', () => {
    const notes = omittedTornadoNotes([
      bar('gdv', endpoint(1000), endpoint(2000), 1000),
      bar('timeline', endpoint(null, TERM), endpoint(2000), null),
      bar('interest_rate', endpoint(1000), endpoint(null, RATE), null),
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain(TERM);
    expect(notes[1]).toContain(RATE);
  });

  it('joins both endpoints\' reasons when neither was measured', () => {
    const notes = omittedTornadoNotes([bar('timeline', endpoint(null, TERM), endpoint(null, RATE), null)]);
    expect(notes[0]).toContain(TERM);
    expect(notes[0]).toContain(RATE);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lib/sensitivity-format.test.ts`
Expected: PASS on the first run — these pin behaviour that already exists. If any case fails, that is a real finding: stop and report it rather than adjusting the assertion to match.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/sensitivity-format.test.ts
git commit -m "test(ui): pin the two predicates R5 moved into sensitivity-format"
```

---

### Task 8: The 0-pence-versus-null span boundary, in both engines

**Files:**
- Modify: `frontend/src/lib/model/sensitivity.test.ts:169-181` (rewrite the re-sort assertion) and append a new case
- Modify: `tests/test_financial_model_sensitivity.py:147-153` (rewrite the re-sort assertion) and append a new case

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing.

**Why the existing assertions cannot be extended.** `sensitivity.test.ts:176` re-sorts with `(b as number) - (a as number)`, which yields `NaN` for a null and silently accepts any ordering. `test_financial_model_sensitivity.py:152` uses `sorted(spans, reverse=True)`, which raises `TypeError: '<' not supported between instances of 'int' and 'NoneType'` the moment a `None` enters. Both are unsound in the presence of a null span, one silently and one loudly.

**The fixture.** `a-all-cash` has `funding_source: "cash"` with `committed_net_facility_pence` and `committed_gross_facility_pence` both `0`, so there is no balance for a rate to accrue against and the `interest_rate` lever cannot move profit — a genuine 0-pence span. (The rate field itself is `annual_interest_rate_pct: 8.0`, not null; an earlier draft of this plan named a non-existent field and attributed the 0 span to the wrong cause. The span is real either way — it comes from the absent facility, not an absent rate.) Its term is 12 months, so a `timeline` low of −12 empties the term and gives a null span. Verified against the Python engine before this plan was written, with a tornado of `interest_rate ±1`, `gdv ±10`, `timeline −12/+3`:

```
gdv            23640000
interest_rate  0
timeline       None
```

The engine already orders these correctly. This task closes a coverage gap; it is not expected to find a defect.

- [ ] **Step 1: Rewrite the TS re-sort assertion**

Replace the body of `it('gives one tornado bar per configured range, sorted by span descending', …)` at lines 169-181 with:

```ts
  it('gives one tornado bar per configured range, sorted by span descending', () => {
    const { tornado } = runSensitivity(fixtureFInputs());
    expect(tornado).toHaveLength(4);
    const spans = tornado.map((b) => b.span_pence);
    // §12.7: a span is null only when an endpoint is unmeasured, which cannot happen for
    // Fixture F under the default tornado (its 9-month floor is a legal term).
    expect(spans.every((s) => s !== null && s >= 0)).toBe(true);
    // R6: the re-sort is null-aware. The previous form was `(b as number) - (a as
    // number)`, which produces NaN against a null and so accepts any ordering at all —
    // it could not have failed on the case Task 8 adds below.
    expect([...spans].sort(bySpanDescending)).toEqual(spans);
  });
```

Add this comparator at module scope in the same file, above the first `describe`. Both call sites pass spans, not bars, so it takes `number | null`:

```ts
/**
 * §12.4 extended by §12.7, as a comparator a test can re-sort spans with: a span comes
 * before a null, and wider spans come first. A null is not a number and must never
 * reach arithmetic — the form this replaces, `(b as number) - (a as number)`, yields
 * NaN against a null span, and a comparator returning NaN accepts whatever order it
 * was handed. It could not have failed on the case added below.
 *
 * The tie-break between two nulls is LEVER_ORDER, which lives in the engine; a
 * comparator over bare spans cannot express it, so it returns 0 and leaves the
 * relative order of nulls to the caller's assertion (see the LEVER_ORDER test that
 * already covers it).
 */
function bySpanDescending(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}
```

- [ ] **Step 2: Add the failing-if-broken TS boundary case**

Append inside the same `describe` block that holds the other §12.7 ordering tests (near `it('orders two spanless bars relative to each other by LEVER_ORDER', …)` at line 401):

```ts
  // The boundary §12.4/§12.7 has never been tested at: a *genuine* 0-pence span next to
  // a null one. Both print as "no movement" to a careless reader and both compare equal
  // under a null-as-zero sort, but they mean opposite things — one is a measurement
  // saying this lever does not matter for this deal, the other is the absence of a
  // measurement. A 0-pence span must sort ahead of every null span.
  //
  // `a-all-cash` is the fixture that produces the real 0: with no facility and no
  // interest rate, the interest_rate lever cannot move profit. Its 12-month term makes
  // a timeline low of -12 unmeasurable.
  it('sorts a genuine 0-pence span ahead of a null one', () => {
    const inputs = allCashInputs();
    const bars = runSensitivity(inputs, {
      ...DEFAULT_SENSITIVITY_CONFIG,
      rows: { lever: 'gdv', steps: [0] },
      cols: { lever: 'construction_cost', steps: [0] },
      tornado: [
        { lever: 'interest_rate', low: -1, high: 1 },
        { lever: 'gdv', low: -10, high: 10 },
        { lever: 'timeline', low: -12, high: 3 },
      ],
    }).tornado;

    // The premise: this fixture really does produce one of each.
    const spanOf = (lever: SensitivityLever) =>
      bars.find((b) => b.lever === lever)!.span_pence;
    expect(spanOf('interest_rate')).toBe(0);
    expect(spanOf('timeline')).toBeNull();
    // Narrowed before comparing: `toBeGreaterThan` on a `number | null` does not
    // type-check, and a cast here would be the same unsound move this task removes.
    const gdvSpan = spanOf('gdv');
    expect(gdvSpan).not.toBeNull();
    expect(gdvSpan as number).toBeGreaterThan(0);

    // The rule: measured bars first by span, the spanless bar last.
    expect(bars.map((b) => b.lever)).toEqual(['gdv', 'interest_rate', 'timeline']);
    // And the comparator agrees, which is what the re-sort assertion above relies on.
    expect([...bars.map((b) => b.span_pence)].sort(bySpanDescending))
      .toEqual(bars.map((b) => b.span_pence));
  });
```

Add the fixture loader next to the file's existing `fixtureFInputs`, following whatever pattern it uses:

```ts
function allCashInputs(): CalculatorInputsV4 {
  const raw = readFileSync(join(FIXTURE_DIR, 'a-all-cash.json'), 'utf-8');
  return structuredClone((JSON.parse(raw) as { inputs: CalculatorInputsV4 }).inputs);
}
```

If the file's existing loader migrates inputs (`migrateInputsToV4`) or parses them another way, mirror that exactly rather than introducing a second style. `SensitivityLever` must be in this file's type imports from `./sensitivity` for `spanOf` to type-check — add it if it is not already there.

- [ ] **Step 3: Run the TS tests**

Run: `npx vitest run src/lib/model/sensitivity.test.ts`
Expected: PASS. If `spans.get('interest_rate')` is not `0`, stop — the premise recorded above no longer holds and the fixture choice needs revisiting, which is a finding to report, not an assertion to relax.

- [ ] **Step 4: Rewrite the Python re-sort assertion and add the boundary case**

Replace `test_tornado_is_sorted_by_span_descending` at lines 147-153:

```python
def _by_span_descending(spans):
    """Sec 12.4 extended by Sec 12.7: bars with a span first, widest first; spanless
    bars last. sorted(spans, reverse=True) cannot express this -- it raises
    TypeError: '<' not supported between instances of 'int' and 'NoneType' as soon as
    a None enters the list, so the assertion it backed could never have been run
    against a grid containing an unmeasured endpoint.
    """
    return sorted(spans, key=lambda s: (s is None, -(s or 0)))


def test_tornado_is_sorted_by_span_descending():
    """Spec Sec 12.4."""
    bars = run_sensitivity(_inputs()).tornado
    assert len(bars) == 4
    spans = [b.span_pence for b in bars]
    assert spans == _by_span_descending(spans)
    # Sec 12.7: no span is null for Fixture F under the default tornado.
    assert all(s is not None and s >= 0 for s in spans)
```

Append the boundary case near the other Sec 12.7 ordering tests:

```python
FIXTURE_A = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "a-all-cash.json"


def _all_cash_inputs():
    return parse_calculator_inputs(json.loads(FIXTURE_A.read_text(encoding="utf-8"))["inputs"])


def test_genuine_zero_span_sorts_ahead_of_a_null_span():
    """Sec 12.4/Sec 12.7 at the boundary -- mirror of the TS suite.

    A 0-pence span is a measurement saying this lever does not move the deal; a null
    span is the absence of a measurement. They compare equal under a null-as-zero sort
    and mean opposite things. a-all-cash has no facility and no interest rate, so the
    interest_rate lever produces a real 0; its 12-month term makes timeline -12
    unmeasurable.
    """
    cfg = SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0]),
        tornado=[
            TornadoRange(lever="interest_rate", low=-1, high=1),
            TornadoRange(lever="gdv", low=-10, high=10),
            TornadoRange(lever="timeline", low=-12, high=3),
        ],
    )
    bars = run_sensitivity(_all_cash_inputs(), cfg).tornado
    spans = {b.lever: b.span_pence for b in bars}

    assert spans["interest_rate"] == 0
    assert spans["timeline"] is None
    assert spans["gdv"] > 0

    assert [b.lever for b in bars] == ["gdv", "interest_rate", "timeline"]
    ordered = [b.span_pence for b in bars]
    assert ordered == _by_span_descending(ordered)
```

- [ ] **Step 5: Run the Python tests**

Run: `pytest tests/test_financial_model_sensitivity.py -v`
Expected: PASS, including the rewritten sort test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/model/sensitivity.test.ts tests/test_financial_model_sensitivity.py
git commit -m "test(model): pin a genuine 0-pence span against a null one (§12.4/§12.7)"
```

---

### Task 9: §12.2's peak-debt behaviour becomes an assertion

**Files:**
- Modify: `frontend/src/lib/model/sensitivity.test.ts` (append near the existing `it('never re-sizes the facility, whatever the cell', …)`)
- Modify: `tests/test_financial_model_sensitivity.py` (append near its mirror)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing.

**What this settles.** R4 left an open question: `peak_debt_pence` looked identical across all five cost-lever steps on the York project while TDC and profit moved. It is §12.2 working, not a defect. `peak_debt_pence` is `max(balance)` from the monthly engine (`monthly-engine.ts:175`), and §12.2 holds the committed facility invariant — so once a facility is drawn to its ceiling the extra cost cannot become more debt and surfaces as `funding_gap` instead.

Fixture F shows both halves in one grid. Measured against the Python engine before this plan was written, with a `construction_cost` row axis of `[0, 5, 10, 15]` and a single `gdv` column step of `0`:

```
cost  +0%   peak 58604953   flags []
cost  +5%   peak 60887481   flags []
cost +10%   peak 63175677   flags []
cost +15%   peak 63448870   flags ['funding_gap']
```

The lever plainly moves peak debt (+2.28m, +2.29m), and then the ceiling bites: the last step adds only 0.27m and raises `funding_gap`. One fixture, both halves — do not go looking for a second one.

- [ ] **Step 1: Write the TS test**

Append to `frontend/src/lib/model/sensitivity.test.ts`, in the same `describe` block as `it('never re-sizes the facility, whatever the cell', …)`:

```ts
  // R4 carried an open question into three releases: peak_debt_pence looked unmoved by
  // the cost lever on one project while TDC and profit moved, which reads like a lever
  // that is not reaching the ledger. It is §12.2 working. peak_debt_pence is
  // max(balance) (monthly-engine.ts:175) and the committed facility is invariant, so a
  // facility drawn to its ceiling cannot take on the extra cost — it becomes a funding
  // gap instead. Both halves are asserted here so the question stops being re-opened.
  it('lets the cost lever move peak debt until the committed facility stops it (§12.2)', () => {
    const inputs = fixtureFInputs();
    const { matrix } = runSensitivity(inputs, {
      ...DEFAULT_SENSITIVITY_CONFIG,
      rows: { lever: 'construction_cost', steps: [0, 5, 10, 15] },
      cols: { lever: 'gdv', steps: [0] },
    });
    // Asserted, not cast. R5 widened these fields to `number | null` precisely so a
    // consumer has to handle the unmeasured case; a cast here would put back the
    // silence that widening removed. Cost and GDV steps never invalidate a document,
    // so all four are measured — and if that ever stops being true, this line says so.
    const peaks = matrix.map((row) => {
      const peak = row[0].peak_debt_pence;
      expect(peak).not.toBeNull();
      return peak as number;
    });
    const flags = matrix.map((row) => row[0].flags);

    // Half one — the lever reaches the ledger. Strict, because a lever silently stopped
    // being applied is exactly the regression that produces equality here.
    expect(peaks[1]).toBeGreaterThan(peaks[0]);
    expect(peaks[2]).toBeGreaterThan(peaks[1]);

    // Half two — the ceiling bites. The step into +15% adds an order of magnitude less
    // debt than the two before it, and the shortfall shows up as a funding gap rather
    // than as more borrowing.
    expect(peaks[3] - peaks[2]).toBeLessThan((peaks[2] - peaks[1]) / 2);
    expect(flags[0]).not.toContain('funding_gap');
    expect(flags[3]).toContain('funding_gap');

    // And the ceiling itself never moved — the constructive form of §12.2.
    expect(inputs.finance.committed_net_facility_pence).toBe(
      fixtureFInputs().finance.committed_net_facility_pence,
    );
  });
```

- [ ] **Step 2: Run the TS test**

Run: `npx vitest run src/lib/model/sensitivity.test.ts -t "committed facility stops it"`
Expected: PASS on the first run — this pins behaviour that already exists. A failure here is a real finding: report it rather than loosening the comparison.

- [ ] **Step 3: Write the Python mirror**

Append to `tests/test_financial_model_sensitivity.py`:

```python
def test_cost_lever_moves_peak_debt_until_the_facility_stops_it():
    """Spec Sec 12.2 -- mirror of the TS suite.

    R4 left this open: peak_debt_pence looked unmoved by the cost lever on one project.
    It is Sec 12.2 working. peak_debt_pence is max(balance) and the committed facility
    is invariant, so a facility drawn to its ceiling turns extra cost into a funding gap
    rather than into more debt.
    """
    cfg = SensitivityConfig(
        rows=SensitivityAxis(lever="construction_cost", steps=[0, 5, 10, 15]),
        cols=SensitivityAxis(lever="gdv", steps=[0]),
        tornado=[],
    )
    matrix = run_sensitivity(_inputs(), cfg).matrix
    peaks = [row[0].peak_debt_pence for row in matrix]
    flags = [row[0].flags for row in matrix]

    # Half one -- the lever reaches the ledger.
    assert peaks[1] > peaks[0]
    assert peaks[2] > peaks[1]

    # Half two -- the ceiling bites, and the shortfall is a funding gap, not more debt.
    assert peaks[3] - peaks[2] < (peaks[2] - peaks[1]) / 2
    assert "funding_gap" not in flags[0]
    assert "funding_gap" in flags[3]
```

- [ ] **Step 4: Run the Python test**

Run: `pytest tests/test_financial_model_sensitivity.py -k peak_debt -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/sensitivity.test.ts tests/test_financial_model_sensitivity.py
git commit -m "test(model): §12.2's peak-debt behaviour is asserted, not narrated"
```

---

### Task 10: Specification and test-case records

**Files:**
- Modify: `docs/financial-model/calculation-specification.md` (§12.7)
- Modify: `docs/financial-model/test-cases.md`

**Interfaces:**
- Consumes: the error type names from Task 1.
- Produces: nothing.

- [ ] **Step 1: Add the §12.7 sentence**

In `docs/financial-model/calculation-specification.md`, find the §12.7 paragraph beginning "If the **base** document yields an error-severity issue" and append immediately after it:

```markdown
This refusal is a distinct, identifiable condition — an invalid **base document** — and
is reported separately from §12.6's invalid **configuration**. A consumer distinguishes
the two by the error the suite raises (`InvalidBaseDocumentError`,
`InvalidSensitivityConfigError`), never by its message text. [R6]
```

- [ ] **Step 2: Confirm no version bump is implied**

Run: `grep -n "Calculation version" docs/financial-model/calculation-specification.md`
Expected: `**Status:** Authoritative. Calculation version `2.5.0`.` — unchanged. R6 changes no formula and no computed value; the sentence above names behaviour R5 already shipped. Do **not** add a changelog entry claiming a new version.

- [ ] **Step 3: Record the new cases**

In `docs/financial-model/test-cases.md`, add rows for the cases this release adds, following the file's existing column format:

- the two typed failures (§12.6, §12.7) and their distinguishability;
- the memo propagating a non-base-document failure rather than degrading §10;
- `safeRunSensitivity` rethrowing a failure that is not one of the two documented ones;
- a genuine 0-pence span sorting ahead of a null span (`a-all-cash`, both engines);
- the cost lever moving peak debt until the committed facility stops it (Fixture F, both engines);
- unmeasured-cell reasons reaching the page as visible text with `aria-describedby`, and the memo as numbered notes.

Leave the file's stated calc version at `2.5.0`.

- [ ] **Step 4: Commit**

```bash
git add docs/financial-model/calculation-specification.md docs/financial-model/test-cases.md
git commit -m "docs(model): §12.7 names the base-document refusal as a typed condition"
```

---

### Task 11: Full gates and whole-branch review

**Files:** none modified unless a gate fails.

R5 found two defects that every per-task review had passed — both of the same kind, a widened filter left with a narrowed explanation. This pass exists because that keeps happening.

- [ ] **Step 1: Run every gate**

```bash
cd frontend && npx vitest run && npx tsc -b && npx eslint . && npm run build
cd .. && pytest
```

Expected: all green. Record the vitest and pytest counts — they should exceed R5's 835 and 760 respectively.

- [ ] **Step 2: Read the whole branch diff against the two questions R5's findings came from**

```bash
git diff main...HEAD
```

Ask specifically:
1. **Does any explanation now cover fewer cases than the filter that reaches it?** Every sentence added in Tasks 5 and 6 is printed for a set of cells chosen by `unmeasuredCellNotes`. Does the sentence hold for every member of that set — including a cell unmeasured for a reason nobody anticipated?
2. **Does any surface now fail where it previously degraded?** Tasks 2 and 3 both narrow a catch. Walk the paths that used to be absorbed and confirm each one either still is, or genuinely should not be.

- [ ] **Step 3: Browser UAT of the Sensitivity page**

```bash
docker restart commercial-resi-analyser-frontend-1
```

Then, on a project whose appraisal loads: set the row lever to Timeline with steps `-12, 0`, confirm the unmeasured row shows `—` with a superscript marker, that a numbered note beneath the matrix names the term reason, and that no tooltip appears on hover. Export the investment memo for the same project and confirm §10 prints the same numbered note beneath the matrices.

- [ ] **Step 4: Report**

Write the implementation report to `docs/reviews/2026-08-16-release-6-implementation-report.md`, following the structure of `docs/reviews/2026-08-16-release-4b-implementation-report.md`. State the gate counts, anything the whole-branch review caught, and the R7 backlog.
