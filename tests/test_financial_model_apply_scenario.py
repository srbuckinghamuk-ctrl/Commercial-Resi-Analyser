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

from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.migrate import migrate_inputs_to_v6
from app.financial_model.types import (
    CalculatorInputsV6,
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
