"""R17 spec Sec 27.7. The v16 -> v17 shape tests and the corpus-wide identity
gate, the Python twin of migrate.test.ts's two v17 describe blocks. Follows
tests/test_migrate_v16.py test for test."""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.migrate import (
    is_v17,
    is_v2_or_later,
    migrate_inputs_to_v16,
    migrate_inputs_to_v17,
    migrate_v16_to_v17,
)
from app.financial_model.types import BenchmarkOrigin, SchemeElementalBenchmark
from app.financial_model.validation import validate_inputs

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _raw_q() -> dict:
    return _load_fixture(FIXTURE_DIR / "q-detailed-cost-plan.json")["inputs"]


def _raw_z() -> dict:
    return _load_fixture(FIXTURE_DIR / "z-cost-plan-in-time.json")["inputs"]


def _strip_v17(doc: dict) -> dict:
    """The document with the three v17 additions removed and inputs_version
    set aside. Applied to BOTH arms: pydantic declares `benchmark_origin` on
    CostPackage and the two record lists on DueDiligenceInputs with defaults,
    so a v16 model_dump already shows them (the parsed model cannot show a
    key's absence -- the same caveat test_migrate_v16.py records)."""
    out = {k: v for k, v in doc.items() if k not in ("inputs_version", "elemental_benchmark")}
    out["cost_plan"] = {
        **doc["cost_plan"],
        "packages": [{k: v for k, v in p.items() if k != "benchmark_origin"} for p in doc["cost_plan"]["packages"]],
    }
    out["due_diligence"] = {
        k: v for k, v in doc["due_diligence"].items() if k not in ("source_records", "source_resolutions")
    }
    return out


@pytest.mark.parametrize("raw", [_raw_q(), _raw_z()], ids=["Q (v7)", "Z (v14)"])
def test_adds_exactly_the_three_keys_all_inert_and_nothing_else_moves(raw):
    """The one-arm proof, on the dumped dict."""
    before = migrate_inputs_to_v16(raw, None).model_dump(mode="json")
    after = migrate_inputs_to_v17(raw, None).model_dump(mode="json")
    assert after["inputs_version"] == 17
    assert "elemental_benchmark" in after
    assert after["elemental_benchmark"] is None
    assert len(after["cost_plan"]["packages"]) > 0
    for p in after["cost_plan"]["packages"]:
        assert "benchmark_origin" in p, p["id"]
        assert p["benchmark_origin"] is None, p["id"]
    assert after["due_diligence"]["source_records"] == []
    assert after["due_diligence"]["source_resolutions"] == []
    assert _strip_v17(after) == _strip_v17(before)


def test_is_v17_refuses_a_spoofed_relabel_that_lacks_any_one_of_the_written_keys():
    v17 = migrate_inputs_to_v17(_raw_q(), None).model_dump(mode="json")
    assert is_v17(v17) is True
    assert is_v17({**v17, "inputs_version": 16}) is False
    assert is_v17({k: v for k, v in v17.items() if k != "elemental_benchmark"}) is False
    packages = v17["cost_plan"]["packages"]
    assert len(packages) > 0
    first_stripped = {k: v for k, v in packages[0].items() if k != "benchmark_origin"}
    assert is_v17({**v17, "cost_plan": {**v17["cost_plan"], "packages": [first_stripped, *packages[1:]]}}) is False
    dd_no_records = {k: v for k, v in v17["due_diligence"].items() if k != "source_records"}
    assert is_v17({**v17, "due_diligence": dd_no_records}) is False


def _benchmark_block() -> dict:
    """The same values as the TS test's `block`, through the pydantic models
    so the comparison is on a complete, defaulted dump."""
    return SchemeElementalBenchmark.model_validate({
        "set": {
            "id": "set-1",
            "name": "TEST FIXTURE -- NOT MARKET DATA",
            "provider_type": "user_qs",
            "provider_name": "Test QS",
            "source_title": "Test cost plan",
            "source_url": None,
            "source_publication_date": None,
            "retrieved_at": None,
            "licence_or_permission": "test",
            "dataset_version": "1",
            "building_function": "residential",
            "project_type": "conversion",
            "specification_level": "standard",
            "region": "UK",
            "location_factor": None,
            "location_factor_source": None,
            "base_date": "2026-01",
            "base_index_name": None,
            "base_index_value": None,
            "current_index_name": None,
            "current_index_value": None,
            "index_dataset_version": None,
            "currentisation_date": None,
            "currency": "GBP",
            "notes": "",
            "imported_by": "test",
            "created_at": "2026-08-30T00:00:00Z",
            "source_file_sha256": None,
            "content_hash": "deadbeef",
            "rates": [{
                "id": "r1",
                "element_code": "strip_out",
                "element_label": "Strip-out",
                "description": "",
                "measurement_basis": "area",
                "original_unit": "gbp_per_sqm",
                "original_rate_pence": 100_000,
                "rate_pct": None,
                "lower_quartile_rate_pence": None,
                "median_rate_pence": None,
                "upper_quartile_rate_pence": None,
                "sample_count": None,
                "location_factor": None,
                "evidence_status": "unverified",
                "source_reference": "",
                "notes": "",
            }],
        },
        "selections": [{
            "element_code": "strip_out",
            "benchmark_rate_id": "r1",
            "quantity": 100,
            "quantity_unit": "sqm",
            "adjustment_pct": 0,
            "adjustment_reason": "",
            "include_in_cost_plan": False,
            "target_cost_package_id": None,
            "selected_by": "",
            "selected_at": "",
        }],
        "thresholds": {"material_variance_pct": 15, "stale_after_months": 12, "min_coverage_pct": 60},
        "applications": [],
        "library_set_id": None,
    }).model_dump(mode="json")


def _origin() -> dict:
    return BenchmarkOrigin.model_validate({
        "kind": "benchmark",
        "set_id": "set-1",
        "set_content_hash": "deadbeef",
        "benchmark_rate_id": "r1",
        "element_code": "strip_out",
        "applied_at": "2026-08-30T00:00:00Z",
        "applied_by": "test",
        "currentisation_method": "none",
    }).model_dump(mode="json")


def test_the_is_v17_merge_branch_preserves_a_saved_benchmark_block_and_a_saved_package_origin():
    v17 = migrate_inputs_to_v17(_raw_q(), None).model_dump(mode="json")
    block, origin = _benchmark_block(), _origin()
    first, *others = v17["cost_plan"]["packages"]
    saved = {
        **v17,
        "elemental_benchmark": block,
        "cost_plan": {**v17["cost_plan"], "packages": [{**first, "benchmark_origin": origin}, *others]},
    }
    assert is_v17(saved) is True
    again = migrate_inputs_to_v17(saved, None).model_dump(mode="json")
    assert json.dumps(again["elemental_benchmark"], sort_keys=True) == json.dumps(block, sort_keys=True)
    assert json.dumps(again["cost_plan"]["packages"][0]["benchmark_origin"], sort_keys=True) == json.dumps(origin, sort_keys=True)
    for p in again["cost_plan"]["packages"][1:]:
        assert p["benchmark_origin"] is None, p["id"]


def test_is_v2_or_later_recognises_v17():
    assert is_v2_or_later(migrate_inputs_to_v17(_raw_q(), None).model_dump(mode="json")) is True


def test_migrate_inputs_to_v17_refuses_an_unrecognised_version():
    with pytest.raises(ValueError, match="unrecognised inputs_version 18"):
        migrate_inputs_to_v17({"inputs_version": 18})


def test_migrate_inputs_to_v17_refuses_a_document_tagged_v17_that_fails_the_structural_check():
    with pytest.raises(ValueError, match="fails the v17 structural check"):
        migrate_inputs_to_v17({"inputs_version": 17})


def test_migrate_v16_to_v17_refuses_double_migration():
    v17 = migrate_inputs_to_v17(_raw_q(), None)
    with pytest.raises(ValueError, match="already a v17 document"):
        migrate_v16_to_v17(v17)
    with pytest.raises(ValueError, match="already a v17 document"):
        migrate_v16_to_v17(v17.model_dump(mode="json"))


# --- v17 identity gate, corpus-wide ---

ALL_FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))
_FIXTURE_DOCS: dict[Path, dict] = {p: _load_fixture(p) for p in ALL_FIXTURES}
FIXTURES = [
    p for p in ALL_FIXTURES
    if "inputs" in _FIXTURE_DOCS[p]
    and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) <= 16
]


def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    """R17 spec Sec 27.8 adds the v17-native fixture AB, above this gate's
    `<= 16` filter for the same reason Z sat above the v13 gate's. Named
    exactly: any OTHER fixture above the filter is a silent shrink, not an
    authoring."""
    assert len(FIXTURES) >= 20
    version_excluded = [
        p for p in ALL_FIXTURES
        if "inputs" in _FIXTURE_DOCS[p]
        and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) > 16
    ]
    assert sorted(p.stem for p in version_excluded) == ["ab-elemental-benchmark"]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_numeric_identity_corpus_wide(path):
    """Sec 27.7: NO exclusion -- not even calc_version, the same constant on
    both arms. `metrics.elemental_benchmark` is compared PRESENT AND None on
    both arms: a later change that synthesises a result block for a document
    with no input block fails here, not silently."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v16_run = run_appraisal(migrate_inputs_to_v16(raw, None))
    v17_run = run_appraisal(migrate_inputs_to_v17(raw, None))
    assert v16_run.metrics.elemental_benchmark is None, f"{path.stem}: v16 arm synthesised a benchmark block"
    assert v17_run.metrics.elemental_benchmark is None, f"{path.stem}: v17 arm synthesised a benchmark block"
    assert asdict(v16_run.metrics) == asdict(v17_run.metrics), f"{path.stem}: metrics moved"
    assert asdict(v16_run.model) == asdict(v17_run.model), f"{path.stem}: a ledger figure moved"
    assert asdict(v16_run.schedule) == asdict(v17_run.schedule), f"{path.stem}: a schedule figure moved"


@pytest.mark.parametrize("stem", ["f-dev-finance-12mo", "u-investment-case-ltv-binds", "y-due-diligence", "z-cost-plan-in-time"])
def test_the_default_sensitivity_suite_is_identical_on_both_arms(stem):
    from app.financial_model.sensitivity import run_sensitivity
    raw = _load_fixture(FIXTURE_DIR / f"{stem}.json")["inputs"]
    assert asdict(run_sensitivity(migrate_inputs_to_v16(raw, None))) == asdict(run_sensitivity(migrate_inputs_to_v17(raw, None)))


# Nothing is removed and the three additions are inert (None / [] on every
# migrated document), so BOTH exception lists are empty, and asserted empty.
V16_ONLY_RULES: list[str] = []
V17_ONLY_RULES: list[str] = []


def test_the_exception_lists_are_exactly_zero_and_exactly_zero():
    assert len(V16_ONLY_RULES) == 0
    assert len(V17_ONLY_RULES) == 0


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_validation_properties_1_to_3(path):
    raw = _FIXTURE_DOCS[path]["inputs"]
    v16_issues = validate_inputs(migrate_inputs_to_v16(raw, None))
    v17_issues = validate_inputs(migrate_inputs_to_v17(raw, None))
    v16_kept = {(i.severity, i.field, i.message) for i in v16_issues if i.field not in V16_ONLY_RULES}
    assert {(i.severity, i.field, i.message) for i in v17_issues} == v16_kept
    assert [i for i in v17_issues if i.field in V16_ONLY_RULES] == []
    assert [i for i in v17_issues if i.field in V17_ONLY_RULES] == []
