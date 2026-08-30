"""/auth and /users (spec Sec 10.1).

Login is the only route that touches a password hash; every failure there
-- unknown email, wrong password, inactive account -- is the same 401
"invalid credentials", so the response cannot be used to enumerate
accounts. Logout is a 204 that does nothing server-side: tokens are
stateless (Sec 27.9 limitation 5) and the client discards its copy.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AdminUser, CurrentUser
from app.auth.passwords import hash_password, verify_password
from app.auth.roles import ADMINISTRATOR
from app.auth.schemas import LoginRequest, LoginResponse, UserCreate, UserOut, UserUpdate
from app.auth.tokens import issue_token
from app.persistence.database import get_db
from app.persistence.repositories import UserRepository
from config.settings import get_settings

INVALID_CREDENTIALS = "invalid credentials"
DUPLICATE_EMAIL = "a user with that email already exists"
LAST_ADMIN = "cannot demote or deactivate the last active administrator"

DbDep = Annotated[AsyncSession, Depends(get_db)]

auth_router = APIRouter(prefix="/auth")
users_router = APIRouter(prefix="/users")


@auth_router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: DbDep):
    settings = get_settings()
    row = await UserRepository(db).get_by_email(body.email)
    if row is None or not row.is_active:
        raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS)
    if not verify_password(body.password, row.password_hash, row.password_salt):
        raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS)
    token = issue_token(
        str(row.id), secret=settings.api_secret_key, ttl_seconds=settings.auth_token_ttl_seconds
    )
    return LoginResponse(token=token, user=UserOut.model_validate(row))


@auth_router.get("/me", response_model=UserOut)
async def me(user: CurrentUser, db: DbDep):
    row = await UserRepository(db).get_by_id(user.id)
    return UserOut.model_validate(row)


@auth_router.post("/logout", status_code=204)
async def logout(user: CurrentUser):
    """Stateless: nothing to revoke. The client drops the token; it remains
    valid until expiry (Sec 27.9 limitation 5)."""
    return Response(status_code=204)


@users_router.get("", response_model=list[UserOut])
async def list_users(admin: AdminUser, db: DbDep):
    rows = await UserRepository(db).list()
    return [UserOut.model_validate(row) for row in rows]


@users_router.post("", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, admin: AdminUser, db: DbDep):
    repo = UserRepository(db)
    if await repo.get_by_email(body.email):
        raise HTTPException(status_code=409, detail=DUPLICATE_EMAIL)
    password_hash, password_salt = hash_password(body.password)
    try:
        row = await repo.create(
            email=body.email, display_name=body.display_name, role=body.role,
            password_hash=password_hash, password_salt=password_salt,
        )
        await db.commit()
    except IntegrityError:
        # The pre-check and the insert are not atomic; uq_users_email is
        # what actually refuses a concurrent duplicate.
        await db.rollback()
        raise HTTPException(status_code=409, detail=DUPLICATE_EMAIL) from None
    return UserOut.model_validate(row)


@users_router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: UUID, body: UserUpdate, admin: AdminUser, db: DbDep):
    repo = UserRepository(db)
    row = await repo.get_by_id(user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    fields = body.model_dump(exclude_unset=True)
    password = fields.pop("password", None)
    if password is not None:
        fields["password_hash"], fields["password_salt"] = hash_password(password)

    # The last active administrator may not be demoted or deactivated --
    # by anyone, themselves included -- or no one could administer users.
    was_active_admin = row.role == ADMINISTRATOR and row.is_active
    loses_admin = (
        fields.get("role", row.role) != ADMINISTRATOR
        or fields.get("is_active", row.is_active) is False
    )
    if was_active_admin and loses_admin and await repo.count_active_admins() <= 1:
        raise HTTPException(status_code=409, detail=LAST_ADMIN)

    row = await repo.update(user_id, **fields)
    await db.commit()
    return UserOut.model_validate(row)
