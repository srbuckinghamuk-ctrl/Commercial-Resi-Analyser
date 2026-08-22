import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { generateInvestmentMemo, sourcesAndUsesTotals, sensitivityTables } from './export-investment-memo';
import type { Project, EligibilityAssessment } from '../types';
import type {
  CalculatorInputsV2, CalculatorInputsV3, CalculatorInputsV4, CalculatorInputsV6, CalculatorInputsV8,
  AreaBridgeInputs,
} from './model';
import {
  runAppraisal, migrateInputs, DEFAULT_AREA_BRIDGE,
  migrateV6toV7, migrateV7toV8, DEFAULT_VAT, defaultVatTreatments,
} from './model';
import { buildProvenance } from './report-provenance';
import type { UnitAncillary } from './conversion-types';
import { DEFAULT_UNIT_ANCILLARY } from './conversion-types';
import { inspectPdf } from './report-qa/pdf-inspect';
import { documentText, documentProse, watermarkTexts } from './report-qa/report-checks';
import { runSensitivity, DEFAULT_SENSITIVITY_CONFIG } from './model/sensitivity';
import * as sensitivityModule from './model/sensitivity';
import { InvalidBaseDocumentError } from './model/sensitivity';
import { LEVER_LABEL } from './sensitivity-format';

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
  pa_submitted_date: null,
  pa_decision_date: null,
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
  ruleset_version: 'gpdo-2026-08.2',
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

/**
 * jsPDF escapes literal parentheses inside PDF text-show strings ("\(" / "\)")
 * — searching pdfText() output for a heading like "... (Tornado)" needs the
 * same escaping, or the match silently fails even though the text is present.
 */
function pdfEscape(text: string): string {
  return text.replace(/\(/g, '\\(').replace(/\)/g, '\\)');
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

  // R7 (audit §9): a clean reconciliation no longer clears the watermark on its
  // own. It clears the *unreconciled* banner -- saying the figures may be wrong
  // when they reconcile would be a false statement about the model -- but an
  // appraisal that nobody has approved is still not a lender document, so the
  // banner becomes NOT APPROVED. Asserting only the absence of the old string
  // would let a document with no watermark at all pass this test, which is the
  // outcome it exists to prevent.
  it('replaces the unreconciled banner with NOT APPROVED when the run reconciles cleanly', async () => {
    const run = runAppraisal(baseInputs());
    expect(run.reconciliation.report_safe).toBe(true); // sanity check the fixture
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    expect(text).not.toContain('DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE');
    expect(text).toContain('DRAFT - NOT APPROVED FOR LENDER RELIANCE');
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

    // CostToCompleteSummary.months[].month (and first_shortfall_month) are already 1-indexed
    // (cost-to-complete.ts: labels run m = 1..term) — distinct from model.months, which is
    // 0-indexed and genuinely needs "+ 1" for display (see the Monthly Cashflow table). The PDF
    // must print these labels raw, exactly like CostToCompleteCard.tsx does in the UI, never
    // shifted by one. Pins a known summary directly (rather than hunting for a real fixture that
    // happens to shortfall in month 3) so the month numbers in the assertion are unambiguous.
    it('prints cost-to-complete month labels unshifted (1-indexed, matching the UI and the data)', async () => {
      const run = runAppraisal(fixtureG.inputs);
      run.metrics.cost_to_complete = {
        first_shortfall_month: 3,
        max_shortfall_pence: 1_500_000,
        months: [
          { month: 1, remaining_cost_pence: 50_000_000, remaining_funding_pence: 52_000_000, surplus_pence: 2_000_000 },
          { month: 2, remaining_cost_pence: 40_000_000, remaining_funding_pence: 41_000_000, surplus_pence: 1_000_000 },
          { month: 3, remaining_cost_pence: 30_000_000, remaining_funding_pence: 28_500_000, surplus_pence: -1_500_000 },
        ],
      };
      const blob = generateInvestmentMemo(mockProject, run, null);
      const text = await pdfText(blob);
      expect(text).toContain('First funding shortfall: month 3');
      expect(text).toContain('Month 1');
      expect(text).toContain('Month 2');
      expect(text).toContain('Month 3');
      // Never the shifted label a copy-paste from the 0-indexed Monthly Cashflow table would
      // produce (that table's own genuine "Month 4" cells, from unrelated 0-indexed ledger
      // months, are expected elsewhere in the same document, so this only pins the callout text):
      expect(text).not.toContain('First funding shortfall: month 4');
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

  // Release 3b (Task 13): programme-dated cashflow labels/columns + exit-strategy
  // extensions (tranche table, redemption schedule, refinance narrative/provenance).
  // Zero recalculation: every figure below is read straight from run.schedule /
  // run.model, exactly like the rest of this file.
  describe('Release 3b programme/exit extensions', () => {
    const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
    const fixtureI = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'i-phased-sales.json'), 'utf-8'),
    ) as { inputs: CalculatorInputsV4 };
    const fixtureJ = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'j-blended-refinance.json'), 'utf-8'),
    ) as { inputs: CalculatorInputsV4 };

    it('prints a redemption-schedule table and the sale-tranche months (fixture I — phased sell_all)', async () => {
      const run = runAppraisal(fixtureI.inputs);
      const blob = generateInvestmentMemo(mockProject, run, null);
      const text = await pdfText(blob);

      expect(text).toContain('Redemption Schedule');
      expect(text).toContain('Senior balance before receipts');
      expect(text).toContain('Sale Tranches');

      // Tranche months come straight from schedule.receipts (spec §4.4.1) — derive
      // the expected months from the run itself rather than hardcoding, so this
      // pins the *behaviour* (a label for every receipt month), not a hand-computed
      // number.
      const trancheMonths = run.schedule.receipts
        .map((r, m) => ({ r, m }))
        .filter(({ r }) => r.gross_sale_pence > 0)
        .map(({ m }) => m);
      expect(trancheMonths).toEqual([9, 10, 11]);
      for (const m of trancheMonths) {
        expect(text).toContain(`Month ${m}`); // no programme -> plain "Month N" label
      }

      // Redemption schedule balances (declining, final entry redeems to zero).
      expect(run.model.redemption_schedule.map((r) => r.balance_pence)).toEqual([53431299, 10782708, 0]);
      const zeroStr = (0).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
      expect(text).toContain(zeroStr);
    });

    // IMPORTANT 4: §10's "Senior Debt Position" text was stale from Release 2 —
    // both break-evens have printed elsewhere in this same memo since calc
    // 2.1.0. Fixture I carries sales_phasing, so this also pins the
    // phased-regime pointer sentence.
    it('points §10 at the printed break-even figures instead of the stale "not yet available" text (fixture I — phased)', async () => {
      const run = runAppraisal(fixtureI.inputs);
      expect(run.inputs).toHaveProperty('sales_phasing');
      const blob = generateInvestmentMemo(mockProject, run, null);
      const text = await pdfText(blob);

      expect(text).not.toContain('not yet available (Release 2)');
      // doc.splitTextToSize wraps this sentence onto three lines with no inserted
      // space at the join (see the refinance-narrative test's comment above) —
      // fragments below each live wholly within one wrapped line.
      expect(text).toContain('Senior repayment break-even prints under Key Lending Metrics');
      expect(text).toContain('developer profit break-even under');
      expect(text).toContain('Both figures are computed on this appraisal\'s phased-disposal basis');
    });

    it('prints refinance provenance and the refinance narrative line (fixture J — blended + refinance)', async () => {
      const run = runAppraisal(fixtureJ.inputs);
      expect(run.schedule.refinance).not.toBeNull();
      const blob = generateInvestmentMemo(mockProject, run, null);
      const text = await pdfText(blob);

      // jsPDF escapes literal parentheses inside its PDF string objects (`\(`/`\)`),
      // so pdfText's raw byte scan never sees an unescaped "(...)" — check the
      // ASCII-safe fragments either side of the parens instead (same approach the
      // Release 2b lender-basis test above uses for the em dash).
      expect(text).toContain('Refinance: modelled');
      expect(text).toContain(`Month ${run.schedule.refinance!.month}`);
      expect(text).not.toContain('Refinance: not modelled');
      // doc.splitTextToSize wraps the narrative onto two lines (each its own PDF
      // text-show operation with no inserted space at the join) — check fragments
      // that live wholly within one wrapped line rather than a substring that
      // straddles the wrap boundary.
      expect(text).toContain('applied to');
      expect(text).toContain('surplus distributes to equity');

      const netProceedsStr = (run.schedule.refinance!.net_proceeds_pence / 100).toLocaleString('en-GB', {
        style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
      });
      expect(text).toContain(netProceedsStr);
    });

    it('still generates a memo for pre-v4 (legacy v2) inputs, with the auto/default provenance lines', async () => {
      const v2Inputs = baseInputs();
      const run = runAppraisal(v2Inputs);
      const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
      expect(blob).toBeInstanceOf(Blob);
      const text = await pdfText(blob);
      expect(text).toContain('Programme: auto-derived from term');
      expect(text).toContain('spec §6');
      expect(text).toContain('Sales phasing: single disposal in final month.');
      expect(text).toContain('Refinance: not modelled.');
      // IMPORTANT 4: the stale §10 text is gone even for a plain (non-phased) run,
      // and the phased-regime pointer sentence only appears when sales_phasing is set.
      expect(text).not.toContain('not yet available (Release 2)');
      expect(text).not.toContain('phased-disposal basis');
    });

    // Carried-forward fix: sourcesAndUsesTotals() is a hand-maintained mirror of
    // reconcile()'s §7 aggregation. Commit f2246f2 excluded
    // refinance_shortfall_equity_pence from reconcile()'s sources (it funds a
    // facility redemption — a financing-side flow, not a project cost) but the
    // memo helper wasn't updated: for a retain_all deal with a refinance
    // shortfall the memo's sources/uses table wouldn't balance even though
    // reconciliation.sources_equal_uses correctly reports true.
    it('balances sources and uses for a retain_all deal with a refinance shortfall', async () => {
      const base = baseInputs();
      const inputs: CalculatorInputsV4 = {
        ...base,
        inputs_version: 4,
        lender_valuation: null,
        programme: null,
        sales_phasing: null,
        exit_strategy: {
          route: 'retain_all',
          selling_agent_fee_pct: 1.5,
          selling_legal_fee_pence: 400_000,
          retained_units: [
            { unit_id: 'u1', monthly_rent_pence: 95_000 },
            { unit_id: 'u2', monthly_rent_pence: 95_000 },
            { unit_id: 'u3', monthly_rent_pence: 95_000 },
            { unit_id: 'u4', monthly_rent_pence: 95_000 },
          ],
        },
        // Investment value/LTV deliberately far too small to cover the
        // outstanding senior balance + exit fee at month 11 — forces the
        // shortfall branch (monthly-engine.ts: refiNet < required).
        refinance: {
          month_offset: 11,
          investment_value_pence: 5_000_000,
          ltv_pct: 50,
          arrangement_fee_pence: 300_000,
          legal_costs_pence: 100_000,
        },
      };
      const run = runAppraisal(inputs);
      expect(run.model.totals.refinance_shortfall_equity_pence).toBeGreaterThan(0);
      expect(run.reconciliation.sources_equal_uses).toBe(true); // sanity check the fixture

      const { sourcesTotal, usesTotal } = sourcesAndUsesTotals(run);
      expect(sourcesTotal).toBe(usesTotal);

      // IMPORTANT 2: the "Additional equity" row must print the *netted* figure
      // (matching what sourcesAndUsesTotals already nets into sourcesTotal above),
      // not the raw model total — before the fix, this row printed the raw
      // figure, so the printed rows would not sum to the printed "Total" row
      // whenever a refinance shortfall was present.
      const nettedAdditionalEquity =
        run.model.totals.additional_equity_pence - run.model.totals.refinance_shortfall_equity_pence;
      const nettedStr = (nettedAdditionalEquity / 100).toLocaleString('en-GB', {
        style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
      });
      const rawStr = (run.model.totals.additional_equity_pence / 100).toLocaleString('en-GB', {
        style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
      });
      expect(nettedStr).not.toBe(rawStr); // sanity: netting changes the printed figure for this fixture

      const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
      const text = await pdfText(blob);
      expect(text).toContain(nettedStr);
      // The financing-side-exclusion note (spec §7) prints under the table when
      // a shortfall is present.
      expect(text).toContain('absorbed by the refinance event is a financing-side flow, excluded from this');

      // Reconstruct the printed sources rows (mirroring generateInvestmentMemo's
      // sourcesRows exactly) and confirm they sum, to the penny, to the printed
      // sources total — the direct check for the bug this finding describes.
      const rolledInterestPence = inputs.finance.interest_type === 'rolled_up' ? run.model.totals.interest_pence : 0;
      const printedSourcesRowsSum =
        run.model.totals.equity_contributed_pence +
        nettedAdditionalEquity +
        run.model.totals.funding_gap_pence +
        run.model.totals.draws_pence +
        run.model.totals.capitalised_fees_pence +
        rolledInterestPence +
        run.schedule.totals.selling_costs_pence +
        run.model.totals.exit_fee_pence;
      expect(printedSourcesRowsSum).toBe(sourcesTotal);
    });
  });
});

// ── Release 4b: the §10 sensitivity matrices are pinned, string for string ──
//
// Design §5.2's hard regression invariant. These literals were captured from
// the pre-refactor (calc 2.4.0, R4a) build. Task 2 reimplements
// sensitivityTables() on top of runSensitivity and this test does not move —
// that is the whole point of it. If a later change makes this fail, the memo's
// printed output has drifted and the change is wrong, not the test.
describe('sensitivityTables — memo §10 regression pin', () => {
  const EXPECTED_HEAD = ['', 'GDV -15%', 'GDV -10%', 'GDV -5%', 'GDV +0%', 'GDV +5%'];

  const EXPECTED_POC_ROWS = [
    ['Cost -5%', '8.6%', '14.9%', '21.2%', '27.4%', '33.6%'],
    ['Cost +0%', '6.0%', '12.2%', '18.3%', '24.4%', '30.5%'],
    ['Cost +5%', '3.6%', '9.6%', '15.6%', '21.5%', '27.5%'],
    ['Cost +10%', '1.2%', '7.1%', '12.9%', '18.8%', '24.6%'],
    ['Cost +15%', '-1.0% [FG]', '4.7% [FG]', '10.5% [FG]', '16.2% [FG]', '21.9% [FG]'],
  ];

  const EXPECTED_LTGDV_ROWS = [
    ['Cost -5%', '55.2%', '52.1%', '49.4%', '46.9%', '44.7%'],
    ['Cost +0%', '57.5%', '54.3%', '51.4%', '48.8%', '46.5%'],
    ['Cost +5%', '59.7%', '56.4%', '53.4%', '50.7%', '48.3%'],
    ['Cost +10%', '61.9%', '58.5%', '55.4%', '52.6%', '50.1%'],
    ['Cost +15%', '62.2% [FG]', '58.8% [FG]', '55.7% [FG]', '52.9% [FG]', '50.4% [FG]'],
  ];

  it('prints the column headers unchanged', () => {
    expect(sensitivityTables(baseInputs()).head).toEqual(EXPECTED_HEAD);
  });

  it('prints the profit-on-cost matrix unchanged', () => {
    expect(sensitivityTables(baseInputs()).pocRows).toEqual(EXPECTED_POC_ROWS);
  });

  it('prints the LTGDV matrix unchanged', () => {
    expect(sensitivityTables(baseInputs()).ltgdvRows).toEqual(EXPECTED_LTGDV_ROWS);
  });

  // Spec §12.5: the all-levers-zero cell is the unadjusted appraisal. In the
  // default grid that is (Cost +0%, GDV +0%) — row index 1, column index 4
  // (the label occupies column 0, so the GDV +0% column is body index 4).
  it('agrees with the unadjusted appraisal in the base cell (spec §12.5)', () => {
    const run = runAppraisal(baseInputs());
    const tables = sensitivityTables(baseInputs());
    expect(tables.pocRows[1][4]).toBe(`${run.metrics.profit_on_cost_pct!.toFixed(1)}%`);
    expect(tables.ltgdvRows[1][4]).toBe(`${run.metrics.ltgdv_developer_pct!.toFixed(1)}%`);
  });

  // Spec §12.4: bars sort by span descending, ties broken by the fixed lever
  // order. For any deal with meaningful sales revenue GDV dominates, so its bar
  // leads — asserted on the fixture rather than hardcoding a pence figure.
  it('lists tornado bars widest-swing first', () => {
    const rows = sensitivityTables(baseInputs()).tornadoRows;
    expect(rows.map((r) => r[0])).toEqual([
      'GDV', 'Construction cost', 'Timeline', 'Interest rate',
    ]);
  });

  it('prints each tornado bar with its range and both endpoint profits', () => {
    const inputs = baseInputs();
    const rows = sensitivityTables(inputs).tornadoRows;
    expect(rows[0][1]).toBe('-10% to +10%');
    expect(rows[2][1]).toBe('-3 to +3 months');
    expect(rows[3][1]).toBe('-1.0 to +1.0 pp');
    // Five columns: lever, range, low profit, high profit, swing.
    for (const row of rows) {
      expect(row).toHaveLength(5);
      expect(row[2]).toMatch(/^-?£[\d,]+$/);
      expect(row[3]).toMatch(/^-?£[\d,]+$/);
      expect(row[4]).toMatch(/^£[\d,]+$/);
    }

    // Finding 5 (R4b final review): row[2]/row[3] were only regex-matched as
    // money above, so swapping bar.low.profit_pence and bar.high.profit_pence
    // inside sensitivityTables() would pass every one of those assertions —
    // the swing is Math.abs, so it wouldn't catch the swap either. Tie both
    // columns to the engine's own tornado, computed independently here rather
    // than by re-deriving from sensitivityTables() itself.
    const gbp = (pence: number) => (pence / 100).toLocaleString('en-GB', {
      style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
    });
    const engineTornado = runSensitivity(inputs).tornado;
    expect(engineTornado).toHaveLength(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const bar = engineTornado[i];
      expect(rows[i][0]).toBe(LEVER_LABEL[bar.lever]);
      // §12.7: baseInputs() is a plain 12-month deal with no phasing, so no default
      // tornado endpoint is ever unmeasured here — the null case is pinned on fixtures
      // I and J in sensitivity.test.ts.
      expect(rows[i][2]).toBe(gbp(bar.low.profit_pence as number));
      expect(rows[i][3]).toBe(gbp(bar.high.profit_pence as number));
    }
  });

  // The swing is |profit(high) - profit(low)| (spec §12.4), so it is never
  // signed even when the high endpoint is the worse one (as it is for cost).
  it('prints the construction-cost swing unsigned despite its inverted endpoints', () => {
    const rows = sensitivityTables(baseInputs()).tornadoRows;
    const cost = rows.find((r) => r[0] === 'Construction cost')!;
    expect(cost[4].startsWith('-')).toBe(false);
  });
});

// ── Release 4b final review, finding 3 ──────────────────────────────────
//
// The pin tests above exercise sensitivityTables() as a pure function; none of
// them touch generateInvestmentMemo's wiring of that output into the actual
// PDF tables (`head: [sens.head]`, `body: sens.pocRows`, `body: sens.ltgdvRows`,
// `body: sens.tornadoRows`). Swapping pocRows for ltgdvRows there left all 813
// tests green before this fix — these assert the printed PDF actually contains
// sensitivityTables()' output, under the correct heading.
describe('generateInvestmentMemo — §10 sensitivity wiring', () => {
  it('prints the tornado heading, both matrix headings, and every lever label', async () => {
    const run = runAppraisal(baseInputs());
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    expect(text).toContain(pdfEscape('Single-Lever Sensitivity (Tornado)'));
    expect(text).toContain(pdfEscape('Two-Way Sensitivity Matrix: Profit on Cost (%)'));
    expect(text).toContain(pdfEscape('Two-Way Sensitivity Matrix: LTGDV, developer basis (%)'));
    for (const lever of ['GDV', 'Construction cost', 'Timeline', 'Interest rate']) {
      expect(text).toContain(lever);
    }
  });

  it('prints the matrix row captions for both two-way tables', async () => {
    const run = runAppraisal(baseInputs());
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    for (const caption of ['Cost -5%', 'Cost +0%', 'Cost +5%', 'Cost +10%', 'Cost +15%']) {
      expect(text).toContain(caption);
    }
    for (const caption of ['GDV -15%', 'GDV -10%', 'GDV -5%', 'GDV +0%', 'GDV +5%']) {
      expect(text).toContain(caption);
    }
  });

  // The direct check for the finding's bug scenario: a POC-only value must
  // appear between the POC heading and the LTGDV heading, and an LTGDV-only
  // value must appear after the LTGDV heading — not the other way round. A
  // plain `text.toContain(value)` cannot catch a swapped `body:` assignment
  // (both values would still be somewhere in the document); bounding by
  // heading position can.
  it('prints profit-on-cost values under the POC heading and LTGDV values under the LTGDV heading, not swapped', async () => {
    const inputs = baseInputs();
    const run = runAppraisal(inputs);
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    const tables = sensitivityTables(inputs);

    const pocHeadingIdx = text.indexOf(pdfEscape('Two-Way Sensitivity Matrix: Profit on Cost (%)'));
    const ltgdvHeadingIdx = text.indexOf(pdfEscape('Two-Way Sensitivity Matrix: LTGDV, developer basis (%)'));
    expect(pocHeadingIdx).toBeGreaterThan(-1);
    expect(ltgdvHeadingIdx).toBeGreaterThan(pocHeadingIdx);

    // Values that appear in one matrix's body but not the other, for this fixture.
    const pocOnlyCell = tables.pocRows[0][1];
    const ltgdvOnlyCell = tables.ltgdvRows[0][1];
    expect(tables.ltgdvRows.flat()).not.toContain(pocOnlyCell);
    expect(tables.pocRows.flat()).not.toContain(ltgdvOnlyCell);

    const pocValueIdx = text.indexOf(pocOnlyCell, pocHeadingIdx);
    const ltgdvValueIdx = text.indexOf(ltgdvOnlyCell, ltgdvHeadingIdx);
    expect(pocValueIdx).toBeGreaterThan(pocHeadingIdx);
    expect(pocValueIdx).toBeLessThan(ltgdvHeadingIdx);
    expect(ltgdvValueIdx).toBeGreaterThan(ltgdvHeadingIdx);
  });
});

// ── Spec §12.7 (R5): cell validity ──────────────────────────────────────
//
// The default tornado's fixed -3-month low endpoint drives finance.term_months
// to zero or less on any deal with a term of three months or less. Under §12.7
// that levered document fails validation and the endpoint is unmeasured rather
// than clamped (safe-sensitivity.test.ts pins the unmeasured behaviour). A bar
// with an unmeasured endpoint has no span (§12.4/§12.7): sensitivityTables()
// drops it from the printed table and states why.
describe('sensitivityTables — unmeasured tornado endpoint omission', () => {
  function shortTermInputs(): CalculatorInputsV2 {
    const inputs = baseInputs();
    inputs.finance.term_months = 3;
    return inputs;
  }

  it('drops the timeline bar and reports it with the engine\'s own reason', () => {
    const tables = sensitivityTables(shortTermInputs());
    expect(tables.omittedTornadoNotes).toHaveLength(1);
    // The sentence carries the lever name and the engine's actual validation
    // message (validation.ts's finance.term_months check) — not a rationale
    // reconstructed in the memo.
    expect(tables.omittedTornadoNotes[0]).toContain('Timeline omitted');
    expect(tables.omittedTornadoNotes[0]).toContain('Term must be a whole number of months, at least 1.');
    expect(tables.tornadoRows.map((r) => r[0])).not.toContain('Timeline');
    // GDV, construction cost and interest rate remain measured.
    expect(tables.tornadoRows).toHaveLength(3);
  });

  it('does not omit anything for a term long enough to survive the fixed range', () => {
    const tables = sensitivityTables(baseInputs()); // 12-month term
    expect(tables.omittedTornadoNotes).toEqual([]);
    expect(tables.tornadoRows).toHaveLength(4);
  });

  it('omits the unmeasured tornado bar rather than printing it, and states what was omitted and why', async () => {
    const inputs = shortTermInputs();
    const run = runAppraisal(inputs);
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);

    const tornadoHeadingIdx = text.indexOf(pdfEscape('Single-Lever Sensitivity (Tornado)'));
    const pocHeadingIdx = text.indexOf(pdfEscape('Two-Way Sensitivity Matrix: Profit on Cost (%)'));
    expect(tornadoHeadingIdx).toBeGreaterThan(-1);
    expect(pocHeadingIdx).toBeGreaterThan(tornadoHeadingIdx);
    const tornadoSection = text.slice(tornadoHeadingIdx, pocHeadingIdx);

    // The omission is stated, not silent, names the lever and the engine's own
    // reason for that endpoint (spec §12.7) — not a term-shaped rationale
    // reconstructed in this file. This deal's omission does happen to be
    // term-caused, but the assertion is on the actual validation message (pinned
    // precisely at the sensitivityTables() level above, not here — jsPDF's own
    // line-wrapping of the body text can split a long sentence across two `Tj`
    // operators in the raw content stream, so a substring straddling that wrap
    // point is not a stable thing to assert on). The old hard-coded, term-shaped
    // caption is gone (see the fixture-I test below, where the omission is caused
    // by something else entirely and that caption would have been false).
    expect(tornadoSection).toContain('Timeline omitted');
    expect(tornadoSection).toContain('fails validation');
    expect(tornadoSection).not.toContain('leave a term of zero or less');
    expect(tornadoSection).not.toContain('too short for the fixed range shown');
    // The bar is actually dropped, not merely relabeled: "-3 to +3 months" is the
    // default timeline tornado's range label (formatRangeLabel), printed only in a
    // measured bar's row — it never appears in the omission sentence itself, so its
    // absence here proves the row is gone rather than just failing to trip over the
    // word "Timeline" (which the omission sentence does legitimately contain).
    expect(tornadoSection).not.toContain('-3 to +3 months');

    // The two-way matrices are unaffected by the tornado omission.
    expect(text).toContain(pdfEscape('Two-Way Sensitivity Matrix: Profit on Cost (%)'));
    expect(text).toContain(pdfEscape('Two-Way Sensitivity Matrix: LTGDV, developer basis (%)'));
  });

  // Regression for a second-pass review finding: the omission note used to be
  // hard-coded to a term-too-short rationale, which was simply false whenever a
  // bar's endpoint failed validation for a different reason. Fixture I is a
  // 12-month deal — the default tornado's timeline -3 endpoint leaves a valid
  // 9-month term — but its sales-phasing tranches (months 9–11) land past the
  // programme end once the term is shortened, so that endpoint's *levered
  // document* still fails validation, for a reason that has nothing to do with
  // the term being "too short".
  it('states the engine\'s actual reason, not a term-shaped guess, when the omission is not term-caused', () => {
    const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
    const fixtureI = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'i-phased-sales.json'), 'utf-8'),
    ) as { inputs: CalculatorInputsV4 };
    expect(fixtureI.inputs.finance.term_months).toBe(12);

    const tables = sensitivityTables(fixtureI.inputs);
    expect(tables.omittedTornadoNotes).toHaveLength(1);
    const note = tables.omittedTornadoNotes[0];
    expect(note).toContain('Timeline omitted');
    // The real reason (a sales tranche past the shortened term) is printed…
    expect(note).toMatch(/tranche/i);
    // …and the false "term too short" framing this note used to carry is gone.
    expect(note).not.toMatch(/too short/i);
    expect(note).not.toMatch(/12-month term/i);
  });
});

describe('sensitivityTables — unmeasured matrix cells name their reason', () => {
  // Fixture I is a 12-month phased-sales deal, so a timeline row of -12 empties the
  // term and every cell in that row comes back unmeasured (spec §12.7).
  function fixtureIInputs(): CalculatorInputsV4 {
    const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
    const parsed = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'i-phased-sales.json'), 'utf-8'),
    ) as { inputs: CalculatorInputsV4 };
    return structuredClone(parsed.inputs);
  }

  it('carries no notes for a grid whose positions are all measured', () => {
    expect(sensitivityTables(fixtureIInputs()).unmeasuredCellNotes).toEqual([]);
  });

  it('carries the engine\'s own reason, once, for a row invalidated by one cause', () => {
    const tables = sensitivityTables(fixtureIInputs(), {
      ...DEFAULT_SENSITIVITY_CONFIG,
      rows: { lever: 'timeline', steps: [-12, 0] },
      cols: { lever: 'gdv', steps: [-10, 0, 10] },
    });
    expect(tables.unmeasuredCellNotes).toHaveLength(1);
    expect(tables.unmeasuredCellNotes[0]).toMatch(/whole number of months, at least 1/i);
  });

  it('no longer carries the caption that only described the ambiguity', async () => {
    const text = await pdfText(
      generateInvestmentMemo(mockProject, runAppraisal(fixtureIInputs()), mockEligibility),
    );
    expect(text).not.toContain('may mean the metric is undefined');
  });
});

// Merge-blocker regression (final whole-branch review, Finding 1): runSensitivity
// throws when the *base* document fails validation (spec §12.5/§12.7) — correctly,
// per spec, and SensitivityPage.tsx already handles that throw via
// safeRunSensitivity. But sensitivityTables() had no guard for it, so
// generateInvestmentMemo used to propagate the throw and produce no PDF at all for
// a document in this state — even though runAppraisal happily returns full metrics
// alongside a `validation` array, and the ten other sections of the memo have
// nothing to do with the sensitivity engine. `equity_draw_rule: 'pari_passu'` is a
// migration state some historical saved documents still carry (validation.ts
// rejects it outright), making this a realistic, not merely theoretical, trigger.
describe('generateInvestmentMemo — base document fails validation (spec §12.7)', () => {
  function fixtureIWithInvalidBase(): CalculatorInputsV4 {
    const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
    const fixtureI = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'i-phased-sales.json'), 'utf-8'),
    ) as { inputs: CalculatorInputsV4 };
    const inputs = structuredClone(fixtureI.inputs);
    inputs.finance.equity_draw_rule = 'pari_passu';
    return inputs;
  }

  it('still produces a PDF, with the DRAFT watermark, when the levered base document fails validation', async () => {
    const inputs = fixtureIWithInvalidBase();

    // Sanity checks on the premise: runAppraisal does not refuse (it returns
    // metrics alongside `validation`), the sensitivity engine does refuse (throws,
    // per §12.5/§12.7), and the run is correctly flagged unreconciled.
    const run = runAppraisal(inputs);
    expect(run.metrics.profit_pence).not.toBeNull();
    expect(run.reconciliation.report_safe).toBe(false);
    expect(() => runSensitivity(inputs)).toThrow(/base document/i);

    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10000);

    const text = await pdfText(blob);
    expect(text).toContain('DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE');

    // §10 degrades rather than the export failing: no tornado, no matrices, and a
    // stated §12.7 reason carrying the engine's own message (not a rationale
    // reconstructed in the memo) in the space the tables would otherwise occupy.
    expect(text).not.toContain(pdfEscape('Single-Lever Sensitivity (Tornado)'));
    expect(text).not.toContain(pdfEscape('Two-Way Sensitivity Matrix: Profit on Cost (%)'));
    expect(text).not.toContain(pdfEscape('Two-Way Sensitivity Matrix: LTGDV, developer basis (%)'));
    // Two shorter, non-adjacent substrings rather than the full sentence: jsPDF's own
    // line-wrapping (doc.splitTextToSize) can split a long sentence across two `Tj`
    // operators in the raw content stream, and this sentence does wrap — a substring
    // straddling that wrap point is not a stable thing to assert on (same caveat as
    // the tornado-omission test above).
    expect(text).toContain('sensitivity analysis was not produced');
    expect(text).toContain('Pari-passu');
    expect(text).toContain('not yet supported');
    expect(text).toContain(pdfEscape('(spec §12.7)'));

    // The rest of the ten-section memo is unaffected — this is a §10 degrade, not a
    // whole-document failure.
    expect(text).toContain('Senior Debt Position');
  });

  // R6: §10's degradation is the documented response to ONE documented condition. Any
  // other throw is a defect, and a defect that renders as an orderly §12.7 omission in
  // a lender-facing PDF is a defect nobody will ever be told about. The export must
  // fail loudly instead.
  it('propagates a failure that is not an invalid base document, rather than degrading §10', async () => {
    const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
    const fixtureI = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'i-phased-sales.json'), 'utf-8'),
    ) as { inputs: CalculatorInputsV4 };
    const inputs = structuredClone(fixtureI.inputs);
    const run = runAppraisal(inputs);

    // A stand-in for any engine defect: something thrown from inside the suite that is
    // not one of its two documented failures.
    const boom = new TypeError('cannot read properties of undefined (reading "flags")');
    const spy = vi.spyOn(sensitivityModule, 'runSensitivity').mockImplementation(() => {
      throw boom;
    });
    try {
      expect(() => generateInvestmentMemo(mockProject, run, mockEligibility)).toThrow(boom);
    } finally {
      spy.mockRestore();
    }
  });

  // The counterpart: the one condition §10 does handle still degrades, and the other
  // nine sections still print. This is R5's behaviour, re-pinned against the narrowed
  // catch so a too-tight catch cannot pass Task 2 either.
  it('still degrades §10 for the documented invalid-base-document failure', async () => {
    const inputs = fixtureIWithInvalidBase();
    const run = runAppraisal(inputs);
    expect(() => runSensitivity(inputs)).toThrow(InvalidBaseDocumentError);

    const text = await pdfText(generateInvestmentMemo(mockProject, run, mockEligibility));
    expect(text).toContain('sensitivity analysis was not produced');
    expect(text).toContain('Senior Debt Position');
  });
});

// R9 (spec §15, Task 11). The area bridge and the GDV internal/ancillary
// split are computed and validated (Tasks 1-9) and reachable in the UI
// (Task 10), but until this task the memo never mentioned either. These pin
// the report content, read straight off `run.metrics.area_bridge` and
// `run.metrics.gdv_internal_pence`/`gdv_ancillary_pence` — the memo performs
// no arithmetic of its own on either.
describe('R9 — the memo reports the area bridge', () => {
  /** `baseInputs()` (v2) promoted to a v6 document: a confirmed, dated
   *  England/NI jurisdiction (so no tax-basis draft/limitation text
   *  interferes with the assertions below), a zeroed area bridge by default,
   *  and every unit given a zeroed `ancillary` block — exactly what
   *  `migrateV5toV6` would write for a document that had never recorded one,
   *  built by hand here so each fixture can set only the area/ancillary
   *  fields it actually needs. */
  function v6Inputs(overrides: {
    areas?: Partial<AreaBridgeInputs>;
    ancillary?: Record<number, Partial<UnitAncillary>>;
  } = {}): CalculatorInputsV6 {
    const v2 = baseInputs();
    return {
      ...v2,
      inputs_version: 6,
      acquisition: {
        ...v2.acquisition,
        jurisdiction: 'england_ni',
        jurisdiction_source: 'user',
        jurisdiction_evidence_status: 'confirmed',
        acquisition_date: '2026-01-15',
        acquisition_tax_override_pence: null,
        acquisition_tax_override_reason: '',
      },
      unit_mix: {
        units: v2.unit_mix.units.map((u, i) => ({
          ...u,
          ancillary: { ...DEFAULT_UNIT_ANCILLARY, ...(overrides.ancillary?.[i] ?? {}) },
        })),
      },
      lender_valuation: null,
      programme: null,
      sales_phasing: null,
      refinance: null,
      areas: { ...DEFAULT_AREA_BRIDGE, ...(overrides.areas ?? {}) },
    };
  }

  // Routed through the real PDF inspector (report-qa/pdf-inspect.ts), not the
  // raw-latin1 `pdfText()` helper the rest of this file uses: `pdfText()`
  // cannot decode jsPDF's WinAnsi em dash (0x97), and the null-ratio
  // assertion below depends on telling "0.0%" apart from the em dash the
  // memo is supposed to print instead.
  async function memoTextFor(inputs: CalculatorInputsV2 | CalculatorInputsV6): Promise<string> {
    const run = runAppraisal(inputs);
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    return documentText(await inspectPdf(blob));
  }

  // baseInputs() carries 4 x 50 m² units = 200 m² unit NIA (unchanged by any
  // fixture below, since none of them touch unit_mix areas).

  const bridgeFixture = v6Inputs({
    areas: {
      basis: 'bridge_derived',
      existing_gia_sqm: 300,
      demolished_gia_sqm: 10,
      extension_gia_sqm: 10,
      retained_commercial_gia_sqm: 0,
      untouched_gia_sqm: 0,
      circulation_common_sqm: 20,
      plant_riser_sqm: 10,
      store_bin_cycle_sqm: 10,
      amenity_sqm: 10,
      external_amenity_sqm: 5,
    },
  });

  const manualFixture = v6Inputs({ areas: { basis: 'manual' } });

  // developed = 1000 (existing only); available = 1000 - 500 = 500;
  // unallocated = 500 - 200 (unit NIA) = 300 -- exactly 300.0 m², 30% of the
  // 1000 m² developed area, comfortably over the 10% materiality line.
  const unreconciledFixture = v6Inputs({
    areas: {
      basis: 'bridge_derived',
      existing_gia_sqm: 1000,
      demolished_gia_sqm: 0,
      extension_gia_sqm: 0,
      retained_commercial_gia_sqm: 0,
      untouched_gia_sqm: 0,
      circulation_common_sqm: 200,
      plant_riser_sqm: 100,
      store_bin_cycle_sqm: 100,
      amenity_sqm: 100,
      external_amenity_sqm: 0,
    },
  });

  // Deliberately distinctive (not round) numbers: unit 1 is otherwise
  // identical to units 2 and 3 (50 m² / 538 sq ft each), so a plain "5" or
  // "1" here would collide with plenty of other cells on the page. "7.5" and
  // "2" do not.
  const ancillaryFixture = v6Inputs({
    ancillary: {
      0: { balcony_terrace_sqm: 7.5, balcony_terrace_value_pence: 500_000, parking_spaces: 2, parking_value_pence: 1_000_000 },
    },
  });

  it('prints the reconciliation with its derived lines', async () => {
    const text = await memoTextFor(bridgeFixture);
    expect(text).toContain('Area Schedule');
    expect(text).toContain('Proposed GIA');
    expect(text).toContain('Developed area');
    expect(text).toContain('Unallocated');
  });

  it('prints all three efficiencies', async () => {
    const text = await memoTextFor(bridgeFixture);
    expect(text).toContain('Net to gross');
    expect(text).toContain('Saleable to developed');
  });

  it('states the cost-area basis in words, so the reader knows which number priced the works', async () => {
    expect(await memoTextFor(bridgeFixture)).toContain('Construction area derived from the area schedule');
    expect(await memoTextFor(manualFixture)).toContain('Construction area entered manually');
  });

  it('discloses an unallocated balance rather than printing a bridge that appears to tie', async () => {
    expect(await memoTextFor(unreconciledFixture)).toContain('300.0 m² of the developed area is unallocated');
  });

  // Fix round 1 (Important 2). The materiality threshold that decides
  // whether to disclose belongs to validateInputs (validation.ts:169), not
  // the memo -- the two must never be able to silently drift apart. Proven
  // by deleting the issue validateInputs actually raised for this fixture:
  // if the memo were still recomputing "unallocated > developed * 10%" for
  // itself rather than reading the issue, this deletion would have no effect
  // and the disclosure would print regardless.
  it('reads the unallocated disclosure from validation rather than recomputing the threshold itself', async () => {
    const run = runAppraisal(unreconciledFixture);
    const issue = run.validation.find((i) => i.field === 'areas.unallocated_sqm');
    expect(issue).toBeDefined(); // sanity: this fixture's 30% overage does trip it
    run.validation = run.validation.filter((i) => i !== issue);
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = await pdfText(blob);
    expect(text).not.toContain('is unallocated');
  });

  it('says nothing about an unallocated balance when the schedule genuinely ties', async () => {
    // available exactly matches unit NIA (200 m²), so unallocated is 0 -- the
    // negative control for the disclosure test above.
    const tiedFixture = v6Inputs({
      areas: {
        basis: 'bridge_derived',
        existing_gia_sqm: 200,
        demolished_gia_sqm: 0,
        extension_gia_sqm: 0,
        retained_commercial_gia_sqm: 0,
        untouched_gia_sqm: 0,
        circulation_common_sqm: 0,
        plant_riser_sqm: 0,
        store_bin_cycle_sqm: 0,
        amenity_sqm: 0,
        external_amenity_sqm: 0,
      },
    });
    const text = await memoTextFor(tiedFixture);
    expect(text).not.toContain('is unallocated');
  });

  it('splits GDV into internal saleable and ancillary', async () => {
    const text = await memoTextFor(ancillaryFixture);
    expect(text).toContain('Internal saleable value');
    expect(text).toContain('Parking, balconies and terraces');
  });

  // Fix round 1 (minor). The GDV-split test above only exercises
  // `metrics.gdv_ancillary_pence`; it does not touch the unit table's own
  // ancillary columns at all, a different code path (the raw per-unit input,
  // via `unitAncillaryOf`). Distinct assertion for a distinct read site.
  it('prints correct per-unit ancillary values in the unit table', async () => {
    const text = await memoTextFor(ancillaryFixture);
    // Unit 1's row: 50 m² / 538 sq ft NIA (shared with units 2 and 3, which
    // is why the ancillary fixture uses non-round 7.5 m² / 2 spaces), then
    // its ancillary columns, drawn as consecutive cells in the same row.
    expect(text).toContain('50\n538\n7.5\n2');
  });

  it('no longer claims parking and external space are excluded pending a later release', async () => {
    // Spec §3.1 carried "until valued separately in R3" from R1 to R8. R9 pays
    // it off; the memo must not still be promising it. Zero-count, per the R8
    // memo-release-gate lesson.
    expect(await memoTextFor(ancillaryFixture)).not.toContain('valued separately');
  });

  // Fix round 1 (minor). A v2-shaped document (baseInputs() itself,
  // unmigrated) has no `areas` block at all, so `developed_gia_sqm` is 0 and
  // every one of the three ratios is null. Before the round-1 fix, the memo
  // printed the fourteen-row all-zero reconciliation and the three
  // all-em-dash ratios anyway, above a caption already saying no schedule
  // was entered — noise on top of the one true statement. It now omits both
  // tables entirely and prints only the caption.
  it('omits the area schedule and efficiencies tables (never a null ratio as 0%) when nothing has been entered', async () => {
    const run = runAppraisal(baseInputs());
    expect(run.metrics.area_bridge.nia_to_gia_pct).toBeNull();
    expect(run.metrics.area_bridge.nia_to_proposed_gia_pct).toBeNull();
    expect(run.metrics.area_bridge.saleable_to_developed_pct).toBeNull();
    const text = await memoTextFor(baseInputs());
    expect(text).toContain('no area schedule has been entered for this appraisal');
    expect(text).not.toContain('Area Reconciliation');
    expect(text).not.toContain('Net to gross');
    // R10 Task 13 fix round 1. The check this replaces asserted no *cell* in
    // the whole document ever read exactly "0.0%" — a blanket check written
    // to catch a null ratio rendered as a false zero rather than an em-dash.
    // R10 gave a legacy (headline-mode) document genuine, unrelated
    // zero-percent contingency-class rows (existing_building and abnormal
    // both default to 0% via costPlanFromLegacyCosts, spec §16.3), so a
    // blanket "zero occurrences" check would either collide with that
    // correct output (if narrowed to "no ratio section present", which the
    // two toContain checks above already establish) or miss a real
    // regression outside those two headings (if dropped entirely). This
    // keeps the whole-document net while admitting the legitimate case: the
    // number of "0.0%" cells anywhere in the document must equal exactly the
    // number of contingency classes genuinely at 0% — no more (a resurrected
    // null-ratio-as-0% bug would push the count past this), no fewer (a
    // regression that suppressed or mis-rendered a genuine zero-pct class
    // would pull it under).
    const zeroPctContingencyClasses = run.metrics.cost_plan.contingency.filter((c) => c.pct === 0).length;
    expect(zeroPctContingencyClasses).toBeGreaterThan(0); // non-vacuity: baseInputs() must actually exercise this
    const zeroPctCells = text.split('\n').filter((line) => line === '0.0%').length;
    expect(zeroPctCells).toBe(zeroPctContingencyClasses);
  });

  it('prints the area schedule and efficiencies tables once something has been entered', async () => {
    // The positive control for the test above: `bridgeFixture` has a real,
    // populated schedule (developed_gia_sqm = 300), so both tables print.
    const text = await memoTextFor(bridgeFixture);
    expect(text).toContain('Area Reconciliation');
    expect(text).toContain('Net to gross');
  });

  // ── R9 fix wave ─────────────────────────────────────────────────────────
  // Three divergences the whole-branch review found in the memo itself. Each
  // test fails against the pre-fix generator.
  describe('R9 fix wave', () => {
    /** The engine's own `fmt` (memo-private), reproduced for the assertions
     *  below so a currency-format change fails here loudly rather than
     *  silently loosening a hard-coded literal. */
    function gbp(pence: number): string {
      return (pence / 100).toLocaleString('en-GB', {
        style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
      });
    }

    /** Unit 1 retained, on the BLENDED route — the one route where the
     *  engine's retained set is exactly `exit_strategy.retained_units`, so
     *  `metrics.unrealised_value_pence` and the Retained Portfolio table
     *  describe the same units and must agree to the penny. Unit 1 carries
     *  £15,000 of ancillary value, so "internal only" and "internal plus
     *  ancillary" are genuinely different answers here. */
    function retainedFixture(): CalculatorInputsV6 {
      const base = v6Inputs({
        ancillary: {
          0: {
            balcony_terrace_sqm: 7.5, balcony_terrace_value_pence: 500_000,
            parking_spaces: 2, parking_value_pence: 1_000_000,
          },
        },
      });
      return {
        ...base,
        exit_strategy: {
          ...base.exit_strategy,
          route: 'blended',
          retained_units: [{ unit_id: 'u1', monthly_rent_pence: 100_000 }],
        },
      };
    }

    it("ties the Retained Portfolio's capital value to the engine's retained value", async () => {
      const inputs = retainedFixture();
      const run = runAppraisal(inputs);
      // Sanity, so the assertion below cannot pass by coincidence: the engine's
      // retained value is the unit's internal value PLUS its ancillary.
      expect(run.metrics.unrealised_value_pence).toBe(30_000_000 + 1_500_000);
      expect(gbp(run.metrics.unrealised_value_pence)).toBe('£315,000');

      const text = await memoTextFor(inputs);
      // Consecutive cells of the single retained row: monthly rent, annual
      // rent, capital value, gross yield. Pre-fix this row printed £300,000
      // and 4.0% — the memo's own second opinion on a figure the engine had
      // already derived.
      expect(text).toContain(
        [gbp(100_000), gbp(1_200_000), gbp(run.metrics.unrealised_value_pence), '3.8%'].join('\n'),
      );
    });

    it('reads unit NIA off the area bridge instead of re-summing the unit schedule', async () => {
      const inputs = v6Inputs();
      const run = runAppraisal(inputs);
      expect(run.metrics.area_bridge.unit_nia_sqm).toBe(200); // 4 x 50 m²

      // Move ONLY the bridge's figure. A memo that still ran its own
      // `units.reduce((s, u) => s + u.floor_area_sqm, 0)` would ignore this
      // and keep printing 200 m² / 2,153 sq ft — numerically identical to the
      // bridge in every real document, which is exactly how the R8 defect
      // class stayed invisible to a green suite.
      run.metrics.area_bridge.unit_nia_sqm = 400;
      const text = documentText(
        await inspectPdf(generateInvestmentMemo(mockProject, run, mockEligibility)),
      );
      expect(text).toContain('4,306 sq ft NIA');
      expect(text).not.toContain('2,153 sq ft NIA');
    });

    it('survives a unit whose stored ancillary block is explicitly null', async () => {
      // `unitAncillaryOf`'s engine twin (`unitAncillaryValuePence`) has always
      // guarded this: `'ancillary' in u` is satisfied by an explicit
      // `"ancillary": null` in a stored document, so the memo's version
      // reached `.balcony_terrace_sqm` on null and took the whole export down.
      const base = v6Inputs();
      const inputs: CalculatorInputsV6 = {
        ...base,
        unit_mix: {
          units: base.unit_mix.units.map((u, i) => (
            i === 0 ? { ...u, ancillary: null as unknown as UnitAncillary } : u
          )),
        },
      };
      const run = runAppraisal(inputs);
      expect(run.metrics.gdv_ancillary_pence).toBe(0); // the engine already copes
      const text = await memoTextFor(inputs);
      expect(text).toContain('Proposed Unit Mix');
    });
  });
});

// R11 (Task 12, spec §17.10, §17.12, §17.13). VAT gains a draft gate and a
// memo section; three memo sites that used to say "unconfirmed"/"not
// modelled" permanently now read the engine's own computed VatResult
// (run.metrics.vat) and recompute nothing here (file header's
// no-recalculation rule).
describe('R11 — VAT draft gate and memo section', () => {
  /** `baseInputs()` (v2) promoted to v8 with a confirmed, dated England/NI
   *  jurisdiction (so no tax-basis text interferes) and a registered VAT
   *  block rating ONLY the construction category — base build is non-zero
   *  (100,000/m² x 400 m² = 40,000,000p), so its charge line is genuinely
   *  material. Equity and the facility are both widened generously: VAT is
   *  deliberately NOT advance-eligible (spec §17.6), so a tight facility would
   *  open an unrelated funding gap and these tests are about the report, not
   *  about facility sizing (see monthly-engine.ts:159). */
  function vatMemoInputs(opts: {
    evidence_status?: 'confirmed' | 'unconfirmed';
    recoverable_pct?: number;
    vendorOptedToTax?: boolean;
    togcTreatment?: 'applies' | 'does_not_apply' | 'unconfirmed';
    /** Only 'construction' is rated by default (see class doc). Set true to
     *  also rate 'acquisition' at 20%, needed for a genuine chargeable-
     *  consideration uplift when purchase VAT is chargeable. */
    rateAcquisition?: boolean;
    /** Forces every VAT return period's reclaim to land inside the term, so
     *  there is nothing left `receivable_at_maturity_pence` (spec §17.4). */
    noReceivableAtMaturity?: boolean;
  } = {}): CalculatorInputsV8 {
    const v2 = baseInputs();
    const v6: CalculatorInputsV6 = {
      ...v2,
      inputs_version: 6,
      acquisition: {
        ...v2.acquisition,
        jurisdiction: 'england_ni',
        jurisdiction_source: 'user',
        jurisdiction_evidence_status: 'confirmed',
        acquisition_date: '2026-01-15',
        acquisition_tax_override_pence: null,
        acquisition_tax_override_reason: '',
      },
      unit_mix: {
        units: v2.unit_mix.units.map((u) => ({ ...u, ancillary: { ...DEFAULT_UNIT_ANCILLARY } })),
      },
      lender_valuation: null,
      programme: null,
      sales_phasing: null,
      refinance: null,
      areas: { ...DEFAULT_AREA_BRIDGE },
    };
    const v8 = migrateV7toV8(migrateV6toV7(v6));
    return {
      ...v8,
      equity_sources: [{ ...v8.equity_sources[0], amount_pence: 900_000_000 }],
      finance: {
        ...v8.finance,
        committed_net_facility_pence: 500_000_000,
        committed_gross_facility_pence: 600_000_000,
      },
      vat: {
        ...DEFAULT_VAT,
        registered: true,
        ...(opts.noReceivableAtMaturity
          ? { return_frequency: 'monthly' as const, first_period_end_month: 0, repayment_lag_months: 0 }
          : {}),
        treatments: defaultVatTreatments().map((t) => {
          if (t.category === 'construction') {
            return {
              ...t,
              rate_pct: 20,
              recoverable_pct: opts.recoverable_pct ?? 100,
              recovery_basis: 'zero_rated_sale' as const,
              evidence_status: opts.evidence_status ?? 'confirmed',
            };
          }
          if (t.category === 'acquisition' && opts.rateAcquisition === true) {
            return {
              ...t, rate_pct: 20, recoverable_pct: 0,
              recovery_basis: 'blocked' as const, evidence_status: 'confirmed' as const,
            };
          }
          return t;
        }),
        purchase: {
          ...DEFAULT_VAT.purchase,
          vendor_opted_to_tax: opts.vendorOptedToTax ?? false,
          togc_treatment: opts.togcTreatment ?? 'unconfirmed',
        },
      },
    };
  }

  /** The engine's own `fmt` (memo-private), reproduced so a currency-format
   *  change fails here loudly rather than silently loosening a literal. */
  function gbp(pence: number): string {
    return (pence / 100).toLocaleString('en-GB', {
      style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
    });
  }

  async function memoTextForVat(inputs: CalculatorInputsV8): Promise<string> {
    const run = runAppraisal(inputs);
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    // documentProse, not documentText: several of the assertions below span a
    // table-cell wrap point (e.g. "Purchase VAT / TOGC"), and a raw line-join
    // would make the assertion really be about where the line happened to
    // break (report-checks.ts's own documentProse doc comment).
    return documentProse(await inspectPdf(blob));
  }

  it('rewrites the construction VAT and purchase VAT/TOGC assumption rows', async () => {
    const text = await memoTextForVat(vatMemoInputs());
    expect(text).toContain('Construction VAT');
    expect(text).toContain('20.0%, 100.0% recoverable');
    expect(text).toContain('Zero-rated sale, evidence confirmed');
    expect(text).toContain('Purchase VAT / TOGC');
    expect(text).toContain('Vendor has not opted to tax — no purchase VAT');
    expect(text).not.toContain('Treatment unconfirmed');
    expect(text).not.toContain('Purchase price treated as VAT-exempt/TOGC');
  });

  it('discloses the chargeable-consideration VAT uplift where purchase VAT is charged', async () => {
    const text = await memoTextForVat(vatMemoInputs({
      vendorOptedToTax: true, togcTreatment: 'does_not_apply', rateAcquisition: true,
    }));
    expect(text).toContain('VAT uplift on the');
    expect(text).toMatch(/Chargeable consideration/);
  });

  it('prints the VAT section: category treatment, return cycle, peak carry and irrecoverable VAT', async () => {
    const inputs = vatMemoInputs({ recoverable_pct: 60 });
    const run = runAppraisal(inputs);
    expect(run.metrics.vat.total_irrecoverable_pence).toBeGreaterThan(0);
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = documentProse(await inspectPdf(blob));
    expect(text).toContain('Category');
    expect(text).toContain('Recovery basis');
    expect(text).toContain('Return cycle');
    expect(text).toContain('Peak VAT carry');
    expect(text).toContain('Total irrecoverable VAT (in cost-before-finance)');
    // Read off the SAME run the memo was built from, not hand-computed — the
    // point of this assertion is that the printed figure IS the engine's
    // total_irrecoverable_pence, not a plausible-looking guess at it.
    expect(text).toContain(gbp(run.metrics.vat.total_irrecoverable_pence));
  });

  it('prints a VAT receivable line only when something is outstanding at maturity', async () => {
    // The default fixture's quarterly cycle genuinely leaves a balance
    // outstanding at the 12-month term end (spec §17.4) — asserted here so
    // the "absent" half below is a deliberately DIFFERENT input, not a
    // fixture that happens to hide the same figure.
    const withReceivable = runAppraisal(vatMemoInputs());
    expect(withReceivable.metrics.vat.receivable_at_maturity_pence).toBeGreaterThan(0);
    const withText = documentProse(await inspectPdf(
      generateInvestmentMemo(mockProject, withReceivable, mockEligibility),
    ));
    expect(withText).toContain('VAT receivable after the modelled term');

    const withoutReceivable = runAppraisal(vatMemoInputs({ noReceivableAtMaturity: true }));
    expect(withoutReceivable.metrics.vat.receivable_at_maturity_pence).toBe(0);
    const withoutText = documentProse(await inspectPdf(
      generateInvestmentMemo(mockProject, withoutReceivable, mockEligibility),
    ));
    expect(withoutText).not.toContain('VAT receivable after the modelled term');
  });

  it('reports the VAT engine as inactive rather than printing a stale treatment table', async () => {
    const off = vatMemoInputs();
    const inputs: CalculatorInputsV8 = { ...off, vat: { ...off.vat, registered: false } };
    const text = await memoTextForVat(inputs);
    expect(text).toContain('VAT is not registered on this appraisal');
    expect(text).not.toContain('Recovery basis');
    expect(text).not.toContain('Peak VAT carry');
    // The rewritten assumption rows say so too, not just the VAT section.
    expect(text).toContain('VAT not registered');
  });

  it('never labels a negative VAT carry interest as a cost, and never clamps it (R32)', async () => {
    // Isolates the memo's PRESENTATION rule from the engine's own R32 proof
    // (metrics.test.ts's "reports a NEGATIVE carry unclamped" pins the engine
    // figure itself) — the same isolation technique this file already uses
    // elsewhere (moving only run.metrics.area_bridge.unit_nia_sqm) to check
    // the memo reads the field rather than recomputing or reshaping it.
    const run = runAppraisal(vatMemoInputs());
    run.metrics.vat_carry_interest_pence = -1_234_500;
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility);
    const text = documentText(await inspectPdf(blob));
    expect(text).toContain('£12,345 saving');
    expect(text).not.toContain('-£12,345');
  });

  it('states which LTC denominator excludes VAT once irrecoverable VAT is material', async () => {
    const withVat = await memoTextForVat(vatMemoInputs({ recoverable_pct: 60 }));
    expect(withVat).toContain("Net LTC's denominator excludes");
    const fullyRecoverable = await memoTextForVat(vatMemoInputs({ recoverable_pct: 100 }));
    expect(fullyRecoverable).not.toContain("Net LTC's denominator excludes");
  });

  it('replaces the retired "not modelled as a cash flow" limitation with §17.13\'s residual scope', async () => {
    const text = await memoTextForVat(vatMemoInputs());
    expect(text).not.toContain('VAT is not modelled as a cash flow');
    expect(text).toContain('not a computed partial-exemption');
    expect(text).toContain('no separate VAT facility');
  });

  it('gates the document to DRAFT while a materially-charged VAT row is unconfirmed', async () => {
    const run = runAppraisal(vatMemoInputs({ evidence_status: 'unconfirmed' }));
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.draftReason).toBe('vat_basis_unconfirmed');
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility, prov);
    const info = await inspectPdf(blob);
    // The watermark is drawn rotated, outside the flowing body text —
    // `watermarkTexts` (report-checks.ts) is the established way to read it,
    // the same one memo-release-gate.test.ts uses for the other DraftReasons.
    expect(info.pages.flatMap(watermarkTexts))
      .toContain('DRAFT - VAT BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE');
    expect(documentProse(info)).toContain('a VAT treatment that actually bears VAT is not yet evidence-confirmed');
  });

  it('reaches FINAL once the materially-charged VAT row is confirmed', async () => {
    const run = runAppraisal(vatMemoInputs({ evidence_status: 'confirmed' }));
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.draftReason).toBeNull();
    expect(prov.documentStatus).toBe('FINAL');
    const blob = generateInvestmentMemo(mockProject, run, mockEligibility, prov);
    const info = await inspectPdf(blob);
    expect(info.pages.flatMap(watermarkTexts)).toEqual([]);
  });
});
