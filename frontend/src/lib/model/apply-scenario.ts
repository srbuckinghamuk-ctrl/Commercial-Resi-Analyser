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
    //
    // Gated on presence (`'cost_plan' in inputs`), not on `mode === 'detailed'`:
    // `lender_eligible_base_pence` (cost-plan.ts) reads `packages` regardless of
    // mode, so a headline document that happens to carry stray packages should
    // still have them scale consistently with everything else the lever moves.
    //
    // R14 (calc 2.13.0): the lever now reaches the ledger's §4.2(b) cap base,
    // because `computeCostPlan` derives `lender_eligible_ratio` from these same
    // amounts. Scaling EVERY package by the same multiplier is what keeps that
    // correct: the eligible share is preserved (to within the per-line
    // `Math.round`, which can move the quotient by a fraction of a penny's
    // worth of ratio and never by a package's worth), so a cost stress changes
    // the SIZE of the build and not which packages a lender will advance
    // against. Scaling only the eligible lines would move the ratio and quietly
    // stress the facility's advance RATE as well — two levers under one name.
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
    // R12 spec §18.9. ADDITIVE, not assignment: a base-case slip already recorded
    // on the document is stressed FROM its recorded position rather than
    // overwritten by it. A `phase_slip_phase_id` of `null` matches no phase,
    // which is what makes the v9 migration default (§18.7) a no-op by
    // construction. Gated on `'phases' in inputs.programme`, not on
    // `inputs_version >= 9`, so a v4-v8 document carrying the legacy
    // `{ packages }` shape is left untouched rather than crashing on a field
    // that shape does not have — the lever writes nothing when there is
    // nothing of the right shape to write to.
    ...(('programme' in inputs) && inputs.programme != null && 'phases' in inputs.programme ? {
      programme: {
        ...inputs.programme,
        phases: inputs.programme.phases.map((p) => (
          p.id === overrides.phase_slip_phase_id
            ? { ...p, slip_months: p.slip_months + overrides.phase_slip_months }
            : p
        )),
      },
    } : {}),
    // R13 spec §19.8. Three levers stressing the investment case: `exit_yield`
    // ADDS percentage points to the capitalisation yield; `operating_cost`
    // SCALES every operating line's `value` on both bases (a percentage line's
    // percentage and a fixed line's pence alike); `vacancy` SUBTRACTS
    // percentage points from stabilised occupancy, so a POSITIVE lever value
    // is an ADVERSE move on every one of the three, matching the sign
    // convention every other lever already uses in the tornado. Gated on
    // presence (`'investment_case' in inputs && inputs.investment_case !=
    // null`), not on `inputs_version >= 10`, exactly as the `phase_slip` arm
    // above is gated on `'phases' in inputs.programme` — a v2-v9 document is
    // left untouched rather than crashing on a field its shape does not have,
    // and a v10 document whose `investment_case` is null is a no-op by
    // construction (§12.7's cell-validity mechanism is what then reports the
    // degenerate cells this lever can drive to — cap_yield_pct <= 0,
    // stabilised_occupancy_pct <= 0, or an operating line's value < 0 — as
    // invalid rather than silently clamping them).
    ...('investment_case' in inputs && inputs.investment_case != null ? {
      investment_case: {
        ...inputs.investment_case,
        stabilisation: {
          ...inputs.investment_case.stabilisation,
          stabilised_occupancy_pct:
            inputs.investment_case.stabilisation.stabilised_occupancy_pct
            - overrides.vacancy_adjustment_pct,
        },
        // `fixed_pence_per_month` is money, so it is Math.round'ed exactly like
        // every other pence figure this function scales (unit values, cost/sqm,
        // package amounts); `pct_of_gross_rent` is a percentage, not pence, and
        // stays exact — rounding it would quietly lose a fractional management
        // fee rate every time this lever fires.
        operating_lines: inputs.investment_case.operating_lines.map((l) => {
          const scaled = l.value * (1 + overrides.operating_cost_adjustment_pct / 100);
          return { ...l, value: l.basis === 'fixed_pence_per_month' ? Math.round(scaled) : scaled };
        }),
        valuation: {
          ...inputs.investment_case.valuation,
          cap_yield_pct: inputs.investment_case.valuation.cap_yield_pct
            + overrides.exit_yield_adjustment_pct,
        },
      },
    } : {}),
    // The spread above already carries `inputs_version`/`lender_valuation` (v3) or their
    // absence (v2) through unchanged; TS can't verify a generic spread-and-override
    // reproduces exactly T, so this cast documents what the runtime shape guarantees.
  } as T;
}
