"""Port of frontend/src/lib/model/validation.ts."""
from __future__ import annotations

import datetime
import math
import re
from dataclasses import dataclass, field
from typing import Callable, get_args

from .acquisition_tax import regime_for, select_band_set
from .areas import area_bridge
from .cost_plan import compute_cost_plan
from .due_diligence import DD_CATEGORIES, DD_STATUSES, DERIVED_CODES, ENTERED_CODES
from .engine import MonthlyModel, pct
from .investment_case import OPEX_CODES, resolve_stabilisation_month
from .lender_valuation import compute_lender_gdv
from .programme import ProgrammeDerivation, derive_phases, is_legacy_programme, is_programme_network
from .schedule import Schedule, unit_ancillary_value_pence
from .types import (
    FEE_CODE_CATEGORY,
    MONITORING_CATEGORIES,
    PRE_COMPLETION_CODES,
    AnyCalculatorInputs,
    PriceBasis,
    QsStage,
    QsStatus,
)
from .vat import VAT_CHARGE_CATEGORIES, is_purchase_vat_chargeable, vat_return_periods

_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

# R15 spec Sec 23.9. The enum tuples rules 7-9 test against, read off the
# schema's own Literal types so a value added there cannot leave the rule
# behind. Mirrors validation.ts, which imports QS_STAGES / QS_STATUSES /
# PRICE_BASIS_VALUES from cost-plan.ts for the same reason. SourceRecord's
# `tenure` Literal is declared inline on the field, so its three values are
# restated here (and in validation.ts) rather than derived.
QS_STAGES: tuple[str, ...] = get_args(QsStage)
QS_STATUSES: tuple[str, ...] = get_args(QsStatus)
PRICE_BASIS_VALUES: tuple[str, ...] = get_args(PriceBasis)
SOURCE_TENURES: tuple[str, ...] = ("freehold", "leasehold", "unknown")


def is_calendar_date(value: str) -> bool:
    r"""ISO-8601 calendar date: right shape AND a date that exists (spec Sec 14).

    R9 Task 12 clears an R8 carry-forward. Until this release both engines checked the
    shape with a bare ``^\d{4}-\d{2}-\d{2}$``, so ``2026-02-31`` validated cleanly and
    was then accepted as ``date_basis: 'transaction_date'`` -- a date the reader would
    take as evidence of when the transaction happened. R8 recorded that as a known
    limitation rather than fixing it; it is fixed here.

    ``datetime.date`` is the calendar, including the leap-year rule, so nothing here
    re-implements it. Mirrors ``isCalendarDate`` in validation.ts, whose Date round-trip
    is written to accept exactly the same set of strings this does (including the
    MINYEAR floor)."""
    m = _ISO_DATE.match(value)
    if m is None:
        return False
    try:
        datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return False
    return True


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

    # R10 spec Sec 16 -- the cost plan. `cost_plan` is read structurally exactly
    # like `areas` above: a pre-v7 document has no cost_plan attribute at all
    # and must not gain errors from a block introduced this release.
    cp = getattr(inputs, "cost_plan", None)
    # R11 Task 9: hoisted out of the `if cp is not None` block below so the VAT
    # warning further down ("registered: false with non-zero construction
    # cost") can read the resolved construction total without recomputing it.
    resolved_cost_plan = None
    # R12 Sec 18.6/18.8: hoisted so the sales_phasing/refinance anchor rules
    # below (which run after the programme block) can resolve start(phase_id)
    # and check anchor existence without re-deriving the network a second
    # time. `network_phase_ids` is populated whenever `programme` is a v9
    # network, regardless of whether it also has structural errors (an anchor
    # can still be checked for existence against the raw id set even when,
    # say, a different phase has a duplicate id). `programme_derivation` is
    # populated ONLY when the network has no structural errors and no cycle --
    # the same gate the window rules use, because a tranche cannot resolve a
    # month from dates that do not exist.
    network_phase_ids: set[str] = set()
    programme_derivation: ProgrammeDerivation | None = None
    if cp is not None:
        if cp.mode == "detailed":
            if len(cp.packages) == 0:
                err("cost_plan.packages", "Detailed mode requires at least one cost package.")
            elif sum(p.amount_pence for p in cp.packages) == 0:
                err(
                    "cost_plan.packages",
                    "Detailed mode packages sum to zero - no construction cost is being priced.",
                )
        if cp.mode == "headline" and len(cp.packages) > 0:
            err("cost_plan.mode", "Headline mode does not use packages - remove them, or switch to detailed mode.")

        for idx, p in enumerate(cp.packages):
            if p.amount_pence < 0:
                err(f"cost_plan.packages[{idx}].amount_pence", "Package amount cannot be negative.")
        for idx, c in enumerate(cp.contingency):
            if c.pct < 0:
                err(f"cost_plan.contingency[{idx}].pct", "Contingency percentage cannot be negative.")

        if len({p.id for p in cp.packages}) != len(cp.packages):
            err("cost_plan.packages", "Package ids must be unique.")
        if len({f.id for f in cp.fee_lines}) != len(cp.fee_lines):
            err("cost_plan.fee_lines", "Fee line ids must be unique.")

        contingency_names = [c.name for c in cp.contingency]
        if len(cp.contingency) != 3 or len(set(contingency_names)) != len(contingency_names):
            err(
                "cost_plan.contingency",
                "A cost plan must have exactly three contingency classes, one per class name, "
                "with no repeats.",
            )

        # R11 ruling R46. Sec 17.8 made the package tag live: in detailed mode,
        # existing_building/abnormal resolve against sum(packages where
        # contingency_class == name), not the whole base build. A document can
        # carry a non-zero percentage on a class no package is tagged with --
        # the calculator renders all three percentages in both modes, and new
        # packages default to contingency_class 'general' -- so the resolved
        # base is silently zero. This is a WARNING, not an error: the rule
        # that used to catch this (a selected-packages contingency naming no
        # packages cannot carry a non-zero percentage) was deleted this
        # release, and an error here would repeat R38's defect -- a stored
        # document already in this state would acquire a hard error on
        # migration, making report_safe false and silently downgrading the
        # report to DRAFT. Reads `cost_plan`, which exists at v7 as well as
        # v8, so this fires identically before and after migration and does
        # not touch the R38/R39 regression gate (which permits exactly one
        # warning addition, on vat.registered).
        if cp.mode == "detailed":
            for idx, c in enumerate(cp.contingency):
                if c.name == "general":
                    continue
                has_tagged_package = any(p.contingency_class == c.name for p in cp.packages)
                if c.pct != 0 and not has_tagged_package:
                    warn(
                        f"cost_plan.contingency[{idx}].pct",
                        f"Contingency class '{c.name}' has a non-zero percentage ({c.pct}%) but "
                        f"no package is tagged '{c.name}' - its resolved base is zero, so this "
                        "contingency will compute to zero.",
                    )

        # Spec Sec 3.2.1: in detailed mode, compliance is priced inside the
        # fire_acoustic_thermal package (compute_cost_plan returns
        # compliance_pence 0 for detailed mode). A document carrying both would
        # double-count that money invisibly, so any non-zero flat compliance
        # figure is a hard error rather than being silently dropped by the
        # engine.
        if cp.mode == "detailed":
            cc = inputs.conversion_costs
            if cc.fire_safety_pence != 0:
                err(
                    "conversion_costs.fire_safety_pence",
                    "Detailed mode prices compliance inside the fire_acoustic_thermal package - "
                    "fire_safety_pence must be zero to avoid double-counting.",
                )
            if cc.sound_insulation_pence != 0:
                err(
                    "conversion_costs.sound_insulation_pence",
                    "Detailed mode prices compliance inside the fire_acoustic_thermal package - "
                    "sound_insulation_pence must be zero to avoid double-counting.",
                )
            if cc.part_l_compliance_pence != 0:
                err(
                    "conversion_costs.part_l_compliance_pence",
                    "Detailed mode prices compliance inside the fire_acoustic_thermal package - "
                    "part_l_compliance_pence must be zero to avoid double-counting.",
                )

        for idx, fl in enumerate(cp.fee_lines):
            if fl.basis == "fixed":
                if fl.pct != 0:
                    err(
                        f"cost_plan.fee_lines[{idx}].pct",
                        "A fixed-basis fee line cannot carry a non-zero percentage.",
                    )
            else:
                if fl.amount_pence != 0:
                    err(
                        f"cost_plan.fee_lines[{idx}].amount_pence",
                        "A percentage-basis fee line cannot carry a non-zero fixed amount.",
                    )
                if fl.per_dwelling:
                    err(
                        f"cost_plan.fee_lines[{idx}].per_dwelling",
                        "per_dwelling only applies to a fixed-basis fee line.",
                    )
            # Spec Sec 3.4: building_control is FIXED as statutory despite sitting
            # in the professional-fee block of ConversionCostInputs. A wrong
            # category moves money between two separately-reported,
            # separately-spread totals while every grand total stays correct --
            # invisible to any totals-based test.
            if fl.code != "other" and fl.category != FEE_CODE_CATEGORY[fl.code]:
                err(
                    f"cost_plan.fee_lines[{idx}].category",
                    f"Fee code '{fl.code}' must be categorised '{FEE_CODE_CATEGORY[fl.code]}'.",
                )

        # Warnings only -- both need the resolved plan (base_build/base per fee
        # line), which is exactly what compute_cost_plan already derives, so it
        # is reused here rather than re-implemented.
        resolved = compute_cost_plan(inputs, bridge.developed_area_sqm, len(inputs.unit_mix.units))
        resolved_cost_plan = resolved
        if resolved.base_build_pence > 0 and resolved.contingency_total_pence > resolved.base_build_pence * 0.5:
            warn(
                "cost_plan.contingency",
                f"Contingency ({resolved.contingency_total_pence} pence) exceeds 50% of the base "
                f"build cost ({resolved.base_build_pence} pence) - check the packages or "
                "percentages.",
            )
        for idx, fee in enumerate(resolved.fees):
            if fee.basis != "fixed" and fee.base_pence == 0:
                warn(
                    f"cost_plan.fee_lines[{idx}].basis",
                    "This fee line resolves against a zero base and will compute to zero.",
                )

    # R11 spec Sec 17.7 / Sec 17.9 (ruling R27). Chargeability is a fact about
    # the VENDOR; recovery is a fact about the BUYER. vat.registered: false is
    # the engine's inert switch and the migration default -- it is NOT a
    # statement that the buyer is unregistered, and it must not be read as one.
    #
    # In the colliding state the model holds that VAT is due while
    # resolve_vat_treatment returns the inert 0% row, so
    # chargeable_consideration_pence collapses back to the exclusive price and
    # the acquisition tax is charged on a base that excludes VAT -- the exact
    # under-report Sec 17.7 exists to remove, in the case where it costs MOST,
    # because a buyer who cannot recover it bears the whole amount.
    #
    # The rejected alternative was sourcing rate_pct independently of
    # registered. Identity-safe, but it makes one field mean two things in two
    # places, and this release exists partly to stop that. Read with getattr,
    # mirroring the TS engine's structural `'vat' in inputs`: a pre-v8 document
    # has no vat block at all.
    vat_inputs = getattr(inputs, "vat", None)
    if (
        vat_inputs is not None
        and not vat_inputs.registered
        and is_purchase_vat_chargeable(vat_inputs.purchase)
    ):
        err(
            "vat.registered",
            "Purchase VAT is chargeable (the vendor has opted to tax and TOGC does not "
            "apply), but the VAT engine is switched off, so the acquisition tax would be "
            "charged on the VAT-exclusive price. Set vat.registered to true and give the "
            "acquisition treatment row the applicable rate. If the buyer cannot recover "
            "that VAT, set recoverable_pct: 0 and recovery_basis: 'blocked' -- that models "
            "the position exactly: VAT charged, none recovered, and the acquisition tax on "
            "the VAT-inclusive consideration.",
        )

    # R11 spec Sec 17.9 (Task 9). Every rule below is specified for a SET of
    # fields -- R10 twice shipped a rule covering three fields with a test
    # named for one, leaving two unguarded while the suite looked complete.
    # Each rule here loops its own field set rather than checking a single
    # representative one. Gated on `vat_inputs is not None` throughout: a
    # pre-v8 document has no vat attribute at all and must produce no VAT
    # issue, full stop.
    if vat_inputs is not None:
        # Single structural read of `treatments`, reused by every check below --
        # none of them resolve a charge or apply the override-over-category
        # precedence (that stays resolve_vat_treatment's alone, spec Sec 17.2).
        # validation.py is allowlisted in VAT_ACCESSOR_ALLOWLIST
        # (tests/test_accessor_guard.py) for exactly this: Python's guard has
        # no line-scoped exemption (unlike eslint-disable-next-line), so this
        # mirrors how the same file is already allowlisted for
        # select_band_set and contingency_pct above.
        treatments = vat_inputs.treatments

        # Fix round 1 (Ruling R35): computed here, ahead of the override loop
        # below, so the zero-rated-sale warning can fire on an OVERRIDE's own
        # recovery_basis in the same pass that already extracts it -- a
        # VatOverride carries its own recovery_basis, so the identical unsafe
        # assumption (full recovery on a zero-rated first grant while
        # retaining a unit for exempt residential letting) is expressible
        # there too, and a scan of `treatments` alone never sees it.
        retains_a_unit = inputs.exit_strategy.route == "retain_all" or (
            inputs.exit_strategy.route == "blended" and len(inputs.exit_strategy.retained_units) > 0
        )

        # Override in headline mode, rate_pct/recoverable_pct bounds, and the
        # zero-rated-sale-with-retained-units warning -- one pass over
        # packages, one over fee lines.
        any_override_non_zero_rate = False
        if cp is not None:
            for idx, p in enumerate(cp.packages):
                override = p.vat_override
                if override is None:
                    continue
                if override.rate_pct != 0:
                    any_override_non_zero_rate = True
                if cp.mode == "headline":
                    err(
                        f"cost_plan.packages[{idx}].vat_override",
                        "A VAT override only applies in detailed mode - headline mode has no "
                        "packages to override. Remove the override, or switch to detailed mode.",
                    )
                if override.rate_pct < 0 or override.rate_pct > 100:
                    err(
                        f"cost_plan.packages[{idx}].vat_override.rate_pct",
                        "VAT override rate must be between 0 and 100%.",
                    )
                if override.recoverable_pct < 0 or override.recoverable_pct > 100:
                    err(
                        f"cost_plan.packages[{idx}].vat_override.recoverable_pct",
                        "VAT override recoverable percentage must be between 0 and 100%.",
                    )
                if retains_a_unit and override.recovery_basis == "zero_rated_sale":
                    warn(
                        f"cost_plan.packages[{idx}].vat_override.recovery_basis",
                        "This override is recovered on the basis of a zero-rated first grant, "
                        "but the exit strategy retains at least one unit. Retained residential "
                        "letting is an exempt supply, so full recovery here is unsafe - check "
                        "whether the recoverable proportion should be restricted.",
                    )
            for idx, fl in enumerate(cp.fee_lines):
                override = fl.vat_override
                if override is None:
                    continue
                if override.rate_pct != 0:
                    any_override_non_zero_rate = True
                if cp.mode == "headline":
                    err(
                        f"cost_plan.fee_lines[{idx}].vat_override",
                        "A VAT override only applies in detailed mode - headline mode has no "
                        "fee lines to override individually. Remove the override, or switch to "
                        "detailed mode.",
                    )
                if override.rate_pct < 0 or override.rate_pct > 100:
                    err(
                        f"cost_plan.fee_lines[{idx}].vat_override.rate_pct",
                        "VAT override rate must be between 0 and 100%.",
                    )
                if override.recoverable_pct < 0 or override.recoverable_pct > 100:
                    err(
                        f"cost_plan.fee_lines[{idx}].vat_override.recoverable_pct",
                        "VAT override recoverable percentage must be between 0 and 100%.",
                    )
                if retains_a_unit and override.recovery_basis == "zero_rated_sale":
                    warn(
                        f"cost_plan.fee_lines[{idx}].vat_override.recovery_basis",
                        "This override is recovered on the basis of a zero-rated first grant, "
                        "but the exit strategy retains at least one unit. Retained residential "
                        "letting is an exempt supply, so full recovery here is unsafe - check "
                        "whether the recoverable proportion should be restricted.",
                    )

        # rate_pct / recoverable_pct out of 0..100 on every treatment row.
        for idx, t in enumerate(treatments):
            if t.rate_pct < 0 or t.rate_pct > 100:
                err(f"vat.treatments[{idx}].rate_pct", "VAT rate must be between 0 and 100%.")
            if t.recoverable_pct < 0 or t.recoverable_pct > 100:
                err(
                    f"vat.treatments[{idx}].recoverable_pct",
                    "Recoverable percentage must be between 0 and 100%.",
                )

        # `treatments` must hold exactly the six VAT_CHARGE_CATEGORIES, once
        # each, in the declared order -- schema, not a user-managed list
        # (spec Sec 17.1).
        categories = [t.category for t in treatments]
        shape_ok = (
            len(categories) == len(VAT_CHARGE_CATEGORIES)
            and all(categories[i] == c for i, c in enumerate(VAT_CHARGE_CATEGORIES))
        )
        if not shape_ok:
            err(
                "vat.treatments",
                "Treatments must be exactly the six VAT charge categories, once each, in "
                f"order: {', '.join(VAT_CHARGE_CATEGORIES)}.",
            )

        # --- The two RETURN-CYCLE bounds. Both gated on `registered` (ruling
        # R38, spec Sec 17.11). A field that parameterises a DORMANT engine is
        # not validated: with `registered: false` no return period is ever
        # computed, so there is no cycle to be out of bounds.
        #
        # This is not a softening. It is the fix for a shipped defect. The
        # migration gives EVERY document a `vat` block carrying
        # `first_period_end_month: 2`, so ungated these rules turned every
        # stored appraisal with `term_months <= 2` into a hard error on
        # migration -- and a hard error makes `report_safe` false, which marks
        # the report DRAFT. An "inert" migration would have silently downgraded
        # every short-term appraisal in the database.
        #
        # The bounds that stay UNCONDITIONAL above are the ones that are
        # nonsense in any state: a negative rate, a negative recoverable
        # proportion, a treatments array that is not the six categories. A
        # document that later registers gets these two errors then, which is
        # the right moment for them.
        if vat_inputs.registered:
            # first_period_end_month must sit inside the modelled term.
            if (
                vat_inputs.first_period_end_month < 0
                or vat_inputs.first_period_end_month >= f.term_months
            ):
                err(
                    "vat.first_period_end_month",
                    f"First period end month must be between 0 and {f.term_months - 1}.",
                )

            # repayment_lag_months: HMRC's payment window, capped at a
            # documented maximum rather than left open-ended.
            if vat_inputs.repayment_lag_months < 0 or vat_inputs.repayment_lag_months > 6:
                err("vat.repayment_lag_months", "Repayment lag must be between 0 and 6 months.")

        # Sec 17.3: where TOGC applies, purchase VAT is nil regardless of the
        # option to tax -- that is the whole effect of a TOGC, and it must not
        # be expressible as "TOGC applies AND the acquisition rate is
        # non-zero".
        acq_idx = next((i for i, t in enumerate(treatments) if t.category == "acquisition"), -1)
        if (
            acq_idx != -1
            and vat_inputs.purchase.togc_treatment == "applies"
            and treatments[acq_idx].rate_pct != 0
        ):
            err(
                f"vat.treatments[{acq_idx}].rate_pct",
                "Where TOGC applies, purchase VAT is nil regardless of the option to tax - "
                "the acquisition treatment row's rate must be 0.",
            )

        # --- Warnings. Each carries real domain content, and each belongs on
        # `run.validation` (this function's return), never on
        # `reconcile().issues` (see the module note above validate_inputs:
        # that channel carries only errors, bar one 'model' warning). ---

        # The zero-rated first grant is what makes input VAT recoverable;
        # retained residential letting is EXEMPT, so full recovery is unsafe.
        # This is the single most likely real-world VAT error the model can
        # catch. (`retains_a_unit` itself is computed above, ahead of the
        # override loop, which also checks a package/fee-line override's own
        # recovery_basis.)
        if retains_a_unit:
            for idx, t in enumerate(treatments):
                if t.recovery_basis == "zero_rated_sale":
                    warn(
                        f"vat.treatments[{idx}].recovery_basis",
                        "This category is recovered on the basis of a zero-rated first grant, "
                        "but the exit strategy retains at least one unit. Retained residential "
                        "letting is an exempt supply, so full recovery here is unsafe - check "
                        "whether the recoverable proportion should be restricted.",
                    )

        # Possible, but then the TOGC changes nothing and the finding is
        # probably mis-entered.
        if vat_inputs.purchase.togc_treatment == "applies" and not vat_inputs.purchase.vendor_opted_to_tax:
            warn(
                "vat.purchase.togc_treatment",
                "TOGC is marked as applying, but the vendor has not opted to tax - TOGC "
                "treatment changes nothing where there is no option to tax to disapply, so "
                "this is probably entered in error.",
            )

        # The engine is inert and the funding need is being reported as zero.
        construction_total = resolved_cost_plan.construction_total_pence if resolved_cost_plan is not None else 0
        if not vat_inputs.registered and construction_total != 0:
            warn(
                "vat.registered",
                "The VAT engine is switched off (vat.registered: false), but this document "
                "has a non-zero construction cost. Input VAT on construction and fees will "
                "be reported as zero throughout, including any that would otherwise be "
                "recoverable.",
            )

        # Ruling R4: derived from vat_return_periods(vat, term_months) -- an
        # INPUT derivation -- never from the RESULT field
        # vat.receivable_at_maturity_pence, which validate_inputs cannot see
        # (it takes inputs only). Gated on a non-zero resolved rate so this
        # cannot fire on a registered document that charges nothing: a
        # zero-rated document has nothing to reclaim, in or out of term.
        any_non_zero_rate = any(t.rate_pct != 0 for t in treatments) or any_override_non_zero_rate
        if vat_inputs.registered and any_non_zero_rate:
            periods = vat_return_periods(vat_inputs, f.term_months)
            final_period = periods[-1] if periods else None
            if final_period is not None and final_period.reclaim_month is None:
                warn(
                    "vat.repayment_lag_months",
                    "The final VAT return period's reclaim falls outside the modelled term "
                    "and will not appear in the cash flow - consider a shorter term, a "
                    "shorter repayment lag, or reporting the balance as a receivable.",
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
    # R12 (spec Sec 18.1): `programme` is a two-state field across the version
    # union -- the legacy `{ packages: {...} }` shape (v4-v8) or a v9
    # precedence network (`{ phases: [...] }`). `is_legacy_programme` narrows
    # to the legacy shape the elif block below validates -- unchanged since
    # R3a; documents at versions 4-8 still use it, and the migration identity
    # gate validates pre-migration v8 documents through it. Mirrors
    # validation.ts's isProgrammeNetwork/isLegacyProgramme dispatch.
    programme = getattr(inputs, "programme", None)
    if programme is not None and is_programme_network(programme):
        # R12 (spec Sec 18.8). Real rules for the v9 precedence network,
        # replacing the Task 4 scaffolding placeholder. Order matters: the
        # id/dependency/scalar rules run FIRST and gate derive_phases -- a
        # network with a dangling reference or a fractional field has already
        # produced its error, and deriving it anyway would report a second,
        # confusing one. A cycle (found only once the gate above is clear)
        # reports ONLY the cycle error and skips every window rule: dates do
        # not exist for a phase inside a cycle.
        net = programme
        term = max(1, math.floor(inputs.finance.term_months))

        def phase_field(id_: str) -> str:
            return f"programme.phases.{id_}"

        if len(net.phases) == 0:
            err("programme.phases", "A programme network must have at least one phase.")

        all_ids = {p.id for p in net.phases}
        network_phase_ids = all_ids
        seen_ids: set[str] = set()
        structural_ok = True

        for p in net.phases:
            field_ = phase_field(p.id)

            if p.id in seen_ids:
                err(field_, f'Duplicate phase id "{p.id}".')
                structural_ok = False
            seen_ids.add(p.id)

            # CRITICAL 1b (textual parity with validation.ts): Phase.duration_months/
            # start_offset/slip_months and Dependency.lag_months are typed `int`
            # in Pydantic, which already rejects a fractional value at parse (a
            # 422, before validate_inputs ever runs) -- these whole-number checks
            # are unreachable in practice but kept so the two engines carry the
            # same rule set and messages, mirroring the legacy arm above.
            if not isinstance(p.duration_months, int):
                err(field_, f"Phase '{p.id}' duration_months must be a whole number of months.")
                structural_ok = False
            elif p.duration_months < 0:
                err(field_, f"Phase '{p.id}' duration_months cannot be negative.")
                structural_ok = False

            if not isinstance(p.start_offset, int):
                err(field_, f"Phase '{p.id}' start_offset must be a whole number of months.")
                structural_ok = False
            elif p.start_offset < 0:
                err(field_, f"Phase '{p.id}' start_offset cannot be negative.")
                structural_ok = False

            # Sec 18.2: slip_months is SIGNED (a negative slip is legal
            # acceleration) but must still be a whole number.
            if not isinstance(p.slip_months, int):
                err(field_, f"Phase '{p.id}' slip_months must be a whole number of months.")
                structural_ok = False

            for d in p.predecessors:
                if d.phase_id == p.id:
                    err(field_, f"Phase '{p.id}' cannot depend on itself.")
                    structural_ok = False
                elif d.phase_id not in all_ids:
                    err(
                        field_,
                        f"Phase '{p.id}' has a dependency on \"{d.phase_id}\", but there is no "
                        f"phase with id \"{d.phase_id}\".",
                    )
                    structural_ok = False
                if not isinstance(d.lag_months, int):
                    err(
                        field_,
                        f"Phase '{p.id}' has a dependency on \"{d.phase_id}\" whose lag_months "
                        "must be a whole number of months.",
                    )
                    structural_ok = False
                elif d.lag_months < 0:
                    err(
                        field_,
                        f"Phase '{p.id}' has a dependency on \"{d.phase_id}\" whose lag_months "
                        "cannot be negative.",
                    )
                    structural_ok = False

            # Sec 6.1's four user_defined rules, unchanged, now evaluated per phase.
            if p.curve.kind == "user_defined":
                w = p.curve.weights
                if len(w) != p.duration_months:
                    err(field_, "user_defined weights must have one entry per window month.")
                if any(not math.isfinite(x) for x in w):
                    err(field_, "user_defined weights must be finite numbers.")
                if any(x < 0 for x in w):
                    err(field_, "user_defined weights cannot be negative.")
                if sum(w) <= 0:
                    err(field_, "user_defined weights must sum to more than zero.")

        # Sec 18.5: category_phase_ids is required whenever `programme` is a
        # network, and must name a real, non-milestone phase -- a milestone
        # occupies no month and cannot carry spend.
        milestone_ids = {p.id for p in net.phases if p.duration_months == 0}
        for cat in ("construction", "professional", "statutory"):
            id_ = getattr(net.category_phase_ids, cat)
            field_ = f"programme.category_phase_ids.{cat}"
            if id_ not in all_ids:
                err(
                    field_,
                    f"category_phase_ids.{cat} references phase \"{id_}\", but there is no "
                    f"phase with id \"{id_}\".",
                )
            elif id_ in milestone_ids:
                err(
                    field_,
                    f"category_phase_ids.{cat} references phase \"{id_}\", which is a milestone "
                    "and cannot carry spend.",
                )

        # Sec 18.5: a detailed-mode line's `phase_id` override is the same
        # rule -- absent phase or milestone -- applied to the cost side of the
        # resolution. Read through `cp`, computed above; this does not need
        # derive_phases either, only the phase catalogue.
        if cp is not None:
            for idx, p in enumerate(cp.packages):
                if p.phase_id is None:
                    continue
                field_ = f"cost_plan.packages[{idx}].phase_id"
                if p.phase_id not in all_ids:
                    err(
                        field_,
                        f"Cost package '{p.id}' is tagged to phase \"{p.phase_id}\", but there "
                        f"is no phase with id \"{p.phase_id}\".",
                    )
                elif p.phase_id in milestone_ids:
                    err(
                        field_,
                        f"Cost package '{p.id}' is tagged to phase \"{p.phase_id}\", which is a "
                        "milestone and cannot carry spend.",
                    )
            for idx, fl in enumerate(cp.fee_lines):
                if fl.phase_id is None:
                    continue
                field_ = f"cost_plan.fee_lines[{idx}].phase_id"
                if fl.phase_id not in all_ids:
                    err(
                        field_,
                        f"Fee line '{fl.id}' is tagged to phase \"{fl.phase_id}\", but there is "
                        f"no phase with id \"{fl.phase_id}\".",
                    )
                elif fl.phase_id in milestone_ids:
                    err(
                        field_,
                        f"Fee line '{fl.id}' is tagged to phase \"{fl.phase_id}\", which is a "
                        "milestone and cannot carry spend.",
                    )

        if structural_ok:
            derivation = derive_phases(net)
            if derivation.cycle is not None:
                # Sec 18.1: a cycle has no topological order and no defensible
                # default start for a phase inside it -- a hard error naming
                # the cycle in order, not a generic "invalid programme".
                err("programme.phases", f"Phase dependency cycle: {' → '.join(derivation.cycle)}.")
            else:
                programme_derivation = derivation
                global_finish = derivation.finish_month

                for dp in derivation.phases:
                    field_ = phase_field(dp.id)
                    is_milestone = dp.duration_months == 0

                    # Sec 18.1/18.8: over-acceleration below month 0 is a hard
                    # error naming the phase -- never silently clamped (the R5
                    # defect).
                    if dp.start_month < 0:
                        err(
                            field_,
                            f"Phase '{dp.id}' resolves to start month {dp.start_month}, before "
                            "month 0 (over-acceleration).",
                        )

                    # Overrun -- ALL phases. The first clause ("Programme
                    # finishes month N") is a fact about the whole programme,
                    # so it always quotes the GLOBAL finish; the second clause
                    # names THIS phase, so its overrun quantity must be THIS
                    # phase's own -- fix round 1, Finding 1: a non-terminal
                    # breaching phase (finish(p) > term but finish(p) <
                    # global_finish) previously had the global overrun
                    # (belonging to whichever phase sets global_finish)
                    # spliced into its own sentence, which understates or
                    # overstates its true lateness whenever it is not the
                    # phase defining the programme's end.
                    overrun_breach = dp.start_month > term - 1 if is_milestone else dp.finish_month > term
                    if overrun_breach:
                        own_overrun = (dp.start_month - (term - 1)) if is_milestone else (dp.finish_month - term)
                        err(
                            field_,
                            f"Programme finishes month {global_finish}; facility term is {term}. "
                            f"Phase '{dp.label}' ends {own_overrun} months after maturity.",
                        )

                    # Sale tail -- the PRE-COMPLETION codes only (spec Sec
                    # 6.1's existing rule and message, unchanged, so the
                    # v8->v9 migration-identity alias holds on message as well
                    # as field). `other` gets only the weaker overrun rule
                    # above.
                    if dp.code in PRE_COMPLETION_CODES:
                        tail_breach = dp.start_month > term - 2 if is_milestone else dp.finish_month > term - 1
                        if tail_breach:
                            err(
                                field_,
                                f"Package must finish by month {term - 2} — the final two months "
                                "are the sale tail (spec §6).",
                            )
    elif programme is not None and is_legacy_programme(programme):
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
                    f"Package must finish by month {term - 2} — the final two months are the "
                    "sale tail (spec §6).",
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

        # R12 spec Sec 18.6: `anchor` only exists on a v9 tranche;
        # getattr(tr, "anchor", None) reads it structurally, mirroring this
        # module's other version-dispatch checks (see the `getattr(inputs,
        # "vat", None)` guard above). Returns None when the month cannot be
        # resolved -- an anchor naming an absent phase (own error, reported
        # separately below) or a network that failed to derive (structural
        # error or cycle, own error, reported above) -- so the ordering check
        # does not manufacture a second, confusing error on top of the first.
        def resolved_tranche_month(tr: object) -> int | None:
            anchor = getattr(tr, "anchor", None)
            if anchor is None:
                return tr.month_offset  # type: ignore[attr-defined]
            if programme_derivation is None:
                return None
            dp = programme_derivation.by_id.get(anchor.phase_id)
            return dp.start_month + anchor.offset_months if dp is not None else None

        for i, tr in enumerate(trs):
            field_ = f"sales_phasing.tranches[{i}]"
            if not isinstance(tr.month_offset, int) or tr.month_offset < 0 or tr.month_offset > term - 1:
                err(field_, f"Tranche month must be a whole month between 0 and {term - 1}.")
            if not math.isfinite(tr.pct_of_gross_receipts) or tr.pct_of_gross_receipts <= 0:
                err(field_, "Tranche percentage must be a finite number greater than zero.")
            anchor = getattr(tr, "anchor", None)
            if anchor is not None and anchor.phase_id not in network_phase_ids:
                err(
                    f"{field_}.anchor",
                    f"Tranche anchor references phase \"{anchor.phase_id}\", but there is no "
                    f"phase with id \"{anchor.phase_id}\".",
                )
            # Sec 18.6/18.8: the resolved months, not the entered ones -- an
            # anchor on a phase that later slips can cross a neighbouring
            # tranche even though the two month_offsets (or anchors) were
            # entered in order.
            if i > 0:
                prev_month = resolved_tranche_month(trs[i - 1])
                cur_month = resolved_tranche_month(tr)
                if prev_month is not None and cur_month is not None and not (cur_month > prev_month):
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
        # R13 spec Sec 19.7 rule 5 owns investment_value_pence/ltv_pct in full,
        # below, in the investment-case block (it needs `investment_case` in
        # scope, which this block does not have). The range check that used to
        # sit here (against the generic 'refinance' field) MOVED under the
        # specific field names, alongside the presence/absence checks it adds
        # -- not duplicated here, which is what would leave two overlapping
        # checks on one field. Mirrors validation.ts's identical move (see its
        # comment at the same point in its refinance block).
        if not math.isfinite(rf.arrangement_fee_pence) or rf.arrangement_fee_pence < 0:
            err("refinance", "Refinance arrangement fee must be zero or more.")
        if not math.isfinite(rf.legal_costs_pence) or rf.legal_costs_pence < 0:
            err("refinance", "Refinance legal costs must be zero or more.")
        # R12 spec Sec 18.6: `anchor` only exists on a v9 refinance block.
        rf_anchor = getattr(rf, "anchor", None)
        if rf_anchor is not None and rf_anchor.phase_id not in network_phase_ids:
            err(
                "refinance.anchor",
                f"Refinance anchor references phase \"{rf_anchor.phase_id}\", but there is no "
                f"phase with id \"{rf_anchor.phase_id}\".",
            )

    # R13b spec Sec 22.7. The per-unit sales ledger. Structurally read, like
    # every post-v2 block: a v2-v11 document has no attribute and stays inert.
    unit_sales = getattr(inputs, "unit_sales", None)
    sales_phasing_block = getattr(inputs, "sales_phasing", None)
    if unit_sales is not None and sales_phasing_block is not None:
        # Rule 1 -- on BOTH fields (Sec 16.1's exclusion shape).
        # R15 Task 6: the three Sec 22.7 messages below carry validation.ts's
        # em-dash verbatim. They were written here with an ASCII " - " in R13b,
        # which the drift guard could not see until its window was widened onto
        # this block; the TS text is the one the reader has been served, so
        # Python is the side that moves. Message TEXT only -- no rule changed.
        msg = "Per-unit sales and phased sales cannot both be set — remove one."
        err("unit_sales", msg)
        err("sales_phasing", msg)
    if unit_sales is not None:
        term = max(1, math.floor(inputs.finance.term_months))
        route = inputs.exit_strategy.route
        if route == "retain_all":
            err(
                "unit_sales",
                "Per-unit sales apply to the sold portion — a retain-all exit has none. "
                "Remove the block or change the exit route.",
            )
        if unit_sales.deposit_release not in ("held_to_completion", "released_on_exchange"):
            err("unit_sales.deposit_release", "deposit_release must be held_to_completion or released_on_exchange.")

        all_ids = [u.id for u in inputs.unit_mix.units]
        retained_ids = {r.unit_id for r in inputs.exit_strategy.retained_units}
        sold_ids = [] if route == "retain_all" else [
            u.id for u in inputs.unit_mix.units if route == "sell_all" or u.id not in retained_ids
        ]
        # Rule 3, both directions, four messages.
        seen: set[str] = set()
        for i, row in enumerate(unit_sales.units):
            field_ = f"unit_sales.units[{i}]"
            if row.unit_id in seen:
                err(field_, f"Unit \"{row.unit_id}\" has more than one sale row.")
            seen.add(row.unit_id)
            if row.unit_id not in all_ids:
                err(field_, f"Sale row unit \"{row.unit_id}\" does not exist in the unit mix.")
            elif row.unit_id not in sold_ids and route != "retain_all":
                err(field_, f"Unit \"{row.unit_id}\" is retained and cannot carry a sale row.")
        for uid in sold_ids:
            if uid not in seen:
                err("unit_sales", f"Sold unit \"{uid}\" has no sale row.")

        # Rule 9.
        sold_gross_total = sum(
            u.estimated_value_pence + unit_ancillary_value_pence(u)
            for u in inputs.unit_mix.units if u.id in sold_ids
        )
        if route != "retain_all" and sold_gross_total <= 0:
            err("unit_sales", "Per-unit sales need a sold portion with value above zero.")

        def resolved_event_month(ev: object) -> int | None:
            anchor = getattr(ev, "anchor", None)
            if anchor is None:
                return ev.month_offset  # type: ignore[attr-defined]
            if programme_derivation is None:
                return None
            dp = programme_derivation.by_id.get(anchor.phase_id)
            return dp.start_month + anchor.offset_months if dp is not None else None

        def check_event(ev: object, field_: str, label: str) -> int | None:
            # Rule 4: the entered month, the anchor, and the RESOLVED month.
            if not isinstance(ev.month_offset, int) or ev.month_offset < 0 or ev.month_offset > term - 1:  # type: ignore[attr-defined]
                err(field_, f"{label} month must be a whole month between 0 and {term - 1}.")
            anchor = getattr(ev, "anchor", None)
            if anchor is not None:
                if not network_phase_ids:
                    err(field_, f"{label} anchor needs a programme network.")
                elif anchor.phase_id not in network_phase_ids:
                    err(
                        f"{field_}.anchor",
                        f"{label} anchor references phase \"{anchor.phase_id}\", but there is no "
                        f"phase with id \"{anchor.phase_id}\".",
                    )
            m = resolved_event_month(ev)
            if m is not None and anchor is not None and (m < 0 or m > term - 1):
                err(field_, f"{label} resolves to month {m}, outside 0 to {term - 1}.")
            return m

        for i, row in enumerate(unit_sales.units):
            field_ = f"unit_sales.units[{i}]"
            completion_m = check_event(row.completion, f"{field_}.completion", "Completion")
            exchange_m = None if row.exchange is None else check_event(row.exchange, f"{field_}.exchange", "Exchange")
            # Rule 5.
            if exchange_m is not None and completion_m is not None and exchange_m > completion_m:
                err(f"{field_}.exchange",
                    f"Exchange must not fall after completion (resolved months {exchange_m} > {completion_m}).")
            # Rule 6.
            if not math.isfinite(row.deposit_pct) or row.deposit_pct < 0 or row.deposit_pct > 100:
                err(f"{field_}.deposit_pct", "Deposit percentage must be a finite number between 0 and 100.")
            elif row.exchange is None and row.deposit_pct != 0:
                err(f"{field_}.deposit_pct", "A deposit needs an exchange event — set exchange or set deposit_pct to 0.")
            # Rule 7.
            if row.agent_fee_pct is not None and (
                not math.isfinite(row.agent_fee_pct) or row.agent_fee_pct < 0 or row.agent_fee_pct >= 100
            ):
                err(f"{field_}.agent_fee_pct", "Agent fee override must be a finite percentage from 0 to below 100.")
            if row.legal_fee_pence is not None and (not isinstance(row.legal_fee_pence, int) or row.legal_fee_pence < 0):
                err(f"{field_}.legal_fee_pence", "Legal fee override must be a whole number of pence, zero or more.")

    # R13 spec Sec 19.7. Gated on presence, not on `inputs_version >= 10`,
    # matching every other block here: a v9 document has no `investment_case`
    # attribute, so the whole block is skipped without a version test.
    ic = getattr(inputs, "investment_case", None)
    refi = getattr(inputs, "refinance", None)

    # Rule 12 first: it applies whenever `refinance` is non-null, whether or
    # not there is an investment case, so it must not sit inside the `ic is
    # not None` arm.
    if refi is not None and hasattr(refi, "arrangement_fee_pct"):
        p = refi.arrangement_fee_pct
        if not math.isfinite(p) or p < 0 or p > 100:
            err(
                "refinance.arrangement_fee_pct",
                "Refinance arrangement fee percentage must be between 0 and 100.",
            )

    if ic is None:
        # Rule 5, the other arm -- a refinance with no investment case must
        # carry the explicit pair, or it has no quantum at all. Also carries
        # the range check that used to live on the generic 'refinance' field
        # above (see that block's comment) -- now under this rule's own
        # specific field names. The v4 refinance suite's negative/out-of-range
        # assertions still need this, so it is moved here, not dropped.
        if refi is not None and hasattr(refi, "investment_value_pence"):
            if refi.investment_value_pence is None:
                err(
                    "refinance.investment_value_pence",
                    "Refinance investment value is required when there is no investment case.",
                )
            elif not math.isfinite(refi.investment_value_pence) or refi.investment_value_pence < 0:
                err("refinance.investment_value_pence", "Refinance investment value must be zero or more.")
            if refi.ltv_pct is None:
                err(
                    "refinance.ltv_pct",
                    "Refinance LTV is required when there is no investment case.",
                )
            elif not math.isfinite(refi.ltv_pct) or refi.ltv_pct <= 0 or refi.ltv_pct > 100:
                err("refinance.ltv_pct", "Refinance LTV must be greater than 0 and at most 100.")
    else:
        st = ic.stabilisation
        term = max(1, math.floor(inputs.finance.term_months))
        route = inputs.exit_strategy.route
        rents = inputs.exit_strategy.retained_units
        unit_ids = {u.id for u in inputs.unit_mix.units}

        # Rule 1
        if route == "sell_all":
            err(
                "investment_case",
                "An investment case requires retained units — a sell-all exit retains none.",
            )

        # Rule 2 -- the silent-understatement trap of Sec 19.2. For
        # `retain_all` EVERY unit is retained but only listed units carry a
        # rent, so a short list understates NOI, the value and the take-out
        # with no error anywhere.
        if route == "retain_all":
            rented = {r.unit_id for r in rents}
            missing = [u for u in inputs.unit_mix.units if u.id not in rented]
            if len(missing) > 0:
                n = len(missing)
                err(
                    "exit_strategy.retained_units",
                    "A retain-all investment case needs a rent for every unit; "
                    f"{n} unit{'' if n == 1 else 's'} {'has' if n == 1 else 'have'} none.",
                )

        # Rule 3
        for r in rents:
            if r.unit_id not in unit_ids:
                err(
                    "exit_strategy.retained_units",
                    f"Retained unit \"{r.unit_id}\" does not exist in the unit mix.",
                )

        # Rule 4
        if sum(r.monthly_rent_pence for r in rents) <= 0:
            err("exit_strategy.retained_units", "An investment case needs a rent roll greater than zero.")

        # Rule 5 -- supersession is an ERROR, never a silent override (Sec 2).
        if refi is not None and hasattr(refi, "investment_value_pence"):
            if refi.investment_value_pence is not None:
                err(
                    "refinance.investment_value_pence",
                    "Remove the explicit refinance investment value — the investment case "
                    "derives it.",
                )
            if refi.ltv_pct is not None:
                err(
                    "refinance.ltv_pct",
                    "Remove the explicit refinance LTV — the investment case take-out supplies "
                    "the cap.",
                )

        # Rule 6 -- reuses Sec 18.8's anchor rule rather than restating it.
        if st.anchor is not None:
            net = programme if programme is not None and is_programme_network(programme) else None
            if net is None:
                err(
                    "investment_case.stabilisation.anchor",
                    "A stabilisation anchor needs a programme network to anchor to.",
                )
            elif not any(p.id == st.anchor.phase_id for p in net.phases):
                err(
                    "investment_case.stabilisation.anchor",
                    f"Stabilisation is anchored to phase \"{st.anchor.phase_id}\", which does "
                    "not exist.",
                )

        # Rule 7 -- a hard error on Sec 18.8's reasoning: income that never
        # starts inside the term books zero NOI silently.
        resolved = resolve_stabilisation_month(inputs, st)
        if not float(resolved).is_integer() or resolved < 0 or resolved > term - 1:
            err(
                "investment_case.stabilisation.month_offset",
                "Stabilisation must start within the facility term (month 0 to "
                f"{term - 1}); it resolves to month {resolved}.",
            )

        # Rule 8
        if (
            not math.isfinite(st.stabilised_occupancy_pct)
            or st.stabilised_occupancy_pct <= 0
            or st.stabilised_occupancy_pct > 100
        ):
            err(
                "investment_case.stabilisation.stabilised_occupancy_pct",
                "Stabilised occupancy must be greater than 0% and at most 100%.",
            )
        if not float(st.ramp_months).is_integer() or st.ramp_months < 0:
            err(
                "investment_case.stabilisation.ramp_months",
                "The stabilisation ramp must be a whole number of months, zero or more.",
            )

        # Rule 9
        if not math.isfinite(ic.valuation.cap_yield_pct) or ic.valuation.cap_yield_pct <= 0:
            err(
                "investment_case.valuation.cap_yield_pct",
                "The capitalisation yield must be greater than zero.",
            )
        if not math.isfinite(ic.valuation.purchasers_costs_pct) or ic.valuation.purchasers_costs_pct < 0:
            err("investment_case.valuation.purchasers_costs_pct", "Purchaser's costs cannot be negative.")

        # Rule 10
        t = ic.takeout
        if not math.isfinite(t.ltv_cap_pct) or t.ltv_cap_pct <= 0 or t.ltv_cap_pct > 100:
            err(
                "investment_case.takeout.ltv_cap_pct",
                "The take-out LTV cap must be greater than 0% and at most 100%.",
            )
        if not math.isfinite(t.dscr_floor) or t.dscr_floor <= 0:
            err("investment_case.takeout.dscr_floor", "The DSCR floor must be greater than zero.")
        if not math.isfinite(t.icr_floor) or t.icr_floor <= 0:
            err("investment_case.takeout.icr_floor", "The ICR floor must be greater than zero.")
        if not math.isfinite(t.annual_rate_pct) or t.annual_rate_pct < 0:
            err("investment_case.takeout.annual_rate_pct", "The take-out interest rate cannot be negative.")
        if t.amortisation_years is not None and (
            not math.isfinite(t.amortisation_years) or t.amortisation_years <= 0
        ):
            err(
                "investment_case.takeout.amortisation_years",
                "The amortisation period must be greater than zero, or empty for an "
                "interest-only take-out.",
            )
        if not math.isfinite(t.term_years) or t.term_years <= 0:
            err("investment_case.takeout.term_years", "The take-out term must be greater than zero.")

        # Rule 11 -- an EMPTY schedule is legal: NOI is then gross rent.
        # R13 fix-wave Minor 6. seen.add(line.id) used to run unconditionally,
        # including on the blank-id branch -- so a SECOND blank-id line raised
        # both "Every operating line needs an id" and a spurious
        # `Duplicate operating line id ""`, because the first blank id had
        # already been added to `seen`. Only a genuinely non-empty, non-seen
        # id gets added.
        seen: set[str] = set()
        for line in ic.operating_lines:
            if line.id.strip() == "":
                err("investment_case.operating_lines", "Every operating line needs an id.")
            elif line.id in seen:
                err("investment_case.operating_lines", f"Duplicate operating line id \"{line.id}\".")
            else:
                seen.add(line.id)
            if line.code not in OPEX_CODES:
                err(
                    f"investment_case.operating_lines.{line.id}.code",
                    f"\"{line.code}\" is not a recognised operating cost code.",
                )
            if not math.isfinite(line.value) or line.value < 0:
                err(
                    f"investment_case.operating_lines.{line.id}.value",
                    "An operating line value cannot be negative.",
                )
            elif line.basis == "pct_of_gross_rent" and line.value > 100:
                err(
                    f"investment_case.operating_lines.{line.id}.value",
                    "A percentage operating line cannot exceed 100% of gross rent.",
                )

    validate_due_diligence(inputs, issues)

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
            # R9 Task 12: shape AND calendar validity (see is_calendar_date above).
            # The shape-only regex this replaces let "2026-02-31" through, and
            # select_band_set compares dates lexicographically rather than parsing
            # them, so the appraisal then reported date_basis 'transaction_date' on a
            # date that does not exist. Mirrors validation.ts.
            if not is_calendar_date(acq.acquisition_date):
                err(
                    "acquisition.acquisition_date",
                    "Acquisition date must be a real ISO calendar date (YYYY-MM-DD).",
                )
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

    # R12 spec Sec 18.8/18.9: a scenario's phase_slip_phase_id needs a real
    # target. Scenarios carries the field on every document version (v2-v9),
    # so a document with no v9 network at all can still have it set -- that
    # must not be a silent no-op (the lever would look live while doing
    # nothing), so it is a hard error naming the scenario rather than a rule
    # scoped only to v9 documents. `has_network` is true only for a v9
    # document whose `programme` is an actual precedence network -- a legacy
    # `{ packages }` programme has no phase to slip either.
    has_network = programme is not None and is_programme_network(programme)
    for name in ("base", "upside", "downside", "severe"):
        scenario = getattr(inputs.scenarios, name)
        # R13b spec Sec 22.7 (slip rule). Structurally unreachable in Python --
        # `sales_slip_months: int` is a Pydantic field, so a fractional value
        # never survives parsing to reach this check. Kept anyway (not
        # deleted as dead code) so the two engines' rule lists match line for
        # line -- validateInputs's TS twin CAN reach this branch (a JSON
        # payload with 1.5 parses as a plain object with no int coercion),
        # and a rule present in one engine but not the other is exactly the
        # kind of silent asymmetry this release's dual-engine mirror rule
        # exists to prevent. The `is not None` guard is likewise dead here
        # (a Pydantic-parsed scenario always has a value) but is kept so this
        # check's body is textually identical to validation.ts's -- see that
        # file's comment on the guard for why TS actually needs it.
        if scenario.sales_slip_months is not None and not isinstance(scenario.sales_slip_months, int):
            err(
                f"scenarios.{name}.sales_slip_months",
                "Sales slip must be a whole number of months.",
            )
        if scenario.phase_slip_phase_id is None:
            continue
        field_ = f"scenarios.{name}.phase_slip_phase_id"
        if not has_network:
            err(
                field_,
                f"Scenario '{name}' sets phase_slip_phase_id, but this document has no "
                "programme network to slip a phase within.",
            )
        elif scenario.phase_slip_phase_id not in network_phase_ids:
            err(
                field_,
                f"Scenario '{name}' phase_slip_phase_id references phase "
                f"\"{scenario.phase_slip_phase_id}\", but there is no phase with id "
                f"\"{scenario.phase_slip_phase_id}\".",
            )

    validate_monitoring(inputs, issues)

    return issues


def _is_unreal_date(value: str | None) -> bool:
    """R15 spec Sec 23.9 rule 5. True when a date is PRESENT and is not a real
    calendar date. Absent (None) and blank-after-trim are both absence, not a
    malformed date -- rule 2 owns the missing-evidence case, and no other rule
    requires an expiry or a due date to be there at all. Mirrors the
    `isUnrealDate` helper in validation.ts."""
    return value is not None and value.strip() != "" and not is_calendar_date(value)


def validate_due_diligence(inputs: AnyCalculatorInputs, issues: list[ValidationIssue]) -> None:
    """R15 spec Sec 23.9 -- the due-diligence schedule's INPUT-only rules, plus
    the two cost-plan provenance rules (Sec 23.6) that arrived with it. The
    four result-derived flags (``due_diligence_unknown``, ``source_conflict``,
    ``consent_expires_before_start``, ``provisional_sums_present``) are the
    derivation's own -- they need the computed schedule, which this function
    (inputs only) cannot see, so they are raised as FlagCodes in metrics, not
    here.

    Read structurally, exactly like ``validate_monitoring`` above: a pre-v13
    document has no ``due_diligence`` attribute at all, no ``cost_plan.qs``
    and no ``price_basis``, so it raises nothing. Mirrors validation.ts's
    ``validateDueDiligence``.

    Several rules below guard a field Pydantic ALREADY constrains, so in this
    engine they are structurally unreachable: rule 0's ``status`` and rule
    1f's ``category`` are ``Literal``s, rule 6's two impacts are ``int`` with
    ``ge=0``, and rule 7's/8's/9's numeric and enum arms are likewise
    constrained -- a stray value is a 422 at parse time and never reaches
    here. They are kept, not deleted as dead code, for the reason the Sec 22.7
    sales-slip rule is kept (see its comment in validate_inputs): validation.ts
    CAN reach every one of these branches (a JSON payload arrives uncoerced),
    and a rule present in one engine but not the other is exactly the silent
    asymmetry this release's dual-engine mirror exists to prevent."""

    def err(field_: str, message: str) -> None:
        issues.append(ValidationIssue(severity="error", field=field_, message=message))

    dd = getattr(inputs, "due_diligence", None)
    if dd is not None:
        # Rule 1a -- the catalogue is complete. `custom` is not a catalogue
        # code and is never required.
        present = {item.code for item in dd.items}
        for code in ENTERED_CODES:
            if code not in present:
                err(
                    "due_diligence",
                    f"Due diligence item \"{code}\" is missing - every catalogue item "
                    "must be present.",
                )

        seen_codes: set[str] = set()
        seen_ids: set[str] = set()
        for i, item in enumerate(dd.items):
            field_ = f"due_diligence.items[{i}]"

            # Rule 1g.
            if item.id in seen_ids:
                err(f"{field_}.id", f"Due diligence item id \"{item.id}\" is not unique.")
            seen_ids.add(item.id)

            # Rules 1b-1e, one chain because the arms are mutually exclusive.
            # `custom` is the ONE repeatable code: it names no catalogue entry,
            # so a document carrying two user-added items is normal and must
            # not read as a duplicate -- which is why the 1b check sits on the
            # catalogue-code arm rather than above the chain.
            if item.code in DERIVED_CODES:
                err(
                    f"{field_}.code",
                    f"Due diligence item \"{item.code}\" is derived from the model and "
                    "cannot be entered.",
                )
            elif item.code == "custom":
                if item.label.strip() == "":
                    err(f"{field_}.label", "A custom due diligence item needs a label.")
            elif item.code not in ENTERED_CODES:
                err(f"{field_}.code", f"Due diligence item code \"{item.code}\" is not in the catalogue.")
            elif item.code in seen_codes:
                err(f"{field_}.code", f"Due diligence item \"{item.code}\" appears more than once.")
            seen_codes.add(item.code)

            # Rule 1f, then rule 0 (both Literal-guarded here -- see docstring).
            if item.category not in DD_CATEGORIES:
                err(
                    f"{field_}.category",
                    "Due diligence category must be one of planning, title_occupation, "
                    "existing_building, construction, finance, exit.",
                )
            if item.status not in DD_STATUSES:
                err(
                    f"{field_}.status",
                    "Due diligence status must be one of red, amber, green, unknown, "
                    "not_applicable.",
                )

            # Rules 2-4: what a status owes. Sec 23.1's `unknown` owes nothing.
            evidence = item.evidence
            if item.status == "green" and (
                evidence is None or evidence.source.strip() == "" or evidence.date.strip() == ""
            ):
                err(f"{field_}.evidence", "A green status needs evidence: record the source and the date.")
            if item.status in ("red", "amber") and item.action.strip() == "":
                err(f"{field_}.action", "A red or amber status needs an action.")
            if item.status == "not_applicable" and item.notes.strip() == "":
                err(f"{field_}.notes", "A not-applicable status needs a reason in notes.")

            # Rule 5 -- see _is_unreal_date above for what "present" means.
            if _is_unreal_date(None if evidence is None else evidence.date):
                err(
                    f"{field_}.evidence.date",
                    "Evidence date must be a real calendar date in yyyy-mm-dd form.",
                )
            if _is_unreal_date(item.expiry_date):
                err(f"{field_}.expiry_date", "Expiry date must be a real calendar date in yyyy-mm-dd form.")
            if _is_unreal_date(item.due_date):
                err(f"{field_}.due_date", "Due date must be a real calendar date in yyyy-mm-dd form.")

            # Rule 6 (Pydantic-guarded here -- see docstring).
            if item.cost_impact_pence is not None and (
                not isinstance(item.cost_impact_pence, int) or item.cost_impact_pence < 0
            ):
                err(f"{field_}.cost_impact_pence", "Cost impact must be a whole number of pence, zero or more.")
            if item.programme_impact_months is not None and (
                not isinstance(item.programme_impact_months, int) or item.programme_impact_months < 0
            ):
                err(
                    f"{field_}.programme_impact_months",
                    "Programme impact must be a whole number of months, zero or more.",
                )

        # Rule 7 -- the captured listing record (Sec 23.5). Only `captured_at`
        # is reachable in this engine; the other three arms are Pydantic-guarded.
        record = dd.source_record
        if record is not None:
            if record.captured_at.strip() == "":
                err(
                    "due_diligence.source_record.captured_at",
                    "The captured listing record needs a captured_at timestamp.",
                )
            if record.floor_area_sqm is not None and (
                not math.isfinite(record.floor_area_sqm) or record.floor_area_sqm < 0
            ):
                err("due_diligence.source_record.floor_area_sqm", "Listing floor area must be zero or more.")
            if record.lease_years_remaining is not None and (
                not isinstance(record.lease_years_remaining, int) or record.lease_years_remaining < 0
            ):
                err(
                    "due_diligence.source_record.lease_years_remaining",
                    "Listing lease years remaining must be a whole number, zero or more.",
                )
            if record.tenure is not None and record.tenure not in SOURCE_TENURES:
                err("due_diligence.source_record.tenure", "Listing tenure must be freehold, leasehold or unknown.")

    # Rules 8 and 9 -- Sec 23.6's cost-plan provenance. Read structurally: a
    # pre-v13 document has neither attribute, and a migrated v13 document
    # carries `qs: None` and `price_basis: None` on every package.
    plan = getattr(inputs, "cost_plan", None)
    if plan is not None:
        qs = getattr(plan, "qs", None)
        if qs is not None:
            if plan.mode != "detailed":
                err(
                    "cost_plan.qs",
                    "QS provenance applies to a detailed cost plan only - switch to detailed "
                    "mode or remove it.",
                )
            if qs.source.strip() == "":
                err("cost_plan.qs.source", "QS provenance needs a source.")
            if qs.stage not in QS_STAGES:
                err(
                    "cost_plan.qs.stage",
                    "QS stage must be one of order_of_cost, riba_2, riba_3, riba_4, tender, "
                    "contract_sum.",
                )
            if qs.status not in QS_STATUSES:
                err("cost_plan.qs.status", "QS status must be one of draft, issued, reviewed.")
            if _is_unreal_date(qs.date):
                err("cost_plan.qs.date", "QS date must be a real calendar date in yyyy-mm-dd form.")
            if _is_unreal_date(qs.base_date):
                err("cost_plan.qs.base_date", "QS base date must be a real calendar date in yyyy-mm-dd form.")

        for i, package in enumerate(plan.packages):
            basis = getattr(package, "price_basis", None)
            if basis is not None and basis not in PRICE_BASIS_VALUES:
                err(
                    f"cost_plan.packages[{i}].price_basis",
                    "Package price basis must be fixed_price, provisional_sum, estimate or unset.",
                )


def validate_monitoring(inputs: AnyCalculatorInputs, issues: list[ValidationIssue]) -> None:
    """R14 spec Sec 20.3 -- the monitoring statement's INPUT-only rules. The
    three result-derived flags (``monitoring_shortfall``,
    ``monitoring_cost_variance``, ``monitoring_dated_after_redemption``) are
    Task 9's own -- they need the computed statement, which this function
    (inputs only) cannot see, so they are raised as FlagCodes in metrics, not
    here. Read structurally, exactly like ``investment_case``/
    ``lender_valuation`` above: a pre-v11 document has no ``monitoring``
    attribute at all, and a v11 document with ``monitoring: None`` (every
    migrated document) adds no issue either. Mirrors validation.ts's
    ``validateMonitoring``."""
    monitoring = getattr(inputs, "monitoring", None)
    if monitoring is None:
        return

    def err(field_: str, message: str) -> None:
        issues.append(ValidationIssue(severity="error", field=field_, message=message))

    def warn(field_: str, message: str) -> None:
        issues.append(ValidationIssue(severity="warning", field=field_, message=message))

    term = max(1, math.floor(inputs.finance.term_months))
    if (
        not float(monitoring.reporting_month).is_integer()
        or monitoring.reporting_month < 1
        or monitoring.reporting_month > term
    ):
        err(
            "monitoring.reporting_month",
            f"reporting_month must be between 1 and the term ({term})",
        )

    # Exactly one line per category, any order, no duplicates (spec Sec 20.1).
    # A category set of size 5 that contains all five required categories can
    # only BE those five categories, so this also catches an unrecognised
    # category value without a separate membership check.
    categories = [line.category for line in monitoring.lines]
    category_set = set(categories)
    valid_shape = (
        len(categories) == len(MONITORING_CATEGORIES)
        and len(category_set) == len(MONITORING_CATEGORIES)
        and all(c in category_set for c in MONITORING_CATEGORIES)
    )
    if not valid_shape:
        err(
            "monitoring.lines",
            "monitoring must carry exactly one line per category (acquisition, construction, "
            "professional, statutory, contingency)",
        )

    for i, line in enumerate(monitoring.lines):
        if line.paid_to_date_pence > line.certified_to_date_pence:
            err(f"monitoring.lines[{i}].paid_to_date_pence", "paid to date cannot exceed certified to date")
        if line.certified_to_date_pence > line.committed_to_date_pence:
            err(
                f"monitoring.lines[{i}].certified_to_date_pence",
                "certified to date cannot exceed committed to date",
            )

    committed_net = (
        0 if inputs.finance.funding_source == "cash"
        else (inputs.finance.committed_net_facility_pence or 0)
    )
    if monitoring.debt_drawn_to_date_pence > committed_net:
        err(
            "monitoring.debt_drawn_to_date_pence",
            "debt drawn to date cannot exceed the committed net facility",
        )

    # Spec Sec 5.10's cash-classified, non-rejected filter -- the same one
    # cost_to_complete.py and engine.py already carry under this comment --
    # restated here because validate_monitoring has no access to either
    # module's computed total (inputs only).
    cash_equity_total = sum(
        s.amount_pence for s in inputs.equity_sources
        if s.classification == "cash" and s.evidence_status != "rejected"
    )
    if monitoring.cash_equity_injected_to_date_pence > cash_equity_total:
        # Spec Sec 20.3: "not an error -- the audit's 'additional equity
        # injected' case; it is a warning."
        warn("monitoring.cash_equity_injected_to_date_pence", "equity injected beyond committed sources")


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
    #
    # R11 spec Sec 17.6: the VAT reclaim is the THIRD such exclusion, on the same terms.
    # This function needs no structural change for VAT. The VAT outflow enters
    # uses_total_pence (engine.py adds uses[m].vat_pence to cash_uses) and is funded
    # through the existing per-month loop by draws, equity or a visible gap; the reclaim
    # repays, exactly as sale proceeds do. So, like sale-proceeds repayments and
    # refinance-shortfall equity, model.totals.vat_reclaim_pence appears on NEITHER
    # side. Over the term sources therefore fund the GROSS VAT outflow even though most
    # of it returns -- which is correct, and is the treatment sale proceeds already get.
    #
    # R13 spec Sec 19.5: a negative-NOI month's shortfall equity is the FOURTH such
    # exclusion, on the same terms as the refinance-shortfall slice above -- it funds
    # an operating loss, not a project cost, so operating_shortfall_equity_pence is
    # excluded here too. Without this, a document with any negative-NOI month would
    # fail sources_equal_uses: the shortfall counts in full toward
    # additional_equity_pence (correctly -- see that field's own doc comment) but has
    # no matching entry on the uses side, since NOI never enters uses_total_pence.
    sources_total = (
        model.totals.equity_contributed_pence
        + (
            model.totals.additional_equity_pence
            - model.totals.refinance_shortfall_equity_pence
            - model.totals.operating_shortfall_equity_pence
        )
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
