import type { ScenarioOverrides } from './conversion-types';
import type { CalculatorInputsV2, CalculatorInputsV3 } from './model/finance-types';

/**
 * Applies a scenario's GDV / cost / timeline / rate adjustments to a v2 or v3
 * inputs document, returning the same version it was given (Task 8: callers
 * now hold v3 state and still need `lender_valuation`/`inputs_version`
 * carried through unchanged, exactly like every other field this function
 * doesn't touch). The committed facility (`committed_net_facility_pence`,
 * `committed_gross_facility_pence`, `day_one_advance_pence`) and
 * `equity_sources` are held fixed — a scenario stresses the deal's
 * assumptions, not the lender's commitment or the capital already raised.
 */
export function applyScenario<T extends CalculatorInputsV2 | CalculatorInputsV3>(
  inputs: T,
  overrides: ScenarioOverrides,
): T {
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
    // The spread above already carries `inputs_version`/`lender_valuation` (v3) or their
    // absence (v2) through unchanged; TS can't verify a generic spread-and-override
    // reproduces exactly T, so this cast documents what the runtime shape guarantees.
  } as T;
}
