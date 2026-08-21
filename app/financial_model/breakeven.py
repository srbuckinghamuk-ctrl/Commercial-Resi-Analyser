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

from .engine import exit_fee_amount, money_round
from .types import FacilityTerms


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


@dataclass
class PhasedSeniorBreakevenTerms:
    """Phased senior break-even (spec Sec 5.11 phased regime). Freezes the actual
    run's draw+capitalised-fee schedule, scales tranche receipts by a uniform
    factor, and replays spec Sec 4.4's sweep (fee-once, sales_sweep_pct, both
    arms) with spec Sec 4's interest recurrence. Excludes any planned refinance
    (Sec 5.11 is the enforcement question)."""

    draws_and_fees_pence: list[int]  # per month: draw_pence + capitalised_fees_pence, frozen
    # R11 ruling R24. The ledger's own vat_reclaim_pence per month, frozen -- the
    # reclaim repays senior debt (Sec 17.6), so a replay without it solves for a
    # sale price the deal does not actually need. Independent of the sale price
    # being solved for, exactly like draws_and_fees_pence: a reclaim is the
    # return of an advance, not a realisation, so scaling total gross receipts
    # does not move it. Same length as draws_and_fees_pence.
    #
    # The static (unphased) path needs no equivalent: it reads
    # redemption_balance_at_disposal_pence, which the ledger captures AFTER the
    # reclaim has been applied (ruling R23).
    vat_reclaims_pence: list[int]
    monthly_rate: float              # annual_interest_rate_pct / 100 / 12
    rolled_up: bool
    sales_sweep_pct: float
    tranches: list  # objects with .month_offset / .pct_of_gross_receipts (SalesPhasingTranche)
    selling_agent_fee_pct: float
    selling_legal_fee_pence: int
    enforcement_cost_assumption_pence: int
    finance: FacilityTerms           # exit-fee basis terms
    committed_gross_facility_pence: int


def _phased_net_by_month(t: PhasedSeniorBreakevenTerms, total_gross: int) -> dict[int, int]:
    """Net tranche proceeds at total gross G, split per spec Sec 4.4.1 (residue
    absorption, pro-rata costs); enforcement deducted from the first tranche.
    Keyed by month."""
    out: dict[int, int] = {}
    if total_gross <= 0:
        return out
    agent_fee_total = money_round((total_gross * t.selling_agent_fee_pct) / 100)
    gross_allocated = 0
    agent_allocated = 0
    legal_allocated = 0
    for i, tr in enumerate(t.tranches):
        last = i == len(t.tranches) - 1
        gross = (
            total_gross - gross_allocated if last
            else money_round((total_gross * tr.pct_of_gross_receipts) / 100)
        )
        agent = (
            agent_fee_total - agent_allocated if last
            else money_round((agent_fee_total * gross) / total_gross)
        )
        legal = (
            t.selling_legal_fee_pence - legal_allocated if last
            else money_round((t.selling_legal_fee_pence * gross) / total_gross)
        )
        gross_allocated += gross
        agent_allocated += agent
        legal_allocated += legal
        enforcement = t.enforcement_cost_assumption_pence if i == 0 else 0
        out[tr.month_offset] = out.get(tr.month_offset, 0) + gross - agent - legal - enforcement
    return out


def phased_replay_redeems(t: PhasedSeniorBreakevenTerms, total_gross: int) -> bool:
    """Replays the ledger recurrence at total gross G; True iff fully redeemed by
    term end. Mirrors spec Sec 4.4's sweep arms EXCEPT for one documented Sec 5.11
    modelling assumption: the partial arm reserves the exit fee out of the
    tranche's sweep before repaying principal (``repayment = max(0,
    min(sweep_available - fee, balance))``), rather than the ledger's own clamp
    (repay up to the full balance, and only fall back to sweep - fee when that
    repayment would exactly equal the balance). Without the reservation, the
    residual balance is discontinuous in G -- right at the point where a
    tranche's sweep first reaches the balance, the ledger's clamp jumps the
    residual from ~0 up to `fee`, so feasibility is not monotone in G (it can go
    True -> False -> True as G grows) and the shared bisection can miss a
    genuinely feasible G above the discontinuity. Reserving the fee up front
    makes the residual continuous and (weakly) decreasing in G at every step,
    restoring monotonicity; the cost is that principal repayment is delayed by
    at most `fee` per tranche relative to the real ledger, so the phased
    break-even this produces is conservatively (slightly) overstated relative
    to Sec 4.4's actual clamp behaviour. Exported for the tightness test only --
    production callers use the solver."""
    net_by_month = _phased_net_by_month(t, total_gross)
    balance = 0
    peak = 0
    redeemed = False
    for m in range(len(t.draws_and_fees_pence)):
        dc = t.draws_and_fees_pence[m]
        interest = money_round((balance + dc) * t.monthly_rate) if t.rolled_up else 0
        balance = balance + dc + interest
        if balance > peak:
            peak = balance
        # R11 Sec 17.6 / ruling R24. The reclaim is applied at the SAME point in
        # the month the ledger applies it: whole (never through sales_sweep_pct,
        # which governs realisations) and BEFORE the tranche sweep, because it
        # reduces the balance that sweep then has to clear. A full reclaim
        # redeems on the same terms as any other full redemption, so a later
        # tranche charges no second exit fee -- mirroring engine.py's reclaim
        # block in order, in the full-redemption arm, and in the fee it charges.
        reclaim = t.vat_reclaims_pence[m] if m < len(t.vat_reclaims_pence) else 0
        if reclaim > 0 and balance > 0:
            fee = 0 if redeemed else exit_fee_amount(
                t.finance, t.committed_gross_facility_pence, peak, balance,
            )
            if reclaim >= balance + fee:
                balance = 0
                redeemed = True
            else:
                # The partial arm carries the SAME documented Sec 5.11 deviation
                # the tranche arm below carries, and for the same reason. The
                # reclaim does not move with G, but the BALANCE it meets does the
                # moment any tranche precedes it -- so the ledger's own clamp
                # (applied = min(reclaim, balance), falling back to reclaim - fee
                # only when that would exactly clear the balance) would jump the
                # residual from ~0 up to `fee` at the G where the balance first
                # falls to the reclaim, and feasibility would stop being monotone
                # in G. Reserving the fee up front keeps the residual weakly
                # decreasing in G; the cost is that a partial reclaim repays up
                # to `fee` less principal than the real ledger does, so the
                # phased break-even stays conservatively overstated -- never
                # understated.
                balance -= max(0, min(reclaim - fee, balance))
        net = net_by_month.get(m, 0)
        if net > 0 and balance > 0:
            sweep_available = money_round((net * t.sales_sweep_pct) / 100)
            fee = 0 if redeemed else exit_fee_amount(t.finance, t.committed_gross_facility_pence, peak, balance)
            if sweep_available >= balance + fee:
                balance = 0
                redeemed = True
            else:
                balance -= max(0, min(sweep_available - fee, balance))
    return redeemed and balance == 0


def solve_senior_breakeven_phased(t: PhasedSeniorBreakevenTerms) -> int | None:
    if t.selling_agent_fee_pct >= 100:
        return None
    if len(t.tranches) == 0:
        return None
    if t.sales_sweep_pct <= 0:
        return None
    last_tranche = max(x.month_offset for x in t.tranches)
    for m in range(last_tranche + 1, len(t.draws_and_fees_pence)):
        if t.draws_and_fees_pence[m] > 0:
            return None  # structurally unsolvable

    # Upper-bound seed: the zero-receipts trajectory's terminal balance + fee is a lower
    # bound on what a SINGLE full-sweep tranche would need to clear (receipts only shrink
    # balances); inflate for costs and the sweep fraction. This is only a starting seed, not
    # a proven sufficient bound -- with multiple tranches, the Sec 5.11 fee reserve (see
    # phased_replay_redeems's doc comment) is paid out of EVERY tranche's sweep, not just the
    # last, so an early tranche with a small pct_of_gross_receipts share can need materially
    # more total G to clear the same balance than the single-tranche closed form accounts
    # for. Grown by doubling below until genuinely feasible, so correctness never depends on
    # the seed's tightness -- only its cost (bisection is O(log hi), so a loose seed is cheap).
    # Deliberately reclaim-free (R24): omitting vat_reclaims_pence here can only make the
    # terminal balance, and so the seed, LARGER than the real trajectory needs. A seed that
    # is too large is free; one that is too small would be a correctness bug.
    b0 = 0
    peak0 = 0
    for dc in t.draws_and_fees_pence:
        interest = money_round((b0 + dc) * t.monthly_rate) if t.rolled_up else 0
        b0 = b0 + dc + interest
        if b0 > peak0:
            peak0 = b0
    if b0 <= 0:
        return 0
    fee0 = exit_fee_amount(t.finance, t.committed_gross_facility_pence, peak0, b0)
    needed = b0 + fee0 + t.selling_legal_fee_pence + t.enforcement_cost_assumption_pence
    sweep_frac = t.sales_sweep_pct / 100
    hi = math.ceil(needed / (sweep_frac * (1 - t.selling_agent_fee_pct / 100))) + 1000
    growth_iterations = 0
    while not phased_replay_redeems(t, hi) and growth_iterations < 64:
        hi *= 2
        growth_iterations += 1
    return _bisect_minimal_feasible(0, hi, lambda g: phased_replay_redeems(t, g))
