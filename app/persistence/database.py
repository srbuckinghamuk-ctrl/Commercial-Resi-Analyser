"""SQLAlchemy ORM models and async database setup."""
from __future__ import annotations

import uuid as _uuid_module
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Float, ForeignKey,
    Index, Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy import JSON, Uuid
from sqlalchemy.ext.asyncio import AsyncAttrs, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.models import (
    ListingStatus, PropertyType, ScrapeStatus, SourceHealth, Tenure,
)
from config.settings import get_settings


settings = get_settings()


# ---------------------------------------------------------------------------
# Engine & session factory
# ---------------------------------------------------------------------------

engine = create_async_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    echo=False,
)

AsyncSessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine, expire_on_commit=False, class_=AsyncSession
)


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------

class Base(AsyncAttrs, DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# ORM Models
# ---------------------------------------------------------------------------

class SourceConfigORM(Base):
    __tablename__ = "source_configs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    health: Mapped[str] = mapped_column(String(32), default=SourceHealth.HEALTHY)
    schedule_cron: Mapped[str] = mapped_column(String(64), default="0 */4 * * *")
    rate_limit_rpm: Mapped[int] = mapped_column(Integer, default=20)
    scrape_delay_min: Mapped[float] = mapped_column(Float, default=2.0)
    scrape_delay_max: Mapped[float] = mapped_column(Float, default=5.0)
    extra_config: Mapped[dict] = mapped_column(JSON, default=dict)
    consecutive_errors: Mapped[int] = mapped_column(Integer, default=0)
    last_scrape_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    scrape_sessions: Mapped[list[ScrapeSessionORM]] = relationship(back_populates="source")
    listings: Mapped[list[ListingORM]] = relationship(back_populates="source")


class ListingORM(Base):
    __tablename__ = "listings"

    id: Mapped[_uuid_module.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid_module.uuid4)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    canonical_address_key: Mapped[str] = mapped_column(String(512), nullable=False)

    # Source provenance
    source_id: Mapped[str] = mapped_column(String(64), ForeignKey("source_configs.id"))
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    listing_url: Mapped[str] = mapped_column(Text, nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # Address
    address_raw: Mapped[str] = mapped_column(Text, nullable=False)
    address_line1: Mapped[str | None] = mapped_column(Text, nullable=True)
    address_line2: Mapped[str | None] = mapped_column(Text, nullable=True)
    address_town: Mapped[str | None] = mapped_column(Text, nullable=True)
    address_county: Mapped[str | None] = mapped_column(Text, nullable=True)
    postcode: Mapped[str | None] = mapped_column(String(12), nullable=True)
    postcode_district: Mapped[str | None] = mapped_column(String(8), nullable=True)

    # Price
    price_amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # pence
    price_currency: Mapped[str] = mapped_column(String(3), default="GBP")
    guide_price: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reserve_price: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    price_qualifier: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Property
    property_type: Mapped[str] = mapped_column(String(32), default=PropertyType.UNKNOWN)
    bedrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reception_rooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    floor_area_sqft: Mapped[float | None] = mapped_column(Float, nullable=True)
    floor_area_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    tenure: Mapped[str] = mapped_column(String(32), default=Tenure.UNKNOWN)
    lease_length_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lease_expiry_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ground_rent_pa: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    service_charge_pa: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(32), default=ListingStatus.ACTIVE)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Agent
    agent_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    agent_branch: Mapped[str | None] = mapped_column(String(256), nullable=True)
    agent_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Media (JSON arrays)
    image_urls: Mapped[list] = mapped_column(JSON, default=list)
    floorplan_urls: Mapped[list] = mapped_column(JSON, default=list)
    brochure_urls: Mapped[list] = mapped_column(JSON, default=list)
    virtual_tour_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Auction
    auction_house: Mapped[str | None] = mapped_column(String(256), nullable=True)
    lot_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    auction_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auction_venue: Mapped[str | None] = mapped_column(Text, nullable=True)
    online_bidding: Mapped[bool] = mapped_column(Boolean, default=False)

    # Raw payload for reprocessing
    raw_payload: Mapped[dict] = mapped_column(JSON, default=dict)

    # Enrichment
    epc_rating: Mapped[str | None] = mapped_column(String(4), nullable=True)
    council_tax_band: Mapped[str | None] = mapped_column(String(4), nullable=True)

    # Timestamps
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    source: Mapped[SourceConfigORM] = relationship(back_populates="listings")
    changes: Mapped[list[ListingChangeORM]] = relationship(back_populates="listing")

    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_listing_source_external"),
        Index("ix_listing_fingerprint", "fingerprint"),
        Index("ix_listing_canonical_address", "canonical_address_key"),
        Index("ix_listing_postcode", "postcode"),
        Index("ix_listing_status", "status"),
        Index("ix_listing_source_id", "source_id"),
        Index("ix_listing_last_seen_at", "last_seen_at"),
        Index("ix_listing_last_changed_at", "last_changed_at"),
    )


class ListingChangeORM(Base):
    __tablename__ = "listing_changes"

    id: Mapped[_uuid_module.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid_module.uuid4)
    listing_id: Mapped[_uuid_module.UUID] = mapped_column(Uuid, ForeignKey("listings.id"))
    change_type: Mapped[str] = mapped_column(String(32), nullable=False)
    field_name: Mapped[str] = mapped_column(String(128), nullable=False)
    old_value: Mapped[Any] = mapped_column(JSON, nullable=True)
    new_value: Mapped[Any] = mapped_column(JSON, nullable=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    listing: Mapped[ListingORM] = relationship(back_populates="changes")

    __table_args__ = (
        Index("ix_change_listing_id", "listing_id"),
        Index("ix_change_detected_at", "detected_at"),
        Index("ix_change_type", "change_type"),
    )


class ScrapeSessionORM(Base):
    __tablename__ = "scrape_sessions"

    id: Mapped[_uuid_module.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid_module.uuid4)
    source_id: Mapped[str] = mapped_column(String(64), ForeignKey("source_configs.id"))
    status: Mapped[str] = mapped_column(String(32), default=ScrapeStatus.PENDING)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    listings_found: Mapped[int] = mapped_column(Integer, default=0)
    listings_new: Mapped[int] = mapped_column(Integer, default=0)
    listings_updated: Mapped[int] = mapped_column(Integer, default=0)
    listings_unchanged: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    temporal_workflow_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    source: Mapped[SourceConfigORM] = relationship(back_populates="scrape_sessions")
    error_logs: Mapped[list[ScrapeErrorLogORM]] = relationship(back_populates="session")

    __table_args__ = (
        Index("ix_session_source_id", "source_id"),
        Index("ix_session_status", "status"),
        Index("ix_session_created_at", "created_at"),
    )


class ScrapeErrorLogORM(Base):
    __tablename__ = "scrape_error_logs"

    id: Mapped[_uuid_module.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid_module.uuid4)
    session_id: Mapped[_uuid_module.UUID] = mapped_column(Uuid, ForeignKey("scrape_sessions.id"))
    source_id: Mapped[str] = mapped_column(String(64), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_type: Mapped[str] = mapped_column(String(128), nullable=False)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped[ScrapeSessionORM] = relationship(back_populates="error_logs")

    __table_args__ = (
        Index("ix_error_log_session_id", "session_id"),
        Index("ix_error_log_source_id", "source_id"),
    )


class DealReviewORM(Base):
    __tablename__ = "deal_reviews"

    id: Mapped[_uuid_module.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid_module.uuid4)
    listing_id: Mapped[_uuid_module.UUID | None] = mapped_column(
        Uuid, ForeignKey("listings.id"), nullable=True
    )
    deal_name: Mapped[str] = mapped_column(Text, nullable=False)
    form_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)

    sdlt: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_acquisition_cost: Mapped[int] = mapped_column(BigInteger, nullable=False)
    gross_rental_yield: Mapped[float] = mapped_column(Float, nullable=False)
    flip_profit: Mapped[int] = mapped_column(BigInteger, nullable=False)
    irr: Mapped[float | None] = mapped_column(Float, nullable=True)
    holding_period_years: Mapped[int] = mapped_column(Integer, nullable=False, default=5)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_deal_created_at", "created_at"),
    )


class RefurbAppraisalORM(Base):
    __tablename__ = "refurb_appraisals"

    id: Mapped[_uuid_module.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid_module.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    inputs_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    net_profit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    margin_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    irr_equity: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc)
    )
