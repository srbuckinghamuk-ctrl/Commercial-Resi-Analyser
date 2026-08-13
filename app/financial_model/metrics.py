"""Port of frontend/src/lib/model/metrics.ts, plus frontend/src/lib/model/irr.ts
(port rule #6) inlined here since metrics.ts is irr.ts's sole consumer and the
brief's file list does not include a separate irr.py."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .engine import MonthlyModel, money_round
from .lender_valuation import compute_lender_gdv
from .schedule import Schedule
from .sdlt import calculate_commercial_sdlt
from .types import CALC_VERSION, CalculatorInputsV2, CalculatorInputsV3

# --- irr.ts --------------------------------------------------------------

_LOWER = -0.99
_UPPER = 10  # 1000% per period -- beyond any sane monthly equity return


def npv_at(cashflows: list[float], rate: float) -> float:
    npv = 0.0
    for t, c in enumerate(cashflows):
        npv += c / math.pow(1 + rate, t)
    return npv


def solve_irr(cashflows: list[float]) -> float | None:
    """Periodic IRR of a cash-flow vector (index = period). Returns a decimal
    rate (0.01 = 1% per period) or None when no root exists in (-99%, 1000%].
    Newton-Raphson first; bisection fallback. Spec Sec 3.17."""
    if len(cashflows) < 2:
        return None
    has_negative = any(c < 0 for c in cashflows)
    has_positive = any(c > 0 for c in cashflows)
    if not has_negative or not has_positive:
        return None

    # Newton-Raphson
    guess = 0.01
    for _ in range(1000):
        npv = 0.0
        dnpv = 0.0
        for t, c in enumerate(cashflows):
            factor = math.pow(1 + guess, t)
            npv += c / factor
            if t > 0:
                dnpv -= (t * c) / math.pow(1 + guess, t + 1)
        if abs(dnpv) < 1e-15:
            break
        next_guess = guess - npv / dnpv
        if not math.isfinite(next_guess) or next_guess <= _LOWER or next_guess > _UPPER:
            break
        if abs(next_guess - guess) < 1e-9:
            if abs(npv_at(cashflows, next_guess)) < 1e-3:
                return next_guess
            else:
                break  # Fall through to bisection fallback when Newton converges to bad point
        guess = next_guess

    # Bisection fallback over (LOWER, UPPER].
    # Bisection's guarantee is BRACKET PRECISION on the rate (1e-12 final interval
    # width), not NPV residual: on steep NPV curves, the residual can be large
    # (1e-3+) while the rate is accurate within +/-1e-6. This is acceptable for
    # display (2 decimal places = 1%) and explains the asymmetry with Newton's
    # 1e-3 acceptance threshold.
    lo = _LOWER + 1e-9
    hi = _UPPER
    f_lo = npv_at(cashflows, lo)
    f_hi = npv_at(cashflows, hi)
    if f_lo * f_hi > 0:
        return None  # no sign change -- no root in bracket
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv_at(cashflows, mid)
        if abs(f_mid) < 1e-9 or hi - lo < 1e-12:
            return mid
        if f_lo * f_mid <= 0:
            hi = mid
        else:
            lo = mid
            f_lo = f_mid
    return (lo + hi) / 2


# --- metrics.ts ------------------------------------------------------------


@dataclass
class CostToCompleteMonth:
    month: int
    remaining_cost_pence: int
    remaining_funding_pence: int
    surplus_pence: int


@dataclass
class CostToCompleteSummary:
    first_shortfall_month: int | None
    max_shortfall_pence: int
    months: list[CostToCompleteMonth]


@dataclass
class AppraisalResultV2:
    calc_version: str
    gdv_pence: int
    lender_gdv_pence: int | None
    lender_gdv_variance_pence: int | None
    lender_gdv_variance_pct: float | None
    acquisition_cost_pence: int
    sdlt_pence: int
    construction_cost_pence: int
    professional_fees_pence: int
    statutory_costs_pence: int
    selling_costs_pence: int
    cost_before_finance_pence: int
    finance_costs_pence: int
    total_development_cost_pence: int
    profit_pence: int
    profit_is_unrealised: bool
    unrealised_value_pence: int
    profit_on_cost_pct: float | None
    profit_on_gdv_pct: float | None
    equity_contributed_pence: int
    equity_multiple: float | None
    irr_monthly_pct: float | None
    irr_annual_pct: float | None
    rlv_pence: int
    day_one_advance_pence: int
    day_one_ltv_on_price_pct: float | None
    day_one_ltv_on_value_pct: float | None
    development_advances_pence: int
    net_ltc_pct: float | None
    gross_ltc_pct: float | None
    ltgdv_developer_pct: float | None
    ltgdv_lender_pct: float | None
    peak_debt_pence: int
    peak_debt_month: int | None
    facility_headroom_pence: int | None
    interest_reserve_remaining_pence: int | None
    return_on_equity_pct: float | None
    # Wired in Task 4 (spec Sec 5.11).
    senior_breakeven_pence: int | None
    senior_breakeven_pct_of_lender_gdv: float | None
    senior_breakeven_fall_from_lender_gdv_pct: float | None
    # Wired in Task 5 (spec Sec 5.12).
    developer_breakeven_pence: int | None
    # Wired in Task 6 (spec Sec 5.10).
    cost_to_complete: CostToCompleteSummary | None


def pct(numerator: float, denominator: float) -> float | None:
    """Percentage to 2 dp; None when the denominator is zero (spec Sec 1.5)."""
    if denominator == 0:
        return None
    return money_round((numerator / denominator) * 10000) / 100


def derive_metrics(
    inputs: CalculatorInputsV2 | CalculatorInputsV3, schedule: Schedule, model: MonthlyModel,
) -> AppraisalResultV2:
    t = schedule.totals
    # Lender-underwritten GDV (spec Sec 3.2, Release 2b Task 3). None for v2
    # inputs (no lender_valuation field at all), v3 inputs with the block
    # absent, or a present-but-invalid block. compute_lender_gdv raises for the
    # last case (missing global_value, missing per_unit id, a non-positive
    # value) -- caught here so an invalid block degrades to "lender metrics
    # unavailable" instead of crashing the whole appraisal (metrics runs before
    # validation in run_appraisal, so nothing has reported the problem yet at
    # this point). validate_inputs independently re-derives the exact same
    # condition as a hard ValidationIssue, so the failure is never silent --
    # just never fatal, and never a substitute number standing in for "unknown"
    # (spec Sec 2).
    lender_gdv = None
    if isinstance(inputs, CalculatorInputsV3):
        try:
            lender_gdv = compute_lender_gdv(inputs)
        except ValueError:
            lender_gdv = None
    lender_gdv_variance = None if lender_gdv is None else lender_gdv.lender_gdv_pence - t.gdv_pence
    sdlt = calculate_commercial_sdlt(inputs.acquisition.purchase_price_pence).total_pence
    cost_before_finance = t.cost_before_finance_ex_selling_pence + t.selling_costs_pence
    finance_costs = model.totals.finance_costs_pence
    tdc = cost_before_finance + finance_costs
    gross_receipts = t.gross_sales_pence
    profit = gross_receipts + t.retained_value_pence - tdc
    profit_is_unrealised = t.retained_value_pence > 0

    equity_contributed = model.totals.equity_contributed_pence + model.totals.additional_equity_pence
    equity_multiple = (
        money_round((model.totals.distributions_pence / equity_contributed) * 100) / 100
        if equity_contributed > 0 else None
    )

    irr = solve_irr(model.equity_cashflows_pence)
    irr_monthly = None if irr is None else money_round(irr * 10000) / 100
    irr_annual = None if irr is None else money_round((math.pow(1 + irr, 12) - 1) * 10000) / 100

    target = inputs.deal_spider.target_profit_on_cost_pct
    cost_ex_land = tdc - inputs.acquisition.purchase_price_pence - sdlt
    rlv = money_round(t.gdv_pence / (1 + target / 100) - cost_ex_land)

    net_advances = model.totals.draws_pence + model.totals.capitalised_fees_pence
    price = inputs.acquisition.purchase_price_pence
    day_one_value = inputs.finance.day_one_market_value_pence

    return AppraisalResultV2(
        calc_version=CALC_VERSION,
        gdv_pence=t.gdv_pence,
        lender_gdv_pence=None if lender_gdv is None else lender_gdv.lender_gdv_pence,
        lender_gdv_variance_pence=lender_gdv_variance,
        lender_gdv_variance_pct=(
            None if lender_gdv_variance is None else pct(lender_gdv_variance, t.gdv_pence)
        ),
        acquisition_cost_pence=t.acquisition_pence,
        sdlt_pence=sdlt,
        construction_cost_pence=t.construction_pence,
        professional_fees_pence=t.professional_pence,
        statutory_costs_pence=t.statutory_pence,
        selling_costs_pence=t.selling_costs_pence,
        cost_before_finance_pence=cost_before_finance,
        finance_costs_pence=finance_costs,
        total_development_cost_pence=tdc,
        profit_pence=profit,
        profit_is_unrealised=profit_is_unrealised,
        unrealised_value_pence=t.retained_value_pence,
        profit_on_cost_pct=pct(profit, tdc),
        profit_on_gdv_pct=pct(profit, t.gdv_pence),
        equity_contributed_pence=equity_contributed,
        equity_multiple=equity_multiple,
        irr_monthly_pct=irr_monthly,
        irr_annual_pct=irr_annual,
        rlv_pence=rlv,
        day_one_advance_pence=model.day_one_advance_pence,
        day_one_ltv_on_price_pct=None if price == 0 else pct(model.day_one_advance_pence, price),
        day_one_ltv_on_value_pct=(
            None if day_one_value is None else pct(model.day_one_advance_pence, day_one_value)
        ),
        development_advances_pence=model.totals.draws_pence - model.day_one_advance_pence,
        net_ltc_pct=(
            None if t.cost_before_finance_ex_selling_pence == 0
            else pct(net_advances, t.cost_before_finance_ex_selling_pence)
        ),
        gross_ltc_pct=None if tdc == 0 else pct(model.peak_debt_pence, tdc),
        ltgdv_developer_pct=pct(model.peak_debt_pence, t.gdv_pence),
        ltgdv_lender_pct=(
            None if lender_gdv is None else pct(model.peak_debt_pence, lender_gdv.lender_gdv_pence)
        ),
        peak_debt_pence=model.peak_debt_pence,
        peak_debt_month=model.peak_debt_month,
        facility_headroom_pence=(
            model.committed_gross_facility_pence - model.peak_debt_pence
            if model.committed_gross_facility_pence > 0 else None
        ),
        interest_reserve_remaining_pence=(
            model.months[-1].interest_reserve_remaining_pence if len(model.months) > 0 else None
        ),
        return_on_equity_pct=pct(profit, equity_contributed) if equity_contributed > 0 else None,
        senior_breakeven_pence=None,  # Task 4
        senior_breakeven_pct_of_lender_gdv=None,  # Task 4
        senior_breakeven_fall_from_lender_gdv_pct=None,  # Task 4
        developer_breakeven_pence=None,  # Task 5
        cost_to_complete=None,  # Task 6
    )
