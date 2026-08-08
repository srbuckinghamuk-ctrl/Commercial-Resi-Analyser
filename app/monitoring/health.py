"""
Source health monitoring.

Tracks consecutive errors, marks sources as degraded/unhealthy,
and exposes Prometheus metrics.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import structlog
from prometheus_client import Counter, Gauge, Histogram

from app.models import SourceHealth
from config.settings import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()

# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------

scrape_duration_seconds = Histogram(
    "deal_sourcing_scrape_duration_seconds",
    "Time taken per source scrape",
    ["source_id", "status"],
    buckets=[10, 30, 60, 120, 300, 600, 1800],
)

listings_scraped_total = Counter(
    "deal_sourcing_listings_scraped_total",
    "Total listings scraped",
    ["source_id", "outcome"],  # outcome: new, updated, unchanged, error
)

source_health_gauge = Gauge(
    "deal_sourcing_source_health",
    "Source health status (1=healthy, 0.5=degraded, 0=unhealthy)",
    ["source_id"],
)

scrape_errors_total = Counter(
    "deal_sourcing_scrape_errors_total",
    "Total scrape errors",
    ["source_id", "error_type"],
)


def record_scrape_stats(source_id: str, stats: dict, duration_secs: float, success: bool) -> None:
    status = "success" if success else "failed"
    scrape_duration_seconds.labels(source_id=source_id, status=status).observe(duration_secs)

    for outcome in ("new", "updated", "unchanged"):
        count = stats.get(outcome, 0)
        if count:
            listings_scraped_total.labels(source_id=source_id, outcome=outcome).inc(count)

    if stats.get("errors"):
        scrape_errors_total.labels(source_id=source_id, error_type="parse_error").inc(
            stats["errors"]
        )


def update_health_gauge(source_id: str, health: SourceHealth) -> None:
    value_map = {
        SourceHealth.HEALTHY: 1.0,
        SourceHealth.DEGRADED: 0.5,
        SourceHealth.UNHEALTHY: 0.0,
        SourceHealth.PAUSED: 0.0,
    }
    source_health_gauge.labels(source_id=source_id).set(value_map.get(health, 0.0))


class HealthMonitor:
    """Periodically checks source health and pauses unhealthy sources."""

    def __init__(self):
        self._running = False

    async def start(self) -> None:
        self._running = True
        asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._check_all()
            except Exception as exc:
                log.error("health monitor error", error=str(exc))
            await asyncio.sleep(settings.source_health_check_interval_seconds)

    async def _check_all(self) -> None:
        from app.persistence.database import AsyncSessionLocal
        from app.persistence.repositories import SourceConfigRepository

        async with AsyncSessionLocal() as db:
            repo = SourceConfigRepository(db)
            sources = await repo.get_all(enabled_only=False)
            for src in sources:
                # Auto-recover sources that have been paused for > 1 hour
                if (
                    src.health == SourceHealth.UNHEALTHY
                    and src.last_scrape_at
                    and datetime.now(timezone.utc) - src.last_scrape_at > timedelta(hours=1)
                ):
                    await repo.set_health(src.id, SourceHealth.DEGRADED)
                    await repo.reset_errors(src.id)
                    log.info("auto-recovered source to degraded", source_id=src.id)

                update_health_gauge(src.id, src.health)

            await db.commit()


_monitor = HealthMonitor()


async def start_health_monitor() -> None:
    await _monitor.start()


async def stop_health_monitor() -> None:
    await _monitor.stop()
