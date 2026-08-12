import type { CalculatorInputs, ScenarioOverrides } from './conversion-types';

/**
 * Apply scenario overrides to a set of calculator inputs.
 * The loan term is floored at 1 month so a downside/upside timeline
 * adjustment can never produce a zero or negative term (which would
 * yield negative interest).
 */
export function applyScenario(inputs: CalculatorInputs, overrides: ScenarioOverrides): CalculatorInputs {
  const gdvMultiplier = 1 + overrides.gdv_adjustment_pct / 100;
  const costMultiplier = 1 + overrides.construction_cost_adjustment_pct / 100;
  return {
    ...inputs,
    unit_mix: {
      units: inputs.unit_mix.units.map((u) => ({
        ...u,
        estimated_value_pence: Math.round(u.estimated_value_pence * gdvMultiplier),
      })),
    },
    conversion_costs: {
      ...inputs.conversion_costs,
      construction_cost_per_sqm_pence: Math.round(
        inputs.conversion_costs.construction_cost_per_sqm_pence * costMultiplier,
      ),
    },
    finance: {
      ...inputs.finance,
      loan_term_months: Math.max(1, inputs.finance.loan_term_months + overrides.timeline_adjustment_months),
      interest_rate_annual_pct: Math.max(
        0,
        inputs.finance.interest_rate_annual_pct + overrides.interest_rate_adjustment_pct,
      ),
    },
  };
}
