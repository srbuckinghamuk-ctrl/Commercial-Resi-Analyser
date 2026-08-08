"""Repository pattern for all database operations."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, desc, nullslast, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    ListingChange, NormalizedListing,
    ScrapeSession, ScrapeStatus, SourceConfig, SourceHealth,
)
from app.persistence.database import (
    ListingChangeORM, ListingORM, ScrapeErrorLogORM,
    ScrapeSessionORM, SourceConfigORM,
)
import structlog

log = structlog.get_logger(__name__)


def _orm_to_normalized(row: ListingORM) -> NormalizedListing:
    """Map ORM row → domain model."""
    from app.models import Address, AuctionInfo, LeaseInfo, PriceInfo

    address = Address(
        raw=row.address_raw,
        line1=row.address_line1,
        line2=row.address_line2,
        town=row.address_town,
        county=row.address_county,
        postcode=row.postcode,
        postcode_district=row.postcode_district,
        canonical=row.canonical_address_key,
    )

    price = PriceInfo(
        amount=row.price_amount,
        currency=row.price_currency,
        guide_price=row.guide_price,
        reserve_price=row.reserve_price,
        price_qualifier=row.price_qualifier,
    )

    lease = None
    if any([row.lease_length_years, row.lease_expiry_year]):
        lease = LeaseInfo(
            lease_length_years=row.lease_length_years,
            lease_expiry_year=row.lease_expiry_year,
            ground_rent_pa=row.ground_rent_pa,
            service_charge_pa=row.service_charge_pa,
        )

    auction = None
    if any([row.auction_house, row.auction_date]):
        auction = AuctionInfo(
            auction_house=row.auction_house,
            lot_number=row.lot_number,
            auction_date=row.auction_date,
            auction_venue=row.auction_venue,
            online_bidding=row.online_bidding,
        )

    return NormalizedListing(
        id=row.id,
        fingerprint=row.fingerprint,
        canonical_address_key=row.canonical_address_key,
        source_id=row.source_id,
        source_type=row.source_type,
        listing_url=row.listing_url,
        external_id=row.external_id,
        address=address,
        price=price,
        property_type=row.property_type,
        bedrooms=row.bedrooms,
        bathrooms=row.bathrooms,
        reception_rooms=row.reception_rooms,
        floor_area_sqft=row.floor_area_sqft,
        floor_area_sqm=row.floor_area_sqm,
        tenure=row.tenure,
        lease=lease,
        status=row.status,
        description=row.description,
        agent_name=row.agent_name,
        agent_branch=row.agent_branch,
        agent_phone=row.agent_phone,
        image_urls=row.image_urls or [],
        floorplan_urls=row.floorplan_urls or [],
        brochure_urls=row.brochure_urls or [],
        virtual_tour_url=row.virtual_tour_url,
        auction=auction,
        first_seen_at=row.first_seen_at,
        last_seen_at=row.last_seen_at,
        last_changed_at=row.last_changed_at,
        epc_rating=row.epc_rating,
        council_tax_band=row.council_tax_band,
    )


class ListingRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_fingerprint(self, fingerprint: str) -> NormalizedListing | None:
        result = await self.db.execute(
            select(ListingORM).where(ListingORM.fingerprint == fingerprint)
        )
        row = result.scalar_one_or_none()
        return _orm_to_normalized(row) if row else None

    async def get_by_id(self, listing_id: uuid.UUID) -> NormalizedListing | None:
        result = await self.db.execute(
            select(ListingORM).where(ListingORM.id == listing_id)
        )
        row = result.scalar_one_or_none()
        return _orm_to_normalized(row) if row else None

    async def get_by_source_external_id(
        self, source_id: str, external_id: str
    ) -> NormalizedListing | None:
        result = await self.db.execute(
            select(ListingORM).where(
                and_(
                    ListingORM.source_id == source_id,
                    ListingORM.external_id == external_id,
                )
            )
        )
        row = result.scalar_one_or_none()
        return _orm_to_normalized(row) if row else None

    async def get_by_canonical_address(self, canonical: str) -> list[NormalizedListing]:
        result = await self.db.execute(
            select(ListingORM).where(ListingORM.canonical_address_key == canonical)
        )
        rows = result.scalars().all()
        return [_orm_to_normalized(r) for r in rows]

    async def upsert(self, listing: NormalizedListing, raw_payload: dict) -> tuple[NormalizedListing, bool]:
        """Insert or update. Returns (listing, is_new)."""
        # Try by source+external_id first
        existing_row: ListingORM | None = None
        if listing.external_id:
            result = await self.db.execute(
                select(ListingORM).where(
                    and_(
                        ListingORM.source_id == listing.source_id,
                        ListingORM.external_id == listing.external_id,
                    )
                )
            )
            existing_row = result.scalar_one_or_none()

        if not existing_row:
            result = await self.db.execute(
                select(ListingORM).where(ListingORM.fingerprint == listing.fingerprint)
            )
            existing_row = result.scalar_one_or_none()

        if existing_row is None:
            # New listing
            row = self._to_orm(listing, raw_payload)
            self.db.add(row)
            await self.db.flush()
            new_normalized = _orm_to_normalized(row)
            return None, new_normalized, True

        # Capture pre-update state for change detection
        old_snapshot = _orm_to_normalized(existing_row)
        self._update_orm(existing_row, listing, raw_payload)
        await self.db.flush()
        return old_snapshot, _orm_to_normalized(existing_row), False

    def _to_orm(self, listing: NormalizedListing, raw_payload: dict) -> ListingORM:
        return ListingORM(
            id=listing.id,
            fingerprint=listing.fingerprint,
            canonical_address_key=listing.canonical_address_key,
            source_id=listing.source_id,
            source_type=listing.source_type,
            listing_url=listing.listing_url,
            external_id=listing.external_id,
            address_raw=listing.address.raw,
            address_line1=listing.address.line1,
            address_line2=listing.address.line2,
            address_town=listing.address.town,
            address_county=listing.address.county,
            postcode=listing.address.postcode,
            postcode_district=listing.address.postcode_district,
            price_amount=listing.price.amount,
            price_currency=listing.price.currency,
            guide_price=listing.price.guide_price,
            reserve_price=listing.price.reserve_price,
            price_qualifier=listing.price.price_qualifier,
            property_type=listing.property_type,
            bedrooms=listing.bedrooms,
            bathrooms=listing.bathrooms,
            reception_rooms=listing.reception_rooms,
            floor_area_sqft=listing.floor_area_sqft,
            floor_area_sqm=listing.floor_area_sqm,
            tenure=listing.tenure,
            lease_length_years=listing.lease.lease_length_years if listing.lease else None,
            lease_expiry_year=listing.lease.lease_expiry_year if listing.lease else None,
            ground_rent_pa=listing.lease.ground_rent_pa if listing.lease else None,
            service_charge_pa=listing.lease.service_charge_pa if listing.lease else None,
            status=listing.status,
            description=listing.description,
            agent_name=listing.agent_name,
            agent_branch=listing.agent_branch,
            agent_phone=listing.agent_phone,
            image_urls=listing.image_urls,
            floorplan_urls=listing.floorplan_urls,
            brochure_urls=listing.brochure_urls,
            virtual_tour_url=listing.virtual_tour_url,
            auction_house=listing.auction.auction_house if listing.auction else None,
            lot_number=listing.auction.lot_number if listing.auction else None,
            auction_date=listing.auction.auction_date if listing.auction else None,
            auction_venue=listing.auction.auction_venue if listing.auction else None,
            online_bidding=listing.auction.online_bidding if listing.auction else False,
            raw_payload=raw_payload,
        )

    def _update_orm(self, row: ListingORM, listing: NormalizedListing, raw_payload: dict) -> None:
        row.listing_url = listing.listing_url
        row.fingerprint = listing.fingerprint
        row.canonical_address_key = listing.canonical_address_key
        row.source_type = listing.source_type
        row.external_id = listing.external_id
        row.address_raw = listing.address.raw
        row.address_line1 = listing.address.line1
        row.address_line2 = listing.address.line2
        row.address_town = listing.address.town
        row.address_county = listing.address.county
        row.postcode = listing.address.postcode
        row.postcode_district = listing.address.postcode_district
        row.price_amount = listing.price.amount
        row.price_currency = listing.price.currency
        row.guide_price = listing.price.guide_price
        row.reserve_price = listing.price.reserve_price
        row.price_qualifier = listing.price.price_qualifier
        row.property_type = listing.property_type
        row.status = listing.status
        row.description = listing.description
        row.bedrooms = listing.bedrooms
        row.bathrooms = listing.bathrooms
        row.reception_rooms = listing.reception_rooms
        row.floor_area_sqft = listing.floor_area_sqft
        row.floor_area_sqm = listing.floor_area_sqm
        row.tenure = listing.tenure
        row.epc_rating = getattr(listing, 'epc_rating', None)
        row.council_tax_band = getattr(listing, 'council_tax_band', None)
        row.lease_length_years = listing.lease.lease_length_years if listing.lease else None
        row.lease_expiry_year = listing.lease.lease_expiry_year if listing.lease else None
        row.ground_rent_pa = listing.lease.ground_rent_pa if listing.lease else None
        row.service_charge_pa = listing.lease.service_charge_pa if listing.lease else None
        row.image_urls = listing.image_urls
        row.floorplan_urls = listing.floorplan_urls
        row.brochure_urls = listing.brochure_urls
        row.virtual_tour_url = listing.virtual_tour_url
        row.agent_name = listing.agent_name
        row.agent_branch = listing.agent_branch
        row.agent_phone = listing.agent_phone
        row.auction_date = listing.auction.auction_date if listing.auction else None
        row.auction_house = listing.auction.auction_house if listing.auction else None
        row.auction_venue = listing.auction.auction_venue if listing.auction else None
        row.lot_number = listing.auction.lot_number if listing.auction else None
        row.online_bidding = listing.auction.online_bidding if listing.auction else False
        row.last_seen_at = datetime.now(timezone.utc)
        row.raw_payload = raw_payload

    async def get_latest(
        self,
        source_id: str | None = None,
        status: str | None = None,
        postcode_district: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[NormalizedListing]:
        query = select(ListingORM)
        filters = []
        if source_id is not None:
            filters.append(ListingORM.source_id == source_id)
        if status is not None:
            filters.append(ListingORM.status == status)
        if postcode_district is not None:
            filters.append(ListingORM.postcode_district == postcode_district)
        if filters:
            query = query.where(and_(*filters))
        query = query.order_by(desc(ListingORM.last_seen_at)).limit(limit).offset(offset)
        result = await self.db.execute(query)
        return [_orm_to_normalized(r) for r in result.scalars().all()]

    async def get_changed_since(
        self, since: datetime, limit: int = 50
    ) -> list[tuple[NormalizedListing, list[ListingChange]]]:
        result = await self.db.execute(
            select(ListingORM)
            .where(ListingORM.last_changed_at >= since)
            .options(selectinload(ListingORM.changes))
            .order_by(desc(ListingORM.last_changed_at))
            .limit(limit)
        )
        rows = result.scalars().all()
        out = []
        for row in rows:
            listing = _orm_to_normalized(row)
            changes = [
                ListingChange(
                    id=c.id,
                    listing_id=c.listing_id,
                    change_type=c.change_type,
                    field_name=c.field_name,
                    old_value=c.old_value,
                    new_value=c.new_value,
                    detected_at=c.detected_at,
                )
                for c in row.changes
                if c.detected_at >= since
            ]
            out.append((listing, changes))
        return out

    async def record_changes(self, changes: list[ListingChange]) -> None:
        for change in changes:
            row = ListingChangeORM(
                id=change.id,
                listing_id=change.listing_id,
                change_type=change.change_type,
                field_name=change.field_name,
                old_value=change.old_value,
                new_value=change.new_value,
            )
            self.db.add(row)
        await self.db.flush()

    async def mark_last_changed(self, listing_id: uuid.UUID, ts: datetime) -> None:
        await self.db.execute(
            update(ListingORM)
            .where(ListingORM.id == listing_id)
            .values(last_changed_at=ts)
        )


class ScrapeSessionRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, source_id: str, workflow_id: str | None = None) -> ScrapeSession:
        row = ScrapeSessionORM(
            source_id=source_id,
            status=ScrapeStatus.PENDING,
            temporal_workflow_id=workflow_id,
        )
        self.db.add(row)
        await self.db.flush()
        return self._to_domain(row)

    async def update(self, session: ScrapeSession) -> None:
        await self.db.execute(
            update(ScrapeSessionORM)
            .where(ScrapeSessionORM.id == session.id)
            .values(
                status=session.status,
                started_at=session.started_at,
                finished_at=session.finished_at,
                listings_found=session.listings_found,
                listings_new=session.listings_new,
                listings_updated=session.listings_updated,
                listings_unchanged=session.listings_unchanged,
                error_message=session.error_message,
            )
        )

    async def log_error(
        self,
        session_id: uuid.UUID,
        source_id: str,
        error_type: str,
        error_message: str,
        url: str | None = None,
        retry_count: int = 0,
    ) -> None:
        row = ScrapeErrorLogORM(
            session_id=session_id,
            source_id=source_id,
            url=url,
            error_type=error_type,
            error_message=error_message,
            retry_count=retry_count,
        )
        self.db.add(row)
        await self.db.flush()

    def _to_domain(self, row: ScrapeSessionORM) -> ScrapeSession:
        return ScrapeSession(
            id=row.id,
            source_id=row.source_id,
            status=row.status,
            started_at=row.started_at,
            finished_at=row.finished_at,
            listings_found=row.listings_found,
            listings_new=row.listings_new,
            listings_updated=row.listings_updated,
            listings_unchanged=row.listings_unchanged,
            error_message=row.error_message,
            temporal_workflow_id=row.temporal_workflow_id,
        )


class SourceConfigRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(self, enabled_only: bool = True) -> list[SourceConfig]:
        query = select(SourceConfigORM)
        if enabled_only:
            query = query.where(SourceConfigORM.enabled.is_(True))
        result = await self.db.execute(query)
        return [self._to_domain(r) for r in result.scalars().all()]

    async def get(self, source_id: str) -> SourceConfig | None:
        result = await self.db.execute(
            select(SourceConfigORM).where(SourceConfigORM.id == source_id)
        )
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

    async def upsert(self, config: SourceConfig) -> None:
        result = await self.db.execute(
            select(SourceConfigORM).where(SourceConfigORM.id == config.id)
        )
        row = result.scalar_one_or_none()
        if row:
            row.health = config.health
            row.consecutive_errors = config.consecutive_errors
            row.last_scrape_at = config.last_scrape_at
            row.enabled = config.enabled
        else:
            row = SourceConfigORM(
                id=config.id,
                name=config.name,
                source_type=config.source_type,
                base_url=config.base_url,
                enabled=config.enabled,
                schedule_cron=config.schedule_cron,
                rate_limit_rpm=config.rate_limit_rpm,
                scrape_delay_min=config.scrape_delay_min,
                scrape_delay_max=config.scrape_delay_max,
                extra_config=config.extra_config,
            )
            self.db.add(row)
        await self.db.flush()

    async def increment_error(self, source_id: str) -> int:
        result = await self.db.execute(
            select(SourceConfigORM).where(SourceConfigORM.id == source_id)
        )
        row = result.scalar_one_or_none()
        if row:
            row.consecutive_errors += 1
            await self.db.flush()
            return row.consecutive_errors
        return 0

    async def reset_errors(self, source_id: str) -> None:
        await self.db.execute(
            update(SourceConfigORM)
            .where(SourceConfigORM.id == source_id)
            .values(consecutive_errors=0, health=SourceHealth.HEALTHY)
        )

    async def set_health(self, source_id: str, health: SourceHealth) -> None:
        await self.db.execute(
            update(SourceConfigORM)
            .where(SourceConfigORM.id == source_id)
            .values(health=health)
        )

    def _to_domain(self, row: SourceConfigORM) -> SourceConfig:
        return SourceConfig(
            id=row.id,
            name=row.name,
            source_type=row.source_type,
            base_url=row.base_url,
            enabled=row.enabled,
            health=row.health,
            schedule_cron=row.schedule_cron,
            rate_limit_rpm=row.rate_limit_rpm,
            scrape_delay_min=row.scrape_delay_min,
            scrape_delay_max=row.scrape_delay_max,
            extra_config=row.extra_config,
            consecutive_errors=row.consecutive_errors,
            last_scrape_at=row.last_scrape_at,
        )


class DealReviewRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, deal: "DealReviewCreate") -> "DealReview":
        from app.models import DealReview as DealReviewDomain, DealReviewCreate
        from app.persistence.database import DealReviewORM
        row = DealReviewORM(
            listing_id=deal.listing_id,
            deal_name=deal.deal_name,
            form_snapshot=deal.form_snapshot,
            sdlt=deal.sdlt,
            total_acquisition_cost=deal.total_acquisition_cost,
            gross_rental_yield=deal.gross_rental_yield,
            flip_profit=deal.flip_profit,
            irr=deal.irr,
            holding_period_years=deal.holding_period_years,
        )
        self.db.add(row)
        await self.db.flush()
        return self._to_domain(row)

    async def list_all(self) -> list["DealReview"]:
        from app.persistence.database import DealReviewORM
        result = await self.db.execute(
            select(DealReviewORM).order_by(nullslast(desc(DealReviewORM.irr)))
        )
        return [self._to_domain(r) for r in result.scalars().all()]

    async def get_by_id(self, deal_id: uuid.UUID) -> "DealReview | None":
        from app.persistence.database import DealReviewORM
        result = await self.db.execute(
            select(DealReviewORM).where(DealReviewORM.id == deal_id)
        )
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

    async def update(self, deal_id: uuid.UUID, updates: "DealReviewUpdate") -> "DealReview | None":
        from app.persistence.database import DealReviewORM
        result = await self.db.execute(
            select(DealReviewORM).where(DealReviewORM.id == deal_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        if updates.deal_name is not None:
            row.deal_name = updates.deal_name
        if updates.form_snapshot is not None:
            row.form_snapshot = updates.form_snapshot
        if updates.sdlt is not None:
            row.sdlt = updates.sdlt
        if updates.total_acquisition_cost is not None:
            row.total_acquisition_cost = updates.total_acquisition_cost
        if updates.gross_rental_yield is not None:
            row.gross_rental_yield = updates.gross_rental_yield
        if updates.flip_profit is not None:
            row.flip_profit = updates.flip_profit
        if updates.irr is not None:
            row.irr = updates.irr
        if updates.holding_period_years is not None:
            row.holding_period_years = updates.holding_period_years
        await self.db.flush()
        return self._to_domain(row)

    async def delete(self, deal_id: uuid.UUID) -> bool:
        from app.persistence.database import DealReviewORM
        result = await self.db.execute(
            select(DealReviewORM).where(DealReviewORM.id == deal_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return False
        await self.db.delete(row)
        await self.db.flush()
        return True

    def _to_domain(self, row) -> "DealReview":
        from app.models import DealReview as DealReviewDomain
        return DealReviewDomain(
            id=row.id,
            listing_id=row.listing_id,
            deal_name=row.deal_name,
            form_snapshot=row.form_snapshot,
            sdlt=row.sdlt,
            total_acquisition_cost=row.total_acquisition_cost,
            gross_rental_yield=row.gross_rental_yield,
            flip_profit=row.flip_profit,
            irr=row.irr,
            holding_period_years=row.holding_period_years,
            created_at=row.created_at,
        )


class RefurbAppraisalRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, appraisal: "RefurbAppraisalCreate") -> "RefurbAppraisal":
        from app.persistence.database import RefurbAppraisalORM
        row = RefurbAppraisalORM(
            name=appraisal.name,
            inputs_snapshot=appraisal.inputs_snapshot,
            net_profit=appraisal.net_profit,
            margin_pct=appraisal.margin_pct,
            irr_equity=appraisal.irr_equity,
        )
        self.db.add(row)
        await self.db.flush()
        return self._to_domain(row)

    async def list_all(self) -> list["RefurbAppraisal"]:
        from app.persistence.database import RefurbAppraisalORM
        result = await self.db.execute(
            select(RefurbAppraisalORM).order_by(desc(RefurbAppraisalORM.created_at))
        )
        return [self._to_domain(r) for r in result.scalars().all()]

    async def get_by_id(self, appraisal_id: uuid.UUID) -> "RefurbAppraisal | None":
        from app.persistence.database import RefurbAppraisalORM
        result = await self.db.execute(
            select(RefurbAppraisalORM).where(RefurbAppraisalORM.id == appraisal_id)
        )
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

    async def update(self, appraisal_id: uuid.UUID, updates: "RefurbAppraisalUpdate") -> "RefurbAppraisal | None":
        from app.persistence.database import RefurbAppraisalORM
        from datetime import datetime, timezone
        result = await self.db.execute(
            select(RefurbAppraisalORM).where(RefurbAppraisalORM.id == appraisal_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        if updates.name is not None:
            row.name = updates.name
        if updates.inputs_snapshot is not None:
            row.inputs_snapshot = updates.inputs_snapshot
        if updates.net_profit is not None:
            row.net_profit = updates.net_profit
        if updates.margin_pct is not None:
            row.margin_pct = updates.margin_pct
        if updates.irr_equity is not None:
            row.irr_equity = updates.irr_equity
        row.updated_at = datetime.now(timezone.utc)
        await self.db.flush()
        return self._to_domain(row)

    async def delete(self, appraisal_id: uuid.UUID) -> bool:
        from app.persistence.database import RefurbAppraisalORM
        result = await self.db.execute(
            select(RefurbAppraisalORM).where(RefurbAppraisalORM.id == appraisal_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return False
        await self.db.delete(row)
        await self.db.flush()
        return True

    def _to_domain(self, row) -> "RefurbAppraisal":
        from app.models import RefurbAppraisal as RefurbAppraisalDomain
        return RefurbAppraisalDomain(
            id=row.id,
            name=row.name,
            inputs_snapshot=row.inputs_snapshot,
            net_profit=row.net_profit,
            margin_pct=row.margin_pct,
            irr_equity=row.irr_equity,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
