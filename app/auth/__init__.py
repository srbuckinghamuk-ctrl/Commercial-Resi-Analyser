"""Authentication and users (R17, spec Sec 10.1).

Stateless HMAC bearer tokens over PBKDF2-hashed passwords, stdlib only. The
package is deliberately self-contained: `deps.py` is what routers import
(`CurrentUser`, `OptionalUser`, `require_roles`), `router.py` mounts
/auth/* and /users, `bootstrap.py` runs at startup, `cli.py` from a shell.
"""
