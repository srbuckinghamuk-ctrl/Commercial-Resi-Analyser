# Release 3a implementation report — programme engine (calc 2.2.0)

Date: 2026-08-14. Branch `worktree-release-3a-programme-engine` (13 commits,
`8a39edf..72fdbdf`), built on local `main` (which carries R1/R2a/R2b, unpushed to
origin). Plan: `docs/superpowers/plans/2026-08-14-release-3a-programme-engine.md`;
design: `docs/superpowers/specs/2026-08-14-release-3-design.md` §1 (scope), §2
(inputs v4), §3 (R3a engine) — §4/§5 are R3b and intentionally out of scope here.
Execution ledger: `.superpowers/sdd/2026-08-14-release-3a-programme-engine/progress.md`.

Every task (1–9) reviewed clean, most after one fix round; no task was rejected
outright. Calc version `2.1.0 → 2.2.0` (additive — every previously pinned fixture
value is unchanged; only `calc_version` itself differs, and it is not part of any
fixture's `expected_metrics`).

## Design §1–§3 → delivery map

| Design item | Delivered by (commits) |
|---|---|
| §1 scope: R3a boundary (calc 2.2.0), exit behaviour unchanged, R3b/R4 deferred lists | Task 1 `a43a7f9` + review fix `b6d1ae0` (reconciled release markers, dropped a phantom "upfront" curve kind that had leaked into a draft) |
| §2.1 `programme` block (nullable, packages × curve, `anchor_month` display-only) | Task 3 `e7cf5ef` (TS types + v3→v4 migration) |
| §2.2/§2.3 `sales_phasing`/`refinance` blocks (present in schema, inert in R3a) | Task 3 `e7cf5ef`; hard-rejected when non-null by Task 5 `7b26913` |
| §2.4 migration chain v1→v2→v3→v4; `programme`/`sales_phasing`/`refinance` default to `null` (identity by construction) | Task 3 `e7cf5ef` (TS); Task 8 `ae8c852` + fix `f260302` (Python — v3 snapshots weren't merging onto defaults in `migrate_inputs_to_v4`, a genuine parity gap caught in review) |
| §3.1 curve closed forms (`straight_line`, `s_curve`, `back_loaded`, `user_defined`) | Task 2 `88f4054` (TS `curves.ts`); Task 8 `ae8c852` (Python `curves.py` port, `math.cos`/`money_round`, same operation order) |
| §3.1 schedule consumes `programme`; `null` = auto §6 windows, byte-identical | Task 4 `3e897ac` (TS `buildSchedule`); Task 8 `ae8c852` (Python `build_schedule` mirror) |
| §3.1 window/curve validation (duration ≥ 1, start ≥ 0, ≥2-month sale tail, `user_defined` weight rules) | Task 5 `7b26913` (TS); Task 8 `ae8c852` (Python) |
| §2.4 inert-block hard rejection (`sales_phasing`/`refinance` non-null → validation error while calc is 2.2.0) | Task 5 `7b26913` (TS); Task 8 `ae8c852` (Python) |
| §3.2 flags-on-result refactor (`deriveMetrics` stops mutating `model.flags`; `breakeven_cap_exhausted` flag added) | Task 6 `fb2a0ec` (TS, new `breakevenFlags` helper + 3 UI/export call sites moved to `metrics.flags`); Task 8 `ae8c852` (Python mirror) |
| §3.3 obligation 1 — identity across the existing fixture corpus | Verified continuously by Tasks 4–9; final confirmation at Task 9 gates (all pre-R3a fixtures unchanged) |
| §3.3 obligation 2 — fixture H (s-curve construction, shifted windows, hand-derived) | Task 7 `d92f05d` (worksheet + JSON + TS golden test) + fix `aff42d0` (funding-gap pin + temporary Python skip pending Task 8); Task 8 `ae8c852` (Python golden test + cross-engine identity test) |
| §3.3 obligation 3 — Python↔TS invariant-matrix parity extended to new curves | Task 9 `72fdbdf` (+78/+78 symmetric additions to both matrices) |
| §5.2-equivalent governance (spec-then-fixture-then-code, worksheet before pinning) | Task 1 (spec amendment first), Task 7 (fixture H worksheet in `docs/financial-model/test-cases.md` before pinning) |
| R3a merge gate: all five gates green | Task 9 `72fdbdf` |

Fixture H (`fixtures/financial-model/h-programme-scurve.json`, `kind: "programme"`):
`f-dev-finance-12mo.json` with an explicit programme — construction 60,000,000p over
months 1–6 on `s_curve` (`[4,019,238, 10,980,762, 15,000,000, 15,000,000, 10,980,762,
4,019,238]`, hand-checked against `W(k) = (1 − cos(πk/6))/2` to 7 significant figures
in the worksheet), professional 3,600,000p over months 2–4 on `straight_line`,
statutory 3,000,000p over months 4–5 on `back_loaded`, prior-approval fee still at
month 0. `funding_gap_pence: 14,988,400`, pinned with an explicit negative control
(a deliberately wrong value fails the assertion) so the pin can't be a copy-paste
false pass. Worksheet: `docs/financial-model/test-cases.md` "Fixture H" section
(line 478).

## Gate results (Task 9, all green — re-verified for this report)

- Frontend vitest: **497 passed** (28 files) — re-run 2026-08-14, confirms the
  Task 9 ledger figure exactly (baseline was 358; +139 across all nine tasks).
- Frontend tsc (`tsconfig.app.json --noEmit`): clean — re-run, exit 0.
- Frontend eslint: clean — re-run, exit 0.
- Frontend production build (`npm run build`): succeeded — re-run, exit 0 (existing
  >500kB chunk-size warning only, pre-existing and unrelated to R3a).
- Backend pytest: **489 passed** — re-run 2026-08-14, confirms the Task 9 ledger
  figure exactly (baseline was 333; +156 across curves, types, migrate, schedule,
  validation, metrics, and fixture-H/identity tests).
- Invariant-matrix parity: +78 TS / +78 Python (symmetric), per the Task 9 ledger
  entry.

## Identity-invariant evidence

- **Structural**: `programme = null` (the v3→v4 migration default) takes the
  auto-windows branch in both `buildSchedule`/`build_schedule`, which is the
  pre-existing calc-2.1.0 straight-line code left untouched — not re-expressed
  through the new curve-weight functions (the plan explicitly forbids rerouting
  `spreadStraightLine`/`spread_straight_line`, since `Math.round(total/D)` and
  `Math.round(total·(1/D))` can differ by 1p under double rounding). Identity
  therefore holds by construction, not by numeric coincidence.
- **Regression proof**: fixtures A, F, G (spanning basic, dev-finance, and
  lender-valuation cases) reproduce their pinned calc-2.1.0 `expected_metrics`
  unchanged when run through the full v4 migration chain in both engines — this
  is the direct evidence for design §3.3 obligation 1, exercised by the Task 9
  gate run above.
- **New-path proof**: fixture H pins the explicit-programme path end-to-end
  (funding_gap_pence 14,988,400 plus the full worksheet-derived `expected_metrics`
  set) with a negative-control check, in both the TS golden test
  (`golden-fixtures.test.ts`) and the Python golden/identity test added in Task 8.
- **Cross-engine float risk** (noted in the plan's self-review, carried forward
  here): `s_curve` cosines are IEEE doubles in both engines with identical
  operation order; a divergence would require an ideal monthly value within
  ~1e-9 of a .5p rounding boundary. Fixture H and the parity matrix are the
  tripwire; per the plan, any future divergence is resolved by spec amendment
  (tabulated weights), not ad-hoc rounding.

## Deviations from plan, with rationale

- **Task 5 test-data defect (plan errata, not implementation)**: the plan's
  boundary test for the ≥2-month sale tail rule contradicted its own formula —
  it asserted `start_offset: 6, duration_months: 6` both breached and sat at the
  boundary. Adjudicated before implementation: the formula governs, the plan
  was wrong. Fixed in the plan file itself via `5f14ddc` ("fix Task 5 tail-rule
  test data — start 6 breaches, start 5 is the legal boundary"), and the
  corrected boundary is now pinned on both sides (accepted at start 5, rejected
  at start 6) in `validation.test.ts`.
- **Task 6 fixture-units defect (plan errata, not implementation)**: the plan's
  "agent fee ≥ 100%" test fixture set the fee without units, making the
  developer-breakeven-unreachable branch untestable as written. Adjudicated
  pre-review: fixed with a one-unit correction to the fixture, plus two
  pre-existing tests updated from asserting on `model.flags` to `r.flags` (the
  intended effect of the Task 6 refactor, not a scope change) — folded into
  `fb2a0ec`.
- **Task 8 TS-parity gap caught in review, not anticipated by the plan**: the
  plan's Python `migrate_inputs_to_v4` v3-arm did not merge saved values onto
  defaults the way the TS `migrateInputsToV4` does (`migrate.ts:326-339`). The
  reviewer caught this as a genuine cross-engine parity gap (not a stylistic
  choice) and required a fix before approval — landed in `f260302`, verified
  group-for-group against the TS merge branch, with the backend suite re-run at
  411 passed / 0 failed by an independent re-reviewer at that point in the
  sequence (the suite grew further through Task 9 to the final 489).
- **Task 7 scope extension, approved**: fixing the fixture-H funding-gap pin and
  temporarily skipping the not-yet-ported Python v4 golden test required touching
  `test_financial_model_cost_to_complete.py` (an adjacent test file asserting on
  the same fixture set), outside the plan's originally listed file list for
  Task 7. Approved as an in-scope extension because it was required to keep the
  backend suite green until Task 8 landed the Python port.

No other deviations: every other task's implementation matches its plan section
as written (curve formulas, migration shape, schedule branch, validation rules,
flags-on-result refactor, and the version bump all landed as specified).

## Deferred / known items

**Carried into the R3b entry checklist (must be resolved before R3b writes any
v4 snapshot to the database):**

- **Data-loss hazard, unresolved**: `ConversionCalculator.tsx:101` (state
  hydration on load) and `ExportPage.tsx:93` (`computeSpider` input) still call
  `migrateInputsToV3`, not `migrateInputsToV4`. Task 7 switched the two call
  sites the plan named (the `runAppraisal` feed paths) to v4, but these two
  additional sites were identified in review as also needing the switch. They
  are inert today only because persisted state is still schema v3 (nothing yet
  writes a v4 snapshot); the moment R3b's Programme UI persists a `programme`
  block, a saved v4 document loaded through either of these paths would fall
  through `isV3`'s check to the v1 fallback path and silently garble finance
  terms. Flagged as an IMPORTANT R3b-entry blocker in the execution ledger;
  confirmed still present in the codebase as of this report.
- Stale docstring: `tests/test_financial_model_fixtures.py:177`
  (`TestInvariantMatrix`) still reads "4 derived variants" — Task 7 added a 5th
  (the programme variant) but the comment wasn't updated. Cosmetic; confirmed
  still present.
- `docs/financial-model/calculation-specification.md` — one cross-reference at
  the original §5.10 text still says "re-derived when the dated programme lands
  (R3)"; this is now stale (R3a implemented the programme; the CTC re-derivation
  itself is R3b's §4.3, per design). Deferred at Task 1 review to the Task 9
  version-reference sweep; carried forward since it references R3b work, not an
  R3a gap.

**Pre-existing backlog (not introduced by R3a):**

- mypy: 35 pre-existing errors across 11 files (re-run for this report: confirms
  35, 17 of them in `app/persistence/repositories.py`); none in any R3a-touched
  file (`curves.py`, `schedule.py`, `migrate.py`, `types.py` are all clean).
  Declared but not enforced as a gate — candidate for a dedicated future task.
- `app/api/app.py` runs `run_appraisal` before its hard-error validation check
  completes (pre-existing ordering, noted again during Task 8 review; a
  validate-then-run reorder candidate for a future task).

**Minor items accepted without follow-up action** (recorded in the ledger,
judged not worth a task): Task 2's `backLoaded`/`userDefined` curves lack
explicit `months <= 0` / negative-total unit tests (the paths are exercised
indirectly through `spreadByCurve` and validation); Task 4's
`schedule.test.ts` statutory-split assertion for the auto path is tautological
with the existing back-loaded-split test (curve *shape* coverage lives in
`curves.test.ts`); the `breakevenFlags` call site could carry a one-line
"single call after both solvers" comment; the worksheet's month-0
fee-before-advance ordering matches the engine but not the literal listing
order in spec §4.2 (pre-existing, one-line spec clarification suggested, not
an R3a regression).

**Unchanged from the R3 design's explicit scope boundaries** (§1): R3b (phased
sales, refinance, re-derived cost-to-complete, Programme/Exit UI, live browser
UAT) and R4+ (fixed-facility sensitivity suite, pari-passu draw rule, VAT
modelling, developer/lender mode split, exit-fee band holdback refinement,
equity `timing_month` enforcement, parking/external-space valuation, unit-level
sales tranches and lender release pricing, residual-price fixed-point
refinement) are both untouched by this release, exactly as scoped.

## Release 3a status after this report

R3a (programme engine, calc 2.2.0) is complete on the
`worktree-release-3a-programme-engine` branch, all nine implementation tasks plus
this report. All five gates green with counts re-verified independently for
this report (frontend vitest 497, tsc clean, eslint clean, build clean; backend
pytest 489). The identity invariant holds across the full pre-existing fixture
corpus and the new fixture H. The one carried-forward blocker for R3b is the
`migrateInputsToV3` call sites in `ConversionCalculator.tsx` and
`ExportPage.tsx`, which must be switched to v4 before R3b's Programme UI can
safely persist a `programme` block.
