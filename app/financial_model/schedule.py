"""Port of frontend/src/lib/model/schedule.ts, plus the cost-helper functions it
imports from frontend/src/lib/conversion-calc-engine.ts (calculateGdv,
calculateTotalAcquisitionCost, calculateTotalConstructionCost;
calculateTotalProfessionalFees is also ported here so migrate.py can share it,
mirroring the TS module that houses all four)."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .curves import spread_by_curve
from .engine import money_round
from .sdlt import calculate_commercial_sdlt
from .types import (
    AcquisitionInputs,
    AnyCalculatorInputs,
    ConversionCostInputs,
    ProgrammePackage,
    ProposedUnit,
)


def calculate_gdv(units: list[ProposedUnit]) -> int:
    return sum(u.estimated_value_pence for u in units)


def calculate_total_acquisition_cost(acq: AcquisitionInputs) -> int:
    sdlt = calculate_commercial_sdlt(acq.purchase_price_pence).total_pence
    broker_fee = money_round((acq.purchase_price_pence * acq.broker_fee_pct) / 100)
    return (
        acq.purchase_price_pence + sdlt + acq.legal_fees_pence + acq.survey_cost_pence
        + broker_fee + acq.other_acquisition_costs_pence
    )


def calculate_total_construction_cost(costs: ConversionCostInputs) -> int:
    # Spec Sec 1.1: fractional-area products round once, at source, in one step before
    # contingency -- base = round_half_up(construction_cost_per_sqm_pence x
    # total_construction_sqm). Integer-sqm inputs are unaffected (rounding an
    # already-integer product is identity). Matches conversion-calc-engine.ts exactly.
    base_cost = money_round(costs.construction_cost_per_sqm_pence * costs.total_construction_sqm)
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
class Schedule:
    term_months: int
    uses: list[MonthUses]
    receipts: list[MonthReceipts]
    totals: ScheduleTotals


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
    cc = inputs.conversion_costs
    units = inputs.unit_mix.units

    acquisition_total = calculate_total_acquisition_cost(inputs.acquisition)
    construction_total = calculate_total_construction_cost(cc)
    # Reclassification per spec Sec 3.5/3.6: professional excludes statutory items.
    professional_total = (
        cc.architect_pence + cc.structural_engineer_pence + cc.mande_pence
        + cc.planning_consultant_pence + cc.other_professional_fees_pence
    )
    prior_approval = cc.prior_approval_fee_per_dwelling_pence * max(1, len(units))
    statutory_spread_total = cc.cil_s106_pence + cc.building_control_pence
    statutory_total = prior_approval + statutory_spread_total

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
    gross_sales = sum(u.estimated_value_pence for u in sold_units)
    gdv = calculate_gdv(units)
    retained_value = gdv - gross_sales

    sale_month = term - 1
    agent_fee = money_round((gross_sales * inputs.exit_strategy.selling_agent_fee_pct) / 100)
    selling_legal = inputs.exit_strategy.selling_legal_fee_pence if len(sold_units) > 0 else 0
    if gross_sales > 0:
        receipts[sale_month] = MonthReceipts(
            gross_sale_pence=gross_sales, agent_fee_pence=agent_fee, selling_legal_pence=selling_legal,
        )

    selling_costs = agent_fee + selling_legal if gross_sales > 0 else 0
    return Schedule(
        term_months=term,
        uses=uses,
        receipts=receipts,
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
