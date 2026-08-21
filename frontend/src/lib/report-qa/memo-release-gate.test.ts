import { describe, it, expect } from 'vitest';
import type { Project, FinancialAppraisal } from '../../types';
import type { AnyCalculatorInputs } from '../model';
import { runAppraisal, migrateInputsToV4 } from '../model';
import { generateInvestmentMemo } from '../export-investment-memo';
import { buildProvenance } from '../report-provenance';
import { TAX_TABLE_VERSION } from '../tax/acquisition-tax';
import type { ReportProvenance } from '../report-provenance';
import { inspectPdf } from './pdf-inspect';
import type { PdfDocumentInfo } from './pdf-inspect';
import {
  overflowingItems, sparsePages, orphanHeadings, documentText, documentProse,
  watermarkTexts, describeLayout, bodyItems, checkAcquisitionTaxDisclosure,
} from './report-checks';
import {
  qaProject, qaEligibility, sellAllInputs, retainAllInputs,
  refinanceInputs, blendedInputs, legacyV1Snapshot,
  welshInputs, scottishInputs, unconfirmedJurisdictionInputs,
  bridgeAndAncillaryInputs, bridgeAncillaryScottishUnconfirmedInputs,
  detailedCostPlanInputs,
} from './memo-fixtures';
import { humanise } from '../format';

/**
 * The report release gate (audit §9: "before external issue, automated report QA
 * should assert …").
 *
 * Everything here is measured off the generated PDF's own content streams, not
 * off the generator's intentions. That distinction is the point: the defect this
 * gate exists to catch — a line of correct text drawn at 40 pt, 400 mm off the
 * right-hand edge of page 8 — was invisible to every substring assertion in the
 * existing suite, because the string was present and the string was right.
 */

/** A stored record, so the provenance panel has real hashes to print. */
const savedRecord: FinancialAppraisal = {
  id: 'c0ffee00-1111-4222-8333-444455556666',
  project_id: qaProject.id,
  name: 'Stonegate appraisal',
  inputs_snapshot: {},
  calc_version: '2.9.0',
  inputs_version: 4,
  status: 'reconciled',
  input_hash: 'a'.repeat(64),
  outputs_hash: 'b'.repeat(64),
  audit_hash: 'c'.repeat(64),
  gdv_pence: null, total_cost_pence: null, profit_on_cost_pct: null,
  profit_on_gdv_pct: null, return_on_equity_pct: null, irr: null, rlv_pence: null,
  created_at: '2026-08-16T10:00:00Z',
  updated_at: '2026-08-16T10:00:00Z',
};

/** Fixed so a report's bytes are reproducible run to run. */
const FIXED_NOW = new Date('2026-08-17T09:30:00Z');

function provenanceFor(
  run: ReturnType<typeof runAppraisal>,
  overrides: Partial<Parameters<typeof buildProvenance>[2]> = {},
  record: FinancialAppraisal | null = savedRecord,
): ReportProvenance {
  return buildProvenance(run, record, {
    now: FIXED_NOW,
    timeZone: 'Europe/London',
    ...overrides,
  });
}

async function report(
  inputs: AnyCalculatorInputs,
  options: { project?: Project; provenance?: ReportProvenance | null } = {},
): Promise<{ info: PdfDocumentInfo; run: ReturnType<typeof runAppraisal> }> {
  const run = runAppraisal(inputs);
  const prov = options.provenance === undefined ? provenanceFor(run) : options.provenance;
  const blob = generateInvestmentMemo(options.project ?? qaProject, run, qaEligibility, prov);
  return { info: await inspectPdf(blob), run };
}

const ROUTES: Array<[string, () => AnyCalculatorInputs]> = [
  ['sell-all', sellAllInputs],
  ['retain-all', retainAllInputs],
  ['refinance', refinanceInputs],
  ['blended', blendedInputs],
  ['legacy migrated draft', () => migrateInputsToV4(legacyV1Snapshot(), qaProject)],
  // R8 (spec §14). The standing corpus previously held no non-English, non-v4
  // document, so every route above prints an England/NI SDLT case and none of
  // them exercises a Welsh or Scottish memo's actually-different string
  // lengths — exactly the difference the page-bounds, sparse-page and orphan
  // gates below exist to catch.
  ['wales (LTT)', welshInputs],
  ['scotland (LBTT)', scottishInputs],
  ['unconfirmed jurisdiction', unconfirmedJurisdictionInputs],
  // R9 (Task 11, spec §15). A populated, bridge-derived area schedule with a
  // material unallocated balance and per-unit ancillary value — the layout
  // sweep above never exercised the area-schedule table, the efficiency
  // ratios, the unallocated disclosure or the GDV split before this fixture.
  ['area bridge + ancillary', bridgeAndAncillaryInputs],
  // R9 fix round 1 (Important 1). The same populated content, stacked with
  // the tallest jurisdiction strings and the DRAFT - TAX BASIS UNCONFIRMED
  // banner, so this sweep also stresses the interaction class that produced
  // the round-1 blank-trailing-page bug — content growth pushing a table
  // past CONTENT_BOTTOM — under the longest-text route, not only the
  // shortest (England/NI, fully evidenced) one above.
  ['area bridge + ancillary, scotland (LBTT), unconfirmed jurisdiction', bridgeAncillaryScottishUnconfirmedInputs],
];

describe('investment memorandum release gate', () => {
  describe.each(ROUTES)('%s', (_name, makeInputs) => {
    it('keeps every drawn item inside the page', async () => {
      const { info } = await report(makeInputs());
      const violations = overflowingItems(info);
      expect(
        violations.map(
          (v) =>
            `page ${v.page}: "${v.item.text.slice(0, 60)}" at ${v.item.sizePt}pt `
            + `crosses ${v.edges.join('+')} (box ${v.item.box.left.toFixed(1)}..${v.item.box.right.toFixed(1)}mm `
            + `x ${v.item.box.top.toFixed(1)}..${v.item.box.bottom.toFixed(1)}mm)`,
        ),
      ).toEqual([]);
    });

    it('has no blank, orphaned or sparsely populated page', async () => {
      const { info } = await report(makeInputs());
      const sparse = sparsePages(info);
      expect(
        sparse.map(
          (s) =>
            `page ${s.page}: ${s.reason} — extent ${(s.extentRatio * 100).toFixed(0)}%, `
            + `ink ${(s.fillRatio * 100).toFixed(0)}%, ${s.itemCount} items`,
        ),
      ).toEqual([]);
    });

    it('never leaves a heading alone at the foot of a page', async () => {
      const { info } = await report(makeInputs());
      expect(
        orphanHeadings(info).map((o) => `page ${o.page}: "${o.text}" (${o.sizePt}pt)`),
      ).toEqual([]);
    });

    it('gives every page a running footer and no page beyond the last', async () => {
      const { info } = await report(makeInputs());
      expect(info.pages.length).toBeGreaterThan(5);
      // Every page after the cover carries "Page n of m", and m is the real count.
      const expectedTotal = info.pages.length - 1;
      for (const page of info.pages.slice(1)) {
        const footer = page.items.filter((i) => i.baselineMm >= 282).map((i) => i.text);
        expect(footer).toContain(`Page ${page.page - 1} of ${expectedTotal}`);
        expect(footer).toContain('CONFIDENTIAL');
      }
    });

    it('prints every required provenance field', async () => {
      const { info } = await report(makeInputs());
      const text = documentText(info);
      for (const label of [
        'Appraisal ID', 'Project ID', 'Scenario', 'Input schema version',
        'Calculation version', 'Authoritative result hash', 'Input hash',
        'Audit hash', 'Generated', 'Report-safe status', 'Document status', 'Lender case',
        // R8 (spec §14): the tax basis the printed acquisition tax rests on.
        'Tax jurisdiction applied', 'Acquisition tax table version',
      ]) {
        expect(text, `provenance field "${label}" missing`).toContain(label);
      }
      expect(text).toContain(savedRecord.id);
      expect(text).toContain(savedRecord.outputs_hash!);
      expect(text).toContain(savedRecord.audit_hash!);
      expect(text).toContain('2.9.0');
      expect(text).toContain('Europe/London');
      // Fix round 1 (item 4): the row's value, which survived being replaced by
      // 'n/a'. Asserted adjacent to its own label so it cannot be satisfied by
      // the same version string printed somewhere else on the page.
      expect(countOccurrences(documentProse(info), `Acquisition tax table version ${TAX_TABLE_VERSION}`)).toBe(1);
    });

    it('never claims a full cost plan', async () => {
      const { info } = await report(makeInputs());
      const text = documentText(info).toLowerCase();
      expect(text).toContain('headline cost estimate');
      expect(text).not.toContain('full cost plan');
    });

    it('states its own limitations, including the tax and VAT basis', async () => {
      const { info, run } = await report(makeInputs());
      const prose = documentProse(info);
      expect(prose).toContain('Basis of Preparation and Limitations');
      // R8 (spec §14). This assertion used to pin the sentence "Acquisition tax
      // is calculated on the England and Northern Ireland non-residential SDLT
      // bands. A property in Scotland (LBTT) or Wales (LTT) is not correctly
      // taxed by this version." Both halves stopped being true when the engine
      // became jurisdiction-aware, so the gate now pins the opposite: the memo
      // names the regime it actually applied — whatever regime that is for
      // this route, read off the run's own authoritative result rather than
      // hard-coded, now that the corpus includes non-SDLT routes — and never
      // disclaims the other two.
      expect(checkAcquisitionTaxDisclosure(info, {
        jurisdiction: run.metrics.acquisition_tax.jurisdiction,
        regime: run.metrics.acquisition_tax.regime,
      })).toEqual([]);
      // Fix round 1 (item 4). Traceability to a dated table is the whole point
      // of the table, so the *value* is pinned, not merely the label — both
      // prose sites survived being replaced with a literal 9.9.9. Compared
      // against the exported constant so a legitimate table bump does not have
      // to be chased through the report tests.
      expect(countOccurrences(prose, `(assumption table version ${TAX_TABLE_VERSION})`)).toBe(1);
      expect(countOccurrences(prose, `(table ${TAX_TABLE_VERSION})`)).toBe(1);
      // R11 (spec §17.13). This assertion used to pin "VAT is not modelled as
      // a cash flow" — false the moment the VAT engine shipped (Task 12). The
      // gate now pins §17.13's actual residual scope: no computed
      // partial-exemption engine, no separate VAT facility, no capital goods
      // scheme, no TOGC conditions assessment, and out-of-term reclaims
      // reported as receivable rather than as cash.
      expect(prose).toContain('not a computed partial-exemption');
      expect(prose).toContain('no separate VAT facility');
      expect(prose).toContain('No capital goods scheme, option-to-tax revocation or self-supply charge');
      expect(prose).toContain('not tested against the conditions for relief');
      expect(prose).toContain('reported as receivable and is not credited to the cash flow');
      expect(prose).not.toContain('VAT is not modelled as a cash flow');
      expect(prose).toContain('not a credit paper');
    });
  });

  it('repairs a scraped description whose heading was glued to its first sentence', async () => {
    const { info } = await report(sellAllInputs());
    const prose = documentProse(info);
    // The audit reported this string in the exported memo. The scraper is fixed
    // (tests/test_adapter_description_spacing.py); this covers the records
    // already stored with it.
    expect(qaProject.description).toContain('DescriptionThe'); // fixture sanity check
    expect(prose).not.toContain('DescriptionThe');
    expect(prose).toContain('The subject comprises a mid-terrace period building');
  });

  // ── Generated prose says each thing once ─────────────────────────────────
  //
  // R6's lesson, in a new place: `toContain` cannot see a repeat, so a document
  // that states a requirement twice passes every substring assertion written
  // about it. Both defects below were live, and both were found by rendering a
  // page and reading it. Counting is what makes them a gate.

  function countOccurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  it('lists each information requirement once', async () => {
    const prose = documentProse((await report(sellAllInputs())).info);
    // Folding the old "Additional Appendices Required" block into the numbered
    // schedule printed team CVs, the professional team schedule and the
    // insurance schedule twice each, under two wordings.
    for (const phrase of ['collateral warranties', 'CAR, PI', 'CVs']) {
      expect(countOccurrences(prose, phrase), `"${phrase}" appears more than once`).toBe(1);
    }
  });

  it('gives the reason a document is a draft once, not once per phrasing', async () => {
    const prose = documentProse((await report(sellAllInputs())).info);
    // With no lender case submitted, "no lender case has been submitted" and
    // "no lender case has been credit approved" are the same fact twice.
    expect(countOccurrences(prose, 'No lender case has been submitted for credit approval')).toBe(1);
    expect(countOccurrences(prose, 'no lender case has been credit approved')).toBe(0);
  });

  it('keeps both sentences when the lender case exists but is unapproved', async () => {
    // The collapse above must not swallow a genuinely different second fact.
    const run = runAppraisal(sellAllInputs());
    const prov = provenanceFor(run, { lenderCaseStatus: 'information_required' });
    const info = await inspectPdf(generateInvestmentMemo(qaProject, run, qaEligibility, prov));
    const prose = documentProse(info);
    expect(prose).toContain('The lender case is at "Information required".');
    expect(prose).toContain('It is a draft because no lender case has been credit approved.');
  });

  // ── Watermark and document status ────────────────────────────────────────

  it('watermarks an unreconciled run as UNRECONCILED, on every physical page', async () => {
    const inputs = migrateInputsToV4(legacyV1Snapshot(), qaProject);
    const { info, run } = await report(inputs);
    expect(run.reconciliation.report_safe).toBe(false); // fixture sanity check

    for (const page of info.pages) {
      expect(watermarkTexts(page), `page ${page.page}`).toContain(
        'DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE',
      );
    }
  });

  it('watermarks a reconciled but unapproved run as NOT APPROVED, never as unreconciled', async () => {
    const { info, run } = await report(sellAllInputs());
    expect(run.reconciliation.report_safe).toBe(true); // fixture sanity check

    const banners = info.pages.flatMap(watermarkTexts);
    expect(banners).toContain('DRAFT - NOT APPROVED FOR LENDER RELIANCE');
    // The figures reconcile — saying otherwise would be a false statement about
    // the model, not a cautious one.
    expect(banners.join(' ')).not.toContain('UNRECONCILED');
    expect(documentText(info)).toContain('Document status');
  });

  it('drops the watermark only when the run reconciles AND a lender case is approved', async () => {
    const run = runAppraisal(sellAllInputs());
    const approved = provenanceFor(run, { lenderCaseStatus: 'credit_approved' });
    expect(approved.documentStatus).toBe('FINAL');

    const blob = generateInvestmentMemo(qaProject, run, qaEligibility, approved);
    const info = await inspectPdf(blob);
    expect(info.pages.flatMap(watermarkTexts)).toEqual([]);
    expect(documentText(info)).toContain('FINAL');
  });

  it('keeps the watermark when a lender case exists but is not approved', async () => {
    const run = runAppraisal(sellAllInputs());
    for (const status of ['under_review', 'information_required', 'declined'] as const) {
      const prov = provenanceFor(run, { lenderCaseStatus: status });
      expect(prov.documentStatus, status).toBe('DRAFT');
      const info = await inspectPdf(generateInvestmentMemo(qaProject, run, qaEligibility, prov));
      expect(info.pages.flatMap(watermarkTexts), status).toContain('DRAFT - NOT APPROVED FOR LENDER RELIANCE');
    }
  });

  it('never lets a senior-repayment failure out as a FINAL document', async () => {
    // A retain-all case books no receipts, so the facility is still outstanding
    // at maturity. `report_safe` does not fail for that on its own -- an
    // appraisal may legitimately intend to refinance later -- which is exactly
    // why the FINAL gate has to test repayment separately (spec 13.3).
    const run = runAppraisal(retainAllInputs());
    expect(run.reconciliation.report_safe).toBe(true);
    expect(run.reconciliation.senior_repaid).toBe(false);

    const prov = provenanceFor(run, { lenderCaseStatus: 'credit_approved' });
    expect(prov.documentStatus).toBe('DRAFT');
    expect(prov.draftReason).toBe('senior_not_repaid');

    const info = await inspectPdf(generateInvestmentMemo(qaProject, run, qaEligibility, prov));
    expect(info.pages.flatMap(watermarkTexts)).toContain(
      'DRAFT - SENIOR DEBT NOT REPAID - NOT FOR LENDER RELIANCE',
    );
    expect(documentProse(info)).toContain(
      'no document showing an unrepaid senior balance at maturity can be issued as a final lender report',
    );
  });

  // ── R8: the tax basis the memo prints (spec §14) ─────────────────────────
  //
  // The memo used to state, on every document, that the figure was England/NI
  // SDLT and that Scotland and Wales were "not correctly taxed by this
  // version". Once the engine became jurisdiction-aware that was not an
  // omission but a false statement on a credit paper: it invited a committee to
  // discount a figure that was right. These assert the corrected copy by
  // counting, because a substring check cannot see the true sentence printed
  // beside a surviving copy of the false one.

  /** `sellAllInputs` as a v5 document with the acquisition tax block set. */
  function v5WithAcquisition(patch: Record<string, unknown>): AnyCalculatorInputs {
    const doc = JSON.parse(JSON.stringify(sellAllInputs())) as Record<string, unknown>;
    doc.inputs_version = 5;
    doc.acquisition = {
      ...(doc.acquisition as Record<string, unknown>),
      jurisdiction: 'england_ni',
      jurisdiction_source: 'user',
      jurisdiction_evidence_status: 'confirmed',
      acquisition_date: '2026-01-15',
      acquisition_tax_override_pence: null,
      acquisition_tax_override_reason: '',
      ...patch,
    };
    return doc as unknown as AnyCalculatorInputs;
  }

  it('names the regime actually applied to a Scottish acquisition', async () => {
    const { info } = await report(scottishInputs());
    const prose = documentProse(info);
    // Twice, deliberately and exactly: the Appendix A assumption row and the
    // §13 limitation sentence. A third would mean a section printed it again.
    // `checkAcquisitionTaxDisclosure` below asserts the regime is named at
    // each of those two places (plus the provenance row) and that neither
    // retired false statement survives; this pins the *date* specifically,
    // which the helper does not, because a correct regime quoting the wrong
    // band-set date would still pass every check the helper runs.
    expect(countOccurrences(prose, 'in force from 25 Jan 2019')).toBe(2);
    expect(checkAcquisitionTaxDisclosure(info, { jurisdiction: 'scotland', regime: 'LBTT' })).toEqual([]);
  });

  it('names the regime actually applied to a Welsh acquisition', async () => {
    const { info } = await report(welshInputs());
    const prose = documentProse(info);
    // The LTT band set in force from 22 Dec 2020 covers the fixture's
    // 10 Feb 2026 transaction date.
    expect(countOccurrences(prose, 'in force from 22 Dec 2020')).toBe(2);
    expect(checkAcquisitionTaxDisclosure(info, { jurisdiction: 'wales', regime: 'LTT' })).toEqual([]);
  });

  it('holds a document in DRAFT while the jurisdiction is unconfirmed', async () => {
    const run = runAppraisal(unconfirmedJurisdictionInputs());
    const prov = provenanceFor(run, { lenderCaseStatus: 'credit_approved' });
    expect(prov.draftReason).toBe('tax_basis_unconfirmed');

    const info = await inspectPdf(generateInvestmentMemo(qaProject, run, qaEligibility, prov));
    const banners = info.pages.flatMap(watermarkTexts);
    expect(banners).toContain('DRAFT - TAX BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE');
    // Named as its own reason, never collapsed into "unreconciled": the
    // arithmetic is sound, the basis for it is merely unevidenced.
    expect(banners.join(' ')).not.toContain('UNRECONCILED');
    const prose = documentProse(info);
    expect(countOccurrences(prose, 'the acquisition tax jurisdiction has not been confirmed')).toBe(1);
    expect(countOccurrences(prose, "Evidence of the property's jurisdiction")).toBe(1);
    // Fix round 1 (item 2). The qualifier on the provenance row survived being
    // deleted outright, so it is pinned by count here and by its legacy
    // counterpart in the test below.
    expect(countOccurrences(prose, 'England & Northern Ireland (SDLT) — basis unconfirmed')).toBe(1);
    expect(overflowingItems(info).map((v) => v.item.text)).toEqual([]);
    // The regime itself (SDLT, since this fixture is England/NI) is still
    // named correctly and once, and neither retired false statement is back.
    expect(checkAcquisitionTaxDisclosure(info, { jurisdiction: 'england_ni', regime: 'SDLT' })).toEqual([]);
  });

  it('calls a pre-R8 jurisdiction assumed, without re-grading the document', async () => {
    // The defect this closes: `sellAllInputs` is a v4 document with no
    // jurisdiction field at all. `deriveMetrics` defaults it to england_ni, and
    // the legacy exemption lets it reach FINAL — so, uncorrected, a credit paper
    // that can be issued FINAL asserted a defaulted jurisdiction as a recorded
    // fact. The document must still be able to reach FINAL (it is not re-graded
    // against a condition that post-dates it); it must not overstate its basis.
    const run = runAppraisal(sellAllInputs());
    const prov = provenanceFor(run, { lenderCaseStatus: 'credit_approved' });
    expect(prov.documentStatus).toBe('FINAL');
    expect(prov.jurisdictionRecorded).toBe(false);

    const info = await inspectPdf(generateInvestmentMemo(qaProject, run, qaEligibility, prov));
    const prose = documentProse(info);
    expect(countOccurrences(prose, 'assumed; no jurisdiction recorded on this document')).toBe(1);
    expect(countOccurrences(
      prose,
      'This document records no jurisdiction, so England & Northern Ireland has been assumed rather than evidenced',
    )).toBe(1);
    expect(countOccurrences(prose, "The property's jurisdiction. This document records none")).toBe(1);
    // The two requests are alternatives, not a pair: this document has no
    // evidence status to be unconfirmed, so it is never asked to evidence one.
    expect(countOccurrences(prose, "Evidence of the property's jurisdiction")).toBe(0);
    expect(overflowingItems(info).map((v) => v.item.text)).toEqual([]);
  });

  it('asks for the transaction date once when the band set was assumed', async () => {
    const { info } = await report(v5WithAcquisition({ acquisition_date: null }));
    const prose = documentProse(info);
    expect(countOccurrences(prose, 'The date of the transaction.')).toBe(1);
  });

  it('discloses an acquisition tax override with the figure it replaced', async () => {
    const { info, run } = await report(v5WithAcquisition({
      acquisition_tax_override_pence: 123_456,
      acquisition_tax_override_reason: 'Group relief claimed on the transfer',
    }));
    expect(run.metrics.acquisition_tax.is_override).toBe(true);
    const prose = documentProse(info);
    expect(countOccurrences(prose, 'Supporting advice for the acquisition tax override')).toBe(1);
    expect(countOccurrences(prose, 'Group relief claimed on the transfer')).toBe(1);
    // The ROUTES layout sweep never reaches this line (it needs a v5 override),
    // and a free-text override reason is exactly the kind of unbounded string
    // that used to be drawn off the right-hand edge. Measured, not assumed.
    expect(overflowingItems(info).map((v) => v.item.text)).toEqual([]);
  });

  it('keeps a confirmed, dated document free of every tax information request', async () => {
    // The negative control: the three requests above must be conditional, not
    // printed on every memo.
    const { info } = await report(v5WithAcquisition({}));
    const prose = documentProse(info);
    for (const phrase of [
      "Evidence of the property's jurisdiction",
      "The property's jurisdiction. This document records none",
      'The date of the transaction.',
      'Supporting advice for the acquisition tax override',
      // No qualifier at all on a document whose basis is fully evidenced —
      // neither of the two the fix introduced.
      'assumed; no jurisdiction recorded on this document',
      'basis unconfirmed',
      'has been assumed rather than evidenced',
    ]) {
      expect(countOccurrences(prose, phrase), phrase).toBe(0);
    }
  });

  // ── Reconciliation of printed figures to authoritative outputs ───────────

  it('prints only the authoritative headline figures', async () => {
    const { info, run } = await report(sellAllInputs());
    const text = documentText(info);
    const money = (pence: number) =>
      (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

    for (const [label, printed] of [
      ['GDV', money(run.metrics.gdv_pence)],
      ['total development cost', money(run.metrics.total_development_cost_pence)],
      ['profit', money(run.metrics.profit_pence)],
      ['equity contributed', money(run.metrics.equity_contributed_pence)],
      ['peak debt', money(run.metrics.peak_debt_pence)],
    ] as const) {
      expect(text, `${label} (${printed}) not printed`).toContain(printed);
    }
    expect(text).toContain(`${run.metrics.profit_on_cost_pct!.toFixed(1)}%`);
    expect(text).toContain(`${run.metrics.profit_on_gdv_pct!.toFixed(1)}%`);
  });

  // ── Unrealised returns (audit §6.3) ─────────────────────────────────────

  it('labels return on equity unrealised and suppresses the equity multiple when nothing is realised', async () => {
    const { info, run } = await report(retainAllInputs());
    expect(run.metrics.has_realisation_event).toBe(false);
    expect(run.metrics.equity_multiple).toBeNull();

    const text = documentText(info);
    expect(text).toContain('Return on Equity (unrealised)');
    expect(documentProse(info)).toContain('not available — no sale or refinance modelled within the term');
    // The figure that confused the audit's reviewer must not appear at all.
    expect(text).not.toContain('0.00x');
  });

  it('reports a realised multiple, unqualified, when the units are sold', async () => {
    const { info, run } = await report(sellAllInputs());
    expect(run.metrics.has_realisation_event).toBe(true);
    expect(run.metrics.equity_multiple).not.toBeNull();

    const text = documentText(info);
    expect(text).toContain(`${run.metrics.equity_multiple!.toFixed(2)}x`);
    expect(text).not.toContain('Return on Equity (unrealised)');
  });

  it('distinguishes a partial retention from nothing realised at all', async () => {
    const retained = documentProse((await report(retainAllInputs())).info);
    const blended = documentProse((await report(blendedInputs())).info);

    expect(retained).toContain('No sale or refinance is modelled within the term');
    expect(blended).toContain('include the market value of the retained units');
    expect(blended).not.toContain('No sale or refinance is modelled within the term');
  });

  // ── Disclosure of what is unconfirmed (audit §9 release gate) ────────────

  it('discloses an unavailable lender valuation rather than adopting developer GDV', async () => {
    const inputs = sellAllInputs();
    inputs.lender_valuation = null;
    const { info, run } = await report(inputs);
    expect(run.metrics.lender_gdv_pence).toBeNull();
    expect(documentProse(info)).toContain('No lender-underwritten valuation has been provided');
  });

  it('discloses migrated, unconfirmed facility terms', async () => {
    const { info, run } = await report(migrateInputsToV4(legacyV1Snapshot(), qaProject));
    expect(run.inputs.finance.requires_confirmation).toBe(true);
    expect(documentProse(info)).toContain('migrated from an earlier record and remain unconfirmed');
  });

  it('says so when the printed figures were recomputed under a newer model version', async () => {
    const run = runAppraisal(sellAllInputs());
    const stale: FinancialAppraisal = { ...savedRecord, calc_version: '2.4.0' };
    const prov = buildProvenance(run, stale, { now: FIXED_NOW, timeZone: 'Europe/London' });
    expect(prov.recomputedSinceSave).toBe(true);

    const info = await inspectPdf(generateInvestmentMemo(qaProject, run, qaEligibility, prov));
    expect(documentProse(info)).toContain('the stored result was produced under 2.4.0');
  });

  it('says the hashes are absent rather than printing nothing, for an unsaved run', async () => {
    const { info } = await report(sellAllInputs(), { provenance: null });
    const prose = documentProse(info);
    expect(prose).toContain('unsaved — generated from an in-session run');
    expect(prose).toContain('not recorded — result predates provenance hashing');
  });

  // ── Geometry regression ─────────────────────────────────────────────────

  it('draws body text only at the memo\'s declared type sizes', async () => {
    const { info } = await report(sellAllInputs());
    const sizes = new Set(info.pages.flatMap((p) => bodyItems(p).map((i) => i.sizePt)));
    // 24pt is the cover title; 7-14pt is the body scale. Anything above 24 is
    // style bleed from the watermark, which is exactly how page 8 broke.
    for (const size of sizes) {
      expect(size, `unexpected type size ${size}pt`).toBeLessThanOrEqual(24);
      expect(size, `unexpected type size ${size}pt`).toBeGreaterThanOrEqual(6);
    }
  });

  it('produces the same layout for the same inputs', async () => {
    const first = await report(sellAllInputs());
    const second = await report(sellAllInputs());
    expect(describeLayout(second.info)).toBe(describeLayout(first.info));
  });

  // ── R9: the area bridge and the GDV split (Task 11, spec §15) ────────────

  it('states the manual cost-area basis in words for a document with no area schedule', async () => {
    // sellAllInputs() carries no `areas` block at all (every standing route
    // fixture above predates R9), which resolves to the manual basis with a
    // zeroed bridge — exactly what migration writes for every pre-R9 document.
    const { info, run } = await report(sellAllInputs());
    expect(run.metrics.area_bridge.basis).toBe('manual');
    expect(documentText(info)).toContain('Construction area entered manually');
  });

  it('prints the reconciliation, the efficiencies and the GDV split for a populated bridge', async () => {
    const { info, run } = await report(bridgeAndAncillaryInputs());
    expect(run.metrics.area_bridge.basis).toBe('bridge_derived');
    const text = documentText(info);
    expect(text).toContain('Construction area derived from the area schedule');
    expect(text).toContain('Proposed GIA');
    expect(text).toContain('Developed area');
    expect(text).toContain('Net to gross');
    expect(text).toContain('Saleable to developed');
    expect(text).toContain('Internal saleable value');
    expect(text).toContain('Parking, balconies and terraces');
    // Fixture geometry (see memo-fixtures.ts doc comment): 50 m² of the 400 m²
    // developed area, 12.5%, comfortably over the 10% materiality line.
    expect(run.metrics.area_bridge.unallocated_sqm).toBe(50);
    expect(text).toContain('50.0 m² of the developed area is unallocated');
    // R9 pays off the stale "until valued separately in R3" promise (spec
    // §3.1) — a zero-count assertion, not a substring check, because the
    // memo containing the *correct* new copy would sail straight past a
    // `toContain` for it while the stale promise sat right beside it.
    expect(text).not.toContain('valued separately');
  });

  // Fix round 1 (Important 1). This route is already carried through the full
  // page-bounds/sparse-page/orphan-heading/footer/provenance sweep via
  // `ROUTES` above; this test only pins that the three things it is meant to
  // combine are actually present together on the document it produces, so a
  // future edit cannot quietly drop one of them and still pass the sweep.
  it('combines the populated area content with the tallest jurisdiction strings and an unconfirmed tax basis', async () => {
    const run = runAppraisal(bridgeAncillaryScottishUnconfirmedInputs());
    expect(run.reconciliation.report_safe).toBe(true); // sanity: draft status comes from the tax basis, not a reconciliation failure
    const prov = provenanceFor(run, { lenderCaseStatus: 'credit_approved' });
    expect(prov.draftReason).toBe('tax_basis_unconfirmed'); // sanity fixture check

    const info = await inspectPdf(generateInvestmentMemo(qaProject, run, qaEligibility, prov));
    expect(info.pages.flatMap(watermarkTexts)).toContain('DRAFT - TAX BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE');
    const text = documentText(info);
    expect(text).toContain('Scotland');
    expect(text).toContain('LBTT');
    expect(text).toContain('Area Schedule');
    expect(text).toContain('Internal saleable value');
    expect(overflowingItems(info).map((v) => v.item.text)).toEqual([]);
    expect(sparsePages(info)).toEqual([]);
  });
});

/**
 * R10 Task 13 (spec §16, CARRIED-1). Every ROUTES fixture above is a v4/v5/v6
 * (headline-mode) document, so the sweep above never exercises the
 * mode-dependent cost section at all: not the "Detailed Cost Plan — QS
 * Evidence Not Recorded" heading, not the package schedule, not a contingency
 * class resolving against a base other than the whole base build. These
 * assertions follow the same positioned-text convention as the rest of this
 * file — read off the inspected PDF's own draw stream via `documentText`, not
 * off the generator's intentions — and compute their expected strings from
 * the run's own `metrics.cost_plan`, the same discipline
 * `checkAcquisitionTaxDisclosure` (report-checks.ts) uses for the tax regime
 * strings, so a label or a base figure that drifts in the generator is caught
 * without the assertion itself hard-coding a second, independent copy of the
 * arithmetic.
 */
function fmtGBP(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}
function fmtPercent(pct: number): string {
  return `${pct.toFixed(1)}%`;
}
const CONTINGENCY_BASIS_LABEL = { all_packages: 'all packages', selected_packages: 'selected packages' } as const;

describe('R10 cost-plan modes (spec §16)', () => {
  it('renders the headline cost section, and only the headline heading', async () => {
    const { info } = await report(sellAllInputs());
    const text = documentText(info);
    expect(text).toContain('Headline Cost Estimate');
    expect(text).not.toContain('Detailed Cost Plan');
  });

  it('renders the detailed cost section, discloses QS evidence is not recorded, and prints the package schedule', async () => {
    const inputs = detailedCostPlanInputs();
    const run = runAppraisal(inputs);
    const { info } = await report(inputs);
    const text = documentText(info);
    expect(text).toContain('Detailed Cost Plan — QS Evidence Not Recorded');
    expect(text).not.toContain('Headline Cost Estimate');
    // The package schedule itself — every package in the fixture's cost plan
    // is drawn with its label and its own amount, not summarised away.
    for (const p of run.metrics.cost_plan.packages) {
      expect(text).toContain(p.label);
      expect(text).toContain(fmtGBP(p.amount_pence));
    }
    // The route sweep above (`ROUTES`) never runs a detailed-mode document
    // through the page-bounds / sparse-page gate, so the new package-schedule
    // rows get their own check here rather than an assumption that a longer
    // table behaves the same as the ones already swept.
    expect(overflowingItems(info).map((v) => v.item.text)).toEqual([]);
    expect(sparsePages(info)).toEqual([]);
  });

  it('prints each contingency class beside its own resolved base, in both modes', async () => {
    for (const makeInputs of [sellAllInputs, detailedCostPlanInputs]) {
      const inputs = makeInputs();
      const run = runAppraisal(inputs);
      const { info } = await report(inputs);
      const text = documentText(info);
      // Non-vacuity: the loop below would pass trivially over an empty array.
      expect(run.metrics.cost_plan.contingency.length).toBe(3);
      for (const c of run.metrics.cost_plan.contingency) {
        const expectedLine =
          `  ${humanise(c.name)} contingency — ${fmtPercent(c.pct)} of `
          + `${CONTINGENCY_BASIS_LABEL[c.basis]} (${fmtGBP(c.base_pence)})`;
        expect(text, `${makeInputs.name}: ${c.name}`).toContain(expectedLine);
      }
      // The fixture's whole point (memo-fixtures.ts doc comment): the three
      // classes resolve against three DIFFERENT bases in detailed mode, so a
      // regression that resolved every class against the base build alone
      // would still pass a test that only checked the base appeared, not
      // that it appeared correctly per class.
      if (makeInputs === detailedCostPlanInputs) {
        const bases = new Set(run.metrics.cost_plan.contingency.map((c) => c.base_pence));
        expect(bases.size).toBe(3);
      }
    }
  });

  // Fix round 1, F2. In headline mode the six real construction amounts
  // (build rate, three compliance fields, the contingency amount, the
  // construction sub-total) used to appear with no printed figure for the
  // one they sum from — base_build_pence was computed but never shown.
  it('prints the base build figure in headline mode, so the construction section is followable', async () => {
    const inputs = sellAllInputs();
    const run = runAppraisal(inputs);
    const { info } = await report(inputs);
    const text = documentText(info);
    expect(run.metrics.cost_plan.mode).toBe('headline');
    expect(text).toContain('Base build');
    expect(text).toContain(fmtGBP(run.metrics.cost_plan.base_build_pence));
  });

  // Fix round 1, F3 (spec §16.6/§16.9). The pre-R10 limitation ("not a priced
  // quantity-surveyed package schedule") is simply false once a document is
  // in detailed mode — exactly the "stale disclosure survives the feature it
  // described" fault R8 and R9 each fixed in this same list. The honest
  // residual limitation in detailed mode is QS *evidence*, not the schedule
  // itself.
  it('states the true residual cost-basis limitation in each mode', async () => {
    // documentProse, not documentText: the limitation sentence wraps across
    // several drawn lines (autoTable/wrap), so a substring spanning a wrap
    // point ("package" / "schedule.") only matches the whitespace-normalised
    // reflow, the same reasoning checkAcquisitionTaxDisclosure documents.
    const headlineProse = documentProse((await report(sellAllInputs())).info);
    expect(headlineProse).toContain('not a priced quantity-surveyed package schedule');

    const detailedProse = documentProse((await report(detailedCostPlanInputs())).info);
    expect(detailedProse).not.toContain('not a priced quantity-surveyed package schedule');
    expect(detailedProse).toContain('rests on a priced package schedule');
    expect(detailedProse).toContain('No QS source, date or status is recorded');
  });
});
