import { describe, it, expect } from 'vitest';
import {
  calculateGdv,
  calculateBrokerFee,
  calculateTotalAcquisitionCost,
  calculateTotalConstructionCost,
  calculateTotalProfessionalFees,
} from './conversion-calc-engine';
import type { ProposedUnit, AcquisitionInputs, ConversionCostInputs } from './conversion-types';

// M1 (spec §11.9): calculateBrokerFee is the single source of truth for the
// broker fee formula — AcquisitionPage's inline display and
// calculateTotalAcquisitionCost must never compute it independently.
describe('calculateBrokerFee', () => {
  it('rounds half-up to the nearest penny', () => {
    expect(calculateBrokerFee(50_000_000, 1.0)).toBe(500_000);
    expect(calculateBrokerFee(33_333, 1.5)).toBe(500); // 499.995 -> 500
  });

  it('is exactly the figure calculateTotalAcquisitionCost derives its broker component from', () => {
    const acq: AcquisitionInputs = {
      purchase_price_pence: 50_000_000,
      legal_fees_pence: 500_000,
      survey_cost_pence: 300_000,
      broker_fee_pct: 1.0,
      other_acquisition_costs_pence: 0,
    };
    const brokerFee = calculateBrokerFee(acq.purchase_price_pence, acq.broker_fee_pct);
    expect(calculateTotalAcquisitionCost(acq)).toBe(
      acq.purchase_price_pence + 1_450_000 + acq.legal_fees_pence + acq.survey_cost_pence
      + brokerFee + acq.other_acquisition_costs_pence,
    );
  });
});

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

  // Spec §1.1 (amended, Release 2b Task 7): fractional-area products round once, at
  // source, before contingency: base = round_half_up(rate × sqm). Both regressions use
  // zero contingency/compliance so calculateTotalConstructionCost's return value IS the
  // rounded base cost, isolating the rounding site itself.
  it('rounds a fractional base cost (rate × sqm) half-up to the nearest penny before contingency', () => {
    const costs: ConversionCostInputs = {
      prior_approval_fee_per_dwelling_pence: 0,
      cil_s106_pence: 0,
      architect_pence: 0,
      structural_engineer_pence: 0,
      mande_pence: 0,
      planning_consultant_pence: 0,
      building_control_pence: 0,
      other_professional_fees_pence: 0,
      construction_cost_per_sqm_pence: 50_000,
      total_construction_sqm: 500.5,
      contingency_pct: 0,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    };
    // 50,000 × 500.5 = 25,025,000.0 exactly -- already an integer, but proves the
    // rounding site handles a fractional sqm input without disturbing an exact result.
    expect(calculateTotalConstructionCost(costs)).toBe(25_025_000);
  });

  it('rounds an odd-half fractional base cost up, not down (round_half_up, not banker\'s rounding)', () => {
    const costs: ConversionCostInputs = {
      prior_approval_fee_per_dwelling_pence: 0,
      cil_s106_pence: 0,
      architect_pence: 0,
      structural_engineer_pence: 0,
      mande_pence: 0,
      planning_consultant_pence: 0,
      building_control_pence: 0,
      other_professional_fees_pence: 0,
      construction_cost_per_sqm_pence: 333,
      total_construction_sqm: 100.5,
      contingency_pct: 0,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    };
    // 333 × 100.5 = 33,466.5 -- round_half_up(33,466.5) = 33,467 (banker's rounding, which
    // rounds .5 to the nearest even integer, would wrongly give 33,466).
    expect(calculateTotalConstructionCost(costs)).toBe(33_467);
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

