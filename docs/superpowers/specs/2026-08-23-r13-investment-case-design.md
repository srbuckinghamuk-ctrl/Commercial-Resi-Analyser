# Release 13 — The investment case design

**Date:** 23 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§7.8 (*"Next, add unit-specific completion timing, sales-agent/legal costs by
unit, deposits if relevant, bulk/investment-sale yield and NOI, operating costs,
vacancy, stabilisation, refinance interest coverage/DSCR and refinance fees. A
lender needs evidence that take-out debt can service and repay, not only that a
percentage LTV is below a valuation."*) and §7.9's standard lender buttons
*"refinance yield expansion, lower refinance LTV and operating-cost/vacancy
stress"*. Release-plan row: **R13 — Exit/refinance depth: unit sales, NOI,
DSCR/ICR, constraint binding — P1 — inputs v10, calc minor.**

**Versions:** calc `2.11.0` → `2.12.0`; inputs `v9` → `v10`.
**Specification:** the calculation specification gains **§19**; **§4.5 is
superseded** for the `investment_case != null` case (the explicit
`investment_value_pence × ltv_pct` path is untouched and remains live);
**§12.1** goes from five levers to eight; **§12.2** gains an explicit carve-out;
**§1.6**'s inputs-version list gains v10 *and* the guard that has been missing
since it was written.

---

## 1. The problem this release exists to solve

### 1.1 The take-out is asserted, not derived

Spec §4.5 (R3b, calc 2.3.0) models the refinance of a retained portion:

```
net proceeds = round_half_up(investment_value_pence × ltv_pct / 100)
             − arrangement_fee_pence − legal_costs_pence
```

`investment_value_pence` is *"an explicit input, never yield-derived"*. Nothing
in the model connects it to the scheme's rent, its operating costs, or the
income a take-out lender would actually underwrite against. The user types a
number and the model believes it.

That is precisely the sentence the audit ends §7.8 with. A lender reading the
current output learns that *a* percentage of *an asserted* value is below *an
asserted* LTV cap. It learns nothing about whether the income services the debt,
and nothing about whether the take-out can be drawn at all.

### 1.2 Rent is captured and then thrown away

`ExitStrategyInputs.retained_units[]` has carried `monthly_rent_pence` since R1.
It is edited on `ExitStrategyPage`, persisted, migrated across eight input
versions, and printed in the investment memo — and **no calculation has ever
read it.** A grep for the field across both engines returns the Pydantic field
definition, the editor, the memo table, and two fixtures. It reaches no ledger,
no metric and no result.

So the model has a rent roll and no NOI; an operating asset and no operating
costs; a hold period and no vacancy, no letting-up, no stabilisation. A
`retain_all` scheme books **zero receipts for the whole term** and then reports
a refinance against a value nobody derived.

### 1.3 No coverage test exists anywhere

There is no DSCR, no ICR, and no debt-service concept at all. `FacilityTerms`
describes the *development* facility; the take-out has a value, an LTV and two
fees, and no rate, no term, no amortisation. The model therefore cannot state
whether take-out debt can be serviced — only that a ratio of two asserted
numbers is below another asserted number.

### 1.4 R12 named this release in the specification

Spec §18.6, on exit anchors:

> This is the R12/R13 seam: **R12 ships *when*; R13 ships *how much*.**

R12 shipped the timing and left the economics. It also left two things
explicitly for R13, recorded as §18.10 limitation 9: exit anchors have **no UI
control**, and the two surfaces that name a tranche's month — the investment
memo and the cashflow assumptions note — print the raw `month_offset` rather
than the resolved month the ledger actually used, because `Schedule` publishes
no resolved month for them to read. R13 inherits the control and the reporting
fix together.

---

## 2. Scope: this release takes half of §7.8, deliberately

§7.8 bundles two independent subsystems. R13 takes one:

| §7.8 ask | R13 | Deferred |
|---|---|---|
| bulk/investment-sale yield and NOI | ✅ | |
| operating costs, vacancy, stabilisation | ✅ | |
| refinance interest coverage / DSCR | ✅ | |
| refinance fees | ✅ | |
| unit-specific completion timing | | → unit-level sales ledger release |
| sales-agent/legal costs by unit | | → unit-level sales ledger release |
| deposits if relevant | | → unit-level sales ledger release |

**Why split here.** The two halves share no arithmetic: one is the sold
portion's *receipt timing*, the other is the retained portion's *income and
take-out*. Taking both would open a second live sales path (per-unit alongside
aggregate `sales_phasing`) in the same release that opens a second live
valuation path (yield-derived alongside explicit). One release, one new live
path per axis, is the rule R12 arrived at the hard way.

**This split must be recorded in the release plan.**
`docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`'s R13 row is
edited to name the investment case, and a new row is added for the unit-level
sales ledger. A deferral that lives only in a spec limitation is a note someone
has to remember; a deferral in the release table is scheduled work.

---

## 3. Decisions taken at design time

| # | Decision | Chosen | Rejected, and why |
|---|---|---|---|
| 1 | Take-out derivation | Sized: `min(LTV cap, DSCR cap, ICR cap)`, binding constraint named | Coverage ratios computed but never binding — a dormant engine, R11's shape; or value derived with LTV-only sizing — gains valuation discipline, keeps the sizing naive |
| 2 | The DSCR circularity | **Closed form.** Debt service per £1 of debt is a constant at a known rate and amortisation, so each cap solves directly | Iteration against the redemption requirement — inherits the RLV's "not really solved" disclosure and answers the wrong question; sizing inside the ledger loop — puts calculation in the ledger and makes the result unpublishable |
| 3 | Where `investment_case` lives | **Top level**, beside `programme`, `vat`, `cost_plan` | Nested under `refinance` — a retained scheme earns rent whether or not it refinances; nesting makes operating cash flow conditional on a financing event |
| 4 | Hold-period NOI | Enters the ledger as its **own receipt class**, applied in full to the senior facility | Valuation-only (audit explicitly asks for operating cash flow); or folded into `gross_sale_pence` (would silently move GDV-, LTGDV- and break-even-denominated metrics) |
| 5 | NOI and §3 profit | NOI does **not** enter profit | Adding it — profit is the development residual, `GDV − TDC`; hold income is a separate return stream and belongs in the equity cash-flow vector, where it already lands |
| 6 | Rent source | The existing `retained_units[].monthly_rent_pence` goes live | A scheme-level rent-roll figure — two sources of one fact that can disagree (§15.4) |
| 7 | Operating costs | A **line schedule** with a code enum, each line fixed pence or a percent of effective gross rent | A closed set of named fields — every future operating cost costs an inputs version, and the memo prints a fixed list rather than the scheme's actual cost base |
| 8 | `investment_case = null` | Survives as today's explicit path, bit-identical | Migrating stored documents to a derived case — a derived block on documents that never asked for one |
| 9 | Sizing when no refinance is booked | Still computed and reported, marked **indicative** | Suppressing it — a retain-all scheme's exit route is exactly what a lender wants to see |
| 10 | Cap rounding | **Floor** to pence | §1.1's half-up default — you never round a lender's cap up |
| 11 | Stabilisation resolving past maturity | Hard **error** | A flag — a scheme whose income never starts inside the term books zero NOI silently |
| 12 | Sensitivity levers | Three: `exit_yield`, `operating_cost`, `vacancy` | Deferring all to R16 — ships an engine no scenario can stress (R12's precedent: the lever ships with the engine that defines it) |

---

## 4. §19.1 — The schema

Inputs v10 is **purely additive plus two narrowings**. The additions:

```
investment_case: InvestmentCase | null        -- top level, null = today

InvestmentCase:
  stabilisation:
    anchor:                    PhaseAnchor | null   -- §18.6 resolution, reused
    month_offset:              integer >= 0
    ramp_months:               integer >= 0
    stabilised_occupancy_pct:  number in (0, 100]
  operating_lines: Array<{
    id:     string                     -- unique, non-empty
    code:   OpexCode
    label:  string
    basis:  'fixed_pence_per_month' | 'pct_of_gross_rent'
    value:  number >= 0                -- pence, or percent
  }>                                    -- may be empty
  valuation:
    cap_yield_pct:        number > 0
    purchasers_costs_pct: number >= 0
  takeout:
    ltv_cap_pct:        number in (0, 100]
    dscr_floor:         number > 0
    icr_floor:          number > 0
    annual_rate_pct:    number >= 0
    amortisation_years: number > 0 | null   -- null = interest-only
    term_years:         number > 0
```

`OpexCode` is a ten-value enum: `management`, `letting_and_re_letting`,
`insurance`, `repairs_and_maintenance`, `service_charge_shortfall`,
`ground_rent`, `utilities_on_voids`, `compliance_and_safety`, `bad_debt`,
`other` — the same codes-plus-`other` shape R10 used for cost packages and R12
for phases.

`stabilisation` reuses `PhaseAnchor` verbatim. `anchor: null` means "use
`month_offset`", exactly as §18.6 defines it for tranches, so there is one
month-resolution rule in the model and not two.

### The two narrowings on `refinance`

```
RefinanceInputsV10 extends RefinanceInputsV9:
  investment_value_pence:  number | null      -- was number
  ltv_pct:                 number | null      -- was number
  arrangement_fee_basis:  'fixed_pence' | 'pct_of_quantum'
  arrangement_fee_pct:     number in [0, 100]
```

When `investment_case` is non-null it **supersedes** the explicit value and LTV,
and both must be `null`. This is a validation error, not a silent override:
§2's never-silently-ignored rule makes "we read one and dropped the other" the
prohibited shape. When `investment_case` is null, both must be non-null — which
is today's rule, restated.

All refinance *event* costs stay on `refinance`, where they are today. Only the
arrangement fee's **basis** is new, because a fixed-pence arrangement fee on a
derived quantum is an odd thing to ask a user for. `takeout` is sizing policy;
`refinance` is the event. Migration writes `arrangement_fee_basis:
'fixed_pence'`, `arrangement_fee_pct: 0`, which reproduces today's arithmetic
exactly.

### `takeout` is not nullable

Every non-null `investment_case` carries a `takeout` block, and the sizing is
always computed and reported. When `refinance` is null nothing is booked and the
result is marked `is_booked: false` — an **indicative** exit route, which is
what a lender wants to see on a retain-and-hold case. A nullable block inside a
nullable block buys nothing and doubles the arms to test.

---

## 5. §19.2 — The NOI derivation

Runs **strictly before** the ledger and reads nothing from it. This is §17.5's
one-direction rule, applied to the second engine that could have been made
cyclic.

### The retained set, and the trap in it

Retention is decided by `exit_strategy.route`, and `schedule.ts` already does
it:

```
retain_all → every unit retained
blended    → the units named in retained_units[]
sell_all   → none
```

For `blended`, `retained_units[]` *is* the retained set, so a rent exists for
every retained unit by construction. **For `retain_all` it is not** — every unit
is retained, but only those listed in `retained_units[]` carry a rent, and the
list may be short or empty. A `retain_all` document with three of eight units
listed would produce an NOI understated by five units' rent, silently, and
therefore a value and a take-out understated with it.

So: **`investment_case` non-null with `route = 'retain_all'` requires a
`retained_units` entry for every unit in `unit_mix`** (§19.7). The editor
populates the missing rows; validation refuses the document that lacks them.
Silent understatement of the figure the whole release exists to derive is not a
UX inconvenience to be smoothed over.

### Occupancy

Let `s` = the resolved stabilisation month, `R` = `ramp_months`,
`U` = `stabilised_occupancy_pct`:

```
m < s            →  occupancy = 0
s <= m < s + R   →  occupancy = U × (m − s + 1) / R
m >= s + R       →  occupancy = U
```

`R = 0` collapses the middle arm: occupancy is `U` from month `s`. The ramp is
`R` months long and **reaches `U` in its final month**, `s + R − 1` — stated
because "ramps over R months" has two readings and the other one is off by one.

### The monthly series

```
gross_potential_monthly = Σ over exit_strategy.retained_units[] of monthly_rent_pence
egr[m]  = round_half_up(gross_potential_monthly × occupancy[m] / 100)
opex[m] = 0 for m < s; otherwise Σ over lines of
            fixed_pence_per_month →  value
            pct_of_gross_rent     →  round_half_up(egr[m] × value / 100)
noi[m]  = egr[m] − opex[m]          -- SIGNED

The sum is over `retained_units[]`, not over `unit_mix`. For `blended` that list
**is** the retained set; for `retain_all` rule 2 of §19.7 makes it complete. Those
two facts together are the only reason one expression serves both routes.
```

**A percentage operating line is a percent of that month's *effective* gross
rent, not of potential rent.** A management fee is charged on rent collected.
Stated because the ambiguity is invisible until a fixture with a ramp disagrees
with itself.

**A negative NOI month is an operating shortfall funded by uncommitted
additional equity**, through §4.3's existing mechanics and its existing
`additional_equity_required` red flag. The development facility does not fund
operating losses.

### Stabilised NOI is the stabilised year, not the ramp average

```
egr_stab   = round_half_up(gross_potential_monthly × U / 100)
opex_stab  = Σ lines evaluated at egr_stab
noi_annual = 12 × (egr_stab − opex_stab)
```

Twelve times the *stabilised month*, never the sum of the first twelve actual
months and never an average over the term. Valuation and both coverage ratios
read this figure and only this figure. Capitalising ramp-period NOI is the
classic error in this calculation, and a fixture where the two figures differ
guards it.

If `noi_annual <= 0`: the investment value is 0, all three caps are 0, the
quantum is 0, `binding_constraint` is `null`, and a **red** flag
`investment_case_noi_non_positive` fires. Not an error — the arithmetic is
sound and the finding is the point.

---

## 6. §19.3 — Investment value

The net-initial-yield convention, stated rather than left implicit:

```
gross_value = noi_annual / (cap_yield_pct / 100)
value       = round_half_up(noi_annual × 100 / cap_yield_pct
                            / (1 + purchasers_costs_pct / 100))
```

`gross_value` is published for the report's bridge but is **not** an
intermediate the value is computed from: the value is a single expression with a
**single rounding**, so a two-step derivation cannot drift a penny from the
published one.

---

## 7. §19.4 — Sizing, and which constraint binds

Let `r = annual_rate_pct / 100`.

**The annual debt-service factor per £1 of debt**, `a`:

```
amortisation_years == null  →  a = r                     (interest-only)
otherwise                   →  i = r / 12
                               N = amortisation_years × 12
                               a = 12 × ( i == 0 ? 1 / N
                                                 : i / (1 − (1 + i)^(−N)) )
```

**When `amortisation_years` is null, `a = r`, so the DSCR and ICR caps are equal
by construction whenever the floors are equal.** That is a feature and must be
stated: the two ratios diverge exactly when there is amortisation. Both arms get
a test.

**The three caps**, each floored to integer pence:

| Cap | Formula | Not binding when |
|---|---|---|
| LTV | `floor(value × ltv_cap_pct / 100)` | — |
| DSCR | `floor(noi_annual / (dscr_floor × a))` | `a == 0` (zero rate, interest-only) |
| ICR | `floor(noi_annual / (icr_floor × r))` | `r == 0` |

```
quantum            = min over the applicable caps
binding_constraint = the argmin, precedence LTV → DSCR → ICR on an exact tie
```

**All three caps are published**, not only the binding one. A reader who sees
`LTV 4,200,000 / DSCR 3,610,000 / ICR 4,050,000 — DSCR binds` learns the shape
of the constraint; a reader given only `3,610,000` learns a number.

**Floor, not half-up.** A deliberate departure from §1.1, called out here rather
than left to be discovered as an inconsistency. A cap rounded up is a cap
breached by a penny.

### Achieved ratios, and the self-check they give for free

```
achieved_ltv_pct = value > 0             ? quantum / value × 100        : null
achieved_dscr    = a > 0 && quantum > 0  ? noi_annual / (quantum × a)   : null
achieved_icr     = r > 0 && quantum > 0  ? noi_annual / (quantum × r)   : null
```

Because the caps floor, the binding constraint's achieved ratio is **at least**
its floor and better than it by less than one pence of debt. That is a precise
property, not a tolerance fudge, and it is asserted.

### The refinance event

```
arrangement_fee = fixed_pence    → arrangement_fee_pence
                  pct_of_quantum → round_half_up(quantum × arrangement_fee_pct / 100)
net_proceeds    = quantum − arrangement_fee − legal_costs_pence
```

From there §4.5 is unchanged: negative net proceeds apply as 0 and are funded by
uncommitted additional equity; the sales sweep runs first within the month; the
facility is fully redeemed if it has a balance; the exit fee is charged once
under §4.4.1's once-only rule; a shortfall is absorbed by additional equity and
raises the existing red flag.

A new **amber** flag `takeout_constrained_by_coverage` fires when
`binding_constraint` is `dscr` or `icr` — the lender-relevant finding that
income, not value, is what limits the take-out.

---

## 8. §19.5 — The ledger

### A receipt class of its own

`MonthReceipts` and `LedgerMonth` gain `net_operating_income_pence` (signed).
It is isolated exactly as R11 isolated `vat_reclaim_pence`:

> Deliberately NOT part of `gross_sale_pence`: it is not a sale receipt, so no
> GDV-, LTGDV- or break-even-denominated metric may read it.

The same sentence, for the same reason. NOI is income from an asset, not
realisation of one.

### Order within the month, fixed and stated

```
VAT reclaim  →  NOI  →  sales sweep  →  refinance event
```

All four can fall in one month. The order is arbitrary in the sense that any
order could be defended, and therefore it must be **written down and asserted**
rather than left to the order the code happens to run in.

NOI is applied **in full** to the senior facility, ignoring `sales_sweep_pct` —
which governs *sale* receipts — and any surplus distributes to equity that
month. Where NOI achieves the first full redemption, the exit fee is charged
then, under §4.4.1's existing once-only rule.

A negative NOI month draws uncommitted additional equity, never the facility.
`MonthlyModel.totals` gains `operating_shortfall_equity_pence`, the slice of
`additional_equity_pence` that funded operating losses — mirroring
`refinance_shortfall_equity_pence` exactly.

### §7 sources and uses

Both new flows sit **outside** §7's identity, for the reason `vat_reclaim_pence`
does: §7 balances project *funding* against project *costs*, and hold-period
operating income is neither. `operating_shortfall_equity_pence` is excluded on
the same basis as `refinance_shortfall_equity_pence`, and still counts toward
additional-equity flags, equity contributed and the equity cash-flow vector.

### What this deliberately does not move

**NOI does not enter §3's profit.** Profit stays `GDV − TDC`, the development
residual. NOI reaches the return metrics the honest way — through lower interest
(a real ledger effect) and through `equity_cashflows_pence`, which drives IRR
and the equity multiple.

An implementer reading "operating income" will be tempted to add it to profit.
This paragraph exists to stop that, and a guard asserts `profit_pence` is
unchanged between two documents that differ only in NOI, at equal finance costs.

**One consequence to test rather than discover.** NOI distributions enter
`equity_cashflows_pence`, so a `retain_all` case can now produce an IRR where
`irr_unavailable` used to fire — an IRR that measures the income stream and
ignores the retained asset entirely. `has_realisation_event` stays **false**
(income is not realisation) and §3.16.1's unrealised labelling is unchanged, so
the guard rails hold. It gets its own test.

---

## 9. §19.6 — Outputs and reporting

### The result block

```
InvestmentCaseResult:
  stabilisation_month: integer
  months: Array<{ month, occupancy_pct, gross_potential_rent_pence,
                  effective_gross_rent_pence, operating_cost_pence, noi_pence }>
  stabilised: { effective_gross_rent_pence, operating_cost_pence,
                monthly_noi_pence, annual_noi_pence }
  operating_lines: Array<{ id, code, label, basis, value,
                           stabilised_monthly_pence }>
  valuation: { cap_yield_pct, purchasers_costs_pct,
               gross_value_pence, investment_value_pence }
  takeout: { ltv_cap_pence,
             dscr_cap_pence: integer | null,
             icr_cap_pence:  integer | null,
             quantum_pence,
             binding_constraint: 'ltv' | 'dscr' | 'icr' | null,
             annual_debt_service_factor,
             achieved_ltv_pct: number | null,
             achieved_dscr:    number | null,
             achieved_icr:     number | null,
             is_booked: boolean }
  totals: { effective_gross_rent_pence, operating_cost_pence, noi_pence }
```

`Schedule` gains `investment_case: InvestmentCaseResult | null` — **republished,
never recomputed**, the treatment §17.12 gave `vat`. `AppraisalResultV2`
republishes the same object. The UI and the report read it and never call the
engine.

`null` on the `investment_case = null` path, exactly as the input is. No block is
synthesised for a document that never asked for one (§18.10 limitation 1's
reasoning, unchanged).

### R12's carried reporting defect

`Schedule` gains:

```
resolved_exit_months: { tranches: number[]; refinance: number | null }
```

This is the field §18.10 limitation 9 named as missing.
`export-investment-memo.ts` and `CashflowPage.tsx` read it in place of the raw
`month_offset` they print today.

**This needs a test that fails against current `main` before the fix lands** — an
anchored tranche on a slipped programme, where the printed month and the ledger
month disagree. A carried defect fixed without a failing assertion behind it is
a claim.

### Screens

- **`ExitStrategyPage`** gains the anchor controls R12 never shipped (tranches
  and refinance), plus the investment case. Split into child components —
  `OperatingScheduleEditor.tsx`, `InvestmentCaseCard.tsx` — so no single file
  absorbs the whole release. For `retain_all`, the page populates a
  `retained_units` row for every unit, which is what makes §19.7's completeness
  rule a non-event in the UI.
- **`CashflowPage`** gains the NOI row and reads `resolved_exit_months`.
- **The investment memo** gains an investment-case section: the rent roll, the
  NOI bridge (potential → effective → less operating lines → NOI), the value
  with the yield and purchaser's costs stated, **all three candidate quanta with
  the binding one named**, the achieved ratios, and any residual balance the
  take-out fails to clear. Where the case is indicative (`is_booked: false`) the
  section says so.

---

## 10. §19.7 — Validation

Input errors, not flags. Applying only when `investment_case` is non-null unless
stated:

1. `route = 'sell_all'` with a non-null `investment_case` — nothing is retained.
2. `route = 'retain_all'` requires a `retained_units` entry for **every** unit in
   `unit_mix` (§19.2's silent-understatement trap).
3. Every `retained_units[].unit_id` names a unit that exists.
4. Total gross potential rent > 0.
5. When `refinance` is non-null: `investment_value_pence` and `ltv_pct` must
   both be `null`. **And, when `investment_case` is null and `refinance` is
   non-null, both must be non-null** — today's rule, restated as the other arm.
   A null `refinance` alongside a non-null `investment_case` is legal and is the
   indicative case of §19.1.
6. `stabilisation.anchor` names a phase that exists, and requires `programme`
   non-null (§18.8's rule, reused).
7. The resolved stabilisation month lies in `[0, term_months − 1]`. Otherwise
   `investment_case.stabilisation_after_maturity` — a hard error, on §18.8's
   reasoning: income that never starts inside the term books zero NOI silently.
8. `stabilised_occupancy_pct` finite, in `(0, 100]`; `ramp_months` a whole
   number >= 0.
9. `cap_yield_pct` finite > 0; `purchasers_costs_pct` finite >= 0.
10. `takeout`: `ltv_cap_pct` in `(0, 100]`; `dscr_floor` > 0; `icr_floor` > 0;
    `annual_rate_pct` finite >= 0; `amortisation_years` null or > 0;
    `term_years` > 0.
11. `operating_lines`: ids unique and non-empty; `code` in the enum; `basis` in
    the enum; `value` finite >= 0; and <= 100 on the `pct_of_gross_rent` basis.
    An empty array is legal — NOI is then gross rent.
12. `refinance.arrangement_fee_basis` in the enum; `arrangement_fee_pct` finite
    in `[0, 100]`. Applies whenever `refinance` is non-null, whether or not
    `investment_case` is.

**Flags** (not errors):

| Code | Severity | Fires when |
|---|---|---|
| `investment_case_noi_non_positive` | red | stabilised annual NOI <= 0 |
| `stabilisation_incomplete_at_maturity` | amber | `s + ramp_months > term_months` — the value capitalises a stabilisation the term never reaches |
| `takeout_constrained_by_coverage` | amber | `binding_constraint` is `dscr` or `icr` |

A ramp running past maturity is **not** an error: refinancing mid-lease-up is a
real structure. It is flagged because the valuation reads the stabilised figure
regardless, and that gap should be visible rather than inferred.

---

## 11. §19.8 — Sensitivity: three levers, and a §12.2 amendment

§12.1's table goes from five rows to eight. The three new rows:

| Lever | Unit | Effect on the inputs document |
|---|---|---|
| `exit_yield` | percentage points | adds to `investment_case.valuation.cap_yield_pct` |
| `operating_cost` | percent | scales every `investment_case.operating_lines[].value` |
| `vacancy` | percentage points | **subtracts** from `investment_case.stabilisation.stabilised_occupancy_pct` |

All three write fields no other lever touches, so §12.1's order-independence
property holds unchanged and the existing all-levers-in-several-orders test
gains three entries. None carries a target, so their duplicate checks key on
`lever` alone — unlike `phase_slip`, which keys on `(lever, phase_id)`.

On a document with `investment_case = null` all three are **no-ops by
construction**, exactly as `phase_slip` is on a null programme. A zero-width
tornado bar is the honest report of a lever with nothing to move.

### Cell validity (§12.7), not clamping

| Degenerate cell | Rule |
|---|---|
| `cap_yield_pct <= 0` | invalid cell |
| `stabilised_occupancy_pct <= 0` | invalid cell |
| an operating line's `value < 0` (a lever below −100%) | invalid cell |

§12.7's mechanism already exists and already renders these; nothing is clamped
into validity.

### The §12.2 amendment, which is the part that would otherwise bite

§12.2 says the facility is invariant, and names
`committed_net_facility_pence`, `committed_gross_facility_pence`,
`day_one_advance_pence` and `equity_sources`. Read carelessly against this
release it says the take-out must be held at its base value too — which would
make all three new levers inert, and would be the exact silent-downgrade shape
R12 spent a release avoiding.

§12.2 gains an explicit paragraph: **the take-out is not the committed facility.
It is re-solved in every cell, deliberately.** §11.8's prohibition is about not
re-underwriting the *development* debt to rescue an adverse cell. A yield lever
that expanded the yield and left the take-out unchanged would measure nothing.

---

## 12. §19.9 — Migration and the persistence boundary

```
v9 investment_case: (absent)   →  v10 null
v9 refinance: null             →  v10 null
v9 refinance: non-null         →  v10 same, plus
                                    arrangement_fee_basis: 'fixed_pence'
                                    arrangement_fee_pct:    0
                                  (investment_value_pence and ltv_pct unchanged
                                   and still non-null — the explicit path)
```

**No existing appraisal's computed values move.** The migration gate is numeric
**and** validation-side, and the validation side is **three separately
falsifiable properties, not one set equality** — R12's §18.7 correction, applied
from the start this time:

1. Every issue a v9 document raises has a v10 counterpart under a stated alias
   map.
2. The v10-only rules of §19.7 raise no issue on a migrated document. (Which of
   the twelve are genuinely v10-only is settled when they are written — rule 3
   and the second arm of rule 5 may already exist under another name. The
   property is over the new rules, not over a count.)
3. A control document that *does* trip a v10-only rule raises it — proving the
   new rules can fire at all, so property 2 is not vacuously true.

Both engines run the numeric gate corpus-wide.

---

## 13. §19.10 — Stated limitations

Recorded so they are not read as oversights.

1. **No unit-level sale timing or per-unit selling costs**, and no deposits — the
   deferred half of §7.8, scheduled as its own release (§2).
2. **Rent is flat in nominal terms** over the hold. No review pattern, no
   indexation, no stepped rent.
3. **Occupancy is scheme-level.** There are no per-unit voids or per-unit letting
   dates; the ramp applies uniformly to the retained rent roll.
4. **Purchaser's costs are one percentage**, not an itemised build of acquisition
   tax, agency and legal.
5. **The take-out is sized, not underwritten.** No covenant testing over the
   take-out's life, no cash sweep in the take-out, no rate hedging, no interest
   holiday.
6. **The valuation capitalises the stabilised year**; it does not discount the
   ramp. A DCF of the hold period is a different instrument.
7. **DSCR and ICR are equal by construction** on an interest-only take-out
   (§19.4).
8. **NOI does not enter §3 profit** (§19.5). It reaches returns through interest
   and the equity cash-flow vector only.
9. **Operating lines carry no source, date or status.** The evidence model is
   R15's, on the same reasoning §14.6, §15.9 and §16.9 already record.

---

## 14. Guards this release must watch fail

Per the standing rule that every guard be planted against and watched failing
before it is trusted.

| Guard | Watched by |
|---|---|
| **Rent liveness** | Changing one retained unit's `monthly_rent_pence` changes NOI, investment value, the quantum, total interest and the closing balance — on **absolute** figures. This is the defect the release exists to fix: the input was inert for eight input versions |
| **Binding-constraint liveness** | Three fixtures engineered so a different constraint binds in each; assert the named constraint **and** that the quantum equals that cap to the pence |
| **DSCR/ICR divergence** | Two documents differing only in `amortisation_years`: null gives equal ratios, non-null gives divergent ones |
| **Stabilised ≠ ramp average** | A fixture where 12 × the stabilised month and the sum of the first twelve months differ; the value must follow the former |
| **NOI isolation** | Two documents with identical sale receipts, one with NOI and one without: `gdv_pence`, `ltgdv_developer_pct`, `ltgdv_lender_pct`, `senior_breakeven_pence` and `profit_on_gdv_pct` are **identical** |
| **NOI does not enter profit** | `profit_pence` unchanged between the same two documents once finance costs are held equal |
| **Sweep liveness** | NOI reduces peak debt, terminal balance and total interest — on **absolute** month numbers and figures, not directions |
| **Within-month order** | A month carrying VAT reclaim, NOI, a sale tranche and the refinance event together reproduces a hand-derived closing balance |
| **Negative NOI** | An opex-heavy fixture draws additional equity, never a facility draw; `operating_shortfall_equity_pence` matches and §7 still reconciles |
| **Null-path identity** | `investment_case = null` is bit-identical to calc 2.11.0 corpus-wide, in both engines |
| **Migration identity, both axes** | The numeric gate plus the three validation properties of §19.9 |
| **Resolved exit month (R12 carry)** | An anchored tranche on a slipped programme: memo and cashflow print the **resolved** month. Must fail against current `main` first |
| **Retain-all rent completeness** | A `retain_all` document missing a `retained_units` row is rejected; its complete twin, differing by one row, is accepted and has a higher NOI |
| **Stabilisation-after-maturity** | Errors; its in-term twin, differing by one month, does not |
| **Lever order-independence** | All **eight** levers applied in several orders give identical results |
| **Lever inertness on the null path** | The three new levers on an `investment_case = null` document produce a zero-width tornado bar, not an error and not a silent value change |
| **Cell validity** | Yield and occupancy driven to zero produce **invalid cells**, not clamped ones |
| **§1.6 version list** | A test reads the specification's inputs-version list and requires v10 — the guard missed twice running |

**Guards deliberately not written**, because they would be vacuous by
construction: any assertion that an `OpexCode` is in the enum (the type
guarantees it); any assertion that `noi = egr − opex` (true by construction of
the implementation's own subtraction); any assertion that the quantum is <= the
minimum cap (that is the definition of `min`).

---

## 15. Also in scope

- **The §1.6 inputs-version list gains v10 and a test that reads it.** It has
  been missed twice running — R11 forgot v8, caught during R12 — and no test has
  ever read it.
- **The release-plan split is recorded** in
  `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` (§2).
- **§18.10 limitation 9 is closed** and rewritten to say so.
- **The calculation specification** gains §19; §4.5, §12.1, §12.2 and §1.6 are
  edited; migration notes gain v9 → v10.

## 16. Out of scope

- Unit-level sale timing, per-unit selling costs, deposits — the deferred half of
  §7.8, its own release.
- C1 (§5.10's rolled-up interest against the net facility) and `lender_eligible`
  — R14, unchanged.
- PDF/UA tagging, raster visual regression, the jsPDF Symbol-font warning — R7
  carries, unchanged.
- An evidence/provenance model for operating lines — R15.

## 17. Shape of the work

Roughly eighteen tasks, in four bands:

1. **Schema and migration** — v10 types in both engines, the two narrowings,
   migration, the numeric and three-property validation gates.
2. **The engine** — `investment-case.ts` / `investment_case.py`: occupancy, the
   monthly series, stabilised NOI, valuation, the three caps and the binding
   constraint. Mirrored, hand-derived fixtures on both sides.
3. **The ledger and the metrics** — the receipt class, the within-month order,
   the negative-NOI arm, §7 exclusions, the isolation guards, the result block
   republished through `Schedule` and `AppraisalResultV2`.
4. **Surfaces and the carried work** — `resolved_exit_months` (failing test
   first), the anchor controls, the operating and take-out editors, the cashflow
   row, the memo section, the three levers, cell validity, the spec edits.

The entry-point cutover to v10 is its own task, at the end, on R12's finding:
the cutover is what finds the boundary bug, and a release that leaves the server
writing v9 ships inert.
