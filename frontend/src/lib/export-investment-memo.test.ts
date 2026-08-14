import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { generateInvestmentMemo, sourcesAndUsesTotals } from './export-investment-memo';
import type { Project, EligibilityAssessment } from '../types';
import type { CalculatorInputsV2, CalculatorInputsV3 } from './model';
import { runAppraisal, migrateInputs } from './model';

// generateInvestmentMemo now takes the finished AppraisalRun directly (Task
// 10) and performs zero recalculation — every fixture below is put through
// the real engine (runAppraisal) before being handed to the memo, exactly as
// ExportPage.tsx does. Numbers mirror fixtures/financial-model/
// f-dev-finance-12mo.json (a known-good, reconciled golden fixture).

function baseInputs(): CalculatorInputsV2 {
  return {
    inputs_version: 2,
    project_id: 'test-id',
    acquisition: {
      purchase_price_pence: 40_000_000,
      legal_fees_pence: 500_000,
      survey_cost_pence: 300_000,
      broker_fee_pct: 1.0,
      other_acquisition_costs_pence: 0,
    },
    unit_mix: {
      units: [
        { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_000, comparable_notes: 'Comparable at 48 High St sold Jan 2026 at £300k' },
        { id: 'u2', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_000, comparable_notes: '' },
        { id: 'u3', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_000, comparable_notes: '' },
        { id: 'u4', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_000, comparable_notes: '' },
      ],
    },
    conversion_costs: {
      prior_approval_fee_per_dwelling_pence: 9_600,
      cil_s106_pence: 0,
      architect_pence: 1_500_000,
      structural_engineer_pence: 500_000,
      mande_pence: 500_000,
      planning_consultant_pence: 300_000,
      building_control_pence: 200_000,
      other_professional_fees_pence: 0,
      construction_cost_per_sqm_pence: 100_000,
      total_construction_sqm: 400,
      contingency_pct: 10.0,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    },
    finance: {
      funding_source: 'development_finance',
      day_one_advance_pence: 28_000_000,
      day_one_market_value_pence: null,
      development_cost_advance_pct: 100,
      committed_net_facility_pence: 60_000_000,
      committed_gross_facility_pence: 66_000_000,
      annual_interest_rate_pct: 8.0,
      interest_type: 'rolled_up',
      arrangement_fee_pct: 2.0,
      arrangement_fee_basis: 'committed_net_facility',
      exit_fee_pct: 1.0,
      exit_fee_basis: 'committed_gross_facility',
      broker_fee_pence: 0,
      lender_legal_fee_pence: 0,
      valuation_fee_pence: 0,
      monitoring_surveyor_fee_pence: 0,
      interest_reserve_pence: null,
      term_months: 12,
      equity_draw_rule: 'equity_first',
      sales_sweep_pct: 100,
      legacy_leverage_pct: null,
      requires_confirmation: false,
      enforcement_cost_assumption_pence: 0,
    },
    equity_sources: [
      { id: 'e1', classification: 'cash', amount_pence: 35_000_000, timing_month: 0, repayment_priority: 1, evidence_status: 'confirmed', notes: '' },
    ],
    exit_strategy: {
      route: 'sell_all',
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
      retained_units: [],
    },
    risks: [
      { id: 'r1', description: 'Construction cost overrun', likelihood: 'medium', impact: 'high', mitigation: 'Fixed-price contract with contingency' },
      { id: 'r2', description: 'Sales rate slower than expected', likelihood: 'medium', impact: 'medium', mitigation: 'Competitive pricing strategy, flexible exit' },
    ],
    scenarios: {
      base: { label: 'Base Case', gdv_adjustment_pct: 0, construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0 },
      upside: { label: 'Upside', gdv_adjustment_pct: 10, construction_cost_adjustment_pct: -5, timeline_adjustment_months: -2, interest_rate_adjustment_pct: 0 },
      downside: { label: 'Downside', gdv_adjustment_pct: -10, construction_cost_adjustment_pct: 15, timeline_adjustment_months: 3, interest_rate_adjustment_pct: 1 },
      severe: { label: 'Severe', gdv_adjustment_pct: -15, construction_cost_adjustment_pct: 20, timeline_adjustment_months: 6, interest_rate_adjustment_pct: 2 },
    },
    deal_spider: {
      storeys: 2,
      building_height_m: 7,
      bsa_higher_risk: false,
      daylight_pass_pct: 100,
      absorption_months: 9,
      exit_sell: true,
      exit_refinance: true,
      exit_hold: false,
      exit_part_sale: false,
      prior_approval_window_months: 2,
      programme_contingency_months: 1,
      cil_offset_pence: 0,
      target_profit_on_cost_pct: 20,
      weights: {},
    },
  };
}

const mockProject: Project = {
  id: 'test-id',
  address_raw: '47 High Street, Guildford, Surrey, GU1 3DY',
  address_line1: '47 High Street',
  address_line2: null,
  address_town: 'Guildford',
  address_county: 'Surrey',
  address_postcode: 'GU1 3DY',
  address_postcode_district: 'GU1',
  price_pence: 40_000_000,
  price_qualifier: 'Guide price',
  use_class: 'office',
  floor_area_sqft: 4306,
  floor_area_sqm: 400,
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

const mockEligibility: EligibilityAssessment = {
  id: 'assess-id',
  project_id: 'test-id',
  pdr_class: 'class_ma',
  criteria: [
    { key: 'use_class', label: 'Use class E(a) office', passed: true, source: 'user', auto_checked: false, value: 'office', risk_flag: null },
    { key: 'floor_area', label: 'Floor area ≤ 1,500 sq m', passed: true, source: 'auto', auto_checked: true, value: '400 m²', risk_flag: null },
    { key: 'vacant_3m', label: 'Vacant for 3+ months', passed: true, source: 'user', auto_checked: false, value: null, risk_flag: null },
  ],
  verdict: 'green',
  suggested_next_steps: ['Submit prior approval application'],
  notes: null,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
};

async function pdfText(blob: Blob): Promise<string> {
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab).toString('latin1');
}

describe('generateInvestmentMemo', () => {
  it('returns a non-empty Blob for a reconciled run', () => {
    const run = runAppraisal(baseInputs());
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10000);
  });

  it('generates a PDF without eligibility data', () => {
    const run = runAppraisal(baseInputs());
    const blob = generateInvestmentMemo(mockProject, run, null);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10000);
  });

  it('generates a PDF with a retained-units exit strategy', () => {
    const inputs = baseInputs();
    inputs.exit_strategy = {
      route: 'blended',
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
      retained_units: [
        { unit_id: 'u1', monthly_rent_pence: 95_000 },
        { unit_id: 'u2', monthly_rent_pence: 95_000 },
      ],
    };
    const run = runAppraisal(inputs);
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10000);
  });

  it('generates a PDF with no risks', () => {
    const inputs = baseInputs();
    inputs.risks = [];
    const run = runAppraisal(inputs);
    const blob = generateInvestmentMemo(mockProject, run, null);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(5000);
  });

  // (a) Day-one LTV appears only alongside its spec §5.1 definition footnote —
  // never as "total facility ÷ purchase price" (spec §11.4, the removed
  // pre-R1 figure).
  it('prints Day-one LTV only with its spec §5.1 definition footnote', async () => {
    const run = runAppraisal(baseInputs());
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    expect(text).toContain('Day-one LTV');
    expect(text).toContain(
      'Day-one LTV = the actual month-0 senior advance',
    );
  });

  // (b) the prohibited "senior debt impairment" concept (spec §11.5, §5.11)
  // must vanish entirely, including the word itself.
  it('never prints the word "impairment"', async () => {
    const run = runAppraisal(baseInputs());
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    expect(text.toLowerCase()).not.toContain('impairment');
  });

  // (c) the draft watermark renders on every page when the run does not
  // reconcile, and is absent when it does.
  it('renders the draft watermark when the run is unreconciled', async () => {
    // A v1-shaped legacy snapshot always migrates with requires_confirmation
    // = true (spec §10), which forces reconciliation.report_safe to false.
    const legacyV1Snapshot = {
      project_id: 'test-id',
      acquisition: { purchase_price_pence: 40_000_000, legal_fees_pence: 500_000, survey_cost_pence: 300_000, broker_fee_pct: 1, other_acquisition_costs_pence: 0 },
      unit_mix: { units: [{ id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_000, comparable_notes: '' }] },
      conversion_costs: baseInputs().conversion_costs,
      finance: { funding_source: 'bridging', ltv_pct: 65, interest_rate_annual_pct: 9.5, arrangement_fee_pct: 2, exit_fee_pct: 1, loan_term_months: 14, interest_type: 'rolled_up' },
      exit_strategy: { route: 'sell_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 100_000, retained_units: [] },
      risks: [],
    };
    const run = runAppraisal(migrateInputs(legacyV1Snapshot, mockProject));
    expect(run.reconciliation.report_safe).toBe(false); // sanity check the fixture
    const blob = generateInvestmentMemo(mockProject, run, null);
    const text = await pdfText(blob);
    expect(text).toContain('DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE');
  });

  it('omits the draft watermark when the run reconciles cleanly', async () => {
    const run = runAppraisal(baseInputs());
    expect(run.reconciliation.report_safe).toBe(true); // sanity check the fixture
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    expect(text).not.toContain('DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE');
  });

  // Regression test (round-1 review, CRITICAL): jspdf-autotable paginates
  // internally via its own doc.addPage() calls when a table (the Monthly
  // Cashflow / Proposed Unit Mix tables here) is taller than one page — those
  // pages bypass the memo's own newPage() wrapper unless autoTable's
  // didDrawPage hook is also wired to the watermark. A 40-month term with 22
  // units reliably forces autoTable's internal pagination (verified this
  // fixture produces 13 physical pages). Every one of them must carry the
  // watermark when the run is unreconciled — before the table() wrapper fix,
  // this fixture produced 13 pages but only 9 watermarks (4 clean pages,
  // including inside the debt schedule itself).
  it('watermarks every physical page, including pages autoTable paginates internally', async () => {
    const units = Array.from({ length: 22 }, (_, i) => ({
      id: `u${i}`,
      type: '1bed' as const,
      floor_area_sqm: 50,
      estimated_value_pence: 30_000_000,
      comparable_notes: '',
    }));
    const legacyV1Snapshot = {
      project_id: 'test-id',
      acquisition: { purchase_price_pence: 400_000_000, legal_fees_pence: 500_000, survey_cost_pence: 300_000, broker_fee_pct: 1, other_acquisition_costs_pence: 0 },
      unit_mix: { units },
      conversion_costs: baseInputs().conversion_costs,
      // 40-month term forces the Monthly Cashflow table (one row per month)
      // past a single page on top of the 22-row Proposed Unit Mix table.
      finance: { funding_source: 'bridging', ltv_pct: 65, interest_rate_annual_pct: 9.5, arrangement_fee_pct: 2, exit_fee_pct: 1, loan_term_months: 40, interest_type: 'rolled_up' },
      exit_strategy: { route: 'sell_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 100_000, retained_units: [] },
      risks: [],
    };
    const run = runAppraisal(migrateInputs(legacyV1Snapshot, mockProject));
    expect(run.reconciliation.report_safe).toBe(false); // sanity check: must be a draft run
    expect(run.model.months.length).toBeGreaterThanOrEqual(36);
    expect(run.inputs.unit_mix.units.length).toBeGreaterThanOrEqual(20);

    const blob = generateInvestmentMemo(mockProject, run, null);
    const ab = await blob.arrayBuffer();
    const text = Buffer.from(ab).toString('latin1');

    // Physical page count: each page is its own PDF object with /Type /Page
    // (not /Type /Pages, the singular parent-collection object).
    const pageCount = (text.match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
    const watermarkCount = text.split('DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE').length - 1;

    expect(pageCount).toBeGreaterThan(9); // confirms this fixture actually forces multi-page autoTable pagination
    expect(watermarkCount).toBeGreaterThanOrEqual(pageCount); // every page carries at least one watermark
  });

  // (d) the sources and uses columns of the funding table total identically
  // (spec §7 invariant: Σ sources = Σ uses), both numerically and as printed.
  it('prints identical sources and uses totals', async () => {
    const run = runAppraisal(baseInputs());
    expect(run.reconciliation.sources_equal_uses).toBe(true);
    const { usesTotal, sourcesTotal } = sourcesAndUsesTotals(run);
    expect(sourcesTotal).toBe(usesTotal);
    expect(sourcesTotal).toBeGreaterThan(0);

    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    const totalStr = (usesTotal / 100).toLocaleString('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0,
    });
    expect(text).toContain(`Sources and uses both total ${totalStr}`);
  });

  // I3 (spec §4 — interest_reserve_remaining is floored at reporting; exhaustion
  // is flagged, not hidden). A reserve set far below the interest that accrues
  // over the term drives the raw (unfloored) figure deeply negative — the memo
  // must never print that negative figure.
  it('floors interest reserve remaining at zero instead of printing a negative figure', async () => {
    const inputs = baseInputs();
    inputs.finance.interest_reserve_pence = 100;
    const run = runAppraisal(inputs);
    expect(run.metrics.interest_reserve_remaining_pence).not.toBeNull();
    expect(run.metrics.interest_reserve_remaining_pence!).toBeLessThan(0);
    expect(run.model.flags.some((f) => f.code === 'interest_reserve_exhausted')).toBe(true);

    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    expect(text).toContain('Interest reserve remaining');
    const rawNegativeStr = (run.metrics.interest_reserve_remaining_pence! / 100).toLocaleString('en-GB', {
      style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
    });
    const flooredStr = (0).toLocaleString('en-GB', {
      style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
    });
    expect(text).not.toContain(rawNegativeStr);
    expect(text).toContain(flooredStr);
  });

  // Release 2b (Task 8): lender GDV, variance bridge + provenance, senior/developer
  // break-even and cost-to-complete, all read straight off run.metrics — no recalculation.
  describe('Release 2b lender metrics', () => {
    const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
    const fixtureG = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'g-lender-valuation.json'), 'utf-8'),
    ) as { inputs: CalculatorInputsV3 };

    it('prints lender GDV, the variance bridge and the lender valuation provenance line', async () => {
      const run = runAppraisal(fixtureG.inputs);
      expect(run.metrics.lender_gdv_pence).toBe(108_000_000);
      const blob = generateInvestmentMemo(mockProject, run, null);
      const text = await pdfText(blob);
      expect(text).toContain('Lender-Underwritten GDV');
      expect(text).toContain('Variance vs Developer GDV');
      expect(text).toContain('Fixture: lender haircut for valuation-basis testing');
      expect(text).toContain('governance');
    });

    it('prints senior and developer break-even figures with the enforcement-cost assumption', async () => {
      const run = runAppraisal(fixtureG.inputs);
      const blob = generateInvestmentMemo(mockProject, run, null);
      const text = await pdfText(blob);
      expect(text).toContain('Senior repayment break-even');
      expect(text).toContain('Developer profit break-even');
      expect(text).toContain('enforcement-cost');
    });

    it('prints the cost-to-complete section', async () => {
      const run = runAppraisal(fixtureG.inputs);
      const blob = generateInvestmentMemo(mockProject, run, null);
      const text = await pdfText(blob);
      expect(text).toContain('Cost to Complete');
      expect(text).toContain('First funding shortfall');
    });

    it('never substitutes a number for the lender-basis figures when no lender valuation is recorded', async () => {
      const v2Inputs = baseInputs();
      const run = runAppraisal(v2Inputs);
      expect(run.metrics.lender_gdv_pence).toBeNull();
      expect(run.metrics.ltgdv_lender_pct).toBeNull();
      const blob = generateInvestmentMemo(mockProject, run, null);
      const text = await pdfText(blob);
      // pdfText decodes the PDF's raw byte stream as latin1, which does not round-trip
      // WinAnsi-encoded non-ASCII glyphs like the em dash (—) back to their source
      // character — check the ASCII-safe fragments either side of it instead.
      expect(text).toContain('not available');
      expect(text).toContain('no lender valuation recorded');
      expect(text).not.toContain('Release 2)');
    });
  });
});
