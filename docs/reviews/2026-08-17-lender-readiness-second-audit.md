# Commercial-Resi-Analyser — Second UK Development Finance and Lender-Readiness Audit

**Review date:** 17 August 2026  
**Previous review:** 12 August 2026  
**Previous score:** 38 / 100  
**Revised score:** **69 / 100 — functional and substantially corrected, but not yet lender-ready**  
**Movement:** **+31 points**

## 1. Executive conclusion

The updates have materially changed the product. The original P0 financial-model defects have been addressed: the app now has one authoritative monthly model, a debt ledger, fixed-facility downside testing, explicit exit and refinance logic, balanced sources and uses, server-side recalculation, versioned inputs, stronger validation and a draft/report-safety control. This is no longer the unreliable prototype assessed in the first review.

For the implemented scope, the financial model is now credible and traceable. The worked York appraisal reconciled exactly to an independent pence-level calculation, and the full automated suite passed: **872 frontend tests and 767 backend tests**, together with lint and production build. The live calculator also reconciled sources and uses and correctly identified outstanding senior debt, the migrated finance-term confirmation requirement and the mismatch between unit NIA and construction area.

The product has therefore moved from **below professional-use threshold** to a useful developer appraisal and development-finance screening platform. It is capable of producing a defensible preliminary case and of telling the user when a case is not report-safe.

It is still not a complete lender-underwriting or Credit Committee product. The most important gaps are now data depth and underwriting workflow rather than core arithmetic:

- no full area bridge or efficiency reconciliation;
- only a headline construction-cost model, without a detailed QS package schedule or VAT cash-flow treatment;
- limited conversion-specific technical, title, possession and existing-building due diligence;
- no structured evidence-led automatic risk dashboard;
- no distinct controlled lender case, approval state or monitoring cost-to-complete workflow;
- limited operating/refinance underwriting and standard downside levers;
- England/Northern Ireland SDLT logic within a product presented as UK-wide;
- exported-report layout and provenance defects, including one serious text-overflow issue.

**Core lender conclusion:** a competent lender can now use the appraisal as a strong preliminary underwriting aid, but would still need its own valuation, QS/cost evidence, technical due diligence, tax confirmation, title/planning evidence, detailed programme and controlled credit approval before relying on it.

## 2. Review scope and evidence

This second review covered:

- the TypeScript and Python calculation engines;
- the v4 input schema and calculation version 2.5.0;
- monthly cash flow, debt ledger, facility constraints and equity logic;
- acquisition, unit mix, costs, finance, programme, appraisal, scenarios, sensitivities, exit, risk, Deal Spider and investor pages;
- API persistence, server-authoritative recalculation, migration and report-safety controls;
- one actual saved appraisal for **9 & 9A Stonegate, York, YO1 8AN**;
- independent manual recalculation of the York case and review of a published golden case;
- live interaction with the local application;
- the generated 13-page investment memorandum, rendered and inspected page by page;
- automated frontend and backend tests, lint and production build.

The appraisal was reviewed as a UK senior development-finance underwriter and commercial-to-residential developer would review it: traceability, funding sufficiency, repayment, downside, conversion risk, evidence status and report credibility were considered alongside numerical accuracy.

## 3. Retest results

| Release gate | Result | Review conclusion |
|---|---:|---|
| Frontend automated tests | **872 passed / 44 files** | Strong breadth and a major improvement from the original 96-test suite |
| Backend automated tests | **767 passed** | Server model, API and governance logic now have substantial coverage |
| Backend warnings | **42** | Non-blocking deprecation/UTC warnings; should be cleared before they become upgrades blockers |
| ESLint | **Passed** | Original lint failure is resolved |
| Production build | **Passed** | Release builds successfully |
| Main JavaScript bundle | **1,374.98 kB; 424.08 kB gzip** | Functional, but Vite reports a code-splitting warning |
| Live sources and uses | **Reconciled to the penny** | Original funding gap is resolved |
| Independent York recalculation | **Exact match** | Implemented model is arithmetically reliable for this case |
| Generated report | **13 pages; draft controlled** | Strong structure, but one major layout defect and some governance omissions remain |

The automated tests establish strong regression protection, but they do not replace independent approval of tax, valuation, legal, construction or lender-policy assumptions.

## 4. Revised weighted product score

| Category | Previous | Revised | Weight | Second-review assessment |
|---|---:|---:|---:|---|
| Financial Modelling Accuracy | 7 | **16** | 20 | One monthly engine; exact worked-case reconciliation; explicit exit treatment; deterministic pence arithmetic; server authority. Remaining limitations mainly concern model scope rather than wrong formulae. |
| Development Finance / Lender Relevance | 4 | **11** | 15 | Day-one/facility inputs, debt ledger, headroom, fixed-facility stresses, break-even and CTC are major advances. Controlled lender cases, monitoring data and covenant/operating depth remain absent. |
| Commercial-to-Residential Specificity | 6 | **7** | 15 | Class MA context and compliance allowances remain useful, but existing-building, title, survey, services, fabric and conversion-package depth has advanced only modestly. |
| Input Structure & Assumptions | 4 | **6** | 10 | Typed/versioned schema, validation, confirmations and migration flags improve reliability. Scheme facts, evidence status, area bridge, tax basis and risk schedules remain incomplete. |
| Development Cost Modelling | 4 | **5** | 10 | Headline rate, contingency and fees calculate correctly. No detailed cost-plan mode, package reconciliation, provisional sums, fixed-price coverage or VAT cash flow. |
| Finance & Debt Modelling | 2 | **8** | 10 | Monthly interest, capitalised fees, facility constraints, repayment and cash funding now behave coherently. Non-cash equity, pari passu, extension/non-utilisation fees and some refi metrics are incomplete. |
| Sensitivity / Risk Analysis | 2 | **4** | 5 | Fixed facility, matrix, tornado and repayment warnings are credible. Standard conversion, area, sales absorption and refinance stresses need expansion. |
| UX & Workflow | 3 | **4** | 5 | Clear live reconciliation, flags and thirteen-page workflow. Too many equal tabs, exit assumptions are late in the flow, manual save remains and evidence/completion status could be clearer. |
| Output / Reporting Quality | 3 | **4** | 5 | The memo is comprehensive and clearly watermarked draft, but contains a major overflow defect, weak pagination, no visible model provenance and some overconfident export copy. |
| Overall Product Quality | 3 | **4** | 5 | Strong tests, server authority, versioning and release documentation. Remaining product depth and report QA prevent lender-ready status. |
| **Total** | **38** | **69** | **100** | **Functional and materially corrected; suitable for professional preliminary appraisal, not yet a lender-reliance product.** |

## 5. Original P0 issue closure

| Original critical issue | Status | Evidence from second review |
|---|---|---|
| Two conflicting finance engines | **Resolved** | Summary metrics derive from the authoritative monthly engine and reconcile to the debt ledger. |
| Interest charged on project spend rather than debt | **Resolved** | Interest is charged on debt balances with explicit monthly roll-forward and rounding. |
| Cash and serviced-interest selections did not work | **Resolved for supported modes** | Cash creates no senior debt; supported interest treatments feed the ledger. Unsupported structures are rejected or warned. |
| Downside automatically increased debt | **Resolved** | Sensitivities hold facility terms fixed and expose repayment/funding failures. |
| Exit costs and retain-all were mis-modelled | **Resolved** | Exit routes drive receipts and debt repayment; retain-all does not book fictional sale proceeds. |
| Sources and uses did not balance | **Resolved** | Live case reconciles sources and uses to the penny, including financed fees. |
| Day-one advance/LTV and debt break-even were wrong | **Resolved** | Separate day-one and facility concepts plus senior repayment tests are implemented. |
| Client-supplied outputs could become authoritative | **Resolved** | Server recalculates and persists authoritative outputs with versions and hashes. |
| Negative/impossible values were accepted | **Resolved materially** | Schema and cross-field validation reject or flag inappropriate values. |
| Unsafe report could appear lender-ready | **Resolved materially** | Draft watermark and report-safe status operate. The export still requires layout/provenance QA. |

No original formula defect remains a P0 launch blocker in the cases reviewed. The exported memo overflow is, however, a **new report-release blocker** if that memo is to be sent externally.

## 6. Worked review — York saved appraisal

### 6.1 Current inputs after migration

- Purchase price: **£425,000**
- Total acquisition cost: **£448,000**
- Five one-bedroom units
- Total unit NIA: **252 m²**
- Construction area: **500 m²**
- Developer GDV: **£1,250,000**
- Base works: **500 m² × £500/m² = £250,000**
- Contingency: **10%**
- Fire and acoustic allowances: **£1 each**
- Professional fees: **£28,000**
- Statutory costs: **£2,480**
- Migrated net facility: **£527,437.40**
- Interest: **8% p.a.**
- Arrangement fee: **2%**
- Exit fee: **1%**, not charged where no applicable exit occurs
- Term: **12 months**
- Exit: **retain all**
- Gross rent: **£180,000 p.a.**
- No lender valuation and no refinance modelled

The application correctly marks the migrated finance terms and equity source as requiring confirmation. It also warns that 252 m² NIA differs from 500 m² construction area by more than 25%. Those warnings are meaningful and should not be suppressed.

### 6.2 Independent recalculation

All figures below were recalculated independently using integer-pence, half-up monthly interest mechanics.

| Item | Independent amount | App amount | Result |
|---|---:|---:|---|
| Acquisition | £448,000.00 | £448,000.00 | Exact |
| Construction including contingency/compliance | £275,002.00 | £275,002.00 | Exact |
| Professional/statutory | £30,480.00 | £30,480.00 | Exact |
| Cost before finance | **£753,482.00** | **£753,482.00** | Exact |
| Arrangement fee | £10,548.75 | £10,548.75 | Exact |
| Compounded monthly interest | £875.55 | £875.55 | Exact |
| Total finance cost | **£11,424.30** | **£11,424.30** | Exact |
| Total development cost | **£764,906.30** | **£764,906.30** | Exact |
| Unrealised development profit | **£485,093.70** | **£485,093.70** | Exact |
| Profit on cost | **63.42%** | **63.42%** | Exact |
| Profit on GDV | **38.81%** | **38.81%** | Exact |
| Peak debt | **£11,424.30** | **£11,424.30** | Exact |

The apparently low peak debt is consistent with the present migrated setup: development costs are funded from equity and only the capitalised finance charge sits in the senior ledger. The model does not invent a draw merely because a facility limit exists.

### 6.3 Funding and return interpretation

The live reconciliation correctly shows:

- sources equal uses;
- facility and sources are sufficient;
- senior debt remains outstanding because the retain-all case has neither sale nor refinance proceeds;
- the case is not report-safe;
- equity multiple is **0.00x** and equity IRR is **not available** because no cash return has been modelled;
- the displayed **64.38% ROE is an unrealised accounting return**, not a distributed equity return.

That last point remains a presentation risk. ROE should be labelled **unrealised ROE** or suppressed where a retain-all case has no refinance or distribution. Showing it beside a 0.00x equity multiple can confuse a non-specialist investor.

### 6.4 Stored-record migration observation

The saved API record predates the current release and retains older top-level summary columns, while the authoritative nested outputs are current for the saved calculation version. The UI correctly uses authoritative outputs and migrates the case on load. This is no longer a live calculation defect, but stale legacy columns should be removed, clearly deprecated or backfilled so that downstream API consumers cannot select the wrong figure.

### 6.5 York case score

| Measure | Score | Underwriter view |
|---|---:|---|
| Appraisal Quality | **60 / 100** | Strong preliminary case, but key evidence and lender assumptions are incomplete |
| Financial Accuracy | **82 / 100** | Exact for the implemented scope; the principal limitations are missing scope and unconfirmed migrated data |
| Lender Readiness | **55 / 100** | Clear funding/repayment warnings, but no lender valuation, refinance or approved credit case |
| Conversion Risk Coverage | **38 / 100** | The specific title/use/building issues are not yet structured into underwriting data |
| Output Quality | **72 / 100** | Comprehensive draft memo with good disclosure, reduced by the export defect and missing provenance |

The property description refers to retail accommodation and upper parts sold on long leases/used as Airbnb, while the appraisal narrative also refers to an office/Class MA conversion. This potential title, possession and existing-use contradiction should create a hard information-required flag rather than remain in narrative text.

## 7. Detailed functional reassessment

### 7.1 Scheme facts, planning and title

Class MA/PDR context, Article 4, EPC and environmental screening continue to differentiate the product from a generic development model. The Deal Spider also applies a sensible higher-risk-building prompt based on height/storeys.

The underwriting file still needs structured fields for developer/SPV, jurisdiction, planning or prior-approval reference, decision and expiry dates, conditions, conservation/listed status, CIL/S106, title/rights/restrictions, vacant possession, leases/tenancies, rights of light, party wall and evidence source/date. The York source-data contradiction demonstrates why narrative fields are insufficient.

Higher-risk-building status is a legal and technical question. The application should retain its screening prompt but require competent confirmation against the current statutory criteria. Government guidance describes the design/construction threshold as at least 18 metres or at least seven storeys, with at least two residential units: [GOV.UK higher-risk building criteria](https://www.gov.uk/guidance/criteria-for-determining-whether-a-new-building-that-is-being-designed-and-constructed-is-a-higher-risk-building).

### 7.2 Areas and unit schedule

Unit-level NIA, value and rent are good foundations. The 25% mismatch warning is useful, but it does not replace an area bridge.

Add existing GIA, demolished/void, retained commercial, proposed GIA, residential NIA, saleable NIA, circulation/common parts, plant, storage, bin/cycle, amenity and external areas. Reconcile these and display NIA/GIA and saleable/developed efficiencies. Values for parking, balconies and terraces should be separate from internal saleable area.

### 7.3 GDV and lender valuation

Developer GDV remains unit-led and transparent. The Finance page now supports a lender valuation overlay and related metrics, which is a significant improvement. The York case correctly reports lender GDV as unavailable rather than silently adopting developer GDV.

For lender use, the overlay should be unit- or type-level where required, record valuer/date/basis/status and preserve a variance bridge. An edit to the developer case should mark the lender case stale and require a deliberate refresh or reapproval.

### 7.4 Acquisition and tax

Commercial SDLT continues to calculate correctly for England and Northern Ireland. A product marketed for the UK must add jurisdiction selection and apply the relevant regime; Scotland uses LBTT and Wales uses LTT. The territorial distinction is confirmed by the [GOV.UK SDLT overview](https://www.gov.uk/stamp-duty-land-tax/overview). Current non-residential SDLT bands should also remain maintained as versioned tax assumptions rather than hard-coded institutional knowledge; the current rates are summarised in [Budget 2025 Annex A](https://www.gov.uk/government/publications/budget-2025-overview-of-tax-legislation-and-rates-ootlar/annex-a-rates-and-allowances).

Add purchase VAT/TOGC, recoverability and timing; tenant surrender; deferred consideration/overage; business rates/holding costs; title insurance; valuation/QS/broker fees; and vendor finance. Each must flow to sources and uses and the monthly ledger.

### 7.5 Construction costs, contingency and fees

The headline rate × area model is now reliable, but remains a screening-level cost plan. It needs a mutually exclusive detailed mode covering enabling/strip-out/asbestos, structure, envelope, roof/windows, fire/acoustic/thermal, M&E/public health, drainage/utilities, lift, partitions, finishes, common parts and externals. Include QS source/date/status, fixed-price coverage, provisional sums, inflation and package exclusions.

Separate general contingency from existing-building and abnormal-risk contingency. Allow eligibility bases per package and show the base. Professional/statutory fees should support both fixed and percentage bases without double counting.

VAT must be a cash-flow input by cost line, with rate, recoverable proportion, reclaim timing and adviser-confirmed status. Conversion VAT treatment is fact-specific; the app is right not to assume a saving, but disclosure alone does not calculate the funding need. See [HMRC VAT Notice 708](https://www.gov.uk/guidance/buildings-and-construction-vat-notice-708).

### 7.6 Programme and cash flow

The added programme anchor, package curves and explicit monthly ledger are a major correction. Interest, fees, draws, equity and receipts are traceable month by month.

The programme should now be expanded into dated, dependent phases: acquisition, planning/prior approval, conditions, design, procurement, strip-out, construction, testing, building control/warranty, practical completion, marketing, unit completions, sales/refinance and maturity tail. Current construction/professional/statutory curves are not enough to assess planning, procurement, PC or exit slippage.

### 7.7 Finance, equity and cost to complete

The product now distinguishes facility, day-one advance, actual draws, fees, debt balance, peak debt, headroom, senior repayment and fixed-facility scenario outcomes. This is its largest improvement.

Cost-to-complete is currently an inception forecast. A monitoring case needs reporting date, original and current budget, certified/paid/committed cost to date, QS forecast to complete, remaining contingency, debt drawn, cash equity injected, remaining committed equity and variances. It must reconcile remaining uses with undrawn facility plus remaining cash equity.

Land/uplift/vendor/deferred sources can be recorded but are not currently modelled as funding, and pari passu is rejected. That is a safe limitation because the app warns rather than pretending. Before supporting these sources, define legal ranking, valuation basis, cash status, draw priority and lender eligibility. Add non-utilisation, extension, monitoring, valuation, legal and default fee mechanics where relevant.

### 7.8 Exit, sales and refinance

Sell, retain and blended routes now drive cash flow; aggregate phased sales and refinance by investment value/LTV are supported. The York retain-all case correctly leaves senior debt unpaid and returns unavailable.

Next, add unit-specific completion timing, sales-agent/legal costs by unit, deposits if relevant, bulk/investment-sale yield and NOI, operating costs, vacancy, stabilisation, refinance interest coverage/DSCR and refinance fees. A lender needs evidence that take-out debt can service and repay, not only that a percentage LTV is below a valuation.

### 7.9 Sensitivity and break-even

Fixed-facility scenarios, two-way matrices, tornado analysis, repayment warnings and break-even are now useful lender tools. The report clearly labels cases where senior debt is not repaid.

Standard lender buttons should include unit loss, saleable-area reduction, abnormal cost, slower sales absorption, delayed planning/PC, refinance yield expansion, lower refinance LTV and operating-cost/vacancy stress. At present the principal configurable levers are GDV, cost, timeline and rate.

The RLV is suitable as a screening residual but uses appraisal finance rather than re-solving finance at the residual price. The report discloses this; keep that disclosure until a circular or iterative residual calculation is introduced.

### 7.10 Risk and lender workflow

The free-form likelihood/impact/mitigation register is useful as a project log, but it is not an underwriting dashboard. Add evidence-led categories for Planning, Title/Occupation, Existing Building, Construction, Finance and Exit. Every issue should have red/amber/green/**unknown**, evidence, owner, due date, cost/programme impact and action. Unknown must never default to green.

Create distinct developer and lender snapshots. The lender case should lock lender GDV, cost/programme adjustments, approved facility and credit conditions; changes to the developer case should make it stale rather than silently updating it. Add reviewer, approval state, timestamp and change log.

## 8. UX and workflow review

The live application is clear and substantially more professional than the first-review code implied. The persistent reconciliation/status strips are particularly effective: users can see sources versus uses, facility sufficiency, outstanding debt and report safety without interpreting a raw schedule.

Remaining UX priorities:

1. Move Programme and Exit before Cashflow/Appraisal because their assumptions drive the result.
2. Group thirteen equal tabs into Input, Funding, Exit, Underwriting and Output stages.
3. Add autosave/version status or explain manual-save behaviour prominently.
4. Use compact grids for unit, cost, evidence and risk schedules.
5. Distinguish user input, derived value, migrated/unconfirmed value and lender override consistently.
6. Add a completion/evidence checklist rather than relying only on warning banners.
7. Keep the Deal Spider secondary to numerical reconciliation and evidence-led risk.

## 9. Exported investment memo review

### What works

The generated memorandum is a credible 13-page draft structure covering executive summary, scheme, unit schedule, costs, programme/cash flow, sources and uses, lending metrics, returns, risk, scenarios, tornado/matrices, exit and assumptions/information required. It clearly states that lender valuation is unavailable, refinance is not modelled, retain profit is unrealised and further information is required. The **DRAFT** watermark appears throughout.

### Defects and risks

- **Release-blocking layout defect:** page 8 contains a giant clipped “Information Required” text string across the top, overlapping page content and the watermark.
- Page 11 is almost blank except for a small contingent-exit section, indicating weak pagination.
- The memo does not visibly state calculation version, input version, server result hash or audit hash.
- “DescriptionThe…” appears without a separating space on the property description page.
- Export copy claims a “full cost plan” although the current model is headline-level.
- The export page says the report is suitable for equity investors and senior debt funders; that should be qualified as a draft appraisal until report-safe and approved.
- The PDF is not tagged for accessibility, and rendering reports a missing Symbol display font.
- ROE is displayed without an “unrealised” qualifier even though no equity cash return exists.

### Required report release gate

Before external issue, automated report QA should assert:

- no content overflows page bounds;
- no orphan or effectively blank pages;
- every figure reconciles to authoritative model outputs;
- report-safe status and DRAFT/FINAL state are correct;
- calculation/input versions, hashes, generation time and scenario identity are printed;
- lender valuation and unconfirmed inputs are visibly identified;
- claims about cost-plan completeness match the actual input mode.

## 10. Current versus ideal product

| Area | Current product after updates | Ideal lender-ready product | Priority |
|---|---|---|---|
| Calculation authority | Server-authoritative, versioned monthly engine | Preserve; add approved model governance and external golden-case sign-off | P1 |
| Funding | Facility, debt ledger, fees, repayment and fixed downside | Add wider fee structures, funding sources and controlled credit approval | P1 |
| Cost to complete | Inception forecast | Live monitoring statement with actual/committed/QS forecast and equity injected | P1 |
| Areas | Unit NIA plus construction-area warning | Full GIA/NIA/saleable/common-area bridge and efficiency policy | P1 |
| Costs | Headline rate and allowances | Exclusive headline/detailed QS modes, packages, provisional sums and VAT | P1 |
| Conversion risk | Class MA context and free-form risks | Evidence-led technical/title/building dashboard with unknown status | P1 |
| Programme | Anchor and cost curves | Dated dependent planning-to-exit programme | P1 |
| Exit/refinance | Sell/retain/blended, phasing and LTV refinance | Unit sales, NOI/yield, vacancy/opex, DSCR/ICR and refinance stress | P1 |
| Tax | Commercial SDLT for England/NI | Jurisdiction-aware SDLT/LBTT/LTT and VAT/TOGC cash flow | P1 |
| Reporting | Rich draft memo and report-safety controls | Layout-safe, provenance-rich, approved developer/lender reports | **P0 for export** |
| Workflow | Thirteen clear tabs | Grouped/gated workflow with evidence completion and controlled snapshots | P2 |

## 11. Prioritised improvement register

| Priority | Problem | Required change | Underwriting benefit |
|---:|---|---|---|
| **P0** | PDF page overflow can make an external report unusable | Fix page 8 overflow; add page-bound and sparse-page regression checks | Prevents issuing a visibly defective credit document |
| **P1** | No complete conversion evidence/risk schedule | Structured building, planning, title, occupation and technical RAG/unknown dashboard | Makes conversion risk reviewable and actionable |
| **P1** | No area bridge | Reconciled existing/proposed GIA, NIA, saleable and common/plant/external areas | Protects both cost and GDV bases |
| **P1** | Cost model is still headline-only | Exclusive detailed QS package mode, provisional sums, fixed-price coverage and reconciliation | Supports QS review and realistic contingency |
| **P1** | VAT and TOGC are disclosure-only | Line-level VAT/recovery/timing plus adviser confirmation | Prevents a tax-driven funding shortfall |
| **P1** | No controlled lender case | Locked lender snapshot, approval, reviewer, stale-state and change log | Creates genuine underwriting governance |
| **P1** | CTC is not a monitoring statement | Add reporting-date actual, paid, committed, forecast and equity-injected data | Supports drawdown monitoring and shortfall detection |
| **P1** | Programme lacks full development dependencies | Add dated planning/design/procurement/construction/PC/exit schedule | Makes interest, maturity and delay credible |
| **P1** | Refinance underwriting is thin | Add NOI, yield, vacancy/opex, DSCR/ICR, fees and stress | Demonstrates repayment capacity, not just valuation leverage |
| **P1** | Standard sensitivities omit conversion/exit risks | Add area/unit/abnormal/sales/refi stress presets | Improves lender downside testing |
| **P1** | UK label exceeds tax coverage | Add jurisdiction and SDLT/LBTT/LTT basis | Prevents incorrect acquisition tax outside England/NI |
| **P1** | Report lacks visible provenance | Print model/input versions, hashes, scenario, timestamp and approval state | Enables traceability and review |
| **P2** | Thirteen-tab workflow is long | Reorder and group stages; add completion/evidence status | Speeds entry and review |
| **P2** | Export wording overstates completeness | Qualify “full cost plan” and lender-suitability claims | Avoids false confidence |
| **P2** | Main bundle is large | Lazy-load PDF/maps/charts and split vendor chunks | Faster loading and cleaner release build |
| **P2** | PDF is not tagged and has a font warning | Embed fonts and produce an accessible tagged document | Improves professional and accessibility quality |
| **P2** | Legacy stored columns can mislead API consumers | Deprecate/backfill/remove or expose one canonical output contract | Prevents stale-data use outside the UI |

## 12. Five highest-leverage next changes

1. **Build the complete conversion underwriting schedule:** scheme facts, area bridge, title/occupation, surveys, fire/acoustic/thermal, structure, fabric, M&E, drainage/utilities and evidence-led RAG/unknown risks.
2. **Add QS-grade cost and VAT modes:** headline versus detailed packages, provisional sums, fixed-price coverage, abnormal contingency, VAT rate/recovery/timing and reconciliation.
3. **Create a true lender workflow:** controlled lender snapshot, lender valuation/cost/programme overrides, credit conditions, reviewer/approval, stale-case control and live monitoring CTC.
4. **Deepen exit and refinance underwriting:** unit sales timing, bulk/yield route, NOI, vacancy/opex, DSCR/ICR, fees and standard sales/refinance downside cases.
5. **Harden report production:** fix overflow/pagination, add automated visual QA, print full calculation provenance and qualify investor/lender suitability and unrealised returns.

## 13. Final scorecard

| Measure | Previous | Revised |
|---|---:|---:|
| Overall App | 38 / 100 | **69 / 100** |
| Financial Model | 3 / 10 | **8 / 10** |
| Development Finance Logic | 2 / 10 | **8 / 10** |
| Conversion-Specific Logic | 4 / 10 | **5 / 10** |
| Cost Modelling | 4 / 10 | **5 / 10** |
| Finance Modelling | 2 / 10 | **8 / 10** |
| Risk Analysis | 4 / 10 | **6 / 10** |
| UX | 6 / 10 | **7 / 10** |
| Reporting | 5 / 10 | **7 / 10** |
| Professional Credibility | 4 / 10 | **7 / 10** |
| Commercial Potential | 7 / 10 | **8 / 10** |

### Five strongest features after the updates

1. A single server-authoritative monthly model with exact debt and source/use reconciliation.
2. Fixed-facility downside testing, senior repayment flags, break-even and CTC outputs.
3. Strong validation, versioning, migration warnings, hashes and report-safety governance.
4. Broad automated regression coverage with 1,639 passing tests across frontend and backend.
5. A clear, professional and unusually comprehensive appraisal/report workflow for this product stage.

### Five largest remaining weaknesses

1. Conversion building, title, survey, area and evidence detail is too shallow for underwriting.
2. Headline costs and disclosure-only VAT are insufficient for lender/QS reliance.
3. There is no controlled lender approval case or live monitoring CTC workflow.
4. Exit/refinance operating and sales detail is not yet sufficient to prove take-out capacity.
5. The report export has a material layout defect and lacks visible calculation provenance.

## Final answer to the core review question

**Not yet, but the position has changed materially.** A competent UK development finance lender should no longer need to rebuild the basic debt, interest, funding, exit, sources-and-uses and downside calculations to understand the preliminary case. Those core mechanics are now coherent, traceable and independently reconciled.

The lender would still need to build or verify the detailed cost plan, VAT position, area schedule, technical/conversion due diligence, legal/title/occupation position, lender valuation, full programme, operating/refinance case and credit conditions. The app should therefore be positioned as a **professional preliminary development appraisal and underwriting aid**, not yet as a complete lender-reliance or Credit Committee system.
