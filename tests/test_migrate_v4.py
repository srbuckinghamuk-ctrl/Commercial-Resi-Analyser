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
    migrate_inputs_to_v3,
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


class TestV3SnapshotsMergeOntoDefaults:
    """migrateInputsToV4 routes a v3 snapshot through migrateInputsToV3, whose isV3
    branch merges it onto v3 defaults field-by-field (migrate.ts:159-186) BEFORE the v4
    stamp. A v3 row saved before a field existed must therefore be default-filled, not
    passed through with the field missing. Same nine merge groups as the TS branch."""

    @staticmethod
    def _partial_v3() -> dict:
        """A v3 row that predates two schema additions: no deal_spider.weights at all,
        and a scenarios map missing `upside` entirely."""
        v3 = _v3()
        del v3["deal_spider"]["weights"]
        del v3["scenarios"]["upside"]
        return v3

    def test_absent_nested_fields_are_seeded_with_the_same_defaults_ts_would_use(self):
        defaults = _v3()
        v4 = migrate_inputs_to_v4(self._partial_v3())

        assert v4["inputs_version"] == 4
        # deal_spider.weights: TS spreads defaults.deal_spider.weights under the saved
        # (absent) map -- so the full nine-axis default set survives, not `{}`.
        assert v4["deal_spider"]["weights"] == defaults["deal_spider"]["weights"]
        assert len(v4["deal_spider"]["weights"]) == 9
        # scenarios.upside: each of the four keys is spread over its own default.
        assert v4["scenarios"]["upside"] == defaults["scenarios"]["upside"]
        # and the surviving keys are untouched
        assert v4["scenarios"]["base"] == defaults["scenarios"]["base"]

    def test_the_merged_document_survives_the_strict_v4_boundary_model(self):
        """Without the merge this raises: Scenarios requires `upside`, so the bare
        passthrough would 422 at the API boundary instead of default-filling."""
        v4 = CalculatorInputsV4.model_validate(migrate_inputs_to_v4(self._partial_v3()))
        assert len(v4.deal_spider.weights) == 9
        assert v4.scenarios.upside.label == "Upside"

    def test_saved_values_still_win_over_defaults(self):
        """The merge must not clobber what the row actually stored."""
        v3 = _v3()
        v3["deal_spider"]["weights"] = {"programme": 5}
        v3["acquisition"]["purchase_price_pence"] = 12_345_600
        v3["scenarios"]["downside"]["gdv_adjustment_pct"] = -42
        v4 = migrate_inputs_to_v4(v3)

        assert v4["deal_spider"]["weights"]["programme"] == 5
        # ...while the other eight axes are still seeded from defaults (TS spreads, it
        # does not replace, the weights map).
        assert len(v4["deal_spider"]["weights"]) == 9
        assert v4["acquisition"]["purchase_price_pence"] == 12_345_600
        assert v4["scenarios"]["downside"]["gdv_adjustment_pct"] == -42

    def test_a_complete_v3_document_is_unchanged_by_the_merge(self):
        """Identity guard: the merge must be a no-op for a v3 document that already
        carries every field -- which is every golden fixture."""
        v3 = _v3()
        v4 = migrate_inputs_to_v4(v3)
        added = ("inputs_version", "programme", "sales_phasing", "refinance")
        assert {k: v for k, v in v4.items() if k not in added} == {
            k: v for k, v in v3.items() if k != "inputs_version"
        }

    def test_lender_valuation_defaults_to_none_not_absent(self):
        v3 = _v3()
        del v3["lender_valuation"]
        assert migrate_inputs_to_v4(v3)["lender_valuation"] is None


def test_preserves_a_saved_programme_block_on_a_v4_round_trip():
    v4 = migrate_inputs_to_v4({})
    v4["programme"] = PROGRAMME
    again = migrate_inputs_to_v4(v4)
    assert again["programme"] == PROGRAMME


class TestV4DowngradeToV3:
    """Mirrors migrate.test.ts's `migrateInputsToV3` v4-downgrade cases. Since
    Release 3a the server persists every inputs_snapshot as v4, while the v3
    consumers still hydrate through migrate_inputs_to_v3 / migrateInputsToV3 --
    so a v4 document must be downgraded here rather than falling through to the
    v1 fallback, which misreads a v4 `finance` object as v1-shaped and fabricates
    facility terms."""

    def test_downgrades_a_server_shaped_v4_snapshot_with_finance_intact(self):
        server_snapshot = migrate_inputs_to_v4(_v3())
        server_snapshot["finance"]["committed_net_facility_pence"] = 60_000_000

        v3 = migrate_inputs_to_v3(server_snapshot)

        assert v3["inputs_version"] == 3
        assert v3["finance"]["committed_net_facility_pence"] == 60_000_000
        # Not the v1-fallback fabrication:
        assert v3["finance"]["legacy_leverage_pct"] is None
        assert v3["finance"]["requires_confirmation"] is False
        assert all(e["id"] != "migrated-cash-equity" for e in v3["equity_sources"])
        assert all(
            "Migrated from v1 snapshot" not in (e.get("notes") or "")
            for e in v3["equity_sources"]
        )

    def test_drops_the_three_v4_only_blocks(self):
        """R3a policy: the UI cannot author a non-null programme/sales_phasing/
        refinance block, so dropping them on the downgrade is information-
        preserving. R3b lifts hydration to v4 and this branch goes."""
        v4 = migrate_inputs_to_v4({})
        v4["programme"] = PROGRAMME

        v3 = migrate_inputs_to_v3(v4)

        assert v3["inputs_version"] == 3
        assert "programme" not in v3
        assert "sales_phasing" not in v3
        assert "refinance" not in v3

    def test_a_partial_v4_snapshot_is_merged_onto_v3_defaults_not_misread_as_v1(self):
        partial = {
            "inputs_version": 4,
            "finance": {"committed_net_facility_pence": 5_000_000, "annual_interest_rate_pct": 9},
        }
        v3 = migrate_inputs_to_v3(partial)

        assert v3["inputs_version"] == 3
        assert v3["finance"]["committed_net_facility_pence"] == 5_000_000
        assert v3["finance"]["requires_confirmation"] is False
        assert v3["lender_valuation"] is None
        assert v3["scenarios"]["upside"]["label"] == "Upside"


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
