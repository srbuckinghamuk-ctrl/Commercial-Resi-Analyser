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

import pytest

from app.financial_model import compute_cost_plan, developed_area_sqm, run_appraisal
from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.engine import money_round
from app.financial_model.migrate import migrate_inputs_to_v6, migrate_inputs_to_v7, migrate_inputs_to_v9
from app.financial_model.types import (
    CalculatorInputsV6,
    CalculatorInputsV7,
    CategoryPhaseIds,
    ContingencyClass,
    CostPackage,
    CostPlanInputs,
    Dependency,
    FeeLine,
    Phase,
    ProgrammeInputs,
    ProgrammeNetwork,
    ProgrammePackage,
    ProgrammePackages,
    ProposedUnitV6,
    ScenarioOverrides,
    SimpleSpendCurve,
    UnitAncillary,
    UnitMixInputsV6,
    parse_calculator_inputs,
)
from .fixtures_investment_case import apply_levers_in_order, explicit_refinance_doc, ic_doc
from .fixtures_unit_sales import unit_sales_doc
from .fixtures_cost_plan_in_time import doc_z, parse

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
        phase_slip_phase_id=kwargs.get("phase_slip_phase_id", None),
        phase_slip_months=kwargs.get("phase_slip_months", 0),
        exit_yield_adjustment_pct=kwargs.get("exit_yield_adjustment_pct", 0.0),
        operating_cost_adjustment_pct=kwargs.get("operating_cost_adjustment_pct", 0.0),
        vacancy_adjustment_pct=kwargs.get("vacancy_adjustment_pct", 0.0),
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


# --- R12 Task 14: the phase_slip lever (spec Sec 18.9) ---------------------

SL = SimpleSpendCurve(kind="straight_line")


def _v9_phase(pid, code, duration, preds=(), *, start_offset=0, slip=0) -> Phase:
    return Phase(
        id=pid, code=code, label=pid, duration_months=duration,
        slip_months=slip, start_offset=start_offset, curve=SL,
        predecessors=list(preds),
    )


def _network_doc(term: int = 12):
    """Fixture F migrated to v9 and given a small two-phase network: planning (2
    months) then construction (8 months, FS off planning). Mirrors the identically
    named helper in test_financial_model_sensitivity.py."""
    base = migrate_inputs_to_v9(json.loads(FIXTURE.read_text(encoding="utf-8"))["inputs"])
    phases = [
        _v9_phase("planning", "planning", 2),
        _v9_phase("construction", "construction", 8, [Dependency(phase_id="planning", type="FS", lag_months=0)]),
    ]
    base.finance = base.finance.model_copy(update={"term_months": term})
    base.programme = ProgrammeNetwork(
        anchor_month=None,
        phases=phases,
        category_phase_ids=CategoryPhaseIds(
            construction="construction", professional="planning", statutory="planning",
        ),
    )
    return base


def _with_slip(doc, phase_id: str, months: int):
    d = doc.model_copy(deep=True)
    for p in d.programme.phases:
        if p.id == phase_id:
            p.slip_months += months
    return d


def test_phase_slip_adds_additively_to_the_named_phase_only():
    """Spec Sec 18.9. Hand-derived: planning already carries a base-case slip of
    1 month; the override adds 3 more. 1 + 3 = 4. construction is not the named
    phase, so its slip stays at 0."""
    doc = _with_slip(_network_doc(), "planning", 1)
    out = apply_scenario(doc, _overrides(phase_slip_phase_id="planning", phase_slip_months=3))
    assert next(p for p in out.programme.phases if p.id == "planning").slip_months == 4
    assert next(p for p in out.programme.phases if p.id == "construction").slip_months == 0


def test_null_phase_slip_phase_id_matches_no_phase_the_migration_no_op():
    """Fix round 1, Finding 2: months=0 cannot fail for any predicate that
    matches the wrong phase -- a broken match still adds zero. A nonzero
    magnitude makes this non-vacuous: a mutated predicate that makes a null
    target match EVERY phase would increment every phase's slip_months by 99."""
    doc = _network_doc()
    out = apply_scenario(doc, _overrides(phase_slip_phase_id=None, phase_slip_months=99))
    assert out.programme == doc.programme


def test_phase_slip_is_a_no_op_on_a_legacy_v8_programme():
    """The additive write is gated on the v9 network SHAPE (hasattr(programme,
    "phases")), not on inputs_version >= 9: a v4-v8 document's legacy
    ProgrammeInputs (`{ packages }`) has no `phases` attribute, so the lever
    writes nothing when there is nothing of the right shape to write to --
    rather than crashing, or silently misinterpreting a package as a phase."""
    inputs = migrate_inputs_to_v7({}, {"id": "p", "price_pence": 0, "floor_area_sqm": 0})
    inputs.programme = ProgrammeInputs(
        anchor_month=None,
        packages=ProgrammePackages(
            construction=ProgrammePackage(start_offset=0, duration_months=1, curve=SL),
            professional=ProgrammePackage(start_offset=0, duration_months=1, curve=SL),
            statutory=ProgrammePackage(start_offset=0, duration_months=1, curve=SL),
        ),
    )
    out = apply_scenario(inputs, _overrides(phase_slip_phase_id="construction", phase_slip_months=5))
    assert out.programme == inputs.programme


def test_phase_slip_is_a_no_op_on_a_programme_none_document():
    inputs = migrate_inputs_to_v9({})
    assert inputs.programme is None
    out = apply_scenario(inputs, _overrides(phase_slip_phase_id="planning", phase_slip_months=5))
    assert out.programme is None


def test_phase_slip_leaves_finance_and_equity_sources_untouched():
    """Spec Sec 12.2 facility invariance -- phase_slip writes nothing under
    finance or equity_sources."""
    doc = _with_slip(_network_doc(), "planning", 1)
    out = apply_scenario(doc, _overrides(phase_slip_phase_id="planning", phase_slip_months=6))
    assert out.finance == doc.finance
    assert out.equity_sources == doc.equity_sources


def test_phase_slip_composes_order_independently_with_the_other_four_levers():
    """Spec Sec 13 guard 7, at the apply_scenario level: chaining a phase_slip
    override with the four scalar-lever overrides, in either order, must produce
    an identical document -- the five levers write to disjoint fields."""
    doc = _network_doc(20)
    scalars = _overrides(
        gdv_adjustment_pct=5.0, construction_cost_adjustment_pct=-3.0,
        timeline_adjustment_months=2, interest_rate_adjustment_pct=1.0,
    )
    slip = _overrides(phase_slip_phase_id="planning", phase_slip_months=2)

    forward = apply_scenario(apply_scenario(doc, scalars), slip)
    backward = apply_scenario(apply_scenario(doc, slip), scalars)

    assert forward.unit_mix == backward.unit_mix
    assert forward.conversion_costs == backward.conversion_costs
    assert forward.finance == backward.finance
    assert forward.programme == backward.programme
    # Negative control: the combination must actually differ from either single
    # application, proving both levers are live rather than one silently no-oping.
    only_scalars = apply_scenario(doc, scalars)
    assert forward.programme != only_scalars.programme


# R13 spec Sec 19.8: the three levers stressing the investment case. ic_doc()'s
# fixture (fixtures/financial-model/t-investment-case.json) carries FOUR
# operating lines -- id l1 management (pct_of_gross_rent, 10), l2
# letting_and_re_letting (pct_of_gross_rent, 2), l3 insurance
# (fixed_pence_per_month, 25_000), l4 compliance_and_safety
# (fixed_pence_per_month, 8_000). Its cap_yield_pct is 5.5 and
# stabilised_occupancy_pct is 96. Mirror of the "Sec 19.8 the three exit
# levers" describe block in apply-scenario.test.ts.

def test_exit_yield_adds_percentage_points_to_the_capitalisation_yield():
    out = apply_scenario(ic_doc(), _overrides(exit_yield_adjustment_pct=1.5))
    assert out.investment_case.valuation.cap_yield_pct == pytest.approx(7.0)


def test_operating_cost_scales_every_line_value_on_both_bases():
    out = apply_scenario(ic_doc(), _overrides(operating_cost_adjustment_pct=10))
    lines = out.investment_case.operating_lines
    assert lines[0].value == pytest.approx(11)     # l1 management, 10% pct line -> 11
    assert lines[1].value == pytest.approx(2.2)     # l2 letting, 2% pct line -> 2.2
    assert lines[2].value == 27_500                 # l3 insurance, 25_000 fixed pence
    assert lines[3].value == 8_800                  # l4 compliance, 8_000 fixed pence


def test_vacancy_subtracts_percentage_points_from_stabilised_occupancy():
    out = apply_scenario(ic_doc(), _overrides(vacancy_adjustment_pct=6))
    assert out.investment_case.stabilisation.stabilised_occupancy_pct == pytest.approx(90.0)


def test_the_three_levers_are_a_no_op_by_construction_on_an_investment_case_none_document():
    """Exactly as phase_slip is on a programme=None document: a lever with
    nothing to write writes nothing -- it does not crash and it does not
    synthesise a block."""
    doc = explicit_refinance_doc()
    assert doc.investment_case is None
    out = apply_scenario(doc, _overrides(
        exit_yield_adjustment_pct=2, operating_cost_adjustment_pct=50, vacancy_adjustment_pct=10,
    ))
    assert out == doc
    assert out.investment_case is None


def test_keeps_all_nine_levers_order_independent():
    # sales_slip is inert on ic_doc() (no unit_sales) -- this test just needs
    # its tie-break slot in LEVER_ORDER exercised; test_keeps_all_nine_levers_
    # order_independent_on_a_unit_sales_document (below) is the live one.
    orders = [
        ["gdv", "construction_cost", "timeline", "interest_rate", "phase_slip",
         "exit_yield", "operating_cost", "vacancy", "sales_slip"],
        ["vacancy", "exit_yield", "phase_slip", "gdv", "operating_cost", "interest_rate",
         "timeline", "construction_cost", "sales_slip"],
        ["operating_cost", "timeline", "vacancy", "interest_rate", "gdv", "exit_yield",
         "construction_cost", "phase_slip", "sales_slip"],
    ]
    results = [run_appraisal(apply_levers_in_order(ic_doc(), order)).metrics for order in orders]
    assert results[1] == results[0]
    assert results[2] == results[0]


# R13b spec Sec 22.8. The ninth lever: sales_slip. Fixture X's rows are u1
# completion practical_completion+0, u2 +1, u3 unit_completions+1, u4 fixed
# month 20; term 24. Mirror of the "sales_slip lever" describe block in
# apply-scenario.test.ts.

def _slip(months: int) -> ScenarioOverrides:
    return ScenarioOverrides(label="s", gdv_adjustment_pct=0, construction_cost_adjustment_pct=0,
                             timeline_adjustment_months=0, interest_rate_adjustment_pct=0, sales_slip_months=months)


def test_sales_slip_adds_to_completion_only_fixed_or_anchored_additively():
    out = apply_scenario(unit_sales_doc(), _slip(3))
    rows = out.unit_sales.units
    assert rows[3].completion.month_offset == 23          # fixed 20 + 3
    assert rows[0].completion.anchor.offset_months == 3   # practical_completion + 0 -> + 3
    assert rows[1].completion.anchor.offset_months == 4   # + 1 -> + 4, stressed FROM its recorded position
    assert rows[3].exchange.month_offset == 11            # exchange untouched
    assert rows[0].exchange.anchor.offset_months == 0


def test_sales_slip_is_a_no_op_on_the_null_path():
    doc = unit_sales_doc({"unit_sales": None})
    assert apply_scenario(doc, _slip(3)).model_dump() == apply_scenario(doc, _slip(0)).model_dump()


_FIELD_OF = {
    "gdv": "gdv_adjustment_pct", "construction_cost": "construction_cost_adjustment_pct",
    "timeline": "timeline_adjustment_months", "interest_rate": "interest_rate_adjustment_pct",
    "exit_yield": "exit_yield_adjustment_pct", "operating_cost": "operating_cost_adjustment_pct",
    "vacancy": "vacancy_adjustment_pct", "sales_slip": "sales_slip_months",
}


def _overrides_for_lever(lever: str, value: float) -> ScenarioOverrides:
    return _slip(0).model_copy(update={_FIELD_OF[lever]: value})


def test_keeps_all_nine_levers_order_independent_on_a_unit_sales_document():
    levers = {"gdv": 5, "construction_cost": 5, "timeline": 2, "interest_rate": 1,
              "exit_yield": 0, "operating_cost": 0, "vacancy": 0, "sales_slip": 2}
    orders = [list(levers), list(reversed(levers)), ["sales_slip", "timeline", "gdv", "interest_rate", "construction_cost", "vacancy", "exit_yield", "operating_cost"]]
    def apply_in(order):
        doc = unit_sales_doc()
        for lever in order:
            doc = apply_scenario(doc, _overrides_for_lever(lever, levers[lever]))
        return run_appraisal(doc).metrics
    results = [apply_in(o) for o in orders]
    assert results[1] == results[0] and results[2] == results[0]
    assert apply_in(orders[0]).unit_sales["units"][3]["completion_month"] == 22  # 20 + 2, inside term 26


# R15b Task 8 (spec Sec 24): the sensitivity levers reach the cost plan in time.
# doc_z() (fixtures/financial-model/z-cost-plan-in-time.json via migrate_inputs_to_v14,
# tests/fixtures_cost_plan_in_time.py) carries no investment_case and no unit_sales --
# exit_yield/operating_cost/vacancy/sales_slip are no-ops on it, exactly as sales_slip
# is inert on ic_doc() in test_keeps_all_nine_levers_order_independent above. Its
# packages: pkg-enabling on strip_out (midpoint 6.5, months_from_base 12.5),
# pkg-structure/pkg-envelope/pkg-externals on construction (midpoint 10.5,
# months_from_base 16.5), pkg-mande on mande_fitout (SS off construction + 3 lag;
# midpoint 12.333..., months_from_base 18.333...) -- the exact figures
# test_cost_plan.py already pins. Mirror of the identically named describe block in
# apply-scenario.test.ts.

_NON_PHASE_SLIP_FIELD = {
    "gdv": "gdv_adjustment_pct", "construction_cost": "construction_cost_adjustment_pct",
    "timeline": "timeline_adjustment_months", "interest_rate": "interest_rate_adjustment_pct",
    "exit_yield": "exit_yield_adjustment_pct", "operating_cost": "operating_cost_adjustment_pct",
    "vacancy": "vacancy_adjustment_pct", "sales_slip": "sales_slip_months",
}

_LEVER_MAGNITUDE = {
    "gdv": 5, "construction_cost": 5, "timeline": 2, "interest_rate": 1,
    "exit_yield": 3, "operating_cost": 4, "vacancy": 2, "sales_slip": 2,
}


def _apply_lever_z(doc, lever: str):
    if lever == "phase_slip":
        return apply_scenario(doc, _slip(0).model_copy(update={
            "phase_slip_phase_id": "construction", "phase_slip_months": 1,
        }))
    field = _NON_PHASE_SLIP_FIELD[lever]
    return apply_scenario(doc, _slip(0).model_copy(update={field: _LEVER_MAGNITUDE[lever]}))


def _apply_in_order_z(order):
    d = parse(doc_z())
    for lever in order:
        d = _apply_lever_z(d, lever)
    return d


_Z_ORDERS = [
    ["gdv", "construction_cost", "timeline", "interest_rate", "phase_slip",
     "exit_yield", "operating_cost", "vacancy", "sales_slip"],
    ["vacancy", "exit_yield", "phase_slip", "gdv", "operating_cost", "interest_rate",
     "timeline", "construction_cost", "sales_slip"],
    ["operating_cost", "timeline", "vacancy", "interest_rate", "gdv", "exit_yield",
     "construction_cost", "phase_slip", "sales_slip"],
]


def test_keeps_all_nine_levers_order_independent_on_z_full_document_equality():
    # Review fix (Task 8): the requirement is full-document equality under the
    # nine-lever permutations -- the same shape test_sales_slip_is_a_no_op_on_the_
    # null_path (and the TS "composes order-independently with the other four
    # levers -- full document equality" test, "Fix round 1, Finding 4") already use
    # (model_dump() equality on the APPLIED DOCUMENT) -- not a derived-output proxy
    # like run_appraisal(...).metrics, which can pass while something the proxy did
    # not look at silently diverges.
    applied = [_apply_in_order_z(order) for order in _Z_ORDERS]
    dumped = [d.model_dump(mode="json") for d in applied]
    assert dumped[1] == dumped[0]
    assert dumped[2] == dumped[0]

    # Resolution (a): compute_cost_plan on Z under this non-trivial nine-lever
    # combination must ALSO yield identical inflation_pence per package and
    # inflation_total_pence regardless of the order the levers were applied in.
    plans = [
        compute_cost_plan(d, developed_area_sqm(d), len(d.unit_mix.units))
        for d in applied
    ]
    pence = lambda cp: {p.id: p.inflation_pence for p in cp.packages}  # noqa: E731
    assert pence(plans[1]) == pence(plans[0])
    assert pence(plans[2]) == pence(plans[0])
    assert plans[1].inflation_total_pence == plans[0].inflation_total_pence
    assert plans[2].inflation_total_pence == plans[0].inflation_total_pence


def test_construction_cost_plus_10_scales_inflation_pence_midpoint_and_factor_unchanged():
    base = compute_cost_plan(parse(doc_z()), 600.0, 4)   # developed_area_sqm(doc_z()) is 600; unit count 4
    stressed = apply_scenario(parse(doc_z()), _overrides(construction_cost_adjustment_pct=10))
    cp = compute_cost_plan(stressed, 600.0, 4)
    base_by_id = {p.id: p for p in base.packages}
    assert len(cp.packages) == len(base.packages)
    for p in cp.packages:
        b = base_by_id[p.id]
        # The inflation FACTOR depends only on months, which the cost lever
        # never touches -- bit-identical, not merely close.
        assert p.midpoint_month == b.midpoint_month
        assert p.months_from_base == b.months_from_base
        assert p.inflation_factor == b.inflation_factor
        expected = money_round(1.1 * b.inflation_pence)
        assert abs(p.inflation_pence - expected) <= 1
