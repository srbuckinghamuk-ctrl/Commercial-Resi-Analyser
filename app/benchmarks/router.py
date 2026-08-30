"""/benchmark-sets and /index-datasets (spec Sec 27.6).

Every route is authenticated; the import routes (POST) require the
`administrator` or `underwriter` role. There is no PUT and no DELETE: a
benchmark set and an index-dataset version are immutable once imported, and
a re-import of identical content is a 409 naming the existing row. Nothing
here fetches from the internet (Sec 27.9 limitation 3) -- every import is a
document or file a person supplied.

Validation failures are 422s whose body is `[{severity, field, message}]`,
the shape the appraisal endpoints use. The index-import messages are the
five documented texts in app/benchmarks/index_import.py.

The derived read -- `GET /benchmark-sets/{id}?currentisation_date=&current_index_value=`
-- computes currentised rates with the engine's arithmetic and returns them
under `currentised`; it writes nothing.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import AuthenticatedUser, CurrentUser, require_roles
from app.benchmarks.index_import import (
    IndexImportError,
    index_content_hash,
    parse_observations_csv,
    validate_observations,
)
from app.benchmarks.library import (
    currentise_rates,
    normalise_import,
    parse_rates_csv,
    set_document_from_row,
    set_header_from_row,
    template_csv,
)
from app.persistence.database import get_db
from app.persistence.repositories import BenchmarkSetRepository, IndexDatasetRepository

DbDep = Annotated[AsyncSession, Depends(get_db)]
ImporterUser = Annotated[AuthenticatedUser, Depends(require_roles("administrator", "underwriter"))]

benchmark_sets_router = APIRouter(prefix="/benchmark-sets")
index_datasets_router = APIRouter(prefix="/index-datasets")

DUPLICATE_SET = "an identical benchmark set already exists: {id}"
DUPLICATE_INDEX_VERSION = (
    "index dataset version already exists: {publisher} / {series_code} / {dataset_version} ({id})"
)

Issue = dict[str, str]


def _issue(field: str, message: str) -> Issue:
    return {"severity": "error", "field": field, "message": message}


def _unprocessable(issues: list[Issue]) -> HTTPException:
    return HTTPException(status_code=422, detail=issues)


def _uuid_or_404(raw: str, what: str) -> UUID:
    try:
        return UUID(str(raw))
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what} not found") from None


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


async def _read_upload(file: UploadFile) -> tuple[str, str]:
    """(decoded text, sha256 hex) of an uploaded file."""
    raw = await file.read()
    return raw.decode("utf-8-sig", errors="replace"), hashlib.sha256(raw).hexdigest()


# --- benchmark sets ------------------------------------------------------------


@benchmark_sets_router.get("")
async def list_benchmark_sets(db: DbDep, user: CurrentUser) -> list[dict[str, Any]]:
    rows = await BenchmarkSetRepository(db).list()
    return [set_header_from_row(row) for row in rows]


@benchmark_sets_router.get("/template.csv")
async def benchmark_template_csv(user: CurrentUser) -> Response:
    """The import template: header row plus one comment row per catalogue
    element (39 rows), each pre-filled with the element's code, label and
    default basis/unit."""
    return Response(
        content=template_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="benchmark-set-template.csv"'},
    )


@benchmark_sets_router.get("/{set_id}")
async def get_benchmark_set(
    set_id: str,
    db: DbDep,
    user: CurrentUser,
    currentisation_date: Annotated[str | None, Query()] = None,
    current_index_value: Annotated[float | None, Query()] = None,
) -> dict[str, Any]:
    row = await BenchmarkSetRepository(db).get(_uuid_or_404(set_id, "benchmark set"))
    if row is None:
        raise HTTPException(status_code=404, detail="benchmark set not found")
    doc = set_document_from_row(row)
    if currentisation_date is None and current_index_value is None:
        return doc
    issues: list[Issue] = []
    if _blank(currentisation_date):
        issues.append(_issue("currentisation_date", "currentisation_date is required with current_index_value"))
    else:
        try:
            date.fromisoformat(currentisation_date)
        except ValueError:
            issues.append(_issue("currentisation_date", f"currentisation_date '{currentisation_date}' is not an ISO date"))
    if current_index_value is None:
        issues.append(_issue("current_index_value", "current_index_value is required with currentisation_date"))
    elif not math.isfinite(current_index_value) or current_index_value <= 0:
        issues.append(_issue("current_index_value", "current_index_value must be a finite number greater than zero"))
    if issues:
        raise _unprocessable(issues)
    doc["currentised"] = currentise_rates(
        doc, currentisation_date=currentisation_date, current_index_value=current_index_value,
    )
    return doc


async def _import_set(
    db: AsyncSession, user: AuthenticatedUser, document: dict[str, Any], *, source_file_sha256: str | None,
) -> dict[str, Any]:
    result, issues = normalise_import(document)
    if result is None:
        raise _unprocessable(issues)
    repo = BenchmarkSetRepository(db)
    validated = result.set.model_dump(mode="json")
    existing = await repo.find_by_content(
        validated["provider_type"], validated["dataset_version"], result.content_hash
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=DUPLICATE_SET.format(id=existing.id))
    header = {k: v for k, v in validated.items() if k != "rates"}
    if _blank(header.get("imported_by")):
        header["imported_by"] = user.display_name or user.email
    row = await repo.create(
        header, validated["rates"],
        content_hash=result.content_hash,
        imported_by_user_id=user.id,
        source_file_sha256=source_file_sha256,
    )
    await db.commit()
    return set_document_from_row(row)


@benchmark_sets_router.post("", status_code=201)
async def import_benchmark_set(body: dict[str, Any], db: DbDep, user: ImporterUser) -> dict[str, Any]:
    """JSON import: an `ElementalBenchmarkSet` without `id`, `created_at` or
    `content_hash` (anything supplied for those is discarded). Sec 27.5
    rules 1-12 are checked; 409 on identical content."""
    return await _import_set(db, user, body, source_file_sha256=None)


@benchmark_sets_router.post("/import-csv", status_code=201)
async def import_benchmark_set_csv(
    db: DbDep,
    user: ImporterUser,
    file: Annotated[UploadFile, File()],
    header: Annotated[str, Form(description="JSON object: the set's header fields (everything but `rates`)")],
) -> dict[str, Any]:
    """Multipart import: `file` is a CSV in the template's columns (comment
    rows whose id is `#` are skipped); `header` is the set header as a JSON
    object. Same validation as the JSON route; records the file's SHA-256."""
    try:
        header_doc = json.loads(header)
    except ValueError:
        raise _unprocessable([_issue("header", "header must be a JSON object")]) from None
    if not isinstance(header_doc, dict):
        raise _unprocessable([_issue("header", "header must be a JSON object")])
    text, sha256 = await _read_upload(file)
    rates, issues = parse_rates_csv(text)
    if issues:
        raise _unprocessable(issues)
    document = {**header_doc, "rates": rates}
    return await _import_set(db, user, document, source_file_sha256=sha256)


# --- index datasets ------------------------------------------------------------


def _iso(value: Any) -> str | None:
    return None if value is None else (value.isoformat() if hasattr(value, "isoformat") else str(value))


def index_header_from_row(row: Any) -> dict[str, Any]:
    observations = row.observations or []
    return {
        "id": str(row.id), "publisher": row.publisher, "series_code": row.series_code,
        "series_name": row.series_name, "dataset_version": row.dataset_version,
        "source_url": row.source_url, "licence": row.licence,
        "publication_date": _iso(row.publication_date), "retrieved_at": _iso(row.retrieved_at),
        "base_period": row.base_period, "source_file_sha256": row.source_file_sha256,
        "content_hash": row.content_hash, "imported_by": row.imported_by,
        "imported_by_user_id": str(row.imported_by_user_id) if row.imported_by_user_id else None,
        "notes": row.notes, "created_at": _iso(row.created_at),
        "observation_count": len(observations),
        "first_period": observations[0].period if observations else None,
        "last_period": observations[-1].period if observations else None,
    }


def index_document_from_row(row: Any) -> dict[str, Any]:
    doc = index_header_from_row(row)
    doc["observations"] = [{"period": o.period, "value": o.value} for o in row.observations]
    return doc


INDEX_HEADER_KEYS = (
    "publisher", "series_code", "series_name", "dataset_version", "source_url", "licence",
    "publication_date", "retrieved_at", "base_period", "notes",
)
INDEX_REQUIRED = ("publisher", "series_code", "dataset_version", "source_url", "licence", "retrieved_at", "base_period")


def _index_header(document: dict[str, Any]) -> dict[str, Any]:
    header = {k: document.get(k) for k in INDEX_HEADER_KEYS}
    issues = [_issue(k, f"{k} is required") for k in INDEX_REQUIRED if _blank(header.get(k))]
    for key in ("publication_date", "retrieved_at"):
        value = header.get(key)
        if not _blank(value):
            try:
                date.fromisoformat(str(value).strip()[:10])
            except ValueError:
                issues.append(_issue(key, f"{key} '{value}' is not an ISO date"))
    if issues:
        raise _unprocessable(issues)
    header = {k: (v.strip() if isinstance(v, str) else v) for k, v in header.items()}
    if _blank(header.get("series_name")):
        header["series_name"] = header["series_code"]
    return header


async def _import_index(
    db: AsyncSession, user: AuthenticatedUser, header: dict[str, Any],
    observations: list[dict[str, Any]], *, source_file_sha256: str | None,
) -> dict[str, Any]:
    repo = IndexDatasetRepository(db)
    existing = await repo.find_version(header["publisher"], header["series_code"], header["dataset_version"])
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=DUPLICATE_INDEX_VERSION.format(
                publisher=header["publisher"], series_code=header["series_code"],
                dataset_version=header["dataset_version"], id=existing.id,
            ),
        )
    row = await repo.create(
        header, observations,
        content_hash=index_content_hash(header, observations),
        imported_by=user.display_name or user.email,
        imported_by_user_id=user.id,
        source_file_sha256=source_file_sha256,
    )
    await db.commit()
    return index_document_from_row(row)


@index_datasets_router.get("")
async def list_index_datasets(db: DbDep, user: CurrentUser) -> list[dict[str, Any]]:
    rows = await IndexDatasetRepository(db).list()
    return [index_header_from_row(row) for row in rows]


@index_datasets_router.get("/{dataset_id}")
async def get_index_dataset(dataset_id: str, db: DbDep, user: CurrentUser) -> dict[str, Any]:
    row = await IndexDatasetRepository(db).get(_uuid_or_404(dataset_id, "index dataset"))
    if row is None:
        raise HTTPException(status_code=404, detail="index dataset not found")
    return index_document_from_row(row)


@index_datasets_router.post("", status_code=201)
async def import_index_dataset(body: dict[str, Any], db: DbDep, user: ImporterUser) -> dict[str, Any]:
    """JSON `{publisher, series_code, series_name, dataset_version, source_url,
    licence, publication_date, retrieved_at, base_period, observations:[{period,value}]}`."""
    header = _index_header(body)
    raw = body.get("observations")
    if not isinstance(raw, list):
        raise _unprocessable([_issue("observations", "observations must be a list of {period, value}")])
    try:
        observations = validate_observations(raw)
    except IndexImportError as error:
        raise _unprocessable([error.issue()]) from None
    return await _import_index(db, user, header, observations, source_file_sha256=None)


@index_datasets_router.post("/import-csv", status_code=201)
async def import_index_dataset_csv(
    db: DbDep,
    user: ImporterUser,
    file: Annotated[UploadFile, File()],
    publisher: Annotated[str, Form()],
    series_code: Annotated[str, Form()],
    dataset_version: Annotated[str, Form()],
    source_url: Annotated[str, Form()],
    licence: Annotated[str, Form()],
    retrieved_at: Annotated[str, Form()],
    base_period: Annotated[str, Form()],
    series_name: Annotated[str | None, Form()] = None,
    publication_date: Annotated[str | None, Form()] = None,
    notes: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    """Multipart: `file` is a `period,value` CSV (leading `#` lines are
    comments) plus the header fields as form fields."""
    header = _index_header({
        "publisher": publisher, "series_code": series_code, "series_name": series_name,
        "dataset_version": dataset_version, "source_url": source_url, "licence": licence,
        "publication_date": publication_date, "retrieved_at": retrieved_at,
        "base_period": base_period, "notes": notes,
    })
    text, sha256 = await _read_upload(file)
    try:
        observations = parse_observations_csv(text)
    except IndexImportError as error:
        raise _unprocessable([error.issue()]) from None
    return await _import_index(db, user, header, observations, source_file_sha256=sha256)
