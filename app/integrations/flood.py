import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

EA_FLOOD_BASE = "https://environment.data.gov.uk/flood-monitoring"


@dataclass(frozen=True)
class FloodRiskResult:
    flood_zone: str
    flood_zone_numeric: int
    in_flood_zone_2_or_3: bool
    source: str = "EA Flood Monitoring API"


async def lookup_flood_risk(
    postcode: str, latitude: float, longitude: float
) -> FloodRiskResult | None:
    url = f"{EA_FLOOD_BASE}/id/floods"
    params = {
        "lat": f"{latitude:.3f}",
        "long": f"{longitude:.3f}",
        "dist": "1",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
        if resp.status_code != 200:
            return None
        items = resp.json().get("items", [])
        if not items:
            return FloodRiskResult(
                flood_zone="Zone 1",
                flood_zone_numeric=1,
                in_flood_zone_2_or_3=False,
            )
        max_severity = min(item.get("severityLevel", 4) for item in items)
        if max_severity <= 2:
            return FloodRiskResult(
                flood_zone="Zone 2/3",
                flood_zone_numeric=3,
                in_flood_zone_2_or_3=True,
            )
        return FloodRiskResult(
            flood_zone="Zone 1 (nearby alerts)",
            flood_zone_numeric=1,
            in_flood_zone_2_or_3=False,
        )
    except Exception:
        logger.exception("EA Flood API lookup failed for %s", postcode)
        return None
