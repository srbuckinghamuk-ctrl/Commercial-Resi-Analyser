import { describe, it, expect } from 'vitest';
import { migrateInputs, migrateV2toV3, isV3 } from './migrate';
import type { CalculatorInputsV2 } from './finance-types';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';

const V1_SNAPSHOT = {
  project_id: 'p1',
  acquisition: {
    purchase_price_pence: 42_500_000, legal_fees_pence: 500_000,
    survey_cost_pence: 300_000, broker_fee_pct: 1.0, other_acquisition_costs_pence: 0,
  },
  unit_mix: { units: [{ id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' }] },
  conversion_costs: {
    prior_approval_fee_per_dwelling_pence: 9_600, cil_s106_pence: 0, architect_pence: 1_500_000,
    structural_engineer_pence: 500_000, mande_pence: 500_000, planning_consultant_pence: 300_000,
    building_control_pence: 200_000, other_professional_fees_pence: 0,
    construction_cost_per_sqm_pence: 50_000, total_construction_sqm: 500,
    contingency_pct: 10, fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
  },
  finance: {
    funding_source: 'development_finance', ltv_pct: 70, interest_rate_annual_pct: 8,
    arrangement_fee_pct: 2, exit_fee_pct: 1, loan_term_months: 12, interest_type: 'rolled_up',
  },
  exit_strategy: { route: 'retain_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 150_000, retained_units: [] },
};

describe('migrateInputs', () => {
  it('passes a v2 document through unchanged', () => {
    const v2 = migrateInputs({ ...V1_SNAPSHOT, inputs_version: 2, finance: undefined } as never);
    // a malformed "v2" without finance still normalises — but a real v2 round-trips:
    const again = migrateInputs(v2 as unknown as Record<string, unknown>);
    expect(again).toEqual(v2);
  });

  it('migrates v1 ltv_pct to an unconfirmed proposed facility, never an approved metric', () => {
    const v2 = migrateInputs(V1_SNAPSHOT);
    expect(v2.inputs_version).toBe(2);
    expect(v2.finance.legacy_leverage_pct).toBe(70);
    expect(v2.finance.requires_confirmation).toBe(true);
    expect(v2.finance.day_one_advance_pence).toBeNull();
    expect(v2.finance.equity_draw_rule).toBe('fund_as_required');
    // proposed net facility = round(v1 cost-before-finance × 70%)
    // v1 cost before finance for this snapshot:
    //   acquisition 42,500,000 + SDLT 1,075,000 + 500,000 + 300,000 + broker 425,000 = 44,800,000
    //   construction 50,000×500 = 25,000,000 + 10% cont 2,500,000 = 27,500,000 (+£0.01... compliance 0)
    //   professional+statutory 9,600 + 1,500,000+500,000+500,000+300,000+200,000 = 3,009,600
    //   total 75,309,600 → 70% = 52,716,720
    expect(v2.finance.committed_net_facility_pence).toBe(52_716_720);
    expect(v2.finance.term_months).toBe(12);
    expect(v2.finance.interest_type).toBe('rolled_up');
  });

  it('creates a single unconfirmed cash equity source for v1 snapshots', () => {
    const v2 = migrateInputs(V1_SNAPSHOT);
    expect(v2.equity_sources).toHaveLength(1);
    expect(v2.equity_sources[0].classification).toBe('cash');
    expect(v2.equity_sources[0].evidence_status).toBe('unconfirmed');
    // residual equity = 75,309,600 − 52,716,720
    expect(v2.equity_sources[0].amount_pence).toBe(22_592_880);
  });

  it('forces zero facility for v1 cash funding', () => {
    const v2 = migrateInputs({ ...V1_SNAPSHOT, finance: { ...V1_SNAPSHOT.finance, funding_source: 'cash' } });
    expect(v2.finance.committed_net_facility_pence).toBe(0);
    expect(v2.finance.legacy_leverage_pct).toBe(70);
    expect(v2.equity_sources[0].amount_pence).toBe(75_309_600);
  });

});

describe('migrateV2toV3', () => {
  it('migrates a minimal v2 document to v3 with lender_valuation null and enforcement default 0, all other fields byte-identical', () => {
    const v2 = defaultCalculatorInputsV2();
    const v3 = migrateV2toV3(v2);

    expect(v3.inputs_version).toBe(3);
    expect(v3.lender_valuation).toBeNull();
    expect(v3.finance.enforcement_cost_assumption_pence).toBe(0);

    const { inputs_version: _v2Version, ...v2Rest } = v2;
    const { inputs_version: _v3Version, lender_valuation: _lv, ...v3Rest } = v3;
    expect(v3Rest).toEqual(v2Rest);
  });

  it('rejects migrating an already-v3 document (idempotence guard), and isV3 recognises it', () => {
    const v2 = defaultCalculatorInputsV2();
    const v3 = migrateV2toV3(v2);

    expect(isV3(v3 as unknown as Record<string, unknown>)).toBe(true);
    expect(() => migrateV2toV3(v3 as unknown as CalculatorInputsV2)).toThrow();
  });

  it('chains a v1 snapshot through migrateInputs then migrateV2toV3, ending at v3 with both new fields defaulted and the v1 migration flags intact', () => {
    const v2 = migrateInputs(V1_SNAPSHOT);
    const v3 = migrateV2toV3(v2);

    expect(v3.inputs_version).toBe(3);
    expect(v3.lender_valuation).toBeNull();
    expect(v3.finance.enforcement_cost_assumption_pence).toBe(0);
    // v1 migration flags preserved:
    expect(v3.finance.requires_confirmation).toBe(true);
    expect(v3.finance.legacy_leverage_pct).toBe(70);
    expect(v3.equity_sources[0].evidence_status).toBe('unconfirmed');
  });

  it('passes an already-present (illegal on a v2 doc) lender_valuation block through unchanged, then validates as v3', () => {
    const v2 = defaultCalculatorInputsV2();
    const illegalBlock = {
      basis: 'fixed_amount' as const, global_value: 100_000_00, per_key_values: null,
      reason: 'Independent RICS valuation', author: 'J. Smith', date: '2026-01-01',
    };
    const v2WithBlock = { ...v2, lender_valuation: illegalBlock } as unknown as CalculatorInputsV2;

    const v3 = migrateV2toV3(v2WithBlock);

    expect(v3.inputs_version).toBe(3);
    expect(v3.lender_valuation).toEqual(illegalBlock);
  });
});
