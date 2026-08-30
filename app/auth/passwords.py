"""Password hashing: PBKDF2-HMAC-SHA256, stdlib only (no new dependency).

390,000 iterations is the 2023+ OWASP figure for PBKDF2-SHA256; a 16-byte
salt from `secrets` per user. Both halves are stored hex-encoded (64 chars
of hash, 32 of salt) in users.password_hash / users.password_salt.
Verification is constant-time via hmac.compare_digest.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

PBKDF2_ITERATIONS = 390_000
SALT_BYTES = 16
_HASH_NAME = "sha256"


def hash_password(password: str) -> tuple[str, str]:
    """Return `(hash_hex, salt_hex)` for a fresh random salt."""
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(_HASH_NAME, password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return digest.hex(), salt.hex()


def verify_password(password: str, hash_hex: str, salt_hex: str) -> bool:
    """Constant-time comparison of the candidate against the stored pair.
    A malformed stored salt is a False, not an exception: a corrupt row must
    read as 'wrong password', never as a 500 that reveals which it was."""
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac(_HASH_NAME, password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return hmac.compare_digest(digest.hex(), hash_hex)
