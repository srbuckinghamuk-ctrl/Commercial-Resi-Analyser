"""R14b: lender case governance (spec Sec 21) -- persistence invariants and,
from Task 4 on, the /lender-cases endpoints end-to-end against in-memory
sqlite, the test_appraisal_governance.py pattern.

R17 (spec Sec 21 amended, design Sec 10): every route is authenticated.
The fixtures seed five users -- one per role -- and mint each a bearer
token directly with `issue_token` (the login round-trip itself is proven in
test_auth.py; PBKDF2 at 390k iterations per login would otherwise dominate
this module's runtime). Every write carries the R17 concurrency triple
(`expected_version`, `expected_case_hash`, `idempotency_key`) read from the
case's last GET, exactly as the UI does.
"""
import copy
import json
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.app import app
from app.auth.passwords import hash_password
from app.auth.tokens import issue_token
from app.persistence.database import Base, LenderCaseORM, get_db
from app.persistence.repositories import UserRepository
from config.settings import get_settings

SECRET = get_settings().api_secret_key

#: role -> display name. The names are the R14b tests' names, so every
#: R14b assertion on a printed actor survives the move to authenticated users.
USERS = {
    "developer": "S. Sponsor",
    "broker": "B. Broker",
    "underwriter": "R. Reviewer",
    "credit_approver": "C. Committee",
    "administrator": "A. Admin",
}

#: Which role performs each transition by default -- the role matrix's
#: first-listed role for each target (design Sec 10.3).
DEFAULT_ACTOR = {
    "submitted": "developer",
    "under_review": "underwriter",
    "information_required": "underwriter",
    "credit_approved": "credit_approver",
    "approved_with_conditions": "credit_approver",
    "declined": "credit_approver",
    "superseded": "developer",
}


@lru_cache(maxsize=None)
def _hashed(password: str) -> tuple[str, str]:
    return hash_password(password)


@pytest.fixture
async def db_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False)


def _case_row(project_id, status: str, **overrides) -> LenderCaseORM:
    values = dict(
        project_id=project_id, status=status,
        locked_inputs_snapshot={}, locked_calc_version="2.14.0",
        locked_inputs_version=11, locked_input_hash="a" * 64,
        locked_outputs_hash="b" * 64, locked_audit_hash="c" * 64,
        case_hash="d" * 64, created_by="T. Test",
    )
    return LenderCaseORM(**(values | overrides))


async def test_second_live_case_is_refused_by_the_database(db_engine):
    """The partial unique index itself, not the endpoint's 409 twin: two
    non-superseded cases for one project must be an IntegrityError."""
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
async def client(session_factory):
    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


class User:
    def __init__(self, *, id, role, name, token):
        self.id = str(id)
        self.role = role
        self.name = name
        self.headers = {"Authorization": f"Bearer {token}"}


async def seed_user(session_factory, *, email: str, role: str, display_name: str) -> User:
    password_hash, password_salt = _hashed("correct horse battery")
    async with session_factory() as session:
        row = await UserRepository(session).create(
            email=email, display_name=display_name, role=role,
            password_hash=password_hash, password_salt=password_salt,
        )
        await session.commit()
    token = issue_token(str(row.id), secret=SECRET, ttl_seconds=3600)
    return User(id=row.id, role=role, name=display_name, token=token)


@pytest.fixture
async def users(session_factory) -> dict[str, User]:
    return {
        role: await seed_user(
            session_factory, email=f"{role}@example.test", role=role, display_name=name,
        )
        for role, name in USERS.items()
    }


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


async def post_create(client, users, project, as_="developer"):
    return await client.post(
        "/api/v1/lender-cases", json={"project_id": project["id"]}, headers=users[as_].headers,
    )


async def create_case(client, users, project, as_="developer") -> dict:
    resp = await post_create(client, users, project, as_)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def get_case(client, users, project) -> dict | None:
    resp = await client.get(
        f"/api/v1/lender-cases/{project['id']}", headers=users["developer"].headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def get_events(client, users, project) -> list[dict]:
    resp = await client.get(
        f"/api/v1/lender-cases/{project['id']}/events", headers=users["developer"].headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def transition(client, users, project, to_status, as_=None, **extra):
    """POST a transition as `as_` (default: the role matrix's first role for
    `to_status`), carrying the concurrency triple from a fresh GET unless
    `extra` overrides any part of it."""
    actor = users[as_ or DEFAULT_ACTOR.get(to_status, "developer")]
    live = await get_case(client, users, project)
    body = {
        "to_status": to_status,
        "expected_version": live["version"] if live else 1,
        "expected_case_hash": live["case_hash"] if live else "0" * 64,
        "idempotency_key": str(uuid4()),
        **extra,
    }
    return await client.post(
        f"/api/v1/lender-cases/{project['id']}/transition", json=body, headers=actor.headers,
    )


async def test_create_locks_the_stored_snapshot_and_hashes(client, users, project):
    appraisal = await save_appraisal(client, project)
    case = await create_case(client, users, project)
    assert case["status"] == "draft"
    assert case["stale"] is False
    assert case["created_by"] == "S. Sponsor"
    assert case["created_by_user_id"] == users["developer"].id
    assert case["version"] == 1
    assert case["locked_inputs_snapshot"] == appraisal["inputs_snapshot"]
    assert case["locked_calc_version"] == appraisal["calc_version"]
    assert case["locked_inputs_version"] == appraisal["inputs_version"]
    assert case["locked_input_hash"] == appraisal["input_hash"]
    assert case["locked_outputs_hash"] == appraisal["outputs_hash"]
    assert case["locked_audit_hash"] == appraisal["audit_hash"]
    assert len(case["case_hash"]) == 64


async def test_create_requires_a_project(client, users):
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": "00000000-0000-4000-8000-000000000000",
    }, headers=users["developer"].headers)
    assert resp.status_code == 404


async def test_create_requires_a_saved_appraisal(client, users, project):
    resp = await post_create(client, users, project)
    assert resp.status_code == 404
    assert "appraisal" in resp.json()["detail"].lower()


async def test_create_refuses_a_pre_provenance_appraisal(client, users, project, session_factory):
    """Spec Sec 21.1 / design decision 10: a row with no audit_hash cannot be
    bound by the case-hash chain, so re-saving it is the fix, not locking it."""
    from sqlalchemy import update as sa_update
    from app.persistence.database import FinancialAppraisalORM

    await save_appraisal(client, project)
    async with session_factory() as session:
        await session.execute(
            sa_update(FinancialAppraisalORM).values(audit_hash=None)
        )
        await session.commit()

    resp = await post_create(client, users, project)
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any(d.get("field") == "appraisal" for d in detail), detail


async def test_create_refuses_a_second_live_case(client, users, project):
    await save_appraisal(client, project)
    await create_case(client, users, project)
    resp = await post_create(client, users, project)
    assert resp.status_code == 409


async def test_get_returns_null_when_no_case(client, users, project):
    assert await get_case(client, users, project) is None


async def test_get_unknown_project_404s(client, users):
    resp = await client.get(
        "/api/v1/lender-cases/00000000-0000-4000-8000-000000000000",
        headers=users["broker"].headers,
    )
    assert resp.status_code == 404


async def test_creation_writes_the_creation_event(client, users, project):
    appraisal = await save_appraisal(client, project)
    case = await create_case(client, users, project)
    events = await get_events(client, users, project)
    assert len(events) == 1
    assert events[0]["from_status"] is None
    assert events[0]["to_status"] == "draft"
    assert events[0]["actor"] == "S. Sponsor"
    assert events[0]["actor_user_id"] == users["developer"].id
    assert events[0]["idempotency_key"] is None
    assert events[0]["input_snapshot_hash"] == appraisal["input_hash"]
    assert events[0]["outputs_hash"] == appraisal["outputs_hash"]
    assert events[0]["case_hash_after"] == case["case_hash"]
    assert events[0]["case_version_after"] == 1


async def test_full_legal_walk_records_each_side_effect(client, users, project):
    """draft -> submitted -> under_review -> information_required ->
    under_review -> approved_with_conditions, asserting the Sec 21.2
    side-effect table at every step -- names AND user ids (R17)."""
    await save_appraisal(client, project)
    await create_case(client, users, project)

    r = await transition(client, users, project, "submitted", as_="developer")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["submitted_by"] == "S. Sponsor" and body["submitted_at"] is not None
    assert body["submitted_by_user_id"] == users["developer"].id
    assert body["version"] == 2

    r = await transition(client, users, project, "under_review", as_="underwriter")
    assert r.status_code == 200, r.text
    assert r.json()["reviewer"] == "R. Reviewer"
    assert r.json()["reviewer_user_id"] == users["underwriter"].id

    r = await transition(client, users, project, "information_required", as_="underwriter",
                         note="Send the QS report")
    assert r.status_code == 200

    r = await transition(client, users, project, "under_review", as_="credit_approver")
    # Resubmission overwrites the reviewer of record; the event log keeps both.
    assert r.json()["reviewer"] == "C. Committee"
    assert r.json()["reviewer_user_id"] == users["credit_approver"].id

    # C. Committee is now the reviewer of record; maker-checker only guards
    # creator and submitter, so the reviewer may still decide.
    r = await transition(client, users, project, "approved_with_conditions",
                         as_="credit_approver", conditions="Max LTC 85%")
    body = r.json()
    assert body["status"] == "approved_with_conditions"
    assert body["decided_by"] == "C. Committee" and body["decided_at"] is not None
    assert body["decided_by_user_id"] == users["credit_approver"].id
    assert body["conditions"] == "Max LTC 85%"
    assert body["version"] == 6

    events = await get_events(client, users, project)
    assert [e["to_status"] for e in events] == [
        "approved_with_conditions", "under_review", "information_required",
        "under_review", "submitted", "draft",
    ]
    assert events[1]["actor"] == "C. Committee"
    assert events[2]["note"] == "Send the QS report"


async def case_at(client, users, project, target: str):
    """Drive a fresh case to `target` along the shortest legal path,
    superseding any live case first."""
    live = await get_case(client, users, project)
    if live is not None:
        assert (await transition(client, users, project, "superseded")).status_code == 200
    await create_case(client, users, project)
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
        r = await transition(client, users, project, step, **extra)
        assert r.status_code == 200, r.text


async def test_every_illegal_transition_409s(client, users, project):
    """The whole complement of ALLOWED_TRANSITIONS, driven through the real
    endpoint. Slow but exhaustive -- the state machine is the release. The
    legality check precedes the role check (Sec 21.5), so the 409 is what
    every role sees; the actor here is each target's own permitted role so
    the 409 cannot be mistaken for a 403."""
    from app.financial_model.provenance import ALLOWED_TRANSITIONS

    await save_appraisal(client, project)
    statuses = list(ALLOWED_TRANSITIONS)
    for from_status, allowed in ALLOWED_TRANSITIONS.items():
        for to_status in statuses:
            if to_status in allowed:
                continue
            if from_status == "superseded":
                continue  # no live case to address; covered below
            await case_at(client, users, project, from_status)
            extra = {"conditions": "Cond"} if to_status == "approved_with_conditions" else {}
            r = await transition(client, users, project, to_status, **extra)
            assert r.status_code == 409, (from_status, to_status, r.text)


async def test_transition_with_no_live_case_404s(client, users, project):
    await save_appraisal(client, project)
    r = await transition(client, users, project, "submitted")
    assert r.status_code == 404


async def test_unknown_to_status_is_422(client, users, project):
    await save_appraisal(client, project)
    await create_case(client, users, project)
    r = await transition(client, users, project, "signed_off", as_="developer")
    assert r.status_code == 422


async def test_conditions_required_and_forbidden(client, users, project):
    await save_appraisal(client, project)
    await case_at(client, users, project, "under_review")
    r = await transition(client, users, project, "approved_with_conditions")
    assert r.status_code == 422
    assert any(d.get("field") == "conditions" for d in r.json()["detail"])
    r = await transition(client, users, project, "credit_approved", conditions="Cond")
    assert r.status_code == 422


async def test_case_hash_recomputed_and_independently_derivable(client, users, project):
    """Spec Sec 21.4. Re-derived here by hand -- sha256 over the eight joined
    parts, decided_at re-canonicalised from the response -- the same
    independence discipline as the audit-hash test. R17 (design decision 7):
    the formula gains no parts; the user-id columns are not in it."""
    import hashlib
    from datetime import datetime, timezone

    await save_appraisal(client, project)
    created = await create_case(client, users, project)
    await case_at(client, users, project, "credit_approved")
    body = await get_case(client, users, project)
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


async def test_stale_flips_on_a_changed_resave_only(client, users, project):
    await save_appraisal(client, project)
    await create_case(client, users, project)

    resp = await client.put(f"/api/v1/appraisals/{project['id']}",
                            json={"inputs_snapshot": fixture_a_inputs()})
    assert resp.status_code == 200
    assert (await get_case(client, users, project))["stale"] is False

    changed = fixture_a_inputs()
    changed["acquisition"]["purchase_price_pence"] += 100_000
    resp = await client.put(f"/api/v1/appraisals/{project['id']}",
                            json={"inputs_snapshot": changed})
    assert resp.status_code == 200
    assert (await get_case(client, users, project))["stale"] is True


async def test_superseded_case_keeps_its_record_and_history_lists_both(client, users, project):
    await save_appraisal(client, project)
    await case_at(client, users, project, "credit_approved")
    # Supersede is any authenticated role: the broker, who could do nothing
    # else to this case, may bury it.
    assert (await transition(client, users, project, "superseded", as_="broker")).status_code == 200
    await create_case(client, users, project)

    history = (await client.get(
        f"/api/v1/lender-cases/{project['id']}/history", headers=users["underwriter"].headers,
    )).json()
    assert len(history) == 2
    assert history[0]["status"] == "draft"
    assert history[1]["status"] == "superseded"
    # The dead case kept the decision it carried when it died.
    assert history[1]["decided_by"] is not None
    assert history[1]["decided_by_user_id"] == users["credit_approver"].id


async def test_history_orders_same_second_cases_by_creation_event_not_scan_order(
    client, users, project, session_factory
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
    await create_case(client, users, project)
    assert (await transition(client, users, project, "superseded")).status_code == 200
    await create_case(client, users, project)

    tied_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with session_factory() as session:
        await session.execute(
            sa_update(LenderCaseORM)
            .where(LenderCaseORM.project_id == _UUID(project["id"]))
            .values(created_at=tied_at)
        )
        await session.commit()

    history = (await client.get(
        f"/api/v1/lender-cases/{project['id']}/history", headers=users["developer"].headers,
    )).json()
    assert [h["status"] for h in history] == ["draft", "superseded"]


async def test_project_delete_cascades_cases_and_events(client, users, project, session_factory):
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
    await create_case(client, users, project)

    async with session_factory() as session:
        row = await session.get(ProjectORM, _UUID(project["id"]))
        await session.delete(row)
        await session.commit()

    async with session_factory() as session:
        cases = (await session.execute(sa_select(sa_func.count()).select_from(LenderCaseORM))).scalar_one()
        events = (await session.execute(sa_select(sa_func.count()).select_from(LenderCaseEventORM))).scalar_one()
    assert cases == 0 and events == 0


# --- Final review wave (R14b): field-boundary integrity and the transition CAS


async def test_create_rejects_a_client_supplied_created_by(client, users, project):
    """R17 (design Sec 10.2): the actor is the authenticated user; a sent
    `created_by` is a 422, not silently ignored. This replaces R14b's
    separator/length tests on the field -- the display name is now validated
    where it is set, on the user (spec Sec 10.1)."""
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": project["id"], "created_by": "S. Sponsor",
    }, headers=users["developer"].headers)
    assert resp.status_code == 422


async def test_transition_rejects_a_client_supplied_actor(client, users, project):
    await save_appraisal(client, project)
    await create_case(client, users, project)
    r = await transition(client, users, project, "submitted", actor="S. Sponsor")
    assert r.status_code == 422


async def test_transition_rejects_a_separator_in_idempotency_key(client, users, project):
    await save_appraisal(client, project)
    await create_case(client, users, project)
    r = await transition(client, users, project, "submitted", idempotency_key="a|b")
    assert r.status_code == 422
    r = await transition(client, users, project, "submitted", idempotency_key="")
    assert r.status_code == 422
    r = await transition(client, users, project, "submitted", idempotency_key="k" * 65)
    assert r.status_code == 422


async def test_transition_compare_and_swap_refuses_a_stale_expected_status(
    client, users, project, session_factory
):
    """Item B / spec Sec 21.5: LenderCaseRepository.update's expected_status
    guard is the state machine's compare-and-swap -- a write validated
    against a status the case no longer has must not apply. Exercised at the
    repository level directly, since the endpoint itself always passes the
    status it just read and so cannot observe its own race. R17 adds the
    version to the predicate: a matching status with a stale version must
    fail the same way."""
    from uuid import UUID as _UUID
    from app.persistence.repositories import LenderCaseRepository

    await save_appraisal(client, project)
    created = await create_case(client, users, project)
    assert created["status"] == "draft"
    r = await transition(client, users, project, "submitted", as_="developer")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "submitted" and r.json()["version"] == 2

    async with session_factory() as session:
        repo = LenderCaseRepository(session)
        result = await repo.update(
            _UUID(created["id"]), {"status": "under_review"}, expected_status="draft"
        )
        assert result is None
        result = await repo.update(
            _UUID(created["id"]), {"status": "under_review"},
            expected_status="submitted", expected_version=1,
        )
        assert result is None

    live = await get_case(client, users, project)
    assert live["status"] == "submitted" and live["version"] == 2


# --- R17: authentication, the role matrix, maker-checker, concurrency -------


async def test_unauthenticated_requests_are_401(client, users, project):
    """Every one of the five routes (design Sec 10.5: every write requires a
    token; this build also requires one on the reads)."""
    await save_appraisal(client, project)
    await create_case(client, users, project)
    pid = project["id"]
    r = await client.post("/api/v1/lender-cases", json={"project_id": pid})
    assert r.status_code == 401
    r = await client.post(f"/api/v1/lender-cases/{pid}/transition", json={
        "to_status": "submitted", "expected_version": 1,
        "expected_case_hash": "0" * 64, "idempotency_key": "k",
    })
    assert r.status_code == 401
    for path in ("", "/history", "/events"):
        r = await client.get(f"/api/v1/lender-cases/{pid}{path}")
        assert r.status_code == 401, path
    # A present-but-garbage token is a 401 too, never anonymous.
    r = await client.get(f"/api/v1/lender-cases/{pid}", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


async def test_wrong_role_is_403(client, users, project):
    await save_appraisal(client, project)
    # An underwriter may not open a case.
    r = await post_create(client, users, project, as_="underwriter")
    assert r.status_code == 403
    assert "underwriter" in r.json()["detail"]
    await case_at(client, users, project, "under_review")
    # A broker may not decide one.
    r = await transition(client, users, project, "credit_approved", as_="broker")
    assert r.status_code == 403
    assert r.json()["detail"] == "role 'broker' may not move a lender case to 'credit_approved'"
    # Nor may a developer review one.
    r = await transition(client, users, project, "information_required", as_="developer")
    assert r.status_code == 403
    # The refusal wrote nothing.
    live = await get_case(client, users, project)
    assert live["status"] == "under_review" and live["version"] == 3


async def test_maker_checker_refuses_the_creator_or_submitter_deciding(
    client, users, project, session_factory
):
    """Design decision 6: a user-id rule, not a role rule. The developer who
    created and submitted the case is promoted to credit_approver (the only
    way one user can hold both ends through the role matrix); their decision
    is a 403 whatever their role now says, and a different credit approver's
    is a 200."""
    from uuid import UUID as _UUID

    await save_appraisal(client, project)
    await case_at(client, users, project, "under_review")
    async with session_factory() as session:
        await UserRepository(session).update(_UUID(users["developer"].id), role="credit_approver")
        await session.commit()

    r = await transition(client, users, project, "credit_approved", as_="developer")
    assert r.status_code == 403
    assert r.json()["detail"] == (
        "maker-checker: the user who created or submitted a case may not decide it"
    )
    r = await transition(client, users, project, "credit_approved", as_="credit_approver")
    assert r.status_code == 200, r.text
    assert r.json()["decided_by_user_id"] == users["credit_approver"].id


async def test_maker_checker_refuses_the_submitter_reviewing(
    client, users, project, session_factory
):
    from uuid import UUID as _UUID

    await save_appraisal(client, project)
    await case_at(client, users, project, "submitted")
    async with session_factory() as session:
        await UserRepository(session).update(_UUID(users["developer"].id), role="underwriter")
        await session.commit()

    r = await transition(client, users, project, "under_review", as_="developer")
    assert r.status_code == 403
    assert r.json()["detail"] == "maker-checker: the user who submitted a case may not review it"
    r = await transition(client, users, project, "under_review", as_="underwriter")
    assert r.status_code == 200, r.text


async def test_stale_expected_version_is_409(client, users, project):
    await save_appraisal(client, project)
    await create_case(client, users, project)
    r = await transition(client, users, project, "submitted", expected_version=2)
    assert r.status_code == 409
    assert r.json()["detail"].startswith("stale version")
    assert (await get_case(client, users, project))["version"] == 1


async def test_tampered_expected_case_hash_is_409(client, users, project):
    await save_appraisal(client, project)
    await create_case(client, users, project)
    r = await transition(client, users, project, "submitted", expected_case_hash="0" * 64)
    assert r.status_code == 409
    assert r.json()["detail"].startswith("case hash mismatch")
    assert (await get_case(client, users, project))["status"] == "draft"


async def test_db_edited_locked_snapshot_is_409(client, users, project, session_factory):
    """Design Sec 10.4: the server recomputes input_hash over the locked
    snapshot before any transition; a row whose snapshot was edited under
    it cannot be advanced. The untampered walks elsewhere in this module are
    the other half of the guard -- they prove the recomputation reproduces
    the stored hash when nothing was touched."""
    from uuid import UUID as _UUID
    from sqlalchemy import update as sa_update

    await save_appraisal(client, project)
    created = await create_case(client, users, project)
    tampered = copy.deepcopy(created["locked_inputs_snapshot"])
    tampered["acquisition"]["purchase_price_pence"] += 1
    async with session_factory() as session:
        await session.execute(
            sa_update(LenderCaseORM)
            .where(LenderCaseORM.id == _UUID(created["id"]))
            .values(locked_inputs_snapshot=tampered)
        )
        await session.commit()

    r = await transition(client, users, project, "submitted")
    assert r.status_code == 409
    assert r.json()["detail"].startswith("locked snapshot integrity failure")


async def test_replayed_idempotency_key_is_a_no_op_200(client, users, project):
    """A retry of a request that already succeeded returns the current case
    and writes nothing -- even though its expected_version is now stale and
    its to_status is no longer legal from here, which is why the replay
    check runs before those (Sec 21.5)."""
    await save_appraisal(client, project)
    await create_case(client, users, project)
    key = str(uuid4())
    r = await transition(client, users, project, "submitted", idempotency_key=key)
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["version"] == 2

    replay = await client.post(
        f"/api/v1/lender-cases/{project['id']}/transition",
        json={"to_status": "submitted", "expected_version": 1,
              "expected_case_hash": "0" * 64, "idempotency_key": key},
        headers=users["developer"].headers,
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["version"] == 2
    assert replay.json()["case_hash"] == first["case_hash"]
    events = await get_events(client, users, project)
    assert len(events) == 2  # draft + submitted; the replay wrote nothing
    assert events[0]["idempotency_key"] == key

    # The same key asking for a different status is a 409.
    r = await transition(client, users, project, "under_review", idempotency_key=key)
    assert r.status_code == 409
    assert "idempotency_key" in r.json()["detail"]
    assert (await get_case(client, users, project))["status"] == "submitted"


async def test_legacy_case_without_a_submitter_id_cannot_be_decided(
    client, users, project, session_factory
):
    """Design decision 6: a pre-008 case carries a submitter's name but no
    user id, so maker-checker cannot be evaluated; the decision is refused
    with the spec's exact message and the fix is supersede-and-recreate.
    The row's snapshot is `{}` (unparseable), which is precisely the case
    the integrity check must NOT turn into a different 409 -- Sec 21.5."""
    from uuid import UUID as _UUID

    async with session_factory() as session:
        session.add(_case_row(
            _UUID(project["id"]), "under_review",
            submitted_by="Legacy Submitter", reviewer="Legacy Reviewer",
        ))
        await session.commit()

    r = await transition(client, users, project, "declined", as_="credit_approver")
    assert r.status_code == 409
    assert r.json()["detail"] == (
        "this case was submitted without an authenticated user — supersede it and recreate"
    )
    # ...and supersede is exactly what still works on it.
    r = await transition(client, users, project, "superseded", as_="credit_approver")
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2


async def test_every_event_carries_its_actor_id_and_hashes(client, users, project):
    await save_appraisal(client, project)
    await case_at(client, users, project, "declined")
    live = await get_case(client, users, project)
    events = await get_events(client, users, project)
    assert [e["to_status"] for e in events] == ["declined", "under_review", "submitted", "draft"]
    expected_actor = {
        "draft": "developer", "submitted": "developer",
        "under_review": "underwriter", "declined": "credit_approver",
    }
    for e in events:
        assert e["actor_user_id"] == users[expected_actor[e["to_status"]]].id
        assert e["actor"] == USERS[expected_actor[e["to_status"]]]
        assert e["input_snapshot_hash"] == live["locked_input_hash"]
        assert e["outputs_hash"] == live["locked_outputs_hash"]
        assert len(e["case_hash_after"]) == 64
    assert [e["case_version_after"] for e in events] == [4, 3, 2, 1]
    assert events[0]["case_hash_after"] == live["case_hash"]
    assert events[-1]["idempotency_key"] is None
    assert all(e["idempotency_key"] for e in events[:-1])
