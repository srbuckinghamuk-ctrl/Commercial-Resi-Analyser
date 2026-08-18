"""R9 (spec Sec 15) -- the inputs v5 -> v6 migration.

Python twin of the `R9 - v5 to v6 migration` describe block in
frontend/src/lib/model/migrate.test.ts, plus the numerical-identity gate that
is this task's real acceptance test.
"""
import json
from dataclasses import asdict
from pathlib import Path
from typing import get_args

import pytest

from app.financial_model import parse_calculator_inputs, run_appraisal
from app.financial_model.areas import DEFAULT_AREA_BRIDGE
from app.financial_model.migrate import (
    DEFAULT_AREA_BRIDGE_DICT,
    is_v6,
    migrate_inputs_to_v5,
    migrate_inputs_to_v6,
    migrate_v5_to_v6,
)
from app.financial_model.types import (
    AreaBasis,
    AreaBridgeInputs,
    CalculatorInputsV6,
    UnitAncillary,
    parse_calculator_inputs as parse_types,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


@pytest.fixture
def v1_doc():
    return {"inputs_version": 1}


def _v5(v1_doc):
    return migrate_inputs_to_v5(v1_doc)


def test_v5_to_v6_stamps_inputs_version_6(v1_doc):
    assert migrate_v5_to_v6(_v5(v1_doc)).inputs_version == 6


def test_v5_to_v6_defaults_the_area_basis_to_manual_so_no_cost_area_moves(v1_doc):
    v5 = _v5(v1_doc)
    v6 = migrate_v5_to_v6(v5)
    assert v6.areas.basis == "manual"
    assert v6.areas.existing_gia_sqm == 0.0
    assert (
        v6.conversion_costs.total_construction_sqm
        == v5.conversion_costs.total_construction_sqm
    )


def test_v5_to_v6_gives_every_unit_a_zeroed_ancillary_block(v1_doc):
    doc = _v5(v1_doc).model_dump(mode="json")
    doc["unit_mix"] = {"units": [{
        "id": "u1", "type": "1bed", "floor_area_sqm": 50.0,
        "estimated_value_pence": 25_000_000, "comparable_notes": "",
    }]}
    v6 = migrate_v5_to_v6(doc)
    assert v6.unit_mix.units[0].ancillary == UnitAncillary(
        balcony_terrace_sqm=0.0,
        balcony_terrace_value_pence=0,
        parking_spaces=0,
        parking_value_pence=0,
    )


def test_v5_to_v6_refuses_to_double_migrate(v1_doc):
    v6 = migrate_v5_to_v6(_v5(v1_doc))
    with pytest.raises(ValueError, match="already a v6 document"):
        migrate_v5_to_v6(v6)
    # And via the dict path, which takes the other guard branch.
    with pytest.raises(ValueError, match="already a v6 document"):
        migrate_v5_to_v6(v6.model_dump(mode="json"))


@pytest.mark.parametrize("version", [7, 99])
def test_unrecognised_inputs_version_is_refused_not_routed_to_the_v1_fallback(version):
    """R8's silent-corruption bug, guarded forward: migrate_inputs_to_v4 had no
    v5 guard, so a v5 document fell to the v1 fallback, was rebuilt from
    ltv_pct and came back a 201."""
    with pytest.raises(ValueError, match="unrecognised inputs_version"):
        migrate_inputs_to_v6({"inputs_version": version})


def test_document_tagged_v6_that_fails_the_structural_check_is_refused():
    with pytest.raises(ValueError, match="fails the v6 structural check"):
        migrate_inputs_to_v6({"inputs_version": 6, "finance": "not a dict"})


@pytest.mark.parametrize("version", [1, 2, 3, 4])
def test_any_earlier_version_normalises_to_v6(version):
    # Stops at 4 for the same reason test_migrate_v5's twin does: a bare
    # ``{"inputs_version": 5}`` declares v5 without being structurally v5, and
    # that shape is deliberately refused rather than routed to the v1 fallback.
    v6 = migrate_inputs_to_v6({"inputs_version": version})
    assert v6.inputs_version == 6
    assert v6.areas.basis == "manual"
    assert v6.acquisition.jurisdiction_source == "migrated_default"


def test_a_real_v5_document_normalises_to_v6(v1_doc):
    v6 = migrate_inputs_to_v6(_v5(v1_doc).model_dump(mode="json"))
    assert v6.inputs_version == 6
    assert v6.areas.basis == "manual"


def test_already_v6_document_is_merged_onto_defaults_not_re_migrated(v1_doc):
    saved = migrate_v5_to_v6(_v5(v1_doc)).model_dump(mode="json")
    saved["project_id"] = "kept"
    assert migrate_inputs_to_v6(saved).project_id == "kept"


def test_v6_merge_branch_default_fills_a_row_that_predates_a_schema_field(v1_doc):
    """Mirrors test_migrate_inputs_to_v5_merges_a_partial_v5_snapshot_onto_
    defaults. A v6 row saved before a schema field existed must be
    default-filled, not 422'd at the boundary or under-filled."""
    saved = migrate_v5_to_v6(_v5(v1_doc)).model_dump(mode="json")
    del saved["deal_spider"]["weights"]
    del saved["scenarios"]["upside"]
    del saved["areas"]["external_amenity_sqm"]

    again = migrate_inputs_to_v6(saved)

    assert again.inputs_version == 6
    assert len(again.deal_spider.weights) == 9
    assert again.scenarios.upside.label == "Upside"
    assert again.areas.external_amenity_sqm == 0.0


def test_v6_merge_branch_preserves_a_populated_bridge(v1_doc):
    """The merge must not clobber a bridge the user actually filled in --
    the R8 `setdefault` lesson (finding 3), which would otherwise silently
    reset a selected `bridge_derived` basis on every save."""
    saved = migrate_v5_to_v6(_v5(v1_doc)).model_dump(mode="json")
    saved["areas"]["basis"] = "bridge_derived"
    saved["areas"]["existing_gia_sqm"] = 600.0

    again = migrate_inputs_to_v6(saved)

    assert again.areas.basis == "bridge_derived"
    assert again.areas.existing_gia_sqm == 600.0


def test_v5_to_v6_preserves_pre_existing_areas_and_ancillary(v1_doc):
    doc = _v5(v1_doc).model_dump(mode="json")
    doc["areas"] = {"basis": "bridge_derived", "existing_gia_sqm": 600.0}
    doc["unit_mix"] = {"units": [{
        "id": "u1", "type": "1bed", "floor_area_sqm": 50.0,
        "estimated_value_pence": 25_000_000, "comparable_notes": "",
        "ancillary": {"balcony_terrace_sqm": 8.0, "parking_spaces": 1},
    }]}

    v6 = migrate_v5_to_v6(doc)

    assert v6.areas.basis == "bridge_derived"
    assert v6.areas.existing_gia_sqm == 600.0
    # Absent bridge keys are still zero-filled.
    assert v6.areas.amenity_sqm == 0.0
    assert v6.unit_mix.units[0].ancillary.balcony_terrace_sqm == 8.0
    assert v6.unit_mix.units[0].ancillary.parking_spaces == 1
    # Absent ancillary keys are still zero-filled.
    assert v6.unit_mix.units[0].ancillary.parking_value_pence == 0


def test_migrate_inputs_to_v5_refuses_a_v6_document(v1_doc):
    """The v6 half of migrate_inputs_to_v4's is_v5 refusal. The unrecognised-
    version roster fires first (6 is not in (1,2,3,4,5)), which is itself the
    load-bearing guard; either way the v5 entry point must never downgrade a
    v6 document by dropping `areas` and every unit's `ancillary`."""
    v6_doc = migrate_v5_to_v6(_v5(v1_doc)).model_dump(mode="json")
    with pytest.raises(ValueError, match="unrecognised inputs_version 6|v6 document"):
        migrate_inputs_to_v5(v6_doc)


def test_is_v6_gates_on_the_container_never_on_a_unit_attribute(v1_doc):
    v6 = migrate_v5_to_v6(_v5(v1_doc))
    assert is_v6(v6.model_dump(mode="json")) is True
    assert is_v6(_v5(v1_doc).model_dump(mode="json")) is False
    assert isinstance(v6, CalculatorInputsV6)
    assert not isinstance(_v5(v1_doc), CalculatorInputsV6)


def test_parse_dispatches_on_version_6(v1_doc):
    doc = migrate_v5_to_v6(_v5(v1_doc)).model_dump(mode="json")
    parsed = parse_calculator_inputs(doc)
    assert parsed.inputs_version == 6
    assert type(parsed) is CalculatorInputsV6
    assert parse_types(doc).inputs_version == 6


def test_area_basis_literal_matches_the_areas_module():
    """types.py re-declares AreaBasis rather than importing it from areas.py
    (types -> areas -> engine -> types would be a cycle). Bind the two literal
    value-sets together so a future basis can't be added to one alone."""
    from app.financial_model import areas as areas_module

    assert set(get_args(AreaBasis)) == set(get_args(areas_module.AreaBasis))


def test_migrate_default_area_bridge_matches_the_areas_module():
    """migrate.py re-declares the zeroed bridge for the same cycle reason.
    Pin the two dicts equal, and pin both against the Pydantic model's own
    defaults, so all three cannot drift."""
    assert DEFAULT_AREA_BRIDGE_DICT == DEFAULT_AREA_BRIDGE
    assert AreaBridgeInputs().model_dump() == DEFAULT_AREA_BRIDGE


def _pipeline_fixtures():
    for path in sorted(FIXTURES.glob("*.json")):
        doc = json.loads(path.read_text())
        if doc.get("kind") == "sensitivity":
            continue  # names a base_fixture instead of carrying inputs
        yield path.name, doc


def test_v6_migration_moves_no_existing_figure():
    """The acceptance gate for R9's migration: every existing fixture, run
    before and after migration to v6, must produce identical output.

    This is what makes 'purely additive' a tested claim rather than an
    assertion. If a single figure moves, the migration is wrong -- not the
    fixture."""
    names = []
    for name, doc in _pipeline_fixtures():
        names.append(name)
        before = run_appraisal(parse_calculator_inputs(doc["inputs"]))
        after = run_appraisal(migrate_inputs_to_v6(doc["inputs"]))
        # asdict, not model_dump: AppraisalResultV2 is a dataclass on the
        # Python side, not a Pydantic model.
        assert asdict(before.metrics) == asdict(after.metrics), (
            f"{name}: migration to v6 changed a computed figure"
        )
        # The metrics object is the headline, but a migration defect could
        # equally move a ledger figure the metrics happen not to surface.
        assert asdict(before.model) == asdict(after.model), (
            f"{name}: migration to v6 changed a ledger figure"
        )
        assert asdict(before.schedule) == asdict(after.schedule), (
            f"{name}: migration to v6 changed a schedule figure"
        )
    # The corpus is loaded by directory scan, so an empty glob would make the
    # loop above vacuously pass.
    assert len(names) == 8, names
