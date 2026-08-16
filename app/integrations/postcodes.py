import logging
import time
from dataclasses import dataclass

from app.integrations.http import get_client

logger = logging.getLogger(__name__)

POSTCODES_IO_BASE = "https://api.postcodes.io"

# Postcode → LPA/coords is effectively immutable, so successful lookups are
# cached in-memory with a generous TTL.
_CACHE_TTL_SECONDS = 24 * 60 * 60  # 24h
_CACHE_MAX_ENTRIES = 1000
_cache: dict[str, tuple[float, "PostcodeLookupResult"]] = {}


@dataclass(frozen=True)
class PostcodeLookupResult:
    postcode: str
    latitude: float
    longitude: float
    lpa_name: str
    lpa_code: str
    region: str
    country: str
    admin_district: str


def _cache_get(key: str) -> PostcodeLookupResult | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    ts, result = entry
    if time.monotonic() - ts > _CACHE_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    return result


def _cache_put(key: str, result: PostcodeLookupResult) -> None:
    if len(_cache) >= _CACHE_MAX_ENTRIES:
        # Evict the oldest entries (by insertion timestamp).
        oldest = sorted(_cache.items(), key=lambda kv: kv[1][0])
        for k, _ in oldest[: max(1, _CACHE_MAX_ENTRIES // 10)]:
            _cache.pop(k, None)
    _cache[key] = (time.monotonic(), result)


async def lookup_postcode(postcode: str) -> PostcodeLookupResult | None:
    normalised = postcode.replace(" ", "").upper()

    cached = _cache_get(normalised)
    if cached is not None:
        return cached

    url = f"{POSTCODES_IO_BASE}/postcodes/{normalised}"
    try:
        resp = await get_client().get(url, timeout=10.0)
        if resp.status_code != 200:
            logger.warning(
                "Postcodes.io lookup for %s returned HTTP %s", postcode, resp.status_code
            )
            return None
        data = resp.json().get("result")
        if not data:
            return None
        result = PostcodeLookupResult(
            postcode=data["postcode"],
            latitude=data["latitude"],
            longitude=data["longitude"],
            lpa_name=data.get("admin_district", ""),
            lpa_code=data.get("codes", {}).get("admin_district", ""),
            region=data.get("region", ""),
            country=data.get("country", ""),
            admin_district=data.get("admin_district", ""),
        )
        _cache_put(normalised, result)
        return result
    except Exception:
        logger.exception("Postcodes.io lookup failed for %s", postcode)
        return None
