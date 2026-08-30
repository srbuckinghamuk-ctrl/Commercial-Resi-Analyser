# Commercial-Resi-Analyser — Third UK Development Finance and Lender-Readiness Audit

**Review date:** 30 August 2026  
**First-review score:** 38 / 100  
**Second-review score:** 69 / 100  
**Third-review score:** **86 / 100 — underwriting-capable model; production lender reliance remains conditional**  
**Movement since second review:** **+17 points**  
**Movement since first review:** **+48 points**

## 1. Executive conclusion

The product has undergone a second substantial transformation. Releases 8 through 16b have closed most of the data-depth and underwriting-workflow gaps identified in the second audit. The application now includes jurisdiction-aware acquisition tax, an area bridge, detailed QS-style cost-plan mode, line-level VAT and TOGC assumptions, a dated precedence-network programme, operating and refinance underwriting, unit-level sales, a monitoring cost-to-complete statement, controlled lender snapshots, a structured evidence schedule, cost-plan timing and inflation, a standard lender stress pack, grouped navigation and code splitting.

The financial model itself is now suitable for professional underwriting work within its stated scope. Independent third-review calculations agreed with the model for acquisition tax, the area bridge, detailed costs and contingencies, quarterly VAT carry, stabilised NOI, investment value, LTV/DSCR/ICR take-out sizing, monitoring CTC and package-level tender inflation. Frontend and backend fixture suites continue to agree to the penny.

The quality gates are unusually strong for this product stage:

- **3,728 frontend tests passed** across 86 files;
- **3,061 backend tests passed** after rebuilding the current Docker image;
- lint passed;
- TypeScript and production build passed;
- the static entry closure is now **460.8 kB**, below its 500 kB release gate;
- the generated York investment memorandum rendered cleanly across all 16 physical pages.

The product should now be described as an **underwriting-capable development appraisal platform** rather than merely a preliminary calculator. It can support a developer, broker or lender analyst through a detailed initial underwriting and monitoring exercise.

It is not yet a production Credit Committee system for institutional reliance. The principal remaining blocker is no longer financial arithmetic: it is identity, authority and operational control. Lender-case transitions currently accept a free-text actor name; there is no authenticated user, role-based permission or independent approval authority. A user can therefore claim to be the reviewer or decision-maker. The state machine and hashes are technically strong, but the identity attached to them is not trustworthy.

Other important gaps remain:

- the proposed BCIS elemental cost lookup has not been implemented;
- the actual York appraisal has not been re-saved or completed under the new schema and remains a migrated, unconfirmed draft;
- source-conflict automation is limited and cannot interpret the York narrative/title contradiction;
- the cost inflation model uses a flat annual rate rather than a dated BCIS-style index series;
- construction VAT recovery remains an entered proportion rather than a computed partial-exemption model;
- PDF/UA tagging and automated raster visual regression remain open;
- tax reliefs, linked transactions, lease NPV and other specialist acquisition-tax cases remain outside the model and rely on a reasoned override.

**Core conclusion:** the calculation engine is lender-grade for its implemented scope. The surrounding platform becomes lender-reliance grade only after authenticated roles, approval permissions, deployment controls and the remaining evidence/data integrations are added.

## 2. Scope and evidence

This review covered:

- all changes since the 17 August 2026 second audit;
- input schemas v5 through v16 and calculation versions 2.7.0 through 2.18.0;
- both TypeScript and Python financial engines;
- jurisdictional acquisition tax and statutory-table versioning;
- area reconciliation and unit ancillary value;
- headline and detailed cost plans, contingencies, fees, QS provenance and inflation;
- VAT/TOGC, repayment cycles and VAT funding carry;
- the dated programme network, cash flow, debt ledger and cost timing;
- sell, retain, blended, unit-sale and investment/refinance cases;
- lender valuation, break-even, fixed-facility sensitivity and standard stress pack;
- monitoring CTC and lender-case governance;
- due-diligence evidence, source conflicts and report-safety gates;
- the live local UI, API and database-backed York appraisal;
- the current generated York investment memorandum, rendered page by page;
- frontend/backend tests, lint and production build;
- independent calculations across representative golden cases.

The review considered both **product capability** and **the readiness of the actual York case**. These are not the same. A strong platform should refuse to make an incomplete project appear lender-ready; the updated application now largely does so.

## 3. Quality-gate results

| Gate | Third-review result | Assessment |
|---|---:|---|
| Frontend tests | **3,728 passed / 86 files** | Excellent breadth, including migrations, UI, report QA and model parity |
| Backend tests | **3,061 passed** | Excellent model, API, migration and governance coverage |
| Backend warnings | **50** | Non-blocking Starlette/httpx and naive-UTC deprecations; should be retired |
| ESLint | **Passed** | Clean |
| TypeScript/build | **Passed** | Clean production build |
| Entry static closure | **460.8 kB / 500 kB gate** | Previous large-entry-bundle finding resolved |
| API health | **OK; migrations current** | Database schema is current |
| Generated memorandum | **16 physical pages, visually reviewed** | Previous overflow and sparse-page defects resolved |

The first backend run used an old Docker image and produced two failures and 78 setup errors because `aiosqlite`, already declared in the current development dependencies, was missing from that stale image. Rebuilding from the current Dockerfile produced **3,061/3,061 passes**. This is not a calculation defect, but release/deployment instructions should use immutable image tags or an explicit rebuild so a stale local image cannot masquerade as a failed release.

## 4. Revised weighted product score

| Category | First | Second | Third | Weight | Third-review assessment |
|---|---:|---:|---:|---:|---|
| Financial Modelling Accuracy | 7 | 16 | **19** | 20 | Exact independent agreement across legacy and new model layers; one authoritative model; strong parity and migration gates. Specialist tax/VAT cases remain disclosed limitations. |
| Development Finance / Lender Relevance | 4 | 11 | **13** | Facility, debt, repayment, take-out, monitoring CTC and lender cases are strong. Unauthenticated approval identity prevents institutional reliance. |
| Commercial-to-Residential Specificity | 6 | 7 | **12** | Area bridge, conversion cost packages, VAT, technical/title evidence and source conflicts are material improvements. Some building/fabric detail and automated conflict interpretation remain limited. |
| Input Structure & Assumptions | 4 | 6 | **9** | Typed v16 schema, explicit bases, evidence status, migrations and grouped stages are strong. Some scheme facts remain catalogue/evidence entries rather than a reusable structured facts block. |
| Development Cost Modelling | 4 | 5 | **8** | Detailed packages, contingency classes, fee bases, QS provenance, price basis, inflation and eligibility are credible. No BCIS lookup or dated index table. |
| Finance & Debt Modelling | 2 | 8 | **9** | Monthly senior ledger, unit sales, take-out constraints, CTC and monitoring are lender-relevant. Multi-tranche/intercreditor and some fee structures remain outside scope. |
| Sensitivity / Risk Analysis | 2 | 4 | **5** | Nine standard lender stresses, thirteen levers, fixed facility, cell validity, risk crystallisation and clear inapplicability. |
| UX & Workflow | 3 | 4 | **4** | Grouped stages, URL routes, page badges and exit-before-appraisal are strong. Sixteen pages remain dense; some status language and migrated-case presentation are confusing. |
| Output / Reporting Quality | 3 | 4 | **4** | Visually clean, provenance-rich and correctly draft-controlled. PDF/UA and raster regression remain open, with minor label inconsistencies. |
| Overall Product Quality | 3 | 4 | **3** | Exceptional test/model governance, but no authentication/RBAC is a material production-platform limitation. |
| **Total** | **38** | **69** | **86** | **100** | **The model is underwriting-capable; production lender reliance remains conditional.** |

## 5. Second-audit recommendation closure

| Second-audit recommendation | Status | Third-review evidence |
|---|---|---|
| Fix report overflow and pagination | **Resolved** | Current 16-page memo has no clipped heading, overlap or effectively blank page |
| Add report provenance | **Resolved** | Report prints appraisal/project/scenario, schema, calc version, hashes, timestamp, report status, lender-case status and tax basis |
| Add area bridge | **Resolved** | Existing/proposed/developed/saleable/non-saleable area reconciliation and efficiency metrics implemented |
| Add detailed QS cost-plan mode | **Resolved materially** | Exclusive headline/detailed modes, packages, fee bases, contingencies, QS provenance and price-basis summary |
| Add VAT and TOGC cash flow | **Resolved materially** | Line/category treatment, purchase VAT, return frequency, reclaim lag, irrecoverable VAT and carry interest implemented |
| Add dated dependent programme | **Resolved** | Precedence network, anchors, curves, critical path, float and programme-linked exits implemented |
| Add controlled lender case | **Resolved technically; production control open** | Locked snapshots, staleness, status machine, case hash and append-only events exist; authenticated identity does not |
| Add monitoring CTC | **Resolved** | Original/current/certified/paid/committed/forecast schedule and remaining funding reconciliation implemented |
| Expand exit/refinance | **Resolved materially** | Unit sales, deposits, NOI, yield, vacancy/opex, take-out LTV/DSCR/ICR, fees and binding constraint implemented |
| Add standard conversion/lender stresses | **Resolved** | Closed nine-stress pack plus thirteen scenario levers and explicit inapplicability |
| Add evidence-led conversion risk | **Resolved materially** | 28-code catalogue, custom items, RAG/unknown/N/A, owner/evidence/dates/impacts/actions and FINAL gate |
| Add jurisdictional taxes | **Resolved for principal freehold/premium cases** | SDLT/LBTT/LTT and versioned date-based tables implemented; specialist relief/lease cases remain excluded |
| Reorder/group workflow | **Resolved** | Five stages and sixteen URL-routed pages; Exit now precedes Appraisal |
| Split bundle | **Resolved** | Static entry closure is 460.8 kB and protected by a build gate |
| Remove legacy output duplication | **Resolved** | Seven summary columns dropped; `outputs.metrics` is canonical |
| Add BCIS elemental cost lookup | **Not implemented** | No BCIS provider, import, benchmark, location factor or index lookup is present |

## 6. Independent recalculation of new model features

The following figures were recalculated independently from the stated inputs and compared with the engine outputs.

### 6.1 Jurisdictional acquisition tax

For consideration of **£753,482**:

| Regime | Independent calculation | Result | Engine |
|---|---|---:|---:|
| England/NI SDLT | 2% × £100,000 + 5% × £503,482 | **£27,174.10** | Exact |
| Scotland LBTT | 1% × £100,000 + 5% × £503,482 | **£26,174.10** | Exact |
| Wales LTT | 1% × £25,000 + 5% × £503,482 | **£25,424.10** | Exact |

The current non-residential bands agree with the official [GOV.UK SDLT rates](https://www.gov.uk/government/publications/budget-2025-overview-of-tax-legislation-and-rates-ootlar/annex-a-rates-and-allowances), [Welsh Government LTT rates](https://www.gov.wales/land-transaction-tax-rates-and-bands) and [Revenue Scotland LBTT rates](https://revenue.scot/taxes/land-buildings-transaction-tax/non-residential-property).

The engine correctly uses a date and table version, and the report keeps an unconfirmed jurisdiction in DRAFT. It does not model linked transactions, reliefs, lease rent NPV or transitional contract rules except through an evidenced manual override; this is appropriately disclosed.

### 6.2 Area bridge and construction basis

Fixture N independently reconciles:

```
proposed GIA       = 600 - 20 + 40       = 620 m²
developed GIA      = 620 - 100           = 520 m²
available for units= 520 - 62 - 18 - 14 - 6 = 420 m²
unit NIA           = 4 × 60 + 2 × 70     = 380 m²
unallocated        = 420 - 380           = 40 m²
NIA/developed GIA  = 380 / 520           = 73.08%
```

Construction uses the derived **520 m²**, not the deliberately conflicting 380 m² manual input:

```
520 × £1,050/m² × 1.10 = £600,600.00
```

The engine matched every area and cost figure exactly.

### 6.3 Detailed cost plan

Fixture Q:

- five packages: **£470,000 base build**;
- general contingency: 5% of £470,000 = **£23,500**;
- existing-building contingency: 15% of £230,000 = **£34,500**;
- abnormal contingency: 8% of £30,000 = **£2,400**;
- total contingency: **£60,400**;
- construction total: **£530,400**;
- professional fees: 6% of base build + 1.5% of construction total + fixed fees = **£50,156**.

All figures matched the engine. Bases are separate and do not recursively include other fees.

### 6.4 VAT return cycle

Fixture R independently produces VAT carry by ledger month:

```
£100,000, £150,000, £200,000, £50,000, £100,000, £100,000, £0
```

The model correctly:

- adds purchase VAT to acquisition-tax consideration where configured;
- applies construction VAT monthly;
- reclaims quarterly after the entered lag;
- treats recoverable VAT as profit-neutral but funding-relevant;
- calculates interest on the VAT carry;
- reports VAT receivable beyond maturity rather than inventing an in-term receipt.

HMRC confirms that conversion VAT treatment is conditional and that qualifying conversion services may be reduced-rated while other works may require different treatment: [VAT Notice 708](https://www.gov.uk/guidance/buildings-and-construction-vat-notice-708). The app correctly requires an entered basis rather than presenting 5% as universally applicable.

### 6.5 Investment case and take-out sizing

Fixture U has five units at £590/month:

```
annual gross rent            = 5 × £590 × 12 = £35,400.00
effective gross at 96%       = £33,984.00
less management 10%         = £3,398.40
less reletting 2%            = £679.68
less insurance              = £3,000.00
less compliance             = £960.00
annual NOI                  = £25,945.92
investment value at 7.5%
  after 6.75% purchasers cost= £324,070.82
LTV cap at 55%               = £178,238.95
DSCR cap at 1.30x            = £258,140.05
ICR cap at 1.30x and 6%      = £332,640.00
```

The LTV constraint correctly binds at **£178,238.95**. All independent figures match the engine.

### 6.6 Monitoring CTC

Fixture W independently reconciles:

- estimated final monitored cost: **£275,200**;
- remaining category cost: **£49,300**;
- forecast finance to completion: **£13,449.22**;
- remaining uses: **£62,749.22**;
- undrawn net facility: **£75,000**;
- remaining interest reserve: **£8,761.29**;
- remaining cash equity: **£80,000**;
- total remaining funding: **£163,761.29**;
- monitoring surplus: **£101,012.07**;
- shortfall: **£0**.

This is now a credible monitoring statement rather than the inception-only CTC criticised in the second audit.

### 6.7 Package timing and tender inflation

Fixture Z independently applies 6% annual compound inflation from the QS base date to each package’s curve-weighted spend midpoint:

| Package | Inflation |
|---|---:|
| Enabling | £3,754.60 |
| Structure | £20,020.03 |
| Envelope | £15,015.02 |
| M&E | £11,172.56 |
| Externals | £5,005.01 |
| **Total** | **£54,967.22** |

The engine matches exactly and correctly sums rounded package figures. This is strong. The remaining gap is that the annual rate is entered manually rather than selected from a dated BCIS tender-price index series.

## 7. Live York appraisal — current readiness

### 7.1 The platform correctly refuses reliance

The York appraisal still calculates the familiar figures:

| Metric | Current migrated run |
|---|---:|
| Developer GDV | £1,250,000 |
| Cost before finance | £753,482 |
| Finance cost | £11,424.30 |
| Total development cost | £764,906.30 |
| Unrealised profit | £485,093.70 |
| Profit on cost | 63.42% |
| Peak debt | £11,424.30 |
| Equity contributed | £753,482 |

The app correctly marks it **DRAFT — UNRECONCILED — NOT FOR LENDER RELIANCE** because:

- the saved row is still inputs v3 / calculation 2.1.0 and has not been re-saved under v16 / 2.18.0;
- the stored audit hash is null;
- the tax jurisdiction is a migrated England/NI default and unconfirmed;
- VAT is switched off despite a non-zero construction cost;
- the area bridge is blank, producing 0 m² available against 252 m² unit NIA;
- facility terms are migrated and unconfirmed;
- the single equity source is unconfirmed;
- all 23 entered due-diligence items remain unknown;
- no lender valuation exists;
- no investment case or refinance exists;
- no unit-sales ledger exists;
- senior debt remains outstanding at maturity;
- no lender case exists.

This is a positive product result: the platform no longer allows an attractive margin to conceal missing underwriting evidence.

### 7.2 Source-data problem remains unresolved in the case

The live project record still stores:

> DescriptionThe property comprises a three storey building arranged as ground floor and basement retail accommodation. The upper parts are sold off on long lease ... and operated as Airbnb accommodation.

The structured project use remains `office`, while the description says retail at ground/basement and long-leased Airbnb above. The new due-diligence page displays this text, but no structured source record has been captured and the automated source-conflict checks therefore do not run. The adapter spacing fix protects future imports but has not repaired this existing stored record.

Before lender use, the York case must establish precisely what interest is being acquired, which areas are included, the lawful existing uses, whether the upper parts are excluded or acquired, and how vacant possession will be delivered.

### 7.3 Actual York case score

| Measure | Score | Underwriter view |
|---|---:|---|
| Financial Accuracy | **82 / 100** | The migrated numerical run remains exact, but it has not been re-saved under the current governed model |
| Appraisal Completeness | **48 / 100** | New sections exist but are mostly blank or migrated defaults |
| Lender Readiness | **25 / 100** | No valuation, verified funding terms, repayment source, lender case or approval |
| Conversion Risk Coverage | **18 / 100** | 0/23 entered items addressed; source/title/use contradiction unresolved |
| Output Quality | **80 / 100** | Excellent draft disclosure and clean layout; correctly refuses reliance |

The low York case score does not reduce the product-capability score. It demonstrates that the product distinguishes a complete model from an incomplete deal file.

## 8. Detailed product review

### 8.1 Areas, units and value

The area bridge is coherent and prevents silent use of unit NIA as GIA. Ancillary balcony/terrace and parking values are separately modelled and follow sold/retained units through blended exits. Developer and lender GDV remain separate, with reason/author/date provenance.

Remaining improvements:

- add measured-survey import or structured area-schedule upload;
- add unit-floor/aspect/condition adjustments and comparable evidence as structured rows;
- add automatic contradiction checks between listing, measured survey, valuation and appraisal areas;
- display developer-versus-lender unit-level value variance, not only the total bridge.

### 8.2 Costs and BCIS

The detailed cost plan is now credible for QS-led entry. It supports packages, contingency classes, fixed/estimated/provisional price bases, fixed and percentage fees, programme phases, VAT overrides, lender eligibility, QS source/stage/date/status and package-level inflation.

The BCIS feature discussed after the second audit is absent. No code or UI exists for:

- BCIS CapX/data-licence integration;
- elemental benchmark import;
- building-function and work-type selection;
- BCIS location factors;
- dated BCIS tender-price indices;
- benchmark quartiles/sample counts;
- developer/QS/lender-versus-BCIS comparison;
- licensed XML/CSV/manual import with provenance.

This should remain a benchmark layer, not an automatic replacement of the QS plan. A compliant implementation must respect BCIS subscription and data-redistribution terms and must never scrape licensed content.

### 8.3 VAT and acquisition tax

The current model is materially better than disclosure-only VAT. It correctly separates tax from profit, cash funding and reclaim timing. It also supports purchase VAT and TOGC assumptions.

Limitations are disclosed and acceptable for this stage:

- partial exemption is an entered recovery proportion, not a computed method;
- capital-goods-scheme, option-to-tax revocation and self-supply are not modelled;
- tax advice remains necessary;
- acquisition-tax reliefs, linked transactions and lease-rent charges require override.

### 8.4 Programme and cost timing

The precedence network, milestones, phase anchors, slips, critical path and float represent a major improvement. Costs and exits can attach to phases, and package inflation uses the curve-weighted spend midpoint.

The UI should make the difference between ledger index and human programme month more explicit. The York memo states peak debt is reached in “month 12” while its monthly table peaks on the row labelled “Month 11”. This appears to be one-based narrative versus zero-based ledger labelling, but a lender should not have to infer that convention.

### 8.5 Finance, unit sales and take-out

The senior ledger is mature. It handles day-one advance, net/gross facility, reserve, advance caps, fees, interest, draw priority, unit receipts, deposits, sales sweeps, NOI, refinance, repayment, distributions and funding gaps.

The investment case adds genuine lender relevance: stabilised occupancy, operating costs, yield valuation and a take-out constrained by LTV, DSCR and ICR. The unit-sales ledger supports per-unit dates and costs.

Remaining lender-product scope includes:

- multiple senior/mezzanine tranches;
- intercreditor waterfalls;
- non-utilisation, extension and default fee schedules;
- hedge/base-rate floors and changing reference rates;
- formal covenant testing through time;
- portfolio and borrower-level exposure;
- importing a lender term sheet rather than rekeying terms.

### 8.6 Monitoring CTC

The monitoring statement now carries the essential categories and funding reconciliation. It is a credible draw-monitoring basis.

For institutional use, add:

- QS certificate and draw-request attachment references;
- prior-report comparison;
- approved variation register;
- committed-contract schedule;
- contingency movement log;
- automatic reconciliation to the current cost plan and actual ledger;
- lender approval/rejection of the draw;
- exportable monitoring report separate from the initial investment memo.

### 8.7 Due diligence and risk

The evidence schedule is one of the strongest additions. Unknown does not become green, evidenced green is enforced, cost/programme impacts can feed a risk-crystallisation stress, and outstanding evidence gates FINAL reporting.

Limitations:

- the fixed catalogue is broad but combines some risks that a surveyor/lender may want separately—for example roof, façade/windows, drainage, incoming utilities, lift and access;
- source-conflict rules currently cover structured occupation and area only;
- narrative contradictions are deliberately not parsed;
- attachment storage, evidence-file hashes and document expiry notifications are absent;
- the free-form risk register remains separate from the evidence schedule, with no deduplication.

### 8.8 Sensitivity

The standard lender stress pack is comprehensive and honest. Inapplicable stresses remain visible with a reason rather than disappearing. Scenario cells validate the stressed document and never grant unapproved debt.

One presentation detail should be improved: the row headed “Refinance LTV -10 pp” displays “Refinance LTV +10.0 pp” because positive is defined as the adverse reduction. The method note explains the sign convention, but the setting should say “LTV cap reduced by 10.0 pp” to eliminate ambiguity.

## 9. Lender-case governance and production control

### What works

- a lender case locks the entire input snapshot and all provenance hashes;
- staleness is derived against the live appraisal;
- only one live case is enforced at database level;
- transitions are server-enforced;
- conditions are allowed only with the correct approval state;
- changes produce append-only events;
- compare-and-swap prevents concurrent transition races;
- FINAL is defeated by stale or unapproved cases.

### Production blocker

The API accepts `created_by` and transition `actor` as free-text claims. The code expressly states that the product has no authentication. There is therefore no proof that:

- the submitter is the sponsor or authorised broker;
- the reviewer is a lender underwriter;
- the decision-maker has Credit Committee authority;
- one person did not submit, review and approve their own case;
- an event was not created under somebody else’s name.

Before institutional deployment, add:

1. authenticated user identities;
2. organisation/tenant separation;
3. role-based permissions;
4. maker-checker separation;
5. approval limits and delegation;
6. immutable user IDs alongside display names;
7. session and API security;
8. access/audit logging;
9. evidence-file permissions;
10. backup, retention and disaster-recovery controls.

Until then, the lender state machine is a strong workflow prototype, not an enforceable credit-approval system.

## 10. UX review

The five-stage grouping is much clearer than the previous thirteen equal tabs. URL-routed pages preserve state and allow direct navigation. Page badges now indicate validation ownership, and the due-diligence badge shows assessed progress.

Remaining UX issues:

- sixteen pages are still dense for small-screen or occasional users;
- the York area page shows negative 252 m² unallocated rather than leading with a concise “area schedule not entered” call to action;
- “Draft — unreconciled” is repeated on every page without a direct jump to the blocking issues;
- migrated cases require several confirmations but lack one migration-completion wizard;
- the Investor page still labels “Return on Equity” without “unrealised”, although the PDF correctly qualifies it;
- Project Detail also shows unqualified ROE;
- the due-diligence page is long and should support filtering, collapsing, bulk ownership and evidence upload;
- manual save remains a risk for long underwriting sessions despite route-safe local state.

## 11. Investment memorandum review

### Resolved since the second audit

- the page-8 overflow is gone;
- no effectively blank page remains;
- the “DescriptionThe” concatenation is not present in the PDF narrative;
- report copy now says “headline cost estimate” where appropriate;
- lender suitability is appropriately qualified;
- unrealised profit and ROE are labelled in the memo;
- provenance appears on the first numbered page;
- DRAFT watermarking is prominent and consistent;
- all monetary figures reconcile to the authoritative current run;
- limitations are unusually candid and useful.

### Remaining report issues

- the PDF is not tagged for PDF/UA accessibility;
- raster visual regression remains outside the automated gate;
- peak-debt month uses inconsistent zero-/one-based labels between narrative and table;
- the report has no evidence attachments or appendix-file hashes;
- the current York memo necessarily prints that the audit hash is not recorded because the appraisal has not been re-saved;
- the stress setting “Refinance LTV +10 pp” is semantically adverse but visually conflicts with the “-10 pp” stress name;
- a separate monitoring report and concise lender Credit Paper would be more appropriate than making one investment memorandum serve every purpose.

The current report is suitable for sponsor and preliminary lender review exactly as its export page states. It should become FINAL only after a current, report-safe, approved and authenticated lender case exists.

## 12. Prioritised improvement register

| Priority | Problem | Required change | Benefit |
|---:|---|---|---|
| **P0** | Lender approvals use self-declared actor names | Authentication, tenant isolation, RBAC, maker-checker rules and immutable user identity | Makes approval and audit history institutionally meaningful |
| **P0** | Actual saved appraisals can remain on old versions indefinitely | Add governed migration/resave workflow and portfolio-level stale-version dashboard | Prevents current reports relying on transient migration of obsolete records |
| **P1** | BCIS lookup not implemented | Licensed provider/import abstraction, elemental £/m² benchmarks, location/date factors and variance analysis | Adds independent cost benchmarking without replacing QS judgement |
| **P1** | Flat annual tender inflation | Add versioned dated index series and package-specific index selection | Better tender-price forecasting and auditability |
| **P1** | Evidence is text-only | Add secure attachments, hashes, expiry alerts and document permissions | Connects underwriting assertions to actual evidence |
| **P1** | Source conflicts are narrow | Expand structured scheme/title/use/tenure capture and cross-source rules | Identifies title, occupation and use contradictions automatically |
| **P1** | No maker-checker draw monitoring | Add draw submission, QS review, lender approval and prior-report movements | Converts monitoring CTC into a controlled draw workflow |
| **P1** | No dedicated credit paper | Produce a concise controlled lender paper and separate monitoring report | Better lender decision and servicing outputs |
| **P1** | Specialist tax cases rely on override | Add linked transaction, relief and lease-premium/rent modules where commercially justified | Reduces manual tax work while preserving adviser confirmation |
| **P2** | Migrated-case completion is fragmented | Add a guided migration checklist with one-click navigation to every blocker | Faster conversion of legacy appraisals to current governed cases |
| **P2** | ROE is unqualified on two UI pages | Label unrealised ROE consistently or suppress it until a realisation event | Prevents investor misunderstanding |
| **P2** | Month numbering is inconsistent | Use a single programme-month convention or print both ledger index and calendar month | Eliminates timing ambiguity |
| **P2** | Stress sign label is confusing | Print “LTV cap reduced by 10 pp” | Removes avoidable interpretation risk |
| **P2** | PDF accessibility incomplete | Add PDF/UA structure tree, tagged tables/headings and embedded fonts | Improves accessibility and institutional document quality |
| **P2** | No raster regression | Add image-diff baselines for representative reports | Protects against visual defects not caught by geometry checks |
| **P2** | Stale Docker images can mislead local QA | Use immutable tags and explicit build/test commands in CI/release instructions | Reproducible release evidence |
| **P3** | No portfolio exposure | Add borrower, sponsor, geography, contractor and exit concentration reporting | Supports lender portfolio management |

## 13. Five highest-leverage next changes

1. **Add authenticated lender governance:** identity, organisations, permissions, maker-checker separation and approval limits.
2. **Implement licensed BCIS benchmarking:** elemental rates, comparable filters, location/date adjustments, provenance and developer/QS/lender variance.
3. **Turn evidence into a controlled document workflow:** uploads, hashes, expiry, ownership, permissions and direct report references.
4. **Create production lender outputs:** concise Credit Paper, draw-monitoring report and approved-condition tracker.
5. **Finish migration and presentation controls:** legacy-case completion wizard, version dashboard, consistent unrealised-return labels, month convention and PDF/UA/raster QA.

## 14. Final scorecard

| Measure | First | Second | Third |
|---|---:|---:|---:|
| Overall App | 38 / 100 | 69 / 100 | **86 / 100** |
| Financial Model | 3 / 10 | 8 / 10 | **9.5 / 10** |
| Development Finance Logic | 2 / 10 | 8 / 10 | **9 / 10** |
| Conversion-Specific Logic | 4 / 10 | 5 / 10 | **8 / 10** |
| Cost Modelling | 4 / 10 | 5 / 10 | **8 / 10** |
| Finance Modelling | 2 / 10 | 8 / 10 | **9 / 10** |
| Risk Analysis | 4 / 10 | 6 / 10 | **9 / 10** |
| UX | 6 / 10 | 7 / 10 | **8 / 10** |
| Reporting | 5 / 10 | 7 / 10 | **8.5 / 10** |
| Professional Credibility | 4 / 10 | 7 / 10 | **8 / 10** |
| Commercial Potential | 7 / 10 | 8 / 10 | **9 / 10** |

### Five strongest features

1. A rigorously specified, server-authoritative, dual-language financial engine with exact parity.
2. Genuine lender finance mechanics: facility constraints, repayment, CTC, monitoring, take-out and fixed-facility downside.
3. Strong development-specific data: areas, detailed costs, VAT, programme, unit sales and evidence-led due diligence.
4. Exceptional regression, migration and governance tests with candid specification of limitations.
5. A professional, transparent report that refuses to disguise missing evidence or unpaid debt.

### Five largest remaining weaknesses

1. Credit approval is not attached to authenticated authority.
2. BCIS elemental cost benchmarking is absent.
3. Evidence has no secure document/attachment workflow.
4. The actual York case remains an incomplete migrated legacy appraisal.
5. Production reporting still lacks PDF/UA, raster regression and purpose-specific credit/monitoring outputs.

## Final answer to the lender-reliance question

**The answer is now split.**

**For the calculation model:** yes. A competent UK development-finance lender can use the implemented model to understand and independently check acquisition costs, construction/VAT/programme timing, senior debt, sales/refinance repayment, monitoring CTC and downside. The lender should not need to rebuild the core model merely to understand it.

**For the production platform:** not yet without conditions. Authenticated identity, permissions, maker-checker approval, evidence-file control and operational security must be added before a “credit approved” status or FINAL report can carry institutional reliance.

**For the current York appraisal:** no. It remains an incomplete migrated draft with unconfirmed jurisdiction/facility/equity, no area schedule, no VAT basis, no lender valuation, no repayment source, no lender case and 23 unknown due-diligence items. The application correctly says so.
