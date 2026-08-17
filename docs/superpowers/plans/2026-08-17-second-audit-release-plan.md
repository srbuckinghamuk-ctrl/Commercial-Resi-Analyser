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
| **R14** | Lender case governance + monitoring cost-to-complete | P1 | new records, calc none |
| **R15** | Scheme/title/technical DD schedule, evidence RAG+unknown, source-conflict flags | P1 | inputs v11 |
| **R16** | Sensitivity presets, UX stage grouping, bundle split, legacy column deprecation | P1/P2 | none |

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
