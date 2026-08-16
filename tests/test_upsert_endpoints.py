"""Upsert semantics: POSTing an eligibility assessment or appraisal twice for
the same project must update the existing row, not insert a duplicate."""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.app import app
from app.persistence.database import (
    Base,
    EligibilityAssessmentORM,
    FinancialAppraisalORM,
    get_db,
)


@pytest_asyncio.fixture
async def db_sessionmaker():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_sessionmaker):
    async def override_get_db():
        async with db_sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _create_project(client: AsyncClient) -> str:
    resp = await client.post(
        "/api/v1/projects",
        json={
            "address_raw": "10 Test Office, London, SW1A 1AA",
            "address_postcode": "SW1A 1AA",
            "price_pence": 50000000,
            "use_class": "office",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _eligibility_body(project_id: str, verdict: str) -> dict:
    return {
        "project_id": project_id,
        "pdr_class": "class_ma",
        "criteria": [
            {"key": "use_class_check", "label": "Use class", "passed": True}
        ],
        "verdict": verdict,
        "suggested_next_steps": [],
    }


def _appraisal_body(project_id: str, name: str) -> dict:
    return {
        "project_id": project_id,
        "name": name,
        "inputs_snapshot": {"gdv": 1000000},
        "gdv_pence": 100000000,
    }


class TestEligibilityUpsert:
    @pytest.mark.asyncio
    async def test_posting_twice_yields_one_row(self, client, db_sessionmaker):
        project_id = await _create_project(client)

        r1 = await client.post(
            f"/api/v1/eligibility/{project_id}",
            json=_eligibility_body(project_id, "amber"),
        )
        assert r1.status_code == 201, r1.text

        r2 = await client.post(
            f"/api/v1/eligibility/{project_id}",
            json=_eligibility_body(project_id, "green"),
        )
        assert r2.status_code == 201, r2.text

        # Second POST updated in place — same row id, new verdict
        assert r2.json()["id"] == r1.json()["id"]
        assert r2.json()["verdict"] == "green"

        async with db_sessionmaker() as session:
            count = await session.scalar(
                select(func.count()).select_from(EligibilityAssessmentORM)
            )
        assert count == 1

    @pytest.mark.asyncio
    async def test_post_for_missing_project_404s(self, client):
        missing = "00000000-0000-0000-0000-000000000000"
        resp = await client.post(
            f"/api/v1/eligibility/{missing}",
            json=_eligibility_body(missing, "amber"),
        )
        assert resp.status_code == 404


class TestAppraisalUpsert:
    @pytest.mark.asyncio
    async def test_posting_twice_yields_one_row(self, client, db_sessionmaker):
        project_id = await _create_project(client)

        r1 = await client.post("/api/v1/appraisals", json=_appraisal_body(project_id, "v1"))
        assert r1.status_code == 201, r1.text

        r2 = await client.post("/api/v1/appraisals", json=_appraisal_body(project_id, "v2"))
        assert r2.status_code == 201, r2.text

        assert r2.json()["id"] == r1.json()["id"]
        assert r2.json()["name"] == "v2"

        async with db_sessionmaker() as session:
            count = await session.scalar(
                select(func.count()).select_from(FinancialAppraisalORM)
            )
        assert count == 1

    @pytest.mark.asyncio
    async def test_post_for_missing_project_404s(self, client):
        missing = "00000000-0000-0000-0000-000000000000"
        resp = await client.post("/api/v1/appraisals", json=_appraisal_body(missing, "v1"))
        assert resp.status_code == 404
