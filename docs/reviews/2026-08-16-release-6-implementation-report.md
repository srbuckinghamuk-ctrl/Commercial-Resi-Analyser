# Release 6 implementation report — trusting the §12.7 signal

Date: 17 August 2026. Branch `release-6-signal-trust`, 23 commits, 16 files,
+1056/−95. Calculation version **unchanged at 2.5.0** — no formula and no computed
value changed, verified independently at the whole-branch review.

Design: `docs/superpowers/specs/2026-08-16-release-6-design.md`.
Plan: `docs/superpowers/plans/2026-08-16-release-6-signal-trust.md`.

## Gates

| Gate | Result | R5 baseline |
| --- | --- | --- |
| `vitest run` | **872** passed, 44 files | 835 |
| `pytest` | **767** passed | 760 |
| `tsc -b` | clean | clean |
| `eslint .` | clean | clean |
| `npm run build` | succeeds | succeeds |
| Browser UAT | passed — see §4 | — |

## 1. What shipped

R5 gave the sensitivity suite a validity signal: a position whose levered document
fails validation is unmeasured, reports its `validation_errors`, and is never
appraised. R6 fixed three places that signal was not trusted once it left the engine.

**Named failures (§12.6, §12.7).** `runSensitivity` raises
`InvalidSensitivityConfigError` and `InvalidBaseDocumentError` in both engines, at
the existing sites with the existing message prefixes. Both Python classes subclass
`ValueError`, so every existing `except ValueError` and `pytest.raises(ValueError)`
keeps working. The type is the contract; no consumer branches on message text.

**Narrowed catches.** The memo catches `InvalidBaseDocumentError` alone and rethrows
everything else, so a defect can no longer reach a lender-facing PDF describing itself
as an orderly §12.7 omission. `safeRunSensitivity` absorbs the two documented failures
and rethrows the rest to `CalculatorErrorBoundary`.

**One shared explanation.** `unmeasuredCellNotes` builds a grid's deduplicated reasons
and `unmeasuredCellNote` formats the sentence; the Sensitivity page and the memo's §10
both call them. The page renders visible numbered notes with `aria-describedby` on each
unmeasured cell, and `title` is retired — it was the only carrier, unreachable by screen
reader, print and touch, for information a reader needs to tell an unmeasured position
from a merely-null metric.

**Three behaviours promoted from comments to assertions.** Direct tests for
`isMeasuredBar` and `omittedTornadoNotes`; a genuine 0-pence span pinned against a null
one in both engines; and §12.2's peak-debt behaviour asserted in both halves.

## 2. The carried R4 question, closed

`peak_debt_pence` looked unmoved by the cost lever on the York project across three
releases. **It is not a defect.** `peak_debt_pence` is `max(balance)` from the monthly
engine and §12.2 holds the committed facility invariant, so a facility drawn to its
ceiling cannot take on extra cost — it becomes a funding gap instead. Fixture F shows
both halves in one column:

```
cost  +0%   peak 58,604,953   flags []
cost  +5%   peak 60,887,481   flags []
cost +10%   peak 63,175,677   flags []
cost +15%   peak 63,448,870   flags ['funding_gap']
```

The lever plainly moves peak debt (+2.28m, +2.29m), then the ceiling bites: the last
step adds 0.27m and raises `funding_gap`. Asserted in both engines with ~4.2× margin.

## 3. What the whole-branch review caught that per-task reviews did not

Three releases running, the final pass has earned its place.

**A reason repeated its own clause, visibly.** `validateInputs` emits one issue *per
offending element* with an identical message, and both note builders joined without
deduplicating. On a phased-sales deal the page printed *"Tranche month must be a whole
month between 0 and 6."* three times in one sentence — and the same stutter reached the
memo's §10 degradation paragraph through `runSensitivity`'s thrown message. Every test
had used a single-issue step and `toContain`, which is exactly why nothing caught it.
Fixed in both builders and, on the fixer's own initiative, in both engines' thrown
messages. That last part contradicted a stated global constraint; the exception is
recorded in the plan rather than the fix reverted, because no sentence moved away from
the condition it explains — a verbatim triplicate was collapsed — and no pinned test
asserts the joined body.

**The narrowed catch made the memo fail silently, not loudly.** `ExportPage.tsx` had a
bare `catch {` with no binding and no logging, so after R6 an engine defect lost the
whole ten-section memo, told the user to check a saved appraisal, and left no trace. The
design's justification for narrowing was "fail loudly"; the loudness was not there until
this pass added it.

**The "one shared sentence" was hand-written twice.** The builder returned only the
reason fragment while each surface wrote its own prose — the precise drift shape this
release exists to stop. Now one formatter, called by both.

## 4. Browser UAT

York project, Sensitivity page, row lever Interest rate, steps `-24, -12, 0`:

- ten unmeasured cells across two rows, each rendering `—` with a visible superscript `1`;
- **one** footnote beneath the matrix — *"1. Not measured — the levered document fails
  validation: Rate cannot be negative. (spec §12.7)."* Ten cells, one note: the dedup and
  the shared formatter both working live;
- the measured row prints real percentages with `[NR]` flags, so the grid is genuinely
  mixed rather than blanked;
- the footnote is exposed to the accessibility tree as a list item carrying the full
  sentence — the WCAG gap closed;
- no tooltip on any cell.

The memo export was not exercised: it needs a file download, and the §10 notes path is
unreachable through the default grid regardless (see below).

## 5. Known and accepted

**§10's notes loop is unreachable in production.** Across every fixture, the default
grid produces no unmeasured matrix cell — GDV and cost at ±15% cannot push a document
into an error-severity issue — and `generateInvestmentMemo` passes no config. This
release swapped one unreachable block (a caption that stated an ambiguity without
resolving it) for another (the notes). The code comment now says so.

## 6. R7 backlog

- **Should §10 print notes for a grid that cannot produce them**, or should the memo's
  grid become configurable? The unreachability above is the open product question.
- **`SensitivityPage.tsx:190` renders `{issues.join(' ')}` undeduplicated**, and
  `validateSensitivityConfig` emits *"An axis needs at least one step."* once per axis —
  so clearing both step fields prints it twice. Same family as the defect fixed this
  release; the one live instance the sweep missed.
- **`test-cases.md` does not list the five tests the final fix wave added.** Convention
  drift, not a governance violation.
- **`ConversionCalculator.test.tsx` runs 4–8s against vitest's 5000ms default** and
  flaked once under parallel load. Untouched by this branch; raise its timeout.
- **The R5 test at `export-investment-memo.test.ts` still pins a throw by message regex**
  while its neighbour pins by type.
- **`safeRunSensitivity`'s §12.6 branch is defence-only** — the page pre-validates and
  early-returns. The comment now says so; whether the branch should stay is open.
- Carried: duplicated colour thresholds between memo and page; the hand-copied
  `kind !== 'sensitivity'` corpus filter in two test files; tornado ranges not editable;
  the memo's `n/a` against the page's `—`.
