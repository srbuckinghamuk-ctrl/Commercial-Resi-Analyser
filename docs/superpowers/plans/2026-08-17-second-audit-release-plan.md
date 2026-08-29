# Second-audit remediation — release plan (R7 → R16)

Source: `docs/reviews/2026-08-17-lender-readiness-second-audit.md` (69/100).
Every release ships with: spec section, migration (where the input schema moves),
independently-derived golden tests, and the full gate set (vitest, pytest, eslint,
`tsc -b`, production build).

Both engines mirror. No calculation logic in React components or report generators.

| Release | Scope | Audit priority | Calc/schema move |
|---|---|---|---|
| **R7** | Report repair and governance: layout engine, provenance panel, export copy, DRAFT gate, PDF QA harness | **P0** | none (report only) |
| **R8** | Jurisdiction + acquisition tax (SDLT/LBTT/LTT), versioned bands | P1 | inputs v5, calc minor |
| **R9** | Area bridge and efficiency reconciliation | P1 | inputs v6, calc minor |
| **R10** — **DONE, shipped** | Cost-plan modes (headline vs detailed QS packages), contingency separation, fee bases | P1 | inputs v7, calc 2.9.0 |
| **R11** | Line-level VAT and TOGC cash flow | P1 | inputs v8, calc minor |
| **R12** | Dated, dependent programme phases | P1 | inputs v9, calc minor |
| **R13** | The investment case: hold-period NOI, operating costs/vacancy/stabilisation, a derived take-out sized on LTV/DSCR/ICR with the binding constraint named | P1 | inputs v10, calc minor |
| **R13b** — **DONE, shipped** | Unit-level sales ledger: per-unit completion timing, per-unit selling costs, deposits — the half of audit §7.8 deferred out of R13 (§2 of the R13 design) | P1 | inputs v12, calc 2.14.0 |
| **R14** — **DONE, shipped** | §5.10 corrected (C1), monitoring cost-to-complete statement, `lender_eligible` wired | P1 | inputs v11, calc 2.13.0 |
| **R14b** — **DONE, shipped** | Lender case governance: locked lender snapshot, reviewer, approval state, stale detection, change log (audit §7.3, §7.10) | P1 | two new tables + API (migration 006), Python governance twin; no calc bump, no inputs bump — and `audit_hash` is **not** extended, see the status paragraph |
| **R15** — **DONE, shipped** | Scheme/title/technical DD schedule, evidence RAG+unknown, source-conflict flags **+ the §7.5 items R10 deliberately left unaddressed: QS source/date/status, fixed-price coverage, provisional sums, inflation (see note below the table)** | P1 | inputs v13, calc 2.15.0 |
| **R15b** — **DONE, shipped** | The cost plan in time: per-package programme (§16.9 limitation 1), tender-price inflation from `qs.base_date` to each package's spend midpoint (§7.5's inflation ask), per-package draw eligibility (§16.9 limitation 2, §20.5 limitation 3) | P1 | inputs v14, calc 2.16.0 |
| **R16** — **DONE, shipped** | The standard lender stress pack: a closed, spec-numbered pack of nine standard stresses run as §12.5 cells in both engines and printed in memo §10 and on the Sensitivity page; the four levers it needs (`saleable_area`, `abnormal_cost`, `programme_slip`, `refi_ltv`); every remaining `ScenarioOverrides` field gets a Scenarios-page input; the R15/R15b review minors | P1 | inputs v15, calc 2.17.0 |
| **R16b** | Platform: UX stage grouping and URL-routed calculator pages, the bundle split, legacy stored columns / `sdlt_pence` / `conversion_costs.contingency_pct` / the eight legacy fee fields, the cash-flow page's eligibility column (§24.9 deferred it as page work) | P2 | inputs v16, Alembic 007, no calc bump expected |

**R16 UX debt recorded by R13b — paid.** The R12/R13 override fields (`phase_slip_*`, `exit_yield_adjustment_pct`, `operating_cost_adjustment_pct`, `vacancy_adjustment_pct`) had no ScenariosPage input; `sales_slip_months` got one in R13b, and R16 gave every remaining field one — including its own four — with a `Record<keyof ScenarioOverrides, true>` exhaustiveness test so a fourteenth lever cannot ship UI-less.

**R10 status (calc 2.9.0, inputs v7):** shipped. It gave the appraisal a mutually
exclusive headline/detailed cost-plan mode, the audit's own package schedule and
code enum, three named contingency classes each on a displayed, resolved base, and
professional/statutory fee lines with fixed and percentage bases — closing §7.5's
"screening-level cost plan" finding and its "separate general contingency from
existing-building and abnormal-risk contingency" / "allow eligibility bases per
package and show the base" / "fixed and percentage bases without double counting"
asks. See spec §16.

**R13 status (calc 2.12.0, inputs v10):** shipped. It gave a retained scheme a
derived income and a derived take-out — hold-period NOI from the existing but
previously-inert `retained_units[].monthly_rent_pence`, operating costs,
vacancy/stabilisation, a net-initial-yield valuation, and a take-out sized as
`min(LTV cap, DSCR cap, ICR cap)` with the binding constraint named — closing
audit §7.8's "bulk/investment-sale yield and NOI", "operating costs, vacancy,
stabilisation", "refinance interest coverage/DSCR" and "refinance fees" asks,
and §7.9's "refinance yield expansion, lower refinance LTV and
operating-cost/vacancy stress" sensitivity asks. See spec §19.

**R14 status (calc 2.13.0, inputs v11):** shipped. It closed **C1**, the §5.10
defect carried from R9 — remaining funding now credits a rolled-up facility's
unconsumed interest reserve, so a facility structured the way a real one is no
longer reports a phantom shortfall, and fixture `v-exhausted-reserve` pins the
real shortfall that survives once the reserve is genuinely exhausted. It made
`lender_eligible` live: §4.2(b)'s development-cost advance cap now scales its
construction line by `lender_eligible_base_pence / base_build_pence`, closing the
inert-eligibility-flag limitation R10 stated at the point of definition and
carried for four releases — with the honest consequence that the two corpus
fixtures carrying an ineligible package at a 100% advance percentage now report
real funding gaps and are no longer report-safe. And it added the monitoring
cost-to-complete statement: entered per-category actuals at one reporting date,
the original budget read from the inception model, the variance bridge, the
funding reconciliation and three result-derived flags — closing audit §7.7's
"a monitoring case needs reporting date, original and current budget,
certified/paid/committed cost to date, QS forecast to complete, remaining
contingency, debt drawn, cash equity injected, remaining committed equity and
variances… it must reconcile remaining uses with undrawn facility plus remaining
cash equity".
See spec §20, and §13.3 for the VAT banner row R11 left out of the table.

**R14b status (calc 2.13.0 unchanged, inputs v11 unchanged):** shipped. It gave
the product a **lender case**: a locked whole-document snapshot of a stored
appraisal — the full `inputs_snapshot`, the calc and inputs versions and all
three provenance hashes, copied at creation and never rewritten — carried
through a server-enforced eight-status state machine with a reviewer, a
decision, approval conditions and an append-only change log, all of it behind
five `/lender-cases` endpoints and a new calculator page. Closing audit §7.10's
"lock lender GDV, cost/programme adjustments, approved facility and credit
conditions; add reviewer, approval state, timestamp and change log", and §7.3's
"an edit to the developer case should mark the lender case stale and require a
deliberate refresh or reapproval": staleness is derived at read time — the live
row's `input_hash` against the case's locked one — stored nowhere, and it
**defeats FINAL** under a banner of its own rather than being a warning printed
beside one. The case gets its own `case_hash`, **chained onto** the locked
`audit_hash` and not folded into it: the release-plan row above originally said
the `audit_hash` input set would be extended, and the design rejected that —
extending it would rewrite every stored hash on the next save and break spec
§13.2's reviewer-recompute claim, and a case transition happens without an
appraisal re-save, so a governance component inside `audit_hash` would silently
invalidate hashes on rows nobody had touched. **No calc bump and no inputs
bump**: nothing inside `inputs_snapshot` moves and no arithmetic changes, and a
courtesy 2.14.0 would have stamped every stored result "recomputed since save"
in the memo for no figure change (the R6 precedent — it shipped on calc 2.5.0
unchanged). The release is versioned by **Alembic migration 006** and by spec
**§21**. Governance also stopped being a one-language concern:
`app/financial_model/provenance.py` is now the Python twin of
`report-provenance.ts`'s governance core, because the API cannot enforce a state
machine that exists only in the client.

**R15 status (calc 2.15.0, inputs v13):** shipped. It gave the appraisal an
**evidence position**. Until this release planning, title, occupation, building
condition and professional evidence were recorded nowhere: `risks[]` was five
free-text rows with no category, no evidence, no owner, no date and no way to
say *unknown*, and the memo text-matched those descriptions against nine
hard-coded phrases, so a row reading "planning is fine" satisfied the planning
check. R15 replaces that with a **fixed 28-code catalogue** across the audit's
six categories — 23 items the appraiser enters plus five **derived** rows read
from the evidence the model already carried (QS provenance, facility terms,
equity sources, the tax and VAT basis, the lender valuation) — each entered row
carrying red/amber/green/**unknown**/not-applicable, evidence source, reference
and date, an expiry, an owner, a due date, a stated cost and programme impact
and an action, with `unknown` as every item's seed and a `green` without
evidence a hard validation error. That closes audit §7.10 in full and §7.1 as
catalogue items rather than a typed facts block, `higher_risk_building`
included — the deal spider's building-safety axis is now marked *provisional*
until that item is competently confirmed.

The audit's sharpest rule — *unknown must never default to green* — is given a
consequence rather than a colour: spec §13.3 gains a **seventh FINAL
condition**, `entered_unknown_count == 0`, ordered after the VAT gate and
before the approval gate, under its own banner
`DRAFT - DUE DILIGENCE INCOMPLETE - NOT FOR LENDER RELIANCE`. Derived rows do
not gate. The consequence for every existing document was accepted rather than
worked around, on R8's precedent: a migrated document carries 23 unknowns and
shows that banner as soon as its tax and VAT bases are confirmed.

R15 also closes the **R7 §6a** finding, which asked that the source-data
contradiction raise a hard information-required flag rather than sit in
narrative text. The document now carries a **captured `source_record`** — the
listing's *structured* fields, copied at document creation or on demand, never
its prose — and two stated rules compare it to the appraisal: an occupied
listing against a green vacant-possession item, and a listing floor area more
than 25% from the entered existing GIA. Each raises `source_conflict` (red) and
prints as an Information Required line. What the York case actually needed was
the gate, not the rule: its occupation fact lives in prose that no rule can
see, and the design says so rather than pretending a regex is evidence — but
`vacant_possession` is seeded `unknown`, so the model now refuses to assume
vacancy.

And it closes **the §7.5 items R10 deliberately left unaddressed**, the note
below this table's subject: `cost_plan.qs` (source, RIBA stage, issue date,
status, pricing base date) and a per-package `price_basis`, with fixed-price
coverage, provisional sums, estimates and the unclassified balance published
against base build. §13.4's "QS evidence is not recorded" sentence became
conditional at the same moment — a disclosure that outlives the gap it
described is as misleading as no disclosure at all. Package exclusions needed
no new field: a provisional or estimated package's `notes` is its exclusions,
and the memo prints it under the QS line.

**No arithmetic changed.** Calc 2.15.0 adds a result block, four flags and a
FINAL condition; the v12 → v13 identity gate compares metrics, ledger and
schedule — the new `due_diligence` block included, **with no exclusion** —
because the engine reads a pre-v13 document as the migration seed, and
`due_diligence_unknown` is asserted by name as the gate's sole expected
addition. Two housekeeping items rode along: the cross-engine message-drift
guard's window now covers §22.7 and §23.9 as well as §19.7 (finding three
§22.7 Python messages that had drifted to an ASCII hyphen against the
TypeScript em-dash), and `unit_sales.totals.gross_pence == totals.gross_sales_pence`
is asserted corpus-wide. See spec §23, `migration-notes.md` §16 and
`test-cases.md` §23.

**R15b status (calc 2.16.0, inputs v14):** shipped. It gave the appraisal a
**cost plan in time**. Every detailed-mode package now resolves a window in
time — its own tagged phase's `[start, finish)` and curve on a network, the
shared construction window on the auto path, the construction package's own
window on a raw legacy document — and a curve-weighted spend midpoint
computed from that window's weights, independent of the package's amount.
On that midpoint the release builds the two things a QS-priced plan and a
lender both need: a tender-price inflation allowance, one flat annual rate
compounded pro-rata from `qs.base_date` to each package's own midpoint, added
as a disclosed line beside the priced sum rather than folded into it; and a
per-month lender-eligible construction figure that §4.2(b)'s development-cost
advance cap now reads in place of R14's single whole-line ratio. The Costs
page gains the phase picker `phase_id` has lacked a writer for since R12
(§18.10 limitation 9's shape, closed here), on both packages and fee lines,
plus read-only window/midpoint/inflation cells and the QS card's inflation
control; the memo prints a package's phase, midpoint and inflation only when
the document actually carries those facts. That closes the whole of §7.5's
inflation ask, §16.9 limitations 1 and 2, and §20.5 limitation 3 — the
audit's own words, *"allow eligibility bases per package and show the
base,"* stated as a per-month figure rather than a single ratio.

**What moved, and why it is only fixture S.** The per-month lender-eligible
share recovers R14's uniform ratio exactly, every month, on any document
whose packages all share one spend window — the auto path, the legacy arm,
and every network fixture in the corpus except one, because every other
document's packages either share a phase or are all eligible together.
Fixture S is the one document with packages in more than one window **and**
an ineligible package among them, so it alone moves: `funding_gap_pence`
6,300,000 → 6,330,000, and every debt-denominated metric that follows it,
re-derived by hand (`test-cases.md` §24.2). The gap grows rather than
shrinks, because the strip-out months that used to be scaled down with
everything else now fund in full, and the whole shortfall concentrates into
the fewer months that still carry one. Every other golden pin in the corpus
is unchanged, asserted rather than assumed: the v13 → v14 identity gate
compares metrics, ledger and schedule on both arms with no exclusion, and
the recovery claim is asserted on every auto-path detailed fixture, every
month, with a companion proof that the set of such fixtures is non-empty.
`no_inflation_allowance` is the release's one new flag.

**What is deferred, named rather than left implicit.** A dated tender-price
index table (BCIS-style) in place of one flat rate; a per-package rate on a
plan priced by more than one index; inflating fee lines or contingency
bases (both stay uninflated by design — an appointment is priced at
appointment, and a general contingency that grew with the programme would
be indistinguishable from inflation); a true per-package draw ledger in
place of the per-month share (the uses stay bucket-spread, §18.5's rounding
argument, unchanged since R12); a per-month lender-eligible column on the
Cash-flow page (which has no per-category column to hang one on today). See
spec §24, `migration-notes.md` §17 and `test-cases.md` §24.

**R16 status (calc 2.17.0, inputs v15):** shipped. It gave every appraisal a
**standard lender stress pack** — a closed, spec-numbered set of nine stresses
(spec §25.2) computed and printed whether or not anyone pressed anything: one
unit lost, saleable area −5%, abnormal cost +10%, sales six months slower,
start/PC six months late, exit yield +100 bp, refinance LTV −10 pp, opex
+10%/vacancy +5 pp, and the recorded due-diligence risks crystallising. Each
entry is one §12.5 cell run through §12.7's validity rule, so the pack adds no
formula; two entries derive their settings from the base document (an average
unit's share of area and value, and Σ cost / Σ programme impact off the §23
evidence schedule), and an entry this scheme cannot answer is **measured,
marked inapplicable and printed with the fact it lacks** rather than silently
omitted. That closes the audit's §7.9 finding — *"standard lender buttons
should include unit loss, saleable-area reduction, abnormal cost, slower sales
absorption, delayed planning/PC, refinance yield expansion, lower refinance LTV
and operating-cost/vacancy stress"* — and §23.9's recorded "risks crystallise"
gap in one release. §12.1's lever table went from nine rows to thirteen
(`saleable_area`, `abnormal_cost`, `programme_slip`, `refi_ltv`), the Scenarios
page gained an input for every remaining `ScenarioOverrides` field, and both the
scenario cards and the memo's Scenario Comparison stopped appraising an
unvalidated levered document and adopted §12.7. See spec §25,
`migration-notes.md` §18 and `test-cases.md` §25.

**Nothing moved, and the gate says so.** No existing computed value changes on
any document: every new scenario field migrates as `0`, every new lever is the
identity at `0`, and no fixture pin moves at this release at all. The one change
the numeric gate could not have seen — a cell now applies its settings sorted
newest-lever-first rather than in caller order, which is what keeps the first
pair of levers sharing a field (`saleable_area` and `gdv`, composing area then
value) order-independent — is covered by the v14 → v15 gate's new arm: on four
named fixtures it compares the whole default `SensitivityResult` on both arms,
beside metrics (flags strictly), ledger and schedule, with no exclusion and no
tolerance.

**The R16 row in the table above was wrong on both halves, and is corrected
here.** It read *"Sensitivity presets, UX stage grouping, bundle split, legacy
column deprecation — P1/P2 — **none**"*. Scoping at design time found that row
to be **two releases**, and its "no schema move" to be wrong on **each** of
them: a new lever needs a `ScenarioOverrides` field, so the pack is an inputs
bump (v15) whatever else it does; and removing `conversion_costs.contingency_pct`
and the legacy columns is an inputs bump of its own (v16) plus an Alembic
migration. R16 is therefore the model half and R16b the platform half, as the
two rows now say. Spec §16.3's deprecation note, which said `contingency_pct`
was "removed in R16", is corrected to R16b by the same split.

**What is deferred, named rather than left implicit.** A **named-unit** removal
lever (entry 1 stresses an *average* unit's share of area and value; a named
unit would have to cascade through `unit_sales.units[]`, `retained_units[]` and
two validation rules, and choose which unit) — recorded, unowned. A
**configurable** pack: a lender with a house stress set uses the tornado and
matrix, which remain configurable, and "standard" would stop meaning standard.
A **DSCR/ICR floor** stress: `refi_ltv` moves the LTV cap only, so a scheme
already bound by DSCR shows no movement under it — visible through §19.4's
published binding constraint, and stated as §25.8 limitation 3. A
due-diligence **lever** on the tornado, which would need a magnitude nobody has
defined; entry 9 is the audit's actual ask. And an **API endpoint** for the
pack or the suite: neither is published, and a consumer wanting either re-runs
the library. Everything in the R16b row above is out of scope here by
construction.

**Inflation is R15b, scheduled rather than dropped or bolted on.** §7.5's
inflation ask is not an evidence question, it is a **timing** question: you
cannot inflate a package from `qs.base_date` without knowing when that package
spends, and a package still has no programme of its own — §16.9 limitation 1,
open since R10 and unowned since R12 shipped phase-level rather than
package-level scheduling. A flat `inflation_pct` on base build now would have
been indistinguishable from the general contingency class until packages have
their own timing, and a second flat percentage on the same base reopens R10's
double-count seam. So the three questions that share that missing mechanism are
scheduled together as **R15b — the cost plan in time**: the per-package
programme, tender-price inflation from `qs.base_date` to each package's spend
midpoint, and per-package draw eligibility (§16.9 limitation 2, restated as
§20.5 limitation 3, which has waited on the same thing). R15 records
`qs.base_date` so R15b has its origin, and spec §23.11 limitation 6 and §16.9's
new inflation line carry the deferral. This is the same discipline R13/R13b and
R14/R14b arrived at: one new arithmetic axis per release, and an evidence
release does not open one.

**The "every document is a DRAFT" era ended here.** Spec §13.3 has required an
approved lender case as its last FINAL condition since R7, and for seven
releases nothing could supply one — the spec said so itself, in a bullet
recording that as the intended answer rather than a gap. R14b makes the
condition meetable and adds a sixth beside it (the approval must not be stale),
and the memo release gate now asserts a document that renders **FINAL** — the
first the gate has ever been able to assert. That bullet is rewritten in §13.3
as the historical note it became.

**R14 took the engine axis only; R14b is the governance axis, scheduled rather
than dropped.** The row above originally paired lender-case governance with the
monitoring statement. They are two axes with one review surface — roughly
twenty-five tasks — and taking both would have left the phantom shortfall
printing for another release while the governance schema was designed. R14b's
row is that split recorded as scheduled work; see the R14 design document
(decision 1) and spec §20.5 limitations 5 and 6 for the corresponding stated
limitations.

**R13 deliberately took half of audit §7.8, and R13b is the other half,
scheduled rather than left as a spec limitation.** §7.8 also asked for
unit-specific completion timing, sales-agent/legal costs by unit, and deposits
— the sold portion's *receipt timing*, as against R13's retained-portion
*income and take-out*. The two subsystems share no arithmetic, and taking both
in one release would have opened a second live sales path (per-unit alongside
the existing aggregate `sales_phasing`) in the same release that opened a
second live valuation path (yield-derived alongside explicit) — one new live
path per axis is the rule R12 arrived at the hard way. R13b's row above is
that deferral recorded as scheduled work; see the R13 design document (§2) for
the split's full reasoning and spec §19.10 limitation 1 for the corresponding
stated limitation.

**§7.5 items R10 deliberately did not address, now R15's responsibility.** §7.5
also asked for "QS source/date/status, fixed-price coverage, provisional sums,
inflation and package exclusions" on the detailed schedule. When this note was
written none of it was modelled: a package or a fee line carried no source, date,
status, price-coverage flag, provisional-sum marker or inflation index (spec
§16.9's stated limitation). **R15 shipped all of it except inflation** — see the
R15 status paragraph — and inflation is scheduled as **R15b** because it needs
the per-package programme §16.9 limitation 1 still lacks. Fee lines deliberately
gain no provenance: a fee is an appointment, not priced works (spec §23.11
limitation 9). The ask was deliberately left for R15 rather than folded into R10, on the same
reasoning R9 applied to the acquisition jurisdiction's evidence status (spec
§14.6) and the area bridge's (spec §15.9, "areas carry no evidence status") — an
evidence/provenance model is its own piece of work, not a field bolted onto a
release whose job was the arithmetic. §7.5's VAT ask is separately owned by R11
(spec §16.9), not R15.

A defect found mid-release is not always safe to fix in that release. Where the fix
is a behaviour change to a **reported** metric, it needs its own hand-derived
fixtures and its own gate, and bolting it onto an unrelated release would ship an
unreviewed change to a number a lender reads. Those defects are listed here so they
are picked up deliberately rather than rediscovered.

Each entry must state the defect in one line, name **where the counter-example is
asserted** (a deferral with no failing assertion behind it is a note someone has to
remember to check), and name the release that owns the correction.

### C1 — §5.10 charges rolled-up interest against the net facility [found R9, owned by R14 — **closed in R14**]

**Closed in R14 (calc 2.13.0).** Spec §5.10 now credits the unconsumed interest
reserve to remaining funding for a rolled-up facility, and carries the full closed
record — the defect, the correction, the rejected alternative and the two fixtures
that pin it. The entry below is kept as it stood when the deferral was taken; read
spec §5.10 for what the engine does now. Of the two options the last paragraph but
one asks R14 to decide between, **crediting gross-facility headroom was chosen**:
the alternative (stop counting rolled-up interest in remaining cost) is equivalent
only while the reserve holds and hides a real shortfall once it does not. The
serviced-interest case is untouched, asserted by a deep-equal series either side
of the change.

**The defect, in one line:** spec §5.10's cost-to-complete series counts future
rolled-up interest in *remaining cost* while counting only the undrawn **net**
facility in *remaining funding* — but rolled-up interest never consumes the net
facility (§4.2), it capitalises against the **gross** facility's headroom — so any
facility structured the normal way (net sized to the costs, interest reserve carved
out of the gross) reports a phantom shortfall.

**Where the counter-example is asserted.**
`fixtures/financial-model/p-scotland-levered.json` pins
`cost_to_complete_first_shortfall_month: 1` and
`cost_to_complete_max_shortfall_pence: 392483` against a ledger whose
`funding_gap_pence` is `0`. Both engines' corpus tests
(`TestShortfallDirectionAgainstFundingGap::test_holds_across_every_golden_fixture`
and its vitest twin) name that fixture explicitly and **assert its shape** — a
shortfall present, a funding gap of zero — so it cannot drift off the exclusion
list in silence, and both assert they still saw a positive case so the implication
cannot go vacuous. The pins are negative-controlled in both engines.

**Why it was not fixed in R9.** R9 is an area release. Correcting §5.10 changes a
figure the lender-facing report prints, on every levered rolled-up appraisal. It
needs its own hand-derived fixtures covering the rolled-up and serviced cases
separately, which is a release's worth of work, not a fix round's.

**What the correction has to decide** (recorded so R14 does not have to re-derive
it): whether remaining funding should credit gross-facility headroom for a
rolled-up facility, or whether remaining cost should stop counting rolled-up
interest — these are not equivalent once the gross facility is exhausted, and the
serviced-interest case (where interest genuinely is funded, from equity, §4.3)
must not be broken by whichever is chosen. Spec §5.10's "Known limitation"
paragraph carries the full statement and the arithmetic.

**Not to be closed by widening fixture P's facility.** That was considered and
rejected in R9: tuning the input until the metric agrees hides a systematic
misstatement behind a fixture nobody would question again.

---

## R7 — Report repair and governance (this release)

### Defects being closed

1. **Style bleed across a page break.** `watermark()` sets 40 pt bold grey and never
   restores. `infoRequired()` sets its own 10 pt italic amber *before* the `y > 270`
   page-break check, so the break repaints the state and the line is drawn at 40 pt —
   a giant clipped `[Information Required: …]` across the top of the new page,
   overlapping content and the watermark. This is the audit's release-blocking
   page-8 defect.
2. **Blank/sparse pages.** Fixed `if (y > N)` thresholds break to a new page without
   measuring the block that follows. A retain-all case with no phasing, no redemption
   schedule and no refinance leaves section 11 holding three short paragraphs, and
   section 12's unconditional `newPage()` seals it as a near-blank page.
3. **No visible provenance.** The memo prints no appraisal id, scenario identity,
   input version, calc version, result hash, audit hash, generation timestamp or
   approval state.
4. **Overconfident copy.** "full cost plan" (headline inputs only); "Suitable for
   equity investors and senior debt funders" (unqualified); ROE printed without the
   unrealised qualifier.
5. **Unsupported return metrics.** Equity multiple / IRR shown where the cash-flow
   basis cannot support them.

### Tasks

1. Graphics-state discipline — `withTextStyle`, watermark save/restore, and a single
   `drawText` choke point that cannot draw outside the page box.
2. `ensureSpace(y, mm)` keep-together primitive; every `if (y > N)` guard replaced by
   a measured one; `sectionTitle` keeps its first block.
3. Blank-page prevention: sections start in place when they fit; the appendix break
   becomes measured.
4. Provenance panel (spec §13) on page 2, and an audit hash defined and computed
   server-side.
5. Copy: "headline cost estimate"; suitability qualified on report-safe + approval;
   "Unrealised ROE"; suppress distributed-return metrics without a cash basis.
6. `report-qa.ts` — a real PDF inspector (parses jsPDF's uncompressed content
   streams: `/F<n> <size> Tf`, `Td`/`Tm`, `Tj`/`TJ`) producing positioned, measured
   text items per page. Feeds page-bounds, sparse-page, provenance and reconciliation
   assertions.
7. Report QA suite over sell / retain / refinance / blended fixtures.

### Deliberately deferred in R7 (reported, not hidden)

- **Full PDF/UA tagging** (StructTreeRoot, role map, artifact marking) is not
  expressible through jsPDF's public API. R7 ships document metadata, language,
  display-doc-title and reading-order-stable content; tagging stays open.
- **Symbol/ZapfDingbats font warning**: jsPDF emits the standard-14 font dictionary
  unconditionally. The memo uses Helvetica only. Addressed by declaring the fonts the
  document actually needs; the unused standard-14 declarations are a jsPDF emission,
  not a missing resource.
