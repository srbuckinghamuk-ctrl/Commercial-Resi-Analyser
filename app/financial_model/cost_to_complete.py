"""Port of frontend/src/lib/model/cost-to-complete.ts (spec Sec 5.10, straight-line
schedule).

``CostToCompleteMonth``/``CostToCompleteSummary`` live here (not in metrics.py,
where AppraisalResultV2 and the other Task 3-5 result dataclasses live) purely to
avoid a metrics.py <-> cost_to_complete.py import cycle: metrics.py must import
``compute_cost_to_complete`` from this module to wire AppraisalResultV2's
``cost_to_complete`` field, so the summary type it references has to be defined on
this side. metrics.py imports both names back from here."""
from __future__ import annotations

from dataclasses import dataclass

from .engine import MonthlyModel
from .schedule import Schedule
from .types import CalculatorInputsV2, CalculatorInputsV3


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


def compute_cost_to_complete(
    schedule: Schedule, model: MonthlyModel, inputs: CalculatorInputsV2 | CalculatorInputsV3,
) -> CostToCompleteSummary:
    """Indexing convention: entries are labelled ``m = 1..term`` (``term =
    schedule.term_months``), where label ``m`` reports the state as of the
    *completion* of ledger month ``m - 1`` (ledger months are 0-based,
    ``LedgerMonth.month == m - 1``) -- i.e. label ``m``'s "remaining" figures cover
    ledger months ``m, m+1, ..., term - 1`` only, excluding whatever ledger month
    ``m - 1`` itself spent or drew. ``m == term`` is the terminal "nothing left to
    spend" checkpoint (an empty remaining-cost slice). This gives the telescoping
    identity ``remaining_cost(m) == remaining_cost(m + 1) + cost(month m + 1)`` and
    the boundary identity ``remaining_cost(1) == total cost - month-0 spend``, both
    pinned by worksheet tests.

    ``inputs`` is typed as the ``CalculatorInputsV2 | CalculatorInputsV3`` union
    (not the narrower ``CalculatorInputsV3`` the task brief's interface sketch
    used) because only ``equity_sources`` is read here -- a field common to both
    input versions -- and ``derive_metrics`` (the sole caller) itself carries that
    same union.
    """
    term = schedule.term_months
    # Spec Sec 2: only cash-classified, non-rejected equity sources are committed
    # funding -- identical filter to engine.py's ``committed_equity``, so "not yet
    # contributed" tracks exactly what the ledger itself treats as available.
    cash_equity_total = sum(
        s.amount_pence for s in inputs.equity_sources
        if s.classification == "cash" and s.evidence_status != "rejected"
    )

    cum_equity_contributed = 0
    months: list[CostToCompleteMonth] = []
    first_shortfall_month: int | None = None
    max_shortfall = 0

    for m in range(1, term + 1):
        remaining_cost = 0
        for k in range(m, term):
            u = schedule.uses[k]
            remaining_cost += (
                u.acquisition_pence + u.construction_pence + u.professional_pence
                + u.statutory_pence + u.lender_ancillary_fees_pence
            )
            lm = model.months[k]
            remaining_cost += lm.interest_accrued_pence + lm.capitalised_fees_pence

        # "That month" is ledger month m - 1 -- the most recent month whose
        # draw/contribution has actually happened by the point this label describes
        # (see the indexing note above).
        prev_ledger_month = model.months[m - 1]
        cum_equity_contributed += prev_ledger_month.equity_contribution_pence
        undrawn_facility = prev_ledger_month.undrawn_net_facility_pence or 0
        remaining_cash_equity = max(0, cash_equity_total - cum_equity_contributed)
        remaining_funding = undrawn_facility + remaining_cash_equity

        surplus = remaining_funding - remaining_cost
        if surplus < 0:
            if first_shortfall_month is None:
                first_shortfall_month = m
            max_shortfall = max(max_shortfall, -surplus)

        months.append(CostToCompleteMonth(
            month=m,
            remaining_cost_pence=remaining_cost,
            remaining_funding_pence=remaining_funding,
            surplus_pence=surplus,
        ))

    return CostToCompleteSummary(
        first_shortfall_month=first_shortfall_month,
        max_shortfall_pence=max_shortfall,
        months=months,
    )
