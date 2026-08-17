from __future__ import annotations

import logging
import re

import httpx
from bs4 import BeautifulSoup

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

_LOT_RE = re.compile(r"(?:lot\s*(?:number)?:?\s*)(\d+)", re.IGNORECASE)


def _parse_listing(html: str, url: str) -> CommercialListing | None:
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    if not h1:
        return None
    address_raw = h1.get_text(strip=True)
    if not address_raw:
        return None

    postcode_match = POSTCODE_RE.search(address_raw)
    postcode = postcode_match.group(0).strip().upper() if postcode_match else None

    price_pence = 0
    price_qualifier: str | None = None
    price_el = soup.find(class_=re.compile(r"price-value|guide-price|lot-price", re.IGNORECASE))
    if price_el:
        price_text = price_el.get_text()
        match = PRICE_RE.search(price_text)
        if match:
            price_pence = int(match.group(1).replace(",", "")) * 100
    if price_pence == 0:
        for el in soup.find_all(["div", "span"]):
            txt = el.get_text()
            match = PRICE_RE.search(txt)
            if match:
                price_pence = int(match.group(1).replace(",", "")) * 100
                break

    label_el = soup.find(class_=re.compile(r"price-label", re.IGNORECASE))
    if label_el:
        qualifier_text = label_el.get_text(strip=True).rstrip("*")
        if qualifier_text:
            price_qualifier = qualifier_text

    lot_number: str | None = None
    for el in soup.find_all(["span", "div"]):
        txt = el.get_text(strip=True)
        if el.find_previous(string=re.compile(r"lot\s*number", re.IGNORECASE)):
            try:
                lot_number = str(int(txt))
                break
            except ValueError:
                pass
        lot_match = _LOT_RE.search(txt)
        if lot_match:
            lot_number = lot_match.group(1)
            break
    if lot_number is None:
        for el in soup.find_all(class_=re.compile(r"detail-value")):
            prev_label = el.find_previous(class_=re.compile(r"detail-label"))
            if prev_label and "lot" in prev_label.get_text(strip=True).lower():
                lot_number = el.get_text(strip=True)
                break

    auction_date: str | None = None
    date_el = soup.find(class_=re.compile(r"auction.?date", re.IGNORECASE))
    if date_el:
        auction_date = date_el.get_text(strip=True)

    use_class = UseClass.UNKNOWN
    tenure = Tenure.UNKNOWN
    floor_area_sqft: float | None = None
    floor_area_sqm_direct: float | None = None

    for el in soup.find_all(class_=re.compile(r"detail-value")):
        txt = el.get_text(strip=True)
        prev_label = el.find_previous(class_=re.compile(r"detail-label"))
        label_txt = prev_label.get_text(strip=True).lower() if prev_label else ""

        if "type" in label_txt and use_class == UseClass.UNKNOWN:
            for keyword, uc in TYPE_TO_USE_CLASS.items():
                if keyword in txt.lower():
                    use_class = uc
                    break

        if "tenure" in label_txt and tenure == Tenure.UNKNOWN:
            for keyword, t in TENURE_MAP.items():
                if keyword in txt.lower():
                    tenure = t
                    break

        if "area" in label_txt and floor_area_sqft is None:
            sqft_match = SQFT_RE.search(txt.replace(",", ""))
            if sqft_match:
                try:
                    floor_area_sqft = float(sqft_match.group(1).replace(",", ""))
                except ValueError:
                    pass
            else:
                sqm_match = SQM_RE.search(txt.replace(",", ""))
                if sqm_match:
                    try:
                        floor_area_sqm_direct = round(float(sqm_match.group(1).replace(",", "")), 1)
                    except ValueError:
                        pass

    description: str | None = None
    desc_el = soup.find(class_=re.compile(r"description", re.IGNORECASE))
    if desc_el:
    # The description container holds block children (a heading, then one or more
    # paragraphs). `get_text(strip=True)` joins every descendant with NO
    # separator, so <h3>Description</h3><p>The property...</p> comes out as
    # "DescriptionThe property..." -- which is exactly the string the second
    # lender-readiness audit found printed in the exported memorandum and
    # attributed to the report. The report was faithfully printing what was
    # stored; the gluing happened here, at scrape time.
        description = desc_el.get_text(" ", strip=True) or None

    image_urls: list[str] = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if src.startswith("http") and "allsop" in src:
            image_urls.append(src)

    floor_area_sqm = floor_area_sqm_direct or sqft_to_sqm(floor_area_sqft)

    return CommercialListing(
        address=Address(raw=address_raw, postcode=postcode),
        price=PriceInfo(amount=price_pence, qualifier=price_qualifier),
        use_class=use_class,
        floor_area_sqft=floor_area_sqft,
        floor_area_sqm=floor_area_sqm,
        tenure=tenure,
        source_url=url,
        source_name="Allsop",
        auction=AuctionInfo(
            house="Allsop",
            lot_number=lot_number,
            date=auction_date,
        ),
        image_urls=image_urls,
        description=description,
    )


class AllsopAdapter(BaseAdapter):
    async def fetch_listing(self, url: str) -> CommercialListing | None:
        try:
            resp = await get_client().get(url, timeout=15.0)
            if resp.status_code != 200:
                logger.warning("Allsop fetch for %s returned HTTP %s", url, resp.status_code)
                return None
            return _parse_listing(resp.text, url)
        except httpx.HTTPError as exc:
            logger.warning("Allsop fetch failed for %s: %s", url, exc)
            return None


register_adapter("allsop", AllsopAdapter, ["allsop.co.uk"])
