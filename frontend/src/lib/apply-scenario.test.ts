import { describe, it, expect } from 'vitest';
import { applyScenario } from './apply-scenario';
import { defaultCalculatorInputsV2, DEFAULT_SCENARIOS } from './conversion-defaults';
import type { CalculatorInputsV2 } from './model';

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

  it('holds the committed facility and equity fixed under downside overrides', () => {
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
});
