import { describe, it, expect } from 'vitest';
import {
  calculateGdv,
  calculateTotalAcquisitionCost,
  calculateTotalConstructionCost,
  calculateTotalProfessionalFees,
} from './conversion-calc-engine';
import type { ProposedUnit, AcquisitionInputs, ConversionCostInputs } from './conversion-types';

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

