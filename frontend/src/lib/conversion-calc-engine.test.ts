import { describe, it, expect } from 'vitest';
import {
  calculateGdv,
  calculateGdvBreakdown,
  unitAncillaryValuePence,
  calculateBrokerFee,
  calculateTotalAcquisitionCost,
  calculateTotalConstructionCost,
  calculateTotalProfessionalFees,
} from './conversion-calc-engine';
import type { ProposedUnit, ProposedUnitV6, AcquisitionInputs, ConversionCostInputs } from './conversion-types';
import { DEFAULT_CONVERSION_COSTS } from './conversion-defaults';
import { DEFAULT_AREA_BRIDGE } from './model/areas';
import type { CalculatorInputsV6 } from './model/finance-types';
import { migrateInputsToV6 } from './model/migrate';
import { buildSchedule } from './model/schedule';

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
    expect(calculateTotalConstructionCost(costs, costs.total_construction_sqm)).toBe(11_200_000);
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
    expect(calculateTotalConstructionCost(costs, costs.total_construction_sqm)).toBe(25_025_000);
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
    expect(calculateTotalConstructionCost(costs, costs.total_construction_sqm)).toBe(33_467);
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

describe('R9 — construction cost takes an explicit area', () => {
  const costs = {
    ...DEFAULT_CONVERSION_COSTS,
    construction_cost_per_sqm_pence: 50_000,
    contingency_pct: 10,
    fire_safety_pence: 100,
    sound_insulation_pence: 100,
    part_l_compliance_pence: 100,
  };

  it('multiplies the supplied area, not the stored field', () => {
    // 500 x 50,000 = 25,000,000; +10% = 27,500,000; +300 compliance
    expect(calculateTotalConstructionCost({ ...costs, total_construction_sqm: 9999 }, 500))
      .toBe(27_500_300);
  });

  it('rounds the fractional-area product once, before contingency (spec §1.1)', () => {
    // 520.5 x 50,000 = 26,025,000 exactly; +10% = 28,627,500; +300
    expect(calculateTotalConstructionCost(costs, 520.5)).toBe(28_627_800);
  });
});

describe('R9 — GDV splits internal saleable from ancillary', () => {
  const units: ProposedUnitV6[] = [
    { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '',
      ancillary: { balcony_terrace_sqm: 6, balcony_terrace_value_pence: 400_000, parking_spaces: 1, parking_value_pence: 1_200_000 } },
    { id: 'u2', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 24_500_000, comparable_notes: '',
      ancillary: { balcony_terrace_sqm: 0, balcony_terrace_value_pence: 0, parking_spaces: 1, parking_value_pence: 1_200_000 } },
  ];

  it('reports internal and ancillary separately', () => {
    const b = calculateGdvBreakdown(units);
    expect(b.internal_pence).toBe(49_500_000);
    expect(b.ancillary_pence).toBe(2_800_000);
    expect(b.total_pence).toBe(52_300_000);
  });

  it('keeps calculateGdv as the total, so existing callers are unaffected', () => {
    expect(calculateGdv(units)).toBe(52_300_000);
  });

  it('treats a pre-v6 unit with no ancillary block as zero ancillary', () => {
    const legacy: ProposedUnit[] = [
      { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' },
    ];
    const b = calculateGdvBreakdown(legacy);
    expect(b.ancillary_pence).toBe(0);
    expect(b.total_pence).toBe(25_000_000);
    expect(unitAncillaryValuePence(legacy[0])).toBe(0);
  });

  it('sums parking and balcony/terrace value for a single unit', () => {
    expect(unitAncillaryValuePence(units[0])).toBe(1_600_000);
    expect(unitAncillaryValuePence(units[1])).toBe(1_200_000);
  });
});

describe('R9 — the schedule resolves its cost area through the accessor', () => {
  function makeV6Inputs(overrides: Partial<CalculatorInputsV6> = {}): CalculatorInputsV6 {
    return {
      ...migrateInputsToV6({}, { id: 'p', price_pence: 0, floor_area_sqm: 0 }),
      ...overrides,
    };
  }

  it('uses the bridge-derived area when the bridge basis is selected', () => {
    const inputs = makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 520 },
      conversion_costs: { ...DEFAULT_CONVERSION_COSTS, construction_cost_per_sqm_pence: 50_000, total_construction_sqm: 9999 },
    });
    const s = buildSchedule(inputs);
    // 520 x 50,000 x 1.10
    expect(s.totals.construction_pence).toBe(28_600_000);
  });

  it('uses the manual field when the manual basis is selected', () => {
    const inputs = makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual', existing_gia_sqm: 520 },
      conversion_costs: { ...DEFAULT_CONVERSION_COSTS, construction_cost_per_sqm_pence: 50_000, total_construction_sqm: 400 },
    });
    expect(buildSchedule(inputs).totals.construction_pence).toBe(22_000_000);
  });
});

