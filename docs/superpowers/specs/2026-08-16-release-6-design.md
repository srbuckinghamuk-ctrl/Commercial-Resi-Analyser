# Release 6 design — trusting the §12.7 signal

Date: 2026-08-16. Status: approved in brainstorming session. Works against
`docs/financial-model/calculation-specification.md` at calc **2.5.0**, under the
governance rules in `docs/financial-model/model-governance.md`.

**No calculation version bump.** R6 changes no formula and no computed value. §12.7 gains
one sentence naming a condition it already describes; the engine's behaviour under that
condition is exactly what R5 shipped.

## 1. The problem

R5 gave the sensitivity suite a validity signal: a position whose levered document fails
validation is not measured, reports its `validation_errors`, and is never appraised
(§12.7). The signal is correct at the engine. R6 is about the three places it is not
trusted once it leaves.

### 1.1 Every throw reads as a §12.7 omission

`runSensitivity` has exactly two expected failures, both raised as bare `Error`/`ValueError`
distinguished only by a message prefix:

- `Invalid sensitivity config: …` — §12.6, the axes/tornado config is not a grid
  (`sensitivity.ts:279`, `sensitivity.py:248`);
- `Invalid base document: …` — §12.7, the base document itself fails validation
  (`sensitivity.ts:288`, `sensitivity.py:256`).

Both consumers catch *everything*:

- `export-investment-memo.ts:1278` wraps `sensitivityTables(inputs)` in a bare
  `try/catch` and renders any thrown value as the §10 degradation R5 added — the
  section states that the analysis was not produced and prints `err.message` as the
  reason. A genuine engine defect — a bad accessor, an arithmetic fault, an
  `autotable` failure — therefore reaches a lender-facing PDF dressed as an orderly
  validation outcome. The reader cannot tell the two apart, and neither can we.
- `safe-sensitivity.ts` does the same for the Sensitivity page, converting any throw
  into `{ ok: false, error }` which the page renders as *"The sensitivity suite could
  not be calculated"*. Less misleading than the memo — the message is at least shown
  verbatim — but it still routes a defect into a panel that means "your inputs did
  not describe a runnable suite", and keeps it away from `CalculatorErrorBoundary`,
  which is where every other calculator page sends a genuine fault.

The catch is right; its width is wrong. Neither consumer can express "only the failures
the engine documents" because the engine does not give those failures a type.

### 1.2 The reason an unmeasured cell exists is carried only by `<td title>`

`SensitivityPage.tsx:365` puts an unmeasured cell's `validation_errors` message into the
`title` attribute and nothing else. The cell prints `—`, in muted italic, and that is all
a user gets who is:

- using a screen reader (`title` on a `<td>` is inconsistently exposed and never
  reliably announced);
- printing the page or reading a screenshot;
- on a touch device, where there is no hover.

The information is load-bearing: `—` is also what a genuinely null metric prints (a
zero-denominator ratio), so without the reason a reader cannot distinguish "this ratio is
undefined here" from "this position was never appraised". This is a real WCAG failure, not
a nicety.

The same gap exists in the memo, in a different form. `export-investment-memo.ts:1377`
prints a single generic footnote when any matrix cell is unmeasured:

> `"n/a" above may mean the metric is undefined for that position, or that the position
> itself could not be measured — its levered document failed validation and no appraisal
> was run for it (spec §12.7).`

It states that the ambiguity exists and then leaves it unresolved, though the engine
handed over the exact reason for each cell. This is the third instance of one shape:
**a filter that sees every case, paired with an explanation that does not.** R4b shipped a
clamped figure under a general caption; R5's Task 5 widened the omitted-bar filter to all
unmeasured bars and kept a term-specific sentence. Fixing it once, in the module both
surfaces read from, is the point.

### 1.3 Three assertions that cannot currently fail

- **`isMeasuredBar` and `omittedTornadoNotes`** moved into `sensitivity-format.ts` in R5
  and have no direct tests. `sensitivity-format.test.ts` covers labels, units and flag
  short codes only. Both functions are reached indirectly through page and memo tests,
  which pin rendered output rather than the predicate.
- **The tornado sort assertions treat a null span as comparable to a number.**
  `sensitivity.test.ts:176` re-sorts with `(b as number) - (a as number)`;
  `test_financial_model_sensitivity.py:152` uses `sorted(spans, reverse=True)`. On
  Fixture F no span is null, so both pass — but neither could distinguish a null span
  from a genuine 0-pence span if one appeared, and the Python form raises `TypeError`
  outright the moment a `None` enters the list. No fixture currently produces both a
  null span and a real 0-pence span at once, so the ordering rule of §12.4/§12.7 —
  *bars with a span first, spanless bars last* — has never been tested at its actual
  boundary, which is a 0-pence span sorting **ahead** of a null one.
- **§12.2's peak-debt behaviour is recorded in a comment, not an assertion.** R4 left an
  open question: `peak_debt_pence` was identical across all five cost-lever steps on the
  York project while TDC and profit moved. It is not a defect. `peak_debt_pence` is
  `max(balance)` from the monthly engine (`monthly-engine.ts:175`), and §12.2 holds the
  committed facility invariant, so a facility already drawn to its cap cannot go higher
  and the extra cost surfaces as `funding_gap`. The engine proves the other half already:
  `sensitivity.test.ts` records Fixture F's worst corner (`construction_cost +15%`,
  `gdv −15%`) driving peak debt to 63,448,870p. Both halves live in prose. Neither is
  asserted, so the question can be re-opened by the next reader.

### 1.4 Scope

One release. Explicitly **not** included, carried to R7:

- editable tornado ranges in the UI;
- the cleanup list: colour thresholds duplicated between memo and page, duplicate axis
  steps colliding React keys, the hand-copied `kind !== 'sensitivity'` corpus filter
  (`golden-fixtures.test.ts:61`, `invariants.test.ts:26`);
- the memo's `n/a` against the page's `—`.

## 2. Design

### 2.1 Named engine errors (§12.6, §12.7)

Both engines gain two exported error types, raised at the existing throw sites with the
existing messages:

```ts
// frontend/src/lib/model/sensitivity.ts
export class InvalidSensitivityConfigError extends Error {}   // §12.6
export class InvalidBaseDocumentError extends Error {}        // §12.7
```

```python
# app/financial_model/sensitivity.py
class InvalidSensitivityConfigError(ValueError): ...   # Sec 12.6
class InvalidBaseDocumentError(ValueError): ...        # Sec 12.7
```

Both Python classes subclass `ValueError`, so any existing `except ValueError` and every
`pytest.raises(ValueError)` in the mirror suite keeps working unchanged. The message text
is untouched in both engines, so R5's pinned memo strings and the page's rendered reason
survive byte for byte.

The classes are the contract. **No consumer may match on message text** — that coupling is
what makes an explanation drift away from the condition it explains, which §1.2 shows this
codebase doing three times.

`model/index.ts` and `financial_model/__init__.py` still must not import or re-export
`sensitivity`; consumers import the module directly, as they do today.

### 2.2 Narrowed catches

**Memo** (`export-investment-memo.ts`): catch `InvalidBaseDocumentError` only, and rethrow
everything else. §10's degradation is the documented response to one documented condition;
anything else is a defect and must fail the export loudly rather than describe itself as a
validation outcome. `InvalidSensitivityConfigError` is deliberately *not* caught: the memo
only ever passes the fixed default config, so reaching it would itself be a defect.

**Page** (`safe-sensitivity.ts`): return `{ ok: false }` for the two named errors and
rethrow anything else, letting `CalculatorErrorBoundary` take it — the surface every other
calculator page already uses for a genuine fault.

This second half extends the original backlog item from the memo to its sibling surface.
It is a deliberate behaviour change: today an unexpected throw keeps the page's axis
editor and shows its message in a failure panel; afterwards it blanks to the boundary.
That is the correct trade — the panel's copy asserts a cause it has not established, and
a defect that presents as a handled input error is a defect that stays unfixed.

### 2.3 One shared note-builder for unmeasured cells

New export in `frontend/src/lib/sensitivity-format.ts`:

```ts
export function unmeasuredCellNotes(matrix: readonly (readonly SensitivityCell[])[]): {
  /** Distinct reasons, in first-appearance order (row-major). */
  notes: readonly string[];
  /** Zero-based index into `notes` for a cell, or null when the cell is measured. */
  noteIndexFor(cell: SensitivityCell): number | null;
}
```

A cell's reason is its `validation_errors` messages joined — the same string the `title`
carries today, built once. Distinct reasons are deduplicated, so a grid whose whole
bottom row fails for one reason gets one note, and a grid failing for two reasons gets
two. Order is first appearance scanning row-major, which is stable and needs no sort.

Both surfaces consume it. Neither builds the sentence itself, and neither writes a
sentence of its own about what an unmeasured cell means.

### 2.4 The page: visible markers, footnotes, `aria-describedby`

An unmeasured cell renders its `—` followed by a superscript marker (`¹`, `²`, …) and
carries `aria-describedby` pointing at the corresponding note's element id. Beneath the
matrix, the notes render as an ordered list in the same muted style the tornado's
omission paragraph already uses — the pattern exists in this file and is being mirrored,
not invented.

`title` is **removed** from the cell. A visible note plus a programmatic association
supersedes it, and keeping it would leave the same sentence in two carriers, which is the
drift shape §1.2 is about.

The marker is text, not colour or style alone, so it survives print, high-contrast mode
and a screenshot.

### 2.5 The memo: the same notes, in place of the generic caption

The `hasUnmeasuredMatrixCells` boolean on `MemoSensitivityTables` is replaced by
`unmeasuredCellNotes: readonly string[]` from the shared builder. §10 prints the numbered
notes beneath the matrices when the array is non-empty, in the omission-stated style §10
already uses for a dropped tornado bar.

Cells themselves are not marked in the PDF. `cellText` prints `fmtPctSafe(...)` = `n/a`
for both an unmeasured position and a genuinely null metric, and threading per-cell
markers through `autotable` bodies would change every pinned matrix string in
`export-investment-memo.test.ts` for a table the reader takes in whole. The notes name
the reasons that occur in this grid; that is what the old caption promised and did not
deliver.

### 2.6 Tests

**Direct predicate tests** (`sensitivity-format.test.ts`) for `isMeasuredBar` (measured,
one endpoint unmeasured, both unmeasured) and `omittedTornadoNotes` (no omissions → empty;
one omission → the engine's own message; several → one sentence each, bar order preserved).
Both built from literal `TornadoBar` values, not from a suite run, so the predicate is
tested rather than the fixture.

**The 0-vs-null span boundary.** A tornado config combining a lever whose endpoints are
both measured and identical in profit (a genuine 0-pence span) with a lever that has an
unmeasured endpoint (a null span). `a-all-cash` is the fixture that produces a real
0-pence span — with no debt, the `interest_rate` lever cannot move profit. Assertions, in
**both** engines: the 0-pence bar sorts ahead of every null-span bar, and the null-span
bars sort last in `LEVER_ORDER`.

Verified against the Python engine before writing this spec, with `a-all-cash` and a
tornado of `interest_rate ±1`, `gdv ±10`, `timeline −12/+3`:

```
gdv            23640000
interest_rate  0
timeline       None
```

The engine already orders these correctly — this is a coverage gap, not a defect. Note
that `sorted([23640000, 0, None], reverse=True)` raises
`TypeError: '<' not supported between instances of 'int' and 'NoneType'`, so the Python
assertion as written today cannot be run against this case at all.

The existing re-sort assertions are rewritten null-aware rather than extended — the TS
cast and the Python `sorted(..., reverse=True)` are both unsound in the presence of a
`None`/`null`, one silently and one by `TypeError`.

**§12.2 peak debt, both halves** (`sensitivity.test.ts` + the Python mirror): under the
cost lever, `peak_debt_pence` moves on a fixture with headroom under its committed
facility, and is pinned at the cap with a rising `funding_gap` on one drawn to it. The
committed facility fields are identical in every cell either way. This is the assertion
that retires R4's carried question.

**Narrowed catches.** The memo degrades §10 for an `InvalidBaseDocumentError` (R5's
`equity_draw_rule: 'pari_passu'` case still produces a watermarked ten-section memo) and
**propagates** any other throw. `safeRunSensitivity` returns `ok: false` for both named
errors and rethrows a foreign one.

**Accessibility.** The page renders one list item per distinct reason, each cell's
`aria-describedby` resolves to the matching note's id, and no `title` attribute remains on
a matrix cell.

## 3. Specification change

§12.7 gains one sentence, naming the condition it already describes so the engine's error
types have a normative referent:

> This refusal is a distinct, identifiable condition — an invalid **base document** — and
> is reported separately from §12.6's invalid **configuration**. A consumer distinguishes
> the two by the error the suite raises, never by its message text.

Editorial: it names behaviour R5 shipped and changes no computed value. Calc version
stays **2.5.0**; `docs/financial-model/test-cases.md` is updated for the new cases.

## 4. Gates

Unchanged from R5: `vitest`, `pytest`, `tsc -b`, `eslint`, production build, and browser
UAT of the Sensitivity page (`docker restart commercial-resi-analyser-frontend-1` first).
Both engines must mirror file-for-file.
