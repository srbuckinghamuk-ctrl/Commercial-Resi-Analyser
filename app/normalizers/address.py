"""
Address normalization and canonical key generation for deduplication.

Strategy:
  1. Strip punctuation, normalise whitespace
  2. Expand common abbreviations (Rd → Road, etc.)
  3. Normalise UK postcode format
  4. Build canonical key = postcode + normalised number/name tokens
  5. Fuzzy match against existing canonical keys using rapidfuzz
"""
from __future__ import annotations

import hashlib
import re
import unicodedata

try:
    from rapidfuzz import fuzz as _rfuzz, process as _rprocess
    _USE_RAPIDFUZZ = True
except ImportError:
    from difflib import SequenceMatcher as _SequenceMatcher
    _USE_RAPIDFUZZ = False

# UK postcode regex
_POSTCODE_RE = re.compile(
    r"\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b",
    re.IGNORECASE,
)

_ABBREVS = {
    r"\brd\b": "road",
    r"\bst\b": "street",
    r"\bave?\b": "avenue",
    r"\bdr\b": "drive",
    r"\bcl\b": "close",
    r"\bct\b": "court",
    r"\bln\b": "lane",
    r"\bpl\b": "place",
    r"\bgdns\b": "gardens",
    r"\bgdn\b": "garden",
    r"\bsq\b": "square",
    r"\bvw\b": "view",
    r"\bpk\b": "park",
    r"\bcresc?\b": "crescent",
    r"\bwlk\b": "walk",
    r"\bgt\b": "great",
    r"\blt\b": "little",
    r"\bupr\b": "upper",
    r"\blwr\b": "lower",
    r"\bno\.?\b": "",          # strip flat/house number prefix
}

_NOISE_TOKENS = frozenset({
    "flat", "apartment", "apt", "unit", "room", "floor", "ground",
    "first", "second", "third", "fourth", "fifth", "the", "and",
})


def _normalise_unicode(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()


def _normalise_postcode(raw: str) -> str:
    """Ensure postcode is in canonical UK format: 'SW1A 1AA'."""
    m = _POSTCODE_RE.search(raw)
    if not m:
        return ""
    return f"{m.group(1).upper()} {m.group(2).upper()}"


def _expand_abbreviations(text: str) -> str:
    text = text.lower()
    for pattern, replacement in _ABBREVS.items():
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text


def _extract_number_token(text: str) -> str:
    """Extract leading house number or name."""
    m = re.match(r"^(\d+[a-z]?)\b", text.strip(), re.IGNORECASE)
    if m:
        return m.group(1).lower()
    # Named house – take first significant token
    tokens = text.strip().split()
    for t in tokens:
        if t.lower() not in _NOISE_TOKENS and len(t) > 1:
            return t.lower()
    return ""


def build_canonical_address_key(raw_address: str, postcode: str | None = None) -> str:
    """
    Build a stable canonical key for address deduplication.

    Format: <postcode_no_space>|<house_token>|<street_tokens>
    Example: 'SW1A1AA|10|downing|street'
    """
    raw = _normalise_unicode(raw_address)

    # Extract postcode
    pc = _normalise_postcode(raw)
    if not pc and postcode:
        pc = _normalise_postcode(postcode)
    pc_key = pc.replace(" ", "").upper()

    # Expand abbreviations
    expanded = _expand_abbreviations(raw)

    # Strip postcode from expanded text
    expanded = _POSTCODE_RE.sub("", expanded)

    # Strip noise characters
    cleaned = re.sub(r"[^a-z0-9\s]", " ", expanded)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    tokens = cleaned.split()
    # Remove noise tokens
    meaningful = [t for t in tokens if t not in _NOISE_TOKENS and len(t) > 0]

    # House number/name is usually first token
    house = _extract_number_token(" ".join(meaningful[:2]))

    # Street tokens (skip house)
    street_start = 1 if meaningful and meaningful[0] == house else 0
    street_tokens = meaningful[street_start : street_start + 3]  # take up to 3 tokens

    parts = [pc_key, house] + street_tokens
    return "|".join(p for p in parts if p)


def compute_listing_fingerprint(
    source_id: str,
    canonical_address_key: str,
    external_id: str | None,
) -> str:
    """SHA-256 fingerprint of stable listing identity fields."""
    payload = f"{source_id}::{canonical_address_key}::{external_id or ''}"
    return hashlib.sha256(payload.encode()).hexdigest()[:32]


def fuzzy_match_address(
    candidate: str,
    existing_keys: list[str],
    threshold: float = 90.0,
) -> str | None:
    """
    Return the best matching canonical key if similarity >= threshold.
    Uses token_sort_ratio to handle word-order variations.
    """
    if not existing_keys:
        return None
    if _USE_RAPIDFUZZ:
        best = _rprocess.extractOne(
            candidate,
            existing_keys,
            scorer=_rfuzz.token_sort_ratio,
            score_cutoff=threshold,
        )
        return best[0] if best else None
    else:
        # difflib fallback
        best_score = 0.0
        best_key = None
        for key in existing_keys:
            score = _SequenceMatcher(None, candidate, key).ratio() * 100
            if score > best_score:
                best_score = score
                best_key = key
        return best_key if best_score >= threshold else None


def extract_postcode_district(postcode: str) -> str | None:
    """Extract district portion e.g. 'SW1A 1AA' → 'SW1A'."""
    if not postcode:
        return None
    m = _POSTCODE_RE.search(postcode)
    if m:
        return m.group(1).upper()
    # Fallback for bare outcode input with a space (e.g. "SW1A" passed directly)
    if " " in postcode:
        return postcode.split()[0].upper()
    return None
