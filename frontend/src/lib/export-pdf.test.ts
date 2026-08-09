import { describe, it, expect } from 'vitest';
import { buildEligibilityContent, buildAppraisalContent } from './export-pdf';
import type { Project, EligibilityAssessment, FinancialAppraisal } from '../types';

const mockProject: Project = {
  id: 'test-id',
  address_raw: '1 Test Street, London, SW1A 1AA',
  address_line1: null,
  address_line2: null,
  address_town: 'London',
  address_county: null,
  address_postcode: 'SW1A 1AA',
  address_postcode_district: 'SW1A',
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
  gdv_pence: 120000000,
  total_cost_pence: 85000000,
  profit_on_cost_pct: 41.2,
  profit_on_gdv_pct: 29.2,
  return_on_equity_pct: 62.5,
  irr: 0.28,
  rlv_pence: 38000000,
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
    expect(text).toContain('GDV');
    expect(text).toContain('Profit on Cost');
    expect(text).toContain('IRR');
  });

  it('includes appraisal name', () => {
    const lines = buildAppraisalContent(mockProject, mockAppraisal);
    expect(lines.some((l) => l.includes('Base Case'))).toBe(true);
  });
});
