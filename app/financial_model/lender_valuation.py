"""Port of frontend/src/lib/model/lender-valuation.ts."""
from __future__ import annotations

from dataclasses import dataclass

from .engine import money_round
from .types import CalculatorInputsV3

# Sq ft per sq m (spec Sec 3.2 global_per_sqft basis). No shared constant
# existed for this anywhere the financial model could import from without
# creating a new cross-package dependency -- defined once here per language,
# per Task 3 brief Sec "Semantics".
SQFT_PER_SQM = 10.7639


@dataclass
class LenderGdvResult:
    lender_gdv_pence: int
    # Per-unit lender values, same order as inputs.unit_mix.units. Empty for
    # fixed_amount (a single total, not a per-unit breakdown).
    unit_values_pence: list[int]


def compute_lender_gdv(inputs: CalculatorInputsV3) -> LenderGdvResult | None:
    """Lender-underwritten GDV (spec Sec 3.2). Returns None only when
    inputs.lender_valuation is absent -- that is the sole meaning of
    "unknown" here, never a stand-in for "the block is present but bad"
    (spec Sec 2: unknown lender-critical inputs must never be defaulted
    silently).

    Raises when a present block cannot be computed at all -- a required
    global_value is null, or a per_unit id is missing, or a resulting unit
    value is not positive. There is no numeric fallback for these that would
    not silently misstate the lender's position, so this fails closed rather
    than guessing. validation.py mirrors the same conditions as
    ValidationIssues (by catching this function's own raised message, so the
    wording never drifts) without interrupting the rest of the pipeline.
    """
    lv = inputs.lender_valuation
    if lv is None:
        return None

    if lv.basis == "fixed_amount":
        if lv.global_value is None:
            raise ValueError('Lender valuation basis "fixed_amount" requires a global_value.')
        if lv.global_value <= 0:
            raise ValueError("Lender GDV must be a positive value.")
        return LenderGdvResult(lender_gdv_pence=int(lv.global_value), unit_values_pence=[])

    if lv.basis in ("global_pct", "global_per_sqft") and lv.global_value is None:
        raise ValueError(f'Lender valuation basis "{lv.basis}" requires a global_value.')

    unit_values: list[int] = []
    for u in inputs.unit_mix.units:
        if lv.basis == "global_pct":
            value = money_round(u.estimated_value_pence * (1 + lv.global_value / 100))
        elif lv.basis == "global_per_sqft":
            value = money_round(lv.global_value * u.floor_area_sqm * SQFT_PER_SQM)
        elif lv.basis == "unit_type":
            adjustment = (lv.per_key_values or {}).get(u.type)
            value = (
                u.estimated_value_pence if adjustment is None
                else money_round(u.estimated_value_pence * (1 + adjustment / 100))
            )
        elif lv.basis == "per_unit":
            provided = (lv.per_key_values or {}).get(u.id)
            if provided is None:
                raise ValueError(
                    f'Lender valuation (per_unit basis) is missing a value for unit "{u.id}".'
                )
            value = int(provided)
        else:
            raise ValueError(f'Unknown lender valuation basis "{lv.basis}".')

        if value <= 0:
            raise ValueError(f'Lender-adjusted value for unit "{u.id}" must be positive.')
        unit_values.append(value)

    total = sum(unit_values)
    return LenderGdvResult(lender_gdv_pence=total, unit_values_pence=unit_values)
