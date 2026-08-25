"""Port of frontend/src/lib/model/monitoring.ts (R14 spec Sec 20.2), line for line.

``MonitoringStatementLine`` / ``MonitoringStatementTotals`` / ``MonitoringStatement``
live here rather than in metrics.py for the same reason ``CostToCompleteMonth`` does
(see cost_to_complete.py's module docstring): metrics.py will import
``compute_monitoring_statement`` from this module to wire AppraisalResultV2's
``monitoring_statement`` field, so the result types it references have to be defined
on this side.

Kept SELF-CONTAINED on purpose (Task 7 decision 1, mirrored): the Sec 5.10
reserve-headroom expression and Sec 5.10's cash-equity filter are restated below
rather than extracted into helpers shared with cost_to_complete.py. The genuinely
shared part of each is a single expression, and a helper would add a cross-module
dependency that the TypeScript twin would then have to mirror as well. Both sites
are named in the comments where the expressions appear.
"""
from __future__ import annotations

from dataclasses import dataclass

from .cost_plan import CostPlanResult
from .engine import MonthlyModel
from .schedule import Schedule
from .types import MONITORING_CATEGORIES, AnyCalculatorInputs, MonitoringCategory


@dataclass
class MonitoringStatementLine:
    """R14 spec Sec 20.2. One category's row of the monitoring cost-to-complete
    statement.

    Five of the columns are the sponsor's entered figures, echoed unchanged;
    ``original_budget_pence`` comes from the inception model (Sec 20.1's table, see
    ``original_budgets`` below); the remaining five are sums and differences of
    those. ``paid_to_date_pence`` is carried and printed because the audit asks a
    lender to reconcile certificates against payments, but it drives NO other column
    -- the statement is a cost position, not a cash position (Sec 7, stated).
    """

    category: MonitoringCategory
    original_budget_pence: int
    current_budget_pence: int
    certified_to_date_pence: int
    paid_to_date_pence: int
    committed_to_date_pence: int
    committed_not_certified_pence: int
    forecast_to_complete_pence: int
    estimated_final_cost_pence: int
    #: Positive = overrun against the inception budget.
    variance_vs_original_pence: int
    variance_vs_current_pence: int
    remaining_to_spend_pence: int


@dataclass
class MonitoringStatementTotals:
    """``MonitoringStatementLine`` minus ``category`` -- the TS side's
    ``Omit<MonitoringStatementLine, 'category'>``, which Python has no structural
    equivalent for, so the eleven columns are restated. Every field is the column
    sum of the five lines."""

    original_budget_pence: int
    current_budget_pence: int
    certified_to_date_pence: int
    paid_to_date_pence: int
    committed_to_date_pence: int
    committed_not_certified_pence: int
    forecast_to_complete_pence: int
    estimated_final_cost_pence: int
    variance_vs_original_pence: int
    variance_vs_current_pence: int
    remaining_to_spend_pence: int


@dataclass
class MonitoringStatement:
    """R14 spec Sec 20.2. The statement as a whole: five lines, their column totals,
    the funding reconciliation and the three variances against the inception plan.

    A snapshot, never a re-simulation (Sec 20.5 limitation 4): every ledger figure
    read here is the INCEPTION forecast, including the interest component -- there is
    no actual-interest input (Sec 20.5 limitation 1).
    """

    reporting_month: int
    #: Echoed for the memo's provenance line. Printed only; drives no arithmetic in
    #: this module, and a test asserts two statements differing only in this field
    #: are otherwise equal.
    reporting_date: str
    #: Always five, in ``MONITORING_CATEGORIES`` order whatever order the input listed.
    lines: list[MonitoringStatementLine]
    totals: MonitoringStatementTotals
    contingency_remaining_pence: int
    undrawn_net_facility_pence: int
    reserve_headroom_pence: int
    remaining_cash_equity_pence: int
    remaining_funding_pence: int
    forecast_finance_pence: int
    remaining_uses_pence: int
    surplus_pence: int
    shortfall_pence: int
    #: Positive = ahead of (more than) plan, in all three.
    debt_drawn_variance_pence: int
    equity_injected_variance_pence: int
    cost_to_date_variance_pence: int


def original_budgets(
    schedule: Schedule, cost_plan: CostPlanResult,
) -> dict[MonitoringCategory, int]:
    """R14 spec Sec 20.1's table: the "original budget" column, which is never entered
    -- it is read off the inception model so the statement can measure drift against
    the appraisal the lender actually underwrote.

    The construction/contingency split is the one place the inception model's lines
    and the statement's lines differ: Sec 3.4 carries contingency inside the
    construction line and the statement pulls it out, because the audit asks for
    remaining contingency as its own figure. ``compute_cost_plan`` builds
    ``construction_total_pence`` as ``base_build + contingency_total + compliance``,
    so ``construction + contingency == sum(uses.construction_pence)`` exactly --
    asserted on every corpus fixture, per Sec 6.

    ``acquisition`` is read from ``schedule.totals``, which ``build_schedule`` assigns
    from the same ``acquisition_total`` it puts into ``uses[0]``; the spec's
    ``sum(uses.acquisition_pence)`` form is the identical figure, and reading the
    already-computed total keeps this module from re-deriving a quantity the schedule
    owns. Likewise ``professional`` and ``statutory`` come from the cost plan, which
    is exactly what ``schedule.totals`` holds for those two categories (see
    ``build_schedule``'s totals block) -- the spec's ``sum(uses.*)`` phrasing and the
    brief's ``cost_plan.*_total_pence`` phrasing name one number, and a fixture-wide
    test pins that they agree.

    R15b spec Sec 24.5: ``construction`` also carries ``inflation_total_pence`` -- the
    QS tender-price allowance is part of ``construction_total_pence`` exactly as
    ``base_build_pence`` and ``compliance_pence`` are (cost_plan.py), so leaving it out
    here would break the split identity on any document that carries one (fixture Z).
    """
    return {
        "acquisition": schedule.totals.acquisition_pence,
        "construction": (
            cost_plan.base_build_pence + cost_plan.inflation_total_pence
            + cost_plan.compliance_pence
        ),
        "professional": cost_plan.professional_total_pence,
        "statutory": cost_plan.statutory_total_pence,
        "contingency": cost_plan.contingency_total_pence,
    }


def compute_monitoring_statement(
    schedule: Schedule,
    model: MonthlyModel,
    inputs: AnyCalculatorInputs,
    cost_plan: CostPlanResult,
) -> MonitoringStatement | None:
    """R14 spec Sec 20.2. The monitoring cost-to-complete statement at
    ``reporting_month``.

    Pure: reads the schedule, the inception ledger, the inputs and the cost plan, and
    writes nothing. Nothing here re-runs the ledger.

    ``None`` exactly when the document carries no monitoring block -- either because
    it predates v11 (``monitoring`` absent, read structurally with ``getattr``, this
    codebase's stand-in for the TS side's ``'monitoring' in inputs``) or because it is
    a v11 document with ``monitoring: None``, which is every migrated document.
    ``inputs`` is the ``AnyCalculatorInputs`` union rather than ``CalculatorInputsV11``
    because ``derive_metrics`` (Task 9's caller) carries that union.

    Rounding: none. Every input is integer pence and every column is a sum or a
    difference of integers (Sec 7, "Rounding").

    Validation (Sec 20.3) is a separate concern and runs on inputs only: this engine
    sorts the lines, it does not check them. Where a malformed block would otherwise
    make an index absent, the degradation is defined rather than defended:

      * a category absent from ``lines`` contributes its entered columns as zero (its
        original budget is still the inception figure);
      * a duplicated category takes its FIRST occurrence -- note this is deliberately
        NOT the natural dict-comprehension idiom, which would take the last;
      * a ``reporting_month`` outside ``1..term`` simply moves the two loop bounds. A
        month PAST the term makes the elapsed slice the whole ledger and forecasts no
        finance. A month at or below zero accumulates no elapsed figures -- and its
        forecast slice becomes the WHOLE term, not nothing, because ``max(0, m)``
        clamps the forecast start back to ledger month 0.

    All four are hard validation errors upstream and unreachable in a report-safe
    document.
    """
    monitoring = getattr(inputs, "monitoring", None)
    if monitoring is None:
        return None

    m = monitoring.reporting_month
    term = schedule.term_months
    originals = original_budgets(schedule, cost_plan)

    # First occurrence wins; validation forbids duplicates upstream. Written as an
    # explicit loop with a membership test rather than
    # ``{line.category: line for line in monitoring.lines}`` precisely because that
    # comprehension is LAST-wins, and the TypeScript twin is first-wins.
    entered: dict[MonitoringCategory, object] = {}
    for line in monitoring.lines:
        if line.category not in entered:
            entered[line.category] = line

    lines: list[MonitoringStatementLine] = []
    for category in MONITORING_CATEGORIES:
        line_input = entered.get(category)
        current_budget = line_input.current_budget_pence if line_input is not None else 0
        certified = line_input.certified_to_date_pence if line_input is not None else 0
        paid = line_input.paid_to_date_pence if line_input is not None else 0
        committed = line_input.committed_to_date_pence if line_input is not None else 0
        forecast = line_input.forecast_to_complete_pence if line_input is not None else 0
        original = originals[category]
        committed_not_certified = committed - certified
        estimated_final = committed + forecast
        lines.append(MonitoringStatementLine(
            category=category,
            original_budget_pence=original,
            current_budget_pence=current_budget,
            certified_to_date_pence=certified,
            paid_to_date_pence=paid,
            committed_to_date_pence=committed,
            committed_not_certified_pence=committed_not_certified,
            forecast_to_complete_pence=forecast,
            estimated_final_cost_pence=estimated_final,
            variance_vs_original_pence=estimated_final - original,
            variance_vs_current_pence=estimated_final - current_budget,
            # Identically ``committed_not_certified + forecast``; Sec 7 gives both forms.
            remaining_to_spend_pence=estimated_final - certified,
        ))

    def column(field: str) -> int:
        return sum(getattr(line, field) for line in lines)

    totals = MonitoringStatementTotals(
        original_budget_pence=column("original_budget_pence"),
        current_budget_pence=column("current_budget_pence"),
        certified_to_date_pence=column("certified_to_date_pence"),
        paid_to_date_pence=column("paid_to_date_pence"),
        committed_to_date_pence=column("committed_to_date_pence"),
        committed_not_certified_pence=column("committed_not_certified_pence"),
        forecast_to_complete_pence=column("forecast_to_complete_pence"),
        estimated_final_cost_pence=column("estimated_final_cost_pence"),
        variance_vs_original_pence=column("variance_vs_original_pence"),
        variance_vs_current_pence=column("variance_vs_current_pence"),
        remaining_to_spend_pence=column("remaining_to_spend_pence"),
    )

    contingency = next((line for line in lines if line.category == "contingency"), None)
    contingency_remaining = max(
        0,
        (contingency.current_budget_pence if contingency is not None else 0)
        - (contingency.certified_to_date_pence if contingency is not None else 0),
    )

    # Ledger months 0..m-1 are the months that have HAPPENED by label m -- Sec 5.10's
    # indexing convention, shared with ``compute_cost_to_complete``.
    cum_interest_capitalised = 0
    cum_drawn_and_capitalised_fees = 0
    cum_equity_contributed = 0
    last_elapsed = max(0, min(m, len(model.months)))
    for k in range(last_elapsed):
        lm = model.months[k]
        cum_interest_capitalised += lm.interest_capitalised_pence
        cum_drawn_and_capitalised_fees += lm.draw_pence + lm.capitalised_fees_pence
        cum_equity_contributed += lm.equity_contribution_pence
    cum_planned_cost = 0
    last_elapsed_uses = max(0, min(m, len(schedule.uses)))
    for k in range(last_elapsed_uses):
        u = schedule.uses[k]
        cum_planned_cost += (
            u.acquisition_pence + u.construction_pence
            + u.professional_pence + u.statutory_pence
        )

    # Sec 7 uses side: the inception ledger's finance forecast from month m onward.
    forecast_finance = 0
    for k in range(max(0, m), min(term, len(model.months))):
        forecast_finance += (
            model.months[k].interest_accrued_pence + model.months[k].capitalised_fees_pence
        )

    # Sec 7 funding side. This is the Sec 5.10 reserve-headroom formula evaluated at ONE
    # month rather than swept across the term; it is deliberately restated here rather
    # than extracted into a shared helper, because the shared part is a single
    # max-of-a-difference and the two callers differ in the expensive half --
    # ``compute_cost_to_complete`` accumulates ``cum_interest_capitalised`` as it walks
    # every label, while the statement needs it at one. A helper taking the
    # already-accumulated sum would dedupe one expression and add a cross-module
    # dependency the TypeScript twin must mirror as well. If the formula ever changes,
    # it changes in cost_to_complete.py and here.
    rolled_up = inputs.finance.interest_type == "rolled_up"
    reserve_headroom = (
        max(
            0,
            model.committed_gross_facility_pence - model.committed_net_facility_pence
            - cum_interest_capitalised,
        )
        if rolled_up else 0
    )
    # ``committed_net_facility_pence`` is already 0 for a cash deal (the ledger zeroes
    # it), so this needs no ``funding_source`` branch of its own.
    undrawn_net_facility = max(
        0, model.committed_net_facility_pence - monitoring.debt_drawn_to_date_pence,
    )
    # Sec 5.10's filter, unchanged: cash-classified and not rejected is what the ledger
    # itself treats as available funding.
    cash_equity_total = sum(
        s.amount_pence for s in inputs.equity_sources
        if s.classification == "cash" and s.evidence_status != "rejected"
    )
    remaining_cash_equity = max(
        0, cash_equity_total - monitoring.cash_equity_injected_to_date_pence,
    )
    remaining_funding = undrawn_net_facility + reserve_headroom + remaining_cash_equity

    remaining_uses = totals.remaining_to_spend_pence + forecast_finance
    surplus = remaining_funding - remaining_uses

    return MonitoringStatement(
        reporting_month=m,
        reporting_date=monitoring.reporting_date,
        lines=lines,
        totals=totals,
        contingency_remaining_pence=contingency_remaining,
        undrawn_net_facility_pence=undrawn_net_facility,
        reserve_headroom_pence=reserve_headroom,
        remaining_cash_equity_pence=remaining_cash_equity,
        remaining_funding_pence=remaining_funding,
        forecast_finance_pence=forecast_finance,
        remaining_uses_pence=remaining_uses,
        surplus_pence=surplus,
        shortfall_pence=max(0, -surplus),
        debt_drawn_variance_pence=(
            monitoring.debt_drawn_to_date_pence - cum_drawn_and_capitalised_fees
        ),
        equity_injected_variance_pence=(
            monitoring.cash_equity_injected_to_date_pence - cum_equity_contributed
        ),
        cost_to_date_variance_pence=totals.certified_to_date_pence - cum_planned_cost,
    )
