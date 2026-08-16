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
from app.financial_model.types import ScenarioOverrides, parse_calculator_inputs

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
    Fixture F has 12-month term; adding 3.0 yields 15."""
    out = apply_scenario(_base(), _overrides(timeline_adjustment_months=3.0))
    assert out.finance.term_months == 15
