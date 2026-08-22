import { describe, it, expect } from 'vitest';
import { applyScenario } from './apply-scenario';
import { migrateInputsToV6 } from './migrate';
import { runAppraisal, computeCostPlan, developedAreaSqm } from './index';
import {
  defaultCalculatorInputsV2, defaultCalculatorInputsV3, defaultCalculatorInputsV7, DEFAULT_SCENARIOS,
} from '../conversion-defaults';
import type { CalculatorInputsV2, CalculatorInputsV3, CalculatorInputsV6, CalculatorInputsV7, LenderValuation } from './';
import type { ScenarioOverrides } from '../conversion-types';

// Neutral overrides — every lever at 0. Not defined elsewhere in this file, so
// built here per the R10 Task 8 brief rather than reusing DEFAULT_SCENARIOS.base
// (which is not guaranteed to be all-zero).
const BASE_OVERRIDES: ScenarioOverrides = {
  label: 'Base',
  gdv_adjustment_pct: 0,
  construction_cost_adjustment_pct: 0,
  timeline_adjustment_months: 0,
  interest_rate_adjustment_pct: 0,
};

function fixtureInputs(): CalculatorInputsV2 {
  const inputs = defaultCalculatorInputsV2();
  inputs.unit_mix.units = [
    { id: 'u1', type: '2bed', floor_area_sqm: 65, estimated_value_pence: 30_000_000, comparable_notes: '' },
    { id: 'u2', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 20_000_000, comparable_notes: '' },
  ];
  return inputs;
}

describe('applyScenario', () => {
  it('adjusts unit values by the GDV percentage', () => {
    const adjusted = applyScenario(fixtureInputs(), {
      label: 'x',
      gdv_adjustment_pct: 10,
      construction_cost_adjustment_pct: 0,
      timeline_adjustment_months: 0,
      interest_rate_adjustment_pct: 0,
    });
    expect(adjusted.unit_mix.units[0].estimated_value_pence).toBe(33_000_000);
    expect(adjusted.unit_mix.units[1].estimated_value_pence).toBe(22_000_000);
  });

  it('adjusts construction rate, facility term and interest rate', () => {
    const base = fixtureInputs();
    const adjusted = applyScenario(base, {
      label: 'x',
      gdv_adjustment_pct: 0,
      construction_cost_adjustment_pct: 15,
      timeline_adjustment_months: 3,
      interest_rate_adjustment_pct: 1,
    });
    expect(adjusted.conversion_costs.construction_cost_per_sqm_pence).toBe(
      Math.round(base.conversion_costs.construction_cost_per_sqm_pence * 1.15),
    );
    expect(adjusted.finance.term_months).toBe(base.finance.term_months + 3);
    expect(adjusted.finance.annual_interest_rate_pct).toBe(base.finance.annual_interest_rate_pct + 1);
  });

  it('does not mutate the base inputs', () => {
    const base = fixtureInputs();
    const before = JSON.parse(JSON.stringify(base));
    applyScenario(base, DEFAULT_SCENARIOS.downside);
    expect(base).toEqual(before);
  });

  it('the four levers are order-independent because they write to disjoint fields (spec Sec 12.1)', () => {
    // Hand-derived from Fixture F: units 30,000,000 pence each, cost/sqm 100,000 pence,
    // term 12 months, rate 8.0%.
    const base = defaultCalculatorInputsV2();
    base.unit_mix.units = Array(4).fill(null).map((_, i) => ({
      id: `u${i + 1}`,
      type: '2bed',
      floor_area_sqm: 100,
      estimated_value_pence: 30_000_000,
      comparable_notes: '',
    }));
    base.conversion_costs.construction_cost_per_sqm_pence = 100_000;
    base.finance.term_months = 12;
    base.finance.annual_interest_rate_pct = 8.0;

    const both = applyScenario(base, {
      label: 'Test',
      gdv_adjustment_pct: -15,
      construction_cost_adjustment_pct: 15,
      timeline_adjustment_months: -3,
      interest_rate_adjustment_pct: 1.0,
    });

    const staged = applyScenario(
      applyScenario(base, {
        label: 'Test',
        gdv_adjustment_pct: -15,
        construction_cost_adjustment_pct: 0,
        timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      }),
      {
        label: 'Test',
        gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: 15,
        timeline_adjustment_months: -3,
        interest_rate_adjustment_pct: 1.0,
      },
    );

    // GDV results are identical regardless of application order:
    expect(both.unit_mix.units[0].estimated_value_pence).toBe(25_500_000);
    expect(both.unit_mix.units[0].estimated_value_pence).toBe(staged.unit_mix.units[0].estimated_value_pence);

    // Cost results are identical regardless of application order:
    expect(both.conversion_costs.construction_cost_per_sqm_pence).toBe(115_000);
    expect(both.conversion_costs.construction_cost_per_sqm_pence).toBe(
      staged.conversion_costs.construction_cost_per_sqm_pence,
    );
  });

  it('holds the committed facility and equity fixed under downside overrides (spec Sec 12.2)', () => {
    const v2Inputs = fixtureInputs();
    const out = applyScenario(v2Inputs, {
      label: 'Downside',
      gdv_adjustment_pct: -10,
      construction_cost_adjustment_pct: 15,
      timeline_adjustment_months: 3,
      interest_rate_adjustment_pct: 1,
    });
    expect(out.finance.committed_net_facility_pence).toBe(v2Inputs.finance.committed_net_facility_pence);
    expect(out.finance.committed_gross_facility_pence).toBe(v2Inputs.finance.committed_gross_facility_pence);
    expect(out.finance.day_one_advance_pence).toBe(v2Inputs.finance.day_one_advance_pence);
    expect(out.equity_sources).toEqual(v2Inputs.equity_sources);
  });

  // Task 8 fix review (Important #2): applyScenario is generic over
  // CalculatorInputsV2 | CalculatorInputsV3, returning whichever version it was given via an
  // `as T` cast the type checker can't verify structurally — pin that the v3-only fields
  // (lender_valuation, inputs_version, enforcement_cost_assumption_pence) genuinely survive the
  // spread-and-override at runtime, not just that TS accepts the code.
  it('carries lender_valuation, inputs_version and the enforcement-cost assumption through unchanged on a v3 input', () => {
    const lenderValuation: LenderValuation = {
      basis: 'global_pct', global_value: -10, per_key_values: null,
      reason: 'Independent RICS valuation', author: 'J. Smith', date: '2026-01-01',
    };
    const v3Inputs: CalculatorInputsV3 = {
      ...defaultCalculatorInputsV3(),
      unit_mix: {
        units: [
          { id: 'u1', type: '2bed', floor_area_sqm: 65, estimated_value_pence: 30_000_000, comparable_notes: '' },
        ],
      },
      finance: { ...defaultCalculatorInputsV3().finance, enforcement_cost_assumption_pence: 75_000 },
      lender_valuation: lenderValuation,
    };

    const out = applyScenario(v3Inputs, {
      label: 'Downside',
      gdv_adjustment_pct: -10,
      construction_cost_adjustment_pct: 15,
      timeline_adjustment_months: 3,
      interest_rate_adjustment_pct: 1,
    });

    // v3-only fields pass through identically — the generic's whole point:
    expect(out.inputs_version).toBe(3);
    expect(out.lender_valuation).toEqual(lenderValuation);
    expect(out.lender_valuation).toBe(lenderValuation); // shallow-spread passthrough — same reference, not a lossy copy
    expect(out.finance.enforcement_cost_assumption_pence).toBe(75_000);

    // The scenario's own adjusted fields did actually change, so this isn't a no-op passthrough:
    expect(out.unit_mix.units[0].estimated_value_pence).toBe(27_000_000);
    expect(out.conversion_costs.construction_cost_per_sqm_pence).toBe(
      Math.round(v3Inputs.conversion_costs.construction_cost_per_sqm_pence * 1.15),
    );
    expect(out.finance.term_months).toBe(v3Inputs.finance.term_months + 3);
    expect(out.finance.annual_interest_rate_pct).toBe(v3Inputs.finance.annual_interest_rate_pct + 1);
  });
});

// R9 (Task 7 — Defect 2): GDV now has two components — internal saleable value
// (`estimated_value_pence`) and ancillary value (`ancillary.parking_value_pence`,
// `ancillary.balcony_terrace_value_pence`). Left unmoved, every GDV sensitivity,
// every named scenario and the whole tornado chart understate the stress by the
// ancillary share.
describe('R9 — a GDV scenario stresses ancillary value too', () => {
  function v6InputsWithUnit(ancillary: {
    balcony_terrace_sqm: number; balcony_terrace_value_pence: number;
    parking_spaces: number; parking_value_pence: number;
  }): CalculatorInputsV6 {
    const inputs = migrateInputsToV6({}, { id: 'p', price_pence: 0, floor_area_sqm: 0 });
    inputs.unit_mix = {
      units: [{
        id: 'u1', type: '2bed', floor_area_sqm: 65, estimated_value_pence: 25_000_000, comparable_notes: '',
        ancillary,
      }],
    };
    return inputs;
  }

  it('applies the GDV adjustment to parking and balcony value, not just internal', () => {
    const stressed = applyScenario(
      v6InputsWithUnit({
        balcony_terrace_sqm: 0, balcony_terrace_value_pence: 400_000,
        parking_spaces: 1, parking_value_pence: 1_200_000,
      }),
      {
        label: 'downside', gdv_adjustment_pct: -10, construction_cost_adjustment_pct: 0,
        timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0,
      },
    );

    const u = stressed.unit_mix.units[0];
    expect(u.estimated_value_pence).toBe(22_500_000);
    expect(u.ancillary.parking_value_pence).toBe(1_080_000);
    expect(u.ancillary.balcony_terrace_value_pence).toBe(360_000);
  });

  it('leaves ancillary AREAS untouched — a price stress is not an area stress', () => {
    const stressed = applyScenario(
      v6InputsWithUnit({
        balcony_terrace_sqm: 8, balcony_terrace_value_pence: 0,
        parking_spaces: 2, parking_value_pence: 0,
      }),
      {
        label: 'downside', gdv_adjustment_pct: -10, construction_cost_adjustment_pct: 0,
        timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0,
      },
    );
    expect(stressed.unit_mix.units[0].ancillary.balcony_terrace_sqm).toBe(8);
    expect(stressed.unit_mix.units[0].ancillary.parking_spaces).toBe(2);
  });
});

// R10 Task 8 — spec §3.5. `applyScenario` scaled only `conversion_costs`, which
// drives nothing in detailed mode: the cost lives in `cost_plan.packages`. Left
// unfixed, a detailed-mode appraisal is immune to every scenario, tornado bar
// and sensitivity cell while still rendering as though it responded.
describe('the cost lever reaches both modes (R10 spec §3.5)', () => {
  // Two documents with the SAME construction total, built to DIFFERENT shapes.
  //   headline: rate 10,000 p/m2 x 400 m2 = 4,000,000 base
  //             + 10% general contingency  =   400,000  -> 4,400,000
  //   detailed: TWO packages (3,000,000 structure + 1,000,000 envelope) so the
  //             guard cannot be satisfied by a fix that only scales the first
  //             package (e.g. a loop that breaks early, or a `packages[0]` fix
  //             applied under time pressure) — 4,000,000 total
  //             + 10% general contingency  =   400,000  -> 4,400,000
  // Compliance is zero in both (see the note above).
  function pair(): { headline: CalculatorInputsV7; detailed: CalculatorInputsV7 } {
    const base = defaultCalculatorInputsV7();
    const common = {
      ...base,
      finance: { ...base.finance, funding_source: 'cash' as const, term_months: 12 },
      conversion_costs: {
        ...base.conversion_costs,
        construction_cost_per_sqm_pence: 10_000,
        total_construction_sqm: 400,
        fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
      },
      // 'manual' basis so developedAreaSqm returns total_construction_sqm (400)
      // rather than a derived bridge figure — the headline base must be a number
      // this test controls, not one another block decides.
      areas: { ...base.areas, basis: 'manual' as const },
    };
    const contingency = [
      { name: 'general' as const, pct: 10 },
      { name: 'existing_building' as const, pct: 0 },
      { name: 'abnormal' as const, pct: 0 },
    ];
    return {
      headline: { ...common, cost_plan: { mode: 'headline', packages: [], contingency, fee_lines: [] } },
      detailed: { ...common, cost_plan: {
        mode: 'detailed',
        packages: [
          { id: 'p1', code: 'structure', label: 'Structure',
            amount_pence: 3_000_000, contingency_class: 'general',
            lender_eligible: true, notes: '', vat_override: null },
          { id: 'p2', code: 'envelope', label: 'Envelope',
            amount_pence: 1_000_000, contingency_class: 'general',
            lender_eligible: true, notes: '', vat_override: null },
        ],
        contingency,
        fee_lines: [],
      } },
    };
  }

  it('the two documents describe the same construction total', () => {
    const { headline, detailed } = pair();
    expect(runAppraisal(headline).metrics.construction_cost_pence).toBe(4_400_000);
    expect(runAppraisal(detailed).metrics.construction_cost_pence).toBe(4_400_000);
  });

  it('and respond identically to a -10% and a +10% cost stress', () => {
    const { headline, detailed } = pair();
    // -10%: base 3,600,000 + 10% = 3,960,000.  +10%: 4,400,000 + 10% = 4,840,000.
    const expected: Record<number, number> = { [-10]: 3_960_000, [10]: 4_840_000 };
    for (const adj of [-10, 10]) {
      const overrides = { ...BASE_OVERRIDES, construction_cost_adjustment_pct: adj };
      const h = runAppraisal(applyScenario(headline, overrides)).metrics.construction_cost_pence;
      const d = runAppraisal(applyScenario(detailed, overrides)).metrics.construction_cost_pence;
      expect(h).toBe(expected[adj]);
      expect(d).toBe(expected[adj]);
      // The literals above are what make this falsifiable. Asserting only
      // `d === h` would pass with BOTH modes inert, which is the exact defect
      // this test exists to catch.
    }
  });
});

// I2 (Task 8 fix round 1). The cross-mode pair above deliberately carries zero
// compliance and no fee lines, so it cannot see a regression that started
// scaling either. This is a headline-only case with both present, asserting
// the two negative requirements directly: compliance does NOT move with the
// cost lever (fixed allowance, pre-R10 behaviour), and a fixed fee does NOT
// move either — while a percentage fee DOES move, but only because its BASE
// moved, not because the lever touched the fee amount a second time.
describe('the cost lever does not double-apply to compliance or fees (headline mode)', () => {
  function headlineWithComplianceAndFees(): CalculatorInputsV7 {
    const base = defaultCalculatorInputsV7();
    return {
      ...base,
      finance: { ...base.finance, funding_source: 'cash' as const, term_months: 12 },
      conversion_costs: {
        ...base.conversion_costs,
        construction_cost_per_sqm_pence: 10_000,
        total_construction_sqm: 400,
        // Compliance: 200,000 + 150,000 + 150,000 = 500,000 total.
        fire_safety_pence: 200_000, sound_insulation_pence: 150_000, part_l_compliance_pence: 150_000,
      },
      areas: { ...base.areas, basis: 'manual' as const },
      cost_plan: {
        mode: 'headline',
        packages: [],
        contingency: [
          { name: 'general', pct: 10 },
          { name: 'existing_building', pct: 0 },
          { name: 'abnormal', pct: 0 },
        ],
        fee_lines: [
          {
            id: 'fee-fixed', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'fixed', amount_pence: 200_000, pct: 0, per_dwelling: false, vat_override: null,
          },
          {
            id: 'fee-pct', code: 'other_professional', category: 'professional', label: 'Other professional fees',
            basis: 'pct_of_construction_total', amount_pence: 0, pct: 5, per_dwelling: false, vat_override: null,
          },
        ],
      },
    };
  }

  it('at rest: base 4,000,000 + 10% contingency 400,000 + 500,000 compliance = 4,900,000; pct fee = 5% of that', () => {
    const inputs = headlineWithComplianceAndFees();
    const plan = computeCostPlan(inputs, developedAreaSqm(inputs), inputs.unit_mix.units.length);
    expect(plan.base_build_pence).toBe(4_000_000);
    expect(plan.compliance_pence).toBe(500_000);
    expect(plan.construction_total_pence).toBe(4_900_000);
    expect(plan.fees.find((f) => f.id === 'fee-fixed')!.amount_pence).toBe(200_000);
    expect(plan.fees.find((f) => f.id === 'fee-pct')!.base_pence).toBe(4_900_000);
    expect(plan.fees.find((f) => f.id === 'fee-pct')!.amount_pence).toBe(245_000);
  });

  it('under a -10% cost stress: base build scales, compliance and the fixed fee do not, the pct fee moves only because its base moved', () => {
    const inputs = headlineWithComplianceAndFees();
    const stressed = applyScenario(inputs, { ...BASE_OVERRIDES, construction_cost_adjustment_pct: -10 });
    const plan = computeCostPlan(stressed, developedAreaSqm(stressed), stressed.unit_mix.units.length);

    // Base build: rate 10,000 x 0.9 = 9,000/m2 x 400 m2 = 3,600,000.
    expect(plan.base_build_pence).toBe(3_600_000);
    // Compliance is a fixed allowance the cost lever does not scale — unchanged.
    expect(plan.compliance_pence).toBe(500_000);
    // Contingency: 10% of the new base build = 360,000.
    // Construction total: 3,600,000 + 360,000 + 500,000 = 4,460,000.
    expect(plan.construction_total_pence).toBe(4_460_000);
    // The fixed fee never reads a base, so it is untouched by any lever.
    expect(plan.fees.find((f) => f.id === 'fee-fixed')!.amount_pence).toBe(200_000);
    // The pct fee's base is the NEW construction total, not the old one.
    const pctFee = plan.fees.find((f) => f.id === 'fee-pct')!;
    expect(pctFee.base_pence).toBe(4_460_000);
    // 5% of 4,460,000 = 223,000 — the fee moved because its base moved.
    // A double-application defect (scaling the fee amount by 0.9 on top of its
    // own recomputation) would instead give 245,000 * 0.9 = 220,500. The two
    // values differ, so this assertion is the discriminating check.
    expect(pctFee.amount_pence).toBe(223_000);
    expect(pctFee.amount_pence).not.toBe(220_500);
  });
});
