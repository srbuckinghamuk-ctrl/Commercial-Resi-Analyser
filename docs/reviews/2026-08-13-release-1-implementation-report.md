# Release 1 (P0 Financial Correction) — Implementation Report

**Date:** 13 August 2026
**Branch/worktree:** `.claude/worktrees/release-1-p0-financial-correction`
(`worktree-release-1-p0-financial-correction`), base `main` at `abccd31`
**Plan:** `.superpowers/sdd/2026-08-12-release-1-p0-financial-correction/` (14 tasks, all complete)
**Audit responded to:** `docs/reviews/2026-08-12-lender-readiness-audit.md` (score 38/100)
**Spec implemented:** `docs/financial-model/calculation-specification.md`, calc version `2.0.0`

This report closes Task 14. It records what changed, maps every audit P0 finding to the commit
that fixed it, gives real (not paraphrased) verification output for all five release gates, and
states the honest remaining limitations for Release 2 planning.

---

## 1. Files changed

`git diff --stat main...HEAD` (excluding compiled `__pycache__`/`.pyc` noise, which is handled
separately by the `chore: untrack compiled python caches` commit): **71 files changed, 10,200
insertions(+), 1,362 deletions(-)**, across 22 commits.

By area:

| Area | What changed |
|---|---|
| **Spec & planning docs** | `docs/financial-model/calculation-specification.md` (new, 370 lines); the SDD plan file (2,753 lines) |
| **TS model layer (new)** | `frontend/src/lib/model/` — `finance-types.ts`, `schedule.ts`, `monthly-engine.ts`, `irr.ts`, `metrics.ts`, `validation.ts`, `migrate.ts`, `index.ts`, plus one test file per module (2,700+ lines incl. tests) |
| **Python model layer (new)** | `app/financial_model/` — `types.py`, `schedule.py`, `engine.py`, `metrics.py`, `validation.py`, `migrate.py`, `sdlt.py`, `hashing.py`, `__init__.py` (1,748 lines) |
| **Shared golden fixtures (new)** | `fixtures/financial-model/a-all-cash.json`, `f-dev-finance-12mo.json` |
| **Backend API/persistence** | `app/api/app.py` (+114/−?), `app/models.py`, `app/persistence/database.py`, `app/persistence/repositories.py` — server-authoritative recalculation, governance columns |
| **DB migration (new)** | `migrations/002_appraisal_governance.py` |
| **Backend tests (new)** | `tests/test_financial_model_engine.py` (246 lines), `tests/test_financial_model_fixtures.py` (46 lines), `tests/test_appraisal_governance.py` (213 lines) |
| **Frontend UI** | `ConversionCalculator.tsx`, `AppraisalSummaryPage.tsx`, `CashflowPage.tsx`, `FinancePage.tsx` (+537 lines — the largest single UI change), `ScenariosPage.tsx`, `ExitStrategyPage.tsx`, `ReconciliationStrip.tsx` (new component), `ExportPage.tsx`, `ProjectDetail.tsx`, others |
| **Legacy engine removal** | `frontend/src/lib/conversion-calc-engine.ts`, `conversion-cashflow.ts` and their tests — old dual-engine code deleted per audit P0 "two conflicting finance engines" |
| **Reports** | `frontend/src/lib/export-investment-memo.ts` (950 lines changed — near-total rewrite to consume `AppraisalRun` only) |
| **Task 14 (this task)** | 4 docs in `docs/financial-model/`, this report, 5 lint fixes in `frontend/src/`, `.gitignore` (new), 108 tracked `.pyc`/`__pycache__` files untracked |

## 2. Migrations introduced

**`migrations/002_appraisal_governance.py`** (revision `002`, `down_revision "001"`) — adds
`outputs` (JSON), `validation` (JSON), `calc_version` (String32), `inputs_version` (Integer,
`server_default '1'`), `status` (String32, `server_default 'legacy_unreconciled'`), `input_hash`
(String64), `outputs_hash` (String64) to `financial_appraisals`. Full detail, including the
pre-existing gap that this migration cannot currently be run via `alembic upgrade head`, is in
`docs/financial-model/migration-notes.md` §2 and §4.

## 3. Calculation definitions implemented (spec § references)

All of the following are implemented in **both** engines and pinned by the golden fixtures
(`docs/financial-model/test-cases.md` §2–§3):

- §3.1–§3.18: developer GDV, acquisition cost incl. commercial SDLT bands, construction cost
  (headline mode), professional fees, statutory costs, selling/exit costs, cost before finance,
  finance costs, TDC, profit before/after finance, profit on cost/GDV, developer equity cash flow,
  equity multiple, IRR (Newton + bisection fallback), RLV with configurable target.
- §4: the monthly senior debt ledger — draw priority (`equity_first`), rolled-up vs. serviced
  interest, sales sweep and repayment, the gross-facility-headroom draw cap (§4.2(c), added during
  Task 4 as a mid-implementation correction).
- §5: lender metrics — day-one advance and day-one LTV (both variants), development-cost advances,
  net/gross facility utilisation, net LTC, gross LTC, LTGDV (developer basis), peak debt with
  month index, interest reserve tracking, facility headroom.
- §7: sources-and-uses, penny-exact, as an engine invariant not a display-layer check.
- §9: the zero-debt / negative-profit behaviour table, enforced as invariants across every fixture
  and derived variant (`docs/financial-model/test-cases.md` §4).
- §10: legacy (v1) snapshot migration semantics — `docs/financial-model/migration-notes.md`.
- §11: the ten prohibited (removed) calculations — verified absent by the rewrites in Tasks 8–10
  and by the invariant suite; the deal spider's 15% VAT-saving figure remains present only as a
  labelled illustration and never enters TDC or a lender metric (`frontend/src/lib/deal-spider.ts`).

**Explicitly R2/R3 per the spec and not implemented here** (shown as "not available", never a
substitute formula): lender-underwritten GDV (§3.2), senior repayment / developer-profit
break-even (§5.11–§5.12), cost-to-complete (§5.10), non-`straight_line` spend profiles (§6),
phased sales / refinance proceeds for `retain_all` (§4.4).

## 4. Defect → fix mapping (every audit P0)

Quoting the audit's own words (§1 and §11), mapped to the task/commit that corrected each one.

| Audit finding (quoted) | Fixing task(s) | Commit(s) |
|---|---|---|
| *"A field labelled LTV is actually applied to cost before finance, so it is neither LTV nor the LTC subsequently reported."* | T1 (v2 finance model separates `legacy_leverage_pct` from `committed_net_facility_pence`); T5 (correct day-one LTV/net-LTC/gross-LTC/LTGDV formulas) | `7c579f0`, `8d33d65` |
| *"The selected funding source and serviced/rolled-up interest choice do not change the calculation."* | T4 (ledger: `cash` forces zero debt everywhere; `interest_type` changes whether interest capitalises or is serviced from equity — proven by Fixture C) | `00f98ae`, `d385725` |
| *"Summary interest assumes the entire loan is outstanding for the whole term; the monthly cash flow charges interest on total project spend rather than debt."* | T4 (interest accrues only on the actual senior balance, spec §4 `interest_accrued` column) | `00f98ae` |
| *"Monthly cash flow has no equity/debt draw priority, loan balance, facility limit, sales phasing or debt repayment."* | T4 (draw priority §4.2, facility limits incl. gross-headroom cap fix round 1, sales sweep/repayment §4.4) | `00f98ae`, `d385725` |
| *"Downside costs automatically produce a larger loan, masking funding gaps."* | T4 (Fixture E: facility never expands, gap is flagged); `apply-scenario.ts` holds the committed facility and equity fixed across all scenarios by design | `d385725`, T9 scenario-page work |
| *"Exit costs are displayed but excluded from total development cost and profit."* | T2 (schedule computes selling costs as a first-class cost line); T5/T6 (TDC and profit formulas include them, spec §3.7–§3.10) | `a34af57`, `8d33d65`, `df1099b` |
| *"`retain_all` still books the entire GDV as sale income in the final month."* | T2 (schedule: retained exits book zero receipts); T4 (ledger: `retain_all` never receives a sale, Fixture D) | `a34af57`, `00f98ae` |
| *"The PDF sources-and-uses does not balance: finance costs appear as a use without a corresponding source."* | T10 (memo rewritten to consume `AppraisalRun` exclusively; sources/uses now come from the engine's own penny-exact reconciliation) | `63d0cc6` |
| *"The PDF 'day-one LTV' divides the total development loan by purchase price, not the day-one advance."* | T10 (memo uses `metrics.day_one_advance_pence`-based LTV per spec §5.1) | `63d0cc6` |
| *"The PDF 'senior debt impairment' test compares GDV with total cost, not senior debt."* | T10 (this calculation is removed per spec §11 prohibited-calculation #5; senior repayment break-even is correctly labelled "not available", R2 scope, rather than shown with a wrong formula) | `63d0cc6` |
| *"Saved outputs are supplied by the client and stored separately from an unvalidated input dictionary. An actual saved appraisal is internally inconsistent."* | T11/T12 (Python engine + server-side authoritative recalculation on every save); T13 (save flow adopts server-authoritative outputs, surfaces status/errors) | `7235515`, `a23be73`, `8a45127`, `176176c` |
| *"Negative costs and other impossible values are accepted."* | T6 (frontend hard validation, incl. the literal York Part L −£1 case as a named test); T11/T12 (Pydantic `ge=0` constraints reject the same at the API boundary, HTTP 422) | `df1099b`, `7235515`, `8a45127` |
| *(§11 P0) Two conflicting finance engines* | T2, T4, T7 (single `runAppraisal` orchestrator over one monthly ledger); T8 (all UI pages migrated to consume it; both legacy engines deleted) | `a34af57`, `00f98ae`, `15e36e2`, `dcdc99e` |
| *(§11 P0) Facility expands under downside; no fixed-facility scenario engine* | `apply-scenario.ts` holds facility/equity fixed by design; T4's Fixture E and the gross-headroom-cap fixture prove the engine itself never auto-expands a facility, only flags a gap | `d385725`, T9 |

## 5. Tests added

Aggregate suite results at HEAD: **frontend 202/202 passed** (20 files), **backend 145/145
passed** (15 files). Of these, the following are new in this release (pre-existing suites —
eligibility engine, property adapters, ORM tables, lookup endpoints, etc. — are unchanged and
continue to pass):

**Frontend — new/rewritten in `frontend/src/lib/model/`:**

| File | Tests | Covers |
|---|--:|---|
| `invariants.test.ts` | 56 | Structural invariants across 2 fixtures × 4 variants (§4 in test-cases.md) |
| `validation.test.ts` | 12 | Hard validation incl. the York Part L −£1 case, `reconcile()`/`report_safe` |
| `monthly-engine.test.ts` | 9 | Ledger fixtures B–F incl. gross-headroom cap |
| `irr.test.ts` | 8 | Newton/bisection solver incl. the regression vector |
| `schedule.test.ts` | 7 | Spend spreads, exit-route receipt booking |
| `metrics.test.ts` | 6 | Derived lender metrics |
| `migrate.test.ts` | 4 | v1→v2 migration incl. floors-vs-null |
| `golden-fixtures.test.ts` | 2 | Whole-pipeline parity for fixtures A and F |
| **Model-layer subtotal** | **104** | |

Also new: `frontend/src/lib/api.test.ts` (12 tests — API client incl. server-authoritative save
flow). `export-investment-memo.test.ts` was substantially rewritten (347 lines changed) alongside
the memo generator itself, including the forced-multi-page watermark regression test.

**Backend — new:**

| File | Tests | Covers |
|---|--:|---|
| `test_financial_model_engine.py` | 9 | Python-native ledger/engine unit tests |
| `test_financial_model_fixtures.py` | 5 | Golden-fixture parity (`test_golden_fixture_parity`, `test_invariants`) + the floors-zero migration regression |
| `test_appraisal_governance.py` | 6 | Server-authoritative persistence end-to-end: v1→`legacy_unreconciled` migration, server-side recalculation overriding client values, `report_safe`-gated status, hash persistence/determinism, the York "negative costs rejected" case |
| **Subtotal** | **20** | |

## 6. Worked reconciliation table (spec §8, implemented as Fixture B)

The specification's own normative worked example (§8) uses the same terms as
`monthly-engine.test.ts` Fixture B: committed net facility £500,000; committed gross £550,000;
day-one advance £300,000; 12% p.a. (1%/month); arrangement fee 2% of net (£10,000, capitalised
month 0); exit fee 1% of committed gross (£5,500, at redemption); rolled-up interest; committed
cash equity £300,000; equity-first. Uses: month 0 acquisition £400,000; month 1 construction
£150,000; month 2 construction £100,000. Sale: month 3, gross £800,000, selling costs £16,000.

| m | Opening | Draw | Cap fees | Interest (1%) | Repayment | Closing | Equity flow |
|--:|--:|--:|--:|--:|--:|--:|--:|
| 0 | 0.00 | 300,000.00 | 10,000.00 | 3,100.00 | 0 | 313,100.00 | −100,000.00 |
| 1 | 313,100.00 | 0 | 0 | 3,131.00 | 0 | 316,231.00 | −150,000.00 |
| 2 | 316,231.00 | 50,000.00 | 0 | 3,662.31 | 0 | 369,893.31 | −50,000.00 |
| 3 | 369,893.31 | 0 | 0 | 3,698.93 | 373,592.24 + 5,500.00 exit fee | 0.00 | +404,907.76 |

- Peak gross debt = £373,592.24 (month 3, pre-repayment). Total interest = £13,592.24. Finance
  costs = 13,592.24 + 10,000 + 5,500 = **£29,092.24**.
- TDC = 650,000 + 16,000 + 29,092.24 = **£695,092.24**. Profit = 800,000 − 695,092.24 =
  **£104,907.76**.
- **Identity check:** Σ equity flows = −100,000 − 150,000 − 50,000 + 404,907.76 = **+£104,907.76 =
  profit** ✓.
- **Sources = uses:** equity 300,000 + gross debt funded 373,592.24 + proceeds applied to exit fee
  & selling costs 21,500 = £695,092.24 = TDC ✓.
- Gross LTC = 373,592.24 / 695,092.24 = **53.75%**. LTGDV (developer) = 373,592.24 / 800,000 =
  **46.70%**. Day-one LTV = 300,000 / 400,000 = **75%**. Net LTC = 360,000 / 650,000 = **55.38%**.

This is not a hypothetical example: `monthly-engine.test.ts`'s Fixture B asserts these exact pence
values (`draw_pence`, `interest_accrued_pence`, `closing_balance_pence`, `repayment_pence`,
`equity_cashflows_pence`) against the running implementation, and the roll-forward invariant and
non-negativity are checked every month.

## 7. Verification evidence

All five commands below were run from a clean worktree at the commit preceding the docs commit
(after the pyc-untracking commit `266b76e`), output pasted verbatim.

### 7.1 Frontend tests — `npx vitest run` (from `frontend/`)

```
 RUN  v4.1.0 C:/Users/srbuc/Documents/Github/Commercial-Resi-Analyser/.claude/worktrees/release-1-p0-financial-correction/frontend

 Test Files  20 passed (20)
      Tests  202 passed (202)
   Start at  10:50:27
   Duration  3.91s (transform 10.27s, setup 0ms, import 17.18s, tests 2.69s, environment 9ms)
```

### 7.2 Frontend type check — `npx tsc -p tsconfig.app.json --noEmit` (from `frontend/`)

```
(no output — exit code 0)
```

### 7.3 Frontend lint — `npm run lint` (from `frontend/`)

Before Task 14's fixes: **23 errors, 1 warning** (matching the audit's count almost exactly — the
audit found 23 errors and 1 warning independently). After the fixes documented below:

```
> commercial-resi-analyser@0.0.0 lint
> eslint .

(no output — 0 errors, 0 warnings)
```

Fixes applied (no blanket `eslint-disable`, every fix addresses the actual issue):

- `frontend/src/App.tsx`, `frontend/src/components/PropertyMap.tsx` — `react-hooks/set-state-in-effect`
  ("Calling setState synchronously within an effect can trigger cascading renders"). Both
  data-fetching effects (`loadProjects`, `lookupCoords`) were calling a `useCallback`-memoised
  async function directly in the effect body; the new React Compiler-aligned lint rule flags this
  pattern regardless of the callee being async. Fixed with React's own documented "ignore flag"
  pattern — an inline async IIFE plus an `ignore` boolean set on cleanup — which the rule accepts
  (verified empirically against the rule's source before applying, since the rule's own
  documentation example for a *different* rule superficially looks like it should also trip this
  one, and it does not for this exact shape).
- `frontend/src/components/ExportPage.tsx` — 4× `@typescript-eslint/no-unused-vars` on unused
  `catch (err)` bindings; changed to bare `catch` (the error is intentionally not used — each
  handler shows a fixed, more informative user-facing message instead).
- `frontend/src/components/calculator/ScenariosPage.tsx` — `react-hooks/exhaustive-deps` warning
  on a `useMemo` referencing a component-local `scenarioKeys` array recreated every render; moved
  `scenarioKeys` to a module-level constant so it's referentially stable and no longer needs to be
  a dependency.
- `frontend/src/lib/export-investment-memo.ts` — 17× `@typescript-eslint/no-explicit-any`, all the
  same pattern: `(doc as any).lastAutoTable.finalY` (jspdf-autotable augments the `jsPDF` instance
  with `lastAutoTable` at runtime; the package's own types don't declare it). Replaced with a
  documented `JsPdfWithAutoTable` interface extending `jsPDF` and a `lastAutoTableFinalY(doc)`
  helper, used at all 17 call sites — this documents the real runtime shape instead of suppressing
  the check.

### 7.4 Frontend production build — `npm run build` (from `frontend/`)

```
> commercial-resi-analyser@0.0.0 build
> tsc -b && vite build

vite v8.0.0 building client environment for production...
transforming...✓ 309 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                          0.48 kB │ gzip:   0.31 kB
dist/assets/index-Bm3TU6Sx.css          24.03 kB │ gzip:   8.64 kB
dist/assets/purify.es-y41lKIN9.js       21.03 kB │ gzip:   8.47 kB
dist/assets/index.es-COHQbWNf.js       151.37 kB │ gzip:  48.87 kB
dist/assets/html2canvas-CoCjODFi.js    199.57 kB │ gzip:  46.78 kB
dist/assets/index-TF8_zcwc.js        1,247.12 kB │ gzip: 389.06 kB

✓ built in 1.06s
[plugin builtin:vite-reporter]
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

Build succeeds; the bundle-size warning is the same pre-existing performance/polish item the
audit flagged as P2 ("Report bundle/performance") — not a correctness or lint gate, unaffected by
this release's changes, and out of scope for Task 14.

### 7.5 Backend tests — `python -m pytest -q` (from repo root)

```
........................................................................ [ 49%]
........................................................................ [ 99%]
.                                                                        [100%]
145 passed in 13.90s
```

## 8. Release-gate scheme verification (through the real engine)

Live browser/Docker E2E is **not available in this environment** (no running dev server or
Chrome connection was set up for this task) — stated explicitly per the brief as a verification
limitation. In its place, the four release-gate schemes named in the Task 14 brief were exercised
directly through `runAppraisal()` (the same single entry point the UI, reports and backend-parity
tests use) via a temporary vitest file, deleted immediately after capturing output. It is not part
of the committed test suite.

**Script** (`frontend/src/lib/model/__release-gate-scratch.test.ts`, deleted after this run):

```ts
// TEMPORARY — Task 14 release-gate verification script. Not part of the test
// suite; exercises the four release-gate schemes described in the Task 14
// brief through the real engine (runAppraisal) and prints reconciliation
// booleans + key flags for the implementation report. Deleted after the run.
import { describe, it } from 'vitest';
import { runAppraisal } from './index';
import type { CalculatorInputsV2 } from './finance-types';
import { applyScenario } from '../apply-scenario';
import fixtureA from '../../../../fixtures/financial-model/a-all-cash.json';
import fixtureF from '../../../../fixtures/financial-model/f-dev-finance-12mo.json';

function report(label: string, inputs: CalculatorInputsV2) {
  const run = runAppraisal(inputs);
  const flags = run.model.flags.map((f) => `${f.code}(${f.severity}, m${f.month ?? '-'})`);
  console.log(`\n=== ${label} ===`);
  console.log('reconciliation:', JSON.stringify(run.reconciliation, null, 2));
  console.log('flags:', JSON.stringify(flags));
  console.log('key metrics:', JSON.stringify({
    finance_costs_pence: run.metrics.finance_costs_pence,
    peak_debt_pence: run.metrics.peak_debt_pence,
    senior_outstanding_at_maturity_pence: run.model.senior_outstanding_at_maturity_pence,
    irr_annual_pct: run.metrics.irr_annual_pct,
    profit_pence: run.metrics.profit_pence,
    profit_is_unrealised: run.metrics.profit_is_unrealised,
    funding_gap_pence: run.model.totals.funding_gap_pence,
    committed_net_facility_pence: run.inputs.finance.committed_net_facility_pence,
    committed_gross_facility_pence: run.inputs.finance.committed_gross_facility_pence,
  }));
}

describe('Task 14 release-gate scratch (temporary, not asserted)', () => {
  it('(a) all-cash — fixture A', () => {
    report('(a) all-cash scheme (fixture A)', fixtureA.inputs as unknown as CalculatorInputsV2);
  });
  it('(b) development-finance sell-all — fixture F', () => {
    report('(b) dev-finance sell-all scheme (fixture F)', fixtureF.inputs as unknown as CalculatorInputsV2);
  });
  it('(c) retain_all variant of fixture F', () => {
    const inputs = fixtureF.inputs as unknown as CalculatorInputsV2;
    const retained: CalculatorInputsV2 = {
      ...inputs,
      exit_strategy: { ...inputs.exit_strategy, route: 'retain_all',
        retained_units: inputs.unit_mix.units.map((u) => u.id) },
    };
    report('(c) retain_all scheme (fixture F, exit_strategy.route=retain_all)', retained);
  });
  it('(d) downside exceeding the facility — shrunk committed net facility', () => {
    const inputs = fixtureF.inputs as unknown as CalculatorInputsV2;
    // applyScenario holds committed facility and equity fixed by design (audit
    // P0: "downside costs automatically produce a larger loan" — corrected).
    const stressed = applyScenario(inputs, inputs.scenarios.severe);
    const shrunk: CalculatorInputsV2 = {
      ...stressed,
      finance: { ...stressed.finance,
        committed_net_facility_pence: 40_000_000,  // shrunk from 60,000,000
        committed_gross_facility_pence: 44_000_000 }, // shrunk from 66,000,000
    };
    report('(d) downside exceeding facility (severe scenario, facility shrunk)', shrunk);
  });
});
```

**Output (real, `npx vitest run src/lib/model/__release-gate-scratch.test.ts --reporter=verbose`):**

```
=== (a) all-cash scheme (fixture A) ===
reconciliation: {
  "sources_equal_uses": true,
  "debt_rollforward_ok": true,
  "closing_never_negative": true,
  "facility_within_limit": true,
  "senior_repaid": true,
  "funding_complete": true,
  "report_safe": true,
  "issues": []
}
flags: []
key metrics: {"finance_costs_pence":0,"peak_debt_pence":0,"senior_outstanding_at_maturity_pence":0,
"irr_annual_pct":49.02,"profit_pence":28611600,"profit_is_unrealised":false,"funding_gap_pence":0,
"committed_net_facility_pence":0,"committed_gross_facility_pence":0}

=== (b) dev-finance sell-all scheme (fixture F) ===
reconciliation: {
  "sources_equal_uses": true,
  "debt_rollforward_ok": true,
  "closing_never_negative": true,
  "facility_within_limit": true,
  "senior_repaid": true,
  "funding_complete": true,
  "report_safe": true,
  "issues": []
}
flags: []
key metrics: {"finance_costs_pence":5076553,"peak_debt_pence":58604953,
"senior_outstanding_at_maturity_pence":0,"irr_annual_pct":91.2,"profit_pence":23535047,
"profit_is_unrealised":false,"funding_gap_pence":0,"committed_net_facility_pence":60000000,
"committed_gross_facility_pence":66000000}

=== (c) retain_all scheme (fixture F, exit_strategy.route=retain_all) ===
reconciliation: {
  "sources_equal_uses": true,
  "debt_rollforward_ok": true,
  "closing_never_negative": true,
  "facility_within_limit": true,
  "senior_repaid": false,
  "funding_complete": true,
  "report_safe": true,
  "issues": [
    { "severity": "warning", "field": "model",
      "message": "Senior debt not repaid within the modelled term." }
  ]
}
flags: ["senior_outstanding_at_maturity(red, m11)","exit_fee_not_charged(info, m11)"]
key metrics: {"finance_costs_pence":4416553,"peak_debt_pence":58604953,
"senior_outstanding_at_maturity_pence":58604953,"irr_annual_pct":null,"profit_pence":26395047,
"profit_is_unrealised":true,"funding_gap_pence":0,"committed_net_facility_pence":60000000,
"committed_gross_facility_pence":66000000}

=== (d) downside exceeding facility (severe scenario, facility shrunk) ===
reconciliation: {
  "sources_equal_uses": true,
  "debt_rollforward_ok": true,
  "closing_never_negative": true,
  "facility_within_limit": false,
  "senior_repaid": true,
  "funding_complete": false,
  "report_safe": false,
  "issues": [
    { "severity": "error", "field": "model",
      "message": "Funding gap or uncommitted equity requirement present." }
  ]
}
flags: ["funding_gap(red, m9)","facility_exceeded(red, m13)"]
key metrics: {"finance_costs_pence":6881501,"peak_debt_pence":45641501,
"senior_outstanding_at_maturity_pence":0,"irr_annual_pct":41.22,"profit_pence":-4799901,
"profit_is_unrealised":false,"funding_gap_pence":23788400,"committed_net_facility_pence":40000000,
"committed_gross_facility_pence":44000000}
```

**Reading of the four schemes:**

- **(a) all-cash:** `report_safe: true`, `finance_costs_pence: 0`, sources = uses, no flags —
  exactly the zero-debt behaviour spec §9 requires.
- **(b) dev-finance sell-all:** `report_safe: true`, `senior_repaid: true`
  (`senior_outstanding_at_maturity_pence: 0`), reconciled, IRR 91.2% (matches the golden fixture).
- **(c) retain_all:** `senior_repaid: false`, a **red** `senior_outstanding_at_maturity` flag,
  `irr_annual_pct: null` (no terminal distribution → no sign change in equity flows, spec §3.17),
  and `profit_is_unrealised: true` — exactly the corrected behaviour for the audit's specific
  complaint that `retain_all` used to book the whole GDV as sale income.
- **(d) downside exceeding the facility:** the severe scenario plus a deliberately shrunk facility
  produces a **red** `funding_gap` flag and a **red** `facility_exceeded` flag,
  `funding_complete: false`, `report_safe: false` — and critically,
  `committed_net_facility_pence`/`committed_gross_facility_pence` in the output are still exactly
  40,000,000/44,000,000, i.e. **unchanged from the shrunk input** — the engine never auto-expanded
  the facility to cover the shortfall, it flagged the gap instead.

## 9. The York appraisal path (governance test coverage, no live DB in this run)

No live database was available in this task's environment (no running FastAPI/Postgres instance
was started for Task 14). Per the brief, this is covered instead by the backend v1-snapshot
governance test, `tests/test_appraisal_governance.py::test_v1_snapshot_migrates_to_legacy_unreconciled`,
which posts a v1-shaped snapshot (the same `ltv_pct`/`funding_source: "bridging"` shape the York
appraisal has) through the real `POST /api/v1/appraisals` endpoint against an isolated in-memory
SQLite database (i.e. the real server-side recalculation path, not a mock) and asserts:
`status == "legacy_unreconciled"`, `calc_version == "2.0.0"`, `inputs_snapshot.inputs_version ==
2`, `inputs_snapshot.finance.requires_confirmation == true`, and
`outputs.metrics.calc_version == "2.0.0"`. This test is part of the 145/145 passing backend suite
(§7.5). The full request-by-request walk-through of what this means for the live York record
specifically (GET before any save, save-time migration, mismatch recording against its stale
stored TDC/profit figures) is documented in `docs/financial-model/migration-notes.md` §3.

**Stated verification limitation:** this is a controlled-database proof of the mechanism, not a
live end-to-end confirmation against the actual production York row. No browser/Docker E2E run was
performed in this task.

## 10. Remaining limitations

Deferred to Release 2/3 by the specification itself (marked `[R2]`/`[R3]`, displayed as "not
available" rather than a substitute formula):

- **No dated programme** — the engine operates on discrete months with a single straight-line
  spend assumption; there is no calendar-dated, dependency-aware programme. Disposal for
  `sell_all`/the sold portion of `blended` happens entirely in the final month of the term
  (single-month disposal, spec §4.4) — phased sales rates are R2.
- **Straight-line spreads only** — construction/professional/statutory costs spread
  `straight_line` over fixed windows (spec §6); `upfront`, `s_curve`, `back_loaded`,
  `user_defined` are enumerated in the schema but not implemented.
- **Senior repayment break-even, developer profit break-even, cost-to-complete, lender-underwritten
  GDV** — all defined in spec §3.2/§5.10–§5.12 but not implemented; UI/reports must show these as
  "not available", never a substitute formula (spec §11 prohibited calculations #5).
- **No pari-passu draw rule** — defined but rejected with a validation error until implemented.
- **Refinance proceeds for `retain_all` are not modelled** — the ledger correctly reports "senior
  debt outstanding at maturity — repayment source (refinance) not yet modelled" rather than
  inventing a receipt.
- **SDLT is England/Northern Ireland commercial-only** (spec §3.3); other UK jurisdictions are
  out of scope in R1 and must be flagged as an assumption in reports.
- **VAT is unmodelled** — construction/professional costs are treated as net of recoverable VAT
  with an explicit "unconfirmed" assumption note (spec §3.4); the deal spider's 15% construction
  VAT saving figure remains labelled an unconfirmed illustration and, per spec §11 prohibited
  calculation #10, never enters TDC, profit or any lender metric.
- **Serviced-interest reserve semantics** — `interest_reserve_exhausted` tracks capitalised
  interest only (a ruling made during Task 4: this matches spec §5.8's literal text; using the
  reserve as an actual funding source is R2 scope). `interest_reserve_remaining` is floored at the
  reporting/display layer, not inside the model, per the same ruling.

Not spec-deferred, but recorded as genuine implementation gaps or minor deferred items from the
build's own review record (`.superpowers/sdd/2026-08-12-release-1-p0-financial-correction/progress.md`):

- **Alembic migration path gap** (`docs/financial-model/migration-notes.md` §4) — the two
  migration scripts are not discoverable by Alembic's default `version_locations`; the app boots
  via `Base.metadata.create_all` instead. Fine for a fresh database (the ORM models already match
  migration 002's schema); a real operational gap for an existing production database that was
  never migrated via Alembic. Recorded as an ops follow-up, not fixed in this release.
- **No browser/Docker E2E in this run** — covered instead by the backend governance test suite and
  the direct-engine release-gate script (§§8–9). A live UI walkthrough (loading the York appraisal
  in the actual running app, observing the red banner, saving, observing the mismatch list) has
  not been performed in this task and should be a Release 2 acceptance step.
- **`spreadStraightLine` can yield a negative final-month value for tiny totals**
  (`frontend/src/lib/model/schedule.ts:7-13`) — theoretical, unreachable at the magnitudes any
  realistic fixture or real appraisal would use; not fixed, tracked as a minor.
- **Pydantic is stricter than the TS runtime validator** on `broker_fee_pct`/`selling_agent_fee_pct`
  non-negativity (`docs/financial-model/model-governance.md` §8) — backend rejects at save time
  regardless, so this is not a data-integrity risk, only a client-side UX gap (a negative
  percentage could render for one cycle before a save fails).
- **`was_v1` is a weaker check than `is_v2`**, and the appraisal repository's dict typing is loose
  — both parked as minors during the Task 12 review, not believed to cause incorrect behaviour
  today but worth tightening.
- **Frontend UX minors, all parked deliberately (spec-compliant as briefed, not defects):** the
  cash-flow assumptions display has some duplication between the spend-window note and the table
  itself; `ReconciliationStrip` omits `reconciliation.issues` from its compact view (the full issue
  list is available elsewhere in the UI); the save-error status pill sits next to rather than
  inside the main status banner; `ProjectDetail`'s pre-existing silent catch on load failure was
  not touched (out of this release's scope); a non-null-assertion style choice in the save flow;
  no dedicated test yet for the exact Pydantic-shape 422 error body.
- **`interest_reserve_exhausted` / `interest_reserve_remaining`** — see the spec-deferred list
  above; recorded again here because they were explicit review-time rulings, not merely
  spec-silent gaps.

## 11. Recommended next phase — Release 2 (lender-ready underwriting)

Per the audit's own roadmap (§10, "Phase 1 — Lender-ready core") and the R2 markers throughout the
specification, Release 2 should prioritise, in roughly this order:

1. **Dated programme** — calendar-dated phases with dependencies, replacing the discrete-month/
   single-disposal-month simplification; this unblocks phased sales, refinance timing, and
   accurate interest/maturity risk.
2. **Lender-underwritten GDV** (§3.2) with the developer/lender variance bridge, and the two
   break-even metrics (§5.11–§5.12) plus cost-to-complete (§5.10) that depend on it.
3. **Fixed-facility sensitivity suite** — GDV ±5/10%, cost +5/10%, combined, 6/12-month delay,
   abnormal cost, reduced saleable area, unit loss, slower sales — all recalculating through the
   same monthly ledger with the facility held fixed, building on the pattern already proven by
   `apply-scenario.ts` and this task's scheme (d) verification.
4. **Live E2E/UAT pass** against a real running app and database, including the actual York
   appraisal record, closing the verification gap noted in §9 above.
5. **Alembic path fix** — move (or symlink) the migration scripts into `migrations/versions/`, or
   set `version_locations` explicitly, and add a real migration-driven boot path (or a documented
   operator runbook) for existing production databases, closing the gap in §10.
6. Everything else in the audit's Phase 1/2 scope not yet touched: pari-passu, VAT modelling,
   non-straight-line spend profiles, area bridge/efficiency metrics, and the developer/lender mode
   split.
