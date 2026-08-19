"""R10 (spec Sec 16) -- the inputs v6 -> v7 migration.

Python twin of the `migrateV6toV7` and `migrateInputsToV7 refusals` describe
blocks in frontend/src/lib/model/migrate.test.ts.
"""
import pytest

from app.financial_model import parse_calculator_inputs
from app.financial_model.migrate import (
    is_v2_or_later,
    is_v7,
    migrate_inputs_to_v6,
    migrate_inputs_to_v7,
    migrate_v6_to_v7,
)
from app.financial_model.types import CalculatorInputsV7


@pytest.fixture
def v1_doc():
    return {"inputs_version": 1}


def _v6(v1_doc):
    return migrate_inputs_to_v6(v1_doc)


def test_v6_to_v7_stamps_inputs_version_7(v1_doc):
    assert migrate_v6_to_v7(_v6(v1_doc)).inputs_version == 7


def test_v6_to_v7_produces_headline_mode_with_no_packages_and_three_contingency_classes_in_order(
    v1_doc,
):
    v7 = migrate_v6_to_v7(_v6(v1_doc))
    assert v7.cost_plan.mode == "headline"
    assert v7.cost_plan.packages == []
    assert [c.name for c in v7.cost_plan.contingency] == [
        "general", "existing_building", "abnormal",
    ]


def test_v6_to_v7_carries_contingency_pct_onto_general_and_zeroes_the_other_two(v1_doc):
    v6 = _v6(v1_doc)
    v6 = v6.model_copy(update={
        "conversion_costs": v6.conversion_costs.model_copy(
            update={"contingency_pct": 12.5}
        ),
    })
    v7 = migrate_v6_to_v7(v6)
    assert [c.pct for c in v7.cost_plan.contingency] == [12.5, 0, 0]
    assert all(c.basis == "all_packages" for c in v7.cost_plan.contingency)


def test_v6_to_v7_converts_all_eight_fee_fields_with_the_correct_categories(v1_doc):
    # building_control is STATUTORY despite sitting in the professional block of
    # ConversionCostInputs. Classifying it as professional would leave every
    # grand total correct while moving money between two reported lines --
    # so these categories are pinned as literal strings, never recomputed
    # from FEE_CODE_CATEGORY (a test that recomputed would agree with a
    # miscategorisation forever).
    v6 = _v6(v1_doc)
    v6 = v6.model_copy(update={
        "conversion_costs": v6.conversion_costs.model_copy(update={
            "architect_pence": 1_500_000,
            "structural_engineer_pence": 500_000,
            "mande_pence": 500_000,
            "planning_consultant_pence": 300_000,
            "other_professional_fees_pence": 0,
            "building_control_pence": 200_000,
            "cil_s106_pence": 700_000,
            "prior_approval_fee_per_dwelling_pence": 9_600,
        }),
    })
    v7 = migrate_v6_to_v7(v6)
    by_code = {f.code: f for f in v7.cost_plan.fee_lines}
    assert len(v7.cost_plan.fee_lines) == 8
    assert all(f.basis == "fixed" for f in v7.cost_plan.fee_lines)
    assert by_code["building_control"].category == "statutory"
    assert by_code["cil_s106"].category == "statutory"
    assert by_code["prior_approval"].category == "statutory"
    assert by_code["prior_approval"].per_dwelling is True
    assert by_code["architect"].category == "professional"
    assert by_code["architect"].amount_pence == 1_500_000
    assert by_code["mande"].per_dwelling is False


def test_v6_to_v7_refuses_to_double_migrate(v1_doc):
    v7 = migrate_v6_to_v7(_v6(v1_doc))
    with pytest.raises(ValueError, match="already a v7 document"):
        migrate_v6_to_v7(v7)
    # And via the dict path, which takes the other guard branch.
    with pytest.raises(ValueError, match="already a v7 document"):
        migrate_v6_to_v7(v7.model_dump(mode="json"))


@pytest.mark.parametrize("version", [8, 99])
def test_unrecognised_inputs_version_is_refused_not_routed_to_the_v1_fallback(version):
    """R8's silent-corruption bug, guarded forward: an unrecognised
    inputs_version must fail loudly rather than falling through every is_vN
    check into the v1 fallback, which reads the document as noise and
    rebuilds finance/equity_sources from an LTV-based heuristic."""
    with pytest.raises(ValueError, match="unrecognised inputs_version"):
        migrate_inputs_to_v7({"inputs_version": version})


def test_document_tagged_v7_that_fails_the_structural_check_is_refused():
    with pytest.raises(ValueError, match="fails the v7 structural check"):
        migrate_inputs_to_v7({"inputs_version": 7, "finance": "not a dict"})


@pytest.mark.parametrize("version", [1, 2, 3, 4])
def test_any_earlier_version_normalises_to_v7(version):
    # Stops at 4 for the same reason test_migrate_v6's twin does: a bare
    # {"inputs_version": 5} declares v5 without being structurally v5, and
    # that shape is deliberately refused rather than routed to the v1
    # fallback.
    v7 = migrate_inputs_to_v7({"inputs_version": version})
    assert v7.inputs_version == 7
    assert v7.cost_plan.mode == "headline"
    assert v7.cost_plan.packages == []


def test_a_real_v6_document_normalises_to_v7(v1_doc):
    v7 = migrate_inputs_to_v7(_v6(v1_doc).model_dump(mode="json"))
    assert v7.inputs_version == 7
    assert v7.cost_plan.mode == "headline"


def test_already_v7_document_is_merged_onto_defaults_not_re_migrated(v1_doc):
    saved = migrate_v6_to_v7(_v6(v1_doc)).model_dump(mode="json")
    saved["project_id"] = "kept"
    assert migrate_inputs_to_v7(saved).project_id == "kept"


def test_v7_merge_branch_default_fills_a_row_that_predates_a_schema_field(v1_doc):
    """Mirrors test_v6_merge_branch_default_fills_a_row_that_predates_a_schema_field.
    A v7 row saved before a schema field existed must be default-filled, not
    422'd at the boundary or under-filled."""
    saved = migrate_v6_to_v7(_v6(v1_doc)).model_dump(mode="json")
    del saved["deal_spider"]["weights"]
    del saved["scenarios"]["upside"]
    del saved["areas"]["external_amenity_sqm"]

    again = migrate_inputs_to_v7(saved)

    assert again.inputs_version == 7
    assert len(again.deal_spider.weights) == 9
    assert again.scenarios.upside.label == "Upside"
    assert again.areas.external_amenity_sqm == 0.0


def test_v7_merge_branch_preserves_a_populated_cost_plan(v1_doc):
    saved = migrate_v6_to_v7(_v6(v1_doc)).model_dump(mode="json")
    saved["cost_plan"]["mode"] = "detailed"
    saved["cost_plan"]["packages"] = [{
        "id": "p1", "code": "structure", "label": "Structure",
        "amount_pence": 1_000_000, "contingency_class": "general",
        "lender_eligible": True, "notes": "",
    }]

    again = migrate_inputs_to_v7(saved)

    assert again.cost_plan.mode == "detailed"
    assert again.cost_plan.packages[0].amount_pence == 1_000_000


def test_is_v7_gates_on_the_container_never_on_a_unit_attribute(v1_doc):
    v7 = migrate_v6_to_v7(_v6(v1_doc))
    assert is_v7(v7.model_dump(mode="json")) is True
    assert is_v7(_v6(v1_doc).model_dump(mode="json")) is False
    assert isinstance(v7, CalculatorInputsV7)


def test_is_v2_or_later_recognises_a_v7_document(v1_doc):
    """The boundary just moved to v7 (app.py, Task 6 step 5): a v7 raw
    payload must not be misclassified as a v1 document -- that would tag a
    fully-migrated v7 appraisal 'legacy_unreconciled'."""
    v7 = migrate_v6_to_v7(_v6(v1_doc)).model_dump(mode="json")
    assert is_v2_or_later(v7) is True


def test_parse_dispatches_on_version_7(v1_doc):
    doc = migrate_v6_to_v7(_v6(v1_doc)).model_dump(mode="json")
    parsed = parse_calculator_inputs(doc)
    assert parsed.inputs_version == 7
    assert type(parsed) is CalculatorInputsV7
