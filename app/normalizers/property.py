"""Normalisation helpers for price, property type, tenure, floor area."""
from __future__ import annotations

import re
from app.models import PropertyType, Tenure


# ---------------------------------------------------------------------------
# Price
# ---------------------------------------------------------------------------

def parse_price_pence(raw: str | int | float | None) -> int | None:
    """Parse a price string into integer pence."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        # Assume pounds if integer, convert to pence
        return int(raw * 100)
    raw_str = str(raw)
    # Remove everything except digits and decimal point
    cleaned = re.sub(r"[£,$€\s,]", "", raw_str)
    # Strip + suffix (e.g. "£250,000+" → "250000")
    cleaned = cleaned.replace("+", "")
    # Handle price range — take the lower bound (first value)
    if "-" in cleaned or "\u2013" in cleaned:
        parts = re.split(r"[-\u2013]", cleaned, maxsplit=1)
        cleaned = parts[0].strip()
    # Handle 'k' suffix (e.g. "£250k")
    if cleaned.lower().endswith("k"):
        try:
            return int(float(cleaned[:-1]) * 1_000 * 100)
        except ValueError:
            return None
    try:
        amount_pounds = float(cleaned)
        return int(amount_pounds * 100)
    except ValueError:
        return None


def format_price_pounds(pence: int | None) -> str | None:
    if pence is None:
        return None
    pounds = pence / 100
    if pounds >= 1_000_000:
        return f"£{pounds / 1_000_000:.2f}m"
    if pounds >= 1_000:
        thousands = pounds / 1_000
        if round(thousands) >= 1000:
            return f"£{pounds / 1_000_000:.2f}m"
        return f"£{thousands:.0f}k"
    return f"£{pounds:.0f}"


# ---------------------------------------------------------------------------
# Property type
# ---------------------------------------------------------------------------

_PROPERTY_TYPE_MAP = {
    "semi-detached": PropertyType.SEMI_DETACHED,
    "semi detached": PropertyType.SEMI_DETACHED,
    "detached": PropertyType.DETACHED,
    "terraced": PropertyType.TERRACED,
    "end-of-terrace": PropertyType.TERRACED,
    "end of terrace": PropertyType.TERRACED,
    "mid-terrace": PropertyType.TERRACED,
    "flat": PropertyType.FLAT,
    "apartment": PropertyType.FLAT,
    "studio": PropertyType.FLAT,
    "maisonette": PropertyType.MAISONETTE,
    "bungalow": PropertyType.BUNGALOW,
    "land": PropertyType.LAND,
    "plot": PropertyType.LAND,
    "commercial": PropertyType.COMMERCIAL,
}


def normalise_property_type(raw: str | None) -> PropertyType:
    if not raw:
        return PropertyType.UNKNOWN
    lower = raw.strip().lower()
    for key, val in _PROPERTY_TYPE_MAP.items():
        if key in lower:
            return val
    return PropertyType.OTHER


# ---------------------------------------------------------------------------
# Tenure
# ---------------------------------------------------------------------------

_TENURE_MAP = {
    "share of freehold": Tenure.SHARE_OF_FREEHOLD,
    "share-of-freehold": Tenure.SHARE_OF_FREEHOLD,
    "freehold": Tenure.FREEHOLD,
    "leasehold": Tenure.LEASEHOLD,
    "commonhold": Tenure.COMMONHOLD,
}


def normalise_tenure(raw: str | None) -> Tenure:
    if not raw:
        return Tenure.UNKNOWN
    lower = raw.strip().lower()
    for key, val in _TENURE_MAP.items():
        if key in lower:
            return val
    return Tenure.UNKNOWN


# ---------------------------------------------------------------------------
# Floor area
# ---------------------------------------------------------------------------

_SQFT_RE = re.compile(r"([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|ft²)", re.IGNORECASE)
_SQM_RE = re.compile(r"([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*m|sqm|m²)", re.IGNORECASE)


def parse_floor_area(raw: str | None) -> tuple[float | None, float | None]:
    """Returns (sqft, sqm). Converts between units if only one present."""
    if not raw:
        return None, None
    sqft: float | None = None
    sqm: float | None = None

    m = _SQFT_RE.search(raw)
    if m:
        sqft = float(m.group(1).replace(",", ""))

    m = _SQM_RE.search(raw)
    if m:
        sqm = float(m.group(1).replace(",", ""))

    if sqft is not None and sqm is None:
        sqm = round(sqft * 0.0929, 1)
    if sqm is not None and sqft is None:
        sqft = round(sqm * 10.7639, 1)

    return sqft, sqm


# ---------------------------------------------------------------------------
# Lease length
# ---------------------------------------------------------------------------

_LEASE_YEARS_RE = re.compile(
    r"(\d{1,4})\s*(?:years?|yr\.?)\s*(?:remaining|unexpired|left)?",
    re.IGNORECASE,
)
_LEASE_EXPIRY_RE = re.compile(r"(?:expir(?:ing|es?|y)|until)\s+(\d{4})", re.IGNORECASE)


def parse_lease_years(raw: str | None) -> int | None:
    if not raw:
        return None
    m = _LEASE_YEARS_RE.search(raw)
    if m:
        years = int(m.group(1))
        if 1 <= years <= 999:
            return years
    return None


def parse_lease_expiry_year(raw: str | None) -> int | None:
    if not raw:
        return None
    m = _LEASE_EXPIRY_RE.search(raw)
    if m:
        year = int(m.group(1))
        if 2000 <= year <= 3000:
            return year
    return None


# ---------------------------------------------------------------------------
# Bedrooms / bathrooms
# ---------------------------------------------------------------------------

_BED_RE = re.compile(r"(\d+)\s*(?:bed(?:room)?s?)", re.IGNORECASE)
_BATH_RE = re.compile(r"(\d+)\s*(?:bath(?:room)?s?)", re.IGNORECASE)
def parse_bedrooms(raw: str | None) -> int | None:
    if not raw:
        return None
    m = _BED_RE.search(raw)
    return int(m.group(1)) if m else None


def parse_bathrooms(raw: str | None) -> int | None:
    if not raw:
        return None
    m = _BATH_RE.search(raw)
    return int(m.group(1)) if m else None


