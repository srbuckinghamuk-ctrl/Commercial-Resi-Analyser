"""Shared httpx AsyncClient for all outbound HTTP.

A single module-level client reuses connection pools across the postcode,
EPC, flood and scrape-adapter calls instead of paying TLS/TCP setup on
every request. Per-request timeouts are passed at call sites.

The client is created lazily and closed via `close_client()`, which is
wired into the FastAPI lifespan shutdown in app.api.app.
"""
from __future__ import annotations

import httpx

USER_AGENT = "Mozilla/5.0 (compatible; CommercialResiBot/1.0)"

_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    """Return the shared AsyncClient, creating it if needed."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )
    return _client


async def close_client() -> None:
    """Close the shared client (FastAPI lifespan shutdown hook)."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
