"""Mirrors frontend/src/lib/model/migrate.test.ts's `migrateInputs` describe block
(Release 2b Task 7): four hand-written v1->v2 migration cases, same inputs/expectations
as the TS side (same-inputs/same-expected cross-language parity -- see
docs/financial-model/migration-notes.md Sec 5). Closes the migration-mapping gap
recorded in docs/financial-model/test-cases.md Sec 4/Sec 7 -- previously Python's only
migration-specific coverage was the narrow `test_migration_preserves_floors_zero`
regression and the end-to-end `test_appraisal_governance.py` path, neither of which
asserts `migrate_inputs()`'s output directly against a set of hand-derived cases the
way `migrate.test.ts` does.

test_migrate_v3.py mirrors the sibling `migrateV2toV3` describe block (v2->v3, Task 2);
this file is its v1->v2 counterpart, following the same pattern.
"""
from app.financial_model.migrate import migrate_inputs

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


def test_passes_a_v2_document_through_unchanged():
    """A malformed "v2" without a finance object (finance: None) fails the isV2 check
    (finance must be a dict carrying committed_net_facility_pence) and is normalised via
    the v1 path instead -- but feeding the resulting real v2 document back through
    migrate_inputs round-trips it unchanged (the passthrough path is idempotent)."""
    malformed = {**V1_SNAPSHOT, "inputs_version": 2, "finance": None}
    v2 = migrate_inputs(malformed)
    again = migrate_inputs(v2.model_dump(mode="json"))
    assert again == v2


def test_migrates_v1_ltv_pct_to_an_unconfirmed_proposed_facility_never_an_approved_metric():
    v2 = migrate_inputs(V1_SNAPSHOT)
    assert v2.inputs_version == 2
    assert v2.finance.legacy_leverage_pct == 70
    assert v2.finance.requires_confirmation is True
    assert v2.finance.day_one_advance_pence is None
    assert v2.finance.equity_draw_rule == "fund_as_required"
    # proposed net facility = round(v1 cost-before-finance x 70%)
    # v1 cost before finance for this snapshot:
    #   acquisition 42,500,000 + SDLT 1,075,000 + 500,000 + 300,000 + broker 425,000 = 44,800,000
    #   construction 50,000x500 = 25,000,000 + 10% cont 2,500,000 = 27,500,000 (compliance 0)
    #   professional+statutory 9,600 + 1,500,000+500,000+500,000+300,000+200,000 = 3,009,600
    #   total 75,309,600 -> 70% = 52,716,720
    assert v2.finance.committed_net_facility_pence == 52_716_720
    assert v2.finance.term_months == 12
    assert v2.finance.interest_type == "rolled_up"


def test_creates_a_single_unconfirmed_cash_equity_source_for_v1_snapshots():
    v2 = migrate_inputs(V1_SNAPSHOT)
    assert len(v2.equity_sources) == 1
    assert v2.equity_sources[0].classification == "cash"
    assert v2.equity_sources[0].evidence_status == "unconfirmed"
    # residual equity = 75,309,600 - 52,716,720
    assert v2.equity_sources[0].amount_pence == 22_592_880


def test_forces_zero_facility_for_v1_cash_funding():
    snapshot = {**V1_SNAPSHOT, "finance": {**V1_SNAPSHOT["finance"], "funding_source": "cash"}}
    v2 = migrate_inputs(snapshot)
    assert v2.finance.committed_net_facility_pence == 0
    assert v2.finance.legacy_leverage_pct == 70
    assert v2.equity_sources[0].amount_pence == 75_309_600
