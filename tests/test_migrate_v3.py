"""Mirrors frontend/src/lib/model/migrate.test.ts's `migrateV2toV3` describe
block (Task 2, calc 2.1.0): four hand-written v2->v3 migration cases, same
inputs/expectations as the TS side (same-inputs/same-expected cross-language
parity -- see docs/financial-model/migration-notes.md §5)."""
import pytest

from app.financial_model.migrate import (
    default_calculator_inputs_v2,
    is_v3,
    migrate_inputs,
    migrate_v2_to_v3,
)

V1_SNAPSHOT = {
    "project_id": "p1",
    "acquisition": {
        "purchase_price_pence": 42_500_000, "legal_fees_pence": 500_000,
        "survey_cost_pence": 300_000, "broker_fee_pct": 1.0, "other_acquisition_costs_pence": 0,
    },
    "unit_mix": {"units": [{
        "id": "u1", "type": "1bed", "floor_area_sqm": 50,
        "estimated_value_pence": 25_000_000, "comparable_notes": "",
    }]},
    "conversion_costs": {
        "prior_approval_fee_per_dwelling_pence": 9_600, "cil_s106_pence": 0,
        "architect_pence": 1_500_000, "structural_engineer_pence": 500_000, "mande_pence": 500_000,
        "planning_consultant_pence": 300_000, "building_control_pence": 200_000,
        "other_professional_fees_pence": 0, "construction_cost_per_sqm_pence": 50_000,
        "total_construction_sqm": 500, "contingency_pct": 10, "fire_safety_pence": 0,
        "sound_insulation_pence": 0, "part_l_compliance_pence": 0,
    },
    "finance": {
        "funding_source": "development_finance", "ltv_pct": 70, "interest_rate_annual_pct": 8,
        "arrangement_fee_pct": 2, "exit_fee_pct": 1, "loan_term_months": 12,
        "interest_type": "rolled_up",
    },
    "exit_strategy": {
        "route": "retain_all", "selling_agent_fee_pct": 1.5,
        "selling_legal_fee_pence": 150_000, "retained_units": [],
    },
}


def test_migrates_a_minimal_v2_document_to_v3():
    """lender_valuation is None, finance.enforcement_cost_assumption_pence is 0,
    every other field byte-identical, inputs_version == 3."""
    v2 = default_calculator_inputs_v2()
    v3 = migrate_v2_to_v3(v2)

    assert v3["inputs_version"] == 3
    assert v3["lender_valuation"] is None
    assert v3["finance"]["enforcement_cost_assumption_pence"] == 0

    v2_rest = {k: v for k, v in v2.items() if k != "inputs_version"}
    v3_rest = {k: v for k, v in v3.items() if k not in ("inputs_version", "lender_valuation")}
    assert v3_rest == v2_rest


def test_rejects_migrating_an_already_v3_document_idempotence_guard():
    v2 = default_calculator_inputs_v2()
    v3 = migrate_v2_to_v3(v2)

    assert is_v3(v3) is True
    with pytest.raises(ValueError):
        migrate_v2_to_v3(v3)


def test_chains_a_v1_snapshot_through_migrate_inputs_then_migrate_v2_to_v3():
    """Ends at v3 with both new fields defaulted AND the v1 migration flags intact."""
    v2 = migrate_inputs(V1_SNAPSHOT).model_dump(mode="json")
    v3 = migrate_v2_to_v3(v2)

    assert v3["inputs_version"] == 3
    assert v3["lender_valuation"] is None
    assert v3["finance"]["enforcement_cost_assumption_pence"] == 0
    # v1 migration flags preserved:
    assert v3["finance"]["requires_confirmation"] is True
    assert v3["finance"]["legacy_leverage_pct"] == 70
    assert v3["equity_sources"][0]["evidence_status"] == "unconfirmed"


def test_passes_an_illegal_existing_lender_valuation_block_through_unchanged():
    """A v2 doc that already (illegally) carries a lender_valuation key is
    still stamped to a valid v3 (block passed through unchanged, then
    validated by the type layer)."""
    v2 = default_calculator_inputs_v2()
    illegal_block = {
        "basis": "fixed_amount", "global_value": 10_000_000, "per_key_values": None,
        "reason": "Independent RICS valuation", "author": "J. Smith", "date": "2026-01-01",
    }
    v2_with_block = {**v2, "lender_valuation": illegal_block}

    v3 = migrate_v2_to_v3(v2_with_block)

    assert v3["inputs_version"] == 3
    assert v3["lender_valuation"] == illegal_block
