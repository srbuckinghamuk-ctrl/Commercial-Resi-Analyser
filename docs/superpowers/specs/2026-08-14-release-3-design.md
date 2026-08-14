# Release 3 design — dated programme core

Date: 2026-08-14. Status: approved in brainstorming session; supersedes nothing —
extends `docs/financial-model/calculation-specification.md` (calc 2.1.0) per the
governance rules in `docs/financial-model/model-governance.md`.

## 1. Scope and versioning

Release 3 delivers the dated programme and everything that depends on it, as two
mergeable sub-releases mirroring the R2 rhythm:

- **R3a — programme engine (calc 2.2.0).** Inputs v4, programme model, spend curves
  (`s_curve`, `back_loaded`, `user_defined`), flags-on-result refactor. Exit behaviour
  unchanged. Hard invariant: migrated v3 inputs reproduce calc-2.1.0 outputs
  **identically** across the entire existing fixture corpus (this is why the bump is
  minor, not 3.0.0 — no existing result changes).
- **R3b — exits + UI (calc 2.3.0).** Phased-sales sweep, refinance proceeds for
  retained exits, cost-to-complete re-derived on the programme ledger, full UI +
  investment-memo work, live browser UAT.

Explicitly deferred to R4+: fixed-facility sensitivity suite, pari-passu draw rule,
VAT modelling, developer/lender mode split, exit-fee band holdback refinement, equity
`timing_month` enforcement, parking/external-space valuation, unit-level sales
tranches and lender release pricing, residual-price fixed-point refinement (spec
§ "cost excluding land" limitation).

## 2. Inputs v4 and migration

`CalculatorInputsV4` adds three top-level blocks to v3:

### 2.1 `programme`

```
programme: {
  anchor_month: string | null   // ISO yyyy-mm; display-only — converts month
                                // indices to calendar labels; never enters calculation
  packages: {
    construction:  { start_offset: number, duration_months: number, curve: Curve },
    professional:  { start_offset: number, duration_months: number, curve: Curve },
    statutory:     { start_offset: number, duration_months: number, curve: Curve },
  }
}
Curve = { kind: 'straight_line' | 's_curve' | 'back_loaded' }
      | { kind: 'user_defined', weights: number[] }   // length = duration_months
```

Acquisition remains at month 0 (not a package). The engine stays month-indexed and
date-free; `anchor_month` affects display and reports only.

### 2.2 `sales_phasing`

```
sales_phasing: { tranches: { month_offset: number, pct_of_gross_receipts: number }[] } | null
```

Tranche percentages are floats (`70.0` = 70%, existing convention) and must sum to
100.0 exactly. Tranches apply to the **sold portion** of the exit (all receipts for
`sell_all`; the sold units' receipts for `blended`). Selling costs are apportioned
pro-rata by tranche gross. `null` (and the migration default) = a single 100% tranche
in the final month of the term — exactly today's behaviour.

### 2.3 `refinance`

```
refinance: {
  month_offset: number,
  investment_value_pence: number,   // explicit input, not yield-derived
  ltv_pct: number,
  arrangement_fee_pence: number,
  legal_costs_pence: number,
} | null
```

Only meaningful for `retain_all` and the retained portion of `blended`; validation
rejects a non-null block on `sell_all`.

### 2.4 Migration

Chain extends v1→v2→v3→**v4**. v4 defaults must reproduce the calc-2.1.0 §6
straight-line windows exactly: construction = `straight_line` over months
1..N−2, professional and statutory = `straight_line` over the first half of that
window, `sales_phasing = null`, `refinance = null`. Migration fixtures pin this.

## 3. R3a engine

### 3.1 Programme-driven schedule

The schedule builder consumes `programme` instead of the hard-coded §6 windows. Each
package spreads its total over `[start_offset, start_offset + duration_months)` by its
curve:

- `straight_line`: equal monthly weights (existing behaviour).
- `s_curve`: raised-cosine cumulative weights. For a window of `D` months, cumulative
  fraction after month `k` (k = 1..D) is `W(k) = (1 − cos(π·k/D)) / 2`; month k's
  weight is `W(k) − W(k−1)`. This exact closed form goes into the calculation spec so
  both engines agree digit-for-digit.
- `back_loaded`: linear ramp — month k (k = 1..D, 1-indexed within the window) has
  weight ∝ k, i.e. `2k / (D(D+1))` of the package total.
- `user_defined`: explicit per-month weights; must have length = `duration_months`,
  every weight ≥ 0, sum > 0; weights are normalised to the package total.

All curves use the existing rounding invariant: each month rounds half-up; the final
month of the window absorbs the cumulative residue so the spread sums exactly to the
package total.

Validation (input errors, not flags): every window must fit inside the term with the
existing ≥-2-month tail rule preserved; `duration_months ≥ 1`.

### 3.2 Flags-on-result refactor

`deriveMetrics` stops mutating `model.flags` by reference. Flags become part of the
returned result object; both engines become pure (same inputs → same result object,
no aliasing). Adds the cap-exhaustion flag for the theoretically-unreachable >2²⁰⁰
bisection range (deferred from R2b final review).

### 3.3 R3a proof obligations

1. **Identity:** migrated v3 inputs reproduce calc-2.1.0 outputs identically across
   ALL existing fixtures (ledger fixtures B–G, golden fixtures, migration fixtures).
2. **Fixture H:** new hand-derived fixture (s_curve construction + shifted
   professional/statutory windows), worked on paper in
   `docs/financial-model/test-cases.md`, pinned in both engines.
3. Python–TS invariant-matrix parity extended to the new curves.

R3a merge gate: all five gates green (frontend vitest, tsc, eslint, build; backend
pytest).

## 4. R3b exit waterfall and metrics

### 4.1 Phased-sales sweep

Per tranche, in its receipt month (end-of-month step, spec §"monthly loop" order):

1. Tranche gross = `pct_of_gross_receipts` × gross receipts of the sold portion.
2. Per-tranche selling costs deducted (pro-rata apportionment).
3. Net proceeds mandatorily repay the senior facility: accrued interest first, then
   principal. Interest thereafter accrues only on the post-sweep balance.
4. Once the facility is fully redeemed (including exit fee, below), residual proceeds
   distribute to equity.

Exit fee is charged once, at final redemption, on its §-defined basis:
`redemption_balance` basis = the balance at final redemption;
`committed_gross_facility` and `peak_debt` bases unchanged.

`redemption_balance_at_disposal_pence` becomes a declining per-tranche schedule —
this resolves the staged-disposal semantics question deferred from R2b. §5.11 senior
repayment break-even is re-stated against that schedule under a uniform price-fall
assumption across tranches (documented in the spec as the modelling assumption).

### 4.2 Refinance (retained exits)

At `refinance.month_offset`, for `retain_all` (or the retained portion of `blended`):

- Refinance proceeds = `ltv_pct × investment_value_pence − arrangement_fee_pence −
  legal_costs_pence`.
- Proceeds redeem the outstanding senior balance (accrued interest, then principal,
  then exit fee per its basis).
- Surplus proceeds distribute to equity. Shortfall is absorbed by uncommitted
  additional equity per the existing §4.3 mechanics and raises a red flag.
- The spec's "repayment source (refinance) not yet modelled" red flag for retained
  exits is replaced by the modelled event; it remains for retained exits with
  `refinance = null`.
- If a sales tranche and the refinance fall in the same month (`blended`), sale
  proceeds sweep first, then refinance proceeds — a fixed, spec-stated order.

§5.7 IRR gains a real terminal flow for retained exits (the refinance surplus), with
the existing "unrealised — subject to refinance/valuation" labelling retained for the
valuation-based components.

### 4.3 Cost-to-complete

§5.10's formula is unchanged — it reads the ledger, which now carries the programme —
so cost-to-complete is automatically re-derived on the dated programme. The §5.10
known limitation (static snapshot, not a re-simulation) is retained verbatim.

## 5. UI, reports, testing, gates

### 5.1 UI

- New **Programme** page in the calculator: per-package offset/duration/curve editors
  with a per-month spend preview table; anchor-month picker showing derived calendar
  dates.
- **Exit** page gains the sales-tranche editor and the refinance block (enabled only
  for `retain_all`/`blended`).
- Cash-flow page and investment memo show programme-dated columns (calendar labels
  when `anchor_month` is set, "Month N" otherwise), tranche receipts, sweep
  repayments, the refinance event row, and the declining redemption schedule.
- Reports keep the existing watermark/status rules; memo provenance lines extended to
  the new blocks.

### 5.2 Testing and governance

- Governance unchanged: every number hand-derived on worksheets in
  `docs/financial-model/test-cases.md` **before** implementation; spec + fixtures +
  both engines updated in one change.
- New hand-derived fixtures: **H** (R3a: s_curve + shifted windows), **I** (phased
  `sell_all`, multi-tranche sweep), **J** (`blended` + refinance).
- Invariant matrix extended: sweep conservation (Σ tranche net proceeds = Σ senior
  repayments + equity distributions), interest never accrues on repaid principal,
  curve spreads sum exactly to package totals, v3→v4 migration identity.
- Migration fixture ports to the Python suite as in R2b.

### 5.3 Gates and UAT

Per merge (R3a and R3b): frontend vitest + tsc (`npx tsc -p tsconfig.app.json
--noEmit`) + eslint + build; backend pytest. R3b additionally: live browser UAT on
the real York row with a dated review doc + screenshots under `docs/reviews/`, and
`/health` `migrations_current` verified after the v4 migration.

Operational rules carried forward: subagents must be told explicitly never to use
`git stash`; frontend deps via `npm install --legacy-peer-deps`.
