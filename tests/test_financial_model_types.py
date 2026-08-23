"""R13 spec Sec 19.1. The v10 input shape: the investment case and the two
refinance narrowings."""
import json
from pathlib import Path

from app.financial_model.migrate import migrate_inputs_to_v9


def _minimal_v10_doc() -> dict:
    """A valid v10 document, built by taking a real fixture up to v9 through the
    existing migration chain and then applying v10's own additions by hand.

    Built from a fixture rather than hand-authored so it cannot drift from the
    shape a stored document actually has. It does NOT use `migrate_inputs_to_v10`
    -- that function does not exist until Task 5, and a types test that depended
    on the migration would be testing two things at once."""
    raw = json.loads(
        Path("fixtures/financial-model/l-retain-all.json").read_text(encoding="utf-8"),
    )
    doc = migrate_inputs_to_v9(raw, None).model_dump()
    doc["inputs_version"] = 10
    doc["investment_case"] = None
    if doc.get("refinance") is not None:
        doc["refinance"]["arrangement_fee_basis"] = "fixed_pence"
        doc["refinance"]["arrangement_fee_pct"] = 0.0
    return doc


def test_v10_narrows_refinance_value_and_ltv_to_nullable():
    """Sec 19.1: `investment_case` SUPERSEDES the explicit pair, so the pair must
    be expressible as null. A v10 model that still required them would make the
    supersession unrepresentable and force validation to accept a contradiction."""
    from app.financial_model.types import CalculatorInputsV10, parse_calculator_inputs

    doc = _minimal_v10_doc()
    doc["refinance"] = {
        "month_offset": 12, "investment_value_pence": None, "ltv_pct": None,
        "arrangement_fee_pence": 0, "legal_costs_pence": 0, "anchor": None,
        "arrangement_fee_basis": "pct_of_quantum", "arrangement_fee_pct": 1.5,
    }
    parsed = parse_calculator_inputs(doc)
    assert isinstance(parsed, CalculatorInputsV10)
    assert parsed.refinance.investment_value_pence is None
    assert parsed.refinance.arrangement_fee_basis == "pct_of_quantum"


def test_parse_dispatch_routes_v10_to_v10():
    """R11 ruling R10, applied one version on: without a v10 branch the document
    falls through to the CalculatorInputsV2 default, silently dropping the
    investment case and every other post-v2 field."""
    from app.financial_model.types import CalculatorInputsV10, parse_calculator_inputs

    parsed = parse_calculator_inputs(_minimal_v10_doc())
    assert isinstance(parsed, CalculatorInputsV10)
    assert parsed.inputs_version == 10


def test_calc_version_is_2_12_0():
    from app.financial_model.types import CALC_VERSION
    assert CALC_VERSION == "2.12.0"
