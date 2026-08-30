"""FastAPI dependencies: who is calling, and may they (spec Sec 10.1, 10.3).

`CurrentUser` -- 401 "authentication required" unless a valid, unexpired
bearer token names an active user. `OptionalUser` -- None when no
Authorization header is sent, the same 401 when one is sent and is bad (a
present-but-invalid token is never silently downgraded to anonymous).
`require_roles(...)` -- 403 naming the caller's role.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.tokens import TokenError, parse_token
from app.persistence.database import get_db
from app.persistence.repositories import UserRepository
from config.settings import get_settings

AUTH_REQUIRED = "authentication required"


@dataclass(frozen=True)
class AuthenticatedUser:
    id: UUID
    email: str
    display_name: str
    role: str


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401, detail=AUTH_REQUIRED, headers={"WWW-Authenticate": "Bearer"}
    )


def _bearer_token(authorization: str | None) -> str | None:
    """The token from `Authorization: Bearer <token>`, or None when the header
    is absent. A header of the wrong shape is a 401, not a None."""
    if authorization is None:
        return None
    scheme, _, token = authorization.strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized()
    return token.strip()


async def _load_user(db: AsyncSession, token: str) -> AuthenticatedUser:
    settings = get_settings()
    try:
        user_id_text = parse_token(token, secret=settings.api_secret_key)
        user_id = UUID(user_id_text)
    except (TokenError, ValueError):
        raise _unauthorized() from None
    row = await UserRepository(db).get_by_id(user_id)
    if row is None or not row.is_active:
        raise _unauthorized()
    return AuthenticatedUser(
        id=row.id, email=row.email, display_name=row.display_name, role=row.role
    )


async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser:
    token = _bearer_token(authorization)
    if token is None:
        raise _unauthorized()
    return await _load_user(db, token)


async def get_optional_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser | None:
    token = _bearer_token(authorization)
    if token is None:
        return None
    return await _load_user(db, token)


CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]
OptionalUser = Annotated[AuthenticatedUser | None, Depends(get_optional_user)]


def require_roles(*roles: str):
    """Dependency factory: the authenticated user, provided their role is one
    of `roles`; otherwise 403. Usage:
    `user: Annotated[AuthenticatedUser, Depends(require_roles("administrator"))]`."""
    allowed = frozenset(roles)

    async def _dependency(user: CurrentUser) -> AuthenticatedUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=403, detail=f"role '{user.role}' may not perform this action"
            )
        return user

    return _dependency


AdminUser = Annotated[AuthenticatedUser, Depends(require_roles("administrator"))]
