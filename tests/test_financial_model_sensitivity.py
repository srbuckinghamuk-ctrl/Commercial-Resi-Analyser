"""Mirror of frontend/src/lib/model/sensitivity.test.ts (spec Sec 12).

Same scenarios and same assertions as the TS suite; both are pinned to the shared
golden fixtures rather than to each other (governance Sec 1).
"""
import json
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.sensitivity import (
    DEFAULT_SENSITIVITY_CONFIG,
    LEVER_ORDER,
    MAX_AXIS_STEPS,
    SensitivityAxis,
    SensitivityConfig,
    TornadoRange,
    run_sensitivity,
    validate_sensitivity_config,
)
from app.financial_model.types import parse_calculator_inputs

FIXTURE_F = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "f-dev-finance-12mo.json"


def _inputs():
    return parse_calculator_inputs(json.loads(FIXTURE_F.read_text(encoding="utf-8"))["inputs"])


def _config(**overrides) -> SensitivityConfig:
    base = SensitivityConfig(
        rows=SensitivityAxis(lever=DEFAULT_SENSITIVITY_CONFIG.rows.lever,
                             steps=list(DEFAULT_SENSITIVITY_CONFIG.rows.steps)),
        cols=SensitivityAxis(lever=DEFAULT_SENSITIVITY_CONFIG.cols.lever,
                             steps=list(DEFAULT_SENSITIVITY_CONFIG.cols.steps)),
        tornado=[TornadoRange(lever=r.lever, low=r.low, high=r.high)
                 for r in DEFAULT_SENSITIVITY_CONFIG.tornado],
    )
    for key, value in overrides.items():
        setattr(base, key, value)
    return base


def test_default_grid_matches_the_spec():
    """Spec Sec 12.3."""
    assert DEFAULT_SENSITIVITY_CONFIG.rows.lever == "construction_cost"
    assert list(DEFAULT_SENSITIVITY_CONFIG.rows.steps) == [-5, 0, 5, 10, 15]
    assert DEFAULT_SENSITIVITY_CONFIG.cols.lever == "gdv"
    assert list(DEFAULT_SENSITIVITY_CONFIG.cols.steps) == [-15, -10, -5, 0, 5]


def test_default_tornado_matches_the_spec():
    """Spec Sec 12.4."""
    assert [(r.lever, r.low, r.high) for r in DEFAULT_SENSITIVITY_CONFIG.tornado] == [
        ("gdv", -10, 10),
        ("construction_cost", -10, 10),
        ("timeline", -3, 3),
        ("interest_rate", -1, 1),
    ]


def test_lever_order_matches_the_spec():
    assert list(LEVER_ORDER) == ["gdv", "construction_cost", "timeline", "interest_rate"]


def test_defaults_validate_clean():
    assert validate_sensitivity_config(DEFAULT_SENSITIVITY_CONFIG) == []


@pytest.mark.parametrize(
    "overrides,expected_field",
    [
        ({"rows": SensitivityAxis(lever="construction_cost", steps=[])}, "sensitivity.rows.steps"),
        ({"rows": SensitivityAxis(lever="construction_cost", steps=[0, float("nan")])}, "sensitivity.rows.steps"),
        ({"cols": SensitivityAxis(lever="gdv", steps=list(range(MAX_AXIS_STEPS + 1)))}, "sensitivity.cols.steps"),
        ({"rows": SensitivityAxis(lever="gdv", steps=[0])}, "sensitivity.cols.lever"),
        ({"tornado": [TornadoRange(lever="gdv", low=-10, high=10),
                      TornadoRange(lever="gdv", low=-5, high=5)]}, "sensitivity.tornado"),
        ({"tornado": [TornadoRange(lever="gdv", low=10, high=10)]}, "sensitivity.tornado"),
        # Spec Sec 12.6 whole-month rule: the engine is month-indexed, and this is also
        # what keeps apply_scenario.py's int() narrowing from ever truncating anything.
        ({"rows": SensitivityAxis(lever="timeline", steps=[0, 3.5])}, "sensitivity.rows.steps"),
        ({"tornado": [TornadoRange(lever="timeline", low=-3, high=3.5)]}, "sensitivity.tornado"),
    ],
)
def test_validation_rejects_bad_configs(overrides, expected_field):
    """Spec Sec 12.6."""
    issues = validate_sensitivity_config(_config(**overrides))
    assert expected_field in [i.field for i in issues]
    assert all(i.severity == "error" for i in issues)


def test_whole_month_timeline_axis_is_accepted():
    """Spec Sec 12.6: whole months are fine; only fractions are rejected."""
    assert validate_sensitivity_config(
        _config(rows=SensitivityAxis(lever="timeline", steps=[-3, 0, 3]))
    ) == []


def test_matrix_is_shaped_by_the_axes():
    result = run_sensitivity(_inputs())
    assert len(result.matrix) == 5
    assert all(len(row) == 5 for row in result.matrix)
    assert (result.matrix[0][0].row_step, result.matrix[0][0].col_step) == (-5, -15)
    assert (result.matrix[4][4].row_step, result.matrix[4][4].col_step) == (15, 5)


def test_base_case_is_the_unadjusted_appraisal():
    """Spec Sec 12.5."""
    inputs = _inputs()
    plain = run_appraisal(inputs).metrics
    base = run_sensitivity(inputs).base
    assert base.profit_pence == plain.profit_pence
    assert base.profit_on_cost_pct == plain.profit_on_cost_pct
    assert base.profit_on_gdv_pct == plain.profit_on_gdv_pct
    assert base.irr_annual_pct == plain.irr_annual_pct
    assert base.ltgdv_developer_pct == plain.ltgdv_developer_pct
    assert base.peak_debt_pence == plain.peak_debt_pence
    assert base.flags == [f.code for f in plain.flags]


def test_base_case_also_sits_at_the_zero_zero_grid_position():
    result = run_sensitivity(_inputs())
    ri = list(result.config.rows.steps).index(0)
    ci = list(result.config.cols.steps).index(0)
    assert result.matrix[ri][ci].profit_pence == result.base.profit_pence


def test_tornado_is_sorted_by_span_descending():
    """Spec Sec 12.4."""
    bars = run_sensitivity(_inputs()).tornado
    assert len(bars) == 4
    spans = [b.span_pence for b in bars]
    assert spans == sorted(spans, reverse=True)
    assert all(s >= 0 for s in spans)


def test_tornado_order_is_independent_of_input_order():
    inputs = _inputs()
    forward = run_sensitivity(inputs, _config(tornado=[
        TornadoRange(lever="gdv", low=-10, high=10),
        TornadoRange(lever="construction_cost", low=-10, high=10),
    ]))
    reversed_ = run_sensitivity(inputs, _config(tornado=[
        TornadoRange(lever="construction_cost", low=-10, high=10),
        TornadoRange(lever="gdv", low=-10, high=10),
    ]))
    assert [b.lever for b in forward.tornado] == [b.lever for b in reversed_.tornado]


def test_invalid_config_raises():
    with pytest.raises(ValueError, match="different levers"):
        run_sensitivity(_inputs(), _config(rows=SensitivityAxis(lever="gdv", steps=[0])))
