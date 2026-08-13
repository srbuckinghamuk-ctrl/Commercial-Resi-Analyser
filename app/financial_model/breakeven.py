"""Port of frontend/src/lib/model/breakeven.ts.

Senior repayment break-even (spec Sec 5.11). Given the senior facility's redemption balance
and fees at disposal, plus the exit strategy's selling-cost terms, finds the minimum gross
sale price P (pence) that fully redeems the senior facility -- i.e. the price at which P
covers the redemption balance, the exit fee, disposal costs computed on P itself (selling
agent fee is a percentage of the sale price, selling legal fee is flat), and the lender's
disclosed enforcement-cost assumption.

Developer profit break-even (spec Sec 5.12, Release 2b Task 5). Lender/debt-independent:
finds the minimum gross sale price P (pence) that covers the whole total development cost
excluding selling costs (selling costs are re-solved at P itself), regardless of any
facility or redemption balance. Shares the bisection search (_bisect_minimal_feasible) with
the senior solver above -- extracted here with no behavioural change to the senior solver.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .engine import money_round


@dataclass
class SeniorBreakevenTerms:
    redemption_balance_pence: int  # senior balance at disposal, pre-receipt
    exit_fee_pence: int            # fee due on redemption at disposal
    selling_agent_fee_pct: float
    selling_legal_fee_pence: int
    enforcement_cost_assumption_pence: int


@dataclass
class DeveloperBreakevenTerms:
    tdc_ex_selling_pence: int  # total development cost, excluding selling costs
    selling_agent_fee_pct: float
    selling_legal_fee_pence: int


def _bisect_minimal_feasible(lo: int, hi: int, feasible) -> int | None:
    """Bisection on integer pence. Returns the minimum integer P in [lo, hi] for which
    ``feasible(P)`` holds. Returns None when the search does not converge within 200
    iterations (a defensive cap -- never a substitute number) or when P is still
    infeasible once the search space is exhausted."""
    iterations = 0
    while lo < hi:
        if iterations >= 200:
            return None
        iterations += 1
        mid = (lo + hi) // 2
        if feasible(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo if feasible(lo) else None


def solve_senior_breakeven(t: SeniorBreakevenTerms) -> int | None:
    """Returns the minimum integer P satisfying
    ``P >= redemption + exit_fee + disposal_costs(P) + enforcement``, where
    ``disposal_costs(P) = round_half_up(P * selling_agent_fee_pct/100) + selling_legal_fee_pence``.
    Returns None when the agent fee is >= 100% (unsolvable -- a sale price can never outrun a
    cost that scales at or above 100% of itself), or per `_bisect_minimal_feasible`'s
    iteration-cap guard."""
    redemption = t.redemption_balance_pence
    exit_fee = t.exit_fee_pence
    pct = t.selling_agent_fee_pct
    legal = t.selling_legal_fee_pence
    enforcement = t.enforcement_cost_assumption_pence

    if pct >= 100:
        return None

    fee_floor = redemption + exit_fee + enforcement + legal

    def feasible(p: int) -> bool:
        return p >= fee_floor + money_round((p * pct) / 100)

    lo = fee_floor
    hi = math.ceil(fee_floor / (1 - pct / 100)) + 100
    return _bisect_minimal_feasible(lo, hi, feasible)


def solve_developer_breakeven(t: DeveloperBreakevenTerms) -> int | None:
    """Returns the minimum integer P satisfying
    ``P >= tdc_ex_selling + round_half_up(P * selling_agent_fee_pct/100) + selling_legal_fee_pence``
    (profit = P - selling costs - tdc_ex_selling >= 0, selling costs re-solved at P per spec
    Sec 5.12). Returns None when the agent fee is >= 100% (unsolvable), or per
    `_bisect_minimal_feasible`'s iteration-cap guard."""
    tdc_ex_selling = t.tdc_ex_selling_pence
    pct = t.selling_agent_fee_pct
    legal = t.selling_legal_fee_pence

    if pct >= 100:
        return None

    fee_floor = tdc_ex_selling + legal

    def feasible(p: int) -> bool:
        return p >= fee_floor + money_round((p * pct) / 100)

    lo = fee_floor
    hi = math.ceil(fee_floor / (1 - pct / 100)) + 100
    return _bisect_minimal_feasible(lo, hi, feasible)
