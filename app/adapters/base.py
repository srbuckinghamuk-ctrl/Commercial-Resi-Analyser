"""
Base adapter interface for commercial-listing data sources.

Legacy residential scraping machinery (Playwright browser lifecycle, rate
limiting, JSON-LD/HTML extraction, etc.) has been removed as part of the
conversion to a commercial property appraisal tool. This stub retains a
minimal abstract contract so future source adapters have a common shape.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.models import CommercialListing


class BaseAdapter(ABC):
    """Abstract base class for commercial-listing source adapters."""

    @abstractmethod
    async def fetch_listing(self, url: str) -> CommercialListing | None:
        """Fetch and parse a single listing from the given URL."""
        ...
