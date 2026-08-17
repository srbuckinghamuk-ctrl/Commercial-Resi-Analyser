# Release 7 — report repair and governance (calc 2.6.0)

**Date:** 17 August 2026
**Audit answered:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md` (69/100)
**Scope:** the audit's **P0** (repair and govern PDF reporting) in full, plus the two P1/P2
items that fall inside it (visible provenance, export wording) and one model correction
the audit's §6.3 asked for by name.
**Release plan:** `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md` (R7 of R7–R16).

---

## 1. What was wrong, and why it was invisible

The audit's release blocker — *"page 8 contains a giant clipped 'Information Required' text
string across the top, overlapping page content and the watermark"* — had a single cause,
and it was not a pagination bug.

`watermark()` set 40 pt bold grey and never restored it. `infoRequired()` set its own 10 pt
italic amber **before** testing whether it needed a page break. So on the one path where
the break fired, the watermark repainted the graphics state and the line was drawn at
40 pt, measuring 615 mm on a 210 mm page.

Every substring assertion in the existing 872-test suite passed on that document, because
the string was present and the string was correct. **A defect of position cannot be caught
by a test of content.** That is why this release's first deliverable is an instrument, not
a fix.

Measuring the four representative documents also found more than the audit reported:

| Found by | Defect |
|---|---|
| audit | 40 pt clipped `[Information Required: …]` on page 8 |
| **gate** | `infoRequired` did not wrap at *any* size — it overflowed to 297 mm at 10 pt too |
| **gate** | the draft watermark itself ran 15 mm off both page edges, on every page of every report |
| audit | near-blank page 11 |
| **gate** | three more sparse pages: an orphaned three-line footnote, an orphaned contingent-exit block, an orphaned appendix tail |
| **rendering** | a sub-heading stranded at the foot of a page after its table moved (introduced *by* the first pagination fix) |
| **rendering** | three information-required items printed twice under two wordings |
| **rendering** | the draft reason stated twice in one paragraph |

The last three are worth noting: the gate did not catch them either. They were found by
rasterising the pages and reading them, and each then became a check — an orphan-heading
detector, and occurrence **counts** rather than `toContain`.

---

## 2. Instrument: `frontend/src/lib/report-qa/`

Test-support only; nothing in the application imports it, so it is absent from the bundle.

- **`pdf-inspect.ts`** parses jsPDF's uncompressed content streams — `/F<n> <size> Tf`,
  `Td`/`Tm`, `Tj`/`TJ`, WinAnsi string decoding — into positioned text items with page,
  baseline, effective size after any matrix scale, base font, rotation, and an advance
  width measured with jsPDF's own font metrics. Rotated text gets a true rotated bounding
  box.
- **`report-checks.ts`** turns that into the release gate's predicates: `overflowingItems`,
  `sparsePages`, `orphanHeadings`, `pageExtentRatio`, `pageFillRatio`, `documentProse`,
  `watermarkTexts`, `describeLayout`.
- Both are **calibrated against documents built to trip them** (`pdf-inspect.test.ts`), not
  against the memo they measure — including a page with a deliberately stranded heading and
  the same page fixed, so a check that always returns nothing fails there rather than
  passing silently in the gate.

Sparse-page detection uses **content extent** as its primary measure rather than inked
rows: a page holding one table is mostly white by construction, and judging it by ink
condemns an ordinary schedule page while scoring a genuine orphan about the same. Extent
separates them cleanly (61–99 % on real pages, 8 % on the orphan).

---

## 3. The layout engine

| Change | Replaces |
|---|---|
| Style applied immediately before each draw; `preservingStyle` / `preservingFont` around anything drawing out of band | style set before a page break, then repainted by it |
| `ensureSpace(y, mm)` keep-together | eight guessed `if (y > 200)` guards and four unconditional section page breaks |
| **Deferred headings** — a heading is queued, and the next block flushes the queue as part of its own keep-together decision | headings placing themselves before their content's height was known |
| `measureTableHeight` — renders the table into a throwaway document | row-count estimates, wrong by one row exactly where it orphans a tail |
| Short tables (≤ 110 mm) move whole; long ones may split | every table splitting wherever the cursor happened to be |
| Watermark sized to fit and positioned without `align: 'center'` | a fixed 40 pt banner, clipped on both edges |
| Paragraphs and `infoRequired` wrap to the content width and never split when they fit a page | unbounded single-line draws |

**`align: 'center'` is not usable for rotated text.** jsPDF subtracts half the *unrotated*
advance width from x and leaves y untouched, so a 45-character banner lands ~20 mm down and
left of the point it names. The geometry is computed here instead.

The same defects existed in `export-pdf.ts` (the eligibility and appraisal quick reports),
undetected only because nobody had generated a document long enough. Fixed, and brought
under the same gate. The duplicated watermark — which carried a comment explaining why it
could not be shared — is now one implementation in `report-layout.ts`.

---

## 4. Governance (spec §13, new)

**Provenance panel**, page 1 of the body, before any figure: appraisal id, project id,
scenario id and name, input schema version, calculation version, authoritative result hash,
input hash, audit hash, generation timestamp with IANA zone and UTC offset, report-safe
status, document status, lender-case status. Absent values say what is absent and why.

**Audit hash** (§13.2), server-side, migration 005:

```
sha256( project_id | calc_version | inputs_version | status | input_hash | outputs_hash )
```

A hash of the other hashes, so a reviewer holding the printed panel can recompute it from
the six fields beside it. Status is inside it: two records with identical inputs and outputs
but different governance status must not share an audit hash. Pre-existing rows are **not
backfilled** — the value would be computable, but a row not recalculated since this release
is a pre-provenance result and stamping it would assert a binding no run produced.

**The FINAL gate** (§13.3) — three conditions, each with its own banner:

| Failing condition | Banner |
|---|---|
| not report-safe | `DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE` |
| senior not repaid | `DRAFT - SENIOR DEBT NOT REPAID - NOT FOR LENDER RELIANCE` |
| not approved | `DRAFT - NOT APPROVED FOR LENDER RELIANCE` |

They are distinct claims. An unreconciled run's figures may be wrong; a reconciled run that
does not repay senior is arithmetically sound and shows a real repayment failure; a
reconciled, repaying run with no approved case is a correct appraisal nobody has approved.
Printing "UNRECONCILED" over the last two would state something untrue about the model.

`report_safe` deliberately does **not** include senior repayment (§7) — an appraisal
intending to refinance later is valid — so the document gate tests it separately. That is
what makes the quality gate "no senior-repayment failure can be exported as FINAL" hold
rather than being true only by accident.

**Consequence, stated plainly:** with no lender case in existence until R14, *every*
document this release produces is a DRAFT. That is the intended answer.

---

## 5. Model correction (calc 2.5.0 → 2.6.0)

The audit's §6.3: *"equity multiple is 0.00x … Showing it beside a 64.38% ROE can confuse a
non-specialist investor."*

Spec **§3.16.1** adds a realisation basis, in both engines:

- `has_realisation_event` = the schedule books sale receipts **or** a refinance.
- `return_on_equity_is_unrealised` = `profit_is_unrealised` **or** no realisation event.
- `equity_multiple` is **`null`** without a realisation event, not `0`.

The discriminator is deliberately the *event*, not the distribution. A sale whose receipts
sweep entirely to senior debt genuinely is `0.00x` — that row keeps its zero. A retain-all
case with no exit has no answer, and §1.5 says unknown is `null`.

This is the release's only computed-value change, hence the minor version. Reports label
the return "Return on Equity (unrealised)" and print the reason where a metric is
unavailable rather than a substitute figure.

---

## 6. Export copy

| Was | Now |
|---|---|
| "Comprehensive report with **full cost plan** … Suitable for equity investors and senior debt funders." | "…with **headline cost estimate** … Issued as a DRAFT development appraisal: suitable for sponsor and preliminary lender review, and a document a credit committee can rely on only once the appraisal is report-safe and a lender case has been approved." |
| memo section "Cost Plan" | "Headline Cost Estimate" |
| ROE printed unqualified | "Return on Equity (unrealised)" where §3.16.1 applies |
| — | new §13 **Basis of Preparation and Limitations**, closing the document with the report-safe/approval position and seven conditioned limitations (cost basis, VAT, jurisdiction, area bridge, due diligence, plus lender valuation / migrated terms / unrealised returns / senior repayment where they apply) |

---

## 7. The audited York case

`york-audit-case.test.ts` and `test_york_audit_case.py` reconstruct 9 & 9A Stonegate from
the audit's own prose and assert the auditor's independently derived figures. The
reconstruction is determinate, not a guess: £448,000 total acquisition cost on a £425,000
price fixes the acquisition costs once commercial SDLT (£10,750) is out, and the migrated
£527,437.40 facility is exactly 70 % of the £753,482 cost before finance, which fixes the
v1 `ltv_pct`.

**Every figure in the audit's §6.2 table reproduces exactly, in both engines, on the first
run** — cost before finance £753,482.00, arrangement fee £10,548.75, compounded interest
£875.55, total finance £11,424.30, TDC £764,906.30, profit £485,093.70, POC 63.42 %,
POGDV 38.81 %, peak debt £11,424.30.

The only figure R7 moved in that case is the one it set out to move: equity multiple
`0.00x` → unavailable.

---

## 8. Traceability — audit §11 improvement register

| Pri | Audit item | Status | Where |
|---|---|---|---|
| **P0** | PDF page overflow can make an external report unusable | **Implemented** | layout engine; `overflowingItems` gate over 5 documents; quick reports too |
| P1 | Report lacks visible provenance | **Implemented** | spec §13.1; provenance panel; migration 005 |
| P2 | Export wording overstates completeness | **Implemented** | §6 above |
| P1 | *(audit §9)* ROE shown without "unrealised"; unsupported return metrics | **Implemented** | spec §3.16.1, calc 2.6.0 |
| P2 | PDF not tagged; font warning | **Partial** | title/subject/language/`DisplayDocTitle` set; PDF/UA structure tagging deferred — see §10 |
| P1 | No complete conversion evidence/risk schedule | **Deferred → R15** | — |
| P1 | No area bridge | **Deferred → R9** | disclosed as a limitation in every report |
| P1 | Cost model is still headline-only | **Deferred → R10** | disclosed; "cost plan" claim removed |
| P1 | VAT and TOGC are disclosure-only | **Deferred → R11** | disclosed |
| P1 | No controlled lender case | **Deferred → R14** | the *gate* is built and enforced now: `LenderCaseStatus` is modelled, and a document cannot be FINAL without an approved case |
| P1 | CTC is not a monitoring statement | **Deferred → R14** | — |
| P1 | Programme lacks full development dependencies | **Deferred → R12** | — |
| P1 | Refinance underwriting is thin | **Deferred → R13** | — |
| P1 | Standard sensitivities omit conversion/exit risks | **Deferred → R16** | — |
| P1 | UK label exceeds tax coverage | **Deferred → R8** | disclosed: reports name the England/NI SDLT basis and say Scotland and Wales are not correctly taxed |
| P2 | Thirteen-tab workflow is long | **Deferred → R16** | — |
| P2 | Main bundle is large | **Deferred → R16** | 1,385 kB / 428 kB gzip; report-qa adds nothing to it |
| P2 | Legacy stored columns can mislead API consumers | **Deferred → R16** | — |

### Audit §9's "required report release gate", item by item

| Required assertion | Status |
|---|---|
| no content overflows page bounds | **asserted**, 5 documents, watermark included |
| no orphan or effectively blank pages | **asserted** — sparse pages *and* orphan headings |
| every figure reconciles to authoritative model outputs | **asserted** for the headline set (GDV, TDC, profit, equity contributed, peak debt, POC, POGDV) and the sources/uses identity |
| report-safe status and DRAFT/FINAL state are correct | **asserted**, including the senior-repayment gate |
| calculation/input versions, hashes, generation time and scenario identity printed | **asserted**, all twelve fields |
| lender valuation and unconfirmed inputs visibly identified | **asserted** |
| claims about cost-plan completeness match the input mode | **asserted** |
| render every page to an image for visual regression | **not asserted** — see §10 |

---

## 9. Gate results

| Gate | Result |
|---|---|
| Frontend tests | **995 passed / 48 files** (872 before R7) |
| Backend tests | **831 passed** (767 before R7) |
| ESLint | passed |
| `tsc -b` | passed |
| Production build | passed — 1,385.37 kB / 428.10 kB gzip (Vite's >500 kB advisory stands; R16) |
| Representative PDFs rendered and inspected | sell, retain, refinance, blended, migrated legacy draft — 12–13 pages each |
| York appraisal reconciles after migration | exact, both engines |
| Sources and uses to the penny | asserted per document |
| Monthly debt ledger roll-forward | unchanged; existing invariant suite |
| No senior-repayment failure exportable as FINAL | asserted |
| No page overflow or unintended blank content | asserted |

The `ConversionCalculator` flake carried from the R6 backlog was fixed rather than
tolerated: the suite's timeout is raised to 30 s with the reason recorded, because the two
slow files (a full thirteen-page render, and real PDF generation and parsing) are doing
work they should be doing.

---

## 10. Remaining limitations — stated, not hidden

1. **PDF/UA structure tagging is not implemented.** A structure tree, role map and artifact
   marking are not expressible through jsPDF's public API. The documents carry title,
   subject, language and `DisplayDocTitle`, which is what an assistive reader announces
   first, but the PDFs are **not tagged** and should not be described as accessible.
2. **No raster visual-regression check.** Rendering each page to an image needs a PDF
   rasteriser (pdf.js plus a native canvas) that this project does not depend on, and adding
   one for tests is a real dependency decision. `describeLayout` gives a deterministic
   geometry snapshot instead, and the gate asserts two runs of the same inputs produce an
   identical layout. **The visual inspection in this release was done by hand**, with a
   rasteriser installed on the development machine only; it is not repeatable in CI.
3. **The "missing Symbol font" warning is not fixed.** jsPDF emits the full standard-14 font
   dictionary unconditionally, including `/Symbol` and `/ZapfDingbats`, with no embedded
   font file. The memo uses Helvetica only, so nothing the document draws is missing — but
   the declaration is still there and a strict renderer will still mention it. Removing it
   means either patching jsPDF's emission or embedding a real font family, which trades
   against the bundle size the same audit asks us to reduce. Deferred with the reason
   recorded rather than closed quietly.
4. **The last page of a report can end a third of the way down.** Within the gate's
   thresholds and normal for a document, but it is a judgement, not a proof.
5. **Sparse-page thresholds are calibrated, not derived.** 40 % / 20 % extent, 6 % ink,
   5 items. They separate every real page from every orphan in the current corpus with a
   wide margin; a very different document could need them revisited.

---

## 11. Where the product stands

R7 changed what the product *says about itself*. It did not add underwriting depth, and the
audit's remaining P1 items — area bridge, detailed cost plan, VAT, programme, exit and
refinance depth, lender case, monitoring CTC, jurisdiction, due diligence — are all still
open, now explicitly disclosed in every document rather than absent from it.

| Positioning | Verdict |
|---|---|
| **1. Suitable for developer screening** | **Yes.** Was already true; the report is now clean enough to circulate. |
| **2. Suitable for preliminary lender appraisal** | **Yes**, and better supported than before: a lender receives a traceable document that names its own model version, hashes, scenario and limitations. |
| **3. Suitable for controlled lender underwriting** | **No.** There is no lender case, no approval workflow, no monitoring statement, no area bridge, no QS cost plan and no VAT cash flow. The *governance skeleton* exists — statuses, the FINAL gate, the audit hash — but nothing yet fills it. |
| **4. Suitable for a FINAL Credit Committee report** | **No**, and now structurally impossible: no lender case can be approved, so no document can be FINAL. This is deliberate. |

**The product is not lender-ready.** The audit's P0 is closed and the export defect that
made the memorandum unusable externally is fixed, but the gap between 69/100 and lender
readiness is data depth and underwriting workflow, which is R8–R16.
