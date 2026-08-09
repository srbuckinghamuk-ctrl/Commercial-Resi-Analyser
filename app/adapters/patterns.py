from __future__ import annotations

import re

from app.models import Tenure, UseClass

POSTCODE_RE = re.compile(r"[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}", re.IGNORECASE)
PRICE_RE = re.compile(r"£([\d,]+)")
SQFT_RE = re.compile(r"([\d,]+)\s*sq\s*ft", re.IGNORECASE)

TYPE_TO_USE_CLASS: dict[str, UseClass] = {
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

TENURE_MAP: dict[str, Tenure] = {
    "freehold": Tenure.FREEHOLD,
    "leasehold": Tenure.LEASEHOLD,
}

SQFT_TO_SQM = 0.092903


def extract_postcode(text: str) -> str | None:
    match = POSTCODE_RE.search(text)
    return match.group(0).strip().upper() if match else None


def parse_price(text: str) -> int | None:
    match = PRICE_RE.search(text.replace(",", "").replace(" ", ""))
    if not match:
        match = PRICE_RE.search(text)
    if match:
        digits = match.group(1).replace(",", "")
        try:
            return int(digits) * 100
        except ValueError:
            return None
    return None


def detect_use_class(text: str) -> UseClass:
    lower = text.lower().strip()
    for keyword, use_class in TYPE_TO_USE_CLASS.items():
        if keyword in lower:
            return use_class
    return UseClass.UNKNOWN


def detect_tenure(text: str) -> Tenure:
    lower = text.lower().strip()
    for keyword, tenure in TENURE_MAP.items():
        if keyword in lower:
            return tenure
    return Tenure.UNKNOWN


def parse_sqft(text: str) -> float | None:
    match = SQFT_RE.search(text.replace(",", ""))
    if match:
        try:
            return float(match.group(1).replace(",", ""))
        except ValueError:
            return None
    return None


def sqft_to_sqm(sqft: float | None) -> float | None:
    return round(sqft * SQFT_TO_SQM, 1) if sqft else None
