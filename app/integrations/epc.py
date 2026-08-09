import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

EPC_API_BASE = "https://epc.opendatacommunities.org/api/v1"


@dataclass(frozen=True)
class EpcResult:
    address: str
    postcode: str
    rating: str
    score: int
    certificate_date: str
    certificate_url: str
    property_type: str
    floor_area_sqm: float | None


async def lookup_epc(
    postcode: str,
    address_fragment: str | None = None,
    api_key: str = "",
) -> EpcResult | None:
    if not api_key:
        logger.warning("EPC lookup skipped — no API key configured")
        return None
    url = f"{EPC_API_BASE}/domestic/search"
    params = {"postcode": postcode, "size": "5"}
    headers = {
        "Accept": "application/json",
        "Authorization": f"Basic {api_key}",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params, headers=headers)
        if resp.status_code != 200:
            return None
        rows = resp.json().get("rows", [])
        if not rows:
            return None
        if address_fragment:
            fragment_lower = address_fragment.lower()
            matched = [r for r in rows if fragment_lower in r.get("address", "").lower()]
            row = matched[0] if matched else rows[0]
        else:
            row = rows[0]
        floor_area_raw = row.get("total-floor-area")
        floor_area = float(floor_area_raw) if floor_area_raw else None
        lmk_key = row.get("lmk-key", "")
        return EpcResult(
            address=row.get("address", ""),
            postcode=row.get("postcode", postcode),
            rating=row.get("current-energy-rating", ""),
            score=int(row.get("current-energy-efficiency", "0")),
            certificate_date=row.get("lodgement-date", ""),
            certificate_url=f"https://find-energy-certificate.service.gov.uk/energy-certificate/{lmk_key}",
            property_type=row.get("property-type", ""),
            floor_area_sqm=floor_area,
        )
    except Exception:
        logger.exception("EPC lookup failed for %s", postcode)
        return None
