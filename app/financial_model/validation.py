"""Port of frontend/src/lib/model/validation.ts."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Callable

from .acquisition_tax import regime_for, select_band_set
from .areas import area_bridge
from .engine import MonthlyModel, pct
from .lender_valuation import compute_lender_gdv
from .schedule import Schedule
from .types import AnyCalculatorInputs

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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


NON_NEGATIVE_MONEY: list[tuple[str, Callable[[AnyCalculatorInputs], float]]] = [
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


def validate_inputs(inputs: AnyCalculatorInputs) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    def err(field_: str, message: str) -> None:
        issues.append(ValidationIssue(severity="error", field=field_, message=message))

    def warn(field_: str, message: str) -> None:
        issues.append(ValidationIssue(severity="warning", field=field_, message=message))

    # R9 spec Sec 15.6 -- the area bridge, computed once and reused below.
    # `areas` is None for a pre-v6 document (no `areas` attribute at all), read
    # structurally exactly like this module's other version-dispatch checks
    # (see the `getattr(inputs, "lender_valuation", None)` guard further down).
    bridge = area_bridge(inputs)
    areas = getattr(inputs, "areas", None)

    for field_name, get in NON_NEGATIVE_MONEY:
        if get(inputs) < 0:
            err(field_name, "Monetary values cannot be negative.")
    # Task-8 review correction: developed_area_sqm is the DERIVED cost area
    # under the bridge basis, so a negative value there is already reported by
    # the three derived-negative rules below against the field that actually
    # caused it. Reporting it again here, against a manual field the
    # bridge-basis user cannot even see, is gated out -- this check is the
    # manual basis's own negative-input guard (and the legacy pre-v6 guard,
    # where there is no `areas` attribute to have a basis at all).
    if (areas is None or areas.basis == "manual") and bridge.developed_area_sqm < 0:
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

    # R9 spec Sec 15.6 -- the area bridge. This block REPLACES the +/-25%
    # unit-NIA vs construction-area warning that stood here until R9. That
    # warning was a proxy for a reconciliation the schema could not express;
    # now that it can, the proxy is deleted rather than kept alongside -- a
    # retired message left in place is a second, quieter source of truth.
    if areas is not None:
        for field_name, value in (
            ("existing_gia_sqm", areas.existing_gia_sqm),
            ("demolished_gia_sqm", areas.demolished_gia_sqm),
            ("extension_gia_sqm", areas.extension_gia_sqm),
            ("retained_commercial_gia_sqm", areas.retained_commercial_gia_sqm),
            ("untouched_gia_sqm", areas.untouched_gia_sqm),
            ("circulation_common_sqm", areas.circulation_common_sqm),
            ("plant_riser_sqm", areas.plant_riser_sqm),
            ("store_bin_cycle_sqm", areas.store_bin_cycle_sqm),
            ("amenity_sqm", areas.amenity_sqm),
            ("external_amenity_sqm", areas.external_amenity_sqm),
        ):
            if value < 0:
                err(f"areas.{field_name}", "Area cannot be negative.")

        if bridge.proposed_gia_sqm < 0:
            err(
                "areas.demolished_gia_sqm",
                f"Demolished area ({areas.demolished_gia_sqm} m2) exceeds the existing building "
                f"({areas.existing_gia_sqm} m2) - proposed GIA cannot be negative.",
            )
        if bridge.developed_gia_sqm < 0:
            err(
                "areas.retained_commercial_gia_sqm",
                "Retained commercial and untouched area together exceed proposed GIA "
                f"({bridge.proposed_gia_sqm} m2) - developed area cannot be negative.",
            )
        if bridge.available_for_units_sqm < 0:
            err(
                "areas.circulation_common_sqm",
                "Circulation, plant, storage and amenity together exceed the developed area "
                f"({bridge.developed_gia_sqm} m2) - no space remains for units.",
            )
        if areas.basis == "bridge_derived" and bridge.developed_gia_sqm <= 0:
            err(
                "areas.existing_gia_sqm",
                "The bridge-derived cost basis is selected but the bridge produces no developed "
                "area - enter the building's existing GIA, or switch the basis to manual.",
            )
        # Guarded on a positive developed area for the same reason the two
        # warnings below are: a zeroed bridge (basis manual, nothing entered --
        # exactly what migration writes for every pre-R9 document) means the
        # bridge is not in use at all, so a real unit schedule must not be
        # judged against a "0 m2 building" nobody is reconciling against.
        if bridge.developed_gia_sqm > 0 and bridge.unallocated_sqm < 0:
            err(
                "unit_mix.units",
                f"Unit NIA ({bridge.unit_nia_sqm} m2) exceeds the area available for units "
                f"({bridge.available_for_units_sqm} m2) - the schedule does not fit the building.",
            )

        # Warnings only. An unallocated balance is frequently and legitimately
        # unknown at appraisal stage, so it never gates the document (spec Sec 15.7).
        if bridge.developed_gia_sqm > 0 and bridge.unallocated_sqm > bridge.developed_gia_sqm * 0.10:
            warn(
                "areas.unallocated_sqm",
                f"{bridge.unallocated_sqm} m2 of the developed area is unallocated "
                f"({pct(bridge.unallocated_sqm, bridge.developed_gia_sqm)}%) - the bridge does "
                "not yet tie.",
            )
        if bridge.nia_to_gia_pct is not None and (bridge.nia_to_gia_pct < 65 or bridge.nia_to_gia_pct > 90):
            warn(
                "areas.nia_to_gia_pct",
                f"Net-to-gross efficiency of {bridge.nia_to_gia_pct}% is outside the 65-90% "
                "range typical of a conversion - check the area basis.",
            )
        if areas.basis == "manual" and bridge.developed_gia_sqm > 0:
            manual = bridge.manual_area_sqm
            diff = abs(manual - bridge.developed_gia_sqm)
            if diff > bridge.developed_gia_sqm * 0.05:
                warn(
                    "areas.basis",
                    f"The manual construction area ({manual} m2) differs from the bridge's "
                    f"developed area ({bridge.developed_gia_sqm} m2) by more than 5% - one of "
                    "them is wrong, or the manual basis needs a reason.",
                )

    if inputs.exit_strategy.route == "blended" and len(inputs.exit_strategy.retained_units) == 0:
        warn("exit_strategy.retained_units", "Blended exit selected but no units are marked as retained.")
    if f.requires_confirmation:
        warn("finance", "Facility terms were migrated from a legacy appraisal and require confirmation.")

    # Lender-underwritten GDV (spec Sec 3.2, Release 2b Task 3). Only present on
    # v3/v4 inputs; v2 callers have no lender_valuation field at all and skip this
    # block entirely. `getattr(..., None)` is this module's one version-dispatch
    # idiom (see the programme/sales_phasing/refinance checks below) and is the
    # closest Python analogue of validation.ts's structural `'x' in inputs` test:
    # it keys on the field actually being there rather than on a class identity
    # that a future input version might not inherit.
    lv = getattr(inputs, "lender_valuation", None)
    if lv is not None:
        if lv.reason.strip() == "":
            err("lender_valuation.reason", "Lender valuation reason is required.")
        if lv.author.strip() == "":
            err("lender_valuation.author", "Lender valuation author is required.")
        if lv.date.strip() == "":
            err("lender_valuation.date", "Lender valuation date is required.")

        # Task-1-review addition: pence-valued bases must be whole, non-negative
        # pence (global_pct/unit_type adjustments are percentages and may be
        # fractional/negative).
        if lv.basis in ("global_per_sqft", "fixed_amount") and lv.global_value is not None:
            if not float(lv.global_value).is_integer() or lv.global_value < 0:
                err(
                    "lender_valuation.global_value",
                    "Lender valuation global_value must be a non-negative whole number of "
                    "pence for this basis.",
                )
        if lv.basis == "per_unit" and lv.per_key_values is not None:
            for id_, value in lv.per_key_values.items():
                if not float(value).is_integer() or value < 0:
                    err(
                        f"lender_valuation.per_key_values[{id_}]",
                        "Lender valuation per_key_values value must be a non-negative whole "
                        "number of pence for this basis.",
                    )

        # Every other hard error (missing global_value, missing per_unit id, a
        # computed/absolute unit value that isn't positive) is compute_lender_gdv's
        # own domain -- catching its raised message here keeps the wording
        # identical to what the compute path enforces instead of a second,
        # driftable copy of the same logic.
        try:
            compute_lender_gdv(inputs)
        except ValueError as exc:
            err("lender_valuation", str(exc))

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

    # Spec Sec 6 (Release 3a): explicit programme windows must sit inside
    # [0, term-2] -- the schedule's programme arm only clamps the upper bound,
    # so a negative start_offset or an oversized window must be caught here as
    # a hard error.
    programme = getattr(inputs, "programme", None)
    if programme is not None:
        term = max(1, math.floor(inputs.finance.term_months))
        # validation.ts walks `Object.entries(inputs.programme.packages)`;
        # ProgrammePackages is a Pydantic model rather than a plain map, so the
        # same three names are walked explicitly, in declaration order.
        packages = [
            ("construction", programme.packages.construction),
            ("professional", programme.packages.professional),
            ("statutory", programme.packages.statutory),
        ]
        for name, pkg in packages:
            field_ = f"programme.packages.{name}"
            if pkg.duration_months < 1:
                err(field_, "Package duration must be at least 1 month.")
            if pkg.start_offset < 0:
                err(field_, "Package start month cannot be negative.")
            # CRITICAL 1b (textual parity with validation.ts): Pydantic's `int`
            # typing on ProgrammePackage.start_offset/duration_months already
            # rejects a fractional value at parse (a 422, before validate_inputs
            # ever runs) -- these checks are unreachable in practice but kept so
            # the two engines carry the same rule set and messages.
            if not isinstance(pkg.duration_months, int):
                err(field_, "Package duration must be a whole number of months.")
            if not isinstance(pkg.start_offset, int):
                err(field_, "Package start month must be a whole month.")
            if pkg.start_offset + pkg.duration_months - 1 > term - 2:
                err(
                    field_,
                    f"Package must finish by month {term - 2} - the final two months are the "
                    "sale tail (spec Sec 6).",
                )
            if pkg.curve.kind == "user_defined":
                w = pkg.curve.weights
                if len(w) != pkg.duration_months:
                    err(field_, "user_defined weights must have one entry per window month.")
                # Finiteness must be checked explicitly: NaN passes every other rule
                # here (NaN < 0 is False, and a sum containing NaN is never <= 0) and
                # then reaches build_schedule, which raises `ValueError: cannot convert
                # float NaN to integer` -- a 500. json.loads accepts literal
                # NaN/Infinity, so this is reachable straight off the wire.
                if any(not math.isfinite(x) for x in w):
                    err(field_, "user_defined weights must be finite numbers.")
                if any(x < 0 for x in w):
                    err(field_, "user_defined weights cannot be negative.")
                if sum(w) <= 0:
                    err(field_, "user_defined weights must sum to more than zero.")

    # Spec Sec 4.4.1 (calc 2.3.0, Release 3b): phased sales tranches. `sales_phasing`
    # only exists on v4 inputs; the `getattr(..., None)` guard keeps this block inert
    # for v2/v3 callers exactly as before.
    sales_phasing = getattr(inputs, "sales_phasing", None)
    if sales_phasing is not None:
        term = max(1, math.floor(inputs.finance.term_months))
        trs = sales_phasing.tranches
        if inputs.exit_strategy.route == "retain_all":
            err(
                "sales_phasing",
                "Phased sales apply to the sold portion - a retain-all exit has none. "
                "Remove the block or change the exit route.",
            )
        if len(trs) == 0:
            err("sales_phasing", "Phased sales need at least one tranche.")
        for i, tr in enumerate(trs):
            field_ = f"sales_phasing.tranches[{i}]"
            if not isinstance(tr.month_offset, int) or tr.month_offset < 0 or tr.month_offset > term - 1:
                err(field_, f"Tranche month must be a whole month between 0 and {term - 1}.")
            if not math.isfinite(tr.pct_of_gross_receipts) or tr.pct_of_gross_receipts <= 0:
                err(field_, "Tranche percentage must be a finite number greater than zero.")
            if i > 0 and not (tr.month_offset > trs[i - 1].month_offset):
                err(field_, "Tranche months must be strictly increasing.")
        pct_sum = sum(tr.pct_of_gross_receipts for tr in trs)
        if len(trs) > 0 and not (abs(pct_sum - 100) <= 1e-9):
            err("sales_phasing", f"Tranche percentages must sum to 100 (currently {pct_sum}).")

    # Spec Sec 4.5 (calc 2.3.0, Release 3b): the refinance event.
    refinance = getattr(inputs, "refinance", None)
    if refinance is not None:
        term = max(1, math.floor(inputs.finance.term_months))
        rf = refinance
        if inputs.exit_strategy.route == "sell_all":
            err(
                "refinance",
                "Refinance applies to the retained portion - a sell-all exit retains "
                "nothing. Remove the block or change the exit route.",
            )
        if not isinstance(rf.month_offset, int) or rf.month_offset < 0 or rf.month_offset > term - 1:
            err("refinance", f"Refinance month must be a whole month between 0 and {term - 1}.")
        if not math.isfinite(rf.investment_value_pence) or rf.investment_value_pence < 0:
            err("refinance", "Refinance investment value must be zero or more.")
        if not math.isfinite(rf.ltv_pct) or rf.ltv_pct <= 0 or rf.ltv_pct > 100:
            err("refinance", "Refinance LTV must be greater than 0 and at most 100.")
        if not math.isfinite(rf.arrangement_fee_pence) or rf.arrangement_fee_pence < 0:
            err("refinance", "Refinance arrangement fee must be zero or more.")
        if not math.isfinite(rf.legal_costs_pence) or rf.legal_costs_pence < 0:
            err("refinance", "Refinance legal costs must be zero or more.")

    # R8 (spec Sec 14). Mirrors validation.ts's `'jurisdiction' in inputs.acquisition`
    # guard: v2-v4 documents carry none of these fields via getattr(..., None) and
    # must not be reported as failing rules that did not exist when they were saved.
    jurisdiction = getattr(inputs.acquisition, "jurisdiction", None)
    if jurisdiction is not None:
        acq = inputs.acquisition

        if acq.acquisition_tax_override_pence is not None and acq.acquisition_tax_override_reason.strip() == "":
            err(
                "acquisition.acquisition_tax_override_reason",
                "An acquisition tax override must state why the band calculation does not "
                "apply (for example a relief or a linked transaction).",
            )

        if acq.acquisition_date is not None:
            # Known limitation, mirrored exactly from validation.ts: this checks
            # shape only, not calendar validity, and select_band_set compares
            # dates lexicographically rather than parsing them -- so a string
            # like "2026-02-31" passes here and is accepted as date_basis
            # 'transaction_date'. `<input type="date">` cannot produce such a
            # value, so this is reachable only via the API, and the effect is
            # cosmetic (band selection is still monotonic in the lexicographic
            # ordering). Not tightened here: adding a calendar check would be a
            # behaviour change, which this comment deliberately is not.
            if not _ISO_DATE.match(acq.acquisition_date):
                err("acquisition.acquisition_date", "Acquisition date must be an ISO date (YYYY-MM-DD).")
            else:
                try:
                    select_band_set(acq.jurisdiction, "non_residential", acq.acquisition_date)
                except ValueError as exc:
                    err("acquisition.acquisition_date", str(exc))

        if acq.jurisdiction_evidence_status == "unconfirmed":
            warn(
                "acquisition.jurisdiction_evidence_status",
                "The tax jurisdiction has not been confirmed. Acquisition tax is computed "
                f"on {regime_for(acq.jurisdiction)} and the report will remain a draft until "
                "it is confirmed.",
            )

    return issues


def reconcile(
    inputs: AnyCalculatorInputs, schedule: Schedule, model: MonthlyModel,
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
    # Spec Sec 4.5/Sec 7: additional equity absorbed by the refinance event's shortfall or
    # negative-net-proceeds branches funds a facility redemption -- a financing-side flow,
    # not a project cost -- so it is excluded here exactly like sale-proceeds repayments
    # (net_receipts/repayment_pence never appear on either side of this identity either).
    # It still counts in full toward additional_equity_pence itself, the
    # additional_equity_required flag, equity contributed, and the equity cash-flow vector.
    sources_total = (
        model.totals.equity_contributed_pence
        + (model.totals.additional_equity_pence - model.totals.refinance_shortfall_equity_pence)
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
