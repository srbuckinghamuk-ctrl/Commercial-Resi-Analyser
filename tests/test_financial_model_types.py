"""R13 spec Sec 19.1. The v10 input shape: the investment case and the two
refinance narrowings."""
import json
from pathlib import Path

import pytest

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


def _minimal_v11_doc(monitoring: dict | None = None) -> dict:
    """A valid v11 document, built the same way `_minimal_v10_doc` is: a real
    fixture migrated to v10 shape by hand, then v11's own top-level addition
    applied. Does NOT use `migrate_inputs_to_v11` -- that function does not
    exist until Task 6."""
    doc = _minimal_v10_doc()
    doc["inputs_version"] = 11
    doc["monitoring"] = monitoring
    return doc


def _monitoring_line(category: str) -> dict:
    return {
        "category": category,
        "current_budget_pence": 1_000_00,
        "certified_to_date_pence": 500_00,
        "paid_to_date_pence": 400_00,
        "committed_to_date_pence": 600_00,
        "forecast_to_complete_pence": 500_00,
    }


def _minimal_monitoring() -> dict:
    return {
        "reporting_month": 6,
        "reporting_date": "2026-08-01",
        "lines": [
            _monitoring_line(c)
            for c in (
                "acquisition", "construction", "professional",
                "statutory", "contingency",
            )
        ],
        "debt_drawn_to_date_pence": 1_000_000_00,
        "cash_equity_injected_to_date_pence": 200_000_00,
        "author": "Jane QS",
        "date": "2026-08-01",
        "note": None,
    }


def test_parse_dispatch_routes_v11_to_v11_with_monitoring():
    """Sec 20.1: a v11 document with a `monitoring` block parses to
    `CalculatorInputsV11`, and the first line round-trips its category."""
    from app.financial_model.types import CalculatorInputsV11, parse_calculator_inputs

    doc = _minimal_v11_doc(_minimal_monitoring())
    parsed = parse_calculator_inputs(doc)
    assert isinstance(parsed, CalculatorInputsV11)
    assert parsed.inputs_version == 11
    assert parsed.monitoring.lines[0].category == "acquisition"


def test_v11_monitoring_null_parses():
    """Sec 20.1: `monitoring` is nullable -- a v11 document need not carry a
    monitoring statement at all."""
    from app.financial_model.types import CalculatorInputsV11, parse_calculator_inputs

    parsed = parse_calculator_inputs(_minimal_v11_doc(None))
    assert isinstance(parsed, CalculatorInputsV11)
    assert parsed.monitoring is None


def test_v11_reporting_month_zero_rejected():
    """Sec 20.1: `reporting_month` is a ledger label >= 1 (Sec 5.10
    convention), never 0."""
    from pydantic import ValidationError

    from app.financial_model.types import parse_calculator_inputs

    monitoring = _minimal_monitoring()
    monitoring["reporting_month"] = 0
    try:
        parse_calculator_inputs(_minimal_v11_doc(monitoring))
    except ValidationError:
        return
    raise AssertionError("expected ValidationError for reporting_month=0")


def _minimal_v12_doc(unit_sales=None):
    doc = _minimal_v11_doc()
    doc["inputs_version"] = 12
    doc["unit_sales"] = unit_sales
    return doc


def test_parse_dispatch_routes_v12_to_v12_with_unit_sales():
    from app.financial_model.types import CalculatorInputsV12, parse_calculator_inputs

    parsed = parse_calculator_inputs(_minimal_v12_doc({
        "deposit_release": "released_on_exchange",
        "units": [{
            "unit_id": "u1", "exchange": {"month_offset": 3, "anchor": None},
            "completion": {"month_offset": 6, "anchor": None},
            "deposit_pct": 10, "agent_fee_pct": None, "legal_fee_pence": None,
        }],
    }))
    assert isinstance(parsed, CalculatorInputsV12)
    assert parsed.inputs_version == 12
    assert parsed.unit_sales.units[0].completion.month_offset == 6
    assert parsed.scenarios.base.sales_slip_months == 0


def test_v12_unit_sales_null_parses():
    from app.financial_model.types import parse_calculator_inputs

    assert parse_calculator_inputs(_minimal_v12_doc(None)).unit_sales is None


def test_v12_rejects_an_unknown_deposit_release():
    from pydantic import ValidationError

    from app.financial_model.types import parse_calculator_inputs

    with pytest.raises(ValidationError):
        parse_calculator_inputs(_minimal_v12_doc({"deposit_release": "maybe", "units": []}))


def test_calc_version_is_2_14_0():
    from app.financial_model.types import CALC_VERSION
    assert CALC_VERSION == "2.14.0"
