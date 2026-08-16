import { describe, it, expect } from 'vitest';
import { applyScenario } from './apply-scenario';
import { defaultCalculatorInputsV2, defaultCalculatorInputsV3, DEFAULT_SCENARIOS } from '../conversion-defaults';
import type { CalculatorInputsV2, CalculatorInputsV3, LenderValuation } from './';

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
