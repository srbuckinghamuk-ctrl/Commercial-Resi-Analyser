"""Port of frontend/src/lib/model/apply-scenario.ts.

The lever-application rule of spec Sec 12.1, shared by the named scenarios and the
sensitivity suite (sensitivity.py). Applies a scenario's GDV / cost / timeline / rate
adjustments to a v2 through v7 inputs document and returns a new document of the same
version -- every field the levers do not name is carried through untouched, including
the committed facility and equity sources, which spec Sec 12.2 holds invariant.

The TS twin builds its result from spreads; here a deep model_copy plays that role.
It keeps the caller's document unmutated and preserves the concrete version class
without a version switch, mirroring the TS function's generic return.
"""
from __future__ import annotations

from .engine import money_round
from .types import AnyCalculatorInputs, ScenarioOverrides


def apply_scenario(inputs: AnyCalculatorInputs, overrides: ScenarioOverrides) -> AnyCalculatorInputs:
    gdv_multiplier = 1 + overrides.gdv_adjustment_pct / 100
    cost_multiplier = 1 + overrides.construction_cost_adjustment_pct / 100

    out = inputs.model_copy(deep=True)

    for unit in out.unit_mix.units:
        unit.estimated_value_pence = money_round(unit.estimated_value_pence * gdv_multiplier)
        # R9 spec Sec 15.5: ancillary is part of GDV, so a GDV stress moves it.
        # Ancillary AREAS are deliberately untouched -- a price stress is not an
        # area stress; area reduction is its own R16 lever. A pre-v6 unit
        # carries no ancillary attribute at all (matching unit_ancillary_value_pence
        # in schedule.py), hence the getattr guard rather than a plain attribute check.
        ancillary = getattr(unit, "ancillary", None)
        if ancillary is not None:
            ancillary.parking_value_pence = money_round(ancillary.parking_value_pence * gdv_multiplier)
            ancillary.balcony_terrace_value_pence = money_round(
                ancillary.balcony_terrace_value_pence * gdv_multiplier
            )

    out.conversion_costs.construction_cost_per_sqm_pence = money_round(
        out.conversion_costs.construction_cost_per_sqm_pence * cost_multiplier
    )

    # R10 spec Sec 3.5. In detailed mode the rate above drives nothing -- the
    # cost lives in the packages -- so a stress that only scaled the rate would
    # leave every scenario, tornado bar and sensitivity cell inert while still
    # rendering as though it had moved. Compliance allowances and fee lines are
    # deliberately NOT scaled: a percentage fee moves because its base moved,
    # and scaling it too would apply the stress twice.
    #
    # Gated on presence (getattr(out, "cost_plan", None)), not on
    # cost_plan.mode == "detailed": compute_cost_plan's lender_eligible_base_pence
    # reads packages regardless of mode, so a headline document that happens to
    # carry stray packages should still have them scale consistently with
    # everything else the lever moves.
    #
    # R14 (calc 2.13.0): the lever now reaches the ledger's Sec 4.2(b) cap base,
    # because compute_cost_plan derives `lender_eligible_ratio` from these same
    # amounts. Scaling EVERY package by the same multiplier is what keeps that
    # correct: the eligible share is preserved (to within the per-line
    # money_round, which can move the quotient by a fraction of a penny's worth
    # of ratio and never by a package's worth), so a cost stress changes the
    # SIZE of the build and not which packages a lender will advance against.
    # Scaling only the eligible lines would move the ratio and quietly stress
    # the facility's advance RATE as well -- two levers under one name.
    cost_plan = getattr(out, "cost_plan", None)
    if cost_plan is not None:
        for package in cost_plan.packages:
            package.amount_pence = money_round(package.amount_pence * cost_multiplier)

    # ScenarioOverrides types this float, but a term is a whole month count and spec Sec 12.6
    # rejects a fractional timeline step at input, so this cast only ever narrows a value that
    # is already integral. The TS twin adds directly — this cast is the one deliberate divergence,
    # and Sec 12.6 is what makes it safe.
    out.finance.term_months = inputs.finance.term_months + int(overrides.timeline_adjustment_months)
    out.finance.annual_interest_rate_pct = (
        inputs.finance.annual_interest_rate_pct + overrides.interest_rate_adjustment_pct
    )

    # R12 spec Sec 18.9. ADDITIVE, not assignment: a base-case slip already recorded
    # on the document is stressed FROM its recorded position rather than overwritten
    # by it. `phase_slip_phase_id` of None matches no phase, which is what makes the
    # v9 migration default (Sec 18.7) a no-op by construction. Gated on `hasattr(...,
    # "phases")`, mirroring the TS twin's `'phases' in inputs.programme` -- a v4-v8
    # document's legacy ProgrammeInputs (`{ packages }`) has no `phases` attribute,
    # so the lever writes nothing when there is nothing of the right shape to write to.
    programme = getattr(out, "programme", None)
    if programme is not None and hasattr(programme, "phases"):
        for phase in programme.phases:
            if phase.id == overrides.phase_slip_phase_id:
                phase.slip_months += overrides.phase_slip_months

    # R13 spec Sec 19.8. Three levers stressing the investment case: exit_yield
    # ADDS percentage points to the capitalisation yield; operating_cost SCALES
    # every operating line's `value` on both bases; vacancy SUBTRACTS
    # percentage points from stabilised occupancy, so a POSITIVE lever value is
    # an ADVERSE move on every one of the three, matching the sign convention
    # every other lever already uses in the tornado. Gated on presence
    # (getattr(out, "investment_case", None) is not None), mirroring the
    # programme arm above -- a v2-v9 document is left untouched, and a v10
    # document whose investment_case is None is a no-op by construction.
    investment_case = getattr(out, "investment_case", None)
    if investment_case is not None:
        investment_case.stabilisation.stabilised_occupancy_pct -= overrides.vacancy_adjustment_pct
        cost_scale = 1 + overrides.operating_cost_adjustment_pct / 100
        for line in investment_case.operating_lines:
            scaled = line.value * cost_scale
            # fixed_pence_per_month is money, rounded exactly like every other
            # pence figure above; pct_of_gross_rent is a percentage, not pence,
            # and stays exact.
            line.value = money_round(scaled) if line.basis == "fixed_pence_per_month" else scaled
        investment_case.valuation.cap_yield_pct += overrides.exit_yield_adjustment_pct

    return out
