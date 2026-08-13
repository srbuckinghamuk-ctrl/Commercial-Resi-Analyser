"""Port of frontend/src/lib/model/validation.ts."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .engine import MonthlyModel
from .schedule import Schedule
from .types import CalculatorInputsV2


@dataclass
class ValidationIssue:
    severity: str  # 'error' | 'warning'
    field: str
    message: str


@dataclass
class ReconciliationStatus:
    sources_equal_uses: bool
    debt_rollforward_ok: bool
    closing_never_negative: bool
    facility_within_limit: bool
    senior_repaid: bool
    funding_complete: bool
    report_safe: bool
    issues: list[ValidationIssue] = field(default_factory=list)


NON_NEGATIVE_MONEY: list[tuple[str, Callable[[CalculatorInputsV2], float]]] = [
    ("acquisition.purchase_price_pence", lambda i: i.acquisition.purchase_price_pence),
    ("acquisition.legal_fees_pence", lambda i: i.acquisition.legal_fees_pence),
    ("acquisition.survey_cost_pence", lambda i: i.acquisition.survey_cost_pence),
    ("acquisition.other_acquisition_costs_pence", lambda i: i.acquisition.other_acquisition_costs_pence),
    ("conversion_costs.prior_approval_fee_per_dwelling_pence",
     lambda i: i.conversion_costs.prior_approval_fee_per_dwelling_pence),
    ("conversion_costs.cil_s106_pence", lambda i: i.conversion_costs.cil_s106_pence),
    ("conversion_costs.architect_pence", lambda i: i.conversion_costs.architect_pence),
    ("conversion_costs.structural_engineer_pence", lambda i: i.conversion_costs.structural_engineer_pence),
    ("conversion_costs.mande_pence", lambda i: i.conversion_costs.mande_pence),
    ("conversion_costs.planning_consultant_pence", lambda i: i.conversion_costs.planning_consultant_pence),
    ("conversion_costs.building_control_pence", lambda i: i.conversion_costs.building_control_pence),
    ("conversion_costs.other_professional_fees_pence",
     lambda i: i.conversion_costs.other_professional_fees_pence),
    ("conversion_costs.construction_cost_per_sqm_pence",
     lambda i: i.conversion_costs.construction_cost_per_sqm_pence),
    ("conversion_costs.fire_safety_pence", lambda i: i.conversion_costs.fire_safety_pence),
    ("conversion_costs.sound_insulation_pence", lambda i: i.conversion_costs.sound_insulation_pence),
    ("conversion_costs.part_l_compliance_pence", lambda i: i.conversion_costs.part_l_compliance_pence),
    ("exit_strategy.selling_legal_fee_pence", lambda i: i.exit_strategy.selling_legal_fee_pence),
]


def validate_inputs(inputs: CalculatorInputsV2) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    def err(field_: str, message: str) -> None:
        issues.append(ValidationIssue(severity="error", field=field_, message=message))

    def warn(field_: str, message: str) -> None:
        issues.append(ValidationIssue(severity="warning", field=field_, message=message))

    for field_name, get in NON_NEGATIVE_MONEY:
        if get(inputs) < 0:
            err(field_name, "Monetary values cannot be negative.")
    if inputs.conversion_costs.total_construction_sqm < 0:
        err("conversion_costs.total_construction_sqm", "Area cannot be negative.")
    if inputs.conversion_costs.contingency_pct < 0:
        err("conversion_costs.contingency_pct", "Contingency cannot be negative.")
    for idx, u in enumerate(inputs.unit_mix.units):
        if u.floor_area_sqm < 0:
            err(f"unit_mix.units[{idx}].floor_area_sqm", "Unit area cannot be negative.")
        if u.estimated_value_pence <= 0:
            err(
                f"unit_mix.units[{idx}].estimated_value_pence",
                "Every unit needs a positive value - zero GDV with units present is invalid.",
            )

    f = inputs.finance
    if not isinstance(f.term_months, int) or f.term_months < 1:
        err("finance.term_months", "Term must be a whole number of months, at least 1.")
    if f.annual_interest_rate_pct < 0:
        err("finance.annual_interest_rate_pct", "Rate cannot be negative.")
    if f.arrangement_fee_pct < 0 or f.exit_fee_pct < 0:
        err("finance.fees", "Fees cannot be negative.")
    if f.sales_sweep_pct < 0 or f.sales_sweep_pct > 100:
        err("finance.sales_sweep_pct", "Sweep must be between 0 and 100%.")
    if f.development_cost_advance_pct < 0 or f.development_cost_advance_pct > 100:
        err(
            "finance.development_cost_advance_pct",
            "Development advance rate must be between 0 and 100%.",
        )
    if f.equity_draw_rule == "pari_passu":
        err("finance.equity_draw_rule", "Pari-passu draws are not yet supported - use equity-first.")
    if f.funding_source == "cash":
        if (f.committed_net_facility_pence or 0) != 0 or (f.committed_gross_facility_pence or 0) != 0:
            err("finance.committed_net_facility_pence", "Cash funding must have a zero senior facility.")
    else:
        net = f.committed_net_facility_pence
        if net is not None and f.day_one_advance_pence is not None and f.day_one_advance_pence > net:
            err(
                "finance.day_one_advance_pence",
                "Day-one advance cannot exceed the committed net facility.",
            )
        if (
            net is not None and f.committed_gross_facility_pence is not None
            and f.committed_gross_facility_pence < net
        ):
            err(
                "finance.committed_gross_facility_pence",
                "Gross facility cannot be below the net facility.",
            )
        if net is None:
            warn(
                "finance.committed_net_facility_pence",
                "No committed facility entered - debt metrics will be unavailable.",
            )

    for idx, e in enumerate(inputs.equity_sources):
        if e.amount_pence < 0:
            err(f"equity_sources[{idx}].amount_pence", "Equity amounts cannot be negative.")
        if e.classification == "planning_uplift" and e.evidence_status != "confirmed":
            warn(
                f"equity_sources[{idx}]",
                "Planning/revaluation uplift is not cash equity - evidence required.",
            )
        if e.classification != "cash" and e.amount_pence > 0:
            warn(
                f"equity_sources[{idx}]",
                "Non-cash equity (land/uplift/vendor/deferred) is recorded but not yet "
                "modelled as funding - Release 2; it does not fund monthly costs.",
            )

    unit_area = sum(u.floor_area_sqm for u in inputs.unit_mix.units)
    const_area = inputs.conversion_costs.total_construction_sqm
    if unit_area > 0 and const_area > 0:
        ratio = unit_area / const_area
        if ratio < 0.75 or ratio > 1.25:
            warn(
                "conversion_costs.total_construction_sqm",
                f"Unit NIA ({unit_area} m2) and construction area ({const_area} m2) differ by "
                "more than 25% - check the area basis.",
            )
    if inputs.exit_strategy.route == "blended" and len(inputs.exit_strategy.retained_units) == 0:
        warn("exit_strategy.retained_units", "Blended exit selected but no units are marked as retained.")
    if f.requires_confirmation:
        warn("finance", "Facility terms were migrated from a legacy appraisal and require confirmation.")

    # Spec Sec 3.18: RLV = GDV / (1 + target/100) - cost-excluding-land. A target of
    # exactly -100% divides by zero; below -100% flips the sign and produces a
    # non-finite/nonsensical RLV. Approved in Task 5 review: guard this at
    # validation time rather than let RLV emit Infinity/NaN downstream.
    if inputs.deal_spider.target_profit_on_cost_pct <= -100:
        err(
            "deal_spider.target_profit_on_cost_pct",
            "Target profit on cost must be greater than -100% - this value makes the residual "
            "land value calculation non-finite.",
        )

    return issues


def reconcile(
    inputs: CalculatorInputsV2, schedule: Schedule, model: MonthlyModel,
) -> ReconciliationStatus:
    issues: list[ValidationIssue] = []

    rollforward_ok = True
    never_negative = True
    for mo in model.months:
        if mo.closing_balance_pence != (
            mo.opening_balance_pence + mo.draw_pence + mo.capitalised_fees_pence
            + mo.interest_capitalised_pence - mo.repayment_pence
        ):
            rollforward_ok = False
        if mo.closing_balance_pence < 0:
            never_negative = False

    # Sources = uses, cumulatively, to the penny (spec Sec 7). Spec Sec 7 lists
    # "lender fees" and "interest whether capitalised or serviced" as uses, and
    # "capitalised fees & rolled-up interest (self-funding within the gross
    # facility)" as sources -- i.e. capitalised fees (the arrangement fee) and
    # rolled-up interest each appear once on both sides of the identity (they
    # fund themselves within the facility) rather than cancelling out of the
    # equation entirely. Keeping them explicit on both sides is both the
    # clearest reading and the one that holds to the penny, because the
    # engine's per-month cost-funding loop already guarantees
    # sum(cash uses) + serviced interest == draws + equity + funding gap +
    # additional equity; capitalised fees and rolled interest are additional
    # matched pairs layered on top.
    serviced_interest = sum(m.interest_serviced_pence for m in model.months)
    rolled_interest = sum(m.interest_capitalised_pence for m in model.months)
    capitalised_fees = model.totals.capitalised_fees_pence

    uses_total = (
        sum(m.uses_total_pence for m in model.months)
        + serviced_interest + rolled_interest + capitalised_fees
        + schedule.totals.selling_costs_pence + model.totals.exit_fee_pence
    )
    sources_total = (
        model.totals.equity_contributed_pence + model.totals.additional_equity_pence
        + model.totals.funding_gap_pence  # shown explicitly, never hidden
        + model.totals.draws_pence + capitalised_fees + rolled_interest
        + schedule.totals.selling_costs_pence + model.totals.exit_fee_pence  # proceeds applied at source
    )
    sources_equal_uses = uses_total == sources_total

    facility_within_limit = not any(f.code == "facility_exceeded" for f in model.flags)
    senior_repaid = model.senior_outstanding_at_maturity_pence == 0
    funding_complete = (
        model.totals.funding_gap_pence == 0 and model.totals.additional_equity_pence == 0
    )

    if not sources_equal_uses:
        issues.append(ValidationIssue(severity="error", field="model", message="Sources and uses do not balance."))
    if not rollforward_ok:
        issues.append(ValidationIssue(severity="error", field="model", message="Debt ledger roll-forward mismatch."))
    if not funding_complete:
        issues.append(ValidationIssue(
            severity="error", field="model",
            message="Funding gap or uncommitted equity requirement present.",
        ))
    if not senior_repaid:
        issues.append(ValidationIssue(
            severity="warning", field="model",
            message="Senior debt not repaid within the modelled term.",
        ))

    input_errors = [i for i in validate_inputs(inputs) if i.severity == "error"]
    report_safe = (
        len(input_errors) == 0 and sources_equal_uses and rollforward_ok
        and never_negative and facility_within_limit and funding_complete
        and not inputs.finance.requires_confirmation
    )

    return ReconciliationStatus(
        sources_equal_uses=sources_equal_uses,
        debt_rollforward_ok=rollforward_ok,
        closing_never_negative=never_negative,
        facility_within_limit=facility_within_limit,
        senior_repaid=senior_repaid,
        funding_complete=funding_complete,
        report_safe=report_safe,
        issues=[*input_errors, *issues],
    )
