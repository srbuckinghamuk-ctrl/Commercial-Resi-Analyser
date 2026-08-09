import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

POSTCODES_IO_BASE = "https://api.postcodes.io"


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


async def lookup_postcode(postcode: str) -> PostcodeLookupResult | None:
    normalised = postcode.replace(" ", "").upper()
    url = f"{POSTCODES_IO_BASE}/postcodes/{normalised}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            return None
        data = resp.json().get("result")
        if not data:
            return None
        return PostcodeLookupResult(
            postcode=data["postcode"],
            latitude=data["latitude"],
            longitude=data["longitude"],
            lpa_name=data.get("admin_district", ""),
            lpa_code=data.get("codes", {}).get("admin_district", ""),
            region=data.get("region", ""),
            country=data.get("country", ""),
            admin_district=data.get("admin_district", ""),
        )
    except Exception:
        logger.exception("Postcodes.io lookup failed for %s", postcode)
        return None
