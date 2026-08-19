import type { ScenarioOverrides } from '../conversion-types';
import type { AnyCalculatorInputs } from './finance-types';

/**
 * The lever-application rule of spec §12.1, shared by the named scenarios and the
 * sensitivity suite. It lives inside `model/` — rather than beside the other `lib/`
 * helpers, where it started — because §12.1 makes it normative, and governance §1
 * requires the authoritative Python engine to mirror model modules file-for-file
 * (`app/financial_model/apply_scenario.py`).
 */
/**
 * Applies a scenario's GDV / cost / timeline / rate adjustments to a v2, v3,
 * v4 or v5 inputs document, returning the same version it was given (Task 8:
 * callers now hold v3 state and still need `lender_valuation`/`inputs_version`
 * carried through unchanged, exactly like every other field this function
 * doesn't touch; Release 3a Task 4 widened this further to v4, whose extra
 * `programme`/`sales_phasing`/`refinance` fields likewise pass through
 * untouched; R8 widened this further to v5, whose extra jurisdiction,
 * acquisition date and tax override fields (spec §14) likewise pass through
 * untouched — a scenario stresses GDV, cost, timeline and rate, not where the
 * property is or when it was bought). The committed facility
 * (`committed_net_facility_pence`, `committed_gross_facility_pence`,
 * `day_one_advance_pence`) and `equity_sources` are held fixed — a scenario
 * stresses the deal's assumptions, not the lender's commitment or the capital
 * already raised.
 */
export function applyScenario<T extends AnyCalculatorInputs>(
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
        // R9 spec §15.5: ancillary is part of GDV, so a GDV stress moves it.
        // Ancillary AREAS are deliberately untouched — a price stress is not an
        // area stress; area reduction is its own R16 lever.
        ...('ancillary' in u && u.ancillary != null ? {
          ancillary: {
            ...u.ancillary,
            parking_value_pence: Math.round(u.ancillary.parking_value_pence * gdvMultiplier),
            balcony_terrace_value_pence: Math.round(u.ancillary.balcony_terrace_value_pence * gdvMultiplier),
          },
        } : {}),
      })),
    },
    conversion_costs: {
      ...inputs.conversion_costs,
      construction_cost_per_sqm_pence: Math.round(
        inputs.conversion_costs.construction_cost_per_sqm_pence * costMultiplier,
      ),
    },
    // R10 spec §3.5. In detailed mode the rate above drives nothing — the cost
    // lives in the packages — so a stress that only scaled the rate would leave
    // every scenario, tornado bar and sensitivity cell inert while still
    // rendering as though it had moved. Compliance allowances and fee lines are
    // deliberately NOT scaled: a percentage fee moves because its base moved,
    // and scaling it too would apply the stress twice.
    ...('cost_plan' in inputs && inputs.cost_plan != null ? {
      cost_plan: {
        ...inputs.cost_plan,
        packages: inputs.cost_plan.packages.map((p) => ({
          ...p,
          amount_pence: Math.round(p.amount_pence * costMultiplier),
        })),
      },
    } : {}),
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
