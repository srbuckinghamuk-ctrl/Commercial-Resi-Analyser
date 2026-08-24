"""R14b: lender case governance (spec Sec 21) -- persistence invariants and,
from Task 4 on, the /lender-cases endpoints end-to-end against in-memory
sqlite, the test_appraisal_governance.py pattern."""
import copy
import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.app import app
from app.persistence.database import Base, LenderCaseORM, get_db


@pytest.fixture
async def db_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


def _case_row(project_id, status: str) -> LenderCaseORM:
    return LenderCaseORM(
        project_id=project_id, status=status,
        locked_inputs_snapshot={}, locked_calc_version="2.13.0",
        locked_inputs_version=11, locked_input_hash="a" * 64,
        locked_outputs_hash="b" * 64, locked_audit_hash="c" * 64,
        case_hash="d" * 64, created_by="T. Test",
    )


async def test_second_live_case_is_refused_by_the_database(db_engine):
    """The partial unique index itself, not the endpoint's 409 twin: two
    non-superseded cases for one project must be an IntegrityError."""
    from uuid import uuid4
    from app.persistence.database import ProjectORM

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        project = ProjectORM(
            id=uuid4(), address_raw="1 Test Street", price_pence=1, use_class="office",
        )
        session.add(project)
        await session.flush()
        session.add(_case_row(project.id, "superseded"))
        session.add(_case_row(project.id, "draft"))
        await session.flush()  # superseded + one live: fine
        session.add(_case_row(project.id, "submitted"))
        with pytest.raises(IntegrityError):
            await session.flush()


FIXTURE_A_PATH = (
    Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "a-all-cash.json"
)
FIXTURE_A_INPUTS = json.loads(FIXTURE_A_PATH.read_text())["inputs"]


def fixture_a_inputs() -> dict:
    return copy.deepcopy(FIXTURE_A_INPUTS)


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
    resp = await client.post("/api/v1/projects", json={
        "address_raw": "1 Test Street, London, E1 1AA",
        "price_pence": 40_000_000,
        "use_class": "office",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def save_appraisal(client, project, inputs: dict | None = None) -> dict:
    resp = await client.post("/api/v1/appraisals", json={
        "project_id": project["id"],
        "name": "Appraisal",
        "inputs_snapshot": inputs or fixture_a_inputs(),
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def create_case(client, project) -> dict:
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": project["id"], "created_by": "S. Sponsor",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_locks_the_stored_snapshot_and_hashes(client, project):
    appraisal = await save_appraisal(client, project)
    case = await create_case(client, project)
    assert case["status"] == "draft"
    assert case["stale"] is False
    assert case["created_by"] == "S. Sponsor"
    assert case["locked_inputs_snapshot"] == appraisal["inputs_snapshot"]
    assert case["locked_calc_version"] == appraisal["calc_version"]
    assert case["locked_inputs_version"] == appraisal["inputs_version"]
    assert case["locked_input_hash"] == appraisal["input_hash"]
    assert case["locked_outputs_hash"] == appraisal["outputs_hash"]
    assert case["locked_audit_hash"] == appraisal["audit_hash"]
    assert len(case["case_hash"]) == 64


async def test_create_requires_a_project(client):
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": "00000000-0000-4000-8000-000000000000", "created_by": "S",
    })
    assert resp.status_code == 404


async def test_create_requires_a_saved_appraisal(client, project):
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": project["id"], "created_by": "S",
    })
    assert resp.status_code == 404
    assert "appraisal" in resp.json()["detail"].lower()


async def test_create_refuses_a_pre_provenance_appraisal(client, project, db_engine):
    """Spec Sec 21.1 / design decision 10: a row with no audit_hash cannot be
    bound by the case-hash chain, so re-saving it is the fix, not locking it."""
    from sqlalchemy import update as sa_update
    from app.persistence.database import FinancialAppraisalORM

    await save_appraisal(client, project)
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        await session.execute(
            sa_update(FinancialAppraisalORM).values(audit_hash=None)
        )
        await session.commit()

    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": project["id"], "created_by": "S",
    })
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any(d.get("field") == "appraisal" for d in detail), detail


async def test_create_refuses_a_second_live_case(client, project):
    await save_appraisal(client, project)
    await create_case(client, project)
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": project["id"], "created_by": "S",
    })
    assert resp.status_code == 409


async def test_get_returns_null_when_no_case(client, project):
    resp = await client.get(f"/api/v1/lender-cases/{project['id']}")
    assert resp.status_code == 200
    assert resp.json() is None


async def test_get_unknown_project_404s(client):
    resp = await client.get("/api/v1/lender-cases/00000000-0000-4000-8000-000000000000")
    assert resp.status_code == 404


async def test_creation_writes_the_creation_event(client, project):
    await save_appraisal(client, project)
    await create_case(client, project)
    resp = await client.get(f"/api/v1/lender-cases/{project['id']}/events")
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) == 1
    assert events[0]["from_status"] is None
    assert events[0]["to_status"] == "draft"
    assert events[0]["actor"] == "S. Sponsor"


async def transition(client, project, to_status, actor="R. Reviewer", **extra):
    return await client.post(
        f"/api/v1/lender-cases/{project['id']}/transition",
        json={"to_status": to_status, "actor": actor, **extra},
    )


async def test_full_legal_walk_records_each_side_effect(client, project):
    """draft -> submitted -> under_review -> information_required ->
    under_review -> approved_with_conditions, asserting the Sec 21.2
    side-effect table at every step."""
    await save_appraisal(client, project)
    await create_case(client, project)

    r = await transition(client, project, "submitted", actor="S. Sponsor")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["submitted_by"] == "S. Sponsor" and body["submitted_at"] is not None

    r = await transition(client, project, "under_review", actor="First Reviewer")
    assert r.json()["reviewer"] == "First Reviewer"

    r = await transition(client, project, "information_required", actor="First Reviewer",
                         note="Send the QS report")
    assert r.status_code == 200

    r = await transition(client, project, "under_review", actor="Second Reviewer")
    # Resubmission overwrites the reviewer of record; the event log keeps both.
    assert r.json()["reviewer"] == "Second Reviewer"

    r = await transition(client, project, "approved_with_conditions",
                         actor="D. Director", conditions="Max LTC 85%")
    body = r.json()
    assert body["status"] == "approved_with_conditions"
    assert body["decided_by"] == "D. Director" and body["decided_at"] is not None
    assert body["conditions"] == "Max LTC 85%"

    events = (await client.get(f"/api/v1/lender-cases/{project['id']}/events")).json()
    assert [e["to_status"] for e in events] == [
        "approved_with_conditions", "under_review", "information_required",
        "under_review", "submitted", "draft",
    ]
    assert events[1]["actor"] == "Second Reviewer"
    assert events[2]["note"] == "Send the QS report"


async def case_at(client, project, target: str):
    """Drive a fresh case to `target` along the shortest legal path,
    superseding any live case first."""
    live = (await client.get(f"/api/v1/lender-cases/{project['id']}")).json()
    if live is not None:
        assert (await transition(client, project, "superseded")).status_code == 200
    await create_case(client, project)
    walks = {
        "draft": [],
        "submitted": ["submitted"],
        "under_review": ["submitted", "under_review"],
        "information_required": ["submitted", "under_review", "information_required"],
        "credit_approved": ["submitted", "under_review", "credit_approved"],
        "approved_with_conditions": ["submitted", "under_review", "approved_with_conditions"],
        "declined": ["submitted", "under_review", "declined"],
        "superseded": ["superseded"],
    }
    for step in walks[target]:
        extra = {"conditions": "Cond"} if step == "approved_with_conditions" else {}
        r = await transition(client, project, step, **extra)
        assert r.status_code == 200, r.text


async def test_every_illegal_transition_409s(client, project):
    """The whole complement of ALLOWED_TRANSITIONS, driven through the real
    endpoint. Slow but exhaustive -- the state machine is the release."""
    from app.financial_model.provenance import ALLOWED_TRANSITIONS

    await save_appraisal(client, project)
    statuses = list(ALLOWED_TRANSITIONS)
    for from_status, allowed in ALLOWED_TRANSITIONS.items():
        for to_status in statuses:
            if to_status in allowed:
                continue
            if from_status == "superseded":
                continue  # no live case to address; covered below
            await case_at(client, project, from_status)
            extra = {"conditions": "Cond"} if to_status == "approved_with_conditions" else {}
            r = await transition(client, project, to_status, **extra)
            assert r.status_code == 409, (from_status, to_status, r.text)


async def test_transition_with_no_live_case_404s(client, project):
    await save_appraisal(client, project)
    r = await transition(client, project, "submitted")
    assert r.status_code == 404


async def test_unknown_to_status_is_422(client, project):
    await save_appraisal(client, project)
    await create_case(client, project)
    r = await transition(client, project, "signed_off")
    assert r.status_code == 422


async def test_conditions_required_and_forbidden(client, project):
    await save_appraisal(client, project)
    await case_at(client, project, "under_review")
    r = await transition(client, project, "approved_with_conditions")
    assert r.status_code == 422
    assert any(d.get("field") == "conditions" for d in r.json()["detail"])
    r = await transition(client, project, "credit_approved", conditions="Cond")
    assert r.status_code == 422


async def test_case_hash_recomputed_and_independently_derivable(client, project):
    """Spec Sec 21.4. Re-derived here by hand -- sha256 over the eight joined
    parts, decided_at re-canonicalised from the response -- the same
    independence discipline as the audit-hash test."""
    import hashlib
    from datetime import datetime, timezone

    await save_appraisal(client, project)
    created = await create_case(client, project)
    await case_at(client, project, "credit_approved")
    body = (await client.get(f"/api/v1/lender-cases/{project['id']}")).json()
    assert body["case_hash"] != created["case_hash"]

    decided = datetime.fromisoformat(body["decided_at"])
    if decided.tzinfo is None:
        decided = decided.replace(tzinfo=timezone.utc)
    decided_str = decided.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    expected = hashlib.sha256("|".join([
        body["id"], body["project_id"], "credit_approved",
        body["submitted_by"], body["reviewer"], body["decided_by"],
        decided_str, body["locked_audit_hash"],
    ]).encode()).hexdigest()
    assert body["case_hash"] == expected


async def test_stale_flips_on_a_changed_resave_only(client, project):
    await save_appraisal(client, project)
    await create_case(client, project)

    resp = await client.put(f"/api/v1/appraisals/{project['id']}",
                            json={"inputs_snapshot": fixture_a_inputs()})
    assert resp.status_code == 200
    assert (await client.get(f"/api/v1/lender-cases/{project['id']}")).json()["stale"] is False

    changed = fixture_a_inputs()
    changed["acquisition"]["purchase_price_pence"] += 100_000
    resp = await client.put(f"/api/v1/appraisals/{project['id']}",
                            json={"inputs_snapshot": changed})
    assert resp.status_code == 200
    assert (await client.get(f"/api/v1/lender-cases/{project['id']}")).json()["stale"] is True


async def test_superseded_case_keeps_its_record_and_history_lists_both(client, project):
    await save_appraisal(client, project)
    await case_at(client, project, "credit_approved")
    assert (await transition(client, project, "superseded")).status_code == 200
    await create_case(client, project)

    history = (await client.get(f"/api/v1/lender-cases/{project['id']}/history")).json()
    assert len(history) == 2
    assert history[0]["status"] == "draft"
    assert history[1]["status"] == "superseded"
    # The dead case kept the decision it carried when it died.
    assert history[1]["decided_by"] is not None


async def test_history_orders_same_second_cases_by_creation_event_not_scan_order(
    client, project, db_engine
):
    """Pins the repository's tiebreak itself (spec Sec 21.5's newest-first
    ordering) rather than relying on it holding by side effect. sqlite's
    CURRENT_TIMESTAMP is 1-second resolution, so two cases opened close
    together routinely tie on created_at; forcing that tie explicitly here
    proves list_by_project_id resolves it by real creation order (each
    case's latest event id) rather than arbitrary database scan order."""
    from datetime import datetime, timezone
    from uuid import UUID as _UUID

    from sqlalchemy import update as sa_update

    await save_appraisal(client, project)
    await create_case(client, project)
    assert (await transition(client, project, "superseded")).status_code == 200
    await create_case(client, project)

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    tied_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with session_factory() as session:
        await session.execute(
            sa_update(LenderCaseORM)
            .where(LenderCaseORM.project_id == _UUID(project["id"]))
            .values(created_at=tied_at)
        )
        await session.commit()

    history = (await client.get(f"/api/v1/lender-cases/{project['id']}/history")).json()
    assert [h["status"] for h in history] == ["draft", "superseded"]


async def test_project_delete_cascades_cases_and_events(client, project, db_engine):
    """ProjectRepository.delete is bulk SQL (`delete(ProjectORM).where(...)`),
    which bypasses the ORM's `cascade="all, delete-orphan"` relationships on
    sqlite without `PRAGMA foreign_keys=ON` (Postgres's real FK constraint
    enforces the cascade regardless of how the row is deleted). What this
    test actually needs to prove -- that the ORM relationships are correctly
    configured -- is asserted here through the ORM-relationship delete path
    (`session.delete` on a loaded row) rather than through the API's bulk
    delete. ProjectRepository.delete itself is unchanged."""
    from uuid import UUID as _UUID

    from sqlalchemy import func as sa_func, select as sa_select
    from app.persistence.database import LenderCaseEventORM, ProjectORM

    await save_appraisal(client, project)
    await create_case(client, project)

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        row = await session.get(ProjectORM, _UUID(project["id"]))
        await session.delete(row)
        await session.commit()

    async with session_factory() as session:
        cases = (await session.execute(sa_select(sa_func.count()).select_from(LenderCaseORM))).scalar_one()
        events = (await session.execute(sa_select(sa_func.count()).select_from(LenderCaseEventORM))).scalar_one()
    assert cases == 0 and events == 0
