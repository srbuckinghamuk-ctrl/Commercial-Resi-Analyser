"""Phase 3 API surface: stage-transition timeline, projects pagination,
prior-approval date fields, and scrape output validation."""
import httpx
import pytest
import pytest_asyncio
import respx
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.app import app
from app.persistence.database import Base, get_db


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


async def _create_project(client: AsyncClient, **extra) -> dict:
    body = {
        "address_raw": "10 Test Office, London, SW1A 1AA",
        "address_postcode": "SW1A 1AA",
        "price_pence": 50000000,
        "use_class": "office",
    }
    body.update(extra)
    resp = await client.post("/api/v1/projects", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestTransitionsEndpoint:
    @pytest.mark.asyncio
    async def test_transitions_returned_after_stage_change(self, client):
        project = await _create_project(client)
        project_id = project["id"]

        resp = await client.post(
            f"/api/v1/projects/{project_id}/stage",
            json={"to_stage": "eligibility_assessed", "notes": "screened"},
        )
        assert resp.status_code == 200, resp.text

        resp = await client.get(f"/api/v1/projects/{project_id}/transitions")
        assert resp.status_code == 200, resp.text
        transitions = resp.json()
        assert len(transitions) == 2

        # Contract: each item exposes exactly these fields.
        for t in transitions:
            assert set(t.keys()) == {
                "id",
                "project_id",
                "from_stage",
                "to_stage",
                "notes",
                "created_at",
            }
            assert t["project_id"] == project_id

        # Newest first (non-strict — sqlite timestamps have 1s resolution).
        created = [t["created_at"] for t in transitions]
        assert created == sorted(created, reverse=True)

        to_stages = {t["to_stage"] for t in transitions}
        assert to_stages == {"opportunity_identified", "eligibility_assessed"}
        stage_change = next(t for t in transitions if t["to_stage"] == "eligibility_assessed")
        assert stage_change["from_stage"] == "opportunity_identified"
        assert stage_change["notes"] == "screened"

    @pytest.mark.asyncio
    async def test_transitions_missing_project_404s(self, client):
        resp = await client.get(
            "/api/v1/projects/00000000-0000-0000-0000-000000000000/transitions"
        )
        assert resp.status_code == 404


class TestProjectsPagination:
    @pytest.mark.asyncio
    async def test_limit_and_offset(self, client):
        for i in range(3):
            await _create_project(client, address_raw=f"Unit {i}, London")

        # Default call (no params) keeps working.
        resp = await client.get("/api/v1/projects")
        assert resp.status_code == 200
        assert len(resp.json()) == 3

        resp = await client.get("/api/v1/projects", params={"limit": 2})
        assert resp.status_code == 200
        assert len(resp.json()) == 2

        resp = await client.get("/api/v1/projects", params={"limit": 2, "offset": 2})
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    @pytest.mark.asyncio
    async def test_limit_over_max_rejected(self, client):
        resp = await client.get("/api/v1/projects", params={"limit": 1001})
        assert resp.status_code == 422


class TestPaDeadlineDates:
    @pytest.mark.asyncio
    async def test_create_and_update_pa_dates(self, client):
        project = await _create_project(client, pa_submitted_date="2026-08-01")
        assert project["pa_submitted_date"] == "2026-08-01"
        assert project["pa_decision_date"] is None

        resp = await client.put(
            f"/api/v1/projects/{project['id']}",
            json={"pa_decision_date": "2026-09-26"},
        )
        assert resp.status_code == 200, resp.text
        updated = resp.json()
        assert updated["pa_submitted_date"] == "2026-08-01"
        assert updated["pa_decision_date"] == "2026-09-26"

    @pytest.mark.asyncio
    async def test_put_can_clear_pa_dates(self, client):
        project = await _create_project(
            client, pa_submitted_date="2026-08-01", pa_decision_date="2026-09-26"
        )
        resp = await client.put(
            f"/api/v1/projects/{project['id']}",
            json={"pa_submitted_date": None, "pa_decision_date": None},
        )
        assert resp.status_code == 200, resp.text
        updated = resp.json()
        assert updated["pa_submitted_date"] is None
        assert updated["pa_decision_date"] is None


LOGIN_PAGE_HTML = """
<html><head><title>Rightmove</title></head><body>
<h1>Sign in to your account</h1>
<p>Please log in to continue browsing commercial property listings on our site.</p>
</body></html>
"""

EMPTY_LISTING_HTML = """
<html><head><title>Rightmove</title></head><body>
<h1>12 High Street, London, SW1A 1AA</h1>
<p>This page has no price and no floor area information at all, it is a shell.</p>
</body></html>
"""


class TestScrapeValidation:
    @respx.mock
    @pytest.mark.asyncio
    async def test_login_page_rejected(self, client):
        url = "https://www.rightmove.co.uk/properties/123456"
        respx.get(url).mock(return_value=httpx.Response(200, text=LOGIN_PAGE_HTML))

        resp = await client.post("/api/v1/scrape-url", json={"url": url})
        assert resp.status_code == 200
        body = resp.json()
        assert body["listing"] is None
        assert body["error"] == "Could not extract meaningful data from this page"

    @respx.mock
    @pytest.mark.asyncio
    async def test_no_price_and_no_area_rejected(self, client):
        url = "https://www.rightmove.co.uk/properties/654321"
        respx.get(url).mock(return_value=httpx.Response(200, text=EMPTY_LISTING_HTML))

        resp = await client.post("/api/v1/scrape-url", json={"url": url})
        assert resp.status_code == 200
        body = resp.json()
        assert body["listing"] is None
        assert body["error"] == "Could not extract meaningful data from this page"
