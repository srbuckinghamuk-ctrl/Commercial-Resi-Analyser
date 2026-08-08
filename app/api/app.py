"""
FastAPI application with all internal API endpoints.

Endpoints:
  POST /api/v1/scrape/{source_id}       - trigger source scrape
  GET  /api/v1/listings                  - fetch latest listings
  GET  /api/v1/listings/changed          - fetch changed listings
  GET  /api/v1/listings/{id}             - get single listing
  POST /api/v1/sources/{source_id}/health - mark source health
  GET  /api/v1/sources                   - list all sources
  GET  /api/v1/health                    - system health
  GET  /metrics                          - Prometheus metrics
"""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated

import structlog
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy.ext.asyncio import AsyncSession
try:
    from temporalio.client import Client
except ImportError:  # temporalio not installed or broken (e.g. Windows MAX_PATH)
    Client = None  # type: ignore[assignment,misc]

from app.models import (
    DealReview, DealReviewCreate, DealReviewUpdate,
    ListingChangedResponse, ListingResponse, NormalizedListing, SourceConfig,
    SourceHealth, SourceHealthResponse, TriggerScrapeResponse,
    RefurbAppraisal, RefurbAppraisalCreate, RefurbAppraisalUpdate,
)
from app.monitoring.health import start_health_monitor, stop_health_monitor
from app.persistence.database import AsyncSessionLocal, engine, get_db
from app.persistence.database import Base
from app.persistence.repositories import (
    DealReviewRepository, ListingRepository, SourceConfigRepository,
)
from config.settings import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed default sources
    async with AsyncSessionLocal() as db:
        await _seed_default_sources(db)

    # Start health monitor
    await start_health_monitor()

    yield

    await stop_health_monitor()
    await engine.dispose()


async def _seed_default_sources(db: AsyncSession) -> None:
    """Seed all major UK residential property auction house sources."""
    repo = SourceConfigRepository(db)
    defaults = [
        # --- National / High Volume ---
        SourceConfig(
            id="allsop_auction",
            name="Allsop Residential Auctions",
            source_type="auction",
            base_url="https://www.allsop.co.uk",
            schedule_cron="0 7 * * 1,4",
            rate_limit_rpm=10,
        ),
        SourceConfig(
            id="sdl_auctions",
            name="SDL Property Auctions",
            source_type="auction",
            base_url="https://www.sdlauctions.co.uk",
            schedule_cron="0 7 * * 1,4",
            rate_limit_rpm=10,
        ),
        SourceConfig(
            id="auction_house_uk",
            name="Auction House UK",
            source_type="auction",
            base_url="https://www.auctionhouse.co.uk",
            schedule_cron="0 7 * * 1,4",
            rate_limit_rpm=10,
        ),
        # --- Premium / London ---
        SourceConfig(
            id="savills_auctions",
            name="Savills Auctions",
            source_type="auction",
            base_url="https://auctions.savills.co.uk",
            schedule_cron="0 8 * * 2",
            rate_limit_rpm=8,
        ),
        SourceConfig(
            id="barnard_marcus",
            name="Barnard Marcus Auctions",
            source_type="auction",
            base_url="https://www.barnardmarcusauctions.co.uk",
            schedule_cron="0 8 * * 2",
            rate_limit_rpm=8,
        ),
        SourceConfig(
            id="strettons",
            name="Strettons Auctions",
            source_type="auction",
            base_url="https://www.strettons.co.uk",
            schedule_cron="0 8 * * 3",
            rate_limit_rpm=8,
        ),
        SourceConfig(
            id="barnett_ross",
            name="Barnett Ross Auctions",
            source_type="auction",
            base_url="https://www.barnettross.co.uk",
            schedule_cron="0 8 * * 3",
            rate_limit_rpm=8,
        ),
        # --- Regional ---
        SourceConfig(
            id="clive_emson",
            name="Clive Emson Auctioneers",
            source_type="auction",
            base_url="https://www.cliveemson.co.uk",
            schedule_cron="0 7 * * 1,4",
            rate_limit_rpm=10,
        ),
        SourceConfig(
            id="bond_wolfe",
            name="Bond Wolfe Auctions (Midlands)",
            source_type="auction",
            base_url="https://www.bondwolfe.com",
            schedule_cron="0 7 * * 1,4",
            rate_limit_rpm=10,
        ),
        SourceConfig(
            id="mchugh_and_co",
            name="McHugh & Co Auctions",
            source_type="auction",
            base_url="https://www.mchughandco.com",
            schedule_cron="0 8 * * 1,4",
            rate_limit_rpm=8,
        ),
        # --- Online / Modern Method ---
        SourceConfig(
            id="bidx1",
            name="BidX1 Online Auctions",
            source_type="auction",
            base_url="https://www.bidx1.com",
            schedule_cron="0 */6 * * *",
            rate_limit_rpm=12,
        ),
        SourceConfig(
            id="iamsold",
            name="iamsold Modern Method of Auction",
            source_type="auction",
            base_url="https://www.iamsold.co.uk",
            schedule_cron="0 */6 * * *",
            rate_limit_rpm=12,
        ),
    ]
    for config in defaults:
        existing = await repo.get(config.id)
        if not existing:
            await repo.upsert(config)
    await db.commit()


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    app = FastAPI(
        title="UK Property Auction Deal Sourcing Engine",
        description="UK Residential Property Auction Sourcing API — Allsop, SDL, Savills, BidX1, iamsold, EIG",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    app.include_router(listings_router, prefix=settings.api_prefix)
    app.include_router(sources_router, prefix=settings.api_prefix)
    app.include_router(scrape_router, prefix=settings.api_prefix)
    app.include_router(deals_router, prefix=settings.api_prefix)
    app.include_router(appraisals_router, prefix=settings.api_prefix)
    app.include_router(system_router)

    from fastapi.staticfiles import StaticFiles
    from pathlib import Path

    dist_dir = Path(__file__).parent.parent.parent / "frontend" / "dist"
    if dist_dir.exists():
        app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="spa")

    return app


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

async def get_temporal_client() -> Client:
    return await Client.connect(settings.temporal_host, namespace=settings.temporal_namespace)


DbDep = Annotated[AsyncSession, Depends(get_db)]


# ---------------------------------------------------------------------------
# Listings Router
# ---------------------------------------------------------------------------

from fastapi import APIRouter
from pydantic import BaseModel as PydanticBaseModel

listings_router = APIRouter(prefix="/listings", tags=["listings"])
sources_router = APIRouter(prefix="/sources", tags=["sources"])
system_router = APIRouter(tags=["system"])
scrape_router = APIRouter(tags=["scrape"])
deals_router = APIRouter(prefix="/deals", tags=["deals"])
appraisals_router = APIRouter(prefix="/appraisals", tags=["appraisals"])


# ---------------------------------------------------------------------------
# Single-URL scrape models
# ---------------------------------------------------------------------------

class ScrapeUrlRequest(PydanticBaseModel):
    url: str


class ScrapeUrlResponse(PydanticBaseModel):
    listing: NormalizedListing | None = None
    error: str | None = None


@listings_router.get("", response_model=list[ListingResponse])
async def get_latest_listings(
    db: DbDep,
    source_id: str | None = Query(None),
    status: str | None = Query(None),
    postcode_district: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    """Fetch the latest listings with optional filters."""
    repo = ListingRepository(db)
    listings = await repo.get_latest(
        source_id=source_id,
        status=status,
        postcode_district=postcode_district,
        limit=limit,
        offset=offset,
    )
    return listings


@listings_router.get("/changed", response_model=list[ListingChangedResponse])
async def get_changed_listings(
    db: DbDep,
    since_hours: int = Query(24, description="Look back window in hours"),
    limit: int = Query(50, le=200),
):
    """Fetch listings that changed within the specified lookback window."""
    since = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    repo = ListingRepository(db)
    results = await repo.get_changed_since(since, limit=limit)
    return [
        ListingChangedResponse(listing=listing, changes=changes)
        for listing, changes in results
    ]


@listings_router.get("/{listing_id}", response_model=ListingResponse)
async def get_listing(listing_id: uuid.UUID, db: DbDep):
    """Fetch a single listing by ID."""
    repo = ListingRepository(db)
    listing = await repo.get_by_id(listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    return listing


@scrape_router.post("/scrape-url", response_model=ScrapeUrlResponse)
async def scrape_url_endpoint(request: ScrapeUrlRequest):
    """Scrape a single auction listing URL and return a NormalizedListing.

    Launches a Playwright browser, navigates to the URL, extracts property
    data using JSON-LD / __NEXT_DATA__ / HTML heuristics, then normalizes
    the result through the standard parser pipeline.
    """
    from app.adapters.registry import source_id_from_url as _source_id_from_url
    from app.adapters.registry import scrape_single_url as _scrape_single_url
    from app.parsers.parser import parse_raw_listing
    from urllib.parse import urlparse

    source_id = _source_id_from_url(request.url)
    if source_id is None:
        host = urlparse(request.url).hostname or request.url
        host = host.removeprefix("www.")
        return ScrapeUrlResponse(
            listing=None,
            error=f"Unrecognised auction URL: no registered adapter for '{host}'",
        )

    try:
        raw = await _scrape_single_url(request.url, source_id)
    except Exception as exc:
        return ScrapeUrlResponse(
            listing=None,
            error=f"Scraping failed for '{source_id}': {type(exc).__name__}: {exc}",
        )

    if raw is None:
        return ScrapeUrlResponse(
            listing=None,
            error=f"Could not extract property data from this page. The page may require login, may have changed layout, or the lot may no longer be listed.",
        )

    listing = parse_raw_listing(raw)
    if listing is None:
        return ScrapeUrlResponse(
            listing=None,
            error=f"Scraped page but could not parse property details. Raw address: {raw.raw_payload.get('address', 'unknown')}",
        )

    return ScrapeUrlResponse(listing=listing)


# ---------------------------------------------------------------------------
# Sources Router
# ---------------------------------------------------------------------------

@sources_router.post("/{source_id}/scrape", response_model=TriggerScrapeResponse)
async def trigger_scrape(source_id: str, db: DbDep):
    """Trigger an immediate scrape of a source via Temporal workflow."""
    repo = SourceConfigRepository(db)
    config = await repo.get(source_id)
    if config is None:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found")
    if config.health == SourceHealth.UNHEALTHY:
        raise HTTPException(
            status_code=409,
            detail=f"Source '{source_id}' is unhealthy. Mark healthy first.",
        )

    try:
        client = await get_temporal_client()
        workflow_id = f"scrape-{source_id}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        await client.start_workflow(
            "ScrapeSourceWorkflow",
            source_id,
            id=workflow_id,
            task_queue=settings.temporal_task_queue,
        )
        log.info("triggered scrape workflow", source_id=source_id, workflow_id=workflow_id)
        return TriggerScrapeResponse(
            workflow_id=workflow_id,
            source_id=source_id,
            message=f"Scrape workflow started for {source_id}",
        )
    except Exception as exc:
        log.error("failed to start workflow", source_id=source_id, error=str(exc))
        raise HTTPException(status_code=500, detail="Failed to start scrape workflow")


@sources_router.get("", response_model=list[SourceHealthResponse])
async def list_sources(db: DbDep, enabled_only: bool = Query(True)):
    """List all configured sources with health status."""
    repo = SourceConfigRepository(db)
    sources = await repo.get_all(enabled_only=enabled_only)
    return [
        SourceHealthResponse(
            source_id=src.id,
            health=src.health,
            consecutive_errors=src.consecutive_errors,
            last_scrape_at=src.last_scrape_at,
        )
        for src in sources
    ]


@sources_router.post("/{source_id}/health", response_model=SourceHealthResponse)
async def set_source_health(source_id: str, health: SourceHealth, db: DbDep):
    """Manually set the health status of a source."""
    repo = SourceConfigRepository(db)
    config = await repo.get(source_id)
    if config is None:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found")

    await repo.set_health(source_id, health)
    if health == SourceHealth.HEALTHY:
        await repo.reset_errors(source_id)
    await db.commit()

    return SourceHealthResponse(
        source_id=source_id,
        health=health,
        consecutive_errors=0 if health == SourceHealth.HEALTHY else config.consecutive_errors,
        last_scrape_at=config.last_scrape_at,
    )


# ---------------------------------------------------------------------------
# System Router
# ---------------------------------------------------------------------------

@system_router.get("/health")
async def system_health():
    """System health check."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@system_router.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    """Prometheus metrics endpoint."""
    data = generate_latest()
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)


# ---------------------------------------------------------------------------
# Deals Router
# ---------------------------------------------------------------------------

@deals_router.post("", response_model=DealReview, status_code=201)
async def create_deal(body: DealReviewCreate, db: DbDep):
    """Save a reviewed deal with form snapshot and metrics."""
    repo = DealReviewRepository(db)
    deal = await repo.create(body)
    await db.commit()
    return deal


@deals_router.get("", response_model=list[DealReview])
async def list_deals(db: DbDep):
    """List all saved deals sorted by IRR descending."""
    repo = DealReviewRepository(db)
    return await repo.list_all()


@deals_router.get("/{deal_id}", response_model=DealReview)
async def get_deal(deal_id: uuid.UUID, db: DbDep):
    """Fetch a single saved deal by ID."""
    repo = DealReviewRepository(db)
    deal = await repo.get_by_id(deal_id)
    if deal is None:
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal


@deals_router.put("/{deal_id}", response_model=DealReview)
async def update_deal(deal_id: uuid.UUID, body: DealReviewUpdate, db: DbDep):
    """Update an existing saved deal."""
    repo = DealReviewRepository(db)
    deal = await repo.update(deal_id, body)
    if deal is None:
        raise HTTPException(status_code=404, detail="Deal not found")
    await db.commit()
    return deal


@deals_router.delete("/{deal_id}", status_code=204)
async def delete_deal(deal_id: uuid.UUID, db: DbDep):
    """Delete a saved deal."""
    repo = DealReviewRepository(db)
    deleted = await repo.delete(deal_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Deal not found")
    await db.commit()


# ---------------------------------------------------------------------------
# Appraisals Router
# ---------------------------------------------------------------------------

@appraisals_router.post("", response_model=RefurbAppraisal, status_code=201)
async def create_appraisal(body: RefurbAppraisalCreate, db: DbDep):
    """Save a refurb appraisal snapshot."""
    from app.persistence.repositories import RefurbAppraisalRepository
    repo = RefurbAppraisalRepository(db)
    appraisal = await repo.create(body)
    await db.commit()
    return appraisal


@appraisals_router.get("", response_model=list[RefurbAppraisal])
async def list_appraisals(db: DbDep):
    """List all saved appraisals sorted by created_at descending."""
    from app.persistence.repositories import RefurbAppraisalRepository
    repo = RefurbAppraisalRepository(db)
    return await repo.list_all()


@appraisals_router.put("/{appraisal_id}", response_model=RefurbAppraisal)
async def update_appraisal(appraisal_id: uuid.UUID, body: RefurbAppraisalUpdate, db: DbDep):
    """Update an existing appraisal."""
    from app.persistence.repositories import RefurbAppraisalRepository
    repo = RefurbAppraisalRepository(db)
    appraisal = await repo.update(appraisal_id, body)
    if appraisal is None:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    await db.commit()
    return appraisal


@appraisals_router.delete("/{appraisal_id}", status_code=204)
async def delete_appraisal(appraisal_id: uuid.UUID, db: DbDep):
    """Delete a saved appraisal."""
    from app.persistence.repositories import RefurbAppraisalRepository
    repo = RefurbAppraisalRepository(db)
    deleted = await repo.delete(appraisal_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Appraisal not found")
    await db.commit()


# ---------------------------------------------------------------------------
# App instance
# ---------------------------------------------------------------------------

app = create_app()  # noqa
