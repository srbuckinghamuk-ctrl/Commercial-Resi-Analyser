import { describe, it, expect } from 'vitest';
import type { FinancialAppraisal, Project } from '../../types';
import { generateEligibilityPdf, generateAppraisalPdf } from '../export-pdf';
import { computeSpider } from '../deal-spider';
import { inspectPdf } from './pdf-inspect';
import { overflowingItems, documentProse, watermarkTexts } from './report-checks';
import { qaProject, qaEligibility, sellAllInputs } from './memo-fixtures';

/**
 * The two "quick report" PDFs are held to the same page-bounds rule as the
 * investment memorandum.
 *
 * They were laying out by writing at a fixed x with no width bound, which is the
 * same defect the memo had — just without anyone having generated a document
 * long enough to notice. The fixtures below deliberately supply the long inputs
 * a real project produces: a full postal address, a criterion label with a long
 * value, and a blocked spider listing several failing checks.
 */

const longProject: Project = {
  ...qaProject,
  address_raw:
    'Units 4-9 The Old Corn Exchange, 118-124 Stonegate and Little Stonegate, '
    + 'York, North Yorkshire, YO1 8AN, United Kingdom',
  description: qaProject.description,
};

const savedAppraisal: FinancialAppraisal = {
  id: 'd0d0caca-2222-4333-8444-555566667777',
  project_id: longProject.id,
  name: 'Quick appraisal for a scheme with an unusually long descriptive name that wraps',
  inputs_snapshot: {},
  calc_version: '2.9.0',
  inputs_version: 4,
  status: 'legacy_unreconciled',
  gdv_pence: 137_000_000,
  total_cost_pence: 114_369_000,
  profit_on_cost_pct: 19.8,
  profit_on_gdv_pct: 16.5,
  return_on_equity_pct: 56.7,
  irr: null,
  rlv_pence: 51_761_600,
  created_at: '2026-08-16T10:00:00Z',
  updated_at: '2026-08-16T10:00:00Z',
};

describe('quick report release gate', () => {
  it('keeps the eligibility report inside the page with long inputs', async () => {
    const eligibility = {
      ...qaEligibility,
      criteria: [
        ...qaEligibility.criteria,
        {
          key: 'long',
          label: 'Building was in lawful Class E use for a continuous period of at least two years '
            + 'immediately before the date of the application, evidenced by rating records and leases',
          passed: null,
          source: 'user' as const,
          auto_checked: false,
          value: 'Rating list entries 2019-2026; two occupational leases; no gap identified so far',
          risk_flag: 'Continuity of use unconfirmed for the period April to September 2023',
        },
      ],
      suggested_next_steps: [
        'Obtain a certificate of lawful existing use or development to place the two-year '
        + 'continuous Class E use beyond doubt before exchange',
      ],
    };

    const info = await inspectPdf(generateEligibilityPdf(longProject, eligibility));
    expect(overflowingItems(info).map((v) => v.item.text)).toEqual([]);
    // The long label survives wrapping rather than being clipped away.
    expect(documentProse(info)).toContain('evidenced by rating records and leases');
  });

  it('keeps the appraisal report inside the page, watermark included', async () => {
    const spider = computeSpider(sellAllInputs(), qaEligibility);
    const info = await inspectPdf(generateAppraisalPdf(longProject, savedAppraisal, spider));

    expect(
      overflowingItems(info).map(
        (v) => `p${v.page} ${v.edges.join('+')} ${v.item.sizePt}pt "${v.item.text.slice(0, 50)}"`,
      ),
    ).toEqual([]);
  });

  it('watermarks an unreconciled record and leaves a reconciled one clean', async () => {
    const draft = await inspectPdf(generateAppraisalPdf(longProject, savedAppraisal));
    expect(draft.pages.flatMap(watermarkTexts)).toContain(
      'DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE',
    );

    const reconciled = await inspectPdf(
      generateAppraisalPdf(longProject, { ...savedAppraisal, status: 'reconciled' }),
    );
    expect(reconciled.pages.flatMap(watermarkTexts)).toEqual([]);
  });

  it('draws the first line of a page at its own size, not the watermark\'s', async () => {
    // The regression that produced the audit's page 8: a page break repainted
    // the graphics state and the next draw inherited it. Enough content to force
    // several breaks, then assert nothing on any page is drawn at banner size.
    const eligibility = {
      ...qaEligibility,
      criteria: Array.from({ length: 60 }, (_, i) => ({
        key: `c${i}`,
        label: `Criterion ${i}: a label long enough to wrap across more than one line of the report`,
        passed: i % 3 === 0,
        source: 'auto' as const,
        auto_checked: true,
        value: `evidence item ${i}`,
        risk_flag: null,
      })),
    };
    const info = await inspectPdf(generateEligibilityPdf(longProject, eligibility));
    expect(info.pages.length).toBeGreaterThan(2);

    const bodySizes = new Set(
      info.pages.flatMap((p) => p.items.filter((i) => Math.abs(i.angleDeg) < 0.001)).map((i) => i.sizePt),
    );
    expect([...bodySizes].sort((a, b) => a - b)).toEqual([11, 14]);
  });

  it('records document metadata so a reader is told what the file is', async () => {
    const info = await inspectPdf(generateAppraisalPdf(longProject, savedAppraisal));
    expect(info.raw).toContain('/DisplayDocTitle true');
    expect(info.raw).toContain('Financial Appraisal');
    expect(info.raw).toContain('/Lang (en-GB)');
  });
});
