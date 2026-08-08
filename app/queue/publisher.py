"""
Event publisher for downstream enrichment and underwriting engines.

Publishes events to Redis Streams so consumers can react to:
  - new_listing
  - listing_changed
  - listing_status_changed
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import redis.asyncio as aioredis
import structlog

from app.models import ListingChange, NormalizedListing
from config.settings import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()

STREAM_NEW_LISTINGS = "deals:new_listings"
STREAM_CHANGED_LISTINGS = "deals:changed_listings"
STREAM_ERRORS = "deals:scrape_errors"


class EventPublisher:
    def __init__(self, redis_url: str | None = None):
        self._redis_url = redis_url or settings.redis_url
        self._client: aioredis.Redis | None = None

    async def connect(self) -> None:
        self._client = await aioredis.from_url(self._redis_url, decode_responses=True)

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()

    async def __aenter__(self) -> "EventPublisher":
        await self.connect()
        return self

    async def __aexit__(self, *args) -> None:
        await self.close()

    def _r(self) -> aioredis.Redis:
        assert self._client, "Publisher not connected"
        return self._client

    async def publish_new_listing(self, listing: NormalizedListing) -> None:
        event = {
            "event_type": "new_listing",
            "listing_id": str(listing.id),
            "source_id": listing.source_id,
            "source_type": listing.source_type,
            "fingerprint": listing.fingerprint,
            "canonical_address": listing.canonical_address_key,
            "postcode": listing.address.postcode or "",
            "postcode_district": listing.address.postcode_district or "",
            "price_pence": str(listing.price.amount or 0),
            "property_type": listing.property_type,
            "bedrooms": str(listing.bedrooms or ""),
            "tenure": listing.tenure,
            "listing_url": listing.listing_url,
            "auction_date": listing.auction.auction_date.isoformat()
            if listing.auction and listing.auction.auction_date
            else "",
            "published_at": datetime.now(timezone.utc).isoformat(),
            # Full payload for enrichment pipeline
            "payload_json": listing.model_dump_json(),
        }
        try:
            await self._r().xadd(STREAM_NEW_LISTINGS, event, maxlen=10_000, approximate=True)
            log.debug("published new_listing event", listing_id=str(listing.id))
        except Exception as exc:
            log.error("failed to publish new_listing", error=str(exc))

    async def publish_listing_changed(
        self, listing: NormalizedListing, changes: list[ListingChange]
    ) -> None:
        event = {
            "event_type": "listing_changed",
            "listing_id": str(listing.id),
            "source_id": listing.source_id,
            "change_types": ",".join(set(c.change_type for c in changes)),
            "change_count": str(len(changes)),
            "canonical_address": listing.canonical_address_key,
            "postcode": listing.address.postcode or "",
            "published_at": datetime.now(timezone.utc).isoformat(),
            "changes_json": json.dumps(
                [
                    {
                        "change_type": c.change_type,
                        "field": c.field_name,
                        "old": c.old_value,
                        "new": c.new_value,
                    }
                    for c in changes
                ],
                default=str,
            ),
            "listing_json": listing.model_dump_json(),
        }
        try:
            await self._r().xadd(STREAM_CHANGED_LISTINGS, event, maxlen=5_000, approximate=True)
            log.debug("published listing_changed event", listing_id=str(listing.id))
        except Exception as exc:
            log.error("failed to publish listing_changed", error=str(exc))

    async def publish_scrape_error(
        self, source_id: str, error_type: str, message: str, url: str | None = None
    ) -> None:
        event = {
            "event_type": "scrape_error",
            "source_id": source_id,
            "error_type": error_type,
            "message": message[:500],
            "url": url or "",
            "published_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await self._r().xadd(STREAM_ERRORS, event, maxlen=1_000, approximate=True)
        except Exception as exc:
            log.error("failed to publish scrape_error", error=str(exc))


# Module-level singleton for use in FastAPI
_publisher: EventPublisher | None = None


async def get_publisher() -> EventPublisher:
    global _publisher
    if _publisher is None:
        _publisher = EventPublisher()
        await _publisher.connect()
    return _publisher
