# Release 3b implementation report — exits + UI (calc 2.3.0)

Date: 2026-08-15. Branch `worktree-release-3b-exits-ui` (19 task commits,
`c0e498e..d81165e`), built on local `main` (R3a head `33eba7b`, which carries
R1/R2a/R2b/R3a, unpushed to origin) plus the plan commit `612e0d2` and a
pre-execution plan-errata fix `c0e498e` (Task 6's worksheet tightness-test
assertion was tautological as written — corrected to assert the replay
predicate actually flips at the solved `g`, before any task ran). Plan:
`docs/superpowers/plans/2026-08-15-release-3b-exits-ui.md`; design:
`docs/superpowers/specs/2026-08-14-release-3-design.md` §4 (exit waterfall and
metrics), §5 (UI, testing, gates) — §1–§3 are R3a and out of scope here.
Execution ledger: `.superpowers/sdd/2026-08-15-release-3b-exits-ui/progress.md`.

Fourteen tasks (1–13 implementation + this report). Every task reviewed
clean, most after one fix round; no task was rejected outright. Task 8's
first submission was `DONE_WITH_CONCERNS` (an engine defect it surfaced, not
introduced) and upgraded to `DONE` once the cross-task fix landed. Calc
`2.2.0 → 2.3.0` — additive for every input with `sales_phasing = null` and
`refinance = null` (the migration defaults): every previously pinned fixture
value is unchanged, only `calc_version` differs.

## Design §4/§5 → delivery map

| Design item | Delivered by (commits) |
|---|---|
| §4.1 Phased-sales sweep: tranche gross/cost split, sweep mandatory repayment, fee-once, declining redemption schedule | Task 4 `87595e1` (TS tranche receipts + ledger mechanics, `finance-types.ts`/`schedule.ts`/`monthly-engine.ts`); Task 6 `232406a` + fix `25fa0a3` (§5.11 phased solver); Task 7 `5b80222`/`ac04292` (fixture I) |
| §4.2 Refinance (retained exits): net proceeds, sweep-then-refinance ordering, surplus/shortfall, IRR terminal flow | Task 5 `b92b303` (TS refinance redemption event); Task 8 `dc8d9b3` (fixture J) + the `f2246f2` §7 fix (refinance-shortfall equity excluded from sources=uses, see below) |
| §4.3 Cost-to-complete: §5.10 formula unchanged, automatically re-derived on the dated programme (ledger-driven) | No code change — the design states this explicitly ("§5.10's formula is unchanged — it reads the ledger"); confirmed by Task 9's parity port and the invariant matrix carrying I/J through the full fixture suite without touching cost-to-complete logic |
| §5.1 UI: Programme page, Exit page tranche/refinance editors, cashflow + memo programme-dated columns | Task 11 `a28b244` (Programme page, `formatProgrammeMonth`, page renumbering); Task 12 `65bb0de` (Exit page sales-tranche editor + refinance block); Task 13 `d81165e` (Cashflow page + investment-memo tranche/refinance/redemption-schedule rows) |
| §5.2 Testing/governance: hand-derived fixtures I/J, invariant-matrix extension, migration-fixture Python port | Task 7 `ac04292` (fixture I worksheet + golden test); Task 8 `82f9e60` (fixture J worksheet + golden test, after fix round); Task 9 `2f24a34` (Python mirror: validation/schedule/engine/breakeven/metrics + fixtures I/J, unskipped); Task 10 `36e6440` (sweep-conservation invariant matrix, 240→264 checks/language) |
| §5.3 Gates and UAT | Task 10 `36e6440` (mid-branch gate confirmation, 652/642); Task 14 (this report, final gate re-run, 687/642) — R3b's live-browser-UAT clause is **Task 15, not yet run** (see UAT below) |
| Entry checklist: v4 hydration lift, downgrade-shim removal | Task 2 `aaa60b7` |
| Spec (calc 2.3.0 amendment) | Task 1 `3e35eb8` + review fix `cdf1738`; further amended mid-branch by Task 6's fix `25fa0a3` (§5.11 fee-reserve redesign) and Task 8's fix `82f9e60` (§3.12 refinance-profit correction) — see "Spec corrections" below |

## Spec corrections during implementation

Three normative corrections to `docs/financial-model/calculation-specification.md`
were made mid-branch, each triggered by a genuine defect or contradiction
surfaced during implementation review, not a stylistic change:

1. **§5.11 phased-regime monotonicity defect (human ruling, commit `25fa0a3`).**
   Task 6's review proved the plan's literal replay — mirroring the ledger's
   own partial-sweep clamp — makes feasibility **non-monotone** in the trial
   gross sale price `G` (a discontinuity at the point an intermediate
   tranche's sweep first reaches the balance), which can make the shared
   bisection solver converge on the wrong boundary or return `null` for a
   genuinely solvable input. Put to the user via `AskUserQuestion`: **ruling
   was to reserve the exit fee from every tranche's sweep in the replay**
   (`repayment = max(0, sweep − fee)`, full redemption at `sweep ≥ balance +
   fee`), a conservative, monotone-by-construction assumption, documented in
   the spec as an explicit deviation from §4.4's actual ledger clamp that
   overstates the phased break-even by at most one fee per tranche. Landed in
   both engines — TS at `25fa0a3`, folded directly into the Python port at
   Task 9 rather than ported-then-patched.
2. **§3.12 refinance-profit clause correction (commit `82f9e60`).** Task 1's
   in-spirit repair of a stale R1-era cross-reference overshot into an
   arithmetic claim — literally read, it would have refinance proceeds enter
   profit directly, double-counting the retained asset already priced into
   the numerator at its §3.11 valuation. Fixture J's review caught the
   contradiction (worksheet pinned `profit_pence` 24,693,400 /
   `profit_is_unrealised: true`, which only the valuation-basis reading
   produces). Corrected: a modelled refinance is a **financing event**, not a
   profit event — it converts senior development debt into investment debt
   secured on the retained asset; its effect is on the *timing and
   composition of equity cash flows* (§3.15→§3.17), not the profit formula.
3. **§7 financing-side exclusion for refinance-shortfall equity (controller
   ruling, commit `f2246f2`).** Task 8 surfaced that the §4.5 refinance
   shortfall arm (`additionalEquity += required − refiNet`) has no matching
   entry in §7's uses list — its counterpart is a facility redemption, not a
   project cost — so `sources_equal_uses` went false by exactly the
   shortfall (40,164,953 pence in the isolated repro). Adjudicated: refinance
   equity is a financing-side flow, symmetric with how sale-proceeds
   repayments are already excluded from both sides of §7; `MonthlyModel.totals`
   gained `refinance_shortfall_equity_pence`, subtracted from sources in
   `reconcile()`, while still counting toward `additional_equity_required`,
   equity contributed, and the equity cash-flow vector. Task 13 found and
   fixed the same gap in `export-investment-memo.ts`'s independent
   `sourcesAndUsesTotals()`, which duplicated §7's identity without the
   exclusion.

## Gate results (Task 14, re-run for this report)

- Frontend vitest: **687 passed** (32 test files), `npx vitest run`,
  49.92s — matches the Task 13 ledger figure exactly (baseline 505 at branch
  start; +182 across all thirteen tasks).
- Frontend tsc (`tsconfig.app.json --noEmit`): clean, exit 0.
- Frontend eslint (`npx eslint .`): clean, exit 0.
- Frontend production build (`npm run build`): succeeded, exit 0
  (`✓ built in 6.39s`; pre-existing >500kB chunk-size warning only, unrelated
  to R3b).
- Backend pytest (`python -m pytest -q`, repo root): **642 passed**, 79.24s —
  matches the Task 10 ledger figure exactly (baseline 496 at branch start;
  +146, all landed by Task 9's Python port and Task 10's invariant-matrix
  extension; Tasks 11–13 are frontend-only and added no backend tests).

All five gates green, re-verified independently for this report.

## Identity-invariant evidence

- **Pre-R3b fixtures unchanged through the new code paths.** Fixtures A, F,
  G, H (golden) and the ledger/migration fixture set reproduce their pinned
  `expected_metrics` unchanged when run through the R3b code: `sales_phasing
  == null` takes the byte-identical single-final-month-tranche branch in
  `buildSchedule`/`build_schedule` (Task 4, verified by the explicit
  `'null phasing is byte-identical to the single final-month disposal'` test
  asserting `toEqual` against the pre-existing schedule), and `refinance ==
  null` never enters the new refinance block in `monthly-engine.ts`/`engine.py`
  at all. This is the direct evidence for the plan's Global Constraint
  ("every pre-existing fixture reproduces its pinned values unchanged; only
  `calc_version` changes") and is exercised on every gate run above (the full
  vitest/pytest suites include the full pre-existing fixture corpus).
- **Null-block byte-identity is structural, not coincidental.** Per the plan's
  explicit instruction (mirroring R3a's rule for `spreadStraightLine`), the
  `sales_phasing == null` receipts branch and the pre-existing sweep arms
  were left untouched rather than re-expressed through the new tranche code —
  confirmed for the flags-refactor-equivalent case in Task 6's review by
  diffing `metrics.ts`: the `phasing == null` branch is the original 13-line
  senior-breakeven block moved inside a new `if`, zero textual change beyond
  re-indentation.
- **Single-100%-tranche degeneracy.** Task 4's identity test additionally
  proves the general-K-tranche split code, when fed a single tranche at
  100% in the final month, produces the exact same `Schedule` object as the
  `null` path — i.e. identity holds even when routed *through* the new
  splitting code with a degenerate input, not just when the new code is
  bypassed entirely.
- **Cross-engine parity, first-run.** Task 9's Python port matched every one
  of fixtures I and J's pinned values byte-for-byte on the first execution
  (no divergence, no root-causing needed) — including the fee-reserve
  monotonicity fix folded directly into the initial port rather than
  ported-then-patched. Task 10's sweep-conservation invariant matrix (6 runs
  × 4 invariants = 24 checks/language, symmetric TS/Python) passed on first
  run for both engines with no engine change made to satisfy it.
- **Sources = uses (§7), post-fix.** After `f2246f2`, `reconcile(...)
  .sources_equal_uses is True` for both fixtures I and J in both engines
  (Task 9's parity confirmation), closing the shortfall-equity gap described
  above.

## Fixtures I and J

**Fixture I** (`fixtures/financial-model/i-phased-sales.json`, kind
`"phased-sales"`): `f-dev-finance-12mo.json` with `sales_phasing` — three
tranches (`sell_all`) splitting the gross receipts across months 9–11 — and
no refinance. Months 0–8 are cited from fixture F's ledger (same uses
schedule, facility terms, equity). Headline pinned values: senior break-even
`61,457,939`, declining redemption schedule `[53,431,299 / 10,782,708 / 0]`
across months `[9, 10, 11]` (the fee lands at month 10, the tranche that
completes redemption), `redemption_balance_at_disposal_pence = 0` (fully
redeemed with margin — the opposite side of J's non-zero pin),
`funding_gap_pence = 0`, `peak_debt_pence = 53,431,299`, `profit_pence =
24,237,292`. Task 7's review independently reproduced all 29 pinned values
and confirmed the break-even minimal by exhaustive integer scan (not just a
tolerance check).

**Fixture J** (`fixtures/financial-model/j-blended-refinance.json`, kind
`"refinance"`, but carrying both `sales_phasing` and a `blended` route):
`f-dev-finance-12mo.json` with `route: "blended"` (units u1–u3 sold, u4
retained), phased sales 60%@m9/40%@m11 on the sold portion, and a refinance
at m11 (investment value 30,000,000 @ 65% LTV, 300,000 arrangement +
100,000 legal → net proceeds 19,100,000). Month 11 exercises §4.5's fixed
sweep-then-refinance order: the tranche-2 sweep alone completes redemption
(fee charged there, once), so the refinance meets a zero balance and its
full 19,100,000 distributes. Headline pinned values: senior break-even
(sold-portion-only, refinance excluded per §5.11) `60,768,066`, fee charged
at month 11's sweep, `redemption_balance_at_disposal_pence = 4,946,600`,
`redemption_schedule_months = [9, 11]`, `redemption_schedule_balances_pence
= [53,431,299, 4,946,600]`, profit `24,693,400` with `profit_is_unrealised:
true` and `unrealised_value_pence = 30,000,000` (realised-basis check: Σ
equity flows = 13,793,400 = 90,000,000 gross sale + 19,100,000 refinance −
95,306,600 TDC, independently reconciling to the penny), `equity_multiple =
1.39`, `irr_annual_pct = 52.16` (hand-solved by Newton's method from two
independent starting points, agreeing to 3×10⁻⁷). Task 8's review
independently reproduced all 30 pinned values to the penny at first
submission; the one open item (the §7 sources=uses defect) was a genuine
engine defect the fixture surfaced, not a fixture or worksheet error, and
was closed by `f2246f2` before the task's status upgraded to DONE.

## Deviations from plan, with rationale

- **Task 6 worksheet arithmetic slip (plan errata, corrected before
  implementation completed, `232406a`).** The plan's own hand-derivation for
  the first `solveSeniorBreakevenPhased` test asserted a minimum G of
  `10,715,164`; re-derivation found the plan's algebra self-inconsistent
  (`10,715,164/2 × 2.02 = 10,822,315.7`, not the equation's own RHS
  `10,824,321.6`). Corrected independently three ways (closed-form
  re-derivation, exhaustive integer replay scan, and cross-check against the
  next test's independently derivable value) to **10,717,150**; the solver
  code itself (unchanged from the plan's listing) reproduces this exactly.
  Only the test's expected constant and inline comment were corrected.
- **Task 6 §5.11 monotonicity defect** — see "Spec corrections" above;
  recorded here too since it required deviating from the plan's literal
  replay transcription (an additional, uninstructed fix to
  `solveSeniorBreakevenPhased`'s upper-bound seed was also needed: the
  closed-form `hi` estimate under-bounded the true minimum for the
  fee-reserve replay, fixed by doubling `hi` — capped at 64 iterations —
  until genuinely feasible before bisecting, confirmed correct by an
  exhaustive integer scan).
- **Task 8 engine defect surfaced, not fixed in-task (per its file-scope
  rule); fixed in the immediately following cross-task commit `f2246f2`** —
  see "Spec corrections" above (§7 exclusion).
- **Task 1 in-spirit additions beyond the brief's verbatim text.** The spec
  amendment task additionally fixed a stale §3.12 R1-era cross-reference
  ("R2 models refinance proceeds" — never accurate) and added a one-line
  §5.11 pointer sentence, both flagged explicitly by the implementer as
  discretionary clarifications in the document's existing tone, not brief
  text. (§3.12 was subsequently corrected again at Task 8, above — the
  Task 1 fix repaired the *cross-reference*, the Task 8 fix repaired an
  *arithmetic overshoot* the Task 1 repair introduced.)
- **Task 11 InvestorSummaryPage heading judgment call.** The brief assumed a
  mechanical "11."→"12." renumbering; the file on disk actually read
  "10. Investor Summary" (a pre-existing mismatch against its old
  `PAGES.num` of 11, unrelated to this task). Set directly to "12." to match
  the new `PAGES.num` rather than propagating the pre-existing bug forward —
  verified as the only sibling page with this discrepancy.
- **Task 13 two content bugs found and fixed during TDD, not in the brief's
  literal template.** (a) The refinance provenance/narrative lines doubled
  "month" (`Refinance (month ${monthLabel(...)})` where the no-anchor
  fallback already returns `"Month N"`); fixed at both call sites. (b) The
  §7-mirroring carried-forward fix (see "Spec corrections" §7 item above) was
  applied to the investment memo's independent `sourcesAndUsesTotals()`
  helper, which the ledger explicitly called out as a required addition from
  Task 8's re-review (the memo would not have balanced for a `retain_all` +
  shortfall deal otherwise) — covered by a dedicated refinance-shortfall memo
  test.

No other deviations: every other task's implementation matches its plan
section as written (validation rules, tranche/refinance engine mechanics,
Python port, invariant matrix, Programme/Exit page editors).

## Deferred / known items

**Minor items accepted without follow-up action** (recorded in the ledger,
judged not worth a task — grouped by area):

- *Validation/engine edge cases, all structurally correct but untested in
  isolation*: no positive test for `ltv_pct = 100` boundary or pct-sum drift
  within `1e-9` (Task 3); no direct test for the partial-sweep arm with
  `facilityRedeemed` already true (Task 4); same-month tranche/refinance
  ordering test uses a weak inequality rather than pinned exact values
  (Task 5); metrics' phased pre-check `Math.max` on empty tranches would
  mislabel the reason as `-Infinity` but is unreachable via the UI since
  validation blocks empty tranche lists (Task 6); `hi`-doubling in the
  phased solver lacks an explicit `MAX_SAFE_INTEGER` cap, unreachable via
  validated inputs (Task 6); the `peak_debt`-basis break-even test omits the
  above-`g` monotonicity spot-checks its `committed_gross_facility` sibling
  has (Task 6); a negative control locates fixture I/J by display name, not
  file stem (Task 7); `irr_monthly_pct` is derived but not pinned in fixture
  I, following fixture F's precedent (Task 7); 3 TS validation sub-cases
  (fractional months, NaN pence) are intentionally unported to Python since
  Pydantic rejects them earlier, without the file's usual port-rule doc
  comment (Task 9); the sweep-identity scope preconditions (rolled-up
  interest, non-negative refinance proceeds) are comment-only, not
  runtime-asserted in the new invariant tests (Task 10).
- *UI polish, deferred as UX follow-up candidates*: no test for the
  `user_defined` curve kind-switch seeding / finite-only weights gate on the
  Programme page, though reviewed correct (Task 11); a trailing comma in the
  weights input parses as `0`, self-disclosed (Task 11); the Programme page
  has no `ReconciliationStrip` of its own — programme validation issues
  surface on other pages only, per-brief behaviour (Task 11); the refinance
  net-proceeds preview's operand order (`value × (ltv/100)`) diverges from
  the engine's (`(value × ltv)/100`) with a theoretical ±1p divergence,
  brief-specified (Task 12); the redemption-schedule memo table is gated on
  schedule non-empty rather than on `sales_phasing != null` — judged sound
  since a single-disposal deal also populates one entry — and the third
  zero-sale provenance branch (pure retain_all) is untested (Task 13).
- **Pre-existing, not introduced by R3b**: the §5.6 bare `[R2]` marker
  inconsistency (lender-underwritten GDV marked `[R2]` while §3.2 already
  reads `[R2 — implemented in calc 2.1.0]`) predates this release (visible
  before any R3b edit) and remains open, flagged again by Task 1's
  implementer — a distinct item from the §5.10/§6 staleness the R3a report
  closed. mypy backlog is unchanged from the R3a report's count (35
  pre-existing errors across 11 files, none in any R3b-touched file) — no
  R3b task added to it, and it remains declared but not enforced as a gate.

**Unchanged from the R3 design's explicit scope boundaries** (§1): R4+
(fixed-facility sensitivity suite, pari-passu draw rule, VAT modelling,
developer/lender mode split, exit-fee band holdback refinement, equity
`timing_month` enforcement, parking/external-space valuation, unit-level
sales tranches and lender release pricing, residual-price fixed-point
refinement) is untouched by this release, exactly as scoped.

## UAT

Design §5.3 requires, for R3b specifically (beyond the five gates run
above): **live browser UAT on the real York row**, with a dated review
document and screenshots under `docs/reviews/`, plus `/health`
`migrations_current` verified after the v4 migration. This is **Task 15,
not yet run** — it is the next task in the plan, deliberately sequenced
after this report so the report can record the gate state the UAT will run
against. Release 3b is **not fully gated for merge until Task 15 passes**;
this report documents the five automated gates and the fixture/spec/engine
work only.

## Release 3b status after this report

R3b (exits + UI, calc 2.3.0) is complete on the
`worktree-release-3b-exits-ui` branch for all thirteen implementation tasks
plus this report. All five gates green with counts re-verified independently
for this report (frontend vitest 687, tsc clean, eslint clean, build clean;
backend pytest 642). The identity invariant holds across the full
pre-existing fixture corpus and the two new fixtures I and J, cross-engine
parity is exact on first run, and the three mid-branch spec corrections
(§5.11 fee-reserve replay, §3.12 refinance-profit clause, §7 financing-side
exclusion) are each landed in both engines with matching worksheet/spec
text. The one item this report cannot close is the design's UAT clause —
Task 15's live browser run against the York row remains outstanding.
