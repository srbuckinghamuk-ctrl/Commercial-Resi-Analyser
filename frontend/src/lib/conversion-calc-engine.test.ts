import { describe, it, expect } from 'vitest';
import {
  calculateGdv,
  calculateTotalAcquisitionCost,
  calculateTotalConstructionCost,
  calculateTotalProfessionalFees,
  calculateSellingCosts,
  calculateFinance,
  calculateIrr,
  calculateAppraisal,
} from './conversion-calc-engine';
import { buildCashflow } from './conversion-cashflow';
import { applyScenario } from './conversion-scenarios';
import type { ProposedUnit, AcquisitionInputs, ConversionCostInputs } from './conversion-types';
import { defaultCalculatorInputs } from './conversion-defaults';

describe('calculateGdv', () => {
  it('returns zero for empty units', () => {
    expect(calculateGdv([])).toBe(0);
  });

  it('sums unit values', () => {
    const units: ProposedUnit[] = [
      { id: '1', type: '1bed', floor_area_sqm: 500, estimated_value_pence: 25_000_000, comparable_notes: '' },
      { id: '2', type: '2bed', floor_area_sqm: 700, estimated_value_pence: 35_000_000, comparable_notes: '' },
    ];
    expect(calculateGdv(units)).toBe(60_000_000);
  });
});

describe('calculateTotalAcquisitionCost', () => {
  it('includes purchase price, SDLT, legal, survey, broker fee', () => {
    const acq: AcquisitionInputs = {
      purchase_price_pence: 50_000_000,
      legal_fees_pence: 500_000,
      survey_cost_pence: 300_000,
      broker_fee_pct: 1.0,
      other_acquisition_costs_pence: 0,
    };
    // SDLT on £500k: £14,500 = 1,450,000 pence
    // Broker: 1% of £500k = £5,000 = 500,000 pence
    // Total: 50,000,000 + 1,450,000 + 500,000 + 300,000 + 500,000 = 52,750,000
    const result = calculateTotalAcquisitionCost(acq);
    expect(result).toBe(52_750_000);
  });
});

describe('calculateTotalConstructionCost', () => {
  it('calculates base cost plus contingency plus compliance', () => {
    const costs: ConversionCostInputs = {
      prior_approval_fee_per_dwelling_pence: 0,
      cil_s106_pence: 0,
      architect_pence: 0,
      structural_engineer_pence: 0,
      mande_pence: 0,
      planning_consultant_pence: 0,
      building_control_pence: 0,
      other_professional_fees_pence: 0,
      construction_cost_per_sqm_pence: 10_000,
      total_construction_sqm: 1000,
      contingency_pct: 10,
      fire_safety_pence: 100_000,
      sound_insulation_pence: 50_000,
      part_l_compliance_pence: 50_000,
    };
    // Base: 10,000 * 1000 = 10,000,000
    // Contingency: 10% of 10,000,000 = 1,000,000
    // Compliance: 100,000 + 50,000 + 50,000 = 200,000
    // Total: 11,200,000
    expect(calculateTotalConstructionCost(costs)).toBe(11_200_000);
  });
});

describe('calculateTotalProfessionalFees', () => {
  it('sums all professional fees', () => {
    const costs: ConversionCostInputs = {
      prior_approval_fee_per_dwelling_pence: 9_600,
      cil_s106_pence: 500_000,
      architect_pence: 1_500_000,
      structural_engineer_pence: 500_000,
      mande_pence: 500_000,
      planning_consultant_pence: 300_000,
      building_control_pence: 200_000,
      other_professional_fees_pence: 100_000,
      construction_cost_per_sqm_pence: 0,
      total_construction_sqm: 0,
      contingency_pct: 0,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    };
    expect(calculateTotalProfessionalFees(costs, 1)).toBe(3_609_600);
  });
});

describe('calculateIrr', () => {
  it('returns reasonable IRR for simple cashflow', () => {
    // Invest 100, get 120 back after 12 months
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120];
    const monthly = calculateIrr(cashflows);
    expect(monthly).not.toBeNull();
    expect(monthly!).toBeGreaterThan(0);
    expect(monthly!).toBeLessThan(5);
  });

  it('returns 0 for break-even', () => {
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    const monthly = calculateIrr(cashflows);
    expect(monthly).not.toBeNull();
    expect(monthly!).toBeCloseTo(0, 1);
  });

  it('returns negative for loss-making', () => {
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80];
    const monthly = calculateIrr(cashflows);
    expect(monthly).not.toBeNull();
    expect(monthly!).toBeLessThan(0);
  });

  it('returns null when cashflows never turn positive', () => {
    // The old Newton solver diverged to ~3e11% on this shape.
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -200];
    expect(calculateIrr(cashflows)).toBeNull();
  });

  it('returns null for all-positive or single-element cashflows', () => {
    expect(calculateIrr([100, 100])).toBeNull();
    expect(calculateIrr([-100])).toBeNull();
  });

  it('never returns a non-finite rate', () => {
    const cases = [
      [-1000, 1200],
      [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, -200],
      [-1, 1000000],
    ];
    for (const cf of cases) {
      const irr = calculateIrr(cf);
      if (irr !== null) {
        expect(Number.isFinite(irr)).toBe(true);
      }
    }
  });
});

describe('calculateFinance', () => {
  function financedInputs() {
    const inputs = defaultCalculatorInputs({ id: 't', price_pence: 50_000_000, floor_area_sqm: 1000 });
    inputs.unit_mix.units = [
      { id: '1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 40_000_000, comparable_notes: '' },
    ];
    return inputs;
  }

  it('charges nothing for a cash purchase', () => {
    const inputs = financedInputs();
    inputs.finance.funding_source = 'cash';
    const finance = calculateFinance(inputs);
    expect(finance.loan_amount_pence).toBe(0);
    expect(finance.total_finance_cost_pence).toBe(0);

    const metrics = calculateAppraisal(inputs);
    expect(metrics.total_finance_cost_pence).toBe(0);
    expect(metrics.loan_amount_pence).toBe(0);
    expect(metrics.equity_required_pence).toBe(metrics.total_cost_pence);
  });

  it('rolled-up interest costs at least as much as serviced', () => {
    const rolled = financedInputs();
    rolled.finance.interest_type = 'rolled_up';
    const serviced = financedInputs();
    serviced.finance.interest_type = 'serviced';
    expect(calculateFinance(rolled).total_interest_pence).toBeGreaterThanOrEqual(
      calculateFinance(serviced).total_interest_pence,
    );
  });

  it('drawdown interest is below full-loan-full-term simple interest', () => {
    const inputs = financedInputs();
    const finance = calculateFinance(inputs);
    const monthlyRate = inputs.finance.interest_rate_annual_pct / 100 / 12;
    const naive = finance.loan_amount_pence * monthlyRate * inputs.finance.loan_term_months;
    expect(finance.total_interest_pence).toBeLessThan(naive);
    expect(finance.total_interest_pence).toBeGreaterThan(0);
  });

  it('cashflow interest agrees with the engine interest', () => {
    const inputs = financedInputs();
    const finance = calculateFinance(inputs);
    const cashflow = buildCashflow(inputs);
    expect(cashflow.total_interest_pence).toBe(finance.total_interest_pence);
  });

  it('zero or negative loan term produces no interest and no cashflow', () => {
    const inputs = financedInputs();
    inputs.finance.loan_term_months = 0;
    expect(calculateFinance(inputs).total_interest_pence).toBe(0);
    expect(buildCashflow(inputs).months).toHaveLength(0);
    inputs.finance.loan_term_months = -3;
    expect(calculateFinance(inputs).total_interest_pence).toBe(0);
  });
});

describe('calculateSellingCosts', () => {
  const units: ProposedUnit[] = [
    { id: 'a', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 20_000_000, comparable_notes: '' },
    { id: 'b', type: '2bed', floor_area_sqm: 70, estimated_value_pence: 30_000_000, comparable_notes: '' },
  ];

  it('charges agent fee on full GDV when selling all', () => {
    const cost = calculateSellingCosts(
      { route: 'sell_all', selling_agent_fee_pct: 2, selling_legal_fee_pence: 100_000, retained_units: [] },
      units,
    );
    // 2% of 50,000,000 = 1,000,000 + 100,000 legal
    expect(cost).toBe(1_100_000);
  });

  it('charges nothing when retaining everything', () => {
    const cost = calculateSellingCosts(
      { route: 'retain_all', selling_agent_fee_pct: 2, selling_legal_fee_pence: 100_000, retained_units: [] },
      units,
    );
    expect(cost).toBe(0);
  });

  it('charges only on sold value for a blended exit', () => {
    const cost = calculateSellingCosts(
      {
        route: 'blended',
        selling_agent_fee_pct: 2,
        selling_legal_fee_pence: 100_000,
        retained_units: [{ unit_id: 'b', monthly_rent_pence: 100_000 }],
      },
      units,
    );
    // 2% of 20,000,000 (unit a only) = 400,000 + 100,000
    expect(cost).toBe(500_000);
  });

  it('selling costs reduce profit in the appraisal', () => {
    const inputs = defaultCalculatorInputs({ id: 't', price_pence: 30_000_000, floor_area_sqm: 500 });
    inputs.unit_mix.units = [...units];
    const withCosts = calculateAppraisal(inputs);
    const noCosts = calculateAppraisal({
      ...inputs,
      exit_strategy: { ...inputs.exit_strategy, selling_agent_fee_pct: 0, selling_legal_fee_pence: 0 },
    });
    expect(withCosts.total_selling_costs_pence).toBeGreaterThan(0);
    expect(withCosts.profit_pence).toBe(noCosts.profit_pence - withCosts.total_selling_costs_pence);
  });
});

describe('applyScenario', () => {
  it('floors the loan term at one month', () => {
    const inputs = defaultCalculatorInputs({ id: 't', price_pence: 10_000_000, floor_area_sqm: 100 });
    inputs.finance.loan_term_months = 2;
    const adjusted = applyScenario(inputs, {
      label: 'x',
      gdv_adjustment_pct: 0,
      construction_cost_adjustment_pct: 0,
      timeline_adjustment_months: -6,
      interest_rate_adjustment_pct: 0,
    });
    expect(adjusted.finance.loan_term_months).toBe(1);
    // A shortened programme must never create negative interest / free money.
    expect(calculateFinance(adjusted).total_interest_pence).toBeGreaterThanOrEqual(0);
  });
});

describe('calculateAppraisal', () => {
  it('produces complete metrics for valid inputs', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 30_000_000, floor_area_sqm: 2000 });
    inputs.unit_mix.units = [
      { id: '1', type: '1bed', floor_area_sqm: 500, estimated_value_pence: 25_000_000, comparable_notes: '' },
      { id: '2', type: '2bed', floor_area_sqm: 700, estimated_value_pence: 35_000_000, comparable_notes: '' },
      { id: '3', type: '1bed', floor_area_sqm: 450, estimated_value_pence: 22_000_000, comparable_notes: '' },
    ];
    inputs.conversion_costs.construction_cost_per_sqm_pence = 7_500;
    inputs.conversion_costs.total_construction_sqm = 2000;

    const metrics = calculateAppraisal(inputs);

    expect(metrics.total_gdv_pence).toBe(82_000_000);
    expect(metrics.sdlt_pence).toBeGreaterThan(0);
    expect(metrics.total_acquisition_cost_pence).toBeGreaterThan(30_000_000);
    expect(metrics.total_construction_cost_pence).toBeGreaterThan(0);
    expect(metrics.total_cost_pence).toBeGreaterThan(0);
    expect(metrics.profit_pence).toBe(metrics.total_gdv_pence - metrics.total_cost_pence);
    expect(metrics.profit_on_cost_pct).toBeGreaterThan(0);
    expect(metrics.profit_on_gdv_pct).toBeGreaterThan(0);
    expect(metrics.loan_amount_pence).toBeGreaterThan(0);
    expect(metrics.equity_required_pence).toBeGreaterThan(0);
  });

  it('returns zero profit metrics when no units', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqm: 5000 });
    const metrics = calculateAppraisal(inputs);
    expect(metrics.total_gdv_pence).toBe(0);
    expect(metrics.profit_pence).toBeLessThan(0);
  });
});
