"""R17 authentication (spec Sec 10.1): passwords, tokens, /auth and /users,
bootstrap and the production secret check -- against in-memory sqlite, the
test_lender_case_governance.py client pattern."""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.app import app
from app.auth.bootstrap import bootstrap_admin, ensure_secret_is_safe
from app.auth.passwords import hash_password, verify_password
from app.auth.tokens import TokenError, issue_token, parse_token
from app.persistence.database import Base, get_db
from app.persistence.repositories import UserRepository
from config.settings import get_settings

SECRET = get_settings().api_secret_key
PASSWORD = "correct horse battery"


@lru_cache(maxsize=None)
def _hashed(password: str) -> tuple[str, str]:
    """PBKDF2 at 390k iterations is deliberately slow; one hash per distinct
    password for the whole module keeps the suite quick."""
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


async def seed_user(
    session_factory, *, email: str, role: str, display_name: str | None = None,
    password: str = PASSWORD, is_active: bool = True,
):
    password_hash, password_salt = _hashed(password)
    async with session_factory() as session:
        row = await UserRepository(session).create(
            email=email, display_name=display_name or email.split("@")[0].title(),
            role=role, password_hash=password_hash, password_salt=password_salt,
            is_active=is_active,
        )
        await session.commit()
        return row


async def login(client, email: str, password: str = PASSWORD) -> str:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- unit: passwords ---------------------------------------------------------

def test_password_round_trip_and_wrong_password():
    hash_hex, salt_hex = hash_password("s3cret-phrase")
    assert len(hash_hex) == 64 and len(salt_hex) == 32
    assert verify_password("s3cret-phrase", hash_hex, salt_hex)
    assert not verify_password("s3cret-phrasE", hash_hex, salt_hex)
    assert not verify_password("s3cret-phrase", hash_hex, "not-hex")


def test_password_salts_differ_per_call():
    a = hash_password("same")
    b = hash_password("same")
    assert a[1] != b[1] and a[0] != b[0]


# --- unit: tokens ------------------------------------------------------------

CLOCK = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)


def test_token_issue_and_parse_with_fixed_clock():
    uid = str(uuid4())
    token = issue_token(uid, secret="k", ttl_seconds=60, now=CLOCK)
    assert token.count(".") == 1 and "=" not in token
    assert parse_token(token, secret="k", now=CLOCK) == uid
    assert parse_token(token, secret="k", now=CLOCK + timedelta(seconds=59)) == uid


def test_token_expires_at_the_boundary():
    token = issue_token("u", secret="k", ttl_seconds=60, now=CLOCK)
    with pytest.raises(TokenError, match="expired"):
        parse_token(token, secret="k", now=CLOCK + timedelta(seconds=60))


def test_token_rejects_wrong_secret_tampering_and_malformed():
    token = issue_token("u", secret="k", ttl_seconds=60, now=CLOCK)
    with pytest.raises(TokenError, match="signature"):
        parse_token(token, secret="other", now=CLOCK)
    payload, sig = token.split(".")
    tampered_sig = payload + "." + ("A" if sig[0] != "A" else "B") + sig[1:]
    with pytest.raises(TokenError, match="signature"):
        parse_token(tampered_sig, secret="k", now=CLOCK)
    # A re-encoded payload naming another user, with the original signature.
    forged = issue_token("v", secret="k", ttl_seconds=60, now=CLOCK).split(".")[0] + "." + sig
    with pytest.raises(TokenError, match="signature"):
        parse_token(forged, secret="k", now=CLOCK)
    for bad in ("", "abc", "a.b.c", "!!!.???"):
        with pytest.raises(TokenError):
            parse_token(bad, secret="k", now=CLOCK)


def test_token_refuses_separator_in_user_id():
    with pytest.raises(ValueError):
        issue_token("a|b", secret="k", ttl_seconds=60)


# --- unit: startup ------------------------------------------------------------

def test_ensure_secret_is_safe_refuses_the_placeholder_in_production():
    with pytest.raises(RuntimeError, match="API_SECRET_KEY"):
        ensure_secret_is_safe(
            SimpleNamespace(environment="production", api_secret_key="change-me-in-production")
        )
    ensure_secret_is_safe(
        SimpleNamespace(environment="development", api_secret_key="change-me-in-production")
    )
    ensure_secret_is_safe(SimpleNamespace(environment="production", api_secret_key="x" * 32))


async def test_bootstrap_admin_creates_one_admin_only_when_empty(session_factory):
    settings = SimpleNamespace(
        admin_bootstrap_email="Root@Example.com", admin_bootstrap_password="bootstrap-pw"
    )
    created = await bootstrap_admin(session_factory, settings)
    assert created is not None
    assert created.email == "root@example.com" and created.role == "administrator"
    assert await bootstrap_admin(session_factory, settings) is None
    async with session_factory() as session:
        repo = UserRepository(session)
        assert await repo.count() == 1
        assert await repo.count_active_admins() == 1
        row = await repo.get_by_email("root@example.com")
        assert verify_password("bootstrap-pw", row.password_hash, row.password_salt)


async def test_bootstrap_admin_does_nothing_without_both_settings(session_factory):
    assert await bootstrap_admin(
        session_factory, SimpleNamespace(admin_bootstrap_email="a@b.c", admin_bootstrap_password="")
    ) is None
    async with session_factory() as session:
        assert await UserRepository(session).count() == 0


# --- /auth ---------------------------------------------------------------------

async def test_login_returns_a_token_that_me_accepts(client, session_factory):
    user = await seed_user(session_factory, email="dev@example.com", role="developer")
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "DEV@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"] == {
        "id": str(user.id), "email": "dev@example.com", "display_name": "Dev",
        "role": "developer", "is_active": True,
        "created_at": body["user"]["created_at"], "updated_at": body["user"]["updated_at"],
    }
    me = await client.get("/api/v1/auth/me", headers=bearer(body["token"]))
    assert me.status_code == 200
    assert me.json()["id"] == str(user.id)
    assert "password_hash" not in me.json()


async def test_login_failures_share_one_message(client, session_factory):
    await seed_user(session_factory, email="dev@example.com", role="developer")
    await seed_user(session_factory, email="gone@example.com", role="broker", is_active=False)
    wrong = await client.post(
        "/api/v1/auth/login", json={"email": "dev@example.com", "password": "nope"}
    )
    unknown = await client.post(
        "/api/v1/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}
    )
    inactive = await client.post(
        "/api/v1/auth/login", json={"email": "gone@example.com", "password": PASSWORD}
    )
    for resp in (wrong, unknown, inactive):
        assert resp.status_code == 401
        assert resp.json()["detail"] == "invalid credentials"


async def test_me_refuses_missing_malformed_tampered_and_expired(client, session_factory):
    user = await seed_user(session_factory, email="dev@example.com", role="developer")
    good = await login(client, "dev@example.com")
    payload, sig = good.split(".")
    tampered = payload + "." + ("A" if sig[0] != "A" else "B") + sig[1:]
    expired = issue_token(
        str(user.id), secret=SECRET, ttl_seconds=1,
        now=datetime.now(timezone.utc) - timedelta(seconds=30),
    )
    cases = {
        "missing": {},
        "not bearer": {"Authorization": f"Basic {good}"},
        "empty bearer": {"Authorization": "Bearer "},
        "garbage": bearer("not.a.token"),
        "tampered": bearer(tampered),
        "expired": bearer(expired),
    }
    for name, headers in cases.items():
        resp = await client.get("/api/v1/auth/me", headers=headers)
        assert resp.status_code == 401, name
        assert resp.json()["detail"] == "authentication required", name
    assert (await client.get("/api/v1/auth/me", headers=bearer(good))).status_code == 200


async def test_deactivated_user_token_stops_working(client, session_factory):
    user = await seed_user(session_factory, email="dev@example.com", role="developer")
    token = await login(client, "dev@example.com")
    async with session_factory() as session:
        await UserRepository(session).update(user.id, is_active=False)
        await session.commit()
    resp = await client.get("/api/v1/auth/me", headers=bearer(token))
    assert resp.status_code == 401


async def test_logout_is_a_stateless_204(client, session_factory):
    await seed_user(session_factory, email="dev@example.com", role="developer")
    token = await login(client, "dev@example.com")
    assert (await client.post("/api/v1/auth/logout", headers=bearer(token))).status_code == 204
    assert (await client.post("/api/v1/auth/logout")).status_code == 401
    # Sec 27.9 limitation 5: the token is valid until it expires.
    assert (await client.get("/api/v1/auth/me", headers=bearer(token))).status_code == 200


# --- /users ------------------------------------------------------------------

async def test_non_admin_may_not_list_or_create_users(client, session_factory):
    await seed_user(session_factory, email="uw@example.com", role="underwriter")
    token = await login(client, "uw@example.com")
    listing = await client.get("/api/v1/users", headers=bearer(token))
    assert listing.status_code == 403
    assert listing.json()["detail"] == "role 'underwriter' may not perform this action"
    create = await client.post("/api/v1/users", headers=bearer(token), json={
        "email": "x@example.com", "display_name": "X", "role": "broker", "password": PASSWORD,
    })
    assert create.status_code == 403
    assert (await client.get("/api/v1/users")).status_code == 401


async def test_admin_creates_lists_and_duplicate_email_is_409(client, session_factory):
    await seed_user(session_factory, email="admin@example.com", role="administrator")
    token = await login(client, "admin@example.com")
    body = {
        "email": "Broker@Example.com", "display_name": "B. Roker", "role": "broker",
        "password": "broker-pass-1",
    }
    created = await client.post("/api/v1/users", headers=bearer(token), json=body)
    assert created.status_code == 201, created.text
    assert created.json()["email"] == "broker@example.com"
    assert created.json()["role"] == "broker"
    assert "password" not in created.json() and "password_hash" not in created.json()

    dup = await client.post("/api/v1/users", headers=bearer(token), json=body)
    assert dup.status_code == 409
    assert dup.json()["detail"] == "a user with that email already exists"

    listing = await client.get("/api/v1/users", headers=bearer(token))
    assert listing.status_code == 200
    assert [u["email"] for u in listing.json()] == ["admin@example.com", "broker@example.com"]

    # The new user can log in with the password the admin set.
    assert await login(client, "broker@example.com", "broker-pass-1")


async def test_create_user_validation(client, session_factory):
    await seed_user(session_factory, email="admin@example.com", role="administrator")
    token = await login(client, "admin@example.com")
    base = {"email": "n@example.com", "role": "broker", "password": PASSWORD}
    for bad_name in ("A|B", "A\tB", "x" * 257):
        resp = await client.post(
            "/api/v1/users", headers=bearer(token), json={**base, "display_name": bad_name}
        )
        assert resp.status_code == 422, bad_name
    bad_role = await client.post(
        "/api/v1/users", headers=bearer(token), json={**base, "display_name": "N", "role": "god"}
    )
    assert bad_role.status_code == 422
    short_pw = await client.post(
        "/api/v1/users", headers=bearer(token),
        json={**base, "display_name": "N", "password": "short"},
    )
    assert short_pw.status_code == 422
    no_at = await client.post(
        "/api/v1/users", headers=bearer(token),
        json={**base, "display_name": "N", "email": "not-an-email"},
    )
    assert no_at.status_code == 422


async def test_patch_user_and_last_admin_rule(client, session_factory):
    admin = await seed_user(session_factory, email="admin@example.com", role="administrator")
    dev = await seed_user(session_factory, email="dev@example.com", role="developer")
    token = await login(client, "admin@example.com")

    demote = await client.patch(
        f"/api/v1/users/{admin.id}", headers=bearer(token), json={"role": "broker"}
    )
    assert demote.status_code == 409
    assert demote.json()["detail"] == (
        "cannot demote or deactivate the last active administrator"
    )
    deactivate = await client.patch(
        f"/api/v1/users/{admin.id}", headers=bearer(token), json={"is_active": False}
    )
    assert deactivate.status_code == 409

    # Promote the developer; now the original admin may be demoted.
    promote = await client.patch(
        f"/api/v1/users/{dev.id}", headers=bearer(token),
        json={"role": "administrator", "display_name": "Dev Admin", "password": "new-pass-123"},
    )
    assert promote.status_code == 200, promote.text
    assert promote.json()["role"] == "administrator"
    assert promote.json()["display_name"] == "Dev Admin"
    assert await login(client, "dev@example.com", "new-pass-123")

    demote = await client.patch(
        f"/api/v1/users/{admin.id}", headers=bearer(token), json={"role": "broker"}
    )
    assert demote.status_code == 200
    # ...and the demoted user's existing token no longer administers.
    assert (await client.get("/api/v1/users", headers=bearer(token))).status_code == 403

    new_admin_token = await login(client, "dev@example.com", "new-pass-123")
    empty = await client.patch(
        f"/api/v1/users/{dev.id}", headers=bearer(new_admin_token), json={}
    )
    assert empty.status_code == 422
    missing = await client.patch(
        f"/api/v1/users/{uuid4()}", headers=bearer(new_admin_token), json={"role": "broker"}
    )
    assert missing.status_code == 404


async def test_patch_display_name_is_bounded_like_case_hash_components(client, session_factory):
    admin = await seed_user(session_factory, email="admin@example.com", role="administrator")
    token = await login(client, "admin@example.com")
    resp = await client.patch(
        f"/api/v1/users/{admin.id}", headers=bearer(token), json={"display_name": "A|B"}
    )
    assert resp.status_code == 422


# --- routes are mounted ----------------------------------------------------

def test_auth_and_user_routes_exist():
    paths = app.openapi()["paths"]
    assert "post" in paths["/api/v1/auth/login"]
    assert "get" in paths["/api/v1/auth/me"]
    assert "post" in paths["/api/v1/auth/logout"]
    assert {"get", "post"} <= set(paths["/api/v1/users"])
    assert "patch" in paths["/api/v1/users/{user_id}"]
