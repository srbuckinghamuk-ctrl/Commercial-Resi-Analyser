import { describe, it, expect } from 'vitest';
import { buildEligibilityContent, buildAppraisalContent, generateAppraisalPdf, formatPence } from './export-pdf';
import type { Project, EligibilityAssessment, FinancialAppraisal } from '../types';

async function pdfText(blob: Blob): Promise<string> {
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab).toString('latin1');
}

const mockProject: Project = {
  id: 'test-id',
  address_raw: '1 Test Street, London, SW1A 1AA',
  address_line1: null,
  address_line2: null,
  address_town: 'London',
  address_county: null,
  address_postcode: 'SW1A 1AA',
  address_postcode_district: 'SW1A',
  pa_submitted_date: null,
  pa_decision_date: null,
  price_pence: 50000000,
  price_qualifier: null,
  use_class: 'office',
  floor_area_sqft: 2000,
  floor_area_sqm: 185.8,
  floors: 2,
  tenure: 'freehold',
  lease_years_remaining: null,
  current_use_description: 'Office',
  epc_rating: 'C',
  is_vacant: true,
  vacancy_date: '2026-01-01',
  source_url: null,
  source_name: null,
  description: null,
  image_urls: [],
  stage: 'eligibility_assessed',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockAssessment: EligibilityAssessment = {
  id: 'assess-id',
  project_id: 'test-id',
  pdr_class: 'class_ma',
  ruleset_version: 'gpdo-2026-08.2',
  criteria: [
    { key: 'use_class', label: 'Use class E(a) office', passed: true, source: 'user', auto_checked: false, value: 'office', risk_flag: null },
    { key: 'floor_area', label: 'Floor area ≤ 1,500 sq m', passed: false, source: 'auto', auto_checked: true, value: '185.8 sq m', risk_flag: null },
  ],
  verdict: 'red',
  suggested_next_steps: ['Verify floor area', 'Check Article 4'],
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockAppraisal: FinancialAppraisal = {
  id: 'appr-id',
  project_id: 'test-id',
  name: 'Base Case',
  inputs_snapshot: {},
  outputs: {
    metrics: {
      gdv_pence: 120000000, total_development_cost_pence: 85000000,
      profit_on_cost_pct: 41.2, profit_on_gdv_pct: 29.2, return_on_equity_pct: 62.5,
      irr_annual_pct: 28, rlv_pence: 38000000,
    },
    reconciliation: { report_safe: true },
  } as unknown as FinancialAppraisal['outputs'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('buildEligibilityContent', () => {
  it('returns lines containing project address', () => {
    const lines = buildEligibilityContent(mockProject, mockAssessment);
    expect(lines.some((l) => l.includes('1 Test Street'))).toBe(true);
  });

  it('includes verdict', () => {
    const lines = buildEligibilityContent(mockProject, mockAssessment);
    expect(lines.some((l) => l.toLowerCase().includes('red'))).toBe(true);
  });

  it('includes each criterion', () => {
    const lines = buildEligibilityContent(mockProject, mockAssessment);
    expect(lines.some((l) => l.includes('Use class E(a) office'))).toBe(true);
    expect(lines.some((l) => l.includes('Floor area'))).toBe(true);
  });

  it('includes suggested next steps', () => {
    const lines = buildEligibilityContent(mockProject, mockAssessment);
    expect(lines.some((l) => l.includes('Verify floor area'))).toBe(true);
  });
});

describe('buildAppraisalContent', () => {
  it('returns lines containing project address', () => {
    const lines = buildAppraisalContent(mockProject, mockAppraisal);
    expect(lines.some((l) => l.includes('1 Test Street'))).toBe(true);
  });

  it('includes key financial metrics', () => {
    const lines = buildAppraisalContent(mockProject, mockAppraisal);
    const text = lines.join('\n');
    expect(text).toContain(`GDV: ${formatPence(120000000)}`);
    expect(text).toContain('Profit on Cost');
    expect(text).toContain('IRR');
  });

  // R17 spec §13.1: the ROE line is labelled by the stored realisation flag.
  it('labels ROE "Unrealised Return on Equity" when the stored flag is true', () => {
    const appraisal = {
      ...mockAppraisal,
      outputs: {
        ...(mockAppraisal.outputs as object),
        metrics: { ...(mockAppraisal.outputs as { metrics: object }).metrics, return_on_equity_is_unrealised: true },
      },
    } as unknown as FinancialAppraisal;
    const text = buildAppraisalContent(mockProject, appraisal).join('\n');
    expect(text).toContain('  Unrealised Return on Equity: 62.5%');
    expect(text).not.toContain('  Return on Equity:');
  });

  it('labels ROE "Return on Equity" when the stored flag is false', () => {
    const appraisal = {
      ...mockAppraisal,
      outputs: {
        ...(mockAppraisal.outputs as object),
        metrics: { ...(mockAppraisal.outputs as { metrics: object }).metrics, return_on_equity_is_unrealised: false },
      },
    } as unknown as FinancialAppraisal;
    const text = buildAppraisalContent(mockProject, appraisal).join('\n');
    expect(text).toContain('  Return on Equity: 62.5%');
    expect(text).not.toContain('Unrealised');
  });

  it('includes appraisal name', () => {
    const lines = buildAppraisalContent(mockProject, mockAppraisal);
    expect(lines.some((l) => l.includes('Base Case'))).toBe(true);
  });

  it('prints N/A for every metric when the record has no outputs', () => {
    const lines = buildAppraisalContent(mockProject, { ...mockAppraisal, outputs: null });
    expect(lines.filter((l) => l.endsWith(': N/A'))).toHaveLength(7);
  });
});

// I1 (round-2 review): generateAppraisalPdf is the last unwatermarked path to
// pre-correction numbers — a stored legacy_unreconciled/draft/no-status record
// must never print as lender-ready. The gate mirrors export-investment-memo.ts's
// draft watermark exactly (text, angle, page coverage).
describe('generateAppraisalPdf — draft watermark gate', () => {
  it('prints the watermark for a legacy_unreconciled record', async () => {
    const appraisal: FinancialAppraisal = { ...mockAppraisal, status: 'legacy_unreconciled' };
    const blob = generateAppraisalPdf(mockProject, appraisal);
    const text = await pdfText(blob);
    expect(text).toContain('DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE');
  });

  it('prints the watermark for a draft record', async () => {
    const appraisal: FinancialAppraisal = { ...mockAppraisal, status: 'draft' };
    const blob = generateAppraisalPdf(mockProject, appraisal);
    const text = await pdfText(blob);
    expect(text).toContain('DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE');
  });

  it('prints the watermark when status is undefined (pre-status legacy row)', async () => {
    const appraisal: FinancialAppraisal = { ...mockAppraisal, status: undefined };
    const blob = generateAppraisalPdf(mockProject, appraisal);
    const text = await pdfText(blob);
    expect(text).toContain('DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE');
  });

  it('omits the watermark for a reconciled record', async () => {
    const appraisal: FinancialAppraisal = { ...mockAppraisal, status: 'reconciled' };
    const blob = generateAppraisalPdf(mockProject, appraisal);
    const text = await pdfText(blob);
    expect(text).not.toContain('DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE');
  });
});
