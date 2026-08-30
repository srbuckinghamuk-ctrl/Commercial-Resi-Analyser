"""Shell administration of users (spec Sec 10.1).

    python -m app.auth.cli create-user --email a@b.c --display-name "A B" \\
        --role administrator --password '...'
    python -m app.auth.cli list-users

Runs against the app's own session factory (DATABASE_URL). The same
validation as POST /users applies; a duplicate email exits 1.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from pydantic import ValidationError

from app.auth.passwords import hash_password
from app.auth.roles import ROLES
from app.auth.schemas import UserCreate


async def _create_user(args: argparse.Namespace) -> int:
    from app.persistence.database import AsyncSessionLocal
    from app.persistence.repositories import UserRepository

    try:
        body = UserCreate(
            email=args.email, display_name=args.display_name, role=args.role,
            password=args.password,
        )
    except ValidationError as exc:
        print(f"invalid: {exc}", file=sys.stderr)
        return 2
    async with AsyncSessionLocal() as session:
        repo = UserRepository(session)
        if await repo.get_by_email(body.email):
            print(f"a user with email {body.email} already exists", file=sys.stderr)
            return 1
        password_hash, password_salt = hash_password(body.password)
        row = await repo.create(
            email=body.email, display_name=body.display_name, role=body.role,
            password_hash=password_hash, password_salt=password_salt,
        )
        await session.commit()
        print(f"created {row.role} {row.email} ({row.id})")
    return 0


async def _list_users(_: argparse.Namespace) -> int:
    from app.persistence.database import AsyncSessionLocal
    from app.persistence.repositories import UserRepository

    async with AsyncSessionLocal() as session:
        rows = await UserRepository(session).list()
    if not rows:
        print("no users")
        return 0
    for row in rows:
        state = "active" if row.is_active else "inactive"
        print(f"{row.id}  {row.role:<16} {state:<8} {row.email}  {row.display_name}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.auth.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-user", help="create a user")
    create.add_argument("--email", required=True)
    create.add_argument("--display-name", required=True)
    create.add_argument("--role", required=True, choices=ROLES)
    create.add_argument("--password", required=True)
    create.set_defaults(func=_create_user)
    listing = sub.add_parser("list-users", help="list every user")
    listing.set_defaults(func=_list_users)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return asyncio.run(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
