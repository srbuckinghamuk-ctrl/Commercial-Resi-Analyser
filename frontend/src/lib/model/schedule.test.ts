import { describe, it, expect } from 'vitest';
import { buildSchedule, spreadStraightLine } from './schedule';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import type { CalculatorInputsV2 } from './finance-types';

function baseInputs(): CalculatorInputsV2 {
  const inputs = defaultCalculatorInputsV2();
  inputs.acquisition = {
    purchase_price_pence: 40_000_000, legal_fees_pence: 500_000, survey_cost_pence: 300_000,
    broker_fee_pct: 1.0, other_acquisition_costs_pence: 0,
  };
  inputs.unit_mix = {
    units: [1, 2, 3, 4].map((n) => ({
      id: `u${n}`, type: '1bed' as const, floor_area_sqm: 50,
      estimated_value_pence: 30_000_000, comparable_notes: '',
    })),
  };
  inputs.conversion_costs = {
    ...inputs.conversion_costs,
    construction_cost_per_sqm_pence: 100_000, total_construction_sqm: 400, contingency_pct: 10,
    fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
    prior_approval_fee_per_dwelling_pence: 9_600, cil_s106_pence: 0,
    architect_pence: 1_500_000, structural_engineer_pence: 500_000, mande_pence: 500_000,
    planning_consultant_pence: 300_000, building_control_pence: 200_000, other_professional_fees_pence: 0,
  };
  inputs.finance.term_months = 12;
  inputs.exit_strategy = {
    route: 'sell_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 400_000, retained_units: [],
  };
  return inputs;
}

describe('spreadStraightLine', () => {
  it('sums exactly to the total (final month absorbs residue)', () => {
    const spread = spreadStraightLine(10_000_001, 3);
    expect(spread).toHaveLength(3);
    expect(spread.reduce((a, b) => a + b, 0)).toBe(10_000_001);
    expect(spread[0]).toBe(3_333_334); // round(10,000,001/3) half-up
    expect(spread[2]).toBe(10_000_001 - 2 * 3_333_334);
  });
});

describe('buildSchedule', () => {
  it('places acquisition, prior approval and ancillary totals in month 0', () => {
    const s = buildSchedule(baseInputs());
    // acquisition = 40,000,000 + SDLT 950,000 + 500,000 + 300,000 + broker 400,000 = 42,150,000
    expect(s.uses[0].acquisition_pence).toBe(42_150_000);
    expect(s.uses[0].statutory_pence).toBe(4 * 9_600); // prior approval month 0
  });

  it('spreads construction over months 1..term-2 and sums exactly', () => {
    const s = buildSchedule(baseInputs());
    const constructionByMonth = s.uses.map((u) => u.construction_pence);
    expect(constructionByMonth[0]).toBe(0);
    expect(constructionByMonth[11]).toBe(0);
    // 400 sqm × 100,000 = 40,000,000 base + 10% = 44,000,000 over months 1..10
    expect(constructionByMonth.reduce((a, b) => a + b, 0)).toBe(44_000_000);
    expect(constructionByMonth[1]).toBe(4_400_000);
  });

  it('books all sale receipts net-of-fee data in the final month for sell_all', () => {
    const s = buildSchedule(baseInputs());
    expect(s.receipts[11].gross_sale_pence).toBe(120_000_000);
    expect(s.receipts[11].agent_fee_pence).toBe(1_800_000);
    expect(s.receipts[11].selling_legal_pence).toBe(400_000);
    expect(s.totals.selling_costs_pence).toBe(2_200_000);
  });

  it('books zero receipts and zero selling costs for retain_all', () => {
    const inputs = baseInputs();
    inputs.exit_strategy.route = 'retain_all';
    const s = buildSchedule(inputs);
    expect(s.receipts.every((r) => r.gross_sale_pence === 0)).toBe(true);
    expect(s.totals.selling_costs_pence).toBe(0);
    expect(s.totals.retained_value_pence).toBe(120_000_000);
    expect(s.totals.gdv_pence).toBe(120_000_000);
  });

  it('splits blended: sold units get receipts, retained units do not', () => {
    const inputs = baseInputs();
    inputs.exit_strategy.route = 'blended';
    inputs.exit_strategy.retained_units = [{ unit_id: 'u1', monthly_rent_pence: 100_000 }];
    const s = buildSchedule(inputs);
    expect(s.receipts[11].gross_sale_pence).toBe(90_000_000);
    expect(s.totals.retained_value_pence).toBe(30_000_000);
    // agent fee on sold only: 1.5% × 90,000,000
    expect(s.receipts[11].agent_fee_pence).toBe(1_350_000);
  });

  it('handles term_months = 1 with everything in month 0', () => {
    const inputs = baseInputs();
    inputs.finance.term_months = 1;
    const s = buildSchedule(inputs);
    expect(s.uses).toHaveLength(1);
    expect(s.receipts[0].gross_sale_pence).toBe(120_000_000);
    const totalUses = s.uses[0].acquisition_pence + s.uses[0].construction_pence
      + s.uses[0].professional_pence + s.uses[0].statutory_pence;
    expect(totalUses).toBe(s.totals.acquisition_pence + s.totals.construction_pence
      + s.totals.professional_pence + s.totals.statutory_pence);
  });
});
