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
from .programme import derive_phases, is_programme_network

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


def resolve_stabilisation_month(inputs: Any, stabilisation: Any) -> int:
    """Sec 19.7/19.6. The stabilisation month under Sec 18.6's resolution rule.
    Lives here, not in validation.py and not inlined in the ledger, because a
    rule written twice is a rule that drifts. Mirror of investment-case.ts's
    resolveStabilisationMonth -- added by the TypeScript rule 6/7 fix round and
    ported here for the first time (Task 7): the earlier Python NOI port
    predates its existence in either engine.

    Accepts a dict or Pydantic model for both arguments, exactly like this
    module's other helpers (`_line_field` is a generic field-name accessor
    despite its name) -- validation.py's `inputs` is always a Pydantic model,
    but tests are free to pass a plain dict."""
    month_offset = _line_field(stabilisation, "month_offset")
    anchor = _line_field(stabilisation, "anchor")
    if anchor is None:
        return month_offset
    prog = inputs.get("programme") if isinstance(inputs, dict) else getattr(inputs, "programme", None)
    if prog is None or not is_programme_network(prog):
        return month_offset
    d = derive_phases(prog)
    if d.cycle is not None:
        return month_offset
    phase_id = _line_field(anchor, "phase_id")
    offset_months = _line_field(anchor, "offset_months")
    ph = d.by_id.get(phase_id)
    return ph.start_month + offset_months if ph is not None else month_offset


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


class InvestmentCaseResult(TypedDict):
    stabilisation_month: int
    months: list[InvestmentCaseMonth]
    stabilised: dict[str, int]
    operating_lines: list[dict[str, Any]]
    valuation: dict[str, float | int]
    takeout: dict[str, Any]
    totals: dict[str, int]


def compute_investment_case(
    inputs: Any, term_months: int, _resolve_anchor_month: Any,
) -> InvestmentCaseResult | None:
    """Sec 19.6. Mirror of investment-case.ts's computeInvestmentCase. Runs
    STRICTLY before the ledger. `_resolve_anchor_month` is accepted (not
    recomputed here) to keep this function's public signature the one
    schedule.py calls with its own resolve_anchor_month closure -- but the
    body below never calls it: stabilisation resolves through
    resolve_stabilisation_month, which derives its own phase network from
    `inputs` rather than sharing schedule.py's derivation. Underscore-
    prefixed because it is genuinely unused by this function today -- tranches
    and refinance still go through the real resolve_anchor_month in
    schedule.py itself, never here.
    """
    ic = getattr(inputs, "investment_case", None)
    if ic is None:
        return None

    # Task 7's exported helper, NOT a second inline resolution. Stabilisation
    # goes through the same Sec 18.6 rule via this shared helper -- it derives
    # its own phase network from `inputs`, independently of schedule.py's
    # resolve_anchor_month closure.
    s = min(max(0, math.floor(
        resolve_stabilisation_month(inputs, ic.stabilisation),
    )), term_months - 1)
    gross = gross_potential_monthly_pence(inputs.exit_strategy.retained_units)
    months = noi_series(
        term_months, s, ic.stabilisation.ramp_months,
        ic.stabilisation.stabilised_occupancy_pct, gross, ic.operating_lines,
    )
    annual_noi = stabilised_annual_noi_pence(
        ic.stabilisation.stabilised_occupancy_pct, gross, ic.operating_lines,
    )
    stab_egr = money_round((gross * ic.stabilisation.stabilised_occupancy_pct) / 100)
    stab_opex = operating_cost_at(ic.operating_lines, stab_egr)
    value = investment_value_pence(
        annual_noi, ic.valuation.cap_yield_pct, ic.valuation.purchasers_costs_pct,
    )
    sizing = size_takeout(annual_noi, value, ic.takeout)
    refi = getattr(inputs, "refinance", None)

    def _stabilised_monthly(line: Any) -> int:
        if _line_field(line, "basis") == "fixed_pence_per_month":
            return int(_line_field(line, "value"))
        return money_round((stab_egr * _line_field(line, "value")) / 100)

    return {
        "stabilisation_month": s,
        "months": months,
        "stabilised": {
            "effective_gross_rent_pence": stab_egr,
            "operating_cost_pence": stab_opex,
            "monthly_noi_pence": stab_egr - stab_opex,
            "annual_noi_pence": annual_noi,
        },
        "operating_lines": [
            {**(line if isinstance(line, dict) else line.model_dump()),
             "stabilised_monthly_pence": _stabilised_monthly(line)}
            for line in ic.operating_lines
        ],
        "valuation": {
            "cap_yield_pct": ic.valuation.cap_yield_pct,
            "purchasers_costs_pct": ic.valuation.purchasers_costs_pct,
            # Published for the report's bridge, NOT an intermediate the value
            # is computed from -- Sec 19.3 keeps the value a single expression
            # with a single rounding so a two-step derivation cannot drift a
            # penny from it.
            "gross_value_pence": (
                money_round((annual_noi * 100) / ic.valuation.cap_yield_pct)
                if annual_noi > 0 and ic.valuation.cap_yield_pct > 0 else 0
            ),
            "investment_value_pence": value,
        },
        "takeout": {**sizing, "is_booked": refi is not None},
        "totals": {
            "effective_gross_rent_pence": sum(m["effective_gross_rent_pence"] for m in months),
            "operating_cost_pence": sum(m["operating_cost_pence"] for m in months),
            "noi_pence": sum(m["noi_pence"] for m in months),
        },
    }
