"""Task 12: the FastAPI backend becomes the authority for persisted appraisal
outputs. These tests hit the real appraisal endpoints end-to-end (project ->
appraisal create/get/update) against an isolated in-memory sqlite database so
we exercise the actual server-side recalculation path, not mocks.
"""
import copy
import json
import time
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
    """A fresh deep copy of fixture A's inputs, safe for a test to mutate.

    Fixture A is a real v5 document (jurisdiction "england_ni", confirmed by
    a user, acquisition_date "2026-01-15") -- Task 10 moved the appraisal
    endpoints' normalisation boundary from v4 to v5
    (app/api/app.py migrate_inputs_to_v5), so this is now posted as-is rather
    than downgraded first."""
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
    calc_version 2.8.0, and finance.requires_confirmation True in the stored
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
    assert body["calc_version"] == "2.8.0"
    # R8 Task 10: the server normalisation chain now runs v1 -> v2 -> v3 -> v4
    # -> v5. R9 Task 3 extends it to v6.
    assert body["inputs_snapshot"]["inputs_version"] == 6
    assert body["inputs_snapshot"]["lender_valuation"] is None
    assert body["inputs_snapshot"]["programme"] is None
    assert body["inputs_snapshot"]["sales_phasing"] is None
    assert body["inputs_snapshot"]["refinance"] is None
    assert body["inputs_snapshot"]["finance"]["requires_confirmation"] is True
    # A v1 snapshot never recorded a jurisdiction -- migrateV4toV5 stamps the
    # unconfirmed default rather than inventing evidence the record never had
    # (intended behaviour, R8 release-level decision: no legacy exemption).
    acq = body["inputs_snapshot"]["acquisition"]
    assert acq["jurisdiction"] == "england_ni"
    assert acq["jurisdiction_source"] == "migrated_default"
    assert acq["jurisdiction_evidence_status"] == "unconfirmed"
    assert acq["acquisition_date"] is None
    # Outputs were recalculated by the v2 engine, not just passed through.
    assert body["outputs"]["metrics"]["calc_version"] == "2.8.0"


async def test_partial_v5_snapshot_is_merged_onto_defaults_not_rejected(client, project):
    """The server's normalisation chain routes an already-v5 snapshot through
    migrate_inputs_to_v5's merge branch (TS parity: migrateInputsToV5's isV5
    branch). A stored v5 row that predates a schema addition -- here a missing
    `scenarios.upside` -- must be default-filled and accepted, not 422'd.

    R8 Task 10: this test used to post fixture A downgraded to v3 (before the
    appraisal endpoints were v5-aware) and so exercised migrate_inputs_to_v3's
    merge branch instead; now that fixture A is posted as a real v5 document,
    it exercises the v5 merge branch of the same shared `_merge_saved_onto_
    defaults` helper -- the v3 branch remains covered directly in
    test_migrate_v4.py."""
    partial_v5 = fixture_a_inputs()
    del partial_v5["scenarios"]["upside"]
    del partial_v5["deal_spider"]["weights"]

    resp = await client.post("/api/v1/appraisals", json={
        "project_id": project["id"],
        "name": "Partial v5 appraisal",
        "inputs_snapshot": partial_v5,
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()

    snapshot = body["inputs_snapshot"]
    assert snapshot["inputs_version"] == 6
    assert snapshot["scenarios"]["upside"]["label"] == "Upside"
    assert len(snapshot["deal_spider"]["weights"]) == 9
    # A v5 row is not a legacy v1 migration -- it must not be stamped as one.
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


async def test_audit_hash_binds_inputs_outputs_and_status(client, project):
    """Spec Sec 13.2. The audit hash printed in the report provenance panel is
    recomputable from the six values printed beside it, and moves whenever any
    one of them does.

    The expected value is derived here independently of the API -- sha256 over
    the joined tuple -- rather than by calling the same helper the endpoint
    calls, so a change to the composition rule fails this test instead of
    passing through both sides of it.
    """
    import hashlib

    payload = {
        "project_id": project["id"],
        "name": "Audit hash appraisal",
        "inputs_snapshot": fixture_a_inputs(),
    }
    resp = await client.post("/api/v1/appraisals", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()

    expected = hashlib.sha256(
        "|".join(
            [
                project["id"],
                body["calc_version"],
                str(body["inputs_version"]),
                body["status"],
                body["input_hash"],
                body["outputs_hash"],
            ]
        ).encode()
    ).hexdigest()
    assert body["audit_hash"] == expected

    # Same inputs -> same hash.
    resp2 = await client.put(
        f"/api/v1/appraisals/{project['id']}",
        json={"inputs_snapshot": fixture_a_inputs()},
    )
    assert resp2.json()["audit_hash"] == body["audit_hash"]

    # Different inputs -> different hash, because outputs_hash moved.
    changed = fixture_a_inputs()
    changed["acquisition"]["purchase_price_pence"] += 100_000
    resp3 = await client.put(
        f"/api/v1/appraisals/{project['id']}",
        json={"inputs_snapshot": changed},
    )
    assert resp3.status_code == 200, resp3.text
    assert resp3.json()["audit_hash"] != body["audit_hash"]


async def test_audit_hash_moves_with_governance_status_alone(client, project):
    """Two records whose inputs and outputs hash identically but whose status
    differs must not share an audit hash -- the status is what a reader relies
    on when deciding whether the printed figures may be relied upon."""
    from app.financial_model.hashing import audit_hash

    common = dict(
        project_id="p", calc_version="2.5.0", inputs_version=5,
        input_hash_value="ih", outputs_hash_value="oh",
    )
    assert audit_hash(status="draft", **common) != audit_hash(status="reconciled", **common)


def _zeroed_areas(**overrides) -> dict:
    """Every entered R9 area-bridge field, zeroed, with `overrides` applied.
    Mirrors DEFAULT_AREA_BRIDGE / areas.DEFAULT_AREA_BRIDGE."""
    return {
        "basis": "manual",
        "existing_gia_sqm": 0, "demolished_gia_sqm": 0, "extension_gia_sqm": 0,
        "retained_commercial_gia_sqm": 0, "untouched_gia_sqm": 0,
        "circulation_common_sqm": 0, "plant_riser_sqm": 0,
        "store_bin_cycle_sqm": 0, "amenity_sqm": 0, "external_amenity_sqm": 0,
        **overrides,
    }


async def test_area_bridge_large_unallocated_balance_stays_reconciled(client, project):
    """R9 (Task 8, Step 5). Spec Sec 7/Sec 15.7: an unreconciled area bridge
    produces a warning and never gates the document -- unlike an unconfirmed
    tax jurisdiction (knowable on day one), an unallocated balance is
    frequently and legitimately unknown at appraisal stage.

    Python has no DraftReason union -- that governance (spec Sec 13/Sec 14)
    lives entirely in report-provenance.ts on the frontend. The Python-
    observable mirror of "does not gate the document" is that the persisted
    `status` stays 'reconciled' (report_safe True) with the warning still
    recorded in `validation.issues`, exactly as
    test_status_reconciled_only_when_report_safe below pins for the general
    reconciled/draft split.

    `basis: "manual"` keeps `conversion_costs.total_construction_sqm`
    (fixture A's funded 400 m2) as the cost area, so entering a much larger
    `existing_gia_sqm` swings only the bridge's own arithmetic -- not the
    facility -- which is what isolates the warning as the only thing under
    test (see the equivalent TS isolation note in report-provenance.test.ts).
    """
    inputs = fixture_a_inputs()
    inputs["inputs_version"] = 6
    inputs["areas"] = _zeroed_areas(basis="manual", existing_gia_sqm=2000)  # units total 200 m2

    resp = await client.post("/api/v1/appraisals", json={
        "project_id": project["id"],
        "name": "Area bridge unallocated appraisal",
        "inputs_snapshot": inputs,
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "reconciled"
    assert any(
        i["severity"] == "warning" and i["field"] == "areas.unallocated_sqm"
        for i in body["validation"]["issues"]
    ), body["validation"]["issues"]


async def test_area_bridge_hard_rule_failure_is_rejected_before_persistence(client, project):
    """The basis conflict IS resolvable by the user, so it stays a hard error.
    validate_inputs runs before run_appraisal (I2, final R3a review) so a hard
    area-bridge failure -- here, the bridge-derived basis selected with no
    bridge entered -- 422s before a record is ever persisted, the same guard
    test_negative_costs_rejected pins for a negative cost. This is the
    Python-observable analogue of the TS suite's 'still marks a document
    unreconciled when the bridge fails a HARD rule'."""
    inputs = fixture_a_inputs()
    inputs["inputs_version"] = 6
    inputs["areas"] = _zeroed_areas(basis="bridge_derived")  # existing_gia_sqm left at 0

    resp = await client.post("/api/v1/appraisals", json={
        "project_id": project["id"],
        "name": "Area bridge hard-error appraisal",
        "inputs_snapshot": inputs,
    })
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert any(d.get("field") == "areas.existing_gia_sqm" for d in detail), detail


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
    assert body["calc_version"] == "2.8.0"


def _programme(construction: dict) -> dict:
    """A minimal, otherwise-valid programme block with one package overridden."""
    return {
        "anchor_month": None,
        "packages": {
            "construction": construction,
            "professional": {
                "start_offset": 0, "duration_months": 2, "curve": {"kind": "straight_line"},
            },
            "statutory": {
                "start_offset": 0, "duration_months": 1, "curve": {"kind": "back_loaded"},
            },
        },
    }


async def test_absurd_programme_duration_is_rejected_before_the_engine_allocates(
    client, project,
):
    """I2 (final R3a review): `run_appraisal` used to run BEFORE the hard-error
    check, so a POST carrying `duration_months: 10**9` allocated gigabytes of
    spread/ledger arrays before earning its 422. Two layers now stop it: the
    generous Pydantic ceilings on ProgrammePackage (a boundary backstop) and the
    validation-first ordering in `calculate_authoritative`. The request must come
    back a validation error, and come back promptly -- the wall-clock bound is
    deliberately loose (a passing run is milliseconds; the pre-fix behaviour was
    minutes or a MemoryError)."""
    inputs = fixture_a_inputs()
    inputs["programme"] = _programme(
        {"start_offset": 0, "duration_months": 10**9, "curve": {"kind": "s_curve"}},
    )

    started = time.perf_counter()
    resp = await client.post("/api/v1/appraisals", json={
        "project_id": project["id"],
        "name": "Absurd programme",
        "inputs_snapshot": inputs,
    })
    elapsed = time.perf_counter() - started

    assert resp.status_code == 422, resp.text
    assert elapsed < 15, f"422 took {elapsed:.1f}s - the engine ran before the check"
    detail = resp.json()["detail"]
    assert isinstance(detail, list) and detail, resp.text


async def test_in_range_programme_violation_still_422s_with_the_spec_worded_issue(
    client, project,
):
    """The validation-first reorder must not change the 422 body for a window
    violation that clears the Pydantic ceilings: the spec-worded ValidationIssue
    (field/message/severity), not a Pydantic parse error."""
    inputs = fixture_a_inputs()
    inputs["programme"] = _programme(
        {"start_offset": -1, "duration_months": 2, "curve": {"kind": "s_curve"}},
    )

    resp = await client.post("/api/v1/appraisals", json={
        "project_id": project["id"],
        "name": "Negative start offset",
        "inputs_snapshot": inputs,
    })

    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert any(
        d.get("field") == "programme.packages.construction"
        and d.get("severity") == "error"
        and "cannot be negative" in d.get("message", "")
        for d in detail
    ), detail


async def test_nan_user_defined_weights_are_a_422_not_a_500(client, project):
    """I3 (final R3a review): Python's json.loads accepts literal NaN/Infinity, so
    a NaN weight arrives off the wire intact. It passed every other weight rule
    (NaN < 0 is False; a sum containing NaN is never <= 0) and reached
    build_schedule, which raised `ValueError: cannot convert float NaN to integer`
    -- a 500. With the finiteness rule plus I2's validation-first ordering it is a
    422 carrying the spec-worded message."""
    inputs = fixture_a_inputs()
    inputs["programme"] = _programme({
        "start_offset": 0, "duration_months": 2,
        "curve": {"kind": "user_defined", "weights": [1.0, 1.0]},
    })
    # Hand-built body so the NaN literal survives to the server (json.dumps would
    # otherwise be the only producer of it, and it is exactly what a hostile or
    # buggy client sends).
    body = json.dumps({
        "project_id": project["id"],
        "name": "NaN weights",
        "inputs_snapshot": inputs,
    }).replace('"weights": [1.0, 1.0]', '"weights": [NaN, 1.0]')

    resp = await client.post(
        "/api/v1/appraisals", content=body, headers={"Content-Type": "application/json"},
    )

    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert any(
        d.get("field") == "programme.packages.construction"
        and "finite numbers" in d.get("message", "")
        for d in detail
    ), detail
