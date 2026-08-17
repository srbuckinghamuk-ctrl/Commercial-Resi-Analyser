from typing import get_args

import pytest
from pydantic import ValidationError

from app.financial_model.acquisition_tax import Jurisdiction as TaxJurisdiction
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


def test_migrate_inputs_to_v4_refuses_a_v5_document(v1_doc):
    """Fix round 1, finding 1 (CRITICAL). Mirrors migrate.ts:245's isV5 guard
    and migrate_inputs_to_v3's existing is_v4 refusal (migrate.py:550-554).
    Without this, a v5 snapshot fails every is_v2/is_v3/is_v4 check in the
    chain and falls through to migrate_inputs' v1 fallback path, which reads
    the R8 acquisition fields as noise and silently rebuilds
    finance/equity_sources from the v1 LTV heuristic -- no exception, no
    flag, six fields gone."""
    v5_doc = migrate_inputs_to_v5(v1_doc).model_dump(mode="json")
    with pytest.raises(ValueError, match="v5 document"):
        migrate_inputs_to_v4(v5_doc)


def test_v4_to_v5_preserves_pre_existing_jurisdiction_fields(v1_doc):
    """Fix round 1, finding 3. migrate_v4_to_v5 uses `setdefault` (mirroring
    TS `existing.jurisdiction ?? 'england_ni'`) so a v4 snapshot that already
    carries real R8 values -- e.g. this function called a second time, or a
    hand-edited row -- keeps them rather than being clobbered back to the
    migrated-default/unconfirmed values. Unconditional assignment instead of
    setdefault would pass every other test in this file (none of them feed a
    pre-populated jurisdiction into migrate_v4_to_v5) while silently
    discarding a user's confirmed jurisdiction on every subsequent save."""
    v4 = migrate_inputs_to_v4(v1_doc)
    v4["acquisition"]["jurisdiction"] = "wales"
    v4["acquisition"]["jurisdiction_source"] = "user"
    v4["acquisition"]["jurisdiction_evidence_status"] = "confirmed"
    v4["acquisition"]["acquisition_date"] = "2026-01-15"

    v5 = migrate_v4_to_v5(v4)

    assert v5.acquisition.jurisdiction == "wales"
    assert v5.acquisition.jurisdiction_source == "user"
    assert v5.acquisition.jurisdiction_evidence_status == "confirmed"
    assert v5.acquisition.acquisition_date == "2026-01-15"


def test_migrate_inputs_to_v5_merges_a_partial_v5_snapshot_onto_defaults():
    """Fix round 1, finding 2. migrate_inputs_to_v5 routes an already-v5
    snapshot through the same merge-onto-defaults treatment
    migrate_inputs_to_v4's own v4-branch uses (migrate.py:582-590), not a
    bare model_validate. A v5 row saved before a schema field existed must
    therefore be default-filled, not 422 at the boundary or under-fill
    deal_spider.weights to `{}`."""
    v5 = migrate_inputs_to_v5({"inputs_version": 1}).model_dump(mode="json")
    del v5["deal_spider"]["weights"]
    del v5["scenarios"]["upside"]

    again = migrate_inputs_to_v5(v5)

    assert again.inputs_version == 5
    assert len(again.deal_spider.weights) == 9
    assert again.scenarios.upside.label == "Upside"
    # And a value the saved row actually carried is not clobbered by the merge.
    assert again.acquisition.jurisdiction == "england_ni"


def test_jurisdiction_literal_matches_acquisition_tax_module():
    """Fix round 1, finding 5. AcquisitionInputsV5.jurisdiction re-declares
    acquisition_tax.Jurisdiction rather than importing it -- types.py cannot
    import acquisition_tax without a module cycle (types -> acquisition_tax
    -> engine -> types; see the comment on the field). Bind the two literal
    value-sets together so a future band-table jurisdiction addition can't
    update one and silently miss the other."""
    field_literal = AcquisitionInputsV5.model_fields["jurisdiction"].annotation
    assert set(get_args(field_literal)) == set(get_args(TaxJurisdiction))
