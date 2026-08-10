import { describe, it, expect } from 'vitest';
import { generateInvestmentMemo } from './export-investment-memo';
import type { Project, EligibilityAssessment } from '../types';
import type { CalculatorInputs } from './conversion-types';
import { calculateAppraisal } from './conversion-calc-engine';
import { buildCashflow } from './conversion-cashflow';

const mockProject: Project = {
  id: 'test-id',
  address_raw: '47 High Street, Guildford, Surrey, GU1 3DY',
  address_line1: '47 High Street',
  address_line2: null,
  address_town: 'Guildford',
  address_county: 'Surrey',
  address_postcode: 'GU1 3DY',
  address_postcode_district: 'GU1',
  price_pence: 45000000,
  price_qualifier: 'Guide price',
  use_class: 'office',
  floor_area_sqft: 3200,
  floor_area_sqm: 297,
  floors: 3,
  tenure: 'freehold',
  lease_years_remaining: null,
  current_use_description: 'Former office building, vacant since 2025',
  epc_rating: 'D',
  is_vacant: true,
  vacancy_date: '2025-06-01',
  source_url: null,
  source_name: null,
  description: 'Three-storey former office building in Guildford town centre.',
  image_urls: [],
  stage: 'financial_appraisal',
  created_at: '2026-01-15T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const mockInputs: CalculatorInputs = {
  project_id: 'test-id',
  acquisition: {
    purchase_price_pence: 45000000,
    legal_fees_pence: 500000,
    survey_cost_pence: 250000,
    broker_fee_pct: 1,
    other_acquisition_costs_pence: 0,
  },
  unit_mix: {
    units: [
      { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 27500000, comparable_notes: 'Comparable at 48 High St sold Jan 2026 at £275k' },
      { id: 'u2', type: '2bed', floor_area_sqm: 70, estimated_value_pence: 37500000, comparable_notes: '2-bed at River Court, £365k Dec 2025' },
      { id: 'u3', type: '2bed', floor_area_sqm: 75, estimated_value_pence: 40000000, comparable_notes: '' },
      { id: 'u4', type: '1bed', floor_area_sqm: 48, estimated_value_pence: 26000000, comparable_notes: '' },
    ],
  },
  conversion_costs: {
    prior_approval_fee_per_dwelling_pence: 10000,
    cil_s106_pence: 800000,
    architect_pence: 1200000,
    structural_engineer_pence: 400000,
    mande_pence: 300000,
    planning_consultant_pence: 250000,
    building_control_pence: 150000,
    other_professional_fees_pence: 200000,
    construction_cost_per_sqm_pence: 150000,
    total_construction_sqm: 243,
    contingency_pct: 10,
    fire_safety_pence: 500000,
    sound_insulation_pence: 300000,
    part_l_compliance_pence: 200000,
  },
  finance: {
    funding_source: 'development_finance',
    ltv_pct: 65,
    interest_rate_annual_pct: 9.5,
    arrangement_fee_pct: 2,
    exit_fee_pct: 1,
    loan_term_months: 14,
    interest_type: 'rolled_up',
  },
  exit_strategy: {
    route: 'sell_all',
    selling_agent_fee_pct: 1.5,
    selling_legal_fee_pence: 100000,
    retained_units: [],
  },
  risks: [
    { id: 'r1', description: 'Construction cost overrun', likelihood: 'medium', impact: 'high', mitigation: 'Fixed-price contract with contingency' },
    { id: 'r2', description: 'Sales rate slower than expected', likelihood: 'medium', impact: 'medium', mitigation: 'Competitive pricing strategy, flexible exit' },
    { id: 'r3', description: 'Interest rate increase', likelihood: 'low', impact: 'medium', mitigation: 'Fixed-rate facility, short programme' },
  ],
  scenarios: {
    base: { label: 'Base Case', gdv_adjustment_pct: 0, construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0 },
    upside: { label: 'Upside', gdv_adjustment_pct: 5, construction_cost_adjustment_pct: -5, timeline_adjustment_months: -2, interest_rate_adjustment_pct: 0 },
    downside: { label: 'Downside', gdv_adjustment_pct: -10, construction_cost_adjustment_pct: 10, timeline_adjustment_months: 3, interest_rate_adjustment_pct: 1 },
  },
};

const mockEligibility: EligibilityAssessment = {
  id: 'assess-id',
  project_id: 'test-id',
  pdr_class: 'class_ma',
  criteria: [
    { key: 'use_class', label: 'Use class E(a) office', passed: true, source: 'user', auto_checked: false, value: 'office', risk_flag: null },
    { key: 'floor_area', label: 'Floor area ≤ 1,500 sq m', passed: true, source: 'auto', auto_checked: true, value: '297 m²', risk_flag: null },
    { key: 'vacant_3m', label: 'Vacant for 3+ months', passed: true, source: 'user', auto_checked: false, value: null, risk_flag: null },
  ],
  verdict: 'green',
  suggested_next_steps: ['Submit prior approval application'],
  notes: null,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
};

describe('generateInvestmentMemo', () => {
  const metrics = calculateAppraisal(mockInputs);
  const cashflow = buildCashflow(mockInputs);

  it('returns a non-empty Blob', () => {
    const blob = generateInvestmentMemo(mockProject, mockInputs, metrics, cashflow, mockEligibility);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10000);
  });

  it('generates a PDF without eligibility data', () => {
    const blob = generateInvestmentMemo(mockProject, mockInputs, metrics, cashflow, null);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10000);
  });

  it('generates a PDF with retained units exit strategy', () => {
    const retainedInputs: CalculatorInputs = {
      ...mockInputs,
      exit_strategy: {
        route: 'blended',
        selling_agent_fee_pct: 1.5,
        selling_legal_fee_pence: 100000,
        retained_units: [
          { unit_id: 'u1', monthly_rent_pence: 95000 },
          { unit_id: 'u2', monthly_rent_pence: 125000 },
        ],
      },
    };
    const retainedMetrics = calculateAppraisal(retainedInputs);
    const retainedCashflow = buildCashflow(retainedInputs);
    const blob = generateInvestmentMemo(mockProject, retainedInputs, retainedMetrics, retainedCashflow);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10000);
  });

  it('generates a PDF with no risks', () => {
    const noRiskInputs: CalculatorInputs = { ...mockInputs, risks: [] };
    const blob = generateInvestmentMemo(mockProject, noRiskInputs, metrics, cashflow);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(5000);
  });
});
