from __future__ import annotations

import logging
import re

import httpx
from bs4 import BeautifulSoup, Tag

from app.adapters.base import BaseAdapter
from app.adapters.patterns import (
    POSTCODE_RE,
    PRICE_RE,
    SQFT_RE,
    SQM_RE,
    TYPE_TO_USE_CLASS,
    TENURE_MAP,
    sqft_to_sqm,
)
from app.adapters.registry import register_adapter
from app.integrations.http import get_client
from app.models import Address, AuctionInfo, CommercialListing, PriceInfo, Tenure, UseClass

logger = logging.getLogger(__name__)

_LOT_RE = re.compile(r"Lot\s+#?(\d+)", re.IGNORECASE)
_AUCTION_DATE_RE = re.compile(
    r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*"
    r"(\d{1,2}\s+\w+\s+\d{4})",
    re.IGNORECASE,
)


def _text(el: Tag | None) -> str:
    return el.get_text(strip=True) if el else ""


def _parse_detail(soup: BeautifulSoup, label: str) -> str | None:
    for el in soup.find_all(["dt", "th", "strong", "b", "span", "div", "li"]):
        txt = el.get_text(strip=True).rstrip(":")
        if txt.lower() == label.lower():
            sibling = el.find_next(["dd", "td", "span", "div", "p"])
            if sibling:
                return sibling.get_text(strip=True)
    for el in soup.find_all(string=re.compile(rf"^\s*{re.escape(label)}\s*:", re.IGNORECASE)):
        parent = el.parent
        if parent:
            full = parent.get_text(strip=True)
            parts = full.split(":", 1)
            if len(parts) == 2 and parts[1].strip():
                return parts[1].strip()
    return None


def _parse_listing(html: str, url: str) -> CommercialListing | None:
    soup = BeautifulSoup(html, "lxml")

    address_raw = ""
    title_el = soup.find("title")
    if title_el:
        title_text = _text(title_el)
        if "|" in title_text:
            address_raw = title_text.split("|", 1)[1].strip()
        else:
            address_raw = title_text

    if not address_raw or not POSTCODE_RE.search(address_raw):
        h1 = soup.find("h1")
        h1_text = _text(h1)
        if h1_text and POSTCODE_RE.search(h1_text):
            address_raw = h1_text

    if not address_raw:
        return None

    postcode_match = POSTCODE_RE.search(address_raw)
    postcode = postcode_match.group(0).strip().upper() if postcode_match else None

    price_pence = 0
    price_qualifier: str | None = None
    page_text = soup.get_text()

    guide_match = re.search(r"Guide\s+[Pp]rice\s+£([\d,]+)", page_text)
    if guide_match:
        price_pence = int(guide_match.group(1).replace(",", "")) * 100
        price_qualifier = "Guide Price"
    else:
        price_match = PRICE_RE.search(page_text)
        if price_match:
            price_pence = int(price_match.group(1).replace(",", "")) * 100

    lot_number: str | None = None
    breadcrumb_text = ""
    for nav in soup.find_all(["nav", "ol", "ul"]):
        txt = nav.get_text()
        if "Lot" in txt:
            breadcrumb_text = txt
            break
    lot_match = _LOT_RE.search(breadcrumb_text) or _LOT_RE.search(page_text)
    if lot_match:
        lot_number = lot_match.group(1)

    auction_date: str | None = None
    date_match = _AUCTION_DATE_RE.search(page_text)
    if date_match:
        auction_date = date_match.group(1).strip()

    tenure_text = _parse_detail(soup, "Tenure") or ""
    tenure = Tenure.UNKNOWN
    for keyword, t in TENURE_MAP.items():
        if keyword in tenure_text.lower():
            tenure = t
            break

    use_class = UseClass.UNKNOWN
    type_text = _parse_detail(soup, "Property Type") or _parse_detail(soup, "Type") or ""
    for keyword, uc in TYPE_TO_USE_CLASS.items():
        if keyword in type_text.lower():
            use_class = uc
            break
    if use_class == UseClass.UNKNOWN:
        for keyword, uc in TYPE_TO_USE_CLASS.items():
            if keyword in page_text.lower():
                use_class = uc
                break

    floor_area_sqft: float | None = None
    floor_area_sqm_direct: float | None = None
    area_text = _parse_detail(soup, "Total GIA") or _parse_detail(soup, "Floor Area") or ""
    sqft_match = SQFT_RE.search(area_text.replace(",", ""))
    if not sqft_match:
        sqft_match = SQFT_RE.search(page_text.replace(",", ""))
    if sqft_match:
        try:
            floor_area_sqft = float(sqft_match.group(1).replace(",", ""))
        except ValueError:
            pass
    else:
        sqm_match = SQM_RE.search(area_text.replace(",", ""))
        if not sqm_match:
            sqm_match = SQM_RE.search(page_text.replace(",", ""))
        if sqm_match:
            try:
                floor_area_sqm_direct = round(float(sqm_match.group(1).replace(",", "")), 1)
            except ValueError:
                pass

    is_vacant: bool | None = None
    tenancy_text = _parse_detail(soup, "Tenancy") or ""
    if "vacant" in tenancy_text.lower() or "vacant" in page_text.lower():
        is_vacant = True

    description: str | None = None
    desc_el = soup.find(class_=re.compile(r"description", re.IGNORECASE))
    if desc_el:
        description = desc_el.get_text(strip=True) or None
    if not description:
        for p in soup.find_all("p"):
            txt = p.get_text(strip=True)
            if len(txt) > 60 and postcode and postcode.split()[0] not in txt[:20]:
                description = txt
                break

    key_features: list[str] = []
    for li in soup.find_all("li"):
        txt = li.get_text(strip=True)
        if 10 < len(txt) < 200 and not any(
            skip in txt.lower() for skip in ["login", "menu", "cookie", "auction calendar"]
        ):
            key_features.append(txt)
    if key_features and not description:
        description = " | ".join(key_features[:5])

    image_urls: list[str] = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if isinstance(src, str) and src.startswith("http") and "savills" in src.lower():
            if "logo" not in src.lower() and "svg" not in src.lower():
                image_urls.append(src)

    floor_area_sqm = floor_area_sqm_direct or sqft_to_sqm(floor_area_sqft)

    return CommercialListing(
        address=Address(raw=address_raw, postcode=postcode),
        price=PriceInfo(amount=price_pence, qualifier=price_qualifier),
        use_class=use_class,
        floor_area_sqft=floor_area_sqft,
        floor_area_sqm=floor_area_sqm,
        tenure=tenure,
        is_vacant=is_vacant,
        source_url=url,
        source_name="Savills Auctions",
        auction=AuctionInfo(
            house="Savills",
            lot_number=lot_number,
            date=auction_date,
        ),
        image_urls=image_urls,
        description=description,
    )


class SavillsAdapter(BaseAdapter):
    async def fetch_listing(self, url: str) -> CommercialListing | None:
        try:
            resp = await get_client().get(url, timeout=15.0)
            if resp.status_code != 200:
                logger.warning("Savills fetch for %s returned HTTP %s", url, resp.status_code)
                return None
            return _parse_listing(resp.text, url)
        except httpx.HTTPError as exc:
            logger.warning("Savills fetch failed for %s: %s", url, exc)
            return None


register_adapter("savills", SavillsAdapter, ["auctions.savills.co.uk"])
