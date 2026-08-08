"""
Temporal workflows and activities for scheduled scraping.

Workflows:
  - ScrapeSourceWorkflow: Scrape a single source end-to-end with retries
  - ScheduledScrapeWorkflow: Orchestrate all enabled sources on a schedule

Activities:
  - fetch_source_config
  - run_source_scrape
  - update_source_health
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from temporalio import activity, workflow
from temporalio.common import RetryPolicy

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Activity inputs / outputs (plain dicts for serialisation)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------

@activity.defn(name="fetch_source_config")
async def fetch_source_config(source_id: str) -> dict:
    """Load source configuration from database."""
    from app.persistence.database import AsyncSessionLocal
    from app.persistence.repositories import SourceConfigRepository

    async with AsyncSessionLocal() as db:
        repo = SourceConfigRepository(db)
        config = await repo.get(source_id)
        if config is None:
            raise ValueError(f"Source '{source_id}' not found")
        return config.model_dump()


@activity.defn(name="run_source_scrape")
async def run_source_scrape(source_id: str, session_id: str) -> dict:
    """
    Execute the full scrape pipeline for a source.
    Returns session stats dict.
    """
    from app.models import ScrapeStatus, SourceConfig
    from app.adapters.registry import get_adapter
    from app.parsers.parser import parse_raw_listing
    from app.normalizers.change_detection import detect_changes
    from app.persistence.database import AsyncSessionLocal
    from app.persistence.repositories import ListingRepository, ScrapeSessionRepository

    async with AsyncSessionLocal() as db:
        session_repo = ScrapeSessionRepository(db)
        listing_repo = ListingRepository(db)
        source_repo = __import__(
            "app.persistence.repositories", fromlist=["SourceConfigRepository"]
        ).SourceConfigRepository(db)

        config_dict = await fetch_source_config(source_id)
        config = SourceConfig(**config_dict)

        # Mark session as running
        session = await session_repo.create(source_id, workflow.info().workflow_id if workflow.in_workflow() else None)
        session.status = ScrapeStatus.RUNNING
        session.started_at = datetime.now(timezone.utc)
        await session_repo.update(session)
        await db.commit()

        stats = {"new": 0, "updated": 0, "unchanged": 0, "errors": 0, "found": 0}

        try:
            adapter = get_adapter(config)
            async with adapter:
                async for raw in adapter.iter_raw_listings():
                    stats["found"] += 1
                    normalized = parse_raw_listing(raw)
                    if normalized is None:
                        stats["errors"] += 1
                        continue

                    old_snapshot, updated, is_new = await listing_repo.upsert(normalized, raw.raw_payload)

                    if is_new:
                        stats["new"] += 1
                    else:
                        changes = detect_changes(old_snapshot, normalized)
                        if changes:
                            stats["updated"] += 1
                            await listing_repo.record_changes(changes)
                            await listing_repo.mark_last_changed(updated.id, datetime.now(timezone.utc))
                        else:
                            stats["unchanged"] += 1

                    # Commit every 50 listings
                    if stats["found"] % 50 == 0:
                        await db.commit()

            session.status = ScrapeStatus.SUCCESS
            await source_repo.reset_errors(source_id)

        except Exception as exc:
            session.status = ScrapeStatus.FAILED
            session.error_message = str(exc)[:1000]
            await session_repo.log_error(
                session_id=session.id,
                source_id=source_id,
                error_type=type(exc).__name__,
                error_message=str(exc),
            )
            error_count = await source_repo.increment_error(source_id)
            from config.settings import get_settings
            settings = get_settings()
            if error_count >= settings.source_unhealthy_error_threshold:
                from app.models import SourceHealth
                await source_repo.set_health(source_id, SourceHealth.UNHEALTHY)
            stats["errors"] += 1

        finally:
            session.finished_at = datetime.now(timezone.utc)
            session.listings_found = stats["found"]
            session.listings_new = stats["new"]
            session.listings_updated = stats["updated"]
            session.listings_unchanged = stats["unchanged"]
            await session_repo.update(session)
            await db.commit()

    return stats


@activity.defn(name="update_source_health")
async def update_source_health(source_id: str, health: str) -> None:
    from app.persistence.database import AsyncSessionLocal
    from app.persistence.repositories import SourceConfigRepository
    from app.models import SourceHealth

    async with AsyncSessionLocal() as db:
        repo = SourceConfigRepository(db)
        await repo.set_health(source_id, SourceHealth(health))
        await db.commit()


# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------

@workflow.defn(name="ScrapeSourceWorkflow")
class ScrapeSourceWorkflow:
    """
    Scrape a single source with full retry semantics.
    """

    @workflow.run
    async def run(self, source_id: str) -> dict:
        workflow.logger.info("starting scrape", source_id=source_id)

        session_id = str(uuid.uuid4())

        result = await workflow.execute_activity(
            run_source_scrape,
            args=[source_id, session_id],
            start_to_close_timeout=timedelta(hours=2),
            retry_policy=RetryPolicy(
                maximum_attempts=3,
                initial_interval=timedelta(minutes=1),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(minutes=30),
            ),
        )

        workflow.logger.info("scrape complete", source_id=source_id, stats=result)
        return result


@workflow.defn(name="ScheduledScrapeWorkflow")
class ScheduledScrapeWorkflow:
    """
    Orchestrate scraping of all enabled sources.
    Runs on a schedule via Temporal Schedules.
    """

    @workflow.run
    async def run(self) -> dict[str, Any]:
        from temporalio.client import Client

        # Fetch enabled sources
        enabled_sources = await workflow.execute_activity(
            _list_enabled_sources,
            start_to_close_timeout=timedelta(minutes=1),
        )

        results = {}
        for source_id in enabled_sources:
            child_handle = await workflow.start_child_workflow(
                ScrapeSourceWorkflow,
                args=[source_id],
                id=f"scrape-{source_id}-{workflow.now().strftime('%Y%m%d%H%M')}",
                task_queue="deal-sourcing-tasks",
            )
            try:
                result = await child_handle
                results[source_id] = result
            except Exception as exc:
                results[source_id] = {"error": str(exc)}

        return results


@activity.defn(name="list_enabled_sources")
async def _list_enabled_sources() -> list[str]:
    from app.persistence.database import AsyncSessionLocal
    from app.persistence.repositories import SourceConfigRepository

    async with AsyncSessionLocal() as db:
        repo = SourceConfigRepository(db)
        configs = await repo.get_all(enabled_only=True)
        return [c.id for c in configs]
