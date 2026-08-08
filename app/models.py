"""Core domain models for the Deal Sourcing Engine."""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SourceType(StrEnum):
    AUCTION = "auction"
    PORTAL = "portal"
    AGENT = "agent"


class PropertyType(StrEnum):
    DETACHED = "detached"
    SEMI_DETACHED = "semi_detached"
    TERRACED = "terraced"
    FLAT = "flat"
    MAISONETTE = "maisonette"
    BUNGALOW = "bungalow"
    LAND = "land"
    COMMERCIAL = "commercial"
    OTHER = "other"
    UNKNOWN = "unknown"


class Tenure(StrEnum):
    FREEHOLD = "freehold"
    LEASEHOLD = "leasehold"
    SHARE_OF_FREEHOLD = "share_of_freehold"
    COMMONHOLD = "commonhold"
    UNKNOWN = "unknown"


class ListingStatus(StrEnum):
    ACTIVE = "active"
    UNDER_OFFER = "under_offer"
    SOLD = "sold"
    WITHDRAWN = "withdrawn"
    LOT_UNSOLD = "lot_unsold"
    SOLD_PRIOR = "sold_prior"


class ChangeType(StrEnum):
    PRICE_REDUCTION = "price_reduction"
    PRICE_INCREASE = "price_increase"
    STATUS_CHANGE = "status_change"
    DESCRIPTION_CHANGE = "description_change"
    IMAGES_CHANGE = "images_change"
    NEW_LISTING = "new_listing"


class ScrapeStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"


class SourceHealth(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    PAUSED = "paused"


# ---------------------------------------------------------------------------
# Raw extraction (pre-normalization)
# ---------------------------------------------------------------------------

class RawListing(BaseModel):
    """Unprocessed payload as extracted from source."""
    source_id: str
    source_type: SourceType
    source_url: str
    external_id: str | None = None
    raw_payload: dict[str, Any]
    scraped_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Normalized listing
# ---------------------------------------------------------------------------

class Address(BaseModel):
    raw: str
    line1: str | None = None
    line2: str | None = None
    town: str | None = None
    county: str | None = None
    postcode: str | None = None
    postcode_district: str | None = None
    canonical: str | None = None  # Normalised for dedup


class PriceInfo(BaseModel):
    amount: int | None = None          # pence
    currency: str = "GBP"
    guide_price: int | None = None     # auction guide (pence)
    reserve_price: int | None = None   # auction reserve (pence)
    price_qualifier: str | None = None  # "offers over", "fixed price", etc.


class AuctionInfo(BaseModel):
    auction_house: str | None = None
    lot_number: str | None = None
    auction_date: datetime | None = None
    auction_venue: str | None = None
    online_bidding: bool = False


class LeaseInfo(BaseModel):
    lease_length_years: int | None = None
    lease_expiry_year: int | None = None
    ground_rent_pa: int | None = None      # pence per annum
    service_charge_pa: int | None = None    # pence per annum


class NormalizedListing(BaseModel):
    """Fully structured listing ready for downstream enrichment."""
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    fingerprint: str  # SHA-256 of canonical dedup fields
    canonical_address_key: str  # Normalised address for dedup

    # Source provenance
    source_id: str
    source_type: SourceType
    listing_url: str
    external_id: str | None = None

    # Property details
    address: Address
    price: PriceInfo
    property_type: PropertyType = PropertyType.UNKNOWN
    bedrooms: int | None = None
    bathrooms: int | None = None
    reception_rooms: int | None = None
    floor_area_sqft: float | None = None
    floor_area_sqm: float | None = None
    tenure: Tenure = Tenure.UNKNOWN
    lease: LeaseInfo | None = None

    # Listing metadata
    status: ListingStatus = ListingStatus.ACTIVE
    description: str | None = None
    agent_name: str | None = None
    agent_branch: str | None = None
    agent_phone: str | None = None

    # Media
    image_urls: list[str] = Field(default_factory=list)
    floorplan_urls: list[str] = Field(default_factory=list)
    brochure_urls: list[str] = Field(default_factory=list)
    virtual_tour_url: str | None = None

    # Auction specifics
    auction: AuctionInfo | None = None

    # Timestamps
    first_seen_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)
    last_changed_at: datetime | None = None

    # Enrichment hooks (populated downstream)
    epc_rating: str | None = None
    council_tax_band: str | None = None
    planning_history: list[dict] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Change record
# ---------------------------------------------------------------------------

class ListingChange(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    listing_id: uuid.UUID
    change_type: ChangeType
    field_name: str
    old_value: Any
    new_value: Any
    detected_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Scrape session
# ---------------------------------------------------------------------------

class ScrapeSession(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    source_id: str
    status: ScrapeStatus = ScrapeStatus.PENDING
    started_at: datetime | None = None
    finished_at: datetime | None = None
    listings_found: int = 0
    listings_new: int = 0
    listings_updated: int = 0
    listings_unchanged: int = 0
    error_message: str | None = None
    temporal_workflow_id: str | None = None


# ---------------------------------------------------------------------------
# Source configuration
# ---------------------------------------------------------------------------

class SourceConfig(BaseModel):
    id: str                          # e.g. "rightmove", "allsop_auction"
    name: str
    source_type: SourceType
    base_url: str
    enabled: bool = True
    health: SourceHealth = SourceHealth.HEALTHY
    schedule_cron: str = "0 */4 * * *"  # every 4 hours
    rate_limit_rpm: int = 20
    scrape_delay_min: float = 2.0
    scrape_delay_max: float = 5.0
    extra_config: dict[str, Any] = Field(default_factory=dict)
    consecutive_errors: int = 0
    last_scrape_at: datetime | None = None


# ---------------------------------------------------------------------------
# API response models
# ---------------------------------------------------------------------------

class ListingResponse(NormalizedListing):
    pass


class ListingChangedResponse(BaseModel):
    listing: NormalizedListing
    changes: list[ListingChange]


class TriggerScrapeResponse(BaseModel):
    workflow_id: str
    source_id: str
    message: str


class SourceHealthResponse(BaseModel):
    source_id: str
    health: SourceHealth
    consecutive_errors: int
    last_scrape_at: datetime | None
    updated_at: datetime | None = None


# ---------------------------------------------------------------------------
# Deal Review (Phase 3 — deal storage)
# ---------------------------------------------------------------------------

class DealReview(BaseModel):
    """API response model for a saved deal review."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    listing_id: uuid.UUID | None
    deal_name: str
    form_snapshot: dict[str, Any]
    sdlt: int                    # pence
    total_acquisition_cost: int  # pence
    gross_rental_yield: float    # percentage to 1dp
    flip_profit: int             # pence
    irr: float | None            # decimal (e.g. 0.085 = 8.5%) — NOT a percentage
    holding_period_years: int
    created_at: datetime


class DealReviewCreate(BaseModel):
    """Request body for creating a deal review."""
    listing_id: uuid.UUID | None = None
    deal_name: str
    form_snapshot: dict[str, Any]
    sdlt: int
    total_acquisition_cost: int
    gross_rental_yield: float
    flip_profit: int
    irr: float | None = None
    holding_period_years: int = 5


class DealReviewUpdate(BaseModel):
    """Request body for updating an existing deal review."""
    deal_name: str | None = None
    form_snapshot: dict[str, Any] | None = None
    sdlt: int | None = None
    total_acquisition_cost: int | None = None
    gross_rental_yield: float | None = None
    flip_profit: int | None = None
    irr: float | None = None
    holding_period_years: int | None = None


# ---------------------------------------------------------------------------
# Refurb Appraisal (Phase 4 — refurb calculator)
# ---------------------------------------------------------------------------

class RefurbAppraisalCreate(BaseModel):
    """Request body for creating a refurb appraisal snapshot."""
    name: str
    inputs_snapshot: dict[str, Any]
    net_profit: int | None = None        # pence
    margin_pct: float | None = None
    irr_equity: float | None = None


class RefurbAppraisalUpdate(BaseModel):
    """Request body for updating an existing refurb appraisal."""
    name: str | None = None
    inputs_snapshot: dict[str, Any] | None = None
    net_profit: int | None = None
    margin_pct: float | None = None
    irr_equity: float | None = None


class RefurbAppraisal(BaseModel):
    """API response model for a saved refurb appraisal."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    inputs_snapshot: dict[str, Any]
    net_profit: int | None
    margin_pct: float | None
    irr_equity: float | None
    created_at: datetime
    updated_at: datetime | None = None
