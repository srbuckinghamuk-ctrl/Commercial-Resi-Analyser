"""Environment Agency live flood *warnings* lookup.

IMPORTANT: this integration queries the EA flood-monitoring feed, which
reports live flood warnings/alerts currently in force. It does NOT answer
the flood-zone question (Flood Zone 1/2/3) required for PDR eligibility.
Flood zones must be checked manually on the EA Flood Map for Planning
(flood-map-for-planning.service.gov.uk). The warning data returned here is
advisory context only and must never be used to pass or fail the
flood-zone criterion.
"""
import logging
from dataclasses import dataclass

from app.integrations.http import get_client

logger = logging.getLogger(__name__)

EA_FLOOD_BASE = "https://environment.data.gov.uk/flood-monitoring"

# EA severity levels: 1 = Severe Flood Warning, 2 = Flood Warning,
# 3 = Flood Alert, 4 = Warning no longer in force.
_ACTIVE_SEVERITY_MAX = 3


@dataclass(frozen=True)
class FloodWarningsResult:
    """Live flood warning/alert status near a location — NOT flood zone data."""

    has_active_warnings: bool
    warning_count: int
    max_severity_level: int | None  # lowest number = most severe; None if no items
    source: str = "EA Flood Monitoring API (live warnings, not flood zones)"


async def lookup_flood_warnings(
    postcode: str, latitude: float, longitude: float
) -> FloodWarningsResult | None:
    """Return live EA flood warnings/alerts within ~1km of the location.

    Returns None if the feed is unavailable. A result with no active
    warnings does NOT mean the site is in Flood Zone 1 — check the EA
    Flood Map for Planning for flood zones.
    """
    url = f"{EA_FLOOD_BASE}/id/floods"
    params = {
        "lat": f"{latitude:.3f}",
        "long": f"{longitude:.3f}",
        "dist": "1",
    }
    try:
        resp = await get_client().get(url, params=params, timeout=15.0)
        if resp.status_code != 200:
            logger.warning(
                "EA flood warnings lookup for %s returned HTTP %s", postcode, resp.status_code
            )
            return None
        items = resp.json().get("items", [])
        active = [
            item for item in items
            if item.get("severityLevel", 4) <= _ACTIVE_SEVERITY_MAX
        ]
        severities = [item.get("severityLevel", 4) for item in items]
        return FloodWarningsResult(
            has_active_warnings=len(active) > 0,
            warning_count=len(active),
            max_severity_level=min(severities) if severities else None,
        )
    except Exception:
        logger.exception("EA flood warnings lookup failed for %s", postcode)
        return None
