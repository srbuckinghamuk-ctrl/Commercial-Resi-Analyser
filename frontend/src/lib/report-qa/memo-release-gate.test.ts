import { describe, it, expect } from 'vitest';
import type { Project, FinancialAppraisal } from '../../types';
import type { AnyCalculatorInputs } from '../model';
import { runAppraisal, migrateInputsToV4 } from '../model';
import { generateInvestmentMemo } from '../export-investment-memo';
import { buildProvenance } from '../report-provenance';
import type { ReportProvenance } from '../report-provenance';
import { inspectPdf } from './pdf-inspect';
import type { PdfDocumentInfo } from './pdf-inspect';
import {
  overflowingItems, sparsePages, documentText, documentProse, watermarkTexts,
  describeLayout, bodyItems,
} from './report-checks';
import {
  qaProject, qaEligibility, sellAllInputs, retainAllInputs,
  refinanceInputs, blendedInputs, legacyV1Snapshot,
} from './memo-fixtures';

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
  calc_version: '2.6.0',
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
      ]) {
        expect(text, `provenance field "${label}" missing`).toContain(label);
      }
      expect(text).toContain(savedRecord.id);
      expect(text).toContain(savedRecord.outputs_hash!);
      expect(text).toContain(savedRecord.audit_hash!);
      expect(text).toContain('2.6.0');
      expect(text).toContain('Europe/London');
    });

    it('never claims a full cost plan', async () => {
      const { info } = await report(makeInputs());
      const text = documentText(info).toLowerCase();
      expect(text).toContain('headline cost estimate');
      expect(text).not.toContain('full cost plan');
    });

    it('states its own limitations, including the tax and VAT basis', async () => {
      const { info } = await report(makeInputs());
      const prose = documentProse(info);
      expect(prose).toContain('Basis of Preparation and Limitations');
      expect(prose).toContain('England and Northern Ireland non-residential SDLT bands');
      expect(prose).toContain('VAT is not modelled as a cash flow');
      expect(prose).toContain('not a credit paper');
    });
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
});
