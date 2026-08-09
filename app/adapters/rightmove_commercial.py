from __future__ import annotations

import re

import httpx
from bs4 import BeautifulSoup

from app.adapters.base import BaseAdapter
from app.adapters.registry import register_adapter
from app.models import Address, CommercialListing, PriceInfo, Tenure, UseClass


_POSTCODE_RE = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}", re.IGNORECASE)

_PRICE_RE = re.compile(r"£([\d,]+)")

_SQFT_RE = re.compile(r"([\d,]+)\s*sq\s*ft", re.IGNORECASE)

_TYPE_TO_USE_CLASS: dict[str, UseClass] = {
    "office": UseClass.OFFICE,
    "retail": UseClass.RETAIL,
    "shop": UseClass.RETAIL,
    "light industrial": UseClass.LIGHT_INDUSTRIAL,
    "industrial": UseClass.LIGHT_INDUSTRIAL,
    "restaurant": UseClass.RESTAURANT_CAFE,
    "cafe": UseClass.RESTAURANT_CAFE,
    "takeaway": UseClass.TAKEAWAY,
    "agricultural": UseClass.AGRICULTURAL,
    "land": UseClass.AGRICULTURAL,
}

_TENURE_MAP: dict[str, Tenure] = {
    "freehold": Tenure.FREEHOLD,
    "leasehold": Tenure.LEASEHOLD,
}


def _extract_postcode(text: str) -> str | None:
    match = _POSTCODE_RE.search(text)
    return match.group(0).strip().upper() if match else None


def _parse_price(text: str) -> int | None:
    match = _PRICE_RE.search(text.replace(",", "").replace(" ", ""))
    if not match:
        match = _PRICE_RE.search(text)
    if match:
        digits = match.group(1).replace(",", "")
        try:
            return int(digits) * 100
        except ValueError:
            return None
    return None


def _detect_use_class(text: str) -> UseClass:
    lower = text.lower().strip()
    for keyword, use_class in _TYPE_TO_USE_CLASS.items():
        if keyword in lower:
            return use_class
    return UseClass.UNKNOWN


def _detect_tenure(text: str) -> Tenure:
    lower = text.lower().strip()
    for keyword, tenure in _TENURE_MAP.items():
        if keyword in lower:
            return tenure
    return Tenure.UNKNOWN


def _parse_sqft(text: str) -> float | None:
    match = _SQFT_RE.search(text.replace(",", ""))
    if match:
        try:
            return float(match.group(1).replace(",", ""))
        except ValueError:
            return None
    return None


def _parse_listing(html: str, url: str) -> CommercialListing | None:
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    if not h1:
        return None
    address_raw = h1.get_text(strip=True)
    if not address_raw:
        return None

    postcode = _extract_postcode(address_raw)

    price_pence: int = 0
    price_el = soup.find("div", class_=_PRICE_RE) or soup.find("span", string=_PRICE_RE)
    if price_el is None:
        for el in soup.find_all(["div", "span"]):
            txt = el.get_text()
            parsed = _parse_price(txt)
            if parsed and parsed > 0:
                price_pence = parsed
                break
    else:
        price_pence = _parse_price(price_el.get_text()) or 0

    use_class = UseClass.UNKNOWN
    tenure = Tenure.UNKNOWN
    floor_area_sqft: float | None = None

    for detail_el in soup.find_all(["div", "span", "li"]):
        txt = detail_el.get_text(strip=True)
        if not txt or len(txt) > 200:
            continue

        if use_class == UseClass.UNKNOWN:
            detected = _detect_use_class(txt)
            if detected != UseClass.UNKNOWN:
                use_class = detected

        if tenure == Tenure.UNKNOWN:
            detected_tenure = _detect_tenure(txt)
            if detected_tenure != Tenure.UNKNOWN:
                tenure = detected_tenure

        if floor_area_sqft is None:
            floor_area_sqft = _parse_sqft(txt)

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

    floor_area_sqm = round(floor_area_sqft * 0.092903, 1) if floor_area_sqft else None

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
