"""R11 (spec Sec 17.11) -- the inputs v7 -> v8 migration, and the VAT block.

Python twin of the `migrateV7toV8` / `migrateInputsToV8 refusals` /
`migrateInputsToV8 merge-onto-defaults branch` describe blocks in
frontend/src/lib/model/migrate.test.ts, and of the v8 identity gate in
frontend/src/lib/model/golden-fixtures.test.ts.
"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import parse_calculator_inputs, run_appraisal
from app.financial_model.migrate import (
    is_v2_or_later,
    is_v7,
    is_v8,
    migrate_inputs_to_v7,
    migrate_inputs_to_v8,
    migrate_v7_to_v8,
)
from app.financial_model.types import (
    DEFAULT_VAT,
    VAT_CHARGE_CATEGORIES,
    CalculatorInputsV7,
    CalculatorInputsV8,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


@pytest.fixture
def v1_doc():
    return {"inputs_version": 1}


def _v7(v1_doc):
    return migrate_inputs_to_v7(v1_doc)


# ---------------------------------------------------------------------------
# migrate_v7_to_v8 -- the write itself
# ---------------------------------------------------------------------------

def test_v7_to_v8_stamps_inputs_version_8(v1_doc):
    assert migrate_v7_to_v8(_v7(v1_doc)).inputs_version == 8


def test_v7_to_v8_writes_an_inert_vat_block_so_no_existing_appraisal_moves(v1_doc):
    """Spec Sec 17.11's write, field for field. `registered: false` is what makes
    the whole migration inert: it drives resolve_vat_treatment to INERT and
    chargeable_consideration_pence back to the exclusive price."""
    v8 = migrate_v7_to_v8(_v7(v1_doc))
    assert v8.vat.registered is False
    assert [t.category for t in v8.vat.treatments] == list(VAT_CHARGE_CATEGORIES)
    assert len(v8.vat.treatments) == 6
    assert all(t.rate_pct == 0 and t.recoverable_pct == 0 for t in v8.vat.treatments)
    assert all(t.recovery_basis == "unconfirmed" for t in v8.vat.treatments)
    assert all(t.evidence_status == "unconfirmed" for t in v8.vat.treatments)
    assert v8.vat.purchase.vendor_opted_to_tax is False
    assert v8.vat.purchase.togc_treatment == "unconfirmed"
    assert v8.vat.purchase.evidence_status == "unconfirmed"


def test_the_migration_and_default_vat_write_the_same_block(v1_doc):
    """conversion-defaults.ts:365 claims the two engines' v-defaults re-converge,
    and Sec 17.11 makes DEFAULT_VAT == the migration's write a requirement rather
    than a tidiness. `migrate_inputs_to_v8({})` is the Python side of that claim
    (test_cost_plan.py's `_default_v7()` is the v7 precedent)."""
    assert migrate_v7_to_v8(_v7(v1_doc)).vat.model_dump() == DEFAULT_VAT.model_dump()
    assert migrate_inputs_to_v8({}).vat.model_dump() == DEFAULT_VAT.model_dump()


def _detailed_v7(v1_doc) -> dict:
    """A v7 document carrying exactly the shapes R10 persisted: packages and fee
    lines with no `vat_override` key, and contingency rows still carrying the two
    fields Sec 17.8 deletes."""
    saved = _v7(v1_doc).model_dump(mode="json")
    saved["cost_plan"]["mode"] = "detailed"
    saved["cost_plan"]["packages"] = [
        {
            "id": "p1", "code": "structure", "label": "Structure",
            "amount_pence": 1_000_000, "contingency_class": "general",
            "lender_eligible": True, "notes": "",
        },
        {
            "id": "p2", "code": "mech_elec_public_health", "label": "M&E",
            "amount_pence": 2_000_000, "contingency_class": "abnormal",
            "lender_eligible": True, "notes": "",
        },
    ]
    for row in saved["cost_plan"]["contingency"]:
        row["basis"] = "whole_build"
        row["package_ids"] = ["p1"]
    return saved


def test_v7_to_v8_nulls_every_line_override_and_drops_the_deleted_contingency_fields(
    v1_doc,
):
    v8 = migrate_v7_to_v8(_detailed_v7(v1_doc))

    assert len(v8.cost_plan.packages) == 2
    assert all(p.vat_override is None for p in v8.cost_plan.packages)
    assert len(v8.cost_plan.fee_lines) == 8
    assert all(f.vat_override is None for f in v8.cost_plan.fee_lines)

    dumped = v8.cost_plan.model_dump()
    assert len(dumped["contingency"]) == 3
    for row in dumped["contingency"]:
        assert "basis" not in row
        assert "package_ids" not in row
    # The surviving mechanism -- the package's own tag -- is retained.
    assert [p.contingency_class for p in v8.cost_plan.packages] == ["general", "abnormal"]
    assert [c.name for c in v8.cost_plan.contingency] == [
        "general", "existing_building", "abnormal",
    ]


def test_v7_to_v8_refuses_to_double_migrate(v1_doc):
    v8 = migrate_v7_to_v8(_v7(v1_doc))
    with pytest.raises(ValueError, match="already a v8 document"):
        migrate_v7_to_v8(v8)
    # And via the dict path, which takes the other guard branch.
    with pytest.raises(ValueError, match="already a v8 document"):
        migrate_v7_to_v8(v8.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# migrate_inputs_to_v8 -- the two refusals (R8's carry-forward guard)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("version", [9, 99])
def test_unrecognised_inputs_version_is_refused_not_routed_to_the_v1_fallback(version):
    """R8's silent-corruption bug, guarded forward. The version tested is 9 --
    the NEIGHBOUR of the recognised set -- deliberately: R10 shipped a predicate
    loosened from `== 6` to `!= 5`, the literal negation of its own set, which
    could never fail. Only a document tagged one past the top catches that shape.

    The match string names migrate_inputs_to_v8 specifically: a v8 predicate that
    never fires falls through to migrate_v7_to_v8(migrate_inputs_to_v7(...)), and
    migrate_inputs_to_v7's OWN refusal would then raise a message a bare
    /unrecognised inputs_version/ would happily accept."""
    with pytest.raises(
        ValueError, match=f"migrate_inputs_to_v8: unrecognised inputs_version {version}",
    ):
        migrate_inputs_to_v8({"inputs_version": version})


def test_document_tagged_v8_that_fails_the_structural_check_is_refused():
    with pytest.raises(ValueError, match="fails the v8 structural check"):
        migrate_inputs_to_v8({"inputs_version": 8, "finance": "not a dict"})


@pytest.mark.parametrize("version", [1, 2, 3, 4])
def test_any_earlier_version_normalises_to_v8(version):
    # Stops at 4 for the same reason test_migrate_v7's twin does: a bare
    # {"inputs_version": 5} declares v5 without being structurally v5, and that
    # shape is deliberately refused rather than routed to the v1 fallback.
    v8 = migrate_inputs_to_v8({"inputs_version": version})
    assert v8.inputs_version == 8
    assert v8.vat.registered is False
    assert len(v8.vat.treatments) == 6


def test_a_real_v7_document_normalises_to_v8(v1_doc):
    v8 = migrate_inputs_to_v8(_v7(v1_doc).model_dump(mode="json"))
    assert v8.inputs_version == 8
    assert v8.cost_plan.mode == "headline"
    assert len(v8.vat.treatments) == 6


# ---------------------------------------------------------------------------
# migrate_inputs_to_v8 -- the merge-onto-defaults branch
# ---------------------------------------------------------------------------

def test_already_v8_document_is_merged_onto_defaults_not_re_migrated(v1_doc):
    saved = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    saved["project_id"] = "kept"
    assert migrate_inputs_to_v8(saved).project_id == "kept"


def test_v8_merge_branch_deep_merges_a_saved_vat_block_onto_defaults(v1_doc):
    """R10 found a `cost_plan` deep-merge on this path that nobody had ever
    deleted to check; without it a stored row computed ZERO contingency. The
    `vat` line added by Sec 17.11 carries the identical risk and gets the
    identical check.

    Deleting `"vat": {**defaults["vat"], **(snapshot.get("vat") or {})}` from
    migrate_inputs_to_v8 was confirmed to fail this test -- see
    task-10-report.md for the observed output.

    `VatInputs.treatments` defaults to an EMPTY list, so a stored row that
    predates the field (or, as here, one that carries only the flag the user
    toggled) would come back registered but pricing nothing at all."""
    saved = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    saved["vat"] = {"registered": True}

    merged = migrate_inputs_to_v8(saved)

    assert merged.vat.registered is True
    assert len(merged.vat.treatments) == 6
    assert [t.category for t in merged.vat.treatments] == list(VAT_CHARGE_CATEGORIES)


def test_v8_merge_branch_default_fills_a_row_that_predates_a_schema_field(v1_doc):
    """Mirrors test_migrate_v7.py's twin, one version on, with `vat` added to the
    list of blocks a stored row may be missing entirely."""
    saved = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    del saved["deal_spider"]["weights"]
    del saved["scenarios"]["upside"]
    del saved["areas"]["external_amenity_sqm"]
    del saved["cost_plan"]["contingency"]
    del saved["vat"]["treatments"]

    again = migrate_inputs_to_v8(saved)

    assert again.inputs_version == 8
    assert len(again.deal_spider.weights) == 9
    assert again.scenarios.upside.label == "Upside"
    assert again.areas.external_amenity_sqm == 0.0
    assert [c.name for c in again.cost_plan.contingency] == [
        "general", "existing_building", "abnormal",
    ]
    assert len(again.vat.treatments) == 6


def test_v8_merge_branch_preserves_a_populated_vat_block(v1_doc):
    saved = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    saved["vat"]["registered"] = True
    saved["vat"]["return_frequency"] = "monthly"
    saved["vat"]["treatments"][1]["rate_pct"] = 20.0
    saved["vat"]["treatments"][1]["recoverable_pct"] = 100.0
    saved["vat"]["purchase"]["vendor_opted_to_tax"] = True

    again = migrate_inputs_to_v8(saved)

    assert again.vat.registered is True
    assert again.vat.return_frequency == "monthly"
    assert again.vat.treatments[1].rate_pct == 20.0
    assert again.vat.treatments[1].recoverable_pct == 100.0
    assert again.vat.purchase.vendor_opted_to_tax is True


def test_v8_merge_branch_preserves_a_populated_cost_plan(v1_doc):
    saved = migrate_v7_to_v8(_detailed_v7(v1_doc)).model_dump(mode="json")

    again = migrate_inputs_to_v8(saved)

    assert again.cost_plan.mode == "detailed"
    assert again.cost_plan.packages[0].amount_pence == 1_000_000
    assert all(p.vat_override is None for p in again.cost_plan.packages)


# ---------------------------------------------------------------------------
# Container-level typing (spec Sec 17.11) and the parser (ruling R10)
# ---------------------------------------------------------------------------

def test_is_v8_gates_on_the_container_never_on_the_block(v1_doc):
    """`revalidate_instances='never'` lets a CalculatorInputsV7 hold a v8
    sub-block, so "has a vat key" answers a different question from "is a v8
    document" -- and the two engines would then disagree about the same row."""
    v8 = migrate_v7_to_v8(_v7(v1_doc))
    assert is_v8(v8.model_dump(mode="json")) is True
    assert is_v8(_v7(v1_doc).model_dump(mode="json")) is False
    # A v7 document that has somehow acquired a vat block is still NOT v8.
    mistagged = _v7(v1_doc).model_dump(mode="json")
    mistagged["vat"] = DEFAULT_VAT.model_dump(mode="json")
    assert is_v8(mistagged) is False
    assert is_v7(mistagged) is True
    assert isinstance(v8, CalculatorInputsV8)
    # The subclass relationship is load-bearing: a flat re-declaration would make
    # every `isinstance(x, CalculatorInputsV7)` check in the engine silently
    # False for a v8 document.
    assert isinstance(v8, CalculatorInputsV7)


def test_is_v2_or_later_recognises_a_v8_document(v1_doc):
    """The boundary just moved to v8 (app.py): a v8 raw payload must not be
    misclassified as a v1 document -- that would tag a fully-migrated v8
    appraisal 'legacy_unreconciled'."""
    v8 = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    assert is_v2_or_later(v8) is True


def test_parse_dispatches_on_version_8(v1_doc):
    """Ruling R10. parse_calculator_inputs dispatches on inputs_version and had
    no `== 8` branch, so a v8 document fell through to the CalculatorInputsV2
    default -- silently dropping the VAT block and every other post-v2 field.
    That is R8's silent-corruption class of defect, which returned 201 while
    dropping a confirmed equity source."""
    doc = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    parsed = parse_calculator_inputs(doc)
    assert parsed.inputs_version == 8
    assert type(parsed) is CalculatorInputsV8
    assert len(parsed.vat.treatments) == 6
    assert [t.category for t in parsed.vat.treatments] == list(VAT_CHARGE_CATEGORIES)
    # And the rest of the post-v2 surface survives the round trip.
    assert parsed.cost_plan.mode == "headline"


# ---------------------------------------------------------------------------
# The corpus-wide acceptance gate. Mirrors test_migrate_v7.py's
# test_v7_migration_moves_no_existing_figure and golden-fixtures.test.ts's
# 'migrating %s to v8 moves no computed figure, and writes the specified block'.
#
# R9 recorded that a gate of this shape can be PROVABLY BLIND where the
# migration synthesises a block no engine consumes. Here the numeric half IS
# meaningful -- the VAT engine is live and reads `vat.registered` -- but it
# still cannot tell a block written CORRECTLY from one written merely
# harmlessly, so the structural half asserts Sec 17.11's write directly.
# ---------------------------------------------------------------------------

def _pipeline_fixtures():
    for path in sorted(FIXTURES.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        if doc.get("kind") == "sensitivity":
            continue  # names a base_fixture instead of carrying inputs
        yield path.name, doc


def _assert_structural_write(migrated, name: str):
    assert migrated.inputs_version == 8, name
    assert migrated.vat.registered is False, f"{name}: migration wrote a LIVE VAT block"
    assert [t.category for t in migrated.vat.treatments] == list(VAT_CHARGE_CATEGORIES), name
    assert len(migrated.vat.treatments) == 6, name
    for t in migrated.vat.treatments:
        assert t.rate_pct == 0, name
        assert t.recoverable_pct == 0, name
        assert t.recovery_basis == "unconfirmed", name
        assert t.evidence_status == "unconfirmed", name
    assert migrated.vat.purchase.vendor_opted_to_tax is False, name
    assert migrated.vat.purchase.togc_treatment == "unconfirmed", name
    for p in migrated.cost_plan.packages:
        assert p.vat_override is None, f"{name}: package {p.id} kept a vat_override"
    for f in migrated.cost_plan.fee_lines:
        assert f.vat_override is None, f"{name}: fee line {f.id} kept a vat_override"
    for row in migrated.cost_plan.model_dump()["contingency"]:
        assert "basis" not in row, name
        assert "package_ids" not in row, name


def test_v8_migration_moves_no_existing_figure():
    """The acceptance gate for R11's migration: every fixture in the corpus, run
    before and after migration to v8, must produce identical output -- AND carry
    the block Sec 17.11 specifies."""
    names = []
    for name, doc in _pipeline_fixtures():
        names.append(name)
        migrated = migrate_inputs_to_v8(doc["inputs"])

        _assert_structural_write(migrated, name)

        before = run_appraisal(parse_calculator_inputs(doc["inputs"]))
        after = run_appraisal(migrated)
        # asdict, not model_dump: AppraisalResultV2 is a dataclass on the
        # Python side, not a Pydantic model.
        assert asdict(before.metrics) == asdict(after.metrics), (
            f"{name}: migration to v8 changed a computed figure"
        )
        assert asdict(before.model) == asdict(after.model), (
            f"{name}: migration to v8 changed a ledger figure"
        )
        assert asdict(before.schedule) == asdict(after.schedule), (
            f"{name}: migration to v8 changed a schedule figure"
        )
    # The corpus is loaded by directory scan, so an empty glob would make the
    # loop above vacuously pass.
    assert len(names) == 12, names
