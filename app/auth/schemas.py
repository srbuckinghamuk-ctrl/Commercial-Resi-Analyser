"""Request/response models for /auth and /users (spec Sec 10.1).

Kept out of app/models.py on purpose: that file is edited by the
lender-case task in the same release, and nothing here is shared with it.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.auth.roles import ROLES

PASSWORD_MIN_LENGTH = 8


def validate_display_name(value: str) -> str:
    """The Sec 13.2.1 field-boundary rule, replicated from app/models.py's
    `_no_separator` rather than imported: display names are written into
    lender_cases.created_by / submitted_by / reviewer / decided_by and so
    become case_hash components, where '|' is the field separator and a
    control character would make the canonical text ambiguous. Replicated
    because the models.py validator is a method on request models that this
    release is rewriting concurrently, not a free function."""
    if "|" in value or any(ord(c) < 32 for c in value):
        raise ValueError(
            "display names may not contain '|' or control characters — the name is a "
            "component of the case hash (spec Sec 13.2.1)"
        )
    return value


def normalise_email(value: str) -> str:
    email = value.strip().lower()
    if "@" not in email[1:-1]:
        raise ValueError("email must contain '@' with text on both sides")
    return email


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=1024)

    @field_validator("email")
    @classmethod
    def _normalise(cls, v: str) -> str:
        return normalise_email(v)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    role: str
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class LoginResponse(BaseModel):
    token: str
    user: UserOut


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=1, max_length=256)
    role: str
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=1024)

    @field_validator("email")
    @classmethod
    def _normalise(cls, v: str) -> str:
        return normalise_email(v)

    @field_validator("display_name")
    @classmethod
    def _no_separator(cls, v: str) -> str:
        return validate_display_name(v)

    @field_validator("role")
    @classmethod
    def _known_role(cls, v: str) -> str:
        if v not in ROLES:
            raise ValueError(f"role must be one of {', '.join(ROLES)}")
        return v


class UserUpdate(BaseModel):
    """Administrator patch. Every field optional; at least one required."""

    display_name: str | None = Field(default=None, min_length=1, max_length=256)
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=PASSWORD_MIN_LENGTH, max_length=1024)

    @field_validator("display_name")
    @classmethod
    def _no_separator(cls, v: str | None) -> str | None:
        return None if v is None else validate_display_name(v)

    @field_validator("role")
    @classmethod
    def _known_role(cls, v: str | None) -> str | None:
        if v is not None and v not in ROLES:
            raise ValueError(f"role must be one of {', '.join(ROLES)}")
        return v

    @model_validator(mode="after")
    def _at_least_one(self) -> "UserUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one of display_name, role, is_active, password is required")
        return self
