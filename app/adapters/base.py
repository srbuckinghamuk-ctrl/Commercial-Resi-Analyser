"""
Base scraper adapter.

All source adapters inherit from BaseAdapter.
Provides:
  - Rate limiting (token-bucket style per source)
  - Polite delays between requests
  - Playwright browser lifecycle
  - Retry logic via tenacity
  - Structured logging
"""
from __future__ import annotations

import asyncio
import json
import random
import re
import time
from abc import ABC, abstractmethod
from typing import AsyncIterator

import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.models import RawListing, SourceConfig
from config.settings import get_settings

log = structlog.get_logger(__name__)
settings = get_settings()


class RateLimiter:
    """Simple token-bucket rate limiter."""

    def __init__(self, requests_per_minute: int):
        self.rpm = requests_per_minute
        self._interval = 60.0 / max(requests_per_minute, 1)
        self._last_request = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            sleep_for = self._interval - (now - self._last_request)
            if sleep_for > 0:
                await asyncio.sleep(sleep_for)
            self._last_request = time.monotonic()


class BaseAdapter(ABC):
    """
    Abstract base class for all source adapters.

    Subclasses must implement:
      - scrape_listings_page(page, url) → list[RawListing]
      - get_listing_urls(page) → list[str]   (pagination)
    """

    def __init__(self, config: SourceConfig):
        self.config = config
        self.source_id = config.id
        self._rate_limiter = RateLimiter(config.rate_limit_rpm)
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self.logger = log.bind(source_id=self.source_id)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "BaseAdapter":
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=settings.playwright_headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        self._context = await self._browser.new_context(
            user_agent=settings.playwright_user_agent,
            locale="en-GB",
            timezone_id="Europe/London",
            viewport={"width": 1280, "height": 900},
        )
        # Block images/fonts for speed, except on image listing detail pages
        await self._context.route(
            "**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,otf}",
            lambda route: route.abort()
            if not self._should_load_media(route.request.url)
            else route.continue_(),
        )
        return self

    async def __aexit__(self, *args) -> None:
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()

    def _should_load_media(self, url: str) -> bool:
        """Override to allow media on specific pages."""
        return False

    # ------------------------------------------------------------------
    # Polite navigation
    # ------------------------------------------------------------------

    async def navigate(self, page: Page, url: str) -> None:
        """Navigate with rate limiting + polite delay."""
        await self._rate_limiter.acquire()

        delay = random.uniform(
            self.config.scrape_delay_min,
            self.config.scrape_delay_max,
        )
        await asyncio.sleep(delay)

        self.logger.debug("navigating", url=url)
        await page.goto(url, timeout=settings.playwright_timeout_ms, wait_until="domcontentloaded")

    async def new_page(self) -> Page:
        assert self._context is not None, "Adapter not started"
        page = await self._context.new_page()
        page.set_default_timeout(settings.playwright_timeout_ms)
        return page

    # ------------------------------------------------------------------
    # Retry wrapper
    # ------------------------------------------------------------------

    async def fetch_with_retry(self, url: str) -> Page:
        """Create a page, navigate to URL with retries."""
        page = await self.new_page()
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(settings.max_retries),
            wait=wait_exponential(multiplier=1, min=4, max=60),
            retry=retry_if_exception_type(Exception),
            reraise=True,
        ):
            with attempt:
                await self.navigate(page, url)
        return page

    # ------------------------------------------------------------------
    # Abstract interface
    # ------------------------------------------------------------------

    @abstractmethod
    async def iter_raw_listings(self) -> AsyncIterator[RawListing]:
        """
        Yield RawListing objects from the source.
        Handles pagination internally.
        """
        ...

    # ------------------------------------------------------------------
    # Single-URL scraping (detail page)
    # ------------------------------------------------------------------

    async def scrape_single_url(self, url: str) -> RawListing | None:
        """Scrape a single lot/property detail page and return a RawListing.

        Uses httpx (no browser required) with a layered extraction strategy:
          1. JSON-LD structured data
          2. __NEXT_DATA__ (Next.js sites)
          3. Open Graph / meta tags
          4. Common CSS selectors for property pages
        Subclasses can override for source-specific extraction.
        """
        import httpx

        headers = {
            "User-Agent": settings.playwright_user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
        }
        try:
            async with httpx.AsyncClient(
                follow_redirects=True, timeout=20.0, headers=headers,
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                html = resp.text
            return self._extract_detail_page(html, url)
        except Exception as exc:
            self.logger.error("single_url_scrape_failed", url=url, error=str(exc))
            return None

    def _extract_detail_page(self, html: str, url: str) -> RawListing | None:
        """Extract property data from a detail page using multiple strategies."""
        soup = BeautifulSoup(html, "lxml")

        # Strategy 1: JSON-LD
        raw = self._extract_from_jsonld(soup, url)
        if raw:
            return raw

        # Strategy 2: __NEXT_DATA__
        raw = self._extract_from_next_data(soup, url)
        if raw:
            return raw

        # Strategy 3: Meta tags + HTML selectors
        return self._extract_from_html(soup, url)

    def _extract_from_jsonld(self, soup: BeautifulSoup, url: str) -> RawListing | None:
        """Extract from JSON-LD structured data."""
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
                items = data if isinstance(data, list) else [data]
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    item_type = item.get("@type", "")
                    if item_type in (
                        "Product", "RealEstateListing", "Residence",
                        "Apartment", "House", "SingleFamilyResidence",
                    ) or "address" in item or "name" in item:
                        return self._jsonld_to_raw(item, url)
            except (json.JSONDecodeError, AttributeError):
                continue
        return None

    def _jsonld_to_raw(self, item: dict, url: str) -> RawListing | None:
        """Convert a JSON-LD item to a RawListing."""
        address = item.get("address", {})
        if isinstance(address, dict):
            addr_str = ", ".join(filter(None, [
                address.get("streetAddress"),
                address.get("addressLocality"),
                address.get("addressRegion"),
                address.get("postalCode"),
            ]))
        else:
            addr_str = str(address)

        if not addr_str:
            addr_str = item.get("name", "")
        if not addr_str:
            return None

        price = None
        offers = item.get("offers")
        if isinstance(offers, dict):
            price = offers.get("price") or offers.get("lowPrice")
        elif isinstance(offers, list) and offers:
            price = offers[0].get("price") if isinstance(offers[0], dict) else None

        images = item.get("image", [])
        if isinstance(images, str):
            images = [images]
        elif isinstance(images, list):
            images = [
                (img.get("url") or img) if isinstance(img, dict) else img
                for img in images
            ]
        image_urls = [u for u in images if isinstance(u, str) and u]

        return RawListing(
            source_id=self.source_id,
            source_type=self.source_type,
            source_url=url,
            external_id=item.get("identifier") or item.get("sku"),
            raw_payload={
                "address": addr_str,
                "guide_price": price,
                "description": item.get("description", ""),
                "image_urls": image_urls,
                "auction_house": self.config.name,
                "online_bidding": True,
            },
        )

    def _extract_from_next_data(self, soup: BeautifulSoup, url: str) -> RawListing | None:
        """Extract from __NEXT_DATA__ JSON blob (Next.js sites)."""
        tag = soup.find("script", id="__NEXT_DATA__")
        if not tag:
            return None
        try:
            nd = json.loads(tag.string or "")
            props = nd.get("props", {}).get("pageProps", {})
            # Look for property/lot data in common shapes
            for key in ("lot", "property", "listing", "item", "data"):
                obj = props.get(key)
                if isinstance(obj, dict) and (obj.get("address") or obj.get("title") or obj.get("name")):
                    return self._next_data_obj_to_raw(obj, url)
            # Try top-level props if they look like property data
            if props.get("address") or props.get("title"):
                return self._next_data_obj_to_raw(props, url)
        except (json.JSONDecodeError, AttributeError):
            pass
        return None

    def _next_data_obj_to_raw(self, obj: dict, url: str) -> RawListing | None:
        """Convert a Next.js data object to a RawListing."""
        address = obj.get("address") or obj.get("propertyAddress") or obj.get("title") or obj.get("name") or ""
        if not address:
            return None

        images = obj.get("images") or obj.get("photos") or obj.get("gallery") or []
        image_urls = []
        for img in (images if isinstance(images, list) else []):
            if isinstance(img, str):
                image_urls.append(img)
            elif isinstance(img, dict):
                image_urls.append(img.get("url") or img.get("src") or "")
        image_urls = [u for u in image_urls if u]

        auction_date = obj.get("auctionDate") or obj.get("date")
        if auction_date:
            try:
                from dateutil import parser as dateutil_parser
                auction_date = dateutil_parser.parse(str(auction_date), dayfirst=True).isoformat()
            except Exception:
                auction_date = None

        return RawListing(
            source_id=self.source_id,
            source_type=self.source_type,
            source_url=url,
            external_id=str(obj.get("id") or obj.get("lotNumber") or obj.get("ref") or ""),
            raw_payload={
                "address": address,
                "guide_price": obj.get("guidePrice") or obj.get("price") or obj.get("guide"),
                "description": str(obj.get("description") or obj.get("summary") or "")[:5000],
                "lot_number": str(obj.get("lotNumber") or obj.get("lot") or ""),
                "tenure": obj.get("tenure"),
                "bedrooms": obj.get("bedrooms") or obj.get("beds"),
                "bathrooms": obj.get("bathrooms") or obj.get("baths"),
                "floor_area": obj.get("floorArea") or obj.get("size"),
                "image_urls": image_urls,
                "auction_house": self.config.name,
                "auction_date": auction_date,
                "online_bidding": obj.get("onlineBidding", True),
            },
        )

    # Words that indicate an h1/h2 is NOT a property address
    _SKIP_HEADING_WORDS = re.compile(
        r"login|sign.?in|register|menu|cookie|accept|contact|search|"
        r"local information|legal documents|key features",
        re.IGNORECASE,
    )

    def _clean_title_address(self, title: str) -> str:
        """Strip common site-name prefixes/suffixes from <title> to get the address."""
        # "Savills Property Auctions | 16D Cambridge Gardens..." → "16D Cambridge Gardens..."
        # "16D Cambridge ... - Allsop" → "16D Cambridge ..."
        for sep in [" | ", " - ", " – ", " — ", " :: "]:
            if sep in title:
                parts = title.split(sep)
                # The address is usually the part with a postcode or the longest part
                best = max(parts, key=lambda p: (bool(re.search(r"[A-Z]{1,2}\d", p)), len(p)))
                return best.strip()
        return title.strip()

    def _extract_from_html(self, soup: BeautifulSoup, url: str) -> RawListing | None:
        """Extract from HTML using meta tags and common CSS selectors."""
        # ── Address ──
        # Priority: og:title → <title> → specific selectors → h1 (filtered)
        address = None

        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            address = self._clean_title_address(og_title["content"])

        if not address:
            title_tag = soup.find("title")
            if title_tag:
                candidate = self._clean_title_address(title_tag.get_text(strip=True))
                # Only use if it looks like an address (has letters + numbers or postcode)
                if re.search(r"[A-Z]{1,2}\d|^\d+\s+\w", candidate, re.IGNORECASE):
                    address = candidate

        if not address:
            for sel in [
                "[class*='address']", "[class*='lot-title']",
                "[class*='property-title']", "[data-testid*='address']",
            ]:
                el = soup.select_one(sel)
                if el and el.get_text(strip=True):
                    address = el.get_text(strip=True)
                    break

        if not address:
            for h1 in soup.find_all("h1"):
                text = h1.get_text(strip=True)
                if text and not self._SKIP_HEADING_WORDS.search(text):
                    address = text
                    break

        if not address:
            return None

        # ── Guide price ──
        guide_price = None
        for sel in [
            ".sv-property-price__value",  # Savills
            "[class*='guide-price']", "[class*='price__value']",
            "[class*='lot-price']", "[data-testid*='price']",
        ]:
            el = soup.select_one(sel)
            if el:
                text = el.get_text(strip=True)
                if text and text.upper() != "TBA" and ("£" in text or re.search(r"\d", text)):
                    guide_price = text
                    break

        # Broader price fallback — only short text with £ sign
        if not guide_price:
            for el in soup.select("[class*='price']"):
                text = el.get_text(strip=True)
                if text and "£" in text and len(text) < 30:
                    guide_price = text
                    break

        # Also try to extract from page text
        if not guide_price:
            page_text = soup.get_text()
            price_match = re.search(r"guide\s*price[:\s]*£([\d,]+)", page_text, re.IGNORECASE)
            if price_match:
                guide_price = "£" + price_match.group(1)

        # ── Lot number ──
        lot_number = None
        for sel in [
            "[class*='lot-number']", "[class*='lot-no']",
            "[class*='lotno']", "[data-lot]",
        ]:
            el = soup.select_one(sel)
            if el:
                lot_number = el.get_text(strip=True)
                break
        if not lot_number:
            page_text_for_lot = soup.get_text()
            m = re.search(r"\bLot\s*#?\s*(\d+)\b", page_text_for_lot, re.IGNORECASE)
            if m:
                lot_number = m.group(1)

        # ── Description ──
        description = None
        og_desc = soup.find("meta", property="og:description")
        if og_desc and og_desc.get("content"):
            description = og_desc["content"]
        if not description:
            meta_desc = soup.find("meta", attrs={"name": "description"})
            if meta_desc and meta_desc.get("content"):
                description = meta_desc["content"]
        if not description:
            for sel in [
                "[class*='description']", "[class*='lot-desc']",
                "[class*='property-desc']", ".summary",
                "[class*='accordion-container']",
            ]:
                el = soup.select_one(sel)
                if el and el.get_text(strip=True):
                    description = el.get_text(separator=" ", strip=True)[:5000]
                    break

        # ── Key features (common on auction sites) ──
        features_text = ""
        kf_heading = soup.find(
            ["h2", "h3"], string=lambda s: s and "key feature" in s.lower() if s else False,
        )
        if kf_heading:
            parent = kf_heading.find_parent("div") or kf_heading.find_parent("section") or kf_heading.find_parent()
            if parent:
                features = [li.get_text(strip=True) for li in parent.find_all("li")]
                features_text = "; ".join(features)
        # Merge features into description
        if features_text:
            description = f"{features_text}. {description}" if description else features_text

        # ── Images ──
        image_urls = []
        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            image_urls.append(og_image["content"])
        for img in soup.select(
            "[class*='gallery'] img, [class*='carousel'] img, "
            "[class*='slider'] img, [class*='lot'] img, "
            "[class*='image-bar'] img, .property-images img, main img"
        ):
            src = img.get("src") or img.get("data-src") or ""
            if src and "logo" not in src.lower() and "icon" not in src.lower():
                if src not in image_urls:
                    image_urls.append(src)
        image_urls = image_urls[:20]

        # ── Auction date ──
        auction_date = None
        # Try specific auction date selectors first
        for sel in [
            "[class*='auction-date']", "[class*='lot-details-controls--top-left']",
            "[class*='date']", "time",
        ]:
            el = soup.select_one(sel)
            if el:
                raw_date = el.get("datetime") or el.get_text(strip=True)
                # Extract date-like substring from the text
                date_match = re.search(r"\d{1,2}\s+\w+\s+\d{4}", raw_date)
                if date_match:
                    raw_date = date_match.group()
                try:
                    from dateutil import parser as dateutil_parser
                    auction_date = dateutil_parser.parse(raw_date, dayfirst=True).isoformat()
                    break
                except Exception:
                    pass

        # ── Tenure ──
        tenure = None
        page_text = soup.get_text()
        tenure_match = re.search(r"\b(freehold|leasehold|share of freehold)\b", page_text, re.IGNORECASE)
        if tenure_match:
            tenure = tenure_match.group(1)

        # ── Bedrooms ──
        bedrooms = None
        bed_match = re.search(r"(\d+)\s*(?:bed(?:room)?s?)\b", page_text, re.IGNORECASE)
        if bed_match:
            bedrooms = int(bed_match.group(1))
        # Also check key features for "X bedroom"
        if not bedrooms and features_text:
            bed_feat = re.search(r"(\w+)\s*bed(?:room)?", features_text, re.IGNORECASE)
            if bed_feat:
                word_to_num = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
                val = bed_feat.group(1).lower()
                bedrooms = word_to_num.get(val) or (int(val) if val.isdigit() else None)

        # ── Floor area ──
        floor_area = None
        area_match = re.search(r"([\d,]+)\s*(?:sq\s*ft|sqft|sq\.?\s*feet)", page_text, re.IGNORECASE)
        if area_match:
            floor_area = area_match.group(0)
        else:
            area_match = re.search(r"([\d,]+)\s*(?:sq\s*m|sqm|m²)", page_text, re.IGNORECASE)
            if area_match:
                floor_area = area_match.group(0)

        return RawListing(
            source_id=self.source_id,
            source_type=self.source_type,
            source_url=url,
            external_id=lot_number,
            raw_payload={
                "address": address,
                "guide_price": guide_price,
                "lot_number": lot_number,
                "description": description,
                "tenure": tenure,
                "bedrooms": bedrooms,
                "floor_area": floor_area,
                "image_urls": image_urls,
                "auction_house": self.config.name,
                "auction_date": auction_date,
                "online_bidding": True,
            },
        )

    @property
    @abstractmethod
    def source_type(self) -> str:
        ...
