"""Port of frontend/src/lib/model/apply-scenario.ts.

The lever-application rule of spec Sec 12.1, shared by the named scenarios and the
sensitivity suite (sensitivity.py). Applies a scenario's GDV / cost / timeline / rate
adjustments to a v2, v3 or v4 inputs document and returns a new document of the same
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

    out.conversion_costs.construction_cost_per_sqm_pence = money_round(
        out.conversion_costs.construction_cost_per_sqm_pence * cost_multiplier
    )

    # ScenarioOverrides types this float, but a term is a whole month count and spec Sec 12.6
    # rejects a fractional timeline step at input, so this cast only ever narrows a value that
    # is already integral. The TS twin adds directly — this cast is the one deliberate divergence,
    # and Sec 12.6 is what makes it safe.
    out.finance.term_months = inputs.finance.term_months + int(overrides.timeline_adjustment_months)
    out.finance.annual_interest_rate_pct = (
        inputs.finance.annual_interest_rate_pct + overrides.interest_rate_adjustment_pct
    )

    return out
