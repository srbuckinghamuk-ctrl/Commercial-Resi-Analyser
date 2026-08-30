"""The elemental benchmark library's import path (spec Sec 27.5 rules 1, 3,
4, 6, 7, 8, 10-12 and Sec 27.6).

An import document is an `ElementalBenchmarkSet` without `id`, `created_at`
or `content_hash` (anything supplied for those is discarded -- the server
assigns them). `normalise_import` returns the validated model with its
`content_hash`, or a list of `{severity, field, message}` issues shaped like
the appraisal endpoints' 422 body. `currentise_rates` is the derived read for
`GET /benchmark-sets/{id}?currentisation_date=&current_index_value=`: the
Sec 27.3 arithmetic on the set's rates, computed and returned, never stored.
"""
from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from pydantic import ValidationError

from app.financial_model.area_units import SQFT_PER_SQM
from app.financial_model.elemental_benchmark import (
    ELEMENT_BY_CODE,
    ELEMENT_CATALOGUE,
    UNITS_FOR_BASIS,
    benchmark_content_hash,
)
from app.financial_model.types import ElementalBenchmarkRate, ElementalBenchmarkSet

SERVER_ASSIGNED = ("id", "created_at", "content_hash")

RATE_COLUMNS: tuple[str, ...] = tuple(ElementalBenchmarkRate.model_fields.keys())
_INT_COLUMNS = {
    "original_rate_pence", "lower_quartile_rate_pence", "median_rate_pence",
    "upper_quartile_rate_pence", "sample_count",
}
_FLOAT_COLUMNS = {"rate_pct", "location_factor"}
_NULLABLE_COLUMNS = _FLOAT_COLUMNS | (_INT_COLUMNS - {"original_rate_pence"})

# Sec 27.5 rule 3 inverted: the default unit the template suggests for a basis.
DEFAULT_UNIT_FOR_BASIS = {basis: units[0] for basis, units in UNITS_FOR_BASIS.items()}

Issue = dict[str, str]


def _issue(field: str, message: str) -> Issue:
    return {"severity": "error", "field": field, "message": message}


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _positive_finite(value: Any) -> bool:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(f) and f > 0


@dataclass(frozen=True)
class NormalisedImport:
    set: ElementalBenchmarkSet
    content_hash: str


def _pydantic_issues(error: ValidationError) -> list[Issue]:
    out: list[Issue] = []
    for e in error.errors():
        loc = ".".join(str(p) for p in e.get("loc", ()))
        out.append(_issue(loc or "set", e.get("msg", "invalid value")))
    return out


def _rate_ids(rates: list[dict[str, Any]]) -> None:
    """A rate without an id gets a deterministic one from its element and
    position so the same CSV imports to the same content hash every time."""
    for position, rate in enumerate(rates):
        if _blank(rate.get("id")):
            rate["id"] = f"{rate.get('element_code', 'rate')}-{position + 1}"


def normalise_import(document: dict[str, Any]) -> tuple[NormalisedImport | None, list[Issue]]:
    """Strip the server-assigned fields, validate the model and Sec 27.5's
    set-level rules, and compute the content hash. Returns `(result, [])` or
    `(None, issues)`."""
    if not isinstance(document, dict):
        return None, [_issue("set", "benchmark set import must be a JSON object")]
    doc = {k: v for k, v in document.items() if k not in SERVER_ASSIGNED}
    doc["id"] = "pending"
    doc["created_at"] = ""
    rates = [dict(r) for r in (doc.get("rates") or []) if isinstance(r, dict)]
    _rate_ids(rates)
    doc["rates"] = rates
    try:
        model = ElementalBenchmarkSet.model_validate(doc)
    except ValidationError as error:
        return None, _pydantic_issues(error)
    issues = validate_set(model)
    if issues:
        return None, issues
    return NormalisedImport(set=model, content_hash=benchmark_content_hash(model)), []


def validate_set(s: ElementalBenchmarkSet) -> list[Issue]:
    """Sec 27.5 rules that concern the set alone (no selections, no plan)."""
    issues: list[Issue] = []
    if _blank(s.name):
        issues.append(_issue("name", "name is required"))
    if _blank(s.base_date):
        issues.append(_issue("base_date", "base_date is required (ISO date)"))
    else:
        try:
            date.fromisoformat(s.base_date)
        except ValueError:
            issues.append(_issue("base_date", f"base_date '{s.base_date}' is not an ISO date"))
    if not s.rates:
        issues.append(_issue("rates", "at least one rate is required"))

    # Rule 1: rate ids unique. Element codes must be catalogue members.
    seen: set[str] = set()
    for i, r in enumerate(s.rates):
        prefix = f"rates.{i}"
        if r.id in seen:
            issues.append(_issue(f"{prefix}.id", f"rate id '{r.id}' is not unique"))
        seen.add(r.id)
        if r.element_code not in ELEMENT_BY_CODE:
            issues.append(_issue(
                f"{prefix}.element_code",
                f"element_code '{r.element_code}' is not in the element catalogue",
            ))
        # Rule 3
        if r.original_unit not in UNITS_FOR_BASIS[r.measurement_basis]:
            issues.append(_issue(
                f"{prefix}.original_unit",
                f"original_unit '{r.original_unit}' does not agree with "
                f"measurement_basis '{r.measurement_basis}'",
            ))
        # Rule 4
        if r.measurement_basis == "percentage":
            if r.rate_pct is None or not math.isfinite(r.rate_pct) or r.rate_pct < 0:
                issues.append(_issue(
                    f"{prefix}.rate_pct", "rate_pct is required (>= 0) on a percentage row"
                ))
        elif r.rate_pct is not None:
            issues.append(_issue(f"{prefix}.rate_pct", "rate_pct must be null unless the basis is percentage"))
        # Rule 8 (per-rate override)
        if r.location_factor is not None and not _positive_finite(r.location_factor):
            issues.append(_issue(f"{prefix}.location_factor", "location_factor must be finite and > 0"))

    # Rule 6
    names = (s.base_index_name, s.current_index_name)
    if (names[0] is None) != (names[1] is None) or (names[0] is not None and names[0] != names[1]):
        issues.append(_issue(
            "current_index_name",
            "base_index_name and current_index_name must both be null or both equal",
        ))
    # Rule 7
    for field in ("base_index_value", "current_index_value"):
        value = getattr(s, field)
        if value is not None and not _positive_finite(value):
            issues.append(_issue(field, f"{field} must be finite and > 0"))
    # Rule 8
    if s.location_factor is not None and not _positive_finite(s.location_factor):
        issues.append(_issue("location_factor", "location_factor must be finite and > 0"))

    # Rules 10-12: provider-tier required fields.
    required: dict[str, tuple[str, ...]] = {
        "bcis_licensed": (
            "source_title", "licence_or_permission", "imported_by", "building_function",
            "source_publication_date", "location_factor", "base_index_name", "base_index_value",
        ),
        "public_benchmark": (
            "provider_name", "source_title", "source_url", "licence_or_permission",
            "source_publication_date", "retrieved_at",
        ),
        "user_qs": ("source_title", "imported_by", "base_date"),
    }
    for field in required[s.provider_type]:
        if _blank(getattr(s, field)):
            issues.append(_issue(
                field, f"{field} is required for provider_type '{s.provider_type}'"
            ))
    return issues


# --- CSV -----------------------------------------------------------------------


def template_csv() -> str:
    """The import template: the rate columns as the header row, then one
    comment row per catalogue element (id column `#`), pre-filled with the
    element's code, label, default basis and that basis's default unit."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(RATE_COLUMNS)
    for entry in ELEMENT_CATALOGUE:
        row = {c: "" for c in RATE_COLUMNS}
        row.update({
            "id": "#",
            "element_code": entry.code,
            "element_label": entry.label,
            "measurement_basis": entry.default_basis,
            "original_unit": DEFAULT_UNIT_FOR_BASIS[entry.default_basis],
            "original_rate_pence": "0",
            "evidence_status": "unverified",
        })
        writer.writerow([row[c] for c in RATE_COLUMNS])
    return out.getvalue()


def _coerce(column: str, raw: str, row_index: int, issues: list[Issue]) -> Any:
    text = (raw or "").strip()
    if column in _NULLABLE_COLUMNS and text == "":
        return None
    if column in _INT_COLUMNS:
        try:
            return int(text)
        except ValueError:
            issues.append(_issue(f"rates.{row_index}.{column}", f"{column} must be an integer"))
            return 0
    if column in _FLOAT_COLUMNS:
        try:
            return float(text)
        except ValueError:
            issues.append(_issue(f"rates.{row_index}.{column}", f"{column} must be a number"))
            return None
    return text


def parse_rates_csv(text: str) -> tuple[list[dict[str, Any]], list[Issue]]:
    """Rates from a CSV in the template's columns. Comment rows (first cell
    beginning with `#`) and blank rows are skipped; the header must contain
    every rate column."""
    lines = [ln for ln in text.lstrip("﻿").splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    if not lines:
        return [], [_issue("file", "benchmark import: the CSV has no header row")]
    reader = csv.DictReader(io.StringIO("\n".join(lines)))
    headers = [h.strip() for h in (reader.fieldnames or [])]
    missing = [c for c in RATE_COLUMNS if c not in headers]
    if missing:
        return [], [_issue(
            "file", "benchmark import: CSV header is missing column(s) " + ", ".join(missing)
        )]
    issues: list[Issue] = []
    rates: list[dict[str, Any]] = []
    for i, record in enumerate(reader):
        cleaned = {k.strip(): (v or "") for k, v in record.items() if k is not None}
        if (cleaned.get("id") or "").strip().startswith("#"):
            continue
        rates.append({c: _coerce(c, cleaned.get(c, ""), i, issues) for c in RATE_COLUMNS})
    return rates, issues


# --- the derived read ----------------------------------------------------------


def currentise_rates(
    set_doc: dict[str, Any], *, currentisation_date: str, current_index_value: float,
) -> dict[str, Any]:
    """Sec 27.3 for a read: factor = current ÷ base (None unless both > 0),
    multiplier = (rate.location_factor ?? set.location_factor ?? 100) ÷ 100,
    canonical rate = original (× SQFT_PER_SQM for gbp_per_sqft), currentised
    = canonical × (factor ?? 1) × multiplier. Unrounded -- Sec 27.3's one
    rounding happens at the amount, which needs a quantity a read has not
    got. Percentage rows are never currentised."""
    base = set_doc.get("base_index_value")
    factor = (
        float(current_index_value) / float(base)
        if _positive_finite(base) and _positive_finite(current_index_value) else None
    )
    set_lf = set_doc.get("location_factor")
    rows = []
    for r in set_doc.get("rates") or []:
        if r.get("measurement_basis") == "percentage":
            rows.append({
                "rate_id": r["id"], "element_code": r["element_code"],
                "canonical_rate_pence": None, "currentised_rate_pence": None,
                "rate_pct": r.get("rate_pct"), "location_multiplier": None,
            })
            continue
        lf = r.get("location_factor")
        if lf is None:
            lf = set_lf
        multiplier = float(lf) / 100.0 if _positive_finite(lf) else 1.0
        original = float(r.get("original_rate_pence") or 0)
        canonical = original * SQFT_PER_SQM if r.get("original_unit") == "gbp_per_sqft" else original
        rows.append({
            "rate_id": r["id"], "element_code": r["element_code"],
            "canonical_rate_pence": canonical,
            "currentised_rate_pence": canonical * (factor if factor is not None else 1.0) * multiplier,
            "rate_pct": None, "location_multiplier": multiplier,
        })
    return {
        "currentisation_date": currentisation_date,
        "current_index_value": float(current_index_value),
        "base_index_value": float(base) if _positive_finite(base) else None,
        "currentisation_factor": factor,
        "currentisation_method": "index_ratio" if factor is not None else "none",
        "rows": rows,
    }


# --- ORM <-> document ----------------------------------------------------------


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def set_header_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": str(row.id), "name": row.name, "provider_type": row.provider_type,
        "provider_name": row.provider_name, "source_title": row.source_title,
        "source_url": row.source_url, "source_publication_date": _iso(row.source_publication_date),
        "retrieved_at": _iso(row.retrieved_at), "licence_or_permission": row.licence_or_permission,
        "dataset_version": row.dataset_version, "building_function": row.building_function,
        "project_type": row.project_type, "specification_level": row.specification_level,
        "region": row.region, "location_factor": row.location_factor,
        "location_factor_source": row.location_factor_source, "base_date": _iso(row.base_date),
        "base_index_name": row.base_index_name, "base_index_value": row.base_index_value,
        "current_index_name": row.current_index_name, "current_index_value": row.current_index_value,
        "index_dataset_version": row.index_dataset_version,
        "currentisation_date": _iso(row.currentisation_date), "currency": row.currency or "GBP",
        "notes": row.notes, "imported_by": row.imported_by,
        "imported_by_user_id": str(row.imported_by_user_id) if row.imported_by_user_id else None,
        "created_at": _iso(row.created_at) or "", "source_file_sha256": row.source_file_sha256,
        "content_hash": row.content_hash, "rate_count": len(row.rates) if row.rates is not None else None,
    }


def rate_from_row(r: Any) -> dict[str, Any]:
    return {
        "id": r.rate_key or str(r.id), "element_code": r.element_code, "element_label": r.element_label,
        "description": r.description, "measurement_basis": r.measurement_basis,
        "original_unit": r.original_unit, "original_rate_pence": r.original_rate_pence,
        "rate_pct": r.rate_pct, "lower_quartile_rate_pence": r.lower_quartile_rate_pence,
        "median_rate_pence": r.median_rate_pence, "upper_quartile_rate_pence": r.upper_quartile_rate_pence,
        "sample_count": r.sample_count, "location_factor": r.location_factor,
        "evidence_status": r.evidence_status, "source_reference": r.source_reference,
        "notes": r.notes,
    }


def set_document_from_row(row: Any) -> dict[str, Any]:
    doc = set_header_from_row(row)
    doc["rates"] = [rate_from_row(r) for r in row.rates]
    return doc
