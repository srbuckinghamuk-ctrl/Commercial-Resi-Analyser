import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyScenario } from './apply-scenario';
import { migrateInputsToV6, migrateInputsToV9 } from './migrate';
import { runAppraisal, computeCostPlan, developedAreaSqm } from './index';
import { icDoc, explicitRefinanceDoc, applyLeversInOrder } from './__fixtures__/investment-case-docs';
import { unitSalesDoc } from './__fixtures__/unit-sales-docs';
import { docZ } from './__fixtures__/cost-plan-in-time-docs';
import { ddDoc } from './__fixtures__/due-diligence-docs';
import {
  defaultCalculatorInputsV2, defaultCalculatorInputsV3, defaultCalculatorInputsV7, DEFAULT_SCENARIOS,
} from '../conversion-defaults';
import type {
  AnyCalculatorInputs, CalculatorInputsV2, CalculatorInputsV3, CalculatorInputsV6,
  CalculatorInputsV7, CalculatorInputsV9, CalculatorInputsV17, LenderValuation,
} from './';
import type { Phase } from './programme';
import type { ScenarioOverrides } from '../conversion-types';
import type { SensitivityLever } from './sensitivity';

// Neutral overrides — every lever at 0. Not defined elsewhere in this file, so
// built here per the R10 Task 8 brief rather than reusing DEFAULT_SCENARIOS.base
// (which is not guaranteed to be all-zero).
const BASE_OVERRIDES: ScenarioOverrides = {
  label: 'Base',
  gdv_adjustment_pct: 0,
  construction_cost_adjustment_pct: 0,
  timeline_adjustment_months: 0,
  interest_rate_adjustment_pct: 0,
  phase_slip_phase_id: null,
  phase_slip_months: 0,
  exit_yield_adjustment_pct: 0,
  operating_cost_adjustment_pct: 0,
  vacancy_adjustment_pct: 0,
  sales_slip_months: 0,
  saleable_area_adjustment_pct: 0,
  abnormal_cost_adjustment_pct: 0,
  programme_slip_months: 0,
  refi_ltv_adjustment_pct: 0,
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
      phase_slip_phase_id: null,
      phase_slip_months: 0,
      exit_yield_adjustment_pct: 0,
      operating_cost_adjustment_pct: 0,
      vacancy_adjustment_pct: 0,
      sales_slip_months: 0,
      saleable_area_adjustment_pct: 0,
      abnormal_cost_adjustment_pct: 0,
      programme_slip_months: 0,
      refi_ltv_adjustment_pct: 0,
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
      phase_slip_phase_id: null,
      phase_slip_months: 0,
      exit_yield_adjustment_pct: 0,
      operating_cost_adjustment_pct: 0,
      vacancy_adjustment_pct: 0,
      sales_slip_months: 0,
      saleable_area_adjustment_pct: 0,
      abnormal_cost_adjustment_pct: 0,
      programme_slip_months: 0,
      refi_ltv_adjustment_pct: 0,
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
      phase_slip_phase_id: null,
      phase_slip_months: 0,
      exit_yield_adjustment_pct: 0,
      operating_cost_adjustment_pct: 0,
      vacancy_adjustment_pct: 0,
      sales_slip_months: 0,
      saleable_area_adjustment_pct: 0,
      abnormal_cost_adjustment_pct: 0,
      programme_slip_months: 0,
      refi_ltv_adjustment_pct: 0,
    });

    const staged = applyScenario(
      applyScenario(base, {
        label: 'Test',
        gdv_adjustment_pct: -15,
        construction_cost_adjustment_pct: 0,
        timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
        phase_slip_phase_id: null,
        phase_slip_months: 0,
        exit_yield_adjustment_pct: 0,
        operating_cost_adjustment_pct: 0,
        vacancy_adjustment_pct: 0,
        sales_slip_months: 0,
        saleable_area_adjustment_pct: 0,
        abnormal_cost_adjustment_pct: 0,
        programme_slip_months: 0,
        refi_ltv_adjustment_pct: 0,
      }),
      {
        label: 'Test',
        gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: 15,
        timeline_adjustment_months: -3,
        interest_rate_adjustment_pct: 1.0,
        phase_slip_phase_id: null,
        phase_slip_months: 0,
        exit_yield_adjustment_pct: 0,
        operating_cost_adjustment_pct: 0,
        vacancy_adjustment_pct: 0,
        sales_slip_months: 0,
        saleable_area_adjustment_pct: 0,
        abnormal_cost_adjustment_pct: 0,
        programme_slip_months: 0,
        refi_ltv_adjustment_pct: 0,
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
      phase_slip_phase_id: null,
      phase_slip_months: 0,
      exit_yield_adjustment_pct: 0,
      operating_cost_adjustment_pct: 0,
      vacancy_adjustment_pct: 0,
      sales_slip_months: 0,
      saleable_area_adjustment_pct: 0,
      abnormal_cost_adjustment_pct: 0,
      programme_slip_months: 0,
      refi_ltv_adjustment_pct: 0,
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
      phase_slip_phase_id: null,
      phase_slip_months: 0,
      exit_yield_adjustment_pct: 0,
      operating_cost_adjustment_pct: 0,
      vacancy_adjustment_pct: 0,
      sales_slip_months: 0,
      saleable_area_adjustment_pct: 0,
      abnormal_cost_adjustment_pct: 0,
      programme_slip_months: 0,
      refi_ltv_adjustment_pct: 0,
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
        phase_slip_phase_id: null, phase_slip_months: 0,
        exit_yield_adjustment_pct: 0,
        operating_cost_adjustment_pct: 0,
        vacancy_adjustment_pct: 0,
        sales_slip_months: 0,
        saleable_area_adjustment_pct: 0,
        abnormal_cost_adjustment_pct: 0,
        programme_slip_months: 0,
        refi_ltv_adjustment_pct: 0,
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
        phase_slip_phase_id: null, phase_slip_months: 0,
        exit_yield_adjustment_pct: 0,
        operating_cost_adjustment_pct: 0,
        vacancy_adjustment_pct: 0,
        sales_slip_months: 0,
        saleable_area_adjustment_pct: 0,
        abnormal_cost_adjustment_pct: 0,
        programme_slip_months: 0,
        refi_ltv_adjustment_pct: 0,
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
      headline: { ...common, cost_plan: { mode: 'headline', packages: [], contingency, fee_lines: [], qs: null } },
      detailed: { ...common, cost_plan: {
        mode: 'detailed',
        packages: [
          { id: 'p1', code: 'structure', label: 'Structure',
            amount_pence: 3_000_000, contingency_class: 'general',
            lender_eligible: true, notes: '', vat_override: null, phase_id: null, price_basis: null, benchmark_origin: null },
          { id: 'p2', code: 'envelope', label: 'Envelope',
            amount_pence: 1_000_000, contingency_class: 'general',
            lender_eligible: true, notes: '', vat_override: null, phase_id: null, price_basis: null, benchmark_origin: null },
        ],
        contingency,
        fee_lines: [],
        qs: null,
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
            phase_id: null,
          },
          {
            id: 'fee-pct', code: 'other_professional', category: 'professional', label: 'Other professional fees',
            basis: 'pct_of_construction_total', amount_pence: 0, pct: 5, per_dwelling: false, vat_override: null,
            phase_id: null,
          },
        ],
        qs: null,
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

// R12 Task 14, fix round 1 (Finding 4): the phase_slip lever at the applyScenario
// level, including the full-document order-independence check the Python mirror
// (test_financial_model_apply_scenario.py) already had and this file didn't.

const FIXTURE_F_PATH = resolve(__dirname, '../../../../fixtures/financial-model/f-dev-finance-12mo.json');

function fixtureFInputs(): AnyCalculatorInputs {
  return JSON.parse(readFileSync(FIXTURE_F_PATH, 'utf-8')).inputs as AnyCalculatorInputs;
}

function phase(
  id: string, code: Phase['code'], duration: number,
  preds: Phase['predecessors'] = [], extra: Partial<Phase> = {},
): Phase {
  return {
    id, code, label: id,
    duration_months: duration, slip_months: 0, start_offset: 0,
    curve: { kind: 'straight_line' }, predecessors: preds, ...extra,
  };
}

/** Fixture F migrated to v9 and given a small two-phase network: `planning` (2
 *  months) then `construction` (8 months, FS off `planning`). Mirrors the
 *  identically named helper in sensitivity.test.ts. */
function networkDoc(term = 20): CalculatorInputsV9 {
  const base = migrateInputsToV9(fixtureFInputs() as unknown as Record<string, unknown>);
  const phases: Phase[] = [
    phase('planning', 'planning', 2),
    phase('construction', 'construction', 8, [{ phase_id: 'planning', type: 'FS', lag_months: 0 }]),
  ];
  return {
    ...base,
    finance: { ...base.finance, term_months: term },
    programme: {
      anchor_month: null,
      phases,
      category_phase_ids: {
        construction: 'construction', professional: 'planning', statutory: 'planning',
      },
    },
  };
}

const ZERO_OVERRIDES: ScenarioOverrides = {
  label: '',
  gdv_adjustment_pct: 0,
  construction_cost_adjustment_pct: 0,
  timeline_adjustment_months: 0,
  interest_rate_adjustment_pct: 0,
  phase_slip_phase_id: null,
  phase_slip_months: 0,
  exit_yield_adjustment_pct: 0,
  operating_cost_adjustment_pct: 0,
  vacancy_adjustment_pct: 0,
  sales_slip_months: 0,
  saleable_area_adjustment_pct: 0,
  abnormal_cost_adjustment_pct: 0,
  programme_slip_months: 0,
  refi_ltv_adjustment_pct: 0,
};

/** Sets a phase's `slip_months` directly (not via `applyScenario`), so a test can
 *  record a BASE-CASE slip before a lever stresses it — the only way to
 *  distinguish additive from assignment. */
function withSlip(doc: CalculatorInputsV9, phaseId: string, months: number): CalculatorInputsV9 {
  return {
    ...doc,
    programme: {
      ...doc.programme!,
      phases: doc.programme!.phases.map((p) => (
        p.id === phaseId ? { ...p, slip_months: p.slip_months + months } : p
      )),
    },
  };
}

describe('phase_slip lever — spec §18.9, at the applyScenario level', () => {
  it('adds additively (not assignment) to the named phase only', () => {
    // Hand-derived: planning already carries a base-case slip of 1 month; the
    // override adds 3 more. 1 + 3 = 4, not 3 — distinguishing additive from
    // assignment is the whole point of this test.
    const doc = withSlip(networkDoc(), 'planning', 1);
    const out = applyScenario(doc, {
      ...ZERO_OVERRIDES, phase_slip_phase_id: 'planning', phase_slip_months: 3,
    });
    expect(out.programme!.phases.find((p) => p.id === 'planning')!.slip_months).toBe(4);
    expect(out.programme!.phases.find((p) => p.id === 'construction')!.slip_months).toBe(0);
  });

  it('a null target with NONZERO months leaves every phase untouched', () => {
    // Fix round 1, Finding 2 applied here too: months=0 cannot fail for any
    // predicate that matches the wrong phase.
    const doc = networkDoc();
    const out = applyScenario(doc, {
      ...ZERO_OVERRIDES, phase_slip_phase_id: null, phase_slip_months: 99,
    });
    expect(out.programme).toEqual(doc.programme);
  });

  it('is a no-op on a legacy (v4-v8) three-package programme', () => {
    // The write is gated on the v9 network SHAPE ('phases' in programme), not on
    // inputs_version >= 9: a legacy ProgrammeInputs (`{ packages }`) has no
    // `phases` field, so the lever writes nothing rather than crashing or
    // misinterpreting a package as a phase.
    const legacy = migrateInputsToV6({}, { id: 'p', price_pence: 0, floor_area_sqm: 0 });
    const doc = {
      ...legacy,
      programme: {
        anchor_month: null,
        packages: {
          construction: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' as const } },
          professional: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' as const } },
          statutory: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' as const } },
        },
      },
    };
    const out = applyScenario(doc, {
      ...ZERO_OVERRIDES, phase_slip_phase_id: 'construction', phase_slip_months: 5,
    });
    expect(out.programme).toEqual(doc.programme);
  });

  it('is a no-op on a programme = null document', () => {
    const doc = migrateInputsToV9({});
    expect(doc.programme).toBeNull();
    const out = applyScenario(doc, {
      ...ZERO_OVERRIDES, phase_slip_phase_id: 'planning', phase_slip_months: 5,
    });
    expect(out.programme).toBeNull();
  });

  it('leaves finance and equity_sources untouched — §12.2 facility invariance', () => {
    const doc = networkDoc();
    const out = applyScenario(doc, {
      ...ZERO_OVERRIDES, phase_slip_phase_id: 'planning', phase_slip_months: 6,
    });
    expect(out.finance).toEqual(doc.finance);
    expect(out.equity_sources).toEqual(doc.equity_sources);
  });

  // Fix round 1, Finding 4: the Python mirror already asserted FULL-document
  // equality for this property; this file previously had no equivalent. A
  // partial-field check (only `unit_mix`/`conversion_costs`/`finance`) can pass
  // while something the check didn't look at silently diverges.
  it('composes order-independently with the other four levers — full document equality', () => {
    const doc = networkDoc();
    const scalars: ScenarioOverrides = {
      ...ZERO_OVERRIDES,
      gdv_adjustment_pct: 5, construction_cost_adjustment_pct: -3,
      timeline_adjustment_months: 2, interest_rate_adjustment_pct: 1,
    };
    const slip: ScenarioOverrides = {
      ...ZERO_OVERRIDES, phase_slip_phase_id: 'planning', phase_slip_months: 2,
    };

    const forward = applyScenario(applyScenario(doc, scalars), slip);
    const backward = applyScenario(applyScenario(doc, slip), scalars);
    expect(forward).toEqual(backward);

    // Negative control: the combination must actually differ from applying only
    // the scalars — proof phase_slip is live, not silently absorbed.
    const onlyScalars = applyScenario(doc, scalars);
    expect(forward.programme).not.toEqual(onlyScalars.programme);
  });
});

// R13 spec §19.8: the three levers stressing the investment case. `icDoc()`'s
// fixture (fixtures/financial-model/t-investment-case.json) carries FOUR
// operating lines — id l1 management (pct_of_gross_rent, 10), l2
// letting_and_re_letting (pct_of_gross_rent, 2), l3 insurance
// (fixed_pence_per_month, 25_000), l4 compliance_and_safety
// (fixed_pence_per_month, 8_000) — not the two the brief's own Step 1 text
// assumed; the assertions below are against what the fixture actually holds
// (icDoc()'s own file header requires exactly that of every downstream task).
// Its `cap_yield_pct` is 5.5 and `stabilised_occupancy_pct` is 96.
describe('§19.8 the three exit levers', () => {
  it('exit_yield ADDS percentage points to the capitalisation yield', () => {
    const out = applyScenario(icDoc(), { ...ZERO_OVERRIDES, exit_yield_adjustment_pct: 1.5 });
    expect(out.investment_case!.valuation.cap_yield_pct).toBeCloseTo(7.0, 9);
  });

  it('operating_cost SCALES every line value, on both bases', () => {
    const out = applyScenario(icDoc(), { ...ZERO_OVERRIDES, operating_cost_adjustment_pct: 10 });
    const lines = out.investment_case!.operating_lines;
    expect(lines[0].value).toBeCloseTo(11, 9);      // l1 management, 10% pct line -> 11
    expect(lines[1].value).toBeCloseTo(2.2, 9);      // l2 letting, 2% pct line -> 2.2
    expect(lines[2].value).toBe(27_500);             // l3 insurance, 25_000 fixed pence
    expect(lines[3].value).toBe(8_800);              // l4 compliance, 8_000 fixed pence
  });

  it('vacancy SUBTRACTS percentage points from stabilised occupancy', () => {
    const out = applyScenario(icDoc(), { ...ZERO_OVERRIDES, vacancy_adjustment_pct: 6 });
    expect(out.investment_case!.stabilisation.stabilised_occupancy_pct).toBeCloseTo(90, 9);
  });

  it('is a no-op by construction on an investment_case = null document', () => {
    // Exactly as phase_slip is on a null programme. A lever with nothing to
    // write writes nothing; it does not crash and it does not synthesise a block.
    const doc = explicitRefinanceDoc();
    expect(doc.investment_case).toBeNull();
    const out = applyScenario(doc, {
      ...ZERO_OVERRIDES, exit_yield_adjustment_pct: 2,
      operating_cost_adjustment_pct: 50, vacancy_adjustment_pct: 10,
    });
    expect(out).toEqual(doc);
    expect(out.investment_case).toBeNull();
  });

  it('keeps all THIRTEEN levers order-independent', () => {
    // sales_slip is inert on icDoc() (no unit_sales) -- this test just needs
    // its tie-break slot in LEVER_ORDER exercised; the "sales_slip lever"
    // describe block below is the live one. R16 spec §25.1 appends the four
    // stress-pack levers, extending nine to thirteen. saleable_area and gdv
    // are kept in the SAME relative order (area before gdv) in every list
    // below -- the pair is order-DEPENDENT by design (§12.1's composition
    // rule), not disjoint like the rest, so this generic sweep must not
    // reorder it; the dedicated pin for the pair itself is the composition
    // test in the "R16" describe block below.
    const orders: SensitivityLever[][] = [
      ['saleable_area', 'gdv', 'construction_cost', 'timeline', 'interest_rate', 'phase_slip', 'exit_yield', 'operating_cost', 'vacancy', 'sales_slip', 'abnormal_cost', 'programme_slip', 'refi_ltv'],
      ['vacancy', 'exit_yield', 'phase_slip', 'saleable_area', 'gdv', 'operating_cost', 'interest_rate', 'timeline', 'construction_cost', 'sales_slip', 'refi_ltv', 'abnormal_cost', 'programme_slip'],
      ['operating_cost', 'timeline', 'vacancy', 'interest_rate', 'saleable_area', 'gdv', 'exit_yield', 'construction_cost', 'phase_slip', 'sales_slip', 'programme_slip', 'refi_ltv', 'abnormal_cost'],
    ];
    // deriveMetrics takes (inputs, schedule, model), not a single document — the
    // brief's Step 1 text names it directly, but every other order-independence
    // check in this codebase runs the full appraisal instead (see
    // test_financial_model_apply_scenario.py's guard 7 and this file's own
    // GUARD-7-shaped tests above); runAppraisal(...).metrics is that same shape.
    const results = orders.map((o) => runAppraisal(applyLeversInOrder(icDoc(), o)).metrics);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);

    // R11 rule: a test must be able to fail. applyLeversInOrder steps every
    // lever by the SAME magnitude (5), so swapping saleable_area/gdv's
    // POSITIONS in that harness cannot expose the pair's order-dependence --
    // two equal multipliers compose identically regardless of which is
    // labelled "first". The composition rule only becomes visible under
    // ASYMMETRIC magnitudes (the same -10/+10 pair the dedicated pin uses),
    // applied here as two chained single-lever applyScenario calls -- the
    // only way to observe the reverse composition through the public API,
    // since one call always composes area-before-gdv internally by design.
    const doc = {
      ...icDoc(),
      unit_mix: {
        units: icDoc().unit_mix.units.map((u, i) => (i === 0 ? { ...u, estimated_value_pence: 1_000_005 } : u)),
      },
    };
    const areaThenGdv = applyScenario(doc, { ...BASE_OVERRIDES, saleable_area_adjustment_pct: -10, gdv_adjustment_pct: 10 });
    const gdvThenArea = applyScenario(
      applyScenario(doc, { ...BASE_OVERRIDES, gdv_adjustment_pct: 10 }),
      { ...BASE_OVERRIDES, saleable_area_adjustment_pct: -10 },
    );
    expect(areaThenGdv.unit_mix.units[0].estimated_value_pence).toBe(990_006);
    expect(gdvThenArea.unit_mix.units[0].estimated_value_pence).toBe(990_005);
    expect(areaThenGdv.unit_mix.units[0].estimated_value_pence)
      .not.toBe(gdvThenArea.unit_mix.units[0].estimated_value_pence);
  });
});

// R13b spec §22.8. The ninth lever: sales_slip. Fixture X's rows are u1
// completion practical_completion+0, u2 +1, u3 unit_completions+1, u4 fixed
// month 20; term 24. Mirror of the Python "sales_slip lever" tests in
// test_financial_model_apply_scenario.py.
describe('sales_slip lever — spec §22.8', () => {
  const SLIP = (months: number): ScenarioOverrides => ({
    ...BASE_OVERRIDES, label: 's', sales_slip_months: months,
  });

  it('adds to completion only, fixed or anchored, additively', () => {
    const out = applyScenario(unitSalesDoc(), SLIP(3));
    const rows = out.unit_sales!.units;
    expect(rows[3].completion.month_offset).toBe(23);          // fixed 20 + 3
    expect(rows[0].completion.anchor!.offset_months).toBe(3);  // practical_completion + 0 -> + 3
    expect(rows[1].completion.anchor!.offset_months).toBe(4);  // + 1 -> + 4, stressed FROM its recorded position
    expect(rows[3].exchange!.month_offset).toBe(11);            // exchange untouched
    expect(rows[0].exchange!.anchor!.offset_months).toBe(0);
  });

  it('is a no-op on the null path', () => {
    const doc = unitSalesDoc({ unitSales: null });
    expect(applyScenario(doc, SLIP(3))).toEqual(applyScenario(doc, SLIP(0)));
  });

  // R16 spec §25.1 widens this from nine to thirteen (phase_slip still needs
  // its own target-phase-id arm, so it stays excluded from this generic,
  // single-field-per-lever table, exactly as it always has been).
  type NonPhaseSlipLever = Exclude<SensitivityLever, 'phase_slip'>;

  const FIELD_OF: Record<NonPhaseSlipLever, keyof ScenarioOverrides> = {
    gdv: 'gdv_adjustment_pct', construction_cost: 'construction_cost_adjustment_pct',
    timeline: 'timeline_adjustment_months', interest_rate: 'interest_rate_adjustment_pct',
    exit_yield: 'exit_yield_adjustment_pct', operating_cost: 'operating_cost_adjustment_pct',
    vacancy: 'vacancy_adjustment_pct', sales_slip: 'sales_slip_months',
    saleable_area: 'saleable_area_adjustment_pct', abnormal_cost: 'abnormal_cost_adjustment_pct',
    programme_slip: 'programme_slip_months', refi_ltv: 'refi_ltv_adjustment_pct',
  };

  function overridesForLever(lever: NonPhaseSlipLever, value: number): ScenarioOverrides {
    return { ...BASE_OVERRIDES, [FIELD_OF[lever]]: value };
  }

  it('keeps all thirteen levers order-independent on a unit-sales document', () => {
    // saleable_area and gdv are kept in the same relative order (area before
    // gdv) in every list below — see the "keeps all THIRTEEN levers
    // order-independent" test above for why the pair is exempt from the
    // general disjoint-fields argument. abnormal_cost and refi_ltv are inert
    // on this document at these NONZERO magnitudes (detailed-mode cost plan
    // with no abnormal-tagged packages; no investment_case) — the subject
    // here is composition order, and inert-at-a-real-magnitude is honest
    // coverage, unlike testing at zero (R11: a test must be able to fail).
    // programme_slip is NOT inert: `acquisition` is this document's sole
    // network source, so slipping it cascades through every downstream
    // anchor.
    const levers: Record<NonPhaseSlipLever, number> = {
      saleable_area: -10, gdv: 5, construction_cost: 5, timeline: 2, interest_rate: 1,
      exit_yield: 0, operating_cost: 0, vacancy: 0, sales_slip: 2,
      abnormal_cost: 10, programme_slip: 6, refi_ltv: 10,
    };
    const orders: Array<NonPhaseSlipLever[]> = [
      Object.keys(levers) as NonPhaseSlipLever[],
      ['vacancy', 'exit_yield', 'saleable_area', 'gdv', 'operating_cost', 'interest_rate', 'timeline', 'construction_cost', 'sales_slip', 'refi_ltv', 'abnormal_cost', 'programme_slip'],
      ['operating_cost', 'timeline', 'vacancy', 'interest_rate', 'saleable_area', 'gdv', 'exit_yield', 'construction_cost', 'sales_slip', 'programme_slip', 'refi_ltv', 'abnormal_cost'],
    ];
    const applyIn = (order: NonPhaseSlipLever[]) => {
      let doc = unitSalesDoc();
      for (const lever of order) {
        doc = applyScenario(doc, overridesForLever(lever, levers[lever]));
      }
      return runAppraisal(doc).metrics;
    };
    const results = orders.map(applyIn);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    const withSlip = applyIn(orders[0]);
    expect(withSlip.unit_sales!.units[3].completion_month).toBe(22); // 20 + 2, inside term 26
  });
});

// R15b Task 8 (spec §24): the sensitivity levers reach the cost plan in time.
// docZ() (fixtures/financial-model/z-cost-plan-in-time.json via migrateInputsToV14,
// see __fixtures__/cost-plan-in-time-docs.ts) carries no investment_case and no
// unit_sales — exit_yield/operating_cost/vacancy/sales_slip are no-ops on it, exactly
// as sales_slip is inert on icDoc() in the "keeps all THIRTEEN levers order-independent"
// test above. Its packages: pkg-enabling on strip_out (midpoint 6.5, months_from_base
// 12.5), pkg-structure/pkg-envelope/pkg-externals on construction (midpoint 10.5,
// months_from_base 16.5), pkg-mande on mande_fitout (SS off construction + 3 lag;
// midpoint 12.333..., months_from_base 18.333...) — the exact figures cost-plan.test.ts
// already pins.
describe('R15b spec §24 — the levers reach the cost plan in time (Task 8)', () => {
  // R16 Task 1: ORDERS below is a fixed nine-lever list — the four stress-pack
  // levers are never present in it, so these two entries are unreachable dead
  // weight, required only because Record<Exclude<..., 'phase_slip'>, ...> must
  // now cover all twelve non-phase_slip levers.
  const NON_PHASE_SLIP_FIELD: Record<Exclude<SensitivityLever, 'phase_slip'>, keyof ScenarioOverrides> = {
    gdv: 'gdv_adjustment_pct', construction_cost: 'construction_cost_adjustment_pct',
    timeline: 'timeline_adjustment_months', interest_rate: 'interest_rate_adjustment_pct',
    exit_yield: 'exit_yield_adjustment_pct', operating_cost: 'operating_cost_adjustment_pct',
    vacancy: 'vacancy_adjustment_pct', sales_slip: 'sales_slip_months',
    saleable_area: 'saleable_area_adjustment_pct', abnormal_cost: 'abnormal_cost_adjustment_pct',
    programme_slip: 'programme_slip_months', refi_ltv: 'refi_ltv_adjustment_pct',
  };
  const LEVER_MAGNITUDE: Record<Exclude<SensitivityLever, 'phase_slip'>, number> = {
    gdv: 5, construction_cost: 5, timeline: 2, interest_rate: 1,
    exit_yield: 3, operating_cost: 4, vacancy: 2, sales_slip: 2,
    saleable_area: 0, abnormal_cost: 0, programme_slip: 0, refi_ltv: 0,
  };

  function applyLever(doc: CalculatorInputsV17, lever: SensitivityLever): CalculatorInputsV17 {
    if (lever === 'phase_slip') {
      return applyScenario(doc, { ...BASE_OVERRIDES, phase_slip_phase_id: 'construction', phase_slip_months: 1 });
    }
    return applyScenario(doc, { ...BASE_OVERRIDES, [NON_PHASE_SLIP_FIELD[lever]]: LEVER_MAGNITUDE[lever] });
  }

  function applyInOrder(order: SensitivityLever[]): CalculatorInputsV17 {
    return order.reduce((d, lever) => applyLever(d, lever), docZ());
  }

  const ORDERS: SensitivityLever[][] = [
    ['gdv', 'construction_cost', 'timeline', 'interest_rate', 'phase_slip', 'exit_yield', 'operating_cost', 'vacancy', 'sales_slip'],
    ['vacancy', 'exit_yield', 'phase_slip', 'gdv', 'operating_cost', 'interest_rate', 'timeline', 'construction_cost', 'sales_slip'],
    ['operating_cost', 'timeline', 'vacancy', 'interest_rate', 'gdv', 'exit_yield', 'construction_cost', 'phase_slip', 'sales_slip'],
  ];

  it('keeps all nine levers order-independent on Z — full document equality, inflation fields included', () => {
    // Review fix (Task 8): the requirement is full-document equality under the
    // nine-lever permutations, the same shape the "composes order-independently
    // with the other four levers" test above already uses (`toEqual` on the
    // APPLIED DOCUMENT) — not a derived-output proxy like runAppraisal(...).metrics,
    // which can pass while something the proxy did not look at silently diverges.
    const applied = ORDERS.map((o) => applyInOrder(o));
    expect(applied[1]).toEqual(applied[0]);
    expect(applied[2]).toEqual(applied[0]);

    // Resolution (a): computeCostPlan on Z under this non-trivial nine-lever
    // combination must ALSO yield identical inflation_pence per package and
    // inflation_total_pence regardless of the order the levers were applied in.
    const plans = applied.map((d) => computeCostPlan(d, developedAreaSqm(d), d.unit_mix.units.length));
    const pence = (cp: ReturnType<typeof computeCostPlan>) =>
      Object.fromEntries(cp.packages.map((p) => [p.id, p.inflation_pence]));
    expect(pence(plans[1])).toEqual(pence(plans[0]));
    expect(pence(plans[2])).toEqual(pence(plans[0]));
    expect(plans[1].inflation_total_pence).toBe(plans[0].inflation_total_pence);
    expect(plans[2].inflation_total_pence).toBe(plans[0].inflation_total_pence);
  });

  it('construction_cost +10 scales every inflation_pence through the amounts; midpoint/months_from_base/factor are bit-identical', () => {
    const base = computeCostPlan(docZ(), 600, 4);   // developedAreaSqm(docZ()) is 600; unit count 4 (cost-plan.test.ts)
    const stressed = applyScenario(docZ(), { ...BASE_OVERRIDES, construction_cost_adjustment_pct: 10 });
    const cp = computeCostPlan(stressed, 600, 4);
    const baseById = Object.fromEntries(base.packages.map((p) => [p.id, p]));
    expect(cp.packages.length).toBe(base.packages.length);
    for (const p of cp.packages) {
      const b = baseById[p.id];
      // The inflation FACTOR depends only on months, which the cost lever never
      // touches — bit-identical, not merely close.
      expect(p.midpoint_month).toBe(b.midpoint_month);
      expect(p.months_from_base).toBe(b.months_from_base);
      expect(p.inflation_factor).toBe(b.inflation_factor);
      const expected = Math.round(1.1 * b.inflation_pence);
      expect(Math.abs(p.inflation_pence - expected)).toBeLessThanOrEqual(1);
    }
  });
});

// R16 spec §25.1: the four stress-pack lever arms. Mirror of the identically
// named tests in test_financial_model_apply_scenario.py.
describe('R16 — the four stress-pack levers (spec §25.1)', () => {
  const R16 = (fields: Partial<ScenarioOverrides>): ScenarioOverrides => ({
    ...BASE_OVERRIDES, label: 'r16', ...fields,
  });

  it('saleable_area scales area and value and leaves ancillary alone', () => {
    const doc = ddDoc(); // fixture Y: u1 80 sqm / 25,000,000p ... (plan table "Base Y")
    const out = applyScenario(doc, R16({ saleable_area_adjustment_pct: -25 }));
    const areas = out.unit_mix.units.map((u) => u.floor_area_sqm);
    const values = out.unit_mix.units.map((u) => u.estimated_value_pence);
    expect(areas).toEqual([60, 71.25, 41.25, 56.25]);
    expect(values).toEqual([18_750_000, 22_500_000, 13_125_000, 15_750_000]);
    doc.unit_mix.units.forEach((before, i) => {
      expect(out.unit_mix.units[i].ancillary).toEqual(before.ancillary);
    });
  });

  it('saleable_area then gdv is the stated composition order', () => {
    // Spec §12.1 / design decision 4. On 1,000,005p the two orders differ by
    // a penny: area-first gives 990,006, gdv-first 990,005. The stated order
    // is area first.
    const base = icDoc();
    const doc = {
      ...base,
      unit_mix: {
        units: base.unit_mix.units.map((u, i) => (i === 0 ? { ...u, estimated_value_pence: 1_000_005 } : u)),
      },
    };
    const out = applyScenario(doc, R16({ saleable_area_adjustment_pct: -10, gdv_adjustment_pct: 10 }));
    expect(out.unit_mix.units[0].estimated_value_pence).toBe(990_006);
  });

  it('abnormal_cost adds points to the abnormal class only', () => {
    const doc = ddDoc();
    const out = applyScenario(doc, R16({ abnormal_cost_adjustment_pct: 10 }));
    const byName = Object.fromEntries(out.cost_plan.contingency.map((c) => [c.name, c.pct]));
    expect(byName).toEqual({ general: 5, existing_building: 0, abnormal: 10 });
  });

  it('programme_slip slips only the network sources', () => {
    const doc = ddDoc(); // sole source: acquisition
    const out = applyScenario(doc, R16({ programme_slip_months: 6 }));
    const slips = Object.fromEntries(out.programme!.phases.map((p) => [p.id, p.slip_months]));
    expect(slips.acquisition).toBe(6);
    expect(Object.entries(slips).every(([id, v]) => id === 'acquisition' || v === 0)).toBe(true);
  });

  it('programme_slip is additive with phase_slip on a source', () => {
    const doc = ddDoc();
    const out = applyScenario(doc, R16({
      programme_slip_months: 6, phase_slip_phase_id: 'acquisition', phase_slip_months: 2,
    }));
    const slips = Object.fromEntries(out.programme!.phases.map((p) => [p.id, p.slip_months]));
    expect(slips.acquisition).toBe(8);
  });

  it('refi_ltv subtracts from the take-out cap', () => {
    const doc = icDoc(); // the investment-case builder (__fixtures__/investment-case-docs)
    const out = applyScenario(doc, R16({ refi_ltv_adjustment_pct: 10 }));
    expect(out.investment_case!.takeout.ltv_cap_pct).toBe(doc.investment_case!.takeout.ltv_cap_pct - 10);
  });

  it('the four new levers are no-ops at zero and on absent blocks', () => {
    const docs: AnyCalculatorInputs[] = [icDoc(), unitSalesDoc(), ddDoc(), docZ()];
    for (const doc of docs) {
      expect(applyScenario(doc, R16({}))).toEqual(doc);
    }
    // A document with no investment case, no network and a headline cost plan
    // with no packages: the arms write nothing.
    const doc = icDoc({ investmentCase: null });
    const out = applyScenario(doc, R16({ refi_ltv_adjustment_pct: 10 }));
    expect(out).toEqual(doc);
  });
});
