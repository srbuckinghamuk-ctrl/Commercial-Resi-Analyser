"""Mirror of frontend/src/lib/model/cost-plan.ts's engine (R10, spec Sec 16).

The pydantic INPUT models live in types.py (see areas.py / AreaBridgeInputs for
the same split). This module holds the result dataclass and the one engine that
serves both cost-plan modes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .engine import money_round


@dataclass
class CostPackageLine:
    id: str
    code: str
    label: str
    amount_pence: int
    contingency_class: str
    lender_eligible: bool


@dataclass
class ContingencyLine:
    name: str
    pct: float
    basis: str
    base_pence: int
    amount_pence: int


@dataclass
class FeeLineResult:
    id: str
    code: str
    category: str
    label: str
    basis: str
    base_pence: int
    amount_pence: int


@dataclass
class CostPlanResult:
    """Spec Sec 16. Mirrors CostPlanResult in cost-plan.ts field for field.
    The ONLY shape the UI and the report may read cost from. Every contingency
    and fee line carries its BASE as well as its amount."""

    mode: str
    packages: list[CostPackageLine] = field(default_factory=list)
    base_build_pence: int = 0
    contingency: list[ContingencyLine] = field(default_factory=list)
    contingency_total_pence: int = 0
    compliance_pence: int = 0
    construction_total_pence: int = 0
    fees: list[FeeLineResult] = field(default_factory=list)
    professional_total_pence: int = 0
    statutory_total_pence: int = 0
    lender_eligible_base_pence: int = 0
    implied_rate_pence_per_sqm: int | None = None


def _cost_plan_of(inputs) -> Any:
    """A pre-v7 document has no cost_plan. Read structurally, exactly like
    areas.py's _bridge_inputs_of reads the bridge.

    The fallback DERIVES the plan from the document's own cost fields. It must
    not be DEFAULT_COST_PLAN -- see cost_plan_from_legacy_costs' docstring for
    why (zero professional and statutory costs on every unmigrated document,
    and the golden fixtures run natively without migrating)."""
    plan = getattr(inputs, "cost_plan", None)
    if plan is not None:
        return plan
    from .types import cost_plan_from_legacy_costs

    return cost_plan_from_legacy_costs(inputs.conversion_costs)


def compute_cost_plan(inputs, area_sqm: float, unit_count: int) -> CostPlanResult:
    plan = _cost_plan_of(inputs)
    cc = inputs.conversion_costs
    detailed = plan.mode == "detailed"

    packages = [
        CostPackageLine(
            id=p.id, code=p.code, label=p.label, amount_pence=p.amount_pence,
            contingency_class=p.contingency_class, lender_eligible=p.lender_eligible,
        )
        for p in plan.packages
    ]

    # Spec Sec 1.1: the fractional-area product rounds once, at source.
    base_build = (
        sum(p.amount_pence for p in packages)
        if detailed
        else money_round(cc.construction_cost_per_sqm_pence * area_sqm)
    )

    # Sec 3.2.1: in detailed mode compliance is priced inside the packages
    # (fire_acoustic_thermal). Counting the fields too would double count.
    compliance = (
        0
        if detailed
        else cc.fire_safety_pence + cc.sound_insulation_pence + cc.part_l_compliance_pence
    )

    by_id = {p.id: p.amount_pence for p in plan.packages}
    contingency: list[ContingencyLine] = []
    for c in plan.contingency:
        base = (
            base_build
            if c.basis == "all_packages"
            else sum(by_id.get(pid, 0) for pid in c.package_ids)
        )
        contingency.append(
            ContingencyLine(
                name=c.name, pct=c.pct, basis=c.basis,
                base_pence=base, amount_pence=money_round(base * c.pct / 100),
            )
        )
    # Sum of ROUNDED figures. Three allowances at 5% are not one at 15%.
    contingency_total = sum(c.amount_pence for c in contingency)

    construction_total = base_build + contingency_total + compliance

    # No fee basis includes fees, so this needs no ordering and no iteration.
    fees: list[FeeLineResult] = []
    for f in plan.fee_lines:
        if f.basis == "pct_of_base_build":
            base = base_build
        elif f.basis == "pct_of_construction_total":
            base = construction_total
        else:
            base = 0
        if f.basis == "fixed":
            amount = f.amount_pence * max(1, unit_count) if f.per_dwelling else f.amount_pence
        else:
            amount = money_round(base * f.pct / 100)
        fees.append(
            FeeLineResult(
                id=f.id, code=f.code, category=f.category, label=f.label,
                basis=f.basis, base_pence=base, amount_pence=amount,
            )
        )

    return CostPlanResult(
        mode=plan.mode,
        packages=packages,
        base_build_pence=base_build,
        contingency=contingency,
        contingency_total_pence=contingency_total,
        compliance_pence=compliance,
        construction_total_pence=construction_total,
        fees=fees,
        professional_total_pence=sum(
            f.amount_pence for f in fees if f.category == "professional"
        ),
        statutory_total_pence=sum(
            f.amount_pence for f in fees if f.category == "statutory"
        ),
        lender_eligible_base_pence=sum(
            p.amount_pence for p in packages if p.lender_eligible
        ),
        implied_rate_pence_per_sqm=(
            money_round(base_build / area_sqm) if area_sqm > 0 else None
        ),
    )
