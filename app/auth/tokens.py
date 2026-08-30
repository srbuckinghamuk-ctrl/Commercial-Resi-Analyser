"""Stateless bearer tokens (spec Sec 10.1; Sec 27.9 limitation 5).

`base64url(payload).base64url(signature)` where
payload = "<user_id>|<issued_unix>|<expires_unix>" and
signature = HMAC-SHA256(API_SECRET_KEY, payload). Nothing is stored: logout
is a client-side discard, a token is valid until it expires, and rotating
the secret invalidates every token at once. Stdlib only.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import datetime, timezone


class TokenError(ValueError):
    """Bad format, bad signature or expired. The reason is deliberately not
    distinguished to callers beyond the message: every case is a 401."""


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64url(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _sign(payload: str, secret: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()


def _unix(now: datetime | None) -> int:
    moment = now if now is not None else datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp())


def issue_token(
    user_id: str, *, secret: str, ttl_seconds: int, now: datetime | None = None
) -> str:
    if not secret:
        raise ValueError("a signing secret is required")
    if ttl_seconds <= 0:
        raise ValueError("ttl_seconds must be positive")
    if "|" in user_id:
        raise ValueError("user_id may not contain '|'")
    issued = _unix(now)
    payload = f"{user_id}|{issued}|{issued + ttl_seconds}"
    return f"{_b64url(payload.encode('utf-8'))}.{_b64url(_sign(payload, secret))}"


def parse_token(token: str, *, secret: str, now: datetime | None = None) -> str:
    """Return the user_id of a well-formed, correctly signed, unexpired token."""
    if not isinstance(token, str) or token.count(".") != 1:
        raise TokenError("malformed token")
    payload_part, sig_part = token.split(".", 1)
    try:
        payload = _unb64url(payload_part).decode("utf-8")
        signature = _unb64url(sig_part)
    except (ValueError, UnicodeDecodeError) as exc:
        raise TokenError("malformed token") from exc
    if not hmac.compare_digest(signature, _sign(payload, secret)):
        raise TokenError("bad signature")
    parts = payload.split("|")
    if len(parts) != 3:
        raise TokenError("malformed token")
    user_id, issued_text, expires_text = parts
    try:
        issued = int(issued_text)
        expires = int(expires_text)
    except ValueError as exc:
        raise TokenError("malformed token") from exc
    current = _unix(now)
    # A minute of tolerance on `issued` for clock skew between hosts; none on
    # `expires`.
    if not user_id or issued > current + 60 or expires <= current:
        raise TokenError("token expired")
    return user_id
