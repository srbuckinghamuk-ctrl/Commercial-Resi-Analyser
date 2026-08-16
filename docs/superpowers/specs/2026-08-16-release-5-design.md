# Release 5 design — sensitivity cell validity

Date: 2026-08-16. Status: approved in brainstorming session. Extends
`docs/financial-model/calculation-specification.md` (calc 2.4.0 → 2.5.0) under the
governance rules in `docs/financial-model/model-governance.md`.

## 1. The problem

`runSensitivity` reduces every position — matrix cell and tornado endpoint — to the
compact record of §12.3:

```
profit_pence, profit_on_cost_pct, profit_on_gdv_pct,
irr_annual_pct, ltgdv_developer_pct, peak_debt_pence, flags
```

`measure()` calls `runAppraisal(applyScenario(...))` and keeps `.metrics` only. It
discards `run.validation` and `run.reconciliation` entirely. So when a lever produces a
document the engine *knows* is invalid, the suite reports its numbers as though they were
a measurement.

### 1.1 What is and is not broken

**The engine is not silent, and this is not a defect in the term arithmetic.** For a
levered document with `finance.term_months` of 0 or below, `runAppraisal` already returns
an error-severity validation issue — `finance.term_months: "Term must be a whole number
of months, at least 1."` — from `validation.ts:61` / `validation.py:83`, and sets
`reconciliation.report_safe = false`. The `Math.max(1, ...)` clamp at `schedule.ts:28`
(mirrored at `schedule.py:127`) is defensive: it keeps the ledger from crashing while
validation carries the finding.

The defect is that **the suite never asks**. Verified against Fixture F (a 12-month deal):
timeline steps of −11, −12 and −13 all return profit **26,556,933p** with a `funding_gap`
flag. Three different assumptions, one identical answer, because −12 and −13 both clamp to
a one-month term — and the error-severity issue that says so is dropped on the floor by
`measure()`.

Spec §12.3 defines a cell as "one ordinary appraisal … reduced to the compact record" and
never says what a cell is when that appraisal fails validation. The gap is in §12.

### 1.2 Why it matters

R4b demonstrated the cost. Adding the tornado put the `timeline` lever into the
lender-facing PDF for the first time, and for a deal with `term_months ≤ 3` the memo
printed the clamped one-month figure as "Profit at low", in bold, uncaveated. It was
contained presentationally (`isUnsoundTornadoBar`), but containment at the presentation
layer means every future consumer must remember to guard. The engine surface remains able
to hand out metrics for a document it knows is invalid.

### 1.3 Scope

One release. Explicitly **not** included, carried on from the R5 backlog:

- whether `peak_debt_pence` should respond to the `construction_cost` lever (an open
  question about existing ledger behaviour, not a known defect);
- the cleanup list: colour thresholds duplicated between memo and page, duplicate axis
  steps colliding React keys, `DEFAULTS.tornado` held as a shared module-level reference,
  the memo's `n/a` against the page's `—`, and the hand-copied `kind !== 'sensitivity'`
  corpus filter.

## 2. Specification — new §12.7 "Cell validity"

> A **measurement** is produced only for a levered document that passes validation. Before
> measuring, the levered document is validated (§10). If validation yields any
> **error**-severity issue, the position is **not measured**: it reports those issues and
> every metric field is null.
>
> Warning-severity issues do not invalidate a position.
>
> **Reconciliation status is not a validity signal.** A position raising
> `facility_exceeded`, `funding_gap` or `senior_outstanding_at_maturity` is a valid
> measurement, and those flags are the finding (§12.2).
>
> This applies identically to matrix cells and tornado endpoints. A tornado bar with an
> unmeasured endpoint has no span; §12.4's ordering places bars with no span after all
> bars with a span, in the fixed lever order.
>
> If the **base** document yields an error-severity issue, the suite raises an input error
> (§12.6) rather than returning a grid: §12.5 makes the base case an identity with the
> unadjusted appraisal, so no position in the suite is meaningful.

§12.3 gains a cross-reference to §12.7.

### 2.1 Two properties this wording buys

**It is general, not term-specific.** The rule keys off validation, not off
`term_months`, so a lever that pushes any other field out of range is already covered —
including levers added by later releases.

**An unmeasured position never runs the ledger.** `runSensitivity` validates the levered
document first and skips `runAppraisal` entirely when it fails. The suite therefore stops
depending on the `Math.max(1, …)` clamp not crashing. The clamp stays exactly where it is;
it simply stops being load-bearing.

### 2.2 Why `report_safe` cannot be the signal

At `term_months = 1` — a perfectly legal position — Fixture F already reports
`reconciliation.report_safe = false`, because the one-month term produces a funding gap.
Stress positions raising FE/FG/NR is the entire purpose of the grid. Keying validity off
`report_safe` would mark most of a healthy downside grid unmeasured and destroy the
analysis §12 exists to provide.

## 3. The compact record

```ts
export interface SensitivityMetrics {
  profit_pence: number | null;           // widened
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  irr_annual_pct: number | null;
  ltgdv_developer_pct: number | null;
  peak_debt_pence: number | null;        // widened
  flags: FlagCode[];                     // empty when unmeasured
  validation_errors: ValidationIssue[];  // empty ⇔ measured
}
```

`validation_errors` carries **error-severity issues only**. Warnings are excluded by
construction, which is what makes `validation_errors.length === 0` an exact test for
"measured" — a measured position that happens to carry warnings (Fixture F carries one, on
`conversion_costs.total_construction_sqm`) must still report an empty array.

`TornadoBar.span_pence` becomes `number | null`, null when either endpoint is unmeasured.

`app/financial_model/sensitivity.py` mirrors this field-for-field, with `Optional[int]` /
`Optional[float]` and `list[ValidationIssue]`.

### 3.1 Why nullable fields rather than a discriminated union

A union (`{ status: 'measured', … } | { status: 'invalid', … }`) would make it impossible
in TypeScript to reach `profit_pence` without narrowing first. It was considered and
rejected: it restructures `sensitivity.ts` and both consumers substantially, and Python
gains no compile-time benefit from it.

Nullable fields capture most of the same guarantee at a fraction of the blast radius. The
four percentage fields are *already* nullable, so consumers already handle nulls there;
widening `profit_pence` and `peak_debt_pence` is small and mechanical, and every
TypeScript consumer that reads either one **fails to compile until it handles null**. The
R4b defect becomes unwritable rather than merely caught.

`validation_errors` carries the existing shared `ValidationIssue` type rather than a
boolean, so a consumer can state *why* a position is unmeasured rather than only that it
is.

## 4. Fixture K gains an unmeasured case

Fixture K's existing thirty-four appraisals all remain valid and **no existing expected
value changes**: a 12-month base with a ±3 timeline range spans 9–15 months throughout.
What the corpus lacks is any exercise of the new path, so Fixture K gains a second config:

```json
"invalid_case": {
  "config": {
    "rows": { "lever": "timeline", "steps": [-12, -11, 0] },
    "cols": { "lever": "gdv", "steps": [0] },
    "tornado": [
      { "lever": "gdv",               "low": -10, "high": 10 },
      { "lever": "construction_cost", "low": -10, "high": 10 },
      { "lever": "timeline",          "low":  -3, "high":  3 },
      { "lever": "interest_rate",     "low":  -1, "high":  1 }
    ]
  },
  "expected": {
    "unmeasured_rows": [-12],
    "measured_rows": [-11, 0],
    "unmeasured_error": {
      "field": "finance.term_months",
      "severity": "error",
      "message": "Term must be a whole number of months, at least 1."
    }
  }
}
```

The `-11` row is deliberate: it leaves exactly one month and **must still measure**. That
pins the boundary from both sides in the fixture itself rather than only in unit tests.

**Hand derivation (governance §2 step 2).** Arithmetic-free: `12 + (−12) = 0`, and
`0 < 1`, therefore unmeasured; `12 + (−11) = 1`, and `1 ≥ 1`, therefore measured. There is
no worksheet to record, so §2.1's recorded Fixture K exception needs no extension.

## 5. Consumers, and two guards that come out

**`isUnsoundTornadoBar` is deleted** from `frontend/src/lib/sensitivity-format.ts`, along
with its call sites in the memo and the page. **`SensitivityPage`'s `term + step < 1` axis
guard is deleted.** Both were R4b containments for precisely this condition; once §12.7
specifies it, keeping them would be two answers to one question, and the ad-hoc ones are
the worse answers.

What replaces them is strictly more informative. Today a timeline axis of `-12, -11, 0`
refuses the whole grid. Afterwards it renders three rows — one unmeasured with its reason,
two measured — so an analyst sees exactly where the deal stops being modellable instead of
being told the entire request was bad.

- **Investment memo §10.** Unmeasured cells print `—`. A tornado bar with a null span is
  omitted, with the omission stated beneath the table. That is the behaviour R4b shipped,
  now driven by the specified rule rather than a local predicate.
- **`SensitivityPage`.** Unmeasured cells render muted, carrying the validation message.
  Unmeasured tornado bars show as unavailable with the reason.

## 6. Versioning, structure and gates

**Calc 2.4.0 → 2.5.0.** Minor: every existing fixture value is unchanged; this adds a
capability and widens a type.

**One release, not two sub-releases.** R4 split a/b, which does not work here — widening
`profit_pence` to `number | null` breaks the memo and the page at compile time
immediately, so an engine-only sub-release would leave the tree not building. Spec, both
engines, fixture and both consumers move together, which is also what governance §2
step 3 requires.

**Gates:** `npx vitest run`, `python -m pytest -q`, `npx tsc -b`, `npx eslint .`,
`npm run build`, plus golden-fixture parity between the two engines.

`tsc --noEmit` is inert in this repo — `tsconfig.json` has `"files": []` with project
references, so only `tsc -b` checks anything. Do not substitute it.

## 7. Documentation changes

- `docs/financial-model/calculation-specification.md` — new §12.7; cross-reference from
  §12.3; bump the calc version to 2.5.0.
- `docs/financial-model/model-governance.md` — calc version bump.
- `docs/financial-model/test-cases.md` — Fixture K's `invalid_case` and its derivation.
- `CALC_VERSION` in `app/financial_model/types.py` and its mirror in
  `frontend/src/lib/model/finance-types.ts`.

## 8. Constraints carried from R4

- **Import-cycle rule:** `frontend/src/lib/model/index.ts` must not import or re-export
  `sensitivity`, and `app/financial_model/__init__.py` must not import `sensitivity`.
  Consumers import the module by its own path. `sensitivity.ts` may import `validateInputs`
  from `./index` — it already imports `runAppraisal` from there, so this opens no new cycle.
- **`sensitivity-format.ts` and `safe-sensitivity.ts` stay outside `lib/model/`**, which
  mirrors the Python engine file-for-file and must gain no counterpart for them.
- **No Tailwind classNames** — the codebase styles exclusively with inline styles.
- Money is integer pence; percentages are floats; rounding is half-up (§1.1).
