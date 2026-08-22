"""Upsert semantics: POSTing an eligibility assessment or appraisal twice for
the same project must update the existing row, not insert a duplicate."""
import asyncio
import copy
import json
import time
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.app import app
from app.integrations.postcodes import PostcodeLookupResult
from app.persistence.database import (
    Base,
    EligibilityAssessmentORM,
    FinancialAppraisalORM,
    get_db,
)

FIXTURE_A_PATH = (
    Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "a-all-cash.json"
)
FIXTURE_A_INPUTS = json.loads(FIXTURE_A_PATH.read_text())["inputs"]

# Fields the R8 migration to v5 added to the acquisition block (calc 2.7.0).
_R8_ACQUISITION_FIELDS = (
    "jurisdiction", "jurisdiction_source", "jurisdiction_evidence_status",
    "acquisition_date", "acquisition_tax_override_pence",
    "acquisition_tax_override_reason",
)


def _v4_inputs() -> dict:
    """A real v4 document: fixture A (a real v5 fixture) with the R8
    acquisition fields stripped and inputs_version rolled back to 4 -- what
    every appraisal saved before this release actually looks like on disk."""
    doc = copy.deepcopy(FIXTURE_A_INPUTS)
    doc["inputs_version"] = 4
    for field in _R8_ACQUISITION_FIELDS:
        doc["acquisition"].pop(field, None)
    return doc


async def _no_postcode_match(_postcode: str) -> None:
    """A `lookup_postcode` stand-in for tests that need the network call
    stubbed out but don't care about its result: e.g. a project whose
    postcode is set but doesn't resolve to a known jurisdiction, or a test
    that isn't about R8 derivation at all and would otherwise pick up a real
    (slow, flaky-by-nature) HTTP call as an unrelated side effect."""
    return None


def _postcode_result(country: str) -> PostcodeLookupResult:
    return PostcodeLookupResult(
        postcode="CF10 3NQ",
        latitude=51.48,
        longitude=-3.18,
        lpa_name="Cardiff",
        lpa_code="W06000015",
        region="Wales" if country == "Wales" else "",
        country=country,
        admin_district="Cardiff",
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
    async def test_posting_twice_yields_one_row(self, client, db_sessionmaker, monkeypatch):
        # R8 Task 10: the first POST for a new project with a postcode set now
        # attempts a live jurisdiction lookup. Stub it out so this pre-R8 test
        # stays hermetic and fast rather than gaining a real network call.
        monkeypatch.setattr("app.api.app.lookup_postcode", _no_postcode_match)
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


class TestAppraisalV5Normalisation:
    """R8 Task 10: the appraisal endpoints normalise every stored/submitted
    snapshot to the current schema version (app/api/app.py), not v4.

    R9 Task 3 moved that boundary on again, from v5 to v6
    (migrate_inputs_to_v6). R10 Task 6 moves it once more, from v6 to v7
    (migrate_inputs_to_v7). R11 Task 10 moves it to v8
    (migrate_inputs_to_v8, spec Sec 17.11). The class name is left alone
    deliberately -- these cases are about the jurisdiction fields v5
    introduced, which v6, v7 and v8 carry forward untouched, and renaming them
    would obscure what they pin."""

    @pytest.mark.asyncio
    async def test_v4_snapshot_normalises_to_v6_with_default_jurisdiction(
        self, client, monkeypatch,
    ):
        monkeypatch.setattr("app.api.app.lookup_postcode", _no_postcode_match)
        project_id = await _create_project(client)

        resp = await client.post("/api/v1/appraisals", json={
            "project_id": project_id,
            "name": "v4 appraisal",
            "inputs_snapshot": _v4_inputs(),
        })
        assert resp.status_code == 201, resp.text
        body = resp.json()
        # The governance column (drives audit_hash), not just the snapshot's
        # own inputs_version. R10 Task 6: the boundary is v7. R11 Task 10: v8.
        assert body["inputs_version"] == 8
        snapshot = body["inputs_snapshot"]

        assert snapshot["inputs_version"] == 8
        acq = snapshot["acquisition"]
        assert acq["jurisdiction"] == "england_ni"
        assert acq["jurisdiction_source"] == "migrated_default"
        assert acq["jurisdiction_evidence_status"] == "unconfirmed"
        assert acq["acquisition_date"] is None

    @pytest.mark.asyncio
    async def test_v5_snapshot_preserves_a_confirmed_welsh_jurisdiction(
        self, client, monkeypatch,
    ):
        # Stubbed regardless of result: an explicit, already-confirmed
        # jurisdiction must survive even where the postcode disagrees --
        # derivation is gated on jurisdiction_source == "migrated_default"
        # and must never run at all here.
        monkeypatch.setattr("app.api.app.lookup_postcode", _no_postcode_match)
        project_id = await _create_project(client)

        welsh_doc = copy.deepcopy(FIXTURE_A_INPUTS)
        welsh_doc["acquisition"].update({
            "jurisdiction": "wales",
            "jurisdiction_source": "user",
            "jurisdiction_evidence_status": "confirmed",
            "acquisition_date": "2026-08-17",
        })

        resp = await client.post("/api/v1/appraisals", json={
            "project_id": project_id,
            "name": "Welsh appraisal",
            "inputs_snapshot": welsh_doc,
        })
        assert resp.status_code == 201, resp.text
        body = resp.json()
        acq = body["inputs_snapshot"]["acquisition"]
        assert acq["jurisdiction"] == "wales"
        assert acq["jurisdiction_evidence_status"] == "confirmed"
        assert body["outputs"]["metrics"]["acquisition_tax"]["regime"] == "LTT"

        # Re-saving (the update path, a full is_v5 merge round-trip) must not
        # disturb it either.
        resp2 = await client.put(
            f"/api/v1/appraisals/{project_id}",
            json={"inputs_snapshot": body["inputs_snapshot"]},
        )
        assert resp2.status_code == 200, resp2.text
        acq2 = resp2.json()["inputs_snapshot"]["acquisition"]
        assert acq2["jurisdiction"] == "wales"
        assert acq2["jurisdiction_evidence_status"] == "confirmed"

    @pytest.mark.asyncio
    async def test_malformed_inputs_snapshot_is_422_not_500(self, client, monkeypatch):
        """Task 10 known item #1: a document the migration chain cannot
        interpret (here, `acquisition` sent as a string, so the merge helper's
        `**(saved.get('acquisition') or {})` raises `TypeError: 'str' object
        is not a mapping` deep inside migrate_inputs_to_v5) must come back a
        clean 422, never an unhandled 500."""
        monkeypatch.setattr("app.api.app.lookup_postcode", _no_postcode_match)
        project_id = await _create_project(client)

        resp = await client.post("/api/v1/appraisals", json={
            "project_id": project_id,
            "name": "Malformed appraisal",
            "inputs_snapshot": {
                "inputs_version": 4,
                "acquisition": "garbage-not-a-dict",
                "finance": {"committed_net_facility_pence": 0},
            },
        })
        assert resp.status_code == 422, resp.text
        assert "inputs_snapshot" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_unrecognised_inputs_version_is_422_not_silently_rebuilt_as_v1(
        self, client, monkeypatch,
    ):
        """Fix round 1, review item 1: an inputs_version this module doesn't
        implement (here 9, a stand-in for a future/unknown client version)
        satisfies none of the is_vN structural checks and used to fall
        through, undetected, all the way to migrate_inputs' v1 fallback --
        reading a real, fully-formed document as noise and rebuilding
        finance/equity_sources from an LTV-based heuristic. That must now be
        a 422, not a 201 carrying a silently corrupted snapshot.

        R9 Task 3 moved the stand-in from 6 to 7; R10 Task 6 moved it from 7 to
        8; R11 Task 10 moves it from 8 to 9: 8 is now a version this server
        implements, so it no longer stands in for one it does not. 9 is also
        the NEIGHBOUR of the recognised set, which is the only value that
        catches a predicate loosened to the negation of its own tuple (spec
        Sec 17.11)."""
        monkeypatch.setattr("app.api.app.lookup_postcode", _no_postcode_match)
        project_id = await _create_project(client)

        unknown_version_doc = copy.deepcopy(FIXTURE_A_INPUTS)
        unknown_version_doc["inputs_version"] = 9

        resp = await client.post("/api/v1/appraisals", json={
            "project_id": project_id,
            "name": "Unknown version appraisal",
            "inputs_snapshot": unknown_version_doc,
        })
        assert resp.status_code == 422, resp.text
        assert "inputs_snapshot" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_unknown_future_inputs_version_is_422_not_silent_corruption(
        self, client, monkeypatch,
    ):
        """R9 Task 3, extended by R10 Task 6 and R11 Task 10. R8's
        silent-corruption bug,
        guarded forward: an inputs_version this server does not implement
        must be refused, never rebuilt from the v1 LTV heuristic and returned
        as 201.

        Distinct from the case above: this one carries nothing but the version
        tag, and pins that the migration's own refusal *message* reaches the
        caller rather than being flattened into a generic 422 -- a reader
        needs to know it was the version that was rejected."""
        monkeypatch.setattr("app.api.app.lookup_postcode", _no_postcode_match)
        project_id = await _create_project(client)

        resp = await client.post("/api/v1/appraisals", json={
            "project_id": project_id,
            "name": "Future version appraisal",
            "inputs_snapshot": {"inputs_version": 9},
        })
        assert resp.status_code == 422, resp.text
        assert "unrecognised inputs_version" in resp.text

    @pytest.mark.asyncio
    async def test_structurally_invalid_v5_is_422_not_silently_rebuilt_as_v1(
        self, client, monkeypatch,
    ):
        """Fix round 1, review item 1: a document tagged inputs_version 5
        that fails is_v5's own structural check (finance missing
        committed_net_facility_pence) also used to fall through to the v1
        fallback undetected -- exactly the corruption the v5-vs-v4 guard
        elsewhere in migrate.py exists to stop, just triggered by a document
        that claims to be v5 rather than one that plainly is."""
        monkeypatch.setattr("app.api.app.lookup_postcode", _no_postcode_match)
        project_id = await _create_project(client)

        malformed_v5_doc = copy.deepcopy(FIXTURE_A_INPUTS)
        malformed_v5_doc["inputs_version"] = 5
        del malformed_v5_doc["finance"]["committed_net_facility_pence"]

        resp = await client.post("/api/v1/appraisals", json={
            "project_id": project_id,
            "name": "Malformed v5 appraisal",
            "inputs_snapshot": malformed_v5_doc,
        })
        assert resp.status_code == 422, resp.text
        assert "inputs_snapshot" in resp.json()["detail"]


class TestPostcodeJurisdictionDerivation:
    """R8 Task 10: a project with a known postcode country proposes a
    jurisdiction for a genuinely new appraisal only -- never confirmed, never
    applied to an appraisal that already exists."""

    @pytest.mark.asyncio
    async def test_derives_jurisdiction_from_project_postcode_on_first_save(
        self, client, monkeypatch,
    ):
        calls: list[str] = []

        async def fake_lookup(postcode: str):
            calls.append(postcode)
            return _postcode_result("Wales")

        monkeypatch.setattr("app.api.app.lookup_postcode", fake_lookup)
        project_id = await _create_project(client)  # address_postcode = "SW1A 1AA"

        resp = await client.post(
            "/api/v1/appraisals", json=_appraisal_body(project_id, "first save"),
        )
        assert resp.status_code == 201, resp.text
        acq = resp.json()["inputs_snapshot"]["acquisition"]
        assert acq["jurisdiction"] == "wales"
        assert acq["jurisdiction_source"] == "derived"
        # Derivation proposes; it never confirms (spec Sec 3.6).
        assert acq["jurisdiction_evidence_status"] == "unconfirmed"
        assert calls == ["SW1A 1AA"]

    @pytest.mark.asyncio
    async def test_second_save_neither_re_derives_nor_overwrites(self, client, monkeypatch):
        """Mutation check: flip the second lookup's country to Scotland. If
        the `existing is None` guard in create_appraisal were ever dropped,
        this would silently relabel a project's jurisdiction on every
        unrelated re-save -- exactly the overwrite the design forbids. The
        second save resubmits the full document the first save returned (a
        realistic client round-trip, not a fresh minimal body) -- POST
        replaces `inputs_snapshot` wholesale rather than merging with the
        stored row, so a garbage second body would prove nothing here: the
        wales value would only survive because it is genuinely still present
        on the wire, not because anything preserved it server-side."""
        countries = iter(["Wales", "Scotland"])
        calls: list[str] = []

        async def fake_lookup(postcode: str):
            calls.append(postcode)
            return _postcode_result(next(countries))

        monkeypatch.setattr("app.api.app.lookup_postcode", fake_lookup)
        project_id = await _create_project(client)

        r1 = await client.post(
            "/api/v1/appraisals", json=_appraisal_body(project_id, "first save"),
        )
        assert r1.status_code == 201, r1.text
        assert r1.json()["inputs_snapshot"]["acquisition"]["jurisdiction"] == "wales"
        assert r1.json()["inputs_snapshot"]["acquisition"]["jurisdiction_source"] == "derived"

        r2 = await client.post("/api/v1/appraisals", json={
            "project_id": project_id,
            "name": "second save",
            "inputs_snapshot": r1.json()["inputs_snapshot"],
        })
        assert r2.status_code == 201, r2.text
        acq2 = r2.json()["inputs_snapshot"]["acquisition"]
        # Still Wales, still "derived" -- the second save must not re-derive
        # (jurisdiction_source is no longer "migrated_default") and must not
        # overwrite towards the second lookup's Scotland either.
        assert acq2["jurisdiction"] == "wales"
        assert acq2["jurisdiction_source"] == "derived"
        # The lookup was only ever attempted once, on the first save.
        assert calls == ["SW1A 1AA"]

    @pytest.mark.asyncio
    async def test_no_derivation_without_a_known_postcode(self, client, monkeypatch):
        def _must_not_be_called(_postcode):
            raise AssertionError("lookup_postcode must not be called without a postcode")

        monkeypatch.setattr("app.api.app.lookup_postcode", _must_not_be_called)

        resp = await client.post(
            "/api/v1/projects",
            json={
                "address_raw": "1 No Postcode Street",
                "price_pence": 1_000_000,
                "use_class": "office",
            },
        )
        assert resp.status_code == 201, resp.text
        project_id = resp.json()["id"]
        assert resp.json()["address_postcode"] is None

        appraisal_resp = await client.post(
            "/api/v1/appraisals", json=_appraisal_body(project_id, "no postcode"),
        )
        assert appraisal_resp.status_code == 201, appraisal_resp.text
        acq = appraisal_resp.json()["inputs_snapshot"]["acquisition"]
        assert acq["jurisdiction"] == "england_ni"
        assert acq["jurisdiction_source"] == "migrated_default"

    @pytest.mark.asyncio
    async def test_no_override_when_postcode_country_is_unrecognised(self, client, monkeypatch):
        """derive_jurisdiction returns None for a country postcodes.io didn't
        map to one of the three UK jurisdictions (e.g. a Crown Dependency);
        the default must be left alone, not stamped with a None jurisdiction."""
        async def fake_lookup(_postcode: str):
            return _postcode_result("Isle of Man")

        monkeypatch.setattr("app.api.app.lookup_postcode", fake_lookup)
        project_id = await _create_project(client)

        resp = await client.post(
            "/api/v1/appraisals", json=_appraisal_body(project_id, "unmapped country"),
        )
        assert resp.status_code == 201, resp.text
        acq = resp.json()["inputs_snapshot"]["acquisition"]
        assert acq["jurisdiction"] == "england_ni"
        assert acq["jurisdiction_source"] == "migrated_default"

    @pytest.mark.asyncio
    async def test_explicit_jurisdiction_on_first_save_is_not_overridden(
        self, client, monkeypatch,
    ):
        """Even on a project's very first appraisal (`existing is None`), a
        document that already names its own jurisdiction explicitly must win
        over a postcode-derived proposal. The override in create_appraisal is
        gated on `jurisdiction_source == "migrated_default"`, not on
        `existing is None` alone -- this is the one case that tells the two
        conditions apart: this save IS new, but the jurisdiction is NOT a
        migration default."""
        async def fake_lookup(_postcode: str):
            return _postcode_result("Wales")  # would derive "wales" if applied

        monkeypatch.setattr("app.api.app.lookup_postcode", fake_lookup)
        project_id = await _create_project(client)

        scottish_doc = copy.deepcopy(FIXTURE_A_INPUTS)
        scottish_doc["acquisition"].update({
            "jurisdiction": "scotland",
            "jurisdiction_source": "user",
            "jurisdiction_evidence_status": "confirmed",
            "acquisition_date": "2026-08-17",
        })

        resp = await client.post("/api/v1/appraisals", json={
            "project_id": project_id,
            "name": "Scottish appraisal, first save",
            "inputs_snapshot": scottish_doc,
        })
        assert resp.status_code == 201, resp.text
        acq = resp.json()["inputs_snapshot"]["acquisition"]
        assert acq["jurisdiction"] == "scotland"
        assert acq["jurisdiction_source"] == "user"
        assert acq["jurisdiction_evidence_status"] == "confirmed"

    @pytest.mark.asyncio
    async def test_slow_postcode_lookup_does_not_block_the_save(self, client, monkeypatch):
        """Fix round 1, review item 3 (raised to 5.0s in fix round 2 -- a
        real postcodes.io call measured ~2s in this sandbox, so the original
        2.0s ceiling left almost no margin and would time out on a merely
        slightly-slow-but-healthy response, not just a pathological one).
        lookup_postcode's own timeout is 10s *per phase*, so a peer that is
        merely slow -- not outright failing -- could otherwise hold a save
        open well past that for a value this endpoint only ever treats as
        advisory. create_appraisal wraps the call in
        `asyncio.wait_for(..., 5.0)`; a lookup that hangs longer than that
        must fall back to the unconfirmed default, not block the save."""
        async def hanging_lookup(_postcode: str):
            await asyncio.sleep(30)
            return _postcode_result("Wales")  # never reached

        monkeypatch.setattr("app.api.app.lookup_postcode", hanging_lookup)
        project_id = await _create_project(client)

        started = time.perf_counter()
        resp = await client.post(
            "/api/v1/appraisals", json=_appraisal_body(project_id, "slow postcode lookup"),
        )
        elapsed = time.perf_counter() - started

        assert resp.status_code == 201, resp.text
        assert elapsed < 10, f"save took {elapsed:.1f}s -- the 5s cap did not apply"
        acq = resp.json()["inputs_snapshot"]["acquisition"]
        assert acq["jurisdiction"] == "england_ni"
        assert acq["jurisdiction_source"] == "migrated_default"
