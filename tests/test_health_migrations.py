"""Release 2b Task 9: `GET /health` surfaces migration staleness.

R2a's UAT (docs/reviews/2026-08-13-release-2a-uat.md, defect D1) found the
production database had silently missed migration 002 because the compose
boot command swallows `alembic upgrade` failures and nothing surfaced the
mismatch. This suite pins the three DB states the health endpoint's
`migrations_current` flag must distinguish: no `alembic_version` table at
all (every other test suite's `create_all`-only fixture), stamped at the
repo's Alembic head, and stamped at a stale revision.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from alembic import command
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.app import app
from app.persistence.database import Base, get_db
from tests.test_alembic_migrations import make_config


@asynccontextmanager
async def _client_for(db_path: Path):
    """An AsyncClient wired (via dependency override, same pattern as
    test_appraisal_governance.py) to a session factory over `db_path`.

    Also re-enables the `app.api.app` logger immediately before issuing any
    request: `migrations/env.py` calls `logging.config.fileConfig(...)` on
    every Alembic command, which (per stdlib default
    `disable_existing_loggers`) disables every already-created logger not
    named in `alembic.ini` — including `app.api.app`. That's harmless in
    production (`alembic upgrade head` runs as its own short-lived CLI
    process before uvicorn starts), but here — and in
    `tests/test_alembic_migrations.py`, which may already have run earlier
    in the same pytest session — the Alembic Python API runs in-process, so
    without this it would silently swallow this suite's own
    `logger.error(...)` calls. Reset here, right before the request, so it
    holds regardless of fixture/file ordering.
    """
    logging.getLogger("app.api.app").disabled = False
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


@pytest.fixture
def sqlite_no_alembic_table(tmp_path) -> Path:
    """A DB built via `Base.metadata.create_all` only — no `alembic_version`
    table — exactly the shape every other test suite in this repo boots
    against, and the shape a fresh `create_all`-only deploy has in
    production before Alembic is ever run."""
    db_path = tmp_path / "no_alembic_table.sqlite"

    async def _create():
        engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(_create())
    return db_path


@pytest.fixture
def sqlite_stamped_at_head(tmp_path) -> Path:
    """A DB migrated with `alembic upgrade head` — alembic_version == "002"."""
    db_path = tmp_path / "stamped_at_head.sqlite"
    cfg = make_config(f"sqlite+aiosqlite:///{db_path}")
    command.upgrade(cfg, "head")
    return db_path


@pytest.fixture
def sqlite_stamped_stale(tmp_path) -> Path:
    """A DB migrated only as far as revision "001" — alembic_version ==
    "001", one behind the repo's head ("002"). This is exactly the D1
    defect shape: a real, valid revision, just not the current one."""
    db_path = tmp_path / "stamped_stale.sqlite"
    cfg = make_config(f"sqlite+aiosqlite:///{db_path}")
    command.upgrade(cfg, "001")
    return db_path


async def test_health_reports_false_when_alembic_version_table_absent(
    sqlite_no_alembic_table, caplog
):
    with caplog.at_level(logging.ERROR, logger="app.api.app"):
        async with _client_for(sqlite_no_alembic_table) as client:
            resp = await client.get("/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["migrations_current"] is False
    assert "Migration staleness detected" in caplog.text


async def test_health_reports_true_when_stamped_at_head(sqlite_stamped_at_head):
    async with _client_for(sqlite_stamped_at_head) as client:
        resp = await client.get("/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["migrations_current"] is True


async def test_health_reports_false_when_stamped_at_stale_revision(
    sqlite_stamped_stale, caplog
):
    with caplog.at_level(logging.ERROR, logger="app.api.app"):
        async with _client_for(sqlite_stamped_stale) as client:
            resp = await client.get("/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["migrations_current"] is False
    assert "Migration staleness detected" in caplog.text
