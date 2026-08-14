"""Transliteration of frontend/src/lib/model/schedule.test.ts's
`buildSchedule with a v4 programme` describe block (Release 3a Task 4, spec
Sec 6.1 / calc 2.2.0). Same scenarios, same expected arrays as the TS side.
"""
from app.financial_model.engine import money_round
from app.financial_model.migrate import (
    default_calculator_inputs_v2,
    migrate_inputs_to_v4,
    migrate_v2_to_v3,
    migrate_v3_to_v4,
)
from app.financial_model.schedule import build_schedule
from app.financial_model.types import CalculatorInputsV3, CalculatorInputsV4

PROGRAMME = {
    "anchor_month": None,
    "packages": {
        "construction": {"start_offset": 1, "duration_months": 6, "curve": {"kind": "s_curve"}},
        "professional": {"start_offset": 2, "duration_months": 3, "curve": {"kind": "straight_line"}},
        "statutory": {"start_offset": 4, "duration_months": 2, "curve": {"kind": "back_loaded"}},
    },
}


def test_v4_with_programme_null_is_bit_identical_to_the_migrated_v3_schedule():
    v3_dict = migrate_v2_to_v3(default_calculator_inputs_v2())
    v4_dict = migrate_v3_to_v4(v3_dict)
    v3 = CalculatorInputsV3.model_validate(v3_dict)
    v4 = CalculatorInputsV4.model_validate(v4_dict)
    assert build_schedule(v4) == build_schedule(v3)


def test_an_explicit_programme_places_each_package_window_with_its_curve():
    doc = migrate_inputs_to_v4({})
    doc["finance"]["term_months"] = 12
    # construction total must be 60,000,000p for the table below:
    doc["conversion_costs"]["construction_cost_per_sqm_pence"] = 150_000
    doc["conversion_costs"]["total_construction_sqm"] = 400
    doc["conversion_costs"]["contingency_pct"] = 0
    doc["conversion_costs"]["fire_safety_pence"] = 0
    doc["conversion_costs"]["sound_insulation_pence"] = 0
    doc["conversion_costs"]["part_l_compliance_pence"] = 0
    doc["programme"] = PROGRAMME
    v4 = CalculatorInputsV4.model_validate(doc)

    s = build_schedule(v4)
    assert [u.construction_pence for u in s.uses] == [
        0, 4_019_238, 10_980_762, 15_000_000, 15_000_000, 10_980_762, 4_019_238, 0, 0, 0, 0, 0,
    ]
    # professional window shifted to months 2..4; statutory back-loaded months 4..5
    assert s.uses[1].professional_pence == 0
    assert s.uses[2].professional_pence > 0
    stat_total = v4.conversion_costs.cil_s106_pence + v4.conversion_costs.building_control_pence
    assert (
        s.uses[4].statutory_pence + s.uses[5].statutory_pence
        - money_round(stat_total / 3) - (stat_total - money_round(stat_total / 3))
    ) == 0
    # prior-approval fee still at month 0 regardless of the statutory package
    assert s.uses[0].statutory_pence == (
        v4.conversion_costs.prior_approval_fee_per_dwelling_pence
        * max(1, len(v4.unit_mix.units))
    )


def test_a_negative_start_offset_never_wraps_to_the_end_of_the_term():
    """No TS counterpart -- guards a Python-only hazard. `uses[-1]` is `undefined`
    in JS (schedule.ts throws on the next property access), but in Python it
    silently addresses the LAST month. validation.py hard-rejects this input, so
    this only pins that the unvalidated path degrades to an in-range placement
    rather than a silently wrong one; the spread must still total exactly."""
    doc = migrate_inputs_to_v4({})
    doc["finance"]["term_months"] = 12
    doc["conversion_costs"]["construction_cost_per_sqm_pence"] = 150_000
    doc["conversion_costs"]["total_construction_sqm"] = 400
    doc["conversion_costs"]["contingency_pct"] = 0
    doc["programme"] = {
        "anchor_month": None,
        "packages": {
            "construction": {
                "start_offset": -2, "duration_months": 3, "curve": {"kind": "straight_line"},
            },
            "professional": {
                "start_offset": 1, "duration_months": 3, "curve": {"kind": "straight_line"},
            },
            "statutory": {
                "start_offset": 1, "duration_months": 3, "curve": {"kind": "straight_line"},
            },
        },
    }
    s = build_schedule(CalculatorInputsV4.model_validate(doc))
    # months -2, -1, 0 all clamp forward to month 0 -- nothing lands in the sale tail.
    assert s.uses[0].construction_pence == s.totals.construction_pence
    assert s.uses[-1].construction_pence == 0
    assert sum(u.construction_pence for u in s.uses) == s.totals.construction_pence
