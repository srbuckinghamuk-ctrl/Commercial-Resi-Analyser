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
from app.models import Address, CommercialListing, PriceInfo, Tenure, UseClass

logger = logging.getLogger(__name__)


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
    for el in soup.find_all(["span", "div"], class_=re.compile(r"price", re.IGNORECASE)):
        txt = el.get_text()
        match = PRICE_RE.search(txt)
        if match:
            price_pence = int(match.group(1).replace(",", "")) * 100
            break

    use_class = UseClass.UNKNOWN
    tenure = Tenure.UNKNOWN
    floor_area_sqft: float | None = None
    floor_area_sqm_direct: float | None = None
    epc_rating: str | None = None

    for li in soup.find_all("li"):
        txt = li.get_text(strip=True)
        lower = txt.lower()

        if "type:" in lower and use_class == UseClass.UNKNOWN:
            value = txt.split(":", 1)[-1].strip()
            for keyword, uc in TYPE_TO_USE_CLASS.items():
                if keyword in value.lower():
                    use_class = uc
                    break

        if "size:" in lower and floor_area_sqft is None:
            value = txt.split(":", 1)[-1].strip()
            sqft_match = SQFT_RE.search(value.replace(",", ""))
            if sqft_match:
                try:
                    floor_area_sqft = float(sqft_match.group(1).replace(",", ""))
                except ValueError:
                    pass
            else:
                sqm_match = SQM_RE.search(value.replace(",", ""))
                if sqm_match:
                    try:
                        floor_area_sqm_direct = round(float(sqm_match.group(1).replace(",", "")), 1)
                    except ValueError:
                        pass

        if "tenure:" in lower and tenure == Tenure.UNKNOWN:
            value = txt.split(":", 1)[-1].strip()
            for keyword, t in TENURE_MAP.items():
                if keyword in value.lower():
                    tenure = t
                    break

        if "epc:" in lower and epc_rating is None:
            epc_rating = txt.split(":", 1)[-1].strip().upper()
            if len(epc_rating) > 2:
                epc_rating = epc_rating[0] if epc_rating[0].isalpha() else None

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
        if src.startswith("http") and ("estatesgazette" in src or "egi" in src):
            image_urls.append(src)

    floor_area_sqm = floor_area_sqm_direct or sqft_to_sqm(floor_area_sqft)

    return CommercialListing(
        address=Address(raw=address_raw, postcode=postcode),
        price=PriceInfo(amount=price_pence),
        use_class=use_class,
        floor_area_sqft=floor_area_sqft,
        floor_area_sqm=floor_area_sqm,
        tenure=tenure,
        epc_rating=epc_rating,
        source_url=url,
        source_name="Estates Gazette",
        image_urls=image_urls,
        description=description,
    )


class EigAdapter(BaseAdapter):
    async def fetch_listing(self, url: str) -> CommercialListing | None:
        try:
            resp = await get_client().get(url, timeout=15.0)
            if resp.status_code != 200:
                logger.warning("EIG fetch for %s returned HTTP %s", url, resp.status_code)
                return None
            return _parse_listing(resp.text, url)
        except httpx.HTTPError as exc:
            logger.warning("EIG fetch failed for %s: %s", url, exc)
            return None


register_adapter("eig", EigAdapter, ["propertylink.estatesgazette.com", "egi.co.uk"])
