"""EPC lookup against the NON-DOMESTIC (commercial) energy certificate register.

Commercial buildings are certified on the non-domestic register, whose rows
use 'asset-rating' / 'asset-rating-band' rather than the domestic
'current-energy-efficiency' / 'current-energy-rating' columns.

The result records whether the returned row actually matched the supplied
address fragment (`matched_address`). Callers MUST NOT rely on
building-specific values (e.g. floor area) from an unmatched row — it may
describe a neighbouring property in the same postcode.
"""
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
    matched_address: bool = False


async def lookup_epc(
    postcode: str,
    address_fragment: str | None = None,
    api_key: str = "",
) -> EpcResult | None:
    if not api_key:
        logger.warning("EPC lookup skipped — no API key configured")
        return None
    url = f"{EPC_API_BASE}/non-domestic/search"
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
        matched_address = False
        if address_fragment:
            fragment_lower = address_fragment.lower()
            matched = [r for r in rows if fragment_lower in r.get("address", "").lower()]
            if matched:
                row = matched[0]
                matched_address = True
            else:
                row = rows[0]
        else:
            row = rows[0]
        floor_area_raw = row.get("floor-area") or row.get("total-floor-area")
        try:
            floor_area = float(floor_area_raw) if floor_area_raw else None
        except (ValueError, TypeError):
            floor_area = None
        try:
            score = int(float(row.get("asset-rating") or 0))
        except (ValueError, TypeError):
            score = 0
        lmk_key = row.get("lmk-key", "")
        return EpcResult(
            address=row.get("address", ""),
            postcode=row.get("postcode", postcode),
            rating=row.get("asset-rating-band", ""),
            score=score,
            certificate_date=row.get("lodgement-date", ""),
            certificate_url=f"https://find-energy-certificate.service.gov.uk/energy-certificate/{lmk_key}",
            property_type=row.get("property-type", ""),
            floor_area_sqm=floor_area,
            matched_address=matched_address,
        )
    except Exception:
        logger.exception("EPC lookup failed for %s", postcode)
        return None
