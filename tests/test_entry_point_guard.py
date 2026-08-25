"""R12 Task 18b, spec Sec 18.7. The Python half of THE guard that would have
caught R12 shipping inert. R14 Task 14 (spec Sec 20.1, guard 8) moves the
version chain it derives from to v11.

Every arm R14 built -- the funding-side correction, the draw cap, and the
monitoring statement and its surfaces -- is reachable only from a v11
document. If ``app/api/app.py`` keeps calling the v10 migration, no user ever
holds a v11 document, none of that code is reachable in production, and
roughly four thousand tests stay green while proving it all works in a world
nobody inhabits. That is not hypothetical: R10 shipped exactly this split in
the other direction (server on v7, client on v6) and made every saved
appraisal unloadable; R9, R11, R12 and R13 each recorded a version of it.

**If this test failed and you are looking for what to do**: a production module
calls ``migrate_inputs_to_v{N}`` for an N that is not the newest migration
``app/financial_model/migrate.py`` offers. Either move that call site to the
newest one, or -- if you are deliberately adding a new version -- move ALL of
them, in ONE commit, together with the TypeScript half
(``frontend/src/lib/model/entry-point-guard.test.ts``) and both client entry
points. The persistence boundary is one thing with several halves; each
``migrate_inputs_to_v{N}`` refuses a v{N+1} document by design (spec Sec 3.5),
so a boundary split across two versions is not a degraded state, it is a broken
one.

The rule is written as "every production call site names the NEWEST migration",
derived from the migration module itself, rather than as "nobody names v8". A
hand-written "not v8" rule goes vacuous the moment v10 exists -- it would pass
a release that left every entry point on v9 -- and a guard that silently stops
guarding is the failure mode this file exists to prevent.
"""
import json
import re
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.app import app
from app.persistence.database import Base, get_db

APP_ROOT = Path(__file__).resolve().parents[1] / "app"
REPO_ROOT = Path(__file__).resolve().parents[1]

#: The migration module defines the versions, so it is exempt from its own
#: rule, as is the package __init__ that re-exports them for the tests and
#: gates that call the older entry points deliberately (the migration identity
#: gates use the v8 entry point as the "before" side of a before/after
#: comparison, which is the whole point of keeping it exported).
EXEMPT = {
    "financial_model/migrate.py",
    "financial_model/__init__.py",
}

MIGRATE_SOURCE = (APP_ROOT / "financial_model" / "migrate.py").read_text(encoding="utf-8")

_ENTRY_POINT_DEF = re.compile(r"^def migrate_inputs_to_v(\d+)\s*\(", re.MULTILINE)
_CALL = re.compile(r"\bmigrate_inputs_to_v(\d+)\s*\(")
_NAME = re.compile(r"\bmigrate_inputs_to_v(\d+)\b")


def _exported_entry_point_versions() -> list[int]:
    """Every ``migrate_inputs_to_v{N}`` the module actually defines, ascending."""
    return sorted({int(m) for m in _ENTRY_POINT_DEF.findall(MIGRATE_SOURCE)})


VERSIONS = _exported_entry_point_versions()
NEWEST = VERSIONS[-1] if VERSIONS else None


def _production_files() -> list[str]:
    out = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        rel = path.relative_to(APP_ROOT).as_posix()
        if rel in EXEMPT:
            continue
        if "/tests/" in f"/{rel}" or rel.startswith("tests/"):
            continue
        out.append(rel)
    return out


def _used_versions(source: str) -> set[int]:
    """The versions a module actually USES, as opposed to mentions.

    A call or an import of the name is a use. This repo's comments narrate the
    boundary's history by name across several releases and that prose is worth
    keeping, so a bare mention in a comment is not counted.
    """
    used = {int(m) for m in _CALL.findall(source)}
    for line in source.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(("import ", "from ")) or (
            stripped.startswith("migrate_inputs_to_v") and stripped.endswith(",")
        ):
            used.update(int(m) for m in _NAME.findall(line))
    return used


def test_migrate_module_exports_the_version_chain_this_guard_is_derived_from():
    """Non-vacuity, part 1: if the regex stopped matching, ``VERSIONS`` would be
    empty and every assertion below would pass over nothing."""
    assert len(VERSIONS) > 1
    assert NEWEST == 12
    assert 11 in VERSIONS


def test_guard_enumerates_the_production_module_that_holds_the_entry_point():
    """Non-vacuity, part 2: a guard that enumerated an empty file list, or lost
    the module the server boundary lives in, would pass while guarding
    nothing."""
    files = _production_files()
    assert len(files) > 10
    with_uses = [
        rel for rel in files
        if _used_versions((APP_ROOT / rel).read_text(encoding="utf-8"))
    ]
    assert with_uses == ["api/app.py"]


def test_no_production_module_calls_anything_but_the_newest_migration():
    offenders = []
    for rel in _production_files():
        source = (APP_ROOT / rel).read_text(encoding="utf-8")
        for version in sorted(_used_versions(source)):
            if version != NEWEST:
                offenders.append(f"{rel}: migrate_inputs_to_v{version}")
    assert offenders == []


def test_the_guard_proves_itself_on_a_stale_call_site():
    """Without this, a ``_used_versions`` that quietly stopped matching would
    make the assertion above pass on every file in the tree."""
    assert _used_versions("from app.financial_model.migrate import migrate_inputs_to_v8") == {8}
    assert _used_versions("    inputs = migrate_inputs_to_v8(raw)") == {8}
    assert _used_versions("# R11 Task 10 moved this to migrate_inputs_to_v8, one version back") == set()


# --- R14 Task 14 (spec Sec 20.1), R13 Task 18's finding one version on ---
#
# Every static assertion above proves the SOURCE names the newest migration.
# None of it proves the server actually RUNS that arm: R12's first attempt at
# this step compared two v9 runs and called that evidence, and separately
# found `is_v2_or_later` missing `is_v9` -- a defect that made every appraisal
# saved after that release come back stamped `legacy_unreconciled` and
# provenance-hashed as such, on the THIRD consecutive release to lose that
# same half of the boundary (R9, R10, R11 each recorded a version of it, and
# R13 Task 5 pre-empted it for v10 ahead of that release's own cutover). Only
# a real POST through the real server boundary, asserted against v11 -- not a
# document that would pass identically against v10 -- can catch that class of
# defect again.
@pytest_asyncio.fixture
async def _guard_db_sessionmaker():
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
async def _guard_client(_guard_db_sessionmaker):
    async def override_get_db():
        async with _guard_db_sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_the_server_migrates_a_stored_v10_document_to_v12_as_reconciled(_guard_client):
    """R13 Task 18, two versions on (R14 Task 14, R13b Task 15). The cutover is
    what finds the boundary bug: R12's own cutover found `is_v2_or_later`
    missing `is_v9`, so every appraisal saved after release would have come
    back stamped `legacy_unreconciled` and provenance-hashed as such. R13
    Task 5 pre-empted the identical trap for v10 ahead of THIS release's
    cutover (`is_v11` was already added to `is_v2_or_later` before that task
    landed), which is exactly why this test must still exercise the live
    server rather than trust that addition by inspection.

    Kept as the v10-arm case (R14 Task 14 / R13b Task 15's standing
    instruction: extend the R13 proof rather than replace it) -- the fixture
    genuinely is a v10 document, and posting it proves a document saved two
    releases ago still loads and re-saves cleanly once the server migrates
    every payload two versions further. The posted document must come back at
    inputs_version 12 AND not be tagged legacy, with its investment_case
    intact, monitoring still absent (this fixture never entered a QS
    statement) and unit_sales null (this fixture never entered a per-unit
    ledger). A v9 document run through the identical assertions would also
    come back reconciled at whatever version the server currently writes --
    it is the combination of "reached inputs_version 12" AND "not legacy" AND
    "investment_case survived" on a document that STARTED at v10 that a
    v9-only regression cannot pass by accident.

    Deviates from the brief's sketch in two ways the brief itself got wrong
    (spec Sec 19.9's standing instruction, carried forward: say so rather than
    silently matching the brief). First, the endpoint is mounted at
    ``{api_prefix}/appraisals`` (``/api/v1/appraisals`` -- see
    ``app/api/app.py``'s ``include_router`` calls), not bare ``/appraisals``.
    Second, the response is a ``FinancialAppraisal`` (``app/models.py``): the
    migrated document comes back under the top-level ``inputs_snapshot`` key,
    not nested under an ``inputs`` key, and the reconciliation status is the
    top-level ``status`` field.
    """
    fixture = json.loads(
        (REPO_ROOT / "fixtures" / "financial-model" / "t-investment-case.json")
        .read_text(encoding="utf-8"),
    )
    posted_inputs = fixture["inputs"]
    assert posted_inputs["inputs_version"] == 10
    assert posted_inputs["investment_case"] is not None

    project_resp = await _guard_client.post(
        "/api/v1/projects",
        json={
            "address_raw": "1 Investment Case Way, York, YO1 8AN",
            "price_pence": 42_500_000,
            "use_class": "office",
        },
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    resp = await _guard_client.post(
        "/api/v1/appraisals",
        json={
            "project_id": project_id,
            "name": "T -- investment case",
            "inputs_snapshot": posted_inputs,
        },
    )
    assert resp.status_code == 201, resp.text
    saved = resp.json()

    assert saved["inputs_snapshot"]["inputs_version"] == 12
    assert saved["status"] != "legacy_unreconciled"
    assert saved["inputs_snapshot"]["investment_case"] is not None
    assert saved["inputs_snapshot"]["monitoring"] is None
    assert saved["inputs_snapshot"]["unit_sales"] is None
    # Fix round 1 (spec Sec 19.9 review, carried forward). The GOVERNANCE
    # `inputs_version` column -- distinct from `inputs_snapshot`'s own field,
    # written by a separate line in app.py's response builder and the value
    # `audit_hash` is keyed on -- used to be a hand-written literal, bumped by
    # hand at each cutover and left stale at 9 on R13's first pass despite the
    # migration call site itself already reading v10. It is now derived
    # (`inputs.inputs_version`) rather than restated, so this assertion is the
    # one that caught it then, and the one that stops it recurring at v12: it
    # does not hardcode "12" precisely so it keeps holding without edits after
    # the next cutover, the same way this file's own NEWEST constant does.
    assert saved["inputs_version"] == saved["inputs_snapshot"]["inputs_version"]
    assert saved["inputs_version"] == 12


@pytest.mark.asyncio
async def test_the_server_round_trips_a_native_v12_document_as_reconciled(_guard_client):
    """R13b Task 15 (spec Sec 22.9), the v12-native arm the previous test does
    not cover: the fixture above STARTS at v10 and is migrated up, which
    proves the migration chain but never posts a document whose own
    `inputs_version` already reads 12 with a non-null `unit_sales` block --
    exactly what the v12 calculator itself now saves once a per-unit sales
    ledger is entered (spec Sec 22). ``x-unit-sales-ledger.json`` (this
    release's golden unit-sales fixture) is that document: `is_v12` must
    accept it as NOT legacy, and the stored `unit_sales` block must survive
    the round trip intact -- both requirements a v11-only regression could
    still pass.
    """
    fixture = json.loads(
        (REPO_ROOT / "fixtures" / "financial-model" / "x-unit-sales-ledger.json")
        .read_text(encoding="utf-8"),
    )
    posted_inputs = fixture["inputs"]
    assert posted_inputs["inputs_version"] == 12
    assert posted_inputs["unit_sales"] is not None

    project_resp = await _guard_client.post(
        "/api/v1/projects",
        json={
            "address_raw": "3 Unit Sales Ledger Way, York, YO1 8AN",
            "price_pence": 42_500_000,
            "use_class": "office",
        },
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    resp = await _guard_client.post(
        "/api/v1/appraisals",
        json={
            "project_id": project_id,
            "name": "X -- unit sales ledger",
            "inputs_snapshot": posted_inputs,
        },
    )
    assert resp.status_code == 201, resp.text
    saved = resp.json()

    assert saved["inputs_snapshot"]["inputs_version"] == 12
    assert saved["status"] != "legacy_unreconciled"
    assert saved["inputs_snapshot"]["unit_sales"] is not None
    assert saved["inputs_version"] == saved["inputs_snapshot"]["inputs_version"]
    assert saved["inputs_version"] == 12
