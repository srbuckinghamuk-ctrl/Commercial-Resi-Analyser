"""R10 Task 9 fix round 1 (I3). The pre-cost_plan legacy per-field cost
calculators, split out of schedule.py so the single-accessor guard
(tests/test_accessor_guard.py) can allowlist THIS module for its one
legitimate contingency_pct read without also un-guarding schedule.py's
build_schedule -- mirrors how the TypeScript twin isolates the same
calculator in frontend/src/lib/conversion-calc-engine.ts, leaving
schedule.ts fully policed.

Both functions are live only via migrate.py's v1->v2 facility-sizing
bootstrap, which runs before a document has a cost_plan block at all and so
legitimately needs the legacy field-summing arithmetic rather than
compute_cost_plan (cost_plan.py). build_schedule itself has read cost only
through compute_cost_plan since R10 Task 7; these functions are dead code
from build_schedule's point of view, kept for migrate.py alone."""
from __future__ import annotations

from .engine import money_round
from .types import ConversionCostInputs


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
