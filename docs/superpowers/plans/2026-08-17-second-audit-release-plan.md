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
| **R10** | Cost-plan modes (headline vs detailed QS packages), contingency separation, fee bases | P1 | inputs v7, calc minor |
| **R11** | Line-level VAT and TOGC cash flow | P1 | inputs v8, calc minor |
| **R12** | Dated, dependent programme phases | P1 | inputs v9, calc minor |
| **R13** | Exit/refinance depth: unit sales, NOI, DSCR/ICR, constraint binding | P1 | inputs v10, calc minor |
| **R14** | Lender case governance + monitoring cost-to-complete **+ the §5.10 rolled-up-interest defect carried from R9 (see “Carried defects” below)** | P1 | new records, calc **minor** — §5.10's remaining-funding term moves |
| **R15** | Scheme/title/technical DD schedule, evidence RAG+unknown, source-conflict flags | P1 | inputs v11 |
| **R16** | Sensitivity presets, UX stage grouping, bundle split, legacy column deprecation | P1/P2 | none |

---

## Carried defects — found in one release, to be corrected in another

A defect found mid-release is not always safe to fix in that release. Where the fix
is a behaviour change to a **reported** metric, it needs its own hand-derived
fixtures and its own gate, and bolting it onto an unrelated release would ship an
unreviewed change to a number a lender reads. Those defects are listed here so they
are picked up deliberately rather than rediscovered.

Each entry must state the defect in one line, name **where the counter-example is
asserted** (a deferral with no failing assertion behind it is a note someone has to
remember to check), and name the release that owns the correction.

### C1 — §5.10 charges rolled-up interest against the net facility [found R9, owned by R14]

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
