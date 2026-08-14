"""Task 12: the FastAPI backend becomes the authority for persisted appraisal
outputs. These tests hit the real appraisal endpoints end-to-end (project ->
appraisal create/get/update) against an isolated in-memory sqlite database so
we exercise the actual server-side recalculation path, not mocks.
"""
import copy
import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.app import app
from app.persistence.database import Base, get_db

FIXTURE_A_PATH = (
    Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "a-all-cash.json"
)
FIXTURE_A_INPUTS = json.loads(FIXTURE_A_PATH.read_text())["inputs"]


def fixture_a_inputs() -> dict:
    """A fresh deep copy of fixture A's inputs, safe for a test to mutate."""
    return copy.deepcopy(FIXTURE_A_INPUTS)


@pytest.fixture
async def db_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
async def project(client):
    resp = await client.post(
        "/api/v1/projects",
        json={
            "address_raw": "1 Test Street, London, E1 1AA",
            "price_pence": 40_000_000,
            "use_class": "office",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_save_recalculates_outputs_server_side(client, project):
    """POST with fixture A inputs and deliberately wrong client outputs
    (gdv_pence=1) -> stored/returned gdv_pence == 120_000_000 (server wins),
    and validation payload records a client_mismatch entry."""
    payload = {
        "project_id": project["id"],
        "name": "Fixture A appraisal",
        "inputs_snapshot": fixture_a_inputs(),
        "gdv_pence": 1,
    }
    resp = await client.post("/api/v1/appraisals", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()

    assert body["gdv_pence"] == 120_000_000
    assert body["outputs"]["metrics"]["gdv_pence"] == 120_000_000

    mismatches = body["validation"]["client_mismatches"]
    assert any(
        m["field"] == "gdv_pence" and m["client"] == 1 and m["server"] == 120_000_000
        for m in mismatches
    ), mismatches


async def test_negative_costs_rejected(client, project):
    """POST with part_l_compliance_pence = -1 (the York defect) -> 422."""
    inputs = fixture_a_inputs()
    inputs["conversion_costs"]["part_l_compliance_pence"] = -1
    payload = {
        "project_id": project["id"],
        "name": "Bad appraisal",
        "inputs_snapshot": inputs,
    }
    resp = await client.post("/api/v1/appraisals", json=payload)
    assert resp.status_code == 422, resp.text


async def test_invalid_lender_valuation_rejected_with_422(client, project):
    """Task-3-review CRITICAL fix: a present-but-invalid lender_valuation block
    (here, fixed_amount with no global_value) must be rejected as an ordinary
    422 -- the same hard-error path as test_negative_costs_rejected -- not an
    unhandled 500 from run_appraisal crashing inside calculate_authoritative."""
    inputs = fixture_a_inputs()
    inputs["lender_valuation"] = {
        "basis": "fixed_amount",
        "global_value": None,
        "per_key_values": None,
        "reason": "Test",
        "author": "test-author",
        "date": "2026-08-13",
    }
    payload = {
        "project_id": project["id"],
        "name": "Invalid lender valuation appraisal",
        "inputs_snapshot": inputs,
    }
    resp = await client.post("/api/v1/appraisals", json=payload)
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert any("global_value" in str(issue) for issue in detail), detail


async def test_v1_snapshot_migrates_to_legacy_unreconciled(client, project):
    """POST with a v1-shaped inputs_snapshot (ltv_pct present) -> 200/201,
    response status == 'legacy_unreconciled', outputs recalculated under
    calc_version 2.1.0, and finance.requires_confirmation True in the stored
    (migrated) snapshot."""
    v1_snapshot = {
        "acquisition": FIXTURE_A_INPUTS["acquisition"],
        "unit_mix": FIXTURE_A_INPUTS["unit_mix"],
        "conversion_costs": FIXTURE_A_INPUTS["conversion_costs"],
        "finance": {
            "funding_source": "bridging",
            "ltv_pct": 70,
            "interest_rate_annual_pct": 8,
            "arrangement_fee_pct": 2,
            "exit_fee_pct": 1,
            "loan_term_months": 12,
            "interest_type": "rolled_up",
        },
        "exit_strategy": FIXTURE_A_INPUTS["exit_strategy"],
    }
    payload = {
        "project_id": project["id"],
        "name": "Legacy appraisal",
        "inputs_snapshot": v1_snapshot,
    }
    resp = await client.post("/api/v1/appraisals", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()

    assert body["status"] == "legacy_unreconciled"
    assert body["calc_version"] == "2.1.0"
    # Release 3a: the server normalisation chain now runs v1 -> v2 -> v3 -> v4.
    assert body["inputs_snapshot"]["inputs_version"] == 4
    assert body["inputs_snapshot"]["lender_valuation"] is None
    assert body["inputs_snapshot"]["programme"] is None
    assert body["inputs_snapshot"]["sales_phasing"] is None
    assert body["inputs_snapshot"]["refinance"] is None
    assert body["inputs_snapshot"]["finance"]["requires_confirmation"] is True
    # Outputs were recalculated by the v2 engine, not just passed through.
    assert body["outputs"]["metrics"]["calc_version"] == "2.1.0"


async def test_partial_v3_snapshot_is_merged_onto_defaults_not_rejected(client, project):
    """The server's normalisation chain routes v3 snapshots through
    migrate_inputs_to_v3's merge branch (TS parity: migrateInputsToV4 ->
    migrateInputsToV3). A stored v3 row that predates a schema addition -- here a
    missing `scenarios.upside` -- must be default-filled and accepted, not 422'd.
    Before the merge landed this returned 422 from the CalculatorInputsV4 boundary."""
    partial_v3 = fixture_a_inputs()
    del partial_v3["scenarios"]["upside"]
    del partial_v3["deal_spider"]["weights"]

    resp = await client.post("/api/v1/appraisals", json={
        "project_id": project["id"],
        "name": "Partial v3 appraisal",
        "inputs_snapshot": partial_v3,
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()

    snapshot = body["inputs_snapshot"]
    assert snapshot["inputs_version"] == 4
    assert snapshot["scenarios"]["upside"]["label"] == "Upside"
    assert len(snapshot["deal_spider"]["weights"]) == 9
    # A v3 row is not a legacy v1 migration -- it must not be stamped as one.
    assert body["status"] != "legacy_unreconciled"


async def test_malformed_v2_snapshot_migrates_to_legacy_unreconciled(client, project):
    """M4 (round-2 review): `was_v1` must use the same `is_v2` predicate as
    migrate.py, not a bare `inputs_version == 2` check. A snapshot claiming
    inputs_version 2 but missing committed_net_facility_pence in `finance`
    (malformed/incomplete v2, e.g. a partially-migrated or hand-edited row)
    fails `is_v2` and must be treated as a legacy migration -> status
    'legacy_unreconciled', not 'draft'."""
    malformed_v2_snapshot = {
        "inputs_version": 2,
        "acquisition": FIXTURE_A_INPUTS["acquisition"],
        "unit_mix": FIXTURE_A_INPUTS["unit_mix"],
        "conversion_costs": FIXTURE_A_INPUTS["conversion_costs"],
        # Missing committed_net_facility_pence -- is_v2() returns False for this.
        "finance": {"funding_source": "cash"},
        "exit_strategy": FIXTURE_A_INPUTS["exit_strategy"],
    }
    payload = {
        "project_id": project["id"],
        "name": "Malformed v2 appraisal",
        "inputs_snapshot": malformed_v2_snapshot,
    }
    resp = await client.post("/api/v1/appraisals", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()

    assert body["status"] == "legacy_unreconciled"
    assert body["inputs_snapshot"]["finance"]["requires_confirmation"] is True


async def test_input_hash_and_outputs_hash_persisted(client, project):
    """Saved record has non-empty input_hash/outputs_hash; PUT with identical
    inputs produces identical hashes (determinism)."""
    payload = {
        "project_id": project["id"],
        "name": "Hash appraisal",
        "inputs_snapshot": fixture_a_inputs(),
    }
    resp = await client.post("/api/v1/appraisals", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["input_hash"]
    assert body["outputs_hash"]

    resp2 = await client.put(
        f"/api/v1/appraisals/{project['id']}",
        json={"inputs_snapshot": fixture_a_inputs()},
    )
    assert resp2.status_code == 200, resp2.text
    body2 = resp2.json()

    assert body2["input_hash"] == body["input_hash"]
    assert body2["outputs_hash"] == body["outputs_hash"]


async def test_status_reconciled_only_when_report_safe(client, project):
    """Fixture A (clean) -> status 'reconciled'. A case with a funding gap
    (tiny net facility, tiny equity) -> status 'draft' with issues listed."""
    payload = {
        "project_id": project["id"],
        "name": "Clean appraisal",
        "inputs_snapshot": fixture_a_inputs(),
    }
    resp = await client.post("/api/v1/appraisals", json=payload)
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "reconciled"

    gap_inputs = fixture_a_inputs()
    gap_inputs["finance"]["funding_source"] = "development_finance"
    gap_inputs["finance"]["committed_net_facility_pence"] = 100_000
    gap_inputs["finance"]["committed_gross_facility_pence"] = 100_000
    gap_inputs["equity_sources"] = [{
        "id": "e1", "classification": "cash", "amount_pence": 1_000, "timing_month": 0,
        "repayment_priority": 1, "evidence_status": "confirmed", "notes": "",
    }]
    resp2 = await client.put(
        f"/api/v1/appraisals/{project['id']}",
        json={"inputs_snapshot": gap_inputs},
    )
    assert resp2.status_code == 200, resp2.text
    body2 = resp2.json()
    assert body2["status"] == "draft"
    assert len(body2["outputs"]["reconciliation"]["issues"]) > 0


async def test_get_returns_authoritative_outputs(client, project):
    """GET returns the server-stored outputs and calc_version - no client
    fields influence it."""
    payload = {
        "project_id": project["id"],
        "name": "Get appraisal",
        "inputs_snapshot": fixture_a_inputs(),
        "gdv_pence": 999,  # deliberately wrong; must not leak into storage
    }
    post_resp = await client.post("/api/v1/appraisals", json=payload)
    assert post_resp.status_code == 201, post_resp.text

    resp = await client.get(f"/api/v1/appraisals/{project['id']}")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["outputs"]["metrics"]["gdv_pence"] == 120_000_000
    assert body["gdv_pence"] == 120_000_000
    assert body["calc_version"] == "2.1.0"
