"""R17 benchmark library API (spec Sec 27.6): /benchmark-sets against
in-memory sqlite with the tests/test_auth.py client pattern.

The import document is fixtures/benchmarks/test-elemental-benchmark-set.json
-- the fixture AB set without id/created_at/content_hash, named
'TEST FIXTURE -- NOT MARKET DATA'. Its content hash is pinned to the value
the fixture carries, so the server's hash and both engines' hash agree.
"""
import csv
import io
import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.benchmarks.library import RATE_COLUMNS
from app.financial_model.area_units import SQFT_PER_SQM
from app.financial_model.elemental_benchmark import ELEMENT_CATALOGUE
from tests.test_auth import bearer, client, db_engine, login, seed_user, session_factory  # noqa: F401

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "benchmarks"
SET_PATH = FIXTURES / "test-elemental-benchmark-set.json"
PINNED_HASH = "087c57e76aeb98e5814faf68991481d579a28ad4c650c186f4d38acd9e3d6baf"
BASE = "/api/v1/benchmark-sets"


def load_set() -> dict:
    return json.loads(SET_PATH.read_text(encoding="utf-8"))


@pytest.fixture
async def admin(client, session_factory):  # noqa: F811
    await seed_user(session_factory, email="admin@example.test", role="administrator")
    return bearer(await login(client, "admin@example.test"))


@pytest.fixture
async def underwriter(client, session_factory):  # noqa: F811
    await seed_user(session_factory, email="uw@example.test", role="underwriter")
    return bearer(await login(client, "uw@example.test"))


@pytest.fixture
async def developer(client, session_factory):  # noqa: F811
    await seed_user(session_factory, email="dev@example.test", role="developer")
    return bearer(await login(client, "dev@example.test"))


# --- the fixture itself -----------------------------------------------------------

def test_fixture_is_an_import_document_and_is_labelled():
    doc = load_set()
    assert not {"id", "created_at", "content_hash"} & set(doc)
    assert "TEST FIXTURE" in doc["name"] and "NOT MARKET DATA" in doc["name"]
    assert doc["provider_type"] == "user_qs"
    assert len(doc["rates"]) == 7


# --- auth ---------------------------------------------------------------------------

async def test_unauthenticated_is_401(client):  # noqa: F811
    for method, path in (("GET", BASE), ("GET", BASE + "/template.csv"), ("POST", BASE)):
        resp = await client.request(method, path, json=load_set() if method == "POST" else None)
        assert resp.status_code == 401, (method, path, resp.text)


async def test_developer_post_is_403_but_can_read(client, developer):  # noqa: F811
    resp = await client.post(BASE, json=load_set(), headers=developer)
    assert resp.status_code == 403
    assert (await client.get(BASE, headers=developer)).status_code == 200


async def test_underwriter_may_import(client, underwriter):  # noqa: F811
    resp = await client.post(BASE, json=load_set(), headers=underwriter)
    assert resp.status_code == 201, resp.text
    assert resp.json()["imported_by_user_id"] is not None


# --- import, hash, immutability -------------------------------------------------------

async def test_admin_import_returns_201_with_the_pinned_hash(client, admin):  # noqa: F811
    resp = await client.post(BASE, json=load_set(), headers=admin)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["content_hash"] == PINNED_HASH
    assert body["id"] and body["created_at"]
    assert body["rate_count"] == 7 and len(body["rates"]) == 7
    assert [r["element_code"] for r in body["rates"]] == [r["element_code"] for r in load_set()["rates"]]
    assert body["source_file_sha256"] is None


async def test_supplied_server_fields_are_discarded(client, admin):  # noqa: F811
    doc = load_set()
    doc.update({"id": "client-chosen", "created_at": "1999-01-01", "content_hash": "0" * 64})
    resp = await client.post(BASE, json=doc, headers=admin)
    assert resp.status_code == 201, resp.text
    assert resp.json()["id"] != "client-chosen"
    assert resp.json()["content_hash"] == PINNED_HASH


async def test_identical_repost_is_409_naming_the_first_id(client, admin):  # noqa: F811
    first = await client.post(BASE, json=load_set(), headers=admin)
    assert first.status_code == 201
    first_id = first.json()["id"]
    again = await client.post(BASE, json=load_set(), headers=admin)
    assert again.status_code == 409, again.text
    assert first_id in again.json()["detail"]
    listing = await client.get(BASE, headers=admin)
    assert [s["id"] for s in listing.json()] == [first_id]


async def test_one_rate_change_is_a_new_set_with_a_new_hash(client, admin):  # noqa: F811
    first = await client.post(BASE, json=load_set(), headers=admin)
    doc = load_set()
    doc["rates"][0]["original_rate_pence"] += 1
    second = await client.post(BASE, json=doc, headers=admin)
    assert second.status_code == 201, second.text
    assert second.json()["content_hash"] != PINNED_HASH
    assert second.json()["id"] != first.json()["id"]
    assert len((await client.get(BASE, headers=admin)).json()) == 2


async def test_no_put_or_delete(client, admin):  # noqa: F811
    created = await client.post(BASE, json=load_set(), headers=admin)
    url = f"{BASE}/{created.json()['id']}"
    assert (await client.put(url, json=load_set(), headers=admin)).status_code in (404, 405)
    assert (await client.delete(url, headers=admin)).status_code in (404, 405)


# --- Sec 27.5 rules 10-12 ----------------------------------------------------------------

def _issues(resp) -> dict[str, str]:
    assert resp.status_code == 422, resp.text
    body = resp.json()["detail"]
    assert all(set(i) == {"severity", "field", "message"} for i in body)
    return {i["field"]: i["message"] for i in body}


async def test_bcis_licensed_without_licence_note_is_422(client, admin):  # noqa: F811
    doc = load_set()
    doc["provider_type"] = "bcis_licensed"
    doc["licence_or_permission"] = "   "
    issues = _issues(await client.post(BASE, json=doc, headers=admin))
    assert "licence_or_permission" in issues
    assert "bcis_licensed" in issues["licence_or_permission"]


async def test_public_benchmark_without_source_url_is_422(client, admin):  # noqa: F811
    doc = load_set()
    doc["provider_type"] = "public_benchmark"
    doc["retrieved_at"] = "2026-08-30"
    doc["source_url"] = None
    issues = _issues(await client.post(BASE, json=doc, headers=admin))
    assert set(issues) == {"source_url"}
    doc["source_url"] = "https://example.test/benchmark"
    assert (await client.post(BASE, json=doc, headers=admin)).status_code == 201


async def test_user_qs_without_source_title_is_422(client, admin):  # noqa: F811
    doc = load_set()
    doc["source_title"] = ""
    assert "source_title" in _issues(await client.post(BASE, json=doc, headers=admin))


async def test_unknown_element_code_and_bad_unit_are_422(client, admin):  # noqa: F811
    doc = load_set()
    doc["rates"][0]["element_code"] = "not_an_element"
    doc["rates"][1]["original_unit"] = "pct"
    issues = _issues(await client.post(BASE, json=doc, headers=admin))
    assert "rates.0.element_code" in issues and "rates.1.original_unit" in issues


# --- list, detail, template ---------------------------------------------------------------

async def test_list_and_detail(client, admin):  # noqa: F811
    created = (await client.post(BASE, json=load_set(), headers=admin)).json()
    listing = (await client.get(BASE, headers=admin)).json()
    assert len(listing) == 1 and "rates" not in listing[0]
    assert listing[0]["content_hash"] == PINNED_HASH and listing[0]["rate_count"] == 7
    detail = await client.get(f"{BASE}/{created['id']}", headers=admin)
    assert detail.status_code == 200
    assert detail.json()["rates"] == created["rates"]
    assert "currentised" not in detail.json()
    assert (await client.get(f"{BASE}/not-a-uuid", headers=admin)).status_code == 404


async def test_template_has_39_element_rows(client, admin):  # noqa: F811
    resp = await client.get(f"{BASE}/template.csv", headers=admin)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(resp.text)))
    assert rows[0] == list(RATE_COLUMNS)
    body = rows[1:]
    assert len(body) == 39 == len(ELEMENT_CATALOGUE)
    assert all(r[0] == "#" for r in body)
    assert [r[1] for r in body] == [e.code for e in ELEMENT_CATALOGUE]


# --- CSV import ------------------------------------------------------------------------

def _csv_of(doc: dict) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(RATE_COLUMNS)
    for r in doc["rates"]:
        writer.writerow(["" if r.get(c) is None else r[c] for c in RATE_COLUMNS])
    return out.getvalue().encode("utf-8")


async def test_csv_import_hash_equals_json_import_hash(client, admin):  # noqa: F811
    doc = load_set()
    header = {k: v for k, v in doc.items() if k != "rates"}
    resp = await client.post(
        f"{BASE}/import-csv", headers=admin,
        data={"header": json.dumps(header)},
        files={"file": ("rates.csv", _csv_of(doc), "text/csv")},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["content_hash"] == PINNED_HASH
    assert body["source_file_sha256"] and len(body["source_file_sha256"]) == 64
    again = await client.post(BASE, json=load_set(), headers=admin)
    assert again.status_code == 409 and body["id"] in again.json()["detail"]


async def test_csv_import_with_missing_column_is_422(client, admin):  # noqa: F811
    doc = load_set()
    header = {k: v for k, v in doc.items() if k != "rates"}
    resp = await client.post(
        f"{BASE}/import-csv", headers=admin,
        data={"header": json.dumps(header)},
        files={"file": ("rates.csv", b"id,element_code\nx,substructure\n", "text/csv")},
    )
    issues = _issues(resp)
    assert "missing column" in issues["file"]


# --- the derived read -----------------------------------------------------------------------

async def test_derived_read_applies_factor_and_multiplier_and_writes_nothing(client, admin):  # noqa: F811
    doc = load_set()
    assert doc["base_index_value"] == 120.0 and doc["location_factor"] == 95.0
    created = (await client.post(BASE, json=doc, headers=admin)).json()
    before = deepcopy(created)
    url = f"{BASE}/{created['id']}"
    resp = await client.get(url, headers=admin, params={
        "currentisation_date": "2026-08-01", "current_index_value": 132.0,
    })
    assert resp.status_code == 200, resp.text
    derived = resp.json()["currentised"]
    assert derived["currentisation_factor"] == pytest.approx(1.1)
    assert derived["currentisation_method"] == "index_ratio"
    assert derived["currentisation_date"] == "2026-08-01"
    by_code = {row["element_code"]: row for row in derived["rows"]}
    for rate in doc["rates"]:
        row = by_code[rate["element_code"]]
        if rate["measurement_basis"] == "percentage":
            assert row["currentised_rate_pence"] is None and row["rate_pct"] == rate["rate_pct"]
            continue
        lf = rate["location_factor"] if rate["location_factor"] is not None else doc["location_factor"]
        canonical = rate["original_rate_pence"] * (SQFT_PER_SQM if rate["original_unit"] == "gbp_per_sqft" else 1)
        assert row["location_multiplier"] == pytest.approx(lf / 100)
        assert row["currentised_rate_pence"] == pytest.approx(canonical * 1.1 * lf / 100)
    # Nothing was stored: the plain read is byte-for-byte what was created.
    after = (await client.get(url, headers=admin)).json()
    assert after == before
    assert after["current_index_value"] == doc["current_index_value"]


async def test_derived_read_requires_both_parameters(client, admin):  # noqa: F811
    created = (await client.post(BASE, json=load_set(), headers=admin)).json()
    url = f"{BASE}/{created['id']}"
    assert "current_index_value" in _issues(
        await client.get(url, headers=admin, params={"currentisation_date": "2026-08-01"})
    )
    assert "current_index_value" in _issues(
        await client.get(url, headers=admin, params={"currentisation_date": "2026-08-01", "current_index_value": 0})
    )
    assert "currentisation_date" in _issues(
        await client.get(url, headers=admin, params={"currentisation_date": "August", "current_index_value": 1})
    )


async def test_a_set_read_back_from_the_library_reproduces_its_content_hash(client, admin):  # noqa: F811
    """R17 spec Sec 27.6: the row UUID is not the rate's id; the import document's
    id is kept as rate_key so the read-back document hashes to the stored hash."""
    from app.financial_model.elemental_benchmark import benchmark_content_hash
    doc = load_set()
    created = (await client.post("/api/v1/benchmark-sets", json=doc, headers=admin)).json()
    read = (await client.get(f"/api/v1/benchmark-sets/{created['id']}", headers=admin)).json()
    assert [r["id"] for r in read["rates"]] == [r["id"] for r in doc["rates"]]
    assert benchmark_content_hash(read) == created["content_hash"]
