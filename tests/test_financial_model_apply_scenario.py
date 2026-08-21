"""Mirror of frontend/src/lib/model/apply-scenario.test.ts (spec Sec 12.1).

Hand-derived from Fixture F: units 30,000,000 pence each, cost/sqm 100,000 pence,
term 12 months, rate 8.0%.
  -15% GDV -> 30,000,000 * 0.85 = 25,500,000
  +15% cost -> 100,000 * 1.15   =    115,000
  -3 months -> 12 - 3           =          9
  +1.0 pp   -> 8.0 + 1.0        =        9.0
"""
import json
from pathlib import Path

from app.financial_model import compute_cost_plan, developed_area_sqm, run_appraisal
from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.migrate import migrate_inputs_to_v6, migrate_inputs_to_v7
from app.financial_model.types import (
    CalculatorInputsV6,
    CalculatorInputsV7,
    ContingencyClass,
    CostPackage,
    CostPlanInputs,
    FeeLine,
    ProposedUnitV6,
    ScenarioOverrides,
    UnitAncillary,
    UnitMixInputsV6,
    parse_calculator_inputs,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "f-dev-finance-12mo.json"


def _base():
    return parse_calculator_inputs(json.loads(FIXTURE.read_text(encoding="utf-8"))["inputs"])


def _overrides(**kwargs):
    return ScenarioOverrides(
        label=kwargs.get("label", ""),
        gdv_adjustment_pct=kwargs.get("gdv_adjustment_pct", 0.0),
        construction_cost_adjustment_pct=kwargs.get("construction_cost_adjustment_pct", 0.0),
        timeline_adjustment_months=kwargs.get("timeline_adjustment_months", 0),
        interest_rate_adjustment_pct=kwargs.get("interest_rate_adjustment_pct", 0.0),
    )


def test_gdv_lever_scales_every_unit_value():
    out = apply_scenario(_base(), _overrides(gdv_adjustment_pct=-15.0))
    assert [u.estimated_value_pence for u in out.unit_mix.units] == [25500000] * 4


def test_cost_lever_scales_cost_per_sqm():
    out = apply_scenario(_base(), _overrides(construction_cost_adjustment_pct=15.0))
    assert out.conversion_costs.construction_cost_per_sqm_pence == 115000


def test_timeline_and_rate_levers_add():
    out = apply_scenario(_base(), _overrides(timeline_adjustment_months=-3, interest_rate_adjustment_pct=1.0))
    assert out.finance.term_months == 9
    assert out.finance.annual_interest_rate_pct == 9.0


def test_levers_are_order_independent_because_fields_are_disjoint():
    """Spec Sec 12.1: the four levers write to disjoint fields."""
    both = _overrides(gdv_adjustment_pct=-15.0, construction_cost_adjustment_pct=15.0)
    combined = apply_scenario(_base(), both)
    staged = apply_scenario(
        apply_scenario(_base(), _overrides(gdv_adjustment_pct=-15.0)),
        _overrides(construction_cost_adjustment_pct=15.0),
    )
    assert [u.estimated_value_pence for u in combined.unit_mix.units] == [
        u.estimated_value_pence for u in staged.unit_mix.units
    ]
    assert (
        combined.conversion_costs.construction_cost_per_sqm_pence
        == staged.conversion_costs.construction_cost_per_sqm_pence
    )


def test_facility_and_equity_are_never_touched():
    """Spec Sec 12.2: no lever may write to the committed facility or equity."""
    base = _base()
    out = apply_scenario(base, _overrides(gdv_adjustment_pct=-15.0, construction_cost_adjustment_pct=15.0,
                                          timeline_adjustment_months=3, interest_rate_adjustment_pct=1.0))
    assert out.finance.committed_net_facility_pence == base.finance.committed_net_facility_pence
    assert out.finance.committed_gross_facility_pence == base.finance.committed_gross_facility_pence
    assert out.finance.day_one_advance_pence == base.finance.day_one_advance_pence
    assert [e.amount_pence for e in out.equity_sources] == [e.amount_pence for e in base.equity_sources]


def test_base_document_is_not_mutated():
    base = _base()
    apply_scenario(base, _overrides(gdv_adjustment_pct=-15.0))
    assert base.unit_mix.units[0].estimated_value_pence == 30000000


def test_timeline_adjustment_as_integral_float_is_cast_safely():
    """Spec Sec 12.6: timeline steps must be whole months, so a float like 3.0
    is valid (integral value in float representation) and the int() cast is a no-op.
    Fixture F has 12-month term; adding 3.0 yields 15.

    The value assertion alone (15.0 == 15) cannot distinguish int(3.0) from an
    uncast 3.0 in Python, because 15.0 == 15 is True. The isinstance() check is
    the part that catches a removed or weakened cast."""
    out = apply_scenario(_base(), _overrides(timeline_adjustment_months=3.0))
    assert out.finance.term_months == 15
    assert isinstance(out.finance.term_months, int)


def _v6_inputs_with_unit(ancillary: UnitAncillary) -> CalculatorInputsV6:
    inputs = migrate_inputs_to_v6({}, {"id": "p", "price_pence": 0, "floor_area_sqm": 0})
    inputs.unit_mix = UnitMixInputsV6(units=[ProposedUnitV6(
        id="u1", type="2bed", floor_area_sqm=65, estimated_value_pence=25_000_000, comparable_notes="",
        ancillary=ancillary,
    )])
    return inputs


class TestAGdvScenarioStressesAncillaryValueToo:
    """R9 (Task 7 -- Defect 2): GDV now has two components -- internal
    saleable value (estimated_value_pence) and ancillary value
    (ancillary.parking_value_pence, ancillary.balcony_terrace_value_pence).
    Left unmoved, every GDV sensitivity, every named scenario and the whole
    tornado chart understate the stress by the ancillary share."""

    def test_applies_the_gdv_adjustment_to_parking_and_balcony_value(self):
        stressed = apply_scenario(
            _v6_inputs_with_unit(UnitAncillary(
                balcony_terrace_sqm=0, balcony_terrace_value_pence=400_000,
                parking_spaces=1, parking_value_pence=1_200_000,
            )),
            _overrides(gdv_adjustment_pct=-10.0),
        )
        u = stressed.unit_mix.units[0]
        assert u.estimated_value_pence == 22_500_000
        assert u.ancillary.parking_value_pence == 1_080_000
        assert u.ancillary.balcony_terrace_value_pence == 360_000

    def test_leaves_ancillary_areas_untouched(self):
        """A price stress is not an area stress."""
        stressed = apply_scenario(
            _v6_inputs_with_unit(UnitAncillary(
                balcony_terrace_sqm=8, balcony_terrace_value_pence=0,
                parking_spaces=2, parking_value_pence=0,
            )),
            _overrides(gdv_adjustment_pct=-10.0),
        )
        u = stressed.unit_mix.units[0]
        assert u.ancillary.balcony_terrace_sqm == 8
        assert u.ancillary.parking_spaces == 2


class TestTheCostLeverReachesBothModes:
    """R10 Task 8 -- spec Sec 3.5. Port of the equivalent describe block in
    apply-scenario.test.ts. apply_scenario scaled only conversion_costs, which
    drives nothing in detailed mode: the cost lives in cost_plan.packages. Left
    unfixed, a detailed-mode appraisal is immune to every scenario, tornado bar
    and sensitivity cell while still rendering as though it responded.

    The pair carries zero compliance allowances deliberately -- compliance is a
    fixed allowance in headline mode (the lever does not scale it, pre-R10
    behaviour R10 must not change) but sits inside a scaled package in detailed
    mode, so a pair carrying compliance would diverge under a stress for a
    reason that is not a defect (see the brief's worked example: 4,460,000
    headline against 4,410,000 detailed at -10% with 500,000 of compliance)."""

    @staticmethod
    def _pair() -> tuple[CalculatorInputsV7, CalculatorInputsV7]:
        # Two documents with the SAME construction total, built to DIFFERENT shapes.
        #   headline: rate 10,000 p/m2 x 400 m2 = 4,000,000 base
        #             + 10% general contingency  =   400,000  -> 4,400,000
        #   detailed: TWO packages (3,000,000 structure + 1,000,000 envelope) so
        #             the guard cannot be satisfied by a fix that only scales the
        #             first package (e.g. a loop that breaks early, or a
        #             packages[0] fix applied under time pressure) -- 4,000,000
        #             total + 10% general contingency = 400,000 -> 4,400,000
        # Compliance is zero in both (see the class docstring).
        project = {"id": "p", "price_pence": 0, "floor_area_sqm": 0}
        base = migrate_inputs_to_v7({}, project)
        base.finance.funding_source = "cash"
        base.finance.term_months = 12
        base.conversion_costs.construction_cost_per_sqm_pence = 10_000
        base.conversion_costs.total_construction_sqm = 400
        base.conversion_costs.fire_safety_pence = 0
        base.conversion_costs.sound_insulation_pence = 0
        base.conversion_costs.part_l_compliance_pence = 0
        # 'manual' basis so developed_area_sqm returns total_construction_sqm (400)
        # rather than a derived bridge figure -- the headline base must be a
        # number this test controls, not one another block decides.
        base.areas.basis = "manual"

        contingency = [
            ContingencyClass(name="general", pct=10),
            ContingencyClass(name="existing_building", pct=0),
            ContingencyClass(name="abnormal", pct=0),
        ]

        headline = base.model_copy(deep=True)
        headline.cost_plan = CostPlanInputs(
            mode="headline", packages=[], contingency=contingency, fee_lines=[],
        )

        detailed = base.model_copy(deep=True)
        detailed.cost_plan = CostPlanInputs(
            mode="detailed",
            packages=[
                CostPackage(
                    id="p1", code="structure", label="Structure", amount_pence=3_000_000,
                    contingency_class="general", lender_eligible=True, notes="",
                ),
                CostPackage(
                    id="p2", code="envelope", label="Envelope", amount_pence=1_000_000,
                    contingency_class="general", lender_eligible=True, notes="",
                ),
            ],
            contingency=contingency,
            fee_lines=[],
        )
        return headline, detailed

    def test_the_two_documents_describe_the_same_construction_total(self):
        headline, detailed = self._pair()
        assert run_appraisal(headline).metrics.construction_cost_pence == 4_400_000
        assert run_appraisal(detailed).metrics.construction_cost_pence == 4_400_000

    def test_and_respond_identically_to_a_minus10_and_a_plus10_cost_stress(self):
        headline, detailed = self._pair()
        # -10%: base 3,600,000 + 10% = 3,960,000.  +10%: 4,400,000 + 10% = 4,840,000.
        expected = {-10: 3_960_000, 10: 4_840_000}
        for adj in (-10, 10):
            overrides = _overrides(construction_cost_adjustment_pct=float(adj))
            h = run_appraisal(apply_scenario(headline, overrides)).metrics.construction_cost_pence
            d = run_appraisal(apply_scenario(detailed, overrides)).metrics.construction_cost_pence
            assert h == expected[adj]
            assert d == expected[adj]
            # The literals above are what make this falsifiable. Asserting only
            # d == h would pass with BOTH modes inert, which is the exact defect
            # this test exists to catch. (4,900,000 is not a value either mode
            # can legitimately reach here, so it is not asserted against -- it
            # is the at-rest total of TestTheCostLeverDoesNotDoubleApply's
            # headline-with-compliance fixture below, a different case.)


class TestTheCostLeverDoesNotDoubleApply:
    """I2 (Task 8 fix round 1). The cross-mode pair above deliberately carries
    zero compliance and no fee lines, so it cannot see a regression that
    started scaling either. This is a headline-only case with both present,
    asserting the two negative requirements directly: compliance does NOT move
    with the cost lever (fixed allowance, pre-R10 behaviour), and a fixed fee
    does NOT move either -- while a percentage fee DOES move, but only because
    its BASE moved, not because the lever touched the fee amount a second
    time."""

    @staticmethod
    def _headline_with_compliance_and_fees() -> CalculatorInputsV7:
        project = {"id": "p", "price_pence": 0, "floor_area_sqm": 0}
        inputs = migrate_inputs_to_v7({}, project)
        inputs.finance.funding_source = "cash"
        inputs.finance.term_months = 12
        inputs.conversion_costs.construction_cost_per_sqm_pence = 10_000
        inputs.conversion_costs.total_construction_sqm = 400
        # Compliance: 200,000 + 150,000 + 150,000 = 500,000 total.
        inputs.conversion_costs.fire_safety_pence = 200_000
        inputs.conversion_costs.sound_insulation_pence = 150_000
        inputs.conversion_costs.part_l_compliance_pence = 150_000
        inputs.areas.basis = "manual"
        inputs.cost_plan = CostPlanInputs(
            mode="headline",
            packages=[],
            contingency=[
                ContingencyClass(name="general", pct=10),
                ContingencyClass(name="existing_building", pct=0),
                ContingencyClass(name="abnormal", pct=0),
            ],
            fee_lines=[
                FeeLine(
                    id="fee-fixed", code="architect", category="professional", label="Architect",
                    basis="fixed", amount_pence=200_000, pct=0, per_dwelling=False,
                ),
                FeeLine(
                    id="fee-pct", code="other_professional", category="professional",
                    label="Other professional fees", basis="pct_of_construction_total",
                    amount_pence=0, pct=5, per_dwelling=False,
                ),
            ],
        )
        return inputs

    def test_at_rest_construction_total_is_4_900_000_and_the_pct_fee_is_5pct_of_that(self):
        inputs = self._headline_with_compliance_and_fees()
        plan = compute_cost_plan(inputs, developed_area_sqm(inputs), len(inputs.unit_mix.units))
        assert plan.base_build_pence == 4_000_000
        assert plan.compliance_pence == 500_000
        assert plan.construction_total_pence == 4_900_000
        assert next(f for f in plan.fees if f.id == "fee-fixed").amount_pence == 200_000
        assert next(f for f in plan.fees if f.id == "fee-pct").base_pence == 4_900_000
        assert next(f for f in plan.fees if f.id == "fee-pct").amount_pence == 245_000

    def test_under_minus10pct_stress_base_scales_compliance_and_fixed_fee_do_not_pct_fee_moves_with_its_base(self):
        inputs = self._headline_with_compliance_and_fees()
        stressed = apply_scenario(inputs, _overrides(construction_cost_adjustment_pct=-10.0))
        plan = compute_cost_plan(stressed, developed_area_sqm(stressed), len(stressed.unit_mix.units))

        # Base build: rate 10,000 x 0.9 = 9,000/m2 x 400 m2 = 3,600,000.
        assert plan.base_build_pence == 3_600_000
        # Compliance is a fixed allowance the cost lever does not scale -- unchanged.
        assert plan.compliance_pence == 500_000
        # Contingency: 10% of the new base build = 360,000.
        # Construction total: 3,600,000 + 360,000 + 500,000 = 4,460,000.
        assert plan.construction_total_pence == 4_460_000
        # The fixed fee never reads a base, so it is untouched by any lever.
        assert next(f for f in plan.fees if f.id == "fee-fixed").amount_pence == 200_000
        # The pct fee's base is the NEW construction total, not the old one.
        pct_fee = next(f for f in plan.fees if f.id == "fee-pct")
        assert pct_fee.base_pence == 4_460_000
        # 5% of 4,460,000 = 223,000 -- the fee moved because its base moved.
        # A double-application defect (scaling the fee amount by 0.9 on top of
        # its own recomputation) would instead give 245,000 * 0.9 = 220,500.
        # The two values differ, so this assertion is the discriminating check.
        assert pct_fee.amount_pence == 223_000
        assert pct_fee.amount_pence != 220_500
