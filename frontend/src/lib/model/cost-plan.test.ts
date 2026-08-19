import { describe, it, expect } from 'vitest';
import { computeCostPlan } from './cost-plan';
import { defaultCalculatorInputsV6, defaultCalculatorInputsV7 } from '../conversion-defaults';
import type { CalculatorInputsV7 } from './finance-types';

/** A v7 document with the cost plan (and optionally the cost fields) replaced.
 *  `defaultCalculatorInputsV7` comes from Task 1. */
function doc(over: Partial<CalculatorInputsV7['cost_plan']>, costs: Partial<CalculatorInputsV7['conversion_costs']> = {}): CalculatorInputsV7 {
  const base = defaultCalculatorInputsV7();
  return {
    ...base,
    conversion_costs: { ...base.conversion_costs, ...costs },
    cost_plan: { ...base.cost_plan, ...over },
  };
}

const CLASSES = (general: number, existing: number, abnormal: number) => [
  { name: 'general' as const, pct: general, basis: 'all_packages' as const, package_ids: [] },
  { name: 'existing_building' as const, pct: existing, basis: 'all_packages' as const, package_ids: [] },
  { name: 'abnormal' as const, pct: abnormal, basis: 'all_packages' as const, package_ids: [] },
];

const pkg = (id: string, amount: number, over = {}) => ({
  id, code: 'structure' as const, label: id, amount_pence: amount,
  contingency_class: 'general' as const, lender_eligible: true, notes: '', ...over,
});

describe('computeCostPlan — headline mode', () => {
  it('reproduces the pre-R10 base = rate x area', () => {
    // 80,730 p/m2 x 500 m2 = 40,365,000 p. Derived by hand.
    const r = computeCostPlan(
      doc({ mode: 'headline', contingency: CLASSES(0, 0, 0) },
          { construction_cost_per_sqm_pence: 80_730 }),
      500, 1,
    );
    expect(r.base_build_pence).toBe(40_365_000);
    expect(r.compliance_pence).toBe(0);
    expect(r.construction_total_pence).toBe(40_365_000);
  });

  it('keeps compliance allowances as a separate component in headline mode', () => {
    // 40,365,000 base + 0 contingency + (250,000 + 150,000 + 100,000) compliance
    const r = computeCostPlan(
      doc({ mode: 'headline', contingency: CLASSES(0, 0, 0) }, {
        construction_cost_per_sqm_pence: 80_730,
        fire_safety_pence: 250_000, sound_insulation_pence: 150_000,
        part_l_compliance_pence: 100_000,
      }),
      500, 1,
    );
    expect(r.compliance_pence).toBe(500_000);
    expect(r.construction_total_pence).toBe(40_865_000);
  });
});

describe('computeCostPlan — three contingency classes round independently', () => {
  it('sums three rounded figures rather than rounding the sum', () => {
    // Base build chosen so each 5% lands on a half-penny: 1,000,010 x 5% =
    // 50,000.5 -> 50,001 half-up. Three classes: 150,003.
    // One class at 15% would be 150,001.5 -> 150,002. The two differ by 1p, so
    // this test fails if the classes are ever collapsed for rounding.
    const r = computeCostPlan(
      doc({ mode: 'detailed', packages: [pkg('p1', 1_000_010)], contingency: CLASSES(5, 5, 5) }),
      0, 1,
    );
    expect(r.contingency.map((c) => c.amount_pence)).toEqual([50_001, 50_001, 50_001]);
    expect(r.contingency_total_pence).toBe(150_003);
  });

  it('resolves a selected_packages class against only the named packages', () => {
    // existing_building at 20% of p2 alone (2,000,000) = 400,000.
    // general at 10% of the whole base build (3,000,000) = 300,000.
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 1_000_000), pkg('p2', 2_000_000)],
        contingency: [
          { name: 'general', pct: 10, basis: 'all_packages', package_ids: [] },
          { name: 'existing_building', pct: 20, basis: 'selected_packages', package_ids: ['p2'] },
          { name: 'abnormal', pct: 0, basis: 'all_packages', package_ids: [] },
        ],
      }),
      0, 1,
    );
    expect(r.base_build_pence).toBe(3_000_000);
    expect(r.contingency[0].base_pence).toBe(3_000_000);
    expect(r.contingency[0].amount_pence).toBe(300_000);
    expect(r.contingency[1].base_pence).toBe(2_000_000);
    expect(r.contingency[1].amount_pence).toBe(400_000);
    expect(r.contingency_total_pence).toBe(700_000);
  });
});

describe('computeCostPlan — fee bases never include fees', () => {
  it('resolves pct_of_construction_total against cost only, not against other fees', () => {
    // base_build 2,000,000; general contingency 10% = 200,000; compliance 0
    // (detailed mode) -> construction_total 2,200,000.
    // Architect at 6% of construction total = 132,000.
    // A large fixed fee of 9,000,000 is present precisely so that a defect
    // which folded fees into the base would produce 672,000 instead of 132,000.
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 2_000_000)],
        contingency: CLASSES(10, 0, 0),
        fee_lines: [
          { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'pct_of_construction_total', amount_pence: 0, pct: 6, per_dwelling: false },
          { id: 'f2', code: 'other_professional', category: 'professional', label: 'PM',
            basis: 'fixed', amount_pence: 9_000_000, pct: 0, per_dwelling: false },
        ],
      }),
      0, 1,
    );
    expect(r.construction_total_pence).toBe(2_200_000);
    expect(r.fees[0].base_pence).toBe(2_200_000);
    expect(r.fees[0].amount_pence).toBe(132_000);
    expect(r.professional_total_pence).toBe(9_132_000);
  });

  it('resolves pct_of_base_build against the base build, excluding contingency', () => {
    // base_build 2,000,000, contingency 10% -> the two bases differ by 200,000.
    // 6% of 2,000,000 = 120,000, against 132,000 on the other basis.
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 2_000_000)],
        contingency: CLASSES(10, 0, 0),
        fee_lines: [
          { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'pct_of_base_build', amount_pence: 0, pct: 6, per_dwelling: false },
        ],
      }),
      0, 1,
    );
    expect(r.fees[0].base_pence).toBe(2_000_000);
    expect(r.fees[0].amount_pence).toBe(120_000);
  });

  it('multiplies a per_dwelling fixed fee by unit count and splits categories', () => {
    // prior approval 9,600 x 4 dwellings = 38,400, STATUTORY.
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 1_000_000)],
        contingency: CLASSES(0, 0, 0),
        fee_lines: [
          { id: 'f1', code: 'prior_approval', category: 'statutory', label: 'Prior approval',
            basis: 'fixed', amount_pence: 9_600, pct: 0, per_dwelling: true },
          { id: 'f2', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'fixed', amount_pence: 1_500_000, pct: 0, per_dwelling: false },
        ],
      }),
      0, 4,
    );
    expect(r.statutory_total_pence).toBe(38_400);
    expect(r.professional_total_pence).toBe(1_500_000);
  });
});

describe('computeCostPlan — detailed mode drops compliance to zero', () => {
  it('ignores the compliance fields entirely in detailed mode', () => {
    // Validation rejects this document (Task 10), but the ENGINE must not
    // double count if it ever sees one: compliance is 0 in detailed mode.
    const r = computeCostPlan(
      doc({ mode: 'detailed', packages: [pkg('p1', 1_000_000)], contingency: CLASSES(0, 0, 0) },
          { fire_safety_pence: 250_000 }),
      0, 1,
    );
    expect(r.compliance_pence).toBe(0);
    expect(r.construction_total_pence).toBe(1_000_000);
  });
});

describe('computeCostPlan — a pre-v7 document keeps its own figures', () => {
  it('derives the plan from the legacy cost fields, not from DEFAULT_COST_PLAN', () => {
    // The exact defect this guards: DEFAULT_COST_PLAN has no fee lines and a
    // hardcoded 10% contingency, so a v6 document would report zero professional
    // fees and the wrong contingency once the schedule reads these totals.
    // Contingency 15% (not the 10% default) and architect 1,500,000 are both
    // chosen so the wrong fallback produces visibly wrong numbers.
    //
    // DEFAULT_CONVERSION_COSTS carries non-zero defaults for every fee field
    // (structural_engineer_pence, mande_pence, planning_consultant_pence,
    // prior_approval_fee_per_dwelling_pence), so every fee field other than
    // architect/building_control is zeroed here too — otherwise the totals
    // below would include figures this test never mentions.
    const v6 = defaultCalculatorInputsV6();
    v6.conversion_costs = {
      ...v6.conversion_costs,
      construction_cost_per_sqm_pence: 10_000,
      contingency_pct: 15,
      architect_pence: 1_500_000,
      structural_engineer_pence: 0,
      mande_pence: 0,
      planning_consultant_pence: 0,
      other_professional_fees_pence: 0,
      building_control_pence: 200_000,
      prior_approval_fee_per_dwelling_pence: 0,
      cil_s106_pence: 0,
      fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
    };
    const r = computeCostPlan(v6, 400, 1);
    expect(r.base_build_pence).toBe(4_000_000);
    expect(r.contingency[0].pct).toBe(15);
    expect(r.contingency_total_pence).toBe(600_000);   // 15% of 4,000,000
    expect(r.professional_total_pence).toBe(1_500_000);
    expect(r.statutory_total_pence).toBe(200_000);
  });
});

describe('computeCostPlan — reported extras', () => {
  it('reports the lender-eligible base and the implied rate', () => {
    // eligible = p1 only (2,000,000); implied rate = 3,000,000 / 500 = 6,000 p/m2
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 2_000_000), pkg('p2', 1_000_000, { lender_eligible: false })],
        contingency: CLASSES(0, 0, 0),
      }),
      500, 1,
    );
    expect(r.lender_eligible_base_pence).toBe(2_000_000);
    expect(r.implied_rate_pence_per_sqm).toBe(6_000);
  });

  it('returns a null implied rate when the area is zero', () => {
    const r = computeCostPlan(
      doc({ mode: 'detailed', packages: [pkg('p1', 2_000_000)], contingency: CLASSES(0, 0, 0) }),
      0, 1,
    );
    expect(r.implied_rate_pence_per_sqm).toBeNull();
  });
});
