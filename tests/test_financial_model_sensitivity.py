"""Mirror of frontend/src/lib/model/sensitivity.test.ts (spec Sec 12).

Same scenarios and same assertions as the TS suite; both are pinned to the shared
golden fixtures rather than to each other (governance Sec 1).
"""
import json
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.programme import derive_phases
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
from app.financial_model.migrate import migrate_inputs_to_v8, migrate_inputs_to_v9
from app.financial_model.types import (
    CategoryPhaseIds,
    Dependency,
    Phase,
    ProgrammeNetwork,
    ScenarioOverrides,
    SimpleSpendCurve,
    parse_calculator_inputs,
)

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
    assert list(LEVER_ORDER) == [
        "gdv", "construction_cost", "timeline", "interest_rate", "phase_slip",
    ]


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


def test_cost_lever_moves_peak_debt_until_the_facility_stops_it():
    """Spec Sec 12.2 -- mirror of the TS suite.

    R4 left this open: peak_debt_pence looked unmoved by the cost lever on one project.
    It is Sec 12.2 working. peak_debt_pence is max(balance) and the committed facility
    is invariant, so a facility drawn to its ceiling turns extra cost into a funding gap
    rather than into more debt.
    """
    cfg = SensitivityConfig(
        rows=SensitivityAxis(lever="construction_cost", steps=[0, 5, 10, 15]),
        cols=SensitivityAxis(lever="gdv", steps=[0]),
        tornado=[],
    )
    matrix = run_sensitivity(_inputs(), cfg).matrix
    peaks = [row[0].peak_debt_pence for row in matrix]
    flags = [row[0].flags for row in matrix]

    # Half one -- the lever reaches the ledger.
    assert peaks[1] > peaks[0]
    assert peaks[2] > peaks[1]

    # Half two -- the ceiling bites, and the shortfall is a funding gap, not more debt.
    assert peaks[3] - peaks[2] < (peaks[2] - peaks[1]) / 2
    assert "funding_gap" not in flags[0]
    assert "funding_gap" in flags[3]


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


@pytest.mark.parametrize("step,measured", [(-12, False), (-11, True), (-10, True)])
def test_cell_validity_is_unchanged_on_a_migrated_v8_document(step, measured):
    """Ruling R38, and the Python half of the defect the TS suite caught first.

    Until R11 this file fed `run_sensitivity` a v5/v6/v7 fixture, so it never
    exercised a `vat` block at all -- Python was green here by ACCIDENT, not for
    the same reason as its TS twin (SensitivityPage.test.tsx, whose `buildInputs`
    does migrate to v8). Once the server stores v8 every document it sees carries
    the block, and the ungated return-cycle bound made a derived term of 1 or 2
    months an ERROR position: -11 and -10 would have flipped from measured to
    unmeasured, naming `vat.first_period_end_month`.

    Steps -11 and -10 are BOTH here deliberately: the migration writes
    `first_period_end_month: 2`, so the ungated rule bit at term 1 AND term 2,
    and a test covering only term 1 would have left half the regression
    unguarded. -12 (term 0) stays unmeasured, on `finance.term_months` -- the
    gate defers a rule about a dormant cycle, it does not make short terms
    valid."""
    v8 = migrate_inputs_to_v8(json.loads(FIXTURE_F.read_text(encoding="utf-8"))["inputs"])
    assert v8.inputs_version == 8
    assert v8.vat.registered is False
    assert v8.vat.first_period_end_month == 2

    config = _config()
    config.rows = SensitivityAxis(lever="timeline", steps=[step])
    config.cols = SensitivityAxis(lever="gdv", steps=[0])
    cell = run_sensitivity(v8, config).matrix[0][0]

    assert not any(e.field == "vat.first_period_end_month" for e in cell.validation_errors)
    if measured:
        assert cell.validation_errors == []
        assert cell.profit_pence is not None
    else:
        assert any(e.field == "finance.term_months" for e in cell.validation_errors)
        assert cell.profit_pence is None

    # And the v8 document measures identically to the v7 one it was migrated
    # from -- the migration changed nothing this suite can see.
    v7_cell = run_sensitivity(_inputs(), config).matrix[0][0]
    assert cell.profit_pence == v7_cell.profit_pence
    assert [e.field for e in cell.validation_errors] == [
        e.field for e in v7_cell.validation_errors
    ]


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


def test_base_document_failure_deduplicates_a_repeated_identical_message():
    """F1 follow-up, mirror of the TS suite: validate_inputs emits one issue per
    offending element (one per phased-sales tranche here) with an identical message.
    All three of fixture I's tranches pushed past the term the same way must not
    repeat the same sentence three times in the thrown message."""
    inputs = _fixture_i_inputs()
    for tranche in inputs.sales_phasing.tranches:
        tranche.month_offset = 999
    with pytest.raises(InvalidBaseDocumentError) as exc:
        run_sensitivity(inputs)
    message = str(exc.value)
    assert message.count("Tranche month must be a whole month between") == 1


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


# --- R12 Task 14: the phase_slip lever (spec Sec 18.9, guard 7) ------------
#
# Python twin of sensitivity.test.ts's 'phase_slip lever -- Sec18.9' describe block.

SL = SimpleSpendCurve(kind="straight_line")


def _v9_phase(pid, code, duration, preds=(), *, start_offset=0, slip=0) -> Phase:
    """Mirrors test_financial_model_programme.py's own phase() helper: a phase
    with no overrides is predecessor-free, at start_offset 0, with no slip."""
    return Phase(
        id=pid, code=code, label=pid, duration_months=duration,
        slip_months=slip, start_offset=start_offset, curve=SL,
        predecessors=list(preds),
    )


def _network_doc(term: int = 12):
    """Fixture F (already used throughout this file) migrated to v9 and given a
    small two-phase network: planning (2 months) then construction (8 months, FS
    off planning). Mirrors sensitivity.test.ts's own networkDoc() exactly."""
    base = migrate_inputs_to_v9(json.loads(FIXTURE_F.read_text(encoding="utf-8"))["inputs"])
    phases = [
        _v9_phase("planning", "planning", 2),
        _v9_phase("construction", "construction", 8, [Dependency(phase_id="planning", type="FS", lag_months=0)]),
    ]
    base.finance = base.finance.model_copy(update={"term_months": term})
    base.programme = ProgrammeNetwork(
        anchor_month=None,
        phases=phases,
        category_phase_ids=CategoryPhaseIds(
            construction="construction", professional="planning", statutory="planning",
        ),
    )
    return base


def _with_slip(doc, phase_id: str, months: int):
    """Sets a phase's slip_months directly (not via apply_scenario), for tests that
    need a BASE-CASE slip already recorded before a lever stresses it."""
    d = doc.model_copy(deep=True)
    for p in d.programme.phases:
        if p.id == phase_id:
            p.slip_months += months
    return d


_ZERO_OVERRIDES = dict(
    label="", gdv_adjustment_pct=0, construction_cost_adjustment_pct=0,
    timeline_adjustment_months=0, interest_rate_adjustment_pct=0,
    phase_slip_phase_id=None, phase_slip_months=0,
)


def _apply_in_order(doc, order, levers: dict, phase_targets: dict | None = None):
    """Applies all five Sec 12.1/Sec 18.9 levers to doc via apply_scenario, once
    per lever, in order -- the same "one call per setting, in sequence" shape
    run_sensitivity itself now uses internally (sensitivity.py's _measure)."""
    phase_targets = phase_targets or {}
    d = doc
    for lever in order:
        overrides = dict(_ZERO_OVERRIDES)
        if lever == "gdv":
            overrides["gdv_adjustment_pct"] = levers["gdv"]
        elif lever == "construction_cost":
            overrides["construction_cost_adjustment_pct"] = levers["construction_cost"]
        elif lever == "timeline":
            overrides["timeline_adjustment_months"] = levers["timeline"]
        elif lever == "interest_rate":
            overrides["interest_rate_adjustment_pct"] = levers["interest_rate"]
        elif lever == "phase_slip":
            overrides["phase_slip_phase_id"] = phase_targets.get("phase_slip")
            overrides["phase_slip_months"] = levers["phase_slip"]
        d = apply_scenario(d, ScenarioOverrides(**overrides))
    return d


def test_apply_scenario_adds_the_slip_additively_to_the_named_phase_only():
    # Hand-derived: planning already carries a base-case slip of 1 month; the
    # override adds 3 more. 1 + 3 = 4. construction is not the named phase, so its
    # slip stays at the 0 the fixture starts it at.
    doc = _with_slip(_network_doc(), "planning", 1)
    overrides = dict(_ZERO_OVERRIDES)
    overrides["phase_slip_phase_id"] = "planning"
    overrides["phase_slip_months"] = 3
    out = apply_scenario(doc, ScenarioOverrides(**overrides))
    assert next(p for p in out.programme.phases if p.id == "planning").slip_months == 4
    assert next(p for p in out.programme.phases if p.id == "construction").slip_months == 0


def test_null_phase_slip_phase_id_matches_no_phase_the_migration_no_op():
    """Fix round 1, Finding 2: months=0 cannot fail for any predicate that
    matches the wrong phase -- a broken match still adds zero. A nonzero
    magnitude makes this non-vacuous: a mutated predicate that makes a null
    target match EVERY phase would increment every phase's slip_months by 99."""
    doc = _network_doc()
    overrides = dict(_ZERO_OVERRIDES)
    overrides["phase_slip_phase_id"] = None
    overrides["phase_slip_months"] = 99
    out = apply_scenario(doc, ScenarioOverrides(**overrides))
    assert out.programme == doc.programme


def test_phase_slip_moves_the_derived_start_finish_by_exactly_the_slip_amount():
    """Fix round 1, Finding 3. Hand-derivation (identical to the TS mirror):
    planning is predecessor-free at start_offset 0; a +5 slip resolves its
    start to 5, finish to 5 + 2 = 7. construction's floor is
    max(start_offset 0, finish(planning) + lag 0) = 7, unslipped, so its start
    is 7 and its finish is 7 + 8 = 15 -- the slip on planning propagates
    through the FS dependency to move construction by the same 5 months."""
    doc = _network_doc(20)
    overrides = dict(_ZERO_OVERRIDES)
    overrides["phase_slip_phase_id"] = "planning"
    overrides["phase_slip_months"] = 5
    out = apply_scenario(doc, ScenarioOverrides(**overrides))
    derivation = derive_phases(out.programme)
    assert derivation.cycle is None
    assert derivation.by_id["planning"].start_month == 5
    assert derivation.by_id["planning"].finish_month == 7
    assert derivation.by_id["construction"].start_month == 7
    assert derivation.by_id["construction"].finish_month == 15


def test_absolute_profit_pence_under_a_single_phase_slip_setting_pinned_cross_engine():
    """Fix round 1, Finding 3: an absolute profit_pence, pinned identically in
    both engines (see the sibling assertion in sensitivity.test.ts). Hand-
    deriving a full appraisal waterfall by hand is not practicable -- this is
    the same "pin a full appraisal's ground truth" pattern the fixture corpus
    itself uses. Captured by running the TS engine once and cross-checked here
    against an INDEPENDENTLY run Python engine. A divergence between the two
    pinned literals would mean the engines disagree, which is exactly what
    this pin exists to catch -- the two literals are not allowed to be edited
    independently of each other."""
    doc = _network_doc(20)
    overrides = dict(_ZERO_OVERRIDES)
    overrides["phase_slip_phase_id"] = "planning"
    overrides["phase_slip_months"] = 2
    out = apply_scenario(doc, ScenarioOverrides(**overrides))
    metrics = run_appraisal(out).metrics
    assert metrics.profit_pence == 20_633_313


def test_guard_7_all_five_levers_compose_order_independently():
    """Spec Sec 13 guard 7.

    Task 16 falsifiability audit. Order-independence holds today because
    every lever reads/writes a DISJOINT slice of the document (gdv ->
    unit_mix, construction_cost -> conversion_costs/cost_plan,
    timeline/interest_rate -> finance, phase_slip -> programme), so no
    lever's output can depend on which OTHER lever ran first. Single-line
    change that breaks that and kills this guard: apply_scenario.py's
    `out.finance.annual_interest_rate_pct = (inputs.finance
    .annual_interest_rate_pct + overrides.interest_rate_adjustment_pct)` ->
    the same expression plus `+ (inputs.finance.term_months - 20) * 0.01`
    (interest now reads the term field the `timeline` lever writes, coupling
    the two). Verified: applying `timeline` before `interest_rate` in the
    fold now gives a different profit_pence than applying it after --
    reverted after confirming the guard, and the rest of this file, pass
    again clean."""
    doc = _network_doc(20)
    levers = {"gdv": 5, "construction_cost": -3, "timeline": 2, "interest_rate": 1, "phase_slip": 2}
    orders = [
        ["gdv", "construction_cost", "timeline", "interest_rate", "phase_slip"],
        ["phase_slip", "interest_rate", "timeline", "construction_cost", "gdv"],
        ["timeline", "phase_slip", "gdv", "interest_rate", "construction_cost"],
        ["construction_cost", "gdv", "phase_slip", "timeline", "interest_rate"],
        ["interest_rate", "gdv", "timeline", "phase_slip", "construction_cost"],
    ]
    results = [
        run_appraisal(_apply_in_order(doc, order, levers, {"phase_slip": "planning"})).metrics
        for order in orders
    ]
    # Fix round 1, Finding 4: the spec and brief both say "identical results", not
    # "identical on the three fields this test happened to pick". Full dataclass
    # equality is what actually proves that.
    for r in results[1:]:
        assert r == results[0]

    # Negative control (per R11's ordering-guard lesson, Sec 13): a fixture the
    # levers don't actually move would prove order-independence vacuously.
    without_phase_slip = run_appraisal(
        _apply_in_order(doc, orders[0], {**levers, "phase_slip": 0}, {})
    ).metrics
    assert without_phase_slip.profit_pence != results[0].profit_pence


def test_matrix_cell_with_both_axes_phase_slip_applies_both_targets():
    """Sec 18.9: two phase_slip axes may target different phases at once. The
    matrix builder must thread both settings into the same measurement, not
    silently keep only one. Verified against an independently-built reference:
    applying both overrides via two sequential apply_scenario calls and
    appraising directly."""
    doc = _network_doc(20)
    result = run_sensitivity(doc, SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id="planning", steps=[1]),
        cols=SensitivityAxis(lever="phase_slip", phase_id="construction", steps=[2]),
        tornado=[],
    ))
    cell = result.matrix[0][0]
    assert cell.validation_errors == []

    o1 = dict(_ZERO_OVERRIDES); o1["phase_slip_phase_id"] = "planning"; o1["phase_slip_months"] = 1
    o2 = dict(_ZERO_OVERRIDES); o2["phase_slip_phase_id"] = "construction"; o2["phase_slip_months"] = 2
    reference = apply_scenario(apply_scenario(doc, ScenarioOverrides(**o1)), ScenarioOverrides(**o2))
    expected = run_appraisal(reference).metrics
    assert cell.profit_pence == expected.profit_pence
    assert cell.peak_debt_pence == expected.peak_debt_pence

    only_rows = run_appraisal(apply_scenario(doc, ScenarioOverrides(**o1))).metrics
    assert cell.profit_pence != only_rows.profit_pence


def test_phase_slip_tornado_bar_measures_both_signed_endpoints():
    doc = _network_doc(20)
    result = run_sensitivity(doc, SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0]),
        tornado=[TornadoRange(lever="phase_slip", phase_id="construction", low=-2, high=2)],
    ))
    bar = next(b for b in result.tornado if b.lever == "phase_slip")
    assert bar.phase_id == "construction"
    assert bar.low.validation_errors == []
    assert bar.high.validation_errors == []
    assert bar.span_pence is not None
    assert bar.low.profit_pence != result.base.profit_pence
    assert bar.high.profit_pence != result.base.profit_pence
    assert bar.low.profit_pence != bar.high.profit_pence


def test_rows_and_cols_may_both_be_phase_slip_targeting_different_phases():
    issues = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id="planning", steps=[0, 3]),
        cols=SensitivityAxis(lever="phase_slip", phase_id="construction", steps=[0, 3]),
        tornado=[],
    ), _network_doc())
    assert [i for i in issues if i.severity == "error"] == []


def test_still_rejects_two_phase_slip_axes_targeting_the_same_phase():
    issues = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id="planning", steps=[0, 3]),
        cols=SensitivityAxis(lever="phase_slip", phase_id="planning", steps=[0, 3]),
        tornado=[],
    ), _network_doc())
    assert any(i.field == "sensitivity.cols.lever" for i in issues)


def test_tornado_may_carry_two_phase_slip_bars_targeting_different_phases():
    issues = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0]),
        tornado=[
            TornadoRange(lever="phase_slip", phase_id="planning", low=-1, high=1),
            TornadoRange(lever="phase_slip", phase_id="construction", low=-1, high=1),
        ],
    ), _network_doc())
    assert [i for i in issues if i.severity == "error"] == []


def test_rejects_two_tornado_bars_targeting_the_same_phase():
    issues = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0]),
        tornado=[
            TornadoRange(lever="phase_slip", phase_id="planning", low=-1, high=1),
            TornadoRange(lever="phase_slip", phase_id="planning", low=-2, high=2),
        ],
    ), _network_doc())
    assert any("appears more than once" in i.message for i in issues)


def test_rejects_a_phase_slip_axis_with_null_phase_id_and_a_non_phase_slip_axis_with_one_set():
    bad1 = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id=None, steps=[0, 3]),
        cols=SensitivityAxis(lever="gdv", phase_id=None, steps=[0, 5]),
        tornado=[],
    ))
    assert any(i.field == "sensitivity.rows.phase_id" for i in bad1)

    bad2 = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", phase_id="planning", steps=[0, 5]),
        cols=SensitivityAxis(lever="construction_cost", phase_id=None, steps=[0, 5]),
        tornado=[],
    ))
    assert any(i.field == "sensitivity.rows.phase_id" for i in bad2)


def test_rejects_a_phase_slip_tornado_range_with_null_phase_id_and_a_non_phase_slip_one_with_one_set():
    bad1 = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0, 5]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0, 5]),
        tornado=[TornadoRange(lever="phase_slip", phase_id=None, low=-1, high=1)],
    ))
    assert any(
        i.field == "sensitivity.tornado" and "needs a phase_id" in i.message for i in bad1
    )

    bad2 = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0, 5]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0, 5]),
        tornado=[TornadoRange(lever="timeline", phase_id="planning", low=-1, high=1)],
    ))
    assert any(
        i.field == "sensitivity.tornado" and "only meaningful for the phase_slip lever" in i.message
        for i in bad2
    )


def test_rejects_a_phase_slip_axis_naming_a_phase_the_document_does_not_carry():
    e = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id="ghost", steps=[0, 3]),
        cols=SensitivityAxis(lever="gdv", steps=[0, 5]),
        tornado=[],
    ), _network_doc())
    assert any('no phase with id "ghost"' in i.message for i in e)


def test_accepts_a_phase_slip_axis_when_no_document_is_supplied_to_check_against():
    issues = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id="ghost", steps=[0, 3]),
        cols=SensitivityAxis(lever="gdv", steps=[0, 5]),
        tornado=[],
    ))
    assert [i for i in issues if i.severity == "error"] == []


def test_rejects_a_fractional_phase_slip_step_as_timeline_already_does():
    """Sec 12.6's fractional-step rule extends verbatim to phase_slip (spec Sec18.9:
    'the integer-steps rule that timeline already has'), pinned at the SAME field
    the timeline rule uses (sensitivity.rows.steps)."""
    e = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id="planning", steps=[0, 1.5]),
        cols=SensitivityAxis(lever="gdv", steps=[0, 5]),
        tornado=[],
    ), _network_doc())
    assert any(i.field == "sensitivity.rows.steps" for i in e)


def test_rejects_a_fractional_phase_slip_tornado_bound():
    e = validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="gdv", steps=[0, 5]),
        cols=SensitivityAxis(lever="construction_cost", steps=[0, 5]),
        tornado=[TornadoRange(lever="phase_slip", phase_id="planning", low=-1, high=1.5)],
    ), _network_doc())
    assert any(i.field == "sensitivity.tornado" and "whole months" in i.message for i in e)


def test_accepts_a_whole_month_phase_slip_axis_targeting_a_real_phase():
    assert validate_sensitivity_config(SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id="planning", steps=[-2, 0, 2]),
        cols=SensitivityAxis(lever="gdv", steps=[0, 5]),
        tornado=[],
    ), _network_doc()) == []


def test_overrunning_phase_slip_produces_an_invalid_cell_not_a_wrong_number():
    """Sec 12.7's existing cell-validity machinery, unchanged -- the fixture is
    new. Hand-derived: construction's unslipped start is 2 (planning finishes
    month 2). +24 months of slip pushes its start to 26 and its finish to 34 --
    22 months past the 12-month term, an overrun naming the phase."""
    result = run_sensitivity(_network_doc(12), SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id="construction", steps=[24]),
        cols=SensitivityAxis(lever="gdv", steps=[0]),
        tornado=[],
    ))
    cell = result.matrix[0][0]
    assert cell.profit_pence is None
    assert any("after maturity" in e.message for e in cell.validation_errors)


def test_over_accelerating_phase_slip_also_produces_an_invalid_cell():
    """Hand-derived: planning is predecessor-free at start_offset 0, so its
    unslipped start is 0. A -24 slip resolves its start to -24, before month 0."""
    result = run_sensitivity(_network_doc(12), SensitivityConfig(
        rows=SensitivityAxis(lever="phase_slip", phase_id="planning", steps=[-24]),
        cols=SensitivityAxis(lever="gdv", steps=[0]),
        tornado=[],
    ))
    cell = result.matrix[0][0]
    assert cell.profit_pence is None
    assert any("before month 0" in e.message for e in cell.validation_errors)


def test_rejects_a_phase_slip_cell_on_a_programme_none_document_as_lever_misconfiguration():
    """Sec 18.9: phase_slip on a programme = None document has no field to write,
    and is rejected at validation, never silently ignored."""
    doc = _network_doc().model_copy(update={"programme": None})
    with pytest.raises(InvalidSensitivityConfigError):
        run_sensitivity(doc, SensitivityConfig(
            rows=SensitivityAxis(lever="phase_slip", phase_id="planning", steps=[1]),
            cols=SensitivityAxis(lever="gdv", steps=[0]),
            tornado=[],
        ))


def test_phase_slip_leaves_finance_and_equity_sources_untouched():
    """Sec 12.2 facility invariance."""
    doc = _with_slip(_network_doc(), "planning", 1)
    overrides = dict(_ZERO_OVERRIDES)
    overrides["phase_slip_phase_id"] = "planning"
    overrides["phase_slip_months"] = 6
    out = apply_scenario(doc, ScenarioOverrides(**overrides))
    assert out.finance == doc.finance
    assert out.equity_sources == doc.equity_sources
