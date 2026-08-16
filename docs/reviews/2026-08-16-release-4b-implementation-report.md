# Release 4b — implementation report

**Date:** 16 August 2026
**Branch:** `release-4b-ui-memo`, cut from `main` at `d7ad919`, head `11ef103`
**Plan:** `docs/superpowers/plans/2026-08-16-release-4b-ui-memo.md`
**Design:** `docs/superpowers/specs/2026-08-16-release-4-design.md` §5
**UAT:** `docs/reviews/2026-08-16-release-4b-uat.md`

**Calc version unchanged at 2.4.0.** No calculation changed, no fixture changed, no Python changed. Every commit is confined to `frontend/` and `docs/`.

---

## What shipped

R4a built the fixed-facility sensitivity engine and wired it to nothing. R4b consumes it in the two places that matter.

**The investment memo's §10** no longer contains its own sensitivity logic. The grid steps, the lever rule and the FE/FG/NR flag policy were hardcoded inside `export-investment-memo.ts`, free to drift from the named-scenario code they share lever arithmetic with. They now come from `runSensitivity` and specification §12's normative default config — which is where R4a promoted those exact steps from. A new tornado table prints above the two matrices: the matrices show where covenants break across two levers at once, but a lender reading them could not tell which single assumption the deal was most exposed to.

**The calculator gained page 9, Sensitivity.** Before this, the two-way matrices a lender reads existed only inside the exported PDF — the Scenarios page showed three named scenarios and no grid, so nobody could see where the covenants broke without generating a memo. The page renders the tornado and the matrix with a selector over all six compact-record fields, carrying the memo's amber/red conventions and its flag codes onto the screen. Its axes are editable as **view state only**: no `onChange` prop exists on the component, nothing is written to `inputs`, no autosave fires, and a reload restores the specified defaults. That was the design's deliberate choice over an inputs v5 — no migration, no migration fixtures, and every appraisal's memo stays directly comparable.

Exit, Risk, Deal Spider and Investor renumbered to 10–13.

## Commits

| Commit | Task |
|---|---|
| `42cfb00` | Extract the §10 grid into `sensitivityTables()` and pin its printed output |
| `f0d4b87` | Reimplement it on `runSensitivity`; add `lib/sensitivity-format.ts` |
| `ea324fe` | Print the single-lever tornado in §10 |
| `56c220e` | `safeRunSensitivity` |
| `aa0b866` | Strengthen the clamping pin with `funding_gap` assertions (review fix) |
| `f19716d` | `SensitivityPage` — tornado and two-way matrix |
| `254a762` | Editable axes, as view state only |
| `11ef103` | Sensitivity becomes calculator page 9 |

## Gates

| Gate | Result |
|---|---|
| `npx vitest run` | **813 passed**, 44 files (baseline 776; +37) |
| `python -m pytest -q` | **750 passed** — unchanged, as required |
| `npx tsc -b` | clean |
| `npx eslint .` | clean |
| `npm run build` | built in 2.65s |
| Scope | nothing outside `frontend/` and `docs/` |
| `git stash list` | unchanged throughout (one pre-existing entry) |

Every task passed an independent spec-compliance and code-quality review. One fix round was needed, on Task 4.

---

## Decisions taken during implementation

**The refactor's no-op status was established before it was attempted, not asserted afterwards.** Task 1 extracted the grid loop verbatim and pinned all 25 cells plus the axis captions as exact string literals, captured from a live run of the calc-2.4.0 build. Task 2 then replaced the function body with an engine call and **the pin was not edited**. It passed first run. The memo's printed matrices are therefore provably unchanged, rather than believed to be.

Ordering the release this way — regression net first, feature second — is the single decision that most reduced risk here, and it is worth repeating on any refactor where an existing output must survive.

**Two errors in the plan's own test code were caught by implementers.** In Task 5, `getByText('-10% to +10%')` matched two nodes, because specification §12.4 gives GDV and construction cost identical ±10 ranges; replaced with a count assertion, which is strictly stronger. In Task 7, `render(<ConversionCalculator project={null} />)` could never have passed — the component short-circuits to a "select a project" message before the navigation renders; substituted the test file's existing project fixture. Both were disclosed rather than silently worked around, and both were independently confirmed by the reviewer before acceptance.

**The term guard exists because the engine does not reject an emptied term.** See below — this is the release's most significant finding.

**Nine tests, not the plan's stated eleven, in Task 6.** The plan's prose miscounted after one test was split into two; the code block always contained ten. The implementer transcribed the code and flagged the discrepancy rather than inventing a test to reach the stated number. Final count 813, not the plan's projected 814.

---

## Finding: the appraisal engine silently clamps an emptied term

Specification §12.6 constrains the `timeline` lever to whole months but says nothing about the term those months leave behind. It was assumed during design that an over-large negative step would surface as an engine rejection. It does not.

Verified against fixture F (a 12-month deal): timeline steps of **−11, −12 and −13** all return profit **26,556,933p** with a `funding_gap` flag. The engine clamps to a one-month term and returns a plausible-looking result. Three different assumptions, one identical answer, no error and no validation issue.

This is worse than a throw. A throw is visible; a clamp prints a number a reader will trust. Before R4b it was unreachable in practice, because the memo only ever ran the fixed default config. The Sensitivity page's axis editor makes it reachable by a user, which is why the guard was added there:

- `SensitivityPage` refuses any axis whose timeline step would leave a term below one month, and says so with the deal's actual term. The guard also covers the tornado's fixed −3 months, so a deal with a term under four months is caught with no user editing at all.
- `safe-sensitivity.test.ts` pins the clamping as **current behaviour**, with the `funding_gap` flag asserted on each cell so the pin fails if the mechanism changes rather than only if the numbers diverge.

**The guard is a page-level containment, not a fix.** The memo, the three named scenarios, and every other `applyScenario` caller remain exposed. The real fix is a §12.6 rule plus an engine-level rejection in both TypeScript and Python, with a fixture — which is a calculation change and therefore correctly outside this release.

---

## Carried forward

**To R5 — engine and specification:**

1. **Bound the resulting term in §12.6, and reject rather than clamp.** As above. Requires spec, both engines, and a fixture, under the governance §2 order. This is the priority item.
2. **Confirm whether peak debt should respond to the cost lever.** On the UAT project, `peak_debt_pence` is identical across all five cost steps while total development cost and profit both move. Plausibly correct for a `fund_as_required` equity rule, but unverified against the specification. The Sensitivity page is the first surface that makes it visible. See the UAT record.
3. **Tornado ranges are not editable** — only the matrix axes are. UI work with no specification implication, if users ask for it.
4. **The `kind !== 'sensitivity'` corpus filter is still hand-copied** into 3 TypeScript and 2 Python files (carried from R4a, untouched here).

**Deferred minor review findings**, none blocking merge, all recorded in the SDD ledger and triaged by the final whole-branch review:

- Tornado memo tests shape-check endpoint and swing values but pin no exact figure; a wrong-cell bug would escape unless it also broke ordering or sign.
- No test exercises `safeRunSensitivity`'s non-`Error` throw normalisation branch, though `safe-run.test.ts` has an equivalent.
- `SENSITIVITY_METRICS.kind` and `SensitivityMetrics`'s nullability are two independent sources of truth; `penceToPounds(null)` would coerce to `£0` if they ever diverged (unreachable today).
- `parseSteps`'s docstring claims malformed input is never dropped, but empty segments from a double or trailing comma are dropped. The behaviour is arguably the right call mid-typing; the comment overstates it.
- An unreachable `outcome === null` fallback branch in `SensitivityPage`, inherited from the plan text.
- The first `ConversionCalculator` test asserts button presence rather than tab order.

---

## Not pushed

Local `main` is **21 commits ahead of `origin/main` (`9c954f5`)** — R4a was never pushed, and this release adds to that. Pushing remains a separate, explicit decision.
