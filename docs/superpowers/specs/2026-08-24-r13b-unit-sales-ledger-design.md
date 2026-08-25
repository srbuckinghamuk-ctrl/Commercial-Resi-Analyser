# Release 13b — The unit-level sales ledger design

**Date:** 24 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§7.8 (*"Next, add unit-specific completion timing, sales-agent/legal costs by
unit, deposits if relevant, …"*) — the half of §7.8 that R13 deliberately
deferred (R13 design §2; spec §19.10 limitation 1). Release-plan row: **R13b —
Unit-level sales ledger: per-unit completion timing, per-unit selling costs,
deposits — P1 — inputs v12, calc minor.**

**Versions:** calc `2.13.0` → `2.14.0`; inputs `v11` → `v12`.
**Specification:** the calculation specification gains **§22**; **§3.7** gains
the per-unit regime's cost rule; **§4.4** gains a third receipt regime; **§5.11**
is **amended** (a second solver arm, and a correction to the tranche arm — the
resolved month, §8 below); **§5.12** gains the per-unit path's cost basis;
**§12.1** goes from eight levers to nine; **§12.6** names `sales_slip` in the
whole-month rule; **§13.4** gains one sentence on released deposits; **§19.10**
limitation 1 becomes a historical note; **§1.6**'s inputs-version list gains
v12.

---

## 1. The problem this release exists to solve

### 1.1 Sales are one number and one curve

Spec §4.4.1 (R3b) phases the sold portion's receipts as K tranches of
`{ month, pct_of_gross_receipts }`. Every unit's value enters one total `G`;
the tranches split `G`; selling costs are one scheme-level agent percentage and
one flat legal fee apportioned pro-rata. The model has no idea *which* unit
completes when, cannot carry a unit whose agent charges a different rate or
whose conveyancing costs a fixed sum, and has no concept of exchange as
distinct from completion.

### 1.2 Deposits do not exist

A UK residential scheme exchanges contracts with a deposit — typically 10% —
weeks or months before completion. Whether the developer may draw that deposit
(released) or it sits with the stakeholder until completion (held) is a
contractual fact that changes peak debt, interest and the sweep. The model can
express neither. And the figure a lender asks about first — *what proportion of
the scheme is exchanged before practical completion?* — has no home, because
nothing records an exchange.

### 1.3 §5.11 replays the wrong month

Found at design time, and in scope (§8): the phased senior break-even reads
each tranche's **raw** `month_offset` (`metrics.py`, `breakeven.py`, and their
TS twins), not the anchor-resolved month the ledger uses. R13 closed §18.10
limitation 9 for the two surfaces that *print* a tranche month; the replay was
not one of them. Fixture S's tranches are anchored to `unit_completions` (+0,
+3) and resolve to months 16 and 19; the replay places them at 20 and 21. A
reported lender metric is computed against a disposal that does not happen.

### 1.4 R13 named this release

R13 design §2: *"Taking both would open a second live sales path (per-unit
alongside aggregate `sales_phasing`) in the same release that opens a second
live valuation path. One release, one new live path per axis."* This is that
second sales path, in its own release, as scheduled.

---

## 2. Scope

| §7.8 ask | R13 | R13b |
|---|---|---|
| bulk/investment-sale yield and NOI; operating costs, vacancy, stabilisation; DSCR/ICR; refinance fees | ✅ | |
| unit-specific completion timing | | ✅ |
| sales-agent/legal costs by unit | | ✅ |
| deposits if relevant | | ✅ (at exchange; held or released) |

Plus the §5.11 resolved-month correction (§1.3), because this release rebuilds
exactly the seam it lives in, and a pre-sales coverage figure, because the
exchange dates that deposits require are also the evidence a lender asks for.

---

## 3. Decisions taken at design time

| # | Decision | Chosen | Rejected, and why |
|---|---|---|---|
| 1 | Relationship to `sales_phasing` | **Mutually exclusive** nullable top-level blocks; both non-null is a validation error (§16.1's shape); both null = today's final-month single disposal | Per-unit supersedes aggregate — a silently ignored block breaks §2's "never silently ignored"; replacing `sales_phasing` outright — re-prices every stored phased document through a lossy unit allocation |
| 2 | Where the rows live | A new top-level `unit_sales` block | Per-unit `sale` sub-block on `unit_mix.units[]` — no top-level null to mean "not this path", no home for the scheme-level deposit switch, and `unit_mix` is shared by `retain_all`; `unit_ids[]` on tranches — one block carrying two mechanisms for one fact (R10's seam defect) |
| 3 | Deposit cash treatment | A scheme-level `deposit_release` switch: `held_to_completion` (no cash movement; UK stakeholder norm) or `released_on_exchange` (a receipt at exchange that sweeps under §4.4) | Always held — cannot model a developer contractually entitled to draw deposits; always released — the optimistic case lenders do not credit |
| 4 | Row coverage | **Every sold unit has exactly one row** and every row names a sold unit; hard errors both ways | Optional rows defaulting to the final month — a forgotten unit silently gets the R1 assumption |
| 5 | Per-unit costs | **Nullable overrides** `agent_fee_pct` / `legal_fee_pence`; null falls back to the scheme figure (legal: apportioned across the null-legal units) | Required per-unit values with scheme fields ignored — silently ignored inputs; scheme-only — drops the audit's ask |
| 6 | Timing shape | `SaleEvent = { month_offset, anchor }`, §18.6's pair verbatim, resolved by the single resolver | A third timing mechanism — two resolvers can disagree |
| 7 | Deposit basis | A **percentage** of the unit's gross | Pence — would not scale with the `gdv` lever or §5.11's uniform price fall |
| 8 | Receipt class | **None new.** Deposits and completions write the existing `gross_sale_pence`; Σ over months = G exactly | A `deposit_pence` receipt class — every GDV-, receipt- and §7-identity would need a carve-out for cash that *is* a sale receipt |
| 9 | Selling-cost totals on this path | **Sum of units** | `round(G × pct)` restated — cannot represent a per-unit override |
| 10 | Coverage figure | `pre_sold_pct` at a reference month: the **earliest** `practical_completion` milestone when the programme has one, else the first completion | Series only — a lender reads a headline; a covenant input and flag — a facility-terms field no fixture can yet exercise |
| 11 | Break-even under per-unit sales | §5.11's replay gains a **receipt-lines arm**; the tranche arm's arithmetic is untouched | Generalising the tranche arm to lines — a different rounding path would move every existing phased pin by pennies |
| 12 | The §1.3 defect | **Fixed here**, fixture S's break-even pinned, pre-fix figure as the negative control | Deferring — the release rebuilds the seam; leaving the raw month in the arm beside a resolved-month arm is two rules for one fact |
| 13 | Sensitivity | One signed lever, `sales_slip`, on **completion** months only | No lever — an engine no scenario can stress; slipping exchange too — exchange is a marketing fact, completion a build fact |
| 14 | `exchange: null` | Means simultaneous exchange and completion; requires `deposit_pct = 0` | Requiring an exchange on every row — most rows on a small scheme have none worth modelling |

---

## 4. §22.1 — The schema (inputs v12)

`unit_sales` is a two-state top-level field beside `investment_case` and
`monitoring`:

```
unit_sales: null | {
  deposit_release: 'held_to_completion' | 'released_on_exchange'
  units: UnitSale[]
}

UnitSale:
  unit_id:         string            -- names a unit_mix.units[].id
  exchange:        SaleEvent | null  -- null = exchange and completion are simultaneous
  completion:      SaleEvent
  deposit_pct:     number            -- 0..100, of the unit's gross (value + ancillary)
  agent_fee_pct:   number | null     -- null = scheme selling_agent_fee_pct
  legal_fee_pence: integer | null    -- null = share of scheme selling_legal_fee_pence

SaleEvent:
  month_offset: integer
  anchor:       PhaseAnchor | null   -- §18.6's rule, §18.6's resolver
```

- **A unit's gross** is `estimated_value_pence + ancillary value` (§15.5) — the
  figure `sold_units` already sums, so `gdv_pence` and `gross_sales_pence`
  stay equal by construction, and the `gdv` lever reaches every row without a
  second rule because rows carry no values.
- **`null` is the migration default** and means the document does not use
  this path. No block is synthesised for a document that never asked for one.
- **`ScenarioOverrides` gains `sales_slip_months: integer`** (default 0; the
  migration writes it explicitly) — §11.
- Pydantic bounds follow the port rule #7 exception every timing field already
  uses: `month_offset` and `offset_months` carry only the `le=1200`
  resource-exhaustion ceiling; the spec's window rules are validation errors
  owned by `validation.py`.

---

## 5. §22.2 — The per-unit derivation

A pure module, `unit-sales.ts` / `unit_sales.py`, shaped like
`investment-case`: it takes the inputs, the term and `resolve_anchor_month`,
and returns the result block of §9. It reads no ledger balance and nothing
downstream feeds it.

For each row *u* over the sold set, in `units[]` order:

```
gross_u      = estimated_value_pence + ancillary value                   (integer)
deposit_u    = round_half_up(gross_u × deposit_pct / 100)
agent_u      = round_half_up(gross_u × (agent_fee_pct ?? scheme_agent_pct) / 100)
legal_u      = legal_fee_pence                                if non-null
             = round_half_up(scheme_legal × gross_u / Σ gross over null-legal rows)
               — the LAST null-legal row in units[] order absorbs the residue,
                 so Σ legal over null-legal rows = scheme_legal exactly
net_u        = gross_u − agent_u − legal_u
exchange_m   = resolve(exchange)   when exchange is non-null, else completion_m
completion_m = resolve(completion)
```

- **Totals are sum-of-units on this path**: `selling_costs_pence = Σ (agent_u
  + legal_u)`. §3.7's `round(G × pct)` and this can differ by rounding; §3.7
  gains a sentence saying the per-unit regime's total is the sum of its rows,
  and the two regimes are distinct, not one formula with a special case.
- **When every row's `legal_fee_pence` is non-null, the scheme flat fee is
  unused**, and the spec says so. It is not silently ignored: the rule that
  replaces it is stated, the editor shows the scheme figure as the
  placeholder, and the memo prints the per-unit figures.
- **The resolved months are published on the result block** and every surface
  reads them there — the §18.10 limitation-9 lesson applied from the start.
  `resolved_exit_months.tranches` stays `[]` on this path.

---

## 6. §22.3 — The ledger

No new receipt class (decision 8). Each row writes into the existing
`MonthReceipts` fields, **accumulating** (`+=`) exactly as the tranche arm does
— never the single-disposal arm's full replace, which would wipe an NOI figure
written earlier:

| `deposit_release` | exchange month | completion month |
|---|---|---|
| `held_to_completion` | nothing | `gross += gross_u`; `agent += agent_u`; `legal += legal_u` |
| `released_on_exchange` | `gross += deposit_u` | `gross += gross_u − deposit_u`; `agent`, `legal` as above |

- **Σ gross over months = G exactly** on both settings, so §3.1 (GDV =
  receipts), §4.4's sweep arms, the declining redemption schedule, §5.10 and
  §7 need no carve-out. A released deposit **sweeps under §4.4 like any
  receipt**: the developer holds the cash, and the lender's sweep covenant
  applies to it.
- **Selling costs book in the completion month** (§3.7: the month of the
  receipt they relate to — the sale completes then). A released-deposit month
  carries no cost, so its net receipt is the whole deposit.
- **Within-month order (§19.5) is unchanged:** VAT reclaim → NOI → sales sweep
  → refinance.
- **The redemption schedule** (§4.4.1) is keyed on months with `gross > 0`, so
  a released-deposit month is a disposal month in it, with the balance captured
  before the deposit lands. That is correct disclosure — the balance did fall
  that month — and is stated, not hidden. `redemption_balance_at_disposal_pence`
  remains the balance before receipts in the **final** disposal month, which is
  the last completion.
- **Retained units are untouched.** NOI reads `retained_units`; sales read
  `unit_sales`; §22.7 rule 3 makes the two sets disjoint.

---

## 7. §22.4 — Pre-sales coverage

```
reference_month = earliest start among programme phases with code 'practical_completion'
                    when programme is a network with at least one     (basis 'practical_completion')
                = min over rows of completion_m                       (basis 'first_completion')
exchanged_value_at_ref = Σ gross_u over rows with exchange_m <= reference_month
pre_sold_pct = pct(exchanged_value_at_ref, G)                         -- the shared pct(), §1.2
```

Plus a per-month cumulative series: `exchanged_value_pence`,
`completed_value_pence`, and `deposits_received_pence` (released deposits
only — a held deposit is not cash and never appears as a receipt).

**Earliest PC is the conservative choice.** Coverage measured at the first PC
of a phased block release is the lowest figure a lender would see. Neither a
covenant test nor a flag: the figure and its basis are printed, and the lender
applies their own threshold.

---

## 8. §22.5 — The §5.11 seam, and the correction

### The second solver arm

`PhasedSeniorBreakevenTerms` gains `receipt_lines` (TS optional; Python
`| None`). `_phased_net_by_month` dispatches on which arm is present:

```
ReceiptLine: { month, base_gross_pence, agent_fee_pct, legal_fee_pence }

at trial total G:  scale = G / G_base
  gross_line = round_half_up(base_gross × scale); the LAST line in list order absorbs the residue, Σ = G
  agent_line = round_half_up(gross_line × agent_fee_pct / 100)
  legal_line = legal_fee_pence                    -- fixed; does not scale with price (as §5.11's flat legal today)
  enforcement is deducted from the FIRST line (the list is sorted by month, then units[] order)
  net_by_month[month] += gross_line − agent_line − legal_line − enforcement
```

The per-unit path builds its lines from §5: a released deposit is
`{ exchange_m, deposit_u, 0, 0 }`; the completion is `{ completion_m, gross_u −
deposit_u (or gross_u when held), agent pct, legal_u }`. §5.11's uniform
price-fall assumption carries over unchanged — every unit scales by the same
factor, deposits included because they are a percentage of price. The replay
itself (`phased_replay_redeems`: the fee reservation, the VAT reclaim ordering,
the bisection) is **untouched**; it consumes `net_by_month` only. The
structural-unsolvable test uses the max line month.

**The tranche arm's arithmetic is byte-identical.** One change: it is handed
the **resolved** month.

### §5.12 on the per-unit path

The developer break-even re-solves selling costs at the trial price from a
rate and a flat fee. On the per-unit path those are the **effective blended
rate** `Σ agent_u / G × 100` and the **summed** legal `Σ legal_u`, so the
re-solved cost reproduces the ledger's own cost at `P = G` and scales the
agent component with price as the ledger would. Stated as a §5.12 amendment.

### The correction (§1.3), both engines

`metrics` builds the tranche arm's month from
`schedule.resolved_exit_months.tranches[i]` — read, never recomputed; the
single resolver stays in `schedule`. The `last_tranche` unsolvable guard reads
the same. Unanchored documents are identical by construction.

Consequences, recorded in the spec changelog as a **correction to a reported
metric**:

- **Fixture S's `senior_breakeven_pence` moves** — receipts replay at 16 and
  19 instead of 20 and 21, redemption is earlier, less interest rolls up, and
  the break-even falls. It was never pinned. R13b pins it in both engines with
  cross-engine penny agreement and records the pre-fix figure as the negative
  control — R14's C1 pattern.
- **The `senior_breakeven_unsolvable` flag can flip** for a document whose
  draws continue past the raw month but not the resolved one, or the reverse.
  That is the correct answer; it gets a hand-built guard: two documents
  differing only in a phase slip, one tripping the flag and one not, proving
  the guard reads the resolved month. Must fail against current `main` first.
- **The null-path identity gate lists S's break-even as its sole expected
  mover**, by name, rather than widening its tolerance.

---

## 9. §22.6 — Outputs and reporting

### The result block

`Schedule` gains `unit_sales`, republished (never recomputed) onto
`AppraisalResultV2` exactly as `investment_case` is — `null` exactly when the
input is null.

```
UnitSalesResult:
  deposit_release: 'held_to_completion' | 'released_on_exchange'
  units: Array<{ unit_id, gross_pence,
                 exchange_month: integer | null, completion_month: integer,
                 deposit_pence, deposit_released_pence,        -- released = deposit_pence or 0, by the switch
                 agent_fee_pence, legal_fee_pence, net_pence }>
  months: Array<{ month, exchanged_value_pence, completed_value_pence,    -- both cumulative
                  deposits_received_pence }>                              -- released deposits only
  totals: { gross_pence, deposits_pence, deposits_released_pence,
            agent_fees_pence, legal_fees_pence, net_pence }
  pre_sold: { reference_month, basis: 'practical_completion' | 'first_completion',
              exchanged_value_pence, pct }
```

### Surfaces

- **Exit page (12).** A new `UnitSalesEditor` component rendered inside
  `ExitStrategyPage` (the `OperatingScheduleEditor` pattern), shown when the
  route sells anything. A "Per-unit ledger" toggle is mutually exclusive with
  "Phase the sales" **in the same payload** (the IMPORTANT-3 rule: enabling one
  nulls the other). Enabling seeds one row per sold unit at `completion = {
  term − 1, anchor: null }`, `exchange: null`, `deposit_pct: 0`, both overrides
  `null` — bit-identical in effect to the single-disposal default.
  `selectRoute('retain_all')` nulls `unit_sales` as it nulls `sales_phasing`.
  Each row: the unit's label and gross (read from the run), exchange and
  completion month each with an `ExitAnchorControl`, deposit %, agent % and
  legal £ overrides with the scheme figure as placeholder, and "resolves to
  month N" read off the result block. When `retained_units` changes under
  `blended`, the editor re-seeds missing rows and drops retained ones so rule 3
  stays satisfiable; validation enforces it.
- **Cashflow page (8).** One row, "of which deposits released", under gross
  receipts, shown only when some month's `deposits_received_pence ≠ 0` (the
  NOI-row rule).
- **Memo.** The exit paragraph's disposal clause gains a third arm — *"Unit
  sales ledger: N units completing months …; pre-sold X% at month M (basis)"*
  — reading resolved months. A new sub-section "Unit sales ledger" after the
  refinance line prints the per-unit table (unit, gross, exchange, completion,
  deposit, agent, legal, net), a totals row, and the coverage sentence with
  its basis. Omitted entirely when null (§13.5).
- **Excel.** *Withdrawn at plan time (plan-time design correction 1):* no
  appraisal workbook exists to extend — `export-excel.ts` exports only the
  projects list, and a prior appraisal workbook was deliberately dropped under
  spec §11.9. Recorded as §22.10 limitation 9 rather than built from scratch.
- **§13.4** gains one sentence: a deposit shown as released is a **modelling
  assumption about the sale contract** that the model does not evidence; the
  memo prints it beside the coverage figure.
- **§13.3** is unchanged: no new draft condition. Rows carry no evidence
  status (§13, limitation 7).

---

## 10. §22.7 — Validation

Input errors, not flags. Applying only when `unit_sales` is non-null unless
stated:

1. `unit_sales` and `sales_phasing` both non-null — an error on **both**
   fields. *Applies regardless.*
2. `route = 'retain_all'` with a non-null `unit_sales` — nothing is sold
   (§4.4.1's rule, reused).
3. **Coverage, both directions.** Every sold unit (by route and
   `retained_units`) has exactly one row; every row names a sold unit. A row
   naming a retained unit, a row naming an absent unit, a duplicate `unit_id`,
   and a sold unit with no row are four distinct messages.
4. Each event: `month_offset` a whole month in `[0, term − 1]`; an anchor
   names a phase that exists and requires `programme` to be a network (§18.8's
   rule); the **resolved** month lies in `[0, term − 1]` (§18.8's window on the
   resolved value, as tranches already have).
5. Resolved `exchange_m <= completion_m` where `exchange` is non-null.
6. `deposit_pct` finite in `[0, 100]`, and `= 0` when `exchange` is null.
7. `agent_fee_pct` null or finite in `[0, 100)`; `legal_fee_pence` null or an
   integer `>= 0`.
8. `deposit_release` in the enum.
9. Sold gross `> 0` (§19.7 rule 4's shape: a ledger over units valued at zero
   has nothing to phase).

`sales_slip_months` must be a whole number (§12.6's rule for months levers).
No new flags.

---

## 11. §22.8 — Sensitivity: the `sales_slip` lever

§12.1's ninth row:

| Lever | Unit | Effect on the inputs document |
|---|---|---|
| `sales_slip` | months (signed) | adds to every `unit_sales.units[].completion` — `anchor.offset_months` when anchored, else `month_offset` |

- **Completion only.** A negative slip that drives a completion before its
  exchange is a rule-5 error, so the position is an **invalid cell** (§12.7),
  never a clamp.
- **Composition order, stated as §12.1 requires:** `sales_slip` writes a field
  no other lever touches, so all nine remain disjoint and application remains
  order-independent — asserted by the existing several-orders test gaining an
  entry. No target, so duplicate checks key on `lever` alone.
- **On `unit_sales = null` it is a no-op by construction** — a zero-width
  tornado bar, `phase_slip`'s precedent on `programme = null`.
  `selectableLevers` offers it only when `unit_sales` is non-null, as
  `phase_slip` needs a network.
- `ScenarioOverrides.sales_slip_months` is a **stored** field, migrated as
  `0`, applied **additively** through `applyScenario` — the single adjustment
  point every lever passes through. `ScenariosPage` gains its input.
- §12.2's facility invariance is untouched.

**Recorded, not fixed here:** the R12/R13 override fields (`phase_slip_*`,
`exit_yield_adjustment_pct`, `operating_cost_adjustment_pct`,
`vacancy_adjustment_pct`) have no `ScenariosPage` input. That is R16 UX debt
and goes in the release plan.

---

## 12. §22.9 — Migration and the persistence boundary

```
v11 unit_sales: (absent)                         →  v12 null
v11 scenarios.<each>.sales_slip_months: (absent) →  v12 0
```

Both additions are inert by construction. `is_v12` discriminates on
`inputs_version == 12 && 'unit_sales' in doc`; `migrate_v11_to_v12` refuses a
v12 document; `migrate_inputs_to_v12` is the structural copy of v11's;
`parse_calculator_inputs` gains the v12 branch first.

**The migration moves no computed value.** The numeric identity gate runs the
*same* code over a v11 document and its migrated v12 twin, corpus-wide in both
engines, and requires equality — the §8 correction sits on both sides of that
comparison, so it cannot show up there. The separate claim — *"calc 2.14.0
reproduces calc 2.13.0 on every `unit_sales = null` document"* — carries
exactly one named exception, fixture S's `senior_breakeven_pence` (§8), and is
evidenced by every existing golden pin staying where it is while S gains a new
pin whose pre-fix value is recorded beside it as the negative control. The
validation side is §19.9's three separately falsifiable properties:

1. Every issue a v11 document raises has a v12 counterpart under a stated
   alias map.
2. The v12-only rules of §22.7 raise no issue on a migrated document.
3. A control document trips a v12-only rule — both blocks non-null — proving
   property 2 is not vacuous.

**The entry-point cutover to v12** — `app.py`, `defaultCalculatorInputsV12`,
the client's `migrateInputsToV12` — is its own task, **last**, guarded by both
entry-point tests. R12's finding stands: the cutover is what finds the boundary
bug, and a release that leaves the server writing v11 ships inert.

---

## 13. §22.10 — Stated limitations

1. **Uniform price fall in the break-even.** §5.11 scales every unit by the
   same factor; there is no per-unit price stress.
2. **A unit's price is its `unit_mix` value.** No incentives, discounts,
   part-exchange or bulk-sale pricing.
3. **One deposit per unit, at exchange.** No staged deposits, no deposit
   interest, no stakeholder-release conditions; the release switch is
   scheme-level.
4. **Coverage is a figure, not a test.** No pre-sales covenant input and no
   flag.
5. **The coverage reference month is the earliest PC.** A phased block release
   is measured at its first PC.
6. **Exchange dates are stressed by no lever.**
7. **Rows carry no evidence status** — reservation, exchange or completion
   evidence is R15's model, on §14.6/§15.9/§16.9/§19.10's reasoning.
8. **The two sales paths remain two.** A document is phased by tranche or by
   unit; there is no conversion between them.
9. **No appraisal workbook.** The ledger is printed in the memo and on the
   pages only (plan-time correction 1; spec §11.9).

---

## 14. Fixture X — `x-unit-sales-ledger`

`sell_all`; four units of unequal value, one carrying ancillary parking value;
a short precedence network with a `practical_completion` milestone, a
`unit_completions` phase after it and a `marketing` phase overlapping
construction; `deposit_release: released_on_exchange`; rolled-up interest so
timing moves the balance; a facility small enough that the sweep matters.

| unit | exchange | completion | deposit | agent | legal |
|---|---|---|---|---|---|
| u1 | anchored `marketing + 0` | anchored `practical_completion + 0` | 10% | null | null |
| u2 | fixed month before PC | anchored `practical_completion + 1` | 10% | null | fixed £ |
| u3 | null (simultaneous) | anchored `unit_completions + 1` | 0 | 2.0% | null |
| u4 | fixed (11) | fixed (20 — not the last month, so `sales_slip +3` stays valid and `+4` goes invalid) | 5% | null | null |

Pins, hand-derived in the plan against the constructed document (the R10 rule:
reachable literals, not merely correct ones): per-unit gross, deposit, agent,
legal and net — including the null-legal apportionment across u1/u3/u4 with u4
absorbing the residue; the two released-deposit months' `gross_sale_pence`;
`selling_costs_pence` as the sum of units; `pre_sold` with basis
`practical_completion` and the pct from u1 + u2; the redemption-schedule months;
peak debt and its month; `senior_breakeven_pence` (cross-engine penny
agreement); `report_safe`.

Its `held_to_completion` twin lives in the unit tests, not as a second golden
fixture: the same document with one field changed, identical GDV, gross sales
and selling costs, later redemption, higher interest.

Registered in every fixture roster: `EXPECTED_FIXTURE_STEMS` on both sides,
`test-cases.md`, `migration-notes.md`, `memo-fixtures.ts`.

---

## 15. Guards this release must watch fail

| Guard | What must fail first |
|---|---|
| **Deposit liveness** | released vs held twin: `gross_sale_pence[exchange_m]` is the deposit vs 0; total interest and the closing balance on **absolute** figures; `gdv_pence`, `gross_sales_pence`, `selling_costs_pence` **identical** |
| **Sum-of-units costs** | one row's `agent_fee_pct` override moves `selling_costs_pence` by the hand figure; a document with every legal override set differs from its all-null twin by exactly the scheme flat fee's replacement |
| **Residue absorption** | three null-legal rows whose shares do not divide: Σ apportioned legal = the scheme fee to the penny, and the last row carries the residue |
| **Exclusion** | both blocks non-null rejected on both fields; each alone accepted |
| **Coverage, both directions** | a missing sold unit, a row for a retained unit, a row for an absent unit, a duplicate — four distinct messages |
| **Resolved window** | an anchored completion resolving past `term − 1` errors; its twin one month earlier does not |
| **Exchange <= completion under slip** | a `sales_slip` of −N turns a valid cell invalid (§12.7), never clamped |
| **Pre-sold basis switch** | the same rows on a programme with and without a PC milestone: basis, reference month and pct all change, pct by hand |
| **Break-even lines arm** | fixture X in both engines; a released-deposit document's break-even is **lower** than its held twin's |
| **§5.12 basis** | a document with one agent override: the developer break-even differs from the scheme-rate figure by the hand amount |
| **S resolved-month fix** | S's break-even moves off the recorded pre-fix figure; the unsolvable-flag pair; both must fail on current `main` |
| **Tranche-arm identity** | every unanchored phased fixture's break-even is byte-identical across the arm refactor |
| **Migration identity** | the numeric gate: same code, v11 document vs its migrated v12 twin, equal corpus-wide in both engines |
| **Null-path identity to 2.13.0** | every pre-existing golden pin unchanged; S's `senior_breakeven_pence` is the one figure that moves, and its pre-fix value is the negative control |
| **Lever order-independence** | all nine levers in several orders |
| **Lever inertness on the null path** | `sales_slip` on a null document: a zero-width bar, not an error, not a value change |
| **§1.6 version list** | requires v12 |
| **Memo** | the section is absent when null and carries the hand-pinned rows when not; the exit paragraph prints resolved months |
| **Entry points** | both engines' entry-point guards pass only once every production call site names v12 |

**Deliberately not written**, because they would be vacuous: `net = gross −
agent − legal` (true by construction); Σ gross over months = G asserted from
the engine's own accumulation with no hand figure (the fixture pins do it);
`deposit_release` is in the enum (the type guarantees it).

---

## 16. Also in scope

- The §5.11 correction (§8) and S's new pins.
- The §5.12 cost basis on the per-unit path.
- Spec edits: §22; §1.6; §3.7; §4.4; §5.11; §5.12; §12.1; §12.6; §13.4;
  §19.10 limitation 1 as history; the changelog line naming S's break-even as
  a corrected metric.
- `migration-notes.md` §15 (v11 → v12, the identity claim, the York appraisal
  after R13b); `test-cases.md` fixture X worksheet; `model-governance.md` §3.1
  version row; the release plan's R13b row, the R16 UX-debt note, and
  (plan-time correction 2) R15's row moving from inputs v12 to v13, since
  R13b takes v12; the missing 2.13.0 changelog bullet (R14 debt) and §12.6's
  stale "five levers" (plan-time correction 3).

## 17. Out of scope

A pre-sales covenant and its flag; per-unit price incentives; part-exchange;
staged deposits; deposit interest; evidence status on rows (R15); scenario-page
inputs for the R12/R13 override fields (R16); converting a tranche document to
a unit document.

---

## 18. Shape of the work

Roughly sixteen tasks, in five bands, then the cutover:

1. **Schema and migration** — v12 types in both engines, `sales_slip_months`,
   `is_v12`/`migrate_v11_to_v12`/`migrate_inputs_to_v12`, the numeric gate,
   property 1.
2. **The engine** — `unit-sales.ts` / `unit_sales.py` with hand-derived unit
   tests; the ledger wiring in both `build_schedule`s; validation with
   properties 2 and 3; fixture X.
3. **The break-even seam** — the receipt-lines arm; the resolved-month
   correction with its failing-first tests; S's pins; the §5.12 basis.
4. **The lever** — `applyScenario`, `LEVER_ORDER`, config validation, cell
   validity, the several-orders test, `ScenariosPage` input.
5. **Surfaces and documents** — the editor, the cashflow row, the memo
   section and paragraph, the Excel sheet, the spec edits, the governance
   documents, the release plan.

The entry-point cutover to v12 is its own task, at the end.
