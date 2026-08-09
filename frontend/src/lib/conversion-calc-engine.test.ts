import { describe, it, expect } from 'vitest';
import {
  calculateGdv,
  calculateTotalAcquisitionCost,
  calculateTotalConstructionCost,
  calculateTotalProfessionalFees,
  calculateIrr,
  calculateAppraisal,
} from './conversion-calc-engine';
import type { ProposedUnit, AcquisitionInputs, ConversionCostInputs } from './conversion-types';
import { defaultCalculatorInputs } from './conversion-defaults';

describe('calculateGdv', () => {
  it('returns zero for empty units', () => {
    expect(calculateGdv([])).toBe(0);
  });

  it('sums unit values', () => {
    const units: ProposedUnit[] = [
      { id: '1', type: '1bed', floor_area_sqft: 500, estimated_value_pence: 25_000_000, comparable_notes: '' },
      { id: '2', type: '2bed', floor_area_sqft: 700, estimated_value_pence: 35_000_000, comparable_notes: '' },
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
      construction_cost_per_sqft_pence: 10_000,
      total_construction_sqft: 1000,
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
      construction_cost_per_sqft_pence: 0,
      total_construction_sqft: 0,
      contingency_pct: 0,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    };
    expect(calculateTotalProfessionalFees(costs)).toBe(3_609_600);
  });
});

describe('calculateIrr', () => {
  it('returns reasonable IRR for simple cashflow', () => {
    // Invest 100, get 120 back after 12 months
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120];
    const monthly = calculateIrr(cashflows);
    expect(monthly).toBeGreaterThan(0);
    expect(monthly).toBeLessThan(5);
  });

  it('returns 0 for break-even', () => {
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    const monthly = calculateIrr(cashflows);
    expect(monthly).toBeCloseTo(0, 1);
  });

  it('returns negative for loss-making', () => {
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80];
    const monthly = calculateIrr(cashflows);
    expect(monthly).toBeLessThan(0);
  });
});

describe('calculateAppraisal', () => {
  it('produces complete metrics for valid inputs', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 30_000_000, floor_area_sqft: 2000 });
    inputs.unit_mix.units = [
      { id: '1', type: '1bed', floor_area_sqft: 500, estimated_value_pence: 25_000_000, comparable_notes: '' },
      { id: '2', type: '2bed', floor_area_sqft: 700, estimated_value_pence: 35_000_000, comparable_notes: '' },
      { id: '3', type: '1bed', floor_area_sqft: 450, estimated_value_pence: 22_000_000, comparable_notes: '' },
    ];
    inputs.conversion_costs.construction_cost_per_sqft_pence = 7_500;
    inputs.conversion_costs.total_construction_sqft = 2000;

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
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    const metrics = calculateAppraisal(inputs);
    expect(metrics.total_gdv_pence).toBe(0);
    expect(metrics.profit_pence).toBeLessThan(0);
  });
});
