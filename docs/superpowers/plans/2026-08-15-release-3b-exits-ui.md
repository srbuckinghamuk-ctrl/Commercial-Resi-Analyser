# Release 3b — Exits + UI (calc 2.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phased-sales sweep, refinance proceeds for retained exits, the declining redemption schedule (§5.11 re-stated), the v4 hydration lift (entry checklist), and the full Programme/Exit/cashflow/memo UI — calc 2.2.0 → 2.3.0, with every pre-existing fixture value unchanged.

**Architecture:** The TS engine (`frontend/src/lib/model/`) is the interactive mirror; the Python engine (`app/financial_model/`) is authoritative and mirrors it line-for-line (governance §1). `sales_phasing = null` and `refinance = null` (the migration defaults) take the existing calc-2.2.0 code paths **verbatim** — identity holds by construction, exactly as R3a did for `programme = null`. Non-null blocks activate: tranche receipts in `buildSchedule`, sweep/fee-once/redemption-schedule mechanics in `runLedger`, a replay-based §5.11 solver, and a refinance redemption event. Design: `docs/superpowers/specs/2026-08-14-release-3-design.md` §4–§5.

**Tech Stack:** TypeScript + vitest (frontend, jsdom+RTL for components), Python 3 + pytest (backend). No new dependencies.

## Global Constraints

- Governance (`docs/financial-model/model-governance.md` §2): spec first, then hand-derived fixtures (worksheets in `docs/financial-model/test-cases.md` BEFORE pinning), then both engines — all within this release branch. A fixture number that is "whatever the code now produces" is not acceptable.
- Identity invariant: every pre-existing fixture (A, F, G, H golden; B–F ledger; migration fixtures) reproduces its pinned values unchanged. Only `calc_version` changes (`'2.2.0'` → `'2.3.0'`, Task 10). `calc_version` is not in any fixture's `expected_metrics`, so golden tests cannot break from the bump alone.
- All money is integer pence; percentages are floats (`70.0` = 70%). Rounding half-up (`Math.round` / `money_round` — never Python `round()`). Splits use final-element residue absorption so sums are exact.
- Do NOT re-express the null-block paths through the new tranche/refinance code: the `sales_phasing == null` receipts branch and the pre-existing sweep arms stay byte-identical (same rule R3a applied to `spreadStraightLine`).
- Message punctuation: TS validation/ledger messages use `—`/`≥`; Python `validation.py`/`engine.py` use ASCII `-` (match each file's existing convention; `metrics.py` keeps `≥`/`—` in `breakeven_flags`).
- Frontend commands (from `frontend/`): tests `npx vitest run`, typecheck `npx tsc -p tsconfig.app.json --noEmit` (bare `tsc` is a no-op), lint `npx eslint .`, deps `npm install --legacy-peer-deps`. Backend (repo root): `python -m pytest -q`.
- Never use `git stash` (shared stack — two subagents violated this in R2b; verify `git stash list` unchanged after your task). Commit directly on the release branch `release-3b-exits-ui`.
- Baseline suite sizes: frontend vitest 505, backend pytest 496 — all stay green throughout; new tests add to these counts.
- Historical docs (`docs/superpowers/plans/*`, `docs/reviews/*`) are point-in-time records — never rewrite them.

---

### Task 1: Spec amendment (calc 2.3.0) — phased sales, refinance, §5.11 restatement

**Files:**
- Modify: `docs/financial-model/calculation-specification.md`

**Interfaces:**
- Produces: the normative rules every later task implements. No code.

- [ ] **Step 1: Amend §4.4 (Sales and repayment)**

Keep the existing §4.4 text as the `sales_phasing = null` behaviour (single disposal in the final month, calc ≤2.2.0 — unchanged). Append, verbatim in spirit:

```markdown
#### 4.4.1 Phased sales [R3b — calc 2.3.0]

Inputs v4's `sales_phasing` block phases the sold portion's receipts.
`sales_phasing = null` (the migration default) = a single 100% tranche in the
final month — byte-identical to calc 2.2.0. A non-null block gives K tranches
`{ month_offset, pct_of_gross_receipts }`, month offsets strictly increasing.

Tranche gross (integer pence): for k < K, g_k = round_half_up(G × pct_k / 100)
where G is the sold portion's gross receipts; the final tranche absorbs the
residue (Σ g_k = G exactly). Selling costs are apportioned pro-rata by tranche
gross with the same final-tranche residue absorption: the total agent fee
(round_half_up(G × agent_pct / 100)) and the flat selling legal fee are each
split as cost_k = round_half_up(total × g_k / G), final tranche absorbs.

Each tranche's net proceeds enter the ledger in its month and sweep the senior
facility under the existing §4.4 arms (sales_sweep_pct, full-redemption vs
partial with the fee clamp), unchanged. Interest thereafter accrues only on the
post-sweep balance (this is automatic: §4's roll-forward reads the closing
balance).

The exit fee is charged once, at the FIRST full redemption, on its §-defined
basis evaluated at that instant (`redemption_balance` = the balance being
redeemed then; `peak_debt` / `committed_gross_facility` unchanged). If cost
draws after that month re-open a balance, the ledger continues under §4's
rules, the fee is not charged again, and the engine raises the amber flag
`facility_redrawn_after_redemption`.

`redemption_balance_at_disposal_pence` remains the balance immediately before
receipts in the FINAL disposal month. The model additionally exposes the
declining redemption schedule: one `{ month, balance_pence }` entry per
disposal month, balance captured immediately before that month's receipts.

Validation (input errors, not flags), applying only when `sales_phasing` is
non-null: at least one tranche; every `month_offset` a whole month in
[0, term − 1], strictly increasing; every percentage finite and > 0; the
percentages sum to 100.0 (tolerance 1e-9 — thirds like 33.4/33.3/33.3 are not
exactly representable in IEEE doubles; pence-level exactness is guaranteed by
the residue absorption above regardless). A non-null block with
`route = 'retain_all'` is an error — tranches apply to the sold portion and a
retain-all exit has none (§2: never silently ignored).
```

- [ ] **Step 2: Add §4.5 (Refinance event)**

```markdown
#### 4.5 Refinance event [R3b — calc 2.3.0]

Inputs v4's `refinance` block models a refinance of the retained portion at
`month_offset`. `null` (the migration default) = no event — byte-identical to
calc 2.2.0, and the §4 "repayment source (sale/refinance) not modelled" red
flag remains for retained exits. Validation rejects a non-null block on
`route = 'sell_all'` (nothing is retained).

Net refinance proceeds = round_half_up(investment_value_pence × ltv_pct / 100)
− arrangement_fee_pence − legal_costs_pence. `investment_value_pence` is an
explicit input, never yield-derived. Negative net proceeds are funded by
uncommitted additional equity (the proceeds applied become 0).

Order within the month (fixed, spec-stated): the sales sweep (§4.4) runs
first, then the refinance event.

If the facility has an outstanding balance B at the event (after any same-
month sweep): the facility is fully redeemed — repayment B plus the exit fee
on its basis (charged only if not already charged; the once-only rule of
§4.4.1 applies across sweep and refinance alike). Proceeds ≥ B + fee: the
surplus distributes to equity that month. Proceeds < B + fee: the shortfall is
absorbed by uncommitted additional equity (existing §4.3 mechanics), which
raises the existing `additional_equity_required` red flag. If the facility has
no balance (already redeemed, or a cash deal), the whole net proceeds
distribute to equity.

The distribution/equity effects flow into §3.15's equity cash-flow vector, so
§3.17 IRR gains a real terminal flow for retained exits. Valuation-based
components keep their "unrealised" labelling (§3.11).
```

- [ ] **Step 3: Re-state §5.11 for phased sales**

Append to §5.11 (existing text stays as the `sales_phasing = null` regime, unchanged):

```markdown
Phased regime [R3b — calc 2.3.0]: when `sales_phasing` is non-null, the
break-even is the minimum total gross sales G (integer pence, uniform
price-fall assumption: every tranche scales by the same factor, so tranche
shares stay pct_k) such that a REPLAY of the sweep fully redeems the facility
by term end. The replay freezes the actual run's monthly draws and capitalised
fees (modelling assumption: a price fall changes receipts, not the cost
schedule), re-accrues rolled-up interest on the replayed balances with §4's
formula, splits G into tranches and costs exactly per §4.4.1, deducts the
enforcement-cost assumption from the FIRST tranche's net proceeds, applies
`sales_sweep_pct` and the §4.4 sweep arms including the fee-once rule (fee
basis evaluated inside the replay: redemption_balance = the replayed balance
at redemption; peak_debt = the replayed peak), and EXCLUDES any planned
refinance event (§5.11 answers the enforcement question: can sales alone
redeem the facility). Feasibility is monotone in G; the solver is the shared
integer bisection.

Structurally unsolvable cases return null with the red flag
`senior_breakeven_unsolvable` (message stating the reason), not the
cap-exhausted flag: facility draws after the final tranche month (no sale
price can redeem), or `sales_sweep_pct = 0`.
```

- [ ] **Step 4: Sweep the remaining spec references**

1. Header line 3: `Calculation version 2.3.0`; line 4 date. Changelog (line ~8): add `2.3.0 — phased-sales sweep (§4.4.1), refinance event (§4.5), §5.11 phased regime, declining redemption schedule, facility_redrawn_after_redemption flag (R3b); no numeric change for inputs with null sales_phasing/refinance.`
2. Marker legend (line 11): change `[R3b]` to "implemented" status alongside R1/R3a; the "not available" display rule now scopes to remaining unimplemented markers only.
3. §6.1's closing sentence (line ~351) — "While calc is 2.2.0, non-null `sales_phasing` or `refinance` is a hard validation error" — replace with: `sales_phasing` and `refinance` are implemented from calc 2.3.0 (§4.4.1, §4.5).
4. §4.4 line ~250-251: the "phased sales rates are R2" / "Refinance proceeds are R2" sentences → point at §4.4.1 / §4.5.
5. §3.17: add one sentence — retained exits with a modelled refinance produce a real terminal equity flow (§4.5); without one, IRR remains null and unlabelled substitutes remain prohibited.
6. §2 input-basis table: add rows for `sales_phasing.tranches[].pct_of_gross_receipts` (percentage of the sold portion's gross receipts) and `refinance.investment_value_pence` (explicit lender/valuer investment value of the retained portion — never derived from rents or yields).
7. Flag inventory (wherever `FlagCode` values are listed): add `facility_redrawn_after_redemption` (amber).

- [ ] **Step 5: Commit**

```bash
git add docs/financial-model/calculation-specification.md
git commit -m "docs(spec): calc 2.3.0 — phased-sales sweep, refinance event, §5.11 phased regime"
```

---

### Task 2: v4 hydration lift + downgrade-shim removal (binding entry checklist)

**Files:**
- Modify: `frontend/src/lib/conversion-defaults.ts` (append after `defaultCalculatorInputsV3`, line 256)
- Modify: `frontend/src/components/ConversionCalculator.tsx` (lines 3-5, 76-77, 87, 101, 114-121, 123)
- Modify: `frontend/src/components/ExportPage.tsx` (lines 8, 87-93)
- Modify: `frontend/src/lib/deal-spider.ts` (lines 8, 174)
- Modify: all 11 calculator page components' `Props` (`AcquisitionPage.tsx`, `UnitMixPage.tsx`, `ConversionCostsPage.tsx`, `FinancePage.tsx`, `CashflowPage.tsx`, `AppraisalSummaryPage.tsx`, `ScenariosPage.tsx`, `ExitStrategyPage.tsx`, `RiskRegisterPage.tsx`, `DealSpiderPage.tsx`, `InvestorSummaryPage.tsx`) + test files `FinancePage.test.tsx`, `AppraisalSummaryPage.test.tsx`
- Modify: `frontend/src/lib/model/migrate.ts` (delete lines 182-187 + its doc-comment 144-177; add a v4 guard), `app/financial_model/migrate.py` (delete lines 549-556 + doc-comment 532-547; add guard)
- Test: `frontend/src/lib/model/migrate.test.ts` (rewrite lines 173-226), `tests/test_migrate_v4.py` (rewrite `TestV4DowngradeToV3`, lines 161-211), `frontend/src/lib/conversion-defaults.test.ts` (extend)

**Interfaces:**
- Consumes: existing `migrateInputsToV4`, `CalculatorInputsV4`, `AnyCalculatorInputs`.
- Produces: `defaultCalculatorInputsV4(project?): CalculatorInputsV4`; `ConversionCalculator` state typed `CalculatorInputsV4` (hydrated via `migrateInputsToV4`, saved as v4); `computeSpider(inputs: AnyCalculatorInputs, eligibility): SpiderResult`; `migrateInputsToV3` **throws** on a v4 snapshot in both engines.

- [ ] **Step 1: Write the failing tests**

Replace `migrate.test.ts:173-226` (the three shim tests) with:

```ts
describe('migrateInputsToV3 refuses v4 documents (R3b — shim removed)', () => {
  it('throws instead of downgrading — dropping the v4 blocks would lose user data', () => {
    const v4 = migrateInputsToV4({});
    expect(() => migrateInputsToV3(v4 as unknown as Record<string, unknown>))
      .toThrow(/v4 document/);
  });
  it('migrateInputsToV4 remains the hydration path and preserves all three blocks', () => {
    const v4 = migrateInputsToV4({});
    v4.sales_phasing = { tranches: [{ month_offset: 11, pct_of_gross_receipts: 100 }] };
    v4.refinance = {
      month_offset: 11, investment_value_pence: 30_000_000, ltv_pct: 65,
      arrangement_fee_pence: 0, legal_costs_pence: 0,
    };
    const again = migrateInputsToV4(v4 as unknown as Record<string, unknown>);
    expect(again.sales_phasing).toEqual(v4.sales_phasing);
    expect(again.refinance).toEqual(v4.refinance);
  });
});
```

Append to `conversion-defaults.test.ts` (follow its existing style):

```ts
describe('defaultCalculatorInputsV4', () => {
  it('is v3 defaults plus the three null blocks', () => {
    const v4 = defaultCalculatorInputsV4();
    expect(v4.inputs_version).toBe(4);
    expect(v4.programme).toBeNull();
    expect(v4.sales_phasing).toBeNull();
    expect(v4.refinance).toBeNull();
    expect(v4.finance).toEqual(defaultCalculatorInputsV3().finance);
  });
});
```

Rewrite `tests/test_migrate_v4.py` `TestV4DowngradeToV3` as `TestV3RefusesV4` with the same two behaviours (pytest.raises `ValueError` matching `"v4 document"`; preservation via `migrate_inputs_to_v4`).

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/migrate.test.ts src/lib/conversion-defaults.test.ts` and `python -m pytest -q tests/test_migrate_v4.py`
Expected: FAIL — shim still downgrades; `defaultCalculatorInputsV4` not exported.

- [ ] **Step 3: Implement**

1. `conversion-defaults.ts`:

```ts
/** v4 defaults (Release 3b): v3 plus the three nullable blocks. null programme =
 * auto §6 windows; null sales_phasing = single final-month tranche; null
 * refinance = no event (spec §6.1, §4.4.1, §4.5). */
export function defaultCalculatorInputsV4(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV4 {
  const v3 = defaultCalculatorInputsV3(project);
  return { ...v3, inputs_version: 4, programme: null, sales_phasing: null, refinance: null };
}
```

2. `migrate.ts`: delete the `isV4` downgrade branch (182-187) and its 34-line doc-comment; in its place:

```ts
if (isV4(snapshot)) {
  // R3b: v4 documents carry programme/sales_phasing/refinance the UI can author.
  // Downgrading would silently discard them — hydrate with migrateInputsToV4.
  throw new Error('migrateInputsToV3: input is a v4 document — use migrateInputsToV4');
}
```

Mirror in `migrate.py` (`raise ValueError("migrate_inputs_to_v3: input is a v4 document - use migrate_inputs_to_v4")`).

3. `ConversionCalculator.tsx`: import `migrateInputsToV4` + `defaultCalculatorInputsV4` + `CalculatorInputsV4` (drop `migrateInputsToV3`, `migrateV3toV4`, `defaultCalculatorInputsV3`, `CalculatorInputsV3` here); state `useState<CalculatorInputsV4>(() => defaultCalculatorInputsV4(project ?? undefined))`; the project-change reset (line 87) likewise; hydration (line 101) `setInputs(migrateInputsToV4(appraisal.inputs_snapshot as Record<string, unknown>, project))`; engine feed (line 121) becomes `runAppraisal(inputs)` (delete the `migrateV3toV4` wrap and its comment block 114-120); `updateInputs` takes `Partial<CalculatorInputsV4>`.
4. All 11 page components + `LenderVarianceBridge` + the 2 page test files: mechanical `CalculatorInputsV3` → `CalculatorInputsV4` in `Props`/fixtures. (`applyScenario` and `runAppraisal` are already generic — untouched.)
5. `ExportPage.tsx` line 93: `computeSpider(migrateInputsToV4(normaliseUnitAreas(raw), selectedProject), eligibility)` — note this also applies `normaliseUnitAreas`, closing the pre-existing spider/memo inconsistency (memo path line 119 already applies it); drop the `migrateInputsToV3` import and the 87-92 comment.
6. `deal-spider.ts`: `computeSpider(inputs: AnyCalculatorInputs, eligibility: EligibilityAssessment | null)` (import `AnyCalculatorInputs`; body unchanged).

- [ ] **Step 4: Run the full suites + typecheck**

Run: `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit`, then `python -m pytest -q`
Expected: PASS (505+/496+). The save path now posts v4 state; `app/api/app.py` already merges v4 via `migrate_inputs_to_v4` — no server change.

- [ ] **Step 5: Commit**

```bash
git add frontend/src app/financial_model/migrate.py tests/test_migrate_v4.py
git commit -m "refactor(model): lift hydration to v4, remove the v4->v3 downgrade shims (entry checklist)"
```

---

### Task 3: TS validation — sales_phasing + refinance rules replace the hard-rejects

**Files:**
- Modify: `frontend/src/lib/model/validation.ts` (replace lines 186-193)
- Test: `frontend/src/lib/model/validation.test.ts` (replace the test at line 310; add the new rules)

**Interfaces:**
- Consumes: `CalculatorInputsV4`, the existing `err(field, message)` helper (validation.ts:43).
- Produces: validation rules Task 12's UI surfaces; no new exports.

- [ ] **Step 1: Write the failing tests** (replace the `'hard-rejects…'` test; build v4 via `migrateInputsToV4({})`, `finance.term_months = 12`)

```ts
describe('v4 sales_phasing validation (calc 2.3.0)', () => {
  const withTranches = (tranches: Array<{ month_offset: number; pct_of_gross_receipts: number }>,
    route: 'sell_all' | 'retain_all' | 'blended' = 'sell_all') => {
    const v4 = migrateInputsToV4({});
    v4.finance.term_months = 12;
    v4.exit_strategy.route = route;
    v4.sales_phasing = { tranches };
    return v4;
  };
  const errorsOn = (field: string, inputs: CalculatorInputsV4) =>
    validateInputs(inputs).some((i) => i.severity === 'error' && i.field.startsWith(field));

  it('accepts a well-formed tranche set', () => {
    expect(errorsOn('sales_phasing', withTranches([
      { month_offset: 9, pct_of_gross_receipts: 40 },
      { month_offset: 10, pct_of_gross_receipts: 35 },
      { month_offset: 11, pct_of_gross_receipts: 25 },
    ]))).toBe(false);
  });
  it('rejects the block on retain_all', () => {
    expect(errorsOn('sales_phasing',
      withTranches([{ month_offset: 11, pct_of_gross_receipts: 100 }], 'retain_all'))).toBe(true);
  });
  it('rejects an empty tranche list', () => {
    expect(errorsOn('sales_phasing', withTranches([]))).toBe(true);
  });
  it('rejects out-of-range, fractional, non-increasing months and non-positive or non-finite pcts', () => {
    for (const tranches of [
      [{ month_offset: 12, pct_of_gross_receipts: 100 }],
      [{ month_offset: -1, pct_of_gross_receipts: 100 }],
      [{ month_offset: 5.5, pct_of_gross_receipts: 100 }],
      [{ month_offset: 10, pct_of_gross_receipts: 50 }, { month_offset: 10, pct_of_gross_receipts: 50 }],
      [{ month_offset: 10, pct_of_gross_receipts: 50 }, { month_offset: 9, pct_of_gross_receipts: 50 }],
      [{ month_offset: 11, pct_of_gross_receipts: 0 }],
      [{ month_offset: 11, pct_of_gross_receipts: Number.NaN }],
    ]) expect(errorsOn('sales_phasing', withTranches(tranches))).toBe(true);
  });
  it('rejects percentages not summing to 100 (beyond 1e-9)', () => {
    expect(errorsOn('sales_phasing', withTranches([
      { month_offset: 10, pct_of_gross_receipts: 60 },
      { month_offset: 11, pct_of_gross_receipts: 39.9 },
    ]))).toBe(true);
  });
});

describe('v4 refinance validation (calc 2.3.0)', () => {
  const withRefi = (refi: Partial<RefinanceInputs>,
    route: 'sell_all' | 'retain_all' | 'blended' = 'retain_all') => {
    const v4 = migrateInputsToV4({});
    v4.finance.term_months = 12;
    v4.exit_strategy.route = route;
    v4.refinance = {
      month_offset: 11, investment_value_pence: 30_000_000, ltv_pct: 65,
      arrangement_fee_pence: 0, legal_costs_pence: 0, ...refi,
    };
    return v4;
  };
  const errorsOn = (inputs: CalculatorInputsV4) =>
    validateInputs(inputs).some((i) => i.severity === 'error' && i.field.startsWith('refinance'));

  it('accepts a well-formed block on retain_all and blended', () => {
    expect(errorsOn(withRefi({}))).toBe(false);
    expect(errorsOn(withRefi({}, 'blended'))).toBe(false);
  });
  it('rejects the block on sell_all', () => {
    expect(errorsOn(withRefi({}, 'sell_all'))).toBe(true);
  });
  it('rejects bad months, values, fees, and LTV', () => {
    for (const bad of [
      { month_offset: 12 }, { month_offset: -1 }, { month_offset: 3.5 },
      { investment_value_pence: -1 }, { investment_value_pence: Number.NaN },
      { ltv_pct: 0 }, { ltv_pct: 101 }, { ltv_pct: Number.NaN },
      { arrangement_fee_pence: -1 }, { legal_costs_pence: -1 },
    ]) expect(errorsOn(withRefi(bad))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts`
Expected: FAIL — the hard-rejects fire on every non-null block.

- [ ] **Step 3: Implement** — replace validation.ts lines 186-193 with:

```ts
if ('sales_phasing' in inputs && inputs.sales_phasing != null) {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const trs = inputs.sales_phasing.tranches;
  if (inputs.exit_strategy.route === 'retain_all') {
    err('sales_phasing', 'Phased sales apply to the sold portion — a retain-all exit has none. Remove the block or change the exit route.');
  }
  if (trs.length === 0) err('sales_phasing', 'Phased sales need at least one tranche.');
  trs.forEach((tr, i) => {
    const field = `sales_phasing.tranches[${i}]`;
    if (!Number.isInteger(tr.month_offset) || tr.month_offset < 0 || tr.month_offset > term - 1) {
      err(field, `Tranche month must be a whole month between 0 and ${term - 1}.`);
    }
    if (!Number.isFinite(tr.pct_of_gross_receipts) || tr.pct_of_gross_receipts <= 0) {
      err(field, 'Tranche percentage must be a finite number greater than zero.');
    }
    if (i > 0 && !(tr.month_offset > trs[i - 1].month_offset)) {
      err(field, 'Tranche months must be strictly increasing.');
    }
  });
  const pctSum = trs.reduce((a, b) => a + b.pct_of_gross_receipts, 0);
  if (trs.length > 0 && !(Math.abs(pctSum - 100) <= 1e-9)) {
    err('sales_phasing', `Tranche percentages must sum to 100 (currently ${pctSum}).`);
  }
}
if ('refinance' in inputs && inputs.refinance != null) {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const rf = inputs.refinance;
  if (inputs.exit_strategy.route === 'sell_all') {
    err('refinance', 'Refinance applies to the retained portion — a sell-all exit retains nothing. Remove the block or change the exit route.');
  }
  if (!Number.isInteger(rf.month_offset) || rf.month_offset < 0 || rf.month_offset > term - 1) {
    err('refinance', `Refinance month must be a whole month between 0 and ${term - 1}.`);
  }
  if (!Number.isFinite(rf.investment_value_pence) || rf.investment_value_pence < 0) {
    err('refinance', 'Refinance investment value must be zero or more.');
  }
  if (!Number.isFinite(rf.ltv_pct) || rf.ltv_pct <= 0 || rf.ltv_pct > 100) {
    err('refinance', 'Refinance LTV must be greater than 0 and at most 100.');
  }
  if (!Number.isFinite(rf.arrangement_fee_pence) || rf.arrangement_fee_pence < 0) {
    err('refinance', 'Refinance arrangement fee must be zero or more.');
  }
  if (!Number.isFinite(rf.legal_costs_pence) || rf.legal_costs_pence < 0) {
    err('refinance', 'Refinance legal costs must be zero or more.');
  }
}
```

(The NaN-through-JSON hazard the programme weights guard documents applies here too — hence every `Number.isFinite`.)

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/validation.ts frontend/src/lib/model/validation.test.ts
git commit -m "feat(model): validate sales_phasing/refinance blocks; retire the 2.2.0 hard-rejects (TS)"
```

---

### Task 4: TS engine — tranche receipts + ledger sweep mechanics

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts` (`Schedule` ~line 199, `LedgerMonth` ~line 212, `MonthlyModel` ~line 235, `FlagCode` ~line 169)
- Modify: `frontend/src/lib/model/schedule.ts` (lines 89-100)
- Modify: `frontend/src/lib/model/monthly-engine.ts` (loop lines 90-246)
- Test: `frontend/src/lib/model/schedule.test.ts`, `frontend/src/lib/model/monthly-engine.test.ts` (extend)

**Interfaces:**
- Consumes: `SalesPhasingInputs` (existing type), Task 3's validation (engine still clamps defensively).
- Produces: `Schedule.refinance: { month: number; net_proceeds_pence: number } | null` (wired by Task 5 — declared now so the type changes land once); `LedgerMonth.refinance_proceeds_pence: number` (always 0 until Task 5); `MonthlyModel.redemption_schedule: Array<{ month: number; balance_pence: number }>`; `FlagCode` gains `'facility_redrawn_after_redemption'`. Tranche receipts split per spec §4.4.1.

- [ ] **Step 1: Write the failing tests**

Append to `schedule.test.ts`:

```ts
describe('buildSchedule with sales_phasing (spec §4.4.1)', () => {
  const phased = () => {
    const v4 = migrateInputsToV4({});
    v4.finance.term_months = 12;
    v4.unit_mix.units = [
      { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_000, comparable_notes: '' },
      { id: 'u2', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_001, comparable_notes: '' },
    ];
    v4.exit_strategy.selling_agent_fee_pct = 1.5;
    v4.exit_strategy.selling_legal_fee_pence = 400_000;
    return v4;
  };

  it('null phasing is byte-identical to the single final-month disposal', () => {
    const v4 = phased();
    const single = buildSchedule(v4);
    v4.sales_phasing = { tranches: [{ month_offset: 11, pct_of_gross_receipts: 100 }] };
    expect(buildSchedule(v4)).toEqual(single);   // single 100% tranche == null (identity)
  });

  it('splits gross and costs pro-rata with final-tranche residue absorption', () => {
    const v4 = phased();
    v4.sales_phasing = { tranches: [
      { month_offset: 9, pct_of_gross_receipts: 40 },
      { month_offset: 10, pct_of_gross_receipts: 35 },
      { month_offset: 11, pct_of_gross_receipts: 25 },
    ] };
    const s = buildSchedule(v4);
    const gross = 60_000_001;
    const agent = Math.round((gross * 1.5) / 100);
    const g9 = Math.round((gross * 40) / 100), g10 = Math.round((gross * 35) / 100);
    expect(s.receipts[9].gross_sale_pence).toBe(g9);
    expect(s.receipts[10].gross_sale_pence).toBe(g10);
    expect(s.receipts[11].gross_sale_pence).toBe(gross - g9 - g10);          // residue
    const a9 = Math.round((agent * g9) / gross), a10 = Math.round((agent * g10) / gross);
    expect(s.receipts[9].agent_fee_pence).toBe(a9);
    expect(s.receipts[11].agent_fee_pence).toBe(agent - a9 - a10);           // residue
    const legalSum = s.receipts.reduce((x, r) => x + r.selling_legal_pence, 0);
    expect(legalSum).toBe(400_000);                                          // conservation
    expect(s.totals.selling_costs_pence).toBe(agent + 400_000);              // totals unchanged
    expect(s.refinance).toBeNull();
  });
});
```

Append to `monthly-engine.test.ts` (reuse its `TERMS`/`USES` builder conventions):

```ts
describe('phased sweep mechanics (spec §4.4.1)', () => {
  // 4-month toy: uses only in month 0, receipts in months 2 and 3.
  const schedule = (r2: MonthReceipts, r3: MonthReceipts): Schedule => ({
    term_months: 4,
    uses: [{ ...EMPTY_USES, construction_pence: 10_000_000 }, EMPTY_USES, EMPTY_USES, EMPTY_USES],
    receipts: [EMPTY_RECEIPTS, EMPTY_RECEIPTS, r2, r3],
    refinance: null,
    totals: TOTALS_STUB,   // reuse the file's stub-building helper for totals
  });

  it('captures a declining redemption schedule, one entry per disposal month', () => {
    const m = runLedger(schedule(
      { gross_sale_pence: 6_000_000, agent_fee_pence: 0, selling_legal_pence: 0 },
      { gross_sale_pence: 6_000_000, agent_fee_pence: 0, selling_legal_pence: 0 },
    ), TERMS_ROLLED_UP_NO_CAPS, []);
    expect(m.redemption_schedule.map((e) => e.month)).toEqual([2, 3]);
    expect(m.redemption_schedule[0].balance_pence).toBeGreaterThan(m.redemption_schedule[1].balance_pence);
    expect(m.redemption_balance_at_disposal_pence).toBe(m.redemption_schedule[1].balance_pence);
  });

  it('charges the exit fee once, at first full redemption, and never again', () => {
    const m = runLedger(schedule(
      { gross_sale_pence: 50_000_000, agent_fee_pence: 0, selling_legal_pence: 0 }, // clears everything
      { gross_sale_pence: 1_000_000, agent_fee_pence: 0, selling_legal_pence: 0 },
    ), TERMS_ROLLED_UP_NO_CAPS, []);
    expect(m.months[2].exit_fee_pence).toBeGreaterThan(0);
    expect(m.months[3].exit_fee_pence).toBe(0);
    expect(m.totals.exit_fee_pence).toBe(m.months[2].exit_fee_pence);
    expect(m.months[3].distribution_pence).toBe(1_000_000);   // post-redemption tranche distributes whole
  });

  it('flags a facility re-drawn after full redemption (amber, once)', () => {
    const s = schedule(
      { gross_sale_pence: 50_000_000, agent_fee_pence: 0, selling_legal_pence: 0 },
      EMPTY_RECEIPTS,
    );
    s.uses[3] = { ...EMPTY_USES, construction_pence: 2_000_000 };  // spend after redemption
    const m = runLedger(s, TERMS_ROLLED_UP_NO_CAPS, []);
    const f = m.flags.filter((x) => x.code === 'facility_redrawn_after_redemption');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('amber');
    expect(f[0].month).toBe(3);
  });
});
```

(Adapt the fixture constants — `EMPTY_USES`, `EMPTY_RECEIPTS`, `TERMS_ROLLED_UP_NO_CAPS`, `TOTALS_STUB` — to the file's existing local helpers; the file already builds equivalent shapes for fixtures B–F. Every pre-existing test in this file must keep passing untouched except mechanical `Schedule` shape additions (`refinance: null`).)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/schedule.test.ts src/lib/model/monthly-engine.test.ts`
Expected: FAIL — no `redemption_schedule`, no fee-once guard, type errors on `refinance`.

- [ ] **Step 3: Implement the type changes** (`finance-types.ts`)

- `Schedule` gains `refinance: { month: number; net_proceeds_pence: number } | null;` (after `receipts`).
- `LedgerMonth` gains `refinance_proceeds_pence: number;` (after `net_receipts_pence`).
- `MonthlyModel` gains, after `redemption_balance_at_disposal_pence`:

```ts
  /** Spec §4.4.1 declining redemption schedule: one entry per disposal month,
   * balance captured immediately before that month's receipts. Empty for cash
   * deals and no-disposal schedules. The scalar above equals the last entry. */
  redemption_schedule: Array<{ month: number; balance_pence: number }>;
```

- `FlagCode` gains `| 'facility_redrawn_after_redemption'`.

- [ ] **Step 4: Implement `buildSchedule`** — replace lines 89-100 with:

```ts
  const agentFee = Math.round((grossSales * inputs.exit_strategy.selling_agent_fee_pct) / 100);
  const sellingLegal = soldUnits.length > 0 ? inputs.exit_strategy.selling_legal_fee_pence : 0;
  const salesPhasing = 'sales_phasing' in inputs ? inputs.sales_phasing : null;
  if (grossSales > 0) {
    if (salesPhasing == null) {
      // calc 2.2.0 behaviour, byte-identical: single disposal in the final month (spec §4.4)
      receipts[term - 1] = {
        gross_sale_pence: grossSales,
        agent_fee_pence: agentFee,
        selling_legal_pence: sellingLegal,
      };
    } else {
      // spec §4.4.1: tranche split with final-tranche residue absorption; selling
      // costs apportioned pro-rata by tranche gross, final tranche absorbs.
      // Month clamps are belt-and-braces — validation.ts owns the real rules.
      const trs = salesPhasing.tranches;
      let grossAllocated = 0, agentAllocated = 0, legalAllocated = 0;
      trs.forEach((tr, i) => {
        const last = i === trs.length - 1;
        const gross = last ? grossSales - grossAllocated
          : Math.round((grossSales * tr.pct_of_gross_receipts) / 100);
        const agent = last ? agentFee - agentAllocated
          : Math.round((agentFee * gross) / grossSales);
        const legal = last ? sellingLegal - legalAllocated
          : Math.round((sellingLegal * gross) / grossSales);
        grossAllocated += gross; agentAllocated += agent; legalAllocated += legal;
        const m = Math.min(Math.max(0, Math.floor(tr.month_offset)), term - 1);
        receipts[m].gross_sale_pence += gross;
        receipts[m].agent_fee_pence += agent;
        receipts[m].selling_legal_pence += legal;
      });
    }
  }

  // spec §4.5 net refinance proceeds — wired into the ledger by the refinance task.
  const refinanceInput = 'refinance' in inputs ? inputs.refinance : null;
  const refinance = refinanceInput == null ? null : {
    month: Math.min(Math.max(0, Math.floor(refinanceInput.month_offset)), term - 1),
    net_proceeds_pence:
      Math.round((refinanceInput.investment_value_pence * refinanceInput.ltv_pct) / 100)
      - refinanceInput.arrangement_fee_pence - refinanceInput.legal_costs_pence,
  };
```

Add `refinance,` to the returned object (after `receipts`). Delete the now-unused `const saleMonth = term - 1;`.

- [ ] **Step 5: Implement the ledger mechanics** (`monthly-engine.ts`)

Declarations (with the other `let`s, ~line 82-88): `let facilityRedeemed = false;`, `let facilityRedrawnFlagged = false;`, `const redemptionSchedule: Array<{ month: number; balance_pence: number }> = [];`

Inside the loop, immediately after the draw/equity waterfall (after line 136, before interest accrual):

```ts
    if (draw > 0 && facilityRedeemed && !facilityRedrawnFlagged) {
      facilityRedrawnFlagged = true;
      flags.push({
        code: 'facility_redrawn_after_redemption', severity: 'amber', month: m, amount_pence: draw,
        message: `Facility drawn again in month ${m} after full redemption — the exit fee was charged at first redemption and is not re-charged.`,
      });
    }
```

Replace the redemption-balance capture (lines 158-160):

```ts
    if (!isCash && r.gross_sale_pence > 0) {
      redemptionBalanceAtDisposal = balance;
      redemptionSchedule.push({ month: m, balance_pence: balance });
    }
```

In the sweep block, the fee line (168) becomes fee-once (everything else in both arms stays byte-identical):

```ts
        const fee = facilityRedeemed ? 0 : exitFeeAmount(finance, grossFacility, peakDebt, balance);
        if (sweepAvailable >= balance + fee) {
          repayment = balance;
          exitFee = fee;
          totalExitFee += fee;
          facilityRedeemed = true;
          balance = 0;
        } else {
```

`months.push` gains `refinance_proceeds_pence: 0,` (Task 5 wires the real value). The result object gains `redemption_schedule: redemptionSchedule,` after `redemption_balance_at_disposal_pence`.

- [ ] **Step 6: Run the full model suite + typecheck**

Run: `cd frontend && npx vitest run src/lib/model && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS — including every pre-existing fixture test (identity: single-disposal schedules produce one redemption_schedule entry whose balance equals the scalar, fee behaviour unchanged).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/model
git commit -m "feat(model): phased tranche receipts, fee-once sweep, declining redemption schedule (TS)"
```

---

### Task 5: TS engine — refinance event

**Files:**
- Modify: `frontend/src/lib/model/monthly-engine.ts` (after the sweep block, ~line 186)
- Test: `frontend/src/lib/model/monthly-engine.test.ts` (extend)

**Interfaces:**
- Consumes: `Schedule.refinance` (Task 4), `exitFeeAmount`.
- Produces: refinance redemption per spec §4.5; `LedgerMonth.refinance_proceeds_pence` carries the applied net proceeds; IRR terminal flow via the existing `equity_cashflows_pence` assembly (no metrics change needed for IRR).

- [ ] **Step 1: Write the failing tests** (append to `monthly-engine.test.ts`, same toy-schedule helpers as Task 4)

```ts
describe('refinance event (spec §4.5)', () => {
  const withRefi = (net: number, month: number, receipts2: MonthReceipts = EMPTY_RECEIPTS): Schedule => ({
    term_months: 4,
    uses: [{ ...EMPTY_USES, construction_pence: 10_000_000 }, EMPTY_USES, EMPTY_USES, EMPTY_USES],
    receipts: [EMPTY_RECEIPTS, EMPTY_RECEIPTS, receipts2, EMPTY_RECEIPTS],
    refinance: { month, net_proceeds_pence: net },
    totals: TOTALS_STUB,
  });

  it('surplus refinance redeems the facility and distributes the excess', () => {
    const m = runLedger(withRefi(50_000_000, 3), TERMS_ROLLED_UP_NO_CAPS, []);
    const last = m.months[3];
    expect(last.closing_balance_pence).toBe(0);
    expect(last.exit_fee_pence).toBeGreaterThan(0);                    // fee charged at refinance redemption
    expect(last.refinance_proceeds_pence).toBe(50_000_000);
    expect(last.distribution_pence)
      .toBe(50_000_000 - last.repayment_pence - last.exit_fee_pence);
    expect(m.flags.some((f) => f.code === 'senior_outstanding_at_maturity')).toBe(false);
    expect(m.equity_cashflows_pence[3]).toBe(last.distribution_pence); // IRR terminal flow
  });

  it('shortfall is absorbed by additional equity and red-flagged', () => {
    const m = runLedger(withRefi(1_000_000, 3), TERMS_ROLLED_UP_NO_CAPS, []);
    const last = m.months[3];
    expect(last.closing_balance_pence).toBe(0);                        // still fully redeemed
    expect(last.additional_equity_pence)
      .toBe(last.repayment_pence + last.exit_fee_pence - 1_000_000);
    expect(last.distribution_pence).toBe(0);
    expect(m.flags.some((f) => f.code === 'additional_equity_required')).toBe(true);
  });

  it('same-month ordering: the sales sweep runs first, then the refinance', () => {
    const sale: MonthReceipts = { gross_sale_pence: 4_000_000, agent_fee_pence: 0, selling_legal_pence: 0 };
    const m = runLedger(withRefi(50_000_000, 2, sale), TERMS_ROLLED_UP_NO_CAPS, []);
    const mm = m.months[2];
    // sweep repaid 4,000,000 first (partial), refinance repaid the rest — total repayment
    // exceeds the sweep alone and the redemption_schedule entry is the PRE-receipts balance.
    expect(mm.repayment_pence).toBeGreaterThan(4_000_000);
    expect(m.redemption_schedule[0].balance_pence).toBeGreaterThan(mm.repayment_pence - 4_000_000);
    expect(mm.closing_balance_pence).toBe(0);
  });

  it('negative net proceeds are funded by additional equity; nothing distributes', () => {
    const m = runLedger(withRefi(-500_000, 3), TERMS_ROLLED_UP_NO_CAPS, []);
    const last = m.months[3];
    expect(last.refinance_proceeds_pence).toBe(0);
    expect(last.additional_equity_pence)
      .toBe(500_000 + last.repayment_pence + last.exit_fee_pence);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/monthly-engine.test.ts`
Expected: FAIL — refinance ignored.

- [ ] **Step 3: Implement** — inside the loop, immediately after the receipts/sweep block (after `distribution = netReceipts - repayment - exitFee;` closes, ~line 186), declare `let refinanceProceeds = 0;` alongside `repayment`/`exitFee`/`distribution` and add:

```ts
    // spec §4.5 refinance event — fixed order: the sales sweep above ran first.
    const refi = schedule.refinance;
    if (refi != null && refi.month === m) {
      let refiNet = refi.net_proceeds_pence;
      if (refiNet < 0) {
        additionalEquity += -refiNet;   // fees exceed the advance — equity funds the difference
        refiNet = 0;
      }
      refinanceProceeds = refiNet;
      if (!isCash && balance > 0) {
        const fee = facilityRedeemed ? 0 : exitFeeAmount(finance, grossFacility, peakDebt, balance);
        const required = balance + fee;
        repayment += balance;
        exitFee += fee;
        totalExitFee += fee;
        facilityRedeemed = true;
        if (refiNet >= required) {
          distribution += refiNet - required;
        } else {
          additionalEquity += required - refiNet;   // §4.3 mechanics; additional_equity_required fires below
        }
        balance = 0;
      } else {
        distribution += refiNet;   // already redeemed, or a cash deal: proceeds distribute whole
      }
    }
```

`months.push` line: `refinance_proceeds_pence: refinanceProceeds,`. Note `equityCashflows.push` (line 244) and the `totalAdditionalEquity` flag block already handle everything downstream — do not duplicate them.

- [ ] **Step 4: Run the full frontend suite + typecheck**

Run: `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS — a `retain_all` run with a refinance now has a positive equity cash flow, so any test asserting IRR null for retained exits must still pass (those tests use refinance-free inputs; identity).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model
git commit -m "feat(model): refinance redemption event with surplus/shortfall equity flows (TS)"
```

---

### Task 6: TS metrics — §5.11 phased replay solver

**Files:**
- Modify: `frontend/src/lib/model/breakeven.ts`
- Modify: `frontend/src/lib/model/metrics.ts` (`breakevenFlags` lines 22-38, senior block lines 98-120, flag push line 142)
- Modify: `frontend/src/lib/model/index.ts` (re-export the new solver)
- Test: `frontend/src/lib/model/breakeven.test.ts`, `frontend/src/lib/model/metrics.test.ts` (extend)

**Interfaces:**
- Consumes: `exitFeeAmount` (import from `./monthly-engine` — no cycle: monthly-engine imports nothing from breakeven), `FacilityTerms`.
- Produces: `PhasedSeniorBreakevenTerms` interface + `solveSeniorBreakevenPhased(t: PhasedSeniorBreakevenTerms): number | null`; `breakevenFlags(seniorNull, developerNull, agentFeePct, seniorUnsolvableReason?: string | null)` (4th param optional, default null — existing call sites stay valid).

- [ ] **Step 1: Write the failing tests**

Append to `breakeven.test.ts`:

```ts
describe('solveSeniorBreakevenPhased (spec §5.11 phased regime)', () => {
  // 4 months; 10,000,000 drawn month 0; 2%/mo rolled up; fee 0 (isolates the recurrence);
  // two tranches 50/50 in months 2 and 3; no agent fee/legal/enforcement; 100% sweep.
  const base = (): PhasedSeniorBreakevenTerms => ({
    draws_and_fees_pence: [10_000_000, 0, 0, 0],
    monthly_rate: 0.02,
    rolled_up: true,
    sales_sweep_pct: 100,
    tranches: [
      { month_offset: 2, pct_of_gross_receipts: 50 },
      { month_offset: 3, pct_of_gross_receipts: 50 },
    ],
    selling_agent_fee_pct: 0,
    selling_legal_fee_pence: 0,
    enforcement_cost_assumption_pence: 0,
    finance: { ...TERMS_FEE_FREE },            // reuse/extend the file's terms helper; exit_fee_pct 0
    committed_gross_facility_pence: 0,
  });

  it('matches the hand-derived minimum and is tight (G−1 infeasible)', () => {
    // Hand derivation: balance m0 = 10,000,000×1.02 = 10,200,000 (fee cap round: 10,000,000
    // + round(10,000,000×.02)); m1 ×1.02 → 10,404,000; m2 accrue → 10,612,080, sweep g;
    // m3 accrue on (10,612,080 − round(G/2)) then sweep G − round(G/2) must clear.
    // Solving round-free: G/2×(1.02 + 1) ≥ 10,612,080×1.02 → G ≥ 10,715,163.5…
    const g = solveSeniorBreakevenPhased(base());
    expect(g).not.toBeNull();
    const exact = g as number;
    expect(Math.abs(exact - 10_715_164)).toBeLessThanOrEqual(2);  // rounding-step tolerance on the derivation
    // Tightness is exact regardless: the solver's own predicate flips at g.
    expect(solveSeniorBreakevenPhased({ ...base(), draws_and_fees_pence: [10_000_000, 0, 0, 0] })).toBe(exact);
  });

  it('single tranche at the final month degenerates towards the static solver world', () => {
    const t = { ...base(), tranches: [{ month_offset: 3, pct_of_gross_receipts: 100 }] };
    const g = solveSeniorBreakevenPhased(t);
    // balance at m3 = 10,000,000×1.02³ (rounded per month); fee 0 → G = that balance.
    expect(g).toBe(10_612_080 + Math.round(10_612_080 * 0.02));
  });

  it('returns null when draws continue after the final tranche or sweep is 0%', () => {
    expect(solveSeniorBreakevenPhased({
      ...base(), draws_and_fees_pence: [10_000_000, 0, 0, 5_000_000],
      tranches: [{ month_offset: 2, pct_of_gross_receipts: 100 }],
    })).toBeNull();
    expect(solveSeniorBreakevenPhased({ ...base(), sales_sweep_pct: 0 })).toBeNull();
  });
});
```

Append to `metrics.test.ts`:

```ts
describe('§5.11 under phasing', () => {
  it('phased inputs produce a senior break-even from the replay solver', () => {
    const v4 = migrateInputsToV4({});
    // build a dev-finance deal (reuse the file's fixture-building helpers), then:
    v4.sales_phasing = { tranches: [
      { month_offset: 10, pct_of_gross_receipts: 60 },
      { month_offset: 11, pct_of_gross_receipts: 40 },
    ] };
    const run = runAppraisal(v4);
    expect(run.metrics.senior_breakeven_pence).not.toBeNull();
    expect(run.metrics.flags.some((f) => f.code === 'breakeven_cap_exhausted')).toBe(false);
  });
  it('structural unsolvability flags senior_breakeven_unsolvable with a reason, not cap-exhausted', () => {
    // sweep 0% with phasing: no price redeems
    const v4 = /* dev-finance deal as above */ migrateInputsToV4({});
    v4.finance.sales_sweep_pct = 0;
    v4.sales_phasing = { tranches: [{ month_offset: 11, pct_of_gross_receipts: 100 }] };
    const run = runAppraisal(v4);
    expect(run.metrics.senior_breakeven_pence).toBeNull();
    const f = run.metrics.flags.find((x) => x.code === 'senior_breakeven_unsolvable');
    expect(f?.message).toMatch(/sales sweep/);
    expect(run.metrics.flags.some((x) => x.code === 'breakeven_cap_exhausted')).toBe(false);
  });
});

describe('breakevenFlags with a structural reason', () => {
  it('emits senior_breakeven_unsolvable with the reason; no cap flag for that solver', () => {
    const out = breakevenFlags(false, false, 2, 'no sale price redeems — test reason');
    expect(out.map((f) => f.code)).toEqual(['senior_breakeven_unsolvable']);
    expect(out[0].message).toBe('no sale price redeems — test reason');
  });
});
```

(Where the test says "dev-finance deal as above", set the same finance/unit values the file's existing fixture-G-style helpers use — enough that `redemption_balance_at_disposal_pence` is non-null.)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/breakeven.test.ts src/lib/model/metrics.test.ts`
Expected: FAIL — solver not exported.

- [ ] **Step 3: Implement the solver** (`breakeven.ts`)

```ts
import type { FacilityTerms } from './finance-types';
import { exitFeeAmount } from './monthly-engine';

/** Phased senior break-even (spec §5.11 phased regime). Freezes the actual run's
 * draw+capitalised-fee schedule, scales tranche receipts by a uniform factor, and
 * replays §4.4's sweep (fee-once, sales_sweep_pct, both arms) with §4's interest
 * recurrence. Excludes any planned refinance (§5.11 is the enforcement question). */
export interface PhasedSeniorBreakevenTerms {
  draws_and_fees_pence: number[];   // per month: draw_pence + capitalised_fees_pence, frozen
  monthly_rate: number;             // annual_interest_rate_pct / 100 / 12
  rolled_up: boolean;
  sales_sweep_pct: number;
  tranches: Array<{ month_offset: number; pct_of_gross_receipts: number }>;
  selling_agent_fee_pct: number;
  selling_legal_fee_pence: number;
  enforcement_cost_assumption_pence: number;
  finance: FacilityTerms;           // exit-fee basis terms
  committed_gross_facility_pence: number;
}

/** Net tranche proceeds at total gross G, split per §4.4.1 (residue absorption,
 * pro-rata costs); enforcement deducted from the first tranche. Keyed by month. */
function phasedNetByMonth(t: PhasedSeniorBreakevenTerms, totalGross: number): Map<number, number> {
  const out = new Map<number, number>();
  if (totalGross <= 0) return out;
  const agentFeeTotal = Math.round((totalGross * t.selling_agent_fee_pct) / 100);
  let grossAllocated = 0, agentAllocated = 0, legalAllocated = 0;
  t.tranches.forEach((tr, i) => {
    const last = i === t.tranches.length - 1;
    const gross = last ? totalGross - grossAllocated
      : Math.round((totalGross * tr.pct_of_gross_receipts) / 100);
    const agent = last ? agentFeeTotal - agentAllocated
      : Math.round((agentFeeTotal * gross) / totalGross);
    const legal = last ? t.selling_legal_fee_pence - legalAllocated
      : Math.round((t.selling_legal_fee_pence * gross) / totalGross);
    grossAllocated += gross; agentAllocated += agent; legalAllocated += legal;
    const enforcement = i === 0 ? t.enforcement_cost_assumption_pence : 0;
    out.set(tr.month_offset, (out.get(tr.month_offset) ?? 0) + gross - agent - legal - enforcement);
  });
  return out;
}

/** Replays the ledger recurrence at total gross G; true iff fully redeemed by term end. */
function phasedReplayRedeems(t: PhasedSeniorBreakevenTerms, totalGross: number): boolean {
  const netByMonth = phasedNetByMonth(t, totalGross);
  let balance = 0, peak = 0, redeemed = false;
  for (let m = 0; m < t.draws_and_fees_pence.length; m++) {
    const dc = t.draws_and_fees_pence[m];
    const interest = t.rolled_up ? Math.round((balance + dc) * t.monthly_rate) : 0;
    balance = balance + dc + interest;
    if (balance > peak) peak = balance;
    const net = netByMonth.get(m) ?? 0;
    if (net > 0 && balance > 0) {
      const sweepAvailable = Math.round((net * t.sales_sweep_pct) / 100);
      const fee = redeemed ? 0
        : exitFeeAmount(t.finance, t.committed_gross_facility_pence, peak, balance);
      if (sweepAvailable >= balance + fee) {
        balance = 0;
        redeemed = true;
      } else {
        let repayment = Math.min(sweepAvailable, balance);
        if (repayment === balance) repayment = Math.max(0, sweepAvailable - fee);
        balance -= repayment;
      }
    }
  }
  return redeemed && balance === 0;
}

export function solveSeniorBreakevenPhased(t: PhasedSeniorBreakevenTerms): number | null {
  if (t.selling_agent_fee_pct >= 100) return null;
  if (t.tranches.length === 0) return null;
  if (t.sales_sweep_pct <= 0) return null;
  const lastTranche = Math.max(...t.tranches.map((x) => x.month_offset));
  for (let m = lastTranche + 1; m < t.draws_and_fees_pence.length; m++) {
    if (t.draws_and_fees_pence[m] > 0) return null;   // structurally unsolvable
  }
  // Generous upper bound: the zero-receipts trajectory's terminal balance + fee is the
  // most that ever needs redeeming (receipts only shrink balances); inflate for costs
  // and the sweep fraction. Bisection is O(log hi) so looseness is cheap.
  let b0 = 0, peak0 = 0;
  for (const dc of t.draws_and_fees_pence) {
    const interest = t.rolled_up ? Math.round((b0 + dc) * t.monthly_rate) : 0;
    b0 = b0 + dc + interest;
    if (b0 > peak0) peak0 = b0;
  }
  if (b0 <= 0) return 0;
  const fee0 = exitFeeAmount(t.finance, t.committed_gross_facility_pence, peak0, b0);
  const needed = b0 + fee0 + t.selling_legal_fee_pence + t.enforcement_cost_assumption_pence;
  const sweepFrac = t.sales_sweep_pct / 100;
  const hi = Math.ceil(needed / (sweepFrac * (1 - t.selling_agent_fee_pct / 100))) + 1000;
  return bisectMinimalFeasible(0, hi, (g) => phasedReplayRedeems(t, g));
}
```

- [ ] **Step 4: Implement the metrics wiring**

`breakevenFlags` gains the optional 4th parameter:

```ts
export function breakevenFlags(
  seniorNull: boolean, developerNull: boolean, agentFeePct: number,
  seniorUnsolvableReason: string | null = null,
): ModelFlag[] {
  const out: ModelFlag[] = [];
  const unsolvable = agentFeePct >= 100;
  if (seniorUnsolvableReason != null) out.push({
    code: 'senior_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
    message: seniorUnsolvableReason,
  });
  if (seniorNull && unsolvable) out.push({ /* existing fee-message flag, unchanged */ });
  // developer + cap-exhausted branches unchanged
```

Senior block: keep the existing static path verbatim for `sales_phasing == null`; add the phased branch:

```ts
  const phasing = 'sales_phasing' in inputs ? inputs.sales_phasing : null;
  let seniorUnsolvableReason: string | null = null;
  if (redemptionBalance != null) {
    if (phasing == null) {
      // …existing lines 104-119 unchanged…
    } else {
      const lastTranche = Math.max(...phasing.tranches.map((x) => x.month_offset));
      if (model.months.some((mm) => mm.month > lastTranche && mm.draw_pence > 0)) {
        seniorUnsolvableReason = 'senior break-even unavailable — facility draws continue after the final sales tranche, so no sale price redeems the facility';
      } else if (inputs.finance.sales_sweep_pct <= 0) {
        seniorUnsolvableReason = 'senior break-even unavailable — sales sweep is 0%, so sale proceeds never repay the facility';
      } else {
        seniorBreakeven = solveSeniorBreakevenPhased({
          draws_and_fees_pence: model.months.map((mm) => mm.draw_pence + mm.capitalised_fees_pence),
          monthly_rate: inputs.finance.annual_interest_rate_pct / 100 / 12,
          rolled_up: inputs.finance.interest_type === 'rolled_up',
          sales_sweep_pct: inputs.finance.sales_sweep_pct,
          tranches: phasing.tranches,
          selling_agent_fee_pct: inputs.exit_strategy.selling_agent_fee_pct,
          selling_legal_fee_pence: inputs.exit_strategy.selling_legal_fee_pence,
          enforcement_cost_assumption_pence: inputs.finance.enforcement_cost_assumption_pence,
          finance: inputs.finance,
          committed_gross_facility_pence: model.committed_gross_facility_pence,
        });
        seniorAttemptedNull = seniorBreakeven == null;
        if (seniorBreakeven != null && lenderGdv != null) {
          seniorBreakevenPctOfLenderGdv = pct(seniorBreakeven, lenderGdv.lender_gdv_pence);
          seniorBreakevenFallFromLenderGdvPct =
            pct(lenderGdv.lender_gdv_pence - seniorBreakeven, lenderGdv.lender_gdv_pence);
        }
      }
    }
  }
```

Line 142 becomes `flags.push(...breakevenFlags(seniorAttemptedNull, developerAttemptedNull, inputs.exit_strategy.selling_agent_fee_pct, seniorUnsolvableReason));`. Re-export `solveSeniorBreakevenPhased` and the terms type from `index.ts`.

- [ ] **Step 5: Run the full frontend suite + typecheck**

Run: `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS — fixture G's pinned static break-even (5,076,649,746p world) untouched.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/model
git commit -m "feat(model): §5.11 phased-regime replay solver with structural-unsolvability reasons (TS)"
```

---

### Task 7: Fixture I — phased sell_all, worksheet + JSON + TS golden test

**Files:**
- Modify: `docs/financial-model/test-cases.md` (new "Fixture I" section after Fixture H, following H's `#### Step N — … (spec §X)` worksheet format)
- Create: `fixtures/financial-model/i-phased-sales.json`
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts` (roster + FLAT_KEYS)

**Interfaces:**
- Consumes: Tasks 3-6.
- Produces: `i-phased-sales.json` (`{ name, kind: "phased-sales", inputs, expected_metrics }`, `inputs_version: 4`); FLAT_KEYS entries `redemption_balance_at_disposal_pence`, `redemption_schedule_months`, `redemption_schedule_balances_pence` (mapping to `model.redemption_balance_at_disposal_pence` and `model.redemption_schedule` field arrays) in the TS mapper — Task 9 mirrors them in Python.

- [ ] **Step 1: Define fixture I inputs**

Copy `fixtures/financial-model/f-dev-finance-12mo.json` and change ONLY:
- `name`: `"I — phased sell_all, three-tranche sweep"`; `kind`: `"phased-sales"`.
- `inputs.inputs_version`: `4`; add `"lender_valuation": null` (already present), `"programme": null, "refinance": null` and:

```json
"sales_phasing": {
  "tranches": [
    { "month_offset": 9,  "pct_of_gross_receipts": 40.0 },
    { "month_offset": 10, "pct_of_gross_receipts": 35.0 },
    { "month_offset": 11, "pct_of_gross_receipts": 25.0 }
  ]
}
```

Everything else stays F's values (12-month term, 8% rolled up, committed gross 66,000,000_00? — no: 66,000,000p… keep F's exact numbers; gross sales 120,000,000p, agent 1.5%, legal 400,000p, exit fee 1% of committed gross = 660,000p, sweep 100%).

- [ ] **Step 2: Hand-derive the worksheet in test-cases.md**

Follow fixture H's format exactly (`#### Step N — … (spec §X)` sub-headings, derivation column, bold pence, residue checks). Structure:

1. **Tranche split (§4.4.1):** gross 120,000,000 → g₉ = 48,000,000, g₁₀ = 42,000,000, g₁₁ = 30,000,000 (residue check Σ = 120,000,000). Agent fee total = round(120,000,000 × 1.5/100) = 1,800,000 → 720,000 / 630,000 / 450,000 (residue). Legal 400,000 → 160,000 / 140,000 / 100,000 (residue). Net per tranche: 47,120,000 / 41,230,000 / 29,450,000.
2. **Ledger months 0–8:** identical to fixture F's worksheet (receipts differ only from month 9) — copy those columns, stating so.
3. **Months 9–11:** derive by hand: month-9 balance pre-receipts (this is redemption_schedule[0]), sweep arm (expect partial or full per the arithmetic — derive, don't assume), post-sweep interest accrual in 10 and 11, fee-once at whichever month reaches full redemption (fee = 660,000, committed_gross basis — static), distributions.
4. **Metrics (§3, §5):** every field F pins, re-derived: finance_costs, TDC, profit, profit_on_cost/gdv, peak debt (unchanged from F if peak precedes month 9 — verify by hand), equity multiple, IRR (follow the IRR derivation convention fixture F/H's worksheets use), net/gross LTC, LTGDV.
5. **§5.11 phased break-even:** fee basis committed_gross → fee static 660,000, so the replay condition is linear in G. Derive the minimal G algebraically (uniform scale, tranche shares 40/35/25, interest re-accrued on replayed balances), then verify feasibility at G and infeasibility at G−1 by evaluating the replay arithmetic at both — record both evaluations in the worksheet.
6. **Pinned expected_metrics** block: all of F's pinned keys with the new values, plus `"senior_breakeven_pence"`, `"developer_breakeven_pence"`, `"redemption_balance_at_disposal_pence"`, `"redemption_schedule_months": [9, 10, 11]`, `"redemption_schedule_balances_pence": […declining…]`, `"funding_gap_pence": 0` (or as derived).

- [ ] **Step 3: Pin the fixture and wire the golden test**

Write `expected_metrics` from the worksheet into `i-phased-sales.json`. Add `'i-phased-sales'` to `EXPECTED_FIXTURE_STEMS` (golden-fixtures.test.ts:36-41). Extend the FLAT_KEYS mapper (lines 50-58) with the three new keys per the Interfaces block. Include one negative control (deliberately-wrong value fails), per fixture H's precedent.

Run: `cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts`
Expected: PASS. Any mismatch → systematic-debugging: locate the divergent month/field, adjudicate worksheet arithmetic vs engine bug at root cause before touching either side. A worksheet correction is a normal outcome; an engine "adjustment to make it pass" is not.

- [ ] **Step 4: Commit**

```bash
git add docs/financial-model/test-cases.md fixtures/financial-model/i-phased-sales.json frontend/src/lib/model/golden-fixtures.test.ts
git commit -m "feat(model): fixture I — phased sell_all golden fixture, hand-derived worksheet"
```

---

### Task 8: Fixture J — blended + refinance, worksheet + JSON + TS golden test

**Files:**
- Modify: `docs/financial-model/test-cases.md` (new "Fixture J" section)
- Create: `fixtures/financial-model/j-blended-refinance.json`
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts` (roster)

**Interfaces:**
- Consumes: Tasks 3-7 (FLAT_KEYS already extended).
- Produces: `j-blended-refinance.json`, `kind: "refinance"`.

- [ ] **Step 1: Define fixture J inputs**

Copy `f-dev-finance-12mo.json` and change ONLY:
- `name`: `"J — blended exit, phased sales + same-month refinance"`; `kind`: `"refinance"`; `inputs_version: 4`; `programme: null`.
- `exit_strategy`: `route: "blended"`, `retained_units: [{ "unit_id": "u4", "monthly_rent_pence": 150000 }]` (u4 retained → sold portion u1-u3, gross 90,000,000; retained value 30,000,000).

```json
"sales_phasing": {
  "tranches": [
    { "month_offset": 9,  "pct_of_gross_receipts": 60.0 },
    { "month_offset": 11, "pct_of_gross_receipts": 40.0 }
  ]
},
"refinance": {
  "month_offset": 11,
  "investment_value_pence": 30000000,
  "ltv_pct": 65.0,
  "arrangement_fee_pence": 300000,
  "legal_costs_pence": 100000
}
```

Net refinance proceeds = round(30,000,000 × 65/100) − 300,000 − 100,000 = **19,100,000p** — worksheet states this first. Month 11 carries BOTH the final tranche and the refinance → pins the §4.5 fixed order (sweep first, then refinance).

- [ ] **Step 2: Hand-derive the worksheet**

Same structure as fixture I's. Key derivation points to record explicitly:
1. Tranche split of 90,000,000 (60/40, residue absorption); agent fee total round(90,000,000 × 1.5/100) = 1,350,000; legal 400,000 apportioned; per-tranche nets.
2. Ledger months 0–8 (same cost schedule as F — copy, stating so; equity/draw waterfall identical).
3. Month 9 sweep; months 10–11 accrual; month 11: sweep FIRST (document each sub-step: pre-receipt balance → redemption_schedule entry; sweep arm outcome; whether the sweep alone redeems), THEN refinance against the post-sweep balance — surplus or shortfall derived by hand; exit fee 660,000 charged exactly once at whichever event completes redemption.
4. Metrics: profit now includes `retained_value 30,000,000` with `profit_is_unrealised: true`; IRR has real flows (tranches + refinance surplus) — derive the vector and pin `irr_annual_pct`; equity multiple; `senior_breakeven_pence` under the phased regime (sold portion only — the replay excludes the refinance per §5.11); `unrealised_value_pence: 30000000`.
5. Pinned `expected_metrics` incl. `redemption_schedule_months: [9, 11]` and the declining balances.

- [ ] **Step 3: Pin, wire, run**

Add `'j-blended-refinance'` to `EXPECTED_FIXTURE_STEMS`. Run: `cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts` → PASS (same adjudication rule as Task 7).

- [ ] **Step 4: Commit**

```bash
git add docs/financial-model/test-cases.md fixtures/financial-model/j-blended-refinance.json frontend/src/lib/model/golden-fixtures.test.ts
git commit -m "feat(model): fixture J — blended + refinance golden fixture, hand-derived worksheet"
```

---

### Task 9: Python mirror — validation, schedule, engine, breakeven, metrics, fixtures I/J

**Files:**
- Modify: `app/financial_model/types.py` (`SalesPhasingTranche`/`SalesPhasingInputs`/`RefinanceInputs` ~lines 300-314: add Pydantic ceilings `month_offset: int = Field(le=1200)`, `tranches: list[SalesPhasingTranche] = Field(max_length=1200)` — backstops only, mirroring the programme fields' rationale at lines 264-281; no lower bounds, validation.py owns UX)
- Modify: `app/financial_model/validation.py` (replace lines 251-256 with the Task 3 rules, ASCII hyphens)
- Modify: `app/financial_model/schedule.py` (mirror Task 4's receipts split + `refinance` on the Schedule dataclass)
- Modify: `app/financial_model/engine.py` (mirror Tasks 4-5: `RedemptionEntry` dataclass or `dict`-shaped entries matching TS `{month, balance_pence}`, `LedgerMonth.refinance_proceeds_pence: int = 0`, `MonthlyModel.redemption_schedule`, fee-once, redraw flag, refinance event; `FlagCode` Literal in types.py gains `facility_redrawn_after_redemption`)
- Modify: `app/financial_model/breakeven.py` (mirror Task 6: `PhasedSeniorBreakevenTerms` dataclass, `_phased_net_by_month`, `_phased_replay_redeems`, `solve_senior_breakeven_phased` — same operation order float-for-float, `money_round` where TS uses `Math.round`)
- Modify: `app/financial_model/metrics.py` (mirror Task 6's `breakeven_flags` 4th param + senior-block phased branch)
- Modify: `app/financial_model/__init__.py` (export additions)
- Test: port every new TS test into the existing counterpart files (`test_financial_model_validation.py`, `test_financial_model_schedule.py`, `test_financial_model_engine.py`, `test_financial_model_breakeven.py`, `test_financial_model_metrics.py`, `test_migrate_v4.py` already done in Task 2); add I and J to `tests/test_financial_model_fixtures.py` (`EXPECTED_FIXTURE_STEMS` line ~27 + `_FLAT_KEYS` lines ~42-56 with the three new keys)

**Interfaces:**
- Consumes: fixtures `i-phased-sales.json`, `j-blended-refinance.json`; the TS implementations as normative reference.
- Produces: `solve_senior_breakeven_phased(t) -> int | None`; full parity.

- [ ] **Step 1: Port validation + types with tests first** — transliterate the Task 3 rules and tests (ASCII `-` in messages); run `python -m pytest -q tests/test_financial_model_validation.py` → PASS.
- [ ] **Step 2: Port schedule + engine with tests first** — mirror Tasks 4-5 line-for-line (the files declare themselves ports — keep that true; same clamp order, same arm structure, `money_round` for every `Math.round`). Port the toy-schedule ledger tests. Run the two files' suites → PASS.
- [ ] **Step 3: Port breakeven + metrics with tests first** — identical operation order in `_phased_replay_redeems` (accrue → peak → sweep; fee via `exit_fee_amount`). Port the solver and metrics tests. → PASS.
- [ ] **Step 4: Golden fixtures I/J + identity in Python** — add both stems and the `_FLAT_KEYS` entries; the existing `test_pre_v4_fixtures_reproduce_their_metrics_after_migration_to_v4` and invariant tests must remain green (identity).
- [ ] **Step 5: Run the full backend suite**

Run: `python -m pytest -q`
Expected: PASS, count > 496.

- [ ] **Step 6: Commit**

```bash
git add app tests
git commit -m "feat(backend): mirror R3b — phased sweep, refinance event, §5.11 phased solver, fixtures I/J"
```

---

### Task 10: Calc 2.3.0 — version bump, invariant matrix, stale-doc sweep

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts:325` (`CALC_VERSION = '2.3.0'`), `app/financial_model/types.py:370` (`CALC_VERSION = "2.3.0"`)
- Modify: `tests/test_appraisal_governance.py` (lines 159, 168, 299: `"2.3.0"`)
- Modify: `frontend/src/lib/model/invariants.test.ts` + `tests/test_financial_model_fixtures.py` `TestInvariantMatrix` (extend symmetrically)
- Modify: `docs/financial-model/model-governance.md` (lines 4, 72, 86 current-version refs), `docs/financial-model/test-cases.md` (line 3 header; **fix the stale §1 lines 40-47** — "v4 fixtures are currently TS-only"/`TEMPORARY` skip note is no longer true since R3a Task 8; **fix §4 counts** at lines ~929/972 — the matrix has run programme variants since R3a and now gains phased/refinance variants)

**Interfaces:**
- Consumes: everything prior.
- Produces: the released calc 2.3.0.

- [ ] **Step 1: Extend the invariant matrix (both engines, symmetric counts)**

Add phased/refinance variants to the existing matrix pattern (fixture-derived variants list). New invariants, each run over fixture I- and J-shaped inputs plus a couple of awkward-pence variants (odd gross totals, 3-tranche splits with pcts like 33.4/33.3/33.3):

1. **Tranche conservation:** Σ receipts.gross = totals.gross_sales; Σ agent fees = round(gross × pct/100); Σ legal = flat legal (exact, residue absorbed).
2. **Sweep conservation:** for every month, `distribution + repayment + exit_fee == net_receipts + refinance_proceeds + (refinance shortfall equity applied that month)` — assert via the ledger identity: `net_receipts_pence + refinance_proceeds_pence + additional_equity_pence(refi part) − repayment − exit_fee − distribution == 0`; simplest robust form: Σ months (net_receipts + refinance_proceeds + additional_equity − distribution − repayment − exit_fee − serviced-interest-equity) reconciles to 0 for rolled-up fixtures (state the chosen identity in a comment and use the same one in both engines).
3. **Interest never accrues on repaid principal:** for every consecutive month pair, `interest_accrued[m+1] == round((closing_balance[m] + draw[m+1] + capitalised_fees[m+1]) × monthly_rate)` for rolled-up runs.
4. **Redemption schedule declines:** balances strictly non-increasing in month order and scalar == last entry.
5. **v3→v4 identity re-run:** unchanged existing test keeps covering the null-block identity.

- [ ] **Step 2: Bump both `CALC_VERSION`s; sweep references**

`grep -rn "2\.2\.0" frontend/src app tests docs/financial-model` — update genuine current-version references only (code constants, the 3 governance-test assertions, spec/governance/test-cases headers, comment-only refs like `validation.test.ts` test names); historical changelog lines and `docs/reviews/*`/`docs/superpowers/plans/*` stay.

- [ ] **Step 3: Run every gate**

Run: `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit && npx eslint . && npm run build`, then from root `python -m pytest -q`.
Expected: all green. Record final counts.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(model): calc 2.3.0 — sweep/refinance invariant matrix, version bump, doc sweep"
```

---

### Task 11: UI — month labels + Programme page

**Files:**
- Create: `frontend/src/lib/programme-months.ts` + `frontend/src/lib/programme-months.test.ts`
- Create: `frontend/src/components/calculator/ProgrammePage.tsx` + `frontend/src/components/calculator/ProgrammePage.test.tsx`
- Modify: `frontend/src/components/ConversionCalculator.tsx` (`CalcPage` lines 20-31, `PAGES` lines 33-45, render chain 213-245)
- Modify: page-heading renumbering — every page after Finance shifts +1: `CashflowPage.tsx` h3 "5."→"6.", `AppraisalSummaryPage.tsx` "6."→"7.", `ScenariosPage.tsx` "7."→"8.", `ExitStrategyPage.tsx` "8."→"9.", `RiskRegisterPage.tsx` "9."→"10.", `DealSpiderPage.tsx` "10."→"11.", `InvestorSummaryPage.tsx` "11."→"12." (grep `<h3` in each; also update the `PAGES` `num` fields)

**Interfaces:**
- Consumes: `CalculatorInputsV4` state (Task 2), `run.schedule.uses` (engine-computed spend — component-local spend math is prohibited).
- Produces: `formatProgrammeMonth(anchorMonth: string | null | undefined, monthIndex: number): string` (`"Month N"` without an anchor; `"Sep 2026"` style with one) — consumed by Tasks 12-13; `ProgrammePage` registered as page 5 (`key: 'programme'`, label `'Programme'`, between Finance and Cashflow).

- [ ] **Step 1: Write the failing tests**

```ts
// programme-months.test.ts
import { describe, expect, it } from 'vitest';
import { formatProgrammeMonth } from './programme-months';

describe('formatProgrammeMonth', () => {
  it('falls back to Month N without an anchor', () => {
    expect(formatProgrammeMonth(null, 0)).toBe('Month 0');
    expect(formatProgrammeMonth(undefined, 11)).toBe('Month 11');
    expect(formatProgrammeMonth('garbage', 3)).toBe('Month 3');
  });
  it('labels calendar months from an ISO yyyy-mm anchor, rolling years', () => {
    expect(formatProgrammeMonth('2026-09', 0)).toBe('Sep 2026');
    expect(formatProgrammeMonth('2026-09', 3)).toBe('Dec 2026');
    expect(formatProgrammeMonth('2026-09', 4)).toBe('Jan 2027');
    expect(formatProgrammeMonth('2026-01', 23)).toBe('Dec 2027');
  });
});
```

`ProgrammePage.test.tsx` (jsdom+RTL, explicit imports — `test.globals` is off; follow `FinancePage.test.tsx` conventions):
- renders the auto-windows explanation when `inputs.programme === null` and a "Set explicit programme" button;
- clicking it calls `onChange` with a programme seeded from the auto windows (construction start 1 / duration `max(1, term−2)` / straight_line; professional+statutory start 1 / duration `ceil(construction/2)` / straight_line);
- with a programme set, editing a duration input calls `onChange` with the updated package; "Revert to auto windows" calls `onChange({ programme: null })`;
- the spend preview table renders one row per month from `run.schedule.uses` (assert a known pence value from a fixture run).

- [ ] **Step 2: Run to verify failure** — `cd frontend && npx vitest run src/lib/programme-months.test.ts src/components/calculator/ProgrammePage.test.tsx` → FAIL (modules missing).

- [ ] **Step 3: Implement `programme-months.ts`**

```ts
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Display-only calendar labels (spec §2.1: anchor_month never enters calculation). */
export function formatProgrammeMonth(
  anchorMonth: string | null | undefined, monthIndex: number,
): string {
  if (!anchorMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(anchorMonth)) return `Month ${monthIndex}`;
  const [y, mo] = anchorMonth.split('-').map(Number);
  const total = (mo - 1) + monthIndex;
  return `${MONTH_NAMES[total % 12]} ${y + Math.floor(total / 12)}`;
}
```

- [ ] **Step 4: Implement `ProgrammePage.tsx`**

Follow the dark-theme styling idiom of the sibling pages (`#0f172a` panels, `#1e3a5f` borders, `#e2e8f0`/`#94a3b8` text). Structure:

```tsx
import { useCallback } from 'react';
import type { CalculatorInputsV4, AppraisalRun, ProgrammeInputs, ProgrammePackage } from '../../lib/model';
import { penceToPounds } from '../../lib/format';
import { formatProgrammeMonth } from '../../lib/programme-months';

interface Props {
  inputs: CalculatorInputsV4;
  onChange: (partial: Partial<CalculatorInputsV4>) => void;
  run: AppraisalRun;
}

const PACKAGES = ['construction', 'professional', 'statutory'] as const;
const CURVE_KINDS = ['straight_line', 's_curve', 'back_loaded', 'user_defined'] as const;

export default function ProgrammePage({ inputs, onChange, run }: Props) {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const programme = inputs.programme;
  const anchor = programme?.anchor_month ?? null;

  const seedFromAuto = useCallback(() => {
    const cw = Math.max(1, term - 2);
    const pw = Math.max(1, Math.ceil(cw / 2));
    const straight = { kind: 'straight_line' as const };
    onChange({ programme: {
      anchor_month: null,
      packages: {
        construction: { start_offset: 1, duration_months: cw, curve: straight },
        professional: { start_offset: 1, duration_months: pw, curve: straight },
        statutory: { start_offset: 1, duration_months: pw, curve: straight },
      },
    } });
  }, [term, onChange]);

  const updatePackage = useCallback((name: typeof PACKAGES[number], partial: Partial<ProgrammePackage>) => {
    if (!programme) return;
    onChange({ programme: { ...programme, packages: {
      ...programme.packages, [name]: { ...programme.packages[name], ...partial },
    } } });
  }, [programme, onChange]);
  // …
}
```

Render: (a) `programme == null` → explanation panel ("Auto windows: straight-line construction over months 1–{term−2}, professional/statutory over the first half — spec §6") + "Set explicit programme" button (disabled with a note when `term < 3` — no window can satisfy the sale-tail rule); (b) programme set → anchor `<input type="month">` writing `anchor_month` (empty → null), per-package rows (start offset + duration `type="number"` inputs, curve `<select>`; `user_defined` reveals a comma-separated weights `<input>` parsed with `.split(',').map(Number)` written only when every entry is finite — leave validation messaging to the engine's `run.validation` issues, which the calculator's existing strip surfaces), "Revert to auto windows" button; (c) spend preview table: header `['Month', 'Construction', 'Professional', 'Statutory', 'Total']`, one row per month from `run.schedule.uses` with `formatProgrammeMonth(anchor, m)` labels — engine output only.

- [ ] **Step 5: Register the page** — `CalcPage` union gains `'programme'`; `PAGES` entry `{ key: 'programme', label: 'Programme', num: 5 }` inserted after finance, subsequent `num`s +1; render branch `{activePage === 'programme' && <ProgrammePage inputs={inputs} onChange={updateInputs} run={run} />}`; update the sibling pages' hard-coded `<h3>` numbers per the Files list.

- [ ] **Step 6: Run the suites** — `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit` → PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(ui): Programme page — package editors, spend preview, anchor-month labels"
```

---

### Task 12: UI — Exit page: sales-tranche editor + refinance block

**Files:**
- Modify: `frontend/src/components/calculator/ExitStrategyPage.tsx`
- Create: `frontend/src/components/calculator/ExitStrategyPage.test.tsx`

**Interfaces:**
- Consumes: `CalculatorInputsV4` props (Task 2), validation surfaced via the calculator's existing issue display (`run.validation`).
- Produces: editors writing `inputs.sales_phasing` / `inputs.refinance`.

- [ ] **Step 1: Write the failing tests** (RTL; follow `FinancePage.test.tsx` conventions — build inputs with `defaultCalculatorInputsV4()`, run through `runAppraisal`, assert `onChange` payloads)

- sell_all: "Phase the sales" toggle visible; refinance section NOT rendered.
- Toggling phasing on calls `onChange({ sales_phasing: { tranches: [{ month_offset: term − 1, pct_of_gross_receipts: 100 }] } })`; off → `{ sales_phasing: null }`.
- With phasing on: "Add tranche" appends a row; editing a pct calls `onChange` with the updated tranche; the running sum indicator shows red styling when ≠ 100.
- retain_all: phasing toggle NOT rendered; refinance toggle visible; enabling it seeds `{ month_offset: term − 1, investment_value_pence: <retainedCapitalValue>, ltv_pct: 65, arrangement_fee_pence: 0, legal_costs_pence: 0 }` (retainedCapitalValue from the component's existing calculation); disabling → `{ refinance: null }`.
- blended: both sections rendered.
- Net-proceeds preview line shows `round(value × ltv/100) − fees` formatted via `penceToPounds` (display-only arithmetic mirroring spec §4.5's input formula — the engine's `Schedule.refinance.net_proceeds_pence` is not reachable from a prop-driven preview before save, so state the formula in a comment referencing §4.5).

- [ ] **Step 2: Run to verify failure** — FAIL (no such UI).

- [ ] **Step 3: Implement**

Extend the existing component (keep every current element and its styling). Additions:

```tsx
const phasing = inputs.sales_phasing;
const refinance = inputs.refinance;
const term = Math.max(1, Math.floor(inputs.finance.term_months));
const pctSum = phasing?.tranches.reduce((a, b) => a + b.pct_of_gross_receipts, 0) ?? 0;

const togglePhasing = () => onChange({
  sales_phasing: phasing ? null
    : { tranches: [{ month_offset: term - 1, pct_of_gross_receipts: 100 }] },
});
const updateTranche = (i: number, partial: Partial<SalesPhasingInputs['tranches'][number]>) => {
  if (!phasing) return;
  const tranches = phasing.tranches.map((t, j) => (j === i ? { ...t, ...partial } : t));
  onChange({ sales_phasing: { tranches } });
};
const addTranche = () => phasing && onChange({ sales_phasing: {
  tranches: [...phasing.tranches, { month_offset: term - 1, pct_of_gross_receipts: 0 }],
} });
const removeTranche = (i: number) => phasing && onChange({ sales_phasing: {
  tranches: phasing.tranches.filter((_, j) => j !== i),
} });

const toggleRefinance = () => onChange({
  refinance: refinance ? null : {
    month_offset: term - 1, investment_value_pence: retainedCapitalValue,
    ltv_pct: 65, arrangement_fee_pence: 0, legal_costs_pence: 0,
  },
});
```

Sections: **Sales phasing** (rendered when `route !== 'retain_all'`): toggle button; per-tranche rows (Month number input 0..term−1, % number input step 0.1, remove ×), Add tranche, sum badge `Σ {pctSum}%` styled `#ef4444` when `Math.abs(pctSum − 100) > 1e-9`. **Refinance** (rendered when `route !== 'sell_all'`): toggle; Month / Investment value £ / LTV % / Arrangement fee £ / Legal costs £ inputs (pound inputs convert `×100`/`÷100` like the existing legal-fee input); net-proceeds preview line.

- [ ] **Step 4: Run suites** — `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calculator
git commit -m "feat(ui): Exit page — sales-tranche editor and refinance block"
```

---

### Task 13: UI — Cashflow labels/columns + investment-memo extensions

**Files:**
- Modify: `frontend/src/components/calculator/CashflowPage.tsx`
- Modify: `frontend/src/lib/export-investment-memo.ts`
- Test: `frontend/src/lib/export-investment-memo.test.ts` (extend)

**Interfaces:**
- Consumes: `formatProgrammeMonth` (Task 11), `model.redemption_schedule`, `LedgerMonth.refinance_proceeds_pence`, `run.inputs` (v4-aware via `'programme' in inputs` guards — the memo must stay polymorphic over `AnyCalculatorInputs`).
- Produces: programme-dated month labels everywhere months are printed; refinance column/rows; declining redemption schedule table; provenance lines.

- [ ] **Step 1: CashflowPage**

- `const programme = 'programme' in run.inputs ? run.inputs.programme : null;` (and same-guard `salesPhasing`, `refinance`); `const anchor = programme?.anchor_month ?? null;`
- Assumption note: keep the current wording verbatim when `programme == null && salesPhasing == null`; otherwise compose from the active blocks, e.g. `Explicit dated programme (spec §6.1)` / `Straight-line spend over months 1–${spendWindow}` + `; sales tranches in months ${…list…}` or `; disposal in month ${term − 1}` + (refinance ? `; refinance in month ${refinance.month_offset}` : '') + `; see calculation specification §4.4–§6.1.`
- Month cells: `formatProgrammeMonth(anchor, m.month)` (both the body column and the KPI tile's `(Month N)` suffix).
- `const hasRefi = model.months.some((m) => m.refinance_proceeds_pence > 0);` — when true, insert a `Refi proceeds` column (header between `Receipts (net)` and `Repayment`; body `penceToPounds(m.refinance_proceeds_pence)`; tfoot sum). Keep header array and cell runs in lockstep — there is no column object model.

- [ ] **Step 2: Investment memo**

All edits inside `generateInvestmentMemo`; resolve once near the top (line ~158, next to the `lenderValuation` guard):

```ts
const programme = 'programme' in run.inputs ? run.inputs.programme : null;
const salesPhasing = 'sales_phasing' in run.inputs ? run.inputs.sales_phasing : null;
const refinance = 'refinance' in run.inputs ? run.inputs.refinance : null;
const anchor = programme?.anchor_month ?? null;
const monthLabel = (m: number) => formatProgrammeMonth(anchor, m);
```

1. **§6 Programme** (line ~711): when `programme != null`, before the narrative add a package table `head: [['Package', 'Start', 'Finish', 'Curve']]` with rows `['Construction', monthLabel(p.start_offset), monthLabel(p.start_offset + p.duration_months − 1), p.curve.kind]` etc.; keep the existing `infoRequired` lines for key dates/critical path only when `programme == null` (an explicit programme IS the dated programme — the anchor-month line replaces the gap marker; when `anchor == null` keep an `infoRequired(y, 'Programme anchor month (calendar dates)')`).
2. **§6 Monthly Cashflow sub-table** (head at line ~741): first column values become `monthLabel(m.month)`; when any `refinance_proceeds_pence > 0` add a `Refi` column mirroring the Cashflow page.
3. **§11 Exit Strategy** (line ~1187): when `salesPhasing != null`, add a tranche table `head: [['Tranche', 'Month', 'Gross', 'Costs', 'Net']]` from `run.schedule.receipts` rows with receipts (label months via `monthLabel`); add a **Redemption schedule** table `head: [['Month', 'Senior balance before receipts']]` from `model.redemption_schedule` (labelled, `penceToPounds`). When `refinance != null`, add a body line: `Refinance (month ${…label…}): investment value ${…}, LTV ${ltv}%, net proceeds ${penceToPounds(schedule.refinance.net_proceeds_pence)} — applied to senior redemption; surplus distributes to equity (spec §4.5).` The contingent-exit `infoRequired` at ~1239-1244 renders only when `refinance == null` for retained routes.
4. **Provenance lines** (next to the lender-valuation provenance at ~590-594, same `bodyText` style): one line each — `Programme: explicit (anchored ${anchor})` / `Programme: auto-derived from term (spec §6)`; `Sales phasing: ${K} tranches (months …)` / `single disposal in final month`; `Refinance: modelled (month …)` / `not modelled`.
5. Watermark/status rules: untouched — every new table must go through the existing `table()` wrapper (it injects the watermark hook).

- [ ] **Step 3: Extend the memo tests** — follow the file's existing convention (build inputs, run the REAL `runAppraisal`, zero recalculation in the memo): fixture-I-shaped inputs → memo Blob generates without throwing and the doc's internal row assertions (whatever mechanism the existing tests use — autotable capture or text scan) include a redemption-schedule table and tranche months; fixture-J-shaped inputs → refinance provenance line present; v2 legacy inputs → memo still generates (polymorphism guard).

- [ ] **Step 4: Run suites** — `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(ui): programme-dated cashflow and memo — tranche, refinance, redemption-schedule rows"
```

---

### Task 14: Full gates + implementation report

**Files:**
- Create: `docs/reviews/2026-08-XX-release-3b-implementation-report.md` (actual date)

- [ ] **Step 1: Run every gate and record counts** — `cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit && npx eslint . && npm run build`; root `python -m pytest -q`. All green, counts recorded.
- [ ] **Step 2: Write the report** following `docs/reviews/2026-08-14-release-3a-implementation-report.md`'s structure: header (branch, commit range, plan/design links, execution-ledger path), "Design §4/§5 → delivery map" table with commit SHAs, gate results, identity-invariant evidence (all pre-R3b fixtures unchanged through the new code paths), fixtures I/J summary with worksheet references, deviations from this plan with rationale, deferred items (R4+ list unchanged; note anything newly discovered).
- [ ] **Step 3: Commit**

```bash
git add docs/reviews
git commit -m "docs: Release 3b implementation report"
```

---

### Task 15: Live browser UAT (post-merge, main session)

**Files:**
- Create: `docs/reviews/2026-08-XX-release-3b-uat.md` + screenshots under `docs/reviews/assets/2026-08-XX-release-3b/`

This task runs in the MAIN session with the Chrome extension after the branch merges — not in a subagent. Design §5.3 makes it a binding R3b gate.

- [ ] **Step 1: Environment** — docker compose up; record ports/DB; **take a DB backup first** and record its filename + byte size in the UAT doc (R2b convention).
- [ ] **Step 2: `/health`** — verify `migrations_current: true`.
- [ ] **Step 3: York row walk-through** — open the real York project; verify v4 hydration (saved appraisal loads with correct finance terms — the Task 2 regression in the live app); author an explicit programme (s_curve construction) on the Programme page and verify the spend preview and cashflow labels; set a 2-tranche phasing and verify the cashflow tranche months + declining redemption schedule; switch to blended + refinance and verify the refinance row and memo sections; generate the investment memo PDF; save, reload, verify round-trip (then restore the York row's original inputs exactly — record before/after states).
- [ ] **Step 4: Record** — numbered `# | Check | Expected | Observed | Verdict` table, screenshots, explicit statement of anything not exercised. Commit.

---

## Self-Review Notes

- **Design coverage:** §4.1 phased sweep → Tasks 1, 4 (+solver 6, fixture 7); §4.2 refinance → Tasks 1, 5 (fixture 8); §4.3 CTC → no code change (reads the ledger — §5.10 retained verbatim; Task 1 doesn't touch it); §5.1 UI → Tasks 11-13; §5.2 fixtures I/J + invariants → Tasks 7, 8, 10; §5.3 gates + UAT → Tasks 10, 14, 15; entry checklist (hydration lift, shim removal, `ScenariosPage`/`deal-spider` widening) → Task 2.
- **Plan-level decisions that sharpen the design's letter** (flag to the reviewer; all consistent with its spirit): (1) tranche-sum tolerance 1e-9 instead of literal float equality — thirds are unrepresentable; pence exactness holds via residue absorption regardless; (2) exit fee charged at FIRST full redemption with a new amber `facility_redrawn_after_redemption` flag for the re-draw edge (the design treats redemption as terminal and is silent on later draws; silence must not be silent in the engine); (3) §5.11 phased replay freezes actual-run draws/fees and excludes the refinance event (documented as modelling assumptions in the spec text); enforcement cost deducted from the first tranche; (4) `sales_phasing` non-null on `retain_all` is a validation error (never silently ignored); (5) structural unsolvability (draws after final tranche / sweep 0%) gets `senior_breakeven_unsolvable` with a reason message, not a misleading cap-exhausted flag.
- **Identity:** null-block paths are byte-identical branches, not re-expressions — schedule receipts branch, sweep arms, static §5.11 path all preserved verbatim; the single-100%-final-month tranche equals the null path exactly (residue absorption degenerates to pass-through), pinned by a test in Task 4.
- **Type consistency check:** `Schedule.refinance.{month, net_proceeds_pence}` (Tasks 4→5), `redemption_schedule: {month, balance_pence}[]` (Tasks 4→7→9→13), `PhasedSeniorBreakevenTerms` field names (Tasks 6→9), `formatProgrammeMonth(anchor, index)` (Tasks 11→13), `defaultCalculatorInputsV4` (Tasks 2→11→12) — names verified consistent across tasks.
- **Known risks:** (a) fixtures I/J worksheets are the heaviest steps — the adjudication rule (root-cause before touching either side) is stated in both tasks; (b) `monthly-engine.test.ts` toy-schedule helpers are described, not copied — the implementer must adapt to that file's local helper names; (c) memo test assertions depend on the file's existing capture mechanism — follow it rather than invent one.
