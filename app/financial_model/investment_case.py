"""R13 spec Sec 19. The investment case: the retained portion's income, its
value and the take-out that income supports.

Port of frontend/src/lib/model/investment-case.ts. This module runs STRICTLY
BEFORE the ledger and reads nothing from it (Sec 17.5's one-direction rule). It
must never import `engine` for anything but `money_round`, and never `schedule`
or `metrics` -- a debt figure entering an NOI base is the one thing that would
make this cyclic.
"""
from __future__ import annotations

import math
from typing import Any, Literal, TypedDict

from .engine import money_round

OpexCode = Literal[
    "management", "letting_and_re_letting", "insurance",
    "repairs_and_maintenance", "service_charge_shortfall", "ground_rent",
    "utilities_on_voids", "compliance_and_safety", "bad_debt", "other",
]

OPEX_CODES: tuple[OpexCode, ...] = (
    "management", "letting_and_re_letting", "insurance",
    "repairs_and_maintenance", "service_charge_shortfall", "ground_rent",
    "utilities_on_voids", "compliance_and_safety", "bad_debt", "other",
)


class InvestmentCaseMonth(TypedDict):
    month: int
    occupancy_pct: float
    gross_potential_rent_pence: int
    effective_gross_rent_pence: int
    operating_cost_pence: int
    noi_pence: int


class TakeoutSizing(TypedDict):
    ltv_cap_pence: int
    dscr_cap_pence: int | None
    icr_cap_pence: int | None
    quantum_pence: int
    binding_constraint: str | None
    annual_debt_service_factor: float
    achieved_ltv_pct: float | None
    achieved_dscr: float | None
    achieved_icr: float | None


def occupancy_pct_at(
    month: int, stabilisation_month: int, ramp_months: int, stabilised_pct: float,
) -> float:
    """Sec 19.2. Zero before `s`; a linear ramp reaching `stabilised_pct` in the
    FINAL ramp month `s + R - 1`; stabilised thereafter. `R = 0` collapses the
    middle arm."""
    if month < stabilisation_month:
        return 0.0
    if ramp_months > 0 and month < stabilisation_month + ramp_months:
        return (stabilised_pct * (month - stabilisation_month + 1)) / ramp_months
    return stabilised_pct


def gross_potential_monthly_pence(retained_units: list[Any]) -> int:
    """Sec 19.2. Sums `exit_strategy.retained_units[]`, NOT `unit_mix.units`.
    For `blended` that list IS the retained set; for `retain_all` Sec 19.7 rule 2
    makes it complete. Accepts dicts or Pydantic models."""
    total = 0
    for r in retained_units:
        total += r["monthly_rent_pence"] if isinstance(r, dict) else r.monthly_rent_pence
    return total


def _line_field(line: Any, name: str) -> Any:
    return line[name] if isinstance(line, dict) else getattr(line, name)


def operating_cost_at(lines: list[Any], egr_pence: int) -> int:
    """Sec 19.2. A percentage line is a percent of the month's EFFECTIVE gross
    rent -- a management fee is charged on rent collected."""
    total = 0
    for line in lines:
        if _line_field(line, "basis") == "fixed_pence_per_month":
            total += int(_line_field(line, "value"))
        else:
            total += money_round((egr_pence * _line_field(line, "value")) / 100)
    return total


def noi_series(
    term_months: int, stabilisation_month: int, ramp_months: int,
    stabilised_occupancy_pct: float, gross_potential: int, lines: list[Any],
) -> list[InvestmentCaseMonth]:
    out: list[InvestmentCaseMonth] = []
    for m in range(term_months):
        occ = occupancy_pct_at(m, stabilisation_month, ramp_months, stabilised_occupancy_pct)
        egr = money_round((gross_potential * occ) / 100)
        # Operating costs start with the income, not with the term.
        opex = 0 if m < stabilisation_month else operating_cost_at(lines, egr)
        out.append({
            "month": m,
            "occupancy_pct": occ,
            "gross_potential_rent_pence": gross_potential,
            "effective_gross_rent_pence": egr,
            "operating_cost_pence": opex,
            "noi_pence": egr - opex,
        })
    return out


def stabilised_annual_noi_pence(
    stabilised_occupancy_pct: float, gross_potential: int, lines: list[Any],
) -> int:
    """Sec 19.2. TWELVE TIMES THE STABILISED MONTH. Never the sum of the first
    twelve actual months, never an average over the term."""
    egr = money_round((gross_potential * stabilised_occupancy_pct) / 100)
    return 12 * (egr - operating_cost_at(lines, egr))


def _takeout_field(takeout: Any, name: str) -> Any:
    return takeout[name] if isinstance(takeout, dict) else getattr(takeout, name)


def annual_debt_service_factor(takeout: Any) -> float:
    """Sec 19.4. The constant that makes the DSCR cap solve in closed form."""
    r = _takeout_field(takeout, "annual_rate_pct") / 100
    amort = _takeout_field(takeout, "amortisation_years")
    if amort is None:
        return r
    i = r / 12
    n = amort * 12
    if n <= 0:
        return r
    return 12 * ((1 / n) if i == 0 else (i / (1 - (1 + i) ** -n)))


def investment_value_pence(
    annual_noi_pence: int, cap_yield_pct: float, purchasers_costs_pct: float,
) -> int:
    """Sec 19.3. ONE expression, ONE rounding."""
    if annual_noi_pence <= 0 or cap_yield_pct <= 0:
        return 0
    return money_round(
        (annual_noi_pence * 100) / cap_yield_pct / (1 + purchasers_costs_pct / 100),
    )


def size_takeout(annual_noi_pence: int, value_pence: int, takeout: Any) -> TakeoutSizing:
    """Sec 19.4. quantum = min(applicable caps); the binding constraint is the
    argmin with precedence LTV -> DSCR -> ICR on an exact tie. Every cap FLOORS."""
    r = _takeout_field(takeout, "annual_rate_pct") / 100
    a = annual_debt_service_factor(takeout)
    noi = max(0, annual_noi_pence)

    ltv_cap = math.floor((value_pence * _takeout_field(takeout, "ltv_cap_pct")) / 100)
    dscr_cap = (math.floor(noi / (_takeout_field(takeout, "dscr_floor") * a))
                if a > 0 else None)
    icr_cap = (math.floor(noi / (_takeout_field(takeout, "icr_floor") * r))
               if r > 0 else None)

    candidates: list[tuple[str, int]] = [("ltv", ltv_cap)]
    if dscr_cap is not None:
        candidates.append(("dscr", dscr_cap))
    if icr_cap is not None:
        candidates.append(("icr", icr_cap))
    # `<` (not `<=`) keeps the earlier entry, so precedence IS the tie-break.
    binding = candidates[0]
    for c in candidates:
        if c[1] < binding[1]:
            binding = c

    quantum = max(0, binding[1])
    sized = quantum > 0
    return {
        "ltv_cap_pence": ltv_cap,
        "dscr_cap_pence": dscr_cap,
        "icr_cap_pence": icr_cap,
        "quantum_pence": quantum,
        "binding_constraint": binding[0] if sized else None,
        "annual_debt_service_factor": a,
        "achieved_ltv_pct": (quantum / value_pence) * 100 if sized and value_pence > 0 else None,
        "achieved_dscr": noi / (quantum * a) if sized and a > 0 else None,
        "achieved_icr": noi / (quantum * r) if sized and r > 0 else None,
    }
