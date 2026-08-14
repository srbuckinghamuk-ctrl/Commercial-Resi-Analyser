"""Mirrors frontend/src/lib/model/migrate.test.ts's `migrateV3toV4 /
migrateInputsToV4` describe block (Release 3a Task 3, calc 2.2.0): same
scenarios, same expectations as the TS side (same-inputs/same-expected
cross-language parity -- see docs/financial-model/migration-notes.md Sec 5)."""
import pytest

from app.financial_model.migrate import (
    default_calculator_inputs_v2,
    is_v2_or_later,
    is_v4,
    migrate_inputs,
    migrate_inputs_to_v4,
    migrate_v2_to_v3,
    migrate_v3_to_v4,
)
from app.financial_model.types import CalculatorInputsV4

PROGRAMME = {
    "anchor_month": "2026-09",
    "packages": {
        "construction": {"start_offset": 1, "duration_months": 6, "curve": {"kind": "s_curve"}},
        "professional": {"start_offset": 2, "duration_months": 3, "curve": {"kind": "straight_line"}},
        "statutory": {"start_offset": 4, "duration_months": 2, "curve": {"kind": "back_loaded"}},
    },
}


def _v3() -> dict:
    return migrate_v2_to_v3(default_calculator_inputs_v2())


def test_stamps_version_4_and_nulls_the_three_new_blocks():
    v3 = _v3()
    v4 = migrate_v3_to_v4(v3)

    assert v4["inputs_version"] == 4
    assert v4["programme"] is None
    assert v4["sales_phasing"] is None
    assert v4["refinance"] is None
    assert v4["finance"] == v3["finance"]
    assert v4["lender_valuation"] == v3["lender_valuation"]


def test_carries_every_other_field_across_unchanged():
    """The migration is purely additive: strip the four keys it owns and the
    documents are identical (spec Sec 6.1 / design Sec 2.4 -- outputs are
    unchanged while all three blocks are null)."""
    v3 = _v3()
    v4 = migrate_v3_to_v4(v3)

    v3_rest = {k: v for k, v in v3.items() if k != "inputs_version"}
    added = ("inputs_version", "programme", "sales_phasing", "refinance")
    v4_rest = {k: v for k, v in v4.items() if k not in added}
    assert v4_rest == v3_rest


def test_rejects_migrating_an_already_v4_document_idempotence_guard():
    v4 = migrate_inputs_to_v4({})
    with pytest.raises(ValueError, match="already a v4"):
        migrate_v3_to_v4(v4)


def test_passes_illegal_pre_existing_r3a_keys_through_unchanged():
    """Mirrors migrate_v2_to_v3's illegal-key passthrough: a hand-edited or
    partially-migrated v3 row that already carries the v4 blocks keeps them
    rather than having them clobbered to None."""
    v3 = _v3()
    v3["programme"] = PROGRAMME
    v4 = migrate_v3_to_v4(v3)
    assert v4["programme"] == PROGRAMME
    assert v4["sales_phasing"] is None


def test_migrate_inputs_to_v4_normalises_v1_v2_v3_and_v4_snapshots():
    v1: dict = {}
    v2 = migrate_inputs({}).model_dump(mode="json")
    snapshots = [v1, v2, migrate_v2_to_v3(v2), migrate_inputs_to_v4({})]
    for snap in snapshots:
        out = migrate_inputs_to_v4(snap)
        assert out["inputs_version"] == 4
        assert out["programme"] is None
        # Every normalised document must survive the strict v4 boundary model.
        CalculatorInputsV4.model_validate(out)


def test_preserves_a_saved_programme_block_on_a_v4_round_trip():
    v4 = migrate_inputs_to_v4({})
    v4["programme"] = PROGRAMME
    again = migrate_inputs_to_v4(v4)
    assert again["programme"] == PROGRAMME


def test_is_v4_discriminates_on_version_and_facility_shape():
    assert is_v4(migrate_inputs_to_v4({})) is True
    assert is_v4(_v3()) is False
    assert is_v4({}) is False
    # inputs_version alone is not enough -- the v2/v3/v4 finance shape must be there too,
    # mirroring is_v2/is_v3 (a snapshot claiming v4 with a legacy finance block is not v4).
    assert is_v4({"inputs_version": 4, "finance": {"ltv_pct": 70}}) is False


def test_is_v2_or_later_accepts_v4():
    """app.py's `was_v1` gate reads this: a v4 snapshot must not be misread as a
    legacy v1 document and stamped `legacy_unreconciled`."""
    assert is_v2_or_later(migrate_inputs_to_v4({})) is True
