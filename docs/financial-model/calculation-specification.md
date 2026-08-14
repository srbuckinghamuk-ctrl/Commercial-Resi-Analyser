# Calculation Specification — Commercial-to-Residential Development Appraisal

**Status:** Authoritative. Calculation version `2.2.0`.
**Date:** 14 August 2026
**Scope:** Defines every financial quantity the application computes, stores or reports. Any output not derivable from this specification must not be displayed to a user or exported. The monthly engine described here is the single source of truth; no UI page, report, export or backend endpoint may re-implement a formula defined here.

**Changelog:**
- **2.2.0** — dated programme + spend curves (R3a); flags moved onto the result object; no numeric change for migrated v3 inputs.
- **2.1.0** — new optional `lender_valuation` input block and `finance.enforcement_cost_assumption_pence` field (§2); no existing formula's computed value changed.

Implementation release markers: **[R1]** implemented in Release 1 (P0 financial correction); **[R2]** defined now, implemented later; **[R3a]** Release 3 programme engine (calc 2.2.0, implemented); **[R3b]** Release 3 phased exits (calc 2.3.0, defined now, implemented later). A metric whose marker means "defined now, implemented later" — R2, R3b, or a bare R3 — must be displayed as "not available" (never a substitute formula) until implemented; markers recording work already shipped (R1, R3a) carry no such restriction.

---

## 1. Global conventions

### 1.1 Money

- All monetary values are **integer pence** (GBP) end-to-end: inputs, monthly ledger lines, aggregates, persisted values, report values.
- Intermediate products of a single formula may be fractional; the formula's result is rounded to integer pence **at the point each ledger line is created**, never re-rounded downstream. Aggregates are sums of already-integer lines and are therefore exact.
- Rounding mode for money: **half-up toward +∞**, i.e. JavaScript `Math.round`. The Python implementation must use `math.floor(x + 0.5)` (not Python's banker's `round()`); both implementations must agree to the penny on all golden fixtures.
- Fractional-area products round once, at source: `base = round_half_up(construction_cost_per_sqm_pence × total_construction_sqm)` — the product is rounded to integer pence in one step, before contingency (§3.4).

### 1.2 Percentages and rates

- Percentage **inputs** are floats where `70.0` means 70% (existing convention, retained).
- Percentage **outputs** are reported to 2 decimal places, half-up. The unrounded value is used for any further computation; only display/persistence is rounded.
- Annual interest rates convert to monthly as `monthly_rate = annual_rate_pct / 100 / 12` (nominal annual, monthly compounding when rolled up). This is the stated basis; it is disclosed in reports as "annual rate / 12, compounded monthly on rolled-up balances".

### 1.3 Monthly timing conventions

The engine operates on discrete months indexed `m = 0, 1, 2, …` where **month 0 is the acquisition month**. Within any month, events are ordered:

1. **Start of month:** costs are incurred; equity contributions and senior draws (including the day-one advance in month 0) fund them; lender fees due at drawdown are capitalised.
2. **During month:** interest accrues on the balance after step 1 (i.e. on `opening_balance + draws + capitalised_fees`).
3. **End of month:** sale/refinance receipts arrive; selling costs are deducted; the sales sweep repays senior debt (including exit fee at final redemption); residual cash distributes to equity; closing balance is struck.

Consequences: a draw made in month *m* bears a full month's interest in month *m*; a receipt in month *m* stops interest from month *m+1*. This is a deliberate, disclosed, conservative convention (no day-count subtleties in a monthly model).

### 1.4 Determinism

All calculations are pure functions of the input document. No wall-clock time, randomness or locale enters any formula. The same inputs must produce byte-identical outputs across the TypeScript and Python implementations (verified by shared golden fixtures).

### 1.5 Unknown vs zero

`null`/absent means **unknown**; `0` means **known to be zero**. Unknown lender-critical inputs (e.g. lender GDV, day-one advance) must never be defaulted silently: dependent metrics return `null` ("not available") and the reconciliation panel lists the missing input. Unknown is never treated as safe/green.

### 1.6 Versioning

Every appraisal document carries `calc_version` (semver of this specification's implementation) and `inputs_version` (schema version of the input document): `1` = legacy pre-spec snapshot; `2` = this specification (calc 1.0); `3` = calc 2.x (adds optional `lender_valuation` block); `4` = calc 2.2.0+ (adds optional `programme`, `sales_phasing`, `refinance` blocks). Outputs are only comparable within a `calc_version`.

---

## 2. Input basis definitions

| Term | Definition |
|---|---|
| **Committed cash equity** | Sum of equity sources classified `cash` with evidence status other than `rejected`. |
| **Committed net facility** | `committed_net_facility_pence`: lender-committed principal available for acquisition/development draws and capitalised non-interest fees. |
| **Committed gross facility** | `committed_gross_facility_pence` if provided; otherwise `committed_net_facility_pence + interest_reserve_pence`. Caps the closing senior balance including rolled-up interest. |
| **Eligible development costs** | Construction, professional and statutory costs (not acquisition, not selling costs, not finance costs) — the base against which `development_cost_advance_pct` caps monthly senior draws. |
| **Legacy leverage** | A migrated v1 `ltv_pct`. It is stored as `legacy_leverage_pct` with `requires_confirmation: true` and is used only to propose an unconfirmed committed net facility during migration (§10). It is never presented as an approved lender metric. |
| **Lender valuation** | Optional `lender_valuation` block (`inputs_version 3`) recording a lender-adjusted GDV (§3.2): `basis` — one of `global_pct` (% adjustment applied to every unit's developer value, e.g. `-10`), `global_per_sqft` (pence per sq ft applied to every unit's area, replacing its developer value), `unit_type` (`per_key_values` maps unit type → % adjustment), `per_unit` (`per_key_values` maps unit id → lender value pence), `fixed_amount` (`global_value` is the total lender GDV in pence, replacing the summed value). Required provenance `reason`, `author`, `date` (ISO `yyyy-mm-dd`) travel with the block and are displayed with any variance it produces. `null`/absent = no lender valuation recorded. |
| **Enforcement cost assumption** | `finance.enforcement_cost_assumption_pence`: integer pence, `>= 0`, default `0`. A disclosed assumption for the lender's cost of enforcement, used in senior repayment break-even (§5.11) and reported as an assumption wherever that metric is shown. |

---

## 3. Cost and value metrics

Each metric states: numerator / denominator (for ratios), included costs, excluded costs, timing basis, gross/net treatment, assumptions, rounding, and behaviour under zero debt and negative profit.

### 3.1 Developer GDV [R1]

- **Formula:** Σ `unit.estimated_value_pence` over all proposed units (developer values).
- **Included:** internal saleable unit values only. **Excluded:** parking/external space (until valued separately in R3), retained-commercial value, rental income.
- **Timing:** point value at practical completion; not indexed.
- **Gross/net:** gross of selling costs.
- **Assumptions:** unit values are the developer's own estimates; comparable basis recorded per unit.
- **Rounding:** exact sum of integer inputs.
- **Zero-debt:** unchanged. **Negative-profit:** unchanged.
- Zero GDV with units present is a hard validation error.

### 3.2 Lender-underwritten GDV [R2 — implemented in calc 2.1.0]

- **Formula:** Σ lender unit values, where each lender value = developer value adjusted by the recorded lender adjustment (global %, global £/sq ft, unit-type, per-unit, or fixed amount).
- Defaults to `null` (unknown), never silently to developer GDV. All lender-basis metrics (LTGDV-lender, senior break-even % of lender GDV) return `null` until it is set.
- Variance vs developer GDV is displayed with reason/author/date.

### 3.3 Acquisition cost [R1]

- **Formula:** `purchase_price + SDLT + legal_fees + survey_cost + round(purchase_price × broker_fee_pct/100) + other_acquisition_costs`.
- **SDLT:** commercial (non-residential) England/NI slice bands: 0% to £150,000; 2% to £250,000; 5% above. Jurisdiction other than England/NI is out of scope in R1 and must be flagged as an assumption in reports.
- **Timing:** month 0 in full.
- **Gross/net:** VAT on purchase is not modelled in R1; reports must carry the assumption "purchase price treated as VAT-exempt/TOGC — unconfirmed".
- **Rounding:** broker fee rounded half-up; other terms integer inputs.
- **Edge cases:** negative components are hard validation errors.

### 3.4 Construction cost [R1]

- **Formula (headline mode, the only R1 mode):** `base = construction_cost_per_sqm_pence × total_construction_sqm`; `contingency = round(base × contingency_pct/100)`; `compliance = fire_safety + sound_insulation + part_l`; total = `base + contingency + compliance`.
- **Contingency base:** the headline base build only — explicitly excludes compliance allowances, professional fees and acquisition. This base is displayed wherever contingency appears.
- **Timing:** spread per the spend profile (§6). R1 default: straight-line over the construction window, disclosed as an assumption.
- **Gross/net:** entered figures are treated as net of recoverable VAT; VAT modelling is R3 and the report carries "construction VAT treatment unconfirmed — no reduced-rate saving is assumed in the appraisal".
- **Edge cases:** negative rate/area/contingency are hard errors; `total_construction_sqm` differing from Σ unit areas by >25% raises a warning (unreconciled areas).

### 3.5 Professional fees [R1]

- **Formula:** `architect + structural_engineer + mande + planning_consultant + other_professional_fees`.
- **Excluded:** statutory costs (§3.6) — note this is a reclassification of the v1 grouping, values unchanged in total.
- **Timing:** spread per profile; R1 default straight-line over the first half of the construction window (disclosed).
- **Edge cases:** negatives are hard errors.

### 3.6 Statutory costs [R1]

- **Formula:** `prior_approval_fee_per_dwelling × max(1, unit_count) + cil_s106 + building_control`.
- **Timing:** month 0 (prior approval), with CIL/S106 and building control spread with professional fees in R1 (disclosed simplification; dated programme refines this in R2).
- **Edge cases:** negatives are hard errors.

### 3.7 Selling and exit costs [R1]

- **Formula (per disposal receipt):** `agent_fee = round(gross_receipt × selling_agent_fee_pct/100)`; plus `selling_legal_fee_pence` allocated pro-rata across selling months (final month absorbs the rounding residue so the total is exact).
- **Included in:** monthly cash flow, TDC, profit, profit on cost, IRR, sensitivities — always.
- **Timing:** the month of the receipt they relate to.
- **Gross/net:** deducted from gross receipts before the debt sweep.
- **Zero-debt:** unchanged. **Retained units:** incur **no** selling costs.

### 3.8 Cost before finance [R1]

- **Formula:** acquisition cost + construction cost + professional fees + statutory costs + selling and exit costs.
- Selling costs are included here (they are a cost of the scheme, not of the debt). A sub-total excluding selling costs ("development cost before disposal and finance") is also reported for LTC-net purposes (§5.3).
- **Rounding:** exact sum.

### 3.9 Finance costs [R1]

- **Formula:** Σ over months of (interest accrued) + arrangement fee + exit fee + other lender fees (broker on debt, lender legal, valuation, monitoring surveyor, non-utilisation, extension — as provided).
- **Fee bases (each disclosed wherever the fee is shown):**
  - `arrangement_fee_basis`: `committed_net_facility` (default) or `committed_gross_facility`. Charged on commitment and capitalised in month 0 whenever a facility is committed.
  - `exit_fee_basis`: `committed_gross_facility` (default), `peak_debt`, or `redemption_balance`. Charged at final redemption, added to the amount required to discharge the loan.
- **Interest:** accrues on the actual senior balance per §4 — never on cumulative project spend and never as flat full-term interest on the nominal facility.
- **Zero-debt (cash funding):** finance costs are exactly **zero** — engine invariant, not just an expectation.
- **Rounding:** each month's interest rounded half-up to pence when accrued.

### 3.10 Total development cost (TDC) [R1]

- **Formula:** cost before finance (§3.8, including selling costs) + finance costs (§3.9).
- **Equals by construction:** Σ of all "uses" lines in the monthly ledger. A run in which the summary TDC differs from the monthly-ledger sum is an engine defect (invariant test).
- **Negative-profit:** unchanged; TDC does not depend on GDV.

### 3.11 Profit before finance [R1]

- **Numerator basis:** realised net proceeds (plus, for retained units, their **valuation** clearly labelled unrealised) − cost before finance.
- **Timing:** whole-scheme, undiscounted.

### 3.12 Profit after finance ("profit") [R1]

- **Formula:** total net receipts (sale receipts net of selling costs; refinance proceeds when modelled) − TDC excluding selling costs… stated precisely: `profit = Σ gross receipts − TDC` where TDC already contains selling and finance costs.
- **Identity (invariant):** when senior debt is fully repaid, `profit = Σ developer equity cash flows` (contributions negative, distributions positive).
- **Retained exits:** realised (cash) profit and unrealised (valuation-based) profit are reported separately; the headline "profit" for a `retain_all` case is the **unrealised** figure and is always labelled "unrealised — subject to refinance/valuation". [R1 labels; R2 models refinance proceeds.]
- **Negative profit:** reported as a negative number, never clamped; triggers a red flag.

### 3.13 Profit on cost [R1]

- **Numerator:** profit after finance. **Denominator:** TDC (§3.10).
- **Zero TDC:** returns `null` (not 0). **Negative profit:** negative percentage.
- **Rounding:** 2 dp display.

### 3.14 Profit on GDV [R1]

- **Numerator:** profit after finance. **Denominator:** developer GDV.
- **Zero GDV:** `null`. **Rounding:** 2 dp.

### 3.15 Developer equity cash flow [R1]

- **Definition:** the monthly vector of actual equity movements: contributions (negative) when equity funds costs or serviced interest; distributions (positive) when post-sweep residual cash is released.
- Equity is not released before senior debt is fully repaid (100% sweep default; a `sales_sweep_pct < 100` releases the unswept share of net receipts).
- This vector is the sole basis for IRR and equity multiple.

### 3.16 Equity multiple [R1]

- **Numerator:** Σ distributions. **Denominator:** Σ contributions (absolute).
- **Zero contributions:** `null`. **Negative profit:** multiple < 1.0, reported as-is.

### 3.17 IRR — monthly and annual [R1]

- **Basis:** the developer equity cash-flow vector (§3.15). Never synthetic flows.
- **Solver:** Newton–Raphson from 1%/month, up to 1,000 iterations, tolerance 1e-7; on non-convergence, bisection fallback over [-99%, 1000%] per month.
- **No solution:** if all flows are one-signed, or no sign change of NPV exists in the bracket, IRR = `null` and the UI/report shows "IRR not available (no sign change in equity flows)". Multiple-IRR cases report the root nearest zero and are flagged.
- **Annualisation:** `(1 + irr_monthly)^12 − 1`.
- **Retain-all without modelled refinance:** no positive terminal flow exists → IRR is `null` by construction (correct behaviour, replacing the previous synthetic IRR).

### 3.18 Residual land value (RLV) [R1]

- **Formula:** `RLV = GDV / (1 + target_profit_on_cost_pct/100) − total cost excluding land`, where total cost excluding land = TDC − purchase price − SDLT, and `target_profit_on_cost_pct` is the **configurable** deal-spider target (`deal_spider.target_profit_on_cost_pct`), no longer hard-coded 20%.
- **Disclosed limitation:** finance and SDLT within "cost excluding land" are those of the appraised structure, not re-solved for the residual price (a fixed-point refinement is R3). Reports state this.
- **Negative RLV:** reported as-is.

---

## 4. The senior debt ledger [R1]

For every month the engine records:

| Column | Definition |
|---|---|
| `opening_balance` | Prior month's closing balance (0 in month 0). |
| `draw` | Senior principal advanced this month (day-one advance in month 0; development advances thereafter) per the draw rules (§4.2). |
| `capitalised_fees` | Lender fees capitalised this month (arrangement at first draw; others as dated). |
| `interest_accrued` | `round((opening_balance + draw + capitalised_fees) × monthly_rate)`. |
| `interest_capitalised` | = `interest_accrued` when `interest_type = rolled_up`, else 0. |
| `interest_serviced` | = `interest_accrued` when `interest_type = serviced`, else 0. Paid from equity that month (§4.3). |
| `repayment` | Principal + capitalised interest repaid from swept receipts at month end; at final redemption includes the exit fee (recorded on its own line). |
| `closing_balance` | `opening + draw + capitalised_fees + interest_capitalised − repayment`. Must never be negative (invariant). |
| `undrawn_net_facility` | `committed_net_facility − cumulative(draw + capitalised_fees)`. |
| `gross_utilisation` | `closing_balance / committed_gross_facility` (null if no facility). |
| `interest_reserve_remaining` | `interest_reserve − cumulative interest_capitalised`, floored at reporting (exhaustion is flagged, not hidden). |
| `facility_headroom` | `committed_gross_facility − closing_balance`. |

**Roll-forward invariant (tested to the penny):** closing = opening + draw + capitalised_fees + interest_capitalised − repayment, every month.

### 4.1 Funding sources must change the model

- `cash`: senior facility forced to 0; draws, interest, and all lender fees are exactly 0; every eligible use funds from equity/other sources. Non-zero senior anything under `cash` is a hard validation error.
- `bridging` / `development_finance`: the ledger runs as above. (R1 treats both identically except labelling; product-specific behaviour is R2+.)
- `interest_type` produces materially different results: rolled-up capitalises into the balance (compounding); serviced keeps the balance flat but consumes monthly equity.

### 4.2 Equity/debt draw priority (rule `equity_first`, the R1 rule)

Month 0 (acquisition):
1. Day-one advance = `min(day_one_advance_pence, committed_net_facility, month-0 uses)` is drawn (if `day_one_advance_pence` is null, no separate tranche — proceed to step 3 logic for month-0 costs).
2. Arrangement fee is capitalised (within net facility).
3. Remaining month-0 uses are funded by equity contribution.

Months ≥ 1, for each month's uses:
1. Remaining committed equity funds costs first, until exhausted.
2. Senior development advances fund the remainder, capped by (a) `undrawn_net_facility`, (b) `development_cost_advance_pct` × that month's eligible development costs, and (c) gross facility headroom after projected interest.
3. Any residual unfunded cost is a **funding gap**: it is *not* funded, it is recorded as `funding_gap` for the month, flagged red, and accumulates. Cost overruns never create facility.

Legacy migrated appraisals may run with `equity_draw_rule = 'fund_as_required'` (equity absorbs any residual with no cap) — permitted only while the appraisal carries `requires_confirmation` status, so sources always balance but the case is visibly unconfirmed. `pari_passu` is defined (pro-rata to remaining commitments) but rejected with a validation error until implemented [R2].

### 4.3 Serviced interest

Serviced interest is a developer cash use in the month accrued. It is funded from committed equity; if committed equity is exhausted it adds to the funding gap (flagged "additional equity required to service interest", with the cumulative amount reported). It never increases senior principal unless the user explicitly capitalises it by switching to rolled-up.

### 4.4 Sales and repayment [R1]

- Each receipt month: `net_receipt = gross_sale_price − agent_fee − allocated_legal_fee`.
- Sweep: `min(net_receipt × sales_sweep_pct/100, redemption_amount)` repays senior debt; redemption at final discharge includes accrued interest to date and the exit fee.
- Receipts insufficient to cover principal plus exit fee do not discharge the facility; the balance carries.
- Residual cash after the sweep distributes to equity the same month.
- R1 timing: `sell_all` and the sold portion of `blended` receive all receipts in the final month of the term (single-month disposal, disclosed as an assumption); phased sales rates are R2.
- `retain_all` (and the retained portion of `blended`): **no sale receipt, ever**. The ledger ends with the senior balance outstanding at term end; the appraisal reports "senior debt outstanding at maturity: £X — repayment source (refinance) not yet modelled" as a red flag. Refinance proceeds are R2.
- Practical completion never implies disposal or repayment.

---

## 5. Lender metrics

### 5.1 Day-one advance and day-one LTV [R1]

- **Day-one advance:** the actual month-0 senior draw (§4.2), not the committed facility.
- **Day-one LTV (vs purchase price):** day-one advance ÷ purchase price.
- **Day-one LTV (vs day-one market value):** day-one advance ÷ `day_one_market_value_pence` when provided, else `null`.
- Dividing the total facility by purchase price is prohibited; the pre-R1 report figure of that kind is removed.
- **Zero-debt:** 0 advance, LTV 0%. Both variants and their denominators are disclosed in tooltips/reports.

### 5.2 Development-cost advances [R1]

Cumulative senior draws after month 0. Reported alongside the cap basis (`development_cost_advance_pct` of eligible development costs).

### 5.3 Net facility / gross facility [R1]

As defined in §2. Reported with utilisation: net = cumulative draws + capitalised non-interest fees vs committed net; gross = closing balance vs committed gross.

### 5.4 Net LTC (excluding finance) [R1]

- **Numerator:** cumulative net senior advances (principal draws + capitalised non-interest fees; excludes rolled-up interest).
- **Denominator:** development cost before disposal and finance (§3.8 sub-total).
- **Zero-debt:** 0%. **Zero denominator:** `null`.

### 5.5 Gross LTC (including finance) [R1]

- **Numerator:** peak gross senior debt (§5.7).
- **Denominator:** TDC (§3.10).
- Numerator and denominator are named wherever the ratio appears.

### 5.6 LTGDV [R1 developer basis; R2 lender basis]

- **Numerator (both):** peak gross senior debt.
- **Denominators:** developer GDV [R1]; lender-underwritten GDV [R2] — the lender-facing default once available; `null` until then.

### 5.7 Peak debt [R1]

- **Definition:** `max` over months of the intra-month maximum balance = `opening + draw + capitalised_fees + interest_accrued (if rolled up)` before that month's repayment. Reported with its month index (date from the programme in R2), committed gross facility, facility headroom at peak, interest-reserve remaining at peak, and contingency remaining at peak.

### 5.8 Interest reserve [R1 input & tracking]

Ledger column §4. Exhaustion (cumulative capitalised interest > reserve) is an amber/red flag with the exhaustion month.

### 5.9 Facility headroom [R1]

`committed_gross_facility − peak gross debt` (and per-month in the ledger). Negative headroom = facility exceeded = red flag; the model does not silently expand the facility.

### 5.10 Cost-to-complete [R2 — implemented in calc 2.1.0]

For each month `m` in `1..term` (`m` labels the state as of completion of ledger month `m−1`; `m = term` is the terminal "nothing left to spend" checkpoint): **remaining cost** = future development costs from ledger month `m` onward (acquisition/construction/professional/statutory — contingency is already inside the construction cost line, §3.4/§6, never a separate additive term) + future lender ancillary fees + forecast finance to completion (future interest accrued + future capitalised fees, read straight off the already-computed ledger horizon). **Remaining funding** = undrawn committed net facility as of ledger month `m−1` (0 for cash deals, where no facility exists) + committed cash equity not yet contributed (only cash-classified equity sources count as committed funding, per §2 — land/planning-uplift/vendor-finance/deferred-consideration equity is not, and Release 2b models no other committed-funding category). Reports remaining cost, remaining funding, surplus (`funding − cost`), first shortfall month (first `m` with surplus `< 0`, else none), maximum shortfall (largest deficit across the series, floored at 0). The series is derived from the already-computed ledger, which carries the dated programme when `programme` is set and the calc-2.1.0 auto windows otherwise (calc 2.2.0, [R3a]).

**Known limitation (calc 2.1.0):** this series is a static snapshot of committed sources against forecast cost, not a re-simulation of the ledger's own month-by-month throttling (gross-facility headroom cap, §4.2(c); the development-cost advance-percentage cap, §4.2; uncommitted "additional equity" silently absorbing a serviced-interest shortfall, §4.3). Neither direction of "no cost-to-complete shortfall ⇔ the ledger never flagged `funding_gap`" is a general property of the engine — a headroom-capped fixture proves a real `funding_gap` can exist with no cost-to-complete shortfall, and a constructed high-rate serviced-interest scenario proves the reverse (a cost-to-complete shortfall with zero `funding_gap`, absorbed instead by uncommitted additional equity). Only "the series reports a shortfall ⇒ the ledger recorded a `funding_gap` somewhere" is asserted as a test, and it is verified across the fixtures in the current test corpus, not proved as a universal law — see `docs/financial-model/test-cases.md`'s cost-to-complete section for both counter-examples and the scope of what is and isn't tested.

### 5.11 Senior repayment break-even [R2 — implemented in calc 2.1.0]

Minimum gross sale price `P` such that `P = redemption_balance_at_disposal + exit_fee + disposal_costs(P) + enforcement_cost_assumption`. Solved iteratively because disposal costs depend on `P`. Reported absolute, as % of lender GDV, and as the % fall from lender GDV before senior exposure. Never computed as "GDV vs TDC" — the pre-R1 "senior debt impairment" figure is removed in R1.

### 5.12 Developer profit break-even [R2 — implemented in calc 2.1.0]

Minimum gross sale price giving zero developer profit: `TDC` restated at the break-even receipts (selling costs re-solved). Distinct metric from §5.11, never conflated.

---

## 6. Spend profiles [R1 minimal]

R1 supports `straight_line` over a window (construction: months 1..N−2 of the term, minimum 1 month; professional/statutory: first half of that window) — the v1 shape, now explicitly disclosed as an assumption on the cash-flow page and in reports. Rounding: each month rounds half-up; the final month of a window absorbs the cumulative rounding residue so the spread sums exactly to the total (invariant). The complete set of spend curves is defined in §6.1 (calc 2.2.0, [R3a]): `straight_line`, `s_curve`, `back_loaded`, and `user_defined`. An `upfront` curve was planned but removed before implementation — it is expressible via a 1-month window or user_defined weights concentrated in month 1.

**Note (calc 2.1.0):** §5.10 cost-to-complete is derived directly from the ledger, which follows this straight-line schedule when `programme` is null (remaining cost per month = totals less cumulative spend to date under this profile) and the dated programme (§6.1, calc 2.2.0, [R3a]) otherwise — the relationship is unchanged, not redefined, either way.

### 6.1 Dated programme [R3a — calc 2.2.0]

Inputs v4 adds a nullable `programme` block. `programme = null` (the migration
default) = auto windows: construction straight-line over months 1..N−2,
professional and statutory over the first half of that window (§6 above),
derived from `term_months` at build time — bit-identical to calc 2.1.0.

An explicit programme gives each package (construction, professional,
statutory) a window `[start_offset, start_offset + duration_months)` and a
curve. The statutory package spreads CIL/S106 + building control only; the
prior-approval fee stays at month 0. Acquisition stays at month 0.

Curves, for a window of D months, k = 1..D (1-indexed within the window),
ideal fraction w_k of the package total; month k pence = round_half_up(total ×
w_k); the final month absorbs the cumulative residue (invariant: Σ = total):

- straight_line: w_k = 1/D (computed as round(total / D) per month, final
  absorbs — the calc-2.0.0 function, unchanged).
- s_curve: cumulative W(k) = (1 − cos(π·k/D)) / 2; w_k = W(k) − W(k−1).
- back_loaded: w_k = 2k / (D(D+1)).
- user_defined: weights u_1..u_D (each ≥ 0, Σu > 0, length exactly D);
  w_k = u_k / Σu.

Validation (input errors, not flags), applying only when `programme` is
non-null: duration_months ≥ 1; start_offset ≥ 0; start_offset +
duration_months − 1 ≤ term − 2 (the ≥-2-month sale tail, §6); user_defined
weight rules above. While calc is 2.2.0, non-null `sales_phasing` or
`refinance` is a hard validation error ("not yet implemented — R3b").

---

## 7. Sources and uses [R1]

- **Uses:** every cost line in the monthly ledger (acquisition, construction, professional, statutory, selling costs, lender fees, interest whether capitalised or serviced).
- **Sources:** equity contributions, senior principal draws, capitalised fees & rolled-up interest (self-funding within the gross facility), receipts applied directly to same-month uses (selling costs and exit fee netted from proceeds), and other committed funding.
- **Invariant (tested to the penny, monthly and cumulative):** Σ sources = Σ uses. Finance costs are explicitly funded (rolled-up: by the gross facility; serviced: by equity). An unfundable residual appears as `funding_gap` — visible, never plugged.

## 8. Worked reconciliation example (normative golden case)

Terms: committed net facility £500,000; committed gross £550,000; day-one advance £300,000; rate 12% p.a. (1%/month); arrangement fee 2% of net (£10,000, capitalised month 0); exit fee 1% of committed gross (£5,500, at redemption); rolled-up interest; committed cash equity £300,000; equity-first. Uses: month 0 acquisition £400,000; month 1 construction £150,000; month 2 construction £100,000. Sale: month 3, gross £800,000, selling costs £16,000.

| m | Opening | Draw | Cap fees | Interest (1%) | Repayment | Closing | Equity flow |
|--:|--:|--:|--:|--:|--:|--:|--:|
| 0 | 0 | 300,000.00 | 10,000.00 | 3,100.00 | 0 | 313,100.00 | −100,000.00 |
| 1 | 313,100.00 | 0 | 0 | 3,131.00 | 0 | 316,231.00 | −150,000.00 |
| 2 | 316,231.00 | 50,000.00 | 0 | 3,662.31 → 3,662.31* | 0 | 369,893.31 | −50,000.00 |
| 3 | 369,893.31 | 0 | 0 | 3,698.93 | 373,592.24 + 5,500.00 exit fee | 0.00 | +404,907.76 |

\* pence rounding shown at full precision here for readability; the engine stores integer pence (£3,662.31 → 366,231p etc.) and golden fixtures pin the exact pence.

- Peak gross debt = £373,592.24 (month 3, pre-repayment). Total interest = £13,592.24. Finance costs = 13,592.24 + 10,000 + 5,500 = £29,092.24.
- TDC = 650,000 + 16,000 + 29,092.24 = £695,092.24. Profit = 800,000 − 695,092.24 = £104,907.76.
- **Identity check:** Σ equity flows = −100,000 − 150,000 − 50,000 + 404,907.76 = **+£104,907.76 = profit** ✓.
- **Sources = uses:** equity 300,000 + gross debt funded 373,592.24 + proceeds applied to exit fee & selling costs 21,500 = £695,092.24 = TDC ✓.
- Gross LTC = 373,592.24 / 695,092.24 = 53.75%. LTGDV (developer) = 373,592.24 / 800,000 = 46.70%. Day-one LTV (price £400,000 all-in for simplicity here) = 300,000 / 400,000 = 75%. Net LTC = 360,000 / 650,000 = 55.38%.

## 9. Zero-debt and negative-profit behaviour (summary table)

| Metric | Zero debt (cash) | Negative profit |
|---|---|---|
| Finance costs | exactly 0 | n/a |
| Day-one LTV, LTC, LTGDV, utilisation | 0% / `null` where denominator is debt-dependent | unchanged |
| Peak debt, headroom | 0 / full facility n/a (`null` if no facility) | unchanged |
| Profit, PoC, PoGDV | computed normally | negative, never clamped; red flag |
| Equity multiple | receipts ÷ full cost equity | < 1.0 |
| IRR | from equity flows as usual | negative or `null` (no convergence) |
| Interest reserve | n/a (`null`) | unchanged |

## 10. Legacy (v1) snapshot migration semantics

- v1 `finance.ltv_pct` → `legacy_leverage_pct` with `requires_confirmation: true`; a **proposed** `committed_net_facility_pence = round(v1 cost-before-finance × ltv_pct/100)` is written with `evidence_status: 'unconfirmed'`.
- `day_one_advance_pence` → `null` (unknown); equity → one `cash` source with `fund_as_required` semantics, `unconfirmed`.
- The appraisal is marked `legacy_unreconciled` until a user confirms the facility terms; reports for such appraisals carry the DRAFT watermark.
- Nothing in migration ever becomes an "approved" lender metric silently. Old stored outputs are discarded and recomputed under `calc_version 2`; the differences are surfaced, not hidden.

## 11. Prohibited calculations (removed in R1)

1. Loan sized as `ltv_pct ×` cost before finance.
2. Flat full-term interest on the nominal loan.
3. Interest accrued on cumulative project expenditure.
4. "Day-one LTV" = total facility ÷ purchase price.
5. "Senior debt impairment" = GDV vs TDC comparison.
6. Sale income booked for retained exits.
7. Synthetic IRR from `[−equity, 0, …, profit+equity]`.
8. Debt re-sized inside scenario/downside calculations.
9. Any report/export/page recomputing a formula instead of consuming the engine result.
10. The Deal Spider's 15% construction-VAT saving presented as anything other than an unconfirmed illustration; it never enters the appraisal, TDC or lender metrics.
