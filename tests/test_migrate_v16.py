"""R16b spec Sec 26.7. The v15 -> v16 shape tests (Task 2); the corpus-wide
gate follows in Task 3 in this same file."""
import json
from dataclasses import asdict
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.financial_model import run_appraisal
from app.financial_model.migrate import (
    _V16_REMOVED_COST_FIELDS,
    is_v16,
    is_v2_or_later,
    migrate_inputs_to_v15,
    migrate_inputs_to_v16,
    migrate_v15_to_v16,
)
from app.financial_model.validation import validate_inputs

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _raw_q() -> dict:
    return _load_fixture(FIXTURE_DIR / "q-detailed-cost-plan.json")["inputs"]


def test_removes_exactly_the_nine_keys_on_q_and_q_carried_all_nine():
    """The one-arm proof, on the dumped dict (Model ignores extras, so the
    parsed model cannot show a key's absence)."""
    before = migrate_inputs_to_v15(_raw_q(), None).model_dump(mode="json")
    assert all(k in before["conversion_costs"] for k in _V16_REMOVED_COST_FIELDS)
    after = migrate_v15_to_v16(before).model_dump(mode="json")
    assert after["inputs_version"] == 16
    assert not any(k in after["conversion_costs"] for k in _V16_REMOVED_COST_FIELDS)
    assert sorted(after["conversion_costs"]) == [
        "construction_cost_per_sqm_pence", "fire_safety_pence", "part_l_compliance_pence",
        "sound_insulation_pence", "total_construction_sqm",
    ]
    for k in after["conversion_costs"]:
        assert after["conversion_costs"][k] == before["conversion_costs"][k], k
    before.pop("inputs_version"), before.pop("conversion_costs")
    after.pop("inputs_version"), after.pop("conversion_costs")
    assert before == after


def test_is_v16_refuses_a_spoofed_relabel_that_still_carries_contingency_pct():
    v16 = migrate_inputs_to_v16(_raw_q(), None).model_dump(mode="json")
    assert is_v16(v16) is True
    assert is_v16({**v16, "conversion_costs": {**v16["conversion_costs"], "contingency_pct": 10.0}}) is False
    assert is_v16({**v16, "inputs_version": 15}) is False
    assert is_v16({k: v for k, v in v16.items() if k != "due_diligence"}) is False


def test_the_is_v16_merge_branch_rebuilds_conversion_costs():
    """Review fix: spikes a key OUTSIDE the nine removed ones
    (`demolition_pence`, not a real ConversionCostInputs field at all) --
    `architect_pence` is one of the nine, so a naive delete-nine-keys
    implementation would ALSO pass with it spiked, leaving the "an
    unexpected tenth legacy key cannot ride through" property untested."""
    v16 = migrate_inputs_to_v16(_raw_q(), None).model_dump(mode="json")
    spiked = {**v16, "conversion_costs": {**v16["conversion_costs"], "demolition_pence": 1}}
    assert is_v16(spiked) is True
    assert "demolition_pence" not in migrate_inputs_to_v16(spiked, None).model_dump(mode="json")["conversion_costs"]


def test_is_v2_or_later_recognises_v16():
    assert is_v2_or_later(migrate_inputs_to_v16(_raw_q(), None).model_dump(mode="json")) is True


def test_migrate_inputs_to_v16_refuses_an_unrecognised_version():
    with pytest.raises(ValueError, match="unrecognised inputs_version 17"):
        migrate_inputs_to_v16({"inputs_version": 17})


def test_migrate_inputs_to_v16_refuses_a_document_tagged_v16_that_fails_the_structural_check():
    with pytest.raises(ValueError, match="fails the v16 structural check"):
        migrate_inputs_to_v16({"inputs_version": 16})


def test_migrate_v15_to_v16_refuses_double_migration():
    v16 = migrate_inputs_to_v16(_raw_q(), None)
    with pytest.raises(ValueError, match="already a v16 document"):
        migrate_v15_to_v16(v16)


def test_a_negative_legacy_fee_on_a_raw_v6_document_is_refused_at_the_model_boundary():
    """TS twin: migrate.test.ts's "a negative legacy fee on a raw v6 document
    is still reported, through the seeded fee line" (Step 11's pre-v7 hole
    check, spec Sec 26.7). Python's `ConversionCostInputs` (the v1 shape
    every pre-v16 document's `conversion_costs` uses) declares
    `architect_pence: int = Field(ge=0)`, so a negative value never survives
    parsing to reach `validate_inputs`'s new `else` branch at all -- it is
    refused earlier, at the `CalculatorInputsV6` model boundary, as a
    pydantic `ValidationError`. Kept as a test of THAT boundary (not of
    `validate_inputs`), the same pattern
    `test_migrate_v15.py::test_property_3_a_fractional_programme_slip_is_structurally_unreachable_in_python`
    uses: the TS engine's `else` branch CAN reach its own version of this
    check (TS has no field-level `ge=0` constraint), and its test asserts
    the `ValidationIssue` there; Python asserts the `ValidationError`
    instead."""
    raw_n = _load_fixture(FIXTURE_DIR / "n-area-bridge.json")["inputs"]
    spiked = {**raw_n, "conversion_costs": {**raw_n["conversion_costs"], "architect_pence": -1}}
    with pytest.raises(ValidationError):
        migrate_inputs_to_v16(spiked, None)


# --- Task 3: v16 identity gate, corpus-wide ---

ALL_FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))
_FIXTURE_DOCS: dict[Path, dict] = {p: _load_fixture(p) for p in ALL_FIXTURES}
FIXTURES = [
    p for p in ALL_FIXTURES
    if "inputs" in _FIXTURE_DOCS[p]
    and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) <= 15
]


def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    assert len(FIXTURES) >= 20
    assert [p.stem for p in ALL_FIXTURES
            if "inputs" in _FIXTURE_DOCS[p] and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) > 15] == ["ab-elemental-benchmark"]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_numeric_identity_corpus_wide(path):
    """Sec 26.7: NO exclusion -- not even calc_version, the same constant on
    both arms."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v15_run = run_appraisal(migrate_inputs_to_v15(raw, None))
    v16_run = run_appraisal(migrate_inputs_to_v16(raw, None))
    assert asdict(v15_run.metrics) == asdict(v16_run.metrics), f"{path.stem}: metrics moved"
    assert asdict(v15_run.model) == asdict(v16_run.model), f"{path.stem}: a ledger figure moved"
    assert asdict(v15_run.schedule) == asdict(v16_run.schedule), f"{path.stem}: a schedule figure moved"


@pytest.mark.parametrize("stem", ["f-dev-finance-12mo", "u-investment-case-ltv-binds", "y-due-diligence", "z-cost-plan-in-time"])
def test_the_default_sensitivity_suite_is_identical_on_both_arms(stem):
    from app.financial_model.sensitivity import run_sensitivity
    raw = _load_fixture(FIXTURE_DIR / f"{stem}.json")["inputs"]
    assert asdict(run_sensitivity(migrate_inputs_to_v15(raw, None))) == asdict(run_sensitivity(migrate_inputs_to_v16(raw, None)))


V15_ONLY_RULES = [
    "conversion_costs.contingency_pct",
    "conversion_costs.prior_approval_fee_per_dwelling_pence", "conversion_costs.cil_s106_pence",
    "conversion_costs.architect_pence", "conversion_costs.structural_engineer_pence",
    "conversion_costs.mande_pence", "conversion_costs.planning_consultant_pence",
    "conversion_costs.building_control_pence", "conversion_costs.other_professional_fees_pence",
]
V16_ONLY_RULES: list[str] = []


def test_the_exception_lists_are_exactly_nine_and_exactly_zero():
    assert len(V15_ONLY_RULES) == 9
    assert len(V16_ONLY_RULES) == 0


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_validation_properties_1_to_3(path):
    raw = _FIXTURE_DOCS[path]["inputs"]
    v15_issues = validate_inputs(migrate_inputs_to_v15(raw, None))
    v16_issues = validate_inputs(migrate_inputs_to_v16(raw, None))
    v15_kept = {(i.severity, i.field, i.message) for i in v15_issues if i.field not in V15_ONLY_RULES}
    assert {(i.severity, i.field, i.message) for i in v16_issues} == v15_kept
    assert [i for i in v16_issues if i.field in V15_ONLY_RULES] == []
    assert [i for i in v16_issues if i.field in V16_ONLY_RULES] == []


def test_the_removed_fields_were_unread():
    """A v15 document with absurd values in the removed fields computes the
    same figures -- the assertion that fails if any v7+ path still reads one.
    (Python's Field(ge=0) forbids a NEGATIVE value at parse time, which is why
    the spike is a huge positive one.)"""
    raw = _raw_q()
    v15 = migrate_inputs_to_v15(raw, None).model_dump(mode="json")
    spiked = {**v15, "conversion_costs": {**v15["conversion_costs"], "architect_pence": 999_999_999, "contingency_pct": 99.0}}
    assert asdict(run_appraisal(migrate_inputs_to_v15(spiked, None)).metrics) == asdict(run_appraisal(migrate_inputs_to_v15(raw, None)).metrics)
