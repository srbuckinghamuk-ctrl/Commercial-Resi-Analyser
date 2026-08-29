"""R16b spec Sec 26.7. The v15 -> v16 shape tests (Task 2); the corpus-wide
gate follows in Task 3 in this same file."""
import json
from pathlib import Path

import pytest

from app.financial_model.migrate import (
    _V16_REMOVED_COST_FIELDS,
    is_v16,
    is_v2_or_later,
    migrate_inputs_to_v15,
    migrate_inputs_to_v16,
    migrate_v15_to_v16,
)

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
    v16 = migrate_inputs_to_v16(_raw_q(), None).model_dump(mode="json")
    spiked = {**v16, "conversion_costs": {**v16["conversion_costs"], "architect_pence": 1}}
    assert is_v16(spiked) is True
    assert "architect_pence" not in migrate_inputs_to_v16(spiked, None).model_dump(mode="json")["conversion_costs"]


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
