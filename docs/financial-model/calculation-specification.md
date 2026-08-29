# Calculation Specification — Commercial-to-Residential Development Appraisal

**Status:** Authoritative. Calculation version `2.17.0`.
**Date:** 29 August 2026
**Scope:** Defines every financial quantity the application computes, stores or reports. Any output not derivable from this specification must not be displayed to a user or exported. The monthly engine described here is the single source of truth; no UI page, report, export or backend endpoint may re-implement a formula defined here.

**Changelog:**
- **2.17.0** — the standard lender stress pack (§25, R16), with inputs v15 adding four `ScenarioOverrides` fields, all written at their identity zero: `saleable_area_adjustment_pct`, `abnormal_cost_adjustment_pct`, `programme_slip_months` and `refi_ltv_adjustment_pct`. §12.1's lever table goes from nine rows to thirteen — `saleable_area` (unit areas **and** values, §25.1), `abnormal_cost` (the `abnormal` contingency class, §16.3), `programme_slip` (every predecessor-free phase of the network, §18.9) and `refi_ltv` (the take-out's LTV cap, §19.8) — and gains its first two pairs of levers writing a **shared** field: `saleable_area` with `gdv` (`estimated_value_pence`) and `programme_slip` with `phase_slip` (`slip_months`). Both composition orders are stated there — immaterial for the additive pair, and **area first, then `gdv`, each rounding once** for the other, which is why a cell now applies its settings newest lever first rather than in caller order. `STRESS_PACK` is a closed, normative list of nine stresses (§25.2), each run as one §12.5 cell through §12.7's validity rule, two of them carrying settings derived from the base document (§25.3) — one average unit's share of area and value, and the recorded due-diligence risks crystallising, which is §23.9's note built. An inapplicable stress is measured, marked and printed with the fact it lacks (§25.4). Memo §10 and the Sensitivity page print the nine rows; the Scenarios page gains an input for every remaining `ScenarioOverrides` field, and both the scenario cards and the memo's comparison adopt §12.7 in place of appraising an unvalidated levered document (§25.6). Calc 2.17.0 (R16) adds §25's stress pack and four levers. **It changes no existing computed value** — the v15 identity gate compares metrics (flags strictly), ledger, schedule and, on four named fixtures, the default sensitivity suite, with no exclusion. §23.9's "recorded for R16's presets" note becomes a historical note.
- **2.16.0** — the cost plan in time (§24, R15b), with inputs v14 adding one nested field, `cost_plan.qs.inflation: { annual_pct } | null`. Every detailed package gains a resolved-phase window, curve and curve-weighted spend midpoint (§24.2, `resolved_phase_id`, `midpoint_month`), a tender-price inflation allowance from `qs.base_date` to that midpoint (§24.3, `inflation_pence`, `inflation_total_pence` inside `construction_total_pence`), and a per-month lender-eligible draw share that §4.2(b)'s advance cap now reads in place of R14's single ratio (§24.4, `uses[m].lender_eligible_construction_pence`). One flag is added: `no_inflation_allowance`. **It changes `construction_total_pence` on any document carrying a recorded allowance (an additive line; `0` elsewhere) and moves `funding_gap_pence` and its dependent metrics on fixture S alone** — the corpus's one document with packages in more than one spend window and an ineligible package among them; every other document's per-month share recovers R14's uniform-ratio figure exactly (§24.4's recovery claim, asserted corpus-wide). The v13 → v14 identity gate compares metrics, ledger and schedule, the new fields included, on both arms **with no exclusion**, and the flag list is compared with strict equality, `no_inflation_allowance` asserted by name as the sole addition. §16.9 limitations 1 and 2, §16.9's inflation line, §20.5 limitation 3 and §23.11 limitation 6 become historical notes.
- **2.15.0** — the due-diligence evidence schedule (§23, R15), with inputs v13 carrying a non-nullable top-level `due_diligence` block (a captured listing `source_record` and a fixed catalogue of evidenced items whose seed status is `unknown`), `cost_plan.qs` and `CostPackage.price_basis`. Five read-only **derived rows** grade the evidence the model already carried — QS provenance, facility terms, equity sources, the tax and VAT basis, the lender valuation — beside the entered ones. Two **source-conflict** rules compare the captured listing to the appraisal (§23.5), the cost plan publishes fixed-price coverage, provisional sums and the unclassified balance (§23.6), and four flags are added: `due_diligence_unknown`, `source_conflict`, `consent_expires_before_start`, `provisional_sums_present`. §13.3 gains a **seventh FINAL condition** — no entered item may be `unknown` — with its own banner. **It changes no existing computed value:** the v12 → v13 identity gate compares metrics, ledger and schedule, the new result block included, on both arms **with no exclusion**, because a pre-v13 document is computed as §23.10's migration seed. §16.9's QS-provenance limitation and §15.9's measured-survey limitation become historical notes; §22.10 limitation 7 narrows to its per-row residue; inflation and the per-package programme were scheduled as **R15b**, and are delivered by it (§24).
- **2.14.0** — the unit-level sales ledger (§22, R13b): per-unit exchange/completion timing, deposits held or released, per-unit selling-cost overrides, pre-sales coverage, the `sales_slip` lever (§12.1's ninth). **One pre-existing computed value moves: §5.11's phased break-even now replays anchored tranches at their resolved months** (fixture S: 90,971,520 → 88,720,089); every unanchored document is unchanged. §5.12 gains the per-unit cost basis. Inputs v12.
- **2.13.0** — cost-to-complete corrected (§5.10, C1), `lender_eligible` wired into §4.2(b), the monitoring statement (§20, R14). Inputs v11. [Bullet added by R13b; R14 recorded this release in §1.6 and §20 but omitted the changelog line.]
- **R14b, 24 August 2026 — no calculation-version bump and no inputs-version bump.** Lender case governance (§21): the release that makes a FINAL document possible at all. A lender case is a **locked whole-document snapshot** of a stored appraisal — its `inputs_snapshot`, `calc_version`, `inputs_version` and all three provenance hashes, copied at creation and never rewritten — carrying governance state through the eight-status machine `report-provenance.ts` has declared since R7 and nothing has ever populated. §13.3's condition 5 (an approved case) therefore becomes reachable, and gains a sixth condition beside it: an approval is only good for the document it was given against, so a case whose locked `input_hash` no longer matches the live stored row is **stale** and defeats FINAL under a banner of its own (§21.3). The case gets its own hash, `case_hash` (§13.2.1), **chained onto** the locked `audit_hash` rather than folded into it — §13.2's twice-stated "the audit hash gains no new parts" ruling is restated, not repealed, because a case transition happens without an appraisal re-save and would otherwise silently invalidate every stored hash. §13.1's provenance panel gains the case rows, which are the case hash's own components rather than a readable selection of them, so the reviewer-recompute property §13.2 gives the audit hash holds for the case hash too. **No engine change, no input-schema change, no fixture pin moves**: the release is versioned by Alembic migration 006 (two new tables, `lender_cases` and `lender_case_events`) and by this specification's §21, and the corpus-walk tests passing unmodified is itself the no-arithmetic guard. Governance also stops being a one-language concern — `app/financial_model/provenance.py` is created as the Python twin of `report-provenance.ts`'s governance core, under the same porting contract as `monitoring.py`, because the API cannot enforce a state machine that exists only in the client.
- **2.12.0** — the investment case (§19, R13), with inputs v10 adding a top-level `investment_case: InvestmentCase | null` beside `programme`, `vat` and `cost_plan`: a stabilisation schedule (an occupancy ramp reusing §18.6's `PhaseAnchor` resolution), a user-managed schedule of operating lines (a ten-value `OpexCode` enum plus `other`, each fixed pence or a percent of effective gross rent), a net-initial-yield valuation, and a take-out sized as `min(LTV cap, DSCR cap, ICR cap)` with the binding constraint named and all three caps published. `refinance` narrows `investment_value_pence` and `ltv_pct` to nullable — non-null when `investment_case` is null (today's explicit path, unchanged), both null when it is not (§19.1) — and gains an `arrangement_fee_basis`/`arrangement_fee_pct` pair for a percentage arrangement fee on the derived quantum. NOI enters the ledger as its own signed receipt class, applied in full to the senior facility, in the fixed within-month order VAT reclaim → NOI → sales sweep → refinance (§19.5); it is never a sale receipt, so it never enters `gross_sale_pence` or GDV, and it never enters §3 profit — but it legitimately moves every debt-denominated metric (LTGDV, senior break-even, profit-on-GDV) by repaying the facility early, same as any other debt-reducing receipt. `Schedule` gains `investment_case: InvestmentCaseResult | null` (republished, never recomputed) and `resolved_exit_months`, which closes §18.10 limitation 9: the investment memo and `CashflowPage` now read the resolved tranche/refinance month instead of the raw `month_offset` (Task 12; Task 14 shipped the anchor UI control, not this reporting fix — see §18.10 limitation 9's rewrite). §12.1's lever table goes from five levers to eight (`exit_yield`, `operating_cost`, `vacancy`), still disjoint and order-independent; §12.2 gains the take-out carve-out — the take-out is not the committed facility and is re-solved in every cell, deliberately, or the three new levers would be inert. Cell validity for the three degenerate cases (non-positive yield, non-positive occupancy, a negative operating-line value) is existing validation (§19.7 rules 8, 9, 11), not new sensitivity logic — `measure()` already routes every levered document through validation before appraising (§12.7). The migration gate is numeric **and** validation-side, the latter as three separately-falsifiable properties (§19.9), following §18.7's corrected shape from the start. §4.5 is **superseded for the `investment_case != null` case**; its explicit `investment_value_pence × ltv_pct` path is unchanged and remains live. **No existing computed value changed** — `investment_case = null` is bit-identical to calc 2.11.0, corpus-wide, in both engines.
- **2.11.0** — the dated, dependent programme (§18, R12), with inputs v9 carrying `programme` as a **precedence network**: phases with an `id`, a fourteen-value `code` enum plus `other`, a signed `slip_months`, an earliest-start floor `start_offset` and `FS`/`SS` predecessors with lags; a derivation that computes every start, a backward pass that reports total float and the critical path; cost lines that resolve to a phase (`line.phase_id ?? category_phase_ids[line.category]`, §18.5) and spend over that phase's derived window; sale tranches and `refinance` that may **anchor** to a phase; a fifth sensitivity lever, `phase_slip` (§12.1, §18.9); and a hard `programme.overrun` error where the derived finish passes maturity — never a clamp (§18.8). **No existing computed value changed** — `programme = null` remains the auto-window path of §6, bit-identical to calc 2.10.0, and the v8 three-package shape migrates to three predecessor-free phases whose derived windows *are* the old windows by construction rather than by arithmetic coincidence (§18.7). §6.1 is **superseded for the explicit-programme case** and §6's auto-window text is unchanged and remains live. The migration gate is numeric **and** validation-side, the latter as three separately-falsifiable properties rather than one set equality (§18.7), because §18.8's overrun rule has no v8 counterpart at all. §12.1's lever table goes from four levers to five, still writing to disjoint fields and still order-independent; §12.6 gains the `phase_id` target rules; §16 gains the phase-resolution note for packages and fee lines. Spreading is per **(phase, category) bucket**, not per line — the auto and legacy arms spread a category total exactly once, and bucketing is what keeps penny-identity true by construction (§18.5, §18.10 limitation 7).
- **2.10.0** — VAT and TOGC (§17, R11), with inputs v8 carrying a `vat` block: registration, a return cycle (monthly or quarterly, with a repayment lag), six fixed per-category treatment rows (rate, recoverable proportion, recovery basis, evidence status) resolved through one accessor, and a purchase/TOGC block that decides whether acquisition VAT is chargeable and whether the acquisition tax base is VAT-inclusive. **No existing computed value changed, with one named exception (ruling R46)** — migration writes `registered: false`, six zeroed treatment rows and an inert purchase block, which drives every resolved rate to zero and the chargeable consideration back to the exclusive price, so all twelve-plus golden fixtures (now thirteen, with the VAT worked cycle pinned as fixture R) reproduce every reported metric to the penny, and the gate is numeric **and** structural for the same reason §16.3's was (§17.11). §3.8 gains `irrecoverable_vat_pence` as a cost-before-finance component; §7 gains the VAT reclaim as a third flow excluded from both sides of the sources-and-uses identity, alongside sale-proceeds repayments and refinance-shortfall equity; §16.3's contingency base is now the package tag, mode-dependently, with the input fields `basis`/`package_ids` deleted (the *result* shape is unchanged). **The one figure this release does move**: §17.8 makes the package's `contingency_class` tag live, so a detailed-mode document carrying a non-zero percentage on `existing_building` or `abnormal` while no package carries that tag now resolves that class's base to zero, where before every class resolved against the whole base build regardless of tag — the same reachable shape §17.8's planted-divergence guard exists to catch, here on the validation side rather than the numeric one. §17.9 adds a **warning** naming it (not an error — see ruling R46, and the R38/R39 regression gate this does not touch, since it reads `cost_plan` which is unchanged either side of the v7→v8 boundary), and no fixture in the corpus is in that shape. §16.9 loses the `contingency_class`-not-live limitation (now resolved) and the "No VAT" limitation (now superseded by §17.13's own list, which is where a VAT limitation belongs from this release on).
- **2.9.0** — cost plan modes (§16, R10), with inputs v7 carrying a `cost_plan` block: a `headline` mode (rate × area, unchanged) and a mutually exclusive `detailed` mode (a priced package schedule), three named contingency classes each rounding independently against its own resolved base, and professional/statutory fee lines carrying a fixed or percentage basis. **No existing computed value changed** — migration copies `contingency_pct` into the `general` class on the `all_packages` basis and the eight legacy fee fields into `fixed` fee lines, and both engines route every document, pre- and post-migration, through the same `cost_plan` engine, so "all twelve golden fixtures identical to the penny" is an assertion that could fail rather than one that is structurally blind (§16, following R9's precedent). §3.4's contingency term is replaced with the three-class formula; §3.5/§3.6 are replaced with the fee-line formulation and its two base definitions; §1.6 records inputs v7. §13.2 gains a stated limitation: a stored appraisal not yet re-saved across this boundary prints an `inputs_version` beside an `audit_hash` computed under the prior version, so the hash cannot be recomputed from the printed fields for that row.
- **2.8.0** — the area bridge (§15, R9), with inputs v6 carrying an entered `areas` block and per-unit `ancillary`. The scheme now has one area statement that ties, and the construction-cost area is **derived** from it rather than asserted independently: §15.3's basis switch chooses between the derived developed GIA and the pre-R9 manual field, and §15.4 makes reading that field outside one accessor a build failure. Ancillary parking, balconies and terraces are valued as a separate GDV component (§3.1, §15.5) that sells with its unit and moves with a §12.1 GDV stress. **No existing computed value changed** — migration writes the manual basis with a zeroed bridge and zeroed ancillary, which is a tested claim, not an assertion (see `migration-notes.md`). §3.1's formula and Included lines are corrected to state GDV as internal plus ancillary value, and the unpaid R3 pointer that excluded parking "until valued separately" is removed rather than repointed; §3.2's `global_per_sqft` lender basis is bound explicitly to internal net internal area; §2 gains four derived-area definitions. §15.6's rules replace the ±25% unit-NIA-vs-construction-area warning, which is deleted rather than retuned. R9 also clears an R8 carry-forward: acquisition-date validation is now a real calendar check in both engines, so `2026-02-31` no longer validates (§14).
- **2.7.0** — jurisdiction-aware acquisition tax: SDLT (England/NI), LBTT (Scotland) and LTT (Wales) computed from a dated, sourced and versioned band table (§14, R8), with inputs v5 carrying the jurisdiction, its evidence status, the acquisition date and a reasoned override. **No existing computed value changed** — §1.6 explains why. §3.3's formula term is renamed from `SDLT` to `acquisition_tax` and its false "other jurisdictions are out of scope" sentence is deleted; §3.18 records that the RLV is invariant to it; §13.1 gains the table version and applied jurisdiction; §13.3 gains a fourth draft condition. What does change in practice is that every pre-R8 document is marked DRAFT until **both** its jurisdiction is confirmed **and** an acquisition date is recorded — migration leaves the date null, so confirming the jurisdiction alone is not enough (§14.6).
- **2.4.0** — fixed-facility sensitivity suite: the two-way matrix, the tornado, and their shared lever and validation rules (§12, R4). No existing computed value changed — §12 only composes calls to the existing appraisal engine over levered copies of an inputs document, it does not alter any formula — which is why this is a minor bump, not a major one.
- **2.3.0** — phased-sales sweep (§4.4.1), refinance event (§4.5), §5.11 phased regime, declining redemption schedule, `facility_redrawn_after_redemption` flag (R3b); no numeric change for inputs with null `sales_phasing`/`refinance`. Also corrects §3.12's refinance-profit wording to match §3.11 and the engine (a refinance is a financing event and does not enter profit) — a **specification** correction only, no computed value changed.
- **2.2.0** — dated programme + spend curves (R3a); flags moved onto the result object; no numeric change for migrated v3 inputs.
- **2.1.0** — new optional `lender_valuation` input block and `finance.enforcement_cost_assumption_pence` field (§2); no existing formula's computed value changed.

Implementation release markers: **[R1]** implemented in Release 1 (P0 financial correction); **[R2]** defined now, implemented later; **[R3a]** Release 3 programme engine (calc 2.2.0, implemented); **[R3b]** Release 3 phased exits (calc 2.3.0, implemented); **[R4]** Release 4a sensitivity engine (calc 2.4.0, implemented in both engines); Release 4b added the Sensitivity page that consumes it, so §12 now has a user-visible surface. A metric whose marker means "defined now, implemented later" — R2, or a bare R3 — must be displayed as "not available" (never a substitute formula) until implemented; markers recording work already shipped (R1, R3a, R3b, R4, R5, R6, R7, R8, R9, R10, R11, R12) carry no such restriction.

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

`null`/absent means **unknown**; `0` means **known to be zero**. Unknown lender-critical inputs (e.g. lender GDV, day-one advance) must never be defaulted silently: dependent metrics return `null` ("not available") and the reconciliation panel lists the missing input. Unknown is never treated as safe/green. **[R15 — calc 2.15.0]** The due-diligence schedule is that rule's second application: every catalogue item seeds `unknown` and the migration writes it explicitly rather than by absence, so an unexamined item says so instead of being silent, and a `green` recorded without evidence is a hard validation error rather than a status quietly downgraded (§23.9).

### 1.6 Versioning

Every appraisal document carries `calc_version` (semver of this specification's implementation) and `inputs_version` (schema version of the input document): `1` = legacy pre-spec snapshot; `2` = this specification (calc 1.0); `3` = calc 2.x (adds optional `lender_valuation` block); `4` = calc 2.2.0+ (adds optional `programme`, `sales_phasing`, `refinance` blocks); `5` = calc 2.7.0+ (adds jurisdiction, acquisition date and acquisition tax override); `6` = calc 2.8.0+ (adds the entered `areas` block and per-unit `ancillary`, §15); `7` = calc 2.9.0+ (adds the `cost_plan` block: mode, package schedule, three contingency classes, fee lines, §16); `8` = calc 2.10.0+ (adds the `vat` block and the per-line `vat_override`, §17); `9` = calc 2.11.0+ (turns `programme` into a precedence network and adds `phase_id` on packages and fee lines, `anchor` on sale tranches and `refinance`, and the two `phase_slip` scenario fields, §18); `10` (**inputs v10**) = calc 2.12.0+ (adds the top-level `investment_case` block and narrows `refinance.investment_value_pence`/`ltv_pct` to nullable alongside a new `arrangement_fee_basis`/`arrangement_fee_pct` pair, §19); `11` (**inputs v11**) = calc 2.13.0+ (adds the top-level nullable `monitoring` block, §20); `12` (**inputs v12**) = calc 2.14.0+ (adds the top-level nullable `unit_sales` block and the `sales_slip_months` scenario field, §22); `13` (**inputs v13**) = calc 2.15.0+ (adds the non-nullable top-level `due_diligence` block, `cost_plan.qs` and `CostPackage.price_basis`, §23); `14` (**inputs v14**) = calc 2.16.0+ (adds `cost_plan.qs.inflation`, §24); `15` (**inputs v15**) = calc 2.17.0+ (adds the four stress-pack scenario fields, §25). Outputs are only comparable within a `calc_version`. Calc 2.6.0 (R7) adds §3.16.1's realisation basis and §13's report provenance; it moves `equity_multiple` from `0` to `null` for schedules with no realisation event and changes no other computed value.

Calc 2.17.0 (R16) adds §25's standard lender stress pack, four sensitivity levers and the four
inputs-v15 scenario fields they are written through. **It changes no existing computed value** —
every new field migrates as `0`, every new lever is the identity at `0`, and the v14 → v15 identity
gate (`migrate.test.ts` / `tests/test_migrate_v15.py`) compares metrics **including flags,
strictly**, the ledger, the schedule and — on four named fixtures — the whole default-config
`SensitivityResult`, **with no exclusion and no tolerance**. The sensitivity arm is new to this
gate and is what proves §25.1's change to how a cell composes its settings (newest lever first,
not caller order) moved nothing.

Calc 2.16.0 (R15b) adds §24's package timing, tender-price inflation and per-month lender-eligible construction share, and one flag. **It changes `construction_total_pence` on every document carrying a recorded inflation allowance** (a new additive line inside it; `0` on every document that does not) **and moves `funding_gap_pence` and its dependent metrics on fixture S**, the corpus's one document with packages in more than one spend window and an ineligible package among them — every other document's development-cost advance cap recovers R14's uniform-ratio figure exactly (the v13 → v14 identity gate, `migrate.test.ts` / `tests/test_migrate_v14.py`, compares metrics, ledger and schedule on both arms with no exclusion, and asserts `no_inflation_allowance` by name as the sole flag addition).

Calc 2.15.0 (R15) adds §23's evidence schedule, four flags and §13.3's seventh condition. **It changes no existing computed value** (the v13 identity gate, `tests/test_migrate_v13.py`, compares the new result block on both arms with no exclusion).

Calc 2.13.0 (R14) corrects §5.10's remaining-funding term for rolled-up facilities (C1), wires `lender_eligible` into §4.2(b), and adds §20's monitoring statement. **It changes `cost_to_complete` on every rolled-up facility with an interest reserve** — the corrected figure; every other computed value on every existing document is identical (the v11 identity gate, `tests/test_migrate_v11.py`).

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
- **Per-unit regime [R13b — calc 2.14.0]:** when `unit_sales` is non-null each sold unit's agent fee is `round(gross_u × (agent_fee_pct ?? selling_agent_fee_pct)/100)` and its legal fee is its own `legal_fee_pence` or its pro-rata share of `selling_legal_fee_pence` (§22.2); `selling_costs_pence` is the **sum of the units**, which can differ from the formula above by rounding. The two regimes are distinct, not one formula with a special case.

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
2. Senior development advances fund the remainder, capped by (a) `undrawn_net_facility`, (b) `development_cost_advance_pct` × (lender-eligible construction for the month + professional + statutory) [R14 — calc 2.13.0, a uniform ratio applied to the whole construction line; superseded by a per-month figure in R15b — calc 2.16.0, §24.4], and (c) gross facility headroom after projected interest.

   The cap base of (b) is `uses[m].lender_eligible_construction_pence + uses[m].professional_pence + uses[m].statutory_pence`, and the product with the percentage is rounded once. `uses[m].lender_eligible_construction_pence` is the schedule's own per-month figure (§24.4): the month's construction spend times that month's lender-eligible share, computed from the same package weights the spend curve uses, and falling back to `lender_eligible_ratio` in a month with no package spend at all. `lender_eligible_ratio` itself stays on the cost plan (§16.8) as the disclosure figure and that fallback: `1` in headline mode, `1` in detailed mode when `base_build_pence` is 0, and `lender_eligible_base_pence / base_build_pence` otherwise — an unrounded quotient in `[0, 1]` by construction, because both sums run over the same package set (§16.2). `uses.vat_pence` is not in the base and never has been (§17.6).

   **[R14 — calc 2.13.0; superseded by §24.4 in calc 2.16.0]** The ratio was uniform across the whole construction line, so contingency and compliance followed it proportionally; that was a stated limitation (§16.9), not a per-package profile. §24.4 replaces it with a per-month share that recovers this exact figure on every document whose packages share one spend window, and departs from it only on fixture S.
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
- Per-unit regime [R13b — calc 2.14.0]: when `unit_sales` is non-null (mutually exclusive with `sales_phasing`, §22.7 rule 1) each unit's receipt lands in its own resolved completion month, and a released deposit lands in its exchange month — §22.3.
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

#### 4.5 Refinance event [R3b — calc 2.3.0] [superseded for `investment_case != null` — §19.4, R13, calc 2.12.0]

**This section is superseded when `investment_case` is non-null: §19.4 derives
the take-out quantum from NOI and the three caps, and §19.4's "the refinance
event" subsection restates this section's mechanics — the sweep-first order,
the once-only exit fee, the shortfall-to-equity treatment — against that
derived quantum instead of the explicit one below. Where `investment_case` is
null, this section is unchanged and remains the live path, byte-identical.**

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

### 5.10 Cost-to-complete [R2 — calc 2.1.0; corrected R14 — calc 2.13.0]

For each month `m` in `1..term` (`m` labels the state as of completion of ledger month `m−1`; `m = term` is the terminal "nothing left to spend" checkpoint): **remaining cost** = future development costs from ledger month `m` onward (acquisition/construction/professional/statutory — contingency is already inside the construction cost line, §3.4/§6, never a separate additive term) + future lender ancillary fees + forecast finance to completion (future interest accrued + future capitalised fees, read straight off the already-computed ledger horizon). **Remaining funding** is the sum of three terms. The second is new in R14 and is reported as its own per-month column, so a reader can see how much of the reported funding is reserve rather than facility or equity:

```
remaining_funding(m) = undrawn_net_facility(L)
                     + reserve_headroom(L)
                     + max(0, cash_equity_total − cum_equity_contributed(L))

reserve_headroom(L)  = rolled_up ? max(0, committed_gross − committed_net
                                          − cum_interest_capitalised(L)) : 0
```

where `L` is ledger month `m−1`, the most recent month whose draw and contribution have happened by label `m`. **(a) Undrawn committed net facility** as of `L` — 0 for cash deals, where no facility exists. **(b) The unconsumed interest reserve** [R14 — calc 2.13.0]: for a rolled-up facility, the gross facility less the net facility less cumulative capitalised interest through `L`, floored at 0, and reported as `remaining_interest_reserve_headroom_pence`. `committed_gross` and `committed_net` are the ledger's own figures (§2; gross is `committed_gross_facility_pence` where set, else `net + interest_reserve_pence`). It is 0 for serviced interest (§4.3), 0 for a cash deal, and 0 for a rolled-up facility carrying no reserve — in each of those three cases the series is exactly what calc 2.1.0 computed. **(c) Committed cash equity not yet contributed**, floored at 0 — only cash-classified equity sources count as committed funding, per §2; land/planning-uplift/vendor-finance/deferred-consideration equity is not, and no other committed-funding category is modelled. Reports remaining cost, remaining funding, surplus (`funding − cost`), first shortfall month (first `m` with surplus `< 0`, else none), maximum shortfall (largest deficit across the series, floored at 0). The series is derived from the already-computed ledger, which carries the dated programme when `programme` is set and the calc-2.1.0 auto windows otherwise (calc 2.2.0, [R3a]).

**Known limitation (calc 2.1.0):** this series is a static snapshot of committed sources against forecast cost, not a re-simulation of the ledger's own month-by-month throttling (gross-facility headroom cap, §4.2(c); the development-cost advance-percentage cap, §4.2; uncommitted "additional equity" silently absorbing a serviced-interest shortfall, §4.3). Neither direction of "no cost-to-complete shortfall ⇔ the ledger never flagged `funding_gap`" is a general property of the engine — a headroom-capped fixture proves a real `funding_gap` can exist with no cost-to-complete shortfall, and a constructed high-rate serviced-interest scenario proves the reverse (a cost-to-complete shortfall with zero `funding_gap`, absorbed instead by uncommitted additional equity). Only "the series reports a shortfall ⇒ the ledger recorded a `funding_gap` somewhere" is asserted as a test, and it is verified across the fixtures in the current test corpus, not proved as a universal law — see `docs/financial-model/test-cases.md`'s cost-to-complete section for the counter-examples and the scope of what is and isn't tested.

**The third counter-example, closed [found R9 — calc 2.8.0; closed R14 — calc 2.13.0].** **The defect, in one line:** remaining funding counted only the undrawn *net* facility while remaining cost counted future rolled-up interest — but rolled-up interest never consumes the net facility (§4.2); it capitalises against the *gross* facility's headroom — so any facility structured the way a real development facility is structured (net sized to the costs, interest reserve carved out of the gross) reported a phantom shortfall. `fixtures/financial-model/p-scotland-levered.json` reported a 392,483p shortfall at `m = 1` against a ledger whose `funding_gap_pence` is 0, because its 3,913,416p of rolled-up interest capitalised into 8,000,000p of gross headroom exactly as intended. It was **closed in R14 (calc 2.13.0) by crediting the unconsumed interest reserve** — term (b) of the definition above. Fixture P now pins `cost_to_complete_first_shortfall_month: null` and `cost_to_complete_max_shortfall_pence: 0`, and the old figures `1` / `392483` are carried as its **negative controls** in both engines, so the phantom cannot return unnoticed. The correction is not one-sided: `fixtures/financial-model/v-exhausted-reserve.json` is a rolled-up facility whose reserve is deliberately too small for the interest it must carry, and it pins a real, non-zero shortfall together with a real `funding_gap_pence` of 704,021 — the corpus's positive case, hand-derived in `docs/financial-model/test-cases.md` §20.1. **The rejected correction, and why:** dropping rolled-up interest from *remaining cost* was considered and rejected (R14 design decision 2). It is equivalent to the chosen correction only while the reserve covers the forecast interest; once the reserve is exhausted it hides a real shortfall, and the exhausted case is the one a lender cares about. Crediting the funding side keeps both sides carrying interest, so the surplus is unaffected by interest while the reserve covers it and reports the excess as a shortfall — §5.8's exhaustion, as a reconciled number rather than a flag beside a phantom one.

### 5.11 Senior repayment break-even [R2 — implemented in calc 2.1.0]

Minimum gross sale price `P` such that `P = redemption_balance_at_disposal + exit_fee + disposal_costs(P) + enforcement_cost_assumption`. Solved iteratively because disposal costs depend on `P`. Reported absolute, as % of lender GDV, and as the % fall from lender GDV before senior exposure. Never computed as "GDV vs TDC" — the pre-R1 "senior debt impairment" figure is removed in R1.

This is the `sales_phasing = null` regime, unchanged. See below for the phased regime.

Phased regime [R3b — calc 2.3.0; corrected R13b — calc 2.14.0]: when
`sales_phasing` or `unit_sales` is non-null, the
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

**Resolved months [R13b correction].** The replay places each tranche at the month the ledger used — §18.6's resolved month, read off the schedule's `resolved_exit_months` — not the entered `month_offset`. From calc 2.3.0 to 2.13.0 the replay read the raw offset, so an anchored tranche on a slipped programme replayed receipts at a month the ledger never used (fixture S, whose tranches resolve to 16/19 while their offsets read 20/21: 90,971,520 → 88,720,089). The tranches resolve to 16/19 against raw 20/21 — four and two months earlier — and the exit fee on S is a fixed-basis constant, so only rolled-up interest falls; this is not a reduction "less exit fee". The structural-unsolvable test ("draws continue after the final tranche") reads the same resolved months, so it can now fire — correctly — for a document whose anchored disposal precedes its last draw.

**The receipt-lines arm [R13b — calc 2.14.0].** Under `unit_sales` the replay's receipts are a list of dated lines `{ month, base_gross, agent_fee_pct, legal_fee_pence }` — one per released deposit (no costs) and one per completion (gross less the released deposit, the unit's effective agent rate, its fixed legal) — sorted by month then unit order. At trial total G every line's gross is `round(base_gross × G / G_base)` with the last line absorbing the residue; agent fees scale with the line's gross; legal fees are fixed; the enforcement-cost assumption comes off the first line. The uniform price-fall assumption is unchanged — deposits scale with price because they are a percentage of it. The fee reservation, the VAT-reclaim ordering and the bisection are untouched. Under the lines arm the replay's exit-fee reservation (already this section's documented conservative assumption) is paid once per **sweep event** — one per distinct receipt month, so lines completing in the same month reserve it once — and a document with released deposits has more sweep months than its held twin, so its phased break-even is MORE conservatively overstated: fixture X (equity 30,850,000, covering its month-0 acquisition use exactly, no funding gap, `report_safe`) prints 36,624,486 (released) vs 35,238,880 (held) at its 1% gross-facility exit fee, while with the exit fee at zero the ordering is the intuitive released 33,522,952 < held 33,664,679.

### 5.12 Developer profit break-even [R2 — implemented in calc 2.1.0]

Minimum gross sale price giving zero developer profit: `TDC` restated at the break-even receipts (selling costs re-solved). Distinct metric from §5.11, never conflated.

Per-unit regime [R13b — calc 2.14.0]: the re-solved selling costs use the ledger's **effective blended agent rate** `Σ agent_u / G × 100` and the **summed** legal `Σ legal_u`, so the cost reproduces the ledger's own at `P = G` and scales the agent component with price as the ledger would.

---

## 6. Spend profiles [R1 minimal]

R1 supports `straight_line` over a window (construction: months 1..N−2 of the term, minimum 1 month; professional/statutory: first half of that window) — the v1 shape, now explicitly disclosed as an assumption on the cash-flow page and in reports. **Odd windows round up:** where an auto-derived window spans an odd number of months, its "first half" is `ceil(D/2)` months, `D` being the construction window's length — so a 7-month construction window gives a 4-month professional/statutory window, not 3. Rounding: each month rounds half-up; the final month of a window absorbs the cumulative rounding residue so the spread sums exactly to the total (invariant). The complete set of spend curves is defined in §6.1 (calc 2.2.0, [R3a]): `straight_line`, `s_curve`, `back_loaded`, and `user_defined`. An `upfront` curve was planned but removed before implementation — it is expressible via a 1-month window or user_defined weights concentrated in month 1.

**[R15b — calc 2.16.0]** Every detailed-mode package on this auto path shares this one construction window — there is no per-package resolution below it — so every package here has the same spend midpoint (§24.2).

**Note (calc 2.1.0):** §5.10 cost-to-complete is derived directly from the ledger, which follows this straight-line schedule when `programme` is null (remaining cost per month = totals less cumulative spend to date under this profile) and the dated programme (§6.1, calc 2.2.0, [R3a]) otherwise — the relationship is unchanged, not redefined, either way.

### 6.1 Dated programme [R3a — calc 2.2.0]

> **Superseded for the explicit-programme case by §18 (calc 2.11.0). The
> `programme = null` auto-window rules in §6 above are unchanged and remain
> live.** From inputs v9 an explicit `programme` is a precedence network of
> phases, not three independent packages; the three-package shape below does
> not survive migration (§18.7). What is retained verbatim from this section
> and re-used by §18 is the **curve catalogue** and its residue-absorption
> invariant, and the **sale-tail rule**, now scoped to the pre-completion
> codes (§18.8). Read the rest of this section as the historical statement of
> the v4–v8 shape.

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

A **lever** is one named adjustment applied to an inputs document. There are thirteen:

| Lever | Unit | Effect on the inputs document |
|---|---|---|
| `gdv` | percent | scales every `unit_mix.units[].estimated_value_pence` |
| `construction_cost` | percent | scales `conversion_costs.construction_cost_per_sqm_pence` |
| `timeline` | months | adds to `finance.term_months` |
| `interest_rate` | percentage points | adds to `finance.annual_interest_rate_pct` |
| `phase_slip` [R12 — calc 2.11.0] | months | adds to `programme.phases[<id>].slip_months` for a **named** phase (§18.9) |
| `exit_yield` [R13 — calc 2.12.0] | percentage points | adds to `investment_case.valuation.cap_yield_pct` (§19.8) |
| `operating_cost` [R13 — calc 2.12.0] | percent | scales every `investment_case.operating_lines[].value` (§19.8) |
| `vacancy` [R13 — calc 2.12.0] | percentage points | **subtracts** from `investment_case.stabilisation.stabilised_occupancy_pct` (§19.8) |
| `sales_slip` [R13b — calc 2.14.0] | months (signed) | adds to every `unit_sales.units[].completion` — `anchor.offset_months` when anchored, else `month_offset` (§22.8) |
| `saleable_area` [R16 — calc 2.17.0] | percent | scales every `unit_mix.units[].floor_area_sqm` **and** `estimated_value_pence`; area exact, value rounded once; ancillary untouched (§25.1) |
| `abnormal_cost` [R16 — calc 2.17.0] | percentage points | adds to the `abnormal` contingency class's `pct` (§16.3, §25.1) |
| `programme_slip` [R16 — calc 2.17.0] | months | adds to `programme.phases[i].slip_months` for **every** phase with `predecessors = []` — the network's sources (§18.9) |
| `refi_ltv` [R16 — calc 2.17.0] | percentage points | **subtracts** from `investment_case.takeout.ltv_cap_pct` (§19.8) |

A percent lever of `p` multiplies its target by `(1 + p/100)` and rounds half-up to
integer pence (§1.1). A months or percentage-point lever adds its value directly.
`vacancy` is the one exception to "adds": it subtracts, because a vacancy stress
lowers occupancy — a positive `vacancy` value is a worse position, matching the sign
convention every other stress lever already carries (a positive `interest_rate` or
`construction_cost` value is also the adverse direction). **[R16 — calc 2.17.0]**
`refi_ltv` is the second exception: it subtracts from the take-out's LTV cap, so a
positive value is again the adverse direction.

Nine of the thirteen levers write to **disjoint input fields** — each to a field no
other lever touches — so applying several of those to one document is order-independent.
**[R16 — calc 2.17.0]** Two pairs share a field: `saleable_area` with `gdv`
(`estimated_value_pence`), and `programme_slip` with `phase_slip` (`slip_months`). Each
pair's composition rule is stated below, as this section requires. Any lever added in a
later release that shares a field with an existing lever must define its composition
order in this section at the same time — a standing requirement that R16 is the first
release to discharge rather than to satisfy vacuously, and that remains in force for
every lever after it.

**[R16 — calc 2.17.0] `saleable_area` and `gdv`'s composition order, and the
application order it fixes for every cell.** The two share
`unit_mix.units[].estimated_value_pence` — the first pair of levers in this
specification whose order of application is **not** immaterial. The order is
**`saleable_area` first, then
`gdv`**, each rounding half-up to pence once:
`v₂ = round(round(v × (1 + a/100)) × (1 + g/100))`. `apply_scenario` / `applyScenario`
applies its two arms in exactly that order within one call: `saleable_area` scales the
unit's `floor_area_sqm` (exactly, as a float) and its `estimated_value_pence` (rounded
once), and `gdv` then scales the already-rounded value. Half-up rounding is not
commutative across two sequential percentage applications, so the order is load-bearing:
at `(saleable_area = −10, gdv = +10)` a unit value of `1,000,005p` composes to
**990,006** in the stated order and to 990,005 in the other, in both engines
(`test-cases.md` §25.4).

To make that same order hold when the two arrive as two *separate* cell settings,
`_measure` / `measure` applies a cell's settings **newest lever first** — sorted into
**descending `LEVER_ORDER`**, so `saleable_area` (index 9) is applied before `gdv`
(index 0) — rather than in caller order. The sort is stable and total, so a
`(gdv, saleable_area)` matrix and its transpose measure the identical cell, and the
several-orders property is kept by construction rather than by luck. For every pair but
`saleable_area`/`gdv` the sort direction changes nothing — nine levers each write their
own field, and `phase_slip`/`programme_slip` are additive integers whose order is
immaterial; the v14 → v15 identity gate asserts exactly that by comparing the whole
default sensitivity suite on both arms (§25.7).

**[R16 — calc 2.17.0] `programme_slip` and `phase_slip` share `slip_months`.** Both are
additive integers, so their order is immaterial — stated here as this section requires,
and covered by the several-orders test on fixture S. `abnormal_cost` and `refi_ltv`
share no field with any other lever.

**[R16 — calc 2.17.0] An absent key reads as its seed.** Both engines read the four v15
`ScenarioOverrides` fields defensively (`?? 0` in TypeScript, the pydantic default in
Python), because a raw pre-v15 document can reach `applyScenario` unmigrated: an absent
key is not an error and is not a distinct state, but reads as the seed value the
migration would have written (§25.1, §25.7).

**`exit_yield`, `operating_cost` and `vacancy`'s composition order, stated at the time
they are added, as this section requires.** The three write
`investment_case.valuation.cap_yield_pct`, `investment_case.operating_lines[].value` and
`investment_case.stabilisation.stabilised_occupancy_pct` respectively, and nothing else
under `investment_case` and nothing outside it — no other lever touches any of those three
fields, so all eight levers remain disjoint and their application remains
**order-independent**, asserted by the existing all-levers-in-several-orders test gaining
three entries rather than merely stated. None of the three carries a target, so — unlike
`phase_slip`, which keys its duplicate checks on `(lever, phase_id)` — their duplicate
checks key on `lever` alone. On a document with `investment_case = null` all three are
**no-ops by construction**, exactly as `phase_slip` is on a `programme = null` document: a
zero-width tornado bar is the honest report of a lever with nothing to move.

**`phase_slip`'s composition order, stated at the time it is added, as this section
requires.** `phase_slip` writes `programme.phases[<id>].slip_months` and nothing else.
No other lever touches that field — `gdv` writes unit values, `construction_cost` the
construction rate, `timeline` `finance.term_months`, `interest_rate` the interest rate
— so the five levers remain disjoint and their application remains
**order-independent**. That is asserted rather than merely stated: a test applies all
five levers to one document in several orders and requires identical results (§18.9).
`phase_slip` is the first lever that carries a **target** as well as a magnitude, so
`SensitivityAxis` and `TornadoRange` carry `phase_id` alongside `lever` (§12.6), and
the duplicate checks key the pair `(lever, phase_id)` rather than `lever` alone.

**`sales_slip`'s composition order, stated at the time it is added.** It writes `unit_sales.units[].completion` and nothing else; no other lever touches it, so all nine remain disjoint and application remains order-independent — asserted by the several-orders test gaining an entry, and by a second such test on a document that actually carries a ledger. It carries no target, so its duplicate checks key on `lever` alone. On `unit_sales = null` it is a no-op by construction: a zero-width tornado bar.

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

**The carve-out [R13 — calc 2.12.0]: the take-out is not the committed facility, and is
re-solved in every cell, deliberately.** §19.4's take-out quantum — `min(LTV cap, DSCR
cap, ICR cap)` — is not one of the invariant fields this section names, and read
carelessly against this section's opening sentence it would seem to be: the facility
being invariant could be misread as *all* debt being invariant, which would hold the
take-out at its base-document value in every cell and make `exit_yield`, `operating_cost`
and `vacancy` — all three of §12.1's new levers — inert, since none of them writes
anything the *development* facility reads. §11.8's prohibition is about not
re-underwriting the development debt to rescue an adverse cell; it says nothing about a
sizing calculation whose entire purpose is to answer "how much take-out debt does this
cell's income support", which is a different question in every cell by design. A yield
lever that expanded the exit yield and left the take-out quantum unchanged would measure
nothing. So: `finance.committed_net_facility_pence`, `finance.committed_gross_facility_pence`,
`finance.day_one_advance_pence` and `equity_sources` stay held at base in every cell,
exactly as before; `investment_case.takeout`'s LTV/DSCR/ICR caps and the quantum they
produce are **not** on that list and are recomputed from each cell's own NOI, value and
rate — because that recomputation, not an invariant hold, is what a coverage-driven
sizing lever is testing.

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

- an axis or a tornado bar naming a lever that is not one of the thirteen §12.1 levers;
- an axis with an empty step list, or any non-finite step;
- an axis with more than nine steps (the suite is bounded at 81 cells);
- a row axis and a column axis naming the same **`(lever, phase_id)` pair**;
- a `(lever, phase_id)` pair appearing more than once among the tornado bars;
- a tornado bar whose low is not strictly less than its high, or either non-finite;
- a step, or a tornado bound, for the `timeline` lever that is not a whole number of months;
- **[R12 — calc 2.11.0]** an axis or tornado range with `lever === 'phase_slip'` and `phase_id` null, or with any other lever and `phase_id` set;
- **[R12 — calc 2.11.0]** a step, or a tornado bound, for the `phase_slip` lever that is not a whole number of months.
- **[R13b — calc 2.14.0]** a step, or a tornado bound, for the `sales_slip` lever that is not a whole number of months.
- **[R16 — calc 2.17.0]** a step, or a tornado bound, for the `programme_slip` lever that is not a whole number of months.

The engine is month-indexed throughout (§1.3), so a fractional term has no meaning in the ledger; the `timeline`, `phase_slip`, `sales_slip` and `programme_slip` levers are therefore constrained to whole months at the point of input rather than rounded later. **[R16 — calc 2.17.0]** No other new configuration rule is needed for the four v15 levers: a `saleable_area` step of −100 or below, a `refi_ltv` that takes the cap to zero or below, and an `abnormal_cost` that takes a class negative all reach §12.7's existing mechanism instead — the levered document fails validation (§15.6's area rules, §19.7 rule 8's `0 < ltv_cap_pct ≤ 100`, §16.5's non-negative class percentage) and the position is unmeasured, never clamped (§25.6).

The duplicate checks key the **pair** rather than the lever alone because two `phase_slip` axes targeting different phases are a legitimate matrix, and a tornado may carry one bar per slipped phase. The lever name itself stays a closed set: encoding the target into the lever string (`'phase_slip:planning'`) would have forced the membership check that stops a misspelled lever reaching the engine to be loosened into a prefix match.

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

**[R16 — calc 2.17.0] A stress-pack entry is a cell.** Each of §25.2's nine standard
stresses is measured through this same rule, without exception or amendment: its settings
are applied to the base document, the levered document is validated, and only a passing
document is appraised. An entry whose levered document fails validation is unmeasured and
prints as such (§25.5); a base document that fails raises `InvalidBaseDocumentError`,
exactly as the suite's does. The Scenarios page and the memo's Scenario Comparison, which
until R16 appraised a levered scenario card **without** validating it, adopt this section
too (§25.6).

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
| Lender case id | the live case's `id` (§21.1) | — (this row and the six below are omitted entirely when no case exists) [R14b] |
| Case submitted by | the case's `submitted_by` | "not yet submitted" [R14b] |
| Case reviewer | the case's `reviewer` | "not yet assigned" [R14b] |
| Case decided | the case's `decided_by` and `decided_at`, the timestamp printed **as stored** — the record's own serialisation, which must be canonicalised per §13.2.1 before it can be used to recompute the hash; the reader-friendly date is in the narrative | "not yet decided" [R14b] |
| Approval conditions | the case's `conditions` (§21.2 — set only by `approved_with_conditions`) | — (row omitted unless the case records conditions) [R14b] |
| Case locked audit hash | the case's `locked_audit_hash` — the audit hash **as at lock time**, which is the eighth component of `case_hash` and is not the "Audit hash" row above | — [R14b] |
| Case hash | the case's `case_hash` (§13.2.1) | — [R14b] |

- **The case rows are the case hash's components, and that is why they are there
  [R14b].** They are not decoration and are not a subset chosen for readability.
  Together with the lender-case approval status directly above them and the
  project id near the top, they carry **all eight** parts of §13.2.1's formula:
  the case id, the project id, the status, the three actor names, the decided
  timestamp and the locked audit hash. A reviewer holding the panel can therefore
  recompute `case_hash` from the page and detect after-the-fact alteration of the
  reviewer, the decision, the decider or the approval's status — the property
  §13.2 claims for the audit hash, extended to the governance state that hash
  deliberately does not carry. Dropping a row because it looks like internal
  detail would silently withdraw that guarantee. The approval conditions row is
  the one that is *not* a hash component: it is printed because a conditional
  approval that does not say what its conditions were is not a usable one.
- **Two of the eight are printed for a reader, not for the hash, and must be
  normalised before the recomputation [R14b].** The panel is a document a person
  reads, so it prints two components in a human form rather than in the form that
  was hashed. Both normalisations are mechanical and lossless, and neither is
  optional:
  1. **The status.** The "Lender case" row prints the humanised label — "Credit
     approved", "Approved with conditions" — while the hash takes the underlying
     token, `credit_approved`. Lower-case the printed label and replace its
     spaces with underscores to recover it. The mapping is invertible because no
     status token contains a space and none differs from another only by case.
  2. **The decided timestamp.** It is printed as the record serialises it, which
     is not always §13.2.1's canonical form — a timestamp stored without an
     offset serialises without the trailing `Z`. Apply §13.2.1's rule before
     hashing: treat a missing offset as UTC, then render with microseconds and a
     literal `Z`.

  With those two substitutions the eight components on the page reproduce the
  printed `case_hash` exactly. The property is real; it is simply not
  copy-the-page-verbatim, and stating otherwise would send a reviewer looking for
  a discrepancy that was never there.
- **The locked audit hash gets a row of its own, and must [R14b].** `case_hash`'s
  eighth part is the audit hash **as at lock time**; the panel's "Audit hash" row
  is the *live stored record's*. Those are usually the same value, and the
  temptation is to print one and let it serve for both. They can differ without
  the case being stale: staleness compares `input_hash` alone (§21.3), while
  `audit_hash` also commits to `calc_version`, `inputs_version`, the appraisal's
  status and `outputs_hash` (§13.2) — so a re-save that leaves the inputs
  byte-identical while moving any of those, a recomputation under a new
  calculation version most obviously, moves the live hash on a case that is
  correctly still current. With one row the recomputation would then fail on a
  legitimately FINAL document and the reviewer would have no way to tell that
  from a real alteration. Two rows, and the eight components are always on the
  page. The release gate pins this with a fixture whose two audit hashes
  deliberately differ, so the assertion cannot pass by their coinciding.
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
  003 made the appraisal unique per project, so the project is the stable
  identity, and it is known before the row exists — which lets the value be
  computed in the same place as the other two hashes. [Corrected R14b: this read
  "migration 004" from R7 until R14b, as did two code comments repeating it.
  `004_pa_deadline_dates` adds planning-application dates; the unique constraint
  is `003_unique_project_refs_and_ruleset_version`. A wrong pointer is a defect
  in the same way a wrong number is — it sends the next reader to the wrong
  file — and §21.1 depends on this reasoning, so it is fixed where it is stated
  rather than repeated correctly one section later.]
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

### 13.2.1 The case hash [R14b]

A lender case (§21) carries governance state that moves without the appraisal
moving. It gets its own hash:

```
case_hash = sha256( case_id | project_id | status | submitted_by | reviewer | decided_by | decided_at | locked_audit_hash )
```

joined by the literal `|`, over UTF-8, lower-case hex — the same encoding rules
as §13.2. Eight parts, in that order, and therefore seven separators however many
of the parts are absent. An absent part is the **empty string**, not the word
"null" and not an omitted separator: a case at `draft`, with no actor and no
decision yet, hashes exactly
`case_id|project_id|draft|||||locked_audit_hash`. Fixing the separator count is
what stops two different patterns of absence colliding with one another, or with
a present value. The free-text actor fields (`created_by`, `actor`) are rejected
at the API boundary if they contain the literal `|` or a control character, and
capped at 256 characters — what makes the "no present value collides with the
separator" argument above actually hold, rather than merely hold for names that
happen not to contain a pipe.

`decided_at` is rendered in exactly one canonical form: **UTC, ISO-8601, always
with microseconds, terminated by a literal `Z`** (`%Y-%m-%dT%H:%M:%S.%fZ`). A
naive datetime — which is what SQLite hands back for a value written
timezone-aware — is treated as UTC rather than as local time. Without both
rules a hash computed at write time and a hash recomputed after a read would
disagree byte for byte on the same case, which would make the value useless for
the only thing it exists to do.

- **Chained onto the audit hash, not folded into it.** `locked_audit_hash` is the
  last component; §13.2's six-part formula is untouched, and **the audit hash
  gains no new parts** — the ruling stated twice in §13.1 and §13.2 is restated
  here, not repealed. Two reasons, either sufficient. Extending `audit_hash`
  would rewrite every stored hash on the next save and break the
  reviewer-recompute claim §13.2 makes for existing documents. And a case
  transition happens *without an appraisal re-save*, so a governance component
  inside `audit_hash` would silently invalidate hashes stored against rows nobody
  touched.
- **What the chain binds.** `case_hash` binds the case's governance state to
  `locked_audit_hash`; `locked_audit_hash` binds (via §13.2) the project,
  versions, status, inputs and outputs the lender actually reviewed. The two
  together say: *this reviewer approved this status against exactly this
  document*.
- **Recomputed on every write.** Computed at creation and recomputed on every
  transition, from the case's post-transition values. It moves when the status
  alone moves, which is what makes it a record of the governance state rather
  than of the snapshot.
- **A reviewer can recompute it from the panel, after two normalisations.** All
  eight components are on the provenance panel (§13.1) — `case_id`, `project_id`,
  the status, the three actor names, the decided timestamp, and
  `locked_audit_hash` on a row of its own, distinct from the panel's live "Audit
  hash" row for the reason §13.1's second case bullet gives. Two of them are
  printed in a reader's form rather than the hashed form, and are recovered
  mechanically: **lower-case the printed status label and restore its
  underscores** ("Credit approved" → `credit_approved`), and **canonicalise the
  printed timestamp by the rule above** — treat a missing offset as UTC, then
  render with microseconds and a literal `Z`, since a timestamp stored without an
  offset serialises without one. Both mappings are lossless and invertible, so
  the property §13.2 claims for the audit hash holds here too, on every document;
  what it is not is a verbatim copy of the page into a hash function.
- **Computed in Python only** (`app/financial_model/hashing.py`), stored on the
  case row, never derived client-side: §13.1's "hashes are the server's, never
  the client's" applies unchanged.

### 13.3 Document status and draft marking

A document is **FINAL** only when all seven hold, tested in this order:

1. `reconciliation.report_safe` — hard validations pass.
2. `reconciliation.senior_repaid` — the ledger clears the senior facility within
   the modelled term.
3. `jurisdiction_evidence_status == 'confirmed'` **and**
   `metrics.acquisition_tax.date_basis == 'transaction_date'` — the tax basis
   has been verified: the jurisdiction is evidenced *and* the band set was
   selected by the transaction's own date rather than assumed to be the
   current one (§14.6). [R8 — calc 2.7.0]
4. A confirmed VAT basis (§17.10). [R11 — calc 2.10.0; the table row below was
   missing until R14]
5. `metrics.due_diligence.totals.entered_unknown_count == 0` — no **entered**
   due-diligence item is `unknown` (§23.7). Derived rows (§23.3) do not feed
   this condition. A document carrying no `due_diligence` key at all is **not
   re-graded** against a condition that post-dates it (§14.6's rule for a
   pre-R8 document); every production entry point migrates to v13 before
   running, so every *stored* document is graded. [R15 — calc 2.15.0]
6. An approved lender case: status `credit_approved` or `approved_with_conditions`
   (§21.2).
7. That approval is still current: the case **is not stale** (§21.3) — the live
   stored appraisal's `input_hash` is still the one the case locked. [R14b]

Otherwise the document is **DRAFT** and carries the banner for the **first**
failing condition:

| Failing condition | Banner |
|---|---|
| not report-safe | `DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE` |
| senior not repaid | `DRAFT - SENIOR DEBT NOT REPAID - NOT FOR LENDER RELIANCE` |
| tax basis unconfirmed | `DRAFT - TAX BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE` |
| VAT basis unconfirmed | `DRAFT - VAT BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE` |
| due diligence incomplete | `DRAFT - DUE DILIGENCE INCOMPLETE - NOT FOR LENDER RELIANCE` |
| not approved | `DRAFT - NOT APPROVED FOR LENDER RELIANCE` |
| approved case is stale | `DRAFT - LENDER CASE STALE - NOT FOR LENDER RELIANCE` |

- **The seven conditions are distinct claims and must not be collapsed.** An
  unreconciled run's figures may be wrong. A reconciled run that does not repay
  the senior facility is arithmetically sound and shows a real repayment failure.
  A run whose tax basis is unconfirmed is arithmetically sound *on a basis nobody
  has verified*, and the same holds, separately, of one whose VAT basis is
  unconfirmed (§17.10). A run whose due diligence is incomplete is arithmetically
  sound *with facts nobody has evidenced* — the figures are not alleged to be
  wrong; the evidence behind them is missing (§23.7). A reconciled, repaying run
  with no approved case is a
  correct appraisal that nobody has approved. And a run carrying an approved case
  that has gone stale is a correct, approved appraisal *whose figures are no
  longer the ones anybody approved* — the sharpest of the seven, because it is the
  only one where a reader shown the approval alone would draw exactly the wrong
  conclusion. Printing "UNRECONCILED" over the last six would state something
  untrue about the model.
- **Conditions 6 and 7 are mutually exclusive by construction [R14b].** The stale
  gate is tested *after* the approval gate and therefore fires only when an
  approval exists: a document with no case, or with a live case that is not
  approved, reports `not_approved` whether or not its snapshot has moved. So no
  document ever has both to report, and neither can outrank conditions 1–5. This
  is an ordering property, not a coincidence of the current statuses, and it is
  pinned diagonally in both languages.
- **Why the tax gate is third and not a hard validation [R8].** An unconfirmed
  jurisdiction leaves `report_safe` **true**. Making it false would print "one or
  more hard validations fail" — a claim that the *figures* are wrong, when in fact
  only the basis is unverified. It sits above `not_approved` because a reader needs
  to know the basis is unverified before they read an approval status. This
  ordering is load-bearing and is pinned diagonally in both engines: with no lender
  case in existence, `not_approved` would otherwise win every time and the tax gate
  would be unreachable dead code. [R14b: an approved case can now exist, so the
  diagonal is no longer a hypothetical — the pin holds an ordering a real document
  can reach. "Both engines" also became literally true at this release: until R14b
  the whole `DraftReason` gate lived only in `report-provenance.ts`, and the
  diagonal was pinned once, in TypeScript. `app/financial_model/provenance.py`
  (§21.2) now carries the same gate and `tests/test_provenance.py` mirrors the
  diagonal case-for-case.]
- **`report_safe` deliberately excludes senior repayment** (§7): an appraisal
  intending to refinance later is a valid appraisal. The FINAL gate tests it
  separately, so no document showing an unrepaid senior balance at maturity can
  be issued as final.
- **Until R14b, with no lender case capable of existing, every document was a
  DRAFT — the intended answer of R7–R14, not a gap. R14b (§21) is the release
  that made an approved case, and therefore a FINAL document, possible.** The
  sentence this bullet replaces was written at R7 and stayed true for seven
  releases because the schema, the API and the create path did not exist: the
  status union and its `not_approved` reason were declared, and nothing could
  populate them. §21 supplies the record, the state machine and the approval, so
  the condition is now met or unmet on the facts of a particular document rather
  than unmeetable in principle. The release gate asserts this directly — a
  fixture document with an approved, current case renders FINAL, which is the
  first FINAL document the gate has ever been able to assert.

### 13.4 What a report may claim

- **Cost basis.** In `headline` mode the construction model is a rate × area
  **headline cost estimate** with named allowances, and a report may not
  describe it as a cost plan. In `detailed` mode a report may call it a
  **detailed cost plan**, because it is one in shape — a priced package
  schedule, not a rate × area estimate — but it must say, in the same breath,
  that QS evidence (source, date, status) is not recorded, so as not to claim
  an evidence status the model does not carry (§16.6, §16.9). **[R15 — calc
  2.15.0] That last requirement is now conditional on the document.** In
  `detailed` mode with `cost_plan.qs` recorded, the report prints the QS
  source, the stage, the issue date and the status, together with the
  fixed-price coverage, and **may drop the "QS evidence is not recorded"
  sentence** — the disclosure has been earned away, and a disclosure that
  outlives the gap it described is as misleading as no disclosure at all. With
  `qs` null the sentence stands unchanged, and the construction sub-heading
  itself carries the "QS Evidence Not Recorded" qualifier. Headline mode is
  unchanged (§23.6). [R10 — calc
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
  absent area bridge, the count of unknown due-diligence items (§23.8), and any
  failing governance condition from §13.3.
- **The due-diligence limitation has three arms, and they are not
  interchangeable [R15 — calc 2.15.0].** Every arm is worded over **entered**
  items, because a derived row (§23.3) is not evidence anyone can go and
  gather. With entered items still unknown the report states *"N of M
  due-diligence items remain unknown"*, `M` being `entered_total`; with none
  unknown but assessments outstanding it states *"no entered due-diligence item
  is unknown, but K remain red or amber"*, `K` being `assessed_count`; with
  neither it states *"every entered due-diligence item is evidenced or marked
  not applicable"*. The second and third arms append *"; D derived row(s)
  remain unknown (see Section 9)"* whenever `derived_unknown_count > 0`, so a
  document with nothing entered outstanding but no lender valuation is not told
  that everything is evidenced. Collapsing the middle arm into either neighbour
  would put a false statement in a lender document.
- **Released deposits [R13b — calc 2.14.0].** A deposit the ledger shows as released at exchange is a modelling assumption about the sale contract that the model does not evidence; the memo prints that sentence beside the coverage figure whenever `deposit_release` is `released_on_exchange` (§22.6).

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
- **[R15 — calc 2.15.0]** The due-diligence dashboard's derived `tax_basis` row
  (§23.3) reads **this gate's own predicate** — the jurisdiction evidence status
  and `date_basis`, together with §17.10's VAT half — rather than a second one
  of its own, so the row and the banner can never disagree about the same
  document.

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

  **[R15 — calc 2.15.0] Resolved; kept as a historical note.** §23.2's `measured_survey` catalogue item is the bridge's evidence — the measured survey underlying `areas`, with its source, reference and date, its owner and its status — and an unevidenced one sits `unknown` and makes the document DRAFT (§23.7). What remains true is narrower than the sentence above and belongs to §23.11 rather than here: the evidence attaches to the schedule as a whole, not to an individual area line.

---

## 16. Cost plan modes [R10 — calc 2.9.0]

Before this release the whole construction cost stack was one rate, one percentage and three flat compliance fields, and professional/statutory fees were eight further flat pence fields on the same block. There was nowhere to record a priced QS package schedule, general design-development contingency shared a single percentage with existing-building risk and abnormal risk — the three things a *conversion* lender most wants separated, because they carry different probabilities and different evidence — and the memo printed the string `'On base build cost only'` beside the contingency rate, because nothing computed or displayed the base that sentence described. §16 gives the appraisal a `cost_plan` block (inputs v7) that fixes all three.

### 16.1 The two modes, and their mutual exclusion

```
CostPlanMode = 'headline' | 'detailed'
```

**Headline stays rate × area; detailed is priced lump sums.** The two modes are mutually exclusive, and it is enforced rather than assumed: `headline` mode carrying a non-empty package schedule is a hard validation error, and so is `detailed` mode carrying none (§16.5). Packages deliberately do not each carry their own rate and area — a QS prices a package; the rate is the QS's working, not the appraisal's input. Reintroducing per-package rate × area would recreate the two-numbers-one-fact condition the §15 area bridge exists to remove.

**Note — how a cost line reaches the programme [R12 — calc 2.11.0].** From inputs v9 every `CostPackage` and every `FeeLine` carries an optional `phase_id`, and both modes resolve a line to a phase through the one rule

```
resolved_phase(line) = line.phase_id  ??  programme.category_phase_ids[line.category]
```

where a package's category is `construction` and a fee line's is its existing `FeeCategory` (`professional` | `statutory`). Headline mode has no line rows, so its three totals resolve straight through `category_phase_ids`. There is **one** accessor, and a line's own override and the category default can never both apply. `category_phase_ids` is required whenever `programme` is a network; `phase_id` is `null` on every migrated line. The spreading rule, the milestone prohibition and the `prior_approval` month-0 carve-out are §18.5's.

### 16.2 Packages, and the compliance double-count they would otherwise cause

```
CostPackage: id, code, label, amount_pence, contingency_class, lender_eligible, notes
```

`code` is one of the audit's own twelve package types — `enabling_strip_out_asbestos`, `structure`, `envelope`, `roof_windows`, `fire_acoustic_thermal`, `mech_elec_public_health`, `drainage_utilities`, `lift`, `partitions`, `finishes`, `common_parts`, `externals` — plus `other`. A fixed enum plus a free `label` makes the schedule groupable and comparable across appraisals while still admitting the line a particular scheme has that the enum does not. Duplicate `code`s are allowed (two externals lines, three finishes lines); duplicate `id`s are not — ids are the identity the three contingency classes reference (§16.3).

`lender_eligible` and the derived `lender_eligible_base_pence` (Σ `amount_pence` of every package where `lender_eligible` is true) are **live in the ledger from calc 2.13.0** (R14). They were recorded and displayed only in R10, R11, R12 and R13; §4.2(b)'s development-cost advance cap now scales its construction line by `lender_eligible_ratio` = `lender_eligible_base_pence / base_build_pence`, so flagging a package ineligible reduces what the facility may advance against it. A recorded-but-inert eligibility flag that looks live is worse than none, which is why the inertness was stated at the point of definition for four releases; the flag is no longer inert, and this sentence records that rather than being deleted.

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

**[R16 — calc 2.17.0] The `abnormal` class is a sensitivity lever's target.** §12.1's
`abnormal_cost` lever adds percentage points to this class's `pct`, and the base it
resolves against is the base defined above: the whole build in headline mode, the
abnormal-tagged packages alone in detailed mode. That is the whole of why the lever's
applicability is a **document** fact rather than a measured one (§25.4) — in detailed
mode with nothing tagged `abnormal` the class's base is zero and the lever has nothing
to move, which the pack reports as an inapplicable row naming the missing tag rather
than as a zero-width movement. Scaling the whole build instead would be
`construction_cost` under another name; this class exists to price the elevated risk
separately, and the lever stresses it separately (§25.1, §25.8 limitation 2).

**The result shape is unchanged.** `ContingencyLine.basis` survives on the *result* as `'all_packages' | 'selected_packages'`, now **derived** from mode and class rather than read from an input field of the same name — so a report reading `cost_plan.contingency[].basis` needs no change (§16.8). Only the input fields `basis` and `package_ids` are gone.

**`cost_plan.contingency` is the only contingency input from v7 onward, in both modes.** `conversion_costs.contingency_pct` is deprecated exactly as `sdlt_pence` was in R8: retained so pre-R10 readers keep working, removed in R16b (R16 was split at design time and the removal went with the platform half — see the release plan), and placed behind the same single-accessor guard `total_construction_sqm` sits behind. Both modes route through the same engine rather than headline mode keeping the old field live — the easy alternative would have made the migration identity gate provably blind, because the old code path would still be the one running for every existing (headline) document and "all twelve golden fixtures penny-identical" would pass whether or not the new engine was even wired in. Routing both modes through one engine means migration copies `contingency_pct` into `general.pct` on the `all_packages` basis (§16.7) and the new code computes every existing appraisal's contingency, so "identical to the penny" is an assertion that could actually fail. [R11 — calc 2.10.0. The v7 → v8 boundary re-tests the same claim one version on: the pre-existing fixture whose `contingency_class` tags and (pre-migration) `package_ids` agreed exactly — the two mechanisms could not be told apart by a re-pin alone — is joined by a **planted-divergence** document whose tags and id-list disagree, asserting the resolved base follows the tag. Without it, deleting `basis`/`package_ids` would be indistinguishable from a no-op (§17 "Guards this release must watch fail").]

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
packages[]                  id, code, label, amount_pence, contingency_class, lender_eligible,
                            phase_id, resolved_phase_id, start_month, finish_month, midpoint_month,
                            months_from_base, inflation_factor, inflation_pence   [phase/timing/inflation
                                                                                   fields R15b — calc 2.16.0, §24.2/§24.3/§24.6]
base_build_pence
contingency[]               name, pct, basis, base_pence, amount_pence
contingency_total_pence
compliance_pence
construction_total_pence    = base_build + inflation_total + contingency_total + compliance   [R15b]
fees[]                      id, code, category, basis, base_pence, amount_pence
professional_total_pence
statutory_total_pence
conversion_total_pence      = construction_total + professional_total + statutory_total
lender_eligible_base_pence
lender_eligible_ratio       lender_eligible_base ÷ base_build; 1 in headline mode and when base_build is 0 [R14]
implied_rate_pence_per_sqm  base_build ÷ developed_area_sqm; null when the area is 0
inflation_total_pence       sum of the ROUNDED per-package inflation lines; 0 with no recorded allowance [R15b]
inflation_pct_of_base_build pct(inflation_total_pence, base_build_pence); null when base build is 0 [R15b]
latest_midpoint_month                  the latest package spend midpoint (float); null with no packages [R15b]
latest_midpoint_months_from_base       the same, measured from qs.base_date; null with no calendar [R15b]
latest_midpoint_whole_months_from_base Math.floor of the line above — the flag and the memo print THIS [R15b]
```

§24.3/§24.6 give the full account of every R15b field above: `months_from_base` is published whenever `qs.base_date` is non-blank and `acquisition_date` is non-null, whether or not an allowance is recorded; `inflation_factor` and `inflation_pence` are the ones gated on the allowance itself.

Every contingency and fee line reports **its base as well as its amount** — the audit's "show the base" discharged as data rather than prose. `implied_rate_pence_per_sqm` exists so the rate does not simply vanish from the appraisal when the mode changes: in headline mode it is the entered rate recovered by division (a check on the arithmetic, not an echo of the input); in detailed mode it is the figure a reader compares against a benchmark they hold themselves. It is display-only and enters no calculation. `conversion_total_pence` is the bottom-line figure the cost page and the memo both print — computed once here, purely additive, and moves no other figure.

`Schedule.totals.construction_pence`, `professional_pence` and `statutory_pence` remain the single point the monthly ledger sees for **spend**, so sources-and-uses (§7) and reconciliation are structurally untouched by this release.

**`lender_eligible_ratio` is wired in calc 2.13.0 (R14)** and is carried onto the `Schedule` beside those totals, because §4.2(b)'s advance cap is the one place the ledger needs it. It governs what the facility may *advance* against the construction line, never what the scheme *spends*: cost before finance is unchanged by the wiring. Its consequence is real and is recorded rather than smoothed over — a detailed-mode document carrying an ineligible package and `development_cost_advance_pct: 100` had a cap that could never bind before R14, and now has one that binds in every month whose construction is met from the facility. Both such fixtures in the corpus moved: `q-detailed-cost-plan` now reports `funding_gap_pence` 2,031,318 and `s-dated-programme` 6,300,000 [R14 figure; superseded by §24.4's per-month share — `s-dated-programme` reports 6,330,000 under calc 2.16.0, §24.4], and both are consequently **not report-safe** — a non-zero funding gap makes `reconciliation.funding_complete` false, which `report_safe` requires — where before the wiring both reconciled clean and printed no DRAFT banner on that ground. That is the engine reporting an advance cap the appraisal always implied, not a regression.

### 16.9 Stated limitations

Recorded so they are not read as oversights.

- **No per-package programme.** Every package spread with the construction curve (§6); there was no per-package start offset, duration or curve. R12 (§18) shipped dated, dependent programme *phases* instead — phase-level, not package-level — so this remained open.

  **[R15b — calc 2.16.0] Resolved; kept as a historical note.** §24.2 gives every package its resolved phase's window, curve and a curve-weighted spend midpoint, and the Costs page gains the phase picker to write it. What is retained is the narrower §24.9 limitation 5: a package's programme is its phase, and there is no per-package offset inside one.
- **`lender_eligible` acts as a uniform ratio on the construction line, not a per-package draw profile.** Wired in calc 2.13.0 (R14): `lender_eligible_base_pence / base_build_pence` scaled §4.2(b)'s cap base as one ratio applied to the whole monthly construction line, so contingency and compliance followed it proportionally, and an ineligible package's own spend months were not distinguished from any other package's. Recorded again as §20.5 limitation 3.

  **[R15b — calc 2.16.0] Resolved; kept as a historical note.** §24.4 replaces the single ratio with a per-month share computed from each package's own resolved window and unrounded spend weights, and §4.2(b) reads the per-month figure. The share recovers this exact ratio, every month, on every document whose packages share one spend window (the auto path, the legacy arm, and any network where every package resolves to one phase); it departs only on fixture S. What survives is the narrower §24.9 limitation 3: the share is a ratio over per-package weights, not a per-package ledger, and contingency and compliance still follow the month's share rather than carrying an eligibility rule of their own (§24.9 limitation 4).
- **No QS provenance.** A package or a percentage fee carries no source, date or status — no "priced by [firm], RIBA Stage 4, dated [x]" distinction in the record, unlike the acquisition jurisdiction's evidence status (§14.6). Deferred to R15, alongside fixed-price coverage, provisional sums and inflation (§7.5 of the second audit).

  **[R15 — calc 2.15.0] Resolved; kept as a historical note.** §23.6 gives the detailed plan a `cost_plan.qs` block (source, stage, issue date, status, pricing base date) and every package a `price_basis`, and the result publishes fixed-price coverage, provisional sums, estimates and the unclassified balance against base build. §13.4's "QS evidence is not recorded" sentence became conditional at the same release. What survives is narrower and is stated as §23.11 limitations 7 and 9: the provenance is one block for the whole plan rather than per package, and fee lines carry none.
- **No inflation.** The cost plan was priced at one instant and spent over a programme, and nothing bridged the two: there was no tender-price inflation from `qs.base_date` to a package's spend midpoint, because a package had no spend midpoint until it had its own programme.

  **[R15b — calc 2.16.0] Resolved; kept as a historical note.** §24.3 gives every package a tender-price inflation line from `qs.base_date` to its own spend midpoint, one flat annual rate, compounded pro-rata. What survives is the narrower §24.9 limitation 1 (one rate, flat — no dated index table, no per-package rate) and limitation 2 (packages only — fee lines and contingency bases stay uninflated).
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

**[R15 — calc 2.15.0]** The due-diligence dashboard's derived `tax_basis` row (§23.3) reads **this section's own gate** for its VAT half — the material-unconfirmed predicate below, not a second one — so the row can never show green where this banner would fire, or unknown where it would not.

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

---

## 18. The dated, dependent programme [R12 — calc 2.11.0]

Before this release an explicit programme was three mutually independent windows — construction, professional, statutory — each with an unconstrained `start_offset` (§6.1). Nothing in the model said construction followed procurement, or that discharging conditions preceded a start on site, so moving one window moved one window and a lender's first programme question (*"what happens to my exposure if planning takes three months longer?"*) had no representable answer. Eight of the fourteen phases a conversion scheme actually runs — conditions, procurement, strip-out, testing, building control/warranty, practical completion, marketing, unit completions — had nowhere to live at all. §18 replaces the three windows with a **precedence network**, binds the cost lines to it, and makes a single slip propagate.

**§6.1 is superseded for the explicit-programme case. §6's `programme = null` auto-window rules are unchanged and remain live.** There are **two** live spend paths from inputs v9, not three: the auto path and the network. The v8 three-package shape does not survive migration (§18.7).

### 18.1 The schema

`inputs_version: 9`. `programme` is a two-state field:

| State | Meaning | Spend profile |
|---|---|---|
| `null` | auto windows | §6, **bit-identical to calc 2.10.0** |
| `{ anchor_month, phases[], category_phase_ids }` | precedence network | §18.2–§18.5 |

```
PhaseCode =
  | 'acquisition' | 'planning' | 'conditions' | 'design' | 'procurement'
  | 'strip_out' | 'construction' | 'testing' | 'building_control'
  | 'practical_completion' | 'marketing' | 'unit_completions'
  | 'sales' | 'maturity_tail' | 'other'

DependencyType = 'FS' | 'SS'

Dependency:
  phase_id:   string
  type:       DependencyType
  lag_months: integer >= 0

Phase:
  id:              string          -- identity; unique
  code:            PhaseCode
  label:           string          -- free text
  duration_months: integer >= 0    -- 0 = milestone (§18.3)
  slip_months:     integer         -- SIGNED; default 0; negative = acceleration
  start_offset:    integer >= 0    -- earliest-start floor, default 0
  curve:           SpendCurve
  predecessors:    Dependency[]

ProgrammeNetwork:
  anchor_month:        string | null   -- unchanged from v4; a display label
  phases:              Phase[]
  category_phase_ids:  { construction: string, professional: string, statutory: string }
```

`code` is a fixed enum plus a free `label`, mirroring §16.2's `CostPackage.code` treatment: it makes programmes comparable across appraisals while still admitting the phase a particular scheme has that the enum does not. **Duplicate `code`s are allowed** (two `other` phases; three `construction` phases for a phased block release); **duplicate `id`s are not** — `id` is the identity that dependencies, `category_phase_ids`, cost lines and sale anchors all reference.

`curve` is the existing `SpendCurve` (`straight_line` | `s_curve` | `back_loaded` | `user_defined`) of §6.1, unchanged, including the residue-absorption invariant.

**`start_offset` is an earliest-start floor, not an override.** This is the rule that keeps the schema from carrying two sources of truth for one date:

- a phase with no predecessors starts at `start_offset` (default 0);
- a phase with predecessors starts at the **later** of its floor and its constraints;
- there is no state in which a phase has both a "derived" and an "actual" start that can disagree.

It also does the migration's work by construction (§18.7): a v8 package becomes a predecessor-free phase whose floor *is* its old `start_offset`, so the derived window equals the old window identically rather than by arithmetic coincidence.

### 18.2 The derivation

One rule, applied over a topological order of `phases`:

```
ref(d)   = finish(d.phase_id)   if d.type = 'FS'
         = start(d.phase_id)    if d.type = 'SS'

start(p) = slip_months(p)
         + max( start_offset(p),
                max over d in predecessors(p) of ( ref(d) + lag_months(d) ) )

finish(p) = start(p) + duration_months(p)
```

The window is **half-open**: `[start, finish)`, occupying months `start … finish − 1`. This is §6.1's existing convention, where a package with `start_offset = 1, duration_months = 4` occupies months 1–4. `max` over an empty predecessor list is `−infinity`, so a predecessor-free phase starts at `slip_months + start_offset`.

**Programme finish.**

```
programme_finish = max over all p of ( finish(p)      if duration_months(p) >= 1
                                       start(p) + 1   if duration_months(p) = 0 )
```

It is the first month index no phase occupies. **The milestone arm sits inside the same maximum; it is not a fallback for the case where only milestones remain.** A trailing `maturity_tail` milestone sitting three months after the last spend-bearing phase finishes *is* the programme's end, and a formula that took the maximum over `duration >= 1` phases alone would report the programme finishing before its own final milestone.

**Slip is applied to the phase and inherited by its successors.** `slip_months(p)` is added to `p`'s own start *after* its constraints resolve, so it delays `p` and, through `ref(d)`, everything that depends on `p`. A slip on a phase is **not** a slip on the programme: whether `programme_finish` moves is decided by `p`'s float (§18.4), and that asymmetry is this release's primary falsifiable guard.

**Slip is signed.** A negative `slip_months` is acceleration — *"planning comes through two months early"* is as legitimate a lender question as the delay, and an unsigned field would make §12.4's tornado one-sided, its low endpoint an invalid cell on every programme document. Signing it costs exactly one rule: because `slip_months` is applied outside the `max`, it can drive a start below zero, and **a resolved `start(p) < 0` is a hard error naming the phase and the resolved start (§18.8), never a clamp to month 0.** Clamping would silently convert an over-acceleration into a different, valid-looking programme.

**Cycles.** Evaluation is a topological pass. A cycle has no topological order and there is no defensible default start for a phase inside one, so a cycle is a **hard validation error naming the cycle in order** — `planning → conditions → planning` — not a generic "invalid programme" and not a silently broken edge. Self-references and dependencies naming an absent `phase_id` are the degenerate cases and error the same way.

### 18.3 Milestones

`duration_months = 0` is a milestone: practical completion, a funder's first-draw date, a warranty sign-off.

- `finish = start`, so an `FS` successor with `lag_months = 0` starts in the same month the milestone falls.
- A milestone **occupies no month** and **may carry no spend**. A cost line resolving to a milestone is a **hard error**, not a silent zero — dropping money the user entered without saying so is the worse failure (the rule §16.2 settled for detailed-mode compliance figures).
- `curve` on a milestone is ignored. It is not removed from the record, because a milestone that later gains a duration should not need its curve re-entered.

### 18.4 Float and the critical path

A backward pass over the reverse topological order:

```
own_bound(p)   = programme_finish       if duration_months(p) >= 1
               = programme_finish − 1   if duration_months(p) = 0   (milestone)

late_finish(p) = min( own_bound(p),
                      min over successors s of late_ref(p, s) )

late_ref(p, s) = late_start(s) − lag_months(d)                        if d.type = 'FS'
               = late_start(s) + duration_months(p) − lag_months(d)   if d.type = 'SS'

late_start(p)  = late_finish(p) − duration_months(p)

total_float(p) = late_start(p) − start(p)
is_critical(p) = total_float(p) == 0
```

`d` is the dependency on `s` that names `p`. The inner `min` over an empty successor list is `+infinity`, so a phase with no successors takes its `own_bound`.

**`own_bound` applies to EVERY phase, not only the successorless ones.** The textbook formulation bounds late finish by the project end *only* for activities with no successors and takes the successor minimum otherwise. That formulation is wrong here, and stating the correct rule is the whole point of writing this subsection normatively.

**An `SS` edge constrains the successor's *start*. It says nothing about the predecessor's *finish*.** So a phase can have successors and still be the phase whose own finish defines the end of the programme:

> `construction` runs 10 months from month 0. `marketing` starts `SS + 6` and runs 2 months, finishing at month 8. The programme finishes at month 10 — set by construction. The successor-only rule gives `late_finish(construction) = late_start(marketing) + 10 − 6 = 12`, hence a total float of **2**. Delay construction by one month and the programme finishes at 11: its true float is **0**.

A lender reading that report would see two months of free buffer on the one activity that has none. Taking the minimum against `own_bound` for every phase is what standard CPM achieves with an implicit project-end node that every activity ultimately feeds; stating it as a bound rather than as a node is the same rule without the phantom vertex.

The milestone arm of `own_bound` mirrors §18.2's programme-finish formula: a zero-duration phase contributes `start + 1` to the finish, so its own bound is `programme_finish − 1`. Without it a trailing `maturity_tail` milestone — the phase that *defines* the finish — reports a float of 1.

**Neither arm can produce negative float.** For `duration >= 1`, `programme_finish >= finish(p)` by construction of §18.2's maximum, so `own_bound(p) − duration(p) >= start(p)`; for a milestone, `programme_finish >= start(p) + 1`, so `own_bound(p) >= start(p)`. Adding a term to a `min` only lowers `late_finish`, so it cannot mask a negative float arising elsewhere either. Negative float **is** still reachable through a negative `slip_months` on a successor — §18.2 permits acceleration — and that is a validation matter (§18.8), not a derivation one.

`critical_path` is reported as the list of phase ids with zero float, **in topological order**.

This is not ornament. It is what makes the slippage analysis answer the lender's actual question — *does this delay cost me anything?* — and it supplies the release's non-commutative guard: slipping a phase with float ≥ 1 must leave `programme_finish` **unchanged**, while slipping a critical phase by *n* must move it by **exactly** *n*.

### 18.5 How phases bind to money

**One resolution rule, both cost modes.**

```
resolved_phase(line) = line.phase_id  ??  programme.category_phase_ids[line.category]
```

- **Headline mode** has no line rows. Its three totals — construction, professional, statutory — resolve straight through `category_phase_ids`.
- **Detailed mode** (§16) gives every `CostPackage` and `FeeLine` an optional `phase_id` that overrides the category default. A package's category is `construction`; a fee line's is its existing `FeeCategory` (`professional` | `statutory`).

`category_phase_ids` is **required** whenever `programme` is a network, in both modes. This is mode-dependent resolution of a *single* rule — the shape §16.3's contingency base settled on. There is one accessor, and a line's override and the category default can never both apply.

**Spreading is per (phase, category) BUCKET, not per line.** Amounts are bucketed by their resolved phase and their category, and each bucket's **total** is spread once over that phase's derived window, with that phase's curve, through the existing `spreadByCurve` of §6.1. Two lines resolving to the same phase in the same category are **one** spread of their combined total, not two spreads summed. The invariant is unchanged: each month rounds half-up, the final month of the window absorbs the cumulative residue, Σ = total.

Bucketing is normative and load-bearing, not an implementation detail. Per-line spreading is **not** the pre-existing behaviour: the auto-window arm (§6) and the legacy three-package arm (§6.1) both spread the **category total** exactly once — `spreadByCurve(professionalTotal, …)`, never a per-line loop. Per-line spreading differs from that by rounding, because each line would absorb its own residue and `Σᵢ round(tᵢ · w) ≠ round((Σᵢ tᵢ) · w)` in general. The category total would be preserved; its **monthly distribution** would shift by pennies. §18.7's migration identity gate asserts every computed figure is penny-identical across the v8 → v9 boundary, and a v8 document's professional spend is one spread of the total while its migrated v9 twin's would be eight separate spreads of eight synthesised fee lines. The gate would fail on documents whose amounts do not divide evenly — and pass on those where they happen to, which is worse, because the defect would then depend on the fixture rather than on the rule. Bucketing restores identity **by construction**: when every line in a category resolves to the category default — exactly what migration produces, since it writes no per-line `phase_id` — the bucket total *is* the category total and the spread is bit-identical to the legacy arm's. Per-line overrides still work; a line tagged to a different phase simply joins a different bucket.

**The prior-approval carve-out stays per line**, because it is a placement decision rather than a rounding one: an untagged `prior_approval` fee is pinned to month 0 and never enters a bucket, while a tagged one joins its phase's bucket like any other line. A single category-level lump could not tell those two cases apart.

**[R15b — calc 2.16.0] Beside the construction bucket, a per-month lender-eligible SHARE — never a second spread.** §24.4 computes, from the same package weights this section's bucketing already uses, a ratio `share(m) = (eligible packages' unrounded spend that month) ÷ (all packages' unrounded spend that month)`, and applies it to the bucket's already-spread `uses[m].construction_pence` to publish `uses[m].lender_eligible_construction_pence`. It is deliberately a **share over unrounded per-package weights**, not a second per-package `spreadByCurve` run beside the bucket spread: two independent per-package spreads of the same pounds would round separately from the bucket total by the same `Σᵢ round(tᵢ·w) ≠ round((Σᵢ tᵢ)·w)` argument this section's own bucketing rule exists to avoid, and the uses would then carry two competing monthly figures for the same money. A ratio of two floats has no such rounding, and reduces exactly to `lender_eligible_ratio` on any month where every active package shares one window (§24.4's recovery claim). In the network arm, each package's own `inflation_pence` (§24.3) joins that package's resolved phase's bucket, so a package's inflation spreads with the package; the construction bucket's remainder — contingency and compliance — is never itself a package line and always resolves through the category default, exactly as an untagged line already does above.

**The two month-0 anchors that survive.**

- **Acquisition stays at month 0, unconditionally.** It is the completion date and the origin of the term. The `acquisition` phase in the catalogue is therefore a *displayed, zero-spend* phase representing the purchase process; re-timing the consideration is deferred consideration and overage, and is out of scope (§18.10, limitation 2).
- **The `prior_approval` fee keeps its month-0 pin by default** (§3.4, §6.1) and moves only if it carries an explicit `phase_id` — in practice, `planning`. Defaulting it to `category_phase_ids.statutory` instead would move it on every migrated document, because a migrated statutory phase's window is the old statutory window, which is not month 0. The default exists to hold migration identity (§18.7), and that is the reason it exists.

### 18.6 Exit timing

`sales_phasing.tranches[]` and `refinance` each gain:

```
anchor: { phase_id: string, offset_months: integer } | null
```

```
resolved_month = anchor ? start(anchor.phase_id) + anchor.offset_months
                        : month_offset
```

**`anchor: null` means "use `month_offset`"**, and it is the migration default, so every stored document's receipts land exactly where they land today. `month_offset` is retained and is not deprecated: an unanchored disposal date is a legitimate thing to model.

Where an anchor is set, a construction slip moves the receipts — and therefore peak debt, interest, IRR, the sources-and-uses profile and cost-to-complete. That propagation is the audit's "exit slippage", and it is why stopping the release at practical completion was rejected: a programme that slips PC while the sale date stays pinned models a delay with no consequence.

An anchor may only reference a phase that exists. It **may** reference a milestone — a tranche anchored to `practical_completion + 2` is the canonical case, and is exactly why milestones carry a start even though they occupy no month.

This is the R12/R13 seam: **R12 ships *when*; R13 ships *how much*.**

### 18.7 Migration and the persistence boundary

```
v8 programme: null           →  v9 null                       (untouched)
v8 programme: { packages }   →  v9 { anchor_month, phases[3], category_phase_ids }
```

For each of the three packages, in the fixed order construction, professional, statutory:

| v9 field | Value |
|---|---|
| `id` | **the package name** — `'construction'`, `'professional'`, `'statutory'` |
| `code` | `construction`, `design`, `planning` respectively |
| `label` | `'Construction'`, `'Professional'`, `'Statutory'` |
| `duration_months` | the package's `duration_months` |
| `start_offset` | the package's `start_offset` |
| `slip_months` | `0` |
| `curve` | the package's `curve`, unchanged |
| `predecessors` | `[]` |

`anchor_month` carries across unchanged. `category_phase_ids` becomes `{ construction: 'construction', professional: 'professional', statutory: 'statutory' }`. Because a predecessor-free phase's start *is* its floor (§18.1), every derived window equals the old window identically, for every curve and every term.

**The five additive no-ops.** No `CostPackage` or `FeeLine` gains a live `phase_id` — every one is written `null`. `sales_phasing` tranches and `refinance` gain `anchor: null`. **All four scenarios** gain `phase_slip_phase_id: null` and `phase_slip_months: 0` (§18.9); both are no-ops by construction, because `applyScenario` matches the id against each phase and `null` matches none. Every one of these five additions is a written `null` or `0`: the migration adds no value any engine reads as live.

**The persistence boundary.** The v9 additions must round-trip through the Python model, whose config is `extra='ignore'` — a field the Pydantic model does not declare is dropped silently on the way in, so a structural assertion of the form `"phase_id" not in row` can hold even with the migration helper bypassed entirely. The boundary tests therefore assert the **presence and value** of every new field after a full save/load round trip, not its absence before one.

**The gate is a pair.**

1. **Numeric identity** — every gated fixture, every computed figure, penny-identical across migration, in both engines.
2. **Validation identity** — over every gated fixture plus synthetic **term-1**, **term-2** and **term-3** documents.

**Validation identity is THREE properties, not one equality.** An earlier draft of this release required `validateInputs` to return the same issue set before and after migration. That is the wrong assertion once v9 carries rules v8 never had. **§18.8's overrun rule has no v8 counterpart at all** — the legacy arm validates window bounds but has no concept of a programme finishing after maturity — and both programme-bearing fixtures breach the sale-tail rule at all three synthetic terms, so exact equality would fail on behaviour that is new *and correct*. Relaxing the comparison generally would have weakened the gate everywhere to accommodate one rule.

1. **No valid document becomes invalid.** If the pre-migration document has no hard (`severity: 'error'`) issue, the post-migration document has none either. **Unconditional — no filter, no exemption.** This is the only property that describes a silent DRAFT downgrade.
2. **No invalid document becomes valid.** The converse, **also unconditional**. This is not symmetry for its own sake: v9 treats a zero-duration phase as a legal milestone where the legacy arm rejected `duration_months < 1`, so a migration could silently *upgrade* a broken document to report-safe.
3. **Issue sets equal, except issues from a named list of v9-only rules.** The list holds exactly **one** entry — the overrun rule — asserted as such, with a separate control proving the overrun rule still fires. Excluding a rule from the comparison must never be able to hide a rule that has stopped working.

**The two exemptions are of DIFFERENT SHAPES and must not be conflated.**

| Exemption | Shape | Size, asserted |
|---|---|---|
| `PROGRAMME_FIELD_ALIASES` | a **field rename across the boundary** — the v8 sale-tail rule reports `programme.packages.<name>` where v9 reports `programme.phases.<id>`, and migration assigns `id = <name>` precisely so the two correspond one-to-one | exactly **three** entries |
| the v9-only-rule list | a **rule with no v8 counterpart** — the overrun rule, which the legacy arm cannot express at all | exactly **one** entry |

Both are asserted to their exact sizes, so neither can be widened without a test failing: narrow by construction, not narrow by intention. The alias map is additionally **derived** from the same package→phase table the migration itself uses, so the two cannot drift apart.

**Property 3's exemption is applied to the post-migration side ONLY, and that one-sidedness is load-bearing.** Applying it symmetrically would let a v9-only-rule issue on the *pre-migration* side be silently dropped too, which is a hole rather than an exemption. Because the pre-migration side never carries such an issue today, a symmetric refactor would be a silent no-op — so the one-sidedness is pinned by its own test rather than by a comment.

### 18.8 Validation

New hard errors (input errors, not flags), applying only when `programme` is a network:

| Rule | Message shape |
|---|---|
| duplicate `id` | names the repeated id |
| dependency names an absent `phase_id` | names the phase and the missing id |
| self-reference | names the phase |
| cycle | names the cycle in order — `planning → conditions → planning` |
| `duration_months` / `lag_months` / `start_offset` negative | names the field |
| `duration_months` / `slip_months` / `lag_months` / `start_offset` fractional or non-finite | names the field (`slip_months` may be negative but must be a whole number) |
| resolved `start(p) < 0` — over-acceleration | names the phase and the resolved start |
| `user_defined` weights: length ≠ `duration_months`, non-finite, negative, or summing to ≤ 0 | §6.1's four rules, unchanged, **per phase** |
| `category_phase_ids` references an absent id, or a **milestone** | names the category |
| a cost line's `phase_id` references an absent phase, or a **milestone** | names the line |
| `phases` is empty | a network with no phases is not a network |
| **`programme.overrun`** | names the offending phase and the overrun in months |
| a pre-completion phase breaches the sale tail | §6.1's message, unchanged |
| resolved tranche months not strictly increasing | names the tranche |
| an `anchor` referencing an absent phase | names the tranche or `refinance` |
| a scenario's `phase_slip_phase_id` naming an absent phase, or set while `programme` is `null` | names the scenario |
| a `phase_slip` axis or tornado range with `phase_id` null, or a non-`phase_slip` one with `phase_id` set | names the axis or range (§12.6) |

**The two window rules, stated exactly.** Let `term = max(1, floor(finance.term_months))`. The last valid month index is `term − 1`.

- **Overrun (all phases).** For `duration_months >= 1`: `finish(p) <= term`. For a milestone: `start(p) <= term − 1`. A breach raises `programme.overrun` against the phase, quoting the derived finish, the term and the difference — *"Programme finishes month 21; facility term is 18. Phase 'marketing' ends 3 months after maturity."* The term is authoritative; an overrun is a **hard error**, never a clamp into the final month.
- **Sale tail (the pre-completion codes only).** `finish(p) <= term − 1` for `duration_months >= 1`, i.e. the last occupied month index is `term − 2`; for a milestone, `start(p) <= term − 2`. §6.1's existing rule, with its existing message.

  The rule binds by **code-set membership**, not by position in the network:

  ```
  PRE_COMPLETION_CODES = acquisition, planning, conditions, design, procurement,
                         strip_out, construction, testing, building_control,
                         practical_completion
  ```

  `practical_completion` is itself in the set — PC is the boundary and must fall inside the tail, not on it. Everything from `marketing` onward is outside it. `other` is **not** in the set: an unclassified phase gets the weaker rule, because the alternative is a hard error nobody can act on.

**Why the tail rule was scoped rather than dropped or widened.** The two-month tail exists because §4.4 places a disposal the model did not otherwise represent in the final month. Once marketing, unit completions and sales are explicit phases, the reservation *is* those phases, and applying a tail reservation to them would reserve the tail against itself. Scoping it to the pre-completion codes keeps it binding on exactly the phases it has always bound — which is why a migrated three-phase network, whose codes are `construction`, `design` and `planning`, all in the set, produces an identical issue set (§18.7). Relaxing the rule to `term` for everything would have killed the guard by widening it.

**Validation is not the schedule's clamp.** `schedule.ts` and `schedule.py` both clamp month indices into range as belt-and-braces (the documented defence: an unvalidated negative index is `undefined` in JS and wraps to the end of the list in Python). Those clamps stay, and they stay **unreachable for any document that passes validation**. The derivation must never be the thing that decides whether a phase fits.

### 18.9 Sensitivity — the `phase_slip` lever

§12.1's fifth lever:

| Lever | Unit | Effect on the inputs document |
|---|---|---|
| `phase_slip` | months | adds to `programme.phases[<id>].slip_months` for a named phase |

**The lever carries a target as well as a magnitude**, which reaches two shapes it must not bypass.

1. **`SensitivityAxis` and `TornadoRange` carry `phase_id: string | null`** — required when `lever === 'phase_slip'`, required to be `null` otherwise, both hard errors under §12.6. The "rows and cols must differ" check and the tornado's duplicate check both key the pair `(lever, phase_id)`, not `lever` alone, so two `phase_slip` axes targeting different phases are a legitimate matrix and a tornado may carry one bar per slipped phase. Encoding the target into the lever string (`'phase_slip:planning'`) was rejected: `LEVER_ORDER` is a closed set and §12.6's membership check is what stops a misspelled lever reaching the engine, and a user-composed lever name cannot be a member of a closed set.
2. **`ScenarioOverrides` carries `phase_slip_phase_id: string | null` and `phase_slip_months: number`.** Every lever reaches the document through `applyScenario()`, the single point at which an inputs document is adjusted for *both* the four named scenarios and every sensitivity cell. A lever that bypassed it would be the only one that did, and the two adjustment paths would diverge silently. `ScenarioOverrides` is a **stored** block (`scenarios.{base,upside,downside,severe}`), so this is a v9 schema addition and part of the migration (§18.7), not a runtime-only type — which is a gain: a downside case whose planning slips three months is the most common thing a credit paper models, and before this release it was inexpressible.

```
phase.slip_months += (overrides.phase_slip_phase_id === phase.id)
                     ? overrides.phase_slip_months : 0
```

**Additive, not assignment**, so a base-case slip already recorded on the document is stressed **from** its recorded position rather than overwritten by it. An override naming a `phase_id` no phase carries, or naming one while `programme` is `null`, is a hard validation error (§18.8) — not a silent no-op, which is what would make the lever look live while doing nothing. `phase_slip` on a `programme = null` document has no field to write and is rejected as a lever misconfiguration.

**Composition order** is stated in §12.1 as that section requires: `phase_slip` writes a field no other lever touches, so the five levers remain disjoint and application remains order-independent — asserted by applying all five in several orders to one document and requiring identical results, not merely stated.

§12.2's facility invariance is untouched; `phase_slip` writes nothing under `finance` or `equity_sources`.

**[R16 — calc 2.17.0] `programme_slip`, beside it.** §12.1's twelfth lever writes the
same field, `slip_months`, but carries **no target**: it adds its months to **every
phase with `predecessors = []`** — the network's sources. That is the rule a *standard*
stress needs, because a pack that cannot know a document's phase ids cannot name one
(§25.2), and it is the rule that delays the network exactly once: this section's own
derivation already moves a successor with its predecessor, so adding the months to
every phase would count the slip once per dependency edge, and adding them to the
sources lets §18.2's cascade carry the delay through the network unaided. Slipping the
facility term instead is `timeline`, which moves maturity and not the works.

```
phase.slip_months += (phase.predecessors == []) ? overrides.programme_slip_months : 0
```

**Additive, like `phase_slip`, and composing with it in either order**: both are
integers added to the same field, so their composition order is immaterial, which
§12.1 states as that section requires. `programme_slip` needs no `phase_id` on
`SensitivityAxis` or `TornadoRange`, so its duplicate checks key on `lever` alone; it
is constrained to whole months by §12.6, the `timeline`/`phase_slip`/`sales_slip` rule
extended; and on a document whose `programme` is not a network, or is a network with
no phases, it is a **no-op by construction** — a zero-width tornado bar, and an
inapplicable stress-pack row naming the missing network (§25.4). A slip that pushes
the derived finish past maturity raises `programme.overrun` and §12.7 makes the
position **unmeasured, never clamped**, exactly as for `phase_slip`.

**The lever is signed**, matching `slip_months` (§18.2), so a tornado endpoint pair of −2 / +2 months is expressible and symmetric. A cell whose slip pushes the derived finish past maturity raises `programme.overrun`; a cell whose acceleration drives a start below month 0 raises the over-acceleration error. §12.7's cell-validity machinery already turns a hard input error into an **invalid cell** rather than a plausible wrong number, so no new mechanism is needed.

### 18.10 Outputs, reporting and stated limitations

**The result block.** `Schedule` gains `programme`:

```
ProgrammeResult:
  finish_month:   integer
  critical_path:  string[]            -- phase ids, topological order
  phases: Array<{
    id, code, label,
    start_month, finish_month,
    duration_months, slip_months,
    total_float_months, is_critical
  }>
```

`programme` is `null` on the auto path, exactly as the input is. It is **not** synthesised for auto-window documents: a derived block on a document that never asked for one is the silent-downgrade shape this release exists to avoid, and the auto path genuinely has no dependency structure to report.

**Reporting.**

- `ProgrammePage` carries the phase editor and a Gantt with the critical path marked and float shown; the three-package editor is replaced.
- The investment memo carries a programme section: the phase table, the critical path, the derived finish against the facility term, and any slip recorded on the base case. Where the derivation fails on a dependency cycle, the memo **states the failure**; it does not silently omit the section.
- `programme.overrun` is a hard error, so it makes `report_safe` false and marks the report **DRAFT** through the existing §13.3 mechanism. No new `DraftReason` is invented for it — it is an input error like any other.

**Stated limitations.** Recorded so they are not read as oversights.

1. **The `programme = null` path can never show slippage.** Auto-window documents have no phases, no float and no critical path. This is the deliberate price of leaving §6 live: the alternative moved a derived block onto every stored document.
2. **Acquisition is fixed at month 0** (§18.5). Deferred consideration and overage are a later release.
3. **No calendar dates.** `anchor_month` remains a display label; the model is month-offset throughout and phases inherit that.
4. **No planned-versus-actual.** `slip_months` records a delay or an acceleration as a single signed number; it does not record a reporting date, a certified position or a QS forecast. That is the monitoring case (R14), which will write this same field.
5. **No resource levelling, no calendars, no non-working periods.**
6. **`FF` and `SF` dependency types are not supported.** No realistic construction link in this model needs them, and each would be another arm of the derivation to test.
7. **Rounding residue is absorbed per (phase, category) bucket.** Two lines resolving to the same phase in the same category are spread once, as their combined total. This matches the auto and legacy arms, which spread the category total exactly once, and it is what keeps §18.7's penny-identity gate true by construction rather than by arithmetic coincidence (§18.5).
8. **Total float only.** `total_float_months` is float against the programme finish. Free float — the delay a phase can absorb without moving its immediate successors — is not derived. Total float is what answers the lender's question; free float would be a second number readers would have to be taught to tell apart from the first.
9. **CLOSED — R13, calc 2.12.0 (Tasks 12 and 14).** §18.6's `anchor` was engine-complete but had no UI control, and the two surfaces that name a tranche's month printed the raw `month_offset` rather than the resolved month the ledger actually used. R13 closed both halves — `ExitStrategyPage` now writes anchors (Task 14), and `Schedule` gained `resolved_exit_months` for the reporting surfaces to read (Task 12, §19.6). **This limitation's original text overstated the reporting half of the defect, and the correction is recorded here rather than silently rewritten.** The memo's refinance clause was never wrong: it already read `schedule.refinance.month`, which `resolveAnchorMonth` (§18.6) has resolved since this section was written, independently of and predating `resolved_exit_months` — only the memo's *sales-phasing* clause read the raw offset. `CashflowPage`, by contrast, had both clauses wrong: its sales-phasing **and** its refinance clause both read the raw `month_offset`. R13's fix reads `resolved_exit_months.tranches`/`resolved_exit_months.refinance` on both surfaces' sales-phasing clauses and on `CashflowPage`'s refinance clause; the memo's refinance clause is untouched, because it was never broken. A test anchored a tranche on a slipped programme and confirmed it failed against pre-R13 `main` before the fix landed, per the standing rule that a carried defect is fixed only behind a failing assertion.

### Guards this release must watch fail

Per the standing rule that every guard be planted against and watched failing before it is trusted:

| Guard | Watched by |
|---|---|
| Float asymmetry (§18.4) | Slipping a phase with `total_float >= 1` leaves the finish unchanged; slipping a critical phase by *n* moves it by exactly *n* — both arms on **absolute** month numbers, plus a test asserting the fixture really contains a non-zero-float phase |
| Propagation, absolutely (§18.2) | The successor's **absolute** start month and the resulting **absolute** peak debt and total interest — not that they moved, and not their direction |
| Cycle detection (§18.2) | A cyclic document errors naming the cycle; its acyclic twin, differing by **one** dependency, does not |
| Anchor liveness (§18.6) | An anchored tranche and its absolute-month twin give **identical** receipts at zero slip and **divergent** receipts at non-zero slip |
| Category-map liveness (§18.5) | Two documents identical but for `category_phase_ids.professional` produce different professional spend profiles |
| Migration identity, both axes (§18.7) | The numeric gate corpus-wide in both engines, plus the three validation properties, the three-entry alias assertion and the one-entry v9-only-rule assertion, plus a control proving the overrun rule still fires |
| Lever order-independence (§18.9) | All five levers applied in several orders to one document give identical results |

**Guards deliberately not written**, because they would be vacuous by construction: any assertion that every phase's `code` is in `PhaseCode` (the type guarantees it); any assertion that `finish = start + duration` (true by construction of the implementation's own addition).

---

## 19. The investment case [R13 — calc 2.12.0]

Before this release, a retained scheme's refinance (§4.5) modelled the refinance
of *an asserted value*: `investment_value_pence` was "an explicit input, never
yield-derived", and nothing in the model connected it to the scheme's rent, its
operating costs, or the income a take-out lender would actually underwrite
against. `ExitStrategyInputs.retained_units[].monthly_rent_pence` had been
captured, edited and printed since R1 and **read by no calculation** — a rent
roll with no NOI, an operating asset with no operating costs, a hold period
with no vacancy, letting-up or stabilisation. There was no DSCR, no ICR, and no
debt-service concept at all. §19 closes that: audit §7.8's *"a lender needs
evidence that take-out debt can service and repay, not only that a percentage
LTV is below a valuation"*, and §7.9's standard buttons *"refinance yield
expansion, lower refinance LTV and operating-cost/vacancy stress"*.

**This is half of §7.8, deliberately.** Unit-specific completion timing,
sales-agent/legal costs by unit and deposits are the sold portion's *receipt
timing*; §19 is the retained portion's *income and take-out*. The two share no
arithmetic, and taking both in one release would have opened a second live
sales path alongside a second live valuation path in the same release — one
new live path per axis is the rule R12 arrived at the hard way (§18). The
unit-level sales ledger is deferred to its own release (§19.10 limitation 1,
and the release plan).

**§4.5 is superseded for the `investment_case != null` case.** Where
`investment_case` is null, §4.5's explicit `investment_value_pence × ltv_pct`
path is unchanged and remains live, byte-identical.

### 19.1 The schema

Inputs v10 is purely additive plus two narrowings on `refinance`. `calc_version`
`2.12.0`, `inputs_version` `10`.

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
for phases. `operating_lines` is a **user-managed list**, not a required
closed set of fields: `OpexCode` is the enum a value must belong to, not a
list of rows every document carries.

`stabilisation` reuses `PhaseAnchor` verbatim. `anchor: null` means "use
`month_offset`", exactly as §18.6 defines it for tranches and `refinance`, so
there is one month-resolution rule in the model and not two.

**The two narrowings on `refinance`:**

```
RefinanceInputsV10 extends RefinanceInputsV9:
  investment_value_pence:  number | null      -- was number
  ltv_pct:                 number | null      -- was number
  arrangement_fee_basis:  'fixed_pence' | 'pct_of_quantum'
  arrangement_fee_pct:     number in [0, 100]
```

When `investment_case` is non-null it **supersedes** the explicit value and
LTV, and both must be `null`. This is a validation error, not a silent
override: §2's never-silently-ignored rule makes "we read one and dropped the
other" the prohibited shape (§19.7 rule 5). When `investment_case` is null,
both must be non-null — today's rule, restated as the other arm.

All refinance *event* costs stay on `refinance`, where they are today. Only
the arrangement fee's **basis** is new, because a fixed-pence arrangement fee
on a derived quantum is an odd thing to ask a user for. `takeout` is sizing
policy; `refinance` is the event. Migration writes `arrangement_fee_basis:
'fixed_pence'`, `arrangement_fee_pct: 0`, which reproduces today's arithmetic
exactly (§19.9).

**The type is named `RefinanceArrangementFeeBasis`, not `ArrangementFeeBasis`.**
`ArrangementFeeBasis` (`'committed_net_facility' | 'committed_gross_facility'`)
already names `FacilityTerms`'s own arrangement-fee basis — a different enum,
for a different fee, on a different tranche (the *development* facility's
arrangement fee, sized against the committed facility, versus the *take-out*'s
arrangement fee, sized against the derived quantum). Reusing the name would be
a duplicate top-level declaration. The **field** name `arrangement_fee_basis`
is shared across both objects, as `arrangement_fee_pence`/`arrangement_fee_pct`
already were; only the type name differs.

### `takeout` is not nullable

Every non-null `investment_case` carries a `takeout` block, and the sizing is
always computed and reported. When `refinance` is null nothing is booked and
the result is marked `is_booked: false` — an **indicative** exit route, which
is what a lender wants to see on a retain-and-hold case. A nullable block
inside a nullable block buys nothing and doubles the arms to test.

### 19.2 The NOI derivation

Runs **strictly before** the ledger and reads nothing from it — §17.5's
one-direction rule, applied to the second engine that could have been made
cyclic. `investment-case.ts`/`investment_case.py` must never import the
monthly engine, the metrics module or the schedule.

**The retained set, and the trap in it.** Retention is decided by
`exit_strategy.route`: `retain_all` retains every unit; `blended` retains the
units named in `retained_units[]`; `sell_all` retains none. For `blended`,
`retained_units[]` *is* the retained set, so a rent exists for every retained
unit by construction. **For `retain_all` it is not** — every unit is retained,
but only those listed in `retained_units[]` carry a rent, and the list may be
short or empty. A `retain_all` document with three of eight units listed would
produce an NOI understated by five units' rent, silently, and therefore a
value and a take-out understated with it. So: **`investment_case` non-null
with `route = 'retain_all'` requires a `retained_units` entry for every unit
in `unit_mix`** (§19.7 rule 2). Validation refuses the document that lacks
them; silent understatement of the figure the whole release exists to derive
is not smoothed over.

**Occupancy.** Let `s` = the resolved stabilisation month (§18.6's rule,
reused via `resolveStabilisationMonth`), `R` = `ramp_months`,
`U` = `stabilised_occupancy_pct`:

```
m < s            →  occupancy = 0
s <= m < s + R   →  occupancy = U × (m − s + 1) / R
m >= s + R       →  occupancy = U
```

`R = 0` collapses the middle arm: occupancy is `U` from month `s`. The ramp is
`R` months long and **reaches `U` in its final month**, `s + R − 1`.

**The monthly series.**

```
gross_potential_monthly = Σ over exit_strategy.retained_units[] of monthly_rent_pence
egr[m]  = round_half_up(gross_potential_monthly × occupancy[m] / 100)
opex[m] = 0 for m < s; otherwise Σ over lines of
            fixed_pence_per_month →  value
            pct_of_gross_rent     →  round_half_up(egr[m] × value / 100)
noi[m]  = egr[m] − opex[m]          -- SIGNED
```

The sum is over `retained_units[]`, not over `unit_mix`. For `blended` that
list **is** the retained set; for `retain_all` §19.7 rule 2 makes it complete.
Those two facts together are the only reason one expression serves both
routes. Operating costs start with the income, not with the term: a scheme
incurs management and letting cost against a let asset, so opex is 0 before
`s`, not from month 0.

**A percentage operating line is a percent of that month's *effective* gross
rent, not of potential rent.** A management fee is charged on rent collected.

**A negative NOI month is an operating shortfall funded by uncommitted
additional equity**, through §4.3's existing mechanics and its existing
`additional_equity_required` red flag. The development facility does not fund
operating losses.

**Stabilised NOI is the stabilised year, not the ramp average.**

```
egr_stab   = round_half_up(gross_potential_monthly × U / 100)
opex_stab  = Σ lines evaluated at egr_stab
noi_annual = 12 × (egr_stab − opex_stab)
```

Twelve times the *stabilised month*, never the sum of the first twelve actual
months and never an average over the term. Valuation (§19.3) and both
coverage ratios (§19.4) read this figure and only this figure. Capitalising
ramp-period NOI is the classic error in this calculation.

If `noi_annual <= 0`: the investment value is 0, all three caps are 0, the
quantum is 0, `binding_constraint` is `null`, and a **red** flag
`investment_case_noi_non_positive` fires. Not an error — the arithmetic is
sound and the finding is the point.

### 19.3 Investment value

The net-initial-yield convention, stated rather than left implicit:

```
gross_value = noi_annual / (cap_yield_pct / 100)
value       = round_half_up(noi_annual × 100 / cap_yield_pct
                            / (1 + purchasers_costs_pct / 100))
```

`gross_value` is published for the report's bridge but is **not** an
intermediate the value is computed from: the value is a single expression
with a **single rounding**, so a two-step derivation cannot drift a penny
from the published one.

### 19.4 Sizing, and which constraint binds

Let `r = annual_rate_pct / 100`.

**The annual debt-service factor per £1 of debt**, `a`:

```
amortisation_years == null  →  a = r                     (interest-only)
otherwise                   →  i = r / 12
                               N = amortisation_years × 12
                               a = 12 × ( i == 0 ? 1 / N
                                                 : i / (1 − (1 + i)^(−N)) )
```

**When `amortisation_years` is null, `a = r`, so the DSCR and ICR caps are
equal by construction whenever the floors are equal.** That is a feature: the
two ratios diverge exactly when there is amortisation.

**The three caps**, each floored to integer pence:

| Cap | Formula | Not binding when |
|---|---|---|
| LTV | `floor(value × ltv_cap_pct / 100)` | — |
| DSCR | `floor(noi_annual / (dscr_floor × a))` | `a == 0` (zero rate, interest-only) |
| ICR | `floor(noi_annual / (icr_floor × r))` | `r == 0` |

```
quantum            = max(0, min over the applicable caps)
binding_constraint = the argmin, precedence LTV → DSCR → ICR on an exact tie,
                      or null when quantum == 0
```

**All three caps are published**, not only the binding one. A reader who sees
`LTV 4,200,000 / DSCR 3,610,000 / ICR 4,050,000 — DSCR binds` learns the shape
of the constraint; a reader given only `3,610,000` learns a number.

**Floor, not half-up.** A deliberate departure from §1.1, called out here
rather than left to be discovered as an inconsistency. A cap rounded up is a
cap breached by a penny.

**Achieved ratios**, published alongside the floors:

```
achieved_ltv_pct = value > 0             ? quantum / value × 100        : null
achieved_dscr    = a > 0 && quantum > 0  ? noi_annual / (quantum × a)   : null
achieved_icr     = r > 0 && quantum > 0  ? noi_annual / (quantum × r)   : null
```

Because the caps floor, the binding constraint's achieved ratio is **at least**
its floor and better than it by less than one pence of debt.

**The refinance event.**

```
arrangement_fee = fixed_pence    → arrangement_fee_pence
                  pct_of_quantum → round_half_up(quantum × arrangement_fee_pct / 100)
net_proceeds    = quantum − arrangement_fee − legal_costs_pence
```

From there §4.5 is unchanged: negative net proceeds apply as 0 and are funded
by uncommitted additional equity; the sales sweep runs first within the
month; the facility is fully redeemed if it has a balance; the exit fee is
charged once under §4.4.1's once-only rule; a shortfall is absorbed by
additional equity and raises the existing red flag.

A new **amber** flag `takeout_constrained_by_coverage` fires when
`binding_constraint` is `dscr` or `icr` — the lender-relevant finding that
income, not value, is what limits the take-out.

### 19.5 The ledger

**A receipt class of its own.** `MonthReceipts` and `LedgerMonth` gain
`net_operating_income_pence` (signed). It is isolated the same way R11
isolated `vat_reclaim_pence`: deliberately **not** part of `gross_sale_pence`,
because it is not a sale receipt.

**What that isolation actually proves — narrower than it first reads.** NOI
being outside `gross_sale_pence` means no GDV-, LTGDV- or break-even-
denominated **formula** takes NOI as an input. It does **not** mean those
metrics are numerically unchanged by NOI's presence. NOI is applied in full
to the senior facility and repays it early, so peak debt moves — and
`ltgdv_developer_pct`, `ltgdv_lender_pct` and `senior_breakeven_pence` are all
**debt-denominated**: they move because the debt they are computed from
legitimately moves. `profit_on_gdv_pct` moves for the same reason
`profit_pence` moves through lower interest (below). **Only `gdv_pence` is
structurally invariant** — `calculateGdv` takes unit values alone and has no
ledger argument, in either engine, so it cannot read a receipt regardless of
what the receipt is. The true, tested property is: NOI is never a *sale
receipt*, so it never enters `gross_sale_pence` or `gdv_pence`; the
debt-denominated metrics are legitimately live, not accidentally leaked into.

*(A related, pre-existing doc comment on `finance-types.ts`'s
`vat_reclaim_pence` — inherited unmodified from R11 — reads more absolutely
than this: it says no GDV-/LTGDV-/break-even-denominated metric "may read"
`vat_reclaim_pence`, which is true of the formula but invites the same
misreading NOI's design text made. VAT reclaim moves debt exactly as NOI does,
for exactly the same reason. Noted here because this task touched the
adjacent area; correcting that comment is optional and not required by this
release.)*

**Order within the month, fixed and stated:**

```
VAT reclaim  →  NOI  →  sales sweep  →  refinance event
```

All four can fall in one month. The order is arbitrary in the sense that any
order could be defended, and therefore it must be **written down and
asserted** rather than left to the order the code happens to run in.

NOI is applied **in full** to the senior facility, ignoring `sales_sweep_pct`
— which governs *sale* receipts — and any surplus distributes to equity that
month. Where NOI achieves the first full redemption, the exit fee is charged
then, under §4.4.1's existing once-only rule.

A negative NOI month draws uncommitted additional equity, never the facility.
`MonthlyModel.totals` gains `operating_shortfall_equity_pence`, the slice of
`additional_equity_pence` that funded operating losses — mirroring
`refinance_shortfall_equity_pence` exactly.

**§7 sources and uses.** Both new flows sit **outside** §7's identity, for the
reason `vat_reclaim_pence` does: §7 balances project *funding* against project
*costs*, and hold-period operating income is neither.
`operating_shortfall_equity_pence` is excluded on the same basis as
`refinance_shortfall_equity_pence`, and still counts toward additional-equity
flags, equity contributed and the equity cash-flow vector.

**What this deliberately does not move.** **NOI does not enter §3's profit.**
Profit stays `GDV − TDC`, the development residual. NOI reaches the return
metrics the honest way — through lower interest (a real ledger effect) and
through `equity_cashflows_pence`, which drives IRR and the equity multiple. A
guard asserts `profit_pence` is unchanged between two documents that differ
only in NOI, at equal finance costs (the finance-cost qualifier matters: NOI
*does* change finance costs, by design, so the guard holds costs equal rather
than asserting the schedules are otherwise identical).

**One consequence to test rather than discover.** NOI distributions enter
`equity_cashflows_pence`, so a `retain_all` case can now produce an IRR where
`irr_unavailable` used to fire — an IRR that measures the income stream and
ignores the retained asset entirely. `has_realisation_event` stays **false**
(income is not realisation) and §3.16.1's unrealised labelling is unchanged,
so the guard rails hold.

### 19.6 Outputs and reporting

**The result block.** `Schedule` gains `investment_case`:

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

`Schedule.investment_case: InvestmentCaseResult | null` — **republished,
never recomputed**, the treatment §17.12 gave `vat`. `AppraisalResultV2`
republishes the same object. The UI and the report read it and never call the
engine. `null` on the `investment_case = null` path, exactly as the input is
— no block is synthesised for a document that never asked for one (§18.10
limitation 1's reasoning, unchanged).

**§18.10 limitation 9, closed.** `Schedule` gains:

```
resolved_exit_months: { tranches: number[]; refinance: number | null }
```

This is the field §18.10 limitation 9 named as missing, and closing it is
narrower than that limitation's original text suggested. Of the two surfaces
that name a tranche's or the refinance's month:

- **The investment memo**'s refinance clause was **never wrong** — it already
  read `schedule.refinance.month`, resolved by `resolveAnchorMonth` (§18.6)
  since that resolver existed, independently of and predating this field.
  Only its **sales-phasing** clause read the raw `month_offset`; that clause
  now reads `resolved_exit_months.tranches`.
- **`CashflowPage`** had **both** clauses wrong: its sales-phasing clause and
  its refinance clause both read the raw `month_offset`. Both now read
  `resolved_exit_months`.

A test anchored a tranche on a slipped programme and was confirmed to fail
against pre-fix `main` before the fix landed — a carried defect fixed without
a failing assertion behind it is a claim, not a fix.

**Screens.**

- **`ExitStrategyPage`** gains the anchor controls R12 never shipped (tranches
  and refinance), plus the investment case, split into
  `OperatingScheduleEditor.tsx` and `InvestmentCaseCard.tsx` so no single file
  absorbs the whole release. For `retain_all`, the page populates a
  `retained_units` row for every unit, which is what makes §19.7 rule 2's
  completeness rule a non-event in the UI.
- **`CashflowPage`** gains the NOI row and reads `resolved_exit_months`.
- **The investment memo** gains an investment-case section: the rent roll,
  the NOI bridge (potential → effective → less operating lines → NOI), the
  value with the yield and purchaser's costs stated, **all three candidate
  quanta with the binding one named**, the achieved ratios, and any residual
  balance the take-out fails to clear. Where the case is indicative
  (`is_booked: false`) the section says so.

### 19.7 Validation

Input errors, not flags. Applying only when `investment_case` is non-null
unless stated:

1. `route = 'sell_all'` with a non-null `investment_case` — nothing is
   retained.
2. `route = 'retain_all'` requires a `retained_units` entry for **every** unit
   in `unit_mix` (§19.2's silent-understatement trap).
3. Every `retained_units[].unit_id` names a unit that exists.
4. Total gross potential rent > 0.
5. When `refinance` is non-null and `investment_case` is non-null:
   `investment_value_pence` and `ltv_pct` must both be `null`. **And, when
   `investment_case` is null and `refinance` is non-null, both must be
   non-null** — today's rule, restated as the other arm. A null `refinance`
   alongside a non-null `investment_case` is legal and is the indicative case
   of §19.1.
6. `stabilisation.anchor` names a phase that exists, and requires `programme`
   non-null (§18.8's rule, reused).
7. The resolved stabilisation month lies in `[0, term_months − 1]`. Otherwise
   a hard error, on §18.8's reasoning: income that never starts inside the
   term books zero NOI silently.
8. `stabilised_occupancy_pct` finite, in `(0, 100]`; `ramp_months` a whole
   number >= 0.
9. `cap_yield_pct` finite > 0; `purchasers_costs_pct` finite >= 0.
10. `takeout`: `ltv_cap_pct` in `(0, 100]`; `dscr_floor` > 0; `icr_floor` > 0;
    `annual_rate_pct` finite >= 0; `amortisation_years` null or > 0;
    `term_years` > 0.
11. `operating_lines`: ids unique and non-empty; `code` in the enum; `basis`
    in the enum; `value` finite >= 0; and <= 100 on the `pct_of_gross_rent`
    basis. An empty array is legal — NOI is then gross rent.
12. `refinance.arrangement_fee_basis` in the enum; `arrangement_fee_pct`
    finite in `[0, 100]`. Applies whenever `refinance` is non-null, whether
    or not `investment_case` is.

**Flags** (not errors):

| Code | Severity | Fires when |
|---|---|---|
| `investment_case_noi_non_positive` | red | stabilised annual NOI <= 0 |
| `stabilisation_incomplete_at_maturity` | amber | `s + ramp_months > term_months` — the value capitalises a stabilisation the term never reaches |
| `takeout_constrained_by_coverage` | amber | `binding_constraint` is `dscr` or `icr` |

A ramp running past maturity is **not** an error: refinancing mid-lease-up is
a real structure. It is flagged because the valuation reads the stabilised
figure regardless, and that gap should be visible rather than inferred.

### 19.8 Sensitivity: three levers, a fourth in R16, and the §12.2 carve-out

§12.1's table goes from five rows to eight (§12.1). The three new rows —
`exit_yield`, `operating_cost`, `vacancy` — write fields no other lever
touches, so §12.1's order-independence property holds unchanged and the
existing all-levers-in-several-orders test gains three entries. None carries
a target, so their duplicate checks key on `lever` alone — unlike
`phase_slip`, which keys on `(lever, phase_id)`.

On a document with `investment_case = null` all three are **no-ops by
construction**, exactly as `phase_slip` is on a null programme. A zero-width
tornado bar is the honest report of a lever with nothing to move.

**§12.2 gains the carve-out this release needs** (stated there in full): the
take-out is **not** the committed facility and is **re-solved in every cell**,
deliberately. Without it, §12.2's opening sentence reads as though all debt —
take-out included — is held at base, which would make `exit_yield`,
`operating_cost` and `vacancy` measure nothing.

**[R16 — calc 2.17.0] A fourth lever on this section's block: `refi_ltv`.** §12.1's
thirteenth lever **subtracts** percentage points from
`investment_case.takeout.ltv_cap_pct` — §19.4's LTV cap, the field the take-out is sized
on — so a positive value is the adverse direction, `vacancy`'s convention. It writes that
field and nothing else, so it composes with every other lever in any order. `refinance.ltv_pct`
was rejected as the target: §19.1 narrowed it to nullable and inert from R13 on, and a
lever writing an inert field would look live while measuring nothing.

**The carve-out above is what makes `refi_ltv` measure anything at all.** The cap it
lowers is only consulted by a take-out that is re-solved in the cell; held at its base
value, the quantum would not move and the lever would be inert for the same reason the
other three would have been. What `refi_ltv` does **not** stress is the DSCR and ICR
floors, so on a scheme already bound by DSCR below the lowered cap it moves nothing —
applicable and inert, which §19.4's published `binding_constraint` makes legible and
§25.8 limitation 3 states.

**Cell validity (§12.7) is existing validation, not new sensitivity logic.**
The design intent behind this release was to give `sensitivity.ts`/
`sensitivity.py` three new degenerate-cell rules — `cap_yield_pct <= 0`,
`stabilised_occupancy_pct <= 0`, an operating line's `value < 0`. **No new
code was needed in either sensitivity module.** §19.7 rules 8, 9 and 11
already reject exactly those three shapes as validation errors, and §12.7's
existing mechanism (`measure()` validates the levered document before
appraising, and an error-severity issue yields an unmeasured, invalid
position, never a clamp) already routes every levered `investment_case`
document through them. The three degenerate cases are therefore cell-invalid
by the same path every other invalid cell already takes — a case of the
mechanism doing the work a new rule would otherwise have had to. **[R16 — calc 2.17.0]**
`refi_ltv` is the fourth instance of the same finding: a value that drives
`ltv_cap_pct` to zero or below needs no sensitivity-side rule, because rule 8's
`0 < ltv_cap_pct <= 100` already rejects the levered document and §12.7 makes the
position unmeasured (§25.6).

### 19.9 Migration and the persistence boundary

```
v9 investment_case: (absent)   →  v10 null
v9 refinance: null             →  v10 null
v9 refinance: non-null         →  v10 same, plus
                                    arrangement_fee_basis: 'fixed_pence'
                                    arrangement_fee_pct:    0
                                  (investment_value_pence and ltv_pct unchanged
                                   and still non-null — the explicit path)
```

**No existing appraisal's computed values move.** The migration gate is
numeric **and** validation-side, and the validation side is **three
separately falsifiable properties, not one set equality** — §18.7's
correction, applied from the start this time:

1. Every issue a v9 document raises has a v10 counterpart under a stated
   alias map.
2. The v10-only rules of §19.7 raise no issue on a migrated document.
3. A control document that *does* trip a v10-only rule raises it — proving
   the new rules can fire at all, so property 2 is not vacuously true.

**Property 1 was built with the migration gate itself; properties 2 and 3
needed a v10-only validation rule that actually fired, and none existed until
§19.7 was written — so property 1's home is the schema/migration task and
properties 2 and 3's home is the validation task**, later in the same
release. They are a matched pair by design: property 3 is what stops property
2 being vacuous, and writing property 2 alone would reproduce the exact
defect shape R12 shipped and had to rewrite mid-release (§18.7).

Both engines run the numeric gate corpus-wide.

### 19.10 Stated limitations

Recorded so they are not read as oversights.

1. ~~No unit-level sale timing or per-unit selling costs, and no deposits~~ — **closed by R13b (§22)**; kept as history.
2. **Rent is flat in nominal terms** over the hold. No review pattern, no
   indexation, no stepped rent.
3. **Occupancy is scheme-level.** There are no per-unit voids or per-unit
   letting dates; the ramp applies uniformly to the retained rent roll.
4. **Purchaser's costs are one percentage**, not an itemised build of
   acquisition tax, agency and legal.
5. **The take-out is sized, not underwritten.** No covenant testing over the
   take-out's life, no cash sweep in the take-out, no rate hedging, no
   interest holiday.
6. **The valuation capitalises the stabilised year**; it does not discount
   the ramp. A DCF of the hold period is a different instrument.
7. **DSCR and ICR are equal by construction** on an interest-only take-out
   (§19.4).
8. **NOI does not enter §3 profit** (§19.5). It reaches returns through
   interest and the equity cash-flow vector only.
9. **Operating lines carry no source, date or status.** The evidence model is
   R15's, on the same reasoning §14.6, §15.9 and §16.9 already record.

### Guards this release must watch fail

Per the standing rule that every guard be planted against and watched failing
before it is trusted:

| Guard | Watched by |
|---|---|
| Rent liveness | Changing one retained unit's `monthly_rent_pence` changes NOI, investment value, the quantum, total interest and the closing balance — on **absolute** figures. This is the defect the release exists to fix: the input was inert for eight input versions |
| Binding-constraint liveness | Three fixtures engineered so a different constraint binds in each; assert the named constraint **and** that the quantum equals that cap to the pence |
| DSCR/ICR divergence | Two documents differing only in `amortisation_years`: null gives equal ratios, non-null gives divergent ones |
| Stabilised ≠ ramp average | A fixture where 12 × the stabilised month and the sum of the first twelve months differ; the value must follow the former |
| NOI isolation | Two documents with identical sale receipts, one with NOI and one without: `gdv_pence` is **identical**, re-derived from unit values directly rather than read back off the result (§19.5) |
| NOI does not enter profit | `profit_pence` unchanged between the same two documents once finance costs are held equal |
| Sweep liveness | NOI reduces peak debt, terminal balance and total interest — on **absolute** month numbers and figures, not directions |
| Within-month order | A month carrying VAT reclaim, NOI, a sale tranche and the refinance event together reproduces a hand-derived closing balance |
| Negative NOI | An opex-heavy fixture draws additional equity, never a facility draw; `operating_shortfall_equity_pence` matches and §7 still reconciles |
| Null-path identity | `investment_case = null` is bit-identical to calc 2.11.0 corpus-wide, in both engines |
| Migration identity, both axes | The numeric gate plus the three validation properties of §19.9 |
| Resolved exit month (R12 carry) | An anchored tranche on a slipped programme: memo and cashflow print the **resolved** month. Confirmed to fail against pre-fix `main` first |
| Retain-all rent completeness | A `retain_all` document missing a `retained_units` row is rejected; its complete twin, differing by one row, is accepted and has a higher NOI |
| Stabilisation-after-maturity | Errors; its in-term twin, differing by one month, does not |
| Lever order-independence | All **eight** levers applied in several orders give identical results |
| Lever inertness on the null path | The three new levers on an `investment_case = null` document produce a zero-width tornado bar, not an error and not a silent value change |
| Cell validity | Yield and occupancy driven to zero produce **invalid cells**, not clamped ones — via §19.7's existing validation rules, not new sensitivity logic (§19.8) |
| §1.6 version list | A test reads the specification's inputs-version list and requires v10 — the guard missed twice running |
| Entry-point cutover (Task 18) | A real POST through the live server boundary with a v10 document (not two v9 runs) comes back `inputs_version: 10`, not `legacy_unreconciled`, with `investment_case` intact. Found a live defect the static entry-point guard cannot see: `app/api/app.py`'s response builder hard-coded the GOVERNANCE `inputs_version` (and `audit_hash`'s own `inputs_version` argument) to `9`, left over from R12, even after the migration call site itself moved to `migrate_inputs_to_v10` — a v10 snapshot would have been stored and returned correctly while its own governance column and audit hash still recorded v9, silently misdating every report's provenance |

**Guards deliberately not written**, because they would be vacuous by
construction: any assertion that an `OpexCode` is in the enum (the type
guarantees it); any assertion that `noi = egr − opex` (true by construction
of the implementation's own subtraction); any assertion that the quantum is
<= the minimum cap (that is the definition of `min`).

---

## 20. Monitoring cost-to-complete [R14 — calc 2.13.0]

§5.10's series is the **inception** forecast: what the appraisal said, month by
month, on the day it was written. §20 adds the other position a lender asks for
once a scheme is on site — a **monitoring statement**: the sponsor's entered
actuals at a single reporting date, measured against that inception model, with
the remaining uses reconciled against the remaining funding. It is one statement
per document, computed only when the document carries a `monitoring` block, and
it re-runs nothing: every ledger figure it reads is the already-computed
inception ledger's.

### 20.1 The schema

`monitoring` is top level and nullable, beside `investment_case` (§19.1). It sits
at the top level rather than under `finance` or `cost_plan` because the entered
actuals are a scheme fact, and the debt and equity figures among them are not
cost-plan facts.

```
monitoring: null | {
  reporting_month: int,                     // 1..term; a ledger label, §5.10's convention
  reporting_date: string,                   // ISO yyyy-mm-dd; printed only
  lines: MonitoringLine[5],                 // exactly one per category, any order
  debt_drawn_to_date_pence: int,            // >= 0: cumulative senior principal
                                            //   plus capitalised non-interest fees
  cash_equity_injected_to_date_pence: int,  // >= 0
  author: string, date: string, note: string | null
}

MonitoringLine {
  category: 'acquisition' | 'construction' | 'professional' | 'statutory' | 'contingency',
  current_budget_pence: int,       // >= 0: the QS's current approved budget
  certified_to_date_pence: int,    // >= 0
  paid_to_date_pence: int,         // >= 0
  committed_to_date_pence: int,    // >= 0
  forecast_to_complete_pence: int, // >= 0: cost NOT yet committed
}
```

**`reporting_month` drives the arithmetic; `reporting_date` does not.** The month
is a ledger index because the programme is expressed in month offsets with no
mandatory calendar start (`acquisition_date` is nullable, §14). The date is
required — a monitoring statement without a date is not one a lender will accept
— but it is a printed label, and changing it changes no computed figure. A test
asserts exactly that.

**The original budget is read from the inception model and is never entered**
(§15.4's one-fact-one-line rule). The five categories map onto it thus:

| Category | Original budget |
|---|---|
| `acquisition` | §3.3 acquisition cost — `Schedule.totals.acquisition_pence`, the same figure as `Σ uses.acquisition_pence` |
| `construction` | `cost_plan.base_build_pence + inflation_total_pence + compliance_pence` [R15b — calc 2.16.0, §24.5] — construction **excluding** contingency |
| `professional` | `cost_plan.professional_total_pence` |
| `statutory` | `cost_plan.statutory_total_pence` |
| `contingency` | `cost_plan.contingency_total_pence` |

**The construction/contingency split is the one place the inception model's lines
and the statement's lines differ.** §3.4 carries contingency inside the
construction cost line; the statement pulls it out because a lender's monitoring
report asks for remaining contingency as its own figure. The two are therefore
required to reconcile exactly:

```
original(construction) + original(contingency) == Σ uses.construction_pence
```

which holds by construction of §16.8's `construction_total_pence =
base_build + inflation_total + contingency_total + compliance` [R15b — calc
2.16.0 adds the inflation term; the identity itself is unaffected, because
`inflation_total_pence` sits on the `construction` side of the split on both
sides of the equation], and is asserted on every corpus fixture — Z included
— rather than left as an argument.

**Migration v10 → v11** stamps `monitoring: null` on every stored document. A
null block is today's inception-only path, bit-identical in every output; a
document that never asked for a monitoring statement does not acquire an empty
one. See `docs/financial-model/migration-notes.md` §14.

### 20.2 The statement

Computed at `m = reporting_month` from the entered block, the schedule, the cost
plan and the inception ledger. Nothing here re-runs the ledger.

**Per category, and in total.** Eleven columns per line; the totals row is the
column sum of the five lines.

| Column | Definition |
|---|---|
| `original_budget_pence` | §20.1's table |
| `current_budget_pence` | entered |
| `certified_to_date_pence` | entered |
| `paid_to_date_pence` | entered |
| `committed_to_date_pence` | entered |
| `committed_not_certified_pence` | `committed − certified` |
| `forecast_to_complete_pence` | entered |
| `estimated_final_cost_pence` | `committed + forecast_to_complete` |
| `variance_vs_original_pence` | `estimated_final − original` (positive = overrun) |
| `variance_vs_current_pence` | `estimated_final − current_budget` |
| `remaining_to_spend_pence` | `estimated_final − certified`, identically `committed_not_certified + forecast_to_complete` |

`paid_to_date_pence` is carried and printed — a lender reconciles certificates
against payments — but it drives no other column. The statement is a **cost**
position, not a cash position, and that is a deliberate scope statement rather
than an omission.

`contingency_remaining_pence` = `current_budget(contingency) −
certified(contingency)`, floored at 0, reported on its own because a monitoring
report is read for that figure specifically.

**The funding side.** The same three terms §5.10 uses, evaluated at one month and
against the entered actuals rather than the ledger's own draws:

```
undrawn_net_facility  = max(0, committed_net − debt_drawn_to_date)      (0 for a cash deal)
reserve_headroom      = rolled_up ? max(0, committed_gross − committed_net
                                            − cum_interest_capitalised(m−1)) : 0
remaining_cash_equity = max(0, cash_equity_total − cash_equity_injected_to_date)
remaining_funding     = undrawn_net_facility + reserve_headroom + remaining_cash_equity
```

`cum_interest_capitalised(m−1)` is the **inception** ledger's cumulative
capitalised interest through ledger month `m−1`: the statement carries no actual
interest figure, and the interest component is therefore forecast, not monitored
(§20.5 limitation 1). `cash_equity_total` is §5.10's filter unchanged —
cash-classified sources whose evidence status is not `rejected`.

**The uses side.**

```
forecast_finance = Σ_{k=m}^{term−1} ( months[k].interest_accrued + months[k].capitalised_fees )
remaining_uses   = totals.remaining_to_spend + forecast_finance
surplus          = remaining_funding − remaining_uses
shortfall        = max(0, −surplus)
```

**Variances against the inception plan.** Positive means ahead of — more than —
plan in all three, and the memo prints that sign convention beside the figures.

- `debt_drawn_variance_pence` = `debt_drawn_to_date − Σ_{k<m} (draw + capitalised_fees)`.
- `equity_injected_variance_pence` = `cash_equity_injected_to_date − Σ_{k<m} equity_contribution`.
- `cost_to_date_variance_pence` = `totals.certified − Σ_{k<m} (uses.acquisition + construction + professional + statutory)`.

**Rounding.** None. Every input is integer pence and every column is a sum or a
difference of integers. The only figure R14 rounds anywhere is §4.2(b)'s cap
base.

### 20.3 Validation and flags

Monitoring validation and the monitoring flags run **only** when `monitoring` is
non-null. A null block adds no issue and no flag, so no existing document's
`validation.issues` or `flags` moves.

**Hard errors** (`report_safe` false). Field strings address the offending line
by **array position**, not by category, so an issue points at the row the user
edited:

| Field | Condition |
|---|---|
| `monitoring.reporting_month` | not an integer in `1..term` |
| `monitoring.lines` | not exactly one line per category — five distinct categories, any order |
| `monitoring.lines[i].paid_to_date_pence` | `paid > certified` |
| `monitoring.lines[i].certified_to_date_pence` | `certified > committed` |
| `monitoring.debt_drawn_to_date_pence` | `> committed_net_facility_pence`, and `> 0` for a cash deal |

**One input warning** (`ValidationIssue`, severity `warning`, field
`monitoring.cash_equity_injected_to_date_pence`): equity injected beyond
committed sources — `cash_equity_injected_to_date > cash_equity_total`. This is
**not** an error. A sponsor putting in more equity than the committed sources
record is the case a monitoring statement exists to surface, not a malformed
document.

**Three result-derived warnings are flags, not validation issues** (`FlagCode`,
raised in `deriveMetrics`/`derive_metrics` beside `funding_gap` and §19's flags).
Validation runs on inputs alone and cannot see the computed statement, so these
could not be validation issues without recomputing it. All three are dated with
the statement's own `reporting_month`.

| Flag | Severity | Condition |
|---|---|---|
| `monitoring_shortfall` | red | `shortfall > 0`; the message and `amount_pence` carry the figure |
| `monitoring_cost_variance` | amber | some category's `variance_vs_original` exceeds 5% of a non-zero `original_budget` |
| `monitoring_dated_after_redemption` | amber | `reporting_month` is later than the ledger's last month carrying a repayment |

`monitoring_cost_variance` is tested in **strict integer arithmetic** —
`abs(variance_vs_original) × 20 > original_budget`, never a floating ratio — and
the comparison is strict: a line at exactly 5% does not fire. It is raised **once
per statement**, naming the category with the largest absolute variance among
those that qualify. `monitoring_dated_after_redemption` is skipped entirely when
no ledger month carries a repayment (a retain-only schedule, or a cash deal with
no facility to redeem) — there is no redemption month to be later than.

A shortfall is a red flag and a reported field, never a hard error: the statement
exists precisely to report the shortfall, and refusing to produce the document
that says so would be the wrong answer.

### 20.4 Outputs and reporting

- **§5.10's series** keeps its shape and its two summary keys
  (`cost_to_complete_first_shortfall_month`, `cost_to_complete_max_shortfall_pence`);
  each month gains `remaining_interest_reserve_headroom_pence`, so the term the
  correction added is visible on its own rather than buried in the funding total.
  The per-month columns are `month`, `remaining_cost_pence`,
  `remaining_funding_pence`, `remaining_interest_reserve_headroom_pence` and
  `surplus_pence`; the undrawn-facility and remaining-equity terms are not
  broken out separately.
- **`lender_eligible_ratio`** is on `CostPlanResult` (§16.8) and republished on
  the `Schedule`, which is where the ledger reads it.
- **`monitoring_statement`** is published on `AppraisalResultV2` in both
  engines, `null` exactly when the input block is null. It carries the columns
  of §20.2 plus `reporting_month` and `reporting_date`, echoed. It is computed
  **once**, in `deriveMetrics`/`derive_metrics`; no component and no report
  generator recomputes it.
- **Fixture expected-metrics** gains `monitoring_shortfall_pence`,
  `monitoring_estimated_final_cost_pence`, `monitoring_surplus_pence` and
  `lender_eligible_ratio`. `w-monitoring-on-site` (inputs v11, detailed mode, one
  ineligible package, `monitoring` at reporting month 6) pins all four —
  `0`, `27,520,000`, `10,101,207` and `0.9166666666666666` — hand-derived in
  `docs/financial-model/test-cases.md` §20.4. It is the release's cross-engine
  penny-agreement carrier and the only detailed-mode fixture that still reaches
  §7's fully-realised profit identity.
- **Screens.** `CostToCompleteCard` gains the reserve-headroom column. A
  `MonitoringEditor` on the Finance page enters the five lines, the two
  cumulative figures and the provenance, and removes the case by setting `null`.
  A `MonitoringStatementCard` on the summary page prints the per-category table,
  the funding reconciliation and the three variances, and is rendered only when
  a statement is present. No arithmetic in components: every figure printed is a
  result field.
- **Memo.** A "Monitoring cost-to-complete" section, printed **only** when
  `monitoring_statement` is non-null, after the existing cost-to-complete
  material: the per-category table with its totals row, the funding
  reconciliation term by term, the shortfall sentence when and only when there
  is a shortfall to report, and a provenance line carrying `reporting_date`,
  `reporting_month`, author and date. Report QA asserts the section is absent on
  every document without a monitoring block.
- **What a report may claim (§13.4).** The statement is a **sponsor-entered**
  monitoring position. The memo prints, in the section itself: "Interest and
  capitalised fees from the reporting month onward are the inception forecast;
  certified and committed figures are as entered by the sponsor and have not
  been verified by a monitoring surveyor." The §13.3 draft gate is unchanged —
  a document with no monitoring case is not thereby unsafe, and a monitoring
  statement does not make a document FINAL.

### 20.5 Stated limitations

Recorded so they are not read as oversights.

1. **The interest component is forecast, not monitored.** Interest and
   capitalised fees from `reporting_month` onward are the inception ledger's
   figures; there is no actual-interest input, and none of the entered actuals
   revises them.
2. **Actuals are per category, not per package.** Five lines, and no QS source,
   date or status against any of them. Per-package actuals and their provenance
   are R15's, on the same reasoning §14.6, §15.9 and §16.9 already record.
3. **`lender_eligible` acted as a uniform ratio on the construction line**
   (§4.2(b), §16.9). Contingency and compliance followed it proportionally, and
   an ineligible package's own spend months were not distinguished. A
   per-package draw profile needed per-package spend in the monthly uses, which
   §18's phase-level bucketing did not provide. The wiring's effect was real and
   was recorded rather than smoothed over: `q-detailed-cost-plan` and
   `s-dated-programme`, the two corpus fixtures carrying an ineligible package
   alongside `development_cost_advance_pct: 100`, reported funding gaps of
   2,031,318 and 6,300,000 respectively and were no longer report-safe.

   **[R15b — calc 2.16.0] Resolved; kept as a historical note.** §24.4 replaces
   the uniform ratio with a per-month lender-eligible share computed from each
   package's own resolved window, and §4.2(b) reads that per-month figure. The
   share recovers this exact ratio, every month, on every document whose
   packages share one spend window — `q-detailed-cost-plan`'s funding gap of
   2,031,318 is unmoved for exactly that reason. It departs only on fixture S,
   whose eligible package spends in its own window: `funding_gap_pence` moves
   from 6,300,000 to 6,330,000, because the strip-out months now fund in full
   and the shortfall concentrates into fewer months rather than spreading
   across all of them (§24.4). What survives is the narrower §24.9 limitation
   3: the share is a ratio over per-package weights, not a per-package ledger.
4. **The statement is a snapshot, not a re-simulation.** §5.10's "Known
   limitation" applies to it unchanged: it measures committed sources against
   forecast cost at one date; it does not replay the ledger's month-by-month
   throttling from the actuals.
5. **No drawdown-request or certificate history.** One statement per document,
   overwritten when it is updated. A history belongs with the change log
   scheduled as R14b.
6. **No lender-case linkage.** A monitoring statement does not make a document
   FINAL, and an approved lender case does not require one.

### Guards this release must watch fail

Per the standing rule that every guard be planted against and watched failing
before it is trusted, and named with the change it would miss (§17's rule).

| Guard | Watched by |
|---|---|
| Fixture P's pins move | `null` / `0` replace `1` / `392483`, and the old figures become the **negative controls** in both engines. Observed failing before the §5.10 correction landed; a pinned zero cannot be produced by a phantom-shortfall engine |
| The correction is not one-sided | `v-exhausted-reserve` reports a **positive** shortfall and a non-zero `funding_gap_pence` under the chosen correction; the rejected correction (drop rolled-up interest from remaining cost) reports 0 on the same document, and that comparison was run and recorded rather than argued |
| Serviced-interest identity | A serviced fixture's whole `cost_to_complete` series is deep-equal before and after the correction. Would miss a constant added to both sides — fixture P's pinned zero catches that |
| The ineligible-package pair | A detailed-mode pair differing only in one package's `lender_eligible`: strictly smaller cumulative draw, strictly larger cumulative `funding_gap_pence`. Direction-only, so it would miss a ratio that is merely wrong-but-`< 1` — fixture W's pinned `lender_eligible_ratio` catches that |
| The construction split identity | `original(construction) + original(contingency) == Σ uses.construction_pence` on every corpus fixture, not only the monitored one |
| v11 numeric identity | Every pre-v11 fixture migrates and produces identical metrics, ledger and schedule; the filter reads `doc["inputs"]["inputs_version"]`, the R13 lesson, and a companion test fails if the migration corpus silently empties |
| `reporting_date` is inert | Two statements differing only in `reporting_date` are otherwise equal |
| The 5% variance boundary | Fixture W's construction line sits at exactly 5.0% and must **not** fire; its contingency line, at 16.7%, must. `>` rather than `>=`, in integer arithmetic, is the load-bearing detail |
| Entry-point cutover | `migrate_inputs_to_v11` / `migrateInputsToV11` at every production call site, with the governance `inputs_version` still **derived** from the document rather than restated as a literal — R13's finding |
| Spec-versions pin | `CALC_VERSION` 2.13.0 and the §1.6 inputs-version list carrying v11, asserted against this document in both engines |

---

## 21. Lender case governance [R14b — no calculation-version change]

§13.3 has required an approved lender case since R7 and nothing has ever been
able to supply one. §21 supplies it: a **lender case** is a locked snapshot of a
stored appraisal, carrying governance state through a server-enforced state
machine, a reviewer and a decision, an append-only change log, and a hash of its
own. It changes no computed value — there is no engine change, no input-schema
change and no fixture pin move in this release — and it is versioned by Alembic
migration 006 and by this section.

The release exists to answer two questions a lender could not previously ask of
a document: *who approved this, and were the figures they approved the ones I am
looking at?*

### 21.1 The case record and the lock

**The lock is the whole document.** A case copies, at creation, the stored
appraisal's entire `inputs_snapshot` together with its `calc_version`,
`inputs_version`, `input_hash`, `outputs_hash` and `audit_hash`:

| Locked column | Copied from | Why it is locked |
|---|---|---|
| `locked_inputs_snapshot` | the stored appraisal's `inputs_snapshot`, in full | so what was approved can still be *read and compared* after the developer case moves on, not merely detected as changed — the comparison is by hand, §21.6 limitation 4 |
| `locked_calc_version` | stored `calc_version` | outputs are only comparable within one calc version (§1.6) |
| `locked_inputs_version` | stored `inputs_version` | the schema the approved figures were computed under |
| `locked_input_hash` | stored `input_hash` | the staleness comparand (§21.3) |
| `locked_outputs_hash` | stored `outputs_hash` | the figures as approved |
| `locked_audit_hash` | stored `audit_hash` | the last component of `case_hash` (§13.2.1) — what binds the case to the exact document |

A **lender-fields-only** lock was rejected: it needs a per-field lock list that
every future release must re-litigate, and a field nobody thought to list is then
silently outside the approval. A **hashes-only** lock was rejected for the
opposite reason: it can tell a reader *that* the document moved but can never
show them *what* was approved.

**Creation preconditions, each with its own status code.** The project must exist
(404) and must carry a stored appraisal (404 — "save an appraisal before opening
a lender case"). That appraisal must carry its provenance hashes (422): a
pre-provenance row, saved before §13.2's hashes existed, cannot be bound by the
case-hash chain, and locking it would assert a binding no run produced —
re-saving the appraisal recomputes the hashes and clears the refusal. And no live
case may already exist for the project (409). The `locked_audit_hash` column is
itself not-null, so the precondition is also a schema fact rather than only an
endpoint check.

**Record identity is the project.** The case's foreign key is `project_id`, on
the §13.2 reasoning unchanged: migration 003 made the appraisal unique per
project, so the project is the stable identity of the record. A foreign key to
the appraisal row's own id would survive only for as long as nothing dedupes that
row, and the appraisal repository deliberately tolerates legacy duplicates.

**One live case per project, enforced twice.** A project may have any number of
`superseded` cases — they are the history — and at most one that is not. The
endpoint checks it and returns 409; the database enforces it with a **partial
unique index** on `project_id` where `status != 'superseded'`, declared once on
the ORM index with both `postgresql_where` and `sqlite_where` so that Alembic's
migration and the boot-time `create_all` path agree in every environment. The
application check is a courtesy that produces a good error message; the index is
the invariant, and it is tested at the database layer rather than only through
the endpoint, because a check that lives in one code path is not an invariant.

**Actors are free text** (`created_by`, `submitted_by`, `reviewer`,
`decided_by`), the `LenderValuation.author` idiom. The product has no
authentication, so the record says who *claims* to have acted and the change log
says when; see §21.6 limitation 1.

### 21.2 The state machine

The statuses are the union `report-provenance.ts` has carried since R7:
`draft | submitted | under_review | information_required | credit_approved |
approved_with_conditions | declined | superseded`.

This table is **normative**, and lives once per language — `ALLOWED_TRANSITIONS`
in `app/financial_model/provenance.py` and in
`frontend/src/lib/report-provenance.ts`, mirrored literally and pinned against
each other by tests that restate the whole table rather than derive it:

| From | To |
|---|---|
| `draft` | `submitted`, `superseded` |
| `submitted` | `under_review`, `superseded` |
| `under_review` | `information_required`, `credit_approved`, `approved_with_conditions`, `declined`, `superseded` |
| `information_required` | `under_review`, `superseded` |
| `credit_approved` | `superseded` |
| `approved_with_conditions` | `superseded` |
| `declined` | `superseded` |
| `superseded` | — (terminal) |

`superseded` is the universal exit and is itself terminal: every state can reach
it, and nothing leaves it. That is what makes §21.6 limitation 3's
supersede-and-recreate refresh always available without any state needing a
second escape route.

**The UI derives its buttons from this table and never keeps its own list.** A
hand-kept list of enabled actions is a second copy of the state machine, and the
copy is what goes stale.

Per-transition side effects, applied server-side in the same transaction as the
event write:

- `→ submitted`: the actor is recorded as `submitted_by` and `submitted_at` is
  stamped.
- `→ under_review`: the actor is recorded as `reviewer`. A resubmission
  (`information_required → under_review`) **overwrites** it — the reviewer of
  record is the current one, and the event log keeps the history. Recording only
  the first reviewer would make the panel name someone who did not decide.
- `→ credit_approved | approved_with_conditions | declined`: the actor is
  recorded as `decided_by` and `decided_at` is stamped.
- `→ superseded`: the actor is recorded **in the event only**. The case's own
  columns keep the state they had, so the history shows what the case was when it
  died — a superseded approval still reads as an approval that once held.
- Every transition, creation included, writes its change-log event and recomputes
  `case_hash` (§13.2.1).

**The conditions rule: one field, one meaning.** `conditions` is **required** for
`approved_with_conditions` and **must be absent** on every other transition;
either violation is a 422. A conditions field that some transitions merely ignore
would let a note be attached where it has no meaning and then be printed by a
report that assumes it was an approval condition. The free-text `note` carried on
every transition is where the other commentary goes; it lands in the change log,
not on the case.

**Status codes.** An illegal transition is a **409** whose detail names the
current status and the whole allowed set, so a client can correct itself without
a second request. A transition against a project with no live case is a **404**.
A `to_status` that is not a member of the union at all is a **422** — not a 409:
409 says "not from here", and an unknown status is not a state the document could
ever be in.

### 21.3 Staleness

Staleness is **derived at read time and stored nowhere**. Two checks exist, and
they answer different questions:

- **Server-side, authoritative, and what the memo uses.** The live stored
  appraisal row's `input_hash` no longer equals the case's `locked_input_hash`.
  It is computed on every case read and returned as `stale` on the read shape. A
  row carrying no `input_hash` at all is stale too: it cannot demonstrate that it
  is the approved document. This is the flag the exported memorandum consumes,
  and it fully covers the memo path, because the memo is generated from the
  *stored* record — the export page fetches the saved appraisal and runs from its
  snapshot.
- **Client-side, in the calculator, and nowhere near the memo.** A deep
  structural comparison of the in-session inputs against
  `locked_inputs_snapshot`. An unsaved edit moves no stored hash, so this is the
  only check that can see one; it drives the Lender Case page's "unsaved edits
  differ from the locked snapshot" warning and nothing else. Key order is
  irrelevant to it and array order is meaningful, both pinned by tests. It is a
  structural comparison rather than a client-side re-hash on purpose: §13.1's
  rule is that hashes are the server's, never the client's.

**Storing staleness was rejected.** Writing `superseded` onto the case when the
developer case is saved would destroy the record that the case *was* approved,
and would entangle the appraisal write path with governance writes. The appraisal
write path is untouched by this release: a developer save neither reads nor
writes the case tables, and staleness simply emerges at the next case read.

**Warning-only staleness was also rejected.** It would let a FINAL banner print
over figures the lender never saw, which is the exact fault the audit names.
Staleness therefore **defeats FINAL**, through §13.3 condition 6.

Staleness is a property of **any** live case, not only an approved one, and the
Lender Case page warns on all of them. It reaches the document status only
through condition 6, which is tested after the approval gate — see §13.3's
mutual-exclusivity bullet.

**Stated limitation, mirroring §13.2's boundary-bump limitation.** A future
`inputs_version` boundary migrates a stored snapshot server-side on the next
save, which moves `input_hash` with no user edit at all — so every live case goes
stale at that boundary. This is correct behaviour and not a defect: the stored
document is no longer byte-for-byte the one that was approved, and a case that
stayed green across a schema migration would be asserting something it cannot
know. It is recorded here so the next migration release's notes can say so,
rather than have a lender discover it.

### 21.4 The case hash

Defined in **§13.2.1**, with the other provenance hashes, because that is where a
reader looking for "what hashes does this product compute, and what do they
bind?" will look, and because its final component is the audit hash defined
immediately above it. It is not restated here: a formula written twice is a
formula that will eventually differ.

What §21 adds is only *when* it is computed — at creation, and again on every
transition, from the case's post-transition values (§21.2) — and *why its
components are printed on the provenance panel*, which is §13.1's case rows and
the three bullets beneath them — including the two normalisations a reader must
apply to the printed status and timestamp before the recomputation will close.

### 21.5 API and change log

A `lender_cases_router` mounted with the others under the API prefix, following
the house conventions throughout: the shared database dependency,
`HTTPException` details in the two shapes the client's error formatter reads,
repositories that flush and endpoints that commit.

| Endpoint | Behaviour |
|---|---|
| `POST /lender-cases` `{project_id, created_by}` | Creates the case at `draft`, locking the snapshot from the stored appraisal (§21.1); 201 on success. 404 no project, 404 no appraisal, 422 the appraisal carries no provenance hashes or `created_by` fails its §13.2.1 field-boundary validation (too long, or containing `|`/a control character), 409 a live case already exists. Writes the creation event, whose `from_status` is null. |
| `GET /lender-cases/{project_id}` | The live case with derived `stale`, or JSON `null` when none exists — **200 either way**: "no case yet" is a normal state of a project, not an error. 404 only when the project itself is unknown. |
| `POST /lender-cases/{project_id}/transition` `{to_status, actor, note?, conditions?}` | Validates against §21.2's table, applies the side effects, writes the event and recomputes `case_hash`. 404 no live case, 409 illegal transition or a compare-and-swap failure (the case moved between this request's read and its write — re-read and retry), 422 unknown status, a conditions-rule violation, or `actor` failing its §13.2.1 field-boundary validation. |
| `GET /lender-cases/{project_id}/history` | Every case the project has ever had, superseded included, newest first, each with its derived `stale`. |
| `GET /lender-cases/{project_id}/events` | The change log across all of the project's cases, newest first. |

**The change log is append-only.** Events are rows in their own table
(`lender_case_events`), never a mutable JSON column on the case — a log that can
be rewritten by the thing it logs is not a log. Each event records `from_status`,
`to_status`, the actor, an optional note and the time; `from_status` is null
exactly once per case, on the creation event. Every case write, creation
included, writes its event **in the same transaction** as the write it records,
so the log cannot be missing an entry for a state the case actually reached.

**Newest-first ordering is by the events' integer key, not by timestamp.**
[Refined at plan time, against the design's first draft.] The event table takes
an autoincrement integer primary key rather than the UUID of the stage-transition
table it is otherwise modelled on, because SQLite's `CURRENT_TIMESTAMP` has
one-second resolution and successive requests routinely share a timestamp: two
events written in the same second are not distinguishable by `occurred_at`, and a
random UUID sorts arbitrarily. The event listing therefore orders by `id`
descending. The case history has the same problem and solves it with the same
key: it orders by `created_at` descending and then by **each case's greatest
event id** descending — every case writes its creation event in the transaction
that creates it, so the greatest event id is the schema's own monotonic record of
creation order, and it breaks a same-second tie correctly rather than
arbitrarily. Both orderings live in the repository's `ORDER BY` rather than in a
re-sort in the endpoint: the query is where an ordering contract belongs, and a
sort applied after a `LIMIT` would be wrong in any case.

**Governance rules live in one place per language.** They live in
`app/financial_model/provenance.py`: `ALLOWED_TRANSITIONS` (§21.2),
`APPROVED_STATUSES`, `is_stale` (§21.3), and the six-member `DraftReason` with
`draft_reason` and `document_status` (§13.3). The transition endpoint validates
against the first and the read shape derives its `stale` flag with the third; the
document-status half has no server consumer yet and is ported anyway, because a
governance rule that exists in one language is a rule the other language can
contradict without anything failing. The module is a line-for-line port of
`report-provenance.ts`'s governance core under the same parity contract as
`monitoring.py`: a change to either side's rules is made to both in one change,
and `tests/test_provenance.py` mirrors `report-provenance.test.ts` case-for-case.
Until R14b this governance was pure presentation and lived in TypeScript alone;
making it server state with server-enforced transitions is what forced the twin
into existence, because the API cannot validate a state machine that exists only
in the client.

### 21.6 Stated limitations

Recorded so they are not read as oversights.

1. **No authentication, so actor names are claims rather than identities.** The
   four actor fields are free text, and nothing verifies that whoever typed
   "R. Reviewer" is one. Real user identity — a users table, sessions, and the
   attribution of every write path in the product — is its own release, and a
   single-user product gains very little from it today. The change log's value is
   unaffected: it is an accurate record of what was asserted and when, which is
   what a later reviewer needs in order to ask the right question.
2. **No drawdown-request or certificate history.** §20.5 limitation 5 names the
   change log as where such a history would live. The *case* change log ships
   here; a monitoring statement is still one statement per document, overwritten
   when it is updated, and this release adds no per-drawdown or per-certificate
   record.
3. **Supersede-and-recreate is the only refresh.** A locked snapshot is never
   rewritten, so there is no "re-lock" action: a stale case is superseded and a
   new case is created against the current appraisal, which then runs the state
   machine from `draft` again. An in-place re-lock would mutate the very thing
   whose immutability is the feature, and would leave no record that the earlier
   approval had been given against different figures.
4. **The whole-document lock carries no field-level view of what changed.** The
   case can say that a document has moved, and it holds both snapshots, but it
   computes no diff — a reader is told the approval no longer covers the figures,
   not which figures moved. A field-level diff is a reporting feature rather than
   a governance one, and is unscheduled.
5. **A case locks an appraisal, not a scenario.** §13.1 prints the scenario a
   document's figures are on; a case is created from the stored appraisal row and
   knows nothing of scenarios. Approving one scenario and not another is not
   expressible.

**Not a limitation, recorded because it nearly was one:** the panel carries two
audit hashes, the live record's and the case's locked one, and they are separate
rows on purpose. The first draft of this section printed only the live one and
recorded the resulting gap as a limitation — a re-save that leaves the inputs
byte-identical while moving `calc_version`, `inputs_version`, the appraisal's
status or `outputs_hash` moves the live hash *without* making the case stale, so
a reviewer recomputing `case_hash` from such a document's panel would have got a
mismatch with nothing altered. Printing the locked value closes it, and the panel
now carries all eight components on every document. A reader who finds only one
audit hash on an older exported document should read §13.1's case bullets before
concluding anything from a failed recomputation — as should one whose
recomputation fails on a current document, because §13.1 also records the two
normalisations (the humanised status label, the timestamp's serialised form) the
page does not apply for them.

### Guards this release must watch fail

Per the standing rule that every guard be planted against and watched failing
before it is trusted, and named with the change it would miss (§17's rule).

| Guard | Watched by |
|---|---|
| The `lender_case_stale` ordering diagonal | Written first against the unmodified `draftReason` and watched red: an approved-but-stale case must yield `lender_case_stale`, an unapproved stale case must still yield `not_approved`, and neither may displace conditions 1–4. Mirrored in Python |
| The first FINAL document | The release gate's approved-case document, watched failing (still DRAFT) *before* the provenance wiring landed — which is what proves the wiring, rather than the enum, is what flips it |
| The partial unique index | Two live cases for one project must be refused by the **database**, not only by the endpoint's 409. Asserted at the ORM layer on SQLite, so a schema change that dropped the `sqlite_where` clause would fail rather than pass quietly |
| The transition table mirror | Both languages restate §21.2's table *literally* in a test rather than deriving it from the module under test, so a drive-by edit to either side fails a test that names the whole machine |
| `case_hash` re-derivation | The tests rebuild the hash by hand — `sha256` over the joined tuple — instead of calling the helper's internals, the discipline the audit-hash test already uses; plus a naive/aware datetime pair that must hash identically, which is the whole point of §13.2.1's canonical form |
| Staleness is not one-sided | Stale must flip on a changed-inputs re-save and must **not** flip on an identical re-save. A check that always reported stale would satisfy the first assertion on its own |
| The locked audit hash is really printed | The release-gate fixture's `locked_audit_hash` is deliberately **different** from the stored record's `audit_hash`, and the test asserts that difference before asserting the value appears — with equal values the assertion would pass off the live "Audit hash" row whether or not the case row exists |
| History ordering is deterministic | Two cases created within the same second must come back in creation order, which fails under `created_at` alone and under the case's own random UUID |
| Spec-versions pin | `spec-versions.test.ts` must stay green **untouched**: R14b promised to move no version constant, and a red result there means it accidentally did |
| The corpus is untouched | Every golden-fixture walk passes unmodified. This release contains no arithmetic, and an unmodified corpus is the guard that says so |

## 22. The unit-level sales ledger [R13b — calc 2.14.0]

The other half of audit §7.8, deferred by R13 (§19.10 limitation 1). Until this release the sold portion was one total split by tranche percentages under one scheme-level agent rate and one flat legal fee (§4.4.1); nothing recorded which unit completed when, an exchange as distinct from a completion, or a deposit. §22 adds a per-unit path, mutually exclusive with the tranche path, that writes into the same receipt fields.

### 22.1 The schema

`inputs_version: 12`. `unit_sales` is a two-state top-level field beside `investment_case` and `monitoring`:

```
unit_sales: null | {
  deposit_release: 'held_to_completion' | 'released_on_exchange'
  units: UnitSale[]
}

UnitSale:
  unit_id:         string            -- names a unit_mix.units[].id
  exchange:        SaleEvent | null  -- null = exchange and completion are simultaneous
  completion:      SaleEvent
  deposit_pct:     number            -- 0..100, of the unit's gross (value + ancillary, §15.5)
  agent_fee_pct:   number | null     -- null = scheme selling_agent_fee_pct
  legal_fee_pence: integer | null    -- null = share of scheme selling_legal_fee_pence

SaleEvent:
  month_offset: integer
  anchor:       PhaseAnchor | null   -- §18.6's rule, §18.6's resolver
```

`null` is the migration default and means the document does not use this path. A unit's gross is `estimated_value_pence` plus its ancillary value — the figure `gross_sales` already sums — so `gdv_pence` and `gross_sales_pence` stay equal by construction and the `gdv` lever reaches every row. `ScenarioOverrides` gains `sales_slip_months: integer` (§22.8).

### 22.2 The per-unit derivation

For each row *u* over the sold set (by route and `retained_units`), in `units[]` order:

```
gross_u      = estimated_value_pence + ancillary value
deposit_u    = round_half_up(gross_u × deposit_pct / 100)
agent_u      = round_half_up(gross_u × (agent_fee_pct ?? selling_agent_fee_pct) / 100)
legal_u      = legal_fee_pence                                        if non-null
             = round_half_up(selling_legal_fee_pence × gross_u / Σ gross over null-legal rows);
               the LAST null-legal row in units[] order absorbs the residue
net_u        = gross_u − agent_u − legal_u
completion_m = resolve(completion); exchange_m = resolve(exchange), or completion_m when exchange is null
```

`resolve` is §18.6's single resolver. Totals are the sums of the rows: `selling_costs_pence = Σ (agent_u + legal_u)` (§3.7's per-unit bullet). When every row's `legal_fee_pence` is non-null the scheme flat fee is unused — by this rule, not silently. The resolved months are published on the result block (§22.6); no surface prints an entered offset.

### 22.3 The ledger

No new receipt class. Each row accumulates into the existing `MonthReceipts` fields:

| `deposit_release` | exchange month | completion month |
|---|---|---|
| `held_to_completion` | nothing | `gross += gross_u`; `agent += agent_u`; `legal += legal_u` |
| `released_on_exchange` | `gross += deposit_u` | `gross += gross_u − deposit_u`; costs as above |

Σ gross over months = G exactly on both settings, so §3.1, §4.4's sweep arms, the declining redemption schedule (a released-deposit month is a disposal month in it), §5.10 and §7 are unchanged. A released deposit sweeps under §4.4 like any receipt. Selling costs book in the completion month (§3.7). §19.5's within-month order is unchanged: VAT reclaim → NOI → sales sweep → refinance. `redemption_balance_at_disposal_pence` remains the balance before receipts in the final disposal month — the last completion.

### 22.4 Pre-sales coverage

```
reference_month = earliest start among programme phases with code 'practical_completion',
                  when programme is a network with at least one    (basis 'practical_completion')
                = min over rows of completion_m                    (basis 'first_completion')
exchanged_value_at_ref = Σ gross_u over rows with exchange_m <= reference_month
pre_sold_pct = pct(exchanged_value_at_ref, G)
```

plus a per-month cumulative series of exchanged value, completed value and released deposits received. Earliest PC is the conservative choice. It is a figure, not a covenant test; no flag.

### 22.5 The break-even seam

§5.11's replay gains the receipt-lines arm and the tranche arm is handed resolved months; §5.12 uses the effective blended rate and summed legal. All three are stated in those sections.

### 22.6 Outputs and reporting

`Schedule` gains `unit_sales`, republished (never recomputed) onto `AppraisalResultV2`; `null` exactly when the input is null:

```
UnitSalesResult:
  deposit_release
  units:  Array<{ unit_id, gross_pence, exchange_month: integer | null, completion_month,
                  deposit_pence, deposit_released_pence, agent_fee_pence, legal_fee_pence, net_pence }>
  months: Array<{ month, exchanged_value_pence, completed_value_pence, deposits_received_pence }>   -- first two cumulative
  totals: { gross_pence, deposits_pence, deposits_released_pence, agent_fees_pence, legal_fees_pence, net_pence }
  pre_sold: { reference_month, basis, exchanged_value_pence, pct }
```

`resolved_exit_months.tranches` is `[]` on this path. Surfaces: the Exit page's per-unit editor (exclusive with phasing in the same payload; rows reconciled to the sold set), the cashflow page's released-deposits column and disposal-month note, the memo's exit paragraph arm and "Unit Sales Ledger" section with the §13.4 sentence. The section is omitted entirely when null (§13.5).

### 22.7 Validation

Input errors, not flags; applying only when `unit_sales` is non-null unless stated:

1. `unit_sales` and `sales_phasing` both non-null — an error on **both** fields. *Applies regardless.*
2. `route = 'retain_all'` with a non-null block — nothing is sold.
3. Every sold unit has exactly one row and every row names a sold unit: a missing sold unit, a row for a retained unit, a row for an absent unit, and a duplicate `unit_id` are four distinct messages.
4. Each event: `month_offset` a whole month in `[0, term − 1]`; an anchor names an existing phase and requires a network `programme`; the **resolved** month lies in `[0, term − 1]`.
5. Resolved `exchange_m <= completion_m` where `exchange` is non-null.
6. `deposit_pct` finite in `[0, 100]`, and `0` when `exchange` is null.
7. `agent_fee_pct` null or finite in `[0, 100)`; `legal_fee_pence` null or an integer `>= 0`.
8. `deposit_release` in the enum.
9. Sold gross `> 0`.

`scenarios.*.sales_slip_months` must be a whole number. No new flags.

### 22.8 Sensitivity: the `sales_slip` lever

§12.1's ninth lever adds signed months to every row's completion — `anchor.offset_months` when anchored, else `month_offset` — **completion only**, additively, through `applyScenario`. A slip that drives a completion before its exchange, or outside the term, makes the position an invalid cell (§12.7), never a clamp. On `unit_sales = null` it is a zero-width bar. The lever is offered only when the document carries a ledger, as `phase_slip` is only offered with a network.

### 22.9 Migration and the persistence boundary

```
v11 unit_sales: (absent)                         →  v12 null
v11 scenarios.<each>.sales_slip_months: (absent) →  v12 0
```

Both inert by construction. The numeric identity gate runs the same code over each v11 document and its migrated twin, corpus-wide in both engines, and requires equality; the validation gate is §19.9's three separately falsifiable properties (property 3's control: both blocks non-null trips rule 1). The separate claim — calc 2.14.0 reproduces 2.13.0 on every `unit_sales = null` document — carries one named exception, fixture S's `senior_breakeven_pence` (§5.11's correction), evidenced by every pre-existing golden pin standing while S gains a pin whose pre-fix value is recorded beside it.

### 22.10 Stated limitations

1. Uniform price fall in the break-even; no per-unit price stress.
2. A unit's price is its `unit_mix` value — no incentives, discounts, part-exchange or bulk pricing.
3. One deposit per unit, at exchange; no staged deposits, deposit interest or stakeholder-release conditions; the release switch is scheme-level.
4. Coverage is a figure, not a test.
5. The coverage reference month is the earliest PC; a phased block release is measured at its first PC.
6. Exchange dates are stressed by no lever.
7. Rows carry no **per-row** evidence status; the scheme-level evidence is §23.2's `exit_route_evidence` item [R15 — calc 2.15.0]. Reservation and exchange evidence is recorded once for the exit as a whole — with its source, reference and date, and `unknown` until someone records it — not against an individual `unit_sales` row. Restated as §23.11 limitation 8.
8. The two sales paths remain two; there is no conversion between them.
9. No appraisal workbook exists (spec §11.9); the ledger is printed in the memo and on the pages only.
10. The phased break-even's fee reservation is paid once per sweep event — one per distinct receipt month, so lines completing in the same month reserve it once — and a deposit-heavy document has more sweep months than its held twin, so its break-even is overstated relative to it; the timing benefit of a released deposit is visible only with the exit fee removed.

### Guards this release must watch fail

| Guard | Watched by |
|---|---|
| Deposit liveness | released vs held twin: the exchange month's receipt, absolute finance costs and the redemption months differ; `gdv_pence`, `gross_sales_pence`, `selling_costs_pence` identical |
| Sum-of-units costs, residue absorption | the hand table (201,550 / 135,659 / 162,791; 33/33/34) |
| Exclusion, coverage both ways, resolved window, exchange <= completion | §22.7's rule tests, each with an accepting twin |
| Pre-sold basis switch | the same rows with and without a PC milestone: 12/`practical_completion`/81.48 vs 12/`first_completion`/81.48 vs 9/`practical_completion`/27.51 |
| Receipt-lines arm | two-line hand figures at half price; released < held; two equal lines reproduce the two-tranche minimum |
| §5.11 correction | S off 90,971,520 to 88,720,089; the strip_out/building_control unsolvable pair — both failed on the pre-fix code |
| Tranche-arm identity | G, I, J, L pins unchanged |
| Lever | nine levers order-independent on a ledger document; zero-width bar on null; −5 and +4 invalid cells |
| Memo | present with the pinned rows, absent when null; figures follow a tampered result block |
| Entry points | both guards require v12 |

---

## 23. The due-diligence evidence schedule [R15 — calc 2.15.0]

Audit §7.10 asked for evidence-led categories covering Planning, Title/Occupation, Existing Building, Construction, Finance and Exit, every issue carrying red/amber/green/**unknown**, evidence, owner, due date, cost and programme impact and an action, with the rule that *unknown must never default to green*; §7.1 asked for the structured planning, title, occupation and technical facts with an evidence source and date, and for competent confirmation of higher-risk-building status; §7.5's leftovers asked for QS source/date/status, fixed-price coverage, provisional sums and package exclusions. Until this release the appraisal recorded none of it. `risks[]` was a free-text project log with no category, no evidence, no owner, no date and no way to say unknown, and the memo text-matched its descriptions against nine hard-coded phrases, so a row reading "planning is fine" satisfied the planning check.

§23 adds a fixed catalogue of evidenced items with `unknown` as every item's seed, five read-only rows derived from the evidence the model already carried, QS provenance and a per-package price basis on the cost plan, two source-conflict rules over a captured listing record, four flags and a seventh FINAL condition. `risks[]` is kept, untouched, as the project log the audit called it.

**No arithmetic changes.** Every money figure on every existing document is identical under calc 2.15.0. The v12 → v13 identity gate compares the whole result — metrics, ledger and schedule, the new `due_diligence` block included — on both arms **with no exclusion** (§23.10).

### 23.1 The schema

`inputs_version: 13`. `due_diligence` is a **non-nullable** top-level block, unlike `unit_sales` (§22.1) or `monitoring` (§20.1): there is no document for which "no due diligence" is a meaningful state. An unexamined document is one whose every item is `unknown`, and the migration writes that explicitly rather than by absence.

```
due_diligence: {
  source_record: SourceRecord | null       -- null = never captured
  items:         DdItem[]                  -- every ENTERED catalogue code once, plus custom items
}

DdItem:
  id:                      string          -- 'dd-<code>' for a catalogue item (migration-deterministic)
  code:                    DdItemCode      -- one of §23.2's 23 entered codes, or 'custom'
  category:                DdCategory      -- planning | title_occupation | existing_building |
                                           --   construction | finance | exit
  label:                   string          -- '' for a catalogue item (the catalogue supplies it);
                                           --   required for 'custom'
  status:                  'red' | 'amber' | 'green' | 'unknown' | 'not_applicable'
  evidence:                DdEvidence | null
  expiry_date:             string | null   -- ISO yyyy-mm-dd; the consent's lapse, a lease's end
  owner:                   string
  due_date:                string | null   -- ISO yyyy-mm-dd
  cost_impact_pence:       integer | null  -- null = not assessed (§1.5)
  programme_impact_months: integer | null  -- null = not assessed (§1.5)
  action:                  string
  notes:                   string

DdEvidence:
  source:    string        -- who produced it: firm, LPA, Land Registry, valuer
  reference: string        -- the document: planning reference, title number, report reference
  date:      string        -- ISO; the document's date, never today's

SourceRecord:                              -- the listing's STRUCTURED fields, copied
  captured_at:           string            -- ISO datetime; an INPUT (when the copy was taken),
                                           --   never computed
  source_name:           string | null
  source_url:            string | null
  is_vacant:             boolean | null
  tenure:                'freehold' | 'leasehold' | 'unknown' | null
  lease_years_remaining: integer | null
  floor_area_sqm:        number | null
  use_class:             string | null
  epc_rating:            string | null
```

- `SourceRecord`'s eight copied fields are exactly the structured `Project` fields the scrapers populate — `source_name`, `source_url`, `is_vacant`, `tenure`, `lease_years_remaining`, `floor_area_sqm`, `use_class`, `epc_rating` — plus `captured_at`, which is an input recording when the copy was taken. `description` and `current_use_description` are **not** copied: prose is not a fact the engine can compare (§23.5). The Due Diligence page shows them beside the Title/Occupation category as read-only context, which is where a contradiction becomes visible to the appraiser evidencing `vacant_possession`.
- Bounds: `cost_impact_pence`, `programme_impact_months`, `lease_years_remaining` and `floor_area_sqm` are `>= 0` at the model boundary; `category`, `status` and `tenure` are enums there. `code` is deliberately **not** an enum at the model boundary — a stray code must surface as §23.9 rule 1's worded validation error in both engines, not as a 422 in one of them.

The cost plan gains (§23.6):

```
cost_plan.qs: null | {
  source:    string    -- the firm or person who priced it
  stage:     'order_of_cost' | 'riba_2' | 'riba_3' | 'riba_4' | 'tender' | 'contract_sum'
  date:      string    -- ISO; the cost plan's issue date
  status:    'draft' | 'issued' | 'reviewed'
  base_date: string    -- ISO; the pricing base date (R15b's inflation origin)
}

CostPackage.price_basis: 'fixed_price' | 'provisional_sum' | 'estimate' | null   -- null = not classified
```

`qs` is detailed-mode only and is hard-rejected in headline mode exactly as `vat_override` is (§17.1): a rate × area estimate has no QS. `price_basis` is carried on every package and read only in detailed mode.

### 23.2 The catalogue

Twenty-eight codes in six categories, **in this order**. The catalogue — code, category, label — is a literal in both engines (`due-diligence.ts` / `due_diligence.py`) and is pinned byte-identical by mirrored tests exactly as `ALLOWED_TRANSITIONS` is (§21.2). The editor's per-item prompt text is UI-only and is not part of that identity.

| Category | Code | What `green` means |
|---|---|---|
| `planning` | `planning_route` | The consent or prior approval the scheme relies on is granted; `evidence.reference` is its reference, `evidence.date` its decision date, `expiry_date` its lapse |
| | `planning_conditions` | Pre-commencement conditions identified and their discharge programmed |
| | `article_4_direction` | The Article 4 position is confirmed with the LPA |
| | `conservation_listed` | Conservation-area and listed status confirmed |
| | `cil_s106` | CIL/S106 liability confirmed and carried in the cost plan's `cil_s106` fee line |
| `title_occupation` | `title_report` | Report on title: tenure, rights, restrictive covenants, easements |
| | `vacant_possession` | Vacant possession obtainable on the modelled date; `red` = not obtainable, `amber` = subject to surrender or notice |
| | `leases_tenancies` | Every occupational lease and tenancy scheduled, with its surrender or expiry terms |
| | `rights_of_light` | Rights-of-light position surveyed, or confirmed not to arise |
| | `party_wall` | Party-wall matters identified and awards programmed, or confirmed not to arise |
| `existing_building` | `structural_survey` | Structural survey of the existing frame and envelope |
| | `asbestos_survey` | Refurbishment-and-demolition asbestos survey |
| | `measured_survey` | Measured survey underlying `areas` — the evidence §15.9 said the bridge did not carry |
| | `higher_risk_building` | Competent confirmation of higher-risk-building status against the statutory criteria (audit §7.1) |
| | `fire_strategy` | Fire strategy for the converted building |
| | `acoustic_thermal` | Acoustic and Part L / EPC route confirmed for the conversion |
| | `services_mande` | M&E, drainage and utilities capacity confirmed |
| `construction` | `cost_plan_qs` | **Derived** (§23.3) — never entered; listed here so the category is complete |
| | `procurement_contractor` | Procurement route and contractor identified; contract form and price basis agreed |
| | `warranties_building_control` | Building control body and warranty provider appointed |
| | `insurance` | Contract works and PI cover evidenced |
| `finance` | `facility_terms` | **Derived** (§23.3) |
| | `equity_sources` | **Derived** (§23.3) |
| | `sponsor_entity` | Developer / SPV, KYC and track record evidenced |
| | `tax_basis` | **Derived** (§23.3) — jurisdiction and VAT together |
| `exit` | `sales_evidence` | Comparable evidence or an agent's letter supporting the unit values |
| | `lender_valuation` | **Derived** (§23.3) |
| | `exit_route_evidence` | Evidence for the modelled exit: pre-sales, a take-out term sheet, absorption evidence |

- **Entered items: 23. Derived rows: 5.** `items[]` carries the 23 entered codes, each exactly once, plus any `custom` items. The five derived codes are **never** in `items[]` — they exist only on the result block, so no document can carry a stored status for a fact another field owns.
- The catalogue is **route-agnostic**. A `sell_all` scheme marks nothing `not_applicable` under `exit` — `exit_route_evidence` is its pre-sales evidence; a `retain_all` scheme's is its take-out evidence. Applicability is a fact the appraiser evidences (`not_applicable` with a reason), never one the engine infers from the route.
- The catalogue is fixed by release. A user-added row is a `custom` item with its own `label` and an entered `category`; `custom` is the one code that may repeat (§23.9 rule 1).

### 23.3 Derived rows

Five read-only rows on the result block, each computed from a field that already carries evidence, each naming the field it read in its `source`. The mapping is normative:

| Row | Reads | `green` | `amber` | `red` | `unknown` | `source` | Evidence printed |
|---|---|---|---|---|---|---|---|
| `cost_plan_qs` | `cost_plan.mode`, `cost_plan.qs` | detailed, `qs` present, status `issued` or `reviewed` | detailed, `qs` present, status `draft` | — | headline mode, or detailed with `qs` null | `cost_plan.qs` | `qs.source`; reference `"<stage> / <status>"`; `qs.date` |
| `facility_terms` | `finance.requires_confirmation` | `false` | — | — | `true` (a migrated, unconfirmed facility) | `finance.requires_confirmation` | none |
| `equity_sources` | `equity_sources[].evidence_status` | every source `confirmed` | — | any `rejected` | any `unconfirmed` and none `rejected` | `equity_sources[].evidence_status` | the count by status, `"confirmed: n, unconfirmed: n, rejected: n"` |
| `tax_basis` | §14.6 + §17.10 | jurisdiction `confirmed` **and** `acquisition_tax.date_basis == 'transaction_date'` **and** §17.10's VAT gate passes | — | — | otherwise | `acquisition.jurisdiction_evidence_status + vat` | `jurisdiction_source`; the applied jurisdiction; the band set's effective-from date |
| `lender_valuation` | `lender_valuation` | present | — | — | `null` | `lender_valuation` | `author`, `reason`, `date` |

- `tax_basis` reads **§17.10's own predicate** for the VAT half (material unconfirmed VAT), not a new one — the dashboard must never disagree with the banner. When it shows `unknown`, §13.3's condition 3 or 4 has already fired; the row is the same fact in the same colour. A pre-v5 document, which records no jurisdiction evidence status at all, reads `unknown`.
- **Derived rows do not feed the seventh FINAL condition** (§23.7). `tax_basis` is gated by §13.3 conditions 3 and 4 as before; `facility_terms`, `equity_sources` and `lender_valuation` gate nothing today and continue not to (§23.11 limitation 3). The memo prints their `unknown` beside the entered items in the same table, and states the derived unknown count separately, so the reader sees it rather than inferring it.

### 23.4 The derivation

A pure module — `due-diligence.ts` / `due_diligence.py` — shaped like `monitoring`: it takes the inputs, the cost-plan result, the VAT result, the acquisition-tax result and the schedule (for the construction start month), and returns §23.8's result block. It is computed **once, in `derive_metrics` / `deriveMetrics`**, exactly where `monitoring_statement` is, and published on `AppraisalResultV2` — not on `Schedule`, because nothing in the ledger reads it. No ledger balance enters it, and nothing downstream reads it except the provenance layer (§23.7) and the flags (§23.9).

**A pre-v13 document is computed through the same engine** (§16's `cost_plan_from_legacy_costs` rule): a document with no `due_diligence` block is read as §23.10's **migration seed** — the 23 entered catalogue items `unknown`, no source record — not as an empty schedule, which would read as "there is nothing to evidence". That is why the v12 → v13 identity gate can compare the result block on both arms with no exclusion.

Rows are built in **catalogue order** — a derived row wherever the catalogue marks one, otherwise the matching `items[]` entry — followed by the `custom` items in `items[]` order. A catalogue code absent from `items[]` produces **no row**: §23.9 rule 1 reports it, and the dashboard does not invent a row for an item the document does not carry.

```
rows        = entered catalogue rows ∪ custom rows ∪ the 5 derived rows
entered     = rows whose kind is not 'derived'
assessed    = rows (derived included) whose status is 'red' or 'amber'

per category c, and again over every row:  red, amber, green, unknown, not_applicable, total
```

The totals block carries sixteen fields. The first six are the status counts and their total over **every** row; the rest are projections of the same three partitions, each computed once here rather than by any surface:

| Field | Definition |
|---|---|
| `red`, `amber`, `green`, `unknown`, `not_applicable`, `total` | counts over `rows` |
| `entered_unknown_count` | `unknown` over `entered` — **the gate reads this** |
| `addressed_pct` | `pct(|entered| − entered_unknown_count, |entered|)`, the shared `pct()` (§1.2) |
| `cost_impact_total_pence` | Σ `cost_impact_pence` over `assessed` rows with a non-null impact |
| `programme_impact_max_months` | max `programme_impact_months` over `assessed` rows with a non-null impact, else `null` |
| `unassessed_impact_count` | `assessed` rows with **either** impact null |
| `entered_total` | `|entered|` — the denominator of §23.9's flag message and of §13.4's limitation |
| `assessed_count` | `|assessed|` |
| `stated_impact_count` | `assessed` rows with a non-null `cost_impact_pence` — exactly the set `cost_impact_total_pence` sums |
| `derived_unknown_count` | `unknown` over derived rows |
| `entered_addressed_count` | `entered` rows whose status is not `unknown` |

- **Programme impact is a max, not a sum.** Two three-month delays on the critical path may be sequential or concurrent; the schedule does not know, so it reports the largest single stated impact and every surface prints "at least".
- **Cost impact is a sum**, over the assessed items whose owner has stated one. `stated_impact_count` and `unassessed_impact_count` are printed beside it so a total over four items is never read as a total over twenty-nine.
- **Only an assessed row carries an impact into the totals.** A `green` row with a stale figure on it contributes nothing.
- `not_applicable` is its own column and is neither red, amber nor unknown — but it **is** addressed for `addressed_pct`, for `entered_addressed_count` and for the gate: someone evidenced that it does not arise.
- Every count the report prints is a field here. A report generator that re-partitions `rows` to count something is a second implementation of a count (§11.9), and the two engines' reports would then be free to disagree about the same document.

### 23.5 The source record and the source-conflict rules

`source_record` is the listing's structured fields, copied into the document and stamped with the moment the copy was taken. It is written by the client's default builder `defaultCalculatorInputsV13(project)` and by the Due Diligence page's **Re-capture from listing** action, both through one helper (`captureSourceRecord`) that copies §23.1's eight fields and stamps `captured_at` client-side. The default builder captures only where the project it is given actually carries a listing — a bare `{ id, price_pence, floor_area_sqm }` project is a new calculator, not a listing, and gets `null`. The migration also writes `null`: a stored document has no project record in hand, and inventing one would be inventing evidence.

Reading the project record at run time is prohibited. The engine is a pure function of the inputs document, and a locked lender case (§21.1) must be recomputable from its own snapshot.

Two conflict rules, evaluated **only when `source_record` is non-null**, each raising the flag `source_conflict` (red) carrying its own statement:

1. **Occupation** — `source_record.is_vacant` is `false` **and** the `vacant_possession` item's status is `green`:
   `source conflict: the listing records the property as occupied; vacant possession is marked green - evidence the surrender or correct the status`
2. **Existing area** — `source_record.floor_area_sqm` is non-null and `> 0`, `areas.existing_gia_sqm > 0`, and `|existing_gia_sqm − floor_area_sqm| × 4 > floor_area_sqm`:
   `source conflict: the listing floor area and the entered existing GIA differ by more than 25%`

Rule 2's test is the **strict, integer-safe** form of "more than 25%": multiplied out rather than divided, so the comparison never rests on a float quotient's last bit, and a disagreement of exactly 25% does **not** fire. The 25% threshold is the one §15.6 retired from the unit-NIA check, reused so the product keeps one materiality figure for area disagreement.

**What this does and does not catch.** Rule 1 fires only where the scraper structured the occupation fact. Where the contradiction lives in the listing's prose it is invisible to both rules, and this specification says so rather than pretending a keyword match is evidence (§23.11 limitation 1). What catches that case is §23.7: `vacant_possession` is seeded `unknown`, the document is DRAFT under *DUE DILIGENCE INCOMPLETE* until someone evidences it, and the page shows the listing's description beside the item being evidenced. The contradiction stops being silent the moment the model refuses to assume vacancy.

A `null` `source_record` is disclosed, not hidden: the memo prints *"No listing record captured; source-conflict checks did not run."*

### 23.6 QS provenance and the price basis

Detailed mode only. The cost-plan result gains two fields, both `null` in headline mode:

```
price_basis: null | {
  fixed_price_pence, provisional_sums_pence, estimate_pence, unclassified_pence
      -- Σ amount_pence by each package's price_basis; unclassified = the null-basis packages
  fixed_price_coverage_pct = pct(fixed_price_pence, base_build_pence)
  provisional_sums_pct     = pct(provisional_sums_pence, base_build_pence)
}
qs: the input block republished, or null
```

- **Coverage is a share of base build** — the same base §16.3's `general` contingency class takes — so the two percentages a QS reviewer reads sit on the figure the contingency sits on. Both go through the shared `pct()`.
- **Unclassified packages count against coverage.** A migrated detailed plan has every package at `price_basis: null`, so its coverage is 0% and its `unclassified_pence` is the whole base build: the honest statement of what was recorded, and the figure that moves as packages are classified.
- **No threshold on provisional sums.** `provisional_sums_present` (amber) fires on any non-zero total and carries the figure; the audit names no materiality and this release invents none.
- **Package exclusions need no new field.** A provisional or estimated package's `notes` is its exclusions, and the memo prints it under the QS line.
- Fee lines carry no provenance (§23.11 limitation 9). A fee line is an appointment, not priced works, and its fixed/percentage `basis` is already recorded (§16.4).
- **[R15b — calc 2.16.0]** `qs` gains one nested field, `inflation: { annual_pct } | null` — the tender-price inflation allowance §24.3 applies from `qs.base_date` to each package's own spend midpoint. It is republished normalised (`qs.inflation ?? null`), so a raw pre-v14 document and its migrated v14 twin publish the identical shape (§24.8). See §24.1 for the schema and §24.3 for the arithmetic.

### 23.7 The draft gate

`DraftReason` gains `'due_diligence_incomplete'`, ordered immediately after `'vat_basis_unconfirmed'` and before `'not_approved'`. §13.3's list becomes seven conditions, its former conditions 5 and 6 renumbered 6 and 7. Banner:

```
DRAFT - DUE DILIGENCE INCOMPLETE - NOT FOR LENDER RELIANCE
```

**Predicate:** `metrics.due_diligence.totals.entered_unknown_count == 0`. `buildProvenance` takes it as a fourth gate input beside the tax and VAT bases and the staleness flag, computed by `dueDiligenceGateFor(run)`. `provenance.py`'s `draft_reason` mirrors the **ordering** and takes `due_diligence_complete` as a keyword argument — it does not mirror the predicate: `dueDiligenceGateFor` and the no-key exemption live in `report-provenance.ts` alone, and there is no Python helper (provenance.py is test-only, and its callers pass the boolean). `DRAFT_REASON_SENTENCE` and `WATERMARK_TEXT` are `Record<DraftReason, string>`, so the compiler requires both texts (§17.10's precedent).

**A document with no `due_diligence` key at all is not re-graded.** This is `taxBasisConfirmedFor`'s R8 rule, kept for R8's reason: a raw pre-v13 document handed straight to the engine offered its author no field to fill, so its silence cannot be graded. Every production entry point migrates to v13 before running, so **every stored document is graded**; the exemption reaches only a raw document constructed in a test or held outside the persistence boundary, and the pre-existing release-gate FINAL routes stay FINAL on exactly that basis. The engine still seeds and reports the 23 unknowns for such a document (§23.4), and `due_diligence_unknown` still fires; only the FINAL condition exempts it.

**Why this position in the order.** An `unknown` does not make a figure wrong, so it must not outrank the two basis reasons that say figures may be. It must outrank `not_approved`, because an approval read over an unevidenced title, lease or consent is the stale case's cousin (§21.3): the reader would draw exactly the wrong conclusion from the approval alone.

**The consequence for every existing document is accepted, not worked around** (§14.6's precedent). A migrated document carries 23 `unknown` items and shows this banner as soon as its tax and VAT bases are confirmed, until every entered item is evidenced or marked not applicable with a reason. The release-gate FINAL fixture therefore carries a fully addressed schedule — the first FINAL document with an evidenced due-diligence position.

### 23.8 Outputs and reporting

`AppraisalResultV2` gains `due_diligence`, computed once in `derive_metrics` / `deriveMetrics` exactly as `monitoring_statement` is. It is **never null** (§23.4's pre-v13 seed).

```
DueDiligenceResult:
  rows: Array<{ id, code, category, label,
                kind: 'entered' | 'custom' | 'derived',
                status, evidence: DdEvidence | null, expiry_date, owner, due_date,
                cost_impact_pence, programme_impact_months, action, notes,
                source: string | null }>          -- derived rows: the field read; null otherwise
  categories: Array<{ category, red, amber, green, unknown, not_applicable, total }>   -- six, in order
  totals: { red, amber, green, unknown, not_applicable, total,
            entered_unknown_count, addressed_pct,
            cost_impact_total_pence, programme_impact_max_months, unassessed_impact_count,
            entered_total, assessed_count, stated_impact_count,
            derived_unknown_count, entered_addressed_count }                           -- §23.4
  source_record: SourceRecord | null              -- republished
  source_conflicts: Array<{ rule: 'occupation' | 'existing_area', statement: string }>
  consent_expiry: { expiry_month, construction_start_month, expires_before_start } | null
                                                  -- null unless the planning_route item carries an
                                                  --   expiry_date AND acquisition_date is set
```

**Surfaces.**

- **Page 13 is *Due Diligence*.** The schedule editor sits above the existing risk register: six category groups, each row carrying the status select (seeded `unknown`, coloured, `not_applicable` grey), evidence source / reference / date, expiry date, owner, due date, cost impact, programme impact, action and notes; an **Add custom item** control per category; derived rows rendered read-only and labelled with the field they are derived from; the category counts and the addressed count and percentage read from the run, never recomputed on the page; the source-record card with **Re-capture from listing**; and, under Title/Occupation, the project's `description` and `current_use_description` as read-only context. Validation messages surface per row through the existing field-keyed issue map.
- **Page 4 (Costs)**, detailed mode: a QS provenance card (source, stage, date, status, base date) and a `price_basis` select on every package row, with the coverage and provisional-sum figures read from the run.
- **The reconciliation strip** carries the new banner text and the four flags.
- **The deal spider.** `buildingSafetyBand` is unchanged, but the building-safety axis is marked **provisional** with the note `screening only - higher-risk-building status not competently confirmed` unless the `higher_risk_building` item is `green` or `not_applicable` — audit §7.1's "retain the prompt, require confirmation".
- **Memo §9 is *Due Diligence and Risk*:** the category summary table (six rows × five counts and a total), the schedule table (category, item, status, evidence source · reference · date, expiry, owner, due, cost impact, programme months, action) with each derived row marked *(derived)*, the impacts sentence — stated cost impact across `stated_impact_count` items, "at least" `programme_impact_max_months` months, `unassessed_impact_count` not yet assessed — each `source_conflict` printed as an *Information Required* line in the engine's own words, then the source-record line or the not-captured sentence, and finally the risk register under **Risk register (project log)**. The nine-phrase text-match and its "Risks not yet addressed" line are **deleted**.
- **Memo §3** gains two sentences read from the schedule: the planning position (status, reference, decision date, lapse date, or "no consent evidenced") and the vacant-possession status. Each prints its status word whatever it is, so an unexamined document says "unknown" where an evidenced one says "green".
- **Memo §5's construction sub-section** is headed *Detailed Cost Plan* when `cost_plan.qs` is recorded and *Detailed Cost Plan — QS Evidence Not Recorded* when it is not, and prints the QS line, the coverage, the provisional sums, the unclassified total and the cost base date (§13.4).
- **Appendix B** replaces the risk-register gap line with the document's own unknown items, named by their catalogue labels up to six and counted beyond that, pointing back to §9.
- Every due-diligence and QS calendar date prints through the memo's plain-date formatter — a calendar date, never a zone-shifted one (§1.4).
- **No workbook** (§22.10 limitation 9 stands).

### 23.9 Validation and flags

Input errors, keyed `due_diligence.items[i].<field>`, `due_diligence.source_record.<field>` and `cost_plan.<field>` — and `due_diligence` itself for the missing-code message, which belongs to no single row. They apply structurally: a pre-v13 document has no `due_diligence` attribute, no `cost_plan.qs` and no `price_basis`, so it raises nothing.

1. **The catalogue is complete and unambiguous.** Every entered catalogue code appears **exactly once**. Four distinct messages: a missing code, a derived code found in `items[]`, a code that is not in the catalogue, and a duplicate. A `custom` item requires a non-empty `label`. Every item's `category` is in the enum. Ids are unique. **`custom` is the one repeatable code** — it names no catalogue entry, so a document carrying two user-added items is normal and must not read as a duplicate.
2. `status = green` requires `evidence` non-null with a non-empty `source` **and** a non-empty `date`.
3. `status = red` or `amber` requires a non-empty `action`.
4. `status = not_applicable` requires a non-empty `notes` — the reason it does not arise.
5. Every date present — `evidence.date`, `expiry_date`, `due_date`, `qs.date`, `qs.base_date` — is ISO `yyyy-mm-dd` and a real calendar date, the same rule `acquisition_date` is held to (§14), reused rather than restated. A field left absent or empty is not a date error; rule 2 owns the missing-evidence case.
6. `cost_impact_pence` is null or an integer `>= 0`; `programme_impact_months` is null or an integer `>= 0`.
7. `source_record`, when present: `captured_at` non-empty; `floor_area_sqm` null or `>= 0`; `lease_years_remaining` null or an integer `>= 0`; `tenure` in the enum or null.
8. `cost_plan.qs` non-null in headline mode is an error (§17.1's shape). When present: `source` non-empty, `stage` and `status` in their enums, and **both `date` and `base_date` non-empty after trim** as well as real (rule 5). The two dates are the one place rule 5's "absent is not an error" reading is overridden: a QS record whose provenance cannot be dated is worse than no record, and the derived `cost_plan_qs` row prints that date as its evidence.
9. `price_basis` is in the enum or null.

Several of these guard a field the Python model already constrains — rule 1's `category`, the status enum, rule 6's two impacts, and the numeric and enum arms of rules 7–9 — so in that engine those branches are unreachable and a stray value is a 422 at parse time. They are **kept, not deleted as dead code**: the TypeScript validator can reach every one of them (a JSON payload arrives uncoerced), and a rule present in one engine and absent from the other is exactly the silent asymmetry the dual-engine mirror exists to prevent.

**Flags** (result-derived; none is an error):

| Code | Severity | Fires when | Message carries |
|---|---|---|---|
| `due_diligence_unknown` | amber | `entered_unknown_count > 0` | `"N of M entered items unknown"` — `M` is `entered_total`, the same field §13.4's limitation reads |
| `source_conflict` | red | either §23.5 rule; **one flag per rule** | the rule's own statement, verbatim |
| `consent_expires_before_start` | red | `consent_expiry.expires_before_start` | the lapse month and the construction start month; the flag's `month` is the lapse month |
| `provisional_sums_present` | amber | detailed mode and `price_basis.provisional_sums_pence > 0` | the amount, on the flag's `amount_pence` |

**`months_between(a, b)`** is whole months, floored:

```
(y_b − y_a) × 12 + (m_b − m_a) − (1 if d_b < d_a else 0)
```

A negative result is a lapse before acquisition and always fires. The two helpers are mirrored and pinned on a leap-day pair: `2024-01-31 → 2024-02-29` is **0** months (29 < 31, so the part-month is dropped) and `2024-01-29 → 2024-02-29` is **1**.

**`construction_start_month`** has three arms, in this order: the resolved start of the phase named by `programme.category_phase_ids.construction` when `programme` is a network (§18.2); otherwise `programme.packages.construction.start_offset` when a curve programme is present (§6.1); otherwise `0`, because §6's default profile starts the construction spend at month 0. The middle arm is reachable **only from a raw pre-v9 document**: `migrate_v8_to_v9` turns a package programme into a network, so no migrated document takes it.

**The schedule is §12.2-invariant; two of its flags are not.** No lever writes to `due_diligence`, so every sensitivity cell carries the identical schedule and the identical derived rows as the base cell, and with them the identical `due_diligence_unknown` and `source_conflict` flags — both read the document alone. Two flags **can** move between cells, and neither is a defect: `consent_expires_before_start` compares the lapse month against `construction_start_month`, which the **`phase_slip` lever moves** (any lever that moves the construction start moves this comparison with it), so a consent that clears the base start can lapse before a slipped one; and `provisional_sums_present`'s **amount** moves under the cost lever, which scales the packages it is summed from. There is still no due-diligence *lever*: no lever writes `due_diligence`, and none is planned. **[R16 — calc 2.17.0] The "risks crystallise" stress this note recorded is built, as §25's ninth pack entry** — Σ cost impact run onto construction as a percent of base build, Σ programme impact run onto the network's source phases — reading `inputs.due_diligence.items` directly rather than this section's derived result, so the pack does not depend on §23 having been run first (§25.3). The note is kept as a historical one rather than deleted, this project's rule (§16.9).

### 23.10 Migration and the persistence boundary

```
v12 due_diligence: (absent)             →  v13 { source_record: null,
                                                 items: [the 23 entered catalogue items,
                                                         id 'dd-<code>', status 'unknown',
                                                         evidence null, expiry_date null, owner '',
                                                         due_date null, cost_impact_pence null,
                                                         programme_impact_months null,
                                                         action '', notes ''] }
v12 cost_plan.qs: (absent)              →  v13 null
v12 cost_plan.packages[].price_basis    →  v13 null   (every package)
```

Every addition is inert to every money figure. `is_v13` discriminates on `inputs_version == 13` **and** the presence of the `due_diligence` key; `migrate_v12_to_v13` refuses a document that is already v13; `migrate_inputs_to_v13` is the structural copy of v12's, with the same two refusals (an unrecognised version, and a document declaring 13 that fails the structural check); `parse_calculator_inputs` gains the v13 branch first.

**The migration moves no computed value.** The numeric identity gate runs the same code over a v12 document and its migrated v13 twin, corpus-wide in both engines, and requires equality of every money figure and every pre-existing flag — **with no exclusion for the new block**, because §23.4 reads a pre-v13 document as the seed and therefore computes the identical schedule on both arms. `due_diligence_unknown` is the one flag every migrated document raises, and the gate asserts it **by name** — `"due_diligence_unknown" in {f.code for f in v13_run.metrics.flags}`, per fixture, in both engines — so an emptied or silently narrowed seed fails the gate rather than passing it vacuously. The validation side is §19.9's three properties: every v12 issue has a v13 counterpart; §23.9's rules raise nothing on a migrated document; and a control document (one catalogue code removed) trips a v13-only rule.

**What moves for a stored document** is its `input_hash` on the next save — every inputs bump does this (§13.2's disclosure) — and therefore any approved lender case goes **stale** on that save (§21.3). That is the correct answer, not a defect: the snapshot the case locked carried no evidence position, and the re-saved one carries 23 unknowns. `migration-notes.md` §16 records it so nobody reads a stale case after this release as a fault.

### 23.11 Stated limitations

Recorded so they are not read as oversights.

1. **Prose is not compared.** The source-conflict rules read the listing's structured fields only. A contradiction that lives in `description` is caught by the `unknown` gate and by the appraiser, never by the engine.
2. **Two conflict rules.** Occupation and existing area. Tenure, lease term, use class and EPC rating are captured and printed but compared to nothing, because the appraisal carries no typed counterpart to compare them with.
3. **Derived rows do not gate.** `facility_terms`, `equity_sources` and `lender_valuation` can show `unknown` without making the document DRAFT; each keeps the semantics its own release gave it (§10, R1, R2). `derived_unknown_count` is published and printed so the position is disclosed rather than implied.
4. **No due-date or overdue logic.** `due_date` is recorded and printed; nothing compares it to a date, because the engine has no clock (§1.4).
5. **Impacts are stated, not modelled.** `cost_impact_pence` and `programme_impact_months` enter no ledger and no lever. The memo says so in the same breath as it prints them.
6. **No inflation — deferred to R15b.** *The cost plan in time*: a per-package programme (§16.9 limitation 1), tender-price inflation from `qs.base_date` to each package's spend midpoint, and per-package draw eligibility (§16.9 limitation 2, §20.5 limitation 3). R15 records `qs.base_date` so R15b has its origin.

   **[R15b — calc 2.16.0] Resolved; kept as a historical note.** §24 delivers all three: package timing from the resolved phase (§24.2), the inflation allowance itself (§24.3), and the per-month lender-eligible share (§24.4). What survives is §24.9's own, narrower list — a flat single rate with no dated index, and packages only.
7. **No per-package QS provenance.** One `qs` block covers the whole detailed plan; a plan priced by two firms records one.
8. **Per-row sales evidence remains unmodelled.** §22.10 limitation 7 narrows to this: reservation and exchange evidence is scheme-level (`exit_route_evidence`), not per `unit_sales` row.
9. **Fee lines carry no provenance.** A fee line is an appointment, and its evidence is the appointment letter — the `procurement_contractor` or `sponsor_entity` item, not QS evidence.
10. **The catalogue is fixed by release.** Adding a code is a schema change with a migration seeding it `unknown`. There is no user-defined catalogue, only `custom` rows.
11. **The seventh FINAL condition exempts a raw pre-v13 document** (§23.7). Every production entry point migrates before running, so every *stored* document is graded; a document constructed outside the persistence boundary is not. The exemption is R8's rule, carried deliberately, and it is the reason the pre-existing release-gate FINAL routes did not become DRAFT at this release.

### Guards this release must watch fail

| Guard | What must fail first |
|---|---|
| Catalogue identity | the 28 (code, category, label, derived) entries byte-identical across engines; a reordered or relabelled entry fails |
| Both-directions coverage | a missing code, a duplicate, a derived code in `items[]`, an unknown code — four distinct messages |
| Green needs evidence | `green` with `evidence: null`, and with an empty `source` — rejected; with source and date — accepted |
| Red/amber need an action; `not_applicable` needs a reason | one negative and one positive each |
| Unknown gates, red does not | the diagonal row: one `unknown` → `due_diligence_incomplete`; the same document with that item `red` plus an action → FINAL |
| Gate ordering | tax unconfirmed + one unknown → `tax_basis_unconfirmed`; VAT unconfirmed + one unknown → `vat_basis_unconfirmed`; both confirmed + one unknown + no case → `due_diligence_incomplete`, **not** `not_approved` |
| Derived rows do not gate | fixture Y's `unconfirmed` equity source: row `unknown`, `entered_unknown_count` excludes it; the twin with the three entered unknowns evidenced reaches FINAL with that row still `unknown` |
| Derived-row mapping | each of the five rows through each of its statuses, by a one-field change |
| Rollups by hand | fixture Y's six category rows, the totals block and `addressed_pct`; `not_applicable` counted as addressed |
| Impact totals | assessed red/amber only; a `green` carrying an impact contributes nothing; max not sum for months; `stated_impact_count` and `unassessed_impact_count` |
| Conflict rule 1 | Y fires; the twin with `is_vacant: null` does not; the twin with `vacant_possession: amber` does not |
| Conflict rule 2 | Y fires; a twin at exactly 25% does not (strict) |
| No source record, no conflicts | Y with `source_record: null` raises neither and prints the not-captured sentence |
| Consent expiry | Y fires at 2 < 4; a twin with the expiry four months out does not; `acquisition_date: null` never fires; the leap-day pair pins `months_between` |
| Price basis | Y's coverage block by hand; the twin that classifies the `null` package `fixed_price` moves coverage by that package's share; headline mode → `price_basis: null` |
| QS in headline mode | rejected; detailed accepted |
| Money inertness | Y against its schedule-reset twin: `gdv_pence`, total development cost, profit and peak debt identical on absolute figures |
| Migration identity | the same code over a v12 document and its migrated v13 twin: every money figure and every pre-existing flag equal corpus-wide, `due_diligence_unknown` the named sole addition |
| Null-path identity to 2.14.0 | every pre-existing golden pin unchanged |
| §1.6 version list | requires v13 |
| Memo | §9 carries Y's counts and both conflict lines; the nine-phrase text-match is gone (a `risks[]` row reading "planning is fine" satisfies nothing); §3 prints the planning reference and expiry; §13's limitation is the conditioned sentence; the FINAL twin renders FINAL |
| Spider caveat | provisional with the HRB note unless the item is `green` or `not_applicable` |
| Message drift | the cross-engine window covers §19.7, §22.7 and §23.9, each bounded and order-asserted; the three §22.7 Python messages the widened window showed to differ were aligned to the TS text verbatim |
| Unit-sales identity | `unit_sales.totals.gross_pence == totals.gross_sales_pence` on fixture X and corpus-wide where non-null |
| Entry points | both engines' entry-point guards pass only once every production call site names v13; the client default builder captures the source record from a project |

---

## 24. The cost plan in time [R15b — calc 2.16.0]

Audit §7.5 asked for QS source/date/status, fixed-price coverage, provisional
sums, package exclusions **and inflation**; R15 (§23) closed everything on
that list except inflation, because inflation cannot be taken to a spend
midpoint a package does not yet have. Three limitations recorded across four
releases share that one missing mechanism: §16.9 limitation 1 (*"no
per-package start offset, duration or curve"*, open since R10, unowned since
R12), §16.9 limitation 2 / §20.5 limitation 3 (*"`lender_eligible` acts as a
uniform ratio on the construction line, not a per-package draw profile"*),
and §16.9's / §23.11 limitation 6's inflation deferral (*"a package has no
spend midpoint until it has its own programme"*). §24 gives every detailed
package an identity in time — its resolved phase's window, curve and a
curve-weighted midpoint — and builds all three asks on it: tender-price
inflation from `qs.base_date` to that midpoint, a per-month lender-eligible
draw share in place of R14's single ratio, and the phase picker the Costs
page has lacked since R12 gave `phase_id` its meaning.

**One arithmetic change to a stored fixture, and one new additive line.**
Calc 2.16.0 changes two computed things: a detailed plan carrying an
inflation allowance gains an `inflation_total_pence` line inside
`construction_total_pence` (every stored document migrates with
`inflation: null`, so this is `0` everywhere until entered), and §4.2(b)'s
development-cost advance cap reads lender-eligible construction spend **per
month** rather than the whole construction line at one ratio. The per-month
reading recovers R14's uniform-ratio figure exactly on every document whose
packages share one spend window — the auto path, the legacy arm, and any
network where every package resolves to the same phase (§24.4) — so it moves
only fixture `s-dated-programme`, the corpus's one document with packages in
different windows and an ineligible package among them. The v13 → v14
identity gate compares metrics, ledger and schedule on both arms with **no
exclusion** (§24.8).

### 24.1 The schema (inputs v14)

`inputs_version: 14`. One field added, inside the block R15 already gave the
detailed plan:

```
cost_plan.qs: null | {
  source, stage, date, status, base_date       -- R15, unchanged
  inflation: null | {                          -- NEW; null = no allowance modelled
    annual_pct: number                         -- tender-price inflation, % per annum
  }
}
```

- `inflation` is nullable and lives inside `qs`, so it cannot exist without a
  pricing base date by construction; `qs` itself is hard-rejected in headline
  mode (§23.1, §17.1's precedent), so inflation is detailed-mode-only by the
  same rule. `null` is §1.5's "no allowance modelled" — not the same fact as
  an allowance of `0`, which nobody has entered.
- **`annual_pct`'s bound is asymmetric across the two engines — the same
  class of boundary asymmetry §23.1 already records for `code`.** The
  TypeScript type carries no lower bound at all: a JSON payload arrives
  uncoerced, so a negative or non-finite value reaches §24.7 rule 1's
  validation error directly, and the engine's own degrade — factor `null`,
  pence `0`, rather than computing `Math.pow`/`(1+x)**y` on it (§24.3) — is
  what catches whatever an unvalidated caller still manages to pass it. The
  Python model bounds `InflationAllowance.annual_pct` with `Field(ge=0)` at
  the persistence boundary, so a negative value — and a `NaN`, since
  pydantic's `ge` comparison is false against one — is rejected as a 422
  before `validate_inputs` or `compute_cost_plan` ever runs; only a positive
  `inf` clears that bound and reaches rule 1 and the degrade in that engine.
  The `>= 0` arm inside `compute_cost_plan`'s own read is kept regardless,
  for parity with the TypeScript engine, which has no type-level bound to do
  that work for it. There is no deflation by any path in either engine: a
  base date on or after a package's midpoint clamps `months_from_base` to
  `0` and the factor to `1`.
- `CostPackage.phase_id` (R12, §18.5) is the per-package programme;
  `CostPackage.lender_eligible` (R10, wired R14) is the per-package
  eligibility. Neither's shape changes here — §24 is built entirely on
  fields that already existed.
- Migration v13 → v14 writes `inflation: null` inside every non-null `qs`
  block, and touches nothing on a document whose `qs` is null (§24.8).

### 24.2 Package timing

One pure function — `computePackageTiming` / `compute_package_timing`
(`package-timing.ts` / mirrored in `package_timing.py`) — runs before the cost
plan and the schedule and is the **only** place a package's window is
resolved; `computeCostPlan` and `buildSchedule` both read its output and
neither re-derives it. `[]` in headline mode and whenever the plan has no
packages.

```
PackageTiming:
  id:               string
  phase_id:         string | null     -- the RESOLVED phase; null on the auto and legacy arms
  start_month:      integer
  finish_month:     integer           -- half-open, §18.2
  duration_months:  integer >= 1
  curve:            SpendCurve
  weights:          number[]          -- curveWeights(duration_months, curve); Σ = 1
  midpoint_month:   number            -- see below
```

**Resolution, by spend path** — the three arms §18.5 already names:

| Path | Window | Curve |
|---|---|---|
| network | `resolvedPhaseId(pkg.phase_id, 'construction', network)`'s derived `start_month`/`duration_months` | the phase's own |
| auto (`programme = null`) | §6's construction window: months `1..max(1, term−2)`, or month 0 alone when `term = 1` | `straight_line` |
| legacy three-package (raw v4–v8 only) | the construction package's `[start_offset, start_offset + duration)` | the construction package's own |

**Every package on the auto path and on the legacy arm shares one window**,
because both arms place every package against the single construction
window or the single legacy construction package — there is no per-package
resolution below the category on either arm (§6). Every package there
therefore has the same `midpoint_month`. A package resolving to a milestone
is a hard validation error before this function is ever reached (§18.8), so
it is never asked to place one.

**Weights, not spreads.** `curveWeights(durationMonths, curve)` (`curves.ts`
/ `curves.py`) returns the ideal per-month fraction vector `w_k` of §6.1 —
`straight_line` uniform, the raised-cosine `s_curve`, the linear-ramp
`back_loaded`, or normalised `user_defined` weights — from which
`spreadByCurve` is `round_half_up(total × w_k)` with the final month
absorbing the residue, unchanged. The midpoint is computed from the weights,
never from `spreadByCurve`'s rounded pence, so it is **independent of the
amount**: doubling a package's `amount_pence` leaves its `midpoint_month`
bit-identical, and the inflation computed from that midpoint cannot feed
back into the timing that produced it.

**The midpoint, and why its fractional part is rounded to 12 dp.**

```
midpoint_month = start_month + round12( Σ_k weights[k] × k )     -- k = 0 .. duration_months − 1

round12(x) = round_half_up(x × 10^12) / 10^12
```

The sum is accumulated with `k` **not** folded into each term — `weights[k]
× k`, not `weights[k] × (start_month + k)` — and the start is added back
once, outside the accumulation, so a straight-line window's exact midpoint
(e.g. month 5 for 6 months from month 2) is not perturbed by binary
floating-point error accumulated once per term. `round12` then removes the
residual ulp so a downstream `Math.floor` on a whole-month figure derived
from the midpoint cannot be defeated by it (§24.3, §24.6). The midpoint is
otherwise carried as a **float** — 4 dp when printed, unrounded in the
engine — because a `back_loaded` package's midpoint sits later than its
window's centre (more of its spend lands in the later months) and a
`user_defined` package's midpoint is whatever its weights say; months and
fractions of months both matter because the inflation index compounds
pro-rata (§24.3).

### 24.3 Tender-price inflation

Detailed mode, `qs.inflation` non-null, `acquisition.acquisition_date`
non-null (else a hard validation error, §24.7 rules 2–3). Per package:

```
months_from_base = max(0, monthsBetween(qs.base_date, acquisition_date) + midpoint_month)
inflation_factor  = (1 + annual_pct / 100) ^ (months_from_base / 12)
inflation_pence   = round_half_up(amount_pence × (inflation_factor − 1))
```

```
inflation_total_pence     = Σ inflation_pence                     -- sum of ROUNDED lines, not a rounding of the sum
construction_total_pence  = base_build_pence + inflation_total_pence
                           + contingency_total_pence + compliance_pence
```

- `monthsBetween` is R15's §23.9 helper — whole months, floored on the day —
  reused rather than re-implemented. `months_from_base` is a **float**: the
  whole-month distance from `qs.base_date` to month 0 (the acquisition date,
  the origin every other month offset in this model shares), plus the
  package's fractional `midpoint_month`. The `max(0, …)` floor is the "no
  deflation" rule: a base date on or after a package's midpoint means the
  price already reflects that month, and the factor is exactly `1`.
- **`months_from_base` is published whenever `qs.base_date` is non-blank and
  `acquisition_date` is non-null — regardless of whether an allowance is
  recorded.** `inflation_factor` and `inflation_pence` are the ones gated on
  the allowance: `factor` is `null` and `pence` is `0` (never `null`, since
  it always enters the additive total) whenever `inflation` itself is
  `null`, or degrades to that pair when `annual_pct` is non-finite or
  negative (§24.3's engine-side rule, §24.7's validation-side one). This
  refines design §9's field list, which read `months_from_base` as gated on
  the allowance the same way `factor` is: it is not, because the latest-
  midpoint fields (§24.6) and `no_inflation_allowance`'s own skip condition
  (§24.7) both need a calendar distance to exist on a document that carries
  no allowance at all.
- The one rounding is on the pence, per package, half-up (`money_round` —
  never Python's builtin `round`, R9's lesson). The factor and the months
  are never rounded; only `round12` touches the midpoint, and only to
  remove an ulp, not to change its meaning.
- **A non-finite or negative `annual_pct` degrades in the engine to no
  allowance** — `factor: null`, `pence: 0`, the identical state an absent
  `inflation` key produces — so `Math.pow`/`(1 + x) ** y` is never evaluated
  on a `NaN` or an `Infinity`. §24.7 rule 1 owns raising the error; the
  engine's job is to stay defined for an unvalidated caller, not to enforce
  the rule a second time.
- **What is and is not inflated.** Packages only. Contingency classes keep
  their **uninflated** bases — `general` on the uninflated `base_build_pence`,
  `existing_building` and `abnormal` on the uninflated packages they tag
  (§16.3, unchanged): inflation is a disclosed line beside the priced sum,
  not a rebasing of it, and folding it into the contingency base would make
  the general class grow silently with the programme — R15's objection to a
  flat percentage, in reverse. Compliance is `0` in detailed mode
  (unchanged, §16.2). Fee lines follow their existing base definitions
  exactly: a `pct_of_base_build` line excludes inflation because
  `base_build_pence` excludes it; a `pct_of_construction_total` line
  includes it because `construction_total_pence` now does.
  `lender_eligible_base_pence` and `implied_rate_pence_per_sqm` are
  base-date figures and stay uninflated; `price_basis` coverage (§23.6) is
  against `base_build_pence` and is unchanged.
- With `inflation: null` every figure above is `0` or `null` exactly as
  §24.6 states, and `construction_total_pence` is calc 2.15.0's to the
  penny.

**Why a separate line, not a scaled package amount.** Scaling `amount_pence`
in place would move the price-basis coverage, the contingency bases, the
eligible base and the implied rate — every base-date figure — and would make
the QS's priced sum unrecoverable from the result. The allowance is a dated,
disclosed line beside the priced sum, the way a QS reports one.

### 24.4 Per-package draw eligibility

The uses are built exactly as §18.5 and §6 build them today — bucket-spread,
byte-identical to calc 2.15.0. Beside them, from the same weights §24.2
computed, each package's **unrounded** spend per month gives each month a
lender-eligible share:

```
pkg_spend(p, m) = (amount_p + inflation_p) × weights_p[m − start_p]      -- a FLOAT; 0 outside the package's window
                                                                          -- for the SHARE only; never added to uses

share(m) = Σ_{p eligible} pkg_spend(p, m)  ÷  Σ_{all p} pkg_spend(p, m)
         = lender_eligible_ratio                                        -- when the denominator is 0

uses[m].lender_eligible_construction_pence = round_half_up(uses[m].construction_pence × share(m))
```

and §4.2(b)'s advance-cap base becomes, per month:

```
uses[m].lender_eligible_construction_pence + uses[m].professional_pence + uses[m].statutory_pence
```

rounded once with the advance percentage, as before.

- **The share is computed from unrounded per-package spend, never from
  `spreadByCurve`'s rounded pence.** This refines design §7's "per-package
  spread" (decision 7) and design §24.4's own text: the design read the
  share as built from a per-package *spread* — `spreadByCurve` applied per
  package — which rounds each package's own monthly figure independently of
  every other package's. What is built instead is a ratio of two **floats**,
  `(amount + inflation) × w_k`, with no per-package rounding at all. The
  reason is the recovery claim below: a ratio of unrounded per-package
  floats reduces to the packages' own eligible fraction on any single-window
  plan whatever the amounts are, because the shared denominator terms cancel
  algebraically; a ratio built from independently-rounded per-package pence
  would not cancel exactly, and would recover R14's uniform ratio only up to
  rounding. §24.9 limitation 3 states the resulting narrower limitation: the
  share is a ratio over per-package **weights**, not a per-package ledger.
- **Headline mode:** no packages, so `share(m)` is `1` (`lender_eligible_ratio`'s
  headline value) in every month — calc 2.15.0's figure, unchanged.
- **The denominator-zero arm** is a month whose construction spend is only
  remainder — contingency in a phase (or the default bucket) no package
  resolves to. It falls back to `lender_eligible_ratio`, the uniform figure,
  rather than to `0` (which would make that contingency un-advanceable in
  exactly the months it is spent) or to `1` (which would advance an
  ineligible plan's contingency in full).
- **Contingency and compliance follow the month's share.** They sit inside
  `uses[m].construction_pence` and in no `pkg_spend`, so the share computed
  from the packages active that month is applied to them as it is to the
  packages themselves — "proportionally", as §16.9 and §20.5 have said since
  R14, now month by month rather than once for the whole line.
- **In the network arm, each package's `inflation_pence` joins its own
  resolved phase's bucket; the default-bucket remainder — contingency and
  compliance — is never itself a package line and always resolves through
  the category default.** A package's inflation spreads with the package,
  not with whichever bucket happens to be spending in its window. This is a
  no-op on every pre-R15b document, since `inflation_pence` is `0`
  everywhere until an allowance is entered.
- **The recovery claim, asserted not argued.** When every package shares one
  window — the auto path, the legacy arm, and any network where every
  package resolves to the same phase — `share(m)` equals `lender_eligible_ratio`
  in every month exactly (not merely "up to rounding"), because the
  unrounded per-package weights in the numerator and denominator are then
  the same weight vector scaled by the same eligible/all totals, and
  `lender_eligible_construction_pence(m) == round(construction(m) ×
  lender_eligible_ratio)` — R14's formula, recovered by construction. When
  every package is eligible the share is `1` and so is the ratio, whatever
  the windows. This is asserted on every auto-path detailed fixture, for
  every month, and a companion assertion proves that set of fixtures is
  non-empty: `q-detailed-cost-plan` and `w-monitoring-on-site` (auto path,
  one ineligible package each) and `x-unit-sales-ledger` and
  `y-due-diligence` (network, every package eligible and untagged) all move
  by nothing.
- **Fixture S moves, by hand — Q, W, X and Y do not.** S is the corpus's
  only document with packages in more than one spend window **and** an
  ineligible package among them; every other detailed fixture fails one half
  of that conjunction (a single window, or every package eligible), which is
  exactly what the recovery claim covers. S's eligible enabling package
  (6,000,000, tagged `strip_out`) sits in its own two-month window; its
  main-window packages are structure 24,000,000, envelope 18,000,000, M&E
  12,000,000 (eligible) and externals 6,000,000 (ineligible), with the
  3,300,000 general contingency remainder. The old uniform ratio,
  60,000,000 / 66,000,000 = 10/11, applied every month alike; the per-month
  share is **1** across the two strip-out months and **0.9** across the six
  main-window months (54,000,000 eligible of 60,000,000, a clean ratio by
  construction of the fixture — §24's own worked derivation,
  `test-cases.md` §24.2). `funding_gap_pence` moves from 6,300,000 to
  **6,330,000** — 30,000 *more*, not less, because the strip-out months now
  fund in full and the whole shortfall concentrates into the six
  main-window months instead of spreading thin across all eight. Every
  other debt-denominated metric on S is re-pinned from the two engines
  agreeing, with 6,330,000 as the hand-derived anchor.
- `lender_eligible_ratio` stays on `CostPlanResult` and on `Schedule` as the
  disclosure figure and the denominator-zero fallback; the ledger's §4.2(b)
  cap no longer reads it directly.

### 24.5 Downstream consequences, each stated

- **VAT (§17.6).** An overridden package's charge line is on `amount_pence +
  inflation_pence`, and the construction category base is
  `construction_total_pence − Σ (amount + inflation)` of overridden
  packages. The inflation follows the package's own treatment. Every
  existing document has `inflation_pence = 0` on every package, so the VAT
  ledger is unchanged corpus-wide.
- **Monitoring (§20.1).** `original(construction) = base_build_pence +
  inflation_total_pence + compliance_pence`. The split identity
  `original(construction) + original(contingency) == Σ uses.construction_pence`
  keeps holding by construction of the new `construction_total_pence`, and
  keeps being asserted corpus-wide, Z included.
- **Cost-to-complete (§5.10)** reads the ledger; it moves where the ledger
  moves (S) and nowhere else.
- **Sensitivity (§12).** The cost lever scales `amount_pence` and therefore
  `inflation_pence` (the midpoint is amount-independent, §24.2, so the
  factor is unchanged and the pence scale linearly to within rounding).
  `phase_slip` moves the tagged phase's window and every package resolving
  to it, hence their midpoints and inflation. `timeline` moves the auto
  window. No lever writes `qs`; §12.2's facility invariance is untouched.
  Lever order-independence is re-asserted with the inflation and timing
  fields present.
- **The DD `cost_plan_qs` derived row (§23.3)** is unchanged; the allowance
  is a cost-plan figure, not an evidence status.
- **The lender case hash (§13.2.1)** is a hash over the inputs; `inflation`
  is inside it because `qs` is. Editing the rate makes an approved case
  stale, exactly as editing `base_date` already does.

### 24.6 Outputs and reporting

`CostPlanResult` (§16.8) gains, per package and in total; both engines
mirror field for field. §16.8's own listing already states each field's true
position in the shape — this section restates the same fields with their
full account rather than repeating a position claim, so the two never have
a chance to disagree.

**Per package**, appended contiguously to the end of `CostPackageLine` (this
sub-list's order is exact — every field here is new, so there is no
pre-existing neighbour to state a position against):

```
packages[].phase_id                    the RAW input value, unchanged meaning; null on every migrated
                                       and every untagged row
packages[].resolved_phase_id           NEW — the RESOLVED phase; null on the auto and legacy arms
packages[].start_month, finish_month   the package's window
packages[].midpoint_month              float
packages[].months_from_base            float | null  -- null only when there is no calendar to place it in
                                       (qs.base_date blank, or acquisition_date unknown); published
                                       whether or not an allowance is recorded
packages[].inflation_factor            float | null  -- null exactly when there is no allowance
packages[].inflation_pence             integer; 0 when there is no allowance (never null)
```

**In total**, five new fields, positioned exactly as §16.8's own listing has
them — four sit together after `implied_rate_pence_per_sqm`, the fifth
amends a field already there:

```
construction_total_pence               UNCHANGED position, straight after compliance_pence; formula
                                       amended to base_build + inflation_total + contingency_total
                                       + compliance
                                       [ ... base_build_pence, contingency[], contingency_total_pence,
                                         compliance_pence, fees[], professional_total_pence,
                                         statutory_total_pence, conversion_total_pence,
                                         lender_eligible_base_pence, lender_eligible_ratio and
                                         implied_rate_pence_per_sqm are §16.8's own, unmoved and
                                         unchanged, and sit between the line above and the four below ]
inflation_total_pence                  NEW — integer; sum of the rounded per-package lines; 0 with
                                       no recorded allowance
inflation_pct_of_base_build            NEW — pct(inflation_total_pence, base_build_pence); null when
                                       base build is 0
latest_midpoint_month                  NEW — float | null; the latest package midpoint; null with no
                                       packages
latest_midpoint_months_from_base       NEW — float | null; null under the same calendar gate as
                                       months_from_base
latest_midpoint_whole_months_from_base NEW — integer | null; Math.floor of the line above; the flag
                                       message and the memo sentence print THIS, never the float
price_basis                            UNCHANGED position (R15, §23.6) — the second-to-last field
qs                                     UNCHANGED position — the LAST field; now normalised so a raw
                                       pre-v14 document publishes `inflation: qs.inflation ?? null`,
                                       the same shape as its migrated twin (§24.8)
```

`Schedule.uses[m]` gains `lender_eligible_construction_pence` — the
per-month figure §24.4 computes, read by the §4.2(b) advance cap and by
nothing else in the ledger. `Schedule` gains `package_timing:
PackageTiming[]` — §24.2's block, one per package, in package order (`[]`
in headline mode) — so the Costs page and the memo print a window rather
than derive one.

`AppraisalResultV2.metrics.cost_plan` remains the only shape a surface may
read cost from; no component and no report generator computes a midpoint, a
factor or a share.

**Surfaces.**

- **Costs page** (`ConversionCostsPage`). The QS provenance card gains an
  inflation control: a "No inflation allowance" checkbox (checked = `qs.inflation
  === null`) and, when unchecked, a rate field; unchecking seeds
  `{ annual_pct: 0 }`, never a value the user has not typed, and checking it
  clears back to `null`. Each package row and each fee-line row gains a
  **phase picker** — "Category default — *[that line's own category default
  phase's label]*" (construction for a package; professional or statutory
  for a fee line, by its own category) or any phase of at least one month's
  duration, writing `phase_id` (`null` for the default) — disabled when the
  programme is not a phase network, with a one-line hint above the package
  grid naming why. Each package row gains three
  read-only cells off the result: window (`start–finish`), midpoint
  (`midpoint_month.toFixed(2)`), inflation (`inflation_pence` as an exact
  amount). The coverage line beneath the package grid gains a fourth clause:
  "inflation to spend midpoints £*x* (*y*% of base build)", both figures
  read verbatim off `inflation_total_pence` and `inflation_pct_of_base_build`
  — no division in JSX. No arithmetic anywhere on the page.
- **Programme page.** No change. A package's window is its phase's bar.
- **Memo.** The cost section's QS paragraph gains, when `inflation` is
  recorded, its rate and base date inside the existing sentence; when it is
  not, and there is a calendar to measure against
  (`latest_midpoint_whole_months_from_base` non-null), a further sentence:
  *"No tender-price inflation allowance recorded: priced at [base_date];
  package spend midpoints fall up to [n] whole months later."* — the same
  guard `no_inflation_allowance` itself is skipped by. A new row, "Tender-price
  inflation to spend midpoints — *[rate]* p.a. from *[base_date]*", sits
  between the package schedule and the contingency rows, printed only in
  detailed mode with a recorded allowance (an unrecorded allowance is
  already `0`, and a bare "£0" row explains nothing). Each package row in
  the schedule table prints a suffix built from the facts that document
  actually carries — "phase *[label]*" only when `resolved_phase_id` is
  non-null, "midpoint *[x]*" always (every package resolves to some window),
  "inflation £*[x]*" only when the plan carries a recorded allowance — never
  a placeholder for a fact genuinely absent. The finance section's §4.2(b)
  sentence, under "Senior Debt Position", is **new** (no equivalent existed
  before this release): "Development advances are capped at *[x]*% of
  lender-eligible construction spend month by month, plus professional and
  statutory costs in full (spec §4.2(b))."
- **Cash-flow page.** No change. It prints the ledger's `uses_total_pence`
  only and has no per-category column to hang an eligibility figure on; the
  per-month figure is published on the schedule for the ledger and the
  tests, and a cash-flow column for it is out of scope (§24.9).

### 24.7 Validation and flags

**Hard errors** (detailed mode; a null `inflation` adds nothing to check):

| Field | Message | Fires when |
|---|---|---|
| `cost_plan.qs.inflation.annual_pct` | *"Tender-price inflation rate must be a finite number of at least 0."* | `annual_pct` is non-finite or negative |
| `cost_plan.qs.inflation` | *"Tender-price inflation needs a calendar: set the acquisition date, or record no allowance."* | `inflation` non-null and `acquisition.acquisition_date` is null |
| `cost_plan.qs.inflation` | *"Tender-price inflation needs the QS base date."* | `inflation` non-null and `qs.base_date` is blank after trim |

**Warning:** `annual_pct > 15` — *"Tender-price inflation above 15% p.a. is
unusual - check the rate."* No clamp; the figure is used as entered.

**[R16 — calc 2.17.0] The third row duplicates §23.9 rule 8, and is kept deliberately.**
Rule 8 already requires a non-empty `base_date` on any non-null `qs`, so this row is
reachable **only by a caller that skips rule 8** — a caller validating the inflation
block alone, or one reaching `computeCostPlan` / `compute_cost_plan` on an
externally-supplied document. It is kept for the two engines' parity on exactly such a
caller: a rule present in one engine and absent from the other is the silent asymmetry
the dual-engine mirror exists to prevent, and this row costs nothing on every caller
that does run rule 8. The **engine's** read of `base_date` is correspondingly
defensive rather than trusting: a missing key, a non-string value or a blank-after-trim
string is treated as **absent** (no base date, so no allowance and `months_from_base`
null), never as an error thrown from inside the cost-plan computation — validation owns
the error, the engine owns the degradation.

**One flag**, raised in `dueDiligenceFlags` / `due_diligence_flags`, called
from `deriveMetrics` / `derive_metrics` beside R15's four (§23.9), dated at
the floored month of the latest package midpoint:

| Flag | Severity | Fires when | Message |
|---|---|---|---|
| `no_inflation_allowance` | amber | detailed mode, `qs` non-null, `inflation` null, `latest_midpoint_months_from_base` non-null and `> 0` | *"no tender-price inflation allowance recorded: priced at [base_date]; package spend midpoints fall up to [n] whole months later"* — `n` is `latest_midpoint_whole_months_from_base`, the same integer the memo prints, never a re-floored copy of the float |

It is skipped when `acquisition_date` is null (there is no calendar to
measure against — `latest_midpoint_months_from_base` is itself null there,
so this is not a separate guard) and when no midpoint falls after the base
date (`> 0`, not `>= 0`: a base date at or after every midpoint clamps the
figure to exactly `0`, which reads as "nothing to inflate", not "record an
allowance"). `inflation_pence` being non-zero is never itself a flag: an
allowance is a line, not a warning.

**Cross-engine message drift.** This section's four rules sit inside
`validateDueDiligence`'s body, so §23.9's own window (§9.6 of
`model-governance.md`) already compares their message text against
`validation.py` verbatim. The guard (§9.6) additionally gains a **third,
narrower window** nested inside that one — `// --- R15b §24.7 begin ---` /
`... end ---` markers either side of this section's rules in `validation.ts`
— which is a **bounded canary on the call count**, not a second content
comparison: it asserts the marked block contains exactly four `err`/`warn`
calls, so a rule silently added or removed inside the markers is caught even
where §23.9's own `>= 25` bound alone would not notice a one-rule drift.

### 24.8 Migration and the persistence boundary

```
v13 cost_plan.qs: null           →  v14 unchanged
v13 cost_plan.qs: { ... }        →  v14 { ..., inflation: null }
```

`migrateV13toV14` / `migrate_v13_to_v14` mirror the v12 → v13 helper,
including the already-v14 merge branch and the two refusals (an
unrecognised `inputs_version`, and a document declaring 14 that fails the
v14 structural check). `isV14` / `is_v14` discriminate on `inputs_version
== 14` **and** the `due_diligence` key **and** either `qs` is null or `qs`
carries the `inflation` key present — not merely equal to `null` — because
an absent key and an explicit `null` read identically at runtime and only
the explicit key proves the v14 write actually happened.

**The identity gate compares metrics, ledger and schedule with no
exclusion** — `package_timing`, `lender_eligible_construction_pence` and
every new cost-plan field included — because both arms run the same calc
2.16.0 code and the migration writes only a `null`. This is not the same
claim as "the flag list is excluded and the rest is checked": the flag list
is compared with **strict equality**, and `no_inflation_allowance` is
asserted **by name** as the sole addition, proven to fire on at least one
migrated fixture (Y carries a `qs` block dated before its construction) on
**both** arms — the raw v13 document and its migrated v14 twin — so a named
exclusion could never be used to hide a flag that had stopped working on
one side only.

**The TS engine republishes `qs` normalised.** `computeCostPlan` reads
`plan.qs.inflation ?? null` and republishes that value on the result rather
than the raw input, so a raw pre-v14 stored document (no `inflation` key at
all) and its migrated v14 twin (`inflation: null` explicitly) publish the
identical result shape — the same discipline every `?? null` read on a
migration-added field in this codebase already follows (`phase_id`,
`price_basis`, §16.9/§23.6). Python's `model_dump` does the same by the
model's own default.

**Pins that move under calc 2.16.0, all by hand:** fixture S's
ledger-derived metrics (§24.4). Every other golden pin is asserted
unchanged; the recovery claim of §24.4 is the reason, and its test is the
proof.

**Entry-point cutover.** `migrateInputsToV14` / `migrate_inputs_to_v14` at
every production call site; the governance `inputs_version` stays derived
from the document (R13's finding); the Costs page's `DEFAULT_QS` seeds
`inflation: null` for a newly-recorded QS block, never an implicit zero.

### 24.9 Stated limitations

Recorded so they are not read as oversights.

1. **One rate, flat.** A single annual tender-price rate for the whole plan;
   no dated index table, no per-package rate. A plan whose packages carry
   different indices records one.
2. **Inflation is on packages only.** Fee lines are not inflated (an
   appointment is priced at appointment); contingency bases are uninflated
   by design (§24.3). A `pct_of_construction_total` fee follows the
   inflated base by its own pre-existing definition, not by a special case
   written for inflation.
3. **The per-month share is a ratio over per-package weights, not a
   per-package ledger.** The uses remain bucket-spread (§18.5); the share is
   computed beside them from each package's unrounded `weights` vector, and
   the underlying spend those weights describe is never itself entered into
   the monthly uses as a per-package figure. The recovery test bounds the
   difference from a true per-package spread to exactly zero where every
   package shares one window; elsewhere the per-month eligible construction
   figure is the engine's own computed share, not a re-derivable per-package
   breakdown.
4. **Contingency and compliance follow the month's share.** No separate
   eligibility rule for the contingency allowance.
5. **A package's programme is its phase.** A package with its own timing
   needs its own phase, which then participates in float, the critical path
   and `phase_slip` like any other. There is no per-package offset inside a
   phase.
6. **The auto path has one window.** Every package under `programme = null`
   shares §6's construction window and midpoint; per-package timing needs a
   network, as §18.10 limitation 1 already says of slippage.
7. **No calendar beyond month 0.** `months_from_base` bridges `base_date` to
   month 0 through `acquisition_date`; every later month is a month offset,
   not a calendar date. §18.10 limitation 3 stands.
8. **The share is not re-simulated by the monitoring statement** (§20.5
   limitation 4, unchanged).

Three limitations recorded in earlier printings become historical notes
rather than being deleted (this project's own rule, §16.9): §16.9
limitations 1 and 2, §16.9's inflation line, §20.5 limitation 3 and §23.11
limitation 6.

### Guards this release must watch fail

| Guard | What must fail first |
|---|---|
| Midpoint is curve-aware | fixture Z's `back_loaded` `mande_fitout` package: `midpoint_month` (12.333…) ≠ its window's centre (12); a straight-line twin equals its centre |
| Midpoint is amount-independent | doubling a package's `amount_pence` leaves its `midpoint_month` bit-identical |
| Floor at zero | a `base_date` after every package's midpoint → `months_from_base` 0, `inflation_factor` 1, `inflation_pence` 0 on every package; the unfloored value is negative on that twin, proving the floor is reached rather than coincidentally satisfied |
| Rounded lines, not a rounded sum | Z's five packages: `inflation_total_pence` (5,496,722) equals the sum of the five independently-rounded lines, not `money_round` applied to their unrounded sum |
| Per-month share on S, absolute | strip-out months (6, 7) at share 1, `lender_eligible_construction_pence` 3,000,000 each; main-window months (8–13) at share 0.9, `lender_eligible_construction_pence` 9,495,000 each |
| Per-month share on Z, absolute | month 13's `lender_eligible_construction_pence` 14,653,411 against `uses.construction_pence` 15,775,964 — the unrounded-share figure, not the R14 contrast figure 14,341,785 pinned beside it for the difference to be visible |
| R14 recovery | on every auto-path detailed fixture, every month: `lender_eligible_construction_pence == round(construction × lender_eligible_ratio)`; a companion asserts that set of fixtures is non-empty |
| Denominator-zero arm | a network whose default construction phase carries only contingency: those months at the uniform ratio, not 0 and not 1 |
| Inflation follows the override | Z's `pkg-externals` override: VAT line = `money_round((amount + inflation) × rate)` = 1,300,100; the construction category base net of the same 6,500,501; `irrecoverable_vat_pence` 1,300,100 by hand (S's is 0) |
| Monitoring split identity | corpus-wide, Z included, with `inflation_total_pence` inside `original(construction)` |
| Contingency uninflated | Z's `general` contingency base equals `base_build_pence` (66,000,000) exactly, unmoved by the 5,496,722 of inflation; a `pct_of_base_build` fee excludes inflation and a `pct_of_construction_total` fee (`fee-pm`, base 74,796,722) includes it — both pinned |
| Migration identity, strict flag equality, no exclusion | v13 → v14 corpus-wide in both engines, flag lists compared with strict equality; `no_inflation_allowance` the named sole addition and proven to fire on fixture Y on **both** its raw v13 and migrated v14 arms |
| S re-pinned, everything else still | S's `funding_gap_pence` 6,330,000 and its dependent metrics by hand (§24.4); every other golden pin unchanged |
| Calendar rule | `inflation` non-null with `acquisition_date: null` errors naming both facts; a blank `base_date` errors and the engine never reaches `monthsBetween` on it (a spy/raise guard) |
| Non-finite degrade | an unvalidated `annual_pct` of `NaN` or a negative value reaches `computeCostPlan` without throwing: `inflation_factor` null, `inflation_pence` 0 on every package — the validation rule is what is expected to reject it, not the engine |
| Flag boundary | `no_inflation_allowance` skipped when the max midpoint is at or before the base date; fires at exactly one month after |
| Memo suffix gating | a package with no resolved phase prints no "phase" clause; a plan with no recorded allowance prints no "inflation" clause; both print together only when both facts are recorded |
| Lever order-independence | all five levers, in several orders, on Z: identical results, inflation and timing fields included |
| Cost lever scales inflation | Z under `construction_cost_adjustment_pct: +10`: every `inflation_pence` within a penny of 1.1× its base-case figure; every `midpoint_month` unchanged |
| Phase picker is live | tagging a package to another phase on the Costs page moves its `start_month` in the result; the picker is disabled on an auto-path document |
| Message drift | §23.9's window already compares §24.7's four messages (they sit inside `validateDueDiligence`); the nested call-count canary fails first on a rule silently added or removed inside the markers |
| Spec-versions pin | `CALC_VERSION` 2.16.0 and the §1.6 changelog and version list both name v14/2.16.0, in both engines; entry-point guards pass only once every production call site names v14 |

**Guards deliberately not written:** that `finish == start + duration` (true
by construction of `PackageTiming`); that `Σ weights == 1` (true by
construction of every curve function — the *spread* invariant Σ = total is
what is already asserted, as it has been since §6.1).

---

## 25. The standard lender stress pack [R16 — calc 2.17.0]

A credit committee asks the same questions of every scheme regardless of who
entered it: *what if a unit is lost, the saleable area shrinks, the existing
building throws up an abnormal, sales run six months slow, planning or
practical completion slips, the exit yield moves out, the refinance lender
lends less, opex and voids run over, or the risks the evidence schedule
already records actually crystallise?* §12 answers only the questions a user
configures, and §12.3/§12.4's normative defaults cover four levers — GDV,
cost, term and rate. This section defines a **closed, normative pack of nine
stresses**, each one §12.5 cell, computed and printed whether or not anyone
pressed anything, and the four levers three of them need.

The pack composes existing machinery: it adds no formula. Every entry is
`run_appraisal(apply_scenario(base, its settings))` routed through §12.7's
cell-validity rule, exactly as a matrix cell is. **Calc 2.17.0 changes no
existing computed value** — every new scenario field migrates as `0`, every
new lever is the identity at `0`, and the change to how a cell composes its
settings (§25.1) is a no-op for every lever pair but `saleable_area`/`gdv`,
which is new in this release.

### 25.1 Four new levers (inputs v15)

§12.1's table gains four rows, in this order after `sales_slip`:

| Lever | Unit | Effect on the inputs document | No-op when |
|---|---|---|---|
| `saleable_area` | percent | scales every `unit_mix.units[].floor_area_sqm` **and** `estimated_value_pence` by `(1 + p/100)`; area exact, value rounded half-up once; ancillary areas and values untouched | `unit_mix.units` is empty |
| `abnormal_cost` | percentage points | adds to the `abnormal` contingency class's `pct` (`cost_plan.contingency[name = 'abnormal'].pct`, §16.3) | `cost_plan` is null, or the class's resolved base is 0 |
| `programme_slip` | months | adds to `programme.phases[i].slip_months` for **every phase with `predecessors = []`** — the network's sources | `programme` is not a network, or carries no phases |
| `refi_ltv` | percentage points | **subtracts** from `investment_case.takeout.ltv_cap_pct` (§19.4, §19.8) | `investment_case` is null |

**Sign convention, restated per lever.** `saleable_area` follows `gdv`
(negative is the reduction; the pack runs it negative) because it composes
with `gdv` on the same field. `abnormal_cost` and `programme_slip` follow
`construction_cost` and `timeline`: positive is adverse. `refi_ltv` follows
`vacancy` — it subtracts, so a positive value is adverse.

**Why the sources, not every phase.** `programme_slip` adds its months to
every predecessor-free phase only. §18.2's derivation already moves a
successor with its predecessor, so slipping every phase would count the
delay once per dependency edge; slipping the sources delays the network
once, and the cascade is §18's own.

**`ScenarioOverrides` gains four fields**, in this order after
`sales_slip_months`: `saleable_area_adjustment_pct: float = 0`,
`abnormal_cost_adjustment_pct: float = 0`, `programme_slip_months: int = 0`,
`refi_ltv_adjustment_pct: float = 0`. `SensitivityLever` and `LEVER_ORDER`
grow to thirteen in both engines, and the cross-engine lever-parity gate
(beside the `FlagCode` gate in `tests/test_accessor_guard.py`) asserts the
two orders are identical, member for member.

**An absent key reads as its seed.** Both engines read the four fields
defensively — `?? 0` in TypeScript (`?? null` where a field is nullable),
the pydantic field default in Python — because a **raw pre-v15 document can
reach `applyScenario` unmigrated**: `runAppraisal` echoes the inputs
document it was handed, the memo's scenario comparison reads `overrides` off
whatever document it was given, and golden fixture O is deliberately applied
unmigrated in a test. This is R8's rule restated for these four fields: an
absent key is not an error and is not a distinct state — it reads as the
seed value the migration would have written, so a pre-v15 document behaves
identically before and after migration (§25.7). The identity gate is what
proves it.

**Composition, stated as §12.1 requires.**

- **`saleable_area` and `gdv` share `estimated_value_pence`.** The order is
  **`saleable_area` first, then `gdv`**, each rounding half-up to pence once:
  `v₂ = round(round(v × (1 + a/100)) × (1 + g/100))`. `apply_scenario` /
  `applyScenario` applies its two arms in that order within one call — area
  scales area (exactly, as a float) and value (rounded once), then `gdv`
  scales the already-rounded value. Half-up rounding is not commutative
  across two sequential percentage applications, so the order is load-bearing
  rather than decorative: at `(saleable_area = −10, gdv = +10)` a unit value
  of `1,000,005p` composes to **990,006** in the stated order and to 990,005
  in the other. The all-levers-in-several-orders test carries the four new
  levers and asserts that figure by name (`test-cases.md` §25.4).
- **`programme_slip` and `phase_slip` share `slip_months`.** Both are
  additive integers, so their order is immaterial; stated here as this
  section requires, and covered by the several-orders test on fixture S.
- **`abnormal_cost` and `refi_ltv` share nothing** with any other lever.

**A cell applies its settings newest lever first, not in caller order.**
`_measure` / `measure` sorts a cell's settings into **descending
`LEVER_ORDER`** — the newest lever applied first, `gdv` (index 0) applied
last — before applying them one at a time on top of the zero scenario. That
descending order is exactly the arm order inside `apply_scenario` /
`applyScenario` for the one shared field: `saleable_area` (index 9) sorts
ahead of `gdv` (index 0), so a cell composes area then value, matching the
single-call rule stated above. Sorting is stable and total, so a
`(gdv, saleable_area)` matrix and its transpose measure the identical cell —
the several-orders property is kept by construction rather than by luck. For
every pair but `saleable_area`/`gdv` the sort direction changes nothing: nine
of the thirteen levers each write a field no other lever touches, and
`phase_slip`/`programme_slip` are additive integers whose order is
immaterial. The v15 identity gate asserts exactly that, by comparing the
whole default sensitivity suite on both arms (§25.7).

§12.1's standing requirement is unchanged and is restated here rather than
discharged: **any future lever that shares a written field with an existing
lever must state its composition rule in §12.1 at the time it is added.**
`saleable_area`/`gdv` is the first such pair; it is not the last permitted.

§12.2 is untouched — none of the four writes a facility field. §19.8's
carve-out (the take-out is re-solved in every cell) is what makes `refi_ltv`
measure anything at all.

### 25.2 The pack

`STRESS_PACK` is a **closed list of nine**, in this normative order. Each
entry is a key, a label and a list of lever settings; two entries carry a
setting **derived** from the base document (§25.3).

| # | Key | Label | Settings |
|---|---|---|---|
| 1 | `unit_loss` | One unit lost | `saleable_area` = −(100 / N), N = `unit_mix.units.length` |
| 2 | `area_reduction` | Saleable area -5% | `saleable_area` = −5 |
| 3 | `abnormal_cost` | Abnormal cost +10% | `abnormal_cost` = +10 |
| 4 | `slower_absorption` | Sales six months slower | `sales_slip` = +6 |
| 5 | `delayed_start` | Start / PC six months late | `programme_slip` = +6 |
| 6 | `yield_expansion` | Exit yield +100 bp | `exit_yield` = +1.0 |
| 7 | `lower_refi_ltv` | Refinance LTV -10 pp | `refi_ltv` = +10 |
| 8 | `opex_vacancy` | Opex +10%, vacancy +5 pp | `operating_cost` = +10 **and** `vacancy` = +5 |
| 9 | `risks_crystallise` | Recorded risks crystallise | `construction_cost` = p (derived), `programme_slip` = M (derived) |

**`STRESS_PACK` is the single normative table.** Both engines read every
entry's key, label, lever and magnitude **from it** — `resolve_stress` /
`resolveStress` duplicates no literal, and derives only the two settings
§25.3 defines as derived. A test in each engine pins the full
`(key, label, settings)` list of all nine entries, so a magnitude cannot
drift in one engine alone and a tenth entry cannot appear unannounced.

**Every stress is one §12.5 cell.** Its settings are applied to the base
document on top of the zero scenario (§25.1's sorted application), the
levered document is validated, and only a passing document is appraised —
§12.7 without exception or amendment. Entry 8 is the one entry with two
fixed settings; entry 9 has two when both halves are applicable.
`run_stress_pack` / `runStressPack` runs ten appraisals (the nine plus the
base) and raises `InvalidBaseDocumentError` on a base document that fails
validation, exactly as `run_sensitivity` / `runSensitivity` does (§12.7).

**Why these magnitudes.** They are the round figures a UK
development-finance credit paper habitually tables — 5% on area, 10% on
abnormal cost, six months on sales and on programme, 100 bp on yield, 10
points on LTV, 10% and 5 points on opex and voids. They are **normative**,
exactly as §12.3's and §12.4's default grid and ranges are, and are printed
beside each row (§25.5) so a reader never has to guess what was moved. The
pack is deliberately not configurable (§25.8 limitation 5): a configurable
pack is a second config object, and "standard" would stop meaning standard.

### 25.3 Derived settings

Two of the nine entries carry a setting computed from the base document.

**Entry 1 — one unit lost.** `N` is the proposed unit count
(`unit_mix.units.length`). The setting is `−100/N`, rounded to **12 decimal
places** (the `round12` rule §24.2 already uses for the spend midpoint), so
both engines apply and print the identical float: −25 on four units,
−16.666666666667 on six. `N = 0` makes the entry inapplicable (§25.4).

Unit loss is modelled as an **average** unit's share of NIA and of value,
not the removal of a named unit — §25.8 limitation 1 states what that costs.

**Entry 9 — recorded risks crystallise.** Read from
`inputs.due_diligence.items` **directly** — the document, not
`DueDiligenceResult`, which is a derivation of the same rows and would make
the pack depend on §23 having been run first:

- `assessed` = items with `status ∈ {red, amber}` (§23.4's rule).
- `Σcost` = Σ `cost_impact_pence` over assessed items with a non-null value.
- `Σmonths` = Σ `programme_impact_months` over assessed items with a non-null
  value.
- `base_build` = the base document's `cost_plan.base_build_pence` (§16.3:
  Σ packages in detailed mode, `round(rate × area)` in headline mode).
- **Cost half:** `p = round12(Σcost ÷ base_build × 100)`, run as
  `construction_cost = p`. Applicable when `Σcost > 0` **and**
  `base_build > 0`.
- **Programme half:** `M = Σmonths`, run as `programme_slip = M`. Applicable
  when `Σmonths > 0` **and** the programme is a network with at least one
  phase.
- The entry is applicable when **either** half is; its note names the half
  that is not, in the words §25.4 fixes.

The entry publishes a `derivation` block — `cost_impact_pence`,
`base_build_pence`, `cost_pct` (`p`, or null when the cost half is
inapplicable), `programme_impact_months` (the Σ),
`programme_impact_max_months` and `stated_item_count` — so a reader sees the
percent applied **and** the pence it stands for. `derivation` is null on
every other entry.

**The rounding bound, stated.** `construction_cost` is a percent lever that
rounds per costed line, so the levered build is **not** `base_build + Σcost`
to the penny. In detailed mode each package rounds once, so
`|levered_base_build − (base_build + Σcost)| ≤ (number of packages)` pence.
In headline mode the lever rounds the **rate** and
`base_build = round(rate′ × area)`, so the bound is `⌈area_sqm / 2⌉ + 1`
pence — on a 1,000 sqm scheme, £5. The detailed-mode bound is asserted on
fixture Y as a golden pin; the headline bound in a unit test in each engine,
on a headline document whose due-diligence items are given impacts for the
purpose. A pence-additive construction input was rejected: it would be a v15
field only a lever would ever write, with a migration and twenty-two fixture
edits, for an exactness a stress does not need.

**Σ, not max.** `DdTotals.programme_impact_max_months` (§23) is the
schedule's statement of the single largest recorded delay — the critical
exposure, and the memo already prints it as such. This stress asks what
happens if the recorded delays land **in series**, which is Σ, and §23.9's
note said Σ. The two figures are named together wherever entry 9 is printed
("+7 months (Σ of 3 items; largest 3)") so neither is mistaken for the
other.

**Worked example — fixture Y.** Five assessed items; `Σcost = 2,550,000p`;
`base_build = 26,000,000p`; `p = 9.807692307692`; `Σmonths = 7` against a
max of 3; one predecessor-free phase, `acquisition`, so `programme_slip = 7`
slips it and the six dependants follow. N = 4, so entry 1 runs
`saleable_area = −25`. The full derivation is `test-cases.md` §25.2.

### 25.4 Applicability

Applicability is decided **from the base document**, per entry — never from
"the metrics equal the base", because a coincidental equality is not
inapplicability (the §18.7 lesson: an identity is true of whatever it is
true by construction of):

| # | Applicable when |
|---|---|
| 1, 2 | `unit_mix.units.length > 0` |
| 3 | `cost_plan` non-null carrying an `abnormal` class, **and** either `mode = headline` (§16.3 gives every class the whole build there) or detailed with ≥ 1 package tagged `contingency_class = abnormal` |
| 4 | `unit_sales` non-null with ≥ 1 row |
| 5 | `programme` is a precedence network with ≥ 1 phase |
| 6, 7, 8 | `investment_case` non-null |
| 9 | either half, per §25.3 |

**An inapplicable entry is still measured, marked and printed** — §12.4's
zero-width-bar precedent. It carries `applicable: false` and a
one-sentence `note` naming the missing fact, and its settings resolve to
values that are no-ops by construction on that document (a fixed magnitude
that has no field to write, or a derived setting resolved to `0`), so its
metrics equal the base. Omitting it was rejected: a lender reading nine
standard rows must see **which** questions this scheme cannot answer, not
count to eight and wonder.

A corpus-wide test in each engine asserts, on every golden fixture, the
implication **`applicable = false ⇒ metrics = base`** in every field. The
converse is deliberately **not** asserted: an applicable lever may
legitimately move nothing — a `refi_ltv` cut on a take-out whose DSCR floor
already binds below the new cap is applicable and inert, and that is the
honest answer, not a defect.

### 25.5 Outputs and reporting

**The result.**

```
StressPackResult {
  base:      SensitivityMetrics          -- §12.5, always measured
  stresses:  StressResult[9]             -- §25.2's normative order
}
StressResult {
  key, label
  settings:    { lever, value, phase_id: null }[]   -- RESOLVED values, as applied
  derivation:  null | {                             -- entry 9 only (§25.3)
                 cost_impact_pence, base_build_pence, cost_pct,
                 programme_impact_months, programme_impact_max_months,
                 stated_item_count }
  applicable:  boolean
  note:        string | null    -- non-null iff inapplicable, or one half of entry 9 is
  metrics:     SensitivityMetrics   -- nullable fields, flags, validation_errors (§12.7)
  delta_profit_pence: number | null  -- metrics.profit − base.profit; null when unmeasured
}
```

`settings` carries the **resolved** values actually applied, not the
definition's placeholders, so entries 1 and 9 publish their derived figures
rather than a reader having to recompute them. `phase_id` is always null: no
pack lever carries a target (`programme_slip` deliberately needs no phase
picker, §25.1).

It lives in `stress_pack.py` / `stress-pack.ts`, siblings of the sensitivity
modules, importing `_measure` / `measure` (exported for the purpose, never
duplicated). It is **not** part of `AppraisalResultV2` and has **no API
endpoint** — nesting it in the appraisal result would make every appraisal
run ten more appraisals (§25.8 limitation 6).

**Presentation is ASCII, and the column list is normative.** Wherever the
pack is tabled — memo §10 and the Sensitivity page — the columns are:

```
Stress | Setting | Profit | Delta vs base | Peak debt | Flags
```

The delta column's header is the ASCII **`Delta vs base`**, not `Δ vs base`:
§13's ASCII-only rule for generated strings applies, and jsPDF's standard
fonts cannot encode `Δ` at all. The two surfaces carry the identical header
so a reader moving between them sees the same table.

**Reporting rules.**

- **Memo §10** gains a sub-heading before the tornado, *"Standard Lender
  Stresses (spec §25)"*, one sentence of method, then the nine rows in
  §25.2's order. An **inapplicable** row prints its base-equal figures with
  its note in the Setting cell; an **unmeasured** row prints "not measured"
  and its first validation message, §12.7's wording. The table is built
  inside `sensitivityTables()` beside the tornado so the memo runs the pack
  exactly once, and `InvalidBaseDocumentError` is caught to the same message
  the tornado uses. §13.1's provenance disclosure is unchanged: the pack is
  derived at print time, as the suite is.
- **Entry 9's Setting cell prints its construction-cost percent to 2
  decimal places**, not the 0 dp every other percent lever prints. This is
  normative, not cosmetic: `p` is a full-precision derived figure
  (9.807692307692 on fixture Y), the 0-dp form would print "+10%", and the
  parenthetical immediately after it states the recorded Σ in pence — so the
  default form would **contradict** the derivation printed beside it. The
  cell reads, from `derivation`: the percent at 2 dp, then the recorded Σ
  pence, the stated item count and the largest single recorded delay in
  parentheses — *"Construction cost +9.81%, Programme slip +7 months
  (£25,500 recorded; 3 items, largest 3 months)"*. The 2-dp override applies
  to the derived `construction_cost` setting alone, identified by the entry
  carrying a `derivation`; every fixed magnitude keeps `formatStepLabel`'s
  usual precision.
- **Memo §10's Scenario Comparison** prints one settings row per **non-zero**
  lever across the three scenarios, instead of R4's fixed two (GDV and cost),
  so a card stressed on `refi_ltv` or `programme_slip` says so. It also
  **adopts §12.7**: a scenario whose levered document fails validation prints
  "not measured" and the first error rather than an appraisal of an invalid
  document (§25.6).
- **The Sensitivity page** gains a read-only "Standard lender stresses"
  panel above the tornado, the same nine rows, via `safeRunStressPack` in
  `safe-sensitivity.ts`'s existing pattern; a base document that cannot be
  measured yields one line naming the reason, never an empty table.
  `LEVER_LABEL`, `LEVER_SHORT` and `selectableLevers` gain the four levers,
  so each is independently pickable as a tornado bar or a matrix axis.
- **The Scenarios page** gains an input for every `ScenarioOverrides` field
  that lacked one — a phase picker plus months for `phase_slip`, and number
  inputs for `exit_yield`, `operating_cost`, `vacancy`, `saleable_area`,
  `abnormal_cost`, `programme_slip` and `refi_ltv` — all through the existing
  `updateScenario`. Exhaustiveness is pinned by a
  `Record<keyof ScenarioOverrides, true>` of rendered labels, so a fourteenth
  lever cannot ship UI-less; an array length would have pinned nothing (the
  R9 lesson).
- The Costs, Programme and Exit pages are unchanged, and no page or
  generator recomputes any of it: `delta_profit_pence` and every figure in
  the table are the engine's own (§11's prohibition 9).

### 25.6 Validation

**No new document rule.** The four levers are reached only through
`ScenarioOverrides` and the sensitivity suite, and a value that produces an
invalid levered document is caught by §12.7's existing mechanism — the
position is **unmeasured, never clamped**. A `saleable_area` step of −100 or
below, a `refi_ltv` that takes the cap to zero or below, and an
`abnormal_cost` that takes a class negative all reach it: the levered
document fails §15.6's area rules, §19.7 rule 8's `0 < ltv_cap_pct ≤ 100`
and §16.5's non-negative class percentage respectively. No sensitivity-side
degenerate-cell rule is written for any of them (§19.8's finding, applied
again).

**One new configuration rule, in §12.6:** a step, or a tornado bound, for
the `programme_slip` lever that is **not a whole number of months** is an
input error — the `timeline` / `phase_slip` / `sales_slip` rule extended to
the fourth month-denominated lever, for §1.3's reason (the engine is
month-indexed; a fractional term has no meaning in the ledger).

**Pydantic and TypeScript bounds: none** on the four fields. Sign and range
are spec rules owned by validation, exactly as every scenario field already
is.

**The Scenarios page and the memo's Scenario Comparison adopt §12.7.** Both
previously appraised a levered card **without validating it**
(`runAppraisal(applyScenario(...))`, in both surfaces). With four more
levers on the card — `refi_ltv = 100`, `saleable_area = −100` — an invalid
levered document becomes easy to write, and appraising one is precisely the
clamp §12.7 exists to forbid. Both surfaces now validate the levered
document, show "not measured" with the first error-severity message on
failure, and appraise only a passing document. The `base` card is the base
document itself and is never unmeasured on a document the calculator
accepts.

**Unmeasured pack cells are pinned by name, not skipped.** On the corpus as
it stands, exactly two of fixture AA's eighteen (base, entry) cells go
unmeasured — `(y-due-diligence, slower_absorption)`, where a +6-month sales
slip pushes a ledger completion past Y's 24-month term, and
`(u-investment-case-ltv-binds, delayed_start)`, where a +6-month programme
slip pushes U's 20-month network past its own 24-month term. The identity
test collects the unmeasured `(base, key)` pairs and asserts that **set**
against those two by name, so a change that widens or narrows which cells go
unmeasured fails rather than silently changing how much of the pack is
covered (`test-cases.md` §25.5).

### 25.7 Migration and the persistence boundary

```
v14 scenarios.{base, upside, downside, severe}  →  v15 same, each plus
                                                     saleable_area_adjustment_pct:   0
                                                     abnormal_cost_adjustment_pct:   0
                                                     programme_slip_months:          0
                                                     refi_ltv_adjustment_pct:        0
```

The four fields are **written, not defaulted**, on each of the four named
scenarios, and `inputs_version` is stamped `15` — as v12 wrote
`sales_slip_months`, and for the same reason: only a written value exercises
the numeric identity gate, since `ScenarioOverrides` already defaults every
one of them to the same zero. `is_v15` / `isV15` is **structural**: version
15, `due_diligence` present, and all four keys present on `scenarios.base`.

**An absent key is not a distinct state.** §25.1's `?? 0` reads mean a raw
pre-v15 document computes exactly as its migrated twin does, which is what
makes the identity gate a claim about the migration rather than about a code
path only new documents reach.

**The entry-point cutover** (`ConversionCalculator`, `ExportPage`,
`memo-fixtures`, `__fixtures__`, `app/api/app.py`) lands in one commit, and
the entry-point guards' `EXEMPT` sets and `spec-versions.test.ts` move with
it, so no production call site is left on `migrateInputsToV14`.

**The identity gate.** `tests/test_migrate_v15.py` and `migrate.test.ts`
compare, on every golden fixture carrying its own `inputs`, the raw-v14 arm
and the migrated-v15 arm: **metrics including flags, compared strictly**;
the ledger; the schedule; **and, on four named fixtures —
`f-dev-finance-12mo`, `u-investment-case-ltv-binds`, `y-due-diligence` and
`z-cost-plan-in-time` — the whole default-config `SensitivityResult`**. The
sensitivity arm is new to this gate and is what proves §25.1's sorted
application moved nothing. The four fixtures are named rather than run
corpus-wide because a default suite is eighty-one appraisals per fixture,
and these four between them carry a cost plan, a network programme, a
unit-sales ledger, an investment case and an inflation allowance — every
block a lever can reach. **No exclusion and no tolerance:** no flag, field
or figure differs on one arm only. R15b's rule holds — nothing fires on one
arm alone, so the gate needs no carve-out.

**The consequence to disclose** is the one every inputs boundary carries
(§13.2, §21.3): every stored appraisal's `input_hash` moves on its next
save, because the document genuinely gained four fields even though all four
are zero, and an approved lender case therefore goes stale on that save.
§25 adds no FINAL condition and no banner, so the hash move is the only
consequence.

### 25.8 Stated limitations

Recorded so they are not read as oversights.

1. **Unit loss is an average unit.** Entry 1 removes −100/N of *every* unit's
   area and value, not a named unit; a scheme whose value is concentrated in
   one penthouse understates the loss of **that** unit. A named-unit removal
   lever — which would have to cascade through `unit_sales.units[]`,
   `retained_units[]` and two validation rules, and choose which unit — is
   recorded here, unowned.
2. **`abnormal_cost` has nothing to attach to in a detailed plan with no
   abnormal-tagged package.** The row says so (§25.4). Tagging is the user's
   statement that a package carries abnormal risk; the pack does not invent
   one.
3. **`refi_ltv` moves the cap only.** The DSCR and ICR floors are not
   stressed by the pack, so a scheme bound by DSCR shows no movement under
   entry 7 — which §19.4's published binding-constraint name and the cell's
   own flags already make visible.
4. **Entry 9's cost half is a percent of base build**, exact to §25.3's
   stated bounds rather than a pence-additive line. Contingency is therefore
   taken on the crystallised cost too, because the lever scales the base —
   conservative, and stated rather than smoothed over.
5. **The pack is not configurable.** A lender with a house stress set uses
   the tornado and the matrix, which remain configurable (§12.3, §12.4). A
   per-lender pack is not built and is not scheduled.
6. **No API endpoint publishes the pack** — nor the suite. A consumer
   wanting either re-runs the library.
7. **No FINAL gate on the pack.** A stress that cannot be measured, or a
   scheme on which most entries are inapplicable, is a fact about the
   document, not an omission by its author; §13.3's conditions are
   unchanged. (This is minor 7 of the R15/R15b review, declined with its
   reason: `report-provenance.ts`'s existing reasoning for derived rows
   applies here unchanged.)

### Guards this release must watch fail

| Guard | What must fail first |
|---|---|
| The shared-field pair | the several-orders test with `saleable_area = −10` and `gdv = +10` on a unit value of `1,000,005p`: the stated order gives 990,006, the other 990,005. Watch it fail with the two arms swapped in `apply_scenario` |
| Sorted application in `measure` | a matrix with rows `gdv` and columns `saleable_area`, and the same matrix transposed, report identical cell figures. Watch it fail with caller-order application restored |
| `inapplicable ⇒ metrics = base` | corpus-wide, every golden fixture. Watch it fail by making entry 3's applicability rule ignore the cost-plan mode — a headline document would then be marked inapplicable while its metrics move |
| Entry 9's rounding bound | both modes, §25.3's two bounds. Watch it fail by using `round(p, 2)` in place of `round12` |
| The v15 identity gate, sensitivity included | metrics (flags strictly), ledger, schedule and the default suite on the four named fixtures, no exclusion. Watch it fail by planting a `+1` in the `saleable_area` arm's identity value |
| Lever-order parity across engines | `LEVER_ORDER` member for member. Watch it fail by reordering the TypeScript tail |
| Scenarios exhaustiveness | the `Record<keyof ScenarioOverrides, true>` of rendered labels. Watch it fail by deleting one input |
| The memo prints nine rows | on the Y-based memo fixture, with the inapplicable notes present. Watch it fail by filtering on `applicable` |
| Entry-point guard | fixture Z posted through `POST /appraisals` — `inflation.annual_pct = 3` returns 200 with the allowance surviving in `inputs_snapshot`, `= −1` returns 422. Watch the 422 fail by removing `ge=0` |
| An unmeasured scenario card | a `downside` card with `refi_ltv = 100` on fixture U renders "not measured" on the Scenarios page and in the memo's comparison, carrying §19.7 rule 8's message. Watch it fail by restoring the unvalidated `runAppraisal(applyScenario(...))` |
| Unmeasured pack cells, by name | fixture AA's unmeasured set is exactly `(y-due-diligence, slower_absorption)` and `(u-investment-case-ltv-binds, delayed_start)`. Watch it fail by widening either fixture's term |
| Spec-versions pin | `CALC_VERSION` 2.17.0, and §1.6's changelog and version list both naming v15 / 2.17.0, in both engines; the entry-point guards pass only once every production call site names v15 |
