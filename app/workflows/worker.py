"""Temporal worker process."""
from __future__ import annotations

import asyncio
import signal

import structlog
from temporalio.client import Client
from temporalio.worker import Worker

from app.workflows.scrape_workflow import (
    ScrapeSourceWorkflow,
    ScheduledScrapeWorkflow,
    fetch_source_config,
    run_source_scrape,
    update_source_health,
    _list_enabled_sources,
)
from config.settings import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()


async def run_worker() -> None:
    client = await Client.connect(settings.temporal_host, namespace=settings.temporal_namespace)

    worker = Worker(
        client,
        task_queue=settings.temporal_task_queue,
        workflows=[ScrapeSourceWorkflow, ScheduledScrapeWorkflow],
        activities=[
            fetch_source_config,
            run_source_scrape,
            update_source_health,
            _list_enabled_sources,
        ],
        max_concurrent_activities=settings.scrape_concurrency,
    )

    log.info(
        "temporal worker starting",
        task_queue=settings.temporal_task_queue,
        host=settings.temporal_host,
    )

    stop_event = asyncio.Event()

    def _stop(*_):
        stop_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_event_loop().add_signal_handler(sig, _stop)

    async with worker:
        await stop_event.wait()

    log.info("worker stopped")


if __name__ == "__main__":
    asyncio.run(run_worker())
