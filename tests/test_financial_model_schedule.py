"""Transliteration of frontend/src/lib/model/schedule.test.ts's
`buildSchedule with a v4 programme` and `buildSchedule with sales_phasing`
describe blocks (Release 3a Task 4 / Release 3b Task 4, spec Sec 6.1 / Sec
4.4.1, calc 2.2.0 / calc 2.3.0). Same scenarios, same expected arrays as the
TS side.
"""
from app.financial_model.areas import developed_area_sqm
from app.financial_model.engine import money_round
from app.financial_model.migrate import (
    default_calculator_inputs_v2,
    migrate_inputs_to_v4,
    migrate_inputs_to_v6,
    migrate_v2_to_v3,
    migrate_v3_to_v4,
)
from app.financial_model.schedule import (
    calculate_gdv,
    calculate_gdv_breakdown,
    build_schedule,
    unit_ancillary_value_pence,
)
from app.financial_model.types import (
    AreaBridgeInputs,
    CalculatorInputsV3,
    CalculatorInputsV4,
    ProposedUnit,
    ProposedUnitV6,
    RetainedUnit,
    SalesPhasingInputs,
    SalesPhasingTranche,
    UnitAncillary,
    UnitMixInputsV6,
)

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


def _phased_v4() -> CalculatorInputsV4:
    doc = migrate_inputs_to_v4({})
    doc["finance"]["term_months"] = 12
    doc["unit_mix"] = {"units": [
        {
            "id": "u1", "type": "1bed", "floor_area_sqm": 50,
            "estimated_value_pence": 30_000_000, "comparable_notes": "",
        },
        {
            "id": "u2", "type": "1bed", "floor_area_sqm": 50,
            "estimated_value_pence": 30_000_001, "comparable_notes": "",
        },
    ]}
    doc["exit_strategy"]["selling_agent_fee_pct"] = 1.5
    doc["exit_strategy"]["selling_legal_fee_pence"] = 400_000
    return CalculatorInputsV4.model_validate(doc)


class TestBuildScheduleWithSalesPhasing:
    """Transliteration of schedule.test.ts's `buildSchedule with sales_phasing
    (spec Sec 4.4.1)` describe block (Release 3b Task 4)."""

    def test_null_phasing_is_byte_identical_to_the_single_final_month_disposal(self):
        v4 = _phased_v4()
        single = build_schedule(v4)
        v4.sales_phasing = SalesPhasingInputs(
            tranches=[SalesPhasingTranche(month_offset=11, pct_of_gross_receipts=100)],
        )
        assert build_schedule(v4) == single  # single 100% tranche == None (identity)

    def test_splits_gross_and_costs_pro_rata_with_final_tranche_residue_absorption(self):
        v4 = _phased_v4()
        v4.sales_phasing = SalesPhasingInputs(tranches=[
            SalesPhasingTranche(month_offset=9, pct_of_gross_receipts=40),
            SalesPhasingTranche(month_offset=10, pct_of_gross_receipts=35),
            SalesPhasingTranche(month_offset=11, pct_of_gross_receipts=25),
        ])
        s = build_schedule(v4)
        gross = 60_000_001
        agent = money_round((gross * 1.5) / 100)
        g9 = money_round((gross * 40) / 100)
        g10 = money_round((gross * 35) / 100)
        assert s.receipts[9].gross_sale_pence == g9
        assert s.receipts[10].gross_sale_pence == g10
        assert s.receipts[11].gross_sale_pence == gross - g9 - g10  # residue
        a9 = money_round((agent * g9) / gross)
        a10 = money_round((agent * g10) / gross)
        assert s.receipts[9].agent_fee_pence == a9
        assert s.receipts[11].agent_fee_pence == agent - a9 - a10  # residue
        legal_sum = sum(r.selling_legal_pence for r in s.receipts)
        assert legal_sum == 400_000  # conservation
        assert s.totals.selling_costs_pence == agent + 400_000  # totals unchanged
        assert s.refinance is None


def _v6() -> "CalculatorInputsV6":
    return migrate_inputs_to_v6({}, {"id": "p", "price_pence": 0, "floor_area_sqm": 0})


class TestBuildScheduleResolvesItsCostAreaThroughTheAccessor:
    """R9 Task 4 -- mirror of conversion-calc-engine.test.ts's
    'R9 -- the schedule resolves its cost area through the accessor' describe
    block. Both engines must resolve calculate_total_construction_cost's area
    parameter the same way, whichever basis the areas block selects."""

    def test_uses_the_bridge_derived_area_when_the_bridge_basis_is_selected(self):
        inputs = _v6().model_copy(update={
            "areas": AreaBridgeInputs(basis="bridge_derived", existing_gia_sqm=520),
            "conversion_costs": _v6().conversion_costs.model_copy(update={
                "construction_cost_per_sqm_pence": 50_000,
                "total_construction_sqm": 9999,
            }),
        })
        s = build_schedule(inputs)
        # 520 x 50,000 x 1.10
        assert s.totals.construction_pence == 28_600_000

    def test_uses_the_manual_field_when_the_manual_basis_is_selected(self):
        inputs = _v6().model_copy(update={
            "areas": AreaBridgeInputs(basis="manual", existing_gia_sqm=520),
            "conversion_costs": _v6().conversion_costs.model_copy(update={
                "construction_cost_per_sqm_pence": 50_000,
                "total_construction_sqm": 400,
            }),
        })
        assert build_schedule(inputs).totals.construction_pence == 22_000_000

    def test_carries_a_fractional_bridge_derived_area_into_the_half_up_rounding_site(self):
        """R9 Task 12 fix round 1. Spec Sec 3.4's round_half_up(rate x area) is pinned
        in test_financial_model_engine.py, including the odd-half case -- but every case
        there passes the area in directly. Nothing proved a *derived* area could reach
        that rounding site fractionally at all.

        No golden fixture closes this cheaply: fixture N's rate is 105,000p/m2, and
        105,000 x any plausible area fraction is an integer, so exercising the rounding
        through a fixture would mean changing the rate too and re-deriving its whole cost
        stack. This asserts the same property at the seam where it actually lives.
        Mirrors conversion-calc-engine.test.ts."""
        inputs = _v6().model_copy(update={
            # 120.5 - 20 = 100.5 m2 developed, entered nowhere as 100.5
            "areas": AreaBridgeInputs(
                basis="bridge_derived", existing_gia_sqm=120.5,
                retained_commercial_gia_sqm=20,
            ),
            "conversion_costs": _v6().conversion_costs.model_copy(update={
                "construction_cost_per_sqm_pence": 333,
                "total_construction_sqm": 9999,
                "contingency_pct": 0,
                "fire_safety_pence": 0,
                "sound_insulation_pence": 0,
                "part_l_compliance_pence": 0,
            }),
        })
        assert developed_area_sqm(inputs) == 100.5
        # 333 x 100.5 = 33,466.5 -> round_half_up = 33,467. Python's round() (banker's)
        # would give 33,466, and truncation 33,466 -- so this pin distinguishes all three.
        assert build_schedule(inputs).totals.construction_pence == 33_467


# R9 Task 6 -- mirror of conversion-calc-engine.test.ts's
# 'R9 -- GDV splits internal saleable from ancillary' describe block.
_ANCILLARY_UNITS = [
    ProposedUnitV6(
        id="u1", type="1bed", floor_area_sqm=50, estimated_value_pence=25_000_000,
        comparable_notes="",
        ancillary=UnitAncillary(
            balcony_terrace_sqm=6, balcony_terrace_value_pence=400_000,
            parking_spaces=1, parking_value_pence=1_200_000,
        ),
    ),
    ProposedUnitV6(
        id="u2", type="1bed", floor_area_sqm=50, estimated_value_pence=24_500_000,
        comparable_notes="",
        ancillary=UnitAncillary(
            balcony_terrace_sqm=0, balcony_terrace_value_pence=0,
            parking_spaces=1, parking_value_pence=1_200_000,
        ),
    ),
]


class TestGdvSplitsInternalSaleableFromAncillary:
    def test_reports_internal_and_ancillary_separately(self):
        b = calculate_gdv_breakdown(_ANCILLARY_UNITS)
        assert b.internal_pence == 49_500_000
        assert b.ancillary_pence == 2_800_000
        assert b.total_pence == 52_300_000

    def test_keeps_calculate_gdv_as_the_total_so_existing_callers_are_unaffected(self):
        assert calculate_gdv(_ANCILLARY_UNITS) == 52_300_000

    def test_treats_a_pre_v6_unit_with_no_ancillary_block_as_zero_ancillary(self):
        legacy = [ProposedUnit(
            id="u1", type="1bed", floor_area_sqm=50, estimated_value_pence=25_000_000,
            comparable_notes="",
        )]
        b = calculate_gdv_breakdown(legacy)
        assert b.ancillary_pence == 0
        assert b.total_pence == 25_000_000
        assert unit_ancillary_value_pence(legacy[0]) == 0

    def test_sums_parking_and_balcony_terrace_value_for_a_single_unit(self):
        assert unit_ancillary_value_pence(_ANCILLARY_UNITS[0]) == 1_600_000
        assert unit_ancillary_value_pence(_ANCILLARY_UNITS[1]) == 1_200_000


class TestAncillaryValueFlowsIntoSaleReceipts:
    """Mirror of schedule.test.ts's 'R9 -- ancillary value flows into sale
    receipts' describe block."""

    @staticmethod
    def _make_v6_inputs(route: str, retained_ids: list[str] | None = None):
        inputs = _v6()
        return inputs.model_copy(update={
            "unit_mix": UnitMixInputsV6(units=_ANCILLARY_UNITS),
            "exit_strategy": inputs.exit_strategy.model_copy(update={
                "route": route,
                "retained_units": [
                    RetainedUnit(unit_id=uid, monthly_rent_pence=0) for uid in (retained_ids or [])
                ],
            }),
        })

    def test_sells_a_unit_with_its_parking_and_balcony_value_attached(self):
        # Without this, GDV and gross sale receipts disagree by the ancillary
        # total and the appraisal no longer reconciles.
        s = build_schedule(self._make_v6_inputs("sell_all"))
        assert s.totals.gross_sales_pence == 52_300_000
        assert s.totals.gdv_pence == 52_300_000

    def test_leaves_a_retained_units_ancillary_out_of_receipts_but_inside_gdv(self):
        s = build_schedule(self._make_v6_inputs("blended", ["u2"]))
        assert s.totals.gross_sales_pence == 26_600_000  # u1 internal + u1 ancillary
        assert s.totals.gdv_pence == 52_300_000
