"""Port of frontend/src/lib/model/schedule.ts, plus the cost-helper functions it
imports from frontend/src/lib/conversion-calc-engine.ts (calculateGdv,
calculateTotalAcquisitionCost, calculateTotalConstructionCost;
calculateTotalProfessionalFees is also ported here so migrate.py can share it,
mirroring the TS module that houses all four)."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .areas import developed_area_sqm
from .cost_plan import compute_cost_plan
from .curves import spread_by_curve
from .engine import money_round
from .acquisition_tax import calculate_acquisition_tax, resolve_acquisition_date
from .types import (
    AcquisitionInputs,
    AcquisitionInputsV5,
    AnyCalculatorInputs,
    ConversionCostInputs,
    ProgrammePackage,
    ProposedUnit,
)


def unit_ancillary_value_pence(u: ProposedUnit) -> int:
    """R9 spec Sec 15.5 -- a unit's ancillary value. A pre-v6 unit carries no
    ``ancillary`` attribute at all, read structurally with getattr (matching
    areas.py's version-dispatch idiom) and resolving to zero."""
    anc = getattr(u, "ancillary", None)
    if anc is None:
        return 0
    return anc.parking_value_pence + anc.balcony_terrace_value_pence


@dataclass(frozen=True)
class GdvBreakdown:
    # Internal saleable unit values -- the pre-R9 figure, unchanged.
    internal_pence: int
    # Parking plus balcony/terrace. Reported separately, never folded into
    # internal saleable value (spec Sec 3.1, which this release rewrites).
    ancillary_pence: int
    total_pence: int


def calculate_gdv_breakdown(units: list[ProposedUnit]) -> GdvBreakdown:
    internal = sum(u.estimated_value_pence for u in units)
    ancillary = sum(unit_ancillary_value_pence(u) for u in units)
    return GdvBreakdown(internal_pence=internal, ancillary_pence=ancillary, total_pence=internal + ancillary)


def calculate_gdv(units: list[ProposedUnit]) -> int:
    """Total developer GDV. Retained as the total so every existing caller is
    unaffected by the R9 split; use calculate_gdv_breakdown where the parts
    matter."""
    return calculate_gdv_breakdown(units).total_pence


def calculate_total_acquisition_cost(acq: AcquisitionInputs) -> int:
    """Spec Sec 3.3 -- the acquisition line of the cost stack, acquisition tax
    included.

    R8 (spec Sec 14): the tax is the document's own regime, not England/NI's.
    This is the *second* site that computes acquisition tax -- derive_metrics is
    the other, and the two must always agree, because acquisition_cost_pence
    (this figure) flows into TDC while acquisition_tax_pence (that one) is what
    the report names. Both fixture suites and test_financial_model_metrics.py
    pin their equality.

    ``acq`` is annotated with the base class, which AcquisitionInputsV5
    subclasses; the isinstance gate is Python's stand-in for the TS engine's
    ``'jurisdiction' in acq`` guard (the same pairing derive_metrics uses). A
    v2-v4 acquisition block carries none of the new fields, so it resolves to
    england_ni with a null date and no override -- byte-for-byte what
    calculate_commercial_sdlt returned before R8 deleted it.
    """
    is_v5 = isinstance(acq, AcquisitionInputsV5)
    jurisdiction = acq.jurisdiction if is_v5 else "england_ni"
    raw_date = acq.acquisition_date if is_v5 else None
    # Fix round 1 (R8): build_schedule runs before validate_inputs in
    # run_appraisal, so an unusable date must degrade rather than raise here --
    # see resolve_acquisition_date's docstring. validate_inputs re-derives this
    # as a hard acquisition.acquisition_date error independently, and
    # derive_metrics degrades identically so the two tax sites cannot drift.
    date = resolve_acquisition_date(jurisdiction, "non_residential", raw_date)
    sdlt = calculate_acquisition_tax(
        consideration_pence=acq.purchase_price_pence,
        jurisdiction=jurisdiction,
        basis="non_residential",
        date=date,
        override_pence=acq.acquisition_tax_override_pence if is_v5 else None,
        override_reason=acq.acquisition_tax_override_reason if is_v5 else None,
    ).total_pence
    broker_fee = money_round((acq.purchase_price_pence * acq.broker_fee_pct) / 100)
    return (
        acq.purchase_price_pence + sdlt + acq.legal_fees_pence + acq.survey_cost_pence
        + broker_fee + acq.other_acquisition_costs_pence
    )


def calculate_total_construction_cost(costs: ConversionCostInputs, area_sqm: float) -> int:
    # Spec Sec 1.1: fractional-area products round once, at source, in one step
    # before contingency -- base = money_round(construction_cost_per_sqm_pence x
    # area). Integer-sqm inputs are unaffected. Matches conversion-calc-engine.ts.
    #
    # R9: the area is an explicit parameter. Callers resolve it once through
    # developed_area_sqm (spec Sec 15.4); tests/test_accessor_guard.py makes
    # reading the raw field here a test failure.
    base_cost = money_round(costs.construction_cost_per_sqm_pence * area_sqm)
    contingency = money_round((base_cost * costs.contingency_pct) / 100)
    compliance = costs.fire_safety_pence + costs.sound_insulation_pence + costs.part_l_compliance_pence
    return base_cost + contingency + compliance


def calculate_total_professional_fees(costs: ConversionCostInputs, unit_count: int = 1) -> int:
    return (
        costs.prior_approval_fee_per_dwelling_pence * max(1, unit_count)
        + costs.cil_s106_pence + costs.architect_pence + costs.structural_engineer_pence
        + costs.mande_pence + costs.planning_consultant_pence + costs.building_control_pence
        + costs.other_professional_fees_pence
    )


@dataclass
class MonthUses:
    acquisition_pence: int
    construction_pence: int
    professional_pence: int
    statutory_pence: int
    lender_ancillary_fees_pence: int


@dataclass
class MonthReceipts:
    gross_sale_pence: int
    agent_fee_pence: int
    selling_legal_pence: int


@dataclass
class ScheduleTotals:
    acquisition_pence: int
    construction_pence: int
    professional_pence: int
    statutory_pence: int
    selling_costs_pence: int
    gross_sales_pence: int
    gdv_pence: int
    retained_value_pence: int
    cost_before_finance_ex_selling_pence: int


@dataclass
class ScheduleRefinance:
    month: int
    net_proceeds_pence: int


@dataclass
class Schedule:
    term_months: int
    uses: list[MonthUses]
    receipts: list[MonthReceipts]
    totals: ScheduleTotals
    # Spec Sec 4.5 net refinance proceeds -- wired into the ledger in engine.py.
    # None when `refinance` inputs are None (the migration default; byte-identical
    # to calc 2.2.0). Defaulted so pre-existing direct-construction call sites
    # (tests) do not need to change.
    refinance: ScheduleRefinance | None = None


def spread_straight_line(total: int, months: int) -> list[int]:
    """Straight-line spread in integer pence; the final month absorbs the
    rounding residue."""
    if months <= 0:
        return []
    per = money_round(total / months)
    out = [per] * months
    out[months - 1] = total - per * (months - 1)
    return out


def _empty_uses() -> MonthUses:
    return MonthUses(
        acquisition_pence=0, construction_pence=0, professional_pence=0,
        statutory_pence=0, lender_ancillary_fees_pence=0,
    )


def _empty_receipts() -> MonthReceipts:
    return MonthReceipts(gross_sale_pence=0, agent_fee_pence=0, selling_legal_pence=0)


def build_schedule(inputs: AnyCalculatorInputs) -> Schedule:
    term = max(1, math.floor(inputs.finance.term_months))
    units = inputs.unit_mix.units

    acquisition_total = calculate_total_acquisition_cost(inputs.acquisition)
    # R10 spec Sec 16. The cost stack is computed once, by the one engine that
    # serves both modes, and this is the only place the schedule learns the
    # three totals.
    cost_plan = compute_cost_plan(inputs, developed_area_sqm(inputs), len(units))
    construction_total = cost_plan.construction_total_pence
    professional_total = cost_plan.professional_total_pence
    # Sec 3.4: prior approval lands in month 0; every other statutory line
    # spreads with the professional curve. Keyed on the fee CODE, preserving
    # the pre-R10 split that was keyed on a hard-coded field name. R12
    # generalises fee timing.
    prior_approval = sum(f.amount_pence for f in cost_plan.fees if f.code == "prior_approval")
    statutory_spread_total = cost_plan.statutory_total_pence - prior_approval
    statutory_total = cost_plan.statutory_total_pence

    uses = [_empty_uses() for _ in range(term)]
    receipts = [_empty_receipts() for _ in range(term)]

    uses[0].acquisition_pence = acquisition_total
    uses[0].statutory_pence += prior_approval

    programme = getattr(inputs, "programme", None)

    if programme is None:
        # auto windows -- calc 2.1.0 behaviour, byte-identical (spec Sec 6)
        if term == 1:
            uses[0].construction_pence = construction_total
            uses[0].professional_pence = professional_total
            uses[0].statutory_pence += statutory_spread_total
        else:
            construction_window = max(1, term - 2)  # months 1..construction_window
            professional_window = max(1, math.ceil(construction_window / 2))
            construction_spread = spread_straight_line(construction_total, construction_window)
            professional_spread = spread_straight_line(professional_total, professional_window)
            statutory_spread = spread_straight_line(statutory_spread_total, professional_window)
            for i, v in enumerate(construction_spread):
                uses[min(i + 1, term - 1)].construction_pence += v
            for i, v in enumerate(professional_spread):
                uses[min(i + 1, term - 1)].professional_pence += v
            for i, v in enumerate(statutory_spread):
                uses[min(i + 1, term - 1)].statutory_pence += v
    else:
        # explicit programme (spec Sec 6.1); windows validated in validation.py --
        # the upper clamp is belt-and-braces, mirroring the auto path.
        #
        # The lower `max(..., 0)` has no counterpart in schedule.ts, and is a
        # deliberate language difference rather than a rule difference: JS
        # `uses[-1]` is `undefined` and throws loudly on the very next property
        # access, whereas Python's negative indexing would silently wrap to the
        # END of the list and book the spend in the wrong month. validation.py
        # hard-rejects `start_offset < 0`, so this is unreachable for any
        # document that passes validation; it exists so the unvalidated path
        # degrades to a defined, in-range placement (totals still reconcile)
        # instead of a silently wrong one.
        def place(pkg: ProgrammePackage, total: int, field_name: str) -> None:
            for i, v in enumerate(spread_by_curve(total, pkg.duration_months, pkg.curve)):
                target = uses[min(max(pkg.start_offset + i, 0), term - 1)]
                setattr(target, field_name, getattr(target, field_name) + v)

        place(programme.packages.construction, construction_total, "construction_pence")
        place(programme.packages.professional, professional_total, "professional_pence")
        place(programme.packages.statutory, statutory_spread_total, "statutory_pence")

    # Exit: which units sell?
    route = inputs.exit_strategy.route
    retained_ids = {r.unit_id for r in inputs.exit_strategy.retained_units}
    if route == "retain_all":
        sold_units: list[ProposedUnit] = []
    elif route == "sell_all":
        sold_units = list(units)
    else:
        sold_units = [u for u in units if u.id not in retained_ids]
    # R9 spec Sec 15.5: ancillary sells with its unit. Summing internal value
    # alone here would make GDV and gross receipts disagree by the ancillary
    # total.
    gross_sales = sum(u.estimated_value_pence + unit_ancillary_value_pence(u) for u in sold_units)
    gdv = calculate_gdv(units)
    retained_value = gdv - gross_sales

    agent_fee = money_round((gross_sales * inputs.exit_strategy.selling_agent_fee_pct) / 100)
    selling_legal = inputs.exit_strategy.selling_legal_fee_pence if len(sold_units) > 0 else 0
    sales_phasing = getattr(inputs, "sales_phasing", None)
    if gross_sales > 0:
        if sales_phasing is None:
            # calc 2.2.0 behaviour, byte-identical: single disposal in the final
            # month (spec Sec 4.4).
            receipts[term - 1] = MonthReceipts(
                gross_sale_pence=gross_sales, agent_fee_pence=agent_fee,
                selling_legal_pence=selling_legal,
            )
        else:
            # Spec Sec 4.4.1: tranche split with final-tranche residue absorption;
            # selling costs apportioned pro-rata by tranche gross, final tranche
            # absorbs. Month clamps are belt-and-braces -- validation.py owns the
            # real rules.
            trs = sales_phasing.tranches
            gross_allocated = 0
            agent_allocated = 0
            legal_allocated = 0
            for i, tr in enumerate(trs):
                last = i == len(trs) - 1
                gross = (
                    gross_sales - gross_allocated if last
                    else money_round((gross_sales * tr.pct_of_gross_receipts) / 100)
                )
                agent = (
                    agent_fee - agent_allocated if last
                    else money_round((agent_fee * gross) / gross_sales)
                )
                legal = (
                    selling_legal - legal_allocated if last
                    else money_round((selling_legal * gross) / gross_sales)
                )
                gross_allocated += gross
                agent_allocated += agent
                legal_allocated += legal
                m = min(max(0, math.floor(tr.month_offset)), term - 1)
                receipts[m].gross_sale_pence += gross
                receipts[m].agent_fee_pence += agent
                receipts[m].selling_legal_pence += legal

    # Spec Sec 4.5 net refinance proceeds -- wired into the ledger by engine.py.
    refinance_input = getattr(inputs, "refinance", None)
    refinance = None
    if refinance_input is not None:
        refinance = ScheduleRefinance(
            month=min(max(0, math.floor(refinance_input.month_offset)), term - 1),
            net_proceeds_pence=(
                money_round((refinance_input.investment_value_pence * refinance_input.ltv_pct) / 100)
                - refinance_input.arrangement_fee_pence - refinance_input.legal_costs_pence
            ),
        )

    selling_costs = agent_fee + selling_legal if gross_sales > 0 else 0
    return Schedule(
        term_months=term,
        uses=uses,
        receipts=receipts,
        refinance=refinance,
        totals=ScheduleTotals(
            acquisition_pence=acquisition_total,
            construction_pence=construction_total,
            professional_pence=professional_total,
            statutory_pence=statutory_total,
            selling_costs_pence=selling_costs,
            gross_sales_pence=gross_sales,
            gdv_pence=gdv,
            retained_value_pence=retained_value,
            cost_before_finance_ex_selling_pence=(
                acquisition_total + construction_total + professional_total + statutory_total
            ),
        ),
    )
