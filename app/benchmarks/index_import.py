"""Index-dataset import validation (spec Sec 27.6).

Observations are `{period: 'YYYY-MM', value: number}` rows, from JSON or from
CSV text whose header is exactly `period,value`. Periods must be well-formed,
unique and strictly increasing; values finite and > 0. The five message texts
below are the documented 422s (design Sec 18, "Non-monotonic import") and are
pinned by tests/test_index_import.py against the five fixtures.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
from typing import Any

PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
CSV_HEADER = "period,value"

MSG_BAD_HEADER = "index import: column header must be exactly 'period,value'"


def msg_bad_period(p: str) -> str:
    return f"index import: period '{p}' is not YYYY-MM"


def msg_not_increasing(p: str, q: str) -> str:
    return f"index import: periods must be strictly increasing (found '{p}' after '{q}')"


def msg_duplicate(p: str) -> str:
    return f"index import: duplicate period '{p}'"


def msg_bad_value(p: str) -> str:
    return f"index import: value for '{p}' must be a finite number greater than zero"


class IndexImportError(ValueError):
    """One documented 422 message; `field` names the offending part."""

    def __init__(self, message: str, field: str = "observations"):
        super().__init__(message)
        self.message = message
        self.field = field

    def issue(self) -> dict[str, str]:
        return {"severity": "error", "field": self.field, "message": self.message}


def _finite_positive(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f > 0 else None


def validate_observations(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate rows in the order given and return `[{period, value: float}]`.
    Checks per row: period shape, duplicate, increasing, value -- so a repeated
    period is reported as a duplicate, not as non-increasing."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    previous: str | None = None
    if not rows:
        raise IndexImportError("index import: at least one observation is required")
    for row in rows:
        period = str(row.get("period", "") if isinstance(row, dict) else "").strip()
        if not PERIOD_RE.match(period):
            raise IndexImportError(msg_bad_period(period))
        if period in seen:
            raise IndexImportError(msg_duplicate(period))
        if previous is not None and period < previous:
            raise IndexImportError(msg_not_increasing(period, previous))
        value = _finite_positive(row.get("value"))
        if value is None:
            raise IndexImportError(msg_bad_value(period))
        seen.add(period)
        previous = period
        out.append({"period": period, "value": value})
    return out


def parse_observations_csv(text: str) -> list[dict[str, Any]]:
    """`period,value` CSV. Leading lines beginning with `#` are comments (a
    provenance line such as `# source: <url>; licence: OGL v3`), blank lines
    are skipped, and the first remaining line must be exactly the header."""
    lines = text.lstrip("﻿").splitlines()
    body: list[str] = []
    header_seen = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if not header_seen:
            if stripped.startswith("#"):
                continue
            if stripped != CSV_HEADER:
                raise IndexImportError(MSG_BAD_HEADER, field="file")
            header_seen = True
            continue
        body.append(line)
    if not header_seen:
        raise IndexImportError(MSG_BAD_HEADER, field="file")
    rows: list[dict[str, Any]] = []
    for record in csv.reader(io.StringIO("\n".join(body))):
        if not record or (len(record) == 1 and not record[0].strip()):
            continue
        period = record[0].strip()
        value = record[1].strip() if len(record) > 1 else ""
        rows.append({"period": period, "value": value})
    return validate_observations(rows)


INDEX_HEADER_FIELDS = (
    "publisher", "series_code", "series_name", "dataset_version", "base_period",
)


def index_content_hash(header: dict[str, Any], observations: list[dict[str, Any]]) -> str:
    """sha256 over the canonical JSON of the identifying header fields and the
    observations sorted by period -- the same encoding as Sec 13.2's
    canonical_hash (sorted keys, compact separators, non-ASCII kept)."""
    payload = {
        **{k: str(header.get(k, "") or "") for k in INDEX_HEADER_FIELDS},
        "observations": sorted(
            ({"period": o["period"], "value": float(o["value"])} for o in observations),
            key=lambda o: o["period"],
        ),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
