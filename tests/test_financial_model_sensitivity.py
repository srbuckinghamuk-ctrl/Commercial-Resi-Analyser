"""Mirror of frontend/src/lib/model/sensitivity.test.ts (spec Sec 12).

Same scenarios and same assertions as the TS suite; both are pinned to the shared
golden fixtures rather than to each other (governance Sec 1).
"""
import json
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.sensitivity import (
    DEFAULT_SENSITIVITY_CONFIG,
    LEVER_ORDER,
    MAX_AXIS_STEPS,
    InvalidBaseDocumentError,
    InvalidSensitivityConfigError,
    SensitivityAxis,
    SensitivityConfig,
    TornadoRange,
    run_sensitivity,
    validate_sensitivity_config,
)
from app.financial_model.types import ScenarioOverrides, parse_calculator_inputs

FIXTURE_F = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "f-dev-finance-12mo.json"
FIXTURE_I = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "i-phased-sales.json"


def _inputs():
    return parse_calculator_inputs(json.loads(FIXTURE_F.read_text(encoding="utf-8"))["inputs"])


def _fixture_i_inputs():
    return parse_calculator_inputs(json.loads(FIXTURE_I.read_text(encoding="utf-8"))["inputs"])


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
        # Spec Sec 12.6: an axis or tornado lever must be one of the four Sec 12.1
        # levers. Without this, an unknown AXIS lever silently no-ops that axis (both
        # engines "agree" on a wrong answer), and an unknown TORNADO lever crashes
        # run_sensitivity inside LEVER_ORDER.index() -- see the sibling TS test in
        # sensitivity.test.ts.
        ({"rows": SensitivityAxis(lever="GDV", steps=[0])}, "sensitivity.rows.lever"),
        ({"tornado": [TornadoRange(lever="GDV", low=-10, high=10)]}, "sensitivity.tornado"),
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


def test_echoes_the_resolved_config_back():
    assert run_sensitivity(_inputs()).config == DEFAULT_SENSITIVITY_CONFIG


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


def _by_span_descending(spans):
    """Sec 12.4 extended by Sec 12.7: bars with a span first, widest first; spanless
    bars last. sorted(spans, reverse=True) cannot express this -- it raises
    TypeError: '<' not supported between instances of 'int' and 'NoneType' as soon as
    a None enters the list, so the assertion it backed could never have been run
    against a grid containing an unmeasured endpoint.
    """
    return sorted(spans, key=lambda s: (s is None, -(s or 0)))


def test_tornado_is_sorted_by_span_descending():
    """Spec Sec 12.4."""
    bars = run_sensitivity(_inputs()).tornado
    assert len(bars) == 4
    spans = [b.span_pence for b in bars]
    assert spans == _by_span_descending(spans)
    # Sec 12.7: no span is null for Fixture F under the default tornado.
    assert all(s is not None and s >= 0 for s in spans)


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


# Spec Sec 12.2 made constructive: the committed facility is identical in every cell,
# so a stressed cell reports facility_exceeded rather than quietly borrowing more.
#
# What was learned running this against Fixture F: the worst corner (construction_cost
# +15%, gdv -15%) drives peak_debt_pence to 63,448,870p, which breaches the committed
# NET facility (60,000,000p) but not the committed GROSS facility (66,000,000p).
# facility_exceeded (engine.py) is gated on the gross facility, because capitalised
# interest/fees are allowed to occupy the net-to-gross headroom without tripping it --
# capitalisation adds straight to the closing balance and never passes through the
# net-capped draw. The shortfall against the net facility (the ceiling that actually
# gates new cash draws) is what shows up, correctly, as funding_gap. So for this
# fixture the deterministic, reproducible flag is funding_gap, not facility_exceeded --
# asserting the specific flag (rather than "either flag") keeps this test able to catch
# a regression that quietly loosens the GROSS facility for stressed cells, which an
# either-flag assertion could not.
#
# Round-2 fix: the peak-debt and profit comparisons below are strict (> / <), not loose
# (>= / <=). A non-strict comparison is satisfied by equality, and equality is exactly
# what a no-op regression produces: if every lever silently stopped being applied, the
# "worst corner" cell would degenerate to being numerically identical to the base case,
# `>=`/`<=` would pass on that equality, and the conditional funding_gap assertion below
# would never even run (Fixture F's base peak debt already sits under the committed net
# facility, so the degenerated worst corner would too). This was found empirically, not
# theoretically: patching _measure to discard its `levers` argument and rerunning the
# suite left every test passing under `>=`. Construction cost +15% strictly increases
# spend and GDV -15% strictly reduces sale proceeds, so both peak debt and profit are
# guaranteed to move under a correctly-applied worst corner -- `>`/`<` is safe here and
# fails, as required, under the no-op.
def test_never_resizes_the_facility_whatever_the_cell():
    inputs = _inputs()
    result = run_sensitivity(inputs)
    base = run_appraisal(inputs).metrics
    worst = result.matrix[4][0]  # cost +15%, GDV -15%
    assert worst.peak_debt_pence > base.peak_debt_pence
    # A more direct proof the levers were actually applied: cost up and GDV down
    # cannot leave profit unchanged, whereas a no-op regression leaves it identical.
    assert worst.profit_pence < base.profit_pence
    # The committed facility is an input, so the only way a cell can exceed it is a
    # flag. Fixture F is a development-finance deal, so this is always a real number
    # at runtime; the schema types it nullable only for funding sources that lack a
    # committed facility (e.g. cash deals), which Fixture F is not.
    committed = inputs.finance.committed_net_facility_pence
    if worst.peak_debt_pence > committed:
        assert "funding_gap" in worst.flags

    # The constructive form of Sec 12.2, independent of any flag: the levered document
    # itself must carry the same committed facility and the same raised equity as the
    # base document. This fails if and only if a lever actually reached one of these
    # fields -- it cannot be satisfied by accident the way a flag-based check could.
    levered = apply_scenario(inputs, ScenarioOverrides(
        label="",
        gdv_adjustment_pct=worst.col_step,
        construction_cost_adjustment_pct=worst.row_step,
        timeline_adjustment_months=0,
        interest_rate_adjustment_pct=0,
    ))
    assert levered.finance.committed_net_facility_pence == inputs.finance.committed_net_facility_pence
    assert levered.finance.committed_gross_facility_pence == inputs.finance.committed_gross_facility_pence
    assert levered.finance.day_one_advance_pence == inputs.finance.day_one_advance_pence
    assert levered.equity_sources == inputs.equity_sources


def test_invalid_config_raises():
    with pytest.raises(ValueError, match="different levers"):
        run_sensitivity(_inputs(), _config(rows=SensitivityAxis(lever="gdv", steps=[0])))


def test_unknown_axis_lever_raises_a_validation_error_not_an_index_error():
    """Spec Sec 12.6. Before the closed-set check existed, an unknown tornado lever
    reached LEVER_ORDER.index() inside run_sensitivity and raised an uncaught
    ValueError from tuple.index(), not the deliberate "Invalid sensitivity config"
    message -- the same failure under a misleading label."""
    with pytest.raises(ValueError, match="Invalid sensitivity config"):
        run_sensitivity(_inputs(), _config(
            tornado=[TornadoRange(lever="GDV", low=-10, high=10)]
        ))


# Mirrors sensitivity.test.ts's "does not leak a mutation of the default config into
# later runs": _default_config() must hand out a fresh structure on every call so a
# caller mutating run_sensitivity(...).config can never poison a later default-config
# call for the rest of the process.
def test_run_sensitivity_default_config_is_not_shared():
    inputs = _inputs()
    first = run_sensitivity(inputs)
    assert list(first.config.cols.steps) == list(DEFAULT_SENSITIVITY_CONFIG.cols.steps)

    first.config.cols.steps.append(10)

    second = run_sensitivity(inputs)
    assert list(second.config.cols.steps) == [-15, -10, -5, 0, 5]
    assert len(second.matrix[0]) == 5
    # The shared module-level constant itself must also be untouched.
    assert list(DEFAULT_SENSITIVITY_CONFIG.cols.steps) == [-15, -10, -5, 0, 5]


# ---- Release 5: Sec 12.7 cell validity ----

def test_position_failing_validation_is_not_measured():
    """A -12 timeline step on a 12-month base empties the term, which validation
    rejects at error severity. Before R5 the suite clamped and reported numbers."""
    config = _config()
    config.rows = SensitivityAxis(lever="timeline", steps=[-12])
    config.cols = SensitivityAxis(lever="gdv", steps=[0])
    cell = run_sensitivity(_inputs(), config).matrix[0][0]

    assert len(cell.validation_errors) > 0
    assert all(e.severity == "error" for e in cell.validation_errors)
    assert any(e.field == "finance.term_months" for e in cell.validation_errors)
    assert cell.profit_pence is None
    assert cell.peak_debt_pence is None
    assert cell.profit_on_cost_pct is None
    assert cell.profit_on_gdv_pct is None
    assert cell.irr_annual_pct is None
    assert cell.ltgdv_developer_pct is None
    assert cell.flags == []


def test_position_leaving_exactly_one_month_is_measured():
    config = _config()
    config.rows = SensitivityAxis(lever="timeline", steps=[-11])
    config.cols = SensitivityAxis(lever="gdv", steps=[0])
    cell = run_sensitivity(_inputs(), config).matrix[0][0]

    assert cell.validation_errors == []
    assert cell.profit_pence is not None


def test_warnings_do_not_invalidate_a_position():
    """Fixture F carries a warning on conversion_costs.total_construction_sqm."""
    result = run_sensitivity(_inputs())
    for row in result.matrix:
        for cell in row:
            assert cell.validation_errors == []
            assert cell.profit_pence is not None


def test_flagged_cell_is_still_a_measurement():
    """Sec 12.2: a covenant flag is the finding, not invalidity."""
    result = run_sensitivity(_inputs())
    flagged = [c for row in result.matrix for c in row if c.flags]
    assert flagged
    for cell in flagged:
        assert cell.validation_errors == []
        assert cell.profit_pence is not None


def test_tornado_bar_with_unmeasured_endpoint_has_no_span():
    config = _config()
    config.tornado = [
        TornadoRange(lever="gdv", low=-10, high=10),
        TornadoRange(lever="timeline", low=-12, high=3),
    ]
    bars = run_sensitivity(_inputs(), config).tornado
    timeline = next(b for b in bars if b.lever == "timeline")
    assert timeline.span_pence is None
    assert len(timeline.low.validation_errors) > 0
    assert timeline.high.validation_errors == []


def test_spanless_bars_sort_last():
    config = _config()
    config.tornado = [
        TornadoRange(lever="timeline", low=-12, high=3),
        TornadoRange(lever="interest_rate", low=-1, high=1),
        TornadoRange(lever="gdv", low=-10, high=10),
    ]
    bars = run_sensitivity(_inputs(), config).tornado
    assert bars[-1].lever == "timeline"
    assert bars[-1].span_pence is None
    assert all(b.span_pence is not None for b in bars[:-1])


def test_two_spanless_bars_sort_relative_to_each_other_by_lever_order():
    """Mirror of sensitivity.test.ts's 'orders two spanless bars relative to each
    other by LEVER_ORDER' (final whole-branch review, Finding 3). A single spanless
    bar can't distinguish "sorts last" from "sorts last in LEVER_ORDER" -- with only
    one null-span bar, any tie-break would look identical. Two invalidating levers
    closes that: gdv at -100% drives every unit's estimated_value_pence to zero
    (validation's "positive value" rule), so its low endpoint is unmeasured exactly
    like timeline's -12 endpoint (which empties the term). Both must sort after every
    bar with a real span, and gdv (index 0) must sort before timeline (index 2) in
    LEVER_ORDER -- the third sort key TS pins and this file, before this test, did
    not.
    """
    config = _config()
    config.tornado = [
        TornadoRange(lever="timeline", low=-12, high=3),
        TornadoRange(lever="interest_rate", low=-1, high=1),
        TornadoRange(lever="gdv", low=-100, high=10),
        TornadoRange(lever="construction_cost", low=-10, high=10),
    ]
    bars = run_sensitivity(_inputs(), config).tornado

    spanless = [b.lever for b in bars if b.span_pence is None]
    assert spanless == ["gdv", "timeline"]
    # Both spanless bars sit at the tail, in that same relative order.
    assert [b.lever for b in bars[-2:]] == ["gdv", "timeline"]
    # Every bar ahead of them has a real span.
    assert all(b.span_pence is not None for b in bars[:-2])
    # Confirms *why* gdv is unmeasured, not just that it is.
    gdv_bar = next(b for b in bars if b.lever == "gdv")
    assert any("estimated_value_pence" in e.field for e in gdv_bar.low.validation_errors)


FIXTURE_A = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "a-all-cash.json"


def _all_cash_inputs():
    return parse_calculator_inputs(json.loads(FIXTURE_A.read_text(encoding="utf-8"))["inputs"])


def test_genuine_zero_span_sorts_ahead_of_a_null_span():
    """Sec 12.4/Sec 12.7 at the boundary -- mirror of the TS suite.

    A 0-pence span is a measurement saying this lever does not move the deal; a null
    span is the absence of a measurement. They compare equal under a null-as-zero sort
    and mean opposite things. a-all-cash has no facility and no interest rate exposure,
    so the interest_rate lever produces a real 0; its 12-month term makes timeline -12
    unmeasurable.
    """
    cfg = SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0]),
        tornado=[
            TornadoRange(lever="interest_rate", low=-1, high=1),
            TornadoRange(lever="gdv", low=-10, high=10),
            TornadoRange(lever="timeline", low=-12, high=3),
        ],
    )
    bars = run_sensitivity(_all_cash_inputs(), cfg).tornado
    spans = {b.lever: b.span_pence for b in bars}

    assert spans["interest_rate"] == 0
    assert spans["timeline"] is None
    assert spans["gdv"] > 0

    assert [b.lever for b in bars] == ["gdv", "interest_rate", "timeline"]
    ordered = [b.span_pence for b in bars]
    assert ordered == _by_span_descending(ordered)


def test_invalid_base_document_raises():
    bad = _inputs()
    bad.finance.term_months = 0
    with pytest.raises(ValueError, match="base document"):
        run_sensitivity(bad)


def test_config_failure_is_typed():
    """Spec Sec 12.6 -- mirror of the TS suite."""
    cfg = SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0]),
        tornado=[],
    )
    with pytest.raises(InvalidSensitivityConfigError) as exc:
        run_sensitivity(_inputs(), cfg)
    assert str(exc.value).startswith("Invalid sensitivity config: ")


def test_base_document_failure_is_typed():
    """Spec Sec 12.7 -- mirror of the TS suite."""
    inputs = _inputs()
    inputs.finance.equity_draw_rule = "pari_passu"
    with pytest.raises(InvalidBaseDocumentError) as exc:
        run_sensitivity(inputs)
    assert str(exc.value).startswith("Invalid base document: ")


def test_the_two_failures_are_distinguishable():
    """A consumer catching one and re-raising the rest depends on this."""
    inputs = _inputs()
    inputs.finance.equity_draw_rule = "pari_passu"
    with pytest.raises(InvalidBaseDocumentError):
        run_sensitivity(inputs)
    assert not issubclass(InvalidBaseDocumentError, InvalidSensitivityConfigError)
    assert not issubclass(InvalidSensitivityConfigError, InvalidBaseDocumentError)


def test_both_failures_remain_value_errors():
    """Existing `except ValueError` sites and pytest.raises(ValueError) keep working."""
    assert issubclass(InvalidSensitivityConfigError, ValueError)
    assert issubclass(InvalidBaseDocumentError, ValueError)


def test_does_not_measure_default_tornado_low_endpoint_of_phased_sales_deal():
    """Mirror of sensitivity.test.ts's 'does not measure the default tornado low
    endpoint of a phased-sales deal' (final whole-branch review, Finding 4). Fixture
    I is a phased-sales deal whose tranches sit in months 9-11 of a 12-month
    programme. The DEFAULT tornado's -3 month endpoint leaves a 9-month term, so
    those tranches point at months that no longer exist and validation rejects the
    document. Before R5 that endpoint reported a profit computed from exactly that
    document; the parametrised corpus in test_financial_model_fixtures.py only
    exercises fixture I through the null-as-0 assertion, so this is the realistic
    instance -- not just the exotic term_months=0 case above -- pinned in the Python
    engine, mirroring the existing TS pin.
    """
    fixture_i = _fixture_i_inputs()
    bars = run_sensitivity(fixture_i).tornado
    timeline = next(b for b in bars if b.lever == "timeline")

    assert len(timeline.low.validation_errors) > 0
    assert any(e.field.startswith("sales_phasing.tranches") for e in timeline.low.validation_errors)
    assert timeline.low.profit_pence is None
    assert timeline.span_pence is None
    # Sec 12.4 as extended by Sec 12.7: no span means it sorts last.
    assert bars[-1].lever == "timeline"
    # The high endpoint lengthens the programme, so it stays measured.
    assert timeline.high.validation_errors == []
