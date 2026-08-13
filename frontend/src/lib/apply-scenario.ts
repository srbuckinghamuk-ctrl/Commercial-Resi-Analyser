import type { ScenarioOverrides } from './conversion-types';
import type { CalculatorInputsV2 } from './model/finance-types';

/**
 * Applies a scenario's GDV / cost / timeline / rate adjustments to a v2 inputs
 * document. The committed facility (`committed_net_facility_pence`,
 * `committed_gross_facility_pence`, `day_one_advance_pence`) and
 * `equity_sources` are held fixed — a scenario stresses the deal's
 * assumptions, not the lender's commitment or the capital already raised.
 */
export function applyScenario(inputs: CalculatorInputsV2, overrides: ScenarioOverrides): CalculatorInputsV2 {
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
      term_months: inputs.finance.term_months + overrides.timeline_adjustment_months,
      annual_interest_rate_pct:
        inputs.finance.annual_interest_rate_pct + overrides.interest_rate_adjustment_pct,
    },
  };
}
