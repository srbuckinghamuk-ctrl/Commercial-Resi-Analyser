"""R9 spec Sec 15 -- the area bridge. Mirror of frontend/src/lib/model/areas.ts.

The arithmetic order in ``area_bridge`` is normative and matches areas.ts
operation-for-operation, so both engines produce bit-identical IEEE-754 results
and the golden-fixture parity assertions can be exact rather than tolerant.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .engine import pct

AreaBasis = Literal["bridge_derived", "manual"]

# Every key here is ENTERED. Nothing derived is stored (spec Sec 15.1).
DEFAULT_AREA_BRIDGE: dict[str, Any] = {
    "basis": "manual",
    "existing_gia_sqm": 0.0,
    "demolished_gia_sqm": 0.0,
    "extension_gia_sqm": 0.0,
    "retained_commercial_gia_sqm": 0.0,
    "untouched_gia_sqm": 0.0,
    "circulation_common_sqm": 0.0,
    "plant_riser_sqm": 0.0,
    "store_bin_cycle_sqm": 0.0,
    "amenity_sqm": 0.0,
    "external_amenity_sqm": 0.0,
}


@dataclass(frozen=True)
class AreaBridgeResult:
    """Spec Sec 15.1/15.2. Mirrors AreaBridgeResult in areas.ts field for field."""

    basis: AreaBasis
    existing_gia_sqm: float
    demolished_gia_sqm: float
    extension_gia_sqm: float
    proposed_gia_sqm: float
    retained_commercial_gia_sqm: float
    untouched_gia_sqm: float
    developed_gia_sqm: float
    circulation_common_sqm: float
    plant_riser_sqm: float
    store_bin_cycle_sqm: float
    amenity_sqm: float
    available_for_units_sqm: float
    unit_nia_sqm: float
    unallocated_sqm: float
    external_amenity_sqm: float
    ancillary_balcony_terrace_sqm: float
    ancillary_parking_spaces: float
    developed_area_sqm: float
    #: The raw manual input (``conversion_costs.total_construction_sqm``),
    #: carried verbatim so consumers never read the field directly. Only the
    #: "manual basis differs from the bridge by more than 5%" warning in
    #: validation.py needs both the manual figure and the derived one side by
    #: side -- every other consumer wants ``developed_area_sqm`` instead.
    manual_area_sqm: float
    nia_to_gia_pct: float | None
    nia_to_proposed_gia_pct: float | None
    saleable_to_developed_pct: float | None


def unit_nia_sqm(units) -> float:
    """Sum of internal net internal area. Ancillary (balcony, terrace, parking)
    is deliberately excluded -- spec Sec 15.5 keeps it outside NIA."""
    return sum(u.floor_area_sqm for u in units)


def _bridge_inputs_of(inputs) -> dict[str, Any]:
    """A v2-v5 document has no ``areas`` block at all. Reading it with getattr
    (this module's version-dispatch idiom, matching validation.py's existing
    ``getattr(inputs, 'programme', None)`` checks) resolves it to the manual
    basis with a zeroed bridge -- exactly what migration writes, so legacy and
    migrated documents behave identically and no caller needs a version check.
    """
    raw = getattr(inputs, "areas", None)
    if raw is None:
        return dict(DEFAULT_AREA_BRIDGE)
    if not isinstance(raw, dict):
        raw = raw.model_dump() if hasattr(raw, "model_dump") else vars(raw)
    return {**DEFAULT_AREA_BRIDGE, **raw}


def area_bridge(inputs) -> AreaBridgeResult:
    a = _bridge_inputs_of(inputs)
    units = inputs.unit_mix.units

    proposed = a["existing_gia_sqm"] - a["demolished_gia_sqm"] + a["extension_gia_sqm"]
    developed = proposed - a["retained_commercial_gia_sqm"] - a["untouched_gia_sqm"]
    available = (
        developed
        - a["circulation_common_sqm"]
        - a["plant_riser_sqm"]
        - a["store_bin_cycle_sqm"]
        - a["amenity_sqm"]
    )

    nia = unit_nia_sqm(units)
    unallocated = available - nia

    # Saleable area is exit-coupled by design (spec Sec 15.2): it answers "what
    # proportion of the area being funded is being sold?", so a retain-all
    # scheme correctly reports 0%.
    retained_ids = {r.unit_id for r in inputs.exit_strategy.retained_units}
    route = inputs.exit_strategy.route
    if route == "retain_all":
        sold = []
    elif route == "sell_all":
        sold = list(units)
    else:
        sold = [u for u in units if u.id not in retained_ids]
    saleable_nia = unit_nia_sqm(sold)

    balcony = 0.0
    spaces = 0.0
    for u in units:
        anc = getattr(u, "ancillary", None)
        if anc is None:
            continue
        balcony += getattr(anc, "balcony_terrace_sqm", 0.0) or 0.0
        spaces += getattr(anc, "parking_spaces", 0) or 0

    cost_area = (
        developed
        if a["basis"] == "bridge_derived"
        else inputs.conversion_costs.total_construction_sqm
    )

    return AreaBridgeResult(
        basis=a["basis"],
        existing_gia_sqm=a["existing_gia_sqm"],
        demolished_gia_sqm=a["demolished_gia_sqm"],
        extension_gia_sqm=a["extension_gia_sqm"],
        proposed_gia_sqm=proposed,
        retained_commercial_gia_sqm=a["retained_commercial_gia_sqm"],
        untouched_gia_sqm=a["untouched_gia_sqm"],
        developed_gia_sqm=developed,
        circulation_common_sqm=a["circulation_common_sqm"],
        plant_riser_sqm=a["plant_riser_sqm"],
        store_bin_cycle_sqm=a["store_bin_cycle_sqm"],
        amenity_sqm=a["amenity_sqm"],
        available_for_units_sqm=available,
        unit_nia_sqm=nia,
        unallocated_sqm=unallocated,
        external_amenity_sqm=a["external_amenity_sqm"],
        ancillary_balcony_terrace_sqm=balcony,
        ancillary_parking_spaces=spaces,
        developed_area_sqm=cost_area,
        manual_area_sqm=inputs.conversion_costs.total_construction_sqm,
        nia_to_gia_pct=pct(nia, developed),
        nia_to_proposed_gia_pct=pct(nia, proposed),
        saleable_to_developed_pct=pct(saleable_nia, developed),
    )


def developed_area_sqm(inputs) -> float:
    """**The** construction cost area. Spec Sec 15.3/15.4.

    Every consumer calls this and nothing else.
    ``conversion_costs.total_construction_sqm`` is off-limits outside this
    module, enforced by tests/test_accessor_guard.py and, on the TypeScript
    side, by the eslint rule in frontend/eslint.config.js.
    """
    return area_bridge(inputs).developed_area_sqm
