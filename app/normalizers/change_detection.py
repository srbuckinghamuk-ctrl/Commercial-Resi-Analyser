"""
Change detection between old and new listing versions.

Detects: price reductions/increases, status changes, description edits,
         image changes.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.models import ChangeType, ListingChange, NormalizedListing


_TRACKED_FIELDS: list[tuple[str, ChangeType | None]] = [
    ("price.amount", None),       # None = derive type dynamically
    ("price.guide_price", None),
    ("status", ChangeType.STATUS_CHANGE),
    ("description", ChangeType.DESCRIPTION_CHANGE),
    ("tenure", ChangeType.STATUS_CHANGE),
    ("bedrooms", ChangeType.STATUS_CHANGE),
    ("floor_area_sqft", ChangeType.STATUS_CHANGE),
    ("image_urls", ChangeType.IMAGES_CHANGE),
    ("auction.auction_date", ChangeType.STATUS_CHANGE),
]


def _get_nested(obj: Any, dotpath: str) -> Any:
    """Traverse nested attributes via dot notation."""
    parts = dotpath.split(".")
    cur = obj
    for p in parts:
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(p)
        else:
            cur = getattr(cur, p, None)
    return cur


def detect_changes(
    old: NormalizedListing,
    new: NormalizedListing,
    detected_at: datetime | None = None,
) -> list[ListingChange]:
    """
    Compare old and new listing versions and return a list of changes.
    """
    ts = detected_at or datetime.now(timezone.utc)
    changes: list[ListingChange] = []

    for field_path, default_change_type in _TRACKED_FIELDS:
        old_val = _get_nested(old, field_path)
        new_val = _get_nested(new, field_path)

        if old_val == new_val:
            continue

        # Derive change type for price fields
        change_type = default_change_type
        if field_path in ("price.amount", "price.guide_price"):
            if isinstance(old_val, int) and isinstance(new_val, int):
                change_type = (
                    ChangeType.PRICE_REDUCTION if new_val < old_val else ChangeType.PRICE_INCREASE
                )
            else:
                change_type = ChangeType.STATUS_CHANGE  # fallback when price values are non-int

        if change_type is None:
            change_type = ChangeType.STATUS_CHANGE

        changes.append(
            ListingChange(
                id=uuid.uuid4(),
                listing_id=old.id,
                change_type=change_type,
                field_name=field_path,
                old_value=_serialise(old_val),
                new_value=_serialise(new_val),
                detected_at=ts,
            )
        )

    return changes


def _serialise(val: Any) -> Any:
    """Make a value JSON-serialisable."""
    if isinstance(val, list):
        return [_serialise(v) for v in val]
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return val
