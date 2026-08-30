"""R17 index datasets (spec Sec 27.6, design decision 9, Sec 27.9
limitation 3): the parser's five documented 422s against the five CSV
fixtures, the /index-datasets routes, the seed command's idempotence, and
the invariants of the committed ONS OPI extraction.
"""
import importlib.util
import json
from pathlib import Path

import pytest

from app.benchmarks.index_import import (
    MSG_BAD_HEADER,
    IndexImportError,
    index_content_hash,
    msg_bad_period,
    msg_bad_value,
    msg_duplicate,
    msg_not_increasing,
    parse_observations_csv,
    validate_observations,
)
from app.benchmarks.seed import seed_directory
from app.persistence.repositories import IndexDatasetRepository
from tests.test_auth import bearer, client, db_engine, login, seed_user, session_factory  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "benchmarks"
DATA_DIR = ROOT / "data" / "index-datasets"
ONS_JSON = DATA_DIR / "ons-construction-opi-2026q2.json"
SCRIPT = ROOT / "scripts" / "ons_opi_to_json.py"
BASE = "/api/v1/index-datasets"

SOURCE_SHA256 = "ea0cbfe6573be52210ea0469f182ac5f03c68af39b193ab0f328feb24626edde"
PROXY_STATEMENT = (
    "ONS Construction Output Price Index — a public currentisation proxy; "
    "not BCIS TPI and not an elemental-cost dataset."
)
SERIES_CODES = {
    "all_new_work", "all_repair_maintenance", "all_construction", "new_housing",
    "new_public_other", "new_private_industrial", "new_private_commercial",
    "new_infrastructure", "rm_housing", "rm_non_housing",
}
FIRST_LAST = {"all_new_work": (100.5, 150.9), "all_construction": (100.4, 146.4), "new_housing": (100.5, 158.4)}

HEADER = {
    "publisher": "Test publisher", "series_code": "test_series", "series_name": "Test series",
    "dataset_version": "v1", "source_url": "https://example.test/index",
    "licence": "TEST FIXTURE — NOT MARKET DATA", "publication_date": "2024-07-01",
    "retrieved_at": "2024-07-02", "base_period": "2024-01=100",
}


@pytest.fixture
async def admin(client, session_factory):  # noqa: F811
    await seed_user(session_factory, email="admin@example.test", role="administrator")
    return bearer(await login(client, "admin@example.test"))


@pytest.fixture
async def developer(client, session_factory):  # noqa: F811
    await seed_user(session_factory, email="dev@example.test", role="developer")
    return bearer(await login(client, "dev@example.test"))


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def valid_rows() -> list[dict]:
    return parse_observations_csv(fixture_text("index-import-valid.csv"))


# --- parser: the five documented messages -------------------------------------------

def test_valid_fixture_parses_in_order_and_skips_comment_lines():
    rows = valid_rows()
    assert [r["period"] for r in rows] == ["2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06"]
    assert rows[0]["value"] == 100.0 and rows[-1]["value"] == 102.8


@pytest.mark.parametrize("fixture, message", [
    ("index-import-bad-header.csv", MSG_BAD_HEADER),
    ("index-import-non-monotonic.csv", msg_not_increasing("2024-02", "2024-03")),
    ("index-import-duplicate-period.csv", msg_duplicate("2024-02")),
    ("index-import-zero-value.csv", msg_bad_value("2024-02")),
])
def test_parser_messages_are_exact(fixture, message):
    with pytest.raises(IndexImportError) as excinfo:
        parse_observations_csv(fixture_text(fixture))
    assert excinfo.value.message == message


def test_bad_period_message_is_exact():
    with pytest.raises(IndexImportError) as excinfo:
        validate_observations([{"period": "2024-13", "value": 1}])
    assert excinfo.value.message == msg_bad_period("2024-13")
    with pytest.raises(IndexImportError) as excinfo:
        validate_observations([{"period": "2024-1", "value": 1}])
    assert excinfo.value.message == "index import: period '2024-1' is not YYYY-MM"


def test_message_texts_are_the_documented_five():
    assert MSG_BAD_HEADER == "index import: column header must be exactly 'period,value'"
    assert msg_bad_period("x") == "index import: period 'x' is not YYYY-MM"
    assert msg_not_increasing("a", "b") == "index import: periods must be strictly increasing (found 'a' after 'b')"
    assert msg_duplicate("p") == "index import: duplicate period 'p'"
    assert msg_bad_value("p") == "index import: value for 'p' must be a finite number greater than zero"


def test_non_finite_and_non_numeric_values_are_rejected():
    for bad in ("nan", "inf", "-1", "abc", "", None, True):
        with pytest.raises(IndexImportError) as excinfo:
            validate_observations([{"period": "2024-01", "value": bad}])
        assert excinfo.value.message == msg_bad_value("2024-01")


def test_csv_hash_equals_json_hash():
    csv_rows = valid_rows()
    json_rows = validate_observations([
        {"period": "2024-01", "value": 100}, {"period": "2024-02", "value": "100.4"},
        {"period": "2024-03", "value": 101.1}, {"period": "2024-04", "value": 101.9},
        {"period": "2024-05", "value": 102.2}, {"period": "2024-06", "value": 102.8},
    ])
    assert index_content_hash(HEADER, csv_rows) == index_content_hash(HEADER, json_rows)
    assert index_content_hash({**HEADER, "dataset_version": "v2"}, csv_rows) != index_content_hash(HEADER, csv_rows)


# --- API ------------------------------------------------------------------------------

async def test_unauthenticated_is_401(client):  # noqa: F811
    assert (await client.get(BASE, headers={})).status_code == 401
    assert (await client.post(BASE, json={**HEADER, "observations": []})).status_code == 401


async def test_developer_post_is_403(client, developer):  # noqa: F811
    resp = await client.post(BASE, json={**HEADER, "observations": valid_rows()}, headers=developer)
    assert resp.status_code == 403


async def test_json_import_201_then_duplicate_version_409(client, admin):  # noqa: F811
    resp = await client.post(BASE, json={**HEADER, "observations": valid_rows()}, headers=admin)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["observation_count"] == 6 and body["first_period"] == "2024-01" and body["last_period"] == "2024-06"
    assert body["content_hash"] == index_content_hash(HEADER, valid_rows())
    assert body["source_file_sha256"] is None
    again = await client.post(BASE, json={**HEADER, "observations": valid_rows()}, headers=admin)
    assert again.status_code == 409 and body["id"] in again.json()["detail"]
    detail = (await client.get(f"{BASE}/{body['id']}", headers=admin)).json()
    assert detail["observations"] == valid_rows()
    listing = (await client.get(BASE, headers=admin)).json()
    assert [d["id"] for d in listing] == [body["id"]] and "observations" not in listing[0]


async def _import_csv(client, headers, name: str, **overrides):  # noqa: F811
    form = {k: v for k, v in {**HEADER, **overrides}.items() if v is not None}
    return await client.post(
        f"{BASE}/import-csv", headers=headers, data=form,
        files={"file": (name, fixture_text(name).encode("utf-8"), "text/csv")},
    )


async def test_csv_import_hash_equals_json_import_hash(client, admin):  # noqa: F811
    resp = await _import_csv(client, admin, "index-import-valid.csv")
    assert resp.status_code == 201, resp.text
    assert resp.json()["content_hash"] == index_content_hash(HEADER, valid_rows())
    assert len(resp.json()["source_file_sha256"]) == 64
    dup = await client.post(BASE, json={**HEADER, "observations": valid_rows()}, headers=admin)
    assert dup.status_code == 409


@pytest.mark.parametrize("fixture, message", [
    ("index-import-bad-header.csv", MSG_BAD_HEADER),
    ("index-import-non-monotonic.csv", msg_not_increasing("2024-02", "2024-03")),
    ("index-import-duplicate-period.csv", msg_duplicate("2024-02")),
    ("index-import-zero-value.csv", msg_bad_value("2024-02")),
])
async def test_the_422_messages_over_the_api(client, admin, fixture, message):  # noqa: F811
    resp = await _import_csv(client, admin, fixture)
    assert resp.status_code == 422, resp.text
    issues = resp.json()["detail"]
    assert [i["message"] for i in issues] == [message]
    assert issues[0]["severity"] == "error"


async def test_bad_period_over_the_api(client, admin):  # noqa: F811
    resp = await client.post(
        BASE, json={**HEADER, "observations": [{"period": "2024/01", "value": 1}]}, headers=admin,
    )
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["message"] == msg_bad_period("2024/01")


async def test_missing_header_fields_are_422(client, admin):  # noqa: F811
    resp = await client.post(BASE, json={"observations": valid_rows()}, headers=admin)
    assert resp.status_code == 422
    assert {i["field"] for i in resp.json()["detail"]} >= {"publisher", "series_code", "dataset_version"}


async def test_ons_sample_imports_in_order(client, admin):  # noqa: F811
    resp = await _import_csv(
        client, admin, "ons-opi-2026q2-sample.csv",
        publisher="Office for National Statistics", series_code="all_new_work",
        dataset_version="2026-Q2-sample", base_period="2015=100",
        licence="Open Government Licence v3.0", source_url=json.loads(ONS_JSON.read_text(encoding="utf-8"))["source_url"],
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    periods = [o["period"] for o in body["observations"]]
    assert len(periods) == 12 and periods == sorted(periods)
    assert periods[0] == "2025-07" and periods[-1] == "2026-06"
    assert body["observations"][-1]["value"] == 150.9
    ons = json.loads(ONS_JSON.read_text(encoding="utf-8"))
    anw = next(s for s in ons["series"] if s["series_code"] == "all_new_work")["observations"][-12:]
    assert body["observations"] == anw


async def test_no_put_or_delete(client, admin):  # noqa: F811
    created = await client.post(BASE, json={**HEADER, "observations": valid_rows()}, headers=admin)
    url = f"{BASE}/{created.json()['id']}"
    assert (await client.put(url, json={}, headers=admin)).status_code in (404, 405)
    assert (await client.delete(url, headers=admin)).status_code in (404, 405)


# --- seed -------------------------------------------------------------------------------

async def test_seed_is_idempotent_and_creates_ten_datasets(session_factory, client, admin):  # noqa: F811
    async with session_factory() as session:
        first = await seed_directory(session, DATA_DIR)
        await session.commit()
    assert first.inserted_count == 10 and first.skipped_count == 0
    async with session_factory() as session:
        second = await seed_directory(session, DATA_DIR)
        await session.commit()
        assert second.inserted_count == 0 and second.skipped_count == 10
        assert await IndexDatasetRepository(session).count() == 10
    listing = (await client.get(BASE, headers=admin)).json()
    assert {d["series_code"] for d in listing} == SERIES_CODES
    assert all(d["observation_count"] == 150 for d in listing)
    assert all(d["source_file_sha256"] == SOURCE_SHA256 for d in listing)
    assert all(d["dataset_version"] == "2026-Q2" and "Open Government Licence" in d["licence"] for d in listing)
    assert all(PROXY_STATEMENT in d["notes"] for d in listing)
    anw = next(d for d in listing if d["series_code"] == "all_new_work")
    detail = (await client.get(f"{BASE}/{anw['id']}", headers=admin)).json()
    assert detail["first_period"] == "2014-01" and detail["last_period"] == "2026-06"
    assert detail["observations"][0]["value"] == 100.5 and detail["observations"][-1]["value"] == 150.9


# --- the committed ONS extraction -------------------------------------------------------------

def test_committed_ons_json_invariants():
    doc = json.loads(ONS_JSON.read_text(encoding="utf-8"))
    assert doc["publisher"] == "Office for National Statistics"
    assert doc["dataset_version"] == "2026-Q2"
    assert doc["source_file_sha256"] == SOURCE_SHA256
    assert doc["publication_date"] == "2026-08-13" and doc["retrieved_at"] == "2026-08-30"
    assert doc["licence"].startswith("Open Government Licence v3.0")
    assert doc["base_period"] == "2015=100"
    assert doc["proxy_statement"] == PROXY_STATEMENT
    assert doc["source_url"].endswith("bulletindataset9.xlsx")
    series = doc["series"]
    assert {s["series_code"] for s in series} == SERIES_CODES and len(series) == 10
    for s in series:
        obs = validate_observations(s["observations"])  # shape, unique, increasing, > 0
        assert len(obs) == 150
        assert obs[0]["period"] == "2014-01" and obs[-1]["period"] == "2026-06"
        assert s["series_name"]
    for code, (first, last) in FIRST_LAST.items():
        obs = next(s for s in series if s["series_code"] == code)["observations"]
        assert (obs[0]["value"], obs[-1]["value"]) == (first, last)


def test_script_period_parser_and_proxy_statement_match_the_json():
    spec = importlib.util.spec_from_file_location("ons_opi_to_json", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module._periods(["2014 Jan", "Feb", "Mar", "2015 Jan", ""]) == ["2014-01", "2014-02", "2014-03", "2015-01"]
    assert module.PROXY_STATEMENT == PROXY_STATEMENT
    assert module.SOURCE_URL == json.loads(ONS_JSON.read_text(encoding="utf-8"))["source_url"]
    assert {s[0] for s in module.SERIES} == SERIES_CODES
