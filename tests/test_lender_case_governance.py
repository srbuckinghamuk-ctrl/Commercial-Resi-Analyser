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
