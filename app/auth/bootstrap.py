"""Startup checks (spec Sec 10.1): the first administrator, and a refusal to
run production on the placeholder secret.
"""
from __future__ import annotations

import logging

from app.auth.passwords import hash_password
from app.auth.roles import ADMINISTRATOR
from app.auth.schemas import normalise_email
from app.persistence.repositories import UserRepository

logger = logging.getLogger(__name__)

PLACEHOLDER_SECRET = "change-me-in-production"
BOOTSTRAP_DISPLAY_NAME = "Administrator"


def ensure_secret_is_safe(settings) -> None:
    """Every token is signed with API_SECRET_KEY; a known default in
    production would let anyone mint one. Refuse to start."""
    if settings.environment == "production" and settings.api_secret_key == PLACEHOLDER_SECRET:
        raise RuntimeError(
            "API_SECRET_KEY is still 'change-me-in-production' while ENVIRONMENT=production; "
            "set a secret before starting"
        )


async def bootstrap_admin(session_factory, settings):
    """Create the first administrator from ADMIN_BOOTSTRAP_EMAIL /
    ADMIN_BOOTSTRAP_PASSWORD when -- and only when -- the users table is
    empty. Returns the created row, or None when nothing was done."""
    email = (settings.admin_bootstrap_email or "").strip()
    password = settings.admin_bootstrap_password or ""
    async with session_factory() as session:
        repo = UserRepository(session)
        existing = await repo.count()
        if existing:
            logger.info(
                "auth bootstrap: users table has %d row(s); no administrator created", existing
            )
            return None
        if not (email and password):
            logger.warning(
                "auth bootstrap: users table is empty and ADMIN_BOOTSTRAP_EMAIL/"
                "ADMIN_BOOTSTRAP_PASSWORD are not both set; every governed write will be "
                "refused until a user exists (python -m app.auth.cli create-user)"
            )
            return None
        password_hash, password_salt = hash_password(password)
        row = await repo.create(
            email=normalise_email(email),
            display_name=BOOTSTRAP_DISPLAY_NAME,
            role=ADMINISTRATOR,
            password_hash=password_hash,
            password_salt=password_salt,
        )
        await session.commit()
        logger.info("auth bootstrap: created administrator %s (%s)", row.email, row.id)
        return row
