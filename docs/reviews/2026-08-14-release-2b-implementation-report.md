# Release 2b implementation report — lender metrics + hygiene

Date: 2026-08-14. Branch `release-2b-lender-metrics` (16 commits, `fdc7e24..afa04b2`),
merged fast-forward to local `main` on 2026-08-14. Final whole-branch review verdict:
merge (after a two-item wording fix wave, re-reviewed clean). Plan:
`docs/superpowers/plans/2026-08-13-release-2b-lender-metrics.md`; design:
`docs/superpowers/specs/2026-08-13-release-2-design.md` §R2b.

Gates at merge: backend pytest 333 passed (no warnings), frontend vitest 358 passed,
tsc clean, eslint clean, production build clean. Calc version `2.0.0 → 2.1.0`
(additive; every previously pinned fixture value unchanged — verified per task).

## Design §B → delivery map

| Design item | Delivered by (commits) |
|---|---|
| B1 `lender_valuation` block + `enforcement_cost_assumption_pence`, inputs v3, migration mirroring v1→v2, status preserved | Task 1 `7ecc524`, Task 2 `53fc135` |
| B2 lender GDV §3.2 + variance bridge | Task 3 `aec7e09` + fix `b498091` (invalid-block containment: null metrics + hard validation issue, 422 not 500) |
| B2 senior repayment break-even §5.11 (bisection, integer pence, cap → null + flag) | Task 4 `7029e31` + fix `30d3621` (floor-divide midpoint — the `>>1` 32-bit ceiling was caught in review; regression pinned at 5,076,649,746p in both engines) |
| B2 developer profit break-even §5.12 | Task 5 `f9a1e84` (shared bisection helper; fixture G 96,106,551p, fixture A 90,952,690p, both hand-verified) |
| B2 cost-to-complete §5.10 on straight-line ledger | Task 6 `24b87cb` (telescoping invariant; shortfall⇒gap direction only — both converse directions disproved and recorded as a spec Known limitation) |
| B3 fractional-sqm rounding rule §1.1 | Task 7 `713ae8e` (single-site round-half-up, both engines) |
| B3 Python invariant-matrix port + shared migration fixtures | Task 7 `713ae8e` (84/84 assertion parity; 4 v1→v2 cases ported; v2→v3 cases mirrored in Task 2) |
| B4 UI + reports | Task 8 `ace81ef` + fix `4f78d99` (entry card, variance bridge, metric cards, CTC table, memo rows; CTC month-label off-by-one in the PDF caught in review and pinned) |
| B5 edge handling | Tasks 3–6 (validation hard errors, solver guards/caps, invariants incl. 56.09+43.91=100.00) |
| UAT-driven additions (not in design §B, from R2a UAT): boot-failure surfacing; live UAT | Task 9 `7b97207` (`/health` `migrations_current` + ERROR logging + compose message); Task 10 (`docs/reviews/2026-08-14-release-2b-uat.md`) |
| Final-review fix wave | `afa04b2` (spec §5.11/§5.12 "gross sale price" wording; memo provenance line scoped to the percentage forms) |

Golden fixture G (`fixtures/financial-model/g-lender-valuation.json`): fixture F plus a
−10% global lender valuation — lender GDV 108,000,000p, variance −12,000,000p/−10.00%,
ltgdv-lender 54.26%, senior break-even 60,573,556p (56.09% of lender GDV / 43.91% fall),
developer break-even 96,106,551p, CTC no-shortfall. Every value hand-derived on recorded
worksheets (`docs/financial-model/test-cases.md`) before implementation, and re-derived
independently by the final review.

## Plan corrections made mid-flight (both committed to the plan file)

- Task 4 worksheet: the plan assumed fixture F's gross facility = net (exit fee
  600,000p); the implementer's verification gate caught the explicit 66,000,000p gross
  (fee 660,000p) and the derivation was corrected before implementation (`a2ed4b4`).
- Task 4 solver spec: the plan's `(lo+hi)>>1` TS midpoint was a genuine plan defect
  (32-bit coercion ceiling ~£21.47m); corrected to floor-divide (`fe60469`) and fixed in
  code with cross-language regression pins.

## Deferred / accepted (final-review triage)

- Ride to R3: flags-on-result refactor (deriveMetrics mutates `model.flags` by
  reference — single-call-safe today); cap-exhaustion flag for the unreachable
  >2²⁰⁰-range case; CTC re-derivation against the dated programme;
  `redemption_balance_at_disposal_pence` semantics revisit for staged disposals.
- Accepted: `computeLenderGdv` runs twice per appraisal (validation + metrics — pure
  function); response hardcodes `inputs_version: 3` (accurate by construction);
  eslint underscore-scoped unused-var options; Python float-typed lender GDV for
  pence-basis inputs (validation rejects fractional pence; cosmetic `.0` in JSON).
- Open: browser-visual UAT pass (extension unavailable both sessions; all driving data
  API/DB-verified — see the UAT records).

## Release 2 status after this report

R2a (verification/ops hardening) and R2b (lender metrics + hygiene) are both merged to
local `main`. Remaining Release 2 scope from the design: none — everything else in the
audit's roadmap (dated programme, sensitivity suite, pari-passu, VAT, spend curves,
mode split, waterfall refinements) is R3+ by design. `main` remains unpushed to origin;
pushing is the user's call.
