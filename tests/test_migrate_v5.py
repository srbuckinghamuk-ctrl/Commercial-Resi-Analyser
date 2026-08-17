import pytest
from pydantic import ValidationError

from app.financial_model.migrate import (
    migrate_inputs_to_v4, migrate_inputs_to_v5, migrate_v4_to_v5,
)
from app.financial_model.types import (
    AcquisitionInputs,
    AcquisitionInputsV5,
    CalculatorInputsV4,
    CalculatorInputsV5,
    parse_calculator_inputs,
)


@pytest.fixture
def v1_doc():
    return {"inputs_version": 1}


def test_v4_to_v5_stamps_migrated_default(v1_doc):
    v5 = migrate_v4_to_v5(migrate_inputs_to_v4(v1_doc))
    assert v5.inputs_version == 5
    assert v5.acquisition.jurisdiction == "england_ni"
    assert v5.acquisition.jurisdiction_source == "migrated_default"
    assert v5.acquisition.jurisdiction_evidence_status == "unconfirmed"
    assert v5.acquisition.acquisition_date is None
    assert v5.acquisition.acquisition_tax_override_pence is None
    assert v5.acquisition.acquisition_tax_override_reason == ""


def test_v4_to_v5_carries_other_fields_unchanged(v1_doc):
    # migrate_inputs_to_v4 returns a plain dict (module convention -- see
    # migrate.py's docstring); validate it once so this test can assert via
    # attribute access without changing that function's dict-returning
    # contract, which app.py and the rest of the v2-v4 test suite rely on.
    v4_dict = migrate_inputs_to_v4(v1_doc)
    v4 = CalculatorInputsV4.model_validate(v4_dict)
    v5 = migrate_v4_to_v5(v4_dict)
    assert v5.acquisition.purchase_price_pence == v4.acquisition.purchase_price_pence
    assert v5.acquisition.legal_fees_pence == v4.acquisition.legal_fees_pence
    assert v5.finance == v4.finance
    assert v5.unit_mix == v4.unit_mix


@pytest.mark.parametrize("version", [1, 2, 3, 4])
def test_any_version_normalises_to_v5(version):
    v5 = migrate_inputs_to_v5({"inputs_version": version})
    assert v5.inputs_version == 5


def test_double_migration_is_refused(v1_doc):
    v5 = migrate_inputs_to_v5(v1_doc)
    with pytest.raises(ValueError, match="already a v5 document"):
        migrate_v4_to_v5(v5)


def test_saved_v5_round_trips_confirmed_jurisdiction(v1_doc):
    v5 = migrate_inputs_to_v5(v1_doc)
    doc = v5.model_dump(mode="json")
    doc["acquisition"]["jurisdiction"] = "scotland"
    doc["acquisition"]["jurisdiction_source"] = "user"
    doc["acquisition"]["jurisdiction_evidence_status"] = "confirmed"
    doc["acquisition"]["acquisition_date"] = "2026-05-01"
    again = migrate_inputs_to_v5(doc)
    assert again.acquisition.jurisdiction == "scotland"
    assert again.acquisition.jurisdiction_source == "user"
    assert again.acquisition.jurisdiction_evidence_status == "confirmed"
    assert again.acquisition.acquisition_date == "2026-05-01"


def test_parse_dispatches_on_version_5(v1_doc):
    doc = migrate_inputs_to_v5(v1_doc).model_dump(mode="json")
    parsed = parse_calculator_inputs(doc)
    assert parsed.inputs_version == 5
    assert parsed.acquisition.jurisdiction == "england_ni"


def test_v5_acquisition_field_is_narrowed_not_the_base_class(v1_doc):
    """Task 4 ambiguity #3: CalculatorInputsV5 subclasses CalculatorInputsV4,
    whose ``acquisition`` field is typed AcquisitionInputs; V5 narrows it to
    AcquisitionInputsV5. Confirm Pydantic actually validates/enforces that
    narrowed type at the boundary rather than silently accepting a
    base-class AcquisitionInputs instance (which would lack jurisdiction
    etc.) wherever a v5 document is constructed directly in Python rather
    than parsed from a dict."""
    v5 = migrate_inputs_to_v5(v1_doc)
    assert type(v5.acquisition) is AcquisitionInputsV5

    doc = v5.model_dump(mode="json")
    base_acquisition = AcquisitionInputs(
        purchase_price_pence=0, legal_fees_pence=0, survey_cost_pence=0,
        broker_fee_pct=0, other_acquisition_costs_pence=0,
    )
    with pytest.raises(ValidationError):
        CalculatorInputsV5(**{**doc, "acquisition": base_acquisition})
