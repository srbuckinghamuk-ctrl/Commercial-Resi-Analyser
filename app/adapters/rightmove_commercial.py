from __future__ import annotations

import re

import httpx
from bs4 import BeautifulSoup

from app.adapters.base import BaseAdapter
from app.adapters.patterns import (
    PRICE_RE,
    detect_tenure,
    detect_use_class,
    extract_postcode,
    parse_price,
    parse_sqft,
    parse_sqm,
    sqft_to_sqm,
)
from app.adapters.registry import register_adapter
from app.models import Address, CommercialListing, PriceInfo, Tenure, UseClass


def _parse_listing(html: str, url: str) -> CommercialListing | None:
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    if not h1:
        return None
    address_raw = h1.get_text(strip=True)
    if not address_raw:
        return None

    postcode = extract_postcode(address_raw)

    price_pence: int = 0
    price_el = soup.find(["div", "span"], string=PRICE_RE)
    if price_el is None:
        for el in soup.find_all(["div", "span"]):
            txt = el.get_text()
            parsed = parse_price(txt)
            if parsed and parsed > 0:
                price_pence = parsed
                break
    else:
        price_pence = parse_price(price_el.get_text()) or 0

    use_class = UseClass.UNKNOWN
    tenure = Tenure.UNKNOWN
    floor_area_sqft: float | None = None
    floor_area_sqm_direct: float | None = None

    for detail_el in soup.find_all(["div", "span", "li"]):
        txt = detail_el.get_text(strip=True)
        if not txt or len(txt) > 200:
            continue

        if use_class == UseClass.UNKNOWN:
            detected = detect_use_class(txt)
            if detected != UseClass.UNKNOWN:
                use_class = detected

        if tenure == Tenure.UNKNOWN:
            detected_tenure = detect_tenure(txt)
            if detected_tenure != Tenure.UNKNOWN:
                tenure = detected_tenure

        if floor_area_sqft is None and floor_area_sqm_direct is None:
            floor_area_sqft = parse_sqft(txt)
            if floor_area_sqft is None:
                floor_area_sqm_direct = parse_sqm(txt)

    description = ""
    desc_el = soup.find("div", class_=re.compile(r"STw8|description", re.IGNORECASE))
    if desc_el:
        description = desc_el.get_text(strip=True)
    else:
        for p in soup.find_all("p"):
            txt = p.get_text(strip=True)
            if len(txt) > 50:
                description = txt
                break

    image_urls: list[str] = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if "rightmove" in src and src.startswith("http"):
            image_urls.append(src)

    floor_area_sqm = floor_area_sqm_direct or sqft_to_sqm(floor_area_sqft)

    return CommercialListing(
        address=Address(raw=address_raw, postcode=postcode),
        price=PriceInfo(amount=price_pence),
        use_class=use_class,
        floor_area_sqft=floor_area_sqft,
        floor_area_sqm=floor_area_sqm,
        tenure=tenure,
        source_url=url,
        source_name="Rightmove Commercial",
        image_urls=image_urls,
        description=description or None,
    )


class RightmoveCommercialAdapter(BaseAdapter):
    async def fetch_listing(self, url: str) -> CommercialListing | None:
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=15.0,
                headers={"User-Agent": "Mozilla/5.0 (compatible; CommercialResiBot/1.0)"},
            ) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return None
                return _parse_listing(resp.text, url)
        except httpx.HTTPError:
            return None


register_adapter(
    "rightmove_commercial",
    RightmoveCommercialAdapter,
    ["rightmove.co.uk"],
)
