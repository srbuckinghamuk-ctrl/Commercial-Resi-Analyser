"""R9 spec Sec 15 — the Python half of the area bridge.

Every expectation here is the same number asserted by the TypeScript
areas.test.ts. The two suites are written independently against the spec, not
ported from one another, so a shared misreading cannot pass both.
"""
import pytest

from app.financial_model.areas import (
    DEFAULT_AREA_BRIDGE,
    area_bridge,
    developed_area_sqm,
    unit_nia_sqm,
)
from app.financial_model.types import ProposedUnitV6, UnitAncillary

FULL_BRIDGE = {
    "basis": "bridge_derived",
    "existing_gia_sqm": 600.0,
    "demolished_gia_sqm": 20.0,
    "extension_gia_sqm": 40.0,
    "retained_commercial_gia_sqm": 100.0,
    "untouched_gia_sqm": 0.0,
    "circulation_common_sqm": 62.0,
    "plant_riser_sqm": 18.0,
    "store_bin_cycle_sqm": 14.0,
    "amenity_sqm": 6.0,
    "external_amenity_sqm": 150.0,
}


class _Unit:
    def __init__(self, uid, area, ancillary=None):
        self.id = uid
        self.floor_area_sqm = area
        self.ancillary = ancillary


class _Exit:
    def __init__(self, route="sell_all", retained=()):
        self.route = route
        self.retained_units = [type("R", (), {"unit_id": u})() for u in retained]


class _Inputs:
    """Duck-typed stand-in. areas.py reads only these four attributes, so the
    full Pydantic model is unnecessary here and would obscure what is read."""

    def __init__(self, areas=None, units=(), manual_sqm=0.0, route="sell_all", retained=()):
        self.areas = areas
        self.unit_mix = type("UM", (), {"units": list(units)})()
        self.conversion_costs = type("CC", (), {"total_construction_sqm": manual_sqm})()
        self.exit_strategy = _Exit(route, retained)


def make(areas_overrides=None, units=(), **kw):
    areas = None
    if areas_overrides is not None:
        areas = {**DEFAULT_AREA_BRIDGE, **areas_overrides}
    return _Inputs(areas=areas, units=units, **kw)


def test_proposed_gia_is_existing_less_demolished_plus_extension():
    assert area_bridge(make(FULL_BRIDGE)).proposed_gia_sqm == 620.0


def test_developed_gia_removes_retained_commercial_and_untouched():
    assert area_bridge(make(FULL_BRIDGE)).developed_gia_sqm == 520.0


def test_available_for_units_removes_non_saleable_internal_area():
    assert area_bridge(make(FULL_BRIDGE)).available_for_units_sqm == 420.0


def test_unallocated_balance_is_reported_not_hidden():
    b = area_bridge(make(FULL_BRIDGE, units=[_Unit("u1", 60.0), _Unit("u2", 60.0)]))
    assert b.unit_nia_sqm == 120.0
    assert b.unallocated_sqm == 300.0


def test_unallocated_balance_goes_negative_when_units_overfill():
    b = area_bridge(make(FULL_BRIDGE, units=[_Unit("u1", 500.0)]))
    assert b.unallocated_sqm == -80.0


def test_external_amenity_never_enters_the_reconciliation():
    with_ext = area_bridge(make(FULL_BRIDGE))
    without = area_bridge(make({**FULL_BRIDGE, "external_amenity_sqm": 0.0}))
    assert with_ext.developed_gia_sqm == without.developed_gia_sqm
    assert with_ext.available_for_units_sqm == without.available_for_units_sqm
    assert with_ext.external_amenity_sqm == 150.0


def test_nia_to_gia_is_the_policy_ratio():
    b = area_bridge(make(FULL_BRIDGE, units=[_Unit("u1", 200.0), _Unit("u2", 160.0)]))
    assert b.nia_to_gia_pct == 69.23


def test_nia_to_proposed_gia_covers_the_whole_building():
    b = area_bridge(make(FULL_BRIDGE, units=[_Unit("u1", 200.0), _Unit("u2", 160.0)]))
    assert b.nia_to_proposed_gia_pct == 58.06


def test_saleable_efficiency_counts_only_units_being_sold():
    b = area_bridge(make(
        FULL_BRIDGE, units=[_Unit("u1", 200.0), _Unit("u2", 160.0)],
        route="blended", retained=["u2"],
    ))
    assert b.saleable_to_developed_pct == 38.46


def test_retain_all_reports_zero_saleable_efficiency():
    b = area_bridge(make(
        FULL_BRIDGE, units=[_Unit("u1", 200.0), _Unit("u2", 160.0)], route="retain_all",
    ))
    assert b.saleable_to_developed_pct == 0


@pytest.mark.parametrize(
    "field", ["nia_to_gia_pct", "nia_to_proposed_gia_pct", "saleable_to_developed_pct"],
)
def test_zero_denominator_is_none_never_zero(field):
    b = area_bridge(make({"basis": "bridge_derived"}, units=[_Unit("u1", 200.0)]))
    assert b.developed_gia_sqm == 0.0
    assert getattr(b, field) is None


def test_bridge_basis_uses_the_derived_area_and_ignores_the_manual_field():
    assert developed_area_sqm(make(FULL_BRIDGE, manual_sqm=999.0)) == 520.0


def test_manual_basis_uses_the_manual_field_and_ignores_a_populated_bridge():
    inputs = make({**FULL_BRIDGE, "basis": "manual"}, manual_sqm=480.0)
    assert developed_area_sqm(inputs) == 480.0


def test_document_with_no_areas_block_falls_back_to_manual():
    legacy = make(None, manual_sqm=500.0)
    assert developed_area_sqm(legacy) == 500.0
    assert area_bridge(legacy).basis == "manual"


def test_unit_nia_excludes_ancillary_area():
    anc = type("A", (), {"balcony_terrace_sqm": 8.0, "parking_spaces": 1})()
    assert unit_nia_sqm([_Unit("u1", 50.0, anc)]) == 50.0


# --- R9 Task 3: the ancillary tally, now that ProposedUnitV6 exists ---------
#
# area_bridge already computed these two fields, but no unit type carried an
# `ancillary` block until inputs v6, so both code paths were unreachable and
# untested. These are the Python twin of the `ancillary tally` block in
# frontend/src/lib/model/areas.test.ts.


def _v6_unit(uid, area, **anc):
    return ProposedUnitV6(
        id=uid, type="1bed", floor_area_sqm=area,
        estimated_value_pence=1, comparable_notes="",
        ancillary=UnitAncillary(**anc),
    )


def test_ancillary_areas_and_spaces_tally_across_units():
    b = area_bridge(make(FULL_BRIDGE, units=[
        _v6_unit("u1", 50.0, balcony_terrace_sqm=8.0, parking_spaces=1),
        _v6_unit("u2", 60.0, balcony_terrace_sqm=4.5, parking_spaces=2),
        _v6_unit("u3", 40.0),  # zeroed block: contributes nothing
    ]))
    assert b.ancillary_balcony_terrace_sqm == 12.5
    assert b.ancillary_parking_spaces == 3


def test_ancillary_never_enters_nia_or_the_reconciliation():
    """Spec Sec 15.5: ancillary sits outside NIA, so it can neither inflate the
    unit area total nor shrink the unallocated balance."""
    units = [
        _v6_unit("u1", 50.0, balcony_terrace_sqm=8.0, parking_spaces=1),
        _v6_unit("u2", 60.0, balcony_terrace_sqm=4.5, parking_spaces=2),
        _v6_unit("u3", 40.0),
    ]
    with_anc = area_bridge(make(FULL_BRIDGE, units=units))
    without = area_bridge(make(FULL_BRIDGE, units=[
        _v6_unit("u1", 50.0), _v6_unit("u2", 60.0), _v6_unit("u3", 40.0),
    ]))
    assert with_anc.unit_nia_sqm == 150.0 == without.unit_nia_sqm
    assert with_anc.unallocated_sqm == without.unallocated_sqm
    assert with_anc.available_for_units_sqm == without.available_for_units_sqm


def test_a_pre_v6_unit_with_no_ancillary_block_tallies_zero():
    b = area_bridge(make(FULL_BRIDGE, units=[_Unit("u1", 50.0), _Unit("u2", 60.0)]))
    assert b.ancillary_balcony_terrace_sqm == 0.0
    assert b.ancillary_parking_spaces == 0
