# Commercial-Resi-Analyser — UK Development Finance and Lender-Readiness Audit

**Review date:** 12 August 2026  
**Overall score:** **38 / 100 — below professional-use threshold**  
**Core conclusion:** A competent UK development finance lender could not currently rely on the appraisal without rebuilding the debt, cash flow, sources-and-uses, exit and downside analysis independently.

## 1. Executive conclusion

The product has a credible early-stage proposition: identify commercial-to-residential opportunities, test Class MA/PDR eligibility, build a unit-led residual appraisal, compare scenarios and export an investment memo. That proposition is convincing as an **opportunity-screening and developer pre-feasibility tool**. It is not yet convincing as a lender appraisal or Credit Committee tool.

The strongest foundations are the conversion focus, commercial SDLT calculation, unit-by-unit GDV, eligibility integrations, integer-pence arithmetic, separated TypeScript calculation modules, scenario UI, risk register, deal spider, PDF memo and 96 passing frontend tests. These make the product more than a generic SaaS shell.

The present model nevertheless fails several basic lender tests:

- A field labelled `LTV` is actually applied to cost before finance, so it is neither LTV nor the LTC subsequently reported.
- The selected funding source and serviced/rolled-up interest choice do not change the calculation.
- Summary interest assumes the entire loan is outstanding for the whole term; the monthly cash flow charges interest on total project spend rather than debt. The two answers differ.
- Monthly cash flow has no equity/debt draw priority, loan balance, facility limit, sales phasing or debt repayment.
- Downside costs automatically produce a larger loan, masking funding gaps.
- Exit costs are displayed but excluded from total development cost and profit.
- `retain_all` still books the entire GDV as sale income in the final month.
- The PDF sources-and-uses does not balance: finance costs appear as a use without a corresponding source.
- The PDF “day-one LTV” divides the total development loan by purchase price, not the day-one advance.
- The PDF “senior debt impairment” test compares GDV with total cost, not senior debt.
- Saved outputs are supplied by the client and stored separately from an unvalidated input dictionary. An actual saved appraisal is internally inconsistent.
- Negative costs and other impossible values are accepted.

These are P0 issues because they can create apparently plausible but materially misleading lender information.

### Review evidence and limitation

This review covered the repository, calculation engine, cash-flow engine, data model, API persistence, scenario logic, all calculator pages, exports, the live local API, one actual saved appraisal, automated tests, production build and lint results. The in-app browser connection failed with a Windows permission error outside the repository, so visual observations are based on the implemented React/CSS rather than interactive pixel-level inspection. The actual saved appraisal was independently recalculated from the live API record.

## 2. What the app does and for whom

### Current product flow

The broader product imports or creates commercial property opportunities, stores them in a pipeline, runs PDR/Class MA eligibility checks and allows a selected property to proceed through an 11-page calculator:

1. Acquisition
2. Unit mix
3. Costs
4. Finance
5. Cash flow
6. Appraisal
7. Scenarios
8. Exit
9. Risk
10. Deal Spider
11. Investor summary

Inputs cover purchase price and basic acquisition costs; unit type, area, value and notes; headline conversion rate, area, contingency, three compliance allowances and a small professional-fee schedule; a single leverage percentage and headline loan terms; retained rents; manual risks; and four scenarios.

Outputs include GDV, acquisition cost, construction cost, fees, finance cost, TDC, profit, profit on cost/GDV, ROE, IRR, RLV, equity, loan amount, a monthly spend table, scenario comparison, a deal spider, investor summary and PDF memo.

### Intended users and value proposition

The language and features span developers, acquisition teams, brokers, investors and lenders. In its current state the product is best suited to a developer or acquisitions analyst screening small conversion opportunities. The investor memo tries to serve equity and debt audiences simultaneously, but the underlying debt model does not support lender reliance.

**Current proposition:** fast PDR opportunity screening plus an early conversion appraisal and investment memo.  
**Ideal proposition:** a traceable developer appraisal with a locked lender-underwritten overlay, monthly debt engine, conversion risk schedule and Credit Committee-ready report.  
**Verdict:** convincing for early screening; not convincing for lender submission.

## 3. Weighted product score

| Category | Score | Weight | What works | Material weakness / missing requirement | Required improvement |
|---|---:|---:|---|---|---|
| Financial Modelling Accuracy | **7** | 20 | Unit GDV sums; commercial SDLT bands; pence storage; deterministic functions; basic profit ratios | Summary and cash-flow finance disagree; exit costs omitted; cash funding still creates debt; IRR is synthetic; stored outputs can diverge from inputs | One authoritative monthly model; server-side recalculation; reconciliation tests |
| Development Finance / Lender Relevance | **4** | 15 | Headline loan, equity, LTC/LTGDV labels, risk memo | No real facility, day-one advance, debt balance, repayment, cost-to-complete, headroom, covenant or lender GDV | Developer and lender modes with locked facility and lender metrics |
| Commercial-to-Residential Specificity | **6** | 15 | Class MA eligibility, Article 4/EPC/flood hooks, fire/acoustic/Part L allowances, NDSS/deal spider | No existing-building survey, fabric/M&E/structure/asbestos/drainage/tenancy/title/package risks; VAT shortcut is unsafe | Dedicated existing-building, planning/title and conversion work-package schedules |
| Input Structure & Assumptions | **4** | 10 | Short, understandable pages and unit schedule | Missing scheme, area, programme, tax and basis fields; no validation; inputs can be negative; assumptions lack source/status | Typed schema, validation, assumption basis and evidence/status fields |
| Development Cost Modelling | **4** | 10 | Headline £/m², contingency and a few professional/statutory items | No detailed cost plan, abnormal contingency, package basis, provisional sums, VAT or double-count prevention | Headline/detailed modes with exclusive basis and reconciliation |
| Finance & Debt Modelling | **2** | 10 | Rate, fees, term and nominal interest type are captured | Leverage field misdefined; funding/interest type ignored; full-term simple interest; no lender fees, draw rules or repayment | Monthly debt ledger with day-one and development tranches |
| Sensitivity / Risk Analysis | **2** | 5 | Editable scenarios, severe case and two-way PDF matrices | Facility expands under downside; no peak debt or repayment recalc; no area/unit/sales/abnormal stresses | Fixed-facility scenario engine driven by the monthly model |
| UX & Workflow | **3** | 5 | Clear numbered navigation, back/next, immediate calculations, consistent controls | Important sections absent; exit follows appraisal/scenarios; no autosave state, completion status, warnings or provenance; long inline-styled forms | Guided workflow with completion/reconciliation banner and progressive detail |
| Output / Reporting Quality | **3** | 5 | Structured multi-section PDF, unit schedule, costs, sensitivities and information-required prompts | Misstated lender metrics and unbalanced sources/uses undermine the whole report | Separate lender report generated only from reconciled model data |
| Overall Product Quality | **3** | 5 | Production build succeeds; modular frontend; meaningful test base | Lint fails; client is calculation authority; persisted records can be inconsistent; no audit/version control | Model governance, calculation versioning and release gates |
| **Total** | **38** | **100** |  | **Below 50: not suitable for professional lender use** |  |

## 4. Worked review of the actual saved appraisal

The live database contained a saved appraisal for **9 & 9A Stonegate, York, YO1 8AN**. This is the most useful test because it shows what the product actually persists, not merely what the UI promises.

### Saved inputs

- Purchase price: **£425,000**
- Five one-bed units, total stated NIA: **252 m²**
- Developer GDV: **£1,250,000**
- Construction: **500 m² at £500/m² = £250,000**
- Contingency: **10%**
- Fire £1, acoustic £1 and **Part L -£1**; negative cost was accepted
- Professional/statutory fees: **£30,480**
- Development finance: “70% LTV”, 8% p.a., 2% arrangement, 1% exit, 12 months, rolled up
- Exit: **retain all**, with £3,000 monthly rent per unit

The source property record says the building is not vacant and that upper parts have been sold on a 999-year lease and operate as Airbnb accommodation. Those title, possession and existing-interest issues do not flow into the appraisal or mandatory risk flags.

### Independent recalculation using the current engine rules

| Item | Recalculated amount |
|---|---:|
| Purchase, commercial SDLT and acquisition fees | £448,000.00 |
| Construction including contingency/compliance | £275,001.00 |
| Professional/statutory fees | £30,480.00 |
| Cost before finance | £753,481.00 |
| “Loan” at 70% of cost before finance | £527,436.70 |
| Equity stated by engine | £226,044.30 |
| Full-term simple interest | £42,194.94 |
| Arrangement and exit fees | £15,823.10 |
| Finance cost | £58,018.04 |
| TDC | **£811,499.04** |
| Profit | **£438,500.96** |
| Profit on cost | **54.04%** |
| LTGDV | **42.19%** |

The saved record instead reports TDC **£801,795.74** and profit on cost **55.90%**. Stored inputs and stored outputs therefore do not reconcile. The API accepts `inputs_snapshot` as an arbitrary dictionary and also accepts client-supplied GDV, cost and returns; it does not recompute or validate them. A user, stale client or API caller can persist contradictory appraisal data.

### Cash-flow and lender reconciliation

The monthly engine produces total interest of **£49,585.51**, versus **£42,194.94** in the summary engine. It calls **£798,043.30** “peak funding”, even though the modelled loan is only **£527,436.70**. That is because it accrues interest on cumulative total project expenditure, not a debt balance, and has no equity/debt split. It also:

- receives the whole £1.25m GDV in month 12 despite the selected exit being `retain_all`;
- has no refinance proceeds, interest coverage, stabilisation, valuation/yield or refinance LTV;
- has no senior loan repayment line;
- has no facility-exceeded warning despite “peak funding” exceeding the nominal loan by £270,606.60;
- excludes disposal costs from TDC and profit;
- does not distinguish serviced interest from rolled-up interest.

The report's sources total is presented as TDC, but actual engine equity plus loan equals only cost before finance:

**£226,044.30 equity + £527,436.70 loan = £753,481.00**, leaving the **£58,018.04 finance cost unfunded**.

The reported “day-one LTV” would be £527,436.70 / £425,000 = **124.1%**, because it incorrectly uses the entire nominal loan rather than a day-one advance. The report's debt-impairment test triggers when GDV falls below TDC, approximately a **35.1%** fall. Senior principal break-even on the displayed loan is instead approximately a **57.8%** fall before enforcement costs and interest: 1 − £527,436.70 / £1,250,000. Both the label and formula are wrong.

### Actual appraisal score

| Measure | Score | Lender view |
|---|---:|---|
| Appraisal Quality | **35 / 100** | Useful as a rough developer residual, not as an underwritten case |
| Financial Accuracy | **28 / 100** | Basic costs/GDV work; finance, exit, cash flow and persistence do not reconcile |
| Lender Readiness | **20 / 100** | No reliable facility, debt ledger, cost-to-complete, repayment or lender value |
| Commercial-to-Residential Risk Coverage | **32 / 100** | Generic risk list plus PDR context; title/tenancy/building risks largely absent |
| Output Quality | **48 / 100** | Well-structured memo, but incorrect metrics make it unsafe to submit |

## 5. Detailed functional review

### Scheme, planning and conversion inputs

The project record captures address, use class, some area/floor data, tenure, vacancy, EPC and description. The appraisal does not create a governed scheme facts section. It needs property type, existing and proposed use; developer/SPV; jurisdiction; planning/prior-approval reference and dates; conditions; conservation/listed/Article 4 status; CIL/S106 basis; title and rights; vacant possession; acquisition/start/PC/sales dates; unit/parking/amenity summary; and evidence status.

Conversion-specific due diligence must be structured, not buried in free text. Add condition survey, intrusive survey, asbestos R&D, structural capacity/openings, façade/windows/roof, fire strategy and compartmentation, acoustic/thermal upgrades, existing M&E suitability, new risers, drainage falls/capacity, incoming utilities, lift, access, bin/cycle stores, contamination/flood, warranty/building control route, Building Safety Act applicability, party wall/rights of light and tenant surrender/title restrictions. Each item needs **green / amber / red / unknown**, owner, evidence date, cost/programme impact and mitigation. Unknown must remain a risk.

### Areas

Current unit area is treated as NIA and GDV is safely summed from unit values, so the engine does not directly multiply GDV by GIA. However, it captures neither existing GIA, proposed GIA nor an area bridge. In the saved case, 252 m² of unit area is compared with 500 m² construction area without flagging a **50.4% NIA/GIA efficiency**. That could reflect a bad input or an uneconomic layout; the app cannot tell.

Add a reconciled schedule for existing GIA, retained commercial, demolished/void, proposed GIA, residential NIA, saleable NIA, communal/circulation, plant, storage, bins, cycles, balconies/terraces and parking. Display NIA/GIA and saleable/total-developed efficiency, with configurable warnings and a hard GDV basis label. Balconies, parking and external space should be valued separately, not included in saleable internal area.

### GDV and lender-adjusted GDV

Unit-by-unit value and automatic GDV are good beginnings. Add unit number, block/floor/aspect, beds/persons, NIA, £/sq ft, base value, floor/external/parking adjustments, developer value, evidence/comparable status and lender value. Calculate average and range £/sq ft and identify outliers or unsupported premiums.

**Developer GDV and lender-underwritten GDV should be a core feature.** Lender values should copy from developer values initially, then allow global, unit, unit-type, £/sq ft and percentage overrides with reason, author and date. Both GDVs and the variance must remain visible. LTGDV, break-even and lender sensitivities should default to lender GDV; developer returns should retain developer GDV.

### Acquisition

Commercial SDLT calculation is useful for English/Northern Irish non-residential property, but a “UK” product must select jurisdiction and apply the correct tax regime. Acquisition needs purchase VAT/TOGC assumption, recoverability, legal/agent/QS/valuation costs, title insurance, tenant surrender, holding costs, arrears/rates, vendor finance, deferred consideration, overage and existing-use value. Deferred/vendor amounts belong in sources-and-uses and debt priority, not simply in cost.

### Construction cost and flexibility

The single £/m² line is suitable only for headline screening. A lender case needs packages for enabling/strip-out/demolition/asbestos, structure, envelope/roof/façade/windows, internal partitions, fire/acoustic/thermal, mechanical, electrical, public health/drainage, utilities, lifts, kitchens/bathrooms/finishes, common parts, externals/landscaping and contractor preliminaries/OHP. Each line should support lump sum, £/m², £/ft², per unit, quantity × rate or percentage, with a clearly displayed base and tax treatment.

Provide two mutually exclusive modes:

- **Headline mode:** rate × selected area, plus separately identified abnormalities and exclusions.
- **Detailed cost-plan mode:** package schedule imported or entered line by line.

Switching modes should retain the inactive version but only one version feeds the appraisal. Show a reconciliation between headline and detailed totals; never sum both. Record QS status, estimate date, design stage, fixed-price amount/percentage, provisional sums and inflation basis.

### Contingency, fees, statutory costs and VAT

Separate general construction contingency from existing-building/abnormal contingency. Permit fixed, percentage of eligible cost, percentage of remaining cost and package-specific allowances. Base must be explicit. Warnings should be configurable by lender/product and consider survey status, fixed-price coverage and provisional sums rather than a universal threshold.

Professional fees need architect, structural, civil, M&E, QS/MS, PM/EA, planning, building control/approved inspector, principal designer, fire, acoustic, party wall, rights of light, warranty, ecology/transport and other consultants. Each should allow fixed or percentage with a selectable eligible base and incurred/remaining split.

Statutory/other costs should include CIL, S106, building control, warranty, utilities, insurance, site security, business rates/council tax, maintenance/service charge, marketing, sales agent and sales legal costs. The current exit-cost display must feed TDC and monthly cash flow.

VAT must be modelled by line with rate, recoverable percentage, timing and funding treatment. The deal spider currently assumes a 15% saving on total construction cost. Reduced-rate conversion treatment is fact-specific and may not apply to every package or scheme; never present it as guaranteed. Include net/gross views, “tax adviser confirmed?” status, adviser/date/note and a visible warning where unconfirmed.

### Programme and monthly cash flow

Loan term is not a programme. Add dated phases for exchange/acquisition, planning/prior approval, conditions, design, procurement, strip-out, construction, testing, building control/warranty, PC, marketing, completions and sales/refinance tail. Allow delays and dependencies. Practical completion must not equal full disposal or debt repayment.

The monthly cash flow should become the single source of truth. It needs opening balance; acquisition/fees; cost-package curves; contingency deployment; VAT payments/reclaims; equity contributions; senior day-one and development draws; fees; interest on actual opening/daily-average debt; capitalised interest; sales/refinance proceeds; mandatory debt sweep; closing balance; undrawn facility; and cumulative equity. Summary TDC, finance, peak debt, profit and IRR must aggregate from it.

### Development finance, LTC, LTGDV, equity and peak debt

Capture day-one advance, development-cost advance rate, gross and net facility, interest reserve, lender maximum LTC/LTGDV, rate basis/floor, arrangement fee basis, exit fee basis, broker, valuation, legal, monitoring surveyor, non-utilisation, extension/default fees and term/extension. Define each metric in a tooltip and report footnote.

Recommended definitions:

- **Gross LTC including finance:** peak gross senior debt / TDC including capitalised finance, with both numerator and denominator stated.
- **Net LTC excluding finance:** net advances excluding rolled interest and lender fees / cost excluding finance, shown separately.
- **LTGDV:** peak gross senior debt / lender-underwritten GDV; also show against developer GDV.
- **Day-one LTV:** day-one senior advance / lower of purchase price and day-one market value, with variants disclosed.

Equity must distinguish cash equity, land equity at lower-of-cost/value policy, evidenced planning uplift, deferred consideration and vendor finance. Never label paper uplift as cash. Show a sources-and-uses bridge and monthly equity-first/pari passu rules.

Peak debt must come from the debt ledger, with date, facility headroom, interest-reserve headroom and contingency headroom. “Peak funding” should be renamed total funding requirement only if that is truly what it represents.

### Profit, sensitivity, break-even and cost-to-complete

Profit must include exit costs and all finance and show before-finance and after-finance profit. Profit on cost denominator must be traceable. IRR must use actual monthly developer equity contributions and distributions, not one initial equity amount followed by one terminal receipt.

Required standard stresses are GDV -5/-10%, costs +5/+10%, combined -5/+5 and -10/+10, 6/12-month delay, abnormal event, contingency increase, reduced saleable area, unit loss and slower sales. All should recalculate finance, facility usage, peak debt, profit, POC, LTC, LTGDV and repayment using a **fixed approved facility**. Do not grant extra debt automatically when costs rise.

Show two distinct break-evens:

- **Senior repayment break-even:** minimum net realised proceeds required to discharge senior principal, accrued interest, exit fee and enforcement/sale costs; show fall from lender GDV.
- **Developer break-even:** realised proceeds required for zero developer profit.

Cost-to-complete should be tested monthly and at the reporting date: remaining cost plus finance/contingency versus undrawn committed facility plus remaining committed cash equity. Flag the first shortfall date and maximum shortfall. Support actual cost-to-date, certified cost, paid cost, remaining QS forecast and developer equity injected for partially completed schemes.

### Exit

Support individual sales with reservation/exchange/completion lags and absorption, bulk sale discount/timing, investment sale using rent/yield/costs, refinance using stabilised NOI and lender constraints, and PRS hold. Compare duration, interest, profit/equity return and debt repayment. The current sell/retain/blended selector is only a UI choice until it changes the appraisal cash flows.

### Developer mode and lender mode

Use one shared base scheme rather than duplicate appraisals.

- **Developer mode** owns commercial assumptions, optimised unit mix, developer GDV, cost plan and target returns.
- **Lender mode** snapshots the developer case, applies lender GDV/cost/programme overlays, sets maximum leverage and minimum equity/contingency, locks facility terms, records conditions and produces risk flags.

Display every lender adjustment against the developer figure with reason and audit trail. Updating the developer case should mark the lender case stale and require controlled refresh/re-approval; it must not silently overwrite underwritten values.

### Automatic risk dashboard

Build configurable rules for high LTC/LTGDV, low cash equity, low contingency, thin profit, £/sq ft outliers, compressed programme, missing sales tail, insufficient interest reserve, provisional sums, poor area efficiency, concentration, missing technical/planning evidence, facility exceedance and funding shortfall. Thresholds should be attached to a named lender policy/product and editable by authorised users.

Dashboard sections should be Planning, Existing Building, Construction, Finance and Exit. Each item is green/amber/red/**unknown**, with evidence, owner and action. Unknown is never green. The current free-form likelihood/impact register should remain as a supplementary project risk log.

## 6. UX, validation and presentation review

The numbered navigation, consistent currency controls, dark palette, cards and tables provide a coherent prototype. Calculated outputs are generally in cards rather than editable inputs. Users can navigate backwards without intentional state reset, and a saved snapshot can be updated.

Material UX risks are more important than styling:

- No distinction between required, optional, derived and lender-adjusted fields.
- No completion state, reconciliation status or “safe to export” gate.
- Save is manual; autosave/version behaviour is not explained.
- Errors during appraisal load are silently swallowed; save has no visible failure handling.
- Numeric controls have no minimum/maximum and blank values become zero.
- Currency labels redundantly include both label “(£)” and input prefix.
- Important bases are unexplained: LTV/LTC, fee bases, construction area, contingency base and exit fee basis.
- An 11-tab horizontal flow mixes data entry, outputs, risk scoring and investor reporting.
- Scenarios precede exit, even though exit assumptions should drive the base appraisal before stress testing.
- Deal Spider duplicates some appraisal judgements and can imply precision from arbitrary normalisation ranges.

Recommended validation and reconciliation rules:

1. Non-negative money, area, duration and percentage constraints; sensible configurable upper bounds.
2. Unit GDV equals headline developer GDV; lender unit values equal lender GDV.
3. Unit NIA reconciles to residential/saleable NIA; area bridge reconciles to proposed GIA.
4. Cost plan mode is exclusive; no duplicate package or headline cost.
5. Fee/contingency base is selected and displayed.
6. Sources equal uses to the penny, both at inception and monthly.
7. Closing debt rolls forward: opening + draws + capitalised interest/fees − repayment.
8. Finance cannot start before acquisition; sales cannot complete before PC unless explicitly enabled.
9. Sales/exit costs and VAT feed TDC, cash flow and profit.
10. Peak debt cannot exceed committed facility without a red flag.
11. Remaining cost is covered by undrawn facility plus committed remaining cash equity.
12. LTC divides debt by the disclosed cost base; LTGDV divides debt by the disclosed GDV.
13. Zero debt creates zero debt fees/interest; `cash` forces debt to zero.
14. Retain/refinance cases cannot receive disposal GDV unless a sale is modelled.
15. Stored derived outputs must match a server recalculation and calculation-version hash.

Visually, prioritise a professional credit hierarchy: a persistent top strip for lender GDV, TDC, peak debt, LTC, LTGDV, cash equity, POC and status; reconciled sources/uses and facility charts; input/derived/lender-adjusted colour semantics; compact cost/unit grids; and a risk/evidence panel. Reduce decorative cards and the Deal Spider's prominence until underlying data is complete.

## 7. Reporting review

The PDF memo is ambitious and contains many expected headings: scheme, unit schedule, costs, programme prompt, funding, returns, risk, scenarios, sensitivity matrices, exit and information required. This is a strong reporting scaffold.

It is not credible for direct lender submission because the report elevates incorrect or unsupported outputs: unbalanced sources/uses, mislabelled LTC/day-one LTV/peak funding, incorrect debt impairment, synthetic IRR, no lender GDV, no debt repayment schedule, no cost-to-complete and no actual programme. The presence of professional formatting makes these errors more dangerous, not less.

A dedicated downloadable lender report should contain:

1. Executive credit summary and requested facility
2. Sponsor/SPV, track record and equity evidence
3. Scheme, title, planning and existing-building overview
4. Area reconciliation and unit schedule
5. Developer and lender GDV bridge with valuation evidence
6. Cost plan, QS status, fixed-price/provisional sums and contingency
7. Dated programme and sales/refinance tail
8. Sources-and-uses and monthly equity/debt cash flow
9. Gross/net facility, peak debt/date/headroom, LTC and LTGDV definitions
10. Profitability and actual equity IRR
11. Sensitivities, repayment break-even and cost-to-complete
12. Conversion risk dashboard, conditions precedent/subsequent and outstanding information
13. Assumption schedule, calculation version and audit timestamp

Export must be blocked or watermarked **DRAFT — UNRECONCILED** whenever hard validations fail.

## 8. Technical architecture and calculation audit

### Positive architecture

- Calculation, scenario, cash-flow and export logic are separated from React page components.
- Monetary inputs are mostly integer pence, limiting binary currency-rounding errors.
- Pure functions make the model deterministic within the client.
- The production TypeScript/Vite build succeeds.
- Frontend tests pass: **96/96** across 13 files.

### Architecture risks

- There are two incompatible finance calculations: summary engine and monthly cash-flow engine.
- The React client is the source of truth for both inputs and derived outputs.
- Backend appraisal schema accepts an arbitrary dictionary and optional client-supplied metrics; no typed financial schema or server calculation exists.
- No calculation version, assumption version, immutable scenario snapshot, audit history or approver state is stored.
- Saved summary outputs can be stale relative to the saved input snapshot, as demonstrated live.
- Scenario calculation changes the construction rate and then re-sizes debt as a percentage of revised cost; this is not a lender downside.
- `funding_source`, `interest_type` and exit route are display inputs, not effective model switches.
- Disposal cost is calculated in the exit component only, outside the core engine.
- Dates are absent from the financial model, preventing accurate timing, sales and interest logic.
- RLV hard-codes a 20% target in the main engine even though Deal Spider has a separate editable target.
- The PDF calls the build rate £/sq ft using a helper on a £/m²-derived total; the output should be explicitly verified for unit conversion and labelled basis.
- Lint fails with **23 errors and one warning**, including React effect issues, unused error variables and explicit `any` in the report generator.
- The production bundle warns that the main chunk is approximately 1.2 MB, a polish/performance issue rather than a finance risk.

The backend test suite could not be executed in the available bundled Python runtime because pytest is not installed. Existing backend tests were inspected but should not be treated as a passed release gate for this review.

## 9. Required automated tests

Create golden-case tests with independently approved expected schedules, not tests that merely assert the current implementation.

### Core calculations

- Unit GDV, £/sq ft, developer/lender GDV bridge and area reconciliation
- Commercial acquisition tax by jurisdiction and boundary; VAT/TOGC/recovery cases
- Headline and detailed cost modes, eligible bases, contingency and no double count
- Fees and disposal costs included in TDC
- Profit before/after finance, POC/POGDV denominator disclosure and RLV target consistency
- Zero debt, cash funding, serviced interest and rolled-up interest
- Day-one advance, monthly debt draw, lender fees, interest roll-up, sales sweep and final repayment
- Gross/net facility, peak debt/date, LTC and both LTGDVs
- Sources-and-uses and every monthly roll-forward reconcile to the penny
- Equity timing, land equity, vendor finance and deferred consideration classifications
- Actual monthly equity IRR with multiple contributions/distributions and non-convergent cases

### Scenarios and lender tests

- GDV -5/-10, cost +5/+10, combined, 6/12-month delay
- Abnormal cost, lower saleable area, unit loss, slow absorption and refinance stress
- Approved facility remains fixed unless a separate refinance case is explicitly created
- Facility exceeded, interest reserve exhausted and cost-to-complete shortfall
- Senior repayment and developer-profit break-even
- Sales below debt, negative profit, zero contingency, zero GDV and delayed PC
- Date movement preserves dependencies and prohibits pre-PC completion
- Appraisal edits mark lender case and report stale

### Persistence and governance

- Server rejects negative/impossible values and unknown schema fields where appropriate
- Server recalculates outputs and rejects/tags client mismatches
- Saved case reloads to identical results with calculation version
- Migration/backward compatibility tests do not silently introduce defaults into an approved case
- Export values reconcile exactly to the model and draft watermark appears on failure

## 10. Current versus ideal product

| Area | Current app | Ideal app | Priority |
|---|---|---|---|
| Inputs | Short acquisition/unit/cost/finance forms | Typed scheme, areas, evidence, planning, building, tax, programme and underwriting overlays | P1 |
| GDV | Unit total only | Developer/lender unit schedules, £/sq ft, premiums, comps and variance bridge | P1 |
| Costs | One rate plus limited allowances | Headline/detailed modes, packages, QS status, provisional sums, VAT and dual contingency | P1 |
| Programme | Loan term proxy | Dated dependent programme with PC and exit tail | P0 |
| Finance | Percentage of pre-finance cost and simple interest | Day-one/development facility and monthly debt ledger | P0 |
| Equity | Residual arithmetic | Cash/land/uplift/vendor/deferred sources with monthly timing | P0 |
| Sensitivity | Four scenarios; facility re-sizes | Fixed-facility lender stresses, repayment and funding shortfall | P1 |
| Reporting | Attractive investment memo with incorrect lender metrics | Reconciled developer pack and controlled lender credit report | P0 |
| Risk | Free-form register and Deal Spider | Evidence-led conversion dashboard with unknown status and configurable policy | P1 |
| UX | 11 equal tabs; limited guidance/validation | Gated workflow, completion/reconciliation, input provenance and audit versions | P1 |

## 11. Prioritised improvement register

| Problem | Proposed solution | User benefit | Lender benefit | Effort | Priority |
|---|---|---|---|---:|---:|
| Two conflicting finance engines | Replace with one monthly cash/debt ledger feeding every output | One trusted answer | Traceable interest, peak debt and repayment | High | **P0** |
| Leverage is mislabelled/misapplied | Separate day-one LTV, cost advance, gross/net LTC and LTGDV constraints | Clear facility inputs | Lender-standard sizing | High | **P0** |
| Funding source/interest type/exit route do not drive results | Implement explicit calculation branches and invariant tests | Choices behave as labelled | Prevents misleading cases | Medium | **P0** |
| Exit costs omitted; retain case receives sale GDV | Move all exit logic into core monthly model | Correct profit/IRR | Credible repayment analysis | High | **P0** |
| Sources-and-uses does not balance | Fund finance costs/reserve explicitly and enforce penny reconciliation | Transparent capital need | Immediate funding credibility | Medium | **P0** |
| Saved inputs and outputs can diverge | Typed server model, server-side calculation and version hash | Reliable reload/share | Tamper/staleness protection | High | **P0** |
| Day-one LTV and debt break-even are wrong | Use actual day-one advance and senior discharge amount | Accurate leverage view | Correct margin of safety | Medium | **P0** |
| Negative/impossible values accepted | Schema/UI constraints plus cross-field validations | Fewer errors | Cleaner credit data | Medium | **P0** |
| No dated programme | Add dated phases, dependencies, delays and sales/refi tail | Realistic planning | Accurate interest and maturity risk | High | **P1** |
| No lender GDV | Add developer/lender value overlay and variance reasons | Faster negotiation | Underwritten LTGDV basis | Medium | **P1** |
| Cost model too coarse | Headline/detailed exclusive modes and conversion packages | Early speed plus later depth | QS-aligned review | High | **P1** |
| No VAT model | Line-level VAT/recovery with adviser confirmation | Correct cash need | Avoids tax-driven shortfall | High | **P1** |
| No cost-to-complete/facility headroom | Monthly remaining-cost versus remaining-funds test | Early shortfall warning | Core monitoring protection | High | **P1** |
| Sensitivities grant extra debt | Hold approved facility/equity commitments fixed | Honest downside | Real repayment/funding risk | Medium | **P1** |
| Conversion risk is free text | Evidence-led RAG/unknown dashboard | Better diligence workflow | Rapid risk review | Medium | **P1** |
| Area assumptions opaque | Area bridge and efficiency metrics | Detect bad layouts/inputs | Reliable GDV/cost bases | Medium | **P1** |
| Report can export unreconciled case | Hard export gate/watermark and dedicated lender report | Avoids embarrassment | Prevents reliance on broken case | Medium | **P1** |
| No audit/approval history | Immutable versions, change log and lender snapshot state | Collaborative control | Underwriting governance | High | **P1** |
| Forms are verbose and visually equal | Compact grids, tooltips, input/derived semantics and completion bar | Faster entry | Easier checking | Medium | **P2** |
| Build/lint quality gates incomplete | Fix lint, run backend suite in CI, add golden models | Safer releases | Stronger model governance | Medium | **P2** |
| Report bundle/performance | Lazy-load maps/PDF/XLSX and split chunks | Faster app | Minor usability benefit | Low | **P2** |
| Deal Spider can imply false precision | Make optional and disclose policy/weights; subordinate to risk dashboard | Less clutter | More defensible risk view | Low | **P2** |
| Limited collaboration/portfolio insight | Add broker/lender workspaces, compare facilities and portfolio exposure | Commercial scale | Portfolio underwriting | High | **P3** |
| No integrations to QS/valuation data | Import BCIS/QS cost plans and comparable evidence with provenance | Faster population | Better evidence | High | **P3** |

## 12. If only five changes can be made before launch

1. **Build one reconciled monthly cash-flow and debt engine** covering equity, facility draws, rolled/serviced interest, fees, sales/refinance and repayment; derive all summaries from it.
2. **Correct and govern lender metrics**: day-one advance/LTV, gross/net facility, LTC definitions, developer/lender LTGDV, peak debt, fixed-facility downside, repayment break-even and cost-to-complete.
3. **Enforce typed validation and server-side recalculation/versioning**, preventing negative inputs, stale outputs, unbalanced sources-and-uses and untraceable exports.
4. **Add a conversion-specific scheme/area/cost/risk model**, including existing-building diligence, headline/detailed cost modes, VAT, abnormal contingency, programme and area efficiency.
5. **Create developer and lender modes with a reconciled lender report**, lender-adjusted GDV/cost/programme, configurable risk flags, outstanding information and an export gate.

## 13. Final product scorecard

| Measure | Score |
|---|---:|
| Overall App | **38 / 100** |
| Financial Model | **3 / 10** |
| Development Finance Logic | **2 / 10** |
| Conversion-Specific Logic | **4 / 10** |
| Cost Modelling | **4 / 10** |
| Finance Modelling | **2 / 10** |
| Risk Analysis | **4 / 10** |
| UX | **6 / 10** |
| Reporting | **5 / 10** |
| Professional Credibility | **4 / 10** |
| Commercial Potential | **7 / 10** |

### Five biggest weaknesses

1. No coherent lender debt/cash-flow engine.
2. Incorrect and mislabelled lender metrics in a professional-looking report.
3. Persisted appraisals are unvalidated and can be internally inconsistent.
4. Insufficient conversion building, area, programme, tax and cost detail.
5. Downside analysis does not test a fixed funding structure or repayment.

### Five strongest features

1. Clear commercial-to-residential/PDR product focus and pipeline context.
2. Unit-by-unit GDV and commercial SDLT foundation.
3. Eligibility, Article 4/EPC/flood and Class MA screening concepts.
4. Modular pure calculation code, pence arithmetic and meaningful frontend tests.
5. Ambitious PDF memo, scenarios, risk register and Deal Spider scaffold.

### Five most important improvements

The five launch changes in section 12 are the priority sequence. Do not invest heavily in visual polish until items 1–3 are complete and golden-case tested.

### Features to remove or simplify now

- Remove or relabel “LTV” until separate LTV/LTC mechanics exist.
- Remove lender-facing day-one LTV, peak LTGDV, debt impairment and peak-funding statements until corrected.
- Hide serviced interest until it changes cash flow.
- Hide retain/blended investor returns until exits drive the core model.
- Make Deal Spider optional and secondary; it should not compensate for missing underwriting data.
- Avoid displaying IRR where cash flows are synthetic or non-convergent.

### Missing features

Developer/lender GDV; area bridge; detailed conversion cost plan; VAT/recovery; dated programme; monthly equity/debt ledger; day-one advance; gross/net facility; peak debt/headroom; cost-to-complete; senior repayment break-even; staged sales/refinance; equity classification; lender policy/configurable flags; evidence-led conversion risk dashboard; audit versions; controlled lender report.

### Recommended roadmap

**Phase 0 — Model correction (launch blocker):** specification and golden model; single monthly engine; correct exit/finance/returns; sources-and-uses; validation; server recalculation; disable unsafe report metrics.  
**Phase 1 — Lender-ready core:** developer/lender modes and GDVs; facility constraints; programme; sensitivities; break-even; cost-to-complete; lender report.  
**Phase 2 — Conversion underwriting:** area bridge, detailed cost plan, VAT, existing-building/planning/title dashboard, QS and evidence workflow.  
**Phase 3 — Professional workflow:** audit/approvals, collaboration, policy templates, imports, portfolio view and integrations.  
**Phase 4 — Polish and scale:** accessibility, responsive grids, performance/code splitting, benchmarking and configurable lender products.

## Final answer to the core review question

**No.** A competent UK development finance lender could not currently rely on the appraisal to understand and underwrite a commercial-to-residential conversion without rebuilding the model. The lender would have to reconstruct the sources-and-uses, debt sizing, monthly drawdown, interest, equity timing, exit proceeds, repayment, peak debt, cost-to-complete, break-even and lender-adjusted GDV. The most urgent work is therefore not additional dashboard polish: it is a single traceable monthly model, correct lender definitions, governed persistence and conversion-specific underwriting inputs.
