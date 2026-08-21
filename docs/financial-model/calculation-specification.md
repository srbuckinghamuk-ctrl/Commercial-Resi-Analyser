# Calculation Specification — Commercial-to-Residential Development Appraisal

**Status:** Authoritative. Calculation version `2.10.0`.
**Date:** 21 August 2026
**Scope:** Defines every financial quantity the application computes, stores or reports. Any output not derivable from this specification must not be displayed to a user or exported. The monthly engine described here is the single source of truth; no UI page, report, export or backend endpoint may re-implement a formula defined here.

**Changelog:**
- **2.10.0** — VAT and TOGC (§17, R11), with inputs v8 carrying a `vat` block: registration, a return cycle (monthly or quarterly, with a repayment lag), six fixed per-category treatment rows (rate, recoverable proportion, recovery basis, evidence status) resolved through one accessor, and a purchase/TOGC block that decides whether acquisition VAT is chargeable and whether the acquisition tax base is VAT-inclusive. **No existing computed value changed** — migration writes `registered: false`, six zeroed treatment rows and an inert purchase block, which drives every resolved rate to zero and the chargeable consideration back to the exclusive price, so all twelve-plus golden fixtures (now thirteen, with the VAT worked cycle pinned as fixture R) reproduce every reported metric to the penny, and the gate is numeric **and** structural for the same reason §16.3's was (§17.11). §3.8 gains `irrecoverable_vat_pence` as a cost-before-finance component; §7 gains the VAT reclaim as a third flow excluded from both sides of the sources-and-uses identity, alongside sale-proceeds repayments and refinance-shortfall equity; §16.3's contingency base is now the package tag, mode-dependently, with the input fields `basis`/`package_ids` deleted (the *result* shape is unchanged); §16.9 loses the `contingency_class`-not-live limitation (now resolved) and the "No VAT" limitation (now superseded by §17.13's own list, which is where a VAT limitation belongs from this release on).
- **2.9.0** — cost plan modes (§16, R10), with inputs v7 carrying a `cost_plan` block: a `headline` mode (rate × area, unchanged) and a mutually exclusive `detailed` mode (a priced package schedule), three named contingency classes each rounding independently against its own resolved base, and professional/statutory fee lines carrying a fixed or percentage basis. **No existing computed value changed** — migration copies `contingency_pct` into the `general` class on the `all_packages` basis and the eight legacy fee fields into `fixed` fee lines, and both engines route every document, pre- and post-migration, through the same `cost_plan` engine, so "all twelve golden fixtures identical to the penny" is an assertion that could fail rather than one that is structurally blind (§16, following R9's precedent). §3.4's contingency term is replaced with the three-class formula; §3.5/§3.6 are replaced with the fee-line formulation and its two base definitions; §1.6 records inputs v7. §13.2 gains a stated limitation: a stored appraisal not yet re-saved across this boundary prints an `inputs_version` beside an `audit_hash` computed under the prior version, so the hash cannot be recomputed from the printed fields for that row.
- **2.8.0** — the area bridge (§15, R9), with inputs v6 carrying an entered `areas` block and per-unit `ancillary`. The scheme now has one area statement that ties, and the construction-cost area is **derived** from it rather than asserted independently: §15.3's basis switch chooses between the derived developed GIA and the pre-R9 manual field, and §15.4 makes reading that field outside one accessor a build failure. Ancillary parking, balconies and terraces are valued as a separate GDV component (§3.1, §15.5) that sells with its unit and moves with a §12.1 GDV stress. **No existing computed value changed** — migration writes the manual basis with a zeroed bridge and zeroed ancillary, which is a tested claim, not an assertion (see `migration-notes.md`). §3.1's formula and Included lines are corrected to state GDV as internal plus ancillary value, and the unpaid R3 pointer that excluded parking "until valued separately" is removed rather than repointed; §3.2's `global_per_sqft` lender basis is bound explicitly to internal net internal area; §2 gains four derived-area definitions. §15.6's rules replace the ±25% unit-NIA-vs-construction-area warning, which is deleted rather than retuned. R9 also clears an R8 carry-forward: acquisition-date validation is now a real calendar check in both engines, so `2026-02-31` no longer validates (§14).
- **2.7.0** — jurisdiction-aware acquisition tax: SDLT (England/NI), LBTT (Scotland) and LTT (Wales) computed from a dated, sourced and versioned band table (§14, R8), with inputs v5 carrying the jurisdiction, its evidence status, the acquisition date and a reasoned override. **No existing computed value changed** — §1.6 explains why. §3.3's formula term is renamed from `SDLT` to `acquisition_tax` and its false "other jurisdictions are out of scope" sentence is deleted; §3.18 records that the RLV is invariant to it; §13.1 gains the table version and applied jurisdiction; §13.3 gains a fourth draft condition. What does change in practice is that every pre-R8 document is marked DRAFT until **both** its jurisdiction is confirmed **and** an acquisition date is recorded — migration leaves the date null, so confirming the jurisdiction alone is not enough (§14.6).
- **2.4.0** — fixed-facility sensitivity suite: the two-way matrix, the tornado, and their shared lever and validation rules (§12, R4). No existing computed value changed — §12 only composes calls to the existing appraisal engine over levered copies of an inputs document, it does not alter any formula — which is why this is a minor bump, not a major one.
- **2.3.0** — phased-sales sweep (§4.4.1), refinance event (§4.5), §5.11 phased regime, declining redemption schedule, `facility_redrawn_after_redemption` flag (R3b); no numeric change for inputs with null `sales_phasing`/`refinance`. Also corrects §3.12's refinance-profit wording to match §3.11 and the engine (a refinance is a financing event and does not enter profit) — a **specification** correction only, no computed value changed.
- **2.2.0** — dated programme + spend curves (R3a); flags moved onto the result object; no numeric change for migrated v3 inputs.
- **2.1.0** — new optional `lender_valuation` input block and `finance.enforcement_cost_assumption_pence` field (§2); no existing formula's computed value changed.

Implementation release markers: **[R1]** implemented in Release 1 (P0 financial correction); **[R2]** defined now, implemented later; **[R3a]** Release 3 programme engine (calc 2.2.0, implemented); **[R3b]** Release 3 phased exits (calc 2.3.0, implemented); **[R4]** Release 4a sensitivity engine (calc 2.4.0, implemented in both engines); Release 4b added the Sensitivity page that consumes it, so §12 now has a user-visible surface. A metric whose marker means "defined now, implemented later" — R2, or a bare R3 — must be displayed as "not available" (never a substitute formula) until implemented; markers recording work already shipped (R1, R3a, R3b, R4, R5, R6, R7, R8, R9, R10, R11) carry no such restriction.

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

Every appraisal document carries `calc_version` (semver of this specification's implementation) and `inputs_version` (schema version of the input document): `1` = legacy pre-spec snapshot; `2` = this specification (calc 1.0); `3` = calc 2.x (adds optional `lender_valuation` block); `4` = calc 2.2.0+ (adds optional `programme`, `sales_phasing`, `refinance` blocks); `5` = calc 2.7.0+ (adds jurisdiction, acquisition date and acquisition tax override); `6` = calc 2.8.0+ (adds the entered `areas` block and per-unit `ancillary`, §15); `7` = calc 2.9.0+ (adds the `cost_plan` block: mode, package schedule, three contingency classes, fee lines, §16). Outputs are only comparable within a `calc_version`. Calc 2.6.0 (R7) adds §3.16.1's realisation basis and §13's report provenance; it moves `equity_multiple` from `0` to `null` for schedules with no realisation event and changes no other computed value.

Calc 2.7.0 (R8) adds §14's jurisdiction-aware acquisition tax. **It changes no existing computed value.** Every document that existed before it was implicitly an England/NI one, the migration to inputs v5 stamps exactly that, and the England/NI non-residential bands have not moved since 17 March 2016 — so every stored appraisal reproduces its figures to the penny. What 2.7.0 changes is what a *non*-English appraisal computes (previously wrong) and what every report *says* about its own tax basis (§14.6).

Calc 2.9.0 (R10) adds §16's cost plan modes, inputs v7. **It changes no existing computed value** — every pre-v7 document is implicitly `headline` mode with its `general` contingency class carrying the old `contingency_pct` and its eight fee fields carried as `fixed` fee lines (§16.7), and both engines compute every document's cost stack, migrated or not, through the same `cost_plan` engine, so the identity is a tested claim rather than a code path only new documents reach. What 2.9.0 changes is what a *detailed*-mode document computes (previously not expressible at all) and what a report can honestly call the construction cost section once one is entered (§16.6). Every `inputs_version` boundary bump carries the same disclosure obligation §13.2 now states explicitly: a stored appraisal not re-saved since the bump prints a version beside a hash computed under the prior one.

---

## 2. Input basis definitions

| Term | Definition |
|---|---|
| **Committed cash equity** | Sum of equity sources classified `cash` with evidence status other than `rejected`. |
| **Committed net facility** | `committed_net_facility_pence`: lender-committed principal available for acquisition/development draws and capitalised non-interest fees. |
| **Committed gross facility** | `committed_gross_facility_pence` if provided; otherwise `committed_net_facility_pence + interest_reserve_pence`. Caps the closing senior balance including rolled-up interest. |
| **Eligible development costs** | Construction, professional and statutory costs (not acquisition, not selling costs, not finance costs) — the base against which `development_cost_advance_pct` caps monthly senior draws. |
| **Legacy leverage** | A migrated v1 `ltv_pct`. It is stored as `legacy_leverage_pct` with `requires_confirmation: true` and is used only to propose an unconfirmed committed net facility during migration (§10). It is never presented as an approved lender metric. |
| **Lender valuation** | Optional `lender_valuation` block (`inputs_version 3`) recording a lender-adjusted GDV (§3.2): `basis` — one of `global_pct` (% adjustment applied to every unit's developer value, e.g. `-10`), `global_per_sqft` (pence per sq ft applied to every unit's **internal net internal area** (`floor_area_sqm`), never its ancillary areas, replacing its developer value — [R9 — calc 2.8.0]: balconies, terraces and parking sit outside NIA (§15.5), so a lender rate per square foot of accommodation must not be levied on them), `unit_type` (`per_key_values` maps unit type → % adjustment), `per_unit` (`per_key_values` maps unit id → lender value pence), `fixed_amount` (`global_value` is the total lender GDV in pence, replacing the summed value). Required provenance `reason`, `author`, `date` (ISO `yyyy-mm-dd`) travel with the block and are displayed with any variance it produces. `null`/absent = no lender valuation recorded. |
| **Enforcement cost assumption** | `finance.enforcement_cost_assumption_pence`: integer pence, `>= 0`, default `0`. A disclosed assumption for the lender's cost of enforcement, used in senior repayment break-even (§5.11) and reported as an assumption wherever that metric is shown. |
| **Tranche gross-receipts share** | `sales_phasing.tranches[].pct_of_gross_receipts`: percentage of the sold portion's gross receipts allocated to that tranche (§4.4.1). `null` `sales_phasing` = a single 100% tranche in the final month. |
| **Refinance investment value** | `refinance.investment_value_pence`: explicit lender/valuer investment value of the retained portion at the refinance date (§4.5). Never derived from rents or yields. |
| **Developed area** | `areas.developed_gia_sqm`, derived: proposed GIA less retained-commercial GIA less untouched GIA (§15.2). The gross internal area actually being developed — the area the construction cost is incurred on when `areas.basis` is `bridge_derived` (§15.3). Never entered directly; entering it would be the second place the same fact lived. [R9 — calc 2.8.0] |
| **Available for units** | `areas.available_for_units_sqm`, derived: developed area less circulation/common, plant/riser, store/bin/cycle and internal amenity area (§15.2). The internal area that can become saleable unit NIA. [R9 — calc 2.8.0] |
| **Unallocated balance** | `areas.unallocated_sqm`, derived: available-for-units less Σ `unit.floor_area_sqm`. Reported rather than hidden, and **signed**: positive means the schedule does not yet fill the building, negative means the units over-fill it (a hard error, §15.6). Frequently and legitimately non-zero at appraisal stage, so a positive balance never gates the document. [R9 — calc 2.8.0] |
| **Ancillary value** | Σ (`unit.ancillary.parking_value_pence` + `unit.ancillary.balcony_terrace_value_pence`) over all proposed units. Part of GDV, reported as a separate component (§3.1, §15.5), and sold with its unit — never a scheme-level disposal of its own (§15.9). A pre-v6 unit carries no `ancillary` block, so its ancillary value is 0. [R9 — calc 2.8.0] |

---

## 3. Cost and value metrics

Each metric states: numerator / denominator (for ratios), included costs, excluded costs, timing basis, gross/net treatment, assumptions, rounding, and behaviour under zero debt and negative profit.

### 3.1 Developer GDV [R1]

- **Formula:** `gdv_internal + gdv_ancillary`, where `gdv_internal` = Σ `unit.estimated_value_pence` over all proposed units (developer values) and `gdv_ancillary` = Σ (`unit.ancillary.parking_value_pence` + `unit.ancillary.balcony_terrace_value_pence`). Both components are reported, and their sum is the GDV every downstream metric uses (`calculateGdvBreakdown` / `calculate_gdv_breakdown` → `total_pence`). [R9 — calc 2.8.0. Before it this line read “Σ `unit.estimated_value_pence` over all proposed units”, which contradicted the Included line beneath it the moment ancillary value entered GDV. A pre-v6 unit carries no `ancillary` block at all, so `gdv_ancillary` is 0 for it and the figure is unchanged — §15.5.]
- **Included:** internal saleable unit values, plus ancillary value (parking, balconies and terraces) reported as a separate component. **Excluded:** retained-commercial value, rental income. [R9 — calc 2.8.0. Before it, this line excluded parking and external space "until valued separately in R3". R3 shipped without it and the pointer stood unpaid through R8; the exclusion is now removed rather than repointed, because the values are modelled.]
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

- **Formula:** `purchase_price + acquisition_tax + legal_fees + survey_cost + round(purchase_price × broker_fee_pct/100) + other_acquisition_costs`.
- **Acquisition tax:** SDLT in England and Northern Ireland, LBTT in Scotland, LTT in Wales, on the non-residential band set in force at the acquisition date, charged on `chargeable_consideration_pence` (§17.7) rather than on `purchase_price` directly wherever the two diverge. **See §14** for the band tables, the selection rule, the override and the stated limitations. [R8 — calc 2.7.0. Before it, this line read "SDLT … England/NI slice bands" and stated that other jurisdictions were out of scope and were to be flagged as an assumption in reports. That is no longer true and the sentence has been removed rather than softened: the engine now computes the correct regime, and a report that still flagged Scotland or Wales as unmodelled would be making a false statement about the figures beside it.] [R11 — calc 2.10.0. `chargeable_consideration_pence` equals `purchase_price` unless the vendor has opted to tax and TOGC does not apply, in which case it is the VAT-inclusive figure — see §17.7 for the accessor, its six call sites and the single-accessor guard.]
- **One figure, two call sites.** The acquisition tax that enters this formula and the `metrics.acquisition_tax_pence` a report prints are the same computation on the same inputs. They are separately implemented (the cost stack and the metrics derivation) and are held together by an explicit cross-site agreement test in both engines; a run in which they differ is an engine defect.
- **Timing:** month 0 in full.
- **Gross/net:** VAT on the purchase price is disclosed by `chargeable_consideration_pence` and the acquisition tax itself where chargeable (§17.7); it is otherwise nil. [R11 — calc 2.10.0. Before it this line read "VAT on purchase is not modelled in R1; reports must carry the assumption 'purchase price treated as VAT-exempt/TOGC — unconfirmed'" — true of every release from R1 through R10. §17 models both facts (chargeability and recovery, kept as separate questions) and the migrated default (`vendor_opted_to_tax: false`) keeps every existing document's consideration identical to its price, so no fixture moves.]
- **Rounding:** broker fee rounded half-up; other terms integer inputs.
- **Edge cases:** negative components are hard validation errors.

### 3.4 Construction cost [R1]

- **Formula:** `base_build = Σ packages[].amount_pence` in `detailed` mode, or `round_half_up(construction_cost_per_sqm_pence × developed_area_sqm)` in `headline` mode; `contingency_total = Σ` over the three named classes of `round_half_up(class_base × class.pct/100)` — each class rounds independently, so three classes at 5% on the same base is not one class at 15% (§16.3); `compliance = fire_safety + sound_insulation + part_l` in headline mode, or `0` in detailed mode (§16.2 — priced inside a package instead); `total = base_build + contingency_total + compliance`. [R10 — calc 2.9.0. Before it this line read `base = round_half_up(construction_cost_per_sqm_pence × developed_area_sqm)`; `contingency = round(base × contingency_pct/100)`; `compliance = fire_safety + sound_insulation + part_l`; `total = base + contingency + compliance` — a single blended contingency percentage on an implicit base, which could not separate general design development from existing-building risk from abnormal risk, the three things a conversion lender most wants apart (§16). Headline mode's arithmetic is unchanged to the penny: migration copies `contingency_pct` into the `general` class on the `all_packages` basis and leaves the other two at 0 (§16.7), so `base_build`/`contingency_total`/`compliance` reproduce the pre-R10 `base`/`contingency`/`compliance` exactly.] [R9 — calc 2.8.0. Before it this line read `construction_cost_per_sqm_pence × total_construction_sqm`. The **area** is now resolved through the single accessor `developed_area_sqm(inputs)` (§15.3/§15.4), which returns the derived developed GIA on the `bridge_derived` basis and `total_construction_sqm` verbatim on the `manual` basis — so a migrated document's figure is unchanged to the penny. Reading `total_construction_sqm` anywhere else is a build failure.]
- **Contingency base:** each of the three classes carries its **own** named, resolved base — `all_packages` (the whole base build) or `selected_packages` (a named subset) — and that base is displayed beside the class, not asserted in prose (§16.3). [R10 — calc 2.9.0. Before it this line read "the headline base build only — explicitly excludes compliance allowances, professional fees and acquisition. This base is displayed wherever contingency appears", true of the single blended percentage that no longer exists. Every class's base still excludes compliance, fees and acquisition — only the base build itself can be named, on either basis.]
- **Timing:** spread per the spend profile (§6). R1 default: straight-line over the construction window, disclosed as an assumption.
- **Gross/net:** entered figures are treated as net of recoverable VAT; recovery is now modelled (§17), so **irrecoverable** VAT on construction is not folded into this line — it is its own line, `irrecoverable_vat_pence` (§3.8, §17.5), added to cost-before-finance rather than to construction cost, because the engine runs strictly downstream of the cost plan and no cost line may read a VAT figure without creating a cycle. [R10 — calc 2.9.0. Before it this line named R3 as the release that would model VAT. R3 shipped without it (calc 2.2.0/2.3.0's changelog entries cover only the dated programme and phased-sales/refinance work), and the pointer went unpaid through R4–R9; it was corrected to point at R11 rather than left pointing at a release that had already shipped without it, the same "unpaid pointer" fault R9 fixed for the parking/balcony GDV exclusion (§3.1).] [R11 — calc 2.10.0. R11 has now shipped and the forward pointer is discharged: this line no longer names a future release, and construction's own VAT treatment is entered per-category in `vat.treatments` (§17.1), not disclosed as an unconfirmed assumption.]
- **Edge cases:** negative rate/area/package amount/contingency `pct` are hard errors; a `detailed`-mode document carrying any non-zero flat compliance field is also a hard error, §16.2. [R9 — calc 2.8.0. This line also said “`total_construction_sqm` differing from Σ unit areas by >25% raises a warning (unreconciled areas)”. **That warning is deleted, not retuned.** It compared two quantities that *should* differ — by exactly the circulation, plant, storage and amenity the model had nowhere to record — so it fired on correct schemes and stayed silent on wrong ones; the tolerance was a proxy for a reconciliation that did not exist. §15.6's rules replace it, including a narrower manual-basis warning that compares the manual area against the **derived** developed area rather than against unit NIA.]

### 3.5 Professional fees [R1]

- **Formula:** Σ `cost_plan.fees[]` where `category == 'professional'` — each line's `amount_pence` is either its stored fixed figure (`per_dwelling` multiplied by `max(1, unit_count)` where set) or `round_half_up(base × pct/100)` on the line's own basis (§16.4). [R10 — calc 2.9.0. Before it this line read `architect + structural_engineer + mande + planning_consultant + other_professional_fees` — five flat pence fields, fixed amounts only. Migration converts all five into `fixed` fee lines carrying the same figures, so a migrated document's total is unchanged to the penny; what changes is that a fee can now also be entered as a percentage of a named base (§16.4).]
- **Excluded:** statutory costs (§3.6) — note this is a reclassification of the v1 grouping, values unchanged in total. **No fee basis includes fees** (§16.4) — a percentage fee resolves against the base build or the construction total, never against another fee, so no ordering or cycle applies.
- **Timing:** spread per profile; R1 default straight-line over the first half of the construction window (disclosed).
- **Edge cases:** negatives are hard errors.

### 3.6 Statutory costs [R1]

- **Formula:** Σ `cost_plan.fees[]` where `category == 'statutory'`, resolved the same way as §3.5 (fixed, optionally per-dwelling, or percentage of a named base). [R10 — calc 2.9.0. Before it this line read `prior_approval_fee_per_dwelling × max(1, unit_count) + cil_s106 + building_control` — three flat pence fields. Migration converts all three into `fixed` fee lines (`prior_approval` carrying `per_dwelling: true`), so a migrated document's total is unchanged to the penny. `building_control` keeps its category despite sitting in the professional-fee block of the legacy input shape (§16.4) — reclassifying it would move money between two separately-reported, separately-spread totals while leaving every grand total correct, invisible to any totals-based check.]
- **Timing:** month 0 in full for the fee line with `code: 'prior_approval'`; every other statutory line spreads with professional fees in R1 (disclosed simplification; dated programme refines this in R2). [R10 — calc 2.9.0. The timing rule is now keyed on `code`, not on a hard-coded field name, so it survives the move from three flat fields to fee lines unchanged — pinned by a month-0 statutory figure that a totals-only test cannot see moving (§16.8).]
- **Edge cases:** negatives are hard errors.

### 3.7 Selling and exit costs [R1]

- **Formula (per disposal receipt):** `agent_fee = round(gross_receipt × selling_agent_fee_pct/100)`; plus `selling_legal_fee_pence` allocated pro-rata across selling months (final month absorbs the rounding residue so the total is exact).
- **Included in:** monthly cash flow, TDC, profit, profit on cost, IRR, sensitivities — always.
- **Timing:** the month of the receipt they relate to.
- **Gross/net:** deducted from gross receipts before the debt sweep.
- **Zero-debt:** unchanged. **Retained units:** incur **no** selling costs.

### 3.8 Cost before finance [R1]

- **Formula:** acquisition cost + construction cost + professional fees + statutory costs + selling and exit costs + `irrecoverable_vat_pence`. [R11 — calc 2.10.0. `irrecoverable_vat_pence` (§17.5, §17.12) is added as its own component rather than folded into any of the other five: the engine computes VAT strictly downstream of the cost plan (§17.5), so no cost line may read it, and its own line is the only place it can enter TDC without creating a cycle. It is `0` on every document with `vat.registered: false` — the migrated and new-document default — so no existing figure moves.]
- Selling costs are included here (they are a cost of the scheme, not of the debt). A sub-total excluding selling costs ("development cost before disposal and finance") is also reported for LTC-net purposes (§5.3). `irrecoverable_vat_pence` is **not** part of that LTC-net sub-total: VAT is not eligible for the development-cost advance (§17.6), so Net LTC's denominator excludes it while Gross LTC's TDC includes it (§17.13).
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

- **Formula:** `profit = Σ gross sale receipts + retained value − TDC`, where TDC already contains selling and finance costs, and `retained value` is the retained portion's §3.11 **valuation** basis. A modelled refinance (§4.5) does **not** enter this numerator — see the retained-exits clause below.
- **Identity (invariant):** when senior debt is fully repaid **and nothing is retained**, `profit = Σ developer equity cash flows` (contributions negative, distributions positive). With a retained portion the identity holds on a *realised* basis — `Σ gross sale receipts + refinance proceeds − TDC = Σ equity cash flows` — and the headline profit exceeds that by the part of the retained valuation no cash event has monetised.
- **Retained exits:** realised (cash) profit and unrealised (valuation-based) profit are reported separately; the headline "profit" for a `retain_all` or `blended` case carries the retained portion at its §3.11 **valuation** basis, and is always labelled "unrealised — subject to refinance/valuation" while retained value > 0. A modelled refinance (§4.5) does **not** change that. The refinance is a **financing event**: it converts senior development debt into investment debt secured on the retained asset, so adding its proceeds to profit would double-count the retained value already in the numerator. What the event does change is the **timing and composition of equity cash flows** — its realised cash is disclosed through the ledger's distribution rows and flows into §3.15's vector, and hence into §3.16 equity multiple and §3.17 IRR. [R1 labels; R3b models the refinance event's cash flows, §4.5. **Corrected in Release 3b Task 8:** an earlier clause here said the proceeds "enter profit directly" and that the unrealised label drops when a refinance is modelled — wording that predates the modelled event, and that contradicts both §3.11's valuation basis and the engine. Golden fixture J pins the corrected reading.]
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

### 3.16 Equity multiple [R1; realisation basis R7 — calc 2.6.0]

- **Numerator:** Σ distributions. **Denominator:** Σ contributions (absolute).
- **Zero contributions:** `null`. **Negative profit:** multiple < 1.0, reported as-is.
- **No realisation event (§3.16.1):** `null`, not `0`.

### 3.16.1 Realisation basis [R7 — calc 2.6.0]

Distributed-return metrics need something to measure against. Two outputs carry
that condition so no consumer has to re-derive it.

- **`has_realisation_event`** = `schedule.totals.gross_sales_pence > 0` **or**
  `schedule.refinance ≠ null`. It asks whether the model books a realisation
  *event*, not whether cash reached equity.
- **`return_on_equity_is_unrealised`** = `profit_is_unrealised` **or**
  `not has_realisation_event`.

Consequences:

| Case | `has_realisation_event` | `equity_multiple` | Return on equity |
|---|---|---|---|
| Units sold, cash distributed | true | Σ distributions ÷ Σ contributions | realised |
| Units sold, receipts swept entirely to senior debt | true | `0.00` — a real answer | realised |
| Retained, refinanced | true | computed from the refinance flow | unrealised (retained value in profit) |
| Retained, no refinance | **false** | **`null`** | **unrealised** |

- **Why `null` and not `0` in the last row.** §1.5: `null` means unknown, `0`
  means known to be zero. A retain-all case with no exit has no exit to measure,
  so the multiple is unknown; printing `0.00x` beside a positive return on equity
  states that the sponsor's capital was lost, which is a different claim and a
  false one. The distinction survives only because the discriminator is the
  *event*, not the distribution: a sale that returns nothing genuinely is
  `0.00x`, and that row must keep its zero.
- **Reports** must print return on equity as **"Return on Equity (unrealised)"**
  whenever `return_on_equity_is_unrealised`, and must not substitute any figure
  where the multiple or IRR is `null` (§13.4).
- **Rounding/timing:** unchanged from §3.16/§3.17; these are classification
  outputs, not new arithmetic.

### 3.17 IRR — monthly and annual [R1]

- **Basis:** the developer equity cash-flow vector (§3.15). Never synthetic flows.
- **Solver:** Newton–Raphson from 1%/month, up to 1,000 iterations, tolerance 1e-7; on non-convergence, bisection fallback over [-99%, 1000%] per month.
- **No solution:** if all flows are one-signed, or no sign change of NPV exists in the bracket, IRR = `null` and the UI/report shows "IRR not available (no sign change in equity flows)". Multiple-IRR cases report the root nearest zero and are flagged.
- **Annualisation:** `(1 + irr_monthly)^12 − 1`.
- **Retain-all without modelled refinance:** no positive terminal flow exists → IRR is `null` by construction (correct behaviour, replacing the previous synthetic IRR).
- **Retain-all with a modelled refinance [R3b — calc 2.3.0]:** the refinance event (§4.5) produces a real, realised terminal equity flow, so IRR is computed from it like any other equity cash flow. Without a modelled refinance, IRR remains `null` and unlabelled substitutes remain prohibited.

### 3.18 Residual land value (RLV) [R1]

- **Formula:** `RLV = GDV / (1 + target_profit_on_cost_pct/100) − total cost excluding land`, where total cost excluding land = TDC − purchase price − SDLT, and `target_profit_on_cost_pct` is the **configurable** deal-spider target (`deal_spider.target_profit_on_cost_pct`), no longer hard-coded 20%.
- **Disclosed limitation:** finance and SDLT within "cost excluding land" are those of the appraised structure, not re-solved for the residual price (a fixed-point refinement is R3). Reports state this.
- **Invariant to acquisition tax [R8 — calc 2.7.0].** "Cost excluding land" subtracts the acquisition tax back out, so the same figure enters TDC and leaves again and the RLV does not move when the tax does — changing jurisdiction, acquisition date or applying an override (§14.5) leaves the RLV unchanged. This holds only because both tax call sites (§3.3) use the same figure; a mid-R8 defect in which they did not made the RLV appear to respond to an override, and a plan test asserted that wrong behaviour. Both engines now pin the invariance directly.
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
- R1 timing: `sell_all` and the sold portion of `blended` receive all receipts in the final month of the term (single-month disposal, disclosed as an assumption) when `sales_phasing` is null — see §4.4.1 for the phased regime.
- `retain_all` (and the retained portion of `blended`): **no sale receipt, ever**. The ledger ends with the senior balance outstanding at term end; the appraisal reports "Senior debt outstanding at maturity — repayment source (sale/refinance) not modelled." as a red flag when `refinance` is null — see §4.5 for the refinance regime.
- Practical completion never implies disposal or repayment.

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

Equity absorbed by the refinance event (shortfall or negative net proceeds)
funds a facility redemption — a financing-side flow. Like sale-proceeds
repayments, it is excluded from §7's sources-and-uses reconciliation (which
balances project funding against project costs); it still counts toward
additional-equity flags, equity contributed, and the equity cash-flow vector.

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

**Known limitation (calc 2.1.0):** this series is a static snapshot of committed sources against forecast cost, not a re-simulation of the ledger's own month-by-month throttling (gross-facility headroom cap, §4.2(c); the development-cost advance-percentage cap, §4.2; uncommitted "additional equity" silently absorbing a serviced-interest shortfall, §4.3). Neither direction of "no cost-to-complete shortfall ⇔ the ledger never flagged `funding_gap`" is a general property of the engine — a headroom-capped fixture proves a real `funding_gap` can exist with no cost-to-complete shortfall, and a constructed high-rate serviced-interest scenario proves the reverse (a cost-to-complete shortfall with zero `funding_gap`, absorbed instead by uncommitted additional equity). Only "the series reports a shortfall ⇒ the ledger recorded a `funding_gap` somewhere" is asserted as a test, and it is verified across the fixtures in the current test corpus, not proved as a universal law — see `docs/financial-model/test-cases.md`'s cost-to-complete section for the counter-examples and the scope of what is and isn't tested.

**Third counter-example, found by fixture P [R9 — calc 2.8.0].** The remaining direction now has a *natural* counter-example in the corpus, not just a constructed one. Remaining funding above counts the undrawn **net** facility, while remaining cost counts future rolled-up interest — but rolled-up interest never consumes the net facility in §4.2; it capitalises against the **gross** facility's headroom. So a facility structured the way a real development facility is structured — a net facility sized to the costs, with the interest reserve carved out of the gross — systematically reports a phantom shortfall. `fixtures/financial-model/p-scotland-levered.json` reports a 392,483p shortfall at `m = 1` against a ledger whose `funding_gap_pence` is 0, because its 3,913,416p of rolled-up interest capitalised into 8,000,000p of gross headroom exactly as intended. Fixture F did not surface this only because its net facility carries ~16,000,000p of slack. The fixture is not tuned to hide it and the corpus test names it explicitly. **Correcting §5.10 to credit gross-facility headroom for a rolled-up facility is deferred**, because it is a behaviour change to a reported metric and belongs in its own release with its own hand-derived fixtures. The deferral is tracked as **C1** in `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` (owned by R14, which is the cost-to-complete release), and the figures above are **pinned** on fixture P — `cost_to_complete_first_shortfall_month: 1` and `cost_to_complete_max_shortfall_pence: 392483` — so this paragraph cannot drift away from the engine while the correction waits.

### 5.11 Senior repayment break-even [R2 — implemented in calc 2.1.0]

Minimum gross sale price `P` such that `P = redemption_balance_at_disposal + exit_fee + disposal_costs(P) + enforcement_cost_assumption`. Solved iteratively because disposal costs depend on `P`. Reported absolute, as % of lender GDV, and as the % fall from lender GDV before senior exposure. Never computed as "GDV vs TDC" — the pre-R1 "senior debt impairment" figure is removed in R1.

This is the `sales_phasing = null` regime, unchanged. See below for the phased regime.

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
redeem the facility). The replay reserves the exit fee out of every tranche's
sweep before repaying principal: with fee f due on redemption (0 once
charged), a tranche's principal repayment is `max(0, sweep − f)`, and full
redemption occurs when `sweep >= balance + f`. This reservation is a §5.11
modelling assumption only — the ledger itself (§4.4) does not reserve; it
makes the replay's residual balance continuous and decreasing in G, so
feasibility is monotone and the shared integer bisection is exact. The
reserve delays principal repayment by at most f per tranche, so the phased
break-even is conservatively (slightly) overstated relative to the ledger's
own clamp behaviour.

Structurally unsolvable cases return null with the red flag
`senior_breakeven_unsolvable` (message stating the reason), not the
cap-exhausted flag: facility draws after the final tranche month (no sale
price can redeem), or `sales_sweep_pct = 0`.

### 5.12 Developer profit break-even [R2 — implemented in calc 2.1.0]

Minimum gross sale price giving zero developer profit: `TDC` restated at the break-even receipts (selling costs re-solved). Distinct metric from §5.11, never conflated.

---

## 6. Spend profiles [R1 minimal]

R1 supports `straight_line` over a window (construction: months 1..N−2 of the term, minimum 1 month; professional/statutory: first half of that window) — the v1 shape, now explicitly disclosed as an assumption on the cash-flow page and in reports. **Odd windows round up:** where an auto-derived window spans an odd number of months, its "first half" is `ceil(D/2)` months, `D` being the construction window's length — so a 7-month construction window gives a 4-month professional/statutory window, not 3. Rounding: each month rounds half-up; the final month of a window absorbs the cumulative rounding residue so the spread sums exactly to the total (invariant). The complete set of spend curves is defined in §6.1 (calc 2.2.0, [R3a]): `straight_line`, `s_curve`, `back_loaded`, and `user_defined`. An `upfront` curve was planned but removed before implementation — it is expressible via a 1-month window or user_defined weights concentrated in month 1.

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
weight rules above. `sales_phasing` and `refinance` are implemented from calc
2.3.0 (§4.4.1, §4.5).

---

## 7. Sources and uses [R1]

- **Uses:** every cost line in the monthly ledger (acquisition, construction, professional, statutory, selling costs, lender fees, interest whether capitalised or serviced).
- **Sources:** equity contributions, senior principal draws, capitalised fees & rolled-up interest (self-funding within the gross facility), receipts applied directly to same-month uses (selling costs and exit fee netted from proceeds), and other committed funding.
- **Invariant (tested to the penny, monthly and cumulative):** Σ sources = Σ uses. Finance costs are explicitly funded (rolled-up: by the gross facility; serviced: by equity). An unfundable residual appears as `funding_gap` — visible, never plugged.
- **Refinance-shortfall equity excluded [R3b — calc 2.3.0]:** additional equity injected by the §4.5 refinance event's shortfall or negative-net-proceeds branches funds a facility redemption, not a project cost, so it is excluded from both sides of this identity — like sale-proceeds repayments, which are similarly omitted rather than appearing as a matched source/use pair.
- **The VAT reclaim excluded [R11 — calc 2.10.0]:** `reconcile()` needs no structural change for VAT. The outflow enters `uses_total_pence` and is funded through the existing per-month loop by draws, equity or a visible gap, exactly like any other cost. The reclaim (`vat_reclaim_pence`, §17.6) **repays** — 100% to senior debt where a facility exists, otherwise to distribution — and is the **third** flow, alongside sale-proceeds repayments and refinance-shortfall equity above, that appears on **neither** side of the identity. Over the term, sources therefore fund the **gross** VAT outflow even though most of it returns, which is correct and is the same treatment sale proceeds already receive.

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
8. Debt re-sized inside scenario/downside calculations (see §12.2, which states the
   same rule constructively for the sensitivity suite).
9. Any report/export/page recomputing a formula instead of consuming the engine result.
10. The Deal Spider's 15% construction-VAT saving presented as anything other than an unconfirmed illustration; it never enters the appraisal, TDC or lender metrics.

---

## 12. Sensitivity analysis [R4 — calc 2.4.0]

This section is the normative home for both the fixed-facility sensitivity suite and
the three named scenarios (`base`, `upside`, `downside`), which share its lever rule.

### 12.1 Levers

A **lever** is one named adjustment applied to an inputs document. There are four:

| Lever | Unit | Effect on the inputs document |
|---|---|---|
| `gdv` | percent | scales every `unit_mix.units[].estimated_value_pence` |
| `construction_cost` | percent | scales `conversion_costs.construction_cost_per_sqm_pence` |
| `timeline` | months | adds to `finance.term_months` |
| `interest_rate` | percentage points | adds to `finance.annual_interest_rate_pct` |

A percent lever of `p` multiplies its target by `(1 + p/100)` and rounds half-up to
integer pence (§1.1). A months or percentage-point lever adds its value directly.

The four levers write to **disjoint input fields**, so applying several to one document
is order-independent. Any lever added in a later release that shares a field with an
existing lever must define its composition order in this section at the same time.

### 12.2 The facility is invariant

In every sensitivity cell and every tornado endpoint,
`finance.committed_net_facility_pence`, `finance.committed_gross_facility_pence`,
`finance.day_one_advance_pence` and `equity_sources` are held at their base-document
values. No lever may write to them, directly or indirectly.

This is §11.8 ("debt re-sized inside scenario/downside calculations" — prohibited)
stated as a construction rule rather than only as a prohibition. A cell whose adjusted
assumptions would require more debt than the committed facility does not receive more
debt: it raises `facility_exceeded` and/or `funding_gap`, and that flag is the finding.
The suite measures a committed structure against adverse assumptions; it does not
re-underwrite the deal at every grid point.

### 12.3 The two-way matrix

The matrix has a row axis and a column axis. Each axis names one lever and a list of
steps in that lever's unit. The two axes must name different levers. Each cell is the
appraisal that results from applying the row lever at its step and the column lever at
its step to the base document, per §12.1. A cell whose levered document fails validation is not measured — see §12.7.

The **normative default grid** is:

- rows: `construction_cost` at `[-5, 0, +5, +10, +15]` percent
- columns: `gdv` at `[-15, -10, -5, 0, +5]` percent

### 12.4 The tornado

Each tornado bar names one lever and a low and a high value in that lever's unit. The
bar's endpoints are the appraisals resulting from applying that lever alone at its low
and at its high. A bar's **span** is `|profit(high) − profit(low)|` in pence.

The **normative default ranges** are: `gdv` ±10 percent, `construction_cost` ±10
percent, `timeline` ±3 months, `interest_rate` ±1.0 percentage points.

Bars are ordered by span descending. Ties are broken by the fixed lever order
`gdv`, `construction_cost`, `timeline`, `interest_rate`. This makes the ordering total
and therefore deterministic (§1.4).

### 12.5 The base case is a cell

The measurement taken with every lever at zero must equal the unadjusted appraisal of
the base document exactly, in every reported quantity. Where the default grid is used,
this is the `(construction_cost = 0, gdv = 0)` cell.

### 12.6 Validation

The following are input errors, not flags:

- an axis or a tornado bar naming a lever that is not one of the four §12.1 levers;
- an axis with an empty step list, or any non-finite step;
- an axis with more than nine steps (the suite is bounded at 81 cells);
- a row axis and a column axis naming the same lever;
- a lever appearing more than once among the tornado bars;
- a tornado bar whose low is not strictly less than its high, or either non-finite;
- a step, or a tornado bound, for the `timeline` lever that is not a whole number of months.

The engine is month-indexed throughout (§1.3), so a fractional term has no meaning in the ledger; the `timeline` lever is therefore constrained to whole months at the point of input rather than rounded later.

### 12.7 Cell validity [R5 — calc 2.5.0]

A **measurement** is produced only for a levered document that passes validation. Before
measuring, the levered document is validated (`validateInputs`/`validate_inputs`) — the
whole-document input check used ahead of an ordinary appraisal, distinct from §12.6's
sensitivity-config check. If validation yields any **error**-severity issue, the position
is **not measured**: it reports those issues and every metric field is null.

Warning-severity issues do not invalidate a position.

**Reconciliation status is not a validity signal.** A position raising `facility_exceeded`,
`funding_gap` or `senior_outstanding_at_maturity` is a valid measurement, and those flags
are the finding (§12.2).

This applies identically to matrix cells and tornado endpoints. A tornado bar with an
unmeasured endpoint has no span; §12.4's ordering places bars with no span after all bars
with a span, in the fixed lever order.

If the **base** document yields an error-severity issue, the suite raises an input error
(§12.6) rather than returning a grid: §12.5 makes the base case an identity with the
unadjusted appraisal, so no position in the suite is meaningful.

This refusal is a distinct, identifiable condition — an invalid **base document** — and
is reported separately from §12.6's invalid **configuration**. A consumer distinguishes
the two by the error the suite raises (`InvalidBaseDocumentError`,
`InvalidSensitivityConfigError`), never by its message text. [R6]

An unmeasured position is never appraised: the suite validates the levered document and
does not run the ledger for it at all.

---

## 13. Report provenance and document governance [R7 — calc 2.6.0]

A generated report is a claim about a calculation. §13 defines what the document
must say about itself, and what it must be true of before it may drop its draft
marking. None of it changes a computed value; all of it is normative for every
export path.

### 13.1 The provenance panel

Every generated appraisal report prints, before any figure, a panel carrying:

| Field | Source | Absent value |
|---|---|---|
| Appraisal ID | stored record | "unsaved — generated from an in-session run" |
| Project ID | stored record, else `inputs.project_id` | "not recorded" |
| Scenario ID and name | the scenario the printed figures are on | — (always present; default `base` / "Base Case") |
| Input schema version | `inputs.inputs_version` | — |
| Calculation version | `metrics.calc_version` of the printed run | — |
| Tax table version | `metrics.acquisition_tax.table_version` (§14.2) | — |
| Applied tax jurisdiction | `metrics.acquisition_tax.jurisdiction` and its regime (§14.3) | — |
| Authoritative result hash | stored `outputs_hash` | "not recorded — result predates provenance hashing" |
| Input hash | stored `input_hash` | as above |
| Audit hash | stored `audit_hash` (§13.2) | as above |
| Generation timestamp | injected clock, with IANA zone and UTC offset | — |
| Report-safe status | `reconciliation.report_safe` | — |
| Document status | §13.3 | — |
| Lender-case approval status | lender case, when one exists | "No lender case — not submitted for credit approval" |

- **The audit hash picks up the two R8 fields transitively, and gains no new parts
  [R8 — calc 2.7.0].** §13.2's formula is unchanged. It hashes `input_hash` and
  `outputs_hash`, which already commit to the *whole* input and output documents —
  and the jurisdiction lives in the input document while the table version and the
  applied regime live in the output document. Both are therefore already bound by
  the audit hash, and adding them as further named components would rewrite every
  stored hash while binding nothing that was not bound before. The R8 design
  document reads as though they are added directly; they are not, and must not be.
- **Hashes are the server's, never the client's.** They describe what the server
  computed and stored. A client-side re-derivation would hash the client's own
  arithmetic, which is the confusion the hashes exist to prevent.
- **Recomputation is disclosed.** When the run being printed was computed under a
  different `calc_version` from the stored result, the report says so and states
  that the printed hashes describe the stored result rather than the printed
  figures. It does not silently reuse them.

### 13.2 Audit hash

```
audit_hash = sha256( project_id | calc_version | inputs_version | status | input_hash | outputs_hash )
```

joined by the literal `|`, over UTF-8, lower-case hex.

- **Why a hash of hashes.** `input_hash` and `outputs_hash` already commit to the
  full documents, so re-deriving from them keeps the value cheap to recompute and
  makes the binding explicit: a reviewer holding a printed provenance panel can
  recompute the audit hash from the six fields beside it and detect that any one
  of them was altered after the fact.
- **Record identity is `project_id`**, not the appraisal row's own id: migration
  004 made the appraisal unique per project, so the project is the stable
  identity, and it is known before the row exists — which lets the value be
  computed in the same place as the other two hashes.
- **Status is inside the hash.** Two records whose inputs and outputs hash
  identically but whose governance status differs must not share an audit hash;
  the status is what a reader relies on when deciding whether the printed figures
  may be relied upon at all.
- **Absent rows.** Records saved before this release carry `null` and the report
  prints "not recorded". They are not backfilled: a row that has not been
  recalculated is a pre-provenance result, and stamping it would assert a binding
  no run produced.
- **Stated limitation: a boundary bump breaks recomputability for an unsaved
  row, and this is inherent, not a defect.** [R10 — calc 2.9.0.] The "a reviewer
  can recompute the audit hash from the six printed fields" claim above assumes
  the printed `inputs_version` is the one `audit_hash` was actually computed
  over. It is not, for a row whose `inputs_version` moved server-side (e.g. R10's
  v6 → v7 persistence boundary, §16.7) but which has not been re-saved since: the
  memo prints the client's current `inputs_version` beside a stored `audit_hash`
  computed under the version the row was last saved at, and the six-field
  recomputation does not reproduce it. This holds for **every** `inputs_version`
  boundary a stored row crosses without a re-save, not only R10's — it is a
  structural consequence of hashing a version number that can move independently
  of the row, and no migration release closes it, because the next boundary bump
  reopens it. Disclosed here rather than left for a lender to trip over; not
  fixed, because fixing it would mean either hashing a version the row was never
  actually computed under (false binding) or re-hashing every stored row on every
  migration release (defeats the point of a hash — see "Absent rows" above).

### 13.3 Document status and draft marking

A document is **FINAL** only when all four hold, tested in this order:

1. `reconciliation.report_safe` — hard validations pass.
2. `reconciliation.senior_repaid` — the ledger clears the senior facility within
   the modelled term.
3. `jurisdiction_evidence_status == 'confirmed'` **and**
   `metrics.acquisition_tax.date_basis == 'transaction_date'` — the tax basis
   has been verified: the jurisdiction is evidenced *and* the band set was
   selected by the transaction's own date rather than assumed to be the
   current one (§14.6). [R8 — calc 2.7.0]
4. An approved lender case: status `credit_approved` or `approved_with_conditions`.

Otherwise the document is **DRAFT** and carries the banner for the **first**
failing condition:

| Failing condition | Banner |
|---|---|
| not report-safe | `DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE` |
| senior not repaid | `DRAFT - SENIOR DEBT NOT REPAID - NOT FOR LENDER RELIANCE` |
| tax basis unconfirmed | `DRAFT - TAX BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE` |
| not approved | `DRAFT - NOT APPROVED FOR LENDER RELIANCE` |

- **The four conditions are distinct claims and must not be collapsed.** An
  unreconciled run's figures may be wrong. A reconciled run that does not repay
  the senior facility is arithmetically sound and shows a real repayment failure.
  A run whose tax basis is unconfirmed is arithmetically sound *on a basis nobody
  has verified*. A reconciled, repaying run with no approved case is a correct
  appraisal that nobody has approved. Printing "UNRECONCILED" over the last three
  would state something untrue about the model.
- **Why the tax gate is third and not a hard validation [R8].** An unconfirmed
  jurisdiction leaves `report_safe` **true**. Making it false would print "one or
  more hard validations fail" — a claim that the *figures* are wrong, when in fact
  only the basis is unverified. It sits above `not_approved` because a reader needs
  to know the basis is unverified before they read an approval status. This
  ordering is load-bearing and is pinned diagonally in both engines: with no lender
  case in existence, `not_approved` would otherwise win every time and the tax gate
  would be unreachable dead code.
- **`report_safe` deliberately excludes senior repayment** (§7): an appraisal
  intending to refinance later is a valid appraisal. The FINAL gate tests it
  separately, so no document showing an unrepaid senior balance at maturity can
  be issued as final.
- **With no lender case in existence, every document is a DRAFT.** That is the
  intended answer, not a gap.

### 13.4 What a report may claim

- **Cost basis.** In `headline` mode the construction model is a rate × area
  **headline cost estimate** with named allowances, and a report may not
  describe it as a cost plan. In `detailed` mode a report may call it a
  **detailed cost plan**, because it is one in shape — a priced package
  schedule, not a rate × area estimate — but it must say, in the same breath,
  that QS evidence (source, date, status) is not recorded, so as not to claim
  an evidence status the model does not carry (§16.6, §16.9). [R10 — calc
  2.9.0. Before it this line read "The construction model is a rate × area
  headline cost estimate with named allowances. A report may not describe it
  as a cost plan until a detailed package mode is the active basis." — true
  when written, because no detailed package mode existed yet. §16 gives the
  appraisal exactly that mode, which is what this bullet's own final clause
  anticipated; leaving the old wording in place unannotated would have had the
  spec assert a condition it no longer describes correctly, the same fault §14
  and §15 each corrected in this same section's neighbours.]
- **Suitability.** A report states that it is suitable for sponsor review and
  preliminary lender appraisal, and that it is not a credit paper, valuation,
  cost plan, tax opinion or legal report.
- **Unrealised returns.** §3.16.1's labels are mandatory. Where the multiple or
  IRR is `null`, the report prints the reason, never a substitute figure.
- **Limitations are printed, not implied.** Every disclosed limitation is stated
  in the document, conditioned on the run: unavailable lender valuation,
  unconfirmed migrated facility terms, jurisdiction/tax basis, VAT treatment,
  absent area bridge, narrative-only due diligence, and any failing governance
  condition from §13.3.

### 13.5 Layout invariants

Automated report QA asserts these against the generated PDF's own content
streams — position and measured width, not the generator's intentions.

1. **No drawn item leaves the page.** Every text item's bounding box, the draft
   banner included, sits inside the media box within 0.5 mm.
2. **No blank, orphaned or sparse page.** Content extent covers ≥ 40 % of the
   content box on interior pages and ≥ 20 % on the last; a page carries ≥ 5 body
   items and ≥ 6 % inked rows. The cover is exempt.
3. **Style never outlives its call.** Anything drawn out of band restores the
   font, size and colour it found; style is applied immediately before a draw and
   never before a page break.
4. **Blocks that fit a page are not split.** A paragraph or a short table moves
   whole rather than leaving two lines behind.
5. **Every page after the cover carries a running footer** with the property, a
   confidentiality mark and "Page n of m".

**Not yet asserted:** raster rendering of each page for pixel-level visual
regression, and PDF/UA structure tagging. Both are recorded as open in the R7
release report rather than claimed.

---

## 14. Acquisition tax [R8 — calc 2.7.0]

The product is sold UK-wide. Before this release it charged England/NI SDLT on
every acquisition regardless of where the property was, and *disclosed* the fact
in the report's assumptions. A disclosed wrong number is still a wrong number: it
flows into acquisition cost, TDC, profit, every profit ratio, LTC and the deal
spider. §14 replaces the undated module constants with a dated, sourced and
versioned table, so that a figure can always be traced to the band set that
produced it and re-running a historic appraisal after a Budget returns the number
it returned before.

The error was **bidirectional** — Wales is cheaper than England below £1m and
dearer above it — so no single correction factor would have covered it.

### 14.1 Regimes

| Jurisdiction | Regime |
|---|---|
| `england_ni` — England and Northern Ireland | SDLT — Stamp Duty Land Tax |
| `scotland` | LBTT — Land and Buildings Transaction Tax |
| `wales` | LTT — Land Transaction Tax |

England and Northern Ireland are one jurisdiction because they share one regime.

### 14.2 The band table

Every band set carries `effective_from`, an exclusive `effective_to` (`null` for
the set currently in force), its bands on a **slice** basis ascending, a flat
`surcharge_pct` where the regime has one, and a source URL. The whole table
carries a semver `TAX_TABLE_VERSION`, bumped on any change to any set, stamped
into every result and printed in the provenance panel (§13.1).

`fixtures/tax/acquisition-tax-tables.json` is the **normative** record. Each
engine holds its own native copy and a parity test asserts equality field for
field, in both directions, so a table edit after a Budget fails both engines'
gates until both are updated. Rates below were read from the statutory authority
on **17 August 2026**.

**Non-residential / mixed, freehold consideration** — the basis this product's
acquisitions use (§14.4):

| Regime | Bands (slice) | In force from | Supplement | Source |
|---|---|---|---|---|
| SDLT (England/NI) | 0% to £150,000 · 2% to £250,000 · 5% above | 17 Mar 2016 | none | [GOV.UK](https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates) |
| LBTT (Scotland) | 0% to £150,000 · 1% to £250,000 · 5% above | 25 Jan 2019 | none | [gov.scot](https://www.gov.scot/publications/scottish-budget-2026-2027-scottish-tax-ready-reckoners/pages/4/) |
| LTT (Wales) | 0% to £225,000 · 1% to £250,000 · 5% to £1,000,000 · 6% above | 22 Dec 2020 | none | [gov.wales](https://www.gov.wales/land-transaction-tax-rates-and-bands) |

**Residential higher rates** — held only for the deal spider's tax-advantage
comparison (§14.7), never for an acquisition. Note the structural difference:
England and Scotland charge a flat supplement on the whole consideration, Wales
embeds the uplift in the bands and charges no supplement.

| Regime | Bands (slice) | In force from | Supplement | Source |
|---|---|---|---|---|
| SDLT (England/NI) | 0% to £125,000 · 2% to £250,000 · 5% to £925,000 · 10% to £1,500,000 · 12% above | bands 1 Apr 2025 | +5% on whole consideration, from 31 Oct 2024 | [GOV.UK](https://www.gov.uk/stamp-duty-land-tax/residential-property-rates) |
| LBTT (Scotland) | 0% to £145,000 · 2% to £250,000 · 5% to £325,000 · 10% to £750,000 · 12% above | 5 Dec 2024 | +8% ADS on whole consideration | [gov.scot](https://www.gov.scot/publications/scottish-budget-2026-2027-scottish-tax-ready-reckoners/pages/4/) |
| LTT (Wales) | 5% to £180,000 · 8.5% to £250,000 · 10% to £400,000 · 12.5% to £750,000 · 15% to £1,500,000 · 17% above | 11 Dec 2024 | none — embedded in the bands | [gov.wales](https://www.gov.wales/land-transaction-tax-rates-and-bands) |

Scottish Budget 2026–27 confirms all LBTT rates and bands, including ADS, hold at
current levels.

### 14.3 Selection

`selectBandSet(jurisdiction, basis, date)` returns the single set whose
`[effective_from, effective_to)` window contains `date`.

- Windows within a `(jurisdiction, basis)` group must be **contiguous and
  non-overlapping**. A test asserts this over the whole table rather than trusting
  the author.
- **A date no set covers is a hard error, not a clamp.** §1.5 forbids substituting
  a plausible value for an unknown one, and clamping to the earliest set would do
  exactly that — it would return a confident figure computed on a band set that was
  not in force. The error names the offending date and the earliest covered date.
- **A null `acquisition_date` is a distinct case and is not an error.** Legacy
  documents carry no acquisition date. The currently open-ended set is used and the
  result is marked `date_basis: 'assumed_current'`, which the report prints. It is
  not silent, because a re-run after a Budget would return a different number.

**Degradation, not a crash.** Both engines compute the acquisition cost stack
*before* validation runs, so a date `selectBandSet` cannot place must not throw
and destroy the whole appraisal. Both call sites resolve the date through one
shared helper that degrades an unusable date to `null` — which is already defined
above as "assume the current set", and so is self-describing rather than a silent
substitute figure. Validation independently re-derives the same condition as a
**hard** field-level error, so the failure is never silent, only never fatal. The
catch is deliberately narrow: an invalid *jurisdiction* still propagates.

### 14.4 Evaluation and basis

Slice arithmetic with half-up rounding to whole pence per band, plus
`round(consideration × surcharge_pct/100)` where the set carries a supplement. The
England/NI path reproduces every pre-R8 golden figure to the penny.

The basis is always `non_residential`. A commercial building bought for conversion
takes non-residential rates by nature, so the "6 or more dwellings" rule that would
otherwise reach the same answer is **noted here as the reason the basis is
non-residential, not implemented as a branch** (§14.8).

The result carries the total, the effective rate, the per-band working, the
surcharge, the regime, jurisdiction and basis, the band set's `effective_from`, the
table version, the source URL, the date basis, and the override fields below.

### 14.5 Override

`acquisition_tax_override_pence`, when non-null, becomes the total. The
band-derived figure is preserved in `computed_total_pence` so the report can show
both, and `is_override` is set.

- **Validity condition:** an override with an empty `acquisition_tax_override_reason`
  is a **hard validation error** — the same rule shape as §12.7's cell validity. An
  unexplained override is an unattributable figure.
- The report prints the override, the computed figure it replaced, and the reason.
- The override is the honest escape hatch for everything in §14.8.
- **It does not move the RLV** (§3.18), because cost-excluding-land subtracts the
  acquisition tax back out.

### 14.6 Evidence and the draft gate

`jurisdiction` is accompanied by `jurisdiction_source` (`derived` from a postcode
lookup, `user`, or `migrated_default`) and `jurisdiction_evidence_status`
(`unconfirmed` / `confirmed`), deliberately reusing the vocabulary of
`EquitySource.evidence_status` so the report's evidence handling stays one
mechanism rather than two.

- **Derivation only ever proposes.** A postcode lookup's country maps onto a
  jurisdiction, but the result stays `unconfirmed` until a user accepts it;
  accepting sets `user` / `confirmed`. An unrecognised or absent country returns
  nothing and leaves the field at its default, unconfirmed — it never guesses.
- **An unconfirmed jurisdiction leaves `report_safe` true** and instead makes the
  document a DRAFT under §13.3's third condition. The figures are not alleged to be
  wrong; the basis is stated to be unverified.
- **Migration stamps what a legacy document honestly is:** `england_ni` /
  `migrated_default` / `unconfirmed`, with a null date. It is purely additive and no
  existing appraisal's computed values move. The consequence is deliberate and was
  accepted by the product owner rather than worked around: **every document that
  predates this release shows the tax-basis draft banner until both its
  jurisdiction is confirmed and an acquisition date is recorded.** Migration
  leaves the date null, so `date_basis` stays `assumed_current` until a date is
  entered, and §13.3's third condition needs both halves — confirming the
  jurisdiction alone is not enough. There is no grandfathering and no
  England-first exemption, because a migrated document genuinely is unverified.

### 14.7 The deal spider

The spider's tax-advantage comparison sets non-residential against residential
higher rates **within one regime**. Comparing a Welsh acquisition's LTT against
England's residential SDLT would measure the border, not the conversion.

### 14.8 Stated limitations

Recorded so they are not read as oversights. None of the following is modelled;
§14.5's override is the escape hatch for all of them.

- **Reliefs** — multiple dwellings relief, group relief and sub-sale relief.
- **Linked transactions** — no aggregation across linked purchases.
- **The non-resident surcharge** — not applied.
- **Leasehold premium and the NPV-of-rent charge** — freehold consideration only.
- **The "6 or more dwellings" rule** — noted in §14.4 as the reason the basis is
  non-residential, not implemented as a branch.
- **Disposal taxes** (out of scope for this plan) remain unmodelled and are
  disclosed separately. [R11 — calc 2.10.0. Before it this bullet also listed
  "VAT and TOGC (R11)" as unmodelled. R11 has shipped: purchase VAT and TOGC
  are modelled at §17.7, including their effect on this section's own
  chargeable consideration (§3.3). The surviving VAT-specific limitations are
  §17.13's own list, not this one.]

A report states that it is not a tax opinion (§13.4).

---

## 15. Area bridge and efficiency [R9 — calc 2.8.0]

Before this release the appraisal held two unrelated area numbers — `conversion_costs.total_construction_sqm` (what construction cost is charged on) and Σ `unit.floor_area_sqm` (what is sold) — with nothing reconciling them and a ±25% warning standing in for a reconciliation. Nobody could answer "where did the other 140 m² go?", because the model had no place to put circulation, plant, stores, amenity, retained commercial or an unallocated balance. §15 gives the scheme one area statement that ties, and makes the construction-cost area a *derived* consequence of it rather than a second, independent assertion.

### 15.1 Entered lines, and the one-fact-one-line rule

The `areas` block (inputs v6) holds **only entered facts**. Nothing derived is stored:

| Field | Meaning |
|---|---|
| `basis` | `bridge_derived` or `manual` — which number is the construction cost area (§15.3). |
| `existing_gia_sqm` | Gross internal area of the existing building. |
| `demolished_gia_sqm` | GIA removed. |
| `extension_gia_sqm` | GIA added. |
| `retained_commercial_gia_sqm` | Proposed GIA retained in commercial use, not developed. |
| `untouched_gia_sqm` | Proposed GIA left untouched by the works. |
| `circulation_common_sqm` | Circulation and common parts inside the developed area. |
| `plant_riser_sqm` | Plant and risers. |
| `store_bin_cycle_sqm` | Stores, bin and cycle provision. |
| `amenity_sqm` | Internal amenity space. |
| `external_amenity_sqm` | External amenity and landscape. **Not gross internal area** — carried through for display and never deducted from the reconciliation. |

**One fact, one line.** A quantity is entered in exactly one place or derived in exactly one place, never both. Developed area, available-for-units area, the unallocated balance and the three efficiencies are all derived (§15.2) and are never inputs: a scheme that could state its developed GIA *and* its existing/demolished/extension lines would have two records of the same fact, free to disagree, and the model would have no principled way to say which one is the building. This is the same discipline §3.3 applies to acquisition tax, and for the same reason.

Areas are floating-point m² — §1.1's integer-pence rounding governs money, not area. Every entered field is `>= 0`.

### 15.2 The derivation

The arithmetic order below is **normative**. Both engines mirror it operation for operation (`frontend/src/lib/model/areas.ts`, `app/financial_model/areas.py`) so they produce bit-identical IEEE-754 results and the golden-fixture parity assertions can be exact rather than tolerant.

```
proposed_gia        = existing_gia - demolished_gia + extension_gia
developed_gia       = proposed_gia - retained_commercial_gia - untouched_gia
available_for_units = developed_gia - circulation_common - plant_riser
                                    - store_bin_cycle - amenity
unit_nia            = SUM(unit.floor_area_sqm)
unallocated         = available_for_units - unit_nia
```

`unallocated` is **signed**. A positive balance means the unit schedule does not yet fill the building; a negative one means the units over-fill it. It is reported either way (§15.7) — never clamped to zero, and never quietly absorbed into another line.

**The three efficiencies**, each a percentage to 2 dp under §1.5's rule that a zero denominator yields `null`, never `0`:

| Ratio | Formula | Answers |
|---|---|---|
| `nia_to_gia_pct` | `unit_nia / developed_gia` | Net-to-gross of the part being developed. The headline conversion efficiency. |
| `nia_to_proposed_gia_pct` | `unit_nia / proposed_gia` | Net-to-gross of the whole proposed building, including retained commercial and untouched area. |
| `saleable_to_developed_pct` | `saleable_nia / developed_gia` | What proportion of the area being funded is being sold. |

`null` here means *not computable*, and is the correct answer for a document with a zeroed bridge — every pre-v6 document, and every v6 document on the manual basis that has entered no geometry. Printing `0%` would assert that the building has no usable area, which is a different and false statement (§1.5).

`saleable_nia` is the NIA of the units the exit strategy actually sells: all units for `sell_all`, none for `retain_all`, and the non-retained units for `blended`. **The saleable ratio is therefore exit-coupled by design.** A retain-all scheme correctly reports `0.00%` — not because the building is inefficient, but because none of the area being funded is being sold, which is exactly what the ratio is asked to measure. That coupling is deliberate and is why this ratio is kept separate from `nia_to_gia_pct`, which is exit-independent: the two answer different questions, and a reader comparing them can see the retention.

### 15.3 The construction-area basis switch

`areas.basis` selects **the** area construction cost is charged on:

- `bridge_derived` — `developed_gia_sqm` from §15.2. The bridge is the record, and the cost follows the building.
- `manual` — `conversion_costs.total_construction_sqm`, the pre-R9 field, carried verbatim.

`manual` is the migrated default and remains a legitimate choice: an appraiser holding a measured schedule of areas from a cost consultant should be able to use it without first reconstructing a bridge. What the model refuses to do is guess. Migration writes `basis: 'manual'` with a **zeroed** bridge rather than synthesising `existing_gia_sqm` from `total_construction_sqm`, because inventing an existing GIA the record never stated would be inventing evidence — the same reasoning that leaves R8's `acquisition_date` null rather than stamping today's date. See `migration-notes.md` for the v5 → v6 statement and where the numerical-identity claim is tested.

§3.4's construction cost is unchanged in form; only its area argument is now resolved rather than read: `base = round_half_up(construction_cost_per_sqm_pence × developed_area_sqm)`, then contingency, then the compliance items.

### 15.4 The single-accessor rule

`areas.ts` / `areas.py` is the **only** module that may read `conversion_costs.total_construction_sqm`. Reading it anywhere else is a **build failure**, outside a short allowlist of files that own, declare, migrate or capture the raw field.

The module exposes two accessors, and which one a consumer wants is not a matter of taste:

- **`developed_area_sqm(inputs)`** (`developedAreaSqm`) returns the construction cost area and nothing else. This is what the cost stack, the deal spider, the UI's cost page and the investment memo call.
- **`area_bridge(inputs)`** (`areaBridge`) returns the whole `AreaBridgeResult`. Two callers legitimately need it rather than the scalar: `derive_metrics`, which lifts the reconciliation onto the result (§15.8), and `validate_inputs`, whose §15.6 rules are about the *reconciliation* — the unallocated balance, the efficiencies, and the manual figure held against the derived one (which is why `manual_area_sqm` is carried on the result at all). Both read the raw field through this module, not around it.

[R9 — calc 2.8.0 fix round 1. This paragraph previously said validation "calls `developed_area_sqm` and nothing else", which misdescribed the code: `validation.ts:82` / `validation.py:99` call `area_bridge` directly, as `areas.ts`'s own `manual_area_sqm` doc comment sanctions. A specification that misdescribes the engine is a defect in the specification.]

This is enforced, not merely stated, because R8 proved convention alone does not hold it: the same "moved the computation, missed a consumer" defect recurred three times in one release (`calculateTotalAcquisitionCost`, `deal-spider.ts`, `AcquisitionPage.tsx`), each site individually self-consistent and therefore invisible to a green test suite. `model-governance.md` records how each language enforces the rule, and what it does not reach.

### 15.5 Ancillary areas and ancillary value

Every unit (inputs v6) carries an `ancillary` block: `balcony_terrace_sqm`, `balcony_terrace_value_pence`, `parking_spaces`, `parking_value_pence`.

- **Ancillary area sits outside NIA.** `unit_nia_sqm` sums `floor_area_sqm` only. A balcony is not net internal area, and folding it in would inflate every efficiency in §15.2 and every £/sq ft in §3.2.
- **Ancillary value sits outside internal saleable value, and inside GDV.** §3.1's GDV is `gdv_internal + gdv_ancillary`, with the two reported separately so a reader can see how much of the scheme's value is parking.
- **Ancillary sells with its unit.** Gross sale receipts (§4.4) carry the sold units' ancillary value, and the retained (unrealised) value carries the retained units'. Under a blended exit, GDV and gross receipts therefore differ by exactly the retained units' internal **plus** ancillary value — never by the internal value alone.
- **A GDV stress moves ancillary value.** §12.1's `gdv_adjustment_pct` scales `parking_value_pence` and `balcony_terrace_value_pence` alongside `estimated_value_pence`, each rounded half-up independently. Ancillary **areas** are deliberately untouched: a price stress is not an area stress.
- **A pre-v6 unit carries no `ancillary` block at all**, read structurally and resolving to zero, so every pre-R9 figure is unchanged to the penny.

The bridge also reports `ancillary_balcony_terrace_sqm` and `ancillary_parking_spaces` as scheme totals — disclosure beside the reconciliation, never deducted from it.

### 15.6 Validation

Hard **errors** (they gate the document):

- any entered area `< 0`;
- `demolished_gia_sqm > existing_gia_sqm` — proposed GIA cannot be negative;
- `retained_commercial_gia_sqm + untouched_gia_sqm > proposed_gia_sqm` — developed area cannot be negative;
- circulation + plant + store + amenity greater than the developed area;
- `basis: 'bridge_derived'` with a developed area of `0` or less — the selected basis produces no cost area at all;
- `unallocated_sqm < 0` — the unit schedule does not fit the building.

**Warnings** (they never gate):

- `unallocated_sqm` exceeds 10% of the developed area — the bridge does not yet tie;
- `nia_to_gia_pct` outside the 65–90% range typical of a conversion;
- `basis: 'manual'` where the manual area differs from the derived developed area by more than 5% — one of them is wrong, or the manual basis needs a reason.

The last three warnings, and the `unallocated_sqm < 0` error, are all guarded on `developed_gia_sqm > 0`. A zeroed bridge means the bridge is not in use, and a real unit schedule must not be judged against a 0 m² building nobody is reconciling against.

**The ±25% warning this block replaces is deleted, not repointed.** It compared unit NIA against the construction area — two quantities that *should* differ, by exactly the circulation, plant, storage and amenity the model previously had nowhere to record — so it fired on correct schemes and stayed silent on wrong ones. The tolerance was a proxy for a reconciliation that did not exist. It now exists, so the proxy goes: the ±25% figure must appear nowhere in either engine's source or output.

### 15.7 Reporting the balance

The unallocated balance is **disclosed**, not hidden and not silently absorbed. An area statement that appears to tie because the residue was folded into another line is worse than one that visibly does not tie: the reader loses the ability to ask the question. A positive unallocated balance is frequently and legitimately unknown at appraisal stage, which is why it is a warning rather than an error — the appraisal is honest about what is not yet known (§1.5) rather than claiming a precision it does not have.

### 15.8 The result block

`AppraisalResultV2.area_bridge` carries the whole reconciliation — every entered line, every derived line, every ratio — and is derived **once**, in `derive_metrics`. The UI and the investment memo read it off the result and never call `area_bridge` themselves. `developed_area_sqm`, `gdv_internal_pence` and `gdv_ancillary_pence` are lifted onto the result alongside it for the consumers that need only those.

### 15.9 Stated limitations

Recorded so they are not read as oversights.

- **Scheme-level ancillary is out of scope.** Surplus parking sold separately from any unit — a residual car-park disposal, a bank of spaces sold to a neighbouring scheme — is not modelled. Ancillary recorded here attaches to a unit and sells with it. Modelling scheme-level ancillary needs its own disposal routing in the exit engine, not another value field.
- **Retained-commercial value is deferred to R13.** `retained_commercial_gia_sqm` correctly removes the retained commercial area from the developed area, so it is neither built nor charged construction cost. Its **value** is not in GDV: §3.1 still excludes retained-commercial value, so a scheme retaining commercial space understates its total value until R13 models the investment arm. A stated exclusion, not an error in the bridge.
- **No measurement standard is enforced.** The model does not check that entered areas follow RICS IPMS, the RICS Code of Measuring Practice, or any other convention, and it cannot tell GIA entered as GEA from GIA entered correctly. It reconciles whatever is entered. The standard used is the appraiser's responsibility and travels with the appraisal as an assumption, not as a validated field.
- **Areas carry no evidence status.** Unlike the acquisition jurisdiction (§14.6), an area line records no source and no confidence. There is no "measured survey" versus "scaled off a floor plan" distinction in the record.

---

## 16. Cost plan modes [R10 — calc 2.9.0]

Before this release the whole construction cost stack was one rate, one percentage and three flat compliance fields, and professional/statutory fees were eight further flat pence fields on the same block. There was nowhere to record a priced QS package schedule, general design-development contingency shared a single percentage with existing-building risk and abnormal risk — the three things a *conversion* lender most wants separated, because they carry different probabilities and different evidence — and the memo printed the string `'On base build cost only'` beside the contingency rate, because nothing computed or displayed the base that sentence described. §16 gives the appraisal a `cost_plan` block (inputs v7) that fixes all three.

### 16.1 The two modes, and their mutual exclusion

```
CostPlanMode = 'headline' | 'detailed'
```

**Headline stays rate × area; detailed is priced lump sums.** The two modes are mutually exclusive, and it is enforced rather than assumed: `headline` mode carrying a non-empty package schedule is a hard validation error, and so is `detailed` mode carrying none (§16.5). Packages deliberately do not each carry their own rate and area — a QS prices a package; the rate is the QS's working, not the appraisal's input. Reintroducing per-package rate × area would recreate the two-numbers-one-fact condition the §15 area bridge exists to remove.

### 16.2 Packages, and the compliance double-count they would otherwise cause

```
CostPackage: id, code, label, amount_pence, contingency_class, lender_eligible, notes
```

`code` is one of the audit's own twelve package types — `enabling_strip_out_asbestos`, `structure`, `envelope`, `roof_windows`, `fire_acoustic_thermal`, `mech_elec_public_health`, `drainage_utilities`, `lift`, `partitions`, `finishes`, `common_parts`, `externals` — plus `other`. A fixed enum plus a free `label` makes the schedule groupable and comparable across appraisals while still admitting the line a particular scheme has that the enum does not. Duplicate `code`s are allowed (two externals lines, three finishes lines); duplicate `id`s are not — ids are the identity the three contingency classes reference (§16.3).

`lender_eligible` and the derived `lender_eligible_base_pence` (Σ `amount_pence` of every package where `lender_eligible` is true) are **recorded and displayed only in R10**. The ledger's draw cap does not read it — wiring it to `development_cost_advance_pct` is R14. A recorded-but-inert eligibility flag that looks live is worse than none, so this is stated at the point of definition rather than left to be discovered.

**`fire_safety_pence`, `sound_insulation_pence` and `part_l_compliance_pence` are the same money as the `fire_acoustic_thermal` package code.** A document carrying both would double-count it invisibly, because both figures are legitimate in isolation. The resolution:

- **Headline mode** keeps the three compliance fields exactly as before. `compliance_pence` is their sum, added after contingency, unchanged.
- **Detailed mode** expects compliance to be priced inside a package. `compliance_pence` is **0**, and a detailed-mode document carrying any non-zero compliance field is a hard validation error (§16.5) — a hard error rather than a silent zeroing, because dropping money the user entered without saying so is the worse failure. The UI's mode switch offers a one-click conversion of the three figures into a single `fire_acoustic_thermal` package; declining leaves the figures in place, which validation then rejects.

**Compliance responds differently to a cost stress in the two modes, and must — this is a stated limitation (§16.9), not an inconsistency to engineer away.** In headline mode `compliance_pence` is a fixed allowance the cost lever (§12.1's `construction_cost_adjustment_pct`) does not scale — pre-R10 behaviour, unchanged. In detailed mode the same money sits inside a package, and packages *are* scaled with every other package amount. The two modes agree on the construction total at rest and diverge under stress once compliance is non-zero. Scaling headline compliance too would move every existing document's scenario figures, which this release forbids; exempting a compliance package from the stress would make it the one package the cost lever cannot reach, recreating §1's pre-R10 defect in miniature.

### 16.3 Contingency — one engine, three classes, a base scoped by the package tag

```
ContingencyClassName = 'general' | 'existing_building' | 'abnormal'
ContingencyClass: name, pct
```

Each class rounds **half-up independently** (§1.1); the contingency total is the sum of the three rounded figures, **not a rounding of the sum**. Three classes at 5% each on the same base is deliberately not identical to one class at 15% — they are three separate allowances, each computed and each reportable, and collapsing them for rounding would obscure which one moved.

**The base is resolved mode-dependently from the package `contingency_class` tag, not from an input-side `basis`/`package_ids` pair. [R11 — calc 2.10.0.]** Before this release `ContingencyClass` also carried `basis` (`'all_packages'` | `'selected_packages'`) and `package_ids`, read by the engine but written by nothing in the product — R10 shipped `CostPackage.contingency_class` recorded but not live, and assigned this release the decision (§16.9, pre-R11). R10's `basis`/`package_ids` are deleted from the *input* and the resolution rule below is the sole mechanism, in both modes:

- **Headline mode:** every class's base is the whole base build. There are no packages, so scoping by tag is not expressible — you cannot scope what you have not scheduled. This reproduces headline behaviour exactly: `ConversionCostsPage.tsx` renders all three percentages as editable in both modes, and a rule of "tagged packages only, in all modes" would silently zero a live, shipped headline-mode input.
- **Detailed mode:** `general` takes the whole base build; `existing_building` and `abnormal` each take the sum of packages whose own `contingency_class` tag matches that class name, as an **additional** allowance on top of general. A package tagged `existing_building` therefore carries both general and existing-building contingency — the second is an addition for elevated risk, not a substitution.

**The result shape is unchanged.** `ContingencyLine.basis` survives on the *result* as `'all_packages' | 'selected_packages'`, now **derived** from mode and class rather than read from an input field of the same name — so a report reading `cost_plan.contingency[].basis` needs no change (§16.8). Only the input fields `basis` and `package_ids` are gone.

**`cost_plan.contingency` is the only contingency input from v7 onward, in both modes.** `conversion_costs.contingency_pct` is deprecated exactly as `sdlt_pence` was in R8: retained so pre-R10 readers keep working, removed in R16, and placed behind the same single-accessor guard `total_construction_sqm` sits behind. Both modes route through the same engine rather than headline mode keeping the old field live — the easy alternative would have made the migration identity gate provably blind, because the old code path would still be the one running for every existing (headline) document and "all twelve golden fixtures penny-identical" would pass whether or not the new engine was even wired in. Routing both modes through one engine means migration copies `contingency_pct` into `general.pct` on the `all_packages` basis (§16.7) and the new code computes every existing appraisal's contingency, so "identical to the penny" is an assertion that could actually fail. [R11 — calc 2.10.0. The v7 → v8 boundary re-tests the same claim one version on: the pre-existing fixture whose `contingency_class` tags and (pre-migration) `package_ids` agreed exactly — the two mechanisms could not be told apart by a re-pin alone — is joined by a **planted-divergence** document whose tags and id-list disagree, asserting the resolved base follows the tag. Without it, deleting `basis`/`package_ids` would be indistinguishable from a no-op (§17 "Guards this release must watch fail").]

### 16.4 Fee bases, and why double counting is impossible by construction

```
FeeBasis = 'fixed' | 'pct_of_base_build' | 'pct_of_construction_total'
FeeLine: id, code, category, label, basis, amount_pence, pct, per_dwelling
```

`amount_pence` is meaningful (and hard-validated to 0 otherwise) only on `basis: 'fixed'`; `pct` only on a `pct_*` basis; `per_dwelling` only on `basis: 'fixed'` (a percentage per dwelling is not a meaningful quantity) — a basis change cannot silently resurrect a stale figure in the field it just made meaningless.

**The `category` mapping is fixed, not a user choice, and it is not what the field names suggest:**

| `code` | `category` | Migrated from |
|---|---|---|
| `architect` | professional | `architect_pence` |
| `structural_engineer` | professional | `structural_engineer_pence` |
| `mande` | professional | `mande_pence` |
| `planning_consultant` | professional | `planning_consultant_pence` |
| `other_professional` | professional | `other_professional_fees_pence` |
| `prior_approval` | **statutory** | `prior_approval_fee_per_dwelling_pence`, `per_dwelling: true` |
| `cil_s106` | **statutory** | `cil_s106_pence` |
| `building_control` | **statutory** | `building_control_pence` |

`building_control` is the one to get wrong: it sits in the middle of the professional-fee block of the legacy `ConversionCostInputs` shape and reads like a consultant fee, but it has always counted in the **statutory** total (§3.6). A migration that classified it as professional would move money between two separately-reported, separately-spread lines while leaving every grand total correct — invisible to any totals-based test. `other` is available for user-added lines and must carry an explicit category.

**No fee basis includes fees, which is what makes double counting impossible by construction rather than something a check detects:**

- `pct_of_base_build` — the base build alone: Σ packages in detailed mode, or `rate × developed_area_sqm` in headline mode. Excludes contingency, compliance and all fees.
- `pct_of_construction_total` — base build + contingency + compliance. Excludes all fees.

Neither base can name a fee, so no fee can feed its own base or another fee's, and resolving every fee line needs no ordering, no iteration and no cycle detection. A check that *detected* double counting would be strictly worse than a base definition that cannot express it.

**Statutory timing is keyed on `code`, not on a hard-coded field.** §3.6's month-0 rule for prior approval survives the move to fee lines as: the fee line with `code: 'prior_approval'` lands in month 0 in full; every other statutory line spreads with the professional curve. R12 generalises fee timing; R10 does not change this behaviour, only its representation.

### 16.5 Validation

**Hard errors:**

- `mode: 'headline'` with a non-empty `packages`, or `mode: 'detailed'` with an empty `packages`, or with `packages` summing to zero (§16.1).
- Any negative `amount_pence` or `pct` on a package, contingency class or fee line.
- A duplicate package `id`, or a duplicate fee-line `id`.
- Not exactly three contingency classes, or a repeated class `name` — the three classes are schema, not a user-managed list. [R11 — calc 2.10.0. Before it this line was preceded by a rule validating a `selected_packages` class's `package_id` list — `ContingencyClass.basis`/`package_ids` no longer exist as input fields (§16.3), so there is nothing left for that rule to validate; a package's `contingency_class` tag is already constrained to the three class names by its own enum type, which needs no separate validation rule.]
- `mode: 'detailed'` with any non-zero `fire_safety_pence`, `sound_insulation_pence` or `part_l_compliance_pence` (§16.2).
- A fee line with `basis: 'fixed'` and non-zero `pct`, or a `pct_*` basis with non-zero `amount_pence`, or `per_dwelling: true` on a `pct_*` basis.
- A fee line whose `code` is one of the eight migrated codes but whose `category` contradicts §16.4's mapping.

**Warnings:** contingency total above 50% of the base build; a `pct_of_*` fee line resolving against a zero base. `mode: 'headline'` on a document that also carries `pct_of_*` fee lines is **not** a warning — percentage fees are legitimate in both modes.

### 16.6 What a report may claim

§13.4's "a report may not describe [the construction model] as a cost plan until a detailed package mode is the active basis" is discharged here. R7's "headline cost estimate" copy is mode-dependent: it stays, verbatim, for headline mode, and becomes **"detailed cost plan — QS evidence not recorded"** for detailed mode — accurate on both counts (it is a priced package schedule in shape; it carries no QS source, date or status, §16.9) and conservative rather than overclaiming a document a monitoring surveyor could rely on unread. The memo's cost section prints the package schedule (detailed mode only), the three contingency lines with their own resolved bases, and the fee lines with their bases — all read from `cost_plan`, none recomputed.

### 16.7 Migration

`migrateV6toV7` / `migrate_v6_to_v7` mirrors `migrateV5toV6` exactly, including the already-v7 merge branch and the two refusals carried forward from R8 (unrecognised version; version-7-but-fails-structural-check). A migrated document gets `mode: 'headline'`, `packages: []`, the `general` contingency class at the source `contingency_pct` on `all_packages` with `existing_building` and `abnormal` at 0, and the eight legacy fee fields as `fixed` fee lines (`prior_approval` carrying `per_dwelling: true`). No package schedule is synthesised — splitting a headline figure into invented packages would be inventing evidence, the same reasoning that left R8's `acquisition_date` null and R9's bridge zeroed rather than back-derived.

The migration gate is numeric **and** structural: all twelve golden fixtures reproduce every reported metric to the penny (a gate that can now fail, per §16.3, rather than one that is structurally blind to whether the new engine is even wired in), and the migration's structural output is asserted directly — mode, empty packages, exactly three contingency classes, eight fee lines, the general class carrying the source percentage.

### 16.8 Outputs

`AppraisalResultV2.metrics.cost_plan` (`CostPlanResult`) is the **only** shape the UI and the memo may read cost from; neither recomputes a figure from it (§15's precedent — the reason the cost page carries no arithmetic in JSX):

```
mode
packages[]                  id, code, label, amount_pence, contingency_class, lender_eligible
base_build_pence
contingency[]               name, pct, basis, base_pence, amount_pence
contingency_total_pence
compliance_pence
construction_total_pence    = base_build + contingency_total + compliance
fees[]                      id, code, category, basis, base_pence, amount_pence
professional_total_pence
statutory_total_pence
conversion_total_pence      = construction_total + professional_total + statutory_total
lender_eligible_base_pence
implied_rate_pence_per_sqm  base_build ÷ developed_area_sqm; null when the area is 0
```

Every contingency and fee line reports **its base as well as its amount** — the audit's "show the base" discharged as data rather than prose. `implied_rate_pence_per_sqm` exists so the rate does not simply vanish from the appraisal when the mode changes: in headline mode it is the entered rate recovered by division (a check on the arithmetic, not an echo of the input); in detailed mode it is the figure a reader compares against a benchmark they hold themselves. It is display-only and enters no calculation. `conversion_total_pence` is the bottom-line figure the cost page and the memo both print — computed once here, purely additive, and moves no other figure.

`Schedule.totals.construction_pence`, `professional_pence` and `statutory_pence` remain the single point the monthly ledger sees, so sources-and-uses (§7) and reconciliation are structurally untouched by this release.

### 16.9 Stated limitations

Recorded so they are not read as oversights.

- **No per-package programme.** Every package spreads with the construction curve (§6); there is no per-package start offset, duration or curve. Deferred to R12, the same release that generalises fee timing (§16.4).
- **`lender_eligible` is recorded but not wired to the draw cap.** §16.2 states this at the point of definition; R14 is where `lender_eligible_base_pence` starts constraining `development_cost_advance_pct`. Until then it is disclosure, not a live figure.
- **No QS provenance.** A package or a percentage fee carries no source, date or status — no "priced by [firm], RIBA Stage 4, dated [x]" distinction in the record, unlike the acquisition jurisdiction's evidence status (§14.6). Deferred to R15, alongside fixed-price coverage, provisional sums and inflation (§7.5 of the second audit).
- **Compliance's stress behaviour is mode-dependent, by necessity rather than oversight (§16.2).** A fixed unscaled allowance in headline mode; inside a scaled package in detailed mode. The two modes agree at rest and diverge under a cost stress once compliance is non-zero.

Two limitations recorded in earlier printings of this section are resolved and have been removed rather than left standing, per this project's own rule that a disclosure outliving its feature is a defect (shipped and caught in R8, R9 and R10 alike):

- **"No VAT"** — resolved by R11. §17 models VAT as a cash flow; the surviving VAT-specific limitations are §17.13's own list, not this one.
- **`CostPackage.contingency_class` recorded but not live** — resolved by R11. §16.3 now resolves each detailed-mode class's base from that tag; a package's `contingency_class` is read when computing which packages fall inside `existing_building`'s or `abnormal`'s base, and the planted-divergence fixture in §17 "Guards this release must watch fail" proves the tag decides rather than the deleted `package_ids`.

---

## 17. VAT and TOGC [R11 — calc 2.10.0]

Before this release VAT was a disclosed assumption, not a figure: §3.3 told a reader "purchase price treated as VAT-exempt/TOGC — unconfirmed" and §3.4 told them "construction VAT treatment unconfirmed — no reduced-rate saving is assumed", and neither sentence was backed by anything computed. On a conversion scheme that is frequently wrong in both directions — a scheme that recovers most of its input VAT looks needlessly expensive on paper, and a scheme that recovers none of it (an unregistered buyer, a partial-exemption position) looks cheaper than it is, at the exact point (the funding peak) a lender sizes a facility against. §17 gives the appraisal a `vat` block (inputs v8) that computes the cash cycle, the irrecoverable cost, and the effect on the acquisition tax base, in both engines.

### 17.1 The schema

```
VatChargeCategory =
  'acquisition' | 'construction' | 'professional' | 'statutory'
  | 'selling' | 'lender_ancillary'

RecoveryBasis = 'zero_rated_sale' | 'partial_exemption' | 'blocked' | 'unconfirmed'

TogcTreatment = 'applies' | 'does_not_apply' | 'unconfirmed'

VatTreatment {
  category: VatChargeCategory
  rate_pct: number             // 0 | 5 | 20 in practice; validated 0..100
  recoverable_pct: number      // 0..100
  recovery_basis: RecoveryBasis
  evidence_status: EvidenceStatus   // reuses the existing vocabulary (§14.6)
  notes: string
}

PurchaseVatInputs {
  vendor_opted_to_tax: boolean
  togc_treatment: TogcTreatment
  evidence_status: EvidenceStatus
  notes: string
}

VatInputs {
  registered: boolean
  return_frequency: 'monthly' | 'quarterly'
  first_period_end_month: number
  repayment_lag_months: number
  treatments: VatTreatment[]   // exactly six, one per category, in a fixed order
  purchase: PurchaseVatInputs
}
```

`treatments` is **schema, not a user-managed list**, the same rule `cost_plan.contingency` follows (§16.3): exactly one row per category, in the declared order, enforced by hard validation (§17.9). A user edits rows; a user never adds or removes one.

`registered: false` makes the entire engine inert: every VAT figure is zero and no reclaim is scheduled, whatever the treatment rows say. This is the migrated default and the new-document default (§17.11).

Detailed-mode lines gain an optional override: `VatOverride { rate_pct, recoverable_pct, recovery_basis }` on `CostPackage.vat_override` and `FeeLine.vat_override`, both `null` unless the user sets one, both hard-rejected in headline mode (§17.9) — the same mode exclusivity §16.1 states for the cost plan itself.

### 17.2 One resolver, and why that is not optional

The R10 post-mortem records a schema that carried two mechanisms for one fact, where the engines read one and the product wrote the other (§16.9, the resolved `contingency_class` entry). The category-plus-override shape here is structurally capable of repeating that defect, so three rules are load-bearing:

1. **One read site.** `resolveVatTreatment` is the only function that may read `vat.treatments` or any `vat_override`. It returns the resolved `{ rate_pct, recoverable_pct, recovery_basis, evidence_status }` for one charge. Precedence: line override if present, else the category row.
2. **The single-accessor eslint/AST guard covers it**, alongside `developedAreaSqm` (§15.4) and `total_construction_sqm` (§16.3). The guard test runs ESLint's Node API and asserts `severity === 2` — a rule downgradeable to `'warn'` with every other test still green is not a guard (R9's finding) — and the test asserts the allowlist's own contents, because R10 shipped a guard test that *pinned* the hole a widening had opened rather than catching it.
3. **The override is written by the product, not only carried by the schema.** The cost-plan detailed-mode editor writes `vat_override` per line; an override field the schema declares but nothing writes is R10's `contingency_class` again.

### 17.3 What is a fixed rule, not an input

Two facts are properties of the tax, not choices, and are encoded as constants in the mould of `FEE_CODE_CATEGORY` (§16.4):

- **Interest and the arrangement, exit, non-utilisation and extension fees are exempt financial services and never bear VAT.** Only `lender_ancillary` charges — broker, lender legal, valuation, monitoring surveyor — are standard-rated, and that treatment row applies to the ancillary fee block and to nothing else in the finance stack. Misclassifying a `lender_ancillary` VAT figure into the professional-fee total would move money between two separately-reported, separately-spread lines while every grand total stayed correct — invisible to any totals-based assertion, the same trap `FEE_CODE_CATEGORY`'s `building_control` comment records.
- **Where TOGC applies, purchase VAT is nil regardless of the option to tax.** That is the whole effect of a TOGC, and it is a hard validation error (§17.9) to enter it any other way — unrepresentable, not merely discouraged.

### 17.4 The return cycle

The first return period covers months `0 .. first_period_end_month` inclusive. Subsequent periods are one month (`monthly`) or three months (`quarterly`). Input VAT incurred anywhere in a period is reclaimed in a single amount at `period_end + repayment_lag_months`. This produces the saw-tooth a flat per-month lag cannot: with quarterly returns, VAT on spend landing at the start of a period carries for the rest of the period plus the lag — the peak a lender sizes a VAT facility against.

**Reclaims falling after the final month are not received.** They are reported as `vat.receivable_at_maturity_pence` and are **not** credited to the ledger — clamping one into the final month would manufacture a receipt the borrower has not had, the standing principle that a funding gap is visible, never plugged.

**Worked cycle, illustrative only (R41) — isolates the construction cycle so the mechanism is legible; nothing pins it.** Quarterly returns, `first_period_end_month = 2`, `repayment_lag_months = 1`. Construction £1,000,000 at 20% recoverable in full, spread £250,000 in each of months 1–4, so £50,000 of VAT is incurred in each of months 1–4:

| Period | Months | VAT incurred | Reclaimed in month |
|---|---|--:|--:|
| 1 | 0–2 | £100,000 | 3 |
| 2 | 3–5 | £100,000 | 6 |

| m | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|--:|--:|--:|--:|--:|--:|--:|
| carry (£000) | 0 | 50 | 100 | 50 | 100 | 100 | 0 |

Peak carry £100,000. Profit falls by the interest on that carry and by nothing else (§17.5, §17.12).

**The pinned fixture (`r-vat-quarterly.json`) is the normative figure, and it differs from the table above** — it additionally carries chargeable purchase VAT, landing in month 0 inside period 1's window alongside construction's first two months, so its carry is the table's vector plus a constant £100,000 across months 0–2:

| m | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|--:|--:|--:|--:|--:|--:|--:|
| incurred (£000) | 100 | 50 | 50 | 50 | 50 | 0 | 0 |
| reclaimed (£000) | 0 | 0 | 0 | 200 | 0 | 0 | 100 |
| carry (£000) | 100 | 150 | 200 | 50 | 100 | 100 | 0 |

**Peak carry £200,000, at month 2** — months 3–6 are identical to the isolated table; only P0 differs, and it differs by exactly the purchase VAT. The two tables were briefly in conflict in an earlier draft, which called the isolated table normative while also requiring the fixture to carry purchase VAT — jointly unsatisfiable, since a fixture that carries purchase VAT cannot reproduce a table that excludes it. The isolated table is kept for legibility; only the composite vector is a claim this specification makes.

### 17.5 The engine runs in one direction only

`computeVat(inputs, costPlan, schedule)` reads the cost plan and the schedule. **No part of the cost plan reads VAT** — no fee basis, no contingency base and no construction total includes VAT, the same construction R10 used to make fee double counting impossible by construction rather than detected (§16.4). Because VAT is computed strictly downstream of the cost plan, a VAT figure can never feed a base that feeds VAT — no ordering, no iteration, no cycle detection. The direct consequence: irrecoverable VAT cannot be folded back into `construction_cost_pence`. It is its own line, `irrecoverable_vat_pence`, added to cost-before-finance (§3.8) and so to TDC and to profit.

**The invariant worth pinning above all others.** Take any fixture, set `registered: true` with every category at 20% and 100% recoverable, and compare against the same document with `registered: false`:

- `construction_cost_pence`, `professional_fees_pence`, `statutory_costs_pence`, `selling_costs_pence` and `cost_plan` are **byte-identical**;
- `irrecoverable_vat_pence` is exactly `0`;
- `profit_pence` differs **only** by the increase in `finance_costs_pence`.

That assertion fails if VAT leaks into any cost base, if irrecoverable VAT is computed off a rounding error, or if a reclaim goes missing. It is the release's primary guard and it is falsifiable in all three directions (§16 "Guards this release must watch fail" — the table below).

### 17.6 The ledger

`MonthUses` gains `vat_pence`, joining the month's `cashUses` alongside acquisition, construction, professional and statutory.

**VAT is not eligible for the development-cost advance.** The cap's eligible base stays `construction + professional + statutory`. Lenders do not advance against reclaimable VAT on the same terms as build cost, so VAT falls to equity or to gross headroom, and a new `vat_funding_gap` flag (`FlagCode`) fires where neither can meet it.

Reclaims are a new inflow, `vat_reclaim_pence`, on `MonthReceipts` and on `LedgerMonth`. It is deliberately **not** a sale receipt:

- **100% swept to senior debt**, ignoring `sales_sweep_pct` — it returns a specific advance rather than realising an asset.
- **Applied first in the month**, before the sales sweep and before the §4.5 refinance event, because it reduces the balance those two then have to clear.
- **Is not part of `gross_receipts_pence`**, so no GDV-, LTGDV- or break-even-denominated metric moves.
- Where there is no facility, it flows to distribution and into `equity_cashflows_pence`, exactly as sale receipts already do for a cash deal.

**A reclaim that fully clears the balance redeems the facility on exactly the same terms as any other full redemption** — the exit fee is charged once and the redemption state is set. This is not the intuitive answer, and the reasoning matters: a reclaim is not a realisation, so "a reclaim never redeems" reads correctly, but the ledger charges the exit fee inside `if (balance > 0 && !isCash)` at the sales sweep. If a reclaim zeroes the balance while leaving the redemption state unset, the later sale finds `balance === 0`, takes neither branch, and the exit fee is never charged and never carried — silently lost, with every total still reconciling. The fee is contractually due on redemption whoever funds it, so the reclaim must redeem properly or not at all. A later draw that re-opens a balance the reclaim had cleared raises `facility_redrawn_after_redemption` — the facility genuinely was redeemed, so the flag is honest rather than spurious.

A **partial** reclaim charges no fee and sets no redemption state, exactly like a partial sales sweep.

**The sources-and-uses identity (§7) needs no structural change.** The VAT outflow enters `uses_total_pence` and is funded through the existing per-month loop; the reclaim repays and appears on neither side, like sale-proceeds repayments and refinance-shortfall equity before it (§7).

### 17.7 Purchase VAT, TOGC, and the chargeable consideration

Purchase VAT is chargeable **iff `vendor_opted_to_tax` is true and `togc_treatment` is not `'applies'`.** Stated that way rather than as a three-branch rule, it covers `'unconfirmed'` without a separate clause: an unconfirmed TOGC is charged (the prudent case) and the document is gated as unconfirmed (§17.10). Where the vendor has not opted to tax there is no VAT to charge, whatever the TOGC position. Where chargeable, the VAT is an outflow in month 0 and reclaims on the cycle like any other input VAT, subject to the `acquisition` category's `recoverable_pct`.

**Chargeability is a fact about the vendor. Recovery is a fact about the buyer (R27).** A vendor who has opted to tax charges VAT on the price whatever the buyer's VAT status; whether the buyer gets it back is separate. `vat.registered: false` makes the whole engine inert (§17.1) — the migrated and new-document default — and it is **not** a statement that the buyer is unregistered.

Those two facts collide in one state: `vendor_opted_to_tax: true`, `togc_treatment: 'does_not_apply'`, `registered: false`. Chargeability says VAT is due; the inert engine resolves the acquisition rate to 0; the chargeable consideration collapses back to the exclusive price — the model would charge tax on a base that excludes VAT while holding that VAT is due, the exact under-report this section exists to remove, in the case (an unregistered buyer, recovering none of it) where it costs most.

**That state is therefore a hard validation error (§17.9), not a case the model may silently approximate.** The real position is already expressible, and exactly: `registered: true`, the `acquisition` row at the applicable rate, `recoverable_pct: 0`, `recovery_basis: 'blocked'`. VAT is charged, none of it comes back, the consideration is VAT-inclusive, the acquisition tax is charged on that inclusive base, and the whole amount lands in `irrecoverable_vat_pence`. The rejected alternative — sourcing `rate_pct` independently of `registered`, so an inert document could still charge purchase VAT — is identity-safe (every migrated rate is 0) but makes `registered` mean two different things in two places, which this release exists partly to stop.

**The acquisition tax base moves.** SDLT, LBTT and LTT are charged on the VAT-inclusive consideration. `chargeableConsiderationPence(inputs)` / `chargeable_consideration_pence(inputs)` replaces six former call sites that passed `acquisition.purchase_price_pence` straight in as `consideration_pence` (§3.3, §14.4), added to the single-accessor guard alongside `developedAreaSqm`; a seventh site fails the lint, not review. This is a **permanent** cost, not a timing one — the migration default (`vendor_opted_to_tax: false`) keeps every existing document's consideration identical to its price, so no fixture moves.

**Out of scope:** a TOGC conditions checklist — buyer VAT-registered, own option to tax, notification before completion, property let as a business. Those are legal due diligence with their own evidence trail; the treatment here is recorded and evidenced, not tested (§17.13, R15).

### 17.8 Contingency: one mechanism (R10 carry-over)

R11 discharges the decision R10 assigned it (§16.9, pre-R11): `CostPackage.contingency_class` is now live, and `ContingencyClass.basis`/`package_ids` are deleted. §16.3 carries the resolved mechanism (mode-dependent: the whole base build for every class in headline mode; `general` on the whole base build and `existing_building`/`abnormal` scoped by tag in detailed mode) and is not repeated here.

**Why the change is not a convenience, and why it is not free to verify.** `ConversionCostsPage.tsx` renders all three contingency percentages as editable in **both** modes, so a rule of "tagged packages only, in all modes" would silently zero a live, shipped headline-mode input — the mode-dependent rule reproduces headline behaviour exactly rather than narrowing it. And the pre-existing fixture (`q-detailed-cost-plan.json`) has its `contingency_class` tags agreeing exactly with the (pre-migration) `package_ids` it is replacing, so a re-pin of that fixture proves nothing — this is precisely R10's stated failure mode, "every test used documents where both code paths agreed, so reverting the refactor kept the suite green." The guard this release adds is a **planted-divergence** document, whose tags and id-list disagree, asserting the resolved base follows the tag (§16 "Guards this release must watch fail").

### 17.9 Validation

**Hard errors** (input errors, not flags):

- a `vat_override` set on any package or fee line while `cost_plan.mode` is `'headline'` — mode exclusivity, mirroring §16.5;
- `rate_pct` or `recoverable_pct` outside `0..100`, on a treatment row or an override;
- `treatments` that is not exactly the six `VatChargeCategory` values, each once, in the declared order;
- `first_period_end_month` negative or ≥ `term_months`, **and** `repayment_lag_months` negative or greater than 6 — **both gated on `registered: true` (R38).** A field that parameterises a dormant engine is not validated: migration gives every document a `vat` block carrying `first_period_end_month: 2`, and validating the return-cycle bounds unconditionally made a stored appraisal with `term_months <= 2` acquire a hard error the instant it was migrated, from a block the engine ignores because `registered` is false. Measured directly: `term=1` yielded `errors=[]` at v7 and `errors=["vat.first_period_end_month"]` at v8 — an inert migration would have silently downgraded every short-term appraisal in the database to DRAFT. The bounds that stay unconditional are the ones that are nonsense in any state (a negative rate, a negative recoverable proportion, a treatments array that is not the six categories); migration writes zeroes and exactly six rows, so none of those can fire on a migrated document.
- `togc_treatment: 'applies'` together with a non-zero `acquisition` rate — the §17.3 fixed rule must be unrepresentable, not merely unlikely;
- **`vat.registered: false` while purchase VAT is chargeable** (the vendor has opted to tax and TOGC does not apply) — §17.7's collision. The error message names the correct modelling: `registered: true` with `recoverable_pct: 0` and `recovery_basis: 'blocked'`.

**Warnings** (each carries real domain content):

- `recovery_basis: 'zero_rated_sale'` while `exit_strategy` retains any unit — the zero-rated first grant is what makes input VAT recoverable; retained residential letting is exempt, so full recovery is unsafe. The single most likely real-world data-entry error the model can catch.
- `togc_treatment: 'applies'` with `vendor_opted_to_tax: false` — possible, but then the TOGC changes nothing and the finding is probably mis-entered.
- `registered: false` with a non-zero construction cost — the engine is inert and the funding need is reported as zero.
- `vat.receivable_at_maturity_pence > 0` — a reclaim falls outside the modelled term and is not in the cash flow.

**The regression gate for the general case (R38, R39) is not a same-set assertion.** Both engines migrate every fixture plus synthetic `term_months: 1` **and** `term_months: 2` documents and compare `validateInputs` before and after: the error set with **no exemption whatsoever**, **nothing** removed at either severity, and the **only** permitted addition a warning on `vat.registered` cross-checked per fixture against its own firing condition, with a non-vacuity assertion so the exemption cannot quietly swallow a second finding. A literal same-set test is unsatisfiable by design — §17.9's own `registered: false` warning above can only appear *after* migration, since a pre-v8 document has no `vat` block at all — and the numeric identity gate could not have caught the original defect, because the figures genuinely did not move (confirmed empirically: with the rule un-gated, the numeric gate stayed green throughout).

### 17.10 Evidence, the draft gate and reporting

`DraftReason` gains `'vat_basis_unconfirmed'`, ordered immediately after `'tax_basis_unconfirmed'` in `draftReason()` — an unconfirmed VAT basis does not make the arithmetic wrong, so it must not displace a reason saying the figures themselves may be, but a reader must know the basis is unverified before reading an approval.

**Material means the category actually bears VAT** — a treatment row whose `evidence_status` is `'unconfirmed'` while its resolved charge is non-zero, or `purchase.evidence_status` unconfirmed while purchase VAT is chargeable. No threshold constant is invented; an unconfirmed row charging nothing gates nothing, and `registered: false` can never gate. `DRAFT_REASON_SENTENCE` and `WATERMARK_TEXT` are both `Record<DraftReason, string>`, so adding the union member makes `tsc` require both — a compile-time guard, not a test that could be forgotten (§14.6's precedent, R9's finding that a length-assertion array does not pin exhaustiveness).

**The memo** carries a VAT section: treatment by category with rate, recoverable proportion, basis and evidence status; the return cycle; the month-by-month carry with its peak; the carry interest; irrecoverable VAT; and any `vat.receivable_at_maturity_pence`. Three pre-existing memo sites were rewritten, not appended to: the construction VAT row, the purchase VAT/TOGC row, and the limitation *"VAT is not modelled as a cash flow"* — false the moment this release lands, and this limitations list has itself carried a disclosure outliving its feature in R8, R9 and R10 (§14.8, §16.9), which is why reviewing the whole list, not only the one stale sentence, is a required step here too.

**The spider's counterfactual counts only evidenced rates (R43).** The tax-advantage axis measures VAT saved against a standard-rated counterfactual, and a saving is only real if the actual rate is a determined fact. Every category ships at `rate_pct: 0, evidence_status: 'unconfirmed'` (the migrated and new-document default), and nothing requires a user to configure all six before setting `registered: true` — "registered, with one category ever touched" is a valid, unvalidated, and probably common state, and a naive counterfactual would score every untouched category as a full 20% saving, because a 0% rate nobody filled in is arithmetically indistinguishable from a 0% rate someone determined. **The counterfactual therefore includes only charge lines whose `evidence_status` is `'confirmed'`** — an unevidenced rate contributes nothing to a claimed saving.

**The axis's caveat is not `vatBasisGate`.** They answer different questions: the draft gate asks whether the document has *material* unconfirmed VAT (gating nothing when a row charges nothing); the axis caveat asks whether *any* rate in this saving is unevidenced, and fires whether or not that row currently charges — reusing the gate here would import a materiality threshold tuned for the other question and silence the caveat in precisely the case that needs it. The axis's tests are direction-only (to avoid self-referential recomputation, R9), so an absolute assertion is also required: a document with only `construction` configured must produce exactly the construction-derived figure, with no contribution from the five untouched categories — a direction test alone cannot see a constant added to both sides of a comparison. The `deal-spider.ts` hard-coded `construction_cost_pence × 0.15` and its `illustrative: true`/UNCONFIRMED-caveat help text are replaced by the modelled figure (VAT actually saved relative to a standard-rated counterfactual, less irrecoverable VAT and carry interest) so the report never carries two VAT numbers that disagree.

### 17.11 Migration and the persistence boundary

`migrateV7toV8` / `migrate_v7_to_v8` writes `vat.registered: false`; the six treatment rows at `rate_pct: 0`, `recoverable_pct: 0`, `recovery_basis: 'unconfirmed'`, `evidence_status: 'unconfirmed'`; `purchase`: `vendor_opted_to_tax: false`, `togc_treatment: 'unconfirmed'`, `evidence_status: 'unconfirmed'`; `vat_override: null` on every package and fee line; and the §16.3 rework (`basis`/`package_ids` dropped, tags retained). `DEFAULT_VAT` matches the migration exactly, so the feature ships opt-in as detailed cost-plan mode did (§16.7), and the two engines' v-defaults re-converge.

`RECOGNISED_INPUTS_VERSIONS_V8` is `[1..8]`, written as membership of the declared tuple and tested with a document tagged `9` — R10 found a version predicate loosened from `=== 6` to `!== 5`, the literal negation of the set's own definition, which could never fail. The server-side `cost_plan` deep-merge R10 found nobody had deleted to check gains a `vat` sibling on the same merge, with the same "delete it and watch a test fail" check.

**Both engines carry the numeric-identity gate**, corpus-wide, and it is meaningful only because the VAT engine is live and reads `registered` — R9 recorded that such a gate can be provably blind when the migration synthesises a block no engine yet consumes. The gate therefore also asserts the migration's **structural** output (`registered: false`, six rows, every override `null`) and not only that the figures did not move. Container-level typing still matters: `revalidate_instances='never'` lets a `CalculatorInputsV7` hold a v8 sub-block, so the gate is on the container, never on the block. §17.9's regression gate (R38, R39) is the validation half of this same boundary; both halves and the full boundary crossing (server + calculator + export, mirroring the half-migrated break R10 shipped) are recorded in `migration-notes.md` §11.

### 17.12 Outputs

`AppraisalResultV2` gains:

- `vat: VatResult` — per-category resolved treatment, per-month VAT out, per-month reclaim, the carry vector, peak carry and its month, total input VAT, total reclaimed, total irrecoverable, and `receivable_at_maturity_pence`;
- `irrecoverable_vat_pence` — included in `cost_before_finance_pence` (§3.8);
- `vat_carry_interest_pence` — the **interest** attributable to carrying VAT. It is a **disclosure of a slice of `finance_costs_pence`, not an addition to it**: the interest is already there, charged by the ledger on a balance the VAT outflow raised. Its value is an explicit counterfactual — total interest with the document as given, less total interest from the same document with `vat.registered` forced false;
- `chargeable_consideration_pence` — the base the acquisition tax was charged on, so the VAT-on-price uplift is visible rather than buried in a tax figure.

`FlagCode` gains `'vat_funding_gap'` (§17.6).

**The counterfactual must hold the acquisition tax fixed (R33).** VAT imposes two costs, and only one is carry: a timing cost (money out, money back later, interest on the gap) and a permanent cost (acquisition tax on the VAT-inclusive consideration, §17.7, which never comes back). Simply forcing `registered: false` removes both — it drives `resolveVatTreatment` to inert, the acquisition rate to 0, and the consideration back to the exclusive price, so the counterfactual run carries a smaller month-0 outflow, draws less and pays less interest for a reason that is not the VAT cash cycle. That would overstate `vat_carry_interest_pence` by the interest on the SDLT-on-VAT uplift, and would break §17.5's `Δprofit === Δfinance_costs` identity, because the counterfactual's `cost_before_finance_pence` would also fall by the tax delta. **The counterfactual therefore forces `registered: false` *and* pins the counterfactual document's acquisition tax to the tax the real document was charged**, using the existing `acquisition_tax_override_pence` mechanism with a reason naming the counterfactual. Acquisition cost is then identical on both sides and the difference is exactly the VAT cash cycle — including the carry on purchase VAT itself, which is a timing cost and does belong in the figure. The permanent cost is not hidden by this: it is disclosed by `chargeable_consideration_pence` and by the acquisition tax itself.

**Carry interest and profit impact are two quantities, not one (R31).** `vat_carry_interest_pence` measures interest; §17.5's primary invariant measures profit, which moves by the change in `finance_costs_pence`. On most documents these coincide, which is why the counterfactual definition was chosen over an apportionment — but they diverge whenever a fee base is itself VAT-dependent: with `exit_fee_basis: 'peak_debt'`, carrying VAT raises peak debt, which raises the exit fee, so finance costs rise by more than interest alone and profit falls by more than `vat_carry_interest_pence` reports. Both figures are correct and answer different questions, and **both are pinned**: on a document whose fee bases are VAT-independent, `Δprofit === Δfinance_costs === vat_carry_interest_pence`; on a document with `exit_fee_basis: 'peak_debt'`, `Δprofit === Δfinance_costs` **and** `Δfinance_costs > vat_carry_interest_pence` — the second test is what stops the divergence being latent.

**The carry can be negative, and must not be clamped (R32).** Where equity funds the VAT outflow but the reclaim sweeps 100% to senior debt (§17.6), the reclaim repays borrowing that funded *other* costs, the facility ends up smaller than it would have been without VAT, and `vat_carry_interest_pence` is **negative** — carrying VAT saved interest. That is faithful to the ledger and is reported with its sign, never clamped to zero; the report reads it as a saving rather than a cost when negative, the same standing principle that keeps a funding gap visible rather than adjusted to look sensible. The alternative — repaying whichever source actually funded each month's VAT — was considered and rejected for R11: it requires tracking VAT funding provenance month by month, and the money is not lost either way, since a smaller facility reaches the developer as a smaller redemption at exit.

**VAT under sensitivity.** `computeVat` reads the cost plan, so a sensitivity cell that moves construction cost moves its VAT with it automatically, with no special-casing. VAT is not a sensitivity lever of its own in R11, and it is not invariant across cells the way the facility is (§12.2); no cell-validity rule changes.

### 17.13 Stated limitations

Recorded so they are not read as oversights.

- **No output VAT engine.** Recovery is an input proportion with a declared basis, not a computed partial-exemption calculation. A scheme with a genuine partial-exemption position needs adviser input to set `recoverable_pct`.
- **No separate VAT facility.** VAT draws on the main facility and is ineligible for the development-cost advance; a dedicated VAT bridge with its own limit, rate and fee is R14.
- **No capital goods scheme, no option-to-tax revocation, no self-supply charge.**
- **No TOGC conditions assessment** — the treatment is recorded and evidenced, not tested (R15).
- Reclaims falling after the modelled term are reported as receivable and are **not** in the cash flow.
- **`net_ltc_pct` and `gross_ltc_pct` treat VAT differently, deliberately (R34).** Gross LTC measures against total development cost, so it moves with irrecoverable VAT (§3.8). Net LTC measures against the cost the lender advances against, and VAT is not advance-eligible (§17.6), so it does not. The two are internally coherent but read as a bug printed side by side unexplained, so both the memo and the appraisal summary page state which denominator each uses whenever there is irrecoverable VAT for it to explain (§17.10, ruling R45).

### Guards this release must watch fail

Per the standing rule that every guard be planted against and watched failing before it is trusted:

| Guard | Watched by |
|---|---|
| VAT ineligible for the advance cap | Add `vat_pence` to the eligible base at the monthly engine's cap; the assertion must break |
| Recoverable VAT is profit-neutral | Leak VAT into any cost base; §17.5's invariant must break |
| Contingency follows the tag | The planted-divergence document of §17.8 |
| The single-accessor eslint rule | Downgrade to `'warn'`; the guard test must still fail, and the allowlist contents are asserted |
| The v8 version predicate | A document tagged `9` |
| Migration identity | Corpus-wide, plus the structural assertion, in both engines |
| A full reclaim redeems properly | A reclaim that clears the balance before any sale must still charge the exit fee exactly once, equal to the same document's fee when the sale redeems instead |
| A partial reclaim does not redeem | A reclaim smaller than the balance charges no exit fee and sets no redemption state |
| The server-side `vat` deep-merge | Delete it; a stored-row test must fail |
